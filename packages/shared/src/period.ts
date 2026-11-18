/**
 * Chuẩn hoá KỲ LƯƠNG (YYYY-MM) từ mọi nguồn dữ liệu.
 *
 * Vì sao cần: ô kỳ lương trên Google Sheets từng bị USER_ENTERED biến "2026-10"
 * thành NGÀY, và khi đọc bằng UNFORMATTED_VALUE thì trả về SỐ SERIAL Excel
 * (46296 = 01/10/2026, 46327 = 01/11/2026). Nếu để nguyên, mỗi phiếu lương mang
 * kỳ "46296" → khóa gộp `employee|period` khác "2026-10" nên phiếu bị NHÂN ĐÔI
 * khi xem kỳ và không khớp tháng đang chọn. Đã gặp thật ở PHIEU_LUONG 10/2026.
 *
 * Hàm dùng chung cho cả luồng pull Sheets (google-sheets-sync) và luồng đọc
 * phiếu lương (payroll.service) để dữ liệu cũ trong bộ nhớ cũng được hiển thị
 * đúng kỳ, không phụ thuộc lần pull kế tiếp.
 */

/** Số serial Excel (chỉ nhận khoảng ngày hợp lý) → YYYY-MM, sai thì null. */
function excelSerialToPeriod(n: number): string | null {
  if (!Number.isFinite(n) || n < 20_000 || n > 80_000) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000);
  if (!Number.isFinite(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function normalizePeriodValue(value: unknown): string {
  if (typeof value === 'number') return excelSerialToPeriod(value) || String(value);
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const d = new Date(value.getTime() + 7 * 3_600_000); // theo giờ VN
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  const raw = String(value ?? '').trim();
  const m = raw.match(/^(\d{4})-(0[1-9]|1[0-2])(?:$|[-/T\s])/);
  if (m) return `${m[1]}-${m[2]}`;
  // Số serial dạng chuỗi ("46296") — Sheets đôi khi trả số thành text.
  if (/^\d{5}$/.test(raw)) {
    const bySerial = excelSerialToPeriod(Number(raw));
    if (bySerial) return bySerial;
  }
  // Ngày kiểu Việt Nam "01/10/2026" (không có năm đứng trước).
  const vn = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (vn) return `${vn[3]}-${String(vn[2]).padStart(2, '0')}`;
  return raw;
}
