/**
 * Archive dữ liệu chấm công cũ khỏi PostgreSQL theo tháng.
 *
 * Mặc định DRY-RUN: chỉ xuất file nén + in thống kê, KHÔNG xóa dữ liệu.
 * Thêm --apply để ghi bảng tổng hợp tháng, manifest và xóa bản ghi gốc.
 *
 * Cách chạy:
 *   cd apps/backend
 *   npm run archive:postgres -- --month=2025-01           # xem trước
 *   npm run archive:postgres -- --month=2025-01 --apply   # thực thi
 *
 * Tùy chọn:
 *   --force            ghi đè archive đã tồn tại cho cùng tháng
 *   --archive-dir=...   thư mục lưu file .jsonl.gz (mặc định data/archives)
 *
 * File xuất: <archive-dir>/attendance_events/<YYYY-MM>.jsonl.gz
 * Bảng tổng hợp: attendance_monthly_summary (bucket_month, employee_id, data jsonb)
 * Manifest: archive_manifests (checksum sha256, row_count, file_url)
 *
 * Sau khi archive, nên copy file lên Google Drive/backup ngoài VPS trước khi
 * xóa bản local nếu cần tiết kiệm dung lượng.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import dotenv from 'dotenv';

const envFile = process.env.ENV_FILE
  || (process.cwd().endsWith(path.join('apps', 'backend'))
    ? path.resolve(process.cwd(), '.env')
    : path.resolve(process.cwd(), 'apps/backend/.env'));
dotenv.config({ path: envFile });
dotenv.config();

import { closePool, isPostgresConfigured, pgQuery, withTransaction } from '../src/config/database.js';

const VN_OFFSET_MS = 7 * 3_600_000;

function argValue(name: string, fallback = ''): string {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function vnDayOf(value: unknown): string {
  const t = Date.parse(String(value || ''));
  if (!Number.isFinite(t)) return '';
  return new Date(t + VN_OFFSET_MS).toISOString().slice(0, 10);
}

function daysInMonth(month: string): { start: string; endExclusive: string } {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return { start, endExclusive: end };
}

function buildSummary(rows: any[], month: string): any[] {
  const byEmp = new Map<string, any>();
  for (const row of rows) {
    const evt = row.data || {};
    const empId = String(evt.employee_id || '');
    if (!empId) continue;
    let agg = byEmp.get(empId);
    if (!agg) {
      agg = {
        employee_id: empId,
        check_in_count: 0,
        check_out_count: 0,
        late_count: 0,
        early_count: 0,
        days: new Set<string>(),
        branches: new Set<string>(),
        first_in: null as string | null,
        last_out: null as string | null,
      };
      byEmp.set(empId, agg);
    }
    const day = vnDayOf(evt.client_time) || vnDayOf(evt.server_received_at) || '';
    if (day) agg.days.add(day);
    if (evt.branch_id) agg.branches.add(String(evt.branch_id));
    const at = String(evt.client_time || evt.server_received_at || '');
    if (evt.type === 'CHECK_IN') {
      agg.check_in_count++;
      if (evt.is_late) agg.late_count++;
      if (at && (!agg.first_in || at < agg.first_in)) agg.first_in = at;
    } else if (evt.type === 'CHECK_OUT') {
      agg.check_out_count++;
      if (evt.is_early) agg.early_count++;
      if (at && (!agg.last_out || at > agg.last_out)) agg.last_out = at;
    }
  }
  return [...byEmp.values()].map(a => ({
    month,
    employee_id: a.employee_id,
    check_in_count: a.check_in_count,
    check_out_count: a.check_out_count,
    late_count: a.late_count,
    early_count: a.early_count,
    days_worked: a.days.size,
    branches: [...a.branches],
    first_in: a.first_in,
    last_out: a.last_out,
  }));
}

async function main() {
  if (!isPostgresConfigured()) {
    console.error('❌ Thiếu DATABASE_URL/PGHOST. Điền kết nối PostgreSQL trong apps/backend/.env.');
    process.exit(1);
  }

  const month = argValue('month');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    console.error('❌ Thiếu/không hợp lệ --month=YYYY-MM');
    process.exit(1);
  }
  const apply = hasFlag('apply');
  const force = hasFlag('force');
  const archiveDir = path.resolve(
    argValue('archive-dir') || process.env.ARCHIVE_DIR || path.join(process.cwd(), 'data', 'archives'),
  );
  const outDir = path.join(archiveDir, 'attendance_events');
  const outFile = path.join(outDir, `${month}.jsonl.gz`);
  const { start, endExclusive } = daysInMonth(month);

  console.log(`\n=== Archive chấm công ${month} (${apply ? 'APPLY' : 'DRY-RUN'}) ===`);

  await pgQuery(`
    CREATE TABLE IF NOT EXISTS attendance_monthly_summary (
      bucket_month date NOT NULL,
      employee_id text NOT NULL,
      data jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (bucket_month, employee_id)
    )
  `);

  const existingManifest = await pgQuery(
    `SELECT id FROM archive_manifests WHERE table_name = $1 AND period_start = $2::date`,
    ['attendance_events', start],
  );
  if (existingManifest.rowCount && !force) {
    console.log(`⚠️  Đã có manifest archive cho ${month}. Dùng --force để chạy lại/ghi đè.`);
    await closePool();
    return;
  }

  const res = await pgQuery<{ id: string; data: any }>(
    `SELECT id, data FROM attendance_events WHERE bucket_month = $1::date ORDER BY created_at ASC, id ASC`,
    [start],
  );
  const rows = res.rows;
  if (!rows.length) {
    console.log(`Không có sự kiện chấm công nào trong ${month} — không cần archive.`);
    await closePool();
    return;
  }

  const summary = buildSummary(rows, month);
  fs.mkdirSync(outDir, { recursive: true });
  const jsonl = rows.map(r => JSON.stringify(r.data)).join('\n');
  const gz = zlib.gzipSync(Buffer.from(jsonl, 'utf8'), { level: 9 });
  fs.writeFileSync(outFile, gz);
  const checksum = crypto.createHash('sha256').update(gz).digest('hex');

  console.log(`Sự kiện:      ${rows.length}`);
  console.log(`Nhân viên:    ${summary.length}`);
  console.log(`File:         ${outFile} (${(gz.length / 1024).toFixed(1)} KB)`);
  console.log(`SHA-256:      ${checksum}`);
  console.log(`Tổng hợp:     ${summary.length} dòng attendance_monthly_summary`);

  if (!apply) {
    console.log('\nDRY-RUN: chưa ghi DB, chưa xóa dữ liệu. Thêm --apply để thực thi.');
    await closePool();
    return;
  }

  await withTransaction(async client => {
    for (const row of summary) {
      await client.query(
        `INSERT INTO attendance_monthly_summary (bucket_month, employee_id, data, updated_at)
         VALUES ($1::date, $2, $3::jsonb, now())
         ON CONFLICT (bucket_month, employee_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [start, row.employee_id, JSON.stringify(row)],
      );
    }
    if (force) {
      await client.query(
        `DELETE FROM archive_manifests WHERE table_name = $1 AND period_start = $2::date`,
        ['attendance_events', start],
      );
    }
    await client.query(
      `INSERT INTO archive_manifests (table_name, period_start, period_end, row_count, file_url, checksum)
       VALUES ($1, $2::date, $3::date, $4, $5, $6)`,
      ['attendance_events', start, endExclusive, rows.length, outFile, checksum],
    );
    const del = await client.query(
      `DELETE FROM attendance_events WHERE bucket_month = $1::date`,
      [start],
    );
    console.log(`Đã xóa ${del.rowCount ?? 0} sự kiện khỏi PostgreSQL.`);
  });

  console.log(`\n✅ Archive ${month} hoàn tất. Dữ liệu gốc đã xóa; bản nén + manifest đã ghi.`);
  console.log('   Nhớ backup file .jsonl.gz ra ngoài VPS (Google Drive/ổ khác) trước khi dọn đĩa.');
  await closePool();
}

main().catch(async err => {
  console.error('❌ Archive lỗi:', err?.stack || err?.message || err);
  await closePool().catch(() => undefined);
  process.exit(1);
});
