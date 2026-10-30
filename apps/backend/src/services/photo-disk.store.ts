import fs from 'fs';
import path from 'path';

/**
 * Lưu ảnh check-in/out xuống đĩa để sống sót qua restart/rebuild/redeploy.
 * Trước đây ảnh chỉ giữ trong bộ nhớ (event_photo) khi upload Drive lỗi
 * (DRV_LOCAL_*) — restart là mất vĩnh viễn, HR thấy "Chưa có ảnh".
 * Disk là fallback hiển thị + nguồn retry upload Drive sau restart.
 */

function resolvePhotoDir(): string {
  if (process.env.ATTENDANCE_PHOTO_DIR) return process.env.ATTENDANCE_PHOTO_DIR;
  const cwd = process.cwd();
  // npm --workspace chạy cwd=apps/backend; docker/prod chạy cwd=/app (repo root).
  try {
    if (fs.existsSync(path.join(cwd, 'apps', 'backend', 'package.json'))) {
      return path.join(cwd, 'apps', 'backend', 'data', 'attendance-photos');
    }
  } catch { /* fallthrough */ }
  return path.join(cwd, 'data', 'attendance-photos');
}

const PHOTO_DIR = resolvePhotoDir();

/** Thư mục ảnh đệm trên VPS (dùng cho job dọn dung lượng hằng tháng). */
export function attendancePhotoDir(): string {
  return PHOTO_DIR;
}

/**
 * Xóa ảnh đệm trên VPS có mtime TRƯỚC mốc ngày (YYYY-MM-DD, giờ VN).
 * Chạy sau khi tháng cũ đã backup lên Google Drive: giải phóng dung lượng VPS,
 * tháng mới tiếp tục lưu ảnh đệm. Best-effort, không bao giờ throw.
 */
export function cleanupAttendancePhotoDiskBefore(
  cutoffDate: string,
  keep?: (fileName: string) => boolean,
): { scanned: number; removed: number; bytes: number } {
  const cutoff = Date.parse(`${String(cutoffDate || '').slice(0, 10)}T00:00:00+07:00`);
  if (!Number.isFinite(cutoff)) return { scanned: 0, removed: 0, bytes: 0 };
  let scanned = 0;
  let removed = 0;
  let bytes = 0;
  try {
    if (!fs.existsSync(PHOTO_DIR)) return { scanned, removed, bytes };
    for (const name of fs.readdirSync(PHOTO_DIR)) {
      const p = path.join(PHOTO_DIR, name);
      try {
        const st = fs.statSync(p);
        if (!st.isFile()) continue;
        scanned++;
        if (keep && keep(name)) continue;
        if (st.mtimeMs < cutoff) {
          fs.unlinkSync(p);
          removed++;
          bytes += st.size;
        }
      } catch { /* file đang đọc: bỏ qua */ }
    }
  } catch { /* best-effort */ }
  return { scanned, removed, bytes };
}


function safeEventId(eventId: string): string {
  return String(eventId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'unknown';
}

export function attendancePhotoPath(eventId: string): string {
  return path.join(PHOTO_DIR, `${safeEventId(eventId)}.jpg`);
}

function parseDataUrl(input: string): { mime: string; buffer: Buffer } | null {
  const s = String(input || '');
  if (!s) return null;
  const m = s.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.*)$/s);
  try {
    if (m) {
      const buffer = Buffer.from(m[2], 'base64');
      if (!buffer.length) return null;
      return { mime: m[1], buffer };
    }
    const buffer = Buffer.from(s.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    if (!buffer.length) return null;
    return { mime: 'image/jpeg', buffer };
  } catch {
    return null;
  }
}

/** Ghi best-effort, không bao giờ throw. */
export function saveAttendancePhotoDisk(eventId: string, dataUrl: string): void {
  try {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed || !eventId) return;
    fs.mkdirSync(PHOTO_DIR, { recursive: true });
    fs.writeFileSync(attendancePhotoPath(eventId), parsed.buffer);
  } catch {
    /* best-effort */
  }
}

/** Đọc best-effort, trả null khi chưa có file. */
export function readAttendancePhotoDisk(eventId: string): { buffer: Buffer; mimeType: string } | null {
  try {
    const p = attendancePhotoPath(eventId);
    if (!fs.existsSync(p)) return null;
    const buffer = fs.readFileSync(p);
    if (!buffer.length) return null;
    return { buffer, mimeType: 'image/jpeg' };
  } catch {
    return null;
  }
}

/** Xóa ảnh đệm 1 sự kiện sau khi đã upload Google Drive thành công. */
export function deleteAttendancePhotoDisk(eventId: string): boolean {
  try {
    const p = attendancePhotoPath(eventId);
    if (!fs.existsSync(p)) return false;
    fs.unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}

/** File data:URL để retry upload Drive sau restart (mất event_photo memory). */
export function readAttendancePhotoDiskAsDataUrl(eventId: string): string | null {
  try {
    const hit = readAttendancePhotoDisk(eventId);
    if (!hit) return null;
    return `data:${hit.mimeType};base64,${hit.buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

// -------------------------------------------------------------
// Ảnh bằng chứng kèm phiếu bổ sung / điều chỉnh công
// -------------------------------------------------------------
export function adjustmentPhotoPath(adjustmentId: string): string {
  return path.join(PHOTO_DIR, `adj_${safeEventId(adjustmentId)}.jpg`);
}

export function saveAdjustmentPhotoDisk(adjustmentId: string, dataUrl: string): void {
  try {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed || !adjustmentId) return;
    fs.mkdirSync(PHOTO_DIR, { recursive: true });
    fs.writeFileSync(adjustmentPhotoPath(adjustmentId), parsed.buffer);
  } catch {
    /* best-effort */
  }
}

export function readAdjustmentPhotoDisk(adjustmentId: string): { buffer: Buffer; mimeType: string } | null {
  try {
    const p = adjustmentPhotoPath(adjustmentId);
    if (!fs.existsSync(p)) return null;
    const buffer = fs.readFileSync(p);
    if (!buffer.length) return null;
    return { buffer, mimeType: 'image/jpeg' };
  } catch {
    return null;
  }
}

export function hasAdjustmentPhotoDisk(adjustmentId: string): boolean {
  try {
    const p = adjustmentPhotoPath(adjustmentId);
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  } catch {
    return false;
  }
}

/** Xóa ảnh bằng chứng đệm sau khi đã upload Google Drive thành công. */
export function deleteAdjustmentPhotoDisk(adjustmentId: string): boolean {
  try {
    const p = adjustmentPhotoPath(adjustmentId);
    if (!fs.existsSync(p)) return false;
    fs.unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}
