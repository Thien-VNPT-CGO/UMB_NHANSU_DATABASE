import { v4 as uuidv4 } from 'uuid';
import {
  LeaveRequest,
  LeaveType,
  ShiftAssignment,
  ShiftCode,
  SHIFT_TEMPLATES,
  SwapRequest,
} from '@ubm/shared';
import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { singleWriterQueue } from '../repositories/single-writer-queue.js';
import { weekRangeOf, currentVnWeekRange } from './weekly-off.service.js';

export interface OutOfWeekViolation {
  swap_id: string;
  swap_kind: string;
  status: string;
  created_at: string;
  createdWeek: { mon: string; sun: string };
  shiftDates: string[];
  reason: string;
  reverted: string[];
  skipped: string[];
}

/** Ngày VN (YYYY-MM-DD) của một ISO instant. */
function vnDateOf(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  return new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Ràng buộc tuần đổi/tráo ca: ca phải từ TUẦN HIỆN TẠI trở đi (Mon-Sun chứa
 * hôm nay, giờ VN) — ca của tuần đã qua thì chặn. Tuần tương lai (kể cả tuần
 * sau) được đổi khi HR đã publish lịch tuần đó (kiểm tra PUBLISHED riêng):
 * publish rồi thì áp dụng, chưa publish thì chặn.
 */
function assertSwapDatesAllowed(dates: string[], now: Date = new Date()): { mon: string; sun: string } {
  const wk = currentVnWeekRange(now);
  for (const d of dates) {
    const day = String(d || '').slice(0, 10);
    if (!day || day < wk.mon) {
      throw new Error(
        `SWAP_DATE_IN_PAST: Ca ngày ${day || '?'} đã qua (tuần hiện tại ${wk.mon} → ${wk.sun}) — chỉ đổi/tráo ca từ tuần hiện tại trở đi và tuần đó phải được HR publish.`
      );
    }
  }
  return wk;
}

/**
 * Ràng buộc đổi/tráo ca theo publish: chỉ ca đã được HR PUBLISH (NV đã thấy
 * trên lịch) mới được đổi — ca DRAFT (nháp, HR chưa chốt) thì chặn cả 2 chiều.
 * Ngược lại: tuần nào HR chưa publish thì tuần đó không đổi ca được.
 */
function assertShiftsPublished(shifts: (any | null | undefined)[]): void {
  for (const s of shifts) {
    if (!s) continue;
    if ((s as any).status !== 'PUBLISHED') {
      const day = String((s as any).date || '').slice(0, 10) || '?';
      throw new Error(
        `SWAP_SHIFT_NOT_PUBLISHED: Ca ngày ${day} chưa được HR publish (đang nháp) — chỉ đổi/tráo ca đã publish mà bạn đã thấy trên lịch. Báo HR publish lịch tuần này để mở đổi ca.`
      );
    }
  }
}
import { canonicalBranch } from './auto-schedule.service.js';
import { normSheetDate } from './employees.service.js';
import { Server } from 'socket.io';

export class SchedulesService {
  constructor(
    private repo: ISheetsRepository,
    private io?: Server
  ) {}

  public setSocketServer(io: Server) {
    this.io = io;
  }

  async getShiftsForWeek(branchId: string, weekStartDate: string) {
    return this.repo.getShiftsForWeek(branchId, weekStartDate);
  }

  async getEmployeeShifts(employeeId: string, fromDate: string, toDate: string) {
    return this.repo.getShiftsForEmployee(employeeId, fromDate, toDate);
  }

  async createShift(data: {
    employeeId: string;
    branchId: string;
    shiftCode: ShiftCode;
    date: string;
    actorId: string;
  }) {
    const template = SHIFT_TEMPLATES[data.shiftCode];
    const startHourStr = template.start_hour.toString().padStart(2, '0');
    const endHourStr = template.end_hour.toString().padStart(2, '0');
    const startAt = `${data.date}T${startHourStr}:00:00+07:00`;
    const endAt = `${data.date}T${endHourStr}:00:00+07:00`;

    const assignmentId = `SHIFT_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    return singleWriterQueue.enqueue({
      entityType: 'PHAN_CONG_CA',
      entityId: assignmentId,
      actorId: data.actorId,
      execute: async () => {
        return this.repo.createShiftAssignment({
          assignment_id: assignmentId,
          employee_id: data.employeeId,
          branch_id: data.branchId,
          shift_code: data.shiftCode,
          date: data.date,
          start_at: startAt,
          end_at: endAt,
          status: 'DRAFT',
          schedule_version: 1,
        });
      },
    });
  }

  async publishWeekSchedule(branchId: string, weekStartDate: string, actorId: string) {
    return singleWriterQueue.enqueue({
      entityType: 'LICH_LAM_VIEC',
      entityId: `${branchId}_${weekStartDate}`,
      actorId,
      execute: async () => {
        const shifts = await this.repo.getShiftsForWeek(branchId, weekStartDate);
        // Ca DRAFT của NV bị khóa: giữ nguyên (không publish) — Lịch ẩn NV này.
        const lockedIds = new Set<string>();
        try {
          const accs = await this.repo.listAccounts().catch(() => []);
          for (const a of accs || []) {
            if ((a as any)?.account_status === 'LOCKED' && (a as any)?.employee_id) {
              lockedIds.add(String((a as any).employee_id));
            }
          }
        } catch { /* bỏ qua */ }
        const updatedShifts: ShiftAssignment[] = [];

        for (const shift of shifts) {
          if (shift.status === 'DRAFT' && !lockedIds.has(String((shift as any).employee_id))) {
            const updated = await this.repo.updateShiftAssignment(shift.assignment_id, {
              status: 'PUBLISHED',
              schedule_version: shift.schedule_version + 1,
            });
            updatedShifts.push(updated);
          }
        }

        // Notify branch room
        if (this.io) {
          this.io.to(`branch:${branchId}`).emit('schedule.published', {
            branchId,
            weekStartDate,
            publishedAt: new Date().toISOString(),
          });
        }

        return {
          branchId,
          weekStartDate,
          count: updatedShifts.length,
          status: 'PUBLISHED',
        };
      },
    });
  }

  // --- Leaves ---
  /** Ca làm của NV vào 1 ngày: ca đã xếp lịch (ưu tiên) rớt về ca cố định. */
  private async shiftsOfDay(employeeId: string, date: string, fallbackShift?: string): Promise<string[]> {
    try {
      const ss = await this.repo.getShiftsForEmployee(employeeId, date, date).catch(() => []);
      const codes = [...new Set((ss || [])
        .map((s: any) => String(s?.shift_code || '').toUpperCase())
        .filter((c: string) => /^CA_[123]$/.test(c)))];
      if (codes.length > 0) return codes;
    } catch { /* rớt về ca cố định */ }
    const fb = String(fallbackShift || '').toUpperCase();
    return /^CA_[123]$/.test(fb) ? [fb] : [];
  }

  /** Ràng buộc chống trùng OFF cùng ca cùng chi nhánh: 2 NV cùng ca không được OFF
   *  chung 1 ngày (ai đăng ký trước giữ ngày). Trả về người đã giữ ngày để BOT báo
   *  + chặn đăng ký; null khi được phép (kể cả khi không xác định được ca). */
  async findSameShiftOffClash(
    employeeId: string,
    branchId: string,
    date: string
  ): Promise<{ name: string; slot: string } | null> {
    const d = normSheetDate(date);
    if (!d) return null;
    const [emps, leaves] = await Promise.all([
      this.repo.listEmployees().catch(() => []),
      this.repo.listLeaveRequests().catch(() => []),
    ]);
    const me = (emps || []).find((e: any) => e.employee_id === employeeId) as any;
    if (!me || (me as any).employment_status === 'TERMINATED') return null;
    const myBranch = (me as any).default_branch_id || (me as any).branch_id || branchId;
    const myShifts = await this.shiftsOfDay(employeeId, d, (me as any).default_shift_code);
    if (myShifts.length === 0) return null;
    const offEmpIds = new Set<string>();
    for (const l of leaves || []) {
      if ((l as any).leave_type !== 'HANG_TUAN') continue;
      if (!['APPROVED', 'PENDING'].includes((l as any).status)) continue;
      if (normSheetDate((l as any).requested_date) !== d) continue;
      if ((l as any).employee_id === employeeId) continue;
      offEmpIds.add((l as any).employee_id);
    }
    if (offEmpIds.size === 0) return null;
    for (const o of (emps || []) as any[]) {
      if (!offEmpIds.has(o.employee_id)) continue;
      if (o.employment_status === 'TERMINATED') continue;
      if ((o.default_branch_id || o.branch_id) !== myBranch) continue;
      const oShifts = await this.shiftsOfDay(o.employee_id, d, o.default_shift_code);
      const common = myShifts.find(s => oShifts.includes(s));
      if (common) return { name: String(o.full_name || o.employee_id), slot: common };
    }
    return null;
  }

  /** Câu lỗi chuẩn khi trùng OFF cùng ca (chứa 'đăng ký lại' để UI toast + bắt chọn ngày khác). */
  private sameShiftOffError(date: string, clash: { name: string; slot: string }): Error {
    const dd = `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
    const label = clash.slot === 'CA_1' ? 'Ca 1 (07–12)' : clash.slot === 'CA_2' ? 'Ca 2 (12–18)' : clash.slot === 'CA_3' ? 'Ca 3 (18–23)' : clash.slot;
    return new Error(`⛔ Ngày ${dd} đã có ${clash.name} cùng ${label} đăng ký OFF trước! Vui lòng đăng ký lại ngày khác để không trống ca.`);
  }

  /** Pass mặc định của nút Reset ALL lịch OFF (đổi bằng env WEEKLY_OFF_RESET_PASS). */
  static readonly WEEKLY_OFF_RESET_ALL_DEFAULT_PASS = 'Umbomilk@999';

  /** Reset ALL lịch OFF tuần (HANG_TUAN còn hiệu lực từ hôm nay): hủy toàn bộ để NV
   *  đăng ký lại từ đầu. Xem trước (dryRun) không cần pass; THỰC THI bắt buộc đúng
   *  pass (so ở server, không log pass). Pass mặc định Umbomilk@999. */
  async resetAllWeeklyOff(actorId: string, pass: string, dryRun = true): Promise<{
    dryRun: boolean;
    today: string;
    leaveCount: number;
    employeeCount: number;
    employees: string[];
    cancelledCount: number;
  }> {
    const expected = process.env.WEEKLY_OFF_RESET_PASS || SchedulesService.WEEKLY_OFF_RESET_ALL_DEFAULT_PASS;
    if (!dryRun && String(pass || '') !== String(expected)) {
      throw new Error('RESET_PASS_INVALID: Sai mật khẩu Reset ALL! Liên hệ quản trị để lấy pass.');
    }
    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().split('T')[0];
    const [emps, leaves] = await Promise.all([
      this.repo.listEmployees().catch(() => []),
      this.repo.listLeaveRequests().catch(() => []),
    ]);
    const empById = new Map<string, any>((emps || []).map((e: any) => [e.employee_id, e]));
    const targets = (leaves || []).filter((l: any) => {
      if ((l as any).leave_type !== 'HANG_TUAN') return false;
      if (!['APPROVED', 'PENDING'].includes((l as any).status)) return false;
      return normSheetDate((l as any).requested_date) >= today;
    });
    const empIds = [...new Set(targets.map((l: any) => String((l as any).employee_id)))];
    const employees = empIds.map(id => String(empById.get(id)?.full_name || id)).sort((a, b) => a.localeCompare(b, 'vi'));
    if (dryRun) {
      return { dryRun: true, today, leaveCount: targets.length, employeeCount: empIds.length, employees, cancelledCount: 0 };
    }
    let cancelledCount = 0;
    for (const l of targets) {
      await this.repo.updateLeaveRequest((l as any).request_id, 'CANCELLED', actorId, 'Reset ALL lịch OFF tuần — NV đăng ký lại từ đầu').catch(() => null);
      cancelledCount++;
    }
    await this.repo.recordAuditLog({
      log_id: `LOG_${Date.now()}`,
      actor_id: actorId,
      actor_role: 'HR',
      action: 'WEEKLY_OFF_RESET_ALL',
      target_entity: 'PHIEU_OFF',
      target_id: 'ALL',
      details: `Reset ALL ${cancelledCount} phiếu OFF tuần của ${empIds.length} NV (${employees.slice(0, 20).join(', ')}) — NV đăng ký lại`,
    } as any).catch(() => null);
    return { dryRun: false, today, leaveCount: targets.length, employeeCount: empIds.length, employees, cancelledCount };
  }

  /** Rà soát lịch OFF tuần TRÙNG ca đã đăng ký từ trước (cùng chi nhánh + cùng ca +
   *  cùng ngày, từ hôm nay trở đi). dryRun=true chỉ xem trước; dryRun=false hủy
   *  toàn bộ phiếu trùng (CANCELLED) để NV về trạng thái chưa đăng ký và đăng ký lại.
   *  Trả về chi tiết từng nhóm để HR xác nhận. */
  async resetOverlappingWeeklyOff(actorId: string, dryRun = true): Promise<{
    dryRun: boolean;
    today: string;
    groups: { branch: string; date: string; slot: string; employees: string[]; leaveIds: string[] }[];
    cancelledCount: number;
    overLimit: { employee_id: string; employee: string; week: string; kept: string[]; cancelled: string[]; leaveIds: string[] }[];
    cancelledOverLimitCount: number;
  }> {
    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().split('T')[0];
    const [emps, leaves] = await Promise.all([
      this.repo.listEmployees().catch(() => []),
      this.repo.listLeaveRequests().catch(() => []),
    ]);
    const empById = new Map<string, any>((emps || []).map((e: any) => [e.employee_id, e]));
    // Gom phiếu OFF còn hiệu lực từ hôm nay theo (chi nhánh | ngày | ca).
    const buckets = new Map<string, { branch: string; date: string; slot: string; empIds: string[]; leaveIds: string[] }>();
    for (const l of leaves || []) {
      if ((l as any).leave_type !== 'HANG_TUAN') continue;
      if (!['APPROVED', 'PENDING'].includes((l as any).status)) continue;
      const d = normSheetDate((l as any).requested_date);
      if (!d || d < today) continue;
      const emp = empById.get((l as any).employee_id) as any;
      if (!emp || emp.employment_status === 'TERMINATED') continue;
      const branch = emp.default_branch_id || emp.branch_id || 'CN130';
      const shifts = await this.shiftsOfDay(emp.employee_id, d, emp.default_shift_code);
      for (const slot of shifts) {
        const key = `${branch}|${d}|${slot}`;
        let b = buckets.get(key);
        if (!b) { b = { branch, date: d, slot, empIds: [], leaveIds: [] }; buckets.set(key, b); }
        if (!b.empIds.includes(emp.employee_id)) b.empIds.push(emp.employee_id);
        b.leaveIds.push((l as any).request_id);
      }
    }
    const groups = [...buckets.values()]
      .filter(b => b.empIds.length >= 2)
      .map(b => ({
        ...b,
        employees: b.empIds.map(id => String(empById.get(id)?.full_name || id)),
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.branch.localeCompare(b.branch));
    // Kẹp quá giới hạn: mỗi NV mỗi tuần tối đa 2 ngày OFF (trường hợp lọt 3 ngày do
    // phiếu cũ khác CN / bấm gửi 2 lần / dữ liệu cũ). Giữ 2 phiếu MỚI NHẤT (đúng lần
    // đăng ký cuối trên cổng NV), hủy phần thừa.
    const clamp = await this.clampWeeklyOffOverLimit(actorId, dryRun, leaves, empById, today);
    if (dryRun || (groups.length === 0 && clamp.overLimit.length === 0)) {
      return { dryRun: true, today, groups, cancelledCount: 0, overLimit: clamp.overLimit, cancelledOverLimitCount: 0 };
    }
    let cancelledCount = 0;
    const doneIds = new Set<string>(clamp.doneIds);
    for (const g of groups) {
      for (const lid of g.leaveIds) {
        if (doneIds.has(lid)) continue;
        doneIds.add(lid);
        await this.repo.updateLeaveRequest(lid, 'CANCELLED', actorId, 'Reset lịch OFF trùng ca cùng chi nhánh — NV đăng ký lại theo luật chống trống ca').catch(() => null);
        cancelledCount++;
      }
    }
    await this.repo.recordAuditLog({
      log_id: `LOG_${Date.now()}`,
      actor_id: actorId,
      actor_role: 'HR',
      action: 'WEEKLY_OFF_OVERLAP_RESET',
      target_entity: 'PHIEU_OFF',
      target_id: `${groups.length}_groups`,
      details: `Reset ${cancelledCount} phiếu OFF trùng ca (${groups.map(g => `${g.branch} ${g.date} ${g.slot}: ${g.employees.join(', ')}`).join(' | ')}) + kẹp ${clamp.cancelledCount} phiếu quá 2 ngày/tuần (${clamp.overLimit.map(o => `${o.employee} tuần ${o.week}: giữ ${o.kept.join(', ')}, hủy ${o.cancelled.join(', ')}`).join(' | ')})`,
    } as any).catch(() => null);
    return { dryRun: false, today, groups, cancelledCount, overLimit: clamp.overLimit, cancelledOverLimitCount: clamp.cancelledCount };
  }

  /** Kẹp mỗi NV mỗi tuần tối đa 2 ngày OFF HANG_TUAN (từ hôm nay trở đi). Giữ 2 phiếu
   *  MỚI NHẤT, hủy phần thừa. Dùng cho nút HR + tick tự chữa định kỳ (không cần HR bấm).
   *  Trả về doneIds để caller gộp (tránh hủy trùng với nhóm trùng ca). */
  async clampWeeklyOffOverLimit(
    actorId: string,
    dryRun = true,
    preloadedLeaves?: any[],
    preloadedEmpById?: Map<string, any>,
    preloadedToday?: string
  ): Promise<{
    overLimit: { employee_id: string; employee: string; week: string; kept: string[]; cancelled: string[]; leaveIds: string[] }[];
    cancelledCount: number;
    doneIds: string[];
  }> {
    const today = preloadedToday || new Date(Date.now() + 7 * 3_600_000).toISOString().split('T')[0];
    const leaves = preloadedLeaves || await this.repo.listLeaveRequests().catch(() => []);
    let empById = preloadedEmpById;
    if (!empById) {
      const emps = await this.repo.listEmployees().catch(() => []);
      empById = new Map<string, any>((emps || []).map((e: any) => [e.employee_id, e]));
    }
    const byEmpWeek = new Map<string, any[]>();
    for (const l of leaves || []) {
      if ((l as any).leave_type !== 'HANG_TUAN') continue;
      if (!['APPROVED', 'PENDING'].includes((l as any).status)) continue;
      const d = normSheetDate((l as any).requested_date);
      if (!d || d < today) continue;
      const wk = weekRangeOf(d);
      const k = `${(l as any).employee_id}|${wk.mon}`;
      const arr = byEmpWeek.get(k) || [];
      arr.push(l);
      byEmpWeek.set(k, arr);
    }
    const overLimit: { employee_id: string; employee: string; week: string; kept: string[]; cancelled: string[]; leaveIds: string[] }[] = [];
    for (const [k, arr] of byEmpWeek) {
      if (arr.length <= 2) continue;
      const sorted = [...arr].sort((a, b) =>
        String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
        String(b.request_id || '').localeCompare(String(a.request_id || ''))
      );
      const kept = sorted.slice(0, 2);
      const dropped = sorted.slice(2);
      const [empId, mon] = k.split('|');
      overLimit.push({
        employee_id: empId,
        employee: String(empById.get(empId)?.full_name || empId),
        week: mon,
        kept: kept.map((l: any) => normSheetDate(l.requested_date)),
        cancelled: dropped.map((l: any) => normSheetDate(l.requested_date)),
        leaveIds: dropped.map((l: any) => l.request_id),
      });
    }
    overLimit.sort((a, b) => a.week.localeCompare(b.week) || a.employee.localeCompare(b.employee));
    const doneIds: string[] = [];
    if (dryRun) return { overLimit, cancelledCount: 0, doneIds };
    let cancelledCount = 0;
    for (const o of overLimit) {
      for (const lid of o.leaveIds) {
        await this.repo.updateLeaveRequest(lid, 'CANCELLED', actorId, 'Kẹp về tối đa 2 ngày OFF/tuần — giữ 2 ngày đăng ký mới nhất').catch(() => null);
        doneIds.push(lid);
        cancelledCount++;
      }
    }
    if (cancelledCount > 0) {
      await this.repo.recordAuditLog({
        log_id: `LOG_${Date.now()}`,
        actor_id: actorId,
        actor_role: actorId === 'SYSTEM' ? 'SYSTEM' : 'HR',
        action: 'WEEKLY_OFF_OVERLIMIT_CLAMP',
        target_entity: 'PHIEU_OFF',
        target_id: `${overLimit.length}_employees`,
        details: `Kẹp ${cancelledCount} phiếu quá 2 ngày/tuần (${overLimit.map(o => `${o.employee} tuần ${o.week}: giữ ${o.kept.join(', ')}, hủy ${o.cancelled.join(', ')}`).join(' | ')})`,
      } as any).catch(() => null);
    }
    return { overLimit, cancelledCount, doneIds };
  }

  async requestLeave(data: {
    employeeId: string;
    branchId: string;
    leaveType: LeaveType;
    requestedDate: string;
    shiftCode?: ShiftCode;
    reason: string;
  }) {
    const requestId = `LEAVE_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    // Verify weekly OFF limits (tối đa 2 ngày/tuần HANG_TUAN, tính theo tuần Mon-Sun
    // chứa ngày đăng ký — kể cả đợt mở bù VIP tuần sau).
    // Đếm theo NV, KHÔNG lọc chi nhánh: phiếu cũ khác CN (NV chuyển CN, CN mặc định
    // lệch) vẫn phải tính, nếu không sẽ lọt ngày thứ 3 như ca BẢO CHÂU.
    if (data.leaveType === 'HANG_TUAN') {
      const wk = weekRangeOf(data.requestedDate);
      const existingLeaves = await this.repo.listLeaveRequests(undefined, data.employeeId);
      const weeklyLeaves = existingLeaves.filter(l => {
        if (l.leave_type !== 'HANG_TUAN') return false;
        if (l.status === 'REJECTED' || l.status === 'CANCELLED') return false;
        // So sánh sau chuẩn hóa: ngày lưu dạng locale ('10/07/2026') so thô sẽ lọt đếm.
        const d = normSheetDate(l.requested_date);
        return d >= wk.mon && d <= wk.sun;
      });
      if (weeklyLeaves.length >= 2) {
        throw new Error('WEEKLY_OFF_LIMIT_REACHED: Tối đa 2 ngày OFF hàng tuần theo chính sách.');
      }
      // Cùng ca cùng chi nhánh không OFF chung ngày (ai đăng ký trước giữ ngày).
      const clash = await this.findSameShiftOffClash(data.employeeId, data.branchId, data.requestedDate);
      if (clash) throw this.sameShiftOffError(normSheetDate(data.requestedDate), clash);
    }

    // Lịch OFF 2 ngày/tuần (HANG_TUAN): tự động ghi nhận, không cần phiếu duyệt.
    // Chỉ nghỉ đột xuất (DOT_XUAT) mới tạo phiếu PENDING chờ Store/HR duyệt.
    const isWeeklyOff = data.leaveType === 'HANG_TUAN';
    const nowIso = new Date().toISOString();
    return singleWriterQueue.enqueue({
      entityType: 'PHIEU_OFF',
      entityId: requestId,
      actorId: data.employeeId,
      execute: async () => {
        return this.repo.createLeaveRequest({
          request_id: requestId,
          employee_id: data.employeeId,
          branch_id: data.branchId,
          leave_type: data.leaveType,
          requested_date: data.requestedDate,
          shift_code: data.shiftCode,
          reason: data.reason,
          status: isWeeklyOff ? 'APPROVED' : 'PENDING',
          ...(isWeeklyOff
            ? {
                reviewed_by: 'SYSTEM',
                reviewed_at: nowIso,
                review_note: 'Tự động ghi nhận lịch OFF 2 ngày/tuần',
              }
            : {}),
        });
      },
    });
  }

  /**
   * Đăng ký / cập nhật lại 2 ngày OFF tuần trong MỘT operation nguyên tử.
   * Fix lỗi mở bù VIP: gửi 2 POST rời rạc trước đây bị lỗi nửa chừng
   * (ngày 1 ghi nhận, ngày 2 báo WEEKLY_OFF_LIMIT_REACHED) và không thể
   * "cập nhật lại" khi đã đủ 2 ngày. Nay hủy các đăng ký cũ cùng tuần
   * rồi ghi 2 ngày mới — luôn kết thúc với đúng 2 ngày.
   */
  async replaceWeeklyOff(data: {
    employeeId: string;
    branchId: string;
    day1: string;
    day2: string;
    reason: string;
  }) {
    if (!data.day1 || !data.day2) {
      throw new Error('WEEKLY_OFF_MISSING_DATES: Vui lòng chọn đầy đủ cả 2 ngày nghỉ OFF.');
    }
    if (data.day1 === data.day2) {
      throw new Error('WEEKLY_OFF_DUPLICATE_DATES: Hai ngày nghỉ OFF phải khác nhau.');
    }
    const wk1 = weekRangeOf(data.day1);
    const wk2 = weekRangeOf(data.day2);
    if (wk1.mon !== wk2.mon || wk1.sun !== wk2.sun) {
      throw new Error(
        `WEEKLY_OFF_DIFFERENT_WEEKS: 2 ngày phải nằm trong cùng một tuần Mon-Sun (${wk1.mon} → ${wk1.sun}).`
      );
    }
    // Cùng ca cùng chi nhánh không OFF chung ngày (ai đăng ký trước giữ ngày) —
    // kiểm tra TRƯỚC khi hủy đăng ký cũ để đăng ký lại cùng ngày cũ luôn được phép
    // (phiếu cũ của chính mình không tính là trùng).
    for (const date of [normSheetDate(data.day1), normSheetDate(data.day2)]) {
      const clash = await this.findSameShiftOffClash(data.employeeId, data.branchId, date);
      if (clash) throw this.sameShiftOffError(date, clash);
    }
    return singleWriterQueue.enqueue({
      entityType: 'PHIEU_OFF',
      entityId: `${data.employeeId}_${wk1.mon}`,
      actorId: data.employeeId,
      execute: async () => {
        const nowIso = new Date().toISOString();
        const existing = await this.repo.listLeaveRequests(undefined, data.employeeId);
        const oldOnes = existing.filter(l => {
          if (l.leave_type !== 'HANG_TUAN') return false;
          if (l.status === 'REJECTED' || l.status === 'CANCELLED') return false;
          const d = normSheetDate(l.requested_date);
          return d >= wk1.mon && d <= wk1.sun;
        });
        // Hủy đăng ký cũ cùng tuần (kể cả trùng ngày mới — sẽ ghi lại bên dưới).
        for (const old of oldOnes) {
          await this.repo.updateLeaveRequest(old.request_id, 'CANCELLED', data.employeeId, 'Thay thế bằng đăng ký OFF tuần mới');
        }
        const mkId = () =>
          `LEAVE_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
        const created = [];
        for (const [idx, date] of [data.day1, data.day2].entries()) {
          const requestId = mkId();
          created.push(
            await this.repo.createLeaveRequest({
              request_id: requestId,
              employee_id: data.employeeId,
              branch_id: data.branchId,
              leave_type: 'HANG_TUAN',
              requested_date: date,
              reason: `${data.reason} (Ngày ${idx + 1}: ${date})`,
              status: 'APPROVED',
              reviewed_by: 'SYSTEM',
              reviewed_at: nowIso,
              review_note: 'Tự động ghi nhận lịch OFF 2 ngày/tuần',
            })
          );
        }
        // Tự động hủy ca làm việc trùng ngày OFF: NV đăng ký OFF thì không được
        // xếp ca trùng ngày đó (tránh cảnh báo "đã xếp ca trùng ngày OFF" trên
        // lịch). Hủy MỀM (CANCELLED) để NV/HR có thể khôi phục lại nếu cần.
        let cancelledShifts = 0;
        try {
          const empShifts = await this.repo.getShiftsForEmployee(data.employeeId, wk1.mon, wk1.sun);
          for (const sh of empShifts) {
            if (sh.status === 'CANCELLED') continue;
            const sd = normSheetDate(sh.date);
            if (sd !== normSheetDate(data.day1) && sd !== normSheetDate(data.day2)) continue;
            await this.repo.updateShiftAssignment(sh.assignment_id, { status: 'CANCELLED' });
            cancelledShifts++;
          }
        } catch { /* best-effort: lỗi hủy ca không chặn đăng ký OFF */ }
        if (this.io) {
          for (const c of created) {
            this.io.to(`user:${c.employee_id}`).emit('leave.updated', {
              requestId: c.request_id,
              status: c.status,
            });
          }
          if (cancelledShifts > 0) {
            this.io.to(`user:${data.employeeId}`).emit('data:updated', {
              entity: 'schedules',
              data: { action: 'auto-cancel-shift-on-off', count: cancelledShifts },
              timestamp: new Date().toISOString(),
            });
          }
        }
        return { week: wk1, leaves: created, cancelledShifts };
      },
    });
  }

  async listLeaves(branchId?: string, employeeId?: string) {
    return this.repo.listLeaveRequests(branchId, employeeId);
  }

  /**
   * NV THỬ VIỆC đăng ký 5 ngày OFF trong 12 ngày thử việc (7 làm / 5 OFF):
   *  - Đúng 5 ngày phân biệt, nằm trong [start_date, start_date+11], và đều là
   *    NGÀY TƯƠNG LAI (hôm nay/quá khứ đang trong ca thử việc -> từ chối).
   *  - Một lần duy nhất cho cả kỳ thử việc (đăng ký lại liên hệ Store/HR).
   *  - Xác nhận xong: 5 phiếu THU_VIEC tự duyệt + TỰ XẾP 7 ca làm PUBLISHED
   *    vào các ngày còn lại (ca cố định của NV, rớt về CA_1).
   */
  async registerProbationOff(data: {
    employeeId: string;
    branchId: string;
    dates: string[];
    actorId: string;
  }) {
    const emp = await this.repo.getEmployeeById(data.employeeId);
    if (!emp || (emp as any).employment_status !== 'PROBATION') {
      throw new Error('Chỉ nhân viên đang thử việc mới đăng ký OFF thử việc!');
    }
    const start = normSheetDate((emp as any).start_date);
    if (!start) {
      throw new Error('Hồ sơ chưa có ngày bắt đầu thử việc! Liên hệ HR bổ sung.');
    }
    const windowDays: string[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(`${start}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      windowDays.push(d.toISOString().slice(0, 10));
    }
    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const dates = [...new Set((data.dates || []).map(d => normSheetDate(d)).filter(Boolean))];
    if (dates.length !== 5) {
      throw new Error(`Phải chọn đúng 5 ngày OFF thử việc (đang chọn ${dates.length} ngày)!`);
    }
    for (const d of dates) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !windowDays.includes(d)) {
        throw new Error(`Ngày ${d} nằm ngoài 12 ngày thử việc (${windowDays[0]} → ${windowDays[11]})!`);
      }
      if (d <= today) {
        throw new Error(`Ngày ${d === today ? 'hôm nay' : d} đang trong ca thử việc — không được đăng ký OFF! Chỉ được chọn ngày tương lai.`);
      }
    }
    const existing = await this.repo.listLeaveRequests(undefined, data.employeeId);
    const already = existing.filter(
      l =>
        (l as any).leave_type === 'THU_VIEC' &&
        l.status !== 'REJECTED' &&
        l.status !== 'CANCELLED' &&
        l.requested_date >= windowDays[0] &&
        l.requested_date <= windowDays[11]
    );
    if (already.length > 0) {
      throw new Error('Bạn đã đăng ký 5 ngày OFF thử việc rồi! Muốn đổi ngày liên hệ Store/HR.');
    }
    const shiftCode = (['CA_1', 'CA_2', 'CA_3'] as string[]).includes((emp as any).default_shift_code)
      ? ((emp as any).default_shift_code as ShiftCode)
      : 'CA_1';
    const shiftFallback = !(emp as any).default_shift_code;
    const template = SHIFT_TEMPLATES[shiftCode];
    const branchId = data.branchId || (emp as any).default_branch_id || 'CN130';
    const offSet = new Set(dates);
    const workDays = windowDays.filter(d => !offSet.has(d));
    const nowIso = new Date().toISOString();
    return singleWriterQueue.enqueue({
      entityType: 'PHIEU_OFF',
      entityId: `${data.employeeId}_PROBATION`,
      actorId: data.actorId,
      execute: async () => {
        const leaves = [];
        for (const [idx, date] of dates.entries()) {
          leaves.push(
            await this.repo.createLeaveRequest({
              request_id: `LEAVE_${Date.now()}_${idx}_${Math.floor(Math.random() * 100000)}`,
              employee_id: data.employeeId,
              branch_id: branchId,
              leave_type: 'THU_VIEC',
              requested_date: date,
              reason: `Đăng ký OFF thử việc (ngày ${idx + 1}/5 trong 12 ngày thử việc)`,
              status: 'APPROVED',
              reviewed_by: 'SYSTEM',
              reviewed_at: nowIso,
              review_note: 'Tự động ghi nhận 5 ngày OFF thử việc',
            })
          );
        }
        const shifts = [];
        for (const date of workDays) {
          const dup = await this.repo.getShiftsForEmployee(data.employeeId, date, date);
          if (dup.some(s => s.date === date)) continue;
          shifts.push(
            await this.repo.createShiftAssignment({
              assignment_id: `SHIFT_${Date.now()}_${Math.floor(Math.random() * 1000000)}`,
              employee_id: data.employeeId,
              branch_id: branchId,
              shift_code: shiftCode,
              date,
              start_at: `${date}T${String(template.start_hour).padStart(2, '0')}:00:00+07:00`,
              end_at: `${date}T${String(template.end_hour).padStart(2, '0')}:00:00+07:00`,
              status: 'PUBLISHED',
              schedule_version: 1,
            })
          );
        }
        // Tự động hủy ca trùng ngày OFF thử việc: NV chọn OFF ngày X mà ngày X đã
        // có ca xếp sẵn (VD ca thử việc cũ) → hủy ca đó (CANCELLED) để không bị
        // cảnh báo "đã xếp ca trùng ngày OFF" trên lịch.
        let cancelledShifts = 0;
        try {
          const existingShifts = await this.repo.getShiftsForEmployee(data.employeeId, windowDays[0], windowDays[11]);
          for (const s of existingShifts) {
            if (s.status === 'CANCELLED') continue;
            const sd = normSheetDate(s.date);
            if (!offSet.has(sd)) continue;
            await this.repo.updateShiftAssignment(s.assignment_id, { status: 'CANCELLED' });
            cancelledShifts++;
          }
        } catch { /* best-effort: OFF vẫn đăng ký, ca xử lý sau */ }
        if (this.io && cancelledShifts > 0) {
          this.io.to(`user:${data.employeeId}`).emit('data:updated', {
            entity: 'schedules',
            data: { action: 'auto-cancel-shift-on-probation-off', count: cancelledShifts },
            timestamp: new Date().toISOString(),
          });
        }
        if (this.io) {
          for (const c of leaves) {
            this.io.to(`user:${c.employee_id}`).emit('leave.updated', {
              requestId: c.request_id,
              status: c.status,
            });
          }
        }
        return {
          window: { mon: windowDays[0], sun: windowDays[11] },
          offDates: dates.sort(),
          workDates: workDays,
          shiftCode,
          shiftFallback,
          leaves,
          shifts: shifts.map(s => ({ date: s.date, shift_code: s.shift_code })),
        };
      },
    });
  }

  /**
   * NV thử việc TỰ thêm ca đẩy nhanh tiến độ — KHÔNG cần HR duyệt.
   *  - Chỉ NV đang PROBATION, ngày trong 12 ngày thử việc, không chọn ngày quá khứ.
   *  - Ràng buộc cứng: tối đa 2 ca/ngày (kiểm tra TRONG queue để chống bấm đúp/
   *    gọi song song mà lọt 3 ca). Vượt -> ném MAX_2_SHIFTS_PER_DAY (route sẽ
   *    báo HR), trùng ca -> SHIFT_ALREADY_EXISTS.
   *  - Ca tạo thẳng PUBLISHED để NV điểm danh được ngay.
   */
  async addProbationExtraShift(data: {
    employeeId: string;
    date: string;
    shiftCode: ShiftCode;
    actorId: string;
  }) {
    const emp = await this.repo.getEmployeeById(data.employeeId);
    if (!emp || (emp as any).employment_status !== 'PROBATION') {
      throw new Error('Chỉ nhân viên đang thử việc mới được tự thêm ca đẩy nhanh!');
    }
    const start = normSheetDate((emp as any).start_date);
    if (!start) {
      throw new Error('Hồ sơ chưa có ngày bắt đầu thử việc! Liên hệ HR bổ sung.');
    }
    const windowDays: string[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(`${start}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      windowDays.push(d.toISOString().slice(0, 10));
    }
    const date = String(data.date || '').slice(0, 10);
    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !windowDays.includes(date)) {
      throw new Error(`Ngày ${date || '?'} nằm ngoài 12 ngày thử việc (${windowDays[0]} → ${windowDays[11]})!`);
    }
    if (date < today) {
      throw new Error(`Ngày ${date} đã qua — chỉ được thêm ca từ hôm nay trở đi!`);
    }
    const template = SHIFT_TEMPLATES[data.shiftCode];
    if (!template) {
      throw new Error(`Mã ca ${data.shiftCode} không hợp lệ!`);
    }
    const branchId = (emp as any).default_branch_id || 'CN130';
    return singleWriterQueue.enqueue({
      entityType: 'PHAN_CONG_CA',
      entityId: `${data.employeeId}_${date}`,
      actorId: data.actorId,
      execute: async () => {
        const existing = (await this.repo.getShiftsForEmployee(data.employeeId, date, date))
          .filter(s => String(s.date || '').slice(0, 10) === date && s.status !== 'CANCELLED');
        if (existing.length >= 2) {
          throw new Error(`MAX_2_SHIFTS_PER_DAY: Ngày ${date} của bạn đã đủ 2 ca (${existing.map(s => s.shift_code).join(' + ')}) — hệ thống KHÔNG cho xếp thêm, đã báo Nhân sự theo dõi!`);
        }
        if (existing.some(s => s.shift_code === data.shiftCode)) {
          throw new Error(`Ca ${data.shiftCode} ngày ${date} đã có rồi — hãy chọn ca khác!`);
        }
        return this.repo.createShiftAssignment({
          assignment_id: `SHIFT_${Date.now()}_${Math.floor(Math.random() * 1000000)}`,
          employee_id: data.employeeId,
          branch_id: branchId,
          shift_code: data.shiftCode,
          date,
          start_at: `${date}T${String(template.start_hour).padStart(2, '0')}:00:00+07:00`,
          end_at: `${date}T${String(template.end_hour).padStart(2, '0')}:00:00+07:00`,
          status: 'PUBLISHED',
          schedule_version: 1,
        });
      },
    });
  }

  async reviewLeave(requestId: string, status: 'APPROVED' | 'REJECTED', reviewerId: string, note?: string) {
    return singleWriterQueue.enqueue({
      entityType: 'PHIEU_OFF',
      entityId: requestId,
      actorId: reviewerId,
      execute: async () => {
        // Chống bấm trùng (danh sách cũ, 2 người cùng duyệt, retry mạng): chỉ phiếu
        // đang PENDING mới được xử lý — đã duyệt/từ chối/xóa thì báo rõ để tải lại.
        const preCheck = await this.repo.listLeaveRequests().catch(() => []);
        const current = (preCheck || []).find(l => l.request_id === requestId);
        if (!current) {
          throw new Error('LEAVE_NOT_FOUND: Đơn nghỉ không tồn tại (có thể đã bị xóa). Tải lại danh sách!');
        }
        if ((current as any).status !== 'PENDING') {
          const label = (current as any).status === 'APPROVED' ? 'đã duyệt'
            : (current as any).status === 'REJECTED' ? 'đã từ chối'
            : String((current as any).status);
          throw new Error(`LEAVE_NOT_PENDING: Đơn này ${label} rồi, không xử lý lại! Tải lại danh sách.`);
        }
        // Lịch OFF tuần (HANG_TUAN) tự động ghi nhận — bản ghi PENDING cũ (trước thời
        // điểm auto-approve) được tự chữa thành APPROVED thay vì báo lỗi kẹt mãi.
        const all = await this.repo.listLeaveRequests();
        const existing = all.find(l => l.request_id === requestId);
        if (existing && existing.leave_type === 'HANG_TUAN') {
          if (existing.status === 'APPROVED') return existing;
          const healed = await this.repo.updateLeaveRequest(
            requestId,
            'APPROVED',
            'SYSTEM',
            'Tự động ghi nhận lịch OFF 2 ngày/tuần'
          );
          if (this.io) {
            this.io.to(`user:${healed.employee_id}`).emit('leave.updated', {
              requestId: healed.request_id,
              status: healed.status,
            });
          }
          return healed;
        }
        const updated = await this.repo.updateLeaveRequest(requestId, status, reviewerId, note);

        if (this.io) {
          this.io.to(`user:${updated.employee_id}`).emit('leave.updated', {
            requestId: updated.request_id,
            status: updated.status,
            note: updated.review_note,
          });
        }

        return updated;
      },
    });
  }

  // --- Shift Swap ---
  // NV tự tráo đổi với nhau: KHÔNG có phụ cấp +30k (chỉ HR điều phối mới có).
  async requestSwap(data: {
    requesterId: string;
    requesterAssignmentId: string;
    targetEmployeeId: string;
    targetAssignmentId: string;
    reason: string;
  }) {
    const swapId = `SWAP_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    // Chặn ngay từ lúc gửi: ca phải tồn tại + nằm trong tuần hiện tại.
    const reqSh = data.requesterAssignmentId
      ? await this.repo.getShiftById(data.requesterAssignmentId).catch(() => null)
      : null;
    const tgtSh = data.targetAssignmentId
      ? await this.repo.getShiftById(data.targetAssignmentId).catch(() => null)
      : null;
    if (data.requesterAssignmentId && !reqSh) throw new Error('SWAP_SHIFT_NOT_FOUND: Ca của bạn không còn tồn tại.');
    if (data.targetAssignmentId && !tgtSh) throw new Error('SWAP_SHIFT_NOT_FOUND: Ca của đồng nghiệp không còn tồn tại.');
    if (reqSh && (reqSh as any).status === 'CANCELLED') throw new Error('SWAP_SHIFT_CANCELLED: Ca của bạn đã bị hủy, không thể đổi.');
    if (tgtSh && (tgtSh as any).status === 'CANCELLED') throw new Error('SWAP_SHIFT_CANCELLED: Ca của đồng nghiệp đã bị hủy, không thể đổi.');
    // Lịch phải được HR publish (NV đã thấy) thì mới đổi — ca nháp chặn cả 2 chiều.
    assertShiftsPublished([reqSh, tgtSh]);
    assertSwapDatesAllowed(
      [reqSh ? (reqSh as any).date : '', tgtSh ? (tgtSh as any).date : ''].filter(Boolean)
    );
    return singleWriterQueue.enqueue({
      entityType: 'PHIEU_DOI_CA',
      entityId: swapId,
      actorId: data.requesterId,
      execute: async () => {
        // Chống trùng phiếu: bấm đúp / retry mạng gửi 2 POST cùng nội dung thì
        // chỉ giữ 1 phiếu PENDING — phiếu sau bị từ chối rõ ràng, không tạo đôi.
        const existing = await this.repo.listSwapRequests().catch(() => []);
        const dup = (existing || []).find((s: any) =>
          (s as any).status === 'PENDING_PARTNER' &&
          (s as any).requester_id === data.requesterId &&
          (s as any).requester_assignment_id === data.requesterAssignmentId &&
          (s as any).target_employee_id === data.targetEmployeeId &&
          (s as any).target_assignment_id === data.targetAssignmentId
        );
        if (dup) {
          throw new Error('SWAP_DUPLICATE: Bạn đã có phiếu đổi ca cùng nội dung đang chờ duyệt, không cần gửi lại!');
        }
        const swap = await this.repo.createSwapRequest({
          swap_id: swapId,
          swap_kind: 'EMPLOYEE_SWAP',
          requester_id: data.requesterId,
          requester_assignment_id: data.requesterAssignmentId,
          target_employee_id: data.targetEmployeeId,
          target_assignment_id: data.targetAssignmentId,
          reason: data.reason,
          status: 'PENDING_PARTNER',
          bonus_amount: 0,
        });

        // Notify partner
        if (this.io) {
          this.io.to(`user:${data.targetEmployeeId}`).emit('swap.updated', {
            swapId,
            status: 'PENDING_PARTNER',
            from: data.requesterId,
          });
        }

        return swap;
      },
    });
  }

  /**
   * HR tạo phiếu điều phối nhường ca (mở cho cả chi nhánh nhận, +30.000đ cho
   * người nhận làm thay khi duyệt). requester = chủ ca cần người làm thay.
   */
  async createDispatch(data: {
    requesterId: string;
    requesterAssignmentId: string;
    branchId: string;
    reason: string;
    actorId: string;
  }) {
    const shift = await this.repo.getShiftById(data.requesterAssignmentId);
    if (!shift) throw new Error('SHIFT_NOT_FOUND_FOR_DISPATCH');
    if ((shift as any).status === 'CANCELLED') throw new Error('SWAP_SHIFT_CANCELLED: Ca cần người làm thay đã bị hủy.');
    assertShiftsPublished([shift]);
    assertSwapDatesAllowed([(shift as any).date]);
    const swapId = `DISP_${Date.now()}`;
    return singleWriterQueue.enqueue({
      entityType: 'PHIEU_DOI_CA',
      entityId: swapId,
      actorId: data.actorId,
      execute: async () => {
        // HR tạo phiếu hỗ trợ ca vào ngày người nhận đã đăng ký OFF → tự động
        // hủy ngày OFF đó (đi làm thì không còn OFF), tránh cảnh báo ca trùng OFF.
        const receiverId = String((shift as any).employee_id || '');
        const shiftDate = String((shift as any).date || '').slice(0, 10);
        let cancelledOffNote = '';
        if (receiverId && shiftDate) {
          const leaves = await this.repo.listLeaveRequests(undefined, receiverId).catch(() => []);
          for (const l of leaves || []) {
            const ld = String((l as any).requested_date || '').slice(0, 10);
            const st = String((l as any).status || '');
            if (ld !== shiftDate) continue;
            if (st !== 'APPROVED' && st !== 'PENDING') continue;
            await this.repo.updateLeaveRequest(
              (l as any).request_id,
              'CANCELLED',
              'SYSTEM',
              `Tự động hủy: HR hỗ trợ ca làm ngày ${shiftDate} — đi làm thì không còn OFF.`
            ).catch(() => null);
            const kind = (l as any).leave_type === 'HANG_TUAN' ? 'ngày OFF' : 'đơn nghỉ';
            cancelledOffNote = `Ngày ${kind} ${shiftDate} của nhân viên đã tự động hủy vì được hỗ trợ ca làm.`;
          }
        }
        const swap = await this.repo.createSwapRequest({
          swap_id: swapId,
          swap_kind: 'HR_DISPATCH',
          requester_id: data.requesterId,
          requester_assignment_id: data.requesterAssignmentId,
          target_employee_id: '',
          target_assignment_id: '',
          reason: data.reason,
          status: 'PENDING_PARTNER',
          bonus_amount: 0,
        });

        if (this.io) {
          this.io.to(`branch:${data.branchId}`).emit('swap.updated', {
            swapId,
            status: 'PENDING_PARTNER',
            kind: 'HR_DISPATCH',
          });
          if (cancelledOffNote) {
            this.io.to(`user:${receiverId}`).emit('system:notification', {
              type: 'SYSTEM',
              origin: 'ADMIN',
              title: '📅 Ngày OFF đã tự động hủy',
              message: cancelledOffNote,
              timestamp: new Date().toISOString(),
            });
          }
        }

        return swap;
      },
    });
  }

  /**
   * HR chuyển ca hỗ trợ chi nhánh: A (có ca) nhường ca cho B (NV chính thức,
   * thường khác chi nhánh) làm thay. B xác nhận trên cổng NV là ca chuyển sang
   * B ngay (HR đã duyệt từ lúc gửi, không cần duyệt thêm). Từ chối thì ca ở
   * nguyên với A.
   */
  async createSupportRequest(data: {
    requesterAssignmentId: string;
    targetEmployeeId: string;
    reason: string;
    actorId: string;
  }) {
    const shift = await this.repo.getShiftById(data.requesterAssignmentId).catch(() => null);
    if (!shift) throw new Error('SWAP_SHIFT_NOT_FOUND: Ca nhường không còn tồn tại.');
    if ((shift as any).status === 'CANCELLED') throw new Error('SWAP_SHIFT_CANCELLED: Ca nhường đã bị hủy.');
    // Chỉ nhường ca đã publish (NV đã thấy) từ tuần hiện tại trở đi.
    assertShiftsPublished([shift]);
    const day = String((shift as any).date || '').slice(0, 10);
    const branchId = String((shift as any).branch_id || '');
    const shiftCode = (shift as any).shift_code as ShiftCode;
    assertSwapDatesAllowed([day]);
    const ownerId = String((shift as any).employee_id || '');
    if (!ownerId) throw new Error('SWAP_SHIFT_NOT_FOUND: Ca nhường chưa gán nhân viên.');
    const owner = await this.repo.getEmployeeById(ownerId).catch(() => null);
    if (!owner || (owner as any).employment_status === 'TERMINATED') {
      throw new Error('SUPPORT_OWNER_INVALID: Chủ ca đã nghỉ việc, không thể nhường ca này!');
    }
    const target = await this.repo.getEmployeeById(data.targetEmployeeId).catch(() => null);
    if (!target || (target as any).employment_status !== 'OFFICIAL') {
      throw new Error('SUPPORT_NOT_OFFICIAL: Chỉ điều nhân viên CHÍNH THỨC đi hỗ trợ chi nhánh!');
    }
    if (data.targetEmployeeId === ownerId) {
      throw new Error('SUPPORT_SAME_EMPLOYEE: Nhân viên nhận hỗ trợ phải khác chủ ca!');
    }
    // Báo sớm cho HR: B đã có đúng ca đó ngày đó thì không nhận trùng được.
    const dayShifts = await this.repo.getShiftsForEmployee(data.targetEmployeeId, day, day).catch(() => []);
    const clash = (dayShifts || []).find((s: any) =>
      (s as any).shift_code === shiftCode && (s as any).status !== 'CANCELLED');
    if (clash) {
      throw new Error(`SUPPORT_SHIFT_CONFLICT: Nhân viên đã có ${shiftCode} ngày ${day}, không thể nhận trùng ca!`);
    }
    const swapId = `SUP_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    return singleWriterQueue.enqueue({
      entityType: 'PHIEU_DOI_CA',
      entityId: swapId,
      actorId: data.actorId,
      execute: async () => {
        // Chống gửi đôi cùng nội dung đang chờ.
        const existing = await this.repo.listSwapRequests().catch(() => []);
        const dup = (existing || []).find((s: any) =>
          (s as any).status === 'PENDING_PARTNER' &&
          (s as any).swap_kind === 'HR_SUPPORT' &&
          (s as any).requester_assignment_id === data.requesterAssignmentId &&
          (s as any).target_employee_id === data.targetEmployeeId
        );
        if (dup) {
          throw new Error('SWAP_DUPLICATE: Đã có phiếu hỗ trợ y hệt đang chờ nhân viên xác nhận!');
        }
        const swap = await this.repo.createSwapRequest({
          swap_id: swapId,
          swap_kind: 'HR_SUPPORT',
          requester_id: ownerId,
          requester_assignment_id: data.requesterAssignmentId,
          target_employee_id: data.targetEmployeeId,
          target_assignment_id: '',
          reason: data.reason,
          status: 'PENDING_PARTNER',
          bonus_amount: 0,
          // Snapshot ca nhường để hiển thị + rà soát (ca gốc vẫn tra được qua assignment).
          support_branch_id: branchId,
          support_date: day,
          support_shift_code: shiftCode,
        } as any);

        if (this.io) {
          this.io.to(`user:${data.targetEmployeeId}`).emit('swap.updated', {
            swapId,
            status: 'PENDING_PARTNER',
            kind: 'HR_SUPPORT',
            from: data.actorId,
          });
        }

        return swap;
      },
    });
  }

  /**
   * Nhận ca làm thay thì không thể đồng thời OFF: người nhận ca (đi làm) mà
   * đang có đơn OFF/nghỉ (đã duyệt hoặc chờ duyệt) đúng ngày ca đó thì hệ
   * thống TỰ ĐỘNG HỦY ngày OFF đó (ghi chú rõ, realtime + Sheets như mọi đổi
   * trạng thái). VD: A OFF ngày X, B nhường ca ngày X cho A — A đồng ý thì ngày
   * OFF của A mất, ca sang A, B nghỉ.
   */
  private async cancelReceiverLeavesOnWorkDay(employeeId: string, date: string): Promise<string[]> {
    const notes: string[] = [];
    try {
      const day = String(date || '').slice(0, 10);
      if (!employeeId || !day) return notes;
      const leaves = await this.repo.listLeaveRequests(undefined, employeeId).catch(() => []);
      for (const l of leaves || []) {
        const ld = String((l as any).requested_date || '').slice(0, 10);
        const st = String((l as any).status || '');
        if (ld !== day) continue;
        if (st !== 'APPROVED' && st !== 'PENDING') continue;
        await this.repo.updateLeaveRequest(
          (l as any).request_id,
          'CANCELLED',
          'SYSTEM',
          `Tự động hủy: nhận làm thay ca ngày ${day} — đi làm thì không còn OFF.`
        ).catch(() => null);
        const kind = (l as any).leave_type === 'HANG_TUAN' ? 'ngày OFF' : 'đơn nghỉ';
        notes.push(`Ngày ${kind} ${day} của bạn đã tự động hủy vì bạn nhận làm ca này.`);
      }
    } catch { /* best-effort: ca vẫn chuyển, OFF xử lý sau */ }
    return [...new Set(notes)];
  }

  /**
   * Dọn phiếu trùng y hệt còn chờ sau khi 1 phiếu đã chốt (APPROVED/REJECTED):
   * dữ liệu cũ gửi đôi để lại 2 phiếu PENDING cùng nội dung — duyệt phiếu này
   * mà để phiếu kia lại thì B bấm tiếp sẽ hoán đổi NGƯỢC lịch về chủ cũ.
   */
  private async cancelSiblingPendingSwaps(keepSwapId: string, ref: any): Promise<number> {
    try {
      const all = await this.repo.listSwapRequests().catch(() => []);
      let n = 0;
      for (const s of all || []) {
        if ((s as any).swap_id === keepSwapId) continue;
        if ((s as any).status !== 'PENDING_PARTNER') continue;
        if ((s as any).swap_kind !== (ref as any).swap_kind) continue;
        if ((s as any).requester_assignment_id !== (ref as any).requester_assignment_id) continue;
        if ((s as any).target_employee_id !== (ref as any).target_employee_id) continue;
        if ((s as any).target_assignment_id !== (ref as any).target_assignment_id) continue;
        await this.repo.updateSwapRequest((s as any).swap_id, {
          status: 'CANCELLED',
          rejection_reason: 'Tự động hủy: trùng phiếu đã xử lý',
        } as any).catch(() => null);
        n++;
      }
      return n;
    } catch {
      return 0;
    }
  }

  async respondSwapPartner(swapId: string, partnerId: string, accept: boolean) {
    return singleWriterQueue.enqueue({
      entityType: 'PHIEU_DOI_CA',
      entityId: swapId,
      actorId: partnerId,
      execute: async () => {
        let swap = await this.repo.getSwapById(swapId);
        if (!swap) throw new Error('SWAP_REQUEST_NOT_FOUND');
        // Tự chữa dữ liệu cũ gửi đôi cùng mili-giây (2 dòng trùng swap_id, 1 đã
        // xử lý + 1 PENDING ma): đồng bộ tất cả về trạng thái cao nhất để banner
        // B hết kẹt — click tiếp theo nhận đúng trạng thái thật từ server.
        try {
          const allSwaps = await this.repo.listSwapRequests().catch(() => []);
          const sameId = (allSwaps || []).filter((s: any) => (s as any).swap_id === swapId);
          if (sameId.length > 1) {
            const rank = (st: string) =>
              st === 'APPROVED' ? 3 : st === 'PARTNER_ACCEPTED' ? 2
                : (st === 'REJECTED' || st === 'CANCELLED') ? 1 : 0;
            const best = sameId.reduce((a: any, b: any) =>
              rank(String((b as any).status)) >= rank(String((a as any).status)) ? b : a);
            if (String((best as any).status) !== 'PENDING_PARTNER') {
              await this.repo.updateSwapRequest(swapId, { status: (best as any).status } as any);
              swap = (await this.repo.getSwapById(swapId)) || swap;
            }
          }
        } catch { /* best-effort: guard bên dưới vẫn quyết định đúng */ }
        // Phiếu chỉ được xử lý 1 lần khi đang chờ B xác nhận — bấm đúp Đồng ý /
        // danh sách cũ retry mà duyệt lại sẽ hoán đổi NGƯỢC lịch về chủ cũ nhưng
        // vẫn báo thành công (reload thấy phiếu/lịch như chưa đổi).
        if ((swap as any).status !== 'PENDING_PARTNER') {
          const label = (swap as any).status === 'APPROVED' ? 'đã duyệt xong'
            : (swap as any).status === 'REJECTED' ? 'đã bị từ chối'
            : (swap as any).status === 'CANCELLED' ? 'đã bị hủy'
            : `đang ở trạng thái ${(swap as any).status}`;
          throw new Error(`SWAP_ALREADY_HANDLED: Phiếu này ${label} rồi, không xử lý lại! Tải lại danh sách.`);
        }
        const isOpenDispatch =
          (swap as any).swap_kind === 'HR_DISPATCH' && !swap.target_employee_id;
        if (!isOpenDispatch && swap.target_employee_id !== partnerId) {
          throw new Error('SWAP_FORBIDDEN');
        }
        if (swap.requester_id === partnerId) {
          throw new Error('CANNOT_ACCEPT_OWN_DISPATCH: Không thể tự nhận ca mình nhờ.');
        }
        // Đồng ý phiếu ngoài tuần hiện tại -> chặn (kể cả tráo tay đôi tự hoàn tất).
        // Từ chối thì luôn cho qua để dọn phiếu.
        if (accept) {
          const dates: string[] = [];
          const rSh = swap.requester_assignment_id
            ? await this.repo.getShiftById(swap.requester_assignment_id).catch(() => null)
            : null;
          const tSh = swap.target_assignment_id
            ? await this.repo.getShiftById(swap.target_assignment_id).catch(() => null)
            : null;
          if (rSh) dates.push((rSh as any).date);
          if (tSh) dates.push((tSh as any).date);
          if (dates.length > 0) assertSwapDatesAllowed(dates);
          // Ca phải còn ở trạng thái đã publish lúc B nhận (chặn ca bị gỡ/hủy sau khi gửi).
          assertShiftsPublished([rSh, tSh]);
        }

        // NV tự thỏa thuận với nhau: B bấm Đồng ý là chuyển ca ngay,
        // KHÔNG cần HR duyệt nữa (vẫn không phụ cấp +30k).
        // - Tráo tay đôi (A ⇄ B, đủ 2 ca): hoán đổi người trực.
        // - Nhờ làm thay 1 chiều (không có ca đối ứng): chuyển ca A sang B.
        // HR chuyển ca hỗ trợ chi nhánh (A nhường ca cho B): B đồng ý là ca
        // chuyển sang B ngay (HR đã duyệt từ lúc gửi, không phụ cấp).
        if ((swap as any).swap_kind === 'HR_SUPPORT') {
          if (!accept) {
            const supportRejected = await this.repo.updateSwapRequest(swapId, {
              status: 'REJECTED',
              rejection_reason: 'Nhân viên từ chối hỗ trợ chi nhánh',
              partner_responded_at: new Date().toISOString(),
            } as any);
            await this.cancelSiblingPendingSwaps(swapId, swap);
            if (this.io) {
              this.io.to(`user:${swap.requester_id}`).emit('swap.updated', { swapId, status: 'REJECTED' });
            }
            return supportRejected;
          }
          // Ca nhường phải còn nguyên (đã publish, vẫn thuộc A) lúc B nhận.
          const coverShift = await this.repo.getShiftById(swap.requester_assignment_id).catch(() => null);
          if (!coverShift) {
            throw new Error('SHIFTS_NOT_FOUND_FOR_SWAP: Ca nhường không còn tồn tại!');
          }
          if ((coverShift as any).status === 'CANCELLED') {
            throw new Error('SWAP_SHIFT_CANCELLED: Ca nhường đã bị hủy!');
          }
          assertShiftsPublished([coverShift]);
          assertSwapDatesAllowed([String((coverShift as any).date || '').slice(0, 10)]);
          if (String((coverShift as any).employee_id || '') !== String(swap.requester_id || '')) {
            throw new Error('SWAP_SHIFT_CHANGED: Ca nhường đã đổi chủ trước khi bạn xác nhận, phiếu này không còn hiệu lực!');
          }
          const supDate = String((coverShift as any).date || '').slice(0, 10);
          const supCode = (coverShift as any).shift_code as ShiftCode;
          const empDayShifts = await this.repo.getShiftsForEmployee(partnerId, supDate, supDate).catch(() => []);
          const empClash = (empDayShifts || []).find((s: any) =>
            (s as any).shift_code === supCode && (s as any).status !== 'CANCELLED');
          if (empClash) {
            throw new Error(`SUPPORT_SHIFT_CONFLICT: Bạn đã có ${supCode} ngày ${supDate}, không thể nhận thêm ca hỗ trợ trùng ca!`);
          }
          await this.repo.updateShiftAssignment(coverShift.assignment_id, {
            employee_id: partnerId,
            schedule_version: (coverShift.schedule_version || 0) + 1,
          });
          // B đi làm ca này thì ngày OFF (nếu có) của B ngày đó tự hủy.
          const supportOffNotes = await this.cancelReceiverLeavesOnWorkDay(partnerId, supDate);
          const supportApproved = await this.repo.updateSwapRequest(swapId, {
            status: 'APPROVED',
            partner_responded_at: new Date().toISOString(),
            approved_by: partnerId,
            approved_at: new Date().toISOString(),
            bonus_amount: 0,
          } as any);
          await this.cancelSiblingPendingSwaps(swapId, swap);
          if (this.io) {
            this.io.to(`user:${swap.requester_id}`).emit('swap.updated', { swapId, status: 'APPROVED' });
            this.io.to(`user:${partnerId}`).emit('swap.updated', { swapId, status: 'APPROVED' });
          }
          return { ...supportApproved, _warnings: supportOffNotes } as any;
        }
        if (!isOpenDispatch && accept && (swap as any).swap_kind !== 'HR_DISPATCH') {
          if (!swap.target_assignment_id) {
            const coverShift = await this.repo.getShiftById(swap.requester_assignment_id);
            if (!coverShift) {
              throw new Error('SHIFTS_NOT_FOUND_FOR_SWAP');
            }
            await this.repo.updateShiftAssignment(coverShift.assignment_id, {
              employee_id: swap.target_employee_id,
              schedule_version: coverShift.schedule_version + 1,
            });
            // Người nhận đi làm ca này thì ngày OFF (nếu có) của họ ngày đó tự hủy.
            const coverOffNotes = await this.cancelReceiverLeavesOnWorkDay(
              swap.target_employee_id, String((coverShift as any).date || '').slice(0, 10));
            const autoCover = await this.repo.updateSwapRequest(swapId, {
              status: 'APPROVED',
              partner_responded_at: new Date().toISOString(),
              approved_by: partnerId,
              approved_at: new Date().toISOString(),
              bonus_amount: 0,
            });
            // Phiếu chốt thì dọn phiếu trùng y hệt còn chờ (kẻo duyệt tiếp hoán ngược).
            await this.cancelSiblingPendingSwaps(swapId, swap);

            const coverWarnings: string[] = [...coverOffNotes];
            try {
              const day = (coverShift.date || '').slice(0, 10);
              const empShifts = await this.repo.getShiftsForEmployee(swap.target_employee_id, day, day).catch(() => []);
              const dayCount = (empShifts || []).filter(
                (s: any) => (s.date || '').slice(0, 10) === day && s.status !== 'CANCELLED'
              ).length;
              if (dayCount > 1) {
                coverWarnings.push(`${swap.target_employee_id} làm ${dayCount} ca ngày ${day} (mỗi ca điểm danh độc lập).`);
              }
            } catch { /* best-effort */ }

            if (this.io) {
              this.io.to(`user:${swap.requester_id}`).emit('swap.updated', { swapId, status: 'APPROVED' });
              this.io.to(`user:${swap.target_employee_id}`).emit('swap.updated', { swapId, status: 'APPROVED' });
            }

            return { ...autoCover, _warnings: coverWarnings };
          }
          const reqShift = await this.repo.getShiftById(swap.requester_assignment_id);
          const tgtShift = await this.repo.getShiftById(swap.target_assignment_id);
          if (!reqShift || !tgtShift) {
            throw new Error('SHIFTS_NOT_FOUND_FOR_SWAP');
          }
          await this.repo.updateShiftAssignment(reqShift.assignment_id, {
            employee_id: swap.target_employee_id,
            schedule_version: reqShift.schedule_version + 1,
          });
          await this.repo.updateShiftAssignment(tgtShift.assignment_id, {
            employee_id: swap.requester_id,
            schedule_version: tgtShift.schedule_version + 1,
          });
          // Mỗi bên nhận ca mới thì ngày OFF (nếu có) của họ ngày ca đó tự hủy.
          const twoWayOffNotes = [
            ...(await this.cancelReceiverLeavesOnWorkDay(
              swap.target_employee_id, String((reqShift as any).date || '').slice(0, 10))),
            ...(await this.cancelReceiverLeavesOnWorkDay(
              swap.requester_id, String((tgtShift as any).date || '').slice(0, 10))),
          ];
          const autoApproved = await this.repo.updateSwapRequest(swapId, {
            status: 'APPROVED',
            partner_responded_at: new Date().toISOString(),
            approved_by: partnerId,
            approved_at: new Date().toISOString(),
            bonus_amount: 0,
          });
          // Phiếu chốt thì dọn phiếu trùng y hệt còn chờ (kẻo duyệt tiếp hoán ngược).
          await this.cancelSiblingPendingSwaps(swapId, swap);

          const warnings: string[] = [...twoWayOffNotes];
          try {
            for (const empId of [swap.requester_id, swap.target_employee_id]) {
              const day = (tgtShift.date || '').slice(0, 10);
              const empShifts = await this.repo.getShiftsForEmployee(empId, day, day).catch(() => []);
              const dayCount = (empShifts || []).filter(
                (s: any) => (s.date || '').slice(0, 10) === day && s.status !== 'CANCELLED'
              ).length;
              if (dayCount > 1) {
                warnings.push(`${empId} làm ${dayCount} ca ngày ${day} (mỗi ca điểm danh độc lập).`);
              }
            }
          } catch { /* best-effort */ }

          if (this.io) {
            this.io.to(`user:${swap.requester_id}`).emit('swap.updated', { swapId, status: 'APPROVED' });
            this.io.to(`user:${swap.target_employee_id}`).emit('swap.updated', { swapId, status: 'APPROVED' });
          }

          return { ...autoApproved, _warnings: warnings };
        }

        const newStatus = accept ? 'PARTNER_ACCEPTED' : 'REJECTED';
        const updated = await this.repo.updateSwapRequest(swapId, {
          ...(isOpenDispatch && accept ? { target_employee_id: partnerId } : {}),
          status: newStatus,
          partner_responded_at: new Date().toISOString(),
        });
        // Từ chối thì dọn luôn phiếu trùng y hệt còn chờ để banner B hết kẹt.
        if (!accept) {
          await this.cancelSiblingPendingSwaps(swapId, swap);
        }

        if (this.io) {
          this.io.to(`user:${swap.requester_id}`).emit('swap.updated', {
            swapId,
            status: newStatus,
          });
          if (isOpenDispatch && accept) {
            this.io.to(`user:${partnerId}`).emit('swap.updated', {
              swapId,
              status: newStatus,
            });
          }
        }

        return updated;
      },
    });
  }

  /**
   * Rà soát toàn bộ phiếu đổi/tráo ca sai quy định (ca nằm NGOÀI tuần Mon-Sun
   * chứa ngày gửi phiếu): hủy phiếu + trả lịch từng NV về chủ ban đầu.
   * - Phiếu đúng tuần (kể cả tuần cũ đã qua) -> giữ nguyên.
   * - APPROVED rồi -> đảo ngược người trực về chủ gốc (bỏ qua ca đã đổi chủ sau đó).
   * - PENDING/PARTNER_ACCEPTED -> chỉ hủy phiếu (ca chưa hề bị đụng).
   * Idempotent: phiếu REJECTED/CANCELLED bỏ qua.
   */
  async auditOutOfWeekSwaps(actorId: string): Promise<{ checked: number; violations: any[] }> {
    const all = await this.repo.listSwapRequests().catch(() => []);
    const violations: any[] = [];
    for (const sw of all || []) {
      const status = (sw as any).status;
      if (status === 'REJECTED' || status === 'CANCELLED') continue;
      const createdVn = vnDateOf((sw as any).created_at);
      if (!createdVn) continue;
      const createdWk = weekRangeOf(createdVn);
      const ids = [(sw as any).requester_assignment_id, (sw as any).target_assignment_id].filter(Boolean);
      const dates: string[] = [];
      const missing: string[] = [];
      for (const id of ids) {
        const sh: any = await this.repo.getShiftById(id).catch(() => null);
        if (!sh) missing.push(id);
        else dates.push(String(sh.date || '').slice(0, 10));
      }
      // Phiếu hỗ trợ chi nhánh không có ca gốc — kiểm tra theo ngày hỗ trợ.
      const supportDate = String((sw as any).support_date || '').slice(0, 10);
      if (supportDate) dates.push(supportDate);
      const bad = dates.filter(d => !d || d < createdWk.mon || d > createdWk.sun);
      if (bad.length === 0 && missing.length === 0) continue;
      // Phiếu hỗ trợ đã chốt là lịch sử công đã làm — giữ nguyên, không hoàn lịch.
      if ((sw as any).swap_kind === 'HR_SUPPORT' && status === 'APPROVED') continue;

      // --- Hoàn trả lịch về chủ ban đầu (chỉ khi phiếu đã APPROVED) ---
      const reverted: string[] = [];
      const skipped: string[] = [];
      if (status === 'APPROVED') {
        const reqId = (sw as any).requester_id;
        const tgtId = (sw as any).target_employee_id;
        const reqAid = (sw as any).requester_assignment_id;
        const tgtAid = (sw as any).target_assignment_id;
        const restore = async (aid: string, originalHolder: string, counterparty: string) => {
          if (!aid || !originalHolder) return;
          const sh: any = await this.repo.getShiftById(aid).catch(() => null);
          if (!sh) { skipped.push(`${aid}: ca không còn — bỏ qua`); return; }
          if (sh.employee_id === originalHolder) { reverted.push(`${aid}: đã đúng chủ ${originalHolder}`); return; }
          if (counterparty && sh.employee_id !== counterparty) {
            skipped.push(`${aid}: đang thuộc ${sh.employee_id} (đã đổi chủ sau đó) — giữ nguyên`);
            return;
          }
          await this.repo.updateShiftAssignment(aid, {
            employee_id: originalHolder,
            schedule_version: (sh.schedule_version || 0) + 1,
          });
          reverted.push(`${aid}: trả về ${originalHolder}`);
        };
        if (tgtAid) {
          await restore(reqAid, reqId, tgtId); // tráo 2 chiều
          await restore(tgtAid, tgtId, reqId);
        } else {
          await restore(reqAid, reqId, tgtId); // nhờ làm thay 1 chiều / điều phối
        }
      }

      const reason = missing.length > 0 && bad.length === 0
        ? `Ca gốc không còn tồn tại (${missing.join(', ')})`
        : `Ca ngày ${[...new Set(dates)].join(', ') || '?'} ngoài tuần gửi phiếu (${createdWk.mon} → ${createdWk.sun})`;
      await singleWriterQueue.enqueue({
        entityType: 'PHIEU_DOI_CA',
        entityId: (sw as any).swap_id,
        actorId,
        execute: async () => {
          const fresh: any = await this.repo.getSwapById((sw as any).swap_id).catch(() => null);
          if (!fresh || fresh.status === 'REJECTED' || fresh.status === 'CANCELLED') return fresh;
          return this.repo.updateSwapRequest((sw as any).swap_id, {
            status: 'CANCELLED',
            rejection_reason: 'Hủy do đổi/tráo ca ngoài tuần hiện tại (sai quy định) — đã trả lịch về ban đầu.',
            approved_by: actorId,
            approved_at: new Date().toISOString(),
          } as any);
        },
      });
      if (this.io) {
        try {
          this.io.emit('data:updated', { entity: 'swaps', data: { action: 'audit-cancel-out-of-week', swapId: (sw as any).swap_id }, timestamp: new Date().toISOString() });
        } catch { /* non-fatal */ }
      }
      violations.push({
        swap_id: (sw as any).swap_id,
        swap_kind: (sw as any).swap_kind || 'EMPLOYEE_SWAP',
        status,
        created_at: (sw as any).created_at,
        createdWeek: createdWk,
        shiftDates: [...new Set(dates)],
        reason,
        reverted,
        skipped,
      });
    }
    return { checked: (all || []).length, violations };
  }

  /** Phiếu điều phối mở (HR_DISPATCH + PENDING_PARTNER) của 1 chi nhánh cho NV nhận ca. */
  async listOpenDispatches(branchId: string) {
    const all = await this.repo.listSwapRequests();
    const out: any[] = [];
    for (const s of all) {
      if ((s as any).swap_kind !== 'HR_DISPATCH' || s.status !== 'PENDING_PARTNER') continue;
      const shift = await this.repo.getShiftById(s.requester_assignment_id).catch(() => null);
      if (!shift) continue;
      if (branchId !== '*' && canonicalBranch((shift as any).branch_id) !== canonicalBranch(branchId)) continue;
      out.push({ ...s, shift });
    }
    return out.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }

  async approveSwapManager(swapId: string, managerId: string, accept: boolean, reason?: string) {
    return singleWriterQueue.enqueue({
      entityType: 'PHIEU_DOI_CA',
      entityId: swapId,
      actorId: managerId,
      execute: async () => {
        const swap = await this.repo.getSwapById(swapId);
        if (!swap || swap.status !== 'PARTNER_ACCEPTED') {
          throw new Error('SWAP_NOT_READY_FOR_APPROVAL');
        }
        // Duyệt phiếu ngoài tuần hiện tại -> chặn. Từ chối thì luôn cho qua.
        if (accept) {
          const dates: string[] = [];
          const rSh = swap.requester_assignment_id
            ? await this.repo.getShiftById(swap.requester_assignment_id).catch(() => null)
            : null;
          const tSh = swap.target_assignment_id
            ? await this.repo.getShiftById(swap.target_assignment_id).catch(() => null)
            : null;
          if (rSh) dates.push((rSh as any).date);
          if (tSh) dates.push((tSh as any).date);
          if (dates.length > 0) assertSwapDatesAllowed(dates);
          // HR duyệt cũng yêu cầu ca còn published (không duyệt ca nháp/hủy).
          assertShiftsPublished([rSh, tSh]);
        }

        if (!accept) {
          const rejectedSwap = await this.repo.updateSwapRequest(swapId, {
            status: 'REJECTED',
            rejection_reason: reason || 'Từ chối bởi quản lý',
            approved_by: managerId,
            approved_at: new Date().toISOString(),
          });
          await this.cancelSiblingPendingSwaps(swapId, swap);
          return rejectedSwap;
        }

        // HR điều phối nhường ca: chuyển 1 chiều ca cho người nhận + ghi +30.000đ.
        // NV tự tráo (EMPLOYEE_SWAP): hoán đổi 2 ca, KHÔNG phụ cấp.
        if ((swap as any).swap_kind === 'HR_DISPATCH') {
          const coverShift = await this.repo.getShiftById(swap.requester_assignment_id);
          if (!coverShift) {
            throw new Error('SHIFTS_NOT_FOUND_FOR_SWAP');
          }
          await this.repo.updateShiftAssignment(coverShift.assignment_id, {
            employee_id: swap.target_employee_id,
            schedule_version: coverShift.schedule_version + 1,
          });
          // Người nhận đi làm ca này thì ngày OFF (nếu có) của họ ngày đó tự hủy.
          const dispatchOffNotes = await this.cancelReceiverLeavesOnWorkDay(
            swap.target_employee_id, String((coverShift as any).date || '').slice(0, 10));

          const updatedDispatch = await this.repo.updateSwapRequest(swapId, {
            status: 'APPROVED',
            approved_by: managerId,
            approved_at: new Date().toISOString(),
            bonus_amount: 30000,
          });
          await this.cancelSiblingPendingSwaps(swapId, swap);

          const dispatchWarnings: string[] = [...dispatchOffNotes];
          try {
            const day = (coverShift.date || '').slice(0, 10);
            const empShifts = await this.repo.getShiftsForEmployee(swap.target_employee_id, day, day).catch(() => []);
            const dayCount = (empShifts || []).filter(
              (s: any) => (s.date || '').slice(0, 10) === day && s.status !== 'CANCELLED'
            ).length;
            if (dayCount > 1) {
              dispatchWarnings.push(`${swap.target_employee_id} làm ${dayCount} ca ngày ${day} (mỗi ca điểm danh độc lập, +30.000đ ca nhận thay).`);
            }
          } catch { /* best-effort */ }

          if (this.io) {
            this.io.to(`user:${swap.requester_id}`).emit('swap.updated', { swapId, status: 'APPROVED' });
            this.io.to(`user:${swap.target_employee_id}`).emit('swap.updated', { swapId, status: 'APPROVED' });
          }

          return { ...updatedDispatch, _warnings: dispatchWarnings };
        }

        // Swap the assignments
        const reqShift = await this.repo.getShiftById(swap.requester_assignment_id);
        const tgtShift = await this.repo.getShiftById(swap.target_assignment_id);

        if (!reqShift || !tgtShift) {
          throw new Error('SHIFTS_NOT_FOUND_FOR_SWAP');
        }

        // Multi-tab atomic update check: if partial fails, singleWriterQueue handles reconciliation
        await this.repo.updateShiftAssignment(reqShift.assignment_id, {
          employee_id: swap.target_employee_id,
          schedule_version: reqShift.schedule_version + 1,
        });

        await this.repo.updateShiftAssignment(tgtShift.assignment_id, {
          employee_id: swap.requester_id,
          schedule_version: tgtShift.schedule_version + 1,
        });
        // Mỗi bên nhận ca mới thì ngày OFF (nếu có) của họ ngày ca đó tự hủy.
        const mgrOffNotes = [
          ...(await this.cancelReceiverLeavesOnWorkDay(
            swap.target_employee_id, String((reqShift as any).date || '').slice(0, 10))),
          ...(await this.cancelReceiverLeavesOnWorkDay(
            swap.requester_id, String((tgtShift as any).date || '').slice(0, 10))),
        ];

        const updatedSwap = await this.repo.updateSwapRequest(swapId, {
          status: 'APPROVED',
          approved_by: managerId,
          approved_at: new Date().toISOString(),
          bonus_amount: 0,
        });
        await this.cancelSiblingPendingSwaps(swapId, swap);

        // Ghi nhận ngày 2 ca: sau hoán đổi, ai có >1 ca/ngày thì cảnh báo để
        // theo dõi điểm danh từng ca (mỗi ca check-in/out độc lập).
        const warnings: string[] = [...mgrOffNotes];
        try {
          for (const empId of [swap.requester_id, swap.target_employee_id]) {
            const day = (tgtShift.date || '').slice(0, 10);
            const empShifts = await this.repo.getShiftsForEmployee(empId, day, day).catch(() => []);
            const dayCount = (empShifts || []).filter(
              (s: any) => (s.date || '').slice(0, 10) === day && s.status !== 'CANCELLED'
            ).length;
            if (dayCount > 1) {
              warnings.push(`${empId} làm ${dayCount} ca ngày ${day} (mỗi ca điểm danh độc lập).`);
            }
          }
        } catch { /* best-effort */ }

        if (this.io) {
          this.io.to(`user:${swap.requester_id}`).emit('swap.updated', { swapId, status: 'APPROVED' });
          this.io.to(`user:${swap.target_employee_id}`).emit('swap.updated', { swapId, status: 'APPROVED' });
        }

        return { ...updatedSwap, _warnings: warnings };
      },
    });
  }
}
