import { MockSheetsAdapter } from '../../repositories/mock-sheets.adapter.js';
import { EVGPSPoint } from '@ubm/shared';

/** Điểm GPS tài xế gửi lên (có ca hoặc chỉ để chia sẻ vị trí khi đăng nhập). */
export interface EVGPSIngestPoint {
  shiftId?: string;
  driverId: string;
  vehicleId?: string;
  recordedAt: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  battery?: number;
  isMock?: boolean;
}

/** Vị trí mới nhất của một xe trên Live Map. */
export interface EVLiveVehicle {
  vehicleId: string;
  licensePlate: string;
  driverId: string;
  driverName: string;
  shiftId: string;
  shiftStatus: string;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  battery: number;
  accuracy: number;
  lastUpdate: string;
  /** true = xe đang online (app tài xế mở và gửi GPS), kể cả khi chưa vào ca. */
  isOnline: boolean;
}

/** Vị trí chỉ còn hiển thị trong 5 phút kể từ lần gửi cuối. */
const PRESENCE_TTL_MS = 5 * 60_000;

/** Trạng thái ca được coi là "đang chạy" (GPS lưu vào lịch sử ca). */
const ACTIVE_SHIFT_STATUS = ['IN_PROGRESS', 'CHARGING', 'RETURNING'];

export class EVGPSService {
  /**
   * Vị trí realtime theo xe, giữ trong bộ nhớ.
   *
   * Tài xế mở app là gửi GPS ngay (không cần bấm bắt đầu ca), nhờ vậy Quản lý
   * vận chuyển / HR / Kế toán / Giám đốc thấy xe trên Live Map tức thì. Chỉ
   * những điểm thuộc ca đang chạy mới được ghi vào lịch sử ca (tránh làm sai
   * quãng đường/thời gian của ca).
   */
  private readonly presence = new Map<string, EVLiveVehicle>();

  constructor(private readonly repo: MockSheetsAdapter) {}

  /** Xe được gán cho tài xế (nếu có). */
  private assignedVehicleId(driverId: string): string {
    const vehicles: any[] = Array.isArray((this.repo as any).evVehicles) ? (this.repo as any).evVehicles : [];
    const found = vehicles.find(v => String(v?.assigned_driver_id || '') === String(driverId || ''));
    return String(found?.vehicle_id || '');
  }

  /** Vị trí còn "tươi" để hiển thị trên Live Map? */
  private isFresh(recordedAt: string, now = Date.now()): boolean {
    const t = Date.parse(String(recordedAt || ''));
    return Number.isFinite(t) && now - t <= PRESENCE_TTL_MS;
  }

  /**
   * Ghi nhận điểm GPS (batch).
   *
   * - Luôn cập nhật vị trí realtime của xe (Live Map).
   * - Chỉ lưu lịch sử khi điểm thuộc ca đang chạy.
   * - Tài xế chưa gán xe → bỏ qua (không thể vẽ xe nào lên bản đồ).
   */
  async ingestGPSPoints(points: EVGPSIngestPoint[]): Promise<{ saved: number; failed: number }> {
    let saved = 0;
    let failed = 0;

    for (const p of points) {
      try {
        if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)
          || p.latitude < -90 || p.latitude > 90
          || p.longitude < -180 || p.longitude > 180) {
          failed++;
          continue;
        }

        const shift = p.shiftId
          ? this.repo.evShifts.find(s => s.shift_id === p.shiftId)
          : undefined;
        const vehicleId = String(p.vehicleId || shift?.vehicle_id || this.assignedVehicleId(p.driverId) || '');
        if (!vehicleId) {
          failed++;
          continue;
        }

        const recordedAt = String(p.recordedAt || new Date().toISOString());
        const vehicle: any = (this.repo as any).evVehicles?.find?.((v: any) => v.vehicle_id === vehicleId);
        const driver: any = (this.repo as any).employees?.find?.((e: any) => e.employee_id === p.driverId);
        const active = !!shift && ACTIVE_SHIFT_STATUS.includes(String(shift.status));

        // 1) Vị trí realtime — hiện xe trên Live Map ngay khi tài xế đăng nhập.
        const prev = this.presence.get(vehicleId);
        const prevAt = Date.parse(String(prev?.lastUpdate || ''));
        const at = Date.parse(recordedAt);
        if (!prev || !Number.isFinite(prevAt) || !Number.isFinite(at) || at >= prevAt) {
          this.presence.set(vehicleId, {
            vehicleId,
            licensePlate: String(vehicle?.license_plate || 'Xe'),
            driverId: String(p.driverId || ''),
            driverName: String(driver?.full_name || ''),
            shiftId: String(shift?.shift_id || ''),
            shiftStatus: String(shift?.status || ''),
            latitude: p.latitude,
            longitude: p.longitude,
            speed: Number(p.speed || 0),
            heading: Number(p.heading || 0),
            battery: Number(p.battery ?? vehicle?.current_battery_pct ?? 0),
            accuracy: Number(p.accuracy || 0),
            lastUpdate: recordedAt,
            isOnline: true,
          });
        }

        // 2) Lịch sử ca — chỉ khi ca đang chạy.
        if (active && shift) {
          const point: EVGPSPoint = {
            point_id: '',
            shift_id: shift.shift_id,
            driver_id: p.driverId,
            vehicle_id: vehicleId,
            recorded_at: recordedAt,
            latitude: p.latitude,
            longitude: p.longitude,
            accuracy_m: p.accuracy,
            speed_kmh: p.speed,
            heading: p.heading,
            battery_pct: p.battery,
            is_mock: p.isMock || false,
            created_at: new Date().toISOString(),
          };
          await this.repo.createEVGpsPoints([point as Partial<EVGPSPoint>]);
        }

        saved++;
      } catch {
        failed++;
      }
    }

    return { saved, failed };
  }

  /** Lấy lịch sử GPS của ca */
  async getShiftGPSHistory(shiftId: string, limit = 1000): Promise<EVGPSPoint[]> {
    return this.repo.evGpsPoints
      .filter(p => p.shift_id === shiftId)
      .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
      .slice(-limit);
  }

  /** Lấy vị trí hiện tại của xe */
  async getVehicleLatestGPS(vehicleId: string): Promise<EVGPSPoint | null> {
    const points = this.repo.evGpsPoints
      .filter(p => p.vehicle_id === vehicleId)
      .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
    return points[0] || null;
  }

  /** Lấy vị trí hiện tại của tài xế */
  async getDriverLatestGPS(driverId: string): Promise<EVGPSPoint | null> {
    const points = this.repo.evGpsPoints
      .filter(p => p.driver_id === driverId)
      .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
    return points[0] || null;
  }

  /** Vị trí realtime của một xe (nếu đang online). */
  getVehiclePresence(vehicleId: string): EVLiveVehicle | null {
    const p = this.presence.get(String(vehicleId || ''));
    if (!p || !this.isFresh(p.lastUpdate)) return null;
    return p;
  }

  /**
   * Tất cả xe đang hiển thị trên Live Map.
   *
   * Gồm cả xe đang chạy ca và xe vừa đăng nhập app (chưa bấm bắt đầu ca), miễn
   * là còn gửi GPS trong 5 phút gần nhất.
   */
  async getLiveVehicles(): Promise<EVLiveVehicle[]> {
    const now = Date.now();
    const out = new Map<string, EVLiveVehicle>();

    // Xe đang chạy ca: ưu tiên vị trí realtime, fallback điểm GPS cuối trong ca.
    // (Ca còn chạy thì vẫn giữ vị trí cuối để điều phối biết xe đang ở đâu,
    //  UI tự gắn nhãn "GPS cũ" nếu quá 90 giây.)
    const liveShifts = this.repo.evShifts.filter(s => ACTIVE_SHIFT_STATUS.includes(String(s.status)));
    for (const shift of liveShifts) {
      const presence = this.getVehiclePresence(shift.vehicle_id);
      const latest = presence || await this.getVehicleLatestGPS(shift.vehicle_id);
      if (!latest) continue;
      const at = 'lastUpdate' in latest ? latest.lastUpdate : latest.recorded_at;
      const vehicle: any = (this.repo as any).evVehicles?.find?.((v: any) => v.vehicle_id === shift.vehicle_id);
      const driver: any = (this.repo as any).employees?.find?.((e: any) => e.employee_id === shift.driver_id);
      out.set(shift.vehicle_id, {
        vehicleId: shift.vehicle_id,
        licensePlate: String(vehicle?.license_plate || 'Xe'),
        driverId: shift.driver_id,
        driverName: String(driver?.full_name || ''),
        shiftId: shift.shift_id,
        shiftStatus: String(shift.status || ''),
        latitude: Number(latest.latitude || 0),
        longitude: Number(latest.longitude || 0),
        speed: Number(('speed' in latest ? latest.speed : latest.speed_kmh) || 0),
        heading: Number(latest.heading || 0),
        battery: Number(('battery' in latest ? latest.battery : latest.battery_pct) || 0),
        accuracy: Number(('accuracy' in latest ? latest.accuracy : latest.accuracy_m) || 0),
        lastUpdate: at,
        isOnline: true,
      });
    }

    // Xe online nhưng chưa vào ca (hoặc vừa kết thúc ca) — vẫn cho quan sát.
    for (const [vehicleId, p] of this.presence.entries()) {
      if (out.has(vehicleId)) continue;
      if (!this.isFresh(p.lastUpdate, now)) {
        this.presence.delete(vehicleId);
        continue;
      }
      out.set(vehicleId, { ...p, isOnline: true });
    }

    return Array.from(out.values());
  }

  /** Dọn dẹp GPS points cũ (giữ 90 ngày) */
  async cleanupOldGPSPoints(retentionDays = 90): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffISO = cutoff.toISOString();

    // Ghi qua repo để xóa cả trong PostgreSQL (pruneEVGpsPoints).
    return this.repo.pruneEVGpsPoints(cutoffISO);
  }
}
