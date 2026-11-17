import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PayrollService } from '../src/services/payroll.service.js';
import { PAYROLL_BATCHES, employeeInBatch } from '@ubm/shared';

/**
 * TÍNH LƯƠNG THEO 2 ĐỢT (Cửa hàng / Tổng hợp):
 *  - Mỗi đợt sinh 1 kỳ lương (run) RIÊNG, chỉ chứa nhân viên thuộc khối của đợt đó.
 *  - Tính đợt này KHÔNG được tạo/ghi đè/sửa phiếu của đợt còn lại.
 *  - Chọn đợt nào tính trước cũng được (STORE → TONG_HOP hoặc ngược lại).
 *  - getPeriodSlips gộp phiếu 2 đợt thành 1 kỳ hiển thị; getWorkflowStatus báo
 *    đợt nào đã tính / còn thiếu để Kế toán biết đường làm tiếp.
 */

const EMP_STORE = {
  employee_id: 'E1', employee_code: 'NV01', full_name: 'Nhân viên Cửa hàng',
  group: 'STORE', employment_status: 'OFFICIAL', default_branch_id: 'CN130',
};
const EMP_OFFICE = {
  employee_id: 'E2', employee_code: 'NV02', full_name: 'Nhân viên Văn phòng',
  group: 'VAN_PHONG', employment_status: 'OFFICIAL', default_branch_id: 'VAN_PHONG',
};

function makeState(employees: any[] = [EMP_STORE, EMP_OFFICE]) {
  return { employees, runs: [] as any[], slips: [] as any[] };
}

function makeRepo(state: any) {
  const repo: any = {
    getPayrollFormula: async () => ({ rateTV: 20000, rateCT: 25000, otThreshold1: 10, otThreshold2: 15 }),
    getPayrollInputs: async () => [],
    listEmployees: async () => state.employees,
    getStageHistory: async () => [],
    getShiftsForEmployee: async () => [],
    getAttendanceEvents: async () => [],
    createPayrollRun: async (run: any, items: any[]) => {
      const now = new Date().toISOString();
      const savedRun = { ...run, created_at: now, updated_at: now, version: 1 };
      const savedItems = items.map((it: any) => ({ ...it, created_at: now, updated_at: now, version: 1 }));
      state.runs.push(savedRun);
      state.slips.push(...savedItems);
      return { run: savedRun, items: savedItems };
    },
    listPayrollRuns: async () => state.runs,
    getPayslipsByRunId: async (runId: string) => state.slips.filter((s: any) => s.run_id === runId),
    getSystemSettings: async () => ({}),
  };
  return repo;
}

async function calc(svc: any, period: string, batch?: string) {
  const res: any = await svc.calculateFormulaPayroll(period, '*', 'FIN_001', { batch });
  return res?.result ?? res;
}

test('đợt STORE: chỉ tạo phiếu cho nhân viên Cửa hàng, run_id mang mã đợt', async () => {
  const state = makeState();
  const svc: any = new PayrollService(makeRepo(state) as any);

  const inner = await calc(svc, '2026-11', 'STORE');

  assert.equal(inner.run.batch_scope, 'STORE');
  assert.match(String(inner.run.run_id), /^PAY_2026_11_STORE_\d+$/);
  assert.equal(inner.items.length, 1);
  assert.equal(inner.items[0].employee_id, 'E1');
  assert.equal(inner.items[0].batch_scope, 'STORE');
  assert.equal(state.runs.length, 1);
  assert.equal(state.slips.length, 1);
  // Không có phiếu nào của khối Tổng hợp bị tạo ra.
  assert.equal(state.slips.some((s: any) => s.employee_id === 'E2'), false);
});

test('đợt không có nhân viên: báo EMPTY_BATCH, không tạo kỳ rỗng', async () => {
  const state = makeState([EMP_STORE]);
  const svc: any = new PayrollService(makeRepo(state) as any);

  await assert.rejects(() => calc(svc, '2026-11', 'TONG_HOP'), /EMPTY_BATCH/);
  assert.equal(state.runs.length, 0);
  assert.equal(state.slips.length, 0);
});

test('tính đợt Tổng hợp TRƯỚC rồi đợt Cửa hàng: 2 kỳ độc lập, không đụng số liệu nhau', async () => {
  const state = makeState();
  const svc: any = new PayrollService(makeRepo(state) as any);

  const tongHop = await calc(svc, '2026-11', 'TONG_HOP');
  const tongHopSlip = state.slips.find((s: any) => s.employee_id === 'E2');
  const tongHopSnapshot = { ...tongHopSlip };

  const store = await calc(svc, '2026-11', 'STORE');

  assert.equal(tongHop.run.batch_scope, 'TONG_HOP');
  assert.equal(store.run.batch_scope, 'STORE');
  assert.notEqual(tongHop.run.run_id, store.run.run_id);
  assert.equal(tongHop.items.length, 1);
  assert.equal(store.items.length, 1);
  // Đợt Tổng hợp vẫn còn nguyên kỳ + phiếu cũ, không bị tính lại/ghi đè.
  assert.equal(state.runs.length, 2);
  const tongHopSlipAfter = state.slips.find((s: any) => s.employee_id === 'E2');
  assert.deepEqual(tongHopSlipAfter, tongHopSnapshot);
  assert.equal(tongHopSlipAfter.run_id, tongHop.run.run_id);
});

test('tính đợt Cửa hàng TRƯỚC rồi đợt Tổng hợp: đảo thứ tự vẫn đúng', async () => {
  const state = makeState();
  const svc: any = new PayrollService(makeRepo(state) as any);

  const store = await calc(svc, '2026-11', 'STORE');
  const storeSlip = { ...state.slips.find((s: any) => s.employee_id === 'E1') };

  const tongHop = await calc(svc, '2026-11', 'TONG_HOP');

  assert.equal(state.runs.length, 2);
  assert.equal(store.items[0].employee_id, 'E1');
  assert.equal(tongHop.items[0].employee_id, 'E2');
  assert.deepEqual({ ...state.slips.find((s: any) => s.employee_id === 'E1') }, storeSlip);
});

test('tính lại 1 đợt: kỳ mới của đợt đó thay kỳ cũ, đợt kia không đổi', async () => {
  const state = makeState();
  const svc: any = new PayrollService(makeRepo(state) as any);

  const store1 = await calc(svc, '2026-11', 'STORE');
  const tongHop = await calc(svc, '2026-11', 'TONG_HOP');
  const store2 = await calc(svc, '2026-11', 'STORE');

  assert.notEqual(store1.run.run_id, store2.run.run_id);
  // Cả 2 lần tính STORE đều được lưu (lịch sử đối chiếu), nhưng kỳ hiển thị chỉ
  // lấy phiếu MỚI NHẤT của từng nhân viên.
  const merged: any = await svc.getPeriodSlips('2026-11');
  const e1 = merged.slips.filter((s: any) => s.employee_id === 'E1');
  const e2 = merged.slips.filter((s: any) => s.employee_id === 'E2');
  assert.equal(e1.length, 1);
  assert.equal(e2.length, 1);
  assert.equal(e1[0].run_id, store2.run.run_id);
  assert.equal(e2[0].run_id, tongHop.run.run_id);
  // Kỳ gộp: phủ đủ 2 đợt, tổng NV/tiền = tổng phiếu.
  assert.equal(merged.run.batch_scope, 'ALL');
  assert.equal(merged.run.total_employees, 2);
  assert.equal(merged.run.batches.length, 2);
  const mergedBatches = merged.run.batches.map((b: any) => b.batch_scope).sort();
  assert.deepEqual(mergedBatches, ['STORE', 'TONG_HOP']);
});

test('workflow: báo đúng đợt đã tính / còn thiếu, đợt đã tính vẫn đối soát được', async () => {
  const state = makeState();
  const svc: any = new PayrollService(makeRepo(state) as any);
  svc.getFinanceTimesheet = async () => ({
    totals: { totalShifts: 2, full: 2, partial: 0, absent: 0 },
    rows: [
      { employeeId: 'E1', group: 'STORE' },
      { employeeId: 'E2', group: 'VAN_PHONG' },
    ],
  });

  await calc(svc, '2026-11', 'STORE');
  const wfOne: any = await svc.getWorkflowStatus('2026-11');
  assert.deepEqual([...wfOne.requiredBatches].sort(), ['STORE', 'TONG_HOP']);
  assert.deepEqual(wfOne.missingBatches, ['TONG_HOP']);
  assert.equal(wfOne.allBatchesCalculated, false);
  const step3One: any = wfOne.steps.find((s: any) => s.id === 'fin-calculate');
  // Một đợt đã có phiếu → bước 3 xong để Kế toán đối soát/duyệt đợt đó ngay,
  // không bị chặn bởi đợt còn lại (2 đợt độc lập).
  assert.equal(step3One.done, true);
  assert.match(step3One.stat, /1\/2 đợt/);
  const storeInfo: any = wfOne.batches.find((b: any) => b.id === 'STORE');
  const tongHopInfo: any = wfOne.batches.find((b: any) => b.id === 'TONG_HOP');
  assert.equal(storeInfo.calculated, true);
  assert.equal(storeInfo.slipCount, 1);
  assert.equal(storeInfo.status, 'DRAFT');
  assert.equal(tongHopInfo.calculated, false);
  assert.equal(tongHopInfo.slipCount, 0);
  assert.equal(tongHopInfo.required, true);
  assert.equal(tongHopInfo.run_id, null);

  await calc(svc, '2026-11', 'TONG_HOP');
  const wfBoth: any = await svc.getWorkflowStatus('2026-11');
  assert.deepEqual(wfBoth.missingBatches, []);
  assert.equal(wfBoth.allBatchesCalculated, true);
  const tongHopAfter: any = wfBoth.batches.find((b: any) => b.id === 'TONG_HOP');
  assert.equal(tongHopAfter.calculated, true);
  assert.equal(tongHopAfter.slipCount, 1);
  assert.match(String(tongHopAfter.run_id), /_TONG_HOP_/);
});

test('kỳ lương cũ tính gộp (ALL) vẫn được coi là phủ cả 2 đợt, không phá dữ liệu cũ', async () => {
  const state = makeState();
  state.runs.push({
    run_id: 'PAY_2026_11_1730000000000', period: '2026-11', branch_scope: '*', status: 'DRAFT',
    total_employees: 2, created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z',
  });
  for (const empId of ['E1', 'E2']) {
    state.slips.push({
      item_id: `SLIP_OLD_${empId}`, run_id: 'PAY_2026_11_1730000000000', employee_id: empId,
      employee_code: empId, period: '2026-11', standard_hours: 0, net_pay: 100000, status: 'DRAFT',
      created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z',
    });
  }
  const svc: any = new PayrollService(makeRepo(state) as any);
  svc.getFinanceTimesheet = async () => ({
    totals: { totalShifts: 2, full: 2, partial: 0, absent: 0 },
    rows: [
      { employeeId: 'E1', group: 'STORE' },
      { employeeId: 'E2', group: 'VAN_PHONG' },
    ],
  });

  const wf: any = await svc.getWorkflowStatus('2026-11');
  assert.deepEqual(wf.missingBatches, []);
  assert.equal(wf.allBatchesCalculated, true);
  // Phiếu cũ không có batch_scope -> quy về đợt theo khối nhân viên.
  for (const b of PAYROLL_BATCHES) {
    const info: any = wf.batches.find((x: any) => x.id === b.id);
    const expected = state.employees.filter((e: any) => employeeInBatch(e.group, b.id)).length;
    assert.equal(info.employeeCount, expected);
    assert.equal(info.slipCount, expected);
  }
});
