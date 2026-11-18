/**
 * Đếm ngược chu kỳ đổi mật khẩu định kỳ 6 tháng.
 *
 * - Mật khẩu đăng nhập Admin: mốc "đổi gần nhất" lưu theo từng admin_id trong
 *   CAU_HINH_HE_THONG (`admin_password_meta`). Tài khoản cũ chưa có mốc thì lấy
 *   ngày tạo tài khoản làm mốc đầu tiên.
 * - Mật khẩu VPS/root: hệ thống KHÔNG đọc được mật khẩu VPS, nên Admin tự ghi
 *   nhận mốc đổi (`vps_root_password_meta`) — dùng để hiện đếm ngược + nhắc.
 *
 * Mọi mốc tính theo NGÀY (giờ Việt Nam), hạn đổi = ngày đổi gần nhất + 6 tháng
 * (kẹp ngày cuối tháng nếu tháng đích ngắn hơn). Countdown phía client chạy theo
 * `server_now` để không lệch giờ máy.
 */

import { addMonthsClamped } from '@ubm/shared';
import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { normSheetDate } from './employees.service.js';

export const PASSWORD_CYCLE_MONTHS = 6;
export const PASSWORD_MIN_CYCLE_MONTHS = 1;
export const PASSWORD_MAX_CYCLE_MONTHS = 24;
/** Cảnh báo vàng khi còn ≤ 30 ngày. */
export const PASSWORD_WARNING_DAYS = 30;

const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;
const ADMIN_META_KEY = 'admin_password_meta';
const VPS_META_KEY = 'vps_root_password_meta';

export type PasswordRotationLevel = 'OK' | 'SOON' | 'OVERDUE' | 'UNSET';

export interface PasswordRotationStatus {
  scope: 'ADMIN' | 'VPS';
  level: PasswordRotationLevel;
  /** Số tháng một chu kỳ (mặc định 6). */
  cycle_months: number;
  /** Ngày đổi gần nhất (YYYY-MM-DD, giờ VN). */
  changed_at: string;
  /** ISO đầy đủ của lần đổi gần nhất (nếu có). */
  changed_at_iso: string | null;
  /** Hạn phải đổi tiếp theo (YYYY-MM-DD). */
  due_at: string;
  changed_ms: number;
  due_ms: number;
  /** Số mili-giây còn lại tới hạn (âm = đã quá hạn). */
  ms_left: number;
  days_left: number;
  /** % thời gian của chu kỳ đã trôi qua (0–100). */
  percent: number;
  /** Mốc giờ server để client tự đếm ngược realtime. */
  server_now: number;
  updated_by?: string | null;
  updated_at?: string | null;
  note?: string;
}

export interface PasswordStatusOptions {
  cycleMonths?: number;
  nowMs?: number;
  changedAtIso?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
  note?: string;
}

function vnToday(nowMs: number = Date.now()): string {
  return new Date(nowMs + VN_OFFSET_MS).toISOString().slice(0, 10);
}

export function clampCycleMonths(raw: unknown): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n)) return PASSWORD_CYCLE_MONTHS;
  return Math.min(PASSWORD_MAX_CYCLE_MONTHS, Math.max(PASSWORD_MIN_CYCLE_MONTHS, n));
}

/** Tính trạng thái đếm ngược từ ngày đổi gần nhất. `null` nếu ngày không hợp lệ. */
export function computePasswordRotationStatus(
  changedAtRaw: unknown,
  scope: 'ADMIN' | 'VPS',
  opts: PasswordStatusOptions = {},
): PasswordRotationStatus | null {
  const nowMs = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();
  const changedAt = normSheetDate(changedAtRaw);
  if (!changedAt) return null;
  const cycle = clampCycleMonths(opts.cycleMonths);
  const dueAt = addMonthsClamped(changedAt, cycle);
  if (!dueAt) return null;

  const changedMs = Date.parse(`${changedAt}T00:00:00+07:00`);
  const dueMs = Date.parse(`${dueAt}T00:00:00+07:00`);
  if (!Number.isFinite(changedMs) || !Number.isFinite(dueMs)) return null;

  const total = Math.max(1, dueMs - changedMs);
  const msLeft = dueMs - nowMs;
  const percent = Math.min(100, Math.max(0, ((nowMs - changedMs) / total) * 100));
  const level: PasswordRotationLevel = msLeft <= 0
    ? 'OVERDUE'
    : msLeft <= PASSWORD_WARNING_DAYS * DAY_MS
      ? 'SOON'
      : 'OK';

  return {
    scope,
    level,
    cycle_months: cycle,
    changed_at: changedAt,
    changed_at_iso: opts.changedAtIso || null,
    due_at: dueAt,
    changed_ms: changedMs,
    due_ms: dueMs,
    ms_left: msLeft,
    days_left: Math.max(0, Math.floor(msLeft / DAY_MS)),
    percent,
    server_now: nowMs,
    updated_by: opts.updatedBy ?? null,
    updated_at: opts.updatedAt ?? null,
    note: opts.note,
  };
}

function emptyStatus(scope: 'ADMIN' | 'VPS', cycleMonths: unknown, nowMs: number): PasswordRotationStatus {
  return {
    scope,
    level: 'UNSET',
    cycle_months: clampCycleMonths(cycleMonths),
    changed_at: '',
    changed_at_iso: null,
    due_at: '',
    changed_ms: 0,
    due_ms: 0,
    ms_left: 0,
    days_left: 0,
    percent: 0,
    server_now: nowMs,
  };
}

async function readSettings(repo: ISheetsRepository): Promise<any> {
  try {
    return await repo.getSystemSettings();
  } catch {
    return {};
  }
}

function readMetaMap(settings: any, key: string): Record<string, any> {
  const raw = settings?.[key];
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

/* ============================ ADMIN PASSWORD ============================ */

/** Trạng thái chu kỳ đổi mật khẩu của một tài khoản admin nội bộ. */
export async function adminPasswordStatus(
  repo: ISheetsRepository,
  admin: { admin_id: string; created_at?: string },
  nowMs: number = Date.now(),
): Promise<PasswordRotationStatus> {
  const settings = await readSettings(repo);
  const meta = readMetaMap(settings, ADMIN_META_KEY)[admin.admin_id] || {};
  // Chưa từng đổi qua app -> lấy ngày tạo tài khoản làm mốc đầu tiên.
  const changedAt = normSheetDate(meta.changed_at)
    || normSheetDate(admin.created_at)
    || vnToday(nowMs);
  return computePasswordRotationStatus(changedAt, 'ADMIN', {
    cycleMonths: meta.cycle_months,
    nowMs,
    changedAtIso: String(meta.changed_at || admin.created_at || '') || null,
    updatedBy: meta.updated_by || null,
    updatedAt: meta.updated_at || null,
  }) || emptyStatus('ADMIN', meta.cycle_months, nowMs);
}

/** Trạng thái theo admin_id (dùng cho route /auth/admin/password-rotation). */
export async function adminPasswordStatusById(
  repo: ISheetsRepository,
  adminId: string,
  nowMs: number = Date.now(),
): Promise<PasswordRotationStatus | null> {
  const id = String(adminId || '').trim();
  if (!id) return null;
  const admins = await repo.listAdminAccounts();
  const admin = admins.find(a => a.admin_id === id);
  if (!admin) return null;
  return adminPasswordStatus(repo, admin, nowMs);
}

/** Ghi nhận vừa đổi mật khẩu admin (reset đếm ngược 6 tháng). */
export async function markAdminPasswordChanged(
  repo: ISheetsRepository,
  adminId: string,
  atIso: string | Date = new Date(),
  actorId?: string,
): Promise<void> {
  const id = String(adminId || '').trim();
  if (!id) return;
  const settings = await readSettings(repo);
  const meta = { ...readMetaMap(settings, ADMIN_META_KEY) };
  const nowIso = new Date().toISOString();
  // Lưu theo NGÀY giờ Việt Nam (không lấy prefix UTC) để không lệch 1 ngày khi
  // admin đổi mật khẩu trong khung 00:00–06:59 sáng.
  const changedDate = typeof atIso === 'string'
    ? (normSheetDate(atIso) || vnToday())
    : vnToday(atIso.getTime());
  meta[id] = {
    ...(meta[id] || {}),
    changed_at: changedDate,
    updated_by: String(actorId || id),
    updated_at: nowIso,
  };
  await repo.updateSystemSettings({ [ADMIN_META_KEY]: meta });
}

/* ============================= VPS PASSWORD ============================= */

export interface VpsPasswordMeta {
  changed_at: string;
  cycle_months: number;
  note: string;
  updated_by: string | null;
  updated_at: string | null;
}

export async function readVpsPasswordMeta(repo: ISheetsRepository): Promise<VpsPasswordMeta> {
  const settings = await readSettings(repo);
  const meta = readMetaMap(settings, VPS_META_KEY);
  return {
    changed_at: normSheetDate(meta.changed_at),
    cycle_months: clampCycleMonths(meta.cycle_months),
    note: String(meta.note || '').slice(0, 500),
    updated_by: meta.updated_by ? String(meta.updated_by) : null,
    updated_at: meta.updated_at ? String(meta.updated_at) : null,
  };
}

export async function vpsPasswordStatus(
  repo: ISheetsRepository,
  nowMs: number = Date.now(),
): Promise<PasswordRotationStatus> {
  const meta = await readVpsPasswordMeta(repo);
  return computePasswordRotationStatus(meta.changed_at, 'VPS', {
    cycleMonths: meta.cycle_months,
    nowMs,
    changedAtIso: meta.changed_at || null,
    updatedBy: meta.updated_by,
    updatedAt: meta.updated_at,
    note: meta.note,
  }) || emptyStatus('VPS', meta.cycle_months, nowMs);
}

/**
 * Cập nhật mốc đổi mật khẩu VPS/root. `changedAt` bỏ trống -> giữ nguyên mốc cũ.
 * Trả về trạng thái mới để client hiển thị ngay.
 */
export async function saveVpsPasswordMeta(
  repo: ISheetsRepository,
  input: { changedAt?: string; cycleMonths?: number; note?: string },
  actorId: string,
  nowMs: number = Date.now(),
): Promise<PasswordRotationStatus> {
  const settings = await readSettings(repo);
  const prev = readMetaMap(settings, VPS_META_KEY);
  const rawDate = String(input?.changedAt || '').trim();
  let changedAt = normSheetDate(prev.changed_at);
  if (rawDate) {
    const next = normSheetDate(rawDate);
    if (!next) throw new Error('INVALID_DATE: Ngày đổi mật khẩu phải dạng YYYY-MM-DD!');
    changedAt = next;
  }
  const cycle = input?.cycleMonths === undefined
    ? clampCycleMonths(prev.cycle_months)
    : clampCycleMonths(input.cycleMonths);
  const note = input?.note === undefined
    ? String(prev.note || '').slice(0, 500)
    : String(input.note || '').slice(0, 500);
  if (!changedAt) {
    throw new Error('MISSING_CHANGED_AT: Chọn ngày đổi mật khẩu gần nhất trước khi lưu!');
  }
  const next = {
    changed_at: changedAt,
    cycle_months: cycle,
    note,
    updated_by: String(actorId || ''),
    updated_at: new Date().toISOString(),
  };
  await repo.updateSystemSettings({ [VPS_META_KEY]: next });
  return computePasswordRotationStatus(next.changed_at, 'VPS', {
    cycleMonths: next.cycle_months,
    nowMs,
    changedAtIso: next.changed_at,
    updatedBy: next.updated_by,
    updatedAt: next.updated_at,
    note: next.note,
  }) || emptyStatus('VPS', next.cycle_months, nowMs);
}
