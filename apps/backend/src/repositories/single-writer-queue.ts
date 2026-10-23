import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { OperationRecord, OperationState } from '@ubm/shared';
import { ISheetsRepository } from './sheets.interface.js';

export interface QueuedTask<T> {
  operationId: string;
  idempotencyKey?: string;
  entityType: string;
  entityId: string;
  expectedVersion?: number;
  actorId: string;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
  attempts: number;
  nextAttemptAt: number;
}

export interface QueueDeadLetter {
  operationId: string;
  idempotencyKey?: string;
  entityType: string;
  entityId: string;
  actorId: string;
  error: string;
  failedAt: string;
  attempts: number;
}

interface QueueJournalEntry {
  operationId: string;
  idempotencyKey?: string;
  entityType: string;
  entityId: string;
  actorId: string;
  state: 'PENDING' | 'RUNNING';
  enqueuedAt: string;
  attempts: number;
}

interface QueueJournalFile {
  version: 1;
  updatedAt: string;
  pending: QueueJournalEntry[];
  deadLetters: QueueDeadLetter[];
}

export interface SingleWriterQueueOptions {
  journalPath?: string;
  maxRetries?: number;
  retryBaseMs?: number;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

/**
 * Cổng ghi tuần tự (single-writer). Ngoài việc serialize execute, queue giữ
 * journal metadata trên đĩa + dead-letter:
 *
 * - Task đang chờ/đang chạy được ghi xuống `single-writer-journal.json`.
 * - Restart: closure không thể serialize nên task dở dang được chuyển sang
 *   dead-letter `ORPHANED_ON_RESTART` để đối soát (dữ liệu nghiệp vụ đã có
 *   snapshot + durable append journal bảo hiểm).
 * - Lỗi timeout/quota/5xx có idempotencyKey được retry vài lần; lỗi nghiệp vụ
 *   thì dead-letter ngay, không giấu lỗi.
 */
export class SingleWriterQueue {
  private queue: QueuedTask<any>[] = [];
  private isProcessing = false;
  private repository: ISheetsRepository | null = null;
  private readonly journalPath: string;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;
  private journalPending: QueueJournalEntry[] = [];
  private deadLetters: QueueDeadLetter[] = [];
  private persistChain: Promise<void> = Promise.resolve();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: SingleWriterQueueOptions = {}) {
    this.journalPath = opts.journalPath
      || process.env.SINGLE_WRITER_JOURNAL_FILE?.trim()
      || path.resolve(process.cwd(), 'data/single-writer-journal.json');
    this.maxRetries = Math.max(0, opts.maxRetries ?? 2);
    this.retryBaseMs = Math.max(1, opts.retryBaseMs ?? 1000);
    this.logger = opts.logger || console;
    this.loadJournal();
  }

  public setRepository(repo: ISheetsRepository) {
    this.repository = repo;
  }

  /** Số job đang chờ trong hàng đợi (đo thật cho dashboard giám sát). */
  public getPendingCount(): number {
    return this.queue.length + (this.isProcessing ? 1 : 0);
  }

  public getDeadLetters(limit = 50): QueueDeadLetter[] {
    return this.deadLetters.slice(-Math.max(1, Math.min(500, limit)));
  }

  public getDurabilityStatus() {
    return {
      pending: this.queue.length,
      processing: this.isProcessing,
      deadLetters: this.deadLetters.length,
      journalPath: this.journalPath,
    };
  }

  private loadJournal(): void {
    try {
      if (!fs.existsSync(this.journalPath)) return;
      const raw = fs.readFileSync(this.journalPath, 'utf8');
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw) as QueueJournalFile;
      if (!parsed || parsed.version !== 1) return;
      this.deadLetters = Array.isArray(parsed.deadLetters) ? parsed.deadLetters : [];
      const leftovers = (Array.isArray(parsed.pending) ? parsed.pending : [])
        .filter(e => e && typeof e.operationId === 'string');
      if (leftovers.length) {
        const now = new Date().toISOString();
        for (const entry of leftovers) {
          this.deadLetters.push({
            operationId: entry.operationId,
            idempotencyKey: entry.idempotencyKey,
            entityType: entry.entityType,
            entityId: entry.entityId,
            actorId: entry.actorId,
            error: 'ORPHANED_ON_RESTART',
            failedAt: now,
            attempts: Number(entry.attempts) || 0,
          });
        }
        this.logger.warn(`[single-writer] ${leftovers.length} task dở dang sau restart đã chuyển dead-letter để đối soát.`);
        void this.persistJournal();
      }
      if (this.deadLetters.length) {
        this.logger.warn(`[single-writer] Có ${this.deadLetters.length} dead-letter trong journal.`);
      }
    } catch (err: any) {
      this.logger.warn('[single-writer] Không đọc được journal:', err?.message || err);
    }
  }

  private payload(): QueueJournalFile {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      pending: this.journalPending,
      deadLetters: this.deadLetters,
    };
  }

  private persistJournal(): Promise<void> {
    const run = this.persistChain.then(async () => {
      const payload = JSON.stringify(this.payload());
      await fs.promises.mkdir(path.dirname(this.journalPath), { recursive: true });
      const tmp = `${this.journalPath}.${process.pid}.${Date.now()}.tmp`;
      await fs.promises.writeFile(tmp, payload, { encoding: 'utf8', mode: 0o600 });
      try {
        await fs.promises.rename(tmp, this.journalPath);
      } catch {
        await fs.promises.rm(this.journalPath, { force: true }).catch(() => undefined);
        await fs.promises.rename(tmp, this.journalPath);
      }
      await fs.promises.chmod(this.journalPath, 0o600).catch(() => undefined);
    }).catch((err: any) => {
      this.logger.warn('[single-writer] Ghi journal lỗi:', err?.message || err);
    });
    this.persistChain = run.catch(() => undefined);
    return run;
  }

  private isTransient(error: any): boolean {
    const msg = String(error?.message || error || '');
    return /SHEETS_TIMEOUT|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|timeout|timed out|rate limit|quota|429|500|502|503|504/i.test(msg);
  }

  public async enqueue<T>(options: {
    idempotencyKey?: string;
    entityType: string;
    entityId: string;
    expectedVersion?: number;
    actorId: string;
    execute: () => Promise<T>;
  }): Promise<{ operationId: string; result: T }> {
    const operationId = uuidv4();

    // Check idempotency if key provided and repository is available
    if (options.idempotencyKey && this.repository) {
      const existingOp = await this.repository.findOperationByIdempotencyKey(options.idempotencyKey);
      if (existingOp) {
        if (existingOp.operation_state === 'COMPLETED' && existingOp.outcome) {
          try {
            const cachedResult = JSON.parse(existingOp.outcome);
            return { operationId: existingOp.operation_id, result: cachedResult as T };
          } catch (e) {
            // fallback to re-evaluating if json parse fails
          }
        } else if (existingOp.operation_state === 'IN_PROGRESS' || existingOp.operation_state === 'PENDING') {
          throw new Error('OPERATION_IN_PROGRESS');
        } else if (existingOp.operation_state === 'NEEDS_RECONCILIATION') {
          throw new Error('NEEDS_RECONCILIATION');
        }
      }
    }

    const journalEntry: QueueJournalEntry = {
      operationId,
      idempotencyKey: options.idempotencyKey,
      entityType: options.entityType,
      entityId: options.entityId,
      actorId: options.actorId,
      state: 'PENDING',
      enqueuedAt: new Date().toISOString(),
      attempts: 0,
    };
    this.journalPending.push(journalEntry);
    await this.persistJournal();

    return new Promise<{ operationId: string; result: T }>((resolve, reject) => {
      this.queue.push({
        operationId,
        idempotencyKey: options.idempotencyKey,
        entityType: options.entityType,
        entityId: options.entityId,
        expectedVersion: options.expectedVersion,
        actorId: options.actorId,
        execute: options.execute,
        resolve: (val: T) => resolve({ operationId, result: val }),
        reject,
        attempts: 0,
        nextAttemptAt: 0,
      });

      void this.processQueue();
    });
  }

  private nextDueTask(now: number): QueuedTask<any> | undefined {
    return this.queue
      .filter(t => (t.nextAttemptAt || 0) <= now)
      .sort((a, b) => (a.nextAttemptAt || 0) - (b.nextAttemptAt || 0))[0];
  }

  private scheduleRetryWakeup(): void {
    if (this.retryTimer || this.queue.length === 0) return;
    const next = Math.min(...this.queue.map(t => t.nextAttemptAt || 0));
    const wait = Math.max(10, next - Date.now());
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.processQueue();
    }, wait);
    (this.retryTimer as any)?.unref?.();
  }

  private updateJournal(operationId: string, patch: Partial<QueueJournalEntry>): void {
    const entry = this.journalPending.find(e => e.operationId === operationId);
    if (entry) Object.assign(entry, patch);
  }

  private removeJournal(operationId: string): void {
    this.journalPending = this.journalPending.filter(e => e.operationId !== operationId);
  }

  private pushDeadLetter(task: QueuedTask<any>, error: any): void {
    this.deadLetters.push({
      operationId: task.operationId,
      idempotencyKey: task.idempotencyKey,
      entityType: task.entityType,
      entityId: task.entityId,
      actorId: task.actorId,
      error: String(error?.message || error || 'UNKNOWN_ERROR'),
      failedAt: new Date().toISOString(),
      attempts: task.attempts,
    });
    if (this.deadLetters.length > 500) this.deadLetters = this.deadLetters.slice(-500);
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    const task = this.nextDueTask(Date.now());
    if (!task) {
      this.scheduleRetryWakeup();
      return;
    }

    this.isProcessing = true;
    this.queue = this.queue.filter(t => t.operationId !== task.operationId);
    this.updateJournal(task.operationId, { state: 'RUNNING' });
    void this.persistJournal();

    try {
      if (this.repository && task.idempotencyKey && task.attempts === 0) {
        await this.repository.recordOperation({
          operation_id: task.operationId,
          idempotency_key: task.idempotencyKey,
          entity_type: task.entityType,
          entity_id: task.entityId,
          expected_version: task.expectedVersion ?? 1,
          operation_state: 'IN_PROGRESS',
          actor_id: task.actorId,
        });
      }

      const result = await task.execute();

      if (this.repository && task.idempotencyKey) {
        try {
          await this.repository.updateOperation(task.operationId, {
            operation_state: 'COMPLETED',
            outcome: JSON.stringify(result),
          });
        } catch (err: any) {
          this.logger.warn('[single-writer] Không cập nhật được operation COMPLETED:', err?.message || err);
        }
      }

      this.removeJournal(task.operationId);
      await this.persistJournal();
      task.resolve(result);
    } catch (error: any) {
      task.attempts += 1;
      const canRetry = !!task.idempotencyKey
        && task.attempts <= this.maxRetries
        && this.isTransient(error);

      if (canRetry) {
        const delay = this.retryBaseMs * Math.pow(2, task.attempts - 1)
          + Math.floor(Math.random() * 250);
        task.nextAttemptAt = Date.now() + delay;
        this.queue.push(task);
        this.updateJournal(task.operationId, { state: 'PENDING', attempts: task.attempts });
        await this.persistJournal();
        this.logger.warn(
          `[single-writer] ${task.entityType}/${task.entityId} lỗi tạm thời (${error?.message || error}) — thử lại lần ${task.attempts}/${this.maxRetries} sau ${delay}ms`,
        );
        this.scheduleRetryWakeup();
        return;
      }

      if (this.repository && task.idempotencyKey) {
        // If error is partial or sheet failed, mark as NEEDS_RECONCILIATION if multi-step, or FAILED
        const isReconcile = error.message?.includes('RECONCILE') || error.message?.includes('PARTIAL');
        try {
          await this.repository.updateOperation(task.operationId, {
            operation_state: isReconcile ? 'NEEDS_RECONCILIATION' : 'FAILED',
            error: error.message || 'UNKNOWN_ERROR',
          });
        } catch (err: any) {
          this.logger.warn('[single-writer] Không cập nhật được operation FAILED:', err?.message || err);
        }
      }

      this.removeJournal(task.operationId);
      this.pushDeadLetter(task, error);
      await this.persistJournal();
      task.reject(error);
    } finally {
      this.isProcessing = false;
      // Còn task đến hạn (hoặc vừa enqueue trong lúc chạy) -> chạy tiếp.
      if (this.queue.some(t => (t.nextAttemptAt || 0) <= Date.now())) {
        void this.processQueue();
      } else {
        this.scheduleRetryWakeup();
      }
    }
  }
}

export const singleWriterQueue = new SingleWriterQueue();
