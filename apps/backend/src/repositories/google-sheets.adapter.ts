import fs from 'fs';
import path from 'path';
import { ISheetsRepository } from './sheets.interface.js';
import { MockSheetsAdapter } from './mock-sheets.adapter.js';
import { sheetDateText, sheetDateTimeText } from '../services/employees.service.js';
import { GoogleSheetsSyncService } from '../services/google-sheets-sync.service.js';
import { saveAttendancePhotoDisk, saveAdjustmentPhotoDisk } from '../services/photo-disk.store.js';
import { DurableWriteQueue } from './durable-write-queue.js';
import { readRuntimeSnapshot, writeRuntimeSnapshot } from './runtime-snapshot.js';
import { getAttendanceFolderForBranch } from '../config/drive-folders.js';

/** Ngày VN (YYYY-MM-DD) của 1 mốc ISO — dùng đặt folder ảnh theo ngày. */
function vnDayOfIso(input: unknown): string {
  const t = Date.parse(String(input || ''));
  if (!Number.isFinite(t)) return '';
  return new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** Tên folder Drive an toàn (bỏ ký tự cấm, giới hạn độ dài). */
function safeDriveSeg(v: unknown): string {
  return String(v ?? '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'KHONG_XAC_DINH';
}

export class GoogleSheetsAdapter implements ISheetsRepository {
  private fallbackAdapter: MockSheetsAdapter;
  private isConfigured = false;
  private lastPullTime = 0;
  private pullInFlight: Promise<unknown> | null = null;
  public syncService: GoogleSheetsSyncService;
  private durableWrites: DurableWriteQueue;
  // Snapshot khởi động: có dữ liệu lần pull trước trên đĩa thì phục vụ ngay,
  // pull nền vẫn chạy để cập nhật phần thay đổi khi downtime.
  private snapshotLoaded = false;
  private snapshotSavedAt: string | null = null;
  private snapshotWriteError: string | null = null;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  // Sẵn sàng dữ liệu sau khởi động: kho rỗng + Sheets chưa đọc xong thì login phải
  // báo SHEETS_LOADING (đợi), không báo ACCOUNT_NOT_FOUND oan.
  // (needsSeed() không dùng được ở đây vì seed sẵn có admin -> luôn false.)
  private startupPullDone = false;
  private consecPullFails = 0;
  // Snapshot khởi động có thể CŨ hơn Sheet (backend downtime): ngay sau khi nạp
  // snapshot, các lượt đọc LỊCH/CÔNG/ỨNG VIÊN phải đợi pull đầu tiên (có giới
  // hạn) thay vì trả dữ liệu cũ — trước đây web hiện ca DRAFT/vắng oan vài giây
  // rồi mới "xanh" lại. Pull lỗi/timeout thì đánh dấu xong để không chặn lặp lại.
  private restoredFromSnapshot = false;
  private firstPullAfterRestoreDone = false;
  /** Mốc nạp snapshot — chỉ pull TOÀN BỘ hoàn tất SAU mốc này mới được coi là tươi. */
  private snapshotRestoredAtMs = 0;
  private readonly firstPullWaitMs = Math.max(2_000, Number(process.env.SHEETS_FIRST_PULL_WAIT_MS) || 12_000);
  /**
   * Thời gian TỐI ĐA chờ push tab khi DUYỆT phiếu (nghỉ phép / đổi ca).
   * Bộ nhớ + snapshot đã cập nhật ngay; push tiếp tục chạy nền. Trước đây chờ
   * tới 15s nên khi Google Sheets chậm, thao tác duyệt treo rất lâu.
   */
  private readonly approvalPushWaitMs = Math.max(1_000, Number(process.env.SHEETS_APPROVAL_PUSH_WAIT_MS) || 3_000);

  constructor() {
    this.fallbackAdapter = new MockSheetsAdapter();

    // Check if GOOGLE_SERVICE_ACCOUNT_JSON / BASE64 / FILE is provided
    let jsonStr = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
    if (jsonStr && !jsonStr.startsWith('{') && /^[A-Za-z0-9+/=]+$/.test(jsonStr)) {
      try {
        jsonStr = Buffer.from(jsonStr, 'base64').toString('utf8');
      } catch (_) {}
    }
    if (!jsonStr) {
      const candidates = [
        process.env.GOOGLE_SERVICE_ACCOUNT_FILE,
        path.resolve(process.cwd(), 'data/service-account.json'),
        '/app/data/service-account.json',
      ].filter(Boolean) as string[];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          try {
            jsonStr = fs.readFileSync(p, 'utf8');
            console.log(`[GoogleSheetsAdapter] Đã nạp credentials từ file: ${p}`);
            break;
          } catch (_) {}
        }
      }
    }

    if (jsonStr) {
      try {
        const creds = JSON.parse(jsonStr);
        if (creds.client_email && creds.private_key) {
          process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = creds.client_email;
          process.env.GOOGLE_PRIVATE_KEY = creds.private_key;
          process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify(creds);
        }
      } catch (e) {
        console.warn('Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON from environment:', e);
      }
    }

    const spreadsheetId = process.env.SPREADSHEET_ID || process.env.GOOGLE_SPREADSHEET_ID || '1UO1UF1d7_YzaCltYt2m9pRnUauGWw873ERqAMxwL-6k';
    process.env.SPREADSHEET_ID = spreadsheetId;

    this.syncService = new GoogleSheetsSyncService();

    // Hàng đợi append bền vững: mọi dòng ghi xuống Sheet đều vào journal trên
    // đĩa trước, rồi retry nền nếu Google timeout/quota. Đây là lớp chống mất
    // check-in/thông báo khi container restart đúng lúc append đang bay.
    const maxAttempts = Math.max(1, Number(process.env.DURABLE_WRITE_MAX_ATTEMPTS) || 12);
    this.durableWrites = new DurableWriteQueue({
      append: (sheetTitle, rows) => this.syncService.appendRows(sheetTitle, rows),
      filePath: process.env.PENDING_WRITES_FILE?.trim() || path.resolve(process.cwd(), 'data/pending-writes.json'),
      maxAttempts,
      // Gộp nhiều bản ghi CÙNG TAB vào 1 request (mặc định 100 bản ghi/500 dòng).
      // Trước đây 1 bản ghi = 1 request → 2.600 bản ghi tồn đọng không bao giờ
      // đuổi kịp quota ghi của Google.
      batchMaxEntries: Math.max(1, Number(process.env.DURABLE_APPEND_BATCH_ENTRIES) || 100),
      batchMaxRows: Math.max(1, Number(process.env.DURABLE_APPEND_BATCH_ROWS) || 500),
      failureStreakLimit: Math.max(1, Number(process.env.DURABLE_WRITE_FAILURE_STREAK) || 3),
      pauseMs: Math.max(1_000, Number(process.env.DURABLE_WRITE_PAUSE_MS) || 60_000),
      priorityThreshold: Number.isFinite(Number(process.env.DURABLE_WRITE_PRIORITY_THRESHOLD))
        ? Math.max(0, Number(process.env.DURABLE_WRITE_PRIORITY_THRESHOLD))
        : 300,
      // Tab lỗi liên tiếp bị hoãn riêng (mặc định 10 phút) — 1 tab hỏng không
      // được chặn điểm danh/phiếu ca của các tab khác.
      tabBackoffMs: Math.max(30_000, Number(process.env.DURABLE_TAB_BACKOFF_MS) || 600_000),
      onDeadLetter: (entry) => {
        console.error(`[GoogleSheetsAdapter] Dead-letter ghi ${entry.sheetTitle} sau ${entry.attempts} lần — chạy full-sync bù.`);
        // Thông báo không đáng đẩy cả 24 tab (dễ dội quota); dữ liệu nghiệp vụ
        // (điểm danh, phiếu ca, công...) thì cần full-sync bù ngay.
        if (!/^THONGBAO_/i.test(String(entry.sheetTitle || ''))) {
          this.scheduleFullSync(`durable-dead-letter:${entry.sheetTitle}`);
        }
      },
    });

    // Check if Google credentials are provided in env
    const hasJson = !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const hasEmailKey = !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
    if ((hasJson || hasEmailKey) && spreadsheetId) {
      this.isConfigured = true;
      console.log(`[GoogleSheetsAdapter] Khởi động với Sheets LIVE (spreadsheet: ${spreadsheetId.slice(0, 8)}..., creds: ${hasJson ? 'JSON' : 'EMAIL+KEY'})`);

      // P0.2: nạp snapshot trước khi listen để web có dữ liệu ngay. Không chặn
      // pull nền; nếu Sheet đổi trong lúc downtime, pull đầu tiên sẽ phát realtime.
      this.restoreRuntimeSnapshot();

      // P0.1: xả các append còn tồn sau 5s (đợi init client/xác thực xong).
      const replayTimer = setTimeout(() => {
        if (!this.isConfigured) return;
        this.durableWrites.start();
      }, 5000);
      (replayTimer as any)?.unref?.();

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
            // Nếu một request đọc (lịch/công/ứng viên) đã kích hoạt pull đầu qua
            // ensureFreshData thì DÙNG CHUNG promise đó — tránh 2 full-pull song
            // song ngay sau boot (dội quota đọc Google).
            const pullResult: any = this.pullInFlight
              ? await this.pullInFlight
              : await this.syncService.pullAllDataFromGoogleSheets(this).catch(err => {
                  console.warn(`[GoogleSheetsAdapter] Startup pull lần ${attempt} lỗi:`, err?.message || err);
                  return null;
                });
            this.markPullSettled(!!(pullResult as any)?.counts);
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

  /**
   * Nạp snapshot runtime đã lưu (nếu có) và khôi phục metadata sync để lần pull
   * đầu tiên biết nội dung nào đã thay đổi trong lúc backend downtime.
   */
  private restoreRuntimeSnapshot(): void {
    const snap = readRuntimeSnapshot();
    if (!snap) return;
    const currentSpreadsheetId = process.env.SPREADSHEET_ID || process.env.GOOGLE_SPREADSHEET_ID || '';
    const snapshotSpreadsheetId = snap.meta?.spreadsheetId || '';
    if (snapshotSpreadsheetId && currentSpreadsheetId && snapshotSpreadsheetId !== currentSpreadsheetId) {
      console.warn(
        '[GoogleSheetsAdapter] Bỏ qua snapshot vì khác Spreadsheet ID ' +
        `(${snapshotSpreadsheetId.slice(0, 8)}… ≠ ${currentSpreadsheetId.slice(0, 8)}…) — chờ pull Sheets.`,
      );
      return;
    }
    try {
      if (!this.fallbackAdapter.importRuntimeState(snap.state)) return;
      this.snapshotLoaded = true;
      this.snapshotSavedAt = snap.meta?.savedAt || null;
      this.startupPullDone = true;
      this.restoredFromSnapshot = true;
      this.firstPullAfterRestoreDone = false;
      this.snapshotRestoredAtMs = Date.now();
      this.lastPullTime = 0; // đọc lịch/công/ứng viên sẽ ép pull đầu ngay (xem ensureFreshData)
      this.syncService.restoreSnapshotMeta(snap.meta as any);
      console.log(
        `[GoogleSheetsAdapter] Đã nạp snapshot lúc ${this.snapshotSavedAt || '?'} — ` +
        `phục vụ ngay ${this.fallbackAdapter.employees.length} NV / ${this.fallbackAdapter.attendanceEvents.length} sự kiện chấm công.`,
      );
    } catch (err: any) {
      this.snapshotLoaded = false;
      console.warn('[GoogleSheetsAdapter] Nạp snapshot lỗi (bỏ qua, chờ pull Sheets):', err?.message || err);
    }
  }

  /**
   * Ghi snapshot hiện tại. SyncService gọi sau mỗi pull; adapter gọi debounce
   * sau mutation để cửa sổ mất dữ liệu khi restart chỉ còn ~1-2s.
   */
  public async persistRuntimeSnapshot(meta?: {
    spreadsheetId?: string | null;
    signature?: string | null;
    tabSignatures?: Record<string, string>;
    pulledAt?: string | null;
    counts?: any;
  }): Promise<void> {
    if (!this.isConfigured) return;
    try {
      const syncMeta: any = this.syncService.getSnapshotMeta?.() || {};
      const ok = await writeRuntimeSnapshot(this.fallbackAdapter.exportRuntimeState(), {
        spreadsheetId: meta?.spreadsheetId
          ?? process.env.SPREADSHEET_ID
          ?? process.env.GOOGLE_SPREADSHEET_ID
          ?? null,
        signature: meta?.signature ?? syncMeta.signature ?? null,
        tabSignatures: meta?.tabSignatures ?? syncMeta.tabSignatures,
        pulledAt: meta?.pulledAt ?? syncMeta.pulledAt ?? null,
        counts: meta?.counts ?? syncMeta.counts,
      });
      if (ok) {
        this.snapshotLoaded = true;
        this.snapshotSavedAt = new Date().toISOString();
        this.snapshotWriteError = null;
      } else {
        this.snapshotWriteError = 'WRITE_FAILED';
      }
    } catch (err: any) {
      this.snapshotWriteError = err?.message || String(err);
      console.warn('[GoogleSheetsAdapter] persistRuntimeSnapshot lỗi:', this.snapshotWriteError);
    }
  }

  public exportRuntimeState(): any {
    return this.fallbackAdapter.exportRuntimeState();
  }

  private scheduleRuntimeSnapshot(delayMs = 1500): void {
    if (!this.isConfigured || this.snapshotTimer) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      void this.persistRuntimeSnapshot();
    }, Math.max(0, delayMs));
    (this.snapshotTimer as any)?.unref?.();
  }

  /** Kho đã có dữ liệu nhân sự thật (không tính seed admin). */
  private hasStaffData(): boolean {
    const f = this.fallbackAdapter;
    return f.employees.length + f.accounts.length > 0;
  }

  private markPullSettled(ok: boolean, fullPull = true) {
    this.startupPullDone = true;
    // Đã có ít nhất 1 lần pull TOÀN BỘ kể từ khi nạp snapshot: các lượt đọc không
    // cần chờ nữa (kể cả pull lỗi — phục vụ snapshot còn hơn treo request).
    // Pull webhook chỉ đọc 1 tab nên KHÔNG tính là đã tươi toàn bộ.
    if (fullPull) this.firstPullAfterRestoreDone = true;
    if (ok) {
      this.consecPullFails = 0;
    } else {
      this.consecPullFails++;
    }
  }

  /** ===== Nhận diện write do CHÍNH hệ thống phát ra (ngăn emit "all" thừa) =====
   *  Mọi POST/PUT/PATCH thành công middleware app.ts đã bắn data:updated theo từng
   *  entity NGAY. Pull thấy nội dung đổi (duy nhất là do các write đó) mà bắn
   *  tiếp 'data:updated(all)' là cả 2 cổng web tải lại TOÀN BỘ lần 2 mỗi thao tác.
   *
   *  Bản cũ chặn theo 1 mốc thời gian TOÀN CỤC: hễ có write API trong 12s là bỏ
   *  emit mọi thay đổi — kể cả sửa tay trên 1 tab KHÁC (mất realtime lịch PV).
   *  Nay theo dõi mốc riêng từng tab và chỉ bỏ emit khi MỌI tab vừa đổi đều do
   *  hệ thống vừa ghi.
   */
  private lastOwnWriteAt = 0;
  private lastOwnWriteWildcardAt = 0;
  private lastOwnWriteByTab = new Map<string, number>();

  /** entity API -> các tab Sheets mà write của entity đó có thể chạm tới. */
  private static readonly ENTITY_TABS: Record<string, string[]> = {
    employees: ['NHAN_VIEN_MASTER', 'LICH_SU_GIAI_DOAN', 'FROM_NHAN_VIEN', 'UNG_VIEN'],
    accounts: ['TAI_KHOAN_NHAN_VIEN', 'ADMIN_ACCOUNTS'],
    schedules: ['PHAN_CONG_CA', 'DON_NGHI_PHEP', 'DON_DOI_CA', 'PHIEU_NV_CAP_NHAT_CA'],
    attendance: ['SU_KIEN_DIEM_DANH', 'DIEU_CHINH_CONG', 'LUUTRU_CHAMCONG_TUAN'],
    payroll: ['KY_LUONG', 'PHIEU_LUONG', 'CONG_THUC_LUONG', 'DULIEU_LUONG_KY'],
    notifications: ['THONGBAO_NV', 'THONGBAO_GUI', 'THONGBAO_'],
    tests: ['BAI_THI', 'BAI_LAM'],
    branches: ['DANH_SACH_CHI_NHANH'],
    zalo: ['FROM_NHAN_VIEN', 'UNG_VIEN'],
    candidates: ['FROM_NHAN_VIEN', 'UNG_VIEN'],
    settings: ['CAU_HINH_HE_THONG', 'AUDIT_LOG', 'SNAPSHOT_SAOLUU'],
    me: [
      'THONGBAO_NV', 'PHAN_CONG_CA', 'DON_NGHI_PHEP', 'DON_DOI_CA',
      'SU_KIEN_DIEM_DANH', 'DIEU_CHINH_CONG', 'PHIEU_LUONG',
    ],
  };

  /** Tab đã đổi có khớp tab của entity không (xử lý tab part `_P2`, prefix `THONGBAO_`). */
  private static tabMatches(candidate: string, mapped: string): boolean {
    const c = String(candidate || '').toUpperCase();
    const m = String(mapped || '').toUpperCase();
    if (!c || !m) return false;
    if (c === m) return true;
    if (m.endsWith('_')) return c.startsWith(m);
    return c.startsWith(`${m}_P`) || m.startsWith(`${c}_P`);
  }

  public noteOwnWrite(entity?: string | null): void {
    const now = Date.now();
    this.lastOwnWriteAt = now;
    const tabs = entity ? GoogleSheetsAdapter.ENTITY_TABS[String(entity)] : undefined;
    if (!tabs) {
      // Không rõ entity (vd. 'all'): giữ hành vi cũ — chặn mọi tab.
      this.lastOwnWriteWildcardAt = now;
      return;
    }
    for (const tab of tabs) this.lastOwnWriteByTab.set(tab, now);
  }

  /**
   * Có phải thay đổi vừa phát hiện là do chính hệ thống vừa ghi?
   * - Không truyền `changedTabs`: xét mốc toàn cục (tương thích chỗ gọi cũ).
   * - Có `changedTabs`: chỉ coi là self-write khi TẤT CẢ tab đều đã được ghi.
   */
  public isSelfWriteRecent(ms = 20000, changedTabs?: string[] | null): boolean {
    if (this.lastOwnWriteAt === 0) return false;
    const now = Date.now();
    const tabs = Array.isArray(changedTabs) ? changedTabs.filter(Boolean) : [];
    if (tabs.length === 0) return now - this.lastOwnWriteAt < ms;
    if (now - this.lastOwnWriteWildcardAt < ms) return true;
    for (const tab of tabs) {
      let stamp = 0;
      for (const [mapped, at] of this.lastOwnWriteByTab) {
        if (GoogleSheetsAdapter.tabMatches(tab, mapped) && at > stamp) stamp = at;
      }
      if (now - stamp >= ms) return false;
    }
    return true;
  }

  // Webhook từ Apps Script (onEdit trên Sheet): kéo ngay, không đợi nhịp 5s.
  // Chống dồn: tối đa 1 lần kích hoạt/1s; pull chồng chéo dùng chung 1 promise.
  // KHÔNG bỏ mất lần sửa cuối: request trong cửa sổ 1s (hoặc khi pull đang bay)
  // được hẹn một lượt pull bù ngay sau đó để đọc đúng bản mới nhất.
  private lastWebhookAt = 0;
  private lastExternalEditAt = 0;
  private webhookRerunTimer: ReturnType<typeof setTimeout> | null = null;
  private lastWebhookTab = '';
  private pendingWebhookTab = '';
  // Webhook onEdit cần realtime 1-2s: cửa sổ chống dồn ngắn (mặc định 1s),
  // vẫn có lượt pull bù để không nuốt lần sửa cuối.
  private readonly webhookCoalesceMs = Math.max(500, Number(process.env.SHEETS_WEBHOOK_COALESCE_MS) || 1000);

  /** Sửa tay trên Sheet (webhook) — dùng để không chặn nhầm realtime vì self-write. */
  public isExternalEditRecent(ms = 8000): boolean {
    return this.lastExternalEditAt > 0 && Date.now() - this.lastExternalEditAt < ms;
  }

  private scheduleWebhookRerun(delayMs: number) {
    if (this.webhookRerunTimer) return;
    this.webhookRerunTimer = setTimeout(() => {
      this.webhookRerunTimer = null;
      if (!this.isConfigured) return;
      // Pull khác vẫn đang chạy: đợi xong rồi pull tiếp để không đọc bản cũ.
      if (this.pullInFlight) {
        this.scheduleWebhookRerun(500);
        return;
      }
      const tab = this.pendingWebhookTab;
      this.lastWebhookAt = 0;
      void this.triggerSheetsPull(tab ? `webhook:${tab}` : 'webhook:coalesced');
    }, Math.max(250, delayMs));
  }

  public triggerSheetsPull(reason = 'webhook'): { accepted: boolean; done: Promise<unknown> } {
    const noop = Promise.resolve(null);
    if (!this.isConfigured) return { accepted: false, done: noop };
    const now = Date.now();
    const isWebhook = reason.startsWith('webhook');
    if (isWebhook) this.lastExternalEditAt = now;

    // `webhook:TAB` -> pull đúng tab; `webhook:coalesced` dùng tab đang chờ.
    let tab = '';
    if (isWebhook) {
      const raw = reason.slice('webhook'.length).replace(/^:/, '').trim().toUpperCase();
      if (raw && raw !== 'COALESCED') tab = raw;
      if (!tab && this.pendingWebhookTab) tab = this.pendingWebhookTab;
      if (tab) {
        this.pendingWebhookTab = tab;
        this.lastWebhookTab = tab;
      }
    }

    if (isWebhook && now - this.lastWebhookAt < this.webhookCoalesceMs) {
      // Có sửa mới trong cửa sổ chống dồn: hẹn pull bù, không nuốt lần sửa cuối.
      this.scheduleWebhookRerun(this.webhookCoalesceMs - (now - this.lastWebhookAt) + 50);
      return { accepted: false, done: this.pullInFlight || noop };
    }
    this.lastWebhookAt = now;
    this.lastPullTime = now; // đồng bộ nhịp auto-pull, tránh pull đúp ngay sau đó
    if (this.pullInFlight) {
      // Pull đang chạy có thể đã đọc trước lúc sửa -> đọc lại sau khi xong.
      this.scheduleWebhookRerun(500);
      return { accepted: true, done: this.pullInFlight };
    }
    console.log(`[GoogleSheetsAdapter] Kích hoạt pull ngay (${reason}${tab ? ` — tab ${tab}` : ''})`);
    const pull = tab && typeof (this.syncService as any).pullTabFromGoogleSheets === 'function'
      ? this.syncService.pullTabFromGoogleSheets(this, tab)
      : this.syncService.pullAllDataFromGoogleSheets(this);
    this.pullInFlight = pull
      .then((r: any) => {
        // Pull webhook chỉ đọc 1 tab -> chưa đủ tươi để bỏ chế độ chờ snapshot.
        this.markPullSettled(!!r?.counts, !tab);
        return r;
      })
      .catch(e => {
        this.markPullSettled(false, !tab);
        console.warn('[GoogleSheetsAdapter] Webhook pull error:', e);
      })
      .finally(() => {
        this.pullInFlight = null;
      });
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

  /**
   * ===== SOON-PUSH: hẹn đẩy sớm thay đổi (đóng cửa sổ restart mất dữ liệu) =====
   * Auto-push điều kiện hiện nhịp 60 phút (tránh lấp quota như trước đây 5p mỗi
   * lần ~34-40 write). Hệ quả: ca vừa xếp (BOT/publish/xếp tay), phiếu công
   * chấm điểm... có thể CHỈ nằm trong bộ nhớ tới 60 phút — backend restart
   * watchdog/redeploy trong cửa sổ đó = mất ca. Giải pháp: khi có cờ dirty,
   * hẹn 1 lượt push gộp sau 45s (debounce đủ dài để gộp đợt mutation, đủ ngắn
   * để mất dữ liệu chỉ còn là cửa sổ ~1 phút), hệ nhàn rỗi tối đa 1 lần chạy.
   */
  private soonPushTimer: ReturnType<typeof setTimeout> | null = null;
  private soonPushRunning = false;

  private markDirtySoonPush(): void {
    this.markMemoryDirty();
    this.scheduleSoonPush();
  }

  /** Memory vừa đổi nhưng chưa chắc cần full-push ngay (vd. đánh dấu đã đọc). */
  private markMemoryDirty(): void {
    try { this.syncService.markDataDirty(); } catch { /* non-fatal */ }
    this.scheduleRuntimeSnapshot();
  }

  private scheduleSoonPush(delayMs = 45_000): void {
    if (!this.isConfigured || this.soonPushTimer || this.soonPushRunning) return;
    this.soonPushTimer = setTimeout(() => {
      this.soonPushTimer = null;
      void this.runSoonPush();
    }, Math.max(10_000, delayMs));
    (this.soonPushTimer as any)?.unref?.(); // không giữ event loop sống vì timer này
  }

  private async runSoonPush(): Promise<void> {
    if (this.soonPushRunning || !this.isConfigured) return;
    // Một full-sync khác đang chạy: để lượt đó gom luôn thay đổi, tránh 2 lượt
    // syncAllData chồng nhau (mỗi lượt ~35-40 write, vượt quota 60/phút).
    if (this.fullSyncInFlight) {
      this.scheduleSoonPush(60_000);
      return;
    }
    const ss = this.syncService;
    if (typeof ss.hasUnpushedChanges === 'function' && !ss.hasUnpushedChanges()) return;
    // Đang pull (tick 10s/webhook): đợi pull xong rồi đẩy cho đồng bộ tự nhiên —
    // hẹn lại ngắn thay vì push trùng nhịp pull (tránh đua ghi/đọc tab).
    if (this.pullInFlight) {
      this.scheduleSoonPush(30_000);
      return;
    }
    this.soonPushRunning = true;
    try {
      await Promise.race([
        ss.syncAllData(this.fallbackAdapter),
        new Promise(r => setTimeout(r, 150_000)),
      ]);
    } catch { /* lỗi: cờ dirty giữ nguyên, auto-push tick 60p sẽ đẩy lại */ }
    finally {
      this.soonPushRunning = false;
      this.lastSheetsWriteAt = new Date().toISOString();
    }
  }

  private scheduleSheetsWrite(task: () => Promise<unknown>, label: string) {
    if (!this.isConfigured) return;
    // Đặt cờ dirty: bộ nhớ vừa có thay đổi chưa chắc đã lên Sheet — auto-push
    // định kỳ (server.ts) thấy cờ là sẽ đẩy đầy đủ các tab cho chắc.
    this.markDirtySoonPush();
    this.pendingSheetsWrites++;
    this.bgWriteChain = this.bgWriteChain
      .then(() => task())
      .then(() => {
        this.lastSheetsWriteAt = new Date().toISOString();
      })
      .catch(err => {
        console.warn(`[GoogleSheetsAdapter] Ghi Sheets nền '${label}' thất bại (sẽ thử lại ở lần sync sau):`, (err as any)?.message || err);
        // Ghi nền rớt (quota/timeout): ghi lại cờ dirty theo thời điểm hiện tại để
        // auto-push kế tiếp chắc chắn nhảy vào sửa lại — nếu không, timestamp dirty
        // cũ có thể nhỏ hơn mốc push đầy đủ khiến hệ thống tưởng đã sạch dữ liệu.
        this.markMemoryDirty();
      })
      .finally(() => {
        this.pendingSheetsWrites = Math.max(0, this.pendingSheetsWrites - 1);
      });
  }

  /**
   * Append bền vững: ghi journal trước rồi mới gọi Google. Hàm trả về sau khi
   * journal đã xuống đĩa; retry/dead-letter do DurableWriteQueue xử lý nền.
   */
  private async enqueueDurableWrite(sheetTitle: string, rows: any[][], label: string): Promise<boolean> {
    if (!this.isConfigured || rows.length === 0) return false;
    // Chỉ snapshot bộ nhớ; append đã có journal riêng nên KHÔNG kéo theo full-push
    // (full-push định kỳ sẽ ghi đè cả tab append-only và tốn quota vô ích).
    this.scheduleRuntimeSnapshot();
    try {
      await this.durableWrites.enqueue(sheetTitle, rows);
      this.lastSheetsWriteAt = new Date().toISOString();
      return true;
    } catch (err: any) {
      // Không chặn nghiệp vụ: snapshot debounce vẫn là lớp bảo hiểm thứ hai.
      console.warn(`[GoogleSheetsAdapter] Không ghi được journal '${label}':`, err?.message || err);
      return false;
    }
  }

  /** Trạng thái ghi nền cho UI poll: còn bao nhiêu tác vụ chưa lên Sheets. */
  public getPendingSheetsWrites() {
    const durable = this.durableWrites?.getStats?.();
    return {
      pendingWrites: this.pendingSheetsWrites + (durable?.pending || 0),
      deadLetters: durable?.deadLetters || 0,
      lastSheetsWriteAt: this.lastSheetsWriteAt,
      durableWrites: durable,
    };
  }

  /** Admin đối soát: đưa các append đã dead-letter trở lại hàng đợi. */
  public async retryDurableDeadLetters(opts: { tabs?: string[] } = {}): Promise<number> {
    return this.durableWrites?.retryDeadLetters?.(opts) || 0;
  }

  /** Cho service khác (vd. phiếu cập nhật ca) ghi append qua journal bền vững. */
  public async appendRowsDurable(sheetTitle: string, rows: any[][], label = 'append'): Promise<boolean> {
    if (!this.isConfigured) return false;
    return this.enqueueDurableWrite(sheetTitle, rows, label);
  }

  /** Full-sync chờ append đang chờ lên Sheet trước, tránh ghi trùng dòng. */
  public async flushDurableWrites(timeoutMs = 5000): Promise<void> {
    if (!this.isConfigured) return;
    try {
      await this.durableWrites.flush(timeoutMs);
    } catch { /* best-effort */ }
  }

  public getDurableDeadLetters(limit = 50) {
    return this.durableWrites?.getDeadLetters?.(limit) || [];
  }

  /** Xả hàng đợi ghi nền (dùng khi tắt server: Render gửi SIGTERM khi sleep/deploy —
   *  không flush thì check-in vừa "thành công" (mới nằm trong bộ nhớ) sẽ mất vĩnh viễn). */
  public async flushSheetsWrites(timeoutMs = 20000): Promise<void> {
    if (!this.isConfigured) return;
    try {
      // Durable queue trước (append đã journal), rồi bg chain (full-sync/push tab).
      await this.durableWrites.flush(Math.min(10_000, timeoutMs));
      await Promise.race([
        this.bgWriteChain,
        new Promise(r => setTimeout(r, Math.max(250, timeoutMs - 10_000))),
      ]);
      if (this.snapshotTimer) {
        clearTimeout(this.snapshotTimer);
        this.snapshotTimer = null;
      }
      await this.persistRuntimeSnapshot();
    } catch (err) {
      console.warn('[GoogleSheetsAdapter] Flush ghi nền khi tắt server lỗi:', (err as any)?.message || err);
    }
  }

  // Dồn full-sync: ghi 1 dòng (append) chạy ngay; ghi nguyên 13 tab (nặng, tốn quota)
  // thì dồn tối đa 1 lần/10s — memory + socket đã tức thì cho UI, Sheet đuổi theo sau.
  private lastFullSyncAt = 0;
  // Chống "bão full-sync": trước đây mỗi mutation/dead-letter đẩy 1 lượt (24 tab)
  // vào chuỗi nền → hàng trăm lượt xếp hàng, đốt hết quota ghi khiến append của
  // hàng đợi bền vững timeout liên tục. Nay chỉ 1 lượt chạy, các yêu cầu phát
  // sinh trong lúc chạy gộp thành 1 lượt bù (full sync luôn đọc bộ nhớ hiện tại).
  private fullSyncInFlight = false;
  private fullSyncDirty = false;
  /** Hẹn chạy lại full-sync khi hàng đợi append đang tồn đọng (tránh tranh quota). */
  private fullSyncDeferTimer: ReturnType<typeof setTimeout> | null = null;

  /** Hoãn full-sync (gộp 1 hẹn duy nhất) — tránh xếp hàng nhiều lượt. */
  private deferFullSync(ms: number) {
    if (this.fullSyncDeferTimer) return;
    this.fullSyncDeferTimer = setTimeout(() => {
      this.fullSyncDeferTimer = null;
      this.scheduleFullSync('deferred');
    }, ms);
    (this.fullSyncDeferTimer as any)?.unref?.();
  }

  private scheduleFullSync(label: string) {
    if (!this.isConfigured) return;
    // Đặt cờ dirty để auto-push biết bộ nhớ chưa chắc đã lên Sheet.
    // KHÔNG hẹn thêm soon-push ở đây: trước đây vừa soon-push 45s vừa full-sync
    // 60s khiến 2 lượt syncAllData (~35-40 write mỗi lượt) chồng nhau, đốt hết
    // quota 60 write/phút và làm thao tác người dùng phải chờ.
    this.markMemoryDirty();
    if (this.fullSyncInFlight) {
      this.fullSyncDirty = true;
      return;
    }
    // Soon-push đang ghi toàn bộ tab: hoãn lượt này để không chồng 2 full-sync.
    if (this.soonPushRunning) {
      this.deferFullSync(60_000);
      return;
    }
    // Hàng đợi append đang tồn đọng: full-sync (24 tab, mỗi tab 1 request) sẽ
    // cạnh tranh khoá ghi/quota với append — hoãn lại, ưu tiên dữ liệu người
    // dùng vừa tạo. Bộ nhớ + snapshot vẫn giữ đủ, không mất dữ liệu.
    const pending = this.durableWrites?.getStats?.().pending ?? 0;
    if (pending > 150) {
      this.deferFullSync(3 * 60_000);
      return;
    }
    // NGẮT MẠCH: Google đang chặn ghi (timeout/abort) → mỗi lượt full-sync là
    // ~14 lệnh ghi treo 25–30s, chỉ làm khoá ghi kéo dài và cạnh tranh với
    // append thật. Hoãn hẳn 5 phút; dữ liệu vẫn ở bộ nhớ + journal trên đĩa.
    const writeErr = String(this.syncService.getWriteStatus?.().lastWriteError || '');
    if (/aborted|SHEETS_TIMEOUT|timed out|socket hang up|ETIMEDOUT|ECONNRESET/i.test(writeErr)) {
      this.deferFullSync(5 * 60_000);
      return;
    }
    this.fullSyncInFlight = true;
    this.fullSyncDirty = false;
    this.pendingSheetsWrites++;
    const run = async () => {
      // Full-sync ghi ~14 tab (mỗi tab 1-2 request): dồn tối thiểu 180s/lượt.
      // Các tab nóng (ca, nghỉ phép, đổi ca) đã push riêng ngay trong request nên
      // full-sync chỉ là lưới an toàn; chạy dày sẽ chiếm hết quota 60 write/phút.
      const minGap = Math.max(10_000, Number(process.env.SHEETS_FULL_SYNC_MIN_INTERVAL_MS) || 180_000);
      const wait = Math.max(0, minGap - (Date.now() - this.lastFullSyncAt));
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      await this.syncService.syncAllData(this.fallbackAdapter);
      this.lastFullSyncAt = Date.now();
    };
    this.bgWriteChain = this.bgWriteChain
      .then(run)
      .then(() => {
        this.lastSheetsWriteAt = new Date().toISOString();
      })
      .catch(err => {
        console.warn(`[GoogleSheetsAdapter] Full-sync nền '${label}' thất bại:`, (err as any)?.message || err);
        // Full-sync nền rớt: ghi lại cờ dirty để auto-push kế tiếp thử sửa lại.
        this.markMemoryDirty();
      })
      .finally(() => {
        this.pendingSheetsWrites = Math.max(0, this.pendingSheetsWrites - 1);
        this.fullSyncInFlight = false;
        if (this.fullSyncDirty) {
          this.fullSyncDirty = false;
          this.scheduleFullSync('coalesced');
        }
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

  /**
   * Lượt đọc LỊCH/CÔNG/ỨNG VIÊN ngay sau khi nạp snapshot có phải chờ pull đầu?
   *
   * Snapshot có thể cũ hơn Sheet (backend downtime) nên trả dữ liệu cũ sẽ làm
   * web hiện ca DRAFT/vắng oan vài giây. Chỉ chờ khi CHƯA có pull TOÀN BỘ nào
   * hoàn tất sau lúc nạp snapshot (pull do tick nền cũng tính — tránh pull đúp).
   */
  private shouldWaitFirstPull(): boolean {
    if (!this.restoredFromSnapshot || this.firstPullAfterRestoreDone) return false;
    const lastFullPull = Number((this.syncService as any).getLastFullPullAtMs?.() || 0);
    if (lastFullPull > this.snapshotRestoredAtMs) {
      this.firstPullAfterRestoreDone = true;
      return false;
    }
    return true;
  }

  private async ensureFreshData(opts: { waitFirstPull?: boolean } = {}) {
    if (!this.isConfigured) return;
    const mustWaitFirstPull = !!opts.waitFirstPull && this.shouldWaitFirstPull();
    const now = Date.now();
    // Đã có pull (từ ticker nền hoặc request khác) trong ~12s qua -> trả bộ nhớ
    // ngay, không tạo thêm lượt đọc Google (mỗi lượt tốn ~5 request, dễ chạm hạn
    // mức 60 request phút khi nhiều Admin/HR cùng mở web).
    const lastPullAt = Math.max(
      this.lastPullTime,
      Number((this.syncService as any).getLastFullPullAtMs?.() || 0),
    );
    if (!mustWaitFirstPull && now - lastPullAt <= 12000) {
      if (this.pullInFlight && this.needsSeed()) {
        try { await this.withTimeout(this.pullInFlight, this.firstPullWaitMs); } catch { /* dùng tạm bộ nhớ */ }
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
    // Ngoại lệ: lần đọc đầu sau snapshot (dữ liệu có thể cũ) -> đợi pull xong (có timeout).
    if (this.needsSeed() || mustWaitFirstPull) {
      try {
        await this.withTimeout(this.pullInFlight, mustWaitFirstPull ? this.firstPullWaitMs : 25000);
      } catch (e) {
        // Hết timeout vẫn phục vụ bằng bộ nhớ hiện có (kể cả rỗng) thay vì treo request.
        // Đánh dấu để các request sau không phải chờ lại (pull vẫn chạy nền).
        if (mustWaitFirstPull) this.firstPullAfterRestoreDone = true;
      }
    }
  }

  public getMockAdapter(): MockSheetsAdapter {
    return this.fallbackAdapter;
  }

  public getStatus() {
    const spreadsheetId = process.env.SPREADSHEET_ID || process.env.GOOGLE_SPREADSHEET_ID || '1UO1UF1d7_YzaCltYt2m9pRnUauGWw873ERqAMxwL-6k';
    const candidateSpreadsheetId = process.env.CANDIDATE_SPREADSHEET_ID || '1rcqEKraSRhr-Tn9qwlhADlkQUei8j65bXeHF_Tmkd38';
    const driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '';
    const syncStatus = this.syncService.getStatus();
    return {
      connected: this.isConfigured,
      mode: this.isConfigured ? 'GOOGLE_SHEETS_LIVE' : 'MOCK_ENGINE_ACTIVE',
      spreadsheetId,
      candidateSpreadsheetId,
      driveFolderId,
      photoStats: this.getPhotoStats(),
      syncService: syncStatus,
      snapshot: {
        loaded: this.snapshotLoaded,
        savedAt: this.snapshotSavedAt,
        writeError: this.snapshotWriteError,
      },
      durableWrites: this.durableWrites?.getStats?.() || null,
      realtime: {
        lastWebhookAt: this.lastWebhookAt ? new Date(this.lastWebhookAt).toISOString() : null,
        lastWebhookTab: this.lastWebhookTab || null,
        coalesceMs: this.webhookCoalesceMs,
      },
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
      await this.enqueueDurableWrite('TAI_KHOAN_NHAN_VIEN', [[
        snapshot.account_id,
        snapshot.employee_id,
        GoogleSheetsSyncService.sheetText(snapshot.phone_normalized),
        snapshot.role,
        snapshot.account_status,
        snapshot.version,
        (snapshot as any).pin_hash || '',
        (snapshot as any).pin_must_change ? 'YES' : '',
        GoogleSheetsSyncService.sheetText((snapshot as any).pin_code || ''),
        GoogleSheetsSyncService.sheetText((snapshot as any).pin_changed_at || ''),
        GoogleSheetsSyncService.sheetText((snapshot as any).pin_rotation_cycle || ''),
      ]], 'TAI_KHOAN_NHAN_VIEN.append');
    }
    return res;
  }

  async setAccountPin(id: string, pinHash: string, mustChange: boolean, actorId: string, pinPlain?: string | null) {
    const updated = await this.fallbackAdapter.setAccountPin(id, pinHash, mustChange, actorId, pinPlain);
    this.scheduleRuntimeSnapshot();
    // PIN nằm cùng tab accounts: chỉ đẩy đúng tab này (2 writes) thay vì full-sync
    // cả hệ thống (~30 writes) — đổi PIN/NV đổi PIN/khóa-mở dồn dập là vượt quota
    // 60 writes/phút của Google Sheets.
    if (this.isConfigured) {
      try {
        await this.syncService.pushAccountsTab(this.fallbackAdapter);
      } catch (err) {
        console.warn('[GoogleSheetsAdapter] Đẩy tab sau đổi PIN thất bại (full-sync nền sẽ thử lại):', (err as any)?.message || err);
        this.scheduleFullSync('PIN.syncAll');
      }
    }
    return updated;
  }

  async markAccountPinMustChange(id: string, actorId: string) {
    const updated = await this.fallbackAdapter.markAccountPinMustChange(id, actorId);
    this.scheduleFullSync('PIN_ROTATION.syncAll');
    return updated;
  }

  async setAccountStatus(id: string, status: 'ACTIVE' | 'LOCKED', actorId: string) {
    const updated = await this.fallbackAdapter.setAccountStatus(id, status, actorId);
    this.scheduleRuntimeSnapshot();
    // Đẩy Sheet NGAY để trạng thái khóa bền vững (restart/pull không hồi ACTIVE).
    if (this.isConfigured) {
      try {
        await this.syncService.pushAccountsTab(this.fallbackAdapter);
      } catch (err) {
        console.warn('[GoogleSheetsAdapter] Đẩy tab sau đổi trạng thái TK thất bại (full-sync nền sẽ thử lại):', (err as any)?.message || err);
        this.scheduleFullSync('TAI_KHOAN_NHAN_VIEN.status');
      }
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
    await this.ensureFreshData({ waitFirstPull: true });
    return this.fallbackAdapter.listEmployees(filter);
  }

  async createEmployee(data: any) {
    const res = await this.fallbackAdapter.createEmployee(data);
    if (this.isConfigured) {
      const snapshot = { ...res };
      await this.enqueueDurableWrite('NHAN_VIEN_MASTER', [[
        snapshot.employee_id,
        snapshot.employee_code,
        snapshot.full_name,
        GoogleSheetsSyncService.sheetText(snapshot.phone_normalized),
        snapshot.employment_status,
        snapshot.group,
        snapshot.default_branch_id,
        snapshot.current_rate_per_hour,
        sheetDateText(snapshot.start_date || (snapshot as any).created_at),
        snapshot.version,
        (snapshot as any).default_shift_code || '',
        sheetDateText((snapshot as any).official_date),
        (snapshot as any).email || '',
      ]], 'NHAN_VIEN_MASTER.append');
    }
    return res;
  }

  async deleteEmployee(id: string) {
    const ok = await this.fallbackAdapter.deleteEmployee(id);
    if (ok) {
      this.scheduleRuntimeSnapshot();
      // Đánh dấu để pull ngay sau đó không đọc lại dòng Sheet cũ.
      try { (this.syncService as any)?.markEmployeeDeleted?.(id); } catch { /* best-effort */ }
      try { (this.syncService as any)?.markAccountDeleted?.(id); } catch { /* best-effort */ }
      if (this.isConfigured) {
        // Xóa ĐỒNG BỘ khỏi Sheet ngay trong request (không đợi full-sync nền).
        try {
          await this.syncService.pushEmployeesTab(this.fallbackAdapter);
          await this.syncService.pushAccountsTab(this.fallbackAdapter);
        } catch (err) {
          console.warn('[GoogleSheetsAdapter] Đẩy tab sau xóa NV thất bại (full-sync nền sẽ thử lại):', (err as any)?.message || err);
          this.scheduleFullSync('NHAN_VIEN_MASTER.delete');
        }
      }
    }
    return ok;
  }

  /** Xóa trực tiếp 1 tài khoản NV (dọn dòng mồ côi không còn hồ sơ nhân viên). */
  async deleteAccount(accountId: string) {
    const ok = await this.fallbackAdapter.deleteAccount(accountId);
    if (ok) {
      this.scheduleRuntimeSnapshot();
      try { (this.syncService as any)?.markAccountDeleted?.(accountId); } catch { /* best-effort */ }
      if (this.isConfigured) {
        try {
          await this.syncService.pushAccountsTab(this.fallbackAdapter);
        } catch (err) {
          console.warn('[GoogleSheetsAdapter] Đẩy tab sau xóa TK thất bại (full-sync nền sẽ thử lại):', (err as any)?.message || err);
          this.scheduleFullSync('TAI_KHOAN_NHAN_VIEN.delete');
        }
      }
    }
    return ok;
  }

  async updateEmployee(id: string, updates: any, expectedVersion: number) {
    // Avatar tab Hồ Sơ: upload Drive trước, chỉ lưu Drive file ID; thất bại thì giữ
    // inline (avatar_photo) để HR vẫn xem được realtime (mirror phiếu bù công).
    if ((updates as any).photo_base64) {
      try {
        const fileName = `EMP_avatar_${id || 'unknown'}_${Date.now()}.jpg`;
        const driveResult = await this.syncService.uploadImageToDrive(fileName, 'image/jpeg', (updates as any).photo_base64);
        if (driveResult?.fileId && !String(driveResult.fileId).startsWith('DRV_')) {
          (updates as any).avatar_drive_id = driveResult.fileId;
          // Drive đã có ảnh thật -> gỡ inline cũ (đỡ tốn bộ nhớ).
          (updates as any).avatar_photo = undefined;
        } else {
          (updates as any).avatar_drive_id = driveResult?.fileId || `DRV_LOCAL_${Date.now()}`;
          (updates as any).avatar_photo = (updates as any).photo_base64;
        }
      } catch (err) {
        console.error('[GoogleSheetsAdapter] Drive upload avatar error:', err);
        (updates as any).avatar_drive_id = `DRV_LOCAL_${Date.now()}`;
        (updates as any).avatar_photo = (updates as any).photo_base64;
      }
      delete (updates as any).photo_base64;
    }
    const res = await this.fallbackAdapter.updateEmployee(id, updates, expectedVersion);
    this.scheduleFullSync('NHAN_VIEN_MASTER.update');
    return res;
  }

  async getStageHistory(employeeId: string) {
    return this.fallbackAdapter.getStageHistory(employeeId);
  }

  async addStageHistory(entry: any) {
    const res = await this.fallbackAdapter.addStageHistory(entry);
    // Lịch sử giai đoạn chỉ lên Sheet qua full-push -> đặt cờ dirty cho auto-push điều kiện.
    this.markDirtySoonPush();
    return res;
  }

  // --- Recruitment ---
  async listCandidates() {
    await this.ensureFreshData({ waitFirstPull: true });
    return this.fallbackAdapter.listCandidates();
  }

  async createCandidate(data: any) {
    const res = await this.fallbackAdapter.createCandidate(data);
    this.scheduleRuntimeSnapshot();
    return res;
  }

  async updateCandidate(submissionId: string, updates: any) {
    const res = await this.fallbackAdapter.updateCandidate(submissionId, updates);
    // Đẩy nền để lịch PV + trạng thái Zalo bền vững qua pull/reload (pull form gốc không có các cột này).
    this.scheduleFullSync('FROM_NHAN_VIEN.update');
    return res;
  }

  /** Xóa cứng ứng viên khỏi hệ thống + đẩy Sheet NGAY (await) để pull sau
   *  không hồi sinh (pattern như xóa phiếu). */
  async deleteCandidate(submissionId: string): Promise<boolean> {
    const ok = await this.fallbackAdapter.deleteCandidate(submissionId);
    if (ok) this.scheduleRuntimeSnapshot();
    if (ok && this.isConfigured) {
      try {
        await this.syncService.pushCandidatesTab(this.fallbackAdapter);
      } catch (err) {
        console.warn('[GoogleSheetsAdapter] Đẩy FROM_NHAN_VIEN sau xóa ứng viên thất bại:', (err as any)?.message || err);
        this.scheduleFullSync('FROM_NHAN_VIEN.delete');
      }
    }
    return ok;
  }

  /** Đẩy tab FROM_NHAN_VIEN lên Sheets NGAY (await): dùng sau xóa lịch PV trùng
   *  để pull nền sau đó không hồi sinh lịch đã xóa. Mock/không cấu hình -> no-op. */
  async pushCandidatesNow(): Promise<number> {
    if (!this.isConfigured) return 0;
    return this.syncService.pushCandidatesTab(this.fallbackAdapter);
  }

  // --- Schedules ---
  async getShiftsForWeek(branchId: string, weekStartDate: string) {
    await this.ensureFreshData({ waitFirstPull: true });
    return this.fallbackAdapter.getShiftsForWeek(branchId, weekStartDate);
  }

  async getShiftsForEmployee(employeeId: string, fromDate: string, toDate: string) {
    await this.ensureFreshData({ waitFirstPull: true });
    return this.fallbackAdapter.getShiftsForEmployee(employeeId, fromDate, toDate);
  }

  async getShiftById(assignmentId: string) {
    return this.fallbackAdapter.getShiftById(assignmentId);
  }

  async createShiftAssignment(assignment: any) {
    const res = await this.fallbackAdapter.createShiftAssignment(assignment);
    // Ghi snapshot NGAY (không chờ debounce 1.5s): ca vừa tạo vẫn sống sót nếu
    // ngay sau đó deploy/restart, kể cả khi Google Sheets đang lỗi tạm thời.
    this.scheduleRuntimeSnapshot(0);
    if (this.isConfigured) {
      try {
        // FIX mất ca sau rebuild: trước đây ca mới chỉ append 1 dòng, trong khi
        // full-sync/publish ghi đè cả tab PHAN_CONG_CA. Hai đường ghi đua nhau
        // có thể xoá dòng vừa append hoặc để lại 2 dòng trùng. Nay mọi mutation
        // ca đi qua CÙNG một coalesced tab push: nếu full-sync đang chạy, request
        // này chờ và kích hoạt đúng 1 lượt push tiếp theo với dữ liệu mới nhất.
        const pushed = await Promise.race([
          this.syncService.pushShiftsTab(this.fallbackAdapter),
          new Promise<number>(r => setTimeout(() => r(0), 15000)),
        ]);
        if (!pushed) throw new Error('PUSH_SHIFTS_FAILED');
      } catch {
        // Rớt mạng/quota: vẫn ghi append bền vững để không mất ca, đồng thời dồn
        // full-sync nền. Pull/push sau đó khử trùng theo NV+ngày+mã.
        const snapshot = { ...res };
        await this.enqueueDurableWrite('PHAN_CONG_CA', [[
          snapshot.assignment_id,
          snapshot.employee_id,
          snapshot.branch_id,
          snapshot.shift_code,
          snapshot.date,
          // Ép TEXT để USER_ENTERED không parse giờ ca thành locale (reload sai giờ mở cổng).
          sheetDateTimeText(snapshot.start_at),
          sheetDateTimeText(snapshot.end_at),
          snapshot.status,
          snapshot.schedule_version,
        ]], 'PHAN_CONG_CA.append-fallback');
        this.scheduleFullSync('PHAN_CONG_CA.create-retry');
      }
    }
    return res;
  }

  async purgeShiftAssignments(ids: string[]) {
    const n = await this.fallbackAdapter.purgeShiftAssignments(ids);
    if (n > 0) this.scheduleRuntimeSnapshot();
    // Đẩy 1 lần duy nhất sau khi dọn xong (không đẩy từng ca).
    if (n > 0 && this.isConfigured) {
      try {
        await Promise.race([
          this.syncService.pushShiftsTab(this.fallbackAdapter).catch(() => 0),
          new Promise<number>(r => setTimeout(() => r(0), 30000)),
        ]);
      } catch {
        this.scheduleFullSync('PHAN_CONG_CA.purge');
      }
    }
    return n;
  }

  async deleteShiftAssignment(id: string) {
    const ok = await this.fallbackAdapter.deleteShiftAssignment(id);
    if (ok) this.scheduleRuntimeSnapshot();
    // Xóa cứng khỏi Sheet ngay để pull sau không hồi sinh ca đã dọn.
    if (ok && this.isConfigured) {
      try {
        await Promise.race([
          this.syncService.pushShiftsTab(this.fallbackAdapter).catch(() => 0),
          new Promise<number>(r => setTimeout(() => r(0), 15000)),
        ]);
      } catch {
        this.scheduleFullSync('PHAN_CONG_CA.delete');
      }
    }
    return ok;
  }

  async updateShiftAssignment(id: string, updates: any) {
    // FIX ca "hồi sinh" sau hủy: hủy/chỉnh ca phần lớn chỉ truyền {status} KHÔNG
    // tăng schedule_version → khi pull đua (đã đọc sheet bản PUBLISHED cũ trước
    // thời điểm hủy) merge theo version gặp HÒA thì bản Sheet cũ thắng = ca hủy
    // xong vài giây sau lại hiện trên lịch, tick 60s còn biến OFF thành ca làm.
    // Nay: mọi cập nhật trạng thái tự tăng schedule_version (caller truyền sẵn
    // version thì giữ nguyên — luồng hoán đổi ca đã bump có chủ đích).
    let effUpdates = updates;
    if (updates && updates.status !== undefined && updates.schedule_version === undefined) {
      try {
        const cur = await this.fallbackAdapter.getShiftById(id).catch(() => null);
        effUpdates = { ...updates, schedule_version: Number((cur as any)?.schedule_version || 0) + 1 };
      } catch { /* không đọc được version hiện tại: dùng updates gốc */ }
    }
    const res = await this.fallbackAdapter.updateShiftAssignment(id, effUpdates);
    this.scheduleRuntimeSnapshot();
    // FIX đổi ca mất lịch sau rebuild/restart: ca chuyển chủ (B đồng ý / HR duyệt)
    // phải bền vững trên Sheets NGAY trong cùng request — giống phiếu (pushSwapsTab
    // đồng bộ). Trước đây chỉ scheduleFullSync nền (debounce 10s + syncAllData nặng):
    // rebuild/restart trước khi flush là phiếu đã APPROVED (push đồng bộ) nhưng ca
    // vẫn chủ cũ trên Sheets → pull sau đó khôi phục ca cũ = "phiếu lưu, lịch không đổi".
    if (this.isConfigured) {
      try {
        const pushed = await Promise.race([
          this.syncService.pushShiftsTab(this.fallbackAdapter),
          new Promise<number>(r => setTimeout(() => r(0), 15000)),
        ]);
        if (!pushed) throw new Error('PUSH_SHIFTS_FAILED');
      } catch {
        // Rớt mạng/quota: dồn full-sync nền thử lại, không chặn response đổi ca.
        this.scheduleFullSync('PHAN_CONG_CA.update-retry');
      }
    }
    return res;
  }

  /**
   * Self-heal hàng loạt ca DRAFT lọt vào tuần đã phát hành: đổi trạng thái ở bộ
   * nhớ rồi đẩy Sheet ĐÚNG 1 lần (không gọi update từng ca để tránh N lần push
   * cả tab PHAN_CONG_CA làm nghẽn quota write).
   */
  async publishShiftAssignments(ids: string[]) {
    const changed = await this.fallbackAdapter.publishShiftAssignments?.(ids) ?? 0;
    if (changed <= 0) return 0;
    this.scheduleRuntimeSnapshot();
    if (this.isConfigured) {
      try {
        const pushed = await Promise.race([
          this.syncService.pushShiftsTab(this.fallbackAdapter),
          new Promise<number>(r => setTimeout(() => r(0), 20000)),
        ]);
        if (!pushed) throw new Error('PUSH_SHIFTS_FAILED');
      } catch {
        this.scheduleFullSync('PHAN_CONG_CA.bulk-publish');
      }
    }
    return changed;
  }

  async deleteShiftsForEmployee(employeeId: string, fromDate?: string): Promise<number> {
    const deletedCount = await this.fallbackAdapter.deleteShiftsForEmployee(employeeId, fromDate);
    if (deletedCount > 0) this.scheduleRuntimeSnapshot();
    if (this.isConfigured && deletedCount > 0) {
      try {
        await this.syncService.pushShiftsTab(this.fallbackAdapter);
      } catch (err) {
        console.warn('[GoogleSheetsAdapter] pushShiftsTab sau khi xóa ca thất bại:', (err as any)?.message || err);
        this.scheduleFullSync('PHAN_CONG_CA.delete');
      }
    }
    return deletedCount;
  }

  // --- Leaves & Swaps ---
  async createLeaveRequest(request: any) {
    const res = await this.fallbackAdapter.createLeaveRequest(request);
    if (this.isConfigured) {
      const snapshot = { ...res };
      // Journal bền vững trước khi trả response; append nền retry nếu Google chậm.
      await this.enqueueDurableWrite('DON_NGHI_PHEP', [[
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
      ]], 'DON_NGHI_PHEP.append');
    }
    return res;
  }

  async listLeaveRequests(branchId?: string, employeeId?: string) {
    await this.ensureFreshData();
    return this.fallbackAdapter.listLeaveRequests(branchId, employeeId);
  }

  async updateLeaveRequest(id: string, status: any, reviewerId: string, note?: string) {
    const res = await this.fallbackAdapter.updateLeaveRequest(id, status, reviewerId, note);
    this.scheduleRuntimeSnapshot();
    // Đẩy tab nghỉ phép đồng bộ để CANCELLED/APPROVED bền vững ngay (đúng ý
    // comment của pushLeavesTab): pull sau không hồi sinh OFF đã hủy.
    if (this.isConfigured) {
      try {
        const pushed = await Promise.race([
          this.syncService.pushLeavesTab(this.fallbackAdapter).catch(() => 0),
          new Promise<number>(r => setTimeout(() => r(0), this.approvalPushWaitMs)),
        ]);
        // Hết thời gian chờ: push vẫn chạy nền (coalesced). Đặt cờ dirty để
        // auto-push/full-sync sau đó đẩy lại nếu lần nền thất bại.
        if (!pushed) this.scheduleFullSync('DON_NGHI_PHEP.update-timeout');
      } catch {
        this.scheduleFullSync('DON_NGHI_PHEP.update-retry');
      }
    } else {
      this.scheduleFullSync('DON_NGHI_PHEP.update');
    }
    return res;
  }

  async createSwapRequest(request: any) {
    const res = await this.fallbackAdapter.createSwapRequest(request);
    if (this.isConfigured) {
      const snapshot = { ...res };
      await this.enqueueDurableWrite('DON_DOI_CA', [[
        snapshot.swap_id,
        snapshot.requester_id,
        snapshot.requester_assignment_id,
        snapshot.target_employee_id,
        snapshot.target_assignment_id,
        snapshot.reason,
        snapshot.status,
        snapshot.approved_by || '',
        snapshot.created_at,
        (snapshot as any).swap_kind || 'EMPLOYEE_SWAP',
        (snapshot as any).bonus_amount || 0,
        (snapshot as any).support_branch_id || '',
        String((snapshot as any).support_date || '').slice(0, 10),
        (snapshot as any).support_shift_code || '',
      ]], 'DON_DOI_CA.append');
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
    this.scheduleRuntimeSnapshot();
    // Đẩy TAB đồng bộ (await, timeout) thay vì full-sync debounce: mọi đổi trạng
    // thái (B nhận/duyệt/từ chối/hủy) bền vững ngay, restart không "reset" phiếu.
    if (this.isConfigured) {
      try {
        const pushed = await Promise.race([
          this.syncService.pushSwapsTab(this.fallbackAdapter).catch(() => 0),
          new Promise<number>(r => setTimeout(() => r(0), this.approvalPushWaitMs)),
        ]);
        if (!pushed) this.scheduleFullSync('DON_DOI_CA.update-timeout');
      } catch { /* best-effort */ }
    }
    return res;
  }

  // --- Attendance ---
  private photoStats = { withPhoto: 0, withoutPhoto: 0, lastMissingAt: null as string | null, lastMissingEvent: null as string | null };

  public getPhotoStats() {
    return { ...this.photoStats };
  }

  async recordAttendanceEvent(event: any) {
    // Truy vết ảnh có tới server không (phân biệt app cũ không gửi vs upload lỗi)
    if (event.photo_base64) {
      this.photoStats.withPhoto++;
    } else if (event.type === 'CHECK_IN' || event.type === 'CHECK_OUT') {
      this.photoStats.withoutPhoto++;
      this.photoStats.lastMissingAt = new Date().toISOString();
      this.photoStats.lastMissingEvent = event.event_id || null;
    }
    // Ảnh check-in/out: luôn thử upload Drive; thất bại thì giữ base64 inline
    // (event_photo) để endpoint /photo phục vụ fallback (mirror phiếu bổ sung
    // công) — trước đây upload lỗi là ảnh mất vĩnh viễn, HR thấy "Chưa có ảnh".
    // Chỉ giữ inline khi upload lỗi (thành công thì bỏ base64 như cũ, nhẹ bộ nhớ).
    if (event.photo_base64) {
      // Lưu đĩa trước mọi nhánh để ảnh sống sót qua restart/rebuild
      // (Drive lỗi hay thành công đều có fallback hiển thị + retry).
      try { saveAttendancePhotoDisk(event.event_id, event.photo_base64); } catch { /* best-effort */ }
      try {
        // Cấu trúc Drive chuẩn theo yêu cầu:
        // 04. ĐIỂM DANH (CHECK-IN + CHECK-OUT) / <Chi nhánh của NV> / YYYY-MM-DD / <Tên nhân viên> / check in.jpg | check out.jpg
        const day = vnDayOfIso(event.client_time) || vnDayOfIso(event.server_received_at)
          || vnDayOfIso(new Date().toISOString());

        // 1. Xác định chi nhánh của nhân viên và lấy đúng folder ID chi nhánh trong 04. ĐIỂM DANH
        const emp = await this.fallbackAdapter.getEmployeeById(event.employee_id).catch(() => null);
        const branchId = event.branch_id || emp?.default_branch_id || 'CN130';
        const branchFolderId = getAttendanceFolderForBranch(branchId);

        // 2. Tên folder nhân viên: ưu tiên tên đầy đủ của nhân viên
        const empName = safeDriveSeg(emp?.full_name || event.employee_id || 'KHONG_NV');
        const segments = [day, empName];

        // 3. Tên 2 hình ảnh tương ứng check-in / check-out
        const fileName = event.type === 'CHECK_IN'
          ? 'check in.jpg'
          : event.type === 'CHECK_OUT'
            ? 'check out.jpg'
            : `${safeDriveSeg(event.type || 'photo')}.jpg`;

        const base64 = String(event.photo_base64).replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64, 'base64');

        // 4. Upload/cập nhật vào đúng thư mục chi nhánh (upsert để đảm bảo đúng 2 ảnh check in + check out)
        const driveResult = typeof (this.syncService as any).upsertBufferToDrivePath === 'function'
          ? await (this.syncService as any).upsertBufferToDrivePath(fileName, 'image/jpeg', buffer, segments, branchFolderId)
          : await (this.syncService as any).uploadBufferToDrivePath(fileName, 'image/jpeg', buffer, segments, branchFolderId);

        if (driveResult?.fileId && !String(driveResult.fileId).startsWith('DRV_')) {
          event.drive_object_id = driveResult.fileId;
        } else {
          // Upload chưa thành công (DRIVE_NOT_CONFIGURED / lỗi mạng -> DRV_*): giữ inline.
          event.drive_object_id = driveResult?.fileId || `DRV_LOCAL_${Date.now()}`;
          (event as any).event_photo = event.photo_base64;
        }
      } catch (err) {
        console.error('[GoogleSheetsAdapter] Drive upload error:', err);
        event.drive_object_id = `DRV_LOCAL_${Date.now()}`;
        (event as any).event_photo = event.photo_base64;
      }
      delete event.photo_base64;
    }

    const res = await this.fallbackAdapter.recordAttendanceEvent(event);

    if (this.isConfigured) {
      const snapshot = { ...res };
      // Journal bền vững TRƯỚC khi trả CONFIRMED: dòng đã xuống đĩa, retry nền
      // nếu Google timeout. Không còn chặn request 12s như append đồng bộ cũ.
      await this.enqueueDurableWrite('SU_KIEN_DIEM_DANH', [[
        snapshot.event_id,
        snapshot.assignment_id,
        snapshot.employee_id,
        snapshot.type,
        // Ép TEXT để USER_ENTERED không parse ISO thành datetime locale
        // (pull đọc lại sai instant -> reload mất check-in/out sau restart).
        sheetDateTimeText(snapshot.server_received_at),
        snapshot.gps_latitude,
        snapshot.gps_longitude,
        snapshot.distance_meters,
        snapshot.gps_status,
        snapshot.drive_object_id || '',
        snapshot.request_id || '',
        (snapshot as any).uniform_pink_ratio ?? '',
        // Giữ giờ máy khách (kèm múi giờ +07:00) để lọc đúng ngày Việt Nam
        sheetDateTimeText((snapshot as any).client_time || ''),
        // Cờ trễ/sớm (phạt lương): Sheet phải lưu, pull mới khôi phục được
        (snapshot as any).is_late ? 'YES' : '',
        (snapshot as any).is_early ? 'YES' : '',
        Number((snapshot as any).minutes_deviation) || 0,
        // Phạt trễ ghi nhận ngay lúc check-in (ràng buộc chặt 5p:30k • 30p:50% • 60p:100%)
        (snapshot as any).fine_tier || 'NONE',
        Number((snapshot as any).fine_amount) || 0,
      ]], 'SU_KIEN_DIEM_DANH.append');
    }

    return res;
  }

  async getAttendanceEvents(employeeId?: string, date?: string) {
    await this.ensureFreshData({ waitFirstPull: true });
    return this.fallbackAdapter.getAttendanceEvents(employeeId, date);
  }

  async updateAttendanceEvent(eventId: string, patch: any) {
    const res = await this.fallbackAdapter.updateAttendanceEvent(eventId, patch);
    // Đẩy Sheet nền có debounce để không spam rewrite tab làm nghẽn quota/khóa queue
    if (this.isConfigured) {
      this.scheduleFullSync('SU_KIEN_DIEM_DANH.update');
    }
    return res;
  }

  async findAttendanceEventByRequestId(requestId: string) {
    return this.fallbackAdapter.findAttendanceEventByRequestId(requestId);
  }

  async deleteAttendanceEvent(eventId: string) {
    const ok = await this.fallbackAdapter.deleteAttendanceEvent(eventId);
    if (ok) {
      this.scheduleRuntimeSnapshot();
      try { (this.syncService as any)?.markAttendanceEventDeleted?.(eventId); } catch { /* best-effort */ }
      if (this.isConfigured) {
        try {
          await this.syncService.pushEventsTab(this.fallbackAdapter);
        } catch (err) {
          console.warn('[GoogleSheetsAdapter] Đẩy tab sau xóa sự kiện thất bại (full-sync nền sẽ thử lại):', (err as any)?.message || err);
          this.scheduleFullSync('SU_KIEN_DIEM_DANH.delete');
        }
      }
    }
    return ok;
  }

  async createAttendanceAdjustment(adj: any) {
    // Ảnh bằng chứng kèm phiếu: upload Drive trước, chỉ lưu Drive file ID (mirror recordAttendanceEvent).
    // FIX HR không thấy ảnh: trước đây chỉ upload khi Sheets configured -> Drive chưa cấu hình
    // hoặc upload lỗi là ảnh bị `delete` mất vĩnh viễn, HR thấy "—". Nay luôn thử upload;
    // thất bại thì giữ base64 inline (evidence_photo) để endpoint /photo phục vụ fallback.
    if (adj.photo_base64) {
      // Lưu ngay xuống đĩa (bền vững qua restart/rebuild)
      if (adj.adjustment_id) {
        saveAdjustmentPhotoDisk(adj.adjustment_id, adj.photo_base64);
      }
      try {
        const day = String(adj.reason || '').match(/(\d{4}-\d{2}-\d{2})/)?.[1]
          || vnDayOfIso(new Date().toISOString());
        const month = day.slice(0, 7);
        const fileName = `ADJ_${safeDriveSeg(adj.adjustment_id || Date.now())}.jpg`;
        const segments = [
          `backup_${month}`,
          'DIEU_CHINH_CONG',
          day,
          safeDriveSeg(adj.employee_id || 'KHONG_NV'),
        ];
        const base64 = String(adj.photo_base64).replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64, 'base64');
        const driveResult = typeof (this.syncService as any).uploadBufferToDrivePath === 'function'
          ? await this.syncService.uploadBufferToDrivePath(fileName, 'image/jpeg', buffer, segments)
          : await this.syncService.uploadImageToDrive(fileName, 'image/jpeg', adj.photo_base64);
        if (driveResult?.fileId && !String(driveResult.fileId).startsWith('DRV_')) {
          adj.evidence_drive_id = driveResult.fileId;
        } else {
          // Upload chưa thành công (DRIVE_NOT_CONFIGURED / lỗi mạng -> DRV_*): giữ inline.
          adj.evidence_drive_id = driveResult?.fileId || `DRV_LOCAL_${Date.now()}`;
          (adj as any).evidence_photo = adj.photo_base64;
        }
      } catch (err) {
        console.error('[GoogleSheetsAdapter] Drive upload evidence error:', err);
        adj.evidence_drive_id = `DRV_LOCAL_${Date.now()}`;
        (adj as any).evidence_photo = adj.photo_base64;
      }
    }
    delete adj.photo_base64;
    const res = await this.fallbackAdapter.createAttendanceAdjustment(adj);
    if (this.isConfigured) {
      const snapshot = { ...res };
      await this.enqueueDurableWrite('DIEU_CHINH_CONG', [[
        snapshot.adjustment_id,
        snapshot.assignment_id,
        snapshot.employee_id,
        snapshot.reason || '',
        snapshot.minutes_approved ?? snapshot.minutes_requested ?? 0,
        snapshot.approver_id || '',
        snapshot.status,
        snapshot.review_note || '',
        (snapshot as any).evidence_drive_id || '',
      ]], 'DIEU_CHINH_CONG.append');
    }
    return res;
  }

  async listAttendanceAdjustments(branchId?: string, employeeId?: string) {
    return this.fallbackAdapter.listAttendanceAdjustments(branchId, employeeId);
  }

  async updateAttendanceAdjustment(id: string, status: any, approverId: string, minutesApproved?: number, note?: string) {
    const res = await this.fallbackAdapter.updateAttendanceAdjustment(id, status, approverId, minutesApproved, note);
    this.scheduleRuntimeSnapshot();
    // Đẩy tab đồng bộ để trạng thái duyệt bền vững ngay (đúng mẫu updateSwapRequest):
    // restart trước flush là mất duyệt, pull sau hồi sinh phiếu cũ.
    if (this.isConfigured) {
      try {
        await Promise.race([
          this.syncService.pushAdjustmentsTab(this.fallbackAdapter).catch(() => 0),
          new Promise<number>(r => setTimeout(() => r(0), 15000)),
        ]);
      } catch {
        this.scheduleFullSync('DIEU_CHINH_CONG.update-retry');
      }
    } else {
      this.scheduleFullSync('DIEU_CHINH_CONG.update');
    }
    return res;
  }

  async deleteAttendanceAdjustment(id: string) {
    const res = await this.fallbackAdapter.deleteAttendanceAdjustment(id);
    if (res) this.scheduleRuntimeSnapshot();
    if (res && this.isConfigured) {
      // Đẩy Sheet ĐỒNG BỘ (await): dòng mất khỏi Sheet trước khi trả response,
      // pull nền sau đó không thể merge hồi sinh phiếu (fix zombie).
      try {
        await this.syncService.pushAdjustmentsTab(this.fallbackAdapter);
      } catch (err) {
        console.warn('[GoogleSheetsAdapter] Đẩy DIEU_CHINH_CONG sau xóa thất bại (full-sync nền sẽ thử lại):', (err as any)?.message || err);
        this.scheduleFullSync('DIEU_CHINH_CONG.delete');
      }
      // Cửa sổ đua: pull nền chen giữa lúc xóa và đẩy xong có thể merge lại —
      // vét lại lần cuối cho chắc.
      const fb: any = this.fallbackAdapter;
      if (Array.isArray(fb.attendanceAdjustments)) {
        fb.attendanceAdjustments = fb.attendanceAdjustments.filter((a: any) => a.adjustment_id !== id);
      }
    } else {
      this.scheduleFullSync('DIEU_CHINH_CONG.delete');
    }
    return res;
  }

  // --- Payroll ---
  async createPayrollRun(run: any, items: any) {
    const res = await this.fallbackAdapter.createPayrollRun(run, items);
    this.scheduleRuntimeSnapshot();
    // FIX publish báo PAYSLIP_NOT_FOUND: phiếu vừa tạo chỉ nằm ở bộ nhớ, restart
    // trước khi full-sync nền flush là mất (dòng KY_LUONG/PHIEU_LUONG trên Sheets
    // chưa có) — đẩy tab phiếu đồng bộ ngay trong request, như phiếu đổi ca.
    if (this.isConfigured) {
      try {
        await Promise.race([
          this.syncService.pushPayslipsTab(this.fallbackAdapter).catch(() => 0),
          new Promise<number>(r => setTimeout(() => r(0), 15000)),
        ]);
      } catch {
        this.scheduleFullSync('KY_LUONG.create-retry');
      }
    } else {
      this.scheduleFullSync('KY_LUONG.create');
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
    this.scheduleFullSync('KY_LUONG.update');
    return res;
  }

  async getPayslipsForEmployee(employeeId: string) {
    return this.fallbackAdapter.getPayslipsForEmployee(employeeId);
  }

  async getPayslipsByRunId(runId: string) {
    return this.fallbackAdapter.getPayslipsByRunId(runId);
  }

  async getPayslipById(itemId: string) {
    return (this.fallbackAdapter as any).getPayslipById(itemId);
  }

  async updatePayslip(itemId: string, updates: any) {
    const res = await (this.fallbackAdapter as any).updatePayslip(itemId, updates);
    // FIX mất chữ ký/trạng thái phiếu sau restart: pushPayslipsTab vốn được thiết
    // kế "dùng sau mọi mutation phiếu lương" nhưng adapter chỉ gọi full-sync nền.
    // Đẩy đồng bộ để ký/phát hành bền vững ngay (đúng ý comment gốc của hàm push).
    if (this.isConfigured) {
      try {
        await Promise.race([
          this.syncService.pushPayslipsTab(this.fallbackAdapter).catch(() => 0),
          new Promise<number>(r => setTimeout(() => r(0), 15000)),
        ]);
      } catch {
        this.scheduleFullSync('PHIEU_LUONG.update-retry');
      }
    } else {
      this.scheduleFullSync('PHIEU_LUONG.update');
    }
    return res;
  }

  // --- Công thức + dữ liệu nhập tay tính lương (Finance): bộ nhớ + full-sync nền ---
  async getPayrollFormula(period: string) {
    return this.fallbackAdapter.getPayrollFormula(period);
  }

  async savePayrollFormula(formula: any) {
    const res = await this.fallbackAdapter.savePayrollFormula(formula);
    this.scheduleFullSync('CONG_THUC_LUONG.save');
    return res;
  }

  async getPayrollInputs(period: string) {
    return this.fallbackAdapter.getPayrollInputs(period);
  }

  async upsertPayrollInput(input: any) {
    const res = await this.fallbackAdapter.upsertPayrollInput(input);
    this.scheduleFullSync('DULIEU_LUONG_KY.save');
    return res;
  }

  // --- Notifications ---
  async createNotification(outbox: any, inboxes: any) {
    const res = await this.fallbackAdapter.createNotification(outbox, inboxes);
    // Ghi nối tiếp vào tab THONGBAO_NV (append-only, không bao giờ reset theo cổng)
    if (this.isConfigured) {
      const rows = (res.inboxes || []).map((inbox: any) => ([
        inbox.inbox_id,
        inbox.notification_id,
        inbox.recipient_id,
        inbox.type || '',
        inbox.title,
        inbox.summary,
        inbox.severity,
        inbox.target_path || '',
        inbox.created_at,
        inbox.read_at ? 'YES' : '',
      ]));
      // Thông báo đã gửi (outbox) → tab THONGBAO_GUI (nguồn tab "Nội dung đã phát" MKT).
      const outboxItem: any = res.outbox || {};
      const outboxRow = [
        outboxItem.notification_id,
        outboxItem.event_id || '',
        outboxItem.dedupe_key || '',
        outboxItem.recipient_id || '',
        outboxItem.type || '',
        outboxItem.severity || '',
        outboxItem.title || '',
        outboxItem.summary || '',
        outboxItem.target_path || '',
        outboxItem.channel || 'IN_APP',
        outboxItem.delivery_status || 'SENT',
        outboxItem.attempts ?? 1,
        outboxItem.last_error || '',
        outboxItem.created_at || '',
      ];
      // Batch 1 lần thay vì append từng dòng (THONGBAO_NV từng timeout 20s khi
      // gửi nhiều người). Journal ghi trước, retry nền nếu quota.
      // KHÔNG push nguyên tab (tab giữ toàn bộ lịch sử — overwrite từ bộ nhớ
      // chỉ-hôm-nay sẽ xóa lịch sử).
      await Promise.all([
        this.enqueueDurableWrite('THONGBAO_NV', rows, 'THONGBAO_NV.append'),
        // Outbox 1 dòng riêng (tab này push-đầy từ bộ nhớ trong full-sync).
        this.enqueueDurableWrite('THONGBAO_GUI', [outboxRow], 'THONGBAO_GUI.append'),
      ]);
    }
    return res;
  }

  async listNotificationOutbox() {
    return this.fallbackAdapter.listNotificationOutbox();
  }

  async getInboxForRecipient(recipientId: string, unreadOnly?: boolean) {
    return this.fallbackAdapter.getInboxForRecipient(recipientId, unreadOnly);
  }

  async markNotificationRead(inboxId: string, recipientId: string) {
    const res = await this.fallbackAdapter.markNotificationRead(inboxId, recipientId);
    // Trạng thái đọc chỉ được đẩy Sheet qua full-push: phải đặt cờ dirty, nếu
    // không với auto-push điều kiện (chỉ push khi có thay đổi) trạng thái đọc
    // sẽ chỉ nằm bộ nhớ cho tới khi có thay đổi khác kích hoạt push.
    this.markMemoryDirty();
    return res;
  }

  async markNotificationAcknowledged(inboxId: string, recipientId: string) {
    const res = await this.fallbackAdapter.markNotificationAcknowledged(inboxId, recipientId);
    this.markMemoryDirty();
    return res;
  }

  async pruneNotifications(beforeIso: string) {
    const res = await this.fallbackAdapter.pruneNotifications(beforeIso);
    this.markMemoryDirty();
    return res;
  }

  // --- Bài TEST (lưu bộ nhớ + full-sync đẩy Sheets nền như các entity khác) ---
  async createTestPaper(paper: any) {
    const res = await this.fallbackAdapter.createTestPaper(paper);
    this.scheduleFullSync('BAI_THI.create');
    return res;
  }

  async listTestPapers() {
    await this.ensureFreshData();
    return this.fallbackAdapter.listTestPapers();
  }

  async getTestPaper(id: string) {
    return this.fallbackAdapter.getTestPaper(id);
  }

  async updateTestPaper(id: string, updates: any) {
    const res = await this.fallbackAdapter.updateTestPaper(id, updates);
    this.scheduleFullSync('BAI_THI.update');
    return res;
  }

  async createTestSubmission(sub: any) {
    const res = await this.fallbackAdapter.createTestSubmission(sub);
    this.scheduleFullSync('BAI_LAM.create');
    return res;
  }

  async listTestSubmissions(testId?: string, employeeId?: string) {
    await this.ensureFreshData();
    return this.fallbackAdapter.listTestSubmissions(testId, employeeId);
  }

  async updateTestSubmission(id: string, updates: any) {
    const res = await this.fallbackAdapter.updateTestSubmission(id, updates);
    this.scheduleFullSync('BAI_LAM.update');
    return res;
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
      await this.enqueueDurableWrite('AUDIT_LOG', [[
        snapshot.log_id,
        snapshot.timestamp,
        snapshot.actor_id,
        snapshot.actor_role,
        snapshot.action,
        snapshot.target_entity,
        snapshot.target_id,
        typeof snapshot.details === 'string' ? snapshot.details : JSON.stringify(snapshot.details || {}),
      ]], 'AUDIT_LOG.append');
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
      await this.enqueueDurableWrite('ADMIN_ACCOUNTS', [[
        snapshot.admin_id,
        snapshot.username,
        snapshot.password_hash || '123456',
        snapshot.full_name,
        snapshot.role,
        snapshot.branch_scope || '*',
        (snapshot as any).is_active === false ? 'LOCKED' : 'ACTIVE',
        snapshot.created_at,
      ]], 'ADMIN_ACCOUNTS.append');
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
    if (ok) this.scheduleRuntimeSnapshot();
    if (ok && this.isConfigured) {
      try {
        await this.syncService.pushAdminsTab(this.fallbackAdapter);
      } catch (err) {
        console.warn('[GoogleSheetsAdapter] Đẩy tab sau xóa TK nội bộ thất bại (full-sync nền sẽ thử lại):', (err as any)?.message || err);
        this.scheduleFullSync('ADMIN_ACCOUNTS.delete');
      }
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
    const res = await this.fallbackAdapter.updateShiftTemplates(templates);
    // Mock đã mirror vào systemSettings — đẩy nền lên tab CAU_HINH_HE_THONG.
    if (this.isConfigured) {
      this.scheduleSheetsWrite(async () => {
        const settings = await this.fallbackAdapter.getSystemSettings();
        await this.syncService.syncSystemSettingsToSheet(settings);
      }, 'SETTINGS.templates');
    }
    return res;
  }

  async getPolicies() {
    await this.ensureFreshData();
    return this.fallbackAdapter.getPolicies();
  }

  async updatePolicies(policies: any) {
    const res = await this.fallbackAdapter.updatePolicies(policies);
    if (this.isConfigured) {
      this.scheduleSheetsWrite(async () => {
        const settings = await this.fallbackAdapter.getSystemSettings();
        await this.syncService.syncSystemSettingsToSheet(settings);
      }, 'SETTINGS.policies');
    }
    return res;
  }

  async getMaintenance() {
    await this.ensureFreshData();
    // Sau boot, pull đầu chưa xong mà đọc ngay sẽ trả seed OFF -> UI tưởng đã
    // TẮT bảo trì (reload là "mất"). Đợi pull cấu hình xong (có timeout).
    await this.waitForSettingsPull().catch(() => null);
    return this.fallbackAdapter.getMaintenance();
  }

  /** Chờ tab CAU_HINH_HE_THONG được pull lần đầu (tối đa ~20s). */
  public async waitForSettingsPull(timeoutMs = 20000): Promise<void> {
    if (!this.isConfigured) return;
    const svc = this.syncService as any;
    if (svc?.lastSettingsPullAt) return;
    // Pull đã từng chạy xong mà vẫn không có tab cấu hình -> Sheet trống thật,
    // đợi nữa cũng vô ích, trả memory luôn.
    if ((this as any).startupPullDone && !(this as any).pullInFlight) return;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const p = (this as any).pullInFlight;
        if (p) await Promise.race([p, new Promise(r => setTimeout(r, 2000))]);
        else await new Promise(r => setTimeout(r, 500));
      } catch { /* thử lại */ }
      if ((this.syncService as any)?.lastSettingsPullAt) return;
      if ((this as any).startupPullDone && !(this as any).pullInFlight) return;
    }
  }

  async updateMaintenance(maintenance: any) {
    const res = await this.fallbackAdapter.updateMaintenance(maintenance);
    let sheetPersisted = false;
    if (this.isConfigured) {
      // Cờ bảo trì sống qua restart nhờ Sheet: ghi ĐỒNG BỘ (await, timeout 12s)
      // thay vì fire-and-forget — bật xong restart ngay cũng không mất.
      try {
        const settings = await this.fallbackAdapter.getSystemSettings();
        sheetPersisted = await Promise.race([
          this.syncService.syncSystemSettingsToSheet(settings).catch(() => false),
          new Promise<false>(r => setTimeout(() => r(false), 12000)),
        ]);
      } catch { sheetPersisted = false; }
      if (!sheetPersisted) {
        // Ghi đồng bộ rớt -> xếp hàng nền thử lại (không chặn response).
        this.scheduleSheetsWrite(async () => {
          const settings = await this.fallbackAdapter.getSystemSettings();
          await this.syncService.syncSystemSettingsToSheet(settings);
        }, 'SETTINGS.maintenance-retry');
      }
    } else {
      sheetPersisted = true; // mock/dev: bộ nhớ là nguồn thật
    }
    return { ...res, _sheetPersisted: sheetPersisted };
  }

  async getBackupSnapshots() {
    return this.fallbackAdapter.getBackupSnapshots();
  }

  async createBackupSnapshot(name?: string) {
    const res = await this.fallbackAdapter.createBackupSnapshot(name);
    // Đồng bộ list snapshot lên tab SNAPSHOT_SAOLUU (sau đây tab "Sao lưu & Phục
    // hồi" không còn mất dữ liệu khi restart).
    this.scheduleFullSync('SNAPSHOT_SAOLUU.create');
    return res;
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
