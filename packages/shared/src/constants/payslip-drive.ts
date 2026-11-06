/**
 * Cấu trúc thư mục Google Drive cho tài khoản Kế toán — dùng chung backend/frontend.
 *
 * Cây thư mục (root: PHIEU_LUONG_DRIVE_ROOT_ID, override bằng env GOOGLE_DRIVE_PHIEU_LUONG_ROOT_ID):
 *
 *   <ROOT>/
 *   ├── PHIEU_LUONG/                     ← phiếu lương PDF (đủ 3 chữ ký)
 *   │   └── THANG_10/                    ← tháng (không kèm năm, đúng quy ước kế toán)
 *   │       └── CN1_130_VAN_KIEP/        ← thư mục chi nhánh (CN1_130_VAN_KIEP…)
 *   │           └── ĐINH KIM NGÂN/       ← thư mục theo TÊN NHÂN VIÊN (chữ hoa, giữ dấu)
 *   │               └── PHIEU_LUONG_T10.2026_130.1.pdf
 *   └── THANG_10_2026/                   ← dữ liệu đồng bộ theo tháng (từng chức năng)
 *       ├── 01_DOI_SOAT_CONG/
 *       ├── 02_BCC/
 *       ├── 03_TINH_LUONG/
 *       ├── 04_BANG_LUONG_THANG/
 *       ├── 05_KY_LUONG/
 *       ├── 06_THANH_TOAN/
 *       └── 07_CAU_HINH_LUONG/
 */

/** Root Drive ID mặc định — override bằng env GOOGLE_DRIVE_PHIEU_LUONG_ROOT_ID. */
export const PAYSLIP_DRIVE_ROOT_ID = '1V3MOk_KF7SeVL4jFG6YyRldRAwiZBw2x';
export const PHIEU_LUONG_FOLDER = 'PHIEU_LUONG';

/** Folder theo từng chức năng của tài khoản Kế toán (tự tạo khi đồng bộ tháng). */
export const ACCOUNTING_MONTH_FOLDERS: Array<{ name: string; label: string }> = [
  { name: '01_DOI_SOAT_CONG', label: 'Đối soát công & Bảng chấm công' },
  { name: '02_BCC', label: 'BCC — Bảng chấm công từng ngày' },
  { name: '03_TINH_LUONG', label: 'Tính lương (công thức & nhập tay)' },
  { name: '04_BANG_LUONG_THANG', label: 'Payment — Bảng lương tháng' },
  { name: '05_KY_LUONG', label: 'Kỳ lương (trạng thái & phê duyệt)' },
  { name: '06_THANH_TOAN', label: 'Thanh toán (VietQR / đã chuyển khoản)' },
  { name: '07_CAU_HINH_LUONG', label: 'Cấu hình lương CB & phụ cấp' },
];

/** Map branch_id (BRANCHES constants) → tên folder chi nhánh trên Drive. */
export const BRANCH_DRIVE_FOLDERS: Record<string, string> = {
  CN130: 'CN1_130_VAN_KIEP',
  CN261: 'CN2_261_TO_HIEN_THANH',
  CN120: 'CN3_120_HOANG_DIEU_2',
  CN111: 'CN4_111_TON_DAN',
  XUONG_SX: 'XUONG_SAN_XUAT_CU_CHI',
  VAN_PHONG: 'VAN_PHONG_TRU_SO_CHINH',
  // Alias phòng hờ dữ liệu cũ
  CN1: 'CN1_130_VAN_KIEP',
  CN2: 'CN2_261_TO_HIEN_THANH',
  CN3: 'CN3_120_HOANG_DIEU_2',
  CN4: 'CN4_111_TON_DAN',
};

/** Thứ tự hiển thị chi nhánh toàn hệ thống (dùng cho bảng phân nhóm). */
export const BRANCH_DISPLAY_ORDER: string[] = ['CN130', 'CN261', 'CN120', 'CN111', 'XUONG_SX', 'VAN_PHONG'];

export const BRANCH_SHORT_LABEL: Record<string, string> = {
  CN130: 'CN1 — 130 Vạn Kiếp',
  CN261: 'CN2 — 261 Tô Hiến Thành',
  CN120: 'CN3 — 120 Hoàng Diệu 2',
  CN111: 'CN4 — 111 Tôn Đản',
  XUONG_SX: 'Xưởng Sản Xuất (Củ Chi)',
  VAN_PHONG: 'Văn Phòng Trụ Sở',
};

const VALID_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 'YYYY-MM' → { year, month } (null nếu sai định dạng). */
export function parsePeriod(period: string): { year: number; month: number } | null {
  const p = String(period || '').trim();
  if (!VALID_MONTH.test(p)) return null;
  return { year: Number(p.slice(0, 4)), month: Number(p.slice(5, 7)) };
}

/** 'YYYY-MM' → 'THANG_10_2026' */
export function monthFolderName(period: string): string {
  const p = parsePeriod(period);
  if (!p) return 'THANG_KHONG_XAC_DINH';
  return `THANG_${String(p.month).padStart(2, '0')}_${p.year}`;
}

/** 'YYYY-MM' → 'THANG_10' (quy ước kế toán, không kèm năm) */
export function monthShortFolder(period: string): string {
  const p = parsePeriod(period);
  if (!p) return 'THANG_KHONG_XAC_DINH';
  return `THANG_${String(p.month).padStart(2, '0')}`;
}

/** 'YYYY-MM' → 'Tháng 10/2026' */
export function periodLabel(period: string): string {
  const p = parsePeriod(period);
  if (!p) return String(period || '—');
  return `Tháng ${String(p.month).padStart(2, '0')}/${p.year}`;
}

/** Chuẩn hóa chuỗi về ASCII không dấu (đ→d). */
export function stripAccents(s: unknown): string {
  return String(s ?? '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Loại ký tự không hợp lệ trong tên file/folder Drive, gộp khoảng trắng. */
export function sanitizeDriveName(name: unknown, opts?: { upper?: boolean }): string {
  let s = String(name ?? '')
    .replace(/[\\/:*?"<>|#%{}~&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (opts?.upper) s = s.toUpperCase();
  return s || 'KHONG_XAC_DINH';
}

/** Slug folder chi nhánh: ưu tiên map cố định, fallback sinh từ tên. */
export function branchDriveFolder(branchId?: string | null, branchName?: string | null): string {
  const id = String(branchId || '').trim();
  if (id && BRANCH_DRIVE_FOLDERS[id]) return BRANCH_DRIVE_FOLDERS[id];
  const src = String(branchName || id || '').trim();
  if (!src) return 'KHONG_XAC_DINH';
  const slug = stripAccents(src)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return slug || 'KHONG_XAC_DINH';
}

/** Folder theo TÊN nhân viên: chữ HOA, giữ dấu tiếng Việt (VD: "ĐINH KIM NGÂN"). */
export function employeeDriveFolder(fullName: string): string {
  return sanitizeDriveName(fullName, { upper: true });
}

/** Đường dẫn folder chứa phiếu lương của 1 NV trong 1 kỳ (không gồm tên file). */
export function payslipDriveSegments(period: string, branchId: string | null | undefined, branchName: string | null | undefined, fullName: string): string[] {
  return [PHIEU_LUONG_FOLDER, monthShortFolder(period), branchDriveFolder(branchId, branchName), employeeDriveFolder(fullName)];
}

/** Tên file PDF phiếu lương: PHIEU_LUONG_T10.2026_130.1.pdf */
export function payslipDriveFileName(period: string, employeeCode: string): string {
  const p = parsePeriod(period);
  const ym = p ? `T${String(p.month).padStart(2, '0')}.${p.year}` : sanitizeDriveName(period);
  const code = sanitizeDriveName(employeeCode).replace(/\s+/g, '');
  return `PHIEU_LUONG_${ym}_${code}.pdf`;
}
