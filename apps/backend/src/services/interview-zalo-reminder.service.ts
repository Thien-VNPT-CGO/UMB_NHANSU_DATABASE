import { BRANCHES } from '@ubm/shared';
import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { ZaloService, defaultMeetUrl } from './zalo.service.js';
import { candidateInterviewStartMs } from './interview-slots.service.js';

/**
 * TỰ NHẮC ZALO TRƯỚC GIỜ PHỎNG VẤN 30 PHÚT.
 *
 * Vì sao cần: ứng viên đã xác nhận (hoặc vừa được chốt lịch theo đề xuất) nhưng
 * vẫn có thể quên/đổi ý. Trước giờ hẹn 30 phút hệ thống gửi lại thư mời kèm
 * link RSVP để ứng viên xác nhận lại lần cuối — nếu không đến HR bấm "Hủy PV"
 * và ứng viên vào thẳng danh sách đen.
 *
 * Chống gửi lặp: `interview_reminder_at` lưu khóa `YYYY-MM-DD|HH:mm` của lịch
 * đã nhắc. Đổi lịch -> khóa đổi -> tự nhắc lại cho lịch mới.
 */

export const ZALO_INTERVIEW_REMIND_MINUTES = 30;

/** Khóa chống gửi lặp theo đúng lịch hiện tại. */
export function reminderKeyOf(date: string, timeSlot: string): string {
  return `${String(date || '').slice(0, 10)}|${String(timeSlot || '').slice(0, 5)}`;
}

export interface ZaloReminderSent {
  submissionId: string;
  candidateName: string;
  date: string;
  timeSlot: string;
  minutesLeft: number;
}

export interface ZaloReminderResult {
  sent: ZaloReminderSent[];
  skipped: Array<{ submissionId: string; reason: string }>;
}

const normalizeText = (s: unknown) => String(s ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[đĐ]/g, 'd').replace(/\s+/g, ' ').trim().toLowerCase();

/** Nhãn chi nhánh đầy đủ (tên + địa chỉ) để thư nhắc Zalo không chỉ hiện "CN2". */
async function fullBranchLabel(repo: ISheetsRepository, raw: unknown): Promise<string> {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  let list: any[] = [];
  try { list = ((await repo.getBranches().catch(() => [])) || []) as any[]; } catch { list = []; }
  const pool: any[] = [...(list || []), ...(BRANCHES as any[])];
  const codeMatch = value.toUpperCase().match(/CN\s*(\d+)/);
  const wanted = codeMatch ? `CN${codeMatch[1]}` : value.toUpperCase().replace(/\s+/g, '');
  const nv = normalizeText(value);
  const match = pool.find((b: any) => {
    const id = String(b?.id || b?.branch_id || '').toUpperCase().replace(/\s+/g, '');
    if (id && wanted && id === wanted) return true;
    const name = normalizeText(b?.name);
    const addr = normalizeText(b?.address);
    return (!!name && (name === nv || name.includes(nv) || nv.includes(name))) || (!!addr && addr === nv);
  });
  if (!match) return value;
  const name = String(match?.name || '').trim();
  const address = String(match?.address || '').trim();
  if (name && address) return `${name} — ${address}`;
  return name || address || value;
}

export async function interviewZaloReminderTick(
  repo: ISheetsRepository,
  zalo: ZaloService,
  opts: { buildRsvpUrl: (submissionId: string) => string; nowMs?: number }
): Promise<ZaloReminderResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const out: ZaloReminderResult = { sent: [], skipped: [] };

  // BOT Zalo chưa đăng nhập -> bỏ qua lượt này (lượt sau gửi bù, chưa đánh dấu đã nhắc).
  if (!zalo.isConnected()) return out;

  const list = (await repo.listCandidates().catch(() => [])) as any[];
  for (const c of list) {
    try {
      const st = String(c?.status || '');
      if (!['INVITED_INTERVIEW', 'CONFIRMED'].includes(st)) continue;
      const date = String(c?.interview_date || '').slice(0, 10);
      const timeSlot = String(c?.interview_time_slot || '').slice(0, 5);
      const key = reminderKeyOf(date, timeSlot);
      if (c?.interview_reminder_at === key) continue; // đã nhắc cho đúng lịch này
      const startMs = candidateInterviewStartMs(c);
      if (startMs === null) continue;
      const diff = startMs - nowMs;
      if (diff <= 0 || diff > ZALO_INTERVIEW_REMIND_MINUTES * 60_000) continue;

      const phone = String(c?.phone_normalized || c?.phone || '').replace(/\D/g, '');
      if (!phone) { out.skipped.push({ submissionId: c.submission_id, reason: 'NO_PHONE' }); continue; }

      const found = await zalo.findUserByPhone(phone).catch(() => null);
      if (!found?.uid) { out.skipped.push({ submissionId: c.submission_id, reason: 'ZALO_NOT_FOUND' }); continue; }

      const branchName = await fullBranchLabel(repo, c?.branch_name || c?.preferred_branch_id);
      const minutesLeft = Math.max(1, Math.ceil(diff / 60_000));
      const text = [
        `⏰ [ỤM BÒ MILK] NHẮC LỊCH PHỎNG VẤN — CÒN ${minutesLeft} PHÚT`,
        `Chào bạn ${String(c?.full_name || '')},`,
        `Buổi phỏng vấn của bạn sẽ bắt đầu sau ${minutesLeft} phút:`,
        `🕒 Thời gian: ${timeSlot} - ${date.split('-').reverse().join('/')}`,
        `📍 Chi nhánh tuyển dụng: ${branchName || 'sẽ báo khi xác nhận'}`,
      ];
      const meet = c?.interview_mode === 'OFFLINE' ? '' : defaultMeetUrl();
      if (meet) text.push(`🔗 Phòng họp Google Meet: ${meet}`);
      else text.push('📌 Hình thức: Trực tiếp tại cửa hàng — bạn đến trước 5 phút nhé.');
      text.push('✅ Bạn vẫn tham gia chứ? Bấm xác nhận lại tại đây (không cần đăng nhập):');
      text.push(opts.buildRsvpUrl(String(c.submission_id)));
      text.push('📌 Nếu không xác nhận và không đến đúng giờ, HR sẽ hủy lịch và hồ sơ được ghi nhận vi phạm quy chế tuyển dụng.');

      await zalo.sendText(found.uid, text.join('\n'));
      await repo.updateCandidate(String(c.submission_id), { interview_reminder_at: key } as any);
      out.sent.push({
        submissionId: String(c.submission_id),
        candidateName: String(c?.full_name || ''),
        date,
        timeSlot,
        minutesLeft,
      });
    } catch (e: any) {
      out.skipped.push({ submissionId: String(c?.submission_id || ''), reason: String(e?.message || 'SEND_FAILED') });
    }
  }
  return out;
}
