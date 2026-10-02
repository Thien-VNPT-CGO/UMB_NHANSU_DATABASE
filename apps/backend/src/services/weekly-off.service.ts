import { ERROR_CODES } from '@ubm/shared';
import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { NotificationsService } from './notifications.service.js';
import { normSheetDate } from './employees.service.js';

export type WeeklyOffPhase = 'OPEN' | 'REMINDER' | 'CLOSED';

export interface WeeklyOffWindow {
  phase: WeeklyOffPhase;
  /** Ngày Thứ 6 của chu kỳ đăng ký (YYYY-MM-DD, giờ VN). */
  weekKey: string;
  /** ISO instant mở cổng (11h45 Thứ 6 VN). */
  windowOpensAt: string;
  /** ISO instant đóng cổng (15h00 Thứ 7 VN). */
  windowClosesAt: string;
  /** Tuần mục tiêu đăng ký (Thứ 2 - Chủ nhật kế tiếp, YYYY-MM-DD VN). */
  targetWeekMon: string;
  targetWeekSun: string;
  serverTime: string;
  /** true khi cổng đang mở do Admin mở bù VIP (ngoài khung T6-T7). */
  manual?: boolean;
  /** ISO instant tự đóng của đợt mở bù (mặc định +30 phút). */
  manualClosesAt?: string;
}

export interface WeeklyOffCompletion {
  required: number;
  registered: string[];
  completed: boolean;
}

function readNumber(envKey: string, fallback: number): number {
  const raw = Number(process.env[envKey]);
  return Number.isFinite(raw) ? raw : fallback;
}

function tzOffsetHours(): number {
  return readNumber('WEEKLY_OFF_TZ_OFFSET_HOURS', 7);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Giờ hiện tại quy về múi giờ cấu hình (mặc định VN = UTC+7, không DST). */
function shiftedNow(now: Date): Date {
  return new Date(now.getTime() + tzOffsetHours() * 3_600_000);
}

const OPEN_DOW_MON0 = 4; // Thứ 6 (0 = Thứ 2)
const OPEN_MINUTES = 11 * 60 + 45; // 11h45 (reset chu kỳ đăng ký tuần tiếp theo)
const CLOSE_DOW_MON0 = 5; // Thứ 7
const CLOSE_MINUTES = 15 * 60; // 15h00

function reminderMinutes(): number {
  return readNumber('WEEKLY_OFF_REMINDER_MINUTES', 5);
}

const OPEN_START = OPEN_DOW_MON0 * 1440 + OPEN_MINUTES;
const OPEN_END = CLOSE_DOW_MON0 * 1440 + CLOSE_MINUTES;
const DAY_MS = 86_400_000;

export function getWeeklyOffWindow(now: Date = new Date()): WeeklyOffWindow {
  const vn = shiftedNow(now);
  const dowMon0 = (vn.getUTCDay() + 6) % 7;
  const mins = dowMon0 * 1440 + vn.getUTCHours() * 60 + vn.getUTCMinutes();
  const reminderStart = OPEN_START - reminderMinutes();

  let phase: WeeklyOffPhase;
  if (mins >= OPEN_START && mins < OPEN_END) phase = 'OPEN';
  else if (mins >= reminderStart && mins < OPEN_START) phase = 'REMINDER';
  else phase = 'CLOSED';

  // Ngày Thứ 6 của chu kỳ
  const midnightUtcMs = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate());
  let fridayMidnightUtc: number;
  if (phase === 'OPEN') {
    // Đang trong cửa sổ: Thứ 6 = hôm nay hoặc hôm qua (nếu đang Thứ 7).
    const backDays = dowMon0 === OPEN_DOW_MON0 ? 0 : 1;
    fridayMidnightUtc = midnightUtcMs - backDays * DAY_MS;
  } else if (phase === 'REMINDER') {
    fridayMidnightUtc = midnightUtcMs; // đang Thứ 6
  } else if (mins < reminderStart) {
    fridayMidnightUtc = midnightUtcMs + (OPEN_DOW_MON0 - dowMon0) * DAY_MS;
  } else {
    const fwd = (OPEN_DOW_MON0 - dowMon0 + 7) % 7;
    fridayMidnightUtc = midnightUtcMs + fwd * DAY_MS;
  }

  const weekKey = toDateStr(new Date(fridayMidnightUtc));
  // 11h45 Thứ 6 VN = 11h45 - offset theo giờ UTC.
  const windowOpensAt = new Date(fridayMidnightUtc + (OPEN_MINUTES - tzOffsetHours() * 60) * 60_000);
  const windowClosesAt = new Date(windowOpensAt.getTime() + (OPEN_END - OPEN_START) * 60_000);

  const mon = new Date(fridayMidnightUtc + 3 * DAY_MS);
  const sun = new Date(fridayMidnightUtc + 9 * DAY_MS);

  return {
    phase,
    weekKey,
    windowOpensAt: windowOpensAt.toISOString(),
    windowClosesAt: windowClosesAt.toISOString(),
    targetWeekMon: toDateStr(mon),
    targetWeekSun: toDateStr(sun),
    serverTime: now.toISOString(),
  };
}

/**
 * VIP: Admin mở bù cổng đăng ký 2 ngày OFF ngoài khung giờ (mặc định 30 phút,
 * tối đa 120 phút). Hết hạn tự đóng theo lazy-check (không cần timer, sống qua restart).
 * Tuần mục tiêu = tuần của chu kỳ gần nhất (vừa đóng/đang mở): người đã đăng ký
 * rồi được tính hoàn tất, chỉ người chưa đăng ký mới phải đăng ký bù.
 */
const MANUAL_SETTINGS_KEY = 'weeklyOffManual';
const MANUAL_DEFAULT_MINUTES = 30;
const MANUAL_MAX_MINUTES = 120;

export interface ManualOffState {
  activeUntil: string;
  activatedBy: string;
  activatedAt: string;
  minutes: number;
  targetWeekMon: string;
  targetWeekSun: string;
}

/** Thứ 2 tuần SAU kể từ hiện tại (YYYY-MM-DD VN). */
export function nextWeekRange(now: Date = new Date()): { mon: string; sun: string } {
  const vn = shiftedNow(now);
  const midnightUtcMs = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate());
  const dowMon0 = (vn.getUTCDay() + 6) % 7;
  const nextMon = midnightUtcMs + (7 - dowMon0) * DAY_MS;
  return { mon: toDateStr(new Date(nextMon)), sun: toDateStr(new Date(nextMon + 6 * DAY_MS)) };
}

/**
 * Tuần mục tiêu của CHU KỲ GẦN NHẤT (chu kỳ vừa đóng hoặc đang mở).
 * Đợt mở bù VIP phải nhắm đúng tuần này để bạn nào đã đăng ký rồi
 * được tính hoàn tất, chỉ những bạn chưa đăng ký mới bị khóa/nhắc.
 * (nextWeekRange sai khi Admin mở bù vào Thứ 2–Thứ 5: nó nhảy sang tuần kế tiếp.)
 */
export function lastCycleTargetRange(now: Date = new Date()): { mon: string; sun: string } {
  const vn = shiftedNow(now);
  const dowMon0 = (vn.getUTCDay() + 6) % 7;
  const mins = dowMon0 * 1440 + vn.getUTCHours() * 60 + vn.getUTCMinutes();
  const midnightUtcMs = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate());
  const thisFridayMidnightUtc = midnightUtcMs + (OPEN_DOW_MON0 - dowMon0) * DAY_MS;
  const fridayMidnightUtc = mins >= OPEN_START ? thisFridayMidnightUtc : thisFridayMidnightUtc - 7 * DAY_MS;
  const mon = new Date(fridayMidnightUtc + 3 * DAY_MS);
  const sun = new Date(fridayMidnightUtc + 9 * DAY_MS);
  return { mon: toDateStr(mon), sun: toDateStr(sun) };
}

export interface WeeklyOffEmployeeStat {
  employee_id: string;
  full_name: string;
  branch_id: string;
  dates: string[];
  completed: boolean;
}

export interface WeeklyOffStats {
  targetWeekMon: string;
  targetWeekSun: string;
  totalOfficial: number;
  registeredCount: number;
  unregisteredCount: number;
  registered: WeeklyOffEmployeeStat[];
  unregistered: WeeklyOffEmployeeStat[];
}

/** Thống kê ai đã / chưa đăng ký OFF tuần — để mở bù chỉ nhắc đúng người chưa đăng ký. */
export async function getWeeklyOffStats(
  repo: ISheetsRepository,
  targetWeekMon: string,
  targetWeekSun: string
): Promise<WeeklyOffStats> {
  const [employees, leaves] = await Promise.all([
    repo.listEmployees().catch(() => []),
    repo.listLeaveRequests().catch(() => []),
  ]);
  const officials = (employees || []).filter((e: any) => e.employment_status === 'OFFICIAL');
  const byEmp = new Map<string, string[]>();
  for (const l of leaves || []) {
    if ((l as any).leave_type !== 'HANG_TUAN') continue;
    if ((l as any).status !== 'PENDING' && (l as any).status !== 'APPROVED') continue;
    const d = normSheetDate((l as any).requested_date);
    if (d < targetWeekMon || d > targetWeekSun) continue;
    const arr = byEmp.get((l as any).employee_id) || [];
    if (!arr.includes(d)) arr.push(d);
    byEmp.set((l as any).employee_id, arr);
  }
  const registered: WeeklyOffEmployeeStat[] = [];
  const unregistered: WeeklyOffEmployeeStat[] = [];
  for (const e of officials) {
    const dates = (byEmp.get((e as any).employee_id) || []).sort();
    const stat: WeeklyOffEmployeeStat = {
      employee_id: (e as any).employee_id,
      full_name: (e as any).full_name || (e as any).employee_id,
      branch_id: (e as any).default_branch_id || (e as any).branch_id || '',
      dates,
      completed: dates.length >= 2,
    };
    if (stat.completed) registered.push(stat);
    else unregistered.push(stat);
  }
  return {
    targetWeekMon,
    targetWeekSun,
    totalOfficial: officials.length,
    registeredCount: registered.length,
    unregisteredCount: unregistered.length,
    registered,
    unregistered,
  };
}

/** Tuần hiện tại (Mon-Sun) theo giờ VN — mốc ràng buộc đổi/tráo ca trong tuần đã sắp lịch. */
export function currentVnWeekRange(now: Date = new Date()): { mon: string; sun: string } {
  return weekRangeOf(toDateStr(shiftedNow(now)));
}

/** Khung Mon-Sun chứa một ngày cho trước (giới hạn 2 OFF/tuần theo tuần này). */
export function weekRangeOf(dateStr: string): { mon: string; sun: string } {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { mon: dateStr, sun: dateStr };
  const dowMon0 = (d.getUTCDay() + 6) % 7;
  const monMs = d.getTime() - dowMon0 * DAY_MS;
  return { mon: toDateStr(new Date(monMs)), sun: toDateStr(new Date(monMs + 6 * DAY_MS)) };
}

async function getManualState(repo: ISheetsRepository): Promise<ManualOffState | null> {
  try {
    const settings = (await repo.getSystemSettings()) || {};
    const m = settings[MANUAL_SETTINGS_KEY];
    if (!m || typeof m !== 'object' || typeof m.activeUntil !== 'string') return null;
    return m as ManualOffState;
  } catch {
    return null;
  }
}

/** Cửa sổ hiệu lực: khung T6-T7 mặc định, hoặc đợt mở bù VIP còn hạn. */
export async function getEffectiveWindow(
  repo: ISheetsRepository,
  now: Date = new Date()
): Promise<WeeklyOffWindow> {
  const base = getWeeklyOffWindow(now);
  const manual = await getManualState(repo);
  if (manual && new Date(manual.activeUntil).getTime() > now.getTime()) {
    return {
      ...base,
      phase: 'OPEN',
      manual: true,
      manualClosesAt: manual.activeUntil,
      targetWeekMon: manual.targetWeekMon,
      targetWeekSun: manual.targetWeekSun,
    };
  }
  return base;
}

export async function openManualRegistration(
  repo: ISheetsRepository,
  actorId: string,
  minutes: number = MANUAL_DEFAULT_MINUTES,
  now: Date = new Date()
): Promise<WeeklyOffWindow & { manualClosesAt: string }> {
  const mins = Math.min(Math.max(Math.floor(minutes) || MANUAL_DEFAULT_MINUTES, 1), MANUAL_MAX_MINUTES);
  // Nhắm đúng tuần của chu kỳ gần nhất (không phải tuần sau tuyệt đối):
  // bạn đã đăng ký rồi vẫn được tính hoàn tất, chỉ người chưa đăng ký bị khóa.
  const target = lastCycleTargetRange(now);
  const activeUntil = new Date(now.getTime() + mins * 60_000).toISOString();
  const state: ManualOffState = {
    activeUntil,
    activatedBy: actorId,
    activatedAt: now.toISOString(),
    minutes: mins,
    targetWeekMon: target.mon,
    targetWeekSun: target.sun,
  };
  const settings = (await repo.getSystemSettings().catch(() => ({}))) || {};
  await repo.updateSystemSettings({ ...settings, [MANUAL_SETTINGS_KEY]: state });
  await repo.recordAuditLog({
    actor_id: actorId,
    action: 'WEEKLY_OFF_MANUAL_OPEN',
    target_type: 'CAU_HINH_HE_THONG',
    target_id: MANUAL_SETTINGS_KEY,
    payload_after: state,
  } as any).catch(() => null);
  const base = getWeeklyOffWindow(now);
  return { ...base, phase: 'OPEN', manual: true, manualClosesAt: activeUntil, targetWeekMon: target.mon, targetWeekSun: target.sun };
}

export async function closeManualRegistration(repo: ISheetsRepository, actorId: string): Promise<void> {
  const settings = (await repo.getSystemSettings().catch(() => ({}))) || {};
  // updateSystemSettings MERGE (không xóa key vắng mặt) -> gán null tường minh.
  await repo.updateSystemSettings({ ...settings, [MANUAL_SETTINGS_KEY]: null }).catch(() => null);
  await repo.recordAuditLog({
    actor_id: actorId,
    action: 'WEEKLY_OFF_MANUAL_CLOSE',
    target_type: 'CAU_HINH_HE_THONG',
    target_id: MANUAL_SETTINGS_KEY,
  } as any).catch(() => null);
}

export async function getManualStatus(repo: ISheetsRepository, now: Date = new Date()) {
  const manual = await getManualState(repo);
  const active = !!manual && new Date(manual.activeUntil).getTime() > now.getTime();
  return {
    active,
    manual: active ? manual : null,
    serverTime: now.toISOString(),
    defaultMinutes: MANUAL_DEFAULT_MINUTES,
    maxMinutes: MANUAL_MAX_MINUTES,
  };
}

function isSheetsError(e: unknown): boolean {
  return String((e as Error)?.message || '').includes('SHEETS_');
}

export async function getWeeklyOffCompletion(
  repo: ISheetsRepository,
  employeeId: string,
  targetWeekMon: string,
  targetWeekSun: string
): Promise<WeeklyOffCompletion> {
  const leaves = await repo.listLeaveRequests(undefined, employeeId);
  const registered = leaves
    .filter(l => {
      if (l.leave_type !== 'HANG_TUAN') return false;
      if (l.status !== 'PENDING' && l.status !== 'APPROVED') return false;
      // Chuẩn hóa trước khi so tuần: ngày locale Sheet so thô sẽ sai completion.
      const d = normSheetDate(l.requested_date);
      return d >= targetWeekMon && d <= targetWeekSun;
    })
    .map(l => normSheetDate(l.requested_date))
    .sort();
  const unique = [...new Set(registered)];
  return { required: 2, registered: unique, completed: unique.length >= 2 };
}

/** Prefix path luôn được phép khi cổng đang mở (xem hồ sơ, thông báo, đăng ký OFF). */
const GATE_ALLOW = ['/me', '/leave-requests', '/leaves', '/auth/'];

function isAllowedPath(path: string): boolean {
  if (!path) return false;
  return GATE_ALLOW.some(p => path === p || path.startsWith(p.endsWith('/') ? p : p + '/'));
}

export interface GateCheck {
  locked: boolean;
  window: WeeklyOffWindow;
  completion?: WeeklyOffCompletion;
}

/**
 * Kiểm tra khóa cổng đăng ký OFF tuần cho nhân viên chính thức.
 * - Chỉ khóa khi: role EMPLOYEE + employment OFFICIAL + đang OPEN + path ngoài allowlist + chưa đủ 2 ngày.
 * - Lỗi Sheets -> fail-open (cho qua, route tự báo lỗi) để không chặn nhầm.
 */
export async function checkWeeklyOffGate(
  repo: ISheetsRepository,
  user: { role: string; employeeId?: string },
  path: string,
  now: Date = new Date()
): Promise<GateCheck> {
  const window = await getEffectiveWindow(repo, now);
  if (user.role !== 'EMPLOYEE' || !user.employeeId) return { locked: false, window };
  if (window.phase !== 'OPEN') return { locked: false, window };
  if (isAllowedPath(path)) return { locked: false, window };

  let employee = null;
  try {
    employee = await repo.getEmployeeById(user.employeeId);
  } catch (e) {
    if (isSheetsError(e)) return { locked: false, window };
    throw e;
  }
  if (!employee || employee.employment_status !== 'OFFICIAL') return { locked: false, window };

  try {
    const completion = await getWeeklyOffCompletion(
      repo,
      user.employeeId,
      window.targetWeekMon,
      window.targetWeekSun
    );
    if (completion.completed) return { locked: false, window, completion };
    return { locked: true, window, completion };
  } catch (e) {
    if (isSheetsError(e)) return { locked: false, window };
    throw e;
  }
}

/**
 * Ràng buộc khung giờ khi nộp đơn HANG_TUAN: nhân viên chính thức chỉ được
 * đăng ký trong lúc cổng OPEN (khung T6-T7 hoặc đợt mở bù VIP của Admin).
 * Ngày đăng ký phải nằm trong tuần mục tiêu của cổng đang mở.
 */
export async function assertHangTuanWindow(
  repo: ISheetsRepository,
  user: { role: string; employeeId?: string },
  leaveType: unknown,
  now: Date = new Date(),
  requestedDate?: string
): Promise<WeeklyOffWindow> {
  const window = await getEffectiveWindow(repo, now);
  if (leaveType !== 'HANG_TUAN' || user.role !== 'EMPLOYEE' || !user.employeeId) return window;
  const employee = await repo.getEmployeeById(user.employeeId);
  if (!employee || employee.employment_status !== 'OFFICIAL') return window;
  if (window.phase === 'OPEN') {
    if (requestedDate && (requestedDate < window.targetWeekMon || requestedDate > window.targetWeekSun)) {
      const err: any = new Error(ERROR_CODES.WEEKLY_OFF_WINDOW_CLOSED);
      err.window = window;
      err.reason = `Ngày ${requestedDate} nằm ngoài tuần mục tiêu (${window.targetWeekMon} → ${window.targetWeekSun}).`;
      throw err;
    }
    return window;
  }
  const err: any = new Error(ERROR_CODES.WEEKLY_OFF_WINDOW_CLOSED);
  err.window = window;
  throw err;
}

const REMINDER_TITLE = '⏰ Sắp mở cổng đăng ký 2 ngày OFF tuần';
const REMINDER_SUMMARY =
  'Cổng đăng ký mở lúc 11h45 Thứ 6 đến 15h00 Thứ 7. Hãy chuẩn bị chọn 2 ngày nghỉ — các chức năng khác sẽ tạm khóa đến khi bạn hoàn tất đăng ký!';
const OPENED_TITLE = '🟢 Đã mở cổng đăng ký 2 ngày OFF tuần';
const OPENED_SUMMARY =
  'Hiện tại đang mở cổng đăng ký 2 ngày nghỉ/tuần định kỳ (đến 15h00 Thứ 7). Toàn bộ các chức năng khác tạm thời bị KHÓA cho đến khi bạn hoàn tất đăng ký 2 ngày nghỉ!';

export class WeeklyOffScheduler {
  private sent = new Set<string>();

  private async loadSent(repo: ISheetsRepository): Promise<void> {
    try {
      const settings = await repo.getSystemSettings();
      const arr = settings?.weeklyOffNotified;
      if (Array.isArray(arr)) {
        for (const k of arr.slice(-8)) this.sent.add(String(k));
      }
    } catch {
      // best-effort
    }
  }

  private async markSent(repo: ISheetsRepository, key: string): Promise<void> {
    this.sent.add(key);
    try {
      const settings = (await repo.getSystemSettings()) || {};
      const arr = Array.isArray(settings.weeklyOffNotified) ? settings.weeklyOffNotified : [];
      await repo.updateSystemSettings({
        ...settings,
        weeklyOffNotified: [...arr, key].slice(-8),
      });
    } catch {
      // best-effort
    }
  }

  /**
   * Tick định kỳ (mỗi 60s) + lazy-check: gửi nhắc trước giờ mở 5 phút và
   * thông báo mở cổng, mỗi loại 1 lần cho mỗi weekKey.
   */
  async tick(
    repo: ISheetsRepository,
    notifications: NotificationsService,
    now: Date = new Date()
  ): Promise<void> {
    const window = getWeeklyOffWindow(now);
    if (window.phase !== 'REMINDER' && window.phase !== 'OPEN') return;

    if (this.sent.size === 0) await this.loadSent(repo);

    const kind = window.phase === 'REMINDER' ? 'reminder' : 'opened';
    const key = `${window.weekKey}:${kind}`;
    if (this.sent.has(key)) return;

    try {
      await notifications.sendNotification({
        recipientIds: ['ALL'],
        type: kind === 'reminder' ? 'weekly_off.reminder' : 'weekly_off.opened',
        severity: 'SYSTEM',
        title: kind === 'reminder' ? REMINDER_TITLE : OPENED_TITLE,
        summary: kind === 'reminder' ? REMINDER_SUMMARY : OPENED_SUMMARY,
        targetPath: '/leave',
        actorId: 'SYSTEM',
      });
      await this.markSent(repo, key);
    } catch (e) {
      if (!isSheetsError(e)) throw e;
      // Sheets lỗi: thử lại ở tick sau (chưa đánh dấu đã gửi).
    }
  }
}

export const weeklyOffScheduler = new WeeklyOffScheduler();
