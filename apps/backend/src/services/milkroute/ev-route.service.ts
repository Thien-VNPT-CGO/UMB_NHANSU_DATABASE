import { MockSheetsAdapter } from '../../repositories/mock-sheets.adapter.js';
import { EVRoute, EVRouteStop } from '@ubm/shared';

/**
 * Từ khoá nhận diện điểm dừng của từng chi nhánh (dữ liệu seed cũ chưa có
 * branch_id). So khớp trên tên + địa chỉ điểm dừng đã bỏ dấu, nên không phụ
 * thuộc việc Admin có đổi tên/địa chỉ chi nhánh hay không.
 */
const BRANCH_STOP_KEYWORDS: Record<string, string[]> = {
  CN130: ['ch130', '130 van kiep'],
  CN261: ['ch261', '261 to hien thanh'],
  CN120: ['ch120', '120 hoang dieu'],
  CN111: ['ch111', '111 ton dan'],
  XUONG_SX: ['xuong san xuat', 'bui cong trung'],
  VAN_PHONG: ['tru so', 'van phong', 'dang thai mai'],
};

/** Bỏ dấu tiếng Việt + chuẩn hoá khoảng trắng để so khớp ổn định. */
function normalizeText(value: any): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export class EVRouteService {
  constructor(private readonly repo: MockSheetsAdapter) {}

  // ============================================================
  // ROUTES
  // ============================================================

  async createRoute(input: Omit<EVRoute, 'route_id' | 'created_at' | 'updated_at' | 'version'>): Promise<EVRoute> {
    return this.repo.createEVRoute(input as Partial<EVRoute>);
  }

  async updateRoute(routeId: string, input: Partial<Omit<EVRoute, 'route_id' | 'created_at' | 'version'>>): Promise<EVRoute | null> {
    try {
      return await this.repo.updateEVRoute(routeId, input as Partial<EVRoute>);
    } catch (err: any) {
      if (String(err?.message || '').startsWith('ROUTE_NOT_FOUND')) return null;
      throw err;
    }
  }

  async deleteRoute(routeId: string): Promise<boolean> {
    // Check if any stops/shifts reference this route (repo cũng kiểm lại khi ghi).
    if (this.repo.evRouteStops.some(s => s.route_id === routeId)) {
      throw new Error('ROUTE_HAS_STOPS: Không thể xóa lộ trình đang có điểm dừng');
    }
    if (this.repo.evShifts.some(s => s.route_id === routeId)) {
      throw new Error('ROUTE_HAS_SHIFTS: Không thể xóa lộ trình đang có ca vận chuyển');
    }
    return this.repo.deleteEVRoute(routeId);
  }

  async getRoute(routeId: string): Promise<EVRoute | null> {
    return this.repo.evRoutes.find(r => r.route_id === routeId) || null;
  }

  async listRoutes(filters?: { isActive?: boolean }): Promise<EVRoute[]> {
    let routes = this.repo.evRoutes;
    if (filters?.isActive !== undefined) {
      routes = routes.filter(r => r.is_active === filters.isActive);
    }
    return routes.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getActiveRoute(): Promise<EVRoute | null> {
    return this.repo.evRoutes.find(r => r.is_active) || null;
  }

  // ============================================================
  // ROUTE STOPS
  // ============================================================

  async createRouteStop(input: Omit<EVRouteStop, 'stop_id' | 'created_at' | 'updated_at' | 'version'>): Promise<EVRouteStop> {
    // Validate route exists
    const route = await this.getRoute(input.route_id);
    if (!route) throw new Error('ROUTE_NOT_FOUND');
    return this.repo.createEVRouteStop(input as Partial<EVRouteStop>);
  }

  async updateRouteStop(stopId: string, input: Partial<Omit<EVRouteStop, 'stop_id' | 'created_at' | 'version'>>): Promise<EVRouteStop | null> {
    try {
      return await this.repo.updateEVRouteStop(stopId, input as Partial<EVRouteStop>);
    } catch (err: any) {
      if (String(err?.message || '').startsWith('STOP_NOT_FOUND')) return null;
      throw err;
    }
  }

  async deleteRouteStop(stopId: string): Promise<boolean> {
    // Check if any checkins reference this stop
    const hasCheckins = this.repo.evShiftCheckins.some(c => c.stop_id === stopId);
    if (hasCheckins) {
      throw new Error('STOP_HAS_CHECKINS: Không thể xóa điểm dừng đã có check-in');
    }
    return this.repo.deleteEVRouteStop(stopId);
  }

  async getRouteStop(stopId: string): Promise<EVRouteStop | null> {
    return this.repo.evRouteStops.find(s => s.stop_id === stopId) || null;
  }

  async listRouteStops(routeId: string): Promise<EVRouteStop[]> {
    return this.repo.evRouteStops
      .filter(s => s.route_id === routeId)
      .sort((a, b) => a.stop_order - b.stop_order);
  }

  async getMandatoryStops(routeId: string): Promise<EVRouteStop[]> {
    return (await this.listRouteStops(routeId)).filter(s => s.is_mandatory);
  }

  // ============================================================
  // ĐỒNG BỘ TOẠ ĐỘ THEO CHI NHÁNH
  // ============================================================

  /**
   * Điểm dừng nào thuộc chi nhánh `branchId`?
   * - Ưu tiên branch_id đã gắn (chuẩn mới).
   * - Dữ liệu cũ: so khớp tên/địa chỉ điểm dừng với bộ từ khoá của chi nhánh.
   * - Bỏ qua điểm sạc (toạ độ ghim động khi tài xế sạc).
   */
  private stopBelongsToBranch(stop: EVRouteStop, branchId: string): boolean {
    if (stop.stop_type === 'CHARGING') return false;
    if (stop.branch_id) return stop.branch_id === branchId;
    const id = normalizeText(branchId);
    const haystack = `${normalizeText(stop.name)} | ${normalizeText(stop.address)}`;
    if (id && haystack.includes(id)) return true;
    const keywords = BRANCH_STOP_KEYWORDS[branchId] || [];
    return keywords.some((k) => haystack.includes(normalizeText(k)));
  }

  /**
   * Cập nhật toạ độ các điểm dừng của một chi nhánh theo cấu hình mới nhất
   * trong tab Quản Lý Chi Nhánh. Trả về số điểm dừng đã cập nhật.
   */
  async syncBranchStops(branch: {
    id?: string;
    branch_id?: string;
    latitude?: number | string;
    longitude?: number | string;
  }): Promise<number> {
    const branchId = String(branch?.id ?? branch?.branch_id ?? '').trim();
    const latitude = Number(branch?.latitude);
    const longitude = Number(branch?.longitude);
    if (!branchId) return 0;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return 0;
    // (0,0) = chi nhánh chưa ghim toạ độ trên bản đồ → giữ nguyên điểm dừng.
    if (latitude === 0 && longitude === 0) return 0;

    let updated = 0;
    for (const stop of this.repo.evRouteStops) {
      if (!this.stopBelongsToBranch(stop, branchId)) continue;
      const sameCoords = Number(stop.latitude) === latitude && Number(stop.longitude) === longitude;
      if (sameCoords && stop.branch_id === branchId) continue;
      await this.repo.updateEVRouteStop(stop.stop_id, {
        latitude,
        longitude,
        branch_id: branchId,
      } as Partial<EVRouteStop>);
      updated++;
    }
    return updated;
  }

  /**
   * Đồng bộ toạ độ toàn bộ điểm dừng theo danh sách chi nhánh hiện tại.
   * Chạy lúc khởi động để dữ liệu seed cũ (chưa gắn branch_id) khớp ngay với
   * tab Quản Lý Chi Nhánh mà Admin đã cấu hình trước đó.
   */
  async syncAllBranchStops(branches: any[]): Promise<number> {
    let total = 0;
    for (const branch of Array.isArray(branches) ? branches : []) {
      total += await this.syncBranchStops(branch);
    }
    return total;
  }
}