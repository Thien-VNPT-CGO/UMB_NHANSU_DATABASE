import { v4 as uuidv4 } from 'uuid';
import {
  AttendanceAdjustment,
  AttendanceEvent,
  AttendanceEventType,
  BRANCHES,
  ERROR_CODES,
  GPSStatus,
} from '@ubm/shared';
import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { singleWriterQueue } from '../repositories/single-writer-queue.js';
import { Server } from 'socket.io';

// Haversine formula for calculating distance in meters between two lat/lon points
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

export class AttendanceService {
  constructor(
    private repo: ISheetsRepository,
    private io?: Server
  ) {}

  public setSocketServer(io: Server) {
    this.io = io;
  }

  async recordAttendance(data: {
    requestId: string;
    assignmentId: string;
    employeeId: string;
    type: AttendanceEventType;
    clientTime: string; // ISO 8601
    gps?: {
      latitude: number;
      longitude: number;
      accuracy: number;
    };
    hasCameraImage?: boolean;
    imageMeta?: string;
    /** Ảnh base64 chấm công — adapter upload lên Drive, không lưu vào bộ nhớ/Sheets. */
    photoBase64?: string;
  }): Promise<{ operationId: string; result: AttendanceEvent }> {
    return singleWriterQueue.enqueue({
      idempotencyKey: data.requestId,
      entityType: 'SU_KIEN_DIEM_DANH',
      entityId: `${data.assignmentId}_${data.type}`,
      actorId: data.employeeId,
      execute: async () => {
        // 1. Check if already recorded with same request_id
        const existingEvent = await this.repo.findAttendanceEventByRequestId(data.requestId);
        if (existingEvent) {
          return existingEvent;
        }

        // 2. Validate Assignment
        const shift = await this.repo.getShiftById(data.assignmentId);
        if (!shift) {
          throw new Error(ERROR_CODES.SHIFT_NOT_FOUND);
        }
        if (shift.employee_id !== data.employeeId) {
          throw new Error('ASSIGNMENT_NOT_OWNED');
        }

        // 3. Validate GPS
        const branch = BRANCHES.find(b => b.id === shift.branch_id);
        let distanceMeters = 0;
        let gpsStatus: GPSStatus = 'UNAVAILABLE';

        if (data.gps && branch) {
          if (data.gps.accuracy > 150) {
            gpsStatus = 'LOW_ACCURACY';
          } else {
            distanceMeters = calculateDistanceMeters(
              data.gps.latitude,
              data.gps.longitude,
              branch.latitude,
              branch.longitude
            );
            if (distanceMeters <= branch.radius_meters) {
              gpsStatus = 'VALID';
            } else {
              gpsStatus = 'OUT_OF_BOUNDS';
            }
          }
        }

        // 4. Generate Immutable Drive Path
        const eventId = `EVT_${Date.now()}`;
        const dateObj = new Date(data.clientTime);
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        const suffix = data.type === 'CHECK_IN' ? '_IN.jpg' : '_OUT.jpg';
        const drivePath = `attendance/${yyyy}/${mm}/${dd}/${shift.branch_id}/${data.employeeId}/${shift.assignment_id}/${eventId}${suffix}`;
        const driveObjectId = `DRV_${uuidv4().slice(0, 8)}`;

        // 5. Check early/late deviation
        let isEarly = false;
        let isLate = false;
        let minutesDeviation = 0;

        const shiftStart = new Date(shift.start_at).getTime();
        const shiftEnd = new Date(shift.end_at).getTime();
        const eventTime = dateObj.getTime();

        if (data.type === 'CHECK_IN') {
          if (eventTime > shiftStart) {
            isLate = true;
            minutesDeviation = Math.round((eventTime - shiftStart) / 60000);
          }
        } else {
          if (eventTime < shiftEnd) {
            isEarly = true;
            minutesDeviation = Math.round((shiftEnd - eventTime) / 60000);
          }
        }

        // 6. Record to Master Ledger (photo_base64 chỉ để adapter upload Drive rồi bỏ)
        const event = await this.repo.recordAttendanceEvent({
          ...(data.photoBase64 ? { photo_base64: data.photoBase64 } : {}),
          event_id: eventId,
          request_id: data.requestId,
          assignment_id: data.assignmentId,
          employee_id: data.employeeId,
          branch_id: shift.branch_id,
          type: data.type,
          client_time: data.clientTime,
          server_received_at: new Date().toISOString(),
          gps_latitude: data.gps?.latitude,
          gps_longitude: data.gps?.longitude,
          gps_accuracy: data.gps?.accuracy,
          distance_meters: distanceMeters,
          gps_status: gpsStatus,
          drive_object_id: driveObjectId,
          drive_path: drivePath,
          is_early: isEarly,
          is_late: isLate,
          minutes_deviation: minutesDeviation,
        });

        // 7. Emit socket event
        if (this.io) {
          this.io.to(`branch:${shift.branch_id}`).emit('attendance.recorded', {
            eventId: event.event_id,
            employeeId: event.employee_id,
            branchId: event.branch_id,
            type: event.type,
            gpsStatus: event.gps_status,
          });
        }

        return event;
      },
    });
  }

  async getEmployeeAttendance(employeeId: string, date: string) {
    return this.repo.getAttendanceEvents(employeeId, date);
  }

  /**
   * Tự động ghi VẮNG: ca PUBLISHED đã kết thúc quá `graceMinutes` mà không có
   * CHECK_IN/ABSENT nào -> tạo bản ghi ABSENT làm chứng cứ (đồng bộ Sheets như
   * mọi sự kiện khác). Idempotent theo request_id nên tick chồng không dup.
   */
  async markAbsentees(now: Date = new Date(), graceMinutes = 30): Promise<{ checked: number; marked: number }> {
    const todayStr = now.toISOString().split('T')[0];
    const branches = await this.repo.getBranches().catch(() => []);
    const branchIds = (branches || []).map((b: any) => b.id || b.branch_id).filter(Boolean);
    const scopes = branchIds.length > 0 ? branchIds : ['*'];
    let checked = 0;
    let marked = 0;
    for (const branchId of scopes) {
      const shifts = await this.repo.getShiftsForWeek(branchId, '2000-01-01').catch(() => []);
      for (const s of shifts || []) {
        if ((s as any).status !== 'PUBLISHED') continue;
        if ((s as any).date >= todayStr) continue; // chỉ ngày đã qua
        const endMs = new Date((s as any).end_at).getTime();
        if (!Number.isFinite(endMs) || now.getTime() - endMs < graceMinutes * 60000) continue;
        checked++;
        const events = await this.repo.getAttendanceEvents((s as any).employee_id, (s as any).date).catch(() => []);
        const mine = (events || []).filter(
          (e: any) => e.assignment_id === (s as any).assignment_id && (e.type === 'CHECK_IN' || e.type === 'ABSENT')
        );
        if (mine.length > 0) continue;
        const requestId = `ABSENT_${(s as any).assignment_id}`;
        const dup = await this.repo.findAttendanceEventByRequestId(requestId).catch(() => null);
        if (dup) continue;
        await singleWriterQueue
          .enqueue({
            entityType: 'SU_KIEN_DIEM_DANH',
            entityId: requestId,
            actorId: 'SYSTEM',
            execute: async () => {
              const exists = await this.repo.findAttendanceEventByRequestId(requestId).catch(() => null);
              if (exists) return exists;
              return this.repo.recordAttendanceEvent({
                event_id: `EVT_ABSENT_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                request_id: requestId,
                assignment_id: (s as any).assignment_id,
                employee_id: (s as any).employee_id,
                branch_id: (s as any).branch_id,
                type: 'ABSENT' as any,
                client_time: (s as any).end_at,
                server_received_at: now.toISOString(),
                gps_latitude: 0,
                gps_longitude: 0,
                gps_accuracy: 0,
                distance_meters: 0,
                gps_status: 'UNAVAILABLE',
              } as any);
            },
          })
          .catch(() => null);
        marked++;
      }
    }
    return { checked, marked };
  }

  // --- Adjustments ---
  async requestAdjustment(data: {
    assignmentId: string;
    employeeId: string;
    branchId: string;
    reason: string;
    minutesRequested: number;
  }) {
    const adjId = `ADJ_${Date.now()}`;
    return singleWriterQueue.enqueue({
      entityType: 'DIEU_CHINH_CONG',
      entityId: adjId,
      actorId: data.employeeId,
      execute: async () => {
        return this.repo.createAttendanceAdjustment({
          adjustment_id: adjId,
          assignment_id: data.assignmentId,
          employee_id: data.employeeId,
          branch_id: data.branchId,
          reason: data.reason,
          minutes_requested: data.minutesRequested,
          status: 'PENDING',
        });
      },
    });
  }

  async listAdjustments(branchId?: string, employeeId?: string) {
    return this.repo.listAttendanceAdjustments(branchId, employeeId);
  }

  /**
   * Ràng buộc hiệu lực phiếu: PENDING quá `ttlMinutes` (mặc định 60 phút) thì
   * hệ thống tự từ chối. Idempotent (chỉ chạm PENDING).
   */
  async expireStaleAdjustments(now: Date = new Date(), ttlMinutes = 60): Promise<{ checked: number; expired: string[] }> {
    const all = await this.repo.listAttendanceAdjustments().catch(() => []);
    const expired: string[] = [];
    let checked = 0;
    for (const a of all || []) {
      if ((a as any).status !== 'PENDING') continue;
      checked++;
      const created = new Date((a as any).created_at).getTime();
      if (!Number.isFinite(created) || now.getTime() - created <= ttlMinutes * 60000) continue;
      try {
        await singleWriterQueue.enqueue({
          entityType: 'DIEU_CHINH_CONG',
          entityId: (a as any).adjustment_id,
          actorId: 'SYSTEM',
          execute: async () => {
            const fresh = (await this.repo.listAttendanceAdjustments().catch(() => [])).find(
              (x: any) => x.adjustment_id === (a as any).adjustment_id
            );
            if (!fresh || (fresh as any).status !== 'PENDING') return fresh;
            return this.repo.updateAttendanceAdjustment(
              (a as any).adjustment_id,
              'REJECTED',
              'SYSTEM',
              0,
              `Tự động từ chối: quá ${ttlMinutes} phút không duyệt (phiếu hết hiệu lực).`
            );
          },
        });
        expired.push((a as any).adjustment_id);
        if (this.io) {
          this.io.to(`user:${(a as any).employee_id}`).emit('adjustment.updated', {
            adjustmentId: (a as any).adjustment_id,
            status: 'REJECTED',
          });
        }
      } catch { /* phiếu khác xử tiếp */ }
    }
    return { checked, expired };
  }

  async reviewAdjustment(
    adjId: string,
    status: 'APPROVED' | 'REJECTED',
    approverId: string,
    minutesApproved?: number,
    note?: string
  ) {
    return singleWriterQueue.enqueue({
      entityType: 'DIEU_CHINH_CONG',
      entityId: adjId,
      actorId: approverId,
      execute: async () => {
        const updated = await this.repo.updateAttendanceAdjustment(adjId, status, approverId, minutesApproved, note);
        // HR DUYỆT -> dựng lại bản ghi chấm công còn thiếu để lịch + realtime + lương
        // ghi nhận ca có đi làm (đồng bộ Sheets như mọi sự kiện). Từ chối -> giữ nguyên.
        let backfilled: string[] = [];
        if (status === 'APPROVED') {
          backfilled = await this.backfillFromAdjustment(updated).catch(() => []);
        }
        if (this.io && backfilled.length > 0) {
          this.io.emit('data:updated', { entity: 'attendance', data: { action: 'adjustment-backfill', adjId }, timestamp: new Date().toISOString() });
        }
        return { ...updated, _backfilled: backfilled } as any;
      },
    });
  }

  /**
   * Dựng sự kiện CHECK_IN/CHECK_OUT còn thiếu theo loại phiếu:
   * [QUEN_CHECKIN] thiếu IN, [QUEN_CHECKOUT] thiếu OUT, [LOI_GPS_CAMERA] thiếu cả hai.
   * Giờ lấy từ ca phân công, GPS đánh dấu bổ sung tay. Idempotent theo request_id.
   */
  private async backfillFromAdjustment(adj: AttendanceAdjustment): Promise<string[]> {
    const done: string[] = [];
    const shift = adj.assignment_id ? await this.repo.getShiftById(adj.assignment_id).catch(() => null) : null;
    if (!shift) return done;
    const reason = String((adj as any).reason || '');
    const needIn = /QUEN_CHECKIN|LOI_GPS/i.test(reason);
    const needOut = /QUEN_CHECKOUT|LOI_GPS/i.test(reason);
    // Mặc định (không rõ loại): bù phía còn thiếu.
    const events = await this.repo.getAttendanceEvents(adj.employee_id, (shift as any).date).catch(() => []);
    const mine = (events || []).filter((e: any) => e.assignment_id === adj.assignment_id);
    const hasIn = mine.some((e: any) => e.type === 'CHECK_IN');
    const hasOut = mine.some((e: any) => e.type === 'CHECK_OUT');
    const nowIso = new Date().toISOString();
    const mk = async (type: 'CHECK_IN' | 'CHECK_OUT', clientTime: string) => {
      const requestId = `ADJ_${type}_${adj.adjustment_id}`;
      const dup = await this.repo.findAttendanceEventByRequestId(requestId).catch(() => null);
      if (dup) return;
      await this.repo.recordAttendanceEvent({
        event_id: `EVT_ADJ_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        request_id: requestId,
        assignment_id: adj.assignment_id,
        employee_id: adj.employee_id,
        branch_id: (shift as any).branch_id,
        type,
        client_time: clientTime,
        server_received_at: nowIso,
        gps_latitude: 0,
        gps_longitude: 0,
        gps_accuracy: 0,
        distance_meters: 0,
        gps_status: 'UNAVAILABLE',
        drive_object_id: '',
        drive_path: '',
        is_early: false,
        is_late: false,
        minutes_deviation: 0,
      } as any);
      done.push(type);
    };
    if ((needIn || (!needIn && !needOut && !hasIn)) && !hasIn) {
      await mk('CHECK_IN', (shift as any).start_at);
    }
    if ((needOut || (!needIn && !needOut && !hasOut)) && !hasOut) {
      await mk('CHECK_OUT', (shift as any).end_at);
    }
    return done;
  }
}
