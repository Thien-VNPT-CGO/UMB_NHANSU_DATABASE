import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { dedupeShiftAssignments } from '../src/repositories/shift-dedupe.js';
import { SchedulesService } from '../src/services/schedules.service.js';
import { EmployeesService } from '../src/services/employees.service.js';
import { AttendanceService } from '../src/services/attendance.service.js';
import { ShiftReRegService } from '../src/services/shift-rereg.service.js';
import { singleWriterQueue } from '../src/repositories/single-writer-queue.js';

function shift(overrides: Record<string, any>) {
  return {
    assignment_id: 'SHIFT_1',
    employee_id: 'EMP_1',
    branch_id: 'CN130',
    shift_code: 'CA_1',
    date: '2026-10-20',
    start_at: '2026-10-20T07:00:00+07:00',
    end_at: '2026-10-20T12:00:00+07:00',
    status: 'PUBLISHED',
    schedule_version: 1,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  } as any;
}

test('dedupe ca giữ bản PUBLISHED/version cao và không đụng CANCELLED', () => {
  const result = dedupeShiftAssignments([
    shift({ assignment_id: 'DRAFT_NEW', status: 'DRAFT', schedule_version: 9 }),
    shift({ assignment_id: 'PUBLISHED_OLD', status: 'PUBLISHED', schedule_version: 2 }),
    shift({ assignment_id: 'CA_2', shift_code: 'CA_2', status: 'PUBLISHED' }),
    shift({ assignment_id: 'CANCELLED_1', status: 'CANCELLED', schedule_version: 1 }),
    shift({ assignment_id: 'CANCELLED_1', status: 'CANCELLED', schedule_version: 2 }),
  ]);

  assert.deepEqual(result.map(s => s.assignment_id).sort(), ['CANCELLED_1', 'CA_2', 'PUBLISHED_OLD']);
});

test('adapter trả 1 ca/ngày/mã và create lặp không sinh dòng thứ 2', async () => {
  const repo = new MockSheetsAdapter();
  repo.shifts.push(
    shift({ assignment_id: 'OLD_DUP', status: 'PUBLISHED', schedule_version: 1 }),
    shift({ assignment_id: 'NEW_DUP', status: 'DRAFT', schedule_version: 5 }),
  );

  const visible = await repo.getShiftsForEmployee('EMP_1', '2026-10-20', '2026-10-20');
  assert.equal(visible.length, 1);
  assert.equal(visible[0].assignment_id, 'OLD_DUP', 'PUBLISHED phải thắng DRAFT dù version thấp hơn');

  const created = await repo.createShiftAssignment(shift({ assignment_id: 'SHOULD_NOT_EXIST' }));
  assert.equal(created.assignment_id, 'OLD_DUP');
  assert.equal(repo.shifts.length, 2, 'không được push thêm dòng trùng');
});

test('gửi lại phiếu cập nhật ca không đẻ ca trùng; DRAFT được duyệt PUBLISHED và snapshot ngay', async () => {
  const repo = new MockSheetsAdapter();
  await repo.createEmployee({
    employee_id: 'EMP_REREG_TEST',
    employee_code: 'UBM_RR001',
    full_name: 'Nhân Viên ReReg',
    phone_normalized: '0900000099',
    employment_status: 'OFFICIAL',
    employment_type: 'OFFICIAL',
    default_branch_id: 'CN130',
    default_shift_code: 'CA_1',
    current_rate_per_hour: 30000,
  } as any);
  const date = '2030-12-30';
  repo.shifts.push(shift({
    assignment_id: 'DRAFT_EXISTING',
    employee_id: 'EMP_REREG_TEST',
    date,
    status: 'DRAFT',
    schedule_version: 1,
    start_at: `${date}T07:00:00+07:00`,
    end_at: `${date}T12:00:00+07:00`,
  }));

  let snapshotCalls = 0;
  let flushCalls = 0;
  let shiftPushCalls = 0;
  (repo as any).persistRuntimeSnapshot = async () => { snapshotCalls += 1; };
  (repo as any).flushDurableWrites = async () => { flushCalls += 1; };
  const fakeSync = {
    appendRows: async () => true,
    pushShiftsTab: async () => { shiftPushCalls += 1; return 1; },
    pushEventsTab: async () => 0,
  };
  singleWriterQueue.setRepository(repo as any);
  const svc = new ShiftReRegService(
    new SchedulesService(repo),
    new EmployeesService(repo),
    new AttendanceService(repo),
    fakeSync as any,
    repo as any,
  );
  await svc.saveConfig('ADMIN_TEST', { enabled: true, from: '2020-01-01', to: '2030-12-31', closeTime: '23:59' });

  const first = await svc.submitForm('EMP_REREG_TEST', [{ date, codes: ['CA_1'] }], 'EMP_REREG_TEST');
  assert.equal(first.updated, 1);
  assert.equal(first.created, 0);
  const afterFirst = repo.shifts.filter(s => s.employee_id === 'EMP_REREG_TEST' && s.date === date && s.shift_code === 'CA_1');
  assert.equal(afterFirst.length, 1);
  assert.equal(afterFirst[0].status, 'PUBLISHED');
  assert.equal(afterFirst[0].assignment_id, 'DRAFT_EXISTING');
  assert.ok(snapshotCalls >= 1, 'phải ghi snapshot ngay sau phiếu');
  assert.ok(flushCalls >= 1, 'phải xả journal điểm danh trước khi trả response');
  assert.ok(shiftPushCalls >= 1, 'phải push tab ca sau khi cập nhật');

  const snapshotAfterFirst = snapshotCalls;
  const second = await svc.submitForm('EMP_REREG_TEST', [{ date, codes: ['CA_1'] }], 'EMP_REREG_TEST');
  assert.equal(second.created, 0);
  assert.equal(second.kept, 1);
  const afterSecond = repo.shifts.filter(s => s.employee_id === 'EMP_REREG_TEST' && s.date === date && s.shift_code === 'CA_1');
  assert.equal(afterSecond.length, 1, 'gửi lặp không được tạo ca thứ 2');
  assert.ok(snapshotCalls > snapshotAfterFirst, 'lần gửi lặp vẫn phải refresh snapshot');
});
