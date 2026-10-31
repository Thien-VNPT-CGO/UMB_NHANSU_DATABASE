import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backupConfigFromEnv,
  isoWeekOf,
  resolveDueBackups,
  type BackupScheduleConfig,
  type BackupScheduleState,
} from '../src/services/backup-drive.service.js';

const VN_OFFSET_MS = 7 * 3_600_000;
/** Tạo mốc ms từ giờ Việt Nam. */
function vnMs(year: number, month: number, day: number, hour: number, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute) - VN_OFFSET_MS;
}

function cfg(overrides: Partial<BackupScheduleConfig> = {}): BackupScheduleConfig {
  return {
    hourlyEnabled: true,
    hourlyMinutes: 15,
    dailyEnabled: true,
    dailyHour: 2,
    weeklyEnabled: true,
    weeklyWeekday: 0,
    monthlyEnabled: true,
    atMinute: 0,
    hourlyExcludeTables: [],
    hourlyKeepHours: 48,
    dailyKeepDays: 30,
    weeklyKeepWeeks: 12,
    monthlyKeepMonths: 36,
    retryMs: 300_000,
    ...overrides,
  };
}

function kinds(state: BackupScheduleState, nowMs: number, c = cfg()): string[] {
  return resolveDueBackups(state, nowMs, c).map(d => d.kind);
}

test('giờ: chạy theo mốc 15 phút và không chạy trùng trong cùng mốc', () => {
  const c = cfg();
  const t = vnMs(2026, 10, 15, 10, 7);
  const due = resolveDueBackups({}, t, c);
  const hourly = due.find(d => d.kind === 'hourly');
  assert.ok(hourly);
  assert.equal(hourly.slotKey, '2026-10-15T10:00');
  assert.equal(hourly.target.fileName, 'postgres_2026-10-15_1000.jsonl.gz');
  assert.deepEqual(hourly.target.segments, ['HOURLY', '2026-10-15']);

  // Cùng mốc 10:00 -> không chạy lại.
  assert.equal(kinds({ last_hourly_slot: '2026-10-15T10:00' }, vnMs(2026, 10, 15, 10, 14), c).includes('hourly'), false);

  // Sang mốc 10:15 -> chạy.
  const next = resolveDueBackups({ last_hourly_slot: '2026-10-15T10:00' }, vnMs(2026, 10, 15, 10, 16), c)
    .find(d => d.kind === 'hourly');
  assert.equal(next?.slotKey, '2026-10-15T10:15');
});

test('giờ: đổi số phút qua env, kẹp trong khoảng 5..60', () => {
  assert.equal(backupConfigFromEnv({ BACKUP_HOURLY_MINUTES: '30' } as any).hourlyMinutes, 30);
  assert.equal(backupConfigFromEnv({ BACKUP_HOURLY_MINUTES: '1' } as any).hourlyMinutes, 5);
  assert.equal(backupConfigFromEnv({ BACKUP_HOURLY_MINUTES: '120' } as any).hourlyMinutes, 60);
  assert.equal(backupConfigFromEnv({ BACKUP_HOURLY_ENABLED: '0' } as any).hourlyEnabled, false);
});

test('ngày: chỉ chạy từ 02:00 và đúng 1 lần/ngày', () => {
  const c = cfg();
  assert.equal(kinds({}, vnMs(2026, 10, 15, 1, 59), c).includes('daily'), false);
  const at2 = resolveDueBackups({}, vnMs(2026, 10, 15, 2, 0), c).find(d => d.kind === 'daily');
  assert.equal(at2?.slotKey, '2026-10-15');
  assert.equal(at2?.target.fileName, 'postgres_2026-10-15.jsonl.gz');
  assert.deepEqual(at2?.target.segments, ['DAILY', '2026-10-15']);

  assert.equal(kinds({ last_daily_date: '2026-10-15' }, vnMs(2026, 10, 15, 23, 59), c).includes('daily'), false);
  assert.equal(kinds({ last_daily_date: '2026-10-15' }, vnMs(2026, 10, 16, 2, 1), c).includes('daily'), true);
});

test('tuần: chỉ chạy đúng Chủ Nhật từ 02:00', () => {
  const c = cfg();
  // 2026-11-01 là Chủ Nhật. 01:00 chưa tới mốc -> chưa chạy.
  assert.equal(kinds({}, vnMs(2026, 11, 1, 1, 0), c).includes('weekly'), false);

  const at2 = resolveDueBackups({}, vnMs(2026, 11, 1, 2, 0), c).find(d => d.kind === 'weekly');
  assert.equal(at2?.slotKey, '2026-W44');
  assert.deepEqual(at2?.target.segments, ['WEEKLY', '2026-W44']);
  assert.equal(at2?.target.rootId, '1MoVP66cmDcFLg5Du0WhoQwF9rECqr8z0');

  // Đã chạy W44 thì thứ Hai không chạy lại; thứ Hai cũng không phải ngày chạy.
  assert.equal(kinds({ last_weekly_key: '2026-W44' }, vnMs(2026, 11, 2, 10, 0), c).includes('weekly'), false);
  assert.equal(kinds({}, vnMs(2026, 11, 2, 10, 0), c).includes('weekly'), false);

  // Chủ Nhật chạy muộn trong ngày (VPS bật lại 10:00) vẫn chạy bù đúng tuần.
  const late = resolveDueBackups({}, vnMs(2026, 11, 1, 10, 0), c).find(d => d.kind === 'weekly');
  assert.equal(late?.slotKey, '2026-W44');
});

test('tuần: isoWeekOf xử lý đúng ranh giới năm', () => {
  // month 0-based (giống vnParts): 0 = tháng 1, 9 = tháng 10, 11 = tháng 12.
  assert.deepEqual(isoWeekOf({ year: 2026, month: 0, day: 1 }), { year: 2026, week: 1 });
  assert.deepEqual(isoWeekOf({ year: 2026, month: 9, day: 31 }), { year: 2026, week: 44 });
  assert.deepEqual(isoWeekOf({ year: 2026, month: 11, day: 31 }), { year: 2026, week: 53 });
});

test('tháng: chỉ chạy ngày cuối tháng từ 02:00', () => {
  const c = cfg();
  assert.equal(kinds({}, vnMs(2026, 10, 31, 1, 59), c).includes('monthly'), false);

  const at2 = resolveDueBackups({}, vnMs(2026, 10, 31, 2, 0), c).find(d => d.kind === 'monthly');
  assert.equal(at2?.slotKey, '2026-10');
  assert.equal(at2?.target.fileName, 'postgres_2026-10.jsonl.gz');
  assert.deepEqual(at2?.target.segments, ['MONTHLY', '2026-10']);
  assert.equal(at2?.target.rootId, '1fBz9Szu6qCiV086YyxNBSGcjRPXKFddJ');

  // Ngày 30 chưa phải cuối tháng -> không chạy.
  assert.equal(kinds({}, vnMs(2026, 10, 30, 10, 0), c).includes('monthly'), false);

  // Tháng 2 năm nhuận: 29/02 là cuối tháng.
  const leap = resolveDueBackups({}, vnMs(2028, 2, 29, 2, 0), c).find(d => d.kind === 'monthly');
  assert.equal(leap?.slotKey, '2028-02');

  // Đã chạy tháng 10 thì 31/10 23:00 không chạy lại.
  assert.equal(kinds({ last_monthly_key: '2026-10' }, vnMs(2026, 10, 31, 23, 0), c).includes('monthly'), false);
});

test('ưu tiên tháng > tuần > ngày > giờ khi cùng tới hạn', () => {
  const c = cfg();
  // 2026-11-01 02:00 Chủ Nhật — vừa cuối tuần, vừa qua 02:00 ngày, vừa mốc giờ.
  const due = resolveDueBackups({ last_monthly_key: '2026-10' }, vnMs(2026, 11, 1, 2, 0), c);
  assert.deepEqual(due.map(d => d.kind), ['weekly', 'daily', 'hourly']);
});

test('tắt từng tầng bằng env', () => {
  const c = backupConfigFromEnv({
    BACKUP_HOURLY_ENABLED: '0',
    BACKUP_DAILY_ENABLED: '0',
    BACKUP_WEEKLY_ENABLED: '0',
    BACKUP_MONTHLY_ENABLED: '0',
  } as any);
  assert.deepEqual(resolveDueBackups({}, vnMs(2026, 11, 1, 2, 0), c), []);
});
