import { MockSheetsAdapter } from '../../repositories/mock-sheets.adapter.js';
import { EVDriverPayroll, EVShift, EVShiftCheckin, EVPayrollConfig, DEFAULT_EV_PAYROLL_CONFIG, EVRouteStop } from '@ubm/shared';
import { EVRouteService } from './ev-route.service.js';
import { isShiftWorked } from './ev-shift-activity.js';
import { isEvTestShift } from './ev-test-mode.js';

/**
 * Kết quả 1 lượt đồng bộ lương tài xế từ dữ liệu App Tài Xế.
 * `changed` = có thay đổi số tiền/ngày công → caller nên broadcast realtime.
 */
export interface EVPayrollSyncResult {
  payroll: EVDriverPayroll | null;
  changed: boolean;
  skipped:
    | ''
    | 'SHIFT_NOT_FOUND'
    | 'TEST_SHIFT'
    | 'INVALID_PERIOD'
    | 'NOT_CREATED'
    | 'LOCKED';
}

export interface EVPayrollSyncOptions {
  /**
   * Tạo bảng lương nếu kỳ này chưa có bản ghi. Chỉ nên bật khi tài xế
   * THỰC SỰ hoạt động (bắt đầu ca / check-in / kết thúc ca) — tránh sinh
   * hàng loạt dòng 0đ ngay khi Admin vừa xếp lịch.
   */
  createIfMissing?: boolean;
  /** Nguồn phát sinh, dùng cho log: driver-app | admin-shift | explanation | ... */
  source?: string;
  /** Người thao tác (employee_id / tài khoản). */
  actorId?: string;
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export class EVPayrollService {
  constructor(
    private readonly repo: MockSheetsAdapter,
    private readonly config: EVPayrollConfig = DEFAULT_EV_PAYROLL_CONFIG,
    private readonly routes?: EVRouteService,
  ) {}

  /** Tính bảng lương cho 1 tài xế trong 1 kỳ */
  async calculateDriverPayroll(driverId: string, period: string): Promise<EVDriverPayroll> {
    const driver = this.repo.employees.find(e => e.employee_id === driverId);
    if (!driver) throw new Error('DRIVER_NOT_FOUND');

    // Get shifts in period
    const [year, month] = period.split('-').map(Number);
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0).toISOString().slice(0, 10); // Last day of month

    const allShifts = this.repo.evShifts.filter(s =>
      s.driver_id === driverId &&
      s.shift_date >= startDate &&
      s.shift_date <= endDate &&
      s.status !== 'CANCELLED'
    );
    // Ca chạy ở chế độ TEST (Admin bật nút Test) KHÔNG tính công, không tính
    // phạt — tránh ảnh hưởng lương tài xế khi chạy thử quy trình.
    const shifts = allShifts.filter(s => !isEvTestShift(s));

    // Get checkins for these shifts
    const shiftIds = new Set(shifts.map(s => s.shift_id));
    const checkins = this.repo.evShiftCheckins.filter(c => shiftIds.has(c.shift_id));
    const checkinCountByShift = new Map<string, number>();
    for (const c of checkins) {
      checkinCountByShift.set(c.shift_id, (checkinCountByShift.get(c.shift_id) || 0) + 1);
    }

    // Chỉ ngày tài xế THỰC SỰ HOẠT ĐỘNG mới được tính công.
    // Ca đã xếp lịch nhưng không bắt đầu ca và không check-in → không tính lương.
    const workedShifts = shifts.filter(s => isShiftWorked(s, checkinCountByShift.get(s.shift_id) || 0));
    const absentShifts = shifts.filter(s => !isShiftWorked(s, checkinCountByShift.get(s.shift_id) || 0));

    // Calculate work days
    const workDays = workedShifts.length;
    const standardDays = Math.min(workDays, this.config.standard_work_days);
    const extraDays = Math.max(0, workDays - this.config.standard_work_days);

    // Base pay
    const standardPay = standardDays * this.config.standard_daily_rate;
    const extraPay = extraDays * this.config.extra_daily_rate;
    const grossPay = standardPay + extraPay;

    // Calculate penalties
    let totalPenaltyAmount = 0;
    const penaltyBreakdown = {
      missed_checkins: 0,
      late_sla: 0,
      details: [] as Array<{
        date: string;
        stop_name?: string;
        leg?: string;
        type: 'MISSED_CHECKIN' | 'LATE_SLA';
        amount: number;
        late_minutes?: number;
      }>,
    };

    for (const shift of workedShifts) {
      const isExtraDay = (shift.work_day_index || 0) > this.config.standard_work_days;
      const dailyRate = isExtraDay ? this.config.extra_daily_rate : this.config.standard_daily_rate;
      const missedPenaltyRate = isExtraDay ? this.config.penalty_per_missed_checkin.extra : this.config.penalty_per_missed_checkin.standard;
      const latePenaltyRate = isExtraDay ? this.config.penalty_per_late_sla.extra : this.config.penalty_per_late_sla.standard;

      const shiftCheckins = checkins.filter(c => c.shift_id === shift.shift_id);
      const effectiveStops = this.routes
        ? await this.routes.getEffectiveStopsForShift(shift)
        : this.repo.evRouteStops
          .filter(s => s.route_id === shift.route_id)
          .sort((a, b) => a.stop_order - b.stop_order);

      for (const checkin of shiftCheckins) {
        const stop = effectiveStops.find(s => s.stop_id === checkin.stop_id)
          || this.repo.evRouteStops.find(s => s.stop_id === checkin.stop_id);
        const stopName = checkin.stop_name || stop?.name;

        if (checkin.is_missed) {
          const penalty = Math.round(dailyRate * missedPenaltyRate);
          totalPenaltyAmount += penalty;
          penaltyBreakdown.missed_checkins++;
          penaltyBreakdown.details.push({
            date: shift.shift_date,
            stop_name: stopName,
            type: 'MISSED_CHECKIN',
            amount: penalty,
          });
        } else if (checkin.is_late) {
          // Chỉ tính phạt trễ khi điểm ĐÃ được chấm (không tính chồng lên phạt
          // bỏ lọt — dữ liệu cũ từng đánh dấu is_late=true cho điểm bỏ lọt).
          const penalty = Math.round(dailyRate * latePenaltyRate);
          totalPenaltyAmount += penalty;
          penaltyBreakdown.late_sla++;
          penaltyBreakdown.details.push({
            date: shift.shift_date,
            leg: `${this.getPrevStopName(shift, checkin, effectiveStops)} → ${stopName}`,
            type: 'LATE_SLA',
            amount: penalty,
            late_minutes: checkin.late_minutes,
          });
        }
      }
    }

    const netPay = Math.max(0, grossPay - totalPenaltyAmount);

    const now = new Date().toISOString();
    const payroll: EVDriverPayroll = {
      payroll_id: `PR_${driverId}_${period.replace('-', '')}_${Date.now().toString(36)}`,
      driver_id: driverId,
      period,
      total_shifts: shifts.length,
      worked_shifts: workDays,
      total_work_days: workDays,
      standard_days: standardDays,
      extra_days: extraDays,
      absent_days: absentShifts.length,
      absent_dates: absentShifts.map(s => s.shift_date).sort(),
      standard_pay: standardPay,
      extra_pay: extraPay,
      total_penalty_points: penaltyBreakdown.missed_checkins + penaltyBreakdown.late_sla,
      total_penalty_amount: totalPenaltyAmount,
      penalty_breakdown: penaltyBreakdown,
      gross_pay: grossPay,
      net_pay: netPay,
      status: 'DRAFT',
      created_by: 'SYSTEM',
      created_at: now,
      updated_at: now,
    };

    return payroll;
  }

  /** Tính bảng lương cho tất cả tài xế trong 1 kỳ */
  async calculateAllDriversPayroll(period: string): Promise<EVDriverPayroll[]> {
    const drivers = this.repo.employees.filter(e =>
      e.group === 'XUONG' && // Or a specific group for drivers
      e.employment_status !== 'TERMINATED'
    );

    const results: EVDriverPayroll[] = [];
    for (const driver of drivers) {
      try {
        const payroll = await this.calculateDriverPayroll(driver.employee_id, period);
        results.push(payroll);
      } catch (err) {
        console.warn(`[ev-payroll] Failed to calculate for driver ${driver.employee_id}:`, err);
      }
    }

    return results;
  }

  /** Lưu bảng lương (upsert theo tài xế + kỳ lương) */
  async savePayroll(payroll: EVDriverPayroll): Promise<EVDriverPayroll> {
    const existing = this.repo.evDriverPayroll.find(p => p.payroll_id === payroll.payroll_id)
      || this.repo.evDriverPayroll.find(p => p.driver_id === payroll.driver_id && p.period === payroll.period);
    if (existing) {
      // Bảng lương đã duyệt/đã trả là SNAPSHOT chốt sổ — không được để một lượt
      // tính lại tự ý đổi số tiền. Kế toán muốn tính lại phải mở kỳ trước.
      if (existing.status === 'APPROVED' || existing.status === 'PAID') return { ...existing };
      return this.repo.updateEVDriverPayroll(existing.payroll_id, this.financialPatch(payroll));
    }
    // Ghi qua repo để persist xuống ev_driver_payroll.
    return this.repo.createEVDriverPayroll(payroll as Partial<EVDriverPayroll>);
  }

  // ============================================================
  // ĐỒNG BỘ REALTIME TỪ APP TÀI XẾ → KẾ TOÁN
  // ============================================================

  /**
   * Tính lại bảng lương của 1 tài xế theo kỳ từ dữ liệu MỚI NHẤT của App Tài Xế
   * (ca, check-in, điểm bỏ lọt, trễ SLA, phiếu giải trình đã duyệt).
   *
   * - Chưa có bản ghi + `createIfMissing` → tạo ngay (DRAFT) khi tài xế đã có
   *   ít nhất 1 ngày công thực tế.
   * - Có bản ghi DRAFT → cập nhật số liệu, giữ nguyên payroll_id/trạng thái.
   * - Có bản ghi APPROVED/PAID → KHÔNG sửa (đã chốt), trả `skipped: LOCKED`.
   */
  async syncDriverPeriod(
    driverId: string,
    period: string,
    opts: EVPayrollSyncOptions = {},
  ): Promise<EVPayrollSyncResult> {
    const id = String(driverId || '').trim();
    const p = String(period || '').trim();
    if (!id || !PERIOD_RE.test(p)) {
      return { payroll: null, changed: false, skipped: 'INVALID_PERIOD' };
    }

    const existing = this.repo.evDriverPayroll.find(
      x => x.driver_id === id && x.period === p,
    ) || null;
    if (existing && (existing.status === 'APPROVED' || existing.status === 'PAID')) {
      return { payroll: { ...existing }, changed: false, skipped: 'LOCKED' };
    }
    if (!existing && !opts.createIfMissing) {
      return { payroll: null, changed: false, skipped: 'NOT_CREATED' };
    }

    const calculated = await this.calculateDriverPayroll(id, p);
    // Không sinh dòng 0đ cho tài xế chỉ được xếp lịch mà chưa từng hoạt động.
    if (!existing && Number(calculated.total_work_days || 0) === 0) {
      return { payroll: null, changed: false, skipped: 'NOT_CREATED' };
    }

    if (!existing) {
      try {
        const created = await this.repo.createEVDriverPayroll(calculated as Partial<EVDriverPayroll>);
        return { payroll: created, changed: true, skipped: '' };
      } catch (err: any) {
        // 2 request đồng thời cùng tạo (check-in + end shift) → đọc lại và cập nhật.
        if (!String(err?.message || '').startsWith('PAYROLL_EXISTS')) throw err;
        const raced = this.repo.evDriverPayroll.find(x => x.driver_id === id && x.period === p);
        if (!raced) throw err;
        if (raced.status === 'APPROVED' || raced.status === 'PAID') {
          return { payroll: { ...raced }, changed: false, skipped: 'LOCKED' };
        }
        const merged = await this.repo.updateEVDriverPayroll(raced.payroll_id, this.financialPatch(calculated));
        return { payroll: merged, changed: true, skipped: '' };
      }
    }

    if (!this.payrollChanged(existing, calculated)) {
      return { payroll: { ...existing }, changed: false, skipped: '' };
    }
    const updated = await this.repo.updateEVDriverPayroll(
      existing.payroll_id,
      this.financialPatch(calculated),
    );
    return { payroll: updated, changed: true, skipped: '' };
  }

  /** Đồng bộ theo 1 ca (tự bỏ qua ca TEST, tự lấy đúng kỳ của ngày ca). */
  async syncFromShift(
    shiftId: string,
    opts: EVPayrollSyncOptions = {},
  ): Promise<EVPayrollSyncResult> {
    const shift = this.repo.evShifts.find(s => String(s.shift_id) === String(shiftId));
    if (!shift) return { payroll: null, changed: false, skipped: 'SHIFT_NOT_FOUND' };
    // Ca chạy ở chế độ TEST không tính công/phạt → không có gì để đồng bộ.
    if (isEvTestShift(shift)) return { payroll: null, changed: false, skipped: 'TEST_SHIFT' };
    const period = String(shift.shift_date || '').slice(0, 7);
    return this.syncDriverPeriod(shift.driver_id, period, opts);
  }

  /** Đồng bộ nhiều ca (dedupe theo tài xế + kỳ) — dùng khi duyệt phiếu giải trình. */
  async syncFromShifts(
    shiftIds: string[],
    opts: EVPayrollSyncOptions = {},
  ): Promise<EVPayrollSyncResult[]> {
    const keys = new Set<string>();
    const results: EVPayrollSyncResult[] = [];
    for (const shiftId of shiftIds || []) {
      const shift = this.repo.evShifts.find(s => String(s.shift_id) === String(shiftId));
      if (!shift) continue;
      if (isEvTestShift(shift)) continue;
      const period = String(shift.shift_date || '').slice(0, 7);
      const key = `${shift.driver_id}|${period}`;
      if (keys.has(key)) continue;
      keys.add(key);
      results.push(await this.syncDriverPeriod(shift.driver_id, period, opts));
    }
    return results;
  }

  /**
   * Bảo đảm mọi tài xế có ca thực tế trong kỳ đều có bảng lương mới nhất.
   * Dùng cho màn Kế toán: mở tab là thấy số realtime, không cần bấm "Tính lương".
   */
  async ensurePayrollRowsForPeriod(period: string): Promise<EVDriverPayroll[]> {
    const p = String(period || '').trim();
    if (!PERIOD_RE.test(p)) return this.listPayrollByPeriod(p);
    const driverIds = new Set<string>();
    for (const s of this.repo.evShifts) {
      if (String(s.shift_date || '').slice(0, 7) !== p) continue;
      if (s.status === 'CANCELLED' || isEvTestShift(s)) continue;
      driverIds.add(String(s.driver_id));
    }
    for (const id of driverIds) {
      try { await this.syncDriverPeriod(id, p, { createIfMissing: true, source: 'ensure-period' }); }
      catch (err: any) { console.warn(`[ev-payroll] ensure ${id}/${p}:`, err?.message || err); }
    }
    return this.listPayrollByPeriod(p);
  }

  /** Các trường số liệu được phép ghi đè khi đồng bộ (không đụng trạng thái/duyệt). */
  private financialPatch(payroll: EVDriverPayroll): Partial<EVDriverPayroll> {
    return {
      total_shifts: payroll.total_shifts,
      worked_shifts: payroll.worked_shifts,
      total_work_days: payroll.total_work_days,
      absent_days: payroll.absent_days,
      absent_dates: payroll.absent_dates,
      standard_days: payroll.standard_days,
      extra_days: payroll.extra_days,
      standard_pay: payroll.standard_pay,
      extra_pay: payroll.extra_pay,
      total_penalty_points: payroll.total_penalty_points,
      total_penalty_amount: payroll.total_penalty_amount,
      penalty_breakdown: payroll.penalty_breakdown,
      gross_pay: payroll.gross_pay,
      net_pay: payroll.net_pay,
    };
  }

  /** So sánh số liệu tài chính để tránh broadcast khi không có gì đổi. */
  private payrollChanged(current: EVDriverPayroll, next: EVDriverPayroll): boolean {
    const a = this.financialPatch(current);
    const b = this.financialPatch(next);
    return JSON.stringify(a) !== JSON.stringify(b);
  }

  /** Lấy bảng lương đã lưu */
  async getPayroll(driverId: string, period: string): Promise<EVDriverPayroll | null> {
    return this.repo.evDriverPayroll.find(p => p.driver_id === driverId && p.period === period) || null;
  }

  /** Lấy danh sách bảng lương kỳ */
  async listPayrollByPeriod(period: string): Promise<EVDriverPayroll[]> {
    return this.repo.evDriverPayroll.filter(p => p.period === period);
  }

  /** Duyệt bảng lương */
  async approvePayroll(payrollId: string, approvedBy: string): Promise<EVDriverPayroll | null> {
    const idx = this.repo.evDriverPayroll.findIndex(p => p.payroll_id === payrollId);
    if (idx === -1) return null;
    return this.repo.updateEVDriverPayroll(payrollId, {
      status: 'APPROVED',
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
    });
  }

  /** Xuất dữ liệu cho PayslipItem (tích hợp payroll hiện có) */
  toPayslipItem(payroll: EVDriverPayroll) {
    const driver = this.repo.employees.find(e => e.employee_id === payroll.driver_id);
    return {
      item_id: payroll.payroll_id,
      run_id: `EV_${payroll.period}`,
      employee_id: payroll.driver_id,
      employee_code: driver?.employee_code || '',
      full_name: driver?.full_name || '',
      period: payroll.period,
      total_shifts: payroll.total_shifts,
      standard_hours: payroll.total_shifts * 8, // Estimated
      rate_snapshot: payroll.standard_pay / Math.max(1, payroll.total_work_days),
      standard_pay: payroll.gross_pay,
      allowance: 0,
      bonus: 0,
      deduction: payroll.total_penalty_amount,
      net_pay: payroll.net_pay,
      tong_cong: payroll.gross_pay,
      tong_luong: payroll.gross_pay - payroll.total_penalty_amount,
      thuc_lanh: payroll.net_pay,
      status: payroll.status === 'PAID' ? 'PAID' : 'DRAFT',
      input_note: JSON.stringify(payroll.penalty_breakdown),
      created_at: payroll.created_at,
      updated_at: payroll.updated_at,
    };
  }

  private getPrevStopName(shift: EVShift, checkin: EVShiftCheckin, stops?: EVRouteStop[]): string {
    if (checkin.stop_order <= 1) return 'Xuất phát';
    const list = stops || this.repo.evRouteStops
      .filter(s => s.route_id === shift.route_id)
      .sort((a, b) => a.stop_order - b.stop_order);
    const prevStop = list.find(s => s.stop_order === checkin.stop_order - 1);
    return prevStop?.name || 'Điểm trước';
  }
}