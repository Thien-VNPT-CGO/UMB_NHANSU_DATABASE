import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { CorsOptions } from 'cors';

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test';
}

const DEV_ORIGINS = [
  'http://localhost:3005',
  'http://localhost:3006',
  'http://localhost:4005',
  'http://127.0.0.1:3005',
  'http://127.0.0.1:3006',
  'http://127.0.0.1:4005',
];

/**
 * Danh sách origin được phép (HTTP + Socket dùng chung).
 * - Production: bắt buộc khai CORS_ORIGINS (cách nhau bằng dấu phẩy).
 * - Dev: localhost mặc định + CORS_ORIGINS (nếu có).
 * - Request không có Origin (curl, supertest, mobile app) luôn được cho qua.
 */
export function getAllowedOrigins(): string[] {
  const configured = parseList(process.env.CORS_ORIGINS);
  if (process.env.NODE_ENV === 'production') return configured;
  return [...DEV_ORIGINS, ...configured];
}

/** Hỗ trợ wildcard dạng `https://*.vercel.app`. */
export function isOriginAllowed(origin: string, patterns: string[]): boolean {
  for (const raw of patterns) {
    const p = raw.trim();
    if (!p) continue;
    if (p === '*') return true;
    if (p === origin) return true;
    if (p.includes('*')) {
      // Chỉ hỗ trợ wildcard subdomain ở đầu: https://*.vercel.app
      const regex = new RegExp(
        '^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[a-z0-9-]+') + '$',
        'i'
      );
      if (regex.test(origin)) return true;
    }
  }
  return false;
}

export function buildCorsOptions(): CorsOptions {
  const allowed = getAllowedOrigins();
  return {
    origin: (origin, callback) => {
      // Không có Origin (supertest/curl/mobile) -> cho qua, auth vẫn kiểm tra JWT.
      if (!origin) return callback(null, true);
      if (isOriginAllowed(origin, allowed)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    maxAge: 600,
  };
}

/** CORS cho Socket.IO — cùng whitelist với HTTP. */
export function buildSocketCorsOptions(): {
  origin: (origin: string | undefined, callback: (err: Error | null, ok?: boolean) => void) => void;
  methods: string[];
} {
  const allowed = getAllowedOrigins();
  return {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (isOriginAllowed(origin, allowed)) return callback(null, true);
      return callback(new Error(`Socket CORS blocked for origin: ${origin}`));
    },
    methods: ['GET', 'POST'],
  };
}

/**
 * Helmet: bật toàn bộ header bảo mật mặc định, TẮT CSP vì frontend hiện tại
 * dùng nhiều inline style (style={{...}}) — bật CSP bây giờ sẽ vỡ giao diện
 * đang serve qua backend (express.static). Sẽ bật CSP ở bước tiếp theo khi
 * frontend hết inline style.
 */
export function helmetMiddleware() {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });
}

function readMax(envKey: string, prodDefault: number, testDefault: number): number {
  const raw = Number(process.env[envKey]);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return isTestEnv() ? testDefault : prodDefault;
}

/** Chống brute-force cho /auth/* (login, refresh, phone-login). */
export function authRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: readMax('AUTH_RATE_LIMIT_MAX', 30, 10000),
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'TOO_MANY_REQUESTS',
      message: 'Quá nhiều lần thử đăng nhập, vui lòng thử lại sau 15 phút',
    },
  });
}

/** Giới hạn chung cho toàn bộ API (chống spam/quét). */
export function generalRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: readMax('GENERAL_RATE_LIMIT_MAX', 300, 10000),
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'TOO_MANY_REQUESTS',
      message: 'Quá nhiều request, vui lòng chậm lại',
    },
  });
}
