import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PayrollService } from '../src/services/payroll.service.js';

/**
 * CHẶN THAO TÁC SAI THỨ TỰ Ở SERVER (assertWorkflowStepOpen):
 * Kế toán chỉ được ghi dữ liệu tiến trình khi bước tương ứng ĐANG MỞ. Nếu bước
 * đã xong / chưa mở / tháng đã kết thúc → phải ném STEP_LOCKED kèm lý do, để
 * không thể lách quy trình bằng tab khác hoặc gọi thẳng API.
 */

const CUR_MONTH = '2026-11';
const runDraft = {
  run_id: 'R1', period: '2026-10', status: 'DRAFT',
  created_at: '2026-10-31T00:00:00.000Z', updated_at: '2026-10-31T00:00:00.000Z',
};

function makeService(opts: any = {}) {
  const repo: any = {
    listPayrollRuns: async () => opts.runs || [],
    getSystemSettings: async () => opts.settings || {},
  };
  const svc: any = new PayrollService(repo);
  svc.getFinanceTimesheet = async () => opts.timesheet || { totals: {} };
  svc.getPeriodSlips = async () => ({ run: opts.run || null, slips: opts.slips || [] });
  return svc;
}

test('guard: bước chưa mở → chặn STEP_LOCKED (tính lương khi chưa xác nhận bước 1-2)', async () => {
  const svc = makeService({
    timesheet: { totals: { totalShifts: 3, full: 3, partial: 0, absent: 0 }, rows: [] },
    slips: [],
  });
  await assert.rejects(
    () => svc.assertWorkflowStepOpen(CUR_MONTH, ['fin-calculate', 'fin-payroll-periods'], 'Tính lương'),
    (e: any) => /STEP_LOCKED/.test(String(e?.message)) && /Tính lương/.test(String(e?.message)),
  );
});

test('guard: bước đang mở → cho phép', async () => {
  const svc = makeService({
    timesheet: { totals: { totalShifts: 3, full: 3, partial: 0, absent: 0 }, rows: [] },
    slips: [],
  });
  // Chưa xác nhận gì → bước 1 (Đối soát công) đang mở.
  await svc.assertWorkflowStepOpen(CUR_MONTH, 'fin-timesheet', 'Đối soát công');
});

test('guard: nhiều bước cùng hợp lệ — chỉ cần MỘT bước mở (phát hành phiếu ở bước 6)', async () => {
  const svc = makeService({
    timesheet: { totals: { totalShifts: 3, full: 3, partial: 0, absent: 0 }, rows: [] },
    run: runDraft,
    slips: [
      // 1 phiếu đã phát hành → bước 5 (Kỳ lương) xong; 1 phiếu chưa ký → bước 6 mở.
      { run_id: 'R1', item_id: 'S1', employee_id: 'E1', status: 'PUBLISHED', slip_published_at: '2026-11-01T00:00:00.000Z' },
      { run_id: 'R1', item_id: 'S2', employee_id: 'E2', status: 'DRAFT' },
    ],
    settings: { [`payrollWorkflowDone:${CUR_MONTH}`]: { 'fin-timesheet': { at: '2026-10-31T01:00:00.000Z' }, 'fin-bcc': { at: '2026-10-31T02:00:00.000Z' } } },
  });
  await svc.assertWorkflowStepOpen(CUR_MONTH, ['fin-payroll-periods', 'fin-payslips'], 'Phát hành phiếu lương');
});

test('guard: tháng đã kết thúc → chặn và nêu rõ lý do khóa tháng', async () => {
  const svc = makeService({
    timesheet: { totals: { totalShifts: 3, full: 3, partial: 0, absent: 0 }, rows: [] },
    run: { ...runDraft, period: '2026-10' },
    slips: [{ run_id: 'R1', item_id: 'S1', employee_id: 'E1', status: 'DRAFT' }],
  });
  await assert.rejects(
    () => svc.assertWorkflowStepOpen('2026-10', 'fin-calculate', 'Tính lương'),
    (e: any) => /STEP_LOCKED/.test(String(e?.message)) && /tháng/i.test(String(e?.message)),
  );
});

test('guard: kỳ lương không hợp lệ → bỏ qua (không chặn nhầm endpoint khác)', async () => {
  const svc = makeService({});
  await svc.assertWorkflowStepOpen('RUN_2026_10', 'fin-payment', 'Xác nhận đã chuyển khoản');
});
