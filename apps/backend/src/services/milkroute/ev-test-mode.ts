/**
 * Chế độ TEST của phân hệ Vận chuyển sữa (Admin bật/tắt).
 *
 * Khi bật: tài xế bấm xác nhận được ở MỌI điểm dừng/chi nhánh (bỏ kiểm tra
 * khoảng cách, sai số GPS, thứ tự điểm), không bị tính trễ/phạt và ca test
 * không bị tính công khi chạy bảng lương. Khi tắt, mọi quy trình trở lại
 * bình thường.
 *
 * Cờ được lưu trong systemSettings (`CAU_HINH_HE_THONG`) nên giữ nguyên khi
 * backend restart. Ca đã dùng để test được đánh dấu trong `notes` để:
 *  - kết thúc ca ở đâu cũng được (kể cả Admin đã tắt Test trước khi kết thúc);
 *  - bảng lương bỏ qua ca test (không tính công, không tính phạt).
 */
export const EV_TEST_MODE_KEY = 'ev_test_mode';
export const EV_TEST_SHIFT_MARK = '[TEST_MODE]';

/** Cờ Test đang bật? Chấp nhận cả dạng boolean cũ và object mới. */
export function isEvTestModeEnabled(repo: any): boolean {
  // Google Sheets adapter ủy quyền dữ liệu cho MockSheetsAdapter bên trong;
  // PostgreSQL dùng trực tiếp repo. Đọc cả 2 đường để không phụ thuộc adapter.
  const settings = repo?.systemSettings
    ?? repo?.getMockAdapter?.()?.systemSettings
    ?? {};
  const raw = settings?.[EV_TEST_MODE_KEY];
  if (!raw) return false;
  if (raw === true) return true;
  if (typeof raw === 'object') return raw.enabled === true || raw.enabled === 'true';
  return String(raw).toLowerCase() === 'true';
}

/** Ca đã từng được dùng để test? */
export function isEvTestShift(shift: any): boolean {
  return String(shift?.notes || '').includes(EV_TEST_SHIFT_MARK);
}

/** Gắn nhãn test vào notes của ca (giữ nguyên ghi chú cũ). */
export function withEvTestShiftMark(notes?: string | null): string {
  const base = String(notes || '').trim();
  if (base.includes(EV_TEST_SHIFT_MARK)) return base;
  return base ? `${base} ${EV_TEST_SHIFT_MARK}` : EV_TEST_SHIFT_MARK;
}
