import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { NotificationsService } from './notifications.service.js';
import { ZaloService } from './zalo.service.js';
import { OfficeService } from './office.service.js';
import { normSheetDate } from './employees.service.js';
import { formatHm, isSaleGroup, officeCheckInWindowOf, officeDayRuleOfIso, shiftLabel, shiftTemplatesForGroup } from '@ubm/shared';
import { parseUniform, uniformRefundMilestoneDate, uniformRefundTotal } from '../utils/uniform.js';

/**
 * Nhắc việc tự động (chạy mỗi 5 phút từ server.ts):
 *  1. Nhắc check-in (in-app + Zalo) đúng chi nhánh – ca làm cho MỌI khối:
 *     - Cửa hàng / Xưởng / Sale: chỉ nhắc NV có ca PUBLISHED hôm đó, mỗi ca 1 lần.
 *     - Sale: nhắc điểm danh nhưng không nhắc áo hồng/bảng tên.
 *     - Văn phòng: nhắc theo đúng khung điểm danh hành chính 08:00–08:30.
 *     Khử trùng theo assignment (1 ca = 1 thông báo), lưu latch để restart không gửi lặp.
 *  2. Nhắc HR/Admin (in-app): NV chưa đổi PIN khởi tạo quá 3 ngày.
 *  3. Nhắc HR/Admin (in-app): đơn chờ duyệt quá 24h (nghỉ/đổi ca/bổ sung công).
 *  4. Nhắc hoàn thành thử việc (in-app): NV hết hạn hôm nay / còn ≤2 ngày
 *     (ngày hoàn thành = start_date + 11) + báo chính NV đó trong ngày cuối.
 *  5. Nhắc HR (in-app) hoàn tiền đồng phục + hỗ trợ KSK khi NV chính thức đủ
 *     6 tháng kể từ ngày nhận đồng phục — nhắc trước 1 ngày.
 * Chống spam bằng cờ theo ngày trong bộ nhớ.
 */

const DAY_MS = 86_400_000;

function tzOffsetHours(): number {
  const raw = Number(process.env.WEEKLY_OFF_TZ_OFFSET_HOURS);
  return Number.isFinite(raw) && raw !== 0 ? raw : 7;
}

function vnNow(now: Date = new Date()): Date {
  return new Date(now.getTime() + tzOffsetHours() * 3_600_000);
}

function vnDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export interface ShiftDefinition {
  code: string;
  name: string;
  start: string;
  end: string;
  startHour: number;
}

export const SHIFT_DEFINITIONS: Record<string, ShiftDefinition> = {
  CA_1: { code: 'CA_1', name: 'Ca 1 (07:00 - 12:00)', start: '07:00', end: '12:00', startHour: 7 },
  CA_2: { code: 'CA_2', name: 'Ca 2 (12:00 - 18:00)', start: '12:00', end: '18:00', startHour: 12 },
  CA_3: { code: 'CA_3', name: 'Ca 3 (18:00 - 23:00)', start: '18:00', end: '23:00', startHour: 18 },
  CA_4: { code: 'CA_4', name: 'Ca 4 (19:00 - 23:00)', start: '19:00', end: '23:00', startHour: 19 },
};

/** Format giờ theo múi giờ Việt Nam (Asia/Ho_Chi_Minh, UTC+7) */
export function formatVnTime(epochMs: number): string {
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(epochMs));
  } catch {
    const d = new Date(epochMs + tzOffsetHours() * 3_600_000);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
}

/**
 * Lấy thông tin hiển thị ca chuẩn xác (Tên ca, Giờ bắt đầu).
 * `opts.isOffice` dùng lịch hành chính thật (08:00–17:00 / 08:00–12:00) thay
 * vì mã ca CA_1 (07:00) — ca Văn Phòng lưu mã CA_1 nhưng bắt đầu 08:00.
 */
export function resolveShiftInfo(
  shiftCode?: string,
  startMs?: number | null,
  opts?: { isOffice?: boolean; date?: string; group?: string },
): { name: string; start: string; end?: string } {
  const actualStart = startMs ? formatVnTime(startMs) : '';
  if (opts?.isOffice) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.date || ''))
      ? String(opts.date).slice(0, 10)
      : new Date((startMs || Date.now()) + tzOffsetHours() * 3_600_000).toISOString().slice(0, 10);
    const rule = officeDayRuleOfIso(date);
    const start = formatHm(rule.startHour, rule.startMinute);
    const end = formatHm(rule.endHour, rule.endMinute);
    return { name: `Ca hành chính (${start} – ${end})`, start, end };
  }
  // Mẫu ca theo khối: Sale có 4 ca 07–11/11–15/15–19/19–23.
  const tpl = shiftCode ? shiftTemplatesForGroup(opts?.group)[String(shiftCode).toUpperCase()] : undefined;
  if (tpl) {
    const p = (n: number) => String(n).padStart(2, '0');
    return {
      name: shiftLabel(shiftCode, opts?.group),
      start: actualStart || `${p(tpl.start_hour)}:${p(tpl.start_minute)}`,
      end: `${p(tpl.end_hour)}:${p(tpl.end_minute)}`,
    };
  }
  if (shiftCode && SHIFT_DEFINITIONS[shiftCode]) {
    return {
      name: SHIFT_DEFINITIONS[shiftCode].name,
      start: actualStart || SHIFT_DEFINITIONS[shiftCode].start,
      end: SHIFT_DEFINITIONS[shiftCode].end,
    };
  }
  return {
    name: shiftCode || 'Ca làm việc',
    start: actualStart || '07:00',
  };
}

/**
 * Parse giờ bắt đầu ca. `start_at` là giờ THẬT của ca (cổng điểm danh mở theo
 * mốc này — xem POST /attendance/checkin), nên ưu tiên start_at; chỉ fallback
 * theo mã ca khi ca cũ thiếu/không đọc được start_at.
 *
 * Trước đây ưu tiên mã ca khiến ca Văn Phòng (mã CA_1 nhưng start_at 08:00)
 * bị nhắc lúc 07:00 — sai khung điểm danh 08:00–08:30.
 */
export function parseShiftStart(date: string, startAt?: string, shiftCode?: string, group?: string): number | null {
  if (startAt) {
    try {
      const s = String(startAt).trim();
      // Nếu có Z hoặc offset (+07:00, ...) -> parse tuyệt đối
      if (s.includes('Z') || /[+-]\d{2}:\d{2}$/.test(s)) {
        const t = new Date(s).getTime();
        if (Number.isFinite(t)) return t;
      }
      // Nếu là giờ HH:mm hoặc HH:mm:ss theo giờ VN
      const m = s.match(/(?:T|\s|^)(\d{1,2}):(\d{2})/);
      if (m) {
        const hh = m[1].padStart(2, '0');
        const mm = m[2];
        const t = Date.parse(`${date}T${hh}:${mm}:00Z`);
        if (Number.isFinite(t)) return t - tzOffsetHours() * 3_600_000;
      }
      const t = new Date(s).getTime();
      if (Number.isFinite(t)) return t;
    } catch {}
  }
  // Fallback: ca cũ không có start_at -> căn theo mẫu ca đúng khối (giờ VN).
  const tpl = shiftCode ? shiftTemplatesForGroup(group)[String(shiftCode).toUpperCase()] : undefined;
  if (tpl) {
    const t = Date.parse(`${String(date).slice(0, 10)}T${String(tpl.start_hour).padStart(2, '0')}:${String(tpl.start_minute).padStart(2, '0')}:00Z`);
    if (Number.isFinite(t)) return t - tzOffsetHours() * 3_600_000;
  }
  if (shiftCode && SHIFT_DEFINITIONS[shiftCode]) {
    const h = SHIFT_DEFINITIONS[shiftCode].startHour;
    const t = Date.parse(`${String(date).slice(0, 10)}T${String(h).padStart(2, '0')}:00:00Z`);
    if (Number.isFinite(t)) return t - tzOffsetHours() * 3_600_000;
  }
  return null;
}

const remindedCheckin = new Set<string>(); // `${date}:${assignment_id || employee+shift}`
const notifiedDaily = new Set<string>(); // `${date}:${kind}`
let notifiedDay = '';
/** Đang chạy 1 lượt tick (chặn 2 lượt chồng nhau gửi trùng). */
let tickInFlight = false;

/** Latch bền vững: 1 ca chỉ nhắc 1 lần, kể cả khi server restart giữa cửa sổ nhắc. */
const CHECKIN_REMINDER_LATCH_KEY = 'checkin_reminder_latch';
let checkinLatchLoadedFor = '';

function resetDaily(nowDay: string) {
  if (notifiedDay !== nowDay) {
    notifiedDay = nowDay;
    remindedCheckin.clear();
    notifiedDaily.clear();
    // Ngày mới: phải đọc lại latch của ngày mới từ CAU_HINH_HE_THONG.
    checkinLatchLoadedFor = '';
  }
}

/** Nạp latch nhắc check-in của hôm nay (chỉ đọc 1 lần/ngày cho mỗi process). */
async function ensureCheckinLatch(repo: ISheetsRepository, today: string) {
  if (checkinLatchLoadedFor === today) return;
  checkinLatchLoadedFor = today;
  try {
    const settings = await repo.getSystemSettings().catch(() => ({} as any));
    const raw = settings?.[CHECKIN_REMINDER_LATCH_KEY];
    if (raw && String(raw.date || '') === today && Array.isArray(raw.keys)) {
      for (const k of raw.keys) {
        if (k) remindedCheckin.add(String(k));
      }
    }
  } catch (e: any) {
    console.warn('[auto-reminders] đọc latch nhắc check-in lỗi:', e?.message || e);
  }
}

/** Ghi latch sau khi đã gửi (gộp 1 lần/tick, không ghi từng ca). */
async function saveCheckinLatch(repo: ISheetsRepository, today: string) {
  try {
    await repo.updateSystemSettings({
      [CHECKIN_REMINDER_LATCH_KEY]: { date: today, keys: [...remindedCheckin] },
    });
  } catch (e: any) {
    console.warn('[auto-reminders] ghi latch nhắc check-in lỗi:', e?.message || e);
  }
}

async function hrAdminIds(repo: ISheetsRepository): Promise<string[]> {
  try {
    const admins = await repo.listAdminAccounts();
    return admins.filter(a => (a.role === 'ADMIN' || a.role === 'HR') && a.is_active !== false).map(a => a.admin_id);
  } catch {
    return [];
  }
}

/** NV khối Văn Phòng đã có phiếu nghỉ phép ĐÃ DUYỆT trong ngày -> không nhắc điểm danh. */
function approvedOfficeLeaveIds(settings: any, today: string): Set<string> {
  const out = new Set<string>();
  const rows = Array.isArray(settings?.office_leave_requests) ? settings.office_leave_requests : [];
  for (const l of rows) {
    if (String(l?.status || '').toUpperCase() !== 'APPROVED') continue;
    if (normSheetDate(l?.leave_date) !== today) continue;
    const id = String(l?.employee_id || '').trim();
    if (id) out.add(id);
  }
  return out;
}

/** Gửi thông báo nhắc check-in cho 1 ca làm việc cụ thể (in-app + Zalo). */
export async function sendCheckinReminderForShift(
  repo: ISheetsRepository,
  notifications: NotificationsService,
  zalo: ZaloService,
  shift: {
    assignment_id?: string;
    employee_id: string;
    branch_id?: string;
    branch_name?: string;
    shift_code?: string;
    date: string;
    start_at?: string;
  },
  force = false
): Promise<{ success: boolean; sentZalo: boolean; sentInApp: boolean; reason?: string }> {
  const { employee_id, shift_code, date, start_at, assignment_id } = shift;
  const emp: any = await repo.getEmployeeById(employee_id);
  if (!emp) {
    return { success: false, sentZalo: false, sentInApp: false, reason: 'EMPLOYEE_NOT_FOUND' };
  }
  const startMs = parseShiftStart(date, start_at, shift_code, (emp as any)?.group);
  if (startMs === null) {
    return { success: false, sentZalo: false, sentInApp: false, reason: 'INVALID_START_TIME' };
  }

  if (!force) {
    const events = await repo.getAttendanceEvents(employee_id, date);
    if (events.some(e => e.type === 'CHECK_IN' && (e.assignment_id === assignment_id || !e.assignment_id))) {
      return { success: false, sentZalo: false, sentInApp: false, reason: 'ALREADY_CHECKED_IN' };
    }
  }

  const isOffice = OfficeService.isOfficeEmployee(emp);
  const isSale = isSaleGroup((emp as any)?.group);
  const { name: shiftName, start: startStr } = resolveShiftInfo(shift_code, startMs, { isOffice, date, group: (emp as any)?.group });

  // Tên chi nhánh đầy đủ để NV biết đúng nơi điểm danh (tick truyền sẵn).
  let branchName = String(shift.branch_name || '').trim();
  if (!branchName) {
    const branchId = String(shift.branch_id || emp.default_branch_id || '');
    const branches = await repo.getBranches().catch(() => [] as any[]);
    const found: any = (branches || []).find(
      (b: any) => String(b?.id || b?.branch_id || '') === branchId,
    );
    branchName = String(found?.name || branchId || 'Chi nhánh');
  }

  let sentInApp = false;
  let sentZalo = false;

  let title = '';
  let summary = '';
  let zaloText = '';
  if (isOffice) {
    const win = officeCheckInWindowOf(startMs, date);
    const openStr = String(win.openAt || '').slice(11, 16) || '08:00';
    const closeStr = String(win.closeAt || '').slice(11, 16) || '08:30';
    title = `⏰ Nhắc điểm danh ${shiftName} — ${branchName}`;
    summary = `Hôm nay bạn có ${shiftName} tại ${branchName}. Khung điểm danh ${openStr}–${closeStr} (giờ Việt Nam) — mở Cổng Nhân Viên → Điểm danh để VÀO CA đúng giờ.`;
    zaloText = `⏰ [Ụm Bò Milk] Nhắc điểm danh: ${shiftName} tại ${branchName} hôm nay.\n👉 Khung điểm danh ${openStr}–${closeStr} (giờ Việt Nam). Mở Cổng Nhân Viên → Điểm danh để VÀO CA đúng giờ nhé!`;
  } else if (isSale) {
    // Khối Sale có điểm danh nhưng KHÔNG nhắc áo hồng/bảng tên.
    title = `⏰ Nhắc điểm danh ${shiftName} — ${branchName}`;
    summary = `Hôm nay bạn có ${shiftName} tại ${branchName}, bắt đầu lúc ${startStr}. Mở Cổng Nhân Viên → Điểm danh để VÀO CA đúng giờ.`;
    zaloText = `⏰ [Ụm Bò Milk] Nhắc điểm danh: ${shiftName} tại ${branchName} của ${emp.full_name || 'bạn'} bắt đầu lúc ${startStr} hôm nay.\n👉 Mở Cổng Nhân Viên → Điểm danh để VÀO CA đúng giờ nhé!`;
  } else {
    title = `⏰ Nhắc check-in ${shiftName} — ${branchName}`;
    summary = `Hôm nay bạn có ${shiftName} tại ${branchName}, bắt đầu lúc ${startStr}. Mở Cổng Nhân Viên → Điểm danh để check-in đúng ca (chụp ảnh áo hồng + bật GPS).`;
    zaloText = `⏰ [Ụm Bò Milk] Nhắc check-in: ${shiftName} tại ${branchName} của ${emp.full_name || 'bạn'} bắt đầu lúc ${startStr} hôm nay.\n👉 Mở Cổng Nhân Viên, chụp ảnh áo hồng + bật GPS để điểm danh đúng ca nhé!`;
  }

  // 1) Thông báo IN-APP trong hộp thư nhân viên (realtime + lưu lịch sử).
  // Mỗi ca chỉ gửi 1 lần nhờ latch ở autoRemindersTick.
  try {
    await notifications.sendNotification({
      recipientIds: [employee_id],
      type: 'CHECKIN_REMINDER',
      severity: 'ACTION_REQUIRED',
      title,
      summary,
      targetPath: '/attendance',
      actorId: 'SYSTEM',
    });
    sentInApp = true;
  } catch (err: any) {
    console.warn('[auto-reminders] in-app notification error:', err?.message || err);
  }

  // 2) Zalo cá nhân (nếu có số điện thoại và Zalo đã kết nối).
  const phone = emp.phone_normalized || '';
  if (phone && zalo.isConnected()) {
    try {
      const found = await zalo.findUserByPhone(phone).catch(() => null);
      if (found?.uid) {
        await zalo.sendText(found.uid, zaloText);
        sentZalo = true;
      }
    } catch (err: any) {
      console.warn('[auto-reminders] Zalo notification error:', err?.message || err);
    }
  }

  return { success: sentInApp || sentZalo, sentZalo, sentInApp };
}

export async function autoRemindersTick(
  repo: ISheetsRepository,
  notifications: NotificationsService,
  zalo: ZaloService,
  options?: { forceCheckin?: boolean; targetEmployeeId?: string }
): Promise<{ checkinsSent: number }> {
  // Chống 2 lượt tick chồng nhau (mạng chậm >5 phút) gửi trùng thông báo.
  if (tickInFlight) return { checkinsSent: 0 };
  tickInFlight = true;
  try {
  const now = Date.now();
  const vn = vnNow(new Date(now));
  const today = vnDateStr(vn);
  resetDaily(today);

  let checkinsSent = 0;

  // 1. Nhắc check-in đúng chi nhánh – ca làm (In-App notification + Zalo).
  // Lấy TOÀN BỘ ca hôm nay của mọi chi nhánh/khối trong 1 lượt: cửa hàng, xưởng,
  // Sale (ca xếp tay) và Văn Phòng (lịch hành chính cố định).
  try {
    await ensureCheckinLatch(repo, today);
    const [allShifts, branches, employees, settings] = await Promise.all([
      repo.getShiftsForWeek('*', today).catch(() => [] as any[]),
      repo.getBranches().catch(() => [] as any[]),
      repo.listEmployees().catch(() => [] as any[]),
      repo.getSystemSettings().catch(() => ({} as any)),
    ]);
    const canonical = (v?: string): string => {
      const x = String(v || '').trim().toUpperCase();
      if (x === 'CN1' || x === 'CN130') return 'CN130';
      if (x === 'CN2' || x === 'CN261') return 'CN261';
      if (x === 'CN3' || x === 'CN120') return 'CN120';
      if (x === 'CN4' || x === 'CN111') return 'CN111';
      return x;
    };
    const branchNames = new Map<string, string>();
    for (const b of branches || []) {
      const id = String((b as any)?.id || (b as any)?.branch_id || '').trim();
      if (!id) continue;
      const name = String((b as any)?.name || id);
      branchNames.set(id, name);
      branchNames.set(canonical(id), name);
    }
    const branchNameOf = (branchId: string, emp?: any): string =>
      branchNames.get(branchId)
      || branchNames.get(canonical(branchId))
      || (emp ? String(branchNames.get(String(emp.default_branch_id || '')) || '') : '')
      || branchId;
    const empById = new Map<string, any>();
    for (const e of employees || []) {
      empById.set(String((e as any)?.employee_id || '').trim(), e);
    }
    /** NV đã nghỉ việc / chưa tới ngày vào làm thì không nhắc. */
    const notYetWorking = (emp?: any): boolean => {
      if (!emp) return false;
      if (String(emp.employment_status || '').toUpperCase() === 'TERMINATED') return true;
      const start = normSheetDate(emp.start_date);
      return !!start && start > today;
    };
    const keyOf = (s: any): string =>
      `${today}:${String(s.assignment_id || `${s.employee_id}:${s.shift_code || ''}:${s.start_at || ''}`)}`;

    let latchDirty = false;
    const markReminded = (key: string) => {
      remindedCheckin.add(key);
      latchDirty = true;
    };

    // 1a. Khối Cửa hàng / Xưởng / Sale: chỉ nhắc NV có ca PUBLISHED hôm nay,
    //     mỗi ca đúng 1 lần (NV 2 ca -> 2 thông báo).
    for (const s of allShifts || []) {
      if (normSheetDate((s as any)?.date) !== today) continue;
      if (String((s as any)?.status || '').trim().toUpperCase() !== 'PUBLISHED') continue;
      if (options?.targetEmployeeId && String((s as any)?.employee_id || '') !== String(options.targetEmployeeId)) continue;

      const emp: any = empById.get(String((s as any)?.employee_id || '').trim());
      if (notYetWorking(emp)) continue;

      // Văn Phòng xử lý theo lịch hành chính ở bước 1b (không phụ thuộc ca đã xếp).
      if (!!emp && OfficeService.isOfficeEmployee(emp)) continue;

      const startMs = parseShiftStart((s as any).date, (s as any).start_at, (s as any).shift_code);
      if (startMs === null) continue;

      if (!options?.forceCheckin) {
        // Cửa hàng / Xưởng / Sale: trước ca 20 phút → sau ca 5 phút.
        const minsToStart = (startMs - now) / 60_000;
        if (minsToStart < -5 || minsToStart > 20) continue;
        if (remindedCheckin.has(keyOf(s))) continue;
      }

      const branchId = String((s as any)?.branch_id || '').trim();
      try {
        const res = await sendCheckinReminderForShift(repo, notifications, zalo, {
          ...(s as any),
          branch_id: branchId,
          branch_name: branchNameOf(branchId, emp),
        }, !!options?.forceCheckin);
        // Đánh dấu đã nhắc cả khi NV đã check-in (tránh lặp lại mỗi 5 phút).
        if (res.success || res.reason === 'ALREADY_CHECKED_IN') markReminded(keyOf(s));
        if (res.success) checkinsSent++;
      } catch (e: any) {
        console.warn('[auto-reminders] Nhắc check-in thất bại:', e?.message || e);
      }
    }

    // 1b. Khối Văn Phòng: nhắc theo ĐÚNG lịch hành chính (T2–T6 08:00–17:00,
    //     T7 08:00–12:00, CN nghỉ) trong khung điểm danh 08:00–08:30 — kể cả khi
    //     NV chưa được sinh ca tự động. Mỗi NV 1 thông báo/ngày.
    const officeWindow = officeCheckInWindowOf(now);
    const officeReady = officeWindow.date === today
      && officeWindow.isWorkday
      && (officeWindow.phase === 'OPEN' || !!options?.forceCheckin);
    if (officeReady) {
      const leaveToday = approvedOfficeLeaveIds(settings, today);
      for (const e of employees || []) {
        const employeeId = String((e as any)?.employee_id || '').trim();
        if (!employeeId) continue;
        if (options?.targetEmployeeId && employeeId !== String(options.targetEmployeeId)) continue;
        if (!OfficeService.isOfficeEmployee(e)) continue;
        if (notYetWorking(e)) continue;
        if (leaveToday.has(employeeId)) continue;

        const key = `${today}:OFFICE:${employeeId}`;
        if (!options?.forceCheckin && remindedCheckin.has(key)) continue;

        const branchId = String((e as any)?.default_branch_id || '').trim();
        try {
          const res = await sendCheckinReminderForShift(repo, notifications, zalo, {
            employee_id: employeeId,
            branch_id: branchId,
            branch_name: branchNameOf(branchId, e),
            shift_code: 'CA_1',
            date: today,
            start_at: `${today}T08:00:00+07:00`,
          }, !!options?.forceCheckin);
          if (res.success || res.reason === 'ALREADY_CHECKED_IN') markReminded(key);
          if (res.success) checkinsSent++;
        } catch (err: any) {
          console.warn('[auto-reminders] Nhắc điểm danh Văn Phòng thất bại:', err?.message || err);
        }
      }
    }

    if (latchDirty) await saveCheckinLatch(repo, today);
  } catch (e: any) {
    console.warn('[auto-reminders] checkin tick:', e?.message || e);
  }

  // 2 & 3. Nhắc HR/Admin trong app (1 lần/ngày cho mỗi loại)
  try {
    const ids = await hrAdminIds(repo);
    if (ids.length === 0) return { checkinsSent };

    // 2. PIN khởi tạo quá 3 ngày chưa đổi (chỉ tài khoản mới chưa từng tự đổi;
    // kỳ xoay hàng tháng đã có thông báo riêng từ pin-rotation, không nhắc lại ở đây).
    if (!notifiedDaily.has(`pin:${today}`)) {
      const accounts = await repo.listAccounts();
      const stale = accounts.filter(a => {
        if (a.pin_must_change !== true) return false;
        if ((a as any).pin_changed_at) return false;
        const created = new Date(a.created_at || a.updated_at).getTime();
        return Number.isFinite(created) && now - created > 3 * DAY_MS;
      });
      if (stale.length > 0) {
        notifiedDaily.add(`pin:${today}`);
        const names = stale.slice(0, 5).map(a => a.phone_normalized).join(', ');
        await notifications.sendNotification({
          recipientIds: ids,
          type: 'PIN_STALE',
          severity: 'ACTION_REQUIRED',
          title: `🔑 ${stale.length} nhân viên chưa đổi PIN khởi tạo quá 3 ngày`,
          summary: `SĐT: ${names}${stale.length > 5 ? ` (+${stale.length - 5} người khác)` : ''}. Liên hệ nhắc NV đổi PIN riêng để bảo mật.`,
          targetPath: '/activation',
          actorId: 'SYSTEM',
        }).catch(() => null);
      }
    }

    // 4. Hoàn thành thử việc: hết hạn hôm nay / còn ≤2 ngày (ngày hoàn thành
    // = start_date + 11). Báo HR 1 lần/ngày + báo chính NV trong ngày cuối.
    if (!notifiedDaily.has(`prob:${today}`)) {
      try {
        const emps = await repo.listEmployees().catch(() => []);
        const endOf = (startDate: string): string => {
          const s = String(startDate || '').slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
          const d = new Date(`${s}T00:00:00Z`);
          if (!Number.isFinite(d.getTime())) return '';
          d.setUTCDate(d.getUTCDate() + 11);
          return d.toISOString().slice(0, 10);
        };
        const dayMs = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
        const probs = (emps || []).filter((e: any) => (e as any)?.employment_status === 'PROBATION');
        const endingToday = probs.filter((e: any) => endOf((e as any).start_date) === today);
        const endingSoon = probs.filter((e: any) => {
          const end = endOf((e as any).start_date);
          if (!end || end <= today) return false;
          return dayMs(end) - dayMs(today) <= 2 * DAY_MS;
        });
        if (endingToday.length > 0 || endingSoon.length > 0) {
          notifiedDaily.add(`prob:${today}`);
          const fmt = (e: any) => `${(e as any).full_name} (${(e as any).employee_code})`;
          const parts: string[] = [];
          if (endingToday.length > 0) parts.push(`Hết hạn HÔM NAY (${today.split('-').reverse().join('/')}): ${endingToday.slice(0, 5).map(fmt).join('; ')}${endingToday.length > 5 ? ` (+${endingToday.length - 5} người)` : ''}`);
          if (endingSoon.length > 0) parts.push(`Còn ≤2 ngày: ${endingSoon.slice(0, 5).map(fmt).join('; ')}${endingSoon.length > 5 ? ` (+${endingSoon.length - 5} người)` : ''}`);
          await notifications.sendNotification({
            recipientIds: ids,
            type: 'PROBATION_ENDING',
            severity: 'ACTION_REQUIRED',
            title: `🎓 ${endingToday.length + endingSoon.length} NV sắp/đến hạn hoàn thành thử việc`,
            summary: `${parts.join(' • ')}. Lên lịch kiểm tra đầu ra (Meet + trắc nghiệm) rồi xét duyệt chính thức!`,
            targetPath: '/hr-probation',
            actorId: 'SYSTEM',
          }).catch(() => null);
        }
        // Báo chính NV trong ngày hoàn thành để chuẩn bị kiểm tra đầu ra.
        for (const e of endingToday) {
          try {
            await notifications.sendNotification({
              recipientIds: [(e as any).employee_id],
              type: 'PROBATION_ENDING',
              severity: 'ACTION_REQUIRED',
              title: '🎓 Hôm nay là ngày hoàn thành thử việc của bạn!',
              summary: 'Chuẩn bị kiểm tra đầu ra (vấn đáp Google Meet + bài trắc nghiệm theo lịch HR đã gửi). Chúc bạn đạt kết quả tốt!',
              targetPath: '/schedule',
              actorId: 'SYSTEM',
            }).catch(() => null);
          } catch { /* best-effort từng người */ }
        }
      } catch (e: any) {
        console.warn('[auto-reminders] probation tick:', e?.message || e);
      }
    }

    // 5. Hoàn tiền đồng phục + hỗ trợ khám sức khỏe sau đủ 6 tháng làm việc
    // chính thức. Mốc = NGÀY NHẬN ĐỒNG PHỤC + 6 tháng; nhắc HR TRƯỚC 1 NGÀY.
    // Nếu hôm qua server bận/restart nên lỡ nhắc, hôm nay đúng mốc sẽ báo bù.
    if (!notifiedDaily.has(`uniform-refund:${today}`)) {
      try {
        const emps = await repo.listEmployees().catch(() => []);
        const tomorrow = vnDateStr(new Date(vn.getTime() + DAY_MS));
        const dueTomorrow: Array<{ emp: any; u: any }> = [];
        const dueToday: Array<{ emp: any; u: any }> = [];
        for (const emp of emps || []) {
          if ((emp as any)?.employment_status !== 'OFFICIAL') continue;
          const u = parseUniform((emp as any)?.uniform);
          if (!u) continue;
          const milestone = uniformRefundMilestoneDate(u.received_date);
          if (!milestone) continue;
          if (milestone === tomorrow) dueTomorrow.push({ emp, u });
          else if (milestone === today) dueToday.push({ emp, u });
        }
        if (dueTomorrow.length > 0 || dueToday.length > 0) {
          notifiedDaily.add(`uniform-refund:${today}`);
          const fmtDay = (iso: string) => iso.split('-').reverse().join('/');
          const fmtEmp = ({ emp, u }: { emp: any; u: any }) => {
            const health = Math.max(0, Math.floor(Number(u?.health_support_amount) || 0));
            const total = uniformRefundTotal(u);
            const parts = [`ĐP ${Number(u?.amount || 0).toLocaleString('vi-VN')}đ`];
            if (health > 0) parts.push(`KSK ${health.toLocaleString('vi-VN')}đ`);
            const more = health > 0 ? '' : ' — chưa nhập tiền hỗ trợ KSK';
            return `${emp.full_name} (${emp.employee_code}): ${total.toLocaleString('vi-VN')}đ [${parts.join(' + ')}]${more}`;
          };
          const cap = (rows: Array<{ emp: any; u: any }>) => {
            const shown = rows.slice(0, 5).map(fmtEmp).join('; ');
            return rows.length > 5 ? `${shown} (+${rows.length - 5} NV khác)` : shown;
          };
          const lines: string[] = [];
          if (dueTomorrow.length > 0) lines.push(`Mai (${fmtDay(tomorrow)}): ${cap(dueTomorrow)}`);
          if (dueToday.length > 0) lines.push(`Hôm nay (${fmtDay(today)}): ${cap(dueToday)}`);
          const titleParts: string[] = [];
          if (dueTomorrow.length > 0) titleParts.push(`mai đủ 6 tháng: ${dueTomorrow.length} NV`);
          if (dueToday.length > 0) titleParts.push(`hôm nay đủ 6 tháng: ${dueToday.length} NV`);
          await notifications.sendNotification({
            recipientIds: ids,
            type: 'UNIFORM_REFUND_DUE',
            severity: 'ACTION_REQUIRED',
            title: `💸 Hoàn tiền đồng phục + KSK — ${titleParts.join(' • ')}`,
            summary: `${lines.join(' • ')}. Vào Hồ Sơ Nhân Viên để kiểm tra và hoàn tiền cho NV.`,
            targetPath: '/hr-profile',
            actorId: 'SYSTEM',
          }).catch(() => null);
        }
      } catch (e: any) {
        console.warn('[auto-reminders] uniform refund tick:', e?.message || e);
      }
    }

    // 3. Đơn chờ duyệt quá 24h
    if (!notifiedDaily.has(`appr:${today}`)) {
      const [leaves, swaps, adjs] = await Promise.all([
        repo.listLeaveRequests().catch(() => []),
        repo.listSwapRequests().catch(() => []),
        repo.listAttendanceAdjustments().catch(() => []),
      ]);
      const old = (t: string) => {
        const ms = new Date(t).getTime();
        return Number.isFinite(ms) && now - ms > DAY_MS;
      };
      const nLeaves = leaves.filter((l: any) => l.status === 'PENDING' && old(l.created_at)).length;
      const nSwaps = swaps.filter((s: any) => (s.status === 'PENDING_PARTNER' || s.status === 'PARTNER_ACCEPTED') && old(s.created_at)).length;
      const nAdjs = adjs.filter((a: any) => a.status === 'PENDING' && old(a.created_at)).length;
      const total = nLeaves + nSwaps + nAdjs;
      if (total > 0) {
        notifiedDaily.add(`appr:${today}`);
        await notifications.sendNotification({
          recipientIds: ids,
          type: 'APPROVAL_STALE',
          severity: 'ACTION_REQUIRED',
          title: `⏳ ${total} yêu cầu chờ duyệt quá 24h`,
          summary: `Nghỉ/OFF: ${nLeaves} • Đổi ca: ${nSwaps} • Bổ sung công: ${nAdjs}. Duyệt sớm để không kẹt lương/công.`,
          actorId: 'SYSTEM',
        }).catch(() => null);
      }
    }
  } catch (e: any) {
    console.warn('[auto-reminders] hr tick:', e?.message || e);
  }

  return { checkinsSent };
  } finally {
    tickInFlight = false;
  }
}

