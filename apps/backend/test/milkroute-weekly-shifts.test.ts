import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { EVRouteService } from '../src/services/milkroute/ev-route.service.js';
import { EVShiftService } from '../src/services/milkroute/ev-shift.service.js';

/**
 * Ca vận chuyển tự động theo tuần + ẩn/hiện trạm sạc theo phiếu sạc.
 *
 *  - Trạm sạc chỉ nằm trên lộ trình của ca khi tài xế đã tạo phiếu sạc.
 *  - Hệ thống tạo sẵn ca 1 tuần (T2→CN, 08:00–14:00); ngày đã có ca (kể cả ca
 *    admin đã sửa) được giữ nguyên.
 *  - Sửa ca sang ngày trùng lịch của tài xế/xe bị chặn.
 */

const VN_OFFSET_MS = 7 * 3_600_000;
const todayVN = () => new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);

async function setup() {
  const repo = new MockSheetsAdapter();

  repo.employees.push({
    employee_id: 'EMP_DRIVER_W1',
    employee_code: 'UBM_EVW1',
    full_name: 'Tài xế Tuần',
    employment_status: 'OFFICIAL',
    group: 'XUONG',
    default_branch_id: 'XUONG_SX',
  } as any);
  repo.employees.push({
    employee_id: 'EMP_DRIVER_W2',
    employee_code: 'UBM_EVW2',
    full_name: 'Tài xế Chưa Xe',
    employment_status: 'OFFICIAL',
    group: 'XUONG',
    default_branch_id: 'XUONG_SX',
  } as any);

  const route = await repo.createEVRoute({ name: 'Tuyến tuần', is_active: true } as any);
  const stops: any[] = [];
  for (const s of [
    { stop_order: 1, name: 'Xưởng', latitude: 10.1, longitude: 106.1, stop_type: 'START', is_mandatory: true },
    { stop_order: 2, name: 'Điểm giao', latitude: 10.2, longitude: 106.2, stop_type: 'DELIVERY', is_mandatory: true },
    { stop_order: 3, name: 'Trạm sạc', latitude: 0, longitude: 0, stop_type: 'CHARGING', is_mandatory: false },
    { stop_order: 4, name: 'Về xưởng', latitude: 10.1, longitude: 106.1, stop_type: 'END', is_mandatory: true },
  ]) {
    stops.push(await repo.createEVRouteStop({
      route_id: route.route_id,
      geofence_radius_m: 100,
      sla_minutes: 30,
      ...s,
    } as any));
  }

  const vehicle = await repo.createEVVehicle({
    license_plate: '29H-777.77',
    assigned_driver_id: 'EMP_DRIVER_W1',
    status: 'ACTIVE',
  } as any);

  const routes = new EVRouteService(repo);
  const shifts = new EVShiftService(repo, routes);

  return { repo, route, stops, vehicle, routes, shifts };
}

function shiftStub(routeId: string, day: string, shiftId = 'SHIFT_W1'): any {
  return {
    shift_id: shiftId,
    route_id: routeId,
    driver_id: 'EMP_DRIVER_W1',
    vehicle_id: 'VEH_1',
    shift_date: day,
    planned_start_at: `${day}T08:00:00+07:00`,
    status: 'IN_PROGRESS',
    penalty_points: 0,
    penalty_amount: 0,
    net_pay: 0,
    created_by: 'TEST',
    created_at: `${day}T00:00:00.000Z`,
    updated_at: `${day}T00:00:00.000Z`,
    version: 1,
  };
}

test('Trạm sạc chỉ hiện trên lộ trình khi ca có phiếu sạc', async () => {
  const { repo, route, routes } = await setup();
  const day = todayVN();
  const shift = shiftStub(route.route_id, day);

  // Chưa có phiếu → ẩn trạm sạc.
  let stops = await routes.getEffectiveStopsForShift(shift);
  assert.equal(stops.some(s => s.stop_type === 'CHARGING'), false, 'chưa có phiếu thì không hiện trạm sạc');

  // Có phiếu chờ duyệt → hiện trạm sạc đúng thứ tự.
  repo.evChargingTickets.push({
    ticket_id: 'TC_1', shift_id: shift.shift_id, driver_id: shift.driver_id,
    requested_date: day, status: 'PENDING_HR',
  } as any);
  stops = await routes.getEffectiveStopsForShift(shift);
  assert.equal(stops.some(s => s.stop_type === 'CHARGING'), true, 'có phiếu thì hiện trạm sạc');

  // Phiếu bị từ chối → ẩn lại.
  (repo.evChargingTickets[0] as any).status = 'REJECTED';
  stops = await routes.getEffectiveStopsForShift(shift);
  assert.equal(stops.some(s => s.stop_type === 'CHARGING'), false, 'phiếu bị từ chối thì ẩn trạm sạc');
});

test('Tạo ca tuần: T2→CN, 08:00–14:00, bỏ qua tài xế chưa gán xe', async () => {
  const { shifts } = await setup();
  const result = await shifts.generateWeek({ weekStart: '2030-06-05', includePast: true, createdBy: 'TEST' });

  // 05/06/2030 là Thứ Tư → tuần bắt đầu 03/06/2030 (Thứ Hai).
  assert.equal(result.week_start, '2030-06-03');
  assert.equal(result.week_end, '2030-06-09');
  assert.equal(result.created.length, 7, 'tạo 7 ca T2→CN cho tài xế có xe');

  const dates = result.created.map(s => s.shift_date);
  assert.deepEqual(dates, ['2030-06-03', '2030-06-04', '2030-06-05', '2030-06-06', '2030-06-07', '2030-06-08', '2030-06-09']);
  assert.equal(dates.includes('2030-06-09'), true, 'có tạo Chủ nhật');

  for (const s of result.created) {
    assert.equal(new Date(s.planned_start_at).toISOString(), new Date(`${s.shift_date}T08:00:00+07:00`).toISOString());
    assert.equal(new Date(s.planned_end_at!).toISOString(), new Date(`${s.shift_date}T14:00:00+07:00`).toISOString());
  }

  assert.equal(
    result.skipped.some(x => x.driver_id === 'EMP_DRIVER_W2' && x.reason.startsWith('NO_VEHICLE')),
    true,
    'tài xế chưa gán xe bị bỏ qua kèm lý do',
  );
});

test('Tạo ca tuần idempotent: không nhân đôi ca, giữ nguyên ca đã sửa', async () => {
  const { repo, shifts } = await setup();
  const first = await shifts.generateWeek({ weekStart: '2030-06-03', includePast: true });
  assert.equal(first.created.length, 7);

  // Admin sửa 1 ngày sang 09:00–15:00.
  const edited = first.created[2];
  await shifts.updateShift(edited.shift_id, {
    planned_start_at: new Date(`${edited.shift_date}T09:00:00+07:00`).toISOString(),
    planned_end_at: new Date(`${edited.shift_date}T15:00:00+07:00`).toISOString(),
  });

  const second = await shifts.generateWeek({ weekStart: '2030-06-03', includePast: true });
  assert.equal(second.created.length, 0, 'lần 2 không tạo thêm ca');
  assert.equal(
    second.skipped.filter(x => x.reason.startsWith('SHIFT_EXISTS')).length,
    7,
    'mọi ngày đã có ca đều được bỏ qua',
  );

  const kept = repo.evShifts.find(s => s.shift_id === edited.shift_id)!;
  assert.equal(new Date(kept.planned_start_at).toISOString(), new Date(`${edited.shift_date}T09:00:00+07:00`).toISOString(),
    'ca admin đã sửa không bị ghi đè');
});

test('Sửa ca sang ngày tài xế đã có ca → chặn DRIVER_HAS_SHIFT', async () => {
  const { shifts } = await setup();
  const week = await shifts.generateWeek({ weekStart: '2030-06-03', includePast: true });
  const [a, b] = week.created;

  await assert.rejects(
    () => shifts.updateShift(b.shift_id, { shift_date: a.shift_date }),
    /DRIVER_HAS_SHIFT/,
  );
});
