/**
 * Xuất Excel (.xlsx) cho từng chức năng của tài khoản Kế toán — dùng để
 * đồng bộ lên Google Drive theo từng tháng (THANG_MM_YYYY/<chức năng>).
 *
 * Tất cả workbook đều: tiêu đề công ty + kỳ, nhóm theo CHI NHÁNH (thứ tự
 * CN1→CN4→Xưởng→VP), band phân nhóm, subtotal từng chi nhánh + tổng toàn
 * công ty, in ngang khổ legal, fitToWidth, đóng băng header, autofilter.
 */
import ExcelJS from 'exceljs';
import { BRANCH_DISPLAY_ORDER, parsePeriod, branchDriveFolder, effectivePayMode } from '@ubm/shared';

const BRAND = 'E85D92';
const BRAND_DARK = 'B4457C';
const DARK = '273142';
const SOFT = 'FDF2F7';
const LINE = 'FBCFE8';
const ZEBRA = 'FCFBFA';
const MUTED = '64748B';

const BRANCH_LABEL: Record<string, string> = {
  CN130: 'CN1 — 130 Vạn Kiếp', CN261: 'CN2 — 261 Tô Hiến Thành',
  CN120: 'CN3 — 120 Hoàng Diệu 2', CN111: 'CN4 — 111 Tôn Đản',
  XUONG_SX: 'Xưởng Sản Xuất (Củ Chi)', VAN_PHONG: 'Văn Phòng Trụ Sở',
};
const branchLabelOf = (id?: string | null) => BRANCH_LABEL[String(id || '').trim()] || String(id || '—');
const blockLabelOf = (group?: string | null, branchId?: string | null): string => {
  const g = String(group || '').toUpperCase();
  if (g === 'VAN_PHONG') return 'Văn Phòng';
  if (g === 'XUONG') return 'Xưởng SX';
  if (g === 'SALE' || g === 'MKT' || g === 'SALES') return 'Sales / MKT';
  const b = String(branchId || '').toUpperCase();
  if (b === 'VAN_PHONG') return 'Văn Phòng';
  if (b === 'XUONG_SX') return 'Xưởng SX';
  return 'Cửa Hàng';
};

const money = '#,##0" đ"';
const hoursFmt = '#,##0.0" h"';
const intFmt = '#,##0';

const monthLabel = (period: string) => {
  const p = parsePeriod(period);
  return p ? `Tháng ${String(p.month).padStart(2, '0')}/${p.year}` : String(period || '');
};
const monthFileTag = (period: string) => {
  const p = parsePeriod(period);
  return p ? `${String(p.month).padStart(2, '0')}_${p.year}` : '00_0000';
};

const sheetSafe = (name: string) =>
  String(name || 'SHEET').replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 31) || 'SHEET';

/** Thứ tự chi nhánh: theo BRANCH_DISPLAY_ORDER, phần lạ xếp sau theo alphabet. */
const orderedBranchKeys = (keys: Iterable<string>) => {
  const set = new Set([...keys].map(k => String(k || 'KHAC')));
  return [
    ...BRANCH_DISPLAY_ORDER.filter(k => set.has(k)),
    ...[...set].filter(k => !BRANCH_DISPLAY_ORDER.includes(k)).sort(),
  ];
};

const newWorkbook = () => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'UMB Milk HR System';
  wb.created = new Date();
  return wb;
};

const addTitleBlock = (
  ws: ExcelJS.Worksheet,
  lastCol: string,
  lines: Array<{ text: string; size: number; bold?: boolean; color?: string; spacing?: number }>,
) => {
  lines.forEach((l, i) => {
    const r = i + 1;
    ws.mergeCells(`A${r}:${lastCol}${r}`);
    const cell = ws.getCell(`A${r}`);
    cell.value = l.text;
    cell.font = { bold: l.bold !== false, size: l.size, color: { argb: 'FF' + (l.color || DARK) }, name: 'Be Vietnam Pro' };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(r).height = l.size + 8 + (l.spacing || 0);
  });
};

const styleHeaderRow = (row: ExcelJS.Row, height = 22) => {
  row.eachCell(cell => {
    cell.font = { bold: true, size: 8, color: { argb: 'FFFFFFFF' }, name: 'Be Vietnam Pro' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + DARK } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF1E293B' } } };
  });
  row.height = height;
};

const branchBandRow = (ws: ExcelJS.Worksheet, rowIdx: number, lastCol: string, label: string, count: number) => {
  ws.mergeCells(rowIdx, 1, rowIdx, ws.columnCount);
  const cell = ws.getCell(rowIdx, 1);
  cell.value = `▍ ${label.toUpperCase()} — ${count} nhân viên`;
  cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' }, name: 'Be Vietnam Pro' };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BRAND } };
  cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  ws.getRow(rowIdx).height = 20;
};

const subtotalRow = (ws: ExcelJS.Worksheet, rowIdx: number, label: string, cells: Record<number, number | string>, formats: Record<number, string>) => {
  const row = ws.getRow(rowIdx);
  row.getCell(3).value = label;
  for (const [col, val] of Object.entries(cells)) row.getCell(Number(col)).value = val;
  row.eachCell((cell, col) => {
    cell.font = { bold: true, size: 8.5, color: { argb: 'FF' + BRAND_DARK }, name: 'Be Vietnam Pro' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + SOFT } };
    cell.border = { top: { style: 'thin', color: { argb: 'FF' + BRAND } } };
    if (formats[col]) cell.numFmt = formats[col];
    if (col >= 5) cell.alignment = { horizontal: 'right' };
  });
  row.height = 19;
};

const grandTotalRow = (ws: ExcelJS.Worksheet, rowIdx: number, label: string, cells: Record<number, number | string>, formats: Record<number, string>) => {
  const row = ws.getRow(rowIdx);
  row.getCell(3).value = label;
  for (const [col, val] of Object.entries(cells)) row.getCell(Number(col)).value = val;
  row.eachCell((cell, col) => {
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' }, name: 'Be Vietnam Pro' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + DARK } };
    if (formats[col]) cell.numFmt = formats[col];
    if (col >= 5) cell.alignment = { horizontal: 'right' };
  });
  row.height = 24;
};

const zebra = (ws: ExcelJS.Worksheet, rowIdx: number, lastCol: number, enabled: boolean) => {
  if (!enabled) return;
  for (let c = 1; c <= lastCol; c++) {
    const cell = ws.getCell(rowIdx, c);
    if (!cell.fill || (cell.fill as any).pattern !== 'solid') {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + ZEBRA } };
    }
  }
};

const bodyCell = (cell: ExcelJS.Cell, opts?: { align?: 'left' | 'center' | 'right'; bold?: boolean; fmt?: string }) => {
  cell.font = { size: 9, bold: !!opts?.bold, name: 'Be Vietnam Pro', color: { argb: 'FF' + DARK } };
  cell.border = { bottom: { style: 'hair', color: { argb: 'FFE7DEDA' } } };
  if (opts?.fmt) cell.numFmt = opts.fmt;
  cell.alignment = { vertical: 'middle', horizontal: opts?.align || 'left' };
};

const pageSetup = (ws: ExcelJS.Worksheet, lastColLetter: string, title: string) => {
  ws.pageSetup = {
    paperSize: 5, // legal
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.35, bottom: 0.35, header: 0.2, footer: 0.2 },
  };
  ws.headerFooter = {
    oddHeader: `&8&K94A3B8UMB Milk — ${title}&R&8&K94A3B8&D`,
    oddFooter: `&8&K94A3B8CÔNG TY TNHH UNIQUE&NICHE GROUP&C&8&K94A3B8&P / &N&R&8&K94A3B8In bởi hệ thống UMB HR`,
  };
  ws.views = [{ state: 'frozen', ySplit: ws.getRow(5).height ? 5 : 5, xSplit: 0 }];
  ws.autoFilter = { from: 'A5', to: `${lastColLetter}5` };
};

const toBuffer = async (wb: ExcelJS.Workbook) => Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);

const groupByBranch = <T>(items: T[], getBranch: (x: T) => any) => {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = String(getBranch(it) || 'KHAC');
    const arr = map.get(k);
    if (arr) arr.push(it); else map.set(k, [it]);
  }
  return orderedBranchKeys(map.keys()).map(k => ({ key: k, rows: map.get(k)! }));
};

const sum = (rows: any[], key: string) => rows.reduce((s, r) => s + (Number(r?.[key]) || 0), 0);
const r1 = (n: number) => Math.round(n * 10) / 10;

/* ============================================================
   01_DOI_SOAT_CONG — Đối soát công & Bảng chấm công (tổng hợp)
   ============================================================ */
export async function buildDoiSoatCongXlsx(period: string, timesheet: any): Promise<Buffer> {
  const wb = newWorkbook();
  const ws = wb.addWorksheet('DOI_SOAT_CONG', { views: [{ state: 'frozen', ySplit: 5 }] });
  const lastCol = 'K';
  const headers = ['STT', 'MÃ NV', 'HỌ TÊN', 'CHI NHÁNH', 'CA ĐỦ', 'CA THIẾU', 'CA VẮNG', 'GIỜ CÔNG', 'LƯƠNG CA (đ)', 'PHẠT/TRỪ (đ)', 'THỰC NHẬN (đ)'];
  addTitleBlock(ws, lastCol, [
    { text: 'CÔNG TY TNHH UNIQUE&NICHE GROUP', size: 10, color: BRAND_DARK },
    { text: 'ĐỐI SOÁT CÔNG — BẢNG CHẤM CÔNG TỔNG HỢP', size: 15, color: DARK },
    { text: `${monthLabel(period).toUpperCase()}  •  ${timesheet?.fromDate || ''} → ${timesheet?.toDate || ''}  •  ${timesheet?.daysInMonth || ''} ngày`, size: 10, color: BRAND },
  ]);
  ws.getRow(4).height = 6;
  const headerRow = ws.getRow(5);
  headerRow.values = headers;
  styleHeaderRow(headerRow);
  ws.columns = [
    { key: 'stt', width: 6 }, { key: 'code', width: 12 }, { key: 'name', width: 30 }, { key: 'branch', width: 28 },
    { key: 'full', width: 9 }, { key: 'partial', width: 10 }, { key: 'absent', width: 10 }, { key: 'hours', width: 11 },
    { key: 'stdpay', width: 16 }, { key: 'deduct', width: 15 }, { key: 'net', width: 17 },
  ];

  const rows: any[] = timesheet?.rows || [];
  const groups = groupByBranch(rows, (r: any) => r.branchId);
  let rowIdx = 6, stt = 0;
  let gHours = 0, gStd = 0, gDed = 0, gNet = 0, gFull = 0, gPartial = 0, gAbsent = 0;
  for (const g of groups) {
    branchBandRow(ws, rowIdx, lastCol, branchLabelOf(g.key), g.rows.length);
    rowIdx += 1;
    let bHours = 0, bStd = 0, bDed = 0, bNet = 0, bFull = 0, bPartial = 0, bAbsent = 0;
    let zebraOn = false;
    for (const r of g.rows) {
      stt += 1; zebraOn = !zebraOn;
      const row = ws.getRow(rowIdx);
      const net = Number(r.netPay) || 0;
      const std = Number(r.standardPay) || 0;
      const ded = Number(r.deduction) || 0;
      row.values = [stt, r.employeeCode, r.fullName, branchLabelOf(g.key),
        Number(r.full) || 0, Number(r.partial) || 0, Number(r.absent) || 0, r1(Number(r.hours) || 0),
        std, ded, net];
      row.eachCell((cell, col) => {
        bodyCell(cell, { align: col === 1 || (col >= 5 && col <= 8) ? 'center' : (col >= 9 ? 'right' : 'left'), fmt: col === 8 ? hoursFmt : (col >= 9 ? money : (col >= 5 ? intFmt : undefined)), bold: col === 11 });
      });
      row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
      zebra(ws, rowIdx, 11, zebraOn);
      row.height = 17;
      bHours += Number(r.hours) || 0; bStd += std; bDed += ded; bNet += net;
      bFull += Number(r.full) || 0; bPartial += Number(r.partial) || 0; bAbsent += Number(r.absent) || 0;
      rowIdx += 1;
    }
    subtotalRow(ws, rowIdx, `CỘNG ${branchLabelOf(g.key).toUpperCase()}`,
      { 5: bFull, 6: bPartial, 7: bAbsent, 8: r1(bHours), 9: bStd, 10: bDed, 11: bNet },
      { 5: intFmt, 6: intFmt, 7: intFmt, 8: hoursFmt, 9: money, 10: money, 11: money });
    gHours += bHours; gStd += bStd; gDed += bDed; gNet += bNet; gFull += bFull; gPartial += bPartial; gAbsent += bAbsent;
    rowIdx += 1;
  }
  grandTotalRow(ws, rowIdx, 'TỔNG CỘNG TOÀN CÔNG TY',
    { 5: gFull, 6: gPartial, 7: gAbsent, 8: r1(gHours), 9: gStd, 10: gDed, 11: gNet },
    { 5: intFmt, 6: intFmt, 7: intFmt, 8: hoursFmt, 9: money, 10: money, 11: money });
  pageSetup(ws, lastCol, `Đối soát công ${monthLabel(period)}`);
  return toBuffer(wb);
}

/* ============================================================
   02_BCC — Bảng công từng ngày (1 sheet/chi nhánh + TỔNG HỢP)
   ============================================================ */
export async function buildBccXlsx(period: string, timesheet: any): Promise<Buffer> {
  const wb = newWorkbook();
  const p = parsePeriod(period);
  const daysInMonth = Number(timesheet?.daysInMonth) || (p ? new Date(p.year, p.month, 0).getDate() : 31);
  const dayCols = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const rows: any[] = timesheet?.rows || [];
  const groups = groupByBranch(rows, (r: any) => r.branchId);

  // ---- Sheet TỔNG HỢP (đặt đầu) ----
  const sumWs = wb.addWorksheet('TONG_HOP', { views: [{ state: 'frozen', ySplit: 5 }] });
  addTitleBlock(sumWs, 'H', [
    { text: 'CÔNG TY TNHH UNIQUE&NICHE GROUP', size: 10, color: BRAND_DARK },
    { text: 'BCC — BẢNG CHẤM CÔNG THEO NGÀY (TỔNG HỢP)', size: 15, color: DARK },
    { text: monthLabel(period).toUpperCase(), size: 10, color: BRAND },
  ]);
  sumWs.getRow(4).height = 6;
  const sumHeader = sumWs.getRow(5);
  sumHeader.values = ['STT', 'CHI NHÁNH', 'SỐ NV', 'GIỜ CÔNG', 'CA ĐỦ', 'CA THIẾU', 'CA VẮNG', 'THỰC NHẬN (đ)'];
  styleHeaderRow(sumHeader);
  sumWs.columns = [
    { key: 'stt', width: 6 }, { key: 'branch', width: 34 }, { key: 'nv', width: 9 }, { key: 'hours', width: 12 },
    { key: 'full', width: 9 }, { key: 'partial', width: 10 }, { key: 'absent', width: 10 }, { key: 'net', width: 18 },
  ];
  let sumRow = 6, sumStt = 0, gHours = 0, gNet = 0, gFull = 0, gPartial = 0, gAbsent = 0, gNv = 0;
  for (const g of groups) {
    sumStt += 1;
    const row = sumWs.getRow(sumRow);
    const net = sum(g.rows, 'netPay');
    row.values = [sumStt, branchLabelOf(g.key), g.rows.length, r1(sum(g.rows, 'hours')),
      sum(g.rows, 'full'), sum(g.rows, 'partial'), sum(g.rows, 'absent'), net];
    row.eachCell((cell, col) => {
      bodyCell(cell, { align: col === 1 || col === 3 || (col >= 4 && col <= 7) ? 'center' : 'left', fmt: col === 4 ? hoursFmt : (col === 8 ? money : (col >= 5 ? intFmt : undefined)), bold: col === 8 });
    });
    zebra(sumWs, sumRow, 8, sumStt % 2 === 0);
    row.height = 18;
    gHours += sum(g.rows, 'hours'); gNet += net; gFull += sum(g.rows, 'full'); gPartial += sum(g.rows, 'partial'); gAbsent += sum(g.rows, 'absent'); gNv += g.rows.length;
    sumRow += 1;
  }
  grandTotalRow(sumWs, sumRow, 'TỔNG CỘNG', { 3: gNv, 4: r1(gHours), 5: gFull, 6: gPartial, 7: gAbsent, 8: gNet },
    { 3: intFmt, 4: hoursFmt, 5: intFmt, 6: intFmt, 7: intFmt, 8: money });
  pageSetup(sumWs, 'H', `Tổng hợp BCC ${monthLabel(period)}`);

  // ---- Mỗi chi nhánh 1 sheet ----
  for (const g of groups) {
    const ws = wb.addWorksheet(sheetSafe(branchDriveFolder(g.key, branchLabelOf(g.key))), {
      views: [{ state: 'frozen', xSplit: 5, ySplit: 5 }],
    });
    const lastColIdx = 5 + daysInMonth + 6;
    const lastColLetter = ws.getColumn(lastColIdx).letter;
    addTitleBlock(ws, lastColLetter, [
      { text: 'CÔNG TY TNHH UNIQUE&NICHE GROUP', size: 9, color: BRAND_DARK },
      { text: `BCC — ${branchLabelOf(g.key).toUpperCase()}`, size: 13, color: DARK },
      { text: monthLabel(period).toUpperCase(), size: 9.5, color: BRAND },
    ]);
    ws.getRow(4).height = 4;
    const headerRow = ws.getRow(5);
    headerRow.values = ['STT', 'MÃ NV', 'HỌ TÊN', 'HỆ SỐ', 'LƯƠNG GIỜ',
      ...dayCols.map(d => String(d)),
      'TỔNG GIỜ', 'CA ĐỦ', 'THIẾU', 'VẮNG', 'LƯƠNG CA (đ)', 'THỰC NHẬN (đ)'];
    styleHeaderRow(headerRow, 18);
    ws.columns = [
      { key: 'stt', width: 5.5 }, { key: 'code', width: 11 }, { key: 'name', width: 26 }, { key: 'mode', width: 9 }, { key: 'rate', width: 11 },
      ...dayCols.map(() => ({ width: 5.4 })),
      { key: 'hours', width: 10 }, { key: 'full', width: 8 }, { key: 'partial', width: 8 }, { key: 'absent', width: 8 },
      { key: 'stdpay', width: 15 }, { key: 'net', width: 16 },
    ];
    let rowIdx = 6, stt = 0;
    const dayTotals = new Array(daysInMonth).fill(0);
    let bHours = 0, bFull = 0, bPartial = 0, bAbsent = 0, bStd = 0, bNet = 0;
    let zebraOn = false;
    for (const r of g.rows) {
      stt += 1; zebraOn = !zebraOn;
      const byDay = new Map<number, { hours: number; status: string }>();
      for (const d of r.shifts || []) {
        const day = Number(String(d?.date || '').slice(8, 10));
        if (!day || day < 1 || day > daysInMonth) continue;
        const cur = byDay.get(day) || { hours: 0, status: 'DU' };
        cur.hours = r1(cur.hours + (Number(d?.hours) || 0));
        // Ưu tiên trạng thái xấu nhất trong ngày
        const rank = (s: string) => (s === 'VANG' ? 3 : s === 'THIEU' ? 2 : 1);
        if (rank(String(d?.status || 'DU')) > rank(cur.status)) cur.status = String(d?.status || 'DU');
        byDay.set(day, cur);
      }
      const row = ws.getRow(rowIdx);
      const dayValues = dayCols.map(d => byDay.get(d)?.hours || '');
      row.values = [stt, r.employeeCode, r.fullName,
        String(r.payMode || '').toUpperCase() === 'MONTHLY' ? 'THÁNG' : 'CA',
        Number(r.rate) || 0,
        ...dayValues,
        r1(Number(r.hours) || 0), Number(r.full) || 0, Number(r.partial) || 0, Number(r.absent) || 0,
        Number(r.standardPay) || 0, Number(r.netPay) || 0];
      const stdCol = 6 + daysInMonth, netCol = stdCol + 5;
      row.eachCell((cell, col) => {
        const isDay = col >= 6 && col < 6 + daysInMonth;
        bodyCell(cell, {
          align: col === 1 || (col >= 2 && col <= 5) || isDay ? 'center' : (col > 5 + daysInMonth ? (col >= stdCol + 1 ? 'center' : 'right') : 'left'),
          fmt: isDay ? '0.#' : (col === 5 || (col >= stdCol) && col < netCol ? (col === 5 ? money : undefined) : undefined),
        });
        if (col >= stdCol && col < netCol - 2) cell.numFmt = intFmt;
        if (col === stdCol - 1 || col === stdCol) { cell.numFmt = col === stdCol - 1 ? intFmt : money; }
        if (isDay) {
          const day = col - 5;
          const st = byDay.get(day)?.status;
          if (st === 'VANG') { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }; cell.font = { size: 8.5, bold: true, color: { argb: 'FFB91C1C' }, name: 'Be Vietnam Pro' }; }
          else if (st === 'THIEU') { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } }; cell.font = { size: 8.5, color: { argb: 'FF92400E' }, name: 'Be Vietnam Pro' }; }
          else cell.font = { size: 8.5, color: { argb: 'FF166534' }, name: 'Be Vietnam Pro' };
        }
      });
      row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(3).font = { size: 8.5, bold: true, name: 'Be Vietnam Pro', color: { argb: 'FF' + DARK } };
      zebra(ws, rowIdx, lastColIdx, zebraOn && byDay.size === 0);
      row.height = 17;
      for (const [d, v] of byDay) dayTotals[d - 1] = r1(dayTotals[d - 1] + v.hours);
      bHours += Number(r.hours) || 0; bFull += Number(r.full) || 0; bPartial += Number(r.partial) || 0; bAbsent += Number(r.absent) || 0;
      bStd += Number(r.standardPay) || 0; bNet += Number(r.netPay) || 0;
      rowIdx += 1;
    }
    // Dòng tổng ngày
    const tot = ws.getRow(rowIdx);
    tot.getCell(3).value = `CỘNG ${branchLabelOf(g.key).toUpperCase()}`;
    dayCols.forEach((d, i) => { tot.getCell(5 + d).value = dayTotals[i] || ''; });
    const stdCol = 6 + daysInMonth;
    tot.getCell(stdCol).value = r1(bHours);
    tot.getCell(stdCol + 1).value = bFull;
    tot.getCell(stdCol + 2).value = bPartial;
    tot.getCell(stdCol + 3).value = bAbsent;
    tot.getCell(stdCol + 4).value = bStd;
    tot.getCell(stdCol + 5).value = bNet;
    tot.eachCell((cell, col) => {
      cell.font = { bold: true, size: 8, color: { argb: 'FF' + BRAND_DARK }, name: 'Be Vietnam Pro' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + SOFT } };
      cell.border = { top: { style: 'thin', color: { argb: 'FF' + BRAND } } };
      if (col >= 6) cell.alignment = { horizontal: 'center' };
      if (col >= stdCol) cell.alignment = { horizontal: col === stdCol ? 'center' : 'right' };
      if (col === stdCol) cell.numFmt = hoursFmt;
      if (col >= stdCol + 4) cell.numFmt = money;
    });
    tot.height = 20;
    ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 5 }];
    ws.autoFilter = { from: 'A5', to: `${lastColLetter}5` };
    ws.pageSetup = {
      paperSize: 5, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0.15, footer: 0.15 },
    };
    ws.headerFooter = {
      oddHeader: `&8&K94A3B8BCC — ${branchLabelOf(g.key)} — ${monthLabel(period)}&R&8&K94A3B8&D`,
      oddFooter: `&8&K94A3B8CÔNG TY TNHH UNIQUE&NICHE GROUP&C&8&K94A3B8&P / &N`,
    };
  }
  return toBuffer(wb);
}

/* ============================================================
   03_TINH_LUONG — Công thức kỳ + Nhập tay (LCB/OT/Bonus/Ứng/KPI/ĐP/Ghi chú)
   ============================================================ */
export async function buildTinhLuongXlsx(period: string, formula: any, inputs: any[], employees: any[]): Promise<Buffer> {
  const wb = newWorkbook();
  const p = parsePeriod(period);

  // ---- Sheet CONG_THUC ----
  const fws = wb.addWorksheet('CONG_THUC');
  addTitleBlock(fws, 'D', [
    { text: 'CÔNG TY TNHH UNIQUE&NICHE GROUP', size: 10, color: BRAND_DARK },
    { text: 'CÔNG THỨC LƯƠNG KỲ', size: 15, color: DARK },
    { text: monthLabel(period).toUpperCase(), size: 10, color: BRAND },
  ]);
  fws.getRow(4).height = 6;
  fws.columns = [{ width: 46 }, { width: 26 }, { width: 40 }];
  const fRows: Array<[string, string | number, string?]> = [
    ['Đơn giá giờ THỬ VIỆC (rateTV)', Number(formula?.rateTV) || 21000, 'đ/giờ'],
    ['Đơn giá giờ CHÍNH THỨC (rateCT)', Number(formula?.rateCT) || 25500, 'đ/giờ'],
    ['Ngưỡng tăng ca 1 (giờ/ngày)', Number(formula?.otThreshold1) || 10, 'giờ'],
    ['Ngưỡng tăng ca 2 (giờ/ngày)', Number(formula?.otThreshold2) || 15, 'giờ'],
    ['Cập nhật lúc', formula?.updatedAt ? new Date(formula.updatedAt).toLocaleString('vi-VN') : '—', ''],
    ['Cập nhật bởi', formula?.updatedBy ? String(formula.updatedBy) : '—', ''],
  ];
  let fr = 5;
  for (const [label, value, unit] of fRows) {
    const row = fws.getRow(fr);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true, size: 10, name: 'Be Vietnam Pro', color: { argb: 'FF' + DARK } };
    row.getCell(2).value = value as any;
    row.getCell(2).font = { size: 11, bold: true, name: 'Be Vietnam Pro', color: { argb: 'FF' + BRAND_DARK } };
    row.getCell(3).value = unit || '';
    row.getCell(3).font = { size: 8, color: { argb: 'FF' + MUTED }, name: 'Be Vietnam Pro' };
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + SOFT } };
    row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    row.getCell(1).border = { bottom: { style: 'hair', color: { argb: 'FFE7DEDA' } } };
    row.getCell(2).border = { bottom: { style: 'hair', color: { argb: 'FFE7DEDA' } } };
    row.height = 22;
    fr += 1;
  }
  fws.getRow(fr + 1).getCell(1).value =
    'Ghi chú: THỰC LÃNH = TỔNG CỘNG − Trừ KPI − Phạt trễ/vắng − Ứng lương − Trừ đồng phục. TỔNG CỘNG = LCB (tháng) + Lương giờ + OT thêm + Bonus.';
  fws.getRow(fr + 1).getCell(1).font = { italic: true, size: 8, color: { argb: 'FF' + MUTED }, name: 'Be Vietnam Pro' };
  fws.mergeCells(fr + 1, 1, fr + 1, 3);

  // ---- Sheet NHAP_TAY ----
  const ws = wb.addWorksheet('NHAP_TAY', { views: [{ state: 'frozen', ySplit: 5 }] });
  const lastCol = 'K';
  addTitleBlock(ws, lastCol, [
    { text: 'CÔNG TY TNHH UNIQUE&NICHE GROUP', size: 10, color: BRAND_DARK },
    { text: 'TÍNH LƯƠNG — NHẬP TAY THEO KỲ', size: 15, color: DARK },
    { text: monthLabel(period).toUpperCase(), size: 10, color: BRAND },
  ]);
  ws.getRow(4).height = 6;
  const headerRow = ws.getRow(5);
  headerRow.values = ['STT', 'MÃ NV', 'HỌ TÊN', 'LCB (đ)', 'OT THÊM (đ)', 'BONUS (đ)', 'ỨNG LƯƠNG (đ)', 'TRỪ KPI (đ)', 'TRỪ ĐỒNG PHỤC (đ)', 'GHI CHÚ', 'CHI NHÁNH'];
  styleHeaderRow(headerRow);
  ws.columns = [
    { key: 'stt', width: 6 }, { key: 'code', width: 12 }, { key: 'name', width: 30 },
    { key: 'lcb', width: 15 }, { key: 'ot', width: 14 }, { key: 'bonus', width: 14 }, { key: 'ung', width: 15 },
    { key: 'kpi', width: 14 }, { key: 'dp', width: 16 }, { key: 'note', width: 46 }, { key: 'branch', width: 26 },
  ];
  const inputMap = new Map<string, any>();
  for (const i of inputs || []) inputMap.set(String(i?.employee_id), i);
  const active = (employees || []).filter((e: any) => String(e?.employment_status || '').toUpperCase() !== 'TERMINATED');
  const groups = groupByBranch(active, (e: any) => e.default_branch_id);
  let rowIdx = 6, stt = 0;
  let gLcb = 0, gOt = 0, gBonus = 0, gUng = 0, gKpi = 0, gDp = 0;
  for (const g of groups) {
    branchBandRow(ws, rowIdx, lastCol, branchLabelOf(g.key), g.rows.length);
    rowIdx += 1;
    let bLcb = 0, bOt = 0, bBonus = 0, bUng = 0, bKpi = 0, bDp = 0;
    let zebraOn = false;
    for (const e of g.rows) {
      stt += 1; zebraOn = !zebraOn;
      const inp = inputMap.get(String(e.employee_id)) || {};
      const lcb = Number(inp.luong_cb) || 0, ot = Number(inp.ot_extra) || 0, bonus = Number(inp.bonus_extra) || 0;
      const ung = Number(inp.ung_luong) || 0, kpi = Number(inp.tru_kpi) || 0, dp = Number(inp.dong_phuc) || 0;
      const row = ws.getRow(rowIdx);
      row.values = [stt, e.employee_code, e.full_name, lcb, ot, bonus, ung, kpi, dp, String(inp.note || ''), branchLabelOf(g.key)];
      row.eachCell((cell, col) => {
        bodyCell(cell, { align: col === 1 || col === 2 ? 'center' : (col >= 4 && col <= 9 ? 'right' : 'left'), fmt: col >= 4 && col <= 9 ? money : undefined, bold: col === 4 && lcb > 0 });
      });
      row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
      zebra(ws, rowIdx, 11, zebraOn);
      row.height = 17;
      bLcb += lcb; bOt += ot; bBonus += bonus; bUng += ung; bKpi += kpi; bDp += dp;
      rowIdx += 1;
    }
    subtotalRow(ws, rowIdx, `CỘNG ${branchLabelOf(g.key).toUpperCase()}`,
      { 4: bLcb, 5: bOt, 6: bBonus, 7: bUng, 8: bKpi, 9: bDp },
      { 4: money, 5: money, 6: money, 7: money, 8: money, 9: money });
    gLcb += bLcb; gOt += bOt; gBonus += bBonus; gUng += bUng; gKpi += bKpi; gDp += bDp;
    rowIdx += 1;
  }
  grandTotalRow(ws, rowIdx, 'TỔNG CỘNG TOÀN CÔNG TY',
    { 4: gLcb, 5: gOt, 6: gBonus, 7: gUng, 8: gKpi, 9: gDp },
    { 4: money, 5: money, 6: money, 7: money, 8: money, 9: money });
  pageSetup(ws, lastCol, `Tính lương ${monthLabel(period)}`);
  void p;
  return toBuffer(wb);
}

/* ============================================================
   05_KY_LUONG — Kỳ lương (runs)
   ============================================================ */
export async function buildKyLuongXlsx(period: string, runs: any[]): Promise<Buffer> {
  const wb = newWorkbook();
  const ws = wb.addWorksheet('KY_LUONG', { views: [{ state: 'frozen', ySplit: 5 }] });
  const lastCol = 'L';
  addTitleBlock(ws, lastCol, [
    { text: 'CÔNG TY TNHH UNIQUE&NICHE GROUP', size: 10, color: BRAND_DARK },
    { text: 'KỲ LƯƠNG — TRẠNG THÁI & PHÊ DUYỆT', size: 15, color: DARK },
    { text: monthLabel(period).toUpperCase(), size: 10, color: BRAND },
  ]);
  ws.getRow(4).height = 6;
  const headerRow = ws.getRow(5);
  headerRow.values = ['RUN_ID', 'KỲ', 'TRẠNG THÁI', 'PHẠM VI', 'SỐ NV', 'TỔNG GIỜ', 'TỔNG TIỀN (đ)', 'NGƯỜI TẠO', 'TẠO LÚC', 'DUYỆT LÚC', 'PHÁT HÀNH LÚC', 'ĐÃ TRẢ LÚC'];
  styleHeaderRow(headerRow);
  ws.columns = [
    { key: 'id', width: 34 }, { key: 'period', width: 11 }, { key: 'status', width: 15 }, { key: 'scope', width: 20 },
    { key: 'nv', width: 8 }, { key: 'hours', width: 11 }, { key: 'amount', width: 19 }, { key: 'by', width: 18 },
    { key: 'created', width: 21 }, { key: 'approved', width: 21 }, { key: 'published', width: 21 }, { key: 'paid', width: 21 },
  ];
  const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
    DRAFT: { bg: 'FFF1F5F9', fg: 'FF475569' },
    RECONCILED: { bg: 'FFEFF6FF', fg: 'FF1D4ED8' },
    APPROVED: { bg: 'FFF5F3FF', fg: 'FF7C3AED' },
    PUBLISHED: { bg: 'FFECFDF5', fg: 'FF047857' },
    PAID: { bg: 'FFDCFCE7', fg: 'FF166534' },
    CONFIRMED: { bg: 'FFFEF9C3', fg: 'FF854D0E' },
  };
  const inPeriod = (runs || []).filter(r => String(r?.period) === period)
    .sort((a, b) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')));
  let rowIdx = 6;
  const fmtDate = (v: any) => (v ? new Date(v).toLocaleString('vi-VN') : '—');
  inPeriod.forEach((r, i) => {
    const row = ws.getRow(rowIdx);
    const st = String(r?.status || 'DRAFT').toUpperCase();
    row.values = [r?.run_id, r?.period, st,
      String(r?.branch_scope || 'ALL') === 'ALL' ? 'Toàn hệ thống' : branchLabelOf(r?.branch_scope),
      Number(r?.total_employees) || 0, r1(Number(r?.total_hours) || 0), Number(r?.total_amount) || 0,
      r?.created_by || '—', fmtDate(r?.created_at), fmtDate(r?.approved_at), fmtDate(r?.published_at), fmtDate(r?.paid_at)];
    row.eachCell((cell, col) => {
      bodyCell(cell, { align: col === 2 || col === 5 || col === 6 ? 'center' : (col === 7 ? 'right' : 'left'), fmt: col === 6 ? hoursFmt : (col === 7 ? money : (col === 5 ? intFmt : undefined)), bold: col === 7 });
    });
    const stCell = row.getCell(3);
    const sty = STATUS_STYLE[st] || STATUS_STYLE.DRAFT;
    stCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sty.bg } };
    stCell.font = { bold: true, size: 8, color: { argb: sty.fg }, name: 'Be Vietnam Pro' };
    stCell.alignment = { horizontal: 'center', vertical: 'middle' };
    zebra(ws, rowIdx, 12, i % 2 === 1);
    row.height = 19;
    rowIdx += 1;
  });
  if (inPeriod.length === 0) {
    ws.mergeCells(rowIdx, 1, rowIdx, 12);
    const cell = ws.getCell(rowIdx, 1);
    cell.value = 'Chưa có kỳ lương nào trong tháng này — kế toán bấm "TÍNH LƯƠNG" ở tab Tính Lương để tạo kỳ.';
    cell.font = { italic: true, size: 10, color: { argb: 'FF' + MUTED }, name: 'Be Vietnam Pro' };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(rowIdx).height = 40;
  }
  pageSetup(ws, lastCol, `Kỳ lương ${monthLabel(period)}`);
  return toBuffer(wb);
}

/* ============================================================
   06_THANH_TOAN — Đã chuyển khoản (phiếu PAID)
   ============================================================ */
export async function buildThanhToanXlsx(period: string, slips: any[], empMap: Map<string, any>): Promise<Buffer> {
  const wb = newWorkbook();
  const ws = wb.addWorksheet('THANH_TOAN', { views: [{ state: 'frozen', ySplit: 5 }] });
  const lastCol = 'J';
  const paid = (slips || []).filter(s => String(s?.status || '').toUpperCase() === 'PAID');
  const total = paid.reduce((s, x) => s + (Number(x?.thuc_lanh ?? x?.net_pay) || 0), 0);
  addTitleBlock(ws, lastCol, [
    { text: 'CÔNG TY TNHH UNIQUE&NICHE GROUP', size: 10, color: BRAND_DARK },
    { text: 'THANH TOÁN — ĐÃ CHUYỂN KHOẢN LƯƠNG', size: 15, color: DARK },
    { text: `${monthLabel(period).toUpperCase()}  •  ${paid.length} phiếu  •  Tổng ${total.toLocaleString('vi-VN')} đ`, size: 10, color: BRAND },
  ]);
  ws.getRow(4).height = 6;
  const headerRow = ws.getRow(5);
  headerRow.values = ['STT', 'MÃ NV', 'HỌ TÊN', 'CHI NHÁNH', 'NGÂN HÀNG', 'SỐ TÀI KHOẢN', 'CHỦ TÀI KHOẢN', 'THỰC LÃNH (đ)', 'ĐÃ CHUYỂN LÚC', 'NGƯỜI XÁC NHẬN'];
  styleHeaderRow(headerRow);
  ws.columns = [
    { key: 'stt', width: 6 }, { key: 'code', width: 12 }, { key: 'name', width: 28 }, { key: 'branch', width: 26 },
    { key: 'bank', width: 18 }, { key: 'acct', width: 22 }, { key: 'holder', width: 30 }, { key: 'amount', width: 17 },
    { key: 'paidAt', width: 21 }, { key: 'paidBy', width: 18 },
  ];
  const groups = groupByBranch(paid, (s: any) => empMap.get(String(s?.employee_id))?.default_branch_id || s?.branch_id);
  let rowIdx = 6, stt = 0;
  let gTotal = 0;
  for (const g of groups) {
    branchBandRow(ws, rowIdx, lastCol, branchLabelOf(g.key), g.rows.length);
    rowIdx += 1;
    let bTotal = 0;
    let zebraOn = false;
    for (const s of g.rows) {
      stt += 1; zebraOn = !zebraOn;
      const amt = Number(s?.thuc_lanh ?? s?.net_pay) || 0;
      const row = ws.getRow(rowIdx);
      row.values = [stt, s?.employee_code, s?.full_name, branchLabelOf(g.key),
        s?.bank_name || '—', s?.bank_account || '—', s?.bank_holder || '—', amt,
        s?.slip_paid_at ? new Date(s.slip_paid_at).toLocaleString('vi-VN') : '—', s?.slip_paid_by || '—'];
      row.eachCell((cell, col) => {
        bodyCell(cell, { align: col === 1 || col === 2 ? 'center' : (col === 8 ? 'right' : 'left'), fmt: col === 8 ? money : undefined, bold: col === 8 });
      });
      row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(6).font = { size: 9, bold: true, name: 'Consolas', color: { argb: 'FF' + DARK } };
      zebra(ws, rowIdx, 10, zebraOn);
      row.height = 17;
      bTotal += amt;
      rowIdx += 1;
    }
    subtotalRow(ws, rowIdx, `CỘNG ${branchLabelOf(g.key).toUpperCase()}`, { 8: bTotal }, { 8: money });
    gTotal += bTotal;
    rowIdx += 1;
  }
  grandTotalRow(ws, rowIdx, 'TỔNG ĐÃ CHUYỂN KHOẢN', { 8: gTotal }, { 8: money });
  pageSetup(ws, lastCol, `Thanh toán ${monthLabel(period)}`);
  return toBuffer(wb);
}

/* ============================================================
   07_CAU_HINH_LUONG — Cấu hình lương CB & phụ cấp (theo NV)
   ============================================================ */
export async function buildCauHinhLuongXlsx(period: string, employees: any[], configMap: Record<string, any>): Promise<Buffer> {
  const wb = newWorkbook();
  const ws = wb.addWorksheet('CAU_HINH_LUONG', { views: [{ state: 'frozen', ySplit: 5 }] });
  const lastCol = 'J';
  addTitleBlock(ws, lastCol, [
    { text: 'CÔNG TY TNHH UNIQUE&NICHE GROUP', size: 10, color: BRAND_DARK },
    { text: 'CẤU HÌNH LƯƠNG CB & PHỤ CẤP (THEO NV)', size: 14, color: DARK },
    { text: `${monthLabel(period).toUpperCase()}  •  LCB chỉ áp dụng hình thức THEO THÁNG`, size: 9, color: BRAND },
  ]);
  ws.getRow(4).height = 6;
  const headerRow = ws.getRow(5);
  headerRow.values = ['STT', 'MÃ NV', 'HỌ TÊN', 'CHI NHÁNH', 'KHỐI', 'HÌNH THỨC', 'LƯƠNG CB (đ)', 'PHỤ CẤP (đ)', 'CẬP NHẬT LÚC', 'CẬP NHẬT BỞI'];
  styleHeaderRow(headerRow);
  ws.columns = [
    { key: 'stt', width: 6 }, { key: 'code', width: 12 }, { key: 'name', width: 28 }, { key: 'branch', width: 25 },
    { key: 'block', width: 13 }, { key: 'mode', width: 13 }, { key: 'base', width: 17 }, { key: 'allow', width: 16 },
    { key: 'at', width: 21 }, { key: 'by', width: 20 },
  ];
  const active = (employees || []).filter((e: any) => String(e?.employment_status || '').toUpperCase() !== 'TERMINATED');
  const groups = groupByBranch(active, (e: any) => e.default_branch_id);
  let rowIdx = 6, stt = 0;
  for (const g of groups) {
    branchBandRow(ws, rowIdx, lastCol, branchLabelOf(g.key), g.rows.length);
    rowIdx += 1;
    let zebraOn = false;
    for (const e of g.rows) {
      stt += 1; zebraOn = !zebraOn;
      const cfg = configMap?.[String(e.employee_id)] || {};
      const mode = effectivePayMode(e.group, cfg?.pay_mode);
      const row = ws.getRow(rowIdx);
      row.values = [stt, e.employee_code, e.full_name, branchLabelOf(g.key),
        blockLabelOf(e.group, e.default_branch_id), mode === 'MONTHLY' ? 'Theo tháng' : 'Theo ca',
        Math.max(0, Math.floor(Number(cfg?.base_salary) || 0)), Math.max(0, Math.floor(Number(cfg?.allowance) || 0)),
        cfg?.updatedAt ? new Date(cfg.updatedAt).toLocaleString('vi-VN') : '—', cfg?.updatedByName || cfg?.updatedBy || '—'];
      row.eachCell((cell, col) => {
        bodyCell(cell, { align: col === 1 || col === 2 || col === 6 ? 'center' : (col === 7 || col === 8 ? 'right' : 'left'), fmt: col === 7 || col === 8 ? money : undefined, bold: col === 7 && Number(cfg?.base_salary) > 0 });
      });
      row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
      if (mode === 'MONTHLY') {
        row.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
        row.getCell(6).font = { bold: true, size: 8, color: { argb: 'FF1D4ED8' }, name: 'Be Vietnam Pro' };
      } else {
        row.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
        row.getCell(6).font = { bold: true, size: 8, color: { argb: 'FF92400E' }, name: 'Be Vietnam Pro' };
      }
      zebra(ws, rowIdx, 10, zebraOn);
      row.height = 17;
      rowIdx += 1;
    }
  }
  pageSetup(ws, lastCol, `Cấu hình lương ${monthLabel(period)}`);
  return toBuffer(wb);
}

export const payrollExportFileNames = {
  doiSoatCong: (p: string) => `DOI_SOAT_CONG_${monthFileTag(p)}.xlsx`,
  bcc: (p: string) => `BCC_${monthFileTag(p)}.xlsx`,
  tinhLuong: (p: string) => `TINH_LUONG_${monthFileTag(p)}.xlsx`,
  kyLuong: (p: string) => `KY_LUONG_${monthFileTag(p)}.xlsx`,
  thanhToan: (p: string) => `THANH_TOAN_${monthFileTag(p)}.xlsx`,
  cauHinhLuong: (p: string) => `CAU_HINH_LUONG_${monthFileTag(p)}.xlsx`,
};
