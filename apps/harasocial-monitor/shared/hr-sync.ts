/** Đồng bộ lịch làm việc từ Web App Nhân sự — logic thuần. */
import type { SalesStaff } from './types';
import { parseShiftRanges } from './time';

export interface HrUpdate {
  staffId?: string;
  externalHrId?: string;
  email?: string;
  zaloUserId?: string;
  name?: string;
  shift?: string;
  active?: boolean;
  raw: Record<string, unknown>;
}

export interface ApplyHrOptions {
  ownerUid: string;
  autoCreateMissingStaff?: boolean;
  /** Sinh ID cho nhân viên mới — mặc định `hr_<n>_<timestamp>`. */
  idFactory?: (index: number, update: HrUpdate) => string;
}

export interface ApplyHrResult {
  patches: Array<{ staffId: string; patch: Partial<SalesStaff>; update: HrUpdate }>;
  created: SalesStaff[];
  unmatched: HrUpdate[];
  matchedCount: number;
}

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function pick(obj: Dict, keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
  }
  return undefined;
}

/** Bỏ dấu tiếng Việt + chuẩn hoá để so khớp tên có dấu / không dấu. */
export function normalizeVietnamese(input: string): string {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Chuẩn hoá email để so khớp. */
export function normalizeEmail(input: unknown): string {
  return String(input || '').trim().toLowerCase();
}

function formatClock(minutes: number): string {
  if (minutes >= 1440) return '24:00';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Nhận mọi định dạng giờ HR gửi và trả về "HH:MM - HH:MM, ..." chuẩn. */
export function normalizeHrShift(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const parts = value.map((v) => normalizeHrShift(v)).filter(Boolean) as string[];
    return parts.length ? parts.join(', ') : undefined;
  }
  const text = str(value).trim();
  if (!text) return undefined;
  const ranges = parseShiftRanges(text);
  if (!ranges.length) return text;
  return ranges.map((r) => `${formatClock(r.start)} - ${formatClock(r.end)}`).join(', ');
}

function shiftFromTimes(obj: Dict): string | undefined {
  const direct = pick(obj, ['shift', 'shiftText', 'shift_text', 'schedule', 'time', 'workTime', 'work_time', 'ca', 'ca_lam', 'calam']);
  if (direct !== undefined) {
    const normalized = normalizeHrShift(direct);
    if (normalized) return normalized;
  }
  const start = pick(obj, ['startTime', 'start_time', 'start', 'fromTime', 'from_time', 'gio_vao', 'checkIn']);
  const end = pick(obj, ['endTime', 'end_time', 'end', 'toTime', 'to_time', 'gio_ra', 'checkOut']);
  if (start !== undefined && end !== undefined) {
    return normalizeHrShift(`${str(start)} - ${str(end)}`);
  }
  return undefined;
}

const OFF_STATUS = /^(off|leave|nghi phep|nghi|inactive|resigned|terminated|da nghi|absent|vang)$/;
const ON_STATUS = /^(active|working|on|duty|on duty|dang lam|on shift|available)$/;

function normalizeStatusActive(value: unknown): boolean | undefined {
  const text = normalizeVietnamese(String(value ?? ''));
  if (!text) return undefined;
  if (OFF_STATUS.test(text)) return false;
  if (ON_STATUS.test(text)) return true;
  if (['false', '0', 'no'].includes(text)) return false;
  if (['true', '1', 'yes'].includes(text)) return true;
  return undefined;
}

function parseBoolish(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on', 'active', 'working', 'dang lam', 'đang làm'].includes(t)) return true;
    if (['false', '0', 'no', 'off', 'inactive', 'nghi', 'nghỉ'].includes(t)) return false;
  }
  return undefined;
}

function detectActive(obj: Dict, hasShift: boolean): boolean | undefined {
  // Ưu tiên trạng thái nghỉ rõ ràng.
  const offFlags = ['isOff', 'is_off', 'off', 'onLeave', 'on_leave', 'leave', 'isLeave', 'nghiPhep', 'nghi_phep', 'isNghi'];
  for (const key of offFlags) {
    const parsed = parseBoolish(obj[key]);
    if (parsed === true) return false;
    if (parsed === false) return true;
  }

  const active = parseBoolish(pick(obj, ['active', 'isActive', 'is_active', 'working', 'dangLam', 'dang_lam']));
  if (active !== undefined) return active;

  const status = pick(obj, ['status', 'employmentStatus', 'employment_status', 'trangThai', 'trang_thai', 'attendanceStatus']);
  if (status !== undefined) {
    const parsed = normalizeStatusActive(status);
    if (parsed !== undefined) return parsed;
  }

  // Không khai báo trạng thái: có ca => đang trực; không có ca => không đổi.
  return hasShift ? true : undefined;
}

function normalizeOne(item: Dict): HrUpdate | null {
  const employeeObj = isDict(item.employee) ? item.employee : isDict(item.staff) ? item.staff : null;
  const source: Dict = employeeObj ? { ...employeeObj, ...item } : item;
  const scheduleObj = isDict(source.schedule) ? source.schedule : null;
  const merged: Dict = scheduleObj ? { ...source, ...scheduleObj } : source;

  const name = str(pick(merged, ['name', 'fullName', 'full_name', 'employeeName', 'employee_name', 'displayName', 'display_name', 'hoTen', 'ho_ten'])).trim();
  const employeeId = str(pick(merged, ['employeeId', 'employee_id', 'staffId', 'staff_id', 'id', 'code', 'employeeCode', 'employee_code'])).trim();
  const externalHrId = str(pick(merged, ['externalHrId', 'external_hr_id', 'hrId', 'hr_id', 'employeeCode', 'employee_code', 'code', 'employeeId', 'employee_id'])).trim();
  const email = normalizeEmail(pick(merged, ['email', 'emailAddress', 'email_address', 'workEmail']));
  const zaloUserId = str(pick(merged, ['zaloUserId', 'zalo_user_id', 'zaloUid', 'zalo_uid', 'zaloId', 'zalo_id'])).trim();
  const shift = shiftFromTimes(merged);
  const active = detectActive(merged, !!shift);

  if (!name && !employeeId && !externalHrId && !email && !zaloUserId) return null;
  if (!shift && active === undefined && !name && !email && !zaloUserId && !externalHrId) return null;

  return {
    staffId: employeeId || undefined,
    externalHrId: externalHrId || undefined,
    email: email || undefined,
    zaloUserId: zaloUserId || undefined,
    name: name || undefined,
    shift,
    active,
    raw: merged,
  };
}

function collectScheduleItems(payload: unknown, depth = 0): Dict[] {
  if (Array.isArray(payload)) return payload.flatMap((x) => collectScheduleItems(x, depth + 1));
  if (!isDict(payload)) return [];
  if (depth > 3) return [];
  for (const key of ['employees', 'shifts', 'schedules', 'items', 'data', 'records', 'rows', 'employees_shift']) {
    if (Array.isArray(payload[key])) {
      return (payload[key] as unknown[]).flatMap((x) => collectScheduleItems(x, depth + 1));
    }
  }
  if (isDict(payload.data)) return collectScheduleItems(payload.data, depth + 1);
  return [payload];
}

/** Chấp nhận payload 1 nhân viên hoặc mảng/danh sách lồng nhau. */
export function parseHrPayload(payload: unknown): HrUpdate[] {
  const items = collectScheduleItems(payload);
  const out: HrUpdate[] = [];
  for (const item of items) {
    const parsed = normalizeOne(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Khớp nhân viên theo thứ tự: staffId → externalHrId → email → zaloUserId → tên (bỏ dấu). */
export function findStaffForUpdate(update: HrUpdate, staffList: SalesStaff[]): SalesStaff | null {
  if (update.staffId) {
    const hit = staffList.find((s) => s.id === update.staffId);
    if (hit) return hit;
  }
  if (update.externalHrId) {
    const key = update.externalHrId.trim().toLowerCase();
    const hit = staffList.find((s) => String(s.externalHrId || '').trim().toLowerCase() === key);
    if (hit) return hit;
  }
  if (update.email) {
    const key = normalizeEmail(update.email);
    const hit = staffList.find((s) => normalizeEmail(s.email) === key);
    if (hit) return hit;
  }
  if (update.zaloUserId) {
    const key = String(update.zaloUserId).trim();
    const hit = staffList.find((s) => String(s.zaloUserId || '').trim() === key);
    if (hit) return hit;
  }
  if (update.name) {
    const key = normalizeVietnamese(update.name);
    if (key) {
      const hits = staffList.filter((s) => normalizeVietnamese(s.name) === key);
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) {
        // Nhiều người trùng tên: ưu tiên người đã có mã HR/email trùng.
        const byHr = update.externalHrId
          ? hits.find((s) => normalizeEmail(s.externalHrId) === normalizeEmail(update.externalHrId))
          : null;
        return byHr || hits[0];
      }
    }
  }
  return null;
}

/**
 * Áp cập nhật HR vào danh sách nhân viên.
 * CHỈ sửa shift / active / externalHrId / email (và tên nếu đang trống).
 * KHÔNG đụng zaloUserId, zaloTag, monitorChannelIds, monitorChannelId, role.
 */
export function applyHrUpdates(
  staffList: SalesStaff[],
  updates: HrUpdate[],
  options: ApplyHrOptions
): ApplyHrResult {
  const working = staffList.map((s) => ({ ...s }));
  const patches: ApplyHrResult['patches'] = [];
  const created: SalesStaff[] = [];
  const unmatched: HrUpdate[] = [];
  let matchedCount = 0;

  updates.forEach((update, index) => {
    const staff = findStaffForUpdate(update, working);
    if (staff) {
      const patch: Partial<SalesStaff> = {};
      if (update.shift !== undefined) patch.shift = update.shift;
      if (update.active !== undefined) patch.active = update.active;
      if (update.externalHrId) patch.externalHrId = update.externalHrId;
      if (update.email) patch.email = update.email;
      if (update.name && !String(staff.name || '').trim()) patch.name = update.name;
      if (Object.keys(patch).length === 0) return;
      Object.assign(staff, patch);
      patches.push({ staffId: staff.id, patch, update });
      matchedCount += 1;
      return;
    }

    if (options.autoCreateMissingStaff) {
      const now = Date.now();
      const id = options.idFactory
        ? options.idFactory(index, update)
        : `hr_${now}_${index}`;
      const newStaff: SalesStaff = {
        id,
        ownerUid: options.ownerUid,
        name: update.name || update.email || update.externalHrId || update.zaloUserId || `Nhân viên HR ${index + 1}`,
        zaloTag: '',
        zaloUserId: update.zaloUserId || '',
        role: 'sale',
        shift: update.shift || '',
        active: update.active !== false,
        monitorChannelId: null,
        monitorChannelIds: [],
        externalHrId: update.externalHrId || null,
        email: update.email || null,
      };
      working.push(newStaff);
      created.push(newStaff);
      patches.push({ staffId: newStaff.id, patch: {}, update });
      return;
    }

    unmatched.push(update);
  });

  return { patches, created, unmatched, matchedCount };
}
