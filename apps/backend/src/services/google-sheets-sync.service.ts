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
import { buildZipStore, ZipEntry } from '../utils/zip-store.js';
import { contractDocsCell, parseContractDocs } from '../utils/contracts.js';
import { readAttendancePhotoDisk } from './photo-disk.store.js';
import { TAB_THEMES, buildSheetFormattingRequests, resolveTheme } from './sheets-beautifier.service.js';
import { computeSheetsContentSignature, fingerprintSheetsContent } from '../utils/sheets-content-signature.js';

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
    headers: ['ID Nhân Viên', 'Mã NV', 'Họ Và Tên', 'Số Điện Thoại', 'Trạng Thái', 'Nhóm', 'Chi Nhánh', 'Lương Giờ (VNĐ)', 'Ngày Bắt Đầu', 'Phiên Bản', 'Ca Cố Định', 'Ngày Chính Thức', 'Email', 'Giới Tính', 'Ngày Sinh', 'CCCD', 'Avatar (Drive ID)', 'Ngân Hàng', 'Số Tài Khoản', 'Chủ Tài Khoản', 'QR Ngân Hàng (Base64)', 'Điểm Tích Lũy', 'Điểm Đã Dùng', 'Hợp Đồng Lao Động (JSON)'],
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
    headers: ['ID Đổi Ca', 'Người Yêu Cầu', 'Ca Yêu Cầu', 'Người Nhận', 'Ca Đổi', 'Lý Do', 'Trạng Thái', 'Người Duyệt', 'Ngày Tạo', 'Loại Phiếu', 'Phụ Cấp (đ)', 'CN Hỗ Trợ', 'Ngày Hỗ Trợ', 'Ca Hỗ Trợ'],
  },
  {
    title: 'DIEU_CHINH_CONG',
    headers: ['ID Điều Chỉnh', 'ID Ca', 'ID Nhân Viên', 'Lý Do', 'Số Phút Được Duyệt', 'Người Duyệt', 'Trạng Thái', 'Ghi Chú', 'Ảnh Bằng Chứng (Drive ID)'],
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
    headers: ['Mã Chi Nhánh', 'Tên Chi Nhánh', 'Địa Chỉ', 'Vĩ Độ GPS', 'Kinh Độ GPS', 'Bán Kính Cho Phép (m)', 'Trạng Thái'],
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
    headers: ['ID Phiếu', 'Mã Kỳ Lương', 'ID Nhân Viên', 'Mã NV', 'Họ Và Tên', 'Kỳ Lương', 'Số Ca', 'Ca Vắng', 'Giờ Chuẩn', 'Đơn Giá', 'Lương Chuẩn', 'Phụ Cấp', 'Thưởng', 'Khấu Trừ', 'Thực Nhận', 'Trạng Thái', 'Suất OT', 'Phụ Cấp OT', 'Lương CB (tay)', 'OT Thêm (tay)', 'Bonus Thêm (tay)', 'Ứng Lương', 'Trừ KPI (tay)', 'Trừ Đồng Phục', 'Tổng Cộng', 'Tổng Lương', 'Thực Lãnh', 'Ký Lập (tên)', 'Ký Lập Lúc', 'Ký QL (tên)', 'Ký QL Lúc', 'Ký NV (tên)', 'Ký NV Lúc', 'Ảnh Ký Lập', 'Ảnh Ký QL', 'Ảnh Ký NV', 'Phát Hành Lúc', 'Xác Nhận Lúc', 'Chi Trả Lúc'],
  },
  {
    title: 'CONG_THUC_LUONG',
    headers: ['Kỳ Lương', 'Đơn Giá TV', 'Đơn Giá CT', 'Tiền 1 Suất OT', 'Ngưỡng OT 1 Suất (h)', 'Ngưỡng OT 2 Suất (h)', 'Người Cập Nhật', 'Cập Nhật Lúc'],
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
  /** Bản đọc tab FROM_NHAN_VIEN (master) dùng để phủ lịch PV/Zalo — đưa vào
   *  hash nội dung để sửa tay lịch PV trên master cũng bắn realtime. */
  private lastMasterCandidateRows: string[][] = [];
  private driveFolderId: string;
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
  /** Cache danh sách tab hiện hữu của spreadsheet (10 phút). */
  private tabListCache: { at: number; titles: string[] } | null = null;
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
   *  Mọi range cứng A1:Z/A2:Z cũ đều vỡ với tab >26 cột (PHIEU_LUONG 39 cột,
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
      const now = Date.now();
      const wait = Math.max(0, GoogleSheetsSyncService.WRITE_RATE_LIMIT_MS - (now - this.lastWriteAt));
      if (wait > 0) {
        await new Promise(r => setTimeout(r, wait));
      }
      this.lastWriteAt = Date.now();
      // Ghi thật (duyệt phiếu, điểm danh, đẩy tab...) — job dọn rule sẽ nhường.
      if (!label.startsWith('write.beautify.')) this.lastUserWriteAt = Date.now();
      return await this.withDeadline(label, fn, ms);
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
      this.driveClient = google.drive({ version: 'v3', auth });
      this.isConfigured = true;
      this.authError = null;
      console.log(`[GoogleSheetsSyncService] Đã kích hoạt Google Sheets API & Google Drive API thành công cho: ${email}`);
    } catch (err: any) {
      this.authError = `Lỗi khởi tạo JWT Auth: ${err.message}`;
      console.error('[GoogleSheetsSyncService]', this.authError);
    }
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
      spreadsheetId: this.spreadsheetId,
      fields: 'properties.title',
    }), 'probe.get');
    const valuesGet = await time(() => this.sheetsClient!.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
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
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}?fields=properties.title`,
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
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}?fields=properties.title`,
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
        spreadsheetId: this.spreadsheetId,
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
        spreadsheetId: this.spreadsheetId,
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
            spreadsheetId: this.spreadsheetId,
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
          spreadsheetId: this.spreadsheetId,
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
          const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}/values/${encodeURIComponent("AUDIT_LOG!A1")}?valueInputOption=RAW`;
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
          spreadsheetId: this.spreadsheetId,
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
   * BACKUP HẰNG NGÀY: copy nguyên "cục" spreadsheet (mọi tab + dữ liệu) ra
   * Drive bằng service account sẵn có — không cần đọc/ghi từng dòng, 1 call là
   * xong. Giữ file trong folder Drive hiện có, xóa bản cũ quá hạn
   * (BACKUP_RETENTION_DAYS, mặc định 30 ngày). Idempotent theo ngày VN do
   * route /internal/backup-run kiểm trước khi gọi.
   */
  public async runDailyBackup(retentionDays = Number(process.env.BACKUP_RETENTION_DAYS) || 30): Promise<{
    ok: boolean; name?: string; fileId?: string; createdTime?: string; deletedOld?: number; reason?: string; error?: string;
  }> {
    if (!this.isConfigured || !this.driveClient) {
      return { ok: false, reason: 'DRIVE_NOT_CONFIGURED' };
    }
    // Ngày/giờ Việt Nam (UTC+7)
    const stamp = new Date(Date.now() + 7 * 3_600_000);
    const vnDate = stamp.toISOString().slice(0, 10);
    const name = `UBM_BACKUP_${vnDate}_${String(stamp.getUTCHours()).padStart(2, '0')}${String(stamp.getUTCMinutes()).padStart(2, '0')}`;
    try {
      const copied: any = await this.driveClient.files.copy({
        fileId: this.spreadsheetId,
        requestBody: {
          name,
          ...(this.driveFolderId ? { parents: [this.driveFolderId] } : {}),
        },
        fields: 'id,name,createdTime',
        supportsAllDrives: true,
      } as any);
      // Quét + xóa bản backup quá hạn (nội dung giữ 30 ngày — không phá dữ liệu live)
      let deletedOld = 0;
      try {
        const q = `name contains 'UBM_BACKUP_' and trashed=false${this.driveFolderId ? ` and '${this.driveFolderId}' in parents` : ''}`;
        const listed: any = await this.driveClient.files.list({
          q,
          fields: 'files(id,name,createdTime)',
          orderBy: 'createdTime desc',
          pageSize: 200,
          supportsAllDrives: true,
        } as any);
        const cutoff = Date.now() - Math.max(7, retentionDays) * 86_400_000;
        for (const f of (listed?.data?.files || [])) {
          if (new Date((f as any).createdTime).getTime() < cutoff) {
            await this.driveClient.files.delete({ fileId: (f as any).id, supportsAllDrives: true } as any);
            deletedOld += 1;
          }
        }
      } catch (e: any) {
        console.warn('[Backup] dọn bản cũ lỗi (không chặn):', e?.message || e);
      }
      console.log(`[Backup] OK: ${name} (file ${copied?.data?.id}), xóa ${deletedOld} bản quá hạn`);
      return {
        ok: true,
        name,
        fileId: copied?.data?.id,
        createdTime: copied?.data?.createdTime,
        deletedOld,
      };
    } catch (e: any) {
      console.error('[Backup] THẤT BẠI:', e?.message || e);
      return { ok: false, reason: 'DRIVE_ERROR', error: String(e?.message || e) };
    }
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
      // Chỉ lấy tiêu đề tab (không kéo toàn bộ metadata) — request nhẹ, nhanh.
      const res = await this.sheetsCall('init.get', () =>
        this.sheetsClient!.spreadsheets.get({
          spreadsheetId: this.spreadsheetId,
          fields: 'sheets.properties.title',
        })
      );

      const existingSheets = res.data.sheets?.map(s => s.properties?.title || '').filter(Boolean) || [];
      const sheetsToCreate = SHEETS_DEFINITIONS.filter(def => !existingSheets.includes(def.title));

      const createdSheets: string[] = [];

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

        await this.sheetsCall('init.batchUpdate', () =>
          this.sheetsClient!.spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: { requests },
          })
        );

        createdSheets.push(...sheetsToCreate.map(s => s.title));
      }

      // CHỈ ghi header cho tab MỚI TẠO hoặc tab có header lệch/thiếu.
      // Trước đây mỗi lượt init (10 phút/lần) ghi lại header của cả 24 tab =
      // 24 lệnh GHI, chiếm khoá ghi spreadsheet và làm append của hàng đợi
      // timeout. Nay đọc 1 lần bằng batchGet rồi so sánh.
      const needHeaderWrite: Array<{ def: typeof SHEETS_DEFINITIONS[number]; existingRows: string[][]; force: boolean }> = [];
      const createdSet = new Set(createdSheets);
      const toCheck = SHEETS_DEFINITIONS.filter(def => existingSheets.includes(def.title));

      let headerRowsByTitle = new Map<string, string[]>();
      if (toCheck.length > 0) {
        try {
          const batch: any = await this.sheetsCall('init.batchGetHeaders', () =>
            this.sheetsClient!.spreadsheets.values.batchGet({
              spreadsheetId: this.spreadsheetId,
              ranges: toCheck.map(def => `'${def.title}'!A1:${GoogleSheetsSyncService.colLetter(def.headers.length)}1`),
            })
          );
          const valueRanges: any[] = batch?.data?.valueRanges || [];
          toCheck.forEach((def, i) => {
            headerRowsByTitle.set(def.title, (valueRanges[i]?.values?.[0] as string[] | undefined) || []);
          });
        } catch (e: any) {
          // Không đọc được header: bỏ qua so sánh, KHÔNG ghi (tránh đập khoá ghi).
          console.warn('[GoogleSheetsSyncService] Không đọc được header để so sánh:', e?.message || e);
        }
      }

      for (const def of SHEETS_DEFINITIONS) {
        if (createdSet.has(def.title)) continue; // header ghi ở vòng dưới (tab mới)
        const current = headerRowsByTitle.get(def.title);
        if (current === undefined) continue;
        const same = def.headers.length === current.length
          && def.headers.every((h, i) => String(h) === String(current[i] ?? ''));
        if (!same) needHeaderWrite.push({ def, existingRows: [current], force: false });
      }

      const headersToWrite = [
        ...SHEETS_DEFINITIONS.filter(def => createdSet.has(def.title)).map(def => ({ def, force: true })),
        ...needHeaderWrite,
      ];

      for (const item of headersToWrite) {
        const def = item.def;
        await this.sheetsCall(`init.header.${def.title}`, () =>
          this.sheetsClient!.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: `'${def.title}'!A1:${GoogleSheetsSyncService.colLetter(def.headers.length)}1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [def.headers],
            },
          })
        );
      }
      if (headersToWrite.length > 0) {
        console.log(`[GoogleSheetsSyncService] Ghi header cho ${headersToWrite.length}/${SHEETS_DEFINITIONS.length} tab (còn lại đã đúng).`);
      }

      console.log(`[GoogleSheetsSyncService] Đã tạo ${createdSheets.length} sheet mới. Toàn bộ ${SHEETS_DEFINITIONS.length} tab sẵn sàng.`);

      if (createdSheets.length > 0) {
        // Tự động làm đẹp và định dạng các tab mới tạo
        this.formatAndBeautifySpreadsheet().catch(err => {
          console.warn('[GoogleSheetsSyncService] Tự động làm đẹp Sheets thất bại:', err?.message || err);
        });
      }

      this.initOkAt = Date.now();
      this.lastInitResult = {
        success: true,
        createdSheets,
        existingSheets,
        message: `Đã khởi tạo thành công cấu trúc ${SHEETS_DEFINITIONS.length} sheet tabs trên Google Sheets!`,
      };
      return {
        success: true,
        createdSheets,
        existingSheets,
        message: `Đã khởi tạo thành công cấu trúc ${SHEETS_DEFINITIONS.length} sheet tabs trên Google Sheets!`,
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

    const sId = targetSpreadsheetId || this.spreadsheetId;
    const now = Date.now();

    // Chống gọi dồn dập (debounce latch 25 giây cho bảng tính chính)
    if (!targetSpreadsheetId && this.beautifyInFlight) {
      return this.beautifyInFlight;
    }
    if (!targetSpreadsheetId && now - this.lastBeautifyAt < 25_000) {
      return { success: true, message: 'Giao diện bảng tính vừa được chuẩn hóa tự động gần đây.', formattedTabs: 23 };
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
    this.beautifyInFlight = runFormat().finally(() => {
      this.beautifyInFlight = null;
    });
    return this.beautifyInFlight;
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
    // Ứng viên đọc từ spreadsheet riêng: 5s/lần để lịch PV cập nhật gần như tức
    // thì. Vẫn dưới quota đọc (batch 12 + candidate ~36 = ~48 lượt/phút); có thể
    // giãn bằng SHEETS_CANDIDATE_PULL_MS khi Google chậm.
    const candidatePullMs = Math.max(2_000, Number(process.env.SHEETS_CANDIDATE_PULL_MS) || 5_000);
    const shouldPullCandidates = !!opts.forceCandidates || Date.now() - this.lastCandidatePullAt >= candidatePullMs;

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
          const titles = await this.listSpreadsheetTabs();
          for (const base of GoogleSheetsSyncService.PARTITION_TABS) {
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
            const rate = Number(r[7]) || 25500;
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
        // Backfill: tài khoản cũ chưa có PIN -> tự sinh ngay (giới hạn 20/pull
        // để bcrypt không chặn event-loop hàng chục giây khi dữ liệu phình).
        // Ràng buộc 6 số (từ 2026-10): PIN hiển thị chưa đủ 6 số -> tự động
        // reset sang mã 6 số mới + bắt đổi, PIN cũ hết hiệu lực ngay.
        let backfilled = 0;
        let pinReset6 = 0;
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
          const shown = String((acc as any).pin_code || '');
          if (shown && !/^\d{6}$/.test(shown)) {
            if (backfilled + pinReset6 >= 20) break;
            const freshPin = generateAutoPin();
            acc.pin_hash = await hashPin(freshPin);
            acc.pin_code = freshPin;
            acc.pin_must_change = true;
            acc.updated_at = new Date().toISOString();
            pinDirty = true;
            pinReset6++;
          }
          // Chuẩn hóa lần đầu cho cột mới (không ghi đè dữ liệu đã có).
          if ((acc as any).pin_changed_at === undefined) (acc as any).pin_changed_at = '';
          if ((acc as any).pin_rotation_cycle === undefined) (acc as any).pin_rotation_cycle = '';
        }
        counts.pinBackfilled = backfilled;
        counts.pinReset6 = pinReset6;
        // PIN tự sinh/reset chỉ mới nằm bộ nhớ — đặt cờ dirty để auto-push định kỳ
        // chắc chắn đẩy lên Sheet (trước đây dựa full-push chạy miễn phí mỗi 5 phút).
        if (pinDirty) this.markDataDirty();
        if (pinReset6 > 0) {
          console.log(`[GoogleSheetsSyncService] Đã auto-reset ${pinReset6} mã PIN chưa đủ 6 số sang mã 6 số mới (bắt NV đổi lại).`);
        }
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
      if (branchRows.length > 0) {
        fallback.branches = branchRows.map(r => ({
          id: r[0],
          name: r[1],
          address: r[2],
          latitude: Number(r[3]) || 10.776889,
          longitude: Number(r[4]) || 106.700806,
          radius_meters: Number(r[5]) || 300,
          min_staff: 2,
          max_staff: 10,
          status: (r[6] as any) || 'ACTIVE',
        }));
      } else {
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
            const VALID_ROLES = ['ADMIN', 'HR', 'STORE', 'FINANCE', 'MARKETING', 'EMPLOYEE'];
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
            // Sheet không lưu ngày tạo (pull luôn gán now) -> giữ mốc gốc trong bộ nhớ
            // để TTL tự từ chối (1 ngày) tính đúng, không gia hạn oan mỗi lần pull.
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

      // 10. Đọc KY_LUONG (kỳ lương)
      const payrollRows = batch['KY_LUONG'];
      if (payrollRows && payrollRows.length > 0) {
        fallback.payrollRuns = payrollRows
          .filter(r => r && (r[0] || r[1]))
          .map(r => ({
            run_id: r[0] || `RUN_${uuidv4().slice(0, 8)}`,
            period: r[1] || new Date().toISOString().slice(0, 7),
            branch_scope: 'ALL',
            status: (r[2] as any) || 'DRAFT',
            total_employees: 0,
            total_hours: 0,
            total_amount: Number(r[3]) || 0,
            created_by: 'ADM_001',
            created_at: r[4] || new Date().toISOString(),
            updated_at: r[4] || new Date().toISOString(),
            published_at: r[5] || undefined,
            paid_at: r[6] || undefined,
            version: 1,
          }));
      } else {
        fallback.payrollRuns = [];
      }
      counts.payrollRuns = fallback.payrollRuns.length;

      // 10b. Đọc PHIEU_LUONG (chi tiết từng phiếu — merge theo ID, không bao giờ xóa).
      const slipRows = batch['PHIEU_LUONG'] || [];
      if (keepIfEmpty('PHIEU_LUONG', slipRows, (fallback.payslips || []).length)) {
        counts.payslips = (fallback.payslips || []).length;
      } else if (slipRows.length > 0) {
        const mappedSlips = slipRows
          .filter(r => r && r[0])
          .map(r => ({
            item_id: r[0],
            run_id: r[1] || '',
            employee_id: r[2] || '',
            employee_code: r[3] || '',
            full_name: r[4] || '',
            period: r[5] || '',
            total_shifts: Number(r[6]) || 0,
            absent_shifts: Number(r[7]) || 0,
            standard_hours: Number(r[8]) || 0,
            rate_snapshot: Number(r[9]) || 0,
            standard_pay: Number(r[10]) || 0,
            allowance: Number(r[11]) || 0,
            bonus: Number(r[12]) || 0,
            deduction: Number(r[13]) || 0,
            net_pay: Number(r[14]) || 0,
            status: (r[15] as any) || 'DRAFT',
            // Cột mở rộng theo file Excel (phiếu cũ thiếu -> giữ rỗng).
            ot_slots: r[16] === '' || r[16] === undefined ? undefined : Number(r[16]) || 0,
            phu_cap_ot: r[17] === '' || r[17] === undefined ? undefined : Number(r[17]) || 0,
            luong_cb: r[18] === '' || r[18] === undefined ? undefined : Number(r[18]) || 0,
            ot_extra: r[19] === '' || r[19] === undefined ? undefined : Number(r[19]) || 0,
            bonus_extra: r[20] === '' || r[20] === undefined ? undefined : Number(r[20]) || 0,
            ung_luong: r[21] === '' || r[21] === undefined ? undefined : Number(r[21]) || 0,
            tru_kpi: r[22] === '' || r[22] === undefined ? undefined : Number(r[22]) || 0,
            dong_phuc: r[23] === '' || r[23] === undefined ? undefined : Number(r[23]) || 0,
            tong_cong: r[24] === '' || r[24] === undefined ? undefined : Number(r[24]) || 0,
            tong_luong: r[25] === '' || r[25] === undefined ? undefined : Number(r[25]) || 0,
            thuc_lanh: r[26] === '' || r[26] === undefined ? undefined : Number(r[26]) || 0,
            // Quy trình ký 3 bên + phát hành từng phiếu (phiếu cũ thiếu -> giữ rỗng).
            sign_lap: r[27] ? { name: String(r[27]), at: String(r[28] || ''), img: String(r[33] || '') || undefined } : undefined,
            sign_quanly: r[29] ? { name: String(r[29]), at: String(r[30] || ''), img: String(r[34] || '') || undefined } : undefined,
            sign_nhanvien: r[31] ? { name: String(r[31]), at: String(r[32] || ''), img: String(r[35] || '') || undefined } : undefined,
            slip_published_at: String(r[36] || '') || undefined,
            slip_confirmed_at: String(r[37] || '') || undefined,
            slip_paid_at: String(r[38] || '') || undefined,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            version: 1,
          }));
        fallback.payslips = mergeById(fallback.payslips || [], mappedSlips, 'item_id', ['version']) as any;
        counts.payslips = fallback.payslips.length;
      } else if ((fallback.payslips || []).length === 0) {
        fallback.payslips = [];
      }

      // 10b2. Đọc CONG_THUC_LUONG + DULIEU_LUONG_KY (công thức & nhập tay Finance).
      const formulaRows = batch['CONG_THUC_LUONG'] || [];
      if (formulaRows.length > 0) {
        for (const r of formulaRows) {
          if (!r || !r[0]) continue;
          const fb: any = fallback as any;
          fb.payrollFormulas = fb.payrollFormulas || [];
          const ex = fb.payrollFormulas.find((f: any) => f.period === r[0]);
          const row = {
            period: r[0],
            rateTV: Number(r[1]) || 21000,
            rateCT: Number(r[2]) || 25500,
            otPerSlot: Number(r[3]) || 30000,
            otThreshold1: Number(r[4]) || 10,
            otThreshold2: Number(r[5]) || 15,
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
        fb.payrollInputs = fb.payrollInputs || [];
        for (const r of inputRows) {
          if (!r || !r[0] || !r[1]) continue;
          const row = {
            period: r[0],
            employee_id: r[1],
            luong_cb: Number(r[2]) || 0,
            ot_extra: Number(r[3]) || 0,
            bonus_extra: Number(r[4]) || 0,
            ung_luong: Number(r[5]) || 0,
            tru_kpi: Number(r[6]) || 0,
            dong_phuc: Number(r[7]) || 0,
            note: r[8] || undefined,
            updatedBy: r[9] || undefined,
            updatedAt: r[10] || undefined,
          };
          const ex = fb.payrollInputs.find((x: any) => x.period === row.period && x.employee_id === row.employee_id);
          if (ex) Object.assign(ex, row);
          else fb.payrollInputs.push(row);
        }
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
            rate_per_hour: Number(r[4]) || 0,
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
        const settingsObj: any = {};
        for (const r of configRows) {
          const key = (r[0] || '').trim();
          const val = r[1];
          if (key) {
            try {
              settingsObj[key] = JSON.parse(val);
            } catch {
              settingsObj[key] = val;
            }
          }
        }
        if (Object.keys(settingsObj).length > 0) {
          fallback.systemSettings = { ...fallback.systemSettings, ...settingsObj };
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

      if (this.sheetsClient && shouldPullCandidates) {
        // A. Thử đọc từ candidateSpreadsheetId trước (bọc timeout: Google treo
        // request này là cả pull treo theo, UI chờ vô hạn).
        if (this.candidateSpreadsheetId) {
          try {
            const meta: any = await this.sheetsCall('read.candidateMeta', () =>
              this.sheetsClient!.spreadsheets.get({
                spreadsheetId: this.candidateSpreadsheetId,
                // Chỉ lấy title: KHÔNG kéo conditionalFormats/chart/protectedRanges.
                // Bản không giới hạn fields từng trả hàng chục MB mỗi 15s khi sheet
                // ứng viên có nhiều rule định dạng -> pull 5-8s, có lúc 60s+.
                fields: 'sheets.properties.title',
              }) as any, 25000);
            const sheets = meta.data.sheets || [];
            const found = sheets.find((s: any) => {
              const t = s.properties?.title || '';
              return /FROM_NHAN_VIEN|Form|Biểu mẫu|Câu trả lời|Ứng viên/i.test(t);
            }) || sheets[0];

            if (found?.properties?.title) {
              targetSheetTitle = found.properties.title;
              const candRes: any = await this.sheetsCall('read.candidates', () =>
                this.sheetsClient!.spreadsheets.values.get({
                  spreadsheetId: this.candidateSpreadsheetId,
                  range: `'${targetSheetTitle}'!A1:ZZ`,
                }) as any, 25000);
              candRows = (candRes.data.values as string[][]) || [];
            }
          } catch (e: any) {
            console.warn('[GoogleSheetsSyncService] Đọc candidateSpreadsheetId gặp lỗi, thử master sheet:', e.message);
          }
        }

        // B. Nếu chưa có dữ liệu từ candidateSpreadsheetId, thử đọc từ Master spreadsheet
        if (candRows.length <= 1 && this.spreadsheetId) {
          try {
            const candRes: any = await this.sheetsCall('read.candidatesMaster', () =>
              this.sheetsClient!.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: `'FROM_NHAN_VIEN'!A1:ZZ`,
              }) as any, 25000);
            if (candRes.data.values && candRes.data.values.length > 1) {
              candRows = candRes.data.values as string[][];
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

        const dataRows = candRows.slice(1);
        fallback.candidates = dataRows
          .filter(r => r && r.length > 0 && r.some(cell => String(cell || '').trim().length > 0))
          .map((r, idx) => {
            const getVal = (colIdx: number) => (r[colIdx] !== undefined ? String(r[colIdx]).trim() : '');

            const rawCreatedAt = getVal(colTimestamp) || new Date().toISOString();
            const fullName = getVal(colFullName) || `Ứng viên ${idx + 1}`;
            const gender = getVal(colGender) || 'Nam';
            const birthRaw = getVal(colBirthYear);
            const birthYear = Number(birthRaw?.replace(/\D/g, '').slice(-4)) || 2002;
            const educationLevel = getVal(colEducation) || 'THPT / Cao đẳng';
            const hometown = getVal(colHometown) || 'TP. Hồ Chí Minh';
            const phone = getVal(colPhone) || '';
            const phoneNormalized = canonicalPhone(phone);
            const registeredShift = getVal(colShift) || 'Ca sáng / Ca chiều';
            const branchName = getVal(colBranch) || 'CN130 - Lê Văn Sỹ';
            const experience = getVal(colExperience) || 'Chưa có kinh nghiệm (sẵn sàng đào tạo)';
            const emergencyHandling = getVal(colEmergency) || 'Sẵn sàng hỗ trợ và tăng ca khi có điều động đột xuất';

            let facebookUrl = getVal(colFacebook);
            if (facebookUrl && !facebookUrl.startsWith('http://') && !facebookUrl.startsWith('https://')) {
              if (facebookUrl.includes('facebook.com')) {
                facebookUrl = 'https://' + facebookUrl;
              } else {
                facebookUrl = `https://facebook.com/${facebookUrl.replace(/^@/, '')}`;
              }
            }

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
            const prev = prevById.get(submissionId) || {};
            // Sheet form gốc không có trạng thái -> 'NEW'/trống thì giữ trạng thái bộ nhớ (INVITED...)
            const status = (rawStatus && rawStatus !== 'NEW' ? rawStatus : (prev.status && prev.status !== 'NEW' ? prev.status : (rawStatus || 'NEW'))) as any;
            // VIP (ưu tiên vào việc) là trường vận hành do HR đánh dấu trên hệ thống,
            // Sheet form không có cột này -> phải overlay từ bộ nhớ, nếu không pull nền
            // (~10s) sẽ xóa mất toàn bộ VIP/VIP rank.
            const vip = prev.vip === true;
            const vipRank = vip ? (Number(prev.vip_rank) || 0) : undefined;

            return {
              submission_id: submissionId,
              interview_date: getVal(colInterviewDate) || prev.interview_date || undefined,
              interview_time_slot: getVal(colInterviewSlot) || prev.interview_time_slot || undefined,
              interviewer_id: getVal(colInterviewer) || prev.interviewer_id || undefined,
              interview_score: prev.interview_score,
              interview_rubric: prev.interview_rubric || undefined,
              interview_score_detail: prev.interview_score_detail || undefined,
              zalo_invite_status: getVal(colZaloStatus) || prev.zalo_invite_status || undefined,
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
              education_level: educationLevel,
              hometown,
              apply_position: 'Nhân viên Bán hàng',
              // Ca + chi nhánh là trường vận hành do HR chốt (Cập nhật TT): form gốc không
              // đổi sau khi gửi, nên ưu tiên giá trị bộ nhớ (HR vừa cập nhật) — nếu không
              // pull nền (~10s) sẽ dựng lại từ form và đè mất, HR thấy "lưu thành công
              // nhưng dữ liệu không đổi".
              preferred_branch_id: (prev as any).preferred_branch_id || (branchName.includes('CN') ? (branchName.match(/CN\d+/)?.[0] || 'CN130') : 'CN130'),
              branch_name: (prev as any).branch_name || branchName,
              registered_shift: (prev as any).registered_shift || registeredShift,
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
          if (this.sheetsClient && this.spreadsheetId) {
            const mRes: any = await this.sheetsCall('read.candidatesOverlay', () =>
              this.sheetsClient!.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                // A2:ZZ (không lấy tiêu đề) để cùng biểu diễn với batchGet dùng
                // cho hash nội dung — tránh mỗi lần webhook/pull lại báo "đổi" giả.
                range: `'FROM_NHAN_VIEN'!A2:ZZ`,
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
              mRows.forEach((r, i) => {
                if (!r || !r.some(c => String(c || '').trim())) return;
                byId.set(`CAND_${String(i + 1).padStart(4, '0')}`, r);
                const ph = canonicalPhone(String(r[6] || ''));
                const nm = String(r[1] || '').trim().toLowerCase();
                if (ph && nm) byPhoneName.set(`${ph}|${nm}`, r);
              });
              for (const c of fallback.candidates as any[]) {
                const mr = byId.get(c.submission_id)
                  || byPhoneName.get(`${c.phone_normalized || ''}|${String(c.full_name || '').trim().toLowerCase()}`);
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
                // Ca + chi nhánh HR đã chốt (Cập nhật TT) lưu ở master cột 7/8: phủ lại để
                // bền vững qua restart (bộ nhớ trắng, form gốc chỉ còn giá trị ban đầu).
                // PUT đã đẩy master đồng bộ (await) trước khi trả response nên master tươi.
                if (nz(mr[7]) !== undefined) c.registered_shift = nz(mr[7]) as any;
                const mBranch = nz(mr[8]);
                if (mBranch !== undefined) {
                  c.branch_name = mBranch as any;
                  const mCode = String(mBranch).match(/CN\d+/i)?.[0]?.toUpperCase();
                  if (mCode) c.preferred_branch_id = mCode as any;
                }
                c.interview_date = nz(mr[17]) || c.interview_date;
                c.interview_time_slot = nz(mr[18]) || c.interview_time_slot;
                c.interviewer_id = nz(mr[19]) || c.interviewer_id;
                c.zalo_invite_status = nz(mr[20]) || c.zalo_invite_status;
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
          spreadsheetId: this.spreadsheetId,
          range: `'${sheetTitle}'!A2:ZZ`,
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
          spreadsheetId: this.spreadsheetId,
          range: `'${safe}'!A2:ZZ`,
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
          spreadsheetId: this.spreadsheetId,
          range,
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
    try {
      const res = await this.sheetsCall('read.batchGet', () =>
        this.sheetsClient!.spreadsheets.values.batchGet({
          spreadsheetId: this.spreadsheetId,
          ranges: sheetTitles.map(t => `'${t}'!A2:ZZ`),
        }), timeoutMs
      );
      const groups = res.data.valueRanges || [];
      for (let i = 0; i < sheetTitles.length; i++) {
        out[sheetTitles[i]] = (groups[i]?.values as string[][]) || [];
      }
    } catch (e) {
      // Giữ nguyên hành vi cũ: lỗi -> tab rỗng (caller tự fallback).
    }
    return out;
  }

  /**
   * Đồng bộ cấu hình kỹ thuật hệ thống lên tab CAU_HINH_HE_THONG trên Google Sheets
   */
  public async syncSystemSettingsToSheet(settings: any): Promise<boolean> {
    if (!this.sheetsClient) return false;
    try {
      const rows = Object.entries(settings || {}).map(([k, v]) => [
        k,
        typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''),
        `Cấu hình tham số ${k}`,
        new Date().toISOString(),
      ]);
      await this.overwriteSheetData('CAU_HINH_HE_THONG', ['Tham Số', 'Giá Trị', 'Mô Tả', 'Cập Nhật Lần Cuối'], rows);
      return true;
    } catch (err: any) {
      console.warn('[GoogleSheetsSyncService] Lỗi ghi CAU_HINH_HE_THONG:', err?.message || err);
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

  private async pushTabSafe(details: any, key: string, title: string, headers: string[], rows: any[][]): Promise<void> {
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
        await this.overwriteSheetData(title, headers, rows);
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
          f.period, f.rateTV ?? 21000, f.rateCT ?? 25500, f.otPerSlot ?? 30000,
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
          c.birth_year ? String(c.birth_year) : '2002',
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
          (c as any).zalo_invite_status || '',
          (c as any).zalo_invite_at || '',
          (c as any).interview_score ?? '',
          (c as any).interview_score_detail || '',
          (c as any).vip ? 'VIP' : '',
          (c as any).vip_rank !== undefined && (c as any).vip_rank !== null ? String((c as any).vip_rank) : '',
        ]);
        await this.pushTabSafe(details, 'candidates', 'FROM_NHAN_VIEN', candHeaders, candRows);
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
  public async pushPayslipsTab(repo: ISheetsRepository): Promise<number> {
    const slipsForPush = await this.collectAllPayslips(repo);
    const slipPushRows = (slipsForPush || []).map((s: any) => ([
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
      s.allowance ?? 0,
      s.bonus ?? 0,
      s.deduction ?? 0,
      s.net_pay ?? 0,
      s.status || 'DRAFT',
      s.ot_slots ?? '',
      s.phu_cap_ot ?? '',
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
    ]));
    await this.overwriteSheetData('PHIEU_LUONG', SHEETS_DEFINITIONS.find(d => d.title === 'PHIEU_LUONG')!.headers, slipPushRows);
    return slipPushRows.length;
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
      c.birth_year ? String(c.birth_year) : '2002',
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
      (c as any).zalo_invite_status || '',
      (c as any).zalo_invite_at || '',
      (c as any).interview_score ?? '',
      (c as any).interview_score_detail || '',
      (c as any).vip ? 'VIP' : '',
      (c as any).vip_rank !== undefined && (c as any).vip_rank !== null ? String((c as any).vip_rank) : '',
    ]);
    await this.overwriteSheetData('FROM_NHAN_VIEN', candHeaders, candRows);
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

  /** Drive đã cấu hình service account chưa (job backup dùng để bỏ qua sớm). */
  public isDriveReady(): boolean {
    return !!this.driveClient;
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

  /** Upload/ghi đè 1 file vào đường dẫn folder (idempotent theo tên file). */
  public async upsertBufferToDrivePath(
    fileName: string,
    mimeType: string,
    buffer: Buffer,
    segments: string[],
  ): Promise<{ fileId: string; webViewLink?: string }> {
    if (!this.driveClient) return { fileId: `DRV_${Date.now()}` };
    const parent = await this.ensureDriveFolderPath(segments);
    if (!parent) return { fileId: `DRV_LOCAL_${Date.now()}` };
    const safeName = String(fileName || 'file').replace(/[\\/:*?"<>|]/g, '-').trim() || 'file';
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
      return {
        fileId: created?.data?.id || `DRV_${Date.now()}`,
        webViewLink: created?.data?.webViewLink || undefined,
      };
    } catch (err: any) {
      console.warn(`[GoogleSheetsSyncService] Upload Drive "${safeName}" lỗi:`, err?.message || err);
      return { fileId: `DRV_LOCAL_${Date.now()}` };
    }
  }

  /** Upload 1 file MỚI vào đường dẫn folder (không dò trùng — dùng lúc chấm công). */
  public async uploadBufferToDrivePath(
    fileName: string,
    mimeType: string,
    buffer: Buffer,
    segments: string[],
  ): Promise<{ fileId: string; webViewLink?: string }> {
    if (!this.driveClient) return { fileId: `DRV_${Date.now()}` };
    const parent = await this.ensureDriveFolderPath(segments);
    if (!parent) return { fileId: `DRV_LOCAL_${Date.now()}` };
    const safeName = String(fileName || 'file').replace(/[\\/:*?"<>|]/g, '-').trim() || 'file';
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
      return {
        fileId: created?.data?.id || `DRV_${Date.now()}`,
        webViewLink: created?.data?.webViewLink || undefined,
      };
    } catch (err: any) {
      console.warn(`[GoogleSheetsSyncService] Upload Drive "${safeName}" lỗi:`, err?.message || err);
      return { fileId: `DRV_LOCAL_${Date.now()}` };
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
          spreadsheetId: this.spreadsheetId,
          range: `'${t}'!A:ZZ`,
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
      driveConfigured: !!this.driveClient,
      lastError: this.lastDriveUploadError,
      lastAttemptAt: this.lastDriveUploadAt,
      lastOkAt: this.lastDriveUploadOkAt,
    };
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
    if (!this.driveClient) {
      this.lastDriveUploadError = 'DRIVE_NOT_CONFIGURED: chưa cấu hình service account Drive';
      return { fileId: `DRV_${Date.now()}` };
    }

    const cleanBase64 = String(base64Data || '').replace(/^data:[^;,]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    if (!buffer.length) {
      this.lastDriveUploadError = 'EMPTY_FILE: file rỗng, không thể upload Drive';
      return { fileId: `DRV_LOCAL_${Date.now()}` };
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
        this.lastDriveUploadError = null;
        this.lastDriveUploadOkAt = new Date().toISOString();

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
    const msg = String(lastErr?.message || lastErr);
    this.lastDriveUploadError = msg;
    this.lastDriveUploadAt = new Date().toISOString();
    console.error('[GoogleSheetsSyncService] Upload Drive thất bại sau 3 lần:', msg);
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

  /** Tải bytes ảnh từ Google Drive (để xem trực tiếp / đóng gói ZIP tải về). */  public async downloadDriveFile(fileId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!this.driveClient || !fileId || fileId.startsWith('DRV_')) {
      throw new Error('DRIVE_FILE_NOT_AVAILABLE');
    }
    const res: any = await this.sheetsCall(
      'drive.download',
      () =>
        this.driveClient!.files.get({ fileId, alt: 'media', supportsAllDrives: true } as any, { responseType: 'arraybuffer' }) as any,
      45000
    );
    const data = res?.data;
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const meta: any = await this.sheetsCall('drive.get', () => this.driveClient!.files.get({ fileId, fields: 'mimeType', supportsAllDrives: true } as any) as any).catch(() => null);
    return { buffer, mimeType: meta?.data?.mimeType || 'image/jpeg' };
  }

  /**
   * Ghi đè dữ liệu một Sheet tab (giữ nguyên tiêu đề ở dòng 1)
   */
  public async overwriteSheetData(sheetTitle: string, headers: string[], rows: any[][], allowEmpty = false) {
    if (!this.sheetsClient) return;

    // BẢO VỆ CHỐNG MẤT DỮ LIỆU: Tab Master không được phép xoá sạch dữ liệu (0 dòng)
    if (rows.length === 0 && GoogleSheetsSyncService.CRITICAL_TABS.has(sheetTitle) && !allowEmpty) {
      console.warn(`[GoogleSheetsSyncService] CHẶN GHI ĐÈ RỖNG: Tab Master '${sheetTitle}' không được phép ghi đè 0 dòng!`);
      return;
    }

    // Ghi đè AN TOÀN: ghi dữ liệu mới TRƯỚC (A1...), rồi mới xóa phần đuôi thừa.
    // (Bản cũ xóa trước-ghi sau: crash/quota ở giữa = mất trắng tab.)
    const allValues = [headers, ...rows];
    try {
      await this.sheetsCall(`write.${sheetTitle}`, () =>
        this.sheetsClient!.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `'${sheetTitle}'!A1`,
          valueInputOption: 'USER_ENTERED',
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
    // để tab >26 cột (PHIEU_LUONG 39 cột) cũng sạch đuôi ở cột AA+.
    try {
      await this.sheetsCall(`clear.${sheetTitle}`, () =>
        this.sheetsClient!.spreadsheets.values.clear({
          spreadsheetId: this.spreadsheetId,
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
    this.tabListCache = null;
  }

  /** Danh sách title tab hiện hữu (metadata; cache 10 phút). */
  public async listSpreadsheetTabs(): Promise<string[]> {
    if (this.tabListCache && Date.now() - this.tabListCache.at < 600_000) return this.tabListCache.titles;
    const res = await this.sheetsCall('meta.tabs', () =>
      this.sheetsClient!.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        fields: 'sheets.properties.title',
      })
    );
    const titles = (res.data.sheets || []).map((s: any) => s.properties?.title || '').filter(Boolean);
    this.tabListCache = { at: Date.now(), titles };
    return titles;
  }

  /** Số dòng dữ liệu của tab (cache; -1 = không đo được -> KHÔNG xoay, an toàn). */
  private async getDataRowCount(title: string): Promise<number> {
    if (this.partRowCounts.has(title)) return this.partRowCounts.get(title)!;
    try {
      const res = await this.sheetsCall(`count.${title}`, () =>
        this.sheetsClient!.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
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
          spreadsheetId: this.spreadsheetId,
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
    let n = 2;
    while (n < 200) {
      const title = `${base}_P${n}`;
      const titles = await this.listSpreadsheetTabs();
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

  /** Tạo tab partition + header giống hệt tab gốc. */
  private async createPartitionTab(base: string, title: string): Promise<void> {
    const headers = SHEETS_DEFINITIONS.find(d => d.title === base)?.headers || [];
    await this.sheetsCall(`part.add.${title}`, () =>
      this.sheetsClient!.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } }] },
      })
    );
    if (headers.length) {
      await this.sheetsCall(`part.header.${title}`, () =>
        this.sheetsClient!.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
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
    const titles = await this.listSpreadsheetTabs();
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
    const limit = 10_000_000; // giới hạn Google thực tế
    if (this.cellUsageCache && Date.now() - this.cellUsageCache.at < 21_600_000) return this.cellUsageCache.data;
    const titles = await this.listSpreadsheetTabs().catch(() => [] as string[]);
    const measurable = titles.filter(t => {
      const b = t.replace(/_P\d+$/, '');
      return GoogleSheetsSyncService.PARTITION_TABS.has(t) || GoogleSheetsSyncService.PARTITION_TABS.has(b) || SHEETS_DEFINITIONS.some(d => d.title === t);
    });
    let cellsUsed = 0;
    if (measurable.length) {
      const batch = await this.readTabsBatch(measurable).catch(() => ({} as Record<string, string[][]>));
      for (const t of measurable) {
        const b = t.replace(/_P\d+$/, '');
        const cols = SHEETS_DEFINITIONS.find(d => d.title === b || d.title === t)?.headers?.length || 12;
        cellsUsed += (batch[t]?.length || 0) * cols;
      }
    }
    const pct = Math.min(100, Math.round((cellsUsed / limit) * 1000) / 10);
    const level: 'OK' | 'WARN' | 'CRITICAL' = pct >= 90 ? 'CRITICAL' : pct >= 75 ? 'WARN' : 'OK';
    const data = {
      cellsUsed,
      cellsLimit: limit,
      pct,
      level,
      measuredTabs: measurable.length,
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
      await this.sheetsCall(`append.${target}`, () =>
        this.sheetsClient!.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
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
      await this.sheetsCall(`append.${target}`, () =>
        this.sheetsClient!.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
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
