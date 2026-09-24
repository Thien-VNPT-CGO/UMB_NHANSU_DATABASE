import { v4 as uuidv4 } from 'uuid';
import {
  EmployeeAccount,
  AdminAccount,
  AccountStatus,
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
} from '@ubm/shared';
import { ISheetsRepository } from './sheets.interface.js';

export class MockSheetsAdapter implements ISheetsRepository {
  public accounts: EmployeeAccount[] = [];
  public adminAccounts: AdminAccount[] = [];
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
  public notificationOutbox: NotificationOutboxItem[] = [];
  public notificationInbox: NotificationInboxItem[] = [];
  public operations: OperationRecord[] = [];
  public auditLogs: AuditLogEntry[] = [];

  // New admin governance structures
  public branches: BranchInfo[] = [];
  public shiftTemplates: any = {};
  public policies: any = {};
  public maintenance: any = {};
  public backupSnapshots: any[] = [];
  public systemSettings: any = {};

  // Fault injection controls
  public simulateNetworkError = false;
  public simulateQuotaError = false;
  public simulatePartialWriteError = false;

  constructor() {
    this.seedInitialData();
  }

  public seedInitialData() {
    const now = new Date().toISOString();

    // 1. Admin Accounts (Admin, HR, Store, Finance, MKT)
    this.adminAccounts = [
      {
        admin_id: 'ADM_001',
        username: 'admin',
        password_hash: 'Master@@2027',
        full_name: 'Quản Trị Viên Hệ Thống',
        role: 'ADMIN',
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
      weekly_off_window: 'T6 12:00 -> T7 15:00',
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
    return this.accounts.filter(a => a.phone_normalized === phone);
  }

  async getAccountById(id: string): Promise<EmployeeAccount | null> {
    this.checkErrors();
    return this.accounts.find(a => a.account_id === id) || null;
  }

  async listAccounts(): Promise<EmployeeAccount[]> {
    this.checkErrors();
    return [...this.accounts];
  }

  async updateAccountStatus(id: string, status: AccountStatus, actorId: string, expectedVersion: number): Promise<EmployeeAccount> {
    this.checkErrors();
    const account = this.accounts.find(a => a.account_id === id);
    if (!account) throw new Error('ACCOUNT_NOT_FOUND');
    if (account.version !== expectedVersion) throw new Error('VERSION_CONFLICT');

    account.account_status = status;
    account.version += 1;
    account.updated_at = new Date().toISOString();

    if (status === 'ACTIVE') {
      account.activated_by = actorId;
      account.activated_at = account.updated_at;
    } else if (status === 'REVOKED' || status === 'SUSPENDED') {
      account.revoked_by = actorId;
      account.revoked_at = account.updated_at;
    }

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
    return this.adminAccounts.find(a => a.username === username && a.is_active) || null;
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

    Object.assign(emp, updates, {
      version: emp.version + 1,
      updated_at: new Date().toISOString(),
    });
    return { ...emp };
  }

  async deleteEmployee(id: string): Promise<boolean> {
    this.checkErrors();
    const empIndex = this.employees.findIndex(e => e.employee_id === id);
    if (empIndex === -1) return false;
    this.employees.splice(empIndex, 1);
    this.accounts = this.accounts.filter(a => a.employee_id !== id);
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

  // --- Schedules ---
  async getShiftsForWeek(branchId: string, weekStartDate: string): Promise<ShiftAssignment[]> {
    this.checkErrors();
    return this.shifts.filter(s => (branchId === '*' || s.branch_id === branchId) && s.date >= weekStartDate);
  }

  async getShiftsForEmployee(employeeId: string, fromDate: string, toDate: string): Promise<ShiftAssignment[]> {
    this.checkErrors();
    return this.shifts.filter(s => s.employee_id === employeeId && s.date >= fromDate && s.date <= toDate);
  }

  async getShiftById(assignmentId: string): Promise<ShiftAssignment | null> {
    this.checkErrors();
    return this.shifts.find(s => s.assignment_id === assignmentId) || null;
  }

  async createShiftAssignment(assignment: Omit<ShiftAssignment, 'created_at' | 'updated_at'>): Promise<ShiftAssignment> {
    this.checkErrors();
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
    const swap = this.swapRequests.find(s => s.swap_id === id);
    if (!swap) throw new Error('SWAP_REQUEST_NOT_FOUND');
    Object.assign(swap, updates, { version: swap.version + 1 });
    return { ...swap };
  }

  // --- Attendance ---
  async recordAttendanceEvent(event: Omit<AttendanceEvent, 'created_at'>): Promise<AttendanceEvent> {
    this.checkErrors();
    // Verify idempotency by request_id
    const existing = this.attendanceEvents.find(e => e.request_id === event.request_id);
    if (existing) {
      return existing;
    }

    const newEvent: AttendanceEvent = {
      ...event,
      created_at: new Date().toISOString(),
    };
    this.attendanceEvents.push(newEvent);
    return newEvent;
  }

  async getAttendanceEvents(employeeId: string, date: string): Promise<AttendanceEvent[]> {
    this.checkErrors();
    return this.attendanceEvents.filter(e => e.employee_id === employeeId && e.client_time.startsWith(date));
  }

  async findAttendanceEventByRequestId(requestId: string): Promise<AttendanceEvent | null> {
    this.checkErrors();
    return this.attendanceEvents.find(e => e.request_id === requestId) || null;
  }

  async createAttendanceAdjustment(adj: Omit<AttendanceAdjustment, 'created_at' | 'updated_at' | 'version'>): Promise<AttendanceAdjustment> {
    this.checkErrors();
    const now = new Date().toISOString();
    const newAdj: AttendanceAdjustment = {
      ...adj,
      created_at: now,
      updated_at: now,
      version: 1,
    };
    this.attendanceAdjustments.push(newAdj);
    return newAdj;
  }

  async listAttendanceAdjustments(branchId?: string, employeeId?: string): Promise<AttendanceAdjustment[]> {
    this.checkErrors();
    return this.attendanceAdjustments.filter(a => {
      if (branchId && branchId !== '*' && a.branch_id !== branchId) return false;
      if (employeeId && a.employee_id !== employeeId) return false;
      return true;
    });
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
      created_at: now,
      updated_at: now,
    }));
    this.payslips.push(...createdItems);

    return { run: newRun, items: createdItems };
  }

  async getPayrollRun(runId: string): Promise<PayrollRun | null> {
    this.checkErrors();
    return this.payrollRuns.find(r => r.run_id === runId) || null;
  }

  async listPayrollRuns(): Promise<PayrollRun[]> {
    this.checkErrors();
    return [...this.payrollRuns];
  }

  async updatePayrollRunStatus(runId: string, status: PayrollRunStatus, actorId: string, updates?: Partial<PayrollRun>): Promise<PayrollRun> {
    this.checkErrors();
    const run = this.payrollRuns.find(r => r.run_id === runId);
    if (!run) throw new Error('PAYROLL_RUN_NOT_FOUND');

    // Rule: separation of duties - approver must be different from creator
    if (status === 'APPROVED' && run.created_by === actorId) {
      throw new Error('SEPARATION_OF_DUTIES_VIOLATION: Payroll creator cannot approve own payroll run');
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
      // Also update all payslips
      this.payslips.filter(p => p.run_id === runId).forEach(p => { p.status = 'PUBLISHED'; });
    } else if (status === 'PAID') {
      run.paid_by = actorId;
      run.paid_at = run.updated_at;
      this.payslips.filter(p => p.run_id === runId).forEach(p => { p.status = 'PAID'; });
    }

    if (updates) Object.assign(run, updates);
    return { ...run };
  }

  async getPayslipsForEmployee(employeeId: string): Promise<PayslipItem[]> {
    this.checkErrors();
    // Only return PUBLISHED or PAID payslips to employee
    return this.payslips.filter(p => p.employee_id === employeeId && (p.status === 'PUBLISHED' || p.status === 'PAID'));
  }

  async getPayslipsByRunId(runId: string): Promise<PayslipItem[]> {
    this.checkErrors();
    return this.payslips.filter(p => p.run_id === runId);
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

  async markNotificationAcknowledged(inboxId: string, recipientId: string): Promise<NotificationInboxItem> {
    this.checkErrors();
    const item = this.notificationInbox.find(n => n.inbox_id === inboxId && (n.recipient_id === recipientId || n.recipient_id === 'ALL'));
    if (!item) throw new Error('NOTIFICATION_NOT_FOUND');
    item.acknowledged_at = new Date().toISOString();
    if (!item.read_at) item.read_at = item.acknowledged_at;
    item.version += 1;
    return { ...item };
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
    const newEntry: AuditLogEntry = {
      ...entry,
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

  async updateBranch(id: string, updates: Partial<BranchInfo>): Promise<BranchInfo> {
    this.checkErrors();
    const idx = this.branches.findIndex(b => b.id === id);
    if (idx === -1) throw new Error('BRANCH_NOT_FOUND');
    this.branches[idx] = { ...this.branches[idx], ...updates };
    return { ...this.branches[idx] };
  }

  async getShiftTemplates(): Promise<any> {
    this.checkErrors();
    return { ...this.shiftTemplates };
  }

  async updateShiftTemplates(templates: any): Promise<any> {
    this.checkErrors();
    this.shiftTemplates = { ...templates };
    return { ...this.shiftTemplates };
  }

  async getPolicies(): Promise<any> {
    this.checkErrors();
    return { ...this.policies };
  }

  async updatePolicies(policies: any): Promise<any> {
    this.checkErrors();
    this.policies = { ...this.policies, ...policies, updated_at: new Date().toISOString() };
    return { ...this.policies };
  }

  async getMaintenance(): Promise<any> {
    this.checkErrors();
    return { ...this.maintenance };
  }

  async updateMaintenance(maintenance: any): Promise<any> {
    this.checkErrors();
    this.maintenance = { ...this.maintenance, ...maintenance, updated_at: new Date().toISOString() };
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
    this.systemSettings = { ...this.systemSettings, ...settings, updated_at: new Date().toISOString() };
    return { ...this.systemSettings };
  }
}

