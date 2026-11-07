/**
 * RATE ADJUST — Điều chỉnh đơn giá LƯƠNG CA theo TỪNG nhân viên (Cổng Kế toán).
 *
 * - Không ghi đè đơn giá cũ: chỉ THÊM bản ghi lịch sử giai đoạn/đơn giá
 *   (EmployeeStageHistory, stage OFFICIAL/PROBATION) có hiệu lực từ ngày chọn.
 * - Payroll engine (rateOnDate) tự lấy đúng đơn giá theo từng ngày công →
 *   NV đổi đơn giá giữa tháng vẫn tính tách giai đoạn.
 * - "Áp dụng cho tháng cũ": CHỈ tính lại các kỳ mà TOÀN BỘ phiếu đều DRAFT
 *   (hoặc chưa có phiếu). Kỳ đã có phiếu NV ký (CONFIRMED) hoặc đã thanh
 *   toán (PAID) → BỎ QUA tuyệt đối + liệt kê lý do (phiếu đã khóa/ký).
 * - Mọi thay đổi đều ghi audit log + có thể truy vết lịch sử theo từng NV.
 */
import { rateOnDate } from './payroll.service.js';

export interface RateAdjustChange {
  employeeId: string;
  newRate: number;
}
export interface RateAdjustOptions {
  /** Ngày hiệu lực, YYYY-MM-DD */
  effectiveFrom: string;
  applyPast: boolean;
  /** Kỳ hồi tố bắt đầu (YYYY-MM) — mặc định = kỳ hiện tại */
  pastFromPeriod?: string;
  reason: string;
}
export interface RateAdjustDeps {
  repo: any;
  payrollService: any;
  io?: any;
  logger?: (msg: string) => void;
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const currentPeriodVN = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 7);
const periodsBetween = (fromP: string, toP: string): string[] => {
  const out: string[] = [];
  let [y, m] = fromP.split('-').map(Number);
  const [y2, m2] = toP.split('-').map(Number);
  while (y < y2 || (y === y2 && m <= m2)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    if (out.length > 36) break;
  }
  return out;
};
const r0 = (n: number) => Math.round(Number(n) || 0);
const normalizeStage = (s: any): 'OFFICIAL' | 'PROBATION' => {
  const u = String(s || '').toUpperCase();
  return u === 'PROBATION' || u === 'TV' ? 'PROBATION' : 'OFFICIAL';
};

export class RateAdjustService {
  constructor(private readonly deps: RateAdjustDeps) {}

  private get repo() { return this.deps.repo; }
  private get payrollService() { return this.deps.payrollService; }
  private log(msg: string) { try { this.deps.logger?.(msg); } catch { /* noop */ } }

  private async formulaFor(period: string) {
    return this.payrollService.getFormula(period).catch(() => ({ rateTV: 21000, rateCT: 25500 }));
  }

  private rateOf(emp: any, hist: any[], effectiveFrom: string, formula: any): number {
    // Khớp CHÍNH XÁC cách payroll engine chọn đơn giá: theo ngày, ưu tiên hist;
    // fallback = đơn giá CÔNG THỨC kỳ (rateTV/rateCT) — không dùng current_rate_per_hour
    // (engine không đọc trường này, tránh hiển thị khác với tiền lương thực tính).
    return r0(rateOnDate(emp, effectiveFrom, hist, Number(formula?.rateTV) || 21000, Number(formula?.rateCT) || 25500).rate);
  }

  private effectiveFromOrToday(v?: string): string {
    if (v && DAY_RE.test(v)) return v;
    return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  }

  /** Danh sách NV đủ điều kiện (Chính thức; tùy chọn gồm cả thử việc). */
  async listEligible(opts: { period?: string; branchScope?: string; q?: string; includeProbation?: boolean; effectiveFrom?: string }) {
    const period = PERIOD_RE.test(String(opts.period || '')) ? String(opts.period) : currentPeriodVN();
    const branchScope = String(opts.branchScope || '*');
    const effFrom = this.effectiveFromOrToday(opts.effectiveFrom);
    const formula = await this.formulaFor(period);
    const all: any[] = await this.repo.listEmployees({ branch: branchScope }).catch(() => []);
    const q = String(opts.q || '').trim().toLowerCase();
    const wanted = (e: any) => {
      const st = String(e?.employment_status || '').toUpperCase();
      if (st === 'TERMINATED' || st === 'RESIGNED') return false;
      if (!opts.includeProbation && st !== 'OFFICIAL') return false;
      if (opts.includeProbation && !['OFFICIAL', 'PROBATION'].includes(st)) return false;
      return true;
    };
    const rows = [];
    const candidates = all.filter(wanted).filter(e => {
      if (!q) return true;
      const hay = `${String(e?.employee_code || '')} ${String(e?.full_name || '')}`.toLowerCase();
      return hay.includes(q);
    });
    // Tải lịch sử rate SONG SONG (tránh N+1 tuần tự chậm ở Postgres)
    const hists = await Promise.all(candidates.map(e => this.repo.getStageHistory(String(e.employee_id)).catch(() => [])));
    for (let i = 0; i < candidates.length; i++) {
      const e = candidates[i];
      const hist = hists[i] || [];
      const curRate = this.rateOf(e, hist, effFrom, formula);
      rows.push({
        employeeId: String(e.employee_id),
        employeeCode: String(e?.employee_code || ''),
        fullName: String(e?.full_name || ''),
        branchId: String(e?.default_branch_id || ''),
        group: String(e?.group || ''),
        stage: normalizeStage(e?.employment_status),
        currentRate: curRate,
        officialDate: e?.official_date ? String(e.official_date).slice(0, 10) : '',
        historyCount: (hist || []).length,
      });
    }
    rows.sort((a, b) => String(a.branchId).localeCompare(String(b.branchId)) || String(a.fullName).localeCompare(String(b.fullName), 'vi'));
    return { period, effectiveFrom: effFrom, rows };
  }

  /** Lấy slips 1 kỳ có cache theo request — tránh gọi O(N×P) lần getPeriodSlips ở preview/commit. */
  private async slipsForPeriod(period: string, cache: Map<string, any[]>) {
    if (cache.has(period)) return cache.get(period)!;
    let slips: any[] = [];
    try {
      const data: any = await this.payrollService.getPeriodSlips(period);
      slips = Array.isArray(data?.slips) ? data.slips : [];
    } catch { slips = []; }
    cache.set(period, slips);
    return slips;
  }

  /** Kỳ nào được tính lại: kỳ CHƯA có phiếu NV ký/PAID (mọi phiếu đều DRAFT, hoặc chưa có phiếu).
   *  Kỳ đã có ≥1 phiếu CONFIRMED/PAID → BỎ QUA tuyệt đối (không đổi số tiền NV đã ký/đã nhận). */
  private async affectedPeriods(opts: RateAdjustOptions, cache?: Map<string, any[]>) {
    const cur = currentPeriodVN();
    const from = opts.pastFromPeriod && PERIOD_RE.test(opts.pastFromPeriod) ? opts.pastFromPeriod : cur;
    // Kỳ hiện tại LUÔN tính lại (đơn giá mới phải đổi số ngay, kể cả không
    // tick hồi tố); tick hồi tố mới cộng thêm các tháng cũ.
    const periods = opts.applyPast ? periodsBetween(from <= cur ? from : cur, cur) : [cur];
    const out: Array<{ period: string; slips: number; draft: number; confirmed: number; paid: number; action: 'recalc' | 'skip_locked' }> = [];
    for (const p of periods) {
      const slips = await this.slipsForPeriod(p, cache ?? new Map());
      const confirmed = slips.filter(s => String(s?.status || '').toUpperCase() === 'CONFIRMED').length;
      const paid = slips.filter(s => String(s?.status || '').toUpperCase() === 'PAID').length;
      const draft = slips.length - confirmed - paid;
      // Kỳ đã có ≥1 phiếu NV ký/PAID → BỎ QUA toàn kỳ (phiếu đã cam kết, không đổi số tiền).
      const locked = confirmed + paid > 0;
      out.push({ period: p, slips: slips.length, draft, confirmed, paid, action: locked ? 'skip_locked' : 'recalc' });
    }
    return out;
  }

  /** Preview: ai đổi gì, kỳ nào sẽ tính lại, chênh lệch ước tính. */
  async preview(changes: RateAdjustChange[], opts: RateAdjustOptions) {
    if (!DAY_RE.test(String(opts.effectiveFrom || ''))) throw new Error('INVALID_EFFECTIVE_FROM: ngày hiệu lực phải dạng YYYY-MM-DD!');
    if (opts.applyPast && opts.pastFromPeriod && !PERIOD_RE.test(opts.pastFromPeriod)) {
      throw new Error('INVALID_PAST_FROM: kỳ hồi tố phải dạng YYYY-MM!');
    }
    const reason = String(opts.reason || '').trim();
    if (reason.length < 3) throw new Error('MISSING_REASON: bắt buộc nhập lý do điều chỉnh!');
    const effFrom = opts.effectiveFrom;
    const formula = await this.formulaFor(currentPeriodVN());
    const slipsCache = new Map<string, any[]>();
    const periods = await this.affectedPeriods(opts, slipsCache);
    const recalcSet = new Set(periods.filter(p => p.action === 'recalc').map(p => p.period));
    const rows = [];
    let estTotal = 0;
    for (const ch of changes) {
      const newRate = r0(ch.newRate);
      if (newRate < 1000 || newRate > 1_000_000) throw new Error(`INVALID_RATE: đơn giá ${newRate} ngoài ngưỡng cho phép!`);
      const emp = await this.repo.getEmployeeById(ch.employeeId).catch(() => null);
      if (!emp) { rows.push({ employeeId: ch.employeeId, ok: false, error: 'NOT_FOUND' } as any); continue; }
      const hist = await this.repo.getStageHistory(ch.employeeId).catch(() => []);
      const oldRate = this.rateOf(emp, hist, effFrom, formula);
      // Ước tính chênh lệch: Σ giờ trên phiếu (kỳ sẽ tính lại) × delta (dùng cache theo kỳ)
      let estDelta = 0;
      for (const p of recalcSet) {
        const slips = await this.slipsForPeriod(p, slipsCache);
        const slip = slips.find((s: any) => String(s?.employee_id) === String(ch.employeeId)) || null;
        if (!slip) continue;
        const isPro = normalizeStage(emp?.employment_status) === 'PROBATION';
        const hrs = Number(isPro ? (slip?.tv_hours ?? slip?.standard_hours) : (slip?.ct_hours ?? slip?.standard_hours)) || 0;
        estDelta += hrs * (newRate - oldRate);
      }
      rows.push({
        employeeId: String(emp.employee_id),
        employeeCode: String(emp?.employee_code || ''),
        fullName: String(emp?.full_name || ''),
        branchId: String(emp?.default_branch_id || ''),
        stage: normalizeStage(emp?.employment_status),
        oldRate,
        newRate,
        deltaRate: newRate - oldRate,
        estDelta: r0(estDelta),
        ok: true,
      });
      estTotal += estDelta;
    }
    return {
      effectiveFrom: effFrom,
      applyPast: !!opts.applyPast,
      pastFromPeriod: opts.pastFromPeriod || currentPeriodVN(),
      reason,
      rows,
      periods,
      totals: { count: rows.filter(r => r.ok).length, estDelta: r0(estTotal) },
    };
  }

  /**
   * Commit: ghi lịch sử đơn giá + (nếu chọn) tính lại các kỳ đủ điều kiện.
   * FIX timeout: ghi history (nhẹ, ~ms/NV) xong TRẢ NGAY; phần tính lại lương
   * hồi tố (calculateFormulaPayroll quét toàn bộ NV × ca × sự kiện) + đồng bộ
   * Sheets chạy NỀN sau response. Trước đây await 100% trong request → vượt
   * timeout client (60s) & Nginx /api (60s) → abort/retry gây trùng lịch sử.
   */
  async commit(changes: RateAdjustChange[], opts: RateAdjustOptions, actorId: string) {
    const preview = await this.preview(changes, opts); // validate lại toàn bộ
    const valid = preview.rows.filter(r => r.ok);
    if (valid.length === 0) throw new Error('NOTHING_TO_APPLY: không có dòng hợp lệ để áp dụng!');
    const applied: Array<{ employeeId: string; newRate: number }> = [];
    const stamp = new Date().toISOString();
    const todayVn = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    for (const row of valid) {
      const emp = await this.repo.getEmployeeById(row.employeeId).catch(() => null);
      if (!emp) continue;
      const stage = normalizeStage(emp?.employment_status);
      await this.repo.addStageHistory({
        period_id: `RA_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        employee_id: row.employeeId,
        stage,
        effective_from: opts.effectiveFrom,
        rate_per_hour: row.newRate,
        note: `[RATE_ADJUST] ${opts.reason}`.slice(0, 300),
        approved_by: actorId,
      } as any);
      // Đơn giá hiện tại trên HỒ SƠ NV phải đổi theo khi ngày hiệu lực đã tới.
      // Trước đây chỉ ghi lịch sử giai đoạn nên mọi nơi đọc
      // `current_rate_per_hour` (Hồ Sơ HR, cổng NV, NHAN_VIEN_MASTER) vẫn
      // hiển thị đơn giá cũ dù bảng lương đã tính đơn giá mới.
      if (opts.effectiveFrom <= todayVn) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const fresh = await this.repo.getEmployeeById(row.employeeId).catch(() => null);
            if (!fresh) break;
            const histNow = await this.repo.getStageHistory(row.employeeId).catch(() => []);
            const fallback = Number((fresh as any)?.current_rate_per_hour) || row.newRate;
            // Lấy đúng đơn giá áp dụng HÔM NAY (không phải newRate nếu có nhiều
            // lần điều chỉnh chồng nhau với ngày hiệu lực khác nhau).
            const effective = rateOnDate(fresh, todayVn, histNow, fallback, fallback);
            const nextRate = Math.max(0, Math.round(Number(effective?.rate) || 0));
            if (nextRate > 0 && nextRate !== Number((fresh as any)?.current_rate_per_hour)) {
              await this.repo.updateEmployee(
                row.employeeId,
                { current_rate_per_hour: nextRate } as any,
                Number((fresh as any)?.version) || 1
              );
            }
            break;
          } catch (e: any) {
            // VERSION_CONFLICT do pull/ghi đồng thời: đọc lại bản mới và thử lần 2.
            if (attempt === 0 && /VERSION_CONFLICT/.test(String(e?.message || e))) continue;
            this.log(`[rate-adjust] cập nhật hồ sơ ${row.employeeId} lỗi: ${e?.message || e}`);
            break;
          }
        }
      }
      applied.push({ employeeId: row.employeeId, newRate: row.newRate });
    }
    // Đẩy ngay NHAN_VIEN_MASTER để lượt pull kế tiếp không kéo đơn giá cũ trên
    // Sheet về đè hồ sơ (version đã tăng nên pull cũng giữ bộ nhớ, nhưng Sheet
    // phải khớp để HR/đối soát nhìn thấy đúng).
    try {
      const sync = (this.repo as any)?.syncService || (this.repo as any)?.fallbackAdapter?.syncService;
      if (sync && typeof sync.pushEmployeesTab === 'function') {
        await sync.pushEmployeesTab(this.repo);
      }
    } catch (e: any) {
      this.log(`[rate-adjust] đẩy NHAN_VIEN_MASTER lỗi: ${e?.message || e}`);
    }
    // Đồng bộ lương các NV vừa đổi trên toàn hệ thống (cache + Sheets + realtime
    // cả 2 cổng web) — dùng chung helper với cấu hình lương.
    try {
      for (const a of applied) {
        try { this.payrollService.syncEmployeeSalary?.(a.employeeId, { action: 'rate-adjust', actorId }); } catch { /* noop */ }
      }
    } catch { /* noop */ }
    try {
      this.deps.io?.emit?.('data:updated', { entity: 'payroll', data: { action: 'rate-adjust', count: applied.length, applyPast: !!opts.applyPast, at: stamp }, timestamp: stamp });
    } catch { /* noop */ }
    try {
      await this.repo.recordAuditLog?.({
        log_id: `LOG_RATE_${Date.now()}`,
        actor_id: actorId,
        actor_role: 'FINANCE',
        action: 'RATE_ADJUST',
        target_entity: 'NHAN_VIEN_MASTER',
        target_id: applied.map(a => a.employeeId).join(',').slice(0, 500),
        details: `Điều chỉnh đơn giá ${applied.length} NV — hiệu lực ${opts.effectiveFrom}${opts.applyPast ? ` — hồi tố từ ${opts.pastFromPeriod || currentPeriodVN()}` : ''} — Lý do: ${opts.reason}`.slice(0, 1000),
        ip_address: '',
        created_at: stamp,
      });
    } catch { /* audit best-effort */ }

    const recalcPeriods = opts.applyPast
      ? (preview.periods || []).filter(p => p.action === 'recalc').map(p => p.period)
      : [];
    const skippedPeriods = opts.applyPast
      ? (preview.periods || []).filter(p => p.action !== 'recalc').map(p => ({ period: p.period, action: 'skip_locked' }))
      : [];

    // Tính lại NGAY trong request (không chạy nền): nhiệm vụ nền chỉ nằm trong
    // bộ nhớ — restart/deploy là chết, người dùng mãi thấy "đang tính lại" mà số
    // không đổi (đã xảy ra thực tế). Mỗi kỳ <15s, tổng 2 kỳ <60s, nằm trong
    // timeout client (120s) + Nginx (180s) nên await trực tiếp là an toàn.
    const recalcResults: Array<{ period: string; action: string; slips?: number; error?: string }> = [];
    if (recalcPeriods.length > 0) {
      for (const period of recalcPeriods) {
        try {
          const res: any = await this.payrollService.calculateFormulaPayroll(period, '*', actorId);
          const inner = res?.result ?? res;
          try { this.payrollService.invalidateFinanceTimesheetCache?.(period); } catch { /* noop */ }
          recalcResults.push({ period, action: 'recalculated', slips: Number(inner?.run?.total_employees || inner?.slips?.length || 0) || undefined });
          this.log(`[rate-adjust] recalc ${period} OK`);
        } catch (e: any) {
          this.log(`[rate-adjust] recalc ${period} FAILED: ${e?.message || e}`);
          recalcResults.push({ period, action: 'error', error: String(e?.message || e).slice(0, 200) });
        }
      }
      // calculateFormulaPayroll đã tự hẹn đồng bộ Sheets sau mỗi kỳ.
      try {
        this.deps.io?.emit?.('data:updated', {
          entity: 'payroll',
          data: { action: 'rate-adjust-recalc-done', count: applied.length, periods: recalcResults, at: new Date().toISOString() },
          timestamp: new Date().toISOString(),
        });
      } catch { /* noop */ }
    } else if (!opts.applyPast) {
      // Không hồi tố: không cần tính lại; chỉ đẩy Sheets nền (không chặn).
      try {
        if (typeof this.payrollService.scheduleFinanceToSheetsSync === 'function') {
          this.payrollService.scheduleFinanceToSheetsSync(5_000);
        } else {
          void this.payrollService.syncFinanceToSheets({ skipSlips: false }).catch(() => null);
        }
      } catch { /* noop */ }
    }

    this.log(`[rate-adjust] ${actorId} applied=${applied.length} applyPast=${!!opts.applyPast} recalcNow=${recalcResults.length}`);
    return {
      applied,
      skipped: preview.rows.filter(r => !r.ok),
      periods: [
        ...recalcResults,
        ...skippedPeriods,
      ] as Array<{ period: string; action: string }>,
      recalc: recalcResults.length > 0 ? 'now' : 'none',
      appliedAt: stamp,
    } as any;
  }

  /** Lịch sử điều chỉnh đơn giá (lọc theo ghi chú [RATE_ADJUST]). */
  async listHistory(employeeId?: string, limit = 300) {
    const lim = Math.min(Math.max(Number(limit) || 300, 1), 1000);
    const out: any[] = [];
    if (employeeId) {
      const hist: any[] = await this.repo.getStageHistory(String(employeeId)).catch(() => []);
      const emp = await this.repo.getEmployeeById(String(employeeId)).catch(() => null);
      for (const h of hist) {
        if (!String(h?.note || '').includes('[RATE_ADJUST]')) continue;
        out.push({ ...h, full_name: emp?.full_name, employee_code: emp?.employee_code });
      }
    } else {
      const all: any[] = await this.repo.listEmployees({ branch: '*' }).catch(() => []);
      for (const e of all) {
        const hist: any[] = await this.repo.getStageHistory(String(e.employee_id)).catch(() => []);
        for (const h of hist) {
          if (!String(h?.note || '').includes('[RATE_ADJUST]')) continue;
          out.push({ ...h, full_name: e?.full_name, employee_code: e?.employee_code, branchId: e?.default_branch_id });
        }
        if (out.length > lim * 2) break;
      }
    }
    // Luôn trả bản MỚI NHẤT trước rồi mới cắt limit — trước đây lọc theo 1 NV
    // trả N dòng ĐẦU trong bộ nhớ nên bảng lịch sử không thấy lần điều chỉnh
    // vừa thực hiện (tưởng như "lưu không ăn").
    out.sort((a, b) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')));
    return out.slice(0, lim);
  }
}

export const RATE_ADJUST_NOTE_TAG = '[RATE_ADJUST]';
