import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { env } from '../env';
import { AppError } from '../errors';

let pool: Pool | null = null;
let db: NodePgDatabase<typeof schema> | null = null;

export function hasDatabase(): boolean {
  return !!env.databaseUrl;
}

export function getDb(): NodePgDatabase<typeof schema> {
  if (!env.databaseUrl) {
    throw new AppError(
      503,
      'DB_NOT_CONFIGURED',
      'Chưa cấu hình DATABASE_URL. Hãy tạo PostgreSQL và đặt DATABASE_URL trong apps/harasocial-monitor/.env rồi chạy npm run db:migrate.'
    );
  }
  if (!pool) {
    pool = new Pool({
      connectionString: env.databaseUrl,
      max: Number(process.env.PG_POOL_MAX || 10),
      ssl: process.env.PGSSL === 'disable' ? false : undefined,
    });
  }
  if (!db) {
    db = drizzle(pool, { schema });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end().catch(() => undefined);
    pool = null;
    db = null;
  }
}

export { schema };
