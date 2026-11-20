import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { OAuth2Client } from 'google-auth-library';
import { devAuthEnabled, env, firebaseWebConfig, isProduction } from './env';

declare global {
  namespace Express {
    interface Request {
      ownerUid?: string;
      ownerEmail?: string;
      ownerName?: string;
    }
  }
}

let firebaseApp: App | null = null;
let firebaseAuth: Auth | null = null;
let initError: string | null = null;
let googleClient: OAuth2Client | null = null;
let ephemeralSecret: string | null = null;

function loadServiceAccount(): Record<string, unknown> | null {
  try {
    if (env.firebaseServiceAccountJson) {
      return JSON.parse(env.firebaseServiceAccountJson);
    }
    if (env.firebaseServiceAccountBase64) {
      return JSON.parse(Buffer.from(env.firebaseServiceAccountBase64, 'base64').toString('utf8'));
    }
  } catch (e) {
    initError = `Không đọc được service account Firebase: ${(e as Error).message}`;
  }
  return null;
}

export function initFirebaseAdmin(): boolean {
  if (firebaseAuth) return true;
  if (getApps().length > 0) {
    firebaseApp = getApps()[0];
    firebaseAuth = getAuth(firebaseApp);
    return true;
  }
  try {
    const serviceAccount = loadServiceAccount();
    if (serviceAccount) {
      firebaseApp = initializeApp({
        credential: cert(serviceAccount as any),
        projectId: env.firebaseProjectId || String(serviceAccount.project_id || ''),
      });
    } else if (env.googleApplicationCredentials) {
      firebaseApp = initializeApp({ projectId: env.firebaseProjectId || undefined });
    } else {
      // Không phải lỗi chặn khởi động: hệ thống có thể chạy bằng Google OAuth
      // hoặc mã truy cập quản trị khi chưa cấu hình Firebase.
      initError = 'Chưa cấu hình Firebase Admin (FIREBASE_SERVICE_ACCOUNT_JSON hoặc GOOGLE_APPLICATION_CREDENTIALS).';
      return false;
    }
    firebaseAuth = getAuth(firebaseApp);
    initError = null;
    return true;
  } catch (e) {
    initError = `Khởi tạo Firebase Admin thất bại: ${(e as Error).message}`;
    return false;
  }
}

export function firebaseAdminStatus() {
  return {
    ready: initFirebaseAdmin(),
    error: initError,
    devAuthEnabled: devAuthEnabled(),
  };
}

/* ------------------------------------------------------ phiên đăng nhập */

export interface SessionUser {
  uid: string;
  email: string;
  displayName: string;
}

interface SessionPayload extends SessionUser {
  exp: number;
  iat: number;
}

function sessionSecret(): string {
  if (env.sessionSecret) return env.sessionSecret;
  if (env.accessCode) return `access:${env.accessCode}`;
  if (!ephemeralSecret) {
    ephemeralSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[auth] HARA_SESSION_SECRET chưa đặt — dùng secret tạm, phiên sẽ mất khi khởi động lại.');
  }
  return ephemeralSecret;
}

function b64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function signHmac(data: string): string {
  return crypto.createHmac('sha256', sessionSecret()).update(data).digest('base64url');
}

export function issueSession(user: SessionUser, ttlDays = 30): { token: string; user: SessionUser } {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    iat: now,
    exp: now + ttlDays * 86400,
  };
  const body = b64url(JSON.stringify(payload));
  return {
    token: `hso1.${body}.${signHmac(body)}`,
    user: { uid: user.uid, email: user.email, displayName: user.displayName },
  };
}

export function verifySessionToken(token: string): SessionUser | null {
  if (!token.startsWith('hso1.')) return null;
  const [, body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = signHmac(body);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload?.uid || !payload.exp || payload.exp * 1000 < Date.now()) return null;
    return {
      uid: payload.uid,
      email: String(payload.email || ''),
      displayName: String(payload.displayName || ''),
    };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------- xác thực Google OIDC */

function getGoogleClient(): OAuth2Client {
  if (!googleClient) googleClient = new OAuth2Client(env.googleOAuthClientId);
  return googleClient;
}

function emailAllowed(email: string): boolean {
  if (env.allowedEmails.length === 0) return true;
  return env.allowedEmails.includes(email.toLowerCase());
}

export async function googleLogin(credential: string): Promise<{ token: string; user: SessionUser }> {
  if (!env.googleOAuthClientId) {
    throw Object.assign(new Error('Chưa cấu hình GOOGLE_OAUTH_CLIENT_ID trên máy chủ.'), {
      status: 503,
      code: 'GOOGLE_AUTH_NOT_CONFIGURED',
    });
  }
  const ticket = await getGoogleClient()
    .verifyIdToken({ idToken: credential, audience: env.googleOAuthClientId })
    .catch(() => {
      throw Object.assign(new Error('Google token không hợp lệ hoặc đã hết hạn.'), {
        status: 401,
        code: 'INVALID_GOOGLE_TOKEN',
      });
    });
  const payload = ticket.getPayload();
  const email = String(payload?.email || '');
  if (!payload?.sub || !email) {
    throw Object.assign(new Error('Google token thiếu thông tin tài khoản.'), {
      status: 401,
      code: 'INVALID_GOOGLE_TOKEN',
    });
  }
  if (payload.email_verified === false) {
    throw Object.assign(new Error('Email Google chưa được xác minh.'), { status: 403, code: 'EMAIL_NOT_VERIFIED' });
  }
  if (!emailAllowed(email)) {
    throw Object.assign(new Error('Tài khoản Google này không nằm trong danh sách được phép.'), {
      status: 403,
      code: 'EMAIL_NOT_ALLOWED',
    });
  }
  return issueSession({
    uid: `google:${payload.sub}`,
    email,
    displayName: String(payload.name || email),
  });
}

/* ------------------------------------------------------- mã truy cập quản trị */

interface Attempt {
  count: number;
  resetAt: number;
}

const accessAttempts = new Map<string, Attempt>();
const ACCESS_MAX_ATTEMPTS = 8;
const ACCESS_WINDOW_MS = 5 * 60 * 1000;

function accessBlocked(ip: string): boolean {
  const entry = accessAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    accessAttempts.delete(ip);
    return false;
  }
  return entry.count >= ACCESS_MAX_ATTEMPTS;
}

function registerFailedAttempt(ip: string): void {
  const now = Date.now();
  const entry = accessAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    accessAttempts.set(ip, { count: 1, resetAt: now + ACCESS_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

function safeEqual(a: string, b: string): boolean {
  const left = crypto.createHash('sha256').update(a).digest();
  const right = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(left, right);
}

export function accessLogin(code: string, ip: string): { token: string; user: SessionUser } {
  if (!env.accessCode) {
    throw Object.assign(new Error('Đăng nhập bằng mã truy cập đã tắt.'), { status: 404, code: 'ACCESS_CODE_DISABLED' });
  }
  if (accessBlocked(ip)) {
    throw Object.assign(new Error('Sai mã quá nhiều lần. Vui lòng thử lại sau 5 phút.'), {
      status: 429,
      code: 'TOO_MANY_ATTEMPTS',
    });
  }
  if (!code || !safeEqual(code.trim(), env.accessCode)) {
    registerFailedAttempt(ip);
    throw Object.assign(new Error('Mã truy cập không đúng.'), { status: 401, code: 'INVALID_ACCESS_CODE' });
  }
  accessAttempts.delete(ip);
  return issueSession({
    uid: env.ownerUid,
    email: env.ownerEmail,
    displayName: env.ownerName,
  });
}

/* --------------------------------------------------------------- middleware */

function bearer(req: Request): string {
  const auth = String(req.headers.authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  // SSE dùng fetch + header; query chỉ hỗ trợ dev để tương thích EventSource.
  if (devAuthEnabled() && req.query.token) return String(req.query.token);
  return '';
}

function devUser(token: string) {
  if (!devAuthEnabled()) return null;
  if (token === `dev_${env.devUid}`) {
    return { uid: env.devUid, email: env.devEmail, name: 'Chế độ phát triển' };
  }
  return null;
}

export function authModeSummary() {
  return {
    firebase: !!firebaseWebConfig(),
    google: !!env.googleOAuthClientId,
    accessCode: !!env.accessCode,
    dev: devAuthEnabled(),
  };
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = bearer(req);
  if (!token) {
    res.status(401).json({ error: 'Thiếu Authorization Bearer token.', code: 'UNAUTHENTICATED' });
    return;
  }

  const dev = devUser(token);
  if (dev) {
    req.ownerUid = dev.uid;
    req.ownerEmail = dev.email;
    req.ownerName = dev.name;
    next();
    return;
  }

  // Phiên nội bộ (HMAC) do /api/auth/access hoặc /api/auth/google cấp.
  const session = verifySessionToken(token);
  if (session) {
    req.ownerUid = session.uid;
    req.ownerEmail = session.email;
    req.ownerName = session.displayName;
    next();
    return;
  }

  if (initFirebaseAdmin() && firebaseAuth) {
    try {
      const decoded = await firebaseAuth.verifyIdToken(token, true);
      req.ownerUid = decoded.uid;
      req.ownerEmail = decoded.email || '';
      req.ownerName = decoded.name || '';
      next();
      return;
    } catch {
      res.status(401).json({ error: 'Token đăng nhập không hợp lệ hoặc đã hết hạn.', code: 'INVALID_TOKEN' });
      return;
    }
  }

  // Chưa bật Firebase Admin: chấp nhận Google ID token (GIS) trực tiếp.
  if (env.googleOAuthClientId) {
    try {
      const result = await googleLogin(token);
      req.ownerUid = result.user.uid;
      req.ownerEmail = result.user.email;
      req.ownerName = result.user.displayName;
      next();
      return;
    } catch (e) {
      res.status(401).json({ error: (e as Error).message || 'Google token không hợp lệ.', code: 'INVALID_TOKEN' });
      return;
    }
  }

  res.status(503).json({
    error: initError || 'Chưa cấu hình xác thực. Đặt HARA_ACCESS_CODE hoặc GOOGLE_OAUTH_CLIENT_ID / Firebase.',
    code: 'AUTH_NOT_CONFIGURED',
  });
}

export function devLoginPayload() {
  if (!devAuthEnabled()) return null;
  return {
    token: `dev_${env.devUid}`,
    user: { uid: env.devUid, email: env.devEmail, displayName: 'Chế độ phát triển' },
  };
}

export function assertNotProductionDev(): void {
  if (isProduction() && devAuthEnabled()) {
    console.warn('[auth] HARA_DEV_UID bị bỏ qua trong production.');
  }
}
