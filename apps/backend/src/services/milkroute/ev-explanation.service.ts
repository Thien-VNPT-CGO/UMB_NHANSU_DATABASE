/**
 * EVExplanationService — Phiếu giải trình lỗi tài xế.
 *
 * Luồng nghiệp vụ:
 *   1. Tài xế mắc lỗi trong ca:
 *      - Quên bấm xác nhận tại chi nhánh → check-in `is_missed = true`.
 *      - Đến trễ so với SLA của chặng → check-in `is_late = true` (bị trừ phạt
 *        trễ giờ khi chạy bảng lương).
 *   2. App tài xế hiện nút Giải trình: chọn MỘT HOẶC NHIỀU lỗi (có thể khác ca/
 *      khác chi nhánh), nhập nội dung + tải nhiều ảnh bằng chứng cùng lúc.
 *   3. Phiếu đi THẲNG tới Kế toán (FINANCE) / Giám đốc (DIRECTOR) duyệt —
 *      không qua HR.
 *   4. Khi APPROVED: lỗi quên chấm được ghi nhận hoàn thành; lỗi trễ giờ được
 *      xóa cờ trễ + trừ lại điểm phạt của ca. Bảng lương không còn trừ tiền,
 *      hồ sơ tài xế không còn ghi nhận vi phạm.
 *
 * Ảnh: nén ở client → ghi đĩa VPS khi tạo phiếu → DB chỉ lưu metadata.
 */
import { v4 as uuidv4 } from 'uuid';
import {
  DEFAULT_EV_PAYROLL_CONFIG,
  type EVExplanationCandidate,
  type EVExplanationIssueType,
  type EVExplanationItem,
  type EVExplanationPhoto,
  type EVExplanationTicket,
  type EVPayrollConfig,
  type EVShift,
  type EVShiftCheckin,
} from '@ubm/shared';
import { MockSheetsAdapter } from '../../repositories/mock-sheets.adapter.js';
import { EVRouteService } from './ev-route.service.js';
import { isEvTestShift } from './ev-test-mode.js';
import { deleteExplanationPhotos, saveExplanationPhoto } from './ev-explanation-photo.store.js';

const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 3_000_000;
const LOOKBACK_DAYS = 90;

export interface CreateExplanationItemInput {
  shift_id: string;
  stop_id: string;
}

export interface CreateExplanationPhotoInput {
  data_url: string;
  mime_type?: string;
  name?: string;
}

export interface CreateExplanationInput {
  reason: string;
  items: CreateExplanationItemInput[];
  photos: CreateExplanationPhotoInput[];
}

export interface ExplanationListFilters {
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  driverId?: string;
  dateFrom?: string;
  dateTo?: string;
}

function todayVN(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function keyOf(shiftId: string, stopId: string): string {
  return `${String(shiftId || '').trim()}::${String(stopId || '').trim()}`;
}

export class EVExplanationService {
  constructor(
    private readonly repo: MockSheetsAdapter,
    private readonly routes?: EVRouteService,
  ) {}

  private async stopsForShift(shift: EVShift): Promise<any[]> {
    if (this.routes) return this.routes.getEffectiveStopsForShift(shift);
    return this.repo.evRouteStops
      .filter(s => s.route_id === shift.route_id)
      .sort((a, b) => a.stop_order - b.stop_order);
  }

  private routeName(routeId?: string): string | undefined {
    if (!routeId) return undefined;
    return this.repo.evRoutes.find(r => r.route_id === routeId)?.name;
  }

  /**
   * Tiền phạt ước tính của 1 lỗi — dùng đúng công thức bảng lương tài xế
   * (tỉ lệ phạt × lương ngày, theo ngày công chuẩn/2 ngày cuối).
   */
  private estimatedPenalty(shift: EVShift, issue: EVExplanationIssueType): number {
    const cfg: EVPayrollConfig = DEFAULT_EV_PAYROLL_CONFIG;
    const extra = (Number(shift.work_day_index) || 0) > cfg.standard_work_days;
    const dailyRate = extra ? cfg.extra_daily_rate : cfg.standard_daily_rate;
    const rate = issue === 'MISSED_CHECKIN'
      ? (extra ? cfg.penalty_per_missed_checkin.extra : cfg.penalty_per_missed_checkin.standard)
      : (extra ? cfg.penalty_per_late_sla.extra : cfg.penalty_per_late_sla.standard);
    return Math.round(dailyRate * rate);
  }

  /** Các điểm đang chờ giải trình của tài xế (bỏ lọt, chưa có phiếu PENDING/APPROVED). */
  async listCandidates(driverId: string, opts: { lookbackDays?: number } = {}): Promise<EVExplanationCandidate[]> {
    const id = String(driverId || '').trim();
    if (!id) return [];
    const days = Math.min(Math.max(Number(opts.lookbackDays) || LOOKBACK_DAYS, 1), 180);
    const from = addDays(todayVN(), -days);

    const claimed = new Set<string>();
    for (const t of this.repo.evExplanationTickets) {
      if (t.driver_id !== id) continue;
      if (t.status !== 'PENDING' && t.status !== 'APPROVED') continue;
      for (const it of t.items || []) claimed.add(keyOf(it.shift_id, it.stop_id));
    }

    const shifts = this.repo.evShifts
      .filter(s => String(s.driver_id) === id
        && String(s.shift_date).slice(0, 10) >= from
        && String(s.shift_date).slice(0, 10) <= todayVN()
        && s.status !== 'CANCELLED'
        && !isEvTestShift(s))
      .sort((a, b) => String(b.shift_date).localeCompare(String(a.shift_date))
        || String(b.planned_start_at).localeCompare(String(a.planned_start_at)));

    const out: EVExplanationCandidate[] = [];
    for (const shift of shifts) {
      const checkins = this.repo.evShiftCheckins.filter(c => c.shift_id === shift.shift_id);
      const stops = await this.stopsForShift(shift).catch(() => []);
      const stopById = new Map(stops.map((s: any) => [String(s.stop_id), s]));

      // 1. Check-in bị hệ thống đánh dấu bỏ lọt, HOẶC check-in đến trễ SLA
      //    (nguồn phạt trễ giờ khi chạy bảng lương). Một check-in chỉ thuộc
      //    một loại: is_missed ưu tiên trước (check-in bỏ lọt cũng có is_late).
      for (const c of checkins) {
        const issue: EVExplanationIssueType | null = c.is_missed
          ? 'MISSED_CHECKIN'
          : (c.is_late ? 'LATE_SLA' : null);
        if (!issue) continue;
        if (claimed.has(keyOf(c.shift_id, c.stop_id))) continue;
        const stop: any = stopById.get(String(c.stop_id));
        out.push({
          shift_id: shift.shift_id,
          shift_date: String(shift.shift_date).slice(0, 10),
          route_id: shift.route_id,
          route_name: this.routeName(shift.route_id),
          stop_id: String(c.stop_id),
          stop_order: Number(c.stop_order) || Number(stop?.stop_order) || 0,
          stop_name: String(c.stop_name || stop?.name || 'Điểm giao'),
          address: stop?.address,
          checkin_id: c.checkin_id,
          checked_in_at: c.checked_in_at,
          issue_type: issue,
          late_minutes: issue === 'LATE_SLA' ? Number(c.late_minutes) || 0 : undefined,
          penalty_amount: this.estimatedPenalty(shift, issue),
        });
      }

      // 2. Ca đã kết thúc nhưng điểm bắt buộc chưa có check-in nào (dữ liệu cũ
      //    hoặc detectMissedStops chưa chạy) → vẫn cho giải trình.
      if (shift.status === 'COMPLETED') {
        const done = new Set(checkins.map(c => String(c.stop_id)));
        for (const stop of stops) {
          if (!stop.is_mandatory) continue;
          if (done.has(String(stop.stop_id))) continue;
          if (claimed.has(keyOf(shift.shift_id, stop.stop_id))) continue;
          out.push({
            shift_id: shift.shift_id,
            shift_date: String(shift.shift_date).slice(0, 10),
            route_id: shift.route_id,
            route_name: this.routeName(shift.route_id),
            stop_id: stop.stop_id,
            stop_order: Number(stop.stop_order) || 0,
            stop_name: stop.name,
            address: stop.address,
            checkin_id: undefined,
            issue_type: 'MISSED_CHECKIN',
            penalty_amount: this.estimatedPenalty(shift, 'MISSED_CHECKIN'),
          });
        }
      }
    }

    return out.sort((a, b) =>
      String(b.shift_date).localeCompare(String(a.shift_date))
      || String(a.route_name || '').localeCompare(String(b.route_name || ''), 'vi')
      || a.stop_order - b.stop_order);
  }

  /** Phiếu giải trình của chính tài xế. */
  async listDriverTickets(driverId: string): Promise<EVExplanationTicket[]> {
    return this.repo.evExplanationTickets
      .filter(t => t.driver_id === driverId)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  /** Hàng đợi duyệt cho Kế toán/Giám đốc. */
  async listAdminTickets(filters: ExplanationListFilters = {}): Promise<EVExplanationTicket[]> {
    let list = this.repo.evExplanationTickets.slice();
    if (filters.status) list = list.filter(t => t.status === filters.status);
    if (filters.driverId) list = list.filter(t => t.driver_id === filters.driverId);
    if (filters.dateFrom) {
      list = list.filter(t => String(t.created_at).slice(0, 10) >= filters.dateFrom!);
    }
    if (filters.dateTo) {
      list = list.filter(t => String(t.created_at).slice(0, 10) <= filters.dateTo!);
    }
    return list.sort((a, b) => {
      // PENDING lên trước để Kế toán/GĐ xử lý nhanh.
      if (a.status === 'PENDING' && b.status !== 'PENDING') return -1;
      if (b.status === 'PENDING' && a.status !== 'PENDING') return 1;
      return String(b.created_at).localeCompare(String(a.created_at));
    });
  }

  /** Tạo phiếu: xác thực điểm thuộc ca của tài xế + lưu ảnh + ghi phiếu. */
  async createTicket(driverId: string, input: CreateExplanationInput): Promise<EVExplanationTicket> {
    const id = String(driverId || '').trim();
    const driver = this.repo.employees.find(e => e.employee_id === id);
    if (!driver) throw new Error('DRIVER_NOT_FOUND: Tài khoản không gắn với nhân viên');

    const reason = String(input?.reason || '').trim();
    if (!reason) throw new Error('EXPLANATION_REASON_REQUIRED: Vui lòng nhập nội dung giải trình');
    if (reason.length > 2000) throw new Error('EXPLANATION_REASON_TOO_LONG: Nội dung giải trình tối đa 2000 ký tự');

    const requested = Array.isArray(input?.items) ? input.items : [];
    if (!requested.length) throw new Error('EXPLANATION_ITEMS_REQUIRED: Chọn ít nhất 1 điểm cần giải trình');
    if (requested.length > 30) throw new Error('EXPLANATION_TOO_MANY_ITEMS: Tối đa 30 điểm mỗi phiếu');

    const photosIn = Array.isArray(input?.photos) ? input.photos : [];
    if (!photosIn.length) throw new Error('EXPLANATION_PHOTOS_REQUIRED: Vui lòng tải lên ít nhất 1 ảnh bằng chứng');
    if (photosIn.length > MAX_PHOTOS) {
      throw new Error(`EXPLANATION_TOO_MANY_PHOTOS: Tối đa ${MAX_PHOTOS} ảnh mỗi phiếu`);
    }

    // --- Xác thực từng điểm + dựng snapshot ---
    const claimedByOther = new Map<string, string>();
    for (const t of this.repo.evExplanationTickets) {
      if (t.driver_id !== id) continue;
      if (t.status !== 'PENDING' && t.status !== 'APPROVED') continue;
      for (const it of t.items || []) claimedByOther.set(keyOf(it.shift_id, it.stop_id), t.ticket_code || t.ticket_id);
    }

    const seen = new Set<string>();
    const items: EVExplanationItem[] = [];
    for (const raw of requested) {
      const shiftId = String(raw?.shift_id || '').trim();
      const stopId = String(raw?.stop_id || '').trim();
      if (!shiftId || !stopId) throw new Error('EXPLANATION_ITEM_INVALID: Lỗi giải trình không hợp lệ');
      const k = keyOf(shiftId, stopId);
      if (seen.has(k)) continue;
      seen.add(k);
      if (claimedByOther.has(k)) {
        throw new Error(`EXPLANATION_EXISTS: Lỗi này đã có phiếu ${claimedByOther.get(k)} đang chờ/đã duyệt`);
      }

      const shift = this.repo.evShifts.find(s => s.shift_id === shiftId);
      if (!shift) throw new Error('SHIFT_NOT_FOUND: Không tìm thấy ca vận chuyển');
      if (String(shift.driver_id) !== id) throw new Error('FORBIDDEN: Ca này không thuộc tài xế của bạn');
      if (isEvTestShift(shift)) throw new Error('EXPLANATION_TEST_SHIFT: Ca chạy thử không cần giải trình');

      const checkin = this.repo.evShiftCheckins.find(c => c.shift_id === shiftId && c.stop_id === stopId);
      // Xác định loại lỗi từ dữ liệu thật (không tin client):
      //  - is_missed  → quên bấm xác nhận
      //  - is_late    → trễ giờ/SLA
      //  - đã chấm đúng giờ → không cần giải trình
      //  - chưa có check-in + ca đã kết thúc → coi như quên chấm
      let issueType: EVExplanationIssueType;
      if (checkin) {
        if (checkin.is_missed) issueType = 'MISSED_CHECKIN';
        else if (checkin.is_late) issueType = 'LATE_SLA';
        else throw new Error('EXPLANATION_ALREADY_DONE: Điểm này đã được xác nhận đúng giờ, không cần giải trình');
      } else {
        if (shift.status !== 'COMPLETED') {
          throw new Error('EXPLANATION_SHIFT_RUNNING: Ca chưa kết thúc — hãy chấm điểm trực tiếp trên lộ trình');
        }
        issueType = 'MISSED_CHECKIN';
      }

      const stops = await this.stopsForShift(shift).catch(() => []);
      const stop: any = stops.find((s: any) => String(s.stop_id) === stopId);
      if (!stop && !checkin) throw new Error('STOP_NOT_FOUND: Không tìm thấy điểm dừng trong lộ trình');

      items.push({
        shift_id: shift.shift_id,
        shift_date: String(shift.shift_date).slice(0, 10),
        route_id: shift.route_id,
        route_name: this.routeName(shift.route_id),
        stop_id: stopId,
        stop_order: Number(stop?.stop_order ?? checkin?.stop_order) || 0,
        stop_name: String(stop?.name || checkin?.stop_name || 'Điểm giao'),
        address: stop?.address,
        checkin_id: checkin?.checkin_id,
        issue_type: issueType,
        late_minutes: issueType === 'LATE_SLA' ? Number(checkin?.late_minutes) || 0 : undefined,
        penalty_amount: this.estimatedPenalty(shift, issueType),
      });
    }
    if (!items.length) throw new Error('EXPLANATION_ITEMS_REQUIRED: Chọn ít nhất 1 lỗi cần giải trình');
    const totalPenalty = items.reduce((n, it) => n + (Number(it.penalty_amount) || 0), 0);

    // --- Lưu ảnh trước khi ghi phiếu (DB chỉ giữ metadata) ---
    const ticketId = uuidv4();
    const photos: EVExplanationPhoto[] = [];
    const now = new Date().toISOString();
    try {
      for (const p of photosIn) {
        const dataUrl = String(p?.data_url || '');
        if (!dataUrl) throw new Error('PHOTO_INVALID: Ảnh không hợp lệ hoặc bị hỏng');
        const photoId = uuidv4();
        const saved = saveExplanationPhoto(ticketId, photoId, dataUrl, MAX_PHOTO_BYTES);
        photos.push({
          photo_id: photoId,
          mime_type: saved.mime_type,
          size_bytes: saved.size_bytes,
          original_name: String(p?.name || '').trim() || undefined,
          created_at: now,
        });
      }
    } catch (err) {
      deleteExplanationPhotos(ticketId);
      throw err;
    }

    const ticket = await this.repo.createEVExplanationTicket({
      ticket_id: ticketId,
      driver_id: id,
      driver_name: String((driver as any).full_name || '').trim() || undefined,
      reason,
      items,
      photos,
      total_penalty_amount: totalPenalty || undefined,
      status: 'PENDING',
    });

    return ticket;
  }

  /**
   * Kế toán/Giám đốc duyệt → xóa phạt & tính hoàn thành ca:
   *  - Lỗi quên chấm: check-in bỏ lọt thành hoàn thành (không trừ lương).
   *  - Lỗi trễ giờ: xóa is_late/late_minutes và trừ lại 1 điểm phạt của ca
   *    (điểm đã bị cộng lúc check-in trễ) → hồ sơ không còn vi phạm.
   */
  async approve(
    ticketId: string,
    actorId: string,
    actorName?: string,
    notes?: string,
  ): Promise<EVExplanationTicket> {
    const ticket = this.repo.evExplanationTickets.find(t => t.ticket_id === ticketId);
    if (!ticket) throw new Error('EXPLANATION_NOT_FOUND: Không tìm thấy phiếu giải trình');
    if (ticket.status !== 'PENDING') {
      throw new Error('EXPLANATION_INVALID_STATUS: Phiếu đã được xử lý trước đó');
    }

    const now = new Date().toISOString();
    const noteText = `Giải trình ${ticket.ticket_code || ticket.ticket_id}${notes ? `: ${notes}` : ''}`;
    for (const item of ticket.items || []) {
      const existing = this.repo.evShiftCheckins.find(
        c => c.shift_id === item.shift_id && c.stop_id === item.stop_id,
      );
      if (existing) {
        // Điểm đã chấm đúng giờ từ trước → không đụng tới.
        if (!existing.is_missed && !existing.is_late) continue;
        const wasMissed = !!existing.is_missed;
        const wasLate = !!existing.is_late;

        await this.repo.updateEVShiftCheckin(existing.checkin_id, {
          is_missed: false,
          is_late: false,
          late_minutes: 0,
          penalty_amount: 0,
          notes: existing.notes ? `${existing.notes} • ${noteText}` : noteText,
        });

        // Check-in trễ đã cộng 1 điểm phạt cho ca lúc chấm điểm → trừ lại.
        // Check-in bỏ lọt không cộng điểm phạt nên không trừ.
        if (!wasMissed && wasLate) {
          const shift = this.repo.evShifts.find(s => s.shift_id === item.shift_id);
          if (shift) {
            await this.repo.updateEVShift(shift.shift_id, {
              penalty_points: Math.max(0, Number(shift.penalty_points || 0) - 1),
            });
          }
        }
        continue;
      }
      // Ca đã kết thúc nhưng chưa có bản ghi bỏ lọt → tạo check-in hoàn thành.
      const shift = this.repo.evShifts.find(s => s.shift_id === item.shift_id);
      if (!shift) continue;
      const payload: Partial<EVShiftCheckin> = {
        shift_id: item.shift_id,
        stop_id: item.stop_id,
        stop_order: item.stop_order,
        stop_name: item.stop_name,
        checked_in_at: now,
        latitude: 0,
        longitude: 0,
        distance_m: 0,
        is_within_geofence: false,
        sla_minutes: 0,
        actual_travel_min: 0,
        is_late: false,
        late_minutes: 0,
        penalty_amount: 0,
        is_missed: false,
        notes: noteText,
      };
      await this.repo.createEVShiftCheckin(payload);
    }

    const updated = await this.repo.updateEVExplanationTicket(ticket.ticket_id, {
      status: 'APPROVED',
      approved_by: actorId,
      approved_by_name: String(actorName || '').trim() || undefined,
      approved_at: now,
      approval_notes: String(notes || '').trim() || undefined,
    });
    return updated;
  }

  /** Từ chối phiếu — không thay đổi điểm/check-in. */
  async reject(
    ticketId: string,
    actorId: string,
    actorName: string | undefined,
    reason: string,
  ): Promise<EVExplanationTicket> {
    const ticket = this.repo.evExplanationTickets.find(t => t.ticket_id === ticketId);
    if (!ticket) throw new Error('EXPLANATION_NOT_FOUND: Không tìm thấy phiếu giải trình');
    if (ticket.status !== 'PENDING') {
      throw new Error('EXPLANATION_INVALID_STATUS: Phiếu đã được xử lý trước đó');
    }
    const text = String(reason || '').trim();
    if (!text) throw new Error('EXPLANATION_REJECT_REASON_REQUIRED: Vui lòng nhập lý do từ chối');
    return this.repo.updateEVExplanationTicket(ticket.ticket_id, {
      status: 'REJECTED',
      rejected_by: actorId,
      rejected_by_name: String(actorName || '').trim() || undefined,
      rejected_at: new Date().toISOString(),
      rejected_reason: text,
    });
  }

  /** Dùng cho route ảnh: kiểm tra phiếu tồn tại + quyền xem. */
  findTicket(ticketId: string): EVExplanationTicket | undefined {
    return this.repo.evExplanationTickets.find(t => t.ticket_id === ticketId);
  }
}
