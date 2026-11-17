import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateCleanupKey,
  candidateCleanupTick,
  getCandidateCleanupTombstones,
  isCandidateEligibleForAutoDelete,
  isCandidateTombstoned,
  parseCandidateRegisteredAtMs,
} from '../src/services/candidate-cleanup.service.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 17, 0, 0, 0); // 17/11/2026 00:00 UTC
const daysAgoIso = (n: number) => new Date(NOW - n * DAY).toISOString();

test('parseCandidateRegisteredAtMs: hiểu giờ VN dd/MM/yyyy, ISO và serial Sheets', () => {
  assert.equal(
    parseCandidateRegisteredAtMs('01/11/2026 10:00:00'),
    Date.UTC(2026, 10, 1, 3, 0, 0),
  );
  assert.equal(
    parseCandidateRegisteredAtMs('2026-11-01T03:00:00.000Z'),
    Date.UTC(2026, 10, 1, 3, 0, 0),
  );
  // Serial 46305.5 = 10/10/2026 12:00 UTC (không phụ thuộc locale máy chủ).
  assert.equal(
    parseCandidateRegisteredAtMs('46305.5'),
    Date.UTC(2026, 9, 10, 12, 0, 0),
  );
  assert.equal(parseCandidateRegisteredAtMs(''), null);
  assert.equal(parseCandidateRegisteredAtMs('không phải ngày'), null);
});

test('chỉ hồ sơ NEW quá 20 ngày, chưa có lịch/chăm sóc mới bị xoá', () => {
  const base = { submission_id: 'CAND_0001', full_name: 'Nguyễn A', status: 'NEW' };

  assert.equal(isCandidateEligibleForAutoDelete({ ...base, created_at: daysAgoIso(21) }, NOW), true);
  assert.equal(isCandidateEligibleForAutoDelete({ ...base, created_at: daysAgoIso(19) }, NOW), false);
  // Đúng 20 ngày: tính là quá hạn (>= 20).
  assert.equal(isCandidateEligibleForAutoDelete({ ...base, created_at: daysAgoIso(20) }, NOW), true);

  // Thiếu/không đọc được ngày đăng ký -> tuyệt đối không xoá.
  assert.equal(isCandidateEligibleForAutoDelete({ ...base }, NOW), false);
  assert.equal(isCandidateEligibleForAutoDelete({ ...base, created_at: '???' }, NOW), false);

  // Đã lên lịch / đã chăm sóc / trạng thái khác NEW -> giữ lại.
  for (const patch of [
    { interview_date: '2026-11-20' },
    { interview_time_slot: '08:00-09:00' },
    { interview_score: 0 },
    { interview_score_detail: '{"total":8}' },
    { interview_proposed_date: '2026-11-21' },
    { zalo_invite_at: '2026-11-01T02:00:00.000Z' },
    { zalo_invite_status: 'SENT' },
    { interview_decline_reason: 'Bận việc' },
    { vip: true },
    { status: 'CONFIRMED' },
    { status: 'REJECTED' },
  ]) {
    assert.equal(
      isCandidateEligibleForAutoDelete({ ...base, created_at: daysAgoIso(30), ...patch }, NOW),
      false,
      `phải giữ hồ sơ có ${JSON.stringify(patch)}`,
    );
  }

  // HỒI QUY production: cột "Zalo Thư Mời" trên form chứa SĐT nên bị map thành
  // zalo_invite_note. Ghi chú này KHÔNG được chặn tự xoá (nếu chặn, 143 hồ sơ
  // quá hạn NEW bị giữ oan và tính năng không bao giờ chạy).
  assert.equal(
    isCandidateEligibleForAutoDelete(
      { ...base, created_at: daysAgoIso(30), zalo_invite_note: '0378445598' },
      NOW,
    ),
    true,
    'ghi chú Zalo (SĐT) không được chặn tự xoá',
  );
  assert.equal(
    isCandidateEligibleForAutoDelete(
      { ...base, created_at: daysAgoIso(30), zalo_invite_error: 'invalid phone' },
      NOW,
    ),
    true,
    'lỗi Zalo không được chặn tự xoá',
  );
});

test('khoá tombstone ổn định giữa giờ VN và ISO + chặn hồ sơ đã xoá', () => {
  const a = candidateCleanupKey({
    submission_id: 'CAND_0001',
    phone: '+84 912 345 678',
    full_name: 'Nguyễn  Văn A',
    created_at: '01/11/2026 10:00:00',
  });
  const b = candidateCleanupKey({
    submission_id: 'CAND_0001',
    phone_normalized: '0912345678',
    full_name: 'nguyễn văn a',
    created_at: '2026-11-01T03:00:00.000Z',
  });
  assert.equal(a, b);

  const store = getCandidateCleanupTombstones({
    candidateAutoDeleteTombstones: {
      updated_at: '2026-11-17T00:00:00.000Z',
      entries: { [a]: { key: a, deleted_at: '2026-11-17T00:00:00.000Z', reason: 'test' } },
    },
  });
  assert.equal(isCandidateTombstoned(store, b), true);
  assert.equal(isCandidateTombstoned(store, '0912345678|người khác|'), false);
});

test('candidateCleanupTick: xoá lô, ghi tombstone + audit, không đụng hồ sơ đã xếp lịch', async () => {
  let list: any[] = [
    { submission_id: 'CAND_0001', full_name: 'Quá hạn', phone_normalized: '0912345678', status: 'NEW', created_at: daysAgoIso(25) },
    { submission_id: 'CAND_0002', full_name: 'Đã có lịch', phone_normalized: '0912345679', status: 'NEW', created_at: daysAgoIso(25), interview_date: '2026-11-20' },
    { submission_id: 'CAND_0003', full_name: 'Mới đăng ký', phone_normalized: '0912345680', status: 'NEW', created_at: daysAgoIso(5) },
  ];
  let settings: any = {};
  const audits: any[] = [];
  const liveMarks: string[][] = [];
  let pushedSettings = 0;
  let pushedCandidates = 0;

  const adapter: any = {
    syncService: {
      markCandidateDeleted: (keys: string[]) => liveMarks.push(keys),
      unmarkCandidateDeleted: () => undefined,
    },
    listCandidates: async () => list.map(c => ({ ...c })),
    deleteCandidatesBatch: async (ids: string[]) => {
      const wanted = new Set(ids);
      list = list.filter(c => !wanted.has(c.submission_id));
      return { deleted: ids.filter(id => wanted.has(id)), failed: [] };
    },
    getSystemSettings: async () => settings,
    updateSystemSettings: async (patch: any) => { settings = { ...settings, ...patch }; return settings; },
    pushSystemSettingsNow: async () => { pushedSettings++; return { ok: true }; },
    recordAuditLog: async (entry: any) => { audits.push(entry); return entry; },
    pushCandidatesNow: async () => { pushedCandidates++; return 1; },
  };

  const r = await candidateCleanupTick(adapter, { now: NOW, days: 20 });
  assert.deepEqual(r.deletedIds, ['CAND_0001']);
  assert.equal(r.failedIds.length, 0);
  assert.equal(list.length, 2);
  assert.equal(liveMarks[0].length, 1);
  assert.equal(pushedSettings, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'CANDIDATE_AUTO_DELETED');
  assert.match(String(audits[0].details), /Quá hạn/);

  const store = getCandidateCleanupTombstones(settings);
  const key = candidateCleanupKey({ phone_normalized: '0912345678', full_name: 'Quá hạn', created_at: daysAgoIso(25) });
  assert.equal(isCandidateTombstoned(store, key), true);
  assert.ok(pushedCandidates >= 0);
});

