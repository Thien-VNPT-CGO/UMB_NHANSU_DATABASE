import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { EVRouteService } from '../src/services/milkroute/ev-route.service.js';
import { EVShiftService } from '../src/services/milkroute/ev-shift.service.js';
import { EVCheckinService } from '../src/services/milkroute/ev-checkin.service.js';

/**
 * TRẠM SẠC KHÔNG CỐ ĐỊNH.
 *
 * Tài xế bấm nút Điểm tại trạm sạc → gửi GPS hiện tại, hệ thống lưu tạm.
 * Đủ 3 lần GPS trùng toạ độ (dung sai 50m) mới ghi nhớ vị trí trạm và thay
 * thế điểm sạc cũ. Trước 3 lần, điểm sạc vẫn là điểm kế tiếp (chưa check-in).
 */

const VN_OFFSET_MS = 7 * 3_600_000;
const todayVN = () => new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);

const START_LAT = 10.908028;
const START_LNG = 106.650444;
const BRANCH_LAT = 10.799831;
const BRANCH_LNG = 106.693370;
const STATION_LAT = 10.82;
const STATION_LNG = 106.71;

/** Dịch lên phía bắc `meters` (1 độ vĩ ≈ 111.32 km). */
const north = (lat: number, meters: number) => lat + meters / 111_320;

async function setup() {
  const repo = new MockSheetsAdapter();
  repo.employees.push({
    employee_id: 'EMP_CHARGING_POINT',
    employee_code: 'UBM_EVCP',
    full_name: 'Tài xế Trạm Sạc',
    employment_status: 'OFFICIAL',
    group: 'XUONG',
    default_branch_id: 'XUONG_SX',
  } as any);

  const route = await repo.createEVRoute({ name: 'Tuyến trạm sạc', is_active: true } as any);
  const start = await repo.createEVRouteStop({
    route_id: route.route_id,
    stop_order: 1,
    name: 'Xưởng',
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
    latitude: BRANCH_LAT,
    longitude: BRANCH_LNG,
    geofence_radius_m: 100,
    sla_minutes: 30,
    stop_type: 'DELIVERY',
    is_mandatory: true,
  } as any);
  const charging = await repo.createEVRouteStop({
    route_id: route.route_id,
    stop_order: 3,
    name: 'Trạm sạc',
    latitude: 0,
    longitude: 0,
    geofence_radius_m: 100,
    sla_minutes: 20,
    stop_type: 'CHARGING',
    is_mandatory: false,
  } as any);
  const end = await repo.createEVRouteStop({
    route_id: route.route_id,
    stop_order: 4,
    name: 'Về xưởng',
    latitude: START_LAT,
    longitude: START_LNG,
    geofence_radius_m: 100,
    sla_minutes: 30,
    stop_type: 'END',
    is_mandatory: true,
  } as any);

  const vehicle = await repo.createEVVehicle({
    license_plate: '29H-CP.01',
    assigned_driver_id: 'EMP_CHARGING_POINT',
    status: 'ACTIVE',
  } as any);
  const shift = await repo.createEVShift({
    route_id: route.route_id,
    driver_id: 'EMP_CHARGING_POINT',
    vehicle_id: vehicle.vehicle_id,
    shift_date: todayVN(),
    planned_start_at: `${todayVN()}T08:00:00+07:00`,
    planned_end_at: `${todayVN()}T14:00:00+07:00`,
    created_by: 'TEST',
  } as any);
  await repo.updateEVShift(shift.shift_id, { status: 'IN_PROGRESS' });

  // Phiếu sạc đã duyệt → trạm sạc mới hiện trên lộ trình hiệu lực của ca.
  const ticket = await repo.createEVChargingTicket({
    shift_id: shift.shift_id,
    driver_id: 'EMP_CHARGING_POINT',
    requested_date: todayVN(),
  } as any);
  await repo.updateEVChargingTicket(ticket.ticket_id, { status: 'APPROVED' } as any);

  const routes = new EVRouteService(repo);
  const shifts = new EVShiftService(repo, routes);
  const checkins = new EVCheckinService(repo, routes);

  const checkin = (stopId: string, lat: number, lng: number, accuracy = 10) =>
    checkins.checkinStop({
      shiftId: shift.shift_id,
      stopId,
      driverLocation: { latitude: lat, longitude: lng, accuracy },
    });

  return { repo, route, start, branch, charging, end, vehicle, shift, routes, shifts, checkins, checkin };
}

/** Bấm điểm ở 2 điểm bắt buộc trước trạm sạc để đúng thứ tự. */
async function completeBeforeCharging(ctx: Awaited<ReturnType<typeof setup>>) {
  await ctx.checkin(ctx.start.stop_id, START_LAT, START_LNG);
  await ctx.checkin(ctx.branch.stop_id, BRANCH_LAT, BRANCH_LNG);
}

test('Bấm điểm sạc lần 1: lưu tạm GPS, chưa check-in và chưa ghi nhớ trạm', async () => {
  const ctx = await setup();
  await completeBeforeCharging(ctx);

  const saved = await ctx.checkin(ctx.charging.stop_id, STATION_LAT, STATION_LNG);

  assert.equal(saved.charging_pending_count, 1);
  assert.equal(saved.charging_confirmed, false);
  assert.equal(saved.is_repeat, true, 'chỉ lưu tạm, chưa tạo check-in');
  assert.equal(ctx.repo.evShiftCheckins.some(c => c.stop_id === ctx.charging.stop_id), false);

  const stop = ctx.repo.evRouteStops.find(s => s.stop_id === ctx.charging.stop_id)!;
  assert.equal(stop.charging_pending_count, 1);
  assert.equal(stop.charging_pending_latitude, STATION_LAT);
  assert.equal(stop.charging_confirmed_at, undefined);
  assert.equal(stop.latitude, 0, 'chưa đủ 3 lần nên toạ độ trạm giữ nguyên');
  assert.equal(stop.longitude, 0);
});

test('Bấm đủ 3 lần cùng toạ độ: lần 3 chốt vị trí trạm và hoàn tất điểm sạc', async () => {
  const ctx = await setup();
  await completeBeforeCharging(ctx);

  await ctx.checkin(ctx.charging.stop_id, STATION_LAT, STATION_LNG);
  const second = await ctx.checkin(ctx.charging.stop_id, north(STATION_LAT, 20), STATION_LNG);
  assert.equal(second.charging_pending_count, 2);
  assert.equal(second.charging_confirmed, false);
  assert.equal(ctx.repo.evShiftCheckins.some(c => c.stop_id === ctx.charging.stop_id), false);

  const third = await ctx.checkin(ctx.charging.stop_id, STATION_LAT, STATION_LNG);
  assert.equal(third.charging_pending_count, 3);
  assert.equal(third.charging_confirmed, true);
  assert.equal(third.is_repeat, false, 'lần 3 tạo check-in thật');
  assert.equal(ctx.repo.evShiftCheckins.filter(c => c.stop_id === ctx.charging.stop_id).length, 1);

  const stop = ctx.repo.evRouteStops.find(s => s.stop_id === ctx.charging.stop_id)!;
  assert.equal(stop.latitude, STATION_LAT);
  assert.equal(stop.longitude, STATION_LNG);
  assert.ok(stop.charging_confirmed_at, 'đã ghi nhớ thời điểm xác nhận');
  assert.equal(stop.charging_pending_count, 3);

  const detail = await ctx.shifts.getShiftDetail(ctx.shift.shift_id);
  const chargingStop: any = detail?.stops.find((s: any) => s.stop_id === ctx.charging.stop_id);
  assert.equal(chargingStop.chargingPendingCount, 3);
  assert.equal(chargingStop.chargingConfirmed, true);
  assert.equal(chargingStop.isCompleted, true);
});

test('Điểm sạc mới ở chỗ khác phải đủ 3 lần mới thay điểm sạc cũ', async () => {
  const ctx = await setup();
  await completeBeforeCharging(ctx);

  // Chốt trạm A.
  await ctx.checkin(ctx.charging.stop_id, STATION_LAT, STATION_LNG);
  await ctx.checkin(ctx.charging.stop_id, STATION_LAT, STATION_LNG);
  await ctx.checkin(ctx.charging.stop_id, STATION_LAT, STATION_LNG);

  // Chuyển sang trạm B cách A ~1.1km: lần 1 chỉ lưu tạm, trạm A vẫn được giữ.
  const NEW_LAT = north(STATION_LAT, 1100);
  const firstNew = await ctx.checkin(ctx.charging.stop_id, NEW_LAT, STATION_LNG);
  assert.equal(firstNew.charging_pending_count, 1);
  assert.equal(firstNew.charging_confirmed, false);
  let stop = ctx.repo.evRouteStops.find(s => s.stop_id === ctx.charging.stop_id)!;
  assert.equal(stop.latitude, STATION_LAT, 'trạm cũ vẫn giữ cho tới khi đủ 3 lần');
  assert.equal(stop.longitude, STATION_LNG);

  await ctx.checkin(ctx.charging.stop_id, NEW_LAT, STATION_LNG);
  const thirdNew = await ctx.checkin(ctx.charging.stop_id, NEW_LAT, STATION_LNG);
  assert.equal(thirdNew.charging_confirmed, true);

  stop = ctx.repo.evRouteStops.find(s => s.stop_id === ctx.charging.stop_id)!;
  assert.equal(stop.latitude, NEW_LAT, 'điểm sạc mới thay thế điểm cũ');
  assert.equal(stop.longitude, STATION_LNG);
  assert.equal(ctx.repo.evShiftCheckins.filter(c => c.stop_id === ctx.charging.stop_id).length, 1, 'không tạo trùng check-in');
});

test('Bấm lại trạm sạc đã ghi nhớ: xác nhận ngay, không tạo check-in trùng', async () => {
  const ctx = await setup();
  await completeBeforeCharging(ctx);

  await ctx.checkin(ctx.charging.stop_id, STATION_LAT, STATION_LNG);
  await ctx.checkin(ctx.charging.stop_id, STATION_LAT, STATION_LNG);
  await ctx.checkin(ctx.charging.stop_id, STATION_LAT, STATION_LNG);

  const again = await ctx.checkin(ctx.charging.stop_id, north(STATION_LAT, 10), STATION_LNG);
  assert.equal(again.charging_confirmed, true);
  assert.equal(again.is_repeat, true);
  assert.equal(ctx.repo.evShiftCheckins.filter(c => c.stop_id === ctx.charging.stop_id).length, 1);
});

test('Trạm sạc không kiểm tra geofence: GPS ở xa toạ độ cấu hình (0,0) vẫn ghi nhận', async () => {
  const ctx = await setup();
  await completeBeforeCharging(ctx);

  // Toạ độ (0,0) ở Ghana; GPS thực tế ở TP.HCM vẫn phải bấm được.
  const saved = await ctx.checkin(ctx.charging.stop_id, STATION_LAT, STATION_LNG);
  assert.equal(saved.charging_pending_count, 1);
  assert.equal(saved.is_within_geofence, true);
});
