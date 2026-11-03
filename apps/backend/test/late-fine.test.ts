import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lateFineFor, isStoredFineStillValid, LATE_FINE_FLAT_VND } from '../src/services/payroll.service.js';

const SHIFT_PAY = 1_000_000;

test('lateFineFor: dưới 10 phút không phạt (kể cả 9 phút)', () => {
  for (const m of [0, 1, 5, 9]) {
    const r = lateFineFor(m, SHIFT_PAY);
    assert.equal(r.tier, 'NONE', `${m} phút phải NONE`);
    assert.equal(r.deduction, 0);
    assert.equal(r.unpaid, false);
  }
});

test('lateFineFor: 10–29 phút phạt đúng 30.000đ', () => {
  for (const m of [10, 15, 29]) {
    const r = lateFineFor(m, SHIFT_PAY);
    assert.equal(r.tier, 'FLAT_30K');
    assert.equal(r.deduction, LATE_FINE_FLAT_VND);
    assert.equal(r.unpaid, false);
  }
});

test('lateFineFor: 30–59 phút phạt 50% lương ca', () => {
  for (const m of [30, 45, 59]) {
    const r = lateFineFor(m, SHIFT_PAY);
    assert.equal(r.tier, 'HALF_SHIFT');
    assert.equal(r.deduction, Math.round(SHIFT_PAY * 0.5));
    assert.equal(r.unpaid, false);
  }
});

test('lateFineFor: từ 60 phút phạt 100% lương ca', () => {
  for (const m of [60, 120]) {
    const r = lateFineFor(m, SHIFT_PAY);
    assert.equal(r.tier, 'FULL_SHIFT');
    assert.equal(r.unpaid, true);
  }
});

test('isStoredFineStillValid: bỏ khoản 30k cũ khi ca trễ dưới 10 phút', () => {
  assert.equal(isStoredFineStillValid('FLAT_30K', 5), false);
  assert.equal(isStoredFineStillValid('FLAT_30K', 9), false);
  assert.equal(isStoredFineStillValid('FLAT_30K', 10), true);
  assert.equal(isStoredFineStillValid('FLAT_30K', 25), true);
  assert.equal(isStoredFineStillValid('HALF_SHIFT', 5), true);
  assert.equal(isStoredFineStillValid('FULL_SHIFT', 5), true);
  assert.equal(isStoredFineStillValid('NONE', 20), false);
  assert.equal(isStoredFineStillValid(undefined, 20), false);
});
