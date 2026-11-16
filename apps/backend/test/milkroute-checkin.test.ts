import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { EVRouteService } from '../src/services/milkroute/ev-route.service.js';
import { EVShiftService } from '../src/services/milkroute/ev-shift.service.js';
import { EVCheckinService } from '../src/services/milkroute/ev-checkin.service.js';
import { evCheckinBody } from '../src/validators/milkroute.validator.js';

/**
 * Tài xế bấm xác nhận khi đến chi nhánh.
 *
 * Trước đây app chặn tuyệt đối sai số GPS ≤30m và đúng bán kính 100m nên tài
 * xế đứng tại cửa hàng (GPS trong nhà/khu phố sai số 50–200m) không bấm được.
 * Nay bán kính điểm dừng lấy theo cấu hình chi nhánh (≥300m) + dung sai theo
 * sai số thiết bị (tối đa 100m); chỉ chặn khi GPS hỏng hẳn (>1000m).
 */

const VN_OFFSET_MS = 7 * 3_600_000;
const todayVN = () => new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);

const START_LAT = 10.908028;
const START_LNG = 106.650444;
const BRANCH_LAT = 10.799831;
const BRANCH_LNG = 106.693370;

/** Dịch lên phía bắc `meters` (1 độ vĩ ≈ 111.32 km). */
const north = (lat: number, meters: number) => lat + meters / 111_320;

async function setup() {
  const repo = new MockSheetsAdapter();
  repo.employees.push({
    employee_id: 'EMP_DRIVER_C1',
    employee_code: 'UBM_EVC1',
    full_name: 'Tài xế Bấm Điểm',
    employment_status: 'OFFICIAL',
    group: 'XUONG',
    default_branch_id: 'XUONG_SX',
  } as any);

  const route = await repo.createEVRoute({ name: 'Tuyến bấm điểm', is_active: true } as any);
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
    license_plate: '29H-777.77',
    assigned_driver_id: 'EMP_DRIVER_C1',
    status: 'ACTIVE',
  } as any);
  const shift = await repo.createEVShift({
    route_id: route.route_id,
    driver_id: 'EMP_DRIVER_C1',
    vehicle_id: vehicle.vehicle_id,
    shift_date: todayVN(),
    planned_start_at: `${todayVN()}T08:00:00+07:00`,
    planned_end_at: `${todayVN()}T14:00:00+07:00`,
    created_by: 'TEST',
  } as any);
  await repo.updateEVShift(shift.shift_id, { status: 'IN_PROGRESS' });

  const routes = new EVRouteService(repo);
  const shifts = new EVShiftService(repo, routes);
  const checkins = new EVCheckinService(repo, routes);

  return { repo, route, start, branch, vehicle, shift, routes, shifts, checkins };
}

test('Bán kính điểm chi nhánh lấy theo cấu hình chi nhánh (300m), không còn kẹt 100m', async () => {
  const { shift, shifts } = await setup();
  const detail = await shifts.getShiftDetail(shift.shift_id);
  const branchStop: any = detail?.stops.find((s: any) => s.name === 'Cửa hàng CH130');
  assert.equal(branchStop.geofence_radius_m, 300, 'nới theo bán kính chi nhánh');
});

test('Bấm điểm tại chi nhánh: sai số GPS 80m, cách 330m vẫn xác nhận được', async () => {
  const { shift, start, branch, checkins } = await setup();

  await checkins.checkinStop({
    shiftId: shift.shift_id,
    stopId: start.stop_id,
    driverLocation: { latitude: START_LAT, longitude: START_LNG, accuracy: 70 },
  });

  const saved = await checkins.checkinStop({
    shiftId: shift.shift_id,
    stopId: branch.stop_id,
    driverLocation: {
      latitude: north(BRANCH_LAT, 330),
      longitude: BRANCH_LNG,
      accuracy: 80,
    },
  });
  assert.equal(saved.stop_order, 2);
  assert.equal(saved.is_within_geofence, false, 'ngoài bán kính gốc nhưng trong dung sai → vẫn ghi nhận');
});

test('Bấm điểm tại chi nhánh: GPS hỏng hẳn (>1000m) vẫn bị chặn', async () => {
  const { shift, start, branch, checkins } = await setup();

  await checkins.checkinStop({
    shiftId: shift.shift_id,
    stopId: start.stop_id,
    driverLocation: { latitude: START_LAT, longitude: START_LNG, accuracy: 10 },
  });

  await assert.rejects(
    () => checkins.checkinStop({
      shiftId: shift.shift_id,
      stopId: branch.stop_id,
      driverLocation: { latitude: BRANCH_LAT, longitude: BRANCH_LNG, accuracy: 1200 },
    }),
    /GPS_ACCURACY_LOW/,
  );
});

test('Bấm điểm tại chi nhánh: đứng cách quá xa (600m) vẫn báo OUTSIDE_GEOFENCE', async () => {
  const { shift, start, checkins, branch } = await setup();

  await checkins.checkinStop({
    shiftId: shift.shift_id,
    stopId: start.stop_id,
    driverLocation: { latitude: START_LAT, longitude: START_LNG, accuracy: 10 },
  });

  await assert.rejects(
    () => checkins.checkinStop({
      shiftId: shift.shift_id,
      stopId: branch.stop_id,
      driverLocation: { latitude: north(BRANCH_LAT, 600), longitude: BRANCH_LNG, accuracy: 10 },
    }),
    /OUTSIDE_GEOFENCE/,
  );
});

test('Đang sạc (CHARGING) vẫn bấm xác nhận điểm được — app vẫn hiện nút', async () => {
  const { repo, shift, start, checkins } = await setup();
  await repo.updateEVShift(shift.shift_id, { status: 'CHARGING' });

  const saved = await checkins.checkinStop({
    shiftId: shift.shift_id,
    stopId: start.stop_id,
    driverLocation: { latitude: START_LAT, longitude: START_LNG, accuracy: 40 },
  });
  assert.equal(saved.stop_order, 1);
});

test('Validator: sai số GPS 50–500m vẫn gửi được để service báo lỗi tiếng Việt', () => {
  const base = { shift_id: 'SHIFT_1', stop_id: 'STOP_1', latitude: 10.9, longitude: 106.6 };
  for (const accuracy of [8, 50, 120, 500]) {
    assert.equal(evCheckinBody.safeParse({ ...base, accuracy }).success, true, `accuracy ${accuracy} phải qua validator`);
  }
  assert.equal(evCheckinBody.safeParse({ ...base, accuracy: 6000 }).success, false, 'giá trị vô lý vẫn bị chặn');
});
