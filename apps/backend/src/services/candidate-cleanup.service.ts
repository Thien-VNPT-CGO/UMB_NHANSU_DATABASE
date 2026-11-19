/**
 * TỰ ĐỘNG ẨN ỨNG VIÊN QUÁ HẠN CHỜ XẾP LỊCH PHỎNG VẤN
 * =====================================================
 * Yêu cầu nghiệp vụ: ứng viên đăng ký qua Google Form quá N ngày (mặc định 20)
 * mà HR CHƯA đặt lịch phỏng vấn thì tự động ẩn khỏi hệ thống. Dòng dữ liệu trên
 * Google Sheet (form gốc + master) PHẢI GIỮ NGUYÊN, không xoá/không ghi đè.
 *
 * Cách làm:
 * - Gắn cờ `auto_hidden_at` cho hồ sơ trong bộ nhớ/PostgreSQL. API danh sách
 *   ứng viên lọc bỏ hồ sơ đã gắn cờ nên HR không còn thấy trên tab.
 * - KHÔNG gọi deleteCandidate / pushCandidatesTab: mọi thao tác ghi Google Sheet
 *   đều bị bỏ qua, nhờ vậy Sheet giữ nguyên lịch sử ứng viên.
 *
 * Vì sao cần tombstone?
 * - Nguồn sự thật của danh sách ứng viên là Spreadsheet FORM GỐC
 *   (CANDIDATE_SPREADSHEET_ID / tab FROM_NHAN_VIEN). Pull nền (~10 giây) đọc lại
 *   dòng form cũ; nếu không có tombstone, hồ sơ vừa ẩn sẽ xuất hiện trở lại.
 * - Tombstone lưu theo khoá nhận diện bền vững (SĐT + họ tên + thời gian gửi)
 *   trong CAU_HINH_HE_THONG. Pull form sẽ GẮN LẠI cờ ẩn cho đúng hồ sơ đó, kể cả
 *   sau khi restart container.
 *
 * An toàn:
 * - Hồ sơ đã được HR đặt lịch PV (có ngày/giờ/điểm/chấm/đề xuất lịch) -> giữ.
 * - VIP hoặc danh sách đen -> giữ (dữ liệu vận hành quan trọng).
 * - Thiếu created_at hợp lệ -> không ẩn.
 * - Giới hạn số hồ sơ xử lý mỗi lượt để không ghi CAU_HINH_HE_THONG quá lớn.
 */

import { canonicalPhone, normSheetDateTime } from './employees.service.js';

export const CANDIDATE_AUTO_DELETE_DAYS = 20;
export const CANDIDATE_AUTO_DELETE_SETTING_KEY = 'candidateAutoDeleteTombstones';
export const CANDIDATE_AUTO_DELETE_MAX_PER_RUN = 25;
/** Giữ tombstone dài hạn (dòng form gốc vẫn còn), chỉ cắt bớt khi quá lớn. */
const CANDIDATE_TOMBSTONE_MAX_ENTRIES = 5000;

/** Tab "Vắng phỏng vấn" (NO_SHOW / DECLINED): tự xóa khỏi hệ thống sau 48h. */
export const NO_SHOW_AUTO_DELETE_HOURS = 48;
/** Tab "Danh sách đen" (BLACKLIST): tự xóa khỏi hệ thống sau 72h. */
export const BLACKLIST_AUTO_DELETE_HOURS = 72;
export const CANDIDATE_STATUS_AUTO_DELETE_MAX_PER_RUN = 25;

/** Cấu hình thời hạn tự xóa theo trạng thái + cột mốc thời gian tương ứng.
 *  Cột mốc được ghi khi hồ sơ chuyển vào trạng thái (xem employees.service);
 *  hồ sơ cũ chưa có cột mốc sẽ được đóng dấu "bây giờ" ở lượt quét đầu tiên
 *  để KHÔNG xóa oan dữ liệu lịch sử. */
const STATUS_AUTO_DELETE_CONFIG: Record<string, { hours: number; field: 'no_show_at' | 'declined_at' | 'blacklist_at'; label: string }> = {
  NO_SHOW: { hours: NO_SHOW_AUTO_DELETE_HOURS, field: 'no_show_at', label: 'Vắng phỏng vấn' },
  DECLINED: { hours: NO_SHOW_AUTO_DELETE_HOURS, field: 'declined_at', label: 'Từ chối phỏng vấn' },
  BLACKLIST: { hours: BLACKLIST_AUTO_DELETE_HOURS, field: 'blacklist_at', label: 'Danh sách đen' },
};

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

/** Trạng thái chứng minh hồ sơ đã/đang được HR xử lý lịch PV hoặc đã phỏng vấn.
 *  Có 1 trạng thái trong danh sách này là KHÔNG tự ẩn. */
const INTERVIEW_HANDLED_STATUSES = new Set<string>([
  'INVITED_INTERVIEW',
  'CONFIRMED',
  'RESCHEDULE_REQUESTED',
  'RESCHEDULE_PROPOSED',
  'INTERVIEWED',
  'SCORED',
  'ACCEPTED',
  'BLACKLIST',
]);

/** Cột chứng minh HR đã đặt lịch / phỏng vấn / chấm điểm hồ sơ — có 1 cột là
 *  KHÔNG được tự ẩn, kể cả khi trạng thái còn NEW do dữ liệu cũ.
 *
 *  LƯU Ý: KHÔNG đưa `zalo_invite_note` / `zalo_invite_error` vào đây. Cột
 *  "Zalo Thư Mời" trên Google Form thực tế chứa SỐ ĐIỆN THOẠI (hoặc câu trả lời
 *  thô), nên `parseZaloInviteCell` biến nó thành `zalo_invite_note` cho gần như
 *  mọi hồ sơ. Nếu chặn theo ghi chú này thì tính năng tự ẩn không bao giờ chạy. */
const INTERVIEW_HANDLED_FIELDS = [
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
  'interview_proposed_at',
  'interview_decline_reason',
  'interview_reminder_at',
  'interview_reminder_count',
  'interview_reminder_key',
] as const;

/** Dữ liệu vận hành phải giữ vĩnh viễn (không phải lịch PV nhưng không được mất). */
const KEEP_ALWAYS_FIELDS = ['vip_at', 'vip_by', 'blacklist_reason', 'blacklist_at'] as const;


/**
 * Chuẩn hoá thời điểm đăng ký về ms. Hỗ trợ:
 * - ISO / serial Google Sheets / 'dd/MM/yyyy HH:mm:ss' (giờ VN) qua normSheetDateTime.
 * - Chuỗi lạ: thử Date.parse lần cuối.
 * Trả null nếu không xác định được (KHÔNG ẩn hồ sơ thiếu ngày).
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

/** Hồ sơ đã được HR xếp lịch / phỏng vấn / chấm điểm? Có dấu vết là KHÔNG tự ẩn. */
export function isCandidateInterviewHandled(c: any): boolean {
  const status = String(c?.status ?? '').trim().toUpperCase();
  if (INTERVIEW_HANDLED_STATUSES.has(status)) return true;
  return INTERVIEW_HANDLED_FIELDS.some(f => hasValue(c?.[f]));
}

/** Hồ sơ đủ điều kiện tự ẩn? Chỉ hồ sơ quá hạn và CHƯA được HR đặt lịch PV. */
export function isCandidateEligibleForAutoDelete(
  c: any,
  nowMs: number = Date.now(),
  days: number = CANDIDATE_AUTO_DELETE_DAYS,
): boolean {
  // Đã ẩn trước đó -> không xử lý lặp (tránh ghi tombstone/audit mỗi lượt quét).
  if (hasValue(c?.auto_hidden_at)) return false;
  // HR đã đánh dấu ưu tiên / danh sách đen -> không tự ẩn.
  if (c?.vip === true) return false;
  if (KEEP_ALWAYS_FIELDS.some(f => hasValue(c?.[f]))) return false;

  // Đã được HR đặt lịch / phỏng vấn / chấm điểm -> giữ lại.
  if (isCandidateInterviewHandled(c)) return false;

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
  /** ID hồ sơ vừa được ẩn khỏi hệ thống (KHÔNG xoá khỏi Google Sheet). */
  deletedIds: string[];
  failedIds: string[];
  deleted: Array<{ id: string; name: string; created_at?: string }>;
}

/**
 * Một lượt quét tự động. Gọi từ server theo interval; trả về danh sách hồ sơ
 * vừa được ẩn để server bắn realtime `data:updated(entity='candidates')`.
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

  const nowIso = new Date(now).toISOString();
  const reason = `Quá ${days} ngày chưa được HR xếp lịch phỏng vấn`;
  const keysOf = (c: any) => candidateCleanupKey(c);

  const candidates = await adapter.listCandidates();
  const list = Array.isArray(candidates) ? candidates : [];
  let settings: any = {};
  try { settings = (await adapter.getSystemSettings?.()) || {}; } catch { settings = {}; }
  const tombstoneStore = getCandidateCleanupTombstones(settings);
  const eligible = list
    .filter((c: any) => !isCandidateTombstoned(tombstoneStore, keysOf(c)))
    .filter((c: any) => isCandidateEligibleForAutoDelete(c, now, days))
    // Hồ sơ cũ nhất trước (giữ đúng thứ tự chờ).
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
  // Đánh dấu NGAY trong bộ nhớ sync để pull nền (nếu chen ngang) gắn cờ ẩn,
  // không làm hồ sơ hiện lại trước khi kịp ghi tombstone bền vững.
  try { syncSvc?.markCandidateDeleted?.(eligible.map(keysOf)); } catch { /* best-effort */ }

  const entries = eligible.map((c: any) => ({
    id: String(c.submission_id),
    key: keysOf(c),
    at: nowIso,
    reason,
  })).filter((e: any) => !!e.id);

  let hiddenIds: string[] = [];
  let failedIds: string[] = [];

  try {
    if (typeof adapter.hideCandidatesFromSystem === 'function') {
      // Adapter hiện đại: chỉ ẩn trong hệ thống, KHÔNG ghi/xoá Google Sheet.
      const r = await adapter.hideCandidatesFromSystem(entries);
      hiddenIds = Array.isArray(r?.hidden) ? r.hidden.map(String) : [];
      failedIds = Array.isArray(r?.failed) ? r.failed.map(String) : [];
      // Adapter cũ/không trả chi tiết -> coi mọi id không báo lỗi là đã ẩn.
      if (hiddenIds.length === 0 && failedIds.length === 0) hiddenIds = entries.map((e: any) => e.id);
    } else {
      // Fallback cho adapter test/mock cũ. updateCandidate chỉ đổi bộ nhớ/DB,
      // không đụng tới dòng ứng viên trên Google Sheet.
      for (const e of entries) {
        try {
          await adapter.updateCandidate(e.id, {
            auto_hidden_at: nowIso,
            auto_hidden_reason: reason,
          });
          hiddenIds.push(e.id);
        } catch (err: any) {
          console.warn(`[candidate-cleanup] Ẩn ${e.id} thất bại:`, err?.message || err);
          failedIds.push(e.id);
        }
      }
    }
  } catch (err: any) {
    console.warn('[candidate-cleanup] Lô ẩn ứng viên thất bại:', err?.message || err);
    failedIds = entries.map((e: any) => e.id);
    hiddenIds = [];
  }

  const hiddenSet = new Set(hiddenIds);
  const success = eligible.filter((c: any) => hiddenSet.has(String(c.submission_id)));
  const failed = eligible.filter((c: any) => !hiddenSet.has(String(c.submission_id)));

  // Hoàn tác đánh dấu cho hồ sơ ẩn lỗi để không che hồ sơ còn sống.
  try { syncSvc?.unmarkCandidateDeleted?.(failed.map(keysOf)); } catch { /* best-effort */ }

  result.eligible = eligible.length;
  result.deletedIds = sortedUnique(hiddenIds);
  result.failedIds = sortedUnique(failedIds);
  result.deleted = success.map((c: any) => ({
    id: String(c.submission_id),
    name: String(c.full_name || c.submission_id),
    created_at: c.created_at ? String(c.created_at) : undefined,
  }));

  if (success.length > 0) {
    // 1) Ghi tombstone bền vững (sống qua restart + pull form gắn lại cờ ẩn).
    try {
      const store = getCandidateCleanupTombstones(
        await adapter.getSystemSettings().catch(() => settings),
      );
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
          reason,
        };
      }
      store.updated_at = nowIso;
      pruneTombstones(store);
      await adapter.updateSystemSettings({ [CANDIDATE_AUTO_DELETE_SETTING_KEY]: store });
      try { await adapter.pushSystemSettingsNow?.(); } catch { /* nền sẽ đẩy lại */ }
    } catch (err: any) {
      // Không chặn ẩn: mark in-memory vẫn bảo vệ phiên hiện tại; lần quét sau
      // hồ sơ đã có cờ auto_hidden_at nên không lặp lại.
      console.warn('[candidate-cleanup] Không ghi được tombstone:', err?.message || err);
    }

    // 2) Audit log MỘT dòng cho cả lô (tránh ghi Sheet nhiều lần).
    try {
      const names = success
        .map((c: any) => `${c.full_name || c.submission_id} (${c.submission_id})`)
        .join(', ')
        .slice(0, 1500);
      await adapter.recordAuditLog({
        actor_id: 'SYSTEM',
        actor_role: 'SYSTEM',
        action: 'CANDIDATE_AUTO_HIDDEN',
        target_entity: 'UNG_VIEN',
        target_id: success.map((c: any) => String(c.submission_id || '')).filter(Boolean).join(',').slice(0, 500),
        details: `Tự động ẩn ${success.length} ứng viên quá ${days} ngày chưa được HR xếp lịch phỏng vấn (giữ nguyên dữ liệu trên Google Sheet): ${names}`,
      } as any).catch(() => null);
    } catch { /* audit không được chặn xử lý */ }
  }

  return result;
}

/**
 * Thông tin tự xóa theo trạng thái của 1 hồ sơ. Trả null nếu:
 * - không thuộc tab Vắng phỏng vấn / Danh sách đen,
 * - hoặc đã bị ẩn trước đó.
 */
export function candidateStatusAutoDeleteInfo(
  c: any,
  nowMs: number = Date.now(),
): { status: string; hours: number; field: string; label: string; enteredAtMs: number | null; remainingMs: number } | null {
  if (!c) return null;
  if (hasValue(c?.auto_hidden_at)) return null;
  const status = String(c?.status ?? '').trim().toUpperCase();
  const cfg = STATUS_AUTO_DELETE_CONFIG[status];
  if (!cfg) return null;
  const enteredAtMs = parseCandidateRegisteredAtMs(c?.[cfg.field]);
  const deadlineMs = enteredAtMs === null ? null : enteredAtMs + cfg.hours * 3_600_000;
  const remainingMs = deadlineMs === null ? Number.POSITIVE_INFINITY : Math.max(0, deadlineMs - nowMs);
  return { status, hours: cfg.hours, field: cfg.field, label: cfg.label, enteredAtMs, remainingMs };
}

export interface CandidateStatusCleanupOptions {
  now?: number;
  maxPerRun?: number;
  dryRun?: boolean;
}

/**
 * Một lượt quét tự xóa hồ sơ ở tab "Vắng phỏng vấn" (48h) và "Danh sách đen" (72h).
 *
 * Cùng cơ chế an toàn với candidateCleanupTick:
 * - CHỈ ẩn khỏi hệ thống (gắn auto_hidden_at), KHÔNG xóa dòng Google Sheet.
 * - Ghi tombstone bền vững để pull nền không hồi sinh hồ sơ đã xóa.
 * - Hồ sơ cũ thiếu cột mốc thời gian được đóng dấu ngay ở lượt quét đầu tiên
 *   (đồng hồ 48h/72h bắt đầu từ lúc đó) thay vì xóa luôn.
 */
export async function candidateStatusCleanupTick(
  adapter: any,
  opts: CandidateStatusCleanupOptions = {},
): Promise<CandidateCleanupResult> {
  const now = Number.isFinite(opts.now) ? Number(opts.now) : Date.now();
  const nowIso = new Date(now).toISOString();
  const envMax = Number(process.env.CANDIDATE_STATUS_AUTO_DELETE_MAX_PER_RUN);
  const maxPerRun = Number.isFinite(opts.maxPerRun as number)
    ? Math.max(1, Number(opts.maxPerRun))
    : (Number.isFinite(envMax) && envMax > 0 ? Math.min(envMax, 100) : CANDIDATE_STATUS_AUTO_DELETE_MAX_PER_RUN);

  const candidates = await adapter.listCandidates();
  const list = Array.isArray(candidates) ? candidates : [];
  let settings: any = {};
  try { settings = (await adapter.getSystemSettings?.()) || {}; } catch { settings = {}; }
  const tombstoneStore = getCandidateCleanupTombstones(settings);
  const keysOf = (c: any) => candidateCleanupKey(c);

  const eligible: Array<{ c: any; info: NonNullable<ReturnType<typeof candidateStatusAutoDeleteInfo>> }> = [];
  let stampedCount = 0;
  for (const c of list as any[]) {
    const info = candidateStatusAutoDeleteInfo(c, now);
    if (!info) continue;
    if (isCandidateTombstoned(tombstoneStore, keysOf(c))) continue;
    const id = String(c?.submission_id || '');
    if (!id) continue;
    if (info.enteredAtMs === null) {
      // Hồ sơ cũ chưa có cột mốc -> đóng dấu bắt đầu tính giờ, chưa xóa.
      // Giới hạn số hồ sơ đóng dấu mỗi lượt để không dồn ghi Sheet/DB quá nhiều.
      if (opts.dryRun || stampedCount >= maxPerRun) continue;
      stampedCount++;
      try {
        await adapter.updateCandidate(id, { [info.field]: nowIso });
      } catch (err: any) {
        console.warn(`[candidate-status-cleanup] Không đóng dấu ${info.field} cho ${id}:`, err?.message || err);
      }
      continue;
    }
    if (info.remainingMs > 0) continue;
    eligible.push({ c, info });
  }

  eligible.sort((a, b) => (a.info.enteredAtMs ?? 0) - (b.info.enteredAtMs ?? 0));
  const picked = eligible.slice(0, maxPerRun);

  const result: CandidateCleanupResult = {
    checked: list.length,
    eligible: picked.length,
    deletedIds: [],
    failedIds: [],
    deleted: [],
  };
  if (picked.length === 0 || opts.dryRun) return result;

  const syncSvc = adapter?.syncService;
  try { syncSvc?.markCandidateDeleted?.(picked.map(x => keysOf(x.c))); } catch { /* best-effort */ }

  const entries = picked.map(({ c, info }) => ({
    id: String(c.submission_id),
    key: keysOf(c),
    at: nowIso,
    reason: `${info.label} quá ${info.hours}h — tự động xóa khỏi hệ thống (giữ dòng Google Sheet)`,
  }));

  let hiddenIds: string[] = [];
  let failedIds: string[] = [];
  try {
    if (typeof adapter.hideCandidatesFromSystem === 'function') {
      const r = await adapter.hideCandidatesFromSystem(entries);
      hiddenIds = Array.isArray(r?.hidden) ? r.hidden.map(String) : [];
      failedIds = Array.isArray(r?.failed) ? r.failed.map(String) : [];
      if (hiddenIds.length === 0 && failedIds.length === 0) hiddenIds = entries.map(e => e.id);
    } else {
      for (const e of entries) {
        try {
          await adapter.updateCandidate(e.id, { auto_hidden_at: nowIso, auto_hidden_reason: e.reason });
          hiddenIds.push(e.id);
        } catch (err: any) {
          console.warn(`[candidate-status-cleanup] Ẩn ${e.id} thất bại:`, err?.message || err);
          failedIds.push(e.id);
        }
      }
    }
  } catch (err: any) {
    console.warn('[candidate-status-cleanup] Lô ẩn ứng viên thất bại:', err?.message || err);
    failedIds = entries.map(e => e.id);
    hiddenIds = [];
  }

  const hiddenSet = new Set(hiddenIds);
  const success = picked.filter(x => hiddenSet.has(String(x.c.submission_id)));
  const failed = picked.filter(x => !hiddenSet.has(String(x.c.submission_id)));
  try { syncSvc?.unmarkCandidateDeleted?.(failed.map(x => keysOf(x.c))); } catch { /* best-effort */ }

  result.eligible = picked.length;
  result.deletedIds = sortedUnique(hiddenIds);
  result.failedIds = sortedUnique(failedIds);
  result.deleted = success.map(({ c }) => ({
    id: String(c.submission_id),
    name: String(c.full_name || c.submission_id),
    created_at: c.created_at ? String(c.created_at) : undefined,
  }));

  if (success.length > 0) {
    try {
      const store = getCandidateCleanupTombstones(await adapter.getSystemSettings().catch(() => settings));
      for (const { c, info } of success) {
        const key = keysOf(c);
        if (!key) continue;
        store.entries[key] = {
          key,
          submission_id: String(c.submission_id || ''),
          full_name: String(c.full_name || ''),
          phone: String(c.phone_normalized || c.phone || ''),
          created_at: c.created_at ? String(c.created_at) : '',
          deleted_at: nowIso,
          reason: `${info.label} quá ${info.hours}h — tự động xóa khỏi hệ thống`,
        };
      }
      store.updated_at = nowIso;
      pruneTombstones(store);
      await adapter.updateSystemSettings({ [CANDIDATE_AUTO_DELETE_SETTING_KEY]: store });
      try { await adapter.pushSystemSettingsNow?.(); } catch { /* nền sẽ đẩy lại */ }
    } catch (err: any) {
      console.warn('[candidate-status-cleanup] Không ghi được tombstone:', err?.message || err);
    }

    try {
      const summary = success
        .map(({ c, info }) => `${c.full_name || c.submission_id} (${c.submission_id} — ${info.label} ${info.hours}h)`)
        .join(', ')
        .slice(0, 1500);
      await adapter.recordAuditLog({
        actor_id: 'SYSTEM',
        actor_role: 'SYSTEM',
        action: 'CANDIDATE_AUTO_HIDDEN_BY_STATUS',
        target_entity: 'UNG_VIEN',
        target_id: success.map(({ c }) => String(c.submission_id || '')).filter(Boolean).join(',').slice(0, 500),
        details: `Tự động xóa ${success.length} ứng viên khỏi hệ thống theo thời hạn tab Vắng phỏng vấn (48h) / Danh sách đen (72h), giữ nguyên dữ liệu trên Google Sheet: ${summary}`,
      } as any).catch(() => null);
    } catch { /* audit không được chặn xử lý */ }
  }

  return result;
}

function sortedUnique(ids: string[]): string[] {
  return Array.from(new Set(ids.map(String).filter(Boolean))).sort();
}
