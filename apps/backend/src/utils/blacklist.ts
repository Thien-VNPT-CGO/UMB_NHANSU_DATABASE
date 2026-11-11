/**
 * Danh sách đen nhân viên thử việc.
 *
 * Thông tin lưu 1 ô JSON trên NHAN_VIEN_MASTER (cột "Danh Sách Đen (JSON)")
 * theo đúng mẫu cột "Hợp Đồng Lao Động (JSON)": Sheet chỉ giữ metadata, còn
 * hồ sơ/công/lương vẫn nằm nguyên trên bảng employees để tính phiếu lương.
 */

import type { EmployeeBlacklist } from '@ubm/shared';

function str(value: unknown, max = 500): string {
  return String(value ?? '').trim().slice(0, max);
}

/**
 * Chuẩn hóa ô JSON (object hoặc chuỗi JSON) -> EmployeeBlacklist an toàn.
 * Trả undefined nếu ô rỗng/hỏng/không có lý do.
 */
export function parseBlacklist(value: unknown): EmployeeBlacklist | undefined {
  let raw: any = value;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return undefined;
    try { raw = JSON.parse(s); } catch { return undefined; }
  }
  if (!raw || typeof raw !== 'object') return undefined;
  const reason = str(raw.reason, 300);
  if (!reason) return undefined;
  const days = Number(raw.probation_days ?? raw.probationDays);
  const stage = str(raw.stage, 20).toUpperCase();
  const out: EmployeeBlacklist = {
    reason,
    blacklisted_at: str(raw.blacklisted_at || raw.blacklistedAt, 40),
    blacklisted_by: str(raw.blacklisted_by || raw.blacklistedBy, 80),
  };
  const note = str(raw.note, 1000);
  if (note) out.note = note;
  if (stage === 'PROBATION' || stage === 'OFFICIAL' || stage === 'PRE_ONBOARDING' || stage === 'TERMINATED') {
    out.stage = stage as EmployeeBlacklist['stage'];
  }
  if (Number.isFinite(days)) out.probation_days = Math.max(0, Math.min(12, Math.floor(days)));
  if (!out.blacklisted_at) out.blacklisted_at = '';
  if (!out.blacklisted_by) out.blacklisted_by = '';
  return out;
}

/** Ô Sheet: JSON gọn (rỗng nếu NV không nằm trong danh sách đen). */
export function blacklistCell(value: unknown): string {
  const rec = parseBlacklist(value);
  return rec ? JSON.stringify(rec) : '';
}
