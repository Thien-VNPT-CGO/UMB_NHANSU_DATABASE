import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

/**
 * Kết nối PostgreSQL — nguồn sự thật mới của UBM HR.
 *
 * Cấu hình ưu tiên:
 *   DATABASE_URL=postgresql://ubm:matkhau@postgres:5432/ubm_hr
 * hoặc bộ biến PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.
 *
 * Không có cấu hình => hệ thống chạy mock trong bộ nhớ (chỉ dùng dev).
 */

let pool: Pool | null = null;
let lastError: string | null = null;

export function isPostgresConfigured(): boolean {
  return !!String(process.env.DATABASE_URL || '').trim()
    || !!String(process.env.PGHOST || '').trim();
}

function buildPoolConfig() {
  const connectionString = String(process.env.DATABASE_URL || '').trim();
  const sslEnabled = /^(1|true|yes)$/i.test(String(process.env.DATABASE_SSL || '').trim());
  const max = Math.max(1, Number(process.env.DATABASE_POOL_MAX) || 10);
  const common = {
    max,
    idleTimeoutMillis: Math.max(5_000, Number(process.env.DATABASE_IDLE_TIMEOUT_MS) || 30_000),
    connectionTimeoutMillis: Math.max(2_000, Number(process.env.DATABASE_CONNECT_TIMEOUT_MS) || 10_000),
    ...(sslEnabled ? { ssl: { rejectUnauthorized: false } } : {}),
  };
  if (connectionString) return { ...common, connectionString };
  return {
    ...common,
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
  };
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(buildPoolConfig());
    pool.on('error', err => {
      lastError = err?.message || String(err);
      console.error('[postgres] Lỗi pool rảnh:', lastError);
    });
    pool.on('connect', () => {
      lastError = null;
    });
  }
  return pool;
}

export function getPostgresLastError(): string | null {
  return lastError;
}

export async function pgQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: any[] = [],
): Promise<QueryResult<T>> {
  try {
    return await getPool().query<T>(text, params);
  } catch (err: any) {
    lastError = err?.message || String(err);
    throw err;
  }
}

/** Chạy 1 hàm trong transaction; rollback nếu throw. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end().catch(() => undefined);
}
