import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { EmployeesService } from '../src/services/employees.service.js';

async function makeEmp(repo: MockSheetsAdapter, over: any = {}) {
  return repo.createEmployee({
    employee_id: 'EMP_BL_TEST',
    employee_code: 'UBM_NV9001',
    full_name: 'NV Thử Việc',
    phone_normalized: '0901234567',
    employment_status: 'PROBATION',
    group: 'STORE',
    default_branch_id: 'CN130',
    current_rate_per_hour: 21000,
    start_date: '2026-11-01',
    ...over,
  } as any);
}

test('blacklistEmployee: giữ PROBATION (phiếu lương vẫn tính), khóa đăng nhập + lưu lý do', async () => {
  const repo = new MockSheetsAdapter();
  const svc = new EmployeesService(repo as any);
  const emp = await makeEmp(repo);

  const res: any = await svc.blacklistEmployee(emp.employee_id, { reason: 'Nghỉ giữa kỳ', note: 'Nghỉ sau 5 ngày' }, 'ADMIN_TEST');
  assert.equal(typeof res.shiftsCancelled, 'number');

  const after: any = await repo.getEmployeeById(emp.employee_id);
  // Cực kỳ quan trọng: KHÔNG đổi TERMINATED — bảng lương chỉ loại TERMINATED.
  assert.equal(after.employment_status, 'PROBATION');
  assert.equal(after.blacklisted, true);
  assert.equal(after.blacklist.reason, 'Nghỉ giữa kỳ');
  assert.equal(after.blacklist.note, 'Nghỉ sau 5 ngày');
  assert.equal(after.blacklist.blacklisted_by, 'ADMIN_TEST');
  assert.equal(after.account_locked, true);
  assert.equal(after.account_status, 'LOCKED');

  // Tài khoản đăng nhập bị khóa + xóa PIN.
  const accounts: any[] = await repo.listAccounts();
  const mine = accounts.filter(a => a.employee_id === emp.employee_id);
  assert.ok(mine.length > 0, 'phải có tài khoản để khóa');
  for (const a of mine) {
    assert.equal(a.account_status, 'LOCKED');
    assert.equal(a.pin_hash || '', '');
    assert.equal(a.pin_code || '', '');
  }

  // Không thể đưa vào danh sách đen 2 lần.
  await assert.rejects(
    () => svc.blacklistEmployee(emp.employee_id, { reason: 'lần 2' }, 'ADMIN_TEST'),
    /ALREADY_BLACKLISTED/
  );
});

test('blacklistEmployee chỉ áp dụng cho NV THỬ VIỆC', async () => {
  const repo = new MockSheetsAdapter();
  const svc = new EmployeesService(repo as any);
  const emp = await makeEmp(repo, { employee_id: 'EMP_OFFICIAL', employee_code: 'UBM_NV9002', employment_status: 'OFFICIAL' });
  await assert.rejects(
    () => svc.blacklistEmployee(emp.employee_id, { reason: 'x' }, 'ADMIN_TEST'),
    /BLACKLIST_PROBATION_ONLY/
  );
  const after: any = await repo.getEmployeeById(emp.employee_id);
  assert.notEqual(after.blacklisted, true);
});

test('unblacklistEmployee: gỡ cờ + mở khóa + cấp PIN mới 6 số', async () => {
  const repo = new MockSheetsAdapter();
  const svc = new EmployeesService(repo as any);
  const emp = await makeEmp(repo);
  await svc.blacklistEmployee(emp.employee_id, { reason: 'Nghỉ giữa kỳ' }, 'ADMIN_TEST');

  const res: any = await svc.unblacklistEmployee(emp.employee_id, 'ADMIN_TEST');
  assert.equal(String(res.pin || '').length, 6);

  const after: any = await repo.getEmployeeById(emp.employee_id);
  assert.equal(after.blacklisted, false);
  assert.equal(after.blacklist, null);
  assert.equal(after.account_locked, false);
  assert.equal(after.account_status, 'ACTIVE');

  const accounts: any[] = await repo.listAccounts();
  for (const a of accounts.filter(x => x.employee_id === emp.employee_id)) {
    assert.equal(a.account_status, 'ACTIVE');
    assert.ok(a.pin_hash, 'phải có PIN hash mới');
  }

  // Bỏ đen lần nữa -> báo đúng lỗi nghiệp vụ.
  await assert.rejects(() => svc.unblacklistEmployee(emp.employee_id, 'ADMIN_TEST'), /NOT_BLACKLISTED/);
});
