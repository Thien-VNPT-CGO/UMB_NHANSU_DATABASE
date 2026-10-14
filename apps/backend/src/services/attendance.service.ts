import { v4 as uuidv4 } from 'uuid';
import {
  AttendanceAdjustment,
  AttendanceEvent,
  AttendanceEventType,
  BRANCHES,
  ERROR_CODES,
  GPSStatus,
  SHIFT_TEMPLATES,
} from '@ubm/shared';
import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { singleWriterQueue } from '../repositories/single-writer-queue.js';
import { readAttendancePhotoDiskAsDataUrl } from './photo-disk.store.js';
import { lateFineFor, linkDayEvents } from './payroll.service.js';

import { Server } from 'socket.io';

// Haversine formula for calculating distance in meters between two lat/lon points
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
    /** % hồng đồng phục app NV đo được (lưu vết để HR đối soát). */
    uniformPinkRatio?: number;
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
        // 1b. Chống gửi đúp cùng ca (bấm đúp / retry mạng lọt qua rào ngoài
        // queue): ca đã có CHECK_IN/CHECK_OUT thì trả bản có sẵn, không tạo đôi.
        try {
          const mine = await this.repo.getAttendanceEvents(data.employeeId).catch(() => []);
          const same = (mine || []).find((e: any) =>
            (e as any).assignment_id === data.assignmentId && (e as any).type === data.type);
          if (same) return same as any;
        } catch { /* tiếp tục ghi mới khi đọc lỗi */ }

        // 2. Validate Assignment
        const shift = await this.repo.getShiftById(data.assignmentId);
        if (!shift) {
          throw new Error(ERROR_CODES.SHIFT_NOT_FOUND);
        }
        if (shift.employee_id !== data.employeeId) {
          throw new Error('ASSIGNMENT_NOT_OWNED');
        }
        // Ca đã hủy/khóa thì không điểm danh vào đó (phiếu sẽ mồ côi, lưới hiện
        // "chưa điểm danh" dù NV đã bấm — báo HR xếp ca mới).
        if ((shift as any).status === 'CANCELLED') {
          throw new Error('SHIFT_CANCELLED: Ca này đã bị hủy! Báo HR xếp ca mới rồi điểm danh lại.');
        }

        // 2b. Ràng buộc cặp check-in/out theo từng ca + cấm check-out sớm.
        // Ngày 2 ca: mỗi ca check-in/out độc lập — không check-in ca sau trước
        // rồi check-out ca trước, không check-out trước giờ tan ca.
        const evtMs = new Date(data.clientTime).getTime();
        const evtNow = Number.isFinite(evtMs) ? evtMs : Date.now();
        if (data.type === 'CHECK_OUT') {
          const shiftEndMs = new Date((shift as any).end_at).getTime();
          if (Number.isFinite(shiftEndMs) && evtNow < shiftEndMs) {
            const endStr = new Date(shiftEndMs).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            const minsLeft = Math.max(1, Math.ceil((shiftEndMs - evtNow) / 60000));
            throw new Error(`CHECKOUT_TOO_EARLY: Chưa đến giờ tan ca (ca kết thúc lúc ${endStr})! Còn ${minsLeft} phút nữa mới được check-out — đúng giờ mới cho check-out.`);
          }
          const pairEvents = await this.repo.getAttendanceEvents(data.employeeId).catch(() => []);
          const hasPairIn = (pairEvents || []).some((e: any) =>
            String((e as any).assignment_id) === String(data.assignmentId) && (e as any).type === 'CHECK_IN');
          if (!hasPairIn) {
            throw new Error('CHECKOUT_WITHOUT_CHECKIN: Ca này chưa có check-in nên không thể check-out! Ngày 2 ca thì mỗi ca check-in/out độc lập — vui lòng check-in đúng ca này trước.');
          }
        }
        if (data.type === 'CHECK_IN') {
          const shiftDay = String((shift as any).date || '').slice(0, 10);
          const myStartMs = new Date((shift as any).start_at).getTime();
          if (shiftDay && Number.isFinite(myStartMs)) {
            const nowMs = Date.now();
            const dayShifts = await this.repo.getShiftsForEmployee(data.employeeId, shiftDay, shiftDay).catch(() => []);
            const myEvents = await this.repo.getAttendanceEvents(data.employeeId).catch(() => []);
            for (const s of (dayShifts || [])) {
              if ((s as any).status === 'CANCELLED') continue;
              if (String((s as any).assignment_id) === String(data.assignmentId)) continue;
              const sStartMs = new Date((s as any).start_at).getTime();
              if (!Number.isFinite(sStartMs) || sStartMs >= myStartMs) continue;
              const sId = String((s as any).assignment_id);
              const sDone = (myEvents || []).some((e: any) =>
                String((e as any).assignment_id) === sId && ((e as any).type === 'CHECK_IN' || (e as any).type === 'ABSENT'));
              if (sDone) continue;
              if (nowMs - sStartMs > 3 * 60 * 60 * 1000) continue;
              if (nowMs < sStartMs - 30 * 60 * 1000) continue;
              const code = String((s as any).shift_code || '').replace('CA_1', 'Ca 1').replace('CA_2', 'Ca 2').replace('CA_3', 'Ca 3');
              throw new Error(`CHECKIN_WRONG_SHIFT_ORDER: Hôm nay bạn có 2 ca — ${code} ngày ${shiftDay} còn chờ check-in, vui lòng check-in ca trước rồi mới check-in ca này (không check-in ca sau trước)!`);
            }
          }
        }

        // 3. Validate GPS
        // Ràng buộc: GPS không đúng (quá bán kính 300m HOẶC sóng quá yếu >150m)
        // -> TỪ CHỐI ghi nhận, ca quay về chưa điểm danh để NV làm lại.
        const branch = BRANCHES.find(b => b.id === shift.branch_id);
        let distanceMeters = 0;
        let gpsStatus: GPSStatus = 'UNAVAILABLE';

        if (data.gps && branch) {
          if (data.gps.accuracy > 150) {
            throw new Error(`GPS_LOW_ACCURACY:${data.gps.accuracy}`);
          }
          distanceMeters = calculateDistanceMeters(
            data.gps.latitude,
            data.gps.longitude,
            branch.latitude,
            branch.longitude
          );
          if (distanceMeters <= branch.radius_meters) {
            gpsStatus = 'VALID';
          } else {
            throw new Error(`GPS_OUT_OF_BOUNDS:${distanceMeters}:${branch.radius_meters}`);
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

        // 5b. Ghi nhận phạt trễ NGAY lúc check-in (ràng buộc chặt):
        // trễ 5-29p: 30k; 30-59p: 50% lương ca; ≥60p: 100% lương ca.
        let fineTier = 'NONE';
        let fineAmount = 0;
        if (data.type === 'CHECK_IN' && isLate && minutesDeviation >= 5) {
          try {
            const emp = await this.repo.getEmployeeById(data.employeeId).catch(() => null);
            const rate = Number((emp as any)?.current_rate_per_hour) || 0;
            const hours = (SHIFT_TEMPLATES as any)[shift.shift_code]?.duration_hours || 5;
            const fine = lateFineFor(minutesDeviation, hours * rate);
            fineTier = fine.tier;
            fineAmount = fine.unpaid ? hours * rate : fine.deduction;
          } catch { /* giữ NONE khi không tính được */ }
        }

        // 6. Record to Master Ledger (photo_base64 chỉ để adapter upload Drive rồi bỏ)
        const event = await this.repo.recordAttendanceEvent({
          fine_tier: fineTier,
          fine_amount: fineAmount,
          ...(data.photoBase64 ? { photo_base64: data.photoBase64 } : {}),
          ...(Number.isFinite(Number(data.uniformPinkRatio)) ? { uniform_pink_ratio: Math.max(0, Math.min(100, Math.round(Number(data.uniformPinkRatio)))) } : {}),
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

        // 6b. Check-out thành công (đã validated có check-in cùng ca) = ca đủ cặp
        // -> tích điểm hoàn thành ca cho NV (chỉ ca PUBLISHED, ngoài lịch không tính).
        if (data.type === 'CHECK_OUT') {
          await this.creditCompletionPoints(data.employeeId, data.assignmentId);
        }

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
   * Engine bù công ca làm (DỰ PHÒNG, hiện không còn route trực tiếp nào gọi):
   * công chỉ ghi nhận qua phiếu NV tạo → HR duyệt (reviewAdjustment dùng
   * backfillFromAdjustment). Giữ lại để tái dùng cho luồng duyệt tự động.
   * Ghi trực tiếp CHECK_IN (+CHECK_OUT) gắn đúng ca, không phạt trễ, tôn trọng
   * kho archive, gắn check-in mồ côi, mặc định giờ ca khi thiếu.
   */
  async compensateShift(data: {
    assignmentId: string;
    checkInTime?: string;
    checkOutTime?: string;
    reason?: string;
    actorId: string;
  }): Promise<{ operationId: string; result: { checkIn: any; checkOut: any; created: Array<'CHECK_IN' | 'CHECK_OUT'> } }> {
    return singleWriterQueue.enqueue({
      entityType: 'SU_KIEN_DIEM_DANH',
      entityId: `${data.assignmentId}_ADMIN_COMP`,
      actorId: data.actorId,
      execute: async () => {
        const shift: any = await this.repo.getShiftById(data.assignmentId);
        if (!shift) throw new Error('SHIFT_NOT_FOUND: ca làm không còn tồn tại!');
        if (String((shift as any).status || '') === 'CANCELLED') {
          throw new Error('SHIFT_CANCELLED: ca này đã bị hủy, không bù công được!');
        }
        const employeeId = String((shift as any).employee_id || '');
        if (!employeeId) throw new Error('SHIFT_NO_OWNER: ca chưa gán nhân viên!');
        const reason = String(data.reason || '').trim().slice(0, 500) || 'Admin bù công do hệ thống lỗi';

        const mine = await this.repo.getAttendanceEvents(employeeId).catch(() => []);
        let hasIn = (mine || []).find((e: any) =>
          String((e as any).assignment_id) === String(data.assignmentId) && (e as any).type === 'CHECK_IN');
        let hasOut = (mine || []).find((e: any) =>
          String((e as any).assignment_id) === String(data.assignmentId) && (e as any).type === 'CHECK_OUT');
        // Ngày cũ: điểm danh tuần qua đã archive sang kho LUUTRU (xóa khỏi bảng
        // realtime) — tra thêm kho để không đòi nhập lại giờ vào / bù trùng.
        if (!hasIn || !hasOut) {
          try {
            const day = String((shift as any).date || '').slice(0, 10);
            const sync = (this.repo as any)?.syncService;
            if (day && sync?.getArchivedAttendanceEvents) {
              const archived = await sync.getArchivedAttendanceEvents(day, day).catch(() => []);
              const archMine = (archived || []).filter((e: any) =>
                String((e as any)?.employee_id || '') === employeeId &&
                String((e as any)?.assignment_id || '') === String(data.assignmentId));
              if (!hasIn) hasIn = archMine.find((e: any) => (e as any)?.type === 'CHECK_IN');
              if (!hasOut) hasOut = archMine.find((e: any) => (e as any)?.type === 'CHECK_OUT');
            }
          } catch { /* giữ kết quả bảng live */ }
        }
        if (hasIn && hasOut) {
          throw new Error('SHIFT_ALREADY_COMPLETE: ca này đã đủ check-in + check-out, không cần bù!');
        }

        const needIn = !hasIn;
        const needOut = !hasOut;
        let inIso = String(data.checkInTime || '').trim();
        let outIso = String(data.checkOutTime || '').trim();
        // Thẻ "Tự điểm danh" (check-in không gắn ca): Admin bù mà không nhập giờ
        // vào thì GẮN luôn bản ghi mồ côi cùng ngày vào ca thay vì ghi đôi.
        let attachedIn: any = null;
        if (needIn && !inIso) {
          try {
            const day = String((shift as any).date || '').slice(0, 10);
            const orphans = (mine || []).filter((e: any) => {
              if ((e as any)?.type !== 'CHECK_IN' || (e as any)?.assignment_id) return false;
              if (String((e as any)?.employee_id || '') !== employeeId) return false;
              const t = new Date((e as any)?.client_time || '').getTime();
              if (!Number.isFinite(t)) return false;
              return new Date(t + 7 * 3_600_000).toISOString().slice(0, 10) === day;
            });
            // Ưu tiên bản ghi gần giờ vào ca nhất (đúng ca cần bù).
            const startMs = (shift as any)?.start_at ? new Date((shift as any).start_at).getTime() : NaN;
            orphans.sort((a: any, b: any) => {
              const base = Number.isFinite(startMs) ? startMs : 0;
              return Math.abs(new Date((a as any).client_time).getTime() - base) - Math.abs(new Date((b as any).client_time).getTime() - base);
            });
            const pick = orphans[0];
            if (pick && this.repo.updateAttendanceEvent) {
              const stamp = new Date().toISOString();
              attachedIn = await this.repo.updateAttendanceEvent((pick as any).event_id, {
                assignment_id: data.assignmentId,
                compensated_by: data.actorId,
                compensated_at: stamp,
                compensate_reason: reason,
              } as any);
            }
          } catch { /* không gắn được thì báo nhập giờ như cũ */ }
        }
        // Admin bấm bù là ca mặc định điểm danh đủ: thiếu giờ nào thì tự lấy
        // giờ vào/tan ca (không bắt nhập). Ca legacy thiếu giờ mẫu mới báo lỗi.
        if (needIn && !attachedIn && !inIso) {
          const dflt = String((shift as any).start_at || '');
          if (!dflt || !Number.isFinite(new Date(dflt).getTime())) {
            throw new Error('MISSING_CHECKIN_TIME: ca chưa có check-in và thiếu giờ vào mẫu, Admin phải nhập giờ vào!');
          }
          inIso = dflt;
        }
        if (needOut && !outIso) {
          const dflt = String((shift as any).end_at || '');
          if (!dflt || !Number.isFinite(new Date(dflt).getTime())) {
            throw new Error('MISSING_CHECKOUT_TIME: ca thiếu giờ tan mẫu, Admin phải nhập giờ ra!');
          }
          outIso = dflt;
        }
        const inMs = needIn ? new Date(inIso).getTime() : NaN;
        const outMs = needOut ? new Date(outIso).getTime() : NaN;
        if (needIn && !attachedIn && !Number.isFinite(inMs)) throw new Error('INVALID_CHECKIN_TIME: giờ vào không hợp lệ!');
        if (needOut && !Number.isFinite(outMs)) throw new Error('INVALID_CHECKOUT_TIME: giờ ra không hợp lệ!');
        if (needIn && needOut && outMs <= inMs) {
          throw new Error('INVALID_RANGE: giờ ra phải sau giờ vào!');
        }

        const nowIso = new Date().toISOString();
        const mkEvent = (type: 'CHECK_IN' | 'CHECK_OUT', clientTime: string) => {
          const eventId = `EVT_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          const dateObj = new Date(clientTime);
          const yyyy = dateObj.getFullYear();
          const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
          const dd = String(dateObj.getDate()).padStart(2, '0');
          return {
            event_id: eventId,
            request_id: `ADMIN_COMP_${data.assignmentId}_${type}`,
            assignment_id: data.assignmentId,
            employee_id: employeeId,
            branch_id: (shift as any).branch_id,
            type,
            client_time: clientTime,
            server_received_at: nowIso,
            distance_meters: 0,
            gps_status: 'UNAVAILABLE' as GPSStatus,
            drive_object_id: `DRV_ADMIN_COMP_${Date.now()}`,
            drive_path: `admin-compensate/${yyyy}/${mm}/${dd}/${(shift as any).branch_id}/${employeeId}/${data.assignmentId}/${eventId}${type === 'CHECK_IN' ? '_IN.jpg' : '_OUT.jpg'}`,
            is_early: false,
            is_late: false,
            minutes_deviation: 0,
            fine_tier: 'NONE',
            fine_amount: 0,
            compensated_by: data.actorId,
            compensated_at: nowIso,
            compensate_reason: reason,
          };
        };

        let checkIn: any = hasIn || attachedIn || null;
        let checkOut: any = hasOut || null;
        const created: Array<'CHECK_IN' | 'CHECK_OUT'> = [];
        if (attachedIn) created.push('CHECK_IN');
        // Idempotent: request_id ADMIN_COMP_* đã có thì dùng lại, không ghi đôi.
        if (needIn && !checkIn) {
          const dup = await this.repo.findAttendanceEventByRequestId(`ADMIN_COMP_${data.assignmentId}_CHECK_IN`).catch(() => null);
          checkIn = dup || await this.repo.recordAttendanceEvent(mkEvent('CHECK_IN', inIso) as any);
          if (!dup) created.push('CHECK_IN');
        }
        if (needOut) {
          const dup = await this.repo.findAttendanceEventByRequestId(`ADMIN_COMP_${data.assignmentId}_CHECK_OUT`).catch(() => null);
          checkOut = dup || await this.repo.recordAttendanceEvent(mkEvent('CHECK_OUT', outIso) as any);
          if (!dup) created.push('CHECK_OUT');
        }
        // Vừa bù đủ cặp cho ca từng thiếu -> tích điểm hoàn thành ca cho NV.
        if (!(hasIn && hasOut) && checkIn && checkOut && created.length > 0) {
          await this.creditCompletionPoints(employeeId, String(data.assignmentId));
        }

        // Realtime như điểm danh thường (đồng bộ, không await hàng đợi khác).
        if (this.io) {
          for (const ev of [checkIn, checkOut]) {
            if (!ev) continue;
            try {
              this.io.to(`branch:${(shift as any).branch_id}`).emit('attendance.recorded', {
                eventId: (ev as any).event_id,
                employeeId: (ev as any).employee_id,
                branchId: (ev as any).branch_id,
                type: (ev as any).type,
                gpsStatus: (ev as any).gps_status,
              });
            } catch { /* non-fatal */ }
          }
        }
        return { checkIn, checkOut, created };
      },
    });
  }

  /**
   * Thử lại upload ảnh chấm công lỗi (đang giữ inline `event_photo`): Drive hồi
   * là ảnh hiện lại trên modal/ZIP, base64 inline được dọn để nhẹ bộ nhớ + ID
   * thật được đẩy lên Sheet ngay. Chạy nền mỗi 5 phút (tối đa `limit` lượt cũ
   * nhất). Không cấu hình Drive thì bỏ qua.
   */
  async retryFailedPhotoUploads(limit = 20): Promise<{ checked: number; recovered: number }> {
    const sync = (this.repo as any)?.syncService;
    const fb = (this.repo as any)?.fallbackAdapter;
    if (!sync?.uploadImageToDrive || !Array.isArray(fb?.attendanceEvents)) return { checked: 0, recovered: 0 };
    try {
      if (sync.getDriveUploadStatus && sync.getDriveUploadStatus()?.driveConfigured === false) {
        return { checked: 0, recovered: 0 };
      }
    } catch { /* thử vẫn chạy */ }
    const cands = (fb.attendanceEvents as any[])
      .filter(
        (e: any) =>
          (!((e as any)?.drive_object_id) || String((e as any).drive_object_id).startsWith('DRV_')) &&
          ((e as any)?.event_photo || readAttendancePhotoDiskAsDataUrl((e as any)?.event_id))
      )
      .slice(0, Math.max(1, Math.min(50, limit)));
    let recovered = 0;
    for (const e of cands) {
      try {
        // Sau restart memory mất event_photo — hydrate từ đĩa để retry được.
        if (!(e as any)?.event_photo) {
          const fromDisk = readAttendancePhotoDiskAsDataUrl((e as any)?.event_id);
          if (fromDisk) (e as any).event_photo = fromDisk;
        }
        const r = await sync.uploadImageToDrive(
          `${(e as any)?.employee_id || 'unknown'}_${(e as any)?.type || 'CHECK'}_${Date.now()}.jpg`,
          'image/jpeg',
          String((e as any).event_photo)
        );
        if (r?.fileId && !String(r.fileId).startsWith('DRV_')) {
          (e as any).drive_object_id = r.fileId;
          delete (e as any).event_photo;
          recovered++;
        }
      } catch { /* lần sau thử lại */ }
    }
    if (recovered > 0) {
      try {
        await sync.pushEventsTab(fb).catch(() => 0);
      } catch { /* best-effort */ }
      if (this.io) {
        try {
          this.io.emit('data:updated', {
            entity: 'attendance',
            data: { action: 'photo-recovered', recovered },
            timestamp: new Date().toISOString(),
          });
        } catch { /* non-fatal */ }
      }
    }
    return { checked: cands.length, recovered };
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
    // Map ca live toàn hệ thống theo NV+ngày (1 lần): NV có ca 2 chi nhánh cùng
    // ngày thì check-in ca CN kia vẫn tính "đã gắn ca live".
    const crossBranchLive = new Map<string, Set<string>>();
    try {
      const cross = await this.repo.getShiftsForWeek('*', '2000-01-01').catch(() => []);
      for (const s of cross || []) {
        if ((s as any)?.status === 'CANCELLED') continue;
        const k = `${(s as any)?.employee_id}|${String((s as any)?.date || '').slice(0, 10)}`;
        const id = String((s as any)?.assignment_id || '');
        if (!id) continue;
        if (!crossBranchLive.has(k)) crossBranchLive.set(k, new Set());
        crossBranchLive.get(k)!.add(id);
      }
    } catch { /* thiếu thì map theo scope bên dưới vẫn đúng */ }
    for (const branchId of scopes) {
      const shifts = await this.repo.getShiftsForWeek(branchId, '2000-01-01').catch(() => []);
      // ID ca live theo NV+ngày (tra cứu 1 lần): phiếu check-in mồ côi (gắn ca đã
      // hủy/mất sau khi HR xếp lại) vẫn là bằng chứng có mặt — không đánh vắng
      // oan. Phiếu gắn ca live KHÁC cùng ngày (VD ngày 2 ca) thì ca này vẫn vắng.
      // (Map bù liên chi nhánh ngoài vòng lặp để NV 2 CN cùng ngày vẫn đúng.)
      const liveByEmpDay = new Map<string, Set<string>>(crossBranchLive);
      const cancelledByEmpDay = new Map<string, Set<string>>();
      for (const s of shifts || []) {
        const k = `${(s as any)?.employee_id}|${String((s as any)?.date || '').slice(0, 10)}`;
        const id = String((s as any)?.assignment_id || '');
        if (!id) continue;
        if ((s as any)?.status === 'CANCELLED') {
          if (!cancelledByEmpDay.has(k)) cancelledByEmpDay.set(k, new Set());
          cancelledByEmpDay.get(k)!.add(id);
        } else {
          if (!liveByEmpDay.has(k)) liveByEmpDay.set(k, new Set());
          else liveByEmpDay.set(k, new Set([...liveByEmpDay.get(k)!, id]));
        }
      }
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
        // NV đã check-in cùng ngày (dù phiếu gắn ca khác do HR xếp lại lịch sau
        // đó) thì KHÔNG đánh vắng — giữ công, HR đối soát lại liên kết sau.
        const k = `${(s as any)?.employee_id}|${String((s as any)?.date || '').slice(0, 10)}`;
        const liveIds = liveByEmpDay.get(k) || new Set<string>();
        const deadIds = cancelledByEmpDay.get(k) || new Set<string>();
        const orphanCheckIn = (events || []).some((e: any) => {
          if (String((e as any)?.type || '') !== 'CHECK_IN') return false;
          const aid = String((e as any)?.assignment_id || '');
          if (!aid) return true;
          if (aid === String((s as any)?.assignment_id || '')) return true;
          if (deadIds.has(aid)) return true;
          if (!liveIds.has(aid)) return true;
          return false;
        });
        if (orphanCheckIn) continue;
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
  /** Loại phiếu từ tiền tố [TYPE] trong lý do (để chống gửi trùng cùng ca). */
  static adjustmentKindOf(reason: string): string {
    return String(reason || '').match(/^\[([A-Z_]+)\]/)?.[1] || '';
  }

  async requestAdjustment(data: {
    assignmentId: string;
    employeeId: string;
    branchId: string;
    reason: string;
    minutesRequested: number;
    /** Ảnh bằng chứng base64 — adapter upload lên Drive thành evidence_drive_id rồi bỏ. */
    photoBase64?: string;
    /** Ngày sự cố NV chọn (YYYY-MM-DD) — dùng để chốt đúng ca, chống gắn nhầm ca ngày khác. */
    incidentDate?: string;
  }) {
    // ID duy nhất tuyệt đối (trước đây chỉ Date.now() -> 2 phiếu cùng mili giây
    // sẽ trùng ID, bản ghi đè nhau, xóa/sửa chỉ trúng 1 bản).
    const adjId = `ADJ_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    return singleWriterQueue.enqueue({
      entityType: 'DIEU_CHINH_CONG',
      entityId: adjId,
      actorId: data.employeeId,
      execute: async () => {
        // Khung giờ tạo phiếu 08:00–21:00 hằng ngày (giờ VN) — ngoài giờ chặn ngay.
        const vnH = AttendanceService.vnHourNow();
        if (vnH < AttendanceService.ADJUSTMENT_CREATE_OPEN_HOUR || vnH >= AttendanceService.ADJUSTMENT_CREATE_CLOSE_HOUR) {
          throw new Error('ADJUSTMENT_WINDOW_CLOSED: Chỉ được tạo phiếu từ 08:00 đến 21:00 hằng ngày! Ngoài giờ hệ thống không nhận phiếu, quay lại trong khung giờ nhé.');
        }
        // Chốt đúng ca theo NGÀY sự cố (không tin mù assignment client gửi):
        // app NV cũ thiếu ca ngày đó sẽ rớt về ca đầu danh sách (sai ngày) khiến
        // duyệt xong dựng công nhầm sang ngày khác.
        const resolved = await this.resolveAdjustmentShift(data.employeeId, data.assignmentId, data.incidentDate || data.reason);
        if (!resolved) {
          const d = AttendanceService.incidentDateOf(data.incidentDate || data.reason);
          throw new Error(`ADJUSTMENT_NO_SHIFT: Ngày ${d || '(chưa rõ)'} không có ca làm việc nào được xếp! Kiểm tra lại ngày hoặc liên hệ HR xếp ca trước.`);
        }
        const assignmentId = (resolved as any).assignment_id;
        // Chống trùng phiếu: cùng NV + cùng ca + cùng loại mà đã có phiếu PENDING
        // (bấm đúp, mạng retry, gửi lại) thì từ chối tạo mới.
        const kind = AttendanceService.adjustmentKindOf(data.reason);
        const existing = await this.repo.listAttendanceAdjustments(undefined, data.employeeId).catch(() => []);
        const dup = (existing || []).find((x: any) =>
          (x as any).status === 'PENDING' &&
          (x as any).assignment_id === assignmentId &&
          (kind
            ? AttendanceService.adjustmentKindOf((x as any).reason) === kind
            : (x as any).reason === data.reason)
        );
        if (dup) {
          throw new Error('ADJUSTMENT_DUPLICATE: Bạn đã có phiếu cùng ca đang chờ duyệt, không cần gửi lại! Chờ HR xử lý phiếu hiện tại.');
        }
        // KHÔNG giới hạn số phiếu/tuần (kể cả NV chính thức): gửi bao nhiêu cũng
        // được, chống trùng phiếu PENDING cùng ca ở trên đã đủ. Phiếu BU_CONG_NGAY
        // vẫn tốn điểm theo luật riêng bên dưới.
        // Phiếu BU_CONG_NGAY: ngày bù trong tháng hiện tại + tốn 5 điểm (trừ ngay,
        // từ chối/hết hạn thì hoàn lại). Không đủ điểm -> chặn tạo.
        if (kind === 'BU_CONG_NGAY') {
          const todayVn = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
          const incDay = AttendanceService.incidentDateOf(data.incidentDate || data.reason);
          if (!incDay || incDay.slice(0, 7) !== todayVn.slice(0, 7)) {
            throw new Error('BU_CONG_NGAY_MONTH: Phiếu bù công ngày chỉ chọn ngày trong tháng hiện tại!');
          }
          const me: any = await this.repo.getEmployeeById(data.employeeId).catch(() => null);
          const pts = AttendanceService.adjustPointsOf(me);
          if (pts.balance < AttendanceService.BU_CONG_NGAY_COST) {
            throw new Error(`ADJUSTMENT_NO_POINTS: Phiếu bù công ngày tốn ${AttendanceService.BU_CONG_NGAY_COST} điểm, bạn đang có ${pts.balance} điểm (đủ 1 ca check-in + check-out = +${AttendanceService.POINTS_PER_COMPLETE_SHIFT} điểm). Tích thêm điểm rồi gửi lại!`);
          }
          await this.addAdjustPoints(data.employeeId, 0, AttendanceService.BU_CONG_NGAY_COST);
        }
        return this.repo.createAttendanceAdjustment({
          adjustment_id: adjId,
          assignment_id: assignmentId,
          employee_id: data.employeeId,
          branch_id: data.branchId,
          reason: data.reason,
          minutes_requested: data.minutesRequested,
          status: 'PENDING',
          // Transient: adapter upload Drive -> evidence_drive_id rồi tự bỏ (không lưu base64).
          ...(data.photoBase64 ? { photo_base64: data.photoBase64 } : {}),
        });
      },
    });
  }

  /** Ngày sự cố của phiếu (từ incidentDate client gửi, rớt về ngày trong lý do). */
  static incidentDateOf(input: string): string {
    const m = String(input || '').match(/(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : '';
  }

  /**
   * Chốt ca đúng NGÀY sự cố của phiếu: ưu tiên assignment client gửi nếu cùng ngày,
   * ngược lại lấy ca đầu (không hủy) của NV đúng ngày đó. Không có ca -> null
   * (chặn tạo/duyệt sai ngày).
   */
  private async resolveAdjustmentShift(employeeId: string, assignmentId?: string, dateInput?: string): Promise<any | null> {
    const day = AttendanceService.incidentDateOf(dateInput || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    if (assignmentId && !String(assignmentId).startsWith('SHIFT_UNKNOWN_')) {
      const direct = await this.repo.getShiftById(assignmentId).catch(() => null);
      if (direct && String((direct as any).date || '').slice(0, 10) === day) return direct;
    }
    const list = await this.repo.getShiftsForEmployee(employeeId, day, day).catch(() => []);
    const same = (list || []).filter((s: any) => String((s as any).date || '').slice(0, 10) === day);
    if (same.length === 0) return null;
    return same.find((s: any) => (s as any).status !== 'CANCELLED') || same[0];
  }

  async listAdjustments(branchId?: string, employeeId?: string) {
    return this.repo.listAttendanceAdjustments(branchId, employeeId);
  }

  /** Hiệu lực 1 phiếu gửi HR: 30 phút tính từ lúc tạo — quá hạn tự động từ chối. */
  static readonly ADJUSTMENT_TTL_MINUTES = 30;
  /** Khung giờ NV được TẠO phiếu (giờ VN): 08:00–21:00 hằng ngày, ngoài giờ báo lỗi. */
  static readonly ADJUSTMENT_CREATE_OPEN_HOUR = 8;
  static readonly ADJUSTMENT_CREATE_CLOSE_HOUR = 21;
  /** Phiếu BU_CONG_NGAY tốn 5 điểm/lượt; đủ 1 ca (check-in + check-out) +2 điểm. */
  static readonly BU_CONG_NGAY_COST = 5;
  static readonly POINTS_PER_COMPLETE_SHIFT = 2;

  /** Giờ VN hiện tại (0–23) để chốt khung giờ tạo/duyệt phiếu. */
  static vnHourNow(d = new Date()): number {
    return new Date(d.getTime() + 7 * 3_600_000).getUTCHours();
  }

  /** Điểm bù công của NV: tích lũy - đã dùng = khả dụng (thiếu -> 0). */
  static adjustPointsOf(emp: any): { earned: number; spent: number; balance: number } {
    const earned = Math.max(0, Math.floor(Number((emp as any)?.adjust_points_earned) || 0));
    const spent = Math.max(0, Math.floor(Number((emp as any)?.adjust_points_spent) || 0));
    return { earned, spent, balance: Math.max(0, earned - spent) };
  }

  /** Cộng/trừ điểm (1 lần retry khi đụng version) — dùng cho tích, trừ, hoàn điểm. */
  private async addAdjustPoints(employeeId: string, dEarned: number, dSpent: number): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const emp: any = await this.repo.getEmployeeById(employeeId).catch(() => null);
        if (!emp) return;
        const cur = AttendanceService.adjustPointsOf(emp);
        const patch: any = {};
        if (dEarned) patch.adjust_points_earned = Math.max(0, cur.earned + Math.floor(dEarned));
        if (dSpent) patch.adjust_points_spent = Math.max(0, cur.spent + Math.floor(dSpent));
        if (Object.keys(patch).length === 0) return;
        await this.repo.updateEmployee(employeeId, patch, (emp as any).version);
        return;
      } catch (e: any) {
        if (String((e as any)?.message || '').includes('VERSION_CONFLICT') && attempt === 0) continue;
        throw e;
      }
    }
  }

  /** +2 điểm khi 1 ca PUBLISHED vừa đủ cặp check-in + check-out (chỉ tính ca thật,
   *  tự điểm danh ngoài lịch không tích điểm để chống farm). Gọi đúng lúc ca
   *  chuyển từ thiếu sang đủ (mỗi ca 1 lần). */
  private async creditCompletionPoints(employeeId: string, assignmentId: string): Promise<void> {
    try {
      const sh: any = await this.repo.getShiftById(assignmentId).catch(() => null);
      if (!sh || String((sh as any).status || '') !== 'PUBLISHED') return;
      await this.addAdjustPoints(employeeId, AttendanceService.POINTS_PER_COMPLETE_SHIFT, 0);
    } catch { /* thiếu điểm lẻ tẻ thì vòng sau bù, không chặn luồng chính */ }
  }

  /** Hoàn 5 điểm BU_CONG_NGAY khi phiếu bị từ chối/hết hạn (chỉ trừ lúc tạo). */
  private async refundTicketPoints(adj: any): Promise<void> {
    try {
      if (AttendanceService.adjustmentKindOf((adj as any)?.reason) !== 'BU_CONG_NGAY') return;
      const empId = String((adj as any)?.employee_id || '');
      if (!empId) return;
      await this.addAdjustPoints(empId, 0, -AttendanceService.BU_CONG_NGAY_COST);
    } catch { /* best-effort */ }
  }

  /**
   * Ràng buộc hiệu lực phiếu bổ sung công:
   *  - PENDING quá `ttlMinutes` (mặc định 30 phút, tính từ lúc NV gửi)
   *    mà HR chưa duyệt -> hệ thống TỰ ĐỘNG TỪ CHỐI (REJECTED + ghi chú, NV và
   *    HR đều thấy).
   *  - Phiếu đã tự từ chối quá 7 ngày nữa -> TỰ ĐỘNG XÓA KHỎI HỆ THỐNG
   *    (bộ nhớ + Sheet), không để lại xác.
   * Idempotent (kiểm tra lại trạng thái trong queue trước khi chạm).
   */
  static readonly AUTO_REJECT_NOTE = 'Tự động từ chối (quá 30 phút HR chưa duyệt)';
  async expireStaleAdjustments(now: Date = new Date(), ttlMinutes = AttendanceService.ADJUSTMENT_TTL_MINUTES): Promise<{
    checked: number;
    expired: string[];
    rejected: { adjustmentId: string; employeeId: string }[];
    deleted: string[];
  }> {
    const RETAIN_DAYS = 7;
    const all = await this.repo.listAttendanceAdjustments().catch(() => []);
    const rejected: { adjustmentId: string; employeeId: string }[] = [];
    const deleted: string[] = [];
    let checked = 0;
    for (const a of all || []) {
      const adjId = (a as any).adjustment_id;
      const status = (a as any).status;
      const created = new Date((a as any).created_at).getTime();
      if (!Number.isFinite(created)) continue;
      const ageMin = (now.getTime() - created) / 60000;
      // Pha 1: quá hạn HR duyệt -> tự từ chối (giữ phiếu để 2 bên đối soát).
      // Phiếu cũng chỉ hiệu lực trong khung 08:00–21:00 hằng ngày: qua 21:00 mà
      // vẫn PENDING (dù chưa đủ 30 phút) thì tự từ chối luôn.
      if (status === 'PENDING') {
        checked++;
        const vnH = AttendanceService.vnHourNow(now);
        const outsideWindow = vnH < AttendanceService.ADJUSTMENT_CREATE_OPEN_HOUR || vnH >= AttendanceService.ADJUSTMENT_CREATE_CLOSE_HOUR;
        if (ageMin <= ttlMinutes && !outsideWindow) continue;
        const note = outsideWindow && ageMin <= ttlMinutes
          ? 'Tự động từ chối (hết khung giờ duyệt 08:00–21:00)'
          : AttendanceService.AUTO_REJECT_NOTE;
        try {
          await singleWriterQueue.enqueue({
            entityType: 'DIEU_CHINH_CONG',
            entityId: adjId,
            actorId: 'SYSTEM',
            execute: async () => {
              const fresh = (await this.repo.listAttendanceAdjustments().catch(() => [])).find(
                (x: any) => x.adjustment_id === adjId
              );
              if (!fresh || (fresh as any).status !== 'PENDING') return fresh;
              await this.repo.updateAttendanceAdjustment(adjId, 'REJECTED', 'SYSTEM', undefined, note);
              await this.refundTicketPoints(fresh).catch(() => null);
              return { rejected: adjId } as any;
            },
          });
          rejected.push({ adjustmentId: adjId, employeeId: (a as any).employee_id });
          if (this.io) {
            this.io.to(`user:${(a as any).employee_id}`).emit('adjustment.updated', {
              adjustmentId: adjId,
              status: 'REJECTED',
            });
          }
        } catch { /* phiếu khác xử tiếp */ }
        continue;
      }
      // Pha 2: phiếu đã tự từ chối quá 7 ngày -> xóa cứng khỏi hệ thống.
      if (
        status === 'REJECTED' &&
        String((a as any).review_note || '').startsWith('Tự động từ chối') &&
        ageMin > RETAIN_DAYS * 1440
      ) {
        checked++;
        try {
          await singleWriterQueue.enqueue({
            entityType: 'DIEU_CHINH_CONG',
            entityId: adjId,
            actorId: 'SYSTEM',
            execute: async () => {
              const fresh = (await this.repo.listAttendanceAdjustments().catch(() => [])).find(
                (x: any) => x.adjustment_id === adjId
              );
              if (!fresh || (fresh as any).status !== 'REJECTED') return fresh;
              await this.repo.deleteAttendanceAdjustment(adjId);
              return { deleted: adjId } as any;
            },
          });
          deleted.push(adjId);
        } catch { /* phiếu khác xử tiếp */ }
      }
    }
    if (this.io && (rejected.length > 0 || deleted.length > 0)) {
      try {
        this.io.emit('data:updated', {
          entity: 'adjustments',
          data: {
            action: 'auto-expired',
            rejected: rejected.map(r => r.adjustmentId),
            deleted,
          },
          timestamp: new Date().toISOString(),
        });
      } catch { /* non-fatal */ }
    }
    return { checked, expired: rejected.map(r => r.adjustmentId), rejected, deleted };
  }

  /**
   * Xóa cứng phiếu khỏi hệ thống (bộ nhớ + Sheet qua full-sync):
   * - NV chỉ được hủy phiếu PENDING của chính mình.
   * - HR/QL được xóa phiếu PENDING/REJECTED/CANCELLED.
   * - APPROVED khóa cứng (đã dựng công + lương, xóa sẽ mồ côi dữ liệu).
   */
  async deleteAdjustment(adjId: string, actorId: string, isManager: boolean): Promise<any> {
    return singleWriterQueue.enqueue({
      entityType: 'DIEU_CHINH_CONG',
      entityId: adjId,
      actorId,
      execute: async () => {
        const all = await this.repo.listAttendanceAdjustments().catch(() => []);
        const adj: any = (all || []).find((x: any) => x.adjustment_id === adjId);
        if (!adj) throw new Error('ADJUSTMENT_NOT_FOUND: Phiếu không tồn tại.');
        if (adj.status === 'APPROVED') {
          throw new Error('ADJUSTMENT_APPROVED_LOCKED: Phiếu đã duyệt và dựng công — không được xóa.');
        }
        if (!isManager && (adj.employee_id !== actorId || adj.status !== 'PENDING')) {
          throw new Error('ADJUSTMENT_NOT_OWNER: Chỉ được hủy phiếu đang chờ của chính mình.');
        }
        const ok = await this.repo.deleteAttendanceAdjustment(adjId);
        if (!ok) throw new Error('ADJUSTMENT_NOT_FOUND: Phiếu không tồn tại.');
        if (this.io) {
          try {
            this.io.emit('data:updated', { entity: 'adjustments', data: { action: 'deleted', adjId }, timestamp: new Date().toISOString() });
          } catch { /* non-fatal */ }
        }
        return { deleted: adjId };
      },
    });
  }

  /**
   * HR sửa phiếu APPROVED bị gắn nhầm ca/ngày (lỗi app NV cũ): gỡ lượt dựng nhầm
   * trên ca sai + dựng lại đúng ngày phiếu. Chỉ chạy cho phiếu đã duyệt.
   */
  async repairAdjustment(adjId: string, actorId: string) {
    return singleWriterQueue.enqueue({
      entityType: 'DIEU_CHINH_CONG',
      entityId: adjId,
      actorId,
      execute: async () => {
        const all = await this.repo.listAttendanceAdjustments().catch(() => []);
        const adj: any = (all || []).find((x: any) => x.adjustment_id === adjId);
        if (!adj) throw new Error('ADJUSTMENT_NOT_FOUND: Phiếu không tồn tại.');
        if (adj.status !== 'APPROVED') throw new Error('ADJUSTMENT_NOT_APPROVED: Chỉ sửa được phiếu đã duyệt!');
        const shift = await this.resolveAdjustmentShift(adj.employee_id, adj.assignment_id, adj.reason).catch(() => null);
        if (!shift) throw new Error('ADJUSTMENT_NO_SHIFT: Không tìm thấy ca đúng ngày phiếu!');
        const fixed: string[] = await this.backfillFromAdjustment(adj).catch(() => []);
        if (this.io && fixed.length > 0) {
          this.io.emit('data:updated', { entity: 'attendance', data: { action: 'adjustment-repair', adjId }, timestamp: new Date().toISOString() });
        }
        return { adjustmentId: adjId, date: (shift as any).date, fixed };
      },
    });
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
        // HR bấm trùng (danh sách cũ, 2 người cùng duyệt, retry mạng): chỉ phiếu
        // đang PENDING mới được xử lý — đã duyệt/từ chối/xóa thì báo rõ để tải lại.
        const all = await this.repo.listAttendanceAdjustments().catch(() => []);
        const fresh = (all || []).find((x: any) => x.adjustment_id === adjId);
        if (!fresh) {
          throw new Error('ADJUSTMENT_NOT_FOUND: Phiếu không tồn tại (có thể đã bị xóa). Tải lại danh sách!');
        }
        if ((fresh as any).status !== 'PENDING') {
          const label = (fresh as any).status === 'APPROVED' ? 'đã duyệt'
            : (fresh as any).status === 'REJECTED' ? 'đã từ chối' : (fresh as any).status;
          throw new Error(`ADJUSTMENT_NOT_PENDING: Phiếu này ${label} rồi, không xử lý lại! Tải lại danh sách.`);
        }
        // Hiệu lực 30 phút: tick nền chạy mỗi phút nhưng HR vẫn có thể bấm duyệt
        // đúng lúc phiếu vừa hết hạn — chặn cứng tại đây: quá 30 phút thì tự từ
        // chối phiếu và báo hết hiệu lực (NV gửi lại phiếu mới trong quota tuần).
        const createdMs = new Date((fresh as any).created_at).getTime();
        if (Number.isFinite(createdMs)) {
          const ageMin = (Date.now() - createdMs) / 60000;
          if (ageMin > AttendanceService.ADJUSTMENT_TTL_MINUTES) {
            await this.repo.updateAttendanceAdjustment(adjId, 'REJECTED', 'SYSTEM', undefined, AttendanceService.AUTO_REJECT_NOTE).catch(() => null);
            if (this.io) {
              try {
                this.io.to(`user:${(fresh as any).employee_id}`).emit('adjustment.updated', { adjustmentId: adjId, status: 'REJECTED' });
              } catch { /* non-fatal */ }
            }
            throw new Error('ADJUSTMENT_EXPIRED: Phiếu đã quá 30 phút hiệu lực và tự động hết hạn! NV gửi lại phiếu mới.');
          }
        }
        const updated = await this.repo.updateAttendanceAdjustment(adjId, status, approverId, minutesApproved, note);
        // Từ chối phiếu BU_CONG_NGAY -> hoàn 5 điểm đã trừ lúc tạo (ca giữ nguyên
        // thiếu chân = không lương).
        if (status === 'REJECTED') {
          await this.refundTicketPoints(updated).catch(() => null);
        }
        // HR DUYỆT -> dựng lại bản ghi chấm công còn thiếu để lịch + realtime + lương
        // ghi nhận ca có đi làm (đồng bộ Sheets như mọi sự kiện). Từ chối -> giữ nguyên
        // vi phạm/phạt (ngược lại).
        let backfilled: string[] = [];
        let violationCleared = 0;
        if (status === 'APPROVED') {
          backfilled = await this.backfillFromAdjustment(updated).catch(() => []);
          // Duyệt = xóa vi phạm: gỡ cờ trễ + phạt trên mọi lượt IN/OUT của ca ĐÚNG
          // NGÀY phiếu (không phải assignment cũ gắn nhầm) để NV không bị tính vi
          // phạm (lưới realtime + kỳ lương đều đọc từ đây).
          try {
            const adjEmp = (updated as any).employee_id;
            const fixedShift = await this.resolveAdjustmentShift((updated as any).employee_id, (updated as any).assignment_id, (updated as any).reason).catch(() => null);
            const adjAssign = (fixedShift as any)?.assignment_id || (updated as any).assignment_id;
            if (adjEmp && adjAssign) {
              const evts = await this.repo.getAttendanceEvents(adjEmp).catch(() => []);
              for (const e of evts || []) {
                if ((e as any).assignment_id !== adjAssign) continue;
                if ((e as any).type !== 'CHECK_IN' && (e as any).type !== 'CHECK_OUT') continue;
                if (!(e as any).is_late && !(e as any).fine_amount && !(e as any).fine_tier) continue;
                await this.repo.updateAttendanceEvent((e as any).event_id, {
                  is_late: false,
                  minutes_deviation: 0,
                  fine_tier: 'NONE',
                  fine_amount: 0,
                } as any).catch(() => null);
                violationCleared++;
              }
            }
          } catch { /* best-effort */ }
        }
        if (this.io && (backfilled.length > 0 || violationCleared > 0)) {
          this.io.emit('data:updated', { entity: 'attendance', data: { action: 'adjustment-backfill', adjId }, timestamp: new Date().toISOString() });
        }
        // Báo realtime riêng cho NV để cổng NV cập nhật ngay, không chờ poll 15s.
        if (this.io) {
          try {
            this.io.to(`user:${(updated as any).employee_id}`).emit('adjustment.updated', { adjustmentId: adjId, status });
          } catch { /* non-fatal */ }
        }
        return { ...updated, _backfilled: backfilled, _violationCleared: violationCleared } as any;
      },
    });
  }

  /**
   * Dựng sự kiện CHECK_IN/CHECK_OUT còn thiếu theo loại phiếu:
   * [QUEN_CHECKIN] thiếu IN, [QUEN_CHECKOUT] thiếu OUT, [LOI_GPS_CAMERA] thiếu cả hai.
   * Giờ lấy từ ca phân công ĐÚNG NGÀY phiếu (tự sửa phiếu cũ gắn nhầm ca ngày khác:
   * gỡ event dựng nhầm trước khi dựng lại). GPS đánh dấu bổ sung tay.
   * Idempotent theo request_id.
   */
  private async backfillFromAdjustment(adj: AttendanceAdjustment): Promise<string[]> {
    const done: string[] = [];
    // Chốt lại ca đúng ngày (phiếu cũ có thể gắn nhầm assignment ngày khác).
    const shift = await this.resolveAdjustmentShift(adj.employee_id, adj.assignment_id, (adj as any).reason).catch(() => null);
    if (!shift) return done;
    const correctAssign = (shift as any).assignment_id;
    // Gỡ các lượt dựng nhầm từ phiếu này trên ca SAI ngày (request_id ADJ_*_<adjId>).
    try {
      const allEvts = await this.repo.getAttendanceEvents(adj.employee_id).catch(() => []);
      for (const e of allEvts || []) {
        const rid = String((e as any).request_id || '');
        if (!rid.startsWith('ADJ_') || !rid.endsWith(`_${adj.adjustment_id}`)) continue;
        if (String((e as any).assignment_id || '') === String(correctAssign)) continue;
        try {
          if (await this.repo.deleteAttendanceEvent((e as any).event_id)) done.push(`removed:${(e as any).type}`);
        } catch { /* tiếp */ }
      }
    } catch { /* best-effort */ }
    const reason = String((adj as any).reason || '');
    const needIn = /QUEN_CHECKIN|LOI_GPS|BU_CONG_NGAY/i.test(reason);
    const needOut = /QUEN_CHECKOUT|LOI_GPS|BU_CONG_NGAY/i.test(reason);
    // Mặc định (không rõ loại): bù phía còn thiếu.
    const events = await this.repo.getAttendanceEvents(adj.employee_id, (shift as any).date).catch(() => []);
    const mine = (events || []).filter((e: any) => e.assignment_id === correctAssign);
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
        assignment_id: correctAssign,
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
    // Vừa dựng đủ cặp cho ca từng thiếu -> tích điểm hoàn thành ca cho NV.
    if (done.includes('CHECK_IN') || done.includes('CHECK_OUT')) {
      await this.creditCompletionPoints(adj.employee_id, correctAssign);
    }
    return done;
  }

  /**
   * Đối soát check-in/out theo NV+ngày (HR rà soát "đã bấm mà hiện chưa điểm
   * danh", đối chiếu trước khi chốt lương): với mỗi ca liệt kê phiếu đã gắn
   * cứng, phiếu mồ côi bù vào, phiếu mồ côi không dùng được, và cờ:
   *  - UNPUBLISHED_WITH_ATTENDANCE: ca DRAFT đã có điểm danh (lương = 0 cho đến
   *    khi HR publish — ca hiện đủ trên lưới nhưng không tính công).
   *  - LINKED_FALLBACK: phiếu mồ côi đã bù vào ca (công hồi phục sau fix).
   *  - ABSENT_WITH_CHECKIN: bản ghi vắng oan (cùng ngày đã có check-in).
   *  - MISSING_IN / MISSING_OUT: ca quá khứ còn thiếu chân (cần phiếu bổ sung).
   * Chỉ đọc, không ghi — công các báo cáo tính live nên tự đúng sau fix khớp.
   */
  async reconcilePeriod(fromDate: string, toDate: string, branchScope = '*'): Promise<{
    fromDate: string;
    toDate: string;
    employees: {
      employee_id: string;
      employee: string;
      branch: string;
      days: {
        date: string;
        shifts: { assignment_id: string; shift_code: string; status: string; inTime: string | null; outTime: string | null; flags: string[]; hours: number }[];
        orphans: { event_id: string; type: string; assignment_id: string; client_time: string; reason: string }[];
      }[];
      totals: { shifts: number; full: number; missing: number; unpublished: number; orphans: number; wrongfulAbsent: number; recoverableHours: number };
    }[];
    totals: { employees: number; shifts: number; full: number; missing: number; unpublished: number; orphans: number; wrongfulAbsent: number; recoverableHours: number };
  }> {
    const vnDay = (iso?: string): string => {
      const t = new Date(iso || '').getTime();
      if (!Number.isFinite(t)) return '';
      return new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
    };
    const f = String(fromDate || '').slice(0, 10);
    const t = String(toDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(t) || f > t) {
      throw new Error('RECONCILE_BAD_RANGE: fromDate/toDate phải dạng YYYY-MM-DD và fromDate <= toDate!');
    }
    const days: string[] = [];
    for (let d = new Date(`${f}T00:00:00Z`); d.toISOString().slice(0, 10) <= t && days.length < 62; d.setUTCDate(d.getUTCDate() + 1)) {
      days.push(d.toISOString().slice(0, 10));
    }
    const todayVn = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const canon = (b?: string): string => {
      const x = String(b || '').trim().toUpperCase();
      if (x === 'CN1' || x === 'CN130') return 'CN130';
      if (x === 'CN2' || x === 'CN261') return 'CN261';
      if (x === 'CN3' || x === 'CN120') return 'CN120';
      if (x === 'CN4' || x === 'CN111') return 'CN111';
      return x;
    };
    const [employees, allShifts, allEvents] = await Promise.all([
      this.repo.listEmployees().catch(() => []),
      this.repo.getShiftsForWeek('*', f).catch(() => []),
      this.repo.getAttendanceEvents().catch(() => []),
    ]);
    let archived: any[] = [];
    try {
      archived = await (this.repo as any)?.syncService?.getArchivedAttendanceEvents?.(f, t) || [];
    } catch { archived = []; }
    const seenArch = new Set<string>();
    const archByEmpDay = new Map<string, any[]>();
    for (const e of archived || []) {
      const id = String((e as any)?.event_id || '');
      if (id) {
        if (seenArch.has(id)) continue;
        seenArch.add(id);
      }
      const day = vnDay((e as any)?.client_time);
      if (!day) continue;
      const k = `${String((e as any)?.employee_id || '')}|${day}`;
      if (!archByEmpDay.has(k)) archByEmpDay.set(k, []);
      (archByEmpDay.get(k) as any[]).push({ ...(e as any), _source: 'ARCHIVE' });
    }
    const emps = (employees || []).filter(
      (e: any) =>
        (e as any)?.employment_status !== 'TERMINATED' &&
        (!branchScope || branchScope === '*' || canon((e as any)?.default_branch_id || (e as any)?.branch_id) === canon(branchScope))
    );
    const out: any[] = [];
    for (const emp of emps as any[]) {
      const empId = String((emp as any)?.employee_id || '');
      const empDays: any[] = [];
      const totals = { shifts: 0, full: 0, missing: 0, unpublished: 0, orphans: 0, wrongfulAbsent: 0, recoverableHours: 0 };
      for (const date of days) {
        const dayShifts = (allShifts || []).filter(
          (s: any) => String((s as any)?.employee_id || '') === empId && String((s as any)?.date || '').slice(0, 10) === date
        );
        let dayEvents: any[] = (allEvents || [])
          .filter((e: any) => String((e as any)?.employee_id || '') === empId && vnDay((e as any)?.client_time) === date)
          .map((e: any) => ({ ...(e as any), _source: 'LIVE' }));
        for (const e of archByEmpDay.get(`${empId}|${date}`) || []) {
          if (!dayEvents.some((x: any) => String(x?.event_id || '') === String((e as any)?.event_id || ''))) dayEvents.push(e);
        }
        if (dayShifts.length === 0 && dayEvents.length === 0) continue;
        const linked = linkDayEvents(dayShifts, dayEvents);
        const usedIds = new Set<string>();
        for (const [, slot] of linked) {
          for (const leg of ['CHECK_IN', 'CHECK_OUT', 'ABSENT']) {
            const ev = (slot as any)?.[leg];
            if (ev?.event_id) usedIds.add(String(ev.event_id));
          }
        }
        const liveIds = new Set(
          dayShifts.filter((s: any) => (s as any)?.status !== 'CANCELLED').map((s: any) => String((s as any)?.assignment_id || ''))
        );
        const shiftRows: any[] = [];
        for (const s of dayShifts) {
          const st = String((s as any)?.status || '');
          if (st === 'CANCELLED') continue;
          const m = linked.get(String((s as any)?.assignment_id || '')) || ({} as any);
          const inEvt = (m as any).CHECK_IN;
          const outEvt = (m as any).CHECK_OUT;
          const tpl = (SHIFT_TEMPLATES as any)[(s as any)?.shift_code];
          const h = tpl ? Number(tpl.duration_hours) || 5 : 5;
          const flags: string[] = [];
          // Chân nào bù từ pool mồ côi (không gắn cứng assignment ca này)?
          const strictIn = dayEvents.find(
            (e: any) => String((e as any)?.type || '') === 'CHECK_IN' && String((e as any)?.assignment_id || '') === String((s as any)?.assignment_id || '')
          );
          const strictOut = dayEvents.find(
            (e: any) => String((e as any)?.type || '') === 'CHECK_OUT' && String((e as any)?.assignment_id || '') === String((s as any)?.assignment_id || '')
          );
          if ((inEvt || outEvt) && (!strictIn || !strictOut)) flags.push('LINKED_FALLBACK');
          if (st === 'DRAFT' && (inEvt || outEvt)) {
            flags.push('UNPUBLISHED_WITH_ATTENDANCE');
            totals.unpublished++;
            totals.recoverableHours = Math.round((totals.recoverableHours + (inEvt && outEvt ? h : 0)) * 10) / 10;
          } else if (st === 'PUBLISHED') {
            if (inEvt && outEvt) {
              totals.full++;
              if (flags.includes('LINKED_FALLBACK')) {
                totals.recoverableHours = Math.round((totals.recoverableHours + h) * 10) / 10;
              }
            } else if (date < todayVn) {
              if (!inEvt) flags.push('MISSING_IN');
              else flags.push('MISSING_OUT');
              totals.missing++;
            }
          }
          const absStrict = dayEvents.find(
            (e: any) => String((e as any)?.type || '') === 'ABSENT' && String((e as any)?.assignment_id || '') === String((s as any)?.assignment_id || '')
          );
          if (absStrict && dayEvents.some((e: any) => String((e as any)?.type || '') === 'CHECK_IN')) {
            flags.push('ABSENT_WITH_CHECKIN');
            totals.wrongfulAbsent++;
          }
          totals.shifts++;
          shiftRows.push({
            assignment_id: String((s as any)?.assignment_id || ''),
            shift_code: String((s as any)?.shift_code || ''),
            status: st,
            inTime: inEvt ? String((inEvt as any)?.client_time || '') : null,
            outTime: outEvt ? String((outEvt as any)?.client_time || '') : null,
            flags,
            hours: inEvt && outEvt ? h : 0,
          });
        }
        const orphans = (dayEvents || [])
          .filter((e: any) => {
            const tp = String((e as any)?.type || '');
            if (tp !== 'CHECK_IN' && tp !== 'CHECK_OUT') return false;
            if ((e as any)?.event_id && usedIds.has(String((e as any).event_id))) return false;
            return true;
          })
          .map((e: any) => {
            const aid = String((e as any)?.assignment_id || '');
            return {
              event_id: String((e as any)?.event_id || ''),
              type: String((e as any)?.type || ''),
              assignment_id: aid,
              client_time: String((e as any)?.client_time || ''),
              source: (e as any)?._source || 'LIVE',
              reason: !aid ? 'NO_LINK' : liveIds.has(aid) ? 'LINKED_ELSEWHERE' : 'DEAD_SHIFT',
            };
          });
        totals.orphans += orphans.length;
        if (shiftRows.length === 0 && orphans.length === 0) continue;
        empDays.push({ date, shifts: shiftRows, orphans });
      }
      if (empDays.length === 0) continue;
      out.push({
        employee_id: empId,
        employee: String((emp as any)?.full_name || empId),
        branch: String((emp as any)?.default_branch_id || (emp as any)?.branch_id || ''),
        days: empDays,
        totals,
      });
    }
    const sum = (k: string) => out.reduce((s: number, e: any) => s + Number(e?.totals?.[k] || 0), 0);
    return {
      fromDate: f,
      toDate: t,
      employees: out,
      totals: {
        employees: out.length,
        shifts: sum('shifts'),
        full: sum('full'),
        missing: sum('missing'),
        unpublished: sum('unpublished'),
        orphans: sum('orphans'),
        wrongfulAbsent: sum('wrongfulAbsent'),
        recoverableHours: Math.round(sum('recoverableHours') * 10) / 10,
      },
    };
  }
}
