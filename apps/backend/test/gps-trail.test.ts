import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';

// Trỏ kho vết vào thư mục tạm. Thư mục được resolve LƯỜI ở lần dùng đầu tiên nên
// gán env tại đây (trước khi gọi hàm) là đủ, không cần dynamic import.
process.env.GPS_TRAIL_DIR = path.join(os.tmpdir(), `ubm-gps-trail-test-${Date.now()}`);

import { appendGpsTrail, readGpsTrail, summarizeGpsTrail } from '../src/services/gps-trail.store.js';

const T0 = Date.parse('2026-11-03T03:00:00.000Z'); // 10:00 VN ngày 03/11/2026

test('vết GPS: ghi có tiết chế (di chuyển ≥30m hoặc ≥2 phút) rồi đọc lại', async () => {
  const emp = `T${Date.now()}`;
  // 1. Điểm đầu tiên luôn ghi.
  assert.equal(appendGpsTrail({ employee_id: emp, latitude: 10.1, longitude: 106.1, at_ms: T0 }), true);
  // 2. Đứng yên, mới 1s -> bỏ qua (không phình file).
  assert.equal(appendGpsTrail({ employee_id: emp, latitude: 10.1, longitude: 106.1, at_ms: T0 + 1_000 }), false);
  // 3. Di chuyển ~55m -> ghi.
  assert.equal(appendGpsTrail({ employee_id: emp, latitude: 10.1005, longitude: 106.1, at_ms: T0 + 2_000 }), true);
  // 4. Đứng yên nhưng đã quá 2 phút -> ghi nhịp tim.
  assert.equal(appendGpsTrail({ employee_id: emp, latitude: 10.1005, longitude: 106.1, at_ms: T0 + 2_000 + 120_000 }), true);

  await new Promise(r => setTimeout(r, 150));
  const pts = readGpsTrail('2026-11-03', emp);
  assert.equal(pts.length, 3);
  assert.deepEqual(pts.map(p => Math.round(p.latitude * 1e4) / 1e4), [10.1, 10.1005, 10.1005]);
});

test('vết GPS: đọc theo ngày + lọc theo nhân viên', async () => {
  const a = `A${Date.now()}`;
  const b = `B${Date.now()}`;
  appendGpsTrail({ employee_id: a, latitude: 10.2, longitude: 106.2, at_ms: T0 });
  appendGpsTrail({ employee_id: b, latitude: 10.3, longitude: 106.3, at_ms: T0 });
  await new Promise(r => setTimeout(r, 150));
  assert.equal(readGpsTrail('2026-11-03', a).length, 1);
  assert.equal(readGpsTrail('2026-11-03', b).length, 1);
  assert.equal(readGpsTrail('2026-11-03').length >= 2, true);
  assert.equal(readGpsTrail('2020-01-01').length, 0);
});

test('vết GPS: tổng hợp thời gian trong/ngoài cửa hàng + quãng đường', () => {
  const center = { lat: 10.79782, lng: 106.69345, radius: 300 };
  const mk = (lat: number, lng: number, min: number) => ({
    employee_id: 'E1', latitude: lat, longitude: lng,
    at: new Date(T0 + min * 60_000).toISOString(), at_ms: T0 + min * 60_000,
  });
  // P1,P2 trong cửa hàng; P3,P4 ngoài (≈409m).
  const points = [
    mk(10.79782, 106.69345, 0),
    mk(10.79782, 106.69345, 2),
    mk(10.80150, 106.69345, 4),
    mk(10.80150, 106.69345, 6),
  ];
  const sum = summarizeGpsTrail(points, center);
  assert.equal(sum.points, 4);
  // 2 cặp đầu (a trong) = 4 phút trong; cặp cuối (a ngoài) = 2 phút ngoài.
  assert.equal(sum.inside_minutes, 4);
  assert.equal(sum.outside_minutes, 2);
  assert.equal(sum.tracked_minutes, 6);
  assert.ok(sum.distance_meters > 350 && sum.distance_meters < 500, `distance=${sum.distance_meters}`);
  assert.ok(sum.first_at && sum.last_at);
});

test('vết GPS: khoảng nghỉ dài (>15 phút) không tính vào thời gian', () => {
  const center = { lat: 10.79782, lng: 106.69345, radius: 300 };
  const p1 = { employee_id: 'E2', latitude: 10.79782, longitude: 106.69345, at_ms: T0, at: new Date(T0).toISOString() };
  const p2 = { employee_id: 'E2', latitude: 10.79782, longitude: 106.69345, at_ms: T0 + 60 * 60_000, at: new Date(T0 + 60 * 60_000).toISOString() };
  const sum = summarizeGpsTrail([p1, p2], center);
  assert.equal(sum.inside_minutes, 15); // kẹp ở 15 phút
});
