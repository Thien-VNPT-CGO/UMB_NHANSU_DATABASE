import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { AttendanceService } from '../src/services/attendance.service.js';
import { lateMinutesOfEvent, lateFineFor } from '../src/services/payroll.service.js';

const IMG = `data:image/jpeg;base64,${Buffer.from('anh-bang-chung-bu-cong-tre').toString('base64')}`;

/**
 * Ca đã có ĐỦ check-in + check-out nhưng vào trễ (bị phạt 100%): NV gửi phiếu
 * BÙ CÔNG CẢ NGÀY, HR duyệt. Sau khi duyệt:
 *  - lượt check-in hết cờ trễ + hết mức phạt,
 *  - lương ca tính đủ (không còn 0đ) — kể cả khi báo cáo/kỳ lương tính lại số
 *    phút trễ từ giờ vào ca (trước đây is_late=false bị coi là "mất cờ" nên
 *    tính bù ra 80 phút và phạt lại 100%).
 */

function seedShift(repo: MockSheetsAdapter, day: string) {
  repo.shifts.push({
    assignment_id: 'SHIFT_FINE_1',
    employee_id: 'EMP_FINE',
    branch_id: 'CN130',
    shift_code: 'CA_1',
    date: day,
    start_at: `${day}T07:00:00+07:00`,
    end_at: `${day}T12:00:00+07:00`,
    status: 'PUBLISHED',
    schedule_version: 1,
  } as any);
}

function seedLateEvents(repo: MockSheetsAdapter, day: string) {
  return Promise.all([
    repo.recordAttendanceEvent({
      event_id: 'EVT_FINE_IN',
      request_id: 'REQ_FINE_IN',
      assignment_id: 'SHIFT_FINE_1',
      employee_id: 'EMP_FINE',
      branch_id: 'CN130',
      type: 'CHECK_IN',
      client_time: `${day}T08:20:00+07:00`,
      server_received_at: new Date().toISOString(),
      gps_status: 'VALID',
      is_late: true,
      minutes_deviation: 80,
      fine_tier: 'FULL_SHIFT',
      fine_amount: 125000,
    } as any),
    repo.recordAttendanceEvent({
      event_id: 'EVT_FINE_OUT',
      request_id: 'REQ_FINE_OUT',
      assignment_id: 'SHIFT_FINE_1',
      employee_id: 'EMP_FINE',
      branch_id: 'CN130',
      type: 'CHECK_OUT',
      client_time: `${day}T12:00:00+07:00`,
      server_received_at: new Date().toISOString(),
      gps_status: 'VALID',
      is_late: false,
      minutes_deviation: 0,
      fine_tier: 'NONE',
      fine_amount: 0,
    } as any),
  ]);
}

test('lateMinutesOfEvent: is_late=false là ĐÚNG GIỜ (không tính bù từ giờ vào ca)', () => {
  const start = '2026-11-14T07:00:00+07:00';
  const lateIn = { client_time: '2026-11-14T08:20:00+07:00', is_late: false, minutes_deviation: 0 };
  assert.equal(lateMinutesOfEvent(lateIn, start), 0, 'đã duyệt bù công thì không được phạt lại');
  assert.equal(lateMinutesOfEvent({ ...lateIn, is_late: true, minutes_deviation: 80 }, start), 80);
  // Dòng Sheet cũ thiếu cờ -> vẫn phải tính bù để không bỏ sót vi phạm.
  assert.equal(lateMinutesOfEvent({ client_time: '2026-11-14T08:20:00+07:00' }, start), 80);
  assert.equal(lateMinutesOfEvent({ client_time: '2026-11-14T06:50:00+07:00' }, start), 0);
});

test('duyệt bù công cả ngày cho ca đã có in/out trễ: xóa phạt + đủ lương', async () => {
  const repo = new MockSheetsAdapter();
  const day = AttendanceService.vnDateStr();
  await repo.createEmployee({
    employee_id: 'EMP_FINE',
    employee_code: 'UBM_FINE01',
    full_name: 'Pham Ngoc Anh',
    phone_normalized: '0900000099',
    employment_status: 'OFFICIAL',
    default_branch_id: 'CN130',
    default_shift_code: 'CA_1',
    current_rate_per_hour: 25500,
    adjust_points_earned: 5,
    adjust_points_spent: 0,
  } as any);
  seedShift(repo, day);
  await seedLateEvents(repo, day);

  const svc = new AttendanceService(repo);
  const oldHour = AttendanceService.vnHourNow;
  (AttendanceService as any).vnHourNow = () => 10;
  try {
    const wrap: any = await svc.requestAdjustment({
      assignmentId: 'SHIFT_FINE_1',
      employeeId: 'EMP_FINE',
      branchId: 'CN130',
      incidentDate: day,
      reason: `[BU_CONG_NGAY] ${day}: máy lỗi không điểm danh đúng giờ vào ca`,
      minutesRequested: 0,
      photoBase64: IMG,
    } as any);
    const adj = wrap?.result || wrap;
    const approved: any = await svc.reviewAdjustment(adj.adjustment_id, 'APPROVED', 'HR1', undefined, 'ok', 'HR');
    assert.equal((approved?.result || approved)?._violationCleared, 2, 'phải xóa cờ trễ/phạt trên cả 2 chân');

    const evts: any[] = await repo.getAttendanceEvents('EMP_FINE', day);
    const inEvt = evts.find((e: any) => e.type === 'CHECK_IN');
    assert.equal(inEvt.is_late, false);
    assert.equal(inEvt.minutes_deviation, 0);
    assert.equal(inEvt.fine_tier, 'NONE');
    assert.equal(inEvt.fine_amount, 0);

    // Báo cáo/kỳ lương tính lại: phút trễ = 0 -> không phạt -> đủ 5h × đơn giá.
    const lateMin = lateMinutesOfEvent(inEvt, `${day}T07:00:00+07:00`);
    const fine = lateFineFor(lateMin, 5 * 25500);
    assert.equal(lateMin, 0);
    assert.equal(fine.unpaid, false);
    assert.equal(fine.deduction, 0);
  } finally {
    (AttendanceService as any).vnHourNow = oldHour;
  }
});

test('phiếu bù công bị từ chối: giữ nguyên phạt trễ (không xóa oan)', async () => {
  const repo = new MockSheetsAdapter();
  const day = AttendanceService.vnDateStr();
  await repo.createEmployee({
    employee_id: 'EMP_FINE',
    employee_code: 'UBM_FINE01',
    full_name: 'Pham Ngoc Anh',
    phone_normalized: '0900000099',
    employment_status: 'OFFICIAL',
    default_branch_id: 'CN130',
    default_shift_code: 'CA_1',
    current_rate_per_hour: 25500,
    adjust_points_earned: 5,
    adjust_points_spent: 0,
  } as any);
  seedShift(repo, day);
  await seedLateEvents(repo, day);

  const svc = new AttendanceService(repo);
  const oldHour = AttendanceService.vnHourNow;
  (AttendanceService as any).vnHourNow = () => 10;
  try {
    const wrap: any = await svc.requestAdjustment({
      assignmentId: 'SHIFT_FINE_1',
      employeeId: 'EMP_FINE',
      branchId: 'CN130',
      incidentDate: day,
      reason: `[BU_CONG_NGAY] ${day}: xin bù công vì lý do cá nhân`,
      minutesRequested: 0,
      photoBase64: IMG,
    } as any);
    const adj = wrap?.result || wrap;
    await svc.reviewAdjustment(adj.adjustment_id, 'REJECTED', 'HR1', 0, 'không hợp lệ', 'HR');

    const inEvt: any = (await repo.getAttendanceEvents('EMP_FINE', day)).find((e: any) => e.type === 'CHECK_IN');
    assert.equal(inEvt.is_late, true);
    assert.equal(inEvt.fine_tier, 'FULL_SHIFT');
  } finally {
    (AttendanceService as any).vnHourNow = oldHour;
  }
});

test('tự chữa: phiếu đã duyệt mà Sheet cũ đè ngược cờ trễ -> gỡ phạt lại', async () => {
  const repo = new MockSheetsAdapter();
  const day = AttendanceService.vnDateStr();
  await repo.createEmployee({
    employee_id: 'EMP_FINE',
    employee_code: 'UBM_FINE01',
    full_name: 'Pham Ngoc Anh',
    phone_normalized: '0900000099',
    employment_status: 'OFFICIAL',
    default_branch_id: 'CN130',
    default_shift_code: 'CA_1',
    current_rate_per_hour: 25500,
    adjust_points_earned: 5,
    adjust_points_spent: 0,
  } as any);
  seedShift(repo, day);
  await seedLateEvents(repo, day);

  const svc = new AttendanceService(repo);
  const oldHour = AttendanceService.vnHourNow;
  (AttendanceService as any).vnHourNow = () => 10;
  try {
    const wrap: any = await svc.requestAdjustment({
      assignmentId: 'SHIFT_FINE_1',
      employeeId: 'EMP_FINE',
      branchId: 'CN130',
      incidentDate: day,
      reason: `[BU_CONG_NGAY] ${day}: mất điện thoại không điểm danh được`,
      minutesRequested: 0,
      photoBase64: IMG,
    } as any);
    const adj = wrap?.result || wrap;
    await svc.reviewAdjustment(adj.adjustment_id, 'APPROVED', 'HR1', undefined, 'ok', 'HR');

    // Giả lập đúng lỗi cũ: lượt pull đọc dòng Sheet chưa kịp cập nhật và đè ngược
    // cờ trễ/phạt 100% lên bộ nhớ sau khi phiếu đã duyệt.
    await repo.updateAttendanceEvent('EVT_FINE_IN', {
      is_late: true,
      minutes_deviation: 80,
      fine_tier: 'FULL_SHIFT',
      fine_amount: 125000,
    } as any);

    const repaired = await svc.repairApprovedAdjustmentFines();
    // Chỉ chân CHECK_IN bị nhiễm phạt (chân OUT vốn NONE) — vẫn phải dọn sạch cả ca.
    assert.equal(repaired.cleared, 1, 'gỡ phạt đúng chân bị nhiễm');

    const evts: any[] = await repo.getAttendanceEvents('EMP_FINE', day);
    for (const e of evts) {
      assert.equal(e.is_late, false);
      assert.equal(e.fine_tier, 'NONE');
      assert.equal(Number(e.minutes_deviation) || 0, 0);
      assert.equal(Number(e.fine_amount) || 0, 0);
    }
  } finally {
    (AttendanceService as any).vnHourNow = oldHour;
  }
});
