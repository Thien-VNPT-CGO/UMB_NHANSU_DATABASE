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
import { lateFineFor, linkDayEvents } from './payroll.service.js';
import { weekRangeOf } from './weekly-off.service.js';
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
        // Ràng buộc NV CHÍNH THỨC: mỗi tuần (Mon-Sun theo giờ VN, tính theo lúc gửi)
        // chỉ được 1 phiếu bổ sung/điều chỉnh công. HR duyệt (APPROVED) hoặc đang chờ
        // (PENDING) thì tính đã dùng quota tuần đó; HR từ chối / hết hạn 30 phút /
        // đã xóa thì KHÔNG tính (được gửi lại trong tuần).
        const emp = await this.repo.getEmployeeById(data.employeeId).catch(() => null);
        if (emp && (emp as any).employment_status === 'OFFICIAL') {
          const todayVn = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
          const wk = weekRangeOf(todayVn);
          const used = (existing || []).filter((x: any) => {
            const st = String((x as any).status || '');
            if (st !== 'PENDING' && st !== 'APPROVED') return false;
            const c = new Date((x as any).created_at).getTime();
            if (!Number.isFinite(c)) return false;
            const day = new Date(c + 7 * 3_600_000).toISOString().slice(0, 10);
            return day >= wk.mon && day <= wk.sun;
          });
          if (used.length >= AttendanceService.ADJUSTMENT_WEEKLY_QUOTA) {
            throw new Error(
              `ADJUSTMENT_WEEKLY_LIMIT: Nhân viên chính thức chỉ được 1 phiếu bổ sung công/tuần (tuần ${wk.mon} → ${wk.sun} bạn đã dùng 1 phiếu ${used[0]?.status === 'APPROVED' ? 'đã được duyệt' : 'đang chờ duyệt'}). Tuần sau gửi tiếp!`
            );
          }
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

  /** NV chính thức: tối đa 1 phiếu bổ sung/điều chỉnh công mỗi tuần (Mon-Sun). */
  static readonly ADJUSTMENT_WEEKLY_QUOTA = 1;
  /** Hiệu lực 1 phiếu gửi HR: 30 phút tính từ lúc tạo — quá hạn tự động từ chối. */
  static readonly ADJUSTMENT_TTL_MINUTES = 30;

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
      if (status === 'PENDING') {
        checked++;
        if (ageMin <= ttlMinutes) continue;
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
              await this.repo.updateAttendanceAdjustment(adjId, 'REJECTED', 'SYSTEM', undefined, AttendanceService.AUTO_REJECT_NOTE);
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
    const needIn = /QUEN_CHECKIN|LOI_GPS/i.test(reason);
    const needOut = /QUEN_CHECKOUT|LOI_GPS/i.test(reason);
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
