import { createHash } from 'crypto';

export interface SheetsContentFingerprint {
  /** Hash tổng của toàn bộ nội dung (dùng để biết có thay đổi hay không). */
  signature: string;
  /** Hash riêng từng tab + khoá `__extra__` cho dữ liệu ứng viên. */
  tabs: Record<string, string>;
}

function hashRows(rows: string[][] | undefined): string {
  const hash = createHash('sha1');
  if (!Array.isArray(rows)) return hash.digest('hex');
  for (const row of rows) {
    if (!Array.isArray(row)) {
      hash.update(String(row ?? ''));
      hash.update('\u001e');
      continue;
    }
    // Nối từng dòng bằng ký tự phân cách không thể xuất hiện trong dữ liệu
    // người dùng nhập để tránh đụng độ kiểu ["ab","c"] vs ["a","bc"].
    hash.update(row.map(cell => String(cell ?? '')).join('\u001f'));
    hash.update('\u001e');
  }
  return hash.digest('hex');
}

/**
 * Dấu vân tay nội dung các tab Google Sheets tại một thời điểm.
 *
 * Trước đây nhịp pull chỉ so sánh `counts` (số dòng) nên sửa nội dung một ô
 * KHÔNG làm counts đổi => server không bắn socket `data:updated`, admin phải
 * đổi tab/tải lại mới thấy dữ liệu mới. Hash toàn bộ giá trị ô (kể cả tab
 * ứng viên đọc từ spreadsheet riêng) để phát hiện đúng mọi thay đổi nội dung.
 *
 * Dùng SHA-1 chỉ với mục đích so sánh nội bộ (không phải bảo mật); thứ tự tab
 * được sắp xếp để kết quả ổn định giữa các lần đọc.
 */
export function fingerprintSheetsContent(
  tabs: Record<string, string[][] | undefined>,
  extraRows: string[][] = [],
): SheetsContentFingerprint {
  const tabHashes: Record<string, string> = {};
  const titles = Object.keys(tabs).sort();
  for (const title of titles) {
    tabHashes[title] = hashRows(tabs[title]);
  }
  tabHashes.__extra__ = hashRows(extraRows);

  const combined = createHash('sha1');
  for (const title of Object.keys(tabHashes).sort()) {
    combined.update(title);
    combined.update('\u0000');
    combined.update(tabHashes[title]);
    combined.update('\u001e');
  }

  return { signature: combined.digest('hex'), tabs: tabHashes };
}

/** Tiện dụng khi chỉ cần hash tổng (test, log). */
export function computeSheetsContentSignature(
  tabs: Record<string, string[][] | undefined>,
  extraRows: string[][] = [],
): string {
  return fingerprintSheetsContent(tabs, extraRows).signature;
}
