import test from 'node:test';
import assert from 'node:assert/strict';
import { AttendanceService } from '../src/services/attendance.service.js';

/** Ngày VN -> ISO UTC (trừ 7h) để created_at quy đổi đúng ngày VN. */
function atVn(dateStr: string, hour = 10): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + (hour - 7) * 3_600_000).toISOString();
}

function adj(createdVnDate: string, status: 'PENDING' | 'APPROVED' | 'REJECTED', id = '') {
  return {
    adjustment_id: id || `ADJ_${createdVnDate}_${status}`,
    employee_id: 'EMP1',
    reason: `[BU_CONG_NGAY] ${createdVnDate}: quên điểm danh`,
    status,
    created_at: atVn(createdVnDate),
  };
}

const NOW_WEEK1 = new Date(`${atVn('2026-10-02', 9)}`);
// Thứ Hai 05/10: tuần lịch mới đã bắt đầu dù mới là ngày 5 của tháng.
const NOW_WEEK2_START = new Date(`${atVn('2026-10-05', 9)}`);
const NOW_WEEK3 = new Date(`${atVn('2026-10-15', 9)}`);
const NOW_MONTH_END = new Date(`${atVn('2026-10-31', 9)}`);
// 10/11/2026 (Thứ Ba) — tháng 11 đã trôi qua 2 tuần lịch (2/11 và 9/11).
const NOW_NEW_MONTH = new Date(`${atVn('2026-11-10', 9)}`);

test('đầu tháng: tối đa 1 phiếu/tuần đã bắt đầu', () => {
  const q = AttendanceService.buCongNgayQuotaOf([], 'EMP1', NOW_WEEK1);
  assert.equal(q.month, '2026-10');
  assert.equal(q.weeksElapsed, 1);
  assert.equal(q.monthLimit, 1);
  assert.equal(q.availableNow, 1);
  assert.equal(q.weekStart, '2026-09-28'); // tuần chứa ngày 1/10 (Thứ Năm)
  assert.equal(q.weekEnd, '2026-10-04');
});

test('đầu tháng rơi giữa tuần: sang Thứ Hai mới được mở thêm phiếu', () => {
  // 01/10 là Thứ Năm -> tuần chứa ngày 1 là tuần 1. 02/10 vẫn tuần 1 (1 phiếu),
  // 05/10 (Thứ Hai) bắt đầu tuần 2 -> cộng dồn thêm 1 phiếu. Công thức cũ
  // ceil(ngày/7) chặn oan ở đây vì ngày 5 vẫn tính là tuần 1.
  const q1 = AttendanceService.buCongNgayQuotaOf([], 'EMP1', NOW_WEEK1);
  assert.equal(q1.weeksElapsed, 1);
  assert.equal(q1.availableNow, 1);

  const q2 = AttendanceService.buCongNgayQuotaOf([], 'EMP1', NOW_WEEK2_START);
  assert.equal(q2.weeksElapsed, 2);
  assert.equal(q2.monthLimit, 2);
  assert.equal(q2.availableNow, 2);
  assert.equal(q2.weekStart, '2026-10-05');
  assert.equal(q2.weekEnd, '2026-10-11');
});

test('tuần không dùng được cộng dồn trong tháng', () => {
  const q = AttendanceService.buCongNgayQuotaOf([], 'EMP1', NOW_WEEK3);
  assert.equal(q.weeksElapsed, 3);
  assert.equal(q.monthLimit, 3);
  assert.equal(q.availableNow, 3);
  assert.equal(q.weekStart, '2026-10-12');
  assert.equal(q.weekEnd, '2026-10-18');
});

test('tháng tối đa 4 phiếu dù tháng có 5 tuần', () => {
  const q = AttendanceService.buCongNgayQuotaOf([], 'EMP1', NOW_MONTH_END);
  assert.equal(q.weeksElapsed, 5);
  assert.equal(q.monthLimit, 4);
  assert.equal(q.availableNow, 4);
});

test('chỉ PENDING + APPROVED chiếm quota, REJECTED được trả lại', () => {
  const list = [
    adj('2026-10-05', 'APPROVED'),
    adj('2026-10-06', 'PENDING'),
    adj('2026-10-07', 'REJECTED'),
  ];
  const q = AttendanceService.buCongNgayQuotaOf(list, 'EMP1', NOW_WEEK3);
  assert.equal(q.monthUsed, 2);
  assert.equal(q.availableNow, 1);
  assert.equal(q.monthRemaining, 2);
});

test('dùng đủ quota tuần này thì bị chặn (availableNow = 0)', () => {
  const list = [adj('2026-10-13', 'PENDING')];
  const q = AttendanceService.buCongNgayQuotaOf(list, 'EMP1', NOW_WEEK3);
  assert.equal(q.weekUsed, 1);
  assert.equal(q.availableNow, 0);
});

test('đã dùng 1 tuần trước, tuần này vẫn còn 1 phiếu', () => {
  const list = [adj('2026-10-06', 'APPROVED')];
  const q = AttendanceService.buCongNgayQuotaOf(list, 'EMP1', NOW_WEEK3);
  assert.equal(q.monthUsed, 1);
  assert.equal(q.weekUsed, 0);
  assert.equal(q.availableNow, 2);
});

test('sang tháng mới KHÔNG cộng dồn phiếu tháng cũ', () => {
  // Tháng 10 đã dùng đủ 4 phiếu. Sang 10/11 (tuần thứ 2 của tháng 11) quota
  // phải tính lại từ 0: 4 phiếu tháng 10 không kéo sang, chỉ còn quota của
  // đúng 2 tuần lịch đã bắt đầu trong tháng 11.
  const list = [
    adj('2026-10-02', 'APPROVED'),
    adj('2026-10-06', 'APPROVED'),
    adj('2026-10-13', 'APPROVED'),
    adj('2026-10-20', 'APPROVED'),
  ];
  const q = AttendanceService.buCongNgayQuotaOf(list, 'EMP1', NOW_NEW_MONTH);
  assert.equal(q.month, '2026-11');
  assert.equal(q.monthUsed, 0);
  assert.equal(q.monthRemaining, 4);
  // 3 tuần lịch của tháng 11 đã bắt đầu: tuần chứa 1/11, tuần 2/11, tuần 9/11.
  assert.equal(q.weeksElapsed, 3);
  assert.equal(q.monthLimit, 3);
  assert.equal(q.availableNow, 3);
});

test('bỏ qua phiếu của nhân viên khác và loại phiếu khác', () => {
  const list: any[] = [
    adj('2026-10-13', 'PENDING'),
    { ...adj('2026-10-13', 'PENDING', 'X'), employee_id: 'EMP2' },
    { ...adj('2026-10-13', 'PENDING', 'Y'), reason: '[QUEN_CHECKIN] 2026-10-13: quên' },
  ];
  const q = AttendanceService.buCongNgayQuotaOf(list, 'EMP1', NOW_WEEK3);
  assert.equal(q.monthUsed, 1);
});

test('mondayOf / weekBoundsOf tính đúng tuần Thứ Hai–Chủ Nhật', () => {
  assert.equal(AttendanceService.mondayOf('2026-10-29'), '2026-10-26');
  assert.deepEqual(AttendanceService.weekBoundsOf('2026-10-29'), { start: '2026-10-26', end: '2026-11-01' });
  assert.equal(AttendanceService.mondayOf('2026-11-01'), '2026-10-26');
});
