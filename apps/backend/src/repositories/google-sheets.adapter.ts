import { ISheetsRepository } from './sheets.interface.js';
import { MockSheetsAdapter } from './mock-sheets.adapter.js';
import { GoogleSheetsSyncService } from '../services/google-sheets-sync.service.js';

export class GoogleSheetsAdapter implements ISheetsRepository {
  private fallbackAdapter: MockSheetsAdapter;
  private isConfigured = false;
  private lastPullTime = 0;
  private pullInFlight: Promise<unknown> | null = null;
  public syncService: GoogleSheetsSyncService;
  // Sẵn sàng dữ liệu sau khởi động: kho rỗng + Sheets chưa đọc xong thì login phải
  // báo SHEETS_LOADING (đợi), không báo ACCOUNT_NOT_FOUND oan.
  // (needsSeed() không dùng được ở đây vì seed sẵn có admin -> luôn false.)
  private startupPullDone = false;
  private consecPullFails = 0;

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
      console.log(`[GoogleSheetsAdapter] Khởi động với Sheets LIVE (spreadsheet: ${spreadsheetId.slice(0, 8)}..., creds: ${hasJson ? 'JSON' : 'EMAIL+KEY'})`);
      // Auto-initialize sheets structure and pull real data on startup.
      // Pull dữ liệu chạy TRƯỚC để web app có dữ liệu ngay; tạo header chạy nền song song (không chặn).
      // Kiên trì retry khi kho còn rỗng (Render rebuild xong mà SheetsAPI/creds trục trặc
      // mà bỏ cuộc là NV/IP vĩnh viễn "không tồn tại" dù Sheet có dữ liệu).
      setTimeout(async () => {
        try {
          this.syncService.initSpreadsheetStructure().catch(err =>
            console.warn('[GoogleSheetsAdapter] initSpreadsheetStructure (nền):', err?.message || err)
          );
          for (let attempt = 1; attempt <= 8; attempt++) {
            const pullResult = await this.syncService.pullAllDataFromGoogleSheets(this).catch(err => {
              console.warn(`[GoogleSheetsAdapter] Startup pull lần ${attempt} lỗi:`, err?.message || err);
              return null;
            });
            this.markPullSettled(!!pullResult?.counts);
            if (pullResult) {
              console.log('[GoogleSheetsAdapter] Startup pull completed:', pullResult.message, pullResult.counts);
            }
            if (this.hasStaffData()) break; // đã có dữ liệu thật — dừng retry
            if (attempt < 8) {
              console.warn(`[GoogleSheetsAdapter] Kho vẫn rỗng sau pull lần ${attempt} — thử lại sau 8s (Render vừa rebuild?).`);
              await new Promise(r => setTimeout(r, 8000));
            }
          }
          if (!this.hasStaffData()) {
            console.error('[GoogleSheetsAdapter] NGUY HIỂM: 8 lần pull vẫn rỗng! Kiểm tra GOOGLE_SERVICE_ACCOUNT_JSON / SPREADSHEET_ID / quyền share Sheet cho service account. Login NV sẽ báo SHEETS_UNAVAILABLE thay vì sai PIN oan.');
          }
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
    } else {
      console.warn('[GoogleSheetsAdapter] Thiếu Google credentials — chạy MOCK (dữ liệu mẫu, restart là mất). Production phải cấu hình GOOGLE_SERVICE_ACCOUNT_JSON!');
    }
  }

  /** Kho đã có dữ liệu nhân sự thật (không tính seed admin). */
  private hasStaffData(): boolean {
    const f = this.fallbackAdapter;
    return f.employees.length + f.accounts.length > 0;
  }

  private markPullSettled(ok: boolean) {
    this.startupPullDone = true;
    if (ok) {
      this.consecPullFails = 0;
    } else {
      this.consecPullFails++;
    }
  }

  // Webhook từ Apps Script (onEdit trên Sheet): kéo ngay, không đợi nhịp 10s.
  // Chống dồn: tối đa 1 lần kích hoạt/3s; pull chồng chéo dùng chung 1 promise.
  private lastWebhookAt = 0;

  public triggerSheetsPull(reason = 'webhook'): { accepted: boolean; done: Promise<unknown> } {
    const noop = Promise.resolve(null);
    if (!this.isConfigured) return { accepted: false, done: noop };
    const now = Date.now();
    if (now - this.lastWebhookAt < 3000) return { accepted: false, done: this.pullInFlight || noop };
    this.lastWebhookAt = now;
    this.lastPullTime = now; // đồng bộ nhịp auto-pull, tránh pull đúp ngay sau đó
    if (!this.pullInFlight) {
      console.log(`[GoogleSheetsAdapter] Kích hoạt pull ngay (${reason})`);
      this.pullInFlight = this.syncService
        .pullAllDataFromGoogleSheets(this)
        .then((r: any) => {
          this.markPullSettled(!!r?.counts);
          return r;
        })
        .catch(e => {
          this.markPullSettled(false);
          console.warn('[GoogleSheetsAdapter] Webhook pull error:', e);
        })
        .finally(() => {
          this.pullInFlight = null;
        });
    }
    return { accepted: true, done: this.pullInFlight };
  }

  /** Sẵn sàng phục vụ login chưa? Kho rỗng + đang retry pull -> chưa. */
  getReadiness(): { ready: boolean; reason?: 'SHEETS_LOADING' | 'SHEETS_UNREACHABLE' | 'EMPTY_DATASET' } {
    if (!this.isConfigured) return { ready: true };
    if (this.hasStaffData()) return { ready: true };
    if (this.consecPullFails >= 3) return { ready: false, reason: 'SHEETS_UNREACHABLE' };
    if (!this.startupPullDone) return { ready: false, reason: 'SHEETS_LOADING' };
    return { ready: true, reason: 'EMPTY_DATASET' };
  }

  // Hàng đợi ghi Sheets NỀN (không chặn response): các tác vụ ghi xếp hàng
  // tuần tự, lỗi chỉ log — dữ liệu thật đã nằm trong bộ nhớ + socket báo realtime ngay.
  private bgWriteChain: Promise<void> = Promise.resolve();
  private pendingSheetsWrites = 0;
  private lastSheetsWriteAt: string | null = null;

  private scheduleSheetsWrite(task: () => Promise<unknown>, label: string) {
    if (!this.isConfigured) return;
    this.pendingSheetsWrites++;
    this.bgWriteChain = this.bgWriteChain
      .then(() => task())
      .then(() => {
        this.lastSheetsWriteAt = new Date().toISOString();
      })
      .catch(err => console.warn(`[GoogleSheetsAdapter] Ghi Sheets nền '${label}' thất bại (sẽ thử lại ở lần sync sau):`, (err as any)?.message || err))
      .finally(() => {
        this.pendingSheetsWrites = Math.max(0, this.pendingSheetsWrites - 1);
      });
  }

  /** Trạng thái ghi nền cho UI poll: còn bao nhiêu tác vụ chưa lên Sheets. */
  public getPendingSheetsWrites() {
    return { pendingWrites: this.pendingSheetsWrites, lastSheetsWriteAt: this.lastSheetsWriteAt };
  }

  // Dồn full-sync: ghi 1 dòng (append) chạy ngay; ghi nguyên 13 tab (nặng, tốn quota)
  // thì dồn tối đa 1 lần/10s — memory + socket đã tức thì cho UI, Sheet đuổi theo sau.
  private lastFullSyncAt = 0;

  private scheduleFullSync(label: string) {
    if (!this.isConfigured) return;
    this.pendingSheetsWrites++;
    const run = async () => {
      const wait = Math.max(0, 10000 - (Date.now() - this.lastFullSyncAt));
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      await this.syncService.syncAllData(this.fallbackAdapter);
      this.lastFullSyncAt = Date.now();
    };
    this.bgWriteChain = this.bgWriteChain
      .then(run)
      .then(() => {
        this.lastSheetsWriteAt = new Date().toISOString();
      })
      .catch(err => console.warn(`[GoogleSheetsAdapter] Full-sync nền '${label}' thất bại:`, (err as any)?.message || err))
      .finally(() => {
        this.pendingSheetsWrites = Math.max(0, this.pendingSheetsWrites - 1);
      });
  }

  // Trả dữ liệu trong bộ nhớ NGAY LẬP TỨC, pull Sheets chạy nền.
  // Chỉ đứng đợi khi kho còn rỗng hoàn toàn (lần đầu khởi động) — có timeout chống treo.
  private needsSeed(): boolean {
    const f = this.fallbackAdapter;
    return f.adminAccounts.length === 0 && f.employees.length === 0 && f.accounts.length === 0;
  }

  private withTimeout(p: Promise<unknown>, ms: number): Promise<unknown> {
    return Promise.race([
      p,
      new Promise((_, reject) => setTimeout(() => reject(new Error('PULL_TIMEOUT')), ms)),
    ]);
  }

  private async ensureFreshData() {
    if (!this.isConfigured) return;
    const now = Date.now();
    if (now - this.lastPullTime <= 10000) { // 10s mới pull nền 1 lần — dữ liệu tươi trong 5-10s, trả lời tức thì
      if (this.pullInFlight && this.needsSeed()) {
        try { await this.withTimeout(this.pullInFlight, 25000); } catch { /* dùng tạm bộ nhớ */ }
      }
      return;
    }
    this.lastPullTime = now;
    // Chống pull chồng chéo: nhiều request cùng lúc dùng chung 1 pull nền.
    if (!this.pullInFlight) {
      this.pullInFlight = this.syncService
        .pullAllDataFromGoogleSheets(this)
        .then((r: any) => {
          this.markPullSettled(!!r?.counts);
          return r;
        })
        .catch(e => {
          this.markPullSettled(false);
          console.warn('[GoogleSheetsAdapter] Auto-pull error:', e);
        })
        .finally(() => {
          this.pullInFlight = null;
        });
    }
    // Kho đã có dữ liệu -> KHÔNG đợi, trả bộ nhớ ngay; pull nền xong client nhận socket data:updated.
    if (this.needsSeed()) {
      try {
        await this.withTimeout(this.pullInFlight, 25000);
      } catch (e) {
        // Hết timeout vẫn phục vụ bằng bộ nhớ hiện có (kể cả rỗng) thay vì treo request.
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
      const snapshot = { ...res };
      this.scheduleSheetsWrite(async () => {
        const ok = await this.syncService.appendRow('TAI_KHOAN_NHAN_VIEN', [
          snapshot.account_id,
          snapshot.employee_id,
          GoogleSheetsSyncService.sheetText(snapshot.phone_normalized),
          snapshot.role,
          snapshot.account_status,
          snapshot.version,
          (snapshot as any).pin_hash || '',
          (snapshot as any).pin_must_change ? 'YES' : '',
          GoogleSheetsSyncService.sheetText((snapshot as any).pin_code || ''),
        ]);
        if (!ok) {
          console.warn('[GoogleSheetsAdapter] appendRow TAI_KHOAN_NHAN_VIEN failed, running syncAllData');
          await this.syncService.syncAllData(this.fallbackAdapter);
        }
      }, 'TAI_KHOAN_NHAN_VIEN.append');
    }
    return res;
  }

  async setAccountPin(id: string, pinHash: string, mustChange: boolean, actorId: string, pinPlain?: string | null) {
    const updated = await this.fallbackAdapter.setAccountPin(id, pinHash, mustChange, actorId, pinPlain);
    this.scheduleFullSync('PIN.syncAll');
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
      const snapshot = { ...res };
      this.scheduleSheetsWrite(async () => {
        const ok = await this.syncService.appendRow('NHAN_VIEN_MASTER', [
          snapshot.employee_id,
          snapshot.employee_code,
          snapshot.full_name,
          GoogleSheetsSyncService.sheetText(snapshot.phone_normalized),
          snapshot.employment_status,
          snapshot.group,
          snapshot.default_branch_id,
          snapshot.current_rate_per_hour,
          snapshot.start_date || (snapshot as any).created_at,
          snapshot.version,
        ]);
        if (!ok) {
          console.warn('[GoogleSheetsAdapter] appendRow NHAN_VIEN_MASTER failed, running syncAllData');
          await this.syncService.syncAllData(this.fallbackAdapter);
        }
      }, 'NHAN_VIEN_MASTER.append');
    }
    return res;
  }

  async deleteEmployee(id: string) {
    const ok = await this.fallbackAdapter.deleteEmployee(id);
    if (ok) {
      this.scheduleFullSync('NHAN_VIEN_MASTER.delete');
    }
    return ok;
  }

  async updateEmployee(id: string, updates: any, expectedVersion: number) {
    const res = await this.fallbackAdapter.updateEmployee(id, updates, expectedVersion);
    this.scheduleFullSync('NHAN_VIEN_MASTER.update');
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
      const snapshot = { ...res };
      this.scheduleSheetsWrite(() => this.syncService.appendRow('PHAN_CONG_CA', [
        snapshot.assignment_id,
        snapshot.employee_id,
        snapshot.branch_id,
        snapshot.shift_code,
        snapshot.date,
        snapshot.start_at,
        snapshot.end_at,
        snapshot.status,
        snapshot.schedule_version,
      ]), 'PHAN_CONG_CA.append');
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
      const snapshot = { ...res };
      this.scheduleSheetsWrite(() => this.syncService.appendRow('DON_NGHI_PHEP', [
        snapshot.request_id,
        snapshot.employee_id,
        snapshot.branch_id,
        snapshot.leave_type,
        snapshot.requested_date,
        snapshot.shift_code || '',
        snapshot.reason,
        snapshot.status,
        snapshot.reviewed_by || '',
        snapshot.review_note || '',
        snapshot.created_at,
      ]), 'DON_NGHI_PHEP.append');
    }
    return res;
  }

  async listLeaveRequests(branchId?: string, employeeId?: string) {
    await this.ensureFreshData();
    return this.fallbackAdapter.listLeaveRequests(branchId, employeeId);
  }

  async updateLeaveRequest(id: string, status: any, reviewerId: string, note?: string) {
    const res = await this.fallbackAdapter.updateLeaveRequest(id, status, reviewerId, note);
    this.scheduleFullSync('DON_NGHI_PHEP.update');
    return res;
  }

  async createSwapRequest(request: any) {
    const res = await this.fallbackAdapter.createSwapRequest(request);
    if (this.isConfigured) {
      const snapshot = { ...res };
      this.scheduleSheetsWrite(() => this.syncService.appendRow('DON_DOI_CA', [
        snapshot.swap_id,
        snapshot.requester_id,
        snapshot.requester_assignment_id,
        snapshot.target_employee_id,
        snapshot.target_assignment_id,
        snapshot.reason,
        snapshot.status,
        snapshot.approved_by || '',
        snapshot.created_at,
      ]), 'DON_DOI_CA.append');
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
    this.scheduleFullSync('DON_DOI_CA.update');
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
      const snapshot = { ...res };
      this.scheduleSheetsWrite(() => this.syncService.appendRow('SU_KIEN_DIEM_DANH', [
        snapshot.event_id,
        snapshot.assignment_id,
        snapshot.employee_id,
        snapshot.type,
        snapshot.server_received_at,
        snapshot.gps_latitude,
        snapshot.gps_longitude,
        snapshot.distance_meters,
        snapshot.gps_status,
        snapshot.drive_object_id || '',
        snapshot.request_id || '',
      ]), 'SU_KIEN_DIEM_DANH.append');
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
    const res = await this.fallbackAdapter.createAttendanceAdjustment(adj);
    if (this.isConfigured) {
      const snapshot = { ...res };
      this.scheduleSheetsWrite(() => this.syncService.appendRow('DIEU_CHINH_CONG', [
        snapshot.adjustment_id,
        snapshot.assignment_id,
        snapshot.employee_id,
        snapshot.reason || '',
        snapshot.minutes_approved ?? snapshot.minutes_requested ?? 0,
        snapshot.approver_id || '',
        snapshot.status,
        snapshot.review_note || '',
      ]), 'DIEU_CHINH_CONG.append');
    }
    return res;
  }

  async listAttendanceAdjustments(branchId?: string, employeeId?: string) {
    return this.fallbackAdapter.listAttendanceAdjustments(branchId, employeeId);
  }

  async updateAttendanceAdjustment(id: string, status: any, approverId: string, minutesApproved?: number, note?: string) {
    const res = await this.fallbackAdapter.updateAttendanceAdjustment(id, status, approverId, minutesApproved, note);
    this.scheduleFullSync('DIEU_CHINH_CONG.update');
    return res;
  }

  // --- Payroll ---
  async createPayrollRun(run: any, items: any) {
    const res = await this.fallbackAdapter.createPayrollRun(run, items);
    this.scheduleFullSync('KY_LUONG.create');
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
    this.scheduleFullSync('KY_LUONG.update');
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
      const snapshot = { ...res };
      this.scheduleSheetsWrite(() => this.syncService.appendRow('AUDIT_LOG', [
        snapshot.log_id,
        snapshot.timestamp,
        snapshot.actor_id,
        snapshot.actor_role,
        snapshot.action,
        snapshot.target_entity,
        snapshot.target_id,
        typeof snapshot.details === 'string' ? snapshot.details : JSON.stringify(snapshot.details || {}),
      ]), 'AUDIT_LOG.append');
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
      const snapshot = { ...res };
      this.scheduleSheetsWrite(async () => {
        const ok = await this.syncService.appendRow('ADMIN_ACCOUNTS', [
          snapshot.admin_id,
          snapshot.username,
          snapshot.password_hash || '123456',
          snapshot.full_name,
          snapshot.role,
          snapshot.branch_scope || '*',
          (snapshot as any).is_active === false ? 'LOCKED' : 'ACTIVE',
          snapshot.created_at,
        ]);
        if (!ok) {
          console.warn('[GoogleSheetsAdapter] appendRow ADMIN_ACCOUNTS failed, running syncAllData');
          await this.syncService.syncAllData(this.fallbackAdapter);
        }
      }, 'ADMIN_ACCOUNTS.append');
    }
    return res;
  }

  async updateAdminAccount(id: string, updates: any) {
    const res = await this.fallbackAdapter.updateAdminAccount(id, updates);
    this.scheduleFullSync('ADMIN_ACCOUNTS.update');
    return res;
  }

  async deleteAdminAccount(id: string) {
    const ok = await this.fallbackAdapter.deleteAdminAccount(id);
    if (ok) {
      this.scheduleFullSync('ADMIN_ACCOUNTS.delete');
    }
    return ok;
  }

  async getBranches() {
    await this.ensureFreshData();
    return this.fallbackAdapter.getBranches();
  }

  async updateBranch(id: string, updates: any) {
    const res = await this.fallbackAdapter.updateBranch(id, updates);
    this.scheduleFullSync('BRANCH.update');
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
      const snapshot = { ...updated };
      this.scheduleSheetsWrite(() => this.syncService.syncSystemSettingsToSheet(snapshot), 'SETTINGS.update');
    }
    return updated;
  }
}
