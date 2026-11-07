import { Queue, QueueEvents } from 'bullmq';
import { getBullConnection, isRedisConfigured } from '../config/redis.js';

/**
 * Hàng đợi BullMQ cho đồng bộ nền PostgreSQL -> Google Sheet/Drive.
 *
 * Thiết kế theo VPS_DataBase_Sheet.md Prompt 2:
 * - API chỉ ghi Postgres (nhanh). Mọi đẩy lên Sheet/Drive đều qua Queue.
 * - Nếu Redis chưa cấu hình: queue là no-op, Worker chạy theo nhịp poll DB
 *   (fallback) nên deploy VPS chưa có Redis vẫn hoạt động.
 */
export const SHEETS_SYNC_QUEUE = 'sheets-sync';
export const DRIVE_SYNC_QUEUE = 'drive-sync';

export interface SheetsSyncJob {
  tableName: string;
  recordId: string;
  op: 'upsert' | 'delete';
  outboxId?: string;
  at: string;
}

export interface DriveSyncJob {
  localPath?: string;
  driveObjectId?: string;
  targetFolder?: string;
  recordId: string;
  tableName: string;
  at: string;
}

let sheetsQueue: Queue<SheetsSyncJob> | null = null;
let driveQueue: Queue<DriveSyncJob> | null = null;
let sheetsEvents: QueueEvents | null = null;

function getQueue<T>(name: string, existing: Queue<T> | null): Queue<T> | null {
  if (!isRedisConfigured()) return null;
  if (existing) return existing;
  const conn = getBullConnection();
  if (!conn) return null;
  return new Queue<T>(name, { connection: conn as any });
}

export function getSheetsSyncQueue(): Queue<SheetsSyncJob> | null {
  if (!sheetsQueue) sheetsQueue = getQueue<SheetsSyncJob>(SHEETS_SYNC_QUEUE, null);
  return sheetsQueue;
}

export function getDriveSyncQueue(): Queue<DriveSyncJob> | null {
  if (!driveQueue) driveQueue = getQueue<DriveSyncJob>(DRIVE_SYNC_QUEUE, null);
  return driveQueue;
}

export async function enqueueSheetsSync(job: SheetsSyncJob): Promise<{ queued: boolean; jobId?: string }> {
  const q = getSheetsSyncQueue();
  if (!q) return { queued: false };
  const added = await q.add('sync-one', job, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
  return { queued: true, jobId: String(added.id) };
}

export async function enqueueDriveSync(job: DriveSyncJob): Promise<{ queued: boolean; jobId?: string }> {
  const q = getDriveSyncQueue();
  if (!q) return { queued: false };
  const added = await q.add('sync-file', job, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
  return { queued: true, jobId: String(added.id) };
}

export async function getQueueStats() {
  const sq = getSheetsSyncQueue();
  const dq = getDriveSyncQueue();
  const [sheets, drive] = await Promise.all([
    sq ? sq.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed') : null,
    dq ? dq.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed') : null,
  ]);
  return {
    redisConfigured: isRedisConfigured(),
    sheetsSync: sheets,
    driveSync: drive,
  };
}

export async function closeQueues() {
  try { await sheetsQueue?.close(); } catch { /* ignore */ }
  try { await driveQueue?.close(); } catch { /* ignore */ }
  try { await sheetsEvents?.close(); } catch { /* ignore */ }
  sheetsQueue = null;
  driveQueue = null;
  sheetsEvents = null;
}
