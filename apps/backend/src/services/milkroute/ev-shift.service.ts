import { MockSheetsAdapter } from '../../repositories/mock-sheets.adapter.js';
import { EVShift, EVRouteStop, EVRoute, EVVehicle } from '@ubm/shared';

export class EVShiftService {
  constructor(private readonly repo: MockSheetsAdapter) {}

  /** Tạo ca vận chuyển mới */
  async createShift(input: {
    routeId: string;
    driverId: string;
    vehicleId: string;
    shiftDate: string;           // YYYY-MM-DD
    plannedStartAt: string;      // ISO timestamp
    plannedEndAt?: string;
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
      work_day_index: input.workDayIndex,
      notes: input.notes,
      created_by: input.createdBy,
    });
  }

  /** Cập nhật ca vận chuyển */
  async updateShift(shiftId: string, input: Partial<Omit<EVShift, 'shift_id' | 'created_at' | 'version'>>): Promise<EVShift | null> {
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

    // Get route stops
    const stops = this.repo.evRouteStops.filter(s => s.route_id === shift.route_id).sort((a, b) => a.stop_order - b.stop_order);
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

    // Get route stops
    const stops = this.repo.evRouteStops.filter(s => s.route_id === shift.route_id).sort((a, b) => a.stop_order - b.stop_order);
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

    const stops = await this.repo.evRouteStops
      .filter(s => s.route_id === shift.route_id)
      .sort((a, b) => a.stop_order - b.stop_order);

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