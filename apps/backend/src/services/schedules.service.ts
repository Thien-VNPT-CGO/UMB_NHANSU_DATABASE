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
 * Ràng buộc đổi/tráo ca: mọi ca liên quan phải nằm trong TUẦN HIỆN TẠI
 * (Mon-Sun chứa hôm nay, giờ VN) đã sắp lịch. Ngoài tuần -> từ chối.
 */
function assertDatesInCurrentWeek(dates: string[], now: Date = new Date()): { mon: string; sun: string } {
  const wk = currentVnWeekRange(now);
  for (const d of dates) {
    const day = String(d || '').slice(0, 10);
    if (!day || day < wk.mon || day > wk.sun) {
      throw new Error(
        `SWAP_OUT_OF_CURRENT_WEEK: Chỉ được đổi/tráo ca trong tuần hiện tại đã sắp lịch (${wk.mon} → ${wk.sun}). Ca ngày ${day || '?'} nằm ngoài tuần — hệ thống từ chối phiếu.`
      );
    }
  }
  return wk;
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
        const updatedShifts: ShiftAssignment[] = [];

        for (const shift of shifts) {
          if (shift.status === 'DRAFT') {
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
    if (data.leaveType === 'HANG_TUAN') {
      const wk = weekRangeOf(data.requestedDate);
      const existingLeaves = await this.repo.listLeaveRequests(data.branchId, data.employeeId);
      const weeklyLeaves = existingLeaves.filter(
        l =>
          l.leave_type === 'HANG_TUAN' &&
          l.status !== 'REJECTED' &&
          l.status !== 'CANCELLED' &&
          l.requested_date >= wk.mon &&
          l.requested_date <= wk.sun
      );
      if (weeklyLeaves.length >= 2) {
        throw new Error('WEEKLY_OFF_LIMIT_REACHED: Tối đa 2 ngày OFF hàng tuần theo chính sách.');
      }
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
    return singleWriterQueue.enqueue({
      entityType: 'PHIEU_OFF',
      entityId: `${data.employeeId}_${wk1.mon}`,
      actorId: data.employeeId,
      execute: async () => {
        const nowIso = new Date().toISOString();
        const existing = await this.repo.listLeaveRequests(undefined, data.employeeId);
        const oldOnes = existing.filter(
          l =>
            l.leave_type === 'HANG_TUAN' &&
            l.status !== 'REJECTED' &&
            l.status !== 'CANCELLED' &&
            l.requested_date >= wk1.mon &&
            l.requested_date <= wk1.sun
        );
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
        if (this.io) {
          for (const c of created) {
            this.io.to(`user:${c.employee_id}`).emit('leave.updated', {
              requestId: c.request_id,
              status: c.status,
            });
          }
        }
        return { week: wk1, leaves: created };
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

  async reviewLeave(requestId: string, status: 'APPROVED' | 'REJECTED', reviewerId: string, note?: string) {
    return singleWriterQueue.enqueue({
      entityType: 'PHIEU_OFF',
      entityId: requestId,
      actorId: reviewerId,
      execute: async () => {
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
    const swapId = `SWAP_${Date.now()}`;
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
    assertDatesInCurrentWeek(
      [reqSh ? (reqSh as any).date : '', tgtSh ? (tgtSh as any).date : ''].filter(Boolean)
    );
    return singleWriterQueue.enqueue({
      entityType: 'PHIEU_DOI_CA',
      entityId: swapId,
      actorId: data.requesterId,
      execute: async () => {
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
    assertDatesInCurrentWeek([(shift as any).date]);
    const swapId = `DISP_${Date.now()}`;
    return singleWriterQueue.enqueue({
      entityType: 'PHIEU_DOI_CA',
      entityId: swapId,
      actorId: data.actorId,
      execute: async () => {
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
        }

        return swap;
      },
    });
  }

  async respondSwapPartner(swapId: string, partnerId: string, accept: boolean) {
    return singleWriterQueue.enqueue({
      entityType: 'PHIEU_DOI_CA',
      entityId: swapId,
      actorId: partnerId,
      execute: async () => {
        const swap = await this.repo.getSwapById(swapId);
        if (!swap) throw new Error('SWAP_REQUEST_NOT_FOUND');
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
          if (dates.length > 0) assertDatesInCurrentWeek(dates);
        }

        // NV tự thỏa thuận với nhau: B bấm Đồng ý là chuyển ca ngay,
        // KHÔNG cần HR duyệt nữa (vẫn không phụ cấp +30k).
        // - Tráo tay đôi (A ⇄ B, đủ 2 ca): hoán đổi người trực.
        // - Nhờ làm thay 1 chiều (không có ca đối ứng): chuyển ca A sang B.
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
            const autoCover = await this.repo.updateSwapRequest(swapId, {
              status: 'APPROVED',
              partner_responded_at: new Date().toISOString(),
              approved_by: partnerId,
              approved_at: new Date().toISOString(),
              bonus_amount: 0,
            });

            const coverWarnings: string[] = [];
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
          const autoApproved = await this.repo.updateSwapRequest(swapId, {
            status: 'APPROVED',
            partner_responded_at: new Date().toISOString(),
            approved_by: partnerId,
            approved_at: new Date().toISOString(),
            bonus_amount: 0,
          });

          const warnings: string[] = [];
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
      const bad = dates.filter(d => !d || d < createdWk.mon || d > createdWk.sun);
      if (bad.length === 0 && missing.length === 0) continue;

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
          if (dates.length > 0) assertDatesInCurrentWeek(dates);
        }

        if (!accept) {
          return this.repo.updateSwapRequest(swapId, {
            status: 'REJECTED',
            rejection_reason: reason || 'Từ chối bởi quản lý',
            approved_by: managerId,
            approved_at: new Date().toISOString(),
          });
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

          const updatedDispatch = await this.repo.updateSwapRequest(swapId, {
            status: 'APPROVED',
            approved_by: managerId,
            approved_at: new Date().toISOString(),
            bonus_amount: 30000,
          });

          const dispatchWarnings: string[] = [];
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

        const updatedSwap = await this.repo.updateSwapRequest(swapId, {
          status: 'APPROVED',
          approved_by: managerId,
          approved_at: new Date().toISOString(),
          bonus_amount: 0,
        });

        // Ghi nhận ngày 2 ca: sau hoán đổi, ai có >1 ca/ngày thì cảnh báo để
        // theo dõi điểm danh từng ca (mỗi ca check-in/out độc lập).
        const warnings: string[] = [];
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
