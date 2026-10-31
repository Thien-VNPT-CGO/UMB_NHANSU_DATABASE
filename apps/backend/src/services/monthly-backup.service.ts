import path from 'path';
import { SHEETS_DEFINITIONS } from './google-sheets-sync.service.js';
import type { GoogleSheetsSyncService } from './google-sheets-sync.service.js';
import { normSheetDate } from './employees.service.js';
import {
  adjustmentPhotoPath,
  attendancePhotoPath,
  cleanupAttendancePhotoDiskBefore,
  deleteAdjustmentPhotoDisk,
  deleteAttendancePhotoDisk,
  readAdjustmentPhotoDisk,
  readAttendancePhotoDisk,
} from './photo-disk.store.js';
import type { ISheetsRepository } from '../repositories/sheets.interface.js';
import { getAttendanceFolderForBranch } from '../config/drive-folders.js';

/**
 * BACKUP THÁNG + ĐỒNG BỘ ẢNH HẰNG NGÀY LÊN GOOGLE DRIVE
 * ------------------------------------------------------
 * Cấu trúc Drive (theo yêu cầu chủ dự án):
 *   backup_YYYY-MM/
 *     <TÊN TAB>/
 *       YYYY-MM-DD/
 *         data.csv                (dữ liệu các dòng phát sinh trong ngày)
 *       _khong_ngay/data.csv      (dòng không xác định được ngày)
 *     SU_KIEN_DIEM_DANH/
 *       YYYY-MM-DD/<chi nhánh>/<nhân viên>/<ca>/check in.jpg | check out.jpg
 *     DIEU_CHINH_CONG/
 *       YYYY-MM-DD/<nhân viên>/<mã phiếu>.jpg
 *
 * - Ảnh check-in/out được upload ngay lúc chấm công (structured) và đồng bộ lại
 *   mỗi ngày; sau khi chắc chắn có trên Drive thì xóa bản đệm trên VPS.
 * - Ngày 5 hằng tháng (09:00 VN) job tháng chạy cho THÁNG TRƯỚC: bảo đảm toàn bộ
 *   ảnh + dữ liệu từng tab đã lên Drive, sau đó dọn ảnh đệm cũ để VPS không đầy.
 *   Google Sheets vẫn là DB gốc — job này KHÔNG xóa dữ liệu trên Sheets.
 */

const VN_OFFSET_MS = 7 * 3_600_000;

export interface MonthlyBackupResult {
  ok: boolean;
  month: string;
  reason?: string;
  error?: string;
  days: number;
  tabs: number;
  tabFiles: number;
  imagesUploaded: number;
  photosChecked: number;
  photosUploaded: number;
  photosAlreadyOnDrive: number;
  photosMissing: number;
  localDeleted: number;
  localKept: number;
  localBytesFreed: number;
}

export interface PhotoSyncResult {
  ok: boolean;
  date: string;
  reason?: string;
  checked: number;
  uploaded: number;
  alreadyOnDrive: number;
  missing: number;
  localDeleted: number;
}

/** Ngày VN hiện tại (YYYY-MM-DD). */
export function vnToday(now: Date = new Date()): string {
  return new Date(now.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Tháng VN hiện tại (YYYY-MM). */
export function vnMonthOf(now: Date = new Date()): string {
  return vnToday(now).slice(0, 7);
}

/** Tháng trước của 1 tháng YYYY-MM. */
export function previousMonthOf(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return '';
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = new Date(Date.UTC(y, mo - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Ngày đầu tháng kế tiếp (YYYY-MM-DD) — mốc dọn ảnh đệm tháng cũ. */
export function firstDayOfNextMonth(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]), 1));
  return d.toISOString().slice(0, 10);
}

/** Danh sách ngày YYYY-MM-DD của 1 tháng. */
export function daysOfMonth(month: string): string[] {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return [];
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const total = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const out: string[] = [];
  for (let d = 1; d <= total; d++) out.push(`${m[1]}-${m[2]}-${String(d).padStart(2, '0')}`);
  return out;
}

/** Ngày VN của 1 giá trị ngày/giờ đọc từ Sheet. */
function dayOfValue(v: unknown): string {
  const s = String(v ?? '').trim().replace(/^'/, '');
  if (!s) return '';
  // Serial Sheets có phần thập phân (ngày + giờ).
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) {
      const ms = Math.round((n - 25569) * 86_400_000);
      return new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10);
    }
  }
  // ISO/chuỗi có giờ: quy về ngày VN (+07:00).
  if (/^\d{4}-\d{1,2}-\d{1,2}[T ]\d/.test(s)) {
    const t = Date.parse(s);
    if (Number.isFinite(t)) return new Date(t + VN_OFFSET_MS).toISOString().slice(0, 10);
  }
  return normSheetDate(s);
}

/** Cột ngày ưu tiên của từng tab (index trong header). */
function pickDateIndex(headers: string[]): number {
  const h = (headers || []).map(x => String(x || '').toLowerCase());
  const preferred = [
    'giờ máy khách',
    'thời gian máy chủ',
    'ngày làm',
    'ngày nghỉ',
    'ngày sự cố',
    'ngày tạo',
    'ngày nộp',
    'ngày chốt',
    'ngày chi trả',
    'thời gian',
    'hiệu lực từ',
    'ngày bắt đầu',
    'cập nhật lúc',
    'ngày',
  ];
  for (const p of preferred) {
    const idx = h.findIndex(x => x.includes(p));
    if (idx >= 0) return idx;
  }
  return -1;
}

function csvCell(v: unknown): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

function toCsv(rows: unknown[][]): Buffer {
  const body = (rows || []).map(r => (r || []).map(csvCell).join(',')).join('\r\n');
  // BOM để Excel mở đúng tiếng Việt.
  return Buffer.from(`\uFEFF${body}`, 'utf8');
}

function safeSeg(v: unknown): string {
  return String(v ?? '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'KHONG_XAC_DINH';
}

const DATA_URL_IMAGE_RE = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/s;

function imageExtOfMime(mime: string): string {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('svg')) return 'svg';
  return 'jpg';
}

/** Nhận diện ảnh nhúng dạng data URL (chữ ký lương, QR ngân hàng...). */
export function dataUrlImageInfo(input: unknown): { mime: string; ext: string; buffer: Buffer } | null {
  const s = String(input ?? '').trim();
  const m = DATA_URL_IMAGE_RE.exec(s);
  if (!m) return null;
  try {
    const buffer = Buffer.from(m[2], 'base64');
    if (!buffer.length) return null;
    const subtype = m[1].toLowerCase();
    return { mime: `image/${subtype}`, ext: imageExtOfMime(subtype), buffer };
  } catch {
    return null;
  }
}

/**
 * Tách ảnh nhúng (base64) trong 1 nhóm dòng thành file riêng trên Drive:
 * backup_<tháng>/<TAB>/<ngày>/images/<mã dòng>_<tên cột>.<ext>
 * Ô trong CSV được thay bằng "images/<tên file>" để CSV gọn, không nhồi base64.
 * Upload lỗi thì giữ nguyên base64 để không mất ảnh.
 */
async function extractInlineImages(
  sync: GoogleSheetsSyncService,
  month: string,
  tabTitle: string,
  day: string,
  group: unknown[][],
  header: string[],
): Promise<{ rows: unknown[][]; uploaded: number; errors: number }> {
  const rows: unknown[][] = [];
  const used = new Set<string>();
  let uploaded = 0;
  let errors = 0;
  for (let ri = 0; ri < group.length; ri++) {
    const src = group[ri] || [];
    const out = [...src];
    if (ri === 0) { rows.push(out); continue; } // header
    const rowKey = safeSeg(src[0] || `row${ri + 1}`);
    for (let ci = 0; ci < out.length; ci++) {
      const img = dataUrlImageInfo(out[ci]);
      if (!img) continue;
      const colName = safeSeg(header[ci] || `col${ci + 1}`);
      const base = `${rowKey}_${colName}`.slice(0, 150);
      let name = `${base}.${img.ext}`;
      let n = 2;
      while (used.has(name)) name = `${base}_${n++}.${img.ext}`;
      used.add(name);
      const up = await sync.upsertBufferToDrivePath(
        name,
        img.mime,
        img.buffer,
        [`backup_${month}`, safeSeg(tabTitle), day, 'images'],
      ).catch(() => null);
      if (up?.fileId && !String(up.fileId).startsWith('DRV_')) {
        uploaded++;
        out[ci] = `images/${name}`;
      } else {
        errors++;
      }
    }
    rows.push(out);
  }
  return { rows, uploaded, errors };
}

function photoFileName(evt: any): string {
  const t = String(evt?.type || '').toUpperCase();
  if (t === 'CHECK_IN') return 'check in.jpg';
  if (t === 'CHECK_OUT') return 'check out.jpg';
  return `${safeSeg(t || 'photo')}.jpg`;
}

function attendanceSegments(evt: any, day: string): string[] {
  const month = day.slice(0, 7);
  return [
    `backup_${month}`,
    'SU_KIEN_DIEM_DANH',
    day,
    safeSeg(evt?.branch_id || 'KHONG_CHI_NHANH'),
    safeSeg(evt?.employee_id || 'KHONG_NV'),
    safeSeg(evt?.assignment_id || evt?.event_id || 'KHONG_CA'),
  ];
}

function adjustmentSegments(adj: any, day: string): string[] {
  const month = day.slice(0, 7);
  return [
    `backup_${month}`,
    'DIEU_CHINH_CONG',
    day,
    safeSeg(adj?.employee_id || 'KHONG_NV'),
  ];
}

/** Ngày của phiếu điều chỉnh: ưu tiên ngày sự cố trong lý do, rớt về created_at. */
function adjustmentDayOf(adj: any): string {
  const fromReason = String(adj?.reason || '').match(/(\d{4}-\d{2}-\d{2})/)?.[1] || '';
  if (fromReason) return fromReason;
  return dayOfValue(adj?.created_at);
}

function base64ToBuffer(input: unknown): Buffer | null {
  try {
    const s = String(input || '');
    if (!s) return null;
    const m = s.match(/^data:image\/[\w+.-]+;base64,(.*)$/s);
    const buf = Buffer.from(m ? m[1] : s.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

function isRealDriveId(id: unknown): boolean {
  const s = String(id || '');
  return !!s && !s.startsWith('DRV_') && !s.startsWith('INLINE_');
}

/**
 * Đồng bộ ảnh BẰNG CHỨNG của phiếu điều chỉnh/bù công (retry khi upload lúc
 * tạo phiếu lỗi — ảnh còn đệm trên VPS hoặc inline). Upload xong thì ghi
 * evidence_drive_id + đẩy lại tab DIEU_CHINH_CONG để không mất khi restart.
 */
async function syncAdjustmentPhotosToDrive(
  sync: GoogleSheetsSyncService,
  repo: ISheetsRepository,
  filter: { date?: string; month?: string },
): Promise<{ checked: number; uploaded: number; alreadyOnDrive: number; missing: number; localDeleted: number }> {
  const out = { checked: 0, uploaded: 0, alreadyOnDrive: 0, missing: 0, localDeleted: 0 };
  const list = await repo.listAttendanceAdjustments().catch(() => []);
  let changed = false;
  for (const adj of list as any[]) {
    const day = adjustmentDayOf(adj);
    if (!day) continue;
    if (filter.date && day !== filter.date) continue;
    if (filter.month && day.slice(0, 7) !== filter.month) continue;
    const adjId = String(adj?.adjustment_id || '');
    const hasEvidence = !!(adj?.evidence_photo || adj?.evidence_drive_id || readAdjustmentPhotoDisk(adjId));
    if (!hasEvidence) continue;
    out.checked++;

    // Đã có trên Drive: chỉ dọn bản đệm.
    if (isRealDriveId(adj?.evidence_drive_id)) {
      out.alreadyOnDrive++;
      if (deleteAdjustmentPhotoDisk(adjId)) out.localDeleted++;
      continue;
    }

    let buffer: Buffer | null = readAdjustmentPhotoDisk(adjId)?.buffer || null;
    if (!buffer) buffer = base64ToBuffer(adj?.evidence_photo);
    if (!buffer) {
      out.missing++;
      continue;
    }
    const up = await sync.upsertBufferToDrivePath(
      `ADJ_${safeSeg(adjId || Date.now())}.jpg`,
      'image/jpeg',
      buffer,
      [`backup_${day.slice(0, 7)}`, 'DIEU_CHINH_CONG', day, safeSeg(adj?.employee_id || 'KHONG_NV')],
    );
    if (up?.fileId && isRealDriveId(up.fileId)) {
      adj.evidence_drive_id = up.fileId;
      changed = true;
      out.uploaded++;
      if (deleteAdjustmentPhotoDisk(adjId)) out.localDeleted++;
    } else {
      out.missing++;
    }
  }
  if (changed) {
    try {
      await (sync as any).pushAdjustmentsTab?.(repo);
    } catch { /* lần push sau sẽ đồng bộ */ }
  }
  return out;
}

/**
 * Đồng bộ ảnh 1 NGÀY lên Drive theo cấu trúc tháng/ngày/chi nhánh/NV/ca.
 * Idempotent (upsert theo tên file), an toàn chạy lại nhiều lần.
 */
export async function syncDayPhotosToDrive(
  sync: GoogleSheetsSyncService,
  repo: ISheetsRepository,
  date: string,
): Promise<PhotoSyncResult> {
  const result: PhotoSyncResult = {
    ok: true, date, checked: 0, uploaded: 0, alreadyOnDrive: 0, missing: 0, localDeleted: 0,
  };
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ...result, ok: false, reason: 'INVALID_DATE' };
  if (!sync?.isDriveReady?.()) return { ...result, ok: false, reason: 'DRIVE_NOT_CONFIGURED' };

  const live = await repo.getAttendanceEvents('*', date).catch(() => []);
  let archived: any[] = [];
  try {
    archived = await (sync as any).getArchivedAttendanceEvents?.(
      `${date}T00:00:00+07:00`,
      `${date}T23:59:59+07:00`,
    ) || [];
  } catch { archived = []; }
  const byId = new Map<string, any>();
  for (const e of [...(live || []), ...(archived || [])]) {
    const id = String((e as any)?.event_id || '');
    if (id) byId.set(id, e);
  }

  for (const evt of byId.values()) {
    const type = String((evt as any)?.type || '').toUpperCase();
    if (type !== 'CHECK_IN' && type !== 'CHECK_OUT') continue;
    result.checked++;
    const day = dayOfValue((evt as any)?.client_time) || dayOfValue((evt as any)?.server_received_at) || date;
    const emp = await repo.getEmployeeById(String(evt?.employee_id || '')).catch(() => null);
    const branchId = evt?.branch_id || emp?.default_branch_id || 'CN130';
    const branchFolderId = getAttendanceFolderForBranch(branchId);
    const employeeName = safeSeg(emp?.full_name || evt?.employee_id || 'KHONG_NV');
    const segments = [day, employeeName];
    const fileName = photoFileName(evt);

    // Đã có trên Drive từ lúc chấm công: chỉ cần dọn bản đệm.
    if (isRealDriveId((evt as any)?.drive_object_id)) {
      result.alreadyOnDrive++;
      if (deleteAttendancePhotoDisk(String((evt as any)?.event_id || ''))) result.localDeleted++;
      continue;
    }

    let buffer: Buffer | null = null;
    const disk = readAttendancePhotoDisk(String((evt as any)?.event_id || ''));
    if (disk?.buffer?.length) buffer = disk.buffer;
    if (!buffer) buffer = base64ToBuffer((evt as any)?.event_photo);
    if (!buffer) {
      result.missing++;
      continue;
    }

    const up = await sync.upsertBufferToDrivePath(fileName, 'image/jpeg', buffer, segments, branchFolderId);
    if (up?.fileId && isRealDriveId(up.fileId)) {
      result.uploaded++;
      try {
        await repo.updateAttendanceEvent(String((evt as any).event_id), { drive_object_id: up.fileId } as any);
      } catch { /* giữ ảnh trên Drive là chính; Sheet sẽ đồng bộ ở lần push sau */ }
      if (deleteAttendancePhotoDisk(String((evt as any)?.event_id || ''))) result.localDeleted++;
    } else {
      result.missing++;
    }
  }

  // Ảnh bằng chứng phiếu điều chỉnh/bù công trong ngày.
  const adj = await syncAdjustmentPhotosToDrive(sync, repo, { date });
  result.checked += adj.checked;
  result.uploaded += adj.uploaded;
  result.alreadyOnDrive += adj.alreadyOnDrive;
  result.missing += adj.missing;
  result.localDeleted += adj.localDeleted;

  return result;
}

/** Cộng/trừ ngày trên chuỗi YYYY-MM-DD (UTC). */
export function addDaysIso(date: string, delta: number): string {
  const t = Date.parse(`${String(date || '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(t)) return '';
  return new Date(t + delta * 86_400_000).toISOString().slice(0, 10);
}

export interface PhotoBacklogResult {
  ok: boolean;
  from: string;
  to: string;
  days: string[];
  checked: number;
  uploaded: number;
  alreadyOnDrive: number;
  missing: number;
  localDeleted: number;
  reason?: string;
}

/**
 * Đồng bộ ảnh của NHIỀU NGÀY còn tồn (bù khi VPS downtime hoặc Drive lỗi dài
 * ngày). Trước đây job ngày chỉ đồng bộ đúng "hôm qua" nên nếu VPS tắt vài
 * ngày, ảnh cũ dồn trên đĩa tới tận kỳ backup tháng. Hàm này chạy tuần tự từ
 * `fromDate` tới `toDate`, giới hạn `maxDays` (mặc định 31) để không chạy quá lâu.
 */
export async function syncPhotoBacklog(
  sync: GoogleSheetsSyncService,
  repo: ISheetsRepository,
  opts: { fromDate?: string; toDate?: string; maxDays?: number },
): Promise<PhotoBacklogResult> {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(opts?.toDate || '')) ? String(opts.toDate) : vnToday();
  const maxDays = Math.max(1, Math.min(366, Number(opts?.maxDays) || 31));
  const earliest = addDaysIso(to, -(maxDays - 1));
  let from = /^\d{4}-\d{2}-\d{2}$/.test(String(opts?.fromDate || '')) ? String(opts.fromDate) : to;
  if (earliest && from < earliest) from = earliest;

  const out: PhotoBacklogResult = {
    ok: true, from, to, days: [], checked: 0, uploaded: 0,
    alreadyOnDrive: 0, missing: 0, localDeleted: 0,
  };
  if (!sync?.isDriveReady?.()) return { ...out, ok: false, reason: 'DRIVE_NOT_CONFIGURED' };
  if (!from || from > to) return out;

  for (let day = from; day <= to;) {
    try {
      const r = await syncDayPhotosToDrive(sync, repo, day);
      out.days.push(day);
      out.checked += r.checked;
      out.uploaded += r.uploaded;
      out.alreadyOnDrive += r.alreadyOnDrive;
      out.missing += r.missing;
      out.localDeleted += r.localDeleted;
      if (!r.ok && r.reason !== 'DRIVE_NOT_CONFIGURED') out.ok = false;
    } catch (err: any) {
      // 1 ngày lỗi không được chặn các ngày còn lại; job tháng sẽ quét bù.
      out.ok = false;
      out.reason = String(err?.message || err);
    }
    const next = addDaysIso(day, 1);
    if (!next || next <= day) break;
    day = next;
  }
  return out;
}

/**
 * Đồng bộ toàn bộ ảnh của 1 THÁNG (live + lưu trữ) lên Drive.
 * Dùng cho job tháng và có thể gọi bù khi cần.
 */
export async function syncMonthPhotosToDrive(
  sync: GoogleSheetsSyncService,
  repo: ISheetsRepository,
  month: string,
): Promise<{ checked: number; uploaded: number; alreadyOnDrive: number; missing: number; localDeleted: number }> {
  const out = { checked: 0, uploaded: 0, alreadyOnDrive: 0, missing: 0, localDeleted: 0 };
  if (!/^\d{4}-\d{2}$/.test(month) || !sync?.isDriveReady?.()) return out;

  const all = await repo.getAttendanceEvents('*', '*').catch(() => []);
  let archived: any[] = [];
  try {
    archived = await (sync as any).getArchivedAttendanceEvents?.(
      `${month}-01T00:00:00+07:00`,
      `${firstDayOfNextMonth(month)}T00:00:00+07:00`,
    ) || [];
  } catch { archived = []; }
  const byId = new Map<string, any>();
  for (const e of [...(all || []), ...(archived || [])]) {
    const id = String((e as any)?.event_id || '');
    if (id) byId.set(id, e);
  }

  for (const evt of byId.values()) {
    const type = String((evt as any)?.type || '').toUpperCase();
    if (type !== 'CHECK_IN' && type !== 'CHECK_OUT') continue;
    const day = dayOfValue((evt as any)?.client_time) || dayOfValue((evt as any)?.server_received_at);
    if (!day || day.slice(0, 7) !== month) continue;
    out.checked++;

    if (isRealDriveId((evt as any)?.drive_object_id)) {
      out.alreadyOnDrive++;
      if (deleteAttendancePhotoDisk(String((evt as any)?.event_id || ''))) out.localDeleted++;
      continue;
    }

    let buffer: Buffer | null = null;
    const disk = readAttendancePhotoDisk(String((evt as any)?.event_id || ''));
    if (disk?.buffer?.length) buffer = disk.buffer;
    if (!buffer) buffer = base64ToBuffer((evt as any)?.event_photo);
    if (!buffer) {
      out.missing++;
      continue;
    }
    const up = await sync.upsertBufferToDrivePath(
      photoFileName(evt), 'image/jpeg', buffer, attendanceSegments(evt, day),
    );
    if (up?.fileId && isRealDriveId(up.fileId)) {
      out.uploaded++;
      try {
        await repo.updateAttendanceEvent(String((evt as any).event_id), { drive_object_id: up.fileId } as any);
      } catch { /* best-effort */ }
      if (deleteAttendancePhotoDisk(String((evt as any)?.event_id || ''))) out.localDeleted++;
    } else {
      out.missing++;
    }
  }

  // Ảnh bằng chứng phiếu điều chỉnh/bù công trong tháng.
  const adj = await syncAdjustmentPhotosToDrive(sync, repo, { month });
  out.checked += adj.checked;
  out.uploaded += adj.uploaded;
  out.alreadyOnDrive += adj.alreadyOnDrive;
  out.missing += adj.missing;
  out.localDeleted += adj.localDeleted;

  return out;
}

/**
 * Lưu dữ liệu từng TAB thành CSV theo ngày trong folder của tháng.
 * Trả về số tab + số file đã ghi.
 */
async function archiveTabData(
  sync: GoogleSheetsSyncService,
  month: string,
): Promise<{ tabs: number; files: number; errors: number; images: number }> {
  let tabs = 0;
  let files = 0;
  let errors = 0;
  let images = 0;

  for (const def of SHEETS_DEFINITIONS) {
    const rows = await sync.readTabRows(def.title).catch(() => [] as string[][]);
    if (!rows || rows.length === 0) continue;
    const header = (rows[0] && rows[0].length ? rows[0] : def.headers) || [];
    const isHeaderRow = (r: unknown[]) =>
      header.length > 0 && header.every((h, i) => String(r?.[i] ?? '') === String(h));
    const dataRows = rows.slice(1)
      .filter(r => (r || []).some(c => String(c ?? '').trim() !== ''))
      .filter(r => !isHeaderRow(r)); // tab partition có header lặp giữa các part
    const dateIdx = pickDateIndex(header);

    const byDay = new Map<string, unknown[][]>();
    const isAdjustmentTab = def.title === 'DIEU_CHINH_CONG';
    for (const r of dataRows) {
      // DIEU_CHINH_CONG không có cột ngày — ngày nằm trong lý do "[TYPE] YYYY-MM-DD:".
      const day = isAdjustmentTab
        ? (String(r[3] || '').match(/(\d{4}-\d{2}-\d{2})/)?.[1] || '')
        : (dateIdx >= 0 ? dayOfValue(r[dateIdx]) : '');
      const key = day && day.slice(0, 7) === month ? day : '_khong_ngay';
      if (!byDay.has(key)) byDay.set(key, [header]);
      byDay.get(key)!.push(r);
    }

    // Chỉ ghi tab có ít nhất 1 dòng thuộc tháng (hoặc dòng không ngày).
    let wroteAny = false;
    for (const [day, group] of byDay.entries()) {
      if (group.length <= 1) continue; // chỉ có header
      // Ảnh nhúng trong dòng (chữ ký lương, QR...) -> file riêng trong
      // <TAB>/<ngày>/images/, CSV chỉ còn đường dẫn để nhẹ và dễ đọc.
      const extracted = await extractInlineImages(sync, month, def.title, day, group, header);
      images += extracted.uploaded;
      errors += extracted.errors;
      const up = await sync.upsertBufferToDrivePath(
        'data.csv',
        'text/csv',
        toCsv(extracted.rows),
        [`backup_${month}`, safeSeg(def.title), day],
      ).catch(() => null);
      if (up?.fileId && !String(up.fileId).startsWith('DRV_')) {
        files++;
        wroteAny = true;
      } else {
        errors++;
      }
    }
    if (wroteAny) tabs++;
  }

  return { tabs, files, errors, images };
}

/** Dọn ảnh đệm trên VPS nhưng GIỮ LẠI ảnh chưa chắc đã lên Drive (tránh mất). */
function cleanupOldPhotoBuffer(
  month: string,
  repo: ISheetsRepository,
): { removed: number; kept: number; bytes: number } {
  const cutoff = firstDayOfNextMonth(month);
  if (!cutoff) return { removed: 0, kept: 0, bytes: 0 };

  const keepNames = new Set<string>();
  try {
    const events = (repo as any)?.fallbackAdapter?.attendanceEvents as any[] | undefined;
    for (const e of events || []) {
      if (isRealDriveId(e?.drive_object_id)) continue;
      if (!e?.event_photo && !readAttendancePhotoDisk(String(e?.event_id || ''))) continue;
      keepNames.add(path.basename(attendancePhotoPath(String(e?.event_id || ''))));
    }
  } catch { /* best-effort */ }
  try {
    const adjustments = (repo as any)?.fallbackAdapter?.attendanceAdjustments as any[] | undefined;
    for (const a of adjustments || []) {
      if (isRealDriveId(a?.evidence_drive_id)) continue;
      if (!a?.evidence_photo && !readAdjustmentPhotoDisk(String(a?.adjustment_id || ''))) continue;
      keepNames.add(path.basename(adjustmentPhotoPath(String(a?.adjustment_id || ''))));
    }
  } catch { /* best-effort */ }

  const r = cleanupAttendancePhotoDiskBefore(cutoff, (name) => keepNames.has(name));
  return { removed: r.removed, kept: keepNames.size, bytes: r.bytes };
}

/**
 * Job THÁNG: lưu toàn bộ dữ liệu tháng `month` lên Drive theo cấu trúc, đồng bộ
 * ảnh, rồi dọn ảnh đệm cũ trên VPS. Không đụng dữ liệu Google Sheets.
 */
export async function runMonthlyBackup(
  sync: GoogleSheetsSyncService,
  repo: ISheetsRepository,
  month: string,
): Promise<MonthlyBackupResult> {
  const base: MonthlyBackupResult = {
    ok: false,
    month,
    days: 0,
    tabs: 0,
    tabFiles: 0,
    imagesUploaded: 0,
    photosChecked: 0,
    photosUploaded: 0,
    photosAlreadyOnDrive: 0,
    photosMissing: 0,
    localDeleted: 0,
    localKept: 0,
    localBytesFreed: 0,
  };
  if (!/^\d{4}-\d{2}$/.test(month)) return { ...base, reason: 'INVALID_MONTH' };
  if (!sync?.isDriveReady?.()) return { ...base, reason: 'DRIVE_NOT_CONFIGURED' };

  try {
    const days = daysOfMonth(month);
    base.days = days.length;

    // 1) Bảo đảm ảnh của cả tháng đã lên Drive.
    const photos = await syncMonthPhotosToDrive(sync, repo, month);
    base.photosChecked = photos.checked;
    base.photosUploaded = photos.uploaded;
    base.photosAlreadyOnDrive = photos.alreadyOnDrive;
    base.photosMissing = photos.missing;
    base.localDeleted = photos.localDeleted;

    // 2) Dữ liệu từng tab -> folder tab -> folder ngày -> data.csv.
    const data = await archiveTabData(sync, month);
    base.tabs = data.tabs;
    base.tabFiles = data.files;
    base.imagesUploaded = data.images;

    // 3) Dọn ảnh đệm tháng cũ trên VPS (giữ ảnh chưa lên Drive).
    const cleaned = cleanupOldPhotoBuffer(month, repo);
    base.localDeleted += cleaned.removed;
    base.localKept = cleaned.kept;
    base.localBytesFreed = cleaned.bytes;

    base.ok = data.errors === 0;
    if (!base.ok) base.reason = `TAB_UPLOAD_ERRORS:${data.errors}`;
    return base;
  } catch (err: any) {
    return { ...base, error: String(err?.message || err) };
  }
}
