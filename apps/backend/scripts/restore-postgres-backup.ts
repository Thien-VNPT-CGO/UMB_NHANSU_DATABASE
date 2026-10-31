/**
 * Phục hồi PostgreSQL từ file backup .jsonl.gz (do backup 4 tầng tạo ra).
 *
 * ⚠️ CHỈ chạy khi backend đã DỪNG (docker compose stop backend). Script sẽ
 * TRUNCATE đúng các bảng có trong file rồi ghi lại toàn bộ dữ liệu — mọi thay
 * đổi phát sinh sau bản backup đó sẽ mất.
 *
 * Cách dùng:
 *   cd apps/backend
 *
 *   # Xem trước nội dung file (không ghi DB)
 *   npx tsx scripts/restore-postgres-backup.ts --file=backups/.../postgres_2026-10-31.jsonl.gz
 *
 *   # Thực thi
 *   npx tsx scripts/restore-postgres-backup.ts --file=... --force
 *
 *   # File .jsonl (chưa nén) cũng đọc được.
 *
 * Sau khi phục hồi: docker compose start backend và kiểm tra /api/health/ready.
 */

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

import { closePool, isPostgresConfigured } from '../src/config/database.js';
import { PostgresStore } from '../src/repositories/postgres-store.js';

function argValue(name: string, fallback = ''): string {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function readBackup(file: string): { text: string; header: any; gzip: boolean } {
  const buffer = fs.readFileSync(file);
  const gzip = buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  const raw = gzip ? zlib.gunzipSync(buffer) : buffer;
  const text = raw.toString('utf8');
  const firstLine = text.split('\n', 1)[0] || '';
  let header: any = null;
  try { header = JSON.parse(firstLine); } catch { /* file cũ không có header */ }
  return { text, header, gzip };
}

async function main() {
  const file = argValue('file');
  const force = process.argv.includes('--force');
  if (!file) {
    console.error('❌ Thiếu --file=<đường dẫn .jsonl.gz>');
    process.exit(1);
  }
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    console.error(`❌ Không thấy file: ${abs}`);
    process.exit(1);
  }
  if (!isPostgresConfigured()) {
    console.error('❌ Thiếu DATABASE_URL/PGHOST. Điền kết nối PostgreSQL trong apps/backend/.env.');
    process.exit(1);
  }

  const { text, header, gzip } = readBackup(abs);
  const lines = text.split('\n').filter(Boolean).length;
  console.log(`\n=== Phục hồi PostgreSQL từ backup ===`);
  console.log(`File:    ${abs}${gzip ? ' (gzip)' : ''}`);
  console.log(`Dòng:    ${lines}`);
  if (header?._ubm_backup) {
    console.log(`Tạo lúc: ${header.created_at}`);
    console.log('Số dòng theo bảng:');
    for (const [key, value] of Object.entries(header.counts || {})) {
      console.log(`  - ${key}: ${value}`);
    }
  } else {
    console.log('⚠️  File không có header _ubm_backup — vẫn thử phục hồi theo từng dòng.');
  }

  if (!force) {
    console.log('\nDRY-RUN: chưa ghi DB. Thêm --force để phục hồi (sẽ TRUNCATE các bảng có trong file).');
    await closePool();
    return;
  }

  console.log('\n⚠️  Đang TRUNCATE + ghi lại dữ liệu. Đảm bảo backend đã dừng!');
  const store = new PostgresStore();
  await store.initSchema();
  const result = await store.restoreBackupJsonl(text);
  console.log(`\n✅ Phục hồi xong: ${result.total} bản ghi.`);
  for (const [key, value] of Object.entries(result.counts)) {
    console.log(`   - ${key}: ${value}`);
  }
  console.log('\nKhởi động lại backend rồi kiểm tra /api/health/ready.');
  await closePool();
}

main().catch(async err => {
  console.error('❌ Phục hồi lỗi:', err?.stack || err?.message || err);
  await closePool().catch(() => undefined);
  process.exit(1);
});
