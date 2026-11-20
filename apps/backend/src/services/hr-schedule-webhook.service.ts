/**
 * Đồng bộ LỊCH LÀM VIỆC sang Web App thứ 3 (AIS workspace) qua webhook.
 *
 * Mỗi khi HR/Admin lưu – sửa – xoá ca, duyệt nghỉ hoặc đăng ký OFF, backend gọi
 * `POST <HR_SCHEDULE_WEBHOOK_URL>` với header `x-hr-secret` và payload:
 *   { employeeId, fullName, email, shift, active }
 * trong đó `shift` dạng "HH:MM - HH:MM" (giờ Việt Nam) và `active` cho biết
 * nhân viên còn ca làm / đang nghỉ.
 *
 * Nguyên tắc an toàn:
 *  - Chỉ chạy khi đã cấu hình URL + secret; thiếu cấu hình thì bỏ qua im lặng.
 *  - Không bao giờ throw: lỗi webhook không được làm hỏng thao tác lưu ca.
 *  - Có timeout + 1 lần thử lại cho lỗi mạng/5xx.
 *  - Không log secret.
 */
import { resolveShiftTemplate } from '@ubm/shared';
import type { ISheetsRepository } from '../repositories/sheets.interface.js';

const VN_OFFSET_MS = 7 * 3_600_000;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface HrScheduleWebhookPayload {
  employeeId: string;
  fullName: string;
  email: string;
  /** Ví dụ "08:00 - 17:30" hoặc "07:00 - 11:00, 15:00 - 19:00". */
  shift: string;
  /** true = còn ca làm; false = nghỉ ca / nghỉ phép. */
  active: boolean;
}

function webhookConfig() {
  const url = String(process.env.HR_SCHEDULE_WEBHOOK_URL || '').trim();
  const secret = String(process.env.HR_SCHEDULE_WEBHOOK_SECRET || '').trim();
  const enabledFlag = String(process.env.HR_SCHEDULE_WEBHOOK_ENABLED ?? '1').trim().toLowerCase();
  const enabled = enabledFlag !== '0' && enabledFlag !== 'false' && !!url && !!secret;
  return { url, secret, enabled };
}

export function isHrScheduleWebhookEnabled(): boolean {
  return webhookConfig().enabled;
}

/** Parse mốc thời gian; chuỗi không có timezone được hiểu là giờ Việt Nam. */
function parseTime(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1');
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const ms = Date.parse(hasTimezone ? normalized : `${normalized}+07:00`);
  return Number.isFinite(ms) ? ms : null;
}

function vnHHMM(ms: number): string {
  const d = new Date(ms + VN_OFFSET_MS);
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** Mốc giờ vào/ra từ mẫu ca khi dữ liệu ca thiếu start_at/end_at. */
function templateWindow(date: string, shiftCode: string, group?: unknown): { startMs: number; endMs: number } | null {
  const tpl = resolveShiftTemplate(shiftCode, group);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || '').slice(0, 10));
  if (!tpl || !m) return null;
  const y = Number(m[1]);
  const mon = Number(m[2]) - 1;
  const d = Number(m[3]);
  return {
    startMs: Date.UTC(y, mon, d, tpl.start_hour, tpl.start_minute) - VN_OFFSET_MS,
    endMs: Date.UTC(y, mon, d, tpl.end_hour, tpl.end_minute) - VN_OFFSET_MS,
  };
}

/** "07:00 - 11:00" của 1 ca (theo giờ Việt Nam). */
export function formatShiftRange(assignment: any, group?: unknown): string {
  if (!assignment) return '';
  const code = String(assignment.shift_code || '').toUpperCase();
  const date = String(assignment.date || assignment.start_at || assignment.end_at || '').slice(0, 10);
  const tpl = templateWindow(date, code, group);
  const startMs = parseTime(assignment.start_at) ?? tpl?.startMs ?? null;
  const endMs = parseTime(assignment.end_at) ?? tpl?.endMs ?? null;
  if (startMs === null || endMs === null) return '';
  return `${vnHHMM(startMs)} - ${vnHHMM(endMs)}`;
}

function formatShiftList(shifts: any[], group?: unknown): string {
  const ranges = (shifts || [])
    .filter((s) => String(s?.status || '').toUpperCase() !== 'CANCELLED')
    .map((s) => ({ s, text: formatShiftRange(s, group) }))
    .filter((x) => !!x.text)
    .sort((a, b) => {
      const at = parseTime(a.s.start_at) ?? 0;
      const bt = parseTime(b.s.start_at) ?? 0;
      return at - bt;
    })
    .map((x) => x.text);
  // Ca trùng giờ (nhiều dòng lỗi) chỉ gửi 1 lần.
  return Array.from(new Set(ranges)).join(', ');
}

async function postOnce(url: string, secret: string, payload: HrScheduleWebhookPayload, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hr-secret': secret,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok) {
      console.warn(
        `[HRScheduleWebhook] HTTP ${res.status} cho ${payload.employeeId}: ${text.slice(0, 240)}`
      );
      return false;
    }
    // URL AI Studio (ais-dev-*.run.app) trả trang HTML "Cookie check" với HTTP 200
    // khi chưa đăng nhập Google → coi là THẤT BẠI thay vì im lặng báo thành công.
    if (contentType.includes('text/html') || text.trimStart().startsWith('<')) {
      console.warn(
        `[HRScheduleWebhook] Endpoint trả HTML (không phải JSON) cho ${payload.employeeId} — ` +
          'có thể URL đang nằm sau cổng đăng nhập Google AI Studio, không gọi được từ server.'
      );
      return false;
    }
    return true;
  } catch (err: any) {
    const msg = err?.name === 'AbortError' ? `quá ${timeoutMs}ms` : (err?.message || String(err));
    console.warn(`[HRScheduleWebhook] Gửi thất bại cho ${payload.employeeId}: ${msg}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Gửi 1 payload; trả false nếu chưa cấu hình hoặc lỗi (không throw). */
export async function sendHrScheduleWebhook(payload: HrScheduleWebhookPayload): Promise<boolean> {
  const { url, secret, enabled } = webhookConfig();
  if (!enabled || !payload?.employeeId) return false;
  const timeoutMs = Math.max(3_000, Number(process.env.HR_SCHEDULE_WEBHOOK_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const body: HrScheduleWebhookPayload = {
    employeeId: String(payload.employeeId),
    fullName: String(payload.fullName || ''),
    email: String(payload.email || ''),
    shift: String(payload.shift || ''),
    active: !!payload.active,
  };
  // Lần 1 + 1 lần thử lại cho lỗi mạng/5xx.
  if (await postOnce(url, secret, body, timeoutMs)) return true;
  return postOnce(url, secret, body, timeoutMs);
}

export interface NotifyDayOptions {
  /** Ép trạng thái; bỏ trống = tự suy từ số ca còn live trong ngày. */
  active?: boolean;
  /** Ca vừa xoá/huỷ — dùng làm giờ dự phòng khi ngày đó không còn ca nào. */
  fallbackAssignment?: any;
  fallbackShift?: string;
}

/**
 * Gửi lịch của 1 nhân viên trong 1 ngày sang webhook.
 *
 * - `shift` = toàn bộ ca còn hiệu lực trong ngày (ghép "07:00 - 11:00, ...").
 * - `active` = còn ít nhất 1 ca (trừ khi caller ép).
 * - Ngày không còn ca → dùng `fallbackAssignment`/`fallbackShift` để phía nhận
 *   biết ca nào vừa bị huỷ.
 */
export class HrScheduleWebhookService {
  constructor(private repo: ISheetsRepository) {}

  async notifyDay(employeeId: string, date: string, opts: NotifyDayOptions = {}): Promise<boolean> {
    if (!isHrScheduleWebhookEnabled() || !employeeId) return false;
    try {
      const emp: any = await this.repo.getEmployeeById(employeeId).catch(() => null);
      if (!emp) return false;
      const day = String(date || '').slice(0, 10);
      const shifts = day
        ? await this.repo.getShiftsForEmployee(employeeId, day, day).catch(() => [])
        : [];
      const group = emp?.group;
      const live = (shifts || []).filter((s: any) => String(s?.status || '').toUpperCase() !== 'CANCELLED');
      const shiftText = formatShiftList(live, group)
        || (opts.fallbackAssignment ? formatShiftRange(opts.fallbackAssignment, group) : '')
        || String(opts.fallbackShift || '');
      const active = opts.active !== undefined ? !!opts.active : live.length > 0;
      return await sendHrScheduleWebhook({
        employeeId,
        fullName: String(emp.full_name || ''),
        email: String(emp.email || ''),
        shift: shiftText,
        active,
      });
    } catch (err: any) {
      console.warn(`[HRScheduleWebhook] Bỏ qua lỗi khi chuẩn bị dữ liệu ${employeeId}: ${err?.message || err}`);
      return false;
    }
  }

  /** Gửi theo 1 ca vừa tạo/sửa/xoá. */
  async notifyAssignment(assignment: any, active: boolean): Promise<boolean> {
    const employeeId = String(assignment?.employee_id || '').trim();
    const date = String(assignment?.date || '').slice(0, 10);
    if (!employeeId || !date) return false;
    return this.notifyDay(employeeId, date, { active, fallbackAssignment: assignment });
  }
}
