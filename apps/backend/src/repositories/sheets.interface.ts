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
  BranchInfo,
} from '@ubm/shared';


export interface ISheetsRepository {
  // Accounts
  findAccountByPhone(phone: string): Promise<EmployeeAccount[]>;
  getAccountById(id: string): Promise<EmployeeAccount | null>;
  listAccounts(): Promise<EmployeeAccount[]>;
  updateAccountStatus(id: string, status: AccountStatus, actorId: string, expectedVersion: number): Promise<EmployeeAccount>;
  getAdminByUsername(username: string): Promise<AdminAccount | null>;

  // Employees
  getEmployeeById(id: string): Promise<EmployeeMaster | null>;
  listEmployees(filter?: { branch?: string; status?: string }): Promise<EmployeeMaster[]>;
  createEmployee(data: Omit<EmployeeMaster, 'created_at' | 'updated_at' | 'version'>): Promise<EmployeeMaster>;
  updateEmployee(id: string, updates: Partial<EmployeeMaster>, expectedVersion: number): Promise<EmployeeMaster>;
  getStageHistory(employeeId: string): Promise<EmployeeStageHistory[]>;
  addStageHistory(entry: Omit<EmployeeStageHistory, 'version' | 'created_at'>): Promise<EmployeeStageHistory>;

  // Recruitment
  listCandidates(): Promise<CandidateApplication[]>;
  createCandidate(data: Omit<CandidateApplication, 'created_at'>): Promise<CandidateApplication>;
  updateCandidate(submissionId: string, updates: Partial<CandidateApplication>): Promise<CandidateApplication>;

  // Schedules
  getShiftsForWeek(branchId: string, weekStartDate: string): Promise<ShiftAssignment[]>;
  getShiftsForEmployee(employeeId: string, fromDate: string, toDate: string): Promise<ShiftAssignment[]>;
  getShiftById(assignmentId: string): Promise<ShiftAssignment | null>;
  createShiftAssignment(assignment: Omit<ShiftAssignment, 'created_at' | 'updated_at'>): Promise<ShiftAssignment>;
  updateShiftAssignment(id: string, updates: Partial<ShiftAssignment>): Promise<ShiftAssignment>;

  // Leaves & Swaps
  createLeaveRequest(request: Omit<LeaveRequest, 'created_at' | 'version'>): Promise<LeaveRequest>;
  listLeaveRequests(branchId?: string, employeeId?: string): Promise<LeaveRequest[]>;
  updateLeaveRequest(id: string, status: RequestApprovalStatus, reviewerId: string, note?: string): Promise<LeaveRequest>;
  createSwapRequest(request: Omit<SwapRequest, 'created_at' | 'version'>): Promise<SwapRequest>;
  listSwapRequests(employeeId?: string): Promise<SwapRequest[]>;
  getSwapById(swapId: string): Promise<SwapRequest | null>;
  updateSwapRequest(id: string, updates: Partial<SwapRequest>): Promise<SwapRequest>;

  // Attendance
  recordAttendanceEvent(event: Omit<AttendanceEvent, 'created_at'>): Promise<AttendanceEvent>;
  getAttendanceEvents(employeeId: string, date: string): Promise<AttendanceEvent[]>;
  findAttendanceEventByRequestId(requestId: string): Promise<AttendanceEvent | null>;
  createAttendanceAdjustment(adj: Omit<AttendanceAdjustment, 'created_at' | 'updated_at' | 'version'>): Promise<AttendanceAdjustment>;
  listAttendanceAdjustments(branchId?: string, employeeId?: string): Promise<AttendanceAdjustment[]>;
  updateAttendanceAdjustment(id: string, status: AdjustmentStatus, approverId: string, minutesApproved?: number, note?: string): Promise<AttendanceAdjustment>;

  // Payroll
  createPayrollRun(run: Omit<PayrollRun, 'created_at' | 'updated_at' | 'version'>, items: Omit<PayslipItem, 'created_at' | 'updated_at'>[]): Promise<{ run: PayrollRun; items: PayslipItem[] }>;
  getPayrollRun(runId: string): Promise<PayrollRun | null>;
  listPayrollRuns(): Promise<PayrollRun[]>;
  updatePayrollRunStatus(runId: string, status: PayrollRunStatus, actorId: string, updates?: Partial<PayrollRun>): Promise<PayrollRun>;
  getPayslipsForEmployee(employeeId: string): Promise<PayslipItem[]>;
  getPayslipsByRunId(runId: string): Promise<PayslipItem[]>;

  // Notifications
  createNotification(outbox: Omit<NotificationOutboxItem, 'created_at'>, inboxes: Omit<NotificationInboxItem, 'created_at' | 'version'>[]): Promise<{ outbox: NotificationOutboxItem; inboxes: NotificationInboxItem[] }>;
  getInboxForRecipient(recipientId: string, unreadOnly?: boolean): Promise<NotificationInboxItem[]>;
  markNotificationRead(inboxId: string, recipientId: string): Promise<NotificationInboxItem>;
  markNotificationAcknowledged(inboxId: string, recipientId: string): Promise<NotificationInboxItem>;

  // Operations & Audit
  recordOperation(op: Omit<OperationRecord, 'created_at' | 'updated_at'>): Promise<OperationRecord>;
  getOperationById(operationId: string): Promise<OperationRecord | null>;
  findOperationByIdempotencyKey(key: string): Promise<OperationRecord | null>;
  updateOperation(operationId: string, updates: Partial<OperationRecord>): Promise<OperationRecord>;
  recordAuditLog(entry: Omit<AuditLogEntry, 'timestamp'>): Promise<AuditLogEntry>;
  getAuditLogs(limit?: number): Promise<AuditLogEntry[]>;

  // Admin Governance & System Operations
  listAdminAccounts(): Promise<AdminAccount[]>;
  createAdminAccount(account: Omit<AdminAccount, 'created_at' | 'updated_at' | 'version'>): Promise<AdminAccount>;
  updateAdminAccount(id: string, updates: Partial<AdminAccount>): Promise<AdminAccount>;

  getBranches(): Promise<BranchInfo[]>;
  updateBranch(id: string, updates: Partial<BranchInfo>): Promise<BranchInfo>;
  getShiftTemplates(): Promise<any>;
  updateShiftTemplates(templates: any): Promise<any>;

  getPolicies(): Promise<any>;
  updatePolicies(policies: any): Promise<any>;

  getMaintenance(): Promise<any>;
  updateMaintenance(maintenance: any): Promise<any>;

  getBackupSnapshots(): Promise<any[]>;
  createBackupSnapshot(name?: string): Promise<any>;
  testRecovery(snapshotId: string): Promise<{ success: boolean; message: string; verified_tabs: number }>;

  getSystemSettings(): Promise<any>;
  updateSystemSettings(settings: any): Promise<any>;
}

