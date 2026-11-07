import { Worker } from 'bullmq';
import { getBullConnection, isRedisConfigured } from '../config/redis.js';
import { SHEETS_SYNC_QUEUE, DRIVE_SYNC_QUEUE, type SheetsSyncJob, type DriveSyncJob } from '../queue/queue.js';

/**
 * Worker đồng bộ Postgres -> Google Sheet/Drive (P1).
 *
 * - Offline flow trong tài liệu: mỗi mutation ghi Postgres TRƯỚC, sau đó
 *   enqueue ra Redis. Worker (BullMQ) batch update lên Sheet/Drive và chỉ
 *   đánh dấu outbox SYNCED khi Google API thành công.
 * - Fallback: khi Redis chưa cấu hình, server.ts sẽ gọi `runOutboxPollOnce`
 *   theo nhịp setInterval (xem services/sheets-export.service.ts).
 * - Worker này CHỈ chạy khi Redis có. Error sẽ retry theo BullMQ backoff, sau
 *   5 lần sẽ báo FAILED và giữ payload để đối soát tay (không ghi đè dữ liệu
 *   Postgres bằng Sheet cũ).
 */
export interface OutboxWorkerDeps {
  adapter: any;
  logger?: (msg: string) => void;
  onSyncOne?: (job: SheetsSyncJob) => Promise<{ ok: boolean; sheetRow?: number; error?: string }>;
  onDriveOne?: (job: DriveSyncJob) => Promise<{ ok: boolean; driveUrl?: string; error?: string }>;
}

export function startOutboxWorkers(deps: OutboxWorkerDeps): { stop: () => Promise<void> } | null {
  if (!isRedisConfigured()) return null;
  const log = deps.logger || console.log;

  const sheetsConn = getBullConnection();
  const driveConn = getBullConnection();
  if (!sheetsConn || !driveConn) return null;

  const sheetsWorker = new Worker<SheetsSyncJob>(
    SHEETS_SYNC_QUEUE,
    async (job) => {
      const data = job.data;
      if (!data) return;
      try {
        if (deps.onSyncOne) {
          const r = await deps.onSyncOne(data);
          if (!r.ok) throw new Error(r.error || 'SHEETS_SYNC_FAILED');
        } else {
          log(`[worker:sheets] skip (no handler) ${data.tableName}:${data.recordId}`);
        }
      } catch (e: any) {
        log(`[worker:sheets] failed ${data.tableName}:${data.recordId}: ${e?.message || e}`);
        throw e; // BullMQ retry
      }
    },
    { connection: sheetsConn as any, concurrency: 1 },
  );

  const driveWorker = new Worker<DriveSyncJob>(
    DRIVE_SYNC_QUEUE,
    async (job) => {
      const data = job.data;
      if (!data) return;
      try {
        if (deps.onDriveOne) {
          const r = await deps.onDriveOne(data);
          if (!r.ok) throw new Error(r.error || 'DRIVE_SYNC_FAILED');
        } else {
          log(`[worker:drive] skip (no handler) ${data.tableName}:${data.recordId}`);
        }
      } catch (e: any) {
        log(`[worker:drive] failed ${data.tableName}:${data.recordId}: ${e?.message || e}`);
        throw e;
      }
    },
    { connection: driveConn as any, concurrency: 2 },
  );

  sheetsWorker.on('failed', (j, err) => log(`[worker:sheets] job failed ${j?.id}: ${err?.message}`));
  driveWorker.on('failed', (j, err) => log(`[worker:drive] job failed ${j?.id}: ${err?.message}`));

  return {
    stop: async () => {
      try { await sheetsWorker.close(); } catch { /* ignore */ }
      try { await driveWorker.close(); } catch { /* ignore */ }
      try { await sheetsConn.disconnect(); } catch { /* ignore */ }
      try { await driveConn.disconnect(); } catch { /* ignore */ }
    },
  };
}
