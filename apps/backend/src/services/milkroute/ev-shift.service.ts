import { MockSheetsAdapter } from '../../repositories/mock-sheets.adapter.js';
import { EVShift, EVRouteStop, EVRoute, EVVehicle } from '@ubm/shared';
import { EVRouteService } from './ev-route.service.js';

const VN_OFFSET_MS = 7 * 3_600_000;

/** Ngày hôm nay theo giờ Việt Nam (YYYY-MM-DD). */
function vnToday(): string {
  return new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Cộng/trừ ngày trên chuỗi YYYY-MM-DD (không phụ thuộc múi giờ máy chủ). */
function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Thứ Hai của tuần chứa `day`. */
function mondayOf(day: string): string {
  const dow = new Date(Date.parse(`${day}T00:00:00Z`)).getUTCDay(); // 0 = CN
  return addDays(day, -((dow + 6) % 7));
}

/** 'YYYY-MM-DD' + 'HH:MM' (giờ VN) → ISO timestamp. */
function vnDateTimeToIso(day: string, time: string): string {
  return new Date(`${day}T${time}:00+07:00`).toISOString();
}

export interface GenerateWeekInput {
  /** Ngày bất kỳ trong tuần cần tạo (mặc định tuần hiện tại). */
  weekStart?: string;
  /** Danh sách tài xế; bỏ trống = mọi nhân sự khối Xưởng còn làm việc. */
  driverIds?: string[];
  routeId?: string;
  /** Chỉ dùng khi tạo cho đúng 1 tài xế; nhiều tài xế thì lấy xe được gán. */
  vehicleId?: string;
  /** Giờ bắt đầu mặc định 08:00 (giờ VN). */
  startTime?: string;
  /** Giờ kết thúc mặc định 14:00 (giờ VN). */
  endTime?: string;
  createdBy?: string;
  /** Có tạo bù cho những ngày đã qua trong tuần hay không (mặc định không). */
  includePast?: boolean;
  /**
   * true  = chỉ bổ sung ngày còn thiếu (nút "Tạo ca tuần" của admin).
   * false = chỉ tạo khi tài xế CHƯA có ca nào trong tuần (chạy tự động), nhờ
   *         vậy ca admin đã xóa/chỉnh không bị tạo lại ngoài ý muốn.
   */
  fillMissing?: boolean;
  /** Các thứ cần tạo: 1=T2 … 6=T7, 0=CN. Mặc định T2 → T7. */
  days?: number[];
}

export interface GenerateWeekResult {
  week_start: string;
  week_end: string;
  created: EVShift[];
  skipped: Array<{ driver_id: string; shift_date: string; reason: string }>;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class EVShiftService {
  constructor(
    private readonly repo: MockSheetsAdapter,
    private readonly routes?: EVRouteService,
  ) {}

  /** Điểm dừng hiệu lực của ca (áp phiếu đổi lộ trình nếu có). */
  private async stopsForShift(shift: EVShift): Promise<EVRouteStop[]> {
    if (this.routes) return this.routes.getEffectiveStopsForShift(shift);
    return this.repo.evRouteStops
      .filter(s => s.route_id === shift.route_id)
      .sort((a, b) => a.stop_order - b.stop_order);
  }

  /** Tạo ca vận chuyển mới */
  async createShift(input: {
    routeId: string;
    driverId: string;
    vehicleId: string;
    shiftDate: string;           // YYYY-MM-DD
    plannedStartAt: string;      // ISO timestamp
    plannedEndAt?: string;
    productName?: string;        // Sản phẩm của ca (chọn phiếu đổi lộ trình phù hợp)
    workDayIndex?: number;       // Ngày công thứ mấy trong tháng
    notes?: string;
    createdBy: string;
  }): Promise<EVShift> {
    // Validate route
    const route = this.repo.evRoutes.find(r => r.route_id === input.routeId);
    if (!route) throw new Error('ROUTE_NOT_FOUND');

    // Validate vehicle
    const vehicle = this.repo.evVehicles.find(v => v.vehicle_id === input.vehicleId);
    if (!vehicle) throw new Error('VEHICLE_NOT_FOUND');

    // Validate driver
    const driver = this.repo.employees.find(e => e.employee_id === input.driverId);
    if (!driver) throw new Error('DRIVER_NOT_FOUND');

    // Ghi qua repo để kiểm tra trùng ca + persist xuống ev_shifts.
    return this.repo.createEVShift({
      route_id: input.routeId,
      driver_id: input.driverId,
      vehicle_id: input.vehicleId,
      shift_date: input.shiftDate,
      planned_start_at: input.plannedStartAt,
      planned_end_at: input.plannedEndAt,
      product_name: String(input.productName || '').trim() || undefined,
      work_day_index: input.workDayIndex,
      notes: input.notes,
      created_by: input.createdBy,
    });
  }

  /** Cập nhật ca vận chuyển */
  async updateShift(shiftId: string, input: Partial<Omit<EVShift, 'shift_id' | 'created_at' | 'version'>>): Promise<EVShift | null> {
    const current = this.repo.evShifts.find(s => s.shift_id === shiftId);
    if (!current) return null;

    // Đổi ngày/tài xế/xe → kiểm tra trùng như lúc tạo ca (bỏ qua ca đã hủy).
    const nextDate = String(input.shift_date ?? current.shift_date);
    const nextDriver = String(input.driver_id ?? current.driver_id);
    const nextVehicle = String(input.vehicle_id ?? current.vehicle_id);
    const nextStatus = String(input.status ?? current.status);
    if (nextStatus !== 'CANCELLED') {
      const dupDriver = this.repo.evShifts.find(s => s.shift_id !== shiftId
        && s.driver_id === nextDriver && s.shift_date === nextDate && s.status !== 'CANCELLED');
      if (dupDriver) throw new Error('DRIVER_HAS_SHIFT: Tài xế đã có ca vào ngày này');
      const dupVehicle = this.repo.evShifts.find(s => s.shift_id !== shiftId
        && s.vehicle_id === nextVehicle && s.shift_date === nextDate && s.status !== 'CANCELLED');
      if (dupVehicle) throw new Error('VEHICLE_HAS_SHIFT: Xe đã được phân ca vào ngày này');
    }

    try {
      return await this.repo.updateEVShift(shiftId, input);
    } catch (err: any) {
      if (String(err?.message || '').startsWith('SHIFT_NOT_FOUND')) return null;
      throw err;
    }
  }

  /** Xóa ca vận chuyển */
  async deleteShift(shiftId: string): Promise<boolean> {
    return this.repo.deleteEVShift(shiftId);
  }

  // ============================================================
  // TẠO CA TỰ ĐỘNG THEO TUẦN (mặc định 08:00 – 14:00, T2 → T7)
  // ============================================================

  /**
   * Tạo ca vận chuyển cho cả tuần của từng tài xế.
   *
   * Nguyên tắc:
   *  - Chỉ tạo ca còn thiếu — ca đã có (kể cả ca đã hủy) được giữ nguyên, nên
   *    mọi chỉnh sửa của Quản lý vận chuyển trên một ngày không bị ghi đè.
   *  - Mỗi tài xế dùng xe được gán (evVehicles.assigned_driver_id); tài xế chưa
   *    có xe bị bỏ qua và ghi lý do để admin bổ sung.
   *  - Giờ mặc định 08:00 → 14:00 theo giờ Việt Nam.
   */
  async generateWeek(input: GenerateWeekInput = {}): Promise<GenerateWeekResult> {
    const baseDay = /^\d{4}-\d{2}-\d{2}$/.test(String(input.weekStart || ''))
      ? String(input.weekStart)
      : vnToday();
    const weekStart = mondayOf(baseDay);
    const weekEnd = addDays(weekStart, 6);

    const startTime = String(input.startTime || '08:00').trim();
    const endTime = String(input.endTime || '14:00').trim();
    if (!TIME_RE.test(startTime)) throw new Error('INVALID_TIME: Giờ bắt đầu phải dạng HH:MM');
    if (!TIME_RE.test(endTime)) throw new Error('INVALID_TIME: Giờ kết thúc phải dạng HH:MM');

    const route = input.routeId
      ? this.repo.evRoutes.find(r => r.route_id === input.routeId)
      : (this.repo.evRoutes.find(r => r.is_active) || this.repo.evRoutes[0]);
    if (!route) throw new Error('ROUTE_NOT_FOUND: Chưa có lộ trình để phân ca');

    const repoAny: any = this.repo as any;
    const employees: any[] = Array.isArray(repoAny.employees) ? repoAny.employees : [];
    const vehicles: any[] = Array.isArray(repoAny.evVehicles) ? repoAny.evVehicles : [];

    let driverIds = (input.driverIds || []).map(id => String(id || '').trim()).filter(Boolean);
    if (!driverIds.length) {
      driverIds = employees
        .filter(e => String(e?.group || '').toUpperCase() === 'XUONG')
        .filter(e => String(e?.employment_status || '').toUpperCase() !== 'TERMINATED')
        .map(e => String(e.employee_id));
    }

    // Mặc định Thứ 2 → Thứ 7. Chủ nhật để trống, admin có thể tạo tay nếu chạy.
    const wantedDays = Array.isArray(input.days) && input.days.length
      ? input.days.map(Number).filter(n => n >= 0 && n <= 6)
      : [1, 2, 3, 4, 5, 6];
    const today = vnToday();
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(weekStart, i);
      const dow = new Date(Date.parse(`${day}T00:00:00Z`)).getUTCDay();
      if (!wantedDays.includes(dow)) continue;
      if (!input.includePast && day < today) continue;
      dates.push(day);
    }

    const created: EVShift[] = [];
    const skipped: GenerateWeekResult['skipped'] = [];

    for (const driverId of driverIds) {
      const assigned = vehicles.filter(v => String(v?.assigned_driver_id || '') === driverId);
      const vehicleId = (input.vehicleId && driverIds.length === 1)
        ? String(input.vehicleId)
        : String((assigned.find(v => String(v?.status || 'ACTIVE') === 'ACTIVE') || assigned[0])?.vehicle_id || '');
      if (!vehicleId) {
        skipped.push({ driver_id: driverId, shift_date: '', reason: 'NO_VEHICLE: Chưa gán xe cho tài xế' });
        continue;
      }

      // Chế độ tự động: tuần đã có ca của tài xế thì không đụng vào nữa.
      if (input.fillMissing === false) {
        const planned = this.repo.evShifts.some(s => s.driver_id === driverId
          && s.shift_date >= weekStart && s.shift_date <= weekEnd);
        if (planned) {
          skipped.push({ driver_id: driverId, shift_date: '', reason: 'WEEK_ALREADY_PLANNED: Tuần này đã có ca' });
          continue;
        }
      }

      for (const day of dates) {
        const exists = this.repo.evShifts.find(s => s.driver_id === driverId && s.shift_date === day);
        if (exists) {
          skipped.push({ driver_id: driverId, shift_date: day, reason: 'SHIFT_EXISTS: Ngày này đã có ca' });
          continue;
        }
        const vehicleBusy = this.repo.evShifts.find(s => s.vehicle_id === vehicleId
          && s.shift_date === day && s.status !== 'CANCELLED');
        if (vehicleBusy) {
          skipped.push({ driver_id: driverId, shift_date: day, reason: 'VEHICLE_HAS_SHIFT: Xe đã được phân ca' });
          continue;
        }
        try {
          const shift = await this.repo.createEVShift({
            route_id: route.route_id,
            driver_id: driverId,
            vehicle_id: vehicleId,
            shift_date: day,
            planned_start_at: vnDateTimeToIso(day, startTime),
            planned_end_at: vnDateTimeToIso(day, endTime),
            notes: `Ca tự động theo tuần (${startTime}–${endTime})`,
            created_by: String(input.createdBy || 'SYSTEM').trim() || 'SYSTEM',
          });
          created.push(shift);
        } catch (err: any) {
          skipped.push({
            driver_id: driverId,
            shift_date: day,
            reason: String(err?.message || 'CREATE_FAILED'),
          });
        }
      }
    }

    return { week_start: weekStart, week_end: weekEnd, created, skipped };
  }

  /**
   * Bảo đảm tuần hiện tại + tuần sau luôn có ca cho mọi tài xế.
   * Chạy lúc khởi động và định kỳ; idempotent nên không nhân đôi ca.
   */
  async ensureUpcomingWeeks(input: { createdBy?: string } = {}): Promise<GenerateWeekResult[]> {
    const weekStart = mondayOf(vnToday());
    const out: GenerateWeekResult[] = [];
    for (const week of [weekStart, addDays(weekStart, 7)]) {
      out.push(await this.generateWeek({
        weekStart: week,
        createdBy: input.createdBy || 'SYSTEM_AUTO',
        fillMissing: false,
      }));
    }
    return out;
  }

  /** Lấy ca theo ID */
  async getShift(shiftId: string): Promise<EVShift | null> {
    return this.repo.evShifts.find(s => s.shift_id === shiftId) || null;
  }

  /** Lấy ca của tài xế theo ngày */
  async getShiftByDriverDate(driverId: string, shiftDate: string): Promise<EVShift | null> {
    return this.repo.evShifts.find(s => s.driver_id === driverId && s.shift_date === shiftDate) || null;
  }

  /** Lấy ca hiện tại của tài xế (hôm nay hoặc sắp tới) */
  async getCurrentShift(driverId: string): Promise<EVShift | null> {
    const today = new Date().toISOString().slice(0, 10);
    const shifts = this.repo.evShifts
      .filter(s => s.driver_id === driverId && s.shift_date >= today && s.status !== 'CANCELLED')
      .sort((a, b) => a.shift_date.localeCompare(b.shift_date));
    return shifts[0] || null;
  }

  /** Lấy danh sách ca (có filter) */
  async listShifts(filters?: {
    driverId?: string;
    vehicleId?: string;
    routeId?: string;
    status?: EVShift['status'];
    dateFrom?: string;
    dateTo?: string;
  }): Promise<EVShift[]> {
    let shifts = this.repo.evShifts;
    if (filters?.driverId) shifts = shifts.filter(s => s.driver_id === filters.driverId);
    if (filters?.vehicleId) shifts = shifts.filter(s => s.vehicle_id === filters.vehicleId);
    if (filters?.routeId) shifts = shifts.filter(s => s.route_id === filters.routeId);
    if (filters?.status) shifts = shifts.filter(s => s.status === filters.status);
    if (filters?.dateFrom) shifts = shifts.filter(s => s.shift_date >= filters.dateFrom!);
    if (filters?.dateTo) shifts = shifts.filter(s => s.shift_date <= filters.dateTo!);
    return shifts.sort((a, b) => b.shift_date.localeCompare(a.shift_date) || a.planned_start_at.localeCompare(b.planned_start_at));
  }

  /** Lấy ca đang chạy (IN_PROGRESS) */
  async getLiveShifts(): Promise<EVShift[]> {
    return this.repo.evShifts.filter(s => s.status === 'IN_PROGRESS');
  }

  /** Bắt đầu ca - validate geofence điểm xuất phát */
  async startShift(shiftId: string, driverLocation: { latitude: number; longitude: number; accuracy: number }): Promise<EVShift> {
    const shift = await this.getShift(shiftId);
    if (!shift) throw new Error('SHIFT_NOT_FOUND');
    if (shift.status !== 'SCHEDULED') throw new Error('SHIFT_NOT_SCHEDULED: Ca không ở trạng thái chờ bắt đầu');

    // Get route stops (áp phiếu đổi lộ trình nếu ca nằm trong khoảng hiệu lực)
    const stops = await this.stopsForShift(shift);
    const startStop = stops[0];
    if (!startStop) throw new Error('NO_START_STOP: Lộ trình không có điểm xuất phát');

    // Validate geofence (≤100m)
    const distance = this.haversineDistance(
      driverLocation.latitude,
      driverLocation.longitude,
      startStop.latitude,
      startStop.longitude
    );
    if (distance > startStop.geofence_radius_m) {
      throw new Error(`OUTSIDE_GEOFENCE: Bạn đang cách ${Math.round(distance)}m so với điểm xuất phát (cho phép ≤${startStop.geofence_radius_m}m)`);
    }
    if (driverLocation.accuracy > 30) {
      throw new Error(`GPS_ACCURACY_LOW: Độ chính xác GPS ${driverLocation.accuracy}m quá thấp (yêu cầu ≤30m)`);
    }

    // Update shift
    const updated = await this.updateShift(shiftId, {
      status: 'IN_PROGRESS',
      actual_start_at: new Date().toISOString(),
    });
    return updated!;
  }

  /** Kết thúc ca - validate geofence điểm kết thúc */
  async endShift(shiftId: string, driverLocation: { latitude: number; longitude: number; accuracy: number }): Promise<EVShift> {
    const shift = await this.getShift(shiftId);
    if (!shift) throw new Error('SHIFT_NOT_FOUND');
    // RETURNING: đã kết thúc sạc và đang về xưởng. CHARGING: cho phép kết thúc
    // ca ngay cả khi tài xế quên bấm "Kết thúc sạc" (tránh kẹt ca vĩnh viễn).
    if (!['IN_PROGRESS', 'PAUSED', 'RETURNING', 'CHARGING'].includes(shift.status)) {
      throw new Error('SHIFT_NOT_IN_PROGRESS: Ca không ở trạng thái đang chạy');
    }

    // Get route stops (áp phiếu đổi lộ trình nếu có)
    const stops = await this.stopsForShift(shift);
    const endStop = stops[stops.length - 1];
    if (!endStop) throw new Error('NO_END_STOP: Lộ trình không có điểm kết thúc');

    // Validate geofence
    const distance = this.haversineDistance(
      driverLocation.latitude,
      driverLocation.longitude,
      endStop.latitude,
      endStop.longitude
    );
    if (distance > endStop.geofence_radius_m) {
      throw new Error(`OUTSIDE_GEOFENCE: Bạn đang cách ${Math.round(distance)}m so với điểm kết thúc (cho phép ≤${endStop.geofence_radius_m}m)`);
    }

    // Update shift
    const updated = await this.updateShift(shiftId, {
      status: 'COMPLETED',
      actual_end_at: new Date().toISOString(),
    });
    return updated!;
  }

  /** Lấy chi tiết ca đầy đủ (kèm stops, checkins) */
  async getShiftDetail(shiftId: string): Promise<{
    shift: EVShift;
    driverName: string;
    driverCode: string;
    vehiclePlate: string;
    routeName: string;
    stops: Array<EVRouteStop & {
      checkedInAt?: string;
      isCompleted: boolean;
      isLate: boolean;
      lateMinutes: number;
      penaltyAmount: number;
    }>;
  } | null> {
    const shift = await this.getShift(shiftId);
    if (!shift) return null;

    const driver = this.repo.employees.find(e => e.employee_id === shift.driver_id);
    const vehicle = this.repo.evVehicles.find(v => v.vehicle_id === shift.vehicle_id);
    const route = this.repo.evRoutes.find(r => r.route_id === shift.route_id);

    const stops = await this.stopsForShift(shift);

    const checkins = this.repo.evShiftCheckins.filter(c => c.shift_id === shiftId);

    const stopsWithCheckin = stops.map(stop => {
      const checkin = checkins.find(c => c.stop_id === stop.stop_id);
      return {
        ...stop,
        checkedInAt: checkin?.checked_in_at,
        isCompleted: !!checkin,
        isLate: checkin?.is_late || false,
        lateMinutes: checkin?.late_minutes || 0,
        penaltyAmount: checkin?.penalty_amount || 0,
      };
    });

    return {
      shift,
      driverName: driver?.full_name || 'Unknown',
      driverCode: driver?.employee_code || 'Unknown',
      vehiclePlate: vehicle?.license_plate || 'Unknown',
      routeName: route?.name || 'Unknown',
      stops: stopsWithCheckin,
    };
  }

  /** Haversine distance calculation */
  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Earth radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}