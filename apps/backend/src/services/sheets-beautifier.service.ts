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

export interface ColumnStyle {
  width: number;
  horizontalAlignment: 'LEFT' | 'CENTER' | 'RIGHT';
  numberFormat?: {
    type: 'NUMBER' | 'DATE' | 'TIME' | 'TEXT' | 'PERCENT';
    pattern?: string;
  };
  isStatus?: boolean;
}

/**
 * Phân tích và tự động xác định phong cách định dạng của một cột dựa vào tên tiêu đề:
 */
export function getColumnStyle(header: string): ColumnStyle {
  const h = header.trim();
  const lower = h.toLowerCase();

  // 1. Tiền tệ (VNĐ, Lương, Phụ cấp, Thưởng, v.v.)
  if (
    lower.includes('(vnđ)') ||
    lower.includes('lương') ||
    lower.includes('phụ cấp') ||
    lower.includes('thưởng') ||
    lower.includes('khấu trừ') ||
    lower.includes('thực nhận') ||
    lower.includes('thực lãnh') ||
    lower.includes('tổng lương') ||
    lower.includes('tổng tiền') ||
    lower.includes('tổng cộng') ||
    lower.includes('phạt (đ)') ||
    lower.includes('đơn giá') ||
    lower.includes('(đ)')
  ) {
    return {
      width: 135,
      horizontalAlignment: 'RIGHT',
      numberFormat: { type: 'NUMBER', pattern: '#,##0 "đ"' },
    };
  }

  // 2. Tỷ lệ phần trăm
  if (lower.includes('(%)') || lower.includes('tỷ lệ') || lower.includes('phần trăm')) {
    return {
      width: 110,
      horizontalAlignment: 'RIGHT',
      numberFormat: { type: 'NUMBER', pattern: '0.0%' },
    };
  }

  // 3. Số đếm / Điểm / Số phút / Khoảng cách
  if (
    lower.includes('điểm') ||
    lower.includes('số phút') ||
    lower.includes('số ca') ||
    lower.includes('ca vắng') ||
    lower.includes('giờ chuẩn') ||
    lower.includes('lệch (phút)') ||
    lower.includes('bán kính') ||
    lower.includes('khoảng cách') ||
    lower.includes('suất ot') ||
    lower.includes('phạt (nấc)')
  ) {
    return {
      width: 115,
      horizontalAlignment: 'RIGHT',
      numberFormat: { type: 'NUMBER', pattern: '#,##0' },
    };
  }

  // 4. Ngày tháng (YYYY-MM-DD, Ngày sinh, Ngày bắt đầu, v.v.)
  if (
    lower.includes('ngày') ||
    lower.includes('(yyyy-mm-dd)') ||
    lower.includes('tháng/năm')
  ) {
    return {
      width: 120,
      horizontalAlignment: 'CENTER',
      numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' },
    };
  }

  // 5. Thời gian / Giờ giấc (Thời gian máy chủ, Giờ máy khách, Bắt đầu, Kết thúc)
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
    lower.includes('lúc chi trả')
  ) {
    return {
      width: 135,
      horizontalAlignment: 'CENTER',
    };
  }

  // 6. Mã ID / SĐT / CCCD / Số tài khoản
  if (
    lower.includes('mã ') ||
    lower.includes('id ') ||
    lower.startsWith('id') ||
    lower.includes('số điện thoại') ||
    lower.includes('sđt') ||
    lower.includes('cccd') ||
    lower.includes('số tài khoản') ||
    lower.includes('stk') ||
    lower.includes('phiên bản')
  ) {
    return {
      width: 115,
      horizontalAlignment: 'CENTER',
      numberFormat: { type: 'TEXT' },
    };
  }

  // 7. Trạng thái / Phê duyệt / Loại / Giới tính / VIP (Áp dụng Conditional Formatting)
  if (
    lower.includes('trạng thái') ||
    lower.includes('loại ') ||
    lower.includes('kết quả') ||
    lower.includes('giới tính') ||
    lower.includes('vai trò') ||
    lower.includes('vip') ||
    lower.includes('(in/out)') ||
    lower.includes('(yes/no)') ||
    lower.includes('bắt buộc đổi pin') ||
    lower.includes('đã đọc')
  ) {
    return {
      width: 125,
      horizontalAlignment: 'CENTER',
      isStatus: true,
    };
  }

  // 8. Họ Và Tên / Chủ tài khoản / Tên chi nhánh / Người phê duyệt
  if (
    lower.includes('họ và tên') ||
    lower.includes('chủ tài khoản') ||
    lower.includes('tên chi nhánh') ||
    lower.includes('người duyệt') ||
    lower.includes('người pv') ||
    lower.includes('người tạo') ||
    lower.includes('người yêu cầu') ||
    lower.includes('người nhận')
  ) {
    return {
      width: 185,
      horizontalAlignment: 'LEFT',
    };
  }

  // 9. Nội dung dài: Lý do / Ghi chú / Địa chỉ / Mô tả / JSON / Link
  if (
    lower.includes('địa chỉ') ||
    lower.includes('lý do') ||
    lower.includes('ghi chú') ||
    lower.includes('nội dung') ||
    lower.includes('chi tiết') ||
    lower.includes('mô tả') ||
    lower.includes('kinh nghiệm') ||
    lower.includes('quê quán') ||
    lower.includes('json') ||
    lower.includes('drive') ||
    lower.includes('base64') ||
    lower.includes('email') ||
    lower.includes('facebook')
  ) {
    return {
      width: 250,
      horizontalAlignment: 'LEFT',
    };
  }

  // Mặc định
  return {
    width: 130,
    horizontalAlignment: 'LEFT',
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

  // 2. Đặt chiều cao hàng tiêu đề (Hàng 1) cao 38px tạo cảm giác thoáng mắt, cao cấp
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

  // 3. Trang trí Hàng Tiêu Đề (Header Row): Màu nền đậm thương hiệu, chữ trắng bold, căn giữa dọc/ngang
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

  // 4. Viền chân tiêu đề chắc chắn
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
          rgbColor: { red: 0.75, green: 0.75, blue: 0.75 },
        },
      },
    },
  });

  // 5. Định dạng từng cột dữ liệu (Độ rộng, Căn lề, Format Tiền tệ/Ngày tháng)
  sheetDef.headers.forEach((header, colIdx) => {
    const style = getColumnStyle(header);

    // 5a. Độ rộng cột
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

    // 5b. Định dạng ô dữ liệu các dòng bên dưới (dòng 2 trở đi)
    const format: any = {
      horizontalAlignment: style.horizontalAlignment,
      verticalAlignment: 'MIDDLE',
      textFormat: {
        fontFamily: 'Roboto',
        fontSize: 10,
      },
    };

    let fields = 'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat)';

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

    // 5c. Định dạng có điều kiện (Conditional Formatting) cho các cột Trạng thái
    if (style.isStatus) {
      // Màu XANH LÁ (Thành công / Hoạt động / Đạt)
      const greenKeywords = ['ACTIVE', 'OFFICIAL', 'CHÍNH THỨC', 'APPROVED', 'DUYỆT', 'ĐÃ DUYỆT', 'IN', 'ĐẠT', 'ĐÃ CHI TRẢ', 'HOÀN THÀNH', 'YES', 'TRUE'];
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
                    rgbColor: { red: 0.86, green: 0.98, blue: 0.91 }, // #DCFCE7
                  },
                  textFormat: {
                    foregroundColorStyle: {
                      rgbColor: { red: 0.08, green: 0.50, blue: 0.24 }, // #15803D
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

      // Màu ĐỎ (Ngừng / Từ chối / Không đạt / OUT)
      const redKeywords = ['INACTIVE', 'REJECTED', 'TỪ CHỐI', 'OUT', 'KHÔNG ĐẠT', 'BỊ KHÓA', 'RESIGNED', 'NO', 'FALSE', 'THẤT BẠI'];
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
                    rgbColor: { red: 0.99, green: 0.89, blue: 0.89 }, // #FEE2E2
                  },
                  textFormat: {
                    foregroundColorStyle: {
                      rgbColor: { red: 0.73, green: 0.11, blue: 0.11 }, // #B91C1C
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

      // Màu VÀNG CAM (Chờ duyệt / Nháp / Thử việc)
      const amberKeywords = ['PENDING', 'CHỜ DUYỆT', 'DRAFT', 'THỬ VIỆC', 'PROBATION', 'CHƯA DUYỆT', 'CHO_DUYET'];
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
                    rgbColor: { red: 0.99, green: 0.95, blue: 0.78 }, // #FEF3C7
                  },
                  textFormat: {
                    foregroundColorStyle: {
                      rgbColor: { red: 0.71, green: 0.33, blue: 0.04 }, // #B45309
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

  return requests;
}
