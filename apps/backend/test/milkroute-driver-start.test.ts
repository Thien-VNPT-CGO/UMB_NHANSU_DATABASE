import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { EVRouteService } from '../src/services/milkroute/ev-route.service.js';
import { EVShiftService } from '../src/services/milkroute/ev-shift.service.js';
import { EVChargingService } from '../src/services/milkroute/ev-charging.service.js';

/**
 * Tài xế bấm "Bắt đầu ca" và tạo phiếu sạc trên app.
 *
 *  - Bắt đầu/kết thúc ca: nới bán kính Xưởng tối thiểu 500m và sai số GPS
 *    ≤120m (GPS trong cabin hay sai số 30–100m) → không kẹt nút.
 *  - Tạo phiếu sạc: KHÔNG còn bắt buộc check-in Văn phòng; chỉ cần ca của
 *    chính mình, ngày sạc không ở quá khứ.
 */

const VN_OFFSET_MS = 7 * 3_600_000;
const todayVN = () => new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);
const shiftDate = (offsetDays = 0) => {
  const t = new Date(Date.now() + VN_OFFSET_MS + offsetDays * 86_400_000);
  return t.toISOString().slice(0, 10);
};

const START_LAT = 10.908028;
const START_LNG = 106.650444;

/** Dịch lên phía bắc `meters` (1 độ vĩ ≈ 111.32 km). */
const north = (meters: number) => START_LAT + meters / 111_320;

async function setup() {
  const repo = new MockSheetsAdapter();
  repo.employees.push({
    employee_id: 'EMP_DRIVER_S1',
    employee_code: 'UBM_EVS1',
    full_name: 'Tài xế Bắt Ca',
    employment_status: 'OFFICIAL',
    group: 'XUONG',
    default_branch_id: 'XUONG_SX',
  } as any);

  const route = await repo.createEVRoute({ name: 'Tuyến bắt ca', is_active: true } as any);
  for (const s of [
    { stop_order: 1, name: 'Xưởng', latitude: START_LAT, longitude: START_LNG, stop_type: 'START', is_mandatory: true },
    { stop_order: 2, name: 'Điểm giao', latitude: 10.799831, longitude: 106.69337, stop_type: 'DELIVERY', is_mandatory: true },
    { stop_order: 3, name: 'Văn phòng', latitude: 10.80304, longitude: 106.68962, stop_type: 'OFFICE', is_mandatory: true },
    { stop_order: 4, name: 'Trạm sạc', latitude: 0, longitude: 0, stop_type: 'CHARGING', is_mandatory: false },
    { stop_order: 5, name: 'Về xưởng', latitude: START_LAT, longitude: START_LNG, stop_type: 'END', is_mandatory: true },
  ]) {
    await repo.createEVRouteStop({
      route_id: route.route_id,
      geofence_radius_m: 100,
      sla_minutes: 30,
      ...s,
    } as any);
  }

  const vehicle = await repo.createEVVehicle({
    license_plate: '29H-888.88',
    assigned_driver_id: 'EMP_DRIVER_S1',
    status: 'ACTIVE',
  } as any);

  const routes = new EVRouteService(repo);
  const shifts = new EVShiftService(repo, routes);
  const charging = new EVChargingService(repo, routes);

  const makeShift = async (day = shiftDate()) => {
    const shift = await repo.createEVShift({
      route_id: route.route_id,
      driver_id: 'EMP_DRIVER_S1',
      vehicle_id: vehicle.vehicle_id,
      shift_date: day,
      planned_start_at: `${day}T08:00:00+07:00`,
      planned_end_at: `${day}T14:00:00+07:00`,
      created_by: 'TEST',
    } as any);
    return shift;
  };

  return { repo, route, vehicle, routes, shifts, charging, makeShift };
}

test('Bắt đầu ca: GPS sai số 80m, cách Xưởng ~200m vẫn bắt đầu được', async () => {
  const { shifts, makeShift } = await setup();
  const shift = await makeShift();

  const updated = await shifts.startShift(shift.shift_id, {
    latitude: north(200),
    longitude: START_LNG,
    accuracy: 80,
  });
  assert.equal(updated.status, 'IN_PROGRESS');
  assert.ok(updated.actual_start_at, 'ghi nhận giờ bắt đầu ca');
});

test('Bắt đầu ca: sai số GPS quá 120m → báo GPS_ACCURACY_LOW', async () => {
  const { shifts, makeShift } = await setup();
  const shift = await makeShift();

  await assert.rejects(
    () => shifts.startShift(shift.shift_id, { latitude: START_LAT, longitude: START_LNG, accuracy: 200 }),
    /GPS_ACCURACY_LOW/,
  );
});

test('Bắt đầu ca: cách Xưởng hơn 500m → báo OUTSIDE_GEOFENCE', async () => {
  const { shifts, makeShift } = await setup();
  const shift = await makeShift();

  await assert.rejects(
    () => shifts.startShift(shift.shift_id, { latitude: north(900), longitude: START_LNG, accuracy: 10 }),
    /OUTSIDE_GEOFENCE/,
  );
});

test('Kết thúc ca: nới bán kính Xưởng 500m (GPS 150m vẫn đóng ca được)', async () => {
  const { repo, shifts, makeShift } = await setup();
  const shift = await makeShift();
  await repo.updateEVShift(shift.shift_id, { status: 'IN_PROGRESS' });

  const updated = await shifts.endShift(shift.shift_id, {
    latitude: north(150),
    longitude: START_LNG,
    accuracy: 60,
  });
  assert.equal(updated.status, 'COMPLETED');
});

test('Tạo phiếu sạc: không cần check-in Văn phòng, phiếu vào trạng thái PENDING_HR', async () => {
  const { repo, charging, makeShift } = await setup();
  const shift = await makeShift();
  assert.equal(repo.evShiftCheckins.length, 0, 'chưa có check-in nào');

  const ticket = await charging.createChargingTicket({
    shiftId: shift.shift_id,
    requestedDate: shiftDate(1),
    batteryLevelPct: 22,
    notes: 'Sạc sau khi giao xong',
  });
  assert.equal(ticket.status, 'PENDING_HR');
  assert.equal(ticket.driver_id, 'EMP_DRIVER_S1');
  assert.equal(ticket.requested_date, shiftDate(1));
  assert.equal(repo.evChargingTickets.length, 1);
});

test('Tạo phiếu sạc: ngày dự kiến đã qua → DATE_IN_PAST', async () => {
  const { charging, makeShift } = await setup();
  const shift = await makeShift();

  await assert.rejects(
    () => charging.createChargingTicket({ shiftId: shift.shift_id, requestedDate: shiftDate(-1) }),
    /DATE_IN_PAST/,
  );
});

test('Tạo phiếu sạc: ca đã hủy → SHIFT_CANCELLED', async () => {
  const { repo, charging, makeShift } = await setup();
  const shift = await makeShift();
  await repo.updateEVShift(shift.shift_id, { status: 'CANCELLED' });

  await assert.rejects(
    () => charging.createChargingTicket({ shiftId: shift.shift_id, requestedDate: todayVN() }),
    /SHIFT_CANCELLED/,
  );
});

test('Tạo phiếu sạc trùng ngày → TICKET_EXISTS', async () => {
  const { charging, makeShift } = await setup();
  const shift = await makeShift();
  const day = shiftDate(2);
  await charging.createChargingTicket({ shiftId: shift.shift_id, requestedDate: day });

  await assert.rejects(
    () => charging.createChargingTicket({ shiftId: shift.shift_id, requestedDate: day }),
    /TICKET_EXISTS/,
  );
});
