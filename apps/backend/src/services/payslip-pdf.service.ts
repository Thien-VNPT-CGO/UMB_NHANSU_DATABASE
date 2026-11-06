/**
 * Dịch vụ tạo PDF PHIẾU LƯƠNG (server-side, chuẩn A4 portrait).
 *
 * - Đầy đủ thông tin: đơn vị, kỳ lương, mã phiếu, họ tên/mã NV/chi nhánh/khối,
 *   breakdown các khoản hưởng – khấu trừ, THỰC LÃNH (số + bằng chữ),
 *   VietQR chuyển khoản, ghi chú kế toán (nếu có) và 3 chữ ký (KT – GĐ – NV).
 * - Font Be Vietnam Pro (OFL) nhúng trực tiếp → hiển thị đúng dấu tiếng Việt.
 * - Chữ ký lấy từ slip.sign_lap / sign_giamdoc / sign_nhanvien (dataURL PNG).
 */
import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
import PDFDocument from 'pdfkit';
import {
  payslipStage,
  PAYSLIP_STAGE_LABEL,
  stripAccents,
  type PayslipStage,
} from '@ubm/shared';

const ASSETS_DIR = path.resolve(__dirname, '..', '..', 'assets');
const FONT_DIR = path.join(ASSETS_DIR, 'fonts');
const LOGO_PATH = path.join(ASSETS_DIR, 'logo.jpg');

const BRAND = '#E85D92';
const BRAND_DARK = '#B4457C';
const TEXT = '#273142';
const MUTED = '#8A7B76';
const LINE = '#EBE0DC';
const SOFT = '#FAF7F5';
const SOFT_BRAND = '#FDF2F7';
const OK = '#0F9D6B';
const OK_SOFT = '#ECFDF5';

const STAGE_COLORS: Record<PayslipStage, { bg: string; fg: string }> = {
  DRAFT: { bg: '#F1F5F9', fg: '#475569' },
  CHO_GD_DUYET: { bg: '#FEF3C7', fg: '#92400E' },
  CHO_GUI_NV: { bg: '#E0E7FF', fg: '#3730A3' },
  CHO_NV_KY: { bg: '#FFEDD5', fg: '#9A3412' },
  CHO_CHUYEN_KHOAN: { bg: '#FEF9C3', fg: '#854D0E' },
  PAID: { bg: '#DCFCE7', fg: '#166534' },
};

// ---------------------------------------------------------------- utils
const vnd = (n: unknown) => `${Number(n || 0).toLocaleString('vi-VN')}`;

const CHUSO = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

function readGroup(n: number, withZeroHundred: boolean): string {
  const tram = Math.floor(n / 100);
  const chuc = Math.floor((n % 100) / 10);
  const donvi = n % 10;
  const parts: string[] = [];
  if (tram > 0 || withZeroHundred) parts.push(`${CHUSO[tram]} trăm`);
  if (chuc > 1) parts.push(`${CHUSO[chuc]} mươi`);
  else if (chuc === 1) parts.push('mười');
  else if (chuc === 0 && donvi > 0 && (tram > 0 || withZeroHundred)) parts.push('lẻ');
  if (donvi > 0) {
    if (donvi === 1 && chuc > 1) parts.push('mốt');
    else if (donvi === 5 && chuc >= 1) parts.push('lăm');
    else parts.push(CHUSO[donvi]);
  }
  return parts.join(' ');
}

/** 4.350.000 → "Bốn triệu ba trăm năm mươi nghìn đồng." */
export function docSoVietNam(input: number): string {
  const num = Math.floor(Math.abs(Number(input) || 0));
  if (num === 0) return 'Không đồng.';
  if (num >= 1e12) return `${Number(input).toLocaleString('vi-VN')} đồng.`;
  const g = [num % 1000, Math.floor(num / 1e3) % 1000, Math.floor(num / 1e6) % 1000, Math.floor(num / 1e9)];
  const units = ['', 'nghìn', 'triệu', 'tỷ'];
  const parts: string[] = [];
  for (let i = 3; i >= 0; i--) {
    if (g[i] === 0) continue;
    const isFirst = parts.length === 0;
    parts.push(readGroup(g[i], !isFirst) + (units[i] ? ` ${units[i]}` : ''));
  }
  const s = parts.join(' ').replace(/\s+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1) + ' đồng.';
}

/** Mã VietQR ngân hàng còn hiệu lực cho img.vietqr.io. */
export function vietQrBankSlug(bankName?: string | null): string {
  const s = String(bankName || '').trim().toLowerCase();
  if (s.includes('vietcom') || s === 'vcb') return 'vietcombank';
  if (s.includes('techcom') || s === 'tcb') return 'techcombank';
  if (s.includes('sacom') || s.includes('stb')) return 'sacombank';
  if (s.includes('mb') || s.includes('quân đội') || s.includes('quan doi')) return 'mbbank';
  if (s.includes('bidv')) return 'bidv';
  if (s.includes('vietin') || s === 'ctg') return 'vietinbank';
  if (s.includes('acb') || s.includes('á châu') || s.includes('a chau')) return 'acb';
  if (s.includes('vpbank') || s.includes('vp')) return 'vpbank';
  if (s.includes('tpbank') || s.includes('tp') || s.includes('tiên phong') || s.includes('tien phong')) return 'tpbank';
  if (s.includes('hdbank') || s.includes('hdb')) return 'hdbank';
  if (s.includes('vib')) return 'vib';
  if (s.includes('shb')) return 'shb';
  if (s.includes('ocb')) return 'ocb';
  if (s.includes('msb') || s.includes('hàng hải') || s.includes('hang hai')) return 'msb';
  if (s.includes('agribank') || s.includes('nông nghiệp') || s.includes('nong nghiep')) return 'agribank';
  return stripAccents(s).toLowerCase().replace(/[^a-z0-9]/g, '') || 'vietcombank';
}

/** URL ảnh QR chuyển khoản (recipient = nhân viên). */
export function slipTransferQrUrl(slip: any): string | null {
  const acct = String(slip?.bank_account || '').trim();
  if (!acct) return null;
  const amount = Math.max(0, Math.round(Number(slip?.thuc_lanh ?? slip?.net_pay) || 0));
  const info = `LUONG ${slip?.period || ''} ${slip?.employee_code || ''}`.trim();
  const holder = String(slip?.bank_holder || slip?.full_name || '');
  const qs = new URLSearchParams({
    amount: String(amount),
    addInfo: info.slice(0, 50),
    accountName: holder.slice(0, 50),
  });
  return `https://img.vietqr.io/image/${vietQrBankSlug(slip?.bank_name)}-${encodeURIComponent(acct)}-compact2.png?${qs.toString()}`;
}

/** Tải ảnh QR (PNG/JPEG) — trả null khi lỗi/mất mạng (PDF vẫn tạo được). */
function fetchImage(url: string, timeoutMs = 8000, redirects = 3): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const client = url.startsWith('http:') ? http : https;
    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(fetchImage(res.headers.location, timeoutMs, redirects - 1));
        return;
      }
      if (status !== 200) { res.resume(); resolve(null); return; }
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50;
        const isJpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
        resolve(isPng || isJpg ? buf : null);
      });
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function dataUrlToBuffer(dataUrl?: string | null): Buffer | null {
  const m = String(dataUrl || '').match(/^data:image\/[a-zA-Z+]+;base64,(.+)$/s);
  if (!m) return null;
  try { return Buffer.from(m[1], 'base64'); } catch { return null; }
}

function periodLabelVi(period?: string): string {
  const m = String(period || '').match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!m) return String(period || '—');
  return `Tháng ${m[2]}/${m[1]}`;
}

export interface PayslipPdfInput {
  slip: any;
  /** Tên hiển thị chi nhánh (đã format), VD: "CN1 — 130 Vạn Kiếp". */
  branchLabel?: string;
  /** Nhãn khối làm việc, VD: "Cửa Hàng", "Văn Phòng". */
  blockLabel?: string;
}

// ---------------------------------------------------------------- builder
export async function buildPayslipPdf(input: PayslipPdfInput): Promise<Buffer> {
  const slip = input.slip || {};
  const qrUrl = slipTransferQrUrl(slip);
  const qrBuffer = qrUrl ? await fetchImage(qrUrl) : null;

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 34, bottom: 30, left: 36, right: 36 },
    info: {
      Title: `Phiếu lương ${slip.period || ''} - ${slip.full_name || ''}`,
      Author: 'UMB Milk HR System',
      Subject: 'Phiếu lương nhân viên',
      Creator: 'UMB Milk HR System',
    },
  });

  const fontMissing = !fs.existsSync(path.join(FONT_DIR, 'BeVietnamPro-Regular.ttf'));
  if (fontMissing) {
    throw new Error(`PDF_FONT_MISSING: không tìm thấy font tại ${FONT_DIR}`);
  }
  doc.registerFont('Regular', path.join(FONT_DIR, 'BeVietnamPro-Regular.ttf'));
  doc.registerFont('Medium', path.join(FONT_DIR, 'BeVietnamPro-Medium.ttf'));
  doc.registerFont('SemiBold', path.join(FONT_DIR, 'BeVietnamPro-SemiBold.ttf'));
  doc.registerFont('Bold', path.join(FONT_DIR, 'BeVietnamPro-Bold.ttf'));

  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c as Buffer));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const PW = doc.page.width;      // 595.28
  const PH = doc.page.height;     // 841.89
  const ML = 36, MR = 36;
  const CW = PW - ML - MR;        // ~523

  const stage = payslipStage(slip);
  const stageColors = STAGE_COLORS[stage];
  const period = String(slip.period || '');

  const thucLanh = Number(slip.thuc_lanh ?? slip.net_pay) || 0;
  const kpi = (Number(slip.tru_kpi) || 0) + (Number(slip.deduction) || 0);
  const ungLuong = Number(slip.ung_luong) || 0;
  const dongPhuc = Number(slip.dong_phuc) || 0;
  const deductTotal = kpi + ungLuong + dongPhuc;
  const luongCa = Number(slip.standard_pay) || 0;
  const luongCB = Number(slip.luong_cb) || 0;
  const otExtra = Number(slip.ot_extra) || 0;
  const bonus = Number(slip.bonus) || 0;
  const tongCong = Number(slip.tong_cong) || (luongCa + luongCB + otExtra + bonus);
  const rateSnapshot = Number(slip.rate_snapshot) || 0;

  // ---------- 1) Header band ----------
  const bandY = 34, bandH = 88;
  doc.save();
  doc.roundedRect(ML, bandY, CW, bandH, 10).fillAndStroke(SOFT_BRAND, '#F6D5E0');
  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, ML + 12, bandY + 13, { fit: [62, 62] });
    } catch { /* logo hỏng → bỏ qua */ }
  }
  const brandX = ML + 12 + 74;
  doc.fillColor(BRAND).font('SemiBold').fontSize(17.5).text('ỤM BÒ MILK', brandX, bandY + 14, { characterSpacing: 2.2 });
  doc.fillColor(MUTED).font('Medium').fontSize(6.4).text('CÔNG TY TNHH UNIQUE&NICHE GROUP', brandX, bandY + 33, { characterSpacing: 1.1 });
  doc.fillColor('#A08790').font('Regular').fontSize(6.2)
    .text('Trụ sở: Số 10 Đường Thai Mai, P. Phú Nhuận, TP. Hồ Chí Minh', brandX, bandY + 44, { width: 210 });
  // Right: title + stage pill
  const titleText = 'PHIẾU LƯƠNG';
  doc.fillColor(TEXT).font('Bold').fontSize(20.5);
  const titleW = doc.widthOfString(titleText, { characterSpacing: 1 });
  doc.text(titleText, PW - MR - titleW - 12, bandY + 14, { characterSpacing: 1 });
  doc.fillColor(BRAND).font('SemiBold').fontSize(7.2);
  const sub = 'N H Â N   V I Ê N';
  const subW = doc.widthOfString(sub);
  doc.text(sub, PW - MR - subW - 12, bandY + 37);
  const pillText = PAYSLIP_STAGE_LABEL[stage].toUpperCase();
  doc.font('SemiBold').fontSize(5.8);
  const pillTextW = doc.widthOfString(pillText) + 14;
  const pillW = Math.min(pillTextW, 220), pillH = 13;
  const pillX = PW - MR - 12 - pillW, pillY = bandY + 54;
  doc.roundedRect(pillX, pillY, pillW, pillH, pillH / 2).fill(stageColors.bg);
  doc.fillColor(stageColors.fg).text(pillText, pillX, pillY + 3.4, { width: pillW, align: 'center' });
  doc.restore();

  // ---------- 2) Kỳ lương + mã phiếu ----------
  const metaY = bandY + bandH + 9;
  doc.fillColor(TEXT).font('SemiBold').fontSize(9.5)
    .text(`Kỳ lương: ${periodLabelVi(period)}`, ML, metaY);
  doc.fillColor(MUTED).font('Regular').fontSize(7)
    .text(`Mã phiếu: ${slip.item_id || '—'}`, ML, metaY + 12);
  doc.fillColor(MUTED).font('Regular').fontSize(7)
    .text(`In lúc: ${new Date().toLocaleString('vi-VN', { hour12: false })}`, PW - MR - 150, metaY, { width: 150, align: 'right' });

  // ---------- 3) Info grid 4 cột × 3 hàng ----------
  const gridY = metaY + 30, cellH = 33, gap = 6;
  const colW = [CW * 0.34, CW * 0.20, CW * 0.20, CW * 0.26 - gap * 1.0];
  const cols = [ML, ML + colW[0] + gap, ML + colW[0] + colW[1] + gap * 2, ML + colW[0] + colW[1] + colW[2] + gap * 3];
  // colW tổng ≈ CW — chỉnh lại cột cuối để khít khung
  colW[3] = PW - MR - cols[3];
  const infoCell = (c: number, r: number, label: string, value: string) => {
    const x = cols[c], y = gridY + r * (cellH + gap), w = colW[c];
    doc.roundedRect(x, y, w, cellH, 5).fillAndStroke(SOFT, LINE);
    doc.fillColor(MUTED).font('SemiBold').fontSize(5.4)
      .text(label.toUpperCase(), x + 7, y + 5, { characterSpacing: 0.8 });
    doc.fillColor(TEXT).font('SemiBold').fontSize(8.6)
      .text(String(value || '—'), x + 7, y + 15, { width: w - 14, ellipsis: true, height: 14 });
  };
  const hours = Number(slip.standard_hours) || 0;
  const shifts = Number(slip.total_shifts) || 0;
  const absent = Number(slip.absent_shifts) || 0;
  infoCell(0, 0, 'Họ và tên', String(slip.full_name || '').toUpperCase());
  infoCell(1, 0, 'Mã NV', slip.employee_code);
  infoCell(2, 0, 'Mã phiếu', String(slip.item_id || '').replace(/^SLIP_/, '').slice(0, 26));
  infoCell(3, 0, 'Kỳ lương', periodLabelVi(period));
  infoCell(0, 1, 'Chi nhánh', input.branchLabel || slip.branch_id || '—');
  infoCell(1, 1, 'Khối', input.blockLabel || '—');
  infoCell(2, 1, 'Hình thức', rateSnapshot > 0 ? 'Theo ca (giờ)' : 'Theo tháng');
  infoCell(3, 1, 'Ngày công', `${hours.toFixed(1)} giờ`);
  infoCell(0, 2, 'Số ca làm', `${shifts} ca`);
  infoCell(1, 2, 'Ca vắng', `${absent} ca`);
  infoCell(2, 2, 'Lương giờ', rateSnapshot > 0 ? `${vnd(rateSnapshot)} đ/h` : '—');
  infoCell(3, 2, 'Trạng thái', PAYSLIP_STAGE_LABEL[stage]);

  // ---------- 4) Bảng khoản hưởng / khấu trừ ----------
  let y = gridY + 3 * cellH + 2 * gap + 12;
  const tableX = ML, tableW = CW;
  const colStt = 30, colAmt = 118;
  const colLabel = tableW - colStt - colAmt;
  const drawTableHeader = (yy: number, title: string) => {
    doc.fillColor(TEXT).font('Bold').fontSize(8.6).text(title, tableX, yy, { characterSpacing: 1.4 });
    doc.moveTo(tableX, yy + 13).lineTo(tableX + tableW, yy + 13).lineWidth(1.4).strokeColor(BRAND).stroke();
    return yy + 19;
  };
  const drawHeaderRow = (yy: number) => {
    doc.roundedRect(tableX, yy, tableW, 17, 3).fill('#2F3A4A');
    doc.fillColor('#FFFFFF').font('SemiBold').fontSize(6)
      .text('STT', tableX, yy + 5.4, { width: colStt, align: 'center' })
      .text('KHOẢN MỤC', tableX + colStt + 6, yy + 5.4)
      .text('THÀNH TIỀN (VNĐ)', tableX + colStt + colLabel, yy + 5.4, { width: colAmt - 8, align: 'right' });
    return yy + 17;
  };
  let rowIdx = 0;
  const drawRow = (yy: number, label: string, amount: number, opts?: { negative?: boolean; strong?: boolean }) => {
    const h = 17.5;
    if (rowIdx % 2 === 0) doc.rect(tableX, yy, tableW, h).fill('#FCFBFA');
    doc.fillColor(MUTED).font('Regular').fontSize(7.6).text(String(rowIdx + 1), tableX, yy + 4.6, { width: colStt, align: 'center' });
    doc.fillColor(TEXT).font(opts?.strong ? 'SemiBold' : 'Regular').fontSize(8.2)
      .text(label, tableX + colStt + 6, yy + 4.6, { width: colLabel - 12, ellipsis: true });
    doc.fillColor(opts?.negative ? '#B91C1C' : TEXT).font('Medium').fontSize(8.2)
      .text(`${opts?.negative ? '−' : ''}${vnd(Math.abs(amount))}`, tableX + colStt + colLabel, yy + 4.6, { width: colAmt - 8, align: 'right' });
    rowIdx += 1;
    return yy + h;
  };
  const drawSubtotal = (yy: number, label: string, amount: number, color: string, soft: string) => {
    const h = 20;
    doc.roundedRect(tableX, yy + 2, tableW, h, 3).fill(soft);
    doc.fillColor(color).font('Bold').fontSize(8.6).text(label, tableX + colStt + 6, yy + 7.4, { characterSpacing: 0.6 });
    doc.font('Bold').fontSize(9.2).text(vnd(amount), tableX + colStt + colLabel, yy + 6.6, { width: colAmt - 8, align: 'right' });
    return yy + h + 4;
  };

  // --- Section A
  y = drawTableHeader(y, 'A.  CÁC KHOẢN HƯỞNG');
  y = drawHeaderRow(y);
  if (rateSnapshot > 0) y = drawRow(y, `Lương theo ca (giờ) — ${hours.toFixed(1)}h`, luongCa);
  y = drawRow(y, 'Lương cơ bản (tháng)', luongCB);
  if (otExtra > 0) y = drawRow(y, 'OT thêm (nhập tay)', otExtra);
  if (bonus > 0) y = drawRow(y, 'Bonus / Thưởng', bonus);
  y = drawSubtotal(y, 'TỔNG CỘNG', tongCong, BRAND_DARK, SOFT_BRAND);

  // --- Section B
  y += 4;
  rowIdx = 0;
  y = drawTableHeader(y, 'B.  CÁC KHOẢN KHẤU TRỪ');
  y = drawHeaderRow(y);
  if (kpi > 0) y = drawRow(y, 'Trừ KPI / Phạt', kpi, { negative: true });
  if (ungLuong > 0) y = drawRow(y, 'Ứng lương', ungLuong, { negative: true });
  if (dongPhuc > 0) y = drawRow(y, 'Trừ đồng phục (cọc)', dongPhuc, { negative: true });
  if (deductTotal === 0) {
    doc.fillColor(MUTED).font('Regular').fontSize(7.4)
      .text('— Không có khoản khấu trừ nào trong kỳ —', tableX + colStt + 6, y + 5, { width: colLabel - 12 });
    y += 17.5;
  }
  y = drawSubtotal(y, 'TỔNG KHẤU TRỪ', deductTotal, '#B91C1C', '#FEF2F2');

  // ---------- 5) THỰC LÃNH band ----------
  y += 8;
  const tlH = 52;
  doc.roundedRect(ML, y, CW, tlH, 8).fill(OK);
  doc.fillColor('#FFFFFF').font('Bold').fontSize(13.5).text('THỰC LÃNH', ML + 16, y + 9, { characterSpacing: 2 });
  doc.font('Regular').fontSize(6.6).fillColor('#D8F5E8')
    .text(`Bằng chữ: ${docSoVietNam(thucLanh)}`, ML + 16, y + 25, { width: CW * 0.58 });
  doc.fillColor('#FFFFFF').font('Bold').fontSize(17.5)
    .text(vnd(thucLanh), ML + CW * 0.52, y + 8, { width: CW * 0.48 - 16, align: 'right' });
  doc.font('Medium').fontSize(6.2).fillColor('#D8F5E8')
    .text('VNĐ', ML + CW * 0.52, y + 30, { width: CW * 0.48 - 16, align: 'right' });

  // ---------- 6) Bank / QR ----------
  y += tlH + 10;
  const bankH = 92;
  doc.roundedRect(ML, y, CW, bankH, 8).fillAndStroke('#F8FAFC', '#E2E8F0');
  doc.fillColor('#475569').font('Bold').fontSize(6.6)
    .text('C H U Y Ể N   K H O Ả N   L Ư Ơ N G', ML + 12, y + 8, { characterSpacing: 1.4 });
  const qrSize = 62, qrX = ML + 12, qrY = y + 22;
  if (qrBuffer) {
    doc.roundedRect(qrX, qrY, qrSize, qrSize, 4).fillAndStroke('#FFFFFF', '#CBD5E1');
    doc.image(qrBuffer, qrX + 3, qrY + 3, { fit: [qrSize - 6, qrSize - 6] });
  } else {
    doc.save();
    doc.roundedRect(qrX, qrY, qrSize, qrSize, 4).lineWidth(1).dash(3, { space: 2 }).strokeColor('#F87171').stroke();
    doc.restore();
    doc.fillColor('#DC2626').font('Medium').fontSize(6)
      .text('Chưa có\nVietQR', qrX, qrY + 22, { width: qrSize, align: 'center' });
  }
  const bx = qrX + qrSize + 14;
  const bw = PW - MR - bx - 12;
  const colW2 = (bw - 10) / 2;
  const bankLine = (x: number, yy: number, w: number, label: string, value: string) => {
    doc.fillColor(MUTED).font('Regular').fontSize(6.2).text(label, x, yy, { width: w });
    doc.fillColor(TEXT).font('SemiBold').fontSize(7.8).text(value || '—', x, yy + 8, { width: w, ellipsis: true });
  };
  bankLine(bx, y + 20, colW2, 'Ngân hàng', slip.bank_name || '—');
  bankLine(bx + colW2 + 10, y + 20, colW2, 'Số tài khoản', slip.bank_account || '—');
  bankLine(bx, y + 46, colW2, 'Chủ tài khoản', slip.bank_holder || slip.full_name || '—');
  bankLine(bx + colW2 + 10, y + 46, colW2, 'Nội dung CK', `LUONG ${periodLabelVi(period)} ${slip.employee_code || ''}`);

  // ---------- 7) Ghi chú kế toán ----------
  y = y + bankH + 10;
  if (slip.input_note) {
    const noteText = String(slip.input_note);
    doc.font('Regular').fontSize(7.2);
    const noteH = Math.min(48, 20 + doc.heightOfString(noteText, { width: CW - 24 }));
    doc.roundedRect(ML, y, CW, noteH, 6).fillAndStroke('#FFFBEB', '#FCD34D');
    doc.fillColor('#B45309').font('Bold').fontSize(5.8).text('G H I   C H Ú   T Ừ   K Ế   T O Á N', ML + 12, y + 5, { characterSpacing: 1.2 });
    doc.fillColor('#92400E').font('Regular').fontSize(7.2)
      .text(noteText, ML + 12, y + 15, { width: CW - 24, height: noteH - 19, ellipsis: true });
    y += noteH + 8;
  }

  // ---------- 8) Chữ ký 3 bên (tự co chiều cao để luôn vừa 1 trang) ----------
  const sigGap = 8;
  const sigW = (CW - 2 * sigGap) / 3;
  const footReserve = 44; // chiều cao khối footer
  const sigY = y + 8;
  const sigH = Math.max(64, Math.min(94, PH - 30 - sigY - footReserve));
  const imgFitH = Math.max(20, sigH - 58);
  const imgFitW = Math.min(96, sigW - 24);
  const sigBox = (i: number, title: string, sig: any, fallbackName: string) => {
    const x = ML + i * (sigW + sigGap);
    doc.roundedRect(x, sigY, sigW, sigH, 6).fillAndStroke('#FFFFFF', LINE);
    doc.rect(x + 0.75, sigY + 0.75, sigW - 1.5, 14).fill(SOFT);
    doc.fillColor('#475569').font('Bold').fontSize(6.2)
      .text(title, x, sigY + 4.4, { width: sigW, align: 'center', characterSpacing: 0.5, ellipsis: true });
    const img = dataUrlToBuffer(sig?.img);
    if (img) {
      try { doc.image(img, x + sigW / 2 - imgFitW / 2, sigY + 19, { fit: [imgFitW, imgFitH] }); }
      catch { doc.fillColor(MUTED).font('Regular').fontSize(6).text('(Chữ ký lỗi)', x, sigY + 32, { width: sigW, align: 'center' }); }
    } else {
      doc.fillColor('#B9AEA8').font('Regular').fontSize(6.4)
        .text('Chưa ký', x, sigY + 22 + imgFitH / 2, { width: sigW, align: 'center' });
    }
    doc.fillColor(TEXT).font('SemiBold').fontSize(7.1)
      .text(String(sig?.name || fallbackName || '').toUpperCase(), x + 4, sigY + sigH - 30, { width: sigW - 8, align: 'center', ellipsis: true });
    doc.fillColor(MUTED).font('Regular').fontSize(5.3)
      .text(sig?.at ? new Date(sig.at).toLocaleString('vi-VN', { hour12: false }) : '(Ký, ghi rõ họ tên)', x + 4, sigY + sigH - 16, { width: sigW - 8, align: 'center' });
  };
  sigBox(0, 'KẾ TOÁN LẬP PHIẾU', slip.sign_lap, 'Kế toán');
  sigBox(1, 'GIÁM ĐỐC DUYỆT', slip.sign_giamdoc, 'Giám đốc');
  sigBox(2, 'NGƯỜI NHẬN TIỀN (NV)', slip.sign_nhanvien, slip.full_name || 'Nhân viên');

  // ---------- 9) Footer ----------
  const footY = sigY + sigH + 6;
  doc.moveTo(ML, footY).lineTo(PW - MR, footY).lineWidth(0.6).dash(2, { space: 2 }).strokeColor('#D8CCC7').stroke();
  doc.undash();
  doc.fillColor(MUTED).font('Regular').fontSize(5.5)
    .text('Phiếu được tạo tự động bởi UMB Milk HR — vui lòng đối chiếu kỹ trước khi ký nhận. Mọi thắc mắc liên hệ Kế toán.', ML, footY + 4, { width: CW, align: 'center' });
  doc.fillColor('#B9AEA8').font('Regular').fontSize(5.1)
    .text(`Mã xác thực: ${slip.item_id || '—'}  •  ${periodLabelVi(period)}  •  ${new Date().toLocaleDateString('vi-VN')}`, ML, footY + 13, { width: CW, align: 'center' });

  doc.end();
  return done;
}
