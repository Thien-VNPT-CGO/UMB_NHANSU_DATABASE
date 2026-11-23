import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { SchedulesService } from '../src/services/schedules.service.js';

function shift(overrides: Record<string, any>) {
  return {
    assignment_id: 'SHIFT_1',
    employee_id: 'EMP_1',
    branch_id: 'CN130',
    shift_code: 'CA_1',
    date: '2026-11-23',
    start_at: '2026-11-23T07:00:00+07:00',
    end_at: '2026-11-23T12:00:00+07:00',
    status: 'DRAFT',
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

function leave(employeeId: string, date: string, status = 'APPROVED') {
  return {
    request_id: `L_${employeeId}_${date}`,
    employee_id: employeeId,
    branch_id: 'CN130',
    leave_type: 'HANG_TUAN',
    requested_date: date,
    status,
    reason: 'off',
    created_at: '2026-11-01T00:00:00.000Z',
    reviewed_by: 'SYSTEM',
  } as any;
}

test('publish tuần: bulk 1 lượt, ca nháp trùng ngày OFF bị hủy và OFF được giữ nguyên', async () => {
  const repo = new MockSheetsAdapter();
  const svc = new SchedulesService(repo);
  repo.employees.push(employee('EMP_1'));
  repo.shifts.push(
    shift({ assignment_id: 'D1', date: '2026-11-23' }),
    shift({ assignment_id: 'D2', date: '2026-11-24' }),
    shift({ assignment_id: 'D_OFF1', date: '2026-11-25' }),
    shift({ assignment_id: 'D3', date: '2026-11-26' }),
    shift({ assignment_id: 'D_OFF2', date: '2026-11-27' }),
    shift({ assignment_id: 'D4', date: '2026-11-28' })
  );
  repo.leaveRequests.push(leave('EMP_1', '2026-11-25'), leave('EMP_1', '2026-11-27'));

  // Bằng chứng KHÔNG còn cập nhật từng ca (mỗi ca từng đẩy cả tab Sheets):
  // publish phải đi qua publishShiftAssignments (bulk).
  (repo as any).updateShiftAssignment = async () => {
    throw new Error('PER_SHIFT_UPDATE_NOT_ALLOWED');
  };

  const raw: any = await svc.publishWeekSchedule('CN130', '2026-11-23', 'HR_1');
  const result: any = raw?.result ?? raw;

  assert.equal(result.count, 4, 'chỉ 4 ca không trùng OFF được publish');
  assert.equal(result.bulkSheetPush, true, 'dùng bulk publish (1 lượt ghi)');
  assert.equal(result.skippedOff.length, 2, 'báo 2 ca nháp trùng ngày OFF');

  const byId = new Map(repo.shifts.map((s) => [String(s.assignment_id), s]));
  assert.equal(byId.get('D1')!.status, 'PUBLISHED');
  assert.equal(byId.get('D2')!.status, 'PUBLISHED');
  assert.equal(byId.get('D3')!.status, 'PUBLISHED');
  assert.equal(byId.get('D4')!.status, 'PUBLISHED');
  assert.equal(byId.get('D_OFF1')!.status, 'CANCELLED', 'ca nháp trùng OFF bị hủy');
  assert.equal(byId.get('D_OFF2')!.status, 'CANCELLED', 'ca nháp trùng OFF bị hủy');
  assert.ok(
    repo.leaveRequests.every((l) => l.status === 'APPROVED'),
    'OFF của nhân viên phải được giữ nguyên (không tự hủy)'
  );
});

test('publish tuần: không đụng ca PUBLISHED sẵn có và không publish ca của tài khoản bị khóa', async () => {
  const repo = new MockSheetsAdapter();
  const svc = new SchedulesService(repo);
  repo.employees.push(employee('EMP_1'), employee('EMP_2'));
  repo.shifts.push(
    shift({ assignment_id: 'ALREADY', employee_id: 'EMP_1', status: 'PUBLISHED', schedule_version: 5 }),
    shift({ assignment_id: 'DRAFT_LOCKED', employee_id: 'EMP_2', date: '2026-11-24' })
  );
  repo.accounts.push({
    username: 'emp2',
    employee_id: 'EMP_2',
    account_status: 'LOCKED',
  } as any);

  const raw: any = await svc.publishWeekSchedule('CN130', '2026-11-23', 'HR_1');
  const result: any = raw?.result ?? raw;

  assert.equal(result.count, 0, 'không có ca nào được duyệt');
  const byId = new Map(repo.shifts.map((s) => [String(s.assignment_id), s]));
  assert.equal(byId.get('ALREADY')!.status, 'PUBLISHED');
  assert.equal(byId.get('ALREADY')!.schedule_version, 5, 'ca đã publish giữ nguyên version');
  assert.equal(byId.get('DRAFT_LOCKED')!.status, 'DRAFT', 'NV bị khóa thì ca vẫn nháp');
});
