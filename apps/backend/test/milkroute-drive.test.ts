import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EV_DRIVE_TABS,
  EV_DRIVE_ROOT_FOLDER_ID,
  evDayFolder,
  evDriveSegments,
  evMonthFolder,
  evToday,
  normalizeEvDay,
} from '../src/services/milkroute/ev-drive.service.js';

test('EV Drive: cấu trúc thư mục THANG_MM / DD-MM-YYYY / <tab>', () => {
  assert.equal(evMonthFolder('2026-11-13'), 'THANG_11');
  assert.equal(evMonthFolder('2026-01-05'), 'THANG_01');
  // Drive không cho phép "/" trong tên thư mục → dùng dấu "-".
  assert.equal(evDayFolder('2026-11-13'), '13-11-2026');
  assert.equal(evDayFolder('2026-01-05'), '05-01-2026');

  assert.deepEqual(evDriveSegments('2026-11-13', 'Ca vận chuyển'), [
    'THANG_11',
    '13-11-2026',
    'Ca vận chuyển',
  ]);
});

test('EV Drive: 6 thư mục tab đúng nhãn giao diện', () => {
  assert.deepEqual([...EV_DRIVE_TABS], [
    'Live Map',
    'Xe & Lộ trình',
    'Phiếu đổi lộ trình',
    'Ca vận chuyển',
    'Phiếu sạc',
    'Lương tài xế',
  ]);
});

test('EV Drive: root folder ID mặc định do chủ dự án cấp', () => {
  assert.equal(EV_DRIVE_ROOT_FOLDER_ID, '1qATZUiAu_KnztarbKraK13Xosn89pdJt');
});

test('EV Drive: chuẩn hoá ngày và ngày hôm nay theo giờ Việt Nam', () => {
  assert.equal(normalizeEvDay('2026-11-13'), '2026-11-13');
  // ISO timestamp 23:30 UTC = 06:30 sáng hôm sau theo giờ VN.
  assert.equal(normalizeEvDay('2026-11-12T23:30:00.000Z'), '2026-11-13');
  assert.equal(normalizeEvDay('không-phải-ngày'), '');
  assert.match(evToday(), /^\d{4}-\d{2}-\d{2}$/);
});
