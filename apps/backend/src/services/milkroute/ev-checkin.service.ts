import { MockSheetsAdapter } from '../../repositories/mock-sheets.adapter.js';
import { EVShift, EVRouteStop, EVShiftCheckin } from '@ubm/shared';

export class EVCheckinService {
  constructor(private readonly repo: MockSheetsAdapter) {}

  /** Check-in tại điểm dừng */
  async checkinStop(input: {
    shiftId: string;
    stopId: string;
    driverLocation: { latitude: number; longitude: number; accuracy: number };
  }): Promise<EVShiftCheckin> {
    const shift = this.repo.evShifts.find(s => s.shift_id === input.shiftId);
    if (!shift) throw new Error('SHIFT_NOT_FOUND');
    // RETURNING: sau khi kết thúc sạc, tài xế vẫn phải check-in điểm kết thúc (về xưởng).
    if (shift.status !== 'IN_PROGRESS' && shift.status !== 'RETURNING') {
      throw new Error('SHIFT_NOT_IN_PROGRESS: Ca không ở trạng thái đang chạy');
    }

    const stop = this.repo.evRouteStops.find(s => s.stop_id === input.stopId);
    if (!stop) throw new Error('STOP_NOT_FOUND');
    if (stop.route_id !== shift.route_id) throw new Error('STOP_NOT_IN_ROUTE: Điểm dừng không thuộc lộ trình này');

    // Check if already checked in
    const existingCheckin = this.repo.evShiftCheckins.find(c => c.shift_id === input.shiftId && c.stop_id === input.stopId);
    if (existingCheckin) throw new Error('ALREADY_CHECKED_IN: Đã check-in tại điểm này');

    // Validate stop order (must check in sequentially)
    const stops = this.repo.evRouteStops.filter(s => s.route_id === shift.route_id).sort((a, b) => a.stop_order - b.stop_order);
    const completedStops = this.repo.evShiftCheckins.filter(c => c.shift_id === input.shiftId).map(c => c.stop_order);
    const maxCompletedOrder = completedStops.length > 0 ? Math.max(...completedStops) : 0;

    if (stop.stop_order <= maxCompletedOrder) {
      throw new Error('WRONG_STOP_ORDER: Điểm này đã đi qua, hãy chọn điểm kế tiếp');
    }
    // Cho phép BỎ QUA điểm tùy chọn (VD: trạm sạc ghim GPS động, toạ độ 0,0),
    // nhưng tuyệt đối không được bỏ qua điểm bắt buộc.
    const skippedMandatory = stops.find(
      s => s.stop_order > maxCompletedOrder && s.stop_order < stop.stop_order && s.is_mandatory,
    );
    if (skippedMandatory) {
      throw new Error(`WRONG_STOP_ORDER: Phải check-in theo thứ tự. Điểm tiếp theo là ${skippedMandatory.name}`);
    }

    // Validate geofence
    const distance = this.haversineDistance(
      input.driverLocation.latitude,
      input.driverLocation.longitude,
      stop.latitude,
      stop.longitude
    );
    const isWithinGeofence = distance <= stop.geofence_radius_m;
    if (!isWithinGeofence) {
      throw new Error(`OUTSIDE_GEOFENCE: Bạn đang cách ${Math.round(distance)}m so với ${stop.name} (cho phép ≤${stop.geofence_radius_m}m)`);
    }
    if (input.driverLocation.accuracy > 30) {
      throw new Error(`GPS_ACCURACY_LOW: Độ chính xác GPS ${input.driverLocation.accuracy}m quá thấp (yêu cầu ≤30m)`);
    }

    // Calculate SLA
    let actualTravelMin = 0;
    let isLate = false;
    let lateMinutes = 0;

    if (stop.stop_order === 1) {
      // First stop: SLA from planned start time
      const plannedStart = new Date(shift.planned_start_at).getTime();
      const actualCheckin = Date.now();
      actualTravelMin = Math.round((actualCheckin - plannedStart) / 60000);
    } else {
      // Subsequent stops: SLA tính từ mốc trước đó.
      const prevStop = stops.find(s => s.stop_order === stop.stop_order - 1);
      const prevCheckin = this.repo.evShiftCheckins.find(c => c.shift_id === input.shiftId && c.stop_id === prevStop?.stop_id);
      let prevTime: number | null = null;
      if (prevCheckin) {
        prevTime = new Date(prevCheckin.checked_in_at).getTime();
      } else if (prevStop?.stop_type === 'CHARGING') {
        // Chặng cuối (trạm sạc → xưởng): mốc là lúc KẾT THÚC SẠC,
        // vì điểm sạc là tùy chọn và không bắt buộc check-in.
        const ends = this.repo.evChargingTickets
          .filter(t => t.shift_id === input.shiftId && t.charging_end_at)
          .map(t => Date.parse(String(t.charging_end_at)))
          .filter(n => Number.isFinite(n))
          .sort((a, b) => b - a);
        if (ends.length) prevTime = ends[0];
      }
      if (prevTime == null) {
        // Bỏ qua điểm tùy chọn không check-in → lấy mốc check-in gần nhất trước đó.
        const lastAny = this.repo.evShiftCheckins
          .filter(c => c.shift_id === input.shiftId && c.stop_order < stop.stop_order)
          .sort((a, b) => b.stop_order - a.stop_order)[0];
        if (lastAny) prevTime = new Date(lastAny.checked_in_at).getTime();
      }
      if (prevTime != null && Number.isFinite(prevTime)) {
        actualTravelMin = Math.round((Date.now() - prevTime) / 60000);
      }
    }

    isLate = actualTravelMin > stop.sla_minutes;
    lateMinutes = isLate ? actualTravelMin - stop.sla_minutes : 0;

    // Calculate penalty
    let penaltyAmount = 0;
    if (isLate) {
      // Will calculate based on payroll config later
      penaltyAmount = 0; // Placeholder - calculated in payroll
    }

    const now = new Date().toISOString();
    const checkin: EVShiftCheckin = {
      checkin_id: '',
      shift_id: input.shiftId,
      stop_id: stop.stop_id,
      stop_order: stop.stop_order,
      checked_in_at: now,
      latitude: input.driverLocation.latitude,
      longitude: input.driverLocation.longitude,
      distance_m: Math.round(distance * 100) / 100,
      is_within_geofence: isWithinGeofence,
      sla_minutes: stop.sla_minutes,
      actual_travel_min: actualTravelMin,
      is_late: isLate,
      late_minutes: lateMinutes,
      penalty_amount: penaltyAmount,
      is_missed: false,
      created_at: now,
    };

    // Ghi qua repo để persist xuống ev_shift_checkins (checkin_id do repo cấp).
    const saved = await this.repo.createEVShiftCheckin(checkin as Partial<EVShiftCheckin>);

    // Update shift penalty points
    if (isLate) {
      await this.updateShiftPenalty(input.shiftId, 1);
    }

    return saved;
  }

  /** Tự động phát hiện điểm bị bỏ lỡ (missed) khi chuyển sang điểm tiếp theo */
  async detectMissedStops(shiftId: string): Promise<EVShiftCheckin[]> {
    const shift = this.repo.evShifts.find(s => s.shift_id === shiftId);
    if (!shift) return [];

    const stops = this.repo.evRouteStops.filter(s => s.route_id === shift.route_id).sort((a, b) => a.stop_order - b.stop_order);
    const checkins = this.repo.evShiftCheckins.filter(c => c.shift_id === shiftId);
    const completedOrders = new Set(checkins.map(c => c.stop_order));

    const missed: EVShiftCheckin[] = [];
    for (const stop of stops) {
      if (!completedOrders.has(stop.stop_order) && stop.is_mandatory) {
        // Check if this stop should have been completed by now (based on time)
        // For now, we only mark as missed when shift ends or next stop is checked in
        const existingMissed = this.repo.evShiftCheckins.find(c => c.shift_id === shiftId && c.stop_id === stop.stop_id && c.is_missed);
        if (!existingMissed) {
          const now = new Date().toISOString();
          const missedCheckin: EVShiftCheckin = {
            checkin_id: '',
            shift_id: shiftId,
            stop_id: stop.stop_id,
            stop_order: stop.stop_order,
            checked_in_at: now,
            latitude: 0,
            longitude: 0,
            distance_m: 0,
            is_within_geofence: false,
            sla_minutes: stop.sla_minutes,
            actual_travel_min: 0,
            is_late: true,
            late_minutes: 0,
            penalty_amount: 0,
            is_missed: true,
            created_at: now,
          };
          const saved = await this.repo.createEVShiftCheckin(missedCheckin as Partial<EVShiftCheckin>);
          missed.push(saved);
        }
      }
    }
    return missed;
  }

  /** Lấy check-in của ca */
  async getShiftCheckins(shiftId: string): Promise<EVShiftCheckin[]> {
    return this.repo.evShiftCheckins
      .filter(c => c.shift_id === shiftId)
      .sort((a, b) => a.stop_order - b.stop_order);
  }

  /** Cập nhật điểm phạt cho ca */
  private async updateShiftPenalty(shiftId: string, points: number): Promise<void> {
    const shift = this.repo.evShifts.find(s => s.shift_id === shiftId);
    if (shift) {
      // Ghi qua repo để persist penalty_points xuống ev_shifts.
      await this.repo.updateEVShift(shiftId, {
        penalty_points: Number(shift.penalty_points || 0) + points,
      });
    }
  }

  /** Haversine distance calculation */
  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
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