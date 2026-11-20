import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dutyLabel,
  formatVnTime,
  isMinuteInRanges,
  isOnDutyNow,
  minutesUntilNextRange,
  parseClock,
  parseShiftRanges,
  vnDayKey,
  vnMinutesOfDay,
  vnParts,
} from '../shared/time';

test('quy đổi UTC sang giờ Việt Nam GMT+7 cố định', () => {
  const p = vnParts('2026-01-01T01:00:00Z');
  assert.equal(p.hour, 8);
  assert.equal(p.minute, 0);
  assert.equal(p.minutesOfDay, 480);
  assert.equal(vnMinutesOfDay('2026-01-01T01:00:00Z'), 480);
  assert.equal(formatVnTime('2026-01-01T01:05:00Z'), '08:05');
  assert.equal(vnDayKey('2026-01-01T18:00:00Z'), '2026-01-02');
});

test('parseClock hỗ trợ HH:MM, 8h00, HH:MM:SS, 24:00', () => {
  assert.equal(parseClock('08:00'), 480);
  assert.equal(parseClock('8h00'), 480);
  assert.equal(parseClock('08:00:00'), 480);
  assert.equal(parseClock('17h30'), 1050);
  assert.equal(parseClock('24:00'), 1440);
  assert.equal(parseClock('25:00'), null);
  assert.equal(parseClock('08:75'), null);
  assert.equal(parseClock(''), null);
});

test('parseShiftRanges: các định dạng ca phổ biến', () => {
  assert.deepEqual(parseShiftRanges('08:00 - 17:30'), [{ start: 480, end: 1050, overnight: false }]);
  assert.deepEqual(parseShiftRanges('8h00-17h30'), [{ start: 480, end: 1050, overnight: false }]);
  assert.deepEqual(parseShiftRanges('08:00:00 - 17:30:00'), [{ start: 480, end: 1050, overnight: false }]);
  const multi = parseShiftRanges('07:00-11:00, 13:00-17:30');
  assert.equal(multi.length, 2);
  assert.deepEqual(multi[1], { start: 780, end: 1050, overnight: false });
});

test('ca qua đêm 22:00 - 06:00 tính đúng theo giờ Việt Nam', () => {
  const shift = '22:00 - 06:00';
  // 23:00 VN
  assert.equal(isOnDutyNow(shift, '2026-06-01T16:00:00Z').onDuty, true);
  // 02:00 VN hôm sau
  assert.equal(isOnDutyNow(shift, '2026-06-01T19:00:00Z').onDuty, true);
  // 10:00 VN
  assert.equal(isOnDutyNow(shift, '2026-06-02T03:00:00Z').onDuty, false);
  // đúng 06:00 VN -> hết ca
  assert.equal(isOnDutyNow(shift, '2026-06-01T23:00:00Z').onDuty, false);
});

test('biên ca là end-exclusive', () => {
  const ranges = parseShiftRanges('08:00 - 17:30');
  assert.equal(isMinuteInRanges(479, ranges), false);
  assert.equal(isMinuteInRanges(480, ranges), true);
  assert.equal(isMinuteInRanges(1049, ranges), true);
  assert.equal(isMinuteInRanges(1050, ranges), false);
});

test('ca 00:00 - 00:00 là trực 24/24; 08:00 - 24:00 hết lúc nửa đêm', () => {
  assert.equal(isOnDutyNow('00:00 - 00:00', '2026-06-01T19:00:00Z').onDuty, true);
  assert.equal(isOnDutyNow('08:00 - 24:00', '2026-06-01T16:59:00Z').onDuty, true);
  assert.equal(isOnDutyNow('08:00 - 24:00', '2026-06-01T17:00:00Z').onDuty, false);
});

test('ca rỗng hoặc không hợp lệ => không trực', () => {
  assert.equal(isOnDutyNow('', '2026-06-01T03:00:00Z').onDuty, false);
  assert.equal(isOnDutyNow(null, '2026-06-01T03:00:00Z').onDuty, false);
  assert.equal(isOnDutyNow('abc', '2026-06-01T03:00:00Z').onDuty, false);
  assert.equal(parseShiftRanges('08:00').length, 0);
});

test('dutyLabel & minutesUntilNextRange phục vụ UI', () => {
  assert.equal(dutyLabel('08:00 - 17:30', true, '2026-06-01T03:00:00Z').label, 'Đang trong ca');
  assert.equal(dutyLabel('08:00 - 17:30', true, '2026-06-01T12:00:00Z').label, 'Ngoài giờ ca');
  assert.equal(dutyLabel('08:00 - 17:30', false, '2026-06-01T03:00:00Z').label, 'Đã tắt trực');
  assert.equal(dutyLabel('', true).label, 'Chưa cấu hình ca');
  assert.equal(minutesUntilNextRange('09:00 - 17:30', '2026-06-01T01:00:00Z'), 60);
});
