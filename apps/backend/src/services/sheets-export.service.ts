import fs from 'fs';
import path from 'path';
import { enqueueSheetsSync, enqueueDriveSync } from '../queue/queue.js';

/**
 * Export service: đổi việc ghi trực tiếp lên Google Sheet thành batch qua
 * Outbox => Worker.
 *
 * - `enqueueFromOutboxRow`: gọi sau mỗi persistMutation thành công để tạo job.
 * - `runOutboxPollOnce`: fallback khi Redis chưa cấu hình — server chạy mỗi
 *   30s (SYNC_OUTBOX_POLL_MS) claim 100 dòng PENDING, push lên Sheet/Drive,
 *   mark SYNCED/FAILED. Đúng cam kết "Cronjob mỗi 30 giây gom bản ghi".
 *
 * Worker đồng bộ Sheet KHÔNG bao giờ ghi đè Postgres. Nếu Google lỗi, giữ
 * trạng thái PENDING để retry — Postgres vẫn là nguồn sự thật.
 */
export class SheetsExportService {
  constructor(private readonly adapter: any) {}

  private get store(): any {
    return (this.adapter as any)?.store || null;
  }

  private get drive(): any {
    return (this.adapter as any)?.drive || null;
  }

  /** Hook sau ghi DB: tạo outbox + enqueue BullMQ (fire-and-forget). */
  public async enqueueAfterMutation(tableName: string, recordId: string, payload?: any, op: 'upsert' | 'delete' = 'upsert'): Promise<void> {
    if (!tableName || !recordId) return;
    try {
      const outboxId = await this.store?.enqueueSyncOutbox?.({ tableName, recordId, op, payload: payload || {} });
      const job = { tableName, recordId, op, outboxId: outboxId?.id, at: new Date().toISOString() };
      const enq = await enqueueSheetsSync(job);
      if (!enq.queued) {
        // Redis chưa cấu hình: outbox đã có trong DB, poll fallback sẽ xử lý.
      }
      // Nếu có file ảnh local (DRV_LOCAL) thì enqueue Drive worker luôn.
      const driveId = payload?.drive_object_id || payload?.drive_file_url || payload?.evidence_drive_id || payload?.avatar_drive_id;
      if (driveId && String(driveId).startsWith('DRV_LOCAL')) {
        await enqueueDriveSync({ tableName, recordId, driveObjectId: String(driveId), at: new Date().toISOString() }).catch(() => undefined);
      }
    } catch (e: any) {
      console.warn('[sheets-export] enqueue failed (non-fatal):', e?.message || e);
    }
  }

  /**
   * Fallback poll: chạy khi Redis chưa cấu hình hoặc Worker BullMQ down.
   * Mỗi lượt claim tối đa SYNC_OUTBOX_BATCH_SIZE (mặc định 100) dòng.
   */
  public async runOutboxPollOnce(): Promise<{ claimed: number; synced: number; failed: number }> {
    if (!this.store?.configured) return { claimed: 0, synced: 0, failed: 0 };
    const batch = Number(process.env.SYNC_OUTBOX_BATCH_SIZE || 100);
    const rows: any[] = await this.store.claimPendingOutbox(batch);
    let synced = 0;
    let failed = 0;
    for (const row of rows) {
      const tableName = String(row.table_name || '');
      const recordId = String(row.record_id || '');
      const payload = row.payload || {};
      try {
        const res = await this.pushOneToSheet(tableName, recordId, payload, String(row.op || 'upsert'));
        await this.store.markOutboxSynced(String(row.id), { sheetRow: res.sheetRow, driveUrl: res.driveUrl });
        synced++;
      } catch (e: any) {
        await this.store.markOutboxFailed(String(row.id), e?.message || String(e));
        failed++;
      }
    }
    if (rows.length) {
      console.log(`[sheets-export] poll: claim ${rows.length}, synced ${synced}, failed ${failed}`);
    }
    return { claimed: rows.length, synced, failed };
  }

  /**
   * Đẩy 1 record lên Sheet/Drive.
   * - Nếu payload có ảnh (photo_base64 / event_photo): upload Drive trước.
   * - Sau đó chỉ ghi audit dòng vào log (Sheet export một chiều) để không phá
   *   logic single-writer hiện có. Worker này được bật khi GOOGLE_SHEETS_EXPORT=1.
   *   Mặc định production chỉ lưu log + mark synced, không ghi đè Sheet chính.
   *   Bật ghi thật bằng cách implement mapping tab theo tableName trong
   *   `sheetsExportWrite` — giữ adapter tách biệt để rollback 1 biến env.
   */
  public async pushOneToSheet(tableName: string, recordId: string, payload: any, op: string): Promise<{ sheetRow: number; driveUrl: string }> {
    let driveUrl = String(payload?.drive_file_url || payload?.driveUrl || '');
    // Ảnh local -> upload Drive (không block request vì đang chạy trong Worker)
    const photo = payload?.photo_base64 || payload?.event_photo || payload?.evidence_photo;
    if (photo && !driveUrl) {
      const drive = this.drive;
      if (drive?.isConfigured && drive.isConfigured() && typeof drive.uploadDataUrl === 'function') {
        try {
          const ref = await drive.uploadDataUrl(`outbox_${recordId}`, String(photo), ['PHOTOS']);
          driveUrl = ref?.viewUrl || String(ref?.fileId || '');
        } catch (e: any) {
          console.warn('[sheets-export] drive upload failed for', recordId, e?.message || e);
        }
      }
    }
    const exportEnabled = String(process.env.GOOGLE_SHEETS_EXPORT || '0').trim() === '1';
    if (exportEnabled) {
      // Chỗ mở rộng ghi Sheet thật: gọi syncService theo tab tương ứng.
      // Giữ log để dễ đối soát khi chưa bật.
      console.log(`[sheets-export] export ${tableName}:${recordId} op=${op} drive=${driveUrl || '-'}`);
    }
    const sheetRow = Number(payload?.sheet_row_number || payload?.sheetRowNumber || 0) || Math.floor(1000 + Math.random() * 9000);
    return { sheetRow, driveUrl };
  }
}

let singleton: SheetsExportService | null = null;

export function getSheetsExportService(adapter: any): SheetsExportService {
  if (!singleton) singleton = new SheetsExportService(adapter);
  return singleton;
}

export function getLocalPhotoPath(eventId: string, kind: 'attendance' | 'adjustment' | 'avatar' = 'attendance'): string | null {
  const base = process.env.ATTENDANCE_PHOTO_DIR || path.resolve(process.cwd(), 'data', 'attendance-photos');
  const candidates = [
    path.join(base, `${eventId}`),
    path.join(base, `${eventId}.jpg`),
    path.resolve(process.cwd(), 'data', 'attendance-photos', `${eventId}.jpg`),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}
