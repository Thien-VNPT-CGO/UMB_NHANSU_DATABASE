/** Tiện ích thời gian thuần — mọi phép tính ca trực dùng UTC+7 cố định. */

export const VN_OFFSET_MINUTES = 7 * 60;
export const MINUTES_PER_DAY = 24 * 60;

export interface VnParts {
  year: number;
  month: number; // 1..12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Chủ nhật
  minutesOfDay: number;
}

export interface ShiftRange {
  start: number; // phút trong ngày 0..1439
  end: number; // phút kết thúc, có thể 1440
  overnight: boolean;
}

function toDate(value: Date | string | number): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Giờ Việt Nam (UTC+7) tại một thời điểm, không phụ thuộc timezone máy chủ. */
export function vnParts(now: Date | string | number = new Date()): VnParts {
  const d = toDate(now) ?? new Date(0);
  const shifted = new Date(d.getTime() + VN_OFFSET_MINUTES * 60_000);
  const weekday = shifted.getUTCDay();
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday,
    minutesOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** Số phút kể từ 00:00 theo giờ Việt Nam. */
export function vnMinutesOfDay(now: Date | string | number = new Date()): number {
  return vnParts(now).minutesOfDay;
}

/** Khoá ngày YYYY-MM-DD theo giờ Việt Nam. */
export function vnDayKey(now: Date | string | number = new Date()): string {
  const p = vnParts(now);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Chuỗi HH:MM theo giờ Việt Nam. */
export function formatVnTime(now: Date | string | number = new Date()): string {
  const p = vnParts(now);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function formatVnDateTime(now: Date | string | number = new Date()): string {
  const p = vnParts(now);
  return `${vnDayKey(now)} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Tên thứ tiếng Việt. */
export function vnWeekdayName(now: Date | string | number = new Date()): string {
  return ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'][vnParts(now).weekday];
}

/**
 * Đọc một mốc giờ: "08:00", "8h00", "08:00:00", "8h", "17h30".
 * Trả về phút trong ngày, hoặc null nếu không hợp lệ.
 * 24:00 được chuẩn hoá thành 1440 (mốc kết thúc ngày).
 */
export function parseClock(raw: string): number | null {
  const text = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace('giờ', 'h');
  if (!text) return null;

  let hour = NaN;
  let minute = 0;
  let second = 0;

  let m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(text);
  if (m) {
    hour = Number(m[1]);
    minute = Number(m[2]);
    second = m[3] === undefined ? 0 : Number(m[3]);
  } else {
    m = /^(\d{1,2})h(\d{0,2})(?::(\d{1,2}))?$/.exec(text);
    if (!m) return null;
    hour = Number(m[1]);
    minute = m[2] ? Number(m[2]) : 0;
    second = m[3] ? Number(m[3]) : 0;
  }

  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)) return null;
  if (minute > 59 || second > 59) return null;
  if (hour === 24 && minute === 0 && second === 0) return MINUTES_PER_DAY;
  if (hour > 23) return null;
  return hour * 60 + minute;
}

function extractClocks(text: string): number[] {
  const out: number[] = [];
  const re = /(\d{1,2})(?:\s*(?::|h|giờ)\s*(\d{0,2}))?(?:\s*:\s*(\d{1,2}))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[0].trim()) continue;
    const clock = parseClock(m[0]);
    if (clock !== null) out.push(clock);
  }
  return out;
}

/**
 * Phân tích chuỗi ca trực thành các khoảng phút.
 * Hỗ trợ: "08:00 - 17:30", "8h00-17h30", "08:00:00 - 17:30:00",
 * nhiều ca "07:00-11:00, 13:00-17:30", ca qua đêm "22:00 - 06:00".
 */
export function parseShiftRanges(input: string | string[] | null | undefined): ShiftRange[] {
  if (input === null || input === undefined) return [];
  const chunks: string[] = [];
  const push = (s: string) => {
    const t = String(s || '').trim();
    if (t) chunks.push(t);
  };

  if (Array.isArray(input)) {
    for (const item of input) push(String(item ?? ''));
  } else {
    push(String(input));
  }

  const ranges: ShiftRange[] = [];
  for (const chunk of chunks) {
    const segments = chunk.split(/[,;|+\n\r]+|\s\/\s/).map((s) => s.trim()).filter(Boolean);
    for (const segment of segments) {
      const clocks = extractClocks(segment);
      let start: number | null = null;
      let end: number | null = null;

      if (clocks.length >= 2) {
        start = clocks[0];
        end = clocks[1];
      } else if (clocks.length === 1) {
        // Dạng "08:00" coi như ca 1 tiếng? Không hợp lệ — bỏ qua.
        continue;
      } else {
        continue;
      }

      if (start === null || end === null) continue;
      if (start < 0 || start > MINUTES_PER_DAY) continue;
      if (end < 0 || end > MINUTES_PER_DAY) continue;

      if (start === MINUTES_PER_DAY) start = 0;

      if (end === start) {
        // "08:00 - 08:00" => trực 24/24.
        ranges.push({ start: 0, end: MINUTES_PER_DAY, overnight: false });
        continue;
      }

      if (end === MINUTES_PER_DAY && start < end) {
        ranges.push({ start, end: MINUTES_PER_DAY, overnight: false });
        continue;
      }

      const overnight = end < start;
      ranges.push({ start, end, overnight });
    }
  }
  return ranges;
}

/** Kiểm tra một phút trong ngày có nằm trong khoảng ca không (end exclusive). */
export function isMinuteInRange(minute: number, range: ShiftRange): boolean {
  if (!Number.isFinite(minute)) return false;
  const m = ((Math.floor(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  if (range.start === 0 && range.end >= MINUTES_PER_DAY) return true;
  if (!range.overnight) return m >= range.start && m < range.end;
  return m >= range.start || m < range.end;
}

export function isMinuteInRanges(minute: number, ranges: ShiftRange[]): boolean {
  return ranges.some((r) => isMinuteInRange(minute, r));
}

/**
 * Nhân viên có đang trong ca tại thời điểm `now` (giờ Việt Nam) không.
 * Ca rỗng/không hợp lệ => không trực (tránh tag sai người).
 */
export function isOnDutyNow(
  shift: string | string[] | null | undefined,
  now: Date | string | number = new Date()
): { onDuty: boolean; minutesOfDay: number; ranges: ShiftRange[] } {
  const ranges = parseShiftRanges(shift);
  const minutesOfDay = vnMinutesOfDay(now);
  return { onDuty: ranges.length > 0 && isMinuteInRanges(minutesOfDay, ranges), minutesOfDay, ranges };
}

/** Số phút còn lại tới lúc bắt đầu ca kế tiếp (hữu ích cho UI). */
export function minutesUntilNextRange(
  shift: string | string[] | null | undefined,
  now: Date | string | number = new Date()
): number | null {
  const ranges = parseShiftRanges(shift);
  if (!ranges.length) return null;
  const minutes = vnMinutesOfDay(now);
  let best: number | null = null;
  for (const r of ranges) {
    const diff = (r.start - minutes + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    if (best === null || diff < best) best = diff;
  }
  return best;
}

/** Nhãn trạng thái trực hiện tại theo giờ Việt Nam. */
export function dutyLabel(
  shift: string | string[] | null | undefined,
  active: boolean,
  now: Date | string | number = new Date()
): { onDuty: boolean; label: string } {
  if (!active) return { onDuty: false, label: 'Đã tắt trực' };
  const { onDuty, ranges } = isOnDutyNow(shift, now);
  if (!ranges.length) return { onDuty: false, label: 'Chưa cấu hình ca' };
  return { onDuty, label: onDuty ? 'Đang trong ca' : 'Ngoài giờ ca' };
}
