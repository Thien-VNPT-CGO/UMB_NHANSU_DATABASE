import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { SchedulesService } from '../src/services/schedules.service.js';
import { singleWriterQueue } from '../src/repositories/single-writer-queue.js';
import { currentVnWeekRange, weekRangeOf } from '../src/services/weekly-off.service.js';

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function shift(overrides: Record<string, any>) {
  return {
    assignment_id: 'SHIFT_1',
    employee_id: 'EMP_1',
    branch_id: 'CN130',
    shift_code: 'CA_1',
    date: '2026-10-20',
    start_at: '2026-10-20T07:00:00+07:00',
    end_at: '2026-10-20T12:00:00+07:00',
    status: 'PUBLISHED',
    schedule_version: 1,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  } as any;
}

test('self-heal: ca DRAFT trong tuần đã publish -> PUBLISHED (đúng chi nhánh chuẩn, bỏ qua khóa/tuần khác/hủy)', async () => {
  const repo = new MockSheetsAdapter();
  const mon = weekRangeOf('2031-05-05').mon;
  const tue = addDays(mon, 1);
  const nextMon = addDays(mon, 7);
  repo.shifts.push(
    // Tuần đã phát hành (CN1 ↔ CN130 là cùng chi nhánh chuẩn).
    shift({ assignment_id: 'PUB_ANCHOR', branch_id: 'CN1', employee_id: 'EMP_A', date: mon }),
    // DRAFT lọt vào tuần đã publish → phải được chốt.
    shift({ assignment_id: 'DRAFT_SAME_WEEK', branch_id: 'CN130', employee_id: 'EMP_B', shift_code: 'CA_2', date: tue, status: 'DRAFT' }),
    shift({ assignment_id: 'DRAFT_OLD_CODE', branch_id: 'CN1', employee_id: 'EMP_C', shift_code: 'CA_3', date: tue, status: 'DRAFT' }),
    // Chi nhánh khác cùng tuần → không đụng (tuần của họ chưa publish).
    shift({ assignment_id: 'DRAFT_OTHER_BRANCH', branch_id: 'CN2', employee_id: 'EMP_D', shift_code: 'CA_2', date: tue, status: 'DRAFT' }),
    // Tuần sau của cùng chi nhánh chưa publish → giữ DRAFT.
    shift({ assignment_id: 'DRAFT_NEXT_WEEK', branch_id: 'CN130', employee_id: 'EMP_E', shift_code: 'CA_2', date: nextMon, status: 'DRAFT' }),
    // Đã hủy → không bao giờ hồi sinh.
    shift({ assignment_id: 'CANCELLED_SAME_WEEK', branch_id: 'CN130', employee_id: 'EMP_F', shift_code: 'CA_3', date: tue, status: 'CANCELLED' }),
    // Tài khoản bị khóa → giữ nháp theo quy định.
    shift({ assignment_id: 'DRAFT_LOCKED', branch_id: 'CN130', employee_id: 'EMP_LOCKED', shift_code: 'CA_3', date: tue, status: 'DRAFT' })
  );
  (repo as any).accounts.push({
    account_id: 'ACC_LOCKED',
    employee_id: 'EMP_LOCKED',
    phone_normalized: '0999999999',
    account_status: 'LOCKED',
  } as any);

  const svc = new SchedulesService(repo);
  const out = await svc.healDraftsInPublishedWeeksNow({ weekStart: mon });

  assert.equal(out.healed, 2, 'chỉ chốt 2 ca nháp thuộc tuần đã publish của cùng chi nhánh');
  const byId = new Map(repo.shifts.map(s => [s.assignment_id, s]));
  assert.equal(byId.get('DRAFT_SAME_WEEK')!.status, 'PUBLISHED');
  assert.equal(byId.get('DRAFT_OLD_CODE')!.status, 'PUBLISHED');
  assert.ok(byId.get('DRAFT_SAME_WEEK')!.schedule_version > 1, 'phải tăng version để pull Sheet không ghi đè ngược');
  assert.equal(byId.get('DRAFT_OTHER_BRANCH')!.status, 'DRAFT');
  assert.equal(byId.get('DRAFT_NEXT_WEEK')!.status, 'DRAFT');
  assert.equal(byId.get('CANCELLED_SAME_WEEK')!.status, 'CANCELLED');
  assert.equal(byId.get('DRAFT_LOCKED')!.status, 'DRAFT', 'tài khoản LOCKED giữ nguyên ca nháp');

  // Chạy lại không còn gì để chốt (idempotent).
  const again = await svc.healDraftsInPublishedWeeksNow({ weekStart: mon });
  assert.equal(again.healed, 0);
});

test('tạo ca trong tuần ĐÃ publish vào thẳng PUBLISHED, tuần chưa publish vẫn DRAFT', async () => {
  const repo = new MockSheetsAdapter();
  const mon = weekRangeOf('2031-06-02').mon;
  const tue = addDays(mon, 1);
  const farMon = addDays(mon, 14);
  repo.shifts.push(
    shift({ assignment_id: 'PUB_ANCHOR', branch_id: 'CN1', employee_id: 'EMP_A', date: mon }),
    // Ca nháp cũ của NV khác trong cùng tuần đã publish → tạo ca mới phải dọn luôn.
    shift({ assignment_id: 'STALE_DRAFT', branch_id: 'CN130', employee_id: 'EMP_STALE', shift_code: 'CA_2', date: addDays(mon, 2), status: 'DRAFT' })
  );
  repo.employees.push({
    employee_id: 'EMP_NEW',
    employee_code: 'UBM_T001',
    full_name: 'Nhân Viên Mới',
    phone_normalized: '0900000011',
    employment_status: 'OFFICIAL',
    default_branch_id: 'CN130',
    default_shift_code: 'CA_1',
  } as any);

  const svc = new SchedulesService(repo);
  const createdPublished = await svc.createShift({
    employeeId: 'EMP_NEW',
    branchId: 'CN130',
    shiftCode: 'CA_1',
    date: tue,
    actorId: 'ADMIN_TEST',
  });
  assert.equal((createdPublished as any).result.status, 'PUBLISHED', 'tuần đã publish thì ca mới phải PUBLISHED ngay');
  assert.equal(
    repo.shifts.find(s => s.assignment_id === 'STALE_DRAFT')!.status,
    'PUBLISHED',
    'ca nháp cũ cùng tuần đã publish phải được chốt theo'
  );

  const createdDraft = await svc.createShift({
    employeeId: 'EMP_NEW',
    branchId: 'CN130',
    shiftCode: 'CA_1',
    date: farMon,
    actorId: 'ADMIN_TEST',
  });
  assert.equal((createdDraft as any).result.status, 'DRAFT', 'tuần chưa publish vẫn là ca nháp');
});

test('B đồng ý tráo ca: 2 ca hoán chủ + tự duyệt APPROVED + giữ PUBLISHED (không rơi về chờ duyệt)', async () => {
  const repo = new MockSheetsAdapter();
  const wk = currentVnWeekRange();
  const dayA = wk.mon;
  const dayB = addDays(wk.mon, 1);
  for (const [id, phone] of [['EMP_SWAP_A', '0900000021'], ['EMP_SWAP_B', '0900000022']]) {
    repo.employees.push({
      employee_id: id,
      employee_code: `UBM_${id.slice(-1)}`,
      full_name: `Nhân Viên ${id.slice(-1)}`,
      phone_normalized: phone,
      employment_status: 'OFFICIAL',
      default_branch_id: 'CN130',
      default_shift_code: 'CA_1',
    } as any);
  }
  repo.shifts.push(
    shift({
      assignment_id: 'SHIFT_A', employee_id: 'EMP_SWAP_A', branch_id: 'CN130',
      shift_code: 'CA_1', date: dayA,
      start_at: `${dayA}T07:00:00+07:00`, end_at: `${dayA}T12:00:00+07:00`,
    }),
    shift({
      assignment_id: 'SHIFT_B', employee_id: 'EMP_SWAP_B', branch_id: 'CN130',
      shift_code: 'CA_2', date: dayB,
      start_at: `${dayB}T12:00:00+07:00`, end_at: `${dayB}T18:00:00+07:00`,
    })
  );
  await repo.createSwapRequest({
    swap_id: 'SWAP_TEST_1',
    swap_kind: 'EMPLOYEE_SWAP',
    requester_id: 'EMP_SWAP_A',
    requester_assignment_id: 'SHIFT_A',
    target_employee_id: 'EMP_SWAP_B',
    target_assignment_id: 'SHIFT_B',
    reason: 'Test tráo ca',
    status: 'PENDING_PARTNER',
    bonus_amount: 0,
  } as any);

  singleWriterQueue.setRepository(repo as any);
  const svc = new SchedulesService(repo);
  const result: any = await svc.respondSwapPartner('SWAP_TEST_1', 'EMP_SWAP_B', true);
  const swap = (result as any)?.result ?? result;
  assert.equal(swap.status, 'APPROVED', 'B đồng ý là hệ thống tự duyệt, không cần HR');

  const a = repo.shifts.find(s => s.assignment_id === 'SHIFT_A')!;
  const b = repo.shifts.find(s => s.assignment_id === 'SHIFT_B')!;
  assert.equal(a.employee_id, 'EMP_SWAP_B');
  assert.equal(b.employee_id, 'EMP_SWAP_A');
  assert.equal(a.status, 'PUBLISHED', 'ca A sau khi chuyển chủ không được rơi về DRAFT');
  assert.equal(b.status, 'PUBLISHED', 'ca B sau khi chuyển chủ không được rơi về DRAFT');
});
