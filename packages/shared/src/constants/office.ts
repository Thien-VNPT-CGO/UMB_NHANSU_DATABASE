/**
 * Quy chế riêng cho nhân viên KHỐI VĂN PHÒNG (employee.group === 'VAN_PHONG').
 *
 * - Lịch làm việc HÀNH CHÍNH: Thứ 2 → Thứ 6: 08:00–17:00, Thứ 7: 08:00–12:00, CN nghỉ.
 * - Điểm danh: nút "VÀO CA" chỉ hiện/mở trong khung 08:00–08:30; "RA CA" sau khi đã vào ca.
 * - Nghỉ phép: mỗi tháng 1 ngày; duyệt tuần tự Nhân sự → Kế toán → Giám đốc, chỉ có
 *   hiệu lực khi Giám đốc duyệt (APPROVED).
 * - Bổ sung công: 4 phiếu/tháng, dùng hết thì khóa đến tháng sau.
 *
 * Dùng chung cho cả backend (chốt cứng) và cổng nhân viên (hiển thị) để 2 bên khớp 100%.
 */

/** Trạng thái phiếu nghỉ phép văn phòng (chuỗi duyệt tuần tự). */
export type OfficeLeaveStatus =
  | 'PENDING_HR'
  | 'PENDING_FINANCE'
  | 'PENDING_DIRECTOR'
  | 'APPROVED'
  | 'REJECTED';

/** Các bước duyệt theo đúng thứ tự. */
export type OfficeApprovalRole = 'HR' | 'FINANCE' | 'DIRECTOR';
export const OFFICE_APPROVAL_CHAIN: OfficeApprovalRole[] = ['HR', 'FINANCE', 'DIRECTOR'];

export const OFFICE_ROLE_LABELS: Record<OfficeApprovalRole, string> = {
  HR: 'Nhân sự',
  FINANCE: 'Kế toán',
  DIRECTOR: 'Giám đốc',
};

export const OFFICE_LEAVE_STATUS_LABELS: Record<OfficeLeaveStatus, string> = {
  PENDING_HR: 'Chờ Nhân sự duyệt',
  PENDING_FINANCE: 'Chờ Kế toán duyệt',
  PENDING_DIRECTOR: 'Chờ Giám đốc duyệt',
  APPROVED: 'Đã duyệt (có hiệu lực)',
  REJECTED: 'Từ chối',
};

export interface OfficeDayRule {
  /** 0 = Chủ nhật … 6 = Thứ bảy (theo Date.getDay()). */
  weekday: number;
  work: boolean;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  label: string;
}

/** Lịch hành chính cố định (Thứ 2 → CN). */
export const OFFICE_WEEK_RULES: OfficeDayRule[] = [
  { weekday: 1, work: true, startHour: 8, startMinute: 0, endHour: 17, endMinute: 0, label: 'Thứ 2' },
  { weekday: 2, work: true, startHour: 8, startMinute: 0, endHour: 17, endMinute: 0, label: 'Thứ 3' },
  { weekday: 3, work: true, startHour: 8, startMinute: 0, endHour: 17, endMinute: 0, label: 'Thứ 4' },
  { weekday: 4, work: true, startHour: 8, startMinute: 0, endHour: 17, endMinute: 0, label: 'Thứ 5' },
  { weekday: 5, work: true, startHour: 8, startMinute: 0, endHour: 17, endMinute: 0, label: 'Thứ 6' },
  { weekday: 6, work: true, startHour: 8, startMinute: 0, endHour: 12, endMinute: 0, label: 'Thứ 7' },
  { weekday: 0, work: false, startHour: 0, startMinute: 0, endHour: 0, endMinute: 0, label: 'Chủ nhật' },
];

/** Khung giờ mở nút VÀO CA (giờ VN). */
export const OFFICE_CHECKIN_OPEN_HOUR = 8;
export const OFFICE_CHECKIN_OPEN_MINUTE = 0;
export const OFFICE_CHECKIN_CLOSE_HOUR = 8;
export const OFFICE_CHECKIN_CLOSE_MINUTE = 30;

/** Quota nghiệp vụ. */
export const OFFICE_LEAVE_MONTHLY_QUOTA = 1;
export const OFFICE_ADJUST_MONTHLY_QUOTA = 4;

/** Bán kính GPS điểm danh văn phòng (mét) — khớp BRANCHES VAN_PHONG. */
export const OFFICE_GPS_RADIUS_METERS = 300;
/** Sai số GPS tối đa cho phép (mét). */
export const OFFICE_GPS_MAX_ACCURACY_METERS = 150;

/** Quy tắc lịch của một ngày ISO (YYYY-MM-DD). */
export function officeDayRuleOfIso(dateIso: string): OfficeDayRule {
  const t = Date.parse(`${String(dateIso || '').slice(0, 10)}T00:00:00Z`);
  // Mặc định Thứ 2 nếu ngày hỏng.
  const dow = Number.isFinite(t) ? new Date(t).getUTCDay() : 1;
  return OFFICE_WEEK_RULES.find((r) => r.weekday === dow) || OFFICE_WEEK_RULES[0];
}

export function officeRuleOfWeekday(weekday: number): OfficeDayRule {
  return OFFICE_WEEK_RULES.find((r) => r.weekday === weekday) || OFFICE_WEEK_RULES[0];
}

/** Số giờ công chuẩn của một ngày (0 nếu nghỉ). */
export function officeStandardHours(dateIso: string): number {
  const r = officeDayRuleOfIso(dateIso);
  if (!r.work) return 0;
  return Math.max(0, (r.endHour * 60 + r.endMinute - (r.startHour * 60 + r.startMinute)) / 60);
}

export function formatHm(hour: number, minute: number): string {
  return `${String(Math.max(0, hour)).padStart(2, '0')}:${String(Math.max(0, minute)).padStart(2, '0')}`;
}

/** Nhãn giờ làm của một ngày: "08:00 – 17:00" hoặc "Nghỉ". */
export function officeDayHoursLabel(dateIso: string): string {
  const r = officeDayRuleOfIso(dateIso);
  if (!r.work) return 'Nghỉ';
  return `${formatHm(r.startHour, r.startMinute)} – ${formatHm(r.endHour, r.endMinute)}`;
}

/** Thứ tự bước kế tiếp trong chuỗi duyệt (trả về role cần duyệt tiếp hoặc null khi xong). */
export function officeNextApprovalRole(status: OfficeLeaveStatus): OfficeApprovalRole | null {
  if (status === 'PENDING_HR') return 'HR';
  if (status === 'PENDING_FINANCE') return 'FINANCE';
  if (status === 'PENDING_DIRECTOR') return 'DIRECTOR';
  return null;
}

/** Có nằm trong khung điểm danh VÀO CA không (giờ VN). */
export function officeInCheckInWindow(vnHour: number, vnMinute: number): boolean {
  const cur = vnHour * 60 + vnMinute;
  const open = OFFICE_CHECKIN_OPEN_HOUR * 60 + OFFICE_CHECKIN_OPEN_MINUTE;
  const close = OFFICE_CHECKIN_CLOSE_HOUR * 60 + OFFICE_CHECKIN_CLOSE_MINUTE;
  return cur >= open && cur <= close;
}

/* ==========================================================================
 * KHUNG ĐIỂM DANH THEO GIỜ VIỆT NAM (UTC+7) — NGUỒN SỰ THẬT DUY NHẤT
 *
 * Toàn bộ cổng Nhân viên / Admin / backend đều đi qua các hàm dưới đây để:
 *  - Không phụ thuộc múi giờ máy chủ (VPS có thể chạy UTC) hay giờ điện thoại.
 *  - Cổng VÀO CA ĐÓNG đúng 08:30:00 giờ VN (hết 08:29 là khóa, không mở lây
 *    sang phút 08:30 như trước).
 *  - Trả về mốc epoch + ISO kèm offset +07:00 để client đếm ngược realtime.
 * ========================================================================== */

/** Tách ngày/giờ Việt Nam (UTC+7) từ một mốc epoch ms — không phụ thuộc TZ máy. */
export function officeVnParts(nowMs: number = Date.now()) {
  const shifted = new Date((Number.isFinite(nowMs) ? nowMs : Date.now()) + 7 * 3_600_000);
  return {
    date: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    seconds: shifted.getUTCSeconds(),
    minutesOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** Pha của cổng VÀO CA trong ngày: chưa mở / đang mở / đã đóng / ngày nghỉ. */
export type OfficeCheckInPhase = 'BEFORE' | 'OPEN' | 'CLOSED' | 'DAY_OFF';

export interface OfficeCheckInWindow {
  /** Ngày (YYYY-MM-DD, giờ VN) của khung điểm danh. */
  date: string;
  weekday: number;
  isWorkday: boolean;
  phase: OfficeCheckInPhase;
  /** Mốc mở/đóng cổng (epoch ms). */
  openMs: number;
  closeMs: number;
  /** ISO kèm offset +07:00 để client hiển thị/đếm ngược chính xác. */
  openAt: string;
  closeAt: string;
  /** Giờ VN hiện tại tại thời điểm tính. */
  vnHour: number;
  vnMinute: number;
  vnSecond: number;
  minutesOfDay: number;
  /** Thời gian còn lại tới lúc đóng cổng (ms, >0 khi OPEN). */
  remainingMs: number;
}

/**
 * Tính khung điểm danh VÀO CA của một ngày theo giờ Việt Nam.
 * `dateIso` bỏ trống → lấy ngày VN hiện tại của `nowMs`.
 */
export function officeCheckInWindowOf(nowMs: number = Date.now(), dateIso?: string): OfficeCheckInWindow {
  const at = Number.isFinite(nowMs) ? nowMs : Date.now();
  const vn = officeVnParts(at);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(dateIso || '')) ? String(dateIso).slice(0, 10) : vn.date;
  const openAt = `${date}T${formatHm(OFFICE_CHECKIN_OPEN_HOUR, OFFICE_CHECKIN_OPEN_MINUTE)}:00+07:00`;
  const closeAt = `${date}T${formatHm(OFFICE_CHECKIN_CLOSE_HOUR, OFFICE_CHECKIN_CLOSE_MINUTE)}:00+07:00`;
  const openMs = Date.parse(openAt);
  const closeMs = Date.parse(closeAt);
  const rule = officeDayRuleOfIso(date);
  const sameDay = date === vn.date;

  let phase: OfficeCheckInPhase;
  if (!rule.work) phase = 'DAY_OFF';
  else if (!sameDay) phase = date < vn.date ? 'CLOSED' : 'BEFORE';
  else if (at < openMs) phase = 'BEFORE';
  else if (at >= closeMs) phase = 'CLOSED'; // ĐÓNG đúng 08:30:00 giờ VN
  else phase = 'OPEN';

  return {
    date,
    weekday: rule.weekday,
    isWorkday: rule.work,
    phase,
    openMs,
    closeMs,
    openAt,
    closeAt,
    vnHour: vn.hour,
    vnMinute: vn.minute,
    vnSecond: vn.seconds,
    minutesOfDay: sameDay ? vn.minutesOfDay : 0,
    remainingMs: phase === 'OPEN' ? Math.max(0, closeMs - at) : 0,
  };
}
