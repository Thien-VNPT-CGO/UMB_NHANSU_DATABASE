import { AttendanceEvent, BranchInfo, EmployeeMaster, ShiftAssignment } from '@ubm/shared';
import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { LiveLocationStore } from './live-location.store.js';

/**
 * Bản đồ giám sát nhân viên realtime (Admin / HR / Kế toán).
 *
 * Trạng thái chấm trên bản đồ (theo yêu cầu nghiệp vụ):
 *  - NORMAL    (xám)   : bình thường — hôm nay không có ca, hoặc chưa tới giờ vào ca.
 *  - WORKING   (vàng)  : đang làm việc — đã check-in, chưa check-out (nhấp nháy nhẹ).
 *  - COMPLETED (xanh)  : hoàn thành ca — có đủ check-in + check-out.
 *  - MISSING   (đỏ)    : thiếu check-in hoặc check-out (ca đã hết giờ).
 *
 * Vị trí GPS lấy từ sự kiện chấm công gần nhất trong ngày của nhân viên (cổng NV
 * gửi kèm toạ độ khi check-in/check-out). Nếu chưa có GPS thì rơi về toạ độ cửa
 * hàng đã cấu hình ở tab Chi nhánh.
 */
export type LiveMapStatus = 'NORMAL' | 'WORKING' | 'COMPLETED' | 'MISSING';

export interface LiveMapGps {
  latitude: number;
  longitude: number;
  accuracy?: number;
  gps_status?: string;
  distance_meters?: number;
  at: string;
}

export interface LiveMapShift {
  assignment_id: string;
  shift_code: string;
  shift_label: string;
  start_at: string;
  end_at: string;
  status: LiveMapStatus;
  check_in_at?: string;
  check_out_at?: string;
  check_in_gps?: LiveMapGps;
  check_out_gps?: LiveMapGps;
  note?: string;
}

export interface LiveMapEmployee {
  employee_id: string;
  employee_code: string;
  full_name: string;
  branch_id: string;
  branch_name: string;
  employment_status: string;
  /** Trạng thái tổng hợp của NV trong ngày (ưu tiên WORKING > MISSING > COMPLETED > NORMAL). */
  status: LiveMapStatus;
  status_label: string;
  shifts: LiveMapShift[];
  /** Ca đang được chọn để hiển thị ở tooltip (ca ưu tiên cao nhất trong ngày). */
  primary_shift?: LiveMapShift;
  latitude: number;
  longitude: number;
  /** LIVE = GPS trực tiếp từ cổng NV (watchPosition), CHECK_IN/CHECK_OUT = GPS lúc chấm công, BRANCH = toạ độ cửa hàng. */
  gps_source: 'LIVE' | 'CHECK_IN' | 'CHECK_OUT' | 'BRANCH';
  gps_status?: string;
  gps_accuracy?: number;
  distance_meters?: number;
  /** Bán kính hợp lệ của cửa hàng (m) — dùng để xét NV có đang ở cửa hàng không. */
  radius_meters: number;
  /** Có GPS thật và đang nằm trong bán kính cửa hàng (đang làm việc tại cửa hàng). */
  at_branch: boolean;
  /** Đang trong khung giờ chia sẻ GPS (trước vào ca 30p → sau tan ca 30p). */
  sharing_now: boolean;
  /** Có ping GPS trực tiếp còn hiệu lực (thiết bị còn online). */
  live_online: boolean;
  /** Đang trong ca nhưng mất tín hiệu GPS quá lâu (chưa gửi ping). */
  gps_stale: boolean;
  last_gps_at?: string;
  note?: string;
}

/** Cảnh báo realtime từ bản đồ: rời cửa hàng, quay lại, mất/hồi tín hiệu GPS. */
export type LiveMapAlertType = 'GEOFENCE_EXIT' | 'GEOFENCE_RETURN' | 'GPS_STALE' | 'GPS_RESTORED' | 'GPS_SUSPICIOUS';

export interface LiveMapAlert {
  type: LiveMapAlertType;
  severity: 'INFO' | 'WARNING';
  employee_id: string;
  employee_code: string;
  full_name: string;
  branch_id: string;
  branch_name: string;
  latitude: number;
  longitude: number;
  distance_meters?: number;
  radius_meters?: number;
  at: string;
  message: string;
}

export interface LiveMapBranch extends BranchInfo {
  employees_total: number;
  employees_working: number;
  employees_missing: number;
}

export interface LiveMapSnapshot {
  server_time: string;
  date: string;
  branches: LiveMapBranch[];
  employees: LiveMapEmployee[];
  summary: LiveMapSummary;
}

export interface LiveMapSummary {
  total: number;
  normal: number;
  working: number;
  completed: number;
  missing: number;
  with_gps: number;
  /** Có GPS thật và đang trong bán kính cửa hàng. */
  at_store: number;
  /** Có GPS thật nhưng đang ở ngoài bán kính cửa hàng. */
  outside: number;
  /** Đang trong ca nhưng mất tín hiệu GPS. */
  stale: number;
}

const VN_OFFSET_MS = 7 * 3_600_000;
/** Chờ tối đa 15 phút sau giờ vào ca trước khi coi là "thiếu check-in". */
const CHECKIN_GRACE_MINUTES = 15;
/** Chờ tối đa 30 phút sau giờ tan ca trước khi coi là "thiếu check-out". */
const CHECKOUT_GRACE_MINUTES = 30;
/** Cổng NV bật chia sẻ GPS từ trước giờ vào ca 30 phút tới sau giờ tan ca 30 phút. */
const SHARE_BEFORE_MS = 30 * 60_000;
const SHARE_AFTER_MS = 30 * 60_000;
/** Trong khung ca mà quá số phút này không có ping GPS → coi là "mất tín hiệu". */
const LIVE_STALE_GRACE_MINUTES = 5;
/** Ra khỏi bán kính thêm khoảng này mới báo rời cửa hàng (chống nhiễu GPS). */
export const GEOFENCE_MARGIN_METERS = 50;
/** Không báo lặp cùng 1 loại cảnh báo cho 1 NV trong khoảng này. */
const ALERT_COOLDOWN_MS = 10 * 60_000;

const SHIFT_LABELS: Record<string, string> = {
  CA_1: 'Ca 1 (Sáng)',
  CA_2: 'Ca 2 (Chiều)',
  CA_3: 'Ca 3 (Tối)',
};

const STATUS_LABELS: Record<LiveMapStatus, string> = {
  NORMAL: 'Bình thường (chưa vào ca / không có ca)',
  WORKING: 'Đang làm việc',
  COMPLETED: 'Hoàn thành ca (đủ check-in + check-out)',
  MISSING: 'Thiếu check-in / check-out',
};

const STATUS_PRIORITY: Record<LiveMapStatus, number> = {
  NORMAL: 0,
  COMPLETED: 1,
  MISSING: 2,
  WORKING: 3,
};

/** Chuẩn hoá mã chi nhánh (CN1 ↔ CN130...) — dữ liệu Sheet lưu cả 2 kiểu. */
export function canonicalBranchId(raw?: unknown): string {
  const x = String(raw ?? '').trim().toUpperCase();
  if (x === 'CN1' || x === 'CN130') return 'CN130';
  if (x === 'CN2' || x === 'CN261') return 'CN261';
  if (x === 'CN3' || x === 'CN120') return 'CN120';
  if (x === 'CN4' || x === 'CN111') return 'CN111';
  return x;
}

/** Ngày theo múi giờ Việt Nam (YYYY-MM-DD). */
export function vnDateOf(input?: string | Date | number): string {
  const t = input === undefined ? Date.now() : new Date(input as any).getTime();
  if (!Number.isFinite(t)) return '';
  return new Date(t + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Khoảng cách (m) giữa 2 toạ độ — haversine. */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function parseMs(v?: unknown): number {
  const t = new Date(String(v ?? '')).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Khung giờ chia sẻ GPS của 1 ca: [vào ca −30p, tan ca +30p]. */
function shareWindowOf(startAt?: unknown, endAt?: unknown): { start: number; end: number } | null {
  const s = parseMs(startAt);
  const e = parseMs(endAt);
  if (!s || !e) return null;
  return { start: s - SHARE_BEFORE_MS, end: e + SHARE_AFTER_MS };
}

function gpsOf(ev?: AttendanceEvent | null): LiveMapGps | undefined {
  if (!ev) return undefined;
  const lat = Number((ev as any).gps_latitude);
  const lng = Number((ev as any).gps_longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return undefined;
  return {
    latitude: lat,
    longitude: lng,
    accuracy: Number((ev as any).gps_accuracy) || undefined,
    gps_status: (ev as any).gps_status || undefined,
    distance_meters: Number((ev as any).distance_meters) || undefined,
    at: String((ev as any).client_time || (ev as any).server_received_at || ''),
  };
}

export class LiveMapService {
  constructor(private repo: ISheetsRepository, private liveLocations?: LiveLocationStore) {}

  /** Trạng thái geofence lần trước (trong/ngoài cửa hàng) để phát hiện chuyển tiếp. */
  private geofenceInside = new Map<string, boolean>();
  /** Trạng thái mất tín hiệu lần trước để phát hiện hồi/mất. */
  private staleFlag = new Map<string, boolean>();
  /** Mốc thời gian đã báo gần nhất theo `employeeId:type` (chống spam). */
  private alertCooldown = new Map<string, number>();

  async getSnapshot(nowInput?: Date): Promise<LiveMapSnapshot> {
    const now = nowInput instanceof Date ? nowInput : new Date();
    const nowMs = now.getTime();
    const today = vnDateOf(now);

    const [employees, branches, shifts, events] = await Promise.all([
      this.repo.listEmployees().catch(() => [] as EmployeeMaster[]),
      this.repo.getBranches().catch(() => [] as BranchInfo[]),
      this.repo.getShiftsForWeek('*', today).catch(() => [] as ShiftAssignment[]),
      this.repo.getAttendanceEvents('*', today).catch(() => [] as AttendanceEvent[]),
    ]);

    const activeEmployees = (employees || []).filter(e =>
      String((e as any)?.employment_status || '').toUpperCase() !== 'TERMINATED'
      // Tài khoản bị khóa thì biến mất khỏi bản đồ (cả bản đồ admin lẫn cổng NV).
      && (e as any)?.account_locked !== true
      && String((e as any)?.account_status || '').toUpperCase() !== 'LOCKED'
    );
    const shiftsToday = (shifts || []).filter(s =>
      s && String((s as any).status || '').toUpperCase() === 'PUBLISHED'
      && String((s as any).date || '').slice(0, 10) === today
    );

    // Gom sự kiện theo nhân viên.
    const eventsByEmp = new Map<string, AttendanceEvent[]>();
    for (const ev of events || []) {
      const empId = String((ev as any)?.employee_id || '').trim();
      if (!empId) continue;
      const arr = eventsByEmp.get(empId) || [];
      arr.push(ev);
      eventsByEmp.set(empId, arr);
    }

    const shiftsByEmp = new Map<string, ShiftAssignment[]>();
    for (const s of shiftsToday) {
      const empId = String((s as any)?.employee_id || '').trim();
      if (!empId) continue;
      const arr = shiftsByEmp.get(empId) || [];
      arr.push(s);
      shiftsByEmp.set(empId, arr);
    }

    const branchById = new Map<string, BranchInfo>();
    for (const b of branches || []) {
      branchById.set(canonicalBranchId((b as any)?.id || (b as any)?.branch_id), b as BranchInfo);
    }

    const out: LiveMapEmployee[] = [];
    for (const emp of activeEmployees) {
      const empId = String((emp as any)?.employee_id || '').trim();
      if (!empId) continue;
      const empBranch = canonicalBranchId((emp as any)?.default_branch_id);
      const branch = branchById.get(empBranch);
      // Chỉ hiển thị NV thuộc chi nhánh đã cấu hình toạ độ.
      if (!branch || !Number.isFinite(Number((branch as any)?.latitude)) || !Number.isFinite(Number((branch as any)?.longitude))) {
        continue;
      }
      const empEvents = eventsByEmp.get(empId) || [];
      const empShifts = (shiftsByEmp.get(empId) || []).sort(
        (a, b) => parseMs((a as any).start_at) - parseMs((b as any).start_at)
      );

      const builtShifts = empShifts.map(s => this.buildShift(s, empEvents, nowMs));

      let status: LiveMapStatus = 'NORMAL';
      let note: string | undefined;
      for (const s of builtShifts) {
        if (STATUS_PRIORITY[s.status] > STATUS_PRIORITY[status]) status = s.status;
      }
      const primary = builtShifts.slice().sort((a, b) => STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status])[0];
      if (builtShifts.length === 0) {
        note = 'Hôm nay không có ca làm';
      } else if (primary?.note) {
        note = primary.note;
      }

      // Toạ độ: ưu tiên GPS trực tiếp (cổng NV gửi định kỳ), sau đó GPS của lần
      // chấm công gần nhất, cuối cùng rơi về toạ độ cửa hàng.
      const gpsEvents = empEvents
        .filter(e => gpsOf(e))
        .sort((a, b) => parseMs((b as any).client_time) - parseMs((a as any).client_time));
      const latestGpsEv = gpsEvents[0];
      const gps = gpsOf(latestGpsEv);
      const live = this.liveLocations?.get(empId, nowMs) || null;
      const branchLat = Number((branch as any).latitude);
      const branchLng = Number((branch as any).longitude);
      const radiusMeters = Number((branch as any).radius_meters) || 300;
      const shownLat = live ? live.latitude : (gps?.latitude ?? branchLat);
      const shownLng = live ? live.longitude : (gps?.longitude ?? branchLng);
      const gpsSource: LiveMapEmployee['gps_source'] = live
        ? 'LIVE'
        : (gps
          ? (String((latestGpsEv as any)?.type || '').toUpperCase() === 'CHECK_OUT' ? 'CHECK_OUT' : 'CHECK_IN')
          : 'BRANCH');
      const distance = live
        ? distanceMeters(shownLat, shownLng, branchLat, branchLng)
        : (gps
          ? (gps.distance_meters ?? distanceMeters(gps.latitude, gps.longitude, branchLat, branchLng))
          : 0);
      // Chỉ kết luận "đang ở cửa hàng" khi có GPS thật (live/chấm công) nằm
      // trong bán kính. Không có GPS thật (rơi về toạ độ cửa hàng) ⇒ false.
      const atBranch = gpsSource !== 'BRANCH' && distance <= radiusMeters;

      // Khung chia sẻ GPS đang bật + tình trạng tín hiệu (A2).
      const liveOnline = !!live;
      const activeWindows = builtShifts
        .map(s => shareWindowOf((s as any).start_at, (s as any).end_at))
        .filter((w): w is { start: number; end: number } =>
          !!w && nowMs >= w.start && nowMs <= w.end);
      const sharingNow = activeWindows.length > 0;
      const earliestStart = activeWindows.length ? Math.min(...activeWindows.map(w => w.start)) : 0;
      const gpsStale = sharingNow && !liveOnline
        && earliestStart > 0 && nowMs > earliestStart + LIVE_STALE_GRACE_MINUTES * 60_000;

      out.push({
        employee_id: empId,
        employee_code: String((emp as any)?.employee_code || empId),
        full_name: String((emp as any)?.full_name || 'Nhân viên'),
        branch_id: empBranch,
        branch_name: String((branch as any)?.name || empBranch),
        employment_status: String((emp as any)?.employment_status || ''),
        status,
        status_label: STATUS_LABELS[status],
        shifts: builtShifts,
        primary_shift: primary,
        latitude: shownLat,
        longitude: shownLng,
        gps_source: gpsSource,
        gps_status: live ? 'VALID' : gps?.gps_status,
        gps_accuracy: live?.accuracy ?? gps?.accuracy,
        distance_meters: distance,
        radius_meters: radiusMeters,
        at_branch: atBranch,
        sharing_now: sharingNow,
        live_online: liveOnline,
        gps_stale: gpsStale,
        last_gps_at: live?.at ?? gps?.at,
        note,
      });
    }

    out.sort((a, b) =>
      a.branch_id.localeCompare(b.branch_id)
      || STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status]
      || a.full_name.localeCompare(b.full_name, 'vi')
    );

    const branchesOut: LiveMapBranch[] = (branches || []).map(b => {
      const id = canonicalBranchId((b as any)?.id || (b as any)?.branch_id);
      const list = out.filter(e => e.branch_id === id);
      return {
        ...(b as BranchInfo),
        id,
        employees_total: list.length,
        employees_working: list.filter(e => e.status === 'WORKING').length,
        employees_missing: list.filter(e => e.status === 'MISSING').length,
      };
    });

    return {
      server_time: now.toISOString(),
      date: today,
      branches: branchesOut,
      employees: out,
      summary: this.summarize(out),
    };
  }

  /** Tổng hợp số liệu bản đồ (dùng chung cho bản đồ admin và cổng NV). */
  private summarize(list: LiveMapEmployee[]): LiveMapSummary {
    const withRealGps = list.filter(e => e.gps_source !== 'BRANCH');
    return {
      total: list.length,
      normal: list.filter(e => e.status === 'NORMAL').length,
      working: list.filter(e => e.status === 'WORKING').length,
      completed: list.filter(e => e.status === 'COMPLETED').length,
      missing: list.filter(e => e.status === 'MISSING').length,
      with_gps: withRealGps.length,
      at_store: withRealGps.filter(e => e.at_branch).length,
      outside: withRealGps.filter(e => !e.at_branch).length,
      stale: list.filter(e => e.gps_stale).length,
    };
  }

  /**
   * Bản đồ thu gọn cho CỔNG NHÂN VIÊN: chỉ đồng nghiệp cùng chi nhánh với người
   * đang đăng nhập (kèm chính họ). Tài khoản bị khóa đã bị loại từ getSnapshot.
   */
  async getBranchSnapshot(branchId: string, nowInput?: Date): Promise<LiveMapSnapshot> {
    const snap = await this.getSnapshot(nowInput);
    const target = canonicalBranchId(branchId);
    if (!target) return { ...snap, branches: [], employees: [], summary: this.summarize([]) };

    const employees = snap.employees.filter(e => canonicalBranchId(e.branch_id) === target);
    const branches = snap.branches.filter(b => canonicalBranchId((b as any)?.id || (b as any)?.branch_id) === target);
    return {
      ...snap,
      branches,
      employees,
      summary: this.summarize(employees),
    };
  }

  /**
   * Quét trạng thái hiện tại và trả về các cảnh báo MỚI (đã lọc cooldown):
   *  - GEOFENCE_EXIT  : đang trong ca mà rời khỏi bán kính cửa hàng.
   *  - GEOFENCE_RETURN: đã quay lại cửa hàng.
   *  - GPS_STALE      : đang trong ca mà mất tín hiệu GPS.
   *  - GPS_RESTORED   : đã có tín hiệu trở lại.
   * Không phụ thuộc socket — server gọi định kỳ rồi tự phát đi (xem server.ts).
   */
  async evaluateAlerts(nowInput?: Date): Promise<LiveMapAlert[]> {
    const now = nowInput instanceof Date ? nowInput : new Date();
    const nowMs = now.getTime();
    const snap = await this.getSnapshot(now);
    const out: LiveMapAlert[] = [];

    const emit = (
      type: LiveMapAlertType,
      severity: LiveMapAlert['severity'],
      e: LiveMapEmployee,
      message: string,
    ) => {
      const key = `${e.employee_id}:${type}`;
      if (nowMs - (this.alertCooldown.get(key) || 0) < ALERT_COOLDOWN_MS) return;
      this.alertCooldown.set(key, nowMs);
      out.push({
        type,
        severity,
        employee_id: e.employee_id,
        employee_code: e.employee_code,
        full_name: e.full_name,
        branch_id: e.branch_id,
        branch_name: e.branch_name,
        latitude: e.latitude,
        longitude: e.longitude,
        distance_meters: e.distance_meters,
        radius_meters: e.radius_meters,
        at: now.toISOString(),
        message,
      });
    };

    const present = new Set<string>();
    for (const e of snap.employees) {
      present.add(e.employee_id);

      // Geofence chỉ xét khi có GPS thật (live/chấm công).
      if (e.gps_source !== 'BRANCH') {
        const radius = Number(e.radius_meters) || 300;
        const outside = Number(e.distance_meters || 0) > radius + GEOFENCE_MARGIN_METERS;
        const inside = !outside;
        const prev = this.geofenceInside.get(e.employee_id);
        if (e.sharing_now) {
          if (prev === true && outside) {
            emit('GEOFENCE_EXIT', 'WARNING', e,
              `${e.full_name} (${e.employee_code}) đã rời khỏi ${e.branch_name} — cách ${Number(e.distance_meters || 0).toLocaleString('vi-VN')} m (bán kính ${radius} m).`);
          } else if (prev === false && inside) {
            emit('GEOFENCE_RETURN', 'INFO', e,
              `${e.full_name} (${e.employee_code}) đã quay lại ${e.branch_name}.`);
          }
        }
        this.geofenceInside.set(e.employee_id, inside);
      }

      const prevStale = this.staleFlag.get(e.employee_id) === true;
      if (e.gps_stale && !prevStale) {
        emit('GPS_STALE', 'WARNING', e,
          `${e.full_name} (${e.employee_code}) đang trong ca nhưng MẤT TÍN HIỆU GPS (không gửi vị trí).`);
      } else if (!e.gps_stale && prevStale) {
        emit('GPS_RESTORED', 'INFO', e,
          `${e.full_name} (${e.employee_code}) đã có tín hiệu GPS trở lại.`);
      }
      this.staleFlag.set(e.employee_id, e.gps_stale);
    }

    // Dọn trạng thái của NV không còn xuất hiện (bị khóa/nghỉ việc).
    for (const id of Array.from(this.geofenceInside.keys())) if (!present.has(id)) this.geofenceInside.delete(id);
    for (const id of Array.from(this.staleFlag.keys())) if (!present.has(id)) this.staleFlag.delete(id);

    return out;
  }

  private buildShift(shift: ShiftAssignment, events: AttendanceEvent[], nowMs: number): LiveMapShift {
    const assignmentId = String((shift as any)?.assignment_id || '');
    const shiftEvents = events.filter(e => String((e as any)?.assignment_id || '') === assignmentId);
    const ins = shiftEvents
      .filter(e => String((e as any)?.type || '').toUpperCase() === 'CHECK_IN')
      .sort((a, b) => parseMs((a as any).client_time) - parseMs((b as any).client_time));
    const outs = shiftEvents
      .filter(e => String((e as any)?.type || '').toUpperCase() === 'CHECK_OUT')
      .sort((a, b) => parseMs((a as any).client_time) - parseMs((b as any).client_time));
    const checkIn = ins[0];
    const checkOut = outs[outs.length - 1];
    const startMs = parseMs((shift as any)?.start_at);
    const endMs = parseMs((shift as any)?.end_at);

    let status: LiveMapStatus = 'NORMAL';
    let note: string | undefined;
    if (checkIn && checkOut) {
      status = 'COMPLETED';
    } else if (checkIn && !checkOut) {
      if (endMs && nowMs > endMs + CHECKOUT_GRACE_MINUTES * 60_000) {
        status = 'MISSING';
        note = 'Đã check-in nhưng thiếu check-out';
      } else {
        status = 'WORKING';
      }
    } else if (!checkIn && checkOut) {
      status = 'MISSING';
      note = 'Có check-out nhưng thiếu check-in';
    } else if (!startMs || !endMs) {
      status = 'NORMAL';
      note = 'Ca chưa có giờ bắt đầu/kết thúc';
    } else if (nowMs < startMs) {
      status = 'NORMAL';
      note = 'Chưa tới giờ vào ca';
    } else if (nowMs <= endMs) {
      if (nowMs > startMs + CHECKIN_GRACE_MINUTES * 60_000) {
        status = 'MISSING';
        note = 'Đã qua giờ vào ca nhưng chưa check-in';
      } else {
        status = 'NORMAL';
        note = 'Chưa vào ca';
      }
    } else {
      status = 'MISSING';
      note = 'Hết ca nhưng chưa check-in';
    }

    return {
      assignment_id: assignmentId,
      shift_code: String((shift as any)?.shift_code || ''),
      shift_label: SHIFT_LABELS[String((shift as any)?.shift_code || '').toUpperCase()] || String((shift as any)?.shift_code || 'Ca làm'),
      start_at: String((shift as any)?.start_at || ''),
      end_at: String((shift as any)?.end_at || ''),
      status,
      check_in_at: checkIn ? String((checkIn as any).client_time || '') : undefined,
      check_out_at: checkOut ? String((checkOut as any).client_time || '') : undefined,
      check_in_gps: gpsOf(checkIn),
      check_out_gps: gpsOf(checkOut),
      note,
    };
  }
}
