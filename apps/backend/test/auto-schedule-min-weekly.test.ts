import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import {
  AutoScheduleService,
  MIN_WEEKLY_SHIFTS,
  buildAutoPlan,
} from '../src/services/auto-schedule.service.js';

const MON = '2026-11-23';
const OFF_DATES = ['2026-11-25', '2026-11-27'];

function employee(employeeId: string) {
  return {
    employee_id: employeeId,
    full_name: employeeId,
    employment_status: 'OFFICIAL',
    default_branch_id: 'CN130',
    default_shift_code: 'CA_1',
  } as any;
}

function leave(employeeId: string, date: string) {
  return {
    request_id: `L_${employeeId}_${date}`,
    employee_id: employeeId,
    branch_id: 'CN130',
    leave_type: 'HANG_TUAN',
    requested_date: date,
    status: 'APPROVED',
    reason: 'off',
    created_at: '2026-11-01T00:00:00.000Z',
    reviewed_by: 'SYSTEM',
  } as any;
}

function seed(n: number) {
  const repo = new MockSheetsAdapter();
  for (let i = 1; i <= n; i++) {
    repo.employees.push(employee(`EMP_${i}`));
    for (const d of OFF_DATES) repo.leaveRequests.push(leave(`EMP_${i}`, d));
  }
  return repo;
}

test('BOT xếp lịch: mỗi NV ít nhất 3 ca/tuần (trước đây chỉ 2) và tuyệt đối không đụng ngày OFF', async () => {
  const repo = seed(2);
  const plan = await buildAutoPlan(repo, 'CN130', MON);

  for (const s of plan.stats) {
    assert.ok(
      s.weekly_days >= MIN_WEEKLY_SHIFTS,
      `${s.employee_id} phải có >= ${MIN_WEEKLY_SHIFTS} ca/tuần, thực tế ${s.weekly_days}`
    );
  }
  assert.equal(
    plan.items.some((it) => OFF_DATES.includes(it.date)),
    false,
    'BOT không được xếp ca vào ngày OFF đã đăng ký'
  );
});

test('3 NV cùng ca: vẫn đủ sàn 3 ca/tuần bằng cách xếp thêm người thứ 2 cùng ca/ngày (tối đa 2)', async () => {
  const repo = seed(3);
  const plan = await buildAutoPlan(repo, 'CN130', MON);

  for (const s of plan.stats) {
    assert.ok(s.weekly_days >= MIN_WEEKLY_SHIFTS, `${s.employee_id} chỉ có ${s.weekly_days} ca`);
  }
  // Không ngày/ca nào vượt quá 2 người.
  const perShiftDay = new Map<string, number>();
  for (const it of plan.items) {
    const k = `${it.branch_id}|${it.shift_code}|${it.date}`;
    perShiftDay.set(k, (perShiftDay.get(k) || 0) + 1);
  }
  for (const [k, n] of perShiftDay) {
    assert.ok(n <= 2, `${k} có ${n} người (tối đa 2)`);
  }
});

test('BOT ghi ca bằng 1 lượt bulk (không gọi createShiftAssignment từng ca)', async () => {
  const repo = seed(3);
  (repo as any).createShiftAssignment = async () => {
    throw new Error('PER_SHIFT_CREATE_NOT_ALLOWED');
  };

  const svc = new AutoScheduleService(repo);
  const exec = await svc.execute('CN130', MON, 'HR_1');

  assert.ok(exec.created > 0, 'phải tạo được ca qua bulk');
  assert.equal(repo.shifts.length, exec.created, 'mọi ca BOT xếp đều được ghi');
  for (const s of repo.shifts) {
    assert.equal(s.status, 'DRAFT', 'BOT xếp ca nháp, chờ PUBLISH');
  }
});
