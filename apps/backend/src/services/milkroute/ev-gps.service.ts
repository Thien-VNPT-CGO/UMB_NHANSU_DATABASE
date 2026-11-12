import { MockSheetsAdapter } from '../../repositories/mock-sheets.adapter.js';
import { EVGPSPoint } from '@ubm/shared';

export class EVGPSService {
  constructor(private readonly repo: MockSheetsAdapter) {}

  /** Ghi nhận điểm GPS (batch) */
  async ingestGPSPoints(points: Array<{
    shiftId: string;
    driverId: string;
    vehicleId: string;
    recordedAt: string;
    latitude: number;
    longitude: number;
    accuracy?: number;
    speed?: number;
    heading?: number;
    battery?: number;
    isMock?: boolean;
  }>): Promise<{ saved: number; failed: number }> {
    let saved = 0;
    let failed = 0;

    for (const p of points) {
      try {
        // Validate shift exists and is in progress
        const shift = this.repo.evShifts.find(s => s.shift_id === p.shiftId);
        if (!shift) {
          failed++;
          continue;
        }
        if (shift.status !== 'IN_PROGRESS' && shift.status !== 'CHARGING' && shift.status !== 'RETURNING') {
          // Still save but mark as mock or ignore
        }

        // Validate coordinates
        if (p.latitude < -90 || p.latitude > 90 || p.longitude < -180 || p.longitude > 180) {
          failed++;
          continue;
        }

        const point: EVGPSPoint = {
          point_id: '',
          shift_id: p.shiftId,
          driver_id: p.driverId,
          vehicle_id: p.vehicleId,
          recorded_at: p.recordedAt,
          latitude: p.latitude,
          longitude: p.longitude,
          accuracy_m: p.accuracy,
          speed_kmh: p.speed,
          heading: p.heading,
          battery_pct: p.battery,
          is_mock: p.isMock || false,
          created_at: new Date().toISOString(),
        };

        // Ghi qua repo (batch theo từng điểm) để persist xuống ev_gps_points.
        const [savedPoint] = await this.repo.createEVGpsPoints([point as Partial<EVGPSPoint>]);
        if (savedPoint) saved++;
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

  /** Lấy tất cả xe đang chạy realtime */
  async getLiveVehicles(): Promise<Array<{
    vehicleId: string;
    licensePlate: string;
    driverId: string;
    driverName: string;
    shiftId: string;
    latitude: number;
    longitude: number;
    speed: number;
    heading: number;
    battery: number;
    lastUpdate: string;
  }>> {
    const liveShifts = this.repo.evShifts.filter(s => ['IN_PROGRESS', 'CHARGING', 'RETURNING'].includes(s.status));
    const vehicles: Array<any> = [];

    for (const shift of liveShifts) {
      const latestGPS = await this.getVehicleLatestGPS(shift.vehicle_id);
      if (latestGPS) {
        const vehicle = this.repo.evVehicles.find(v => v.vehicle_id === shift.vehicle_id);
        const driver = this.repo.employees.find(e => e.employee_id === shift.driver_id);
        vehicles.push({
          vehicleId: shift.vehicle_id,
          licensePlate: vehicle?.license_plate || 'Unknown',
          driverId: shift.driver_id,
          driverName: driver?.full_name || 'Unknown',
          shiftId: shift.shift_id,
          latitude: latestGPS.latitude,
          longitude: latestGPS.longitude,
          speed: latestGPS.speed_kmh || 0,
          heading: latestGPS.heading || 0,
          battery: latestGPS.battery_pct || 0,
          lastUpdate: latestGPS.recorded_at,
        });
      }
    }

    return vehicles;
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