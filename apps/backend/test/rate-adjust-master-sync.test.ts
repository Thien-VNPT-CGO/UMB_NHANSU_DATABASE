import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateAdjustService } from '../src/services/rate-adjust.service.js';

/**
 * Điều chỉnh đơn giá phải cập nhật luôn `current_rate_per_hour` trên hồ sơ NV
 * khi ngày hiệu lực đã tới — nếu không Hồ Sơ HR, cổng NV và NHAN_VIEN_MASTER
 * vẫn hiện đơn giá cũ dù bảng lương đã tính đơn giá mới.
 */
function makeRepo(opts?: { currentRate?: number; version?: number; effectiveFrom?: string }) {
  const emp: any = {
    employee_id: 'E1',
    employee_code: 'UBM_NV656082',
    full_name: 'NGUYỄN PHẠM BẢO CHÂU',
    employment_status: 'OFFICIAL',
    official_date: '2025-08-20',
    current_rate_per_hour: opts?.currentRate ?? 25500,
    version: opts?.version ?? 43,
  };
  const history: any[] = [
    { period_id: 'H0', employee_id: 'E1', stage: 'OFFICIAL', effective_from: '2025-08-20', rate_per_hour: 25500, note: 'Chuyển chính thức', created_at: '2025-08-20T00:00:00.000Z' },
  ];
  const repo: any = {
    emp,
    history,
    pushed: 0,
    getEmployeeById: async () => ({ ...emp }),
    getStageHistory: async () => history.map(h => ({ ...h })),
    addStageHistory: async (h: any) => { history.push(h); return h; },
    updateEmployee: async (id: string, patch: any, expectedVersion: number) => {
      assert.equal(id, 'E1');
      assert.equal(expectedVersion, emp.version);
      Object.assign(emp, patch, { version: emp.version + 1 });
      return { ...emp };
    },
    listEmployees: async () => [{ ...emp }],
    recordAuditLog: async () => undefined,
    syncService: { pushEmployeesTab: async () => { repo.pushed += 1; return 1; } },
  };
  return repo;
}

function makePayroll() {
  return {
    getFormula: async () => ({ rateTV: 21000, rateCT: 25500 }),
    getPeriodSlips: async () => ({ slips: [] }),
    calculateFormulaPayroll: async () => ({ run: { total_employees: 0 }, slips: [] }),
    invalidateFinanceTimesheetCache: () => undefined,
    scheduleFinanceToSheetsSync: () => undefined,
    syncEmployeeSalary: () => ({ ok: true, at: new Date().toISOString() }),
  };
}

test('rate-adjust commit cập nhật current_rate_per_hour + đẩy NHAN_VIEN_MASTER', async () => {
  const repo = makeRepo();
  const svc = new RateAdjustService({ repo, payrollService: makePayroll() });

  await svc.commit(
    [{ employeeId: 'E1', newRate: 30000 }],
    { effectiveFrom: '2026-10-01', applyPast: false, reason: 'Tăng đơn giá ca' },
    'ADM_003'
  );

  assert.equal(repo.emp.current_rate_per_hour, 30000);
  assert.equal(repo.emp.version, 44, 'version phải tăng để pull không lấy bản cũ');
  assert.equal(repo.pushed, 1, 'phải đẩy NHAN_VIEN_MASTER ngay');
});

test('rate-adjust commit ngày hiệu lực tương lai KHÔNG đổi đơn giá hiện tại', async () => {
  const repo = makeRepo();
  const svc = new RateAdjustService({ repo, payrollService: makePayroll() });

  await svc.commit(
    [{ employeeId: 'E1', newRate: 35000 }],
    { effectiveFrom: '2099-01-01', applyPast: false, reason: 'Đơn giá tương lai' },
    'ADM_003'
  );

  assert.equal(repo.emp.current_rate_per_hour, 25500, 'chưa tới ngày hiệu lực thì giữ nguyên');
  assert.equal(repo.emp.version, 43);
});
