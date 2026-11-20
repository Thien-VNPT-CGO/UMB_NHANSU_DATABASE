import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { AttendanceService } from '../src/services/attendance.service.js';
import { lateMinutesOfEvent } from '../src/services/payroll.service.js';

/**
 * QUYỀN TỐI THƯỢNG của Admin hoàn thành ca:
 * - Ca thiếu chân -> ghi đủ CHECK_IN/OUT.
 * - Ca đã đủ cặp VẪN áp lại được (không báo SHIFT_ALREADY_COMPLETE).
 * - Xóa sạch cờ trễ/phạt, kể cả dòng cũ thiếu cờ `is_late` và kho archive.
 * - Dọn bản ghi VẮNG, tự phát hành ca DRAFT.
 */

const DAY = '2026-11-14';

function seedEmployee(repo: MockSheetsAdapter) {
  return repo.createEmployee({
    employee_id: 'EMP_TOP',
    employee_code: 'UBM_TOP01',
    full_name: 'Nguyen Thi Top',
    phone_normalized: '0900000001',
    employment_status: 'OFFICIAL',
    default_branch_id: 'CN130',
    default_shift_code: 'CA_1',
    current_rate_per_hour: 25000,
    adjust_points_earned: 0,
    adjust_points_spent: 0,
  } as any);
}

function seedShift(repo: MockSheetsAdapter, opts?: { status?: string; id?: string }) {
  const id = opts?.id || 'SHIFT_TOP_1';
  repo.shifts.push({
    assignment_id: id,
    employee_id: 'EMP_TOP',
    branch_id: 'CN130',
    shift_code: 'CA_1',
    date: DAY,
    start_at: `${DAY}T07:00:00+07:00`,
    end_at: `${DAY}T12:00:00+07:00`,
    status: opts?.status || 'PUBLISHED',
    schedule_version: 1,
  } as any);
  return id;
}

function lateIn(repo: MockSheetsAdapter, id = 'SHIFT_TOP_1', late = true) {
  return repo.recordAttendanceEvent({
    event_id: 'EVT_TOP_IN',
    request_id: 'REQ_TOP_IN',
    assignment_id: id,
    employee_id: 'EMP_TOP',
    branch_id: 'CN130',
    type: 'CHECK_IN',
    client_time: `${DAY}T08:20:00+07:00`,
    server_received_at: new Date().toISOString(),
    gps_status: 'VALID',
    ...(late
      ? { is_late: true, minutes_deviation: 80, fine_tier: 'FULL_SHIFT', fine_amount: 125000 }
      : { is_late: false, minutes_deviation: 0, fine_tier: 'NONE', fine_amount: 0 }),
  } as any);
}

function normalOut(repo: MockSheetsAdapter, id = 'SHIFT_TOP_1') {
  return repo.recordAttendanceEvent({
    event_id: 'EVT_TOP_OUT',
    request_id: 'REQ_TOP_OUT',
    assignment_id: id,
    employee_id: 'EMP_TOP',
    branch_id: 'CN130',
    type: 'CHECK_OUT',
    client_time: `${DAY}T12:00:00+07:00`,
    server_received_at: new Date().toISOString(),
    gps_status: 'VALID',
    is_late: false,
    minutes_deviation: 0,
    fine_tier: 'NONE',
    fine_amount: 0,
  } as any);
}

test('ca đã đủ cặp + bị phạt: Admin áp lại vẫn xóa sạch phạt (tối thượng)', async () => {
  const repo = new MockSheetsAdapter();
  await seedEmployee(repo);
  seedShift(repo);
  await lateIn(repo);
  await normalOut(repo);

  const svc = new AttendanceService(repo);
  const queued: any = await svc.compensateShift({
    assignmentId: 'SHIFT_TOP_1',
    reason: 'Admin xác nhận NV có đi làm',
    actorId: 'ADMIN1',
    adminOverride: true,
  });
  const r: any = queued?.result ?? queued;
  assert.equal(r.alreadyComplete, true, 'phải nhận diện ca đã đủ cặp thay vì báo lỗi');
  assert.equal(r.cleared >= 1, true, 'phải xóa ít nhất chân check-in bị phạt');

  const evts: any[] = await repo.getAttendanceEvents('EMP_TOP', DAY);
  const inEvt = evts.find((e: any) => e.type === 'CHECK_IN');
  assert.equal(inEvt.is_late, false);
  assert.equal(inEvt.minutes_deviation, 0);
  assert.equal(inEvt.fine_tier, 'NONE');
  assert.equal(inEvt.fine_amount, 0);
  // Kỳ lương/lưới tính lại từ giờ vào ca vẫn KHÔNG phạt.
  assert.equal(lateMinutesOfEvent(inEvt, `${DAY}T07:00:00+07:00`), 0);
});

test('ca thiếu OUT: Admin bấm là ghi đủ chân còn thiếu theo giờ tan ca', async () => {
  const repo = new MockSheetsAdapter();
  await seedEmployee(repo);
  seedShift(repo);
  await lateIn(repo);

  const svc = new AttendanceService(repo);
  const queued: any = await svc.compensateShift({
    assignmentId: 'SHIFT_TOP_1',
    reason: 'NV quên check-out',
    actorId: 'ADMIN1',
    adminOverride: true,
  });
  const r: any = queued?.result ?? queued;
  assert.deepEqual(r.created, ['CHECK_OUT']);
  assert.ok(r.checkOut?.client_time, 'phải có giờ check-out');
  const evts: any[] = await repo.getAttendanceEvents('EMP_TOP', DAY);
  assert.equal(evts.filter((e: any) => e.type === 'CHECK_OUT').length, 1);
  const inEvt = evts.find((e: any) => e.type === 'CHECK_IN');
  assert.equal(Number(inEvt.fine_amount), 0, 'chân cũ đang phạt phải được xóa luôn');
});

test('ca có bản ghi VẮNG: Admin hoàn thành thì dọn VẮNG và phát hành ca nháp', async () => {
  const repo = new MockSheetsAdapter();
  await seedEmployee(repo);
  seedShift(repo, { status: 'DRAFT' });
  await repo.recordAttendanceEvent({
    event_id: 'EVT_TOP_ABSENT',
    request_id: 'REQ_TOP_ABSENT',
    assignment_id: 'SHIFT_TOP_1',
    employee_id: 'EMP_TOP',
    branch_id: 'CN130',
    type: 'ABSENT',
    client_time: `${DAY}T07:00:00+07:00`,
    server_received_at: new Date().toISOString(),
    gps_status: 'UNAVAILABLE',
  } as any);

  const svc = new AttendanceService(repo);
  const queued: any = await svc.compensateShift({
    assignmentId: 'SHIFT_TOP_1',
    reason: 'NV có đi làm nhưng quên chấm',
    actorId: 'ADMIN1',
    adminOverride: true,
  });
  const r: any = queued?.result ?? queued;
  assert.equal(r.absentCleared, 1);
  assert.equal(r.published, true);
  const shift: any = await repo.getShiftById('SHIFT_TOP_1');
  assert.equal(shift.status, 'PUBLISHED');
  const evts: any[] = await repo.getAttendanceEvents('EMP_TOP', DAY);
  assert.equal(evts.filter((e: any) => e.type === 'ABSENT').length, 0);
  assert.equal(evts.filter((e: any) => e.type === 'CHECK_IN').length, 1);
  assert.equal(evts.filter((e: any) => e.type === 'CHECK_OUT').length, 1);
});

test('ca tuần cũ đã archive: xóa phạt trong kho lưu trữ, không ghi đôi chân', async () => {
  const repo = new MockSheetsAdapter();
  await seedEmployee(repo);
  seedShift(repo);
  const archived = [
    {
      event_id: 'EVT_ARCH_IN',
      assignment_id: 'SHIFT_TOP_1',
      employee_id: 'EMP_TOP',
      type: 'CHECK_IN',
      client_time: `${DAY}T08:20:00+07:00`,
      is_late: true,
      minutes_deviation: 80,
      fine_tier: 'FULL_SHIFT',
      fine_amount: 125000,
    },
    {
      event_id: 'EVT_ARCH_OUT',
      assignment_id: 'SHIFT_TOP_1',
      employee_id: 'EMP_TOP',
      type: 'CHECK_OUT',
      client_time: `${DAY}T12:00:00+07:00`,
      is_late: false,
      minutes_deviation: 0,
      fine_tier: 'NONE',
      fine_amount: 0,
    },
  ];
  let clearedIds: string[] = [];
  (repo as any).syncService = {
    getArchivedAttendanceEvents: async () => archived,
    clearArchivedEventFines: async (ids: string[]) => { clearedIds = ids; return 1; },
    deleteArchivedAttendanceEvent: async () => null,
  };

  const svc = new AttendanceService(repo);
  const queued: any = await svc.compensateShift({
    assignmentId: 'SHIFT_TOP_1',
    reason: 'Admin chốt công tuần cũ',
    actorId: 'ADMIN1',
    adminOverride: true,
  });
  const r: any = queued?.result ?? queued;
  assert.equal(r.alreadyComplete, true);
  assert.equal(r.archivedCleared, 1);
  assert.deepEqual(clearedIds.sort(), ['EVT_ARCH_IN', 'EVT_ARCH_OUT']);
  assert.deepEqual(r.created, [], 'kho archive đã đủ cặp nên không ghi thêm chân');
});

test('luồng bot (không override) vẫn báo SHIFT_ALREADY_COMPLETE như cũ', async () => {
  const repo = new MockSheetsAdapter();
  await seedEmployee(repo);
  seedShift(repo);
  await lateIn(repo, 'SHIFT_TOP_1', false);
  await normalOut(repo);

  const svc = new AttendanceService(repo);
  await assert.rejects(
    () => svc.compensateShift({
      assignmentId: 'SHIFT_TOP_1',
      reason: 'bot chấm tự động',
      actorId: 'BOT',
    }),
    /SHIFT_ALREADY_COMPLETE/
  );
});

test('bảng ca cần hoàn thành: nêu đúng ca thiếu chân + ca đã đủ nhưng còn phạt', async () => {
  const repo = new MockSheetsAdapter();
  await seedEmployee(repo);
  seedShift(repo, { id: 'SHIFT_MISSING' });
  // Ca 2: đã đủ cặp nhưng check-in trễ / còn phạt.
  repo.shifts.push({
    assignment_id: 'SHIFT_FINED',
    employee_id: 'EMP_TOP',
    branch_id: 'CN130',
    shift_code: 'CA_2',
    date: DAY,
    start_at: `${DAY}T12:00:00+07:00`,
    end_at: `${DAY}T17:00:00+07:00`,
    status: 'PUBLISHED',
    schedule_version: 1,
  } as any);
  await repo.recordAttendanceEvent({
    event_id: 'EVT_FINED_IN',
    request_id: 'REQ_FINED_IN',
    assignment_id: 'SHIFT_FINED',
    employee_id: 'EMP_TOP',
    branch_id: 'CN130',
    type: 'CHECK_IN',
    client_time: `${DAY}T13:00:00+07:00`,
    server_received_at: new Date().toISOString(),
    gps_status: 'VALID',
    is_late: true,
    minutes_deviation: 60,
    fine_tier: 'FULL_SHIFT',
    fine_amount: 0,
  } as any);
  await repo.recordAttendanceEvent({
    event_id: 'EVT_FINED_OUT',
    request_id: 'REQ_FINED_OUT',
    assignment_id: 'SHIFT_FINED',
    employee_id: 'EMP_TOP',
    branch_id: 'CN130',
    type: 'CHECK_OUT',
    client_time: `${DAY}T17:00:00+07:00`,
    server_received_at: new Date().toISOString(),
    gps_status: 'VALID',
    is_late: false,
    minutes_deviation: 0,
    fine_tier: 'NONE',
    fine_amount: 0,
  } as any);

  const svc = new AttendanceService(repo);
  const board = await svc.listShiftCompletionBoard(DAY);
  const byId = new Map(board.rows.map((r: any) => [r.assignment_id, r]));
  const missing: any = byId.get('SHIFT_MISSING');
  assert.equal(missing.needs_action, true);
  assert.equal(missing.is_complete, false);
  assert.ok(missing.flags.includes('MISSING_IN'));
  assert.ok(missing.flags.includes('MISSING_OUT'));

  const fined: any = byId.get('SHIFT_FINED');
  assert.equal(fined.is_complete, true);
  assert.equal(fined.has_fine, true);
  assert.equal(fined.needs_action, true, 'ca đã đủ nhưng còn phạt vẫn phải hiện để Admin xóa phạt');
  assert.equal(fined.fine_tier, 'FULL_SHIFT');
  assert.equal(board.totals.fined >= 1, true);
});
