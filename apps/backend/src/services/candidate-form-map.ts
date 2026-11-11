/**
 * Chuẩn hoá dữ liệu ứng viên đọc từ Google Form (CANDIDATE_SPREADSHEET_ID).
 *
 * Form thật của UBM hỏi "Năm Sinh của bạn?" theo KHOẢNG TUỔI
 * ("2004 - 2008", "2000 - 2004", "2008 trở lên"), cột "Zalo Thư Mời" trên
 * Sheet đích lại chứa dữ liệu cũ HR nhập tay (SĐT/Zalo phụ) chứ không phải mã
 * trạng thái gửi tin. Các hàm dưới đây giữ nguyên giá trị gốc để Sheet đích
 * phản ánh đúng dữ liệu thật, đồng thời vẫn suy ra trường số/mã cho nghiệp vụ.
 */

/** Suy ra 1 năm sinh để tính điểm AI (giữ hành vi cũ: lấy nhóm 4 số CUỐI). */
export function parseFormBirthYear(raw: unknown): number {
  const text = String(raw ?? '').trim();
  if (!text) return 2002;
  const years = text.match(/\d{4}/g);
  if (years && years.length > 0) {
    const last = Number(years[years.length - 1]);
    if (Number.isFinite(last) && last > 1900) return last;
  }
  return 2002;
}

/** Giữ link Facebook đúng như ứng viên gửi; chỉ thêm scheme khi thiếu. */
export function normalizeFormFacebook(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  // Chỉ ghép scheme khi giá trị thật sự là đường dẫn Facebook. Tên/ghi chú
  // ("Pun Nguyễn", "Ko") phải giữ nguyên, không bịa thành URL hỏng.
  if (/^(www\.)?(facebook\.com|fb\.com|fb\.me)\//i.test(text)) return `https://${text}`;
  if (/^[a-z0-9.]{5,}$/i.test(text) && !text.includes(' ')) return `https://facebook.com/${text}`;
  return text;
}

/** Mã trạng thái gửi Zalo hợp lệ (cột "Zalo Thư Mời" trên Sheet đích). */
export const ZALO_INVITE_STATUSES = ['SENT', 'NO_ZALO', 'NOT_FRIEND', 'FAILED', 'NOT_CONNECTED', 'PENDING'] as const;

/**
 * Tách giá trị cột "Zalo Thư Mời" thành trạng thái gửi + ghi chú.
 * Dữ liệu cũ trên Sheet là SĐT/Zalo phụ ("0792 536 788", "Zalo: ...") — phải
 * giữ ở dạng ghi chú, tuyệt đối không được nạp vào `zalo_invite_status`
 * (nếu không sẽ lặp vô hạn: đọc SĐT -> ghi lại thành trạng thái).
 */
export function parseZaloInviteCell(raw: unknown): { status?: string; note?: string } {
  const text = String(raw ?? '').trim();
  if (!text) return {};
  const upper = text.toUpperCase();
  if ((ZALO_INVITE_STATUSES as readonly string[]).includes(upper)) return { status: upper };
  return { note: text };
}

/** Giá trị ghi lại vào cột "Zalo Thư Mời": ưu tiên trạng thái, không có thì giữ ghi chú. */
export function buildZaloInviteCell(status?: unknown, note?: unknown): string {
  const st = String(status ?? '').trim();
  if (st && (ZALO_INVITE_STATUSES as readonly string[]).includes(st.toUpperCase())) return st.toUpperCase();
  const nt = String(note ?? '').trim();
  if (nt) return nt;
  return st;
}
