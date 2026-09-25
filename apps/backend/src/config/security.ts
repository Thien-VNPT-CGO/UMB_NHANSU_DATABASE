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

const DEFAULT_ORIGIN_PATTERNS = [
  'https://*.vercel.app',
  'https://*.onrender.com',
  'http://localhost:*',
  'http://127.0.0.1:*',
  'http://localhost:3000',
  'http://localhost:3005',
  'http://localhost:3006',
  'http://localhost:4005',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3005',
  'http://127.0.0.1:3006',
  'http://127.0.0.1:4005',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
];

/**
 * Danh sách origin được phép (HTTP + Socket dùng chung).
 * Mặc định luôn bao gồm domain Vercel, Render và Localhost để không bị chặn kết nối.
 */
export function getAllowedOrigins(): string[] {
  const configured = parseList(process.env.CORS_ORIGINS);
  return Array.from(new Set([...DEFAULT_ORIGIN_PATTERNS, ...configured]));
}

/** Hỗ trợ wildcard dạng `https://*.vercel.app` hoặc `http://localhost:*`. */
export function isOriginAllowed(origin: string, patterns: string[]): boolean {
  if (!origin) return true;

  // Tự động cho phép mọi domain Vercel và Render của hệ thống
  if (/^https:\/\/[a-zA-Z0-9_.-]+\.vercel\.app$/i.test(origin)) return true;
  if (/^https:\/\/[a-zA-Z0-9_.-]+\.onrender\.com$/i.test(origin)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;

  for (const raw of patterns) {
    const p = raw.trim();
    if (!p) continue;
    if (p === '*') return true;
    if (p.toLowerCase() === origin.toLowerCase()) return true;
    if (p.includes('*')) {
      const regexStr = '^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*') + '$';
      try {
        const regex = new RegExp(regexStr, 'i');
        if (regex.test(origin)) return true;
      } catch {
        // bỏ qua lỗi compile regex
      }
    }
  }
  return false;
}

export function buildCorsOptions(): CorsOptions {
  const allowed = getAllowedOrigins();
  return {
    origin: (origin, callback) => {
      // Không có Origin (curl, mobile, supertest) -> cho qua
      if (!origin) return callback(null, true);
      if (isOriginAllowed(origin, allowed)) {
        return callback(null, true);
      }
      console.warn(`[CORS] Blocked origin: ${origin}`);
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    maxAge: 86400,
  };
}

/** CORS cho Socket.IO — cùng whitelist với HTTP. */
export function buildSocketCorsOptions(): {
  origin: (origin: string | undefined, callback: (err: Error | null, ok?: boolean) => void) => void;
  methods: string[];
  credentials?: boolean;
} {
  const allowed = getAllowedOrigins();
  return {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (isOriginAllowed(origin, allowed)) {
        return callback(null, true);
      }
      console.warn(`[Socket CORS] Blocked origin: ${origin}`);
      return callback(null, false);
    },
    methods: ['GET', 'POST'],
    credentials: true,
  };
}

/**
 * Helmet: bật toàn bộ header bảo mật mặc định.
 * Tắt CSP do frontend dùng nhiều inline style.
 * Tắt crossOriginResourcePolicy để frontend Vercel gọi API Render không bị chặn tài nguyên cross-origin.
 */
export function helmetMiddleware() {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
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
