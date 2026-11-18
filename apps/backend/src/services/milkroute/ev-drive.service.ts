/**
 * EVDriveService — lưu TOÀN BỘ dữ liệu App Tài Xế (MilkRoute EV) lên Google Drive.
 *
 * Cấu trúc thư mục (root mặc định = folder do chủ dự án cấp):
 *   04. VẬN CHUYỂN SỮA/
 *     DANH-MUC-CHUC-NANG.json         → mục lục toàn bộ tab + mô tả + tên tệp
 *     THANG_11/
 *       13-11-2026/
 *         00-DANH-MUC.json             → mục lục các tab của ngày
 *         Live Map/                    → vi-tri-13-11-2026.json
 *         Xe & Lộ trình/               → xe.json, lo-trinh.json
 *         Phiếu đổi lộ trình/          → phieu-doi-lo-trinh-13-11-2026.json
 *         Ca vận chuyển/               → ca-van-chuyen-13-11-2026.json
 *         Phiếu sạc/                   → phieu-sac-13-11-2026.json
 *         Lương tài xế/                → luong-tai-xe-THANG_11.json, cau-hinh-luong.json
 *         Giải trình/                  → phieu-giai-trinh-13-11-2026.json
 *                                        Anh bang chung/<ticket>/...
 *         Hồ sơ tài xế/                → ho-so-tai-xe-13-11-2026.json
 *         Hành trình GPS/              → hanh-trinh-gps-13-11-2026.json
 *         Tổng quan/                   → tong-quan-13-11-2026.json
 *         Tự động - <chức năng mới>/   → du-lieu-13-11-2026.json
 *
 * Mỗi tab có thêm `danh-muc.json` mô tả chức năng, nguồn dữ liệu, tên tệp và
 * các cột — nhờ vậy Drive luôn "tự hiểu" khi hệ thống có chức năng mới.
 *
 * TỰ ĐỘNG:
 *  - Mỗi lần đồng bộ đều bảo đảm đủ cây thư mục của tab (kể cả tab chưa có dữ
 *    liệu) nên Drive thiếu mục nào sẽ được tạo lại.
 *  - Quét các mảng `ev*` mới trong kho dữ liệu; mảng chưa thuộc tab nào sẽ tự
 *    sinh thư mục "Tự động - <tên chức năng>" + tệp dữ liệu + danh mục.
 *  - Khi khởi động, tự backfill các ngày gần đây có phát sinh dữ liệu
 *    (GOOGLE_DRIVE_EV_BACKFILL_DAYS, mặc định 7 ngày).
 *
 * Ghi qua DriveStorageService: ưu tiên Apps Script webhook (chạy dưới quyền chủ
 * thư mục, tự tạo cây thư mục con), fallback sang Drive API nếu webhook lỗi.
 */

import { DEFAULT_EV_PAYROLL_CONFIG } from '@ubm/shared';
import { getDriveStorage } from '../drive-storage.service.js';
import { readExplanationPhoto } from './ev-explanation-photo.store.js';
import { isShiftWorked } from './ev-shift-activity.js';

/** Root "04. VẬN CHUYỂN SỮA" — override bằng GOOGLE_DRIVE_EV_ROOT_ID. */
export const EV_DRIVE_ROOT_FOLDER_ID = '1qATZUiAu_KnztarbKraK13Xosn89pdJt';

/** Gộp nhiều thay đổi liên tiếp (check-in, GPS, duyệt phiếu...) thành 1 lần ghi. */
export const EV_DRIVE_DEBOUNCE_MS = 8_000;

/** Phiên bản cấu trúc tệp — tăng khi thêm/bớt cột quan trọng. */
export const EV_DRIVE_SCHEMA_VERSION = 2;

/** Tên các thư mục tab hiển thị trên Drive (khớp nhãn giao diện quản trị). */
export const EV_DRIVE_TABS = [
  'Live Map',
  'Xe & Lộ trình',
  'Phiếu đổi lộ trình',
  'Ca vận chuyển',
  'Phiếu sạc',
  'Lương tài xế',
  'Giải trình',
  'Hồ sơ tài xế',
  'Hành trình GPS',
  'Tổng quan',
] as const;

export type EVDriveTab = typeof EV_DRIVE_TABS[number] | string;

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

/** Tên thư mục cho chức năng mới được phát hiện tự động. */
export function evAutoTabName(key: string): string {
  const raw = String(key || '').replace(/^ev/i, '');
  const label = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `Tự động - ${label || 'Chức năng mới'}`;
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
  explanations: any[];
  employees: any[];
  gps: any[];
}

interface EVDriveFile {
  name: string;
  data: any;
}

interface EVDriveTabDef {
  name: string;
  description: string;
  /** Các mảng dữ liệu nguồn — dùng để tránh tự tạo trùng tab. */
  sourceKeys: string[];
  /** Tên tệp cố định theo ngày (dùng cho mục lục, không cần dựng dữ liệu). */
  fileNames: (day: string) => string[];
  build: (day: string, all: EVCollections) => Promise<EVDriveFile[]>;
  /** true = thư mục do hệ thống tự phát hiện từ chức năng mới. */
  auto?: boolean;
}

/** Các trường thường chứa ngày để lọc dữ liệu chức năng mới theo ngày. */
const DATE_FIELDS = [
  'shift_date',
  'requested_date',
  'effective_from',
  'effective_to',
  'recorded_at',
  'checked_in_at',
  'created_at',
  'updated_at',
  'date',
  'period',
];

const EMPTY_COLLECTIONS: EVCollections = {
  vehicles: [],
  routes: [],
  stops: [],
  shifts: [],
  checkins: [],
  tickets: [],
  payroll: [],
  routeChanges: [],
  explanations: [],
  employees: [],
  gps: [],
};

/** Mỗi entity realtime chỉ cần đồng bộ đúng tab liên quan (đỡ ghi Drive). */
const ENTITY_TABS: Record<string, string[]> = {
  evvehicle: ['Live Map', 'Xe & Lộ trình', 'Hồ sơ tài xế'],
  evroute: ['Xe & Lộ trình'],
  evroutestop: ['Xe & Lộ trình'],
  evshift: ['Ca vận chuyển', 'Live Map', 'Hành trình GPS', 'Hồ sơ tài xế', 'Tổng quan'],
  evshiftcheckin: ['Ca vận chuyển', 'Live Map', 'Hành trình GPS', 'Tổng quan'],
  evchargingticket: ['Phiếu sạc', 'Tổng quan'],
  evroutechangerequest: ['Phiếu đổi lộ trình', 'Tổng quan'],
  evroutechang: ['Phiếu đổi lộ trình', 'Tổng quan'],
  evpayroll: ['Lương tài xế', 'Tổng quan'],
  evexplanationticket: ['Giải trình', 'Tổng quan'],
};

/**
 * Đồng bộ dữ liệu EV lên Drive theo ngày + tab.
 * Không bao giờ throw ra ngoài luồng nghiệp vụ: lỗi chỉ ghi log.
 */
export class EVDriveService {
  private readonly rootId: string;
  private moduleRef: any = null;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly queue: Array<{ day: string; tabs?: string[] }> = [];
  private readonly retryAttempts = new Map<string, number>();
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

  /**
   * Chỉ bật khi có root + ít nhất 1 đường ghi Drive.
   * Dùng chính DriveStorageService để nhận đủ OAuth2 / Service Account (env
   * hoặc file key.json) / webhook — tránh trường hợp có credentials từ file mà
   * tưởng là chưa cấu hình nên không đồng bộ.
   */
  public isEnabled(): boolean {
    if (!this.rootId) return false;
    if (String(process.env.GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL || '').trim()) return true;
    try {
      return getDriveStorage().isConfigured();
    } catch {
      return false;
    }
  }

  public status() {
    const defs = this.allTabDefs();
    return {
      enabled: this.isEnabled(),
      root_folder_id: this.rootId,
      schema_version: EV_DRIVE_SCHEMA_VERSION,
      tabs: defs.map((d) => d.name),
      auto_tabs: defs.filter((d) => d.auto).map((d) => d.name),
      tab_details: defs.map((d) => ({
        tab: d.name,
        description: d.description,
        source_keys: d.sourceKeys,
        files: d.fileNames(evToday()),
        auto: !!d.auto,
      })),
      backfill_days: this.backfillDays(),
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
    const today = evToday();

    // Hồ sơ nhân viên đổi (SĐT, chi nhánh, trạng thái...) → làm tươi hồ sơ tài xế.
    if (ent === 'employees') {
      const ids = [
        data?.employee?.employee_id,
        data?.employeeId,
        data?.employee_id,
      ].map((x) => String(x || '').trim()).filter(Boolean);
      if (ids.some((id) => this.isDriverId(id))) {
        this.scheduleDay(today, ['Hồ sơ tài xế', 'Tổng quan']);
      }
      return;
    }

    if (!ent.startsWith('ev')) return;

    const day = this.resolveDay(ent, data);

    // 'ev' là tín hiệu chung (kèm 1 broadcast cụ thể) → bỏ qua để tránh ghi thừa.
    if (ent === 'ev') return;

    const tabs = ENTITY_TABS[ent];
    if (tabs) this.scheduleDay(day, tabs);
    else this.scheduleDay(day); // Chức năng mới: đồng bộ tất cả (gồm tab tự động).

    // Ca đổi lịch/xóa: tệp của ngày CŨ cũng phải được cập nhật.
    const oldDay = normalizeEvDay(data?.old_shift_date);
    if (oldDay && oldDay !== day) {
      if (tabs) this.scheduleDay(oldDay, tabs);
      else this.scheduleDay(oldDay);
    }

    // Bản tổng quan hôm nay luôn phản ánh trạng thái mới nhất.
    if (day !== today) this.scheduleDay(today, ['Tổng quan']);
  }

  /** Hẹn đồng bộ 1 ngày (debounce) — gọi nhiều lần liên tiếp chỉ ghi 1 lần. */
  public scheduleDay(day?: string, tabs?: string[]): void {
    if (!this.isEnabled()) return;
    const d = normalizeEvDay(day) || evToday();
    const key = this.jobKey(d, tabs);
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
  public async syncDay(day?: string, tabs?: string[]): Promise<any> {
    const d = normalizeEvDay(day) || evToday();
    if (!this.isEnabled()) throw new Error('DRIVE_NOT_CONFIGURED');
    const data = await this.loadCollections(d);
    const defs = this.allTabDefs();
    // Mọi thay đổi trong ngày đều có thể ảnh hưởng số liệu tổng hợp → luôn ghi
    // kèm "Tổng quan" cho hôm nay (1 lần ghi/tab, không nhân đôi công việc).
    const wantedNames = tabs && tabs.length
      ? new Set([...tabs, ...(d === evToday() ? ['Tổng quan'] : [])])
      : null;
    const wanted = wantedNames ? defs.filter((def) => wantedNames.has(def.name)) : defs;
    const files: any[] = [];
    const errors: any[] = [];

    for (const def of wanted) {
      try {
        const uploaded = await this.uploadTab(d, def, data);
        files.push(...uploaded);
      } catch (err: any) {
        const msg = `${def.name}: ${err?.message || err}`;
        errors.push(msg);
        console.warn(`[EVDrive] ${d} ${msg}`);
      }
    }

    // Mục lục ngày luôn liệt kê ĐỦ tab (kể cả tab chưa có dữ liệu) để lần đồng
    // bộ sau/Drive bị thiếu vẫn biết phải tạo mục nào.
    try {
      await this.writeDayIndex(d, defs);
    } catch (err: any) {
      const msg = `00-DANH-MUC.json: ${err?.message || err}`;
      errors.push(msg);
      console.warn(`[EVDrive] ${d} ${msg}`);
    }
    if (!wantedNames) {
      try {
        await this.writeRootIndex(defs);
      } catch (err: any) {
        const msg = `DANH-MUC-CHUC-NANG.json: ${err?.message || err}`;
        errors.push(msg);
        console.warn(`[EVDrive] ${msg}`);
      }
    }

    this.lastSyncAt = new Date().toISOString();
    this.lastError = errors.length ? errors.join(' | ') : '';
    this.lastResult = { day: d, files: files.length, errors: errors.length, tabs: wanted.length };
    return { day: d, files, errors, tabs: wanted.map((x) => x.name) };
  }

  /** Timer làm tươi "Live Map" khi có ca đang chạy (GPS chỉ đẩy qua socket). */
  public start(): void {
    if (this.started || !this.isEnabled()) return;
    this.started = true;
    // Tạo sẵn cây thư mục + dữ liệu của hôm nay ngay sau khi khởi động.
    this.scheduleDay(evToday());
    // Backfill các ngày gần đây có dữ liệu (VPS downtime / Drive lỗi dài ngày).
    const backfill = setTimeout(() => {
      try { this.backfillRecent(); } catch { /* non-fatal */ }
    }, 20_000);
    (backfill as any).unref?.();

    const timer = setInterval(() => {
      try {
        const active = this.arr('evShifts').some((s: any) =>
          ['IN_PROGRESS', 'CHARGING', 'RETURNING'].includes(String(s.status)));
        if (active) this.scheduleDay(evToday(), ['Live Map', 'Hành trình GPS', 'Tổng quan']);
      } catch { /* non-fatal */ }
    }, 10 * 60_000);
    (timer as any).unref?.();

    // Quét lại định kỳ 6 giờ/lần: tự bù các lần ghi lỗi hoặc Drive bị gián đoạn
    // mà không cần khởi động lại server.
    const sweep = setInterval(() => {
      try {
        for (const day of this.daysWithData(Math.min(this.backfillDays(), 2))) {
          this.scheduleDay(day);
        }
      } catch { /* non-fatal */ }
    }, 6 * 3_600_000);
    (sweep as any).unref?.();
  }

  /** Đồng bộ bù các ngày gần đây có phát sinh dữ liệu EV. */
  private backfillRecent(): void {
    for (const day of this.daysWithData(this.backfillDays())) {
      this.scheduleDay(day);
    }
  }

  // ------------------------------------------------------------------
  // Định nghĩa tab
  // ------------------------------------------------------------------

  private allTabDefs(): EVDriveTabDef[] {
    return [...this.knownTabDefs(), ...this.autoTabDefs()];
  }

  private knownTabDefs(): EVDriveTabDef[] {
    return [
      {
        name: 'Live Map',
        description: 'Vị trí mới nhất của từng xe trong ngày và các ca đang chạy.',
        sourceKeys: ['evVehicles', 'evGpsPoints', 'evShifts'],
        fileNames: (day) => [`vi-tri-${day}.json`],
        build: async (day, all) => [
          { name: `vi-tri-${day}.json`, data: this.buildLiveMap(day, all) },
        ],
      },
      {
        name: 'Xe & Lộ trình',
        description: 'Danh sách xe điện (kèm tài xế được gán) và lộ trình + điểm dừng.',
        sourceKeys: ['evVehicles', 'evRoutes', 'evRouteStops'],
        fileNames: () => ['xe.json', 'lo-trinh.json'],
        build: async (day, all) => [
          {
            name: 'xe.json',
            data: {
              generated_at: new Date().toISOString(),
              day,
              total: all.vehicles.length,
              items: all.vehicles.map((v: any) => ({
                ...v,
                driver_name: this.employeeName(all, v.assigned_driver_id),
              })),
            },
          },
          {
            name: 'lo-trinh.json',
            data: {
              generated_at: new Date().toISOString(),
              day,
              total: all.routes.length,
              items: all.routes.map((r: any) => ({
                ...r,
                stops: all.stops
                  .filter((s: any) => String(s.route_id) === String(r.route_id))
                  .sort((a: any, b: any) => Number(a.stop_order) - Number(b.stop_order))
                  .map((s: any) => ({ ...s, branch_name: this.branchName(all, s.branch_id) })),
              })),
            },
          },
        ],
      },
      {
        name: 'Phiếu đổi lộ trình',
        description: 'Phiếu đổi lộ trình có hiệu lực trong ngày hoặc được tạo trong ngày.',
        sourceKeys: ['evRouteChangeRequests'],
        fileNames: (day) => [`phieu-doi-lo-trinh-${day}.json`],
        build: async (day, all) => {
          const items = all.routeChanges.filter((r: any) => {
            const created = evDayOfIso(r.created_at);
            const from = String(r.effective_from || '').slice(0, 10);
            const to = String(r.effective_to || '').slice(0, 10);
            return created === day || (from && to && from <= day && day <= to);
          });
          return [{
            name: `phieu-doi-lo-trinh-${day}.json`,
            data: { generated_at: new Date().toISOString(), day, total: items.length, items },
          }];
        },
      },
      {
        name: 'Ca vận chuyển',
        description: 'Ca theo ngày, tài xế/xe/lộ trình và toàn bộ lượt xác nhận điểm dừng.',
        sourceKeys: ['evShifts', 'evShiftCheckins'],
        fileNames: (day) => [`ca-van-chuyen-${day}.json`],
        build: async (day, all) => {
          const shifts = all.shifts.filter((s: any) => String(s.shift_date) === day);
          const ids = new Set(shifts.map((s: any) => String(s.shift_id)));
          const items = shifts.map((s: any) => ({
            ...s,
            driver_name: this.employeeName(all, s.driver_id),
            vehicle_plate: this.vehiclePlate(all, s.vehicle_id),
            route_name: this.routeName(all, s.route_id),
            checkins: all.checkins
              .filter((c: any) => String(c.shift_id) === String(s.shift_id))
              .sort((a: any, b: any) => Number(a.stop_order) - Number(b.stop_order)),
          }));
          return [{
            name: `ca-van-chuyen-${day}.json`,
            data: {
              generated_at: new Date().toISOString(),
              day,
              total: items.length,
              checkin_total: all.checkins.filter((c: any) => ids.has(String(c.shift_id))).length,
              items,
            },
          }];
        },
      },
      {
        name: 'Phiếu sạc',
        description: 'Phiếu sạc của ca trong ngày, trạng thái duyệt 2 cấp và thông tin sạc thực tế.',
        sourceKeys: ['evChargingTickets'],
        fileNames: (day) => [`phieu-sac-${day}.json`],
        build: async (day, all) => {
          const shiftIds = new Set(all.shifts.filter((s: any) => String(s.shift_date) === day).map((s: any) => String(s.shift_id)));
          const items = all.tickets.filter((t: any) =>
            shiftIds.has(String(t.shift_id)) || String(t.requested_date || '').slice(0, 10) === day)
            .map((t: any) => ({ ...t, driver_name: this.employeeName(all, t.driver_id) }));
          return [{
            name: `phieu-sac-${day}.json`,
            data: { generated_at: new Date().toISOString(), day, total: items.length, items },
          }];
        },
      },
      {
        name: 'Lương tài xế',
        description: 'Bảng lương tài xế theo kỳ tháng + cấu hình lương đang áp dụng.',
        sourceKeys: ['evDriverPayroll'],
        fileNames: (day) => {
          const period = day.slice(0, 7);
          return [`luong-tai-xe-THANG_${period.slice(5, 7)}.json`, 'cau-hinh-luong.json'];
        },
        build: async (day, all) => {
          const period = day.slice(0, 7);
          const items = all.payroll
            .filter((p: any) => String(p.period) === period)
            .map((p: any) => ({
              ...p,
              driver_name: this.employeeName(all, p.driver_id),
              employee_code: this.employeeCode(all, p.driver_id),
            }));
          return [
            {
              name: `luong-tai-xe-THANG_${period.slice(5, 7)}.json`,
              data: { generated_at: new Date().toISOString(), day, period, total: items.length, items },
            },
            {
              name: 'cau-hinh-luong.json',
              data: {
                generated_at: new Date().toISOString(),
                day,
                period,
                source: 'DEFAULT_EV_PAYROLL_CONFIG',
                config: DEFAULT_EV_PAYROLL_CONFIG,
              },
            },
          ];
        },
      },
      {
        name: 'Giải trình',
        description: 'Phiếu giải trình lỗi tài xế (quên chấm / trễ SLA) + ảnh bằng chứng trên Drive.',
        sourceKeys: ['evExplanationTickets'],
        fileNames: (day) => [`phieu-giai-trinh-${day}.json`],
        build: async (day, all) => {
          const tickets = all.explanations.filter((t: any) =>
            evDayOfIso(t.created_at) === day
            || (Array.isArray(t.items) && t.items.some((it: any) => String(it.shift_date || '').slice(0, 10) === day)));
          const items: any[] = [];
          for (const t of tickets) {
            try {
              items.push(await this.attachExplanationPhotos(t, day));
            } catch (err: any) {
              console.warn(`[EVDrive] Ảnh giải trình ${t.ticket_id}: ${err?.message || err}`);
              items.push({
                ...t,
                driver_name: t.driver_name || this.employeeName(all, t.driver_id),
              });
            }
          }
          return [{
            name: `phieu-giai-trinh-${day}.json`,
            data: {
              generated_at: new Date().toISOString(),
              day,
              total: items.length,
              pending: items.filter((t: any) => t.status === 'PENDING').length,
              approved: items.filter((t: any) => t.status === 'APPROVED').length,
              rejected: items.filter((t: any) => t.status === 'REJECTED').length,
              items,
            },
          }];
        },
      },
      {
        name: 'Hồ sơ tài xế',
        description: 'Hồ sơ tài xế (nhân viên, xe được gán, thống kê công/thu nhập trong tháng).',
        sourceKeys: ['evVehicles', 'evShifts', 'evDriverPayroll', 'evExplanationTickets'],
        fileNames: (day) => [`ho-so-tai-xe-${day}.json`],
        build: async (day, all) => {
          const period = day.slice(0, 7);
          const items = this.driverIds(all).map((driverId) => this.driverProfile(all, driverId, period, day));
          return [{
            name: `ho-so-tai-xe-${day}.json`,
            data: {
              generated_at: new Date().toISOString(),
              day,
              period,
              total: items.length,
              items,
            },
          }];
        },
      },
      {
        name: 'Hành trình GPS',
        description: 'Toàn bộ điểm GPS trong ngày, gom theo xe và ca (vẽ lại hành trình).',
        sourceKeys: ['evGpsPoints', 'evShifts'],
        fileNames: (day) => [`hanh-trinh-gps-${day}.json`],
        build: async (day, all) => {
          const points = all.gps
            .filter((p: any) => evDayOfIso(p.recorded_at) === day)
            .sort((a: any, b: any) => String(a.recorded_at).localeCompare(String(b.recorded_at)));
          const groups = new Map<string, any[]>();
          for (const p of points) {
            const key = String(p.vehicle_id || p.shift_id || 'KHONG_XE');
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(p);
          }
          return [{
            name: `hanh-trinh-gps-${day}.json`,
            data: {
              generated_at: new Date().toISOString(),
              day,
              total_points: points.length,
              vehicles: [...groups.entries()].map(([vehicleId, list]) => ({
                vehicle_id: vehicleId,
                vehicle_plate: this.vehiclePlate(all, vehicleId),
                driver_id: list[0]?.driver_id || null,
                driver_name: this.employeeName(all, list[0]?.driver_id),
                shift_id: list[0]?.shift_id || null,
                points: list,
              })),
            },
          }];
        },
      },
      {
        name: 'Tổng quan',
        description: 'Số liệu tổng hợp trong ngày của App Tài Xế (ca, điểm, sạc, giải trình, lương).',
        sourceKeys: [
          'evShifts', 'evShiftCheckins', 'evChargingTickets', 'evExplanationTickets',
          'evDriverPayroll', 'evGpsPoints', 'evVehicles',
        ],
        fileNames: (day) => [`tong-quan-${day}.json`],
        build: async (day, all) => [
          { name: `tong-quan-${day}.json`, data: this.buildSummary(day, all) },
        ],
      },
    ];
  }

  /**
   * Tự phát hiện chức năng mới: mảng `ev*` chưa thuộc tab nào → sinh thư mục
   * "Tự động - <tên chức năng>" + dữ liệu theo ngày + danh mục riêng.
   * Nhờ vậy chỉ cần thêm chức năng vào kho dữ liệu là Drive tự có mục tương ứng.
   */
  private autoTabDefs(): EVDriveTabDef[] {
    const covered = new Set(this.knownTabDefs().flatMap((d) => d.sourceKeys));
    const keys: string[] = [];
    try {
      for (const key of Object.keys(this.repo || {})) {
        if (!/^ev[A-Z]/.test(key)) continue;
        if (covered.has(key)) continue;
        if (!Array.isArray((this.repo as any)[key])) continue;
        if (keys.includes(key)) continue;
        keys.push(key);
      }
    } catch { /* non-fatal */ }

    return keys.map((key) => {
      const name = evAutoTabName(key);
      return {
        name,
        auto: true,
        description: `Tự động tạo cho chức năng mới "${key}" — dữ liệu được đồng bộ theo ngày.`,
        sourceKeys: [key],
        fileNames: (day) => [`du-lieu-${day}.json`],
        build: async (day) => {
          const allItems = this.arr(key);
          const items = this.pickDayItems(allItems, day);
          return [{
            name: `du-lieu-${day}.json`,
            data: {
              generated_at: new Date().toISOString(),
              day,
              source: key,
              auto_created: true,
              total: items.length,
              items,
            },
          }];
        },
      } as EVDriveTabDef;
    });
  }

  // ------------------------------------------------------------------
  // Nội bộ
  // ------------------------------------------------------------------

  private jobKey(day: string, tabs?: string[]): string {
    return `${day}|${tabs && tabs.length ? [...tabs].sort().join(',') : 'ALL'}`;
  }

  private enqueue(job: { day: string; tabs?: string[] }): void {
    const key = this.jobKey(job.day, job.tabs);
    if (this.queue.some((q) => this.jobKey(q.day, q.tabs) === key)) return;
    this.queue.push(job);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift()!;
        const key = this.jobKey(job.day, job.tabs);
        try {
          const result = await this.syncDay(job.day, job.tabs);
          if (result.errors?.length) {
            this.scheduleRetry(job, key);
          } else {
            this.retryAttempts.delete(key);
          }
        } catch (err: any) {
          this.lastError = String(err?.message || err);
          console.warn(`[EVDrive] Đồng bộ ${job.day} thất bại: ${this.lastError}`);
          this.scheduleRetry(job, key);
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Ghi lỗi sẽ tự thử lại sau 5 phút (tối đa 3 lần) để không mất dữ liệu. */
  private scheduleRetry(job: { day: string; tabs?: string[] }, key: string): void {
    const attempts = this.retryAttempts.get(key) || 0;
    if (attempts >= 3) {
      console.warn(`[EVDrive] ${job.day}: đã thử ${attempts} lần, tạm dừng tới lần quét định kỳ.`);
      return;
    }
    this.retryAttempts.set(key, attempts + 1);
    const timer = setTimeout(() => {
      try { this.enqueue(job); } catch { /* non-fatal */ }
    }, 5 * 60_000);
    (timer as any).unref?.();
  }

  /** Tìm ngày của bản ghi vừa đổi từ id trong payload realtime. */
  private resolveDay(entity: string, data?: any): string {
    const today = evToday();
    const id = String(data?.id || data?.shiftId || data?.ticketId || data?.requestId || '');
    try {
      if (entity === 'evshift') {
        return this.arr('evShifts').find((s: any) => String(s.shift_id) === id)?.shift_date
          || normalizeEvDay(data?.shift_date)
          || today;
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
      if (entity === 'evroutechangerequest' || entity === 'evroutechang') {
        const r = this.arr('evRouteChangeRequests').find((x: any) => String(x.request_id) === id);
        return r?.effective_from || today;
      }
      if (entity === 'evexplanationticket') {
        const t = this.arr('evExplanationTickets').find((x: any) => String(x.ticket_id) === id);
        return evDayOfIso(t?.created_at) || t?.items?.[0]?.shift_date || today;
      }
      if (entity === 'evpayroll') {
        const period = String(data?.period || '').trim()
          || String(this.arr('evDriverPayroll').find((x: any) => String(x.payroll_id) === id)?.period || '');
        return /^\d{4}-\d{2}$/.test(period) ? `${period}-01` : today;
      }
    } catch { /* non-fatal */ }
    return today;
  }

  private arr(name: string): any[] {
    const v = this.repo?.[name];
    return Array.isArray(v) ? v : [];
  }

  /** Nhân viên có dấu hiệu là tài xế (được gán xe / có ca / có bảng lương). */
  private isDriverId(id: string): boolean {
    const key = String(id || '').trim();
    if (!key) return false;
    return this.arr('evVehicles').some((v: any) => String(v.assigned_driver_id || '') === key)
      || this.arr('evShifts').some((s: any) => String(s.driver_id || '') === key)
      || this.arr('evDriverPayroll').some((p: any) => String(p.driver_id || '') === key);
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

    // Giải trình + nhân viên: phục vụ tab Giải trình / Hồ sơ tài xế.
    // (Repo thường giữ mảng trong RAM; fallback sang service/API cho kho dữ liệu khác.)
    const explanations = hasArray('evExplanationTickets')
      ? this.arr('evExplanationTickets')
      : await safe<any[]>(async () => (mod?.explanations ? mod.explanations.listAdminTickets({}) : []), []);
    const employees = hasArray('employees')
      ? this.arr('employees')
      : await safe<any[]>(async () => (typeof (repo as any).listEmployees === 'function' ? (repo as any).listEmployees() : []), []);

    const gps = this.arr('evGpsPoints');
    const branches = this.arr('branches');

    return {
      ...EMPTY_COLLECTIONS,
      vehicles,
      routes,
      stops,
      shifts,
      checkins,
      tickets,
      payroll,
      routeChanges,
      explanations,
      employees,
      gps,
      branches,
    } as EVCollections & { branches: any[] };
  }

  private async uploadTab(day: string, def: EVDriveTabDef, all: EVCollections): Promise<any[]> {
    const files = await def.build(day, all);
    const uploaded: any[] = [];
    for (const file of files) {
      uploaded.push(await this.putJson(day, def.name, file.name, file.data));
    }
    // Danh mục của tab — luôn tồn tại kể cả khi tab chưa có dữ liệu.
    const manifest = this.buildTabManifest(day, def, files);
    uploaded.push(await this.putJson(day, def.name, 'danh-muc.json', manifest));
    return uploaded;
  }

  /** Mục lục đặt trong từng thư mục tab: mô tả + tệp + cột dữ liệu. */
  private buildTabManifest(day: string, def: EVDriveTabDef, files: EVDriveFile[]): any {
    return {
      schema_version: EV_DRIVE_SCHEMA_VERSION,
      tab: def.name,
      description: def.description,
      day,
      folder: evDriveSegments(day, def.name).join('/'),
      auto_created: !!def.auto,
      source_keys: def.sourceKeys,
      generated_at: new Date().toISOString(),
      files: files.map((f) => ({
        name: f.name,
        records: this.countRecords(f.data),
        fields: this.collectFields(f.data),
      })),
    };
  }

  /**
   * Mục lục ngày: liệt kê TẤT CẢ tab (kể cả tab chưa có dữ liệu) để hệ thống
   * biết mục nào cần tạo/cập nhật. Tệp này được ghi đè mỗi lần đồng bộ.
   */
  private async writeDayIndex(day: string, defs: EVDriveTabDef[]): Promise<any> {
    const data = {
      schema_version: EV_DRIVE_SCHEMA_VERSION,
      day,
      folder: [evMonthFolder(day), evDayFolder(day)].join('/'),
      generated_at: new Date().toISOString(),
      tabs: defs.map((def) => ({
        tab: def.name,
        description: def.description,
        source_keys: def.sourceKeys,
        files: def.fileNames(day),
        manifest: 'danh-muc.json',
        auto_created: !!def.auto,
      })),
    };
    return this.putJsonAt([evMonthFolder(day), evDayFolder(day)], '00-DANH-MUC.json', data);
  }

  /** Mục lục gốc: tự cập nhật khi hệ thống có tab/chức năng mới. */
  private async writeRootIndex(defs: EVDriveTabDef[]): Promise<any> {
    const day = evToday();
    const data = {
      schema_version: EV_DRIVE_SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      root_folder_id: this.rootId,
      folder_pattern: 'THANG_MM/DD-MM-YYYY/<tab>',
      description: 'Mục lục tự động toàn bộ dữ liệu App Tài Xế (MilkRoute EV) trên Google Drive.',
      tabs: defs.map((def) => ({
        tab: def.name,
        description: def.description,
        source_keys: def.sourceKeys,
        files: def.fileNames(day),
        manifest: 'danh-muc.json',
        auto_created: !!def.auto,
      })),
    };
    return this.putJsonAt([], 'DANH-MUC-CHUC-NANG.json', data);
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
        driver_name: this.employeeName(all, v.assigned_driver_id),
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
        driver_name: this.employeeName(all, s.driver_id),
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
      total_gps_points: all.gps.filter((p: any) => evDayOfIso(p.recorded_at) === day).length,
      vehicles,
      active_shifts: activeShifts,
    };
  }

  private buildSummary(day: string, all: EVCollections) {
    const period = day.slice(0, 7);
    const shifts = all.shifts.filter((s: any) => String(s.shift_date) === day);
    const shiftIds = new Set(shifts.map((s: any) => String(s.shift_id)));
    const checkins = all.checkins.filter((c: any) => shiftIds.has(String(c.shift_id)));
    const checkinByShift = new Map<string, number>();
    for (const c of checkins) {
      const id = String(c.shift_id);
      checkinByShift.set(id, (checkinByShift.get(id) || 0) + 1);
    }
    const worked = shifts.filter((s: any) => isShiftWorked(s, checkinByShift.get(String(s.shift_id)) || 0));

    const countStatus = (list: any[], status: string) =>
      list.filter((x: any) => String(x.status) === status).length;

    const tickets = all.tickets.filter((t: any) =>
      shiftIds.has(String(t.shift_id)) || String(t.requested_date || '').slice(0, 10) === day);
    const explanations = all.explanations.filter((t: any) =>
      evDayOfIso(t.created_at) === day
      || (Array.isArray(t.items) && t.items.some((it: any) => String(it.shift_date || '').slice(0, 10) === day)));
    const payroll = all.payroll.filter((p: any) => String(p.period) === period);
    const gps = all.gps.filter((p: any) => evDayOfIso(p.recorded_at) === day);
    const gpsVehicles = new Set(gps.map((p: any) => String(p.vehicle_id || '')).filter(Boolean));

    return {
      generated_at: new Date().toISOString(),
      day,
      period,
      shifts: {
        total: shifts.length,
        scheduled: countStatus(shifts, 'SCHEDULED'),
        in_progress: countStatus(shifts, 'IN_PROGRESS'),
        charging: countStatus(shifts, 'CHARGING'),
        returning: countStatus(shifts, 'RETURNING'),
        completed: countStatus(shifts, 'COMPLETED'),
        cancelled: countStatus(shifts, 'CANCELLED'),
        paused: countStatus(shifts, 'PAUSED'),
        worked: worked.length,
        absent: shifts.length - worked.length,
      },
      checkins: {
        total: checkins.length,
        late: checkins.filter((c: any) => c.is_late).length,
        missed: checkins.filter((c: any) => c.is_missed).length,
        on_time: checkins.filter((c: any) => !c.is_late && !c.is_missed).length,
      },
      charging: {
        total: tickets.length,
        pending_hr: countStatus(tickets, 'PENDING_HR'),
        pending_director: countStatus(tickets, 'PENDING_DIRECTOR'),
        approved: countStatus(tickets, 'APPROVED'),
        rejected: countStatus(tickets, 'REJECTED'),
        used: countStatus(tickets, 'USED'),
        energy_kwh: Math.round(tickets.reduce((n: number, t: any) => n + Number(t.energy_charged_kwh || 0), 0) * 10) / 10,
        duration_min: Math.round(tickets.reduce((n: number, t: any) => n + Number(t.charging_duration_min || 0), 0)),
      },
      explanations: {
        total: explanations.length,
        pending: countStatus(explanations, 'PENDING'),
        approved: countStatus(explanations, 'APPROVED'),
        rejected: countStatus(explanations, 'REJECTED'),
        items: explanations.reduce((n: number, t: any) => n + (t.items?.length || 0), 0),
        penalty_amount: explanations.reduce((n: number, t: any) => n + Number(t.total_penalty_amount || 0), 0),
      },
      payroll: {
        period,
        drivers: payroll.length,
        gross_pay: payroll.reduce((n: number, p: any) => n + Number(p.gross_pay || 0), 0),
        penalty_amount: payroll.reduce((n: number, p: any) => n + Number(p.total_penalty_amount || 0), 0),
        net_pay: payroll.reduce((n: number, p: any) => n + Number(p.net_pay || 0), 0),
        approved: countStatus(payroll, 'APPROVED'),
        paid: countStatus(payroll, 'PAID'),
      },
      gps: {
        total_points: gps.length,
        vehicles: gpsVehicles.size,
      },
      vehicles: {
        total: all.vehicles.length,
        active: countStatus(all.vehicles, 'ACTIVE'),
        charging: countStatus(all.vehicles, 'CHARGING'),
        maintenance: countStatus(all.vehicles, 'MAINTENANCE'),
      },
      drivers: {
        total: this.driverIds(all).length,
        active_today: new Set(shifts.map((s: any) => String(s.driver_id || '')).filter(Boolean)).size,
      },
    };
  }

  // ------------------------------------------------------------------
  // Hồ sơ tài xế / ảnh bằng chứng
  // ------------------------------------------------------------------

  private driverIds(all: EVCollections): string[] {
    const ids = new Set<string>();
    for (const v of all.vehicles) {
      const id = String(v.assigned_driver_id || '').trim();
      if (id) ids.add(id);
    }
    for (const s of all.shifts) {
      const id = String(s.driver_id || '').trim();
      if (id) ids.add(id);
    }
    for (const p of all.payroll) {
      const id = String(p.driver_id || '').trim();
      if (id) ids.add(id);
    }
    for (const t of all.explanations) {
      const id = String(t.driver_id || '').trim();
      if (id) ids.add(id);
    }
    return [...ids].sort();
  }

  private driverProfile(all: EVCollections, driverId: string, period: string, day: string): any {
    const employee: any = all.employees.find((e: any) => String(e.employee_id) === driverId) || null;
    const vehicle: any = all.vehicles.find((v: any) => String(v.assigned_driver_id) === driverId) || null;
    const shifts = all.shifts.filter((s: any) =>
      String(s.driver_id) === driverId
      && String(s.shift_date).slice(0, 7) === period
      && String(s.status) !== 'CANCELLED');
    const shiftIds = new Set(shifts.map((s: any) => String(s.shift_id)));
    const checkins = all.checkins.filter((c: any) => shiftIds.has(String(c.shift_id)));
    const checkinByShift = new Map<string, number>();
    for (const c of checkins) {
      const id = String(c.shift_id);
      checkinByShift.set(id, (checkinByShift.get(id) || 0) + 1);
    }
    const worked = shifts.filter((s: any) => isShiftWorked(s, checkinByShift.get(String(s.shift_id)) || 0));
    const payroll: any = all.payroll.find((p: any) =>
      String(p.driver_id) === driverId && String(p.period) === period) || null;
    const todayShift: any = shifts.find((s: any) => String(s.shift_date) === day) || null;

    return {
      employee_id: driverId,
      employee_code: employee?.employee_code || '',
      full_name: employee?.full_name || '',
      phone: employee?.phone_normalized || employee?.phone || '',
      group: employee?.group || '',
      branch_id: employee?.default_branch_id || '',
      branch_name: this.branchName(all, employee?.default_branch_id),
      employment_status: employee?.employment_status || '',
      start_date: employee?.start_date || '',
      vehicle: vehicle
        ? {
          vehicle_id: vehicle.vehicle_id,
          license_plate: vehicle.license_plate,
          frame_number: vehicle.frame_number || '',
          status: vehicle.status,
          current_battery_pct: Number(vehicle.current_battery_pct ?? 0),
        }
        : null,
      today_shift: todayShift,
      month: {
        period,
        shifts_total: shifts.length,
        worked_days: worked.length,
        absent_days: shifts.length - worked.length,
        stops_total: checkins.length,
        late: checkins.filter((c: any) => c.is_late).length,
        missed: checkins.filter((c: any) => c.is_missed).length,
        distance_km: Math.round(shifts.reduce((n: number, s: any) => n + Number(s.total_distance_km || 0), 0) * 10) / 10,
        duration_min: Math.round(shifts.reduce((n: number, s: any) => n + Number(s.total_duration_min || 0), 0)),
      },
      payroll: payroll
        ? {
          payroll_id: payroll.payroll_id,
          status: payroll.status,
          gross_pay: payroll.gross_pay,
          penalty_amount: payroll.total_penalty_amount,
          net_pay: payroll.net_pay,
        }
        : null,
    };
  }

  /**
   * Bảo đảm ảnh bằng chứng giải trình có trên Drive (thư mục con của tab).
   * Chỉ upload ảnh chưa có `drive_file_id`, sau đó lưu lại ID vào phiếu để lần
   * đồng bộ sau không tạo trùng.
   */
  private async attachExplanationPhotos(ticket: any, day: string): Promise<any> {
    const photos = Array.isArray(ticket.photos) ? ticket.photos : [];
    const nextPhotos: any[] = [];
    let changed = false;

    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      let driveFileId = String(photo?.drive_file_id || '').trim();
      if (!driveFileId) {
        try {
          const hit = readExplanationPhoto(ticket.ticket_id, photo.photo_id, photo.mime_type);
          if (hit) {
            const ext = this.photoExt(hit.mimeType || photo.mime_type);
            const fileName = `anh-${String(i + 1).padStart(2, '0')}-${photo.photo_id}.${ext}`;
            const ref = await getDriveStorage().uploadBuffer(
              fileName,
              hit.mimeType || photo.mime_type || 'image/jpeg',
              hit.buffer,
              [...evDriveSegments(day, 'Giải trình'), 'Anh bang chung', String(ticket.ticket_code || ticket.ticket_id)],
              this.rootId,
              { upsert: true },
            );
            driveFileId = ref.fileId;
            changed = true;
          }
        } catch (err: any) {
          console.warn(`[EVDrive] Upload ảnh giải trình ${photo?.photo_id}: ${err?.message || err}`);
        }
      }
      nextPhotos.push({ ...photo, ...(driveFileId ? { drive_file_id: driveFileId } : {}) });
    }

    if (changed) {
      try {
        await this.repo.updateEVExplanationTicket(ticket.ticket_id, { photos: nextPhotos });
      } catch (err: any) {
        console.warn(`[EVDrive] Lưu drive_file_id giải trình ${ticket.ticket_id}: ${err?.message || err}`);
      }
    }

    const storage = getDriveStorage();
    return {
      ...ticket,
      driver_name: ticket.driver_name || '',
      photos: nextPhotos.map((p: any) => ({
        ...p,
        drive_url: p.drive_file_id ? storage.getViewUrl(p.drive_file_id) : undefined,
      })),
    };
  }

  private photoExt(mime?: string): string {
    const m = String(mime || '').toLowerCase();
    if (m.includes('png')) return 'png';
    if (m.includes('webp')) return 'webp';
    if (m.includes('gif')) return 'gif';
    return 'jpg';
  }

  // ------------------------------------------------------------------
  // Tiện ích dữ liệu
  // ------------------------------------------------------------------

  private employeeName(all: EVCollections, id: unknown): string {
    const key = String(id || '').trim();
    if (!key) return '';
    const e: any = all.employees.find((x: any) => String(x.employee_id) === key);
    return String(e?.full_name || '');
  }

  private employeeCode(all: EVCollections, id: unknown): string {
    const key = String(id || '').trim();
    if (!key) return '';
    const e: any = all.employees.find((x: any) => String(x.employee_id) === key);
    return String(e?.employee_code || '');
  }

  private vehiclePlate(all: EVCollections, id: unknown): string {
    const key = String(id || '').trim();
    if (!key) return '';
    const v: any = all.vehicles.find((x: any) => String(x.vehicle_id) === key);
    return String(v?.license_plate || '');
  }

  private routeName(all: EVCollections, id: unknown): string {
    const key = String(id || '').trim();
    if (!key) return '';
    const r: any = all.routes.find((x: any) => String(x.route_id) === key);
    return String(r?.name || '');
  }

  private branchName(all: EVCollections, id: unknown): string {
    const key = String(id || '').trim();
    if (!key) return '';
    const branches: any[] = (all as any).branches || [];
    const b: any = branches.find((x: any) => String(x.branch_id) === key);
    return String(b?.name || b?.branch_name || '');
  }

  private pickDayItems(items: any[], day: string): any[] {
    const sample = items.slice(0, 100);
    const hasDate = sample.some((item) => DATE_FIELDS.some((f) => String(item?.[f] || '').trim()));
    if (!hasDate) return items;
    return items.filter((item) => DATE_FIELDS.some((f) => {
      const value = String(item?.[f] || '').trim();
      if (!value) return false;
      if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01` === day;
      return normalizeEvDay(value) === day;
    }));
  }

  private countRecords(data: any): number {
    if (Array.isArray(data?.items)) return data.items.length;
    if (typeof data?.total === 'number') return Number(data.total);
    if (typeof data?.total_points === 'number') return Number(data.total_points);
    if (Array.isArray(data)) return data.length;
    return data ? 1 : 0;
  }

  private collectFields(data: any): string[] {
    const sample = Array.isArray(data?.items)
      ? data.items.slice(0, 50)
      : (Array.isArray(data) ? data.slice(0, 50) : []);
    if (sample.length) {
      const keys = new Set<string>();
      for (const item of sample) {
        if (!item || typeof item !== 'object') continue;
        for (const key of Object.keys(item)) keys.add(key);
      }
      return [...keys];
    }
    if (!data || typeof data !== 'object') return [];
    return Object.keys(data).filter((k) => !['generated_at', 'day', 'period'].includes(k));
  }

  private backfillDays(): number {
    const raw = Number(process.env.GOOGLE_DRIVE_EV_BACKFILL_DAYS);
    if (!Number.isFinite(raw)) return 7;
    return Math.min(Math.max(Math.floor(raw), 0), 31);
  }

  /** Các ngày trong khoảng backfill có phát sinh dữ liệu EV (luôn gồm hôm nay). */
  private daysWithData(limit: number): string[] {
    const today = evToday();
    const days = new Set<string>([today]);
    if (limit <= 0) return [today];
    const from = new Date(Date.parse(`${today}T00:00:00Z`) - (limit - 1) * 86_400_000)
      .toISOString().slice(0, 10);
    const add = (value: unknown) => {
      const d = normalizeEvDay(value);
      if (d && d >= from && d <= today) days.add(d);
    };

    for (const s of this.arr('evShifts')) add(s.shift_date);
    for (const c of this.arr('evShiftCheckins')) add(c.checked_in_at);
    for (const t of this.arr('evChargingTickets')) {
      add(t.requested_date);
      add(t.created_at);
    }
    for (const r of this.arr('evRouteChangeRequests')) {
      add(r.created_at);
      add(r.effective_from);
    }
    for (const t of this.arr('evExplanationTickets')) {
      add(t.created_at);
      for (const it of t.items || []) add(it.shift_date);
    }
    for (const p of this.arr('evDriverPayroll')) {
      const period = String(p.period || '');
      if (/^\d{4}-\d{2}$/.test(period)) add(`${period}-01`);
    }
    for (const g of this.arr('evGpsPoints')) add(g.recorded_at);

    return [...days].sort();
  }

  // ------------------------------------------------------------------
  // Ghi Drive
  // ------------------------------------------------------------------

  private async putJson(day: string, tab: string, fileName: string, data: any): Promise<any> {
    return this.putJsonAt(evDriveSegments(day, tab), fileName, data);
  }

  private async putJsonAt(segments: string[], fileName: string, data: any): Promise<any> {
    const buffer = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
    const ref = await getDriveStorage().uploadBuffer(
      fileName,
      'application/json; charset=utf-8',
      buffer,
      segments,
      this.rootId,
      { upsert: true },
    );
    return {
      tab: segments.length ? segments[segments.length - 1] : '',
      file: fileName,
      file_id: ref.fileId,
      url: ref.viewUrl,
    };
  }
}
