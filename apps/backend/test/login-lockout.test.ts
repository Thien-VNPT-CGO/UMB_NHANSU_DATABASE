import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LoginLockoutService,
  buildLoginLockoutKey,
} from '../src/services/login-lockout.service.js';

test('khóa sau đủ số lần sai và mở lại sau thời gian khóa', () => {
  let now = 0;
  const service = new LoginLockoutService({
    maxFailures: 3,
    windowMs: 10_000,
    lockMs: 60_000,
    now: () => now,
  });
  const key = 'employee:0901234567:1.2.3.4';

  assert.equal(service.check(key).locked, false);

  const first = service.recordFailure(key);
  assert.equal(first.locked, false);
  assert.equal(first.failures, 1);
  assert.equal(first.remainingAttempts, 2);

  const second = service.recordFailure(key);
  assert.equal(second.locked, false);
  assert.equal(second.remainingAttempts, 1);

  const third = service.recordFailure(key);
  assert.equal(third.locked, true);
  assert.equal(third.retryAfterSeconds, 60);

  now = 30_000;
  const duringLock = service.check(key);
  assert.equal(duringLock.locked, true);
  assert.equal(duringLock.retryAfterSeconds, 30);

  // Hết khóa: được thử lại, bộ đếm về 0.
  now = 60_001;
  const afterLock = service.check(key);
  assert.equal(afterLock.locked, false);
  assert.equal(afterLock.failures, 0);

  const retry = service.recordFailure(key);
  assert.equal(retry.locked, false);
  assert.equal(retry.failures, 1);
});

test('cửa sổ đếm hết hạn thì không cộng dồn lần sai cũ', () => {
  let now = 0;
  const service = new LoginLockoutService({
    maxFailures: 5,
    windowMs: 10_000,
    lockMs: 60_000,
    now: () => now,
  });
  const key = 'employee:0901234567:1.2.3.4';

  service.recordFailure(key);
  service.recordFailure(key);
  now = 10_001;
  const next = service.recordFailure(key);
  assert.equal(next.failures, 1);
  assert.equal(next.locked, false);
});

test('đăng nhập thành công xóa bộ đếm', () => {
  const service = new LoginLockoutService({ maxFailures: 5, now: () => 0 });
  const key = 'employee:0901234567:1.2.3.4';
  service.recordFailure(key);
  service.recordFailure(key);
  assert.equal(service.size(), 1);

  service.reset(key);
  assert.equal(service.size(), 0);
  assert.equal(service.check(key).failures, 0);
});

test('key chuẩn hóa SĐT +84/0 và tách theo IP', () => {
  const a = buildLoginLockoutKey('employee', '+84 901 234 567', '1.1.1.1');
  const b = buildLoginLockoutKey('employee', '0901234567', '1.1.1.1');
  const c = buildLoginLockoutKey('employee', '0084 901 234 567', '1.1.1.1');
  assert.equal(a, b);
  assert.equal(a, c);

  const otherIp = buildLoginLockoutKey('employee', '0901234567', '2.2.2.2');
  assert.notEqual(a, otherIp);

  const admin = buildLoginLockoutKey('admin', '  Admin  ', '1.1.1.1');
  assert.equal(admin, 'admin:admin:1.1.1.1');
});
