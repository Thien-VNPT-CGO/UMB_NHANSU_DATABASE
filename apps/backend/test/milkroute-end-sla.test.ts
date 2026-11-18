import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { EVRouteService } from '../src/services/milkroute/ev-route.service.js';
import { EVShiftService } from '../src/services/milkroute/ev-shift.service.js';
import { EVCheckinService } from '../src/services/milkroute/ev-checkin.service.js';
import { effectiveEndSlaMinutes } from '@ubm/shared';

/**
 * Điểm cuối có 2 mốc thời gian tùy chỉnh:
 *  - Có phiếu sạc: tính từ lúc kết thúc sạc đến điểm cuối.
 *  - Không có phiếu sạc: tính từ lần check-in chi nhánh cuối đến điểm cuối.
 * Dữ liệu cũ chỉ có `sla_minutes` vẫn phải chạy như trước.
 */

const VN_OFFSET_MS = 7 * 3_600_000;
const todayVN = () => new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

async function setup() {
  const repo = new MockSheetsAdapter();
  repo.employees.push({
    employee_id: 'EMP_END_SLA',
    employee_code: 'UBM_END01',
    full_name: 'Tài xế Điểm Cuối',
    employment_status: 'ACTIVE',
    group: 'XUONG',
    default_branch_id: 'XUONG_SX',
  } as any);

  const route = await repo.createEVRoute({ name: 'Tuyến điểm cuối', is_active: true } as any);
  const start = await repo.createEVRouteStop({
    route_id: route.route_id,
    stop_order: 1,
    name: 'Điểm xuất phát',
    latitude: 10.1,
    longitude: 106.1,
    geofence_radius_m: 100,
    sla_minutes: 0,
    stop_type: 'START',
    is_mandatory: true,
  } as any);
  const branch = await repo.createEVRouteStop({
    route_id: route.route_id,
    stop_order: 2,
    name: 'Điểm giao cuối',
    latitude: 10.2,
    longitude: 106.2,
    geofence_radius_m: 100,
    sla_minutes: 20,
    stop_type: 'DELIVERY',
    is_mandatory: true,
  } as any);
  const charging = await repo.createEVRouteStop({
    route_id: route.route_id,
    stop_order: 3,
    name: 'Trạm sạc',
    latitude: 10.3,
    longitude: 106.3,
    geofence_radius_m: 100,
    sla_minutes: 10,
    stop_type: 'CHARGING',
    is_mandatory: false,
  } as any);
  const end = await repo.createEVRouteStop({
    route_id: route.route_id,
    stop_order: 4,
    name: 'Điểm kết thúc',
    latitude: 10.4,
    longitude: 106.4,
    geofence_radius_m: 100,
    sla_minutes: 30,
    sla_minutes_with_charging: 25,
    sla_minutes_without_charging: 15,
    stop_type: 'END',
    is_mandatory: true,
  } as any);

  const vehicle = await repo.createEVVehicle({ license_plate: '29H-END.01' } as any);
  const shift = await repo.createEVShift({
    route_id: route.route_id,
    driver_id: 'EMP_END_SLA',
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

  return { repo, route, start, branch, charging, end, vehicle, shift, routes, shifts, checkins };
}

async function addPastCheckin(repo: MockSheetsAdapter, shiftId: string, stop: any, agoMin: number) {
  return repo.createEVShiftCheckin({
    shift_id: shiftId,
    stop_id: stop.stop_id,
    stop_order: stop.stop_order,
    stop_name: stop.name,
    checked_in_at: minutesAgo(agoMin),
    latitude: stop.latitude,
    longitude: stop.longitude,
    distance_m: 0,
    is_within_geofence: true,
    sla_minutes: stop.sla_minutes,
    actual_travel_min: 0,
    is_late: false,
    late_minutes: 0,
    penalty_amount: 0,
    is_missed: false,
  } as any);
}

async function addChargingTicket(repo: MockSheetsAdapter, shiftId: string, endedAgoMin: number) {
  const ticket = await repo.createEVChargingTicket({
    shift_id: shiftId,
    driver_id: 'EMP_END_SLA',
    requested_date: todayVN(),
  } as any);
  return repo.updateEVChargingTicket(ticket.ticket_id, {
    status: 'USED',
    charging_end_at: minutesAgo(endedAgoMin),
  } as any);
}

test('điểm cuối không có phiếu sạc: dùng mốc "từ chi nhánh" và tính trễ theo mốc đó', async () => {
  const { repo, shift, start, branch, end, shifts, checkins } = await setup();
  await addPastCheckin(repo, shift.shift_id, start, 60);
  await addPastCheckin(repo, shift.shift_id, branch, 30);

  const detail = await shifts.getShiftDetail(shift.shift_id);
  const endStop: any = detail?.stops.find((s: any) => s.stop_id === end.stop_id);
  assert.equal(endStop.sla_minutes, 15, 'hiển thị SLA từ chi nhánh');
  assert.equal(endStop.slaFromCharging, false);

  const saved = await checkins.checkinStop({
    shiftId: shift.shift_id,
    stopId: end.stop_id,
    driverLocation: { latitude: end.latitude, longitude: end.longitude, accuracy: 5 },
  });
  assert.equal(saved.sla_minutes, 15, 'lưu SLA hiệu lực của trường hợp không sạc');
  assert.equal(saved.is_late, true);
  assert.equal(saved.late_minutes, 15, 'trễ 30 phút so với mốc 15 phút');
});

test('điểm cuối có phiếu sạc: dùng mốc "từ trạm sạc" tính từ lúc kết thúc sạc', async () => {
  const { repo, shift, start, branch, end, shifts, checkins } = await setup();
  await addPastCheckin(repo, shift.shift_id, start, 90);
  await addPastCheckin(repo, shift.shift_id, branch, 80);
  await addChargingTicket(repo, shift.shift_id, 20);

  const detail = await shifts.getShiftDetail(shift.shift_id);
  const endStop: any = detail?.stops.find((s: any) => s.stop_id === end.stop_id);
  assert.equal(endStop.sla_minutes, 25, 'hiển thị SLA từ trạm sạc');
  assert.equal(endStop.slaFromCharging, true);
  assert.ok(endStop.slaBaseAt, 'có mốc bắt đầu tính SLA từ lúc kết thúc sạc');

  const saved = await checkins.checkinStop({
    shiftId: shift.shift_id,
    stopId: end.stop_id,
    driverLocation: { latitude: end.latitude, longitude: end.longitude, accuracy: 5 },
  });
  assert.equal(saved.sla_minutes, 25, 'lưu SLA hiệu lực của trường hợp có sạc');
  assert.equal(saved.actual_travel_min, 20, 'tính từ lúc kết thúc sạc, không phải từ lần check-in trước');
  assert.equal(saved.is_late, false, '20 phút ≤ 25 phút nên không trễ');
});

test('điểm cuối có phiếu sạc: quá mốc "từ trạm sạc" vẫn tính trễ đúng', async () => {
  const { repo, shift, start, branch, end, checkins } = await setup();
  await addPastCheckin(repo, shift.shift_id, start, 120);
  await addPastCheckin(repo, shift.shift_id, branch, 110);
  await addChargingTicket(repo, shift.shift_id, 40);

  const saved = await checkins.checkinStop({
    shiftId: shift.shift_id,
    stopId: end.stop_id,
    driverLocation: { latitude: end.latitude, longitude: end.longitude, accuracy: 5 },
  });
  assert.equal(saved.sla_minutes, 25);
  assert.equal(saved.is_late, true);
  assert.equal(saved.late_minutes, 15, '40 phút - 25 phút = 15 phút trễ');
});

test('dữ liệu cũ chỉ có sla_minutes: cả 2 trường hợp đều dùng mốc chung', async () => {
  const { repo, shift, start, branch, end, shifts, checkins } = await setup();
  await repo.updateEVRouteStop(end.stop_id, {
    sla_minutes: 18,
    sla_minutes_with_charging: undefined,
    sla_minutes_without_charging: undefined,
  } as any);
  await addPastCheckin(repo, shift.shift_id, start, 60);
  await addPastCheckin(repo, shift.shift_id, branch, 40);
  await addChargingTicket(repo, shift.shift_id, 10);

  const detail = await shifts.getShiftDetail(shift.shift_id);
  const endStop: any = detail?.stops.find((s: any) => s.stop_id === end.stop_id);
  assert.equal(endStop.sla_minutes, 18);

  const saved = await checkins.checkinStop({
    shiftId: shift.shift_id,
    stopId: end.stop_id,
    driverLocation: { latitude: end.latitude, longitude: end.longitude, accuracy: 5 },
  });
  assert.equal(saved.sla_minutes, 18);
  assert.equal(saved.actual_travel_min, 10);
  assert.equal(saved.is_late, false);
});

test('helper SLA điểm cuối: ưu tiên mốc riêng, thiếu thì fallback sla_minutes', () => {
  const base = { stop_type: 'END' as const, sla_minutes: 30 };
  assert.equal(effectiveEndSlaMinutes({ ...base, sla_minutes_with_charging: 12 }, true), 12);
  assert.equal(effectiveEndSlaMinutes({ ...base, sla_minutes_without_charging: 18 }, false), 18);
  assert.equal(effectiveEndSlaMinutes(base, true), 30);
  assert.equal(effectiveEndSlaMinutes(base, false), 30);
  assert.equal(effectiveEndSlaMinutes({ stop_type: 'DELIVERY', sla_minutes: 7, sla_minutes_with_charging: 99 }, true), 7);
});
