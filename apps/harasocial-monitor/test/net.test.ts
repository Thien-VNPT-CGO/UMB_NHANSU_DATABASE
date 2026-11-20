import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeHttpUrl, isPrivateHostname, isPrivateIpv4, isPrivateIpv6 } from '../shared/net';

test('nhận diện IPv4 nội bộ', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.1.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1']) {
    assert.equal(isPrivateIpv4(ip), true, ip);
  }
  assert.equal(isPrivateIpv4('8.8.8.8'), false);
  assert.equal(isPrivateIpv4('172.32.0.1'), false);
});

test('nhận diện IPv6 nội bộ', () => {
  for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateIpv6(ip), true, ip);
  }
  assert.equal(isPrivateIpv6('2001:4860:4860::8888'), false);
});

test('chặn hostname nội bộ / metadata', () => {
  for (const host of ['localhost', 'foo.localhost', 'api.local', 'metadata.google.internal', '127.0.0.1', '2130706433']) {
    assert.equal(isPrivateHostname(host), true, host);
  }
  assert.equal(isPrivateHostname('example.com'), false);
});

test('chỉ cho phép HTTPS công khai', () => {
  assert.equal(assertSafeHttpUrl('https://api.harasocial.vn/conversations').hostname, 'api.harasocial.vn');
  assert.throws(() => assertSafeHttpUrl('http://api.harasocial.vn/x'), /HTTPS/);
  assert.throws(() => assertSafeHttpUrl('https://localhost/x'), /nội bộ/);
  assert.throws(() => assertSafeHttpUrl('https://127.0.0.1/x'), /nội bộ/);
  assert.throws(() => assertSafeHttpUrl('https://169.254.169.254/latest/meta-data'), /nội bộ/);
  assert.throws(() => assertSafeHttpUrl('https://user:pass@example.com/x'), /đăng nhập/);
  assert.throws(() => assertSafeHttpUrl('ftp://example.com/x'), /http/);
  assert.throws(() => assertSafeHttpUrl('not a url'), /không hợp lệ/);
});

test('allowLocalhost chỉ dành cho môi trường dev có chủ đích', () => {
  assert.equal(assertSafeHttpUrl('https://localhost:3001/hook', { allowLocalhost: true }).port, '3001');
  assert.equal(assertSafeHttpUrl('http://localhost:3001/hook', { allowLocalhost: true, requireHttps: false }).protocol, 'http:');
});
