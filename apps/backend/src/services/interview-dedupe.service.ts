import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { NotificationsService } from './notifications.service.js';
import { DedupePlan, planDedupe, suggestFreeSlots } from './interview-slots.service.js';
import { evaluateCandidateAiScore } from './ai-scorer.js';

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

  // Đẩy Sheet NGAY để pull nền sau đó không hồi sinh lịch vừa xóa (fix zombie:
  // xóa trong bộ nhớ rồi pull đọc lại lịch cũ từ master trước khi full-sync nền chạy).
  try {
    await (repo as any).pushCandidatesNow?.();
  } catch { /* best-effort: tick sau thử lại */ }

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

/**
 * Tự động thi hành Kết Quả sàng lọc LOẠI (cột 15):
 *  ứng viên AI-chấm LOẠI mà còn NEW/NEED_INFO/INVITED -> REJECTED + xóa lịch PV
 *  + xóa thư mời (ẩn khỏi 2 danh sách, xem lại bằng bộ lọc). Chạy cùng tick dedupe.
 */
export async function enforceScreeningOutcomes(
  repo: ISheetsRepository,
  notifications: NotificationsService,
  actorId = 'SYSTEM'
): Promise<{ rejectedCount: number; names: string[] }> {
  const candidates = await repo.listCandidates().catch(() => []);
  const names: string[] = [];
  let rejectedCount = 0;
  for (const c of candidates as any[]) {
    if (!c || !['NEW', 'NEED_INFO', 'INVITED_INTERVIEW'].includes(String(c.status || ''))) continue;
    let loai = false;
    try {
      loai = evaluateCandidateAiScore(c).result === 'Loại';
    } catch {
      continue;
    }
    if (!loai) continue;
    try {
      await repo.updateCandidate(c.submission_id, {
        status: 'REJECTED',
        interview_date: undefined,
        interview_time_slot: undefined,
        interviewer_id: undefined,
        zalo_invite_status: undefined,
        zalo_uid: undefined,
        zalo_invite_at: undefined,
        zalo_invite_error: undefined,
      } as any);
      await repo.recordAuditLog({
        log_id: `LOG_${Date.now()}_${c.submission_id}`,
        actor_id: actorId,
        actor_role: 'SYSTEM',
        action: 'CANDIDATE_AUTO_REJECTED',
        target_entity: 'UNG_VIEN',
        target_id: c.submission_id,
        details: `Auto-rejected ${c.full_name} (AI screening LOAI); interview schedule cleared`,
      });
      names.push(String(c.full_name || c.submission_id));
      rejectedCount++;
    } catch {
      continue;
    }
  }
  if (rejectedCount > 0) {
    try {
      await (repo as any).pushCandidatesNow?.();
    } catch { /* tick sau thử lại */ }
    try {
      const ids = await hrAdminIds(repo);
      if (ids.length > 0) {
        await notifications.sendNotification({
          recipientIds: ids,
          type: 'CANDIDATES_AUTO_REJECTED',
          severity: 'SYSTEM',
          title: `🚫 Tự động loại ${rejectedCount} ứng viên (Kết Quả LOẠI)`,
          summary: `${names.slice(0, 10).join(', ')}${names.length > 10 ? ` (+${names.length - 10})` : ''} — đã xóa lịch PV, ẩn khỏi danh sách. Xem lại bằng bộ lọc "Đã loại".`,
          targetPath: '/hr-candidates',
          actorId: 'SYSTEM',
        }).catch(() => null);
      }
    } catch { /* best-effort */ }
  }
  return { rejectedCount, names };
}
