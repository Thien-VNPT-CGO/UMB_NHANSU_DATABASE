import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { EVRouteService } from '../src/services/milkroute/ev-route.service.js';
import { EVPayrollService } from '../src/services/milkroute/ev-payroll.service.js';
import { EVDriverProfileService } from '../src/services/milkroute/ev-profile.service.js';

/**
 * Hồ sơ tài khoản TÀI XẾ (app riêng 5 tab).
 *
 * Tài khoản tài xế được nhận diện bằng dấu hiệu nghiệp vụ (xe được gán / có ca
 * vận chuyển / có bảng lương tài xế) chứ không thêm cột vào NHAN_VIEN_MASTER.
 */

const VN_OFFSET_MS = 7 * 3_600_000;
const todayVN = () => new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);
const periodVN = () => todayVN().slice(0, 7);

async function setup() {
  const repo = new MockSheetsAdapter();

  repo.employees.push({
    employee_id: 'EMP_DRIVER_1',
    employee_code: 'UBM_EV01',
    full_name: 'Tài xế A',
    phone_normalized: '0901234567',
    employment_status: 'OFFICIAL',
    group: 'XUONG',
    default_branch_id: 'XUONG_SX',
    start_date: '2026-01-02',
  } as any);
  repo.employees.push({
    employee_id: 'EMP_OFFICE_1',
    employee_code: 'UBM_VP01',
    full_name: 'Nhân viên văn phòng',
    employment_status: 'OFFICIAL',
    group: 'VAN_PHONG',
    default_branch_id: 'CN130',
    start_date: '2026-01-02',
  } as any);

  const route = await repo.createEVRoute({ name: 'Tuyến Q1' });
  const stops: any[] = [];
  for (const s of [
    { stop_order: 1, name: 'Xưởng', latitude: 10.1, longitude: 106.1, stop_type: 'START' },
    { stop_order: 2, name: 'Điểm B', latitude: 10.2, longitude: 106.2, stop_type: 'DELIVERY' },
    { stop_order: 3, name: 'Văn phòng', latitude: 10.3, longitude: 106.3, stop_type: 'END' },
  ]) {
    stops.push(await repo.createEVRouteStop({
      route_id: route.route_id,
      ...s,
      geofence_radius_m: 100,
      sla_minutes: 30,
      is_mandatory: true,
    } as any));
  }

  const vehicle = await repo.createEVVehicle({
    license_plate: '29H-888.88',
    battery_capacity_kwh: 40,
    assigned_driver_id: 'EMP_DRIVER_1',
  } as any);

  const day = todayVN();
  const shift: any = {
    shift_id: 'SHIFT_TODAY',
    driver_id: 'EMP_DRIVER_1',
    vehicle_id: vehicle.vehicle_id,
    route_id: route.route_id,
    shift_date: day,
    status: 'COMPLETED',
    planned_start_at: `${day}T08:00:00+07:00`,
    actual_start_at: `${day}T08:02:00+07:00`,
    actual_end_at: `${day}T11:30:00+07:00`,
    total_distance_km: 42.5,
    total_duration_min: 208,
    penalty_amount: 21_429,
    penalty_points: 1,
    product_name: 'Sữa tươi',
  };
  repo.evShifts.push(shift);

  // 1 điểm trễ + 1 điểm bỏ lọt + 1 điểm đúng giờ.
  repo.evShiftCheckins.push(
    {
      checkin_id: 'CI_1', shift_id: shift.shift_id, stop_id: stops[0].stop_id,
      stop_name: 'Xưởng', is_late: false, is_missed: false, late_minutes: 0,
      checked_at: `${day}T08:02:00+07:00`,
    } as any,
    {
      checkin_id: 'CI_2', shift_id: shift.shift_id, stop_id: stops[1].stop_id,
      stop_name: 'Điểm B', is_late: true, is_missed: false, late_minutes: 12,
      checked_at: `${day}T09:00:00+07:00`,
    } as any,
    {
      checkin_id: 'CI_3', shift_id: shift.shift_id, stop_id: stops[2].stop_id,
      stop_name: 'Văn phòng', is_late: false, is_missed: true, late_minutes: 0,
      checked_at: '',
    } as any,
  );

  const routes = new EVRouteService(repo);
  const payroll = new EVPayrollService(repo, undefined, routes);
  const profile = new EVDriverProfileService(repo, routes, payroll);

  return { repo, route, stops, vehicle, shift, routes, payroll, profile };
}

test('EV Profile: nhận diện tài xế theo xe được gán / ca / bảng lương', async () => {
  const { repo, profile, vehicle } = await setup();

  assert.equal(profile.hasDriverSignal('EMP_DRIVER_1'), true, 'có xe được gán → là tài xế');
  assert.equal(profile.hasDriverSignal('EMP_OFFICE_1'), false, 'nhân viên văn phòng không phải tài xế');
  assert.equal(profile.hasDriverSignal(''), false);

  // Bỏ dấu hiệu xe nhưng còn ca vận chuyển → vẫn nhận là tài xế.
  const idx = repo.evVehicles.findIndex((v: any) => v.vehicle_id === vehicle.vehicle_id);
  repo.evVehicles[idx] = { ...repo.evVehicles[idx], assigned_driver_id: undefined } as any;
  assert.equal(profile.hasDriverSignal('EMP_DRIVER_1'), true, 'có ca vận chuyển → là tài xế');

  // Không còn ca, không còn xe, nhưng có bảng lương tài xế → vẫn nhận.
  repo.evShifts.splice(0, repo.evShifts.length);
  repo.evDriverPayroll.push({ payroll_id: 'PR_X', driver_id: 'EMP_DRIVER_1', period: periodVN() } as any);
  assert.equal(profile.hasDriverSignal('EMP_DRIVER_1'), true, 'có bảng lương tài xế → là tài xế');
});

test('EV Profile: hồ sơ trả đủ xe, ca hiện tại, thống kê tháng và lương tạm tính', async () => {
  const { profile } = await setup();
  const p = await profile.getProfile('EMP_DRIVER_1');

  assert.equal(p.is_driver, true);
  assert.equal(p.driver.employee_code, 'UBM_EV01');
  assert.equal(p.driver.group, 'XUONG');
  assert.equal(p.vehicle.license_plate, '29H-888.88');
  assert.equal(p.vehicle.battery_capacity_kwh, 40);

  // Ca hôm nay đã COMPLETED vẫn là "ca hiện tại" gần nhất (>= hôm nay).
  assert.equal(p.current_shift?.shift_id, 'SHIFT_TODAY');
  assert.equal(p.today_shifts.length, 1);

  assert.equal(p.stats.period, periodVN());
  assert.equal(p.stats.shifts_total, 1);
  assert.equal(p.stats.shifts_completed, 1);
  assert.equal(p.stats.work_days, 1);
  assert.equal(p.stats.stops_total, 3);
  assert.equal(p.stats.stops_done, 2, 'điểm bỏ lọt không tính là đã giao');
  assert.equal(p.stats.late_count, 1);
  assert.equal(p.stats.missed_count, 1);
  assert.equal(p.stats.on_time_rate, 50);
  assert.equal(p.stats.distance_km, 42.5);
  assert.equal(p.stats.duration_min, 208);
  assert.equal(p.stats.penalty_amount, 21_429);

  // Chưa chốt bảng lương → tạm tính theo đúng công thức của Kế toán.
  assert.equal(p.payroll.status, 'ESTIMATED');
  assert.equal(p.payroll.period, periodVN());
  assert.equal(p.payroll.total_shifts, 1);
  assert.equal(p.payroll.standard_days, 1);
  assert.equal(p.payroll.standard_pay, 214_286);
  // 1 bỏ lọt (25% ngày công) + 1 trễ SLA (10% ngày công).
  assert.equal(p.payroll.total_penalty_points, 2);
  assert.equal(p.payroll.total_penalty_amount, 53_572 + 21_429);
  assert.equal(p.payroll.net_pay, 214_286 - 75_001);

  assert.equal(p.config.standard_work_days, 28);
  assert.equal(p.config.standard_daily_rate, 214_286);
});

test('EV Profile: nhân viên không phải tài xế vẫn trả hồ sơ nhưng is_driver=false', async () => {
  const { profile } = await setup();
  const p = await profile.getProfile('EMP_OFFICE_1');

  assert.equal(p.is_driver, false);
  assert.equal(p.driver.employee_code, 'UBM_VP01');
  assert.equal(p.current_shift, null);
  assert.equal(p.payroll, null);
  assert.equal(p.stats.shifts_total, 0);

  await assert.rejects(
    () => profile.getProfile('KHONG_TON_TAI'),
    /DRIVER_NOT_FOUND/,
  );
});

test('EV Profile: lịch sử ca có tổng điểm / trễ / bỏ lọt và lọc theo khoảng ngày', async () => {
  const { profile, repo, route, vehicle } = await setup();
  const day = todayVN();

  // Ca cũ hơn (5 ngày trước) để kiểm tra lọc.
  const older = new Date(Date.parse(`${day}T00:00:00Z`) - 5 * 86_400_000).toISOString().slice(0, 10);
  repo.evShifts.push({
    shift_id: 'SHIFT_OLD',
    driver_id: 'EMP_DRIVER_1',
    vehicle_id: vehicle.vehicle_id,
    route_id: route.route_id,
    shift_date: older,
    status: 'COMPLETED',
    planned_start_at: `${older}T08:00:00+07:00`,
    total_distance_km: 10,
    total_duration_min: 60,
    penalty_amount: 0,
    penalty_points: 0,
  } as any);

  const all = await profile.getHistory('EMP_DRIVER_1', { from: older, to: day });
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((s: any) => s.shift_id), ['SHIFT_TODAY', 'SHIFT_OLD'], 'mới nhất lên đầu');

  const todayOnly = await profile.getHistory('EMP_DRIVER_1', { from: day, to: day });
  assert.equal(todayOnly.length, 1);
  assert.equal(todayOnly[0].shift_id, 'SHIFT_TODAY');
  assert.equal(todayOnly[0].stops_total, 3);
  assert.equal(todayOnly[0].stops_done, 2);
  assert.equal(todayOnly[0].late_count, 1);
  assert.equal(todayOnly[0].missed_count, 1);

  // Không truyền khoảng ngày → mặc định 60 ngày gần nhất.
  const def = await profile.getHistory('EMP_DRIVER_1');
  assert.equal(def.length, 2);

  // Giới hạn số bản ghi.
  const limited = await profile.getHistory('EMP_DRIVER_1', { from: older, to: day, limit: 1 });
  assert.equal(limited.length, 1);
  assert.equal(limited[0].shift_id, 'SHIFT_TODAY');
});
