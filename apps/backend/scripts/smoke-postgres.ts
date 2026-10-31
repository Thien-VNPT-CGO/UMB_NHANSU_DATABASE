/**
 * Smoke test nhanh cho PostgresAdapter ở chế độ KHÔNG có DATABASE_URL
 * (bộ nhớ + đĩa VPS), mô phỏng dev/mock và đường fallback khi Drive lỗi.
 *
 * Chạy: npx tsx scripts/smoke-postgres.ts
 *
 * Test:
 *  1. Adapter khởi tạo không DB, readiness = true.
 *  2. Check-in có ảnh: lưu đĩa + giữ DRV_LOCAL + event_photo (fallback).
 *  3. Cập nhật avatar: lưu đĩa avatar + DRV_LOCAL.
 *  4. Không crash khi tạo/xóa dữ liệu.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ubm-pg-smoke-'));
process.chdir(tmp);
process.env.DATA_STORE = 'mock';
process.env.NODE_ENV = 'test';
process.env.ATTENDANCE_PHOTO_DIR = path.join(tmp, 'photos');
delete process.env.DATABASE_URL;
delete process.env.PGHOST;

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=';

function assert(cond: any, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✔ ${msg}`);
}

async function main() {
  const { PostgresAdapter } = await import('../src/repositories/postgres.adapter.js');
  const { readAttendancePhotoDisk, readAvatarPhotoDisk } = await import('../src/services/photo-disk.store.js');

  const adapter = new PostgresAdapter();
  const repo: any = adapter.asRepository();

  assert(repo.getReadiness?.().ready === true, 'readiness = true khi không cấu hình DB');
  assert(repo.getStatus().mode === 'MOCK_ENGINE_ACTIVE', 'mode = MOCK_ENGINE_ACTIVE');

  const event = await repo.recordAttendanceEvent({
    event_id: 'EVT_SMOKE_1',
    request_id: 'REQ_SMOKE_1',
    employee_id: 'NV_SMOKE',
    branch_id: 'CN130',
    assignment_id: 'AS_SMOKE',
    type: 'CHECK_IN',
    client_time: new Date().toISOString(),
    photo_base64: PNG_1PX,
  });
  assert(!!event.event_id, 'ghi nhận sự kiện chấm công');
  const stored = adapter.getMockAdapter().attendanceEvents.find(e => e.event_id === 'EVT_SMOKE_1');
  assert(!!stored, 'sự kiện nằm trong bộ nhớ');
  assert(String(stored.drive_object_id || '').startsWith('DRV_LOCAL_'), 'Drive lỗi -> giữ id tạm DRV_LOCAL');
  assert(!!stored.event_photo, 'giữ ảnh inline để endpoint /photo phục vụ fallback');
  assert(!!readAttendancePhotoDisk('EVT_SMOKE_1'), 'ảnh chấm công đã lưu đĩa VPS');

  const emp = await repo.createEmployee({
    employee_id: 'NV_SMOKE',
    employee_code: 'UBM_NV_SMOKE',
    full_name: 'Nhân Viên Smoke',
    phone_normalized: '0900000000',
    employment_status: 'PROBATION' as any,
    group: 'STORE' as any,
    default_branch_id: 'CN130',
    current_rate_per_hour: 21000,
    start_date: '2026-01-01',
  });
  assert(emp.employee_id === 'NV_SMOKE', 'tạo nhân viên');

  const updated = await repo.updateEmployee('NV_SMOKE', { photo_base64: PNG_1PX }, 1);
  assert(String(updated.avatar_drive_id || '').startsWith('DRV_LOCAL_'), 'avatar Drive lỗi -> DRV_LOCAL');
  assert(!!updated.avatar_photo, 'avatar inline giữ để hiển thị');
  assert(!!readAvatarPhotoDisk('NV_SMOKE'), 'avatar đã lưu đĩa VPS');

  assert(await repo.deleteEmployee('NV_SMOKE') === true, 'xóa nhân viên không lỗi');
  assert(adapter.getMockAdapter().employees.length === 0, 'bộ nhớ đã xóa nhân viên');

  console.log(`\n✅ Smoke test PostgresAdapter (không DB) PASS — thư mục tạm: ${tmp}`);
}

main().catch(err => {
  console.error('\n❌ Smoke test FAIL:', err?.stack || err?.message || err);
  process.exit(1);
});
