import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUiUpdateSchedule } from '../src/utils/ui-update-schedule.js';

test('bật lịch cập nhật: chuẩn hóa thời điểm về ISO UTC', () => {
  const r = normalizeUiUpdateSchedule({
    ui_update_enabled: true,
    ui_update_at: '2026-10-24T20:30:00+07:00',
    ui_update_message: '  Giao diện mới  ',
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.patch.ui_update_enabled, true);
    assert.equal(r.patch.ui_update_at, '2026-10-24T13:30:00.000Z');
    assert.equal(r.patch.ui_update_message, '  Giao diện mới  ');
  }
});

test('bật lịch nhưng thiếu/không hợp lệ ngày giờ -> từ chối', () => {
  for (const bad of [undefined, null, '', 'khong-phai-ngay']) {
    const r = normalizeUiUpdateSchedule({ ui_update_enabled: true, ui_update_at: bad });
    assert.equal(r.ok, false, `phải từ chối: ${String(bad)}`);
  }
});

test('tắt lịch cập nhật: xóa mốc giờ để cổng NV không đếm ngược', () => {
  const r = normalizeUiUpdateSchedule({
    ui_update_enabled: false,
    ui_update_at: '2026-10-24T13:30:00.000Z',
    ui_update_message: 'Thông báo',
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.patch.ui_update_enabled, false);
    assert.equal(r.patch.ui_update_at, null);
    assert.equal(r.patch.ui_update_message, 'Thông báo');
  }
});

test('thông điệp bị giới hạn 500 ký tự', () => {
  const r = normalizeUiUpdateSchedule({
    ui_update_enabled: true,
    ui_update_at: '2026-10-24T13:30:00.000Z',
    ui_update_message: 'x'.repeat(900),
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.patch.ui_update_message.length, 500);
});
