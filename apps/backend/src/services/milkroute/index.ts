/**
 * MilkRoute EV Module
 * Hệ thống quản lý lộ trình vận chuyển sữa bằng xe điện
 */

import { MockSheetsAdapter } from '../../repositories/mock-sheets.adapter.js';
import { EVVehicleService } from './ev-vehicle.service.js';
import { EVRouteService } from './ev-route.service.js';
import { EVShiftService } from './ev-shift.service.js';
import { EVCheckinService } from './ev-checkin.service.js';
import { EVChargingService } from './ev-charging.service.js';
import { EVGPSService } from './ev-gps.service.js';
import { EVPayrollService } from './ev-payroll.service.js';
import { EVRealtimeService, evRealtimeService } from './ev-realtime.service.js';

export class MilkRouteModule {
  public readonly vehicles: EVVehicleService;
  public readonly routes: EVRouteService;
  public readonly shifts: EVShiftService;
  public readonly checkins: EVCheckinService;
  public readonly charging: EVChargingService;
  public readonly gps: EVGPSService;
  public readonly payroll: EVPayrollService;
  public readonly realtime: EVRealtimeService;

  constructor(private readonly repo: MockSheetsAdapter) {
    this.vehicles = new EVVehicleService(repo);
    this.routes = new EVRouteService(repo);
    this.shifts = new EVShiftService(repo);
    this.checkins = new EVCheckinService(repo);
    this.charging = new EVChargingService(repo);
    this.gps = new EVGPSService(repo);
    this.payroll = new EVPayrollService(repo);
    this.realtime = evRealtimeService;
  }

  /** Danh sách chi nhánh hiện tại (tab Quản Lý Chi Nhánh). */
  private async currentBranches(): Promise<any[]> {
    const repo: any = this.repo as any;
    if (Array.isArray(repo.branches) && repo.branches.length) return repo.branches;
    if (typeof repo.getBranches === 'function') {
      try {
        const list = await repo.getBranches();
        return Array.isArray(list) ? list : [];
      } catch { /* không chặn khởi động */ }
    }
    return [];
  }

  /** Khởi tạo dữ liệu mẫu (seed) */
  async seedDefaultData(): Promise<void> {
    // Đã seed trước đây: vẫn đồng bộ toạ độ điểm dừng theo cấu hình chi nhánh
    // hiện tại để Live Map + geofence check-in khớp tab Quản Lý Chi Nhánh.
    if (this.repo.evRoutes.length > 0) {
      await this.routes.syncAllBranchStops(await this.currentBranches());
      return;
    }

    console.log('[MilkRoute] Seeding default route data...');

    // Create default route: MILK_ROUTE_HCM
    const route = await this.routes.createRoute({
      name: 'MILK_ROUTE_HCM',
      description: 'Lộ trình vận chuyển sữa Ụm Bò Milk TP.HCM: Xưởng → CH130 → CH111 → CH261 → Trụ sở → (Trạm sạc) → Xưởng',
      is_active: true,
      total_distance_km: 65,
      estimated_duration_min: 360,
    });

    // Create route stops (from VAN_CHUYEN_SUA_UMBOMILK.md)
    const stops = [
      {
        route_id: route.route_id,
        stop_order: 1,
        name: 'Xưởng Sản Xuất Ụm Bò Milk',
        branch_id: 'XUONG_SX',
        address: '85/14 Bùi Công Trừng, Hóc Môn / Q.12, TP. Hồ Chí Minh',
        latitude: 10.908028,
        longitude: 106.650444,
        geofence_radius_m: 100,
        sla_minutes: 0, // Starting point
        stop_type: 'START' as const,
        is_mandatory: true,
      },
      {
        route_id: route.route_id,
        stop_order: 2,
        name: 'Cửa hàng CH130',
        branch_id: 'CN130',
        address: '130 Vạn Kiếp, Phường 3, Quận Bình Thạnh, TP. Hồ Chí Minh',
        latitude: 10.799831,
        longitude: 106.693370,
        geofence_radius_m: 100,
        sla_minutes: 60,
        stop_type: 'DELIVERY' as const,
        is_mandatory: true,
      },
      {
        route_id: route.route_id,
        stop_order: 3,
        name: 'Cửa hàng CH111',
        branch_id: 'CN111',
        address: '111 Tôn Đản, Phường 15, Quận 4, TP. Hồ Chí Minh',
        latitude: 10.759223,
        longitude: 106.706995,
        geofence_radius_m: 100,
        sla_minutes: 45,
        stop_type: 'DELIVERY' as const,
        is_mandatory: true,
      },
      {
        route_id: route.route_id,
        stop_order: 4,
        name: 'Cửa hàng CH261',
        branch_id: 'CN261',
        address: '261 Tô Hiến Thành, Phường 12, Quận 10, TP. Hồ Chí Minh',
        latitude: 10.778639,
        longitude: 106.666665,
        geofence_radius_m: 100,
        sla_minutes: 45,
        stop_type: 'DELIVERY' as const,
        is_mandatory: true,
      },
      {
        route_id: route.route_id,
        stop_order: 5,
        name: 'Trụ sở chính (Văn phòng)',
        branch_id: 'VAN_PHONG',
        address: 'Số 10 Đặng Thai Mai, Phường Phú Nhuận, TP. Hồ Chí Minh',
        latitude: 10.803040,
        longitude: 106.689620,
        geofence_radius_m: 100,
        sla_minutes: 45,
        stop_type: 'OFFICE' as const,
        is_mandatory: true,
      },
      {
        route_id: route.route_id,
        stop_order: 6,
        name: 'Trạm sạc xe điện',
        address: 'Tự động ghim khi bắt đầu sạc',
        latitude: 0,
        longitude: 0,
        geofence_radius_m: 100,
        sla_minutes: 60,
        stop_type: 'CHARGING' as const,
        is_mandatory: false,
      },
      {
        route_id: route.route_id,
        stop_order: 7,
        name: 'Xưởng Sản Xuất (Kết thúc ca)',
        branch_id: 'XUONG_SX',
        address: '85/14 Bùi Công Trừng, Hóc Môn / Q.12, TP. Hồ Chí Minh',
        latitude: 10.908028,
        longitude: 106.650444,
        geofence_radius_m: 100,
        sla_minutes: 15,
        stop_type: 'END' as const,
        is_mandatory: true,
      },
    ];

    for (const stop of stops) {
      await this.routes.createRouteStop(stop);
    }

    // Toạ độ seed chỉ là mặc định — ưu tiên cấu hình thực tế của Admin.
    await this.routes.syncAllBranchStops(await this.currentBranches());

    console.log('[MilkRoute] Default route seeded successfully.');
  }
}

// Factory function
export function createMilkRouteModule(repo: MockSheetsAdapter): MilkRouteModule {
  return new MilkRouteModule(repo);
}