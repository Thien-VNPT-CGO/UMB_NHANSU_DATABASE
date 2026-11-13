import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { EVGPSService } from '../src/services/milkroute/ev-gps.service.js';

/**
 * Live Map: xe xuất hiện ngay khi tài xế mở app (chưa cần bắt đầu ca).
 *
 * - Tài xế đã được gán xe + đăng nhập gửi GPS → Quản lý vận chuyển / HR /
 *   Kế toán / Giám đốc thấy xe trên bản đồ.
 * - Vị trí chỉ còn hiển thị 5 phút kể từ lần gửi cuối.
 * - Chỉ điểm thuộc ca đang chạy mới ghi vào lịch sử ca (không làm sai quãng đường).
 */

const DRIVER_ID = 'EMP_LIVE_1';

async function setup() {
  const repo = new MockSheetsAdapter();
  repo.employees.push({
    employee_id: DRIVER_ID,
    employee_code: 'UBM_LIVE1',
    full_name: 'Tài xế Live',
    employment_status: 'OFFICIAL',
    group: 'XUONG',
  } as any);

  const vehicle = await repo.createEVVehicle({
    license_plate: '29H-999.99',
    assigned_driver_id: DRIVER_ID,
    current_battery_pct: 80,
    status: 'ACTIVE',
  } as any);

  const route = await repo.createEVRoute({ name: 'Tuyến live', is_active: true } as any);
  await repo.createEVRouteStop({
    route_id: route.route_id,
    stop_order: 1,
    name: 'Xưởng',
    latitude: 10.1,
    longitude: 106.1,
    stop_type: 'START',
    is_mandatory: true,
    geofence_radius_m: 100,
    sla_minutes: 30,
  } as any);

  const gps = new EVGPSService(repo);
  return { repo, vehicle, route, gps };
}

function isoAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

test('Tài xế đăng nhập gửi GPS (chưa có ca) → xe hiện trên Live Map', async () => {
  const { vehicle, gps } = await setup();

  const r = await gps.ingestGPSPoints([{
    driverId: DRIVER_ID,
    recordedAt: new Date().toISOString(),
    latitude: 10.77,
    longitude: 106.7,
    speed: 12,
    battery: 79,
  }]);
  assert.equal(r.saved, 1);
  assert.equal(r.failed, 0);

  const live = await gps.getLiveVehicles();
  assert.equal(live.length, 1, 'xe phải xuất hiện dù chưa bắt đầu ca');
  assert.equal(live[0].vehicleId, vehicle.vehicle_id);
  assert.equal(live[0].shiftId, '', 'chưa vào ca nên không gắn ca');
  assert.equal(live[0].isOnline, true);
  assert.equal(live[0].driverName, 'Tài xế Live');
  assert.equal(live[0].licensePlate, '29H-999.99');
});

test('Tài xế chưa được gán xe → không gửi được GPS', async () => {
  const { repo, gps } = await setup();
  repo.employees.push({
    employee_id: 'EMP_LIVE_NO_CAR',
    full_name: 'Tài xế chưa xe',
    employment_status: 'OFFICIAL',
    group: 'XUONG',
  } as any);

  const r = await gps.ingestGPSPoints([{
    driverId: 'EMP_LIVE_NO_CAR',
    recordedAt: new Date().toISOString(),
    latitude: 10.7,
    longitude: 106.7,
  }]);
  assert.equal(r.saved, 0);
  assert.equal(r.failed, 1);
  assert.equal((await gps.getLiveVehicles()).length, 0);
});

test('Vị trí quá 5 phút → xe biến khỏi Live Map', async () => {
  const { gps } = await setup();
  await gps.ingestGPSPoints([{
    driverId: DRIVER_ID,
    recordedAt: isoAgo(6),
    latitude: 10.7,
    longitude: 106.7,
  }]);
  assert.equal((await gps.getLiveVehicles()).length, 0, 'GPS cũ hơn 5 phút không còn hiển thị');
});

test('Điểm GPS thuộc ca đang chạy → lưu lịch sử ca + Live Map có shiftId', async () => {
  const { repo, route, vehicle, gps } = await setup();
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  const shift = await repo.createEVShift({
    route_id: route.route_id,
    driver_id: DRIVER_ID,
    vehicle_id: vehicle.vehicle_id,
    shift_date: today,
    planned_start_at: `${today}T08:00:00+07:00`,
    planned_end_at: `${today}T14:00:00+07:00`,
    status: 'IN_PROGRESS',
    created_by: 'TEST',
  } as any);
  await repo.updateEVShift(shift.shift_id, { status: 'IN_PROGRESS' });

  await gps.ingestGPSPoints([{
    shiftId: shift.shift_id,
    driverId: DRIVER_ID,
    recordedAt: new Date().toISOString(),
    latitude: 10.8,
    longitude: 106.8,
  }]);

  const history = await gps.getShiftGPSHistory(shift.shift_id);
  assert.equal(history.length, 1, 'ca đang chạy phải lưu lịch sử GPS');

  const live = await gps.getLiveVehicles();
  assert.equal(live.length, 1);
  assert.equal(live[0].shiftId, shift.shift_id);
  assert.equal(live[0].shiftStatus, 'IN_PROGRESS');
});

test('Ngoài ca không ghi vào lịch sử ca', async () => {
  const { repo, route, vehicle, gps } = await setup();
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  const shift = await repo.createEVShift({
    route_id: route.route_id,
    driver_id: DRIVER_ID,
    vehicle_id: vehicle.vehicle_id,
    shift_date: today,
    planned_start_at: `${today}T08:00:00+07:00`,
    status: 'SCHEDULED',
    created_by: 'TEST',
  } as any);

  await gps.ingestGPSPoints([{
    shiftId: shift.shift_id,
    driverId: DRIVER_ID,
    recordedAt: new Date().toISOString(),
    latitude: 10.81,
    longitude: 106.81,
  }]);

  assert.equal((await gps.getShiftGPSHistory(shift.shift_id)).length, 0);
  const live = await gps.getLiveVehicles();
  assert.equal(live.length, 1, 'vẫn hiển thị vị trí trên Live Map');
  assert.equal(live[0].shiftStatus, 'SCHEDULED');
});
