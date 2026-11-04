/**
 * In PHIẾU LƯƠNG ra cửa sổ in riêng (A4 dọc) — không in cả trang web.
 * Dùng cho:
 *  - Nút "🖨️ In phiếu" trên từng dòng ở tab Phiếu lương
 *  - Nút "🖨️ In cả kỳ" (in hàng loạt các phiếu đang xem/lọc theo Khối)
 *
 * Phiếu in gồm: thông tin NV + Khối + breakdown lương + 3 ô chữ ký + QR chuyển khoản (nếu có STK).
 */

import { financeBlockOf } from './financeBlocks';

const esc = (v: unknown) =>
  String(v ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const vnd = (n: any) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;

/** Mã VietQR cho một số ngân hàng phổ biến (khớp mapping ở frontend). */
function qrBankCode(bankName: string): string {
  const s = (bankName || '').trim().toLowerCase();
  if (s.includes('vietcom') || s === 'vcb') return 'vietcombank';
  if (s.includes('techcom') || s === 'tcb') return 'techcombank';
  if (s.includes('sacom') || s.includes('stb')) return 'sacombank';
  if (s.includes('mb') || s.includes('quân đội')) return 'mbbank';
  if (s.includes('bidv')) return 'bidv';
  if (s.includes('vietin') || s === 'ctg') return 'vietinbank';
  if (s.includes('acb') || s.includes('á châu')) return 'acb';
  if (s.includes('vp') || s.includes('vpbank')) return 'vpbank';
  if (s.includes('tp') || s.includes('tpbank') || s.includes('tiên phong')) return 'tpbank';
  if (s.includes('hdbank') || s.includes('hdb')) return 'hdbank';
  if (s.includes('vib')) return 'vib';
  if (s.includes('shb')) return 'shb';
  if (s.includes('ocb')) return 'ocb';
  if (s.includes('msb') || s.includes('hàng hải')) return 'msb';
  if (s.includes('agribank') || s.includes('nông nghiệp')) return 'agribank';
  return s.replace(/[^a-z0-9]/g, '') || 'vcb';
}

const STATUS_VI: Record<string, string> = {
  DRAFT: 'Nháp',
  RECONCILED: 'Đã đối soát',
  APPROVED: 'Đã duyệt',
  PUBLISHED: 'Đã phát hành',
  CONFIRMED: 'NV đã xác nhận',
  PAID: 'Đã chi trả',
};

const BLOCK_VI: Record<string, string> = {
  VAN_PHONG: 'Khối Văn Phòng',
  XUONG: 'Khối Xưởng SX',
  SALE: 'Khối Sales / MKT',
  CUA_HANG: 'Khối Cửa Hàng',
  ALL: 'Toàn hệ thống',
};

/** Khối hiển thị trên phiếu: đọc group/branch đã được caller enrich vào slip (s.__group/__branch). */
function blockOfSlip(s: any): string {
  if (s?.__group || s?.__branch) {
    return BLOCK_VI[financeBlockOf({ group: s.__group, branchId: s.__branch })] || '—';
  }
  return BLOCK_VI[financeBlockOf(s)] || '—';
}

function lineItem(label: string, value: string, opts?: { bold?: boolean; negative?: boolean; muted?: boolean }) {
  const weight = opts?.bold ? 800 : 400;
  const color = opts?.negative ? '#B91C1C' : opts?.muted ? '#64748B' : '#111827';
  return `<tr>
    <td style="padding:6px 10px;border-bottom:1px dashed #E2E8F0;font-size:12.5px;color:#334155;">${esc(label)}</td>
    <td style="padding:6px 10px;border-bottom:1px dashed #E2E8F0;font-size:12.5px;text-align:right;font-weight:${weight};color:${color};">${esc(value)}</td>
  </tr>`;
}

function renderSlip(p: any): string {
  const thucLanh = Number(p?.thuc_lanh ?? p?.net_pay ?? 0);
  const hasQr = !!(p?.bank_account || '').trim();
  const qrUrl = hasQr
    ? `https://img.vietqr.io/image/${qrBankCode(p?.bank_name || 'vcb')}-${encodeURIComponent(String(p.bank_account))}-compact2.png?amount=${Math.max(0, Math.round(thucLanh))}&addInfo=${encodeURIComponent(`LUONG ${p?.period || ''} ${p?.employee_code || ''}`)}&accountName=${encodeURIComponent(String(p?.bank_holder || p?.full_name || ''))}`
    : null;
  const sign = (roleLabel: string, sig?: { name?: string; at?: string; img?: string }, fallbackName?: string) => `
    <div class="sig-box">
      <div class="sig-title">${esc(roleLabel)}</div>
      <div class="sig-img">${sig?.img ? `<img src="${esc(sig.img)}" alt="Chữ ký" style="max-height:56px;max-width:100%;object-fit:contain;" onerror="this.style.display='none'"/>` : '<span class="sig-empty">Chưa ký</span>'}</div>
      <div class="sig-name">${esc(sig?.name || fallbackName || '')}</div>
      <div class="sig-at">${esc(sig?.at ? new Date(sig.at).toLocaleString('vi-VN') : '')}</div>
    </div>`;

  return `
  <section class="payslip">
    <header class="ps-head">
      <img class="ps-logo" src="/logo.jpg" alt="Logo" onerror="this.style.display='none'" />
      <div>
        <div class="ps-company">ỤM BÒ MILK</div>
        <h1 class="ps-title">PHIẾU LƯƠNG NHÂN VIÊN</h1>
        <div class="ps-period">Kỳ lương: <strong>${esc(p?.period || '—')}</strong> • Mã phiếu: ${esc(p?.item_id || '—')}</div>
      </div>
      <div class="ps-stamp">${esc(STATUS_VI[String(p?.status || '').toUpperCase()] || p?.status || '—')}</div>
    </header>

    <table class="ps-info">
      <tr><td>Họ và tên</td><td><strong>${esc(p?.full_name || '—')}</strong></td><td>Mã NV</td><td><strong>${esc(p?.employee_code || '—')}</strong></td></tr>
      <tr><td>Khối</td><td>${esc(blockOfSlip(p))}</td><td>Chi nhánh</td><td>${esc(p?.branch_id || p?.branchId || p?.__branch || '—')}</td></tr>
      <tr><td>Số ca</td><td>${esc(String(p?.total_shifts ?? '—'))} ca (vắng ${esc(String(p?.absent_shifts ?? 0))})</td><td>Giờ công</td><td>${esc(String(p?.standard_hours ?? 0))} giờ</td></tr>
      <tr><td>Đơn giá</td><td>${esc(vnd(p?.rate_snapshot))}/giờ</td><td>Trạng thái</td><td>${esc(STATUS_VI[String(p?.status || '').toUpperCase()] || p?.status || '—')}</td></tr>
    </table>

    <table class="ps-table">
      ${lineItem('Lương theo giờ', vnd(p?.standard_pay))}
      ${lineItem('Lương cơ bản (nhập tay)', vnd(p?.luong_cb))}
      ${lineItem('OT thêm (nhập tay)', vnd(p?.ot_extra))}
      ${lineItem('Bonus / Thưởng', vnd(p?.bonus))}
      ${lineItem('TỔNG CỘNG', vnd(p?.tong_cong ?? ((Number(p?.luong_cb) || 0) + (Number(p?.standard_pay) || 0) + (Number(p?.ot_extra) || 0) + (Number(p?.bonus) || 0))), { bold: true })}
      ${lineItem('Trừ KPI / Phạt', `−${vnd((Number(p?.tru_kpi) || 0) + (Number(p?.deduction) || 0))}`, { negative: true })}
      ${lineItem('Ứng lương', `−${vnd(p?.ung_luong)}`, { negative: true })}
      ${lineItem('Trừ đồng phục', `−${vnd(p?.dong_phuc)}`, { negative: true })}
      <tr class="ps-grand"><td>THỰC LÃNH</td><td>${esc(vnd(thucLanh))}</td></tr>
    </table>

    <div class="ps-bank">
      <div class="ps-bank-title">Chuyển khoản lương</div>
      <div class="ps-bank-grid">
        <div class="ps-qr">${qrUrl ? `<img src="${qrUrl}" alt="VietQR" style="width:150px;height:150px;object-fit:contain;border:1px solid #CBD5E1;border-radius:8px;background:#FFF;" />` : '<div class="ps-qr-empty">Chưa có STK</div>'}</div>
        <div class="ps-bank-lines">
          <div>Ngân hàng: <strong>${esc(p?.bank_name || '—')}</strong></div>
          <div>Số tài khoản: <strong>${esc(p?.bank_account || '—')}</strong></div>
          <div>Chủ tài khoản: <strong>${esc(p?.bank_holder || p?.full_name || '—')}</strong></div>
          <div>Nội dung CK: <strong>LUONG ${esc(p?.period || '')} ${esc(p?.employee_code || '')}</strong></div>
        </div>
      </div>
    </div>

    <div class="ps-signatures">
      ${sign('1. Người Lập Phiếu (Kế toán)', p?.sign_lap, 'Kế toán')}
      ${sign('2. Quản Lý Chi Nhánh', p?.sign_quanly)}
      ${sign('3. Người Nhận Tiền (NV)', p?.sign_nhanvien, p?.full_name)}
    </div>
    <div class="ps-foot">Phiếu được tạo tự động từ hệ thống quản trị Ụm Bò Milk • In lúc ${esc(new Date().toLocaleString('vi-VN'))} • Vui lòng đối chiếu kỹ trước khi ký nhận.</div>
  </section>`;
}

/**
 * Mở cửa sổ in với 1 hoặc N phiếu. Trả false nếu bị popup blocker chặn.
 * Mỗi phiếu chiếm 1 trang A4 (ngắt trang tự động).
 */
export function printPayslips(slips: any[], opts?: { title?: string }): boolean {
  if (!Array.isArray(slips) || slips.length === 0) return false;
  const doc = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(opts?.title || 'Phiếu lương Ụm Bò Milk')}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 12mm 14mm 12mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color:#111827; margin:0; background:#FFF; }
    .payslip { page-break-after: always; padding: 2mm 0; }
    .payslip:last-child { page-break-after: auto; }
    .ps-head { display:flex; align-items:center; gap:14px; border-bottom: 3px solid #E85D92; padding-bottom:10px; margin-bottom:10px; position:relative; }
    .ps-logo { width:64px; height:64px; border-radius:50%; object-fit:cover; border:2px solid #F8DDE7; }
    .ps-company { font-size:11px; font-weight:800; letter-spacing:2px; color:#E85D92; }
    .ps-title { margin:2px 0 0; font-size:19px; font-weight:900; color:#111827; }
    .ps-period { font-size:12px; color:#475569; margin-top:2px; }
    .ps-stamp { position:absolute; right:0; top:0; font-size:11px; font-weight:800; padding:4px 10px; border-radius:999px; background:#FFF4E0; color:#B45309; border:1px solid #FCD34D; }
    .ps-info { width:100%; border-collapse:collapse; margin-bottom:10px; border:1px solid #E2E8F0; }
    .ps-info td { padding:6px 10px; font-size:11.5px; border:1px solid #E2E8F0; }
    .ps-info td:nth-child(odd) { background:#F8FAFC; font-weight:700; width:16%; color:#334155; }
    .ps-table { width:100%; border-collapse:collapse; margin-bottom:10px; }
    .ps-grand td { padding:10px; background:#ECFDF5; border-top:2px solid #10B981; font-size:16px; font-weight:900; }
    .ps-grand td:last-child { text-align:right; color:#059669; }
    .ps-bank { border:1px solid #E2E8F0; border-radius:10px; padding:10px; margin-bottom:10px; }
    .ps-bank-title { font-size:12px; font-weight:800; color:#334155; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px; }
    .ps-bank-grid { display:flex; gap:14px; align-items:center; }
    .ps-qr-empty { width:150px; height:150px; border:1.5px dashed #F87171; border-radius:8px; display:flex; align-items:center; justify-content:center; color:#DC2626; font-size:12px; }
    .ps-bank-lines { font-size:12px; display:flex; flex-direction:column; gap:5px; }
    .ps-signatures { display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; border-top:1px solid #E2E8F0; padding-top:10px; }
    .sig-box { border:1px solid #E2E8F0; border-radius:8px; padding:8px; text-align:center; min-height:118px; display:flex; flex-direction:column; }
    .sig-title { font-size:10.5px; font-weight:800; color:#334155; }
    .sig-img { flex:1; display:flex; align-items:center; justify-content:center; padding:6px 0; }
    .sig-empty { color:#94A3B8; font-size:11px; }
    .sig-name { font-size:11px; font-weight:700; min-height:14px; }
    .sig-at { font-size:9px; color:#94A3B8; min-height:12px; }
    .ps-foot { margin-top:10px; font-size:9.5px; color:#94A3B8; text-align:center; border-top:1px dashed #E2E8F0; padding-top:8px; }
    @media print { .payslip { page-break-after: always; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>${slips.map(renderSlip).join('')}
<script>window.onload = function () { window.print(); };</script>
</body></html>`;

  const w = window.open('', '_blank', 'width=980,height=920');
  if (!w) return false;
  w.document.write(doc);
  w.document.close();
  return true;
}
