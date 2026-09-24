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

          let empHours = 0;
          for (const s of publishedShifts) {
            const template = SHIFT_TEMPLATES[s.shift_code];
            empHours += template ? template.duration_hours : 5;
          }

          // Use employee rate snapshot
          const rate = emp.current_rate_per_hour;
          const standardPay = empHours * rate;
          const allowance = 0;
          const bonus = 0;
          const deduction = 0;
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
