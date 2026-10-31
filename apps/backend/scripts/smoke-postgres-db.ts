/**
 * Integration test PostgreSQL thật (cluster tạm) cho PostgresStore + PostgresAdapter.
 *
 * Chuẩn bị (PowerShell, dùng PostgreSQL 16 đã cài):
 *   initdb -D %TEMP%\ubm-pgtest-data -U ubm --auth=trust -E UTF8 --no-locale
 *   pg_ctl -D %TEMP%\ubm-pgtest-data -o "-p 55432 -h 127.0.0.1" -l %TEMP%\ubm-pgtest.log start
 *   createdb -h 127.0.0.1 -p 55432 -U ubm ubm_hr
 *   $env:DATABASE_URL="postgresql://ubm@127.0.0.1:55432/ubm_hr"
 *   npx tsx scripts/smoke-postgres-db.ts
 *
 * Test: schema, replaceAll/loadAll, sanitize ảnh base64, persistMutation,
 * singleton settings và write-through của PostgresAdapter.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ubm-pgdb-'));
process.chdir(tmp); // để DriveStorage không đọc key.json thật & đĩa ảnh nằm trong temp
process.env.ATTENDANCE_PHOTO_DIR = path.join(tmp, 'photos');
process.env.BACKUP_LOCAL_DIR = path.join(tmp, 'backups');
process.env.NODE_ENV = 'test';

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=';

function assert(cond: any, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✔ ${msg}`);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitReady(adapter: any, ms = 15_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (adapter.getReadiness?.().ready) return true;
    await sleep(100);
  }
  return false;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ Thiếu DATABASE_URL (trỏ tới cluster test).');
    process.exit(1);
  }

  const { MockSheetsAdapter } = await import('../src/repositories/mock-sheets.adapter.js');
  const { PostgresStore } = await import('../src/repositories/postgres-store.js');
  const { PostgresAdapter } = await import('../src/repositories/postgres.adapter.js');
  const { pgQuery, closePool } = await import('../src/config/database.js');

  const store = new PostgresStore();
  assert(store.configured === true, 'PostgresStore nhận DATABASE_URL');

  console.log('\n[1] Schema + replaceAll + loadAll');
  await store.initSchema();

  const src = new MockSheetsAdapter();
  await src.createEmployee({
    employee_id: 'NV_DB_1',
    employee_code: 'UBM_NV_DB_1',
    full_name: 'Nguyễn Văn DB',
    phone_normalized: '0911111111',
    employment_status: 'PROBATION' as any,
    group: 'STORE' as any,
    default_branch_id: 'CN130',
    current_rate_per_hour: 21000,
    start_date: '2026-01-01',
    bank_qr_img: PNG_1PX,
  });
  src.attendanceEvents.push({
    event_id: 'EVT_DB_1',
    request_id: 'REQ_DB_1',
    employee_id: 'NV_DB_1',
    branch_id: 'CN130',
    assignment_id: 'AS_DB_1',
    type: 'CHECK_IN',
    client_time: '2026-10-01T01:00:00.000Z',
    server_received_at: '2026-10-01T01:00:01.000Z',
    drive_object_id: 'FILE_DRIVE_1',
    event_photo: PNG_1PX,
    created_at: '2026-10-01T01:00:01.000Z',
  } as any);
  src.systemSettings = { ...src.systemSettings, smoke_marker: 'DB_OK' };

  await store.replaceAll(src);
  const reloaded = new MockSheetsAdapter();
  const loaded = await store.loadAll(reloaded);
  assert(loaded.loaded === true, 'loadAll báo có dữ liệu');
  assert(reloaded.employees.length === 1, 'nạp lại 1 nhân viên');
  assert(reloaded.attendanceEvents.length === 1, 'nạp lại 1 sự kiện chấm công');
  assert(reloaded.employees[0].bank_qr_img === PNG_1PX, 'QR ngân hàng (ngoại lệ) vẫn lưu inline');
  assert(reloaded.systemSettings.smoke_marker === 'DB_OK', 'singleton systemSettings roundtrip');

  const evtRow = await pgQuery<{ data: any }>(
    `SELECT data FROM attendance_events WHERE id = $1`, ['EVT_DB_1'],
  );
  assert(!!evtRow.rows[0], 'sự kiện có trong bảng attendance_events');
  const evtData = evtRow.rows[0].data;
  assert(evtData.event_photo === undefined, 'KHÔNG lưu event_photo base64 vào PostgreSQL');
  assert(evtData.drive_object_id === 'FILE_DRIVE_1', 'giữ drive_object_id');

  console.log('\n[2] persistMutation + delete');
  const live = new MockSheetsAdapter();
  await store.loadAll(live);
  live.attendanceEvents.push({
    event_id: 'EVT_DB_2',
    request_id: 'REQ_DB_2',
    employee_id: 'NV_DB_1',
    branch_id: 'CN130',
    assignment_id: 'AS_DB_1',
    type: 'CHECK_OUT',
    client_time: '2026-10-01T10:00:00.000Z',
    drive_object_id: 'DRV_LOCAL_TEST',
    event_photo: PNG_1PX,
    created_at: '2026-10-01T10:00:00.000Z',
  } as any);
  const newEvt = live.attendanceEvents[live.attendanceEvents.length - 1];
  await store.persistMutation('recordAttendanceEvent', [newEvt], newEvt, live);
  const evt2 = await pgQuery<{ data: any }>(`SELECT data FROM attendance_events WHERE id = $1`, ['EVT_DB_2']);
  assert(!!evt2.rows[0], 'persistMutation thêm sự kiện mới');
  assert(evt2.rows[0].data.event_photo === undefined, 'persistMutation cũng sanitize ảnh');

  live.attendanceEvents = live.attendanceEvents.filter(e => e.event_id !== 'EVT_DB_2');
  await store.persistMutation('deleteAttendanceEvent', ['EVT_DB_2'], true, live);
  const evt2After = await pgQuery(`SELECT 1 FROM attendance_events WHERE id = $1`, ['EVT_DB_2']);
  assert(evt2After.rowCount === 0, 'deleteAttendanceEvent xóa đúng dòng');

  console.log('\n[3] PostgresAdapter write-through (ảnh -> đĩa + DB metadata)');
  const adapter = new PostgresAdapter();
  assert(await waitReady(adapter), 'adapter bootstrap xong (DB đã có dữ liệu)');
  const repo: any = adapter.asRepository();

  const event = await repo.recordAttendanceEvent({
    event_id: 'EVT_DB_3',
    request_id: 'REQ_DB_3',
    employee_id: 'NV_DB_1',
    branch_id: 'CN130',
    assignment_id: 'AS_DB_1',
    type: 'CHECK_IN',
    client_time: '2026-10-02T01:00:00.000Z',
    photo_base64: PNG_1PX,
  });
  assert(event.event_id === 'EVT_DB_3', 'adapter ghi sự kiện');
  const row3 = await pgQuery<{ data: any }>(`SELECT data FROM attendance_events WHERE id = $1`, ['EVT_DB_3']);
  assert(!!row3.rows[0], 'write-through: sự kiện đã vào PostgreSQL');
  assert(row3.rows[0].data.event_photo === undefined, 'DB không chứa ảnh base64');
  assert(String(row3.rows[0].data.drive_object_id || '').startsWith('DRV_LOCAL_'), 'Drive tắt -> DRV_LOCAL trong DB');

  const updated = await repo.updateEmployee('NV_DB_1', { photo_base64: PNG_1PX }, Number((await repo.getEmployeeById('NV_DB_1')).version));
  assert(String(updated.avatar_drive_id || '').startsWith('DRV_LOCAL_'), 'avatar update -> DRV_LOCAL');
  const empRow = await pgQuery<{ data: any }>(`SELECT data FROM employees WHERE id = $1`, ['NV_DB_1']);
  assert(empRow.rows[0].data.avatar_photo === undefined, 'DB không chứa avatar base64');

  console.log('\n[4] Đọc lại sau khi "restart"');
  const adapter2 = new PostgresAdapter();
  assert(await waitReady(adapter2), 'adapter thứ 2 bootstrap từ PostgreSQL');
  const employees2 = await adapter2.asRepository().listEmployees();
  assert(employees2.length >= 1, 'nhân viên sống sót qua restart');
  const events2 = await adapter2.asRepository().getAttendanceEvents('*', '*');
  assert(events2.some((e: any) => e.event_id === 'EVT_DB_3'), 'sự kiện chấm công sống sót qua restart');

  console.log('\n[5] Backup JSONL + phục hồi');
  const exported = await store.exportBackupJsonl();
  assert(exported.total > 0, 'export có dữ liệu');
  assert(!!exported.counts.employees, 'header có counts nhân viên');
  assert(exported.jsonl.split('\n')[0].includes('_ubm_backup'), 'dòng đầu là header backup');

  // Xóa 1 nhân viên rồi phục hồi: nhân viên phải quay lại.
  const beforeRestore = await pgQuery(`SELECT count(*)::int AS n FROM employees`);
  await pgQuery(`DELETE FROM employees WHERE id = $1`, ['NV_DB_1']);
  const afterDelete = await pgQuery(`SELECT count(*)::int AS n FROM employees`);
  assert(afterDelete.rows[0].n === beforeRestore.rows[0].n - 1, 'xóa tạm 1 nhân viên trước khi phục hồi');

  const restored = await store.restoreBackupJsonl(exported.jsonl);
  assert(restored.total > 0, 'phục hồi báo có dữ liệu');
  const afterRestore = await pgQuery<{ data: any }>(`SELECT data FROM employees WHERE id = $1`, ['NV_DB_1']);
  assert(!!afterRestore.rows[0], 'nhân viên đã quay lại sau phục hồi');
  assert(String(afterRestore.rows[0].data.full_name || '').includes('DB'), 'nội dung nhân viên đúng');
  const evtRestored = await pgQuery(`SELECT 1 FROM attendance_events WHERE id = $1`, ['EVT_DB_3']);
  assert((evtRestored.rowCount || 0) === 1, 'sự kiện chấm công quay lại sau phục hồi');

  const settingsRow = await pgQuery<{ data: any }>(`SELECT data FROM app_settings WHERE key = $1`, ['systemSettings']);
  assert(!!settingsRow.rows[0], 'app_settings được phục hồi');

  console.log('\n[6] Scheduler backup 4 tầng (Drive tắt -> vẫn ghi bản local)');
  const { getDriveBackupScheduler, resetDriveBackupSchedulerForTests } = await import('../src/services/backup-drive.service.js');
  const scheduler = getDriveBackupScheduler(adapter2);
  const run = await scheduler.runNow('hourly');
  assert(run.kind === 'hourly', 'runNow chạy đúng tầng giờ');
  assert(!!run.localPath && fs.existsSync(run.localPath), 'đã ghi file backup local trên VPS');
  assert(run.file.endsWith('_manual.jsonl.gz'), 'bản chạy tay có hậu tố _manual (không đè bản theo lịch)');
  assert(run.rows > 0, 'file backup có dữ liệu');
  assert(run.ok === false && run.error === 'DRIVE_NOT_CONFIGURED', 'Drive chưa cấu hình -> báo lỗi nhưng giữ bản local');
  const rawGz = fs.readFileSync(run.localPath!, );
  assert(rawGz[0] === 0x1f && rawGz[1] === 0x8b, 'file backup là gzip hợp lệ');
  const state = await store.getSetting<any>('backup_schedule_v1');
  assert(!!state?.last_result?.hourly, 'đã lưu trạng thái lần backup vào app_settings');
  assert(!state?.last_hourly_slot, 'chạy tay KHÔNG đánh dấu mốc kỳ đã chạy');

  // Chạy tay tầng tuần/tháng phải được bất kể hôm nay có đúng lịch hay không.
  const weekly = await scheduler.runNow('weekly');
  assert(/^postgres_\d{4}-W\d{2}_manual\.jsonl\.gz$/.test(weekly.file), 'tuần chạy tay đúng tên file');
  const monthly = await scheduler.runNow('monthly');
  assert(/^postgres_\d{4}-\d{2}_manual\.jsonl\.gz$/.test(monthly.file), 'tháng chạy tay đúng tên file');
  resetDriveBackupSchedulerForTests();

  await closePool();
  console.log(`\n✅ Integration PostgreSQL PASS — cluster test, thư mục tạm: ${tmp}`);
}

main().catch(async err => {
  console.error('\n❌ Integration PostgreSQL FAIL:', err?.stack || err?.message || err);
  try {
    const { closePool } = await import('../src/config/database.js');
    await closePool();
  } catch { /* ignore */ }
  process.exit(1);
});
