import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PayrollService } from '../src/services/payroll.service.js';

/**
 * QUY TRÌNH KẾ TOÁN — XỬ LÝ TUẦN TỰ:
 * Mỗi bước phải dẫn xuất từ dữ liệu THẬT (bảng công + kỳ lương + phiếu lương),
 * có mốc hoàn tất thật, và bước sau chỉ mở khi bước trước đã xong. Không được
 * báo "đã tính lương" chỉ vì có dòng công thức, không được gán thời gian giả.
 */

function makeService(opts: any) {
  const repo: any = {
    listPayrollRuns: async () => opts.runs || [],
  };
  const svc: any = new PayrollService(repo);
  svc.getFinanceTimesheet = async () => opts.timesheet || { totals: {} };
  svc.getPeriodSlips = async () => ({ run: opts.run || null, slips: opts.slips || [] });
  return svc;
}

const runDraft = {
  run_id: 'R1',
  period: '2026-10',
  status: 'DRAFT',
  created_at: '2026-10-31T00:00:00.000Z',
  updated_at: '2026-10-31T00:00:00.000Z',
};

const CUR_MONTH = '2026-11';

test('workflow: bước 1–5 dẫn xuất từ ca + phiếu thật, bước 6 mở khi đã phát hành phiếu', async () => {
  const svc = makeService({
    runs: [runDraft],
    timesheet: {
      totals: { totalShifts: 10, full: 7, partial: 2, absent: 1 },
      rows: [{ shifts: [{ checkIn: '2026-10-30T01:00:00.000Z' }] }],
    },
    run: runDraft,
    slips: [
      { run_id: 'R1', employee_id: 'E1', status: 'PUBLISHED', slip_published_at: '2026-10-31T02:00:00.000Z', standard_hours: 5, net_pay: 150000 },
      { run_id: 'R1', employee_id: 'E2', status: 'DRAFT', standard_hours: 5, net_pay: 150000 },
    ],
  });

  const wf: any = await svc.getWorkflowStatus(CUR_MONTH);
  const byId: any = Object.fromEntries(wf.steps.map((s: any) => [s.id, s]));

  assert.equal(byId['fin-timesheet'].done, true);
  assert.equal(byId['fin-timesheet'].completedAt, '2026-10-30T01:00:00.000Z');
  assert.equal(byId['fin-bcc'].done, true);
  assert.equal(byId['fin-calculate'].done, true);
  assert.equal(byId['fin-calculate'].completedAt, '2026-10-31T00:00:00.000Z');
  assert.equal(byId['fin-payroll-sheet'].done, true);
  // Run còn DRAFT nhưng đã có 1 phiếu phát hành → kỳ lương coi như đã mở,
  // bước 6 không bị khóa vĩnh viễn.
  assert.equal(byId['fin-payroll-periods'].done, true);
  assert.equal(byId['fin-payslips'].done, false);
  assert.equal(byId['fin-payslips'].open, true);
  assert.equal(byId['fin-payment'].done, false);
  assert.equal(byId['fin-payment'].open, false);
});

test('workflow: chỉ có công thức chưa tính lương KHÔNG được báo bước 3 hoàn tất', async () => {
  const svc = makeService({
    runs: [],
    timesheet: { totals: { totalShifts: 4, full: 3, partial: 1, absent: 0 }, rows: [] },
    run: null,
    slips: [],
  });

  const wf: any = await svc.getWorkflowStatus(CUR_MONTH);
  const byId: any = Object.fromEntries(wf.steps.map((s: any) => [s.id, s]));

  assert.equal(byId['fin-timesheet'].done, true);
  assert.equal(byId['fin-bcc'].done, true);
  assert.equal(byId['fin-calculate'].done, false);
  assert.equal(byId['fin-calculate'].stat, 'Chưa tính');
  assert.equal(byId['fin-payroll-sheet'].open, false);
});

test('workflow: không có ca phát hành thì bước 1 chưa xong và bước 2 bị khóa', async () => {
  const svc = makeService({ runs: [], timesheet: { totals: {} }, run: null, slips: [] });

  const wf: any = await svc.getWorkflowStatus('2026-11');
  const byId: any = Object.fromEntries(wf.steps.map((s: any) => [s.id, s]));

  assert.equal(byId['fin-timesheet'].done, false);
  assert.equal(byId['fin-bcc'].open, false);
  assert.equal(byId['fin-calculate'].open, false);
  assert.match(byId['fin-timesheet'].reason, /Chưa có ca chấm công/);
});

test('workflow: tất cả phiếu PAID → bước 7 hoàn tất với mốc chi trả thật', async () => {
  const paidRun = { ...runDraft, status: 'PAID', paid_at: '2026-11-02T03:00:00.000Z' };
  const svc = makeService({
    runs: [paidRun],
    timesheet: { totals: { totalShifts: 2, full: 2, partial: 0, absent: 0 }, rows: [] },
    run: paidRun,
    slips: [
      { run_id: 'R1', employee_id: 'E1', status: 'PAID', slip_paid_at: '2026-11-02T02:00:00.000Z', standard_hours: 5, net_pay: 150000 },
      { run_id: 'R1', employee_id: 'E2', status: 'PAID', slip_paid_at: '2026-11-02T02:30:00.000Z', standard_hours: 5, net_pay: 150000 },
    ],
  });

  const wf: any = await svc.getWorkflowStatus('2026-10');
  const byId: any = Object.fromEntries(wf.steps.map((s: any) => [s.id, s]));

  assert.equal(byId['fin-payslips'].done, true);
  assert.equal(byId['fin-payment'].done, true);
  // Mốc hoàn tất = thời điểm THẬT muộn nhất: kỳ lương được chốt PAID lúc
  // 03:00 (sau khi phiếu cuối đã chi trả 02:30) — không phải "now" mỗi lần đọc.
  assert.equal(byId['fin-payment'].completedAt, '2026-11-02T03:00:00.000Z');
  assert.equal(byId['fin-payment'].stat, '2/2 phiếu đã chuyển');
});

test('workflow: tháng đã hết (quá khứ) thì khóa toàn bộ bước; tháng mới/hiện tại không khóa theo tháng', async () => {
  const svcPast = makeService({
    runs: [runDraft],
    timesheet: { totals: { totalShifts: 4, full: 3, partial: 1, absent: 0 }, rows: [] },
    run: runDraft,
    slips: [{ run_id: 'R1', employee_id: 'E1', status: 'DRAFT', standard_hours: 5, net_pay: 150000 }],
  });
  const wfPast: any = await svcPast.getWorkflowStatus('2026-10');
  assert.equal(wfPast.periodMeta.isPastMonth, true);
  assert.equal(wfPast.periodMeta.monthLocked, true);
  assert.equal(wfPast.steps.every((s: any) => s.locked), true);
  assert.equal(wfPast.steps.every((s: any) => s.open === false), true);
  assert.equal(wfPast.steps.every((s: any) => s.lockedDueToMonth), true);

  const svcNow = makeService({
    runs: [runDraft],
    timesheet: { totals: { totalShifts: 4, full: 3, partial: 1, absent: 0 }, rows: [] },
    run: runDraft,
    slips: [{ run_id: 'R1', employee_id: 'E1', status: 'DRAFT', standard_hours: 5, net_pay: 150000 }],
  });
  const wfNow: any = await svcNow.getWorkflowStatus(CUR_MONTH);
  assert.equal(wfNow.periodMeta.monthLocked, false);
  assert.equal(wfNow.periodMeta.isCurrentMonth, true);
  assert.equal(wfNow.steps.every((s: any) => s.lockedDueToMonth === false), true);
  assert.equal(wfNow.steps[0].open, true);
  assert.equal(wfNow.steps[0].previousStepId, null);
  assert.equal(wfNow.steps[1].previousStepId, 'fin-timesheet');
});

test('workflow: tháng đã hết nhưng đã mở khóa tạm (rollback) thì không còn khóa theo tháng', async () => {
  const repo: any = {
    listPayrollRuns: async () => [runDraft],
    getSystemSettings: async () => ({ 'payrollMonthUnlock:2026-10': { at: '2026-11-05T00:00:00.000Z', by: 'ADM_001', reason: 'sửa sai', toStepId: 'fin-calculate' } }),
  };
  const svc: any = new PayrollService(repo);
  svc.getFinanceTimesheet = async () => ({ totals: { totalShifts: 4, full: 3, partial: 1, absent: 0 }, rows: [] });
  svc.getPeriodSlips = async () => ({ run: runDraft, slips: [{ run_id: 'R1', employee_id: 'E1', status: 'DRAFT' }] });

  const wf: any = await svc.getWorkflowStatus('2026-10');
  assert.equal(wf.periodMeta.monthLocked, false);
  assert.equal(wf.periodMeta.monthUnlock.by, 'ADM_001');
  assert.equal(wf.steps[0].open, true);
});
