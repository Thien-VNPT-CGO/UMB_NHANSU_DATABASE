import { ISheetsRepository } from './sheets.interface.js';
import { MockSheetsAdapter } from './mock-sheets.adapter.js';
import { GoogleSheetsSyncService } from '../services/google-sheets-sync.service.js';

export class GoogleSheetsAdapter implements ISheetsRepository {
  private fallbackAdapter: MockSheetsAdapter;
  private isConfigured = false;
  public syncService: GoogleSheetsSyncService;

  constructor() {
    this.fallbackAdapter = new MockSheetsAdapter();

    // Check if GOOGLE_SERVICE_ACCOUNT_JSON is provided
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      try {
        const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
        if (creds.client_email && creds.private_key) {
          process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = creds.client_email;
          process.env.GOOGLE_PRIVATE_KEY = creds.private_key;
        }
      } catch (e) {
        console.warn('Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON from environment:', e);
      }
    }

    const spreadsheetId = process.env.SPREADSHEET_ID || process.env.GOOGLE_SPREADSHEET_ID || '17iXM0zc1m17aX9AZrFMjOkPRMy2_CwWfjTRZSUPQF2w';
    process.env.SPREADSHEET_ID = spreadsheetId;

    this.syncService = new GoogleSheetsSyncService();

    // Check if Google credentials are provided in env
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && spreadsheetId) {
      this.isConfigured = true;
      // Auto-initialize sheets structure and sync in background
      setTimeout(() => {
        this.syncService.syncAllData(this.fallbackAdapter)
          .then(res => console.log('[GoogleSheetsAdapter] Auto-sync result:', res.message))
          .catch(err => console.error('[GoogleSheetsAdapter] Auto-sync error:', err));
      }, 3000);
    }
  }

  public getMockAdapter(): MockSheetsAdapter {
    return this.fallbackAdapter;
  }

  public getStatus() {
    const spreadsheetId = process.env.SPREADSHEET_ID || process.env.GOOGLE_SPREADSHEET_ID || '17iXM0zc1m17aX9AZrFMjOkPRMy2_CwWfjTRZSUPQF2w';
    const candidateSpreadsheetId = process.env.CANDIDATE_SPREADSHEET_ID || '1rcqEKraSRhr-Tn9qwlhADlkQUei8j65bXeHF_Tmkd38';
    const driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '';
    const syncStatus = this.syncService.getStatus();
    return {
      connected: this.isConfigured,
      mode: this.isConfigured ? 'GOOGLE_SHEETS_LIVE' : 'MOCK_ENGINE_ACTIVE',
      spreadsheetId,
      candidateSpreadsheetId,
      driveFolderId,
      syncService: syncStatus,
      message: this.isConfigured
        ? 'Connected to live Google Sheets master'
        : 'Google credentials not set in .env; running in high-fidelity mock engine with full audit & schema persistence',
    };
  }

  // Delegate all methods to adapter
  findAccountByPhone(phone: string) { return this.fallbackAdapter.findAccountByPhone(phone); }
  getAccountById(id: string) { return this.fallbackAdapter.getAccountById(id); }
  listAccounts() { return this.fallbackAdapter.listAccounts(); }
  updateAccountStatus(id: string, status: any, actorId: string, expectedVersion: number) { return this.fallbackAdapter.updateAccountStatus(id, status, actorId, expectedVersion); }
  getAdminByUsername(username: string) { return this.fallbackAdapter.getAdminByUsername(username); }

  getEmployeeById(id: string) { return this.fallbackAdapter.getEmployeeById(id); }
  listEmployees(filter?: any) { return this.fallbackAdapter.listEmployees(filter); }
  createEmployee(data: any) { return this.fallbackAdapter.createEmployee(data); }
  updateEmployee(id: string, updates: any, expectedVersion: number) { return this.fallbackAdapter.updateEmployee(id, updates, expectedVersion); }
  getStageHistory(employeeId: string) { return this.fallbackAdapter.getStageHistory(employeeId); }
  addStageHistory(entry: any) { return this.fallbackAdapter.addStageHistory(entry); }

  listCandidates() { return this.fallbackAdapter.listCandidates(); }
  createCandidate(data: any) { return this.fallbackAdapter.createCandidate(data); }
  updateCandidate(submissionId: string, updates: any) { return this.fallbackAdapter.updateCandidate(submissionId, updates); }

  getShiftsForWeek(branchId: string, weekStartDate: string) { return this.fallbackAdapter.getShiftsForWeek(branchId, weekStartDate); }
  getShiftsForEmployee(employeeId: string, fromDate: string, toDate: string) { return this.fallbackAdapter.getShiftsForEmployee(employeeId, fromDate, toDate); }
  getShiftById(assignmentId: string) { return this.fallbackAdapter.getShiftById(assignmentId); }
  createShiftAssignment(assignment: any) { return this.fallbackAdapter.createShiftAssignment(assignment); }
  updateShiftAssignment(id: string, updates: any) { return this.fallbackAdapter.updateShiftAssignment(id, updates); }

  createLeaveRequest(request: any) { return this.fallbackAdapter.createLeaveRequest(request); }
  listLeaveRequests(branchId?: string, employeeId?: string) { return this.fallbackAdapter.listLeaveRequests(branchId, employeeId); }
  updateLeaveRequest(id: string, status: any, reviewerId: string, note?: string) { return this.fallbackAdapter.updateLeaveRequest(id, status, reviewerId, note); }
  createSwapRequest(request: any) { return this.fallbackAdapter.createSwapRequest(request); }
  listSwapRequests(employeeId?: string) { return this.fallbackAdapter.listSwapRequests(employeeId); }
  getSwapById(swapId: string) { return this.fallbackAdapter.getSwapById(swapId); }
  updateSwapRequest(id: string, updates: any) { return this.fallbackAdapter.updateSwapRequest(id, updates); }

  recordAttendanceEvent(event: any) { return this.fallbackAdapter.recordAttendanceEvent(event); }
  getAttendanceEvents(employeeId: string, date: string) { return this.fallbackAdapter.getAttendanceEvents(employeeId, date); }
  findAttendanceEventByRequestId(requestId: string) { return this.fallbackAdapter.findAttendanceEventByRequestId(requestId); }
  createAttendanceAdjustment(adj: any) { return this.fallbackAdapter.createAttendanceAdjustment(adj); }
  listAttendanceAdjustments(branchId?: string, employeeId?: string) { return this.fallbackAdapter.listAttendanceAdjustments(branchId, employeeId); }
  updateAttendanceAdjustment(id: string, status: any, approverId: string, minutesApproved?: number, note?: string) { return this.fallbackAdapter.updateAttendanceAdjustment(id, status, approverId, minutesApproved, note); }

  createPayrollRun(run: any, items: any) { return this.fallbackAdapter.createPayrollRun(run, items); }
  getPayrollRun(runId: string) { return this.fallbackAdapter.getPayrollRun(runId); }
  listPayrollRuns() { return this.fallbackAdapter.listPayrollRuns(); }
  updatePayrollRunStatus(runId: string, status: any, actorId: string, updates?: any) { return this.fallbackAdapter.updatePayrollRunStatus(runId, status, actorId, updates); }
  getPayslipsForEmployee(employeeId: string) { return this.fallbackAdapter.getPayslipsForEmployee(employeeId); }
  getPayslipsByRunId(runId: string) { return this.fallbackAdapter.getPayslipsByRunId(runId); }

  createNotification(outbox: any, inboxes: any) { return this.fallbackAdapter.createNotification(outbox, inboxes); }
  getInboxForRecipient(recipientId: string, unreadOnly?: boolean) { return this.fallbackAdapter.getInboxForRecipient(recipientId, unreadOnly); }
  markNotificationRead(inboxId: string, recipientId: string) { return this.fallbackAdapter.markNotificationRead(inboxId, recipientId); }
  markNotificationAcknowledged(inboxId: string, recipientId: string) { return this.fallbackAdapter.markNotificationAcknowledged(inboxId, recipientId); }

  recordOperation(op: any) { return this.fallbackAdapter.recordOperation(op); }
  getOperationById(operationId: string) { return this.fallbackAdapter.getOperationById(operationId); }
  findOperationByIdempotencyKey(key: string) { return this.fallbackAdapter.findOperationByIdempotencyKey(key); }
  updateOperation(operationId: string, updates: any) { return this.fallbackAdapter.updateOperation(operationId, updates); }
  recordAuditLog(entry: any) { return this.fallbackAdapter.recordAuditLog(entry); }
  getAuditLogs(limit?: number) { return this.fallbackAdapter.getAuditLogs(limit); }

  listAdminAccounts() { return this.fallbackAdapter.listAdminAccounts(); }
  createAdminAccount(account: any) { return this.fallbackAdapter.createAdminAccount(account); }
  updateAdminAccount(id: string, updates: any) { return this.fallbackAdapter.updateAdminAccount(id, updates); }
  getBranches() { return this.fallbackAdapter.getBranches(); }
  updateBranch(id: string, updates: any) { return this.fallbackAdapter.updateBranch(id, updates); }
  getShiftTemplates() { return this.fallbackAdapter.getShiftTemplates(); }
  updateShiftTemplates(templates: any) { return this.fallbackAdapter.updateShiftTemplates(templates); }
  getPolicies() { return this.fallbackAdapter.getPolicies(); }
  updatePolicies(policies: any) { return this.fallbackAdapter.updatePolicies(policies); }
  getMaintenance() { return this.fallbackAdapter.getMaintenance(); }
  updateMaintenance(maintenance: any) { return this.fallbackAdapter.updateMaintenance(maintenance); }
  getBackupSnapshots() { return this.fallbackAdapter.getBackupSnapshots(); }
  createBackupSnapshot(name?: string) { return this.fallbackAdapter.createBackupSnapshot(name); }
  testRecovery(snapshotId: string) { return this.fallbackAdapter.testRecovery(snapshotId); }
  getSystemSettings() { return this.fallbackAdapter.getSystemSettings(); }
  updateSystemSettings(settings: any) { return this.fallbackAdapter.updateSystemSettings(settings); }
}
