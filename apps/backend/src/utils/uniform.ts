/**
 * Đồng phục của nhân viên.
 *
 * HR nhập ngày nhận + số lượng ở tab Hồ Sơ Nhân Viên. Quy định 1 áo = 150.000đ;
 * số tiền = số lượng × đơn giá và được trừ vào lương của tháng chứa ngày nhận.
 *
 * Metadata lưu 1 ô JSON trên NHAN_VIEN_MASTER (cột "Đồng Phục (JSON)") — cạnh
 * ô hợp đồng lao động — để cổng Admin/Kế Toán/Nhân viên đọc chung 1 nguồn.
 */

import type { EmployeeUniformInfo } from '@ubm/shared';

/** Đơn giá chuẩn 1 áo đồng phục (VNĐ). */
export const UNIFORM_UNIT_PRICE = 150_000;

/** Chuẩn hóa ngày về YYYY-MM-DD (nhận ISO/serial/DD-MM-YYYY). */
export function normalizeUniformDate(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) return '';
  // Đã đúng dạng YYYY-MM-DD (có thể kèm giờ ISO).
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const y = iso[1], m = iso[2].padStart(2, '0'), d = iso[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  // DD/MM/YYYY hoặc DD-MM-YYYY (dữ liệu Kế toán/HR gõ tay).
  const vn = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (vn) {
    const d = vn[1].padStart(2, '0'), m = vn[2].padStart(2, '0'), y = vn[3];
    return `${y}-${m}-${d}`;
  }
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return '';
  return new Date(t).toISOString().slice(0, 10);
}

/** Chuẩn hóa ô JSON (object hoặc chuỗi JSON) -> EmployeeUniformInfo an toàn. */
export function parseUniform(value: unknown): EmployeeUniformInfo | null {
  let raw: any = value;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return null;
    try { raw = JSON.parse(s); } catch { return null; }
  }
  if (!raw || typeof raw !== 'object') return null;

  const received_date = normalizeUniformDate(raw.received_date ?? raw.receivedDate);
  const quantity = Math.max(0, Math.floor(Number(raw.quantity ?? raw.qty) || 0));
  if (!received_date || quantity <= 0) return null;

  const unit_price = Math.max(0, Math.floor(Number(raw.unit_price ?? raw.unitPrice) || UNIFORM_UNIT_PRICE)) || UNIFORM_UNIT_PRICE;
  return {
    received_date,
    quantity,
    unit_price,
    amount: quantity * unit_price,
    updated_at: String(raw.updated_at ?? raw.updatedAt ?? '').trim() || undefined,
    updated_by: String(raw.updated_by ?? raw.updatedBy ?? '').trim() || undefined,
  };
}

/** Ô Sheet: JSON gọn (rỗng nếu chưa có thông tin đồng phục). */
export function uniformCell(value: unknown): string {
  const uniform = parseUniform(value);
  return uniform ? JSON.stringify(uniform) : '';
}

/** Kỳ lương (YYYY-MM) của ngày nhận đồng phục. */
export function uniformPeriod(value: unknown): string {
  const d = normalizeUniformDate(value);
  return d ? d.slice(0, 7) : '';
}
