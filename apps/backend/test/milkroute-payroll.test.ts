import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { EVRouteService } from '../src/services/milkroute/ev-route.service.js';
import { EVPayrollService } from '../src/services/milkroute/ev-payroll.service.js';
import { DEFAULT_EV_PAYROLL_CONFIG } from '@ubm/shared';

/**
 * Bảng lương tài xế — chỉ tính công cho ngày THỰC SỰ HOẠT ĐỘNG.
 *
 *  - Ca đã xếp lịch nhưng tài xế không bắt đầu ca và không check-in → không tính lương.
 *  - Ca đã bắt đầu (IN_PROGRESS/COMPLETED/actual_start_at) hoặc có check-in → tính công.
 *  - Ngày không hoạt động được ghi vào absent_days/absent_dates để Kế toán đối soát.
 */

const PERIOD = '2026-11';
const DAILY = DEFAULT_EV_PAYROLL_CONFIG.standard_daily_rate;

async function setup(driverId = 'EMP_DRIVER_P1') {
  const repo = new MockSheetsAdapter();
  repo.employees.push({
    employee_id: driverId,
    employee_code: `UBM_${driverId}`,
    full_name: 'Tài xế Lương',
    employment_status: 'OFFICIAL',
    group: 'XUONG',
  } as any);

  const route = await repo.createEVRoute({ name: 'Tuyến lương', is_active: true } as any);
  const stops: any[] = [];
  for (const s of [
    { stop_order: 1, name: 'Xưởng', latitude: 10.1, longitude: 106.1, stop_type: 'START', is_mandatory: true },
    { stop_order: 2, name: 'Điểm giao', latitude: 10.2, longitude: 106.2, stop_type: 'DELIVERY', is_mandatory: true },
  ]) {
    stops.push(await repo.createEVRouteStop({ route_id: route.route_id, geofence_radius_m: 100, sla_minutes: 30, ...s } as any));
  }

  const vehicle = await repo.createEVVehicle({ license_plate: '29H-555.55', assigned_driver_id: driverId } as any);

  const routes = new EVRouteService(repo);
  const payroll = new EVPayrollService(repo, DEFAULT_EV_PAYROLL_CONFIG, routes);

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
    if (Object.keys(patch).length) return repo.updateEVShift(created.shift_id, patch);
    return created;
  };

  const addCheckin = async (shiftId: string, stopId: string, patch: any = {}) => repo.createEVShiftCheckin({
    shift_id: shiftId,
    stop_id: stopId,
    stop_order: 1,
    stop_name: 'Xưởng',
    checked_in_at: new Date().toISOString(),
    latitude: 10.1,
    longitude: 106.1,
    distance_m: 5,
    is_within_geofence: true,
    is_missed: false,
    is_late: false,
    ...patch,
  } as any);

  return { repo, route, stops, vehicle, routes, payroll, addShift, addCheckin };
}

test('ngày không hoạt động không tính lương, ngày có hoạt động mới tính công', async () => {
  const { stops, payroll, addShift, addCheckin } = await setup();

  // 02: hoàn thành ca, có check-in → tính công.
  const worked = await addShift('2026-11-02', { status: 'COMPLETED', actual_start_at: '2026-11-02T01:00:00.000Z' });
  await addCheckin(worked.shift_id, stops[0].stop_id);

  // 03: đã xếp ca nhưng không bắt đầu, không check-in → KHÔNG tính lương.
  await addShift('2026-11-03');

  // 04: đang chạy ca (IN_PROGRESS) dù chưa check-in → tính công.
  await addShift('2026-11-04', { status: 'IN_PROGRESS', actual_start_at: '2026-11-04T01:00:00.000Z' });

  // 05: ca SCHEDULED nhưng có check-in → tính công.
  const checkedOnly = await addShift('2026-11-05');
  await addCheckin(checkedOnly.shift_id, stops[0].stop_id);

  const result = await payroll.calculateDriverPayroll('EMP_DRIVER_P1', PERIOD);

  assert.equal(result.total_shifts, 4);
  assert.equal(result.worked_shifts, 3);
  assert.equal(result.total_work_days, 3, 'chỉ 3 ngày hoạt động được tính công');
  assert.equal(result.standard_days, 3);
  assert.equal(result.extra_days, 0);
  assert.equal(result.absent_days, 1);
  assert.deepEqual(result.absent_dates, ['2026-11-03']);
  assert.equal(result.gross_pay, 3 * DAILY);
  assert.equal(result.net_pay, result.gross_pay);
});

test('tài xế chỉ có ca xếp lịch mà không hoạt động → lương 0', async () => {
  const { payroll, addShift } = await setup('EMP_DRIVER_P2');

  await addShift('2026-11-10');
  await addShift('2026-11-11');
  await addShift('2026-11-12');

  const result = await payroll.calculateDriverPayroll('EMP_DRIVER_P2', PERIOD);

  assert.equal(result.total_shifts, 3);
  assert.equal(result.total_work_days, 0);
  assert.equal(result.standard_days, 0);
  assert.equal(result.gross_pay, 0);
  assert.equal(result.net_pay, 0);
  assert.equal(result.absent_days, 3);
  assert.deepEqual(result.absent_dates, ['2026-11-10', '2026-11-11', '2026-11-12']);
});

// ============================================================================
// ĐỒNG BỘ REALTIME TỪ APP TÀI XẾ → KẾ TOÁN
// Mỗi thao tác của tài xế phải làm bảng lương của Kế toán đổi ngay, nhưng:
//  - không sinh dòng 0đ cho tài xế chỉ được xếp lịch;
//  - không sửa bảng lương đã duyệt/đã trả (snapshot chốt sổ);
//  - bỏ qua ca TEST.
// ============================================================================

test('đồng bộ realtime: tài xế bắt đầu ca → tự tạo bảng lương DRAFT cho Kế toán', async () => {
  const { payroll, addShift } = await setup('EMP_DRIVER_SYNC1');

  const shift = await addShift('2026-11-06', {
    status: 'IN_PROGRESS',
    actual_start_at: '2026-11-06T01:00:00.000Z',
  });

  assert.equal((await payroll.listPayrollByPeriod(PERIOD)).length, 0, 'chưa đồng bộ thì Kế toán chưa thấy dòng nào');

  const first = await payroll.syncFromShift(shift.shift_id, { createIfMissing: true, source: 'driver-start' });

  assert.equal(first.skipped, '');
  assert.equal(first.changed, true);
  assert.equal(first.payroll?.status, 'DRAFT');
  assert.equal(first.payroll?.total_work_days, 1);
  assert.equal(first.payroll?.net_pay, DAILY);

  const rows = await payroll.listPayrollByPeriod(PERIOD);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].driver_id, 'EMP_DRIVER_SYNC1');

  // Đồng bộ lại khi số liệu không đổi → changed=false, không bắn realtime rác.
  const again = await payroll.syncFromShift(shift.shift_id, { createIfMissing: true });
  assert.equal(again.changed, false);
});

test('không sinh bảng lương 0đ khi tài xế chỉ được xếp lịch mà chưa hoạt động', async () => {
  const { payroll, addShift } = await setup('EMP_DRIVER_SYNC2');

  const shift = await addShift('2026-11-07');

  const res = await payroll.syncFromShift(shift.shift_id, { createIfMissing: true });
  assert.equal(res.payroll, null);
  assert.equal(res.skipped, 'NOT_CREATED');

  // Mở tab Kế toán cũng không tự sinh dòng 0đ.
  const rows = await payroll.ensurePayrollRowsForPeriod(PERIOD);
  assert.equal(rows.length, 0);
});

test('điểm bỏ lọt xuất hiện sau đó → cập nhật lại bảng lương DRAFT ngay trong kỳ', async () => {
  const { stops, payroll, addShift, addCheckin } = await setup('EMP_DRIVER_SYNC3');

  const shift = await addShift('2026-11-12', {
    status: 'COMPLETED',
    actual_start_at: '2026-11-12T01:00:00.000Z',
  });

  const first = await payroll.syncFromShift(shift.shift_id, { createIfMissing: true });
  assert.equal(first.payroll?.total_penalty_amount, 0);

  await addCheckin(shift.shift_id, stops[0].stop_id, { is_missed: true });
  const second = await payroll.syncFromShift(shift.shift_id);

  const expectedPenalty = Math.round(DAILY * DEFAULT_EV_PAYROLL_CONFIG.penalty_per_missed_checkin.standard);
  assert.equal(second.changed, true);
  assert.equal(second.payroll?.total_penalty_amount, expectedPenalty);
  assert.equal(second.payroll?.net_pay, DAILY - expectedPenalty);
});

test('bảng lương đã duyệt là snapshot — đồng bộ realtime không sửa số tiền', async () => {
  const { stops, payroll, addShift, addCheckin } = await setup('EMP_DRIVER_SYNC4');

  const s1 = await addShift('2026-11-08', {
    status: 'IN_PROGRESS',
    actual_start_at: '2026-11-08T01:00:00.000Z',
  });
  const first = await payroll.syncFromShift(s1.shift_id, { createIfMissing: true });
  const approved = await payroll.approvePayroll(first.payroll!.payroll_id, 'FIN_TEST');
  assert.equal(approved?.status, 'APPROVED');
  const approvedNet = approved!.net_pay;

  // Tài xế chạy thêm ngày mới sau khi Kế toán đã chốt.
  const s2 = await addShift('2026-11-09', {
    status: 'COMPLETED',
    actual_start_at: '2026-11-09T01:00:00.000Z',
  });
  await addCheckin(s2.shift_id, stops[1].stop_id);

  const after = await payroll.syncFromShift(s2.shift_id, { createIfMissing: true });
  assert.equal(after.skipped, 'LOCKED');
  assert.equal(after.changed, false);
  assert.equal(after.payroll?.status, 'APPROVED');
  assert.equal(after.payroll?.net_pay, approvedNet, 'không được đổi số tiền đã duyệt');
});

test('ca TEST không đồng bộ lương', async () => {
  const { payroll, addShift } = await setup('EMP_DRIVER_SYNC5');

  const shift = await addShift('2026-11-13', {
    status: 'IN_PROGRESS',
    actual_start_at: '2026-11-13T01:00:00.000Z',
    notes: '[TEST_MODE]',
  });

  const res = await payroll.syncFromShift(shift.shift_id, { createIfMissing: true });
  assert.equal(res.skipped, 'TEST_SHIFT');
  assert.equal(res.payroll, null);
  assert.equal((await payroll.listPayrollByPeriod(PERIOD)).length, 0);
});

test('ngày có hoạt động vẫn bị trừ phạt điểm bỏ lọt / trễ SLA', async () => {
  const { stops, payroll, addShift, addCheckin } = await setup('EMP_DRIVER_P3');

  const shift = await addShift('2026-11-20', { status: 'COMPLETED', actual_start_at: '2026-11-20T01:00:00.000Z' });
  await addCheckin(shift.shift_id, stops[0].stop_id, { is_missed: true });

  const result = await payroll.calculateDriverPayroll('EMP_DRIVER_P3', PERIOD);

  assert.equal(result.total_work_days, 1);
  const expectedPenalty = Math.round(DAILY * DEFAULT_EV_PAYROLL_CONFIG.penalty_per_missed_checkin.standard);
  assert.equal(result.total_penalty_amount, expectedPenalty);
  assert.equal(result.net_pay, DAILY - expectedPenalty);
});