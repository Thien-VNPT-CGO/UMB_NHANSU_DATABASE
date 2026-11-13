import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { EVRouteService } from '../src/services/milkroute/ev-route.service.js';
import { EVRouteChangeService } from '../src/services/milkroute/ev-route-change.service.js';
import { EVShiftService } from '../src/services/milkroute/ev-shift.service.js';
import { EVCheckinService } from '../src/services/milkroute/ev-checkin.service.js';

/**
 * Phiếu đổi lộ trình giao sữa (tạo là áp dụng ngay — không cần Giám đốc duyệt).
 *
 * Kịch bản:
 *   - Lộ trình gốc có 4 điểm dừng.
 *   - HR tạo phiếu đổi lộ trình cho sản phẩm "Sữa tươi", hiệu lực 08–15/12.
 *   - Phiếu có hiệu lực NGAY: ca trong khoảng ngày + đúng sản phẩm dùng 3 điểm
 *     mới; ca ngoài khoảng ngày hoặc khác sản phẩm vẫn dùng lộ trình gốc.
 *   - Check-in tại điểm mới (id RCS_...) lưu đúng tên điểm.
 *   - Snapshot khởi động giữ nguyên phiếu.
 */

const FROM = '2026-12-08';
const TO = '2026-12-15';

async function setup() {
  const repo = new MockSheetsAdapter();
  repo.employees.push({
    employee_id: 'EMP_DRIVER_1',
    employee_code: 'UBM_EV01',
    full_name: 'Tài xế A',
    employment_status: 'ACTIVE',
    group: 'XUONG',
    default_branch_id: 'XUONG_SX',
  } as any);

  // Toạ độ chi nhánh do Admin cấu hình ở tab Quản Lý Chi Nhánh.
  const branch = repo.branches.find((b: any) => String(b.id) === 'CN130');
  if (branch) {
    (branch as any).latitude = 10.777;
    (branch as any).longitude = 106.888;
  }

  const route = await repo.createEVRoute({ name: 'Tuyến Q1' });
  const baseDefs = [
    { stop_order: 1, name: 'Diem A', latitude: 10.1, longitude: 106.1, stop_type: 'START' },
    { stop_order: 2, name: 'Diem B', latitude: 10.2, longitude: 106.2, stop_type: 'DELIVERY' },
    { stop_order: 3, name: 'Diem C', latitude: 10.3, longitude: 106.3, stop_type: 'DELIVERY' },
    { stop_order: 4, name: 'Diem D', latitude: 10.4, longitude: 106.4, stop_type: 'END' },
  ];
  const baseStops: any[] = [];
  for (const s of baseDefs) {
    baseStops.push(await repo.createEVRouteStop({
      route_id: route.route_id,
      ...s,
      geofence_radius_m: 100,
      sla_minutes: 10,
    } as any));
  }
  const vehicle = await repo.createEVVehicle({ license_plate: '29H-999.99' });

  const routes = new EVRouteService(repo);
  const changes = new EVRouteChangeService(repo);
  const shifts = new EVShiftService(repo, routes);
  const checkins = new EVCheckinService(repo, routes);

  return { repo, route, baseStops, vehicle, routes, changes, shifts, checkins };
}

/** Danh sách điểm dừng mới: giữ id điểm START/END gốc, thêm 1 điểm giao mới. */
function changedStops(baseStops: any[]) {
  return [
    {
      stop_id: baseStops[0].stop_id,
      stop_order: 1,
      name: 'Diem A',
      latitude: baseStops[0].latitude,
      longitude: baseStops[0].longitude,
      geofence_radius_m: 100,
      sla_minutes: 10,
      stop_type: 'START',
      is_mandatory: true,
    },
    {
      // Điểm mới: backend cấp id RCS_<request_id>_<order> khi áp dụng.
      stop_order: 2,
      name: 'CH130 - Điểm mới',
      branch_id: 'CN130',
      address: '130 Văn Kiếp',
      latitude: 10.1,
      longitude: 106.1,
      geofence_radius_m: 120,
      sla_minutes: 15,
      stop_type: 'DELIVERY',
      is_mandatory: true,
    },
    {
      stop_id: baseStops[3].stop_id,
      stop_order: 3,
      name: 'Diem D',
      latitude: baseStops[3].latitude,
      longitude: baseStops[3].longitude,
      geofence_radius_m: 100,
      sla_minutes: 20,
      stop_type: 'END',
      is_mandatory: true,
    },
  ] as any[];
}

test('phiếu đổi lộ trình: tạo là có hiệu lực ngay, chặn trùng khoảng ngày', async () => {
  const { route, baseStops, changes, routes } = await setup();

  const request = await changes.createRequest({
    route_id: route.route_id,
    product_name: 'Sữa tươi',
    effective_from: FROM,
    effective_to: TO,
    reason: 'Giao thêm điểm chi nhánh 130',
    stops: changedStops(baseStops),
  }, { employeeId: 'EMP_HR_1', fullName: 'Nhân sự A', role: 'HR' });

  // Không cần duyệt: tạo xong là APPROVED và có hiệu lực ngay.
  assert.equal(request.status, 'APPROVED');
  assert.equal(request.approved_by_name, 'Nhân sự A');
  assert.ok(request.approved_at, 'phải ghi nhận thời điểm áp dụng');
  assert.equal(request.product_name, 'Sữa tươi');
  assert.ok(request.request_code && request.request_code.startsWith('RCR-'), 'phải có mã phiếu');
  assert.equal(request.created_by_name, 'Nhân sự A');

  // Chặn phiếu trùng khoảng ngày + cùng lộ trình/sản phẩm.
  await assert.rejects(
    () => changes.createRequest({
      route_id: route.route_id,
      product_name: 'Sữa tươi',
      effective_from: '2026-12-10',
      effective_to: '2026-12-20',
      stops: changedStops(baseStops),
    }, { employeeId: 'EMP_HR_2' }),
    /ROUTE_CHANGE_OVERLAP/,
  );

  // Ca trong khoảng ngày + đúng sản phẩm → dùng điểm mới ngay.
  const inside = await routes.getEffectiveStops(route.route_id, '2026-12-10', 'Sữa tươi');
  assert.equal(inside.length, 3);
  assert.equal(inside[1].name, 'CH130 - Điểm mới');
  assert.equal(inside[1].change_request_id, request.request_id);
  assert.equal(inside[1].product_name, 'Sữa tươi');
  assert.equal(inside[1].stop_id, `RCS_${request.request_id}_2`);
  // Toạ độ điểm gắn chi nhánh lấy theo cấu hình chi nhánh hiện tại.
  assert.equal(inside[1].latitude, 10.777);
  assert.equal(inside[1].longitude, 106.888);
  // Điểm START/END giữ nguyên id gốc để check-in cũ khớp.
  assert.equal(inside[0].stop_id, baseStops[0].stop_id);
  assert.equal(inside[2].stop_id, baseStops[3].stop_id);

  // Ca ngoài khoảng ngày → lộ trình gốc.
  const outside = await routes.getEffectiveStops(route.route_id, '2026-12-20', 'Sữa tươi');
  assert.equal(outside.length, 4);
  assert.equal(outside.some((s) => s.change_request_id), false);

  // Ca trong khoảng ngày nhưng khác sản phẩm → lộ trình gốc.
  const otherProduct = await routes.getEffectiveStops(route.route_id, '2026-12-11', 'Sữa đậu nành');
  assert.equal(otherProduct.length, 4);

  // Hủy phiếu đã duyệt → quay lại lộ trình gốc.
  await changes.cancelRequest(request.request_id, { employeeId: 'EMP_DIR_1' }, 'Đổi kế hoạch');
  const afterCancel = await routes.getEffectiveStops(route.route_id, '2026-12-10', 'Sữa tươi');
  assert.equal(afterCancel.length, 4);
});

test('ca vận chuyển: điểm dừng hiệu lực theo ngày + sản phẩm, check-in điểm mới lưu stop_name', async () => {
  const { repo, route, baseStops, vehicle, changes, shifts, checkins } = await setup();

  const request = await changes.createRequest({
    route_id: route.route_id,
    product_name: 'Sữa tươi',
    effective_from: FROM,
    effective_to: TO,
    stops: changedStops(baseStops),
  }, { employeeId: 'EMP_HR_1', fullName: 'Nhân sự A' });
  assert.equal(request.status, 'APPROVED', 'phiếu có hiệu lực ngay, không cần duyệt');

  const makeShift = (date: string, productName?: string) => shifts.createShift({
    routeId: route.route_id,
    driverId: 'EMP_DRIVER_1',
    vehicleId: vehicle.vehicle_id,
    shiftDate: date,
    plannedStartAt: `${date}T01:00:00.000Z`,
    productName,
    createdBy: 'ADMIN_TEST',
  });

  const inside = await makeShift('2026-12-10', 'Sữa tươi');
  const outside = await makeShift('2026-12-20', 'Sữa tươi');
  const otherProduct = await makeShift('2026-12-11', 'Sữa đậu nành');

  assert.equal(inside.product_name, 'Sữa tươi');

  const insideStops = await shifts.getShiftDetail(inside.shift_id);
  assert.equal(insideStops.stops.length, 3);
  assert.equal(insideStops.stops[1].name, 'CH130 - Điểm mới');
  assert.ok(insideStops.stops.some((s: any) => s.change_request_id === request.request_id));

  const outsideDetail = await shifts.getShiftDetail(outside.shift_id);
  assert.equal(outsideDetail.stops.length, 4);

  const otherDetail = await shifts.getShiftDetail(otherProduct.shift_id);
  assert.equal(otherDetail.stops.length, 4);

  // Chạy ca trong ngày: bấm điểm START rồi tới điểm mới từ phiếu.
  await shifts.startShift(inside.shift_id, {
    latitude: baseStops[0].latitude,
    longitude: baseStops[0].longitude,
    accuracy: 5,
  });

  await checkins.checkinStop({
    shiftId: inside.shift_id,
    stopId: baseStops[0].stop_id,
    driverLocation: {
      latitude: baseStops[0].latitude,
      longitude: baseStops[0].longitude,
      accuracy: 5,
    },
  });

  const newStopId = `RCS_${request.request_id}_2`;
  const saved = await checkins.checkinStop({
    shiftId: inside.shift_id,
    stopId: newStopId,
    driverLocation: { latitude: 10.777, longitude: 106.888, accuracy: 5 },
  });
  assert.equal(saved.stop_id, newStopId);
  assert.equal(saved.stop_name, 'CH130 - Điểm mới');
  assert.equal(saved.stop_order, 2);

  // Snapshot khởi động giữ phiếu đổi lộ trình.
  const restored = new MockSheetsAdapter();
  restored.importRuntimeState(repo.exportRuntimeState());
  assert.equal(restored.evRouteChangeRequests.length, 1);
  assert.equal(restored.evRouteChangeRequests[0].request_id, request.request_id);
  assert.equal(restored.evRouteChangeRequests[0].status, 'APPROVED');
  assert.equal(restored.evRouteChangeRequests[0].stops.length, 3);
});

test('phiếu cũ còn PENDING vẫn duyệt được (tương thích luồng trước đây)', async () => {
  const { repo, route, baseStops, changes } = await setup();

  const request = await changes.createRequest({
    route_id: route.route_id,
    effective_from: FROM,
    effective_to: TO,
    stops: changedStops(baseStops),
  }, { employeeId: 'EMP_HR_1', fullName: 'Nhân sự A' });

  // Mô phỏng phiếu tạo trước khi bỏ bước duyệt.
  await repo.updateEVRouteChangeRequest(request.request_id, { status: 'PENDING' });

  const approved = await changes.approveRequest(request.request_id, {
    employeeId: 'EMP_DIR_1', fullName: 'Giám đốc A', role: 'DIRECTOR',
  }, 'Duyệt phiếu cũ');
  assert.equal(approved.status, 'APPROVED');
  assert.equal(approved.approved_by_name, 'Giám đốc A');
});
