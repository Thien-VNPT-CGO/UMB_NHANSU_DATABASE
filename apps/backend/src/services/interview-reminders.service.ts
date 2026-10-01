import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { NotificationsService } from './notifications.service.js';
import { candidateInterviewStartMs } from './interview-slots.service.js';

/**
 * Nhắc HR trước giờ phỏng vấn 15 phút (tick mỗi 60s từ server.ts):
 *  - Ứng viên INVITED_INTERVIEW có lịch sắp tới trong (0, 15 phút] -> báo HR/Admin
 *    qua inbox (bền vững) — server.ts bắn thêm socket system:notification để popup ngay.
 *  - Chống spam: 1 lần / 1 lịch (key ngày|submission), reset theo ngày VN.
 */

export const INTERVIEW_REMIND_MINUTES = 15;

export interface InterviewReminder {
  submissionId: string;
  candidateName: string;
  date: string;
  timeSlot: string;
  minutesLeft: number;
}

const reminded = new Set<string>();
let remindedDay = '';

function vnDay(nowMs: number): string {
  return new Date(nowMs + 7 * 3_600_000).toISOString().slice(0, 10);
}

async function hrAdminIds(repo: ISheetsRepository): Promise<string[]> {
  try {
    const admins = await repo.listAdminAccounts();
    return admins.filter(a => (a.role === 'ADMIN' || a.role === 'HR') && a.is_active !== false).map(a => a.admin_id);
  } catch {
    return [];
  }
}

export async function interviewReminderTick(
  repo: ISheetsRepository,
  notifications: NotificationsService,
  nowMs: number = Date.now()
): Promise<{ reminded: InterviewReminder[] }> {
  const today = vnDay(nowMs);
  if (remindedDay !== today) {
    remindedDay = today;
    reminded.clear();
  }
  const candidates = await repo.listCandidates().catch(() => []);
  const due: InterviewReminder[] = [];
  for (const c of candidates as any[]) {
    if (!c || c.status !== 'INVITED_INTERVIEW') continue;
    const d = String(c.interview_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const st = candidateInterviewStartMs(c);
    if (st === null) continue;
    const diff = st - nowMs;
    if (diff <= 0 || diff > INTERVIEW_REMIND_MINUTES * 60_000) continue;
    const key = `${d}|${c.submission_id}`;
    if (reminded.has(key)) continue;
    reminded.add(key);
    due.push({
      submissionId: String(c.submission_id || ''),
      candidateName: String(c.full_name || 'ứng viên'),
      date: d,
      timeSlot: String(c.interview_time_slot || '').slice(0, 5),
      minutesLeft: Math.max(1, Math.ceil(diff / 60_000)),
    });
  }
  if (due.length > 0) {
    try {
      const ids = await hrAdminIds(repo);
      if (ids.length > 0) {
        for (const r of due) {
          await notifications.sendNotification({
            recipientIds: ids,
            type: 'INTERVIEW_UPCOMING',
            severity: 'ACTION_REQUIRED',
            title: `⏰ Sắp tới giờ PV: ${r.candidateName} (${r.timeSlot} — còn ${r.minutesLeft} phút)`,
            summary: `${r.candidateName} phỏng vấn lúc ${r.timeSlot} ngày ${r.date}. HR chuẩn bị vào Meet trước 5 phút!`,
            targetPath: '/hr-interviews',
            actorId: 'SYSTEM',
          }).catch(() => null);
        }
      }
    } catch { /* best-effort */ }
  }
  return { reminded: due };
}
