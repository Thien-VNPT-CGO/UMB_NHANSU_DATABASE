/**
 * Hoàn tiền đồng phục + hỗ trợ khám sức khỏe sau khi NV đủ 6 tháng làm việc
 * chính thức.
 *
 * Mốc được tính từ NGÀY NHẬN ĐỒNG PHỤC (`uniform.received_date`) + 6 tháng.
 * Hệ thống nhắc HR TRƯỚC 1 NGÀY để chuẩn bị hoàn tiền (đồng phục + KSK).
 */

/** Số tháng làm việc chính thức để được hoàn tiền đồng phục + hỗ trợ KSK. */
export const UNIFORM_REFUND_MONTHS = 6;

/**
 * Cộng thêm số tháng vào ngày `YYYY-MM-DD`.
 * Ngày không tồn tại ở tháng đích (VD 31/8 + 6 tháng) sẽ kẹp về ngày cuối
 * tháng (28/2 hoặc 29/2) thay vì tràn sang tháng sau.
 * Trả '' nếu đầu vào không phải ngày hợp lệ.
 */
export function addMonthsClamped(isoDate: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || '').slice(0, 10));
  if (!m) return '';
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';

  // Ngày gốc phải tồn tại thật (chặn 2026-02-30, 2026-13-01...).
  const base = new Date(Date.UTC(year, month, day));
  if (base.getUTCFullYear() !== year || base.getUTCMonth() !== month || base.getUTCDate() !== day) return '';

  const target = new Date(Date.UTC(year, month + Math.trunc(months), 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

/** Ngày đủ 6 tháng kể từ ngày nhận đồng phục (YYYY-MM-DD); '' nếu không hợp lệ. */
export function uniformRefundMilestoneDate(receivedDate: string): string {
  return addMonthsClamped(receivedDate, UNIFORM_REFUND_MONTHS);
}

/** Ngày cần nhắc HR = mốc 6 tháng − 1 ngày (YYYY-MM-DD); '' nếu không hợp lệ. */
export function uniformRefundReminderDate(receivedDate: string): string {
  const milestone = uniformRefundMilestoneDate(receivedDate);
  if (!milestone) return '';
  const d = new Date(`${milestone}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Tổng tiền hoàn trả = tiền đồng phục + tiền hỗ trợ khám sức khỏe (VNĐ). */
export function uniformRefundTotal(
  uniform: { amount?: number; health_support_amount?: number } | null | undefined,
): number {
  const uniformAmount = Math.max(0, Math.floor(Number(uniform?.amount) || 0));
  const healthAmount = Math.max(0, Math.floor(Number(uniform?.health_support_amount) || 0));
  return uniformAmount + healthAmount;
}
