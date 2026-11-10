import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { AttendanceService } from '../src/services/attendance.service.js';

const DATE = '2030-12-30';
const IMG_A = `data:image/jpeg;base64,${Buffer.from('anh-bang-chung-A').toString('base64')}`;
const IMG_A_OTHER_PREFIX = `data:image/png;base64,${Buffer.from('anh-bang-chung-A').toString('base64')}`;
const IMG_B = `data:image/jpeg;base64,${Buffer.from('anh-bang-chung-B').toString('base64')}`;

function shift(overrides: Record<string, any> = {}) {
  return {
    assignment_id: 'SHIFT_DEDUPE_1',
    employee_id: 'EMP_DEDUPE',
    branch_id: 'CN130',
    shift_code: 'CA_1',
    date: DATE,
    start_at: `${DATE}T07:00:00+07:00`,
    end_at: `${DATE}T12:00:00+07:00`,
    status: 'PUBLISHED',
    schedule_version: 1,
    ...overrides,
  } as any;
}

async function setup() {
  const repo = new MockSheetsAdapter();
  await repo.createEmployee({
    employee_id: 'EMP_DEDUPE',
    employee_code: 'UBM_DEDUPE01',
    full_name: 'Nhân Viên Chống Trùng',
    phone_normalized: '0900000188',
    employment_status: 'OFFICIAL',
    employment_type: 'OFFICIAL',
    default_branch_id: 'CN130',
    default_shift_code: 'CA_1',
    current_rate_per_hour: 30000,
  } as any);
  repo.shifts.push(shift());
  const svc = new AttendanceService(repo);
  return { repo, svc };
}

function request(svc: AttendanceService, reason: string, photoBase64: string, kind = 'QUEN_CHECKIN') {
  return svc.requestAdjustment({
    assignmentId: 'SHIFT_DEDUPE_1',
    employeeId: 'EMP_DEDUPE',
    branchId: 'CN130',
    incidentDate: DATE,
    reason: `[${kind}] ${DATE}: ${reason}`,
    minutesRequested: 0,
    photoBase64,
  });
}

test('chuẩn hóa ảnh: cùng nội dung ảnh khác tiền tố data URL -> cùng mã băm', () => {
  assert.equal(
    AttendanceService.adjustmentPhotoHash(IMG_A),
    AttendanceService.adjustmentPhotoHash(IMG_A_OTHER_PREFIX),
  );
  assert.notEqual(
    AttendanceService.adjustmentPhotoHash(IMG_A),
    AttendanceService.adjustmentPhotoHash(IMG_B),
  );
});

test('so trùng nội dung: khác ngày/khác dấu nhưng cùng ý nghĩa vẫn bị coi là tương tự', () => {
  assert.equal(
    AttendanceService.adjustmentReasonSimilar(
      '[QUEN_CHECKIN] 2026-11-09: Quên check-in đầu ca do mạng lỗi',
      '[QUEN_CHECKIN] 2026-11-10: quên check in đau ca do mang loi',
    ),
    true,
  );
  assert.equal(
    AttendanceService.adjustmentReasonSimilar(
      '[QUEN_CHECKIN] 2026-11-09: Quên check-in đầu ca',
      '[QUEN_CHECKOUT] 2026-11-09: Quên check-out cuối ca vì hết pin',
    ),
    false,
  );
});

test('tạo phiếu bù công: thiếu ảnh bằng chứng thì server chặn cứng', async () => {
  const { svc } = await setup();
  const oldHour = AttendanceService.vnHourNow;
  (AttendanceService as any).vnHourNow = () => 10;
  try {
    await assert.rejects(
      () => request(svc, 'Quên check-in đầu ca do mạng lỗi', ''),
      /ADJUSTMENT_PHOTO_REQUIRED/,
    );
  } finally {
    (AttendanceService as any).vnHourNow = oldHour;
  }
});

test('tạo phiếu bù công: gửi lại đúng ảnh đã dùng thì bị loại', async () => {
  const { svc } = await setup();
  const oldHour = AttendanceService.vnHourNow;
  (AttendanceService as any).vnHourNow = () => 10;
  try {
    await request(svc, 'Quên check-in đầu ca do mạng lỗi', IMG_A);
    await assert.rejects(
      () => request(svc, 'Quên check-out cuối ca vì hết pin điện thoại', IMG_A_OTHER_PREFIX, 'QUEN_CHECKOUT'),
      /ADJUSTMENT_DUPLICATE_PHOTO/,
    );
  } finally {
    (AttendanceService as any).vnHourNow = oldHour;
  }
});

test('tạo phiếu bù công: nội dung tương tự phiếu đã gửi thì bị loại', async () => {
  const { svc } = await setup();
  const oldHour = AttendanceService.vnHourNow;
  (AttendanceService as any).vnHourNow = () => 10;
  try {
    await request(svc, 'Quên check-in đầu ca do mạng lỗi', IMG_A);
    await assert.rejects(
      () => request(svc, 'quên check in dau ca do mang loi', IMG_B, 'QUEN_CHECKOUT'),
      /ADJUSTMENT_SIMILAR_CONTENT/,
    );
  } finally {
    (AttendanceService as any).vnHourNow = oldHour;
  }
});

test('tạo phiếu bù công: phiếu đã bị TỪ CHỐI không chặn NV gửi lại', async () => {
  const { repo, svc } = await setup();
  const oldHour = AttendanceService.vnHourNow;
  (AttendanceService as any).vnHourNow = () => 10;
  try {
    await repo.createAttendanceAdjustment({
      adjustment_id: `ADJ_${Date.now()}_777`,
      assignment_id: 'SHIFT_DEDUPE_1',
      employee_id: 'EMP_DEDUPE',
      branch_id: 'CN130',
      reason: `[QUEN_CHECKIN] ${DATE}: Quên check-in đầu ca do mạng lỗi`,
      minutes_requested: 0,
      status: 'REJECTED',
      photo_hash: AttendanceService.adjustmentPhotoHash(IMG_A),
    } as any);
    const queued: any = await request(svc, 'Quên check-in đầu ca do mạng lỗi', IMG_A);
    assert.ok((queued?.result || queued)?.adjustment_id);
  } finally {
    (AttendanceService as any).vnHourNow = oldHour;
  }
});

test('tạo phiếu bù công: nội dung và ảnh khác nhau thì gửi được bình thường', async () => {
  const { svc } = await setup();
  const oldHour = AttendanceService.vnHourNow;
  (AttendanceService as any).vnHourNow = () => 10;
  try {
    await request(svc, 'Quên check-in đầu ca do mạng lỗi', IMG_A);
    const queued: any = await request(svc, 'Quên check-out cuối ca vì hết pin điện thoại', IMG_B, 'QUEN_CHECKOUT');
    const ok: any = queued?.result || queued;
    assert.ok(ok.adjustment_id);
    assert.equal(ok.status, 'PENDING');
    assert.ok(ok.photo_hash);
  } finally {
    (AttendanceService as any).vnHourNow = oldHour;
  }
});
