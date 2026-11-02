import fs from 'fs';
import path from 'path';
import { DRIVE_SUBFOLDERS } from '../config/drive-folders.js';
import {
  addDaysVn,
  isoWeekOf,
  pad2,
  previousMonthKey,
  resolveDueBackups,
  vnParts,
  ymdOf,
  type BackupKind,
  type BackupScheduleConfig,
} from './backup-drive.service.js';
import { notifySystemAlert } from './system-alert.service.js';

/**
 * BACKUP DỮ LIỆU HỆ THỐNG LÊN GOOGLE DRIVE — CHẾ ĐỘ GOOGLE SHEETS
 * ------------------------------------------------------------------
 * Khi nguồn sự thật là Google Sheets (DATA_STORE=sheets — cấu hình đang chạy
 * trên VPS), mỗi kỳ backup sẽ COPY NGUYÊN spreadsheet live sang đúng thư mục:
 *
 *   01. BACKUP_DATA_DAY/YYYY-MM-DD/UMB_NHANSU_DATABASE_YYYY-MM-DD
 *   02. BACKUP_DATA_WEEK/YYYY-Www/UMB_NHANSU_DATABASE_YYYY-Www
 *   03. BACKUP_DATA_MONTH/YYYY-MM/UMB_NHANSU_DATABASE_YYYY-MM
 *
 * Lịch chạy (giờ Việt Nam, UTC+7 — không phụ thuộc TZ của container):
 *   - NGÀY   : 02:00 sáng hôm sau  → dữ liệu của NGÀY HÔM TRƯỚC.
 *   - TUẦN   : 02:00 Chủ Nhật      → dữ liệu TUẦN HIỆN TẠI (lỡ thì bù Thứ Hai).
 *   - THÁNG  : 02:00 ngày 1        → dữ liệu THÁNG TRƯỚC (lỡ thì bù các ngày sau).
 *
 * "Realtime": bản backup là bản sao spreadsheet tại đúng thời điểm chạy, nên
 * phản ánh toàn bộ dữ liệu mới nhất (kể cả sửa tay trên Sheet) — không dùng
 * snapshot cũ trong RAM. Bản sao do Google tạo server-side, không tải dữ liệu
 * qua VPS.
 *
 * Mốc đã chạy lưu ở data/backups/sheets-backup-state.json (volume Docker) để
 * restart không chạy trùng; lỗi sẽ thử lại sau BACKUP_RETRY_MINUTES phút.
 */

export type SheetsBackupKind = Extract<BackupKind, 'daily' | 'weekly' | 'monthly'>;

export interface SheetsBackupConfig {
  dailyEnabled: boolean;
  weeklyEnabled: boolean;
  monthlyEnabled: boolean;
  atHour: number;
  atMinute: number;
  /** 0 = Chủ Nhật. */
  weeklyWeekday: number;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  retryMs: number;
}

export interface SheetsBackupState {
  last_daily_date?: string;
  last_weekly_key?: string;
  last_monthly_key?: string;
  last_ok_at?: string;
  last_error?: string | null;
  last_error_at?: string | null;
  retry_after?: Partial<Record<SheetsBackupKind, number>>;
  last_result?: Partial<Record<SheetsBackupKind, SheetsBackupResult>>;
}

export interface SheetsBackupResult {
  kind: SheetsBackupKind;
  ok: boolean;
  slotKey: string;
  at: string;
  name: string;
  fileId: string | null;
  url: string | null;
  folderId: string | null;
  deletedOld: number;
  error: string | null;
  durationMs: number;
}

const STATE_FILE = 'sheets-backup-state.json';

function envFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = String(value).trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

function envNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function sheetsBackupConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SheetsBackupConfig {
  return {
    dailyEnabled: envFlag(env.BACKUP_DAILY_ENABLED, true),
    weeklyEnabled: envFlag(env.BACKUP_WEEKLY_ENABLED, true),
    monthlyEnabled: envFlag(env.BACKUP_MONTHLY_ENABLED, true),
    atHour: envNumber(env.BACKUP_DAILY_HOUR, 2, 0, 23),
    atMinute: envNumber(env.BACKUP_AT_MINUTE, 0, 0, 59),
    weeklyWeekday: envNumber(env.BACKUP_WEEKLY_WEEKDAY, 0, 0, 6),
    keepDaily: envNumber(env.BACKUP_KEEP_DAILY_DAYS, 30, 2, 365),
    keepWeekly: envNumber(env.BACKUP_KEEP_WEEKLY_WEEKS, 12, 2, 104),
    keepMonthly: envNumber(env.BACKUP_KEEP_MONTHLY_MONTHS, 36, 2, 120),
    retryMs: envNumber(env.BACKUP_RETRY_MINUTES, 5, 1, 180) * 60_000,
  };
}

const ROOT_ENV: Record<SheetsBackupKind, string> = {
  daily: 'GOOGLE_DRIVE_BACKUP_DAY_FOLDER_ID',
  weekly: 'GOOGLE_DRIVE_BACKUP_WEEK_FOLDER_ID',
  monthly: 'GOOGLE_DRIVE_BACKUP_MONTH_FOLDER_ID',
};

/** ID thư mục gốc 01/02/03 (cho phép ghi đè bằng env khi chạy Drive khác). */
export function sheetsBackupRootId(kind: SheetsBackupKind): string {
  const fromEnv = String(process.env[ROOT_ENV[kind]] || '').trim();
  if (fromEnv) return fromEnv;
  if (kind === 'daily') return DRIVE_SUBFOLDERS.BACKUP_DAY;
  if (kind === 'weekly') return DRIVE_SUBFOLDERS.BACKUP_WEEK;
  return DRIVE_SUBFOLDERS.BACKUP_MONTH;
}

export function sheetsBackupKeep(kind: SheetsBackupKind, cfg: SheetsBackupConfig): number {
  if (kind === 'daily') return cfg.keepDaily;
  if (kind === 'weekly') return cfg.keepWeekly;
  return cfg.keepMonthly;
}

function scheduleCfg(cfg: SheetsBackupConfig): BackupScheduleConfig {
  return {
    hourlyEnabled: false,
    hourlyMinutes: 15,
    dailyEnabled: cfg.dailyEnabled,
    dailyHour: cfg.atHour,
    weeklyEnabled: cfg.weeklyEnabled,
    weeklyWeekday: cfg.weeklyWeekday,
    monthlyEnabled: cfg.monthlyEnabled,
    atMinute: cfg.atMinute,
    hourlyExcludeTables: [],
    hourlyKeepHours: 48,
    dailyKeepDays: cfg.keepDaily,
    weeklyKeepWeeks: cfg.keepWeekly,
    monthlyKeepMonths: cfg.keepMonthly,
    retryMs: cfg.retryMs,
  };
}

/** Mốc kỳ đang tới hạn — dùng chung logic lịch với scheduler PostgreSQL. */
export function resolveDueSheetsBackups(
  state: SheetsBackupState,
  nowMs: number,
  cfg: SheetsBackupConfig = sheetsBackupConfigFromEnv(),
): Array<{ kind: SheetsBackupKind; slotKey: string }> {
  return resolveDueBackups(state as any, nowMs, scheduleCfg(cfg))
    .filter((d): d is typeof d & { kind: SheetsBackupKind } => d.kind !== 'hourly')
    .map(d => ({ kind: d.kind as SheetsBackupKind, slotKey: d.slotKey }));
}

function slotForRunNow(kind: SheetsBackupKind, nowMs: number): string {
  const now = vnParts(nowMs);
  if (kind === 'daily') return ymdOf(addDaysVn(now, -1));
  if (kind === 'monthly') return previousMonthKey(now);
  const iso = isoWeekOf(now);
  return `${iso.year}-W${pad2(iso.week)}`;
}

const KIND_LABEL: Record<SheetsBackupKind, string> = {
  daily: 'ngày',
  weekly: 'tuần',
  monthly: 'tháng',
};

/** Ngày (YYYY-MM-DD) theo giờ Việt Nam của 1 mốc ISO. */
function vnDateOfIso(iso: string | null | undefined): string | null {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + 7 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Tóm tắt trạng thái backup cho card "Sức khỏe máy chủ" (Admin).
 *
 * Đọc thẳng từ state file (volume Docker) thay vì chỉ dựa vào
 * `system_backups` trong CAU_HINH_HE_THONG — tab cấu hình có thể bị lượt
 * full-push sau ghi đè bằng snapshot RAM cũ, làm mất dòng trạng thái.
 */
export function dashboardSnapshotFromState(state: SheetsBackupState): any | null {
  const daily = state.last_result?.daily;
  if (!daily) return null;
  return {
    last_backup_date: vnDateOfIso(daily.at) || vnDateOfIso(state.last_ok_at),
    last_ok_at: daily.ok ? daily.at : (state.last_ok_at || null),
    last_error: daily.ok ? null : daily.error,
    last_error_at: daily.ok ? null : daily.at,
    last_file_id: daily.fileId || null,
    last_name: daily.name || null,
    last_slot: daily.slotKey || null,
    last_deleted_old: Number(daily.deletedOld || 0),
    mode: 'SHEETS',
  };
}

export class SheetsDriveBackupScheduler {
  private timer: NodeJS.Timeout | null = null;
  private bootTimer: NodeJS.Timeout | null = null;
  private ticking = false;
  private started = false;
  private stateLoaded = false;
  private state: SheetsBackupState = {};
  private readonly adapter: any;
  private readonly cfg: SheetsBackupConfig;

  constructor(adapter: any, cfg: SheetsBackupConfig = sheetsBackupConfigFromEnv()) {
    this.adapter = adapter;
    this.cfg = cfg;
  }

  private get syncService(): any {
    return this.adapter?.syncService || null;
  }

  public isEnabled(): boolean {
    const sync = this.syncService;
    if (!sync) return false;
    try {
      return typeof sync.isDriveReady === 'function' ? sync.isDriveReady() : !!sync;
    } catch {
      return false;
    }
  }

  public async start(): Promise<boolean> {
    if (this.started) return true;
    if (!this.isEnabled()) {
      console.log('[backup-sheets] Bỏ qua: Google Drive chưa sẵn sàng.');
      return false;
    }
    this.started = true;
    await this.loadState();
    // Chờ backend pull Sheets xong rồi mới chạy kỳ còn thiếu.
    this.bootTimer = setTimeout(() => void this.tick(), 20_000);
    this.timer = setInterval(() => void this.tick(), 30_000);
    console.log(
      `[backup-sheets] Đã bật: ngày ${pad2(this.cfg.atHour)}:${pad2(this.cfg.atMinute)} (hôm trước)`
      + ` | tuần CN ${pad2(this.cfg.atHour)}:${pad2(this.cfg.atMinute)} (tuần hiện tại)`
      + ` | tháng ngày 1 ${pad2(this.cfg.atHour)}:${pad2(this.cfg.atMinute)} (tháng trước)`
      + ' | TZ Asia/Ho_Chi_Minh',
    );
    return true;
  }

  public stop(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.timer) clearInterval(this.timer);
    this.bootTimer = null;
    this.timer = null;
    this.started = false;
  }

  public async getStatus(): Promise<any> {
    await this.loadState();
    return {
      enabled: this.isEnabled(),
      running: this.started,
      mode: 'SHEETS',
      dataStore: 'GOOGLE_SHEETS',
      driveConfigured: this.isEnabled(),
      localDir: this.localRoot(),
      schedule: {
        daily: this.cfg.dailyEnabled
          ? `${pad2(this.cfg.atHour)}:${pad2(this.cfg.atMinute)} hằng ngày — dữ liệu NGÀY HÔM TRƯỚC`
          : 'tắt',
        weekly: this.cfg.weeklyEnabled
          ? `${pad2(this.cfg.atHour)}:${pad2(this.cfg.atMinute)} Chủ Nhật — dữ liệu TUẦN HIỆN TẠI`
          : 'tắt',
        monthly: this.cfg.monthlyEnabled
          ? `${pad2(this.cfg.atHour)}:${pad2(this.cfg.atMinute)} ngày 1 — dữ liệu THÁNG TRƯỚC`
          : 'tắt',
        hourly: 'tắt (không dùng cho chế độ Google Sheets)',
        timezone: 'Asia/Ho_Chi_Minh (UTC+7)',
      },
      retention: {
        daily_days: this.cfg.keepDaily,
        weekly_weeks: this.cfg.keepWeekly,
        monthly_months: this.cfg.keepMonthly,
      },
      roots: {
        daily: sheetsBackupRootId('daily'),
        weekly: sheetsBackupRootId('weekly'),
        monthly: sheetsBackupRootId('monthly'),
      },
      state: this.state,
      now: new Date().toISOString(),
      nowVn: new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 19).replace('T', ' '),
    };
  }

  /** Chạy tay 1 kỳ (kiểm tra vận hành); không đánh dấu mốc lịch. */
  public async runNow(kind: SheetsBackupKind): Promise<SheetsBackupResult> {
    if (!this.isEnabled()) throw new Error('DRIVE_NOT_CONFIGURED');
    if (!['daily', 'weekly', 'monthly'].includes(kind)) {
      throw new Error(`INVALID_BACKUP_KIND:${kind}`);
    }
    await this.loadState();
    return this.run({ kind, slotKey: slotForRunNow(kind, Date.now()) }, true);
  }

  private localRoot(): string {
    return path.resolve(process.env.BACKUP_LOCAL_DIR || path.join(process.cwd(), 'data', 'backups'));
  }

  private stateFile(): string {
    return path.join(this.localRoot(), STATE_FILE);
  }

  private async loadState(): Promise<void> {
    if (this.stateLoaded) return;
    try {
      const raw = fs.readFileSync(this.stateFile(), 'utf8');
      const parsed = JSON.parse(raw);
      this.state = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      this.state = {};
    }
    this.stateLoaded = true;
  }

  private saveState(): void {
    try {
      const file = this.stateFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err: any) {
      console.warn('[backup-sheets] Không lưu được mốc backup:', err?.message || err);
    }
  }

  private async tick(): Promise<void> {
    if (!this.started || this.ticking || !this.isEnabled()) return;
    this.ticking = true;
    try {
      const now = Date.now();
      const due = resolveDueSheetsBackups(this.state, now, this.cfg)
        .filter(d => (this.state.retry_after?.[d.kind] || 0) <= now);
      if (due.length > 0) await this.run(due[0]);
    } catch (err: any) {
      console.warn('[backup-sheets] tick error:', err?.message || err);
    } finally {
      this.ticking = false;
    }
  }

  private async run(period: { kind: SheetsBackupKind; slotKey: string }, manual = false): Promise<SheetsBackupResult> {
    const startedAt = Date.now();
    const at = new Date().toISOString();
    const name = `UMB_NHANSU_DATABASE_${period.slotKey}${manual ? '_manual' : ''}`;
    const result: SheetsBackupResult = {
      kind: period.kind,
      ok: false,
      slotKey: period.slotKey,
      at,
      name,
      fileId: null,
      url: null,
      folderId: null,
      deletedOld: 0,
      error: null,
      durationMs: 0,
    };

    try {
      const sync = this.syncService;
      if (!sync?.backupSpreadsheetTo) throw new Error('SYNC_SERVICE_NOT_READY');
      const res = await sync.backupSpreadsheetTo({
        rootId: sheetsBackupRootId(period.kind),
        segments: [period.slotKey],
        name,
        keep: sheetsBackupKeep(period.kind, this.cfg),
      });
      if (!res?.ok) throw new Error(res?.error || res?.reason || 'BACKUP_FAILED');
      result.fileId = res.fileId || null;
      result.url = res.url || null;
      result.folderId = res.folderId || null;
      result.deletedOld = Number(res.deletedOld || 0);
      result.ok = true;
    } catch (err: any) {
      result.error = err?.message || String(err);
    }

    result.durationMs = Date.now() - startedAt;
    this.applyOutcome(result, manual);
    this.saveState();
    await this.recordDashboard(result).catch(() => null);

    if (result.ok) {
      console.log(
        `[backup-sheets] ${period.kind}${manual ? ' (chạy tay)' : ''} OK ${result.name}`
        + ` | ${result.url || result.fileId} | dọn ${result.deletedOld} kỳ cũ (${result.durationMs}ms)`,
      );
    } else {
      console.warn(`[backup-sheets] ${period.kind}${manual ? ' (chạy tay)' : ''} LỖI ${result.name}: ${result.error}`);
      if (!manual) {
        void notifySystemAlert({
          code: `BACKUP_SHEETS_${period.kind.toUpperCase()}_FAILED`,
          severity: 'URGENT',
          title: `🚨 Backup ${KIND_LABEL[period.kind]} thất bại`,
          message: `Không sao lưu được dữ liệu Google Sheets lên Drive (${result.error}). Hệ thống sẽ tự thử lại sau ${Math.round(this.cfg.retryMs / 60_000)} phút.`,
          details: { kind: period.kind, slotKey: period.slotKey, name: result.name, error: result.error },
        });
      }
    }

    return result;
  }

  private applyOutcome(result: SheetsBackupResult, manual: boolean): void {
    const st = this.state;
    if (result.ok) {
      if (!manual) {
        if (result.kind === 'daily') st.last_daily_date = result.slotKey;
        if (result.kind === 'weekly') st.last_weekly_key = result.slotKey;
        if (result.kind === 'monthly') st.last_monthly_key = result.slotKey;
      }
      st.last_ok_at = result.at;
      st.last_error = null;
      if (st.retry_after) delete st.retry_after[result.kind];
    } else if (!manual) {
      st.last_error = `${result.kind}: ${result.error}`;
      st.last_error_at = result.at;
      st.retry_after = { ...(st.retry_after || {}), [result.kind]: Date.now() + this.cfg.retryMs };
    }
    st.last_result = { ...(st.last_result || {}), [result.kind]: result };
  }

  /** Cập nhật card "Sức khỏe máy chủ" của Admin (chỉ bản ngày). */
  private async recordDashboard(result: SheetsBackupResult): Promise<void> {
    if (result.kind !== 'daily' || !this.adapter?.updateSystemSettings) return;
    const cur: any = await this.adapter.getSystemSettings?.().catch?.(() => ({})) || {};
    const vnToday = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const prev = cur.system_backups || {};
    await this.adapter.updateSystemSettings({
      ...cur,
      system_backups: result.ok
        ? {
          last_backup_date: vnToday,
          last_ok_at: result.at,
          last_file_id: result.fileId,
          last_name: result.name,
          last_deleted_old: result.deletedOld,
          last_slot: result.slotKey,
          last_error: null,
        }
        : {
          ...prev,
          last_error_at: result.at,
          last_error: result.error,
        },
    });
  }
}

let singleton: SheetsDriveBackupScheduler | null = null;

export function getSheetsBackupScheduler(adapter: any): SheetsDriveBackupScheduler {
  if (!singleton) singleton = new SheetsDriveBackupScheduler(adapter);
  return singleton;
}

export function resetSheetsBackupSchedulerForTests(): void {
  singleton?.stop();
  singleton = null;
}
