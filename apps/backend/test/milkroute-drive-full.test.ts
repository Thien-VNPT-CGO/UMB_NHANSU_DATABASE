import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { EVDriveService, evToday } from '../src/services/milkroute/ev-drive.service.js';

/**
 * Toàn bộ tab App Tài Xế phải dựng được dữ liệu (không phụ thuộc Drive đã cấu
 * hình hay chưa). Đây là lớp bảo vệ để thêm chức năng mới không làm gãy đồng bộ.
 */
async function buildAll(defs: any[], day: string, all: any) {
  const out: Record<string, any[]> = {};
  for (const def of defs) out[def.name] = await def.build(day, all);
  return out;
}

test('EV Drive: mọi tab App Tài Xế dựng đủ dữ liệu trong ngày', async () => {
  const repo = new MockSheetsAdapter() as any;
  const day = evToday();
  const period = day.slice(0, 7);

  repo.employees.push({
    employee_id: 'EMP_DRIVE_1',
    employee_code: 'UBM_DRV1',
    full_name: 'Tài xế Một',
    phone: '0909000001',
    group: 'XUONG',
    default_branch_id: 'XUONG_SX',
    employment_status: 'OFFICIAL',
    start_date: '2026-01-01',
  });
  repo.branches = [{ branch_id: 'XUONG_SX', name: 'Xưởng sản xuất' }];
  repo.evVehicles.push({
    vehicle_id: 'VEH_1',
    license_plate: '29H-111.11',
    assigned_driver_id: 'EMP_DRIVE_1',
    status: 'ACTIVE',
    current_battery_pct: 70,
  });
  repo.evRoutes.push({ route_id: 'ROUTE_1', name: 'Tuyến 1', is_active: true });
  repo.evRouteStops.push({
    stop_id: 'STOP_1',
    route_id: 'ROUTE_1',
    stop_order: 1,
    name: 'Xưởng',
    branch_id: 'XUONG_SX',
    latitude: 10.8,
    longitude: 106.6,
  });
  repo.evShifts.push({
    shift_id: 'SHIFT_1',
    route_id: 'ROUTE_1',
    driver_id: 'EMP_DRIVE_1',
    vehicle_id: 'VEH_1',
    shift_date: day,
    planned_start_at: `${day}T08:00:00+07:00`,
    status: 'IN_PROGRESS',
    actual_start_at: `${day}T08:00:00+07:00`,
    penalty_points: 0,
  });
  repo.evShiftCheckins.push({
    checkin_id: 'CHECKIN_1',
    shift_id: 'SHIFT_1',
    stop_id: 'STOP_1',
    stop_order: 1,
    stop_name: 'Xưởng',
    checked_in_at: `${day}T08:05:00+07:00`,
    is_late: false,
    is_missed: false,
  });
  repo.evChargingTickets.push({
    ticket_id: 'TICKET_1',
    shift_id: 'SHIFT_1',
    driver_id: 'EMP_DRIVE_1',
    requested_date: day,
    status: 'APPROVED',
    energy_charged_kwh: 12.5,
  });
  repo.evDriverPayroll.push({
    payroll_id: 'PAYROLL_1',
    driver_id: 'EMP_DRIVE_1',
    period,
    status: 'APPROVED',
    gross_pay: 6_000_000,
    total_penalty_amount: 0,
    net_pay: 6_000_000,
  });
  repo.evExplanationTickets.push({
    ticket_id: 'EXP_1',
    ticket_code: 'EGT-TEST-0001',
    driver_id: 'EMP_DRIVE_1',
    driver_name: 'Tài xế Một',
    reason: 'Kẹt xe',
    items: [{ shift_id: 'SHIFT_1', shift_date: day, stop_id: 'STOP_1', stop_order: 1, stop_name: 'Xưởng' }],
    photos: [],
    status: 'PENDING',
    created_at: `${day}T09:00:00+07:00`,
  });
  repo.evGpsPoints.push({
    point_id: 'GPS_1',
    shift_id: 'SHIFT_1',
    driver_id: 'EMP_DRIVE_1',
    vehicle_id: 'VEH_1',
    recorded_at: `${day}T08:10:00+07:00`,
    latitude: 10.81,
    longitude: 106.61,
    is_mock: false,
  });
  // Chức năng mới chưa có tab riêng → phải tự sinh tab dữ liệu.
  repo.evNewFeatureItems = [{ id: 'NEW_1', created_at: `${day}T10:00:00+07:00` }];

  const svc = new EVDriveService(repo);
  const all = await (svc as any).loadCollections(day);
  const defs = (svc as any).allTabDefs();
  const built = await buildAll(defs, day, all);

  for (const name of [
    'Live Map', 'Xe & Lộ trình', 'Phiếu đổi lộ trình', 'Ca vận chuyển',
    'Phiếu sạc', 'Lương tài xế', 'Giải trình', 'Hồ sơ tài xế',
    'Hành trình GPS', 'Tổng quan', 'Tự động - New Feature Items',
  ]) {
    assert.ok(built[name]?.length, `Thiếu dữ liệu tab ${name}`);
  }

  const shiftFile = built['Ca vận chuyển'][0].data;
  assert.equal(shiftFile.total, 1);
  assert.equal(shiftFile.items[0].driver_name, 'Tài xế Một');
  assert.equal(shiftFile.items[0].checkins.length, 1);

  const profileFile = built['Hồ sơ tài xế'][0].data;
  assert.equal(profileFile.total, 1);
  assert.equal(profileFile.items[0].full_name, 'Tài xế Một');
  assert.equal(profileFile.items[0].vehicle.license_plate, '29H-111.11');

  const summary = built['Tổng quan'][0].data;
  assert.equal(summary.shifts.total, 1);
  assert.equal(summary.checkins.total, 1);
  assert.equal(summary.charging.total, 1);
  assert.equal(summary.explanations.pending, 1);
  assert.equal(summary.gps.total_points, 1);

  const auto = built['Tự động - New Feature Items'][0].data;
  assert.equal(auto.auto_created, true);
  assert.equal(auto.total, 1);
});

test('EV Drive: mọi thay đổi của App Tài Xế tự chọn đúng tab để đồng bộ', () => {
  const repo = new MockSheetsAdapter() as any;
  const day = evToday();
  repo.employees.push({ employee_id: 'EMP_DRIVE_1', full_name: 'Tài xế Một' });
  repo.evVehicles.push({ vehicle_id: 'VEH_1', assigned_driver_id: 'EMP_DRIVE_1' });
  repo.evShifts.push({
    shift_id: 'SHIFT_1',
    driver_id: 'EMP_DRIVE_1',
    vehicle_id: 'VEH_1',
    shift_date: day,
  });
  repo.evExplanationTickets.push({
    ticket_id: 'EXP_1',
    driver_id: 'EMP_DRIVE_1',
    items: [{ shift_id: 'SHIFT_1', shift_date: day }],
    created_at: `${day}T09:00:00+07:00`,
  });

  const svc = new EVDriveService(repo);
  (svc as any).isEnabled = () => true;
  const calls: Array<{ day: string; tabs?: string[] }> = [];
  (svc as any).scheduleDay = (d?: string, tabs?: string[]) => { calls.push({ day: String(d), tabs }); };

  svc.scheduleFromBroadcast('evExplanationTicket', { id: 'EXP_1' });
  assert.equal(calls[0].day, day);
  assert.deepEqual(calls[0].tabs, ['Giải trình', 'Tổng quan']);

  calls.length = 0;
  svc.scheduleFromBroadcast('employees', { employee: { employee_id: 'EMP_DRIVE_1' } });
  assert.deepEqual(calls[0].tabs, ['Hồ sơ tài xế', 'Tổng quan']);

  calls.length = 0;
  svc.scheduleFromBroadcast('employees', { employee: { employee_id: 'EMP_VAN_PHONG' } });
  assert.equal(calls.length, 0);
});
