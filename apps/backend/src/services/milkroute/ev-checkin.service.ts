import { MockSheetsAdapter } from '../../repositories/mock-sheets.adapter.js';
import {
  EVShift,
  EVRouteStop,
  EVShiftCheckin,
  CHARGING_POINT_CONFIRM_HITS,
  CHARGING_POINT_MATCH_RADIUS_M,
  effectiveEndSlaMinutes,
} from '@ubm/shared';
import { EVRouteService } from './ev-route.service.js';
import { isEvTestModeEnabled, isEvTestShift, withEvTestShiftMark } from './ev-test-mode.js';

/**
 * Bấm xác nhận tại chi nhánh: GPS điện thoại trong cửa hàng / khu phố đông
 * thường sai số 30–300m (trước đây chặn tuyệt đối ở 30m nên tài xế đứng ngay
 * chi nhánh vẫn không bấm được). Nay:
 *  - Chỉ từ chối khi sai số quá vô lý (>1000m — sóng GPS hỏng).
 *  - Cho phép dung sai theo sai số thiết bị, tối đa 100m, cộng vào bán kính
 *    điểm dừng (bán kính này đã được nới theo cấu hình chi nhánh).
 *  - Check-in ngoài bán kính gốc nhưng trong phần dung sai vẫn được ghi nhận
 *    với cờ is_within_geofence=false để HR đối soát.
 */
const CHECKIN_ACCURACY_MAX_M = 1000;
const CHECKIN_GPS_TOLERANCE_MAX_M = 100;
/** Ca vẫn đang chạy (kể cả đang sạc / tạm dừng) đều được bấm điểm. */
const CHECKIN_ALLOWED_STATUSES = ['IN_PROGRESS', 'RETURNING', 'CHARGING', 'PAUSED'];

type ChargingPointResult = {
  /** Số lần GPS trùng toạ độ đã ghi nhận (tối đa 3). */
  count: number;
  /** Đã đủ 3 lần trùng → ghi nhớ vị trí trạm sạc. */
  confirmed: boolean;
  latitude: number;
  longitude: number;
  address?: string;
  /** Có lưu được xuống điểm dừng CHARGING gốc hay không. */
  persisted: boolean;
};

export class EVCheckinService {
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

  /** Check-in tại điểm dừng */
  async checkinStop(input: {
    shiftId: string;
    stopId: string;
    driverLocation: { latitude: number; longitude: number; accuracy: number };
  }): Promise<EVShiftCheckin> {
    const shift = this.repo.evShifts.find(s => s.shift_id === input.shiftId);
    if (!shift) throw new Error('SHIFT_NOT_FOUND');
    // Chế độ TEST (Admin bật) hoặc ca đã được đánh dấu test: bỏ mọi ràng buộc
    // quy trình (trạng thái ca, thứ tự điểm, khoảng cách, sai số GPS).
    const testMode = isEvTestModeEnabled(this.repo) || isEvTestShift(shift);
    if (!testMode) {
      // Ca đang chạy — kể cả đang sạc (CHARGING) hoặc tạm dừng (PAUSED), vì app
      // tài xế vẫn hiện nút xác nhận ở các trạng thái này.
      if (!CHECKIN_ALLOWED_STATUSES.includes(String(shift.status))) {
        throw new Error('SHIFT_NOT_IN_PROGRESS: Ca không ở trạng thái đang chạy');
      }
    }

    const stops = await this.stopsForShift(shift);
    const stop = stops.find(s => s.stop_id === input.stopId);
    if (!stop) throw new Error('STOP_NOT_FOUND');
    if (stop.route_id !== shift.route_id) throw new Error('STOP_NOT_IN_ROUTE: Điểm dừng không thuộc lộ trình này');

    const isChargingStop = stop.stop_type === 'CHARGING';
    const accuracy = Number(input.driverLocation.accuracy) || 0;

    // Check if already checked in. Riêng trạm sạc cho phép bấm lại để ghi thêm
    // mẫu GPS (đủ 3 lần trùng toạ độ mới chốt vị trí trạm).
    const existingCheckin = this.repo.evShiftCheckins.find(c => c.shift_id === input.shiftId && c.stop_id === input.stopId);
    if (existingCheckin && !isChargingStop) throw new Error('ALREADY_CHECKED_IN: Đã check-in tại điểm này');

    // Validate stop order (must check in sequentially) — chế độ Test bỏ qua.
    // Bấm lại trạm sạc đã check-in thì chỉ cập nhật GPS, không kiểm tra thứ tự.
    if (!testMode && !existingCheckin) {
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
    }

    // Validate geofence: bán kính điểm dừng (đã nới theo chi nhánh) + dung sai GPS.
    // Chế độ Test vẫn ghi khoảng cách thật để HR đối soát nhưng không chặn.
    // TRẠM SẠC KHÔNG CỐ ĐỊNH: không có toạ độ cố định để so geofence — chỉ
    // kiểm tra GPS còn sống, toạ độ gửi lên chính là vị trí sạc thực tế.
    let distance = 0;
    let isWithinGeofence = true;
    let chargingPoint: ChargingPointResult | null = null;
    if (isChargingStop) {
      if (!testMode && accuracy > CHECKIN_ACCURACY_MAX_M) {
        throw new Error(`GPS_ACCURACY_LOW: Sóng GPS quá yếu (sai số ±${Math.round(accuracy)}m). Ra chỗ thoáng chờ GPS cập nhật rồi thử lại.`);
      }
      chargingPoint = await this.recordChargingGpsPoint(shift, stop, input.driverLocation);
      // Lần bấm lại: chỉ cập nhật mẫu GPS, không tạo thêm check-in.
      if (existingCheckin) {
        return {
          ...existingCheckin,
          charging_pending_count: chargingPoint.count,
          charging_confirmed: chargingPoint.confirmed,
          is_repeat: true,
        };
      }
      // Chưa đủ 3 lần trùng toạ độ: lưu tạm, chưa hoàn tất điểm sạc.
      if (!chargingPoint.confirmed) {
        return this.pendingChargingPointResult(input, stop, chargingPoint);
      }
    } else {
      distance = this.haversineDistance(
        input.driverLocation.latitude,
        input.driverLocation.longitude,
        stop.latitude,
        stop.longitude
      );
      const radius = Math.max(Number(stop.geofence_radius_m) || 0, 100);
      const tolerance = Math.min(Math.max(accuracy, 0), CHECKIN_GPS_TOLERANCE_MAX_M);
      const allowed = radius + tolerance;
      isWithinGeofence = distance <= radius;
      if (!testMode) {
        if (accuracy > CHECKIN_ACCURACY_MAX_M) {
          throw new Error(`GPS_ACCURACY_LOW: Sóng GPS quá yếu (sai số ±${Math.round(accuracy)}m). Ra chỗ thoáng chờ GPS cập nhật rồi thử lại.`);
        }
        if (distance > allowed) {
          const toleranceNote = tolerance > 0 ? ` + dung sai GPS ${Math.round(tolerance)}m` : '';
          throw new Error(`OUTSIDE_GEOFENCE: Bạn đang cách ${stop.name} ${Math.round(distance)}m (cho phép ≤${Math.round(radius)}m${toleranceNote})`);
        }
      }
    }

    // Calculate SLA
    const chargingEndAt = this.latestChargingEndAt(input.shiftId);
    const hasCharging = chargingEndAt != null;
    // Điểm cuối có 2 mốc tùy chỉnh: có phiếu sạc (từ trạm sạc về) và không có
    // phiếu sạc (từ chi nhánh cuối về). Điểm khác dùng sla_minutes như cũ.
    const effectiveSla = effectiveEndSlaMinutes(stop, hasCharging);
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
      if (stop.stop_type === 'END' && chargingEndAt != null) {
        // Điểm cuối + ca có phiếu sạc đã kết thúc: mốc là lúc kết thúc sạc.
        prevTime = chargingEndAt;
      } else if (prevCheckin) {
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

    // Chế độ Test: không tính trễ/phạt để không ảnh hưởng lương tài xế.
    isLate = !testMode && actualTravelMin > effectiveSla;
    lateMinutes = isLate ? actualTravelMin - effectiveSla : 0;

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
      stop_name: stop.name,
      checked_in_at: now,
      latitude: input.driverLocation.latitude,
      longitude: input.driverLocation.longitude,
      distance_m: Math.round(distance * 100) / 100,
      is_within_geofence: isWithinGeofence,
      sla_minutes: effectiveSla,
      actual_travel_min: actualTravelMin,
      is_late: isLate,
      late_minutes: lateMinutes,
      penalty_amount: penaltyAmount,
      is_missed: false,
      notes: testMode ? 'TEST_MODE' : isChargingStop ? 'CHARGING_POINT_CONFIRMED' : undefined,
      charging_pending_count: isChargingStop ? chargingPoint?.count : undefined,
      charging_confirmed: isChargingStop ? chargingPoint?.confirmed : undefined,
      created_at: now,
    };

    // Đánh dấu ca là ca test (một lần) để kết thúc ca & bảng lương biết bỏ qua.
    if (testMode && !isEvTestShift(shift)) {
      await this.repo.updateEVShift(input.shiftId, { notes: withEvTestShiftMark(shift.notes) });
    }

    // Ghi qua repo để persist xuống ev_shift_checkins (checkin_id do repo cấp).
    const saved = await this.repo.createEVShiftCheckin(checkin as Partial<EVShiftCheckin>);

    // Update shift penalty points
    if (isLate) {
      await this.updateShiftPenalty(input.shiftId, 1);
    }

    // Repo chỉ lưu các cột check-in chuẩn → trả kèm tiến độ GPS trạm sạc cho app.
    return isChargingStop
      ? {
        ...saved,
        charging_pending_count: chargingPoint?.count,
        charging_confirmed: chargingPoint?.confirmed,
        is_repeat: false,
      }
      : saved;
  }

  /**
   * Kết quả khi tài xế bấm điểm sạc nhưng GPS chưa trùng đủ 3 lần.
   * Trả về dạng "check-in tạm" để app hiện tiến độ 1/3, 2/3 mà KHÔNG ghi
   * check-in vào lịch sử (điểm sạc vẫn còn là điểm kế tiếp).
   */
  private pendingChargingPointResult(
    input: { shiftId: string; stopId: string },
    stop: EVRouteStop,
    point: ChargingPointResult,
  ): EVShiftCheckin {
    const now = new Date().toISOString();
    return {
      checkin_id: '',
      shift_id: input.shiftId,
      stop_id: stop.stop_id,
      stop_order: stop.stop_order,
      stop_name: stop.name,
      checked_in_at: now,
      latitude: point.latitude,
      longitude: point.longitude,
      distance_m: 0,
      is_within_geofence: true,
      sla_minutes: Number(stop.sla_minutes) || 0,
      actual_travel_min: 0,
      is_late: false,
      late_minutes: 0,
      penalty_amount: 0,
      is_missed: false,
      notes: 'CHARGING_GPS_PENDING',
      charging_pending_count: point.count,
      charging_confirmed: false,
      is_repeat: true,
      created_at: now,
    };
  }

  /**
   * Ghi nhận một mẫu GPS tại trạm sạc.
   *
   * Trạm sạc không cố định nên không thể so với toạ độ cấu hình. Mỗi lần tài
   * xế bấm nút Điểm, GPS hiện tại được lưu tạm vào điểm dừng CHARGING. Khi có
   * `CHARGING_POINT_CONFIRM_HITS` lần liên tiếp cùng toạ độ (dung sai
   * `CHARGING_POINT_MATCH_RADIUS_M`), hệ thống mới ghi nhớ vị trí này và thay
   * thế điểm sạc cũ. Điểm sạc mới ở chỗ khác phải đủ 3 lần lại mới thay.
   */
  private async recordChargingGpsPoint(
    shift: EVShift,
    stop: EVRouteStop,
    location: { latitude: number; longitude: number; accuracy: number },
  ): Promise<ChargingPointResult> {
    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    const accuracy = Number(location.accuracy) || 0;
    // GPS trong hầm/trạm sạc thường trôi vài chục mét → coi là cùng điểm trong
    // bán kính 50m (nới theo sai số thiết bị nhưng tối đa 100m).
    const matchRadius = Math.max(CHARGING_POINT_MATCH_RADIUS_M, Math.min(accuracy, 100));
    const target = this.findPersistedChargingStop(shift, stop);
    const now = new Date().toISOString();

    if (!target) {
      // Điểm sạc đến từ phiếu đổi lộ trình nhưng không có điểm gốc để lưu.
      return { count: 1, confirmed: false, latitude, longitude, persisted: false };
    }

    // Đã có vị trí trạm được nhớ trước đó (từ ca trước hoặc lần bấm đủ 3 lần).
    const knownLat = Number(target.charging_confirmed_latitude ?? target.latitude);
    const knownLng = Number(target.charging_confirmed_longitude ?? target.longitude);
    const hasKnown = Number.isFinite(knownLat) && Number.isFinite(knownLng)
      && !(knownLat === 0 && knownLng === 0);
    const sameAsKnown = hasKnown
      && this.haversineDistance(latitude, longitude, knownLat, knownLng) <= matchRadius;

    if (sameAsKnown) {
      // Đúng trạm đã nhớ → không cần đếm lại, chỉ đảm bảo dữ liệu xác nhận đầy đủ.
      if (!target.charging_confirmed_at) {
        await this.repo.updateEVRouteStop(target.stop_id, {
          latitude: knownLat,
          longitude: knownLng,
          charging_pending_latitude: knownLat,
          charging_pending_longitude: knownLng,
          charging_pending_count: CHARGING_POINT_CONFIRM_HITS,
          charging_pending_updated_at: now,
          charging_confirmed_at: now,
          charging_confirmed_latitude: knownLat,
          charging_confirmed_longitude: knownLng,
          charging_confirmed_address: target.charging_confirmed_address || target.address,
          charging_confirmed_by: shift.driver_id,
        } as Partial<EVRouteStop>);
      }
      return {
        count: CHARGING_POINT_CONFIRM_HITS,
        confirmed: true,
        latitude: knownLat,
        longitude: knownLng,
        address: target.charging_confirmed_address || target.address,
        persisted: true,
      };
    }

    const pendingLat = Number(target.charging_pending_latitude);
    const pendingLng = Number(target.charging_pending_longitude);
    const hasPending = Number(target.charging_pending_count) > 0
      && Number.isFinite(pendingLat) && Number.isFinite(pendingLng)
      && !(pendingLat === 0 && pendingLng === 0);
    const samePending = hasPending
      && this.haversineDistance(latitude, longitude, pendingLat, pendingLng) <= matchRadius;
    const count = samePending ? Number(target.charging_pending_count) + 1 : 1;
    const pointLat = samePending ? pendingLat : latitude;
    const pointLng = samePending ? pendingLng : longitude;
    const confirmed = count >= CHARGING_POINT_CONFIRM_HITS;
    const address = confirmed
      ? `Trạm sạc tại ${pointLat.toFixed(6)}, ${pointLng.toFixed(6)}`
      : target.charging_confirmed_address || target.address;

    const updates: Partial<EVRouteStop> = {
      charging_pending_latitude: pointLat,
      charging_pending_longitude: pointLng,
      charging_pending_count: confirmed ? CHARGING_POINT_CONFIRM_HITS : count,
      charging_pending_updated_at: now,
    };
    if (confirmed) {
      // Điểm sạc mới thay thế điểm cũ — mỗi trạm chỉ giữ 1 vị trí hiện hành.
      updates.latitude = pointLat;
      updates.longitude = pointLng;
      updates.address = address;
      updates.charging_confirmed_at = now;
      updates.charging_confirmed_latitude = pointLat;
      updates.charging_confirmed_longitude = pointLng;
      updates.charging_confirmed_address = address;
      updates.charging_confirmed_by = shift.driver_id;
    }
    await this.repo.updateEVRouteStop(target.stop_id, updates);

    return {
      count: Math.min(count, CHARGING_POINT_CONFIRM_HITS),
      confirmed,
      latitude: pointLat,
      longitude: pointLng,
      address,
      persisted: true,
    };
  }

  /**
   * Tìm điểm dừng CHARGING gốc (được persist) để ghi toạ độ trạm.
   * Điểm dừng từ phiếu đổi lộ trình có id tạm → vẫn quy về trạm gốc của lộ trình.
   */
  private findPersistedChargingStop(shift: EVShift, stop: EVRouteStop): EVRouteStop | null {
    const exact = this.repo.evRouteStops.find(
      s => s.stop_id === stop.stop_id && s.stop_type === 'CHARGING',
    );
    if (exact) return exact;
    return this.repo.evRouteStops.find(
      s => s.route_id === shift.route_id && s.stop_type === 'CHARGING',
    ) || null;
  }

  /** Tự động phát hiện điểm bị bỏ lỡ (missed) khi chuyển sang điểm tiếp theo */
  async detectMissedStops(shiftId: string): Promise<EVShiftCheckin[]> {
    const shift = this.repo.evShifts.find(s => s.shift_id === shiftId);
    if (!shift) return [];
    // Ca test: không đánh dấu điểm bỏ lọt (tránh trừ lương oan).
    if (isEvTestModeEnabled(this.repo) || isEvTestShift(shift)) return [];

    const stops = await this.stopsForShift(shift);
    const checkins = this.repo.evShiftCheckins.filter(c => c.shift_id === shiftId);
    const completedOrders = new Set(checkins.map(c => c.stop_order));
    const hasCharging = this.latestChargingEndAt(shiftId) != null;

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
            stop_name: stop.name,
            checked_in_at: now,
            latitude: 0,
            longitude: 0,
            distance_m: 0,
            is_within_geofence: false,
            sla_minutes: effectiveEndSlaMinutes(stop, hasCharging),
            actual_travel_min: 0,
            // Điểm bỏ lọt chỉ bị phạt "quên chấm", KHÔNG cộng thêm phạt trễ giờ
            // (bảng lương dùng is_late cho các chặng đã chấm nhưng quá SLA).
            is_late: false,
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

  /** Mốc kết thúc sạc gần nhất của ca (null nếu ca không có phiếu sạc đã kết thúc). */
  private latestChargingEndAt(shiftId: string): number | null {
    const ends = this.repo.evChargingTickets
      .filter(t => String(t.shift_id) === String(shiftId) && t.charging_end_at)
      .map(t => Date.parse(String(t.charging_end_at)))
      .filter(n => Number.isFinite(n))
      .sort((a, b) => b - a);
    return ends.length ? ends[0] : null;
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