import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PayrollService } from '../src/services/payroll.service.js';

/**
 * TÁCH NHIỆM (SEPARATION OF DUTIES) — DUYỆT KỲ LƯƠNG:
 * Người TÍNH/lập kỳ lương không được tự duyệt kỳ của mình, áp dụng cho MỌI
 * vai trò (kể cả ADMIN). Giám đốc (DIRECTOR) hoặc người khác duyệt bình thường.
 * Kỳ do hệ thống tạo tự động (created_by rỗng/SYSTEM) thì không chặn.
 */

function makeService(run: any) {
  const calls: any[] = [];
  const repo: any = {
    getPayrollRun: async () => run,
    updatePayrollRunStatus: async (runId: string, status: string, actorId: string, extra?: any) => {
      calls.push({ runId, status, actorId, extra });
      return { ...run, status, approved_by: actorId, ...(extra || {}) };
    },
    listAdminAccounts: async () => [],
  };
  const svc = new PayrollService(repo);
  return { svc, calls };
}

const baseRun = {
  run_id: 'RUN_OCT_TONG_HOP',
  period: '2026-10',
  status: 'RECONCILED',
  total_employees: 8,
  total_amount: 39_200_000,
  created_by: 'ADM_003',
};

test('SoD: Kế toán lập kỳ không được tự duyệt kỳ của mình', async () => {
  const { svc, calls } = makeService({ ...baseRun });
  await assert.rejects(
    () => svc.approveRun('RUN_OCT_TONG_HOP', 'ADM_003'),
    (e: any) => /SEPARATION_OF_DUTIES/.test(String(e?.message)),
  );
  assert.equal(calls.length, 0, 'không được cập nhật trạng thái khi tự duyệt');
});

test('SoD: ADMIN cũng không được tự duyệt kỳ do chính mình tính', async () => {
  const { svc, calls } = makeService({ ...baseRun, created_by: 'ADM_001' });
  await assert.rejects(
    () => svc.approveRun('RUN_OCT_TONG_HOP', 'ADM_001'),
    (e: any) => /SEPARATION_OF_DUTIES/.test(String(e?.message)),
  );
  assert.equal(calls.length, 0);
});

test('SoD: Giám đốc (DIRECTOR) duyệt được kỳ do Kế toán lập', async () => {
  const { svc, calls } = makeService({ ...baseRun, created_by: 'ADM_003' });
  const out: any = await svc.approveRun('RUN_OCT_TONG_HOP', 'director-1793697671242');
  assert.equal(out?.result?.status, 'APPROVED');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 'APPROVED');
  assert.equal(calls[0].actorId, 'director-1793697671242');
});

test('SoD: kỳ do hệ thống tạo (created_by rỗng) vẫn duyệt được', async () => {
  const { svc, calls } = makeService({ ...baseRun, created_by: '' });
  const out: any = await svc.approveRun('RUN_OCT_TONG_HOP', 'ADM_001');
  assert.equal(out?.result?.status, 'APPROVED');
  assert.equal(calls.length, 1);
});
