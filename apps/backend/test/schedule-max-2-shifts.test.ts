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

test('Ä‘á»•i ca 1 chiá»u: nhÃ¢n viÃªn Ä‘Ã£ Ä‘á»§ 2 ca/ngÃ y thÃ¬ KHÃ”NG Ä‘Æ°á»£c nháº­n ca thá»© 3', async () => {
  const repo = new MockSheetsAdapter();
  const day = currentVnWeekRange().mon; // tuáº§n hiá»‡n táº¡i (há»£p lá»‡ Ä‘á»ƒ Ä‘á»•i ca)
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
    'ca pháº£i cÃ²n nguyÃªn chá»§ cÅ© khi bá»‹ cháº·n'
  );
  assert.equal((await repo.getSwapById('SW_1'))!.status, 'PENDING_PARTNER', 'phiáº¿u chÆ°a Ä‘Æ°á»£c duyá»‡t');
});

test('trÃ¡o tay Ä‘Ã´i cÃ¹ng ngÃ y: hoÃ¡n Ä‘á»•i 1-1 váº«n há»£p lá»‡ (khÃ´ng tÄƒng sá»‘ ca/ngÃ y)', async () => {
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

test('trÃ¡o tay Ä‘Ã´i khÃ¡c ngÃ y: NV tá»± Ä‘á»•i vá»›i nhau KHÃ”NG Ä‘Æ°á»£c nháº­n thÃ nh ca thá»© 3', async () => {
  const repo = new MockSheetsAdapter();
  const wk = currentVnWeekRange();
  const dayGive = wk.mon;
  const dayTake = new Date(`${wk.mon}T00:00:00Z`);
  dayTake.setUTCDate(dayTake.getUTCDate() + 1);
  const dayTakeStr = dayTake.toISOString().slice(0, 10);
  repo.employees.push(employee('EMP_A'), employee('EMP_B'));
  repo.shifts.push(
    shift({ assignment_id: 'A_CA1_MON', employee_id: 'EMP_A', shift_code: 'CA_1', date: dayGive }),
    // B Ä‘Ã£ cÃ³ 2 ca ngÃ y thá»© Hai, cÃ²n 1 ca ngÃ y thá»© Ba Ä‘á»ƒ trÃ¡o.
    shift({ assignment_id: 'B_CA2_MON', employee_id: 'EMP_B', shift_code: 'CA_2', date: dayGive }),
    shift({ assignment_id: 'B_CA3_MON', employee_id: 'EMP_B', shift_code: 'CA_3', date: dayGive }),
    shift({ assignment_id: 'B_CA3_TUE', employee_id: 'EMP_B', shift_code: 'CA_3', date: dayTakeStr })
  );
  await repo.createSwapRequest({
    swap_id: 'SW_3',
    swap_kind: 'EMPLOYEE_SWAP',
    requester_id: 'EMP_A',
    requester_assignment_id: 'A_CA1_MON',
    target_employee_id: 'EMP_B',
    target_assignment_id: 'B_CA3_TUE',
    reason: 'test',
    status: 'PENDING_PARTNER',
    bonus_amount: 0,
  } as any);

  const svc = new SchedulesService(repo);
  await assert.rejects(
    () => svc.respondSwapPartner('SW_3', 'EMP_B', true),
    /MAX_2_SHIFTS_PER_DAY/
  );
  assert.equal(
    repo.shifts.find((s) => s.assignment_id === 'A_CA1_MON')!.employee_id,
    'EMP_A',
    'ca pháº£i cÃ²n nguyÃªn chá»§ cÅ© khi B nháº­n thÃ nh ca thá»© 3'
  );
});

test('HR chuyá»ƒn ca há»— trá»£ chi nhÃ¡nh: B Ä‘Ã£ cÃ³ 2 ca váº«n nháº­n Ä‘Æ°á»£c ca thá»© 3', async () => {
  const repo = new MockSheetsAdapter();
  const day = currentVnWeekRange().mon;
  repo.employees.push(employee('EMP_OWNER'), employee('EMP_TARGET'));
  repo.shifts.push(
    shift({ assignment_id: 'O_CA3', employee_id: 'EMP_OWNER', shift_code: 'CA_3', date: day }),
    shift({ assignment_id: 'T_CA1', employee_id: 'EMP_TARGET', shift_code: 'CA_1', date: day }),
    shift({ assignment_id: 'T_CA2', employee_id: 'EMP_TARGET', shift_code: 'CA_2', date: day })
  );

  const svc = new SchedulesService(repo);
  const created: any = await svc.createSupportRequest({
    requesterAssignmentId: 'O_CA3',
    targetEmployeeId: 'EMP_TARGET',
    reason: 'test',
    actorId: 'HR_1',
  });
  const swapId = String(created?.swap_id || created?.result?.swap_id || '');
  assert.ok(swapId, 'HR pháº£i táº¡o Ä‘Æ°á»£c phiáº¿u dÃ¹ B Ä‘Ã£ cÃ³ 2 ca/ngÃ y');

  await svc.respondSwapPartner(swapId, 'EMP_TARGET', true);
  assert.equal(
    repo.shifts.find((s) => s.assignment_id === 'O_CA3')!.employee_id,
    'EMP_TARGET',
    'HR Ä‘iá»u há»— trá»£ pháº£i chuyá»ƒn Ä‘Æ°á»£c ca thá»© 3 sang B'
  );
  const targetLive = repo.shifts.filter(
    (s) => s.employee_id === 'EMP_TARGET' && String(s.status) !== 'CANCELLED'
  );
  assert.equal(targetLive.length, 3, 'B Ä‘Æ°á»£c phÃ©p cÃ³ 3 ca/ngÃ y khi HR Ä‘iá»u há»— trá»£');
  assert.equal((await repo.getSwapById(swapId))!.status, 'APPROVED');
});

test('há»— trá»£ chi nhÃ¡nh: B phÃ¡t sinh ca thá»© 2 sau khi nháº­n phiáº¿u váº«n xÃ¡c nháº­n Ä‘Æ°á»£c (HR Ä‘Æ°á»£c xáº¿p 3 ca)', async () => {
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
  assert.ok(swapId, 'phiáº¿u há»— trá»£ pháº£i Ä‘Æ°á»£c táº¡o');

  // B Ä‘Æ°á»£c xáº¿p thÃªm ca thá»© 2 trÆ°á»›c lÃºc báº¥m xÃ¡c nháº­n.
  repo.shifts.push(shift({ assignment_id: 'T_CA2', employee_id: 'EMP_TARGET', shift_code: 'CA_2', date: day }));

  await svc.respondSwapPartner(swapId, 'EMP_TARGET', true);
  assert.equal(
    repo.shifts.find((s) => s.assignment_id === 'O_CA3')!.employee_id,
    'EMP_TARGET',
    'HR Ä‘iá»u há»— trá»£ váº«n chuyá»ƒn Ä‘Æ°á»£c ca thá»© 3 sang B'
  );
  assert.equal((await repo.getSwapById(swapId))!.status, 'APPROVED');
});

test('HR xáº¿p tay ca thá»© 3 trong ngÃ y váº«n Ä‘Æ°á»£c phÃ©p', async () => {
  const repo = new MockSheetsAdapter();
  const day = currentVnWeekRange().mon;
  repo.shifts.push(
    shift({ assignment_id: 'M_CA1', employee_id: 'EMP_TARGET', shift_code: 'CA_1', date: day }),
    shift({ assignment_id: 'M_CA2', employee_id: 'EMP_TARGET', shift_code: 'CA_2', date: day })
  );
  const svc = new SchedulesService(repo);
  await svc.createShift({
    employeeId: 'EMP_TARGET',
    branchId: 'CN130',
    shiftCode: 'CA_3',
    date: day,
    actorId: 'ADMIN',
  });
  const live = repo.shifts.filter(
    (s) => s.employee_id === 'EMP_TARGET' && String(s.status) !== 'CANCELLED'
  );
  assert.equal(live.length, 3, 'HR Ä‘Æ°á»£c phÃ©p xáº¿p ca thá»© 3/ngÃ y');
  assert.ok(live.some((s) => s.shift_code === 'CA_3'));
});
