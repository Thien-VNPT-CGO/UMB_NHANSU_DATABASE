import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { SaleMonitorService } from '../src/services/sale-monitor.service.js';

const DATE = '2026-08-01';

function saleEmployee(overrides: Record<string, any> = {}) {
  return {
    employee_id: 'S1',
    employee_code: 'S001',
    full_name: 'Nguyễn Sale Một',
    group: 'SALE',
    employment_status: 'OFFICIAL',
    default_branch_id: 'CN1',
    branch_id: 'CN1',
    version: 1,
    ...overrides,
  } as any;
}

function shift(overrides: Record<string, any> = {}) {
  return {
    assignment_id: 'A1',
    employee_id: 'S1',
    branch_id: 'CN1',
    shift_code: 'CA_1',
    date: DATE,
    // 07:00–11:00 giờ VN
    start_at: `${DATE}T00:00:00.000Z`,
    end_at: `${DATE}T04:00:00.000Z`,
    status: 'PUBLISHED',
    schedule_version: 1,
    created_at: `${DATE}T00:00:00.000Z`,
    updated_at: `${DATE}T00:00:00.000Z`,
    ...overrides,
  } as any;
}

function attendanceEvent(overrides: Record<string, any> = {}) {
  return {
    event_id: 'E1',
    request_id: 'R1',
    assignment_id: 'A1',
    employee_id: 'S1',
    branch_id: 'CN1',
    type: 'CHECK_IN',
    client_time: `${DATE}T00:05:00.000Z`, // 07:05 VN
    server_received_at: `${DATE}T00:05:01.000Z`,
    gps_status: 'VALID',
    created_at: `${DATE}T00:05:00.000Z`,
    ...overrides,
  } as any;
}

function buildRepo() {
  const repo = new MockSheetsAdapter();
  repo.employees = [
    saleEmployee(),
    saleEmployee({ employee_id: 'S2', employee_code: 'S002', full_name: 'Trần Sale Hai' }),
    saleEmployee({ employee_id: 'K1', employee_code: 'K001', full_name: 'Kho Không Sale', group: 'STORE' }),
    saleEmployee({ employee_id: 'S9', employee_code: 'S009', full_name: 'Sale Đã Nghỉ', employment_status: 'TERMINATED' }),
  ];
  repo.shifts = [shift()];
  repo.attendanceEvents = [];
  return repo;
}

test('sale-monitor: chỉ lấy nhân viên SALE đang làm, tính trễ và giờ công realtime', async () => {
  const repo = buildRepo();
  repo.attendanceEvents = [attendanceEvent()];
  const service = new SaleMonitorService(repo);

  const snapshot = await service.getSnapshot({
    date: DATE,
    nowMs: Date.parse(`${DATE}T03:00:00.000Z`), // 10:00 VN
  });

  assert.equal(snapshot.date, DATE);
  assert.equal(snapshot.is_today, true);
  // K1 (STORE) và S9 (TERMINATED) bị loại.
  assert.deepEqual(snapshot.employees.map((e) => e.employee_id).sort(), ['S1', 'S2']);

  const s1 = snapshot.employees.find((e) => e.employee_id === 'S1')!;
  assert.equal(s1.status, 'LATE');
  assert.equal(s1.shifts.length, 1);
  assert.equal(s1.shifts[0].status, 'LATE');
  assert.equal(s1.shifts[0].late_minutes, 5);
  assert.equal(s1.shifts[0].scheduled_minutes, 240);
  assert.equal(s1.shifts[0].worked_minutes, 175); // 07:05 -> 10:00
  assert.equal(s1.shifts[0].is_late, true);

  const s2 = snapshot.employees.find((e) => e.employee_id === 'S2')!;
  assert.equal(s2.status, 'OFF');

  assert.equal(snapshot.summary.total, 2);
  assert.equal(snapshot.summary.late, 1);
  assert.equal(snapshot.summary.scheduled, 1);
  assert.equal(snapshot.summary.checked_in, 1);
  assert.equal(snapshot.summary.off, 1);
  assert.equal(snapshot.summary.total_worked_minutes, 175);
  assert.equal(snapshot.summary.attendance_rate, 100);
  assert.equal(snapshot.recent_events.length, 1);
  assert.equal(snapshot.recent_events[0].type, 'CHECK_IN');
});

test('sale-monitor: chưa tới giờ vào ca = UPCOMING, quá giờ chưa vào = MISSING_CHECKIN', async () => {
  const repo = buildRepo();
  const service = new SaleMonitorService(repo);

  const early = await service.getSnapshot({
    date: DATE,
    nowMs: Date.parse(`2026-07-31T23:00:00.000Z`), // 06:00 VN ngày giám sát
  });
  // nowMs trước ngày giám sát -> mọi ca còn UPCOMING
  assert.equal(early.employees.find((e) => e.employee_id === 'S1')!.status, 'UPCOMING');

  const late = await service.getSnapshot({
    date: DATE,
    nowMs: Date.parse(`${DATE}T02:00:00.000Z`), // 09:00 VN, chưa check-in
  });
  const s1 = late.employees.find((e) => e.employee_id === 'S1')!;
  assert.equal(s1.status, 'MISSING_CHECKIN');
  assert.equal(s1.shifts[0].status, 'MISSING_CHECKIN');
  assert.equal(s1.shifts[0].worked_minutes, 0);
});

test('sale-monitor: có check-out -> COMPLETED và chốt đúng số phút đã làm', async () => {
  const repo = buildRepo();
  repo.attendanceEvents = [
    attendanceEvent(),
    attendanceEvent({
      event_id: 'E2',
      request_id: 'R2',
      type: 'CHECK_OUT',
      client_time: `${DATE}T03:50:00.000Z`, // 10:50 VN
      server_received_at: `${DATE}T03:50:01.000Z`,
    }),
  ];
  const service = new SaleMonitorService(repo);

  const snapshot = await service.getSnapshot({
    date: DATE,
    nowMs: Date.parse(`${DATE}T05:00:00.000Z`), // 12:00 VN
  });

  const s1 = snapshot.employees.find((e) => e.employee_id === 'S1')!;
  assert.equal(s1.status, 'COMPLETED');
  assert.equal(s1.shifts[0].status, 'COMPLETED');
  assert.equal(s1.shifts[0].worked_minutes, 225); // 07:05 -> 10:50
  assert.equal(s1.shifts[0].early_leave_minutes, 10);
  assert.equal(snapshot.summary.completed, 1);
  assert.equal(snapshot.recent_events.length, 2);
});
