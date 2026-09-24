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

        // 6. Record to Master Ledger
        const event = await this.repo.recordAttendanceEvent({
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
        return this.repo.updateAttendanceAdjustment(adjId, status, approverId, minutesApproved, note);
      },
    });
  }
}
