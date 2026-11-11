import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { AttendanceService } from '../src/services/attendance.service.js';

const HOUR = 3_600_000;
const IMG = `data:image/jpeg;base64,${Buffer.from('anh-bang-chung-bu-cong').toString('base64')}`;

/**
 * NV thử việc (PROBATION) KHÔNG phải tích điểm để dùng chức năng bù công ngày.
 * Bộ test này khóa lại: chi phí 0 điểm, không trừ điểm khi tạo phiếu, không
 * cộng điểm ảo khi phiếu bị từ chối/hết hạn; NV chính thức vẫn trả 5 điểm.
 */

test('isProbationEmployee: chỉ đúng PROBATION (không phân biệt hoa/thường, khoảng trắng)', () => {
  assert.equal(AttendanceService.isProbationEmployee({ employment_status: 'PROBATION' }), true);
  assert.equal(AttendanceService.isProbationEmployee({ employment_status: ' probation ' }), true);
  assert.equal(AttendanceService.isProbationEmployee({ employment_status: 'OFFICIAL' }), false);
  assert.equal(AttendanceService.isProbationEmployee({ employment_status: 'PRE_ONBOARDING' }), false);
  assert.equal(AttendanceService.isProbationEmployee({}), false);
  assert.equal(AttendanceService.isProbationEmployee(null), false);
});

test('buCongNgayPointCost: NV thử việc 0 điểm, NV chính thức 5 điểm', () => {
  assert.equal(AttendanceService.buCongNgayPointCost({ employment_status: 'PROBATION' }), 0);
  assert.equal(AttendanceService.buCongNgayPointCost({ employment_status: 'OFFICIAL' }), AttendanceService.BU_CONG_NGAY_COST);
  assert.equal(AttendanceService.buCongNgayPointCost({ employment_status: 'OFFICIAL' }), 5);
  assert.equal(AttendanceService.buCongNgayPointCost(null), 5);
});

test('adjustmentPointsCharged: phiếu cũ (chưa có cột) coi như đã trừ 5 điểm', () => {
  assert.equal(AttendanceService.adjustmentPointsCharged({}), 5);
  assert.equal(AttendanceService.adjustmentPointsCharged({ points_charged: undefined }), 5);
  assert.equal(AttendanceService.adjustmentPointsCharged({ points_charged: '' }), 5);
  assert.equal(AttendanceService.adjustmentPointsCharged({ points_charged: 0 }), 0);
  assert.equal(AttendanceService.adjustmentPointsCharged({ points_charged: '0' }), 0);
  assert.equal(AttendanceService.adjustmentPointsCharged({ points_charged: 5 }), 5);
  assert.equal(AttendanceService.adjustmentPointsCharged({ points_charged: '3' }), 3);
});

async function setupEmployee(status: 'PROBATION' | 'OFFICIAL', spent = 0, earned = 0) {
  const repo = new MockSheetsAdapter();
  const day = AttendanceService.vnDateStr();
  await repo.createEmployee({
    employee_id: 'EMP_BU_CONG',
    employee_code: 'UBM_BU_CONG01',
    full_name: 'Nhân Viên Bù Công',
    phone_normalized: '0900000199',
    employment_status: status,
    employment_type: status,
    default_branch_id: 'CN130',
    default_shift_code: 'CA_1',
    current_rate_per_hour: 30000,
    adjust_points_earned: earned,
    adjust_points_spent: spent,
  } as any);
  repo.shifts.push({
    assignment_id: 'SHIFT_BU_CONG_1',
    employee_id: 'EMP_BU_CONG',
    branch_id: 'CN130',
    shift_code: 'CA_1',
    date: day,
    start_at: `${day}T07:00:00+07:00`,
    end_at: `${day}T12:00:00+07:00`,
    status: 'PUBLISHED',
    schedule_version: 1,
  } as any);
  return { repo, svc: new AttendanceService(repo), day };
}

async function requestBuCongNgay(svc: AttendanceService, day: string) {
  return svc.requestAdjustment({
    assignmentId: 'SHIFT_BU_CONG_1',
    employeeId: 'EMP_BU_CONG',
    branchId: 'CN130',
    incidentDate: day,
    reason: `[BU_CONG_NGAY] ${day}: Quên điểm danh cả ngày do việc gia đình`,
    minutesRequested: 0,
    photoBase64: IMG,
  } as any);
}

test('NV thử việc 0 điểm vẫn gửi được phiếu bù công ngày và không bị trừ điểm', async () => {
  const { repo, svc, day } = await setupEmployee('PROBATION', 0, 0);
  const oldHour = AttendanceService.vnHourNow;
  (AttendanceService as any).vnHourNow = () => 10;
  try {
    await requestBuCongNgay(svc, day);
    const list: any[] = await repo.listAttendanceAdjustments(undefined, 'EMP_BU_CONG');
    assert.equal(list.length, 1);
    assert.equal(list[0].status, 'PENDING');
    assert.equal(list[0].points_charged, 0);

    const emp: any = await repo.getEmployeeById('EMP_BU_CONG');
    assert.equal(Number(emp.adjust_points_spent) || 0, 0);
    assert.equal(AttendanceService.adjustPointsOf(emp).balance, 0);
  } finally {
    (AttendanceService as any).vnHourNow = oldHour;
  }
});

test('NV chính thức 0 điểm bị chặn (vẫn phải tích đủ 5 điểm)', async () => {
  const { svc, day } = await setupEmployee('OFFICIAL', 0, 0);
  const oldHour = AttendanceService.vnHourNow;
  (AttendanceService as any).vnHourNow = () => 10;
  try {
    await assert.rejects(() => requestBuCongNgay(svc, day), /ADJUSTMENT_NO_POINTS/);
  } finally {
    (AttendanceService as any).vnHourNow = oldHour;
  }
});

test('NV chính thức đủ 5 điểm: tạo phiếu bị trừ 5 điểm và lưu points_charged = 5', async () => {
  const { repo, svc, day } = await setupEmployee('OFFICIAL', 0, 5);
  const oldHour = AttendanceService.vnHourNow;
  (AttendanceService as any).vnHourNow = () => 10;
  try {
    await requestBuCongNgay(svc, day);
    const list: any[] = await repo.listAttendanceAdjustments(undefined, 'EMP_BU_CONG');
    assert.equal(list.length, 1);
    assert.equal(list[0].points_charged, 5);
    const emp: any = await repo.getEmployeeById('EMP_BU_CONG');
    assert.equal(AttendanceService.adjustPointsOf(emp).balance, 0);
    assert.equal(AttendanceService.adjustPointsOf(emp).spent, 5);
  } finally {
    (AttendanceService as any).vnHourNow = oldHour;
  }
});

async function seedPending(repo: MockSheetsAdapter, id: string, ageHours: number, pointsCharged: number | undefined) {
  const created = new Date(Date.now() - ageHours * HOUR).toISOString();
  const adj: any = await repo.createAttendanceAdjustment({
    adjustment_id: id,
    employee_id: 'EMP_BU_CONG',
    branch_id: 'CN130',
    assignment_id: 'SHIFT_BU_CONG_1',
    reason: `[BU_CONG_NGAY] ${created.slice(0, 10)}: Quên điểm danh cả ngày`,
    minutes_requested: 0,
    status: 'PENDING',
    ...(pointsCharged === undefined ? {} : { points_charged: pointsCharged }),
  } as any);
  adj.created_at = created;
  adj.updated_at = created;
  return adj;
}

test('phiếu miễn phí (NV thử việc) hết hạn: KHÔNG cộng điểm ảo', async () => {
  const { repo, svc } = await setupEmployee('PROBATION', 0, 0);
  await seedPending(repo, `ADJ_${Date.now()}_9001`, 73, 0);

  const res = await svc.expireStaleAdjustments(new Date());
  assert.equal(res.rejected.length, 1);

  const emp: any = await repo.getEmployeeById('EMP_BU_CONG');
  assert.equal(AttendanceService.adjustPointsOf(emp).spent, 0);
  assert.equal(AttendanceService.adjustPointsOf(emp).balance, 0);

  const list: any[] = await repo.listAttendanceAdjustments();
  const ticket = list.find(a => String(a.adjustment_id).endsWith('_9001'));
  assert.match(String(ticket.review_note || ''), /miễn phí điểm/);
});

test('phiếu trả 5 điểm bị hủy: hoàn đúng 5 điểm (không hoàn quá)', async () => {
  const { repo, svc } = await setupEmployee('OFFICIAL', 5, 5);
  await seedPending(repo, `ADJ_${Date.now()}_9002`, 73, 5);

  await svc.expireStaleAdjustments(new Date());

  const emp: any = await repo.getEmployeeById('EMP_BU_CONG');
  assert.equal(AttendanceService.adjustPointsOf(emp).spent, 0);
  assert.equal(AttendanceService.adjustPointsOf(emp).balance, 5);
});
