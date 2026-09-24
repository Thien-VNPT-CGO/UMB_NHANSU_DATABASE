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

export interface SheetDefinition {
  title: string;
  headers: string[];
}

export const SHEETS_DEFINITIONS: SheetDefinition[] = [
  {
    title: 'NHAN_VIEN_MASTER',
    headers: ['ID Nhân Viên', 'Mã NV', 'Họ Và Tên', 'Số Điện Thoại', 'Trạng Thái', 'Nhóm', 'Chi Nhánh', 'Lương Giờ (VNĐ)', 'Ngày Bắt Đầu', 'Phiên Bản'],
  },
  {
    title: 'TAI_KHOAN_NHAN_VIEN',
    headers: ['ID Tài Khoản', 'ID Nhân Viên', 'Số Điện Thoại', 'Vai Trò', 'Trạng Thái', 'Người Kích Hoạt', 'Ngày Kích Hoạt', 'Phiên Bản'],
  },
  {
    title: 'ADMIN_ACCOUNTS',
    headers: ['ID Admin', 'Tên Đăng Nhập', 'Họ Và Tên', 'Vai Trò', 'Phạm Vi Chi Nhánh', 'Trạng Thái', 'Ngày Tạo'],
  },
  {
    title: 'PHAN_CONG_CA',
    headers: ['ID Ca Làm', 'ID Nhân Viên', 'Mã Chi Nhánh', 'Mã Ca', 'Ngày Làm (YYYY-MM-DD)', 'Bắt Đầu', 'Kết Thúc', 'Trạng Thái', 'Phiên Bản'],
  },
  {
    title: 'SU_KIEN_DIEM_DANH',
    headers: ['ID Sự Kiện', 'ID Ca', 'ID Nhân Viên', 'Loại (IN/OUT)', 'Thời Gian Máy Chủ', 'Vĩ Độ GPS', 'Kinh Độ GPS', 'Khoảng Cách (m)', 'Trạng Thái GPS', 'Ảnh Drive Object', 'ID Yêu Cầu'],
  },
  {
    title: 'DON_NGHI_PHEP',
    headers: ['ID Đơn Nghỉ', 'ID Nhân Viên', 'Chi Nhánh', 'Loại Nghỉ', 'Ngày Nghỉ (YYYY-MM-DD)', 'Ca Làm', 'Lý Do', 'Trạng Thái', 'Người Duyệt', 'Ghi Chú Duyệt', 'Ngày Tạo'],
  },
  {
    title: 'DON_DOI_CA',
    headers: ['ID Đổi Ca', 'Người Yêu Cầu', 'Ca Yêu Cầu', 'Người Nhận', 'Ca Đổi', 'Lý Do', 'Trạng Thái', 'Người Duyệt', 'Ngày Tạo'],
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
    title: 'CHI_TIET_LUONG',
    headers: ['Mã Phiếu', 'Mã Kỳ Lương', 'ID Nhân Viên', 'Mã NV', 'Họ Tên', 'Kỳ Lương', 'Giờ Chuẩn', 'Lương Giờ', 'Lương Cơ Bản', 'Phụ Cấp', 'Thưởng', 'Khấu Trừ', 'Thực Nhận (VNĐ)', 'Trạng Thái'],
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
    headers: ['Tham Số', 'Giá Trị', 'Mô Tả Cấu Hình', 'Cập Nhật Lần Cuối'],
  },
];

export class GoogleSheetsSyncService {
  private sheetsClient: sheets_v4.Sheets | null = null;
  private driveClient: drive_v3.Drive | null = null;
  private spreadsheetId: string;
  private candidateSpreadsheetId: string;
  private driveFolderId: string;
  private isConfigured = false;
  private authError: string | null = null;
  private lastPulledAt: number = 0;

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
      authError: this.authError,
      lastPulledAt: this.lastPulledAt ? new Date(this.lastPulledAt).toISOString() : null,
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

    try {
      const res = await this.sheetsClient.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });

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

        await this.sheetsClient.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: { requests },
        });

        createdSheets.push(...sheetsToCreate.map(s => s.title));
      }

      for (const def of SHEETS_DEFINITIONS) {
        await this.sheetsClient.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `'${def.title}'!A1:Z1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [def.headers],
          },
        });
      }

      console.log(`[GoogleSheetsSyncService] Đã tạo ${createdSheets.length} sheet mới. Toàn bộ 13 tab sẵn sàng.`);

      return {
        success: true,
        createdSheets,
        existingSheets,
        message: `Đã khởi tạo thành công cấu trúc 13 sheet tabs trên Google Sheets!`,
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
      const fallback: MockSheetsAdapter = (repo as any).fallbackAdapter instanceof MockSheetsAdapter
        ? (repo as any).fallbackAdapter
        : (repo as any) instanceof MockSheetsAdapter
          ? (repo as MockSheetsAdapter)
          : null;

      if (!fallback) {
        return { success: false, message: 'Adapter không tương thích — cần MockSheetsAdapter hoặc GoogleSheetsAdapter', counts: null };
      }

      const counts: any = {};

      // 1. Đọc NHAN_VIEN_MASTER
      const empRows = await this.readSheetRows('NHAN_VIEN_MASTER');
      if (empRows.length > 0) {
        fallback.employees = empRows.map((r, idx) => ({
          employee_id: r[0] || `EMP_${uuidv4().slice(0, 8)}`,
          employee_code: r[1] || `UBM_NV${String(idx + 1).padStart(6, '0')}`,
          full_name: r[2] || 'Nhân Viên',
          phone_normalized: r[3] || '',
          employment_status: (r[4] as any) || 'OFFICIAL',
          group: (r[5] as any) || 'STORE',
          default_branch_id: r[6] || 'CN130',
          current_rate_per_hour: Number(r[7]) || 25500,
          start_date: r[8] || new Date().toISOString().split('T')[0],
          created_at: r[8] || new Date().toISOString(),
          updated_at: new Date().toISOString(),
          version: Number(r[9]) || 1,
        }));
      } else {
        fallback.employees = [];
      }
      counts.employees = fallback.employees.length;

      // 2. Đọc TAI_KHOAN_NHAN_VIEN
      const accRows = await this.readSheetRows('TAI_KHOAN_NHAN_VIEN');
      if (accRows.length > 0) {
        fallback.accounts = accRows.map(r => ({
          account_id: r[0] || `ACC_${uuidv4().slice(0, 8)}`,
          employee_id: r[1] || '',
          phone_normalized: r[2] || '',
          role: (r[3] as any) || 'EMPLOYEE',
          account_status: (r[4] as any) || 'ACTIVE',
          branch_scope: r[8] || 'ALL',
          activated_by: r[5] || 'ADM_001',
          activated_at: r[6] || new Date().toISOString(),
          created_at: r[6] || new Date().toISOString(),
          updated_at: new Date().toISOString(),
          version: Number(r[7]) || 1,
        }));
      } else {
        fallback.accounts = [];
      }
      counts.accounts = fallback.accounts.length;

      // 3. Đọc DANH_SACH_CHI_NHANH
      const branchRows = await this.readSheetRows('DANH_SACH_CHI_NHANH');
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
      const shiftRows = await this.readSheetRows('PHAN_CONG_CA');
      if (shiftRows.length > 0) {
        fallback.shifts = shiftRows.map(r => ({
          assignment_id: r[0] || `SHF_${uuidv4().slice(0, 8)}`,
          employee_id: r[1],
          branch_id: r[2] || 'CN130',
          shift_code: (r[3] as any) || 'CA_1',
          date: r[4] || new Date().toISOString().split('T')[0],
          start_at: r[5] || new Date().toISOString(),
          end_at: r[6] || new Date().toISOString(),
          status: (r[7] as any) || 'PUBLISHED',
          schedule_version: Number(r[8]) || 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));
      } else {
        fallback.shifts = [];
      }
      counts.shifts = fallback.shifts.length;

      // 5. Đọc DON_NGHI_PHEP
      const leaveRows = await this.readSheetRows('DON_NGHI_PHEP');
      if (leaveRows.length > 0) {
        fallback.leaveRequests = leaveRows.map(r => ({
          request_id: r[0] || `LV_${uuidv4().slice(0, 8)}`,
          employee_id: r[1],
          branch_id: r[2] || 'CN130',
          leave_type: (r[3] as any) || 'DOT_XUAT',
          requested_date: r[4] || new Date().toISOString().split('T')[0],
          shift_code: (r[5] as any) || undefined,
          reason: r[6] || '',
          status: (r[7] as any) || 'PENDING',
          reviewed_by: r[8] || undefined,
          review_note: r[9] || undefined,
          created_at: r[10] || new Date().toISOString(),
          version: 1,
        }));
      } else {
        fallback.leaveRequests = [];
      }
      counts.leaves = fallback.leaveRequests.length;

      // 6. Đọc SU_KIEN_DIEM_DANH
      const attRows = await this.readSheetRows('SU_KIEN_DIEM_DANH');
      if (attRows.length > 0) {
        fallback.attendanceEvents = attRows.map(r => ({
          event_id: r[0] || `ATT_${uuidv4().slice(0, 8)}`,
          request_id: r[10] || uuidv4(),
          assignment_id: r[1] || '',
          employee_id: r[2] || '',
          branch_id: '',
          type: (r[3] as any) || 'CHECK_IN',
          client_time: r[4] || new Date().toISOString(),
          server_received_at: r[4] || new Date().toISOString(),
          gps_latitude: Number(r[5]) || 0,
          gps_longitude: Number(r[6]) || 0,
          distance_meters: Number(r[7]) || 0,
          gps_status: (r[8] as any) || 'VALID',
          drive_object_id: r[9] || undefined,
          created_at: r[4] || new Date().toISOString(),
        }));
      } else {
        fallback.attendanceEvents = [];
      }
      counts.attendanceEvents = fallback.attendanceEvents.length;

      // 7. Đọc ADMIN_ACCOUNTS (tài khoản quản trị thật từ Google Sheets)
      const adminRows = await this.readSheetRows('ADMIN_ACCOUNTS');
      if (adminRows.length > 0) {
        // Giữ lại tài khoản bootstrap (ADM_001) nếu không có trong Sheets
        const sheetsAdmins = adminRows
          .filter(r => r[0] && r[1]) // phải có admin_id và username
          .map(r => ({
            admin_id: r[0],
            username: r[1],
            // password_hash không được lưu trên Sheets — giữ lại từ bootstrap nếu cùng ID
            password_hash: fallback.adminAccounts.find(a => a.admin_id === r[0])?.password_hash
              || fallback.adminAccounts.find(a => a.username === r[1])?.password_hash
              || '123456',
            full_name: r[2] || 'Quản trị viên',
            role: (r[3] as any) || 'HR',
            branch_scope: r[4] || '*',
            is_active: r[5] !== 'LOCKED',
            version: 1,
            created_at: r[6] || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }));
        // Merge: ưu tiên Sheets, nhưng giữ bootstrap admin nếu chưa có trong Sheets
        const bootstrapAdmin = fallback.adminAccounts.find(a => a.admin_id === 'ADM_001');
        const sheetsHasBootstrap = sheetsAdmins.some(a => a.admin_id === 'ADM_001' || a.username === 'admin');
        fallback.adminAccounts = sheetsHasBootstrap
          ? sheetsAdmins
          : [bootstrapAdmin!, ...sheetsAdmins].filter(Boolean);
        counts.adminAccounts = fallback.adminAccounts.length;
      } else {
        // Sheets trống — giữ bootstrap admin để đảm bảo có thể đăng nhập
        counts.adminAccounts = fallback.adminAccounts.length;
      }

      // 8. Đọc DON_DOI_CA (đơn đổi ca)
      const swapRows = await this.readSheetRows('DON_DOI_CA');
      if (swapRows.length > 0) {
        fallback.swapRequests = swapRows.map(r => ({
          swap_id: r[0] || `SWP_${uuidv4().slice(0, 8)}`,
          requester_id: r[1] || '',
          requester_assignment_id: r[2] || '',
          target_employee_id: r[3] || '',
          target_assignment_id: r[4] || '',
          reason: r[5] || '',
          status: (r[6] as any) || 'PENDING_PARTNER',
          approved_by: r[7] || undefined,
          created_at: r[8] || new Date().toISOString(),
          version: 1,
        }));
      } else {
        fallback.swapRequests = [];
      }
      counts.swapRequests = fallback.swapRequests.length;

      // 9. Đọc DIEU_CHINH_CONG (điều chỉnh công)
      const adjRows = await this.readSheetRows('DIEU_CHINH_CONG');
      if (adjRows.length > 0) {
        fallback.attendanceAdjustments = adjRows.map(r => ({
          adjustment_id: r[0] || `ADJ_${uuidv4().slice(0, 8)}`,
          assignment_id: r[1] || '',
          employee_id: r[2] || '',
          branch_id: '',
          reason: r[3] || '',
          minutes_approved: Number(r[4]) || 0,
          approver_id: r[5] || undefined,
          status: (r[6] as any) || 'PENDING',
          review_note: r[7] || undefined,
          version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));
      } else {
        fallback.attendanceAdjustments = [];
      }
      counts.attendanceAdjustments = fallback.attendanceAdjustments.length;

      // 10. Đọc Ứng viên tuyển dụng từ Form ứng viên (nếu có sheet tab FROM_NHAN_VIEN)
      if (this.candidateSpreadsheetId) {
        try {
          const candRes = await this.sheetsClient.spreadsheets.values.get({
            spreadsheetId: this.candidateSpreadsheetId,
            range: `'FROM_NHAN_VIEN'!A2:Z`,
          });
          const candRows = candRes.data.values || [];
          if (candRows.length > 0) {
            fallback.candidates = candRows.map((r, idx) => ({
              submission_id: `CAND_${String(idx + 1).padStart(4, '0')}`,
              full_name: r[1] || `Ứng viên ${idx + 1}`,
              phone_normalized: r[2] || '',
              birth_year: Number(r[3]) || 2000,
              apply_position: r[4] || 'Nhân viên Bán hàng / Pha chế',
              preferred_branch_id: r[5] || 'CN130',
              status: (r[6] as any) || 'NEW',
              created_at: r[0] || new Date().toISOString(),
            }));
            counts.candidates = fallback.candidates.length;
          } else {
            fallback.candidates = [];
          }
        } catch (e) {
          // Bỏ qua nếu tab form chưa có
        }
      }

      this.lastPulledAt = Date.now();
      console.log('[GoogleSheetsSyncService] Đã tải dữ liệu thực tế từ Google Sheets thành công:', counts);

      return {
        success: true,
        message: 'Đã tải và cập nhật toàn bộ dữ liệu thật từ Google Sheets thành công!',
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
      const res = await this.sheetsClient.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `'${sheetTitle}'!A2:Z`,
      });
      return (res.data.values as string[][]) || [];
    } catch (e) {
      return [];
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

      // 1. Admin Accounts
      const admins = await repo.listAdminAccounts();
      const adminRows = admins.map(a => [
        a.admin_id,
        a.username,
        a.full_name,
        a.role,
        a.branch_scope || '*',
        a.is_active ? 'ACTIVE' : 'LOCKED',
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
        e.phone_normalized,
        e.employment_status,
        e.group,
        e.default_branch_id,
        e.current_rate_per_hour,
        e.start_date || e.created_at,
        e.version,
      ]);
      await this.overwriteSheetData('NHAN_VIEN_MASTER', SHEETS_DEFINITIONS.find(d => d.title === 'NHAN_VIEN_MASTER')!.headers, employeeRows);
      details.employees = employeeRows.length;

      // 4. Tài khoản nhân viên
      const accounts = await repo.listAccounts();
      const accountRows = accounts.map(acc => [
        acc.account_id,
        acc.employee_id,
        acc.phone_normalized,
        acc.role,
        acc.account_status,
        acc.activated_by || '',
        acc.activated_at || '',
        acc.version,
      ]);
      await this.overwriteSheetData('TAI_KHOAN_NHAN_VIEN', SHEETS_DEFINITIONS.find(d => d.title === 'TAI_KHOAN_NHAN_VIEN')!.headers, accountRows);
      details.accounts = accountRows.length;

      // 5. Phân công ca
      const shifts = await repo.getShiftsForWeek('*', new Date().toISOString().split('T')[0]);
      const shiftRows = shifts.map(s => [
        s.assignment_id,
        s.employee_id,
        s.branch_id,
        s.shift_code,
        s.date,
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
        l.requested_date,
        l.shift_code || '',
        l.reason,
        l.status,
        l.reviewed_by || '',
        l.review_note || '',
        l.created_at,
      ]);
      await this.overwriteSheetData('DON_NGHI_PHEP', SHEETS_DEFINITIONS.find(d => d.title === 'DON_NGHI_PHEP')!.headers, leaveRows);
      details.leaves = leaveRows.length;

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
      ]);
      await this.overwriteSheetData('DON_DOI_CA', SHEETS_DEFINITIONS.find(d => d.title === 'DON_DOI_CA')!.headers, swapRows);
      details.swaps = swapRows.length;

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
   * Tải ảnh chấm công lên Google Drive thật
   */
  public async uploadImageToDrive(fileName: string, mimeType: string, base64Data: string): Promise<{ fileId: string; webViewLink?: string }> {
    if (!this.driveClient) {
      return { fileId: `DRV_${Date.now()}` };
    }

    try {
      const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');
      const stream = Readable.from(buffer);

      const res = await this.driveClient.files.create({
        requestBody: {
          name: fileName,
          parents: this.driveFolderId ? [this.driveFolderId] : undefined,
        },
        media: {
          mimeType,
          body: stream,
        },
        fields: 'id, webViewLink, webContentLink',
      });

      console.log(`[GoogleSheetsSyncService] Đã upload ảnh lên Google Drive thành công: ID = ${res.data.id}`);

      return {
        fileId: res.data.id || `DRV_${Date.now()}`,
        webViewLink: res.data.webViewLink || undefined,
      };
    } catch (err: any) {
      console.error('[GoogleSheetsSyncService] Lỗi khi upload ảnh lên Google Drive:', err);
      return { fileId: `DRV_LOCAL_${Date.now()}` };
    }
  }

  /**
   * Ghi đè dữ liệu một Sheet tab (giữ nguyên tiêu đề ở dòng 1)
   */
  private async overwriteSheetData(sheetTitle: string, headers: string[], rows: any[][]) {
    if (!this.sheetsClient) return;

    try {
      await this.sheetsClient.spreadsheets.values.clear({
        spreadsheetId: this.spreadsheetId,
        range: `'${sheetTitle}'!A2:Z`,
      });
    } catch (e) {
      // Bỏ qua nếu range trống
    }

    const allValues = [headers, ...rows];
    await this.sheetsClient.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `'${sheetTitle}'!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: allValues,
      },
    });
  }

  /**
   * Thêm một dòng mới vào cuối Sheet tab (Append)
   */
  public async appendRow(sheetTitle: string, row: any[]): Promise<boolean> {
    if (!this.isConfigured || !this.sheetsClient) return false;

    try {
      await this.sheetsClient.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `'${sheetTitle}'!A:A`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [row],
        },
      });
      return true;
    } catch (err) {
      console.error(`[GoogleSheetsSyncService] Lỗi append row vào ${sheetTitle}:`, err);
      return false;
    }
  }
}
