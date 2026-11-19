import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { OfficeService } from '../src/services/office.service.js';

/**
 * Cổng Văn Phòng: phiếu BỔ SUNG CÔNG (quên check-in/check-out) khi HR duyệt
 * phải:
 *  - dựng lượt VÀO/RA còn thiếu vào sổ Văn Phòng (cổng NV thấy công ngay),
 *  - mirror sang sổ điểm danh chuẩn (Admin lưới/bảng công/lương thấy ngay),
 *  - xóa vi phạm: cờ trễ/sớm/phạt + bản ghi VẮNG của ca đúng ngày.
 */
const EMP = 'EMP_OFFICE_1';
const DAY = '2026-11-10'; // Thứ 3 (ngày làm việc 08:00–17:00)
const SHIFT = 'SHIFT_OFFICE_TEST_1';

async function seedEmployee(repo: MockSheetsAdapter) {
  await repo.createEmployee({
    employee_id: EMP,
    employee_code: 'UBM_OFFICE01',
    full_name: 'Nguyen Van Phong',
    phone_normalized: '0900000188',
    employment_status: 'OFFICIAL',
    group: 'VAN_PHONG',
    default_branch_id: 'VAN_PHONG',
    default_shift_code: 'CA_1',
    current_rate_per_hour: 0,
  } as any);
  repo.shifts.push({
    assignment_id: SHIFT,
    employee_id: EMP,
    branch_id: 'VAN_PHONG',
    shift_code: 'CA_1',
    date: DAY,
    start_at: `${DAY}T08:00:00+07:00`,
    end_at: `${DAY}T17:00:00+07:00`,
    status: 'PUBLISHED',
    schedule_version: 1,
  } as any);
}

async function seedAdjustment(repo: MockSheetsAdapter, id: string, status: 'PENDING' | 'APPROVED' = 'PENDING', minutes = 0) {
  await repo.updateSystemSettings({
    office_adjustments: [{
      adjustment_id: id,
      employee_id: EMP,
      employee_code: 'UBM_OFFICE01',
      full_name: 'Nguyen Van Phong',
      work_date: DAY,
      reason: 'Quên check-in do hỏng điện thoại',
      minutes_requested: minutes,
      status,
      created_at: new Date().toISOString(),
    }],
  });
}

test('duyệt phiếu quên CHECK-IN: dựng công + xóa trễ/phạt/ABSENT ngay', async () => {
  const repo = new MockSheetsAdapter();
  const svc = new OfficeService(repo);
  await seedEmployee(repo);
  await seedAdjustment(repo, 'VP_ADJ_TEST_IN');

  // NV chỉ kịp bấm RA CA (17:00); đồng thời có bản ghi vắng oan + lượt OUT bị
  // gắn cờ trễ/phạt từ dữ liệu cũ.
  await repo.updateSystemSettings({
    office_attendance_events: [{
      event_id: 'VP_ATT_OUT',
      employee_id: EMP,
      date: DAY,
      type: 'CHECK_OUT',
      at: `${DAY}T17:00:00+07:00`,
      accuracy: 0,
      distance_meters: 0,
      gps_status: 'VALID',
    }],
  });
  await repo.recordAttendanceEvent({
    event_id: 'EVT_STD_OUT',
    request_id: 'REQ_STD_OUT',
    assignment_id: SHIFT,
    employee_id: EMP,
    branch_id: 'VAN_PHONG',
    type: 'CHECK_OUT',
    client_time: `${DAY}T17:00:00+07:00`,
    server_received_at: new Date().toISOString(),
    gps_status: 'VALID',
    is_late: true,
    minutes_deviation: 120,
    fine_tier: 'FULL_SHIFT',
    fine_amount: 100000,
  } as any);
  await repo.recordAttendanceEvent({
    event_id: 'EVT_STD_ABSENT',
    request_id: `ABSENT_${SHIFT}`,
    assignment_id: SHIFT,
    employee_id: EMP,
    branch_id: 'VAN_PHONG',
    type: 'ABSENT',
    client_time: `${DAY}T17:00:00+07:00`,
    server_received_at: new Date().toISOString(),
    gps_status: 'UNAVAILABLE',
  } as any);

  const approved: any = await svc.reviewAdjustment('VP_ADJ_TEST_IN', { id: 'HR1', role: 'HR' }, 'APPROVE', 'ok');
  assert.equal(approved.status, 'APPROVED');
  assert.deepEqual(approved._applied.created_office, ['CHECK_IN']);
  assert.deepEqual(approved._applied.created_standard, ['CHECK_IN']);
  assert.equal(approved._applied.cleared, 1);
  assert.equal(approved._applied.absent_removed, 1);

  const settings: any = await repo.getSystemSettings();
  const office = (settings.office_attendance_events || []).filter((e: any) => e.employee_id === EMP && e.date === DAY);
  const officeIn: any = office.find((e: any) => e.type === 'CHECK_IN');
  const officeOut: any = office.find((e: any) => e.type === 'CHECK_OUT');
  assert.equal(officeIn.at, `${DAY}T01:00:00.000Z`); // 08:00 VN
  assert.equal(officeIn.synthetic, true);
  assert.equal(Date.parse(officeOut.at), Date.parse(`${DAY}T17:00:00+07:00`)); // giữ giờ thật

  const std = await repo.getAttendanceEvents(EMP, DAY);
  assert.equal(std.some((e: any) => e.type === 'ABSENT'), false, 'phải dọn bản ghi vắng');
  const stdIn: any = std.find((e: any) => e.type === 'CHECK_IN');
  const stdOut: any = std.find((e: any) => e.type === 'CHECK_OUT');
  assert.ok(stdIn, 'phải dựng chân CHECK_IN trên sổ chuẩn');
  assert.equal(stdIn.assignment_id, SHIFT);
  assert.equal(stdOut.is_late, false);
  assert.equal(stdOut.minutes_deviation, 0);
  assert.equal(stdOut.fine_tier, 'NONE');
  assert.equal(stdOut.fine_amount, 0);

  // Cổng NV đọc sổ Văn Phòng -> đã có đủ cặp, công 9 giờ.
  const ts: any = await svc.getTimesheet(EMP, '2026-11');
  assert.equal(ts.work_days, 1);
  assert.equal(ts.total_hours, 9);
});

test('duyệt phiếu quên CHECK-OUT + phút bổ sung: dựng RA CA đúng 17:00 + phút', async () => {
  const repo = new MockSheetsAdapter();
  const svc = new OfficeService(repo);
  await seedEmployee(repo);
  await seedAdjustment(repo, 'VP_ADJ_TEST_OUT', 'PENDING', 60);
  await repo.updateSystemSettings({
    office_attendance_events: [{
      event_id: 'VP_ATT_IN',
      employee_id: EMP,
      date: DAY,
      type: 'CHECK_IN',
      at: `${DAY}T08:00:00+07:00`,
      accuracy: 0,
      distance_meters: 0,
      gps_status: 'VALID',
    }],
  });

  const approved: any = await svc.reviewAdjustment('VP_ADJ_TEST_OUT', { id: 'HR1', role: 'HR' }, 'APPROVE');
  assert.deepEqual(approved._applied.created_office, ['CHECK_OUT']);
  // Sổ chuẩn còn thiếu cả 2 chân -> mirror cả cặp (IN có sẵn từ sổ VP).
  assert.deepEqual(approved._applied.created_standard, ['CHECK_IN', 'CHECK_OUT']);

  const settings: any = await repo.getSystemSettings();
  const out: any = (settings.office_attendance_events || [])
    .find((e: any) => e.employee_id === EMP && e.date === DAY && e.type === 'CHECK_OUT');
  assert.equal(out.at, `${DAY}T11:00:00.000Z`); // 18:00 VN (9h chuẩn + 60 phút)
  assert.equal(out.synthetic, true);

  const stdOut: any = (await repo.getAttendanceEvents(EMP, DAY)).find((e: any) => e.type === 'CHECK_OUT');
  assert.ok(stdOut, 'Admin phải thấy chân RA CA ngay');
  const ts: any = await svc.getTimesheet(EMP, '2026-11');
  assert.equal(ts.total_hours, 10);
});

test('quên CHECK-IN + 60 phút bổ sung: vào ca 07:00 (đúng phần HR duyệt), không kẹp oan 08:00', async () => {
  const repo = new MockSheetsAdapter();
  const svc = new OfficeService(repo);
  await seedEmployee(repo);
  await seedAdjustment(repo, 'VP_ADJ_TEST_IN_EARLY', 'PENDING', 60);
  await repo.updateSystemSettings({
    office_attendance_events: [{
      event_id: 'VP_ATT_OUT_EARLY',
      employee_id: EMP,
      date: DAY,
      type: 'CHECK_OUT',
      at: `${DAY}T17:00:00+07:00`,
      accuracy: 0,
      distance_meters: 0,
      gps_status: 'VALID',
    }],
  });

  const approved: any = await svc.reviewAdjustment('VP_ADJ_TEST_IN_EARLY', { id: 'HR1', role: 'HR' }, 'APPROVE');
  assert.deepEqual(approved._applied.created_office, ['CHECK_IN']);
  const settings: any = await repo.getSystemSettings();
  const inn: any = (settings.office_attendance_events || [])
    .find((e: any) => e.employee_id === EMP && e.date === DAY && e.type === 'CHECK_IN');
  assert.equal(inn.at, `${DAY}T00:00:00.000Z`); // 07:00 VN = 9h chuẩn + 60 phút
  const ts: any = await svc.getTimesheet(EMP, '2026-11');
  assert.equal(ts.total_hours, 10);
});

test('tuần đã archive: không dựng trùng chân đã có trong kho, chỉ dọn phạt/VẮNG', async () => {
  const repo = new MockSheetsAdapter();
  const svc = new OfficeService(repo);
  await seedEmployee(repo);
  await seedAdjustment(repo, 'VP_ADJ_ARCHIVED');
  const fineIds: string[] = [];
  const deletedIds: string[] = [];
  (repo as any).syncService = {
    getArchivedAttendanceEvents: async () => ([
      {
        event_id: 'ARCH_IN', assignment_id: SHIFT, employee_id: EMP, type: 'CHECK_IN',
        client_time: `${DAY}T08:20:00+07:00`, is_late: true, minutes_deviation: 20, fine_tier: 'FULL_SHIFT', fine_amount: 100000,
      },
      {
        event_id: 'ARCH_OUT', assignment_id: SHIFT, employee_id: EMP, type: 'CHECK_OUT',
        client_time: `${DAY}T17:00:00+07:00`, is_late: false, minutes_deviation: 0, fine_tier: 'NONE', fine_amount: 0,
      },
      { event_id: 'ARCH_ABSENT', assignment_id: SHIFT, employee_id: EMP, type: 'ABSENT', client_time: `${DAY}T17:00:00+07:00` },
    ]),
    clearArchivedEventFines: async (ids: string[]) => { fineIds.push(...ids); return ids.length; },
    deleteArchivedAttendanceEvent: async (id: string) => { deletedIds.push(id); return { employee_id: EMP, client_time: `${DAY}T17:00:00+07:00`, type: 'ABSENT' }; },
  };

  const approved: any = await svc.reviewAdjustment('VP_ADJ_ARCHIVED', { id: 'HR1', role: 'HR' }, 'APPROVE');
  assert.deepEqual(approved._applied.created_standard, [], 'kho đã có đủ IN/OUT -> không dựng trùng');
  assert.equal(approved._applied.archived_cleared, 1);
  assert.equal(approved._applied.archived_absent_removed, 1);
  assert.deepEqual(fineIds, ['ARCH_IN']);
  assert.deepEqual(deletedIds, ['ARCH_ABSENT']);
  assert.equal((await repo.getAttendanceEvents(EMP, DAY)).length, 0, 'không sinh lượt live cho ngày đã lưu trữ');
});

test('phiếu bị TỪ CHỐI: không dựng công, không xóa vi phạm', async () => {
  const repo = new MockSheetsAdapter();
  const svc = new OfficeService(repo);
  await seedEmployee(repo);
  await seedAdjustment(repo, 'VP_ADJ_TEST_REJECT');
  await repo.recordAttendanceEvent({
    event_id: 'EVT_STD_IN_LATE',
    request_id: 'REQ_STD_IN_LATE',
    assignment_id: SHIFT,
    employee_id: EMP,
    branch_id: 'VAN_PHONG',
    type: 'CHECK_IN',
    client_time: `${DAY}T08:20:00+07:00`,
    server_received_at: new Date().toISOString(),
    gps_status: 'VALID',
    is_late: true,
    minutes_deviation: 20,
    fine_tier: 'FULL_SHIFT',
    fine_amount: 100000,
  } as any);

  await svc.reviewAdjustment('VP_ADJ_TEST_REJECT', { id: 'HR1', role: 'HR' }, 'REJECT', 'không hợp lệ');
  const settings: any = await repo.getSystemSettings();
  assert.equal((settings.office_attendance_events || []).length, 0);
  const stdIn: any = (await repo.getAttendanceEvents(EMP, DAY)).find((e: any) => e.type === 'CHECK_IN');
  assert.equal(stdIn.is_late, true);
  assert.equal(stdIn.fine_tier, 'FULL_SHIFT');
});

test('rà soát tháng 11: tự áp lại mọi phiếu ĐÃ DUYỆT tồn đọng (idempotent)', async () => {
  const repo = new MockSheetsAdapter();
  const svc = new OfficeService(repo);
  await seedEmployee(repo);
  await seedAdjustment(repo, 'VP_ADJ_NOV_OLD', 'APPROVED');

  const first = await svc.repairApprovedAdjustments('2026-11');
  assert.equal(first.checked, 1);
  assert.equal(first.applied, 1);
  assert.equal(first.created_office, 2);
  assert.equal(first.created_standard, 2);

  const ts: any = await svc.getTimesheet(EMP, '2026-11');
  assert.equal(ts.work_days, 1);
  assert.equal(ts.total_hours, 9);

  // Chạy lại không nhân đôi lượt/công.
  const second = await svc.repairApprovedAdjustments('2026-11');
  assert.equal(second.created_office, 0);
  assert.equal(second.created_standard, 0);
  const settings: any = await repo.getSystemSettings();
  const office = (settings.office_attendance_events || []).filter((e: any) => e.employee_id === EMP && e.date === DAY);
  assert.equal(office.length, 2);
  const ts2: any = await svc.getTimesheet(EMP, '2026-11');
  assert.equal(ts2.total_hours, 9);
});

test('NV bấm lại RA CA sau khi phiếu đã dựng hộ: thay giờ thật, không chặn oan', async () => {
  const repo = new MockSheetsAdapter();
  const svc = new OfficeService(repo);
  await seedEmployee(repo);
  await seedAdjustment(repo, 'VP_ADJ_TEST_REPLACE');

  // Phiếu dựng hộ cả cặp cho HÔM NAY.
  const day = OfficeService.vnNow().date;
  repo.shifts.push({
    assignment_id: 'SHIFT_OFFICE_TODAY',
    employee_id: EMP,
    branch_id: 'VAN_PHONG',
    shift_code: 'CA_1',
    date: day,
    start_at: `${day}T08:00:00+07:00`,
    end_at: `${day}T17:00:00+07:00`,
    status: 'PUBLISHED',
    schedule_version: 1,
  } as any);
  await repo.updateSystemSettings({
    office_adjustments: [{
      adjustment_id: 'VP_ADJ_TEST_REPLACE',
      employee_id: EMP,
      employee_code: 'UBM_OFFICE01',
      full_name: 'Nguyen Van Phong',
      work_date: day,
      reason: 'Quên check-in/out',
      minutes_requested: 0,
      status: 'PENDING',
      created_at: new Date().toISOString(),
    }],
  });
  await svc.reviewAdjustment('VP_ADJ_TEST_REPLACE', { id: 'HR1', role: 'HR' }, 'APPROVE');

  // Giả lập NV bấm RA CA thật sau đó.
  const realAt = new Date(`${day}T18:30:00+07:00`).toISOString();
  const origVnNow = (OfficeService as any).vnNow;
  (OfficeService as any).vnNow = () => ({ ...origVnNow(), date: day, iso: realAt, nowMs: Date.parse(realAt), minutesOfDay: 18 * 60 + 30 });
  try {
    const evt: any = await svc.checkOut(EMP, { latitude: 10.80304, longitude: 106.68962, accuracy: 5 });
    assert.equal(evt.at, realAt);
  } finally {
    (OfficeService as any).vnNow = origVnNow;
  }

  const settings: any = await repo.getSystemSettings();
  const outs = (settings.office_attendance_events || [])
    .filter((e: any) => e.employee_id === EMP && e.date === day && e.type === 'CHECK_OUT');
  assert.equal(outs.length, 1, 'chỉ còn 1 chân RA CA (giờ thật)');
  assert.equal(outs[0].synthetic, undefined);
  assert.equal(outs[0].at, realAt);

  const stdOut: any = (await repo.getAttendanceEvents(EMP, day)).find((e: any) => e.type === 'CHECK_OUT');
  assert.equal(Date.parse(stdOut.client_time), Date.parse(realAt), 'sổ chuẩn cũng cập nhật giờ thật');
});
