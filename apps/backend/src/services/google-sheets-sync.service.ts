import fs from 'fs';
import path from 'path';
import { google, sheets_v4, drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import {
  EmployeeMaster,
  EmployeeAccount,
  AdminAccount,
  ShiftAssignment,
  LeaveRequest,
  SwapRequest,
  AttendanceEvent,
  PayrollRun,
  BranchInfo,
  AuditLogEntry,
  CandidateApplication,
  BRANCHES,
} from '@ubm/shared';
import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { MockSheetsAdapter } from '../repositories/mock-sheets.adapter.js';
import { dedupeShiftAssignments, pickPulledShift } from '../repositories/shift-dedupe.js';
import { hashPasswordSync, isBcryptHash, hashPin, generateAutoPin } from './password.service.js';
import { canonicalPhone } from './employees.service.js';
import { normSheetDate, normSheetDateTime, sheetDateText, sheetDateTimeText } from './employees.service.js';
import { evaluateCandidateAiScore } from './ai-scorer.js';
import {
  buildZaloInviteCell,
  candidateIdentityKey,
  isHrBranchLabel,
  isHrShiftLabel,
  normalizeFormFacebook,
  parseFormBirthYear,
  parseZaloInviteCell,
} from './candidate-form-map.js';
import { buildZipStore, ZipEntry } from '../utils/zip-store.js';
import { contractDocsCell, parseContractDocs } from '../utils/contracts.js';
import { blacklistCell, parseBlacklist } from '../utils/blacklist.js';
import { readAttendancePhotoDisk } from './photo-disk.store.js';
import { createDriveOAuthClient, describeDriveAuth, describeGoogleApiError, type GoogleDriveAuthMode } from './google-drive-auth.js';
import { uploadBufferViaDriveWebhook, downloadBufferViaDriveWebhook } from './drive-upload-webhook.js';
import {
  DRIVE_EMPLOYEE_PROFILES_FOLDER_NAME,
  DRIVE_SUBFOLDERS,
  getAdjustmentRequestsFolder,
  getAttendanceBranchLabel,
  getAttendanceFolderForBranch,
  getAttendanceRootFolder,
  getDriveDatabaseRootFolder,
  getEmployeeProfilesFolder,
} from '../config/drive-folders.js';
import { TAB_THEMES, buildSheetFormattingRequests, resolveTheme } from './sheets-beautifier.service.js';
import { computeSheetsContentSignature, fingerprintSheetsContent, hashSheetRows } from '../utils/sheets-content-signature.js';
import { getSpreadsheetIdForTab, listSeparatedSheetSources, listSeparatedSpreadsheetIds } from '../config/sheets-mapping.js';

/** Tên segment Drive an toàn cho cây thư mục phiếu bù công. */
function adjSafeSeg(value: unknown, fallback = 'KHONG_XAC_DINH'): string {
  return String(value ?? '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || fallback;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Tuỳ chọn đọc Google Sheets cho MỌI luồng pull.
 *
 * - UNFORMATTED_VALUE: trả SỐ THẬT thay vì chuỗi hiển thị. Ô tiền định dạng
 *   "25.500 đ" hoặc số thập phân "5,0" trước đây bị `Number()` → NaN → 0,
 *   khiến đơn giá lương ca / tiền lương bị ghi đè về 0 ngay sau lượt pull kế
 *   tiếp (mất dữ liệu thật dù vừa lưu thành công).
 * - FORMATTED_STRING: riêng cột ngày/giờ vẫn trả chuỗi hiển thị
 *   (YYYY-MM-DD...) để các hàm chuẩn hoá ngày hiện có tiếp tục hoạt động.
 */
const SHEETS_READ_OPTIONS = {
  valueRenderOption: 'UNFORMATTED_VALUE' as const,
  dateTimeRenderOption: 'FORMATTED_STRING' as const,
};

/**
 * Kỳ lương trên Sheet có thể bị USER_ENTERED biến "2026-10" thành ngày
 * ("2026-10-01"). Chuẩn hoá về YYYY-MM để mọi nơi so khớp đúng kỳ.
 */
export function normalizeSheetPeriod(value: unknown): string {
  const raw = String(value ?? '').trim();
  const m = raw.match(/^(\d{4})-(0[1-9]|1[0-2])(?:$|[-/T\s])/);
  return m ? `${m[1]}-${m[2]}` : raw;
}

/**
 * Đọc số từ ô Google Sheets có thể ở định dạng Việt Nam ("10,79782", "1.234,5",
 * "10.79782") hoặc số chuẩn. Trả undefined khi ô trống/không phải số.
 *
 * Sheet do người dùng nhập tay thường lưu toạ độ dạng text với dấu phẩy thập
 * phân — `Number()` thuần sẽ trả NaN và bản đồ rơi về toạ độ mặc định.
 */
export function parseSheetNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  let s = String(value).trim().replace(/\u00a0/g, '').replace(/\s/g, '');
  if (!s || s === '-') return undefined;
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    // "1.234,56" (VN) → bỏ dấu phân cách nghìn, đổi phẩy thành chấm.
    // "1,234.56" (EN) → bỏ phẩy, giữ chấm.
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (hasComma) {
    // "1,500,000" (phân cách nghìn EN) vs "10,5" (thập phân VN).
    s = /^\d{1,3}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, '') : s.replace(/,/g, '.');
  } else if (hasDot) {
    // "1.500.000" (phân cách nghìn VN) vs "10.79782" (thập phân).
    // Chỉ coi là phân cách nghìn khi có từ 2 nhóm 3 chữ số trở lên — tránh
    // biến toạ độ "10.776" thành 10776.
    if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Đọc số TIỀN từ ô Sheets. Khác `parseSheetNumber` ở chỗ một nhóm 3 chữ số
 * sau dấu chấm cũng được hiểu là phân cách nghìn: "250.000" = 250000đ
 * (toạ độ "10.776" vẫn dùng `parseSheetNumber` để giữ 10.776).
 */
export function parseSheetCurrency(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  let s = String(value).trim().replace(/\u00a0/g, '').replace(/\s/g, '');
  if (!s || s === '-') return undefined;
  // Bỏ ký hiệu tiền tệ hai đầu ("1.500.000đ", "VND 1.500.000").
  s = s.replace(/^(vnđ|vnd|₫|đ|d)/i, '').replace(/(vnđ|vnd|₫|đ|d)$/i, '');
  if (!s) return undefined;
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (hasComma) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(/,/g, '.');
  } else if (hasDot) {
    s = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Đọc cờ bật/tắt từ Google Sheets. Ô trống hoặc dữ liệu cũ chưa có cột
 * → mặc định BẬT để không làm thay đổi hành vi hiện tại.
 */
export function parseSheetBoolean(value: unknown, fallback = true): boolean {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (!s) return fallback;
  if (/^(false|0|no|off|tắt|tat|không|khong)$/.test(s)) return false;
  if (/^(true|1|yes|on|bật|bat|có|co)$/.test(s)) return true;
  return fallback;
}

/** Lấy lại mốc HH-mm từ tên file txt đã ghi trước đó (giữ nguyên tên khi cập nhật). */
export function hhmmFromAdjustmentFileName(name: unknown): string {
  const m = String(name || '').match(/^PHIEU_(\d{2}-\d{2})_/);
  return m ? m[1] : '';
}

/** Nhãn trạng thái hiển thị trong file txt (phân biệt tự từ chối do hết hạn). */
export function adjustmentRequestStatusLabel(adj: any): string {
  const st = String(adj?.status || 'PENDING');
  if (st === 'APPROVED') return 'Đã duyệt';
  if (st === 'REJECTED') {
    const note = String(adj?.review_note || '');
    if (/^Tự động hủy/.test(note)) return 'Tự động hủy (quá 72h)';
    return note.startsWith('Tự động từ chối') ? 'Tự động từ chối (hết hạn)' : 'Đã từ chối';
  }
  return 'Chờ duyệt';
}

/** Chỉ phiếu ĐÃ DUYỆT mới được đồng bộ lên Drive (folder 06). */
export function shouldSyncAdjustmentToDrive(adj: any): boolean {
  return String(adj?.status || '').toUpperCase() === 'APPROVED';
}

/** Mốc tạo phiếu: ưu tiên epoch nhúng trong mã phiếu, rớt về created_at/now. */
export function adjustmentCreatedMs(adj: any, nowMs: number = Date.now()): number {
  const m = String(adj?.adjustment_id || '').match(/^ADJ_(\d{12,13})(?:_|$)/);
  if (m) {
    const t = Number(m[1]);
    if (Number.isFinite(t) && t > 0) return t;
  }
  const parsed = Date.parse(String(adj?.created_at || ''));
  return Number.isFinite(parsed) ? parsed : nowMs;
}

/**
 * Cây thư mục Drive của 1 phiếu: <ngày gửi VN>/<Tên NV - Mã NV>.
 * VD: 2026-11-02/Nguyễn Văn A - EMP001
 */
export function adjustmentDriveLocation(
  adj: any,
  employee?: { full_name?: string; employee_code?: string } | null,
  nowMs: number = Date.now(),
): { day: string; empFolder: string; hhmm: string; segments: string[] } {
  const createdMs = adjustmentCreatedMs(adj, nowMs);
  const vn = new Date(createdMs + 7 * 3_600_000);
  const day = vn.toISOString().slice(0, 10);
  const hhmm = `${pad2(vn.getUTCHours())}-${pad2(vn.getUTCMinutes())}`;
  const empName = String(employee?.full_name || adj?.employee_id || 'KHONG_NV').trim();
  const empCode = String(employee?.employee_code || adj?.employee_id || '').trim();
  const empFolder = adjSafeSeg(empCode ? `${empName} - ${empCode}` : empName, 'KHONG_NV');
  return { day, empFolder, hhmm, segments: [day, empFolder] };
}

/** Nội dung file txt mô tả phiếu — Lý do & số phút, trạng thái, ảnh, hạn duyệt. */
export function buildAdjustmentRequestTxt(
  adj: any,
  employee?: { full_name?: string; employee_code?: string } | null,
  imageFileId?: string,
  nowMs: number = Date.now(),
): string {
  const createdMs = adjustmentCreatedMs(adj, nowMs);
  const fmtVn = (ms: number) => {
    const d = new Date(ms + 7 * 3_600_000);
    return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} `
      + `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  };
  // Hạn duyệt phiếu bù công: 72 giờ kể từ lúc nhận phiếu (không còn chốt 21:00).
  const deadlineMs = createdMs + 72 * 60 * 60 * 1000;
  const empName = String(employee?.full_name || adj?.employee_id || 'KHONG_NV').trim();
  const empCode = String(employee?.employee_code || adj?.employee_id || '').trim();
  const approvedMinutes = adj?.status === 'APPROVED' && adj?.minutes_approved !== undefined
    ? Number(adj.minutes_approved || 0)
    : null;
  return [
    'PHIẾU BỔ SUNG CÔNG',
    '==================================================',
    `Mã phiếu        : ${adj?.adjustment_id || '—'}`,
    `Nhân viên       : ${empName}`,
    `Mã nhân viên    : ${empCode || '—'}`,
    `Chi nhánh       : ${adj?.branch_id || '—'}`,
    `Ca làm          : ${adj?.assignment_id || '—'}`,
    `Ngày gửi        : ${fmtVn(createdMs)} (giờ VN)`,
    `Hạn duyệt       : ${fmtVn(deadlineMs)} (giờ VN)`,
    '--------------------------------------------------',
    `LÝ DO & SỐ PHÚT : ${adj?.reason || 'Bổ sung công'} — ${Number(adj?.minutes_requested || 0)} phút`,
    ...(approvedMinutes !== null ? [`SỐ PHÚT DUYỆT   : ${approvedMinutes} phút`] : []),
    '--------------------------------------------------',
    `TRẠNG THÁI      : ${adjustmentRequestStatusLabel(adj)}`,
    `Ghi chú         : ${adj?.review_note || '—'}`,
    `Hình ảnh        : ${imageFileId ? `https://drive.google.com/file/d/${imageFileId}/view` : 'Không có ảnh'}`,
    '==================================================',
    `Cập nhật lúc    : ${fmtVn(nowMs)} (giờ VN)`,
    '',
  ].join('\n');
}

export interface SheetDefinition {
  title: string;
  headers: string[];
}

export interface SheetsPullResult {
  success: boolean;
  message: string;
  counts: any;
  /** Hash nội dung các tab tại lần pull này (null nếu pull lỗi). */
  signature?: string | null;
  /** true khi nội dung khác lần pull trước — dùng để bắn realtime. */
  changed?: boolean;
  /** Các tab vừa đổi nội dung trong lần pull này (rỗng nếu không đổi). */
  changedTabs?: string[];
}

interface SheetsPullOptions {
  /** Dùng bản đọc thô đã cache (webhook chỉ đọc lại 1 tab) thay vì batchGet 24 tab. */
  prefetchedBatch?: Record<string, string[][]>;
  /** Ép đọc lại spreadsheet ứng viên (khi tab form ứng viên vừa đổi). */
  forceCandidates?: boolean;
  reason?: string;
}

export const SHEETS_DEFINITIONS: SheetDefinition[] = [
  {
    title: 'NHAN_VIEN_MASTER',
    headers: ['ID Nhân Viên', 'Mã NV', 'Họ Và Tên', 'Số Điện Thoại', 'Trạng Thái', 'Nhóm', 'Chi Nhánh', 'Lương Giờ (VNĐ)', 'Ngày Bắt Đầu', 'Phiên Bản', 'Ca Cố Định', 'Ngày Chính Thức', 'Email', 'Giới Tính', 'Ngày Sinh', 'CCCD', 'Avatar (Drive ID)', 'Ngân Hàng', 'Số Tài Khoản', 'Chủ Tài Khoản', 'QR Ngân Hàng (Base64)', 'Điểm Tích Lũy', 'Điểm Đã Dùng', 'Hợp Đồng Lao Động (JSON)', 'Danh Sách Đen (JSON)'],
  },
  {
    title: 'TAI_KHOAN_NHAN_VIEN',
    headers: ['ID Tài Khoản', 'ID Nhân Viên', 'Số Điện Thoại', 'Vai Trò', 'Trạng Thái', 'Phiên Bản', 'Mã PIN (hash)', 'Bắt Buộc Đổi PIN', 'Mã PIN', 'Đổi PIN Cuối', 'Kỳ PIN'],
  },
  {
    title: 'ADMIN_ACCOUNTS',
    headers: ['ID Admin', 'Tên Đăng Nhập', 'Mật Khẩu', 'Họ Và Tên', 'Vai Trò', 'Phạm Vi Chi Nhánh', 'Trạng Thái', 'Ngày Tạo'],
  },
  {
    title: 'PHAN_CONG_CA',
    headers: ['ID Ca Làm', 'ID Nhân Viên', 'Mã Chi Nhánh', 'Mã Ca', 'Ngày Làm (YYYY-MM-DD)', 'Bắt Đầu', 'Kết Thúc', 'Trạng Thái', 'Phiên Bản'],
  },
  {
    title: 'SU_KIEN_DIEM_DANH',
    headers: ['ID Sự Kiện', 'ID Ca', 'ID Nhân Viên', 'Loại (IN/OUT)', 'Thời Gian Máy Chủ', 'Vĩ Độ GPS', 'Kinh Độ GPS', 'Khoảng Cách (m)', 'Trạng Thái GPS', 'Ảnh Drive Object', 'ID Yêu Cầu', 'Hồng Đồng Phục (%)', 'Giờ Máy Khách', 'Trễ (YES/NO)', 'Sớm (YES/NO)', 'Lệch (phút)', 'Phạt (nấc)', 'Phạt (đ)'],
  },
  {
    title: 'LUUTRU_CHAMCONG_TUAN',
    headers: ['ID Sự Kiện', 'ID Ca', 'ID Nhân Viên', 'Loại (IN/OUT)', 'Thời Gian Máy Chủ', 'Vĩ Độ GPS', 'Kinh Độ GPS', 'Khoảng Cách (m)', 'Trạng Thái GPS', 'Ảnh Drive Object', 'ID Yêu Cầu', 'Tuần Lưu Trữ'],
  },
  {
    title: 'DON_NGHI_PHEP',
    headers: ['ID Đơn Nghỉ', 'ID Nhân Viên', 'Chi Nhánh', 'Loại Nghỉ', 'Ngày Nghỉ (YYYY-MM-DD)', 'Ca Làm', 'Lý Do', 'Trạng Thái', 'Người Duyệt', 'Ghi Chú Duyệt', 'Ngày Tạo'],
  },
  {
    title: 'DON_DOI_CA',
    headers: ['ID Đổi Ca', 'Người Yêu Cầu', 'Ca Yêu Cầu', 'Người Nhận', 'Ca Đổi', 'Lý Do', 'Trạng Thái', 'Người Duyệt', 'Ngày Tạo', 'Loại Phiếu', 'Không Dùng', 'CN Hỗ Trợ', 'Ngày Hỗ Trợ', 'Ca Hỗ Trợ'],
  },
  {
    title: 'DIEU_CHINH_CONG',
    headers: ['ID Điều Chỉnh', 'ID Ca', 'ID Nhân Viên', 'Lý Do', 'Số Phút Được Duyệt', 'Người Duyệt', 'Trạng Thái', 'Ghi Chú', 'Ảnh Bằng Chứng (Drive ID)', 'Mã Băm Ảnh', 'Điểm Đã Trừ'],
  },
  {
    title: 'KY_LUONG',
    headers: ['Mã Kỳ Lương', 'Tháng/Năm', 'Trạng Thái', 'Tổng Tiền (VNĐ)', 'Ngày Tạo', 'Ngày Chốt', 'Ngày Chi Trả'],
  },
  {
    title: 'AUDIT_LOG',
    headers: ['Mã Nhật Ký', 'Thời Gian', 'Người Thực Hiện', 'Vai Trò', 'Hành Động', 'Đối Tượng', 'ID Đối Tượng', 'Chi Tiết'],
  },
  {
    title: 'DANH_SACH_CHI_NHANH',
    headers: ['Mã Chi Nhánh', 'Tên Chi Nhánh', 'Địa Chỉ', 'Vĩ Độ GPS', 'Kinh Độ GPS', 'Bán Kính Cho Phép (m)', 'Trạng Thái', 'Bật Định Vị GPS', 'Hiển Thị Trên Bản Đồ'],
  },
  {
    title: 'CAU_HINH_HE_THONG',
    headers: ['Tham Số', 'Giá Trị', 'Mô Tả', 'Cập Nhật Lần Cuối'],
  },
  {
    // BETA: phiếu NV tự cập nhật lại ca làm trong đợt khai công (bot chấm tự động)
    title: 'PHIEU_NV_CAP_NHAT_CA',
    headers: ['ID Phiếu', 'ID Nhân Viên', 'Mã NV', 'Họ Và Tên', 'Ngày (YYYY-MM-DD)', 'Ca', 'Kết Quả (MỚI/ĐỔI/GIỮ/LỖI)', 'Chấm Công (HOÀN THÀNH/CHỜ)', 'Tiền Ca Ước Tính (VNĐ)', 'Ghi Chú', 'Thời Gian Gửi'],
  },
  {
    title: 'THONGBAO_NV',
    headers: ['ID Inbox', 'ID Thông Báo', 'Người Nhận', 'Loại', 'Tiêu Đề', 'Nội Dung', 'Mức Độ', 'Tab Liên Quan', 'Thời Gian', 'Đã Đọc'],
  },
  {
    title: 'FROM_NHAN_VIEN',
    headers: [
      'Ngày Đăng Ký',
      'Họ Và Tên',
      'Giới Tính',
      'Năm Sinh',
      'Trình Độ',
      'Quê Quán',
      'Số Điện Thoại',
      'Ca Đăng Ký',
      'Chi Nhánh Đăng Ký',
      'Kinh Nghiệm',
      'Xử Lý Đột Xuất',
      'Facebook',
      'Nguồn Biết Tin',
      'Điểm AI (Thang 14)',
      'Kết Quả',
      'Trạng Thái',
      'Mã Nguồn',
      'Ngày PV',
      'Khung Giờ PV',
      'Người PV',
      'Zalo Thư Mời',
      'Zalo Lúc Gửi',
      'Điểm PV',
      'Chi Tiết Chấm',
      'VIP',
      'Hạng VIP',
      'Lý Do Từ Chối PV',
      'Ngày Đề Xuất PV',
      'Khung Giờ Đề Xuất',
      'Ghi Chú Đề Xuất',
      'Lý Do Danh Sách Đen',
    ],
  },
  {
    title: 'BAI_THI',
    headers: ['ID Bài', 'Tiêu Đề', 'Mô Tả', 'Câu Hỏi (JSON)', 'Điểm Đạt', 'Giới Hạn Giây', 'Trạng Thái', 'Người Tạo', 'Ngày Tạo', 'Phiên Bản'],
  },
  {
    title: 'BAI_LAM',
    headers: ['ID Bài Làm', 'ID Bài', 'ID Nhân Viên', 'Trạng Thái', 'Đáp Án (JSON)', 'Điểm', 'Đạt', 'Ngày Nộp', 'Ngày Tạo', 'Phiên Bản'],
  },
  {
    title: 'PHIEU_LUONG',
    headers: ['ID Phiếu', 'Mã Kỳ Lương', 'ID Nhân Viên', 'Mã NV', 'Họ Và Tên', 'Kỳ Lương', 'Số Ca', 'Ca Vắng', 'Giờ Chuẩn', 'Đơn Giá', 'Lương Chuẩn', 'Không Dùng', 'Thưởng', 'Khấu Trừ', 'Thực Nhận', 'Trạng Thái', 'Không Dùng', 'Không Dùng', 'Lương CB (tay)', 'OT Thêm (tay)', 'Bonus Thêm (tay)', 'Ứng Lương', 'Trừ KPI (tay)', 'Trừ Đồng Phục', 'Tổng Cộng', 'Tổng Lương', 'Thực Lãnh', 'Ký Lập (tên)', 'Ký Lập Lúc', 'Ký QL (tên)', 'Ký QL Lúc', 'Ký NV (tên)', 'Ký NV Lúc', 'Ảnh Ký Lập', 'Ảnh Ký QL', 'Ảnh Ký NV', 'Phát Hành Lúc', 'Xác Nhận Lúc', 'Chi Trả Lúc', 'Phụ Cấp (cấu hình)'],
  },
  {
    title: 'CONG_THUC_LUONG',
    headers: ['Kỳ Lương', 'Đơn Giá TV', 'Đơn Giá CT', 'Không Dùng', 'Ngưỡng Tăng Ca 1 (h)', 'Ngưỡng Tăng Ca 2 (h)', 'Người Cập Nhật', 'Cập Nhật Lúc'],
  },
  {
    title: 'DULIEU_LUONG_KY',
    headers: ['Kỳ Lương', 'ID Nhân Viên', 'Lương CB (tay)', 'OT Thêm (tay)', 'Bonus Thêm (tay)', 'Ứng Lương', 'Trừ KPI (tay)', 'Trừ Đồng Phục', 'Ghi Chú', 'Người Cập Nhật', 'Cập Nhật Lúc'],
  },
  {
    title: 'LICH_SU_GIAI_DOAN',
    headers: ['ID Giai Đoạn', 'ID Nhân Viên', 'Giai Đoạn', 'Hiệu Lực Từ', 'Lương Giờ', 'Người Duyệt', 'Ghi Chú', 'Phiên Bản', 'Ngày Tạo'],
  },
  {
    // Thông báo đã gửi (outbox): dữ liệu gốc của tab "Thông báo" / "Tạo thông báo"
    // / "Lịch phát thông báo" / "Nội dung đã phát" (MKT). Inbox NV nằm ở THONGBAO_NV.
    title: 'THONGBAO_GUI',
    headers: ['ID Thông Báo', 'ID Sự Kiện', 'Mã Chống Trùng', 'Người Nhận', 'Loại', 'Mức Độ', 'Tiêu Đề', 'Nội Dung', 'Đường Dẫn Tab', 'Kênh Gửi', 'Trạng Thái Gửi', 'Số Lần Gửi', 'Lỗi Cuối', 'Thời Gian Tạo'],
  },
  {
    // Metadata snapshot Sao lưu & Phục hồi (tab 16 ADMIN) — list snapshot trước đây
    // chỉ nằm bộ nhớ, restart là mất.
    title: 'SNAPSHOT_SAOLUU',
    headers: ['ID Snapshot', 'Tên', 'Thời Gian Tạo', 'Số File/Tab', 'Dung Lượng (MB)', 'Trạng Thái', 'Đã Kiểm Chứng'],
  },
];

/**
 * Merge pull Sheets với bộ nhớ: bản version lớn hơn thắng (giữ trạng thái
 * duyệt/nộp vừa thao tác chưa kịp push), bản chỉ có trong bộ nhớ được giữ lại.
 * Chống cả họ lỗi "bấm duyệt báo lưu nhưng reload lại như cũ".
 */
function mergeById<T extends Record<string, any>>(memory: T[], sheets: T[], idKey: string, versionKeys: string[]): T[] {
  const mem = new Map<string, T>((memory || []).map(m => [String(m[idKey]), m]));
  const out: T[] = [];
  for (const s of sheets || []) {
    const key = String((s as any)[idKey]);
    const m = mem.get(key);
    if (m) {
      const mv = Math.max(...versionKeys.map(k => Number((m as any)[k] || 0)));
      const sv = Math.max(...versionKeys.map(k => Number((s as any)[k] || 0)));
      out.push(mv > sv ? m : s);
    } else {
      out.push(s);
    }
    mem.delete(key);
  }
  for (const m of mem.values()) out.push(m);
  return out;
}

/**
 * Gộp nhập tay theo kỳ (DULIEU_LUONG_KY) từ Sheet vào bộ nhớ.
 *
 * Quy tắc sống còn: KHÔNG để bản Sheet cũ đè lên ô Kế toán vừa nhập. Trước đây
 * pull `Object.assign` vô điều kiện nên sau khi lưu (bộ nhớ mới, Sheet chưa kịp
 * đẩy) lượt pull kế tiếp trả số cũ/0 → "lưu xong F5 mất dữ liệu".
 * - Bản có `updatedAt` mới hơn thắng.
 * - Sheet thiếu mốc thời gian không bao giờ đè bản bộ nhớ CÓ mốc.
 * - Số đọc bằng `parseSheetNumber` để hiểu định dạng VN ("1.500.000").
 */
export function mergePayrollInputRows(memory: any[], inputRows: any[][]): any[] {
  const out: any[] = Array.isArray(memory) ? memory : [];
  const tsOf = (v: any): number => {
    const t = Date.parse(String(v || '').trim());
    return Number.isFinite(t) ? t : 0;
  };
  for (const r of inputRows || []) {
    if (!r || !r[0] || !r[1]) continue;
    const row = {
      period: normalizeSheetPeriod(r[0]),
      employee_id: String(r[1]).trim(),
      luong_cb: parseSheetCurrency(r[2]) ?? 0,
      ot_extra: parseSheetCurrency(r[3]) ?? 0,
      bonus_extra: parseSheetCurrency(r[4]) ?? 0,
      ung_luong: parseSheetCurrency(r[5]) ?? 0,
      tru_kpi: parseSheetCurrency(r[6]) ?? 0,
      dong_phuc: parseSheetCurrency(r[7]) ?? 0,
      note: r[8] ? String(r[8]) : undefined,
      updatedBy: r[9] ? String(r[9]) : undefined,
      updatedAt: r[10] ? String(r[10]) : undefined,
    };
    const ex = out.find((x: any) => x.period === row.period && x.employee_id === row.employee_id);
    if (!ex) {
      out.push(row);
      continue;
    }
    const sheetAt = tsOf(row.updatedAt);
    const memAt = tsOf(ex.updatedAt);
    // Bộ nhớ mới hơn (vừa lưu, Sheet chưa kịp đẩy) -> giữ bộ nhớ.
    // Bộ nhớ chưa có mốc -> nhận bản Sheet (nguồn cũ duy nhất).
    if (memAt > 0 && (sheetAt === 0 || sheetAt < memAt)) continue;
    Object.assign(ex, row);
  }
  return out;
}

/**
 * Một ô Google Sheets chỉ nhận tối đa 50.000 ký tự. Cài đặt hệ thống có thể chứa
 * giá trị rất lớn (lịch sử điểm danh VP, phiên Zalo, danh sách yêu cầu...). Nếu
 * ghi thẳng, Google từ chối CẢ lượt ghi và `employee_salary_config` (cấu hình
 * lương) không bao giờ lên Sheet. Vì vậy giá trị lớn được CHIA THÀNH NHIỀU DÒNG
 * (`<key>::part1/N`) và được ghép lại khi pull.
 */
export const SETTINGS_CELL_MAX_CHARS = 45_000;
const SETTINGS_CELL_CHUNK_CHARS = 40_000;
const SETTINGS_CHUNK_KEY_RE = /^(.*)::part(\d+)\/(\d+)$/;

export function buildSystemSettingsRows(
  settings: any,
  now = new Date().toISOString(),
): { rows: any[]; chunkedKeys: string[] } {
  const rows: any[] = [];
  const chunkedKeys: string[] = [];
  for (const [k, v] of Object.entries(settings || {})) {
    const raw = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '');
    if (raw.length <= SETTINGS_CELL_MAX_CHARS) {
      rows.push([k, raw, `Cấu hình tham số ${k}`, now]);
      continue;
    }
    const total = Math.ceil(raw.length / SETTINGS_CELL_CHUNK_CHARS);
    for (let i = 0; i < total; i++) {
      rows.push([
        `${k}::part${i + 1}/${total}`,
        raw.slice(i * SETTINGS_CELL_CHUNK_CHARS, (i + 1) * SETTINGS_CELL_CHUNK_CHARS),
        `Cấu hình tham số ${k} (phần ${i + 1}/${total})`,
        now,
      ]);
    }
    chunkedKeys.push(k);
  }
  return { rows, chunkedKeys };
}

export function parseSystemSettingsRows(configRows: any[]): any {
  const settingsObj: any = {};
  const chunks = new Map<string, { total: number; parts: Record<number, string> }>();
  for (const r of configRows || []) {
    const key = String(r?.[0] ?? '').trim();
    const val = r?.[1];
    if (!key) continue;
    // Bản ghi cũ từng ghi chuỗi đánh dấu "bỏ qua" cho key quá lớn — không phải
    // dữ liệu thật, giữ nguyên giá trị đang có trong bộ nhớ.
    if (typeof val === 'string' && /^\s*\[BỎ QUA:/.test(val)) continue;
    if (val === undefined || val === null) continue;
    const m = key.match(SETTINGS_CHUNK_KEY_RE);
    if (m) {
      const base = m[1];
      const idx = Number(m[2]);
      const total = Number(m[3]);
      if (!base || !Number.isFinite(idx) || !Number.isFinite(total) || idx < 1 || idx > total) continue;
      const cur = chunks.get(base) || { total, parts: {} };
      cur.total = total;
      cur.parts[idx] = String(val);
      chunks.set(base, cur);
      continue;
    }
    try {
      settingsObj[key] = JSON.parse(val);
    } catch {
      settingsObj[key] = val;
    }
  }
  // Ghép các key bị chia phần; thiếu phần nào thì BỎ (giữ nguyên bộ nhớ) thay vì
  // đọc về một giá trị cụt gây hỏng cấu hình.
  for (const [base, c] of chunks) {
    const parts: string[] = [];
    let complete = true;
    for (let i = 1; i <= c.total; i++) {
      if (typeof c.parts[i] !== 'string') { complete = false; break; }
      parts.push(c.parts[i]);
    }
    if (!complete) {
      console.warn(`[GoogleSheetsSyncService] Bỏ qua giá trị chia phần thiếu dữ liệu: ${base}`);
      continue;
    }
    const joined = parts.join('');
    try {
      settingsObj[base] = JSON.parse(joined);
    } catch {
      settingsObj[base] = joined;
    }
  }
  return settingsObj;
}

/**
 * Gộp cấu hình đọc từ Sheet vào cấu hình đang có trong BỘ NHỚ.
 *
 * - `employee_salary_config`: gộp theo từng nhân viên, so `updatedAt`.
 * - Mọi khóa dạng object có `updatedAt` (VD `financeColumnVis:<adminId>` của
 *   tính năng ẩn/hiện cột Kế toán): nếu bộ nhớ MỚI HƠN thì GIỮ bộ nhớ.
 *   Không có bước này, lượt pull kế tiếp (45s/lần, hoặc pull do chính GET
 *   `/payroll/table-columns` kích hoạt) sẽ ghi đè bản vừa lưu bằng bản Sheet
 *   cũ → "bấm lưu xong tải lại trang là mất".
 */
export function mergeSystemSettingsFromSheet(curSettings: any, settingsObj: any): any {
  const cur: any = curSettings && typeof curSettings === 'object' ? curSettings : {};
  const sheet: any = settingsObj && typeof settingsObj === 'object' ? settingsObj : {};
  const merged: any = { ...cur, ...sheet };

  const memoTime = (v: any) => Date.parse(String(v?.updatedAt || '')) || 0;

  const sheetSalary = sheet['employee_salary_config'];
  const memSalary = cur['employee_salary_config'];
  if (memSalary && typeof memSalary === 'object' && sheetSalary && typeof sheetSalary === 'object') {
    const map: any = { ...memSalary };
    for (const [eid, sheetEntry] of Object.entries(sheetSalary as Record<string, any>)) {
      const memEntry = map[eid];
      if (!memEntry || memoTime(sheetEntry) > memoTime(memEntry)) map[eid] = sheetEntry;
    }
    merged['employee_salary_config'] = map;
  }

  for (const k of Object.keys(sheet)) {
    if (k === 'employee_salary_config') continue;
    const sheetV: any = sheet[k];
    const memV: any = cur[k];
    if (!memV || !sheetV || typeof memV !== 'object' || typeof sheetV !== 'object') continue;
    if (memoTime(memV) > memoTime(sheetV)) merged[k] = memV;
  }
  return merged;
}

export class GoogleSheetsSyncService {
  private sheetsClient: sheets_v4.Sheets | null = null;
  private driveClient: drive_v3.Drive | null = null;
  /** JWT auth gốc — dùng cho probe raw fetch (không qua googleapis) để loại trừ lỗi client. */
  private authClient: any = null;
  private spreadsheetId: string;
  private candidateSpreadsheetId: string;
  /** Cache rows ứng viên: tab form đổi chậm, đọc mỗi pull 5s sẽ vượt quota
   *  read 60/phút/service account. Đọc lại tối đa 5s/lần (SHEETS_CANDIDATE_PULL_MS);
   *  vẫn giữ hash cũ trong lúc bỏ qua để không báo "đổi" giả. */
  private lastCandidateRows: string[][] = [];
  private lastCandidatePullAt = 0;
  /** Mốc tạm ngưng đọc lại nguồn form sau lỗi quota/mạng (tránh đốt hạn mức). */
  private candidateReadBackoffUntil = 0;
  /**
   * Hash nội dung Spreadsheet NGUỒN (form ứng viên, CANDIDATE_SPREADSHEET_ID)
   * ở lượt đọc thành công gần nhất. Khi hash đổi (dòng mới / sửa ô), Spreadsheet
   * đích `FROM_NHAN_VIEN` phải được đẩy lại ngay — nếu không, ứng viên nộp form
   * chỉ nằm trong bộ nhớ mà không bao giờ tự xuất hiện trên Sheet đích (auto-push
   * 60 phút chỉ chạy khi cờ dirty, mà pull nguồn không đặt cờ dirty).
   */
  private lastCandidateSourceSignature: string | null = null;
  /** Bản đọc tab FROM_NHAN_VIEN (master) dùng để phủ lịch PV/Zalo — đưa vào
   *  hash nội dung để sửa tay lịch PV trên master cũng bắn realtime. */
  private lastMasterCandidateRows: string[][] = [];
  private driveFolderId: string;
  private driveAuthMode: GoogleDriveAuthMode = 'none';
  private driveAuthAccount = '';
  private isConfigured = false;
  private authError: string | null = null;
  private lastPulledAt: number = 0;
  /** Mốc pull TOÀN BỘ (không phải webhook 1 tab) gần nhất — adapter dùng để biết
   *  snapshot khởi động đã được thay bằng dữ liệu tươi hay chưa. */
  private lastFullPullAt: number = 0;
  /** Lỗi pull gần nhất (null = lần gần nhất thành công) — hiện ở /health để
   *  chẩn đoán khi dữ liệu đứng yên mà không cần vào log container. */
  private lastPullError: string | null = null;
  /** Hash nội dung lần pull gần nhất — phát hiện sửa ô dù số dòng không đổi. */
  private lastDataSignature: string | null = null;
  /** Hash từng tab lần pull trước — cho biết tab nào vừa đổi (config cần reload riêng). */
  private lastTabSignatures: Record<string, string> = {};
  /** Counts lần pull gần nhất — lưu kèm snapshot để health hiển thị ngay sau restart. */
  private lastSnapshotCounts: any = null;
  /** Bản đọc thô gần nhất của tất cả tab — webhook chỉ cần đọc lại 1 tab rồi
   *  chạy lại parser trên cache thay vì batchGet 24 tab. */
  private lastFullBatch: Record<string, string[][]> | null = null;
  /**
   * Tab NHẬT KÝ phình rất nhanh (THONGBAO_NV từng >56.000 dòng, THONGBAO_GUI
   * >15.000). Chúng không cần realtime 5 giây nhưng lại chiếm ~80% số ô mỗi lần
   * batchGet → pull bị chậm, CPU hash/parse bị block, request khác xếp hàng.
   * Vì vậy chỉ đọc theo nhịp riêng (SHEETS_HISTORY_PULL_MS, mặc định 120s) và
   * dùng lại bản đọc gần nhất cho các nhịp còn lại.
   */
  public static readonly HISTORY_TABS = new Set<string>([
    'THONGBAO_NV',
    'THONGBAO_GUI',
    'SNAPSHOT_SAOLUU',
  ]);
  private lastHistoryBatch: Record<string, string[][]> = {};
  /** Dòng cuối đã đọc của tab nhật ký (để lượt sau chỉ đọc đuôi). */
  private historyLastRow = new Map<string, number>();
  private lastHistoryPullAt = 0;
  private lastHistoryTabSignatures: Record<string, string> = {};
  private lastHistorySignature = '';
  /** Thời gian pull gần nhất (ms) — hiển thị ở /health để phát hiện pull chậm. */
  private lastPullDurationMs = 0;
  /** Callback realtime: server.ts đăng ký 1 lần để bắn socket khi nội dung đổi. */
  private dataChangeListeners: Array<(info: { signature: string; counts: any; changedTabs: string[] }) => void> = [];
  /** Mốc pull gần nhất đã xử lý xong tab CAU_HINH_HE_THONG (null = chưa từng).
   *  Đọc bảo trì đợi mốc này để không trả seed OFF ngay sau boot. */
  public lastSettingsPullAt: number | null = null;
  /** Lỗi ghi CAU_HINH_HE_THONG gần nhất (rỗng = thành công). */
  private lastSystemSettingsWriteError = '';
  /** Trạng thái đồng bộ cấu hình (đặc biệt employee_salary_config) lên Sheet —
   *  API cấu hình lương trả về cho UI để KHÔNG báo "đã đồng bộ" khi Sheet lỗi. */
  public systemSettingsSheetSyncState: {
    at: string;
    ok: boolean | null;
    error: string;
    pending: boolean;
    skipped?: string;
  } = { at: '', ok: null, error: '', pending: false };
  /** Mốc reset hộp thư 23h00 (ISO): pull chỉ giữ thông báo tạo sau mốc này trong
   *  ngày reset, để hộp thư đã reset tối không bị dòng Sheet cũ kéo lại đầy ngay.
   *  Qua ngày mới thì tự xả latch (mốc cũ hơn 00h00 hôm nay). */
  public notifResetCutoffIso: string | null = null;
  private beautifyInFlight: Promise<{ success: boolean; message: string; formattedTabs: number }> | null = null;
  private lastBeautifyAt = 0;
  /** Tombstone NV vừa xóa: pull trong ~120s sau xóa mà thấy ID này trên Sheet
   *  (push xóa chưa kịp chạy) thì bỏ qua, tránh xóa xong bị khôi phục lại. */
  private deletedEmployeeIds = new Map<string, number>();
  /** Tombstone sự kiện điểm danh vừa xóa (GPS vượt): pull trước khi push xóa kịp
   *  mà đọc lại dòng cũ thì bỏ qua, tránh hồi sinh trong ~120s. */
  // ===== BETA: TỰ CHIA TAB CHỐNG PHÌNH (partition) =====
  // Tab chỉ-ghi-thêm (append-only) phình theo thời gian: chấm công, kho lưu
  // trữ tuần, outbox thông báo, audit. Tab >VẠN dòng -> đọc (batchGet) value
  // nặng + append chậm dần. Khi tab đủ ngưỡng -> tự tạo tab `_P2`, `_P3`...
  // (cùng header) rồi ghi tiếp; khi đọc về bộ nhớ GỘP các part theo thứ tự
  // nên phần còn lại của app không cần biết. 8 triệu ô/spreadsheet là giới
  // hạn Google — ước lượng ô xem estimateCellUsage (/health + cảnh báo).
  public static readonly PARTITION_ROW_LIMIT = 15_000;
  public static readonly PARTITION_TABS = new Set<string>([
    'SU_KIEN_DIEM_DANH',
    'LUUTRU_CHAMCONG_TUAN',
    'THONGBAO_GUI',
    'AUDIT_LOG',
  ]);

  /** Các tab dữ liệu sống còn tuyệt đối không được phép ghi đè rỗng (0 dòng) làm mất data */
  public static readonly CRITICAL_TABS = new Set<string>([
    'NHAN_VIEN_MASTER',
    'TAI_KHOAN_NHAN_VIEN',
    'ADMIN_ACCOUNTS',
    'PHAN_CONG_CA',
    'SU_KIEN_DIEM_DANH',
    'DON_NGHI_PHEP',
    'DON_DOI_CA',
    'DIEU_CHINH_CONG',
    'KY_LUONG',
    'PHIEU_LUONG',
    'DANH_SACH_CHI_NHANH',
  ]);

  /** Cache số dòng dữ liệu từng tab (không đếm mỗi lần ghi; thiếu = không xoay). */
  private partRowCounts = new Map<string, number>();
  /**
   * Cache số dòng LƯỚI (gridProperties.rowCount) theo tab, lấy từ metadata.
   * Metadata nhanh và ổn định hơn `values.get A2:A` — trước đây mỗi lần append
   * vào tab partition lại đọc cả cột A; khi tab lớn, lệnh đọc treo 20–30s nên
   * không bao giờ xoay được part và append dồn mãi vào tab khổng lồ.
   */
  private tabGridCache = new Map<string, { at: number; rows: number }>();
  /** Cache danh sách tab hiện hữu theo từng spreadsheet (10 phút). */
  private tabListCache = new Map<string, { at: number; titles: string[] }>();
  /** Cache ước lượng ô đã dùng (6 giờ). */
  private cellUsageCache: { at: number; data: { cellsUsed: number; cellsLimit: number; pct: number; level: 'OK' | 'WARN' | 'CRITICAL'; measuredTabs: number } } | null = null;
  /**
   * Cache dòng thô của kho lưu trữ chấm công tuần cũ (LUUTRU_CHAMCONG_TUAN).
   * Tab này chỉ đổi khi archive tuần mới hoặc Admin xóa 1 lượt, nhưng trước đây
   * MỖI lần đọc là 1 batchGet toàn tab. Mở tab "Dữ Liệu Công Của Tôi" gọi hàm
   * này nhiều lượt (attendance tháng + monthly-timesheet) nên từng mất vài giây
   * → cache + gộp request đang bay để chỉ còn tối đa 1 lượt đọc.
   */
  private archiveRowsCache: { at: number; rows: string[][] } | null = null;
  private archiveRowsInFlight: Promise<string[][]> | null = null;
  private archiveCacheEpoch = 0;
  private static readonly ARCHIVE_CACHE_TTL_MS = 120_000;

  /** Health endpoint đọc giá trị đã cache (không phát API call). */
  public getCachedCellUsage() {
    return this.cellUsageCache?.data ?? null;
  }

  private deletedEventIds = new Map<string, number>();

  public markAttendanceEventDeleted(eventId: string) {
    if (eventId) this.deletedEventIds.set(String(eventId).trim(), Date.now());
  }

  private isEventDeletedRecently(eventId: string): boolean {
    const t = this.deletedEventIds.get(String(eventId || '').trim());
    if (!t) return false;
    if (Date.now() - t > 120000) {
      this.deletedEventIds.delete(String(eventId).trim());
      return false;
    }
    return true;
  }

  public markEmployeeDeleted(employeeId: string) {
    if (employeeId) this.deletedEmployeeIds.set(String(employeeId).trim(), Date.now());
  }

  /** Tombstone tài khoản vừa xóa (kể cả dòng mồ côi): pull trong ~120s sau xóa
   *  mà thấy dòng này trên Sheet (push xóa chưa kịp chạy) thì bỏ qua, tránh hồi sinh. */
  private deletedAccountIds = new Map<string, number>();

  public markAccountDeleted(accountId: string) {
    if (accountId) this.deletedAccountIds.set(String(accountId).trim(), Date.now());
  }

  private isAccountDeletedRecently(accountId: string, employeeId?: string): boolean {
    const check = (k: string): boolean => {
      const t = this.deletedAccountIds.get(k);
      if (!t) return false;
      if (Date.now() - t > 120000) {
        this.deletedAccountIds.delete(k);
        return false;
      }
      return true;
    };
    const a = String(accountId || '').trim();
    const e = String(employeeId || '').trim();
    return (a !== '' && check(a)) || (e !== '' && check(e));
  }

  private isEmployeeDeletedRecently(employeeId: string): boolean {
    const t = this.deletedEmployeeIds.get(String(employeeId || '').trim());
    if (!t) return false;
    if (Date.now() - t > 120000) {
      this.deletedEmployeeIds.delete(String(employeeId).trim());
      return false;
    }
    return true;
  }

  /** Tombstone lịch PV vừa hủy (tay/auto sau 5p không vào Meet): pull overlay
   *  FROM_NHAN_VIEN trong ~120s sau hủy mà thấy dòng lịch cũ (push chưa kịp chạy)
   *  thì ÉP XÓA lịch thay vì hồi sinh — trước đây hủy xong reload là lịch về lại. */
  private clearedInterviewIds = new Map<string, number>();

  public markInterviewScheduleCleared(submissionId: string) {
    if (submissionId) this.clearedInterviewIds.set(String(submissionId).trim(), Date.now());
  }

  private isInterviewScheduleClearedRecently(submissionId: string): boolean {
    const k = String(submissionId || '').trim();
    const t = this.clearedInterviewIds.get(k);
    if (!t) return false;
    if (Date.now() - t > 120000) {
      this.clearedInterviewIds.delete(k);
      return false;
    }
    return true;
  }
  /** ===== AUTO-PUSH ĐIỀU KIỆN (chỉ push khi có thay đổi thật) =====
   *  Adapter đánh dấu dirty khi dữ liệu bộ nhớ đổi mà chưa chắc đã lên Sheet
   *  (scheduleSheetsWrite / scheduleFullSync / backfill PIN). Auto-push định kỳ
   *  chỉ chạy khi dirty > lần push đầy đủ trước. Trước đây mỗi 5 phút là ghi đè
   *  ~34-40 write dù không có gì đổi — lấp quota 60 write/phút của Google, các
   *  thao tác người dùng (check-in, duyệt phiếu) phải xếp hàng chờ slot write
   *  1.1s/write nên 2 cổng web cập nhật rất chậm. */
  // Khởi tạo ban đầu KHÔNG dirty (0): khi mới khởi động, hệ thống PHẢI pull từ
  // Google Sheets Master về trước. Chỉ đánh dấu dirty khi có thay đổi thực sự
  // trong bộ nhớ chưa được lưu lên Sheet (tránh nguy cơ push đè RAM rỗng).
  private dataDirtyAt: number = 0;
  private lastFullPushAt: number = 0;

  public markDataDirty(): void {
    this.dataDirtyAt = Date.now();
  }

  /** true = bộ nhớ có thay đổi chưa được push đầy đủ lên Sheet. */
  public hasUnpushedChanges(): boolean {
    return this.dataDirtyAt > this.lastFullPushAt;
  }

  private lastWriteError: string | null = null;
  private lastWriteAt: number = 0;
  private initOkAt = 0;
  private lastInitResult: { success: boolean; createdSheets: string[]; existingSheets: string[]; message: string } | null = null;

  /** Minimum interval between write requests to stay under 60 writes/minute quota. */
  private static readonly WRITE_RATE_LIMIT_MS = 1100;

  /** Số cột (1-based) -> chữ cột Sheets (1=A ... 26=Z, 27=AA, 39=AM...).
   *  Mọi range cứng A1:Z/A2:Z cũ đều vỡ với tab >26 cột (PHIEU_LUONG 40 cột,
   *  FROM_NHAN_VIEN 26 cột) — ghi thì 400, đọc thì mất cột AA+. */
  public static colLetter(n: number): string {
    let s = '';
    let x = Math.max(1, Math.floor(n));
    while (x > 0) {
      const m = (x - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      x = Math.floor((x - 1) / 26);
    }
    return s;
  }

  /** Bọc mọi gọi Google API bằng timeout + rate limiting cho write operations. */
  private withDeadline<T>(label: string, fn: () => Promise<T>, ms: number): Promise<T> {
    let timer: any = null;
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`SHEETS_TIMEOUT:${label} (${ms}ms)`)), ms);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  /**
   * Xếp hàng TUẦN TỰ cho mọi lệnh GHI Google Sheets, CÓ ƯU TIÊN.
   *
   * Google khoá ghi theo từng spreadsheet: nhiều request ghi cùng lúc thì các
   * request sau phải chờ và dễ vượt timeout. Tệ hơn, timeout bằng `Promise.race`
   * chỉ bỏ qua kết quả chứ KHÔNG huỷ request HTTP — request "zombie" vẫn giữ
   * khoá ghi, khiến lần ghi kế tiếp lại timeout, tạo vòng xoáy không lối thoát.
   *
   * Vì vậy: chỉ 1 lệnh ghi in-flight. Lệnh append (điểm danh/thông báo/phiếu —
   * dữ liệu người dùng vừa tạo) được chen trước full-sync (24 tab), tránh việc
   * một lượt full-sync chậm chặn toàn bộ hàng đợi.
   */
  private writeBusy = false;
  private writeWaiters: Array<{ high: boolean; resolve: () => void }> = [];

  private acquireWrite(high: boolean): Promise<void> {
    if (!this.writeBusy) {
      this.writeBusy = true;
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      const waiter = { high, resolve };
      if (high) {
        const idx = this.writeWaiters.findIndex(w => !w.high);
        if (idx === -1) this.writeWaiters.push(waiter);
        else this.writeWaiters.splice(idx, 0, waiter);
      } else {
        this.writeWaiters.push(waiter);
      }
    });
  }

  private releaseWrite(): void {
    const next = this.writeWaiters.shift();
    if (next) next.resolve();
    else this.writeBusy = false;
  }

  private isQuotaError(err: any): boolean {
    const msg = String(err?.message || err || '');
    return /quota|429|rate limit|too many requests|RESOURCE_EXHAUSTED/i.test(msg);
  }

  private async sheetsCall<T>(label: string, fn: () => Promise<T>, ms = 20000): Promise<T> {
    const isWrite = label.startsWith('write.')
      || label.startsWith('append.')
      || label.startsWith('clear.')
      || label.startsWith('part.add.')
      || label.startsWith('part.header.')
      || label.startsWith('probe.append.')
      || label.startsWith('probe.writeTiny')
      || label.startsWith('probe.createTemp')
      || label.startsWith('probe.writeTemp')
      || label === 'init.batchUpdate'
      || label === 'probe.noopBatchUpdate';

    if (!isWrite) return this.withDeadline(label, fn, ms);

    const high = label.startsWith('append.') || label.startsWith('part.header.');
    await this.acquireWrite(high);
    try {
      // Quota Google là per-phút và thoáng qua: ghi Sheet cần tự thử lại thay vì
      // bỏ luôn (trước đây hỏng 1 lần là chờ lượt auto-push sau tới 60 phút —
      // người dùng sửa lương mãi không thấy lên Sheet). Tối đa 5 lần, lùi dần
      // 2s/5s/10s/20s/40s (giữ khóa ghi để không tràn lượt khác lên trước).
      const backoffs = [2000, 5000, 10000, 20000, 40000];
      for (let attempt = 0; ; attempt++) {
        const now = Date.now();
        const wait = Math.max(0, GoogleSheetsSyncService.WRITE_RATE_LIMIT_MS - (now - this.lastWriteAt));
        if (wait > 0) {
          await new Promise(r => setTimeout(r, wait));
        }
        this.lastWriteAt = Date.now();
        // Ghi thật (duyệt phiếu, điểm danh, đẩy tab...) — job dọn rule sẽ nhường.
        if (!label.startsWith('write.beautify.')) this.lastUserWriteAt = Date.now();
        try {
          return await this.withDeadline(label, fn, ms);
        } catch (err: any) {
          if (attempt >= backoffs.length || !this.isQuotaError(err)) throw err;
          console.warn(`[GoogleSheetsSyncService] ${label} chạm quota (lần ${attempt + 1}/${backoffs.length + 1}) — chờ ${backoffs[attempt]}ms rồi thử lại.`);
          await new Promise(r => setTimeout(r, backoffs[attempt]));
        }
      }
    } finally {
      this.releaseWrite();
    }
  }

  /** Lỗi ghi gần nhất cho /health chẩn đoán (vì sao Sheet không có dữ liệu mới). */
  public getWriteStatus() {
    return {
      lastWriteError: this.lastWriteError,
      lastWriteAt: this.lastWriteAt ? new Date(this.lastWriteAt).toISOString() : null,
    };
  }

  private markWriteOk() {
    this.lastWriteError = null;
    this.lastWriteAt = Date.now();
  }

  private markWriteFail(where: string, err: any) {
    const msg = `${where}: ${this.describeGoogleError(err)}`;
    this.lastWriteError = msg;
    console.warn(`[GoogleSheetsSyncService] ${msg}`);
  }

  /** Mô tả lỗi Google kèm mã HTTP + body để /health chẩn đoán được (429? 403?). */
  private describeGoogleError(err: any): string {
    const base = String(err?.message || err || 'UNKNOWN');
    const status = err?.response?.status ?? err?.code ?? null;
    let body = err?.response?.data;
    if (body && typeof body !== 'string') {
      try { body = JSON.stringify(body); } catch { body = String(body); }
    }
    const detail = typeof body === 'string' ? body.slice(0, 300) : '';
    return `${base}${status ? ` [HTTP ${status}]` : ''}${detail ? ` ${detail}` : ''}`;
  }

  constructor() {
    this.spreadsheetId = process.env.SPREADSHEET_ID || process.env.GOOGLE_SPREADSHEET_ID || '1UO1UF1d7_YzaCltYt2m9pRnUauGWw873ERqAMxwL-6k';
    this.candidateSpreadsheetId = process.env.CANDIDATE_SPREADSHEET_ID || '1rcqEKraSRhr-Tn9qwlhADlkQUei8j65bXeHF_Tmkd38';
    this.driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '';

    this.initClient();
  }

  /**
   * Spreadsheet đích của 1 tab: mỗi bảng nghiệp vụ nằm trong 1 file Google
   * Sheets RIÊNG (bộ 25 sheet). Chỉ tab không có trong bản đồ mới rớt về file
   * tổng hợp cũ.
   */
  private spreadsheetIdOf(tabTitle: string): string {
    return getSpreadsheetIdForTab(tabTitle, this.spreadsheetId);
  }

  private initClient() {
    let email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    let key = process.env.GOOGLE_PRIVATE_KEY;

    let jsonStr = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
    if (jsonStr && !jsonStr.startsWith('{') && /^[A-Za-z0-9+/=]+$/.test(jsonStr)) {
      try {
        jsonStr = Buffer.from(jsonStr, 'base64').toString('utf8');
      } catch (_) {}
    }

    if (!jsonStr && (!email || !key)) {
      const candidates = [
        process.env.GOOGLE_SERVICE_ACCOUNT_FILE,
        path.resolve(process.cwd(), 'key.json'),
        path.resolve(__dirname, '../../../../key.json'),
        path.resolve(process.cwd(), 'data/service-account.json'),
        '/app/data/service-account.json',
      ].filter(Boolean) as string[];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          try {
            jsonStr = fs.readFileSync(p, 'utf8');
            console.log(`[GoogleSheetsSyncService] Đã nạp credentials từ file: ${p}`);
            break;
          } catch (_) {}
        }
      }
    }

    if (jsonStr) {
      try {
        const creds = JSON.parse(jsonStr);
        if (creds.client_email && creds.private_key) {
          email = creds.client_email;
          key = creds.private_key;
        }
      } catch (err: any) {
        this.authError = `Lỗi parse GOOGLE_SERVICE_ACCOUNT_JSON: ${err.message}`;
        console.error('[GoogleSheetsSyncService]', this.authError);
        return;
      }
    }

    if (!email || !key) {
      this.authError = 'Chưa thiết lập GOOGLE_SERVICE_ACCOUNT_JSON hoặc GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY trong biến môi trường';
      // Vẫn cho phép Drive chạy bằng OAuth2 (Sheets có thể dùng kênh khác).
      this.initDriveClientOAuthOnly();
      return;
    }

    try {
      const formattedKey = key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;

      const auth = new google.auth.JWT({
        email,
        key: formattedKey,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive',
        ],
      });
      this.authClient = auth;

      // Chống request ghi "zombie" giữ khoá spreadsheet: đặt timeout HTTP thật
      // (huỷ socket) + tắt retry ẩn của gaxios (retry ẩn nhân bản lệnh ghi và
      // làm timeout của ta không còn ý nghĩa). SHEETS_HTTP_TIMEOUT_MS cấu hình.
      const httpTimeoutMs = Math.max(5_000, Number(process.env.SHEETS_HTTP_TIMEOUT_MS) || 25_000);
      (google as any).options?.({ timeout: httpTimeoutMs, retry: false });

      this.sheetsClient = google.sheets({ version: 'v4', auth });

      // Drive: ưu tiên OAuth2 (Gmail sở hữu thư mục) — Service Account không có
      // quota trên My Drive nên ảnh sẽ luôn rơi về DRV_LOCAL nếu chỉ dùng SA.
      const oauth = createDriveOAuthClient(['https://www.googleapis.com/auth/drive']);
      if (oauth) {
        this.driveClient = google.drive({ version: 'v3', auth: oauth });
        this.driveAuthMode = 'oauth';
        this.driveAuthAccount = String(process.env.GOOGLE_OAUTH_ACCOUNT_EMAIL || 'OAuth2 Gmail');
      } else {
        this.driveClient = google.drive({ version: 'v3', auth });
        this.driveAuthMode = 'service-account';
        this.driveAuthAccount = email;
      }

      this.isConfigured = true;
      this.authError = null;
      console.log(`[GoogleSheetsSyncService] Đã kích hoạt Google Sheets API & Google Drive API thành công cho: ${email} • Drive auth: ${describeDriveAuth(this.driveAuthMode, this.driveAuthAccount)}`);
    } catch (err: any) {
      this.authError = `Lỗi khởi tạo JWT Auth: ${err.message}`;
      console.error('[GoogleSheetsSyncService]', this.authError);
    }
  }

  /** Chỉ khởi tạo Drive bằng OAuth2 khi không có Service Account (Postgres + Drive riêng). */
  private initDriveClientOAuthOnly() {
    const oauth = createDriveOAuthClient(['https://www.googleapis.com/auth/drive']);
    if (!oauth) return;
    this.driveClient = google.drive({ version: 'v3', auth: oauth });
    this.driveAuthMode = 'oauth';
    this.driveAuthAccount = String(process.env.GOOGLE_OAUTH_ACCOUNT_EMAIL || 'OAuth2 Gmail');
    console.log(`[GoogleSheetsSyncService] Drive API qua OAuth2 sẵn sàng (${this.driveAuthAccount}) — Sheets chưa cấu hình Service Account.`);
  }

  /**
   * Đăng ký nhận thông báo khi nội dung Google Sheets thay đổi (đã pull xong).
   * Một thay đổi chỉ phát 1 lần dù nhiều nơi dùng chung một pull (tick + webhook).
   */
  public onDataChanged(listener: (info: { signature: string; counts: any; changedTabs: string[] }) => void): () => void {
    this.dataChangeListeners.push(listener);
    return () => {
      this.dataChangeListeners = this.dataChangeListeners.filter(l => l !== listener);
    };
  }

  /** Mốc pull toàn bộ gần nhất (ms) — adapter dùng để đánh giá snapshot khởi động. */
  public getLastFullPullAtMs(): number {
    return this.lastFullPullAt;
  }

  public getStatus() {
    return {
      isConfigured: this.isConfigured,
      /**
       * Chế độ lưu trữ: dữ liệu nghiệp vụ realtime nằm trong bộ 25 Google
       * Spreadsheet riêng (mỗi bảng 1 file). `spreadsheetId` bên dưới chỉ còn
       * là file tổng hợp cũ, giữ lại làm fallback cho tab không có trong map.
       */
      storageMode: 'SEPARATED_25_SHEETS' as const,
      separatedSheets: true,
      separatedSheetCount: listSeparatedSpreadsheetIds().length,
      separatedSpreadsheetIds: listSeparatedSpreadsheetIds(),
      spreadsheetId: this.spreadsheetId,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${this.spreadsheetId}/edit`,
      candidateSpreadsheetId: this.candidateSpreadsheetId,
      candidateSpreadsheetUrl: `https://docs.google.com/spreadsheets/d/${this.candidateSpreadsheetId}/edit`,
      driveFolderId: this.driveFolderId,
      driveUpload: this.getDriveUploadStatus(),
      authError: this.authError,
      lastPulledAt: this.lastPulledAt ? new Date(this.lastPulledAt).toISOString() : null,
      lastFullPulledAt: this.lastFullPullAt ? new Date(this.lastFullPullAt).toISOString() : null,
      lastPullError: this.lastPullError,
      /** Thời gian pull gần nhất — >5000ms là pull đang chậm hơn nhịp tick. */
      lastPullDurationMs: this.lastPullDurationMs || null,
      /** Tiến độ dọn conditional-format rule trùng (job nền). */
      cfCleanup: this.getCfCleanupStatus(),
      pullStartedAt: this.pullStartedAt ? new Date(this.pullStartedAt).toISOString() : null,
      ...this.getWriteStatus(),
      // Chẩn đoán "append treo 30s": đo riêng GET và POST (no-op) tới Google API.
      writeProbe: this.writeProbeResult,
      sheetsCount: SHEETS_DEFINITIONS.length,
      definedTabs: SHEETS_DEFINITIONS.map(d => d.title),
      /** Kết quả ghi gần nhất của tab CAU_HINH_HE_THONG (chứa cấu hình lương). */
      systemSettingsSheetSync: this.systemSettingsSheetSyncState,
      hasFullBatchCache: !!this.lastFullBatch,
    };
  }

  private writeProbeResult: {
    at: string;
    get: { ok: boolean; ms: number; error: string | null };
    valuesGet: { ok: boolean; ms: number; error: string | null };
    /** GET công khai tới Google API (không auth) — đo đường mạng VPS→Google. */
    rawGetPublic: { ok: boolean; ms: number; error: string | null } | null;
    /** GET KHÔNG auth tới riêng host sheets.googleapis.com (kỳ vọng 401 nhanh). */
    rawGetSheetsHost: { ok: boolean; ms: number; status: number | null; error: string | null } | null;
    /** GET có auth tới Drive API (www.googleapis.com) — tách "auth" khỏi "host sheets". */
    rawGetDrive: { ok: boolean; ms: number; status: number | null; error: string | null } | null;
    /** POST công khai tới Google API (không auth) — kiểm tra riêng phương thức POST. */
    rawPostPublic: { ok: boolean; ms: number; status: number | null; error: string | null } | null;
    /** GET có auth tới spreadsheet, dùng fetch trực tiếp (không googleapis). */
    rawGetSheet: { ok: boolean; ms: number; status: number | null; error: string | null } | null;
    post: { ok: boolean; ms: number; error: string | null };
    append: { ok: boolean; ms: number; error: string | null } | null;
    /** Ghi 1 ô với timeout dài (120s) — phân biệt "chậm" với "quota/403". */
    writeTiny: { ok: boolean; ms: number; status: number | null; error: string | null } | null;
    /** Ghi vào spreadsheet TẠM (tự xoá): tách lỗi do tài khoản/quota khỏi lỗi do tài liệu chính. */
    otherDoc: { ok: boolean; ms: number; status: number | null; error: string | null } | null;
    /** Ghi 1 ô bằng fetch RAW (không qua googleapis) — loại trừ lỗi thư viện/client. */
    rawWrite: { ok: boolean; ms: number; status: number | null; error: string | null } | null;
    /**
     * Số quy tắc ĐỊNH DẠNG CÓ ĐIỀU KIỆN theo tab (metadata).
     * Tab bị phủ hàng chục nghìn ô CF sẽ rất chậm mỗi lần ghi (Google phải tính
     * lại định dạng) — đây là nguyên nhân phổ biến của "append treo 30s".
     */
    conditionalFormats: Array<{ title: string; rules: number }>; 
    /** Kích thước lưới từng tab (metadata) — phát hiện tab phình/stray rows. */
    tabs: Array<{ title: string; rows: number; cols: number }>;
    /** Đọc thử đúng tab đang lỗi ghi: số dòng dữ liệu thật + thời gian đọc. */
    hotTab: { title: string; ok: boolean; ms: number; dataRows: number | null; error: string | null } | null;
  } | null = null;

  public getWriteProbe() {
    return this.writeProbeResult;
  }

  /**
   * Đo nhanh khả năng ĐỌC và GHI tới Google Sheets API.
   *
   * Lý do: hàng đợi append báo `SHEETS_TIMEOUT:append.X (30000ms)` liên tục
   * trong khi pull (đọc) vẫn chạy → cần biết chính xác request nào treo.
   * - `get`: metadata spreadsheet (đọc nhẹ).
   * - `valuesGet`: đọc 3 ô AUDIT_LOG (đường đọc dữ liệu).
   * - `post`: batchUpdate no-op với 1 request không đổi dữ liệu (đường POST).
   * - `append`: CHỈ chạy khi được yêu cầu (writes đang lỗi / admin bấm) — ghi
   *   đúng 1 dòng nhật ký `WRITE_PROBE` vào AUDIT_LOG, tái hiện lỗi thật.
   */
  public async runWriteProbe(opts: { includeAppend?: boolean } = {}): Promise<typeof this.writeProbeResult> {
    if (!this.isConfigured || !this.sheetsClient) return null;
    // Probe đúng file đang chứa AUDIT_LOG (bộ 25 sheet) thay vì file tổng hợp cũ.
    const auditDocId = this.spreadsheetIdOf('AUDIT_LOG');
    const label = (e: any) => String(e?.message || e || 'UNKNOWN').slice(0, 300);
    const time = async (
      fn: () => Promise<unknown>,
      name: string,
      ms = 15000,
    ): Promise<{ ok: boolean; ms: number; error: string | null }> => {
      const start = Date.now();
      try {
        await this.sheetsCall(name, fn, ms);
        return { ok: true, ms: Date.now() - start, error: null };
      } catch (e: any) {
        return { ok: false, ms: Date.now() - start, error: label(e) };
      }
    };

    const sheetMeta = await time(() => this.sheetsClient!.spreadsheets.get({
      spreadsheetId: auditDocId,
      fields: 'properties.title',
    }), 'probe.get');
    const valuesGet = await time(() => this.sheetsClient!.spreadsheets.values.get({
      spreadsheetId: auditDocId,
      range: `'AUDIT_LOG'!A1:A3`,
    }), 'probe.valuesGet');

    // Đo đường mạng thuần (không auth) và GET có auth bằng fetch trực tiếp:
    // nếu cả hai đều chậm/treo thì lỗi ở mạng VPS→Google, không phải tài liệu.
    const rawGetPublic = await time(async () => {
      const res = await fetch('https://www.googleapis.com/discovery/v1/apis?preferred=true', {
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }, 'probe.rawGetPublic', 16000);

    // Tách 2 biến còn lại: "host sheets.googleapis.com" và "có Authorization".
    // - rawGetSheetsHost: KHÔNG auth, host sheets → nếu treo thì lỗi host/đường mạng.
    // - rawGetDrive: CÓ auth, host www.googleapis.com → nếu OK thì auth vẫn tốt,
    //   lỗi nằm ở host sheets (hoặc riêng Sheets API).
    const rawGetSheetsHost = await (async () => {
      const start = Date.now();
      try {
        const res = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(auditDocId)}?fields=properties.title`,
          { signal: AbortSignal.timeout(12000) },
        );
        await res.text().catch(() => '');
        return { ok: true, ms: Date.now() - start, status: res.status, error: null as string | null };
      } catch (e: any) {
        return { ok: false, ms: Date.now() - start, status: null, error: this.describeGoogleError(e) };
      }
    })();

    const rawGetDrive = await (async () => {
      const start = Date.now();
      try {
        const tokenRes: any = await this.authClient?.getAccessToken?.();
        const token = tokenRes?.token;
        if (!token) throw new Error('NO_ACCESS_TOKEN');
        const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(12000),
        });
        const text = res.ok ? '' : (await res.text()).slice(0, 200);
        return { ok: res.ok, ms: Date.now() - start, status: res.status, error: res.ok ? null as string | null : text };
      } catch (e: any) {
        return { ok: false, ms: Date.now() - start, status: null, error: this.describeGoogleError(e) };
      }
    })();

    // POST công khai (không auth) tới googleapis.com: endpoint này trả 4xx ngay,
    // nên nếu POST treo thì lỗi ở đường POST/mạng chứ không phải tài liệu.
    let rawPostPublic: { ok: boolean; ms: number; status: number | null; error: string | null } | null = null;
    {
      const start = Date.now();
      try {
        const res = await fetch('https://www.googleapis.com/discovery/v1/apis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ probe: true }),
          signal: AbortSignal.timeout(15000),
        });
        rawPostPublic = { ok: true, ms: Date.now() - start, status: res.status, error: null };
      } catch (e: any) {
        rawPostPublic = { ok: false, ms: Date.now() - start, status: null, error: this.describeGoogleError(e) };
      }
    }

    let rawGetSheet: { ok: boolean; ms: number; status: number | null; error: string | null } | null = null;
    {
      const start = Date.now();
      try {
        const tokenRes: any = await this.authClient?.getAccessToken?.();
        const token = tokenRes?.token;
        if (!token) throw new Error('NO_ACCESS_TOKEN');
        const res = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(auditDocId)}?fields=properties.title`,
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) },
        );
        const text = res.ok ? '' : (await res.text()).slice(0, 200);
        rawGetSheet = { ok: res.ok, ms: Date.now() - start, status: res.status, error: res.ok ? null : text };
      } catch (e: any) {
        rawGetSheet = { ok: false, ms: Date.now() - start, status: null, error: this.describeGoogleError(e) };
      }
    }
    // Metadata 1 lần: sheetId của AUDIT_LOG (cho batchUpdate no-op) + kích thước
    // lưới toàn bộ tab (gridProperties.rowCount) để thấy tab nào phình bất thường.
    // TUYỆT ĐỐI KHÔNG kéo `sheets.conditionalFormats` ở đây: bảng tính đang có
    // ~430.000 rule (hàng trăm MB JSON), mỗi lần probe sẽ block event loop hàng
    // chục giây và làm cả 2 cổng web đứng. Số rule được theo dõi ở
    // `cfCleanup` (chỉ đếm phần đã xoá, không tải toàn bộ rule).
    let auditSheetId: number | null = null;
    const tabs: Array<{ title: string; rows: number; cols: number }> = [];
    const conditionalFormats: Array<{ title: string; rules: number }> = [];
    try {
      const meta: any = await this.sheetsClient!.spreadsheets.get({
        spreadsheetId: auditDocId,
        fields: 'sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))',
      });
      for (const s of meta?.data?.sheets || []) {
        const p = s?.properties;
        if (!p?.title) continue;
        tabs.push({ title: p.title, rows: p.gridProperties?.rowCount ?? 0, cols: p.gridProperties?.columnCount ?? 0 });
        if (p.title === 'AUDIT_LOG') auditSheetId = p.sheetId ?? null;
      }
    } catch { /* metadata lỗi: bỏ qua phần phụ thuộc */ }
    const post = auditSheetId === null
      ? { ok: false, ms: 0, error: 'AUDIT_LOG_SHEET_ID_NOT_FOUND' }
      : await time(() => this.sheetsClient!.spreadsheets.batchUpdate({
        spreadsheetId: auditDocId,
        requestBody: {
          requests: [{
            updateSheetProperties: {
              properties: { sheetId: auditSheetId, gridProperties: { frozenRowCount: 1 } },
              fields: 'gridProperties.frozenRowCount',
            },
          }],
        },
      }), 'probe.noopBatchUpdate');

    // Đọc thử đúng tab đang lỗi ghi (lấy từ lastWriteError) để biết append chậm
    // do tab quá lớn / có dòng lạ ở xa hay do đường mạng.
    let hotTab: { title: string; ok: boolean; ms: number; dataRows: number | null; error: string | null } | null = null;
    const hotTitle = /append\.([A-Z0-9_]+)/i.exec(String(this.lastWriteError || ''))?.[1]
      || /^([A-Z0-9_]+):/i.exec(String(this.lastWriteError || ''))?.[1]
      || null;
    if (hotTitle && valuesGet.ok) {
      const start = Date.now();
      try {
        const res: any = await this.sheetsCall(`probe.hotTab.${hotTitle}`, () =>
          this.sheetsClient!.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetIdOf(hotTitle),
            range: `'${hotTitle}'!A2:A`,
            majorDimension: 'COLUMNS' as any,
          }), 30000);
        hotTab = {
          title: hotTitle,
          ok: true,
          ms: Date.now() - start,
          dataRows: (res?.data?.values?.[0] as any[] | undefined)?.length ?? 0,
          error: null,
        };
      } catch (e: any) {
        hotTab = { title: hotTitle, ok: false, ms: Date.now() - start, dataRows: null, error: label(e) };
      }
    }

    let append: { ok: boolean; ms: number; error: string | null } | null = null;
    let writeTiny: { ok: boolean; ms: number; status: number | null; error: string | null } | null = null;
    let otherDoc: { ok: boolean; ms: number; status: number | null; error: string | null } | null = null;
    let rawWrite: { ok: boolean; ms: number; status: number | null; error: string | null } | null = null;
    if (opts.includeAppend) {
      // Ghi lại đúng giá trị header A1 của AUDIT_LOG (không đổi dữ liệu) với
      // timeout 60s: nếu thành công thì Google chỉ CHẬM; nếu trả 429/403 thì rõ
      // nguyên nhân; nếu treo tới 60s thì đường ghi vào tài liệu này bị chặn.
      const tinyStart = Date.now();
      try {
        await this.withDeadline('probe.writeTiny', () => this.sheetsClient!.spreadsheets.values.update({
          spreadsheetId: auditDocId,
          range: `'AUDIT_LOG'!A1`,
          valueInputOption: 'RAW',
          requestBody: { values: [['Mã Nhật Ký']] },
        }, { timeout: 30_000 } as any), 35_000);
        writeTiny = { ok: true, ms: Date.now() - tinyStart, status: 200, error: null };
      } catch (e: any) {
        writeTiny = {
          ok: false,
          ms: Date.now() - tinyStart,
          status: e?.response?.status ?? (typeof e?.code === 'number' ? e.code : null),
          error: this.describeGoogleError(e),
        };
      }

      // Tạo spreadsheet tạm + ghi 1 ô rồi xoá: nếu việc này OK thì tài khoản
      // dịch vụ vẫn ghi được, lỗi nằm ở RIÊNG tài liệu chính (bị khoá/đang xử lý).
      const otherStart = Date.now();
      let tempId: string | null = null;
      try {
        const created: any = await this.withDeadline('probe.createTemp', () =>
          this.sheetsClient!.spreadsheets.create({
            requestBody: { properties: { title: `UBM WRITE PROBE ${Date.now()}` } },
          }), 60_000);
        tempId = created?.data?.spreadsheetId ?? null;
        if (!tempId) throw new Error('CREATE_TEMP_NO_ID');
        await this.withDeadline('probe.writeTemp', () => this.sheetsClient!.spreadsheets.values.update({
          spreadsheetId: tempId!,
          range: 'A1',
          valueInputOption: 'RAW',
          requestBody: { values: [['probe']] },
        }, { timeout: 60_000 } as any), 65_000);
        otherDoc = { ok: true, ms: Date.now() - otherStart, status: 200, error: null };
      } catch (e: any) {
        otherDoc = {
          ok: false,
          ms: Date.now() - otherStart,
          status: e?.response?.status ?? (typeof e?.code === 'number' ? e.code : null),
          error: this.describeGoogleError(e),
        };
      } finally {
        if (tempId && this.driveClient) {
          await this.driveClient.files.delete({ fileId: tempId }).catch(() => undefined);
        }
      }

      // Ghi RAW bằng fetch (không qua googleapis): nếu cách này nhanh/khác kết quả
      // thì lỗi nằm ở client/thư viện chứ không phải Google.
      const rawStart = Date.now();
      try {
        const tokenRes: any = await this.authClient?.getAccessToken?.();
        const token = tokenRes?.token;
        if (!token) throw new Error('NO_ACCESS_TOKEN');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        try {
          const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(auditDocId)}/values/${encodeURIComponent("AUDIT_LOG!A1")}?valueInputOption=RAW`;
          const res = await fetch(url, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [['Mã Nhật Ký']] }),
            signal: controller.signal,
          });
          const text = await res.text();
          rawWrite = {
            ok: res.ok,
            ms: Date.now() - rawStart,
            status: res.status,
            error: res.ok ? null : text.slice(0, 300),
          };
        } finally {
          clearTimeout(timer);
        }
      } catch (e: any) {
        rawWrite = {
          ok: false,
          ms: Date.now() - rawStart,
          status: e?.response?.status ?? null,
          error: this.describeGoogleError(e),
        };
      }

      // Append chỉ có ý nghĩa khi ghi cơ bản đã thông.
      if (writeTiny.ok) {
        const nowIso = new Date().toISOString();
        append = await time(() => this.sheetsClient!.spreadsheets.values.append({
          spreadsheetId: auditDocId,
          range: `'AUDIT_LOG'!A:A`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[
              `PROBE_${Date.now()}`,
              nowIso,
              'SYSTEM',
              'SYSTEM',
              'WRITE_PROBE',
              'SYSTEM',
              'GOOGLE_SHEETS',
              JSON.stringify({ note: 'Chẩn đoán đường ghi Google Sheets — có thể xoá dòng này.' }),
            ]],
          },
        }, { timeout: 60_000 } as any), 'probe.append.AUDIT_LOG', 65_000);
      }
    }

    this.writeProbeResult = { at: new Date().toISOString(), get: sheetMeta, valuesGet, rawGetPublic, rawGetSheetsHost, rawGetDrive, rawPostPublic, rawGetSheet, post, append, writeTiny, otherDoc, rawWrite, tabs, conditionalFormats, hotTab };
    console.log(
      `[write-probe] meta ${sheetMeta.ok ? 'OK' : 'FAIL'} ${sheetMeta.ms}ms` +
      ` | values.get ${valuesGet.ok ? 'OK' : 'FAIL'} ${valuesGet.ms}ms` +
      ` | net ${rawGetPublic.ok ? 'OK' : 'FAIL'} ${rawGetPublic.ms}ms` +
      ` | sheetsHost ${rawGetSheetsHost.ok ? 'OK' : 'FAIL'} ${rawGetSheetsHost.ms}ms${rawGetSheetsHost.status ? ` HTTP${rawGetSheetsHost.status}` : ''}` +
      ` | driveAuth ${rawGetDrive.ok ? 'OK' : 'FAIL'} ${rawGetDrive.ms}ms${rawGetDrive.status ? ` HTTP${rawGetDrive.status}` : ''}` +
      ` | rawGetSheet ${rawGetSheet ? (rawGetSheet.ok ? 'OK' : 'FAIL') + ' ' + rawGetSheet.ms + 'ms' : 'n/a'}` +
      ` | batchUpdate ${post.ok ? 'OK' : 'FAIL'} ${post.ms}ms` +
      (writeTiny ? ` | writeTiny ${writeTiny.ok ? 'OK' : 'FAIL'} ${writeTiny.ms}ms${writeTiny.status ? ` HTTP${writeTiny.status}` : ''}` : '') +
      (otherDoc ? ` | otherDoc ${otherDoc.ok ? 'OK' : 'FAIL'} ${otherDoc.ms}ms${otherDoc.status ? ` HTTP${otherDoc.status}` : ''}` : '') +
      (rawWrite ? ` | rawWrite ${rawWrite.ok ? 'OK' : 'FAIL'} ${rawWrite.ms}ms${rawWrite.status ? ` HTTP${rawWrite.status}` : ''}` : '') +
      (append ? ` | append ${append.ok ? 'OK' : 'FAIL'} ${append.ms}ms` : '') +
      (hotTab ? ` | hotTab ${hotTab.title} ${hotTab.ok ? `${hotTab.dataRows} dòng` : 'FAIL'} ${hotTab.ms}ms` : '') +
      (append?.error ? ` | appendErr=${append.error}` : ''),
    );
    return this.writeProbeResult;
  }

  /**
   * Khôi phục metadata lần pull trước từ snapshot. Nhờ đó lần pull đầu sau
   * restart vẫn phát hiện đúng tab đã đổi trong lúc backend downtime, thay vì
   * coi mọi thứ là mới và bắn realtime rỗng.
   */
  public restoreSnapshotMeta(meta: {
    signature?: string | null;
    tabSignatures?: Record<string, string>;
    pulledAt?: string | null;
    counts?: any;
  } | null | undefined): void {
    if (!meta) return;
    if (typeof meta.signature === 'string' && meta.signature) {
      this.lastDataSignature = meta.signature;
    }
    if (meta.tabSignatures && typeof meta.tabSignatures === 'object') {
      this.lastTabSignatures = { ...meta.tabSignatures };
    }
    if (meta.pulledAt) {
      const ms = Date.parse(meta.pulledAt);
      if (Number.isFinite(ms) && ms > 0) {
        this.lastPulledAt = ms;
        this.lastSettingsPullAt = ms;
      }
    }
    if (meta.counts && typeof meta.counts === 'object') {
      this.lastSnapshotCounts = meta.counts;
    }
  }

  public getSnapshotMeta() {
    return {
      signature: this.lastDataSignature,
      tabSignatures: this.lastTabSignatures,
      pulledAt: this.lastPulledAt ? new Date(this.lastPulledAt).toISOString() : null,
      counts: this.lastSnapshotCounts,
    };
  }

  /**
   * BACKUP HẰNG NGÀY (chế độ 25 SHEET RIÊNG): export đủ 25 bảng nghiệp vụ
   * thành 1 file ZIP (mỗi bảng 1 XLSX) trong folder `BACKUP_DATA_DAY/<ngày>`.
   * Không còn copy file spreadsheet tổng hợp cũ vì dữ liệu live đã nằm rải
   * trong 25 file. Xoá các kỳ quá hạn theo BACKUP_RETENTION_DAYS (mặc định 30).
   * Idempotent theo ngày VN do route /internal/backup-run kiểm trước khi gọi.
   */
  public async runDailyBackup(retentionDays = Number(process.env.BACKUP_RETENTION_DAYS) || 30): Promise<{
    ok: boolean; name?: string; fileId?: string; createdTime?: string; deletedOld?: number; reason?: string; error?: string;
  }> {
    if (!this.isConfigured || !this.driveClient) {
      return { ok: false, reason: 'DRIVE_NOT_CONFIGURED' };
    }
    // Ngày Việt Nam (UTC+7)
    const stamp = new Date(Date.now() + 7 * 3_600_000);
    const vnDate = stamp.toISOString().slice(0, 10);
    // CHẾ ĐỘ 25 SHEET RIÊNG: dữ liệu live nằm rải trong 25 spreadsheet, nên
    // backup = export đủ 25 bảng thành 1 ZIP trong folder BACKUP_DATA_DAY.
    // Không copy file tổng hợp cũ nữa (file đó không còn dữ liệu nghiệp vụ).
    const rootId = String(
      process.env.GOOGLE_DRIVE_BACKUP_DAY_FOLDER_ID || DRIVE_SUBFOLDERS.BACKUP_DAY,
    ).trim();
    if (!rootId) return { ok: false, reason: 'BACKUP_FOLDER_NOT_CONFIGURED' };
    const res = await this.backupSpreadsheetSetZipTo({
      rootId,
      segments: [vnDate],
      periodKey: vnDate,
      sources: listSeparatedSheetSources(),
      keep: Math.max(2, retentionDays),
    });
    if (!res.ok) {
      return {
        ok: false,
        name: res.name,
        reason: res.reason || 'BACKUP_FAILED',
        error: res.error,
        deletedOld: res.deletedOld ?? 0,
      };
    }
    console.log(`[Backup] OK: ${res.name} (file ${res.fileId}), dọn ${res.deletedOld || 0} kỳ quá hạn`);
    return {
      ok: true,
      name: res.name,
      fileId: res.fileId,
      createdTime: new Date().toISOString(),
      deletedOld: res.deletedOld ?? 0,
    };
  }

  /**
   * COPY NGUYÊN spreadsheet hiện tại vào đúng thư mục backup trên Drive.
   *
   * Dùng cho lịch backup chế độ Google Sheets (services/sheets-backup.service.ts):
   *   01. BACKUP_DATA_DAY/YYYY-MM-DD/UMB_NHANSU_DATABASE_YYYY-MM-DD
   *   02. BACKUP_DATA_WEEK/YYYY-Www/UMB_NHANSU_DATABASE_YYYY-Www
   *   03. BACKUP_DATA_MONTH/YYYY-MM/UMB_NHANSU_DATABASE_YYYY-MM
   *
   * - Bản sao do Google tạo server-side (1 API call) nên luôn là dữ liệu mới nhất
   *   tại thời điểm chạy, không phụ thuộc snapshot RAM.
   * - Idempotent: file cùng tên trong kỳ đã có thì dùng lại, không tạo bản trùng.
   * - Tự dọn các kỳ cũ quá `keep` (mặc định 30) — chỉ xóa thư mục đúng định dạng
   *   kỳ backup, không đụng dữ liệu khác trong thư mục gốc.
   */
  public async backupSpreadsheetTo(opts: {
    rootId: string;
    segments: string[];
    name: string;
    keep?: number;
  }): Promise<{
    ok: boolean;
    fileId?: string;
    folderId?: string;
    name?: string;
    url?: string;
    deletedOld?: number;
    reason?: string;
    error?: string;
  }> {
    if (!this.isConfigured || !this.driveClient) {
      return { ok: false, reason: 'DRIVE_NOT_CONFIGURED' };
    }
    const rootId = String(opts.rootId || '').trim();
    if (!rootId) return { ok: false, reason: 'BACKUP_FOLDER_NOT_CONFIGURED' };
    const name = String(opts.name || '').trim();
    if (!name) return { ok: false, reason: 'BACKUP_NAME_REQUIRED' };

    try {
      const folderId = await this.ensureDriveFolderPath(opts.segments || [], rootId);
      if (!folderId) return { ok: false, reason: 'BACKUP_FOLDER_UNAVAILABLE' };

      // Đã có bản cùng tên trong kỳ -> dùng lại (retry không tạo file trùng).
      const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const existing: any = await this.driveClient.files.list({
        q: `name = '${escaped}' and '${folderId}' in parents and trashed = false`,
        fields: 'files(id,name,webViewLink)',
        pageSize: 5,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      } as any);
      const found = existing?.data?.files?.[0];
      let fileId = String(found?.id || '');
      let url = String(found?.webViewLink || '');

      if (!fileId) {
        const copied: any = await this.driveClient.files.copy({
          fileId: this.spreadsheetId,
          requestBody: { name, parents: [folderId] },
          fields: 'id,name,webViewLink,createdTime',
          supportsAllDrives: true,
        } as any);
        fileId = String(copied?.data?.id || '');
        url = String(copied?.data?.webViewLink || '');
        if (!fileId) throw new Error('DRIVE_COPY_RETURNED_NO_ID');
        console.log(`[BackupSheets] Đã copy ${this.spreadsheetId} -> ${name} (${fileId})`);
      }

      // Dọn kỳ cũ: chỉ xóa thư mục con đúng định dạng kỳ (YYYY-MM-DD / YYYY-Www / YYYY-MM).
      let deletedOld = 0;
      const slot = String(opts.segments?.[0] || '').trim();
      const slotRe = /^\d{4}-\d{2}-\d{2}$/.test(slot)
        ? /^\d{4}-\d{2}-\d{2}$/
        : /^\d{4}-W\d{2}$/.test(slot)
          ? /^\d{4}-W\d{2}$/
          : /^\d{4}-\d{2}$/.test(slot)
            ? /^\d{4}-\d{2}$/
            : null;
      const keep = Math.max(2, Number(opts.keep || 30));
      if (slotRe) {
        try {
          const children: any = await this.driveClient.files.list({
            q: `'${rootId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id,name)',
            pageSize: 1000,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          } as any);
          const periods = (children?.data?.files || [])
            .filter((f: any) => slotRe.test(String(f?.name || '')))
            .sort((a: any, b: any) => String(b.name).localeCompare(String(a.name)));
          for (const old of periods.slice(keep)) {
            try {
              await this.driveClient.files.delete({ fileId: old.id, supportsAllDrives: true } as any);
              deletedOld += 1;
            } catch { /* best-effort */ }
          }
        } catch { /* best-effort */ }
      }

      return { ok: true, fileId, folderId, name, url, deletedOld };
    } catch (err: any) {
      console.warn(`[BackupSheets] Lỗi copy spreadsheet (${name}):`, err?.message || err);
      return { ok: false, reason: 'DRIVE_ERROR', error: String(err?.message || err) };
    }
  }

  /**
   * BACKUP 25 bảng Google Sheets riêng thành 1 FILE ZIP cho mỗi kỳ.
   *
   * Database đã tách thành từng spreadsheet riêng (config/sheets-mapping.ts);
   * file tổng hợp UMB_NHANSU_DATABASE không còn dùng làm nguồn backup.
   *
   * Mỗi kỳ tạo đúng 1 file:
   *   01. BACKUP_DATA_DAY/2026-11-01/UMB_NHANSU_2026-11-01.zip
   *   └── NHAN_VIEN_MASTER_2026-11-01.xlsx
   *   └── PHAN_CONG_CA_2026-11-01.xlsx
   *   └── ... (đủ 25 bảng)
   *
   * - Export XLSX do Google thực hiện server-side → dữ liệu đúng thời điểm chạy.
   * - ZIP dùng phương thức STORE (XLSX đã nén sẵn bên trong) — không cần thêm
   *   dependency, tương thích Windows Explorer / 7-Zip / macOS.
   * - Idempotent theo tên file: kỳ đã có ZIP thì dùng lại, không tạo bản trùng.
   * - Chỉ upload khi export đủ 25/25 bảng (tránh lưu bản thiếu rồi báo OK).
   * - Tự dọn kỳ cũ quá `keep` (chỉ xóa folder đúng định dạng kỳ).
   */
  public async backupSpreadsheetSetZipTo(opts: {
    rootId: string;
    segments: string[];
    periodKey: string;
    sources: Array<{ title: string; spreadsheetId: string }>;
    keep?: number;
  }): Promise<{
    ok: boolean;
    folderId?: string;
    folderUrl?: string;
    name?: string;
    fileId?: string;
    url?: string;
    total?: number;
    exported?: number;
    existing?: boolean;
    sizeBytes?: number;
    deletedOld?: number;
    errors?: Array<{ title: string; error: string }>;
    reason?: string;
    error?: string;
  }> {
    if (!this.isConfigured || !this.driveClient) {
      return { ok: false, reason: 'DRIVE_NOT_CONFIGURED' };
    }
    const rootId = String(opts.rootId || '').trim();
    if (!rootId) return { ok: false, reason: 'BACKUP_FOLDER_NOT_CONFIGURED' };
    const periodKey = String(opts.periodKey || '').trim();
    if (!periodKey) return { ok: false, reason: 'BACKUP_PERIOD_REQUIRED' };
    const sources = (opts.sources || []).filter(s => s?.title && s?.spreadsheetId);
    if (sources.length === 0) return { ok: false, reason: 'BACKUP_NO_SOURCES' };

    try {
      const folderId = await this.ensureDriveFolderPath(opts.segments || [], rootId);
      if (!folderId) return { ok: false, reason: 'BACKUP_FOLDER_UNAVAILABLE' };
      const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
      const zipName = `UMB_NHANSU_${periodKey}.zip`;

      // Kỳ đã có ZIP → dùng lại (idempotent, không upload trùng).
      try {
        const dup: any = await this.driveClient.files.list({
          q: `name = '${zipName.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed = false`,
          fields: 'files(id,name,webViewLink,size)',
          pageSize: 1,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        } as any);
        const found = dup?.data?.files?.[0];
        if (found?.id) {
          const deletedOld = await this.pruneBackupPeriods(rootId, periodKey, Number(opts.keep || 30));
          return {
            ok: true,
            folderId,
            folderUrl,
            name: zipName,
            fileId: String(found.id),
            url: found.webViewLink || folderUrl,
            total: sources.length,
            exported: 0,
            existing: true,
            sizeBytes: Number(found.size || 0),
            deletedOld,
            errors: [],
          };
        }
      } catch { /* chưa đọc được danh sách: vẫn export + upload bình thường */ }

      const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const entries: ZipEntry[] = [];
      const errors: Array<{ title: string; error: string }> = [];

      for (const src of sources) {
        try {
          const resp: any = await this.driveClient.files.export(
            { fileId: src.spreadsheetId, mimeType: XLSX_MIME },
            { responseType: 'arraybuffer' } as any,
          );
          const buf = Buffer.isBuffer(resp?.data) ? resp.data : Buffer.from(resp?.data || []);
          if (buf.length === 0) throw new Error('EXPORT_EMPTY');
          entries.push({ name: `${src.title}_${periodKey}.xlsx`, data: buf });
        } catch (err: any) {
          errors.push({ title: src.title, error: String(err?.message || err) });
        }
      }

      const deletedOld = await this.pruneBackupPeriods(rootId, periodKey, Number(opts.keep || 30));

      if (errors.length > 0) {
        console.warn(
          `[BackupSheets] Export lỗi ${errors.length}/${sources.length} bảng — KHÔNG upload ZIP ${zipName}`
          + ` (${errors.map(e => e.title).join(', ')})`,
        );
        return {
          ok: false,
          folderId,
          folderUrl,
          name: zipName,
          total: sources.length,
          exported: entries.length,
          deletedOld,
          errors,
          reason: 'DRIVE_EXPORT_PARTIAL',
          error: errors.map(e => `${e.title}: ${e.error}`).join('; '),
        };
      }

      const zipBuf = buildZipStore(entries);
      const uploaded: any = await this.driveClient.files.create({
        requestBody: {
          name: zipName,
          parents: [folderId],
          mimeType: 'application/zip',
        },
        media: {
          mimeType: 'application/zip',
          body: Readable.from(zipBuf),
        },
        fields: 'id,name,webViewLink,size',
        supportsAllDrives: true,
      } as any);
      const fileId = String(uploaded?.data?.id || '');
      if (!fileId) throw new Error('DRIVE_UPLOAD_RETURNED_NO_ID');

      console.log(
        `[BackupSheets] Đã tạo ${zipName}: ${entries.length} bảng,`
        + ` ${(zipBuf.length / 1024 / 1024).toFixed(2)} MB → ${opts.segments?.join('/') || periodKey}`,
      );

      return {
        ok: true,
        folderId,
        folderUrl,
        name: zipName,
        fileId,
        url: uploaded?.data?.webViewLink || folderUrl,
        total: sources.length,
        exported: entries.length,
        existing: false,
        sizeBytes: zipBuf.length,
        deletedOld,
        errors: [],
      };
    } catch (err: any) {
      console.warn(`[BackupSheets] Lỗi tạo ZIP backup (${periodKey}):`, err?.message || err);
      return { ok: false, reason: 'DRIVE_ERROR', error: String(err?.message || err) };
    }
  }

  /** Dọn các folder kỳ cũ hơn `keep` (chỉ folder đúng định dạng kỳ). */
  private async pruneBackupPeriods(rootId: string, slot: string, keepRaw: number): Promise<number> {
    if (!this.driveClient) return 0;
    const slotRe = /^\d{4}-\d{2}-\d{2}$/.test(slot)
      ? /^\d{4}-\d{2}-\d{2}$/
      : /^\d{4}-W\d{2}$/.test(slot)
        ? /^\d{4}-W\d{2}$/
        : /^\d{4}-\d{2}$/.test(slot)
          ? /^\d{4}-\d{2}$/
          : null;
    if (!slotRe) return 0;
    const keep = Math.max(2, Number(keepRaw || 30));
    let deletedOld = 0;
    try {
      const children: any = await this.driveClient.files.list({
        q: `'${rootId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id,name)',
        pageSize: 1000,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      } as any);
      const periods = (children?.data?.files || [])
        .filter((f: any) => slotRe.test(String(f?.name || '')))
        .sort((a: any, b: any) => String(b.name).localeCompare(String(a.name)));
      for (const old of periods.slice(keep)) {
        try {
          await this.driveClient.files.delete({ fileId: old.id, supportsAllDrives: true } as any);
          deletedOld += 1;
        } catch { /* best-effort */ }
      }
    } catch { /* best-effort */ }
    return deletedOld;
  }

  /**
   * Tạo các Sheet tab còn thiếu và khởi tạo dòng tiêu đề (Header row)
   */
  public async initSpreadsheetStructure(): Promise<{ success: boolean; createdSheets: string[]; existingSheets: string[]; message: string }> {
    if (!this.isConfigured || !this.sheetsClient) {
      return {
        success: false,
        createdSheets: [],
        existingSheets: [],
        message: this.authError || 'Google Sheets chưa được cấu hình thông tin xác thực',
      };
    }

    // Cache 10 phút: header hầu như không đổi, khỏi tốn ~N API call mỗi lần full-sync.
    if (this.lastInitResult && Date.now() - this.initOkAt < 600000) {
      return { ...this.lastInitResult, createdSheets: [...this.lastInitResult.createdSheets], existingSheets: [...this.lastInitResult.existingSheets] };
    }

    try {
      // Mỗi bảng nghiệp vụ nằm trong 1 file Google Sheets RIÊNG (bộ 25 sheet):
      // nhóm các tab theo spreadsheet đích rồi khởi tạo từng file.
      const groups = new Map<string, Array<typeof SHEETS_DEFINITIONS[number]>>();
      for (const def of SHEETS_DEFINITIONS) {
        const sid = this.spreadsheetIdOf(def.title);
        if (!groups.has(sid)) groups.set(sid, []);
        groups.get(sid)!.push(def);
      }

      const createdSheets: string[] = [];
      const existingSheets: string[] = [];
      const touchedSpreadsheets = new Set<string>();
      const failures: string[] = [];

      for (const [sid, defs] of groups) {
        try {
          // Chỉ lấy tiêu đề tab (không kéo toàn bộ metadata) — request nhẹ, nhanh.
          const res = await this.sheetsCall(`init.get.${sid.slice(0, 8)}`, () =>
            this.sheetsClient!.spreadsheets.get({
              spreadsheetId: sid,
              fields: 'sheets.properties.title',
            })
          );

          const existingHere = res.data.sheets?.map(s => s.properties?.title || '').filter(Boolean) || [];
          existingSheets.push(...existingHere);
          const sheetsToCreate = defs.filter(def => !existingHere.includes(def.title));

          if (sheetsToCreate.length > 0) {
            const requests = sheetsToCreate.map(def => ({
              addSheet: {
                properties: {
                  title: def.title,
                  gridProperties: {
                    frozenRowCount: 1,
                  },
                },
              },
            }));

            await this.sheetsCall(`init.batchUpdate.${sid.slice(0, 8)}`, () =>
              this.sheetsClient!.spreadsheets.batchUpdate({
                spreadsheetId: sid,
                requestBody: { requests },
              })
            );

            createdSheets.push(...sheetsToCreate.map(s => s.title));
            touchedSpreadsheets.add(sid);
          }

          // CHỈ ghi header cho tab MỚI TẠO hoặc tab có header lệch/thiếu.
          // Trước đây mỗi lượt init (10 phút/lần) ghi lại header của cả 24 tab =
          // 24 lệnh GHI, chiếm khoá ghi spreadsheet và làm append của hàng đợi
          // timeout. Nay đọc 1 lần bằng batchGet rồi so sánh.
          const needHeaderWrite: Array<{ def: typeof SHEETS_DEFINITIONS[number]; force: boolean }> = [];
          const createdSet = new Set(createdSheets);
          const toCheck = defs.filter(def => existingHere.includes(def.title));

          const headerRowsByTitle = new Map<string, string[]>();
          if (toCheck.length > 0) {
            try {
              const batch: any = await this.sheetsCall(`init.batchGetHeaders.${sid.slice(0, 8)}`, () =>
                this.sheetsClient!.spreadsheets.values.batchGet({
                  spreadsheetId: sid,
                  ranges: toCheck.map(def => `'${def.title}'!A1:${GoogleSheetsSyncService.colLetter(def.headers.length)}1`),
                })
              );
              const valueRanges: any[] = batch?.data?.valueRanges || [];
              toCheck.forEach((def, i) => {
                headerRowsByTitle.set(def.title, (valueRanges[i]?.values?.[0] as string[] | undefined) || []);
              });
            } catch (e: any) {
              // Không đọc được header: bỏ qua so sánh, KHÔNG ghi (tránh đập khoá ghi).
              console.warn(`[GoogleSheetsSyncService] Không đọc được header (${sid.slice(0, 8)}…):`, e?.message || e);
            }
          }

          for (const def of defs) {
            if (createdSet.has(def.title)) continue; // header ghi ở vòng dưới (tab mới)
            const current = headerRowsByTitle.get(def.title);
            if (current === undefined) continue;
            const same = def.headers.length === current.length
              && def.headers.every((h, i) => String(h) === String(current[i] ?? ''));
            if (!same) needHeaderWrite.push({ def, force: false });
          }

          const headersToWrite = [
            ...defs.filter(def => createdSet.has(def.title)).map(def => ({ def, force: true })),
            ...needHeaderWrite,
          ];

          for (const item of headersToWrite) {
            const def = item.def;
            await this.sheetsCall(`init.header.${def.title}`, () =>
              this.sheetsClient!.spreadsheets.values.update({
                spreadsheetId: sid,
                range: `'${def.title}'!A1:${GoogleSheetsSyncService.colLetter(def.headers.length)}1`,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                  values: [def.headers],
                },
              })
            );
          }
          if (headersToWrite.length > 0) {
            console.log(`[GoogleSheetsSyncService] Ghi header cho ${headersToWrite.length} tab trong file ${sid.slice(0, 8)}…`);
          }
        } catch (err: any) {
          const msg = `${sid.slice(0, 8)}…: ${err?.message || err}`;
          failures.push(msg);
          console.warn('[GoogleSheetsSyncService] Khởi tạo cấu trúc file riêng lỗi:', msg);
        }
      }

      if (existingSheets.length === 0 && createdSheets.length === 0) {
        const message = failures.length
          ? `Lỗi Google Sheets API: ${failures.join('; ')}`
          : this.authError || 'Không đọc được cấu trúc 25 file Google Sheets';
        return { success: false, createdSheets, existingSheets, message };
      }

      console.log(`[GoogleSheetsSyncService] Đã tạo ${createdSheets.length} sheet mới trên ${groups.size} file riêng. Toàn bộ ${SHEETS_DEFINITIONS.length} tab sẵn sàng.`);

      for (const sid of touchedSpreadsheets) {
        // Tự động làm đẹp và định dạng các tab mới tạo (đúng file vừa tạo tab).
        this.formatAndBeautifySpreadsheet(sid).catch(err => {
          console.warn('[GoogleSheetsSyncService] Tự động làm đẹp Sheets thất bại:', err?.message || err);
        });
      }

      const message = `Đã khởi tạo thành công cấu trúc ${SHEETS_DEFINITIONS.length} sheet tabs trên ${groups.size} file Google Sheets riêng!`
        + (failures.length ? ` (lỗi ${failures.length} file: ${failures.join('; ')})` : '');
      this.initOkAt = Date.now();
      this.lastInitResult = {
        success: true,
        createdSheets,
        existingSheets,
        message,
      };
      return {
        success: true,
        createdSheets,
        existingSheets,
        message,
      };
    } catch (err: any) {
      console.error('[GoogleSheetsSyncService] Lỗi khi tạo cấu trúc Sheets:', err);
      return {
        success: false,
        createdSheets: [],
        existingSheets: [],
        message: `Lỗi Google Sheets API: ${err.message}`,
      };
    }
  }

  /**
   * Trạng thái job dọn conditional-format rule trùng vô hạn.
   *
   * Trước đây mỗi lượt beautify chỉ `addConditionalFormatRule` mà không dọn
   * rules cũ. Beautify từng chạy 15 phút/lần trong nhiều tháng nên các tab phình
   * tới hàng chục nghìn rule (đo được ~430.000 rule toàn bảng tính), khiến mọi
   * lần đọc/ghi Google Sheets chậm 2-3 giây và event loop bị block.
   */
  private cfCleanupState = {
    running: false,
    totalDeleted: 0,
    lastRunDeleted: 0,
    lastTab: null as string | null,
    lastError: null as string | null,
    startedAt: null as string | null,
    finishedAt: null as string | null,
  };
  /** Mốc ghi THẬT của người dùng (append/duyệt phiếu...) để job dọn rule nhường. */
  private lastUserWriteAt = 0;
  /** Đã dọn rule xong nhưng chưa add lại bộ rule chuẩn -> cần beautify 1 lần. */
  public needsCfReapply = false;

  public getCfCleanupStatus() {
    return { ...this.cfCleanupState };
  }

  /**
   * Dọn conditional-format rule trùng vô hạn (job chạy nền).
   *
   * Không đọc metadata rule (hàng trăm MB) để đếm — chỉ xoá dần rule index 0
   * theo lô và dừng khi tab hết rule. Giữa các lô, nếu người dùng vừa ghi
   * (duyệt phiếu/điểm danh) thì nhường 3 giây để thao tác thật không phải chờ
   * quá 1 lô.
   */
  public async cleanupConditionalFormats(maxDeletes = Number(process.env.SHEETS_CF_CLEANUP_BUDGET) || 40_000): Promise<{ deleted: number; tabs: number; errors: string[] }> {
    const result = { deleted: 0, tabs: 0, errors: [] as string[] };
    if (!this.isConfigured || !this.sheetsClient || this.cfCleanupState.running) return result;
    this.cfCleanupState.running = true;
    this.cfCleanupState.lastError = null;
    this.cfCleanupState.lastRunDeleted = 0;
    this.cfCleanupState.startedAt = new Date().toISOString();
    try {
      const res = await this.sheetsCall('cf.list', () =>
        this.sheetsClient!.spreadsheets.get({
          spreadsheetId: this.spreadsheetId,
          fields: 'sheets.properties(sheetId,title)',
        }), 30_000);
      const sheets = (res.data.sheets || []).filter(s => s.properties?.sheetId !== undefined);
      const chunk = Math.max(10, Math.min(1000, Number(process.env.SHEETS_CF_CLEANUP_CHUNK) || 40));
      let stopAll = false;
      for (const sheet of sheets) {
        if (stopAll) break;
        const sheetId = sheet.properties!.sheetId!;
        const title = sheet.properties?.title || String(sheetId);
        let progressHere = 0;
        let n = Math.min(chunk, maxDeletes);
        while (result.deleted < maxDeletes && n >= 1) {
          // Nhường người dùng: có ghi thật trong 3s qua thì chờ 1 nhịp.
          if (Date.now() - this.lastUserWriteAt < 3_000) {
            await new Promise(r => setTimeout(r, 3_000));
          }
          const requests = Array.from({ length: n }, () => ({
            deleteConditionalFormatRule: { sheetId, index: 0 },
          }));
          try {
            await this.sheetsCall(
              `write.beautify.cfPurge.${title}`,
              () => this.sheetsClient!.spreadsheets.batchUpdate({
                spreadsheetId: this.spreadsheetId,
                requestBody: { requests },
              }),
              // Lô nhỏ (mặc định 40) nên khoá ghi chỉ bị giữ ~vài giây; 30s là hạn
              // cứng để một lô treo không chặn duyệt phiếu/điểm danh quá lâu.
              30_000,
            );
            result.deleted += n;
            progressHere += n;
            this.cfCleanupState.totalDeleted += n;
            this.cfCleanupState.lastTab = title;
            // Lô đầy thành công -> thử lại lô đầy; lô đã co (tab gần hết rule)
            // thì giữ lô nhỏ để không lặp lại chuỗi lỗi.
            n = n >= chunk ? Math.min(chunk, maxDeletes - result.deleted) : Math.min(n, maxDeletes - result.deleted);
            // Nhả khoá ghi một nhịp để thao tác thật của người dùng chen vào.
            await new Promise(r => setTimeout(r, 800));
          } catch (e: any) {
            const msg = this.describeGoogleError(e);
            // Chỉ coi là "tab còn ít rule hơn lô" khi Google báo rõ index rule
            // không tồn tại. Lỗi khác (payload quá lớn, quyền, quota) thì DỪNG
            // hẳn — nếu thu nhỏ lô vô tội vạ sẽ thành xoá 1 rule/lần.
            const noRuleAtIndex = /conditional format/i.test(msg) && /index/i.test(msg);
            if (noRuleAtIndex && n > 1) {
              n = Math.max(1, Math.floor(n / 5));
              continue;
            }
            if (!noRuleAtIndex) {
              result.errors.push(`${title}: ${msg}`);
              this.cfCleanupState.lastError = `${title}: ${msg}`;
              // Lỗi timeout/abort/quota: Google đang bận -> dừng cả lượt, không thử
              // tiếp tab khác (mỗi tab lại giữ khoá ghi 30s, càng làm chậm hệ thống).
              if (/abort|timeout|deadline|quota|rate limit|429|503/i.test(msg)) stopAll = true;
            }
            break; // tab đã sạch (hoặc lỗi thật): sang tab kế
          }
        }
        if (progressHere > 0) result.tabs += 1;
        if (result.deleted >= maxDeletes) break;
      }
      this.cfCleanupState.lastRunDeleted = result.deleted;
      if (result.deleted > 0) {
        this.needsCfReapply = true;
        console.log(`[sheets-cf-cleanup] Đã xoá ${result.deleted} conditional-format rule trên ${result.tabs} tab (tổng ${this.cfCleanupState.totalDeleted}).`);
      }
      return result;
    } catch (e: any) {
      const msg = this.describeGoogleError(e);
      this.cfCleanupState.lastError = msg;
      result.errors.push(msg);
      return result;
    } finally {
      this.cfCleanupState.running = false;
      this.cfCleanupState.finishedAt = new Date().toISOString();
    }
  }

  /**
   * Thiết kế lại giao diện toàn bộ các Sheet tab đẹp mắt, chuẩn hóa độ rộng cột,
   * màu sắc nhận diện từng nhóm nghiệp vụ, font chữ và conditional formatting.
   */
  public async formatAndBeautifySpreadsheet(
    targetSpreadsheetId?: string,
    opts: { applyConditionalRules?: boolean } = {},
  ): Promise<{ success: boolean; message: string; formattedTabs: number }> {
    if (!this.isConfigured || !this.sheetsClient) {
      return { success: false, message: 'Google Sheets chưa được kết nối', formattedTabs: 0 };
    }

    const sId = targetSpreadsheetId;
    const now = Date.now();

    // Chống gọi dồn dập (debounce latch 25 giây cho bảng tính chính)
    if (!targetSpreadsheetId && this.beautifyInFlight) {
      return this.beautifyInFlight;
    }
    if (!targetSpreadsheetId && now - this.lastBeautifyAt < 25_000) {
      return { success: true, message: 'Giao diện bảng tính vừa được chuẩn hóa tự động gần đây.', formattedTabs: 23 };
    }

    // CHẾ ĐỘ 25 SHEET RIÊNG: không truyền file đích nghĩa là làm đẹp TOÀN BỘ
    // 25 spreadsheet nghiệp vụ (không đụng file tổng hợp cũ nữa).
    if (!targetSpreadsheetId) {
      const ids = listSeparatedSpreadsheetIds();
      this.beautifyInFlight = (async () => {
        let total = 0;
        const failures: string[] = [];
        for (const sid of ids) {
          try {
            const r = await this.formatAndBeautifySpreadsheet(sid, opts);
            total += r.formattedTabs;
            if (!r.success) failures.push(`${sid.slice(0, 8)}…: ${r.message}`);
          } catch (e: any) {
            failures.push(`${sid.slice(0, 8)}…: ${e?.message || e}`);
          }
        }
        this.lastBeautifyAt = Date.now();
        return {
          success: failures.length === 0,
          message: failures.length
            ? `Đã làm đẹp ${total} tab; lỗi ${failures.length} file (${failures.join('; ')})`
            : `Đã làm đẹp và chuẩn hóa thành công ${total} tabs trên ${ids.length} file Google Sheets!`,
          formattedTabs: total,
        };
      })().finally(() => {
        this.beautifyInFlight = null;
      });
      return this.beautifyInFlight;
    }

    const runFormat = async () => {
      try {
        const res = await this.sheetsCall('beautify.get', () =>
          this.sheetsClient!.spreadsheets.get({
            spreadsheetId: sId,
            // Chỉ lấy properties: KHÔNG kéo conditionalFormats (hàng trăm MB khi
            // rule phình to) — việc dọn rule do job nền riêng đảm nhiệm.
            fields: 'sheets.properties(sheetId,title)',
          }),
          30_000,
        );

        const sheets = res.data.sheets || [];
        if (sheets.length === 0) {
          return { success: false, message: 'Bảng tính không có sheet tab nào', formattedTabs: 0 };
        }

        let totalFormatted = 0;
        for (const sheet of sheets) {
          const title = sheet.properties?.title || '';
          const sheetId = sheet.properties?.sheetId;
          if (sheetId === undefined || sheetId === null) continue;

          let headers: string[] = SHEETS_DEFINITIONS.find(d => d.title === title)?.headers || [];
          let sampleRows: any[][] = [];

          try {
            const hRes = await this.sheetsClient!.spreadsheets.values.get({
              spreadsheetId: sId,
              range: `'${title}'!1:20`,
              ...SHEETS_READ_OPTIONS,
            });
            const rawRows = (hRes.data.values as any[][]) || [];
            if (rawRows.length > 0) {
              if (headers.length === 0) {
                headers = (rawRows[0] || []).map(h => String(h || '').trim()).filter(Boolean);
              }
              sampleRows = rawRows.slice(1);
            }
          } catch {
            sampleRows = [];
          }

          if (headers.length === 0) continue;

          const effectiveDef: SheetDefinition = {
            title,
            headers,
          };

          const theme = resolveTheme(title);
          const requests = buildSheetFormattingRequests(sheetId, effectiveDef, theme, sampleRows, {
            // Tự động chạy hằng ngày chỉ cần căn chữ/độ rộng; KHÔNG add lại rule
            // status mỗi ngày (nguồn gốc làm phình ~430.000 rule).
            skipConditionalRules: opts.applyConditionalRules === false,
          });
          if (requests.length > 0) {
            try {
              await this.sheetsCall(
                `write.beautify.${title}`,
                () =>
                  this.sheetsClient!.spreadsheets.batchUpdate({
                    spreadsheetId: sId,
                    requestBody: { requests },
                  }),
                35000
              );
              totalFormatted++;
            } catch (bErr: any) {
            if (bErr.message && bErr.message.includes('protected')) {
              try {
                const fallbackRequests = requests.filter(r => !r.updateSheetProperties);
                if (fallbackRequests.length > 0) {
                  await this.sheetsCall(
                    `write.beautify.${title}.fallback`,
                    () =>
                      this.sheetsClient!.spreadsheets.batchUpdate({
                        spreadsheetId: sId,
                        requestBody: { requests: fallbackRequests },
                      }),
                    35000
                  );
                  totalFormatted++;
                }
              } catch (innerErr) {
                console.warn(`[GoogleSheetsSyncService] Tab [${title}] có ô bảo vệ quyền sở hữu, bỏ qua an toàn.`);
              }
            } else {
              console.error(`[GoogleSheetsSyncService] Lỗi format tab [${title}]:`, bErr.message);
            }
          }
        }
      }

      console.log(`[GoogleSheetsSyncService] Đã làm đẹp và chuẩn hóa thành công ${totalFormatted} tabs trên Google Sheets!`);
      this.lastBeautifyAt = Date.now();
      return {
        success: true,
        message: `Đã làm đẹp và chuẩn hóa thành công ${totalFormatted} tabs trên Google Sheets!`,
        formattedTabs: totalFormatted,
      };
    } catch (err: any) {
      console.error('[GoogleSheetsSyncService] Lỗi khi làm đẹp Google Sheets:', err);
      return {
        success: false,
        message: `Lỗi làm đẹp Google Sheets: ${err.message}`,
        formattedTabs: 0,
      };
    }
  };

  if (!targetSpreadsheetId) {
    // Nhánh này không còn dùng: trường hợp không truyền file đích đã được xử
    // lý phía trên (làm đẹp toàn bộ 25 sheet riêng).
    return { success: false, message: 'FORMAT_TARGET_REQUIRED', formattedTabs: 0 };
  }

  return runFormat();
}

  /**
   * ĐỌC DỮ LIỆU THỰC TẾ TỪ GOOGLE SHEETS VÀ CẬP NHẬT VÀO HỆ THỐNG (TWO-WAY SYNC)
   *
   * Chống pull chồng chéo TOÀN CỤC: tick định kỳ (server.ts) + ensureFreshData theo
   * request (adapter) + webhook onEdit đều gọi vào đây. Nếu một pull chưa xong,
   * các lời gọi sau DÙNG CHUNG promise pull đang bay thay vì mở pull mới — trước
   * đây pull chồng nhau khi tab lớn/quota chậm là gọi API Google dồn dập, rơi vào
   * rate limit và web cập nhật ngày càng muộn.
   */
  public pullAllDataFromGoogleSheets(repo: ISheetsRepository): Promise<SheetsPullResult> {
    if (!this.isConfigured || !this.sheetsClient) {
      return Promise.resolve({ success: false, message: 'Google Sheets chưa kết nối', counts: null });
    }
    if (this.pullInFlight) return this.pullInFlight;
    let run: Promise<SheetsPullResult>;
    run = this.doPullAllDataFromGoogleSheets(repo).finally(() => {
      // Chỉ xóa khi đây vẫn là pull hiện tại (watchdog có thể đã giải phóng và
      // một pull mới đã được tạo — không được xóa nhầm pull mới).
      if (this.pullInFlight === run) {
        this.pullInFlight = null;
        this.pullStartedAt = 0;
      }
    });
    this.pullStartedAt = Date.now();
    this.pullInFlight = run;
    return run;
  }

  /**
   * Nhịp RIÊNG cho ứng viên (form tuyển dụng).
   *
   * Vòng pull nền đọc lại toàn bộ ~15 tab nghiệp vụ nên không thể chạy quá dày:
   * hạn mức của service account là 60 request đọc/phút, đọc 15 tab mỗi 20s đã
   * vượt hạn mức -> Google trả 429, dữ liệu form (nguồn thật) bị chậm/hỏng.
   *
   * Hàm này chỉ đọc ĐÚNG nguồn form (1 request) + master overlay (1 request) rồi
   * parse trên cache các tab còn lại — nhờ vậy hồ sơ mới lên web trong vài giây
   * mà không đốt hạn mức của cả hệ thống.
   */
  public refreshCandidatesOnly(repo: ISheetsRepository): Promise<SheetsPullResult> {
    if (!this.isConfigured || !this.sheetsClient) {
      return Promise.resolve({ success: false, message: 'Google Sheets chưa kết nối', counts: null });
    }
    if (this.pullInFlight) {
      return Promise.resolve({ success: false, message: 'Đang pull — bỏ qua nhịp ứng viên', counts: null });
    }
    // Chưa có cache tab: chạy pull đầy đủ để có nền dữ liệu.
    if (!this.lastFullBatch) return this.pullAllDataFromGoogleSheets(repo);
    // Vừa lỗi quota: tạm nghỉ, không bắn thêm request (càng bắn càng khoá lâu).
    if (Date.now() < this.candidateReadBackoffUntil) {
      return Promise.resolve({ success: false, message: 'Tạm nghỉ đọc nguồn ứng viên sau lỗi quota', counts: null });
    }
    const pullMs = Math.max(2_000, Number(process.env.SHEETS_CANDIDATE_PULL_MS) || 5_000);
    if (Date.now() - this.lastCandidatePullAt < pullMs) {
      return Promise.resolve({ success: true, message: 'Chưa tới nhịp đọc ứng viên', counts: null });
    }
    // Bỏ tab nhật ký khỏi batch cache: parse lại 56k dòng mỗi 10s là lãng phí CPU
    // (nhịp lịch sử riêng đã lo phần này).
    const cachedBatch: Record<string, string[][]> = {};
    const historyBases = [...GoogleSheetsSyncService.HISTORY_TABS];
    for (const [key, rows] of Object.entries(this.lastFullBatch)) {
      if (historyBases.includes(key)) continue;
      if (historyBases.some(base => key.startsWith(`${base}_P`))) continue;
      cachedBatch[key] = rows as string[][];
    }
    if (!Object.keys(cachedBatch).length) return this.pullAllDataFromGoogleSheets(repo);

    let run: Promise<SheetsPullResult>;
    run = this.doPullAllDataFromGoogleSheets(repo, {
      prefetchedBatch: cachedBatch,
      forceCandidates: true,
      reason: 'candidate-tick',
    }).finally(() => {
      if (this.pullInFlight === run) {
        this.pullInFlight = null;
        this.pullStartedAt = 0;
      }
    });
    this.pullStartedAt = Date.now();
    this.pullInFlight = run;
    return run;
  }

  /**
   * P0.3 — Pull nhanh theo tab vừa sửa từ webhook.
   *
   * Chỉ đọc lại đúng 1 tab (1 request), cập nhật cache raw rows rồi chạy lại
   * parser trên cache. Không đọc lại 24 tab nên webhook thường có dữ liệu mới
   * trong 1-2s; nếu chưa có cache/full-pull đang chạy thì fallback full-pull.
   */
  public pullTabFromGoogleSheets(repo: ISheetsRepository, tab: string): Promise<SheetsPullResult> {
    if (!this.isConfigured || !this.sheetsClient) {
      return Promise.resolve({ success: false, message: 'Google Sheets chưa kết nối', counts: null });
    }
    const safeTab = String(tab || '').trim().toUpperCase();
    const validTab = /^[A-Z0-9_]{1,100}$/.test(safeTab);
    const isCandidateForm = safeTab === 'FROM_NHAN_VIEN';

    // Nếu full-pull định kỳ đang chạy, nó có thể đã đọc tab TRƯỚC lúc onEdit.
    // Đợi pull đó xong rồi đọc lại đúng tab, thay vì trả luôn dữ liệu cũ.
    if (this.pullInFlight) {
      const current = this.pullInFlight;
      return current.then(
        () => this.pullTabFromGoogleSheets(repo, safeTab),
        () => this.pullTabFromGoogleSheets(repo, safeTab),
      );
    }

    // Tab append-only có thể đã tự chia _P2/_P3. Chỉ đọc tab gốc sẽ làm mất
    // phần dữ liệu trong các part khi parse lại cache. Vì vậy đọc cả cụm part
    // (thường 1 tab gốc + 0-2 part) rồi gộp lại như full-pull.
    const partitionBase = GoogleSheetsSyncService.PARTITION_TABS.has(safeTab)
      ? safeTab
      : (safeTab.match(/^(.+)_P\d+$/)?.[1] || '');
    const canUseCache = validTab
      && !!this.lastFullBatch
      && (partitionBase
        ? Array.isArray(this.lastFullBatch[partitionBase])
        : (isCandidateForm || Array.isArray(this.lastFullBatch[safeTab])));

    if (!canUseCache) {
      return this.pullAllDataFromGoogleSheets(repo);
    }

    let run: Promise<SheetsPullResult>;
    run = (async () => {
      const nextBatch = { ...(this.lastFullBatch || {}) };
      if (partitionBase) {
        // Hỏi metadata (cache 10 phút, tự xoá khi tạo part) để lấy đủ _P2/_P3
        // hiện có, kể cả part vừa được tạo sau lần full-pull gần nhất.
        let partTitles: string[];
        try {
          partTitles = (await this.partitionChain(partitionBase)).filter(t => t !== partitionBase);
        } catch (err: any) {
          console.warn(`[GoogleSheetsSyncService] Không đọc được danh sách part ${partitionBase} — fallback full-pull:`, err?.message || err);
          return this.doPullAllDataFromGoogleSheets(repo, { reason: `webhook:${safeTab}:fallback` });
        }
        if (safeTab !== partitionBase && !partTitles.includes(safeTab)) {
          // Tab part vừa bị xoá/đổi tên: đọc full để không giữ cache cũ.
          console.warn(`[GoogleSheetsSyncService] Tab ${safeTab} không còn trong cụm — fallback full-pull.`);
          return this.doPullAllDataFromGoogleSheets(repo, { reason: `webhook:${safeTab}:fallback` });
        }
        // Bỏ các part cũ không còn tồn tại trước khi ghi lại cụm hiện tại.
        const partPrefix = `${partitionBase}_P`;
        for (const key of Object.keys(nextBatch)) {
          if (key.startsWith(partPrefix) && /^P\d+$/.test(key.slice(partPrefix.length))) {
            delete nextBatch[key];
          }
        }
        const wanted = [partitionBase, ...partTitles];
        const fetched: Record<string, string[][]> = {};
        for (const title of wanted) {
          const rows = await this.readTabRowsStrict(title, 15_000);
          if (rows === null) {
            // Không đọc được 1 phần của cụm: full-pull để guard dữ liệu đúng.
            console.warn(`[GoogleSheetsSyncService] Webhook đọc tab ${title} lỗi — fallback full-pull.`);
            return this.doPullAllDataFromGoogleSheets(repo, { reason: `webhook:${safeTab}:fallback` });
          }
          fetched[title] = rows;
        }
        const baseRows = fetched[partitionBase] || [];
        const partRows = partTitles.flatMap(t => fetched[t] || []);
        nextBatch[partitionBase] = [...baseRows, ...partRows];
        for (const title of partTitles) nextBatch[title] = fetched[title] || [];
      } else {
        const rows = await this.readTabRowsStrict(safeTab, 15_000);
        if (rows === null) {
          // Đọc 1 tab lỗi: không được lấy rỗng đè cache -> full-pull để giữ guard.
          console.warn(`[GoogleSheetsSyncService] Webhook đọc tab ${safeTab} lỗi — fallback full-pull.`);
          return this.doPullAllDataFromGoogleSheets(repo, { reason: `webhook:${safeTab}:fallback` });
        }
        nextBatch[safeTab] = rows;
      }
      this.lastFullBatch = nextBatch;
      return this.doPullAllDataFromGoogleSheets(repo, {
        prefetchedBatch: nextBatch,
        forceCandidates: isCandidateForm,
        reason: `webhook:${safeTab}`,
      });
    })().finally(() => {
      if (this.pullInFlight === run) {
        this.pullInFlight = null;
        this.pullStartedAt = 0;
      }
    });
    this.pullStartedAt = Date.now();
    this.pullInFlight = run;
    return run;
  }

  /**
   * Watchdog: một request Google hiếm khi treo vô hạn (mọi sheetsCall đều có
   * timeout 20s), nhưng nếu pull kẹt quá lâu thì toàn bộ dữ liệu đứng yên và
   * endpoint /health/ready báo stale mãi. Giải phóng promise kẹt để tick sau pull lại;
   * pull cũ nếu lỡ trả về muộn cũng chỉ ghi đè dữ liệu mới hơn — vô hại.
   */
  public ensurePullNotStuck(maxAgeMs = 20 * 60_000): boolean {
    if (!this.pullInFlight || !this.pullStartedAt) return false;
    const age = Date.now() - this.pullStartedAt;
    if (age < maxAgeMs) return false;
    console.warn(`[GoogleSheetsSyncService] Pull treo ${Math.round(age / 60_000)} phút — giải phóng để pull lại.`);
    this.pullInFlight = null;
    this.pullStartedAt = 0;
    return true;
  }

  /**
   * Có lượt pull nào đang bay không. Adapter dùng để nhường ghi: một số lượt pull
   * do tick/gọi trực tiếp không gán `adapter.pullInFlight`, nên chỉ kiểm tra ở
   * adapter là không đủ — đọc và ghi cùng Spreadsheet đích trong lúc pull sẽ thấy
   * Sheet rỗng giữa `clear` và `update`.
   */
  public isPullInFlight(): boolean {
    return !!this.pullInFlight;
  }

  private pullInFlight: Promise<SheetsPullResult> | null = null;
  private pullStartedAt = 0;

  private async doPullAllDataFromGoogleSheets(
    repo: ISheetsRepository,
    opts: SheetsPullOptions = {},
  ): Promise<SheetsPullResult> {
    if (!this.isConfigured || !this.sheetsClient) {
      return { success: false, message: 'Google Sheets chưa kết nối', counts: null };
    }

    const pullT0 = Date.now();
    // Giữ bản rows ứng viên đọc được từ spreadsheet riêng để đưa vào hash nội dung
    // (khai báo ở scope ngoài vì khối đọc ứng viên nằm trong try lồng nhau).
    // Khi bỏ qua lượt đọc ứng viên (throttle quota), dùng lại rows cũ để hash ổn định.
    let candRowsForSignature: string[][] = this.lastCandidateRows;
    let masterCandRowsForSignature: string[][] = this.lastMasterCandidateRows;
    // Nguồn form ứng viên (Spreadsheet 2) vừa đổi -> hẹn đẩy lại tab FROM_NHAN_VIEN
    // sang Spreadsheet đích (1) ngay sau khi pull xong.
    let candidateSourceChanged = false;
    // Ứng viên đọc từ spreadsheet riêng: 5s/lần để lịch PV cập nhật gần như tức
    // thì. Vẫn dưới quota đọc (batch 12 + candidate ~36 = ~48 lượt/phút); có thể
    // giãn bằng SHEETS_CANDIDATE_PULL_MS khi Google chậm.
    const candidatePullMs = Math.max(2_000, Number(process.env.SHEETS_CANDIDATE_PULL_MS) || 5_000);
    const candidateBackoff = Date.now() < this.candidateReadBackoffUntil;
    const shouldPullCandidates = !!opts.forceCandidates
      || (!candidateBackoff && Date.now() - this.lastCandidatePullAt >= candidatePullMs);

    try {
      // Hỗ trợ cả 2 trường hợp:
      // 1. Nhận GoogleSheetsAdapter (có .fallbackAdapter)
      // 2. Nhận MockSheetsAdapter trực tiếp
      let fallback: MockSheetsAdapter | null = null;
      if ((repo as any).fallbackAdapter instanceof MockSheetsAdapter) {
        fallback = (repo as any).fallbackAdapter as MockSheetsAdapter;
      } else if (repo instanceof MockSheetsAdapter) {
        fallback = repo;
      }

      if (!fallback) {
        return { success: false, message: 'Adapter không tương thích — cần MockSheetsAdapter hoặc GoogleSheetsAdapter', counts: null };
      }

      const counts: any = {};

      // Đọc toàn bộ các tabs dữ liệu cùng lúc trong 1 round-trip (batchGet realtime)
      // BETA partition: phát hiện thêm các tab part (_P2, _P3...) rồi đọc nốt;
      // sau batch, GỘP part về tab gốc theo thứ tự -> phần parse bên dưới không cần biết.
      const baseTabs = [
        'NHAN_VIEN_MASTER',
        'TAI_KHOAN_NHAN_VIEN',
        'DANH_SACH_CHI_NHANH',
        'PHAN_CONG_CA',
        'DON_NGHI_PHEP',
        'SU_KIEN_DIEM_DANH',
        'ADMIN_ACCOUNTS',
        'DON_DOI_CA',
        'DIEU_CHINH_CONG',
        'KY_LUONG',
        'CAU_HINH_HE_THONG',
        'BAI_THI',
        'BAI_LAM',
        'PHIEU_LUONG',
        'LICH_SU_GIAI_DOAN',
        'CONG_THUC_LUONG',
        'DULIEU_LUONG_KY',
      ];
      const historyTabs = [...GoogleSheetsSyncService.HISTORY_TABS];
      // Tab nhật ký (thông báo/inbox/outbox/snapshot) đọc nhịp chậm hơn hẳn:
      // đây là các tab phình to nhất nhưng KHÔNG cần realtime từng 5 giây.
      const historyPullMs = Math.max(30_000, Number(process.env.SHEETS_HISTORY_PULL_MS) || 120_000);
      const historyDue = !this.lastHistoryPullAt || Date.now() - this.lastHistoryPullAt >= historyPullMs;
      // Chỉ parse lại tab nhật ký khi vừa đọc theo nhịp lịch sử (hoặc webhook vừa
      // sửa đúng tab đó). Parse 56k dòng mỗi 5 giây là lãng phí CPU nghiêm trọng.
      const shouldReparseHistory = historyDue || (!!opts.prefetchedBatch
        && Object.keys(opts.prefetchedBatch).some(k =>
          GoogleSheetsSyncService.HISTORY_TABS.has(k)
          || [...GoogleSheetsSyncService.HISTORY_TABS].some(base => k.startsWith(`${base}_P`))));
      let batch: Record<string, string[][]>;
      if (opts.prefetchedBatch) {
        // Webhook đã đọc lại đúng tab vừa sửa; parse trên cache để không batchGet 24 tab.
        batch = { ...opts.prefetchedBatch };
        for (const t of baseTabs) {
          if (!Array.isArray(batch[t])) batch[t] = [];
        }
        // Webhook sửa đúng tab nhật ký: cập nhật cache lịch sử bằng bản vừa đọc.
        for (const t of historyTabs) {
          if (Array.isArray(batch[t]) && batch[t].length > 0) this.lastHistoryBatch[t] = batch[t];
          else batch[t] = this.lastHistoryBatch[t] || [];
        }
      } else {
        const partTitles: string[] = [];
        try {
          for (const base of GoogleSheetsSyncService.PARTITION_TABS) {
            // QUAN TRỌNG: Chỉ đọc part của các tab thuộc chu kỳ pull realtime (baseTabs).
            // Các tab thuộc HISTORY_TABS (THONGBAO_GUI, THONGBAO_NV, SNAPSHOT_SAOLUU)
            // hoặc LUUTRU_CHAMCONG_TUAN, AUDIT_LOG được đọc riêng theo nhịp lịch sử
            // hoặc khi cần — tuyệt đối KHÔNG đưa vào tabsToRead của batch realtime,
            // tránh nuốt cả chục nghìn dòng mỗi vòng làm nghẽn 26.5s!
            if (!baseTabs.includes(base)) continue;
            // Mỗi bảng có spreadsheet riêng: hỏi metadata đúng file của bảng đó.
            const titles = await this.listSpreadsheetTabs(this.spreadsheetIdOf(base));
            for (let n = 2; n < 200; n++) {
              const t = `${base}_P${n}`;
              if (titles.includes(t)) partTitles.push(t);
              else break;
            }
          }
        } catch { /* lỗi metadata -> không có part, hành vi cũ */ }
        const tabsToRead = [...baseTabs, ...partTitles];
        // Timeout rộng hơn cho full-pull: Google chậm lúc cao điểm mà để
        // 20s thì pull fail liên tục, dữ liệu đứng yên dù mạng vẫn tốt.
        batch = await this.readTabsBatch(tabsToRead, 60_000);
        // Tab nhật ký đọc riêng: chỉ lấy các cột thực dùng và (với THONGBAO_NV)
        // chỉ lấy đuôi ~4.000 dòng thay vì 56.000 dòng mỗi 2 phút.
        if (historyDue) {
          const historyRead = await this.readHistoryTabs();
          for (const t of historyTabs) {
            batch[t] = Array.isArray(historyRead[t])
              ? historyRead[t]
              : (this.lastHistoryBatch[t] || []);
          }
        } else {
          for (const t of historyTabs) batch[t] = this.lastHistoryBatch[t] || [];
        }
        for (const base of GoogleSheetsSyncService.PARTITION_TABS) {
          if (GoogleSheetsSyncService.HISTORY_TABS.has(base)) continue; // đã gộp trong readHistoryTabs
          if (!Array.isArray(batch[base])) continue; // tab không nằm trong pull (VD LUUTRU/AUDIT đọc riêng)
          const parts: string[][][] = [];
          for (let n = 2; n < 200; n++) {
            const t = `${base}_P${n}`;
            if (Array.isArray(batch[t])) parts.push(batch[t]);
            else break;
          }
          if (parts.length) {
            batch[base] = [...(batch[base] || []), ...parts.flat()];
            console.log(`[GoogleSheetsSyncService] Pull ${base}: gộp ${parts.length} tab part`);
          }
        }
        if (historyDue) {
          // Lưu SAU khi gộp part để cache nhật ký cũng có đủ các tab _P2/_P3.
          for (const t of historyTabs) this.lastHistoryBatch[t] = batch[t] || [];
          this.lastHistoryPullAt = Date.now();
        }
      }

      // Đọc lỗi/quota trả về toàn rỗng trong khi bộ nhớ đang có dữ liệu thật
      // -> GIỮ NGUYÊN bộ nhớ, không ghi đè rỗng (tránh mất dữ liệu + login fail oan).
      const gotAnyRows = Object.values(batch).some(arr => arr.length > 0);
      const hadMemoryData = fallback.employees.length + fallback.accounts.length > 0;
      if (!gotAnyRows && hadMemoryData) {
        console.warn('[GoogleSheetsSyncService] Batch read trả về rỗng (nghi lỗi API/quota) — giữ nguyên dữ liệu trong bộ nhớ.');
        return { success: false, message: 'Empty batch read — keeping in-memory data', counts: null };
      }
      // Chỉ cache bản đọc thô sau khi đã qua guard rỗng. Nếu cache rỗng do lỗi
      // API, webhook tab-scoped sau đó sẽ parse toàn bộ tab từ cache rỗng.
      this.lastFullBatch = batch;

      // Guard từng tab: MỘT tab đọc rỗng (glitch/quota/timeout cục bộ) trong khi bộ nhớ
      // đang có dữ liệu tab đó -> GIỮ bộ nhớ, không gán rỗng (trước đây mất trắng entity
      // rồi lần sync sau ghi rỗng ngược lên Sheet = mất vĩnh viễn).
      const keepIfEmpty = (label: string, rows: any[][], existingCount: number): boolean => {
        if (rows.length === 0 && existingCount > 0) {
          console.warn(`[GoogleSheetsSyncService] Tab ${label} đọc rỗng nhưng bộ nhớ có ${existingCount} dòng — giữ bộ nhớ, bỏ qua tab này.`);
          return true;
        }
        return false;
      };

      // 1. Đọc NHAN_VIEN_MASTER
      const empRows = batch['NHAN_VIEN_MASTER'];
      if (keepIfEmpty('NHAN_VIEN_MASTER', empRows, fallback.employees.length)) {
        counts.employees = fallback.employees.length;
      } else if (empRows.length > 0) {
        const mappedEmps = empRows
          .filter(r => r && (r[2] || r[3]) && (!r[0] || !this.isEmployeeDeletedRecently(r[0])))
          .map((r, idx) => {
            const phone = (r[3] || '').trim();
            // Chuẩn hóa triệt để: Sheet có thể ghi +84/84/mất số 0 đầu (ô numeric).
            const phoneClean = canonicalPhone(phone);
            const empId = r[0] && r[0].trim() ? r[0].trim() : (phoneClean ? `EMP_${phoneClean}` : `EMP_${uuidv4().slice(0, 8)}`);
            const empCode = r[1] && r[1].trim() ? r[1].trim() : `UBM_NV${String(idx + 1).padStart(6, '0')}`;
            const fullName = (r[2] || '').trim() || 'Nhân Viên';
            const status = (r[4] as any) || 'OFFICIAL';
            const group = (r[5] as any) || 'STORE';
            const branchId = (r[6] || '').trim() || 'CN130';
            const rate = parseSheetCurrency(r[7]) ?? 25500;
            // Ngày chuẩn YYYY-MM-DD: ô Sheet có thể là serial/locate-format do
            // USER_ENTERED (VD '10/5/2026') — chuẩn hóa để không mất ngày sau reload.
            const startDate = normSheetDate(r[8]) || new Date().toISOString().split('T')[0];
            const version = Number(r[9]) || 1;
            const shiftRaw = (r[10] || '').trim().toUpperCase();
            const defaultShift = shiftRaw === 'CA_1' || shiftRaw === 'CA_2' || shiftRaw === 'CA_3' ? shiftRaw : undefined;
            // Cột M/N (sheet mới): Ngày Chính Thức + Email — sheet cũ thiếu thì giữ rỗng,
            // merge version bên dưới sẽ giữ bản bộ nhớ khi version bộ nhớ >= sheet.
            const officialDate = normSheetDate(r[11]);
            const email = (r[12] || '').trim();
            // Cột O/P/Q: Giới Tính + Ngày Sinh + CCCD (HR cập nhật ở tab Hồ Sơ NV) —
            // sheet cũ thiếu thì giữ rỗng, merge bên dưới vá từ bộ nhớ.

            return {
              employee_id: empId,
              employee_code: empCode,
              full_name: fullName,
              phone_normalized: phoneClean,
              employment_status: status,
              group: group,
              default_branch_id: branchId,
              current_rate_per_hour: rate,
              start_date: startDate,
              created_at: startDate,
              updated_at: new Date().toISOString(),
              version: version,
              ...(defaultShift ? { default_shift_code: defaultShift } : {}),
              ...(officialDate ? { official_date: officialDate } : {}),
              ...(email ? { email } : {}),
              ...((r[13] || '').trim() ? { gender: (r[13] || '').trim() } : {}),
              ...(normSheetDate(r[14]) ? { birth_date: normSheetDate(r[14]) } : {}),
              ...((r[15] || '').trim() ? { id_card_number: (r[15] || '').trim() } : {}),
              // Cột R: Avatar HR upload ở tab Hồ Sơ (Drive file ID).
              ...((r[16] || '').trim() ? { avatar_drive_id: (r[16] || '').trim() } : {}),
              // Cột S/T/U/V: Ngân hàng + QR NV upload ở cổng nhân viên — sheet cũ
              // thiếu thì giữ rỗng, merge bên dưới vá từ bộ nhớ.
              ...((r[17] || '').trim() ? { bank_name: (r[17] || '').trim() } : {}),
              ...((r[18] || '').trim() ? { bank_account: (r[18] || '').trim() } : {}),
              ...((r[19] || '').trim() ? { bank_holder: (r[19] || '').trim() } : {}),
              ...((r[20] || '').trim() ? { bank_qr_img: (r[20] || '').trim() } : {}),
              // Cột W/X: điểm bù công (số nguyên >= 0) — sheet cũ thiếu thì giữ rỗng,
              // merge bên dưới vá từ bộ nhớ.
              ...(/^-?\d+(\.\d+)?$/.test(String(r[21] ?? '').trim()) ? { adjust_points_earned: Math.max(0, Math.floor(Number(r[21]))) } : {}),
              ...(/^-?\d+(\.\d+)?$/.test(String(r[22] ?? '').trim()) ? { adjust_points_spent: Math.max(0, Math.floor(Number(r[22]))) } : {}),
              // Cột X: hợp đồng lao động (JSON: probation/official + Drive ID/tên file).
              // Sheet cũ thiếu cột -> giữ rỗng, merge bên dưới vá từ bộ nhớ.
              ...(() => {
                const docs = parseContractDocs(r[23]);
                return docs.probation || docs.official ? { contract_docs: docs } : {};
              })(),
              // Cột Y: danh sách đen (JSON: lý do/ghi chú/người đưa vào/thời điểm).
              // Có dữ liệu = NV đang bị đưa vào danh sách đen -> bật cờ blacklisted.
              ...(() => {
                const rec = parseBlacklist(r[24]);
                return rec ? { blacklist: rec, blacklisted: true } : {};
              })(),
            };
          });
        // Đọc thiếu dòng (partial/truncated) mà bộ nhớ đang nhiều hơn gấp đôi -> giữ bộ nhớ.
        // Kể cả map ra rỗng (dòng lỗi/filter hết) mà bộ nhớ đang có -> giữ.
        if (fallback.employees.length > 0 && (mappedEmps.length === 0 || (mappedEmps.length > 0 && fallback.employees.length > 5 && mappedEmps.length * 2 < fallback.employees.length))) {
          console.warn(`[GoogleSheetsSyncService] NHAN_VIEN_MASTER đọc thiếu/lỗi (${mappedEmps.length}/${fallback.employees.length}) — giữ bộ nhớ.`);
        } else {
          // Chống phình trùng: cùng employee_id/SĐT chỉ giữ 1 (bản cuối = mới nhất).
          const deduped = GoogleSheetsSyncService.dedupeBy(mappedEmps, e => (e as any).employee_id || (e as any).phone_normalized);
          if (deduped.length !== mappedEmps.length) {
            console.warn(`[GoogleSheetsSyncService] NHAN_VIEN_MASTER loại ${mappedEmps.length - deduped.length} dòng trùng.`);
          }
          // MERGE chống mất ca cố định vừa gán: gán ca chỉ nằm trong bộ nhớ (+tăng
          // version), Sheets được push sau (~10s debounce). Pull mà thay thế thẳng sẽ
          // ghi đè ca vừa gán (gán người này xong mất ca người kia). Bản version lớn thắng.
          const memEmpById = new Map<string, any>((fallback.employees || []).map((e: any) => [e.employee_id, e]));
          const mergedEmps: any[] = [];
          for (const s of deduped) {
            const m = memEmpById.get((s as any).employee_id);
            // Sheet nói OFFICIAL mà bộ nhớ còn PROBATION/PRE_ONBOARDING (HR sửa
            // trực tiếp cột Trạng thái trong Sheet — không bump version) -> Sheet
            // THẮNG cho cặp trạng thái này, nếu không version bộ nhớ (bị bump
            // vì các sửa phụ) sẽ lùi NV về thử việc mãi mà lương vẫn tính TV.
            const mSt = String((m as any)?.employment_status || '').toUpperCase();
            const sSt = String((s as any).employment_status || '').toUpperCase();
            const sheetSaysOfficial = sSt === 'OFFICIAL' && (mSt === 'PROBATION' || mSt === 'PRE_ONBOARDING');
            if (m && Number(m.version || 0) > Number((s as any).version || 0) && !sheetSaysOfficial) {
              mergedEmps.push(m);
            } else {
              // Sheet thắng/hòa version nhưng thiếu trường HR mới cập nhật (sheet cũ chưa
              // có cột O/P/Q, hoặc dòng chưa kịp push) -> vá từ bộ nhớ để không mất.
              if (m) {
                if ((m as any).account_locked) (s as any).account_locked = true;
                if ((m as any).account_status) (s as any).account_status = (m as any).account_status;
                // Cột M: Ngày chính thức — bộ nhớ có mà sheet trống (dòng cũ/chưa
                // push) thì vá, không để rông mốc lương TV/CT.
                if (!(s as any).official_date && (m as any).official_date) (s as any).official_date = (m as any).official_date;
                if (!(s as any).gender && (m as any).gender) (s as any).gender = (m as any).gender;
                if (!(s as any).birth_date && (m as any).birth_date) (s as any).birth_date = (m as any).birth_date;
                if (!(s as any).id_card_number && (m as any).id_card_number) (s as any).id_card_number = (m as any).id_card_number;
                if (!(s as any).email && (m as any).email) (s as any).email = (m as any).email;
                if (!(s as any).avatar_drive_id && (m as any).avatar_drive_id) (s as any).avatar_drive_id = (m as any).avatar_drive_id;
                if (!(s as any).avatar_photo && (m as any).avatar_photo) (s as any).avatar_photo = (m as any).avatar_photo;
                if (!(s as any).bank_name && (m as any).bank_name) (s as any).bank_name = (m as any).bank_name;
                if (!(s as any).bank_account && (m as any).bank_account) (s as any).bank_account = (m as any).bank_account;
                if (!(s as any).bank_holder && (m as any).bank_holder) (s as any).bank_holder = (m as any).bank_holder;
                if (!(s as any).bank_qr_img && (m as any).bank_qr_img) (s as any).bank_qr_img = (m as any).bank_qr_img;
                if ((s as any).adjust_points_earned === undefined && (m as any).adjust_points_earned !== undefined) (s as any).adjust_points_earned = (m as any).adjust_points_earned;
                if ((s as any).adjust_points_spent === undefined && (m as any).adjust_points_spent !== undefined) (s as any).adjust_points_spent = (m as any).adjust_points_spent;
                // Cột X: hợp đồng lao động — sheet cũ chưa có cột thì vá từ bộ nhớ,
                // tránh pull xóa mất metadata hợp đồng vừa upload.
                if (!(s as any).contract_docs && (m as any).contract_docs) (s as any).contract_docs = (m as any).contract_docs;
                // Cột Y: danh sách đen — bộ nhớ có mà sheet trống (dòng cũ/chưa push)
                // thì vá lại, tránh pull gỡ cờ đen + khóa tài khoản.
                if (!(s as any).blacklist && (m as any).blacklist) {
                  (s as any).blacklist = (m as any).blacklist;
                  (s as any).blacklisted = true;
                }
              }
              mergedEmps.push(s);
            }
            memEmpById.delete((s as any).employee_id);
          }
          for (const m of memEmpById.values()) mergedEmps.push(m);
          fallback.employees = mergedEmps as any;
        }
      } else if (fallback.employees.length === 0) {
        fallback.employees = [];
      }
      counts.employees = fallback.employees.length;

      // 2. Đọc TAI_KHOAN_NHAN_VIEN (không còn cột Người/Ngày Kích Hoạt — PIN là cửa duy nhất)
      // Hệ thống TỰ sinh mã PIN khởi tạo cho mọi tài khoản chưa có (kể cả dữ liệu cũ):
      // không còn HR cấp tay, nhân viên đăng nhập lần đầu rồi đặt PIN riêng ngay.
      const accRows = batch['TAI_KHOAN_NHAN_VIEN'];
      let pinDirty = false;
      if (keepIfEmpty('TAI_KHOAN_NHAN_VIEN', accRows, fallback.accounts.length)) {
        counts.accounts = fallback.accounts.length;
      } else if (accRows.length > 0) {
        const mappedAccs = accRows
          .filter(r => r && (r[0] || r[2]) && !this.isAccountDeletedRecently(r[0], r[1]))
          .map(r => {
            const rawSt = String(r[4] || '').trim().toUpperCase();
            const isLocked = rawSt === 'LOCKED' || rawSt.includes('KHÓA') || rawSt.includes('KHOA');
            return {
            account_id: String(r[0] ?? '').trim() || `ACC_${uuidv4().slice(0, 8)}`,
            employee_id: String(r[1] ?? '').trim(),
            phone_normalized: canonicalPhone(r[2] || ''),
            role: (r[3] as any) || 'EMPLOYEE',
            account_status: (isLocked ? 'LOCKED' : 'ACTIVE') as any,
            branch_scope: 'ALL',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            version: Number(r[5]) || 1,
            pin_hash: isLocked ? undefined : (r[6] || undefined),
            pin_must_change: isLocked ? false : (r[7] === 'YES'),
            // Cột Mã PIN bản rõ — chỉ hiển thị trên cổng quản trị (Admin/HR).
            pin_code: isLocked ? undefined : (r[8] || undefined),
            // Cột Đổi PIN Cuối (ISO) + Kỳ PIN (YYYY-MM): tự đổi định kỳ hàng tháng 1-5.
            pin_changed_at: r[9] || undefined,
            pin_rotation_cycle: r[10] || undefined,
          }; });
        // Đọc thiếu dòng mà bộ nhớ đang nhiều hơn gấp đôi -> giữ bộ nhớ (chống mất PIN hàng loạt).
        // Kể cả map ra rỗng (dòng lỗi/filter hết) mà bộ nhớ đang có -> giữ.
        if (fallback.accounts.length > 0 && (mappedAccs.length === 0 || (mappedAccs.length > 0 && fallback.accounts.length > 5 && mappedAccs.length * 2 < fallback.accounts.length))) {
          console.warn(`[GoogleSheetsSyncService] TAI_KHOAN_NHAN_VIEN đọc thiếu/lỗi (${mappedAccs.length}/${fallback.accounts.length}) — giữ bộ nhớ.`);
          counts.accounts = fallback.accounts.length;
        } else {
          // Chống phình trùng: cùng account_id chỉ giữ 1; cùng (employee_id+SĐT) ưu tiên bản CÓ pin_hash.
          const byId = GoogleSheetsSyncService.dedupeBy(mappedAccs, a => (a as any).account_id);
          const byOwner = new Map<string, any>();
          for (const a of byId) {
            const k = `${(a as any).employee_id}|${(a as any).phone_normalized}`;
            const cur = byOwner.get(k);
            if (!cur || (!(cur as any).pin_hash && (a as any).pin_hash)) byOwner.set(k, a);
          }
          const deduped = [...byOwner.values()];
          if (deduped.length !== mappedAccs.length) {
            console.warn(`[GoogleSheetsSyncService] TAI_KHOAN_NHAN_VIEN loại ${mappedAccs.length - deduped.length} dòng trùng.`);
          }
          // MERGE chống mất PIN mới: NV vừa đổi PIN chỉ nằm trong bộ nhớ (+tăng version),
          // Sheets vẫn còn hash/version cũ cho đến khi full-sync push xong (~10s).
          // Pull mà thay thế thẳng sẽ ghi đè PIN mới -> NV báo "đổi PIN mà vẫn dùng PIN cũ".
          // Quy tắc: cùng account_id, bản nào version lớn hơn thì thắng; tài khoản chỉ có
          // trong bộ nhớ (chưa kịp push) được giữ lại.
          const memById = new Map<string, any>((fallback.accounts || []).map((a: any) => [a.account_id, a]));
          const merged: any[] = [];
          for (const s of deduped) {
            const m = memById.get((s as any).account_id);
            if (m && ((m as any).account_status === 'LOCKED' || (m as any).account_locked)) {
              (s as any).account_status = 'LOCKED';
              delete (s as any).pin_hash;
              delete (s as any).pin_code;
              (s as any).pin_must_change = false;
            }
            if (m && Number(m.version || 0) > Number((s as any).version || 0)) {
              merged.push(m);
            } else {
              merged.push(s);
            }
            memById.delete((s as any).account_id);
          }
          for (const m of memById.values()) merged.push(m);
          fallback.accounts = merged as any;
        }
        // Backfill: tài khoản cũ CHƯA CÓ pin_hash -> tự sinh PIN khởi tạo (giới hạn
        // 20/pull để bcrypt không chặn event-loop). KHÔNG reset PIN đã có (dù hiển
        // thị chưa đủ 6 số) — NV đăng nhập bằng PIN cũ rồi tự đổi PIN mới khi tới hạn.
        let backfilled = 0;
        for (const acc of fallback.accounts) {
          // Tài khoản bị HR khóa: KHÔNG tự sinh PIN lại (giữ trạng thái khóa + không PIN).
          const emp = fallback.employees.find((e: any) =>
            e.employee_id === acc.employee_id ||
            (acc.phone_normalized && canonicalPhone(e.phone_normalized || '') === canonicalPhone(acc.phone_normalized))
          );
          const isAccLocked = (acc as any).account_status === 'LOCKED' ||
            (emp as any)?.account_locked === true ||
            (emp as any)?.account_status === 'LOCKED';
          if (isAccLocked) {
            (acc as any).account_status = 'LOCKED';
            delete (acc as any).pin_hash;
            delete (acc as any).pin_code;
            (acc as any).pin_must_change = false;
            continue;
          }
          if (!acc.pin_hash) {
            if (backfilled >= 20) break;
            const autoPin = generateAutoPin();
            acc.pin_hash = await hashPin(autoPin);
            acc.pin_code = autoPin;
            acc.pin_must_change = true;
            acc.updated_at = new Date().toISOString();
            pinDirty = true;
            backfilled++;
            continue;
          }
          // KHÔNG reset PIN đã có (dù cột bản rõ chưa đủ 6 số): NV đăng nhập bằng
          // PIN cũ rồi tự đổi PIN mới khi tới hạn — tránh vô hiệu PIN đang dùng.
          // Chuẩn hóa lần đầu cho cột mới (không ghi đè dữ liệu đã có).
          if ((acc as any).pin_changed_at === undefined) (acc as any).pin_changed_at = '';
          if ((acc as any).pin_rotation_cycle === undefined) (acc as any).pin_rotation_cycle = '';
        }
        counts.pinBackfilled = backfilled;
        // PIN tự sinh chỉ mới nằm bộ nhớ — đặt cờ dirty để auto-push định kỳ
        // chắc chắn đẩy lên Sheet (trước đây dựa full-push chạy miễn phí mỗi 5 phút).
        if (pinDirty) this.markDataDirty();
      } else if (fallback.accounts.length === 0) {
        fallback.accounts = [];
      }

      // TỰ ĐỘNG ĐỐI CHIẾU: MỌI nhân viên có SĐT hợp lệ đều phải có tài khoản + PIN mặc định.
      // -> Tự động sinh tài khoản ACTIVE kèm mã PIN khởi tạo để nhân viên đăng nhập ngay bằng SĐT!
      const existingPhones = new Set(fallback.accounts.map(a => a.phone_normalized).filter(Boolean));
      let autoCreated = 0;
      const noPhoneSamples: string[] = [];
      for (const emp of fallback.employees) {
        if (emp.employment_status === 'TERMINATED') continue;
        if ((emp as any).account_locked === true || (emp as any).account_status === 'LOCKED') continue;
        if (!emp.phone_normalized || emp.phone_normalized.length < 9) {
          if (noPhoneSamples.length < 8) noPhoneSamples.push(`${emp.full_name} (${emp.employee_code})`);
          continue;
        }
        if (!existingPhones.has(emp.phone_normalized)) {
          if (autoCreated >= 30) continue; // giới hạn 30/pull để bcrypt không chặn server
          existingPhones.add(emp.phone_normalized);
          const autoPin = generateAutoPin();
          fallback.accounts.push({
            account_id: `ACC_${emp.employee_id.replace(/^EMP_/, '')}`,
            employee_id: emp.employee_id,
            phone_normalized: emp.phone_normalized,
            role: 'EMPLOYEE' as any,
            account_status: 'ACTIVE' as any,
            branch_scope: emp.default_branch_id || 'ALL',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            version: 1,
            pin_hash: await hashPin(autoPin),
            pin_code: autoPin,
            pin_must_change: true,
          });
          pinDirty = true;
          autoCreated++;
        }
      }
      if (autoCreated > 0) {
        console.log(`[GoogleSheetsSyncService] Đã cấp PIN mặc định cho ${autoCreated} nhân viên có SĐT chưa có tài khoản.`);
      }
      if (noPhoneSamples.length > 0) {
        console.warn(`[GoogleSheetsSyncService] ${noPhoneSamples.length}+ nhân viên THIẾU SĐT hợp lệ nên chưa cấp được PIN (mẫu: ${noPhoneSamples.join('; ')}). HR bổ sung SĐT trên Sheet!`);
      }
      counts.accounts = fallback.accounts.length;
      counts.accountsAutoCreated = autoCreated;
      counts.employeesNoValidPhone = noPhoneSamples.length;

      // TỰ ĐỘNG THU HỒI TRUY CẬP khi nhân viên chuyển TERMINATED (trên Sheet):
      // tăng version tài khoản -> mọi token đang dùng hết hiệu lực ngay ở request kế tiếp.
      // (Đăng nhập đã bị chặn; đây là lớp khóa phiên đang sống.)
      for (const emp of fallback.employees) {
        if (emp.employment_status !== 'TERMINATED') continue;
        if ((fallback as any).terminatedRevoked?.has(emp.employee_id)) continue;
        let revokedAny = false;
        for (const acc of fallback.accounts) {
          if (acc.employee_id === emp.employee_id) {
            acc.version += 1;
            acc.updated_at = new Date().toISOString();
            revokedAny = true;
          }
        }
        if (revokedAny) {
          (fallback as any).terminatedRevoked?.add(emp.employee_id);
          await repo.recordAuditLog({
            log_id: `LOG_${Date.now()}_${emp.employee_id}`,
            actor_id: 'SYSTEM',
            actor_role: 'SYSTEM',
            action: 'AUTO_REVOKE_TERMINATED',
            target_entity: 'TAI_KHOAN_NHAN_VIEN',
            target_id: emp.employee_id,
            details: `Tự động thu hồi phiên đăng nhập của nhân viên nghỉ việc ${emp.full_name} (${emp.employee_code})`,
          }).catch(() => null);
        }
      }

      // PIN vừa sinh chỉ nằm trong bộ nhớ -> ghi ngay xuống Sheet để lần pull sau không sinh lại số khác.
      // Bọc try/catch: ghi lỗi KHÔNG được làm sập cả lần pull.
      if (pinDirty && this.sheetsClient) {
        try {
          const rows = fallback.accounts.map(acc => [
            acc.account_id,
            acc.employee_id,
            GoogleSheetsSyncService.sheetText(acc.phone_normalized),
            acc.role,
            acc.account_status,
            acc.version,
            (acc as any).pin_hash || '',
            acc.pin_must_change ? 'YES' : '',
            GoogleSheetsSyncService.sheetText((acc as any).pin_code || ''),
            GoogleSheetsSyncService.sheetText((acc as any).pin_changed_at || ''),
            GoogleSheetsSyncService.sheetText((acc as any).pin_rotation_cycle || ''),
          ]);
          const def = SHEETS_DEFINITIONS.find(d => d.title === 'TAI_KHOAN_NHAN_VIEN')!;
          await this.overwriteSheetData('TAI_KHOAN_NHAN_VIEN', def.headers, rows);
        } catch (e: any) {
          console.warn('[GoogleSheetsSyncService] Ghi PIN khởi tạo xuống Sheet thất bại (sẽ thử lại lần pull sau):', e?.message || e);
        }
      }

      // Các tab phụ (3-12): tab nào lỗi thì giữ dữ liệu cũ của tab đó, các tab
      // còn lại vẫn cập nhật — 1 tab hỏng không được giết cả lần pull.
      let partialError: string | null = null;
      try {
      // 3. Đọc DANH_SACH_CHI_NHANH
      const branchRows = batch['DANH_SACH_CHI_NHANH'];
      // Admin/HR vừa bật-tắt/sửa toạ độ chi nhánh: bản ghi mới có thể chưa kịp
      // lên Sheet. Bỏ qua đọc đè trong thời gian khoá để cờ trên bản đồ không
      // bị "nhảy" về giá trị cũ giữa 2 lần pull.
      const branchPullLocked = !!(repo as any).isBranchWriteLocked?.();
      const branchesInMemory = Array.isArray(fallback.branches) ? fallback.branches : [];
      if (branchPullLocked) {
        counts.branches = branchesInMemory.length;
      } else if (keepIfEmpty('DANH_SACH_CHI_NHANH', branchRows, branchesInMemory.length)) {
        // Đọc rỗng (quota/glitch): GIỮ NGUYÊN chi nhánh trong bộ nhớ. Trước đây rơi
        // xuống nhánh else -> gán lại BRANCHES mẫu: mất cờ ẩn/hiện + toạ độ Admin
        // vừa sửa, và các tab khác đọc thấy chi nhánh "hiện lại" như bị revert.
        counts.branches = branchesInMemory.length;
      } else if (branchRows.length > 0) {
        // Sheet không có cột quản lý/định biên -> giữ giá trị đang có trong bộ nhớ
        // thay vì ghi đè bằng hằng số mặc định.
        const prevById = new Map(branchesInMemory.map((b: any) => [String(b?.id ?? '').trim().toUpperCase(), b]));
        fallback.branches = branchRows.map(r => {
          const id = String(r[0] ?? '').trim();
          const old: any = prevById.get(id.toUpperCase()) || {};
          return {
            id,
            name: r[1] || old.name || id,
            address: r[2] ?? old.address ?? '',
            latitude: parseSheetNumber(r[3]) ?? old.latitude ?? 10.776889,
            longitude: parseSheetNumber(r[4]) ?? old.longitude ?? 106.700806,
            radius_meters: parseSheetNumber(r[5]) ?? old.radius_meters ?? 300,
            min_staff: Number(old.min_staff) > 0 ? Number(old.min_staff) : 2,
            max_staff: Number(old.max_staff) > 0 ? Number(old.max_staff) : 10,
            manager_name: old.manager_name || '',
            status: (r[6] as any) || old.status || 'ACTIVE',
            gps_enabled: parseSheetBoolean(r[7], old.gps_enabled !== false),
            map_visible: parseSheetBoolean(r[8], old.map_visible !== false),
          };
        });
      } else if (branchesInMemory.length === 0) {
        fallback.branches = [...BRANCHES];
      }
      counts.branches = fallback.branches.length;

      // 4. Đọc PHAN_CONG_CA
      const shiftRows = batch['PHAN_CONG_CA'];
      if (keepIfEmpty('PHAN_CONG_CA', shiftRows, fallback.shifts.length)) {
        counts.shifts = fallback.shifts.length;
      } else if (shiftRows.length > 0) {
        const mappedShifts = shiftRows.map(r => ({
          assignment_id: String(r[0] ?? '').trim() || `SHF_${uuidv4().slice(0, 8)}`,
          // Mã NV phải trim về đúng chuẩn NHAN_VIEN_MASTER (cũng đã trim). Ô Sheet
          // dán tay hay bị dính khoảng trắng/số -> trước đây ca vẫn nằm trên lưới
          // chi nhánh nhưng /me/schedule so khớp tuyệt đối nên NV báo "không có ca".
          employee_id: String(r[1] ?? '').trim(),
          branch_id: String(r[2] ?? '').trim() || 'CN130',
          shift_code: String(r[3] ?? '').trim().toUpperCase() || 'CA_1',
          date: normSheetDate(r[4]) || new Date().toISOString().split('T')[0],
          // start_at/end_at cũng dính USER_ENTERED locale như client_time — normalize
          // để reload không sai giờ mở cổng/khóa ca 3 tiếng.
          start_at: normSheetDateTime(r[5]) || r[5] || new Date().toISOString(),
          end_at: normSheetDateTime(r[6]) || r[6] || new Date().toISOString(),
          status: String(r[7] ?? '').trim().toUpperCase() || 'PUBLISHED',
          schedule_version: Number(r[8]) || 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));
        // MERGE chống mất ca vừa PUBLISH: đổi trạng thái chỉ nằm trong bộ nhớ
        // (+tăng schedule_version), Sheets push sau. Bản schedule_version lớn thắng;
        // ca chỉ có trong bộ nhớ (vừa tạo, append đang bay) được giữ lại.
        // Chống dòng trùng trên Sheets (append thử lại) tạo "ca ma": cùng
        // assignment_id chỉ giữ 1 bản mới nhất.
        const dedupedMapped = GoogleSheetsSyncService.dedupeBy(mappedShifts, s => (s as any).assignment_id);
        if (dedupedMapped.length !== mappedShifts.length) {
          console.warn(`[GoogleSheetsSyncService] PHAN_CONG_CA loại ${mappedShifts.length - dedupedMapped.length} dòng trùng.`);
        }
        const memShiftById = new Map<string, any>((fallback.shifts || []).map((s: any) => [s.assignment_id, s]));
        const mergedShifts: any[] = [];
        for (const s of dedupedMapped) {
          const m = memShiftById.get((s as any).assignment_id);
          // Version bằng nhau + trạng thái mạnh hơn trong bộ nhớ (PUBLISHED so với
          // DRAFT trên Sheet) thì GIỮ bộ nhớ — tránh pull hạ ca đã publish về nháp.
          let winner = pickPulledShift(m, s);
          // Trạng thái hủy là TERMINAL: pull đua (đọc Sheet bản PUBLISHED cũ trước
          // thời điểm hủy) không được hồi sinh ca đã CANCELLED trong bộ nhớ.
          if (
            m &&
            String((m as any).status) === 'CANCELLED' &&
            String((winner as any).status) !== 'CANCELLED' &&
            Number(m.schedule_version || 0) >= Number((s as any).schedule_version || 0)
          ) {
            winner = m;
          }
          mergedShifts.push(winner);
          memShiftById.delete((s as any).assignment_id);
        }
        for (const m of memShiftById.values()) mergedShifts.push(m);
        fallback.shifts = mergedShifts as any;
      } else if (fallback.shifts.length === 0) {
        fallback.shifts = [];
      }
      // Dọn dòng trùng NGHIỆP VỤ (cùng NV + ngày + mã ca nhưng khác
      // assignment_id) do append và full-sync từng ghi đua nhau. Giữ bản
      // PUBLISHED/version cao nhất; sự kiện của bản bị bỏ sẽ được logic orphan
      // gộp sang ca giữ lại, nên không mất công/lương.
      {
        const beforeDedupe = fallback.shifts.length;
        fallback.shifts = dedupeShiftAssignments(fallback.shifts as any[]) as any;
        if (fallback.shifts.length !== beforeDedupe) {
          console.warn(`[GoogleSheetsSyncService] PHAN_CONG_CA loại ${beforeDedupe - fallback.shifts.length} ca trùng ngày/mã.`);
          // Đánh dấu bẩn để auto-push dọn luôn các dòng trùng còn trên Sheet,
          // không chỉ ẩn trong bộ nhớ/UI.
          this.markDataDirty();
        }
      }
      counts.shifts = fallback.shifts.length;

      // 5. Đọc DON_NGHI_PHEP
      const leaveRows = batch['DON_NGHI_PHEP'];
      if (keepIfEmpty('DON_NGHI_PHEP', leaveRows, fallback.leaveRequests.length)) {
        counts.leaves = fallback.leaveRequests.length;
      } else if (leaveRows.length > 0) {
        const mappedLeaves = leaveRows.map(r => {
          const leaveType = (r[3] as any) || 'DOT_XUAT';
          let status = (r[7] as any) || 'PENDING';
          // Đồng bộ dữ liệu cũ: lịch OFF tuần (HANG_TUAN) tự động ghi nhận —
          // bản ghi PENDING từ trước thời điểm auto-approve được chữa thành APPROVED.
          if (leaveType === 'HANG_TUAN' && status === 'PENDING') status = 'APPROVED';
          return {
            request_id: String(r[0] ?? '').trim() || `LV_${uuidv4().slice(0, 8)}`,
            employee_id: String(r[1] ?? '').trim(),
            branch_id: String(r[2] ?? '').trim() || 'CN130',
            leave_type: leaveType,
            requested_date: normSheetDate(r[4]) || new Date().toISOString().split('T')[0],
            shift_code: (String(r[5] ?? '').trim() || undefined) as any,
            reason: r[6] || '',
            status,
            reviewed_by: r[8] || (status === 'APPROVED' && leaveType === 'HANG_TUAN' ? 'SYSTEM' : undefined),
            review_note: r[9] || (status === 'APPROVED' && leaveType === 'HANG_TUAN' ? 'Tự động ghi nhận lịch OFF 2 ngày/tuần' : undefined),
            created_at: r[10] || new Date().toISOString(),
            version: 1,
          };
        });
        fallback.leaveRequests = mergeById(fallback.leaveRequests, mappedLeaves, 'request_id', ['version']) as any;
      } else if (fallback.leaveRequests.length === 0) {
        fallback.leaveRequests = [];
      }
      counts.leaves = fallback.leaveRequests.length;

      // 5b. Đọc BAI_THI (câu hỏi lưu JSON 1 ô; tab chưa có -> giữ bộ nhớ)
      const paperRows = batch['BAI_THI'] || [];
      if (keepIfEmpty('BAI_THI', paperRows, (fallback as any).testPapers?.length || 0)) {
        counts.testPapers = ((fallback as any).testPapers || []).length;
      } else if (paperRows.length > 0) {
        const mappedPapers = paperRows
          .filter(r => r && r[0])
          .map(r => {
            let questions: any[] = [];
            try {
              const parsed = JSON.parse(r[3] || '[]');
              questions = Array.isArray(parsed) ? parsed : [];
            } catch { questions = []; }
            return {
              test_id: r[0],
              title: r[1] || 'Bài TEST',
              description: r[2] || '',
              questions,
              pass_score: Number(r[4]) || 8,
              time_limit_seconds: Number(r[5]) || 480,
              status: (r[6] as any) || 'ASSIGNED',
              created_by: r[7] || 'SYSTEM',
              created_at: r[8] || new Date().toISOString(),
              updated_at: r[8] || new Date().toISOString(),
              version: Number(r[9]) || 1,
            };
          });
        (fallback as any).testPapers = mergeById((fallback as any).testPapers || [], mappedPapers, 'test_id', ['version']);
        counts.testPapers = (fallback as any).testPapers.length;
      } else if (((fallback as any).testPapers || []).length === 0) {
        (fallback as any).testPapers = [];
      }

      // 5c. Đọc BAI_LAM
      const subRows = batch['BAI_LAM'] || [];
      if (keepIfEmpty('BAI_LAM', subRows, (fallback as any).testSubmissions?.length || 0)) {
        counts.testSubmissions = ((fallback as any).testSubmissions || []).length;
      } else if (subRows.length > 0) {
        const mappedSubs = subRows
          .filter(r => r && r[0])
          .map(r => {
            let answers: any = undefined;
            try {
              const parsed = JSON.parse(r[4] || 'null');
              answers = Array.isArray(parsed) ? parsed : undefined;
            } catch { answers = undefined; }
            return {
              submission_id: r[0],
              test_id: r[1] || '',
              employee_id: r[2] || '',
              status: (r[3] as any) || 'ASSIGNED',
              answers,
              score: r[5] === '' || r[5] === undefined ? undefined : Number(r[5]),
              passed: r[6] === 'YES' ? true : r[6] === 'NO' ? false : undefined,
              submitted_at: r[7] || undefined,
              created_at: r[8] || new Date().toISOString(),
              version: Number(r[9]) || 1,
            };
          });
        (fallback as any).testSubmissions = mergeById((fallback as any).testSubmissions || [], mappedSubs, 'submission_id', ['version']);
        counts.testSubmissions = (fallback as any).testSubmissions.length;
      } else if (((fallback as any).testSubmissions || []).length === 0) {
        (fallback as any).testSubmissions = [];
      }

      // 5d. Đọc THONGBAO_NV (Sheet giữ toàn bộ lịch sử — merge, không bao giờ xóa).
      // Inbox realtime chỉ giữ thông báo HÔM NAY (giờ VN): bản hôm qua pull về
      // cũng bị loại ngay để không hiện lại sau reset 6h (fix lỗi reset xong lại đầy).
      const notifRows = batch['THONGBAO_NV'] || [];
      const vnToday = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
      const [nYY, nMM, nDD] = vnToday.split('-').map(Number);
      const notifCutoff = new Date(Date.UTC(nYY, nMM - 1, nDD) - 7 * 3_600_000).toISOString();
      // Sau reset 23h00 trong ngày: chỉ giữ tin tạo sau mốc reset (chặn dòng cũ
      // kéo lại); sang ngày mới thì xả latch để tin mới vào bình thường.
      let notifEffCutoff = notifCutoff;
      if (this.notifResetCutoffIso) {
        if (this.notifResetCutoffIso <= notifCutoff) this.notifResetCutoffIso = null;
        else notifEffCutoff = this.notifResetCutoffIso;
      }
      if (shouldReparseHistory && notifRows.length > 0) {
        const mappedNotif = notifRows
          .filter(r => r && r[0] && r[3] !== 'CHECKIN_REMINDER' && !/nhắc.*(?:check-?in|điểm danh)/i.test(`${r[4] || ''} ${r[5] || ''}`))
          .map(r => ({
            inbox_id: r[0],
            notification_id: r[1] || '',
            recipient_id: r[2] || 'ALL',
            type: r[3] || undefined,
            title: r[4] || 'Thông báo',
            summary: r[5] || '',
            severity: (r[6] as any) || 'SYSTEM',
            target_path: r[7] || undefined,
            created_at: r[8] || new Date().toISOString(),
            read_at: r[9] === 'YES' ? (r[8] || new Date().toISOString()) : undefined,
            version: 1,
          }));
        fallback.notificationInbox = mergeById(fallback.notificationInbox, mappedNotif, 'inbox_id', ['version']) as any;
      }
      fallback.notificationInbox = (fallback.notificationInbox || []).filter(
        (n: any) => (n.created_at || '') >= notifEffCutoff &&
          n.type !== 'CHECKIN_REMINDER' &&
          !/nhắc.*(?:check-?in|điểm danh)/i.test(`${n.title || ''} ${n.summary || ''}`)
      );
      counts.notifications = fallback.notificationInbox.length;

      // 5e. Đọc THONGBAO_GUI (outbox — lịch sử thông báo đã gửi): merge, không bao giờ
      // xóa. Áp cùng bộ lọc cutoff giờ VN/reset 23h00 như inbox để hộp thư reset xong
      // không bị dòng Sheet cũ kéo lại đầy.
      const outboxRows = batch['THONGBAO_GUI'] || [];
      if (!shouldReparseHistory) {
        // Nhịp 5s: chỉ lọc lại bộ nhớ (rất nhỏ), không map lại 15k dòng Sheet.
        counts.notificationOutbox = ((fallback as any).notificationOutbox || []).length;
      } else if (keepIfEmpty('THONGBAO_GUI', outboxRows, (fallback.notificationOutbox as any[] || []).length)) {
        counts.notificationOutbox = (fallback.notificationOutbox as any[] || []).length;
      } else if (outboxRows.length > 0) {
        const mappedOutbox = outboxRows
          .filter(r => r && r[0])
          .map(r => ({
            notification_id: r[0],
            event_id: r[1] || '',
            dedupe_key: r[2] || `NOTIF_${r[0]}`,
            recipient_id: r[3] || 'ALL',
            type: r[4] || 'system',
            severity: (r[5] as any) || 'SYSTEM',
            title: r[6] || 'Thông báo',
            summary: r[7] || '',
            target_path: r[8] || undefined,
            channel: (r[9] as any) || 'IN_APP',
            delivery_status: (r[10] as any) || 'SENT',
            attempts: Number(r[11]) || 1,
            last_error: r[12] || undefined,
            created_at: r[13] || new Date().toISOString(),
          }));
        (fallback as any).notificationOutbox = mergeById(((fallback as any).notificationOutbox || []) as any[], mappedOutbox as any[], 'notification_id', ['attempts']);
      }
      // Dùng cùng mốc cutoff đã tính ở khối inbox (giờ VN hôm nay + reset 23h00).
      (fallback as any).notificationOutbox = ((fallback as any).notificationOutbox || []).filter(
        (o: any) => (o.created_at || '') >= notifEffCutoff
      );
      counts.notificationOutbox = ((fallback as any).notificationOutbox || []).length;

      // 5f. Đọc SNAPSHOT_SAOLUU (metadata snapshot sao lưu): merge hợp nhất — snapshot
      // nhớ đã có + snapshot trên Sheet (restart sau push đầy đủ).
      const snapSheetRows = batch['SNAPSHOT_SAOLUU'] || [];
      if (!shouldReparseHistory) {
        counts.backupSnapshots = (fallback.backupSnapshots as any[] || []).length;
      } else if (keepIfEmpty('SNAPSHOT_SAOLUU', snapSheetRows, (fallback.backupSnapshots as any[] || []).length)) {
        counts.backupSnapshots = (fallback.backupSnapshots as any[] || []).length;
      } else if (snapSheetRows.length > 0) {
        const mappedSnaps = snapSheetRows
          .filter(r => r && r[0])
          .map(r => ({
            snapshot_id: r[0],
            name: r[1] || '',
            created_at: r[2] || '',
            file_count: Number(r[3]) || 0,
            size_mb: Number(r[4]) || 0,
            status: r[5] || 'SUCCESS',
            verified: r[6] === 'YES',
          }));
        (fallback as any).backupSnapshots = mergeById(((fallback as any).backupSnapshots || []) as any[], mappedSnaps as any[], 'snapshot_id', ['created_at']);
        counts.backupSnapshots = (fallback.backupSnapshots as any[]).length;
      } else if (((fallback as any).backupSnapshots || []).length === 0) {
        (fallback as any).backupSnapshots = [];
      }

      // 6. Đọc SU_KIEN_DIEM_DANH
      const attRows = (batch['SU_KIEN_DIEM_DANH'] || []).filter(r => r && r[0] && !this.isEventDeletedRecently(r[0]));
      if (keepIfEmpty('SU_KIEN_DIEM_DANH', attRows, fallback.attendanceEvents.length)) {
        counts.attendanceEvents = fallback.attendanceEvents.length;
      } else if (attRows.length > 0) {
        // Giờ giấc normalize triệt để: Sheet USER_ENTERED parse ISO thành datetime
        // locale ('M/D/YYYY H:mm') — đọc raw sẽ sai instant, reload mất check-in/out.
        const memEvtBranch = new Map<string, string>(
          (fallback.attendanceEvents || []).map((e: any) => [String(e.event_id), String(e.branch_id || '')])
        );
        // Ảnh inline theo event_id (phục vụ khôi phục sau merge bên dưới).
        const memEvtPhoto = new Map<string, string>();
        for (const e of (fallback.attendanceEvents || []) as any[]) {
          const ph = String((e as any)?.event_photo || '');
          if (ph) memEvtPhoto.set(String((e as any)?.event_id || ''), ph);
        };
        const mappedEvents = attRows.map(r => {
          const clientIso = normSheetDateTime(r[12]) || normSheetDateTime(r[4]);
          const serverIso = normSheetDateTime(r[4]);
          const fallbackIso = new Date().toISOString();
          return {
            event_id: String(r[0] ?? '').trim() || `ATT_${uuidv4().slice(0, 8)}`,
            request_id: String(r[10] ?? '').trim() || uuidv4(),
            assignment_id: String(r[1] ?? '').trim(),
            employee_id: String(r[2] ?? '').trim(),
            branch_id: '',
            type: (r[3] as any) || 'CHECK_IN',
            // Ưu tiên giờ máy khách (kèm +07:00) để lọc đúng ngày VN; dòng cũ lấy giờ server
            client_time: clientIso || r[12] || r[4] || fallbackIso,
            server_received_at: serverIso || r[4] || fallbackIso,
            gps_latitude: Number(r[5]) || 0,
            gps_longitude: Number(r[6]) || 0,
            distance_meters: Number(r[7]) || 0,
            gps_status: (r[8] as any) || 'VALID',
            drive_object_id: r[9] || undefined,
            uniform_pink_ratio: r[11] === '' || r[11] === undefined ? undefined : Number(r[11]),
            // Cờ trễ/sớm để tính phạt (dòng cũ chưa có cột -> undefined, payroll/popup tự tính bù từ giờ ca)
            is_late: r[13] === 'YES' ? true : (r[13] ? false : undefined),
            is_early: r[14] === 'YES' ? true : (r[14] ? false : undefined),
            minutes_deviation: r[15] === '' || r[15] === undefined ? undefined : Number(r[15]),
            fine_tier: r[16] || undefined,
            fine_amount: r[17] === '' || r[17] === undefined ? undefined : Number(r[17]),
            created_at: serverIso || r[4] || fallbackIso,
          };
        });
        fallback.attendanceEvents = mergeById(fallback.attendanceEvents, mappedEvents, 'event_id', ['created_at']);
        // Sheet không có cột chi nhánh: giữ branch_id bộ nhớ khi merge ghi đè rỗng
        // (merge so sánh created_at chuỗi luôn hòa -> bản Sheet thắng, mất branch).
        for (const e of fallback.attendanceEvents as any[]) {
          if (!e.branch_id && memEvtBranch.get(String(e.event_id))) {
            e.branch_id = memEvtBranch.get(String(e.event_id));
          }
        }
        // Ảnh inline (upload Drive lỗi, giữ trong bộ nhớ): merge Sheet thắng sẽ
        // làm mất — khôi phục lại khi bản Sheet chưa có Drive ID thật.
        if (memEvtPhoto.size > 0) {
          for (const e of fallback.attendanceEvents as any[]) {
            const id = String((e as any)?.drive_object_id || '');
            if ((id && !id.startsWith('DRV_')) || (e as any)?.event_photo) continue;
            const ph = memEvtPhoto.get(String((e as any)?.event_id || ''));
            if (ph) (e as any).event_photo = ph;
          }
        }
      } else if (fallback.attendanceEvents.length === 0) {
        fallback.attendanceEvents = [];
      }
      counts.attendanceEvents = fallback.attendanceEvents.length;

      // 7. Đọc ADMIN_ACCOUNTS (hỗ trợ cả dòng cũ 7 cột không có Trạng Thái -> mặc định ACTIVE)
      // Mỗi dòng lỗi chỉ bỏ qua dòng đó (log rõ username) — KHÔNG làm sập cả lần pull.
      const adminRows = batch['ADMIN_ACCOUNTS'];
      if (adminRows.length > 0) {
        const currentAdmins = fallback.adminAccounts;
        const sheetsAdmins: AdminAccount[] = [];
        const findExisting = (id: string, user: string) =>
          currentAdmins.find(a => a.admin_id === id) ||
          currentAdmins.find(a => (a.username || '').trim().toLowerCase() === user.toLowerCase());
        for (const r of adminRows.filter(rr => rr[0] && rr[1])) { // phải có admin_id và username
          try {
            const adminId = String(r[0]).trim();
            const username = String(r[1]).trim();
            const passwordFromSheet = String(r[2] || '').trim();
            const fullName = String(r[3] || '').trim() || 'Quản trị viên';
            // Chuẩn hóa role (hoa/thường, khoảng trắng) để 'finance'/'Finance'/'FINANCE '
            // không bị requireRole chặn oan với FORBIDDEN. Lạ -> rớt về HR an toàn.
            const VALID_ROLES = ['DIRECTOR', 'ADMIN', 'HR', 'STORE', 'FINANCE', 'MARKETING', 'IT', 'EMPLOYEE'];
            const rawRole = String(r[4] || '').trim().toUpperCase();
            const role = ((VALID_ROLES.includes(rawRole) ? rawRole : 'HR') as any);
            const branchScope = String(r[5] || '').trim() || '*';
            // Dòng mới 8 cột: Trạng Thái ở cột 6, Ngày Tạo cột 7. Dòng cũ 7 cột: cột 6 là Ngày Tạo.
            const hasStatusCol = r.length >= 8;
            const statusStr = String(hasStatusCol ? r[6] : 'ACTIVE').trim() || 'ACTIVE';
            const createdAt = (String(hasStatusCol ? r[7] : r[6]).trim()) || new Date().toISOString();

            const existing = findExisting(adminId, username);
            const rawPass =
              passwordFromSheet ||
              existing?.password_hash ||
              (username.toLowerCase() === 'admin'
                ? process.env.ADMIN_SEED_PASSWORD || 'Nguyenthanhthien@9999'
                : `Temp${Date.now().toString().slice(-6)}!`);
            // Không bao giờ giữ plaintext và KHÔNG BAO GIỜ rớt dòng (rớt = mất tài khoản
            // trong bộ nhớ -> INVALID_CREDENTIALS dù Sheet vẫn có dữ liệu).
            let passwordHash: string;
            if (isBcryptHash(rawPass)) {
              passwordHash = rawPass;
            } else {
              try {
                passwordHash = hashPasswordSync(rawPass);
              } catch {
                const fallbackHash = existing?.password_hash;
                if (fallbackHash) {
                  console.warn(`[GoogleSheetsSyncService] Mật khẩu của '${username}' trên Sheet quá ngắn (<6 ký tự) — giữ mật khẩu cũ trong bộ nhớ. Sửa ô mật khẩu (tối thiểu 6 ký tự).`);
                  passwordHash = fallbackHash;
                } else {
                  // Tài khoản mới toanh mà mật khẩu Sheet quá ngắn: cấp Temp ngẫu nhiên
                  // để GIỮ tài khoản tồn tại + báo rõ, HR reset mật khẩu sau.
                  const temp = `Temp${Date.now().toString().slice(-6)}!`;
                  console.error(`[GoogleSheetsSyncService] Mật khẩu của '${username}' trên Sheet quá ngắn và chưa từng có mật khẩu — đã cấp tạm thời, HR phải reset mật khẩu cho ${username} ngay!`);
                  passwordHash = hashPasswordSync(temp);
                  await repo.recordAuditLog({
                    log_id: `LOG_${Date.now()}_${adminId}`,
                    actor_id: 'SYSTEM',
                    actor_role: 'SYSTEM',
                    action: 'ADMIN_TEMP_PASSWORD',
                    target_entity: 'TAI_KHOAN_ADMIN',
                    target_id: adminId,
                    details: `Mật khẩu Sheet của ${username} quá ngắn — đã cấp tạm, cần HR reset`,
                  }).catch(() => null);
                }
              }
            }

            // Chống trùng lặp: nếu username hoặc admin_id đã được nạp ở dòng trên thì bỏ qua dòng trùng
            const alreadyLoaded = sheetsAdmins.some(
              a => a.admin_id === adminId || a.username.toLowerCase() === username.toLowerCase()
            );
            if (!alreadyLoaded) {
              sheetsAdmins.push({
                admin_id: adminId,
                username,
                password_hash: passwordHash,
                full_name: fullName,
                role: role || 'HR',
                branch_scope: branchScope || '*',
                is_active: statusStr.toUpperCase() !== 'LOCKED',
                // Giữ version trong bộ nhớ (Sheet không có cột version) — reset về 1
                // mỗi lần pull sẽ đá văng mọi phiên đang đăng nhập.
                version: existing?.version ?? 1,
                created_at: createdAt || new Date().toISOString(),
                updated_at: new Date().toISOString(),
              });
            }
          } catch (e: any) {
            console.warn(`[GoogleSheetsSyncService] Bỏ qua dòng ADMIN_ACCOUNTS lỗi (${r?.[1] || '?'}): ${e?.message || e}`);
          }
        }

        // Merge: ưu tiên Sheets, nhưng giữ các tài khoản seed mặc định
        // (admin + umbomilk-hr + finance) nếu chưa có trong Sheets. Sheet không
        // đọc được dòng hợp lệ nào -> giữ nguyên bộ nhớ cũ.
        const SEED_IDS = ['ADM_001', 'ADM_002', 'ADM_003'];
        if (sheetsAdmins.length === 0) {
          console.warn('[GoogleSheetsSyncService] ADMIN_ACCOUNTS không có dòng hợp lệ — giữ nguyên tài khoản trong bộ nhớ.');
          counts.adminAccounts = fallback.adminAccounts.length;
        } else {
          const missingSeeds = currentAdmins.filter(
            a => SEED_IDS.includes(a.admin_id) && !sheetsAdmins.some(s => s.admin_id === a.admin_id || s.username.toLowerCase() === a.username.toLowerCase())
          );
          fallback.adminAccounts = [...missingSeeds, ...sheetsAdmins];
          if (missingSeeds.length > 0) {
            console.log(`[GoogleSheetsSyncService] Giữ lại seed mặc định chưa có trên Sheets: ${missingSeeds.map(a => a.username).join(', ')}`);
          }
          counts.adminAccounts = fallback.adminAccounts.length;
        }
      } else {
        // Sheets trống — giữ seed mặc định và tự động ghi lên Sheet để lưu trữ bền vững
        const seeds = fallback.adminAccounts.filter(a => ['ADM_001', 'ADM_002'].includes(a.admin_id));
        for (const seed of seeds) {
          const seedRow = [
            seed.admin_id,
            seed.username,
            seed.password_hash,
            seed.full_name,
            seed.role,
            seed.branch_scope,
            (seed as any).is_active === false ? 'LOCKED' : 'ACTIVE',
            seed.created_at,
          ];
          const durable = (repo as any).appendRowsDurable;
          if (typeof durable === 'function') {
            await durable.call(repo, 'ADMIN_ACCOUNTS', [seedRow], 'ADMIN_ACCOUNTS.seed')
              .catch((err: any) => console.warn('[GoogleSheetsSyncService] Could not auto-seed default account:', err));
          } else {
            this.appendRow('ADMIN_ACCOUNTS', seedRow)
              .catch(err => console.warn('[GoogleSheetsSyncService] Could not auto-seed default account:', err));
          }
        }
        counts.adminAccounts = fallback.adminAccounts.length;
      }

      // 8. Đọc DON_DOI_CA (đơn đổi ca) — merge giữ trạng thái B vừa xác nhận chưa kịp push
      const swapRows = batch['DON_DOI_CA'];
      if (keepIfEmpty('DON_DOI_CA', swapRows, fallback.swapRequests.length)) {
        counts.swapRequests = fallback.swapRequests.length;
      } else if (swapRows.length > 0) {
        const mappedSwaps = swapRows.map(r => ({
          swap_id: r[0] || `SWP_${uuidv4().slice(0, 8)}`,
          swap_kind: (r[9] === 'HR_DISPATCH' ? 'HR_DISPATCH' : r[9] === 'HR_SUPPORT' ? 'HR_SUPPORT' : 'EMPLOYEE_SWAP') as any,
          requester_id: r[1] || '',
          requester_assignment_id: r[2] || '',
          target_employee_id: r[3] || '',
          target_assignment_id: r[4] || '',
          reason: r[5] || '',
          status: (r[6] as any) || 'PENDING_PARTNER',
          approved_by: r[7] || undefined,
          bonus_amount: Number(r[10]) || 0,
          support_branch_id: r[11] || undefined,
          support_date: r[12] || undefined,
          support_shift_code: r[13] || undefined,
          created_at: r[8] || new Date().toISOString(),
          version: 1,
        }));
        fallback.swapRequests = mergeById(fallback.swapRequests, mappedSwaps, 'swap_id', ['version']) as any;
      } else if (fallback.swapRequests.length === 0) {
        fallback.swapRequests = [];
      }
      counts.swapRequests = fallback.swapRequests.length;

      // 9. Đọc DIEU_CHINH_CONG (điều chỉnh công) — merge giữ trạng thái HR vừa duyệt
      const adjRows = batch['DIEU_CHINH_CONG'];
      if (keepIfEmpty('DIEU_CHINH_CONG', adjRows, fallback.attendanceAdjustments.length)) {
        counts.attendanceAdjustments = fallback.attendanceAdjustments.length;
      } else if (adjRows.length > 0) {
        const mappedAdj = adjRows.map(r => ({
          adjustment_id: r[0] || `ADJ_${uuidv4().slice(0, 8)}`,
          assignment_id: r[1] || '',
          employee_id: r[2] || '',
          branch_id: '',
          reason: r[3] || '',
          minutes_requested: Number(r[4]) || 0,
          minutes_approved: Number(r[4]) || 0,
          approver_id: r[5] || undefined,
          status: (r[6] as any) || 'PENDING',
          review_note: r[7] || undefined,
          evidence_drive_id: r[8] || undefined,
          photo_hash: r[9] ? String(r[9]).trim() : undefined,
          // Số điểm đã trừ (0 = NV thử việc miễn phí). Sheet cũ chưa có cột ->
          // để undefined, phần merge giữ giá trị bộ nhớ.
          points_charged: (r[10] !== undefined && String(r[10]).trim() !== '')
            ? Math.max(0, Number(r[10]) || 0)
            : undefined,
          version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));
        {
          const memBefore = new Map<string, any>(
            ((fallback.attendanceAdjustments as any[]) || []).map((m: any) => [String((m as any).adjustment_id), m]),
          );
          const merged = mergeById(memBefore.size ? [...memBefore.values()] : [], mappedAdj, 'adjustment_id', ['version']) as any[];
          for (const row of merged) {
            const mem = memBefore.get(String((row as any).adjustment_id));
            if (!mem) continue;
            // Sheet chưa có ảnh (ô trống) nhưng bộ nhớ có (vừa upload/inline) -> giữ bản nhớ.
            if (!(row as any).evidence_drive_id && (mem as any).evidence_drive_id) {
              (row as any).evidence_drive_id = (mem as any).evidence_drive_id;
            }
            if (!(row as any).evidence_photo && (mem as any).evidence_photo) {
              (row as any).evidence_photo = (mem as any).evidence_photo;
            }
            // Sheet cũ chưa có cột mã băm ảnh -> giữ bản nhớ để chống trùng ảnh.
            if (!(row as any).photo_hash && (mem as any).photo_hash) {
              (row as any).photo_hash = (mem as any).photo_hash;
            }
            // Sheet chưa có cột điểm đã trừ -> giữ bản nhớ, tránh hoàn điểm oan
            // cho phiếu miễn phí của NV thử việc.
            if ((row as any).points_charged === undefined && (mem as any).points_charged !== undefined) {
              (row as any).points_charged = (mem as any).points_charged;
            }
            // Sheet không lưu ngày tạo (pull luôn gán now) -> giữ mốc gốc trong bộ nhớ
            // để hạn duyệt 72 giờ tính đúng, không gia hạn oan mỗi lần pull.
            if ((mem as any).created_at) {
              (row as any).created_at = (mem as any).created_at;
              (row as any).updated_at = (mem as any).updated_at || (row as any).updated_at;
            }
          }
          fallback.attendanceAdjustments = merged as any;
        }
      } else if (fallback.attendanceAdjustments.length === 0) {
        fallback.attendanceAdjustments = [];
      }
      counts.attendanceAdjustments = fallback.attendanceAdjustments.length;

      // 10. Đọc KY_LUONG (kỳ lương) — giữ bộ nhớ nếu Sheet rỗng (chống mất kỳ lương sau restart/pull)
      const payrollRows = batch['KY_LUONG'] || [];
      if (keepIfEmpty('KY_LUONG', payrollRows, (fallback.payrollRuns || []).length)) {
        counts.payrollRuns = (fallback.payrollRuns || []).length;
      } else if (payrollRows && payrollRows.length > 0) {
        const memRuns = new Map<string, any>(
          (fallback.payrollRuns || []).map((r: any) => [String(r.run_id), r]),
        );
        const mappedRuns = payrollRows
          .filter(r => r && (r[0] || r[1]))
          .map(r => {
            const runId = r[0] || `RUN_${uuidv4().slice(0, 8)}`;
            const ex = memRuns.get(String(runId));
            const sheetTotal = parseSheetNumber(r[3]);
            return {
              run_id: runId,
              // Sheet có thể trả "2026-10-01" (USER_ENTERED đổi kỳ thành ngày).
              period: normalizeSheetPeriod(r[1] || new Date().toISOString().slice(0, 7)),
              branch_scope: ex?.branch_scope || 'ALL',
              status: (r[2] as any) || 'DRAFT',
              // KY_LUONG không có cột số NV/số giờ — giữ số đã biết trong bộ nhớ,
              // sau khi đọc PHIEU_LUONG sẽ tính lại từ chính các phiếu thật.
              total_employees: Number(ex?.total_employees) || 0,
              total_hours: Number(ex?.total_hours) || 0,
              total_amount: sheetTotal !== undefined ? sheetTotal : (Number(ex?.total_amount) || 0),
              // Không gán cứng ADM_001: giữ người tạo thật nếu đã biết.
              created_by: ex?.created_by || 'SYSTEM',
              created_at: r[4] || ex?.created_at || '',
              updated_at: r[4] || ex?.updated_at || '',
              published_at: r[5] || ex?.published_at || undefined,
              paid_at: r[6] || ex?.paid_at || undefined,
              version: Number(ex?.version) || 1,
            };
          });
        // MERGE theo run_id: kỳ vừa tính lại trong bộ nhớ nhưng Sheet chưa kịp
        // đẩy KHÔNG được biến mất sau lượt pull (lỗi "vừa tính lương xong đã
        // không thấy kỳ"). Bản trên Sheet thắng các cột trạng thái/tiền, nhưng
        // không ghi đè số liệu tổng hợp Sheet không có cột (employees/hours).
        const mergedRuns = new Map<string, any>(
          (fallback.payrollRuns || []).map((r: any) => [String(r.run_id), { ...r }]),
        );
        for (const row of mappedRuns) {
          const ex = mergedRuns.get(String(row.run_id));
          mergedRuns.set(String(row.run_id), ex
            ? {
                ...ex,
                ...row,
                total_employees: Number(row.total_employees) || Number(ex.total_employees) || 0,
                total_hours: Number(row.total_hours) || Number(ex.total_hours) || 0,
                total_amount: Number(row.total_amount) || Number(ex.total_amount) || 0,
              }
            : row);
        }
        fallback.payrollRuns = [...mergedRuns.values()];
      } else if (fallback.payrollRuns.length === 0) {
        fallback.payrollRuns = [];
      }
      counts.payrollRuns = fallback.payrollRuns.length;

      // 10b. Đọc PHIEU_LUONG (chi tiết từng phiếu — merge theo ID, không bao giờ xóa).
      const slipRows = batch['PHIEU_LUONG'] || [];
      if (keepIfEmpty('PHIEU_LUONG', slipRows, (fallback.payslips || []).length)) {
        counts.payslips = (fallback.payslips || []).length;
      } else if (slipRows.length > 0) {
        const numOr = (v: any) => (v === '' || v === undefined || v === null ? undefined : Number(v) || 0);
        const memSlips = new Map<string, any>(
          (fallback.payslips || []).map((s: any) => [String(s.item_id), s]),
        );
        const mapSlipRow = (r: any) => {
          const ex = memSlips.get(String(r[0]));
          const status: any = r[15] || 'DRAFT';
          const isFinal = ['PAID', 'CONFIRMED'].includes(String(status).toUpperCase());
          const luong_cb = numOr(r[18]);
          const standard_pay = Number(r[10]) || 0;
          // Phụ cấp theo cấu hình Kế toán (cột 40 — thêm mới, không đụng cột legacy).
          const allowance = numOr(r[39]) || 0;
          const ot_extra = numOr(r[19]);
          const bonus = Number(r[12]) || 0;
          const tru_kpi = numOr(r[22]);
          const deduction = Number(r[13]) || 0;
          const ung_luong = numOr(r[21]);
          const dong_phuc = numOr(r[23]);
          // Phụ cấp OT đã bỏ: luôn đọc/ghi 0. Phiếu chưa chốt được tính lại tổng
          // từ breakdown để luôn khớp cấu hình hiện tại.
          const tongCong = isFinal ? numOr(r[24]) : (luong_cb || 0) + allowance + standard_pay + (ot_extra || 0) + bonus;
          const tongLuong = isFinal ? numOr(r[25]) : (tongCong || 0) - (tru_kpi || 0) - deduction;
          const thucLanh = isFinal ? numOr(r[26]) : (tongLuong || 0) - (ung_luong || 0) - (dong_phuc || 0);
          return {
            item_id: r[0],
            run_id: r[1] || '',
            employee_id: r[2] || '',
            employee_code: r[3] || '',
            full_name: r[4] || '',
            period: normalizeSheetPeriod(r[5]),
            total_shifts: Number(r[6]) || 0,
            absent_shifts: Number(r[7]) || 0,
            standard_hours: Number(r[8]) || 0,
            rate_snapshot: Number(r[9]) || 0,
            standard_pay,
            allowance,
            bonus,
            deduction,
            net_pay: isFinal ? (numOr(r[14]) || 0) : (thucLanh || 0),
            status,
            // Cột mở rộng theo file Excel (phiếu cũ thiếu -> giữ rỗng).
            ot_slots: 0,
            phu_cap_ot: 0,
            luong_cb,
            ot_extra,
            bonus_extra: numOr(r[20]),
            ung_luong,
            tru_kpi,
            dong_phuc,
            tong_cong: tongCong,
            tong_luong: tongLuong,
            thuc_lanh: thucLanh,
            // Quy trình ký 3 bên + phát hành từng phiếu (phiếu cũ thiếu -> giữ rỗng).
            sign_lap: r[27] ? { name: String(r[27]), at: String(r[28] || ''), img: String(r[33] || '') || undefined } : undefined,
            sign_quanly: r[29] ? { name: String(r[29]), at: String(r[30] || ''), img: String(r[34] || '') || undefined } : undefined,
            sign_nhanvien: r[31] ? { name: String(r[31]), at: String(r[32] || ''), img: String(r[35] || '') || undefined } : undefined,
            slip_published_at: String(r[36] || '') || undefined,
            slip_confirmed_at: String(r[37] || '') || undefined,
            slip_paid_at: String(r[38] || '') || undefined,
            // Mốc thời gian THẬT: giữ mốc đã có trong bộ nhớ; phiếu mới lấy mốc
            // tạo kỳ lương (hoặc sự kiện sớm nhất có trên Sheet). KHÔNG gán
            // `now` mỗi lượt pull — trước đây mọi phiếu bị dồn về cùng một thời
            // điểm giả, làm "phiếu mới nhất" và mốc hoàn tất bước bị sai.
            created_at: String(ex?.created_at || '') || String(
              (fallback.payrollRuns || []).find((x: any) => String(x?.run_id) === String(r[1] || ''))?.created_at || ''
            ) || String(r[36] || r[37] || r[38] || r[28] || r[30] || r[32] || ''),
            updated_at: String(ex?.updated_at || '') || String(r[38] || r[37] || r[36] || r[32] || r[30] || r[28] || '') || String(ex?.created_at || ''),
            version: 1,
          };
        };
        const mappedSlips = slipRows
          .filter(r => r && r[0])
          .map(mapSlipRow);
        fallback.payslips = mergeById(fallback.payslips || [], mappedSlips, 'item_id', ['version']) as any;
        counts.payslips = fallback.payslips.length;
      } else if ((fallback.payslips || []).length === 0) {
        fallback.payslips = [];
      }

      // 10b1. Tổng hợp kỳ lương từ CHÍNH các phiếu vừa đọc. Tab KY_LUONG không
      // có cột số nhân viên/số giờ nên trước đây pull gán cứng 0 — số liệu
      // tổng hợp trên Dashboard/Kỳ lương bị sai cho tới khi tính lại.
      try {
        const byRun = new Map<string, any[]>();
        for (const s of (fallback.payslips || []) as any[]) {
          const rid = String(s?.run_id || '');
          if (!rid) continue;
          if (!byRun.has(rid)) byRun.set(rid, []);
          byRun.get(rid)!.push(s);
        }
        fallback.payrollRuns = (fallback.payrollRuns || []).map((r: any) => {
          const list = byRun.get(String(r.run_id)) || [];
          if (list.length === 0) return r;
          return {
            ...r,
            total_employees: new Set(list.map(s => String(s.employee_id || '')).filter(Boolean)).size,
            total_hours: list.reduce((sum, s) => sum + (Number(s.standard_hours) || 0), 0),
            total_amount: list.reduce((sum, s) => sum + (Number(s.net_pay ?? s.thuc_lanh) || 0), 0),
          };
        });
        counts.payrollRuns = fallback.payrollRuns.length;
      } catch { /* best-effort: số tổng hợp không được làm hỏng pull */ }

      // 10b2. Đọc CONG_THUC_LUONG + DULIEU_LUONG_KY (công thức & nhập tay Finance).
      const formulaRows = batch['CONG_THUC_LUONG'] || [];
      if (formulaRows.length > 0) {
        for (const r of formulaRows) {
          if (!r || !r[0]) continue;
          const fb: any = fallback as any;
          fb.payrollFormulas = fb.payrollFormulas || [];
          const ex = fb.payrollFormulas.find((f: any) => f.period === r[0]);
          // Đọc SỐ THẬT: ô trống mới dùng mặc định. Trước đây `Number(x) || 21000`
          // biến đơn giá 0 (hoặc ô lỗi định dạng) thành mặc định, tức là tự bịa
          // dữ liệu lương thay vì phản ánh đúng thứ Kế toán đã lưu.
          const row = {
            period: r[0],
            rateTV: parseSheetCurrency(r[1]) ?? 21000,
            rateCT: parseSheetCurrency(r[2]) ?? 25500,
            // Legacy: đã bỏ phụ cấp OT, luôn 0 (không đọc lại đơn giá suất cũ).
            otPerSlot: 0,
            otThreshold1: parseSheetNumber(r[4]) ?? 10,
            otThreshold2: parseSheetNumber(r[5]) ?? 15,
            updatedBy: r[6] || undefined,
            updatedAt: r[7] || undefined,
          };
          if (ex) Object.assign(ex, row);
          else fb.payrollFormulas.push(row);
        }
      }
      const inputRows = batch['DULIEU_LUONG_KY'] || [];
      if (inputRows.length > 0) {
        const fb: any = fallback as any;
        fb.payrollInputs = mergePayrollInputRows(fb.payrollInputs || [], inputRows);
      }

      // 10c. Đọc LICH_SU_GIAI_DOAN (lịch sử thử việc/chính thức — merge theo ID).
      const stageRows = batch['LICH_SU_GIAI_DOAN'] || [];
      if (keepIfEmpty('LICH_SU_GIAI_DOAN', stageRows, (fallback.stageHistories || []).length)) {
        counts.stageHistories = (fallback.stageHistories || []).length;
      } else if (stageRows.length > 0) {
        const mappedStages = stageRows
          .filter(r => r && r[0])
          .map(r => ({
            period_id: r[0],
            employee_id: r[1] || '',
            stage: (r[2] || '') as any,
            effective_from: r[3] || '',
            rate_per_hour: parseSheetCurrency(r[4]) ?? 0,
            approved_by: r[5] || '',
            note: r[6] || '',
            version: Number(r[7]) || 1,
            created_at: r[8] || new Date().toISOString(),
          }));
        fallback.stageHistories = mergeById(fallback.stageHistories || [], mappedStages, 'period_id', ['version']) as any;
        counts.stageHistories = fallback.stageHistories.length;
      } else if ((fallback.stageHistories || []).length === 0) {
        fallback.stageHistories = [];
      }

      // 11. Đọc CAU_HINH_HE_THONG (cài đặt kỹ thuật hệ thống)
      const configRows = batch['CAU_HINH_HE_THONG'];
      if (configRows && configRows.length > 0) {
        const settingsObj: any = parseSystemSettingsRows(configRows);
        if (Object.keys(settingsObj).length > 0) {
          // Gộp theo từng nhân viên + so updatedAt cho cau hinh luong: du lieu moi
          // trong bo nho (vua luu, sheet chua kip day) KHONG bi ban cu tren Sheet
          // ghi de — loi "luu bao thanh cong nhung reload mat". Áp dụng cả cho
          // financeColumnVis:* (ẩn/hiện cột Kế toán lưu theo tài khoản).
          const curSettings: any = (fallback.systemSettings || {});
          const mergedSettings: any = mergeSystemSettingsFromSheet(curSettings, settingsObj);
          fallback.systemSettings = mergedSettings;
          counts.systemSettings = Object.keys(settingsObj).length;
          // Cấu hình giao diện/vận hành (ca mẫu, chính sách, bảo trì) được mirror
          // trong systemSettings để đồng bộ Sheets — pull về thì khôi phục lại
          // bộ nhớ để restart không mất (xem MockSheetsAdapter.updateShiftTemplates).
          for (const k of ['shiftTemplates', 'policies', 'maintenance'] as const) {
            const v = (settingsObj as any)[k];
            if (v === undefined || v === null) continue;
            // Dòng maintenance hỏng (chuỗi thay vì object) thì GIỮ bộ nhớ, không
            // ghi đè — nếu không reload sẽ tưởng đã TẮT bảo trì.
            if (k === 'maintenance' && typeof v !== 'object') {
              console.warn('[GoogleSheetsSyncService] Bỏ qua dòng maintenance hỏng trên Sheet (giữ trạng thái bộ nhớ).');
              continue;
            }
            (fallback as any)[k] = v;
          }
          this.lastSettingsPullAt = Date.now();
        }
      }

      // 12. Đọc Ứng viên tuyển dụng từ Form ứng viên Google Sheets (đầy đủ 17 cột)
      let candRows: string[][] = [];
      let targetSheetTitle = 'FROM_NHAN_VIEN';
      // true = candRows dưới đây thật sự đọc từ Spreadsheet nguồn form (2), không
      // phải đọc dự phòng từ Spreadsheet đích (1). Chỉ khi đọc được từ nguồn mới
      // xét "nguồn đổi -> đẩy lại đích".
      let candidateSourceRead = false;

      if (this.sheetsClient && shouldPullCandidates) {
        // A. NGUỒN SỰ THẬT: Spreadsheet form ứng viên (CANDIDATE_SPREADSHEET_ID).
        // Đọc thẳng tab FROM_NHAN_VIEN (1 request) thay vì hỏi metadata trước —
        // mỗi lượt bớt 1 request, tránh chạm hạn mức đọc 60/phút của Google.
        if (this.candidateSpreadsheetId) {
          try {
            const candRes: any = await this.sheetsCall('read.candidates', () =>
              this.sheetsClient!.spreadsheets.values.get({
                spreadsheetId: this.candidateSpreadsheetId,
                range: `'${targetSheetTitle}'!A1:ZZ`,
                ...SHEETS_READ_OPTIONS,
              }) as any, 25000);
            candRows = (candRes.data.values as string[][]) || [];
            candidateSourceRead = true;
          } catch (e: any) {
            const msg = String(e?.message || e);
            // Tab bị đổi tên -> dò metadata 1 lần rồi đọc lại đúng tên tab mới.
            if (/Unable to parse range|not found|NOT_FOUND|404/i.test(msg)) {
              try {
                const meta: any = await this.sheetsCall('read.candidateMeta', () =>
                  this.sheetsClient!.spreadsheets.get({
                    spreadsheetId: this.candidateSpreadsheetId,
                    fields: 'sheets.properties.title',
                  }) as any, 25000);
                const sheets = meta.data.sheets || [];
                const found = sheets.find((s: any) => {
                  const t = s.properties?.title || '';
                  return /FROM_NHAN_VIEN|Form|Biểu mẫu|Câu trả lời|Ứng viên/i.test(t);
                }) || sheets[0];
                if (found?.properties?.title) {
                  targetSheetTitle = found.properties.title;
                  const retry: any = await this.sheetsCall('read.candidatesRetry', () =>
                    this.sheetsClient!.spreadsheets.values.get({
                      spreadsheetId: this.candidateSpreadsheetId,
                      range: `'${targetSheetTitle}'!A1:ZZ`,
                      ...SHEETS_READ_OPTIONS,
                    }) as any, 25000);
                  candRows = (retry.data.values as string[][]) || [];
                  candidateSourceRead = true;
                }
              } catch (e2: any) {
                console.warn('[GoogleSheetsSyncService] Dò lại tên tab form ứng viên lỗi:', e2?.message || e2);
              }
            }
            if (!candidateSourceRead) {
              const quota = /quota|rate.?limit|429/i.test(msg);
              // Giãn nhịp đọc để không đốt hạn mức: quota 60s, lỗi khác 20s.
              this.candidateReadBackoffUntil = Date.now() + (quota ? 60_000 : 20_000);
              console.warn(
                `[GoogleSheetsSyncService] Đọc nguồn form ứng viên lỗi (${quota ? 'quota' : 'khác'}) — dùng bản đọc nguồn gần nhất, KHÔNG lấy bản sao master cũ:`,
                msg,
              );
            }
          }
        }

        // B. Giữ bản đọc NGUỒN gần nhất khi Google lỗi/quota. Trước đây rơi về
        // file master FROM_NHAN_VIEN (bản sao có thể chậm hơn) -> chính là lý do
        // dữ liệu hiển thị "sai, chưa đúng dữ liệu thật" trên form.
        if (!candidateSourceRead && candRows.length <= 1 && this.lastCandidateRows.length > 1) {
          candRows = this.lastCandidateRows;
        }

        // C. Chỉ lần đầu (chưa từng đọc được nguồn) mới tạm dùng file
        // FROM_NHAN_VIEN của hệ thống để có dữ liệu hiển thị.
        if (candRows.length <= 1) {
          try {
            const candRes: any = await this.sheetsCall('read.candidatesMaster', () =>
              this.sheetsClient!.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetIdOf('FROM_NHAN_VIEN'),
                range: `'FROM_NHAN_VIEN'!A1:ZZ`,
                ...SHEETS_READ_OPTIONS,
              }) as any, 25000);
            if (candRes.data.values && candRes.data.values.length > 1) {
              candRows = candRes.data.values as string[][];
              console.warn('[GoogleSheetsSyncService] Chưa đọc được nguồn form — tạm dùng bản sao FROM_NHAN_VIEN (sẽ thay bằng dữ liệu thật ngay khi đọc được).');
            }
          } catch (e) {
            // Sheet FROM_NHAN_VIEN chưa được tạo trên master
          }
        }
      }

      if (shouldPullCandidates) {
        this.lastCandidatePullAt = Date.now();
        this.lastCandidateRows = candRows;
        candRowsForSignature = candRows;
        // Phát hiện nguồn form (Spreadsheet 2) vừa đổi: hash nội dung đọc được so
        // với lượt đọc nguồn trước. Đổi -> phải đẩy lại tab FROM_NHAN_VIEN sang
        // Spreadsheet đích (1). Chỉ xét khi thật sự đọc từ Spreadsheet nguồn.
        if (candidateSourceRead) {
          const sourceSig = hashSheetRows(candRows);
          // Lần đọc đầu sau khởi động cũng coi là "đổi" (hash cũ = null) để Sheet
          // đích tự đuổi kịp nguồn ngay, không phải chờ HR thao tác hay form mới.
          if (sourceSig !== this.lastCandidateSourceSignature) {
            candidateSourceChanged = true;
          }
          this.lastCandidateSourceSignature = sourceSig;
        }
      }

      if (candRows.length > 1) {
        // Phân tích hàng tiêu đề (Row 0) để map cột động theo tên hoặc chỉ số
        const headers = (candRows[0] || []).map(h => (h || '').toString().trim().toLowerCase());
        const findCol = (regex: RegExp, fallbackIdx: number): number => {
          const idx = headers.findIndex(h => regex.test(h));
          return idx !== -1 ? idx : fallbackIdx;
        };

        const colTimestamp = findCol(/thời gian|timestamp|ngày đăng ký|ngày gửi|date|time/i, 0);
        const colFullName = findCol(/họ và tên|họ tên|tên ứng viên|tên|full_name|name/i, 1);
        const colGender = findCol(/giới tính|gender|nam.*nữ/i, 2);
        const colBirthYear = findCol(/năm sinh|ngày sinh|sinh năm|tuổi|birth|dob/i, 3);
        const colEducation = findCol(/trình độ|học vấn|bằng cấp|education/i, 4);
        const colHometown = findCol(/quê quán|quê|hộ khẩu|nơi ở|địa chỉ|hometown/i, 5);
        const colPhone = findCol(/số điện thoại|sđt|điện thoại|phone|mobile|tel/i, 6);
        const colShift = findCol(/ca đăng ký|ca làm|ca mong muốn|ca/i, 7);
        const colBranch = findCol(/chi nhánh|cơ sở|nơi làm|branch|store/i, 8);
        const colExperience = findCol(/kinh nghiệm|từng làm|làm việc|exp/i, 9);
        const colEmergency = findCol(/đột xuất|tăng ca|sự cố|tăng cường|overtime|emergency/i, 10);
        const colFacebook = findCol(/facebook|link fb|fb|mạng xã hội/i, 11);
        const colReferral = findCol(/nguồn|biết tin|biết thông tin|giới thiệu|referral|source/i, 12);
        const colAiScore = findCol(/điểm ai|ai score|điểm|chấm điểm|score/i, 13);
        const colResult = findCol(/kết quả|sàng lọc|kết luận|result/i, 14);
        const colStatus = findCol(/trạng thái|status/i, 15);
        const colSourceCode = findCol(/mã nguồn|mã|form id|submission|code/i, 16);
        // Cột vận hành do HR cập nhật (lịch PV + Zalo): form gốc không có -> fallback index cuối.
        const colInterviewDate = findCol(/ngày pv|ngày phỏng vấn|interview.?date/i, 17);
        const colInterviewSlot = findCol(/khung giờ pv|giờ pv|khung giờ|time.?slot|interview.?time/i, 18);
        const colInterviewer = findCol(/người pv|người phỏng vấn|interviewer/i, 19);
        const colZaloStatus = findCol(/zalo thư mời|thư mời zalo|zalo/i, 20);
        const colZaloAt = findCol(/zalo lúc gửi|zalo.*gửi|invite.?at/i, 21);
        // Giữ lịch PV + trạng thái Zalo trong bộ nhớ (HR vừa thao tác chưa kịp push):
        // pull form gốc không có các cột này nên phải overlay, ngược lại reload là mất.
        const prevById = new Map<string, any>(
          ((fallback as any).candidates || []).map((c: any) => [c.submission_id, c])
        );
        // Ghép theo NHÂN THÂN (SĐT + tên + thời gian gửi) thay vì submission_id
        // đánh theo thứ tự dòng — tránh gắn ca/chi nhánh của người này sang người
        // khác khi Sheet bị sắp xếp/chèn dòng.
        const prevByKey = new Map<string, any>();
        for (const pc of (fallback as any).candidates || []) {
          const ph = pc.phone_normalized || pc.phone;
          prevByKey.set(candidateIdentityKey(ph, pc.full_name), pc);
          if (pc.created_at) prevByKey.set(candidateIdentityKey(ph, pc.full_name, pc.created_at), pc);
        }

        const dataRows = candRows.slice(1);
        fallback.candidates = dataRows
          .filter(r => r && r.length > 0 && r.some(cell => String(cell || '').trim().length > 0))
          .map((r, idx) => {
            const getVal = (colIdx: number) => (r[colIdx] !== undefined ? String(r[colIdx]).trim() : '');

            const rawCreatedAt = getVal(colTimestamp) || new Date().toISOString();
            const fullName = getVal(colFullName) || `Ứng viên ${idx + 1}`;
            const gender = getVal(colGender) || 'Nam';
            const birthRaw = getVal(colBirthYear);
            // Form hỏi theo KHOẢNG tuổi ("2004 - 2008") -> giữ nguyên chuỗi gốc để
            // Sheet đích đúng dữ liệu thật, chỉ suy ra số cho điểm AI.
            const birthYear = parseFormBirthYear(birthRaw);
            const educationLevel = getVal(colEducation) || 'THPT / Cao đẳng';
            const hometown = getVal(colHometown) || 'TP. Hồ Chí Minh';
            const phone = getVal(colPhone) || '';
            const phoneNormalized = canonicalPhone(phone);
            const registeredShift = getVal(colShift) || 'Ca sáng / Ca chiều';
            const branchName = getVal(colBranch) || 'CN130 - Lê Văn Sỹ';
            const experience = getVal(colExperience) || 'Chưa có kinh nghiệm (sẵn sàng đào tạo)';
            const emergencyHandling = getVal(colEmergency) || 'Sẵn sàng hỗ trợ và tăng ca khi có điều động đột xuất';

            // Không bịa URL từ tên/ghi chú ("Pun Nguyễn" -> facebook.com/Pun Nguyễn):
            // Sheet đích phải giữ đúng giá trị ứng viên đã gửi.
            const facebookUrl = normalizeFormFacebook(getVal(colFacebook));

            const referralSource = getVal(colReferral) || 'Facebook / Fanpage Ụm Bò Milk';

            // Hệ thống AI tự động chấm điểm theo đúng 9 tiêu chí chuẩn UBM (Thang 14 điểm)
            const aiEval = evaluateCandidateAiScore({
              full_name: fullName,
              birth_year: birthYear,
              hometown,
              phone: phoneNormalized,
              education_level: educationLevel,
              experience,
              referral_source: referralSource,
              emergency_handling: emergencyHandling,
              facebook_url: facebookUrl,
            });

            const aiScore = aiEval.score;
            let result = getVal(colResult) || aiEval.screeningNote;

            const rawStatus = getVal(colStatus) || '';
            const sourceCode = getVal(colSourceCode) || `UBM_FORM_${String(idx + 1).padStart(4, '0')}`;
            const submissionId = `CAND_${String(idx + 1).padStart(4, '0')}`;
            const prev = prevByKey.get(candidateIdentityKey(phoneNormalized, fullName, rawCreatedAt))
              || prevByKey.get(candidateIdentityKey(phoneNormalized, fullName))
              || prevById.get(submissionId)
              || {};
            // Sheet form gốc không có trạng thái -> 'NEW'/trống thì giữ trạng thái bộ nhớ (INVITED...)
            const status = (rawStatus && rawStatus !== 'NEW' ? rawStatus : (prev.status && prev.status !== 'NEW' ? prev.status : (rawStatus || 'NEW'))) as any;
            // VIP (ưu tiên vào việc) là trường vận hành do HR đánh dấu trên hệ thống,
            // Sheet form không có cột này -> phải overlay từ bộ nhớ, nếu không pull nền
            // (~10s) sẽ xóa mất toàn bộ VIP/VIP rank.
            const vip = prev.vip === true;
            const vipRank = vip ? (Number(prev.vip_rank) || 0) : undefined;
            // Cột "Zalo Thư Mời" trên form gốc là cột trống (prompt Zalo OA) —
            // chỉ nhận giá trị nếu là mã trạng thái thật, còn lại coi là ghi chú.
            const zaloSrc = parseZaloInviteCell(getVal(colZaloStatus));

            return {
              submission_id: submissionId,
              interview_date: getVal(colInterviewDate) || prev.interview_date || undefined,
              interview_time_slot: getVal(colInterviewSlot) || prev.interview_time_slot || undefined,
              interviewer_id: getVal(colInterviewer) || prev.interviewer_id || undefined,
              // Trường vận hành chỉ có trên master (form gốc không có). Phải giữ từ
              // bộ nhớ trước khi phủ master: nếu lần push master vừa lỗi/chậm, pull
              // kế tiếp dựng lại từ form sẽ xóa mất lý do từ chối + lịch đề xuất
              // (đúng lỗi "ứng viên đề xuất lịch nhưng HR không thấy ngày/giờ").
              interview_decline_reason: (prev as any).interview_decline_reason || undefined,
              interview_proposed_date: (prev as any).interview_proposed_date || undefined,
              interview_proposed_time_slot: (prev as any).interview_proposed_time_slot || undefined,
              interview_proposed_note: (prev as any).interview_proposed_note || undefined,
              interview_proposed_at: (prev as any).interview_proposed_at || undefined,
              blacklist_reason: (prev as any).blacklist_reason || undefined,
              blacklist_at: (prev as any).blacklist_at || undefined,
              interview_score: prev.interview_score,
              interview_rubric: prev.interview_rubric || undefined,
              interview_score_detail: prev.interview_score_detail || undefined,
              zalo_invite_status: zaloSrc.status || prev.zalo_invite_status || undefined,
              zalo_invite_note: zaloSrc.note || prev.zalo_invite_note || undefined,
              zalo_invite_at: getVal(colZaloAt) || prev.zalo_invite_at || undefined,
              zalo_uid: prev.zalo_uid || undefined,
              vip,
              vip_rank: vipRank,
              vip_at: prev.vip_at || undefined,
              vip_by: prev.vip_by || undefined,
              full_name: fullName,
              phone_normalized: phoneNormalized,
              phone,
              gender,
              birth_year: birthYear,
              birth_year_raw: birthRaw || prev.birth_year_raw || undefined,
              education_level: educationLevel,
              hometown,
              apply_position: 'Nhân viên Bán hàng',
              // Ca + chi nhánh là trường vận hành do HR chốt (Cập nhật TT): form gốc không
              // đổi sau khi gửi, nên ưu tiên giá trị bộ nhớ (HR vừa cập nhật) — nếu không
              // pull nền (~10s) sẽ dựng lại từ form và đè mất, HR thấy "lưu thành công
              // nhưng dữ liệu không đổi".
              // Chỉ giữ ca/chi nhánh khi đó là nhãn HR ĐÃ CHỐT qua dropdown.
              // Giá trị dạng câu trả lời thô còn sót từ lần đồng bộ lệch dòng
              // trước đây phải trả về đúng câu trả lời của ứng viên trên form.
              preferred_branch_id: isHrBranchLabel((prev as any).branch_name)
                ? ((prev as any).preferred_branch_id || (branchName.match(/CN\d+/)?.[0] || 'CN130'))
                : (branchName.match(/CN\d+/)?.[0] || 'CN130'),
              branch_name: isHrBranchLabel((prev as any).branch_name) ? (prev as any).branch_name : branchName,
              registered_shift: isHrShiftLabel((prev as any).registered_shift) ? (prev as any).registered_shift : registeredShift,
              experience,
              emergency_handling: emergencyHandling,
              facebook_url: facebookUrl,
              referral_source: referralSource,
              ai_score: aiScore,
              screening_result: result,
              status,
              source_code: sourceCode,
              created_at: rawCreatedAt,
            };
          });
        // Phủ dữ liệu vận hành (lịch PV + Zalo + trạng thái) từ master FROM_NHAN_VIEN:
        // restart/sửa code làm bộ nhớ trắng, Sheet form gốc không có các cột này —
        // không phủ thì reload là mất. Khớp theo submission_id, rớt về SĐT+tên.
        try {
          if (this.sheetsClient) {
            const mRes: any = await this.sheetsCall('read.candidatesOverlay', () =>
              this.sheetsClient!.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetIdOf('FROM_NHAN_VIEN'),
                // A2:ZZ (không lấy tiêu đề) để cùng biểu diễn với batchGet dùng
                // cho hash nội dung — tránh mỗi lần webhook/pull lại báo "đổi" giả.
                range: `'FROM_NHAN_VIEN'!A2:ZZ`,
                ...SHEETS_READ_OPTIONS,
              }) as any, 25000);
            const mRows = (mRes.data.values as string[][]) || [];
            masterCandRowsForSignature = mRows;
            // Cache ngay sau lần đọc THÀNH CÔNG (không đợi lượt sau) để nếu lần
            // đọc kế tiếp lỗi/quota, hash vẫn dùng đúng bản gần nhất — không báo
            // "đổi" giả rồi bắn realtime thừa.
            if (mRows.length > 0) this.lastMasterCandidateRows = mRows;
            if (mRows.length > 0) {
              const byId = new Map<string, string[]>();
              const byPhoneName = new Map<string, string[]>();
              // Mã nguồn (cột 16, VD UBM_FORM_0318) là định danh DUY NHẤT của hồ sơ.
              // Không dùng nó trước thì người nộp form 2 lần (cùng tên + SĐT) sẽ bị
              // dòng sau "che" dòng trước -> mất trạng thái/đề xuất lịch của hồ sơ kia.
              const bySourceCode = new Map<string, string[]>();
              mRows.forEach((r, i) => {
                if (!r || !r.some(c => String(c || '').trim())) return;
                byId.set(`CAND_${String(i + 1).padStart(4, '0')}`, r);
                const sc = String(r[16] || '').trim();
                if (sc) bySourceCode.set(sc, r);
                const ph = canonicalPhone(String(r[6] || ''));
                const nm = String(r[1] || '').trim().toLowerCase();
                if (ph && nm) byPhoneName.set(`${ph}|${nm}`, r);
              });
              for (const c of fallback.candidates as any[]) {
                // Ưu tiên mã nguồn (duy nhất) -> SĐT + tên (master có thể bị HR sắp
                // xếp lại dòng) -> vị trí. Trước đây SĐT+tên đứng đầu nên hồ sơ
                // trùng bị gắn nhầm dữ liệu của nhau.
                const mr = bySourceCode.get(String((c as any).source_code || '').trim())
                  || byPhoneName.get(`${c.phone_normalized || ''}|${String(c.full_name || '').trim().toLowerCase()}`)
                  || byId.get(c.submission_id);
                if (!mr) continue;
                // Lịch vừa bị hủy (tay/auto): ÉP XÓA thay vì hồi sinh dòng cũ trên Sheet.
                if (this.isInterviewScheduleClearedRecently(c.submission_id)) {
                  c.interview_date = undefined;
                  c.interview_time_slot = undefined;
                  c.interviewer_id = undefined;
                  if ((c as any).status === 'INVITED_INTERVIEW') (c as any).status = 'NEW';
                  continue;
                }
                const nz = (v: any) => (v !== undefined && String(v).trim() !== '' ? String(v).trim() : undefined);
                const mStatus = nz(mr[15]);
                if (mStatus && mStatus !== 'NEW') c.status = mStatus as any;
                // Năm sinh: ưu tiên chuỗi gốc từ form; master chỉ bổ sung khi form
                // không có (VD dữ liệu cũ chỉ còn 1 năm).
                const mBirthRaw = nz(mr[3]);
                if (mBirthRaw && !c.birth_year_raw) {
                  c.birth_year_raw = mBirthRaw;
                  c.birth_year = parseFormBirthYear(mBirthRaw);
                }
                // Ca + chi nhánh HR đã chốt (Cập nhật TT) lưu ở master cột 7/8: phủ lại để
                // bền vững qua restart (bộ nhớ trắng, form gốc chỉ còn giá trị ban đầu).
                // PUT đã đẩy master đồng bộ (await) trước khi trả response nên master tươi.
                // Chỉ phủ ca/chi nhánh khi master giữ NHÃN HR đã chốt. Giá trị thô
                // kiểu câu trả lời form là dữ liệu cũ bị lệch dòng -> bỏ qua.
                const mShift = nz(mr[7]);
                if (mShift && isHrShiftLabel(mShift)) c.registered_shift = mShift as any;
                const mBranch = nz(mr[8]);
                if (mBranch && isHrBranchLabel(mBranch)) {
                  c.branch_name = mBranch as any;
                  const mCode = String(mBranch).match(/CN\d+/i)?.[0]?.toUpperCase();
                  if (mCode) c.preferred_branch_id = mCode as any;
                }
                c.interview_date = nz(mr[17]) || c.interview_date;
                c.interview_time_slot = nz(mr[18]) || c.interview_time_slot;
                c.interviewer_id = nz(mr[19]) || c.interviewer_id;
                // Cột "Zalo Thư Mời" có thể còn dữ liệu cũ HR nhập tay (SĐT/Zalo
                // phụ). Chỉ nhận mã trạng thái hợp lệ; phần còn lại lưu thành
                // ghi chú để push không ghi ngược SĐT vào cột trạng thái.
                const mZalo = parseZaloInviteCell(nz(mr[20]));
                if (mZalo.status) c.zalo_invite_status = mZalo.status;
                if (mZalo.note) c.zalo_invite_note = mZalo.note;
                c.zalo_invite_at = nz(mr[21]) || c.zalo_invite_at;
                if (nz(mr[22]) !== undefined) (c as any).interview_score = Number(nz(mr[22]));
                if (nz(mr[23]) !== undefined) {
                  (c as any).interview_score_detail = nz(mr[23]);
                  try {
                    const d = JSON.parse(nz(mr[23]) as string);
                    if (d?.rubricId) (c as any).interview_rubric = d.rubricId;
                  } catch { /* giữ nguyên */ }
                }
                // VIP (cột 24/25): Sheet có thể chưa có cột này -> chỉ đọc khi có giá trị.
                if (nz(mr[24]) === 'VIP') {
                  (c as any).vip = true;
                  const r = Number(nz(mr[25]));
                  (c as any).vip_rank = Number.isFinite(r) && r > 0 ? r : ((c as any).vip_rank || 0);
                } else if (nz(mr[24]) === '' && (c as any).vip !== true) {
                  (c as any).vip = false;
                }
                // Lý do từ chối PV (cột 26, thêm sau): giữ bền qua restart.
                // Chỉ phủ khi master CÓ giá trị — ô trống nghĩa là "chưa kịp ghi"
                // (push lỗi quota/chậm), không phải HR xóa; giữ dữ liệu bộ nhớ.
                const mDecline = nz(mr[26]);
                if (mDecline) (c as any).interview_decline_reason = mDecline;
                // Đề xuất lịch mới + lý do danh sách đen (cột 27-30, thêm sau).
                const mPropDate = nz(mr[27]);
                if (mPropDate) (c as any).interview_proposed_date = mPropDate;
                const mPropTime = nz(mr[28]);
                if (mPropTime) (c as any).interview_proposed_time_slot = mPropTime;
                const mPropNote = nz(mr[29]);
                if (mPropNote) (c as any).interview_proposed_note = mPropNote;
                const mBlacklist = nz(mr[30]);
                if (mBlacklist) (c as any).blacklist_reason = mBlacklist;
              }
            }
          }
        } catch (e: any) {
          console.warn('[GoogleSheetsSyncService] Phủ lịch PV/Zalo từ master thất bại (giữ dữ liệu form):', e?.message || e);
        }
        counts.candidates = fallback.candidates.length;
      } else {
        // Giữ nguyên danh sách hiện tại nếu không đọc được dòng mới từ sheet
        counts.candidates = fallback.candidates ? fallback.candidates.length : 0;
      }

      } catch (tabErr: any) {
        partialError = tabErr?.message || String(tabErr);
        console.error('[GoogleSheetsSyncService] Tab phụ pull lỗi (tab chính NV/tài khoản vẫn giữ):', partialError);
      }

      // Hash nội dung (không phải số dòng): sửa 1 ô trên Sheet vẫn phát hiện được
      // và bắn realtime ngay, kể cả khi counts không đổi. Tab FROM_NHAN_VIEN của
      // master chứa lịch PV/Zalo do HR cập nhật (form ứng viên không có các cột
      // này) nên PHẢI nằm trong hash — nếu không sửa tay trên Sheet sẽ không bắn
      // realtime và tab Lịch Phỏng Vấn đứng dữ liệu.
      const tabsForSignature: Record<string, string[][] | undefined> = { ...batch };
      if (masterCandRowsForSignature.length > 0 || this.lastMasterCandidateRows.length > 0) {
        tabsForSignature.FROM_NHAN_VIEN = masterCandRowsForSignature;
      }
      // Tab nhật ký không nằm trong hash mỗi 5 giây (hash ~800k ô mỗi lượt là
      // tác nhân block event loop). Chỉ hash lại khi vừa đọc theo nhịp lịch sử.
      const hotTabsForSignature = { ...tabsForSignature };
      for (const t of historyTabs) delete hotTabsForSignature[t];
      for (const key of Object.keys(hotTabsForSignature)) {
        for (const base of historyTabs) {
          if (key.startsWith(`${base}_P`)) delete hotTabsForSignature[key];
        }
      }
      const fingerprint = fingerprintSheetsContent(hotTabsForSignature, candRowsForSignature);

      if (historyDue || !this.lastHistorySignature) {
        const historyBatch: Record<string, string[][] | undefined> = {};
        for (const key of Object.keys(batch)) {
          if (GoogleSheetsSyncService.HISTORY_TABS.has(key)
            || [...GoogleSheetsSyncService.HISTORY_TABS].some(base => key.startsWith(`${base}_P`))) {
            historyBatch[key] = batch[key];
          }
        }
        const historyFp = fingerprintSheetsContent(historyBatch);
        this.lastHistorySignature = historyFp.signature;
        this.lastHistoryTabSignatures = { ...historyFp.tabs };
      }
      const tabSignatures = { ...fingerprint.tabs, ...this.lastHistoryTabSignatures };
      const signature = computeSheetsContentSignature({
        __hot__: [[fingerprint.signature]],
        __history__: [[this.lastHistorySignature || '']],
      });
      const changed = this.lastDataSignature !== null && this.lastDataSignature !== signature;
      const changedTabs = changed
        ? [...new Set(Object.keys(tabSignatures)
            .filter(t => this.lastTabSignatures[t] !== tabSignatures[t])
            .map(t => (t === '__extra__' ? 'FROM_NHAN_VIEN' : t)))]
        : [];
      this.lastDataSignature = signature;
      this.lastTabSignatures = tabSignatures;

      this.lastPulledAt = Date.now();
      this.lastPullDurationMs = this.lastPulledAt - pullT0;
      // Webhook chỉ đọc 1 tab (prefetchedBatch) -> không tính là pull toàn bộ.
      if (!opts.prefetchedBatch) this.lastFullPullAt = this.lastPulledAt;
      this.lastPullError = partialError ? `PARTIAL:${partialError}` : null;
      console.log(
        '[GoogleSheetsSyncService] Đã tải dữ liệu thực tế từ Google Sheets thành công:',
        counts,
        changed ? `(nội dung ĐỔI, hash ${signature.slice(0, 10)}…)` : '(không đổi)',
        `(${this.lastPullDurationMs}ms)`,
      );

      // Chỉ phát 1 lần cho mỗi thay đổi, dù tick định kỳ và webhook dùng chung pull.
      if (changed) {
        for (const listener of this.dataChangeListeners) {
          try {
            listener({ signature, counts, changedTabs });
          } catch (e: any) {
            console.warn('[GoogleSheetsSyncService] data-change listener lỗi:', e?.message || e);
          }
        }
      }

      // Nguồn form ứng viên (Spreadsheet 2) vừa đổi: hẹn đẩy lại tab FROM_NHAN_VIEN
      // sang Spreadsheet đích (1). Trước đây pull chỉ cập nhật bộ nhớ + bắn socket,
      // không đặt cờ dirty nên ứng viên nộp form KHÔNG tự xuất hiện trên Sheet đích
      // (auto-push 60 phút bỏ qua vì không dirty). Chỉ gọi khi repo hỗ trợ (adapter
      // Google Sheets thật); Mock/Postgres không có hàm -> no-op.
      if (candidateSourceChanged && candRowsForSignature.length > 1) {
        try {
          const trigger = (repo as any).scheduleCandidatesPushFromSource;
          if (typeof trigger === 'function') {
            trigger.call(repo);
          }
        } catch (e: any) {
          console.warn('[GoogleSheetsSyncService] Hẹn đẩy FROM_NHAN_VIEN theo nguồn form lỗi:', e?.message || e);
        }
      }

      // P0.2: lưu snapshot sau mỗi pull để restart sau đây phục vụ ngay.
      // Chỉ ghi khi nội dung đổi hoặc chưa từng có snapshot: pull 5s không đổi
      // mà vẫn serialize cả kho dữ liệu sẽ tốn CPU/đĩa vô ích.
      const shouldPersistSnapshot = changed || !this.lastSnapshotCounts;
      this.lastSnapshotCounts = counts;
      if (shouldPersistSnapshot) {
        try {
          const persist = (repo as any).persistRuntimeSnapshot?.({
            signature,
            tabSignatures: fingerprint.tabs,
            pulledAt: new Date(this.lastPulledAt).toISOString(),
            counts,
          });
          void Promise.resolve(persist).catch((e: any) => {
            console.warn('[GoogleSheetsSyncService] Lưu snapshot lỗi:', e?.message || e);
          });
        } catch (e: any) {
          console.warn('[GoogleSheetsSyncService] Lưu snapshot lỗi:', e?.message || e);
        }
      }

      return {
        success: !partialError,
        message: partialError
          ? `Pull một phần (tab chính OK, tab phụ lỗi: ${partialError})`
          : 'Đã tải và cập nhật toàn bộ dữ liệu thật từ Google Sheets thành công!',
        counts,
        signature,
        changed,
        changedTabs,
      };
    } catch (err: any) {
      this.lastPullError = err?.message || String(err);
      console.error('[GoogleSheetsSyncService] Lỗi khi pull dữ liệu từ Sheets:', err);
      return { success: false, message: `Lỗi đọc Google Sheets: ${err.message}`, counts: null };
    }
  }

  /**
   * Đọc các dòng dữ liệu của một tab (bỏ qua dòng tiêu đề A1)
   */
  public async readSheetRows(sheetTitle: string): Promise<string[][]> {
    if (!this.sheetsClient) return [];
    try {
      const res = await this.sheetsCall(`read.${sheetTitle}`, () =>
        this.sheetsClient!.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetIdOf(sheetTitle),
          range: `'${sheetTitle}'!A2:ZZ`,
          ...SHEETS_READ_OPTIONS,
        })
      );
      return (res.data.values as string[][]) || [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Đọc 1 tab và PHÂN BIỆT lỗi với tab rỗng (null = lỗi). Webhook dùng hàm này
   * để không lấy [] đè cache khi Google timeout/quota.
   */
  public async readTabRowsStrict(sheetTitle: string, timeoutMs = 15_000): Promise<string[][] | null> {
    if (!this.sheetsClient) return null;
    const safe = String(sheetTitle || '').trim().toUpperCase();
    if (!/^[A-Z0-9_]{1,100}$/.test(safe)) return null;
    try {
      const res = await this.sheetsCall(`read.tab.${safe}`, () =>
        this.sheetsClient!.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetIdOf(safe),
          range: `'${safe}'!A2:ZZ`,
          ...SHEETS_READ_OPTIONS,
        }), timeoutMs);
      return (res.data.values as string[][]) || [];
    } catch (e: any) {
      console.warn(`[GoogleSheetsSyncService] Đọc tab ${safe} lỗi:`, e?.message || e);
      return null;
    }
  }

  /** Đọc 1 range bất kỳ; null = lỗi/timeout (caller giữ cache cũ). */
  private async readTabRange(sheetTitle: string, range: string, timeoutMs = 30_000): Promise<string[][] | null> {
    if (!this.sheetsClient) return null;
    try {
      const res = await this.sheetsCall(`read.range.${sheetTitle}`, () =>
        this.sheetsClient!.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetIdOf(sheetTitle),
          range,
          ...SHEETS_READ_OPTIONS,
        }), timeoutMs);
      return (res.data.values as string[][]) || [];
    } catch (e: any) {
      console.warn(`[GoogleSheetsSyncService] Đọc ${sheetTitle} (${range}) lỗi:`, e?.message || e);
      return null;
    }
  }

  /**
   * Đọc các tab NHẬT KÝ theo nhịp chậm (mặc định 120s).
   *
   * Tối ưu quan trọng: THONGBAO_NV từng có 56.000+ dòng; đọc cả tab mỗi 2 phút
   * làm pull mất 15-17 giây, chặn nhịp realtime 5 giây. Nay chỉ đọc đuôi
   * SHEETS_HISTORY_TAIL_ROWS dòng (mặc định 4.000) + đúng số cột đang dùng.
   */
  private async readHistoryTabs(): Promise<Record<string, string[][]>> {
    const out: Record<string, string[][]> = {};
    const tailRows = Math.max(500, Number(process.env.SHEETS_HISTORY_TAIL_ROWS) || 4_000);
    for (const title of GoogleSheetsSyncService.HISTORY_TABS) {
      if (title === 'SNAPSHOT_SAOLUU') {
        const rows = await this.readTabRange(title, `'${title}'!A2:G`, 30_000);
        if (rows) out[title] = rows;
        continue;
      }
      if (title === 'THONGBAO_GUI') {
        // Tab này có thể đã chia _P2/_P3: đọc lần lượt từng tab trong cụm.
        let chain: string[] = [title];
        try { chain = await this.partitionChain(title); } catch { /* dùng tab gốc */ }
        const all: string[][] = [];
        for (const t of chain) {
          const rows = await this.readTabTail(t, 'N', tailRows);
          if (rows) all.push(...rows);
        }
        if (all.length > 0) out[title] = all;
        continue;
      }
      // THONGBAO_NV: chỉ đọc đuôi (10 cột đang dùng thay vì A:ZZ).
      const rows = await this.readTabTail(title, 'J', tailRows);
      if (rows) out[title] = rows;
    }
    return out;
  }

  /**
   * Đọc ĐUÔI một tab nhật ký: chỉ N dòng cuối + đúng số cột dùng.
   *
   * Lần đầu (chưa biết dòng cuối) đọc toàn bộ để không bỏ sót. Các lượt sau chỉ
   * đọc từ `dòng cuối đã biết - N`. Nếu range rỗng (không có dòng mới) thì kiểm
   * tra rẻ bằng 1 cột A: tab bị ghi đè ngắn đi thì đọc lại toàn bộ, bình thường
   * thì giữ cache — tránh đọc 56k dòng mỗi 2 phút.
   */
  private async readTabTail(title: string, lastCol: string, tailRows: number): Promise<string[][] | null> {
    let knownLast = this.historyLastRow.get(title) || 0;
    if (knownLast === 0) {
      // Chưa biết dòng cuối: đếm RẺ bằng 1 cột A thay vì đọc cả tab (56k dòng
      // x 10 cột) ngay sau mỗi lần restart backend.
      const colA = await this.readTabRange(title, `'${title}'!A2:A`, 30_000);
      if (colA) knownLast = colA.length + 1;
      if (knownLast > 0) this.historyLastRow.set(title, knownLast);
    }
    const start = knownLast > tailRows ? Math.max(2, knownLast - tailRows + 1) : 2;
    let rows = await this.readTabRange(title, `'${title}'!A${start}:${lastCol}`, 30_000);
    if (rows && rows.length === 0 && start > 2) {
      const colA = await this.readTabRange(title, `'${title}'!A2:A`, 20_000);
      const actualLast = colA ? colA.length + 1 : 0;
      if (colA && actualLast + 1 < start) {
        rows = await this.readTabRange(title, `'${title}'!A2:${lastCol}`, 45_000);
        if (rows) this.historyLastRow.set(title, rows.length + 1);
      } else if (colA) {
        this.historyLastRow.set(title, actualLast);
      }
    } else if (rows && rows.length > 0) {
      this.historyLastRow.set(title, start + rows.length - 1);
    }
    return rows;
  }

  /**
   * Đọc NHIỀU tab trong 1 HTTP round-trip (batchGet) — nhanh gấp ~N lần so với
   * đọc nối tiếp từng tab. Dùng cho full-pull realtime.
   */
  public async readTabsBatch(sheetTitles: string[], timeoutMs = 20_000): Promise<Record<string, string[][]>> {
    const out: Record<string, string[][]> = {};
    for (const t of sheetTitles) out[t] = [];
    if (!this.sheetsClient || sheetTitles.length === 0) return out;

    // Nhóm các tab theo spreadsheetId (hỗ trợ 25 sheet riêng biệt)
    const bySpreadsheet = new Map<string, string[]>();
    for (const t of sheetTitles) {
      const sid = getSpreadsheetIdForTab(t, this.spreadsheetId);
      if (!bySpreadsheet.has(sid)) bySpreadsheet.set(sid, []);
      bySpreadsheet.get(sid)!.push(t);
    }

    await Promise.all(Array.from(bySpreadsheet.entries()).map(async ([sid, tabs]) => {
      try {
        const res = await this.sheetsCall(`read.batchGet.${tabs[0]}`, () =>
          this.sheetsClient!.spreadsheets.values.batchGet({
            spreadsheetId: sid,
            ranges: tabs.map(t => `'${t}'!A2:AZ`),
            ...SHEETS_READ_OPTIONS,
          }), timeoutMs
        );
        const groups = res.data.valueRanges || [];
        for (let i = 0; i < tabs.length; i++) {
          out[tabs[i]] = (groups[i]?.values as string[][]) || [];
        }
      } catch (e) {
        // Fallback đọc từng tab nếu batch lỗi
        for (const t of tabs) {
          try {
            const single = await this.sheetsClient!.spreadsheets.values.get({
              spreadsheetId: sid,
              range: `'${t}'!A2:AZ`,
              ...SHEETS_READ_OPTIONS,
            });
            out[t] = (single.data.values as string[][]) || [];
          } catch {
            out[t] = [];
          }
        }
      }
    }));

    return out;
  }

  /**
   * Đồng bộ cấu hình kỹ thuật hệ thống lên tab CAU_HINH_HE_THONG trên Google Sheets.
   *
   * Lưu ý: bảng cài đặt có thể chứa key rất lớn (lịch sử điểm danh VP, phiên Zalo,
   * danh sách yêu cầu...). Một ô Google Sheets chỉ nhận tối đa 50.000 ký tự — nếu
   * ghi nguyên JSON, cả lượt ghi sẽ bị từ chối và `employee_salary_config`
   * (cấu hình lương) không bao giờ lên Sheet. Vì vậy giá trị lớn được chia nhiều
   * dòng và ghép lại khi pull (xem `buildSystemSettingsRows`).
   */
  public async syncSystemSettingsToSheet(
    settings: any,
    opts?: { attempts?: number },
  ): Promise<boolean> {
    if (!this.sheetsClient) return false;
    // Cấu hình lương nằm ở đây (employee_salary_config): ghi hỏng vì quota không
    // được bỏ — thử lại vài lần rồi mới trả false (không chờ lượt nền sau).
    const maxAttempts = Math.max(1, Math.min(5, Number(opts?.attempts ?? 5) || 5));
    const backoffs = [2000, 5000, 10000, 20000].slice(0, Math.max(0, maxAttempts - 1));
    this.lastSystemSettingsWriteError = '';
    for (let attempt = 0; ; attempt++) {
      try {
        const { rows, chunkedKeys } = buildSystemSettingsRows(settings);
        if (chunkedKeys.length > 0) {
          console.warn(`[GoogleSheetsSyncService] Chia phần ${chunkedKeys.length} khóa cài đặt quá lớn khi ghi CAU_HINH_HE_THONG: ${chunkedKeys.slice(0, 5).join(', ')}`);
        }
        // ANTI-WIPE: đọc cấu hình lỗi/rỗng bất thường thì KHÔNG ghi đè (tránh xoá
        // trắng tab). Lần sau có cấu hình sẽ ghi lại đầy đủ.
        if (rows.length === 0) {
          console.warn('[GoogleSheetsSyncService] Bỏ qua ghi CAU_HINH_HE_THONG: cấu hình rỗng bất thường.');
          return false;
        }
        await this.overwriteSheetData('CAU_HINH_HE_THONG', ['Tham Số', 'Giá Trị', 'Mô Tả', 'Cập Nhật Lần Cuối'], rows);
        this.lastSystemSettingsWriteError = '';
        return true;
      } catch (err: any) {
        this.lastSystemSettingsWriteError = String(err?.message || err).slice(0, 300);
        const transient = this.isQuotaError(err) || /timeout|timed out|ETIMEDOUT|SHEETS_TIMEOUT|ECONN|socket|5\d\d/i.test(String(err?.message || err));
        if (attempt >= backoffs.length || !transient) {
          console.warn('[GoogleSheetsSyncService] Lỗi ghi CAU_HINH_HE_THONG:', err?.message || err);
          return false;
        }
        console.warn(`[GoogleSheetsSyncService] Ghi CAU_HINH_HE_THONG loi tam thoi (lan ${attempt + 1}) — cho ${backoffs[attempt]}ms roi thu lai.`);
        await new Promise(r => setTimeout(r, backoffs[attempt]));
      }
    }
  }

  /**
   * Đẩy NGAY (await) tab CAU_HINH_HE_THONG từ bộ nhớ/PostgreSQL lên Sheet và ghi
   * lại trạng thái. Dùng sau khi Kế toán lưu cấu hình lương để API trả về kết quả
   * đồng bộ THẬT (ok/false/pending) thay vì hứa "đã đồng bộ" mà không kiểm chứng.
   *
   * Lượt đầu chỉ thử tối đa 2 lần (nhanh, không giữ request quá lâu). Nếu vẫn lỗi,
   * một lượt thử lại đầy đủ chạy nền và cập nhật lại `systemSettingsSheetSyncState`.
   */
  public async pushSystemSettingsNow(repo: ISheetsRepository): Promise<{
    ok: boolean;
    at: string;
    error?: string;
    skipped?: string;
    pending?: boolean;
  }> {
    const at = () => new Date().toISOString();
    if (!this.sheetsClient) {
      this.systemSettingsSheetSyncState = { at: at(), ok: true, error: '', pending: false, skipped: 'SHEETS_NOT_CONFIGURED' };
      return { ok: true, at: this.systemSettingsSheetSyncState.at, skipped: 'SHEETS_NOT_CONFIGURED' };
    }
    const settings = await repo.getSystemSettings().catch(() => ({}));
    this.systemSettingsSheetSyncState = { ...this.systemSettingsSheetSyncState, at: at(), pending: true, error: '' };
    const ok = await this.syncSystemSettingsToSheet(settings, { attempts: 2 });
    const error = ok ? '' : (this.lastSystemSettingsWriteError || 'SHEET_WRITE_FAILED');
    this.systemSettingsSheetSyncState = { at: at(), ok, error, pending: false };
    if (!ok) {
      // Thử lại nền với backoff đầy đủ — dữ liệu đã chắc chắn nằm trong PostgreSQL.
      void this.syncSystemSettingsToSheet(settings, { attempts: 5 })
        .then(ok2 => {
          this.systemSettingsSheetSyncState = {
            at: at(),
            ok: ok2,
            error: ok2 ? '' : (this.lastSystemSettingsWriteError || 'SHEET_WRITE_FAILED'),
            pending: false,
          };
        })
        .catch(() => null);
    }
    return { ok, at: this.systemSettingsSheetSyncState.at, error: error || undefined, pending: !ok };
  }

  /**
   * Ghi riêng tab DANH_SACH_CHI_NHANH (toạ độ GPS cửa hàng). Dùng khi Admin sửa
   * toạ độ ở tab Chi nhánh: chỉ 1 request thay vì đợi full-sync 24 tab (full-sync
   * có thể bị hoãn rồi restart làm mất toạ độ vừa sửa).
   */
  public async syncBranchesToSheet(branches: any[]): Promise<boolean> {
    if (!this.sheetsClient) return false;
    try {
      const rows = (branches || []).map(b => [
        b.id,
        b.name,
        b.address,
        b.latitude,
        b.longitude,
        b.radius_meters,
        b.status,
        b.gps_enabled === false ? 'FALSE' : 'TRUE',
        (b as any).map_visible === false ? 'FALSE' : 'TRUE',
      ]);
      if (rows.length === 0) return false;
      const def = SHEETS_DEFINITIONS.find(d => d.title === 'DANH_SACH_CHI_NHANH')!;
      await this.overwriteSheetData('DANH_SACH_CHI_NHANH', def.headers, rows);
      return true;
    } catch (err: any) {
      console.warn('[GoogleSheetsSyncService] Lỗi ghi DANH_SACH_CHI_NHANH:', err?.message || err);
      return false;
    }
  }

  /**
   * Đẩy 1 tab an toàn: tab lỗi thì ghi lỗi vào details rồi đi tiếp tab khác —
   * không để 1 tab hỏng (VD ô QR base64 quá lớn) làm đứng cả đợt đồng bộ.
   */
  /** Các tab CHỈ ghi nối (nhật ký/thông báo): full-sync KHÔNG ghi đè toàn tab.
   *  Lý do: mỗi lượt ghi đè hàng nghìn dòng giữ khoá spreadsheet rất lâu, khiến
   *  append của hàng đợi bền vững timeout; đồng thời dễ tạo dòng trùng với các
   *  bản ghi append đang chờ. Tab vẫn được init (tạo + header) và ghi qua append. */
  public static readonly APPEND_ONLY_TABS = new Set<string>([
    'AUDIT_LOG',
    'THONGBAO_GUI',
    'THONGBAO_NV',
    'SU_KIEN_DIEM_DANH',
  ]);

  private async pushTabSafe(
    details: any,
    key: string,
    title: string,
    headers: string[],
    rows: any[][],
    valueInputOption: 'RAW' | 'USER_ENTERED' = 'USER_ENTERED',
  ): Promise<void> {
    try {
      // BẢO VỆ CHỐNG MẤT DỮ LIỆU: Tuyệt đối không cho phép ghi đè rỗng (0 dòng) lên các tab Master
      if (rows.length === 0 && GoogleSheetsSyncService.CRITICAL_TABS.has(title)) {
        console.warn(`[GoogleSheetsSyncService] CHẶN NGUY HIỂM: Tab '${title}' có 0 dòng dữ liệu để đẩy. Huỷ ghi đè tab này để bảo vệ dữ liệu Master!`);
        details[key] = { skipped: true, reason: 'ANTI_DATA_LOSS_PREVENTED_EMPTY_OVERWRITE' };
        return;
      }

      // Tab chỉ-ghi-nối: không ghi đè toàn tab (xem APPEND_ONLY_TABS).
      if (GoogleSheetsSyncService.APPEND_ONLY_TABS.has(title)) {
        details[key] = { skipped: true, reason: 'APPEND_ONLY_TAB' };
        return;
      }

      // BETA partition: tab khai báo partition -> ghi đè qua các part (không
      // xoáy toàn bộ lịch sử về 1 tab gốc phình to như cũ).
      if (GoogleSheetsSyncService.PARTITION_TABS.has(title)) {
        await this.rewritePartitionedTab(title, rows);
      } else {
        await this.overwriteSheetData(title, headers, rows, false, valueInputOption);
      }
      details[key] = rows.length;
    } catch (err: any) {
      const msg = err?.message || String(err);
      details[key] = { error: msg };
      // SELF-HEAL: tab KHÔNG TỒN TẠI trên Sheet (bị xóa tay / đổi spreadsheet / tab mới
      // thêm vào code) — hủy cache init để đợt đồng bộ kế tiếp TỰ TẠO LẠI TAB + DÒNG
      // HEADER CỘT rồi push dữ liệu. Không hủy khi lỗi khác (403/quota/timeout).
      if (/404|NOT_FOUND|Unable to parse range|does not exist|not found/i.test(msg)) {
        this.invalidateInitCache();
      }
      console.warn(`[GoogleSheetsSyncService] Bỏ qua tab ${title} (lỗi, đợt sau thử lại):`, msg);
    }
  }

  /** Hủy cache init cấu trúc sheet — buộc initSpreadsheetStructure chạy lại
   *  (kiểm tra tab thiếu + tạo tab mới + ghi lại hàng header cột). */
  private invalidateInitCache() {
    this.initOkAt = 0;
    this.lastInitResult = null;
  }

  /**
   * ĐỒNG BỘ DỮ LIỆU LÊN GOOGLE SHEETS (GHI ĐÈ DỮ LIỆU)
   */
  public async syncAllData(repo: ISheetsRepository): Promise<{ success: boolean; message: string; details: any }> {
    // BẢO VỆ DỮ LIỆU TOÀN DIỆN (ANTI-DATA-LOSS GUARD):
    // Nếu bộ nhớ đang rỗng (0 nhân viên), TUYỆT ĐỐI KHÔNG GHI ĐÈ lên Google Sheets!
    let fallback: MockSheetsAdapter | null = null;
    if ((repo as any).fallbackAdapter instanceof MockSheetsAdapter) {
      fallback = (repo as any).fallbackAdapter as MockSheetsAdapter;
    } else if (repo instanceof MockSheetsAdapter) {
      fallback = repo;
    }
    const staffCount = (fallback?.employees?.length || 0) + (fallback?.accounts?.length || 0);
    if (staffCount === 0) {
      console.warn('[GoogleSheetsSyncService] CHẶN ĐỒNG BỘ NGUY HIỂM: Bộ nhớ đang có 0 nhân viên. Huỷ syncAllData để bảo vệ toàn vẹn Google Sheets Master!');
      return {
        success: false,
        message: 'Bộ nhớ đang rỗng (chưa tải xong từ Google Sheets). Đã kích hoạt cơ chế bảo vệ để không làm mất dữ liệu trên Sheet!',
        details: { blocked: true, reason: 'EMPTY_STAFF_MEMORY_PROTECTION' },
      };
    }

    const initResult = await this.initSpreadsheetStructure();
    if (!initResult.success) {
      return { success: false, message: initResult.message, details: null };
    }

    if (!this.sheetsClient) {
      return { success: false, message: 'Google Sheets client không khả dụng', details: null };
    }

    // Các append đã vào journal nhưng chưa lên Sheet phải được gửi trước khi
    // full-sync ghi đè cả tab; nếu không, dòng đó có thể bị thêm trùng sau đó.
    try {
      await (repo as any).flushDurableWrites?.(5000);
    } catch { /* best-effort, không chặn full-sync */ }

    try {
      const details: any = {};

      // 1. Admin Accounts (kèm cột Trạng Thái ACTIVE/LOCKED)
      const admins = await repo.listAdminAccounts();
      const adminRows = admins.map(a => [
        a.admin_id,
        a.username,
        a.password_hash || '123456',
        a.full_name,
        a.role,
        a.branch_scope || '*',
        (a as any).is_active === false ? 'LOCKED' : 'ACTIVE',
        a.created_at,
      ]);
      await this.pushTabSafe(details, 'adminAccounts', 'ADMIN_ACCOUNTS', SHEETS_DEFINITIONS.find(d => d.title === 'ADMIN_ACCOUNTS')!.headers, adminRows);

      // 2. Chi nhánh
      const branches = await repo.getBranches();
      const branchRows = branches.map(b => [
        b.id,
        b.name,
        b.address,
        b.latitude,
        b.longitude,
        b.radius_meters,
        b.status,
        b.gps_enabled === false ? 'FALSE' : 'TRUE',
        (b as any).map_visible === false ? 'FALSE' : 'TRUE',
      ]);
      await this.pushTabSafe(details, 'branches', 'DANH_SACH_CHI_NHANH', SHEETS_DEFINITIONS.find(d => d.title === 'DANH_SACH_CHI_NHANH')!.headers, branchRows);

      // 3. Nhân viên
      const employees = await repo.listEmployees();
      const employeeRows = employees.map(e => [
        e.employee_id,
        e.employee_code,
        e.full_name,
        GoogleSheetsSyncService.sheetText(e.phone_normalized),
        e.employment_status,
        e.group,
        e.default_branch_id,
        e.current_rate_per_hour,
        // Ép TEXT để USER_ENTERED không biến 'YYYY-MM-DD' thành serial Sheets
        // (đọc lại theo locale -> mất ngày sau reload). Xem sheetDateText.
        sheetDateText(e.start_date || (e as any).created_at),
        e.version,
        (e as any).default_shift_code || '',
        sheetDateText((e as any).official_date),
        (e as any).email || '',
        (e as any).gender || '',
        (e as any).birth_date ? sheetDateText((e as any).birth_date) : '',
        (e as any).id_card_number || '',
        (e as any).avatar_drive_id || '',
        (e as any).bank_name || '',
        GoogleSheetsSyncService.sheetText((e as any).bank_account || ''),
        (e as any).bank_holder || '',
        (e as any).bank_qr_img || '',
        Number((e as any).adjust_points_earned) || 0,
        Number((e as any).adjust_points_spent) || 0,
        contractDocsCell((e as any).contract_docs),
        blacklistCell((e as any).blacklist),
      ]);
      await this.pushTabSafe(details, 'employees', 'NHAN_VIEN_MASTER', SHEETS_DEFINITIONS.find(d => d.title === 'NHAN_VIEN_MASTER')!.headers, employeeRows);

      // 4. Tài khoản nhân viên (không còn cột Người/Ngày Kích Hoạt)
      const accounts = await repo.listAccounts();
      const accountRows = accounts.map(acc => [
        acc.account_id,
        acc.employee_id,
        GoogleSheetsSyncService.sheetText(acc.phone_normalized),
        acc.role,
        acc.account_status,
        acc.version,
        acc.pin_hash || '',
        acc.pin_must_change ? 'YES' : '',
        GoogleSheetsSyncService.sheetText((acc as any).pin_code || ''),
        GoogleSheetsSyncService.sheetText((acc as any).pin_changed_at || ''),
        GoogleSheetsSyncService.sheetText((acc as any).pin_rotation_cycle || ''),
      ]);
      await this.pushTabSafe(details, 'accounts', 'TAI_KHOAN_NHAN_VIEN', SHEETS_DEFINITIONS.find(d => d.title === 'TAI_KHOAN_NHAN_VIEN')!.headers, accountRows);

      // 5. Phân công ca — đẩy TOÀN BỘ lịch sử (không cắt 60 ngày): cắt là ca cũ
      // mất khỏi Sheet sau mỗi full-sync/publish, restart là mất vĩnh viễn khỏi
      // bộ nhớ -> tab Lịch lùi tuần trống ca cũ. '2000-01-01' = lấy tất cả.
      // Dùng CÙNG coalescedTabPush với create/update ca để full-sync không ghi đè
      // dữ liệu mới hơn đang được một request khác thêm vào.
      try {
        details.shifts = await this.pushShiftsTab(repo);
      } catch (err: any) {
        details.shifts = { error: err?.message || String(err) };
        this.markDataDirty();
        console.warn('[GoogleSheetsSyncService] Bỏ qua tab PHAN_CONG_CA (lỗi, đợt sau thử lại):', err?.message || err);
      }

      // 6. Đơn nghỉ phép
      const leaves = await repo.listLeaveRequests();
      const leaveRows = leaves.map(l => [
        l.request_id,
        l.employee_id,
        l.branch_id,
        l.leave_type,
        sheetDateText(l.requested_date),
        l.shift_code || '',
        l.reason,
        l.status,
        l.reviewed_by || '',
        l.review_note || '',
        l.created_at,
      ]);
      await this.pushTabSafe(details, 'leaves', 'DON_NGHI_PHEP', SHEETS_DEFINITIONS.find(d => d.title === 'DON_NGHI_PHEP')!.headers, leaveRows);

      // 6b. Bài TEST + bài làm (HR giao đúng nhân viên)
      const papers = await repo.listTestPapers().catch(() => []);
      const paperRows = (papers || []).map(p => [
        p.test_id,
        p.title,
        p.description || '',
        JSON.stringify(p.questions || []),
        p.pass_score ?? 8,
        p.time_limit_seconds ?? 480,
        p.status,
        p.created_by,
        p.created_at,
        p.version,
      ]);
      await this.pushTabSafe(details, 'testPapers', 'BAI_THI', SHEETS_DEFINITIONS.find(d => d.title === 'BAI_THI')!.headers, paperRows);
      const subs = await repo.listTestSubmissions().catch(() => []);
      const subRows = (subs || []).map(s => [
        s.submission_id,
        s.test_id,
        s.employee_id,
        s.status,
        s.answers ? JSON.stringify(s.answers) : '',
        s.score ?? '',
        s.passed === true ? 'YES' : s.passed === false ? 'NO' : '',
        s.submitted_at || '',
        s.created_at,
        s.version,
      ]);
      await this.pushTabSafe(details, 'testSubmissions', 'BAI_LAM', SHEETS_DEFINITIONS.find(d => d.title === 'BAI_LAM')!.headers, subRows);

      // 6c. Phiếu lương chi tiết (tự động đồng bộ toàn bộ phiếu lên tab PHIEU_LUONG).
      try {
        details.payslips = await this.pushPayslipsTab(repo);
      } catch (e: any) {
        details.payslips = { error: e?.message || String(e) };
        console.warn('[GoogleSheetsSyncService] Bỏ qua tab PHIEU_LUONG (lỗi, đợt sau thử lại):', (e as any)?.message || e);
      }

      // 6c2. Công thức + dữ liệu nhập tay lương theo kỳ (Finance).
      try {
        let fb: any = null;
        if ((repo as any).fallbackAdapter instanceof MockSheetsAdapter) fb = (repo as any).fallbackAdapter;
        else if (repo instanceof MockSheetsAdapter) fb = repo;
        const formulas: any[] = ((fb as any)?.payrollFormulas || []).map((f: any) => ([
          f.period, f.rateTV ?? 21000, f.rateCT ?? 25500, 0,
          f.otThreshold1 ?? 10, f.otThreshold2 ?? 15, f.updatedBy || '', f.updatedAt || '',
        ]));
        await this.overwriteSheetData('CONG_THUC_LUONG', SHEETS_DEFINITIONS.find(d => d.title === 'CONG_THUC_LUONG')!.headers, formulas);
        details.payrollFormulas = formulas.length;
        const inputs: any[] = ((fb as any)?.payrollInputs || []).map((x: any) => ([
          x.period, x.employee_id, x.luong_cb ?? 0, x.ot_extra ?? 0, x.bonus_extra ?? 0,
          x.ung_luong ?? 0, x.tru_kpi ?? 0, x.dong_phuc ?? 0, x.note || '', x.updatedBy || '', x.updatedAt || '',
        ]));
        await this.overwriteSheetData('DULIEU_LUONG_KY', SHEETS_DEFINITIONS.find(d => d.title === 'DULIEU_LUONG_KY')!.headers, inputs);
        details.payrollInputs = inputs.length;
      } catch (e: any) {
        console.warn('[GoogleSheetsSyncService] Đẩy công thức/dữ liệu lương thất bại:', e?.message || e);
      }

      // 6d. Lịch sử giai đoạn NV (thử việc/chính thức — trước đây chỉ nằm bộ nhớ).
      const stageList = await this.collectAllStageHistories(repo);
      const stagePushRows = (stageList || []).map((h: any) => ([
        h.period_id,
        h.employee_id,
        h.stage || '',
        h.effective_from || '',
        h.rate_per_hour ?? 0,
        h.approved_by || '',
        h.reason || h.note || '',
        h.version ?? 1,
        h.created_at || '',
      ]));
      await this.pushTabSafe(details, 'stageHistories', 'LICH_SU_GIAI_DOAN', SHEETS_DEFINITIONS.find(d => d.title === 'LICH_SU_GIAI_DOAN')!.headers, stagePushRows);

      // 7. Đơn đổi ca
      const swaps = await repo.listSwapRequests();
      const swapRows = swaps.map(sw => [
        sw.swap_id,
        sw.requester_id,
        sw.requester_assignment_id,
        sw.target_employee_id,
        sw.target_assignment_id,
        sw.reason,
        sw.status,
        sw.approved_by || '',
        sw.created_at,
        (sw as any).swap_kind || 'EMPLOYEE_SWAP',
        (sw as any).bonus_amount || 0,
      ]);
      await this.pushTabSafe(details, 'swaps', 'DON_DOI_CA', SHEETS_DEFINITIONS.find(d => d.title === 'DON_DOI_CA')!.headers, swapRows);

      // 7b. Điều chỉnh công (trước đây chỉ pull mà không push — tạo trên web sẽ mất khi restart)
      const adjustments = await repo.listAttendanceAdjustments();
      const adjRows = adjustments.map(a => [
        a.adjustment_id,
        a.assignment_id,
        a.employee_id,
        a.reason || '',
        a.minutes_approved ?? a.minutes_requested ?? 0,
        a.approver_id || '',
        a.status,
        a.review_note || '',
        (a as any).evidence_drive_id || '',
        (a as any).photo_hash || '',
        // 0 = NV thử việc miễn phí; rỗng với phiếu cũ (coi như đã trừ 5 điểm).
        (a as any).points_charged ?? '',
      ]);
      await this.pushTabSafe(details, 'adjustments', 'DIEU_CHINH_CONG', SHEETS_DEFINITIONS.find(d => d.title === 'DIEU_CHINH_CONG')!.headers, adjRows);

      // 8. Bảng lương
      const payrollRuns = await repo.listPayrollRuns();
      const payrollRows = payrollRuns.map(pr => [
        pr.run_id,
        pr.period,
        pr.status,
        pr.total_amount,
        pr.created_at,
        pr.published_at || '',
        pr.paid_at || '',
      ]);
      await this.pushTabSafe(details, 'payrollRuns', 'KY_LUONG', SHEETS_DEFINITIONS.find(d => d.title === 'KY_LUONG')!.headers, payrollRows);

      // 9. Nhật ký Audit Log
      const auditLogs = await repo.getAuditLogs(100);
      const auditRows = auditLogs.map(log => [
        log.log_id,
        log.timestamp,
        log.actor_id,
        log.actor_role,
        log.action,
        log.target_entity,
        log.target_id,
        typeof log.details === 'string' ? log.details : JSON.stringify(log.details || {}),
      ]);
      await this.pushTabSafe(details, 'auditLogs', 'AUDIT_LOG', SHEETS_DEFINITIONS.find(d => d.title === 'AUDIT_LOG')!.headers, auditRows);

      // 9b. Thông báo đã gửi (outbox → tab THONGBAO_GUI): nguồn của tab "Thông báo"
      // / "Tạo thông báo" / "Nội dung đã phát" / "Lịch phát thông báo" (MKT + ADMIN).
      const outboxList: any[] = (await (repo as any).listNotificationOutbox?.().catch(() => [])) || [];
      const outboxPushRows = outboxList.map(o => [
        o.notification_id,
        o.event_id || '',
        o.dedupe_key || '',
        o.recipient_id || '',
        o.type || '',
        o.severity || '',
        o.title || '',
        o.summary || '',
        o.target_path || '',
        o.channel || 'IN_APP',
        o.delivery_status || 'SENT',
        o.attempts ?? 1,
        o.last_error || '',
        o.created_at || '',
      ]);
      await this.pushTabSafe(details, 'notificationOutbox', 'THONGBAO_GUI', SHEETS_DEFINITIONS.find(d => d.title === 'THONGBAO_GUI')!.headers, outboxPushRows);

      // 9c. Snapshot sao lưu & phục hồi → tab SNAPSHOT_SAOLUU (trước đây chỉ nằm bộ nhớ,
      // restart là mất list snapshot).
      const snapshots = (await repo.getBackupSnapshots().catch(() => [])) || [];
      const snapshotRows = snapshots.map((s: any) => [
        s.snapshot_id,
        s.name || '',
        s.created_at || '',
        s.file_count ?? '',
        s.size_mb ?? '',
        s.status || 'SUCCESS',
        s.verified === true ? 'YES' : '',
      ]);
      await this.pushTabSafe(details, 'backupSnapshots', 'SNAPSHOT_SAOLUU', SHEETS_DEFINITIONS.find(d => d.title === 'SNAPSHOT_SAOLUU')!.headers, snapshotRows);

      // 10. Ứng viên tuyển dụng (FROM_NHAN_VIEN) - 17 Cột
      const candList = await repo.listCandidates();
      if (candList.length > 0) {
        const candHeaders = SHEETS_DEFINITIONS.find(d => d.title === 'FROM_NHAN_VIEN')!.headers;
        const candRows = candList.map((c, idx) => [
          c.created_at || new Date().toISOString(),
          c.full_name || '',
          c.gender || 'Nam',
          // Giữ đúng chuỗi gốc từ form ("2004 - 2008"), chỉ fallback số khi thiếu.
          (c as any).birth_year_raw || (c.birth_year ? String(c.birth_year) : '2002'),
          c.education_level || 'Đại học',
          c.hometown || 'TP. Hồ Chí Minh',
          c.phone || c.phone_normalized || '',
          c.registered_shift || 'Ca sáng / Ca chiều',
          c.branch_name || c.preferred_branch_id || 'CN130',
          c.experience || 'Chưa có kinh nghiệm',
          c.emergency_handling || 'Sẵn sàng hỗ trợ đột xuất',
          c.facebook_url || '',
          c.referral_source || 'Facebook Tuyển Dụng',
          c.ai_score !== undefined ? String(c.ai_score) : '12',
          c.screening_result || 'Đạt (Đủ điều kiện PV)',
          c.status || 'NEW',
          c.source_code || c.submission_id || `UBM_FORM_${String(idx + 1).padStart(4, '0')}`,
          (c as any).interview_date || '',
          (c as any).interview_time_slot || '',
          (c as any).interviewer_id || '',
          buildZaloInviteCell((c as any).zalo_invite_status, (c as any).zalo_invite_note),
          (c as any).zalo_invite_at || '',
          (c as any).interview_score ?? '',
          (c as any).interview_score_detail || '',
          (c as any).vip ? 'VIP' : '',
          (c as any).vip_rank !== undefined && (c as any).vip_rank !== null ? String((c as any).vip_rank) : '',
          (c as any).interview_decline_reason || '',
          (c as any).interview_proposed_date || '',
          (c as any).interview_proposed_time_slot || '',
          (c as any).interview_proposed_note || '',
          (c as any).blacklist_reason || '',
        ]);
        // RAW: cột SĐT/CCCD/"Năm Sinh" phải giữ đúng chuỗi form gửi lên.
        await this.pushTabSafe(details, 'candidates', 'FROM_NHAN_VIEN', candHeaders, candRows, 'RAW');
      }

      // 18. Đồng bộ Cài đặt hệ thống (CAU_HINH_HE_THONG)
      try {
        const sysSettings = await repo.getSystemSettings();
        if (sysSettings) {
          await this.syncSystemSettingsToSheet(sysSettings);
          details.systemSettings = Object.keys(sysSettings).length;
        }
      } catch (e: any) {
        details.systemSettings = { error: e?.message || String(e) };
        console.warn('[GoogleSheetsSyncService] Bỏ qua tab CAU_HINH_HE_THONG (lỗi, đợt sau thử lại):', (e as any)?.message || e);
      }

      const failedTabs = Object.entries(details)
        .filter(([, v]: any) => v && typeof v === 'object' && (v as any).error)
        .map(([k]) => k);
      const allOk = failedTabs.length === 0;

      if (allOk) {
        // Push đầy đủ thành công = toàn bộ dữ liệu bộ nhớ đã lên Sheet (kể cả mọi
        // thay đổi dirty trước mốc này) — auto-push định kỳ được phép nghỉ.
        this.lastFullPushAt = Date.now();
        // Tự động căn chỉnh & làm đẹp: tối đa 1 lần/6 giờ (đẹp Sheets tốn ~20-30
        // write + đọc 20 dòng/tab, lấn quota của thao tác thật). Endpoint định dạng
        // thủ công (/admin/integrations/format-sheets) vẫn chạy bất kỳ lúc nào.
        if (Date.now() - this.lastBeautifyAt > 6 * 3_600_000) {
          this.formatAndBeautifySpreadsheet().catch(err => {
            console.warn('[GoogleSheetsSyncService] Tự động làm đẹp sau syncAllData thất bại:', err?.message || err);
          });
        }
      }

      return {
        success: allOk,
        message: allOk
          ? 'Đồng bộ toàn bộ dữ liệu lên Google Sheets thành công!'
          : `Đồng bộ xong, ${failedTabs.length} tab lỗi (${failedTabs.join(', ')}) — đợt sau thử lại!`,
        details,
      };
    } catch (err: any) {
      console.error('[GoogleSheetsSyncService] Lỗi đồng bộ dữ liệu:', err);
      return { success: false, message: `Lỗi đồng bộ dữ liệu: ${err.message}`, details: null };
    }
  }

  /**
   * Đẩy riêng tab NHAN_VIEN_MASTER (await được): dùng sau DELETE để dòng bị xóa
   * khỏi Sheet NGAY trong cùng request, pull sau đó không thể hồi sinh.
   */
  public async pushEmployeesTab(repo: { listEmployees(): Promise<any[]> }): Promise<number> {
    const employees = await repo.listEmployees().catch(() => []);
    const rows = (employees || []).map((e: any) => ([
      e.employee_id,
      e.employee_code,
      e.full_name,
      GoogleSheetsSyncService.sheetText(e.phone_normalized),
      e.employment_status,
      e.group,
      e.default_branch_id,
      e.current_rate_per_hour,
      sheetDateText(e.start_date || e.created_at),
      e.version,
      e.default_shift_code || '',
      sheetDateText(e.official_date),
      e.email || '',
      e.gender || '',
      e.birth_date ? sheetDateText(e.birth_date) : '',
      e.id_card_number || '',
      (e as any).avatar_drive_id || '',
      (e as any).bank_name || '',
      GoogleSheetsSyncService.sheetText((e as any).bank_account || ''),
      (e as any).bank_holder || '',
      (e as any).bank_qr_img || '',
      Number((e as any).adjust_points_earned) || 0,
      Number((e as any).adjust_points_spent) || 0,
      contractDocsCell((e as any).contract_docs),
      blacklistCell((e as any).blacklist),
    ]));
    await this.overwriteSheetData('NHAN_VIEN_MASTER', SHEETS_DEFINITIONS.find(d => d.title === 'NHAN_VIEN_MASTER')!.headers, rows);
    return rows.length;
  }

  /**
   * Đẩy riêng tab TAI_KHOAN_NHAN_VIEN (await được): dùng sau DELETE tài khoản.
   */
  public async pushAccountsTab(repo: { listAccounts(): Promise<any[]> }): Promise<number> {
    const accounts = await repo.listAccounts().catch(() => []);
    const rows = (accounts || []).map((acc: any) => ([
      acc.account_id,
      acc.employee_id,
      GoogleSheetsSyncService.sheetText(acc.phone_normalized),
      acc.role,
      acc.account_status,
      acc.version,
      acc.pin_hash || '',
      acc.pin_must_change ? 'YES' : '',
      GoogleSheetsSyncService.sheetText(acc.pin_code || ''),
      GoogleSheetsSyncService.sheetText(acc.pin_changed_at || ''),
      GoogleSheetsSyncService.sheetText(acc.pin_rotation_cycle || ''),
    ]));
    await this.overwriteSheetData('TAI_KHOAN_NHAN_VIEN', SHEETS_DEFINITIONS.find(d => d.title === 'TAI_KHOAN_NHAN_VIEN')!.headers, rows);
    return rows.length;
  }

  /**
   * Đẩy riêng tab ADMIN_ACCOUNTS (await được): dùng sau DELETE tài khoản nội bộ.
   */
  public async pushAdminsTab(repo: { listAdminAccounts(): Promise<any[]> }): Promise<number> {
    const admins = await repo.listAdminAccounts().catch(() => []);
    const rows = (admins || []).map((a: any) => ([
      a.admin_id,
      a.username,
      a.password_hash || '123456',
      a.full_name,
      a.role,
      a.branch_scope || '*',
      a.is_active === false ? 'LOCKED' : 'ACTIVE',
      a.created_at,
    ]));
    await this.overwriteSheetData('ADMIN_ACCOUNTS', SHEETS_DEFINITIONS.find(d => d.title === 'ADMIN_ACCOUNTS')!.headers, rows);
    return rows.length;
  }

  /**
   * Đẩy riêng tab PHIEU_LUONG (await được): dùng sau mọi mutation phiếu lương
   * (Ký lập/quản lý, Lưu phiếu, Phát hành, Nhân viên ký xác nhận, Hoàn thành chuyển tiền)
   * để 3 chữ ký và toàn bộ mốc thời gian bền vững trên Google Sheet NGAY.
   */
  /** Dựng dòng PHIEU_LUONG từ danh sách phiếu (dùng chung cho push đọc Sheets và push từ bộ nhớ). */
  private buildPayslipPushRows(slipsForPush: any[]): any[][] {
    return (slipsForPush || []).map((s: any) => ([
      s.item_id,
      s.run_id,
      s.employee_id,
      s.employee_code || '',
      s.full_name || '',
      s.period || '',
      s.total_shifts ?? 0,
      s.absent_shifts ?? 0,
      s.standard_hours ?? 0,
      s.rate_snapshot ?? 0,
      s.standard_pay ?? 0,
      // Phụ cấp OT đã bỏ: luôn ghi 0 để Sheet không lưu/khôi phục khoản cũ.
      0,
      s.bonus ?? 0,
      s.deduction ?? 0,
      s.net_pay ?? 0,
      s.status || 'DRAFT',
      0,
      0,
      s.luong_cb ?? '',
      s.ot_extra ?? '',
      s.bonus_extra ?? '',
      s.ung_luong ?? '',
      s.tru_kpi ?? '',
      s.dong_phuc ?? '',
      s.tong_cong ?? '',
      s.tong_luong ?? '',
      s.thuc_lanh ?? '',
      s.sign_lap?.name || '',
      s.sign_lap?.at || '',
      s.sign_quanly?.name || '',
      s.sign_quanly?.at || '',
      s.sign_nhanvien?.name || '',
      s.sign_nhanvien?.at || '',
      String(s.sign_lap?.img || '').slice(0, 45000),
      String(s.sign_quanly?.img || '').slice(0, 45000),
      String(s.sign_nhanvien?.img || '').slice(0, 45000),
      s.slip_published_at || '',
      s.slip_confirmed_at || '',
      s.slip_paid_at || '',
      s.allowance ?? '',
    ]));
  }

  public async pushPayslipsTab(repo: ISheetsRepository): Promise<number> {
    const slipsForPush = await this.collectAllPayslips(repo);
    const slipPushRows = this.buildPayslipPushRows(slipsForPush);
    await this.overwriteSheetData('PHIEU_LUONG', SHEETS_DEFINITIONS.find(d => d.title === 'PHIEU_LUONG')!.headers, slipPushRows);
    return slipPushRows.length;
  }

  /**
   * Đẩy PHIEU_LUONG CHỈ từ bộ nhớ — KHÔNG đọc lại Sheets (tiết kiệm quota;
   * dùng ở đường ghi nóng sau mỗi thao tác kế toán). Bộ nhớ rỗng → bỏ qua
   * (chống ghi đè rỗng lên tab Master).
   */
  public async pushPayslipsMem(repo: ISheetsRepository): Promise<number> {
    const fb: any = (repo as any)?.fallbackAdapter || repo;
    const slips: any[] = Array.isArray(fb?.payslips) ? fb.payslips : [];
    if (slips.length === 0) {
      console.warn('[GoogleSheetsSyncService] pushPayslipsMem: bộ nhớ 0 phiếu — bỏ qua (chống ghi đè rỗng).');
      return 0;
    }
    const rows = this.buildPayslipPushRows(slips);
    await this.overwriteSheetData('PHIEU_LUONG', SHEETS_DEFINITIONS.find(d => d.title === 'PHIEU_LUONG')!.headers, rows);
    return rows.length;
  }

  /**
   * Đẩy RIÊNG các tab kế toán: KY_LUONG + CONG_THUC_LUONG + DULIEU_LUONG_KY +
   * PHIEU_LUONG. CHỈ ghi từ bộ nhớ, KHÔNG đọc lại Sheets (tiết kiệm quota Read —
   * production đang chạm hạn 60 request/phút do full-pull liên tục). Dùng sau
   * mỗi thao tác kế toán để Sheet khớp hệ thống trong cùng request.
   * Best-effort: 0 dòng (chưa có dữ liệu) thì bỏ qua, không ghi đè rỗng tab.
   */
  public async pushFinanceTabsNow(repo: ISheetsRepository, opts?: { skipSlips?: boolean }): Promise<{ skipped?: string; errors: string[]; tabs: Record<string, number> }> {
    const errors: string[] = [];
    const tabs: Record<string, number> = {};
    // Không có client Sheets (chưa cấu hình/môi trường dev) => bỏ qua, không báo lỗi.
    if (!(this as any).sheetsClient) return { skipped: 'SHEETS_NOT_CONFIGURED', errors, tabs };

    const headers = (title: string) => (SHEETS_DEFINITIONS.find(d => d.title === title)!).headers;

    // Nguồn bộ nhớ (MockSheetsAdapter) — Postgres mode vẫn giữ bản mirror trong RAM.
    let fb: any = null;
    if ((repo as any).fallbackAdapter) fb = (repo as any).fallbackAdapter;
    else if (repo) fb = repo;

    // 1) KY_LUONG — các kỳ lương (đọc từ BỘ NHỚ, không đọc lại Sheets → tiết kiệm quota Read)
    try {
      const payrollRuns: any[] = Array.isArray(fb?.payrollRuns) ? fb.payrollRuns : [];
      const payrollRows = payrollRuns.map((pr: any) => ([
        pr.run_id,
        pr.period,
        pr.status,
        pr.total_amount,
        pr.created_at,
        pr.published_at || '',
        pr.paid_at || '',
      ]));
      if (payrollRows.length > 0) {
        await this.overwriteSheetData('KY_LUONG', headers('KY_LUONG'), payrollRows);
        tabs.KY_LUONG = payrollRows.length;
      } else {
        tabs.KY_LUONG = 0;
      }
    } catch (e: any) {
      errors.push(`KY_LUONG: ${e?.message || String(e)}`);
    }

    // 2) CONG_THUC_LUONG — công thức theo kỳ
    try {
      const formulas: any[] = ((fb as any)?.payrollFormulas || []).map((f: any) => ([
        f.period, f.rateTV ?? 21000, f.rateCT ?? 25500, 0,
        f.otThreshold1 ?? 10, f.otThreshold2 ?? 15, f.updatedBy || '', f.updatedAt || '',
      ]));
      if (formulas.length > 0) {
        await this.overwriteSheetData('CONG_THUC_LUONG', headers('CONG_THUC_LUONG'), formulas);
        tabs.CONG_THUC_LUONG = formulas.length;
      } else {
        tabs.CONG_THUC_LUONG = 0;
      }
    } catch (e: any) {
      errors.push(`CONG_THUC_LUONG: ${e?.message || String(e)}`);
    }

    // 3) DULIEU_LUONG_KY — nhập tay theo kỳ
    try {
      const inputs: any[] = ((fb as any)?.payrollInputs || []).map((x: any) => ([
        x.period, x.employee_id, x.luong_cb ?? 0, x.ot_extra ?? 0, x.bonus_extra ?? 0,
        x.ung_luong ?? 0, x.tru_kpi ?? 0, x.dong_phuc ?? 0, x.note || '', x.updatedBy || '', x.updatedAt || '',
      ]));
      if (inputs.length > 0) {
        await this.overwriteSheetData('DULIEU_LUONG_KY', headers('DULIEU_LUONG_KY'), inputs);
        tabs.DULIEU_LUONG_KY = inputs.length;
      } else {
        tabs.DULIEU_LUONG_KY = 0;
      }
    } catch (e: any) {
      errors.push(`DULIEU_LUONG_KY: ${e?.message || String(e)}`);
    }

    // 3b) LICH_SU_GIAI_DOAN — lịch sử đơn giá từng NV (điều chỉnh lương ca).
    //     Đưa vào luồng đẩy riêng này để lương lên Sheet ngay sau khi điều chỉnh,
    //     thay vì chờ full-pull 25 sheet (rất nặng quota, từng bị bỏ lại tới 45s+).
    try {
      const stageRows: any[] = ((fb as any)?.stageHistories || []).map((h: any) => ([
        h.period_id,
        h.employee_id,
        h.stage || '',
        h.effective_from || '',
        h.rate_per_hour ?? 0,
        h.approved_by || '',
        h.reason || h.note || '',
        h.version ?? 1,
        h.created_at || '',
      ]));
      if (stageRows.length > 0) {
        await this.overwriteSheetData('LICH_SU_GIAI_DOAN', headers('LICH_SU_GIAI_DOAN'), stageRows);
        tabs.LICH_SU_GIAI_DOAN = stageRows.length;
      } else {
        tabs.LICH_SU_GIAI_DOAN = 0;
      }
    } catch (e: any) {
      errors.push(`LICH_SU_GIAI_DOAN: ${e?.message || String(e)}`);
    }

    // 4) PHIEU_LUONG — phiếu lương (memory-only, không đọc lại Sheets).
    //    Thao tác nhẹ (công thức/nhập tay) không đụng phiếu → bỏ qua để tiết kiệm write-quota.
    if (opts?.skipSlips) {
      tabs.PHIEU_LUONG = -1;
    } else {
      try {
        tabs.PHIEU_LUONG = await this.pushPayslipsMem(repo);
      } catch (e: any) {
        errors.push(`PHIEU_LUONG: ${e?.message || String(e)}`);
      }
    }

    // 5) CAU_HINH_HE_THONG - cấu hình hệ thống + employee_salary_config.
    //    Trước đây chỉ full-sync mới đẩy tab này; chế độ PostgreSQL tắt full-sync
    //    nên đổi lương KHÔNG bao giờ lên Sheet. Đẩy kèm lượt tài chính để Sheet
    //    luôn khớp (retry 1 lần, không chặn lâu).
    try {
      const settings = await repo.getSystemSettings().catch(() => ({}));
      const ok = await this.syncSystemSettingsToSheet(settings, { attempts: 2 });
      tabs.CAU_HINH_HE_THONG = ok ? Object.keys(settings || {}).length : -1;
      if (!ok) errors.push(`CAU_HINH_HE_THONG: ${this.lastSystemSettingsWriteError || 'SHEET_WRITE_FAILED'}`);
    } catch (e: any) {
      errors.push(`CAU_HINH_HE_THONG: ${e?.message || String(e)}`);
    }

    return { errors, tabs };
  }

  /**
   * Đẩy RIÊNG tab DULIEU_LUONG_KY (await được) ngay sau khi Kế toán nhập tay.
   * Chỉ 1 tab nên không đốt write-quota như pushFinanceTabsNow (4-5 tab).
   * Nhờ vậy reload/restart ngay sau khi lưu vẫn còn dữ liệu trên Sheet.
   */
  public async pushPayrollInputsNow(repo: ISheetsRepository): Promise<{ skipped?: string; errors: string[]; rows: number }> {
    const errors: string[] = [];
    if (!(this as any).sheetsClient) return { skipped: 'SHEETS_NOT_CONFIGURED', errors, rows: 0 };
    let fb: any = null;
    if ((repo as any).fallbackAdapter) fb = (repo as any).fallbackAdapter;
    else if (repo) fb = repo;
    // Tính lại rows mỗi lượt (kể cả lượt follow-up) để không ghi snapshot cũ.
    const buildRows = (): any[] => ((fb?.payrollInputs || []).map((x: any) => ([
      x.period, x.employee_id, x.luong_cb ?? 0, x.ot_extra ?? 0, x.bonus_extra ?? 0,
      x.ung_luong ?? 0, x.tru_kpi ?? 0, x.dong_phuc ?? 0, x.note || '', x.updatedBy || '', x.updatedAt || '',
    ])));
    if (buildRows().length === 0) return { skipped: 'NO_INPUTS', errors, rows: 0 };
    try {
      const n = await this.coalescedTabPush('DULIEU_LUONG_KY', async () => {
        const rows = buildRows();
        if (rows.length === 0) return 0;
        await this.overwriteSheetData('DULIEU_LUONG_KY', SHEETS_DEFINITIONS.find(d => d.title === 'DULIEU_LUONG_KY')!.headers, rows);
        return rows.length;
      });
      return { errors, rows: n };
    } catch (e: any) {
      errors.push(`DULIEU_LUONG_KY: ${e?.message || String(e)}`);
      return { errors, rows: 0 };
    }
  }

  /**
   * Đẩy riêng tab DON_DOI_CA (await được): dùng sau mọi mutation phiếu
   * (tạo/nhận/duyệt/hủy) để trạng thái bền vững trên Sheet NGAY trong cùng
   * request — restart/sleep server không mất phiếu, pull sau đó khôi phục đủ.
   */
  /**
   * ===== GỘP LẦN PUSH TAB (coalescing) =====
   * 1 đợt mutation nối tiếp (publish + hủy ca theo OFF, nhập lịch Excel,
   * đăng ký 2 ngày OFF...) trước đây gây ra BẤY NHIÊU lần ghi đè nguyên tab:
   * mỗi update-shift/phếu đều pushShiftsTab riêng → ~34-40 write × 1.1s mỗi
   * lần, lấp quota 60 write/phút và kéo dài request của người xếp lịch.
   * Nay: push đang chạy thì caller sau CHỜ CHUNG kết quả; mutation xảy ra
   * DURING push được đẩy tiếp đúng 1 lượt follow-up (gồm tất cả mutation mới).
   */
  private tabPushInFlight = new Map<string, Promise<number>>();
  private tabPushFollowUp = new Set<string>();

  private coalescedTabPush(key: string, pusher: () => Promise<number>): Promise<number> {
    const existing = this.tabPushInFlight.get(key);
    if (existing) {
      this.tabPushFollowUp.add(key);
      // Trả kết quả của push follow-up (gồm mutation của mình), không lọc lại push mới.
      return existing
        .then(() => this.tabPushInFlight.get(key) ?? 0)
        .catch(() => 0);
    }
    const run = Promise.resolve()
      .then(pusher)
      .catch((e: any) => {
        // Push rớt = dữ liệu bộ nhớ chưa chắc đã lên Sheet: bắt cờ dirty để
        // auto-push điều kiện (server.ts) hoặc soon-push nhảy vào đẩy lại.
        try { this.markDataDirty(); } catch { /* non-fatal */ }
        throw e;
      });
    this.tabPushInFlight.set(key, run);
    void run
      .then((n: number) => {
        if (this.tabPushInFlight.get(key) === run) this.tabPushInFlight.delete(key);
        // Có mutation đăng ký trong lúc push chạy → đẩy tiếp đúng 1 lượt gộp.
        if (n > 0 && this.tabPushFollowUp.has(key)) {
          this.tabPushFollowUp.delete(key);
          const follow = Promise.resolve()
            .then(pusher)
            .catch(() => 0);
          this.tabPushInFlight.set(key, follow);
          void follow.then((m: number) => {
            if (m === 0) { try { this.markDataDirty(); } catch { /* non-fatal */ } }
            if (this.tabPushInFlight.get(key) === follow) this.tabPushInFlight.delete(key);
          });
        }
      })
      .catch(() => {
        if (this.tabPushInFlight.get(key) === run) this.tabPushInFlight.delete(key);
      });
    return run;
  }

  public pushSwapsTab(repo: { listSwapRequests(): Promise<any[]> }): Promise<number> {
    return this.coalescedTabPush('swaps', () => this.doPushSwapsTab(repo));
  }

  private async doPushSwapsTab(repo: { listSwapRequests(): Promise<any[]> }): Promise<number> {
    const swaps = await repo.listSwapRequests().catch(() => []);
    const swapRows = (swaps || []).map((sw: any) => [
      sw.swap_id,
      sw.requester_id,
      sw.requester_assignment_id,
      sw.target_employee_id,
      sw.target_assignment_id,
      sw.reason,
      sw.status,
      sw.approved_by || '',
      sw.created_at,
      (sw as any).swap_kind || 'EMPLOYEE_SWAP',
      (sw as any).bonus_amount || 0,
      (sw as any).support_branch_id || '',
      String((sw as any).support_date || '').slice(0, 10),
      (sw as any).support_shift_code || '',
    ]);
    if (swapRows.length === 0) {
      // ANTI-WIPE: bộ nhớ 0 phiếu (boot trước khi pull xong) — không ghi đè rỗng phá DON_DOI_CA.
      console.warn('[GoogleSheetsSyncService] pushSwapsTab bỏ qua: bộ nhớ 0 phiếu (chống ghi đè rỗng).');
      return 0;
    }
    await this.overwriteSheetData('DON_DOI_CA', SHEETS_DEFINITIONS.find(d => d.title === 'DON_DOI_CA')!.headers, swapRows);
    return swapRows.length;
  }

  /**
   * Đẩy riêng tab DIEU_CHINH_CONG (await được): dùng sau DELETE để dòng bị xóa
   * khỏi Sheet NGAY, pull sau đó không thể hồi sinh phiếu (fix zombie).
   */
  public async pushAdjustmentsTab(repo: { listAttendanceAdjustments(): Promise<any[]> }): Promise<number> {
    const adjustments = await repo.listAttendanceAdjustments().catch(() => []);
    const adjRows = (adjustments || []).map(a => [
      a.adjustment_id,
      a.assignment_id,
      a.employee_id,
      a.reason || '',
      a.minutes_approved ?? a.minutes_requested ?? 0,
      a.approver_id || '',
      a.status,
      a.review_note || '',
      a.evidence_drive_id || '',
      (a as any).photo_hash || '',
      // 0 = NV thử việc miễn phí; giữ cột để hoàn đúng điểm sau restart.
      (a as any).points_charged ?? '',
    ]);
    await this.overwriteSheetData('DIEU_CHINH_CONG', SHEETS_DEFINITIONS.find(d => d.title === 'DIEU_CHINH_CONG')!.headers, adjRows);
    return adjRows.length;
  }

  /**
   * Đẩy riêng tab PHAN_CONG_CA (await được): dùng sau PUBLISH để trạng thái
   * PUBLISHED bền vững trên Sheet NGAY trong cùng request — restart ngay sau
   * publish cũng không rớt về DRAFT (NV mất quyền đổi ca oan).
   */
  public pushShiftsTab(repo: { getShiftsForWeek(branch: string, weekMon: string): Promise<any[]> }): Promise<number> {
    return this.coalescedTabPush('shifts', () => this.doPushShiftsTab(repo));
  }

  private async doPushShiftsTab(repo: { getShiftsForWeek(branch: string, weekMon: string): Promise<any[]> }): Promise<number> {
    // Đẩy TOÀN BỘ lịch sử ca (không cắt ngày): giữ ca cũ bền vững trên Sheet để tab
    // Lịch lùi tuần + tính lương luôn đủ dữ liệu sau restart. '2000-01-01' = lấy tất cả.
    const shifts = dedupeShiftAssignments(await repo.getShiftsForWeek('*', '2000-01-01').catch(() => []));
    const shiftRows = (shifts || []).map((s: any) => [
      s.assignment_id,
      s.employee_id,
      s.branch_id,
      s.shift_code,
      sheetDateText(s.date),
      sheetDateTimeText(s.start_at),
      sheetDateTimeText(s.end_at),
      s.status || 'DRAFT',
      Number(s.schedule_version) || 1,
    ]);
    if (shiftRows.length === 0) {
      // ANTI-WIPE: bộ nhớ 0 ca (boot trước khi pull xong / vừa restart) mà ghi đè
      // là XÓA SẠCH tab PHAN_CONG_CA — sau đó restart nữa là mất lịch vĩnh viễn
      // (hiện tượng "thiếu rất nhiều ca" trên cổng quản trị). Im lặng bỏ qua:
      // dữ liệu trên Sheet giữ nguyên, lần push sau khi nhớ đủ sẽ ghi lại hết.
      console.warn('[GoogleSheetsSyncService] pushShiftsTab bỏ qua: bộ nhớ 0 ca (chống ghi đè rỗng phá lịch).');
      return 0;
    }
    await this.overwriteSheetData('PHAN_CONG_CA', SHEETS_DEFINITIONS.find(d => d.title === 'PHAN_CONG_CA')!.headers, shiftRows);
    return shiftRows.length;
  }

  /**
   * Đẩy riêng tab DON_NGHI_PHEP (await được): dùng sau mọi mutation OFF
   * (đăng ký/hủy/đồng bộ) để trạng thái CANCELLED/APPROVED bền vững trên Sheet
   * NGAY trong cùng request — pull nền sau đó không hồi sinh OFF đã hủy
   * (lịch lại báo ca trùng OFF oan).
   */
  public pushLeavesTab(repo: { listLeaveRequests(branch?: string, employee?: string): Promise<any[]> }): Promise<number> {
    return this.coalescedTabPush('leaves', () => this.doPushLeavesTab(repo));
  }

  private async doPushLeavesTab(repo: { listLeaveRequests(branch?: string, employee?: string): Promise<any[]> }): Promise<number> {
    const leaves = await repo.listLeaveRequests().catch(() => []);
    const leaveRows = (leaves || []).map((l: any) => ([
      l.request_id,
      l.employee_id,
      l.branch_id,
      l.leave_type,
      sheetDateText(l.requested_date),
      l.shift_code || '',
      l.reason,
      l.status,
      l.reviewed_by || '',
      l.review_note || '',
      l.created_at,
    ]));
    if (leaveRows.length === 0) {
      // ANTI-WIPE: bộ nhớ 0 phiếu (boot trước khi pull xong) — không ghi đè rỗng phá DON_NGHI_PHEP.
      console.warn('[GoogleSheetsSyncService] pushLeavesTab bỏ qua: bộ nhớ 0 phiếu (chống ghi đè rỗng).');
      return 0;
    }
    await this.overwriteSheetData('DON_NGHI_PHEP', SHEETS_DEFINITIONS.find(d => d.title === 'DON_NGHI_PHEP')!.headers, leaveRows);
    return leaveRows.length;
  }

  /**
   * Đẩy riêng tab SU_KIEN_DIEM_DANH (await được): dùng sau khi xóa vi phạm/phạt
   * trên lượt check-in/out để Sheet khớp ngay, pull sau không hồi sinh mức phạt cũ.
   */
  public async pushEventsTab(repo: { getAttendanceEvents(emp?: string, date?: string): Promise<any[]> }): Promise<number> {    const events = await repo.getAttendanceEvents('*', '*').catch(() => []);
    const rows = (events || []).map((e: any) => [
      e.event_id, e.assignment_id, e.employee_id, e.type, sheetDateTimeText(e.server_received_at),
      e.gps_latitude ?? '', e.gps_longitude ?? '', e.distance_meters ?? '', e.gps_status || '',
      e.drive_object_id || '', e.request_id || '', e.uniform_pink_ratio ?? '',
      sheetDateTimeText(e.client_time || ''),
      e.is_late ? 'YES' : '', e.is_early ? 'YES' : '', Number(e.minutes_deviation) || 0,
      e.fine_tier || 'NONE', Number(e.fine_amount) || 0,
    ]);
    // BETA partition: tab SU_KIEN_DIEM_DANH có thể đã chia part -> ghi qua các part
    await this.rewritePartitionedTab('SU_KIEN_DIEM_DANH', rows);
    return rows.length;
  }

  /**
   * Đẩy riêng tab FROM_NHAN_VIEN (await được): dùng sau khi xóa lịch PV trùng
   * để Sheet khớp ngay, pull sau đó không thể hồi sinh lịch đã xóa (fix zombie).
   */
  public async pushCandidatesTab(repo: { listCandidates(): Promise<any[]> }): Promise<number> {
    const candList = await repo.listCandidates().catch(() => []);
    const candHeaders = SHEETS_DEFINITIONS.find(d => d.title === 'FROM_NHAN_VIEN')!.headers;
    const candRows = (candList || []).map((c: any, idx: number) => [
      c.created_at || new Date().toISOString(),
      c.full_name || '',
      c.gender || 'Nam',
      (c as any).birth_year_raw || (c.birth_year ? String(c.birth_year) : '2002'),
      c.education_level || 'Đại học',
      c.hometown || 'TP. Hồ Chí Minh',
      c.phone || c.phone_normalized || '',
      c.registered_shift || 'Ca sáng / Ca chiều',
      c.branch_name || c.preferred_branch_id || 'CN130',
      c.experience || 'Chưa có kinh nghiệm',
      c.emergency_handling || 'Sẵn sàng hỗ trợ đột xuất',
      c.facebook_url || '',
      c.referral_source || 'Facebook Tuyển Dụng',
      c.ai_score !== undefined ? String(c.ai_score) : '12',
      c.screening_result || 'Đạt (Đủ điều kiện PV)',
      c.status || 'NEW',
      c.source_code || c.submission_id || `UBM_FORM_${String(idx + 1).padStart(4, '0')}`,
      (c as any).interview_date || '',
      (c as any).interview_time_slot || '',
      (c as any).interviewer_id || '',
      buildZaloInviteCell((c as any).zalo_invite_status, (c as any).zalo_invite_note),
      (c as any).zalo_invite_at || '',
      (c as any).interview_score ?? '',
      (c as any).interview_score_detail || '',
      (c as any).vip ? 'VIP' : '',
      (c as any).vip_rank !== undefined && (c as any).vip_rank !== null ? String((c as any).vip_rank) : '',
      (c as any).interview_decline_reason || '',
      (c as any).interview_proposed_date || '',
      (c as any).interview_proposed_time_slot || '',
      (c as any).interview_proposed_note || '',
      (c as any).blacklist_reason || '',
    ]);
    await this.overwriteSheetData('FROM_NHAN_VIEN', candHeaders, candRows, false, 'RAW');
    return candRows.length;
  }

  /** Upload buffer bất kỳ lên Google Drive (dùng lưu ZIP archive tuần chấm công). */
  public async uploadBufferToDrive(fileName: string, mimeType: string, buffer: Buffer): Promise<{ fileId: string; webViewLink?: string }> {
    if (!this.driveClient) {
      return { fileId: `DRV_${Date.now()}` };
    }
    try {
      const stream = Readable.from(buffer);
      const res = await this.sheetsCall(
        'drive.uploadBuffer',
        () =>
          this.driveClient!.files.create({
            requestBody: {
              name: fileName,
              parents: this.driveFolderId ? [this.driveFolderId] : undefined,
            },
            media: {
              mimeType,
              body: stream,
            },
            fields: 'id, webViewLink, webContentLink',
          }),
        60000
      );
      return {
        fileId: res.data.id || `DRV_${Date.now()}`,
        webViewLink: res.data.webViewLink || undefined,
      };
    } catch (err: any) {
      console.error('[GoogleSheetsSyncService] Lỗi upload buffer lên Drive:', err);
      return { fileId: `DRV_LOCAL_${Date.now()}` };
    }
  }

  // ---------------------------------------------------------------------------
  // Drive folder helpers — dùng cho backup tháng/ngày theo cấu trúc
  // backup_YYYY-MM/<TAB>/<YYYY-MM-DD>/... (xem services/monthly-backup.service.ts)
  // ---------------------------------------------------------------------------
  private driveFolderCache = new Map<string, string>();
  /** Cache folder chi nhánh đã xác minh quyền ghi (tránh gọi capabilities mỗi ảnh). */
  private attendanceFolderCache = new Map<string, string>();

  /** Drive đã sẵn sàng ghi chưa (Drive API hoặc webhook chạy dưới quyền chủ thư mục). */
  public isDriveReady(): boolean {
    return !!this.driveClient || !!String(process.env.GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL || '').trim();
  }

  /** Tìm hoặc tạo 1 folder theo tên trong parentId (cache trong RAM 1 phiên). */
  public async ensureDriveFolder(name: string, parentId?: string): Promise<string> {
    const clean = String(name || '').trim();
    if (!clean || !this.driveClient) return '';
    const parent = String(parentId || '');
    const cacheKey = `${parent}|${clean}`;
    const cached = this.driveFolderCache.get(cacheKey);
    if (cached) return cached;
    const escaped = clean.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = `name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parent ? ` and '${parent}' in parents` : ''}`;
    try {
      const listed: any = await this.sheetsCall(
        'drive.findFolder',
        () => this.driveClient!.files.list({
          q,
          fields: 'files(id,name)',
          pageSize: 10,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        } as any),
        30000
      );
      const hit = listed?.data?.files?.[0]?.id;
      if (hit) {
        this.driveFolderCache.set(cacheKey, hit);
        return hit;
      }
      const created: any = await this.sheetsCall(
        'drive.createFolder',
        () => this.driveClient!.files.create({
          requestBody: {
            name: clean,
            mimeType: 'application/vnd.google-apps.folder',
            parents: parent ? [parent] : undefined,
          },
          fields: 'id',
          supportsAllDrives: true,
        } as any),
        30000
      );
      const id = created?.data?.id || '';
      if (id) this.driveFolderCache.set(cacheKey, id);
      return id;
    } catch (err: any) {
      console.warn(`[GoogleSheetsSyncService] Không tạo được folder Drive "${clean}":`, err?.message || err);
      return '';
    }
  }

  /** Tạo/tìm chuỗi folder lồng nhau; trả ID folder cuối cùng ('' nếu lỗi). */
  public async ensureDriveFolderPath(segments: string[], rootId?: string): Promise<string> {
    let parent = String(rootId || this.driveFolderId || '');
    for (const seg of segments || []) {
      const s = String(seg || '').trim();
      if (!s) continue;
      const id = await this.ensureDriveFolder(s, parent || undefined);
      if (!id) return '';
      parent = id;
    }
    return parent;
  }

  /** Kiểm tra tài khoản Drive hiện tại có quyền thêm file/folder con. */
  private async canAddChildren(folderId: string): Promise<boolean | null> {
    if (!this.driveClient || !folderId) return false;
    try {
      const meta: any = await this.sheetsCall(
        'drive.folderCapabilities',
        () => this.driveClient!.files.get({
          fileId: folderId,
          fields: 'id, capabilities(canAddChildren)',
          supportsAllDrives: true,
        } as any),
        20000,
      );
      const can = meta?.data?.capabilities?.canAddChildren;
      return typeof can === 'boolean' ? can : null;
    } catch (err: any) {
      const status = Number(err?.response?.status ?? err?.code);
      if (status === 404) return false;
      return null;
    }
  }

  /**
   * Folder chi nhánh thực sự ghi được trong "04. ĐIỂM DANH".
   * Nếu ID cấu hình không truy cập/ghi được (Drive khác, chưa share) thì tự tạo
   * thư mục chi nhánh dưới thư mục gốc để ảnh vẫn lên Drive thay vì DRV_LOCAL.
   */
  public async resolveAttendanceFolderId(branchId?: string): Promise<string> {
    const cacheKey = String(branchId || 'DEFAULT').trim().toUpperCase() || 'DEFAULT';
    const cached = this.attendanceFolderCache.get(cacheKey);
    if (cached) return cached;

    const configured = getAttendanceFolderForBranch(branchId);
    const root = getAttendanceRootFolder();
    for (const id of Array.from(new Set([configured, root].filter(Boolean)))) {
      if (await this.canAddChildren(id) === true) {
        this.attendanceFolderCache.set(cacheKey, id);
        return id;
      }
    }

    if (root && await this.canAddChildren(root) !== false) {
      const created = await this.ensureDriveFolder(getAttendanceBranchLabel(branchId), root).catch(() => '');
      if (created) {
        this.attendanceFolderCache.set(cacheKey, created);
        return created;
      }
    }
    return configured || root;
  }

  /** Upload/ghi đè 1 file vào đường dẫn folder (idempotent theo tên file). */
  public async upsertBufferToDrivePath(
    fileName: string,
    mimeType: string,
    buffer: Buffer,
    segments: string[],
    rootId?: string,
  ): Promise<{ fileId: string; webViewLink?: string }> {
    const safeName = String(fileName || 'file').replace(/[\\/:*?"<>|]/g, '-').trim() || 'file';

    // Webhook (nếu cấu hình) chạy dưới quyền CHỦ thư mục: tự tạo cây thư mục
    // con + ghi file, không phụ thuộc quota của Service Account.
    const webhookRoot = String(rootId || this.driveFolderId || '').trim();
    if (webhookRoot) {
      const webhook = await uploadBufferViaDriveWebhook({
        folderId: webhookRoot,
        segments,
        fileName: safeName,
        mimeType,
        buffer,
      });
      if (webhook?.fileId) {
        this.markDriveUploadOk();
        return { fileId: webhook.fileId, webViewLink: webhook.webViewLink };
      }
    }

    if (!this.driveClient) {
      this.markDriveUploadError('DRIVE_NOT_CONFIGURED');
      return { fileId: `DRV_${Date.now()}` };
    }
    const parent = await this.ensureDriveFolderPath(segments, rootId);
    if (!parent) {
      this.markDriveUploadError('DRIVE_FOLDER_NOT_FOUND');
      return { fileId: `DRV_LOCAL_${Date.now()}` };
    }

    const escaped = safeName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = `name = '${escaped}' and trashed = false and '${parent}' in parents`;
    try {
      const listed: any = await this.sheetsCall(
        'drive.findFile',
        () => this.driveClient!.files.list({
          q,
          fields: 'files(id,name)',
          pageSize: 5,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        } as any),
        30000
      );
      const existingId = listed?.data?.files?.[0]?.id;
      if (existingId) {
        await this.sheetsCall(
          'drive.updateFile',
          () => this.driveClient!.files.update({
            fileId: existingId,
            media: { mimeType, body: Readable.from(buffer) },
            fields: 'id, webViewLink',
            supportsAllDrives: true,
          } as any),
          120000
        );
        this.markDriveUploadOk();
        return { fileId: existingId };
      }
      const created: any = await this.sheetsCall(
        'drive.createFile',
        () => this.driveClient!.files.create({
          requestBody: { name: safeName, parents: [parent] },
          media: { mimeType, body: Readable.from(buffer) },
          fields: 'id, webViewLink',
          supportsAllDrives: true,
        } as any),
        120000
      );
      this.markDriveUploadOk();
      return {
        fileId: created?.data?.id || `DRV_${Date.now()}`,
        webViewLink: created?.data?.webViewLink || undefined,
      };
    } catch (err: any) {
      const errMsg = String(err?.message || err);
      if (errMsg.includes('storage quota') || errMsg.includes('Service Accounts do not have storage quota')) {
        console.warn(`[GoogleSheetsSyncService] Service Account có quota 0 byte trên Drive cá nhân. Đặt GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN hoặc GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL để ảnh lên Drive. Ảnh vẫn được lưu đệm đĩa VPS an toàn.`);
      } else {
        console.warn(`[GoogleSheetsSyncService] Upload Drive "${safeName}" lỗi:`, err?.message || err);
      }
      this.markDriveUploadError(err);
      return { fileId: `DRV_LOCAL_${Date.now()}` };
    }
  }

  /** Upload 1 file MỚI vào đường dẫn folder (không dò trùng — dùng lúc chấm công). */
  public async uploadBufferToDrivePath(
    fileName: string,
    mimeType: string,
    buffer: Buffer,
    segments: string[],
    rootId?: string,
  ): Promise<{ fileId: string; webViewLink?: string }> {
    const safeName = String(fileName || 'file').replace(/[\\/:*?"<>|]/g, '-').trim() || 'file';

    const webhookRoot = String(rootId || this.driveFolderId || '').trim();
    if (webhookRoot) {
      const webhook = await uploadBufferViaDriveWebhook({
        folderId: webhookRoot,
        segments,
        fileName: safeName,
        mimeType,
        buffer,
      });
      if (webhook?.fileId) {
        this.markDriveUploadOk();
        return { fileId: webhook.fileId, webViewLink: webhook.webViewLink };
      }
    }

    if (!this.driveClient) {
      this.markDriveUploadError('DRIVE_NOT_CONFIGURED');
      return { fileId: `DRV_${Date.now()}` };
    }
    const parent = await this.ensureDriveFolderPath(segments, rootId);
    if (!parent) {
      this.markDriveUploadError('DRIVE_FOLDER_NOT_FOUND');
      return { fileId: `DRV_LOCAL_${Date.now()}` };
    }

    try {
      const created: any = await this.sheetsCall(
        'drive.createFilePath',
        () => this.driveClient!.files.create({
          requestBody: { name: safeName, parents: [parent] },
          media: { mimeType, body: Readable.from(buffer) },
          fields: 'id, webViewLink',
          supportsAllDrives: true,
        } as any),
        120000
      );
      this.markDriveUploadOk();
      return {
        fileId: created?.data?.id || `DRV_${Date.now()}`,
        webViewLink: created?.data?.webViewLink || undefined,
      };
    } catch (err: any) {
      console.warn(`[GoogleSheetsSyncService] Upload Drive "${safeName}" lỗi:`, err?.message || err);
      this.markDriveUploadError(err);
      return { fileId: `DRV_LOCAL_${Date.now()}` };
    }
  }

  /**
   * Tìm các file Drive của 1 phiếu bù công theo mã phiếu (mọi ngày/thư mục).
   * Dùng khi cập nhật trạng thái để ghi đè đúng file txt cũ, không tạo file trùng
   * khi `created_at` bị lệch sau restart/pull.
   */
  private async findAdjustmentDriveFiles(adjId: string, ext: string): Promise<Array<{ id: string; name: string; parentId: string }>> {
    if (!this.driveClient || !adjId) return [];
    const escaped = adjId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    try {
      const listed: any = await this.sheetsCall(
        'drive.findAdjustmentFiles',
        () => this.driveClient!.files.list({
          q: `name contains '${escaped}' and trashed = false`,
          fields: 'files(id,name,parents)',
          pageSize: 50,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          corpora: 'allDrives',
        } as any),
        30000,
      );
      const files = listed?.data?.files || [];
      return files
        .filter((f: any) => f?.id && (f?.parents || [])[0] && (!ext || String(f.name || '').endsWith(ext)))
        .map((f: any) => ({ id: String(f.id), name: String(f.name || ''), parentId: String(f.parents[0]) }));
    } catch (err: any) {
      console.warn('[AdjustmentDrive] Tìm file phiếu cũ lỗi:', err?.message || err);
      return [];
    }
  }

  /**
   * ĐỒNG BỘ REALTIME PHIẾU BỔ SUNG CÔNG LÊN DRIVE (folder 06. PHIẾU BỔ SUNG CÔNG).
   *
   * Cấu trúc:
   *   06. PHIẾU BỔ SUNG CÔNG/<YYYY-MM-DD ngày gửi>/<Tên NV - Mã NV>/
   *     PHIEU_<HH-mm>_<adjustment_id>.txt   (Lý do & số phút + trạng thái + link ảnh)
   *     ANH_<HH-mm>_<adjustment_id>.jpg     (ảnh bằng chứng, nếu có)
   *
   * Gọi khi HR DUYỆT phiếu (ảnh bằng chứng + file txt trạng thái "Đã duyệt").
   * Phiếu chờ duyệt / bị từ chối / tự động từ chối (hết hạn) KHÔNG đẩy lên Drive.
   * Không ném lỗi ra ngoài: Drive chậm/hỏng không được làm hỏng luồng phiếu.
   */
  public async syncAdjustmentRequestToDrive(opts: {
    adjustment: any;
    employee?: { full_name?: string; employee_code?: string } | null;
    photoBase64?: string;
  }): Promise<{
    ok: boolean;
    skipped?: boolean;
    folderId?: string;
    imageFileId?: string;
    txtFileId?: string;
    error?: string;
  }> {
    const adj = opts.adjustment || {};
    const adjId = String(adj.adjustment_id || '').trim();
    if (!adjId) return { ok: false, error: 'ADJUSTMENT_ID_REQUIRED' };
    // Chỉ phiếu ĐÃ DUYỆT mới hiển thị trên Drive; phiếu chờ duyệt / từ chối /
    // tự động từ chối (hết hạn) bỏ qua hoàn toàn.
    if (!shouldSyncAdjustmentToDrive(adj)) return { ok: true, skipped: true };
    const rootId = getAdjustmentRequestsFolder();
    if (!rootId || !this.driveClient) return { ok: false, error: 'DRIVE_NOT_CONFIGURED' };

    const loc = adjustmentDriveLocation(adj, opts.employee, Date.now());
    const { hhmm: locHhmm, segments } = loc;

    // Ưu tiên ghi đè file txt đã có của đúng phiếu (tránh sinh file trùng khi
    // created_at lệch sau restart/pull), giữ nguyên thư mục ngày ban đầu.
    const existingTxtFiles = await this.findAdjustmentDriveFiles(adjId, '.txt');
    const existingTxt = existingTxtFiles[0] || null;
    const hhmm = hhmmFromAdjustmentFileName(existingTxt?.name) || locHhmm;

    let folderId = '';
    try {
      folderId = existingTxt?.parentId
        || await this.ensureDriveFolderPath(segments, rootId);
    } catch (err: any) {
      return { ok: false, error: String(err?.message || err) };
    }
    if (!folderId) return { ok: false, error: 'DRIVE_FOLDER_NOT_FOUND' };

    let imageFileId = String(adj.evidence_drive_id || '').trim();
    if (opts.photoBase64) {
      try {
        const raw = String(opts.photoBase64);
        const m = raw.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.*)$/s);
        const mime = m ? m[1] : 'image/jpeg';
        const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
        const buf = Buffer.from(m ? m[2] : raw.replace(/^data:[^;,]+;base64,/, ''), 'base64');
        if (buf.length > 0) {
          const up = await this.upsertBufferToDrivePath(
            `ANH_${hhmm}_${adjSafeSeg(adjId, 'PHIEU')}.${ext}`,
            mime,
            buf,
            [],
            folderId,
          );
          if (up?.fileId && !String(up.fileId).startsWith('DRV_')) imageFileId = String(up.fileId);
        }
      } catch (err: any) {
        console.warn('[AdjustmentDrive] Upload ảnh bằng chứng lỗi:', err?.message || err);
      }
    }

    const txtName = existingTxt?.name || `PHIEU_${hhmm}_${adjSafeSeg(adjId, 'PHIEU')}.txt`;

    try {
      const up = await this.upsertBufferToDrivePath(
        txtName,
        'text/plain; charset=utf-8',
        Buffer.from(buildAdjustmentRequestTxt(adj, opts.employee, imageFileId, Date.now()), 'utf8'),
        [],
        folderId,
      );
      const txtFileId = String(up?.fileId || '');
      const ok = !!txtFileId && !txtFileId.startsWith('DRV_');
      if (!ok) return { ok: false, folderId, imageFileId: imageFileId || undefined, error: 'DRIVE_UPLOAD_FAILED' };
      // Dọn file txt trùng của cùng phiếu (bản cũ trước khi fix) để chỉ còn
      // đúng 1 file trạng thái mới nhất.
      for (const f of existingTxtFiles.slice(1)) {
        if (f.id === txtFileId) continue;
        try {
          await this.driveClient!.files.delete({ fileId: f.id, supportsAllDrives: true } as any);
        } catch { /* best-effort */ }
      }
      this.markDriveUploadOk?.();
      return { ok: true, folderId, imageFileId: imageFileId || undefined, txtFileId };
    } catch (err: any) {
      this.markDriveUploadError?.(err);
      return { ok: false, folderId, imageFileId: imageFileId || undefined, error: String(err?.message || err) };
    }
  }


  /** Đọc toàn bộ dòng (kể cả header) của 1 tab, gộp mọi part nếu tab partition. */
  public async readTabRows(title: string): Promise<string[][]> {
    const t = String(title || '').trim();
    if (!t) return [];
    if (GoogleSheetsSyncService.PARTITION_TABS.has(t)) {
      return this.readPartitionedRows(t).catch(() => [] as string[][]);
    }
    if (!this.sheetsClient) return [];
    try {
      const res = await this.sheetsCall(
        `read.${t}`,
        () => this.sheetsClient!.spreadsheets.values.get({
          spreadsheetId: getSpreadsheetIdForTab(t, this.spreadsheetId),
          range: `'${t}'!A:AZ`,
          ...SHEETS_READ_OPTIONS,
        }),
        60000
      );
      return (res?.data?.values || []) as string[][];
    } catch (err: any) {
      console.warn(`[GoogleSheetsSyncService] Đọc tab ${t} lỗi:`, err?.message || err);
      return [];
    }
  }

  /**
   * Tải ảnh chấm công lên Google Drive thật
   */
  private lastDriveUploadError: string | null = null;
  private lastDriveUploadAt: string | null = null;
  private lastDriveUploadOkAt: string | null = null;

  public getDriveUploadStatus() {
    return {
      driveFolderId: this.driveFolderId || null,
      attendanceRootFolderId: getAttendanceRootFolder() || null,
      driveConfigured: !!this.driveClient,
      authMode: this.driveAuthMode,
      authAccount: this.driveAuthAccount || null,
      authLabel: describeDriveAuth(this.driveAuthMode, this.driveAuthAccount),
      webhookConfigured: !!String(process.env.GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL || '').trim(),
      lastError: this.lastDriveUploadError,
      lastAttemptAt: this.lastDriveUploadAt,
      lastOkAt: this.lastDriveUploadOkAt,
    };
  }

  /** Ghi nhận lỗi/thành công gần nhất để hiện ở /health + tab chẩn đoán. */
  private markDriveUploadError(err: any) {
    this.lastDriveUploadError = describeGoogleApiError(err);
    this.lastDriveUploadAt = new Date().toISOString();
  }

  private markDriveUploadOk() {
    this.lastDriveUploadError = null;
    this.lastDriveUploadAt = new Date().toISOString();
    this.lastDriveUploadOkAt = this.lastDriveUploadAt;
  }

  /**
   * Upload hợp đồng lao động lên Google Drive.
   *
   * Mặc định giữ tương thích cũ: ghi vào HOP_DONG_LAO_DONG. Khi truyền opts,
   * caller có thể chỉ định đúng cây thư mục (05. HỒ SƠ NHÂN VIÊN/<Chi nhánh>/
   * <Tên NV - Mã NV>) để hồ sơ nằm đúng cấu trúc.
   */
  public async uploadContractToDrive(
    fileName: string,
    mimeType: string,
    bufferOrBase64: Buffer | string,
    opts?: { segments?: string[]; rootId?: string },
  ): Promise<{ fileId: string; webViewLink?: string }> {
    const buffer = Buffer.isBuffer(bufferOrBase64)
      ? bufferOrBase64
      : Buffer.from(String(bufferOrBase64 || '').replace(/^data:[^;,]+;base64,/, ''), 'base64');
    if (!buffer.length) {
      return { fileId: `DRV_LOCAL_${Date.now()}` };
    }
    const segments = opts?.segments?.length ? opts.segments : ['HOP_DONG_LAO_DONG'];
    try {
      const res = await this.upsertBufferToDrivePath(fileName, mimeType, buffer, segments, opts?.rootId);
      if (res?.fileId && !res.fileId.startsWith('DRV_')) {
        return res;
      }
    } catch (err: any) {
      console.warn('[GoogleSheetsSyncService] uploadContractToDrive qua upsertBufferToDrivePath lỗi, thử fallback:', err?.message || err);
    }
    // Fallback: upload thẳng vào root driveFolderId
    return this.uploadFileToDrive(fileName, mimeType, buffer.toString('base64'));
  }

  /**
   * Upload hồ sơ nhân viên (hợp đồng/CCCD) vào đúng cấu trúc:
   *   05. HỒ SƠ NHÂN VIÊN / <Chi nhánh> / <Tên NV - Mã NV> / <file>
   *
   * Ưu tiên thư mục 05 đã cấu hình. Nếu Drive hiện tại không truy cập được
   * thư mục đó (môi trường khác), tự tạo "05. HỒ SƠ NHÂN VIÊN" dưới thư mục
   * gốc Drive để không rơi về đĩa VPS.
   */
  public async uploadEmployeeProfileToDrive(
    fileName: string,
    mimeType: string,
    buffer: Buffer,
    segments: string[],
  ): Promise<{ fileId: string; webViewLink?: string }> {
    if (!buffer?.length) return { fileId: `DRV_LOCAL_${Date.now()}` };

    const configured = getEmployeeProfilesFolder();
    if (configured) {
      const res = await this.upsertBufferToDrivePath(fileName, mimeType, buffer, segments, configured);
      if (res?.fileId && !res.fileId.startsWith('DRV_')) return res;
    }

    // Fallback: tìm/tạo "05. HỒ SƠ NHÂN VIÊN" dưới thư mục gốc Drive hiện tại.
    const fallbackRoot = String(this.driveFolderId || getDriveDatabaseRootFolder()).trim();
    if (fallbackRoot && fallbackRoot !== configured) {
      const res = await this.upsertBufferToDrivePath(
        fileName,
        mimeType,
        buffer,
        [DRIVE_EMPLOYEE_PROFILES_FOLDER_NAME, ...segments],
        fallbackRoot,
      );
      if (res?.fileId && !res.fileId.startsWith('DRV_')) return res;
    }

    return { fileId: `DRV_LOCAL_${Date.now()}` };
  }

  public async uploadImageToDrive(fileName: string, mimeType: string, base64Data: string): Promise<{ fileId: string; webViewLink?: string }> {
    return this.uploadFileToDrive(fileName, mimeType, base64Data);
  }

  /**
   * Upload 1 file bất kỳ (ảnh, PDF, DOCX...) lên Drive. Nhận base64 thuần hoặc
   * data URL (`data:application/pdf;base64,...`) — trước đây chỉ bóc prefix
   * `data:image/*` nên hợp đồng PDF sẽ bị hỏng base64.
   */
  public async uploadFileToDrive(fileName: string, mimeType: string, base64Data: string): Promise<{ fileId: string; webViewLink?: string }> {
    const cleanBase64 = String(base64Data || '').replace(/^data:[^;,]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    if (!buffer.length) {
      this.lastDriveUploadError = 'EMPTY_FILE: file rỗng, không thể upload Drive';
      return { fileId: `DRV_LOCAL_${Date.now()}` };
    }

    // Webhook chạy dưới quyền chủ thư mục — dùng được cả khi SA hết quota.
    if (this.driveFolderId) {
      const webhook = await uploadBufferViaDriveWebhook({
        folderId: this.driveFolderId,
        fileName,
        mimeType,
        buffer,
      });
      if (webhook?.fileId) {
        this.markDriveUploadOk();
        return { fileId: webhook.fileId, webViewLink: webhook.webViewLink };
      }
    }

    if (!this.driveClient) {
      this.lastDriveUploadError = 'DRIVE_NOT_CONFIGURED: chưa cấu hình service account Drive hoặc OAuth2';
      return { fileId: `DRV_${Date.now()}` };
    }
    // Thử lại 3 lần (mạng Render free chập chờn, file 5MB) trước khi bỏ cuộc.
    let lastErr: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const stream = Readable.from(buffer);
        const res = await this.sheetsCall(
          `drive.upload#${attempt}`,
          () =>
            this.driveClient!.files.create({
              requestBody: {
                name: fileName,
                parents: this.driveFolderId ? [this.driveFolderId] : undefined,
              },
              media: {
                mimeType,
                body: stream,
              },
              fields: 'id, webViewLink, webContentLink',
              supportsAllDrives: true,
            } as any),
          60000
        );

        console.log(`[GoogleSheetsSyncService] Đã upload ảnh lên Google Drive thành công: ID = ${res.data.id}`);
        this.markDriveUploadOk();

        return {
          fileId: res.data.id || `DRV_${Date.now()}`,
          webViewLink: res.data.webViewLink || undefined,
        };
      } catch (err: any) {
        lastErr = err;
        console.warn(`[GoogleSheetsSyncService] Upload Drive lần ${attempt} thất bại:`, err?.message || err);
        if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 2000));
      }
    }
    this.markDriveUploadError(lastErr);
    console.error('[GoogleSheetsSyncService] Upload Drive thất bại sau 3 lần:', this.lastDriveUploadError);
    return { fileId: `DRV_LOCAL_${Date.now()}` };
  }

  /** Xóa file trên Drive (best-effort, dùng khi thay/gỡ hợp đồng). */
  public async deleteDriveFile(fileId: string): Promise<boolean> {
    const id = String(fileId || '').trim();
    if (!this.driveClient || !id || id.startsWith('DRV_')) return false;
    try {
      await this.sheetsCall(
        'drive.delete',
        () => this.driveClient!.files.delete({ fileId: id, supportsAllDrives: true } as any),
        30000,
      );
      return true;
    } catch (err: any) {
      console.warn('[GoogleSheetsSyncService] Xóa file Drive thất bại:', err?.message || err);
      return false;
    }
  }

  private static safeZipName(s: string): string {
    return String(s || 'Chua ro').replace(/[\\/:*?"<>|]/g, '-').trim() || 'Chua ro';
  }

  /**
   * Dựng entries ZIP cho 1 ngày: {root}/{chi nhánh}/{ca}/{tên NV}/check in|out.jpg.
   * CHỈ ảnh thật từ camera NV (không kèm file excel/CSV).
   */
  public async attendanceZipEntriesForDate(
    repo: ISheetsRepository,
    date: string,
    root: string
  ): Promise<{ entries: ZipEntry[]; eventCount: number; photoCount: number; missing: string[] }> {
    const safe = GoogleSheetsSyncService.safeZipName;
    const vnDay = (iso: string) => {
      const t = new Date(iso || '').getTime();
      if (!Number.isFinite(t)) return '';
      return new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
    };
    const events: any[] = (await repo.getAttendanceEvents(undefined, date).catch(() => []))
      .filter((e: any) => vnDay(e.client_time || '') === date);
    const employees = await repo.listEmployees().catch(() => []);
    const empOf = (id: string) => (employees as any[]).find(e => e.employee_id === id);
    const entries: ZipEntry[] = [];
    const missing: string[] = [];
    let photoCount = 0;
    const byAssign = new Map<string, any[]>();
    for (const e of events || []) {
      if (e.type !== 'CHECK_IN' && e.type !== 'CHECK_OUT') continue;
      const k = e.assignment_id || `${e.employee_id}__${e.type}`;
      if (!byAssign.has(k)) byAssign.set(k, []);
      byAssign.get(k)!.push(e);
    }
    for (const [, group] of byAssign) {
      const first = group[0];
      const emp = empOf(first.employee_id);
      const empName = safe(emp?.full_name || first.employee_id);
      const empCode = safe(emp?.employee_code || first.employee_id);
      let shiftCode = 'Chua phan ca';
      try {
        const sh: any = first.assignment_id ? await (repo as any).getShiftById(first.assignment_id).catch(() => null) : null;
        if (sh?.shift_code) shiftCode = safe(String(sh.shift_code).replace('CA_1', 'Ca 1 (07-12)').replace('CA_2', 'Ca 2 (12-18)').replace('CA_3', 'Ca 3 (18-23)'));
      } catch { /* giữ mặc định */ }
      const branch = safe(first.branch_id || emp?.default_branch_id || 'CN');
      const folder = `${root}/${branch}/${shiftCode}/${empName} (${empCode})`;
      const inEvt = group.find((e: any) => e.type === 'CHECK_IN');
      const outEvt = group.find((e: any) => e.type === 'CHECK_OUT');
      const loadPhoto = async (evt: any, fname: string) => {
        if (!evt?.drive_object_id || String(evt.drive_object_id).startsWith('DRV_')) {
          missing.push(`${evt?.event_id || '?'}: chua co file Drive`);
          return;
        }
        try {
          const dl = await this.downloadDriveFile(evt.drive_object_id);
          if (dl?.buffer?.length) {
            entries.push({ name: fname, data: dl.buffer });
            photoCount++;
            return;
          }
          missing.push(`${evt?.event_id || '?'}: tai Drive rong`);
        } catch (err: any) {
          missing.push(`${evt?.event_id || '?'}: loi tai Drive (${err?.message || err})`);
        }
      };
      if (inEvt) await loadPhoto(inEvt, `${folder}/check in.jpg`);
      if (outEvt) await loadPhoto(outEvt, `${folder}/check out.jpg`);
    }
    return { entries, eventCount: (events || []).length, photoCount, missing };
  }

  /**
   * Gói 1 ngày công đầy đủ: CSV full info + ảnh check in/out theo folder
   * {root}/{chi nhánh}/{tên NV}/{ca} (mỗi ca có file txt) — cho nút download
   * ở tab Lịch Làm Việc Tuần & Giám Sát Điểm Danh Realtime (về máy local).
   */
  public async buildDayWorkExport(
    repo: ISheetsRepository,
    date: string
  ): Promise<{ zip: Buffer; entries: ZipEntry[]; root: string; shifts: number; events: number; photos: number; missing: string[] }> {
    const safe = GoogleSheetsSyncService.safeZipName;
    const fmtD = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
    const root = `Ngay cong ${fmtD(date)}`;
    const vnDay = (iso: string) => {
      const t = new Date(iso || '').getTime();
      if (!Number.isFinite(t)) return '';
      return new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
    };
    const fmtDT = (iso?: string) => {
      if (!iso) return '';
      try {
        return new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
      } catch { return ''; }
    };
    const shiftLabel = (code?: string) => {
      const c = String(code || '');
      if (!c) return 'Ngoai lich';
      return safe(c.replace('CA_1', 'Ca 1 (07-12)').replace('CA_2', 'Ca 2 (12-18)').replace('CA_3', 'Ca 3 (18-23)'));
    };
    const [y, m, d0] = date.split('-').map(Number);
    const base = Date.UTC(y, m - 1, d0);
    const dowMon0 = (new Date(base).getUTCDay() + 6) % 7;
    const mon = new Date(base - dowMon0 * 86_400_000).toISOString().slice(0, 10);
    const weekShifts: any[] = await repo.getShiftsForWeek('*', mon).catch(() => []);
    const dayShifts = (weekShifts || []).filter((s: any) =>
      String((s as any)?.date || '').slice(0, 10) === date && (s as any)?.status !== 'CANCELLED');
    const events: any[] = (await repo.getAttendanceEvents(undefined, date).catch(() => []))
      .filter((e: any) => vnDay(e.client_time || '') === date);
    const employees: any[] = await repo.listEmployees().catch(() => []);
    const empOf = (id: string) => (employees as any[]).find((e: any) => e.employee_id === id);
    const evByAssign = new Map<string, any[]>();
    for (const e of events || []) {
      if (e.type !== 'CHECK_IN' && e.type !== 'CHECK_OUT' && e.type !== 'ABSENT') continue;
      const k = (e as any).assignment_id || `__${(e as any).employee_id}`;
      if (!evByAssign.has(k)) evByAssign.set(k, []);
      evByAssign.get(k)!.push(e);
    }
    const entries: ZipEntry[] = [];
    const missing: string[] = [];
    let photoCount = 0;
    const rows: string[][] = [];
    const loadPhoto = async (evt: any): Promise<Buffer | null> => {
      if (!evt) return null;
      const id = String(evt.drive_object_id || '');
      if (id && !id.startsWith('DRV_')) {
        try {
          const dl = await this.downloadDriveFile(evt.drive_object_id);
          if (dl?.buffer?.length) return dl.buffer;
        } catch { missing.push(`${evt.event_id}: loi tai Drive`); }
      }
      const inline = (evt as any).event_photo;
      if (inline) {
        try {
          const mm = String(inline).match(/^data:(image\/\w+);base64,(.*)$/s);
          const buf = Buffer.from(mm ? mm[2] : String(inline).replace(/^data:image\/\w+;base64,/, ''), 'base64');
          if (buf.length) return buf;
        } catch { /* xuong dia */ }
      }
      try {
        const hit = readAttendancePhotoDisk(evt.event_id);
        if (hit?.buffer?.length) return hit.buffer;
      } catch { /* het nguon */ }
      missing.push(`${evt.event_id}: chua co anh`);
      return null;
    };
    const seenAssign = new Set<string>();
    const pushShiftRow = async (sh: any | null, groupKey: string, empId: string, branchHint?: string) => {
      const list = evByAssign.get(groupKey) || [];
      const inEvt = list.find((e: any) => e.type === 'CHECK_IN');
      const outEvt = list.find((e: any) => e.type === 'CHECK_OUT');
      const absEvt = list.find((e: any) => e.type === 'ABSENT');
      const emp = empOf(empId);
      const empName = emp?.full_name || empId;
      const empCode = emp?.employee_code || empId;
      const branch = (sh as any)?.branch_id || branchHint || emp?.default_branch_id || 'CN';
      const code = (sh as any)?.shift_code || '';
      const status = inEvt && outEvt ? 'Hoan thanh' : inEvt ? 'Dang lam (cho check-out)' : absEvt ? 'Vang' : 'Chua check-in';
      const dist = inEvt?.distance_meters ?? outEvt?.distance_meters ?? '';
      const lateMin = inEvt?.is_late ? Number(inEvt.minutes_deviation) || 0 : 0;
      rows.push([
        empName, empCode, branch,
        code ? code.replace('CA_1', 'Ca 1').replace('CA_2', 'Ca 2').replace('CA_3', 'Ca 3') : 'Ngoai lich',
        fmtDT(inEvt?.client_time), fmtDT(outEvt?.client_time), status,
        inEvt ? 'GPS hop le' : '', dist === '' ? '' : `${dist}m`,
        inEvt?.uniform_pink_ratio ?? '',
        lateMin > 0 ? `Tre ${lateMin}p` : '',
      ]);
      // Folder: chi nhánh -> tên NV -> ca làm -> ảnh + file txt.
      const caName = code ? code.replace('CA_1', 'Ca 1').replace('CA_2', 'Ca 2').replace('CA_3', 'Ca 3') : 'Ngoai lich';
      const folder = `${root}/${safe(branch)}/${safe(empName)} (${safe(empCode)})/${shiftLabel(code)}`;
      const txtLines = [
        `Nhan vien: ${empName} (${empCode})`,
        `Chi nhanh: ${branch}`,
        `Ca lam: ${caName}`,
        `Ngay: ${fmtD(date)}`,
        `Gio vao: ${fmtDT(inEvt?.client_time) || 'Chua check-in'}`,
        `Gio ra: ${fmtDT(outEvt?.client_time) || 'Chua check-out'}`,
        `Trang thai: ${status}`,
        `GPS: ${inEvt ? 'hop le' : 'Chua co'}`,
        `Khoang cach: ${dist === '' ? 'Chua co' : `${dist}m`}`,
        `Hong dong phuc: ${inEvt?.uniform_pink_ratio ?? 'Chua co'}`,
        `Ghi chu: ${lateMin > 0 ? `Tre ${lateMin}p` : ''}`,
      ];
      entries.push({ name: `${folder}/thong tin ca ${fmtD(date)}.txt`, data: Buffer.from(txtLines.join('\r\n'), 'utf8') });
      if (inEvt) {
        const buf = await loadPhoto(inEvt);
        if (buf) { entries.push({ name: `${folder}/check in.jpg`, data: buf }); photoCount++; }
      }
      if (outEvt) {
        const buf = await loadPhoto(outEvt);
        if (buf) { entries.push({ name: `${folder}/check out.jpg`, data: buf }); photoCount++; }
      }
    };
    for (const s of dayShifts) {
      const aid = String((s as any).assignment_id);
      seenAssign.add(aid);
      await pushShiftRow(s, aid, (s as any).employee_id);
    }
    for (const [k, list] of evByAssign) {
      if (seenAssign.has(k)) continue;
      const first = list[0];
      await pushShiftRow(null, k, first.employee_id, first.branch_id);
    }
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Nhan vien', 'Ma NV', 'Chi nhanh', 'Ca', 'Gio vao', 'Gio ra', 'Trang thai', 'GPS', 'Khoang cach', 'Hong dong phuc (%)', 'Ghi chu'];
    const csv = '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
    entries.unshift({ name: `${root}/Thong tin ngay cong ${fmtD(date)}.csv`, data: Buffer.from(csv, 'utf8') });
    return { zip: buildZipStore(entries), entries, root, shifts: dayShifts.length, events: events.length, photos: photoCount, missing };
  }

  /**
   * Gói 1 tuần công đầy đủ (T2–CN): mỗi ngày 1 cụm như ngày lẻ (CSV full info
   * + ảnh + txt theo folder chi nhánh–NV–ca) — cho nút "Tải tuần" ở tab Lịch
   * Làm Việc Tuần. Bỏ qua ngày trắng (không ca, không lượt điểm danh).
   */
  public async buildWorkWeekExport(
    repo: ISheetsRepository,
    weekMon: string
  ): Promise<{ zip: Buffer; root: string; dates: string[]; shifts: number; events: number; photos: number; missing: string[] }> {
    const [y, m, d0] = weekMon.split('-').map(Number);
    const base = Date.UTC(y, m - 1, d0);
    const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);
    const fmtD = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
    const weekSun = isoOf(base + 6 * 86_400_000);
    const root = `Tuan cong ${fmtD(weekMon)} den ${fmtD(weekSun)}`;
    const entries: ZipEntry[] = [];
    const dates: string[] = [];
    const missing: string[] = [];
    let shifts = 0;
    let events = 0;
    let photos = 0;
    for (let i = 0; i < 7; i++) {
      const date = isoOf(base + i * 86_400_000);
      const r: any = await this.buildDayWorkExport(repo, date).catch(() => null);
      if (!r || (!r.shifts && !r.events)) continue;
      dates.push(date);
      shifts += r.shifts || 0;
      events += r.events || 0;
      photos += r.photos || 0;
      missing.push(...(r.missing || []));
      for (const en of (r.entries || [])) {
        entries.push({ name: `${root}/${en.name}`, data: en.data });
      }
    }
    return { zip: buildZipStore(entries), root, dates, shifts, events, photos, missing };
  }

  /** Gói ZIP cả tuần (T2–CN): mỗi ngày 1 cụm folder ảnh như ngày lẻ (không CSV). */
  public async buildAttendanceWeekZip(
    repo: ISheetsRepository,
    weekMon: string
  ): Promise<{ zip: Buffer; dates: string[]; eventCount: number; photoCount: number; missing: string[] }> {
    const [y, m, d0] = weekMon.split('-').map(Number);
    const base = Date.UTC(y, m - 1, d0);
    const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);
    const weekSun = isoOf(base + 6 * 86_400_000);
    const fmtD = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
    const root = `Diem danh tuan ${fmtD(weekMon)} den ${fmtD(weekSun)}`;
    const entries: ZipEntry[] = [];
    const dates: string[] = [];
    const missing: string[] = [];
    let eventCount = 0;
    let photoCount = 0;
    for (let i = 0; i < 7; i++) {
      const date = isoOf(base + i * 86_400_000);
      dates.push(date);
      const dayRoot = `${root}/Diem danh ngay ${fmtD(date)}`;
      const r = await this.attendanceZipEntriesForDate(repo, date, dayRoot);
      entries.push(...r.entries);
      missing.push(...r.missing);
      eventCount += r.eventCount;
      photoCount += r.photoCount;
    }
    return { zip: buildZipStore(entries), dates, eventCount, photoCount, missing };
  }

  /**
   * Lưu trữ + reset tuần chấm công (chạy 23h30 Chủ nhật, dự phòng 00h05 Thứ 2):
   * 1) gói ZIP tuần up lên Drive, 2) chuyển dòng tuần sang tab LUUTRU_CHAMCONG_TUAN,
   * 3) xóa dòng tuần khỏi tab chính + bộ nhớ để bảng realtime bắt đầu tuần mới.
   * Idempotent theo systemSettings.attendanceArchive.lastWeekMon.
   */
  public async archiveAttendanceWeek(repo: ISheetsRepository, weekMon: string): Promise<{ archived: boolean; reason?: string; eventCount?: number; driveFileId?: string }> {
    let fallback: MockSheetsAdapter | null = null;
    if ((repo as any).fallbackAdapter instanceof MockSheetsAdapter) {
      fallback = (repo as any).fallbackAdapter as MockSheetsAdapter;
    } else if (repo instanceof MockSheetsAdapter) {
      fallback = repo;
    }
    if (!fallback) return { archived: false, reason: 'ADAPTER_MISMATCH' };
    const settings = await repo.getSystemSettings().catch(() => ({}));
    if (settings?.attendanceArchive?.lastWeekMon === weekMon) {
      return { archived: false, reason: 'ALREADY_ARCHIVED' };
    }
    const [y, m, d0] = weekMon.split('-').map(Number);
    const base = Date.UTC(y, m - 1, d0);
    const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);
    const weekSun = isoOf(base + 6 * 86_400_000);
    const vnDay = (iso: string) => {
      const t = new Date(iso || '').getTime();
      if (!Number.isFinite(t)) return '';
      return new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
    };
    const inWeek = (dt: string) => {
      const v = vnDay(dt);
      return v >= weekMon && v <= weekSun;
    };

    const { zip, eventCount } = await this.buildAttendanceWeekZip(repo, weekMon);
    let driveFileId = '';
    try {
      const up = await this.uploadBufferToDrive(`Diem-danh-tuan-${weekMon}-den-${weekSun}.zip`, 'application/zip', zip);
      driveFileId = up.fileId || '';
    } catch { /* ZIP vẫn ghi Sheets, Drive thử lại lần sau */ }

    await this.initSpreadsheetStructure().catch(() => null);
    const rows = (fallback.attendanceEvents || [])
      .filter((e: any) => inWeek(e.client_time || ''))
      .map((e: any) => [
        e.event_id, e.assignment_id, e.employee_id, e.type, sheetDateTimeText(e.server_received_at),
        e.gps_latitude ?? '', e.gps_longitude ?? '', e.distance_meters ?? '', e.gps_status || '',
        e.drive_object_id || '', e.request_id || '', (e as any).uniform_pink_ratio ?? '',
        sheetDateTimeText(e.client_time || ''),
      ]);
    if (rows.length > 0 && this.sheetsClient) {
      try {
        // BETA partition: đọc cả các tab part (_P2..) rồi ghi đè lại qua chain
        const oldRows = await this.readPartitionedRows('LUUTRU_CHAMCONG_TUAN');
        await this.rewritePartitionedTab('LUUTRU_CHAMCONG_TUAN', [...oldRows, ...rows]);
        this.invalidateArchivedAttendanceCache();
      } catch (e: any) {
        console.warn('[archive] Ghi tab lưu trữ thất bại:', e?.message || e);
      }
    }

    // Reset: bộ nhớ + tab chính chỉ giữ sự kiện từ Thứ 2 tuần mới trở đi (theo ngày VN).
    const nextMon = isoOf(base + 7 * 86_400_000);
    fallback.attendanceEvents = (fallback.attendanceEvents || []).filter((e: any) => vnDay(e.client_time || '') >= nextMon);
    if (this.sheetsClient) {
      try {
        const mainRows = (fallback.attendanceEvents || []).map((e: any) => [
          e.event_id, e.assignment_id, e.employee_id, e.type, sheetDateTimeText(e.server_received_at),
          e.gps_latitude ?? '', e.gps_longitude ?? '', e.distance_meters ?? '', e.gps_status || '',
          e.drive_object_id || '', e.request_id || '', (e as any).uniform_pink_ratio ?? '',
          sheetDateTimeText(e.client_time || ''),
          e.is_late ? 'YES' : '', e.is_early ? 'YES' : '', Number(e.minutes_deviation) || 0,
          e.fine_tier || 'NONE', Number(e.fine_amount) || 0,
        ]);
        const def = SHEETS_DEFINITIONS.find(dd => dd.title === 'SU_KIEN_DIEM_DANH')!;
        await this.overwriteSheetData('SU_KIEN_DIEM_DANH', def.headers, mainRows);
      } catch (e: any) {
        console.warn('[archive] Reset tab chính thất bại:', e?.message || e);
      }
    }

    const next = { ...(settings || {}), attendanceArchive: { lastWeekMon: weekMon, archivedAt: new Date().toISOString(), eventCount, driveFileId } };
    await repo.updateSystemSettings(next).catch(() => null);
    return { archived: true, eventCount, driveFileId };
  }

  /**
   * Đọc sự kiện điểm danh tuần cũ từ kho LUUTRU_CHAMCONG_TUAN (tab Lịch làm việc
   * lùi tuần + dải 12 ngày thử việc quá khứ). Chỉ đọc, không sửa — realtime giữ nguyên.
   * client_time trả về dạng wall-clock VN (+07:00) để frontend khớp ngày như sự kiện live.
   */
  public async getArchivedAttendanceEvents(fromIso: string, toIso: string, employeeId?: string): Promise<any[]> {
    // BETA partition: gộp mọi tab part của kho lưu trữ (nếu tab đã phình chia).
    // Cache 2 phút + gộp request đang bay: mở tab công tháng không còn phải chờ
    // đọc lại toàn bộ kho nhiều lần.
    const rows = await this.readArchivedRowsCached().catch(() => []);
    const wantedEmp = String(employeeId || '').trim();
    const out: any[] = [];
    const vnDayOfInstant = (t: number) => new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
    for (const r of rows) {
      if (!r || !r.some(c => String(c || '').trim())) continue;
      // Lọc sớm theo nhân viên khi caller chỉ cần 1 người (cổng NV) — tránh map
      // vài nghìn dòng rồi mới bỏ đi ở tầng trên.
      if (wantedEmp && (r[2] || '').trim() !== wantedEmp) continue;
      // Archive ghi 13 giá trị/dòng (client_time ở r[12]); bản rất cũ 12 cột (r[11]).
      const clientRaw = (r[12] || r[11] || '').trim().replace(/^'/, '');
      const t = new Date(clientRaw).getTime();
      if (!Number.isFinite(t)) continue;
      const day = vnDayOfInstant(t);
      if (day < fromIso || day > toIso) continue;
      const wall = new Date(t + 7 * 3_600_000).toISOString().slice(0, 19) + '+07:00';
      const numOrUndef = (v: any) => {
        const s = String(v ?? '').trim();
        if (!s) return undefined;
        const n = Number(s);
        return Number.isFinite(n) ? n : undefined;
      };
      out.push({
        event_id: (r[0] || '').trim(),
        assignment_id: (r[1] || '').trim() || undefined,
        employee_id: (r[2] || '').trim(),
        type: (r[3] || '').trim(),
        server_received_at: normSheetDateTime(r[4]) || undefined,
        gps_latitude: numOrUndef(r[5]),
        gps_longitude: numOrUndef(r[6]),
        distance_meters: numOrUndef(r[7]),
        gps_status: (r[8] || '').trim() || undefined,
        drive_object_id: (r[9] || '').trim() || undefined,
        request_id: (r[10] || '').trim() || undefined,
        client_time: wall,
        archived: true,
      });
    }
    return out;
  }

  /**
   * Xóa 1 sự kiện khỏi kho LUUTRU_CHAMCONG_TUAN (Admin/HR xóa lượt điểm danh
   * tuần cũ trên lưới). Đọc tab, bỏ dòng trùng event_id, ghi đè. Trả về thông
   * tin dòng đã xóa để audit/guard kỳ lương, null khi không thấy.
   */
  public async deleteArchivedAttendanceEvent(eventId: string): Promise<{ employee_id: string; client_time: string; type: string } | null> {
    const id = String(eventId || '').trim();
    if (!id || !this.sheetsClient) return null;
    // BETA partition: đọc gộp mọi part, xóa rồi ghi đè lại qua chain part
    const rows = await this.readPartitionedRows('LUUTRU_CHAMCONG_TUAN').catch(() => [] as string[][]);
    const idx = rows.findIndex(r => String((r as any)?.[0] || '').trim() === id);
    if (idx < 0) return null;
    const gone = rows[idx] || [];
    const kept = rows.filter((_, i) => i !== idx);
    await this.rewritePartitionedTab('LUUTRU_CHAMCONG_TUAN', kept);
    this.invalidateArchivedAttendanceCache();
    const clientRaw = String(gone[12] || gone[11] || '').trim().replace(/^'/, '');
    return {
      employee_id: String(gone[2] || '').trim(),
      client_time: clientRaw,
      type: String(gone[3] || '').trim(),
    };
  };

  /** Tải bytes ảnh từ Google Drive (để xem trực tiếp / đóng gói ZIP tải về). */
  public async downloadDriveFile(fileId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!fileId || fileId.startsWith('DRV_')) {
      throw new Error('DRIVE_FILE_NOT_AVAILABLE');
    }

    // Webhook (nếu cấu hình) đọc được cả file do chính nó tạo — hữu ích khi
    // backend chỉ có Service Account hết quota, không có quyền đọc file.
    const viaWebhook = async () => {
      const dl = await downloadBufferViaDriveWebhook(fileId);
      if (!dl) throw new Error('DRIVE_FILE_NOT_AVAILABLE');
      return dl;
    };

    if (!this.driveClient) return viaWebhook();

    try {
      const res: any = await this.sheetsCall(
        'drive.download',
        () =>
          this.driveClient!.files.get({ fileId, alt: 'media', supportsAllDrives: true } as any, { responseType: 'arraybuffer' }) as any,
        45000
      );
      const data = res?.data;
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const headerMime = res?.headers?.['content-type'];
      const mimeType = headerMime && !headerMime.includes('octet-stream')
        ? headerMime
        : 'image/jpeg';
      return { buffer, mimeType };
    } catch (err) {
      // Drive API không đọc được (file thuộc tài khoản khác/quyền hạn) -> webhook.
      return viaWebhook();
    }
  }

  /**
   * Ghi đè dữ liệu một Sheet tab (giữ nguyên tiêu đề ở dòng 1)
   */
  public async overwriteSheetData(
    sheetTitle: string,
    headers: string[],
    rows: any[][],
    allowEmpty = false,
    // RAW: giữ nguyên chuỗi (SĐT/CCCD có số 0 đầu, "2004 - 2008", "6:50:29").
    // USER_ENTERED để Google tự parse -> mất số 0 đầu và đổi định dạng ngày giờ.
    valueInputOption: 'RAW' | 'USER_ENTERED' = 'USER_ENTERED',
  ) {
    if (!this.sheetsClient) return;

    // BẢO VỆ CHỐNG MẤT DỮ LIỆU: Tab Master không được phép xoá sạch dữ liệu (0 dòng)
    if (rows.length === 0 && GoogleSheetsSyncService.CRITICAL_TABS.has(sheetTitle) && !allowEmpty) {
      console.warn(`[GoogleSheetsSyncService] CHẶN GHI ĐÈ RỖNG: Tab Master '${sheetTitle}' không được phép ghi đè 0 dòng!`);
      return;
    }

    // Ghi đè AN TOÀN: ghi dữ liệu mới TRƯỚC (A1...), rồi mới xóa phần đuôi thừa.
    // (Bản cũ xóa trước-ghi sau: crash/quota ở giữa = mất trắng tab.)
    const allValues = [headers, ...rows];
    const targetSpreadsheetId = getSpreadsheetIdForTab(sheetTitle, this.spreadsheetId);
    try {
      await this.sheetsCall(`write.${sheetTitle}`, () =>
        this.sheetsClient!.spreadsheets.values.update({
          spreadsheetId: targetSpreadsheetId,
          range: `'${sheetTitle}'!A1`,
          valueInputOption,
          requestBody: {
            values: allValues,
          },
        })
      );
      this.markWriteOk();
    } catch (e) {
      this.markWriteFail(`overwrite ${sheetTitle}`, e);
      throw e;
    }

    // Xóa đuôi thừa khi dữ liệu mới ngắn hơn cũ (tránh dòng ma). Clear tới ZZ
    // để tab >26 cột (PHIEU_LUONG 40 cột) cũng sạch đuôi ở cột AA+.
    try {
      await this.sheetsCall(`clear.${sheetTitle}`, () =>
        this.sheetsClient!.spreadsheets.values.clear({
          spreadsheetId: targetSpreadsheetId,
          range: `'${sheetTitle}'!A${allValues.length + 1}:ZZ`,
        })
      );
    } catch (e) {
      // Bỏ qua nếu range trống
    }
  }

  /** Loại dòng trùng khi đọc Sheet (append/ghi đè chồng tạo dup): giữ bản CUỐI (mới nhất). */
  private static dedupeBy<T>(rows: T[], key: (r: T) => string): T[] {
    const map = new Map<string, T>();
    for (const r of rows) {
      const k = key(r);
      if (k) map.set(k, r);
    }
    return [...map.values()];
  }

  /** Gom toàn bộ phiếu lương qua các kỳ (phục vụ push tab PHIEU_LUONG). */
  private async collectAllPayslips(repo: ISheetsRepository): Promise<any[]> {
    const out: any[] = [];
    const seen = new Set<string>();
    try {
      const runs = await repo.listPayrollRuns();
      for (const r of runs || []) {
        const slips = await repo.getPayslipsByRunId((r as any).run_id).catch(() => []);
        for (const s of slips || []) {
          if ((s as any)?.item_id && !seen.has((s as any).item_id)) {
            seen.add((s as any).item_id);
            out.push(s);
          }
        }
      }
      const fb: any = (repo as any).fallbackAdapter || repo;
      if (Array.isArray(fb?.payslips)) {
        for (const s of fb.payslips) {
          if (s?.item_id && !seen.has(s.item_id)) {
            seen.add(s.item_id);
            out.push(s);
          }
        }
      }
    } catch { /* best-effort */ }
    return out;
  }

  /** Gom toàn bộ lịch sử giai đoạn NV (phục vụ push tab LICH_SU_GIAI_DOAN). */
  private async collectAllStageHistories(repo: ISheetsRepository): Promise<any[]> {
    const out: any[] = [];
    try {
      const emps = await repo.listEmployees();
      for (const e of emps || []) {
        const h = await repo.getStageHistory((e as any).employee_id).catch(() => []);
        out.push(...(h || []));
      }
    } catch { /* best-effort */ }
    return out;
  }

  /** Ép Sheets giữ nguyên text (SĐT 033.../PIN 0428): USER_ENTERED hay nuốt số 0 đầu. */
  public static sheetText(v: any): any {
    const s = v === null || v === undefined ? '' : String(v);
    if (s !== '' && /^0\d+$/.test(s)) return `'${s}`;
    return v;
  }

  /** ID Sheet ngân hàng câu hỏi trắc nghiệm (HR chia sẻ quyền Xem cho service account). */
  public static testBankSpreadsheetId(): string {
    return (process.env.TEST_BANK_SPREADSHEET_ID || '1h06TrHMRnBOHMkp7Ri4Rz8yRw8ptemQp0ftjMldHYdc').trim();
  }

  /** Tên tab chứa câu hỏi trong Sheet ngân hàng. */
  public static testBankSheetName(): string {
    return (process.env.TEST_BANK_SHEET_NAME || 'TRAC_NGHIEM').trim();
  }

  /**
   * Đọc ngân hàng câu hỏi trắc nghiệm từ Google Sheet ngoài.
   * Cấu trúc cột: Câu hỏi | A | B | C | D | Đáp án (chữ A-E hoặc số 1-5) | Giải thích.
   * Trả về danh sách câu hợp lệ (bỏ dòng thiếu nội dung/đáp án/không rõ đáp án đúng).
   */
  public async readTestBankQuestions(): Promise<{
    spreadsheetId: string;
    sheetName: string;
    questions: { content: string; options: string[]; correct_index: number; explanation: string }[];
    totalRows: number;
    skipped: number;
  }> {
    if (!this.isConfigured || !this.sheetsClient) {
      throw new Error('TEST_BANK_NOT_CONFIGURED: Chưa cấu hình Google Service Account trên server!');
    }
    const spreadsheetId = GoogleSheetsSyncService.testBankSpreadsheetId();
    const sheetName = GoogleSheetsSyncService.testBankSheetName();
    let values: string[][] = [];
    try {
      const res: any = await this.sheetsCall(
        'bank.read',
        () =>
          this.sheetsClient!.spreadsheets.values.get({
            spreadsheetId,
            range: `'${sheetName}'!A1:G`,
            ...SHEETS_READ_OPTIONS,
          }) as any,
        30000
      );
      values = (res?.data?.values || []) as string[][];
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (/403|PERMISSION_DENIED|permission/i.test(msg)) {
        throw new Error('TEST_BANK_NO_ACCESS: Sheet ngân hàng câu hỏi chưa được chia sẻ quyền Xem cho service account! Mở Sheet -> Chia sẻ -> thêm email service account với quyền Người xem.');
      }
      if (/404|NOT_FOUND|Unable to parse range/i.test(msg)) {
        throw new Error(`TEST_BANK_NO_TAB: Không tìm thấy tab "${sheetName}" trong Sheet ngân hàng câu hỏi!`);
      }
      throw new Error(`TEST_BANK_READ_FAILED: Không đọc được Sheet ngân hàng câu hỏi (${msg}).`);
    }
    // Tìm dòng tiêu đề (ô đầu chứa "câu hỏi") — dữ liệu bắt đầu từ dòng sau.
    let startIdx = 0;
    for (let i = 0; i < Math.min(values.length, 10); i++) {
      if (/câu hỏi/i.test(String(values[i]?.[0] || ''))) {
        startIdx = i + 1;
        break;
      }
    }
    const questions: { content: string; options: string[]; correct_index: number; explanation: string }[] = [];
    let skipped = 0;
    for (let i = startIdx; i < values.length; i++) {
      const r = values[i] || [];
      const content = String(r[0] ?? '').trim();
      if (!content) continue; // dòng trống
      const rawOptions = [r[1], r[2], r[3], r[4]].map(v => String(v ?? '').trim());
      // Giữ nguyên thứ tự A-D, chỉ loại đáp án trống ở cuối (đáp án trống ở giữa -> câu lỗi).
      const options = [...rawOptions];
      while (options.length > 0 && options[options.length - 1] === '') options.pop();
      const answerRaw = String(r[5] ?? '').trim().toUpperCase();
      // Chấp nhận: "B", "2", "Đáp án đúng là B"...
      let correct = -1;
      const letter = (answerRaw.match(/[A-E]/) || [])[0];
      const digit = (answerRaw.match(/[1-5]/) || [])[0];
      if (letter) correct = letter.charCodeAt(0) - 65;
      else if (digit) correct = Number(digit) - 1;
      if (options.length < 2 || correct < 0 || correct >= options.length || !options[correct]) {
        skipped++;
        continue;
      }
      questions.push({
        content,
        options,
        correct_index: correct,
        explanation: String(r[6] ?? '').trim(),
      });
    }
    return { spreadsheetId, sheetName, questions, totalRows: Math.max(0, values.length - startIdx), skipped };
  }

  /**
   * Thêm một dòng mới vào cuối Sheet tab (Append)
   */
  // ================= BETA partition helpers =================
  private invalidateTabListCache() {
    this.tabListCache.clear();
  }

  /**
   * Danh sách title tab hiện hữu của 1 spreadsheet (mặc định: file tổng hợp cũ).
   * Cache 10 phút theo từng spreadsheet — bộ 25 sheet có 25 danh sách khác nhau.
   */
  public async listSpreadsheetTabs(spreadsheetId: string = this.spreadsheetId): Promise<string[]> {
    const sid = String(spreadsheetId || this.spreadsheetId);
    const cached = this.tabListCache.get(sid);
    if (cached && Date.now() - cached.at < 600_000) return cached.titles;
    const res = await this.sheetsCall('meta.tabs', () =>
      this.sheetsClient!.spreadsheets.get({
        spreadsheetId: sid,
        fields: 'sheets.properties.title',
      })
    );
    const titles = (res.data.sheets || []).map((s: any) => s.properties?.title || '').filter(Boolean);
    this.tabListCache.set(sid, { at: Date.now(), titles });
    return titles;
  }

  /** Số dòng dữ liệu của tab (cache; -1 = không đo được -> KHÔNG xoay, an toàn). */
  private async getDataRowCount(title: string): Promise<number> {
    if (this.partRowCounts.has(title)) return this.partRowCounts.get(title)!;
    try {
      const res = await this.sheetsCall(`count.${title}`, () =>
        this.sheetsClient!.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetIdOf(title),
          range: `'${title}'!A2:A`,
          majorDimension: 'COLUMNS' as any,
        })
      );
      const n = (res.data.values?.[0] as any[] | undefined)?.length ?? 0;
      this.partRowCounts.set(title, n);
      return n;
    } catch {
      return -1; // lỗi quota/404 -> không chắc số dòng -> giữ hành vi cũ
    }
  }

  private bumpRowCount(title: string, delta = 1) {
    if (this.partRowCounts.has(title)) this.partRowCounts.set(title, this.partRowCounts.get(title)! + delta);
    const grid = this.tabGridCache.get(title);
    if (grid) this.tabGridCache.set(title, { at: grid.at, rows: grid.rows + delta });
  }

  /**
   * Số dòng lưới của tab theo metadata (cache 5 phút). KHÔNG đọc dữ liệu.
   * Trả -1 nếu không đo được (lỗi mạng/quota) — nơi gọi xử lý an toàn.
   */
  private async getTabGridRows(title: string): Promise<number> {
    const cached = this.tabGridCache.get(title);
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.rows;
    try {
      const meta: any = await this.sheetsCall(`grid.${title}`, () =>
        this.sheetsClient!.spreadsheets.get({
          spreadsheetId: this.spreadsheetIdOf(title),
          fields: 'sheets.properties(title,gridProperties.rowCount)',
        }), 15000);
      const at = Date.now();
      for (const s of meta?.data?.sheets || []) {
        const t = s?.properties?.title;
        if (!t) continue;
        this.tabGridCache.set(t, { at, rows: s.properties?.gridProperties?.rowCount ?? 0 });
      }
      return this.tabGridCache.get(title)?.rows ?? -1;
    } catch {
      return -1;
    }
  }

  /** Chọn tab đích khi append vào tab khai báo partition (base đủ ngưỡng -> part). */
  private async pickPartitionTarget(base: string): Promise<string> {
    const limit = GoogleSheetsSyncService.PARTITION_ROW_LIMIT;
    // Dùng số dòng lưới từ metadata: đọc nhanh, không phụ thuộc `values.get`
    // toàn cột A (từng treo 30s khi tab lớn → append timeout vô hạn).
    const baseCount = await this.getTabGridRows(base);
    if (baseCount < 0 || baseCount < limit) return base;
    const sid = this.spreadsheetIdOf(base);
    let n = 2;
    while (n < 200) {
      const title = `${base}_P${n}`;
      const titles = await this.listSpreadsheetTabs(sid);
      if (!titles.includes(title)) {
        await this.createPartitionTab(base, title);
        this.partRowCounts.set(title, 0);
        this.tabGridCache.set(title, { at: Date.now(), rows: 0 });
        return title;
      }
      const c = await this.getTabGridRows(title);
      if (c < 0) return title;
      if (c < limit) return title;
      n++;
    }
    return base; // an toàn hiếm hoi: >200 part
  }

  /** Tạo tab partition + header giống hệt tab gốc (cùng spreadsheet với tab gốc). */
  private async createPartitionTab(base: string, title: string): Promise<void> {
    const headers = SHEETS_DEFINITIONS.find(d => d.title === base)?.headers || [];
    const sid = this.spreadsheetIdOf(base);
    await this.sheetsCall(`part.add.${title}`, () =>
      this.sheetsClient!.spreadsheets.batchUpdate({
        spreadsheetId: sid,
        requestBody: { requests: [{ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } }] },
      })
    );
    if (headers.length) {
      await this.sheetsCall(`part.header.${title}`, () =>
        this.sheetsClient!.spreadsheets.values.update({
          spreadsheetId: sid,
          range: `'${title}'!A1:${GoogleSheetsSyncService.colLetter(headers.length)}1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [headers] },
        })
      );
    }
    this.invalidateTabListCache();
    console.log(`[Partition] Đã tạo tab phân mảnh mới: ${title} (ngưỡng xoay ${GoogleSheetsSyncService.PARTITION_ROW_LIMIT} dòng)`);
  }

  /** Chuỗi các tab của 1 base: [base, _P2, _P3...] chỉ gồm tab đang tồn tại. */
  private async partitionChain(base: string): Promise<string[]> {
    const titles = await this.listSpreadsheetTabs(this.spreadsheetIdOf(base));
    const chain = [base];
    for (let n = 2; n < 200; n++) {
      const t = `${base}_P${n}`;
      if (titles.includes(t)) chain.push(t);
      else break;
    }
    return chain;
  }

  /** Đọc TOÀN BỘ dòng dữ liệu của 1 tab partition (gộp mọi part theo thứ tự, 1 batchGet). */
  public async readPartitionedRows(base: string): Promise<string[][]> {
    const chain = await this.partitionChain(base).catch(() => [base]);
    const batch = await this.readTabsBatch(chain).catch(() => ({} as Record<string, string[][]>));
    return chain.flatMap(t => batch[t] || []);
  }

  /**
   * Đọc kho lưu trữ chấm công tuần cũ có cache:
   * - Có cache còn hạn: trả ngay (không gọi Google).
   * - Có cache nhưng hết hạn: trả bản cũ NGAY + làm mới nền (stale-while-revalidate)
   *   để lần mở tab sau vẫn nhanh dù Google Sheets chậm.
   * - Chưa có cache: chờ 1 lượt đọc; các request song song dùng chung promise này.
   */
  private readArchivedRowsCached(): Promise<string[][]> {
    const now = Date.now();
    if (this.archiveRowsCache) {
      const expired = now - this.archiveRowsCache.at >= GoogleSheetsSyncService.ARCHIVE_CACHE_TTL_MS;
      if (expired && !this.archiveRowsInFlight) {
        this.startArchiveRefresh();
      }
      return Promise.resolve(this.archiveRowsCache.rows);
    }
    if (!this.archiveRowsInFlight) this.startArchiveRefresh();
    return this.archiveRowsInFlight || Promise.resolve([]);
  }

  private startArchiveRefresh(): void {
    const epoch = this.archiveCacheEpoch;
    this.archiveRowsInFlight = this.readPartitionedRows('LUUTRU_CHAMCONG_TUAN')
      .then(rows => {
        // Bỏ qua kết quả đọc cũ nếu kho vừa bị ghi/xóa trong lúc đang đọc.
        if (epoch === this.archiveCacheEpoch) {
          this.archiveRowsCache = { at: Date.now(), rows };
        }
        return rows;
      })
      .catch(() => this.archiveRowsCache?.rows || [])
      .finally(() => {
        this.archiveRowsInFlight = null;
      });
  }

  /** Kho lưu trữ vừa bị ghi (archive tuần mới / xóa lượt) -> bỏ cache ngay. */
  public invalidateArchivedAttendanceCache(): void {
    this.archiveRowsCache = null;
    this.archiveCacheEpoch++;
  }

  /**
   * Làm ấm cache kho lưu trữ ngay sau khi server lên (chạy nền, không chặn
   * request). Nhờ vậy lần đầu NV mở tab "Dữ Liệu Công Của Tôi" không phải chờ
   * batchGet toàn tab; các lần sau dùng stale-while-revalidate nên luôn tức thì.
   */
  public warmArchivedAttendanceCache(): void {
    void this.readArchivedRowsCached().catch(() => []);
  }

  /**
   * Ghi đè TOÀN BỘ dữ liệu của 1 tab partition: chia hàng theo ngưỡng, ghi
   * tuần tự vào base rồi các part (thừa -> clear trống, thiếu -> tự tạo).
   */
  private async rewritePartitionedTab(base: string, rows: any[][]): Promise<void> {
    const headers = SHEETS_DEFINITIONS.find(d => d.title === base)?.headers || [];
    const limit = GoogleSheetsSyncService.PARTITION_ROW_LIMIT;
    const chunks: any[][][] = [];
    for (let i = 0; i < rows.length; i += limit) chunks.push(rows.slice(i, i + limit));
    const chain = await this.partitionChain(base);
    while (chain.length < chunks.length) {
      const title = `${base}_P${chain.length + 1}`;
      await this.createPartitionTab(base, title);
      this.partRowCounts.set(title, 0);
      chain.push(title);
    }
    for (let i = 0; i < chain.length; i++) {
      const chunk = i < chunks.length ? chunks[i] : [];
      await this.overwriteSheetData(chain[i], headers, chunk);
      this.partRowCounts.set(chain[i], chunk.length);
    }
    if (chunks.length > 1) {
      console.log(`[Partition] ${base}: ghi lại ${rows.length} dòng vào ${chunks.length} tab part`);
    }
  }

  /**
   * Ước lượng ô đã dùng của spreadsheet (Σ dòng dữ liệu × số cột header,
   * 1 batchGet đo toàn bộ tab). Giới hạn Google = 10 triệu ô/spreadsheet —
   * hệ thống cảnh báo Admin trước ở 75% (6 triệu) và 90%.
   */
  public async estimateCellUsage(): Promise<{ cellsUsed: number; cellsLimit: number; pct: number; level: 'OK' | 'WARN' | 'CRITICAL'; measuredTabs: number }> {
    const limitPerDoc = 10_000_000; // giới hạn Google thực tế cho MỖI spreadsheet
    if (this.cellUsageCache && Date.now() - this.cellUsageCache.at < 21_600_000) return this.cellUsageCache.data;

    // Bộ 25 sheet: mỗi bảng 1 file riêng -> đo theo từng file, cảnh báo theo
    // file đầy nhất (không cộng dồn vì mỗi file có hạn mức 10 triệu ô riêng).
    const groups = new Map<string, Array<typeof SHEETS_DEFINITIONS[number]>>();
    for (const def of SHEETS_DEFINITIONS) {
      const sid = this.spreadsheetIdOf(def.title);
      if (!groups.has(sid)) groups.set(sid, []);
      groups.get(sid)!.push(def);
    }

    let cellsUsed = 0;
    let measuredTabs = 0;
    let maxPct = 0;
    for (const defs of groups.values()) {
      const titles = defs.map(d => d.title);
      const batch = await this.readTabsBatch(titles).catch(() => ({} as Record<string, string[][]>));
      let cellsHere = 0;
      for (const def of defs) {
        cellsHere += (batch[def.title]?.length || 0) * def.headers.length;
        measuredTabs += 1;
      }
      cellsUsed += cellsHere;
      maxPct = Math.max(maxPct, (cellsHere / limitPerDoc) * 100);
    }

    const pct = Math.min(100, Math.round(maxPct * 10) / 10);
    const level: 'OK' | 'WARN' | 'CRITICAL' = pct >= 90 ? 'CRITICAL' : pct >= 75 ? 'WARN' : 'OK';
    const data = {
      cellsUsed,
      cellsLimit: limitPerDoc * Math.max(1, groups.size),
      pct,
      level,
      measuredTabs,
    };
    this.cellUsageCache = { at: Date.now(), data };
    return data;
  }

  /** Timeout riêng cho append: ghi theo lô (hàng trăm dòng) cần lâu hơn 20s mặc định. */
  private appendTimeoutMs(): number {
    const raw = Number(process.env.SHEETS_APPEND_TIMEOUT_MS);
    return Number.isFinite(raw) && raw >= 2_000 ? raw : 30_000;
  }

  public async appendRow(sheetTitle: string, row: any[]): Promise<boolean> {
    if (!this.isConfigured || !this.sheetsClient) return false;

    // BETA partition: tab phình -> ghi sang part kế tiếp thay vì tab gốc
    let target = sheetTitle;
    if (GoogleSheetsSyncService.PARTITION_TABS.has(sheetTitle)) {
      try {
        target = await this.pickPartitionTarget(sheetTitle);
      } catch {
        target = sheetTitle; // lỗi metadata -> hành vi cũ
      }
    }

    try {
      const targetSpreadsheetId = getSpreadsheetIdForTab(target, this.spreadsheetId);
      await this.sheetsCall(`append.${target}`, () =>
        this.sheetsClient!.spreadsheets.values.append({
          spreadsheetId: targetSpreadsheetId,
          range: `'${target}'!A:A`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [row],
          },
        }), this.appendTimeoutMs()
      );
      this.bumpRowCount(target);
      this.markWriteOk();
      return true;
    } catch (err) {
      this.markWriteFail(`append ${target}`, err);
      console.error(`[GoogleSheetsSyncService] Lỗi append row vào ${target}:`, err);
      return false;
    }
  }

  public async appendRows(sheetTitle: string, rows: any[][]): Promise<boolean> {
    if (!this.isConfigured || !this.sheetsClient || !rows || rows.length === 0) return false;

    let target = sheetTitle;
    if (GoogleSheetsSyncService.PARTITION_TABS.has(sheetTitle)) {
      try {
        target = await this.pickPartitionTarget(sheetTitle);
      } catch {
        target = sheetTitle;
      }
    }

    try {
      const targetSpreadsheetId = getSpreadsheetIdForTab(target, this.spreadsheetId);
      await this.sheetsCall(`append.${target}`, () =>
        this.sheetsClient!.spreadsheets.values.append({
          spreadsheetId: targetSpreadsheetId,
          range: `'${target}'!A:A`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: rows,
          },
        }), this.appendTimeoutMs()
      );
      for (let i = 0; i < rows.length; i++) this.bumpRowCount(target);
      this.markWriteOk();
      return true;
    } catch (err: any) {
      this.markWriteFail(`append ${target}`, err);
      console.error(`[GoogleSheetsSyncService] Lỗi append ${rows.length} rows vào ${target}:`, err?.message || err);
      // Ném lỗi để hàng đợi bền vững ghi lại ĐÚNG nguyên nhân (SHEETS_TIMEOUT,
      // 429 quota, 403 quyền...) thay vì chỉ thấy APPEND_FAILED chung chung.
      throw new Error(`APPEND_FAILED:${target}: ${this.describeGoogleError(err)}`);
    }
  }
}
