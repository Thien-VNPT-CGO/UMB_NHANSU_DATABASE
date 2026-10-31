/**
 * Upload file lên Google Drive thông qua Google Apps Script Webhook.
 *
 * Có những môi trường không thể cấp quyền ghi Drive cho Service Account (Gmail
 * cá nhân) và chưa tạo được OAuth2 client. Khi đó có thể deploy 1 Apps Script
 * chạy dưới quyền chủ thư mục (umbomilk@gmail.com) và đặt URL vào
 * GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL. Backend gửi file base64 sang webhook, script
 * ghi file vào đúng folderId rồi trả { fileId, webViewLink }.
 */

export interface DriveWebhookUploadInput {
  /** Thư mục gốc (backend đã xác định: thư mục chi nhánh / thư mục gốc Drive). */
  folderId: string;
  /** Các cấp thư mục con cần tạo/tìm bên dưới folderId (vd: ngày, tên NV). */
  segments?: string[];
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

export interface DriveWebhookUploadResult {
  fileId: string;
  webViewLink?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export function getDriveUploadWebhookUrl(): string {
  return String(process.env.GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL || '').trim();
}

/**
 * Trả null khi webhook chưa cấu hình hoặc upload lỗi (caller tự fallback sang
 * Drive API). Không bao giờ throw để không làm hỏng luồng điểm danh.
 */
export async function uploadBufferViaDriveWebhook(
  input: DriveWebhookUploadInput,
): Promise<DriveWebhookUploadResult | null> {
  const url = getDriveUploadWebhookUrl();
  if (!url || !input.folderId || !input.buffer?.length) return null;

  const timeoutMs = Math.max(5_000, Number(process.env.GOOGLE_DRIVE_WEBHOOK_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const secret = String(process.env.GOOGLE_DRIVE_WEBHOOK_SECRET || '').trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'X-Webhook-Secret': secret } : {}),
      },
      body: JSON.stringify({
        folderId: input.folderId,
        segments: Array.isArray(input.segments) ? input.segments.filter(Boolean) : [],
        fileName: input.fileName,
        mimeType: input.mimeType,
        base64: input.buffer.toString('base64'),
        ...(secret ? { secret } : {}),
      }),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.warn(`[DriveWebhook] Upload "${input.fileName}" lỗi HTTP ${res.status}: ${text.slice(0, 300)}`);
      return null;
    }
    let data: any = null;
    try { data = JSON.parse(text); } catch { data = null; }
    const fileId = String(data?.fileId || data?.file_id || data?.id || '').trim();
    if (!fileId) {
      console.warn(`[DriveWebhook] Webhook không trả fileId cho "${input.fileName}": ${text.slice(0, 300)}`);
      return null;
    }
    return {
      fileId,
      webViewLink: String(data?.webViewLink || data?.web_view_link || data?.url || '').trim() || undefined,
    };
  } catch (err: any) {
    const msg = err?.name === 'AbortError' ? `quá ${timeoutMs}ms` : (err?.message || String(err));
    console.warn(`[DriveWebhook] Upload "${input.fileName}" thất bại: ${msg}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tải file từ Drive qua webhook. Cần thiết khi backend KHÔNG có quyền đọc file
 * do webhook tạo ra (chỉ cấu hình GAS, không có OAuth2/Shared Drive).
 * Trả null nếu webhook chưa cấu hình hoặc lỗi.
 */
export async function downloadBufferViaDriveWebhook(
  fileId: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const url = getDriveUploadWebhookUrl();
  if (!url || !fileId) return null;

  const timeoutMs = Math.max(5_000, Number(process.env.GOOGLE_DRIVE_WEBHOOK_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const secret = String(process.env.GOOGLE_DRIVE_WEBHOOK_SECRET || '').trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'X-Webhook-Secret': secret } : {}),
      },
      body: JSON.stringify({ action: 'download', fileId, ...(secret ? { secret } : {}) }),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) return null;
    let data: any = null;
    try { data = JSON.parse(text); } catch { return null; }
    const base64 = String(data?.base64 || '').replace(/^data:[^;,]+;base64,/, '');
    if (!base64) return null;
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) return null;
    return { buffer, mimeType: String(data?.mimeType || 'image/jpeg') };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
