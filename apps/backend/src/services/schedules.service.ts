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
import { weekRangeOf } from './weekly-off.service.js';
import { canonicalBranch } from './auto-schedule.service.js';
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

          if (this.io) {
            this.io.to(`user:${swap.requester_id}`).emit('swap.updated', { swapId, status: 'APPROVED' });
            this.io.to(`user:${swap.target_employee_id}`).emit('swap.updated', { swapId, status: 'APPROVED' });
          }

          return updatedDispatch;
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

        if (this.io) {
          this.io.to(`user:${swap.requester_id}`).emit('swap.updated', { swapId, status: 'APPROVED' });
          this.io.to(`user:${swap.target_employee_id}`).emit('swap.updated', { swapId, status: 'APPROVED' });
        }

        return updatedSwap;
      },
    });
  }
}
