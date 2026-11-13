/**
 * Phiếu đổi lộ trình giao sữa (MilkRoute EV).
 *
 * Luồng nghiệp vụ:
 *   1. Nhân sự (HR/ADMIN) tạo phiếu: chọn lộ trình + sản phẩm + khoảng ngày
 *      hiệu lực + danh sách điểm dừng mới.
 *   2. Phiếu ở trạng thái PENDING và chờ Giám đốc (DIRECTOR/ADMIN) ký duyệt.
 *   3. Khi APPROVED, mọi ca có `shift_date` trong [effective_from, effective_to]
 *      sẽ dùng danh sách điểm dừng của phiếu (xem EVRouteService.getEffectiveStops).
 *
 * Mọi ghi dữ liệu đi qua repo method (createEVRouteChangeRequest/...)
 * → persist PostgreSQL hoặc snapshot (chế độ Google Sheets).
 */
import { MockSheetsAdapter } from '../../repositories/mock-sheets.adapter.js';
import {
  EVRouteChangeRequest,
  EVRouteChangeStatus,
  EVRouteChangeStop,
} from '@ubm/shared';

export interface RouteChangeActor {
  employeeId?: string;
  username?: string;
  fullName?: string;
  role?: string;
}

export interface RouteChangeListFilters {
  routeId?: string;
  status?: EVRouteChangeStatus;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function norm(value: any): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function actorId(actor?: RouteChangeActor): string {
  return String(actor?.employeeId || actor?.username || '').trim() || 'SYSTEM';
}

function actorName(actor?: RouteChangeActor): string | undefined {
  return String(actor?.fullName || actor?.username || '').trim() || undefined;
}

function overlaps(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return String(aFrom).slice(0, 10) <= String(bTo).slice(0, 10)
    && String(bFrom).slice(0, 10) <= String(aTo).slice(0, 10);
}

export class EVRouteChangeService {
  constructor(private readonly repo: MockSheetsAdapter) {}

  // ============================================================
  // ĐỌC
  // ============================================================

  async listRequests(filters?: RouteChangeListFilters): Promise<EVRouteChangeRequest[]> {
    let list = this.repo.evRouteChangeRequests.slice();
    if (filters?.routeId) list = list.filter(r => r.route_id === filters.routeId);
    if (filters?.status) list = list.filter(r => r.status === filters.status);
    if (filters?.date) {
      const day = String(filters.date).slice(0, 10);
      list = list.filter(r => String(r.effective_from).slice(0, 10) <= day
        && String(r.effective_to).slice(0, 10) >= day);
    }
    if (filters?.dateFrom) {
      list = list.filter(r => String(r.effective_to).slice(0, 10) >= String(filters.dateFrom).slice(0, 10));
    }
    if (filters?.dateTo) {
      list = list.filter(r => String(r.effective_from).slice(0, 10) <= String(filters.dateTo).slice(0, 10));
    }
    list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const offset = Math.max(0, Number(filters?.offset) || 0);
    const limit = Number(filters?.limit) > 0 ? Number(filters!.limit) : 100;
    return list.slice(offset, offset + limit).map(r => this.clone(r));
  }

  async getRequest(requestId: string): Promise<EVRouteChangeRequest | null> {
    const found = this.repo.evRouteChangeRequests.find(r => r.request_id === requestId);
    return found ? this.clone(found) : null;
  }

  /** Phiếu đã duyệt đang có hiệu lực trong ngày (dùng cho màn hình lộ trình). */
  async getEffectiveRequest(routeId: string, date: string, productName?: string): Promise<EVRouteChangeRequest | null> {
    const day = String(date || '').slice(0, 10);
    if (!DATE_RE.test(day)) return null;
    const wanted = norm(productName);
    const candidates = this.repo.evRouteChangeRequests
      .filter(r => r.route_id === routeId
        && r.status === 'APPROVED'
        && String(r.effective_from).slice(0, 10) <= day
        && String(r.effective_to).slice(0, 10) >= day)
      .sort((a, b) => String(b.approved_at || b.updated_at || b.created_at)
        .localeCompare(String(a.approved_at || a.updated_at || a.created_at)));
    if (!candidates.length) return null;
    if (wanted) {
      return candidates.find(r => norm(r.product_name) === wanted)
        || candidates.find(r => !norm(r.product_name))
        || null;
    }
    return candidates.find(r => !norm(r.product_name)) || candidates[0];
  }

  // ============================================================
  // GHI
  // ============================================================

  async createRequest(input: {
    route_id: string;
    product_name?: string;
    effective_from: string;
    effective_to: string;
    reason?: string;
    stops: EVRouteChangeStop[];
  }, actor?: RouteChangeActor): Promise<EVRouteChangeRequest> {
    const route = this.repo.evRoutes.find(r => r.route_id === String(input.route_id || '').trim());
    if (!route) throw new Error('ROUTE_NOT_FOUND: Không tìm thấy lộ trình');

    const from = String(input.effective_from || '').slice(0, 10);
    const to = String(input.effective_to || '').slice(0, 10);
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      throw new Error('ROUTE_CHANGE_INVALID_DATE: Ngày hiệu lực không hợp lệ (YYYY-MM-DD)');
    }
    if (from > to) {
      throw new Error('ROUTE_CHANGE_INVALID_DATE: Ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
    }

    const productName = String(input.product_name || '').trim();
    const stops = this.normalizeStops(input.stops);
    this.assertNoOverlap(route.route_id, productName, from, to);

    return this.repo.createEVRouteChangeRequest({
      route_id: route.route_id,
      route_name: route.name,
      product_name: productName || undefined,
      effective_from: from,
      effective_to: to,
      reason: String(input.reason || '').trim() || undefined,
      status: 'PENDING',
      stops,
      created_by: actorId(actor),
      created_by_name: actorName(actor),
      submitted_at: new Date().toISOString(),
    });
  }

  async updateRequest(requestId: string, input: {
    product_name?: string;
    effective_from?: string;
    effective_to?: string;
    reason?: string;
    stops?: EVRouteChangeStop[];
  }, _actor?: RouteChangeActor): Promise<EVRouteChangeRequest> {
    const current = this.repo.evRouteChangeRequests.find(r => r.request_id === requestId);
    if (!current) throw new Error('ROUTE_CHANGE_NOT_FOUND: Không tìm thấy phiếu đổi lộ trình');
    if (current.status !== 'PENDING') {
      throw new Error('ROUTE_CHANGE_NOT_PENDING: Chỉ sửa được phiếu đang chờ duyệt');
    }

    const from = String(input.effective_from ?? current.effective_from).slice(0, 10);
    const to = String(input.effective_to ?? current.effective_to).slice(0, 10);
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
      throw new Error('ROUTE_CHANGE_INVALID_DATE: Khoảng ngày hiệu lực không hợp lệ');
    }
    const productName = input.product_name !== undefined
      ? String(input.product_name || '').trim()
      : String(current.product_name || '').trim();
    this.assertNoOverlap(current.route_id, productName, from, to, requestId);

    const updates: Partial<EVRouteChangeRequest> = {
      product_name: productName || undefined,
      effective_from: from,
      effective_to: to,
      reason: input.reason !== undefined
        ? (String(input.reason || '').trim() || undefined)
        : current.reason,
    };
    if (input.stops !== undefined) updates.stops = this.normalizeStops(input.stops);
    return this.repo.updateEVRouteChangeRequest(requestId, updates);
  }

  /** Giám đốc ký duyệt — phiếu có hiệu lực ngay theo khoảng ngày đã chọn. */
  async approveRequest(requestId: string, actor?: RouteChangeActor, notes?: string): Promise<EVRouteChangeRequest> {
    const current = this.repo.evRouteChangeRequests.find(r => r.request_id === requestId);
    if (!current) throw new Error('ROUTE_CHANGE_NOT_FOUND: Không tìm thấy phiếu đổi lộ trình');
    if (current.status !== 'PENDING') {
      throw new Error('ROUTE_CHANGE_NOT_PENDING: Phiếu không ở trạng thái chờ duyệt');
    }

    // Chặn 2 phiếu đã duyệt trùng khoảng ngày (cùng lộ trình + sản phẩm).
    const conflict = this.repo.evRouteChangeRequests.find(r => r.request_id !== requestId
      && r.route_id === current.route_id
      && r.status === 'APPROVED'
      && overlaps(r.effective_from, r.effective_to, current.effective_from, current.effective_to)
      && (norm(r.product_name) === norm(current.product_name)
        || !norm(current.product_name) || !norm(r.product_name)));
    if (conflict) {
      throw new Error(`ROUTE_CHANGE_OVERLAP: Đã có phiếu ${conflict.request_code || conflict.request_id} có hiệu lực trùng khoảng ngày`);
    }

    const now = new Date().toISOString();
    return this.repo.updateEVRouteChangeRequest(requestId, {
      status: 'APPROVED',
      approved_by: actorId(actor),
      approved_by_name: actorName(actor),
      approved_at: now,
      approval_notes: notes ? String(notes).trim() : current.approval_notes,
    });
  }

  async rejectRequest(requestId: string, actor: RouteChangeActor | undefined, reason: string): Promise<EVRouteChangeRequest> {
    const current = this.repo.evRouteChangeRequests.find(r => r.request_id === requestId);
    if (!current) throw new Error('ROUTE_CHANGE_NOT_FOUND: Không tìm thấy phiếu đổi lộ trình');
    if (current.status !== 'PENDING') {
      throw new Error('ROUTE_CHANGE_NOT_PENDING: Phiếu không ở trạng thái chờ duyệt');
    }
    return this.repo.updateEVRouteChangeRequest(requestId, {
      status: 'REJECTED',
      rejected_by: actorId(actor),
      rejected_by_name: actorName(actor),
      rejected_at: new Date().toISOString(),
      rejected_reason: String(reason || '').trim() || 'Không duyệt',
    });
  }

  async cancelRequest(requestId: string, actor?: RouteChangeActor, reason?: string): Promise<EVRouteChangeRequest> {
    const current = this.repo.evRouteChangeRequests.find(r => r.request_id === requestId);
    if (!current) throw new Error('ROUTE_CHANGE_NOT_FOUND: Không tìm thấy phiếu đổi lộ trình');
    if (current.status === 'CANCELLED' || current.status === 'REJECTED') {
      throw new Error('ROUTE_CHANGE_INVALID_STATUS: Phiếu đã kết thúc, không thể hủy');
    }
    return this.repo.updateEVRouteChangeRequest(requestId, {
      status: 'CANCELLED',
      cancelled_by: actorId(actor),
      cancelled_at: new Date().toISOString(),
      cancel_reason: String(reason || '').trim() || undefined,
    });
  }

  // ============================================================
  // HELPERS
  // ============================================================

  private clone(request: EVRouteChangeRequest): EVRouteChangeRequest {
    return { ...request, stops: (request.stops || []).map(s => ({ ...s })) };
  }

  /** Sắp xếp lại thứ tự + kiểm tra cấu trúc tối thiểu của danh sách điểm dừng. */
  private normalizeStops(input: EVRouteChangeStop[]): EVRouteChangeStop[] {
    const list = Array.isArray(input) ? input : [];
    if (list.length < 2) {
      throw new Error('ROUTE_CHANGE_STOPS_REQUIRED: Lộ trình phải có ít nhất 2 điểm dừng');
    }
    const sorted = list
      .map(s => ({ ...s }))
      .sort((a, b) => Number(a.stop_order) - Number(b.stop_order))
      .map((s, i) => ({ ...s, stop_order: i + 1 }));

    if (sorted[0].stop_type !== 'START') {
      throw new Error('ROUTE_CHANGE_INVALID_STOPS: Điểm đầu tiên phải là điểm xuất phát (START)');
    }
    if (sorted[sorted.length - 1].stop_type !== 'END') {
      throw new Error('ROUTE_CHANGE_INVALID_STOPS: Điểm cuối cùng phải là điểm kết thúc (END)');
    }
    const seenStopIds = new Set<string>();
    for (const s of sorted) {
      if (!String(s.name || '').trim()) {
        throw new Error('ROUTE_CHANGE_INVALID_STOPS: Tên điểm dừng không được để trống');
      }
      const sid = String(s.stop_id || '').trim();
      if (sid) {
        if (seenStopIds.has(sid)) {
          throw new Error(`ROUTE_CHANGE_INVALID_STOPS: Điểm "${s.name}" bị trùng id với điểm khác`);
        }
        seenStopIds.add(sid);
      }
      const lat = Number(s.latitude);
      const lng = Number(s.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        throw new Error(`ROUTE_CHANGE_INVALID_STOPS: Toạ độ điểm "${s.name}" không hợp lệ`);
      }
      // Trạm sạc không có GPS cố định; điểm khác phải có toạ độ hoặc gắn chi nhánh.
      if (s.stop_type !== 'CHARGING' && lat === 0 && lng === 0 && !String(s.branch_id || '').trim()) {
        throw new Error(`ROUTE_CHANGE_INVALID_STOPS: Điểm "${s.name}" chưa có toạ độ hoặc chi nhánh`);
      }
    }
    return sorted;
  }

  private assertNoOverlap(
    routeId: string,
    productName: string,
    from: string,
    to: string,
    excludeId?: string,
  ): void {
    const conflict = this.repo.evRouteChangeRequests.find(r => r.request_id !== excludeId
      && r.route_id === routeId
      && (r.status === 'PENDING' || r.status === 'APPROVED')
      && overlaps(r.effective_from, r.effective_to, from, to)
      && (norm(r.product_name) === norm(productName)
        || !norm(productName) || !norm(r.product_name)));
    if (conflict) {
      throw new Error(`ROUTE_CHANGE_OVERLAP: Đã có phiếu ${conflict.request_code || conflict.request_id} cho cùng lộ trình/sản phẩm trong khoảng ngày này`);
    }
  }
}
