import { MockSheetsAdapter } from '../../repositories/mock-sheets.adapter.js';
import { EVVehicle } from '@ubm/shared';

export class EVVehicleService {
  constructor(private readonly repo: MockSheetsAdapter) {}

  /** Tạo xe điện mới */
  async createVehicle(input: Omit<EVVehicle, 'vehicle_id' | 'created_at' | 'updated_at' | 'version'>): Promise<EVVehicle> {
    // Ghi qua repo để PostgresAdapter persist xuống bảng ev_vehicles.
    return this.repo.createEVVehicle(input as Partial<EVVehicle>);
  }

  /** Cập nhật xe điện */
  async updateVehicle(vehicleId: string, input: Partial<Omit<EVVehicle, 'vehicle_id' | 'created_at' | 'version'>>): Promise<EVVehicle | null> {
    try {
      return await this.repo.updateEVVehicle(vehicleId, input as Partial<EVVehicle>);
    } catch (err: any) {
      if (String(err?.message || '').startsWith('VEHICLE_NOT_FOUND')) return null;
      throw err;
    }
  }

  /** Xóa xe điện */
  async deleteVehicle(vehicleId: string): Promise<boolean> {
    return this.repo.deleteEVVehicle(vehicleId);
  }

  /** Lấy xe theo ID */
  async getVehicle(vehicleId: string): Promise<EVVehicle | null> {
    return this.repo.evVehicles.find(v => v.vehicle_id === vehicleId) || null;
  }

  /** Lấy xe theo biển số */
  async getVehicleByPlate(licensePlate: string): Promise<EVVehicle | null> {
    return this.repo.evVehicles.find(v => v.license_plate === licensePlate) || null;
  }

  /** Lấy xe theo tài xế được gán */
  async getVehicleByDriver(driverId: string): Promise<EVVehicle | null> {
    return this.repo.evVehicles.find(v => v.assigned_driver_id === driverId) || null;
  }

  /** Lấy danh sách xe (có filter) */
  async listVehicles(filters?: {
    status?: EVVehicle['status'];
    assignedDriverId?: string;
  }): Promise<EVVehicle[]> {
    let vehicles = this.repo.evVehicles;
    if (filters?.status) {
      vehicles = vehicles.filter(v => v.status === filters.status);
    }
    if (filters?.assignedDriverId) {
      vehicles = vehicles.filter(v => v.assigned_driver_id === filters.assignedDriverId);
    }
    return vehicles.sort((a, b) => a.license_plate.localeCompare(b.license_plate));
  }

  /** Gán tài xế cho xe */
  async assignDriver(vehicleId: string, driverId: string | null): Promise<EVVehicle | null> {
    return this.updateVehicle(vehicleId, { assigned_driver_id: driverId || undefined });
  }

  /** Cập nhật % pin */
  async updateBattery(vehicleId: string, batteryPct: number): Promise<EVVehicle | null> {
    const clamped = Math.max(0, Math.min(100, Math.round(batteryPct)));
    return this.updateVehicle(vehicleId, { current_battery_pct: clamped });
  }
}