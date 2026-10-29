import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleSheetsAdapter } from '../src/repositories/google-sheets.adapter.js';

function adapter(): GoogleSheetsAdapter {
  return new GoogleSheetsAdapter();
}

test('self-write: chỉ chặn realtime cho ĐÚNG tab vừa ghi, không che tab khác', () => {
  const a = adapter();
  a.noteOwnWrite('schedules');

  assert.equal(a.isSelfWriteRecent(12_000, ['PHAN_CONG_CA']), true);
  assert.equal(
    a.isSelfWriteRecent(12_000, ['FROM_NHAN_VIEN']), false,
    'sửa tay lịch PV trên tab khác KHÔNG được bị coi là write của hệ thống',
  );
  assert.equal(
    a.isSelfWriteRecent(12_000, ['PHAN_CONG_CA', 'FROM_NHAN_VIEN']), false,
    'chỉ cần 1 tab lạ là phải bắn realtime',
  );
});

test('self-write: entity không rõ (all) giữ hành vi chặn toàn cục', () => {
  const a = adapter();
  a.noteOwnWrite('all');
  assert.equal(a.isSelfWriteRecent(12_000, ['FROM_NHAN_VIEN']), true);
  assert.equal(a.isSelfWriteRecent(12_000, ['PHAN_CONG_CA']), true);
});

test('self-write: khớp cả tab part (SU_KIEN_DIEM_DANH_P2)', () => {
  const a = adapter();
  a.noteOwnWrite('attendance');
  assert.equal(a.isSelfWriteRecent(12_000, ['SU_KIEN_DIEM_DANH_P2']), true);
  assert.equal(a.isSelfWriteRecent(12_000, ['SU_KIEN_DIEM_DANH']), true);
  assert.equal(a.isSelfWriteRecent(12_000, ['DON_NGHI_PHEP']), false);
});

test('self-write: hết cửa sổ thời gian thì không chặn nữa', () => {
  const a = adapter();
  a.noteOwnWrite('candidates');
  assert.equal(a.isSelfWriteRecent(12_000, ['FROM_NHAN_VIEN']), true);
  assert.equal(a.isSelfWriteRecent(0, ['FROM_NHAN_VIEN']), false);
});

test('freshness gate: lượt đọc lịch/công/ứng viên chờ pull đầu sau snapshot', async () => {
  const a = adapter();
  (a as any).isConfigured = true;
  (a as any).restoredFromSnapshot = true;
  (a as any).snapshotRestoredAtMs = 1_000;
  let resolvePull: ((value: unknown) => void) | null = null;
  (a as any).syncService = {
    getLastFullPullAtMs: () => 0,
    pullAllDataFromGoogleSheets: () => new Promise(resolve => { resolvePull = resolve; }),
  };

  assert.equal((a as any).shouldWaitFirstPull(), true, 'snapshot cũ -> phải chờ');

  let settled = false;
  const waiting = (a as any).ensureFreshData({ waitFirstPull: true }).then(() => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(settled, false, 'chưa pull xong thì chưa trả dữ liệu cũ');

  (resolvePull as any)({ counts: { employees: 1 } });
  await waiting;
  assert.equal(settled, true);
  assert.equal((a as any).firstPullAfterRestoreDone, true, 'pull xong -> không chờ nữa');
});

test('freshness gate: pull TOÀN BỘ nền đã xong sau snapshot thì không chờ/pull lại', async () => {
  const a = adapter();
  (a as any).isConfigured = true;
  (a as any).restoredFromSnapshot = true;
  (a as any).snapshotRestoredAtMs = 1_000;
  (a as any).lastPullTime = Date.now();
  let pulls = 0;
  (a as any).syncService = {
    getLastFullPullAtMs: () => 5_000,
    pullAllDataFromGoogleSheets: () => { pulls += 1; return Promise.resolve({ counts: {} }); },
  };

  assert.equal((a as any).shouldWaitFirstPull(), false);
  await (a as any).ensureFreshData({ waitFirstPull: true });
  assert.equal(pulls, 0, 'không pull đúp, không chặn request');
  assert.equal((a as any).firstPullAfterRestoreDone, true);
});
