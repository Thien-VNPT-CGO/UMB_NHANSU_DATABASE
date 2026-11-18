import fs from 'fs';
import path from 'path';

/**
 * Ảnh bằng chứng của Phiếu giải trình điểm quên chấm.
 *
 * Kiến trúc dữ liệu: KHÔNG lưu base64 trong PostgreSQL. App tài xế nén ảnh rồi
 * gửi data-URL; backend ghi file xuống đĩa VPS ngay khi tạo phiếu, DB chỉ giữ
 * metadata (photo_id/mime/size). Ảnh được phục vụ qua route có xác thực.
 *
 * Dùng thư mục riêng (không nằm trong ATTENDANCE_PHOTO_DIR) để job dọn ảnh
 * điểm danh hằng tháng không xóa nhầm bằng chứng giải trình.
 */

function resolveDir(): string {
  if (process.env.EV_EXPLANATION_PHOTO_DIR) {
    try { fs.mkdirSync(process.env.EV_EXPLANATION_PHOTO_DIR, { recursive: true }); } catch { /* ignore */ }
    return process.env.EV_EXPLANATION_PHOTO_DIR;
  }
  const cwd = process.cwd();
  const rootData = path.join(cwd, 'data', 'ev-explanation-photos');
  const backendData = path.join(cwd, 'apps', 'backend', 'data', 'ev-explanation-photos');
  let selected = rootData;
  if (!fs.existsSync(path.join(cwd, 'data')) && fs.existsSync(path.join(cwd, 'apps', 'backend', 'data'))) {
    selected = backendData;
  }
  try { fs.mkdirSync(selected, { recursive: true }); } catch { /* ignore */ }
  return selected;
}

const PHOTO_DIR = resolveDir();

function safeId(value: string): string {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'unknown';
}

function extForMime(mime: string): string {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  return 'jpg';
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

export interface SavedExplanationPhoto {
  mime_type: string;
  size_bytes: number;
}

/** Ghi 1 ảnh giải trình. Throw khi data-URL hỏng/không phải ảnh. */
export function saveExplanationPhoto(
  ticketId: string,
  photoId: string,
  dataUrl: string,
  maxBytes = 3_000_000,
): SavedExplanationPhoto {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error('PHOTO_INVALID: Ảnh không hợp lệ hoặc bị hỏng');
  if (!/^image\//i.test(parsed.mime)) throw new Error('PHOTO_INVALID: Tệp tải lên không phải ảnh');
  if (parsed.buffer.length > maxBytes) {
    throw new Error(`PHOTO_TOO_LARGE: Ảnh vượt quá ${Math.round(maxBytes / 1_000_000)}MB sau khi nén`);
  }
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  const file = path.join(PHOTO_DIR, `${safeId(ticketId)}_${safeId(photoId)}.${extForMime(parsed.mime)}`);
  fs.writeFileSync(file, parsed.buffer);
  return { mime_type: parsed.mime, size_bytes: parsed.buffer.length };
}

/** Đọc ảnh để stream về client. Trả null khi không tìm thấy file. */
export function readExplanationPhoto(
  ticketId: string,
  photoId: string,
  mimeType?: string,
): { buffer: Buffer; mimeType: string } | null {
  try {
    const ext = extForMime(String(mimeType || 'image/jpeg'));
    const candidates = [ext, 'jpg', 'png', 'webp', 'gif'];
    for (const e of Array.from(new Set(candidates))) {
      const file = path.join(PHOTO_DIR, `${safeId(ticketId)}_${safeId(photoId)}.${e}`);
      if (!fs.existsSync(file)) continue;
      const buffer = fs.readFileSync(file);
      if (!buffer.length) continue;
      return { buffer, mimeType: e === 'jpg' ? 'image/jpeg' : `image/${e}` };
    }
    return null;
  } catch {
    return null;
  }
}

/** Xóa toàn bộ ảnh của 1 phiếu (dùng khi phiếu bị xóa hẳn). */
export function deleteExplanationPhotos(ticketId: string): number {
  let removed = 0;
  try {
    if (!fs.existsSync(PHOTO_DIR)) return 0;
    const prefix = `${safeId(ticketId)}_`;
    for (const name of fs.readdirSync(PHOTO_DIR)) {
      if (!name.startsWith(prefix)) continue;
      try {
        fs.unlinkSync(path.join(PHOTO_DIR, name));
        removed++;
      } catch { /* best-effort */ }
    }
  } catch { /* best-effort */ }
  return removed;
}
