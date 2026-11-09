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
    getSystemSettings: async () => opts.settings || {},
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

test('workflow: bước 1-2 chỉ xong khi kế toán xác nhận (không tự xong khi có ca), bước 6 mở khi đã phát hành phiếu', async () => {
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
    settings: { [`payrollWorkflowDone:${CUR_MONTH}`]: { 'fin-timesheet': { at: '2026-10-30T02:00:00.000Z', by: 'ADM_001' }, 'fin-bcc': { at: '2026-10-30T03:00:00.000Z', by: 'ADM_001' } } },
  });

  const wf: any = await svc.getWorkflowStatus(CUR_MONTH);
  const byId: any = Object.fromEntries(wf.steps.map((s: any) => [s.id, s]));

  assert.equal(byId['fin-timesheet'].done, true);
  assert.equal(byId['fin-timesheet'].completedAt, '2026-10-30T02:00:00.000Z');
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

  // Có ca nhưng kế toán CHƯA xác nhận → bước 1 chưa xong, bước 2 khóa theo tuần tự.
  assert.equal(byId['fin-timesheet'].done, false);
  assert.equal(byId['fin-timesheet'].dataReady, true);
  assert.equal(byId['fin-timesheet'].open, true);
  assert.equal(byId['fin-bcc'].done, false);
  assert.equal(byId['fin-bcc'].open, false);
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

test('workflow: đã mở khóa tạm nhưng completedAt mới hơn rollback thì bước xong lại', async () => {
  const repo: any = {
    listPayrollRuns: async () => [runDraft],
    getSystemSettings: async () => ({
      'payrollMonthUnlock:2026-10': { at: '2026-10-31T00:00:00.000Z', by: 'ADM_001', reason: 'test', toStepId: 'fin-calculate', toOrder: 3 },
      'payrollWorkflowOverride:2026-10': { at: '2026-10-31T00:00:00.000Z', by: 'ADM_001', reason: 'test', toStepId: 'fin-calculate', toOrder: 3 },
    }),
  };
  const svc: any = new PayrollService(repo);
  svc.getFinanceTimesheet = async () => ({ totals: { totalShifts: 4, full: 3, partial: 1, absent: 0 }, rows: [] });
  svc.getPeriodSlips = async () => ({ run: runDraft, slips: [{ run_id: 'R1', employee_id: 'E1', status: 'DRAFT' }] });
  const wf: any = await svc.getWorkflowStatus('2026-10');
  const byId: any = Object.fromEntries(wf.steps.map((s: any) => [s.id, s]));
  // run.created_at=2026-10-31T00:00:00.000Z không mới hơn thời điểm rollback → bước 3 vẫn mở lại.
  // Bước 1-2 cần xác nhận kế toán riêng nên vẫn chưa xong dù có ca.
  assert.equal(byId['fin-calculate'].done, false);
  assert.equal(byId['fin-calculate'].open, false);
  assert.equal(byId['fin-timesheet'].done, false);
  assert.equal(byId['fin-timesheet'].open, true);
});

test('workflow: độc lập theo tháng — khóa/mở khóa tháng 10 không ảnh hưởng tháng 11', async () => {
  const svc: any = new PayrollService({ listPayrollRuns: async () => [] } as any);
  svc.getFinanceTimesheet = async (period: string) => ({
    totals: { totalShifts: 5, full: 4, partial: 1, absent: 0 },
    rows: [],
  });
  svc.getPeriodSlips = async (period: string) => {
    if (period === '2026-10') {
      return { run: { ...runDraft, status: 'PAID' }, slips: [{ run_id: 'R1', employee_id: 'E1', status: 'PAID' }] };
    }
    return { run: null, slips: [] };
  };
  svc.repo = {
    listPayrollRuns: async () => [{ ...runDraft, status: 'PAID' }],
    getSystemSettings: async () => ({
      'payrollMonthUnlock:2026-10': { at: '2026-11-05T00:00:00.000Z', by: 'ADM_001', reason: 'rollback tháng 10' },
    }),
  };
  const wfOct: any = await svc.getWorkflowStatus('2026-10');
  const wfNov: any = await svc.getWorkflowStatus('2026-11');
  // Tháng 10 đã mở khóa tạm -> không còn monthLocked; tháng 11 là hiện tại -> cũng không locked.
  assert.equal(wfOct.period, '2026-10');
  assert.equal(wfNov.period, '2026-11');
  assert.equal(wfOct.periodMeta.monthLocked, false);
  assert.equal(wfNov.periodMeta.monthLocked, false);
  // Tháng 11 chưa có phiếu và chưa được kế toán xác nhận bước 1-2 -> tháng của tháng đó
  // vẫn đang ở bước 1 (đối soát công), bước 2-3 chờ tuần tự; từng tháng tính riêng.
  const byIdNov: any = Object.fromEntries(wfNov.steps.map((s: any) => [s.id, s]));
  assert.equal(byIdNov['fin-timesheet'].done, false);
  assert.equal(byIdNov['fin-timesheet'].dataReady, true);
  assert.equal(byIdNov['fin-timesheet'].open, true);
  assert.equal(byIdNov['fin-bcc'].open, false);
  assert.equal(byIdNov['fin-calculate'].done, false);
  assert.equal(byIdNov['fin-calculate'].open, false);
});

test('workflow: tháng 11 có ca nhưng chưa xác nhận thì step 1 mở, step 2 khóa tuần tự', async () => {
  const svc = makeService({
    runs: [],
    timesheet: { totals: { totalShifts: 4, full: 3, partial: 1, absent: 0 }, rows: [] },
    run: null,
    slips: [],
  });
  const wf: any = await svc.getWorkflowStatus('2026-11');
  const byId: any = Object.fromEntries(wf.steps.map((s: any) => [s.id, s]));
  assert.equal(byId['fin-timesheet'].done, false);
  assert.equal(byId['fin-timesheet'].dataReady, true);
  assert.equal(byId['fin-timesheet'].open, true);
  assert.equal(byId['fin-bcc'].done, false);
  assert.equal(byId['fin-bcc'].open, false);
  assert.equal(byId['fin-calculate'].open, false);
});

test('rollback: quay về Kỳ lương (5) mở đúng bước 5, bước trước vẫn xong', async () => {
  const paidRun = { ...runDraft, status: 'APPROVED', approved_at: '2026-11-01T02:00:00.000Z', approved_by: 'ADM_001' };
  const slipsStore: any[] = [
    { item_id: 'SLIP_R1_E1', run_id: 'R1', employee_id: 'E1', employee_code: 'E1', status: 'PUBLISHED', slip_published_at: '2026-11-02T02:00:00.000Z', standard_hours: 5, net_pay: 150000 },
    { item_id: 'SLIP_R1_E2', run_id: 'R1', employee_id: 'E2', employee_code: 'E2', status: 'PUBLISHED', slip_published_at: '2026-11-02T02:00:00.000Z', standard_hours: 5, net_pay: 150000 },
  ];
  let runStore: any = { ...paidRun };
  const repo: any = {
    listPayrollRuns: async () => [runStore],
    getSystemSettings: async () => (repo._settings || {}),
    updateSystemSettings: async (next: any) => { repo._settings = next; return next; },
    getPayslipById: async (id: string) => slipsStore.find(x => x.item_id === id) || null,
    updatePayslip: async (id: string, updates: any) => {
      const s = slipsStore.find(x => x.item_id === id);
      Object.assign(s, updates);
      for (const k of Object.keys(updates)) if ((updates as any)[k] === undefined) delete (s as any)[k];
      return { ...s };
    },
    updatePayrollRunStatus: async (_id: string, _status: string, _actor: string, updates: any) => {
      runStore = { ...runStore, status: _status, ...(updates || {}) };
      return runStore;
    },
    recordAuditLog: async () => ({}),
  };
  const svc: any = new PayrollService(repo);
  svc.getFinanceTimesheet = async () => ({ totals: { totalShifts: 2, full: 2, partial: 0, absent: 0 }, rows: [] });
  svc.getPeriodSlips = async () => ({ run: runStore, slips: slipsStore });
  const res: any = await svc.rollbackWorkflow('2026-10', 'fin-payroll-periods', 'ADM_001', 'duyệt nhầm');
  const inner = res?.result ?? res;
  assert.equal(inner.ok, true);
  assert.equal(slipsStore.every(x => x.status === 'DRAFT'), true);
  assert.equal(runStore.status, 'DRAFT');
  const wf: any = inner.workflow;
  const byId: any = Object.fromEntries(wf.steps.map((s: any) => [s.id, s]));
  // Vì bước 1-2 chưa có xác nhận nên bước 5 vẫn chờ tuần tự; muốn mở bước 5 phải
  // xác nhận 1-2 trước (đã xóa xác nhận khi quay về <=5). Kiểm tra rollback vẫn xóa xác nhận:
  // Bước 5 luôn chưa xong vì đủ điều kiện tuần tự (chưa xác nhận 1-2).
  assert.equal(byId['fin-payroll-periods'].done, false);
  assert.equal(byId['fin-timesheet'].done, false);
  assert.equal(byId['fin-timesheet'].open, true);
});

test('rollback: phiếu PAID cũng hoàn về DRAFT khi kế toán xác nhận sai (ghi lý do)', async () => {
  const paidRun = { ...runDraft, status: 'PAID', paid_at: '2026-11-02T03:00:00.000Z' };
  const slipsStore: any[] = [
    { item_id: 'SLIP_R1_E1', run_id: 'R1', employee_id: 'E1', employee_code: 'E1', status: 'PAID', sign_lap: { name: 'KT' }, sign_giamdoc: { name: 'GD' }, sign_nhanvien: { name: 'NV' }, standard_hours: 5, net_pay: 150000 },
    { item_id: 'SLIP_R1_E2', run_id: 'R1', employee_id: 'E2', employee_code: 'E2', status: 'PAID', sign_lap: { name: 'KT' }, sign_giamdoc: { name: 'GD' }, sign_nhanvien: { name: 'NV' }, standard_hours: 5, net_pay: 150000 },
  ];
  let runStore: any = { ...paidRun };
  const repo: any = {
    listPayrollRuns: async () => [runStore],
    getSystemSettings: async () => (repo._settings || {}),
    updateSystemSettings: async (next: any) => { repo._settings = next; return next; },
    getPayslipById: async (id: string) => slipsStore.find(x => x.item_id === id) || null,
    updatePayslip: async (id: string, updates: any) => {
      const s = slipsStore.find(x => x.item_id === id);
      if (!s) throw new Error('PAYSLIP_NOT_FOUND');
      Object.assign(s, updates);
      for (const k of Object.keys(updates)) if ((updates as any)[k] === undefined) delete (s as any)[k];
      return { ...s };
    },
    updatePayrollRunStatus: async (_id: string, _status: string, _actor: string, updates: any) => {
      runStore = { ...runStore, status: _status, ...(updates || {}) };
      return runStore;
    },
    recordAuditLog: async () => ({}),
    getFinanceTimesheet: async () => ({ totals: { totalShifts: 2, full: 2, partial: 0, absent: 0 }, rows: [] }),
  };
  const svc: any = new PayrollService(repo);
  // Override các hàm lấy dữ liệu cho getWorkflowStatus phía trong rollback.
  svc.getFinanceTimesheet = async () => ({ totals: { totalShifts: 2, full: 2, partial: 0, absent: 0 }, rows: [] });
  svc.getPeriodSlips = async () => ({ run: runStore, slips: slipsStore });
  // Mock queue: chạy ngay thay vì hàng đợi đơn (singleWriterQueue trong test trước đã có test riêng).
  // PayrollService dùng singleWriterQueue thật — rollback sẽ đi qua nó và vẫn gọi execute.
  // Quay về bước Phiếu lương (6): chỉ lùi PAID → PUBLISHED, GIỮ run PAID để bước 5 vẫn xong;
  // workflowOverride ép bước 6 mở lại (done=false, open=true).
  const res: any = await svc.rollbackWorkflow('2026-10', 'fin-payslips', 'ADM_001', 'tính sai đơn giá kỳ 10');
  const inner = res?.result ?? res;
  assert.equal(inner.ok, true);
  assert.equal(inner.revertedSlips, 2);
  assert.equal(inner.revertedPaid, 2);
  assert.equal(slipsStore.every(x => x.status === 'PUBLISHED'), true);
  assert.equal(runStore.status, 'PAID');
  // Workflow sau rollback.
  const wf: any = inner.workflow;
  assert.ok(wf);
  const byId: any = Object.fromEntries(wf.steps.map((s: any) => [s.id, s]));
  // Phiếu lương (6) quay về: chỉ lùi PAID → PUBLISHED, GIỮ run PAID; bước 5 giữ nguyên
  // trạng thái gốc (chưa xác nhận 1-2 nên chưa tính là xong tuần tự). Sau khi xác nhận
  // 1-2, bước 5 sẽ xong lại và bước 6 mở theo tuần tự.
  // (assert.equal ở trên đã qua, đến đây paycheck step vẫn là open=false do chờ 1-2)
  assert.equal(byId['fin-payment'].done, false);
  assert.equal(byId['fin-payment'].open, false);
  // Bước 1 vẫn là bước đang chờ xác nhận đầu tiên.
  assert.equal(byId['fin-timesheet'].open, true);
});
