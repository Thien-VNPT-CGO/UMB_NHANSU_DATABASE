import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { SchedulesService } from '../src/services/schedules.service.js';
import { currentVnWeekRange } from '../src/services/weekly-off.service.js';

function shift(overrides: Record<string, any>) {
  return {
    assignment_id: 'SHIFT_1',
    employee_id: 'EMP_1',
    branch_id: 'CN130',
    shift_code: 'CA_1',
    date: '2026-11-19',
    start_at: '2026-11-19T07:00:00+07:00',
    end_at: '2026-11-19T12:00:00+07:00',
    status: 'PUBLISHED',
    schedule_version: 1,
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    ...overrides,
  } as any;
}

function employee(employeeId: string) {
  return {
    employee_id: employeeId,
    full_name: employeeId,
    employment_status: 'OFFICIAL',
    default_branch_id: 'CN130',
    default_shift_code: 'CA_1',
  } as any;
}

test('đổi ca 1 chiều: nhân viên đã đủ 2 ca/ngày thì KHÔNG được nhận ca thứ 3', async () => {
  const repo = new MockSheetsAdapter();
  const day = currentVnWeekRange().mon; // tuần hiện tại (hợp lệ để đổi ca)
  repo.employees.push(employee('EMP_TARGET'), employee('EMP_REQ'));
  repo.shifts.push(
    shift({ assignment_id: 'T_CA1', employee_id: 'EMP_TARGET', shift_code: 'CA_1', date: day }),
    shift({ assignment_id: 'T_CA2', employee_id: 'EMP_TARGET', shift_code: 'CA_2', date: day }),
    shift({ assignment_id: 'R_CA3', employee_id: 'EMP_REQ', shift_code: 'CA_3', date: day })
  );
  await repo.createSwapRequest({
    swap_id: 'SW_1',
    swap_kind: 'EMPLOYEE_SWAP',
    requester_id: 'EMP_REQ',
    requester_assignment_id: 'R_CA3',
    target_employee_id: 'EMP_TARGET',
    target_assignment_id: '',
    reason: 'test',
    status: 'PENDING_PARTNER',
    bonus_amount: 0,
  } as any);

  const svc = new SchedulesService(repo);
  await assert.rejects(
    () => svc.respondSwapPartner('SW_1', 'EMP_TARGET', true),
    /MAX_2_SHIFTS_PER_DAY/
  );
  assert.equal(
    repo.shifts.find((s) => s.assignment_id === 'R_CA3')!.employee_id,
    'EMP_REQ',
    'ca phải còn nguyên chủ cũ khi bị chặn'
  );
  assert.equal((await repo.getSwapById('SW_1'))!.status, 'PENDING_PARTNER', 'phiếu chưa được duyệt');
});

test('tráo tay đôi cùng ngày: hoán đổi 1-1 vẫn hợp lệ (không tăng số ca/ngày)', async () => {
  const repo = new MockSheetsAdapter();
  const day = currentVnWeekRange().mon;
  repo.employees.push(employee('EMP_A'), employee('EMP_B'));
  repo.shifts.push(
    shift({ assignment_id: 'A_CA1', employee_id: 'EMP_A', shift_code: 'CA_1', date: day }),
    shift({ assignment_id: 'A_CA2', employee_id: 'EMP_A', shift_code: 'CA_2', date: day }),
    shift({ assignment_id: 'B_CA3', employee_id: 'EMP_B', shift_code: 'CA_3', date: day })
  );
  await repo.createSwapRequest({
    swap_id: 'SW_2',
    swap_kind: 'EMPLOYEE_SWAP',
    requester_id: 'EMP_A',
    requester_assignment_id: 'A_CA1',
    target_employee_id: 'EMP_B',
    target_assignment_id: 'B_CA3',
    reason: 'test',
    status: 'PENDING_PARTNER',
    bonus_amount: 0,
  } as any);

  const svc = new SchedulesService(repo);
  await svc.respondSwapPartner('SW_2', 'EMP_B', true);
  assert.equal(repo.shifts.find((s) => s.assignment_id === 'A_CA1')!.employee_id, 'EMP_B');
  assert.equal(repo.shifts.find((s) => s.assignment_id === 'B_CA3')!.employee_id, 'EMP_A');
});

test('HR chuyển ca hỗ trợ chi nhánh: B đã đủ 2 ca/ngày thì KHÔNG tạo được phiếu', async () => {
  const repo = new MockSheetsAdapter();
  const day = currentVnWeekRange().mon;
  repo.employees.push(employee('EMP_OWNER'), employee('EMP_TARGET'));
  repo.shifts.push(
    shift({ assignment_id: 'O_CA3', employee_id: 'EMP_OWNER', shift_code: 'CA_3', date: day }),
    shift({ assignment_id: 'T_CA1', employee_id: 'EMP_TARGET', shift_code: 'CA_1', date: day }),
    shift({ assignment_id: 'T_CA2', employee_id: 'EMP_TARGET', shift_code: 'CA_2', date: day })
  );

  const svc = new SchedulesService(repo);
  await assert.rejects(
    () => svc.createSupportRequest({
      requesterAssignmentId: 'O_CA3',
      targetEmployeeId: 'EMP_TARGET',
      reason: 'test',
      actorId: 'HR_1',
    }),
    /MAX_2_SHIFTS_PER_DAY/
  );
  assert.equal(repo.swapRequests.length, 0, 'không được tạo phiếu hỗ trợ khi B đã đủ 2 ca');
  assert.equal(
    repo.shifts.find((s) => s.assignment_id === 'O_CA3')!.employee_id,
    'EMP_OWNER',
    'ca nhường vẫn thuộc chủ cũ khi bị chặn'
  );
});

test('hỗ trợ chi nhánh: B phát sinh ca thứ 2 sau khi nhận phiếu thì lúc xác nhận vẫn bị chặn', async () => {
  const repo = new MockSheetsAdapter();
  const day = currentVnWeekRange().mon;
  repo.employees.push(employee('EMP_OWNER'), employee('EMP_TARGET'));
  repo.shifts.push(
    shift({ assignment_id: 'O_CA3', employee_id: 'EMP_OWNER', shift_code: 'CA_3', date: day }),
    shift({ assignment_id: 'T_CA1', employee_id: 'EMP_TARGET', shift_code: 'CA_1', date: day })
  );

  const svc = new SchedulesService(repo);
  const created: any = await svc.createSupportRequest({
    requesterAssignmentId: 'O_CA3',
    targetEmployeeId: 'EMP_TARGET',
    reason: 'test',
    actorId: 'HR_1',
  });
  const swapId = String(created?.swap_id || created?.result?.swap_id || '');
  assert.ok(swapId, 'phiếu hỗ trợ phải được tạo khi B còn dưới 2 ca');

  // B được xếp thêm ca thứ 2 trước lúc bấm xác nhận.
  repo.shifts.push(shift({ assignment_id: 'T_CA2', employee_id: 'EMP_TARGET', shift_code: 'CA_2', date: day }));

  await assert.rejects(
    () => svc.respondSwapPartner(swapId, 'EMP_TARGET', true),
    /MAX_2_SHIFTS_PER_DAY/
  );
  assert.equal(
    repo.shifts.find((s) => s.assignment_id === 'O_CA3')!.employee_id,
    'EMP_OWNER',
    'ca phải còn nguyên chủ cũ khi bị chặn lúc xác nhận'
  );
  assert.equal((await repo.getSwapById(swapId))!.status, 'PENDING_PARTNER', 'phiếu chưa được duyệt');
});

test('HR xếp tay ca thứ 3 trong ngày bị chặn', async () => {
  const repo = new MockSheetsAdapter();
  const day = currentVnWeekRange().mon;
  repo.shifts.push(
    shift({ assignment_id: 'M_CA1', employee_id: 'EMP_TARGET', shift_code: 'CA_1', date: day }),
    shift({ assignment_id: 'M_CA2', employee_id: 'EMP_TARGET', shift_code: 'CA_2', date: day })
  );
  const svc = new SchedulesService(repo);
  await assert.rejects(
    () => svc.createShift({
      employeeId: 'EMP_TARGET',
      branchId: 'CN130',
      shiftCode: 'CA_3',
      date: day,
      actorId: 'ADMIN',
    }),
    /MAX_2_SHIFTS_PER_DAY/
  );
});
