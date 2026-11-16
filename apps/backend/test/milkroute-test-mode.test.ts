import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { EVRouteService } from '../src/services/milkroute/ev-route.service.js';
import { EVShiftService } from '../src/services/milkroute/ev-shift.service.js';
import { EVCheckinService } from '../src/services/milkroute/ev-checkin.service.js';
import { EVPayrollService } from '../src/services/milkroute/ev-payroll.service.js';
import { EV_TEST_SHIFT_MARK, isEvTestModeEnabled } from '../src/services/milkroute/ev-test-mode.js';
import { DEFAULT_EV_PAYROLL_CONFIG } from '@ubm/shared';

/**
 * Chế độ TEST (Admin bật/tắt ở tab Vận chuyển sữa).
 *
 *  - Bật: tài xế bấm điểm ở bất kỳ chi nhánh nào, không cần đúng thứ tự,
 *    không chặn khoảng cách/sai số GPS; ca được đánh dấu TEST_MODE và
 *    không bị tính trễ, không bị đánh dấu điểm bỏ lọt.
 *  - Tắt: quy trình cũ giữ nguyên (chặn ngoài geofence).
 *  - Bảng lương bỏ qua ca TEST_MODE (không tính công, không tính phạt).
 */

const VN_OFFSET_MS = 7 * 3_600_000;
const todayVN = () => new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);

const START_LAT = 10.908028;
const START_LNG = 106.650444;
const BRANCH_LAT = 10.799831;
const BRANCH_LNG = 106.693370;

/** Dịch lên phía bắc `meters` (1 độ vĩ ≈ 111.32 km). */
const north = (lat: number, meters: number) => lat + meters / 111_320;

async function setup(driverId = 'EMP_DRIVER_T1') {
  const repo = new MockSheetsAdapter();
  repo.employees.push({
    employee_id: driverId,
    employee_code: `UBM_${driverId}`,
    full_name: 'Tài xế Chạy Thử',
    employment_status: 'OFFICIAL',
    group: 'XUONG',
    default_branch_id: 'XUONG_SX',
  } as any);

  const route = await repo.createEVRoute({ name: 'Tuyến chạy thử', is_active: true } as any);
  const start = await repo.createEVRouteStop({
    route_id: route.route_id,
    stop_order: 1,
    name: 'Xưởng Sản Xuất',
    branch_id: 'XUONG_SX',
    latitude: START_LAT,
    longitude: START_LNG,
    geofence_radius_m: 100,
    sla_minutes: 0,
    stop_type: 'START',
    is_mandatory: true,
  } as any);
  const branch = await repo.createEVRouteStop({
    route_id: route.route_id,
    stop_order: 2,
    name: 'Cửa hàng CH130',
    branch_id: 'CN130',
    latitude: BRANCH_LAT,
    longitude: BRANCH_LNG,
    geofence_radius_m: 100,
    sla_minutes: 30,
    stop_type: 'DELIVERY',
    is_mandatory: true,
  } as any);

  const vehicle = await repo.createEVVehicle({
    license_plate: '29H-888.88',
    assigned_driver_id: driverId,
    status: 'ACTIVE',
  } as any);
  const shift = await repo.createEVShift({
    route_id: route.route_id,
    driver_id: driverId,
    vehicle_id: vehicle.vehicle_id,
    shift_date: todayVN(),
    planned_start_at: `${todayVN()}T08:00:00+07:00`,
    planned_end_at: `${todayVN()}T14:00:00+07:00`,
    created_by: 'TEST',
  } as any);

  const routes = new EVRouteService(repo);
  const shifts = new EVShiftService(repo, routes);
  const checkins = new EVCheckinService(repo, routes);

  return { repo, route, start, branch, vehicle, shift, routes, shifts, checkins };
}

/** Bật/tắt cờ Test toàn hệ thống (giống endpoint Admin ghi vào systemSettings). */
const setTestMode = (repo: MockSheetsAdapter, enabled: boolean) => {
  (repo as any).systemSettings.ev_test_mode = { enabled };
};

test('Đọc cờ Test qua cả repo trực tiếp và adapter Google Sheets (ủy quyền fallback)', () => {
  // Mock / PostgreSQL: systemSettings nằm ngay trên repo.
  assert.equal(isEvTestModeEnabled({ systemSettings: { ev_test_mode: { enabled: true } } }), true);
  assert.equal(isEvTestModeEnabled({ systemSettings: { ev_test_mode: { enabled: false } } }), false);
  assert.equal(isEvTestModeEnabled({ systemSettings: {} }), false);
  // GoogleSheetsAdapter: dữ liệu nằm trong MockSheetsAdapter bên trong.
  assert.equal(isEvTestModeEnabled({ getMockAdapter: () => ({ systemSettings: { ev_test_mode: { enabled: true } } }) }), true);
  assert.equal(isEvTestModeEnabled({ getMockAdapter: () => ({ systemSettings: {} }) }), false);
});

test('Bật Test: bấm điểm ở xa 5km, sai số 2000m, sai thứ tự vẫn được và ca được đánh dấu', async () => {
  const { repo, shift, branch, checkins } = await setup();
  setTestMode(repo, true);
  await repo.updateEVShift(shift.shift_id, { status: 'IN_PROGRESS', actual_start_at: new Date(Date.now() - 3 * 3_600_000).toISOString() });

  const saved = await checkins.checkinStop({
    shiftId: shift.shift_id,
    stopId: branch.stop_id,
    driverLocation: {
      // Cách chi nhánh ~5km, sai số GPS vô lý — chế độ Test bỏ qua hết.
      latitude: north(BRANCH_LAT, 5000),
      longitude: BRANCH_LNG,
      accuracy: 2000,
    },
  });

  assert.equal(saved.stop_order, 2, 'điểm số 2 bấm trước điểm số 1 vẫn được');
  assert.equal(saved.is_late, false, 'chế độ Test không tính trễ');
  assert.equal(saved.penalty_amount, 0, 'chế độ Test không phạt');
  assert.equal(saved.notes, 'TEST_MODE', 'lượt bấm được ghi nhận là test');

  const after = repo.evShifts.find(s => s.shift_id === shift.shift_id);
  assert.ok(String(after?.notes || '').includes(EV_TEST_SHIFT_MARK), 'ca được gắn nhãn TEST_MODE');

  const missed = await checkins.detectMissedStops(shift.shift_id);
  assert.deepEqual(missed, [], 'ca test không bị đánh dấu điểm bỏ lọt');
});

test('Tắt Test: bấm điểm ở xa vẫn bị chặn OUTSIDE_GEOFENCE như quy trình cũ', async () => {
  const { repo, shift, start, branch, checkins } = await setup();
  setTestMode(repo, false);
  await repo.updateEVShift(shift.shift_id, { status: 'IN_PROGRESS' });

  await checkins.checkinStop({
    shiftId: shift.shift_id,
    stopId: start.stop_id,
    driverLocation: { latitude: START_LAT, longitude: START_LNG, accuracy: 10 },
  });

  await assert.rejects(
    () => checkins.checkinStop({
      shiftId: shift.shift_id,
      stopId: branch.stop_id,
      driverLocation: { latitude: north(BRANCH_LAT, 5000), longitude: BRANCH_LNG, accuracy: 10 },
    }),
    /OUTSIDE_GEOFENCE/,
  );
});

test('Bật Test: bắt đầu ca ở xa xưởng vẫn được và ca được đánh dấu', async () => {
  const { repo, shift, shifts } = await setup();
  setTestMode(repo, true);

  const updated = await shifts.startShift(shift.shift_id, {
    latitude: north(START_LAT, 20_000),
    longitude: START_LNG,
    accuracy: 900,
  });

  assert.equal(updated.status, 'IN_PROGRESS');
  assert.ok(String(updated.notes || '').includes(EV_TEST_SHIFT_MARK));
});

test('Ca đã đánh dấu TEST_MODE: kết thúc ca ở xa điểm cuối vẫn được dù Admin đã tắt Test', async () => {
  const { repo, shift, shifts } = await setup();
  setTestMode(repo, false);
  await repo.updateEVShift(shift.shift_id, {
    status: 'IN_PROGRESS',
    actual_start_at: new Date().toISOString(),
    notes: `Chạy thử ${EV_TEST_SHIFT_MARK}`,
  });

  const updated = await shifts.endShift(shift.shift_id, {
    latitude: north(BRANCH_LAT, 15_000),
    longitude: BRANCH_LNG,
    accuracy: 500,
  });
  assert.equal(updated.status, 'COMPLETED');
});

test('Bảng lương bỏ qua ca TEST_MODE: không tính công, không tính phạt', async () => {
  const repo = new MockSheetsAdapter();
  const driverId = 'EMP_DRIVER_TP1';
  repo.employees.push({
    employee_id: driverId,
    employee_code: 'UBM_TP1',
    full_name: 'Tài xế Lương Test',
    employment_status: 'OFFICIAL',
    group: 'XUONG',
  } as any);

  const route = await repo.createEVRoute({ name: 'Tuyến lương test', is_active: true } as any);
  const stop = await repo.createEVRouteStop({
    route_id: route.route_id,
    stop_order: 1,
    name: 'Xưởng',
    latitude: 10.1,
    longitude: 106.1,
    geofence_radius_m: 100,
    sla_minutes: 30,
    stop_type: 'START',
    is_mandatory: true,
  } as any);
  const vehicle = await repo.createEVVehicle({ license_plate: '29H-999.99', assigned_driver_id: driverId } as any);
  const payroll = new EVPayrollService(repo, DEFAULT_EV_PAYROLL_CONFIG, new EVRouteService(repo));

  const addShift = async (day: string, patch: any = {}) => {
    const created = await repo.createEVShift({
      route_id: route.route_id,
      driver_id: driverId,
      vehicle_id: vehicle.vehicle_id,
      shift_date: day,
      planned_start_at: `${day}T08:00:00+07:00`,
      planned_end_at: `${day}T14:00:00+07:00`,
      created_by: 'TEST',
    } as any);
    return Object.keys(patch).length ? repo.updateEVShift(created.shift_id, patch) : created;
  };

  // Ca thật: đã chạy → tính 1 công.
  const real = await addShift('2026-11-02', { status: 'COMPLETED', actual_start_at: '2026-11-02T01:00:00.000Z' });
  await repo.createEVShiftCheckin({
    shift_id: real.shift_id,
    stop_id: stop.stop_id,
    stop_order: 1,
    checked_in_at: '2026-11-02T01:05:00.000Z',
    is_within_geofence: true,
    is_missed: false,
    is_late: false,
  } as any);

  // Ca test: cũng chạy & có điểm bỏ lọt, nhưng bị gắn nhãn TEST_MODE → bỏ qua hoàn toàn.
  const testShift = await addShift('2026-11-03', {
    status: 'COMPLETED',
    actual_start_at: '2026-11-03T01:00:00.000Z',
    notes: `Chạy thử ${EV_TEST_SHIFT_MARK}`,
  });
  await repo.createEVShiftCheckin({
    shift_id: testShift.shift_id,
    stop_id: stop.stop_id,
    stop_order: 1,
    checked_in_at: '2026-11-03T01:40:00.000Z',
    is_within_geofence: true,
    is_missed: true,
    is_late: true,
    late_minutes: 35,
    penalty_amount: 50_000,
  } as any);

  const result = await payroll.calculateDriverPayroll(driverId, '2026-11');

  assert.equal(result.total_shifts, 1, 'ca test bị loại khỏi kỳ lương');
  assert.equal(result.total_work_days, 1);
  assert.equal(result.standard_days, 1);
  assert.equal(result.absent_days, 0, 'ca test không bị coi là vắng');
  assert.equal(result.total_penalty_points, 0);
  assert.equal(result.total_penalty_amount, 0);
});
