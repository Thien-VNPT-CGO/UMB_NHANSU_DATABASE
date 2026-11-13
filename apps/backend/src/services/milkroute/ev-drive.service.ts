/**
 * EVDriveService — lưu dữ liệu phân hệ Vận chuyển sữa (MilkRoute EV) lên Google Drive.
 *
 * Cấu trúc thư mục (root mặc định = folder do chủ dự án cấp):
 *   04. VẬN CHUYỂN SỮA/
 *     THANG_11/
 *       13-11-2026/
 *         Live Map/            → vi-tri-13-11-2026.json
 *         Xe & Lộ trình/       → xe.json, lo-trinh.json
 *         Phiếu đổi lộ trình/  → phieu-doi-lo-trinh-13-11-2026.json
 *         Ca vận chuyển/       → ca-van-chuyen-13-11-2026.json
 *         Phiếu sạc/           → phieu-sac-13-11-2026.json
 *         Lương tài xế/        → luong-tai-xe-THANG_11.json
 *
 * Google Drive không cho phép ký tự "/" trong tên thư mục nên ngày dùng dạng
 * DD-MM-YYYY. Mỗi tab = 1 thư mục, mỗi ngày = 1 file JSON tự ghi đè (upsert),
 * nên không sinh file rác khi dữ liệu thay đổi nhiều lần trong ngày.
 *
 * Ghi qua DriveStorageService: ưu tiên Apps Script webhook (chạy dưới quyền chủ
 * thư mục, tự tạo cây thư mục con), fallback sang Drive API nếu webhook lỗi.
 */

import { getDriveStorage } from '../drive-storage.service.js';

/** Root "04. VẬN CHUYỂN SỮA" — override bằng GOOGLE_DRIVE_EV_ROOT_ID. */
export const EV_DRIVE_ROOT_FOLDER_ID = '1qATZUiAu_KnztarbKraK13Xosn89pdJt';

/** Gộp nhiều thay đổi liên tiếp (check-in, GPS, duyệt phiếu...) thành 1 lần ghi. */
export const EV_DRIVE_DEBOUNCE_MS = 8_000;

/** Tên thư mục tab — khớp đúng nhãn tab trên giao diện quản trị. */
export const EV_DRIVE_TABS = [
  'Live Map',
  'Xe & Lộ trình',
  'Phiếu đổi lộ trình',
  'Ca vận chuyển',
  'Phiếu sạc',
  'Lương tài xế',
] as const;

export type EVDriveTab = typeof EV_DRIVE_TABS[number];

const VN_OFFSET_MS = 7 * 3_600_000;

/** Ngày hôm nay theo giờ Việt Nam (YYYY-MM-DD). */
export function evToday(): string {
  return new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** ISO timestamp → ngày Việt Nam (YYYY-MM-DD); rỗng nếu không parse được. */
export function evDayOfIso(input: unknown): string {
  const t = Date.parse(String(input || ''));
  if (!Number.isFinite(t)) return '';
  return new Date(t + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Chuẩn hoá ngày về YYYY-MM-DD; không hợp lệ → ''. */
export function normalizeEvDay(input: unknown): string {
  const s = String(input || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return evDayOfIso(s);
}

/** "2026-11-13" → "THANG_11". */
export function evMonthFolder(day: string): string {
  const mm = String(day || '').slice(5, 7) || evToday().slice(5, 7);
  return `THANG_${mm}`;
}

/** "2026-11-13" → "13-11-2026" (Drive không cho phép "/"). */
export function evDayFolder(day: string): string {
  const s = normalizeEvDay(day) || evToday();
  const [y, m, d] = s.split('-');
  return `${d}-${m}-${y}`;
}

/** Các cấp thư mục con dưới root: THANG_MM / DD-MM-YYYY / <tab>. */
export function evDriveSegments(day: string, tab: string): string[] {
  return [evMonthFolder(normalizeEvDay(day) || evToday()), evDayFolder(day), tab];
}

interface EVCollections {
  vehicles: any[];
  routes: any[];
  stops: any[];
  shifts: any[];
  checkins: any[];
  tickets: any[];
  payroll: any[];
  routeChanges: any[];
  gps: any[];
}

/**
 * Đồng bộ dữ liệu EV lên Drive theo ngày + tab.
 * Không bao giờ throw ra ngoài luồng nghiệp vụ: lỗi chỉ ghi log.
 */
export class EVDriveService {
  private readonly rootId: string;
  private moduleRef: any = null;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly queue: Array<{ day: string; tabs?: EVDriveTab[] }> = [];
  private pumping = false;
  private started = false;
  private lastSyncAt = '';
  private lastError = '';
  private lastResult: any = null;

  constructor(private readonly repo: any) {
    this.rootId = String(process.env.GOOGLE_DRIVE_EV_ROOT_ID || '').trim() || EV_DRIVE_ROOT_FOLDER_ID;
  }

  /** Gắn module EV (để fallback sang service khi adapter không giữ mảng trong RAM). */
  bindModule(mod: any): void {
    this.moduleRef = mod;
  }

  public today(): string {
    return evToday();
  }

  /** Chỉ bật khi có root + ít nhất 1 đường ghi Drive (webhook/OAuth/Service Account). */
  public isEnabled(): boolean {
    if (!this.rootId) return false;
    const env = process.env;
    const webhook = !!String(env.GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL || '').trim();
    const oauth = !!(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REFRESH_TOKEN);
    const sa = !!(env.GOOGLE_SERVICE_ACCOUNT_JSON
      || (env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_PRIVATE_KEY));
    return webhook || oauth || sa;
  }

  public status() {
    return {
      enabled: this.isEnabled(),
      root_folder_id: this.rootId,
      pending: [...this.timers.keys()],
      queued: this.queue.map((q) => q.day),
      last_sync_at: this.lastSyncAt || null,
      last_error: this.lastError || null,
      last_result: this.lastResult,
    };
  }

  /**
   * Realtime: mọi thay đổi EV đều đi qua broadcastUpdate('evXxx', {...}) nên
   * bám vào đây là đủ — không phải sửa từng route.
   */
  public scheduleFromBroadcast(entity: string, data?: any): void {
    if (!this.isEnabled()) return;
    const ent = String(entity || '').toLowerCase();
    if (!ent.startsWith('ev')) return;
    const day = this.resolveDay(ent, data);
    this.scheduleDay(day);
  }

  /** Hẹn đồng bộ 1 ngày (debounce) — gọi nhiều lần liên tiếp chỉ ghi 1 lần. */
  public scheduleDay(day?: string, tabs?: EVDriveTab[]): void {
    if (!this.isEnabled()) return;
    const d = normalizeEvDay(day) || evToday();
    const key = `${d}|${tabs && tabs.length ? [...tabs].sort().join(',') : 'ALL'}`;
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      this.enqueue({ day: d, tabs });
    }, EV_DRIVE_DEBOUNCE_MS);
    (timer as any).unref?.();
    this.timers.set(key, timer);
  }

  /** Đồng bộ ngay (dùng cho endpoint admin / test). */
  public async syncDay(day?: string, tabs?: EVDriveTab[]): Promise<any> {
    const d = normalizeEvDay(day) || evToday();
    if (!this.isEnabled()) throw new Error('DRIVE_NOT_CONFIGURED');
    const data = await this.loadCollections(d);
    const wanted = tabs && tabs.length ? tabs : [...EV_DRIVE_TABS];
    const files: any[] = [];
    const errors: any[] = [];

    for (const tab of wanted) {
      try {
        const uploaded = await this.uploadTab(d, tab, data);
        files.push(...uploaded);
      } catch (err: any) {
        const msg = `${tab}: ${err?.message || err}`;
        errors.push(msg);
        console.warn(`[EVDrive] ${d} ${msg}`);
      }
    }

    this.lastSyncAt = new Date().toISOString();
    this.lastError = errors.length ? errors.join(' | ') : '';
    this.lastResult = { day: d, files: files.length, errors: errors.length };
    return { day: d, files, errors };
  }

  /** Timer làm tươi "Live Map" khi có ca đang chạy (GPS chỉ đẩy qua socket). */
  public start(): void {
    if (this.started || !this.isEnabled()) return;
    this.started = true;
    // Tạo sẵn cây thư mục của hôm nay ngay sau khi khởi động (6 tab).
    this.scheduleDay(evToday());
    const timer = setInterval(() => {
      try {
        const active = this.arr('evShifts').some((s: any) =>
          ['IN_PROGRESS', 'CHARGING', 'RETURNING'].includes(String(s.status)));
        if (active) this.scheduleDay(evToday(), ['Live Map']);
      } catch { /* non-fatal */ }
    }, 10 * 60_000);
    (timer as any).unref?.();
  }

  // ------------------------------------------------------------------
  // Nội bộ
  // ------------------------------------------------------------------

  private enqueue(job: { day: string; tabs?: EVDriveTab[] }): void {
    const key = `${job.day}|${job.tabs && job.tabs.length ? [...job.tabs].sort().join(',') : 'ALL'}`;
    if (this.queue.some((q) => `${q.day}|${q.tabs && q.tabs.length ? [...q.tabs].sort().join(',') : 'ALL'}` === key)) return;
    this.queue.push(job);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift()!;
        try {
          await this.syncDay(job.day, job.tabs);
        } catch (err: any) {
          this.lastError = String(err?.message || err);
          console.warn(`[EVDrive] Đồng bộ ${job.day} thất bại: ${this.lastError}`);
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Tìm ngày của bản ghi vừa đổi từ id trong payload realtime. */
  private resolveDay(entity: string, data?: any): string {
    const today = evToday();
    const id = String(data?.id || data?.shiftId || data?.ticketId || data?.requestId || '');
    try {
      if (entity === 'evshift') {
        return this.arr('evShifts').find((s: any) => String(s.shift_id) === id)?.shift_date || today;
      }
      if (entity === 'evshiftcheckin') {
        const c = this.arr('evShiftCheckins').find((x: any) =>
          String(x.checkin_id) === id || String(x.shift_id) === String(data?.shiftId));
        const s = c ? this.arr('evShifts').find((x: any) => String(x.shift_id) === String(c.shift_id)) : null;
        return s?.shift_date || today;
      }
      if (entity === 'evchargingticket') {
        const t = this.arr('evChargingTickets').find((x: any) => String(x.ticket_id) === id);
        return t?.requested_date || today;
      }
      if (entity === 'evroutechangerequest') {
        const r = this.arr('evRouteChangeRequests').find((x: any) => String(x.request_id) === id);
        return r?.effective_from || today;
      }
      if (entity === 'evdriverpayroll') {
        const p = this.arr('evDriverPayroll').find((x: any) => String(x.payroll_id) === id);
        const period = String(p?.period || '');
        return /^\d{4}-\d{2}$/.test(period) ? `${period}-01` : today;
      }
    } catch { /* non-fatal */ }
    return today;
  }

  private arr(name: string): any[] {
    const v = this.repo?.[name];
    return Array.isArray(v) ? v : [];
  }

  /** Đọc toàn bộ dữ liệu EV (ưu tiên mảng trong RAM, fallback sang service). */
  private async loadCollections(day: string): Promise<EVCollections> {
    const mod = this.moduleRef;
    const repo = this.repo || {};
    const hasArray = (k: string) => Array.isArray(repo?.[k]);
    const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try { return await fn(); } catch { return fallback; }
    };

    const vehicles = hasArray('evVehicles')
      ? this.arr('evVehicles')
      : await safe(() => mod.vehicles.listVehicles(), []);

    const routes = hasArray('evRoutes')
      ? this.arr('evRoutes')
      : await safe(() => mod.routes.listRoutes(), []);

    let stops = hasArray('evRouteStops') ? this.arr('evRouteStops') : [];
    if (!stops.length && mod) {
      for (const r of routes) {
        const list = await safe(() => mod.routes.listRouteStops(r.route_id), []);
        stops = stops.concat(Array.isArray(list) ? list : []);
      }
    }

    const shifts = hasArray('evShifts')
      ? this.arr('evShifts')
      : await safe(() => mod.shifts.listShifts({}), []);

    let checkins = hasArray('evShiftCheckins') ? this.arr('evShiftCheckins') : [];
    if (!checkins.length && mod) {
      const dayShifts = (shifts || []).filter((s: any) => String(s.shift_date) === day);
      for (const s of dayShifts) {
        const list = await safe(() => mod.checkins.getShiftCheckins(s.shift_id), []);
        checkins = checkins.concat(Array.isArray(list) ? list : []);
      }
    }

    const tickets = hasArray('evChargingTickets')
      ? this.arr('evChargingTickets')
      : await safe(() => mod.charging.listChargingTickets({}), []);

    const period = day.slice(0, 7);
    const payroll = hasArray('evDriverPayroll')
      ? this.arr('evDriverPayroll')
      : await safe(() => mod.payroll.listPayrollByPeriod(period), []);

    const routeChanges = hasArray('evRouteChangeRequests')
      ? this.arr('evRouteChangeRequests')
      : await safe(() => mod.routeChanges.listRequests({}), []);

    const gps = this.arr('evGpsPoints');

    return { vehicles, routes, stops, shifts, checkins, tickets, payroll, routeChanges, gps };
  }

  private async uploadTab(day: string, tab: EVDriveTab, all: EVCollections): Promise<any[]> {
    switch (tab) {
      case 'Live Map':
        return [await this.putJson(day, tab, `vi-tri-${day}.json`, this.buildLiveMap(day, all))];
      case 'Xe & Lộ trình':
        return [
          await this.putJson(day, tab, 'xe.json', { generated_at: new Date().toISOString(), day, total: all.vehicles.length, items: all.vehicles }),
          await this.putJson(day, tab, 'lo-trinh.json', {
            generated_at: new Date().toISOString(),
            day,
            total: all.routes.length,
            items: all.routes.map((r: any) => ({
              ...r,
              stops: all.stops
                .filter((s: any) => String(s.route_id) === String(r.route_id))
                .sort((a: any, b: any) => Number(a.stop_order) - Number(b.stop_order)),
            })),
          }),
        ];
      case 'Phiếu đổi lộ trình': {
        const items = all.routeChanges.filter((r: any) => {
          const created = evDayOfIso(r.created_at);
          const from = String(r.effective_from || '').slice(0, 10);
          const to = String(r.effective_to || '').slice(0, 10);
          return created === day || (from && to && from <= day && day <= to);
        });
        return [await this.putJson(day, tab, `phieu-doi-lo-trinh-${day}.json`, {
          generated_at: new Date().toISOString(), day, total: items.length, items,
        })];
      }
      case 'Ca vận chuyển': {
        const shifts = all.shifts.filter((s: any) => String(s.shift_date) === day);
        const ids = new Set(shifts.map((s: any) => String(s.shift_id)));
        const items = shifts.map((s: any) => ({
          ...s,
          checkins: all.checkins
            .filter((c: any) => String(c.shift_id) === String(s.shift_id))
            .sort((a: any, b: any) => Number(a.stop_order) - Number(b.stop_order)),
        }));
        return [await this.putJson(day, tab, `ca-van-chuyen-${day}.json`, {
          generated_at: new Date().toISOString(),
          day,
          total: items.length,
          checkin_total: all.checkins.filter((c: any) => ids.has(String(c.shift_id))).length,
          items,
        })];
      }
      case 'Phiếu sạc': {
        const shiftIds = new Set(all.shifts.filter((s: any) => String(s.shift_date) === day).map((s: any) => String(s.shift_id)));
        const items = all.tickets.filter((t: any) =>
          shiftIds.has(String(t.shift_id)) || String(t.requested_date || '').slice(0, 10) === day);
        return [await this.putJson(day, tab, `phieu-sac-${day}.json`, {
          generated_at: new Date().toISOString(), day, total: items.length, items,
        })];
      }
      case 'Lương tài xế': {
        const period = day.slice(0, 7);
        const items = all.payroll.filter((p: any) => String(p.period) === period);
        return [await this.putJson(day, tab, `luong-tai-xe-THANG_${period.slice(5, 7)}.json`, {
          generated_at: new Date().toISOString(), day, period, total: items.length, items,
        })];
      }
      default:
        return [];
    }
  }

  private buildLiveMap(day: string, all: EVCollections) {
    // Vị trí mới nhất của từng xe trong ngày (GPS lưu tối đa 90 ngày).
    const latest = new Map<string, any>();
    for (const p of all.gps) {
      if (evDayOfIso(p.recorded_at) !== day) continue;
      const key = String(p.vehicle_id || '');
      const prev = latest.get(key);
      if (!prev || String(p.recorded_at) > String(prev.recorded_at)) latest.set(key, p);
    }
    const vehicles = all.vehicles.map((v: any) => {
      const p = latest.get(String(v.vehicle_id));
      return {
        vehicle_id: v.vehicle_id,
        license_plate: v.license_plate,
        driver_id: v.assigned_driver_id || null,
        status: v.status,
        battery_pct: v.current_battery_pct,
        latitude: p?.latitude ?? null,
        longitude: p?.longitude ?? null,
        speed_kmh: p?.speed_kmh ?? null,
        recorded_at: p?.recorded_at ?? null,
      };
    });
    const activeShifts = all.shifts
      .filter((s: any) => String(s.shift_date) === day && ['IN_PROGRESS', 'CHARGING', 'RETURNING'].includes(String(s.status)))
      .map((s: any) => ({
        shift_id: s.shift_id,
        driver_id: s.driver_id,
        vehicle_id: s.vehicle_id,
        route_id: s.route_id,
        status: s.status,
        product_name: s.product_name || null,
        actual_start_at: s.actual_start_at || null,
        penalty_points: s.penalty_points,
      }));
    return {
      generated_at: new Date().toISOString(),
      day,
      total_vehicles: vehicles.length,
      vehicles,
      active_shifts: activeShifts,
    };
  }

  private async putJson(day: string, tab: EVDriveTab, fileName: string, data: any): Promise<any> {
    const buffer = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
    const ref = await getDriveStorage().uploadBuffer(
      fileName,
      'application/json; charset=utf-8',
      buffer,
      evDriveSegments(day, tab),
      this.rootId,
      { upsert: true },
    );
    return { tab, file: fileName, file_id: ref.fileId, url: ref.viewUrl };
  }
}
