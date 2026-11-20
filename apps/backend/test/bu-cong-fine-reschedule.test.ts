import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { AttendanceService } from '../src/services/attendance.service.js';
import { lateMinutesOfEvent, linkDayEvents } from '../src/services/payroll.service.js';

const IMG = `data:image/jpeg;base64,${Buffer.from('anh-bang-chung-doi-ca').toString('base64')}`;

/**
 * HR xếp lại lịch sau khi NV đã chấm công: ca cũ (assignment cũ) bị HỦY,
 * ca mới (assignment mới) được tạo cho cùng ngày. Lượt CHECK_IN của NV vẫn
 * gắn assignment cũ (đã hủy) — lưới/payroll vẫn gộp lượt mồ côi này vào ca
 * mới để tính công/lương.
 *
 * NV gửi phiếu QUÊN CHECK-OUT cho ca mới. HR duyệt xong thì mọi lượt của ca
 * trong ngày (kể cả lượt còn gắn assignment cũ) phải hết cờ trễ/phạt; nếu chỉ
 * quét đúng assignment mới thì ca vẫn hiện "trễ 80p - phạt 100%".
 */
async function seedEmployee(repo: MockSheetsAdapter) {
  await repo.createEmployee({
    employee_id: 'EMP_RESCHED',
    employee_code: 'UBM_RESCHED01',
    full_name: 'Tran Doi Ca',
    phone_normalized: '0900000177',
    employment_status: 'OFFICIAL',
    default_branch_id: 'CN130',
    default_shift_code: 'CA_1',
    current_rate_per_hour: 25500,
    adjust_points_earned: 5,
    adjust_points_spent: 0,
  } as any);
}

test('duyệt quên check-out sau khi HR xếp lại ca: gỡ phạt cả lượt gắn assignment cũ', async () => {
  const repo = new MockSheetsAdapter();
  const day = AttendanceService.vnDateStr();
  await seedEmployee(repo);
  // Ca cũ đã bị hủy khi HR xếp lại lịch.
  repo.shifts.push({
    assignment_id: 'SHIFT_OLD',
    employee_id: 'EMP_RESCHED',
    branch_id: 'CN130',
    shift_code: 'CA_1',
    date: day,
    start_at: `${day}T07:00:00+07:00`,
    end_at: `${day}T12:00:00+07:00`,
    status: 'CANCELLED',
    schedule_version: 1,
  } as any);
  // Ca mới cùng ngày (assignment mới).
  repo.shifts.push({
    assignment_id: 'SHIFT_NEW',
    employee_id: 'EMP_RESCHED',
    branch_id: 'CN130',
    shift_code: 'CA_1',
    date: day,
    start_at: `${day}T07:00:00+07:00`,
    end_at: `${day}T12:00:00+07:00`,
    status: 'PUBLISHED',
    schedule_version: 2,
  } as any);
  // NV đã check-in trễ 80 phút trên ca CŨ, quên check-out.
  await repo.recordAttendanceEvent({
    event_id: 'EVT_OLD_IN',
    request_id: 'REQ_OLD_IN',
    assignment_id: 'SHIFT_OLD',
    employee_id: 'EMP_RESCHED',
    branch_id: 'CN130',
    type: 'CHECK_IN',
    client_time: `${day}T08:20:00+07:00`,
    server_received_at: new Date().toISOString(),
    gps_status: 'VALID',
    is_late: true,
    minutes_deviation: 80,
    fine_tier: 'FULL_SHIFT',
    fine_amount: 125000,
  } as any);

  const svc = new AttendanceService(repo);
  const oldHour = AttendanceService.vnHourNow;
  (AttendanceService as any).vnHourNow = () => 10;
  try {
    const wrap: any = await svc.requestAdjustment({
      assignmentId: 'SHIFT_NEW',
      employeeId: 'EMP_RESCHED',
      branchId: 'CN130',
      incidentDate: day,
      reason: `[QUEN_CHECKOUT] ${day}: quên check-out vì hết pin điện thoại`,
      minutesRequested: 0,
      photoBase64: IMG,
    } as any);
    const adj = wrap?.result || wrap;
    await svc.reviewAdjustment(adj.adjustment_id, 'APPROVED', 'HR1', undefined, 'ok', 'HR');

    const evts: any[] = await repo.getAttendanceEvents('EMP_RESCHED', day);
    for (const e of evts) {
      if (e.type === 'CHECK_IN' || e.type === 'CHECK_OUT') {
        assert.equal(e.is_late, false, `${e.type} phải hết cờ trễ`);
        assert.equal(Number(e.minutes_deviation) || 0, 0, `${e.type} phải hết phút trễ`);
        assert.equal(String(e.fine_tier || 'NONE'), 'NONE', `${e.type} phải hết mức phạt`);
        assert.equal(Number(e.fine_amount) || 0, 0, `${e.type} phải hết tiền phạt`);
      }
    }

    // Lưới/payroll gộp lượt mồ côi (assignment cũ đã hủy) vào ca mới:
    // phút trễ thực tế phải là 0.
    const shifts = await repo.getShiftsForEmployee('EMP_RESCHED', day, day);
    const linked = linkDayEvents(shifts, evts);
    const legs: any = linked.get('SHIFT_NEW') || {};
    assert.equal(lateMinutesOfEvent(legs.CHECK_IN, `${day}T07:00:00+07:00`), 0);
  } finally {
    (AttendanceService as any).vnHourNow = oldHour;
  }
});

test('tự chữa (startup V2): phiếu đã duyệt trước bản vá vẫn gỡ phạt trên lượt gắn ca cũ', async () => {
  const repo = new MockSheetsAdapter();
  const day = AttendanceService.vnDateStr();
  await seedEmployee(repo);
  repo.shifts.push({
    assignment_id: 'SHIFT_OLD',
    employee_id: 'EMP_RESCHED',
    branch_id: 'CN130',
    shift_code: 'CA_1',
    date: day,
    start_at: `${day}T07:00:00+07:00`,
    end_at: `${day}T12:00:00+07:00`,
    status: 'CANCELLED',
    schedule_version: 1,
  } as any);
  repo.shifts.push({
    assignment_id: 'SHIFT_NEW',
    employee_id: 'EMP_RESCHED',
    branch_id: 'CN130',
    shift_code: 'CA_1',
    date: day,
    start_at: `${day}T07:00:00+07:00`,
    end_at: `${day}T12:00:00+07:00`,
    status: 'PUBLISHED',
    schedule_version: 2,
  } as any);
  await repo.recordAttendanceEvent({
    event_id: 'EVT_OLD_IN',
    request_id: 'REQ_OLD_IN',
    assignment_id: 'SHIFT_OLD',
    employee_id: 'EMP_RESCHED',
    branch_id: 'CN130',
    type: 'CHECK_IN',
    client_time: `${day}T08:20:00+07:00`,
    server_received_at: new Date().toISOString(),
    gps_status: 'VALID',
    is_late: true,
    minutes_deviation: 80,
    fine_tier: 'FULL_SHIFT',
    fine_amount: 125000,
  } as any);
  // Dữ liệu CŨ: phiếu đã duyệt từ trước (không chạy qua bản vá mới).
  await repo.createAttendanceAdjustment({
    adjustment_id: `ADJ_${Date.now()}_777`,
    assignment_id: 'SHIFT_NEW',
    employee_id: 'EMP_RESCHED',
    branch_id: 'CN130',
    reason: `[QUEN_CHECKOUT] ${day}: quên check-out`,
    minutes_requested: 0,
    status: 'APPROVED',
    approved_by: 'HR1',
  } as any);

  const svc = new AttendanceService(repo);
  const r = await svc.repairApprovedAdjustmentFines();
  assert.ok(r.cleared >= 1, 'phải gỡ phạt trên lượt gắn assignment cũ');
  const evts: any[] = await repo.getAttendanceEvents('EMP_RESCHED', day);
  const inEvt = evts.find((e: any) => e.type === 'CHECK_IN');
  assert.equal(inEvt.is_late, false);
  assert.equal(String(inEvt.fine_tier || 'NONE'), 'NONE');
  assert.equal(Number(inEvt.fine_amount) || 0, 0);
});

test('lượt trễ nhưng is_late TRỐNG (dòng Sheet cũ): duyệt xong vẫn phải hết phạt', async () => {
  const repo = new MockSheetsAdapter();
  const day = AttendanceService.vnDateStr();
  await seedEmployee(repo);
  repo.shifts.push({
    assignment_id: 'SHIFT_A',
    employee_id: 'EMP_RESCHED',
    branch_id: 'CN130',
    shift_code: 'CA_1',
    date: day,
    start_at: `${day}T07:00:00+07:00`,
    end_at: `${day}T12:00:00+07:00`,
    status: 'PUBLISHED',
    schedule_version: 1,
  } as any);
  // Dòng Sheet cũ: chưa từng ghi cờ is_late -> payroll/lưới tự suy trễ từ giờ vào.
  await repo.recordAttendanceEvent({
    event_id: 'EVT_NOFLAG_IN',
    request_id: 'REQ_NOFLAG_IN',
    assignment_id: 'SHIFT_A',
    employee_id: 'EMP_RESCHED',
    branch_id: 'CN130',
    type: 'CHECK_IN',
    client_time: `${day}T08:20:00+07:00`,
    server_received_at: new Date().toISOString(),
    gps_status: 'VALID',
    is_late: undefined,
    minutes_deviation: 0,
    fine_tier: 'NONE',
    fine_amount: 0,
  } as any);

  const svc = new AttendanceService(repo);
  const oldHour = AttendanceService.vnHourNow;
  (AttendanceService as any).vnHourNow = () => 10;
  try {
    const before: any[] = await repo.getAttendanceEvents('EMP_RESCHED', day);
    // Trước khi duyệt: chưa có cờ nhưng payroll vẫn tính trễ 80p.
    assert.equal(lateMinutesOfEvent(before[0], `${day}T07:00:00+07:00`), 80);

    const wrap: any = await svc.requestAdjustment({
      assignmentId: 'SHIFT_A',
      employeeId: 'EMP_RESCHED',
      branchId: 'CN130',
      incidentDate: day,
      reason: `[QUEN_CHECKOUT] ${day}: quên check-out`,
      minutesRequested: 0,
      photoBase64: IMG,
    } as any);
    const adj = wrap?.result || wrap;
    await svc.reviewAdjustment(adj.adjustment_id, 'APPROVED', 'HR1', undefined, 'ok', 'HR');

    const evts: any[] = await repo.getAttendanceEvents('EMP_RESCHED', day);
    const inEvt = evts.find((e: any) => e.event_id === 'EVT_NOFLAG_IN');
    assert.equal(inEvt.is_late, false, 'phải đóng dấu is_late=false tường minh');
    assert.equal(lateMinutesOfEvent(inEvt, `${day}T07:00:00+07:00`), 0);
  } finally {
    (AttendanceService as any).vnHourNow = oldHour;
  }
});

test('phiếu gắn ca ĐÃ HỦY (HR "Sửa ca" tạo ca thay thế): duyệt là gỡ phạt trên ca thay thế', async () => {
  const repo = new MockSheetsAdapter();
  const day = AttendanceService.vnDateStr();
  await seedEmployee(repo);
  // Ca gốc đã bị hủy khi HR sửa ca; ca thay thế cùng ngày + cùng mã CA_1.
  repo.shifts.push({
    assignment_id: 'SHIFT_CANCELED',
    employee_id: 'EMP_RESCHED',
    branch_id: 'CN130',
    shift_code: 'CA_1',
    date: day,
    start_at: `${day}T07:00:00+07:00`,
    end_at: `${day}T12:00:00+07:00`,
    status: 'CANCELLED',
    schedule_version: 1,
  } as any);
  repo.shifts.push({
    assignment_id: 'SHIFT_REPLACED',
    employee_id: 'EMP_RESCHED',
    branch_id: 'CN130',
    shift_code: 'CA_1',
    date: day,
    start_at: `${day}T07:00:00+07:00`,
    end_at: `${day}T12:00:00+07:00`,
    status: 'PUBLISHED',
    schedule_version: 2,
  } as any);
  // Đúng ca thật: vào 07:29 (trễ 29p -> FLAT_30K 30.000đ), ra 12:32.
  await repo.recordAttendanceEvent({
    event_id: 'EVT_REAL_IN',
    request_id: 'REQ_REAL_IN',
    assignment_id: 'SHIFT_REPLACED',
    employee_id: 'EMP_RESCHED',
    branch_id: 'CN130',
    type: 'CHECK_IN',
    client_time: `${day}T07:29:00+07:00`,
    server_received_at: new Date().toISOString(),
    gps_status: 'VALID',
    is_late: true,
    minutes_deviation: 29,
    fine_tier: 'FLAT_30K',
    fine_amount: 30000,
  } as any);
  await repo.recordAttendanceEvent({
    event_id: 'EVT_REAL_OUT',
    request_id: 'REQ_REAL_OUT',
    assignment_id: 'SHIFT_REPLACED',
    employee_id: 'EMP_RESCHED',
    branch_id: 'CN130',
    type: 'CHECK_OUT',
    client_time: `${day}T12:32:00+07:00`,
    server_received_at: new Date().toISOString(),
    gps_status: 'VALID',
    is_late: false,
    minutes_deviation: 0,
    fine_tier: 'NONE',
    fine_amount: 0,
  } as any);

  const svc = new AttendanceService(repo);
  const oldHour = AttendanceService.vnHourNow;
  (AttendanceService as any).vnHourNow = () => 10;
  try {
    const wrap: any = await svc.requestAdjustment({
      assignmentId: 'SHIFT_CANCELED',
      employeeId: 'EMP_RESCHED',
      branchId: 'CN130',
      incidentDate: day,
      reason: `[QUEN_CHECKIN] ${day}: check in trễ do đổi ca trên hệ thống`,
      minutesRequested: 0,
      photoBase64: IMG,
    } as any);
    const adj = wrap?.result || wrap;
    // Phiếu phải được chốt sang ca THAY THẾ còn sống, không bám ca đã hủy.
    assert.equal(adj.assignment_id, 'SHIFT_REPLACED');
    await svc.reviewAdjustment(adj.adjustment_id, 'APPROVED', 'HR1', undefined, 'ok', 'HR');

    const evts: any[] = await repo.getAttendanceEvents('EMP_RESCHED', day);
    const inEvt = evts.find((e: any) => e.event_id === 'EVT_REAL_IN');
    assert.equal(inEvt.is_late, false, 'CHECK_IN thật phải hết cờ trễ');
    assert.equal(Number(inEvt.minutes_deviation) || 0, 0);
    assert.equal(String(inEvt.fine_tier || 'NONE'), 'NONE');
    assert.equal(Number(inEvt.fine_amount) || 0, 0);
    assert.equal(lateMinutesOfEvent(inEvt, `${day}T07:00:00+07:00`), 0);
  } finally {
    (AttendanceService as any).vnHourNow = oldHour;
  }
});

test('tự chữa phiếu CŨ gắn ca đã hủy: gỡ phạt trên lượt của ca thay thế', async () => {
  const repo = new MockSheetsAdapter();
  const day = AttendanceService.vnDateStr();
  await seedEmployee(repo);
  repo.shifts.push({
    assignment_id: 'SHIFT_CANCELED',
    employee_id: 'EMP_RESCHED',
    branch_id: 'CN130',
    shift_code: 'CA_1',
    date: day,
    start_at: `${day}T07:00:00+07:00`,
    end_at: `${day}T12:00:00+07:00`,
    status: 'CANCELLED',
    schedule_version: 1,
  } as any);
  repo.shifts.push({
    assignment_id: 'SHIFT_REPLACED',
    employee_id: 'EMP_RESCHED',
    branch_id: 'CN130',
    shift_code: 'CA_1',
    date: day,
    start_at: `${day}T07:00:00+07:00`,
    end_at: `${day}T12:00:00+07:00`,
    status: 'PUBLISHED',
    schedule_version: 2,
  } as any);
  await repo.recordAttendanceEvent({
    event_id: 'EVT_REAL_IN',
    request_id: 'REQ_REAL_IN',
    assignment_id: 'SHIFT_REPLACED',
    employee_id: 'EMP_RESCHED',
    branch_id: 'CN130',
    type: 'CHECK_IN',
    client_time: `${day}T07:29:00+07:00`,
    server_received_at: new Date().toISOString(),
    gps_status: 'VALID',
    is_late: true,
    minutes_deviation: 29,
    fine_tier: 'FLAT_30K',
    fine_amount: 30000,
  } as any);
  // Phiếu cũ: lưu đúng assignment ĐÃ HỦY (lỗi resolve trước bản vá) + đã duyệt.
  await repo.createAttendanceAdjustment({
    adjustment_id: `ADJ_${Date.now()}_888`,
    assignment_id: 'SHIFT_CANCELED',
    employee_id: 'EMP_RESCHED',
    branch_id: 'CN130',
    reason: `[QUEN_CHECKIN] ${day}: quên bấm check in khi nhận hàng gấp`,
    minutes_requested: 0,
    status: 'APPROVED',
    approved_by: 'HR1',
  } as any);

  const svc = new AttendanceService(repo);
  const r = await svc.repairApprovedAdjustmentFines();
  assert.ok(r.cleared >= 1, 'phải gỡ phạt trên lượt của ca thay thế');
  const evts: any[] = await repo.getAttendanceEvents('EMP_RESCHED', day);
  const inEvt = evts.find((e: any) => e.event_id === 'EVT_REAL_IN');
  assert.equal(inEvt.is_late, false);
  assert.equal(Number(inEvt.fine_amount) || 0, 0);
  assert.equal(String(inEvt.fine_tier || 'NONE'), 'NONE');
});

test('không xóa phạt của ca LIVE khác cùng ngày khi duyệt phiếu ca A', async () => {
  const repo = new MockSheetsAdapter();
  const day = AttendanceService.vnDateStr();
  await seedEmployee(repo);
  for (const id of ['SHIFT_A', 'SHIFT_B']) {
    repo.shifts.push({
      assignment_id: id,
      employee_id: 'EMP_RESCHED',
      branch_id: 'CN130',
      shift_code: id === 'SHIFT_A' ? 'CA_1' : 'CA_2',
      date: day,
      start_at: `${day}T07:00:00+07:00`,
      end_at: `${day}T12:00:00+07:00`,
      status: 'PUBLISHED',
      schedule_version: 1,
    } as any);
  }
  // Ca A: có IN sạch, thiếu OUT -> nguồn của phiếu quên check-out.
  await repo.recordAttendanceEvent({
    event_id: 'EVT_A_IN',
    request_id: 'REQ_A_IN',
    assignment_id: 'SHIFT_A',
    employee_id: 'EMP_RESCHED',
    branch_id: 'CN130',
    type: 'CHECK_IN',
    client_time: `${day}T07:00:00+07:00`,
    server_received_at: new Date().toISOString(),
    gps_status: 'VALID',
    is_late: false,
    minutes_deviation: 0,
    fine_tier: 'NONE',
    fine_amount: 0,
  } as any);
  // Ca B (ca LIVE khác): vi phạm thật, KHÔNG được xóa oan.
  await repo.recordAttendanceEvent({
    event_id: 'EVT_B_IN',
    request_id: 'REQ_B_IN',
    assignment_id: 'SHIFT_B',
    employee_id: 'EMP_RESCHED',
    branch_id: 'CN130',
    type: 'CHECK_IN',
    client_time: `${day}T09:30:00+07:00`,
    server_received_at: new Date().toISOString(),
    gps_status: 'VALID',
    is_late: true,
    minutes_deviation: 150,
    fine_tier: 'FULL_SHIFT',
    fine_amount: 125000,
  } as any);

  const svc = new AttendanceService(repo);
  const oldHour = AttendanceService.vnHourNow;
  (AttendanceService as any).vnHourNow = () => 10;
  try {
    const wrap: any = await svc.requestAdjustment({
      assignmentId: 'SHIFT_A',
      employeeId: 'EMP_RESCHED',
      branchId: 'CN130',
      incidentDate: day,
      reason: `[QUEN_CHECKOUT] ${day}: quên check-out`,
      minutesRequested: 0,
      photoBase64: IMG,
    } as any);
    const adj = wrap?.result || wrap;
    await svc.reviewAdjustment(adj.adjustment_id, 'APPROVED', 'HR1', undefined, 'ok', 'HR');

    const evts: any[] = await repo.getAttendanceEvents('EMP_RESCHED', day);
    const bIn = evts.find((e: any) => e.event_id === 'EVT_B_IN');
    assert.equal(bIn.is_late, true, 'ca LIVE khác phải giữ nguyên phạt');
    assert.equal(Number(bIn.fine_amount) || 0, 125000);
    assert.equal(String(bIn.fine_tier || 'NONE'), 'FULL_SHIFT');
  } finally {
    (AttendanceService as any).vnHourNow = oldHour;
  }
});
