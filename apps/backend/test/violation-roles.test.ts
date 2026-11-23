import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { hashPassword } from '../src/services/password.service.js';
import {
  approveViolationTicket,
  changeViolationPin,
  createViolationTicket,
  deleteViolationTicket,
  ensureViolationAccounts,
  listViolationRegulations,
  loginViolationPortal,
  updateViolationTicket,
  VIOLATION_ADMIN_ACCOUNT_ID,
  VIOLATION_STAFF_PIN,
} from '../src/services/violation.service.js';

const ADMIN_PIN = '12345678';

async function makeRepo(): Promise<MockSheetsAdapter> {
  const repo = new MockSheetsAdapter();
  (repo as any).employees = [
    {
      employee_id: 'EMP1',
      employee_code: 'NV001',
      full_name: 'Nguyễn Văn A',
      default_branch_id: 'BR1',
      employment_status: 'ACTIVE',
    },
  ];
  repo.getBranches = async () => [{ id: 'BR1', name: 'Chi nhánh 1' }] as any;
  return repo;
}

test('khởi tạo đủ 2 tài khoản ADMIN + CREATOR, PIN 68686868 vào đúng nhân viên', async () => {
  const repo = await makeRepo();
  const accounts = await ensureViolationAccounts(repo);
  assert.equal(accounts.length, 2);
  assert.deepEqual(accounts.map(a => a.role).sort(), ['ADMIN', 'CREATOR']);

  const staff = await loginViolationPortal(repo, VIOLATION_STAFF_PIN);
  assert.equal(staff.account.role, 'CREATOR');
  assert.equal(staff.account.account_id, 'VIOLATION_STAFF');
  assert.equal(staff.mustChangePin, false);
  assert.ok(
    staff.account.capabilities.some(c => c.code === 'VIOLATION_CREATE'),
    'nhân viên phải được phép lập phiếu',
  );
  assert.ok(
    !staff.account.capabilities.some(c => c.code === 'VIOLATION_APPROVE'),
    'nhân viên không được có quyền duyệt',
  );
  assert.ok(
    !staff.account.capabilities.some(c => c.code === 'VIOLATION_ADJUST_FINE'),
    'nhân viên không được có quyền sửa mức phạt',
  );

  const admin = await loginViolationPortal(repo, ADMIN_PIN);
  assert.equal(admin.account.role, 'ADMIN');
});

test('nhân viên tạo phiếu: luôn PENDING và mức phạt bị ghi đè theo quy chế', async () => {
  const repo = await makeRepo();
  await ensureViolationAccounts(repo);
  const regulations = await listViolationRegulations(repo);
  const regulation = regulations.find(item => item.fine_amount > 0)!;
  assert.ok(regulation);

  const ticket = await createViolationTicket(
    repo,
    {
      employee_id: 'EMP1',
      violation_date: '2026-11-20',
      status: 'APPROVED',
      items: [{ regulation_id: regulation.regulation_id, fine_amount: 999_999, name: 'Tự đặt tên' }],
    },
    { id: 'VIOLATION_STAFF', name: 'Nhân viên lập phiếu', role: 'CREATOR' },
  );

  assert.equal(ticket.status, 'PENDING', 'nhân viên không được duyệt ngay');
  assert.equal(ticket.items[0].fine_amount, regulation.fine_amount);
  assert.equal(ticket.items[0].name, regulation.name);
  assert.equal(ticket.total_amount, regulation.fine_amount);
  assert.equal(ticket.created_by, 'VIOLATION_STAFF');
});

test('nhân viên bị chặn duyệt / sửa tiền / xóa phiếu', async () => {
  const repo = await makeRepo();
  await ensureViolationAccounts(repo);
  const regulations = await listViolationRegulations(repo);
  const regulation = regulations.find(item => item.fine_amount > 0)!;
  const creator = { id: 'VIOLATION_STAFF', name: 'Nhân viên lập phiếu', role: 'CREATOR' as const };

  const ticket = await createViolationTicket(
    repo,
    {
      employee_id: 'EMP1',
      violation_date: '2026-11-20',
      items: [{ regulation_id: regulation.regulation_id }],
    },
    creator,
  );

  await assert.rejects(
    () => approveViolationTicket(repo, ticket.ticket_id, creator),
    /FORBIDDEN/,
  );
  await assert.rejects(
    () =>
      updateViolationTicket(
        repo,
        ticket.ticket_id,
        { items: [{ regulation_id: regulation.regulation_id, fine_amount: 1 }] },
        creator,
      ),
    /FORBIDDEN/,
  );
  await assert.rejects(() => deleteViolationTicket(repo, ticket.ticket_id, creator), /FORBIDDEN/);

  // Admin vẫn sửa được mức phạt của phiếu đang chờ duyệt.
  const admin = { id: VIOLATION_ADMIN_ACCOUNT_ID, name: 'Quản trị', role: 'ADMIN' as const };
  const nextFine = Math.max(0, regulation.fine_amount - 10_000);
  const updated = await updateViolationTicket(
    repo,
    ticket.ticket_id,
    { items: [{ regulation_id: regulation.regulation_id, fine_amount: nextFine }] },
    admin,
  );
  assert.ok(updated);
  assert.equal(updated!.items[0].fine_amount, nextFine);
  assert.equal(updated!.total_amount, nextFine);
  assert.equal(updated!.original_total_amount, regulation.fine_amount);
});

test('không cho đổi PIN trùng giữa 2 tài khoản', async () => {
  const repo = await makeRepo();
  await ensureViolationAccounts(repo);
  await assert.rejects(
    () => changeViolationPin(repo, VIOLATION_ADMIN_ACCOUNT_ID, ADMIN_PIN, VIOLATION_STAFF_PIN),
    /PIN_IN_USE/,
  );
});

test('nâng cấp tài khoản đơn cũ: ADMIN giữ PIN, nhân viên nhận 68686868', async () => {
  const repo = await makeRepo();
  const now = new Date().toISOString();
  await repo.updateSystemSettings({
    violationPortalAccount: {
      account_id: 'VIOLATION_PORTAL',
      display_name: 'Tòa Án Tối Cao Ụm Bò Milk',
      system_name: 'HỆ THỐNG KIỂM SOÁT & XỬ LÝ VI PHẠM',
      pin_hash: await hashPassword('13572468'),
      pin_version: 3,
      must_change_pin: false,
      created_at: now,
      updated_at: now,
    },
  });

  await ensureViolationAccounts(repo);
  const admin = await loginViolationPortal(repo, '13572468');
  assert.equal(admin.account.role, 'ADMIN');
  assert.equal(admin.account.account_id, VIOLATION_ADMIN_ACCOUNT_ID);

  const staff = await loginViolationPortal(repo, VIOLATION_STAFF_PIN);
  assert.equal(staff.account.role, 'CREATOR');
});

test('tài khoản ADMIN từng bị cấp lại về 68686868 không chiếm PIN của nhân viên', async () => {
  const repo = await makeRepo();
  const now = new Date().toISOString();
  await repo.updateSystemSettings({
    violationPortalAccount: {
      account_id: 'VIOLATION_PORTAL',
      pin_hash: await hashPassword(VIOLATION_STAFF_PIN),
      pin_version: 2,
      must_change_pin: true,
      created_at: now,
      updated_at: now,
    },
  });

  await ensureViolationAccounts(repo);
  const staff = await loginViolationPortal(repo, VIOLATION_STAFF_PIN);
  assert.equal(staff.account.role, 'CREATOR', '68686868 phải vào tài khoản nhân viên');

  const admin = await loginViolationPortal(repo, ADMIN_PIN);
  assert.equal(admin.account.role, 'ADMIN', 'ADMIN được đưa về PIN mặc định 12345678');
  assert.equal(admin.mustChangePin, true);
});
