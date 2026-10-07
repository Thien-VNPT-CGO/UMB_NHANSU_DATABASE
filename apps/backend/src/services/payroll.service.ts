import {
  BankQrConfig,
  ERROR_CODES,
  PayrollRun,
  PayrollRunStatus,
  PayslipItem,
  PayslipSignerRole,
  SHIFT_TEMPLATES,
  DEFAULT_PAYROLL_FORMULA,
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

/**
 * Khoảng ngày chuẩn của 1 kỳ lương: ngày 1 -> ngày cuối tháng (28/29/30/31).
 * Dùng chung cho mọi tính toán Finance để kế toán luôn thấy đủ công cả tháng.
 */
export function monthRange(period: string): { fromDate: string; toDate: string; daysInMonth: number } {
  const m = String(period || '').match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!m) throw new Error('Kỳ lương phải dạng YYYY-MM (VD: 2026-10)!');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const dd = String(daysInMonth).padStart(2, '0');
  return { fromDate: `${period}-01`, toDate: `${period}-${dd}`, daysInMonth };
}

export class PayrollService {
  constructor(
    private repo: ISheetsRepository,
    private io?: Server
  ) {}

  public setSocketServer(io: Server) {
    this.io = io;
  }

  private notificationsService?: any;
  public setNotificationsService(svc: any) {
    this.notificationsService = svc;
  }

  public triggerSheetsPush() {
    try {
      const sync = (this.repo as any).syncService || (this.repo as any).fallbackAdapter?.syncService;
      if (sync && typeof sync.pushPayslipsTab === 'function') {
        sync.pushPayslipsTab(this.repo).catch((err: any) => console.warn('[PayrollService] pushPayslipsTab error:', err?.message || err));
      }
    } catch { /* non-fatal */ }
  }

  async calculateDraftPayroll(period: string, branchScope = '*', creatorId: string) {
    const runId = `PAY_${period.replace('-', '_')}_${Date.now()}`;

    return singleWriterQueue.enqueue({
      entityType: 'KY_LUONG',
      entityId: runId,
      actorId: creatorId,
      execute: async () => {
        const employees = await this.repo.listEmployees({ branch: branchScope });
        const { fromDate, toDate } = monthRange(period);

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
            // Ưu tiên mức phạt đã ghi nhận lúc check-in (ràng buộc chặt, không tính lại).
            const storedTier = (inEvt as any).fine_tier;
            const storedAmt = Number((inEvt as any).fine_amount) || 0;
            const useStored = !!storedTier && storedTier !== 'NONE';
            const fine = lateFineFor(lateMin, shiftPay);
            const unpaid = useStored ? storedTier === 'FULL_SHIFT' : fine.unpaid;
            const deductAmt = useStored ? (storedTier === 'FULL_SHIFT' ? 0 : storedAmt) : fine.deduction;
            if (unpaid) {
              absentShifts++;
              lateCases.push(`${s.date} trễ ${lateMin}p: phạt 100%`);
              continue;
            }
            empHours += hours;
            standardPay += shiftPay;
            if (deductAmt > 0) {
              deduction += deductAmt;
              lateCases.push(`${s.date} trễ ${lateMin}p: phạt ${deductAmt.toLocaleString('vi-VN')}đ`);
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
            bank_name: (emp as any).bank_name || '',
            bank_account: (emp as any).bank_account || '',
            bank_holder: (emp as any).bank_holder || emp.full_name || '',
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

  // --- Công thức lương theo file Excel (Finance) ---
  async getFormula(period: string) {
    const saved = await this.repo.getPayrollFormula(period).catch(() => null);
    return { period, ...DEFAULT_PAYROLL_FORMULA, ...(saved || {}) };
  }

  async saveFormula(period: string, data: any, actorId: string) {
    const rateTV = Math.max(0, Math.floor(Number(data.rateTV)));
    const rateCT = Math.max(0, Math.floor(Number(data.rateCT)));
    const otPerSlot = Math.max(0, Math.floor(Number(data.otPerSlot)));
    const t1 = Number(data.otThreshold1);
    const t2 = Number(data.otThreshold2);
    if (![rateTV, rateCT, otPerSlot].every(Number.isFinite)) throw new Error('INVALID_FORMULA: đơn giá phải là số!');
    if (!Number.isFinite(t1) || !Number.isFinite(t2) || t1 < 0 || t2 <= t1 || t2 > 24) {
      throw new Error('INVALID_FORMULA: ngưỡng OT phải 0 ≤ T1 < T2 ≤ 24!');
    }
    return this.repo.savePayrollFormula({
      period, rateTV, rateCT, otPerSlot, otThreshold1: t1, otThreshold2: t2, updatedBy: actorId,
    });
  }

  async getInputs(period: string) {
    return this.repo.getPayrollInputs(period).catch(() => []);
  }

  async upsertInput(period: string, data: any, actorId: string) {
    if (!data?.employeeId) throw new Error('MISSING_EMPLOYEE: thiếu nhân viên!');
    const num = (v: any) => Math.max(0, Math.floor(Number(v) || 0));
    return this.repo.upsertPayrollInput({
      period,
      employee_id: String(data.employeeId),
      luong_cb: num(data.luong_cb),
      ot_extra: num(data.ot_extra),
      bonus_extra: num(data.bonus_extra),
      ung_luong: num(data.ung_luong),
      tru_kpi: num(data.tru_kpi),
      dong_phuc: num(data.dong_phuc),
      note: String(data.note || '').slice(0, 500) || undefined,
      updatedBy: actorId,
    });
  }

  /**
   * Tính lương theo công thức Excel cho toàn bộ NV:
   * TỔNG CỘNG = LCB(tay) + PC_OT + Lương giờ + OT thêm(tay) + Bonus
   * TỔNG LƯƠNG = TỔNG CỘNG − KPI(tay) − phạt trễ/vắng
   * THỰC LÃNH = TỔNG LƯƠNG − Ứng − Đồng phục
   * (PC_OT = suất OT × đơn giá; ngày ≥T1 giờ = 1 suất, ≥T2 giờ = 2 suất)
   */
  async calculateFormulaPayroll(period: string, branchScope = '*', creatorId: string) {
    const runId = `PAY_${period.replace('-', '_')}_${Date.now()}`;
    return singleWriterQueue.enqueue({
      entityType: 'KY_LUONG',
      entityId: runId,
      actorId: creatorId,
      execute: async () => {
        const formula = await this.getFormula(period);
        const inputsArr = await this.repo.getPayrollInputs(period).catch(() => []);
        const inputs = new Map((inputsArr || []).map((x: any) => [x.employee_id, x]));
        const employees = await this.repo.listEmployees({ branch: branchScope });
        const { fromDate, toDate } = monthRange(period);

        const payslipItems: Omit<PayslipItem, 'created_at' | 'updated_at'>[] = [];
        let totalHours = 0;
        let totalAmount = 0;

        for (const emp of employees) {
          const isProb = (emp as any).employment_status === 'PROBATION';
          const rate = isProb ? formula.rateTV : formula.rateCT;
          const empShifts = await this.repo.getShiftsForEmployee(emp.employee_id, fromDate, toDate);
          const publishedShifts = empShifts.filter(s => s.status === 'PUBLISHED');
          const eventsByDate = new Map<string, any[]>();
          const eventsOf = async (date: string) => {
            if (!eventsByDate.has(date)) {
              eventsByDate.set(date, await this.repo.getAttendanceEvents(emp.employee_id, date).catch(() => []));
            }
            return eventsByDate.get(date)!;
          };
          let absentShifts = 0;
          let empHours = 0;
          let standardPay = 0;
          let deduction = 0;
          const dayHours = new Map<string, number>();
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
            const lateMin = inEvt.is_late
              ? Number(inEvt.minutes_deviation) || 0
              : (() => {
                  const st = new Date(s.start_at).getTime();
                  const ct = new Date(inEvt.client_time).getTime();
                  if (!Number.isFinite(st) || !Number.isFinite(ct)) return 0;
                  return Math.max(0, Math.round((ct - st) / 60000));
                })();
            const storedTier = (inEvt as any).fine_tier;
            const storedAmt = Number((inEvt as any).fine_amount) || 0;
            const useStored = !!storedTier && storedTier !== 'NONE';
            const fine = lateFineFor(lateMin, shiftPay);
            const unpaid = useStored ? storedTier === 'FULL_SHIFT' : fine.unpaid;
            const deductAmt = useStored ? (storedTier === 'FULL_SHIFT' ? 0 : storedAmt) : fine.deduction;
            if (unpaid) {
              absentShifts++;
              continue;
            }
            empHours += hours;
            standardPay += shiftPay;
            dayHours.set(s.date, (dayHours.get(s.date) || 0) + hours);
            if (deductAmt > 0) deduction += deductAmt;
          }
          // Suất OT theo ngày (Excel COUNTIFS): >=T2 giờ = 2 suất, >=T1 giờ = 1 suất.
          let otSlots = 0;
          for (const h of dayHours.values()) {
            if (h >= formula.otThreshold2) otSlots += 2;
            else if (h >= formula.otThreshold1) otSlots += 1;
          }
          const phuCapOT = otSlots * formula.otPerSlot;
          // Bonus hệ thống: nhường ca HR điều phối đã duyệt.
          let bonusSys = 0;
          try {
            const swaps = await this.repo.listSwapRequests(emp.employee_id);
            bonusSys = swaps
              .filter(
                s =>
                  (s as any).swap_kind === 'HR_DISPATCH' &&
                  s.status === 'APPROVED' &&
                  s.target_employee_id === emp.employee_id &&
                  (s.approved_at || '').startsWith(period)
              )
              .reduce((sum, s) => sum + (Number((s as any).bonus_amount) || 30000), 0);
          } catch { /* giữ 0 */ }
          const inp: any = inputs.get(emp.employee_id) || {};
          const luongCB = Number(inp.luong_cb) || 0;
          const otExtra = Number(inp.ot_extra) || 0;
          const bonusExtra = Number(inp.bonus_extra) || 0;
          const ung = Number(inp.ung_luong) || 0;
          const kpi = Number(inp.tru_kpi) || 0;
          const dp = Number(inp.dong_phuc) || 0;
          const bonusTotal = bonusSys + bonusExtra;
          const tongCong = luongCB + phuCapOT + standardPay + otExtra + bonusTotal;
          const tongLuong = tongCong - kpi - deduction;
          const thucLanh = tongLuong - ung - dp;

          totalHours += empHours;
          totalAmount += thucLanh;

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
            allowance: phuCapOT,
            bonus: bonusTotal,
            deduction,
            net_pay: thucLanh,
            ot_slots: otSlots,
            phu_cap_ot: phuCapOT,
            luong_cb: luongCB,
            ot_extra: otExtra,
            bonus_extra: bonusExtra,
            ung_luong: ung,
            tru_kpi: kpi,
            dong_phuc: dp,
            tong_cong: tongCong,
            tong_luong: tongLuong,
            thuc_lanh: thucLanh,
            bank_name: (emp as any).bank_name || '',
            bank_account: (emp as any).bank_account || '',
            bank_holder: (emp as any).bank_holder || emp.full_name || '',
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

  // --- Quy trình ký 3 bên từng phiếu: DRAFT -> (ký lập + ký QL) -> PUBLISHED -> (NV ký) CONFIRMED -> PAID ---
  private notifySlipsChanged(action: string, extra: any = {}) {
    if (!this.io) return;
    try {
      this.io.emit('data:updated', { entity: 'payslips', data: { action, ...extra }, timestamp: new Date().toISOString() });
    } catch { /* non-fatal */ }
  }

  /**
   * Ký 1 phiếu:
   * - lap/quanly (Kế toán): chỉ ký khi phiếu còn DRAFT/PUBLISHED (chưa NV xác nhận/chi trả).
   * - nhanvien (chính chủ): chỉ ký khi phiếu đã PUBLISHED -> chuyển CONFIRMED (đủ 3 chữ ký).
   */
  async signSlip(itemId: string, role: PayslipSignerRole, name: string, img: string | undefined, actorId: string) {
    return singleWriterQueue.enqueue({
      entityType: 'PHIEU_LUONG',
      entityId: itemId,
      actorId,
      execute: async () => {
        const slip = await this.repo.getPayslipById(itemId);
        if (!slip) throw new Error('PAYSLIP_NOT_FOUND');
        const nm = String(name || '').trim().slice(0, 80);
        if (!nm) throw new Error('MISSING_SIGNER_NAME: thiếu tên người ký!');
        const sig = {
          name: nm,
          at: new Date().toISOString(),
          ...(img ? { img: String(img).slice(0, 45000) } : {}),
          by: actorId,
        };
        let updated;
        if (role === 'nhanvien') {
          if (String(slip.employee_id) !== String(actorId) && String(slip.employee_code) !== String(actorId)) {
            throw new Error(ERROR_CODES.FORBIDDEN);
          }
          if (slip.status !== 'PUBLISHED') throw new Error('SLIP_NOT_PUBLISHED: phiếu chưa được gửi, chưa ký xác nhận được!');
          updated = await this.repo.updatePayslip(itemId, {
            sign_nhanvien: sig as any,
            status: 'CONFIRMED',
            slip_confirmed_at: (sig as any).at,
          });
          // Gửi thông báo đến Kế toán & Admin
          if (this.notificationsService) {
            await this.notificationsService.sendNotification({
              recipientIds: ['ALL'],
              type: 'emp.payslip',
              severity: 'SYSTEM',
              title: `✍️ Nhân viên ${slip.full_name} đã xác nhận phiếu lương!`,
              summary: `${slip.full_name} (${slip.employee_code}) đã kiểm tra và ký xác nhận phiếu lương kỳ ${slip.period}. Đã đủ 3 chữ ký, sẵn sàng quét mã QR chuyển khoản.`,
              targetPath: '/fin_payslips',
              actorId,
            }).catch(() => null);
          }
          if (this.io) {
            this.io.emit('payroll.confirmed', {
              itemId,
              period: slip.period,
              employeeId: slip.employee_id,
              employeeCode: slip.employee_code,
              fullName: slip.full_name,
            });
            this.io.emit('system:notification', {
              type: 'SYSTEM',
              origin: 'EMPLOYEE',
              title: `✍️ Nhân viên ${slip.full_name} đã xác nhận phiếu lương!`,
              message: `${slip.full_name} (${slip.employee_code}) đã kiểm tra và ký xác nhận phiếu lương kỳ ${slip.period}. Đã đủ 3 chữ ký, sẵn sàng quét mã QR chuyển khoản.`,
              timestamp: new Date().toISOString(),
            });
          }
        } else {
          if (slip.status === 'CONFIRMED' || slip.status === 'PAID') {
            throw new Error('SLIP_LOCKED: phiếu đã xác nhận/chi trả, không ký lại!');
          }
          updated = await this.repo.updatePayslip(itemId, {
            [role === 'lap' ? 'sign_lap' : 'sign_quanly']: sig,
          } as any);
        }
        this.notifySlipsChanged('sign', { itemId, role });
        this.triggerSheetsPush();
        return updated;
      },
    });
  }

  /** Kế toán áp dụng nhanh 2 chữ ký mẫu (Người lập + Quản lý chi nhánh) */
  async applyBothSignatures(itemId: string, lapName: string, lapImg: string, qlName: string, qlImg: string, actorId: string) {
    return singleWriterQueue.enqueue({
      entityType: 'PHIEU_LUONG',
      entityId: itemId,
      actorId,
      execute: async () => {
        const slip = await this.repo.getPayslipById(itemId);
        if (!slip) throw new Error('PAYSLIP_NOT_FOUND');
        if (slip.status === 'CONFIRMED' || slip.status === 'PAID') {
          throw new Error('SLIP_LOCKED: phiếu đã xác nhận/chi trả, không ký lại!');
        }
        const updates: any = {};
        if (lapImg) {
          updates.sign_lap = { name: lapName || 'Kế toán viên', img: lapImg, at: new Date().toISOString() };
        }
        if (qlImg) {
          updates.sign_quanly = { name: qlName || 'Quản lý chi nhánh', img: qlImg, at: new Date().toISOString() };
        }
        const updated = await this.repo.updatePayslip(itemId, updates);
        this.notifySlipsChanged('sign', { itemId });
        this.triggerSheetsPush();
        return updated;
      },
    });
  }

  /** Gửi 1 phiếu đến NV: yêu cầu đủ 2 chữ ký lập + quản lý, phiếu đang DRAFT. */
  async publishSlip(itemId: string, actorId: string) {
    return singleWriterQueue.enqueue({
      entityType: 'PHIEU_LUONG',
      entityId: itemId,
      actorId,
      execute: async () => {
        const slip = await this.repo.getPayslipById(itemId);
        if (!slip) throw new Error('PAYSLIP_NOT_FOUND');
        if (slip.status !== 'DRAFT') throw new Error(`SLIP_NOT_DRAFT: phiếu đang ở trạng thái ${slip.status}, không gửi lại!`);
        if (!(slip as any).sign_lap || !(slip as any).sign_quanly) {
          throw new Error('MISSING_SIGNATURES: thiếu chữ ký người lập hoặc quản lý chi nhánh!');
        }
        const updated = await this.repo.updatePayslip(itemId, {
          status: 'PUBLISHED',
          slip_published_at: new Date().toISOString(),
        });
        if (this.notificationsService) {
          await this.notificationsService.sendNotification({
            recipientIds: [slip.employee_id],
            type: 'emp.payslip',
            severity: 'SYSTEM',
            title: `💰 Phiếu lương kỳ ${slip.period} đã phát hành!`,
            summary: `Kế toán đã phát hành phiếu lương kỳ ${slip.period} cho bạn. Vui lòng kiểm tra lại tiền thực lãnh và ký tên xác nhận.`,
            targetPath: '/notifs_salary',
            actorId,
          }).catch(() => null);
        }
        this.notifySlipsChanged('publish', { itemId });
        this.triggerSheetsPush();
        return updated;
      },
    });
  }

  /** Gửi hàng loạt 1 lần: toàn bộ phiếu DRAFT đủ 2 ký của kỳ -> PUBLISHED. Thiếu ký thì liệt kê để bổ sung. */
  async publishAllSlips(runIdOrPeriod: string, actorId: string) {
    return singleWriterQueue.enqueue({
      entityType: 'KY_LUONG',
      entityId: runIdOrPeriod,
      actorId,
      execute: async () => {
        let slips: any[] = [];
        if (runIdOrPeriod.startsWith('PAY_') || runIdOrPeriod.startsWith('RUN_')) {
          slips = await this.repo.getPayslipsByRunId(runIdOrPeriod);
        }
        if (!slips || slips.length === 0) {
          const allSlips = await this.collectAllSlipsInternal();
          slips = allSlips.filter(s => s.period === runIdOrPeriod || s.run_id === runIdOrPeriod);
        }
        if (!slips || slips.length === 0) throw new Error('PAYROLL_RUN_EMPTY: kỳ chưa có phiếu nào!');
        const published: string[] = [];
        const skipped: { itemId: string; employee: string; reason: string }[] = [];
        for (const s of slips) {
          if ((s as any).status !== 'DRAFT') {
            if ((s as any).status !== 'PUBLISHED') skipped.push({ itemId: (s as any).item_id, employee: (s as any).full_name || (s as any).employee_id, reason: `đang ở trạng thái ${(s as any).status}` });
            else published.push((s as any).item_id);
            continue;
          }
          if (!(s as any).sign_lap || !(s as any).sign_quanly) {
            skipped.push({ itemId: (s as any).item_id, employee: (s as any).full_name || (s as any).employee_id, reason: 'thiếu chữ ký lập/quản lý' });
            continue;
          }
          await this.repo.updatePayslip((s as any).item_id, {
            status: 'PUBLISHED',
            slip_published_at: new Date().toISOString(),
          });
          published.push((s as any).item_id);
        }
        if (this.notificationsService && published.length > 0) {
          const pubSlips = slips.filter(s => published.includes((s as any).item_id));
          const empIds = [...new Set(pubSlips.map(s => (s as any).employee_id).filter(Boolean))];
          if (empIds.length > 0) {
            await this.notificationsService.sendNotification({
              recipientIds: empIds,
              type: 'emp.payslip',
              severity: 'SYSTEM',
              title: `💰 Phiếu lương đã phát hành!`,
              summary: `Kế toán đã phát hành phiếu lương cho bạn. Vui lòng kiểm tra lại tiền thực lãnh và ký tên xác nhận.`,
              targetPath: '/notifs_salary',
              actorId,
            }).catch(() => null);
          }
        }
        this.notifySlipsChanged('publish-all', { runId: runIdOrPeriod, count: published.length });
        this.triggerSheetsPush();
        return { published, skipped };
      },
    });
  }

  /** Kế toán xác nhận đã chuyển khoản 1 phiếu: yêu cầu đủ 3 chữ ký + NV đã xác nhận. */
  async markSlipPaid(itemId: string, actorId: string) {
    return singleWriterQueue.enqueue({
      entityType: 'PHIEU_LUONG',
      entityId: itemId,
      actorId,
      execute: async () => {
        const slip = await this.repo.getPayslipById(itemId);
        if (!slip) throw new Error('PAYSLIP_NOT_FOUND');
        if (slip.status !== 'CONFIRMED') throw new Error('SLIP_NOT_CONFIRMED: nhân viên chưa ký xác nhận, chưa chuyển khoản!');
        if (!(slip as any).sign_lap || !(slip as any).sign_quanly || !(slip as any).sign_nhanvien) {
          throw new Error('MISSING_SIGNATURES: phiếu chưa đủ 3 chữ ký!');
        }
        const updated = await this.repo.updatePayslip(itemId, {
          status: 'PAID',
          slip_paid_at: new Date().toISOString(),
          slip_paid_by: actorId,
        });
        if (this.notificationsService) {
          const amt = Number(slip.thuc_lanh ?? slip.net_pay ?? 0).toLocaleString('vi-VN');
          await this.notificationsService.sendNotification({
            recipientIds: [slip.employee_id],
            type: 'emp.payslip',
            severity: 'SYSTEM',
            title: `✅ Đã chi trả lương kỳ ${slip.period}!`,
            summary: `Kế toán đã chuyển khoản ${amt}đ lương kỳ ${slip.period} vào tài khoản ngân hàng của bạn.`,
            targetPath: '/notifs_salary',
            actorId,
          }).catch(() => null);
        }
        this.notifySlipsChanged('paid', { itemId });
        this.triggerSheetsPush();
        return updated;
      },
    });
  }

  /** Cập nhật thông tin tài khoản ngân hàng cho 1 phiếu (và đồng bộ vào hồ sơ NV). */
  async updateSlipBank(itemId: string, bankName: string, bankAccount: string, bankHolder: string, actorId: string) {
    return singleWriterQueue.enqueue({
      entityType: 'PHIEU_LUONG',
      entityId: itemId,
      actorId,
      execute: async () => {
        const slip = await this.repo.getPayslipById(itemId);
        if (!slip) throw new Error('PAYSLIP_NOT_FOUND');
        const bName = String(bankName || '').trim().toUpperCase().slice(0, 30);
        const bAcc = String(bankAccount || '').trim().replace(/\s+/g, '').slice(0, 30);
        const bHolder = String(bankHolder || '').trim().toUpperCase().slice(0, 80);
        const updated = await this.repo.updatePayslip(itemId, {
          bank_name: bName,
          bank_account: bAcc,
          bank_holder: bHolder,
        });
        if (slip.employee_id && (this.repo as any).updateEmployee) {
          await (this.repo as any).updateEmployee(slip.employee_id, {
            bank_name: bName,
            bank_account: bAcc,
            bank_holder: bHolder,
          }).catch(() => null);
        }
        this.notifySlipsChanged('bank', { itemId });
        this.triggerSheetsPush();
        return updated;
      },
    });
  }

  private async collectAllSlipsInternal(): Promise<any[]> {
    const out: any[] = [];
    const seen = new Set<string>();
    const fb: any = (this.repo as any).fallbackAdapter || this.repo;
    if (Array.isArray(fb?.payslips)) {
      for (const s of fb.payslips) {
        if (s?.item_id && !seen.has(s.item_id)) {
          seen.add(s.item_id);
          out.push(s);
        }
      }
    }
    const runs = await this.repo.listPayrollRuns().catch(() => []);
    for (const r of runs || []) {
      const slips = await this.repo.getPayslipsByRunId((r as any).run_id).catch(() => []);
      for (const s of slips || []) {
        if ((s as any)?.item_id && !seen.has((s as any).item_id)) {
          seen.add((s as any).item_id);
          out.push(s);
        }
      }
    }
    return out;
  }

  async getPeriodSlips(period: string) {
    const runs = await this.repo.listPayrollRuns().catch(() => []);
    const matching = (runs || []).filter(r => r.period === period);
    let run: any = null;
    let slips: any[] = [];
    if (matching.length > 0) {
      run = matching[matching.length - 1];
      slips = await this.repo.getPayslipsByRunId(run.run_id).catch(() => []);
    }
    if (slips.length === 0) {
      const allSlips = await this.collectAllSlipsInternal();
      slips = allSlips.filter(s => s.period === period);
    }
    return { run, slips };
  }

  async ensurePeriodSlips(period: string, branchScope = '*', creatorId: string) {
    const existing = await this.getPeriodSlips(period);
    if (existing.slips && existing.slips.length > 0) {
      return existing;
    }
    const res = await this.calculateFormulaPayroll(period, branchScope, creatorId);
    return { run: (res as any).run, slips: (res as any).slips || (res as any).payslips || [] };
  }

  // --- Cấu hình VietQR công ty (lưu trong system settings, tự đồng bộ Sheets) ---
  async getBankConfig(): Promise<BankQrConfig | null> {
    const all: any = await (this.repo as any).getSystemSettings?.().catch(() => null);
    const cfg = all?.bankQr;
    if (!cfg || !cfg.bank || !cfg.account) return null;
    return { bank: String(cfg.bank), account: String(cfg.account), holder: String(cfg.holder || '') };
  }

  async saveBankConfig(data: any, actorId: string): Promise<BankQrConfig> {
    const bank = String(data?.bank || '').trim().toUpperCase().slice(0, 20);
    const account = String(data?.account || '').trim().replace(/\s+/g, '').slice(0, 30);
    const holder = String(data?.holder || '').trim().slice(0, 80);
    if (!bank || !account) throw new Error('INVALID_BANK_CONFIG: thiếu mã ngân hàng hoặc số tài khoản!');
    if (!/^[0-9]{6,20}$/.test(account)) throw new Error('INVALID_BANK_CONFIG: số tài khoản phải 6-20 chữ số!');
    const all: any = await (this.repo as any).getSystemSettings?.().catch(() => ({}));
    const cfg: BankQrConfig = { bank, account, holder, updatedBy: actorId, updatedAt: new Date().toISOString() };
    await (this.repo as any).updateSystemSettings?.({ ...(all || {}), bankQr: cfg });
    return cfg;
  }

  /**
   * Tổng hợp tháng cho NV CHÍNH THỨC + THỬ VIỆC (HR Reports, read-only,
   * không tạo kỳ lương):
   *  - Giờ làm = ca PUBLISHED có đủ check-in + check-out (vắng/trễ 100% không tính giờ).
   *  - Lương = phiếu của kỳ lương đã chốt (nếu có) — chưa chốt thì tạm tính theo
   *    công thức draft (lương ca theo đơn giá snapshot từng người - phạt trễ +
   *    phụ cấp điều phối).
   * Trả về tổng giờ/lương (chung + tách từng diện), NV nhiều/ít giờ nhất + chi tiết.
   */
  async summarizeOfficialMonth(period: string) {
    const { fromDate, toDate } = monthRange(period);
    const employees = (await this.repo.listEmployees()).filter(
      e => ['OFFICIAL', 'PROBATION'].includes((e as any)?.employment_status)
    );

    // Phiếu kỳ đã chốt (nếu Finance đã tính lương tháng này) -> lương thực tế.
    let runSlips = new Map<string, any>();
    let runStatus: string | null = null;
    try {
      const runs = await this.repo.listPayrollRuns();
      const run = runs.find(r => String((r as any).period) === period);
      if (run) {
        runStatus = String((run as any).status || '');
        const slips = await this.repo.getPayslipsByRunId((run as any).run_id);
        runSlips = new Map((slips || []).map((s: any) => [s.employee_id, s]));
      }
    } catch { /* không có kỳ lương thì toàn bộ là tạm tính */ }

    const rows: any[] = [];
    for (const emp of employees) {
      const empShifts = await this.repo.getShiftsForEmployee(emp.employee_id, fromDate, toDate);
      const published = empShifts.filter(s => s.status === 'PUBLISHED');
      const rate = Number((emp as any).current_rate_per_hour) || 0;
      let hours = 0;
      let shifts = 0;
      let absentShifts = 0;
      let standardPay = 0;
      let deduction = 0;
      let bonus = 0;
      for (const s of published) {
        const dayEvents = await this.repo.getAttendanceEvents(emp.employee_id, s.date).catch(() => []);
        const inEvt = dayEvents.find(
          (e: any) => e.type === 'CHECK_IN' && (!e.assignment_id || e.assignment_id === s.assignment_id)
        );
        const hasOut = dayEvents.some(
          (e: any) => e.type === 'CHECK_OUT' && (!e.assignment_id || e.assignment_id === s.assignment_id)
        );
        const template = SHIFT_TEMPLATES[s.shift_code];
        const h = template ? template.duration_hours : 5;
        if (!inEvt || !hasOut) {
          absentShifts++;
          continue;
        }
        const lateMin = inEvt.is_late
          ? Number(inEvt.minutes_deviation) || 0
          : (() => {
              const st = new Date(s.start_at).getTime();
              const ct = new Date(inEvt.client_time).getTime();
              if (!Number.isFinite(st) || !Number.isFinite(ct)) return 0;
              return Math.max(0, Math.round((ct - st) / 60000));
            })();
        const storedTier = (inEvt as any).fine_tier;
        const storedAmt = Number((inEvt as any).fine_amount) || 0;
        const useStored = !!storedTier && storedTier !== 'NONE';
        const fine = lateFineFor(lateMin, h * rate);
        const unpaid = useStored ? storedTier === 'FULL_SHIFT' : fine.unpaid;
        if (unpaid) {
          absentShifts++;
          continue;
        }
        const deductAmt = useStored ? (storedTier === 'FULL_SHIFT' ? 0 : storedAmt) : fine.deduction;
        hours += h;
        shifts++;
        standardPay += h * rate;
        deduction += deductAmt;
      }
      try {
        const swaps = await this.repo.listSwapRequests(emp.employee_id);
        bonus = swaps
          .filter(
            s =>
              (s as any).swap_kind === 'HR_DISPATCH' &&
              s.status === 'APPROVED' &&
              s.target_employee_id === emp.employee_id &&
              ((s as any).approved_at || '').startsWith(period)
          )
          .reduce((sum, s) => sum + (Number((s as any).bonus_amount) || 30000), 0);
      } catch { /* giữ bonus 0 */ }
      const liveNet = standardPay + bonus - deduction;
      const slip = runSlips.get(emp.employee_id);
      rows.push({
        employeeId: emp.employee_id,
        employeeCode: (emp as any).employee_code,
        fullName: (emp as any).full_name,
        branchId: (emp as any).default_branch_id,
        group: (emp as any).group,
        stage: (emp as any).employment_status,
        rate,
        shifts,
        absentShifts,
        hours: Math.round(hours * 10) / 10,
        salary: slip ? Number((slip as any).net_pay) || 0 : liveNet,
        salarySource: slip ? 'run' : 'live',
        deduction,
        bonus,
      });
    }
    rows.sort((a, b) => b.hours - a.hours || String(a.fullName).localeCompare(String(b.fullName)));
    const worked = rows.filter(r => r.hours > 0);
    const sumBy = (stage: string, key: 'hours' | 'salary') =>
      Math.round(rows.filter(r => r.stage === stage).reduce((s, r) => s + r[key], 0) * 10) / 10;
    const totalHours = Math.round(rows.reduce((s, r) => s + r.hours, 0) * 10) / 10;
    const totalSalary = rows.reduce((s, r) => s + r.salary, 0);
    return {
      period,
      officialCount: rows.filter(r => r.stage === 'OFFICIAL').length,
      probationCount: rows.filter(r => r.stage === 'PROBATION').length,
      zeroHourCount: rows.length - worked.length,
      totalHours,
      totalSalary,
      officialHours: sumBy('OFFICIAL', 'hours'),
      probationHours: sumBy('PROBATION', 'hours'),
      officialSalary: sumBy('OFFICIAL', 'salary'),
      probationSalary: sumBy('PROBATION', 'salary'),
      runStatus,
      top: worked[0] || null,
      bottom: worked[worked.length - 1] || null,
      rows,
    };
  }

  /**
   * Bảng chấm công Finance theo tháng đầy đủ (ngày 1 -> cuối tháng):
   * mỗi nhân viên có tổng ca / đủ / thiếu / vắng / giờ / đơn giá / lương ca
   * (standardPay) / phạt / thưởng / thực nhận + chi tiết từng ca để kế toán
   * tính lương. Đồng bộ cả ca quá khứ lẫn hiện tại, không phụ thuộc tab tuần.
   */
  async getFinanceTimesheet(period: string, branchScope = '*') {
    const { fromDate, toDate, daysInMonth } = monthRange(period);
    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const all = await this.repo.listEmployees({ branch: branchScope });
    const employees = (all || []).filter(
      e => (e as any)?.employment_status !== 'TERMINATED'
    );

    // Đọc kho lưu trữ tuần cũ để ca đầu tháng (đã archive) vẫn lên bảng.
    let archived: any[] = [];
    try {
      archived = await (this.repo as any)?.syncService?.getArchivedAttendanceEvents?.(fromDate, toDate) || [];
    } catch { archived = []; }
    const archivedByAssign = new Map<string, any[]>();
    for (const e of archived || []) {
      const k = String((e as any)?.assignment_id || '');
      if (!k) continue;
      if (!archivedByAssign.has(k)) archivedByAssign.set(k, []);
      archivedByAssign.get(k)!.push(e);
    }

    const rows: any[] = [];
    for (const emp of employees) {
      const empId = (emp as any).employee_id;
      const empShifts = await this.repo.getShiftsForEmployee(empId, fromDate, toDate).catch(() => []);
      const published = (empShifts || []).filter(
        s => (s as any).status === 'PUBLISHED' && String((s as any).date || '').slice(0, 10) >= fromDate && String((s as any).date || '').slice(0, 10) <= toDate
      );
      const rate = Number((emp as any).current_rate_per_hour) || 0;
      let full = 0;
      let partial = 0;
      let absent = 0;
      let hours = 0;
      let standardPay = 0;
      let deduction = 0;
      const details: any[] = [];
      for (const s of published) {
        const date = String((s as any).date || '').slice(0, 10);
        let dayEvents: any[] = [];
        try {
          dayEvents = await this.repo.getAttendanceEvents(empId, date).catch(() => []);
        } catch { dayEvents = []; }
        let mine = (dayEvents || []).filter(
          (e: any) => String(e.assignment_id || '') === String((s as any).assignment_id)
        );
        // Gộp sự kiện kho lưu trữ (tuần cũ đã archive khỏi bảng realtime).
        const extra = archivedByAssign.get(String((s as any).assignment_id)) || [];
        if (extra.length > 0) {
          const ids = new Set(mine.map((e: any) => e.event_id));
          for (const e of extra) if (!ids.has(e.event_id)) mine.push(e);
        }
        const inEvt = mine.find((e: any) => e.type === 'CHECK_IN');
        const hasOut = mine.some((e: any) => e.type === 'CHECK_OUT');
        const hasAbs = mine.some((e: any) => e.type === 'ABSENT');
        const template = (SHIFT_TEMPLATES as any)[(s as any).shift_code];
        const h = template ? Number(template.duration_hours) || 5 : 5;
        const shiftPay = h * rate;
        let status: 'DU' | 'THIEU' | 'VANG' = 'THIEU';
        let lateMin = 0;
        let fineTier = 'NONE';
        let fineAmt = 0;
        if (inEvt && hasOut) {
          lateMin = (inEvt as any).is_late
            ? Number((inEvt as any).minutes_deviation) || 0
            : (() => {
                const st = new Date((s as any).start_at).getTime();
                const ct = new Date((inEvt as any).client_time).getTime();
                if (!Number.isFinite(st) || !Number.isFinite(ct)) return 0;
                return Math.max(0, Math.round((ct - st) / 60000));
              })();
          const storedTier = String((inEvt as any).fine_tier || '');
          const storedAmt = Number((inEvt as any).fine_amount) || 0;
          const useStored = !!storedTier && storedTier !== 'NONE';
          const fine = lateFineFor(lateMin, shiftPay);
          const unpaid = useStored ? storedTier === 'FULL_SHIFT' : fine.unpaid;
          if (unpaid) {
            status = 'VANG';
            absent++;
            fineTier = 'FULL_SHIFT';
            fineAmt = shiftPay;
          } else {
            status = 'DU';
            full++;
            hours += h;
            standardPay += shiftPay;
            fineAmt = useStored ? (storedTier === 'FULL_SHIFT' ? 0 : storedAmt) : fine.deduction;
            fineTier = useStored ? storedTier : fine.tier;
            deduction += fineAmt;
          }
        } else if (!inEvt && hasAbs) {
          status = 'VANG';
          absent++;
          fineTier = 'FULL_SHIFT';
          fineAmt = shiftPay;
        } else if (date < today) {
          // Ca quá khứ thiếu 1 lượt: tính thiếu (chờ bổ sung/trừ vắng ở kỳ lương).
          status = 'THIEU';
          partial++;
        } else {
          status = 'THIEU';
          partial++;
        }
        details.push({
          date,
          assignmentId: (s as any).assignment_id,
          shiftCode: (s as any).shift_code,
          branchId: (s as any).branch_id,
          hours: h,
          rate,
          shiftPay,
          status,
          lateMin,
          fineTier,
          fineAmount: fineAmt,
          checkIn: inEvt ? (inEvt as any).client_time : null,
          hasOut,
        });
      }
      details.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      // Thưởng nhường ca HR điều phối đã duyệt trong kỳ.
      let bonus = 0;
      try {
        const swaps = await this.repo.listSwapRequests(empId).catch(() => []);
        bonus = (swaps || [])
          .filter(
            (sw: any) =>
              sw?.swap_kind === 'HR_DISPATCH' &&
              sw?.status === 'APPROVED' &&
              sw?.target_employee_id === empId &&
              String(sw?.approved_at || '').startsWith(period)
          )
          .reduce((sum: number, sw: any) => sum + (Number(sw?.bonus_amount) || 30000), 0);
      } catch { /* giữ 0 */ }
      rows.push({
        employeeId: empId,
        employeeCode: (emp as any).employee_code,
        fullName: (emp as any).full_name,
        branchId: (emp as any).default_branch_id,
        stage: (emp as any).employment_status,
        group: (emp as any).group,
        rate,
        totalShifts: published.length,
        full,
        partial,
        absent,
        hours: Math.round(hours * 10) / 10,
        standardPay,
        deduction,
        bonus,
        netPay: standardPay + bonus - deduction,
        shifts: details,
      });
    }
    rows.sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || ''), 'vi'));
    const sum = (k: string) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    return {
      period,
      fromDate,
      toDate,
      daysInMonth,
      branchScope,
      totals: {
        employees: rows.length,
        totalShifts: sum('totalShifts'),
        full: sum('full'),
        partial: sum('partial'),
        absent: sum('absent'),
        hours: Math.round(sum('hours') * 10) / 10,
        standardPay: sum('standardPay'),
        deduction: sum('deduction'),
        bonus: sum('bonus'),
        netPay: sum('netPay'),
      },
      rows,
    };
  }
}
