/** Chọn nhân viên trực & phạm vi cổng — logic thuần, không phụ thuộc DB. */
import { isOnDutyNow } from './time';
import type { DutySelection, SalesStaff } from './types';

/**
 * Mảng rỗng/không có = phụ trách TẤT CẢ các cổng.
 * Có 1 hoặc nhiều ID = chỉ phụ trách đúng các cổng đó.
 */
export function staffCoversChannel(
  staff: Pick<SalesStaff, 'monitorChannelIds' | 'monitorChannelId'>,
  channelId: string
): boolean {
  const ids = Array.isArray(staff.monitorChannelIds)
    ? staff.monitorChannelIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  if (Array.isArray(staff.monitorChannelIds)) {
    if (ids.length === 0) return true;
    return ids.includes(channelId);
  }
  // Tương thích dữ liệu cũ chỉ có monitorChannelId.
  const legacy = String(staff.monitorChannelId || '').trim();
  return legacy ? legacy === channelId : true;
}

export function staffIsAvailable(staff: SalesStaff, now: Date | string | number): boolean {
  if (!staff.active) return false;
  return isOnDutyNow(staff.shift, now).onDuty;
}

/**
 * Chọn người được @tag cho một hội thoại miss.
 * - Ưu tiên nhân viên được gán ban đầu nếu còn bật + đúng ca + đúng phạm vi cổng.
 * - Nếu hết ca/tắt trực -> điều hướng sang nhân viên đang trực của cổng.
 * - tagAllOnDutyInShift -> tag toàn bộ nhân viên đang trực cùng ca của cổng.
 */
export function selectDutyStaff(
  staffList: SalesStaff[],
  channelId: string,
  now: Date | string | number,
  options: { assignedStaffId?: string | null; tagAllOnDutyInShift?: boolean } = {}
): DutySelection {
  const scoped = (staffList || []).filter((s) => staffCoversChannel(s, channelId));
  const onDuty = scoped.filter((s) => staffIsAvailable(s, now));
  const assignedId = String(options.assignedStaffId || '').trim();
  const assigned = assignedId ? (onDuty.find((s) => s.id === assignedId) || null) : null;

  if (options.tagAllOnDutyInShift && onDuty.length > 0) {
    return { mode: 'all', assigned, targets: onDuty, onDuty };
  }
  if (assigned) {
    return { mode: 'assigned', assigned, targets: [assigned], onDuty };
  }
  if (onDuty.length > 0) {
    return { mode: 'redirect', assigned: null, targets: [onDuty[0]], onDuty };
  }
  return { mode: 'none', assigned: null, targets: [], onDuty };
}

/** Lọc trùng theo UID Zalo (tránh tag 2 lần cùng một người). */
export function dedupeStaff(staff: SalesStaff[]): SalesStaff[] {
  const seen = new Set<string>();
  const out: SalesStaff[] = [];
  for (const s of staff || []) {
    const key = String(s.zaloUserId || '').trim() || `id:${s.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}
