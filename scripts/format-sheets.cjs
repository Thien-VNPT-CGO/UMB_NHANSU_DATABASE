#!/usr/bin/env node
/**
 * Script làm đẹp và chuẩn hóa toàn diện giao diện Google Sheets Master cho Ụm Bò Milk.
 * - Phân nhóm màu sắc Tab trực quan theo nghiệp vụ (Nhân sự, Vận hành, Đơn từ, Tiền lương, Tuyển dụng, Hệ thống).
 * - Dòng tiêu đề cao thoáng (38px), nền màu thương hiệu sang trọng, chữ trắng in đậm, căn giữa dọc-ngang.
 * - Cố định hàng đầu (frozenRowCount: 1) và bật đường lưới ô (showGridlines: true).
 * - Căn chỉnh độ rộng cột chuẩn xác từng loại dữ liệu (ID, Tên, SĐT, Tiền, Ngày tháng).
 * - Định dạng số tiền tệ (#,##0 "đ"), ngày tháng (yyyy-mm-dd), text ID chuẩn.
 * - Tô màu thông minh (Conditional Formatting) cho các cột Trạng thái (Xanh lá = Active/Duyệt/In, Đỏ = Inactive/Từ chối/Out, Vàng = Pending/Chờ duyệt).
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

// Nếu chưa có env, tự động tìm file key.json / service-account.json ở thư mục dự án hoặc Downloads
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

// Bảng màu & nhóm tab
const TAB_THEMES = {
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
    category: 'Hệ thống & Giám sát',
    tabColor: { red: 0.42, green: 0.49, blue: 0.60 },
    headerBg: { red: 0.06, green: 0.09, blue: 0.16 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },
  SNAPSHOT_SAOLUU: {
    category: 'Hệ thống & Giám sát',
    tabColor: { red: 0.45, green: 0.50, blue: 0.62 },
    headerBg: { red: 0.06, green: 0.09, blue: 0.16 },
    headerFg: { red: 1, green: 1, blue: 1 },
  },
};

function getColumnStyle(header) {
  const lower = String(header || '').trim().toLowerCase();

  // Tiền tệ
  if (
    lower.includes('(vnđ)') || lower.includes('lương') || lower.includes('phụ cấp') ||
    lower.includes('thưởng') || lower.includes('khấu trừ') || lower.includes('thực nhận') ||
    lower.includes('thực lãnh') || lower.includes('tổng lương') || lower.includes('tổng tiền') ||
    lower.includes('tổng cộng') || lower.includes('phạt (đ)') || lower.includes('đơn giá') || lower.includes('(đ)')
  ) {
    return { width: 135, horizontalAlignment: 'RIGHT', numberFormat: { type: 'NUMBER', pattern: '#,##0 "đ"' } };
  }

  // Tỷ lệ %
  if (lower.includes('(%)') || lower.includes('tỷ lệ') || lower.includes('phần trăm')) {
    return { width: 110, horizontalAlignment: 'RIGHT', numberFormat: { type: 'NUMBER', pattern: '0.0%' } };
  }

  // Số đếm
  if (
    lower.includes('điểm') || lower.includes('số phút') || lower.includes('số ca') ||
    lower.includes('ca vắng') || lower.includes('giờ chuẩn') || lower.includes('lệch (phút)') ||
    lower.includes('bán kính') || lower.includes('khoảng cách') || lower.includes('suất ot') || lower.includes('phạt (nấc)')
  ) {
    return { width: 115, horizontalAlignment: 'RIGHT', numberFormat: { type: 'NUMBER', pattern: '#,##0' } };
  }

  // Ngày
  if (lower.includes('ngày') || lower.includes('(yyyy-mm-dd)') || lower.includes('tháng/năm')) {
    return { width: 120, horizontalAlignment: 'CENTER', numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } };
  }

  // Giờ
  if (lower.includes('thời gian') || lower.includes('giờ máy') || lower.includes('bắt đầu') || lower.includes('kết thúc') || lower.includes('lúc')) {
    return { width: 135, horizontalAlignment: 'CENTER' };
  }

  // ID / Mã / SĐT / CCCD / STK
  if (
    lower.includes('mã ') || lower.includes('id ') || lower.startsWith('id') ||
    lower.includes('số điện thoại') || lower.includes('sđt') || lower.includes('cccd') ||
    lower.includes('số tài khoản') || lower.includes('stk') || lower.includes('phiên bản')
  ) {
    return { width: 115, horizontalAlignment: 'CENTER', numberFormat: { type: 'TEXT' } };
  }

  // Trạng thái / Phê duyệt
  if (
    lower.includes('trạng thái') || lower.includes('loại ') || lower.includes('kết quả') ||
    lower.includes('giới tính') || lower.includes('vai trò') || lower.includes('vip') ||
    lower.includes('(in/out)') || lower.includes('(yes/no)') || lower.includes('bắt buộc đổi pin') || lower.includes('đã đọc')
  ) {
    return { width: 125, horizontalAlignment: 'CENTER', isStatus: true };
  }

  // Tên
  if (lower.includes('họ và tên') || lower.includes('chủ tài khoản') || lower.includes('tên chi nhánh') || lower.includes('người')) {
    return { width: 185, horizontalAlignment: 'LEFT' };
  }

  // Nội dung dài
  if (
    lower.includes('địa chỉ') || lower.includes('lý do') || lower.includes('ghi chú') ||
    lower.includes('nội dung') || lower.includes('chi tiết') || lower.includes('mô tả') ||
    lower.includes('kinh nghiệm') || lower.includes('quê quán') || lower.includes('json') ||
    lower.includes('drive') || lower.includes('base64') || lower.includes('email') || lower.includes('facebook')
  ) {
    return { width: 250, horizontalAlignment: 'LEFT' };
  }

  return { width: 130, horizontalAlignment: 'LEFT' };
}

function resolveTheme(title) {
  if (TAB_THEMES[title]) return TAB_THEMES[title];
  const upper = (title || '').toUpperCase();
  if (upper.includes('NHAN_VIEN') || upper.includes('EMPLOYEE')) {
    return {
      category: 'Nhân sự & Hồ sơ',
      tabColor: { red: 0.02, green: 0.47, blue: 0.34 },
      headerBg: { red: 0.02, green: 0.31, blue: 0.23 },
      headerFg: { red: 1, green: 1, blue: 1 },
    };
  }
  if (upper.includes('CA_') || upper.includes('DIEM_DANH') || upper.includes('CHAM_CONG') || upper.includes('LICH_LAM')) {
    return {
      category: 'Vận hành & Chấm công',
      tabColor: { red: 0.15, green: 0.39, blue: 0.92 },
      headerBg: { red: 0.12, green: 0.23, blue: 0.54 },
      headerFg: { red: 1, green: 1, blue: 1 },
    };
  }
  if (upper.includes('PHIEU_') || upper.includes('DON_') || upper.includes('NGHI_TUAN') || upper.includes('LICH_TUAN') || upper.includes('DOI_CA') || upper.includes('DOI_THIET_BI')) {
    return {
      category: 'Đơn từ & Phê duyệt',
      tabColor: { red: 0.85, green: 0.47, blue: 0.02 },
      headerBg: { red: 0.47, green: 0.21, blue: 0.06 },
      headerFg: { red: 1, green: 1, blue: 1 },
    };
  }
  if (upper.includes('LUONG') || upper.includes('PAYROLL') || upper.includes('THU_NHAP')) {
    return {
      category: 'Tiền lương & Thu nhập',
      tabColor: { red: 0.49, green: 0.23, blue: 0.93 },
      headerBg: { red: 0.30, green: 0.11, blue: 0.58 },
      headerFg: { red: 1, green: 1, blue: 1 },
    };
  }
  if (upper.includes('UNG_VIEN') || upper.includes('PHONG_VAN') || upper.includes('TEST') || upper.includes('TUYEN_DUNG')) {
    return {
      category: 'Tuyển dụng & Đào tạo',
      tabColor: { red: 0.86, green: 0.15, blue: 0.47 },
      headerBg: { red: 0.51, green: 0.09, blue: 0.26 },
      headerFg: { red: 1, green: 1, blue: 1 },
    };
  }
  if (upper.includes('LOG') || upper.includes('ADMIN') || upper.includes('THONGBAO') || upper.includes('ZALO') || upper.includes('SAOLUU') || upper.includes('CHI_NHANH')) {
    return {
      category: 'Hệ thống & Giám sát',
      tabColor: { red: 0.28, green: 0.33, blue: 0.41 },
      headerBg: { red: 0.06, green: 0.09, blue: 0.16 },
      headerFg: { red: 1, green: 1, blue: 1 },
    };
  }
  return {
    category: 'Chung',
    tabColor: { red: 0.3, green: 0.35, blue: 0.45 },
    headerBg: { red: 0.08, green: 0.12, blue: 0.20 },
    headerFg: { red: 1, green: 1, blue: 1 },
  };
}

async function run() {
  console.log('==> 🎨 Bắt đầu làm đẹp & chuẩn hóa giao diện Google Sheets Master (Ụm Bò Milk)...');

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

  const spreadsheetId = process.env.SPREADSHEET_ID || '17iXM0zc1m17aX9AZrFMjOkPRMy2_CwWfjTRZSUPQF2w';
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

  console.log(`==> Tìm thấy ${sheets.length} sheet tabs.`);

  let totalFormatted = 0;

  for (const sheet of sheets) {
    const title = sheet.properties?.title;
    const sheetId = sheet.properties?.sheetId;
    if (!title || sheetId === undefined) continue;

    console.log(` -> Đang định dạng tab: [${title}]...`);

    // Lấy dòng header hiện tại của sheet
    let headerRow = [];
    try {
      const headerRes = await sheetsClient.spreadsheets.values.get({
        spreadsheetId,
        range: `'${title}'!1:1`,
      });
      headerRow = headerRes.data.values?.[0] || [];
    } catch {
      headerRow = [];
    }

    if (headerRow.length === 0) {
      console.log(`    (Tab trống header, bỏ qua)`);
      continue;
    }

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

    // 2. Chiều cao hàng tiêu đề 38px
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 38 },
        fields: 'pixelSize',
      },
    });

    // 3. Header styling
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

    // 4. Viền chân tiêu đề
    requests.push({
      updateBorders: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: colCount },
        bottom: {
          style: 'SOLID_MEDIUM',
          colorStyle: { rgbColor: { red: 0.75, green: 0.75, blue: 0.75 } },
        },
      },
    });

    // 5. Cột dữ liệu & Format
    headerRow.forEach((h, colIdx) => {
      const style = getColumnStyle(h);

      // Chiều rộng cột
      requests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: colIdx, endIndex: colIdx + 1 },
          properties: { pixelSize: style.width },
          fields: 'pixelSize',
        },
      });

      // Format dữ liệu các hàng bên dưới
      const cellFormat = {
        horizontalAlignment: style.horizontalAlignment,
        verticalAlignment: 'MIDDLE',
        textFormat: { fontFamily: 'Roboto', fontSize: 10 },
      };
      let fields = 'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat)';

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

      // Conditional formatting cho trạng thái
      if (style.isStatus) {
        const greens = ['ACTIVE', 'OFFICIAL', 'CHÍNH THỨC', 'APPROVED', 'DUYỆT', 'ĐÃ DUYỆT', 'IN', 'ĐẠT', 'ĐÃ CHI TRẢ', 'YES', 'TRUE'];
        greens.forEach(keyword => {
          requests.push({
            addConditionalFormatRule: {
              rule: {
                ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 }],
                booleanRule: {
                  condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: keyword }] },
                  format: {
                    backgroundColorStyle: { rgbColor: { red: 0.86, green: 0.98, blue: 0.91 } },
                    textFormat: { foregroundColorStyle: { rgbColor: { red: 0.08, green: 0.50, blue: 0.24 } }, bold: true },
                  },
                },
              },
              index: 0,
            },
          });
        });

        const reds = ['INACTIVE', 'REJECTED', 'TỪ CHỐI', 'OUT', 'KHÔNG ĐẠT', 'BỊ KHÓA', 'RESIGNED', 'NO', 'FALSE'];
        reds.forEach(keyword => {
          requests.push({
            addConditionalFormatRule: {
              rule: {
                ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 }],
                booleanRule: {
                  condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: keyword }] },
                  format: {
                    backgroundColorStyle: { rgbColor: { red: 0.99, green: 0.89, blue: 0.89 } },
                    textFormat: { foregroundColorStyle: { rgbColor: { red: 0.73, green: 0.11, blue: 0.11 } }, bold: true },
                  },
                },
              },
              index: 0,
            },
          });
        });

        const ambers = ['PENDING', 'CHỜ DUYỆT', 'DRAFT', 'THỬ VIỆC', 'PROBATION', 'CHƯA DUYỆT'];
        ambers.forEach(keyword => {
          requests.push({
            addConditionalFormatRule: {
              rule: {
                ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 }],
                booleanRule: {
                  condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: keyword }] },
                  format: {
                    backgroundColorStyle: { rgbColor: { red: 0.99, green: 0.95, blue: 0.78 } },
                    textFormat: { foregroundColorStyle: { rgbColor: { red: 0.71, green: 0.33, blue: 0.04 } }, bold: true },
                  },
                },
              },
              index: 0,
            },
          });
        });
      }
    });

    try {
      await sheetsClient.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests },
      });
      totalFormatted++;
      console.log(`    ✓ Hoàn thành định dạng tab: [${title}] (${theme.category})`);
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
            console.log(`    ✓ Hoàn thành định dạng dữ liệu tab: [${title}] (${theme.category}) (Bỏ qua thuộc tính tab do có vùng bảo vệ)`);
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

    // Nghỉ nhẹ 400ms để không chạm trần write quota API
    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n🎉 HOÀN TẤT! Đã thiết kế & làm đẹp thành công ${totalFormatted} tabs trên Google Sheets Master.`);
}

run().catch(err => {
  console.error('Lỗi thực thi:', err);
  process.exit(1);
});
