import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import {
  approveInternalRequest,
  createInternalRequest,
  forwardInternalRequest,
  listInternalRequests,
  markInternalRequestDone,
  rejectInternalRequest,
  roleToDepartment,
} from '../src/services/internal-workflow.service.js';
import {
  deleteCompanyPolicy,
  listCompanyPolicies,
  upsertCompanyPolicy,
} from '../src/services/company-policy.service.js';

test('roleToDepartment ánh xạ đúng phòng ban', () => {
  assert.equal(roleToDepartment('DIRECTOR'), 'DIRECTOR');
  assert.equal(roleToDepartment('ADMIN'), 'DIRECTOR');
  assert.equal(roleToDepartment('FINANCE'), 'FINANCE');
  assert.equal(roleToDepartment('HR'), 'HR');
  assert.equal(roleToDepartment('IT'), 'IT');
});

test('yêu cầu nội bộ: tạo -> bộ phận xong -> Giám đốc ký duyệt mới triển khai', async () => {
  const repo = new MockSheetsAdapter();
  const created = await createInternalRequest(repo, {
    title: 'Cấp tài khoản Zalo OA',
    description: 'Cho nhân sự mới',
    to_dept: 'IT',
    from_dept: 'HR',
    created_by: 'HR_1',
    created_by_name: 'Trần Nhân Sự',
  });
  assert.equal(created.status, 'PENDING');
  assert.equal(created.current_dept, 'IT');
  assert.equal(created.timeline.length, 1);

  const done = await markInternalRequestDone(repo, created.request_id, { id: 'IT_1', name: 'IT A', role: 'IT' }, 'đã cấp');
  assert.equal(done.status, 'AWAITING_DIRECTOR');

  const approved = await approveInternalRequest(repo, created.request_id, { id: 'GD_1', name: 'Giám Đốc', role: 'DIRECTOR' }, 'ok');
  assert.equal(approved.status, 'APPROVED');
  assert.equal(approved.director_signature?.name, 'Giám Đốc');

  const list = await listInternalRequests(repo);
  assert.equal(list.length, 1);
  assert.equal(list[0].status, 'APPROVED');
});

test('yêu cầu nội bộ: chuyển tiếp bộ phận khác và từ chối', async () => {
  const repo = new MockSheetsAdapter();
  const created = await createInternalRequest(repo, {
    title: 'Đối soát công tháng 10', to_dept: 'FINANCE', from_dept: 'HR', created_by: 'HR_1',
  });
  const fwd = await forwardInternalRequest(repo, created.request_id, 'DIRECTOR', { id: 'HR_1', role: 'HR' }, 'cần GĐ xem');
  assert.equal(fwd.current_dept, 'DIRECTOR');
  assert.equal(fwd.status, 'IN_PROGRESS');

  const rejected = await rejectInternalRequest(repo, created.request_id, { id: 'GD_1', role: 'DIRECTOR' }, 'thiếu chứng từ');
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(rejected.result_note, 'thiếu chứng từ');
});

test('quy chế công ty: lưu theo đối tượng nhân viên / chi nhánh / tất cả', async () => {
  const repo = new MockSheetsAdapter();
  const all = await upsertCompanyPolicy(repo, { title: 'Quy chế đồng phục', targets: { type: 'ALL' } }, { id: 'GD_1', name: 'GĐ' });
  assert.equal(all.targets.type, 'ALL');

  const byBranch = await upsertCompanyPolicy(repo, {
    title: 'Quy chế ca tối', targets: { type: 'BRANCH', branchIds: ['CN130', 'CN261'] },
  }, { id: 'GD_1', name: 'GĐ' });
  assert.deepEqual(byBranch.targets.branchIds, ['CN130', 'CN261']);

  const byEmp = await upsertCompanyPolicy(repo, {
    title: 'Nhắc riêng', targets: { type: 'EMPLOYEE', employeeIds: ['EMP_1'] },
  }, { id: 'GD_1', name: 'GĐ' });
  assert.deepEqual(byEmp.targets.employeeIds, ['EMP_1']);

  const list = await listCompanyPolicies(repo);
  assert.equal(list.length, 3);

  // Sửa lại 1 quy chế (giữ policy_id) không tạo bản mới
  const updated = await upsertCompanyPolicy(repo, {
    policy_id: all.policy_id, title: 'Quy chế đồng phục (v2)', active: false, targets: { type: 'ALL' },
  }, { id: 'GD_1', name: 'GĐ' });
  assert.equal(updated.policy_id, all.policy_id);
  assert.equal(updated.active, false);
  assert.equal((await listCompanyPolicies(repo)).length, 3);

  // Xóa
  const ok = await deleteCompanyPolicy(repo, all.policy_id);
  assert.equal(ok, true);
  assert.equal((await listCompanyPolicies(repo)).length, 2);
});
