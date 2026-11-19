import { ShiftCode, ShiftTemplate } from '../types/schedules.js';

export const DESIGN_TOKENS = {
  colors: {
    bg: '#FFF8F4',
    surface: '#FFFFFF',
    brandSoft: '#F8DDE7',
    brand: '#E85D92',
    brandHover: '#D6457E',
    text: '#273142',
    textMuted: '#6B7280',
    border: '#F0E2DE',
    successSoft: '#DFF5E8',
    success: '#10B981',
    warningSoft: '#FEF3C7',
    warning: '#F59E0B',
    dangerSoft: '#FEE2E2',
    danger: '#EF4444',
  },
  radii: {
    sm: '8px',
    md: '12px',
    lg: '16px',
    full: '9999px',
  },
  shadows: {
    soft: '0 2px 8px rgba(39, 49, 66, 0.06)',
    card: '0 4px 16px rgba(39, 49, 66, 0.08)',
    modal: '0 12px 32px rgba(39, 49, 66, 0.16)',
  },
  transitions: {
    fast: '120ms cubic-bezier(0.4, 0, 0.2, 1)',
    normal: '180ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
};

export interface BranchInfo {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  /** Bật/tắt yêu cầu định vị GPS khi điểm danh tại chi nhánh. Mặc định bật. */
  gps_enabled?: boolean;
  /** Bật/tắt hiển thị chi nhánh (ghim + vòng bán kính) trên bản đồ GPS. Mặc định bật. */
  map_visible?: boolean;
  /** Cờ ẩn lịch làm việc của chi nhánh (mặc định hiển thị). */
  schedule_visible?: boolean;
  min_staff: number;
  max_staff: number;
  manager_name?: string;
  status: 'ACTIVE' | 'MAINTENANCE' | 'CLOSED';
}

/** Chi nhánh có bật định vị GPS không (mặc định BẬT nếu dữ liệu cũ chưa có cờ). */
export function isBranchGpsEnabled(branch: any): boolean {
  return branch?.gps_enabled !== false;
}

/**
 * Chi nhánh đã ngừng hoạt động → ẩn toàn bộ lịch làm việc (không cho xem/xếp lịch).
 * CLOSED là trạng thái "ngừng hoạt động"; schedule_visible=false hỗ trợ ẩn lịch
 * riêng mà không đổi trạng thái chi nhánh.
 */
export function isBranchScheduleHidden(branch: any): boolean {
  if (!branch) return false;
  const status = String(branch?.status || 'ACTIVE').trim().toUpperCase();
  return status === 'CLOSED' || branch?.schedule_visible === false;
}

/** Chi nhánh có hiển thị trên bản đồ GPS không (mặc định HIỂN THỊ nếu chưa có cờ). */
export function isBranchMapVisible(branch: any): boolean {
  return branch?.map_visible !== false;
}

export const BRANCHES: BranchInfo[] = [
  {
    id: 'CN130',
    name: 'Ụm Bò Milk - CN1 (130 Vạn Kiếp)',
    address: '130 Vạn Kiếp, Phường 3, Quận Bình Thạnh, TP. Hồ Chí Minh',
    latitude: 10.799831,
    longitude: 106.693370,
    radius_meters: 300,
    gps_enabled: true,
    min_staff: 2,
    max_staff: 5,
    manager_name: 'Cửa Hàng Trưởng CN1',
    status: 'ACTIVE',
  },
  {
    id: 'CN261',
    name: 'Ụm Bò Milk - CN2 (261 Tô Hiến Thành)',
    address: '261 Tô Hiến Thành, Phường 12, Quận 10, TP. Hồ Chí Minh',
    latitude: 10.778639,
    longitude: 106.666665,
    radius_meters: 300,
    gps_enabled: true,
    min_staff: 2,
    max_staff: 5,
    manager_name: 'Cửa Hàng Trưởng CN2',
    status: 'ACTIVE',
  },
  {
    id: 'CN120',
    name: 'Ụm Bò Milk - CN3 (120 Hoàng Diệu 2)',
    address: '120 Hoàng Diệu 2, Phường Linh Trung, TP. Thủ Đức, TP. Hồ Chí Minh',
    latitude: 10.856457,
    longitude: 106.765621,
    radius_meters: 300,
    gps_enabled: true,
    min_staff: 2,
    max_staff: 5,
    manager_name: 'Cửa Hàng Trưởng CN3',
    status: 'ACTIVE',
  },
  {
    id: 'CN111',
    name: 'Ụm Bò Milk - CN4 (111 Tôn Đản)',
    address: '111 Tôn Đản, Phường 15, Quận 4, TP. Hồ Chí Minh',
    latitude: 10.759223,
    longitude: 106.706995,
    radius_meters: 300,
    gps_enabled: true,
    min_staff: 2,
    max_staff: 5,
    manager_name: 'Cửa Hàng Trưởng CN4',
    status: 'ACTIVE',
  },
  {
    id: 'XUONG_SX',
    name: 'Ụm Bò Milk - Xưởng Sản Xuất (Củ Chi)',
    address: '85/14 Bùi Công Trừng, Hóc Môn / Q.12, TP. Hồ Chí Minh',
    latitude: 10.908028,
    longitude: 106.650444,
    radius_meters: 500,
    gps_enabled: true,
    min_staff: 4,
    max_staff: 15,
    manager_name: 'Quản Đốc Xưởng',
    status: 'ACTIVE',
  },
  {
    id: 'VAN_PHONG',
    name: 'Ụm Bò Milk - Văn Phòng Trụ Sở Chính',
    address: 'Trụ sở chính - Số 10 Đặng Thai Mai, Phường Phú Nhuận, TP. Hồ Chí Minh',
    latitude: 10.80304,
    longitude: 106.68962,
    radius_meters: 300,
    gps_enabled: true,
    min_staff: 1,
    max_staff: 20,
    manager_name: 'Ban Giám Đốc',
    status: 'ACTIVE',
  },
];

export const SHIFT_TEMPLATES: Record<string, ShiftTemplate> = {
  CA_1: {
    code: 'CA_1',
    name: 'Ca 1 (Sáng)',
    start_hour: 7,
    start_minute: 0,
    end_hour: 12,
    end_minute: 0,
    duration_hours: 5,
  },
  CA_2: {
    code: 'CA_2',
    name: 'Ca 2 (Chiều)',
    start_hour: 12,
    start_minute: 0,
    end_hour: 18,
    end_minute: 0,
    duration_hours: 6,
  },
  CA_3: {
    code: 'CA_3',
    name: 'Ca 3 (Tối)',
    start_hour: 18,
    start_minute: 0,
    end_hour: 23,
    end_minute: 0,
    duration_hours: 5,
  },
};

/**
 * Ca làm RIÊNG của khối Sale: chia 4 ca, mỗi ca 4 giờ.
 *   Ca 1: 07:00–11:00 · Ca 2: 11:00–15:00 · Ca 3: 15:00–19:00 · Ca 4: 19:00–23:00
 * Cửa hàng/Xưởng/Văn phòng vẫn dùng SHIFT_TEMPLATES (3 ca) như cũ.
 */
export const SALE_SHIFT_TEMPLATES: Record<string, ShiftTemplate> = {
  CA_1: {
    code: 'CA_1',
    name: 'Ca 1 (07:00–11:00)',
    start_hour: 7,
    start_minute: 0,
    end_hour: 11,
    end_minute: 0,
    duration_hours: 4,
  },
  CA_2: {
    code: 'CA_2',
    name: 'Ca 2 (11:00–15:00)',
    start_hour: 11,
    start_minute: 0,
    end_hour: 15,
    end_minute: 0,
    duration_hours: 4,
  },
  CA_3: {
    code: 'CA_3',
    name: 'Ca 3 (15:00–19:00)',
    start_hour: 15,
    start_minute: 0,
    end_hour: 19,
    end_minute: 0,
    duration_hours: 4,
  },
  CA_4: {
    code: 'CA_4',
    name: 'Ca 4 (19:00–23:00)',
    start_hour: 19,
    start_minute: 0,
    end_hour: 23,
    end_minute: 0,
    duration_hours: 4,
  },
};

/**
 * Bảng ca GỘP mọi khối (3 ca cửa hàng + CA_4 của Sale). Chỉ dùng khi cần nhận diện
 * một mã ca bất kỳ mà chưa biết khối (VD: đọc file Excel, seed bảng ca MOCK, hiển
 * thị lại dữ liệu cũ). Xếp ca/tính lương luôn dùng resolveShiftTemplate(code, group)
 * để khối cửa hàng/xưởng/văn phòng không chọn được CA_4.
 */
export const ALL_SHIFT_TEMPLATES: Record<string, ShiftTemplate> = {
  ...SALE_SHIFT_TEMPLATES,
  ...SHIFT_TEMPLATES,
};

/** Khối Sale / Marketing (group = SALE, MKT, SALES...). */export function isSaleGroup(group?: unknown): boolean {
  const g = String(group ?? '').trim().toUpperCase();
  if (!g) return false;
  return (
    g === 'SALE' ||
    g === 'SALES' ||
    g === 'MKT' ||
    g === 'MARKETING' ||
    g === 'SALES/MKT' ||
    g.includes('SALE') ||
    g.includes('MARKETING') ||
    g.includes('KINH DOANH') ||
    g.includes('BÁN HÀNG') ||
    g.includes('BAN HANG')
  );
}

/** Bộ ca làm theo khối: Sale = 4 ca (07–11, 11–15, 15–19, 19–23), còn lại = 3 ca cũ. */
export function shiftTemplatesForGroup(group?: unknown): Record<string, ShiftTemplate> {
  return isSaleGroup(group) ? SALE_SHIFT_TEMPLATES : SHIFT_TEMPLATES;
}

/** Mã ca hợp lệ theo khối (Sale có CA_4). */
export function shiftCodesForGroup(group?: unknown): ShiftCode[] {
  return Object.keys(shiftTemplatesForGroup(group)) as ShiftCode[];
}

/** Mẫu ca theo khối + mã ca; trả undefined nếu mã không thuộc khối đó. */
export function resolveShiftTemplate(code?: unknown, group?: unknown): ShiftTemplate | undefined {
  const c = String(code ?? '').trim().toUpperCase();
  if (!c) return undefined;
  return shiftTemplatesForGroup(group)[c];
}

/** "07:00–11:00" của một mã ca theo khối. */
export function shiftTimeLabel(code?: unknown, group?: unknown): string {
  const t = resolveShiftTemplate(code, group);
  if (!t) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(t.start_hour)}:${p(t.start_minute)}–${p(t.end_hour)}:${p(t.end_minute)}`;
}

/** "Ca 1 (07:00–11:00)" của một mã ca theo khối. */
export function shiftLabel(code?: unknown, group?: unknown): string {
  const c = String(code ?? '').trim().toUpperCase();
  if (!c) return '';
  const t = resolveShiftTemplate(c, group);
  const time = shiftTimeLabel(c, group);
  const num = c.replace(/^CA_/, '').replace(/^CA\s*/, '');
  if (t && time) return `Ca ${num} (${time})`;
  return c.replace('_', ' ');
}


export const STANDARD_HOURLY_RATES = {
  PROBATION: 21000,
  OFFICIAL: 25500,
};

export const ERROR_CODES = {
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  DUPLICATE_PHONE_NEEDS_HR: 'DUPLICATE_PHONE_NEEDS_HR',
  EMPLOYMENT_NOT_ELIGIBLE: 'EMPLOYMENT_NOT_ELIGIBLE',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  BRANCH_SCOPE_VIOLATION: 'BRANCH_SCOPE_VIOLATION',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  NEEDS_RECONCILIATION: 'NEEDS_RECONCILIATION',
  SHEETS_UNAVAILABLE: 'SHEETS_UNAVAILABLE',
  GPS_OUT_OF_BOUNDS: 'GPS_OUT_OF_BOUNDS',
  GPS_ACCURACY_LOW: 'GPS_ACCURACY_LOW',
  CAMERA_REQUIRED: 'CAMERA_REQUIRED',
  SHIFT_NOT_FOUND: 'SHIFT_NOT_FOUND',
  ATTENDANCE_ALREADY_RECORDED: 'ATTENDANCE_ALREADY_RECORDED',
  SEPARATION_OF_DUTIES_VIOLATION: 'SEPARATION_OF_DUTIES_VIOLATION',
  WEEKLY_OFF_REGISTRATION_REQUIRED: 'WEEKLY_OFF_REGISTRATION_REQUIRED',
  WEEKLY_OFF_WINDOW_CLOSED: 'WEEKLY_OFF_WINDOW_CLOSED',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
