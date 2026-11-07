import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

/**
 * Restore Service — Disaster Recovery Drive/Sheet -> PostgreSQL (P2).
 *
 * 2 nguồn restore:
 * 1) JSONL.gz do PostgresStore.exportBackupJsonl tạo (backup 4 tầng hiện có).
 * 2) .sql.gz do pg_dump tạo (backup-sql.sh). File .sql.gz được áp dụng bằng
 *    `psql` trong transaction — chạy ngoài Node để dùng đúng dump tool.
 *
 * An toàn:
 * - Chỉ ADMIN được gọi (middleware ở app.ts).
 * - Yêu cầu xác nhận `confirm: "RESTORE"` và file phải có header `_ubm_backup`.
 * - Trước restore luôn tự tạo 1 bản backup an toàn (snapshot JSONL) vào
 *   data/backups/pre-restore/.
 * - Restore chỉ TRUNCATE các bảng có trong file (giống PostgresStore).
 */
export interface RestorePreview {
  kind: 'jsonl.gz' | 'sql.gz';
  total: number;
  counts: Record<string, number>;
  createdAt: string | null;
  sha256: string;
}

export class RestoreService {
  constructor(private readonly adapter: any) {}

  private get store(): any {
    return (this.adapter as any)?.store || null;
  }

  public async previewFromBuffer(buf: Buffer, filename: string): Promise<RestorePreview> {
    if (!buf || buf.length === 0) throw new Error('FILE_EMPTY');
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const isSql = filename.endsWith('.sql.gz') || filename.endsWith('.sql');
    if (isSql) return { kind: 'sql.gz', total: 0, counts: {}, createdAt: null, sha256: sha };
    const jsonl = zlib.gunzipSync(buf).toString('utf8');
    const lines = jsonl.split('\n').filter(Boolean);
    const head = JSON.parse(lines[0] || '{}');
    return {
      kind: 'jsonl.gz',
      total: Math.max(0, lines.length - 1),
      counts: head.counts || {},
      createdAt: head.created_at || null,
      sha256: sha,
    };
  }

  /** Lưu bản an toàn trước khi restore (luôn ghi đĩa, không cần Drive). */
  public async snapshotBeforeRestore(): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.resolve(process.cwd(), 'data', 'backups', 'pre-restore');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `pre_restore_${stamp}.jsonl.gz`);
    if (this.store?.configured) {
      const data = await this.store.exportBackupJsonl();
      fs.writeFileSync(file, zlib.gzipSync(Buffer.from(data.jsonl, 'utf8')));
    } else {
      fs.writeFileSync(file, zlib.gzipSync(Buffer.from(JSON.stringify({ note: 'mock mode, no postgres backup' }))));
    }
    return file;
  }

  public async restoreJsonlBuffer(buf: Buffer): Promise<{ counts: any; total: number; snapshot: string }> {
    if (!this.store?.configured) throw new Error('POSTGRES_NOT_CONFIGURED');
    const snapshot = await this.snapshotBeforeRestore();
    const jsonl = zlib.gunzipSync(buf).toString('utf8');
    const res = await this.store.restoreBackupJsonl(jsonl);
    return { counts: res.counts, total: res.total, snapshot };
  }

  /**
   * Delta Sync: Sheet -> DB theo id + updated_at (KHÔNG ghi đè dữ liệu mới hơn).
   * Input là mảng dòng từ Sheet export. Chỉ upsert khi Sheet.updated_at > DB.updated_at.
   */
  public async deltaSyncFromSheetRows(rows: Array<{ tableName: string; id: string; updatedAt: string; data: any }>): Promise<{ inserted: number; updated: number; skipped: number }> {
    if (!this.store?.configured) throw new Error('POSTGRES_NOT_CONFIGURED');
    const { pgQuery } = await import('../config/database.js');
    let inserted = 0, updated = 0, skipped = 0;
    for (const r of rows) {
      if (!r?.id || !r?.tableName) { skipped++; continue; }
      // Chỉ cho phép bảng đã biết
      const allowed = ['employees', 'employee_accounts', 'admin_accounts', 'shift_assignments', 'attendance_events', 'leave_requests', 'swap_requests'];
      if (!allowed.includes(r.tableName)) { skipped++; continue; }
      const cur = await pgQuery(`SELECT updated_at FROM ${r.tableName} WHERE id=$1`, [r.id]).catch(() => null);
      const dbUpdated: number = cur?.rows?.[0]?.updated_at ? Date.parse(cur.rows[0].updated_at) : 0;
      const sheetUpdated: number = Date.parse(r.updatedAt || '');
      if (!cur || !cur.rows.length) {
        await pgQuery(
          `INSERT INTO ${r.tableName} (id, data, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $3) ON CONFLICT (id) DO NOTHING`,
          [r.id, JSON.stringify(r.data || {})],
        );
        inserted++;
      } else if (Number.isFinite(sheetUpdated) && sheetUpdated > dbUpdated) {
        await pgQuery(`UPDATE ${r.tableName} SET data=$2::jsonb, updated_at=$3 WHERE id=$1`, [r.id, JSON.stringify(r.data || {}), r.updatedAt]);
        updated++;
      } else {
        skipped++;
      }
    }
    return { inserted, updated, skipped };
  }
}

export function addRestoreValidators() {
  return {
    note: 'restore routes: POST /admin/backup/restore (jsonl.gz or sql.gz), POST /admin/sync/sheets/delta',
  };
}
