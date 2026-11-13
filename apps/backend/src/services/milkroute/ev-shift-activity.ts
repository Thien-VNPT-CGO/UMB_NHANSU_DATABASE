/**
 * Xác định một ca vận chuyển có thực sự được tài xế vận hành hay không.
 *
 * Quy tắc lương: chỉ ngày có hoạt động thực tế mới được tính công/thành tiền.
 * Một ca được coi là CÓ HOẠT ĐỘNG khi thoả ít nhất một điều kiện:
 *   - Tài xế đã bấm bắt đầu ca (status chuyển khỏi SCHEDULED / có actual_start_at);
 *   - Ca đã/đang chạy (IN_PROGRESS, PAUSED, CHARGING, RETURNING, COMPLETED);
 *   - Có ít nhất 1 lượt check-in tại điểm dừng.
 *
 * Ca SCHEDULED nhưng tài xế không bắt đầu và không check-in → ngày đó
 * KHÔNG tính lương (ghi nhận vào absent_days của bảng lương).
 */
import type { EVShift } from '@ubm/shared';

const WORKED_STATUSES = new Set(['IN_PROGRESS', 'PAUSED', 'CHARGING', 'RETURNING', 'COMPLETED']);

export function isShiftWorked(
  shift: Pick<EVShift, 'status' | 'actual_start_at'> | null | undefined,
  checkinCount = 0,
): boolean {
  if (!shift) return false;
  if (checkinCount > 0) return true;
  if (String(shift.actual_start_at || '').trim()) return true;
  return WORKED_STATUSES.has(String(shift.status || '').toUpperCase());
}