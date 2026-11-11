import { test } from 'node:test';
import assert from 'node:assert/strict';
import { officeCheckInWindowOf, attShiftStatus } from '@ubm/shared';

// Mốc UTC tương ứng giờ Việt Nam (UTC+7). 11/11/2026 là Thứ 4 (ngày làm việc).
const VN = (hhmmss: string, date = '2026-11-11') => Date.parse(`${date}T${hhmmss}+07:00`);

test('officeCheckInWindowOf: mở 08:00, ĐÓNG đúng 08:30:00 giờ Việt Nam', () => {
  assert.equal(officeCheckInWindowOf(VN('07:59:59')).phase, 'BEFORE');
  assert.equal(officeCheckInWindowOf(VN('08:00:00')).phase, 'OPEN');
  assert.equal(officeCheckInWindowOf(VN('08:29:59')).phase, 'OPEN');
  // Hết 08:29 là khóa: 08:30:00 KHÔNG còn được check-in.
  assert.equal(officeCheckInWindowOf(VN('08:30:00')).phase, 'CLOSED');
  assert.equal(officeCheckInWindowOf(VN('10:00:00')).phase, 'CLOSED');
});

test('officeCheckInWindowOf: còn lại đúng số giây tới lúc đóng cổng', () => {
  const w = officeCheckInWindowOf(VN('08:00:00'));
  assert.equal(w.remainingMs, 30 * 60 * 1000);
  assert.equal(officeCheckInWindowOf(VN('08:29:00')).remainingMs, 60 * 1000);
  assert.equal(officeCheckInWindowOf(VN('08:30:00')).remainingMs, 0);
});

test('officeCheckInWindowOf: không phụ thuộc múi giờ máy chạy (chỉ dùng mốc epoch)', () => {
  // 01:00:00 UTC = 08:00:00 VN.
  const w = officeCheckInWindowOf(Date.parse('2026-11-11T01:00:00Z'));
  assert.equal(w.date, '2026-11-11');
  assert.equal(w.vnHour, 8);
  assert.equal(w.vnMinute, 0);
  assert.equal(w.phase, 'OPEN');
  assert.equal(w.openAt, '2026-11-11T08:00:00+07:00');
  assert.equal(w.closeAt, '2026-11-11T08:30:00+07:00');
});

test('officeCheckInWindowOf: Chủ nhật nghỉ (không mở cổng)', () => {
  assert.equal(officeCheckInWindowOf(VN('08:10:00', '2026-11-15')).phase, 'DAY_OFF');
});

test('officeCheckInWindowOf: qua nửa đêm UTC vẫn nhận đúng ngày VN', () => {
  // 17:00:00 UTC 11/11 = 00:00:00 VN 12/11.
  const w = officeCheckInWindowOf(Date.parse('2026-11-11T17:00:00Z'));
  assert.equal(w.date, '2026-11-12');
  assert.equal(w.phase, 'BEFORE');
});

test('attShiftStatus: Văn Phòng khóa ngay sau 08:30 thay vì chờ 3 giờ', () => {
  // Ngày đã qua → chắc chắn quá 08:30 dù test chạy lúc nào.
  const shift = { date: '2020-01-02', start_at: '2020-01-02T08:00:00+07:00', end_at: '2020-01-02T17:00:00+07:00' };
  const st = attShiftStatus(shift, null, null, null, { lockAfterMs: 30 * 60 * 1000, lockedLabel: 'LOCKED_VP' });
  assert.equal(st.key, 'LOCKED');
  assert.equal(st.label, 'LOCKED_VP');
});
