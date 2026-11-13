import { MockSheetsAdapter } from '../../repositories/mock-sheets.adapter.js';
import { EVDriverPayroll, EVShift, EVShiftCheckin, EVPayrollConfig, DEFAULT_EV_PAYROLL_CONFIG, EVRouteStop } from '@ubm/shared';
import { EVRouteService } from './ev-route.service.js';
import { isShiftWorked } from './ev-shift-activity.js';

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

    const shifts = this.repo.evShifts.filter(s =>
      s.driver_id === driverId &&
      s.shift_date >= startDate &&
      s.shift_date <= endDate &&
      s.status !== 'CANCELLED'
    );

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
        }

        if (checkin.is_late) {
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
      return this.repo.updateEVDriverPayroll(existing.payroll_id, payroll);
    }
    // Ghi qua repo để persist xuống ev_driver_payroll.
    return this.repo.createEVDriverPayroll(payroll as Partial<EVDriverPayroll>);
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