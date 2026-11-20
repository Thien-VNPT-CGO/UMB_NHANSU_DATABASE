import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
// Ưu tiên .env của app, sau đó .env của thư mục đang chạy và root monorepo.
for (const candidate of [
  path.resolve(here, '../.env'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(here, '../../.env'),
  path.resolve(here, '../../../.env'),
]) {
  if (fs.existsSync(candidate)) dotenv.config({ path: candidate });
}

function clean(value: string | undefined): string {
  return String(value ?? '').trim();
}

export const env = {
  nodeEnv: clean(process.env.NODE_ENV) || 'development',
  port: Number(process.env.PORT || 3000),
  // Trên VPS đặt HOST=127.0.0.1 để chỉ Nginx nội bộ truy cập được cổng 3010.
  host: clean(process.env.HOST) || '0.0.0.0',
  databaseUrl: clean(process.env.DATABASE_URL),
  publicUrl: clean(process.env.PUBLIC_URL).replace(/\/+$/, ''),

  firebaseProjectId: clean(process.env.FIREBASE_PROJECT_ID),
  firebaseServiceAccountJson: clean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
  firebaseServiceAccountBase64: clean(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64),
  googleApplicationCredentials: clean(process.env.GOOGLE_APPLICATION_CREDENTIALS),

  firebaseWebApiKey: clean(process.env.FIREBASE_WEB_API_KEY),
  firebaseAuthDomain: clean(process.env.FIREBASE_AUTH_DOMAIN),
  firebaseWebAppId: clean(process.env.FIREBASE_WEB_APP_ID),
  firebaseMessagingSenderId: clean(process.env.FIREBASE_MESSAGING_SENDER_ID),

  devUid: clean(process.env.HARA_DEV_UID),
  devEmail: clean(process.env.HARA_DEV_EMAIL) || 'dev@localhost',

  // Xác thực dự phòng khi chưa bật Firebase: Google ID token + mã truy cập quản trị.
  googleOAuthClientId: clean(process.env.GOOGLE_OAUTH_CLIENT_ID),
  allowedEmails: clean(process.env.HARA_ALLOWED_EMAILS)
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
  sessionSecret: clean(process.env.HARA_SESSION_SECRET),
  accessCode: clean(process.env.HARA_ACCESS_CODE),
  ownerUid: clean(process.env.HARA_OWNER_UID) || 'ubm-director',
  ownerEmail: clean(process.env.HARA_OWNER_EMAIL) || 'director@ubm.local',
  ownerName: clean(process.env.HARA_OWNER_NAME) || 'Giám đốc UBM',

  allowInsecurePull: clean(process.env.ALLOW_INSECURE_PULL) === '1',
  workerDisabled: clean(process.env.HARA_WORKER_DISABLED) === '1',
};

export function isProduction(): boolean {
  return env.nodeEnv === 'production';
}

/** Chỉ cho dev-auth khi KHÔNG phải production và có HARA_DEV_UID. */
export function devAuthEnabled(): boolean {
  return !isProduction() && !!env.devUid;
}

export function firebaseWebConfig() {
  if (!env.firebaseWebApiKey || !env.firebaseAuthDomain || !env.firebaseWebAppId) return null;
  return {
    apiKey: env.firebaseWebApiKey,
    authDomain: env.firebaseAuthDomain,
    projectId: env.firebaseProjectId || env.firebaseAuthDomain.replace('.firebaseapp.com', ''),
    appId: env.firebaseWebAppId,
    messagingSenderId: env.firebaseMessagingSenderId || undefined,
  };
}

export function baseUrl(fallback: string): string {
  return env.publicUrl || fallback;
}
