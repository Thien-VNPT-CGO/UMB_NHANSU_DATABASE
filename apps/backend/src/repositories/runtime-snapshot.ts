import fs from 'fs';
import path from 'path';

/**
 * Snapshot dữ liệu runtime (bộ nhớ của MockSheetsAdapter) xuống đĩa.
 *
 * Mục đích: sau khi restart/deploy, backend phục vụ được ngay dữ liệu lần pull
 * gần nhất thay vì trả 0 nhân viên / 502 trong 1-2 phút chờ Google Sheets.
 * Snapshot chỉ là cache khởi động; pull nền vẫn chạy và cập nhật tiếp.
 */
export interface RuntimeSnapshotMeta {
  version: 1;
  savedAt: string;
  /** Spreadsheet nguồn — tránh nạp nhầm snapshot của môi trường/Sheet khác. */
  spreadsheetId?: string | null;
  signature?: string | null;
  tabSignatures?: Record<string, string>;
  pulledAt?: string | null;
  counts?: any;
}

export interface RuntimeSnapshotFile {
  version: 1;
  meta: RuntimeSnapshotMeta;
  state: any;
}

export function runtimeSnapshotPath(): string {
  const configured = process.env.RUNTIME_SNAPSHOT_FILE?.trim();
  return configured || path.resolve(process.cwd(), 'data/runtime-snapshot.json');
}

/** Đọc đồng bộ lúc khởi động (trước khi server listen) để có dữ liệu ngay. */
export function readRuntimeSnapshot(filePath = runtimeSnapshotPath()): RuntimeSnapshotFile | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || !parsed.state || typeof parsed.state !== 'object') {
      console.warn(`[runtime-snapshot] Bỏ qua file không hợp lệ: ${filePath}`);
      return null;
    }
    if (!parsed.meta || typeof parsed.meta !== 'object') {
      parsed.meta = { version: 1, savedAt: new Date(0).toISOString() };
    }
    return parsed as RuntimeSnapshotFile;
  } catch (err: any) {
    console.warn(`[runtime-snapshot] Không đọc được ${filePath}: ${err?.message || err}`);
    return null;
  }
}

let writeChain: Promise<void> = Promise.resolve();

/** Ghi atomic (file tạm -> rename) để không bao giờ đọc phải snapshot dở dang. */
export function writeRuntimeSnapshot(
  state: any,
  meta: Omit<RuntimeSnapshotMeta, 'version' | 'savedAt'> & { savedAt?: string },
  filePath = runtimeSnapshotPath(),
): Promise<boolean> {
  const payload = JSON.stringify({
    version: 1,
    meta: {
      ...meta,
      version: 1,
      savedAt: meta.savedAt || new Date().toISOString(),
    },
    state,
  });

  const run = writeChain.then(async () => {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.promises.writeFile(tmp, payload, { encoding: 'utf8', mode: 0o600 });
      try {
        await fs.promises.rename(tmp, filePath);
      } catch {
        // Windows đôi khi không rename đè file đang tồn tại.
        await fs.promises.rm(filePath, { force: true }).catch(() => undefined);
        await fs.promises.rename(tmp, filePath);
      }
      // Snapshot có PII (lương, tài khoản ngân hàng); cố gắng giới hạn quyền đọc.
      await fs.promises.chmod(filePath, 0o600).catch(() => undefined);
      return true;
    } finally {
      // Luôn dọn file tạm nếu còn sót lại để không tích tụ làm đầy dung lượng đĩa
      await fs.promises.rm(tmp, { force: true }).catch(() => undefined);
    }
  }).catch((err: any) => {
    console.warn(`[runtime-snapshot] Ghi snapshot lỗi (${filePath}):`, err?.message || err);
    return false;
  });

  // Chuỗi ghi không được chết vì một lần lỗi.
  writeChain = run.then(() => undefined);
  return run;
}
