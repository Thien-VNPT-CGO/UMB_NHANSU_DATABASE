import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { NotificationsService } from '../src/services/notifications.service.js';
import { ZaloService } from '../src/services/zalo.service.js';
import {
  autoRemindersTick,
  parseShiftStart,
  resolveShiftInfo,
} from '../src/services/auto-reminders.service.js';

const VN_OFFSET = 7 * 3_600_000;

function vnToday(ms: number = Date.now()): string {
  return new Date(ms + VN_OFFSET).toISOString().slice(0, 10);
}

/** ISO giờ Việt Nam (+07:00) từ một mốc epoch. */
function vnIso(ms: number): string {
  return `${new Date(ms + VN_OFFSET).toISOString().slice(0, 19)}+07:00`;
}

async function makeEmployee(
  repo: MockSheetsAdapter,
  data: { id: string; group: string; branch: string; status?: string },
) {
  await repo.createEmployee({
    employee_id: data.id,
    employee_code: `UBM_${data.id}`,
    full_name: `Nhân viên ${data.id}`,
    phone_normalized: '0900000000',
    employment_status: data.status || 'OFFICIAL',
    employment_type: data.status || 'OFFICIAL',
    group: data.group,
    default_branch_id: data.branch,
    default_shift_code: 'CA_1',
    current_rate_per_hour: 30000,
    start_date: '2020-01-01',
  } as any);
}

function pushShift(
  repo: MockSheetsAdapter,
  shift: {
    id: string;
    employeeId: string;
    branch: string;
    date: string;
    startMs: number;
    shiftCode?: string;
  },
) {
  const startAt = vnIso(shift.startMs);
  repo.shifts.push({
    assignment_id: shift.id,
    employee_id: shift.employeeId,
    branch_id: shift.branch,
    shift_code: shift.shiftCode || 'CA_1',
    date: shift.date,
    start_at: startAt,
    end_at: vnIso(shift.startMs + 4 * 3_600_000),
    status: 'PUBLISHED',
    schedule_version: 1,
  } as any);
}

test('parseShiftStart ưu tiên start_at thật (ca Văn Phòng CA_1 nhưng vào ca 08:00)', () => {
  const at = '2026-11-18T08:00:00+07:00';
  assert.equal(parseShiftStart('2026-11-18', at, 'CA_1'), Date.parse(at));
  // Ca cũ không có start_at -> fallback theo mã ca (07:00 giờ VN).
  assert.equal(parseShiftStart('2026-11-18', undefined, 'CA_1'), Date.parse('2026-11-18T07:00:00+07:00'));
});

test('resolveShiftInfo hiển thị đúng lịch hành chính cho khối Văn Phòng', () => {
  const startMs = Date.parse('2026-11-18T08:00:00+07:00');
  const info = resolveShiftInfo('CA_1', startMs, { isOffice: true, date: '2026-11-18' });
  assert.equal(info.start, '08:00');
  assert.match(info.name, /08:00 – 17:00/);

  const thu7 = resolveShiftInfo('CA_1', Date.parse('2026-11-21T08:00:00+07:00'), {
    isOffice: true,
    date: '2026-11-21',
  });
  assert.match(thu7.name, /08:00 – 12:00/);
});

test('Cửa hàng: nhắc đúng 1 lần cho mỗi ca (2 ca = 2 thông báo) và không gửi lặp', async () => {
  const repo = new MockSheetsAdapter();
  const notifications = new NotificationsService(repo);
  const zalo = new ZaloService(repo);
  const now = Date.now();
  const today = vnToday(now);

  await makeEmployee(repo, { id: 'EMP_STORE_A', group: 'STORE', branch: 'CN130' });
  pushShift(repo, { id: 'S1', employeeId: 'EMP_STORE_A', branch: 'CN130', date: today, startMs: now + 10 * 60_000, shiftCode: 'CA_1' });
  pushShift(repo, { id: 'S2', employeeId: 'EMP_STORE_A', branch: 'CN130', date: today, startMs: now + 15 * 60_000, shiftCode: 'CA_2' });

  const first = await autoRemindersTick(repo, notifications, zalo);
  assert.equal(first.checkinsSent, 2, 'mỗi ca phải có 1 thông báo');

  const inbox = await repo.getInboxForRecipient('EMP_STORE_A');
  const reminders = inbox.filter((n: any) => n.type === 'CHECKIN_REMINDER');
  assert.equal(reminders.length, 2);
  for (const n of reminders) {
    assert.match(n.title, /CN1/);
    assert.equal(n.target_path, '/attendance');
  }

  // Tick kế tiếp trong cùng khung giờ: không gửi lặp.
  const second = await autoRemindersTick(repo, notifications, zalo);
  assert.equal(second.checkinsSent, 0);
  const after = (await repo.getInboxForRecipient('EMP_STORE_A'))
    .filter((n: any) => n.type === 'CHECKIN_REMINDER');
  assert.equal(after.length, 2);
});

test('Văn Phòng: nhắc theo lịch hành chính, mỗi NV 1 lần (kể cả khi chưa sinh ca)', async () => {
  const repo = new MockSheetsAdapter();
  const notifications = new NotificationsService(repo);
  const zalo = new ZaloService(repo);
  const now = Date.now();
  const today = vnToday(now);

  await makeEmployee(repo, { id: 'EMP_OFFICE_A', group: 'VAN_PHONG', branch: 'VAN_PHONG' });
  await makeEmployee(repo, { id: 'EMP_OFFICE_B', group: 'VAN_PHONG', branch: 'VAN_PHONG' });
  // A có ca tự sinh, B chưa có ca -> cả 2 vẫn phải được nhắc theo lịch hành chính.
  pushShift(repo, { id: 'SO1', employeeId: 'EMP_OFFICE_A', branch: 'VAN_PHONG', date: today, startMs: Date.parse(`${today}T08:00:00+07:00`) });

  // forceCheckin: bỏ qua khung 08:00–08:30 để test chạy được mọi thời điểm.
  const result = await autoRemindersTick(repo, notifications, zalo, { forceCheckin: true });
  assert.equal(result.checkinsSent, 2);

  const a = (await repo.getInboxForRecipient('EMP_OFFICE_A'))
    .filter((n: any) => n.type === 'CHECKIN_REMINDER');
  assert.equal(a.length, 1, 'có ca tự sinh vẫn chỉ 1 thông báo');
  assert.match(a[0].title, /Nhắc điểm danh/);
  assert.match(a[0].summary, /08:00/);
  assert.match(a[0].summary, /Văn Phòng|VAN_PHONG/);

  const b = (await repo.getInboxForRecipient('EMP_OFFICE_B'))
    .filter((n: any) => n.type === 'CHECKIN_REMINDER');
  assert.equal(b.length, 1);
});

test('NV nghỉ việc không bị nhắc dù còn sót ca', async () => {
  const repo = new MockSheetsAdapter();
  const notifications = new NotificationsService(repo);
  const zalo = new ZaloService(repo);
  const now = Date.now();
  const today = vnToday(now);

  await makeEmployee(repo, { id: 'EMP_LEFT', group: 'STORE', branch: 'CN130', status: 'TERMINATED' });
  pushShift(repo, { id: 'S_LEFT', employeeId: 'EMP_LEFT', branch: 'CN130', date: today, startMs: now + 10 * 60_000 });

  const result = await autoRemindersTick(repo, notifications, zalo);
  assert.equal(result.checkinsSent, 0);
  assert.equal((await repo.getInboxForRecipient('EMP_LEFT')).length, 0);
});
