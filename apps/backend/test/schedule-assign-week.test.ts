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

function employee(employeeId: string, overrides: Record<string, any> = {}) {
  return {
    employee_id: employeeId,
    full_name: employeeId,
    employment_status: 'OFFICIAL',
    default_branch_id: 'CN130',
    default_shift_code: 'CA_1',
    ...overrides,
  } as any;
}

test('sắp lịch tuần Sale: tạo CA_4 hợp lệ, giữ ca trùng, hủy ca không còn chọn', async () => {
  const repo = new MockSheetsAdapter();
  const wk = currentVnWeekRange();
  const mon = wk.mon;
  repo.employees.push(employee('EMP_SALE', { group: 'SALE', default_branch_id: 'VAN_PHONG' }));
  repo.shifts.push(
    shift({
      assignment_id: 'S_CA1',
      employee_id: 'EMP_SALE',
      branch_id: 'VAN_PHONG',
      shift_code: 'CA_1',
      date: mon,
      start_at: `${mon}T07:00:00+07:00`,
      end_at: `${mon}T11:00:00+07:00`,
    }),
    shift({
      assignment_id: 'S_CA3',
      employee_id: 'EMP_SALE',
      branch_id: 'VAN_PHONG',
      shift_code: 'CA_3',
      date: mon,
      start_at: `${mon}T15:00:00+07:00`,
      end_at: `${mon}T19:00:00+07:00`,
    })
  );

  const svc = new SchedulesService(repo);
  const res = await svc.assignWeek({
    employeeId: 'EMP_SALE',
    week: mon,
    days: [{ date: mon, shiftCodes: ['CA_1', 'CA_4'] }],
    actorId: 'HR_1',
  });

  assert.equal(res.created.length, 1, 'chỉ tạo thêm CA_4 (CA_1 đã có)');
  assert.equal(res.created[0].shift_code, 'CA_4', 'Sale được xếp CA_4');
  assert.equal(res.kept.length, 1, 'CA_1 cũ được giữ, không tạo trùng');
  assert.equal(res.removed.length, 1, 'CA_3 không còn chọn → hủy');

  const live = repo.shifts.filter(
    (s: any) => s.employee_id === 'EMP_SALE' && String(s.status) !== 'CANCELLED'
  );
  assert.deepEqual(
    live.map((s: any) => String(s.shift_code)).sort(),
    ['CA_1', 'CA_4'],
    'lịch còn đúng CA_1 + CA_4'
  );
});

test('sắp lịch tuần Xưởng: chặn CA_4 (chỉ 3 ca)', async () => {
  const repo = new MockSheetsAdapter();
  const wk = currentVnWeekRange();
  repo.employees.push(employee('EMP_XUONG', { group: 'XUONG', default_branch_id: 'XUONG_SX' }));

  const svc = new SchedulesService(repo);
  await assert.rejects(
    () =>
      svc.assignWeek({
        employeeId: 'EMP_XUONG',
        week: wk.mon,
        days: [{ date: wk.mon, shiftCodes: ['CA_4'] }],
        actorId: 'HR_1',
      }),
    /ASSIGN_WEEK_SHIFT_INVALID/
  );
  assert.equal(
    repo.shifts.filter((s: any) => s.employee_id === 'EMP_XUONG').length,
    0,
    'không được tạo ca nào khi mã ca sai khối'
  );
});
