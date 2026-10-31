import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { DRIVE_SUBFOLDERS } from '../config/drive-folders.js';
import type { DriveStorageService } from './drive-storage.service.js';
import type { BackupExportResult, PostgresStore } from '../repositories/postgres-store.js';
import { notifySystemAlert } from './system-alert.service.js';

/**
 * BACKUP 4 TẦNG LÊN GOOGLE DRIVE (PostgreSQL là nguồn sự thật)
 * -------------------------------------------------------------
 *  - Theo giờ  : mỗi 15 phút (mặc định), file nhỏ (bỏ bảng audit/thông báo).
 *  - Theo ngày : 02:00 mỗi ngày, full dữ liệu.
 *  - Theo tuần : 02:00 Chủ Nhật, full dữ liệu.
 *  - Theo tháng: 02:00 ngày cuối tháng, full dữ liệu.
 *
 * Cấu trúc Drive (dưới UMBOMILK_DATABASE):
 *   BACKUP_DATA_HOUR/HOURLY/YYYY-MM-DD/postgres_YYYY-MM-DD_HHmm.jsonl.gz
 *   01. BACKUP_DATA_DAY/DAILY/YYYY-MM-DD/postgres_YYYY-MM-DD.jsonl.gz
 *   02. BACKUP_DATA_WEEK/WEEKLY/YYYY-Www/postgres_YYYY-Www.jsonl.gz
 *   03. BACKUP_DATA_MONTH/MONTHLY/YYYY-MM/postgres_YYYY-MM.jsonl.gz
 *
 * Chạy tay qua API dùng tên `..._manual.jsonl.gz` và không đánh dấu mốc kỳ.
 *
 * Mỗi file .jsonl.gz là 1 bản dump có thể phục hồi bằng
 * `npm run restore:postgres -- --file=<đường dẫn> --force`.
 *
 * File luôn ghi đĩa VPS trước (data/backups/...) rồi mới upload Drive; Drive
 * lỗi không làm mất bản backup local. Lịch chạy dùng giờ Việt Nam (UTC+7) và
 * lưu mốc đã chạy trong app_settings để restart không chạy trùng.
 */

export type BackupKind = 'hourly' | 'daily' | 'weekly' | 'monthly';

export interface BackupScheduleConfig {
  hourlyEnabled: boolean;
  hourlyMinutes: number;
  dailyEnabled: boolean;
  dailyHour: number;
  weeklyEnabled: boolean;
  /** 0 = Chủ Nhật (JS getUTCDay). */
  weeklyWeekday: number;
  monthlyEnabled: boolean;
  atMinute: number;
  hourlyExcludeTables: string[];
  hourlyKeepHours: number;
  dailyKeepDays: number;
  weeklyKeepWeeks: number;
  monthlyKeepMonths: number;
  retryMs: number;
}

export interface BackupTarget {
  /** Thư mục gốc trên Drive (01/02/03. BACKUP...). */
  rootId: string;
  segments: string[];
  fileName: string;
}

export interface DueBackup {
  kind: BackupKind;
  /** Mốc duy nhất của kỳ (YYYY-MM-DDTHH:mm / YYYY-MM-DD / YYYY-Www / YYYY-MM). */
  slotKey: string;
  target: BackupTarget;
}

export interface BackupScheduleState {
  last_hourly_slot?: string;
  last_daily_date?: string;
  last_weekly_key?: string;
  last_monthly_key?: string;
  last_ok_at?: string;
  last_error?: string | null;
  last_error_at?: string | null;
  retry_after?: Partial<Record<BackupKind, number>>;
  last_result?: Partial<Record<BackupKind, BackupRunResult>>;
}

export interface BackupRunResult {
  kind: BackupKind;
  ok: boolean;
  slotKey: string;
  at: string;
  file: string;
  sizeKb: number;
  rows: number;
  counts: Record<string, number>;
  sha256: string;
  driveFileId: string | null;
  driveUrl: string | null;
  localPath: string | null;
  error: string | null;
  durationMs: number;
}

const VN_OFFSET_MS = 7 * 3_600_000;
const STATE_KEY = 'backup_schedule_v1';

function positiveNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function flag(value: string | undefined, fallback = true): boolean {
  if (value === undefined) return fallback;
  const v = String(value).trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

export function backupConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BackupScheduleConfig {
  const excludeRaw = env.BACKUP_HOURLY_EXCLUDE_TABLES;
  const exclude = (excludeRaw === undefined
    ? 'audit_logs,notification_inbox,notification_outbox,backup_snapshots'
    : excludeRaw)
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
  return {
    hourlyEnabled: flag(env.BACKUP_HOURLY_ENABLED),
    hourlyMinutes: Math.max(5, Math.min(60, positiveNumber(env.BACKUP_HOURLY_MINUTES, 15))),
    dailyEnabled: flag(env.BACKUP_DAILY_ENABLED),
    dailyHour: Math.max(0, Math.min(23, Number(env.BACKUP_DAILY_HOUR ?? 2))),
    weeklyEnabled: flag(env.BACKUP_WEEKLY_ENABLED),
    weeklyWeekday: Math.max(0, Math.min(6, Number(env.BACKUP_WEEKLY_WEEKDAY ?? 0))),
    monthlyEnabled: flag(env.BACKUP_MONTHLY_ENABLED),
    atMinute: Math.max(0, Math.min(59, Number(env.BACKUP_AT_MINUTE ?? 0))),
    hourlyExcludeTables: exclude,
    hourlyKeepHours: positiveNumber(env.BACKUP_KEEP_HOURLY_HOURS, 48),
    dailyKeepDays: positiveNumber(env.BACKUP_KEEP_DAILY_DAYS, 30),
    weeklyKeepWeeks: positiveNumber(env.BACKUP_KEEP_WEEKLY_WEEKS, 12),
    monthlyKeepMonths: positiveNumber(env.BACKUP_KEEP_MONTHLY_MONTHS, 36),
    retryMs: positiveNumber(env.BACKUP_RETRY_MINUTES, 5) * 60_000,
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Các thành phần thời gian theo giờ Việt Nam, đọc qua getUTC*. */
function vnParts(nowMs: number) {
  const d = new Date(nowMs + VN_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  };
}

function ymdOf(p: { year: number; month: number; day: number }): string {
  return `${p.year}-${pad2(p.month + 1)}-${pad2(p.day)}`;
}

/** Tuần ISO 8601 (thứ Hai là đầu tuần). */
export function isoWeekOf(p: { year: number; month: number; day: number }): { year: number; week: number } {
  const t = new Date(Date.UTC(p.year, p.month, p.day));
  const dayNum = (t.getUTCDay() + 6) % 7; // Thứ Hai = 0
  t.setUTCDate(t.getUTCDate() - dayNum + 3); // Thứ Năm của tuần
  const isoYear = t.getUTCFullYear();
  const firstThu = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((t.getTime() - firstThu.getTime()) / (7 * 86_400_000));
  return { year: isoYear, week };
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function targetFor(kind: BackupKind, slotKey: string): BackupTarget {
  switch (kind) {
    case 'hourly': {
      const day = slotKey.slice(0, 10);
      const hhmm = slotKey.slice(11).replace(':', '');
      return {
        rootId: DRIVE_SUBFOLDERS.BACKUP_HOUR || DRIVE_SUBFOLDERS.BACKUP_DAY,
        segments: ['HOURLY', day],
        fileName: `postgres_${day}_${hhmm}.jsonl.gz`,
      };
    }
    case 'daily':
      return {
        rootId: DRIVE_SUBFOLDERS.BACKUP_DAY,
        segments: ['DAILY', slotKey],
        fileName: `postgres_${slotKey}.jsonl.gz`,
      };
    case 'weekly':
      return {
        rootId: DRIVE_SUBFOLDERS.BACKUP_WEEK,
        segments: ['WEEKLY', slotKey],
        fileName: `postgres_${slotKey}.jsonl.gz`,
      };
    case 'monthly':
      return {
        rootId: DRIVE_SUBFOLDERS.BACKUP_MONTH,
        segments: ['MONTHLY', slotKey],
        fileName: `postgres_${slotKey}.jsonl.gz`,
      };
  }
}

const KIND_PRIORITY: Record<BackupKind, number> = {
  monthly: 0,
  weekly: 1,
  daily: 2,
  hourly: 3,
};

/**
 * Hàm thuần: trả về các kỳ backup đã tới hạn nhưng chưa chạy.
 * Xử lý cả trường hợp VPS tắt lâu (chạy bù đúng 1 lần cho kỳ gần nhất).
 */
export function resolveDueBackups(
  state: BackupScheduleState,
  nowMs: number,
  cfg: BackupScheduleConfig = backupConfigFromEnv(),
): DueBackup[] {
  const now = vnParts(nowMs);
  const today = ymdOf(now);
  const minutesNow = now.hour * 60 + now.minute;
  const atMinutes = (hour: number) => hour * 60 + cfg.atMinute;
  const due: DueBackup[] = [];

  if (cfg.hourlyEnabled) {
    const interval = Math.max(5, Math.min(60, cfg.hourlyMinutes));
    const slotMinute = Math.floor(now.minute / interval) * interval;
    const slotKey = `${today}T${pad2(now.hour)}:${pad2(slotMinute)}`;
    if (state.last_hourly_slot !== slotKey) {
      due.push({ kind: 'hourly', slotKey, target: targetFor('hourly', slotKey) });
    }
  }

  if (cfg.dailyEnabled) {
    if (minutesNow >= atMinutes(cfg.dailyHour) && state.last_daily_date !== today) {
      due.push({ kind: 'daily', slotKey: today, target: targetFor('daily', today) });
    }
  }

  if (cfg.weeklyEnabled) {
    // Chỉ chạy đúng ngày (mặc định Chủ Nhật) từ 02:00. Lỡ ngày thì bỏ kỳ đó —
    // backup giờ/ngày vẫn phủ dữ liệu, tránh tạo file tuần cũ chứa dữ liệu mới.
    const isWeeklyDay = now.weekday === cfg.weeklyWeekday;
    if (isWeeklyDay && minutesNow >= atMinutes(cfg.dailyHour)) {
      const iso = isoWeekOf(now);
      const key = `${iso.year}-W${pad2(iso.week)}`;
      if (state.last_weekly_key !== key) {
        due.push({ kind: 'weekly', slotKey: key, target: targetFor('weekly', key) });
      }
    }
  }

  if (cfg.monthlyEnabled) {
    // Chỉ chạy đúng ngày cuối tháng từ 02:00.
    const isMonthEnd = now.day === lastDayOfMonth(now.year, now.month);
    if (isMonthEnd && minutesNow >= atMinutes(cfg.dailyHour)) {
      const key = `${now.year}-${pad2(now.month + 1)}`;
      if (state.last_monthly_key !== key) {
        due.push({ kind: 'monthly', slotKey: key, target: targetFor('monthly', key) });
      }
    }
  }

  return due.sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);
}

function sanitizeSegment(value: string): string {
  return String(value || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function retentionMs(kind: BackupKind, cfg: BackupScheduleConfig): number {
  switch (kind) {
    case 'hourly': return cfg.hourlyKeepHours * 3_600_000;
    case 'daily': return cfg.dailyKeepDays * 86_400_000;
    case 'weekly': return cfg.weeklyKeepWeeks * 7 * 86_400_000;
    case 'monthly': return cfg.monthlyKeepMonths * 30 * 86_400_000;
  }
}

function keepFolders(kind: BackupKind, cfg: BackupScheduleConfig): number {
  switch (kind) {
    case 'hourly': return Math.max(2, Math.ceil(cfg.hourlyKeepHours / 24) + 1);
    case 'daily': return Math.max(2, Math.ceil(cfg.dailyKeepDays));
    case 'weekly': return Math.max(2, Math.ceil(cfg.weeklyKeepWeeks));
    case 'monthly': return Math.max(2, Math.ceil(cfg.monthlyKeepMonths));
  }
}

export class DriveBackupScheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private started = false;
  private stateLoaded = false;
  private state: BackupScheduleState = {};
  private readonly adapter: any;
  private readonly store: PostgresStore | null;
  private readonly drive: DriveStorageService | null;
  private readonly cfg: BackupScheduleConfig;

  constructor(adapter: any, cfg: BackupScheduleConfig = backupConfigFromEnv()) {
    this.adapter = adapter;
    this.store = (adapter?.store as PostgresStore) || null;
    this.drive = (adapter?.drive as DriveStorageService) || null;
    this.cfg = cfg;
  }

  public isEnabled(): boolean {
    return !!this.store?.configured;
  }

  public async start(): Promise<boolean> {
    if (this.started) return true;
    if (!this.isEnabled()) {
      console.log('[backup-drive] Bỏ qua: chưa cấu hình PostgreSQL (backup chỉ chạy khi DATA_STORE=postgres).');
      return false;
    }
    this.started = true;
    try {
      this.state = (await this.store!.getSetting<BackupScheduleState>(STATE_KEY)) || {};
    } catch (err: any) {
      console.warn('[backup-drive] Không đọc được mốc backup cũ:', err?.message || err);
      this.state = {};
    }
    this.stateLoaded = true;
    // Chờ hệ thống ổn định sau boot rồi mới chạy kỳ đến hạn.
    setTimeout(() => void this.tick(), 20_000);
    this.timer = setInterval(() => void this.tick(), 30_000);
    console.log(
      `[backup-drive] Đã bật: giờ ${this.cfg.hourlyMinutes} phút | ngày ${pad2(this.cfg.dailyHour)}:${pad2(this.cfg.atMinute)}`
      + ` | tuần CN ${pad2(this.cfg.dailyHour)}:${pad2(this.cfg.atMinute)} | tháng cuối tháng ${pad2(this.cfg.dailyHour)}:${pad2(this.cfg.atMinute)}`
      + ` | Drive ${this.drive?.isConfigured() ? 'OK' : 'CHƯA CẤU HÌNH'}`,
    );
    return true;
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
  }

  public async getStatus(): Promise<any> {
    let persisted: BackupScheduleState | null = null;
    try {
      persisted = this.store?.configured ? await this.store.getSetting<BackupScheduleState>(STATE_KEY) : null;
    } catch { /* đọc trạng thái lỗi không chặn dashboard */ }
    const state = persisted || this.state;
    return {
      enabled: this.isEnabled(),
      running: this.started,
      dataStore: this.store?.configured ? 'POSTGRES' : 'MEMORY',
      driveConfigured: !!this.drive?.isConfigured(),
      localDir: this.localRoot(),
      schedule: {
        hourly: this.cfg.hourlyEnabled ? `mỗi ${this.cfg.hourlyMinutes} phút` : 'tắt',
        daily: this.cfg.dailyEnabled ? `${pad2(this.cfg.dailyHour)}:${pad2(this.cfg.atMinute)} hằng ngày` : 'tắt',
        weekly: this.cfg.weeklyEnabled ? `${pad2(this.cfg.dailyHour)}:${pad2(this.cfg.atMinute)} Chủ Nhật` : 'tắt',
        monthly: this.cfg.monthlyEnabled ? `${pad2(this.cfg.dailyHour)}:${pad2(this.cfg.atMinute)} ngày cuối tháng` : 'tắt',
        timezone: 'Asia/Ho_Chi_Minh (UTC+7)',
      },
      retention: {
        hourly_hours: this.cfg.hourlyKeepHours,
        daily_days: this.cfg.dailyKeepDays,
        weekly_weeks: this.cfg.weeklyKeepWeeks,
        monthly_months: this.cfg.monthlyKeepMonths,
      },
      hourlyExcludeTables: this.cfg.hourlyExcludeTables,
      state,
      now: new Date().toISOString(),
    };
  }

  /**
   * Chạy tay 1 kỳ (nút "Backup ngay" / kiểm tra vận hành).
   *
   * Chạy được bất kể hôm nay có đúng lịch hay không (ví dụ thử backup tuần vào
   * thứ Tư). Tên file có hậu tố `_manual` để không ghi đè bản theo lịch, và
   * KHÔNG cập nhật mốc kỳ đã chạy — lịch thật vẫn chạy đúng như cấu hình.
   */
  public async runNow(kind: BackupKind): Promise<BackupRunResult> {
    if (!this.isEnabled()) {
      throw new Error('POSTGRES_NOT_CONFIGURED');
    }
    if (!['hourly', 'daily', 'weekly', 'monthly'].includes(kind)) {
      throw new Error(`INVALID_BACKUP_KIND:${kind}`);
    }
    await this.loadState();
    const now = vnParts(Date.now());
    let slotKey: string;
    switch (kind) {
      case 'hourly': {
        const interval = Math.max(5, Math.min(60, this.cfg.hourlyMinutes));
        const slotMinute = Math.floor(now.minute / interval) * interval;
        slotKey = `${ymdOf(now)}T${pad2(now.hour)}:${pad2(slotMinute)}`;
        break;
      }
      case 'daily':
        slotKey = ymdOf(now);
        break;
      case 'weekly': {
        const iso = isoWeekOf(now);
        slotKey = `${iso.year}-W${pad2(iso.week)}`;
        break;
      }
      case 'monthly':
        slotKey = `${now.year}-${pad2(now.month + 1)}`;
        break;
    }
    const target = targetFor(kind, slotKey);
    target.fileName = target.fileName.replace(/\.jsonl\.gz$/, '_manual.jsonl.gz');
    return this.runBackup({ kind, slotKey, target }, true);
  }

  private async loadState(): Promise<void> {
    if (this.stateLoaded || !this.store?.configured) return;
    try {
      this.state = (await this.store.getSetting<BackupScheduleState>(STATE_KEY)) || {};
    } catch (err: any) {
      console.warn('[backup-drive] Không đọc được mốc backup:', err?.message || err);
      this.state = {};
    }
    this.stateLoaded = true;
  }

  private async tick(): Promise<void> {
    if (!this.started || this.ticking || !this.isEnabled()) return;
    this.ticking = true;
    try {
      const now = Date.now();
      const due = resolveDueBackups(this.state, now, this.cfg)
        .filter(d => (this.state.retry_after?.[d.kind] || 0) <= now);
      if (due.length > 0) await this.runBackup(due[0]);
    } catch (err: any) {
      console.warn('[backup-drive] tick error:', err?.message || err);
    } finally {
      this.ticking = false;
    }
  }

  private async runBackup(due: DueBackup, manual = false): Promise<BackupRunResult> {
    const startedAt = Date.now();
    const at = new Date().toISOString();
    const result: BackupRunResult = {
      kind: due.kind,
      ok: false,
      slotKey: due.slotKey,
      at,
      file: due.target.fileName,
      sizeKb: 0,
      rows: 0,
      counts: {},
      sha256: '',
      driveFileId: null,
      driveUrl: null,
      localPath: null,
      error: null,
      durationMs: 0,
    };

    try {
      const exclude = due.kind === 'hourly' ? this.cfg.hourlyExcludeTables : [];
      const data: BackupExportResult = await this.store!.exportBackupJsonl({ excludeTables: exclude });
      const gz = zlib.gzipSync(Buffer.from(data.jsonl, 'utf8'), { level: 6 });
      result.counts = data.counts;
      result.rows = data.total;
      result.sizeKb = Math.round((gz.length / 1024) * 10) / 10;
      result.sha256 = crypto.createHash('sha256').update(gz).digest('hex');
      result.localPath = this.writeLocal(due, gz);

      if (this.drive?.isConfigured()) {
        try {
          const ref = await this.drive.uploadBuffer(
            due.target.fileName,
            'application/gzip',
            gz,
            due.target.segments,
            due.target.rootId,
            { upsert: true, appProperties: { backup_kind: due.kind, checksum: result.sha256, created_at: at } },
          );
          result.driveFileId = ref.fileId;
          result.driveUrl = ref.viewUrl;
        } catch (err: any) {
          result.error = `DRIVE_UPLOAD_FAILED: ${err?.message || err}`;
        }
      } else {
        result.error = 'DRIVE_NOT_CONFIGURED';
      }

      result.ok = !!result.driveFileId && !result.error;
    } catch (err: any) {
      result.error = err?.message || String(err);
    }

    result.durationMs = Date.now() - startedAt;

    // Dọn bản cũ (best-effort, không làm hỏng kết quả backup).
    try { this.cleanupLocal(due.kind); } catch { /* best-effort */ }
    try { await this.cleanupDrive(due.kind); } catch (err: any) {
      console.warn(`[backup-drive] Dọn Drive ${due.kind} lỗi:`, err?.message || err);
    }

    try { await this.persistOutcome(result, manual); } catch (err: any) {
      console.warn('[backup-drive] Không lưu được mốc backup:', err?.message || err);
    }

    if (result.ok) {
      console.log(
        `[backup-drive] ${due.kind}${manual ? ' (chạy tay)' : ''} OK ${result.file}: ${result.sizeKb}KB, ${result.rows} dòng`
        + `${result.driveFileId ? `, Drive ${result.driveFileId}` : ''} (${result.durationMs}ms)`,
      );
    } else {
      console.warn(`[backup-drive] ${due.kind}${manual ? ' (chạy tay)' : ''} LỖI ${result.file}: ${result.error}`);
      // Chạy tay là hành vi chủ động của Admin: trả lỗi ngay trên UI, không spam cảnh báo.
      if (!manual && due.kind !== 'hourly') {
        void notifySystemAlert({
          code: `BACKUP_DRIVE_${due.kind.toUpperCase()}_FAILED`,
          severity: 'URGENT',
          title: `🚨 Backup ${due.kind === 'daily' ? 'ngày' : due.kind === 'weekly' ? 'tuần' : 'tháng'} thất bại`,
          message: `Không sao lưu được dữ liệu PostgreSQL lên Google Drive (${result.error}). Bản local vẫn được giữ tại VPS — kiểm tra Drive/quota rồi chạy lại.`,
          details: { kind: due.kind, file: result.file, localPath: result.localPath, error: result.error },
        });
      }
    }

    return result;
  }

  private async persistOutcome(result: BackupRunResult, manual = false): Promise<void> {
    await this.loadState();
    const st = this.state;
    if (result.ok) {
      // Chạy tay không đánh dấu kỳ đã chạy — lịch thật vẫn phải chạy đúng mốc.
      if (!manual) {
        if (result.kind === 'hourly') st.last_hourly_slot = result.slotKey;
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
      // Drive chưa cấu hình: thử lại thưa (30 phút) để không đốt CPU mỗi 5 phút.
      const delay = result.error === 'DRIVE_NOT_CONFIGURED' ? 30 * 60_000 : this.cfg.retryMs;
      st.retry_after = { ...(st.retry_after || {}), [result.kind]: Date.now() + delay };
    }
    st.last_result = { ...(st.last_result || {}), [result.kind]: result };
    await this.store!.saveSetting(STATE_KEY, st);
  }

  private localRoot(): string {
    return path.resolve(process.env.BACKUP_LOCAL_DIR || path.join(process.cwd(), 'data', 'backups'));
  }

  private localDirFor(due: DueBackup): string {
    return path.join(this.localRoot(), due.kind, ...due.target.segments.map(sanitizeSegment));
  }

  private writeLocal(due: DueBackup, buffer: Buffer): string {
    const dir = this.localDirFor(due);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, sanitizeSegment(due.target.fileName));
    fs.writeFileSync(file, buffer);
    return file;
  }

  private cleanupLocal(kind: BackupKind): void {
    const root = path.join(this.localRoot(), kind);
    if (!fs.existsSync(root)) return;
    const cutoff = Date.now() - retentionMs(kind, this.cfg);
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          try {
            if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
          } catch { /* bỏ qua */ }
        } else {
          try {
            if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
          } catch { /* bỏ qua */ }
        }
      }
    };
    walk(root);
  }

  private async cleanupDrive(kind: BackupKind): Promise<void> {
    if (!this.drive?.isConfigured()) return;
    const rootId = kind === 'monthly'
      ? DRIVE_SUBFOLDERS.BACKUP_MONTH
      : kind === 'weekly'
        ? DRIVE_SUBFOLDERS.BACKUP_WEEK
        : kind === 'hourly'
          ? DRIVE_SUBFOLDERS.BACKUP_HOUR
          : DRIVE_SUBFOLDERS.BACKUP_DAY;
    const sub = kind === 'hourly' ? 'HOURLY' : kind === 'daily' ? 'DAILY' : kind === 'weekly' ? 'WEEKLY' : 'MONTHLY';
    const folderId = await this.drive.ensureFolder(sub, rootId);
    const removed = await this.drive.pruneKeepNewest(folderId, keepFolders(kind, this.cfg));
    if (removed > 0) console.log(`[backup-drive] Đã dọn ${removed} thư mục ${kind} cũ trên Drive.`);
  }
}

let singleton: DriveBackupScheduler | null = null;

export function getDriveBackupScheduler(adapter: any): DriveBackupScheduler {
  if (!singleton) singleton = new DriveBackupScheduler(adapter);
  return singleton;
}

export function resetDriveBackupSchedulerForTests(): void {
  singleton?.stop();
  singleton = null;
}
