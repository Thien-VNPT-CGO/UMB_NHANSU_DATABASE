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
          status: 'PENDING',
        });
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
          requester_id: data.requesterId,
          requester_assignment_id: data.requesterAssignmentId,
          target_employee_id: data.targetEmployeeId,
          target_assignment_id: data.targetAssignmentId,
          reason: data.reason,
          status: 'PENDING_PARTNER',
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

  async respondSwapPartner(swapId: string, partnerId: string, accept: boolean) {
    return singleWriterQueue.enqueue({
      entityType: 'PHIEU_DOI_CA',
      entityId: swapId,
      actorId: partnerId,
      execute: async () => {
        const swap = await this.repo.getSwapById(swapId);
        if (!swap || swap.target_employee_id !== partnerId) {
          throw new Error('SWAP_FORBIDDEN');
        }

        const newStatus = accept ? 'PARTNER_ACCEPTED' : 'REJECTED';
        const updated = await this.repo.updateSwapRequest(swapId, {
          status: newStatus,
          partner_responded_at: new Date().toISOString(),
        });

        if (this.io) {
          this.io.to(`user:${swap.requester_id}`).emit('swap.updated', {
            swapId,
            status: newStatus,
          });
        }

        return updated;
      },
    });
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
