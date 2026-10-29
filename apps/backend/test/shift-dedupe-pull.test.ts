import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickPulledShift } from '../src/repositories/shift-dedupe.js';

function shift(overrides: Record<string, any> = {}) {
  return {
    assignment_id: 'SHIFT_1',
    employee_id: 'EMP_1',
    branch_id: 'CN130',
    shift_code: 'CA_1',
    date: '2026-10-20',
    status: 'PUBLISHED',
    schedule_version: 1,
    ...overrides,
  } as any;
}

test('pull: version bằng nhau — PUBLISHED trong bộ nhớ thắng DRAFT trên Sheet', () => {
  const memory = shift({ status: 'PUBLISHED', schedule_version: 3 });
  const pulled = shift({ status: 'DRAFT', schedule_version: 3 });
  assert.equal(pickPulledShift(memory, pulled), memory, 'không được hạ ca đã publish về nháp');
});

test('pull: version bằng nhau — DRAFT trong bộ nhớ không cản PUBLISHED trên Sheet', () => {
  const memory = shift({ status: 'DRAFT', schedule_version: 3 });
  const pulled = shift({ status: 'PUBLISHED', schedule_version: 3 });
  assert.equal(pickPulledShift(memory, pulled), pulled, 'Sheet đã publish phải được áp dụng');
});

test('pull: cùng version + cùng trạng thái — bản Sheet thắng (giữ sửa tay trên Sheet)', () => {
  const memory = shift({ status: 'PUBLISHED', schedule_version: 1, shift_code: 'CA_1' });
  const pulled = shift({ status: 'PUBLISHED', schedule_version: 1, shift_code: 'CA_2' });
  assert.equal(pickPulledShift(memory, pulled), pulled);
});

test('pull: version cao hơn thắng bất kể trạng thái', () => {
  const memory = shift({ status: 'PUBLISHED', schedule_version: 5 });
  const pulledOld = shift({ status: 'PUBLISHED', schedule_version: 4 });
  assert.equal(pickPulledShift(memory, pulledOld), memory);

  const memoryLow = shift({ status: 'PUBLISHED', schedule_version: 1 });
  const pulledNew = shift({ status: 'DRAFT', schedule_version: 2 });
  assert.equal(pickPulledShift(memoryLow, pulledNew), pulledNew);
});

test('pull: CANCELLED là trạng thái mạnh nhất — không hồi sinh ca đã hủy', () => {
  const memoryCancelled = shift({ status: 'CANCELLED', schedule_version: 2 });
  const pulledPublished = shift({ status: 'PUBLISHED', schedule_version: 2 });
  assert.equal(pickPulledShift(memoryCancelled, pulledPublished), memoryCancelled);

  const memoryPublished = shift({ status: 'PUBLISHED', schedule_version: 2 });
  const pulledCancelled = shift({ status: 'CANCELLED', schedule_version: 2 });
  assert.equal(pickPulledShift(memoryPublished, pulledCancelled), pulledCancelled);
});

test('pull: chưa có bản bộ nhớ — dùng bản Sheet', () => {
  const pulled = shift({ status: 'DRAFT' });
  assert.equal(pickPulledShift(null, pulled), pulled);
  assert.equal(pickPulledShift(undefined, pulled), pulled);
});
