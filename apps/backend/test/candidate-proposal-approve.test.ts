import test from 'node:test';
import assert from 'node:assert/strict';
import { EmployeesService } from '../src/services/employees.service.js';

/**
 * Hồi quy: khi HR CHỐT lịch theo đề xuất của ứng viên, các trường "đề xuất"
 * phải được xóa khỏi hồ sơ — nếu còn sót, pull/push sau sẽ hiển thị lại lịch
 * đề xuất cũ như thể ứng viên vẫn đang chờ HR duyệt.
 */
test('approveProposedSchedule xóa đề xuất sau khi chốt lịch mới', async () => {
  const cand: any = {
    submission_id: 'CAND_0100',
    full_name: 'Ứng Viên Test',
    status: 'RESCHEDULE_PROPOSED',
    interview_proposed_date: '2026-11-20',
    interview_proposed_time_slot: '16:00',
    interview_proposed_note: 'Chỉ rảnh chiều',
    interview_proposed_at: '2026-11-12T02:16:14.002Z',
    interview_decline_reason: 'Bận việc gia đình',
  };
  const repo: any = {
    listCandidates: async () => [cand],
    updateCandidate: async (id: string, patch: any) => {
      assert.equal(id, cand.submission_id);
      Object.assign(cand, patch);
      return { ...cand };
    },
    recordAuditLog: async () => undefined,
  };

  const svc = new EmployeesService(repo);
  const updated: any = await svc.approveProposedSchedule('CAND_0100', 'ADM_002');

  assert.equal(updated.status, 'INVITED_INTERVIEW');
  assert.equal(updated.interview_date, '2026-11-20');
  assert.equal(updated.interview_time_slot, '16:00');
  assert.equal(updated.interview_proposed_date, undefined);
  assert.equal(updated.interview_proposed_time_slot, undefined);
  assert.equal(updated.interview_proposed_note, undefined);
  assert.equal(updated.interview_proposed_at, undefined);
});
