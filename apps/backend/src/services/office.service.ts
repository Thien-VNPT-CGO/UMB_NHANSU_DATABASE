/**
 * OfficeService — nghiệp vụ riêng cho nhân viên KHỐI VĂN PHÒNG (group = VAN_PHONG).
 *
 * Phạm vi:
 *  - Lịch làm việc hành chính cố định (T2–T6 08:00–17:00, T7 08:00–12:00, CN nghỉ).
 *  - Đăng ký nghỉ phép: 1 ngày/tháng, duyệt tuần tự Nhân sự → Kế toán → Giám đốc,
 *    chỉ có hiệu lực khi Giám đốc duyệt.
 *  - Điểm danh: VÀO CA trong khung 08:00–08:30, RA CA sau khi vào ca; bắt buộc GPS
 *    trong bán kính 300m của Văn Phòng Trụ Sở Chính.
 *  - Công của tôi: lương CƠ BẢN THEO THÁNG (không tính theo ca) = Lương CB + phụ cấp,
 *    do Kế toán cấu hình theo từng NV (mẫu employee_salary_config).
 *  - Bổ sung công: 4 phiếu/tháng, dùng hết khóa đến tháng sau.
 *
 * Bền vững: lưu trong CÀI ĐẶT HỆ THỐNG (đồng bộ Google Sheets qua updateSystemSettings)
 * theo đúng mẫu bank-change.service — KHÔNG đổi schema tab NHAN_VIEN_MASTER.
 */
import {
  BRANCHES,
  OFFICE_ADJUST_MONTHLY_QUOTA,
  OFFICE_APPROVAL_CHAIN,
  OFFICE_CHECKIN_CLOSE_HOUR,
  OFFICE_CHECKIN_CLOSE_MINUTE,
  OFFICE_CHECKIN_OPEN_HOUR,
  OFFICE_CHECKIN_OPEN_MINUTE,
  OFFICE_LEAVE_MONTHLY_QUOTA,
  OFFICE_ROLE_LABELS,
  isBranchGpsEnabled,
  officeDayRuleOfIso,
  officeStandardHours,
} from '@ubm/shared';
import type { OfficeApprovalRole, OfficeLeaveStatus } from '@ubm/shared';
import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { SalaryConfigService } from './salary-config.service.js';
import { calculateDistanceMeters } from './attendance.service.js';

const SETTINGS_KEY_LEAVES = 'office_leave_requests';
const SETTINGS_KEY_ATTENDANCE = 'office_attendance_events';
const SETTINGS_KEY_ADJUSTMENTS = 'office_adjustments';

const OFFICE_BRANCH_ID = 'VAN_PHONG';

export interface OfficeLeaveRecord {
  leave_id: string;
  employee_id: string;
  employee_code: string;
  full_name: string;
  leave_date: string; // YYYY-MM-DD
  reason: string;
  status: OfficeLeaveStatus;
  current_step: OfficeApprovalRole | null;
  created_at: string;
  updated_at: string;
  history: Array<{ step: OfficeApprovalRole | 'EMPLOYEE'; by_id: string; by_role: string; name?: string; at: string; decision?: 'APPROVE' | 'REJECT'; note?: string }>;
  rejection_note?: string;
}

export interface OfficeAttendanceEvent {
  event_id: string;
  employee_id: string;
  date: string; // YYYY-MM-DD (giờ VN)
  type: 'CHECK_IN' | 'CHECK_OUT';
  at: string; // ISO
  /** Có thể không có khi chi nhánh đã TẮT định vị GPS. */
  latitude?: number;
  longitude?: number;
  accuracy: number;
  distance_meters: number;
  gps_status: 'VALID' | 'OUT_OF_BOUNDS' | 'LOW_ACCURACY' | 'UNAVAILABLE';
}

export interface OfficeAdjustmentRecord {
  adjustment_id: string;
  employee_id: string;
  employee_code: string;
  full_name: string;
  work_date: string; // YYYY-MM-DD
  reason: string;
  minutes_requested: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  created_at: string;
  reviewed_by?: string;
  reviewed_at?: string;
  review_note?: string;
}

/** Serialize read-modify-write settings: 2 thao tác cùng lúc không ghi đè nhau. */
let officeLock: Promise<unknown> = Promise.resolve();
function withOfficeLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = officeLock.then(fn, fn);
  officeLock = run.then(() => undefined, () => undefined);
  return run;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export class OfficeService {
  constructor(private repo: ISheetsRepository, private salaryConfig?: SalaryConfigService) {}

  /** Nhân viên khối văn phòng? Nhận cả biến thể chuỗi ("văn phòng", "VAN PHONG"…). */
  static isOfficeEmployee(emp: any): boolean {
    const g = String(emp?.group ?? emp?.work_group ?? '').trim().toUpperCase();
    if (!g) return false;
    if (g === 'VAN_PHONG' || g === 'VANPHONG' || g === 'OFFICE' || g === 'VAN PHONG') return true;
    return g.includes('VĂN PHÒNG') || g.includes('VAN PHONG') || g.includes('OFFICE');
  }

  /** Thời gian VN hiện tại dưới dạng {date, hour, minute, iso, minutesOfDay}. */
  static vnNow(now: Date = new Date()) {
    const shifted = new Date(now.getTime() + 7 * 3_600_000);
    const date = shifted.toISOString().slice(0, 10);
    return {
      date,
      month: date.slice(0, 7),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      minutesOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
      iso: now.toISOString(),
    };
  }

  private async readSettings(): Promise<any> {
    return (await this.repo.getSystemSettings().catch(() => ({}))) || {};
  }

  private async getEmployeeOrThrow(employeeId: string): Promise<any> {
    const emp: any = await this.repo.getEmployeeById(employeeId).catch(() => null);
    if (!emp) throw new Error('EMPLOYEE_NOT_FOUND: Không tìm thấy hồ sơ nhân viên!');
    if (!OfficeService.isOfficeEmployee(emp)) {
      throw new Error('NOT_OFFICE_EMPLOYEE: Chức năng này chỉ dành cho nhân viên khối Văn Phòng!');
    }
    return emp;
  }

  /**
   * Ghi lượt điểm danh Văn Phòng vào SỔ ĐIỂM DANH CHUẨN của hệ thống
   * (attendance events) để cổng Admin — Lịch tuần, Bảng chấm công, tính lương,
   * phiếu lương — thấy đúng cùng dữ liệu với cổng nhân viên (đồng bộ 2 chiều).
   * Nguồn nghiệp vụ vẫn là office_attendance_events; đây là bản mirror chuẩn.
   */
  private async mirrorAttendanceEvent(
    emp: any,
    now: { date: string; iso: string },
    type: 'CHECK_IN' | 'CHECK_OUT',
    gps: { latitude?: number; longitude?: number; accuracy?: number } | undefined,
    v: { distance_meters: number; accuracy: number; gps_status: string },
    extra?: { is_late?: boolean; minutes_deviation?: number },
  ) {
    const employeeId = String(emp?.employee_id || '');
    if (!employeeId) return;
    try {
      // Tránh ghi trùng nếu lượt này đã được mirror trước đó.
      const existing = await this.repo.getAttendanceEvents(employeeId, now.date).catch(() => []);
      if ((existing || []).some((e: any) => String(e?.type || '') === type && String(e?.client_time || '').slice(0, 10) === now.date)) return;
      const shifts = await this.repo.getShiftsForEmployee(employeeId, now.date, now.date).catch(() => []);
      const assignment: any = (shifts || []).find(
        (s: any) => String(s?.status || '') !== 'CANCELLED' && String(s?.date || '').slice(0, 10) === now.date,
      );
      await this.repo.recordAttendanceEvent({
        event_id: `VP_EVT_${type}_${employeeId}_${Date.now()}`,
        request_id: `OFFICE_${employeeId}_${now.date}_${type}`,
        assignment_id: String(assignment?.assignment_id || ''),
        employee_id: employeeId,
        branch_id: String(emp?.default_branch_id || assignment?.branch_id || OFFICE_BRANCH_ID),
        type,
        client_time: now.iso,
        server_received_at: new Date().toISOString(),
        gps_latitude: Number.isFinite(Number(gps?.latitude)) ? Number(gps?.latitude) : undefined,
        gps_longitude: Number.isFinite(Number(gps?.longitude)) ? Number(gps?.longitude) : undefined,
        gps_accuracy: v.accuracy,
        distance_meters: v.distance_meters,
        gps_status: v.gps_status as any,
        is_late: !!extra?.is_late,
        minutes_deviation: Number(extra?.minutes_deviation) || 0,
        fine_tier: 'NONE',
        fine_amount: 0,
      } as any);
    } catch (err: any) {
      // Không chặn điểm danh nếu mirror lỗi (Sheets chậm) — office_* vẫn là nguồn chính.
      console.warn('[office] mirror attendance event failed:', err?.message || err);
    }
  }

  private async branchOf() {
    // Ưu tiên cấu hình thật trong DANH_SACH_CHI_NHANH (Admin có thể sửa toạ độ
    // hoặc tắt GPS); fallback hằng số seed khi Sheet chưa tải.
    const rows = await this.repo.getBranches().catch(() => [] as any[]);
    const b: any = (rows || []).find(
      (x: any) => String(x?.id || x?.branch_id) === OFFICE_BRANCH_ID
    ) || BRANCHES.find((x) => x.id === OFFICE_BRANCH_ID) || BRANCHES[0];
    return {
      ...b,
      radius_meters: Math.min(Number(b?.radius_meters) || 300, 300),
      gps_enabled: isBranchGpsEnabled(b),
    };
  }

  // ==================================================================
  // LỊCH LÀM VIỆC HÀNH CHÍNH
  // ==================================================================
  async getSchedule(employeeId: string, fromDate: string, toDate: string) {
    await this.getEmployeeOrThrow(employeeId);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(fromDate || '')) ? String(fromDate).slice(0, 10) : OfficeService.vnNow().date;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(toDate || '')) ? String(toDate).slice(0, 10) : from;
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    const attendance = await this.attendanceByDate(employeeId, from, to);
    const leaves = await this.approvedLeaveDates(employeeId, from, to);
    const days: any[] = [];
    if (Number.isFinite(start) && Number.isFinite(end)) {
      for (let t = start, guard = 0; t <= end && guard < 400; t += 86_400_000, guard++) {
        const date = new Date(t).toISOString().slice(0, 10);
        const rule = officeDayRuleOfIso(date);
        const att = attendance.get(date) || {};
        days.push({
          date,
          weekday: rule.weekday,
          weekday_label: rule.label,
          work: rule.work,
          start_time: rule.work ? `${pad2(rule.startHour)}:${pad2(rule.startMinute)}` : '',
          end_time: rule.work ? `${pad2(rule.endHour)}:${pad2(rule.endMinute)}` : '',
          standard_hours: officeStandardHours(date),
          is_leave: leaves.has(date),
          check_in_at: att.check_in?.at || null,
          check_out_at: att.check_out?.at || null,
          worked_minutes: att.worked_minutes || 0,
        });
      }
    }
    const branch: any = await this.branchOf();
    return { from, to, branch_id: OFFICE_BRANCH_ID, branch_name: branch.name, days };
  }

  // ==================================================================
  // NGHỈ PHÉP (1 ngày/tháng, duyệt Nhân sự → Kế toán → Giám đốc)
  // ==================================================================
  async listLeaves(employeeId: string): Promise<OfficeLeaveRecord[]> {
    const settings = await this.readSettings();
    const all: OfficeLeaveRecord[] = Array.isArray(settings[SETTINGS_KEY_LEAVES]) ? settings[SETTINGS_KEY_LEAVES] : [];
    return all
      .filter((l) => String(l.employee_id) === String(employeeId))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  /** Danh sách toàn bộ phiếu (cho HR/Kế toán/Giám đốc duyệt). */
  async listAllLeaves(): Promise<OfficeLeaveRecord[]> {
    const settings = await this.readSettings();
    const all: OfficeLeaveRecord[] = Array.isArray(settings[SETTINGS_KEY_LEAVES]) ? settings[SETTINGS_KEY_LEAVES] : [];
    return [...all].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  /** Quota nghỉ phép tháng hiện tại của 1 nhân viên. */
  async leaveQuota(employeeId: string, now: Date = new Date()) {
    const month = OfficeService.vnNow(now).month;
    const mine = await this.listLeaves(employeeId);
    const active = mine.filter(
      (l) => String(l.leave_date).slice(0, 7) === month && ['PENDING_HR', 'PENDING_FINANCE', 'PENDING_DIRECTOR', 'APPROVED'].includes(l.status)
    );
    // Tháng trước không dùng thì KHÔNG cộng dồn — mỗi tháng đúng 1 ngày.
    return {
      month,
      monthUsed: active.length,
      monthLimit: OFFICE_LEAVE_MONTHLY_QUOTA,
      monthRemaining: Math.max(0, OFFICE_LEAVE_MONTHLY_QUOTA - active.length),
    };
  }

  async requestLeave(employeeId: string, input: { date: string; reason: string }): Promise<OfficeLeaveRecord> {
    const emp = await this.getEmployeeOrThrow(employeeId);
    const leaveDate = String(input?.date || '').slice(0, 10);
    const reason = String(input?.reason || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(leaveDate)) {
      throw new Error('BAD_DATE: Ngày nghỉ không hợp lệ (định dạng YYYY-MM-DD)!');
    }
    if (reason.length < 2) {
      throw new Error('REASON_REQUIRED: Vui lòng nhập lý do xin nghỉ phép!');
    }
    const now = OfficeService.vnNow();
    if (leaveDate.slice(0, 7) !== now.month) {
      throw new Error('LEAVE_MONTH_ONLY: Chỉ được đăng ký nghỉ phép trong tháng hiện tại!');
    }
    if (leaveDate < now.date) {
      throw new Error('LEAVE_IN_PAST: Không thể đăng ký nghỉ cho ngày đã qua!');
    }
    const rule = officeDayRuleOfIso(leaveDate);
    if (!rule.work) {
      throw new Error('LEAVE_DAY_OFF: Ngày bạn chọn là ngày nghỉ tuần (không cần đăng ký nghỉ phép)!');
    }

    return withOfficeLock(async () => {
      const settings = await this.readSettings();
      const all: OfficeLeaveRecord[] = Array.isArray(settings[SETTINGS_KEY_LEAVES]) ? [...settings[SETTINGS_KEY_LEAVES]] : [];
      const activeThisMonth = all.filter(
        (l) => String(l.employee_id) === String(employeeId)
          && String(l.leave_date).slice(0, 7) === now.month
          && ['PENDING_HR', 'PENDING_FINANCE', 'PENDING_DIRECTOR', 'APPROVED'].includes(l.status)
      );
      if (activeThisMonth.length >= OFFICE_LEAVE_MONTHLY_QUOTA) {
        throw new Error(`LEAVE_MONTH_LIMIT: Tháng ${now.month} bạn đã dùng đủ ${OFFICE_LEAVE_MONTHLY_QUOTA}/${OFFICE_LEAVE_MONTHLY_QUOTA} ngày phép. Sang tháng mới hệ thống mở lại (không cộng dồn).`);
      }
      const dup = all.find((l) => String(l.employee_id) === String(employeeId) && l.leave_date === leaveDate && l.status !== 'REJECTED');
      if (dup) throw new Error('LEAVE_DUPLICATE: Bạn đã có phiếu nghỉ phép cho ngày này rồi!');

      const record: OfficeLeaveRecord = {
        leave_id: `VP_LEAVE_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        employee_id: String(employeeId),
        employee_code: String((emp as any).employee_code || ''),
        full_name: String((emp as any).full_name || ''),
        leave_date: leaveDate,
        reason: reason.slice(0, 500),
        status: 'PENDING_HR',
        current_step: 'HR',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        history: [{ step: 'EMPLOYEE', by_id: String(employeeId), by_role: 'EMPLOYEE', name: String((emp as any).full_name || ''), at: new Date().toISOString(), note: reason.slice(0, 500) }],
      };
      all.push(record);
      await this.repo.updateSystemSettings({ [SETTINGS_KEY_LEAVES]: all });
      return record;
    });
  }

  /** Duyệt/từ chối một bước trong chuỗi. actorRole: HR | FINANCE | DIRECTOR | ADMIN. */
  async reviewLeave(leaveId: string, actor: { id: string; role: string; name?: string }, decision: 'APPROVE' | 'REJECT', note?: string): Promise<OfficeLeaveRecord> {
    const id = String(leaveId || '').trim();
    const role = String(actor?.role || '').toUpperCase();
    return withOfficeLock(async () => {
      const settings = await this.readSettings();
      const all: OfficeLeaveRecord[] = Array.isArray(settings[SETTINGS_KEY_LEAVES]) ? [...settings[SETTINGS_KEY_LEAVES]] : [];
      const idx = all.findIndex((l) => String(l.leave_id) === id);
      if (idx < 0) throw new Error('LEAVE_NOT_FOUND: Không tìm thấy phiếu nghỉ phép!');
      const record = all[idx];
      if (record.status === 'APPROVED' || record.status === 'REJECTED') {
        throw new Error('LEAVE_CLOSED: Phiếu đã xử lý xong, không thể duyệt lại!');
      }
      const required = record.current_step;
      if (!required) throw new Error('LEAVE_NO_STEP: Phiếu không còn bước duyệt nào!');
      if (role !== required && role !== 'ADMIN') {
        throw new Error(`LEAVE_WRONG_STEP: Phiếu đang chờ ${OFFICE_ROLE_LABELS[required] || required} duyệt, bạn không có quyền ở bước này!`);
      }
      const at = new Date().toISOString();
      if (decision === 'REJECT') {
        record.status = 'REJECTED';
        record.current_step = null;
        record.rejection_note = String(note || '').slice(0, 500) || `Bị từ chối ở bước ${OFFICE_ROLE_LABELS[required] || required}`;
        record.history.push({ step: required, by_id: String(actor.id), by_role: role, name: actor.name, at, decision: 'REJECT', note: record.rejection_note });
      } else {
        record.history.push({ step: required, by_id: String(actor.id), by_role: role, name: actor.name, at, decision: 'APPROVE', note: note ? String(note).slice(0, 500) : undefined });
        const nextIdx = OFFICE_APPROVAL_CHAIN.indexOf(required) + 1;
        if (nextIdx >= OFFICE_APPROVAL_CHAIN.length) {
          record.status = 'APPROVED';
          record.current_step = null;
        } else {
          const nextRole = OFFICE_APPROVAL_CHAIN[nextIdx];
          record.current_step = nextRole;
          record.status = nextRole === 'FINANCE' ? 'PENDING_FINANCE' : 'PENDING_DIRECTOR';
        }
      }
      record.updated_at = at;
      all[idx] = record;
      await this.repo.updateSystemSettings({ [SETTINGS_KEY_LEAVES]: all });
      return record;
    });
  }

  private async approvedLeaveDates(employeeId: string, from: string, to: string): Promise<Set<string>> {
    const mine = await this.listLeaves(employeeId);
    return new Set(
      mine
        .filter((l) => l.status === 'APPROVED' && l.leave_date >= from && l.leave_date <= to)
        .map((l) => l.leave_date)
    );
  }

  // ==================================================================
  // ĐIỂM DANH VÀO CA / RA CA
  // ==================================================================
  private async allAttendance(): Promise<OfficeAttendanceEvent[]> {
    const settings = await this.readSettings();
    return Array.isArray(settings[SETTINGS_KEY_ATTENDANCE]) ? settings[SETTINGS_KEY_ATTENDANCE] : [];
  }

  private async attendanceByDate(employeeId: string, from: string, to: string): Promise<Map<string, any>> {
    const all = await this.allAttendance();
    const map = new Map<string, any>();
    for (const e of all) {
      if (String(e.employee_id) !== String(employeeId)) continue;
      if (e.date < from || e.date > to) continue;
      const cur = map.get(e.date) || {};
      if (e.type === 'CHECK_IN') cur.check_in = e;
      if (e.type === 'CHECK_OUT') cur.check_out = e;
      map.set(e.date, cur);
    }
    for (const [, v] of map) {
      if (v.check_in && v.check_out) {
        const inT = new Date(v.check_in.at).getTime();
        const outT = new Date(v.check_out.at).getTime();
        v.worked_minutes = Number.isFinite(inT) && Number.isFinite(outT) ? Math.max(0, Math.round((outT - inT) / 60000)) : 0;
      } else {
        v.worked_minutes = 0;
      }
    }
    return map;
  }

  async getAttendance(employeeId: string, fromDate: string, toDate: string) {
    await this.getEmployeeOrThrow(employeeId);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(fromDate || '')) ? String(fromDate).slice(0, 10) : OfficeService.vnNow().date;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(toDate || '')) ? String(toDate).slice(0, 10) : from;
    const map = await this.attendanceByDate(employeeId, from, to);
    const days = Array.from(map.entries()).map(([date, v]) => ({
      date,
      check_in_at: v.check_in?.at || null,
      check_out_at: v.check_out?.at || null,
      worked_minutes: v.worked_minutes || 0,
    }));
    const today = map.get(OfficeService.vnNow().date) || {};
    return {
      from,
      to,
      today: {
        date: OfficeService.vnNow().date,
        check_in_at: today.check_in?.at || null,
        check_out_at: today.check_out?.at || null,
        worked_minutes: today.worked_minutes || 0,
      },
      days,
    };
  }

  private async validateGps(gps: { latitude?: number; longitude?: number; accuracy?: number } | undefined) {
    const branch: any = await this.branchOf();
    const gpsEnabled = isBranchGpsEnabled(branch);
    const hasCoords = !!gps &&
      Number.isFinite(Number(gps.latitude)) &&
      Number.isFinite(Number(gps.longitude));
    if (!gpsEnabled) {
      // Chi nhánh đã tắt định vị: KHÔNG cần toạ độ và KHÔNG chặn bán kính.
      // Nếu thiết bị vẫn gửi toạ độ thì lưu thô để HR đối soát.
      const accuracy = Number(gps?.accuracy);
      const latitude = hasCoords ? Number(gps!.latitude) : undefined;
      const longitude = hasCoords ? Number(gps!.longitude) : undefined;
      const distance = hasCoords
        ? calculateDistanceMeters(latitude as number, longitude as number, branch.latitude, branch.longitude)
        : 0;
      return {
        distance_meters: distance,
        accuracy: Number.isFinite(accuracy) ? accuracy : 0,
        gps_status: 'VALID' as const,
        latitude,
        longitude,
      };
    }
    if (!hasCoords) {
      throw new Error('GPS_REQUIRED: Chưa lấy được vị trí GPS của bạn. Vui lòng bật định vị và thử lại!');
    }
    const latitude = Number(gps!.latitude);
    const longitude = Number(gps!.longitude);
    const accuracy = Number(gps?.accuracy);
    if (Number.isFinite(accuracy) && accuracy > 1000) {
      throw new Error(`GPS_LOW_ACCURACY: Sóng GPS quá yếu (sai số ${Math.round(accuracy)}m). Ra nơi thoáng và thử lại!`);
    }
    const distance = calculateDistanceMeters(latitude, longitude, branch.latitude, branch.longitude);
    // Dung sai theo sai số thiết bị (tối đa 150m): trong nhà/văn phòng kín sóng
    // GPS hay báo sai số 150–300m, trước đây chặn tuyệt đối nên không điểm danh
    // được. Trong bán kính -> VALID; ngoài bán kính nhưng trừ dung sai vẫn có
    // khả năng trong vùng -> ghi nhận kèm cờ LOW_ACCURACY để HR đối soát.
    const tolerance = Number.isFinite(accuracy) ? Math.min(Math.max(accuracy, 0), 150) : 0;
    if (distance > branch.radius_meters + tolerance) {
      throw new Error(`GPS_OUT_OF_BOUNDS: Bạn đang cách văn phòng ${distance}m (bán kính cho phép ${branch.radius_meters}m) nên chưa thể điểm danh!`);
    }
    return {
      distance_meters: distance,
      accuracy: Number.isFinite(accuracy) ? accuracy : 0,
      gps_status: (distance <= branch.radius_meters ? 'VALID' : 'LOW_ACCURACY') as 'VALID' | 'LOW_ACCURACY',
      latitude,
      longitude,
    };
  }

  /**
   * Migrate MỘT LẦN: các lượt điểm danh Văn Phòng đã có trong sổ riêng
   * (office_attendance_events) được mirror sang sổ điểm danh chuẩn để cổng Admin
   * hiển thị đúng lịch sử (trước đây Admin không thấy lượt nào của khối VP).
   * Idempotent — chạy lại không ghi trùng.
   */
  async migrateAttendanceToStandardEvents() {
    const settings = await this.readSettings();
    const list: OfficeAttendanceEvent[] = Array.isArray(settings[SETTINGS_KEY_ATTENDANCE]) ? settings[SETTINGS_KEY_ATTENDANCE] : [];
    let mirrored = 0;
    for (const e of list) {
      const employeeId = String(e?.employee_id || '');
      const date = String(e?.date || '').slice(0, 10);
      const type: 'CHECK_IN' | 'CHECK_OUT' = e?.type === 'CHECK_OUT' ? 'CHECK_OUT' : 'CHECK_IN';
      if (!employeeId || !date) continue;
      try {
        const existing = await this.repo.getAttendanceEvents(employeeId, date).catch(() => []);
        if ((existing || []).some((x: any) => String(x?.type || '') === type && String(x?.client_time || '').slice(0, 10) === date)) continue;
        const emp: any = await this.repo.getEmployeeById(employeeId).catch(() => null);
        if (!emp || !OfficeService.isOfficeEmployee(emp)) continue;
        const shifts = await this.repo.getShiftsForEmployee(employeeId, date, date).catch(() => []);
        const assignment: any = (shifts || []).find((s: any) => String(s?.status || '') !== 'CANCELLED');
        await this.repo.recordAttendanceEvent({
          event_id: `VP_EVT_${type}_${employeeId}_${Date.now()}_${mirrored}`,
          request_id: `OFFICE_${employeeId}_${date}_${type}`,
          assignment_id: String(assignment?.assignment_id || ''),
          employee_id: employeeId,
          branch_id: String(emp?.default_branch_id || assignment?.branch_id || OFFICE_BRANCH_ID),
          type,
          client_time: String(e?.at || `${date}T00:00:00.000Z`),
          server_received_at: new Date().toISOString(),
          gps_latitude: Number(e?.latitude) || undefined,
          gps_longitude: Number(e?.longitude) || undefined,
          gps_accuracy: Number(e?.accuracy) || undefined,
          distance_meters: Number(e?.distance_meters) || undefined,
          gps_status: (e as any)?.gps_status || 'VALID',
          is_late: false,
          minutes_deviation: 0,
          fine_tier: 'NONE',
          fine_amount: 0,
        } as any);
        mirrored += 1;
      } catch { /* bỏ qua lượt lỗi, không chặn khởi động */ }
    }
    return mirrored;
  }

  /** Trạng thái điểm danh hôm nay + khung giờ mở nút VÀO CA. */
  async attendanceState(employeeId: string) {
    await this.getEmployeeOrThrow(employeeId);
    const now = OfficeService.vnNow();
    const map = await this.attendanceByDate(employeeId, now.date, now.date);
    const today = map.get(now.date) || {};
    const open = OFFICE_CHECKIN_OPEN_HOUR * 60 + OFFICE_CHECKIN_OPEN_MINUTE;
    const close = OFFICE_CHECKIN_CLOSE_HOUR * 60 + OFFICE_CHECKIN_CLOSE_MINUTE;
    const rule = officeDayRuleOfIso(now.date);
    const branch: any = await this.branchOf();
    return {
      date: now.date,
      now: now.iso,
      is_workday: rule.work,
      window_open: rule.work && now.minutesOfDay >= open && now.minutesOfDay <= close,
      window_from: `${pad2(OFFICE_CHECKIN_OPEN_HOUR)}:${pad2(OFFICE_CHECKIN_OPEN_MINUTE)}`,
      window_to: `${pad2(OFFICE_CHECKIN_CLOSE_HOUR)}:${pad2(OFFICE_CHECKIN_CLOSE_MINUTE)}`,
      checked_in: !!today.check_in,
      checked_out: !!today.check_out,
      check_in_at: today.check_in?.at || null,
      check_out_at: today.check_out?.at || null,
      worked_minutes: today.worked_minutes || 0,
      // Cấu hình chi nhánh để cổng NV biết toạ độ/bán kính và có bắt buộc GPS không.
      branch: {
        id: OFFICE_BRANCH_ID,
        name: String(branch?.name || ''),
        address: String(branch?.address || ''),
        latitude: Number(branch?.latitude) || 0,
        longitude: Number(branch?.longitude) || 0,
        radius_meters: Number(branch?.radius_meters) || 300,
        gps_enabled: isBranchGpsEnabled(branch),
      },
    };
  }

  async checkIn(employeeId: string, gps?: { latitude?: number; longitude?: number; accuracy?: number }) {
    const emp = await this.getEmployeeOrThrow(employeeId);
    const v = await this.validateGps(gps);
    return withOfficeLock(async () => {
      const now = OfficeService.vnNow();
      const rule = officeDayRuleOfIso(now.date);
      if (!rule.work) throw new Error('OFFICE_DAY_OFF: Hôm nay là ngày nghỉ, không cần vào ca!');
      const open = OFFICE_CHECKIN_OPEN_HOUR * 60 + OFFICE_CHECKIN_OPEN_MINUTE;
      const close = OFFICE_CHECKIN_CLOSE_HOUR * 60 + OFFICE_CHECKIN_CLOSE_MINUTE;
      if (now.minutesOfDay < open) {
        throw new Error(`CHECKIN_NOT_OPEN: Chưa đến giờ vào ca (mở từ ${pad2(OFFICE_CHECKIN_OPEN_HOUR)}:${pad2(OFFICE_CHECKIN_OPEN_MINUTE)}). Vui lòng chờ đúng khung giờ!`);
      }
      if (now.minutesOfDay > close) {
        throw new Error(`CHECKIN_CLOSED: Đã quá khung giờ vào ca (${pad2(OFFICE_CHECKIN_OPEN_HOUR)}:${pad2(OFFICE_CHECKIN_OPEN_MINUTE)}–${pad2(OFFICE_CHECKIN_CLOSE_HOUR)}:${pad2(OFFICE_CHECKIN_CLOSE_MINUTE)}). Liên hệ Nhân sự nếu quên điểm danh!`);
      }
      const settings = await this.readSettings();
      const all: OfficeAttendanceEvent[] = Array.isArray(settings[SETTINGS_KEY_ATTENDANCE]) ? [...settings[SETTINGS_KEY_ATTENDANCE]] : [];
      const mineToday = all.filter((e) => String(e.employee_id) === String(employeeId) && e.date === now.date);
      if (mineToday.some((e) => e.type === 'CHECK_IN')) {
        throw new Error('ALREADY_CHECKED_IN: Hôm nay bạn đã vào ca rồi!');
      }
      const event: OfficeAttendanceEvent = {
        event_id: `VP_ATT_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        employee_id: String(employeeId),
        date: now.date,
        type: 'CHECK_IN',
        at: now.iso,
        latitude: v.latitude,
        longitude: v.longitude,
        accuracy: v.accuracy,
        distance_meters: v.distance_meters,
        gps_status: v.gps_status,
      };
      all.push(event);
      await this.repo.updateSystemSettings({ [SETTINGS_KEY_ATTENDANCE]: all });
      // Mirror sang sổ điểm danh chuẩn để Admin thấy ngay (Lịch tuần/Chấm công/Lương).
      await this.mirrorAttendanceEvent(emp, now, 'CHECK_IN', gps, v, {
        is_late: now.minutesOfDay > OFFICE_CHECKIN_OPEN_HOUR * 60 + OFFICE_CHECKIN_OPEN_MINUTE,
        minutes_deviation: Math.max(0, now.minutesOfDay - (OFFICE_CHECKIN_OPEN_HOUR * 60 + OFFICE_CHECKIN_OPEN_MINUTE)),
      });
      return event;
    });
  }

  async checkOut(employeeId: string, gps?: { latitude?: number; longitude?: number; accuracy?: number }) {
    const emp = await this.getEmployeeOrThrow(employeeId);
    const v = await this.validateGps(gps);
    return withOfficeLock(async () => {
      const now = OfficeService.vnNow();
      const settings = await this.readSettings();
      const all: OfficeAttendanceEvent[] = Array.isArray(settings[SETTINGS_KEY_ATTENDANCE]) ? [...settings[SETTINGS_KEY_ATTENDANCE]] : [];
      const mineToday = all.filter((e) => String(e.employee_id) === String(employeeId) && e.date === now.date);
      if (!mineToday.some((e) => e.type === 'CHECK_IN')) {
        throw new Error('CHECKOUT_WITHOUT_CHECKIN: Bạn chưa vào ca hôm nay nên chưa thể ra ca!');
      }
      if (mineToday.some((e) => e.type === 'CHECK_OUT')) {
        throw new Error('ALREADY_CHECKED_OUT: Hôm nay bạn đã ra ca rồi!');
      }
      const event: OfficeAttendanceEvent = {
        event_id: `VP_ATT_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        employee_id: String(employeeId),
        date: now.date,
        type: 'CHECK_OUT',
        at: now.iso,
        latitude: v.latitude,
        longitude: v.longitude,
        accuracy: v.accuracy,
        distance_meters: v.distance_meters,
        gps_status: v.gps_status,
      };
      all.push(event);
      await this.repo.updateSystemSettings({ [SETTINGS_KEY_ATTENDANCE]: all });
      // Mirror sang sổ điểm danh chuẩn để Admin thấy ngay (Lịch tuần/Chấm công/Lương).
      await this.mirrorAttendanceEvent(emp, now, 'CHECK_OUT', gps, v);
      return event;
    });
  }

  // ==================================================================
  // BỔ SUNG CÔNG (4 phiếu/tháng)
  // ==================================================================
  async listAdjustments(employeeId: string): Promise<OfficeAdjustmentRecord[]> {
    const settings = await this.readSettings();
    const all: OfficeAdjustmentRecord[] = Array.isArray(settings[SETTINGS_KEY_ADJUSTMENTS]) ? settings[SETTINGS_KEY_ADJUSTMENTS] : [];
    return all
      .filter((a) => String(a.employee_id) === String(employeeId))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  async listAllAdjustments(): Promise<OfficeAdjustmentRecord[]> {
    const settings = await this.readSettings();
    const all: OfficeAdjustmentRecord[] = Array.isArray(settings[SETTINGS_KEY_ADJUSTMENTS]) ? settings[SETTINGS_KEY_ADJUSTMENTS] : [];
    return [...all].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  async adjustmentQuota(employeeId: string, now: Date = new Date()) {
    const month = OfficeService.vnNow(now).month;
    const mine = await this.listAdjustments(employeeId);
    const used = mine.filter(
      (a) => OfficeService.vnNow(new Date(a.created_at)).month === month && (a.status === 'PENDING' || a.status === 'APPROVED')
    ).length;
    return {
      month,
      monthUsed: used,
      monthLimit: OFFICE_ADJUST_MONTHLY_QUOTA,
      monthRemaining: Math.max(0, OFFICE_ADJUST_MONTHLY_QUOTA - used),
      locked: used >= OFFICE_ADJUST_MONTHLY_QUOTA,
    };
  }

  async requestAdjustment(employeeId: string, input: { date: string; reason: string; minutesRequested?: number }): Promise<OfficeAdjustmentRecord> {
    const emp = await this.getEmployeeOrThrow(employeeId);
    const workDate = String(input?.date || '').slice(0, 10);
    const reason = String(input?.reason || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) throw new Error('BAD_DATE: Ngày bổ sung công không hợp lệ!');
    if (reason.length < 2) throw new Error('REASON_REQUIRED: Vui lòng nhập lý do bổ sung công!');
    const now = OfficeService.vnNow();
    if (workDate > now.date) throw new Error('ADJUST_FUTURE: Không thể bổ sung công cho ngày chưa tới!');
    return withOfficeLock(async () => {
      const settings = await this.readSettings();
      const all: OfficeAdjustmentRecord[] = Array.isArray(settings[SETTINGS_KEY_ADJUSTMENTS]) ? [...settings[SETTINGS_KEY_ADJUSTMENTS]] : [];
      const monthUsed = all.filter(
        (a) => String(a.employee_id) === String(employeeId) && OfficeService.vnNow(new Date(a.created_at)).month === now.month && (a.status === 'PENDING' || a.status === 'APPROVED')
      ).length;
      if (monthUsed >= OFFICE_ADJUST_MONTHLY_QUOTA) {
        throw new Error(`ADJUST_MONTH_LIMIT: Tháng ${now.month} bạn đã dùng đủ ${OFFICE_ADJUST_MONTHLY_QUOTA}/${OFFICE_ADJUST_MONTHLY_QUOTA} phiếu bổ sung công. Sang tháng mới hệ thống tự mở lại!`);
      }
      const dup = all.find((a) => String(a.employee_id) === String(employeeId) && a.work_date === workDate && a.status === 'PENDING');
      if (dup) throw new Error('ADJUST_DUPLICATE: Bạn đã có phiếu bổ sung công cho ngày này đang chờ duyệt!');
      const record: OfficeAdjustmentRecord = {
        adjustment_id: `VP_ADJ_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        employee_id: String(employeeId),
        employee_code: String((emp as any).employee_code || ''),
        full_name: String((emp as any).full_name || ''),
        work_date: workDate,
        reason: reason.slice(0, 500),
        minutes_requested: Math.max(0, Math.min(24 * 60, Math.floor(Number(input?.minutesRequested) || 0))),
        status: 'PENDING',
        created_at: new Date().toISOString(),
      };
      all.push(record);
      await this.repo.updateSystemSettings({ [SETTINGS_KEY_ADJUSTMENTS]: all });
      return record;
    });
  }

  async reviewAdjustment(adjustmentId: string, actor: { id: string; role: string }, decision: 'APPROVE' | 'REJECT', note?: string): Promise<OfficeAdjustmentRecord> {
    const id = String(adjustmentId || '').trim();
    return withOfficeLock(async () => {
      const settings = await this.readSettings();
      const all: OfficeAdjustmentRecord[] = Array.isArray(settings[SETTINGS_KEY_ADJUSTMENTS]) ? [...settings[SETTINGS_KEY_ADJUSTMENTS]] : [];
      const idx = all.findIndex((a) => String(a.adjustment_id) === id);
      if (idx < 0) throw new Error('ADJUST_NOT_FOUND: Không tìm thấy phiếu bổ sung công!');
      const record = all[idx];
      if (record.status !== 'PENDING') throw new Error('ADJUST_CLOSED: Phiếu đã được xử lý!');
      record.status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      record.reviewed_by = String(actor.id);
      record.reviewed_at = new Date().toISOString();
      record.review_note = String(note || '').slice(0, 500);
      all[idx] = record;
      await this.repo.updateSystemSettings({ [SETTINGS_KEY_ADJUSTMENTS]: all });
      return record;
    });
  }

  // ==================================================================
  // CÔNG CỦA TÔI — LƯƠNG CƠ BẢN THEO THÁNG (không tính theo ca)
  //   Văn phòng: lương cứng theo tháng = Lương CB + phụ cấp (Kế toán cấu hình).
  // ==================================================================
  async getTimesheet(employeeId: string, period: string) {
    const emp = await this.getEmployeeOrThrow(employeeId);
    const p = /^\d{4}-\d{2}$/.test(String(period || '')) ? String(period) : OfficeService.vnNow().month;
    const from = `${p}-01`;
    const to = `${p}-31`;
    const map = await this.attendanceByDate(employeeId, from, to);
    const leaves = await this.approvedLeaveDates(employeeId, from, to);
    // Văn phòng LUÔN lương theo tháng — cấu hình do Kế toán đặt (HR không sửa).
    const cfg = this.salaryConfig ? await this.salaryConfig.getForEmployee(employeeId).catch(() => null) : null;
    const baseSalary = Math.max(0, Math.floor(Number(cfg?.base_salary) || 0));
    const allowance = Math.max(0, Math.floor(Number(cfg?.allowance) || 0));
    const monthlyTotal = baseSalary + allowance;
    let totalMinutes = 0;
    let workDays = 0;
    const days: any[] = [];
    for (const date of Array.from(map.keys()).sort()) {
      const v = map.get(date);
      if (!v?.check_in) continue;
      workDays += 1;
      const minutes = Number(v.worked_minutes) || 0;
      totalMinutes += minutes;
      days.push({
        date,
        check_in_at: v.check_in.at,
        check_out_at: v.check_out?.at || null,
        worked_minutes: minutes,
        hours: Math.round((minutes / 60) * 100) / 100,
        missing_checkout: !v.check_out,
      });
    }
    const hours = Math.round((totalMinutes / 60) * 100) / 100;
    return {
      period: p,
      employee: {
        employee_id: employeeId,
        employee_code: String((emp as any).employee_code || ''),
        full_name: String((emp as any).full_name || ''),
        group: 'VAN_PHONG',
      },
      pay_mode: 'MONTHLY' as const,
      base_salary: baseSalary,
      allowance,
      monthly_total: monthlyTotal,
      work_days: workDays,
      total_hours: hours,
      leave_days: leaves.size,
      total_estimated: monthlyTotal,
      configured: baseSalary > 0 || allowance > 0,
      days,
    };
  }
}
