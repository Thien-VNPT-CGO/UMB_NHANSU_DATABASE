import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getThemeScheduleState,
  normalizeThemeSchedule,
} from '../src/utils/theme-schedule.js';

const START = '2026-12-20T00:00:00.000Z';
const END = '2026-12-26T00:00:00.000Z';

test('bật lịch sự kiện: chuẩn hóa sự kiện + 2 mốc giờ về ISO UTC', () => {
  const r = normalizeThemeSchedule({
    theme_event: 'noel',
    theme_schedule_enabled: true,
    theme_start_at: '2026-12-20T07:00:00+07:00',
    theme_end_at: '2026-12-26T07:00:00+07:00',
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.patch.theme_event, 'noel');
    assert.equal(r.patch.theme_schedule_enabled, true);
    assert.equal(r.patch.theme_start_at, START);
    assert.equal(r.patch.theme_end_at, END);
  }
});

test('bật lịch nhưng thiếu sự kiện / mốc giờ -> từ chối', () => {
  const cases = [
    { theme_event: '', theme_schedule_enabled: true, theme_start_at: START, theme_end_at: END },
    { theme_event: 'khong-ton-tai', theme_schedule_enabled: true, theme_start_at: START, theme_end_at: END },
    { theme_event: 'tet', theme_schedule_enabled: true, theme_start_at: '', theme_end_at: END },
    { theme_event: 'tet', theme_schedule_enabled: true, theme_start_at: START, theme_end_at: 'khong-phai-ngay' },
  ];
  for (const input of cases) {
    const r = normalizeThemeSchedule(input);
    assert.equal(r.ok, false, `phải từ chối: ${JSON.stringify(input)}`);
  }
});

test('ngày kết thúc phải sau ngày bắt đầu', () => {
  const r = normalizeThemeSchedule({
    theme_event: 'halloween',
    theme_schedule_enabled: true,
    theme_start_at: END,
    theme_end_at: START,
  });
  assert.equal(r.ok, false);
});

test('tắt lịch sự kiện: giữ lựa chọn nhưng xóa 2 mốc giờ', () => {
  const r = normalizeThemeSchedule({
    theme_event: 'tet_2027',
    theme_schedule_enabled: false,
    theme_start_at: START,
    theme_end_at: END,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.patch.theme_event, 'tet_2027');
    assert.equal(r.patch.theme_schedule_enabled, false);
    assert.equal(r.patch.theme_start_at, null);
    assert.equal(r.patch.theme_end_at, null);
  }
});

test('trạng thái lịch: chưa tới giờ -> upcoming, không ép giao diện', () => {
  const st = getThemeScheduleState(
    { theme_event: 'noel', theme_schedule_enabled: true, theme_start_at: START, theme_end_at: END },
    Date.parse('2026-12-19T23:59:59.000Z'),
  );
  assert.equal(st.enabled, true);
  assert.equal(st.phase, 'upcoming');
  assert.equal(st.activeTheme, null);
});

test('trạng thái lịch: trong khoảng -> active đúng sự kiện', () => {
  const st = getThemeScheduleState(
    { theme_event: 'noel', theme_schedule_enabled: true, theme_start_at: START, theme_end_at: END },
    Date.parse('2026-12-22T12:00:00.000Z'),
  );
  assert.equal(st.enabled, true);
  assert.equal(st.phase, 'active');
  assert.equal(st.activeTheme, 'noel');
});

test('trạng thái lịch: hết giờ -> expired, trả giao diện mặc định', () => {
  const st = getThemeScheduleState(
    { theme_event: 'noel', theme_schedule_enabled: true, theme_start_at: START, theme_end_at: END },
    Date.parse(END),
  );
  assert.equal(st.enabled, true);
  assert.equal(st.phase, 'expired');
  assert.equal(st.activeTheme, null);
});

test('trạng thái lịch: tắt hoặc dữ liệu hỏng -> off', () => {
  for (const input of [
    { theme_schedule_enabled: false, theme_start_at: START, theme_end_at: END },
    { theme_event: 'noel', theme_schedule_enabled: true, theme_start_at: null, theme_end_at: END },
    { theme_event: 'noel', theme_schedule_enabled: true, theme_start_at: END, theme_end_at: START },
  ]) {
    const st = getThemeScheduleState(input, Date.parse('2026-12-22T12:00:00.000Z'));
    assert.equal(st.enabled, false);
    assert.equal(st.phase, 'off');
    assert.equal(st.activeTheme, null);
  }
});
