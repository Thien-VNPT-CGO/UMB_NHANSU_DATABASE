import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { NotificationsService } from './notifications.service.js';
import { DedupePlan, planDedupe, suggestFreeSlots } from './interview-slots.service.js';

export interface DedupeResult {
  plans: DedupePlan[];
  removedCount: number;
  dryRun: boolean;
}

async function hrAdminIds(repo: ISheetsRepository): Promise<string[]> {
  try {
    const admins = await repo.listAdminAccounts();
    return admins.filter(a => (a.role === 'ADMIN' || a.role === 'HR') && a.is_active !== false).map(a => a.admin_id);
  } catch {
    return [];
  }
}

/**
 * Rà soát lịch PV trùng + (mặc định) TỰ ĐỘNG XÓA lịch kẹt, yêu cầu đăng ký lại:
 *  - dryRun=true: chỉ trả kế hoạch (HR xem trước, không xóa).
 *  - dryRun=false: xóa lịch trùng (đưa ứng viên về NEW/chờ xếp lịch, xóa trạng
 *    thái thư mời Zalo cũ vì giờ trong thư đã sai), ghi audit, báo HR/Admin
 *    danh sách bị xóa + khung trống gợi ý để đăng ký lại.
 *  Lịch được giữ: giờ sớm nhất (đồng giờ thì hồ sơ tạo trước).
 */
export async function dedupeDuplicateInterviews(
  repo: ISheetsRepository,
  notifications: NotificationsService,
  opts: { dryRun?: boolean; actorId?: string; nowMs?: number } = {}
): Promise<DedupeResult> {
  const { dryRun = false, actorId = 'SYSTEM', nowMs = Date.now() } = opts;
  const candidates = await repo.listCandidates().catch(() => []);
  const plans = planDedupe(candidates, nowMs);
  const removedCount = plans.reduce((n, p) => n + p.removed.length, 0);
  if (dryRun || removedCount === 0) return { plans, removedCount, dryRun };

  for (const plan of plans) {
    for (const r of plan.removed) {
      try {
        await repo.updateCandidate(r.submissionId, {
          status: 'NEW',
          interview_date: undefined,
          interview_time_slot: undefined,
          interviewer_id: undefined,
          zalo_invite_status: undefined,
          zalo_uid: undefined,
          zalo_invite_at: undefined,
          zalo_invite_error: undefined,
        } as any);
      } catch {
        continue; // hồ sơ lỗi bỏ qua, lần quét sau thử lại
      }
      try {
        await repo.recordAuditLog({
          log_id: `LOG_${Date.now()}_${r.submissionId}`,
          actor_id: actorId,
          actor_role: actorId === 'SYSTEM' ? 'SYSTEM' : 'HR',
          action: 'INTERVIEW_DUPLICATE_REMOVED',
          target_entity: 'CANDIDATE',
          target_id: r.submissionId,
          details: `Auto-removed duplicate interview ${r.timeSlot} ${r.date} of ${r.candidateName} (conflicts with ${r.keptTimeSlot} of ${r.keptCandidateName}); requires re-registration`,
        });
      } catch { /* best-effort */ }
    }
  }

  // Báo HR/Admin: danh sách bị xóa + khung trống để đăng ký lại ngay.
  try {
    const ids = await hrAdminIds(repo);
    if (ids.length > 0) {
      const fresh = await repo.listCandidates().catch(() => []);
      const lines = plans.flatMap(p => {
        const sugg = suggestFreeSlots(fresh, p.date, 5);
        return p.removed.map(r =>
          `• ${r.candidateName} (${r.timeSlot} ${p.date}) — kẹt với ${r.keptCandidateName} (${r.keptTimeSlot})`
        ).concat(sugg.length > 0 ? [`  ↳ Khung trống ${p.date}: ${sugg.join(', ')}`] : []);
      });
      await notifications.sendNotification({
        recipientIds: ids,
        type: 'INTERVIEW_DUPLICATES_REMOVED',
        severity: 'ACTION_REQUIRED',
        title: `🧹 Đã xóa ${removedCount} lịch PV trùng (< 30 phút) — cần đăng ký lại`,
        summary: `${lines.slice(0, 12).join('\n')}${lines.length > 12 ? `\n(+${lines.length - 12} dòng khác)` : ''}`,
        targetPath: '/hr-interviews',
        actorId: 'SYSTEM',
      }).catch(() => null);
    }
  } catch { /* best-effort */ }

  return { plans, removedCount, dryRun };
}
