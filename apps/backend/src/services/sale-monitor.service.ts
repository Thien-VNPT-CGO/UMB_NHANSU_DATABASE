import {
  isSaleGroup,
  resolveShiftTemplate,
  shiftLabel,
  shiftTimeLabel,
  type AttendanceEvent,
  type ShiftAssignment,
  type SaleMonitorEmployee,
  type SaleMonitorEvent,
  type SaleMonitorShift,
  type SaleMonitorSnapshot,
  type SaleMonitorStatus,
  type SaleMonitorSummary,
} from '@ubm/shared';
import type { ISheetsRepository } from '../repositories/sheets.interface.js';

const VN_OFFSET_MS = 7 * 3_600_000;
const MINUTE_MS = 60_000;

/** Giờ Việt Nam của một mốc ISO -> YYYY-MM-DD. */
function vnDateOf(value: string | number | Date): string {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  return new Date(time + VN_OFFSET_MS).toISOString().slice(0, 10);
}

function vnToday(nowMs = Date.now()): string {
  return vnDateOf(nowMs);
}

/**
 * Parse mốc thời gian từ Sheets.
 * - Có timezone (`Z`, `+07:00`): parse như bình thường.
 * - Chuỗi local kiểu `2026-08-01T07:00` / `2026-08-01 07:00`: hiểu là giờ VN (+07:00).
 */
function parseVnTime(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    // Serial Google Sheets (ngày) — hiếm khi gặp ở ca/điểm danh, nhưng vẫn xử lý an toàn.
    if (value > 20_000 && value < 80_000) return Math.round((value - 25569) * 86_400_000);
    return value;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw
    .replace(' ', 'T')
    .replace(/(\.\d{3})\d+/, '$1');
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const parsed = Date.parse(hasTimezone ? normalized : `${normalized}+07:00`);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoOf(ms: number | null): string | undefined {
  return ms === null ? undefined : new Date(ms).toISOString();
}

/** Mốc bắt đầu/kết thúc ca VN từ ngày + mẫu ca Sale (dùng khi ca thiếu start_at/end_at). */
function shiftWindowFromTemplate(date: string, shiftCode: string): { startMs: number; endMs: number } | null {
  const tpl = resolveShiftTemplate(shiftCode, 'SALE');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || '').slice(0, 10));
  if (!tpl || !m) return null;
  const y = Number(m[1]);
  const mon = Number(m[2]) - 1;
  const d = Number(m[3]);
  // Giờ VN = UTC+7 -> trừ 7 giờ khi dựng mốc UTC.
  const startMs = Date.UTC(y, mon, d, tpl.start_hour, tpl.start_minute) - VN_OFFSET_MS;
  const endMs = Date.UTC(y, mon, d, tpl.end_hour, tpl.end_minute) - VN_OFFSET_MS;
  return { startMs, endMs };
}

function minutesBetween(fromMs: number, toMs: number): number {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
  return Math.max(0, Math.floor((toMs - fromMs) / MINUTE_MS));
}

function earliest(values: Array<number | null>): number | null {
  const list = values.filter((v): v is number => v !== null && Number.isFinite(v));
  return list.length ? Math.min(...list) : null;
}

function latest(values: Array<number | null>): number | null {
  const list = values.filter((v): v is number => v !== null && Number.isFinite(v));
  return list.length ? Math.max(...list) : null;
}

function isCheckedIn(event: AttendanceEvent): boolean {
  return String(event?.type || '').toUpperCase() === 'CHECK_IN';
}

function isCheckedOut(event: AttendanceEvent): boolean {
  return String(event?.type || '').toUpperCase() === 'CHECK_OUT';
}

function isAbsentEvent(event: AttendanceEvent): boolean {
  return String(event?.type || '').toUpperCase() === 'ABSENT';
}

function eventTime(event: AttendanceEvent): number | null {
  return parseVnTime(event?.client_time) ?? parseVnTime(event?.server_received_at) ?? parseVnTime(event?.created_at);
}

/**
 * Trạng thái của 1 ca tại thời điểm `nowMs`.
 * Quy ước:
 * - Có check-out -> COMPLETED (kể cả về sớm, vẫn ghi nhận early_leave_minutes).
 * - Có check-in, chưa check-out -> WORKING/LATE; quá giờ tan 15 phút -> MISSING_CHECKOUT.
 * - Chưa check-in -> UPCOMING trước giờ vào; MISSING_CHECKIN trong ca; ABSENT sau ca 30 phút.
 */
function shiftStatus(args: {
  checkInMs: number | null;
  checkOutMs: number | null;
  startMs: number;
  endMs: number;
  lateMinutes: number;
  absent: boolean;
  nowMs: number;
}): SaleMonitorStatus {
  const { checkInMs, checkOutMs, startMs, endMs, lateMinutes, absent, nowMs } = args;
  if (checkOutMs !== null) return 'COMPLETED';
  if (checkInMs !== null) {
    if (nowMs > endMs + 15 * MINUTE_MS) return 'MISSING_CHECKOUT';
    return lateMinutes > 0 ? 'LATE' : 'WORKING';
  }
  if (absent) return 'ABSENT';
  if (nowMs < startMs) return 'UPCOMING';
  if (nowMs > endMs + 30 * MINUTE_MS) return 'ABSENT';
  return 'MISSING_CHECKIN';
}

/** Ưu tiên trạng thái tổng hợp khi nhân viên có nhiều ca trong ngày. */
function aggregateStatus(shifts: SaleMonitorShift[]): SaleMonitorStatus {
  if (shifts.length === 0) return 'OFF';
  const has = (s: SaleMonitorStatus) => shifts.some((x) => x.status === s);
  if (has('LATE')) return 'LATE';
  if (has('WORKING')) return 'WORKING';
  if (has('MISSING_CHECKIN')) return 'MISSING_CHECKIN';
  if (has('MISSING_CHECKOUT')) return 'MISSING_CHECKOUT';
  if (has('UPCOMING')) return 'UPCOMING';
  if (shifts.every((x) => x.status === 'COMPLETED')) return 'COMPLETED';
  if (has('ABSENT')) return 'ABSENT';
  return shifts[0]?.status || 'OFF';
}

function emptySummary(): SaleMonitorSummary {
  return {
    total: 0,
    working: 0,
    late: 0,
    completed: 0,
    missing_checkin: 0,
    missing_checkout: 0,
    upcoming: 0,
    absent: 0,
    off: 0,
    checked_in: 0,
    scheduled: 0,
    total_worked_minutes: 0,
    total_scheduled_minutes: 0,
    progress_percent: 0,
    attendance_rate: 0,
  };
}

function buildSummary(employees: SaleMonitorEmployee[]): SaleMonitorSummary {
  const s = emptySummary();
  s.total = employees.length;
  let scheduled = 0;
  let checkedIn = 0;
  for (const emp of employees) {
    if (emp.status === 'WORKING' || emp.status === 'LATE') s.working += 1;
    else if (emp.status === 'COMPLETED') s.completed += 1;
    else if (emp.status === 'MISSING_CHECKIN') s.missing_checkin += 1;
    else if (emp.status === 'MISSING_CHECKOUT') s.missing_checkout += 1;
    else if (emp.status === 'UPCOMING') s.upcoming += 1;
    else if (emp.status === 'ABSENT') s.absent += 1;
    else if (emp.status === 'OFF') s.off += 1;
    if (emp.shifts.some((sh) => sh.late_minutes > 0 || sh.is_late)) s.late += 1;
    if (emp.shift_count > 0) {
      scheduled += 1;
      s.total_scheduled_minutes += emp.scheduled_minutes;
    }
    if (emp.check_in_at) {
      checkedIn += 1;
      s.checked_in += 1;
    }
    s.total_worked_minutes += emp.worked_minutes;
  }
  s.scheduled = scheduled;
  s.progress_percent = s.total_scheduled_minutes > 0
    ? Math.min(100, Math.round((s.total_worked_minutes / s.total_scheduled_minutes) * 1000) / 10)
    : 0;
  s.attendance_rate = scheduled > 0 ? Math.round((checkedIn / scheduled) * 1000) / 10 : 0;
  return s;
}

export interface SaleMonitorOptions {
  /** Ngày YYYY-MM-DD (giờ VN). Mặc định hôm nay. */
  date?: string;
  /** Mốc thời gian dùng để tính trạng thái — dùng cho test. */
  nowMs?: number;
}

/**
 * Dịch vụ tổng hợp dữ liệu Tool giám sát nhân viên Sale.
 *
 * Không ghi dữ liệu, chỉ đọc từ repository chuẩn của hệ thống (Sheets/Postgres).
 * Mọi thay đổi ca/điểm danh do nhân viên thao tác trên Cổng Employee Web
 * đều đi qua cùng repository và phát Socket.IO `sale-monitor:updated`.
 */
export class SaleMonitorService {
  constructor(private repo: ISheetsRepository) {}

  async getSnapshot(options: SaleMonitorOptions = {}): Promise<SaleMonitorSnapshot> {
    const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
    const today = vnToday(nowMs);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(options.date || ''))
      ? String(options.date)
      : today;
    const isToday = date === today;

    // Ngày quá khứ: tính trạng thái tại cuối ngày để "chưa check-out" không bị
    // hiển thị nhầm là đang làm. Ngày tương lai: dùng mốc hiện tại.
    let effectiveNowMs = nowMs;
    if (date < today) {
      effectiveNowMs = Date.parse(`${date}T23:59:59.999+07:00`);
    } else if (date > today) {
      effectiveNowMs = Date.parse(`${date}T00:00:00+07:00`);
    }

    const [allEmployees, allEvents] = await Promise.all([
      this.repo.listEmployees(),
      this.repo.getAttendanceEvents(undefined, date).catch(() => [] as AttendanceEvent[]),
    ]);

    const saleEmployees = (allEmployees || [])
      .filter((emp: any) => isSaleGroup(emp?.group))
      .filter((emp: any) => String(emp?.employment_status || '').toUpperCase() !== 'TERMINATED')
      .filter((emp: any) => !emp?.blacklisted);

    const saleIds = new Set(saleEmployees.map((emp: any) => String(emp.employee_id)));

    const eventsByEmployee = new Map<string, AttendanceEvent[]>();
    for (const ev of allEvents || []) {
      const id = String((ev as any)?.employee_id || '');
      if (!saleIds.has(id)) continue;
      const list = eventsByEmployee.get(id) || [];
      list.push(ev);
      eventsByEmployee.set(id, list);
    }

    const employees: SaleMonitorEmployee[] = await Promise.all(
      saleEmployees.map(async (emp: any) => {
        const employeeId = String(emp.employee_id || '');
        const events = (eventsByEmployee.get(employeeId) || []).sort((a, b) => {
          return (eventTime(a) ?? 0) - (eventTime(b) ?? 0);
        });

        let assignments: ShiftAssignment[] = [];
        try {
          assignments = await this.repo.getShiftsForEmployee(employeeId, date, date);
        } catch {
          assignments = [];
        }

        const liveAssignments = (assignments || []).filter(
          (a: any) => String(a?.status || '').toUpperCase() !== 'CANCELLED',
        );

        const shifts: SaleMonitorShift[] = liveAssignments.map((assignment: any) => {
          const shiftCode = String(assignment.shift_code || '').toUpperCase();
          const templateWindow = shiftWindowFromTemplate(date, shiftCode);
          const rawStart = parseVnTime(assignment.start_at);
          const rawEnd = parseVnTime(assignment.end_at);
          const startMs = rawStart ?? templateWindow?.startMs ?? effectiveNowMs;
          const endMs = rawEnd ?? templateWindow?.endMs ?? startMs;
          const scheduledMinutes = Math.max(0, minutesBetween(startMs, endMs)) ||
            Math.max(0, Math.round(Number(resolveShiftTemplate(shiftCode, 'SALE')?.duration_hours || 0) * 60));

          const shiftEvents = events.filter(
            (ev: any) => String(ev?.assignment_id || '') === String(assignment.assignment_id || ''),
          );
          // Nếu dữ liệu cũ chưa gắn assignment_id, vẫn nhận check-in/out cùng ngày
          // và cùng mã ca để tool không bỏ sót lượt điểm danh. Chỉ áp dụng khi
          // nhân viên có đúng 1 ca trong ngày để tránh gán trùng 1 lượt cho nhiều ca.
          const fallbackEvents = liveAssignments.length === 1
            ? events.filter((ev: any) => {
              const evShift = String((ev as any)?.shift_code || '').toUpperCase();
              if (evShift && shiftCode && evShift !== shiftCode) return false;
              return !String((ev as any)?.assignment_id || '');
            })
            : [];
          const usingEvents = shiftEvents.length > 0
            ? [...shiftEvents, ...fallbackEvents.filter((ev: any) => !shiftEvents.some((x: any) => String(x.event_id || '') === String(ev.event_id || '')))]
            : fallbackEvents;

          const checkInEvent = usingEvents.filter(isCheckedIn).sort((a, b) => (eventTime(a) ?? 0) - (eventTime(b) ?? 0))[0] as any;
          const checkOutEvent = usingEvents.filter(isCheckedOut).sort((a, b) => (eventTime(b) ?? 0) - (eventTime(a) ?? 0))[0] as any;
          const absent = usingEvents.some(isAbsentEvent);
          const checkInMs = checkInEvent ? eventTime(checkInEvent) : null;
          const checkOutMs = checkOutEvent ? eventTime(checkOutEvent) : null;

          const lateMinutes = checkInMs !== null ? minutesBetween(startMs, checkInMs) : 0;
          const earlyLeaveMinutes = checkOutMs !== null ? minutesBetween(checkOutMs, endMs) : 0;
          const overtimeMinutes = checkOutMs !== null ? Math.max(0, minutesBetween(endMs, checkOutMs)) : 0;
          // Chưa check-out: hôm nay tính tới hiện tại (đồng hồ chạy realtime);
          // ngày quá khứ chốt tại giờ tan ca để không thổi phồng công.
          const workedEndMs = checkOutMs ?? (isToday ? Math.max(checkInMs ?? effectiveNowMs, effectiveNowMs) : Math.max(checkInMs ?? endMs, endMs));
          const workedMinutes = checkInMs !== null
            ? minutesBetween(checkInMs, Math.max(checkInMs, workedEndMs))
            : 0;

          const status = shiftStatus({
            checkInMs,
            checkOutMs,
            startMs,
            endMs,
            lateMinutes,
            absent,
            nowMs: effectiveNowMs,
          });

          return {
            assignment_id: String(assignment.assignment_id || ''),
            shift_code: shiftCode,
            shift_name: shiftLabel(shiftCode, 'SALE') || shiftCode,
            shift_time_label: shiftTimeLabel(shiftCode, 'SALE'),
            start_at: isoOf(startMs) || String(assignment.start_at || ''),
            end_at: isoOf(endMs) || String(assignment.end_at || ''),
            status,
            check_in_at: isoOf(checkInMs),
            check_out_at: isoOf(checkOutMs),
            check_in_event_id: checkInEvent ? String(checkInEvent.event_id || '') : undefined,
            check_out_event_id: checkOutEvent ? String(checkOutEvent.event_id || '') : undefined,
            worked_minutes: workedMinutes,
            scheduled_minutes: scheduledMinutes,
            late_minutes: lateMinutes,
            early_leave_minutes: earlyLeaveMinutes,
            overtime_minutes: overtimeMinutes,
            fine_amount: Math.max(0, Number(checkInEvent?.fine_amount || 0)),
            is_late: lateMinutes > 0 || !!checkInEvent?.is_late,
            is_absent: absent,
            gps_status: checkInEvent?.gps_status ? String(checkInEvent.gps_status) : undefined,
          };
        });

        const checkInMs = earliest(shifts.map((s) => parseVnTime(s.check_in_at)));
        const checkOutMs = latest(shifts.map((s) => parseVnTime(s.check_out_at)));
        const workedMinutes = shifts.reduce((sum, s) => sum + Number(s.worked_minutes || 0), 0);
        const scheduledMinutes = shifts.reduce((sum, s) => sum + Number(s.scheduled_minutes || 0), 0);
        const lateMinutes = shifts.reduce((sum, s) => sum + Number(s.late_minutes || 0), 0);
        const status = aggregateStatus(shifts);

        return {
          employee_id: employeeId,
          employee_code: String(emp.employee_code || ''),
          full_name: String(emp.full_name || ''),
          phone: String(emp.phone_normalized || emp.phone || ''),
          branch_id: String(emp.default_branch_id || emp.branch_id || ''),
          group: String(emp.group || 'SALE'),
          employment_status: String(emp.employment_status || ''),
          default_shift_code: emp.default_shift_code ? String(emp.default_shift_code) : undefined,
          shifts,
          status,
          check_in_at: isoOf(checkInMs),
          check_out_at: isoOf(checkOutMs),
          worked_minutes: workedMinutes,
          scheduled_minutes: scheduledMinutes,
          late_minutes: lateMinutes,
          progress_percent: scheduledMinutes > 0
            ? Math.min(100, Math.round((workedMinutes / scheduledMinutes) * 1000) / 10)
            : 0,
          shift_count: shifts.length,
        };
      }),
    );

    const statusPriority: Record<string, number> = {
      LATE: 0,
      WORKING: 1,
      MISSING_CHECKIN: 2,
      MISSING_CHECKOUT: 3,
      UPCOMING: 4,
      ABSENT: 5,
      COMPLETED: 6,
      OFF: 7,
    };
    employees.sort((a, b) => {
      const pa = statusPriority[a.status] ?? 99;
      const pb = statusPriority[b.status] ?? 99;
      if (pa !== pb) return pa - pb;
      return a.full_name.localeCompare(b.full_name, 'vi');
    });

    const employeeById = new Map(employees.map((emp) => [emp.employee_id, emp]));
    const recentEvents: SaleMonitorEvent[] = (allEvents || [])
      .filter((ev: any) => saleIds.has(String(ev?.employee_id || '')))
      .map((ev: any) => {
        const emp = employeeById.get(String(ev.employee_id || '')) as SaleMonitorEmployee | undefined;
        const timeMs = eventTime(ev);
        const assignmentId = String(ev.assignment_id || '');
        const shift = emp?.shifts.find((s) => s.assignment_id === assignmentId);
        return {
          event_id: String(ev.event_id || ''),
          employee_id: String(ev.employee_id || ''),
          employee_code: emp?.employee_code || '',
          employee_name: emp?.full_name || String(ev.employee_id || ''),
          type: String(ev.type || '').toUpperCase(),
          time: timeMs !== null ? new Date(timeMs).toISOString() : String(ev.client_time || ''),
          shift_code: shift?.shift_code,
          is_late: !!ev.is_late,
          fine_amount: Math.max(0, Number(ev.fine_amount || 0)),
        };
      })
      .filter((ev) => !!ev.time)
      .sort((a, b) => (parseVnTime(b.time) ?? 0) - (parseVnTime(a.time) ?? 0))
      .slice(0, 20);

    return {
      date,
      is_today: isToday,
      generated_at: new Date(nowMs).toISOString(),
      server_time: new Date(nowMs).toISOString(),
      timezone: 'Asia/Ho_Chi_Minh',
      summary: buildSummary(employees),
      employees,
      recent_events: recentEvents,
    };
  }
}
