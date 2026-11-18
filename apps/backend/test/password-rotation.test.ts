import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import {
  PASSWORD_WARNING_DAYS,
  adminPasswordStatus,
  adminPasswordStatusById,
  clampCycleMonths,
  computePasswordRotationStatus,
  markAdminPasswordChanged,
  readVpsPasswordMeta,
  saveVpsPasswordMeta,
  vpsPasswordStatus,
} from '../src/services/password-rotation.service.js';

const VN = '+07:00';
const ms = (iso: string) => Date.parse(iso);

test('compute: đếm ngược 6 tháng, kẹp ngày cuối tháng', () => {
  const status = computePasswordRotationStatus('2025-08-31', 'ADMIN', {
    nowMs: ms('2026-02-01T00:00:00' + VN),
  });
  assert.ok(status);
  assert.equal(status!.due_at, '2026-02-28');
  assert.equal(status!.level, 'SOON');
  assert.equal(status!.cycle_months, 6);
});

test('compute: còn xa hạn là OK, quá hạn là OVERDUE', () => {
  const ok = computePasswordRotationStatus('2026-01-10', 'ADMIN', {
    nowMs: ms('2026-03-01T00:00:00' + VN),
  })!;
  assert.equal(ok.level, 'OK');
  assert.equal(ok.due_at, '2026-07-10');

  const late = computePasswordRotationStatus('2026-01-10', 'ADMIN', {
    nowMs: ms('2026-08-01T00:00:00' + VN),
  })!;
  assert.equal(late.level, 'OVERDUE');
  assert.ok(late.ms_left < 0);
  assert.equal(late.percent, 100);
});

test('compute: cảnh báo vàng khi còn đúng ngưỡng 30 ngày', () => {
  const due = ms('2026-07-10T00:00:00' + VN);
  const at = computePasswordRotationStatus('2026-01-10', 'ADMIN', {
    nowMs: due - PASSWORD_WARNING_DAYS * 86_400_000,
  })!;
  assert.equal(at.level, 'SOON');
  const before = computePasswordRotationStatus('2026-01-10', 'ADMIN', {
    nowMs: due - (PASSWORD_WARNING_DAYS + 1) * 86_400_000,
  })!;
  assert.equal(before.level, 'OK');
});

test('compute: không có ngày hợp lệ -> null; chu kỳ bị kẹp 1..24', () => {
  assert.equal(computePasswordRotationStatus('', 'ADMIN'), null);
  assert.equal(computePasswordRotationStatus('không phải ngày', 'ADMIN'), null);
  assert.equal(clampCycleMonths(0), 1);
  assert.equal(clampCycleMonths(99), 24);
  assert.equal(clampCycleMonths(undefined), 6);
});

test('admin: chưa đổi lần nào -> lấy ngày tạo tài khoản làm mốc', async () => {
  const repo = new MockSheetsAdapter();
  const admin = (await repo.listAdminAccounts())[0];
  const now = ms('2026-03-01T00:00:00' + VN);
  const status = await adminPasswordStatus(repo, admin, now);
  assert.equal(status.scope, 'ADMIN');
  assert.equal(status.changed_at, String(admin.created_at).slice(0, 10));
  assert.equal(status.cycle_months, 6);
});

test('admin: đổi mật khẩu xong reset mốc về hôm nay (giờ VN)', async () => {
  const repo = new MockSheetsAdapter();
  const admin = (await repo.listAdminAccounts())[0];
  const nowMs = ms('2026-03-01T00:30:00' + VN); // 00:30 sáng VN = 17:30 UTC hôm trước
  await markAdminPasswordChanged(repo, admin.admin_id, new Date(nowMs), admin.admin_id);

  const status = await adminPasswordStatusById(repo, admin.admin_id, nowMs);
  assert.ok(status);
  assert.equal(status!.changed_at, '2026-03-01');
  assert.equal(status!.due_at, '2026-09-01');
  assert.equal(status!.level, 'OK');

  const settings = await repo.getSystemSettings();
  assert.equal(settings.admin_password_meta[admin.admin_id].changed_at, '2026-03-01');
});

test('vps: bắt buộc có ngày, lưu mốc và đếm ngược đúng', async () => {
  const repo = new MockSheetsAdapter();
  const now = ms('2026-04-15T09:00:00' + VN);

  assert.equal((await vpsPasswordStatus(repo, now)).level, 'UNSET');
  await assert.rejects(
    () => saveVpsPasswordMeta(repo, { cycleMonths: 6 }, 'ADM_001', now),
    /MISSING_CHANGED_AT/,
  );
  await assert.rejects(
    () => saveVpsPasswordMeta(repo, { changedAt: '31/31/2026' }, 'ADM_001', now),
    /INVALID_DATE/,
  );

  const saved = await saveVpsPasswordMeta(
    repo,
    { changedAt: '2026-04-10', cycleMonths: 6, note: 'đổi qua console' },
    'ADM_001',
    now,
  );
  assert.equal(saved.scope, 'VPS');
  assert.equal(saved.due_at, '2026-10-10');
  assert.equal(saved.note, 'đổi qua console');
  assert.equal(saved.updated_by, 'ADM_001');

  const meta = await readVpsPasswordMeta(repo);
  assert.equal(meta.changed_at, '2026-04-10');
  assert.equal(meta.cycle_months, 6);
});
