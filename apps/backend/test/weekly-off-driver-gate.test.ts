import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import {
  checkWeeklyOffGate,
  openManualRegistration,
} from '../src/services/weekly-off.service.js';

/**
 * Cổng đăng ký 2 ngày OFF/tuần KHÔNG được khóa app TÀI XẾ.
 *
 * Tài khoản tài xế chỉ có 5 tab vận chuyển (không có tab đăng ký OFF tuần), nên
 * nếu cổng chặn /ev/me/* thì tài xế ngoài đường bị khóa cứng, không có cách tự
 * mở khóa. Trong khi đó nhân viên khác vẫn phải đăng ký đủ 2 ngày mới dùng được.
 */

const NOW = new Date('2026-11-13T03:00:00.000Z');

async function setup() {
  const repo = new MockSheetsAdapter();
  repo.employees.push({
    employee_id: 'EMP_DRIVER_GATE',
    employee_code: 'UBM_EV99',
    full_name: 'Tài xế Gate',
    employment_status: 'OFFICIAL',
    group: 'XUONG',
    default_branch_id: 'XUONG_SX',
    start_date: '2026-01-02',
  } as any);
  await openManualRegistration(repo, 'ADMIN_GATE', 120, NOW);
  return repo;
}

test('cổng OFF tuần: tài xế vẫn dùng được toàn bộ /ev/me/*', async () => {
  const repo = await setup();
  const user = { role: 'EMPLOYEE', employeeId: 'EMP_DRIVER_GATE' };

  for (const path of [
    '/ev/me/profile',
    '/ev/me/history',
    '/ev/me/shifts',
    '/ev/me/charging-tickets',
    '/ev/me/payroll',
  ]) {
    const gate = await checkWeeklyOffGate(repo, user, path, NOW);
    assert.equal(gate.locked, false, `${path} phải được phép khi cổng OFF tuần đang mở`);
  }
});

test('cổng OFF tuần: nhân viên chưa đăng ký vẫn bị khóa ở chức năng khác', async () => {
  const repo = await setup();
  const user = { role: 'EMPLOYEE', employeeId: 'EMP_DRIVER_GATE' };

  const gate = await checkWeeklyOffGate(repo, user, '/schedule', NOW);
  assert.equal(gate.locked, true, 'chức năng ngoài allowlist vẫn bị khóa');
  assert.equal(gate.window.phase, 'OPEN');
});
