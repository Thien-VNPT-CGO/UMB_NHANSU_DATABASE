/**
 * TỰ ĐỘNG XOÁ ỨNG VIÊN QUÁ HẠN CHỜ XẾP LỊCH PHỎNG VẤN
 * =====================================================
 * Yêu cầu nghiệp vụ: ứng viên đăng ký qua Google Form quá N ngày (mặc định 20)
 * mà HR CHƯA gửi lịch phỏng vấn thì tự động xoá khỏi hệ thống + Google Sheet.
 *
 * Vì sao cần tombstone?
 * - Nguồn sự thật của danh sách ứng viên là Spreadsheet FORM GỐC
 *   (CANDIDATE_SPREADSHEET_ID / tab FROM_NHAN_VIEN). Nếu chỉ xoá trong bộ nhớ +
 *   master Sheet, lượt pull nền kế tiếp (~10 giây) sẽ đọc lại dòng form cũ và
 *   hồi sinh ứng viên.
 * - Tombstone lưu theo khoá nhận diện bền vững (SĐT + họ tên + thời gian gửi)
 *   trong CAU_HINH_HE_THONG. Pull form sẽ BỎ QUA đúng hồ sơ đã xoá, kể cả sau
 *   khi restart container.
 *
 * An toàn:
 * - Chỉ xoá hồ sơ còn ở trạng thái NEW (chưa xử lý) và KHÔNG có bất kỳ dấu vết
 *   nào của lịch PV/Zalo/điểm/chăm sóc. Thiếu created_at hợp lệ -> không xoá.
 * - Giới hạn số hồ sơ xoá mỗi lượt để không đốt quota ghi Google Sheets.
 */

import { canonicalPhone, normSheetDateTime } from './employees.service.js';

export const CANDIDATE_AUTO_DELETE_DAYS = 20;
export const CANDIDATE_AUTO_DELETE_SETTING_KEY = 'candidateAutoDeleteTombstones';
export const CANDIDATE_AUTO_DELETE_MAX_PER_RUN = 25;
/** Giữ tombstone dài hạn (dòng form gốc vẫn còn), chỉ cắt bớt khi quá lớn. */
const CANDIDATE_TOMBSTONE_MAX_ENTRIES = 5000;

export interface CandidateCleanupTombstone {
  key: string;
  submission_id?: string;
  full_name?: string;
  phone?: string;
  created_at?: string;
  deleted_at: string;
  reason: string;
}

export interface CandidateCleanupTombstoneStore {
  updated_at: string;
  entries: Record<string, CandidateCleanupTombstone>;
}

const hasValue = (v: unknown): boolean => v !== undefined && v !== null && String(v).trim() !== '';

/** Các cột chứng minh HR đã chăm sóc/lên lịch/chấm điểm hồ sơ — có 1 cột là
 *  KHÔNG được tự xoá, kể cả khi trạng thái còn NEW do dữ liệu cũ.
 *
 *  LƯU Ý: KHÔNG đưa `zalo_invite_note` / `zalo_invite_error` vào đây. Cột
 *  "Zalo Thư Mời" trên Google Form thực tế chứa SỐ ĐIỆN THOẠI (hoặc câu trả lời
 *  thô), nên `parseZaloInviteCell` biến nó thành `zalo_invite_note` cho gần như
 *  mọi hồ sơ. Nếu chặn theo ghi chú này thì tính năng tự xoá không bao giờ chạy
 *  (đã kiểm chứng trên production: 143 hồ sơ quá hạn NEW bị chặn oan).
 *  Chỉ chặn khi HR THỰC SỰ đã gửi Zalo: có `zalo_invite_status` hoặc `zalo_invite_at`. */
const SCHEDULE_OR_CARE_FIELDS = [
  'interview_date',
  'interview_time_slot',
  'interviewer_id',
  'interview_score',
  'interview_score_detail',
  'interview_rubric',
  'interview_notes',
  'interview_proposed_date',
  'interview_proposed_time_slot',
  'interview_proposed_note',
  'interview_decline_reason',
  'zalo_invite_status',
  'zalo_invite_at',
  'zalo_uid',
  'vip_at',
  'vip_by',
  'blacklist_reason',
] as const;

/**
 * Chuẩn hoá thời điểm đăng ký về ms. Hỗ trợ:
 * - ISO / serial Google Sheets / 'dd/MM/yyyy HH:mm:ss' (giờ VN) qua normSheetDateTime.
 * - Chuỗi lạ: thử Date.parse lần cuối.
 * Trả null nếu không xác định được (KHÔNG xoá hồ sơ thiếu ngày).
 */
export function parseCandidateRegisteredAtMs(raw: unknown): number | null {
  const iso = normSheetDateTime(raw);
  if (iso) {
    const t = Date.parse(iso);
    if (Number.isFinite(t)) return t;
  }
  const fallback = Date.parse(String(raw ?? '').trim());
  return Number.isFinite(fallback) ? fallback : null;
}

/** Khoá nhận diện bền vững của hồ sơ ứng viên (khớp giữa bộ nhớ và dòng form). */
export function candidateCleanupKey(c: any): string {
  const phone = canonicalPhone(String(c?.phone_normalized || c?.phone || ''));
  const name = String(c?.full_name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const createdRaw = String(c?.created_at ?? '').trim();
  // Chuẩn hoá thời gian để '01/11/2026 10:00:00' và ISO tương ứng cho cùng khoá.
  const created = createdRaw ? (normSheetDateTime(createdRaw) || createdRaw) : '';
  return `${phone}|${name}|${created}`;
}

/** Hồ sơ đủ điều kiện tự xoá? Chỉ NEW + không có lịch/chăm sóc + đủ tuổi. */
export function isCandidateEligibleForAutoDelete(
  c: any,
  nowMs: number = Date.now(),
  days: number = CANDIDATE_AUTO_DELETE_DAYS,
): boolean {
  const status = String(c?.status ?? '').trim().toUpperCase();
  // Chỉ hồ sơ chưa xử lý. NEED_INFO/INVITED/CONFIRMED/REJECTED... giữ nguyên.
  if (status && status !== 'NEW') return false;
  // HR đã đánh dấu ưu tiên -> không tự xoá.
  if (c?.vip === true) return false;
  if (SCHEDULE_OR_CARE_FIELDS.some(f => hasValue(c?.[f]))) return false;

  const createdMs = parseCandidateRegisteredAtMs(c?.created_at);
  if (createdMs === null) return false;
  const safeDays = Number.isFinite(days) && days > 0 ? days : CANDIDATE_AUTO_DELETE_DAYS;
  const ageMs = nowMs - createdMs;
  return ageMs >= safeDays * 86_400_000;
}

export function getCandidateCleanupTombstones(settings: any): CandidateCleanupTombstoneStore {
  const raw = settings?.[CANDIDATE_AUTO_DELETE_SETTING_KEY];
  const entries = raw && typeof raw === 'object' && raw.entries && typeof raw.entries === 'object'
    ? raw.entries
    : {};
  return {
    updated_at: String(raw?.updated_at || ''),
    entries: { ...(entries as Record<string, CandidateCleanupTombstone>) },
  };
}

export function isCandidateTombstoned(store: CandidateCleanupTombstoneStore, key: string): boolean {
  return !!key && !!store?.entries?.[key];
}

function pruneTombstones(store: CandidateCleanupTombstoneStore): void {
  const keys = Object.keys(store.entries);
  if (keys.length <= CANDIDATE_TOMBSTONE_MAX_ENTRIES) return;
  keys
    .sort((a, b) => {
      const ta = Date.parse(String(store.entries[a]?.deleted_at || '')) || 0;
      const tb = Date.parse(String(store.entries[b]?.deleted_at || '')) || 0;
      return ta - tb;
    })
    .slice(0, keys.length - CANDIDATE_TOMBSTONE_MAX_ENTRIES)
    .forEach(k => { delete store.entries[k]; });
}

export interface CandidateCleanupOptions {
  now?: number;
  days?: number;
  maxPerRun?: number;
  dryRun?: boolean;
}

export interface CandidateCleanupResult {
  checked: number;
  eligible: number;
  deletedIds: string[];
  failedIds: string[];
  deleted: Array<{ id: string; name: string; created_at?: string }>;
}

/**
 * Một lượt quét tự động. Gọi từ server theo interval; trả về danh sách đã xoá
 * để server bắn realtime `data:updated(entity='candidates')`.
 */
export async function candidateCleanupTick(
  adapter: any,
  opts: CandidateCleanupOptions = {},
): Promise<CandidateCleanupResult> {
  const now = Number.isFinite(opts.now) ? Number(opts.now) : Date.now();
  const envDays = Number(process.env.CANDIDATE_AUTO_DELETE_DAYS);
  const days = Number.isFinite(opts.days as number)
    ? Number(opts.days)
    : (Number.isFinite(envDays) && envDays > 0 ? envDays : CANDIDATE_AUTO_DELETE_DAYS);
  const envMax = Number(process.env.CANDIDATE_AUTO_DELETE_MAX_PER_RUN);
  const maxPerRun = Number.isFinite(opts.maxPerRun as number)
    ? Math.max(1, Number(opts.maxPerRun))
    : (Number.isFinite(envMax) && envMax > 0 ? Math.min(envMax, 100) : CANDIDATE_AUTO_DELETE_MAX_PER_RUN);

  const candidates = await adapter.listCandidates();
  const list = Array.isArray(candidates) ? candidates : [];
  const eligible = list
    .filter((c: any) => isCandidateEligibleForAutoDelete(c, now, days))
    // Xoá hồ sơ cũ nhất trước (giữ đúng thứ tự chờ).
    .sort((a: any, b: any) => {
      const ta = parseCandidateRegisteredAtMs(a.created_at) ?? 0;
      const tb = parseCandidateRegisteredAtMs(b.created_at) ?? 0;
      return ta - tb;
    })
    .slice(0, maxPerRun);

  const result: CandidateCleanupResult = {
    checked: list.length,
    eligible: eligible.length,
    deletedIds: [],
    failedIds: [],
    deleted: [],
  };
  if (eligible.length === 0 || opts.dryRun) return result;

  const syncSvc = adapter?.syncService;
  const keysOf = (c: any) => candidateCleanupKey(c);
  // Đánh dấu "đang xoá" NGAY trong bộ nhớ sync để pull nền không hồi sinh
  // trong khoảng thời gian giữa xoá và ghi tombstone bền vững.
  try { syncSvc?.markCandidateDeleted?.(eligible.map(keysOf)); } catch { /* best-effort */ }

  const ids = eligible.map((c: any) => String(c.submission_id)).filter(Boolean);
  let deletedIds: string[] = [];
  let failedIds: string[] = [];

  try {
    if (typeof adapter.deleteCandidatesBatch === 'function') {
      const r = await adapter.deleteCandidatesBatch(ids);
      deletedIds = Array.isArray(r?.deleted) ? r.deleted.map(String) : [];
      failedIds = Array.isArray(r?.failed) ? r.failed.map(String) : [];
      // Adapter cũ/không trả chi tiết -> coi mọi id không báo lỗi là đã xoá.
      if (deletedIds.length === 0 && failedIds.length === 0) deletedIds = ids.slice();
    } else {
      for (const id of ids) {
        try {
          const ok = await adapter.deleteCandidate(id);
          (ok ? deletedIds : failedIds).push(id);
        } catch (err: any) {
          console.warn(`[candidate-cleanup] Xoá ${id} thất bại:`, err?.message || err);
          failedIds.push(id);
        }
      }
    }
  } catch (err: any) {
    console.warn('[candidate-cleanup] Lô xoá thất bại:', err?.message || err);
    failedIds = ids.slice();
    deletedIds = [];
  }

  const deletedSet = new Set(deletedIds);
  const success = eligible.filter((c: any) => deletedSet.has(String(c.submission_id)));
  const failed = eligible.filter((c: any) => !deletedSet.has(String(c.submission_id)));

  // Hoàn tác đánh dấu cho hồ sơ xoá lỗi để không che hồ sơ còn sống.
  try { syncSvc?.unmarkCandidateDeleted?.(failed.map(keysOf)); } catch { /* best-effort */ }

  result.eligible = eligible.length;
  result.deletedIds = sortedUnique(deletedIds);
  result.failedIds = sortedUnique(failedIds);
  result.deleted = success.map((c: any) => ({
    id: String(c.submission_id),
    name: String(c.full_name || c.submission_id),
    created_at: c.created_at ? String(c.created_at) : undefined,
  }));

  if (success.length > 0) {
    const nowIso = new Date(now).toISOString();
    // 1) Ghi tombstone bền vững (sống qua restart + chặn pull form hồi sinh).
    try {
      const settings = await adapter.getSystemSettings().catch(() => ({}));
      const store = getCandidateCleanupTombstones(settings);
      for (const c of success) {
        const key = keysOf(c);
        if (!key) continue;
        store.entries[key] = {
          key,
          submission_id: String(c.submission_id || ''),
          full_name: String(c.full_name || ''),
          phone: String(c.phone_normalized || c.phone || ''),
          created_at: c.created_at ? String(c.created_at) : '',
          deleted_at: nowIso,
          reason: `Quá ${days} ngày chưa gửi lịch phỏng vấn`,
        };
      }
      store.updated_at = nowIso;
      pruneTombstones(store);
      await adapter.updateSystemSettings({ [CANDIDATE_AUTO_DELETE_SETTING_KEY]: store });
      try { await adapter.pushSystemSettingsNow?.(); } catch { /* nền sẽ đẩy lại */ }
    } catch (err: any) {
      // Không chặn xoá: tombstone in-memory vẫn bảo vệ phiên hiện tại; lần quét
      // sau sẽ ghi lại (hồ sơ đã biến mất nên không còn eligible để ghi hộ).
      console.warn('[candidate-cleanup] Không ghi được tombstone:', err?.message || err);
    }

    // 2) Audit log MỘT dòng cho cả lô (tránh 25 lượt ghi Sheet làm cháy quota).
    try {
      const names = success
        .map((c: any) => `${c.full_name || c.submission_id} (${c.submission_id})`)
        .join(', ')
        .slice(0, 1500);
      await adapter.recordAuditLog({
        actor_id: 'SYSTEM',
        actor_role: 'SYSTEM',
        action: 'CANDIDATE_AUTO_DELETED',
        target_entity: 'UNG_VIEN',
        target_id: success.map((c: any) => String(c.submission_id || '')).filter(Boolean).join(',').slice(0, 500),
        details: `Tự động xoá ${success.length} ứng viên quá ${days} ngày chưa gửi lịch phỏng vấn: ${names}`,
      } as any).catch(() => null);
    } catch { /* audit không được chặn xoá */ }

    // 3) Chống race: nếu pull nền chen ngang vừa dựng lại hồ sơ vừa xoá, xoá lại
    //    lần nữa + đẩy master để Sheet chắc chắn không còn dòng đó.
    try {
      const keys = new Set(success.map(keysOf));
      const after = await adapter.listCandidates().catch(() => []);
      const resurrected = (Array.isArray(after) ? after : [])
        .filter((c: any) => keys.has(keysOf(c)))
        .map((c: any) => String(c.submission_id));
      if (resurrected.length > 0) {
        if (typeof adapter.deleteCandidatesBatch === 'function') {
          await adapter.deleteCandidatesBatch(resurrected).catch(() => null);
        } else {
          for (const id of resurrected) await adapter.deleteCandidate(id).catch(() => null);
        }
        await adapter.pushCandidatesNow?.().catch(() => null);
        console.warn(`[candidate-cleanup] Đã xoá lại ${resurrected.length} hồ sơ bị pull hồi sinh.`);
      }
    } catch { /* tick sau xử lý tiếp */ }
  }

  return result;
}

function sortedUnique(ids: string[]): string[] {
  return Array.from(new Set(ids.map(String).filter(Boolean))).sort();
}
