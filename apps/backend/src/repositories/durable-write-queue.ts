import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * Hàng đợi ghi Google Sheets bền vững (append-only).
 *
 * - Mỗi lần append được ghi xuống đĩa TRƯỚC khi gọi Google API.
 * - Lỗi timeout/quota/5xx: retry exponential backoff + jitter.
 * - Quá số lần: chuyển dead-letter (không mất dấu), có thể replay từ admin.
 * - Restart: nạp lại file, tiếp tục gửi những dòng chưa lên Sheet.
 *
 * Dữ liệu nghiệp vụ vẫn nằm trong snapshot runtime; hàng đợi này bảo đảm
 * phần "đã thao tác thành công nhưng Sheet chưa nhận" không bị mất.
 */
export interface DurableWriteEntry {
  id: string;
  sheetTitle: string;
  rows: any[][];
  createdAt: string;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  deadLetteredAt?: string;
}

export interface DurableWriteStats {
  pending: number;
  deadLetters: number;
  processing: boolean;
  filePath: string;
  oldestPendingAt: string | null;
  lastError: string | null;
  lastSuccessAt: string | null;
  maxAttempts: number;
}

export interface DurableWriteQueueOptions {
  append: (sheetTitle: string, rows: any[][]) => Promise<boolean>;
  filePath?: string;
  intervalMs?: number;
  maxAttempts?: number;
  /** Cơ sở backoff (mặc định 5s; test truyền nhỏ để chạy nhanh). */
  retryBaseMs?: number;
  now?: () => number;
  onDeadLetter?: (entry: DurableWriteEntry) => void;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

interface JournalFile {
  version: 1;
  updatedAt: string;
  pending: DurableWriteEntry[];
  deadLetters: DurableWriteEntry[];
}

export class DurableWriteQueue {
  private readonly append: DurableWriteQueueOptions['append'];
  private readonly filePath: string;
  private readonly intervalMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly now: () => number;
  private readonly onDeadLetter?: DurableWriteQueueOptions['onDeadLetter'];
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;

  private pending: DurableWriteEntry[] = [];
  private deadLetters: DurableWriteEntry[] = [];
  private processing = false;
  private started = false;
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private persistChain: Promise<void> = Promise.resolve();
  private lastError: string | null = null;
  private lastSuccessAt: string | null = null;

  constructor(opts: DurableWriteQueueOptions) {
    this.append = opts.append;
    this.filePath = opts.filePath || path.resolve(process.cwd(), 'data/pending-writes.json');
    this.intervalMs = Math.max(1_000, opts.intervalMs ?? 10_000);
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 12);
    this.retryBaseMs = Math.max(25, opts.retryBaseMs ?? 5_000);
    this.now = opts.now || (() => Date.now());
    this.onDeadLetter = opts.onDeadLetter;
    this.logger = opts.logger || console;
    this.loadSync();
  }

  private loadSync(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, 'utf8');
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw) as JournalFile;
      if (!parsed || parsed.version !== 1) return;
      this.pending = (Array.isArray(parsed.pending) ? parsed.pending : []).filter(this.isValidEntry);
      this.deadLetters = (Array.isArray(parsed.deadLetters) ? parsed.deadLetters : []).filter(this.isValidEntry);
      if (this.pending.length) {
        this.logger.warn(`[durable-writes] Nạp ${this.pending.length} lượt ghi chưa lên Sheets từ ${this.filePath}`);
      }
      if (this.deadLetters.length) {
        this.logger.warn(`[durable-writes] Có ${this.deadLetters.length} dead-letter cần kiểm tra.`);
      }
    } catch (err: any) {
      this.logger.warn('[durable-writes] Không đọc được journal:', err?.message || err);
    }
  }

  private isValidEntry(entry: any): entry is DurableWriteEntry {
    return !!entry
      && typeof entry.id === 'string'
      && typeof entry.sheetTitle === 'string'
      && Array.isArray(entry.rows)
      && entry.rows.length > 0;
  }

  private payload(): JournalFile {
    return {
      version: 1,
      updatedAt: new Date(this.now()).toISOString(),
      pending: this.pending,
      deadLetters: this.deadLetters,
    };
  }

  /** Ghi journal atomic. Các lần ghi được xếp chuỗi để không đè nhau. */
  private persist(): Promise<void> {
    const run = this.persistChain.then(async () => {
      const payload = JSON.stringify(this.payload());
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.promises.writeFile(tmp, payload, { encoding: 'utf8', mode: 0o600 });
      try {
        await fs.promises.rename(tmp, this.filePath);
      } catch {
        await fs.promises.rm(this.filePath, { force: true }).catch(() => undefined);
        await fs.promises.rename(tmp, this.filePath);
      }
      await fs.promises.chmod(this.filePath, 0o600).catch(() => undefined);
    }).catch((err: any) => {
      this.lastError = `PERSIST_FAILED: ${err?.message || err}`;
      this.logger.warn('[durable-writes] Ghi journal lỗi:', err?.message || err);
    });
    this.persistChain = run.catch(() => undefined);
    return run;
  }

  /**
   * Đưa 1 lượt append vào journal. Await hàm này để bảo đảm dòng đã xuống đĩa
   * trước khi trả response cho người dùng (điểm danh/thông báo quan trọng).
   */
  public async enqueue(sheetTitle: string, rows: any[][]): Promise<string> {
    const entry: DurableWriteEntry = {
      id: uuidv4(),
      sheetTitle,
      // Chuẩn hoá undefined/null -> '' để JSON journal không biến thành null và
      // Google Sheets values.append không từ chối sau khi restart.
      rows: rows.map(r => (Array.isArray(r) ? r : [r]).map(v => (v === undefined || v === null ? '' : v))),
      createdAt: new Date(this.now()).toISOString(),
      attempts: 0,
      nextAttemptAt: 0,
    };
    this.pending.push(entry);
    await this.persist();
    this.kick();
    return entry.id;
  }

  /** Bắt đầu timer nền; gọi 1 lần sau khi server khởi động. */
  public start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.timer = setInterval(() => this.kick(), this.intervalMs);
    (this.timer as any)?.unref?.();
    this.kick();
  }

  public stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private backoffMs(attempts: number): number {
    const base = Math.min(5 * 60_000, this.retryBaseMs * Math.pow(2, Math.max(0, attempts - 1)));
    // Jitter 0-20% để nhiều dòng lỗi không retry cùng lúc.
    return base + Math.floor(Math.random() * Math.max(1, Math.floor(base * 0.2)));
  }

  private kick(): void {
    if (this.stopped || this.processing) return;
    void this.processLoop();
  }

  private async processLoop(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (!this.stopped) {
        const now = this.now();
        const entry = this.pending
          .filter(e => (e.nextAttemptAt || 0) <= now)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
        if (!entry) return;

        let ok = false;
        let error: string | null = null;
        try {
          ok = await this.append(entry.sheetTitle, entry.rows);
          if (!ok) error = `APPEND_FAILED:${entry.sheetTitle}`;
        } catch (err: any) {
          error = `${entry.sheetTitle}: ${err?.message || err}`;
        }

        if (ok) {
          this.pending = this.pending.filter(e => e.id !== entry.id);
          this.lastSuccessAt = new Date(this.now()).toISOString();
          this.lastError = null;
        } else {
          entry.attempts += 1;
          entry.lastError = error || 'UNKNOWN_ERROR';
          this.lastError = `${entry.sheetTitle}: ${entry.lastError}`;
          if (entry.attempts >= this.maxAttempts) {
            entry.deadLetteredAt = new Date(this.now()).toISOString();
            this.pending = this.pending.filter(e => e.id !== entry.id);
            this.deadLetters.push(entry);
            if (this.deadLetters.length > 500) this.deadLetters = this.deadLetters.slice(-500);
            this.logger.error(`[durable-writes] Dead-letter ${entry.sheetTitle} sau ${entry.attempts} lần: ${entry.lastError}`);
            try { this.onDeadLetter?.(entry); } catch (e: any) {
              this.logger.warn('[durable-writes] onDeadLetter lỗi:', e?.message || e);
            }
          } else {
            entry.nextAttemptAt = this.now() + this.backoffMs(entry.attempts);
            this.logger.warn(
              `[durable-writes] Ghi ${entry.sheetTitle} lỗi lần ${entry.attempts}/${this.maxAttempts}, thử lại sau ${Math.round((entry.nextAttemptAt - this.now()) / 1000)}s: ${entry.lastError}`,
            );
          }
        }
        await this.persist();
      }
    } finally {
      this.processing = false;
      if (this.stopped) return;
      // Có task mới được thêm trong lúc đang xử lý hoặc đang chờ backoff.
      if (this.pending.length) {
        const nextAt = Math.min(...this.pending.map(e => e.nextAttemptAt || 0));
        const wait = Math.max(25, nextAt - this.now());
        const wake = setTimeout(() => this.kick(), wait);
        (wake as any)?.unref?.();
      }
    }
  }

  /** Xả tối đa các task đến hạn (dùng khi SIGTERM hoặc test). */
  public async flush(timeoutMs = 10_000): Promise<void> {
    const done = (async () => {
      if (this.processing) {
        while (this.processing) await new Promise(r => setTimeout(r, 50));
        return;
      }
      await this.processLoop();
    })();
    await Promise.race([
      done.catch(() => undefined),
      new Promise<void>(r => setTimeout(r, Math.max(250, timeoutMs)).unref?.()),
    ]);
    await this.persist();
  }

  /** Chạy 1 lượt ngay, kể cả khi timer chưa start (test/backup). */
  public async processNow(): Promise<void> {
    const wasStopped = this.stopped;
    this.stopped = false;
    try {
      await this.processLoop();
    } finally {
      this.stopped = wasStopped;
      await this.persist();
    }
  }

  public getStats(): DurableWriteStats {
    return {
      pending: this.pending.length,
      deadLetters: this.deadLetters.length,
      processing: this.processing,
      filePath: this.filePath,
      oldestPendingAt: this.pending.length
        ? this.pending.map(e => e.createdAt).sort()[0]
        : null,
      lastError: this.lastError,
      lastSuccessAt: this.lastSuccessAt,
      maxAttempts: this.maxAttempts,
    };
  }

  public getDeadLetters(limit = 50): DurableWriteEntry[] {
    return this.deadLetters.slice(-Math.max(1, Math.min(500, limit)));
  }

  /** Đưa dead-letter trở lại hàng đợi để thử lại (admin thao tác tay). */
  public async retryDeadLetters(): Promise<number> {
    if (!this.deadLetters.length) return 0;
    const count = this.deadLetters.length;
    for (const entry of this.deadLetters) {
      entry.attempts = 0;
      entry.nextAttemptAt = 0;
      delete entry.deadLetteredAt;
      delete entry.lastError;
      this.pending.push(entry);
    }
    this.deadLetters = [];
    await this.persist();
    this.kick();
    return count;
  }
}
