import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveMapService, vnDateOf, canonicalBranchId, distanceMeters } from '../src/services/live-map.service.js';
import { LiveLocationStore } from '../src/services/live-location.store.js';

/** Repo giả: chỉ cần các hàm LiveMapService dùng tới. */
function makeRepo(opts: { employees: any[]; branches: any[]; shifts?: any[]; events?: any[] }) {
  return {
    listEmployees: async () => opts.employees,
    getBranches: async () => opts.branches,
    getShiftsForWeek: async () => opts.shifts || [],
    getAttendanceEvents: async () => opts.events || [],
  } as any;
}

const BRANCH = {
  id: 'CN130',
  name: 'Ụm Bò Milk - CN1',
  address: '130 Vạn Kiếp',
  latitude: 10.79782,
  longitude: 106.69345,
  radius_meters: 300,
  min_staff: 2,
  max_staff: 5,
  status: 'ACTIVE',
};

const EMP = {
  employee_id: 'E1',
  employee_code: 'UBM_NV0001',
  full_name: 'Nguyễn Văn A',
  default_branch_id: 'CN130',
  employment_status: 'OFFICIAL',
};

// 10:00 VN ngày 03/11/2026
const NOW = new Date('2026-11-03T03:00:00.000Z');
const TODAY = '2026-11-03';

function shift(overrides: Record<string, any> = {}) {
  return {
    assignment_id: 'A1',
    employee_id: 'E1',
    branch_id: 'CN130',
    shift_code: 'CA_1',
    date: TODAY,
    start_at: `${TODAY}T00:00:00.000Z`, // 07:00 VN
    end_at: `${TODAY}T05:00:00.000Z`,   // 12:00 VN
    status: 'PUBLISHED',
    schedule_version: 1,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function event(type: 'CHECK_IN' | 'CHECK_OUT', iso: string, overrides: Record<string, any> = {}) {
  return {
    event_id: `${type}-${iso}`,
    request_id: `${type}-${iso}`,
    assignment_id: 'A1',
    employee_id: 'E1',
    branch_id: 'CN130',
    type,
    client_time: iso,
    server_received_at: iso,
    gps_latitude: 10.7979,
    gps_longitude: 106.6934,
    gps_accuracy: 12,
    gps_status: 'VALID',
    ...overrides,
  };
}

test('map: chưa tới giờ ca -> NORMAL (xám)', async () => {
  const svc = new LiveMapService(makeRepo({
    employees: [EMP],
    branches: [BRANCH],
    shifts: [shift()],
    events: [],
  }));
  const snap = await svc.getSnapshot(new Date('2026-11-02T23:30:00.000Z')); // 06:30 VN, trước giờ vào ca
  assert.equal(snap.employees.length, 1);
  assert.equal(snap.employees[0].status, 'NORMAL');
  assert.equal(snap.employees[0].gps_source, 'BRANCH');
  assert.equal(snap.employees[0].latitude, BRANCH.latitude);
});

test('map: đã check-in chưa check-out trong ca -> WORKING (vàng)', async () => {
  const svc = new LiveMapService(makeRepo({
    employees: [EMP],
    branches: [BRANCH],
    shifts: [shift()],
    events: [event('CHECK_IN', `${TODAY}T00:05:00.000Z`)],
  }));
  const snap = await svc.getSnapshot(NOW);
  const e = snap.employees[0];
  assert.equal(e.status, 'WORKING');
  assert.equal(e.gps_source, 'CHECK_IN');
  assert.equal(e.shifts[0].check_in_at, `${TODAY}T00:05:00.000Z`);
  assert.equal(snap.summary.working, 1);
});

test('map: có check-in + check-out -> COMPLETED (xanh lá)', async () => {
  const svc = new LiveMapService(makeRepo({
    employees: [EMP],
    branches: [BRANCH],
    shifts: [shift()],
    events: [
      event('CHECK_IN', `${TODAY}T00:05:00.000Z`),
      event('CHECK_OUT', `${TODAY}T05:10:00.000Z`),
    ],
  }));
  const snap = await svc.getSnapshot(NOW);
  const e = snap.employees[0];
  assert.equal(e.status, 'COMPLETED');
  // GPS ưu tiên sự kiện gần nhất (check-out).
  assert.equal(e.gps_source, 'CHECK_OUT');
  assert.equal(snap.summary.completed, 1);
});

test('map: check-in nhưng quá giờ tan +30p chưa check-out -> MISSING (đỏ)', async () => {
  const svc = new LiveMapService(makeRepo({
    employees: [EMP],
    branches: [BRANCH],
    shifts: [shift()],
    events: [event('CHECK_IN', `${TODAY}T00:05:00.000Z`)],
  }));
  // 12:31 VN = 05:31Z (quá 30 phút sau end_at 05:00Z)
  const snap = await svc.getSnapshot(new Date(`${TODAY}T05:31:00.000Z`));
  assert.equal(snap.employees[0].status, 'MISSING');
  assert.equal(snap.summary.missing, 1);
});

test('map: quá 15p sau giờ vào ca mà chưa check-in -> MISSING (đỏ)', async () => {
  const svc = new LiveMapService(makeRepo({
    employees: [EMP],
    branches: [BRANCH],
    shifts: [shift()],
    events: [],
  }));
  // 07:20 VN = 00:20Z (quá grace 15 phút)
  const snap = await svc.getSnapshot(new Date(`${TODAY}T00:20:00.000Z`));
  assert.equal(snap.employees[0].status, 'MISSING');
});

test('map: không có ca hôm nay -> NORMAL + ghi chú', async () => {
  const svc = new LiveMapService(makeRepo({
    employees: [EMP],
    branches: [BRANCH],
    shifts: [],
    events: [],
  }));
  const snap = await svc.getSnapshot(NOW);
  assert.equal(snap.employees[0].status, 'NORMAL');
  assert.equal(snap.employees[0].note, 'Hôm nay không có ca làm');
});

test('map: NV không thuộc chi nhánh có toạ độ thì bỏ qua', async () => {
  const svc = new LiveMapService(makeRepo({
    employees: [{ ...EMP, default_branch_id: 'CN999' }],
    branches: [BRANCH],
    shifts: [],
    events: [],
  }));
  const snap = await svc.getSnapshot(NOW);
  assert.equal(snap.employees.length, 0);
});

test('map: helper ngày VN + chuẩn hoá chi nhánh + khoảng cách', () => {
  assert.equal(vnDateOf('2026-11-02T17:30:00.000Z'), '2026-11-03');
  assert.equal(canonicalBranchId('cn1'), 'CN130');
  assert.equal(canonicalBranchId('CN261'), 'CN261');
  const d = distanceMeters(10.79782, 106.69345, 10.79782, 106.69345);
  assert.equal(d, 0);
  assert.ok(distanceMeters(10.79782, 106.69345, 10.79882, 106.69345) > 100);
});

test('map: GPS trực tiếp realtime ưu tiên hơn GPS chấm công', async () => {
  const store = new LiveLocationStore();
  store.upsert({
    employee_id: 'E1',
    latitude: 10.79850,
    longitude: 106.69400,
    accuracy: 8,
  }, NOW.getTime());
  const svc = new LiveMapService(makeRepo({
    employees: [EMP],
    branches: [BRANCH],
    shifts: [shift()],
    events: [event('CHECK_IN', `${TODAY}T00:05:00.000Z`)],
  }), store);
  const snap = await svc.getSnapshot(NOW);
  const e = snap.employees[0];
  assert.equal(e.gps_source, 'LIVE');
  assert.equal(e.latitude, 10.79850);
  assert.equal(e.longitude, 106.69400);
  assert.equal(e.gps_accuracy, 8);
  assert.equal(snap.summary.with_gps, 1);
});

test('map: ping GPS cũ quá TTL bị bỏ qua, rơi về GPS chấm công', async () => {
  const store = new LiveLocationStore(60_000);
  store.upsert({
    employee_id: 'E1',
    latitude: 10.79850,
    longitude: 106.69400,
  }, NOW.getTime() - 120_000);
  const svc = new LiveMapService(makeRepo({
    employees: [EMP],
    branches: [BRANCH],
    shifts: [shift()],
    events: [event('CHECK_IN', `${TODAY}T00:05:00.000Z`)],
  }), store);
  const snap = await svc.getSnapshot(NOW);
  assert.equal(snap.employees[0].gps_source, 'CHECK_IN');
});

test('kho GPS realtime: lưu, đọc và tự dọn theo TTL', () => {
  const store = new LiveLocationStore(60_000);
  store.upsert({ employee_id: 'E1', latitude: 10.1, longitude: 106.1 }, 1_000_000);
  store.upsert({ employee_id: 'E2', latitude: 10.2, longitude: 106.2 }, 1_000_000);
  assert.equal(store.list(1_030_000).length, 2);
  assert.equal(store.get('E1', 1_030_000)?.latitude, 10.1);
  assert.equal(store.get('E1', 1_120_000), null);
  store.prune(1_200_000);
  assert.equal(store.list(1_200_000).length, 0);
});

test('map: tài khoản bị khóa không xuất hiện trên bản đồ', async () => {
  const lockedFlag = { ...EMP, employee_id: 'E2', employee_code: 'UBM_NV0002', account_locked: true };
  const lockedStatus = { ...EMP, employee_id: 'E3', employee_code: 'UBM_NV0003', account_status: 'LOCKED' };
  const svc = new LiveMapService(makeRepo({
    employees: [EMP, lockedFlag, lockedStatus],
    branches: [BRANCH],
    shifts: [],
    events: [],
  }));
  const snap = await svc.getSnapshot(NOW);
  assert.deepEqual(snap.employees.map(e => e.employee_id), ['E1']);
  assert.equal(snap.summary.total, 1);
});

test('map chi nhánh cho cổng NV: chỉ đồng nghiệp cùng chi nhánh, loại người đã khóa', async () => {
  const other = { ...EMP, employee_id: 'E9', employee_code: 'UBM_NV0009', default_branch_id: 'CN261' };
  const locked = { ...EMP, employee_id: 'E8', employee_code: 'UBM_NV0008', account_locked: true };
  const branch2 = { ...BRANCH, id: 'CN261', name: 'Ụm Bò Milk - CN2', latitude: 10.778639, longitude: 106.666665 };
  const svc = new LiveMapService(makeRepo({
    employees: [EMP, other, locked],
    branches: [BRANCH, branch2],
    shifts: [],
    events: [],
  }));
  const snap = await svc.getBranchSnapshot('CN130', NOW);
  assert.deepEqual(snap.employees.map(e => e.employee_id), ['E1']);
  assert.equal(snap.branches.length, 1);
  assert.equal(snap.branches[0].id, 'CN130');
  assert.equal(snap.summary.total, 1);
});

test('map: GPS realtime trong bán kính cửa hàng -> at_branch + summary.at_store', async () => {
  const store = new LiveLocationStore();
  // ~96m so với BRANCH (bán kính 300m) => đang ở cửa hàng.
  store.upsert({ employee_id: 'E1', latitude: 10.79850, longitude: 106.69400 }, NOW.getTime());
  const svc = new LiveMapService(makeRepo({
    employees: [EMP],
    branches: [BRANCH],
    shifts: [],
    events: [],
  }), store);
  const snap = await svc.getSnapshot(NOW);
  const e = snap.employees[0];
  assert.equal(e.at_branch, true);
  assert.equal(e.radius_meters, 300);
  assert.ok(Number(e.distance_meters) <= 300);
  assert.equal(snap.summary.at_store, 1);
  assert.equal(snap.summary.outside, 0);
});

test('map: GPS realtime ngoài bán kính cửa hàng -> at_branch=false + summary.outside', async () => {
  const store = new LiveLocationStore();
  // ~410m so với BRANCH (bán kính 300m) => đang ở ngoài cửa hàng.
  store.upsert({ employee_id: 'E1', latitude: 10.80150, longitude: 106.69345 }, NOW.getTime());
  const svc = new LiveMapService(makeRepo({
    employees: [EMP],
    branches: [BRANCH],
    shifts: [],
    events: [],
  }), store);
  const snap = await svc.getSnapshot(NOW);
  const e = snap.employees[0];
  assert.equal(e.at_branch, false);
  assert.ok(Number(e.distance_meters) > 300);
  assert.equal(snap.summary.at_store, 0);
  assert.equal(snap.summary.outside, 1);
});

test('map: chưa có GPS thật (rơi về toạ độ cửa hàng) -> không tính là tại cửa hàng', async () => {
  const svc = new LiveMapService(makeRepo({
    employees: [EMP],
    branches: [BRANCH],
    shifts: [],
    events: [],
  }));
  const snap = await svc.getSnapshot(NOW);
  const e = snap.employees[0];
  assert.equal(e.gps_source, 'BRANCH');
  assert.equal(e.at_branch, false);
  assert.equal(snap.summary.with_gps, 0);
  assert.equal(snap.summary.at_store, 0);
  assert.equal(snap.summary.outside, 0);
});

test('map: đang trong ca mà mất tín hiệu GPS -> gps_stale + summary.stale', async () => {
  const svc = new LiveMapService(makeRepo({
    employees: [EMP],
    branches: [BRANCH],
    shifts: [shift()],
    events: [],
  }));
  const snap = await svc.getSnapshot(NOW); // 10:00 VN, ca 1 đang chạy, không có ping
  const e = snap.employees[0];
  assert.equal(e.sharing_now, true);
  assert.equal(e.live_online, false);
  assert.equal(e.gps_stale, true);
  assert.equal(snap.summary.stale, 1);
});

test('cảnh báo: trong ca mà mất tín hiệu phát GPS_STALE', async () => {
  const svc = new LiveMapService(makeRepo({
    employees: [EMP],
    branches: [BRANCH],
    shifts: [shift()],
    events: [],
  }));
  const alerts = await svc.evaluateAlerts(NOW);
  assert.equal(alerts.some(a => a.type === 'GPS_STALE'), true);
});

test('cảnh báo: rời cửa hàng trong ca phát GEOFENCE_EXIT (có khoảng đệm chống nhiễu)', async () => {
  const store = new LiveLocationStore();
  const svc = new LiveMapService(makeRepo({
    employees: [EMP],
    branches: [BRANCH],
    shifts: [shift()],
    events: [],
  }), store);

  // Lần quét 1: đang ở cửa hàng -> chỉ ghi nhận trạng thái, chưa cảnh báo.
  store.upsert({ employee_id: 'E1', latitude: 10.79850, longitude: 106.69400 }, NOW.getTime());
  const first = await svc.evaluateAlerts(NOW);
  assert.equal(first.some(a => a.type === 'GEOFENCE_EXIT'), false);

  // Lần quét 2: đã ra ngoài bán kính (> radius + 50m) -> cảnh báo rời cửa hàng.
  store.upsert({ employee_id: 'E1', latitude: 10.80150, longitude: 106.69345 }, NOW.getTime() + 1000);
  const second = await svc.evaluateAlerts(new Date(NOW.getTime() + 1000));
  assert.equal(second.some(a => a.type === 'GEOFENCE_EXIT'), true);
});

test('cảnh báo: chỉ sát mép bán kính (trong khoảng đệm) thì KHÔNG báo rời cửa hàng', async () => {
  const store = new LiveLocationStore();
  const svc = new LiveMapService(makeRepo({
    employees: [EMP],
    branches: [BRANCH],
    shifts: [shift()],
    events: [],
  }), store);

  store.upsert({ employee_id: 'E1', latitude: 10.79850, longitude: 106.69400 }, NOW.getTime());
  await svc.evaluateAlerts(NOW);
  // ~310m > 300m nhưng < 300+50 => còn trong khoảng đệm, không cảnh báo.
  store.upsert({ employee_id: 'E1', latitude: 10.80060, longitude: 106.69345 }, NOW.getTime() + 1000);
  const snap = await svc.getSnapshot(new Date(NOW.getTime() + 1000));
  assert.equal(snap.employees[0].at_branch, false); // hiển thị là ngoài cửa hàng
  const alerts = await svc.evaluateAlerts(new Date(NOW.getTime() + 1000));
  assert.equal(alerts.some(a => a.type === 'GEOFENCE_EXIT'), false); // nhưng chưa cảnh báo
});

