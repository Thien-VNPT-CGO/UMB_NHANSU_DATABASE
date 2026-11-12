/**
 * Hợp đồng lao động của nhân viên (Thử việc / Chính thức).
 *
 * Metadata lưu 1 ô JSON trên NHAN_VIEN_MASTER (cột "Hợp Đồng Lao Động (JSON)"),
 * file thật nằm trên Google Drive (chính) + đĩa VPS (fallback). Không lưu
 * base64 trong Sheet để tránh phình ô 50.000 ký tự.
 */

import type { EmployeeContractDocMeta, EmployeeContractDocs } from '@ubm/shared';

export type ContractKind = 'PROBATION' | 'OFFICIAL' | 'ID_CARD_FRONT' | 'ID_CARD_BACK' | 'HEALTH_CERT';
export type ContractKey = 'probation' | 'official' | 'id_card_front' | 'id_card_back' | 'health_cert';

/** Dùng chung type với @ubm/shared để FE/BE không lệch cấu trúc ô JSON. */
export type ContractDocMeta = EmployeeContractDocMeta;
export type ContractDocs = EmployeeContractDocs;

/**
 * Kích thước tối đa 1 file hồ sơ (hợp đồng / CCCD / giấy khám sức khỏe).
 *
 * 20MB — bản scan GKSK/CCCD từ máy scan hoặc ảnh điện thoại thường 8–15MB.
 * Base64 phình ~33% (~27MB) nên route hồ sơ dùng parser JSON riêng 40MB
 * (xem app.ts), không dùng trần 10MB của các API thường.
 */
export const CONTRACT_MAX_BYTES = 20 * 1024 * 1024;

export const CONTRACT_KIND_LABEL: Record<ContractKey, string> = {
  probation: 'Hợp đồng thử việc',
  official: 'Hợp đồng chính thức',
  id_card_front: 'Mặt trước CCCD',
  id_card_back: 'Mặt sau CCCD',
  health_cert: 'Giấy khám sức khỏe',
};

/**
 * Tên file cố định trên Drive cho từng loại tài liệu.
 * Dùng upsert theo tên nên mỗi nhân viên chỉ có đúng 5 file:
 * 2 hợp đồng (thử việc/chính thức) + 2 ảnh CCCD (trước/sau) + giấy khám sức khỏe.
 */
export const CONTRACT_DRIVE_BASE_NAME: Record<ContractKey, string> = {
  probation: 'Hợp đồng thử việc',
  official: 'Hợp đồng chính thức',
  id_card_front: 'CCCD mặt trước',
  id_card_back: 'CCCD mặt sau',
  health_cert: 'Giấy khám sức khỏe',
};

export function contractDriveFileName(key: ContractKey, ext: string): string {
  return `${CONTRACT_DRIVE_BASE_NAME[key]}.${String(ext || '').replace(/^\./, '') || 'bin'}`;
}

export function contractKeyOf(kind: unknown): ContractKey | null {
  const k = String(kind || '').trim().toUpperCase();
  if (k === 'PROBATION' || k === 'THU_VIEC' || k === 'THỬ VIỆC') return 'probation';
  if (k === 'OFFICIAL' || k === 'CHINH_THUC' || k === 'CHÍNH THỨC') return 'official';
  if (k === 'ID_CARD_FRONT' || k === 'CCCD_FRONT' || k === 'CCCD_TRUOC' || k === 'MAT_TRUOC' || k === 'MẶT TRƯỚC' || k === 'id_card_front') return 'id_card_front';
  if (k === 'ID_CARD_BACK' || k === 'CCCD_BACK' || k === 'CCCD_SAU' || k === 'MAT_SAU' || k === 'MẶT SAU' || k === 'id_card_back') return 'id_card_back';
  if (k === 'HEALTH_CERT' || k === 'GIAY_KHAM_SUC_KHOE' || k === 'KHAM_SUC_KHOE' || k === 'HEALTH' || k === 'HEALTH_CERTIFICATE') return 'health_cert';
  return null;
}

export function contractKindOfKey(key: ContractKey): ContractKind {
  if (key === 'official') return 'OFFICIAL';
  if (key === 'id_card_front') return 'ID_CARD_FRONT';
  if (key === 'id_card_back') return 'ID_CARD_BACK';
  if (key === 'health_cert') return 'HEALTH_CERT';
  return 'PROBATION';
}

function normalizeMeta(raw: any): ContractDocMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const file_name = String(raw.file_name || raw.fileName || '').trim();
  if (!file_name) return null;
  const size = Number(raw.size);
  return {
    drive_id: String(raw.drive_id || raw.driveId || '').trim(),
    file_name: file_name.slice(0, 240),
    mime_type: String(raw.mime_type || raw.mimeType || 'application/octet-stream').trim().slice(0, 120),
    size: Number.isFinite(size) && size > 0 ? Math.floor(size) : 0,
    uploaded_at: String(raw.uploaded_at || raw.uploadedAt || '').trim(),
    uploaded_by: String(raw.uploaded_by || raw.uploadedBy || '').trim(),
    storage: raw.storage === 'DRIVE' || raw.storage === 'DISK' ? raw.storage : undefined,
  };
}

/** Chuẩn hóa ô JSON (object hoặc chuỗi JSON) -> ContractDocs an toàn. */
export function parseContractDocs(value: unknown): ContractDocs {
  let raw: any = value;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return {};
    try { raw = JSON.parse(s); } catch { return {}; }
  }
  if (!raw || typeof raw !== 'object') return {};
  const out: ContractDocs = {};
  const probation = normalizeMeta(raw.probation);
  const official = normalizeMeta(raw.official);
  const id_card_front = normalizeMeta(raw.id_card_front || raw.idCardFront);
  const id_card_back = normalizeMeta(raw.id_card_back || raw.idCardBack);
  const health_cert = normalizeMeta(raw.health_cert || raw.healthCert || raw.HEALTH_CERT);
  if (probation) out.probation = probation;
  if (official) out.official = official;
  if (id_card_front) out.id_card_front = id_card_front;
  if (id_card_back) out.id_card_back = id_card_back;
  if (health_cert) out.health_cert = health_cert;
  return out;
}

/** Ô Sheet: JSON gọn (rỗng nếu chưa có hợp đồng/CCCD/giấy khám sức khỏe nào). */
export function contractDocsCell(value: unknown): string {
  const docs = parseContractDocs(value);
  return docs.probation || docs.official || docs.id_card_front || docs.id_card_back || docs.health_cert
    ? JSON.stringify(docs)
    : '';
}

/** MIME + phần mở rộng hợp lệ cho file hợp đồng. */
const CONTRACT_MIME_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  // Ảnh chụp từ iPhone (HEIC/HEIF) — Drive lưu nguyên bản, trình duyệt chỉ
  // xem trước được sau khi tải về nên vẫn chấp nhận để HR không bị chặn.
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

export function contractFileInfo(
  mimeType: string,
  fileName: string,
): { mime: string; ext: string } | null {
  const mime = String(mimeType || '').trim().toLowerCase();
  const fromMime = CONTRACT_MIME_EXT[mime];
  if (fromMime) return { mime, ext: fromMime };
  // Trình duyệt có thể gửi mime rỗng/octet-stream -> đoán theo đuôi file.
  const ext = String(fileName || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1] || '';
  const byExt: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  const guessed = byExt[ext];
  if (!guessed) return null;
  return { mime: guessed, ext: ext === 'jpeg' ? 'jpg' : ext };
}

/** Kiểm tra nhanh chữ ký file để chặn file giả mạo/đổi đuôi. */
export function contractBufferLooksValid(buffer: Buffer, mime: string): boolean {
  if (!buffer?.length) return false;
  const b = buffer;
  if (mime === 'application/pdf') return b.length > 4 && b.toString('ascii', 0, 4) === '%PDF';
  if (mime === 'image/jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === 'image/png') {
    return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  }
  if (mime === 'image/webp') {
    return b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
  }
  // HEIC/HEIF: container ISO-BMFF, box "ftyp" ở byte 4–8 + brand HEIC/HEIF/Aple.
  if (mime === 'image/heic' || mime === 'image/heif') {
    if (b.length < 12 || b.toString('ascii', 4, 8) !== 'ftyp') return false;
    const brand = b.toString('ascii', 8, 12);
    return ['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'heif'].includes(brand);
  }
  // DOC/DOCX đều là container OLE/ZIP — chấp nhận chữ ký tương ứng.
  if (mime.includes('word') || mime.includes('officedocument')) {
    const zip = b[0] === 0x50 && b[1] === 0x4b;
    const ole = b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
    return zip || ole;
  }
  return false;
}
