/**
 * Ràng buộc khung giờ phỏng vấn cố định 30 phút:
 *  - Mỗi lịch PV dài đúng 30 phút, giờ bắt đầu phải nằm trên lưới :00 / :30.
 *  - Hai lịch cùng ngày phải cách nhau tối thiểu 30 phút (không chồng lấn).
 *  - Giờ hành chính PV: 08:00–17:00 (giờ bắt đầu hợp lệ 08:00–16:30, giờ VN).
 *  Dùng chung cho backend (scheduleInterview, BOT Zalo) và tham chiếu ở frontend.
 */

export const INTERVIEW_SLOT_MINUTES = 30;
export const INTERVIEW_WORK_START = '08:00';
export const INTERVIEW_WORK_END = '17:00'; // ca cuối kết thúc 17:00 -> bắt đầu muộn nhất 16:30

export interface ParsedInterviewSlot {
  /** Giờ chuẩn hóa HH:mm */
  normalized: string;
  hours: number;
  minutes: number;
  /** Epoch ms giờ bắt đầu (giờ VN +07:00). */
  startMs: number;
  /** Epoch ms giờ kết thúc = start + 30 phút. */
  endMs: number;
}

export interface SlotConflict {
  submissionId: string;
  candidateName: string;
  timeSlot: string;
}

/** Tách giờ bắt đầu từ timeSlot tự do: 'HH:mm', 'H:mm', 'HH:mm - HH:mm', 'HH:mm - date'... */
export function parseSlotStart(input: unknown): { hours: number; minutes: number } | null {
  const m = String(input || '').match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

export function toHHmm(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function vnToday(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Validate ngày + giờ PV. Trả về lỗi TIẾNG VIỆT sẵn để hiển thị trực tiếp
 * (frontend/backend dùng chung câu chữ).
 */
export function validateInterviewSlot(
  dateInput: unknown,
  slotInput: unknown
): { ok: true; value: ParsedInterviewSlot } | { ok: false; error: string } {
  const date = String(dateInput || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: `Ngày phỏng vấn '${dateInput}' không hợp lệ (cần dạng YYYY-MM-DD)! Vui lòng chọn lại ngày.` };
  }
  const d = new Date(`${date}T00:00:00+07:00`).getTime();
  if (!Number.isFinite(d)) {
    return { ok: false, error: `Ngày phỏng vấn '${date}' không tồn tại trên lịch! Vui lòng chọn lại ngày.` };
  }
  if (date < vnToday()) {
    return { ok: false, error: `Ngày phỏng vấn ${date} đã qua! Vui lòng đăng ký lại vào ngày hôm nay trở đi.` };
  }
  const parsed = parseSlotStart(slotInput);
  if (!parsed) {
    return { ok: false, error: `Giờ phỏng vấn '${slotInput}' không hợp lệ! Khung cố định 30 phút — giờ phải dạng HH:mm (VD 08:00, 08:30, 09:00). Vui lòng đăng ký lại.` };
  }
  if (parsed.minutes !== 0 && parsed.minutes !== 30) {
    const normalized = toHHmm(parsed.hours, parsed.minutes);
    return {
      ok: false,
      error: `Giờ ${normalized} KHÔNG đúng khung cố định 30 phút! Mỗi bạn cách nhau 30 phút — phút phải là :00 hoặc :30 (VD 08:00, 08:30, 09:00). Vui lòng đăng ký lại.`,
    };
  }
  const startMin = parsed.hours * 60 + parsed.minutes;
  const workStart = toMinutes(INTERVIEW_WORK_START);
  const lastStart = toMinutes(INTERVIEW_WORK_END) - INTERVIEW_SLOT_MINUTES;
  if (startMin < workStart || startMin > lastStart) {
    return {
      ok: false,
      error: `Giờ ${toHHmm(parsed.hours, parsed.minutes)} ngoài giờ phỏng vấn (${INTERVIEW_WORK_START}–${INTERVIEW_WORK_END})! Giờ bắt đầu hợp lệ từ ${INTERVIEW_WORK_START} đến ${toHHmm(Math.floor(lastStart / 60), lastStart % 60)}. Vui lòng đăng ký lại.`,
    };
  }
  const normalized = toHHmm(parsed.hours, parsed.minutes);
  const startMs = new Date(`${date}T${normalized}:00+07:00`).getTime();
  if (!Number.isFinite(startMs)) {
    return { ok: false, error: `Không tính được mốc giờ ${normalized} ngày ${date}! Vui lòng đăng ký lại.` };
  }
  // Không cho đặt lịch đã qua giờ (trừ 5 phút dung sai thao tác).
  if (startMs + INTERVIEW_SLOT_MINUTES * 60_000 < Date.now() - 5 * 60_000) {
    return { ok: false, error: `Khung ${normalized} ngày ${date} đã qua giờ! Vui lòng đăng ký lại khung giờ khác.` };
  }
  return {
    ok: true,
    value: { normalized, hours: parsed.hours, minutes: parsed.minutes, startMs, endMs: startMs + INTERVIEW_SLOT_MINUTES * 60_000 },
  };
}

/** Mốc bắt đầu (ms, giờ VN) của 1 bản ghi ứng viên — null khi chưa xếp lịch. */
export function candidateInterviewStartMs(c: any): number | null {
  const d = String((c as any)?.interview_date || '').slice(0, 10);
  const parsed = parseSlotStart((c as any)?.interview_time_slot);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !parsed) return null;
  const t = new Date(`${d}T${toHHmm(parsed.hours, parsed.minutes)}:00+07:00`).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Tìm lịch cùng ngày cách < 30 phút (bỏ qua chính ứng viên đang xếp). */
export function findSlotConflict(
  candidates: any[],
  date: string,
  startMs: number,
  excludeSubmissionId?: string
): SlotConflict | null {
  for (const c of candidates || []) {
    if (!c || (excludeSubmissionId && (c as any).submission_id === excludeSubmissionId)) continue;
    if (String((c as any).interview_date || '').slice(0, 10) !== date) continue;
    const st = candidateInterviewStartMs(c);
    if (st === null) continue;
    if (Math.abs(st - startMs) < INTERVIEW_SLOT_MINUTES * 60_000) {
      return {
        submissionId: String((c as any).submission_id || ''),
        candidateName: String((c as any).full_name || 'ứng viên khác'),
        timeSlot: String((c as any).interview_time_slot || '').slice(0, 5),
      };
    }
  }
  return null;
}

/** Gợi ý các khung trống cùng ngày (08:00–16:30, bước 30 phút, loại khung đã kẹt). */
export function suggestFreeSlots(candidates: any[], date: string, limit = 5, excludeSubmissionId?: string): string[] {
  const taken: number[] = [];
  for (const c of candidates || []) {
    if (!c || (excludeSubmissionId && (c as any).submission_id === excludeSubmissionId)) continue;
    if (String((c as any).interview_date || '').slice(0, 10) !== date) continue;
    const st = candidateInterviewStartMs(c);
    if (st !== null) taken.push(st);
  }
  const out: string[] = [];
  const lastStart = toMinutes(INTERVIEW_WORK_END) - INTERVIEW_SLOT_MINUTES;
  for (let m = toMinutes(INTERVIEW_WORK_START); m <= lastStart; m += INTERVIEW_SLOT_MINUTES) {
    const hhmm = toHHmm(Math.floor(m / 60), m % 60);
    const startMs = new Date(`${date}T${hhmm}:00+07:00`).getTime();
    if (!Number.isFinite(startMs)) continue;
    if (startMs + INTERVIEW_SLOT_MINUTES * 60_000 < Date.now() - 5 * 60_000) continue; // khung đã qua
    if (taken.some(t => Math.abs(t - startMs) < INTERVIEW_SLOT_MINUTES * 60_000)) continue;
    out.push(hhmm);
    if (out.length >= limit) break;
  }
  return out;
}

/** Câu lỗi trùng lịch + gợi ý khung thay thế, sẵn hiển thị cho HR. */
export function buildConflictMessage(conflict: SlotConflict, date: string, suggestions: string[]): string {
  const sugg = suggestions.length > 0 ? ` Khung trống cùng ngày ${date}: ${suggestions.join(', ')}. Vui lòng đăng ký lại!` : ' Vui lòng đăng ký lại khung giờ khác!';
  return `TRÙNG LỊCH PV: ${conflict.timeSlot || ''} ngày ${date} đã có ${conflict.candidateName} (mỗi bạn cách nhau 30 phút)!${sugg}`;
}

export interface DedupeRemoval {
  submissionId: string;
  candidateName: string;
  date: string;
  timeSlot: string;
  /** Lịch được giữ lại gây kẹt (đăng ký trước / giờ sớm hơn). */
  keptSubmissionId: string;
  keptCandidateName: string;
  keptTimeSlot: string;
}

export interface DedupePlan {
  date: string;
  scanned: number;
  kept: number;
  removed: DedupeRemoval[];
}

/**
 * Rà soát toàn bộ lịch PV đã đăng ký, lập kế hoạch xóa lịch trùng:
 *  - Chỉ xét lịch SẮP TỚI (chưa diễn ra) của ứng viên đang chờ PV (INVITED_INTERVIEW).
 *  - Cùng ngày, sắp xếp theo giờ rồi giữ lịch đầu, xóa các lịch kẹt < 30 phút
 *    (đồng giờ thì giữ hồ sơ tạo trước).
 *  - Lịch đã qua / đã PV xong (INTERVIEWED...) không đụng tới.
 *  Thuần tính toán (không ghi DB) — service dedupe sẽ thực thi + thông báo.
 */
export function planDedupe(candidates: any[], nowMs: number = Date.now()): DedupePlan[] {
  const upcoming = (candidates || [])
    .map(c => {
      if (!c || (c as any).status !== 'INVITED_INTERVIEW') return null;
      const d = String((c as any).interview_date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
      const st = candidateInterviewStartMs(c);
      if (st === null) return null;
      if (st + INTERVIEW_SLOT_MINUTES * 60_000 < nowMs - 5 * 60_000) return null; // đã diễn ra
      return { c, d, st };
    })
    .filter((x): x is { c: any; d: string; st: number } => x !== null);

  const byDate = new Map<string, { c: any; d: string; st: number }[]>();
  for (const item of upcoming) {
    const arr = byDate.get(item.d) || [];
    arr.push(item);
    byDate.set(item.d, arr);
  }

  const plans: DedupePlan[] = [];
  for (const [date, items] of byDate) {
    items.sort((a, b) => a.st - b.st || String(a.c.created_at || '').localeCompare(String(b.c.created_at || '')) || String(a.c.submission_id || '').localeCompare(String(b.c.submission_id || '')));
    const kept: { c: any; st: number }[] = [];
    const removed: DedupeRemoval[] = [];
    for (const item of items) {
      const clash = kept.find(k => Math.abs(k.st - item.st) < INTERVIEW_SLOT_MINUTES * 60_000);
      if (clash) {
        removed.push({
          submissionId: String(item.c.submission_id || ''),
          candidateName: String(item.c.full_name || 'ứng viên'),
          date,
          timeSlot: String(item.c.interview_time_slot || '').slice(0, 5),
          keptSubmissionId: String(clash.c.submission_id || ''),
          keptCandidateName: String(clash.c.full_name || 'ứng viên khác'),
          keptTimeSlot: String(clash.c.interview_time_slot || '').slice(0, 5),
        });
      } else {
        kept.push({ c: item.c, st: item.st });
      }
    }
    if (removed.length > 0) {
      plans.push({ date, scanned: items.length, kept: kept.length, removed });
    }
  }
  return plans.sort((a, b) => a.date.localeCompare(b.date));
}
