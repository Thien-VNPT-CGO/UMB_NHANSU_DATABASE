import IORedis from 'ioredis';

/**
 * Kết nối Redis — dùng cho BullMQ + cache + pub/sub mở rộng.
 *
 * REDIS_URL=redis://127.0.0.1:6379/0
 * hoặc dùng REDIS_HOST/PORT/DB/PASSWORD.
 *
 * Không cấu hình Redis: trả null — backend chạy chế độ fallback
 * (durable-write-queue + setInterval) như trước, không sập service.
 */
export function getRedisUrl(): string {
  const raw = String(process.env.REDIS_URL || process.env.REDIS_HUBLISH_URL || '').trim();
  if (raw) return raw;
  const host = String(process.env.REDIS_HOST || '').trim();
  if (host) {
    const port = Number(process.env.REDIS_PORT) || 6379;
    const db = Number(process.env.REDIS_DB) || 0;
    const pass = String(process.env.REDIS_PASSWORD || '').trim();
    const auth = pass ? `:${encodeURIComponent(pass)}@` : '';
    return `redis://${auth}${host}:${port}/${db}`;
  }
  return '';
}

export function isRedisConfigured(): boolean {
  return !!getRedisUrl();
}

let shared: IORedis | null = null;
let lastError: string | null = null;

export function getRedisConnection(): IORedis | null {
  if (!isRedisConfigured()) return null;
  if (shared) return shared;
  const url = getRedisUrl();
  shared = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (times: number) => Math.min(2000, Math.max(200, times * 200)),
  });
  shared.on('error', (err: any) => {
    lastError = err?.message || String(err);
  });
  shared.on('connect', () => {
    lastError = null;
  });
  return shared;
}

/** Connection riêng cho BullMQ Worker (BullMQ yêu cầu connection riêng, không share). */
export function getBullConnection(): IORedis | null {
  if (!isRedisConfigured()) return null;
  const url = getRedisUrl();
  const conn = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  conn.on('error', (err: any) => {
    console.warn('[redis] BullMQ connection error:', err?.message || err);
  });
  return conn;
}

export function getRedisStatus() {
  return {
    configured: isRedisConfigured(),
    url: isRedisConfigured() ? getRedisUrl().replace(/:([^@/]+)@/, ':***@') : null,
    lastError,
    up: !!shared && (shared as any).status === 'ready',
  };
}
