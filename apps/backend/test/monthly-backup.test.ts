import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDaysIso,
  dataUrlImageInfo,
  daysOfMonth,
  firstDayOfNextMonth,
  previousMonthOf,
  runMonthlyBackup,
  syncPhotoBacklog,
  vnMonthOf,
  vnToday,
} from '../src/services/monthly-backup.service.js';

test('tháng trước qua đúng ranh giới năm', () => {
  assert.equal(previousMonthOf('2026-10'), '2026-09');
  assert.equal(previousMonthOf('2026-01'), '2025-12');
  assert.equal(previousMonthOf('bad'), '');
});

test('ngày đầu tháng kế tiếp qua đúng ranh giới năm', () => {
  assert.equal(firstDayOfNextMonth('2026-10'), '2026-11-01');
  assert.equal(firstDayOfNextMonth('2026-12'), '2027-01-01');
  assert.equal(firstDayOfNextMonth('bad'), '');
});

test('daysOfMonth trả đủ số ngày, kể cả năm nhuận', () => {
  assert.equal(daysOfMonth('2026-02').length, 28);
  assert.equal(daysOfMonth('2024-02').length, 29);
  const oct = daysOfMonth('2026-10');
  assert.equal(oct.length, 31);
  assert.equal(oct[0], '2026-10-01');
  assert.equal(oct[oct.length - 1], '2026-10-31');
});

test('vnToday/vnMonthOf quy đổi đúng múi giờ VN (+07:00)', () => {
  // 2026-10-31T18:30:00Z = 2026-11-01 01:30 giờ VN -> đã sang tháng 11.
  const t = new Date('2026-10-31T18:30:00Z');
  assert.equal(vnToday(t), '2026-11-01');
  assert.equal(vnMonthOf(t), '2026-11');
  // 2026-10-31T16:59:00Z = 2026-10-31 23:59 giờ VN -> vẫn tháng 10.
  assert.equal(vnMonthOf(new Date('2026-10-31T16:59:00Z')), '2026-10');
});

test('chưa cấu hình Drive -> job tháng bỏ qua an toàn, không đụng dữ liệu', async () => {
  const sync = { isDriveReady: () => false } as any;
  const repo = {} as any;
  const r = await runMonthlyBackup(sync, repo, '2026-09');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'DRIVE_NOT_CONFIGURED');
  assert.equal(r.month, '2026-09');
});

test('tháng không hợp lệ -> INVALID_MONTH', async () => {
  const sync = { isDriveReady: () => true } as any;
  const r = await runMonthlyBackup(sync, {} as any, '2026-9');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'INVALID_MONTH');
});

test('addDaysIso cộng/trừ ngày đúng ranh giới tháng/năm', () => {
  assert.equal(addDaysIso('2026-10-31', 1), '2026-11-01');
  assert.equal(addDaysIso('2026-01-01', -1), '2025-12-31');
  assert.equal(addDaysIso('2024-02-28', 1), '2024-02-29');
  assert.equal(addDaysIso('bad', 1), '');
});

test('syncPhotoBacklog bù nhiều ngày bị lỡ nhưng giới hạn maxDays', async () => {
  const sync = {
    isDriveReady: () => true,
    getArchivedAttendanceEvents: async () => [],
  } as any;
  const repo = {
    getAttendanceEvents: async () => [],
    listAttendanceAdjustments: async () => [],
  } as any;

  const r = await syncPhotoBacklog(sync, repo, {
    fromDate: '2026-09-01',
    toDate: '2026-09-05',
    maxDays: 3,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.days, ['2026-09-03', '2026-09-04', '2026-09-05']);
  assert.equal(r.checked, 0);

  // fromDate > toDate: không chạy ngày nào (tránh quay ngược last_date).
  const empty = await syncPhotoBacklog(sync, repo, {
    fromDate: '2026-09-10',
    toDate: '2026-09-05',
  });
  assert.deepEqual(empty.days, []);
});

test('syncPhotoBacklog chưa cấu hình Drive -> bỏ qua an toàn', async () => {
  const r = await syncPhotoBacklog(
    { isDriveReady: () => false } as any,
    {} as any,
    { toDate: '2026-09-05' },
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'DRIVE_NOT_CONFIGURED');
});

test('dataUrlImageInfo tách đúng ảnh nhúng base64, bỏ qua URL/chuỗi thường', () => {
  const png = 'data:image/png;base64,' + Buffer.from('abc').toString('base64');
  const info = dataUrlImageInfo(png);
  assert.equal(info?.mime, 'image/png');
  assert.equal(info?.ext, 'png');
  assert.equal(info?.buffer.toString(), 'abc');

  const jpeg = 'data:image/jpeg;base64,' + Buffer.from('xyz').toString('base64');
  assert.equal(dataUrlImageInfo(jpeg)?.ext, 'jpg');

  assert.equal(dataUrlImageInfo('https://example.com/a.png'), null);
  assert.equal(dataUrlImageInfo('data:image/png;base64,'), null);
  assert.equal(dataUrlImageInfo(''), null);
});
