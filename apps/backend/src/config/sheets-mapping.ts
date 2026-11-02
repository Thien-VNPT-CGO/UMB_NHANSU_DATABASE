/**
 * BẢN ĐỒ GOOGLE SPREADSHEET RIÊNG BIỆT CHO TỪNG BẢNG (25 SHEETS)
 * ================================================================
 * Cung cấp bởi Chủ dự án UBM HR System.
 * Mỗi bảng nghiệp vụ được lưu trên một Google Spreadsheet độc lập.
 */

export const SEPARATED_SHEETS_MAP: Record<string, string> = {
  FROM_NHAN_VIEN: '1kBpYSBKT-UQhTRzOU_38lZ34B78ZrzErDgydC5pubY8',
  NHAN_VIEN_MASTER: '1XvASWXUqltONLwvV1m2PIdi7BtRYZbyW-BYZj00xUsQ',
  PHAN_CONG_CA: '1pLbQxCWQthwhcSo2MJmGAWS_pZPisyEpWeImc0p0l0Q',
  TAI_KHOAN_NHAN_VIEN: '1Mr-ux8IWMKa4vqUgWo55wyDLO1wfMlycPH17mltOeZQ',
  SU_KIEN_DIEM_DANH: '1n8zK3R7ZS8WV2wdLBmDegrxe6qKkRk6NDn3skKKZ374',
  DON_NGHI_PHEP: '1pvsdb4-im6Gz-MGTWX6CK3FQg_EPxvdu_77njFTzHLc',
  DON_DOI_CA: '1sfMrfPv6enH9_OTTZMwX98tL7CX2lRNh91LUMwkpl_U',
  THONGBAO_NV: '13hUNoKT8U1Li_EIyx3bxNGQaiuVvsiXY_ussblJpWRE',
  DIEU_CHINH_CONG: '1zixbn7FSqvEALYTOsG5dZttT2Wf6w4zIvjPuz1NuBL0',
  KY_LUONG: '13kwbYcXQ9SsNs6hlpB5BmAx8pdO-xLT1qsrRdU8xaA0',
  CHI_TIET_LUONG: '1Kwnto75bUxlMsWGGxTYVqFq3I7Ty0nik6JL90_dIFY0',
  AUDIT_LOG: '1PPJZPjaCMC4_17nQItZgdN5Jq0ILtdZgi0ZJawmXtLg',
  DANH_SACH_CHI_NHANH: '1b5EdX23uZQw9RtmBEPqFKvd9R2qkLbfrjNO7c8R32So',
  ADMIN_ACCOUNTS: '1z0Gu7JrK7mdNMu4N-WmMt3HTaKA56DM3_LY_9QRSSXU',
  CAU_HINH_HE_THONG: '1JcJsEMBhS_RQR68prdTvDtsdn0ONgKxO_4U-04Pvpdo',
  BAI_THI: '1aomZUt7YYy4J2fUjHavVJdcrcaTNWmjOSIh-qJlgQ64',
  BAI_LAM: '1YypwqMcwKUT_CU86UmUvb8oXmGUPi9HhFGG1ykSJ-Js',
  LUUTRU_CHAMCONG_TUAN: '159EMCALHp1b_WmiprHmkrgDq6peAyP0NEkQ729aSUZM',
  PHIEU_LUONG: '1aRZ2IL2z3yqQYr1YKEI1SSdJG4VRrqyzaz9KKW8kI10',
  LICH_SU_GIAI_DOAN: '1FA0sIFNGP8L7Jb6tVHFt043s11m83KC1tCp38XaJDYc',
  CONG_THUC_LUONG: '1YptJQybfT7FXxcrJaR_FFak8fPUDLTe4YQgYH7RBY-s',
  DULIEU_LUONG_KY: '1i-vnz5L1errwNE7y1PqYdVzaF1oMFOD0C-IRRdCzzYY',
  THONGBAO_GUI: '12lTHxPn80hOnLNE8fvNno08tURZfqvPPhiOeFzS47p8',
  SNAPSHOT_SAOLUU: '10CYuaiPqWwbTfWBCw9JGXCjcBzzwZUtpBnOP5NuzZpQ',
  PHIEU_NV_CAP_NHAT_CA: '1ZtR2jm8xYeh3P08ipSkG0BTJfqzerU7EMJVJFxeLr_U',
};

/**
 * Lấy Spreadsheet ID cho 1 tab cụ thể, fallback về ID mặc định.
 *
 * Tab phân mảnh (`<BASE>_P2`, `<BASE>_P3`...) dùng chung spreadsheet của bảng
 * gốc — nhờ vậy append/đọc part không rơi về spreadsheet tổng hợp cũ.
 */
export function getSpreadsheetIdForTab(tabName: string, defaultSpreadsheetId: string): string {
  const raw = String(tabName || '').trim();
  if (!raw) return defaultSpreadsheetId;
  if (SEPARATED_SHEETS_MAP[raw]) return SEPARATED_SHEETS_MAP[raw];
  const base = raw.toUpperCase().replace(/_P\d+$/, '');
  return SEPARATED_SHEETS_MAP[base] || defaultSpreadsheetId;
}

/** true nếu tab (hoặc part của tab) có spreadsheet riêng trong bộ 25 sheet. */
export function isSeparatedSheetTab(tabName: string): boolean {
  const raw = String(tabName || '').trim().toUpperCase();
  if (!raw) return false;
  return !!(SEPARATED_SHEETS_MAP[raw] || SEPARATED_SHEETS_MAP[raw.replace(/_P\d+$/, '')]);
}

/** Toàn bộ spreadsheet ID của bộ 25 bảng riêng (đã loại trùng). */
export function listSeparatedSpreadsheetIds(): string[] {
  return [...new Set(Object.values(SEPARATED_SHEETS_MAP))];
}

export interface SeparatedSheetSource {
  /** Tên bảng nghiệp vụ (VD: NHAN_VIEN_MASTER). */
  title: string;
  /** ID Google Spreadsheet riêng của bảng đó. */
  spreadsheetId: string;
}

/**
 * Danh sách file Google Sheets thật sự đang chứa dữ liệu (25 bảng riêng).
 * Dùng cho backup: copy từng file riêng thay vì file tổng hợp cũ.
 */
export function listSeparatedSheetSources(): SeparatedSheetSource[] {
  return Object.entries(SEPARATED_SHEETS_MAP).map(([title, spreadsheetId]) => ({ title, spreadsheetId }));
}
