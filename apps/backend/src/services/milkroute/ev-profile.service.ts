/**
 * EVDriverProfileService — hồ sơ + thống kê riêng cho TÀI KHOẢN TÀI XẾ.
 *
 * Tài khoản tài xế khác hoàn toàn tài khoản các khối khác:
 *  - Không dùng lịch hành chính / nghỉ phép / đổi ca / chấm công văn phòng.
 *  - "Công" của tài xế = CA VẬN CHUYỂN + các điểm giao đã xác nhận.
 *  - Thu nhập = bảng lương tài xế (EVDriverPayroll), không phải bảng lương văn phòng.
 *
 * Một nhân viên được xem là tài xế khi có ít nhất một trong các dấu hiệu:
 *  - được gán xe điện (evVehicles.assigned_driver_id)
 *  - đã/đang có ca vận chuyển (evShifts.driver_id)
 *  - đã có bảng lương tài xế (evDriverPayroll.driver_id)
 * Nhờ vậy không cần thêm cột mới vào NHAN_VIEN_MASTER (an toàn với Google Sheets).
 */

import { DEFAULT_EV_PAYROLL_CONFIG } from '@ubm/shared';
import type { MockSheetsAdapter } from '../../repositories/mock-sheets.adapter.js';
import type { EVRouteService } from './ev-route.service.js';
import type { EVPayrollService } from './ev-payroll.service.js';

const VN_OFFSET_MS = 7 * 3_600_000;

function todayVN(): string {
  return new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

export interface DriverHistoryOptions {
  from?: string;
  to?: string;
  limit?: number;
}

export class EVDriverProfileService {
  constructor(
    private readonly repo: MockSheetsAdapter,
    private readonly routes: EVRouteService,
    private readonly payroll: EVPayrollService,
  ) {}

  /** Có dấu hiệu là tài xế hay không (xe được gán / có ca / có bảng lương). */
  hasDriverSignal(employeeId: string): boolean {
    const id = String(employeeId || '').trim();
    if (!id) return false;
    const repo: any = this.repo as any;
    const shifts: any[] = Array.isArray(repo.evShifts) ? repo.evShifts : [];
    const vehicles: any[] = Array.isArray(repo.evVehicles) ? repo.evVehicles : [];
    const payrolls: any[] = Array.isArray(repo.evDriverPayroll) ? repo.evDriverPayroll : [];
    return (
      shifts.some((s) => String(s.driver_id) === id)
      || vehicles.some((v) => String(v.assigned_driver_id || '') === id)
      || payrolls.some((p) => String(p.driver_id) === id)
    );
  }

  /** Hồ sơ đầy đủ cho app tài xế (1 call duy nhất lúc đăng nhập). */
  async getProfile(employeeId: string): Promise<any> {
    const id = String(employeeId || '').trim();
    const employee: any = (this.repo.employees || []).find(
      (e: any) => String(e.employee_id) === id,
    );
    if (!employee) throw new Error('DRIVER_NOT_FOUND: Tài khoản không gắn với nhân viên');

    const isDriver = this.hasDriverSignal(id);
    const period = todayVN().slice(0, 7);
    const day = todayVN();
    const repo: any = this.repo as any;

    const allShifts: any[] = (Array.isArray(repo.evShifts) ? repo.evShifts : [])
      .filter((s: any) => String(s.driver_id) === id)
      .sort((a: any, b: any) =>
        String(b.shift_date).localeCompare(String(a.shift_date))
        || String(b.planned_start_at).localeCompare(String(a.planned_start_at)));

    const vehicle: any = (Array.isArray(repo.evVehicles) ? repo.evVehicles : [])
      .find((v: any) => String(v.assigned_driver_id || '') === id) || null;

    const currentShift = isDriver ? await this.currentShift(id) : null;
    const todayShifts = allShifts.filter((s: any) => String(s.shift_date) === day);

    const stats = await this.monthStats(id, period, allShifts);
    const payroll = isDriver
      ? await this.payroll
        .getPayroll(id, period)
        .catch(() => null)
        .then((p) => p || this.estimatePayroll(id, period))
      : null;

    return {
      is_driver: isDriver,
      driver: {
        employee_id: employee.employee_id,
        employee_code: employee.employee_code,
        full_name: employee.full_name,
        phone: employee.phone_normalized || employee.phone || '',
        group: employee.group,
        branch: employee.default_branch_id,
        employment_status: employee.employment_status,
        start_date: employee.start_date || '',
      },
      vehicle: vehicle
        ? {
          vehicle_id: vehicle.vehicle_id,
          license_plate: vehicle.license_plate,
          frame_number: vehicle.frame_number || '',
          battery_capacity_kwh: vehicle.battery_capacity_kwh ?? null,
          current_battery_pct: Number(vehicle.current_battery_pct ?? 0),
          status: vehicle.status,
          gps_device_id: vehicle.gps_device_id || '',
        }
        : null,
      current_shift: currentShift,
      today_shifts: todayShifts,
      period,
      stats,
      payroll,
      config: {
        standard_monthly_salary: DEFAULT_EV_PAYROLL_CONFIG.standard_monthly_salary,
        standard_work_days: DEFAULT_EV_PAYROLL_CONFIG.standard_work_days,
        standard_daily_rate: DEFAULT_EV_PAYROLL_CONFIG.standard_daily_rate,
        extra_monthly_salary: DEFAULT_EV_PAYROLL_CONFIG.extra_monthly_salary,
        extra_work_days: DEFAULT_EV_PAYROLL_CONFIG.extra_work_days,
        extra_daily_rate: DEFAULT_EV_PAYROLL_CONFIG.extra_daily_rate,
        penalty_missed_pct: DEFAULT_EV_PAYROLL_CONFIG.penalty_per_missed_checkin.standard,
        penalty_late_pct: DEFAULT_EV_PAYROLL_CONFIG.penalty_per_late_sla.standard,
      },
    };
  }

  /** Lịch sử ca của tài xế (mặc định 60 ngày gần nhất) — tab "Tôi". */
  async getHistory(employeeId: string, opts: DriverHistoryOptions = {}): Promise<any[]> {
    const id = String(employeeId || '').trim();
    const repo: any = this.repo as any;
    const to = String(opts.to || '').trim() || todayVN();
    const from = String(opts.from || '').trim()
      || new Date(Date.parse(`${to}T00:00:00Z`) - 59 * 86_400_000).toISOString().slice(0, 10);
    const limit = Math.min(Math.max(Number(opts.limit) || 60, 1), 180);

    const shifts: any[] = (Array.isArray(repo.evShifts) ? repo.evShifts : [])
      .filter((s: any) => String(s.driver_id) === id)
      .filter((s: any) => String(s.shift_date) >= from && String(s.shift_date) <= to)
      .sort((a: any, b: any) =>
        String(b.shift_date).localeCompare(String(a.shift_date))
        || String(b.planned_start_at).localeCompare(String(a.planned_start_at)))
      .slice(0, limit);

    const out: any[] = [];
    for (const s of shifts) {
      const summary = await this.shiftSummary(s).catch(() => null);
      out.push(summary || s);
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Nội bộ
  // ------------------------------------------------------------------

  private async currentShift(driverId: string): Promise<any | null> {
    const repo: any = this.repo as any;
    const today = todayVN();
    const shifts: any[] = (Array.isArray(repo.evShifts) ? repo.evShifts : [])
      .filter((s: any) =>
        String(s.driver_id) === driverId
        && String(s.shift_date) >= today
        && s.status !== 'CANCELLED')
      .sort((a: any, b: any) =>
        String(a.shift_date).localeCompare(String(b.shift_date))
        || String(a.planned_start_at).localeCompare(String(b.planned_start_at)));
    return shifts[0] || null;
  }

  private async shiftSummary(shift: any): Promise<any> {
    const repo: any = this.repo as any;
    const checkins: any[] = (Array.isArray(repo.evShiftCheckins) ? repo.evShiftCheckins : [])
      .filter((c: any) => String(c.shift_id) === String(shift.shift_id));
    let stopsTotal = 0;
    try {
      const stops = await this.routes.getEffectiveStopsForShift(shift);
      stopsTotal = stops.length;
    } catch {
      stopsTotal = (Array.isArray(repo.evRouteStops) ? repo.evRouteStops : [])
        .filter((s: any) => String(s.route_id) === String(shift.route_id)).length;
    }
    const done = checkins.filter((c: any) => !c.is_missed).length;
    return {
      ...shift,
      stops_total: stopsTotal,
      stops_done: done,
      late_count: checkins.filter((c: any) => c.is_late).length,
      missed_count: checkins.filter((c: any) => c.is_missed).length,
    };
  }

  private async monthStats(driverId: string, period: string, allShifts: any[]): Promise<any> {
    const repo: any = this.repo as any;
    const monthShifts = allShifts.filter((s: any) =>
      String(s.shift_date).slice(0, 7) === period && s.status !== 'CANCELLED');
    const ids = new Set(monthShifts.map((s: any) => String(s.shift_id)));
    const checkins: any[] = (Array.isArray(repo.evShiftCheckins) ? repo.evShiftCheckins : [])
      .filter((c: any) => ids.has(String(c.shift_id)));

    let stopsTotal = 0;
    for (const s of monthShifts) {
      try {
        const stops = await this.routes.getEffectiveStopsForShift(s);
        stopsTotal += stops.length;
      } catch {
        stopsTotal += (Array.isArray(repo.evRouteStops) ? repo.evRouteStops : [])
          .filter((x: any) => String(x.route_id) === String(s.route_id)).length;
      }
    }

    const done = checkins.filter((c: any) => !c.is_missed).length;
    const late = checkins.filter((c: any) => c.is_late).length;
    const missed = checkins.filter((c: any) => c.is_missed).length;
    const distance = monthShifts.reduce((n: number, s: any) => n + Number(s.total_distance_km || 0), 0);
    const duration = monthShifts.reduce((n: number, s: any) => n + Number(s.total_duration_min || 0), 0);
    const penaltyAmount = monthShifts.reduce((n: number, s: any) => n + Number(s.penalty_amount || 0), 0);
    const penaltyPoints = monthShifts.reduce((n: number, s: any) => n + Number(s.penalty_points || 0), 0);
    const completed = monthShifts.filter((s: any) => s.status === 'COMPLETED').length;

    return {
      period,
      shifts_total: monthShifts.length,
      shifts_completed: completed,
      work_days: monthShifts.length,
      stops_total: stopsTotal,
      stops_done: done,
      late_count: late,
      missed_count: missed,
      on_time_rate: done > 0 ? Math.round(((done - late) / done) * 100) : null,
      distance_km: Math.round(distance * 10) / 10,
      duration_min: Math.round(duration),
      penalty_points: penaltyPoints,
      penalty_amount: penaltyAmount,
      today_shift: monthShifts.find((s: any) => String(s.shift_date) === todayVN()) || null,
    };
  }

  /** Chưa chốt bảng lương kỳ này → tạm tính bằng chính công thức của Kế toán. */
  private async estimatePayroll(driverId: string, period: string): Promise<any | null> {
    try {
      const p = await this.payroll.calculateDriverPayroll(driverId, period);
      return { ...p, status: 'ESTIMATED' };
    } catch {
      return null;
    }
  }
}
