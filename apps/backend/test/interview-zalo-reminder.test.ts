import test from 'node:test';
import assert from 'node:assert/strict';
import { interviewZaloReminderTick } from '../src/services/interview-zalo-reminder.service.js';

/**
 * Nhắc Zalo lịch PV chống spam:
 *  - tối đa 3 lần cho mỗi lịch,
 *  - mỗi lần cách nhau ít nhất 15 phút,
 *  - ứng viên đã xác nhận/từ chối thì dừng ngay.
 */

const INTERVIEW_START = new Date('2026-11-12T10:00:00+07:00').getTime();
const MINUTE = 60_000;

function makeCandidate(overrides: any = {}) {
  return {
    submission_id: 'CAND_0001',
    full_name: 'Ứng viên A',
    phone_normalized: '0901234567',
    status: 'INVITED_INTERVIEW',
    interview_date: '2026-11-12',
    interview_time_slot: '10:00',
    branch_name: 'CN130',
    ...overrides,
  } as any;
}

function makeRepo(candidate: any) {
  const patches: any[] = [];
  const repo = {
    listCandidates: async () => [candidate],
    getBranches: async () => [],
    updateCandidate: async (_id: string, patch: any) => {
      patches.push(patch);
      Object.assign(candidate, patch);
      return candidate;
    },
  } as any;
  return { repo, patches };
}

function makeZalo() {
  const sent: Array<{ uid: string; text: string }> = [];
  const zalo = {
    isConnected: () => true,
    findUserByPhone: async () => ({ uid: 'uid_1' }),
    sendText: async (uid: string, text: string) => {
      sent.push({ uid, text });
      return { msgId: `msg_${sent.length}` };
    },
  } as any;
  return { zalo, sent };
}

const buildRsvpUrl = (sid: string) => `https://example.test/rsvp?token=${sid}`;

test('chỉ nhắc tối đa 3 lần, mỗi lần cách nhau 15 phút', async () => {
  const candidate = makeCandidate();
  const { repo } = makeRepo(candidate);
  const { zalo, sent } = makeZalo();

  const tickAt = (nowMs: number) =>
    interviewZaloReminderTick(repo, zalo, { buildRsvpUrl, nowMs });

  // T-40: lần 1.
  assert.equal((await tickAt(INTERVIEW_START - 40 * MINUTE)).sent.length, 1);
  // T-26 (mới 14 phút): chưa được nhắc lại.
  assert.equal((await tickAt(INTERVIEW_START - 26 * MINUTE)).sent.length, 0);
  // T-25 (đủ 15 phút): lần 2.
  assert.equal((await tickAt(INTERVIEW_START - 25 * MINUTE)).sent.length, 1);
  // T-11 (mới 14 phút): chưa nhắc.
  assert.equal((await tickAt(INTERVIEW_START - 11 * MINUTE)).sent.length, 0);
  // T-10 (đủ 15 phút): lần 3.
  assert.equal((await tickAt(INTERVIEW_START - 10 * MINUTE)).sent.length, 1);
  // T-5: đã đủ 3 lần, không nhắc nữa.
  assert.equal((await tickAt(INTERVIEW_START - 5 * MINUTE)).sent.length, 0);

  assert.equal(sent.length, 3);
  assert.equal(candidate.interview_reminder_count, 3);
  assert.equal(candidate.interview_reminder_key, '2026-11-12|10:00');
});

test('ứng viên xác nhận sau lần nhắc đầu -> không nhắc tiếp', async () => {
  const candidate = makeCandidate();
  const { repo } = makeRepo(candidate);
  const { zalo, sent } = makeZalo();

  const first = await interviewZaloReminderTick(repo, zalo, {
    buildRsvpUrl,
    nowMs: INTERVIEW_START - 40 * MINUTE,
  });
  assert.equal(first.sent.length, 1);

  candidate.status = 'CONFIRMED';
  const later = await interviewZaloReminderTick(repo, zalo, {
    buildRsvpUrl,
    nowMs: INTERVIEW_START - 20 * MINUTE,
  });
  assert.equal(later.sent.length, 0);
  assert.equal(sent.length, 1);
});

test('ứng viên từ chối sau lần nhắc đầu -> không nhắc tiếp', async () => {
  const candidate = makeCandidate();
  const { repo } = makeRepo(candidate);
  const { zalo, sent } = makeZalo();

  await interviewZaloReminderTick(repo, zalo, {
    buildRsvpUrl,
    nowMs: INTERVIEW_START - 40 * MINUTE,
  });
  assert.equal(sent.length, 1);

  candidate.status = 'DECLINED';
  await interviewZaloReminderTick(repo, zalo, {
    buildRsvpUrl,
    nowMs: INTERVIEW_START - 20 * MINUTE,
  });
  assert.equal(sent.length, 1);
});

test('ứng viên đã xác nhận/từ chối trước lần nhắc đầu -> không gửi', async () => {
  for (const status of ['CONFIRMED', 'DECLINED', 'RESCHEDULE_PROPOSED', 'RESCHEDULE_REQUESTED']) {
    const candidate = makeCandidate({ status });
    const { repo } = makeRepo(candidate);
    const { zalo, sent } = makeZalo();
    const res = await interviewZaloReminderTick(repo, zalo, {
      buildRsvpUrl,
      nowMs: INTERVIEW_START - 40 * MINUTE,
    });
    assert.equal(res.sent.length, 0, `không được nhắc khi trạng thái ${status}`);
    assert.equal(sent.length, 0);
  }
});

test('đổi lịch -> đếm lại từ đầu cho lịch mới', async () => {
  const candidate = makeCandidate();
  const { repo } = makeRepo(candidate);
  const { zalo, sent } = makeZalo();

  for (const minutes of [40, 25, 10]) {
    await interviewZaloReminderTick(repo, zalo, {
      buildRsvpUrl,
      nowMs: INTERVIEW_START - minutes * MINUTE,
    });
  }
  assert.equal(sent.length, 3);

  // Dời sang 11:00 cùng ngày, mốc nhắc mới đủ 45 phút.
  candidate.interview_time_slot = '11:00';
  const newStart = new Date('2026-11-12T11:00:00+07:00').getTime();
  const res = await interviewZaloReminderTick(repo, zalo, {
    buildRsvpUrl,
    nowMs: newStart - 40 * MINUTE,
  });
  assert.equal(res.sent.length, 1);
  assert.equal(candidate.interview_reminder_key, '2026-11-12|11:00');
  assert.equal(candidate.interview_reminder_count, 1);
});

test('chưa đến cửa sổ nhắc (< 45 phút) thì không gửi', async () => {
  const candidate = makeCandidate();
  const { repo } = makeRepo(candidate);
  const { zalo, sent } = makeZalo();
  const res = await interviewZaloReminderTick(repo, zalo, {
    buildRsvpUrl,
    nowMs: INTERVIEW_START - 50 * MINUTE,
  });
  assert.equal(res.sent.length, 0);
  assert.equal(sent.length, 0);
});
