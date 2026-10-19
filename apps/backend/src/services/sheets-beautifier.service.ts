import { sheets_v4 } from 'googleapis';

export interface SheetDefinition {
  title: string;
  headers: string[];
}

export interface TabTheme {
  category: string;
  tabColor: { red: number; green: number; blue: number };
  headerBg: { red: number; green: number; blue: number };
  headerFg: { red: number; green: number; blue: number };
  bandColor?: { red: number; green: number; blue: number };
}

/**
 * Bảng màu nhận diện thương hiệu Ụm Bò Milk cao cấp:
 * Phân loại theo 6 nhóm nghiệp vụ chính để quản trị viên / HR dễ dàng phân biệt trên Google Sheets.
 */
export const TAB_THEMES: Record<string, TabTheme> = {
  // 1. Nhóm Nhân sự & Hồ sơ (Xanh Lục Bảo Emerald)
  NHAN_VIEN_MASTER: {
    category: 'Nhân sự & Hồ sơ',
    tabColor: { red: 0.02, green: 0.47, blue: 0.34 },
    headerBg: { red: 0.02, green: 0.31, blue: 0.23 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },
  TAI_KHOAN_NHAN_VIEN: {
    category: 'Nhân sự & Hồ sơ',
    tabColor: { red: 0.05, green: 0.58, blue: 0.42 },
    headerBg: { red: 0.02, green: 0.31, blue: 0.23 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },
  LICH_SU_GIAI_DOAN: {
    category: 'Nhân sự & Hồ sơ',
    tabColor: { red: 0.10, green: 0.65, blue: 0.48 },
    headerBg: { red: 0.02, green: 0.31, blue: 0.23 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },

  // 2. Nhóm Vận hành & Điểm danh (Xanh Dương Sapphire)
  PHAN_CONG_CA: {
    category: 'Vận hành & Điểm danh',
    tabColor: { red: 0.15, green: 0.39, blue: 0.92 },
    headerBg: { red: 0.12, green: 0.23, blue: 0.54 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },
  SU_KIEN_DIEM_DANH: {
    category: 'Vận hành & Điểm danh',
    tabColor: { red: 0.12, green: 0.31, blue: 0.75 },
    headerBg: { red: 0.12, green: 0.23, blue: 0.54 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },
  LUUTRU_CHAMCONG_TUAN: {
    category: 'Vận hành & Điểm danh',
    tabColor: { red: 0.25, green: 0.45, blue: 0.85 },
    headerBg: { red: 0.12, green: 0.23, blue: 0.54 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },

  // 3. Nhóm Đơn từ & Phê duyệt (Cam Hổ Phách Amber)
  DON_NGHI_PHEP: {
    category: 'Đơn từ & Phê duyệt',
    tabColor: { red: 0.92, green: 0.53, blue: 0.05 },
    headerBg: { red: 0.47, green: 0.21, blue: 0.06 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },
  DON_DOI_CA: {
    category: 'Đơn từ & Phê duyệt',
    tabColor: { red: 0.85, green: 0.48, blue: 0.04 },
    headerBg: { red: 0.47, green: 0.21, blue: 0.06 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },
  DIEU_CHINH_CONG: {
    category: 'Đơn từ & Phê duyệt',
    tabColor: { red: 0.78, green: 0.42, blue: 0.03 },
    headerBg: { red: 0.47, green: 0.21, blue: 0.06 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },

  // 4. Nhóm Tài chính & Tiền lương (Tím Hoàng Gia Violet)
  KY_LUONG: {
    category: 'Tài chính & Tiền lương',
    tabColor: { red: 0.48, green: 0.23, blue: 0.85 },
    headerBg: { red: 0.30, green: 0.11, blue: 0.58 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },
  PHIEU_LUONG: {
    category: 'Tài chính & Tiền lương',
    tabColor: { red: 0.55, green: 0.30, blue: 0.90 },
    headerBg: { red: 0.30, green: 0.11, blue: 0.58 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },
  CONG_THUC_LUONG: {
    category: 'Tài chính & Tiền lương',
    tabColor: { red: 0.42, green: 0.18, blue: 0.78 },
    headerBg: { red: 0.30, green: 0.11, blue: 0.58 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },
  DULIEU_LUONG_KY: {
    category: 'Tài chính & Tiền lương',
    tabColor: { red: 0.60, green: 0.35, blue: 0.95 },
    headerBg: { red: 0.30, green: 0.11, blue: 0.58 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },

  // 5. Nhóm Tuyển dụng & Đào tạo (Hồng Sen Rose)
  FROM_NHAN_VIEN: {
    category: 'Tuyển dụng & Đào tạo',
    tabColor: { red: 0.86, green: 0.17, blue: 0.45 },
    headerBg: { red: 0.51, green: 0.09, blue: 0.26 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },
  BAI_THI: {
    category: 'Tuyển dụng & Đào tạo',
    tabColor: { red: 0.92, green: 0.28, blue: 0.55 },
    headerBg: { red: 0.51, green: 0.09, blue: 0.26 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },
  BAI_LAM: {
    category: 'Tuyển dụng & Đào tạo',
    tabColor: { red: 0.95, green: 0.38, blue: 0.65 },
    headerBg: { red: 0.51, green: 0.09, blue: 0.26 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },

  // 6. Nhóm Quản trị & Hệ thống (Xám Than Slate)
  ADMIN_ACCOUNTS: {
    category: 'Hệ thống & Giám sát',
    tabColor: { red: 0.28, green: 0.33, blue: 0.41 },
    headerBg: { red: 0.06, green: 0.09, blue: 0.16 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },
  DANH_SACH_CHI_NHANH: {
    category: 'Hệ thống & Giám sát',
    tabColor: { red: 0.25, green: 0.30, blue: 0.40 },
    headerBg: { red: 0.06, green: 0.09, blue: 0.16 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },
  AUDIT_LOG: {
    category: 'Hệ thống & Giám sát',
    tabColor: { red: 0.20, green: 0.25, blue: 0.35 },
    headerBg: { red: 0.06, green: 0.09, blue: 0.16 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },
  CAU_HINH_HE_THONG: {
    category: 'Hệ thống & Giám sát',
    tabColor: { red: 0.35, green: 0.40, blue: 0.50 },
    headerBg: { red: 0.06, green: 0.09, blue: 0.16 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },
  THONGBAO_NV: {
    category: 'Hệ thống & Giám sát',
    tabColor: { red: 0.40, green: 0.45, blue: 0.55 },
    headerBg: { red: 0.06, green: 0.09, blue: 0.16 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },
  THONGBAO_GUI: {
    // Thông báo đã gửi (outbox MKT) — nhóm Hệ thống & Giám sát, màu xanh nhạt riêng.
    category: 'Hệ thống & Giám sát',
    tabColor: { red: 0.42, green: 0.49, blue: 0.60 },
    headerBg: { red: 0.06, green: 0.09, blue: 0.16 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },
  SNAPSHOT_SAOLUU: {
    //Metadata snapshot Sao lưu & Phục hồi — nhóm Hệ thống & Giám sát.
    category: 'Hệ thống & Giám sát',
    tabColor: { red: 0.45, green: 0.50, blue: 0.62 },
    headerBg: { red: 0.06, green: 0.09, blue: 0.16 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },
};

export function resolveTheme(title: string): TabTheme {
  if (TAB_THEMES[title]) return TAB_THEMES[title];
  const upper = (title || '').toUpperCase();
  if (upper.includes('NHAN_VIEN') || upper.includes('EMPLOYEE')) {
    return {
      category: 'Nhân sự & Hồ sơ',
      tabColor: { red: 0.02, green: 0.47, blue: 0.34 },
      headerBg: { red: 0.02, green: 0.31, blue: 0.23 },
      headerFg: { red: 1, green: 1, blue: 1 },
      bandColor: { red: 0.95, green: 0.98, blue: 0.96 },
    };
  }
  if (upper.includes('CA_') || upper.includes('DIEM_DANH') || upper.includes('CHAM_CONG') || upper.includes('LICH_LAM')) {
    return {
      category: 'Vận hành & Chấm công',
      tabColor: { red: 0.15, green: 0.39, blue: 0.92 },
      headerBg: { red: 0.12, green: 0.23, blue: 0.54 },
      headerFg: { red: 1, green: 1, blue: 1 },
      bandColor: { red: 0.94, green: 0.97, blue: 1.00 },
    };
  }
  if (upper.includes('PHIEU_') || upper.includes('DON_') || upper.includes('NGHI_TUAN') || upper.includes('LICH_TUAN') || upper.includes('DOI_CA') || upper.includes('DOI_THIET_BI') || upper.includes('DIEU_CHINH')) {
    return {
      category: 'Đơn từ & Phê duyệt',
      tabColor: { red: 0.85, green: 0.47, blue: 0.02 },
      headerBg: { red: 0.47, green: 0.21, blue: 0.06 },
      headerFg: { red: 1, green: 1, blue: 1 },
      bandColor: { red: 1.00, green: 0.98, blue: 0.93 },
    };
  }
  if (upper.includes('LUONG') || upper.includes('PAYROLL') || upper.includes('THU_NHAP')) {
    return {
      category: 'Tiền lương & Thu nhập',
      tabColor: { red: 0.49, green: 0.23, blue: 0.93 },
      headerBg: { red: 0.30, green: 0.11, blue: 0.58 },
      headerFg: { red: 1, green: 1, blue: 1 },
      bandColor: { red: 0.97, green: 0.95, blue: 1.00 },
    };
  }
  if (upper.includes('UNG_VIEN') || upper.includes('PHONG_VAN') || upper.includes('TEST') || upper.includes('TUYEN_DUNG') || upper.includes('THI') || upper.includes('BAI_LAM')) {
    return {
      category: 'Tuyển dụng & Đào tạo',
      tabColor: { red: 0.86, green: 0.15, blue: 0.47 },
      headerBg: { red: 0.51, green: 0.09, blue: 0.26 },
      headerFg: { red: 1, green: 1, blue: 1 },
      bandColor: { red: 1.00, green: 0.95, blue: 0.97 },
    };
  }
  if (upper.includes('LOG') || upper.includes('ADMIN') || upper.includes('THONGBAO') || upper.includes('ZALO') || upper.includes('SAOLUU') || upper.includes('CHI_NHANH') || upper.includes('HE_THONG')) {
    return {
      category: 'Hệ thống & Giám sát',
      tabColor: { red: 0.28, green: 0.33, blue: 0.41 },
      headerBg: { red: 0.06, green: 0.09, blue: 0.16 },
      headerFg: { red: 1, green: 1, blue: 1 },
      bandColor: { red: 0.96, green: 0.97, blue: 0.98 },
    };
  }
  return {
    category: 'Chung',
    tabColor: { red: 0.3, green: 0.35, blue: 0.45 },
    headerBg: { red: 0.08, green: 0.12, blue: 0.20 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 0.97, green: 0.98, blue: 0.99 },
  };
}

export interface ColumnStyle {
  width: number;
  horizontalAlignment: 'LEFT' | 'CENTER' | 'RIGHT';
  numberFormat?: {
    type: 'NUMBER' | 'DATE' | 'TIME' | 'TEXT' | 'PERCENT';
    pattern?: string;
  };
  wrapStrategy?: 'WRAP' | 'CLIP' | 'OVERFLOW_CELL';
  isStatus?: boolean;
}

/**
 * Phân tích và tự động xác định phong cách định dạng của một cột dựa vào tên tiêu đề:
 */
export function getColumnStyle(header: string, sampleValues: any[] = []): ColumnStyle {
  const h = header.trim();
  const lower = h.toLowerCase();

  // Tìm độ dài chuỗi dài nhất trong các mẫu dữ liệu (loại bỏ dữ liệu rác/base64 ngoại lệ)
  let maxDataLen = 0;
  for (const v of sampleValues) {
    if (v !== undefined && v !== null) {
      const str = String(v).trim();
      if (!str.startsWith('data:image') && !str.startsWith('{') && str.length < 500) {
        if (str.length > maxDataLen) maxDataLen = str.length;
      }
    }
  }

  // 1. Dữ liệu đặc biệt: Base64 / Ảnh / Password -> Cố định ngắn & Clip
  if (
    lower.includes('base64') ||
    lower.includes('mật khẩu') ||
    lower.includes('ảnh ký') ||
    lower.includes('password')
  ) {
    return {
      width: 110,
      horizontalAlignment: 'CENTER',
      wrapStrategy: 'CLIP',
      numberFormat: { type: 'TEXT' },
    };
  }

  // 2. Drive ID / Avatar Drive
  if (
    lower.includes('drive id') ||
    lower.includes('drive object') ||
    lower.includes('ảnh bằng chứng') ||
    lower.includes('avatar')
  ) {
    return {
      width: 140,
      horizontalAlignment: 'CENTER',
      wrapStrategy: 'CLIP',
      numberFormat: { type: 'TEXT' },
    };
  }

  // 3. JSON columns
  if (lower.includes('(json)') || lower.includes('json')) {
    return {
      width: 180,
      horizontalAlignment: 'LEFT',
      wrapStrategy: 'CLIP',
      numberFormat: { type: 'TEXT' },
    };
  }

  // 4. Nội dung văn bản dài: Địa chỉ, Lý do, Ghi chú, Nội dung, Chi tiết, Mô tả -> Căn trái, Wrap
  if (
    lower.includes('địa chỉ') ||
    lower.includes('lý do') ||
    lower.includes('ghi chú') ||
    lower.includes('nội dung') ||
    lower.includes('chi tiết') ||
    lower.includes('mô tả') ||
    lower.includes('kinh nghiệm') ||
    lower.includes('quê quán') ||
    lower.includes('tiêu chí')
  ) {
    const calcW = Math.min(320, Math.max(260, Math.ceil(h.length * 9.5) + 40));
    return {
      width: calcW,
      horizontalAlignment: 'LEFT',
      wrapStrategy: 'WRAP',
    };
  }

  // 5. Tiền tệ (VNĐ, Lương, Phụ cấp, Thưởng, Khấu trừ, v.v.)
  // LƯU Ý QUAN TRỌNG: Loại trừ 'Mã Kỳ Lương' và 'Kỳ Lương' (đây là ID/tháng, không phải số tiền!)
  const isExcludedFromCurrency = lower.includes('mã kỳ lương') || lower === 'kỳ lương';
  if (
    !isExcludedFromCurrency &&
    (
      lower.includes('(vnđ)') ||
      lower.includes('lương chuẩn') ||
      lower.includes('lương cơ bản') ||
      lower.includes('lương giờ') ||
      lower.includes('phụ cấp') ||
      lower.includes('thưởng') ||
      lower.includes('khấu trừ') ||
      lower.includes('thực nhận') ||
      lower.includes('thực lãnh') ||
      lower.includes('tổng lương') ||
      lower.includes('tổng tiền') ||
      lower.includes('tổng cộng') ||
      lower.includes('đơn giá') ||
      lower.includes('phạt (đ)') ||
      lower.includes('(đ)') ||
      lower.includes('ứng lương') ||
      lower.includes('trừ kpi') ||
      lower.includes('trừ đồng phục') ||
      lower.includes('bonus thêm') ||
      lower.includes('lương cb (tay)')
    )
  ) {
    const calcW = Math.max(130, Math.ceil(h.length * 9.5) + 44, Math.ceil(maxDataLen * 8.2) + 24);
    return {
      width: Math.min(160, calcW),
      horizontalAlignment: 'RIGHT',
      wrapStrategy: 'CLIP',
      numberFormat: { type: 'NUMBER', pattern: '#,##0 "đ"' },
    };
  }

  // 6. Tỷ lệ %
  if (lower.includes('(%)') || lower.includes('tỷ lệ') || lower.includes('phần trăm')) {
    return {
      width: Math.max(110, Math.ceil(h.length * 9.5) + 44),
      horizontalAlignment: 'RIGHT',
      wrapStrategy: 'CLIP',
      numberFormat: { type: 'NUMBER', pattern: '0.0%' },
    };
  }

  // 7. Số đếm / Điểm / Số ca / Số phút / Khoảng cách / Bán kính / Phiên bản
  if (
    lower.includes('điểm') ||
    lower.includes('số ca') ||
    lower.includes('ca vắng') ||
    lower.includes('suất ot') ||
    lower.includes('số phút') ||
    lower.includes('khoảng cách') ||
    lower.includes('bán kính') ||
    lower.includes('phiên bản') ||
    lower.includes('tuần lưu trữ') ||
    lower.includes('phạt (nấc)') ||
    lower.includes('lệch (phút)')
  ) {
    const calcW = Math.max(105, Math.ceil(h.length * 9.5) + 44);
    return {
      width: Math.min(140, calcW),
      horizontalAlignment: 'RIGHT',
      wrapStrategy: 'CLIP',
      numberFormat: { type: 'NUMBER', pattern: '#,##0' },
    };
  }

  // 8. Số giờ làm việc / Ngưỡng OT (thập phân)
  if (lower.includes('giờ chuẩn') || lower.includes('ngưỡng ot')) {
    const calcW = Math.max(115, Math.ceil(h.length * 9.5) + 44);
    return {
      width: Math.min(140, calcW),
      horizontalAlignment: 'RIGHT',
      wrapStrategy: 'CLIP',
      numberFormat: { type: 'NUMBER', pattern: '#,##0.0' },
    };
  }

  // 9. Tọa độ GPS (Vĩ độ, Kinh độ)
  if (lower.includes('vĩ độ') || lower.includes('kinh độ')) {
    return {
      width: Math.max(115, Math.ceil(h.length * 9.5) + 44),
      horizontalAlignment: 'RIGHT',
      wrapStrategy: 'CLIP',
    };
  }

  // 10. Ngày tháng (yyyy-mm-dd, Ngày sinh, Ngày bắt đầu, v.v.)
  if (
    lower.includes('ngày') ||
    lower.includes('tháng/năm') ||
    lower.includes('(yyyy-mm-dd)') ||
    lower.includes('hiệu lực từ')
  ) {
    const calcW = Math.max(120, Math.ceil(h.length * 9.5) + 44);
    return {
      width: Math.min(150, calcW),
      horizontalAlignment: 'CENTER',
      wrapStrategy: 'CLIP',
      numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' },
    };
  }

  // 11. Giờ giấc / Thời gian / Datetime
  if (
    lower.includes('thời gian') ||
    lower.includes('giờ máy') ||
    lower.includes('bắt đầu') ||
    lower.includes('kết thúc') ||
    lower.includes('lúc gửi') ||
    lower.includes('lúc tạo') ||
    lower.includes('lúc chốt') ||
    lower.includes('lúc phát hành') ||
    lower.includes('lúc xác nhận') ||
    lower.includes('lúc chi trả') ||
    lower.includes('ký lập lúc') ||
    lower.includes('ký ql lúc') ||
    lower.includes('ký nv lúc') ||
    lower.includes('cập nhật lúc')
  ) {
    const calcW = Math.max(150, Math.ceil(h.length * 9.5) + 44, Math.ceil(maxDataLen * 8.2) + 24);
    return {
      width: Math.min(185, calcW),
      horizontalAlignment: 'CENTER',
      wrapStrategy: 'CLIP',
    };
  }

  // 12. Mã ID / SĐT / CCCD / Số tài khoản / Kỳ lương
  if (
    lower.includes('mã ') ||
    lower.includes('id ') ||
    lower.startsWith('id') ||
    lower.includes('số điện thoại') ||
    lower.includes('sđt') ||
    lower.includes('cccd') ||
    lower.includes('số tài khoản') ||
    lower.includes('stk') ||
    lower === 'kỳ lương' ||
    lower.includes('mã kỳ lương')
  ) {
    const isLongId =
      lower.includes('phiếu') ||
      lower.includes('yêu cầu') ||
      lower.includes('ca làm') ||
      lower.includes('sự kiện') ||
      lower.includes('inbox') ||
      lower.includes('thông báo') ||
      lower.includes('giai đoạn') ||
      maxDataLen > 25;

    const calcW = isLongId
      ? Math.max(220, Math.ceil(h.length * 9.5) + 44, Math.ceil(maxDataLen * 7.8) + 24)
      : Math.max(125, Math.ceil(h.length * 9.5) + 44, Math.ceil(maxDataLen * 8.0) + 24);

    return {
      width: Math.min(300, calcW),
      horizontalAlignment: 'CENTER',
      wrapStrategy: 'CLIP',
      numberFormat: { type: 'TEXT' },
    };
  }

  // 13. Trạng thái / Phê duyệt / Loại / Vai trò / Giai đoạn (Status Pills)
  if (
    lower.includes('trạng thái') ||
    lower.includes('giai đoạn') ||
    lower.includes('loại ') ||
    lower.includes('kết quả') ||
    lower.includes('vai trò') ||
    lower.includes('nhóm') ||
    lower.includes('giới tính') ||
    lower.includes('vip') ||
    lower.includes('(in/out)') ||
    lower.includes('đạt') ||
    lower.includes('mức độ') ||
    lower.includes('đã đọc') ||
    lower.includes('bắt buộc đổi pin')
  ) {
    const calcW = Math.max(120, Math.ceil(h.length * 9.5) + 44, Math.ceil(maxDataLen * 8.2) + 24);
    return {
      width: Math.min(150, calcW),
      horizontalAlignment: 'CENTER',
      wrapStrategy: 'CLIP',
      isStatus: true,
    };
  }

  // 14. Họ Và Tên / Tên Chi Nhánh / Chủ Tài Khoản / Người Duyệt
  if (
    lower.includes('họ và tên') ||
    lower.includes('họ tên') ||
    lower.includes('chủ tài khoản') ||
    lower.includes('tên chi nhánh') ||
    lower.includes('người duyệt') ||
    lower.includes('người tạo') ||
    lower.includes('người thực hiện') ||
    lower.includes('người pv') ||
    lower.includes('người nhận') ||
    lower.includes('ký lập (tên)') ||
    lower.includes('ký ql (tên)') ||
    lower.includes('ký nv (tên)')
  ) {
    const calcW = Math.max(190, Math.ceil(h.length * 9.5) + 44, Math.ceil(maxDataLen * 8.2) + 24);
    return {
      width: Math.min(250, calcW),
      horizontalAlignment: 'LEFT',
      wrapStrategy: 'CLIP',
    };
  }

  // 15. Mặc định cho cột text thông thường
  const calcW = Math.max(130, Math.ceil(h.length * 9.5) + 44, Math.ceil(maxDataLen * 8.0) + 24);
  return {
    width: Math.min(220, calcW),
    horizontalAlignment: 'LEFT',
    wrapStrategy: 'CLIP',
  };
}

/**
 * Tạo danh sách các Google Sheets API Requests để làm đẹp toàn diện một tab
 */
export function buildSheetFormattingRequests(
  sheetId: number,
  sheetDef: SheetDefinition,
  theme: TabTheme
): sheets_v4.Schema$Request[] {
  const requests: sheets_v4.Schema$Request[] = [];
  const colCount = sheetDef.headers.length;

  // 1. Cập nhật thuộc tính Tab: Đặt màu Tab + Đóng băng hàng 1 + Bật lưới ô
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        tabColorStyle: {
          rgbColor: theme.tabColor,
        },
        gridProperties: {
          frozenRowCount: 1,
          hideGridlines: false,
        },
      },
      fields: 'tabColorStyle,gridProperties.frozenRowCount,gridProperties.hideGridlines',
    },
  });

  // 2. Chiều cao hàng tiêu chuẩn cao cấp:
  // - Header (Row 0): 38px
  // - Data rows (Rows 1..500): 28px
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: 'ROWS',
        startIndex: 0,
        endIndex: 1,
      },
      properties: {
        pixelSize: 38,
      },
      fields: 'pixelSize',
    },
  });
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: 'ROWS',
        startIndex: 1,
        endIndex: 500,
      },
      properties: {
        pixelSize: 28,
      },
      fields: 'pixelSize',
    },
  });

  // 3. Header styling (Roboto, Bold, 10pt, Chữ trắng, Căn giữa dọc và ngang, Wrap)
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: colCount,
      },
      cell: {
        userEnteredFormat: {
          backgroundColorStyle: {
            rgbColor: theme.headerBg,
          },
          textFormat: {
            foregroundColorStyle: {
              rgbColor: theme.headerFg,
            },
            fontFamily: 'Roboto',
            fontSize: 10,
            bold: true,
          },
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'WRAP',
        },
      },
      fields: 'userEnteredFormat(backgroundColorStyle,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
    },
  });

  // 4. Viền bảng: Chân Header nét vừa SOLID_MEDIUM, lưới dữ liệu kẻ nét thanh tinh tế #E2E8F0
  requests.push({
    updateBorders: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: colCount,
      },
      bottom: {
        style: 'SOLID_MEDIUM',
        colorStyle: {
          rgbColor: { red: 0.39, green: 0.45, blue: 0.55 },
        },
      },
    },
  });
  requests.push({
    updateBorders: {
      range: {
        sheetId,
        startRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: colCount,
      },
      innerHorizontal: {
        style: 'SOLID',
        colorStyle: { rgbColor: { red: 0.89, green: 0.91, blue: 0.94 } },
      },
      innerVertical: {
        style: 'SOLID',
        colorStyle: { rgbColor: { red: 0.92, green: 0.94, blue: 0.96 } },
      },
    },
  });

  // 5. Định dạng từng cột dữ liệu + Tối ưu độ rộng chuẩn
  sheetDef.headers.forEach((header, colIdx) => {
    const style = getColumnStyle(header);

    // 5a. Độ rộng chuẩn
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: colIdx,
          endIndex: colIdx + 1,
        },
        properties: {
          pixelSize: style.width,
        },
        fields: 'pixelSize',
      },
    });

    // 5b. Định dạng ô dữ liệu các dòng bên dưới (áp dụng toàn bộ cột)
    const format: any = {
      horizontalAlignment: style.horizontalAlignment,
      verticalAlignment: 'MIDDLE',
      wrapStrategy: style.wrapStrategy || 'CLIP',
      textFormat: {
        fontFamily: 'Roboto',
        fontSize: 10,
        foregroundColorStyle: { rgbColor: { red: 0.12, green: 0.16, blue: 0.23 } },
      },
    };

    let fields = 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)';

    if (style.numberFormat) {
      format.numberFormat = style.numberFormat;
      fields += ',userEnteredFormat.numberFormat';
    }

    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: colIdx,
          endColumnIndex: colIdx + 1,
        },
        cell: {
          userEnteredFormat: format,
        },
        fields,
      },
    });

    // 5c. Định dạng có điều kiện (Status Pills) cho các cột Trạng thái
    if (style.isStatus) {
      // Màu XANH LÁ (Thành công / Hoạt động / Đạt / Check-in)
      const greenKeywords = [
        'ACTIVE', 'OFFICIAL', 'CHÍNH THỨC', 'APPROVED', 'DUYỆT', 'ĐÃ DUYỆT',
        'IN', 'CHECK_IN', 'ĐẠT', 'ĐÃ CHI TRẢ', 'YES', 'TRUE', 'PASS', 'HIRED', 'ĐÃ CHỐT', 'VALID'
      ];
      greenKeywords.forEach(keyword => {
        requests.push({
          addConditionalFormatRule: {
            rule: {
              ranges: [{
                sheetId,
                startRowIndex: 1,
                startColumnIndex: colIdx,
                endColumnIndex: colIdx + 1,
              }],
              booleanRule: {
                condition: {
                  type: 'TEXT_EQ',
                  values: [{ userEnteredValue: keyword }],
                },
                format: {
                  backgroundColorStyle: {
                    rgbColor: { red: 0.87, green: 0.97, blue: 0.93 },
                  },
                  textFormat: {
                    foregroundColorStyle: {
                      rgbColor: { red: 0.01, green: 0.33, blue: 0.25 },
                    },
                    bold: true,
                  },
                },
              },
            },
            index: 0,
          },
        });
      });

      // Màu ĐỎ (Ngừng / Từ chối / Không đạt / Check-out / Vắng)
      const redKeywords = [
        'INACTIVE', 'REJECTED', 'TỪ CHỐI', 'OUT', 'CHECK_OUT', 'KHÔNG ĐẠT',
        'BỊ KHÓA', 'RESIGNED', 'NO', 'FALSE', 'INVALID', 'VẮNG', 'LATE', 'TRỄ', 'FAIL'
      ];
      redKeywords.forEach(keyword => {
        requests.push({
          addConditionalFormatRule: {
            rule: {
              ranges: [{
                sheetId,
                startRowIndex: 1,
                startColumnIndex: colIdx,
                endColumnIndex: colIdx + 1,
              }],
              booleanRule: {
                condition: {
                  type: 'TEXT_EQ',
                  values: [{ userEnteredValue: keyword }],
                },
                format: {
                  backgroundColorStyle: {
                    rgbColor: { red: 0.99, green: 0.91, blue: 0.91 },
                  },
                  textFormat: {
                    foregroundColorStyle: {
                      rgbColor: { red: 0.61, green: 0.11, blue: 0.11 },
                    },
                    bold: true,
                  },
                },
              },
            },
            index: 0,
          },
        });
      });

      // Màu VÀNG CAM (Chờ duyệt / Nháp / Thử việc / Chờ PV)
      const amberKeywords = [
        'PENDING', 'CHỜ DUYỆT', 'DRAFT', 'THỬ VIỆC', 'PROBATION', 'CHƯA DUYỆT', 'CHỜ PV', 'ASSIGNED'
      ];
      amberKeywords.forEach(keyword => {
        requests.push({
          addConditionalFormatRule: {
            rule: {
              ranges: [{
                sheetId,
                startRowIndex: 1,
                startColumnIndex: colIdx,
                endColumnIndex: colIdx + 1,
              }],
              booleanRule: {
                condition: {
                  type: 'TEXT_EQ',
                  values: [{ userEnteredValue: keyword }],
                },
                format: {
                  backgroundColorStyle: {
                    rgbColor: { red: 1.00, green: 0.95, blue: 0.78 },
                  },
                  textFormat: {
                    foregroundColorStyle: {
                      rgbColor: { red: 0.57, green: 0.25, blue: 0.05 },
                    },
                    bold: true,
                  },
                },
              },
            },
            index: 0,
          },
        });
      });

      // Màu XANH DƯƠNG / CHÀM (VIP / Quản trị / HR / Đã gửi)
      const blueKeywords = [
        'VIP', 'ADMIN', 'HR', 'FINANCE', 'MANAGER', 'SENT', 'ĐÃ GỬI', 'SCHEDULED', 'SYSTEM', 'STORE'
      ];
      blueKeywords.forEach(keyword => {
        requests.push({
          addConditionalFormatRule: {
            rule: {
              ranges: [{
                sheetId,
                startRowIndex: 1,
                startColumnIndex: colIdx,
                endColumnIndex: colIdx + 1,
              }],
              booleanRule: {
                condition: {
                  type: 'TEXT_EQ',
                  values: [{ userEnteredValue: keyword }],
                },
                format: {
                  backgroundColorStyle: {
                    rgbColor: { red: 0.88, green: 0.91, blue: 1.00 },
                  },
                  textFormat: {
                    foregroundColorStyle: {
                      rgbColor: { red: 0.22, green: 0.19, blue: 0.64 },
                    },
                    bold: true,
                  },
                },
              },
            },
            index: 0,
          },
        });
      });
    }
  });

  // 6. Sọc xen kẽ (Alternating Row Banding) cho toàn bộ sheet
  if (theme.bandColor) {
    requests.push({
      addBanding: {
        bandedRange: {
          range: {
            sheetId,
            startRowIndex: 0,
            startColumnIndex: 0,
            endColumnIndex: colCount,
          },
          rowProperties: {
            headerColorStyle: { rgbColor: theme.headerBg },
            firstBandColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
            secondBandColorStyle: { rgbColor: theme.bandColor },
          },
        },
      },
    });
  }

  // 7. Bộ lọc dữ liệu tự động (Basic Filter dropdown) trên dòng 1
  requests.push({
    setBasicFilter: {
      filter: {
        range: {
          sheetId,
          startRowIndex: 0,
          startColumnIndex: 0,
          endColumnIndex: colCount,
        },
      },
    },
  });

  return requests;
}
