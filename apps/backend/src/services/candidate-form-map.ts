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

/**
 * Giữ NGUYÊN giá trị ô Facebook ứng viên đã gửi.
 * Code cũ tự ghép "https://facebook.com/<tên>" cho mọi giá trị không phải URL
 * ("Pun Nguyễn" -> https://facebook.com/Pun Nguyễn) khiến Sheet đích sai dữ
 * liệu thật. Không suy diễn gì thêm ở đây.
 */
export function normalizeFormFacebook(raw: unknown): string {
  return String(raw ?? '').trim();
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

/** Nhãn ca do HR chốt qua dropdown "Cập nhật TT" (khác câu trả lời thô của form). */
export function isHrShiftLabel(raw: unknown): boolean {
  return /^Ca\s+(sáng|chiều|tối)\s*\(\d{2}\s*-\s*\d{2}\)$/i.test(String(raw ?? '').trim());
}

/** Nhãn chi nhánh do HR chốt (VD "Ụm Bò Milk - CN2 (261 Tô Hiến Thành)"). */
export function isHrBranchLabel(raw: unknown): boolean {
  return /^Ụm\s+Bò\s+Milk\s*-\s*CN/i.test(String(raw ?? '').trim());
}

/**
 * Khoá nhận diện ứng viên để ghép dữ liệu vận hành (ca/chi nhánh/lịch PV…).
 *
 * `submission_id` hiện đánh theo THỨ TỰ DÒNG nên rất dễ lệch khi Sheet bị
 * sắp xếp/chèn dòng: dữ liệu HR của người này bị gắn sang người khác. Luôn ghép
 * theo SĐT + tên (+ thời gian gửi nếu có) để đúng người.
 */
export function candidateIdentityKey(phone: unknown, name: unknown, createdAt?: unknown): string {
  const ph = String(phone ?? '').replace(/\D/g, '');
  const nm = String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const t = String(createdAt ?? '').trim();
  return `${ph}|${nm}${t ? `|${t}` : ''}`;
}

/** Giá trị ghi lại vào cột "Zalo Thư Mời": ưu tiên trạng thái, không có thì giữ ghi chú. */
export function buildZaloInviteCell(status?: unknown, note?: unknown): string {
  const st = String(status ?? '').trim();
  if (st && (ZALO_INVITE_STATUSES as readonly string[]).includes(st.toUpperCase())) return st.toUpperCase();
  const nt = String(note ?? '').trim();
  if (nt) return nt;
  return st;
}
