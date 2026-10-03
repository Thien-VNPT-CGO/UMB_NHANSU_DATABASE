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
import { hashPasswordSync, isBcryptHash, hashPin, generateAutoPin } from './password.service.js';
import { canonicalPhone } from './employees.service.js';
import { normSheetDate, sheetDateText } from './employees.service.js';
import { evaluateCandidateAiScore } from './ai-scorer.js';
import { buildZipStore, ZipEntry } from '../utils/zip-store.js';

export interface SheetDefinition {
  title: string;
  headers: string[];
}

export const SHEETS_DEFINITIONS: SheetDefinition[] = [
  {
    title: 'NHAN_VIEN_MASTER',
    headers: ['ID Nhân Viên', 'Mã NV', 'Họ Và Tên', 'Số Điện Thoại', 'Trạng Thái', 'Nhóm', 'Chi Nhánh', 'Lương Giờ (VNĐ)', 'Ngày Bắt Đầu', 'Phiên Bản', 'Ca Cố Định', 'Ngày Chính Thức', 'Email'],
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
    headers: ['ID Đổi Ca', 'Người Yêu Cầu', 'Ca Yêu Cầu', 'Người Nhận', 'Ca Đổi', 'Lý Do', 'Trạng Thái', 'Người Duyệt', 'Ngày Tạo', 'Loại Phiếu', 'Phụ Cấp (đ)'],
  },
  {
    title: 'DIEU_CHINH_CONG',
    headers: ['ID Điều Chỉnh', 'ID Ca', 'ID Nhân Viên', 'Lý Do', 'Số Phút Được Duyệt', 'Người Duyệt', 'Trạng Thái', 'Ghi Chú'],
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
    headers: ['ID Phiếu', 'Mã Kỳ Lương', 'ID Nhân Viên', 'Mã NV', 'Họ Và Tên', 'Kỳ Lương', 'Số Ca', 'Ca Vắng', 'Giờ Chuẩn', 'Đơn Giá', 'Lương Chuẩn', 'Phụ Cấp', 'Thưởng', 'Khấu Trừ', 'Thực Nhận', 'Trạng Thái'],
  },
  {
    title: 'LICH_SU_GIAI_DOAN',
    headers: ['ID Giai Đoạn', 'ID Nhân Viên', 'Giai Đoạn', 'Hiệu Lực Từ', 'Lương Giờ', 'Người Duyệt', 'Ghi Chú', 'Phiên Bản', 'Ngày Tạo'],
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
  private spreadsheetId: string;
  private candidateSpreadsheetId: string;
  private driveFolderId: string;
  private isConfigured = false;
  private authError: string | null = null;
  private lastPulledAt: number = 0;
  /** Tombstone NV vừa xóa: pull trong ~120s sau xóa mà thấy ID này trên Sheet
   *  (push xóa chưa kịp chạy) thì bỏ qua, tránh xóa xong bị khôi phục lại. */
  private deletedEmployeeIds = new Map<string, number>();
  /** Tombstone sự kiện điểm danh vừa xóa (GPS vượt): pull trước khi push xóa kịp
   *  mà đọc lại dòng cũ thì bỏ qua, tránh hồi sinh trong ~120s. */
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
  private lastWriteError: string | null = null;
  private lastWriteAt: number = 0;
  private initOkAt = 0;
  private lastInitResult: { success: boolean; createdSheets: string[]; existingSheets: string[]; message: string } | null = null;

  /** Minimum interval between write requests to stay under 60 writes/minute quota. */
  private static readonly WRITE_RATE_LIMIT_MS = 1100;

  /** Bọc mọi gọi Google API bằng timeout + rate limiting cho write operations. */
  private async sheetsCall<T>(label: string, fn: () => Promise<T>, ms = 20000): Promise<T> {
    const isWrite = label.startsWith('write.') || label.startsWith('append.') || label.startsWith('clear.') || label === 'init.batchUpdate';
    
    if (isWrite) {
      const now = Date.now();
      const wait = Math.max(0, GoogleSheetsSyncService.WRITE_RATE_LIMIT_MS - (now - this.lastWriteAt));
      if (wait > 0) {
        await new Promise(r => setTimeout(r, wait));
      }
      this.lastWriteAt = Date.now();
    }

    let timer: any = null;
    try {
      return await Promise.race([
        fn(),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`SHEETS_TIMEOUT:${label} (${ms}ms)`)), ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
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
    const msg = `${where}: ${err?.message || err}`;
    this.lastWriteError = msg;
    console.warn(`[GoogleSheetsSyncService] ${msg}`);
  }

  constructor() {
    this.spreadsheetId = process.env.SPREADSHEET_ID || process.env.GOOGLE_SPREADSHEET_ID || '17iXM0zc1m17aX9AZrFMjOkPRMy2_CwWfjTRZSUPQF2w';
    this.candidateSpreadsheetId = process.env.CANDIDATE_SPREADSHEET_ID || '1rcqEKraSRhr-Tn9qwlhADlkQUei8j65bXeHF_Tmkd38';
    this.driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '';

    this.initClient();
  }

  private initClient() {
    let email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    let key = process.env.GOOGLE_PRIVATE_KEY;

    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      try {
        const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
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
      ...this.getWriteStatus(),
      sheetsCount: SHEETS_DEFINITIONS.length,
      definedTabs: SHEETS_DEFINITIONS.map(d => d.title),
    };
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
      const res = await this.sheetsCall('init.get', () =>
        this.sheetsClient!.spreadsheets.get({
          spreadsheetId: this.spreadsheetId,
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

      for (const def of SHEETS_DEFINITIONS) {
        await this.sheetsCall(`init.header.${def.title}`, () =>
          this.sheetsClient!.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: `'${def.title}'!A1:Z1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [def.headers],
            },
          })
        );
      }

      console.log(`[GoogleSheetsSyncService] Đã tạo ${createdSheets.length} sheet mới. Toàn bộ ${SHEETS_DEFINITIONS.length} tab sẵn sàng.`);

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
   * ĐỌC DỮ LIỆU THỰC TẾ TỪ GOOGLE SHEETS VÀ CẬP NHẬT VÀO HỆ THỐNG (TWO-WAY SYNC)
   */
  public async pullAllDataFromGoogleSheets(repo: ISheetsRepository): Promise<{ success: boolean; message: string; counts: any }> {
    if (!this.isConfigured || !this.sheetsClient) {
      return { success: false, message: 'Google Sheets chưa kết nối', counts: null };
    }

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
      const batch = await this.readTabsBatch([
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
        'THONGBAO_NV',
        'PHIEU_LUONG',
        'LICH_SU_GIAI_DOAN',
      ]);

      // Đọc lỗi/quota trả về toàn rỗng trong khi bộ nhớ đang có dữ liệu thật
      // -> GIỮ NGUYÊN bộ nhớ, không ghi đè rỗng (tránh mất dữ liệu + login fail oan).
      const gotAnyRows = Object.values(batch).some(arr => arr.length > 0);
      const hadMemoryData = fallback.employees.length + fallback.accounts.length > 0;
      if (!gotAnyRows && hadMemoryData) {
        console.warn('[GoogleSheetsSyncService] Batch read trả về rỗng (nghi lỗi API/quota) — giữ nguyên dữ liệu trong bộ nhớ.');
        return { success: false, message: 'Empty batch read — keeping in-memory data', counts: null };
      }

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
            if (m && Number(m.version || 0) > Number((s as any).version || 0)) {
              mergedEmps.push(m);
            } else {
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
          .map(r => ({
            account_id: r[0] || `ACC_${uuidv4().slice(0, 8)}`,
            employee_id: r[1] || '',
            phone_normalized: canonicalPhone(r[2] || ''),
            role: (r[3] as any) || 'EMPLOYEE',
            account_status: 'ACTIVE' as any,
            branch_scope: 'ALL',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            version: Number(r[5]) || 1,
            pin_hash: r[6] || undefined,
            pin_must_change: r[7] === 'YES',
            // Cột Mã PIN bản rõ — chỉ hiển thị trên cổng quản trị (Admin/HR).
            pin_code: r[8] || undefined,
            // Cột Đổi PIN Cuối (ISO) + Kỳ PIN (YYYY-MM): tự đổi định kỳ hàng tháng 1-5.
            pin_changed_at: r[9] || undefined,
            pin_rotation_cycle: r[10] || undefined,
          }));
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
          assignment_id: r[0] || `SHF_${uuidv4().slice(0, 8)}`,
          employee_id: r[1],
          branch_id: r[2] || 'CN130',
          shift_code: (r[3] as any) || 'CA_1',
          date: normSheetDate(r[4]) || new Date().toISOString().split('T')[0],
          start_at: r[5] || new Date().toISOString(),
          end_at: r[6] || new Date().toISOString(),
          status: (r[7] as any) || 'PUBLISHED',
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
          if (m && Number(m.schedule_version || 0) > Number((s as any).schedule_version || 0)) {
            mergedShifts.push(m);
          } else {
            mergedShifts.push(s);
          }
          memShiftById.delete((s as any).assignment_id);
        }
        for (const m of memShiftById.values()) mergedShifts.push(m);
        fallback.shifts = mergedShifts as any;
      } else if (fallback.shifts.length === 0) {
        fallback.shifts = [];
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
            request_id: r[0] || `LV_${uuidv4().slice(0, 8)}`,
            employee_id: r[1],
            branch_id: r[2] || 'CN130',
            leave_type: leaveType,
            requested_date: normSheetDate(r[4]) || new Date().toISOString().split('T')[0],
            shift_code: (r[5] as any) || undefined,
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
      if (notifRows.length > 0) {
        const mappedNotif = notifRows
          .filter(r => r && r[0])
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
        (n: any) => (n.created_at || '') >= notifCutoff
      );
      counts.notifications = fallback.notificationInbox.length;

      // 6. Đọc SU_KIEN_DIEM_DANH
      const attRows = (batch['SU_KIEN_DIEM_DANH'] || []).filter(r => r && r[0] && !this.isEventDeletedRecently(r[0]));
      if (keepIfEmpty('SU_KIEN_DIEM_DANH', attRows, fallback.attendanceEvents.length)) {
        counts.attendanceEvents = fallback.attendanceEvents.length;
      } else if (attRows.length > 0) {
        const mappedEvents = attRows.map(r => ({
          event_id: r[0] || `ATT_${uuidv4().slice(0, 8)}`,
          request_id: r[10] || uuidv4(),
          assignment_id: r[1] || '',
          employee_id: r[2] || '',
          branch_id: '',
          type: (r[3] as any) || 'CHECK_IN',
          // Ưu tiên giờ máy khách (kèm +07:00) để lọc đúng ngày VN; dòng cũ lấy giờ server
          client_time: r[12] || r[4] || new Date().toISOString(),
          server_received_at: r[4] || new Date().toISOString(),
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
          created_at: r[4] || new Date().toISOString(),
        }));
        fallback.attendanceEvents = mergeById(fallback.attendanceEvents, mappedEvents, 'event_id', ['created_at']);
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
                ? process.env.ADMIN_SEED_PASSWORD || 'Master@@2027'
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
          this.appendRow('ADMIN_ACCOUNTS', [
            seed.admin_id,
            seed.username,
            seed.password_hash,
            seed.full_name,
            seed.role,
            seed.branch_scope,
            (seed as any).is_active === false ? 'LOCKED' : 'ACTIVE',
            seed.created_at,
          ]).catch(err => console.warn('[GoogleSheetsSyncService] Could not auto-seed default account:', err));
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
          swap_kind: (r[9] === 'HR_DISPATCH' ? 'HR_DISPATCH' : 'EMPLOYEE_SWAP') as any,
          requester_id: r[1] || '',
          requester_assignment_id: r[2] || '',
          target_employee_id: r[3] || '',
          target_assignment_id: r[4] || '',
          reason: r[5] || '',
          status: (r[6] as any) || 'PENDING_PARTNER',
          approved_by: r[7] || undefined,
          bonus_amount: Number(r[10]) || 0,
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
          version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));
        fallback.attendanceAdjustments = mergeById(fallback.attendanceAdjustments, mappedAdj, 'adjustment_id', ['version']) as any;
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
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            version: 1,
          }));
        fallback.payslips = mergeById(fallback.payslips || [], mappedSlips, 'item_id', ['version']) as any;
        counts.payslips = fallback.payslips.length;
      } else if ((fallback.payslips || []).length === 0) {
        fallback.payslips = [];
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
            if (settingsObj[k] !== undefined && settingsObj[k] !== null) {
              (fallback as any)[k] = settingsObj[k];
            }
          }
        }
      }

      // 12. Đọc Ứng viên tuyển dụng từ Form ứng viên Google Sheets (đầy đủ 17 cột)
      let candRows: string[][] = [];
      let targetSheetTitle = 'FROM_NHAN_VIEN';

      if (this.sheetsClient) {
        // A. Thử đọc từ candidateSpreadsheetId trước (bọc timeout: Google treo
        // request này là cả pull treo theo, UI chờ vô hạn).
        if (this.candidateSpreadsheetId) {
          try {
            const meta: any = await this.sheetsCall('read.candidateMeta', () =>
              this.sheetsClient!.spreadsheets.get({
                spreadsheetId: this.candidateSpreadsheetId,
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
                  range: `'${targetSheetTitle}'!A1:X`,
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
                range: `'FROM_NHAN_VIEN'!A1:X`,
              }) as any, 25000);
            if (candRes.data.values && candRes.data.values.length > 1) {
              candRows = candRes.data.values as string[][];
            }
          } catch (e) {
            // Sheet FROM_NHAN_VIEN chưa được tạo trên master
          }
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
              full_name: fullName,
              phone_normalized: phoneNormalized,
              phone,
              gender,
              birth_year: birthYear,
              education_level: educationLevel,
              hometown,
              apply_position: 'Nhân viên Bán hàng',
              preferred_branch_id: branchName.includes('CN') ? (branchName.match(/CN\d+/)?.[0] || 'CN130') : 'CN130',
              branch_name: branchName,
              registered_shift: registeredShift,
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
                range: `'FROM_NHAN_VIEN'!A1:X`,
              }) as any, 25000);
            const mRows = (mRes.data.values as string[][]) || [];
            if (mRows.length > 1) {
              const byId = new Map<string, string[]>();
              const byPhoneName = new Map<string, string[]>();
              mRows.slice(1).forEach((r, i) => {
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

      this.lastPulledAt = Date.now();
      console.log('[GoogleSheetsSyncService] Đã tải dữ liệu thực tế từ Google Sheets thành công:', counts);

      return {
        success: !partialError,
        message: partialError
          ? `Pull một phần (tab chính OK, tab phụ lỗi: ${partialError})`
          : 'Đã tải và cập nhật toàn bộ dữ liệu thật từ Google Sheets thành công!',
        counts,
      };
    } catch (err: any) {
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
          range: `'${sheetTitle}'!A2:Z`,
        })
      );
      return (res.data.values as string[][]) || [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Đọc NHIỀU tab trong 1 HTTP round-trip (batchGet) — nhanh gấp ~N lần so với
   * đọc nối tiếp từng tab. Dùng cho full-pull realtime.
   */
  public async readTabsBatch(sheetTitles: string[]): Promise<Record<string, string[][]>> {
    const out: Record<string, string[][]> = {};
    for (const t of sheetTitles) out[t] = [];
    if (!this.sheetsClient || sheetTitles.length === 0) return out;
    try {
      const res = await this.sheetsCall('read.batchGet', () =>
        this.sheetsClient!.spreadsheets.values.batchGet({
          spreadsheetId: this.spreadsheetId,
          ranges: sheetTitles.map(t => `'${t}'!A2:Z`),
        })
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
   * ĐỒNG BỘ DỮ LIỆU LÊN GOOGLE SHEETS (GHI ĐÈ DỮ LIỆU)
   */
  public async syncAllData(repo: ISheetsRepository): Promise<{ success: boolean; message: string; details: any }> {
    const initResult = await this.initSpreadsheetStructure();
    if (!initResult.success) {
      return { success: false, message: initResult.message, details: null };
    }

    if (!this.sheetsClient) {
      return { success: false, message: 'Google Sheets client không khả dụng', details: null };
    }

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
      await this.overwriteSheetData('ADMIN_ACCOUNTS', SHEETS_DEFINITIONS.find(d => d.title === 'ADMIN_ACCOUNTS')!.headers, adminRows);
      details.adminAccounts = adminRows.length;

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
      await this.overwriteSheetData('DANH_SACH_CHI_NHANH', SHEETS_DEFINITIONS.find(d => d.title === 'DANH_SACH_CHI_NHANH')!.headers, branchRows);
      details.branches = branchRows.length;

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
      ]);
      await this.overwriteSheetData('NHAN_VIEN_MASTER', SHEETS_DEFINITIONS.find(d => d.title === 'NHAN_VIEN_MASTER')!.headers, employeeRows);
      details.employees = employeeRows.length;

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
      await this.overwriteSheetData('TAI_KHOAN_NHAN_VIEN', SHEETS_DEFINITIONS.find(d => d.title === 'TAI_KHOAN_NHAN_VIEN')!.headers, accountRows);
      details.accounts = accountRows.length;

      // 5. Phân công ca — giữ 60 ngày quá khứ + toàn bộ tương lai (trước đây chỉ
      // từ hôm nay trở đi nên ca cũ bị xóa khỏi Sheet sau mỗi full-sync).
      const sixtyDaysAgo = new Date(Date.now() + 7 * 3_600_000 - 60 * 86_400_000).toISOString().slice(0, 10);
      const shifts = await repo.getShiftsForWeek('*', sixtyDaysAgo);
      const shiftRows = shifts.map(s => [
        s.assignment_id,
        s.employee_id,
        s.branch_id,
        s.shift_code,
        sheetDateText(s.date),
        s.start_at,
        s.end_at,
        s.status,
        s.schedule_version,
      ]);
      await this.overwriteSheetData('PHAN_CONG_CA', SHEETS_DEFINITIONS.find(d => d.title === 'PHAN_CONG_CA')!.headers, shiftRows);
      details.shifts = shiftRows.length;

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
      await this.overwriteSheetData('DON_NGHI_PHEP', SHEETS_DEFINITIONS.find(d => d.title === 'DON_NGHI_PHEP')!.headers, leaveRows);
      details.leaves = leaveRows.length;

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
      await this.overwriteSheetData('BAI_THI', SHEETS_DEFINITIONS.find(d => d.title === 'BAI_THI')!.headers, paperRows);
      details.testPapers = paperRows.length;
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
      await this.overwriteSheetData('BAI_LAM', SHEETS_DEFINITIONS.find(d => d.title === 'BAI_LAM')!.headers, subRows);
      details.testSubmissions = subRows.length;

      // 6c. Phiếu lương chi tiết (trước đây chỉ nằm bộ nhớ — restart là mất).
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
      ]));
      await this.overwriteSheetData('PHIEU_LUONG', SHEETS_DEFINITIONS.find(d => d.title === 'PHIEU_LUONG')!.headers, slipPushRows);
      details.payslips = slipPushRows.length;

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
      await this.overwriteSheetData('LICH_SU_GIAI_DOAN', SHEETS_DEFINITIONS.find(d => d.title === 'LICH_SU_GIAI_DOAN')!.headers, stagePushRows);
      details.stageHistories = stagePushRows.length;

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
      await this.overwriteSheetData('DON_DOI_CA', SHEETS_DEFINITIONS.find(d => d.title === 'DON_DOI_CA')!.headers, swapRows);
      details.swaps = swapRows.length;

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
      ]);
      await this.overwriteSheetData('DIEU_CHINH_CONG', SHEETS_DEFINITIONS.find(d => d.title === 'DIEU_CHINH_CONG')!.headers, adjRows);
      details.adjustments = adjRows.length;

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
      await this.overwriteSheetData('KY_LUONG', SHEETS_DEFINITIONS.find(d => d.title === 'KY_LUONG')!.headers, payrollRows);
      details.payrollRuns = payrollRows.length;

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
      await this.overwriteSheetData('AUDIT_LOG', SHEETS_DEFINITIONS.find(d => d.title === 'AUDIT_LOG')!.headers, auditRows);
      details.auditLogs = auditRows.length;

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
        ]);
        await this.overwriteSheetData('FROM_NHAN_VIEN', candHeaders, candRows);
        details.candidates = candRows.length;
      }

      // 18. Đồng bộ Cài đặt hệ thống (CAU_HINH_HE_THONG)
      const sysSettings = await repo.getSystemSettings();
      if (sysSettings) {
        await this.syncSystemSettingsToSheet(sysSettings);
        details.systemSettings = Object.keys(sysSettings).length;
      }

      return {
        success: true,
        message: 'Đồng bộ toàn bộ dữ liệu lên Google Sheets thành công!',
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
    ]);
    await this.overwriteSheetData('DIEU_CHINH_CONG', SHEETS_DEFINITIONS.find(d => d.title === 'DIEU_CHINH_CONG')!.headers, adjRows);
    return adjRows.length;
  }

  /**
   * Đẩy riêng tab SU_KIEN_DIEM_DANH (await được): dùng sau khi xóa vi phạm/phạt
   * trên lượt check-in/out để Sheet khớp ngay, pull sau không hồi sinh mức phạt cũ.
   */
  public async pushEventsTab(repo: { getAttendanceEvents(emp?: string, date?: string): Promise<any[]> }): Promise<number> {    const events = await repo.getAttendanceEvents('*', '*').catch(() => []);
    const rows = (events || []).map((e: any) => [
      e.event_id, e.assignment_id, e.employee_id, e.type, e.server_received_at,
      e.gps_latitude ?? '', e.gps_longitude ?? '', e.distance_meters ?? '', e.gps_status || '',
      e.drive_object_id || '', e.request_id || '', e.uniform_pink_ratio ?? '',
      e.client_time || '',
      e.is_late ? 'YES' : '', e.is_early ? 'YES' : '', Number(e.minutes_deviation) || 0,
      e.fine_tier || 'NONE', Number(e.fine_amount) || 0,
    ]);
    await this.overwriteSheetData('SU_KIEN_DIEM_DANH', SHEETS_DEFINITIONS.find(d => d.title === 'SU_KIEN_DIEM_DANH')!.headers, rows);
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
    if (!this.driveClient) {
      this.lastDriveUploadError = 'DRIVE_NOT_CONFIGURED: chưa cấu hình service account Drive';
      return { fileId: `DRV_${Date.now()}` };
    }

    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
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
        e.event_id, e.assignment_id, e.employee_id, e.type, e.server_received_at,
        e.gps_latitude ?? '', e.gps_longitude ?? '', e.distance_meters ?? '', e.gps_status || '',
        e.drive_object_id || '', e.request_id || '', (e as any).uniform_pink_ratio ?? '',
        e.client_time || '',
      ]);
    if (rows.length > 0 && this.sheetsClient) {
      try {
        const existing = await this.readTabsBatch(['LUUTRU_CHAMCONG_TUAN']).catch(() => ({ LUUTRU_CHAMCONG_TUAN: [] as string[][] }));
        const oldRows = existing?.['LUUTRU_CHAMCONG_TUAN'] || [];
        const def = SHEETS_DEFINITIONS.find(dd => dd.title === 'LUUTRU_CHAMCONG_TUAN')!;
        await this.overwriteSheetData('LUUTRU_CHAMCONG_TUAN', def.headers, [...oldRows, ...rows]);
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
          e.event_id, e.assignment_id, e.employee_id, e.type, e.server_received_at,
          e.gps_latitude ?? '', e.gps_longitude ?? '', e.distance_meters ?? '', e.gps_status || '',
          e.drive_object_id || '', e.request_id || '', (e as any).uniform_pink_ratio ?? '',
          e.client_time || '',
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

  /** Tải bytes ảnh từ Google Drive (để xem trực tiếp / đóng gói ZIP tải về). */
  public async downloadDriveFile(fileId: string): Promise<{ buffer: Buffer; mimeType: string }> {
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
  public async overwriteSheetData(sheetTitle: string, headers: string[], rows: any[][]) {
    if (!this.sheetsClient) return;

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

    // Xóa đuôi thừa khi dữ liệu mới ngắn hơn cũ (tránh dòng ma).
    try {
      await this.sheetsCall(`clear.${sheetTitle}`, () =>
        this.sheetsClient!.spreadsheets.values.clear({
          spreadsheetId: this.spreadsheetId,
          range: `'${sheetTitle}'!A${allValues.length + 1}:Z`,
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
  public async appendRow(sheetTitle: string, row: any[]): Promise<boolean> {
    if (!this.isConfigured || !this.sheetsClient) return false;

    try {
      await this.sheetsCall(`append.${sheetTitle}`, () =>
        this.sheetsClient!.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
          range: `'${sheetTitle}'!A:A`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [row],
          },
        })
      );
      this.markWriteOk();
      return true;
    } catch (err) {
      this.markWriteFail(`append ${sheetTitle}`, err);
      console.error(`[GoogleSheetsSyncService] Lỗi append row vào ${sheetTitle}:`, err);
      return false;
    }
  }
}
