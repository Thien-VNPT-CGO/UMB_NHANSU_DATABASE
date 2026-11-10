import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProposalSlots,
  proposalSlotTimes,
  validateProposalSlot,
} from '../src/services/interview-slots.service.js';
import { reminderKeyOf } from '../src/services/interview-zalo-reminder.service.js';

/** Mốc tham chiếu cố định: 2026-11-10 00:00 giờ VN. */
const NOW = new Date('2026-11-10T00:00:00+07:00').getTime();

test('khung giờ đề xuất đúng giờ làm việc HR: sáng 08:00–11:30, chiều 13:30–16:30', () => {
  const times = proposalSlotTimes().map(s => s.time);
  assert.equal(times[0], '08:00');
  assert.ok(times.includes('11:00'), 'phải có 11:00 (kết thúc 11:30)');
  assert.ok(!times.includes('11:30'), '11:30 là giờ kết thúc buổi sáng, không phải giờ bắt đầu');
  assert.ok(times.includes('13:30'));
  assert.ok(times.includes('16:00'));
  assert.ok(!times.includes('12:00'), 'không có khung nghỉ trưa');
  assert.ok(!times.includes('16:30'), '16:30 là giờ kết thúc buổi chiều');
  // 7 khung sáng (08:00..11:00) + 6 khung chiều (13:30..16:00)
  assert.equal(times.length, 7 + 6);
});

test('khung đã có ứng viên khác đặt (cách < 30 phút) bị khóa', () => {
  const slots = buildProposalSlots('2026-11-12', [
    { submission_id: 'CAND_0001', full_name: 'Người khác', status: 'CONFIRMED', interview_date: '2026-11-12', interview_time_slot: '09:00' },
  ], 'CAND_9999', NOW);
  const nine = slots.find(s => s.time === '09:00');
  assert.equal(nine?.disabled, true);
  assert.equal(nine?.reason, 'TAKEN');
  assert.equal(slots.find(s => s.time === '10:00')?.disabled, false);
});

test('bỏ qua chính ứng viên đang đề xuất (không tự khóa lịch của mình)', () => {
  const slots = buildProposalSlots('2026-11-12', [
    { submission_id: 'CAND_0002', full_name: 'Chính mình', status: 'INVITED_INTERVIEW', interview_date: '2026-11-12', interview_time_slot: '09:00' },
  ], 'CAND_0002', NOW);
  assert.equal(slots.find(s => s.time === '09:00')?.disabled, false);
});

test('khung đã qua giờ trong ngày hôm nay bị khóa', () => {
  const noonVn = new Date('2026-11-10T12:00:00+07:00').getTime();
  const slots = buildProposalSlots('2026-11-10', [], undefined, noonVn);
  assert.equal(slots.find(s => s.time === '09:00')?.disabled, true);
  assert.equal(slots.find(s => s.time === '09:00')?.reason, 'PAST');
  assert.equal(slots.find(s => s.time === '14:00')?.disabled, false);
});

test('validateProposalSlot chấp nhận ngày tương lai + khung hợp lệ', () => {
  const r = validateProposalSlot('2026-11-20', '15:30', [], undefined, NOW);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value, { date: '2026-11-20', time: '15:30' });
});

test('validateProposalSlot từ chối ngoài khung làm việc / ngày đã qua / khung bị chiếm', () => {
  assert.equal(validateProposalSlot('2026-11-20', '12:00', [], undefined, NOW).ok, false);
  assert.equal(validateProposalSlot('2026-11-20', '17:00', [], undefined, NOW).ok, false);
  assert.equal(validateProposalSlot('2026-11-01', '09:00', [], undefined, NOW).ok, false);
  const taken = validateProposalSlot('2026-11-20', '09:00', [
    { submission_id: 'CAND_0003', full_name: 'Khác', status: 'CONFIRMED', interview_date: '2026-11-20', interview_time_slot: '09:00' },
  ], 'CAND_9999', NOW);
  assert.equal(taken.ok, false);
  if (!taken.ok) assert.match(taken.error, /đã có ứng viên khác/);
});

test('reminderKeyOf đổi khi đổi lịch -> tự nhắc lại lịch mới', () => {
  assert.equal(reminderKeyOf('2026-11-11', '14:00 - 14:30'), '2026-11-11|14:00');
  assert.notEqual(reminderKeyOf('2026-11-11', '14:00'), reminderKeyOf('2026-11-12', '14:00'));
});
