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
import { hashPasswordSync, isBcryptHash } from './password.service.js';
import { evaluateCandidateAiScore } from './ai-scorer.js';

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
    headers: ['ID Tài Khoản', 'ID Nhân Viên', 'Số Điện Thoại', 'Vai Trò', 'Trạng Thái', 'Phiên Bản', 'Mã PIN (hash)', 'Bắt Buộc Đổi PIN', 'Mã PIN'],
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
    ],
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
      ]);

      // 1. Đọc NHAN_VIEN_MASTER
      const empRows = batch['NHAN_VIEN_MASTER'];
      if (empRows.length > 0) {
        fallback.employees = empRows
          .filter(r => r && (r[2] || r[3]))
          .map((r, idx) => {
            const phone = (r[3] || '').trim();
            const phoneClean = phone.replace(/\D/g, '');
            const empId = r[0] && r[0].trim() ? r[0].trim() : (phoneClean ? `EMP_${phoneClean}` : `EMP_${uuidv4().slice(0, 8)}`);
            const empCode = r[1] && r[1].trim() ? r[1].trim() : `UBM_NV${String(idx + 1).padStart(6, '0')}`;
            const fullName = (r[2] || '').trim() || 'Nhân Viên';
            const status = (r[4] as any) || 'OFFICIAL';
            const group = (r[5] as any) || 'STORE';
            const branchId = (r[6] || '').trim() || 'CN130';
            const rate = Number(r[7]) || 25500;
            const startDate = (r[8] || '').trim() || new Date().toISOString().split('T')[0];
            const version = Number(r[9]) || 1;

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
            };
          });
      } else {
        fallback.employees = [];
      }
      counts.employees = fallback.employees.length;

      // 2. Đọc TAI_KHOAN_NHAN_VIEN (không còn cột Người/Ngày Kích Hoạt — PIN là cửa duy nhất)
      const accRows = batch['TAI_KHOAN_NHAN_VIEN'];
      if (accRows.length > 0) {
        fallback.accounts = accRows
          .filter(r => r && (r[0] || r[2]))
          .map(r => ({
            account_id: r[0] || `ACC_${uuidv4().slice(0, 8)}`,
            employee_id: r[1] || '',
            phone_normalized: (r[2] || '').replace(/\D/g, ''),
            role: (r[3] as any) || 'EMPLOYEE',
            account_status: 'ACTIVE' as any,
            branch_scope: 'ALL',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            version: Number(r[5]) || 1,
            // 2 cột PIN ở cuối (tài khoản cũ chưa có -> PIN_NOT_SET cho đến khi HR cấp).
            pin_hash: r[6] || undefined,
            pin_must_change: r[7] === 'YES',
            // Cột Mã PIN bản rõ — chỉ hiển thị trên cổng quản trị (Admin/HR).
            pin_code: r[8] || undefined,
          }));
      } else {
        fallback.accounts = [];
      }

      // TỰ ĐỘNG ĐỐI CHIẾU: Nhân viên có trong NHAN_VIEN_MASTER nhưng chưa có trong TAI_KHOAN_NHAN_VIEN
      // -> Tự động sinh tài khoản ACTIVE để nhân viên đăng nhập ngay bằng SĐT + PIN do HR cấp!
      const existingPhones = new Set(fallback.accounts.map(a => a.phone_normalized).filter(Boolean));
      for (const emp of fallback.employees) {
        if (emp.phone_normalized && emp.phone_normalized.length >= 9 && !existingPhones.has(emp.phone_normalized)) {
          existingPhones.add(emp.phone_normalized);
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
            pin_hash: undefined,
            pin_must_change: true,
          });
        }
      }
      counts.accounts = fallback.accounts.length;

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
      const leaveRows = batch['DON_NGHI_PHEP'];
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
      const attRows = batch['SU_KIEN_DIEM_DANH'];
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

      // 7. Đọc ADMIN_ACCOUNTS (hỗ trợ cả dòng cũ 7 cột không có Trạng Thái -> mặc định ACTIVE)
      const adminRows = batch['ADMIN_ACCOUNTS'];
      if (adminRows.length > 0) {
        const currentAdmins = fallback.adminAccounts;
        const sheetsAdmins: AdminAccount[] = adminRows
          .filter(r => r[0] && r[1]) // phải có admin_id và username
          .map(r => {
            const passwordFromSheet = r[2] || '';
            const fullName = r[3] || 'Quản trị viên';
            const role = (r[4] as any) || 'HR';
            const branchScope = r[5] || '*';
            // Dòng mới 8 cột: Trạng Thái ở cột 6, Ngày Tạo cột 7. Dòng cũ 7 cột: cột 6 là Ngày Tạo.
            const hasStatusCol = r.length >= 8;
            const statusStr = hasStatusCol ? r[6] : 'ACTIVE';
            const createdAt = (hasStatusCol ? r[7] : r[6]) || new Date().toISOString();

            const existingById = currentAdmins.find(a => a.admin_id === r[0]);
            const existingByUser = currentAdmins.find(a => a.username === r[1]);
            const rawPass =
              passwordFromSheet ||
              existingById?.password_hash ||
              existingByUser?.password_hash ||
              (r[1] === 'admin'
                ? process.env.ADMIN_SEED_PASSWORD || 'Master@@2027'
                : `Temp${Date.now().toString().slice(-6)}!`);
            // Không bao giờ giữ plaintext: hash trước khi lưu vào memory.
            const passwordHash = isBcryptHash(rawPass) ? rawPass : hashPasswordSync(rawPass);

            return {
              admin_id: r[0],
              username: r[1],
              password_hash: passwordHash,
              full_name: fullName,
              role: role || 'HR',
              branch_scope: branchScope || '*',
              is_active: statusStr !== 'LOCKED',
              version: 1,
              created_at: createdAt || new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
          });

        // Merge: ưu tiên Sheets, nhưng giữ bootstrap admin nếu chưa có trong Sheets
        const sheetsHasBootstrap = sheetsAdmins.some(a => a.admin_id === 'ADM_001' || a.username === 'admin');
        if (sheetsHasBootstrap) {
          fallback.adminAccounts = sheetsAdmins;
        } else {
          const bootstrapAdmin = currentAdmins.find(a => a.admin_id === 'ADM_001');
          fallback.adminAccounts = bootstrapAdmin
            ? [bootstrapAdmin, ...sheetsAdmins]
            : sheetsAdmins;
        }
        counts.adminAccounts = fallback.adminAccounts.length;
      } else {
        // Sheets trống — giữ bootstrap admin và tự động ghi bootstrap admin lên Sheet để lưu trữ bền vững
        const bootstrapAdmin = fallback.adminAccounts.find(a => a.admin_id === 'ADM_001');
        if (bootstrapAdmin) {
          this.appendRow('ADMIN_ACCOUNTS', [
            bootstrapAdmin.admin_id,
            bootstrapAdmin.username,
            bootstrapAdmin.password_hash,
            bootstrapAdmin.full_name,
            bootstrapAdmin.role,
            bootstrapAdmin.branch_scope,
            bootstrapAdmin.is_active === false ? 'LOCKED' : 'ACTIVE',
            bootstrapAdmin.created_at,
          ]).catch(err => console.warn('[GoogleSheetsSyncService] Could not auto-seed bootstrap admin:', err));
        }
        counts.adminAccounts = fallback.adminAccounts.length;
      }

      // 8. Đọc DON_DOI_CA (đơn đổi ca)
      const swapRows = batch['DON_DOI_CA'];
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
      const adjRows = batch['DIEU_CHINH_CONG'];
      if (adjRows.length > 0) {
        fallback.attendanceAdjustments = adjRows.map(r => ({
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
      } else {
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
        }
      }

      // 12. Đọc Ứng viên tuyển dụng từ Form ứng viên Google Sheets (đầy đủ 17 cột)
      let candRows: string[][] = [];
      let targetSheetTitle = 'FROM_NHAN_VIEN';

      if (this.sheetsClient) {
        // A. Thử đọc từ candidateSpreadsheetId trước
        if (this.candidateSpreadsheetId) {
          try {
            const meta = await this.sheetsClient.spreadsheets.get({
              spreadsheetId: this.candidateSpreadsheetId,
            });
            const sheets = meta.data.sheets || [];
            const found = sheets.find(s => {
              const t = s.properties?.title || '';
              return /FROM_NHAN_VIEN|Form|Biểu mẫu|Câu trả lời|Ứng viên/i.test(t);
            }) || sheets[0];

            if (found?.properties?.title) {
              targetSheetTitle = found.properties.title;
              const candRes = await this.sheetsClient.spreadsheets.values.get({
                spreadsheetId: this.candidateSpreadsheetId,
                range: `'${targetSheetTitle}'!A1:ZZ`,
              });
              candRows = (candRes.data.values as string[][]) || [];
            }
          } catch (e: any) {
            console.warn('[GoogleSheetsSyncService] Đọc candidateSpreadsheetId gặp lỗi, thử master sheet:', e.message);
          }
        }

        // B. Nếu chưa có dữ liệu từ candidateSpreadsheetId, thử đọc từ Master spreadsheet
        if (candRows.length <= 1 && this.spreadsheetId) {
          try {
            const candRes = await this.sheetsClient.spreadsheets.values.get({
              spreadsheetId: this.spreadsheetId,
              range: `'FROM_NHAN_VIEN'!A1:ZZ`,
            });
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
            const phoneNormalized = phone.replace(/\D/g, '');
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

            const status = (getVal(colStatus) || 'NEW') as any;
            const sourceCode = getVal(colSourceCode) || `UBM_FORM_${String(idx + 1).padStart(4, '0')}`;
            const submissionId = `CAND_${String(idx + 1).padStart(4, '0')}`;

            return {
              submission_id: submissionId,
              full_name: fullName,
              phone_normalized: phoneNormalized,
              phone,
              gender,
              birth_year: birthYear,
              education_level: educationLevel,
              hometown,
              apply_position: 'Nhân viên Bán hàng / Pha chế',
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
        counts.candidates = fallback.candidates.length;
      } else {
        // Giữ nguyên danh sách hiện tại nếu không đọc được dòng mới từ sheet
        counts.candidates = fallback.candidates ? fallback.candidates.length : 0;
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
   * Đọc NHIỀU tab trong 1 HTTP round-trip (batchGet) — nhanh gấp ~N lần so với
   * đọc nối tiếp từng tab. Dùng cho full-pull realtime.
   */
  public async readTabsBatch(sheetTitles: string[]): Promise<Record<string, string[][]>> {
    const out: Record<string, string[][]> = {};
    for (const t of sheetTitles) out[t] = [];
    if (!this.sheetsClient || sheetTitles.length === 0) return out;
    try {
      const res = await this.sheetsClient.spreadsheets.values.batchGet({
        spreadsheetId: this.spreadsheetId,
        ranges: sheetTitles.map(t => `'${t}'!A2:Z`),
      });
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

      // 4. Tài khoản nhân viên (không còn cột Người/Ngày Kích Hoạt)
      const accounts = await repo.listAccounts();
      const accountRows = accounts.map(acc => [
        acc.account_id,
        acc.employee_id,
        acc.phone_normalized,
        acc.role,
        acc.account_status,
        acc.version,
        acc.pin_hash || '',
        acc.pin_must_change ? 'YES' : '',
        (acc as any).pin_code || '',
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
        ]);
        await this.overwriteSheetData('FROM_NHAN_VIEN', candHeaders, candRows);
        details.candidates = candRows.length;
      }

      // 16. Đồng bộ Đơn nghỉ phép & Nghỉ khẩn cấp (DON_NGHI_PHEP & PHIEU_OFF_DOT_XUAT)
      const leaveRequests = await repo.listLeaveRequests();
      const leaveDef = SHEETS_DEFINITIONS.find(d => d.title === 'DON_NGHI_PHEP');
      if (leaveDef) {
        const leaveRows = leaveRequests.map((l: any) => {
          const emp = employees.find((e: any) => e.employee_id === l.employee_id);
          return [
            l.request_id,
            emp?.employee_code || l.employee_id,
            l.branch_id || emp?.default_branch_id || 'CN130',
            l.leave_type === 'DOT_XUAT' ? 'Nghỉ Đột Xuất' : 'Nghỉ Hàng Tuần',
            l.requested_date,
            l.shift_code || 'Cả ngày',
            l.reason,
            l.status,
            l.reviewed_by || '',
            l.review_note || '',
            l.created_at || '',
          ];
        });
        await this.overwriteSheetData('DON_NGHI_PHEP', leaveDef.headers, leaveRows);
      }

      // 17. Đồng bộ Kỳ lương (KY_LUONG)
      const payrollList = await repo.listPayrollRuns();
      if (payrollList && payrollList.length > 0) {
        const prDef = SHEETS_DEFINITIONS.find(d => d.title === 'KY_LUONG');
        if (prDef) {
          const prRows = payrollList.map((p: any) => [
            p.run_id,
            p.period,
            p.status,
            p.total_amount || 0,
            p.created_at || '',
            p.published_at || '',
            p.paid_at || '',
          ]);
          await this.overwriteSheetData('KY_LUONG', prDef.headers, prRows);
          details.payrollRuns = prRows.length;
        }
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
