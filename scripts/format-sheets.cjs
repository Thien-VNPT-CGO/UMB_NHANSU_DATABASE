#!/usr/bin/env node
/**
 * Script làm đẹp và chuẩn hóa toàn diện giao diện Google Sheets Master cho Ụm Bò Milk.
 * - Phân nhóm màu sắc Tab trực quan theo nghiệp vụ (Nhân sự, Vận hành, Đơn từ, Tiền lương, Tuyển dụng, Hệ thống).
 * - Dòng tiêu đề cao thoáng (38px), nền màu thương hiệu sang trọng, chữ trắng in đậm, căn giữa dọc-ngang.
 * - Cố định hàng đầu (frozenRowCount: 1) và bật đường lưới ô (hideGridlines: false).
 * - Tự động căn chỉnh lề (Horizontal: LEFT cho text/tên, CENTER cho ID/SĐT/ngày/trạng thái, RIGHT cho tiền/số).
 * - Căn giữa chiều dọc (Vertical: MIDDLE) cho tất cả các ô giúp nội dung cân đối hoàn hảo.
 * - Tính toán độ rộng cột thông minh theo dữ liệu thực tế + khoảng đệm nút lọc (không bị cụt chữ hay tràn quá mức).
 * - Định dạng số tiền tệ (#,##0 "đ"), ngày tháng (yyyy-mm-dd), text ID/SĐT chuẩn (bảo toàn số 0 đầu).
 * - Tô màu thông minh (Conditional Formatting) dạng Status Pill cho tất cả trạng thái.
 * - Sọc xen kẽ (Zebra Striping / Banding) màu pastel tinh tế theo từng phân hệ.
 * - Tích hợp bộ lọc tự động (Basic Filter dropdown) trên dòng 1.
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

// Đọc .env từ apps/backend/.env hoặc .env ở thư mục gốc nếu có
const possibleEnvPaths = [
  path.resolve(__dirname, '../apps/backend/.env'),
  path.resolve(__dirname, '../.env'),
];
for (const p of possibleEnvPaths) {
  if (fs.existsSync(p)) {
    const envContent = fs.readFileSync(p, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    });
  }
}

// Nếu chưa có env, tự động tìm file key.json ở thư mục dự án hoặc Downloads
if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
  const candidateKeys = [
    path.resolve(__dirname, '../key.json'),
    path.resolve(__dirname, '../service-account.json'),
    path.resolve(__dirname, '../apps/backend/key.json'),
  ];

  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  if (homeDir) {
    const downloadsDir = path.join(homeDir, 'Downloads');
    if (fs.existsSync(downloadsDir)) {
      try {
        const dlFiles = fs.readdirSync(downloadsDir);
        for (const f of dlFiles) {
          if ((f.startsWith('umbomilk-hr') || f.includes('service_account') || f.includes('service-account')) && f.endsWith('.json')) {
            candidateKeys.push(path.join(downloadsDir, f));
          }
        }
      } catch {}
    }
  }

  for (const kPath of candidateKeys) {
    if (fs.existsSync(kPath)) {
      try {
        const content = fs.readFileSync(kPath, 'utf8');
        const parsed = JSON.parse(content);
        if (parsed.client_email && (parsed.private_key || parsed.type === 'service_account')) {
          process.env.GOOGLE_SERVICE_ACCOUNT_JSON = content;
          console.log(`[format-sheets] 🔑 Tự động nạp khóa Service Account từ: ${path.basename(kPath)}`);
          break;
        }
      } catch {}
    }
  }
}

// Bảng màu nhận diện thương hiệu Ụm Bò Milk cao cấp theo 6 nhóm nghiệp vụ
const TAB_THEMES = {
  // 1. Nhóm Nhân sự & Hồ sơ (Xanh Lục Bảo Emerald)
  NHAN_VIEN_MASTER: {
    category: 'Nhân sự & Hồ sơ',
    tabColor: { red: 0.02, green: 0.47, blue: 0.34 },
    headerBg: { red: 0.02, green: 0.31, blue: 0.23 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 0.95, green: 0.98, blue: 0.96 },
  },
  TAI_KHOAN_NHAN_VIEN: {
    category: 'Nhân sự & Hồ sơ',
    tabColor: { red: 0.05, green: 0.58, blue: 0.42 },
    headerBg: { red: 0.02, green: 0.31, blue: 0.23 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 0.95, green: 0.98, blue: 0.96 },
  },
  LICH_SU_GIAI_DOAN: {
    category: 'Nhân sự & Hồ sơ',
    tabColor: { red: 0.10, green: 0.65, blue: 0.48 },
    headerBg: { red: 0.02, green: 0.31, blue: 0.23 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 0.95, green: 0.98, blue: 0.96 },
  },

  // 2. Nhóm Vận hành & Điểm danh (Xanh Dương Sapphire)
  PHAN_CONG_CA: {
    category: 'Vận hành & Điểm danh',
    tabColor: { red: 0.15, green: 0.39, blue: 0.92 },
    headerBg: { red: 0.12, green: 0.23, blue: 0.54 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 0.94, green: 0.97, blue: 1.00 },
  },
  SU_KIEN_DIEM_DANH: {
    category: 'Vận hành & Điểm danh',
    tabColor: { red: 0.12, green: 0.31, blue: 0.75 },
    headerBg: { red: 0.12, green: 0.23, blue: 0.54 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 0.94, green: 0.97, blue: 1.00 },
  },
  LUUTRU_CHAMCONG_TUAN: {
    category: 'Vận hành & Điểm danh',
    tabColor: { red: 0.25, green: 0.45, blue: 0.85 },
    headerBg: { red: 0.12, green: 0.23, blue: 0.54 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 0.94, green: 0.97, blue: 1.00 },
  },

  // 3. Nhóm Đơn từ & Phê duyệt (Cam Hổ Phách Amber)
  DON_NGHI_PHEP: {
    category: 'Đơn từ & Phê duyệt',
    tabColor: { red: 0.92, green: 0.53, blue: 0.05 },
    headerBg: { red: 0.47, green: 0.21, blue: 0.06 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 1.00, green: 0.98, blue: 0.93 },
  },
  DON_DOI_CA: {
    category: 'Đơn từ & Phê duyệt',
    tabColor: { red: 0.85, green: 0.48, blue: 0.04 },
    headerBg: { red: 0.47, green: 0.21, blue: 0.06 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 1.00, green: 0.98, blue: 0.93 },
  },
  DIEU_CHINH_CONG: {
    category: 'Đơn từ & Phê duyệt',
    tabColor: { red: 0.78, green: 0.42, blue: 0.03 },
    headerBg: { red: 0.47, green: 0.21, blue: 0.06 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 1.00, green: 0.98, blue: 0.93 },
  },

  // 4. Nhóm Tài chính & Tiền lương (Tím Hoàng Gia Violet)
  KY_LUONG: {
    category: 'Tài chính & Tiền lương',
    tabColor: { red: 0.48, green: 0.23, blue: 0.85 },
    headerBg: { red: 0.30, green: 0.11, blue: 0.58 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 0.97, green: 0.95, blue: 1.00 },
  },
  CHI_TIET_LUONG: {
    category: 'Tài chính & Tiền lương',
    tabColor: { red: 0.42, green: 0.18, blue: 0.78 },
    headerBg: { red: 0.30, green: 0.11, blue: 0.58 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 0.97, green: 0.95, blue: 1.00 },
  },
  PHIEU_LUONG: {
    category: 'Tài chính & Tiền lương',
    tabColor: { red: 0.55, green: 0.30, blue: 0.90 },
    headerBg: { red: 0.30, green: 0.11, blue: 0.58 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 0.97, green: 0.95, blue: 1.00 },
  },
  CONG_THUC_LUONG: {
    category: 'Tài chính & Tiền lương',
    tabColor: { red: 0.42, green: 0.18, blue: 0.78 },
    headerBg: { red: 0.30, green: 0.11, blue: 0.58 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 0.97, green: 0.95, blue: 1.00 },
  },
  DULIEU_LUONG_KY: {
    category: 'Tài chính & Tiền lương',
    tabColor: { red: 0.60, green: 0.35, blue: 0.95 },
    headerBg: { red: 0.30, green: 0.11, blue: 0.58 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 0.97, green: 0.95, blue: 1.00 },
  },

  // 5. Nhóm Tuyển dụng & Đào tạo (Hồng Sen Rose)
  FROM_NHAN_VIEN: {
    category: 'Tuyển dụng & Đào tạo',
    tabColor: { red: 0.86, green: 0.17, blue: 0.45 },
    headerBg: { red: 0.51, green: 0.09, blue: 0.26 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 1.00, green: 0.95, blue: 0.97 },
  },
  HR_UNG_VIEN: {
    category: 'Tuyển dụng & Đào tạo',
    tabColor: { red: 0.88, green: 0.20, blue: 0.48 },
    headerBg: { red: 0.51, green: 0.09, blue: 0.26 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 1.00, green: 0.95, blue: 0.97 },
  },
  BAI_THI: {
    category: 'Tuyển dụng & Đào tạo',
    tabColor: { red: 0.92, green: 0.28, blue: 0.55 },
    headerBg: { red: 0.51, green: 0.09, blue: 0.26 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 1.00, green: 0.95, blue: 0.97 },
  },
  BAI_LAM: {
    category: 'Tuyển dụng & Đào tạo',
    tabColor: { red: 0.95, green: 0.38, blue: 0.65 },
    headerBg: { red: 0.51, green: 0.09, blue: 0.26 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 1.00, green: 0.95, blue: 0.97 },
  },

  // 6. Nhóm Quản trị & Hệ thống (Xám Than Slate)
  ADMIN_ACCOUNTS: {
    category: 'Hệ thống & Giám sát',
    tabColor: { red: 0.28, green: 0.33, blue: 0.41 },
    headerBg: { red: 0.06, green: 0.09, blue: 0.16 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 0.96, green: 0.97, blue: 0.98 },
  },
  DANH_SACH_CHI_NHANH: {
    category: 'Hệ thống & Giám sát',
    tabColor: { red: 0.25, green: 0.30, blue: 0.40 },
    headerBg: { red: 0.06, green: 0.09, blue: 0.16 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 0.96, green: 0.97, blue: 0.98 },
  },
  AUDIT_LOG: {
    category: 'Hệ thống & Giám sát',
    tabColor: { red: 0.20, green: 0.25, blue: 0.35 },
    headerBg: { red: 0.06, green: 0.09, blue: 0.16 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 0.96, green: 0.97, blue: 0.98 },
  },
  CAU_HINH_HE_THONG: {
    category: 'Hệ thống & Giám sát',
    tabColor: { red: 0.35, green: 0.40, blue: 0.50 },
    headerBg: { red: 0.06, green: 0.09, blue: 0.16 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 0.96, green: 0.97, blue: 0.98 },
  },
  THONGBAO_NV: {
    category: 'Hệ thống & Giám sát',
    tabColor: { red: 0.40, green: 0.45, blue: 0.55 },
    headerBg: { red: 0.06, green: 0.09, blue: 0.16 },
    headerFg: { red: 1, green: 1, blue: 1 },
    bandColor: { red: 0.96, green: 0.97, blue: 0.98 },
  },
};

function resolveTheme(title) {
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

/**
 * Phân tích tên tiêu đề và dữ liệu thực tế mẫu để tự động xác định quy tắc căn chỉnh và định dạng
 */
function analyzeColumn(header, sampleValues = []) {
  const h = String(header || '').trim();
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

  // 1. Cột dữ liệu kỹ thuật đặc biệt: Base64 / Ảnh / Password -> Cố định ngắn & Clip
  if (
    lower.includes('base64') ||
    lower.includes('mật khẩu') ||
    lower.includes('ảnh ký') ||
    lower.includes('password')
  ) {
    return {
      width: 110,
      horizontalAlignment: 'CENTER',
      verticalAlignment: 'MIDDLE',
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
      verticalAlignment: 'MIDDLE',
      wrapStrategy: 'CLIP',
      numberFormat: { type: 'TEXT' },
    };
  }

  // 3. JSON columns
  if (lower.includes('(json)') || lower.includes('json')) {
    return {
      width: 180,
      horizontalAlignment: 'LEFT',
      verticalAlignment: 'MIDDLE',
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
      verticalAlignment: 'MIDDLE',
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
      verticalAlignment: 'MIDDLE',
      wrapStrategy: 'CLIP',
      numberFormat: { type: 'NUMBER', pattern: '#,##0 "đ"' },
    };
  }

  // 6. Tỷ lệ %
  if (lower.includes('(%)') || lower.includes('tỷ lệ') || lower.includes('phần trăm')) {
    return {
      width: Math.max(110, Math.ceil(h.length * 9.5) + 44),
      horizontalAlignment: 'RIGHT',
      verticalAlignment: 'MIDDLE',
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
      verticalAlignment: 'MIDDLE',
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
      verticalAlignment: 'MIDDLE',
      wrapStrategy: 'CLIP',
      numberFormat: { type: 'NUMBER', pattern: '#,##0.0' },
    };
  }

  // 9. Tọa độ GPS (Vĩ độ, Kinh độ)
  if (lower.includes('vĩ độ') || lower.includes('kinh độ')) {
    return {
      width: Math.max(115, Math.ceil(h.length * 9.5) + 44),
      horizontalAlignment: 'RIGHT',
      verticalAlignment: 'MIDDLE',
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
      verticalAlignment: 'MIDDLE',
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
      verticalAlignment: 'MIDDLE',
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
    // Nếu là ID dài (ID Phiếu, ID Yêu Cầu, ID Ca Làm, ID Sự Kiện, UUID)
    const isLongId =
      lower.includes('phiếu') ||
      lower.includes('yêu cầu') ||
      lower.includes('ca làm') ||
      lower.includes('sự kiện') ||
      lower.includes('inbox') ||
      lower.includes('thông báo') ||
      lower.includes('giai đoạn') ||
      maxDataLen > 25;

    let calcW = isLongId
      ? Math.max(220, Math.ceil(h.length * 9.5) + 44, Math.ceil(maxDataLen * 7.8) + 24)
      : Math.max(125, Math.ceil(h.length * 9.5) + 44, Math.ceil(maxDataLen * 8.0) + 24);

    return {
      width: Math.min(300, calcW),
      horizontalAlignment: 'CENTER',
      verticalAlignment: 'MIDDLE',
      wrapStrategy: 'CLIP',
      numberFormat: { type: 'TEXT' },
    };
  }

  // 13. Trạng thái / Phê duyệt / Loại / Vai trò / Giai đoạn (Áp dụng Status Pill Conditional Formatting)
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
      verticalAlignment: 'MIDDLE',
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
      verticalAlignment: 'MIDDLE',
      wrapStrategy: 'CLIP',
    };
  }

  // 15. Mặc định cho cột text thông thường
  const calcW = Math.max(130, Math.ceil(h.length * 9.5) + 44, Math.ceil(maxDataLen * 8.0) + 24);
  return {
    width: Math.min(220, calcW),
    horizontalAlignment: 'LEFT',
    verticalAlignment: 'MIDDLE',
    wrapStrategy: 'CLIP',
  };
}

async function run() {
  console.log('==> 🎨 Bắt đầu làm đẹp & tự động căn chỉnh giao diện Google Sheets Master (Ụm Bò Milk)...');

  let email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_PRIVATE_KEY;

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      if (creds.client_email && creds.private_key) {
        email = creds.client_email;
        key = creds.private_key;
      }
    } catch (e) {
      console.error('Lỗi parse GOOGLE_SERVICE_ACCOUNT_JSON:', e.message);
      process.exit(1);
    }
  }

  if (!email || !key) {
    console.error('Thiếu thông tin Google Service Account (GOOGLE_SERVICE_ACCOUNT_JSON hoặc EMAIL + KEY)!');
    process.exit(1);
  }

  const spreadsheetId = process.argv[2] || process.env.SPREADSHEET_ID || '1UO1UF1d7_YzaCltYt2m9pRnUauGWw873ERqAMxwL-6k';
  const formattedKey = key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;

  const auth = new google.auth.JWT({
    email,
    key: formattedKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheetsClient = google.sheets({ version: 'v4', auth });

  console.log(`==> Kết nối tới bảng tính: ${spreadsheetId}`);
  const res = await sheetsClient.spreadsheets.get({ spreadsheetId });
  const sheets = res.data.sheets || [];

  console.log(`==> Tìm thấy ${sheets.length} sheet tabs trong file.`);

  let totalFormatted = 0;

  for (const sheet of sheets) {
    const title = sheet.properties?.title;
    const sheetId = sheet.properties?.sheetId;
    const rowCount = sheet.properties?.gridProperties?.rowCount || 1000;
    if (!title || sheetId === undefined) continue;

    console.log(` -> Đang tối ưu & căn chỉnh tab: [${title}]...`);

    // Lấy tối đa 50 dòng dữ liệu mẫu để phân tích kích thước và kiểu dữ liệu chuẩn xác
    let values = [];
    try {
      const sampleRes = await sheetsClient.spreadsheets.values.get({
        spreadsheetId,
        range: `'${title}'!1:50`,
      });
      values = sampleRes.data.values || [];
    } catch (e) {
      console.warn(`    ⚠️ Không đọc được dữ liệu tab [${title}]:`, e.message);
      values = [];
    }

    if (values.length === 0 || !values[0] || values[0].length === 0) {
      console.log(`    (Tab trống dữ liệu hoặc không có header, bỏ qua)`);
      continue;
    }

    const headerRow = values[0];
    const colCount = headerRow.length;
    const theme = resolveTheme(title);

    const requests = [];

    // 1. Cập nhật Tab color + freeze row 1 + show gridlines
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId,
          tabColorStyle: { rgbColor: theme.tabColor },
          gridProperties: { frozenRowCount: 1, hideGridlines: false },
        },
        fields: 'tabColorStyle,gridProperties.frozenRowCount,gridProperties.hideGridlines',
      },
    });

    // 2. Chiều cao hàng tiêu chuẩn cao cấp:
    // - Header (Row 0): 38px (thoáng đãng, nổi bật)
    // - Data rows (Rows 1..500): 28px (chuẩn dashboard SaaS hiện đại)
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 38 },
        fields: 'pixelSize',
      },
    });
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: Math.min(rowCount, 500) },
        properties: { pixelSize: 28 },
        fields: 'pixelSize',
      },
    });

    // 3. Header styling (Roboto, Bold, 10pt, Chữ trắng, Căn giữa dọc và ngang, Wrap)
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: colCount },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: theme.headerBg },
            textFormat: {
              foregroundColorStyle: { rgbColor: theme.headerFg },
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

    // 4. Viền bảng (Borders):
    // - Chân Header kẻ đậm vững chắc (SOLID_MEDIUM với màu xám xanh Slate #64748B)
    // - Lưới ô dữ liệu kẻ nét thanh tinh tế (#E2E8F0) áp dụng cho toàn bộ sheet (không giới hạn dòng)
    requests.push({
      updateBorders: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: colCount },
        bottom: {
          style: 'SOLID_MEDIUM',
          colorStyle: { rgbColor: { red: 0.39, green: 0.45, blue: 0.55 } },
        },
      },
    });
    requests.push({
      updateBorders: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: colCount },
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

    // 5. Căn chỉnh từng cột dữ liệu + Tối ưu độ rộng chuẩn theo nội dung thực tế
    headerRow.forEach((h, colIdx) => {
      // Trích xuất các mẫu giá trị của cột này từ 50 dòng đã lấy
      const colSamples = [];
      for (let r = 1; r < values.length; r++) {
        if (values[r] && values[r][colIdx] !== undefined) {
          colSamples.push(values[r][colIdx]);
        }
      }

      const style = analyzeColumn(h, colSamples);

      // Đặt độ rộng chuẩn xác cho cột
      requests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: colIdx, endIndex: colIdx + 1 },
          properties: { pixelSize: style.width },
          fields: 'pixelSize',
        },
      });

      // Định dạng ô dữ liệu các dòng bên dưới (áp dụng cho toàn bộ các dòng còn lại trong cột)
      const cellFormat = {
        horizontalAlignment: style.horizontalAlignment,
        verticalAlignment: style.verticalAlignment || 'MIDDLE',
        wrapStrategy: style.wrapStrategy || 'CLIP',
        textFormat: { fontFamily: 'Roboto', fontSize: 10, foregroundColorStyle: { rgbColor: { red: 0.12, green: 0.16, blue: 0.23 } } },
      };
      let fields = 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)';

      if (style.numberFormat) {
        cellFormat.numberFormat = style.numberFormat;
        fields += ',userEnteredFormat.numberFormat';
      }

      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 },
          cell: { userEnteredFormat: cellFormat },
          fields,
        },
      });

      // Conditional formatting cho trạng thái (Status Pills)
      if (style.isStatus) {
        // Xanh lá (Active, Official, Approved, Check-in, Đạt, Pass, v.v.)
        const greens = [
          'ACTIVE', 'OFFICIAL', 'CHÍNH THỨC', 'APPROVED', 'DUYỆT', 'ĐÃ DUYỆT',
          'IN', 'CHECK_IN', 'ĐẠT', 'ĐÃ CHI TRẢ', 'YES', 'TRUE', 'PASS', 'HIRED', 'ĐÃ CHỐT', 'VALID'
        ];
        greens.forEach(keyword => {
          requests.push({
            addConditionalFormatRule: {
              rule: {
                ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 }],
                booleanRule: {
                  condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: keyword }] },
                  format: {
                    backgroundColorStyle: { rgbColor: { red: 0.87, green: 0.97, blue: 0.93 } },
                    textFormat: { foregroundColorStyle: { rgbColor: { red: 0.01, green: 0.33, blue: 0.25 } }, bold: true },
                  },
                },
              },
              index: 0,
            },
          });
        });

        // Đỏ (Inactive, Rejected, Check-out, Không đạt, Khóa, Nghỉ việc, Vắng, v.v.)
        const reds = [
          'INACTIVE', 'REJECTED', 'TỪ CHỐI', 'OUT', 'CHECK_OUT', 'KHÔNG ĐẠT',
          'BỊ KHÓA', 'RESIGNED', 'NO', 'FALSE', 'INVALID', 'VẮNG', 'LATE', 'TRỄ', 'FAIL'
        ];
        reds.forEach(keyword => {
          requests.push({
            addConditionalFormatRule: {
              rule: {
                ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 }],
                booleanRule: {
                  condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: keyword }] },
                  format: {
                    backgroundColorStyle: { rgbColor: { red: 0.99, green: 0.91, blue: 0.91 } },
                    textFormat: { foregroundColorStyle: { rgbColor: { red: 0.61, green: 0.11, blue: 0.11 } }, bold: true },
                  },
                },
              },
              index: 0,
            },
          });
        });

        // Vàng cam (Pending, Chờ duyệt, Thử việc, Nháp, Chờ PV, v.v.)
        const ambers = [
          'PENDING', 'CHỜ DUYỆT', 'DRAFT', 'THỬ VIỆC', 'PROBATION', 'CHƯA DUYỆT', 'CHỜ PV', 'ASSIGNED'
        ];
        ambers.forEach(keyword => {
          requests.push({
            addConditionalFormatRule: {
              rule: {
                ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 }],
                booleanRule: {
                  condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: keyword }] },
                  format: {
                    backgroundColorStyle: { rgbColor: { red: 1.00, green: 0.95, blue: 0.78 } },
                    textFormat: { foregroundColorStyle: { rgbColor: { red: 0.57, green: 0.25, blue: 0.05 } }, bold: true },
                  },
                },
              },
              index: 0,
            },
          });
        });

        // Xanh dương / Chàm (VIP, Quản trị, HR, Đã gửi, v.v.)
        const blues = [
          'VIP', 'ADMIN', 'HR', 'FINANCE', 'MANAGER', 'SENT', 'ĐÃ GỬI', 'SCHEDULED', 'SYSTEM', 'STORE'
        ];
        blues.forEach(keyword => {
          requests.push({
            addConditionalFormatRule: {
              rule: {
                ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 }],
                booleanRule: {
                  condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: keyword }] },
                  format: {
                    backgroundColorStyle: { rgbColor: { red: 0.88, green: 0.91, blue: 1.00 } },
                    textFormat: { foregroundColorStyle: { rgbColor: { red: 0.22, green: 0.19, blue: 0.64 } }, bold: true },
                  },
                },
              },
              index: 0,
            },
          });
        });
      }
    });

    // 6. Xóa Banding cũ (nếu có) và áp dụng Banding sọc xen kẽ mới cho toàn bộ bảng tính
    if (sheet.bandedRanges && sheet.bandedRanges.length > 0) {
      sheet.bandedRanges.forEach(b => {
        requests.push({
          deleteBanding: { bandedRangeId: b.bandedRangeId },
        });
      });
    }

    requests.push({
      addBanding: {
        bandedRange: {
          range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: colCount },
          rowProperties: {
            headerColorStyle: { rgbColor: theme.headerBg },
            firstBandColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
            secondBandColorStyle: { rgbColor: theme.bandColor },
          },
        },
      },
    });

    // 7. Thêm Bộ Lọc Tự Động (Basic Filter dropdown) ở dòng 1
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

    try {
      await sheetsClient.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests },
      });
      totalFormatted++;
      console.log(`    ✓ Hoàn thành căn chỉnh & làm đẹp tab: [${title}] (${theme.category})`);
    } catch (batchErr) {
      if (batchErr.message && batchErr.message.includes('protected')) {
        try {
          const fallbackRequests = requests.filter(r => !r.updateSheetProperties);
          if (fallbackRequests.length > 0) {
            await sheetsClient.spreadsheets.batchUpdate({
              spreadsheetId,
              requestBody: { requests: fallbackRequests },
            });
            totalFormatted++;
            console.log(`    ✓ Hoàn thành căn chỉnh dữ liệu tab: [${title}] (${theme.category}) (Bỏ qua thuộc tính tab do có ô bảo vệ)`);
          } else {
            console.warn(`    ⚠️ Tab [${title}] đang được bảo vệ bởi chủ sở hữu, bỏ qua an toàn.`);
          }
        } catch (innerErr) {
          console.warn(`    ⚠️ Tab [${title}] có ô bảo vệ quyền chỉnh sửa: ${innerErr.message || 'Protected'}`);
        }
      } else {
        console.error(`    ❌ Lỗi khi định dạng tab [${title}]:`, batchErr.message);
      }
    }

    // Nghỉ nhẹ 350ms để không chạm trần write quota API
    await new Promise(r => setTimeout(r, 350));
  }

  console.log(`\n🎉 HOÀN TẤT XUẤT SẮC! Đã tự động căn chỉnh & thiết kế giao diện thành công ${totalFormatted} tabs trên Google Sheets Master.`);
}

run().catch(err => {
  console.error('Lỗi thực thi:', err);
  process.exit(1);
});
