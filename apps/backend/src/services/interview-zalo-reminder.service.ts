import { BRANCHES } from '@ubm/shared';
import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { ZaloService, defaultMeetUrl } from './zalo.service.js';
import { candidateInterviewStartMs } from './interview-slots.service.js';

/**
 * TỰ NHẮC ZALO TRƯỚC GIỜ PHỎNG VẤN — TỐI ĐA 3 LẦN, CÁCH NHAU 15 PHÚT.
 *
 * Vì sao cần: ứng viên đã được xếp lịch nhưng vẫn có thể quên/đổi ý. Bắt đầu
 * từ trước giờ hẹn 45 phút, hệ thống gửi thư nhắc kèm link RSVP; mỗi tin cách
 * nhau ít nhất 15 phút và chỉ gửi tối đa 3 lần (T-45, T-30, T-15).
 *
 * Chống spam:
 *  - Chỉ nhắc khi ứng viên còn ở trạng thái INVITED_INTERVIEW. Ứng viên đã
 *    XÁC NHẬN / TỪ CHỐI / xin dời lịch -> dừng ngay, không gửi thêm.
 *  - `interview_reminder_key` giữ khóa lịch `YYYY-MM-DD|HH:mm`, kèm
 *    `interview_reminder_count` (số lần đã nhắc) và `interview_reminder_at`
 *    (mốc gửi gần nhất). Đổi lịch -> khóa đổi -> đếm lại từ đầu.
 *  - Các trường này phải được giữ qua mỗi lượt pull Google Sheets (xem
 *    google-sheets-sync.service.ts); nếu mất, tick 60s sẽ gửi lặp vô hạn.
 */

/** Bắt đầu chuỗi nhắc trước giờ hẹn 45 phút (đủ chỗ cho 3 lần × 15 phút). */
export const ZALO_INTERVIEW_REMIND_WINDOW_MINUTES = 45;
/** Khoảng cách tối thiểu giữa 2 lần nhắc. */
export const ZALO_INTERVIEW_REMIND_INTERVAL_MINUTES = 15;
/** Số lần nhắc tối đa cho mỗi lịch PV. */
export const ZALO_INTERVIEW_REMIND_MAX_ATTEMPTS = 3;

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
      // Ứng viên đã xác nhận/từ chối (hoặc xin dời lịch, vắng, blacklist...):
      // không nhắc nữa. Chỉ nhắc khi vẫn đang chờ phản hồi.
      if (st !== 'INVITED_INTERVIEW') continue;
      const date = String(c?.interview_date || '').slice(0, 10);
      const timeSlot = String(c?.interview_time_slot || '').slice(0, 5);
      const key = reminderKeyOf(date, timeSlot);

      // Đếm số lần đã nhắc cho ĐÚNG lịch này. Đổi lịch (key khác) -> reset.
      const storedKey = String((c as any)?.interview_reminder_key || '');
      const sameSchedule = storedKey === key;
      const sentCount = sameSchedule ? Math.max(0, Number((c as any)?.interview_reminder_count) || 0) : 0;
      const lastSentMs = sameSchedule ? Date.parse(String((c as any)?.interview_reminder_at || '')) : NaN;
      if (sentCount >= ZALO_INTERVIEW_REMIND_MAX_ATTEMPTS) continue;
      if (Number.isFinite(lastSentMs)
        && nowMs - lastSentMs < ZALO_INTERVIEW_REMIND_INTERVAL_MINUTES * 60_000) continue;

      const startMs = candidateInterviewStartMs(c);
      if (startMs === null) continue;
      const diff = startMs - nowMs;
      if (diff <= 0 || diff > ZALO_INTERVIEW_REMIND_WINDOW_MINUTES * 60_000) continue;

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
      await repo.updateCandidate(String(c.submission_id), {
        interview_reminder_key: key,
        interview_reminder_count: sentCount + 1,
        interview_reminder_at: new Date(nowMs).toISOString(),
      } as any);
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
