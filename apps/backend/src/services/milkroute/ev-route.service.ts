import { MockSheetsAdapter } from '../../repositories/mock-sheets.adapter.js';
import { EVRoute, EVRouteChangeRequest, EVRouteStop, EVShift } from '@ubm/shared';

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
  // LỘ TRÌNH HIỆU LỰC THEO NGÀY (phiếu đổi lộ trình đã duyệt)
  // ============================================================

  /** Ngày hôm nay theo giờ Việt Nam (YYYY-MM-DD). */
  private today(): string {
    return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  }

  /**
   * Phiếu đổi lộ trình đã duyệt và đang có hiệu lực trong ngày `date`.
   * - Ưu tiên phiếu khớp đúng sản phẩm của ca.
   * - Ca không gắn sản phẩm: dùng phiếu áp dụng chung, nếu không có thì phiếu
   *   mới duyệt nhất.
   * - Ca gắn sản phẩm nhưng chỉ có phiếu của sản phẩm khác: KHÔNG áp dụng.
   */
  async findEffectiveChangeRequest(
    routeId: string,
    date: string,
    productName?: string,
  ): Promise<EVRouteChangeRequest | null> {
    const day = String(date || '').slice(0, 10);
    if (!routeId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;

    const candidates = this.repo.evRouteChangeRequests
      .filter(r => r.route_id === routeId
        && r.status === 'APPROVED'
        && String(r.effective_from).slice(0, 10) <= day
        && String(r.effective_to).slice(0, 10) >= day)
      .sort((a, b) => String(b.approved_at || b.updated_at || b.created_at)
        .localeCompare(String(a.approved_at || a.updated_at || a.created_at)));
    if (!candidates.length) return null;

    const wanted = normalizeText(productName);
    if (wanted) {
      const exact = candidates.find(r => normalizeText(r.product_name) === wanted);
      if (exact) return exact;
      return candidates.find(r => !normalizeText(r.product_name)) || null;
    }
    return candidates.find(r => !normalizeText(r.product_name)) || candidates[0];
  }

  /** Tìm chi nhánh ứng với điểm dừng để lấy toạ độ mới nhất. */
  private findBranchForStop(stop: any, branches: any[]): any | null {
    if (!stop || stop.stop_type === 'CHARGING') return null;
    const bid = String(stop.branch_id || '').trim();
    if (bid) {
      const byId = branches.find(b => String(b?.id ?? b?.branch_id) === bid);
      if (byId) return byId;
    }
    const hay = `${normalizeText(stop.name)} | ${normalizeText(stop.address)}`;
    return branches.find((b) => {
      const id = normalizeText(b?.id ?? b?.branch_id);
      if (id && hay.includes(id)) return true;
      const kws = BRANCH_STOP_KEYWORDS[String(b?.id ?? b?.branch_id)] || [];
      return kws.some((k) => hay.includes(normalizeText(k)));
    }) || null;
  }

  /** Ghi đè toạ độ điểm dừng bằng cấu hình chi nhánh hiện tại (bỏ trạm sạc). */
  private applyBranchCoords(stops: EVRouteStop[]): EVRouteStop[] {
    const branches: any[] = Array.isArray((this.repo as any).branches) ? (this.repo as any).branches : [];
    if (!branches.length) return stops;
    return stops.map((stop) => {
      if (stop.stop_type === 'CHARGING') return stop;
      const branch = this.findBranchForStop(stop, branches);
      if (!branch) return stop;
      const latitude = Number(branch.latitude);
      const longitude = Number(branch.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return stop;
      if (latitude === 0 && longitude === 0) return stop;
      return { ...stop, latitude, longitude };
    });
  }

  /**
   * Điểm dừng HIỆU LỰC của lộ trình trong ngày `date`:
   * - Có phiếu đổi lộ trình đã duyệt → dùng danh sách điểm dừng trong phiếu.
   * - Không có → lộ trình gốc.
   * Toạ độ luôn lấy theo chi nhánh hiện tại; trạm sạc giữ toạ độ GPS gần nhất.
   */
  async getEffectiveStops(routeId: string, date?: string, productName?: string): Promise<EVRouteStop[]> {
    const base = await this.listRouteStops(routeId);
    const change = await this.findEffectiveChangeRequest(routeId, date || this.today(), productName);
    if (!change) return this.applyBranchCoords(base);

    const baseCharging = base.find(s => s.stop_type === 'CHARGING');
    const mapped: EVRouteStop[] = change.stops
      .slice()
      .sort((a, b) => Number(a.stop_order) - Number(b.stop_order))
      .map((s, i) => {
        const isCharging = s.stop_type === 'CHARGING';
        const useBaseCharging = isCharging && baseCharging
          && (Number(baseCharging.latitude) !== 0 || Number(baseCharging.longitude) !== 0);
        return {
          stop_id: String(s.stop_id || `RCS_${change.request_id}_${s.stop_order}`),
          route_id: routeId,
          stop_order: Number(s.stop_order) || i + 1,
          name: String(s.name || '').trim(),
          branch_id: s.branch_id ? String(s.branch_id) : undefined,
          address: useBaseCharging ? (baseCharging?.address || s.address) : s.address,
          latitude: useBaseCharging ? Number(baseCharging!.latitude) : Number(s.latitude) || 0,
          longitude: useBaseCharging ? Number(baseCharging!.longitude) : Number(s.longitude) || 0,
          geofence_radius_m: Number(s.geofence_radius_m) > 0 ? Number(s.geofence_radius_m) : 100,
          sla_minutes: Number(s.sla_minutes) >= 0 ? Number(s.sla_minutes) : 0,
          stop_type: s.stop_type,
          is_mandatory: s.is_mandatory !== false,
          notes: s.notes,
          change_request_id: change.request_id,
          product_name: change.product_name,
          created_at: change.created_at,
          updated_at: change.updated_at,
          version: 1,
        } as EVRouteStop;
      });
    return this.applyBranchCoords(mapped);
  }

  /**
   * Ca đã có phiếu sạc do tài xế tạo (chưa bị từ chối/hết hạn)?
   * Trạm sạc chỉ được đưa lên lộ trình khi tài xế thực sự đăng ký sạc; chưa
   * có phiếu thì ẩn hẳn để tài xế không thấy điểm dừng thừa trên app.
   */
  private shiftHasChargingTicket(shiftId: string): boolean {
    const tickets: any[] = Array.isArray((this.repo as any).evChargingTickets)
      ? (this.repo as any).evChargingTickets
      : [];
    const ACTIVE_TICKET = ['PENDING_HR', 'PENDING_DIRECTOR', 'APPROVED', 'USED'];
    return tickets.some(t => String(t.shift_id) === String(shiftId)
      && ACTIVE_TICKET.includes(String(t.status)));
  }

  /**
   * Điểm dừng hiệu lực của một ca (theo ngày ca + sản phẩm của ca).
   * Trạm sạc bị ẩn nếu ca chưa có phiếu sạc — có phiếu thì tự hiện lại
   * đúng vị trí trong lộ trình (kể cả khi ca đang chạy).
   */
  async getEffectiveStopsForShift(shift: EVShift): Promise<EVRouteStop[]> {
    const stops = await this.getEffectiveStops(shift.route_id, shift.shift_date, shift.product_name);
    if (this.shiftHasChargingTicket(shift.shift_id)) return stops;
    return stops.filter(s => s.stop_type !== 'CHARGING');
  }

  /** Tìm điểm dừng hiệu lực của ca (dùng cho check-in). */
  async getShiftStop(shift: EVShift, stopId: string): Promise<EVRouteStop | null> {
    const stops = await this.getEffectiveStopsForShift(shift);
    return stops.find(s => s.stop_id === stopId) || null;
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