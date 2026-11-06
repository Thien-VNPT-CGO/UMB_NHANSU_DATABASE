import {
  BankQrConfig,
  ERROR_CODES,
  PayrollRun,
  PayrollRunStatus,
  PayslipItem,
  PayslipSignerRole,
  SHIFT_TEMPLATES,
  STANDARD_HOURLY_RATES,
  DEFAULT_PAYROLL_FORMULA,
} from '@ubm/shared';
import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { SalaryConfigService } from './salary-config.service.js';
import { effectivePayMode } from '@ubm/shared';
import { singleWriterQueue } from '../repositories/single-writer-queue.js';
import { v4 as uuidv4 } from 'uuid';
import { Server } from 'socket.io';

/**
 * Nấc phạt đi trễ (NV chính thức), tính trên lương 1 ca:
 * - Đến sớm/trễ dưới 10 phút: không vi phạm.
 * - Trễ 10–29 phút: phạt 30.000đ.
 * - Trễ 30–59 phút: phạt 50% lương ca.
 * - Trễ từ 60 phút: phạt 100% lương ca (ca không lương).
 * - Thiếu check-in hoặc check-out: vắng 100% lương ca.
 */
export const LATE_FINE_FLAT_VND = 30000;
/** Mốc trễ tối thiểu bắt đầu bị phạt (phút). */
export const LATE_FINE_GRACE_MINUTES = 10;

export function lateFineFor(minutesLate: number, shiftPay: number): { tier: string; deduction: number; unpaid: boolean } {
  const m = Math.floor(Number(minutesLate) || 0);
  if (m < LATE_FINE_GRACE_MINUTES) return { tier: 'NONE', deduction: 0, unpaid: false };
  if (m < 30) return { tier: 'FLAT_30K', deduction: LATE_FINE_FLAT_VND, unpaid: false };
  if (m < 60) return { tier: 'HALF_SHIFT', deduction: Math.round(shiftPay * 0.5), unpaid: false };
  return { tier: 'FULL_SHIFT', deduction: 0, unpaid: true };
}

/**
 * Mức phạt đã ghi lúc check-in vẫn được ưu tiên (chống mất cờ khi pull Sheets),
 * nhưng KHÔNG dùng lại khoản 30k cũ cho ca trễ dưới 10 phút — quy tắc mới không phạt.
 */
export function isStoredFineStillValid(storedTier: string | undefined, lateMin: number): boolean {
  if (!storedTier || storedTier === 'NONE') return false;
  if (storedTier === 'FLAT_30K' && Number(lateMin) < LATE_FINE_GRACE_MINUTES) return false;
  return true;
}

/**
 * Chia sự kiện điểm danh trong ngày cho các ca: khớp cứng assignment_id trước,
 * phiếu sót (assignment rỗng / trỏ ca đã hủy-không tồn tại, VD sau khi HR xếp
 * lại lịch đổi mã ca) bù cho ca còn thiếu chân theo thứ tự (ưu tiên ca đã có
 * 1 chân để ngày nhiều ca không cướp oan). Phiếu đang gắn ca live khác KHÔNG
 * bao giờ bị cướp (chống tính đúp công). Dùng chung payroll + đối soát.
 */
export function linkDayEvents(
  dayShifts: any[],
  dayEvents: any[]
): Map<string, { CHECK_IN?: any; CHECK_OUT?: any; ABSENT?: any }> {
  const liveIds = new Set(
    (dayShifts || []).filter((s: any) => (s as any)?.status !== 'CANCELLED').map((s: any) => String((s as any)?.assignment_id || ''))
  );
  const cancelledIds = new Set(
    (dayShifts || []).filter((s: any) => (s as any)?.status === 'CANCELLED').map((s: any) => String((s as any)?.assignment_id || ''))
  );
  const byId = new Map<string, { CHECK_IN?: any; CHECK_OUT?: any; ABSENT?: any }>();
  const get = (id: string) => {
    if (!byId.has(id)) byId.set(id, {});
    return byId.get(id)!;
  };
  const used = new Set<string>();
  const legOf = (e: any): string => String((e as any)?.type || '');
  // 1. Khớp cứng assignment_id (kể cả ABSENT).
  for (const e of dayEvents || []) {
    const aid = String((e as any)?.assignment_id || '');
    const t = legOf(e);
    if (!aid || (t !== 'CHECK_IN' && t !== 'CHECK_OUT' && t !== 'ABSENT')) continue;
    if (!liveIds.has(aid)) continue;
    const slot = get(aid);
    if (!(slot as any)[t]) {
      (slot as any)[t] = e;
      if ((e as any)?.event_id) used.add(String((e as any).event_id));
    }
  }
  // 2. Pool sót: assignment rỗng hoặc trỏ ca chết/không tồn tại (chỉ IN/OUT).
  const pool = (dayEvents || []).filter((e: any) => {
    if ((e as any)?.event_id && used.has(String((e as any).event_id))) return false;
    const t = legOf(e);
    if (t !== 'CHECK_IN' && t !== 'CHECK_OUT') return false;
    const aid = String((e as any)?.assignment_id || '');
    if (!aid) return true;
    if (cancelledIds.has(aid)) return true;
    if (!liveIds.has(aid)) return true;
    return false;
  });
  // 3. Bù cho ca live còn thiếu (lượt 0: ca đã có 1 chân trước; lượt 1: còn lại).
  const liveShifts = (dayShifts || []).filter((s: any) => (s as any)?.status !== 'CANCELLED');
  for (let pass = 0; pass < 2; pass++) {
    for (const s of liveShifts) {
      const slot = get(String((s as any)?.assignment_id || ''));
      for (const t of ['CHECK_IN', 'CHECK_OUT']) {
        if ((slot as any)[t]) continue;
        const idx = pool.findIndex((e: any) => legOf(e) === t);
        if (idx < 0) continue;
        if (pass === 0 && !(slot as any)['CHECK_IN'] && !(slot as any)['CHECK_OUT']) continue;
        (slot as any)[t] = pool[idx];
        if ((pool[idx] as any)?.event_id) used.add(String((pool[idx] as any).event_id));
        pool.splice(idx, 1);
      }
    }
  }
  return byId;
}

/**
 * Bù 1 chân điểm danh mồ côi (gắn ca đã mất/hủy/không tồn tại) cho ca còn thiếu
 * — mirror lưới hiển thị (mergeOrphanCheckins): ca "đã điểm danh" trên lưới
 * không còn lương 0đ. Chỉ bù khi ca thiếu chân + giờ lọt khung giờ ca (vào sớm
 * 60p → tan +30p); phiếu đã tiêu thụ không dùng lại; phiếu gắn ca live khác
 * không bao giờ bị cướp; phiếu không gắn ca nào giữ nguyên khớp cũ (mọi ca).
 * Ưu tiên phiếu cùng ca chết với chân đã có để không ghép cặp lệch.
 */
export function orphanLegFor(
  dayEvents: any[],
  s: any,
  dayLiveIds: Set<string>,
  statusByAssign: Map<string, string>,
  consumed: Set<string>,
  type: 'CHECK_IN' | 'CHECK_OUT',
  preferAid?: string,
): any | undefined {
  const inWindow = (iso: string) => {
    const t = new Date(iso || '').getTime();
    const st = (s as any)?.start_at ? new Date((s as any).start_at).getTime() : NaN;
    const en = (s as any)?.end_at ? new Date((s as any).end_at).getTime() : NaN;
    if (!Number.isFinite(t) || !Number.isFinite(st) || !Number.isFinite(en)) return false;
    return t >= st - 60 * 60 * 1000 && t <= en + 30 * 60 * 1000;
  };
  const cands = (dayEvents || []).filter((e: any) => {
    if ((e as any)?.type !== type) return false;
    const aid = String((e as any)?.assignment_id || '');
    if (!aid || aid === String((s as any)?.assignment_id)) return false;
    if ((e as any)?.event_id && consumed.has(String((e as any).event_id))) return false;
    if (dayLiveIds.has(aid)) return false;
    const stt = statusByAssign.get(aid);
    if (stt && stt !== 'CANCELLED') return false;
    return inWindow((e as any)?.client_time);
  });
  cands.sort((a: any, b: any) => {
    const ap = preferAid && String((a as any)?.assignment_id) === String(preferAid) ? 0 : 1;
    const bp = preferAid && String((b as any)?.assignment_id) === String(preferAid) ? 0 : 1;
    return ap - bp;
  });
  const pick = cands[0];
  if (pick && (pick as any)?.event_id) consumed.add(String((pick as any).event_id));
  return pick;
}

/**
 * Đơn giá + giai đoạn (TV/CT) của NV tại 1 ngày công.
 * NV thử việc được HR chuyển chính thức giữa kỳ: ngày trước official_date
 * tính lương thử việc, từ official_date tính lương chính thức — lương 2 giai
 * đoạn đầy đủ từ lúc vào thử việc, không sót NV nào.
 * Ưu tiên lịch sử giai đoạn (đơn giá ghi nhận tại thời điểm), thiếu thì
 * official_date, cuối cùng là trạng thái hiện tại.
 */
export function rateOnDate(
  emp: any,
  dayISO: string,
  hist: any[],
  tvFallback: number,
  ctFallback: number
): { rate: number; stage: 'TV' | 'CT' } {
  const d = String(dayISO || '').slice(0, 10);
  const sorted = (hist || [])
    .filter((h: any) => h && (h as any).effective_from)
    .sort((a: any, b: any) => String(a.effective_from).localeCompare(String(b.effective_from)));
  const rateOfStage = (wantTV: boolean): number => {
    let r: number | null = null;
    for (const h of sorted) {
      if (String((h as any).effective_from).slice(0, 10) > d) break;
      const st = String((h as any).stage || '').toUpperCase();
      const isTV = st === 'PROBATION' || st === 'TV';
      if (isTV === wantTV) {
        const v = Number((h as any).rate_per_hour);
        if (Number.isFinite(v) && v > 0) r = v;
      }
    }
    if (r !== null) return r;
    return wantTV ? tvFallback : ctFallback;
  };
  // Mốc official_date trên master là đường cắt cứng theo ngày HR duyệt:
  // VD thử việc 01-09/10, duyệt 13/10 -> ngày < 13/10 luôn TV, từ 13/10 luôn CT
  // (kể cả khi lịch sử giai đoạn cũ/sửa tay chưa kịp đồng bộ).
  const off = String((emp as any)?.official_date || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(off)) {
    if (d < off) return { rate: rateOfStage(true), stage: 'TV' };
    return { rate: rateOfStage(false), stage: 'CT' };
  }
  let cur: any = null;
  for (const h of sorted) {
    if (String((h as any).effective_from).slice(0, 10) <= d) cur = h;
    else break;
  }
  if (cur) {
    const st = String((cur as any).stage || '').toUpperCase();
    const isTV = st === 'PROBATION' || st === 'TV';
    const r = Number((cur as any).rate_per_hour);
    return { rate: Number.isFinite(r) && r > 0 ? r : (isTV ? tvFallback : ctFallback), stage: isTV ? 'TV' : 'CT' };
  }
  const offFb = String((emp as any)?.official_date || '').slice(0, 10);
  if (offFb && d < offFb) return { rate: tvFallback, stage: 'TV' };
  const isProbNow = String((emp as any)?.employment_status || '').toUpperCase() === 'PROBATION';
  return isProbNow ? { rate: tvFallback, stage: 'TV' } : { rate: ctFallback, stage: 'CT' };
}

/** Trạng thái đồng bộ Sheets của các thao tác kế toán (hiển thị ở Dashboard Tài chính). */
export const financeSheetsSyncState: { at: string; ok: boolean | null; error: string } = {
  at: '',
  ok: null,
  error: '',
};

/**
 * Khoảng ngày chuẩn của 1 kỳ lương: ngày 1 -> ngày cuối tháng (28/29/30/31).
 * Dùng chung cho mọi tính toán Finance để kế toán luôn thấy đủ công cả tháng.
 */
export function monthRange(period: string): { fromDate: string; toDate: string; daysInMonth: number } {
  const m = String(period || '').match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!m) throw new Error('Kỳ lương phải dạng YYYY-MM (VD: 2026-10)!');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const dd = String(daysInMonth).padStart(2, '0');
  return { fromDate: `${period}-01`, toDate: `${period}-${dd}`, daysInMonth };
}

export class PayrollService {
  constructor(
    private repo: ISheetsRepository,
    private io?: Server,
    /** Cấu hình lương (LCB/phụ cấp/hình thức theo tháng-ca) — Kế toán cấu hình. */
    private salaryConfig?: SalaryConfigService,
  ) {}

  public setSocketServer(io: Server) {
    this.io = io;
  }

  private notificationsService?: any;
  public setNotificationsService(svc: any) {
    this.notificationsService = svc;
  }

  private payslipDriveService?: { syncSlipToDrive(itemId: string): Promise<{ ok: boolean; fileId?: string; link?: string; error?: string }> };
  public setPayslipDriveService(svc: any) {
    this.payslipDriveService = svc;
  }

  /**
   * Đẩy NGAY (await) các tab kế toán lên Google Sheets sau mỗi thao tác tài
   * chính. Best-effort: lỗi Sheets không làm hỏng nghiệp vụ (dữ liệu vẫn an
   * toàn trên PostgreSQL/bộ nhớ) nhưng luôn ghi lại trạng thái để UI hiển thị
   * và báo rõ thay vì giả vờ "đã đồng bộ".
   */
  public async syncFinanceToSheets(opts?: { skipSlips?: boolean }): Promise<{ ok: boolean; error?: string }> {
    financeSheetsSyncState.at = new Date(Date.now() + 7 * 3_600_000).toISOString();
    try {
      const sync = (this.repo as any)?.syncService || (this.repo as any)?.fallbackAdapter?.syncService;
      if (!sync || typeof sync.pushFinanceTabsNow !== 'function') {
        financeSheetsSyncState.ok = true; // môi trường không có Sheets: coi như đã lưu chắc ở DB
        financeSheetsSyncState.error = '';
        return { ok: true };
      }
      const res = await sync.pushFinanceTabsNow(this.repo, opts);
      if (res?.skipped) {
        financeSheetsSyncState.ok = true;
        financeSheetsSyncState.error = '';
        return { ok: true };
      }
      const errs: string[] = res?.errors || [];
      if (errs.length > 0) {
        financeSheetsSyncState.ok = false;
        financeSheetsSyncState.error = errs.join('; ').slice(0, 300);
        console.warn('[PayrollService] Đồng bộ tài chính lên Sheets có lỗi:', financeSheetsSyncState.error);
        return { ok: false, error: financeSheetsSyncState.error };
      }
      financeSheetsSyncState.ok = true;
      financeSheetsSyncState.error = '';
      return { ok: true };
    } catch (e: any) {
      financeSheetsSyncState.ok = false;
      financeSheetsSyncState.error = String(e?.message || e).slice(0, 300);
      console.warn('[PayrollService] Đồng bộ tài chính lên Sheets thất bại:', financeSheetsSyncState.error);
      return { ok: false, error: financeSheetsSyncState.error };
    }
  }

  public triggerSheetsPush(): void {
    // Giữ nguyên chữ ký gọi fire-and-forget cho các caller chưa kịp await.
    void this.syncFinanceToSheets();
  }

  async calculateDraftPayroll(period: string, branchScope = '*', creatorId: string) {
    const runId = `PAY_${period.replace('-', '_')}_${Date.now()}`;

    return singleWriterQueue.enqueue({
      entityType: 'KY_LUONG',
      entityId: runId,
      actorId: creatorId,
      execute: async () => {
        const employees = await this.repo.listEmployees({ branch: branchScope });
        const salaryConfigs: any = await this.salaryConfig?.getAll().catch(() => ({})) || {};
        const inputsArr = await this.repo.getPayrollInputs(period).catch(() => [] as any[]);
        const inputs = new Map((inputsArr || []).map((x: any) => [x.employee_id, x]));
        const { fromDate, toDate } = monthRange(period);

        const payslipItems: Omit<PayslipItem, 'created_at' | 'updated_at'>[] = [];
        let totalHours = 0;
        let totalAmount = 0;

        // Gộp sự kiện điểm danh tuần cũ từ kho LUUTRU (đã archive khỏi realtime) —
        // nếu không, kỳ lương tính sau ngày archive sẽ bỏ sót công tuần cũ.
        let archivedByEmpDay = new Map<string, any[]>();
        try {
          const archived = await (this.repo as any)?.syncService?.getArchivedAttendanceEvents?.(fromDate, toDate) || [];
          for (const e of archived || []) {
            const t = new Date((e as any)?.client_time || '').getTime();
            if (!Number.isFinite(t)) continue;
            const day = new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
            const k = `${(e as any)?.employee_id}|${day}`;
            if (!archivedByEmpDay.has(k)) archivedByEmpDay.set(k, []);
            archivedByEmpDay.get(k)!.push(e);
          }
        } catch { archivedByEmpDay = new Map(); }

        for (const emp of employees) {
          const empShifts = await this.repo.getShiftsForEmployee(emp.employee_id, fromDate, toDate);
          const publishedShifts = empShifts.filter(s => s.status === 'PUBLISHED');

          // Ràng buộc: đủ check-in + check-out mới tính 1 lương/ca.
          // Thiếu 1 trong 2 (kể cả bản ghi ABSENT) = vắng 100% lương ca.
          const eventsByDate = new Map<string, any[]>();
          const eventsOf = async (date: string) => {
            if (!eventsByDate.has(date)) {
              const live = await this.repo.getAttendanceEvents(emp.employee_id, date).catch(() => []);
              const extra = archivedByEmpDay.get(`${emp.employee_id}|${date}`) || [];
              let merged = live;
              if (extra.length > 0) {
                const ids = new Set((live || []).map((e: any) => e.event_id));
                merged = [...(live || [])];
                for (const e of extra) if (!ids.has((e as any).event_id)) merged.push(e);
              }
              eventsByDate.set(date, merged);
            }
            return eventsByDate.get(date)!;
          };
          // Bù chân mồ côi như lưới hiển thị (mọi NV): phiếu gắn ca chết không
          // dùng lại 2 lần, không cướp phiếu ca live khác.
          const consumedOrphans = new Set<string>();
          const statusByAssign = new Map((empShifts || []).map((x: any) => [String(x.assignment_id), String(x.status || '')]));
          const dayLiveIdsOf = (dayISO: string) => new Set((empShifts || [])
            .filter((x: any) => String(x.date).slice(0, 10) === String(dayISO).slice(0, 10) && String(x.status) !== 'CANCELLED')
            .map((x: any) => String(x.assignment_id)));
          // Đơn giá hiện tại (giữ làm rate_snapshot tương thích) + lịch sử giai
          // đoạn để tính đúng đơn giá từng ngày (NV chuyển TV→CT giữa kỳ).
          const rate = Number((emp as any).current_rate_per_hour) || 0;
          const hist = await this.repo.getStageHistory(emp.employee_id).catch(() => []);
          let absentShifts = 0;
          let empHours = 0;
          let standardPay = 0;
          let tvHours = 0;
          let tvPay = 0;
          let ctHours = 0;
          let ctPay = 0;
          let deduction = 0;
          const lateCases: string[] = [];
          for (const s of publishedShifts) {
            const dayEvents = await eventsOf(s.date);
            const dayLiveIds = dayLiveIdsOf(s.date);
            let inEvt = dayEvents.find(
              (e: any) => e.type === 'CHECK_IN' && (!e.assignment_id || e.assignment_id === s.assignment_id)
            );
            if (!inEvt) inEvt = orphanLegFor(dayEvents, s, dayLiveIds, statusByAssign, consumedOrphans, 'CHECK_IN');
            let hasOut = dayEvents.some(
              (e: any) => e.type === 'CHECK_OUT' && (!e.assignment_id || e.assignment_id === s.assignment_id)
            );
            if (!hasOut) hasOut = !!orphanLegFor(dayEvents, s, dayLiveIds, statusByAssign, consumedOrphans, 'CHECK_OUT', (inEvt as any)?.assignment_id);
            const template = SHIFT_TEMPLATES[s.shift_code];
            const hours = template ? template.duration_hours : 5;
            // Đơn giá đúng giai đoạn của ngày công (TV trước official_date).
            const dayRate = rateOnDate(emp, s.date, hist, STANDARD_HOURLY_RATES.PROBATION, rate);
            const shiftPay = hours * dayRate.rate;
            if (!inEvt || !hasOut) {
              absentShifts++;
              continue;
            }
            // Cờ trễ có thể mất sau vòng pull Sheet cũ -> tính bù từ giờ check-in so với giờ vào ca.
            const lateMin = inEvt.is_late
              ? Number(inEvt.minutes_deviation) || 0
              : (() => {
                  const st = new Date(s.start_at).getTime();
                  const ct = new Date(inEvt.client_time).getTime();
                  if (!Number.isFinite(st) || !Number.isFinite(ct)) return 0;
                  return Math.max(0, Math.round((ct - st) / 60000));
                })();
            // Ưu tiên mức phạt đã ghi nhận lúc check-in (ràng buộc chặt, không tính lại).
            const storedTier = (inEvt as any).fine_tier;
            const storedAmt = Number((inEvt as any).fine_amount) || 0;
            const useStored = isStoredFineStillValid(storedTier, lateMin);
            const fine = lateFineFor(lateMin, shiftPay);
            const unpaid = useStored ? storedTier === 'FULL_SHIFT' : fine.unpaid;
            const deductAmt = useStored ? (storedTier === 'FULL_SHIFT' ? 0 : storedAmt) : fine.deduction;
            if (unpaid) {
              absentShifts++;
              lateCases.push(`${s.date} trễ ${lateMin}p: phạt 100%`);
              continue;
            }
            empHours += hours;
            standardPay += shiftPay;
            if (dayRate.stage === 'TV') { tvHours += hours; tvPay += shiftPay; }
            else { ctHours += hours; ctPay += shiftPay; }
            if (deductAmt > 0) {
              deduction += deductAmt;
              lateCases.push(`${s.date} trễ ${lateMin}p: phạt ${deductAmt.toLocaleString('vi-VN')}đ`);
            }
          }

          // Hình thức lương theo cấu hình Kế toán: MONTHLY -> không tính tiền theo ca,
          // lương = LBH (cấu hình) + phụ cấp; HOURLY giữ nguyên tính theo ca + phụ cấp.
          const cfgEmp = salaryConfigs[emp.employee_id];
          const monthly = effectivePayMode((emp as any).group, cfgEmp?.pay_mode) === 'MONTHLY';
          const allowance = Math.max(0, Math.floor(Number(cfgEmp?.allowance) || 0));
          const standardPayEff = monthly ? 0 : standardPay;
          // LCB: kế toán nhập tay theo kỳ sẽ ghi đè mặc định lấy từ cấu hình.
          const inp: any = inputs.get(emp.employee_id) || {};
          const hasManualCb = inp.luong_cb !== undefined && inp.luong_cb !== null && inp.luong_cb !== '';
          const luongCB = hasManualCb
            ? Number(inp.luong_cb) || 0
            : (monthly ? Math.max(0, Math.floor(Number(cfgEmp?.base_salary) || 0)) : 0);
          const bonus = 0;
          const netPay = standardPayEff + allowance + luongCB - deduction;

          totalHours += monthly ? 0 : empHours;
          totalAmount += netPay;

          payslipItems.push({
            item_id: `SLIP_${runId}_${emp.employee_id}`,
            run_id: runId,
            employee_id: emp.employee_id,
            employee_code: emp.employee_code,
            full_name: emp.full_name,
            period,
            total_shifts: publishedShifts.length,
            absent_shifts: absentShifts,
            standard_hours: empHours,
            rate_snapshot: monthly ? 0 : rate,
            standard_pay: standardPayEff,
            tv_hours: tvHours,
            tv_pay: monthly ? 0 : tvPay,
            ct_hours: ctHours,
            ct_pay: monthly ? 0 : ctPay,
            allowance,
            bonus,
            deduction,
            luong_cb: luongCB,
            net_pay: netPay,
            bank_name: (emp as any).bank_name || '',
            bank_account: (emp as any).bank_account || '',
            bank_holder: (emp as any).bank_holder || emp.full_name || '',
            status: 'DRAFT',
          });
        }

        const runRecord: Omit<PayrollRun, 'created_at' | 'updated_at' | 'version'> = {
          run_id: runId,
          period,
          branch_scope: branchScope,
          status: 'DRAFT',
          total_employees: employees.length,
          total_hours: totalHours,
          total_amount: totalAmount,
          created_by: creatorId,
        };

        return this.repo.createPayrollRun(runRecord, payslipItems);
      },
    });
  }

  async listRuns() {
    return this.repo.listPayrollRuns();
  }

  // Cache đếm ca trong kỳ (tính chậm — gọi từ workflow-status)
  private wfAttCache = new Map<string, { at: number; shifts: number }>();

  /**
   * Cache kết quả Bảng chấm công Finance (rất nặng: duyệt toàn bộ NV × ca ×
   * sự kiện điểm danh — không cache thì mỗi lần web realtime refresh là server
   * tính lại hàng nghìn truy vấn, làm cả 2 cổng web ì). TTL 45s là đủ "tươi"
   * cho kế toán (thay đổi điểm danh sẽ thấy chậm nhất 45s hoặc bấm Tải lại).
   */
  private finSheetCache = new Map<string, { at: number; data: any }>();
  private finSheetInflight = new Map<string, Promise<any>>();
  private static readonly FIN_SHEET_TTL_MS = 45_000;
  /** Xóa cache bảng công (gọi sau khi ghi dữ liệu lương để lần đọc sau tính mới). */
  invalidateFinanceTimesheetCache(period?: string) {
    if (period) {
      for (const k of this.finSheetCache.keys()) if (k.startsWith(`${period}|`)) this.finSheetCache.delete(k);
    } else {
      this.finSheetCache.clear();
    }
  }

  /**
   * Trạng thái quy trình kế toán của 1 kỳ lương — dùng để khóa/mở khóa tab theo thứ tự.
   * Hoàn toàn dẫn xuất từ dữ liệu (không lưu trạng thái thủ công):
   *   1 Đối soát công → 2 BCC → 3 Tính lương → 4 Payment (bảng lương) → 5 Kỳ lương → 6 Phiếu lương → 7 Thanh toán
   */
  async getWorkflowStatus(period: string) {
    const now = Date.now();
    const cached = this.wfAttCache.get(period);
    let attShifts = cached && now - cached.at < 60_000 ? cached.shifts : -1;
    if (attShifts < 0) {
      attShifts = 0;
      try {
        const { fromDate, toDate } = monthRange(period);
        const employees: any[] = await this.repo.listEmployees({ branch: '*' }).catch(() => []);
        for (const e of employees || []) {
          const s: any[] = await this.repo.getShiftsForEmployee((e as any).employee_id, fromDate, toDate).catch(() => []);
          attShifts += (s || []).filter(x => String(x?.status) === 'PUBLISHED').length;
        }
      } catch { /* giữ 0 */ }
      this.wfAttCache.set(period, { at: now, shifts: attShifts });
    }

    const [formula, inputs, runsAll] = await Promise.all([
      this.repo.getPayrollFormula(period).catch(() => null),
      this.repo.getPayrollInputs(period).catch(() => [] as any[]),
      this.repo.listPayrollRuns().catch(() => [] as any[]),
    ]);
    const runs = (runsAll || []).filter((r: any) => String(r?.period) === period);
    runs.sort((a: any, b: any) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')));
    const latest: any = runs[0] || null;
    const latestStatus = String(latest?.status || '');
    const slips: any[] = latest ? await this.repo.getPayslipsByRunId(latest.run_id).catch(() => []) : [];
    const byEmp = new Map<string, any>();
    for (const s of slips || []) {
      const k = String(s?.employee_id || '');
      const cur = byEmp.get(k);
      if (!cur || String(s?.updated_at || s?.created_at || '') >= String(cur?.updated_at || cur?.created_at || '')) byEmp.set(k, s);
    }
    const uniqueSlips = [...byEmp.values()];
    const hasData = attShifts > 0;
    const inputsCount = (inputs || []).filter((i: any) => i && (i.luong_cb > 0 || i.ot_extra > 0 || i.bonus_extra > 0 || i.ung_luong > 0 || i.tru_kpi > 0 || i.dong_phuc > 0 || (i.note && String(i.note).trim()))).length;
    const calcDone = !!formula || inputsCount > 0 || !!latest;
    const runDone = !!latest;
    const approved = ['APPROVED', 'PUBLISHED', 'PAID'].includes(latestStatus);
    const allSigned = uniqueSlips.length > 0 && uniqueSlips.every(s => ['CONFIRMED', 'PAID'].includes(String(s?.status)));
    const someConfirmed = uniqueSlips.some(s => ['CONFIRMED', 'PAID'].includes(String(s?.status)));
    const allPaid = uniqueSlips.length > 0 && uniqueSlips.every(s => String(s?.status) === 'PAID');
    const runPaid = latestStatus === 'PAID';

    const steps = [
      { id: 'fin-timesheet', order: 1, title: 'Đối soát công & Bảng chấm công', open: true, done: hasData, reason: '', stat: `${attShifts.toLocaleString('vi-VN')} ca đã phát hành` },
      { id: 'fin-bcc', order: 2, title: 'BCC — Bảng công từng ngày', open: hasData, done: hasData, reason: hasData ? '' : 'Chưa có ca chấm công nào được phát hành trong kỳ — chờ Store/HR xếp ca & xác nhận công.', stat: hasData ? `${attShifts.toLocaleString('vi-VN')} ca` : 'Chưa có dữ liệu' },
      { id: 'fin-calculate', order: 3, title: 'Tính lương (công thức & nhập tay)', open: hasData, done: calcDone, reason: hasData ? '' : 'Chưa có dữ liệu chấm công để tính lương.', stat: calcDone ? 'Đã có công thức/dữ liệu nhập' : 'Chưa tính' },
      { id: 'fin-payroll-sheet', order: 4, title: 'Payment — Bảng lương tháng', open: calcDone, done: runDone, reason: calcDone ? '' : 'Hãy lưu công thức hoặc nhập liệu lương (hoặc bấm Tính lương) ở tab Tính lương trước.', stat: runDone ? `Kỳ ${latest?.run_id || ''} (${latestStatus})` : 'Chưa có kỳ lương' },
      { id: 'fin-payroll-periods', order: 5, title: 'Kỳ lương (DRAFT → PAID)', open: runDone, done: approved, reason: runDone ? '' : 'Chưa có kỳ lương — hãy tính lương ở tab Tính lương.', stat: runDone ? `Trạng thái: ${latestStatus}` : 'Chưa có kỳ lương' },
      { id: 'fin-payslips', order: 6, title: 'Phiếu lương (KT ký → GĐ duyệt → NV ký)', open: approved, done: allSigned, reason: approved ? '' : 'Kỳ lương cần được DUYỆT (APPROVED) trước khi ký & phát hành phiếu lương.', stat: uniqueSlips.length ? `${uniqueSlips.filter(s => ['CONFIRMED', 'PAID'].includes(String(s?.status))).length}/${uniqueSlips.length} phiếu NV đã ký` : 'Chưa có phiếu' },
      { id: 'fin-payment', order: 7, title: 'Thanh toán (VietQR — Đã chuyển khoản)', open: someConfirmed || runPaid || latestStatus === 'PUBLISHED', done: allPaid || runPaid, reason: (someConfirmed || runPaid || latestStatus === 'PUBLISHED') ? '' : 'Chờ nhân viên ký phiếu (CONFIRMED) trước khi chuyển khoản.', stat: uniqueSlips.length ? `${uniqueSlips.filter(s => String(s?.status) === 'PAID').length}/${uniqueSlips.length} phiếu đã chuyển` : 'Chưa có phiếu' },
    ];
    return { period, steps, generatedAt: new Date().toISOString() };
  }

  // --- Công thức lương theo file Excel (Finance) ---
  async getFormula(period: string) {
    const saved = await this.repo.getPayrollFormula(period).catch(() => null);
    // otPerSlot là trường legacy (đã bỏ phụ cấp OT) — luôn trả 0 để không
    // nơi nào đọc lại đơn giá suất cũ và vô tình tính phụ cấp.
    return { period, ...DEFAULT_PAYROLL_FORMULA, ...(saved || {}), otPerSlot: 0 };
  }

  async saveFormula(period: string, data: any, actorId: string) {
    const rateTV = Math.max(0, Math.floor(Number(data.rateTV)));
    const rateCT = Math.max(0, Math.floor(Number(data.rateCT)));
    const t1 = Number(data.otThreshold1);
    const t2 = Number(data.otThreshold2);
    if (![rateTV, rateCT].every(Number.isFinite)) throw new Error('INVALID_FORMULA: đơn giá phải là số!');
    if (!Number.isFinite(t1) || !Number.isFinite(t2) || t1 < 0 || t2 <= t1 || t2 > 24) {
      throw new Error('INVALID_FORMULA: ngưỡng tăng ca phải 0 ≤ T1 < T2 ≤ 24!');
    }
    const res = await this.repo.savePayrollFormula({
      period, rateTV, rateCT, otPerSlot: 0, otThreshold1: t1, otThreshold2: t2, updatedBy: actorId,
    });
    this.invalidateFinanceTimesheetCache(period);
    await this.syncFinanceToSheets({ skipSlips: true });
    return res;
  }

  async getInputs(period: string) {
    return this.repo.getPayrollInputs(period).catch(() => []);
  }

  async upsertInput(period: string, data: any, actorId: string) {
    if (!data?.employeeId) throw new Error('MISSING_EMPLOYEE: thiếu nhân viên!');
    const num = (v: any) => Math.max(0, Math.floor(Number(v) || 0));
    const employeeId = String(data.employeeId);
    // LCB: nếu Kế toán để TRỐNG thì NV lương THÁNG tự lấy lương cơ bản từ cấu hình
    // làm mặc định (vẫn ghi đè được bằng số nhập tay). NV theo ca giữ 0.
    const rawCb = data.luong_cb;
    const cbMissing = rawCb === undefined || rawCb === null || String(rawCb).trim() === '';
    let luongCb = cbMissing ? 0 : num(rawCb);
    if (cbMissing && this.salaryConfig) {
      try {
        const emp = await this.repo.getEmployeeById(employeeId);
        const cfg = await this.salaryConfig.getForEmployee(employeeId);
        if (effectivePayMode((emp as any)?.group, cfg?.pay_mode) === 'MONTHLY') {
          luongCb = Math.max(0, Math.floor(Number(cfg?.base_salary) || 0));
        }
      } catch { /* fallback 0 */ }
    }
    const res = await this.repo.upsertPayrollInput({
      period,
      employee_id: employeeId,
      luong_cb: luongCb,
      ot_extra: num(data.ot_extra),
      bonus_extra: num(data.bonus_extra),
      ung_luong: num(data.ung_luong),
      tru_kpi: num(data.tru_kpi),
      dong_phuc: num(data.dong_phuc),
      note: String(data.note || '').slice(0, 500) || undefined,
      updatedBy: actorId,
    });
    await this.syncFinanceToSheets({ skipSlips: true });
    return res;
  }

  /**
   * Tính lương theo công thức Excel cho toàn bộ NV (đã bỏ hoàn toàn phụ cấp OT):
   * TỔNG CỘNG = LCB(tay) + Lương giờ + OT thêm(tay) + Bonus
   * TỔNG LƯƠNG = TỔNG CỘNG − KPI(tay) − phạt trễ/vắng
   * THỰC LÃNH = TỔNG LƯƠNG − Ứng − Đồng phục
   */
  async calculateFormulaPayroll(period: string, branchScope = '*', creatorId: string) {
    const runId = `PAY_${period.replace('-', '_')}_${Date.now()}`;
    return singleWriterQueue.enqueue({
      entityType: 'KY_LUONG',
      entityId: runId,
      actorId: creatorId,
      execute: async () => {
        const formula = await this.getFormula(period);
        const inputsArr = await this.repo.getPayrollInputs(period).catch(() => []);
        const inputs = new Map((inputsArr || []).map((x: any) => [x.employee_id, x]));
        const employees = await this.repo.listEmployees({ branch: branchScope });
        const salaryConfigs: any = await this.salaryConfig?.getAll().catch(() => ({})) || {};
        const { fromDate, toDate } = monthRange(period);

        const payslipItems: Omit<PayslipItem, 'created_at' | 'updated_at'>[] = [];
        let totalHours = 0;
        let totalAmount = 0;

        // Gộp sự kiện điểm danh tuần cũ từ kho LUUTRU (đã archive khỏi realtime) —
        // nếu không, kỳ lương tính sau ngày archive sẽ bỏ sót công tuần cũ.
        let archivedByEmpDay = new Map<string, any[]>();
        try {
          const archived = await (this.repo as any)?.syncService?.getArchivedAttendanceEvents?.(fromDate, toDate) || [];
          for (const e of archived || []) {
            const t = new Date((e as any)?.client_time || '').getTime();
            if (!Number.isFinite(t)) continue;
            const day = new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
            const k = `${(e as any)?.employee_id}|${day}`;
            if (!archivedByEmpDay.has(k)) archivedByEmpDay.set(k, []);
            archivedByEmpDay.get(k)!.push(e);
          }
        } catch { archivedByEmpDay = new Map(); }

        for (const emp of employees) {
          // Đơn giá theo công thức kỳ + giai đoạn đúng của từng ngày công
          // (NV chuyển TV→CT giữa kỳ: ngày trước official_date tính rateTV).
          const hist = await this.repo.getStageHistory(emp.employee_id).catch(() => []);
          const curRate = String((emp as any).employment_status) === 'PROBATION' ? formula.rateTV : formula.rateCT;
          const empShifts = await this.repo.getShiftsForEmployee(emp.employee_id, fromDate, toDate);
          const publishedShifts = empShifts.filter(s => s.status === 'PUBLISHED');
          const eventsByDate = new Map<string, any[]>();
          const eventsOf = async (date: string) => {
            if (!eventsByDate.has(date)) {
              const live = await this.repo.getAttendanceEvents(emp.employee_id, date).catch(() => []);
              const extra = archivedByEmpDay.get(`${emp.employee_id}|${date}`) || [];
              let merged = live;
              if (extra.length > 0) {
                const ids = new Set((live || []).map((e: any) => e.event_id));
                merged = [...(live || [])];
                for (const e of extra) if (!ids.has((e as any).event_id)) merged.push(e);
              }
              eventsByDate.set(date, merged);
            }
            return eventsByDate.get(date)!;
          };
          // Bù chân mồ côi như lưới hiển thị (mọi NV).
          const consumedOrphans = new Set<string>();
          const statusByAssign = new Map((empShifts || []).map((x: any) => [String(x.assignment_id), String(x.status || '')]));
          const dayLiveIdsOf = (dayISO: string) => new Set((empShifts || [])
            .filter((x: any) => String(x.date).slice(0, 10) === String(dayISO).slice(0, 10) && String(x.status) !== 'CANCELLED')
            .map((x: any) => String(x.assignment_id)));
          let absentShifts = 0;
          let empHours = 0;
          let standardPay = 0;
          let tvHours = 0;
          let tvPay = 0;
          let ctHours = 0;
          let ctPay = 0;
          let deduction = 0;
          for (const s of publishedShifts) {
            const dayEvents = await eventsOf(s.date);
            const dayLiveIds = dayLiveIdsOf(s.date);
            let inEvt = dayEvents.find(
              (e: any) => e.type === 'CHECK_IN' && (!e.assignment_id || e.assignment_id === s.assignment_id)
            );
            if (!inEvt) inEvt = orphanLegFor(dayEvents, s, dayLiveIds, statusByAssign, consumedOrphans, 'CHECK_IN');
            let hasOut = dayEvents.some(
              (e: any) => e.type === 'CHECK_OUT' && (!e.assignment_id || e.assignment_id === s.assignment_id)
            );
            if (!hasOut) hasOut = !!orphanLegFor(dayEvents, s, dayLiveIds, statusByAssign, consumedOrphans, 'CHECK_OUT', (inEvt as any)?.assignment_id);
            const template = SHIFT_TEMPLATES[s.shift_code];
            const hours = template ? template.duration_hours : 5;
            // Giai đoạn đúng của ngày công (lịch sử/official_date), giá trị theo công thức kỳ của Finance.
            const dayStage = rateOnDate(emp, s.date, hist, formula.rateTV, formula.rateCT).stage;
            const dayRate = { stage: dayStage, rate: dayStage === 'TV' ? formula.rateTV : formula.rateCT };
            const shiftPay = hours * dayRate.rate;
            if (!inEvt || !hasOut) {
              absentShifts++;
              continue;
            }
            const lateMin = inEvt.is_late
              ? Number(inEvt.minutes_deviation) || 0
              : (() => {
                  const st = new Date(s.start_at).getTime();
                  const ct = new Date(inEvt.client_time).getTime();
                  if (!Number.isFinite(st) || !Number.isFinite(ct)) return 0;
                  return Math.max(0, Math.round((ct - st) / 60000));
                })();
            const storedTier = (inEvt as any).fine_tier;
            const storedAmt = Number((inEvt as any).fine_amount) || 0;
            const useStored = isStoredFineStillValid(storedTier, lateMin);
            const fine = lateFineFor(lateMin, shiftPay);
            const unpaid = useStored ? storedTier === 'FULL_SHIFT' : fine.unpaid;
            const deductAmt = useStored ? (storedTier === 'FULL_SHIFT' ? 0 : storedAmt) : fine.deduction;
            if (unpaid) {
              absentShifts++;
              continue;
            }
            empHours += hours;
            standardPay += shiftPay;
            if (dayRate.stage === 'TV') { tvHours += hours; tvPay += shiftPay; }
            else { ctHours += hours; ctPay += shiftPay; }
            if (deductAmt > 0) deduction += deductAmt;
          }
          // Đã bỏ hoàn toàn phụ cấp OT và phụ cấp HR điều phối — bonus chỉ còn phần nhập tay.
          // Cấu hình Kế toán (LCB/phụ cấp/hình thức): NV lương THÁNG không tính tiền theo ca;
          // LBH tự lấy cấu hình làm mặc định (kế toán nhập tay luong_cb theo kỳ sẽ ghi đè).
          const cfgEmp = salaryConfigs[emp.employee_id];
          const monthly = effectivePayMode((emp as any).group, cfgEmp?.pay_mode) === 'MONTHLY';
          const allowanceCfg = Math.max(0, Math.floor(Number(cfgEmp?.allowance) || 0));
          const standardPayEff = monthly ? 0 : standardPay;
          const inp: any = inputs.get(emp.employee_id) || {};
          const hasManualCb = inp.luong_cb !== undefined && inp.luong_cb !== null && inp.luong_cb !== '';
          const luongCB = hasManualCb
            ? Number(inp.luong_cb) || 0
            : (monthly ? Math.max(0, Math.floor(Number(cfgEmp?.base_salary) || 0)) : 0);
          const otExtra = Number(inp.ot_extra) || 0;
          const bonusExtra = Number(inp.bonus_extra) || 0;
          const ung = Number(inp.ung_luong) || 0;
          const kpi = Number(inp.tru_kpi) || 0;
          const dp = Number(inp.dong_phuc) || 0;
          const bonusTotal = bonusExtra;
          const tongCong = luongCB + allowanceCfg + standardPayEff + otExtra + bonusTotal;
          const tongLuong = tongCong - kpi - deduction;
          const thucLanh = tongLuong - ung - dp;

          totalHours += monthly ? 0 : empHours;
          totalAmount += thucLanh;

          payslipItems.push({
            item_id: `SLIP_${runId}_${emp.employee_id}`,
            run_id: runId,
            employee_id: emp.employee_id,
            employee_code: emp.employee_code,
            full_name: emp.full_name,
            period,
            total_shifts: publishedShifts.length,
            absent_shifts: absentShifts,
            standard_hours: empHours,
            rate_snapshot: curRate,
            standard_pay: standardPayEff,
            tv_hours: tvHours,
            tv_pay: monthly ? 0 : tvPay,
            ct_hours: ctHours,
            ct_pay: monthly ? 0 : ctPay,
            // Phụ cấp theo cấu hình Kế toán (mọi hình thức lương đều cộng).
            allowance: allowanceCfg,
            bonus: bonusTotal,
            deduction,
            net_pay: thucLanh,
            ot_slots: 0,
            phu_cap_ot: 0,
            luong_cb: luongCB,
            ot_extra: otExtra,
            bonus_extra: bonusExtra,
            ung_luong: ung,
            tru_kpi: kpi,
            dong_phuc: dp,
            tong_cong: tongCong,
            tong_luong: tongLuong,
            thuc_lanh: thucLanh,
            bank_name: (emp as any).bank_name || '',
            bank_account: (emp as any).bank_account || '',
            bank_holder: (emp as any).bank_holder || emp.full_name || '',
            status: 'DRAFT',
          });
        }

        const runRecord: Omit<PayrollRun, 'created_at' | 'updated_at' | 'version'> = {
          run_id: runId,
          period,
          branch_scope: branchScope,
          status: 'DRAFT',
          total_employees: employees.length,
          total_hours: totalHours,
          total_amount: totalAmount,
          created_by: creatorId,
        };
        const created = await this.repo.createPayrollRun(runRecord, payslipItems);
        this.notifySlipsChanged('calculate-draft', { runId, period });
        await this.syncFinanceToSheets();
        return created;
      },
    });
  }

  async getRunDetails(runId: string) {
    const cleanId = String(runId || '').trim();
    let run = await this.repo.getPayrollRun(cleanId);
    let slips: any[] = [];
    if (run) {
      slips = await this.repo.getPayslipsByRunId(run.run_id);
    }
    if (!run || !slips || slips.length === 0) {
      const periodData = await this.getPeriodSlips(cleanId).catch(() => null);
      if (periodData && periodData.slips && periodData.slips.length > 0) {
        slips = periodData.slips;
        run = run || periodData.run;
      }
    }
    if (!run && slips && slips.length > 0) {
      const period = slips[0].period || cleanId;
      run = {
        run_id: slips[0].run_id || `RUN_${period}`,
        period,
        branch_scope: 'ALL',
        status: slips.some((s: any) => s.status === 'PAID') ? 'PAID'
          : slips.some((s: any) => s.status === 'PUBLISHED') ? 'PUBLISHED'
          : slips.some((s: any) => s.status === 'APPROVED') ? 'APPROVED'
          : 'DRAFT',
        total_employees: new Set(slips.map((s: any) => s.employee_id)).size,
        total_hours: slips.reduce((sum: number, s: any) => sum + (Number(s.standard_hours) || 0), 0),
        total_amount: slips.reduce((sum: number, s: any) => sum + (Number(s.net_pay || s.thuc_lanh) || 0), 0),
        created_by: 'ADM_001',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
      };
    }
    // Nếu vẫn chưa có và cleanId là dạng YYYY-MM hợp lệ (VD 2026-10, 2026-11), tự động khởi tạo phiếu nháp (ensurePeriodSlips)
    if (!run && /^\d{4}-(0[1-9]|1[0-2])$/.test(cleanId)) {
      const ensured = await this.ensurePeriodSlips(cleanId, '*', 'ADM_001').catch(() => null);
      if (ensured && (ensured.slips || []).length > 0) {
        return ensured;
      }
    }
    if (!run) return null;
    return { run, slips: await this.attachInputNotes(this.latestSlipsPerPeriod(slips)) };
  }

  async reconcileRun(runId: string, actorId: string) {
    return singleWriterQueue.enqueue({
      entityType: 'KY_LUONG',
      entityId: runId,
      actorId,
      execute: async () => {
        const updated = await this.repo.updatePayrollRunStatus(runId, 'RECONCILED', actorId, {
          reconciled_by: actorId,
          reconciled_at: new Date().toISOString(),
        });
        this.notifySlipsChanged('reconcile-run', { runId });
        await this.syncFinanceToSheets();
        return updated;
      },
    });
  }

  async approveRun(runId: string, approverId: string) {
    return singleWriterQueue.enqueue({
      entityType: 'KY_LUONG',
      entityId: runId,
      actorId: approverId,
      execute: async () => {
        let run = await this.repo.getPayrollRun(runId);
        if (!run) {
          const det = await this.getRunDetails(runId).catch(() => null);
          run = det?.run || null;
        }
        if (!run) throw new Error('PAYROLL_RUN_NOT_FOUND');

        // Separation of Duties check (chỉ kiểm tra nếu không phải Admin hệ thống)
        if (run.created_by === approverId && approverId !== 'ADM_001' && approverId !== 'ADMIN') {
          throw new Error(ERROR_CODES.SEPARATION_OF_DUTIES_VIOLATION);
        }

        const updated = await this.repo.updatePayrollRunStatus(runId, 'APPROVED', approverId);
        this.notifySlipsChanged('approve-run', { runId });
        await this.syncFinanceToSheets();
        return updated;
      },
    });
  }

  async publishRun(runId: string, actorId: string) {
    return singleWriterQueue.enqueue({
      entityType: 'KY_LUONG',
      entityId: runId,
      actorId,
      execute: async () => {
        const updated = await this.repo.updatePayrollRunStatus(runId, 'PUBLISHED', actorId);

        // Notify via socket with SAFE payload (no salaries or amounts in payload)
        if (this.io) {
          this.io.emit('payroll.published', {
            runId,
            period: updated.period,
            title: `Phiếu lương kỳ ${updated.period} đã được công bố`,
          });
        }
        this.notifySlipsChanged('publish-run', { runId });
        await this.syncFinanceToSheets();

        return updated;
      },
    });
  }

  async markPaid(runId: string, actorId: string) {
    return singleWriterQueue.enqueue({
      entityType: 'KY_LUONG',
      entityId: runId,
      actorId,
      execute: async () => {
        const updated = await this.repo.updatePayrollRunStatus(runId, 'PAID', actorId);
        this.notifySlipsChanged('mark-paid-run', { runId });
        await this.syncFinanceToSheets();
        return updated;
      },
    });
  }

  async getEmployeePayslips(employeeId: string) {
    const slips = await this.repo.getPayslipsForEmployee(employeeId);
    return this.attachInputNotes(this.latestSlipsPerPeriod(slips));
  }

  /** Mỗi NV chỉ giữ 1 phiếu mới nhất cho mỗi kỳ (tránh phiếu trùng do tính lại
   * tạo run mới nhưng tab KY_LUONG chưa có để lọc theo run). */
  private latestSlipsPerPeriod(slips: any[]) {
    const recency = (s: any) => {
      const t = Date.parse(String(s?.updated_at || s?.created_at || ''));
      if (Number.isFinite(t)) return t;
      const m = String(s?.run_id || '').match(/_(\d{10,})$/);
      return m ? Number(m[1]) : 0;
    };
    const best = new Map<string, any>();
    for (const s of slips || []) {
      const key = `${s?.employee_id || s?.employee_code || ''}|${s?.period || ''}`;
      if (!s?.employee_id && !s?.employee_code) continue;
      const cur = best.get(key);
      if (!cur || recency(s) >= recency(cur)) best.set(key, s);
    }
    return Array.from(best.values());
  }

  /** Nhúng ghi chú nhập tay (DULIEU_LUONG_KY.note) vào từng phiếu — join theo (period, employee_id).
   *  Phiếu lưu ở PHIEU_LUONG không chứa note; note chỉ tồn tại ở DULIEU_LUONG_KY.
   *  Best-effort: lỗi đọc inputs không làm hỏng API trả phiếu. */
  private async attachInputNotes(slips: any[]): Promise<any[]> {
    try {
      const list = slips || [];
      const periods = [...new Set(list.map(s => String(s?.period || '').trim()).filter(p => /^\d{4}-(0[1-9]|1[0-2])$/.test(p)))];
      if (periods.length === 0) return list;
      const noteByKey = new Map<string, string>();
      for (const p of periods) {
        const inputs = await this.repo.getPayrollInputs(p).catch(() => [] as any[]);
        for (const x of (inputs || []) as any[]) {
          const emp = String(x?.employee_id || '').trim();
          const note = String(x?.note || '').trim();
          if (emp && note) noteByKey.set(`${p}:${emp}`, note);
        }
      }
      return list.map(s => ({ ...s, input_note: noteByKey.get(`${s?.period}:${s?.employee_id}`) || '' }));
    } catch {
      return slips || [];
    }
  }

  // --- Quy trình ký 3 bên: DRAFT → KT ký lập → GĐ ký duyệt → KT gửi NV → NV ký (CONFIRMED, KHÓA) → KT chuyển khoản (PAID) ---
  private notifySlipsChanged(action: string, extra: any = {}) {
    if (!this.io) return;
    try {
      this.io.emit('data:updated', { entity: 'payslips', data: { action, ...extra }, timestamp: new Date().toISOString() });
    } catch { /* non-fatal */ }
  }

  /**
   * Ký 1 phiếu:
   * - lap/quanly (Kế toán): chỉ ký khi phiếu còn DRAFT/PUBLISHED (chưa NV xác nhận/chi trả).
   * - nhanvien (chính chủ): chỉ ký khi phiếu đã PUBLISHED -> chuyển CONFIRMED (đủ 3 chữ ký).
   */
  async signSlip(itemId: string, role: PayslipSignerRole, name: string, img: string | undefined, actorId: string) {
    // FIX deadlock hàng đợi đơn: sendNotification cũng enqueue cùng queue —
    // phải gửi SAU khi task ghi commit, không await trong execute.
    let confirmedSlip: any = null;
    const out = await singleWriterQueue.enqueue({
      entityType: 'PHIEU_LUONG',
      entityId: itemId,
      actorId,
      execute: async () => {
        const slip = await this.repo.getPayslipById(itemId);
        if (!slip) throw new Error('PAYSLIP_NOT_FOUND');
        const nm = String(name || '').trim().slice(0, 80);
        if (!nm) throw new Error('MISSING_SIGNER_NAME: thiếu tên người ký!');
        const sig = {
          name: nm,
          at: new Date().toISOString(),
          ...(img ? { img: String(img).slice(0, 45000) } : {}),
          by: actorId,
        };
        let updated;
        if (role === 'nhanvien') {
          if (String(slip.employee_id) !== String(actorId) && String(slip.employee_code) !== String(actorId)) {
            throw new Error(ERROR_CODES.FORBIDDEN);
          }
          if (slip.status !== 'PUBLISHED') throw new Error('SLIP_NOT_PUBLISHED: phiếu chưa được gửi, chưa ký xác nhận được!');
          updated = await this.repo.updatePayslip(itemId, {
            sign_nhanvien: sig as any,
            status: 'CONFIRMED',
            slip_confirmed_at: (sig as any).at,
          });
          // Gửi thông báo đến Kế toán & Admin (sau commit — xem cuối hàm).
          confirmedSlip = slip;
          if (this.io) {
            this.io.emit('payroll.confirmed', {
              itemId,
              period: slip.period,
              employeeId: slip.employee_id,
              employeeCode: slip.employee_code,
              fullName: slip.full_name,
            });
            this.io.emit('system:notification', {
              type: 'SYSTEM',
              origin: 'EMPLOYEE',
              title: `✍️ Nhân viên ${slip.full_name} đã xác nhận phiếu lương!`,
              message: `${slip.full_name} (${slip.employee_code}) đã kiểm tra và ký xác nhận phiếu lương kỳ ${slip.period}. Đã đủ 3 chữ ký, sẵn sàng quét mã QR chuyển khoản.`,
              timestamp: new Date().toISOString(),
            });
          }
        } else {
          if (slip.status === 'CONFIRMED' || slip.status === 'PAID') {
            throw new Error('SLIP_LOCKED: phiếu đã xác nhận/chi trả, không ký lại!');
          }
          if (role === 'giamdoc' && slip.sign_giamdoc) throw new Error('ALREADY_SIGNED: Giám đốc đã ký phiếu này!');
          if (role === 'quanly' && !slip.sign_giamdoc) throw new Error('DIRECTOR_SIGNATURE_REQUIRED: phiếu phải được Giám đốc ký trước!');
          updated = await this.repo.updatePayslip(itemId, {
            [role === 'giamdoc' ? 'sign_giamdoc' : role === 'lap' ? 'sign_lap' : 'sign_quanly']: sig,
          } as any);
        }
        this.notifySlipsChanged('sign', { itemId, role });
        await this.syncFinanceToSheets();
        return updated;
      },
    });
    if (confirmedSlip && this.notificationsService) {
      await this.notificationsService.sendNotification({
        recipientIds: ['ALL'],
        type: 'emp.payslip',
        severity: 'SYSTEM',
        title: `✍️ Nhân viên ${confirmedSlip.full_name} đã xác nhận phiếu lương!`,
        summary: `${confirmedSlip.full_name} (${confirmedSlip.employee_code}) đã kiểm tra và ký xác nhận phiếu lương kỳ ${confirmedSlip.period}. Đã đủ 3 chữ ký, sẵn sàng quét mã QR chuyển khoản.`,
        targetPath: '/fin_payslips',
        actorId,
      }).catch(() => null);
    }
    return out;
  }

  /** Kế toán KÝ LẬP PHIẾU (ký nhanh bằng chữ ký mẫu — chỉ chữ ký Kế toán) */
  async applyBothSignatures(itemId: string, lapName: string, lapImg: string, _qlName: string, _qlImg: string, actorId: string) {
    return singleWriterQueue.enqueue({
      entityType: 'PHIEU_LUONG',
      entityId: itemId,
      actorId,
      execute: async () => {
        const slip = await this.repo.getPayslipById(itemId);
        if (!slip) throw new Error('PAYSLIP_NOT_FOUND');
        if (slip.status === 'CONFIRMED' || slip.status === 'PAID') {
          throw new Error('SLIP_LOCKED: phiếu đã xác nhận/chi trả, không ký lại!');
        }
        let finalLapImg = lapImg;
        let finalLapName = lapName;
        if (!finalLapImg) {
          try {
            const settings: any = await this.repo.getSystemSettings();
            const tmpl = settings?.payroll_signatures;
            if (tmpl?.lap?.img) {
              finalLapImg = tmpl.lap.img;
              finalLapName = finalLapName || tmpl.lap.name;
            }
          } catch {}
        }
        const updates: any = {};
        if (finalLapImg) {
          updates.sign_lap = { name: finalLapName || 'Kế toán viên', img: finalLapImg, at: new Date().toISOString() };
        }
        // Không có ảnh ký nào (client không gửi + server chưa cấu hình mẫu):
        // báo lỗi rõ thay vì lưu rỗng khiến nút ký báo thành công giả.
        if (Object.keys(updates).length === 0) {
          throw new Error('MISSING_SIGNATURE_IMAGES: chưa có ảnh chữ ký mẫu của Kế toán, vui lòng cài đặt chữ ký mẫu trước!');
        }
        const updated = await this.repo.updatePayslip(itemId, updates);
        this.notifySlipsChanged('sign', { itemId });
        await this.syncFinanceToSheets();
        return updated;
      },
    });
  }

  /** Gửi 1 phiếu đến NV: yêu cầu Kế toán đã ký lập + Giám đốc đã ký duyệt, phiếu đang DRAFT. Tự động bù chữ ký Kế toán từ mẫu nếu có. */
  async publishSlip(itemId: string, actorId: string, extraSignatures?: { sign_lap?: any; sign_quanly?: any }) {
    // FIX deadlock hàng đợi đơn: xem signSlip.
    let publishedSlip: any = null;
    const out = await singleWriterQueue.enqueue({
      entityType: 'PHIEU_LUONG',
      entityId: itemId,
      actorId,
      execute: async () => {
        let slip = await this.repo.getPayslipById(itemId);
        if (!slip) throw new Error('PAYSLIP_NOT_FOUND');
        if (slip.status !== 'DRAFT') throw new Error(`SLIP_NOT_DRAFT: phiếu đang ở trạng thái ${slip.status}, không gửi lại!`);

        // Tự động bổ sung chữ ký nếu body gửi lên hoặc hệ thống đã cấu hình chữ ký mẫu
        const updates: any = {};
        if (!(slip as any).sign_lap) {
          if (extraSignatures?.sign_lap?.img) {
            updates.sign_lap = {
              name: extraSignatures.sign_lap.name || 'Kế toán viên',
              img: extraSignatures.sign_lap.img,
              at: extraSignatures.sign_lap.at || new Date().toISOString(),
            };
          }
        }
        // Nếu thiếu chữ ký Kế toán, tự động nạp từ cấu hình chữ ký mẫu (signature-templates)
        if (!updates.sign_lap && !(slip as any).sign_lap) {
          try {
            const settings: any = await this.repo.getSystemSettings();
            const tmpl = settings?.payroll_signatures;
            if (tmpl?.lap?.img) {
              updates.sign_lap = {
                name: tmpl.lap.name || 'Kế toán viên',
                img: tmpl.lap.img,
                at: new Date().toISOString(),
              };
            }
          } catch {}
        }
        // Không tự ký thay Giám đốc — Giám đốc phải ký trên cổng Giám đốc.
        // (Chữ ký quản lý chi nhánh không còn thuộc quy trình phiếu lương 3 bên.)

        if (Object.keys(updates).length > 0) {
          slip = await this.repo.updatePayslip(itemId, updates);
        }

        if (!(slip as any).sign_giamdoc || !(slip as any).sign_lap) {
          throw new Error('MISSING_SIGNATURES: phiếu cần đủ chữ ký Kế toán (lập phiếu) và Giám đốc (ký duyệt) trước khi gửi nhân viên!');
        }
        const updated = await this.repo.updatePayslip(itemId, {
          status: 'PUBLISHED',
          slip_published_at: new Date().toISOString(),
        });
        publishedSlip = slip;
        this.notifySlipsChanged('publish', { itemId });
        await this.syncFinanceToSheets();
        return updated;
      },
    });
    if (publishedSlip && this.notificationsService) {
      await this.notificationsService.sendNotification({
        recipientIds: [publishedSlip.employee_id],
        type: 'emp.payslip',
        severity: 'SYSTEM',
        title: `💰 Phiếu lương kỳ ${publishedSlip.period} đã phát hành!`,
        summary: `Kế toán đã phát hành phiếu lương kỳ ${publishedSlip.period} cho bạn. Vui lòng kiểm tra lại tiền thực lãnh và ký tên xác nhận.`,
        targetPath: '/notifs_salary',
        actorId,
      }).catch(() => null);
    }
    return out;
  }

  /** Gửi hàng loạt 1 lần: toàn bộ phiếu DRAFT đủ 2 ký của kỳ -> PUBLISHED. Tự bù chữ ký mẫu nếu thiếu. */
  async publishAllSlips(runIdOrPeriod: string, actorId: string) {
    // FIX deadlock hàng đợi đơn: xem signSlip.
    let publishAllEmpIds: string[] = [];
    const out = await singleWriterQueue.enqueue({
      entityType: 'KY_LUONG',
      entityId: runIdOrPeriod,
      actorId,
      execute: async () => {
        let slips: any[] = [];
        if (runIdOrPeriod.startsWith('PAY_') || runIdOrPeriod.startsWith('RUN_')) {
          slips = await this.repo.getPayslipsByRunId(runIdOrPeriod);
        }
        if (!slips || slips.length === 0) {
          const allSlips = await this.collectAllSlipsInternal();
          slips = allSlips.filter(s => s.period === runIdOrPeriod || s.run_id === runIdOrPeriod);
        }
        if (!slips || slips.length === 0) throw new Error('PAYROLL_RUN_EMPTY: kỳ chưa có phiếu nào!');
        const published: string[] = [];
        const skipped: { itemId: string; employee: string; reason: string }[] = [];

        // Lấy cấu hình chữ ký mẫu nếu có
        let tmpl: any = null;
        try {
          const settings: any = await this.repo.getSystemSettings();
          tmpl = settings?.payroll_signatures;
        } catch {}

        for (const s of slips) {
          if ((s as any).status !== 'DRAFT') {
            // Phiếu đã gửi/xác nhận/chi trả thì bỏ qua (không tính vào published
            // để số đếm + thông báo không phồng, không spam NV cũ).
            if ((s as any).status !== 'PUBLISHED') skipped.push({ itemId: (s as any).item_id, employee: (s as any).full_name || (s as any).employee_id, reason: `đang ở trạng thái ${(s as any).status}` });
            continue;
          }

          // Tự bù chữ ký Kế toán từ mẫu nếu thiếu (không bao giờ tự ký thay Giám đốc)
          if (!(s as any).sign_lap && tmpl?.lap?.img) {
            const updates: any = { sign_lap: { name: tmpl.lap.name || 'Kế toán viên', img: tmpl.lap.img, at: new Date().toISOString() } };
            await this.repo.updatePayslip((s as any).item_id, updates);
            Object.assign(s, updates);
          }

          if (!(s as any).sign_giamdoc || !(s as any).sign_lap) {
            skipped.push({ itemId: (s as any).item_id, employee: (s as any).full_name || (s as any).employee_id, reason: 'thiếu chữ ký Giám đốc / Kế toán' });
            continue;
          }
          await this.repo.updatePayslip((s as any).item_id, {
            status: 'PUBLISHED',
            slip_published_at: new Date().toISOString(),
          });
          published.push((s as any).item_id);
        }
        if (published.length > 0) {
          const pubSlips = slips.filter(s => published.includes((s as any).item_id));
          publishAllEmpIds = [...new Set(pubSlips.map(s => (s as any).employee_id).filter(Boolean))];
        }
        this.notifySlipsChanged('publish-all', { runId: runIdOrPeriod, count: published.length });
        await this.syncFinanceToSheets();
        return { published, skipped };
      },
    });
    if (this.notificationsService && publishAllEmpIds.length > 0) {
      await this.notificationsService.sendNotification({
        recipientIds: publishAllEmpIds,
        type: 'emp.payslip',
        severity: 'SYSTEM',
        title: `💰 Phiếu lương đã phát hành!`,
        summary: `Kế toán đã phát hành phiếu lương cho bạn. Vui lòng kiểm tra lại tiền thực lãnh và ký tên xác nhận.`,
        targetPath: '/notifs_salary',
        actorId,
      }).catch(() => null);
    }
    return out;
  }

  /** Hoàn phiếu: thu hồi phiếu ĐÃ GỬI NV (chỉ PUBLISHED, chưa NV ký) về DRAFT khi gửi nhầm.
   *  Phiếu CONFIRMED (NV đã ký) bị KHÓA — không hoàn được; PAID là trạng thái cuối.
   *  Phiếu hoàn về xóa chữ ký Kế toán + NV + mốc thời gian để ký/phát hành lại từ đầu;
   *  giữ chữ ký Giám đốc (nội dung đã được duyệt). */
  async returnSlip(itemId: string, actorId: string) {
    // FIX deadlock hàng đợi đơn: xem signSlip.
    let returnedSlip: any = null;
    const out = await singleWriterQueue.enqueue({
      entityType: 'PHIEU_LUONG',
      entityId: itemId,
      actorId,
      execute: async () => {
        const slip = await this.repo.getPayslipById(itemId);
        if (!slip) throw new Error('PAYSLIP_NOT_FOUND');
        if (slip.status !== 'PUBLISHED') throw new Error(`SLIP_NOT_RETURNABLE: phiếu đang ở trạng thái ${slip.status}. Phiếu NV đã ký (CONFIRMED) hoặc đã chuyển khoản (PAID) bị khóa, không hoàn được!`);
        const updated = await this.repo.updatePayslip(itemId, {
          status: 'DRAFT',
          sign_lap: undefined,
          sign_quanly: undefined,
          sign_nhanvien: undefined,
          slip_published_at: undefined,
          slip_confirmed_at: undefined,
          slip_paid_at: undefined,
          slip_paid_by: undefined,
        } as any);
        returnedSlip = slip;
        this.notifySlipsChanged('return', { itemId });
        await this.syncFinanceToSheets();
        return updated;
      },
    });
    if (returnedSlip && this.notificationsService && returnedSlip.employee_id) {
      await this.notificationsService.sendNotification({
        recipientIds: [returnedSlip.employee_id],
        type: 'emp.payslip',
        severity: 'SYSTEM',
        title: `↩️ Phiếu lương kỳ ${returnedSlip.period} đã được thu hồi!`,
        summary: `Kế toán đã thu hồi phiếu lương kỳ ${returnedSlip.period} do gửi nhầm. Phiếu mới sẽ được gửi lại sau, bạn không cần ký phiếu cũ.`,
        targetPath: '/notifs_salary',
        actorId,
      }).catch(() => null);
    }
    return out;
  }

  /** Kế toán xác nhận đã chuyển khoản 1 phiếu: yêu cầu đủ 3 chữ ký + NV đã xác nhận. */
  async markSlipPaid(itemId: string, actorId: string) {
    // FIX deadlock hàng đợi đơn: xem signSlip.
    let paidSlip: any = null;
    const out = await singleWriterQueue.enqueue({
      entityType: 'PHIEU_LUONG',
      entityId: itemId,
      actorId,
      execute: async () => {
        const slip = await this.repo.getPayslipById(itemId);
        if (!slip) throw new Error('PAYSLIP_NOT_FOUND');
        if (slip.status !== 'CONFIRMED') throw new Error('SLIP_NOT_CONFIRMED: nhân viên chưa ký xác nhận, chưa chuyển khoản!');
        if (!(slip as any).sign_lap || !(slip as any).sign_giamdoc || !(slip as any).sign_nhanvien) {
          throw new Error('MISSING_SIGNATURES: phiếu chưa đủ 3 chữ ký (Kế toán — Giám đốc — Nhân viên)!');
        }
        const updated = await this.repo.updatePayslip(itemId, {
          status: 'PAID',
          slip_paid_at: new Date().toISOString(),
          slip_paid_by: actorId,
        });
        paidSlip = slip;
        this.notifySlipsChanged('paid', { itemId });
        await this.syncFinanceToSheets();
        return updated;
      },
    });
    // Đồng bộ PDF phiếu lương (đủ 3 chữ ký) lên Drive — best effort, không chặn nghiệp vụ.
    if (paidSlip && this.payslipDriveService) {
      try {
        const driveRes = await this.payslipDriveService.syncSlipToDrive(itemId);
        (out as any).driveSync = driveRes;
        if (!driveRes?.ok) {
          console.warn('[payroll] Đồng bộ Drive phiếu lương thất bại:', driveRes?.error);
        }
      } catch (err: any) {
        (out as any).driveSync = { ok: false, error: String(err?.message || err).slice(0, 300) };
      }
    }
    if (paidSlip && this.notificationsService) {
      const amt = Number(paidSlip.thuc_lanh ?? paidSlip.net_pay ?? 0).toLocaleString('vi-VN');
      await this.notificationsService.sendNotification({
        recipientIds: [paidSlip.employee_id],
        type: 'emp.payslip',
        severity: 'SYSTEM',
        title: `✅ Đã chi trả lương kỳ ${paidSlip.period}!`,
        summary: `Kế toán đã chuyển khoản ${amt}đ lương kỳ ${paidSlip.period} vào tài khoản ngân hàng của bạn.`,
        targetPath: '/notifs_salary',
        actorId,
      }).catch(() => null);
    }
    return out;
  }

  /** Cập nhật thông tin tài khoản ngân hàng cho 1 phiếu (và đồng bộ vào hồ sơ NV). */
  async updateSlipBank(itemId: string, bankName: string, bankAccount: string, bankHolder: string, actorId: string) {
    return singleWriterQueue.enqueue({
      entityType: 'PHIEU_LUONG',
      entityId: itemId,
      actorId,
      execute: async () => {
        const slip = await this.repo.getPayslipById(itemId);
        if (!slip) throw new Error('PAYSLIP_NOT_FOUND');
        if (slip.status === 'CONFIRMED' || slip.status === 'PAID') {
          throw new Error('SLIP_LOCKED: phiếu đã được nhân viên ký / đã chuyển khoản — bị khóa, không đổi tài khoản thụ hưởng!');
        }
        const bName = String(bankName || '').trim().toUpperCase().slice(0, 30);
        const bAcc = String(bankAccount || '').trim().replace(/\s+/g, '').slice(0, 30);
        const bHolder = String(bankHolder || '').trim().toUpperCase().slice(0, 80);
        const updated = await this.repo.updatePayslip(itemId, {
          bank_name: bName,
          bank_account: bAcc,
          bank_holder: bHolder,
        });
        if (slip.employee_id && (this.repo as any).updateEmployee) {
          // Đồng bộ vào hồ sơ NV (lấy version hiện tại để qua check conflict).
          const emp = await this.repo.getEmployeeById(slip.employee_id).catch(() => null);
          if (emp) {
            await (this.repo as any).updateEmployee(slip.employee_id, {
              bank_name: bName,
              bank_account: bAcc,
              bank_holder: bHolder,
            }, (emp as any).version).catch(() => null);
          }
        }
        this.notifySlipsChanged('bank', { itemId });
        // Hồ sơ NV đổi -> tab Hồ Sơ + tab PAID (đọc bank từ hồ sơ) cập nhật realtime.
        if (this.io && slip.employee_id) {
          this.io.emit('data:updated', { entity: 'employees', data: { action: 'bank-sync', employeeId: slip.employee_id }, timestamp: new Date().toISOString() });
        }
        await this.syncFinanceToSheets();
        return updated;
      },
    });
  }

  /**
   * Bỏ phụ cấp HR điều phối nhường ca (30.000đ) còn sót trên phiếu tạo trước khi
   * bỏ tính năng. Chỉ bỏ trên phiếu CHƯA chi trả/chốt (DRAFT/RECONCILED/APPROVED/
   * PUBLISHED) để không sửa lịch sử đã trả lương. Idempotent: chỉ trừ phần `bonus`
   * vượt `bonus_extra` (bonus nhập tay giữ nguyên), đồng thời trừ đúng khoản đó
   * khỏi các tổng tiền liên quan. Không tạo kỳ/phiếu mới.
   */
  async purgeLegacyDispatchBonus(period?: string) {
    const all = await this.collectAllSlipsInternal();
    const FINAL = new Set(['PAID', 'CONFIRMED']);
    const targets = (all || []).filter(s => {
      if (FINAL.has(String((s as any)?.status || '').toUpperCase())) return false;
      if (period && String((s as any)?.period || '') !== period) return false;
      const bonus = Number((s as any)?.bonus) || 0;
      const extra = Number((s as any)?.bonus_extra) || 0;
      return bonus - extra > 0;
    });
    let updated = 0;
    let totalRemoved = 0;
    for (const s of targets) {
      const bonus = Number((s as any)?.bonus) || 0;
      const extra = Number((s as any)?.bonus_extra) || 0;
      const legacy = bonus - extra;
      const sub = (key: string) => {
        const v = (s as any)?.[key];
        return Number.isFinite(Number(v)) ? Number(v) - legacy : v;
      };
      try {
        await this.repo.updatePayslip((s as any).item_id, {
          bonus: extra,
          tong_cong: sub('tong_cong'),
          tong_luong: sub('tong_luong'),
          thuc_lanh: sub('thuc_lanh'),
          net_pay: sub('net_pay'),
        } as any);
        updated++;
        totalRemoved += legacy;
      } catch { /* phiếu lỗi -> bỏ qua, lần chạy sau xử lý tiếp */ }
    }
    if (updated > 0) {
      this.notifySlipsChanged('purge-legacy-dispatch-bonus', { period: period || '*', updated });
      await this.syncFinanceToSheets();
    }
    return {
      period: period || '*',
      scanned: (all || []).length,
      updated,
      totalRemoved,
    };
  }

  /**
   * Dọn PHIẾU LEGACY: bỏ phụ cấp OT cũ (`phu_cap_ot` / `ot_slots`) còn sót trên phiếu
   * CHƯA chi trả/chốt (DRAFT/RECONCILED/APPROVED/PUBLISHED). Tính lại các tổng tiền
   * từ breakdown hiện có:
   *   TỔNG CỘNG = luong_cb + standard_pay + ot_extra + bonus
   *   TỔNG LƯƠNG = TỔNG CỘNG − tru_kpi − deduction
   *   THỰC LÃNH = TỔNG LƯƠNG − ung_luong − dong_phuc
   * LƯU Ý (2026-11): `allowance` giờ là PHỤ CẤP HỢP LỆ do Kế toán cấu hình — KHÔNG dọn
   * các phiếu chỉ có `allowance`. Chỉ dọn phiếu legacy có dấu hiệu OT cũ
   * (`phu_cap_ot` / `ot_slots` > 0) để tránh xóa phụ cấp mới ở mỗi lần khởi động.
   */
  async purgeLegacyAllowance(period?: string) {
    const all = await this.collectAllSlipsInternal();
    const FINAL = new Set(['PAID', 'CONFIRMED']);
    const targets = (all || []).filter(s => {
      if (FINAL.has(String((s as any)?.status || '').toUpperCase())) return false;
      if (period && String((s as any)?.period || '') !== period) return false;
      // Chỉ phiếu legacy thật sự: còn dấu vết phụ cấp OT cũ.
      return (Number((s as any)?.phu_cap_ot) || 0) > 0 ||
        (Number((s as any)?.ot_slots) || 0) > 0;
    });
    let updated = 0;
    let totalRemoved = 0;
    for (const s of targets) {
      const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
      // allowance và phu_cap_ot từng được ghi cùng 1 giá trị -> chỉ trừ 1 lần.
      const legacyAllowance = Math.max(num((s as any)?.allowance), num((s as any)?.phu_cap_ot));
      const tongCong = num((s as any)?.luong_cb) + num((s as any)?.standard_pay)
        + num((s as any)?.ot_extra) + num((s as any)?.bonus);
      const tongLuong = tongCong - num((s as any)?.tru_kpi) - num((s as any)?.deduction);
      const thucLanh = tongLuong - num((s as any)?.ung_luong) - num((s as any)?.dong_phuc);
      try {
        await this.repo.updatePayslip((s as any).item_id, {
          allowance: 0,
          phu_cap_ot: 0,
          ot_slots: 0,
          tong_cong: tongCong,
          tong_luong: tongLuong,
          thuc_lanh: thucLanh,
          net_pay: thucLanh,
        } as any);
        updated++;
        totalRemoved += legacyAllowance;
      } catch { /* phiếu lỗi -> bỏ qua, lần chạy sau xử lý tiếp */ }
    }
    if (updated > 0) {
      this.notifySlipsChanged('purge-legacy-allowance', { period: period || '*', updated });
      await this.syncFinanceToSheets();
    }
    return {
      period: period || '*',
      scanned: (all || []).length,
      updated,
      totalRemoved,
    };
  }

  private async collectAllSlipsInternal(): Promise<any[]> {
    const out: any[] = [];
    const seen = new Set<string>();
    const fb: any = (this.repo as any).fallbackAdapter || this.repo;
    if (Array.isArray(fb?.payslips)) {
      for (const s of fb.payslips) {
        if (s?.item_id && !seen.has(s.item_id)) {
          seen.add(s.item_id);
          out.push(s);
        }
      }
    }
    const runs = await this.repo.listPayrollRuns().catch(() => []);
    for (const r of runs || []) {
      const slips = await this.repo.getPayslipsByRunId((r as any).run_id).catch(() => []);
      for (const s of slips || []) {
        if ((s as any)?.item_id && !seen.has((s as any).item_id)) {
          seen.add((s as any).item_id);
          out.push(s);
        }
      }
    }
    return out;
  }

  async getPeriodSlips(period: string) {
    const runs = await this.repo.listPayrollRuns().catch(() => []);
    const matching = (runs || []).filter(r => r.period === period);
    let run: any = null;
    let slips: any[] = [];
    if (matching.length > 0) {
      // Lấy kỳ MỚI NHẤT theo created_at (đúng mẫu summarizeOfficialMonth) —
      // lấy phần tử cuối mảng có thể trúng kỳ cũ sau pull Sheets.
      run = matching.reduce((a: any, b: any) =>
        String(b.created_at || '') >= String(a.created_at || '') ? b : a);
      slips = await this.repo.getPayslipsByRunId(run.run_id).catch(() => []);
    }
    if (slips.length === 0) {
      const allSlips = await this.collectAllSlipsInternal();
      slips = allSlips.filter(s => s.period === period);
    }
    // Tab KY_LUONG có thể rỗng sau khi restart (chỉ còn PHIEU_LUONG): nhiều lần
    // tính lại tạo nhiều run, mỗi run 1 bộ phiếu. Chỉ trả phiếu mới nhất/NV/kỳ.
    slips = await this.attachInputNotes(this.latestSlipsPerPeriod(slips));
    return { run, slips };
  }

  async ensurePeriodSlips(period: string, branchScope = '*', creatorId: string) {
    const existing = await this.getPeriodSlips(period);
    if (existing.slips && existing.slips.length > 0) {
      return existing;
    }
    const res: any = await this.calculateFormulaPayroll(period, branchScope, creatorId);
    // FIX phiếu mẫu báo "chưa được tạo trên server": calculateFormulaPayroll đi qua
    // singleWriterQueue nên trả { operationId, result } — bóc result trước khi đọc
    // (createPayrollRun trả { run, items }). Trước đây .run/.slips đều undefined nên
    // ensure luôn trả slips rỗng dù vừa tạo xong.
    const inner = res?.result ?? res;
    const rawSlips = inner.slips || inner.items || inner.payslips || [];
    return { run: inner.run, slips: await this.attachInputNotes(rawSlips) };
  }

  /**
   * Rà soát + cập nhật đầy đủ 1 kỳ lương (VD 2026-10 từ 01/10 đến nay):
   * - NV OFFICIAL có official_date mà thiếu dòng OFFICIAL trong lịch sử giai đoạn
   *   (chuyển tay trên Sheet/sửa ngày sau chuyển) -> bù dòng OFFICIAL đúng mốc
   *   để lương tách TV/CT đúng ngày HR duyệt.
   * - Tính lại lương công thức kỳ + đảm bảo phiếu kỳ, đẩy Sheets + realtime để
   *   2 cổng và mọi tài khoản Finance/Admin/HR/NV thấy cùng 1 số.
   */
  async backfillPeriodStageHistoryAndRecalc(period: string, branchScope = '*', actorId: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('Kỳ lương phải dạng YYYY-MM (VD: 2026-10)!');
    const employees = await this.repo.listEmployees({ branch: branchScope }).catch(() => []);
    let backfilled = 0;
    const backfilledIds: string[] = [];
    for (const emp of employees || []) {
      if (String((emp as any)?.employment_status || '').toUpperCase() !== 'OFFICIAL') continue;
      const off = String((emp as any)?.official_date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(off)) continue;
      const hist = await this.repo.getStageHistory((emp as any).employee_id).catch(() => []);
      const hasOff = (hist || []).some((h: any) =>
        ['OFFICIAL', 'CT'].includes(String((h as any)?.stage || '').toUpperCase()) &&
        String((h as any)?.effective_from || '').slice(0, 10) === off);
      if (hasOff) continue;
      try {
        await this.repo.addStageHistory({
          period_id: uuidv4(),
          employee_id: (emp as any).employee_id,
          stage: 'OFFICIAL',
          effective_from: off,
          rate_per_hour: Number((emp as any)?.current_rate_per_hour) || STANDARD_HOURLY_RATES.OFFICIAL,
          approved_by: actorId,
          note: `Bù rà soát kỳ ${period}: thiếu mốc chính thức ${off}`,
        });
        backfilled++;
        backfilledIds.push(String((emp as any).employee_id));
      } catch { /* NV tiếp theo */ }
    }
    const calcRes: any = await this.calculateFormulaPayroll(period, branchScope, actorId);
    const inner = calcRes?.result ?? calcRes;
    const ensured = await this.ensurePeriodSlips(period, branchScope, actorId).catch(() => null);
    await this.syncFinanceToSheets();
    if (this.io) {
      try {
        this.io.emit('data:updated', { entity: 'payroll', data: { action: 'backfill', period, backfilled }, timestamp: new Date().toISOString() });
        this.io.emit('data:updated', { entity: 'employees', data: { action: 'backfill-stage', period, backfilled }, timestamp: new Date().toISOString() });
      } catch { /* non-fatal */ }
    }
    return {
      period,
      backfilled,
      backfilledIds,
      run: inner?.run || null,
      slips: await this.attachInputNotes(inner?.slips || inner?.items || (ensured as any)?.slips || []),
    };
  }
  // --- Cấu hình VietQR công ty (lưu trong system settings, tự đồng bộ Sheets) ---
  async getBankConfig(): Promise<BankQrConfig | null> {
    const all: any = await (this.repo as any).getSystemSettings?.().catch(() => null);
    const cfg = all?.bankQr;
    if (!cfg || !cfg.bank || !cfg.account) return null;
    return { bank: String(cfg.bank), account: String(cfg.account), holder: String(cfg.holder || '') };
  }

  async saveBankConfig(data: any, actorId: string): Promise<BankQrConfig> {
    const bank = String(data?.bank || '').trim().toUpperCase().slice(0, 20);
    const account = String(data?.account || '').trim().replace(/\s+/g, '').slice(0, 30);
    const holder = String(data?.holder || '').trim().slice(0, 80);
    if (!bank || !account) throw new Error('INVALID_BANK_CONFIG: thiếu mã ngân hàng hoặc số tài khoản!');
    if (!/^[0-9]{6,20}$/.test(account)) throw new Error('INVALID_BANK_CONFIG: số tài khoản phải 6-20 chữ số!');
    const all: any = await (this.repo as any).getSystemSettings?.().catch(() => ({}));
    const cfg: BankQrConfig = { bank, account, holder, updatedBy: actorId, updatedAt: new Date().toISOString() };
    await (this.repo as any).updateSystemSettings?.({ ...(all || {}), bankQr: cfg });
    return cfg;
  }

  /**
   * Tổng hợp tháng cho NV CHÍNH THỨC + THỬ VIỆC (HR Reports, read-only,
   * không tạo kỳ lương):
   *  - Giờ làm = ca PUBLISHED có đủ check-in + check-out (vắng/trễ 100% không tính giờ).
   *  - Lương = phiếu của kỳ lương đã chốt (nếu có) — chưa chốt thì tạm tính theo
   *    công thức draft (lương ca theo đơn giá snapshot từng người - phạt trễ +
   *    phụ cấp điều phối).
   * Trả về tổng giờ/lương (chung + tách từng diện), NV nhiều/ít giờ nhất + chi tiết.
   */
  /**
   * Thu nhập tạm tính realtime cho 1 NV (mục Lương & Thu nhập trong Hồ Sơ):
   * duyệt ca PUBLISHED trong tháng, khớp check-in/out (kể cả kho archive),
   * đơn giá đúng giai đoạn từng ngày (TV trước official_date), phạt trễ theo
   * mức đã ghi nhận (không còn phụ cấp nhường ca). Không tạo kỳ lương.
   */
  async profileIncome(employeeId: string, period?: string) {
    const per = period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period)
      ? period
      : new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 7);
    const { fromDate, toDate } = monthRange(per);
    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const emp: any = await this.repo.getEmployeeById(employeeId).catch(() => null);
    if (!emp) throw new Error('EMPLOYEE_NOT_FOUND');
    const hist = await this.repo.getStageHistory(employeeId).catch(() => []);
    const rateNow = Number(emp.current_rate_per_hour) || 0;
    // Cùng đơn giá công thức kỳ với Bảng Tổng Hợp + Tính lương để NV xem
    // Hồ sơ khớp 100% với Finance (trước đây dùng lương hiện tại nên lệch).
    const formula = await this.getFormula(per).catch(() => ({ ...DEFAULT_PAYROLL_FORMULA, period: per }) as any);
    const fRateTV = Number((formula as any)?.rateTV) || STANDARD_HOURLY_RATES.PROBATION;
    const fRateCT = Number((formula as any)?.rateCT) || rateNow || STANDARD_HOURLY_RATES.OFFICIAL;
    const empShifts = await this.repo.getShiftsForEmployee(employeeId, fromDate, toDate).catch(() => []);
    const published = (empShifts || []).filter((s: any) => s.status === 'PUBLISHED');
    let archivedByEmpDay = new Map<string, any[]>();
    try {
      const archived = await (this.repo as any)?.syncService?.getArchivedAttendanceEvents?.(fromDate, toDate) || [];
      for (const e of archived || []) {
        const t = new Date((e as any)?.client_time || '').getTime();
        if (!Number.isFinite(t)) continue;
        const day = new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
        const k = `${(e as any)?.employee_id}|${day}`;
        if (!archivedByEmpDay.has(k)) archivedByEmpDay.set(k, []);
        archivedByEmpDay.get(k)!.push(e);
      }
    } catch { archivedByEmpDay = new Map(); }
    const eventsByDate = new Map<string, any[]>();
    const eventsOf = async (date: string) => {
      if (!eventsByDate.has(date)) {
        const live = await this.repo.getAttendanceEvents(employeeId, date).catch(() => []);
        const extra = archivedByEmpDay.get(`${employeeId}|${date}`) || [];
        let merged = live;
        if (extra.length > 0) {
          const ids = new Set((live || []).map((e: any) => e.event_id));
          merged = [...(live || [])];
          for (const e of extra) if (!ids.has((e as any).event_id)) merged.push(e);
        }
        eventsByDate.set(date, merged);
      }
      return eventsByDate.get(date)!;
    };
    // Bù chân mồ côi như lưới hiển thị (thu nhập realtime Hồ sơ NV).
    const consumedOrphans = new Set<string>();
    const statusByAssign = new Map((empShifts || []).map((x: any) => [String(x.assignment_id), String(x.status || '')]));
    const dayLiveIdsOf = (dayISO: string) => new Set((empShifts || [])
      .filter((x: any) => String(x.date).slice(0, 10) === String(dayISO).slice(0, 10) && String(x.status) !== 'CANCELLED')
      .map((x: any) => String(x.assignment_id)));
    let shiftsDone = 0;
    let absent = 0;
    let hours = 0;
    let tvHours = 0;
    let tvPay = 0;
    let ctHours = 0;
    let ctPay = 0;
    let gross = 0;
    let fines = 0;
    const lateCases: string[] = [];
    const doneDays = new Set<string>();
    const todayStat = { shifts: 0, done: 0, hours: 0, pay: 0 };
    for (const s of published) {
      const day = String((s as any)?.date || '').slice(0, 10);
      const dayEvents = await eventsOf(day);
      const dayLiveIds = dayLiveIdsOf(day);
      let inEvt = dayEvents.find(
        (e: any) => e.type === 'CHECK_IN' && (!(e as any).assignment_id || (e as any).assignment_id === (s as any).assignment_id)
      );
      if (!inEvt) inEvt = orphanLegFor(dayEvents, s, dayLiveIds, statusByAssign, consumedOrphans, 'CHECK_IN');
      let hasOut = dayEvents.some(
        (e: any) => e.type === 'CHECK_OUT' && (!(e as any).assignment_id || (e as any).assignment_id === (s as any).assignment_id)
      );
      if (!hasOut) hasOut = !!orphanLegFor(dayEvents, s, dayLiveIds, statusByAssign, consumedOrphans, 'CHECK_OUT', (inEvt as any)?.assignment_id);
      const template = (SHIFT_TEMPLATES as any)[(s as any).shift_code];
      const h = template ? Number(template.duration_hours) || 5 : 5;
      const dayStage = rateOnDate(emp, day, hist, fRateTV, fRateCT).stage;
      const dayRate = { stage: dayStage, rate: dayStage === 'TV' ? fRateTV : fRateCT };
      const shiftPay = h * dayRate.rate;
      const isToday = day === today;
      if (isToday) todayStat.shifts++;
      if (!inEvt || !hasOut) {
        absent++;
        continue;
      }
      const lateMin = (inEvt as any).is_late
        ? Number((inEvt as any).minutes_deviation) || 0
        : (() => {
            const st = new Date((s as any).start_at).getTime();
            const ct = new Date((inEvt as any).client_time).getTime();
            if (!Number.isFinite(st) || !Number.isFinite(ct)) return 0;
            return Math.max(0, Math.round((ct - st) / 60000));
          })();
      const storedTier = String((inEvt as any).fine_tier || '');
      const storedAmt = Number((inEvt as any).fine_amount) || 0;
      const useStored = isStoredFineStillValid(storedTier, lateMin);
      const fine = lateFineFor(lateMin, shiftPay);
      const unpaid = useStored ? storedTier === 'FULL_SHIFT' : fine.unpaid;
      if (unpaid) {
        absent++;
        continue;
      }
      const deductAmt = useStored ? (storedTier === 'FULL_SHIFT' ? 0 : storedAmt) : fine.deduction;
      shiftsDone++;
      doneDays.add(day);
      hours += h;
      gross += shiftPay;
      if (dayRate.stage === 'TV') { tvHours += h; tvPay += shiftPay; }
      else { ctHours += h; ctPay += shiftPay; }
      if (deductAmt > 0) {
        fines += deductAmt;
        lateCases.push(`${day} trễ ${lateMin}p: phạt ${deductAmt.toLocaleString('vi-VN')}đ`);
      }
      if (isToday) {
        todayStat.done++;
        todayStat.hours += h;
        todayStat.pay += Math.max(0, shiftPay - deductAmt);
      }
    }
    // Đã bỏ phụ cấp HR điều phối nhường ca — thu nhập chỉ gồm lương ca trừ phạt.
    const bonus = 0;
    return {
      period: per,
      employeeId,
      rateNow,
      officialDate: String((emp as any)?.official_date || '').slice(0, 10) || null,
      stageNow: (emp as any)?.employment_status || null,
      shiftsTotal: published.length,
      shiftsDone,
      absent,
      days: doneDays.size,
      hours: Math.round(hours * 10) / 10,
      tvHours: Math.round(tvHours * 10) / 10,
      tvPay,
      ctHours: Math.round(ctHours * 10) / 10,
      ctPay,
      gross,
      fines,
      bonus,
      net: gross + bonus - fines,
      lateCases,
      today: todayStat,
      calculatedAt: new Date().toISOString(),
    };
  }

  async summarizeOfficialMonth(period: string) {
    const { fromDate, toDate } = monthRange(period);
    const employees = (await this.repo.listEmployees()).filter(
      e => ['OFFICIAL', 'PROBATION'].includes((e as any)?.employment_status)
    );

    // Phiếu kỳ đã chốt (nếu Finance đã tính lương tháng này) -> lương thực tế.
    // FIX HR Reports đứng tiền sau khi tính lại lương: trước đây dùng .find (kỳ
    // CŨ NHẤT của tháng) trong khi Finance dùng kỳ MỚI NHẤT -> tính lại xong báo
    // cáo vẫn hiện số cũ. Nay lấy kỳ mới nhất theo created_at cho khớp Finance.
    let runSlips = new Map<string, any>();
    let runStatus: string | null = null;
    try {
      const runs = await this.repo.listPayrollRuns();
      const matching = (runs || []).filter(r => String((r as any).period) === period);
      const run = matching.length > 0
        ? matching.reduce((a: any, b: any) =>
          String(b.created_at || '') >= String(a.created_at || '') ? b : a)
        : null;
      if (run) {
        runStatus = String((run as any).status || '');
        const slips = await this.repo.getPayslipsByRunId((run as any).run_id);
        runSlips = new Map((slips || []).map((s: any) => [s.employee_id, s]));
      }
    } catch { /* không có kỳ lương thì toàn bộ là tạm tính */ }

    // FIX ca cũ hiện vắng oan: sự kiện điểm danh tuần đã qua bị archive sang kho
    // LUUTRU (xóa khỏi bảng realtime) — Finance đã gộp kho này nhưng HR Reports
    // thì chưa, nên NV có điểm danh vẫn 0h/0đ. Gộp sự kiện archive theo NV+ngày.
    let archivedByEmpDay = new Map<string, any[]>();
    try {
      const archived = await (this.repo as any)?.syncService?.getArchivedAttendanceEvents?.(fromDate, toDate) || [];
      for (const e of archived || []) {
        const t = new Date((e as any)?.client_time || '').getTime();
        if (!Number.isFinite(t)) continue;
        const day = new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
        const k = `${(e as any)?.employee_id}|${day}`;
        if (!archivedByEmpDay.has(k)) archivedByEmpDay.set(k, []);
        archivedByEmpDay.get(k)!.push(e);
      }
    } catch { archivedByEmpDay = new Map(); }

    const rows: any[] = [];
    for (const emp of employees) {
      const empShifts = await this.repo.getShiftsForEmployee(emp.employee_id, fromDate, toDate);
      const published = empShifts.filter(s => s.status === 'PUBLISHED');
      const rate = Number((emp as any).current_rate_per_hour) || 0;
      const hist = await this.repo.getStageHistory(emp.employee_id).catch(() => []);
      let hours = 0;
      let shifts = 0;
      let absentShifts = 0;
      let standardPay = 0;
      let tvHours = 0;
      let tvPay = 0;
      let tvDed = 0;
      let ctHours = 0;
      let ctPay = 0;
      let ctDed = 0;
      let deduction = 0;
      const bonus = 0;
      for (const s of published) {
        const liveEvents = await this.repo.getAttendanceEvents(emp.employee_id, s.date).catch(() => []);
        // Gộp sự kiện kho lưu trữ (tuần cũ đã archive khỏi bảng realtime).
        let dayEvents = liveEvents;
        const extra = archivedByEmpDay.get(`${emp.employee_id}|${s.date}`) || [];
        if (extra.length > 0) {
          const ids = new Set((liveEvents || []).map((e: any) => e.event_id));
          dayEvents = [...(liveEvents || [])];
          for (const e of extra) if (!ids.has((e as any).event_id)) dayEvents.push(e);
        }
        // Khớp ca–phiếu: cứng theo assignment trước, phiếu mồ côi (HR xếp lại
        // lịch đổi mã ca) bù cho ca thiếu — công hồi phục, không tính đúp.
        const dayShifts = (empShifts || []).filter((x: any) => String((x as any)?.date || '').slice(0, 10) === String((s as any)?.date || '').slice(0, 10));
        const linked = linkDayEvents(dayShifts.length > 0 ? dayShifts : [s], dayEvents || []);
        const legs = linked.get(String((s as any)?.assignment_id || '')) || ({} as any);
        const inEvt = (legs as any).CHECK_IN;
        const hasOut = !!(legs as any).CHECK_OUT;
        const template = SHIFT_TEMPLATES[s.shift_code];
        const h = template ? template.duration_hours : 5;
        if (!inEvt || !hasOut) {
          absentShifts++;
          continue;
        }
        const lateMin = inEvt.is_late
          ? Number(inEvt.minutes_deviation) || 0
          : (() => {
              const st = new Date(s.start_at).getTime();
              const ct = new Date(inEvt.client_time).getTime();
              if (!Number.isFinite(st) || !Number.isFinite(ct)) return 0;
              return Math.max(0, Math.round((ct - st) / 60000));
            })();
        const storedTier = (inEvt as any).fine_tier;
        const storedAmt = Number((inEvt as any).fine_amount) || 0;
        const useStored = isStoredFineStillValid(storedTier, lateMin);
        // Đơn giá đúng giai đoạn của ngày công (TV trước official_date).
        const dayRate = rateOnDate(emp, s.date, hist, STANDARD_HOURLY_RATES.PROBATION, rate);
        const shiftPay = h * dayRate.rate;
        const fine = lateFineFor(lateMin, shiftPay);
        const unpaid = useStored ? storedTier === 'FULL_SHIFT' : fine.unpaid;
        if (unpaid) {
          absentShifts++;
          continue;
        }
        const deductAmt = useStored ? (storedTier === 'FULL_SHIFT' ? 0 : storedAmt) : fine.deduction;
        hours += h;
        shifts++;
        standardPay += shiftPay;
        if (dayRate.stage === 'TV') { tvHours += h; tvPay += shiftPay; tvDed += deductAmt; }
        else { ctHours += h; ctPay += shiftPay; ctDed += deductAmt; }
        deduction += deductAmt;
      }
      // Đã bỏ phụ cấp HR điều phối nhường ca — chỉ còn lương ca trừ phạt.
      const liveNet = standardPay - deduction;
      const slip = runSlips.get(emp.employee_id);
      // Chia lương theo giai đoạn làm việc thực tế (TV/CT), không theo
      // trạng thái hiện tại — NV chuyển chính thức giữa kỳ vẫn đủ 2 phần.
      const slipTv = slip ? Number((slip as any).tv_pay) : NaN;
      const slipCt = slip ? Number((slip as any).ct_pay) : NaN;
      const hasSlipSplit = slip && Number.isFinite(slipTv) && Number.isFinite(slipCt);
      const tvSalaryLive = tvPay - tvDed;
      const ctSalaryLive = ctPay - ctDed;
      const tvSalary = hasSlipSplit ? slipTv : (slip ? (String((emp as any).employment_status) === 'PROBATION' ? Number((slip as any).net_pay) || 0 : 0) : tvSalaryLive);
      const ctSalary = hasSlipSplit ? slipCt : (slip ? (String((emp as any).employment_status) === 'PROBATION' ? 0 : Number((slip as any).net_pay) || 0) : ctSalaryLive);
      rows.push({
        employeeId: emp.employee_id,
        employeeCode: (emp as any).employee_code,
        fullName: (emp as any).full_name,
        branchId: (emp as any).default_branch_id,
        group: (emp as any).group,
        stage: (emp as any).employment_status,
        rate,
        shifts,
        absentShifts,
        hours: Math.round(hours * 10) / 10,
        tvHours: Math.round(tvHours * 10) / 10,
        ctHours: Math.round(ctHours * 10) / 10,
        tvSalary,
        ctSalary,
        salary: slip ? Number((slip as any).net_pay) || 0 : liveNet,
        salarySource: slip ? 'run' : 'live',
        deduction,
        bonus,
      });
    }
    rows.sort((a, b) => b.hours - a.hours || String(a.fullName).localeCompare(String(b.fullName)));
    const worked = rows.filter(r => r.hours > 0);
    const sumNum = (key: string) =>
      Math.round(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0) * 10) / 10;
    const totalHours = Math.round(rows.reduce((s, r) => s + r.hours, 0) * 10) / 10;
    const totalSalary = rows.reduce((s, r) => s + r.salary, 0);
    return {
      period,
      officialCount: rows.filter(r => r.stage === 'OFFICIAL').length,
      probationCount: rows.filter(r => r.stage === 'PROBATION').length,
      zeroHourCount: rows.length - worked.length,
      totalHours,
      totalSalary,
      officialHours: sumNum('ctHours'),
      probationHours: sumNum('tvHours'),
      officialSalary: rows.reduce((s, r) => s + (Number(r.ctSalary) || 0), 0),
      probationSalary: rows.reduce((s, r) => s + (Number(r.tvSalary) || 0), 0),
      runStatus,
      top: worked[0] || null,
      bottom: worked[worked.length - 1] || null,
      rows,
    };
  }

  /**
   * Bảng chấm công Finance theo tháng đầy đủ (ngày 1 -> cuối tháng):
   * mỗi nhân viên có tổng ca / đủ / thiếu / vắng / giờ / đơn giá / lương ca
   * (standardPay) / phạt / thưởng / thực nhận + chi tiết từng ca để kế toán
   * tính lương. Đồng bộ cả ca quá khứ lẫn hiện tại, không phụ thuộc tab tuần.
   */
  async getFinanceTimesheet(period: string, branchScope = '*', onlyEmployeeId?: string) {
    const cacheKey = `${period}|${branchScope}|${onlyEmployeeId || ''}`;
    const nowTs = Date.now();
    const hit = this.finSheetCache.get(cacheKey);
    if (hit && nowTs - hit.at < PayrollService.FIN_SHEET_TTL_MS) return hit.data;
    const inflight = this.finSheetInflight.get(cacheKey);
    if (inflight) return inflight;
    const task = this.computeFinanceTimesheet(period, branchScope, onlyEmployeeId)
      .then(data => {
        this.finSheetCache.set(cacheKey, { at: Date.now(), data });
        // Giữ cache nhỏ: chỉ giữ 20 bản ghi gần nhất
        if (this.finSheetCache.size > 20) {
          const oldest = [...this.finSheetCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
          if (oldest) this.finSheetCache.delete(oldest[0]);
        }
        return data;
      })
      .finally(() => { this.finSheetInflight.delete(cacheKey); });
    this.finSheetInflight.set(cacheKey, task);
    return task;
  }

  /** Tính Bảng chấm công Finance (không cache — xem getFinanceTimesheet). */
  private async computeFinanceTimesheet(period: string, branchScope = '*', onlyEmployeeId?: string) {
    const { fromDate, toDate, daysInMonth } = monthRange(period);
    // Cùng đơn giá với Tính lương: Bảng Tổng Hợp phải dùng công thức kỳ
    // (Finance sửa rateTV/rateCT ở tab Tính lương) thay vì lương hiện tại,
    // nếu không 2 bảng + phiếu NV lệch nhau sau mỗi lần sửa công thức/chuyển chính thức.
    const formula = await this.getFormula(period).catch(() => ({ ...DEFAULT_PAYROLL_FORMULA, period }) as any);
    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const all = await this.repo.listEmployees({ branch: branchScope });
    const salaryConfigs: any = await this.salaryConfig?.getAll().catch(() => ({})) || {};
    const employees = (all || []).filter(
      e => (e as any)?.employment_status !== 'TERMINATED' &&
        (!onlyEmployeeId || String((e as any)?.employee_id) === String(onlyEmployeeId))
    );

    // Đọc kho lưu trữ tuần cũ để ca đầu tháng (đã archive) vẫn lên bảng.
    let archived: any[] = [];
    try {
      archived = await (this.repo as any)?.syncService?.getArchivedAttendanceEvents?.(fromDate, toDate, onlyEmployeeId) || [];
    } catch { archived = []; }
    const archivedByAssign = new Map<string, any[]>();
    for (const e of archived || []) {
      const k = String((e as any)?.assignment_id || '');
      if (!k) continue;
      if (!archivedByAssign.has(k)) archivedByAssign.set(k, []);
      archivedByAssign.get(k)!.push(e);
    }
    // Kho theo NV+ngày (giờ VN): để hứng phiếu mồ côi trỏ ca cũ đã mất.
    const archivedByEmpDay = new Map<string, any[]>();
    for (const e of archived || []) {
      const t = new Date((e as any)?.client_time || '').getTime();
      if (!Number.isFinite(t)) continue;
      const day = new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
      const k = `${String((e as any)?.employee_id || '')}|${day}`;
      if (!archivedByEmpDay.has(k)) archivedByEmpDay.set(k, []);
      archivedByEmpDay.get(k)!.push(e);
    }

    const rows: any[] = [];
    for (const emp of employees) {
      const empId = (emp as any).employee_id;
      const empShifts = await this.repo.getShiftsForEmployee(empId, fromDate, toDate).catch(() => []);
      // Hình thức lương: khối Văn Phòng luôn THEO THÁNG — không có lương ca/giờ.
      // Tính sớm để mọi số tiền theo ca của NV lương tháng đều trả về 0.
      const cfgEmp = salaryConfigs[empId];
      const payMode = effectivePayMode((emp as any).group, cfgEmp?.pay_mode);
      const monthly = payMode === 'MONTHLY';
      const monthlyBase = Math.max(0, Math.floor(Number(cfgEmp?.base_salary) || 0));
      const allowance = Math.max(0, Math.floor(Number(cfgEmp?.allowance) || 0));
      const published = (empShifts || []).filter(
        s => (s as any).status === 'PUBLISHED' && String((s as any).date || '').slice(0, 10) >= fromDate && String((s as any).date || '').slice(0, 10) <= toDate
      );
      const rate = Number((emp as any).current_rate_per_hour) || 0;
      const hist = await this.repo.getStageHistory(empId).catch(() => []);
      let full = 0;
      let partial = 0;
      let absent = 0;
      let hours = 0;
      let standardPay = 0;
      let tvHours = 0;
      let tvPay = 0;
      let ctHours = 0;
      let ctPay = 0;
      let deduction = 0;
      const details: any[] = [];
      for (const s of published) {
        const date = String((s as any).date || '').slice(0, 10);
        let dayEvents: any[] = [];
        try {
          dayEvents = await this.repo.getAttendanceEvents(empId, date).catch(() => []);
        } catch { dayEvents = []; }
        // Gộp kho lưu trữ: theo assignment (cứng) + theo NV+ngày (hứng phiếu mồ
        // côi trỏ ca cũ đã mất sau khi HR xếp lại lịch). Khử trùng event_id.
        const seenEv = new Set((dayEvents || []).map((e: any) => String((e as any)?.event_id || '')));
        const pushExtra = (e: any) => {
          const id = String((e as any)?.event_id || '');
          if (id && seenEv.has(id)) return;
          if (id) seenEv.add(id);
          dayEvents.push(e);
        };
        for (const e of archivedByAssign.get(String((s as any).assignment_id)) || []) pushExtra(e);
        for (const e of archivedByEmpDay.get(`${empId}|${date}`) || []) pushExtra(e);
        // Khớp ca–phiếu (cứng trước, mồ côi bù sau — công hồi phục, không đúp).
        const dayShifts = (empShifts || []).filter(
          (x: any) => String((x as any)?.date || '').slice(0, 10) === date
        );
        const linked = linkDayEvents(dayShifts.length > 0 ? dayShifts : [s], dayEvents);
        const legs = linked.get(String((s as any)?.assignment_id || '')) || ({} as any);
        const mine = dayEvents.filter(
          (e: any) => String(e.assignment_id || '') === String((s as any).assignment_id)
        );
        const inEvt = (legs as any).CHECK_IN;
        const hasOut = !!(legs as any).CHECK_OUT;
        const hasAbs = mine.some((e: any) => e.type === 'ABSENT');
        const template = (SHIFT_TEMPLATES as any)[(s as any).shift_code];
        const h = template ? Number(template.duration_hours) || 5 : 5;
        // Giai đoạn đúng của ngày công (TV trước official_date); đơn giá lấy
        // đúng công thức kỳ như calculateFormulaPayroll để Bảng Tổng Hợp,
        // Tính lương và Phiếu NV khớp 100% sau mỗi lần Finance sửa công thức.
        const dayStage = rateOnDate(emp, date, hist, Number((formula as any)?.rateTV) || STANDARD_HOURLY_RATES.PROBATION, Number((formula as any)?.rateCT) || rate).stage;
        const rateVal = dayStage === 'TV'
          ? (Number((formula as any)?.rateTV) || STANDARD_HOURLY_RATES.PROBATION)
          : (Number((formula as any)?.rateCT) || rate || STANDARD_HOURLY_RATES.OFFICIAL);
        const dayRate = { stage: dayStage, rate: rateVal };
        const shiftPay = h * dayRate.rate;
        let status: 'DU' | 'THIEU' | 'VANG' = 'THIEU';
        let lateMin = 0;
        let fineTier = 'NONE';
        let fineAmt = 0;
        if (inEvt && hasOut) {
          lateMin = (inEvt as any).is_late
            ? Number((inEvt as any).minutes_deviation) || 0
            : (() => {
                const st = new Date((s as any).start_at).getTime();
                const ct = new Date((inEvt as any).client_time).getTime();
                if (!Number.isFinite(st) || !Number.isFinite(ct)) return 0;
                return Math.max(0, Math.round((ct - st) / 60000));
              })();
          const storedTier = String((inEvt as any).fine_tier || '');
          const storedAmt = Number((inEvt as any).fine_amount) || 0;
          const useStored = isStoredFineStillValid(storedTier, lateMin);
          const fine = lateFineFor(lateMin, shiftPay);
          const unpaid = useStored ? storedTier === 'FULL_SHIFT' : fine.unpaid;
          if (unpaid) {
            status = 'VANG';
            absent++;
            fineTier = 'FULL_SHIFT';
            fineAmt = shiftPay;
          } else {
            status = 'DU';
            full++;
            hours += h;
            standardPay += shiftPay;
            if (dayRate.stage === 'TV') { tvHours += h; tvPay += shiftPay; }
            else { ctHours += h; ctPay += shiftPay; }
            fineAmt = useStored ? (storedTier === 'FULL_SHIFT' ? 0 : storedAmt) : fine.deduction;
            fineTier = useStored ? storedTier : fine.tier;
            deduction += fineAmt;
          }
        } else if (!inEvt && hasAbs) {
          status = 'VANG';
          absent++;
          fineTier = 'FULL_SHIFT';
          fineAmt = shiftPay;
        } else if (date < today) {
          // Ca quá khứ thiếu 1 lượt: tính thiếu (chờ bổ sung/trừ vắng ở kỳ lương).
          status = 'THIEU';
          partial++;
        } else {
          status = 'THIEU';
          partial++;
        }
        details.push({
          date,
          assignmentId: (s as any).assignment_id,
          shiftCode: (s as any).shift_code,
          branchId: (s as any).branch_id,
          hours: h,
          rate: monthly ? 0 : dayRate.rate,
          stage: dayRate.stage,
          shiftPay: monthly ? 0 : shiftPay,
          status,
          lateMin,
          fineTier,
          fineAmount: fineAmt,
          checkIn: inEvt ? (inEvt as any).client_time : null,
          hasOut,
        });
      }
      details.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      // Thưởng nhường ca HR điều phối đã duyệt trong kỳ.
      const bonus = 0;
      // NV lương THÁNG không có lương theo ca/giờ — thực nhận = LCB + phụ cấp − phạt.
      const netPay = monthly ? (monthlyBase + allowance - deduction) : (standardPay - deduction);
      rows.push({
        employeeId: empId,
        employeeCode: (emp as any).employee_code,
        fullName: (emp as any).full_name,
        branchId: (emp as any).default_branch_id,
        stage: (emp as any).employment_status,
        group: (emp as any).group,
        payMode,
        rate: monthly ? 0 : rate,
        totalShifts: published.length,
        full,
        partial,
        absent,
        hours: Math.round(hours * 10) / 10,
        tvHours: Math.round(tvHours * 10) / 10,
        tvPay: monthly ? 0 : tvPay,
        ctHours: Math.round(ctHours * 10) / 10,
        ctPay: monthly ? 0 : ctPay,
        standardPay: monthly ? 0 : standardPay,
        monthlyBase,
        allowance,
        deduction,
        bonus,
        netPay,
        shifts: details,
      });
    }
    rows.sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || ''), 'vi'));
    const sum = (k: string) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    return {
      period,
      fromDate,
      toDate,
      daysInMonth,
      branchScope,
      formula: {
        rateTV: Number((formula as any)?.rateTV) || STANDARD_HOURLY_RATES.PROBATION,
        rateCT: Number((formula as any)?.rateCT) || STANDARD_HOURLY_RATES.OFFICIAL,
      },
      totals: {
        employees: rows.length,
        totalShifts: sum('totalShifts'),
        full: sum('full'),
        partial: sum('partial'),
        absent: sum('absent'),
        hours: Math.round(sum('hours') * 10) / 10,
        standardPay: sum('standardPay'),
        deduction: sum('deduction'),
        bonus: sum('bonus'),
        netPay: sum('netPay'),
      },
      rows,
    };
  }
}
