import test from 'node:test';
import assert from 'node:assert/strict';
import { AttendanceService } from '../src/services/attendance.service.js';

test('tháng VN: lọc phiếu theo tháng hiện tại (cổng admin)', () => {
  const now = new Date('2026-11-15T05:00:00.000Z'); // 12:00 VN ngày 15/11
  const list = [
    { id: 'thang10', created_at: '2026-10-31T16:59:59.000Z' }, // 31/10 23:59:59 VN
    { id: 'thang11-dau', created_at: '2026-10-31T17:00:00.000Z' }, // 01/11 00:00 VN
    { id: 'thang11-cuoi', created_at: '2026-11-30T16:59:59.000Z' }, // 30/11 23:59:59 VN
    { id: 'thang12', created_at: '2026-11-30T17:00:00.000Z' }, // 01/12 00:00 VN
  ];
  assert.deepEqual(
    AttendanceService.filterAdjustmentsByVnMonth(list, now).map((x: any) => x.id),
    ['thang11-dau', 'thang11-cuoi'],
  );
});

test('tháng VN: khóa tháng đúng múi giờ + dữ liệu hỏng trả rỗng', () => {
  assert.equal(AttendanceService.vnMonthKeyOf('2026-10-31T16:59:59.000Z'), '2026-10');
  assert.equal(AttendanceService.vnMonthKeyOf('2026-10-31T17:00:00.000Z'), '2026-11');
  assert.equal(AttendanceService.vnMonthKeyOf(''), '');
  assert.equal(AttendanceService.vnMonthKeyOf('không-phải-ngày'), '');
});

test('tháng VN: sang tháng mới danh sách tháng cũ tự rỗng', () => {
  const list = [
    { id: 'cu', created_at: '2026-10-20T03:00:00.000Z' },
    { id: 'moi', created_at: '2026-11-02T03:00:00.000Z' },
  ];
  assert.deepEqual(
    AttendanceService.filterAdjustmentsByVnMonth(list, new Date('2026-10-31T12:00:00.000Z')).map((x: any) => x.id),
    ['cu'],
  );
  assert.deepEqual(
    AttendanceService.filterAdjustmentsByVnMonth(list, new Date('2026-11-01T00:30:00.000Z')).map((x: any) => x.id),
    ['moi'],
  );
});
