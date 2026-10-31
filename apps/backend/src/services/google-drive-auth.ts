import { google, Auth } from 'googleapis';

/**
 * Xác thực Google Drive.
 *
 * Service Account chỉ upload được vào Shared Drive (Workspace). Với Gmail cá
 * nhân (My Drive), Service Account có quota 0 byte nên mọi lần tạo file đều
 * thất bại với "Service Accounts do not have storage quota" — ảnh check-in/out
 * rơi về DRV_LOCAL và chỉ nằm trên đĩa VPS.
 *
 * Vì vậy ngoài Service Account, hệ thống hỗ trợ OAuth2 refresh token của chính
 * tài khoản Gmail sở hữu thư mục Drive. File do tài khoản đó tạo nên dùng đúng
 * quota của tài khoản, không còn lỗi quota 0 byte.
 *
 * Biến môi trường (đặt trong apps/backend/.env rồi restart backend):
 *   GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
 *   GOOGLE_OAUTH_CLIENT_SECRET=...
 *   GOOGLE_OAUTH_REFRESH_TOKEN=...
 *
 * Lấy refresh token bằng: node scripts/get-google-oauth-refresh-token.cjs
 */

export type GoogleDriveAuthMode = 'oauth' | 'service-account' | 'none';

export interface DriveOAuthCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

const OAUTH_ENV_ALIASES = {
  clientId: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_DRIVE_OAUTH_CLIENT_ID'],
  clientSecret: ['GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_DRIVE_OAUTH_CLIENT_SECRET'],
  refreshToken: ['GOOGLE_OAUTH_REFRESH_TOKEN', 'GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN'],
};

function firstEnv(names: string[]): string {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

/**
 * Đọc cấu hình OAuth2 từ biến môi trường (.env trên VPS/local).
 */
export function loadDriveOAuthCredentials(): DriveOAuthCredentials | null {
  const clientId = firstEnv(OAUTH_ENV_ALIASES.clientId);
  const clientSecret = firstEnv(OAUTH_ENV_ALIASES.clientSecret);
  const refreshToken = firstEnv(OAUTH_ENV_ALIASES.refreshToken);
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

/** Tạo OAuth2 client đã nạp refresh token (tự refresh access token khi gọi API). */
export function createDriveOAuthClient(scopes: string[]): Auth.OAuth2Client | null {
  const creds = loadDriveOAuthCredentials();
  if (!creds) return null;
  try {
    const client = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
    client.setCredentials({ refresh_token: creds.refreshToken });
    // Scope đã được chốt lúc lấy consent (refresh token), không cần gán lại.
    // Giữ tham số `scopes` để log/đối chiếu và tương thích API cũ.
    void scopes;
    return client;
  } catch (err: any) {
    console.error('[GoogleDriveAuth] Không tạo được OAuth2 client:', err?.message || err);
    return null;
  }
}

/** Mô tả ngắn gọn chế độ xác thực Drive đang dùng (không lộ secret). */
export function describeDriveAuth(mode: GoogleDriveAuthMode, account?: string): string {
  if (mode === 'oauth') return `OAuth2${account ? ` (${account})` : ''}`;
  if (mode === 'service-account') return `Service Account${account ? ` (${account})` : ''}`;
  return 'Chưa cấu hình';
}

/** Chuyển lỗi Google thành chuỗi dễ đọc để hiện ở /health và log. */
export function describeGoogleApiError(err: any): string {
  const base = String(err?.message || err || 'UNKNOWN');
  const status = err?.response?.status ?? err?.code ?? null;
  let body = err?.response?.data;
  if (body && typeof body !== 'string') {
    try { body = JSON.stringify(body); } catch { body = String(body); }
  }
  const detail = typeof body === 'string' ? body.slice(0, 500) : '';
  return `${base}${status ? ` [HTTP ${status}]` : ''}${detail ? ` ${detail}` : ''}`;
}
