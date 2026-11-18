import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateCleanupKey,
  candidateCleanupTick,
  getCandidateCleanupTombstones,
  isCandidateEligibleForAutoDelete,
  isCandidateInterviewHandled,
  isCandidateTombstoned,
  parseCandidateRegisteredAtMs,
} from '../src/services/candidate-cleanup.service.js';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';

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

test('chỉ hồ sơ quá 20 ngày và CHƯA được HR đặt lịch PV mới bị ẩn', () => {
  const base = { submission_id: 'CAND_0001', full_name: 'Nguyễn A', status: 'NEW' };

  assert.equal(isCandidateEligibleForAutoDelete({ ...base, created_at: daysAgoIso(21) }, NOW), true);
  assert.equal(isCandidateEligibleForAutoDelete({ ...base, created_at: daysAgoIso(19) }, NOW), false);
  // Đúng 20 ngày: tính là quá hạn (>= 20).
  assert.equal(isCandidateEligibleForAutoDelete({ ...base, created_at: daysAgoIso(20) }, NOW), true);

  // Thiếu/không đọc được ngày đăng ký -> tuyệt đối không ẩn.
  assert.equal(isCandidateEligibleForAutoDelete({ ...base }, NOW), false);
  assert.equal(isCandidateEligibleForAutoDelete({ ...base, created_at: '???' }, NOW), false);

  // Đã ẩn trước đó -> không xử lý lặp.
  assert.equal(
    isCandidateEligibleForAutoDelete({ ...base, created_at: daysAgoIso(30), auto_hidden_at: daysAgoIso(1) }, NOW),
    false,
  );

  // Đã được HR đặt lịch / phỏng vấn / chấm điểm -> giữ lại.
  for (const patch of [
    { interview_date: '2026-11-20' },
    { interview_time_slot: '08:00-09:00' },
    { interviewer_id: 'HR01' },
    { interview_score: 0 },
    { interview_score_detail: '{"total":8}' },
    { interview_proposed_date: '2026-11-21' },
    { interview_reminder_at: '2026-11-20T01:00:00.000Z' },
    { interview_decline_reason: 'Bận việc' },
    { vip: true },
    { blacklist_reason: 'Không đến PV' },
    { status: 'INVITED_INTERVIEW' },
    { status: 'CONFIRMED' },
    { status: 'SCORED' },
    { status: 'ACCEPTED' },
    { status: 'BLACKLIST' },
  ]) {
    assert.equal(
      isCandidateEligibleForAutoDelete({ ...base, created_at: daysAgoIso(30), ...patch }, NOW),
      false,
      `phải giữ hồ sơ có ${JSON.stringify(patch)}`,
    );
  }

  // Không có lịch PV -> ẩn dù trạng thái khác NEW (đúng yêu cầu "chỉ giữ người
  // đã được HR đặt lịch phỏng vấn").
  for (const status of ['NEW', 'NEED_INFO', 'DECLINED', 'REJECTED']) {
    assert.equal(
      isCandidateEligibleForAutoDelete({ ...base, created_at: daysAgoIso(30), status }, NOW),
      true,
      `trạng thái ${status} chưa có lịch PV phải được ẩn`,
    );
  }

  // Dữ liệu cột "Zalo Thư Mời" (SĐT/ghi chú) không được chặn ẩn.
  assert.equal(
    isCandidateEligibleForAutoDelete(
      { ...base, created_at: daysAgoIso(30), zalo_invite_note: '0378445598' },
      NOW,
    ),
    true,
    'ghi chú Zalo (SĐT) không được chặn tự ẩn',
  );
  assert.equal(
    isCandidateEligibleForAutoDelete(
      { ...base, created_at: daysAgoIso(30), zalo_invite_status: 'SENT' },
      NOW,
    ),
    true,
    'chỉ trạng thái đã gửi Zalo (chưa có lịch PV) vẫn được ẩn',
  );
});

test('isCandidateInterviewHandled: nhận diện hồ sơ HR đã xử lý để bỏ cờ ẩn', () => {
  assert.equal(isCandidateInterviewHandled({ status: 'NEW' }), false);
  assert.equal(isCandidateInterviewHandled({ status: 'invited_interview' }), true);
  assert.equal(isCandidateInterviewHandled({ interview_date: '2026-11-20' }), true);
  assert.equal(isCandidateInterviewHandled({ interview_score: 0 }), true);
  // Đang bị ẩn nhưng sau đó HR đặt lịch -> vẫn phải nhận là đã xử lý để gỡ ẩn.
  assert.equal(
    isCandidateInterviewHandled({ auto_hidden_at: daysAgoIso(1), interview_time_slot: '09:00-10:00' }),
    true,
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

test('candidateCleanupTick: ẩn hồ sơ quá hạn, ghi tombstone + audit, KHÔNG xoá/ghi Sheet', async () => {
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
    hideCandidatesFromSystem: async (entries: Array<{ id: string; at: string; reason?: string }>) => {
      const hidden: string[] = [];
      const failed: string[] = [];
      for (const e of entries) {
        const c = list.find(x => x.submission_id === e.id);
        if (!c) { failed.push(e.id); continue; }
        c.auto_hidden_at = e.at;
        c.auto_hidden_reason = e.reason;
        hidden.push(e.id);
      }
      return { hidden, failed };
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
  // Không xoá bản ghi: hồ sơ quá hạn vẫn còn trong kho (và trên Sheet),
  // chỉ được gắn cờ ẩn khỏi giao diện.
  assert.equal(list.length, 3);
  assert.ok(list[0].auto_hidden_at);
  assert.equal(list[1].auto_hidden_at, undefined);
  assert.equal(liveMarks[0].length, 1);
  assert.equal(pushedSettings, 1);
  // Tuyệt đối không đẩy/ghi lại tab ứng viên lên Google Sheets.
  assert.equal(pushedCandidates, 0);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'CANDIDATE_AUTO_HIDDEN');
  assert.match(String(audits[0].details), /Quá hạn/);
  assert.match(String(audits[0].details), /giữ nguyên dữ liệu trên Google Sheet/);

  const store = getCandidateCleanupTombstones(settings);
  const key = candidateCleanupKey({ phone_normalized: '0912345678', full_name: 'Quá hạn', created_at: daysAgoIso(25) });
  assert.equal(isCandidateTombstoned(store, key), true);

  // Lượt quét kế tiếp không xử lý lặp lại hồ sơ đã ẩn.
  const r2 = await candidateCleanupTick(adapter, { now: NOW + 60_000, days: 20 });
  assert.equal(r2.deletedIds.length, 0);
  assert.equal(audits.length, 1);
});

test('hồ sơ đã ẩn sẽ hiện lại khi HR thao tác (đặt lịch/chấm điểm/cập nhật)', async () => {
  const repo = new MockSheetsAdapter();
  await repo.createCandidate({
    submission_id: 'CAND_9001',
    full_name: 'Ứng viên cũ',
    phone_normalized: '0900000001',
    status: 'NEW',
    created_at: daysAgoIso(30),
    apply_position: 'Nhân viên Bán hàng',
    birth_year: 2002,
    preferred_branch_id: 'CN130',
  } as any);

  const hidden = await repo.hideCandidatesFromSystem([
    { id: 'CAND_9001', at: daysAgoIso(1), reason: 'Quá hạn' },
  ]);
  assert.deepEqual(hidden.hidden, ['CAND_9001']);
  assert.ok((repo.candidates[0] as any).auto_hidden_at);

  // HR đặt lịch PV -> updateCandidate không truyền auto_hidden_at => tự bỏ cờ ẩn.
  await repo.updateCandidate('CAND_9001', {
    status: 'INVITED_INTERVIEW',
    interview_date: '2026-11-25',
    interview_time_slot: '09:00-09:30',
  } as any);
  assert.equal((repo.candidates[0] as any).auto_hidden_at, undefined);
  assert.equal((repo.candidates[0] as any).auto_hidden_reason, undefined);
});

