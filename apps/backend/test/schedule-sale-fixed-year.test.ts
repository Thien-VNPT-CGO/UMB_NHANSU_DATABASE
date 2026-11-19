import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { SchedulesService } from '../src/services/schedules.service.js';

function vnToday(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function expectedHorizon(): string {
  return `${Number(vnToday().slice(0, 4)) + 1}-12-31`;
}

function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

function employee(overrides: Record<string, any> = {}) {
  return {
    employee_id: 'EMP_SALE',
    full_name: 'Sale Test',
    employee_code: 'S001',
    employment_status: 'OFFICIAL',
    group: 'SALE',
    default_branch_id: 'VAN_PHONG',
    version: 1,
    ...overrides,
  } as any;
}

test('ca cố định năm Sale: tạo mọi ngày tới 31/12 năm sau, bỏ qua ngày nghỉ phép đã duyệt', async () => {
  const repo = new MockSheetsAdapter();
  const today = vnToday();
  const leaveDay = addDays(today, 15);
  repo.employees.push(employee());
  repo.leaveRequests.push({
    request_id: 'LEAVE_1',
    employee_id: 'EMP_SALE',
    branch_id: 'VAN_PHONG',
    leave_type: 'DOT_XUAT',
    requested_date: leaveDay,
    reason: 'Việc nhà',
    status: 'APPROVED',
  } as any);

  const svc = new SchedulesService(repo);
  const res = await svc.applySaleFixedShift({
    employeeId: 'EMP_SALE',
    shiftCode: 'CA_2',
    actorId: 'HR_1',
  });

  const horizon = expectedHorizon();
  assert.equal(res.shiftCode, 'CA_2');
  assert.equal(res.toDate, horizon);
  assert.equal(res.skippedLeave, 1, 'bỏ đúng 1 ngày nghỉ phép đã duyệt');
  assert.equal(res.created, daysInclusive(today, horizon) - 1, 'tạo đủ các ngày còn lại');
  assert.equal(res.kept, 0);

  const live = repo.shifts.filter((s: any) => s.employee_id === 'EMP_SALE' && s.status !== 'CANCELLED');
  assert.equal(live.length, daysInclusive(today, horizon) - 1);
  assert.ok(live.every((s: any) => s.shift_code === 'CA_2'), 'mọi ca đều là ca đã chọn');
  assert.ok(live.every((s: any) => s.status === 'PUBLISHED'), 'ca cố định vào thẳng PUBLISHED');
  assert.equal(
    live.filter((s: any) => String(s.date).slice(0, 10) === leaveDay).length,
    0,
    'ngày nghỉ phép đã duyệt không có ca'
  );

  const emp: any = repo.employees.find((e: any) => e.employee_id === 'EMP_SALE');
  assert.equal(emp.default_shift_code, 'CA_2', 'cập nhật Ca cố định trên hồ sơ');

  const settings: any = await repo.getSystemSettings();
  assert.equal(settings?.sale_fixed_shift_rules?.EMP_SALE?.shift_code, 'CA_2', 'lưu rule để tự nối năm sau');
  assert.equal(settings?.sale_fixed_shift_rules?.EMP_SALE?.through, horizon);
});

test('đổi ca cố định: hủy ca máy tạo cũ chưa điểm danh và tạo lại theo ca mới', async () => {
  const repo = new MockSheetsAdapter();
  const today = vnToday();
  repo.employees.push(employee());
  const svc = new SchedulesService(repo);

  const first = await svc.applySaleFixedShift({ employeeId: 'EMP_SALE', shiftCode: 'CA_1', actorId: 'HR_1' });
  assert.ok(first.created > 0);

  // Giữ lại 1 ca CA_1 đã điểm danh để chắc chắn service không hủy ca có bằng chứng công.
  const attended: any = repo.shifts.find((s: any) => s.shift_code === 'CA_1' && s.date >= today);
  assert.ok(attended);
  repo.attendanceEvents.push({
    event_id: 'EV_1',
    employee_id: 'EMP_SALE',
    assignment_id: attended.assignment_id,
    type: 'CHECK_IN',
    client_time: `${attended.date}T07:00:00+07:00`,
    server_received_at: `${attended.date}T07:00:05+07:00`,
    status: 'ACCEPTED',
    face_match_score: 1,
    distance_meters: 0,
    wifi_ssid: 'UBM',
    gps_lat: 0,
    gps_lng: 0,
    photo_base64: '',
  } as any);

  const res = await svc.applySaleFixedShift({ employeeId: 'EMP_SALE', shiftCode: 'CA_3', actorId: 'HR_1' });
  assert.ok(res.cancelled > 0, 'có hủy ca CA_1 cũ');
  assert.ok(res.created > 0, 'tạo ca CA_3');

  const live = repo.shifts.filter((s: any) => s.employee_id === 'EMP_SALE' && s.status !== 'CANCELLED');
  const liveCa1 = live.filter((s: any) => s.shift_code === 'CA_1');
  assert.equal(liveCa1.length, 1, 'chỉ còn ca CA_1 đã điểm danh');
  assert.equal(liveCa1[0].assignment_id, attended.assignment_id);
  assert.ok(
    live.filter((s: any) => s.shift_code === 'CA_3').length > 0,
    'lịch mới dùng ca CA_3'
  );
  const emp: any = repo.employees.find((e: any) => e.employee_id === 'EMP_SALE');
  assert.equal(emp.default_shift_code, 'CA_3');
});

test('ca cố định năm: chặn khối không phải Sale và mã ca lạ', async () => {
  const repo = new MockSheetsAdapter();
  repo.employees.push(employee({
    employee_id: 'EMP_XUONG',
    group: 'XUONG',
    default_branch_id: 'XUONG_SX',
  }));
  const svc = new SchedulesService(repo);

  await assert.rejects(
    () => svc.applySaleFixedShift({ employeeId: 'EMP_XUONG', shiftCode: 'CA_1', actorId: 'HR_1' }),
    /SALE_FIXED_SHIFT_ONLY/
  );

  repo.employees.push(employee({ employee_id: 'EMP_SALE_2' }));
  await assert.rejects(
    () => svc.applySaleFixedShift({ employeeId: 'EMP_SALE_2', shiftCode: 'CA_9', actorId: 'HR_1' }),
    /SALE_FIXED_SHIFT_INVALID/
  );
});

test('tick nền không tạo trùng sau khi đã áp dụng (through = 31/12 năm sau)', async () => {
  const repo = new MockSheetsAdapter();
  repo.employees.push(employee());
  const svc = new SchedulesService(repo);

  await svc.applySaleFixedShift({ employeeId: 'EMP_SALE', shiftCode: 'CA_4', actorId: 'HR_1' });
  const before = repo.shifts.length;
  const tick = await svc.ensureSaleFixedShifts('SYSTEM');
  assert.equal(tick.created, 0, 'không tạo thêm ca nào');
  assert.equal(repo.shifts.length, before);
});

test('hủy ca hàng loạt: đổi trạng thái 1 lượt, idempotent, không xóa lịch sử', async () => {
  const repo = new MockSheetsAdapter();
  repo.employees.push(employee());
  const svc = new SchedulesService(repo);
  await svc.applySaleFixedShift({ employeeId: 'EMP_SALE', shiftCode: 'CA_1', actorId: 'HR_1' });

  const live = repo.shifts.filter((s: any) => s.status !== 'CANCELLED');
  const ids = live.slice(0, 12).map((s: any) => String(s.assignment_id));
  const n1 = await repo.cancelShiftAssignmentsBulk(ids);
  assert.equal(n1, ids.length, 'hủy đúng số ca yêu cầu');
  assert.ok(
    repo.shifts.filter((s: any) => ids.includes(String(s.assignment_id))).every((s: any) => s.status === 'CANCELLED'),
    'các ca được chọn đều CANCELLED'
  );
  assert.equal(
    repo.shifts.filter((s: any) => ids.includes(String(s.assignment_id))).length,
    ids.length,
    'giữ nguyên dòng để bảo toàn lịch sử công'
  );
  assert.equal(await repo.cancelShiftAssignmentsBulk(ids), 0, 'chạy lại không đổi gì');
  assert.ok(
    repo.shifts.filter((s: any) => !ids.includes(String(s.assignment_id))).every((s: any) => s.status !== 'CANCELLED'),
    'không hủy oan ca khác'
  );
});

test('ngừng ca cố định: hủy ca máy tạo tương lai và xóa rule (tick không tạo lại)', async () => {
  const repo = new MockSheetsAdapter();
  repo.employees.push(employee());
  const svc = new SchedulesService(repo);

  await svc.applySaleFixedShift({ employeeId: 'EMP_SALE', shiftCode: 'CA_2', actorId: 'HR_1' });
  assert.ok(repo.shifts.length > 0);

  const res = await svc.stopSaleFixedShift('EMP_SALE', 'HR_1');
  assert.equal(res.hadRule, true);
  assert.ok(res.cancelled > 0, 'có hủy ca máy tạo');

  const live = repo.shifts.filter((s: any) => s.status !== 'CANCELLED');
  assert.equal(live.length, 0, 'không còn ca máy tạo nào sống');

  const tick = await svc.ensureSaleFixedShifts('SYSTEM');
  assert.equal(tick.employees, 0, 'rule đã xóa — tick không duy trì nữa');
  assert.equal(repo.shifts.filter((s: any) => s.status !== 'CANCELLED').length, 0);
});
