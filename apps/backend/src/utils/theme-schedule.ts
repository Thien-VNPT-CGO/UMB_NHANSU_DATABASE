/**
 * Lịch "Giao diện sự kiện" cho cổng nhân viên do Admin cấu hình.
 *
 * - Chỉ nhận các chủ đề sự kiện có sẵn trong loginThemeData của Employee Web.
 * - Bật lịch: bắt buộc có sự kiện + thời điểm bắt đầu + thời điểm kết thúc hợp lệ,
 *   lưu dạng ISO UTC để client so sánh tuyệt đối.
 * - Tắt lịch: xóa 2 mốc giờ (giữ lựa chọn sự kiện để Admin bật lại nhanh).
 * - Ngoài khoảng [start, end) cổng NV dùng giao diện tiêu chuẩn (mặc định).
 *
 * Tách khỏi route để unit-test được và dùng chung cho route public.
 */

export const EVENT_THEME_IDS = [
  'noel',
  'vietnam_culture',
  'tet',
  'tet_2027',
  'unification_30_4',
  'children_day_1_6',
  'women_day_8_3',
  'national_day_2_9',
  'vietnam_women_20_10',
  'halloween',
] as const;

export type EventThemeId = (typeof EVENT_THEME_IDS)[number];

export type EventThemePhase = 'off' | 'upcoming' | 'active' | 'expired';

export interface ThemeSchedulePatch {
  theme_event: EventThemeId | null;
  theme_schedule_enabled: boolean;
  theme_start_at: string | null;
  theme_end_at: string | null;
}

export interface ThemeScheduleState {
  enabled: boolean;
  theme: EventThemeId | null;
  startAt: string | null;
  endAt: string | null;
  phase: EventThemePhase;
  /** Chỉ có giá trị khi đang trong khoảng sự kiện. */
  activeTheme: EventThemeId | null;
}

export type NormalizeThemeScheduleResult =
  | { ok: true; patch: ThemeSchedulePatch }
  | { ok: false; message: string };

const EVENT_THEME_SET = new Set<string>(EVENT_THEME_IDS);

export function isEventThemeId(value: unknown): value is EventThemeId {
  return typeof value === 'string' && EVENT_THEME_SET.has(value);
}

function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function normalizeThemeSchedule(input: any): NormalizeThemeScheduleResult {
  const rawTheme = typeof input?.theme_event === 'string' ? input.theme_event.trim() : '';
  const theme = isEventThemeId(rawTheme) ? rawTheme : null;
  const enabled = !!input?.theme_schedule_enabled;

  if (!enabled) {
    return {
      ok: true,
      patch: {
        theme_event: theme,
        theme_schedule_enabled: false,
        theme_start_at: null,
        theme_end_at: null,
      },
    };
  }

  if (!theme) {
    return { ok: false, message: 'Vui lòng chọn sự kiện cho giao diện cổng nhân viên!' };
  }

  const startAt = toIso(input?.theme_start_at);
  if (!startAt) {
    return { ok: false, message: 'Vui lòng chọn ngày giờ bắt đầu sự kiện hợp lệ!' };
  }

  const endAt = toIso(input?.theme_end_at);
  if (!endAt) {
    return { ok: false, message: 'Vui lòng chọn ngày giờ kết thúc sự kiện hợp lệ!' };
  }

  if (Date.parse(endAt) <= Date.parse(startAt)) {
    return { ok: false, message: 'Ngày giờ kết thúc phải sau ngày giờ bắt đầu sự kiện!' };
  }

  return {
    ok: true,
    patch: {
      theme_event: theme,
      theme_schedule_enabled: true,
      theme_start_at: startAt,
      theme_end_at: endAt,
    },
  };
}

/**
 * Trạng thái lịch tại thời điểm `now` (mặc định hiện tại).
 * Dữ liệu hỏng/thiếu mốc giờ -> coi như TẮT để cổng NV không bị khóa giao diện oan.
 */
export function getThemeScheduleState(input: any, now = Date.now()): ThemeScheduleState {
  const off: ThemeScheduleState = {
    enabled: false,
    theme: null,
    startAt: null,
    endAt: null,
    phase: 'off',
    activeTheme: null,
  };

  if (!input?.theme_schedule_enabled) return off;

  const theme = isEventThemeId(input?.theme_event) ? input.theme_event : null;
  const startAt = toIso(input?.theme_start_at);
  const endAt = toIso(input?.theme_end_at);
  if (!theme || !startAt || !endAt || Date.parse(endAt) <= Date.parse(startAt)) return off;

  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  const phase: EventThemePhase = now < start ? 'upcoming' : now >= end ? 'expired' : 'active';

  return {
    enabled: true,
    theme,
    startAt,
    endAt,
    phase,
    activeTheme: phase === 'active' ? theme : null,
  };
}
