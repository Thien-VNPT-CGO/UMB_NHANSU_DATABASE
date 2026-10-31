import fs from 'fs';
import path from 'path';

/**
 * Lưu file Hợp đồng lao động (Thử việc / Chính thức) xuống đĩa VPS.
 *
 * Google Drive là nơi lưu chính, nhưng Drive có thể chưa cấu hình / lỗi mạng.
 * Bản trên đĩa đảm bảo HR luôn mở được hợp đồng vừa upload (và retry Drive sau),
 * đồng thời cho phép chạy dev/test không cần service account.
 */

export type ContractKind = 'PROBATION' | 'OFFICIAL' | 'ID_CARD_FRONT' | 'ID_CARD_BACK';

function resolveContractDir(): string {
  if (process.env.CONTRACT_FILE_DIR) {
    try { fs.mkdirSync(process.env.CONTRACT_FILE_DIR, { recursive: true }); } catch { /* ignore */ }
    return process.env.CONTRACT_FILE_DIR;
  }
  const cwd = process.cwd();
  const rootData = path.join(cwd, 'data', 'contracts');
  const backendData = path.join(cwd, 'apps', 'backend', 'data', 'contracts');
  let selected = rootData;
  if (!fs.existsSync(path.join(cwd, 'data')) && fs.existsSync(path.join(cwd, 'apps', 'backend', 'data'))) {
    selected = backendData;
  }
  try { fs.mkdirSync(selected, { recursive: true }); } catch { /* ignore */ }
  return selected;
}

const CONTRACT_DIR = resolveContractDir();

/** Thư mục hợp đồng trên VPS (dùng cho kiểm tra/backup nếu cần). */
export function contractDir(): string {
  return CONTRACT_DIR;
}

function safeId(value: string): string {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'unknown';
}

function filePrefix(employeeId: string, kind: ContractKind): string {
  return `${safeId(employeeId)}_${kind}`;
}

/** Đường dẫn file hợp đồng (ext rỗng = file .bin). */
export function contractFilePath(employeeId: string, kind: ContractKind, ext = 'bin'): string {
  const cleanExt = String(ext || 'bin').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'bin';
  return path.join(CONTRACT_DIR, `${filePrefix(employeeId, kind)}.${cleanExt}`);
}

/** Ghi đè file hợp đồng; trả về tên file đã lưu (best-effort, không throw). */
export function saveContractDisk(
  employeeId: string,
  kind: ContractKind,
  ext: string,
  buffer: Buffer,
): boolean {
  try {
    if (!employeeId || !buffer?.length) return false;
    fs.mkdirSync(CONTRACT_DIR, { recursive: true });
    // Mỗi loại hợp đồng chỉ giữ 1 file: xóa bản cũ khác phần mở rộng trước.
    removeContractDisk(employeeId, kind);
    fs.writeFileSync(contractFilePath(employeeId, kind, ext), buffer);
    return true;
  } catch {
    return false;
  }
}

/** Đọc file hợp đồng đã lưu trên đĩa (null nếu chưa có). */
export function readContractDisk(
  employeeId: string,
  kind: ContractKind,
): { buffer: Buffer; fileName: string } | null {
  try {
    if (!employeeId || !fs.existsSync(CONTRACT_DIR)) return null;
    const prefix = `${filePrefix(employeeId, kind)}.`;
    const hit = fs.readdirSync(CONTRACT_DIR).find((name) => name.startsWith(prefix));
    if (!hit) return null;
    const buffer = fs.readFileSync(path.join(CONTRACT_DIR, hit));
    if (!buffer.length) return null;
    return { buffer, fileName: hit };
  } catch {
    return null;
  }
}

/** Xóa file hợp đồng trên đĩa. */
export function removeContractDisk(employeeId: string, kind: ContractKind): boolean {
  try {
    if (!employeeId || !fs.existsSync(CONTRACT_DIR)) return false;
    const prefix = `${filePrefix(employeeId, kind)}.`;
    let removed = false;
    for (const name of fs.readdirSync(CONTRACT_DIR)) {
      if (!name.startsWith(prefix)) continue;
      try {
        fs.unlinkSync(path.join(CONTRACT_DIR, name));
        removed = true;
      } catch { /* file đang đọc: bỏ qua */ }
    }
    return removed;
  } catch {
    return false;
  }
}
