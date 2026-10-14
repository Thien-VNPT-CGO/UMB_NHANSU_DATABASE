import jsQR from 'jsqr';
import jpeg from 'jpeg-js';

/** Mã BIN Napas (6 số trong QR VietQR) -> tên ngân hàng hiển thị.
 *  Đồng bộ với VIETQR_BANK_BY_BIN ở cổng nhân viên. */
export const VIETQR_BANK_BY_BIN: Record<string, string> = {
  '970436': 'Vietcombank', '970407': 'Techcombank', '970422': 'MBBank', '970418': 'BIDV',
  '970415': 'VietinBank', '970416': 'ACB', '970432': 'VPBank', '970423': 'TPBank',
  '970429': 'Sacombank', '970437': 'HDBank', '970441': 'VIB', '970443': 'SHB',
  '970448': 'OCB', '970426': 'MSB', '970405': 'Agribank', '970431': 'Eximbank',
  '970449': 'LPBank', '970428': 'Nam A Bank', '970433': 'VietBank', '970425': 'ABBank',
  '970409': 'Bac A Bank', '970438': 'BaoVietBank', '970430': 'PG Bank', '970427': 'Viet A Bank',
  '970419': 'NCB', '970440': 'SeABank', '970454': 'BVBank', '970452': 'KienLongBank',
  '970400': 'SaigonBank', '970406': 'DongA Bank',
};

/** Các họ phổ biến VN (so khớp theo token) — dòng rác OCR không bao giờ chứa. */
export const VN_SURNAMES = new Set([
  'NGUYEN', 'TRAN', 'LE', 'PHAM', 'HOANG', 'HUYNH', 'PHAN', 'VU', 'VO', 'DANG',
  'BUI', 'DO', 'HO', 'NGO', 'DUONG', 'LY', 'CAO', 'CHU', 'LUONG', 'DINH',
  'DOAN', 'TRUONG', 'TA', 'TRINH', 'MAI', 'LAM', 'HA', 'CHAU', 'TANG', 'TONG',
  'DIEP', 'DANG', 'QUACH', 'THACH', 'SON', 'SAM', 'HUA', 'LA', 'BAN', 'GIA',
]);

/** Chuẩn hóa tên (hoa, bỏ dấu) để so sánh OCR với hồ sơ. */
export function normalizeName(s: string): string {
  return String(s || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tên OCR có khớp tên NV trong hồ sơ không (trùng >= 2 token). */
export function holderMatchesEmployee(holder: string, fullName: string): boolean {
  const h = new Set(normalizeName(holder).split(' ').filter(Boolean));
  const n = new Set(normalizeName(fullName).split(' ').filter(Boolean));
  if (h.size < 2 || n.size < 2) return false;
  let overlap = 0;
  for (const w of h) if (n.has(w)) overlap++;
  return overlap >= 2;
}

/** Tên chủ TK có hợp lệ không: chữ + >= 2 từ + (có họ VN hoặc khớp tên NV).
 *  Dòng rác OCR (VD "fl ify Eg Ee") rớt ngay. */
export function isPlausibleHolder(holder: string, employeeName?: string): boolean {
  const t = normalizeName(holder);
  if (t.length < 6) return false;
  const toks = t.split(' ').filter(Boolean);
  if (toks.length < 2) return false;
  if (toks.some((w) => VN_SURNAMES.has(w))) return true;
  if (employeeName && holderMatchesEmployee(holder, employeeName)) return true;
  return false;
}

function parseTLV(src: string): { id: string; value: string }[] {
  const out: { id: string; value: string }[] = [];
  let i = 0;
  while (i + 4 <= src.length) {
    const id = src.slice(i, i + 2);
    const len = parseInt(src.slice(i + 2, i + 4), 10);
    if (!Number.isFinite(len) || len < 0 || i + 4 + len > src.length) break;
    out.push({ id, value: src.slice(i + 4, i + 4 + len) });
    i += 4 + len;
  }
  return out;
}

/** Parse QR VietQR (EMVCo TLV), bản tolerant: trường nào đọc được thì trả,
 *  thiếu thì để rỗng để bên gọi quyết định (sửa/gỡ/báo). */
export function parseVietQRPartial(payload: string): {
  isVietQR: boolean; bank: string; account: string; holder: string; bin: string;
} {
  const empty = { isVietQR: false, bank: '', account: '', holder: '', bin: '' };
  const s = String(payload || '').trim();
  if (!/^000201/.test(s)) return empty;
  const top = parseTLV(s);
  const acctField = top.find((f) => {
    const n = Number(f.id);
    return Number.isFinite(n) && n >= 26 && n <= 51 && f.value.includes('A000000727');
  });
  if (!acctField) return empty;
  const sub = parseTLV(acctField.value);
  const bin = (sub.find((x) => x.id === '01')?.value || '').trim();
  const account = (sub.find((x) => x.id === '02')?.value || '').trim();
  const holder = (top.find((f) => f.id === '59')?.value || '').trim();
  return {
    isVietQR: true,
    bank: VIETQR_BANK_BY_BIN[bin] || '',
    account: /^[0-9]{6,19}$/.test(account) ? account : '',
    holder,
    bin,
  };
}

/** Cắt vùng trung tâm (QR thường nằm giữa thẻ) ở độ phân giải gốc. */
function cropCenter(
  src: Buffer, srcW: number, srcH: number, frac: number
): { data: Uint8ClampedArray; w: number; h: number } {
  const w = Math.max(1, Math.floor(srcW * frac));
  const h = Math.max(1, Math.floor(srcH * frac));
  const x0 = Math.floor((srcW - w) / 2);
  const y0 = Math.floor((srcH - h) / 2);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((y0 + y) * srcW + (x0 + x)) * 4;
      const di = (y * w + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
  return { data: out, w, h };
}

/** Giải mã ảnh QR từ dataURL (jpeg) -> payload text. Thử toàn ảnh + nửa cỡ +
 *  cắt vùng trung tâm (ngang khả năng đọc của app) — ngang app mới rà đúng được
 *  QR dày. Không đọc được -> null. */
export function decodeQrDataUrl(dataUrl: string): string | null {
  try {
    const m = String(dataUrl || '').match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/);
    if (!m) return null;
    if (m[1] === 'png') return null; // jpeg-js chỉ giải JPEG (app luôn lưu JPEG)
    const buf = Buffer.from(m[2], 'base64');
    const attempts: { data: Uint8ClampedArray; w: number; h: number }[] = [];
    try {
      const full = jpeg.decode(buf, { maxMemoryUsageInMB: 512 });
      const raw = Buffer.from(full.data);
      attempts.push({ data: new Uint8ClampedArray(raw), w: full.width, h: full.height });
      for (const frac of [0.8, 0.62]) {
        attempts.push(cropCenter(raw, full.width, full.height, frac));
      }
      // Thử thêm bản nửa cỡ cho QR dày/mờ.
      if (full.width > 500 || full.height > 500) {
        const sw = Math.max(1, Math.floor(full.width / 2));
        const sh = Math.max(1, Math.floor(full.height / 2));
        const half = new Uint8ClampedArray(sw * sh * 4);
        for (let y = 0; y < sh; y++) {
          for (let x = 0; x < sw; x++) {
            const si = (y * 2 * full.width + x * 2) * 4;
            const di = (y * sw + x) * 4;
            half[di] = raw[si];
            half[di + 1] = raw[si + 1];
            half[di + 2] = raw[si + 2];
            half[di + 3] = raw[si + 3];
          }
        }
        attempts.push({ data: half, w: sw, h: sh });
      }
    } catch {
      return null;
    }
    for (const a of attempts) {
      try {
        const code = jsQR(a.data, a.w, a.h);
        if (code?.data) return code.data;
      } catch { /* thử bản tiếp theo */ }
    }
    return null;
  } catch {
    return null;
  }
}
