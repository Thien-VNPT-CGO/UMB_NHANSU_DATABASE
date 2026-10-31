import { MockSheetsAdapter } from './mock-sheets.adapter.js';
import { PostgresStore } from './postgres-store.js';
import { DriveStorageService, getDriveStorage } from '../services/drive-storage.service.js';
import { GoogleSheetsSyncService } from '../services/google-sheets-sync.service.js';
import {
  saveAdjustmentPhotoDisk,
  saveAttendancePhotoDisk,
  saveAvatarPhotoDisk,
  deleteAdjustmentPhotoDisk,
  deleteAttendancePhotoDisk,
  deleteAvatarPhotoDisk,
} from '../services/photo-disk.store.js';

/**
 * Adapter PostgreSQL — nguồn sự thật mới của UBM HR.
 *
 * - Mọi thao tác đọc phục vụ từ MockSheetsAdapter (cache trong bộ nhớ, nạp từ
 *   PostgreSQL lúc khởi động) nên giữ nguyên toàn bộ logic nghiệp vụ hiện có.
 * - Mọi thao tác ghi: chạy logic trong bộ nhớ → persist xuống PostgreSQL ngay
 *   trong cùng request (write-through) → API mới trả kết quả.
 * - Ảnh check-in/out, ảnh bằng chứng, avatar: lưu đĩa VPS trước, upload Google
 *   Drive (cây Chi nhánh/Ngày/Nhân viên), DB chỉ lưu drive id. Upload lâu hơn
 *   ngưỡng sẽ chạy nền để không chặn điểm danh.
 * - Google Sheets chỉ còn là kênh export/báo cáo một chiều; auto pull/push và
 *   webhook Apps Script bị tắt khi chạy PostgreSQL.
 */

const WRITE_METHODS = new Set<string>([
  'createAccount',
  'deleteAccount',
  'setAccountPin',
  'markAccountPinMustChange',
  'setAccountStatus',
  'createEmployee',
  'updateEmployee',
  'deleteEmployee',
  'addStageHistory',
  'createCandidate',
  'updateCandidate',
  'deleteCandidate',
  'createShiftAssignment',
  'updateShiftAssignment',
  'publishShiftAssignments',
  'deleteShiftAssignment',
  'purgeShiftAssignments',
  'deleteShiftsForEmployee',
  'createLeaveRequest',
  'updateLeaveRequest',
  'createSwapRequest',
  'updateSwapRequest',
  'recordAttendanceEvent',
  'updateAttendanceEvent',
  'deleteAttendanceEvent',
  'createAttendanceAdjustment',
  'updateAttendanceAdjustment',
  'deleteAttendanceAdjustment',
  'createPayrollRun',
  'updatePayrollRunStatus',
  'updatePayslip',
  'savePayrollFormula',
  'upsertPayrollInput',
  'createNotification',
  'pruneNotifications',
  'markNotificationRead',
  'markNotificationAcknowledged',
  'createTestPaper',
  'updateTestPaper',
  'createTestSubmission',
  'updateTestSubmission',
  'recordOperation',
  'updateOperation',
  'recordAuditLog',
  'createAdminAccount',
  'updateAdminAccount',
  'deleteAdminAccount',
  'updateBranch',
  'updateShiftTemplates',
  'updatePolicies',
  'updateMaintenance',
  'createBackupSnapshot',
  'updateSystemSettings',
]);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return Promise.reject(new Error('TIMEOUT'));
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TIMEOUT')), ms);
    timer.unref?.();
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}

export class PostgresAdapter {
  public readonly fallbackAdapter: MockSheetsAdapter;
  public readonly store: PostgresStore;
  public readonly drive: DriveStorageService;
  public readonly syncService: any;

  private readonly inner: MockSheetsAdapter;
  private readonly realSync: GoogleSheetsSyncService;
  private readonly overrides: Record<string, any>;
  private readonly writeWrappers = new Map<string, (...args: any[]) => Promise<any>>();

  private ready = false;
  private readyReason: 'SHEETS_LOADING' | 'SHEETS_UNREACHABLE' | null = 'SHEETS_LOADING';
  private loadError: string | null = null;
  private counts: Record<string, number> = {};
  private lastWriteAt: string | null = null;
  private readonly photoStats = {
    withPhoto: 0,
    withoutPhoto: 0,
    lastMissingAt: null as string | null,
    lastMissingEvent: null as string | null,
  };

  constructor() {
    this.inner = new MockSheetsAdapter();
    this.fallbackAdapter = this.inner;
    this.store = new PostgresStore();
    this.drive = getDriveStorage();
    this.realSync = new GoogleSheetsSyncService();
    this.ready = !this.store.configured;
    this.readyReason = this.store.configured ? 'SHEETS_LOADING' : null;
    this.syncService = this.buildSyncFacade();
    this.overrides = this.buildOverrides();
    void this.bootstrap();
  }

  /** Trả về Proxy để giữ nguyên toàn bộ 70 method của ISheetsRepository. */
  public asRepository(): any {
    const self = this;
    return new Proxy(this.inner as any, {
      get(target, prop) {
        if (prop === 'then') return undefined; // tránh bị coi là Promise
        if (Object.prototype.hasOwnProperty.call(self.overrides, prop)) {
          return self.overrides[prop as string];
        }
        const value = (target as any)[prop];
        if (typeof value !== 'function') return value;
        if (typeof prop === 'string' && WRITE_METHODS.has(prop)) {
          let wrapper = self.writeWrappers.get(prop);
          if (!wrapper) {
            wrapper = async (...args: any[]) => self.executeWrite(prop as string, args);
            self.writeWrappers.set(prop, wrapper);
          }
          return wrapper;
        }
        return value.bind(target);
      },
      set(target, prop, value) {
        (target as any)[prop] = value;
        return true;
      },
      has(target, prop) {
        return Object.prototype.hasOwnProperty.call(self.overrides, prop) || prop in target;
      },
    });
  }

  private async bootstrap(): Promise<void> {
    if (!this.store.configured) {
      this.ready = true;
      this.readyReason = null;
      console.log('[PostgresAdapter] DATABASE_URL chưa cấu hình — chạy bộ nhớ (dev/mock).');
      return;
    }
    try {
      await this.store.initSchema();
      const res = await this.store.loadAll(this.inner);
      this.counts = res.counts || {};
      if (!res.loaded) {
        // Lần chạy đầu tiên: ghi seed (admin/HR mặc định, chi nhánh) để restart
        // không mất tài khoản quản trị. Script migrate sẽ replaceAll() sau.
        await this.store.persistAll(this.inner);
        console.log('[PostgresAdapter] Database trống — đã seed dữ liệu khởi tạo.');
      }
      this.ready = true;
      this.readyReason = null;
      console.log(
        `[PostgresAdapter] Sẵn sàng. PostgreSQL: ${this.counts.employees || 0} NV, `
        + `${this.counts.attendanceEvents || 0} sự kiện chấm công, ${this.counts.shifts || 0} ca.`,
      );
    } catch (err: any) {
      this.loadError = err?.message || String(err);
      this.ready = false;
      this.readyReason = 'SHEETS_UNREACHABLE';
      console.error('[PostgresAdapter] Không nạp được dữ liệu PostgreSQL:', this.loadError);
    }
  }

  public getReadiness(): { ready: boolean; reason?: 'SHEETS_LOADING' | 'SHEETS_UNREACHABLE' } {
    if (!this.store.configured) return { ready: true };
    if (this.ready) return { ready: true };
    return { ready: false, reason: this.readyReason || 'SHEETS_LOADING' };
  }

  public getStatus() {
    const syncStatus: any = (() => {
      try { return this.realSync.getStatus(); } catch { return null; }
    })();
    return {
      connected: !!(syncStatus?.isConfigured),
      mode: this.store.configured ? 'POSTGRES' : 'MOCK_ENGINE_ACTIVE',
      dataStore: this.store.configured ? 'POSTGRES' : 'MEMORY',
      spreadsheetId: process.env.SPREADSHEET_ID || process.env.GOOGLE_SPREADSHEET_ID || '',
      candidateSpreadsheetId: process.env.CANDIDATE_SPREADSHEET_ID || '',
      driveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID || '',
      photoStats: this.getPhotoStats(),
      postgres: {
        configured: this.store.configured,
        ready: this.getReadiness().ready,
        error: this.loadError,
        counts: this.counts,
        lastWriteAt: this.lastWriteAt,
      },
      drive: this.drive.getStatus(),
      syncService: syncStatus,
      snapshot: {
        loaded: this.getReadiness().ready,
        savedAt: null,
        writeError: null,
      },
      durableWrites: null,
      realtime: {
        transport: 'socket.io',
        lastWriteAt: this.lastWriteAt,
        lastWebhookAt: null,
        lastWebhookTab: null,
        coalesceMs: 0,
      },
      message: this.store.configured
        ? 'PostgreSQL là nguồn sự thật; Google Sheets chỉ dùng export/báo cáo một chiều'
        : 'Chưa cấu hình DATABASE_URL — đang chạy bộ nhớ tạm (không dùng production)',
    };
  }

  public getPhotoStats() {
    return { ...this.photoStats };
  }

  public getMockAdapter(): MockSheetsAdapter {
    return this.inner;
  }

  public getPendingSheetsWrites() {
    return {
      pendingWrites: 0,
      pending: 0,
      pausedUntil: null,
      lastSheetsWriteAt: null,
      mode: 'POSTGRES',
    };
  }

  public async flushSheetsWrites(_timeoutMs?: number): Promise<void> {
    // Không còn hàng đợi ghi Sheets. Chờ các persist PostgreSQL đang chạy xong
    // (ghi đồng bộ trong từng request nên thực tế không còn việc treo).
  }

  public async retryDurableDeadLetters(_opts?: any): Promise<number> {
    return 0;
  }

  public triggerSheetsPull(_reason?: string): { accepted: boolean } {
    return { accepted: false };
  }

  public noteOwnWrite(_entity?: string): void {
    this.lastWriteAt = new Date().toISOString();
  }

  public isSelfWriteRecent(_ms?: number, _tabs?: string[]): boolean {
    return false;
  }

  public isExternalEditRecent(_ms?: number): boolean {
    return false;
  }

  public async ensureFreshData(_opts?: any): Promise<void> {
    // Dữ liệu đã nằm trong PostgreSQL + bộ nhớ; không cần pull Sheets.
  }

  public scheduleFullSync(_reason?: string): void {
    // Không còn đồng bộ hai chiều.
  }

  public async pushCandidatesNow(): Promise<number> {
    return 0;
  }

  private buildOverrides(): Record<string, any> {
    const self = this;
    return {
      fallbackAdapter: this.inner,
      store: this.store,
      drive: this.drive,
      syncService: this.syncService,
      isPostgres: true,
      getMockAdapter: () => self.getMockAdapter(),
      getReadiness: () => self.getReadiness(),
      getStatus: () => self.getStatus(),
      getPhotoStats: () => self.getPhotoStats(),
      getPendingSheetsWrites: () => self.getPendingSheetsWrites(),
      flushSheetsWrites: (ms?: number) => self.flushSheetsWrites(ms),
      retryDurableDeadLetters: (opts?: any) => self.retryDurableDeadLetters(opts),
      triggerSheetsPull: (reason?: string) => self.triggerSheetsPull(reason),
      noteOwnWrite: (entity?: string) => self.noteOwnWrite(entity),
      isSelfWriteRecent: (ms?: number, tabs?: string[]) => self.isSelfWriteRecent(ms, tabs),
      isExternalEditRecent: (ms?: number) => self.isExternalEditRecent(ms),
      ensureFreshData: (opts?: any) => self.ensureFreshData(opts),
      scheduleFullSync: (reason?: string) => self.scheduleFullSync(reason),
      pushCandidatesNow: () => self.pushCandidatesNow(),
    };
  }

  private buildSyncFacade(): any {
    const self = this;
    const real = this.realSync;
    const overrides: Record<string, any> = {
      /** Pull/push Sheets không còn là đường dữ liệu. */
      pullAllDataFromGoogleSheets: async () => ({
        success: false,
        message: 'POSTGRES_PRIMARY: dữ liệu đọc/ghi trực tiếp PostgreSQL, không pull Sheets.',
      }),
      hasUnpushedChanges: () => false,
      ensurePullNotStuck: () => undefined,
      onDataChanged: () => undefined,
      runWriteProbe: async () => ({ ok: true, skipped: true }),
      archiveAttendanceWeek: async () => ({ archived: false, reason: 'POSTGRES_NO_WEEKLY_ARCHIVE' }),

      getStatus: () => {
        const base: any = (() => {
          try { return real.getStatus(); } catch { return {}; }
        })();
        return {
          ...base,
          dataStore: 'POSTGRES',
          primary: 'POSTGRES',
          sheetsRole: 'EXPORT_ONLY',
          drive: self.drive.getStatus(),
        };
      },

      isDriveReady: () => self.drive.isConfigured() || (() => {
        try { return !!real.isDriveReady?.(); } catch { return false; }
      })(),

      downloadDriveFile: async (fileId: string) => {
        if (self.drive.isConfigured()) return self.drive.downloadFile(fileId);
        return real.downloadDriveFile(fileId);
      },

      uploadImageToDrive: async (fileName: string, _mimeType: string, base64Data: string) => {
        const ref = await self.drive.uploadDataUrl(fileName, base64Data, ['PHOTOS'], undefined, { upsert: false });
        return { fileId: ref.fileId, webViewLink: ref.viewUrl };
      },

      uploadBufferToDrivePath: async (
        fileName: string, mimeType: string, buffer: Buffer, segments: string[], rootId?: string,
      ) => {
        const ref = await self.drive.uploadBuffer(fileName, mimeType, buffer, segments, rootId, { upsert: false });
        return { fileId: ref.fileId, webViewLink: ref.viewUrl };
      },

      upsertBufferToDrivePath: async (
        fileName: string, mimeType: string, buffer: Buffer, segments: string[], rootId?: string,
      ) => {
        const ref = await self.drive.uploadBuffer(fileName, mimeType, buffer, segments, rootId, { upsert: true });
        return { fileId: ref.fileId, webViewLink: ref.viewUrl };
      },

      getDriveUploadStatus: () => {
        const base: any = (() => {
          try { return real.getDriveUploadStatus?.() || {}; } catch { return {}; }
        })();
        return { ...base, driveConfigured: self.drive.isConfigured(), mode: 'POSTGRES' };
      },
    };

    return new Proxy(real as any, {
      get(target, prop) {
        if (Object.prototype.hasOwnProperty.call(overrides, prop)) {
          return overrides[prop as string];
        }
        const value = (target as any)[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, prop, value) {
        (target as any)[prop] = value;
        return true;
      },
      has(target, prop) {
        return Object.prototype.hasOwnProperty.call(overrides, prop) || prop in target;
      },
    });
  }

  private async executeWrite(method: string, args: any[]): Promise<any> {
    if (method === 'recordAttendanceEvent') {
      await this.prepareAttendanceEvent(args[0]);
    } else if (method === 'createAttendanceAdjustment') {
      await this.prepareAdjustmentPhoto(args[0]);
    } else if (method === 'updateEmployee') {
      // updateEmployee(id, updates, expectedVersion) — dữ liệu nằm ở args[1].
      await this.prepareEmployeeAvatar(String(args[0] || ''), args[1]);
    } else if (method === 'createEmployee') {
      await this.prepareEmployeeAvatar(String(args[0]?.employee_id || ''), args[0]);
    }

    const result = await (this.inner as any)[method](...args);
    this.lastWriteAt = new Date().toISOString();

    if (!this.store.configured) return result;
    try {
      await this.store.persistMutation(method, args, result, this.inner);
    } catch (err: any) {
      // DB là nguồn sự thật: không thể báo thành công khi persist thất bại.
      console.error(`[PostgresAdapter] Persist ${method} thất bại:`, err?.message || err);
      this.loadError = `PERSIST_FAILED:${method}:${err?.message || err}`;
      throw new Error(`PERSIST_FAILED:${method}`);
    }
    return result;
  }

  private async prepareAttendanceEvent(event: any): Promise<void> {
    if (!event) return;
    const hasPhoto = !!event.photo_base64;
    if (hasPhoto) {
      this.photoStats.withPhoto++;
    } else if (event.type === 'CHECK_IN' || event.type === 'CHECK_OUT') {
      this.photoStats.withoutPhoto++;
      this.photoStats.lastMissingAt = new Date().toISOString();
      this.photoStats.lastMissingEvent = event.event_id || null;
    }
    const dataUrl = String(event.photo_base64 || '');
    if (!dataUrl) return;

    const eventId = String(event.event_id || '');
    if (eventId) {
      try { saveAttendancePhotoDisk(eventId, dataUrl); } catch { /* best-effort */ }
    }

    if (!this.drive.isConfigured()) {
      event.drive_object_id = `DRV_LOCAL_${Date.now()}`;
      event.event_photo = dataUrl;
      delete event.photo_base64;
      return;
    }

    const upload = (async () => {
      const emp: any = await this.inner.getEmployeeById(event.employee_id).catch(() => null);
      return this.drive.uploadAttendancePhoto(
        { ...event, photo_base64: dataUrl },
        emp?.full_name || String(event.employee_id || 'KHONG_NV'),
      );
    })();

    const waitMs = Math.max(0, Number(process.env.DRIVE_UPLOAD_BLOCK_MS ?? 4000));
    try {
      const ref = await withTimeout(upload, waitMs);
      event.drive_object_id = ref.fileId;
      delete event.photo_base64;
      delete event.event_photo;
      if (eventId) deleteAttendancePhotoDisk(eventId);
    } catch (err: any) {
      event.drive_object_id = `DRV_LOCAL_${Date.now()}`;
      event.event_photo = dataUrl;
      delete event.photo_base64;
      // Upload tiếp tục ở nền; xong thì cập nhật bộ nhớ + PostgreSQL + dọn đĩa.
      void upload.then(async ref => {
        try {
          const target: any = this.inner.attendanceEvents.find(e => String(e.event_id) === eventId) || event;
          target.drive_object_id = ref.fileId;
          delete target.event_photo;
          if (eventId) deleteAttendancePhotoDisk(eventId);
          if (this.store.configured) {
            await this.store.persistMutation('updateAttendanceEvent', [eventId, { drive_object_id: ref.fileId }], target, this.inner);
          }
          console.log(`[PostgresAdapter] Upload nền ảnh ${eventId} xong: ${ref.fileId}`);
        } catch (e: any) {
          console.warn(`[PostgresAdapter] Cập nhật Drive id nền cho ${eventId} lỗi:`, e?.message || e);
        }
      }).catch((e: any) => {
        console.warn(`[PostgresAdapter] Upload nền ảnh ${eventId} thất bại (giữ đĩa để retry):`, e?.message || e);
      });
    }
  }

  private async prepareAdjustmentPhoto(adj: any): Promise<void> {
    if (!adj?.photo_base64) return;
    const dataUrl = String(adj.photo_base64);
    const adjId = String(adj.adjustment_id || '');
    if (adjId) {
      try { saveAdjustmentPhotoDisk(adjId, dataUrl); } catch { /* best-effort */ }
    }
    if (!this.drive.isConfigured()) {
      adj.evidence_drive_id = `DRV_LOCAL_${Date.now()}`;
      adj.evidence_photo = dataUrl;
      delete adj.photo_base64;
      return;
    }
    const upload = (async () => {
      const emp: any = await this.inner.getEmployeeById(adj.employee_id).catch(() => null);
      return this.drive.uploadAdjustmentPhoto({ ...adj, photo_base64: dataUrl }, emp?.full_name || String(adj.employee_id || 'KHONG_NV'));
    })();
    const waitMs = Math.max(0, Number(process.env.DRIVE_UPLOAD_BLOCK_MS ?? 4000));
    try {
      const ref = await withTimeout(upload, waitMs);
      adj.evidence_drive_id = ref.fileId;
      delete adj.photo_base64;
      delete adj.evidence_photo;
      if (adjId) deleteAdjustmentPhotoDisk(adjId);
    } catch {
      adj.evidence_drive_id = `DRV_LOCAL_${Date.now()}`;
      adj.evidence_photo = dataUrl;
      delete adj.photo_base64;
      void upload.then(async ref => {
        try {
          const target: any = this.inner.attendanceAdjustments.find(a => String(a.adjustment_id) === adjId) || adj;
          target.evidence_drive_id = ref.fileId;
          delete target.evidence_photo;
          if (adjId) deleteAdjustmentPhotoDisk(adjId);
          if (this.store.configured) {
            await this.store.persistMutation('createAttendanceAdjustment', [], target, this.inner);
          }
        } catch (e: any) {
          console.warn(`[PostgresAdapter] Cập nhật Drive id phiếu ${adjId} lỗi:`, e?.message || e);
        }
      }).catch((e: any) => {
        console.warn(`[PostgresAdapter] Upload nền phiếu ${adjId} thất bại:`, e?.message || e);
      });
    }
  }

  private async prepareEmployeeAvatar(employeeIdMaybe: string, updateOrData: any): Promise<void> {
    if (!updateOrData?.photo_base64) return;
    const employeeId = String(employeeIdMaybe || updateOrData.employee_id || '');
    const dataUrl = String(updateOrData.photo_base64);
    if (employeeId) {
      try { saveAvatarPhotoDisk(employeeId, dataUrl); } catch { /* best-effort */ }
    }
    if (!this.drive.isConfigured()) {
      updateOrData.avatar_drive_id = `DRV_LOCAL_${Date.now()}`;
      updateOrData.avatar_photo = dataUrl;
      delete updateOrData.photo_base64;
      return;
    }
    const upload = (async () => this.drive.uploadAvatar(employeeId, dataUrl))();
    const waitMs = Math.max(0, Number(process.env.DRIVE_UPLOAD_BLOCK_MS ?? 4000));
    try {
      const ref = await withTimeout(upload, waitMs);
      updateOrData.avatar_drive_id = ref.fileId;
      updateOrData.avatar_photo = undefined;
      delete updateOrData.photo_base64;
      if (employeeId) deleteAvatarPhotoDisk(employeeId);
    } catch {
      updateOrData.avatar_drive_id = `DRV_LOCAL_${Date.now()}`;
      updateOrData.avatar_photo = dataUrl;
      delete updateOrData.photo_base64;
      void upload.then(async ref => {
        try {
          const emp: any = this.inner.employees.find(e => String(e.employee_id) === employeeId);
          if (emp) {
            emp.avatar_drive_id = ref.fileId;
            delete emp.avatar_photo;
            if (this.store.configured) {
              await this.store.persistMutation('updateEmployee', [], emp, this.inner);
            }
          }
          if (employeeId) deleteAvatarPhotoDisk(employeeId);
        } catch (e: any) {
          console.warn(`[PostgresAdapter] Cập nhật avatar Drive nền lỗi:`, e?.message || e);
        }
      }).catch((e: any) => {
        console.warn('[PostgresAdapter] Upload nền avatar thất bại:', e?.message || e);
      });
    }
  }
}

/** Factory dùng trong app.ts / server.ts. */
export function createPostgresRepository(): any {
  return new PostgresAdapter().asRepository();
}
