import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveMapService, vnDateOf, canonicalBranchId, distanceMeters } from '../src/services/live-map.service.js';

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
