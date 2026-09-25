import { ISheetsRepository } from './sheets.interface.js';
import { MockSheetsAdapter } from './mock-sheets.adapter.js';
import { GoogleSheetsSyncService } from '../services/google-sheets-sync.service.js';

export class GoogleSheetsAdapter implements ISheetsRepository {
  private fallbackAdapter: MockSheetsAdapter;
  private isConfigured = false;
  private lastPullTime = 0;
  private pullInFlight: Promise<unknown> | null = null;
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
    const hasJson = !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const hasEmailKey = !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
    if ((hasJson || hasEmailKey) && spreadsheetId) {
      this.isConfigured = true;
      // Auto-initialize sheets structure and pull real data on startup
      setTimeout(async () => {
        try {
          await this.syncService.initSpreadsheetStructure();
          const pullResult = await this.syncService.pullAllDataFromGoogleSheets(this);
          console.log('[GoogleSheetsAdapter] Startup pull completed:', pullResult.message, pullResult.counts);
          // If no branches in sheets, push initial data (branches, admin) to Sheets
          const branches = await this.fallbackAdapter.getBranches();
          if (branches.length === 0) {
            console.log('[GoogleSheetsAdapter] Sheets empty — pushing initial branch config...');
            await this.syncService.syncAllData(this);
          }
        } catch (err) {
          console.error('[GoogleSheetsAdapter] Error on startup sync:', err);
        }
      }, 3000);
    }
  }

  private async ensureFreshData() {
    if (this.isConfigured) {
      const now = Date.now();
      if (now - this.lastPullTime > 5000) { // 5 giây cache — realtime hơn cho production
        this.lastPullTime = now;
        // Chống pull chồng chéo: nhiều request cùng lúc dùng chung 1 pull.
        if (!this.pullInFlight) {
          this.pullInFlight = this.syncService
            .pullAllDataFromGoogleSheets(this)
            .catch(e => console.warn('[GoogleSheetsAdapter] Auto-pull error:', e))
            .finally(() => {
              this.pullInFlight = null;
            });
        }
        try {
          await this.pullInFlight;
        } catch (e) {
          // đã log ở trên
        }
      }
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

  // --- Accounts ---
  async findAccountByPhone(phone: string) {
    await this.ensureFreshData();
    return this.fallbackAdapter.findAccountByPhone(phone);
  }

  async getAccountById(id: string) {
    await this.ensureFreshData();
    return this.fallbackAdapter.getAccountById(id);
  }

  async listAccounts() {
    await this.ensureFreshData();
    return this.fallbackAdapter.listAccounts();
  }

  async createAccount(account: any) {
    const res = await this.fallbackAdapter.createAccount(account);
    if (this.isConfigured) {
      const ok = await this.syncService.appendRow('TAI_KHOAN_NHAN_VIEN', [
        res.account_id,
        res.employee_id,
        res.phone_normalized,
        res.role,
        res.account_status,
        res.version,
        (res as any).pin_hash || '',
        (res as any).pin_must_change ? 'YES' : '',
      ]);
      if (!ok) {
        console.warn('[GoogleSheetsAdapter] appendRow TAI_KHOAN_NHAN_VIEN failed, running syncAllData');
        await this.syncService.syncAllData(this.fallbackAdapter).catch(err => console.error(err));
      }
    }
    return res;
  }

  async setAccountPin(id: string, pinHash: string, mustChange: boolean, actorId: string) {
    const updated = await this.fallbackAdapter.setAccountPin(id, pinHash, mustChange, actorId);
    if (this.isConfigured) {
      await this.syncService.syncAllData(this.fallbackAdapter).catch(err => console.error(err));
    }
    return updated;
  }

  async getAdminByUsername(username: string) {
    // Khi được cấu hình với Google Sheets: đảm bảo dữ liệu admin mới nhất
    if (this.isConfigured) {
      await this.ensureFreshData();
    }
    return this.fallbackAdapter.getAdminByUsername(username);
  }

  // --- Employees ---
  async getEmployeeById(id: string) {
    await this.ensureFreshData();
    return this.fallbackAdapter.getEmployeeById(id);
  }

  async listEmployees(filter?: any) {
    await this.ensureFreshData();
    return this.fallbackAdapter.listEmployees(filter);
  }

  async createEmployee(data: any) {
    const res = await this.fallbackAdapter.createEmployee(data);
    if (this.isConfigured) {
      const ok = await this.syncService.appendRow('NHAN_VIEN_MASTER', [
        res.employee_id,
        res.employee_code,
        res.full_name,
        res.phone_normalized,
        res.employment_status,
        res.group,
        res.default_branch_id,
        res.current_rate_per_hour,
        res.start_date || res.created_at,
        res.version,
      ]);
      if (!ok) {
        console.warn('[GoogleSheetsAdapter] appendRow NHAN_VIEN_MASTER failed, running syncAllData');
        await this.syncService.syncAllData(this.fallbackAdapter).catch(err => console.error(err));
      }
    }
    return res;
  }

  async deleteEmployee(id: string) {
    const ok = await this.fallbackAdapter.deleteEmployee(id);
    if (ok && this.isConfigured) {
      await this.syncService.syncAllData(this.fallbackAdapter).catch(err => console.error(err));
    }
    return ok;
  }

  async updateEmployee(id: string, updates: any, expectedVersion: number) {
    const res = await this.fallbackAdapter.updateEmployee(id, updates, expectedVersion);
    if (this.isConfigured) {
      this.syncService.syncAllData(this.fallbackAdapter).catch(err => console.error(err));
    }
    return res;
  }

  async getStageHistory(employeeId: string) {
    return this.fallbackAdapter.getStageHistory(employeeId);
  }

  async addStageHistory(entry: any) {
    return this.fallbackAdapter.addStageHistory(entry);
  }

  // --- Recruitment ---
  async listCandidates() {
    await this.ensureFreshData();
    return this.fallbackAdapter.listCandidates();
  }

  async createCandidate(data: any) {
    return this.fallbackAdapter.createCandidate(data);
  }

  async updateCandidate(submissionId: string, updates: any) {
    return this.fallbackAdapter.updateCandidate(submissionId, updates);
  }

  // --- Schedules ---
  async getShiftsForWeek(branchId: string, weekStartDate: string) {
    await this.ensureFreshData();
    return this.fallbackAdapter.getShiftsForWeek(branchId, weekStartDate);
  }

  async getShiftsForEmployee(employeeId: string, fromDate: string, toDate: string) {
    await this.ensureFreshData();
    return this.fallbackAdapter.getShiftsForEmployee(employeeId, fromDate, toDate);
  }

  async getShiftById(assignmentId: string) {
    return this.fallbackAdapter.getShiftById(assignmentId);
  }

  async createShiftAssignment(assignment: any) {
    const res = await this.fallbackAdapter.createShiftAssignment(assignment);
    if (this.isConfigured) {
      this.syncService.appendRow('PHAN_CONG_CA', [
        res.assignment_id,
        res.employee_id,
        res.branch_id,
        res.shift_code,
        res.date,
        res.start_at,
        res.end_at,
        res.status,
        res.schedule_version,
      ]).catch(err => console.error(err));
    }
    return res;
  }

  async updateShiftAssignment(id: string, updates: any) {
    return this.fallbackAdapter.updateShiftAssignment(id, updates);
  }

  // --- Leaves & Swaps ---
  async createLeaveRequest(request: any) {
    const res = await this.fallbackAdapter.createLeaveRequest(request);
    if (this.isConfigured) {
      this.syncService.appendRow('DON_NGHI_PHEP', [
        res.request_id,
        res.employee_id,
        res.branch_id,
        res.leave_type,
        res.requested_date,
        res.shift_code || '',
        res.reason,
        res.status,
        res.reviewed_by || '',
        res.review_note || '',
        res.created_at,
      ]).catch(err => console.error(err));
    }
    return res;
  }

  async listLeaveRequests(branchId?: string, employeeId?: string) {
    await this.ensureFreshData();
    return this.fallbackAdapter.listLeaveRequests(branchId, employeeId);
  }

  async updateLeaveRequest(id: string, status: any, reviewerId: string, note?: string) {
    const res = await this.fallbackAdapter.updateLeaveRequest(id, status, reviewerId, note);
    if (this.isConfigured) {
      this.syncService.syncAllData(this.fallbackAdapter).catch(err => console.error(err));
    }
    return res;
  }

  async createSwapRequest(request: any) {
    const res = await this.fallbackAdapter.createSwapRequest(request);
    if (this.isConfigured) {
      this.syncService.appendRow('DON_DOI_CA', [
        res.swap_id,
        res.requester_id,
        res.requester_assignment_id,
        res.target_employee_id,
        res.target_assignment_id,
        res.reason,
        res.status,
        res.approved_by || '',
        res.created_at,
      ]).catch(err => console.error(err));
    }
    return res;
  }

  async listSwapRequests(employeeId?: string) {
    await this.ensureFreshData();
    return this.fallbackAdapter.listSwapRequests(employeeId);
  }

  async getSwapById(swapId: string) {
    return this.fallbackAdapter.getSwapById(swapId);
  }

  async updateSwapRequest(id: string, updates: any) {
    const res = await this.fallbackAdapter.updateSwapRequest(id, updates);
    if (this.isConfigured) {
      this.syncService.syncAllData(this.fallbackAdapter).catch(err => console.error(err));
    }
    return res;
  }

  // --- Attendance ---
  async recordAttendanceEvent(event: any) {
    // If base64 photo is provided, upload to Google Drive
    if (event.photo_base64 && this.isConfigured) {
      try {
        const fileName = `${event.employee_id}_${event.type}_${Date.now()}.jpg`;
        const driveResult = await this.syncService.uploadImageToDrive(fileName, 'image/jpeg', event.photo_base64);
        event.drive_object_id = driveResult.fileId;
      } catch (err) {
        console.error('[GoogleSheetsAdapter] Drive upload error:', err);
      }
    }

    const res = await this.fallbackAdapter.recordAttendanceEvent(event);

    if (this.isConfigured) {
      this.syncService.appendRow('SU_KIEN_DIEM_DANH', [
        res.event_id,
        res.assignment_id,
        res.employee_id,
        res.type,
        res.server_received_at,
        res.gps_latitude,
        res.gps_longitude,
        res.distance_meters,
        res.gps_status,
        res.drive_object_id || '',
        res.request_id || '',
      ]).catch(err => console.error(err));
    }

    return res;
  }

  async getAttendanceEvents(employeeId?: string, date?: string) {
    await this.ensureFreshData();
    return this.fallbackAdapter.getAttendanceEvents(employeeId, date);
  }

  async findAttendanceEventByRequestId(requestId: string) {
    return this.fallbackAdapter.findAttendanceEventByRequestId(requestId);
  }

  async createAttendanceAdjustment(adj: any) {
    return this.fallbackAdapter.createAttendanceAdjustment(adj);
  }

  async listAttendanceAdjustments(branchId?: string, employeeId?: string) {
    return this.fallbackAdapter.listAttendanceAdjustments(branchId, employeeId);
  }

  async updateAttendanceAdjustment(id: string, status: any, approverId: string, minutesApproved?: number, note?: string) {
    return this.fallbackAdapter.updateAttendanceAdjustment(id, status, approverId, minutesApproved, note);
  }

  // --- Payroll ---
  async createPayrollRun(run: any, items: any) {
    const res = await this.fallbackAdapter.createPayrollRun(run, items);
    if (this.isConfigured) {
      this.syncService.syncAllData(this.fallbackAdapter).catch(err => console.error(err));
    }
    return res;
  }

  async getPayrollRun(runId: string) {
    return this.fallbackAdapter.getPayrollRun(runId);
  }

  async listPayrollRuns() {
    await this.ensureFreshData();
    return this.fallbackAdapter.listPayrollRuns();
  }

  async updatePayrollRunStatus(runId: string, status: any, actorId: string, updates?: any) {
    const res = await this.fallbackAdapter.updatePayrollRunStatus(runId, status, actorId, updates);
    if (this.isConfigured) {
      this.syncService.syncAllData(this.fallbackAdapter).catch(err => console.error(err));
    }
    return res;
  }

  async getPayslipsForEmployee(employeeId: string) {
    return this.fallbackAdapter.getPayslipsForEmployee(employeeId);
  }

  async getPayslipsByRunId(runId: string) {
    return this.fallbackAdapter.getPayslipsByRunId(runId);
  }

  // --- Notifications ---
  async createNotification(outbox: any, inboxes: any) {
    return this.fallbackAdapter.createNotification(outbox, inboxes);
  }

  async getInboxForRecipient(recipientId: string, unreadOnly?: boolean) {
    return this.fallbackAdapter.getInboxForRecipient(recipientId, unreadOnly);
  }

  async markNotificationRead(inboxId: string, recipientId: string) {
    return this.fallbackAdapter.markNotificationRead(inboxId, recipientId);
  }

  async markNotificationAcknowledged(inboxId: string, recipientId: string) {
    return this.fallbackAdapter.markNotificationAcknowledged(inboxId, recipientId);
  }

  // --- Operations & Audit ---
  async recordOperation(op: any) {
    return this.fallbackAdapter.recordOperation(op);
  }

  async getOperationById(operationId: string) {
    return this.fallbackAdapter.getOperationById(operationId);
  }

  async findOperationByIdempotencyKey(key: string) {
    return this.fallbackAdapter.findOperationByIdempotencyKey(key);
  }

  async updateOperation(operationId: string, updates: any) {
    return this.fallbackAdapter.updateOperation(operationId, updates);
  }

  async recordAuditLog(entry: any) {
    const res = await this.fallbackAdapter.recordAuditLog(entry);
    if (this.isConfigured) {
      this.syncService.appendRow('AUDIT_LOG', [
        res.log_id,
        res.timestamp,
        res.actor_id,
        res.actor_role,
        res.action,
        res.target_entity,
        res.target_id,
        typeof res.details === 'string' ? res.details : JSON.stringify(res.details || {}),
      ]).catch(err => console.error(err));
    }
    return res;
  }

  async getAuditLogs(limit?: number) {
    return this.fallbackAdapter.getAuditLogs(limit);
  }

  // --- Admin Governance ---
  async listAdminAccounts() {
    await this.ensureFreshData();
    return this.fallbackAdapter.listAdminAccounts();
  }

  async createAdminAccount(account: any) {
    const res = await this.fallbackAdapter.createAdminAccount(account);
    if (this.isConfigured) {
      const ok = await this.syncService.appendRow('ADMIN_ACCOUNTS', [
        res.admin_id,
        res.username,
        res.password_hash || '123456',
        res.full_name,
        res.role,
        res.branch_scope || '*',
        res.created_at,
      ]);
      if (!ok) {
        console.warn('[GoogleSheetsAdapter] appendRow ADMIN_ACCOUNTS failed, running syncAllData');
        await this.syncService.syncAllData(this.fallbackAdapter).catch(err => console.error(err));
      }
    }
    return res;
  }

  async updateAdminAccount(id: string, updates: any) {
    const res = await this.fallbackAdapter.updateAdminAccount(id, updates);
    if (this.isConfigured) {
      await this.syncService.syncAllData(this.fallbackAdapter).catch(err => console.error(err));
    }
    return res;
  }

  async deleteAdminAccount(id: string) {
    const ok = await this.fallbackAdapter.deleteAdminAccount(id);
    if (ok && this.isConfigured) {
      await this.syncService.syncAllData(this.fallbackAdapter).catch(err => console.error(err));
    }
    return ok;
  }

  async getBranches() {
    await this.ensureFreshData();
    return this.fallbackAdapter.getBranches();
  }

  async updateBranch(id: string, updates: any) {
    const res = await this.fallbackAdapter.updateBranch(id, updates);
    if (this.isConfigured) {
      this.syncService.syncAllData(this.fallbackAdapter).catch(err => console.error(err));
    }
    return res;
  }

  async getShiftTemplates() {
    await this.ensureFreshData();
    return this.fallbackAdapter.getShiftTemplates();
  }

  async updateShiftTemplates(templates: any) {
    return this.fallbackAdapter.updateShiftTemplates(templates);
  }

  async getPolicies() {
    await this.ensureFreshData();
    return this.fallbackAdapter.getPolicies();
  }

  async updatePolicies(policies: any) {
    return this.fallbackAdapter.updatePolicies(policies);
  }

  async getMaintenance() {
    await this.ensureFreshData();
    return this.fallbackAdapter.getMaintenance();
  }

  async updateMaintenance(maintenance: any) {
    return this.fallbackAdapter.updateMaintenance(maintenance);
  }

  async getBackupSnapshots() {
    return this.fallbackAdapter.getBackupSnapshots();
  }

  async createBackupSnapshot(name?: string) {
    return this.fallbackAdapter.createBackupSnapshot(name);
  }

  async testRecovery(snapshotId: string) {
    return this.fallbackAdapter.testRecovery(snapshotId);
  }

  async getSystemSettings() {
    await this.ensureFreshData();
    return this.fallbackAdapter.getSystemSettings();
  }

  async updateSystemSettings(settings: any) {
    const updated = await this.fallbackAdapter.updateSystemSettings(settings);
    if (this.isConfigured) {
      await this.syncService.syncSystemSettingsToSheet(updated).catch(err => console.error(err));
    }
    return updated;
  }
}
