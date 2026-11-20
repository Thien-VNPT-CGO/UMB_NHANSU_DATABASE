import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { env } from '../server/env';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.resolve(dirname, '../drizzle');

async function main() {
  if (!env.databaseUrl) {
    console.error('Thiếu DATABASE_URL trong .env');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: env.databaseUrl, max: 2 });
  try {
    const files = fs.existsSync(drizzleDir)
      ? fs.readdirSync(drizzleDir).filter((f) => f.endsWith('.sql')).sort()
      : [];
    if (!files.length) {
      console.log('Không tìm thấy file migration .sql');
      return;
    }
    for (const file of files) {
      const sql = fs.readFileSync(path.join(drizzleDir, file), 'utf8');
      console.log(`→ ${file}`);
      await pool.query(sql);
    }
    console.log('✅ Migration hoàn tất.');
  } catch (e) {
    console.error('❌ Migration lỗi:', (e as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
