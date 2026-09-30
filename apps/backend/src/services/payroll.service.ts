import {
  ERROR_CODES,
  PayrollRun,
  PayrollRunStatus,
  PayslipItem,
  SHIFT_TEMPLATES,
} from '@ubm/shared';
import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { singleWriterQueue } from '../repositories/single-writer-queue.js';
import { Server } from 'socket.io';

/**
 * Nấc phạt đi trễ (NV chính thức), tính trên lương 1 ca:
 * - Đến sớm/trong 4 phút đầu: không vi phạm.
 * - Trễ 5–29 phút: phạt 30.000đ.
 * - Trễ 30–59 phút: phạt 50% lương ca.
 * - Trễ từ 60 phút: phạt 100% lương ca (ca không lương).
 * - Thiếu check-in hoặc check-out: vắng 100% lương ca.
 */
export const LATE_FINE_FLAT_VND = 30000;

export function lateFineFor(minutesLate: number, shiftPay: number): { tier: string; deduction: number; unpaid: boolean } {
  const m = Math.floor(Number(minutesLate) || 0);
  if (m < 5) return { tier: 'NONE', deduction: 0, unpaid: false };
  if (m < 30) return { tier: 'FLAT_30K', deduction: LATE_FINE_FLAT_VND, unpaid: false };
  if (m < 60) return { tier: 'HALF_SHIFT', deduction: Math.round(shiftPay * 0.5), unpaid: false };
  return { tier: 'FULL_SHIFT', deduction: 0, unpaid: true };
}

export class PayrollService {
  constructor(
    private repo: ISheetsRepository,
    private io?: Server
  ) {}

  public setSocketServer(io: Server) {
    this.io = io;
  }

  async calculateDraftPayroll(period: string, branchScope = '*', creatorId: string) {
    const runId = `PAY_${period.replace('-', '_')}_${Date.now()}`;

    return singleWriterQueue.enqueue({
      entityType: 'KY_LUONG',
      entityId: runId,
      actorId: creatorId,
      execute: async () => {
        const employees = await this.repo.listEmployees({ branch: branchScope });
        const fromDate = `${period}-01`;
        const toDate = `${period}-31`;

        const payslipItems: Omit<PayslipItem, 'created_at' | 'updated_at'>[] = [];
        let totalHours = 0;
        let totalAmount = 0;

        for (const emp of employees) {
          const empShifts = await this.repo.getShiftsForEmployee(emp.employee_id, fromDate, toDate);
          const publishedShifts = empShifts.filter(s => s.status === 'PUBLISHED');

          // Ràng buộc: đủ check-in + check-out mới tính 1 lương/ca.
          // Thiếu 1 trong 2 (kể cả bản ghi ABSENT) = vắng 100% lương ca.
          const eventsByDate = new Map<string, any[]>();
          const eventsOf = async (date: string) => {
            if (!eventsByDate.has(date)) {
              eventsByDate.set(date, await this.repo.getAttendanceEvents(emp.employee_id, date).catch(() => []));
            }
            return eventsByDate.get(date)!;
          };
          // Use employee rate snapshot
          const rate = emp.current_rate_per_hour;
          let absentShifts = 0;
          let empHours = 0;
          let standardPay = 0;
          let deduction = 0;
          const lateCases: string[] = [];
          for (const s of publishedShifts) {
            const dayEvents = await eventsOf(s.date);
            const inEvt = dayEvents.find(
              (e: any) => e.type === 'CHECK_IN' && (!e.assignment_id || e.assignment_id === s.assignment_id)
            );
            const hasOut = dayEvents.some(
              (e: any) => e.type === 'CHECK_OUT' && (!e.assignment_id || e.assignment_id === s.assignment_id)
            );
            const template = SHIFT_TEMPLATES[s.shift_code];
            const hours = template ? template.duration_hours : 5;
            const shiftPay = hours * rate;
            if (!inEvt || !hasOut) {
              absentShifts++;
              continue;
            }
            // Cờ trễ có thể mất sau vòng pull Sheet cũ -> tính bù từ giờ check-in so với giờ vào ca.
            const lateMin = inEvt.is_late
              ? Number(inEvt.minutes_deviation) || 0
              : (() => {
                  const st = new Date(s.start_at).getTime();
                  const ct = new Date(inEvt.client_time).getTime();
                  if (!Number.isFinite(st) || !Number.isFinite(ct)) return 0;
                  return Math.max(0, Math.round((ct - st) / 60000));
                })();
            const fine = lateFineFor(lateMin, shiftPay);
            if (fine.unpaid) {
              absentShifts++;
              lateCases.push(`${s.date} trễ ${lateMin}p: phạt 100%`);
              continue;
            }
            empHours += hours;
            standardPay += shiftPay;
            if (fine.deduction > 0) {
              deduction += fine.deduction;
              lateCases.push(`${s.date} trễ ${lateMin}p: phạt ${fine.deduction.toLocaleString('vi-VN')}đ`);
            }
          }

          const allowance = 0;
          // Phụ cấp nhường ca +30.000đ/ca: CHỈ khi HR điều phối (HR_DISPATCH đã
          // APPROVED, người nhận = target). NV tự tráo với nhau: 0đ.
          let bonus = 0;
          try {
            const swaps = await this.repo.listSwapRequests(emp.employee_id);
            bonus = swaps
              .filter(
                s =>
                  (s as any).swap_kind === 'HR_DISPATCH' &&
                  s.status === 'APPROVED' &&
                  s.target_employee_id === emp.employee_id &&
                  (s.approved_at || '').startsWith(period)
              )
              .reduce((sum, s) => sum + (Number((s as any).bonus_amount) || 30000), 0);
          } catch { /* giữ bonus 0 khi đọc lỗi */ }
          const netPay = standardPay + allowance + bonus - deduction;

          totalHours += empHours;
          totalAmount += netPay;

          payslipItems.push({
            item_id: `SLIP_${runId}_${emp.employee_id}`,
            run_id: runId,
            employee_id: emp.employee_id,
            employee_code: emp.employee_code,
            full_name: emp.full_name,
            period,
            total_shifts: publishedShifts.length,
            absent_shifts: absentShifts,
            standard_hours: empHours,
            rate_snapshot: rate,
            standard_pay: standardPay,
            allowance,
            bonus,
            deduction,
            net_pay: netPay,
            status: 'DRAFT',
          });
        }

        const runRecord: Omit<PayrollRun, 'created_at' | 'updated_at' | 'version'> = {
          run_id: runId,
          period,
          branch_scope: branchScope,
          status: 'DRAFT',
          total_employees: employees.length,
          total_hours: totalHours,
          total_amount: totalAmount,
          created_by: creatorId,
        };

        return this.repo.createPayrollRun(runRecord, payslipItems);
      },
    });
  }

  async listRuns() {
    return this.repo.listPayrollRuns();
  }

  async getRunDetails(runId: string) {
    const run = await this.repo.getPayrollRun(runId);
    if (!run) return null;
    const slips = await this.repo.getPayslipsByRunId(runId);
    return { run, slips };
  }

  async reconcileRun(runId: string, actorId: string) {
    return singleWriterQueue.enqueue({
      entityType: 'KY_LUONG',
      entityId: runId,
      actorId,
      execute: async () => {
        return this.repo.updatePayrollRunStatus(runId, 'RECONCILED', actorId, {
          reconciled_by: actorId,
          reconciled_at: new Date().toISOString(),
        });
      },
    });
  }

  async approveRun(runId: string, approverId: string) {
    return singleWriterQueue.enqueue({
      entityType: 'KY_LUONG',
      entityId: runId,
      actorId: approverId,
      execute: async () => {
        const run = await this.repo.getPayrollRun(runId);
        if (!run) throw new Error('PAYROLL_RUN_NOT_FOUND');

        // Separation of Duties check
        if (run.created_by === approverId) {
          throw new Error(ERROR_CODES.SEPARATION_OF_DUTIES_VIOLATION);
        }

        return this.repo.updatePayrollRunStatus(runId, 'APPROVED', approverId);
      },
    });
  }

  async publishRun(runId: string, actorId: string) {
    return singleWriterQueue.enqueue({
      entityType: 'KY_LUONG',
      entityId: runId,
      actorId,
      execute: async () => {
        const updated = await this.repo.updatePayrollRunStatus(runId, 'PUBLISHED', actorId);

        // Notify via socket with SAFE payload (no salaries or amounts in payload)
        if (this.io) {
          this.io.emit('payroll.published', {
            runId,
            period: updated.period,
            title: `Phiếu lương kỳ ${updated.period} đã được công bố`,
          });
        }

        return updated;
      },
    });
  }

  async markPaid(runId: string, actorId: string) {
    return singleWriterQueue.enqueue({
      entityType: 'KY_LUONG',
      entityId: runId,
      actorId,
      execute: async () => {
        return this.repo.updatePayrollRunStatus(runId, 'PAID', actorId);
      },
    });
  }

  async getEmployeePayslips(employeeId: string) {
    return this.repo.getPayslipsForEmployee(employeeId);
  }
}
