import { v4 as uuidv4 } from 'uuid';
import { hashPasswordSync } from '../services/password.service.js';
import { canonicalPhone, normSheetDate } from '../services/employees.service.js';
import {
  EmployeeAccount,
  AdminAccount,
  EmployeeMaster,
  EmployeeStageHistory,
  CandidateApplication,
  ShiftAssignment,
  LeaveRequest,
  SwapRequest,
  AttendanceEvent,
  AttendanceAdjustment,
  PayrollRun,
  PayslipItem,
  PayrollFormula,
  PayrollPeriodInput,
  NotificationOutboxItem,
  NotificationInboxItem,
  OperationRecord,
  AuditLogEntry,
  RequestApprovalStatus,
  AdjustmentStatus,
  PayrollRunStatus,
  STANDARD_HOURLY_RATES,
  BRANCHES,
  BranchInfo,
  SHIFT_TEMPLATES,
  TestPaper,
  TestSubmission,
  EVVehicle,
  EVRoute,
  EVRouteStop,
  EVShift,
  EVShiftCheckin,
  EVChargingTicket,
  EVGPSPoint,
  EVDriverPayroll,
  EVRouteChangeRequest,
} from '@ubm/shared';
import { ISheetsRepository } from './sheets.interface.js';
import { dedupeShiftAssignments, findLiveShift } from './shift-dedupe.js';

/** So khớp chi nhánh theo mã chuẩn (Sheet có thể ghi CN1/CN2/CN3/CN4). */
function sameBranchId(a?: unknown, b?: unknown): boolean {
  const canon = (v: unknown): string => {
    const x = String(v ?? '').trim().toUpperCase();
    if (x === 'CN1' || x === 'CN130') return 'CN130';
    if (x === 'CN2' || x === 'CN261') return 'CN261';
    if (x === 'CN3' || x === 'CN120') return 'CN120';
    if (x === 'CN4' || x === 'CN111') return 'CN111';
    return x;
  };
  const x = canon(a);
  const y = canon(b);
  return x === '*' || y === '*' || x === y;
}

/**
 * Chuẩn hóa 1 dòng ca trước khi trả ra ngoài: mã NV trim, mã ca/chi nhánh chuẩn,
 * ngày về YYYY-MM-DD. Nhờ vậy mọi API (lịch NV, chấm công, lương, đổi ca) so
 * khớp trên cùng một biểu diễn dù Sheet lưu ngày/ID kiểu gì.
 */
function normalizeShiftRow<T extends ShiftAssignment>(s: T): T {
  return {
    ...s,
    employee_id: String((s as any).employee_id ?? '').trim(),
    branch_id: String((s as any).branch_id ?? '').trim(),
    shift_code: String((s as any).shift_code ?? '').trim().toUpperCase() as any,
    date: (normSheetDate((s as any).date) || String((s as any).date ?? '').slice(0, 10)) as any,
  } as T;
}

export class MockSheetsAdapter implements ISheetsRepository {
  public accounts: EmployeeAccount[] = [];
  public adminAccounts: AdminAccount[] = [];

  /** Mock/local: dữ liệu nằm sẵn trong bộ nhớ — luôn sẵn sàng. */
  getReadiness() {
    return { ready: true as const };
  }
  public employees: EmployeeMaster[] = [];
  public stageHistories: EmployeeStageHistory[] = [];
  public candidates: CandidateApplication[] = [];
  public shifts: ShiftAssignment[] = [];
  public leaveRequests: LeaveRequest[] = [];
  public swapRequests: SwapRequest[] = [];
  public attendanceEvents: AttendanceEvent[] = [];
  public attendanceAdjustments: AttendanceAdjustment[] = [];
  public payrollRuns: PayrollRun[] = [];
  public payslips: PayslipItem[] = [];
  public payrollFormulas: PayrollFormula[] = [];
  public payrollInputs: PayrollPeriodInput[] = [];
  public notificationOutbox: NotificationOutboxItem[] = [];
  public notificationInbox: NotificationInboxItem[] = [];
  public testPapers: TestPaper[] = [];
  public testSubmissions: TestSubmission[] = [];
  public operations: OperationRecord[] = [];
  public auditLogs: AuditLogEntry[] = [];

  // New admin governance structures
  public branches: BranchInfo[] = [];
  public shiftTemplates: any = {};
  public policies: any = {};
  public maintenance: any = {};
  public backupSnapshots: any[] = [];
  public systemSettings: any = {};

  // --- MILKROUTE EV (quản lý tài xế giao sữa + định vị GPS) ---
  public evVehicles: EVVehicle[] = [];
  public evRoutes: EVRoute[] = [];
  public evRouteStops: EVRouteStop[] = [];
  public evShifts: EVShift[] = [];
  public evShiftCheckins: EVShiftCheckin[] = [];
  public evChargingTickets: EVChargingTicket[] = [];
  public evGpsPoints: EVGPSPoint[] = [];
  public evDriverPayroll: EVDriverPayroll[] = [];
  /** Phiếu đề xuất đổi lộ trình (Nhân sự tạo — Giám đốc duyệt). */
  public evRouteChangeRequests: EVRouteChangeRequest[] = [];

  // Nhân viên TERMINATED đã thu hồi token (tránh audit spam mỗi lần pull)
  public terminatedRevoked: Set<string> = new Set();

  // Fault injection controls
  public simulateNetworkError = false;
  public simulateQuotaError = false;
  public simulatePartialWriteError = false;

  constructor() {
    this.seedInitialData();
  }

  /**
   * Xuất toàn bộ trạng thái runtime để ghi snapshot khởi động nhanh.
   * Không xuất cờ fault-injection (chỉ dùng cho test/mock).
   */
  public exportRuntimeState(): any {
    const clone = (value: any): any => {
      try {
        return JSON.parse(JSON.stringify(value ?? null));
      } catch {
        return value;
      }
    };
    return {
      accounts: clone(this.accounts),
      adminAccounts: clone(this.adminAccounts),
      employees: clone(this.employees),
      stageHistories: clone(this.stageHistories),
      candidates: clone(this.candidates),
      shifts: clone(this.shifts),
      leaveRequests: clone(this.leaveRequests),
      swapRequests: clone(this.swapRequests),
      attendanceEvents: clone(this.attendanceEvents),
      attendanceAdjustments: clone(this.attendanceAdjustments),
      payrollRuns: clone(this.payrollRuns),
      payslips: clone(this.payslips),
      payrollFormulas: clone(this.payrollFormulas),
      payrollInputs: clone(this.payrollInputs),
      notificationOutbox: clone(this.notificationOutbox),
      notificationInbox: clone(this.notificationInbox),
      testPapers: clone(this.testPapers),
      testSubmissions: clone(this.testSubmissions),
      operations: clone(this.operations),
      auditLogs: clone(this.auditLogs),
      branches: clone(this.branches),
      shiftTemplates: clone(this.shiftTemplates),
      policies: clone(this.policies),
      maintenance: clone(this.maintenance),
      backupSnapshots: clone(this.backupSnapshots),
      systemSettings: clone(this.systemSettings),
      // MILKROUTE EV (BETA): chưa có tab Google Sheets riêng → lưu kèm snapshot
      // để không mất dữ liệu khi restart ở chế độ Sheets.
      evVehicles: clone(this.evVehicles),
      evRoutes: clone(this.evRoutes),
      evRouteStops: clone(this.evRouteStops),
      evShifts: clone(this.evShifts),
      evShiftCheckins: clone(this.evShiftCheckins),
      evChargingTickets: clone(this.evChargingTickets),
      evDriverPayroll: clone(this.evDriverPayroll),
      evRouteChangeRequests: clone(this.evRouteChangeRequests),
      // evGpsPoints cố ý KHÔNG đưa vào snapshot: dữ liệu realtime, ghi rất dày
      // (mỗi 15s/xe) sẽ làm file snapshot phình to; Live Map tự nạp lại khi chạy.
      terminatedRevoked: Array.from(this.terminatedRevoked),
    };
  }

  /**
   * Nạp snapshot đã lưu. Chỉ thay thế các khoá có mặt và đúng kiểu; khoá thiếu
   * giữ nguyên dữ liệu seed để không làm hỏng hệ thống khi nâng cấp schema.
   */
  public importRuntimeState(state: any): boolean {
    if (!state || typeof state !== 'object') return false;
    const arrayKeys = [
      'accounts', 'adminAccounts', 'employees', 'stageHistories', 'candidates',
      'shifts', 'leaveRequests', 'swapRequests', 'attendanceEvents',
      'attendanceAdjustments', 'payrollRuns', 'payslips', 'payrollFormulas',
      'payrollInputs', 'notificationOutbox', 'notificationInbox', 'testPapers',
      'testSubmissions', 'operations', 'auditLogs', 'branches', 'backupSnapshots',
      // MILKROUTE EV (BETA) — khôi phục từ snapshot khi chạy chế độ Sheets.
      'evVehicles', 'evRoutes', 'evRouteStops', 'evShifts', 'evShiftCheckins',
      'evChargingTickets', 'evDriverPayroll', 'evRouteChangeRequests',
    ] as const;
    for (const key of arrayKeys) {
      if (Array.isArray(state[key])) {
        (this as any)[key] = state[key];
      }
    }
    for (const key of ['shiftTemplates', 'policies', 'maintenance', 'systemSettings'] as const) {
      if (state[key] && typeof state[key] === 'object' && !Array.isArray(state[key])) {
        (this as any)[key] = state[key];
      }
    }
    if (Array.isArray(state.terminatedRevoked)) {
      this.terminatedRevoked = new Set(state.terminatedRevoked.map((x: any) => String(x)));
    }
    return true;
  }

  public seedInitialData() {
    const now = new Date().toISOString();

    // Seed password: ưu tiên env, mặc định dev-only. Production phải đổi ngay sau khi đăng nhập.
    const seedPlain =
      process.env.ADMIN_SEED_PASSWORD && process.env.ADMIN_SEED_PASSWORD.length >= 8
        ? process.env.ADMIN_SEED_PASSWORD
        : 'Nguyenthanhthien@9999';
    if (!process.env.ADMIN_SEED_PASSWORD) {
      console.warn(
        '[mock] ADMIN_SEED_PASSWORD not set — using default dev seed password. Change it immediately after login.'
      );
    }
    // HR mặc định: env HR_SEED_PASSWORD, mặc định Umbomilk@2027 (đổi ngay sau khi đăng nhập).
    const hrSeedPlain =
      process.env.HR_SEED_PASSWORD && process.env.HR_SEED_PASSWORD.length >= 8
        ? process.env.HR_SEED_PASSWORD
        : 'Umbomilk@2027';
    if (!process.env.HR_SEED_PASSWORD) {
      console.warn(
        '[mock] HR_SEED_PASSWORD not set — using default dev HR password. Change it immediately after login.'
      );
    }
    // Kế toán mặc định: env FINANCE_SEED_PASSWORD, mặc định Umbomilk@2027 (chấm công + tính lương).
    const finSeedPlain =
      process.env.FINANCE_SEED_PASSWORD && process.env.FINANCE_SEED_PASSWORD.length >= 8
        ? process.env.FINANCE_SEED_PASSWORD
        : 'Umbomilk@2027';
    if (!process.env.FINANCE_SEED_PASSWORD) {
      console.warn(
        '[mock] FINANCE_SEED_PASSWORD not set — using default dev finance password. Change it immediately after login.'
      );
    }

    // 1. Admin Accounts (Admin, HR mặc định + các tài khoản tạo thêm)
    this.adminAccounts = [
      {
        admin_id: 'ADM_001',
        username: 'admin',
        password_hash: hashPasswordSync(seedPlain),
        full_name: 'Quản Trị Viên Hệ Thống',
        role: 'ADMIN',
        branch_scope: '*',
        is_active: true,

        version: 1,
        created_at: now,
        updated_at: now,
      },
      {
        admin_id: 'ADM_002',
        username: 'umbomilk-hr',
        password_hash: hashPasswordSync(hrSeedPlain),
        full_name: 'HR Ụm Bò Milk',
        role: 'HR',
        branch_scope: '*',
        is_active: true,

        version: 1,
        created_at: now,
        updated_at: now,
      },
      {
        admin_id: 'ADM_003',
        username: 'finance',
        password_hash: hashPasswordSync(finSeedPlain),
        full_name: 'Kế Toán Ụm Bò Milk',
        role: 'FINANCE',
        branch_scope: '*',
        is_active: true,

        version: 1,
        created_at: now,
        updated_at: now,
      },
    ];

    // 2. Employees (Empty pristine database)
    this.employees = [];

    // 3. Employee Accounts (Empty pristine database)
    this.accounts = [];

    // 4. Shifts (Empty pristine database)
    this.shifts = [];

    // 4b. Candidates (dữ liệu thật 100%: ứng viên chỉ đến từ Google Form, không seed mẫu)
    this.candidates = [];

    // 5. Notifications (Empty pristine database)
    this.notificationInbox = [];

    // 6. Branches
    this.branches = [...BRANCHES];

    // 7. Shift Templates
    this.shiftTemplates = { ...SHIFT_TEMPLATES };

    // 8. System Policies
    this.policies = {
      check_in_window_minutes: 30,
      gps_radius_meters: 300,
      weekly_off_window: 'T6 09:00 -> T7 09:00',
      max_weekly_off_days: 2,
      test_question_count: 25,
      test_passing_score: 8.0,
      test_duration_seconds: 480,
      policy_version: '5.1',
      effective_from: '2026-09-01',
      last_approved_by: 'ADM_001',
    };

    // 9. Maintenance Modes
    this.maintenance = {
      system_maintenance: false,
      employee_web_maintenance: false,
      feature_maintenance: {
        attendance: false,
        swap: false,
        payroll: false,
      },
      maintenance_message: 'Hệ thống đang bảo trì kỹ thuật định kỳ. Quý khách vui lòng thử lại sau ít phút.',
      // Lịch giao diện sự kiện cho cổng nhân viên (Admin chọn + hẹn giờ).
      theme_event: 'halloween',
      theme_schedule_enabled: true,
      theme_start_at: '2026-10-25T18:00:00.000Z',
      theme_end_at: '2026-10-31T16:59:00.000Z',
    };

    // 10. Backup Snapshots (bắt đầu rỗng — dữ liệu thật sẽ load từ Google Sheets)
    this.backupSnapshots = [];

    // 11. System Technical Settings
    this.systemSettings = {
      logo: '🥛',
      system_name: 'Hệ Thống Quản Lý Nhân Sự Ụm Bò Milk',
      version: 'V5.1',
      time_format: 'DD/MM/YYYY HH:mm',
      timezone: 'Asia/Ho_Chi_Minh',
      session_timeout_minutes: 1440,
      sync_interval_seconds: 15,
      max_file_size_mb: 10,
    };
  }

  private checkErrors() {
    if (this.simulateNetworkError || this.simulateQuotaError) {
      throw new Error('SHEETS_UNAVAILABLE: Google Sheets API quota exceeded or network timeout');
    }
  }

  // --- Accounts ---
  async findAccountByPhone(phone: string): Promise<EmployeeAccount[]> {
    this.checkErrors();
    // So khớp canonical 2 chiều: dữ liệu cũ (84-prefix/mất số 0) vẫn trúng.
    const want = canonicalPhone(phone || '');
    if (!want) return this.accounts.filter(a => a.phone_normalized === phone);
    return this.accounts.filter(a => a.phone_normalized === phone || canonicalPhone(a.phone_normalized || '') === want);
  }

  async getAccountById(id: string): Promise<EmployeeAccount | null> {
    this.checkErrors();
    return this.accounts.find(a => a.account_id === id) || null;
  }

  async listAccounts(): Promise<EmployeeAccount[]> {
    this.checkErrors();
    return [...this.accounts];
  }

  async setAccountPin(id: string, pinHash: string, mustChange: boolean, actorId: string, pinPlain?: string | null): Promise<EmployeeAccount> {
    this.checkErrors();
    const account = this.accounts.find(a => a.account_id === id);
    if (!account) throw new Error('ACCOUNT_NOT_FOUND');
    account.pin_hash = pinHash || '';
    account.pin_must_change = mustChange;
    // pinPlain === null/'' hoặc pinHash rỗng: xóa bản rõ. pinPlain === undefined: giữ nguyên bản rõ cũ.
    if (pinPlain !== undefined) {
      account.pin_code = (pinPlain && pinPlain.trim()) ? pinPlain.trim() : undefined;
    }
    if (!pinHash) {
      account.pin_hash = '';
      delete (account as any).pin_code;
      account.pin_must_change = false;
    }
    const nowIso = new Date().toISOString();
    // Ghi nhận lần đổi PIN (dùng cho xoay định kỳ hàng tháng 1-5).
    (account as any).pin_changed_at = nowIso;
    if (!mustChange) {
      // NV tự đổi từ PIN cũ -> đánh dấu đã hoàn tất kỳ hiện tại (giờ VN).
      try {
        const vn = new Date(Date.now() + 7 * 3_600_000);
        (account as any).pin_rotation_cycle = `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}`;
      } catch { /* best-effort */ }
    }
    // Đổi PIN thu hồi phiên cũ (token mang version cũ hết hiệu lực).
    account.version += 1;
    account.updated_at = nowIso;
    await this.recordAuditLog({
      log_id: `LOG_${Date.now()}`,
      actor_id: actorId,
      actor_role: 'HR',
      action: mustChange ? 'ACCOUNT_PIN_ISSUED' : 'ACCOUNT_PIN_CHANGED',
      target_entity: 'TAI_KHOAN_NHAN_VIEN',
      target_id: id,
      details: `PIN updated for account ${id}`,
    });
    return { ...account };
  }

  async markAccountPinMustChange(id: string, actorId: string): Promise<EmployeeAccount> {
    this.checkErrors();
    const account = this.accounts.find(a => a.account_id === id);
    if (!account) throw new Error('ACCOUNT_NOT_FOUND');
    if (account.pin_must_change === true) return { ...account };
    account.pin_must_change = true;
    // KHÔNG đổi hash, KHÔNG tăng version (giữ phiên đăng nhập, middleware vẫn chặn
    // bằng cờ mustChange mới nhất — NV đăng nhập bằng PIN cũ rồi tự đặt PIN mới).
    account.updated_at = new Date().toISOString();
    await this.recordAuditLog({
      log_id: `LOG_${Date.now()}`,
      actor_id: actorId,
      actor_role: 'SYSTEM',
      action: 'ACCOUNT_PIN_ROTATION_DUE',
      target_entity: 'TAI_KHOAN_NHAN_VIEN',
      target_id: id,
      details: `Monthly self-rotation due for account ${id} (keep old PIN, require self-change)`,
    });
    return { ...account };
  }

  async setAccountStatus(id: string, status: 'ACTIVE' | 'LOCKED', actorId: string): Promise<EmployeeAccount> {
    this.checkErrors();
    const account = this.accounts.find(a => a.account_id === id);
    if (!account) throw new Error('ACCOUNT_NOT_FOUND');
    if ((account as any).account_status === status) return { ...account };
    (account as any).account_status = status;
    // Tăng version để thu hồi phiên đăng nhập đang dùng (token cũ văng ngay).
    account.version += 1;
    account.updated_at = new Date().toISOString();
    await this.recordAuditLog({
      log_id: `LOG_${Date.now()}`,
      actor_id: actorId,
      actor_role: 'HR',
      action: status === 'LOCKED' ? 'ACCOUNT_LOCKED' : 'ACCOUNT_UNLOCKED',
      target_entity: 'TAI_KHOAN_NHAN_VIEN',
      target_id: id,
      details: `${status === 'LOCKED' ? 'HR khóa tài khoản' : 'HR mở khóa tài khoản'} ${id} (NV ${account.employee_id})`,
    });
    return { ...account };
  }

  async createAccount(account: Omit<EmployeeAccount, 'created_at' | 'updated_at' | 'version'>): Promise<EmployeeAccount> {
    this.checkErrors();
    const existing = this.accounts.find(a => a.account_id === account.account_id || a.phone_normalized === account.phone_normalized);
    if (existing) {
      existing.account_status = account.account_status;
      existing.updated_at = new Date().toISOString();
      return { ...existing };
    }
    const newAcc: EmployeeAccount = {
      ...account,
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.accounts.push(newAcc);
    return newAcc;
  }

  async getAdminByUsername(username: string): Promise<AdminAccount | null> {
    this.checkErrors();
    const want = (username || '').trim();
    if (!want) return null;
    return this.adminAccounts.find(a => a.username === want)
      || this.adminAccounts.find(a => (a.username || '').trim().toLowerCase() === want.toLowerCase())
      || null;
  }

  // --- Employees ---
  async getEmployeeById(id: string): Promise<EmployeeMaster | null> {
    this.checkErrors();
    return this.employees.find(e => e.employee_id === id) || null;
  }

  async listEmployees(filter?: { branch?: string; status?: string }): Promise<EmployeeMaster[]> {
    this.checkErrors();
    return this.employees.filter(e => {
      if (filter?.branch && filter.branch !== '*' && e.default_branch_id !== filter.branch) return false;
      if (filter?.status && e.employment_status !== filter.status) return false;
      return true;
    });
  }

  async createEmployee(data: Omit<EmployeeMaster, 'created_at' | 'updated_at' | 'version'>): Promise<EmployeeMaster> {
    this.checkErrors();
    const now = new Date().toISOString();
    const newEmp: EmployeeMaster = {
      ...data,
      created_at: now,
      updated_at: now,
      version: 1,
    };
    this.employees.push(newEmp);
    return newEmp;
  }

  async updateEmployee(id: string, updates: Partial<EmployeeMaster>, expectedVersion: number): Promise<EmployeeMaster> {
    this.checkErrors();
    const emp = this.employees.find(e => e.employee_id === id);
    if (!emp) throw new Error('EMPLOYEE_NOT_FOUND');
    if (emp.version !== expectedVersion) throw new Error('VERSION_CONFLICT');

    // photo_base64 chỉ để adapter upload Drive — không lưu vào bộ nhớ/Sheets.
    const { photo_base64: _dropPhoto, clear_avatar: _dropClear, ...clean } = updates as any;
    // HR xóa avatar: gỡ cả Drive ID lẫn ảnh inline.
    if ((updates as any).clear_avatar) {
      (emp as any).avatar_drive_id = undefined;
      (emp as any).avatar_photo = undefined;
    }
    Object.assign(emp, clean, {
      version: emp.version + 1,
      updated_at: new Date().toISOString(),
    });
    return { ...emp };
  }

  async deleteEmployee(id: string): Promise<boolean> {
    this.checkErrors();
    const empIndex = this.employees.findIndex(e => e.employee_id === id);
    let removedEmp = false;
    if (empIndex !== -1) {
      this.employees.splice(empIndex, 1);
      removedEmp = true;
    }
    // Luôn dọn tài khoản liên đới — kể cả khi hồ sơ NV đã mất (tài khoản mồ côi
    // hiện ở tab PIN mà không xóa được, bấm xóa báo 404 oan).
    const before = this.accounts.length;
    this.accounts = this.accounts.filter(a => a.employee_id !== id && a.account_id !== id);
    const removedAcc = this.accounts.length < before;
    return removedEmp || removedAcc;
  }

  /** Xóa trực tiếp 1 tài khoản NV (dùng cho dòng mồ côi không còn hồ sơ). */
  async deleteAccount(accountId: string): Promise<boolean> {
    this.checkErrors();
    const accIndex = this.accounts.findIndex(a => a.account_id === accountId);
    if (accIndex === -1) return false;
    this.accounts.splice(accIndex, 1);
    return true;
  }

  async getStageHistory(employeeId: string): Promise<EmployeeStageHistory[]> {
    this.checkErrors();
    return this.stageHistories.filter(s => s.employee_id === employeeId);
  }

  async addStageHistory(entry: Omit<EmployeeStageHistory, 'version' | 'created_at'>): Promise<EmployeeStageHistory> {
    this.checkErrors();
    const newEntry: EmployeeStageHistory = {
      ...entry,
      version: 1,
      created_at: new Date().toISOString(),
    };
    this.stageHistories.push(newEntry);
    return newEntry;
  }

  // --- Recruitment ---
  async listCandidates(): Promise<CandidateApplication[]> {
    this.checkErrors();
    return [...this.candidates];
  }

  async createCandidate(data: Omit<CandidateApplication, 'created_at'>): Promise<CandidateApplication> {
    this.checkErrors();
    const newCand: CandidateApplication = {
      ...data,
      created_at: new Date().toISOString(),
    };
    this.candidates.push(newCand);
    return newCand;
  }

  async updateCandidate(submissionId: string, updates: Partial<CandidateApplication>): Promise<CandidateApplication> {
    this.checkErrors();
    const cand = this.candidates.find(c => c.submission_id === submissionId);
    if (!cand) throw new Error('CANDIDATE_NOT_FOUND');
    Object.assign(cand, updates);
    return { ...cand };
  }

  async deleteCandidate(submissionId: string): Promise<boolean> {
    this.checkErrors();
    const idx = this.candidates.findIndex(c => c.submission_id === submissionId);
    if (idx < 0) return false;
    this.candidates.splice(idx, 1);
    return true;
  }

  // --- Schedules ---
  async getShiftsForWeek(branchId: string, weekStartDate: string): Promise<ShiftAssignment[]> {
    this.checkErrors();
    // Luôn trả 1 ca live/ngày/mã: Sheet cũ có thể còn dòng trùng do append +
    // full-sync đua nhau. Nhờ vậy lịch, chấm công và payroll cùng thấy 1 ca.
    // So khớp chi nhánh theo mã chuẩn (CN1 ↔ CN130...) + chuẩn hóa ngày: Sheet
    // có thể lưu '2026-10-26T00:00:00'/serial nên so chuỗi thô làm ca biến mất.
    const start = normSheetDate(weekStartDate) || String(weekStartDate || '').slice(0, 10);
    const rows = this.shifts
      .filter(s => sameBranchId(s.branch_id, branchId))
      .map(s => normalizeShiftRow(s))
      .filter(s => {
        const d = normSheetDate(s.date);
        if (!d) return false;
        return !start || d >= start;
      });
    return dedupeShiftAssignments(rows);
  }

  async getShiftsForEmployee(employeeId: string, fromDate: string, toDate: string): Promise<ShiftAssignment[]> {
    this.checkErrors();
    // Chuẩn hóa ngày trước khi lọc: Sheet có thể trả 'YYYY-MM-DDT00:00:00',
    // serial hoặc 'D/M/YYYY' — so sánh chuỗi thô làm ca hôm nay bị rơi khỏi
    // khoảng [fromDate, toDate] (cổng NV báo "không có ca" oan).
    // Mã NV cũng trim 2 phía: ô Sheet dán tay có thể dính khoảng trắng / lưu số
    // nên so khớp tuyệt đối trước đây bỏ sót ca của đúng 1 vài nhân viên.
    const from = normSheetDate(fromDate);
    const to = normSheetDate(toDate);
    const wantEmp = String(employeeId ?? '').trim();
    return dedupeShiftAssignments(this.shifts.filter(s => {
      if (String(s.employee_id ?? '').trim() !== wantEmp) return false;
      const d = normSheetDate(s.date) || String(s.date || '').slice(0, 10);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    }).map(s => normalizeShiftRow(s)));
  }

  async getShiftById(assignmentId: string): Promise<ShiftAssignment | null> {
    this.checkErrors();
    const found = this.shifts.find(s => s.assignment_id === assignmentId) || null;
    return found ? normalizeShiftRow(found) : null;
  }

  async createShiftAssignment(assignment: Omit<ShiftAssignment, 'created_at' | 'updated_at'>): Promise<ShiftAssignment> {
    this.checkErrors();
    // Idempotent: request gửi lặp / 2 luồng đua nhau không được sinh 2 ca giống
    // nhau (cùng NV + ngày + mã). Trả ca đã có để caller dùng đúng assignment_id.
    if (assignment.assignment_id) {
      const sameId = this.shifts.find(s => String(s.assignment_id) === String(assignment.assignment_id));
      if (sameId) return { ...sameId };
    }
    const duplicate = findLiveShift(this.shifts, assignment.employee_id, assignment.date, assignment.shift_code);
    if (duplicate) return { ...duplicate };

    const now = new Date().toISOString();
    const newShift: ShiftAssignment = {
      ...assignment,
      created_at: now,
      updated_at: now,
    };
    this.shifts.push(newShift);
    return newShift;
  }

  async updateShiftAssignment(id: string, updates: Partial<ShiftAssignment>): Promise<ShiftAssignment> {
    this.checkErrors();
    const shift = this.shifts.find(s => s.assignment_id === id);
    if (!shift) throw new Error('SHIFT_NOT_FOUND');
    Object.assign(shift, updates, { updated_at: new Date().toISOString() });
    return { ...shift };
  }

  /**
   * Self-heal: chốt PUBLISHED hàng loạt ca nháp lọt vào tuần đã phát hành
   * (NV thấy ca trên lịch nhưng Điểm danh báo "chưa phát hành").
   */
  async publishShiftAssignments(ids: string[]): Promise<number> {
    this.checkErrors();
    const set = new Set((ids || []).map(id => String(id)));
    if (set.size === 0) return 0;
    const now = new Date().toISOString();
    let changed = 0;
    for (const s of this.shifts) {
      if (!set.has(String(s.assignment_id))) continue;
      if (String(s.status || '').toUpperCase() === 'PUBLISHED') continue;
      s.status = 'PUBLISHED';
      s.schedule_version = (Number(s.schedule_version) || 1) + 1;
      s.updated_at = now;
      changed++;
    }
    return changed;
  }

  async deleteShiftAssignment(id: string): Promise<boolean> {
    this.checkErrors();
    const idx = this.shifts.findIndex(s => String(s.assignment_id) === String(id));
    if (idx < 0) return false;
    this.shifts.splice(idx, 1);
    return true;
  }

  async purgeShiftAssignments(ids: string[]): Promise<number> {
    this.checkErrors();
    const set = new Set((ids || []).map(String));
    const beforeCount = this.shifts.length;
    this.shifts = this.shifts.filter(s => !set.has(String(s.assignment_id)));
    return beforeCount - this.shifts.length;
  }

  async deleteShiftsForEmployee(employeeId: string, fromDate?: string): Promise<number> {
    this.checkErrors();
    const beforeCount = this.shifts.length;
    this.shifts = this.shifts.filter(s => {
      if (String(s.employee_id) !== String(employeeId)) return true;
      if (fromDate && String(s.date || '').slice(0, 10) < fromDate) return true;
      return false; // Xóa ca này
    });
    return beforeCount - this.shifts.length;
  }

  // --- Leaves & Swaps ---
  async createLeaveRequest(request: Omit<LeaveRequest, 'created_at' | 'version'>): Promise<LeaveRequest> {
    this.checkErrors();
    const newReq: LeaveRequest = {
      ...request,
      created_at: new Date().toISOString(),
      version: 1,
    };
    this.leaveRequests.push(newReq);
    return newReq;
  }

  async listLeaveRequests(branchId?: string, employeeId?: string): Promise<LeaveRequest[]> {
    this.checkErrors();
    return this.leaveRequests.filter(r => {
      if (branchId && branchId !== '*' && r.branch_id !== branchId) return false;
      if (employeeId && r.employee_id !== employeeId) return false;
      return true;
    });
  }

  async updateLeaveRequest(id: string, status: RequestApprovalStatus, reviewerId: string, note?: string): Promise<LeaveRequest> {
    this.checkErrors();
    const req = this.leaveRequests.find(r => r.request_id === id);
    if (!req) throw new Error('LEAVE_REQUEST_NOT_FOUND');
    req.status = status;
    req.reviewed_by = reviewerId;
    req.reviewed_at = new Date().toISOString();
    if (note) req.review_note = note;
    req.version += 1;
    return { ...req };
  }

  async createSwapRequest(request: Omit<SwapRequest, 'created_at' | 'version'>): Promise<SwapRequest> {
    this.checkErrors();
    // Idempotent theo swap_id (2 POST cùng mili-giây từng tạo 2 dòng trùng id:
    // 1 APPROVED + 1 PENDING ma khiến banner B kẹt vĩnh viễn) — trả bản có sẵn.
    const existingById = this.swapRequests.find(s => s.swap_id === (request as any).swap_id);
    if (existingById) return { ...existingById };
    const newSwap: SwapRequest = {
      ...request,
      created_at: new Date().toISOString(),
      version: 1,
    };
    this.swapRequests.push(newSwap);
    return newSwap;
  }

  async listSwapRequests(employeeId?: string): Promise<SwapRequest[]> {
    this.checkErrors();
    return this.swapRequests.filter(s => {
      if (employeeId && s.requester_id !== employeeId && s.target_employee_id !== employeeId) return false;
      return true;
    });
  }

  async getSwapById(swapId: string): Promise<SwapRequest | null> {
    this.checkErrors();
    return this.swapRequests.find(s => s.swap_id === swapId) || null;
  }

  async updateSwapRequest(id: string, updates: Partial<SwapRequest>): Promise<SwapRequest> {
    this.checkErrors();
    if (this.simulatePartialWriteError) {
      throw new Error('NEEDS_RECONCILIATION: Partial write failed during multi-tab swap update');
    }
    // Cập nhật TẤT CẢ dòng trùng id (dữ liệu cũ gửi đôi cùng mili-giây để lại
    // 2 dòng trùng swap_id): 1 lần duyệt lật cả bản ma PENDING, banner B hết kẹt.
    const matches = this.swapRequests.filter(s => s.swap_id === id);
    if (matches.length === 0) throw new Error('SWAP_REQUEST_NOT_FOUND');
    for (const swap of matches) {
      Object.assign(swap, updates, { version: swap.version + 1 });
    }
    return { ...matches[0] };
  }

  // --- Attendance ---
  async recordAttendanceEvent(event: Omit<AttendanceEvent, 'created_at'>): Promise<AttendanceEvent> {
    this.checkErrors();
    // Verify idempotency by request_id
    const existing = this.attendanceEvents.find(e => e.request_id === event.request_id);
    if (existing) {
      return existing;
    }

    // photo_base64 chỉ để adapter upload Drive — không lưu vào bộ nhớ/Sheets (5MB/ảnh).
    const { photo_base64: _drop, ...rest } = event as any;
    const newEvent: AttendanceEvent = {
      ...rest,
      created_at: new Date().toISOString(),
    };
    this.attendanceEvents.push(newEvent);
    return newEvent;
  }

  /** Ngày Việt Nam (UTC+7) của 1 mốc ISO — lọc đúng ngày dù giờ lưu UTC hay +07:00. */
  private static vnDay(iso: string): string {
    const t = new Date(iso || '').getTime();
    if (!Number.isFinite(t)) return '';
    return new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
  }

  async getAttendanceEvents(employeeId?: string, date?: string): Promise<AttendanceEvent[]> {
    this.checkErrors();
    return this.attendanceEvents.filter(e => {
      if (employeeId && employeeId !== '*' && e.employee_id !== employeeId) return false;
      if (date && date !== '*' && MockSheetsAdapter.vnDay(e.client_time) !== date) return false;
      return true;
    });
  }

  async findAttendanceEventByRequestId(requestId: string): Promise<AttendanceEvent | null> {
    this.checkErrors();
    return this.attendanceEvents.find(e => e.request_id === requestId) || null;
  }

  async deleteAttendanceEvent(eventId: string): Promise<boolean> {
    this.checkErrors();
    const idx = this.attendanceEvents.findIndex(e => e.event_id === eventId);
    if (idx === -1) return false;
    this.attendanceEvents.splice(idx, 1);
    return true;
  }

  async createAttendanceAdjustment(adj: Omit<AttendanceAdjustment, 'created_at' | 'updated_at' | 'version'>): Promise<AttendanceAdjustment> {
    this.checkErrors();
    const now = new Date().toISOString();
    // photo_base64 chỉ để adapter upload Drive — không lưu vào bộ nhớ/Sheets (5MB/ảnh).
    const { photo_base64: _dropPhoto, ...clean } = adj as any;
    const newAdj: AttendanceAdjustment = {
      ...clean,
      created_at: now,
      updated_at: now,
      version: 1,
    };
    this.attendanceAdjustments.push(newAdj);
    return newAdj;
  }

  async updateAttendanceEvent(eventId: string, patch: Partial<AttendanceEvent>): Promise<AttendanceEvent> {
    this.checkErrors();
    const evt = this.attendanceEvents.find(e => e.event_id === eventId);
    if (!evt) throw new Error('ATTENDANCE_EVENT_NOT_FOUND');
    Object.assign(evt, patch);
    return { ...evt };
  }

  async listAttendanceAdjustments(branchId?: string, employeeId?: string): Promise<AttendanceAdjustment[]> {
    this.checkErrors();
    return this.attendanceAdjustments.filter(a => {
      if (branchId && branchId !== '*' && a.branch_id !== branchId) return false;
      if (employeeId && a.employee_id !== employeeId) return false;
      return true;
    });
  }

  async deleteAttendanceAdjustment(id: string): Promise<boolean> {
    this.checkErrors();
    const idx = this.attendanceAdjustments.findIndex(a => a.adjustment_id === id);
    if (idx < 0) return false;
    this.attendanceAdjustments.splice(idx, 1);
    return true;
  }

  async updateAttendanceAdjustment(id: string, status: AdjustmentStatus, approverId: string, minutesApproved?: number, note?: string): Promise<AttendanceAdjustment> {
    this.checkErrors();
    const adj = this.attendanceAdjustments.find(a => a.adjustment_id === id);
    if (!adj) throw new Error('ADJUSTMENT_NOT_FOUND');
    adj.status = status;
    adj.approver_id = approverId;
    if (minutesApproved !== undefined) adj.minutes_approved = minutesApproved;
    if (note) adj.review_note = note;
    adj.version += 1;
    adj.updated_at = new Date().toISOString();
    return { ...adj };
  }

  // --- Payroll ---
  async createPayrollRun(run: Omit<PayrollRun, 'created_at' | 'updated_at' | 'version'>, items: Omit<PayslipItem, 'created_at' | 'updated_at'>[]): Promise<{ run: PayrollRun; items: PayslipItem[] }> {
    this.checkErrors();
    const now = new Date().toISOString();
    const newRun: PayrollRun = {
      ...run,
      created_at: now,
      updated_at: now,
      version: 1,
    };
    this.payrollRuns.push(newRun);

    const createdItems: PayslipItem[] = items.map(item => ({
      ...item,
      // Version chống pull Sheets nền ghi đè: phiếu vừa publish (memory mới)
      // phải thắng dòng DRAFT cũ trên Sheet khi mergeById so version.
      ...(typeof (item as any).version === 'number' ? {} : { version: 1 } as any),
      created_at: now,
      updated_at: now,
    }));
    this.payslips.push(...createdItems);

    return { run: newRun, items: createdItems };
  }

  async getPayrollRun(runId: string): Promise<PayrollRun | null> {
    this.checkErrors();
    const cleanId = String(runId || '').trim();
    if (!cleanId) return null;
    let run = this.payrollRuns.find(r => r.run_id === cleanId || r.period === cleanId) || null;
    if (!run) {
      // Tự dựng lại từ danh sách payslips nếu kỳ này đã có phiếu trong bộ nhớ
      const matchingSlips = this.payslips.filter(p => p.run_id === cleanId || p.period === cleanId);
      if (matchingSlips.length > 0) {
        const period = matchingSlips[0].period || (cleanId.startsWith('RUN_') ? cleanId.split('_')[1] : cleanId);
        const resolvedRunId = matchingSlips[0].run_id || (cleanId.startsWith('RUN_') ? cleanId : `RUN_${period}`);
        run = {
          run_id: resolvedRunId,
          period,
          branch_scope: 'ALL',
          status: matchingSlips.some(s => s.status === 'PAID') ? 'PAID'
            : matchingSlips.some(s => s.status === 'PUBLISHED') ? 'PUBLISHED'
            : matchingSlips.some(s => s.status === 'APPROVED') ? 'APPROVED'
            : 'DRAFT',
          total_employees: new Set(matchingSlips.map(s => s.employee_id)).size,
          total_hours: matchingSlips.reduce((sum, s) => sum + (Number(s.standard_hours) || 0), 0),
          total_amount: matchingSlips.reduce((sum, s) => sum + (Number(s.net_pay || (s as any).thuc_lanh) || 0), 0),
          created_by: 'ADM_001',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          version: 1,
        };
        this.payrollRuns.push(run);
      }
    }
    return run;
  }

  async listPayrollRuns(): Promise<PayrollRun[]> {
    this.checkErrors();
    // Bổ sung các kỳ lương tự phát hiện từ payslips (tránh trường hợp tab KY_LUONG trên Sheets trống)
    if (this.payslips && this.payslips.length > 0) {
      const knownRuns = new Set(this.payrollRuns.map(r => r.run_id));
      const knownPeriods = new Set(this.payrollRuns.map(r => r.period));
      const periodsFromSlips = [...new Set(this.payslips.map(p => p.period).filter(Boolean))];
      for (const p of periodsFromSlips) {
        if (!knownPeriods.has(p)) {
          const slips = this.payslips.filter(s => s.period === p);
          if (slips.length > 0) {
            const rId = slips[0].run_id || `RUN_${p}`;
            if (!knownRuns.has(rId)) {
              const syntheticRun: PayrollRun = {
                run_id: rId,
                period: p,
                branch_scope: 'ALL',
                status: slips.some(s => s.status === 'PAID') ? 'PAID'
                  : slips.some(s => s.status === 'PUBLISHED') ? 'PUBLISHED'
                  : slips.some(s => s.status === 'APPROVED') ? 'APPROVED'
                  : 'DRAFT',
                total_employees: new Set(slips.map(s => s.employee_id)).size,
                total_hours: slips.reduce((sum, s) => sum + (Number(s.standard_hours) || 0), 0),
                total_amount: slips.reduce((sum, s) => sum + (Number(s.net_pay || (s as any).thuc_lanh) || 0), 0),
                created_by: 'ADM_001',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                version: 1,
              };
              this.payrollRuns.push(syntheticRun);
              knownRuns.add(rId);
              knownPeriods.add(p);
            }
          }
        }
      }
    }
    return [...this.payrollRuns];
  }

  async updatePayrollRunStatus(runId: string, status: PayrollRunStatus, actorId: string, updates?: Partial<PayrollRun>): Promise<PayrollRun> {
    this.checkErrors();
    const cleanId = String(runId || '').trim();
    let run = this.payrollRuns.find(r => r.run_id === cleanId || r.period === cleanId);
    if (!run) {
      const matchingSlips = this.payslips.filter(p => p.run_id === cleanId || p.period === cleanId);
      if (matchingSlips.length > 0) {
        const period = matchingSlips[0].period || (cleanId.startsWith('RUN_') ? cleanId.split('_')[1] : cleanId);
        const resolvedRunId = matchingSlips[0].run_id || (cleanId.startsWith('RUN_') ? cleanId : `RUN_${period}`);
        run = {
          run_id: resolvedRunId,
          period,
          branch_scope: 'ALL',
          status: 'DRAFT',
          total_employees: new Set(matchingSlips.map(s => s.employee_id)).size,
          total_hours: matchingSlips.reduce((sum, s) => sum + (Number(s.standard_hours) || 0), 0),
          total_amount: matchingSlips.reduce((sum, s) => sum + (Number(s.net_pay || (s as any).thuc_lanh) || 0), 0),
          created_by: 'ADM_001',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          version: 1,
        };
        this.payrollRuns.push(run);
      }
    }
    if (!run) throw new Error('PAYROLL_RUN_NOT_FOUND');

    // Rule: separation of duties - approver must be different from creator (trừ admin hệ thống)
    if (status === 'APPROVED' && run.created_by === actorId && actorId !== 'ADM_001' && actorId !== 'ADMIN') {
      throw new Error('SEPARATION_OF_DUTIES_VIOLATION: Payroll creator cannot approve own payroll run');
    }

    // QUY TRÌNH TUẦN TỰ CẤP KỲ: DRAFT -> RECONCILED -> APPROVED -> PUBLISHED -> PAID.
    // Nhấn lại trạng thái hiện tại là idempotent (retry/timeout), không phải nhảy cóc.
    // Trạng thái phiếu TỪNG PHIẾU (DRAFT -> PUBLISHED -> CONFIRMED -> PAID) do
    // publishSlip/markSlipPaid quản lý theo chữ ký 3 bên — KHÔNG được gán hàng
    // loạt ở đây, nếu không sẽ bỏ qua chữ ký GĐ/NV (sai quy trình xuất phiếu).
    // Ngoại lệ: QUAY VỀ BƯỚC TRƯỚC (rollback có lý do) → cho phép về DRAFT từ bất kỳ trạng thái nào.
    const RUN_ORDER = ['DRAFT', 'RECONCILED', 'APPROVED', 'PUBLISHED', 'PAID'];
    const fromIdx = RUN_ORDER.indexOf(String(run.status || 'DRAFT'));
    const toIdx = RUN_ORDER.indexOf(String(status));
    const isRollbackToDraft = String(status) === 'DRAFT';
    if (!isRollbackToDraft && fromIdx >= 0 && toIdx >= 0 && toIdx !== fromIdx && toIdx !== fromIdx + 1) {
      throw new Error(`RUN_INVALID_TRANSITION: không thể chuyển kỳ lương từ ${run.status} sang ${status} — phải theo thứ tự DRAFT -> RECONCILED -> APPROVED -> PUBLISHED -> PAID!`);
    }

    run.status = status;
    run.updated_at = new Date().toISOString();
    run.version += 1;

    if (status === 'APPROVED') {
      run.approved_by = actorId;
      run.approved_at = run.updated_at;
    } else if (status === 'PUBLISHED') {
      run.published_by = actorId;
      run.published_at = run.updated_at;
    } else if (status === 'PAID') {
      run.paid_by = actorId;
      run.paid_at = run.updated_at;
    }

    if (updates) Object.assign(run, updates);
    return { ...run };
  }

  async getPayslipsForEmployee(employeeId: string): Promise<PayslipItem[]> {
    this.checkErrors();
    // NV thấy phiếu đã gửi (PUBLISHED), đang khiếu nại (COMPLAINED), đã xác nhận
    // (CONFIRMED) và đã chi trả (PAID) để theo dõi xử lý khiếu nại.
    return this.payslips.filter(p => p.employee_id === employeeId && (p.status === 'PUBLISHED' || p.status === 'COMPLAINED' || p.status === 'CONFIRMED' || p.status === 'PAID'));
  }

  async getPayslipsByRunId(runId: string): Promise<PayslipItem[]> {
    this.checkErrors();
    const cleanId = String(runId || '').trim();
    let res = this.payslips.filter(p => p.run_id === cleanId || p.period === cleanId);
    if (res.length === 0) {
      const run = this.payrollRuns.find(r => r.run_id === cleanId || r.period === cleanId);
      if (run) {
        res = this.payslips.filter(p => p.run_id === run.run_id || p.period === run.period);
      }
    }
    return res;
  }

  async getPayslipById(itemId: string): Promise<PayslipItem | null> {
    this.checkErrors();
    return this.payslips.find(p => p.item_id === itemId) || null;
  }

  async updatePayslip(itemId: string, updates: Partial<PayslipItem>): Promise<PayslipItem> {
    this.checkErrors();
    const slip = this.payslips.find(p => p.item_id === itemId);
    if (!slip) throw new Error('PAYSLIP_NOT_FOUND');
    // Ảnh chữ ký không lưu thô vào bộ nhớ: cắt ngưỡng chống phình RAM/Sheets.
    const clean: any = { ...updates };
    for (const k of ['sign_giamdoc', 'sign_lap', 'sign_quanly', 'sign_nhanvien'] as const) {
      const s: any = (clean as any)[k];
      if (s && typeof s.img === 'string' && s.img.length > 45000) {
        (clean as any)[k] = { ...s, img: s.img.slice(0, 45000) };
      }
    }
    Object.assign(slip, clean, { updated_at: new Date().toISOString() });
    // Gán undefined = XÓA field (VD hoàn phiếu xóa slip_published_at): Object.assign
    // giữ key undefined gây rác + lệch so sánh, xóa hẳn cho sạch.
    for (const k of Object.keys(clean)) {
      if ((clean as any)[k] === undefined) delete (slip as any)[k];
    }
    // FIX publish mẫu không tới NV: pull Sheets nền (10s) merge theo version,
    // phiếu pull về luôn version=1 nên bản PUBLISHED trong memory bị ghi đè
    // về DRAFT trước khi push kịp xong. Tăng version mỗi lần sửa để memory thắng.
    (slip as any).version = Number((slip as any).version || 1) + 1;
    return { ...slip };
  }

  // --- Công thức + dữ liệu nhập tay tính lương theo file Excel (Finance) ---
  async getPayrollFormula(period: string): Promise<PayrollFormula | null> {
    this.checkErrors();
    return this.payrollFormulas.find(f => f.period === period) || null;
  }

  async savePayrollFormula(formula: PayrollFormula): Promise<PayrollFormula> {
    this.checkErrors();
    const idx = this.payrollFormulas.findIndex(f => f.period === formula.period);
    const saved = { ...formula, updatedAt: new Date().toISOString() };
    if (idx >= 0) this.payrollFormulas[idx] = saved;
    else this.payrollFormulas.push(saved);
    return { ...saved };
  }

  async getPayrollInputs(period: string): Promise<PayrollPeriodInput[]> {
    this.checkErrors();
    return this.payrollInputs.filter(i => i.period === period).map(i => ({ ...i }));
  }

  async upsertPayrollInput(input: PayrollPeriodInput): Promise<PayrollPeriodInput> {
    this.checkErrors();
    const idx = this.payrollInputs.findIndex(
      i => i.period === input.period && i.employee_id === input.employee_id
    );
    const saved = { ...input, updatedAt: new Date().toISOString() };
    if (idx >= 0) this.payrollInputs[idx] = saved;
    else this.payrollInputs.push(saved);
    return { ...saved };
  }

  // --- Notifications ---
  async createNotification(outbox: Omit<NotificationOutboxItem, 'created_at'>, inboxes: Omit<NotificationInboxItem, 'created_at' | 'version'>[]): Promise<{ outbox: NotificationOutboxItem; inboxes: NotificationInboxItem[] }> {
    this.checkErrors();
    const now = new Date().toISOString();
    const newOutbox: NotificationOutboxItem = {
      ...outbox,
      created_at: now,
    };
    this.notificationOutbox.push(newOutbox);

    const newInboxes: NotificationInboxItem[] = inboxes.map(inbox => ({
      ...inbox,
      created_at: now,
      version: 1,
    }));
    this.notificationInbox.push(...newInboxes);

    return { outbox: newOutbox, inboxes: newInboxes };
  }

  async getInboxForRecipient(recipientId: string, unreadOnly?: boolean): Promise<NotificationInboxItem[]> {
    this.checkErrors();
    return this.notificationInbox.filter(n => {
      if (n.recipient_id !== recipientId && n.recipient_id !== 'ALL') return false;
      if (unreadOnly && n.read_at) return false;
      return true;
    }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  async listNotificationOutbox(): Promise<NotificationOutboxItem[]> {
    this.checkErrors();
    return [...this.notificationOutbox];
  }

  async markNotificationRead(inboxId: string, recipientId: string): Promise<NotificationInboxItem> {
    this.checkErrors();
    const item = this.notificationInbox.find(n => n.inbox_id === inboxId && (n.recipient_id === recipientId || n.recipient_id === 'ALL'));
    if (!item) throw new Error('NOTIFICATION_NOT_FOUND');
    if (!item.read_at) {
      item.read_at = new Date().toISOString();
      item.version += 1;
    }
    return { ...item };
  }

  async pruneNotifications(beforeIso: string): Promise<number> {
    this.checkErrors();
    const n0 = this.notificationInbox.length;
    this.notificationInbox = this.notificationInbox.filter(n => (n.created_at || '') >= beforeIso);
    this.notificationOutbox = this.notificationOutbox.filter(o => (o.created_at || '') >= beforeIso);
    return n0 - this.notificationInbox.length;
  }

  async markNotificationAcknowledged(inboxId: string, recipientId: string): Promise<NotificationInboxItem> {
    this.checkErrors();
    const item = this.notificationInbox.find(n => n.inbox_id === inboxId && (n.recipient_id === recipientId || n.recipient_id === 'ALL'));
    if (!item) throw new Error('NOTIFICATION_NOT_FOUND');
    item.acknowledged_at = new Date().toISOString();
    if (!item.read_at) item.read_at = item.acknowledged_at;
    item.version += 1;
    return { ...item };
  }

  // --- Bài TEST (HR giao đúng nhân viên) ---
  async createTestPaper(paper: Omit<TestPaper, 'created_at' | 'updated_at' | 'version'>): Promise<TestPaper> {
    this.checkErrors();
    const now = new Date().toISOString();
    const rec: TestPaper = { ...paper, created_at: now, updated_at: now, version: 1 };
    this.testPapers.push(rec);
    return { ...rec, questions: rec.questions.map(q => ({ ...q, options: [...q.options] })) };
  }

  async listTestPapers(): Promise<TestPaper[]> {
    this.checkErrors();
    return this.testPapers.map(p => ({ ...p, questions: p.questions.map(q => ({ ...q, options: [...q.options] })) }));
  }

  async getTestPaper(id: string): Promise<TestPaper | null> {
    this.checkErrors();
    const p = this.testPapers.find(t => t.test_id === id);
    return p ? { ...p, questions: p.questions.map(q => ({ ...q, options: [...q.options] })) } : null;
  }

  async updateTestPaper(id: string, updates: Partial<TestPaper>): Promise<TestPaper> {
    this.checkErrors();
    const p = this.testPapers.find(t => t.test_id === id);
    if (!p) throw new Error('TEST_NOT_FOUND');
    Object.assign(p, updates, { updated_at: new Date().toISOString(), version: p.version + 1 });
    return this.getTestPaper(id) as Promise<TestPaper>;
  }

  async createTestSubmission(sub: Omit<TestSubmission, 'created_at' | 'version'>): Promise<TestSubmission> {
    this.checkErrors();
    const rec: TestSubmission = { ...sub, created_at: new Date().toISOString(), version: 1 };
    this.testSubmissions.push(rec);
    return { ...rec, answers: rec.answers ? [...rec.answers] : undefined };
  }

  async listTestSubmissions(testId?: string, employeeId?: string): Promise<TestSubmission[]> {
    this.checkErrors();
    return this.testSubmissions
      .filter(s => (!testId || s.test_id === testId) && (!employeeId || s.employee_id === employeeId))
      .map(s => ({ ...s, answers: s.answers ? [...s.answers] : undefined }));
  }

  async updateTestSubmission(id: string, updates: Partial<TestSubmission>): Promise<TestSubmission> {
    this.checkErrors();
    const s = this.testSubmissions.find(x => x.submission_id === id);
    if (!s) throw new Error('SUBMISSION_NOT_FOUND');
    Object.assign(s, updates, { version: s.version + 1 });
    return { ...s, answers: s.answers ? [...s.answers] : undefined };
  }

  // --- Operations & Audit ---
  async recordOperation(op: Omit<OperationRecord, 'created_at' | 'updated_at'>): Promise<OperationRecord> {
    this.checkErrors();
    const now = new Date().toISOString();
    const newOp: OperationRecord = {
      ...op,
      created_at: now,
      updated_at: now,
    };
    this.operations.push(newOp);
    return newOp;
  }

  async getOperationById(operationId: string): Promise<OperationRecord | null> {
    this.checkErrors();
    return this.operations.find(o => o.operation_id === operationId) || null;
  }

  async findOperationByIdempotencyKey(key: string): Promise<OperationRecord | null> {
    this.checkErrors();
    return this.operations.find(o => o.idempotency_key === key) || null;
  }

  async updateOperation(operationId: string, updates: Partial<OperationRecord>): Promise<OperationRecord> {
    this.checkErrors();
    const op = this.operations.find(o => o.operation_id === operationId);
    if (!op) throw new Error('OPERATION_NOT_FOUND');
    Object.assign(op, updates, { updated_at: new Date().toISOString() });
    return { ...op };
  }

  async recordAuditLog(entry: Omit<AuditLogEntry, 'timestamp'>): Promise<AuditLogEntry> {
    this.checkErrors();
    // Chuẩn hóa cả kiểu gọi legacy {target_type, payload_after, thiếu log_id/actor_role}
    // để audit log luôn đủ field, đồng bộ Sheet không ra undefined.
    const raw = entry as any;
    const details = raw.details !== undefined ? raw.details : raw.payload_after;
    const newEntry: AuditLogEntry = {
      log_id: raw.log_id || `LOG_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      actor_id: raw.actor_id || 'SYSTEM',
      actor_role: raw.actor_role || 'SYSTEM',
      action: raw.action || 'UNKNOWN',
      target_entity: raw.target_entity || raw.target_type || '',
      target_id: raw.target_id || '',
      details: typeof details === 'string' ? details : JSON.stringify(details || {}),
      timestamp: new Date().toISOString(),
    };
    this.auditLogs.unshift(newEntry);
    return newEntry;
  }

  async getAuditLogs(limit = 100): Promise<AuditLogEntry[]> {
    this.checkErrors();
    return this.auditLogs.slice(0, limit);
  }

  // --- Admin Governance & System Operations ---
  async listAdminAccounts(): Promise<AdminAccount[]> {
    this.checkErrors();
    return [...this.adminAccounts];
  }

  async createAdminAccount(account: Omit<AdminAccount, 'created_at' | 'updated_at' | 'version'>): Promise<AdminAccount> {
    this.checkErrors();
    const now = new Date().toISOString();
    const newAdmin: AdminAccount = {
      ...account,
      is_active: account.is_active ?? true,
      version: 1,
      created_at: now,
      updated_at: now,
    };
    this.adminAccounts.push(newAdmin);
    return newAdmin;
  }

  async updateAdminAccount(id: string, updates: Partial<AdminAccount>): Promise<AdminAccount> {
    this.checkErrors();
    const admin = this.adminAccounts.find(a => a.admin_id === id);
    if (!admin) throw new Error('ADMIN_NOT_FOUND');
    Object.assign(admin, updates, {
      version: admin.version + 1,
      updated_at: new Date().toISOString(),
    });
    return { ...admin };
  }

  async deleteAdminAccount(id: string): Promise<boolean> {
    this.checkErrors();
    const idx = this.adminAccounts.findIndex(a => a.admin_id === id);
    if (idx === -1) return false;
    this.adminAccounts.splice(idx, 1);
    return true;
  }

  async getBranches(): Promise<BranchInfo[]> {
    this.checkErrors();
    return [...this.branches];
  }

  /** Thêm chi nhánh mới (Admin). Dữ liệu ghi xuống tab DANH_SACH_CHI_NHANH. */
  async createBranch(branch: Partial<BranchInfo>): Promise<BranchInfo> {
    this.checkErrors();
    const id = String(branch?.id ?? '').trim().toUpperCase();
    if (!id) throw new Error('BRANCH_ID_REQUIRED');
    if (!String(branch?.name ?? '').trim()) throw new Error('BRANCH_NAME_REQUIRED');
    if (this.branches.some(b => String(b.id).trim().toUpperCase() === id)) {
      throw new Error('BRANCH_ALREADY_EXISTS');
    }
    const lat = Number(branch?.latitude);
    const lng = Number(branch?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('BRANCH_COORDS_REQUIRED');
    const created: BranchInfo = {
      id,
      name: String(branch.name).trim(),
      address: String(branch?.address ?? '').trim(),
      latitude: lat,
      longitude: lng,
      radius_meters: Number(branch?.radius_meters) > 0 ? Number(branch?.radius_meters) : 300,
      gps_enabled: (branch as any)?.gps_enabled !== false,
      map_visible: (branch as any)?.map_visible !== false,
      min_staff: Number(branch?.min_staff) > 0 ? Number(branch?.min_staff) : 2,
      max_staff: Number(branch?.max_staff) > 0 ? Number(branch?.max_staff) : 10,
      manager_name: String((branch as any)?.manager_name ?? ''),
      status: ((branch?.status as any) || 'ACTIVE'),
    };
    this.branches.push(created);
    return { ...created };
  }

  async updateBranch(id: string, updates: Partial<BranchInfo>): Promise<BranchInfo> {
    this.checkErrors();
    const idx = this.branches.findIndex(b => b.id === id);
    if (idx === -1) throw new Error('BRANCH_NOT_FOUND');
    const next: any = { ...(updates || {}) };
    const num = (v: any) => (v === '' || v === null || v === undefined ? undefined : Number(v));
    for (const k of ['latitude', 'longitude', 'radius_meters', 'min_staff', 'max_staff']) {
      if (Object.prototype.hasOwnProperty.call(next, k)) {
        const n = num(next[k]);
        if (n === undefined) delete next[k];
        else if (!Number.isFinite(n)) throw new Error('BRANCH_INVALID_NUMBER');
        else next[k] = n;
      }
    }
    const bool = (v: any) => !(v === false || v === 0 || v === '0' || ['false', 'off', 'no', 'tắt', 'tat', 'không', 'khong'].includes(String(v).trim().toLowerCase()));
    if (Object.prototype.hasOwnProperty.call(next, 'gps_enabled')) next.gps_enabled = bool(next.gps_enabled);
    if (Object.prototype.hasOwnProperty.call(next, 'map_visible')) next.map_visible = bool(next.map_visible);
    if (Object.prototype.hasOwnProperty.call(next, 'id')) delete next.id;
    this.branches[idx] = { ...this.branches[idx], ...next };
    return { ...this.branches[idx] };
  }

  async getShiftTemplates(): Promise<any> {
    this.checkErrors();
    return { ...this.shiftTemplates };
  }

  async updateShiftTemplates(templates: any): Promise<any> {
    this.checkErrors();
    this.shiftTemplates = { ...templates };
    // Mirror vào systemSettings để đi theo luồng đồng bộ CAU_HINH_HE_THONG
    // (restart/pull khôi phục lại — xem GoogleSheetsSyncService pull config).
    (this.systemSettings as any).shiftTemplates = { ...templates };
    return { ...this.shiftTemplates };
  }

  async getPolicies(): Promise<any> {
    this.checkErrors();
    return { ...this.policies };
  }

  async updatePolicies(policies: any): Promise<any> {
    this.checkErrors();
    this.policies = { ...this.policies, ...policies, updated_at: new Date().toISOString() };
    // Mirror vào systemSettings để đi theo luồng đồng bộ CAU_HINH_HE_THONG.
    (this.systemSettings as any).policies = { ...this.policies };
    return { ...this.policies };
  }

  async getMaintenance(): Promise<any> {
    this.checkErrors();
    return { ...this.maintenance };
  }

  async updateMaintenance(maintenance: any): Promise<any> {
    this.checkErrors();
    this.maintenance = { ...this.maintenance, ...maintenance, updated_at: new Date().toISOString() };
    // Mirror vào systemSettings để đi theo luồng đồng bộ CAU_HINH_HE_THONG.
    (this.systemSettings as any).maintenance = { ...this.maintenance };
    return { ...this.maintenance };
  }

  async getBackupSnapshots(): Promise<any[]> {
    this.checkErrors();
    return [...this.backupSnapshots];
  }

  async createBackupSnapshot(name?: string): Promise<any> {
    this.checkErrors();
    const now = new Date().toISOString();
    const id = `SNAP_${Date.now()}`;
    const snap = {
      snapshot_id: id,
      name: name || `Manual Snapshot ${now}`,
      file_count: 23,
      size_mb: parseFloat((18.5 + Math.random() * 0.5).toFixed(1)),
      created_at: now,
      status: 'SUCCESS',
      verified: true,
    };
    this.backupSnapshots.unshift(snap);
    return snap;
  }

  async testRecovery(snapshotId: string): Promise<{ success: boolean; message: string; verified_tabs: number }> {
    this.checkErrors();
    const snap = this.backupSnapshots.find(s => s.snapshot_id === snapshotId);
    if (!snap) throw new Error('SNAPSHOT_NOT_FOUND');
    return {
      success: true,
      message: `Snapshot ${snapshotId} integrity verified successfully across all 23 tabs and Google Drive storage. Recovery test PASS.`,
      verified_tabs: 23,
    };
  }

  async getSystemSettings(): Promise<any> {
    this.checkErrors();
    return { ...this.systemSettings };
  }

  async updateSystemSettings(settings: any): Promise<any> {
    this.checkErrors();
    const next = { ...this.systemSettings, ...settings, updated_at: new Date().toISOString() };
    // CHỐNG GHI ĐÈ NGƯỢC: nhiều dịch vụ đọc snapshot cài đặt rồi ghi lại toàn bộ
    // (`{...settings, key}`). Nếu snapshot đó cũ, cấu hình lương vừa lưu có thể bị
    // ghi đè bằng bản cũ. Với employee_salary_config, hợp nhất theo TỪNG nhân viên
    // và chỉ nhận bản có `updatedAt` mới hơn/không cũ hơn.
    if (settings && Object.prototype.hasOwnProperty.call(settings, 'employee_salary_config')) {
      const prev = this.systemSettings?.employee_salary_config;
      const incoming = settings.employee_salary_config;
      if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
        const merged: Record<string, any> = (prev && typeof prev === 'object' && !Array.isArray(prev)) ? { ...prev } : {};
        for (const [employeeId, entry] of Object.entries(incoming)) {
          const oldAt = Date.parse(String((merged[employeeId] as any)?.updatedAt || '')) || 0;
          const newAt = Date.parse(String((entry as any)?.updatedAt || '')) || 0;
          if (!merged[employeeId] || newAt >= oldAt) merged[employeeId] = entry;
        }
        next.employee_salary_config = merged;
      }
    }
    this.systemSettings = next;
    return { ...this.systemSettings };
  }

  // ============================================================
  // MILKROUTE EV — thao tác ghi
  // Các method này được PostgresAdapter bọc lại (WRITE_METHODS) để
  // persistMutation() ghi xuống bảng ev_* NGAY trong cùng request.
  // ============================================================

  private touchEv<T extends { updated_at?: string; version?: number }>(row: T): T {
    return { ...row, updated_at: new Date().toISOString(), version: Number((row as any).version || 0) + 1 };
  }

  // ---------- Xe điện ----------
  async createEVVehicle(input: Partial<EVVehicle>): Promise<EVVehicle> {
    this.checkErrors();
    const plate = String(input?.license_plate ?? '').trim().toUpperCase();
    if (!plate) throw new Error('VEHICLE_PLATE_REQUIRED');
    if (this.evVehicles.some(v => v.license_plate.toUpperCase() === plate)) {
      throw new Error('VEHICLE_PLATE_EXISTS: Biển số xe đã tồn tại');
    }
    const now = new Date().toISOString();
    const created: EVVehicle = {
      vehicle_id: uuidv4(),
      license_plate: plate,
      frame_number: String(input?.frame_number ?? '').trim() || undefined,
      battery_capacity_kwh: Number(input?.battery_capacity_kwh) > 0 ? Number(input.battery_capacity_kwh) : undefined,
      current_battery_pct: Number.isFinite(Number(input?.current_battery_pct)) ? Number(input.current_battery_pct) : 100,
      status: (input?.status as EVVehicle['status']) || 'ACTIVE',
      assigned_driver_id: String(input?.assigned_driver_id ?? '').trim() || undefined,
      gps_device_id: String(input?.gps_device_id ?? '').trim() || undefined,
      notes: String(input?.notes ?? '').trim() || undefined,
      created_at: now,
      updated_at: now,
      version: 1,
    };
    this.evVehicles.push(created);
    return { ...created };
  }

  async updateEVVehicle(vehicleId: string, updates: Partial<EVVehicle>): Promise<EVVehicle> {
    this.checkErrors();
    const idx = this.evVehicles.findIndex(v => v.vehicle_id === vehicleId);
    if (idx === -1) throw new Error('VEHICLE_NOT_FOUND');
    const next: any = { ...(updates || {}) };
    if (Object.prototype.hasOwnProperty.call(next, 'license_plate')) {
      const plate = String(next.license_plate ?? '').trim().toUpperCase();
      if (!plate) throw new Error('VEHICLE_PLATE_REQUIRED');
      if (this.evVehicles.some((v, i) => i !== idx && v.license_plate.toUpperCase() === plate)) {
        throw new Error('VEHICLE_PLATE_EXISTS: Biển số xe đã tồn tại');
      }
      next.license_plate = plate;
    }
    delete next.vehicle_id;
    delete next.created_at;
    this.evVehicles[idx] = this.touchEv({ ...this.evVehicles[idx], ...next });
    return { ...this.evVehicles[idx] };
  }

  async deleteEVVehicle(vehicleId: string): Promise<boolean> {
    this.checkErrors();
    const idx = this.evVehicles.findIndex(v => v.vehicle_id === vehicleId);
    if (idx === -1) return false;
    this.evVehicles.splice(idx, 1);
    return true;
  }

  // ---------- Lộ trình & điểm dừng ----------
  async createEVRoute(input: Partial<EVRoute>): Promise<EVRoute> {
    this.checkErrors();
    const name = String(input?.name ?? '').trim();
    if (!name) throw new Error('ROUTE_NAME_REQUIRED');
    const now = new Date().toISOString();
    const created: EVRoute = {
      route_id: uuidv4(),
      name,
      description: String(input?.description ?? '').trim() || undefined,
      is_active: input?.is_active !== false,
      total_distance_km: Number(input?.total_distance_km) > 0 ? Number(input.total_distance_km) : undefined,
      estimated_duration_min: Number(input?.estimated_duration_min) > 0 ? Number(input.estimated_duration_min) : undefined,
      created_at: now,
      updated_at: now,
      version: 1,
    };
    this.evRoutes.push(created);
    return { ...created };
  }

  async updateEVRoute(routeId: string, updates: Partial<EVRoute>): Promise<EVRoute> {
    this.checkErrors();
    const idx = this.evRoutes.findIndex(r => r.route_id === routeId);
    if (idx === -1) throw new Error('ROUTE_NOT_FOUND');
    const next: any = { ...(updates || {}) };
    delete next.route_id;
    delete next.created_at;
    this.evRoutes[idx] = this.touchEv({ ...this.evRoutes[idx], ...next });
    return { ...this.evRoutes[idx] };
  }

  async deleteEVRoute(routeId: string): Promise<boolean> {
    this.checkErrors();
    const idx = this.evRoutes.findIndex(r => r.route_id === routeId);
    if (idx === -1) return false;
    if (this.evRouteStops.some(s => s.route_id === routeId)) throw new Error('ROUTE_HAS_STOPS: Lộ trình còn điểm dừng');
    if (this.evShifts.some(s => s.route_id === routeId)) throw new Error('ROUTE_HAS_SHIFTS: Lộ trình còn ca vận chuyển');
    this.evRoutes.splice(idx, 1);
    return true;
  }

  async createEVRouteStop(input: Partial<EVRouteStop>): Promise<EVRouteStop> {
    this.checkErrors();
    const routeId = String(input?.route_id ?? '').trim();
    if (!routeId) throw new Error('STOP_ROUTE_REQUIRED');
    if (!this.evRoutes.some(r => r.route_id === routeId)) throw new Error('ROUTE_NOT_FOUND');
    const order = Number(input?.stop_order);
    if (!Number.isInteger(order) || order < 1) throw new Error('STOP_ORDER_INVALID');
    if (this.evRouteStops.some(s => s.route_id === routeId && s.stop_order === order)) {
      throw new Error('STOP_ORDER_EXISTS: Thứ tự điểm dừng này đã có trên lộ trình');
    }
    const name = String(input?.name ?? '').trim();
    if (!name) throw new Error('STOP_NAME_REQUIRED');
    const now = new Date().toISOString();
    const created: EVRouteStop = {
      stop_id: uuidv4(),
      route_id: routeId,
      stop_order: order,
      name,
      branch_id: String(input?.branch_id ?? '').trim() || undefined,
      address: String(input?.address ?? '').trim() || undefined,
      latitude: Number(input?.latitude),
      longitude: Number(input?.longitude),
      geofence_radius_m: Number(input?.geofence_radius_m) > 0 ? Number(input.geofence_radius_m) : 100,
      sla_minutes: Number(input?.sla_minutes) >= 0 ? Number(input.sla_minutes) : 0,
      stop_type: (input?.stop_type as EVRouteStop['stop_type']) || 'DELIVERY',
      is_mandatory: input?.is_mandatory !== false,
      notes: String(input?.notes ?? '').trim() || undefined,
      created_at: now,
      updated_at: now,
      version: 1,
    };
    this.evRouteStops.push(created);
    return { ...created };
  }

  async updateEVRouteStop(stopId: string, updates: Partial<EVRouteStop>): Promise<EVRouteStop> {
    this.checkErrors();
    const idx = this.evRouteStops.findIndex(s => s.stop_id === stopId);
    if (idx === -1) throw new Error('STOP_NOT_FOUND');
    const next: any = { ...(updates || {}) };
    delete next.stop_id;
    delete next.created_at;
    if (Object.prototype.hasOwnProperty.call(next, 'stop_order') || Object.prototype.hasOwnProperty.call(next, 'route_id')) {
      const routeId = String(next.route_id ?? this.evRouteStops[idx].route_id);
      const order = Number(next.stop_order ?? this.evRouteStops[idx].stop_order);
      if (this.evRouteStops.some((s, i) => i !== idx && s.route_id === routeId && s.stop_order === order)) {
        throw new Error('STOP_ORDER_EXISTS: Thứ tự điểm dừng này đã có trên lộ trình');
      }
    }
    this.evRouteStops[idx] = this.touchEv({ ...this.evRouteStops[idx], ...next });
    return { ...this.evRouteStops[idx] };
  }

  async deleteEVRouteStop(stopId: string): Promise<boolean> {
    this.checkErrors();
    const idx = this.evRouteStops.findIndex(s => s.stop_id === stopId);
    if (idx === -1) return false;
    if (this.evShiftCheckins.some(c => c.stop_id === stopId)) {
      throw new Error('STOP_HAS_CHECKINS: Điểm dừng đã có lượt xác nhận, không thể xóa');
    }
    this.evRouteStops.splice(idx, 1);
    return true;
  }

  // ---------- Phiếu đổi lộ trình (Nhân sự tạo — Giám đốc duyệt) ----------
  async createEVRouteChangeRequest(input: Partial<EVRouteChangeRequest>): Promise<EVRouteChangeRequest> {
    this.checkErrors();
    const routeId = String(input?.route_id ?? '').trim();
    if (!routeId) throw new Error('ROUTE_CHANGE_ROUTE_REQUIRED');
    const route = this.evRoutes.find(r => r.route_id === routeId);
    if (!route) throw new Error('ROUTE_NOT_FOUND');
    const stops = Array.isArray(input?.stops) ? input!.stops : [];
    if (!stops.length) throw new Error('ROUTE_CHANGE_STOPS_REQUIRED');
    const now = new Date().toISOString();
    const seq = this.evRouteChangeRequests.length + 1;
    const created: EVRouteChangeRequest = {
      request_id: uuidv4(),
      request_code: `RCR-${now.slice(0, 10).replace(/-/g, '')}-${String(seq).padStart(4, '0')}`,
      route_id: routeId,
      route_name: String(input?.route_name ?? route.name ?? '').trim(),
      product_name: String(input?.product_name ?? '').trim() || undefined,
      effective_from: String(input?.effective_from ?? '').slice(0, 10),
      effective_to: String(input?.effective_to ?? '').slice(0, 10),
      reason: String(input?.reason ?? '').trim() || undefined,
      status: (input?.status as EVRouteChangeRequest['status']) || 'PENDING',
      stops: stops.map((s: any) => ({ ...s })),
      created_by: String(input?.created_by ?? '').trim() || 'SYSTEM',
      created_by_name: String(input?.created_by_name ?? '').trim() || undefined,
      submitted_at: String(input?.submitted_at ?? now),
      version: 1,
      created_at: now,
      updated_at: now,
    };
    this.evRouteChangeRequests.push(created);
    return { ...created, stops: created.stops.map((s) => ({ ...s })) };
  }

  async updateEVRouteChangeRequest(requestId: string, updates: Partial<EVRouteChangeRequest>): Promise<EVRouteChangeRequest> {
    this.checkErrors();
    const idx = this.evRouteChangeRequests.findIndex(r => r.request_id === requestId);
    if (idx === -1) throw new Error('ROUTE_CHANGE_NOT_FOUND');
    const next: any = { ...(updates || {}) };
    delete next.request_id;
    delete next.created_at;
    if (Array.isArray(next.stops)) next.stops = next.stops.map((s: any) => ({ ...s }));
    this.evRouteChangeRequests[idx] = this.touchEv({ ...this.evRouteChangeRequests[idx], ...next });
    return { ...this.evRouteChangeRequests[idx], stops: this.evRouteChangeRequests[idx].stops.map((s) => ({ ...s })) };
  }

  async deleteEVRouteChangeRequest(requestId: string): Promise<boolean> {
    this.checkErrors();
    const idx = this.evRouteChangeRequests.findIndex(r => r.request_id === requestId);
    if (idx === -1) return false;
    this.evRouteChangeRequests.splice(idx, 1);
    return true;
  }

  // ---------- Ca vận chuyển ----------
  async createEVShift(input: Partial<EVShift>): Promise<EVShift> {
    this.checkErrors();
    const routeId = String(input?.route_id ?? '').trim();
    const driverId = String(input?.driver_id ?? '').trim();
    const vehicleId = String(input?.vehicle_id ?? '').trim();
    const shiftDate = String(input?.shift_date ?? '').trim();
    if (!routeId || !driverId || !vehicleId || !shiftDate) throw new Error('SHIFT_REQUIRED_FIELDS');
    if (!this.evRoutes.some(r => r.route_id === routeId)) throw new Error('ROUTE_NOT_FOUND');
    if (!this.evVehicles.some(v => v.vehicle_id === vehicleId)) throw new Error('VEHICLE_NOT_FOUND');
    if (!this.employees.some(e => e.employee_id === driverId)) throw new Error('DRIVER_NOT_FOUND');
    if (this.evShifts.some(s => s.driver_id === driverId && s.shift_date === shiftDate && s.status !== 'CANCELLED')) {
      throw new Error('DRIVER_HAS_SHIFT: Tài xế đã có ca vào ngày này');
    }
    if (this.evShifts.some(s => s.vehicle_id === vehicleId && s.shift_date === shiftDate && s.status !== 'CANCELLED')) {
      throw new Error('VEHICLE_HAS_SHIFT: Xe đã được phân ca vào ngày này');
    }
    const now = new Date().toISOString();
    const created: EVShift = {
      shift_id: uuidv4(),
      route_id: routeId,
      driver_id: driverId,
      vehicle_id: vehicleId,
      shift_date: shiftDate,
      planned_start_at: String(input?.planned_start_at ?? now),
      planned_end_at: input?.planned_end_at || undefined,
      product_name: String(input?.product_name ?? '').trim() || undefined,
      status: 'SCHEDULED',
      penalty_points: 0,
      penalty_amount: 0,
      net_pay: 0,
      work_day_index: Number(input?.work_day_index) > 0 ? Number(input.work_day_index) : undefined,
      notes: String(input?.notes ?? '').trim() || undefined,
      created_by: String(input?.created_by ?? '').trim() || 'SYSTEM',
      created_at: now,
      updated_at: now,
      version: 1,
    };
    this.evShifts.push(created);
    return { ...created };
  }

  async updateEVShift(shiftId: string, updates: Partial<EVShift>): Promise<EVShift> {
    this.checkErrors();
    const idx = this.evShifts.findIndex(s => s.shift_id === shiftId);
    if (idx === -1) throw new Error('SHIFT_NOT_FOUND');
    const next: any = { ...(updates || {}) };
    delete next.shift_id;
    delete next.created_at;
    this.evShifts[idx] = this.touchEv({ ...this.evShifts[idx], ...next });
    return { ...this.evShifts[idx] };
  }

  async deleteEVShift(shiftId: string): Promise<boolean> {
    this.checkErrors();
    const idx = this.evShifts.findIndex(s => s.shift_id === shiftId);
    if (idx === -1) return false;
    const status = this.evShifts[idx].status;
    if (status === 'IN_PROGRESS' || status === 'COMPLETED') {
      throw new Error('SHIFT_IN_PROGRESS: Không thể xóa ca đã bắt đầu hoặc hoàn thành');
    }
    this.evShiftCheckins = this.evShiftCheckins.filter(c => c.shift_id !== shiftId);
    this.evChargingTickets = this.evChargingTickets.filter(t => t.shift_id !== shiftId);
    this.evGpsPoints = this.evGpsPoints.filter(p => p.shift_id !== shiftId);
    this.evShifts.splice(idx, 1);
    return true;
  }

  // ---------- Xác nhận điểm (check-in) ----------
  async createEVShiftCheckin(input: Partial<EVShiftCheckin>): Promise<EVShiftCheckin> {
    this.checkErrors();
    const shiftId = String(input?.shift_id ?? '').trim();
    const stopId = String(input?.stop_id ?? '').trim();
    if (!shiftId || !stopId) throw new Error('CHECKIN_REQUIRED_FIELDS');
    if (!this.evShifts.some(s => s.shift_id === shiftId)) throw new Error('SHIFT_NOT_FOUND');
    // Điểm dừng có thể đến từ phiếu đổi lộ trình đã duyệt (id RCS_... không nằm
    // trong evRouteStops gốc) → chấp nhận khi có kèm stop_name.
    const knownStop = this.evRouteStops.some(s => s.stop_id === stopId);
    const stopName = String(input?.stop_name ?? '').trim();
    if (!knownStop && !stopName) throw new Error('STOP_NOT_FOUND');
    if (this.evShiftCheckins.some(c => c.shift_id === shiftId && c.stop_id === stopId)) {
      throw new Error('ALREADY_CHECKED_IN: Đã check-in tại điểm này');
    }
    const now = new Date().toISOString();
    const created: EVShiftCheckin = {
      checkin_id: uuidv4(),
      shift_id: shiftId,
      stop_id: stopId,
      stop_order: Number(input?.stop_order) || 0,
      stop_name: stopName || undefined,
      checked_in_at: String(input?.checked_in_at ?? now),
      latitude: Number(input?.latitude) || 0,
      longitude: Number(input?.longitude) || 0,
      distance_m: Number(input?.distance_m) || 0,
      is_within_geofence: input?.is_within_geofence !== false,
      sla_minutes: Number(input?.sla_minutes) || 0,
      actual_travel_min: Number(input?.actual_travel_min) || 0,
      is_late: !!input?.is_late,
      late_minutes: Number(input?.late_minutes) || 0,
      penalty_amount: Number(input?.penalty_amount) || 0,
      is_missed: !!input?.is_missed,
      notes: String(input?.notes ?? '').trim() || undefined,
      created_at: now,
    };
    this.evShiftCheckins.push(created);
    return { ...created };
  }

  async updateEVShiftCheckin(checkinId: string, updates: Partial<EVShiftCheckin>): Promise<EVShiftCheckin> {
    this.checkErrors();
    const idx = this.evShiftCheckins.findIndex(c => c.checkin_id === checkinId);
    if (idx === -1) throw new Error('CHECKIN_NOT_FOUND');
    const next: any = { ...(updates || {}) };
    delete next.checkin_id;
    delete next.created_at;
    this.evShiftCheckins[idx] = { ...this.evShiftCheckins[idx], ...next };
    return { ...this.evShiftCheckins[idx] };
  }

  async deleteEVShiftCheckin(checkinId: string): Promise<boolean> {
    this.checkErrors();
    const idx = this.evShiftCheckins.findIndex(c => c.checkin_id === checkinId);
    if (idx === -1) return false;
    this.evShiftCheckins.splice(idx, 1);
    return true;
  }

  // ---------- Phiếu sạc xe điện ----------
  async createEVChargingTicket(input: Partial<EVChargingTicket>): Promise<EVChargingTicket> {
    this.checkErrors();
    const shiftId = String(input?.shift_id ?? '').trim();
    const driverId = String(input?.driver_id ?? '').trim();
    if (!shiftId || !driverId) throw new Error('TICKET_REQUIRED_FIELDS');
    if (!this.evShifts.some(s => s.shift_id === shiftId)) throw new Error('SHIFT_NOT_FOUND');
    const now = new Date().toISOString();
    const created: EVChargingTicket = {
      ticket_id: uuidv4(),
      shift_id: shiftId,
      driver_id: driverId,
      requested_date: String(input?.requested_date ?? '').trim(),
      battery_level_pct: Number.isFinite(Number(input?.battery_level_pct)) ? Number(input.battery_level_pct) : undefined,
      notes: String(input?.notes ?? '').trim() || undefined,
      // Phiếu sạc do tài xế tạo đi thẳng tới Giám đốc hoặc Kế toán duyệt
      // (bỏ bước HR duyệt cấp 1).
      status: 'PENDING_DIRECTOR',
      created_at: now,
      updated_at: now,
    };
    this.evChargingTickets.push(created);
    return { ...created };
  }

  async updateEVChargingTicket(ticketId: string, updates: Partial<EVChargingTicket>): Promise<EVChargingTicket> {
    this.checkErrors();
    const idx = this.evChargingTickets.findIndex(t => t.ticket_id === ticketId);
    if (idx === -1) throw new Error('TICKET_NOT_FOUND');
    const next: any = { ...(updates || {}) };
    delete next.ticket_id;
    delete next.created_at;
    this.evChargingTickets[idx] = { ...this.evChargingTickets[idx], ...next, updated_at: new Date().toISOString() };
    return { ...this.evChargingTickets[idx] };
  }

  async deleteEVChargingTicket(ticketId: string): Promise<boolean> {
    this.checkErrors();
    const idx = this.evChargingTickets.findIndex(t => t.ticket_id === ticketId);
    if (idx === -1) return false;
    this.evChargingTickets.splice(idx, 1);
    return true;
  }

  // ---------- GPS (ghi theo lô) ----------
  async createEVGpsPoints(points: Partial<EVGPSPoint>[]): Promise<EVGPSPoint[]> {
    this.checkErrors();
    const now = new Date().toISOString();
    const saved: EVGPSPoint[] = [];
    for (const input of points || []) {
      const shiftId = String(input?.shift_id ?? '').trim();
      const lat = Number(input?.latitude);
      const lng = Number(input?.longitude);
      if (!shiftId || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
      const point: EVGPSPoint = {
        point_id: uuidv4(),
        shift_id: shiftId,
        driver_id: String(input?.driver_id ?? '').trim(),
        vehicle_id: String(input?.vehicle_id ?? '').trim(),
        recorded_at: String(input?.recorded_at ?? now),
        latitude: lat,
        longitude: lng,
        accuracy_m: Number.isFinite(Number(input?.accuracy_m)) ? Number(input.accuracy_m) : undefined,
        speed_kmh: Number.isFinite(Number(input?.speed_kmh)) ? Number(input.speed_kmh) : undefined,
        heading: Number.isFinite(Number(input?.heading)) ? Number(input.heading) : undefined,
        battery_pct: Number.isFinite(Number(input?.battery_pct)) ? Number(input.battery_pct) : undefined,
        is_mock: !!input?.is_mock,
        created_at: now,
      };
      this.evGpsPoints.push(point);
      saved.push(point);
    }
    return saved;
  }

  /** Dọn GPS quá hạn — xóa theo mốc thời gian (persist bằng DELETE riêng). */
  async pruneEVGpsPoints(cutoffISO: string): Promise<number> {
    this.checkErrors();
    const before = this.evGpsPoints.length;
    this.evGpsPoints = this.evGpsPoints.filter(p => String(p.recorded_at) >= cutoffISO);
    return before - this.evGpsPoints.length;
  }

  // ---------- Bảng lương tài xế ----------
  async createEVDriverPayroll(input: Partial<EVDriverPayroll>): Promise<EVDriverPayroll> {
    this.checkErrors();
    const driverId = String(input?.driver_id ?? '').trim();
    const period = String(input?.period ?? '').trim();
    if (!driverId || !period) throw new Error('PAYROLL_REQUIRED_FIELDS');
    if (this.evDriverPayroll.some(p => p.driver_id === driverId && p.period === period)) {
      throw new Error('PAYROLL_EXISTS: Đã có bảng lương tài xế cho kỳ này');
    }
    const now = new Date().toISOString();
    const created: EVDriverPayroll = {
      payroll_id: uuidv4(),
      driver_id: driverId,
      period,
      total_shifts: Number(input?.total_shifts) || 0,
      total_work_days: Number(input?.total_work_days) || 0,
      standard_days: Number(input?.standard_days) || 0,
      extra_days: Number(input?.extra_days) || 0,
      standard_pay: Number(input?.standard_pay) || 0,
      extra_pay: Number(input?.extra_pay) || 0,
      total_penalty_points: Number(input?.total_penalty_points) || 0,
      total_penalty_amount: Number(input?.total_penalty_amount) || 0,
      penalty_breakdown: input?.penalty_breakdown || { missed_checkins: 0, late_sla: 0, details: [] },
      gross_pay: Number(input?.gross_pay) || 0,
      net_pay: Number(input?.net_pay) || 0,
      status: 'DRAFT',
      created_by: String(input?.created_by ?? '').trim() || 'SYSTEM',
      created_at: now,
      updated_at: now,
    };
    this.evDriverPayroll.push(created);
    return { ...created };
  }

  async updateEVDriverPayroll(payrollId: string, updates: Partial<EVDriverPayroll>): Promise<EVDriverPayroll> {
    this.checkErrors();
    const idx = this.evDriverPayroll.findIndex(p => p.payroll_id === payrollId);
    if (idx === -1) throw new Error('PAYROLL_NOT_FOUND');
    const next: any = { ...(updates || {}) };
    delete next.payroll_id;
    delete next.created_at;
    this.evDriverPayroll[idx] = { ...this.evDriverPayroll[idx], ...next, updated_at: new Date().toISOString() };
    return { ...this.evDriverPayroll[idx] };
  }

  async deleteEVDriverPayroll(payrollId: string): Promise<boolean> {
    this.checkErrors();
    const idx = this.evDriverPayroll.findIndex(p => p.payroll_id === payrollId);
    if (idx === -1) return false;
    this.evDriverPayroll.splice(idx, 1);
    return true;
  }
}

