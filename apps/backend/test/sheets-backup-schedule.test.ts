import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dashboardSnapshotFromState,
  resolveDueSheetsBackups,
  sheetsBackupConfigFromEnv,
  sheetsBackupKeep,
  sheetsBackupRootId,
  type SheetsBackupConfig,
} from '../src/services/sheets-backup.service.js';

const VN_OFFSET_MS = 7 * 3_600_000;
/** Tạo mốc ms từ giờ Việt Nam. */
function vnMs(year: number, month: number, day: number, hour: number, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute) - VN_OFFSET_MS;
}

function cfg(overrides: Partial<SheetsBackupConfig> = {}): SheetsBackupConfig {
  return {
    dailyEnabled: true,
    weeklyEnabled: true,
    monthlyEnabled: true,
    atHour: 2,
    atMinute: 0,
    weeklyWeekday: 0,
    keepDaily: 30,
    keepWeekly: 12,
    keepMonthly: 36,
    retryMs: 300_000,
    ...overrides,
  };
}

function due(state: any, nowMs: number, c = cfg()) {
  return resolveDueSheetsBackups(state, nowMs, c);
}

test('sheets: không có tầng giờ', () => {
  assert.equal(due({}, vnMs(2026, 10, 15, 10, 7)).some(d => (d.kind as string) === 'hourly'), false);
});

test('sheets: 02:00 ngày 15 lưu ngày 14 (giờ VN)', () => {
  assert.equal(due({}, vnMs(2026, 10, 15, 1, 59)).some(x => x.kind === 'daily'), false);
  const d = due({}, vnMs(2026, 10, 15, 2, 0)).find(x => x.kind === 'daily');
  assert.equal(d?.slotKey, '2026-10-14');

  // 23:59 cùng ngày đã lưu ngày 14 -> không chạy lại.
  assert.equal(due({ last_daily_date: '2026-10-14' }, vnMs(2026, 10, 15, 23, 59)).some(x => x.kind === 'daily'), false);
});

test('sheets: Chủ Nhật 02:00 lưu tuần hiện tại, Thứ Hai bù nếu lỡ', () => {
  const sunday = due({}, vnMs(2026, 11, 1, 2, 0)).find(x => x.kind === 'weekly');
  assert.equal(sunday?.slotKey, '2026-W44');

  const mondayCatchup = due({}, vnMs(2026, 11, 2, 10, 0)).find(x => x.kind === 'weekly');
  assert.equal(mondayCatchup?.slotKey, '2026-W44');

  assert.equal(due({ last_weekly_key: '2026-W44' }, vnMs(2026, 11, 2, 10, 0)).some(x => x.kind === 'weekly'), false);
});

test('sheets: ngày 1 lưu tháng trước; lỡ ngày 1 thì bù', () => {
  const nov1 = due({}, vnMs(2026, 11, 1, 2, 0)).find(x => x.kind === 'monthly');
  assert.equal(nov1?.slotKey, '2026-10');

  const late = due({}, vnMs(2026, 11, 4, 10, 0)).find(x => x.kind === 'monthly');
  assert.equal(late?.slotKey, '2026-10');

  assert.equal(due({ last_monthly_key: '2026-10' }, vnMs(2026, 11, 4, 10, 0)).some(x => x.kind === 'monthly'), false);
});

test('sheets: cấu hình env + giữ đúng số kỳ', () => {
  const c = sheetsBackupConfigFromEnv({
    BACKUP_DAILY_ENABLED: '0',
    BACKUP_DAILY_HOUR: '3',
    BACKUP_AT_MINUTE: '30',
    BACKUP_KEEP_DAILY_DAYS: '10',
  } as any);
  assert.equal(c.dailyEnabled, false);
  assert.equal(c.atHour, 3);
  assert.equal(c.atMinute, 30);
  assert.equal(sheetsBackupKeep('daily', c), 10);
  assert.equal(sheetsBackupKeep('weekly', c), 12);
  assert.equal(sheetsBackupKeep('monthly', c), 36);
});

test('sheets: tóm tắt dashboard lấy từ state file (giờ VN)', () => {
  // Chạy 02:00 ngày 02/11 VN (= 19:00Z ngày 01/11) cho dữ liệu ngày 01/11.
  const state: any = {
    last_daily_date: '2026-11-01',
    last_ok_at: '2026-11-01T19:00:30.000Z',
    last_result: {
      daily: {
        kind: 'daily',
        ok: true,
        slotKey: '2026-11-01',
        at: '2026-11-01T19:00:30.000Z',
        name: 'UMB_NHANSU_2026-11-01.zip',
        fileId: 'ZIP1',
        folderId: 'FOLDER1',
        folderUrl: 'https://drive.google.com/drive/folders/FOLDER1',
        url: 'https://drive.google.com/file/d/ZIP1/view',
        total: 25,
        exported: 25,
        existing: false,
        sizeBytes: 8388608,
        errors: [],
        deletedOld: 2,
        error: null,
        durationMs: 5000,
      },
    },
  };
  const s = dashboardSnapshotFromState(state);
  assert.equal(s.last_backup_date, '2026-11-02');
  assert.equal(s.last_slot, '2026-11-01');
  assert.equal(s.last_file_id, 'ZIP1');
  assert.equal(s.last_folder_id, 'FOLDER1');
  assert.equal(s.last_url, 'https://drive.google.com/file/d/ZIP1/view');
  assert.equal(s.last_files, 25);
  assert.equal(s.last_size_bytes, 8388608);
  assert.equal(s.last_deleted_old, 2);
  assert.equal(s.last_error, null);

  // Chưa có bản ngày -> không bịa trạng thái.
  assert.equal(dashboardSnapshotFromState({}), null);

  // Lỗi -> giữ mốc lần chạy cuối + ghi lỗi.
  const failed = dashboardSnapshotFromState({
    last_ok_at: '2026-11-01T19:00:30.000Z',
    last_result: {
      daily: {
        kind: 'daily', ok: false, slotKey: '2026-11-02', at: '2026-11-02T19:00:00.000Z',
        name: 'UMB_NHANSU_DATABASE_2026-11-02', fileId: null, folderId: null,
        deletedOld: 0, error: 'DRIVE_ERROR', durationMs: 100,
      },
    },
  });
  assert.equal(failed.last_ok_at, '2026-11-01T19:00:30.000Z');
  assert.equal(failed.last_error, 'DRIVE_ERROR');
});

test('sheets: thư mục gốc trỏ đúng 01/02/03', () => {
  const keys = [
    'GOOGLE_DRIVE_BACKUP_DAY_FOLDER_ID',
    'GOOGLE_DRIVE_BACKUP_WEEK_FOLDER_ID',
    'GOOGLE_DRIVE_BACKUP_MONTH_FOLDER_ID',
  ] as const;
  const saved = keys.map(k => process.env[k]);
  for (const k of keys) delete process.env[k];
  try {
    assert.equal(sheetsBackupRootId('daily'), '1GaPSvNcbINMtG90aQ-KzL2SPLxUG9JkG');
    assert.equal(sheetsBackupRootId('weekly'), '1MoVP66cmDcFLg5Du0WhoQwF9rECqr8z0');
    assert.equal(sheetsBackupRootId('monthly'), '1fBz9Szu6qCiV086YyxNBSGcjRPXKFddJ');
  } finally {
    keys.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
  }
});
