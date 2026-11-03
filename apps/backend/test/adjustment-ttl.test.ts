import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { AttendanceService } from '../src/services/attendance.service.js';

const HOUR = 3_600_000;

async function seed(repo: MockSheetsAdapter, id: string, createdMs: number, reason = 'Quên check-in') {
  const adj: any = await repo.createAttendanceAdjustment({
    adjustment_id: id,
    employee_id: 'EMP_001',
    branch_id: 'CN130',
    assignment_id: 'ASG_001',
    reason,
    minutes_requested: 45,
    status: 'PENDING',
  } as any);
  adj.created_at = new Date(createdMs).toISOString();
  adj.updated_at = adj.created_at;
  return adj;
}

test('phiếu bù công: quá 72 giờ chưa duyệt thì tự động hủy', async () => {
  const repo = new MockSheetsAdapter();
  const now = Date.UTC(2026, 10, 3, 12, 0, 0);
  await seed(repo, 'ADJ_OLD', now - 73 * HOUR);      // 73h -> quá hạn
  await seed(repo, 'ADJ_FRESH', now - 71 * HOUR);    // 71h -> còn hạn

  const svc = new AttendanceService(repo);
  const res = await svc.expireStaleAdjustments(new Date(now));

  assert.deepEqual(res.rejected.map(r => r.adjustmentId), ['ADJ_OLD']);

  const list = await repo.listAttendanceAdjustments();
  const old = list.find((a: any) => a.adjustment_id === 'ADJ_OLD');
  const fresh = list.find((a: any) => a.adjustment_id === 'ADJ_FRESH');
  assert.equal((old as any).status, 'REJECTED');
  assert.match(String((old as any).review_note || ''), /72 giờ/);
  assert.equal((fresh as any).status, 'PENDING');
});

test('hằng số hạn duyệt là 72 giờ (4320 phút)', () => {
  assert.equal(AttendanceService.ADJUSTMENT_TTL_MINUTES, 72 * 60);
  assert.equal(AttendanceService.BU_CONG_NGAY_TTL_MINUTES, 72 * 60);
});
