import { inflateSync } from 'node:zlib';
import jsQR from 'jsqr';
import jpeg from 'jpeg-js';

/** Mã BIN Napas (6 số trong QR VietQR) -> tên ngân hàng hiển thị.
 *  Đồng bộ với VIETQR_BANK_BY_BIN ở cổng nhân viên (apps/employee-web/src/App.tsx).
 *  Danh sách lấy theo API chính thức https://api.vietqr.io/v2/banks (76 tổ chức).
 *  Trước đây thiếu nhiều BIN phổ biến (CAKE/Ubank by VPBank, Timo, CIMB, HSBC,
 *  Kookmin, IBK, MoMo/ZaloPay...) nên QR hợp lệ vẫn bị báo "không nhận diện được
 *  ngân hàng". LƯU Ý: 970403 = Sacombank, 970429 = SCB (bản cũ ghi nhầm). */
export const VIETQR_BANK_BY_BIN: Record<string, string> = {
  '970400': 'SaigonBank', '970403': 'Sacombank', '970405': 'Agribank', '970406': 'Vikki',
  '970407': 'Techcombank', '970408': 'GPBank', '970409': 'BacABank', '970410': 'Standard Chartered',
  '970412': 'PVcomBank', '970414': 'MBV', '970415': 'VietinBank', '970416': 'ACB',
  '970418': 'BIDV', '970419': 'NCB', '970421': 'VRB', '970422': 'MBBank',
  '970423': 'TPBank', '970424': 'Shinhan Bank', '970425': 'ABBANK', '970426': 'MSB',
  '970427': 'VietABank', '970428': 'NamABank', '970429': 'SCB', '970430': 'PGBank',
  '970431': 'Eximbank', '970432': 'VPBank', '970433': 'VietBank', '970434': 'IndovinaBank',
  '970436': 'Vietcombank', '970437': 'HDBank', '970438': 'BaoVietBank', '970439': 'PublicBank',
  '970440': 'SeABank', '970441': 'VIB', '970442': 'HongLeong', '970443': 'SHB',
  '970444': 'CBBank', '970446': 'COOPBANK', '970448': 'OCB', '970449': 'LPBank',
  '970452': 'KienLongBank', '970454': 'BVBank', '970455': 'IBKHN', '970456': 'IBKHCM',
  '970457': 'Woori', '970458': 'UOB', '970462': 'KookminHN', '970463': 'KookminHCM',
  '970465': 'BSP', '970466': 'KEBHanaHCM', '970467': 'KEBHanaHN',
  '422589': 'CIMB', '458761': 'HSBC', '546034': 'CAKE', '546035': 'Ubank',
  '555666': 'BIDC', '668888': 'KBank', '796500': 'DBSBank', '801011': 'Nonghyup',
  '963326': 'TNEX', '963388': 'Timo', '963666': 'BNP HCM', '963668': 'BNP HN',
  '963669': 'ICBC', '963686': 'ESUN', '963688': 'BOCHK', '971005': 'ViettelMoney',
  '971011': 'VNPTMoney', '971025': 'MoMo', '971032': 'MVAS', '971101': 'ZaloPay',
  '971133': 'PVcomBank Pay', '977777': 'MAFC', '999888': 'VBSP', '168999': 'CUBHCM',
  '533948': 'Citibank',
};

/** Danh sách BIN đã biết, dùng để dò lại khi TLV bị lệch độ (QR mờ/nghiêng). */
const KNOWN_BIN_RE = new RegExp(Object.keys(VIETQR_BANK_BY_BIN).join('|'));

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
 *  thiếu thì để rỗng để bên gọi quyết định (sửa/gỡ/báo).
 *
 *  Cấu trúc chuẩn của khối tài khoản (tag 38 / 26–51):
 *    00 = GUID A000000727
 *    01 = TLV LỒNG: 00 = BIN ngân hàng (6 số), 01 = số tài khoản
 *    02 = mã dịch vụ (QRIBFTTA...)
 *  Bản cũ lấy nguyên chuỗi lồng ở tag 01 làm BIN (vd "0006970422...")
 *  nên QR hợp lệ vẫn bị báo "không nhận diện được ngân hàng".
 */
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
  let bin = '';
  let account = '';
  const nestedField = sub.find((x) => x.id === '01');
  if (nestedField) {
    const nested = parseTLV(nestedField.value);
    const nBin = (nested.find((x) => x.id === '00')?.value || '').trim();
    const nAcc = (nested.find((x) => x.id === '01')?.value || '').trim();
    if (/^\d{6}$/.test(nBin)) {
      bin = nBin;
      account = nAcc;
    }
  }
  // Biến thể vài ngân hàng tự sinh: BIN nằm ngay tag 01 (6 số), STK ở tag 02.
  if (!bin && nestedField && /^\d{6}$/.test(nestedField.value.trim())) {
    bin = nestedField.value.trim();
    account = (sub.find((x) => x.id === '02')?.value || '').trim();
  }
  // QR mờ/nghiêng làm TLV lệch độ: dò BIN đã biết ngay sau nhãn AID thay vì
  // nguyên chuỗi (tránh khớp nhầm số tài khoản). Dùng đủ danh sách BIN thay vì
  // chỉ 9704xx/9705xx để nhận cả CAKE/Ubank (546034/546035), Timo (963388)...
  if (!/^\d{6}$/.test(bin)) {
    const aidIdx = s.indexOf('A000000727');
    const m = (aidIdx >= 0 ? s.slice(aidIdx) : s).match(KNOWN_BIN_RE);
    if (m) bin = m[0];
  }
  const holder = (top.find((f) => f.id === '59')?.value || '').trim();
  return {
    isVietQR: true,
    bank: VIETQR_BANK_BY_BIN[bin] || '',
    account: /^[0-9]{6,19}$/.test(account) ? account : '',
    holder,
    bin,
  };
}

/** Bộ lọc Paeth chuẩn PNG (dùng khi giải nén ảnh PNG). */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Giải ảnh PNG -> RGBA để jsQR đọc. Hỗ trợ bit depth 1/2/4/8/16, không
 * interlace, các color type 0/2/3/4/6 (gray/RGB/palette/gray+alpha/RGBA).
 * QR code xuất từ nhiều ngân hàng là PNG 1-bit palette nên phải hỗ trợ cả
 * bit depth nhỏ hơn 8 (trước đây chỉ đọc 8-bit nên bỏ sót). Dùng zlib của Node
 * nên không cần thêm thư viện. Không hỗ trợ -> null.
 */
function decodePng(buf: Buffer): { data: Uint8ClampedArray; w: number; h: number } | null {
  try {
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;
    let off = 8;
    let w = 0;
    let h = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    let palette: Buffer | null = null;
    const idat: Buffer[] = [];
    while (off + 8 <= buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.toString('ascii', off + 4, off + 8);
      const start = off + 8;
      const end = start + len;
      if (end + 4 > buf.length) break;
      const chunk = buf.subarray(start, end);
      if (type === 'IHDR') {
        w = chunk.readUInt32BE(0);
        h = chunk.readUInt32BE(4);
        bitDepth = chunk[8];
        colorType = chunk[9];
        interlace = chunk[12];
      } else if (type === 'PLTE') {
        palette = Buffer.from(chunk);
      } else if (type === 'IDAT') {
        idat.push(Buffer.from(chunk));
      } else if (type === 'IEND') {
        break;
      }
      off = end + 4;
    }
    if (!w || !h || interlace !== 0 || idat.length === 0) return null;
    if (![1, 2, 4, 8, 16].includes(bitDepth)) return null;
    const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1
      : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
    if (!channels) return null;
    // Palette chỉ hợp lệ với bit depth <= 8; các color type nhiều kênh phải 8/16.
    if (colorType === 3 && bitDepth === 16) return null;
    if (bitDepth < 8 && colorType !== 0 && colorType !== 3) return null;
    const bitsPerPixel = channels * bitDepth;
    const stride = Math.ceil((w * bitsPerPixel) / 8);
    // bpp = số byte tối thiểu để chứa 1 pixel, dùng cho bộ lọc scanline.
    const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8));
    const inflated = inflateSync(Buffer.concat(idat));
    if (inflated.length < (stride + 1) * h) return null;
    const pixels = Buffer.alloc(stride * h);
    let pos = 0;
    for (let y = 0; y < h; y++) {
      const filter = inflated[pos++];
      const row = y * stride;
      for (let x = 0; x < stride; x++) {
        const v = inflated[pos++];
        const a = x >= bpp ? pixels[row + x - bpp] : 0;
        const b = y > 0 ? pixels[row - stride + x] : 0;
        const c = x >= bpp && y > 0 ? pixels[row - stride + x - bpp] : 0;
        let out: number;
        if (filter === 0) out = v;
        else if (filter === 1) out = v + a;
        else if (filter === 2) out = v + b;
        else if (filter === 3) out = v + ((a + b) >> 1);
        else if (filter === 4) out = v + paeth(a, b, c);
        else return null;
        pixels[row + x] = out & 0xff;
      }
    }
    const rgba = new Uint8ClampedArray(w * h * 4);
    const maxSample = (1 << bitDepth) - 1;
    const sampleAt = (pixelIndex: number, channel: number): number => {
      const y = Math.floor(pixelIndex / w);
      const x = pixelIndex % w;
      const row = y * stride;
      if (bitDepth === 8) return pixels[row + x * channels + channel];
      if (bitDepth === 16) {
        const p = row + (x * channels + channel) * 2;
        return (pixels[p] << 8) | pixels[p + 1];
      }
      // bit depth 1/2/4: mỗi scanline có padding ở cuối nên phải tính theo
      // hàng, không được coi toàn bộ buffer là 1 dòng bit liền mạch (sẽ lệch
      // dần sang phải ở mỗi hàng và làm QR bị xé chéo).
      const bitPos = x * bitDepth;
      const byte = pixels[row + Math.floor(bitPos / 8)];
      const shift = 8 - bitDepth - (bitPos % 8);
      return (byte >> shift) & maxSample;
    };
    const to8 = (v: number): number => bitDepth === 8 ? v
      : bitDepth === 16 ? (v >> 8) : Math.round((v * 255) / maxSample);
    for (let i = 0; i < w * h; i++) {
      let r: number;
      let g: number;
      let b: number;
      let a = 255;
      if (colorType === 0) {
        r = g = b = to8(sampleAt(i, 0));
      } else if (colorType === 2) {
        r = to8(sampleAt(i, 0)); g = to8(sampleAt(i, 1)); b = to8(sampleAt(i, 2));
      } else if (colorType === 3) {
        const idx = sampleAt(i, 0) * 3;
        if (!palette || idx + 2 >= palette.length) return null;
        r = palette[idx]; g = palette[idx + 1]; b = palette[idx + 2];
      } else if (colorType === 4) {
        r = g = b = to8(sampleAt(i, 0)); a = to8(sampleAt(i, 1));
      } else {
        r = to8(sampleAt(i, 0)); g = to8(sampleAt(i, 1));
        b = to8(sampleAt(i, 2)); a = to8(sampleAt(i, 3));
      }
      const o = i * 4;
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
    }
    return { data: rgba, w, h };
  } catch {
    return null;
  }
}

/** Cắt vùng trung tâm (QR thường nằm giữa thẻ) ở độ phân giải gốc. */
function cropCenter(
  src: Uint8ClampedArray, srcW: number, srcH: number, frac: number
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

/** Dựng các biến thể ảnh để thử đọc QR: toàn ảnh, cắt vùng trung tâm, nửa cỡ. */
function qrAttempts(
  raw: Uint8ClampedArray, width: number, height: number,
): { data: Uint8ClampedArray; w: number; h: number }[] {
  const attempts: { data: Uint8ClampedArray; w: number; h: number }[] = [
    { data: raw, w: width, h: height },
  ];
  for (const frac of [0.8, 0.62]) {
    attempts.push(cropCenter(raw, width, height, frac));
  }
  // Thử thêm bản nửa cỡ cho QR dày/mờ.
  if (width > 500 || height > 500) {
    const sw = Math.max(1, Math.floor(width / 2));
    const sh = Math.max(1, Math.floor(height / 2));
    const half = new Uint8ClampedArray(sw * sh * 4);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const si = (y * 2 * width + x * 2) * 4;
        const di = (y * sw + x) * 4;
        half[di] = raw[si];
        half[di + 1] = raw[si + 1];
        half[di + 2] = raw[si + 2];
        half[di + 3] = raw[si + 3];
      }
    }
    attempts.push({ data: half, w: sw, h: sh });
  }
  return attempts;
}

/** Giải mã ảnh QR từ dataURL (JPEG hoặc PNG) -> payload text. Thử toàn ảnh +
 *  nửa cỡ + cắt vùng trung tâm (ngang khả năng đọc của app) — QR dày/mờ vẫn
 *  đọc được. Không đọc được -> null. */
export function decodeQrDataUrl(dataUrl: string): string | null {
  try {
    const m = String(dataUrl || '').match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/s);
    if (!m) return null;
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length) return null;
    const subtype = m[1].toLowerCase();
    let decoded: { data: Uint8ClampedArray; w: number; h: number } | null = null;
    try {
      if (subtype === 'png') {
        decoded = decodePng(buf);
      } else {
        const full = jpeg.decode(buf, { maxMemoryUsageInMB: 512 });
        decoded = { data: new Uint8ClampedArray(full.data), w: full.width, h: full.height };
      }
    } catch {
      return null;
    }
    if (!decoded) return null;
    for (const a of qrAttempts(decoded.data, decoded.w, decoded.h)) {
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
