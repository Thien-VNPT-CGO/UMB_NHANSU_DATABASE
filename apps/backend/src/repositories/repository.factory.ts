import { GoogleSheetsAdapter } from './google-sheets.adapter.js';
import { createPostgresRepository } from './postgres.adapter.js';
import { isPostgresConfigured } from '../config/database.js';

/**
 * Chọn kho dữ liệu theo biến môi trường DATA_STORE:
 *
 *   postgres (mặc định khi có DATABASE_URL/PGHOST) — PostgreSQL là nguồn sự thật.
 *   sheets   — chế độ cũ (Google Sheets live, dùng khi cần rollback khẩn cấp).
 *   mock     — bộ nhớ tạm, không DB (dev/test).
 *
 * Rollback: đặt DATA_STORE=sheets rồi restart; dữ liệu vẫn còn nguyên trên Sheets.
 */
export type DataStoreMode = 'postgres' | 'sheets' | 'mock';

export function resolveDataStoreMode(): DataStoreMode {
  const raw = String(process.env.DATA_STORE || '').trim().toLowerCase();
  if (['postgres', 'postgresql', 'pg'].includes(raw)) return 'postgres';
  if (['sheets', 'sheet', 'google-sheets', 'google_sheets'].includes(raw)) return 'sheets';
  if (['mock', 'memory', 'mem'].includes(raw)) return 'mock';
  return isPostgresConfigured() ? 'postgres' : 'sheets';
}

export function isPostgresMode(adapter: any): boolean {
  try {
    if (adapter?.isPostgres) return true;
    return adapter?.getStatus?.()?.mode === 'POSTGRES';
  } catch {
    return false;
  }
}

export function createRepository(): any {
  const mode = resolveDataStoreMode();

  if (mode === 'postgres') {
    if (!isPostgresConfigured()) {
      console.warn(
        '[repository] DATA_STORE=postgres nhưng chưa có DATABASE_URL/PGHOST — '
        + 'tạm dùng Google Sheets. Điền kết nối PostgreSQL trong .env rồi restart.',
      );
      return new GoogleSheetsAdapter();
    }
    console.log('[repository] Chế độ dữ liệu: PostgreSQL (nguồn sự thật) + Google Drive (ảnh).');
    return createPostgresRepository();
  }

  if (mode === 'mock') {
    console.warn('[repository] Chế độ MOCK: dữ liệu chỉ nằm trong bộ nhớ, mất khi restart.');
    return createPostgresRepository();
  }

  console.log('[repository] Chế độ dữ liệu: Google Sheets (legacy).');
  return new GoogleSheetsAdapter();
}
