/**
 * Đồng bộ dữ liệu Kế toán lên Google Drive (theo từng tháng).
 *
 * Root (env GOOGLE_DRIVE_PHIEU_LUONG_ROOT_ID, mặc định folder do chủ dự án cấp):
 *   <ROOT>/PHIEU_LUONG/THANG_10/<CN1_130_VAN_KIEP>/<TÊN NV>/PHIEU_LUONG_T10.2026_130.1.pdf
 *   <ROOT>/THANG_10_2026/{01_DOI_SOAT_CONG … 07_CAU_HINH_LUONG}/…   (tự tạo)
 *
 * - ensureAccountingMonthTree: tự tạo folder tháng + folder từng chức năng + folder PHIEU_LUONG tháng.
 * - syncSlipToDrive: xuất 1 phiếu PDF (đủ 3 chữ ký) → đúng cây PHIEU_LUONG/…; ghi kết quả lên slip.
 * - syncMonthToDrive: tạo cây thư mục + xuất Excel (.xlsx) cho TOÀN BỘ 7 chức năng
 *   (01_DOI_SOAT_CONG, 02_BCC, 03_TINH_LUONG, 04_BANG_LUONG_THANG, 05_KY_LUONG,
 *   06_THANH_TOAN, 07_CAU_HINH_LUONG) + đồng bộ PDF cho mọi phiếu PAID.
 * - Lưu trạng thái đồng bộ vào system settings `payslipDriveSync:<period>` (kèm exportErrors nếu có).
 */
import ExcelJS from 'exceljs';
import {
  ACCOUNTING_MONTH_FOLDERS,
  BRANCH_DISPLAY_ORDER,
  branchDriveFolder,
  monthFolderName,
  monthShortFolder,
  parsePeriod,
  payslipDriveFileName,
  payslipDriveSegments,
} from '@ubm/shared';
import { getPayslipDriveRootId } from '../config/drive-folders.js';
import { getDriveStorage } from './drive-storage.service.js';
import { buildPayslipPdf } from './payslip-pdf.service.js';
import {
  buildBccXlsx,
  buildCauHinhLuongXlsx,
  buildDoiSoatCongXlsx,
  buildKyLuongXlsx,
  buildThanhToanXlsx,
  buildTinhLuongXlsx,
  payrollExportFileNames,
} from './payroll-exports.service.js';

const BRANCH_LABEL: Record<string, string> = {
  CN130: 'CN1 — 130 Vạn Kiếp',
  CN261: 'CN2 — 261 Tô Hiến Thành',
  CN120: 'CN3 — 120 Hoàng Diệu 2',
  CN111: 'CN4 — 111 Tôn Đản',
  XUONG_SX: 'Xưởng Sản Xuất (Củ Chi)',
  VAN_PHONG: 'Văn Phòng Trụ Sở',
};
const blockLabelOf = (group?: string | null, branchId?: string | null): string => {
  const g = String(group || '').toUpperCase();
  if (g === 'VAN_PHONG') return 'Văn Phòng';
  if (g === 'XUONG') return 'Xưởng SX';
  if (g === 'SALE') return 'Sales / MKT';
  const b = String(branchId || '').toUpperCase();
  if (b === 'VAN_PHONG') return 'Văn Phòng';
  if (b === 'XUONG_SX') return 'Xưởng SX';
  return 'Cửa Hàng';
};
const branchLabelOf = (id?: string | null) => BRANCH_LABEL[String(id || '').trim()] || String(id || '—');

export interface DriveMonthSyncResult {
  ok: boolean;
  period: string;
  rootId: string;
  monthFolder: string;
  folders: string[];
  files: {
    bangLuongXlsx?: string;
    doiSoatCongXlsx?: string;
    bccXlsx?: string;
    tinhLuongXlsx?: string;
    kyLuongXlsx?: string;
    thanhToanXlsx?: string;
    cauHinhLuongXlsx?: string;
  };
  slips: { total: number; paid: number; pdfSynced: number; pdfFailed: number };
  error?: string;
  exportErrors?: string[];
  at: string;
}

export class PayslipDriveService {
  constructor(private readonly repo: any) {}

  /**
   * Provider trả về Bảng chấm công Finance (PayrollService, đã có cache).
   * app.ts gắn sau khi khởi tạo payrollService — provider này invalidate
   * cache trước khi đọc để Drive luôn nhận dữ liệu TƯƠI.
   */
  private timesheetProvider?: (period: string) => Promise<any>;
  setTimesheetProvider(fn: (period: string) => Promise<any>) {
    this.timesheetProvider = fn;
  }

  /** Tự tạo cây thư mục tháng (idempotent — folder đã có thì tái sử dụng). */
  async ensureAccountingMonthTree(period: string) {
    const rootId = getPayslipDriveRootId();
    const drive = getDriveStorage();
    const month = monthFolderName(period);
    const phMonth = monthShortFolder(period);
    const folders: string[] = [month, `${month}/<chức năng>`, `PHIEU_LUONG/${phMonth}`];
    const monthFolderId = await drive.ensureFolderPath([month], rootId);
    const subfolders: Record<string, string> = {};
    for (const f of ACCOUNTING_MONTH_FOLDERS) {
      subfolders[f.name] = await drive.ensureFolder(f.name, monthFolderId);
    }
    const phieuLuongId = await drive.ensureFolderPath(['PHIEU_LUONG', phMonth], rootId);
    return { rootId, month, monthFolderId, subfolders, phieuLuongId, folders };
  }

  /** Slips của kỳ (run mới nhất, gộp trùng theo NV) — kèm map nhân viên. */
  private async latestSlipsOfPeriod(period: string) {
    const runs: any[] = await this.repo.listPayrollRuns().catch(() => []);
    const inPeriod = (runs || []).filter(r => String(r?.period) === period);
    inPeriod.sort((a, b) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')));
    const latest = inPeriod[0] || null;
    const slips: any[] = latest ? await this.repo.getPayslipsByRunId(latest.run_id).catch(() => []) : [];
    const byEmp = new Map<string, any>();
    for (const s of slips || []) {
      const key = String(s?.employee_id || s?.employee_code || '');
      const cur = byEmp.get(key);
      if (!cur || String(s?.updated_at || s?.created_at || '') >= String(cur?.updated_at || cur?.created_at || '')) {
        byEmp.set(key, s);
      }
    }
    const employees: any[] = await this.repo.listEmployees({ branch: '*' }).catch(() => []);
    const empMap = new Map<string, any>();
    for (const e of employees || []) empMap.set(String(e?.employee_id), e);
    return { latestRun: latest, slips: [...byEmp.values()], empMap, runs: inPeriod };
  }

  /** Đồng bộ 1 phiếu PDF lên Drive (chỉ phiếu PAID). Trả trạng thái, không ném lỗi ra ngoài. */
  async syncSlipToDrive(itemId: string): Promise<{ ok: boolean; fileId?: string; link?: string; error?: string }> {
    try {
      const slip = await this.repo.getPayslipById(itemId);
      if (!slip) return { ok: false, error: 'PAYSLIP_NOT_FOUND' };
      if (String(slip.status).toUpperCase() !== 'PAID') {
        return { ok: false, error: 'Phiếu chưa ở trạng thái ĐÃ CHUYỂN KHOẢN — chỉ đồng bộ phiếu đã thanh toán.' };
      }
      const emp = await this.repo.getEmployeeById(String(slip.employee_id)).catch(() => null);
      const branchId = String(emp?.default_branch_id || slip.branch_id || '');
      const branchName = branchLabelOf(branchId);
      const blockLabel = blockLabelOf(emp?.group, branchId);
      const pdf = await buildPayslipPdf({ slip, branchLabel: branchName, blockLabel });
      const segments = payslipDriveSegments(slip.period, branchId, branchLabelOf(branchId), String(slip.full_name || ''));
      const fileName = payslipDriveFileName(slip.period, String(slip.employee_code || 'NV'));
      const drive = getDriveStorage();
      const rootId = getPayslipDriveRootId();
      const up = await drive.uploadBuffer(fileName, 'application/pdf', pdf, segments, rootId, {
        upsert: true,
        appProperties: { kind: 'payslip', period: String(slip.period || ''), employee_code: String(slip.employee_code || '') },
      });
      await this.repo.updatePayslip(itemId, {
        drive_pdf_id: up.fileId,
        drive_pdf_link: up.viewUrl,
        drive_synced_at: new Date().toISOString(),
        drive_sync_error: '',
      }).catch(() => null);
      return { ok: true, fileId: up.fileId, link: up.viewUrl };
    } catch (err: any) {
      const msg = String(err?.message || err).slice(0, 300);
      await this.repo.updatePayslip(itemId, { drive_sync_error: msg }).catch(() => null);
      return { ok: false, error: msg };
    }
  }

  /** Bảng lương tháng (.xlsx) — bố cục giống file Kế toán (nhóm theo chi nhánh). */
  private async buildPayrollWorkbook(period: string, slips: any[], empMap: Map<string, any>): Promise<Buffer> {
    const p = parsePeriod(period);
    const mm = p ? String(p.month).padStart(2, '0') : '??';
    const yyyy = p ? String(p.year) : '????';
    const wb = new ExcelJS.Workbook();
    wb.creator = 'UMB Milk HR System';
    wb.created = new Date();
    const ws = wb.addWorksheet(`BANG_LUONG_T${mm}`.slice(0, 31), {
      views: [{ state: 'frozen', ySplit: 5 }],
      pageSetup: { paperSize: 5 /* legal */, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.35, bottom: 0.35, header: 0.2, footer: 0.2 } },
    });
    const COLS = ['STT', 'MÃ NV', 'HỌ TÊN', 'CHI NHÁNH', 'GIỜ CÔNG', 'LƯƠNG CA', 'LCB (THÁNG)', 'OT THÊM', 'BONUS', 'TỔNG CỘNG', 'TRỪ KPI/PHẠT', 'ỨNG LƯƠNG', 'TRỪ ĐỒNG PHỤC', 'TỔNG LƯƠNG', 'THỰC LÃNH', 'TRẠNG THÁI'];
    ws.mergeCells('A1:P1');
    ws.getCell('A1').value = 'CÔNG TY TNHH UNIQUE&NICHE GROUP';
    ws.getCell('A1').font = { bold: true, size: 10, color: { argb: 'FFB4457C' } };
    ws.getCell('A1').alignment = { horizontal: 'center' };
    ws.mergeCells('A2:P2');
    ws.getCell('A2').value = 'BẢNG LƯƠNG NHÂN VIÊN';
    ws.getCell('A2').font = { bold: true, size: 16, color: { argb: 'FF273142' } };
    ws.getCell('A2').alignment = { horizontal: 'center' };
    ws.mergeCells('A3:P3');
    ws.getCell('A3').value = `THÁNG ${mm}.${yyyy}`;
    ws.getCell('A3').font = { bold: true, size: 11, color: { argb: 'FFE85D92' } };
    ws.getCell('A3').alignment = { horizontal: 'center' };
    ws.getRow(4).height = 6;
    const headerRow = ws.getRow(5);
    headerRow.values = COLS;
    headerRow.eachCell(cell => {
      cell.font = { bold: true, size: 8, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F3A4A' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF1E293B' } } };
    });
    headerRow.height = 22;
    ws.columns = [
      { key: 'stt', width: 6 }, { key: 'code', width: 12 }, { key: 'name', width: 26 }, { key: 'branch', width: 26 },
      { key: 'hours', width: 11 }, { key: 'lca', width: 15 }, { key: 'lcb', width: 15 }, { key: 'ot', width: 12 },
      { key: 'bonus', width: 13 }, { key: 'tong', width: 16 }, { key: 'kpi', width: 15 }, { key: 'ung', width: 14 },
      { key: 'dp', width: 14 }, { key: 'tl', width: 17 }, { key: 'thuc', width: 18 }, { key: 'status', width: 15 },
    ];

    const byBranch = new Map<string, any[]>();
    for (const s of slips) {
      const emp = empMap.get(String(s?.employee_id));
      const key = String(emp?.default_branch_id || 'KHAC');
      if (!byBranch.has(key)) byBranch.set(key, []);
      byBranch.get(key)!.push(s);
    }
    const branchKeys = [
      ...BRANCH_DISPLAY_ORDER.filter(k => byBranch.has(k)),
      ...[...byBranch.keys()].filter(k => !BRANCH_DISPLAY_ORDER.includes(k)).sort(),
    ];
    const money = '#,##0" đ"';
    let rowIdx = 6, stt = 0;
    let grandTong = 0, grandThuc = 0;
    for (const bk of branchKeys) {
      const list = byBranch.get(bk)!;
      ws.mergeCells(rowIdx, 1, rowIdx, COLS.length);
      const bCell = ws.getCell(rowIdx, 1);
      bCell.value = `▍ ${branchLabelOf(bk).toUpperCase()} — ${list.length} nhân viên`;
      bCell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
      bCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE85D92' } };
      bCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      ws.getRow(rowIdx).height = 20;
      rowIdx += 1;
      let bTong = 0, bThuc = 0, bHours = 0;
      for (const s of list) {
        stt += 1;
        const kpi = (Number(s?.tru_kpi) || 0) + (Number(s?.deduction) || 0);
        const tongCong = Number(s?.tong_cong) || ((Number(s?.standard_pay) || 0) + (Number(s?.luong_cb) || 0) + (Number(s?.ot_extra) || 0) + (Number(s?.bonus) || 0));
        const tl = tongCong - kpi;
        const thuc = Number(s?.thuc_lanh ?? s?.net_pay) || 0;
        bTong += tongCong; bThuc += thuc; bHours += Number(s?.standard_hours) || 0;
        const row = ws.getRow(rowIdx);
        row.values = [stt, s?.employee_code, s?.full_name, branchLabelOf(bk), Number(s?.standard_hours) || 0, Number(s?.standard_pay) || 0, Number(s?.luong_cb) || 0, Number(s?.ot_extra) || 0, Number(s?.bonus) || 0, tongCong, kpi, Number(s?.ung_luong) || 0, Number(s?.dong_phuc) || 0, tl, thuc, String(s?.status || '')];
        row.eachCell((cell, col) => {
          cell.border = { bottom: { style: 'hair', color: { argb: 'FFE7DEDA' } } };
          if (col >= 6 && col <= 15) cell.numFmt = col === 5 ? '#,##0.0" h"' : money;
          if (col === 1 || col === 5) cell.alignment = { horizontal: 'center' };
          if (col >= 6) cell.alignment = { horizontal: 'right' };
          cell.font = { size: 9 };
        });
        row.getCell(2).alignment = { horizontal: 'center' };
        if (stt % 2 === 0) row.eachCell(cell => { if (!cell.fill || (cell.fill as any).pattern !== 'solid') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCFBFA' } }; });
        row.height = 18;
        rowIdx += 1;
      }
      // Subtotal chi nhánh
      const sub = ws.getRow(rowIdx);
      sub.values = ['', '', `CỘNG ${branchLabelOf(bk).toUpperCase()}`, '', Math.round(bHours * 10) / 10, '', '', '', '', bTong, '', '', '', '', bThuc, ''];
      sub.eachCell((cell, col) => {
        cell.font = { bold: true, size: 8.5, color: { argb: 'FFB4457C' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2F7' } };
        if (col >= 6) { cell.numFmt = money; cell.alignment = { horizontal: 'right' }; }
        if (col === 5) cell.alignment = { horizontal: 'center' };
        cell.border = { top: { style: 'thin', color: { argb: 'FFE85D92' } } };
      });
      sub.height = 19;
      rowIdx += 1;
      grandTong += bTong; grandThuc += bThuc;
    }
    const grand = ws.getRow(rowIdx);
    grand.values = ['', '', 'TỔNG CỘNG TOÀN CÔNG TY', '', '', '', '', '', '', grandTong, '', '', '', '', grandThuc, ''];
    grand.eachCell((cell, col) => {
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF273142' } };
      if (col >= 6) { cell.numFmt = money; cell.alignment = { horizontal: 'right' }; }
    });
    grand.height = 24;
    ws.autoFilter = { from: 'A5', to: `P5` };
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf as ArrayBuffer);
  }

  /** Đồng bộ TOÀN BỘ dữ liệu tháng lên Drive (cây thư mục + file). */
  async syncMonthToDrive(period: string, actorId?: string): Promise<DriveMonthSyncResult> {
    const at = new Date().toISOString();
    const rootId = getPayslipDriveRootId();
    const month = monthFolderName(period);
    const result: DriveMonthSyncResult = {
      ok: false, period, rootId, monthFolder: month, folders: [], files: {},
      slips: { total: 0, paid: 0, pdfSynced: 0, pdfFailed: 0 }, at,
    };
    try {
      const tree = await this.ensureAccountingMonthTree(period);
      result.folders = [tree.monthFolderId, ...Object.values(tree.subfolders), tree.phieuLuongId].filter(Boolean).map(String);
      const { latestRun, slips, empMap, runs } = await this.latestSlipsOfPeriod(period);
      result.slips.total = slips.length;
      result.slips.paid = slips.filter(s => String(s?.status).toUpperCase() === 'PAID').length;

      const drive = getDriveStorage();
      const _p = parsePeriod(period);
      const mm = _p ? String(_p.month).padStart(2, '0') : '??';
      const yyyy = _p ? String(_p.year) : '????';
      const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const exportErrors: string[] = [];
      const uploadXlsx = async (buf: Buffer, fileName: string, segments: string[]) => {
        const up = await drive.uploadBuffer(fileName, XLSX_MIME, buf, segments, rootId, { upsert: true });
        return up.viewUrl;
      };
      // Dữ liệu dùng chung cho các export Excel
      const employeesAll: any[] = await this.repo.listEmployees({ branch: '*' }).catch(() => []);
      let timesheet: any = null;
      if (this.timesheetProvider) {
        try { timesheet = await this.timesheetProvider(period); } catch (e: any) { exportErrors.push(`Bảng công: ${String(e?.message || e).slice(0, 200)}`); }
      }
      const formula = await this.repo.getPayrollFormula(period).catch(() => null);
      const inputs = await this.repo.getPayrollInputs(period).catch(() => [] as any[]);
      const salaryCfgSettings = (await this.repo.getSystemSettings().catch(() => ({}))) || {};
      const salaryConfigMap = (salaryCfgSettings?.employee_salary_config && typeof salaryCfgSettings.employee_salary_config === 'object')
        ? salaryCfgSettings.employee_salary_config : {};

      // 1) BẢNG LƯƠNG THÁNG (.xlsx) → 04_BANG_LUONG_THANG
      if (slips.length > 0) {
        try {
          const xlsx = await this.buildPayrollWorkbook(period, slips, empMap);
          result.files.bangLuongXlsx = await uploadXlsx(xlsx, `BANG_LUONG_THANG_${mm}_${yyyy}.xlsx`, [month, '04_BANG_LUONG_THANG']);
        } catch (e: any) { exportErrors.push(`Bảng lương: ${String(e?.message || e).slice(0, 200)}`); }
      }
      // 2) ĐỐI SOÁT CÔNG (.xlsx) → 01_DOI_SOAT_CONG
      if (timesheet) {
        try {
          const buf = await buildDoiSoatCongXlsx(period, timesheet);
          result.files.doiSoatCongXlsx = await uploadXlsx(buf, payrollExportFileNames.doiSoatCong(period), [month, '01_DOI_SOAT_CONG']);
        } catch (e: any) { exportErrors.push(`Đối soát công: ${String(e?.message || e).slice(0, 200)}`); }
        // 3) BCC THEO NGÀY (.xlsx, 1 sheet/chi nhánh) → 02_BCC
        try {
          const buf = await buildBccXlsx(period, timesheet);
          result.files.bccXlsx = await uploadXlsx(buf, payrollExportFileNames.bcc(period), [month, '02_BCC']);
        } catch (e: any) { exportErrors.push(`BCC: ${String(e?.message || e).slice(0, 200)}`); }
      } else {
        exportErrors.push('Đối soát công/BCC: không lấy được dữ liệu bảng chấm công');
      }
      // 4) TÍNH LƯƠNG — công thức + nhập tay (.xlsx) → 03_TINH_LUONG
      try {
        const buf = await buildTinhLuongXlsx(period, formula, inputs, employeesAll);
        result.files.tinhLuongXlsx = await uploadXlsx(buf, payrollExportFileNames.tinhLuong(period), [month, '03_TINH_LUONG']);
      } catch (e: any) { exportErrors.push(`Tính lương: ${String(e?.message || e).slice(0, 200)}`); }
      // 5) KỲ LƯƠNG (.xlsx) → 05_KY_LUONG
      try {
        const buf = await buildKyLuongXlsx(period, runs || []);
        result.files.kyLuongXlsx = await uploadXlsx(buf, payrollExportFileNames.kyLuong(period), [month, '05_KY_LUONG']);
      } catch (e: any) { exportErrors.push(`Kỳ lương: ${String(e?.message || e).slice(0, 200)}`); }
      // 6) THANH TOÁN — phiếu đã chuyển khoản (.xlsx) → 06_THANH_TOAN
      try {
        const buf = await buildThanhToanXlsx(period, slips, empMap);
        result.files.thanhToanXlsx = await uploadXlsx(buf, payrollExportFileNames.thanhToan(period), [month, '06_THANH_TOAN']);
      } catch (e: any) { exportErrors.push(`Thanh toán: ${String(e?.message || e).slice(0, 200)}`); }
      // 7) CẤU HÌNH LƯƠNG CB & PHỤ CẤP (.xlsx) → 07_CAU_HINH_LUONG
      try {
        const buf = await buildCauHinhLuongXlsx(period, employeesAll, salaryConfigMap);
        result.files.cauHinhLuongXlsx = await uploadXlsx(buf, payrollExportFileNames.cauHinhLuong(period), [month, '07_CAU_HINH_LUONG']);
      } catch (e: any) { exportErrors.push(`Cấu hình lương: ${String(e?.message || e).slice(0, 200)}`); }
      if (exportErrors.length) result.exportErrors = exportErrors;
      // 8) PDF phiếu lương (PAID) → PHIEU_LUONG/THANG_MM/CN/TÊN NV
      const paidSlips = slips.filter(s => String(s?.status).toUpperCase() === 'PAID');
      for (const s of paidSlips) {
        const r = await this.syncSlipToDrive(String(s.item_id));
        if (r.ok) result.slips.pdfSynced += 1; else result.slips.pdfFailed += 1;
      }
      result.ok = true;
    } catch (err: any) {
      result.error = String(err?.message || err).slice(0, 400);
    }
    try {
      const settings = (await this.repo.getSystemSettings().catch(() => ({}))) || {};
      await this.repo.updateSystemSettings({
        ...settings,
        [`payslipDriveSync:${period}`]: { at, by: actorId || '', ok: result.ok, rootId, monthFolder: month, files: result.files, slips: result.slips, error: result.error || '', exportErrors: result.exportErrors || [] },
        payslipDriveSyncLast: { period, at, ok: result.ok },
      });
    } catch { /* best-effort */ }
    return result;
  }

  /** Trạng thái đồng bộ Drive của kỳ (đọc từ system settings). */
  async getSyncStatus(period: string) {
    const settings = (await this.repo.getSystemSettings().catch(() => ({}))) || {};
    return {
      period,
      rootId: getPayslipDriveRootId(),
      monthFolder: monthFolderName(period),
      last: settings[`payslipDriveSync:${period}`] || null,
      lastAny: settings.payslipDriveSyncLast || null,
      configured: getDriveStorage().isConfigured(),
      auth: getDriveStorage().getStatus(),
    };
  }
}
