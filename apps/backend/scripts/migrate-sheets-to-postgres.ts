/**
 * Migrate dữ liệu Google Sheets -> PostgreSQL (chạy MỘT LẦN, backend đã dừng).
 *
 * Cách chạy trên VPS:
 *   cd apps/backend
 *   npm run migrate:postgres
 *
 * Yêu cầu trong apps/backend/.env:
 *   DATABASE_URL=postgresql://ubm:matkhau@postgres:5432/ubm_hr
 *   GOOGLE_SERVICE_ACCOUNT_JSON=... (hoặc GOOGLE_SERVICE_ACCOUNT_FILE)
 *   SPREADSHEET_ID=...
 *
 * Mặc định script REPLACE toàn bộ bảng nghiệp vụ bằng dữ liệu vừa đọc từ
 * Sheets (an toàn khi chạy lại nhiều lần). Thêm --keep để chỉ upsert, không xóa.
 */

import path from 'path';
import dotenv from 'dotenv';

const envFile = process.env.ENV_FILE
  || (process.cwd().endsWith(path.join('apps', 'backend'))
    ? path.resolve(process.cwd(), '.env')
    : path.resolve(process.cwd(), 'apps/backend/.env'));
dotenv.config({ path: envFile });
dotenv.config(); // fallback: .env ở cwd

import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { PostgresStore } from '../src/repositories/postgres-store.js';
import { GoogleSheetsSyncService } from '../src/services/google-sheets-sync.service.js';
import { closePool, isPostgresConfigured } from '../src/config/database.js';

async function main() {
  if (!isPostgresConfigured()) {
    console.error('❌ Thiếu DATABASE_URL/PGHOST. Điền kết nối PostgreSQL trong apps/backend/.env.');
    process.exit(1);
  }

  const replace = !process.argv.includes('--keep');
  const mock = new MockSheetsAdapter();
  const sync = new GoogleSheetsSyncService();
  const store = new PostgresStore();

  console.log('1/4 Khởi tạo schema PostgreSQL...');
  await store.initSchema();

  console.log('2/4 Đọc dữ liệu từ Google Sheets...');
  const pull = await sync.pullAllDataFromGoogleSheets(mock as any);
  if (!pull.success) {
    console.error('❌ Pull Sheets thất bại:', pull.message);
    process.exit(2);
  }
  console.log('   Counts:', pull.counts);

  const summary = {
    employees: mock.employees.length,
    accounts: mock.accounts.length,
    adminAccounts: mock.adminAccounts.length,
    shifts: mock.shifts.length,
    attendanceEvents: mock.attendanceEvents.length,
    attendanceAdjustments: mock.attendanceAdjustments.length,
    payrollRuns: mock.payrollRuns.length,
    payslips: mock.payslips.length,
    candidates: mock.candidates.length,
    notifications: mock.notificationInbox.length + mock.notificationOutbox.length,
  };
  console.log('3/4 Ghi vào PostgreSQL', replace ? '(REPLACE)' : '(UPSERT)', summary);

  if (replace) await store.replaceAll(mock);
  else await store.persistAll(mock);

  console.log('4/4 Xác minh...');
  const verify = new MockSheetsAdapter();
  const loaded = await store.loadAll(verify);
  if (!loaded.loaded) {
    console.error('❌ Không đọc lại được dữ liệu vừa ghi.');
    process.exit(3);
  }
  console.log('   Đã nạp lại từ DB:', loaded.counts);

  const expected = summary.employees;
  const actual = Number(loaded.counts.employees || 0);
  if (expected > 0 && actual < expected) {
    console.warn(`⚠️  Nhân viên: Sheets ${expected}, PostgreSQL ${actual}. Kiểm tra lại tab NHAN_VIEN_MASTER.`);
  }

  console.log('✅ Migration hoàn tất. Khởi động backend với DATA_STORE=postgres.');
  await closePool();
}

main().catch(async err => {
  console.error('❌ Migration lỗi:', err?.stack || err?.message || err);
  await closePool().catch(() => undefined);
  process.exit(1);
});
