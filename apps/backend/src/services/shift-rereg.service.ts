/**
 * ShiftReRegService — Phiếu "Cập Nhật Ca Làm" TỰ PHỤC VỤ của nhân viên (BETA).
 *
 * Ý nghĩa: trong một đợt khai công lại (mặc định 01/10 → 24/10/2026, đổi được
 * bằng env SCHEDULE_REREG_FROM / SCHEDULE_REREG_TO), nhân viên vào Cổng NV →
 * tab "Cập Nhật Ca" → chọn ngày + ca làm hiện tại, thêm tiếp tục cho đến đủ,
 * rồi bấm "Gửi Phiếu". Hệ thống (bot) TỰ ĐỘNG cập nhật lại đúng ca các nhân
 * viên vừa khai — không cần duyệt tay:
 *
 *  - Ca đã qua (ngày < hôm nay, UTC+7): tạo/đè ca → PUBLISHED → bot tự chấm
 *    HOÀN THÀNH (đủ CHECK_IN + CHECK_OUT giờ chuẩn ca, +07:00) → lương kỳ sau
 *    (payroll duyệt ca PUBLISHED có đủ in/out) TỰ ĐỘNG cộng tiền ca
 *    (số giờ ca × đơn giá giờ hiện tại của NV).
 *  - Ca chưa tới (ngày >= hôm nay): tạo/đè ca → để chấm công mặc định (CHỜ,
 *    NV điểm danh thật khi vào ca như mọi ngày).
 *  - Ràng buộc dữ liệu realtime: ca đã có điểm danh (bằng chứng công) giữ
 *    nguyên + ghi chú, không đè; tối đa 2 ca/ngày; OFF trúng ngày khai ca tự
 *    hủy (giống xếp tay) kèm thông báo realtime cho NV.
 *  - Đồng bộ Google Sheets: MỖI dòng phiếu ghi vào tab PHIEU_NV_CAP_NHAT_CA —
 *    tab chưa có trên Sheet thì hệ thống TỰ TẠO bảng + đủ cột (self-heal
 *    SHEETS_DEFINITIONS, tính cả health sheetsCount).
 */
import { SHIFT_TEMPLATES } from '@ubm/shared';
import type { ShiftCode } from '@ubm/shared';
import { SchedulesService } from './schedules.service.js';
import { EmployeesService } from './employees.service.js';
import { AttendanceService } from './attendance.service.js';
import { singleWriterQueue } from '../repositories/single-writer-queue.js';

const TAB_SLIP = 'PHIEU_NV_CAP_NHAT_CA';
const VALID_CODES = Object.keys(SHIFT_TEMPLATES) as ShiftCode[];

export type ReRegOutcome = 'CREATED' | 'UPDATED' | 'KEPT' | 'ERROR';
export type ReRegAttendance = 'COMPLETED' | 'PENDING' | 'SKIPPED' | 'ERROR';

export type ReRegLine = {
  code: ShiftCode;
  outcome: ReRegOutcome;
  attendance: ReRegAttendance;
  assignmentId?: string;
  payEstimate?: number; // tiền ca ước tính cho ca đã HOÀN THÀNH (VNĐ)
  message?: string;
};

export type ReRegEntryReport = {
  date: string;
  offNotes: string[]; // OFF tự hủy vì trúng ca khai
  lines: ReRegLine[];
};

export type ReRegReport = {
  slipId: string;
  from: string;
  to: string;
  today: string;
  created: number;
  updated: number;
  kept: number;
  completed: number; // số ca đã qua được bot chấm HOÀN THÀNH (+ cộng tiền ca)
  pending: number; // số ca chưa tới — chờ điểm danh thật
  errors: ReRegLine[];
  entries: ReRegEntryReport[];
  sheetsSynced: boolean;
  notified: number;
};

export class ShiftReRegService {
  constructor(
    private schedulesService: SchedulesService,
    private employeesService: EmployeesService,
    private attendanceService: AttendanceService,
    private syncService: any, // GoogleSheetsSyncService (appendRow + self-heal tab)
    private repo: any, // ISheetsRepository (đọc/ghi ca điểm danh realtime)
  ) {}

  /** Cửa sổ đợt mặc định (env) — dùng khi Admin chưa đặt thời gian riêng. */
  public window() {
    const from = (process.env.SCHEDULE_REREG_FROM || '2026-10-01').slice(0, 10);
    const to = (process.env.SCHEDULE_REREG_TO || '2026-10-24').slice(0, 10);
    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    return { from, to, today };
  }

  /**
   * Cấu hình BẬT/TẮT + cửa sổ thời gian do ADMIN đặt (lưu systemSettings →
   * tự đồng bộ tab CAU_HINH_HE_THONG trên Google Sheets). Mặc định ĐÓNG.
   */
  private async readCfg(): Promise<{ cfg: any; enabled: boolean; from: string; to: string; today: string }> {
    const envWin = this.window();
    const settings: any = await this.repo.getSystemSettings?.().catch(() => null) || {};
    const cfg = settings?.shift_re_registration || {};
    return {
      cfg,
      enabled: !!cfg.enabled,
      from: String(cfg.from || envWin.from).slice(0, 10),
      to: String(cfg.to || envWin.to).slice(0, 10),
      today: envWin.today,
    };
  }

  /** Admin xem cấu hình hiện tại (kèm ai bật + lúc nào). */
  public async getAdminConfig() {
    const { cfg, enabled, from, to } = await this.readCfg();
    return {
      enabled,
      from,
      to,
      updatedAt: (cfg as any)?.updated_at || null,
      updatedBy: (cfg as any)?.updated_by || null,
    };
  }

  /** Admin bật/tắt + đặt thời gian hiển thị (đợt from → to) cho cổng NV. */
  public async saveConfig(
    actorId: string,
    patch: { enabled: boolean; from?: string; to?: string }
  ) {
    const envWin = this.window();
    const settings: any = await this.repo.getSystemSettings?.().catch(() => null) || {};
    const cur = settings?.shift_re_registration || {};
    const from = String(patch.from || cur.from || envWin.from).slice(0, 10);
    const to = String(patch.to || cur.to || envWin.to).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new Error('BAD_DATE: ngày phải dạng YYYY-MM-DD!');
    }
    if (from > to) throw new Error('BAD_RANGE: ngày bắt đầu phải <= ngày kết thúc!');
    const cfg = {
      enabled: !!patch.enabled,
      from,
      to,
      updated_at: new Date().toISOString(),
      updated_by: String(actorId || ''),
    };
    await this.repo.updateSystemSettings({ ...settings, shift_re_registration: cfg });
    return cfg;
  }

  /** Trạng thái tab: bật/tắt + cửa sổ + mốc ĐÓNG (endsAt) để cổng NV đếm ngược. */
  public async getStatus(employeeId: string) {
    const { enabled, from, to, today } = await this.readCfg();
    const emp: any = await this.employeesService.getEmployee(employeeId).catch(() => null);
    if (!emp) throw new Error('EMPLOYEE_NOT_FOUND: không tìm thấy hồ sơ nhân viên!');
    const shifts = (await this.schedulesService.getEmployeeShifts(employeeId, from, to).catch(() => [])) as any[];
    return {
      enabled,
      from,
      to,
      today,
      // Mốc đếm ngược: hết ngày cuối cùng theo giờ Việt Nam (+07:00)
      endsAt: `${to}T23:59:59+07:00`,
      employee: { id: employeeId, code: (emp as any).employee_code, name: (emp as any).full_name },
      existing: (shifts || [])
        .filter((s) => String(s.status || '') !== 'CANCELLED')
        .map((s) => ({ assignmentId: s.assignment_id, date: String(s.date || '').slice(0, 10), code: s.shift_code, status: s.status })),
    };
  }

  /**
   * Gửi phiếu: MỘT task hàng đợi ghi ca (an toàn Sheets rate-limit), SAU ĐÓ bot
   * chấm hoàn thành từng ca đã qua (compensateShift tự xếp hàng riêng — không
   * được gọi trong task để tránh chờ lồng nhau), rồi ghi phiếu lên Sheet.
   */
  public async submitForm(
    employeeId: string,
    entries: Array<{ date: string; codes: ShiftCode[] }>,
    actorId: string
  ): Promise<ReRegReport> {
    const { enabled, from, to, today } = await this.readCfg();
    if (!enabled) {
      throw new Error('FEATURE_DISABLED: phiếu Cập Nhật Ca chưa được Quản trị viên mở!');
    }
    if (today > to) {
      throw new Error(`SLIP_CLOSED: đợt khai công đã kết thúc ngày ${to} — liên hệ quản lý!`);
    }
    const win = { from, to, today };
    const emp: any = await this.employeesService.getEmployee(employeeId).catch(() => null);
    if (!emp) throw new Error('EMPLOYEE_NOT_FOUND: không tìm thấy hồ sơ nhân viên!');

    // Chuẩn hóa + gộp trùng (1 ô ca duy nhất cho cặp ngày|ca)
    const byDate = new Map<string, Set<ShiftCode>>();
    for (const e of entries || []) {
      const date = String(e?.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < win.from || date > win.to) {
        throw new Error(`WINDOW_OUT_OF_RANGE: ngày ${date || '?'} nằm ngoài đợt ${win.from} → ${win.to}!`);
      }
      if (!byDate.has(date)) byDate.set(date, new Set());
      for (const c of e?.codes || []) {
        if (VALID_CODES.includes(String(c) as ShiftCode)) byDate.get(date)!.add(String(c) as ShiftCode);
      }
    }
    if (byDate.size === 0) {
      throw new Error('EMPTY_SLIP: phiếu chưa có ngày/ca nào!');
    }
    const plan = Array.from(byDate.entries()).map(([date, set]) => ({ date, codes: Array.from(set).slice(0, 2) }));

    const slipId = `PHIEU_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const empId = String(employeeId);
    const empCode = String((emp as any).employee_code || '');
    const empName = String((emp as any).full_name || '');
    const rate = Number((emp as any).current_rate_per_hour) || 0;

    const task = await singleWriterQueue.enqueue({
      entityType: 'PHIEU_NV_CAP_NHAT_CA',
      entityId: `${empId}_${Date.now()}`,
      actorId,
      execute: async () => {
        const entries: ReRegEntryReport[] = [];
        const completeIds: Array<{ assignmentId: string; code: ShiftCode }> = [];
        let created = 0;
        let updated = 0;
        let kept = 0;
        let completed = 0;
        let pending = 0;
        const errors: ReRegLine[] = [];
        const warnings: string[] = [];
        // Đọc MỘT lần cả đợt ca hiện có (realtime trong task)
        const existing = ((await this.schedulesService.getEmployeeShifts(empId, win.from, win.to).catch(() => [])) as any[])
          .filter((s) => String(s.status || '') !== 'CANCELLED');

        for (const { date, codes } of plan) {
          const entry: ReRegEntryReport = { date, offNotes: [], lines: [] };
          const past = date < win.today;
          const sameDay = existing.filter((s) => String(s.date || '').slice(0, 10) === date);
          // Ca đã "tiêu hao" bởi việc đè mã khác trong phiếu này (đếm theo body
          // của ca — mảng sameDay là ảnh chụp đọc đầu task, không đổi theo repo)
          const usedIds = new Set<string>();
          // Bằng chứng điểm danh trong ngày (bất kể gắn ca hay mồ côi)
          const dayEvents = await this.repo.getAttendanceEvents(empId, date).catch(() => []);
          const hasAttend = (dayEvents || []).length > 0;

          for (const code of codes) {
            const template = SHIFT_TEMPLATES[code];
            const hours = Number((template as any)?.duration_hours) || 5;
            const startAt = `${date}T${String((template as any).start_hour).padStart(2, '0')}:00:00+07:00`;
            const endAt = `${date}T${String((template as any).end_hour).padStart(2, '0')}:00:00+07:00`;
            const payEst = hours * rate; // ước tính tiền ca payroll sẽ tự cộng

            const mine = sameDay.find((s) => !usedIds.has(String(s.assignment_id)) && String(s.shift_code) === String(code));
            if (mine) {
              // Đã đúng ca đó rồi → giữ nguyên; ca đã qua đảm bảo bot chấm đủ
              kept += 1;
              if (past) completeIds.push({ assignmentId: String(mine.assignment_id), code });
              entry.lines.push({
                code, outcome: 'KEPT',
                attendance: past ? 'COMPLETED' : 'PENDING',
                assignmentId: String(mine.assignment_id),
                payEstimate: past ? payEst : undefined,
              });
              continue;
            }
            if (sameDay.filter((s) => !usedIds.has(String(s.assignment_id))).length >= 2) {
              const line: ReRegLine = {
                code, outcome: 'ERROR', attendance: past ? 'SKIPPED' : 'PENDING',
                message: `Ngày ${date} đã đủ 2 ca (${sameDay.map((s) => s.shift_code).join(' + ')}) — không xếp thêm!`,
              };
              errors.push(line);
              entry.lines.push(line);
              continue;
            }
            const other = sameDay.find((s) => !usedIds.has(String(s.assignment_id)) && String(s.shift_code) !== String(code));
            if (other && past && hasAttend) {
              // Ngày đã chấm công thật → giữ bằng chứng công/lương, không đè
              const line: ReRegLine = {
                code: other.shift_code as ShiftCode, outcome: 'KEPT', attendance: 'COMPLETED',
                assignmentId: String(other.assignment_id), payEstimate: payEst,
                message: `Ngày ${date} đã có điểm danh — giữ ${other.shift_code}, không đè thành ${code} (bảo vệ bằng chứng công)`,
              };
              errors.push(line);
              entry.lines.push(line);
              continue;
            }
            if (other) {
              // Đè ca khác mã (ngày tương lai hoặc đã qua chưa chấm): version + 1
              const upd = await this.repo.updateShiftAssignment(String(other.assignment_id), {
                shift_code: code,
                start_at: startAt,
                end_at: endAt,
                schedule_version: Number((other as any).schedule_version || 1) + 1,
                status: 'PUBLISHED',
              });
              usedIds.add(String(upd?.assignment_id || other.assignment_id)); // ca cũ đã "tiêu hao"
              updated += 1;
              if (past) completeIds.push({ assignmentId: String(upd?.assignment_id || other.assignment_id), code });
              entry.lines.push({
                code, outcome: 'UPDATED',
                attendance: past ? 'COMPLETED' : 'PENDING',
                assignmentId: String(upd?.assignment_id || other.assignment_id),
                payEstimate: past ? payEst : undefined,
                message: `Đè ${other.shift_code} → ${code}`,
              });
              continue;
            }
            // Tạo ca mới (hành xử như xếp tay: tự hủy OFF trúng ngày)
            const createdShift: any = await this.repo.createShiftAssignment({
              assignment_id: `SHIFT_${Date.now()}_${Math.floor(Math.random() * 1000000)}`,
              employee_id: empId,
              branch_id: (emp as any).default_branch_id || 'CN130',
              shift_code: code,
              date,
              start_at: startAt,
              end_at: endAt,
              status: 'PUBLISHED',
              schedule_version: 1,
            });
            const offNotes = await this.schedulesService
              .cancelReceiverLeavesOnWorkDay(empId, date)
              .catch(() => [] as string[]);
            if (offNotes.length > 0) entry.offNotes.push(...offNotes);
            created += 1;
            const aid = String(createdShift?.assignment_id || '');
            sameDay.push(createdShift as any);
            usedIds.add(aid); // ca mới của mục tiêu này — không để dòng sau "đè" nó
            if (past) completeIds.push({ assignmentId: aid, code });
            entry.lines.push({
              code, outcome: 'CREATED',
              attendance: past ? 'COMPLETED' : 'PENDING',
              assignmentId: aid,
              payEstimate: past ? payEst : undefined,
            });
          }
          entries.push(entry);
        }
        return { entries, completeIds, created, updated, kept, errors, warnings, empId, empCode, empName, slipId };
      },
    });
    const t: any = task; // hàng đợi trả wrapper, kết quả thật nằm trong result
    const r = t?.result || t;

    // BOT CHẤM: từng ca đã qua thiếu in/out → chấm HOÀN THÀNH giờ chuẩn ca
    // (+07:00) — payroll kỳ sau tự cộng tiền ca (số giờ × đơn giá hiện tại).
    let completedCount = 0;
    for (const item of r.completeIds || []) {
      try {
        await this.attendanceService.compensateShift({
          assignmentId: item.assignmentId,
          reason: 'Bot chấm tự động theo phiếu Cập Nhật Ca (NV tự khai lại công)',
          actorId: actorId || 'BOT_REREG',
        });
        completedCount += 1;
      } catch (err: any) {
        const msg = String(err?.message || '');
        // Đã đủ in/out từ trước = coi như hoàn thành, không phải lỗi
        if (msg.startsWith('SHIFT_ALREADY_COMPLETE')) completedCount += 1;
        else {
          const line: ReRegLine = { code: item.code, outcome: 'ERROR', attendance: 'ERROR', assignmentId: item.assignmentId, message: `Chấm tự động lỗi: ${msg}` };
          (r.errors as ReRegLine[]).push(line);
          for (const entry of r.entries as ReRegEntryReport[]) {
            const hit = entry.lines.find((l) => l.assignmentId === item.assignmentId && l.outcome !== 'ERROR');
            if (hit) { hit.attendance = 'ERROR'; hit.message = line.message; break; }
          }
        }
      }
    }

    // Đồng bộ Google Sheets: phiếu ghi đầy đủ vào tab PHIEU_NV_CAP_NHAT_CA
    // (tab thiếu → tự tạo bảng + header qua self-heal SHEETS_DEFINITIONS).
    let sheetsSynced = false;
    try {
      if (this.syncService) {
        await this.syncService.initSpreadsheetStructure?.();
        const stamp = new Date().toISOString();
        for (const entry of r.entries as ReRegEntryReport[]) {
          for (const line of entry.lines) {
            await this.syncService.appendRow(TAB_SLIP, [
              r.slipId,
              empId,
              empCode,
              empName,
              entry.date,
              line.code,
              line.outcome,
              line.attendance,
              typeof line.payEstimate === 'number' ? Math.round(line.payEstimate) : '',
              [line.message, ...entry.offNotes].filter(Boolean).join(' | '),
              stamp,
            ]).catch(() => false);
          }
        }
        sheetsSynced = true;
      }
    } catch { /* best-effort: full-sync nền sẽ thử lại */ }

    // REALTIME: thông báo cá nhân cho chính NV gửi phiếu (tổng hợp thay đổi)
    const parts: string[] = [];
    if (r.created) parts.push(`+${r.created} ca mới`);
    if (r.updated) parts.push(`đổi ${r.updated} ca`);
    if (r.kept) parts.push(`giữ ${r.kept} ca`);
    if (completedCount) parts.push(`bot đã chấm HOÀN THÀNH ${completedCount} ca đã qua (cộng tiền ca tự động trong kỳ lương)`);
    const offNoteLines = (r.entries as ReRegEntryReport[]).flatMap((e) => e.offNotes);
    const notified = this.schedulesService.notifyEmployeesRealtime([{
      employeeId: empId,
      title: `📨 Phiếu Cập Nhật Ca ${r.slipId} đã xử lý`,
      message: `Ca làm của bạn đã được cập nhật: ${parts.join(', ') || 'không có thay đổi'}.${offNoteLines.length ? ` ${offNoteLines.join(' ')}` : ''}`,
    }]);

    const pending = (r.entries as ReRegEntryReport[]).reduce((n, e) => n + e.lines.filter((l) => l.attendance === 'PENDING').length, 0);
    return {
      slipId: r.slipId,
      from: win.from,
      to: win.to,
      today: win.today,
      created: r.created,
      updated: r.updated,
      kept: r.kept,
      completed: completedCount,
      pending,
      errors: r.errors,
      entries: r.entries,
      sheetsSynced,
      notified,
    };
  }
}
