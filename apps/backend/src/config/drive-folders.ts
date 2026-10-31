/**
 * CẤU HÌNH CÂY THƯ MỤC GOOGLE DRIVE - UBM HR SYSTEM
 * ================================================================
 * Thư mục gốc: UMBOMILK_DATABASE
 * URL: https://drive.google.com/drive/folders/1tBbooiPlppJV8QrpY2gtm8ij6FUf-k0j
 */

export const DRIVE_ROOT_FOLDER_ID = '1tBbooiPlppJV8QrpY2gtm8ij6FUf-k0j';

export const DRIVE_SUBFOLDERS = {
  /** 00. DATABASE: Chứa 25 file Google Sheets nghiệp vụ */
  DATABASE: '1SFYEOgjsZyC23OWGXMZDFMGemsdcVeSJ',

  /** BACKUP_DATA_HOUR: Sao lưu dữ liệu theo giờ (15 phút/lần) */
  BACKUP_HOUR: '1D4GXSI1P_MUGugrsNJuphYP_VlGylYW6',

  /** 01. BACKUP_DATA_DAY: Sao lưu dữ liệu theo ngày */
  BACKUP_DAY: '1GaPSvNcbINMtG90aQ-KzL2SPLxUG9JkG',

  /** 02. BACKUP_DATA_WEEK: Sao lưu dữ liệu theo tuần */
  BACKUP_WEEK: '1MoVP66cmDcFLg5Du0WhoQwF9rECqr8z0',

  /** 03. BACKUP_DATA_MONTH: Sao lưu dữ liệu theo tháng */
  BACKUP_MONTH: '1fBz9Szu6qCiV086YyxNBSGcjRPXKFddJ',

  /** 04. ĐIỂM DANH (CHECK-IN + CHECK-OUT): Lưu ảnh điểm danh theo chi nhánh */
  ATTENDANCE_ROOT: '1vql_oCLqsyDdvMlh_XIIhPhLuFWq387G',
};

/**
 * Thư mục ảnh điểm danh chi tiết theo từng Chi nhánh / Đơn vị
 */
export const DRIVE_ATTENDANCE_BRANCH_FOLDERS: Record<string, string> = {
  // CN1 - 130 Vạn Kiếp
  CN1: '16vPAt_0isAXDU2PVBITBOOt6tT-qWMaz',
  CN130: '16vPAt_0isAXDU2PVBITBOOt6tT-qWMaz',
  '130 Vạn Kiếp': '16vPAt_0isAXDU2PVBITBOOt6tT-qWMaz',

  // CN2 - 261 Tô Hiến Thành
  CN2: '1WWInMoLFaJAz8Q5e4O74ZbPPSruvb97y',
  CN261: '1WWInMoLFaJAz8Q5e4O74ZbPPSruvb97y',
  '261 Tô Hiến Thành': '1WWInMoLFaJAz8Q5e4O74ZbPPSruvb97y',

  // CN3 - 120 Hoàng Diệu 2
  CN3: '1J9nGFl9EpPfxlIwew2M2_9BV7g2wKWid',
  CN120: '1J9nGFl9EpPfxlIwew2M2_9BV7g2wKWid',
  '120 Hoàng Diệu 2': '1J9nGFl9EpPfxlIwew2M2_9BV7g2wKWid',

  // CN4 - 111 Tôn Đản
  CN4: '1fNYd6tEJfbW8yXAeR8fq_fh9-QtlcgBP',
  CN111: '1fNYd6tEJfbW8yXAeR8fq_fh9-QtlcgBP',
  '111 Tôn Đản': '1fNYd6tEJfbW8yXAeR8fq_fh9-QtlcgBP',

  // Xưởng Sản Xuất (Củ Chi)
  XUONG: '1-czL-M6Z4njl0AceKQHmj-qCJXGJkBoS',
  XUONG_SX: '1-czL-M6Z4njl0AceKQHmj-qCJXGJkBoS',
  'Xưởng Sản Xuất (Củ Chi)': '1-czL-M6Z4njl0AceKQHmj-qCJXGJkBoS',

  // Văn Phòng Trụ Sở Chính
  VANPHONG: '1RytLiwJSwrIHPu4Gn49a6_6qyEiIM__Z',
  VAN_PHONG: '1RytLiwJSwrIHPu4Gn49a6_6qyEiIM__Z',
  'Văn Phòng Trụ Sở Chính': '1RytLiwJSwrIHPu4Gn49a6_6qyEiIM__Z',
};

/** Tên thư mục chi nhánh dùng khi phải tạo mới dưới thư mục 04. ĐIỂM DANH. */
const BRANCH_FOLDER_LABELS: Record<string, string> = {
  CN1: 'CN1 - 130 Vạn Kiếp',
  CN2: 'CN2 - 261 Tô Hiến Thành',
  CN3: 'CN3 - 120 Hoàng Diệu 2',
  CN4: 'CN4 - 111 Tôn Đản',
  XUONG: 'Xưởng Sản Xuất (Củ Chi)',
  VANPHONG: 'Văn Phòng Trụ Sở Chính',
};

/**
 * Thư mục gốc "04. ĐIỂM DANH (CHECK-IN + CHECK-OUT)".
 * Cho phép ghi đè bằng env để dùng đúng Drive của từng môi trường (VPS/cloud).
 */
export function getAttendanceRootFolder(): string {
  return String(process.env.GOOGLE_DRIVE_ATTENDANCE_FOLDER_ID || '').trim()
    || DRIVE_SUBFOLDERS.ATTENDANCE_ROOT;
}

/** Khóa chi nhánh chuẩn (CN1/CN2/...) từ id hoặc tên chi nhánh. */
export function resolveAttendanceBranchKey(branchId?: string): string {
  const raw = String(branchId || '').trim();
  if (!raw) return '';
  const upper = raw.toUpperCase();
  if (DRIVE_ATTENDANCE_BRANCH_FOLDERS[upper]) {
    const hit = Object.keys(DRIVE_ATTENDANCE_BRANCH_FOLDERS).find(k => DRIVE_ATTENDANCE_BRANCH_FOLDERS[k] === DRIVE_ATTENDANCE_BRANCH_FOLDERS[upper]);
    return (hit || upper).toUpperCase();
  }
  if (DRIVE_ATTENDANCE_BRANCH_FOLDERS[raw]) {
    const hit = Object.keys(DRIVE_ATTENDANCE_BRANCH_FOLDERS).find(k => DRIVE_ATTENDANCE_BRANCH_FOLDERS[k] === DRIVE_ATTENDANCE_BRANCH_FOLDERS[raw]);
    return (hit || raw).toUpperCase();
  }

  // Chuẩn hóa không dấu để so khớp linh hoạt
  const normalized = upper
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Đ/g, 'D');

  if (normalized.includes('130') || normalized.includes('CN1') || normalized.includes('VAN KIEP')) return 'CN1';
  if (normalized.includes('261') || normalized.includes('CN2') || normalized.includes('TO HIEN THANH')) return 'CN2';
  if (normalized.includes('120') || normalized.includes('CN3') || normalized.includes('HOANG DIEU')) return 'CN3';
  if (normalized.includes('111') || normalized.includes('CN4') || normalized.includes('TON DAN')) return 'CN4';
  if (normalized.includes('XUONG') || normalized.includes('CU CHI')) return 'XUONG';
  if (normalized.includes('VAN PHONG') || normalized.includes('VANPHONG') || normalized.includes('TRU SO')) return 'VANPHONG';
  return '';
}

/** Tên hiển thị của thư mục chi nhánh (để tạo folder khi chưa có ID). */
export function getAttendanceBranchLabel(branchId?: string): string {
  const key = resolveAttendanceBranchKey(branchId);
  if (key && BRANCH_FOLDER_LABELS[key]) return BRANCH_FOLDER_LABELS[key];
  return String(branchId || 'KHONG_XAC_DINH').trim() || 'KHONG_XAC_DINH';
}

/**
 * Lấy Folder ID điểm danh tương ứng theo chi nhánh.
 *
 * Thứ tự ưu tiên:
 *  1. GOOGLE_DRIVE_ATTENDANCE_FOLDER_<CHI NHÁNH> (ví dụ ..._CN130, ..._CN1)
 *  2. ID cấu hình sẵn trong mã nguồn
 *  3. GOOGLE_DRIVE_ATTENDANCE_FOLDER_ID (thư mục 04. ĐIỂM DANH)
 *
 * Env được đọc tại thời điểm gọi (không cache lúc import) để đổi cấu hình chỉ
 * cần restart, không phải sửa mã nguồn.
 */
export function getAttendanceFolderForBranch(branchId?: string): string {
  const rootId = getAttendanceRootFolder();
  if (!branchId) return rootId;

  const raw = String(branchId).trim();
  const upper = raw.toUpperCase();

  // Cho phép đặt ID trực tiếp theo mã chi nhánh thô (CN130, CN261, ...).
  const rawEnv = String(process.env[`GOOGLE_DRIVE_ATTENDANCE_FOLDER_${upper}`] || '').trim();
  if (rawEnv) return rawEnv;

  const key = resolveAttendanceBranchKey(branchId);
  if (key) {
    const keyEnv = String(process.env[`GOOGLE_DRIVE_ATTENDANCE_FOLDER_${key}`] || '').trim();
    if (keyEnv) return keyEnv;
    if (DRIVE_ATTENDANCE_BRANCH_FOLDERS[key]) return DRIVE_ATTENDANCE_BRANCH_FOLDERS[key];
  }

  return rootId;
}
