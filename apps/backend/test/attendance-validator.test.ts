import test from 'node:test';
import assert from 'node:assert/strict';
import { checkinBody } from '../src/validators/hr.validator.js';

/**
 * Ca Sale cố định do máy sinh có assignment_id dạng:
 *   SHIFT_FIXED_EMP_<timestamp>_<seq>_<YYYY-MM-DD>_<CA>_<timestamp>_<seq>
 * Dài hơn 64 ký tự. Trước đây validator chặn ở 64 nên nhân viên Sale bấm
 * VÀO CA bị lỗi "Chỉ được tối đa 64 ký tự".
 */
test('checkinBody chấp nhận assignment_id dài của ca Sale cố định', () => {
  const assignmentId = `SHIFT_FIXED_EMP_1763700000000_123_2026-11-21_CA_2_1763700000000_1`;
  assert.ok(assignmentId.length > 64, 'ID mẫu phải dài hơn 64 ký tự');

  const parsed = checkinBody.parse({
    assignment_id: assignmentId,
    lat: 10.1,
    lng: 106.1,
    accuracy: 6,
    device_id: 'device-test',
  }) as any;

  assert.equal(parsed.assignment_id, assignmentId);
});

test('checkinBody vẫn chặn assignment_id quá dài bất thường', () => {
  assert.throws(() => checkinBody.parse({ assignment_id: 'X'.repeat(161) }));
});
