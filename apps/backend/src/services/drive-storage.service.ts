import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { google, drive_v3 } from 'googleapis';
import {
  getAttendanceBranchLabel,
  getAttendanceFolderForBranch,
  getAttendanceRootFolder,
} from '../config/drive-folders.js';
import {
  createDriveOAuthClient,
  describeDriveAuth,
  type GoogleDriveAuthMode,
} from './google-drive-auth.js';
import { uploadBufferViaDriveWebhook, downloadBufferViaDriveWebhook } from './drive-upload-webhook.js';

/**
 * Dịch vụ lưu ảnh trên Google Drive — thay thế hoàn toàn Apps Script.
 *
 * Điều kiện để upload không lỗi "Service Accounts do not have storage quota":
 *  - Dùng Google Shared Drive (khuyến nghị), thêm Service Account làm Content Manager.
 *  - Hoặc dùng OAuth2 refresh token của tài khoản Gmail nếu không có Workspace.
 *
 * Không lưu ảnh vào PostgreSQL. DB chỉ lưu drive_file_id + metadata.
 */

export interface DriveFileRef {
  fileId: string;
  viewUrl: string;
  name: string;
}

function parseDataUrl(input: string): { mime: string; buffer: Buffer } | null {
  const s = String(input || '');
  if (!s) return null;
  const m = s.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.*)$/s);
  try {
    if (m) {
      const buffer = Buffer.from(m[2], 'base64');
      return buffer.length ? { mime: m[1], buffer } : null;
    }
    const buffer = Buffer.from(s.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    return buffer.length ? { mime: 'image/jpeg', buffer } : null;
  } catch {
    return null;
  }
}

function vnDayOfIso(input: unknown): string {
  const t = Date.parse(String(input || ''));
  if (!Number.isFinite(t)) return '';
  return new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
}

function safeSegment(value: unknown, fallback = 'KHONG_XAC_DINH'): string {
  return String(value ?? '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || fallback;
}

function loadServiceAccount(): { email: string; key: string } | null {
  let email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_PRIVATE_KEY;

  let jsonStr = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (jsonStr && !jsonStr.startsWith('{') && /^[A-Za-z0-9+/=]+$/.test(jsonStr)) {
    try { jsonStr = Buffer.from(jsonStr, 'base64').toString('utf8'); } catch { /* ignore */ }
  }

  if (!jsonStr && (!email || !key)) {
    const candidates = [
      process.env.GOOGLE_SERVICE_ACCOUNT_FILE,
      path.resolve(process.cwd(), 'key.json'),
      path.resolve(__dirname, '../../../../key.json'),
      path.resolve(process.cwd(), 'data/service-account.json'),
      '/app/data/service-account.json',
    ].filter(Boolean) as string[];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          jsonStr = fs.readFileSync(p, 'utf8');
          console.log(`[DriveStorage] Đã nạp credentials từ file: ${p}`);
          break;
        } catch { /* ignore */ }
      }
    }
  }

  if (jsonStr) {
    try {
      const creds = JSON.parse(jsonStr);
      if (creds.client_email && creds.private_key) {
        email = creds.client_email;
        key = creds.private_key;
      }
    } catch (err: any) {
      console.error('[DriveStorage] Không parse được GOOGLE_SERVICE_ACCOUNT_JSON:', err?.message || err);
      return null;
    }
  }

  if (!email || !key) return null;
  return { email, key: key.includes('\\n') ? key.replace(/\\n/g, '\n') : key };
}

export class DriveStorageService {
  private drive: drive_v3.Drive | null = null;
  private authError: string | null = null;
  private authMode: GoogleDriveAuthMode = 'none';
  private authAccount = '';
  private folderCache = new Map<string, string>();
  private branchFolderCache = new Map<string, string>();
  private readonly rootFolderId = String(process.env.GOOGLE_DRIVE_FOLDER_ID || '');
  private readonly maxDownloadBytes = Math.max(1, Number(process.env.DRIVE_MAX_DOWNLOAD_MB) || 20) * 1024 * 1024;

  constructor() {
    // Ưu tiên OAuth2 (Gmail sở hữu thư mục) vì Service Account không có quota
    // trên My Drive. Chưa cấu hình OAuth thì giữ nguyên Service Account.
    const oauth = createDriveOAuthClient(['https://www.googleapis.com/auth/drive']);
    if (oauth) {
      this.drive = google.drive({ version: 'v3', auth: oauth });
      this.authMode = 'oauth';
      this.authAccount = String(process.env.GOOGLE_OAUTH_ACCOUNT_EMAIL || 'OAuth2 Gmail');
      console.log(`[DriveStorage] Drive API qua OAuth2 sẵn sàng (${this.authAccount})`);
      return;
    }

    const creds = loadServiceAccount();
    if (!creds) {
      this.authError = 'Chưa cấu hình GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY (hoặc GOOGLE_OAUTH_*). Ảnh sẽ chỉ lưu tạm trên đĩa VPS.';
      console.warn('[DriveStorage]', this.authError);
      return;
    }
    try {
      const auth = new google.auth.JWT({
        email: creds.email,
        key: creds.key,
        scopes: ['https://www.googleapis.com/auth/drive'],
      });
      this.drive = google.drive({ version: 'v3', auth });
      this.authMode = 'service-account';
      this.authAccount = creds.email;
      console.log(`[DriveStorage] Drive API sẵn sàng cho: ${creds.email}`);
    } catch (err: any) {
      this.authError = `Lỗi khởi tạo JWT: ${err?.message || err}`;
      console.error('[DriveStorage]', this.authError);
    }
  }

  public isConfigured(): boolean {
    return !!this.drive;
  }

  public getStatus() {
    return {
      configured: this.isConfigured(),
      authError: this.authError,
      authMode: this.authMode,
      authAccount: this.authAccount || null,
      authLabel: describeDriveAuth(this.authMode, this.authAccount),
      rootFolderId: this.rootFolderId || null,
      attendanceRootFolderId: getAttendanceRootFolder() || null,
      webhookConfigured: !!String(process.env.GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL || '').trim(),
      mode: this.isConfigured()
        ? (this.authMode === 'oauth'
          ? 'oauth'
          : (process.env.GOOGLE_DRIVE_SHARED_DRIVE ? 'shared-drive' : 'drive'))
        : 'disabled',
    };
  }

  public getViewUrl(fileId: string): string {
    return fileId ? `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view` : '';
  }

  /** Tạo/tìm folder theo tên trong parent; cache theo parent + tên. */
  public async ensureFolder(name: string, parentId?: string): Promise<string> {
    if (!this.drive) throw new Error('DRIVE_NOT_CONFIGURED');
    const clean = safeSegment(name);
    const parent = String(parentId || this.rootFolderId || '');
    const cacheKey = `${parent}/${clean}`;
    const cached = this.folderCache.get(cacheKey);
    if (cached) return cached;

    const escaped = clean.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = [
      "mimeType = 'application/vnd.google-apps.folder'",
      'trashed = false',
      `name = '${escaped}'`,
      parent ? `'${parent}' in parents` : '',
    ].filter(Boolean).join(' and ');

    const listed = await this.drive.files.list({
      q,
      fields: 'files(id,name)',
      pageSize: 5,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    } as any);
    const existing = listed.data.files?.[0]?.id;
    if (existing) {
      this.folderCache.set(cacheKey, existing);
      return existing;
    }

    const created = await this.drive.files.create({
      requestBody: {
        name: clean,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parent ? { parents: [parent] } : {}),
      },
      fields: 'id',
      supportsAllDrives: true,
    } as any);
    const id = String(created.data.id || '');
    if (!id) throw new Error('DRIVE_FOLDER_CREATE_FAILED');
    this.folderCache.set(cacheKey, id);
    return id;
  }

  public async ensureFolderPath(segments: string[], rootId?: string): Promise<string> {
    let parent = String(rootId || this.rootFolderId || '');
    for (const segment of segments || []) {
      const clean = String(segment || '').trim();
      if (!clean) continue;
      parent = await this.ensureFolder(clean, parent || undefined);
    }
    return parent;
  }

  /** Kiểm tra tài khoản hiện tại có quyền thêm file/folder con vào folder không. */
  private async canAddChildren(folderId: string): Promise<boolean | null> {
    if (!this.drive || !folderId) return false;
    try {
      const meta = await this.drive.files.get({
        fileId: folderId,
        fields: 'id, capabilities(canAddChildren)',
        supportsAllDrives: true,
      } as any);
      const can = (meta.data as any)?.capabilities?.canAddChildren;
      return typeof can === 'boolean' ? can : null;
    } catch (err: any) {
      const status = Number(err?.response?.status ?? err?.code);
      // 404: folder không tồn tại / không được chia sẻ -> chắc chắn không dùng được.
      if (status === 404) return false;
      // 403 có thể do chỉ có quyền đọc; để null = "không rõ", vẫn thử upload.
      return null;
    }
  }

  /**
   * Xác định folder chi nhánh thực sự ghi được.
   *
   * Thứ tự: folder chi nhánh đã cấu hình (env/mã nguồn) -> nếu không ghi được
   * thì tạo thư mục chi nhánh dưới "04. ĐIỂM DANH". Tránh trường hợp ID cấu
   * hình thuộc Drive khác khiến mọi ảnh rơi về DRV_LOCAL.
   */
  public async resolveAttendanceBranchFolder(branchId?: string): Promise<string> {
    const cacheKey = String(branchId || 'DEFAULT').trim().toUpperCase() || 'DEFAULT';
    const cached = this.branchFolderCache.get(cacheKey);
    if (cached) return cached;

    const configured = getAttendanceFolderForBranch(branchId);
    const root = getAttendanceRootFolder();
    const candidates = Array.from(new Set([configured, root].filter(Boolean)));

    for (const id of candidates) {
      const can = await this.canAddChildren(id);
      if (can === true) {
        this.branchFolderCache.set(cacheKey, id);
        return id;
      }
    }

    // Không ghi được vào ID cấu hình -> tạo thư mục chi nhánh dưới thư mục gốc.
    if (root && await this.canAddChildren(root) !== false) {
      try {
        const branchFolder = await this.ensureFolder(getAttendanceBranchLabel(branchId), root);
        if (branchFolder) {
          this.branchFolderCache.set(cacheKey, branchFolder);
          return branchFolder;
        }
      } catch (err: any) {
        console.warn('[DriveStorage] Không tạo được thư mục chi nhánh:', err?.message || err);
      }
    }

    return configured || root;
  }

  public async findFileByName(name: string, parentId: string): Promise<string | null> {
    if (!this.drive) return null;
    const escaped = safeSegment(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = `name = '${escaped}' and trashed = false and '${parentId}' in parents`;
    const listed = await this.drive.files.list({
      q,
      fields: 'files(id,name)',
      pageSize: 5,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    } as any);
    return listed.data.files?.[0]?.id || null;
  }

  /**
   * Upload buffer. upsert=true: ghi đè file cùng tên trong folder (avatar/ảnh cố định).
   * upsert=false: luôn tạo file mới (ảnh chấm công có eventId duy nhất).
   */
  public async uploadBuffer(
    fileName: string,
    mimeType: string,
    buffer: Buffer,
    segments: string[],
    rootId?: string,
    opts: { upsert?: boolean; appProperties?: Record<string, string> } = {},
  ): Promise<DriveFileRef> {
    const name = safeSegment(fileName, `file_${Date.now()}.jpg`);

    // Webhook (nếu cấu hình) chạy dưới quyền CHỦ thư mục: tự tạo cây thư mục
    // con và ghi file — dùng được cả khi Service Account hết quota.
    const webhookRoot = String(rootId || this.rootFolderId || '').trim();
    if (webhookRoot) {
      const webhook = await uploadBufferViaDriveWebhook({
        folderId: webhookRoot,
        segments,
        fileName: name,
        mimeType,
        buffer,
      });
      if (webhook?.fileId) {
        return { fileId: webhook.fileId, viewUrl: webhook.webViewLink || this.getViewUrl(webhook.fileId), name };
      }
    }

    if (!this.drive) throw new Error('DRIVE_NOT_CONFIGURED');
    const parent = await this.ensureFolderPath(segments, rootId);
    if (!parent) throw new Error('DRIVE_FOLDER_NOT_FOUND');

    let fileId = '';

    if (opts.upsert) {
      const existing = await this.findFileByName(name, parent).catch(() => null);
      if (existing) {
        const updated = await this.drive.files.update({
          fileId: existing,
          media: { mimeType, body: Readable.from(buffer) },
          fields: 'id, webViewLink',
          supportsAllDrives: true,
        } as any);
        fileId = String(updated.data.id || existing);
        return { fileId, viewUrl: updated.data.webViewLink || this.getViewUrl(fileId), name };
      }
    }

    try {
      const created = await this.drive.files.create({
        requestBody: {
          name,
          parents: [parent],
          ...(opts.appProperties ? { appProperties: opts.appProperties } : {}),
        },
        media: { mimeType, body: Readable.from(buffer) },
        fields: 'id, webViewLink',
        supportsAllDrives: true,
      } as any);
      fileId = String(created.data.id || '');
      if (!fileId) throw new Error('DRIVE_UPLOAD_FAILED');
      return { fileId, viewUrl: created.data.webViewLink || this.getViewUrl(fileId), name };
    } catch (err: any) {
      const errMsg = String(err?.message || err);
      if (errMsg.includes('storage quota') || errMsg.includes('Service Accounts do not have storage quota')) {
        console.warn(`[DriveStorageService] Service Account có quota 0 byte trên Drive cá nhân. Hãy thêm GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL hoặc dùng Bộ nhớ dùng chung (Shared Drive).`);
      }
      throw err;
    }
  }

  public async uploadDataUrl(
    fileName: string,
    dataUrl: string,
    segments: string[],
    rootId?: string,
    opts: { upsert?: boolean; appProperties?: Record<string, string> } = {},
  ): Promise<DriveFileRef> {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) throw new Error('INVALID_IMAGE_DATA');
    return this.uploadBuffer(fileName, parsed.mime, parsed.buffer, segments, rootId, opts);
  }

  /** Upload ảnh check-in/out theo cây: Chi nhánh / Ngày / Nhân viên / file. */
  public async uploadAttendancePhoto(
    event: any,
    employeeName: string,
  ): Promise<DriveFileRef> {
    const day = vnDayOfIso(event.client_time) || vnDayOfIso(event.server_received_at) || vnDayOfIso(new Date().toISOString());
    const branchId = String(event.branch_id || 'CN130');
    const rootId = await this.resolveAttendanceBranchFolder(branchId);
    const type = String(event.type || 'PHOTO');
    const fileName = type === 'CHECK_IN'
      ? 'check in.jpg'
      : type === 'CHECK_OUT'
        ? 'check out.jpg'
        : `${safeSegment(type.toLowerCase(), 'photo')}.jpg`;
    const segments = [day, safeSegment(employeeName, safeSegment(event.employee_id, 'KHONG_NV'))];
    const parsed = parseDataUrl(event.photo_base64);
    if (!parsed) throw new Error('INVALID_IMAGE_DATA');
    return this.uploadBuffer(fileName, parsed.mime, parsed.buffer, segments, rootId, {
      upsert: true,
      appProperties: { event_id: String(event.event_id || ''), employee_id: String(event.employee_id || '') },
    });
  }

  /** Upload ảnh bằng chứng điều chỉnh công. */
  public async uploadAdjustmentPhoto(adj: any, employeeName: string): Promise<DriveFileRef> {
    const day = vnDayOfIso(adj.created_at) || vnDayOfIso(new Date().toISOString());
    const parsed = parseDataUrl(adj.photo_base64);
    if (!parsed) throw new Error('INVALID_IMAGE_DATA');
    const fileName = `adjustment_${safeSegment(adj.adjustment_id, 'adj')}.jpg`;
    return this.uploadBuffer(fileName, parsed.mime, parsed.buffer, ['DIEU_CHINH_CONG', day, safeSegment(employeeName, adj.employee_id)], undefined, {
      upsert: true,
      appProperties: { adjustment_id: String(adj.adjustment_id || '') },
    });
  }

  /** Upload avatar nhân viên (ghi đè 1 file/employee). */
  public async uploadAvatar(employeeId: string, dataUrl: string): Promise<DriveFileRef> {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) throw new Error('INVALID_IMAGE_DATA');
    return this.uploadBuffer('avatar.jpg', parsed.mime, parsed.buffer, ['AVATARS', safeSegment(employeeId, 'KHONG_NV')], undefined, {
      upsert: true,
      appProperties: { employee_id: String(employeeId || '') },
    });
  }

  /** Tải file Drive về buffer (dùng cho proxy ảnh có xác thực). */
  public async downloadFile(fileId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!fileId) throw new Error('DRIVE_FILE_NOT_AVAILABLE');
    if (!this.drive) {
      // Chỉ có webhook: nhờ chính GAS đọc file (chạy dưới quyền chủ thư mục).
      const dl = await downloadBufferViaDriveWebhook(fileId);
      if (dl) return dl;
      throw new Error('DRIVE_NOT_CONFIGURED');
    }
    try {
      const meta = await this.drive.files.get({
        fileId,
        fields: 'id,name,mimeType,size',
        supportsAllDrives: true,
      } as any);
      const size = Number(meta.data.size || 0);
      if (size > this.maxDownloadBytes) {
        throw new Error(`DRIVE_FILE_TOO_LARGE:${size}`);
      }
      const res = await this.drive.files.get({
        fileId,
        alt: 'media',
        supportsAllDrives: true,
      } as any, { responseType: 'stream' } as any);

      const stream = res.data as unknown as Readable;
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of stream) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (total > this.maxDownloadBytes) throw new Error('DRIVE_FILE_TOO_LARGE');
        chunks.push(buf);
      }
      return {
        buffer: Buffer.concat(chunks),
        mimeType: String(meta.data.mimeType || 'image/jpeg'),
      };
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.startsWith('DRIVE_FILE_TOO_LARGE')) throw err;
      // Drive API không đọc được (file thuộc tài khoản khác) -> thử webhook.
      const dl = await downloadBufferViaDriveWebhook(fileId);
      if (dl) return dl;
      throw err;
    }
  }

  public async deleteFile(fileId: string): Promise<boolean> {
    if (!this.drive) return false;
    try {
      await this.drive.files.delete({ fileId, supportsAllDrives: true } as any);
      return true;
    } catch {
      return false;
    }
  }

  /** Liệt kê toàn bộ file/folder con trực tiếp của 1 thư mục (có phân trang). */
  public async listChildren(parentId: string): Promise<Array<{ id: string; name: string; mimeType: string }>> {
    if (!this.drive || !parentId) return [];
    const out: Array<{ id: string; name: string; mimeType: string }> = [];
    let pageToken: string | undefined;
    do {
      const res: any = await this.drive.files.list({
        q: `'${parentId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id,name,mimeType)',
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      } as any);
      for (const f of res.data.files || []) {
        out.push({ id: String(f.id), name: String(f.name || ''), mimeType: String(f.mimeType || '') });
      }
      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);
    return out;
  }

  /** Xóa đệ quy 1 thư mục (Drive yêu cầu folder rỗng trước khi xóa). */
  public async deleteFolderRecursive(folderId: string): Promise<boolean> {
    if (!this.drive || !folderId) return false;
    try {
      const children = await this.listChildren(folderId);
      for (const child of children) {
        if (child.mimeType === 'application/vnd.google-apps.folder') {
          await this.deleteFolderRecursive(child.id);
        } else {
          await this.deleteFile(child.id);
        }
      }
      return await this.deleteFile(folderId);
    } catch {
      return false;
    }
  }

  /**
   * Giữ lại `keep` mục mới nhất (theo tên) trong 1 thư mục, xóa phần cũ hơn.
   * Tên folder backup là ngày/tuần/tháng dạng YYYY-... nên thứ tự tên = thời gian.
   */
  public async pruneKeepNewest(parentId: string, keep: number): Promise<number> {
    if (!this.drive || !parentId) return 0;
    const children = (await this.listChildren(parentId))
      .filter(c => c.mimeType === 'application/vnd.google-apps.folder')
      .sort((a, b) => a.name.localeCompare(b.name));
    const excess = Math.max(0, children.length - Math.max(1, keep));
    let removed = 0;
    for (const folder of children.slice(0, excess)) {
      if (await this.deleteFolderRecursive(folder.id)) removed++;
    }
    return removed;
  }
}

let singleton: DriveStorageService | null = null;

export function getDriveStorage(): DriveStorageService {
  if (!singleton) singleton = new DriveStorageService();
  return singleton;
}
