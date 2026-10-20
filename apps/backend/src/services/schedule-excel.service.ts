/**
 * ScheduleExcelService — Nhập / tải mẫu LỊCH LÀM VIỆC TUẦN bằng file Excel.
 *
 * - File mẫu: điền sẵn toàn bộ nhân viên (Mã NV, Họ tên, Chi nhánh) + 7 cột
 *   ngày ISO T2→CN + dropdown (CA_1/CA_2/CA_3) + sheet HƯỚNG DẪN.
 * - Import: đọc file .xlsx (base64 JSON — cùng pattern avatar), khớp nhân viên
 *   theo Mã NV, rồi tạo / sửa / giữ ca trong MỘT task hàng đợi duy nhất
 *   (chỉ 1 lần đọc tuần — tránh N×rate-limit 1100ms gây timeout proxy).
 * - Ca tạo = DRAFT, hành xử như xếp tay "Bổ Sung Lịch NV" (tự hủy OFF khi ca
 *   trúng ngày nghỉ); Phát Hành (PUBLISH) vẫn là nút có sẵn của tab.
 *   Ca trong file khác ca đang có → chỉ sửa khi ngày tương lai + chưa điểm danh;
 *   ô trống = không xếp ca; mã ca sai → báo lỗi dòng.
 */
import ExcelJS from 'exceljs';
import { SHIFT_TEMPLATES } from '@ubm/shared';
import type { ShiftCode } from '@ubm/shared';
import { canonicalBranch } from './auto-schedule.service.js';
import { SchedulesService } from './schedules.service.js';
import { EmployeesService } from './employees.service.js';
import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { currentVnWeekRange } from './weekly-off.service.js';
import { singleWriterQueue } from '../repositories/single-writer-queue.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export { XLSX_MIME };
const VALID_CODES = Object.keys(SHIFT_TEMPLATES);

type ImportRowError = {
  row: number;
  maNV: string;
  name: string;
  date: string;
  message: string;
};

type ImportReport = {
  created: number;
  updated: number;
  kept: number;
  errors: ImportRowError[];
  warnings: string[];
  notified: number;
};

type EmpImportSummary = {
  employeeId: string;
  maNV: string;
  name: string;
  created: string[];
  updated: string[];
  offNotes: string[];
};

/** "ca 1" | "CA1" | "1" → "CA_1"; ô trống → ''; khác → nguyên chuỗi (rồi báo lỗi). */
function normalizeCode(v: ExcelJS.CellValue): string {
  const t = String(v ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
  if (/^CA_?[123]$/.test(t)) return `CA_${t.slice(-1)}`;
  if (t === '1' || t === '2' || t === '3') return `CA_${t}`;
  return t;
}

export class ScheduleExcelService {
  constructor(
    private repo: ISheetsRepository,
    private schedulesService: SchedulesService,
    private employeesService: EmployeesService
  ) {}

  private mondayOf(dateIso: string): string {
    const d = new Date(`${dateIso.slice(0, 10)}T00:00:00Z`);
    const offset = (d.getUTCDay() + 6) % 7; // 0 = Mon ... 6 = Sun
    d.setUTCDate(d.getUTCDate() - offset);
    return d.toISOString().slice(0, 10);
  }

  private vnToday(): string {
    return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  }

  private addDaysIso(dateIso: string, days: number): string {
    const d = new Date(`${dateIso.slice(0, 10)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  private weekDatesOf(monIso: string): string[] {
    return Array.from({ length: 7 }, (_, i) => this.addDaysIso(monIso, i));
  }

  private hoursOf(code: string): { startAt: string; endAt: string } | null {
    const t = SHIFT_TEMPLATES[code as keyof typeof SHIFT_TEMPLATES];
    if (!t) return null;
    const p = (n: number) => String(n).padStart(2, '0');
    const startHour = p(t.start_hour);
    const endHour = p(t.end_hour);
    return {
      startAt: `${startHour}:00:00+07:00`, // chuỗi giờ — gắn với ngày bằng `${date}T...`
      endAt: `${endHour}:00:00+07:00`,
    };
  }

  /**
   * Sinh file mẫu .xlsx: sheet LICH (nhân viên thật + 7 cột ngày ISO) và
   * sheet HUONG_DAN. `weekStart` = tuần chọn trên modal; thiếu → tuần VN này.
   */
  async buildTemplateBuffer(
    weekStart?: string
  ): Promise<{ buffer: Buffer; week: string; employees: number }> {
    const week = this.mondayOf((weekStart || currentVnWeekRange().mon).slice(0, 10));
    const weekDates = this.weekDatesOf(week);
    const emps = await this.employeesService.listEmployees(undefined);
    const active = (emps || []).filter(
      (e: any) => String(e.employment_status || '') !== 'TERMINATED'
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = 'UBM HR';

    const ws = wb.addWorksheet('LICH', {
      views: [{ state: 'frozen', ySplit: 1, xSplit: 3 }],
    });

    // Dòng tiêu đề: MA_NV | HO_TEN | CHI_NHANH | 7 ngày ISO (T2→CN)
    ws.addRow(['MA_NV', 'HO_TEN', 'CHI_NHANH', ...weekDates]);
    const header = ws.getRow(1);
    header.height = 22;
    for (let c = 1; c <= 3 + 7; c++) {
      const cell = header.getCell(c);
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    }

    // Điền sẵn nhân viên (3 cột đầu; các ô ca để trống cho HR xếp)
    for (const e of active) {
      ws.addRow([
        e.employee_code || '',
        e.full_name || '',
        canonicalBranch(e.default_branch_id) || '',
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ]);
    }

    const lastRow = Math.max(1 + active.length, 2);
    ws.columns.forEach((col, i) => {
      col.width = i < 3 ? (i === 1 ? 26 : 14) : 12;
    });
    for (let r = 2; r <= lastRow; r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= 3 + 7; c++) {
        const cell = row.getCell(c);
        cell.border = {
          top: { style: 'hair' },
          left: { style: 'hair' },
          bottom: { style: 'hair' },
          right: { style: 'hair' },
        };
        cell.alignment = { horizontal: c <= 2 ? 'left' : 'center', vertical: 'middle' };
      }
    }

    // Dropdown CA_1/CA_2/CA_3 (kể cả dòng trống dự phòng bên dưới)
    // (exceljs typings không khai báo dataValidations — runtime có sẵn.)
    (ws as any).dataValidations.add('D2:J300', {
      type: 'list',
      allowBlank: true,
      formulae: ['"CA_1,CA_2,CA_3"'],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Ma ca sai',
      error: `Chi nhap: ${VALID_CODES.join(', ')}`,
    });

    // Sheet hướng dẫn
    const gd = wb.addWorksheet('HUONG_DAN');
    gd.columns = [{ width: 110 }];
    const lines = [
      'CÁCH DÙNG FILE LỊCH LÀM VIỆC TUẦN',
      '1. Giữ nguyên DÒNG 1 (tiêu đề): MA_NV, HO_TEN, CHI_NHANH và 7 ngày YYYY-MM-DD từ thứ Hai tới Chủ Nhật.',
      '2. Chỉ điền ở sheet LICH, từ dòng 2 trở đi. Mỗi nhân viên 1 dòng (đã điền sẵn danh sách).',
      '3. Ô ca: gõ CA_1 (07-12) / CA_2 (12-18) / CA_3 (18-23) — có dropdown gợi ý. Ô TRỐNG = không xếp ca.',
      '4. Không đổi cột MA_NV. Nhân viên mới chưa có trong file: bổ sung dòng mới với Mã NV đúng (UBM_NVxxxxxx).',
      '5. Xuất file giữ nguyên .xlsx, rồi bấm "Nhập lịch Excel" trên cổng Admin, chọn đúng tuần rồi Xác nhận nhập.',
      '',
      'QUY TẮC NHẬP: ca trùng ca hiện có → giữ nguyên; ca khác ca hiện có (ngày tương lai, chưa điểm danh) → được thay thế; ngày đã qua → bỏ qua và báo cáo.',
      '',
      `Tuần áp dụng của file này: ${week} → ${weekDates[6]} (T2 → CN).`,
    ];
    lines.forEach((l, i) => {
      const row = gd.addRow([l]);
      const cell = row.getCell(1);
      cell.alignment = { wrapText: true, vertical: 'middle' };
      if (i === 0) {
        cell.font = { bold: true, size: 14, color: { argb: 'FF2F5597' } };
        row.height = 24;
      }
    });

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return { buffer, week, employees: active.length };
  }

  // ======== IMPORT ========

  /** Giải phóng base64/dataURL → Buffer .xlsx (kiểm tra chữ ký PK). */
  private decodeXlsx(body: string): Buffer {
    const b64 = String(body || '').replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length || buf.slice(0, 2).toString('latin1') !== 'PK') {
      throw new Error(
        'EXCEL_BAD_FILE: file không phải .xlsx hợp lệ (chỉ nhận .xlsx — không nhận .xls/.csv/.jpg/.png).'
      );
    }
    return buf;
  }

  /** Đọc ô ngày (chuỗi "T2 2026-11-02", ISO, hoặc Date của ExcelJS) → YYYY-MM-DD */
  private isoOfCell(v: ExcelJS.CellValue): string {
    if (!v) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'string' || typeof v === 'number') return this.isoOfString(String(v));
    const o = v as {
      text?: string;
      result?: Date;
      richText?: { text: string }[];
    };
    if (o.result instanceof Date) return o.result.toISOString().slice(0, 10);
    const text =
      typeof o.text === 'string'
        ? o.text
        : Array.isArray(o.richText)
          ? o.richText.map((r) => r.text).join('')
          : '';
    return text ? this.isoOfString(text) : '';
  }

  private isoOfString(s: string): string {
    const m = String(s || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return '';
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }

  /**
   * Import lịch tuần từ file .xlsx (base64/dataURL).
   * @param weekFallback tuần dự phòng khi file không ghi ngày (tuần chọn trên modal)
   * @param actorId user id của ADMIN (actor trong hàng đợi ghi single-writer)
   */
  async importFromExcel(fileBody: string, weekFallback: string | undefined, actorId: string) {
    const wb = new ExcelJS.Workbook();
    const raw = this.decodeXlsx(fileBody);
    await wb.xlsx.load(raw as unknown as ExcelJS.Buffer);

    // Sheet ưu tiên: LICH / LICH_LAM_VIEC / SCHEDULE; không có → sheet đầu tiên.
    const ws =
      wb.worksheets.find((w) => /^(LICH|LICH_LAM_VIEC|SCHEDULE)$/i.test(String(w.name || ''))) ||
      wb.worksheets[0];
    if (!ws) throw new Error('EXCEL_EMPTY: file không có sheet nào!');

    // Bảng tuần: đọc ngày ISO ở dòng 1 (cột D trở đi).
    const headerRow = ws.getRow(1);
    const dataCols: string[] = [];
    for (let c = 4; c <= Math.min(headerRow.cellCount, 20); c++) {
      const iso = this.isoOfCell(headerRow.getCell(c).value);
      if (iso) dataCols.push(iso);
    }
    if (dataCols.length === 0 && weekFallback) {
      dataCols.push(...this.weekDatesOf(this.mondayOf(weekFallback)));
    }
    if (dataCols.length !== 7) {
      throw new Error(
        'EXCEL_BAD_WEEK: dòng 1 phải có đủ 7 ngày YYYY-MM-DD liên tiếp T2→CN (hoặc chọn tuần trên modal để dùng khi file không ghi ngày).'
      );
    }
    const monIso = this.mondayOf(dataCols[0]);
    if (dataCols[0] !== monIso) {
      throw new Error(`EXCEL_NOT_MONDAY: ngày đầu tiên trong file (${dataCols[0]}) phải là THỨ HAI!`);
    }
    const weekDates = this.weekDatesOf(monIso);
    if (dataCols.some((d) => !weekDates.includes(d))) {
      throw new Error(
        `EXCEL_WEEK_NOT_CONTINUOUS: 7 ngày phải liên tiếp từ ${monIso} (T2) đến ${weekDates[6]} (CN).`
      );
    }

    const report = await this.runImportTask(ws, weekDates, monIso, actorId);
    // REALTIME: phát thông báo cá nhân cho TỪNG nhân viên bị file tác động
    // (ca mới / ca đổi / OFF tự hủy) — nhân viên online thấy ngay, offline sẽ
    // thấy lịch mới ngay lần mở cổng NV kế (dữ liệu đã chốt trong Sheets).
    const perEmp: EmpImportSummary[] = (report as any).perEmp || [];
    const items = perEmp.map((p) => {
      const parts: string[] = [];
      if (p.created.length) parts.push(`+${p.created.length} ca mới (${p.created.join(', ')})`);
      if (p.updated.length) parts.push(`đổi ${p.updated.length} ca (${p.updated.join(', ')})`);
      if (p.offNotes.length) parts.push(p.offNotes.join(' '));
      return {
        employeeId: p.employeeId,
        title: `📅 Lịch tuần ${monIso} của bạn đã được cập nhật`,
        message: `Admin vừa nhập lịch qua Excel: ${parts.join('; ') || 'không có thay đổi'}.`,
      };
    });
    const notified = this.schedulesService.notifyEmployeesRealtime(items);
    const { perEmp: _internal, ...clean } = report as any;
    return { week: monIso, ...clean, notified };
  }

  /** Toàn bộ import nằm trong MỘT task hàng đợi single-writer. */
  private async runImportTask(
    ws: ExcelJS.Worksheet,
    weekDates: string[],
    monIso: string,
    actorId: string
  ): Promise<ImportReport & { perEmp: EmpImportSummary[] }> {
    const vnToday = this.vnToday();
    const task = await singleWriterQueue.enqueue({
      entityType: 'PHAN_CONG_CA',
      entityId: `EXCEL_IMPORT_${monIso}`,
      actorId,
      execute: async () => {
        let created = 0;
        let updated = 0;
        let kept = 0;
        const errors: ImportRowError[] = [];
        const warnings: string[] = [];
        // Tổng hợp thay đổi theo TỪNG nhân viên → phát realtime cuối import
        const perEmp = new Map<string, EmpImportSummary>();
        const empSummary = (id: string, code: string, name: string): EmpImportSummary => {
          if (!perEmp.has(id)) perEmp.set(id, { employeeId: id, maNV: code, name, created: [], updated: [], offNotes: [] });
          return perEmp.get(id)!;
        };

        // (1) Nhân viên → map theo Mã NV (bỏ qua hoa/thường)
        const employees = await this.repo.listEmployees(undefined).catch(() => []);
        const empByCode = new Map<string, any>();
        for (const e of employees || []) {
          const code = String((e as any).employee_code || '').trim().toUpperCase();
          if (code) empByCode.set(code, e);
        }

        // (2) Ca hiện có trong tuần → chỉ mục "NV|ngày|CN" (1 lần đọc duy nhất)
        const existing = await this.repo.getShiftsForWeek('*', monIso).catch(() => []);
        const byEmpDate = new Map<string, any[]>();
        for (const s of existing || []) {
          const d = String((s as any).date || '').slice(0, 10);
          if (!weekDates.includes(d)) continue;
          if (String((s as any).status || '') === 'CANCELLED') continue;
          const key = `${(s as any).employee_id}|${d}|${canonicalBranch((s as any).branch_id)}`;
          if (!byEmpDate.has(key)) byEmpDate.set(key, []);
          byEmpDate.get(key)!.push(s);
        }

        // (3) Duyệt từng dòng Excel (dòng 2 trở đi)
        for (let r = 2; r <= Math.min(ws.rowCount, 500); r++) {
          const row = ws.getRow(r);
          const rawCode = String(row.getCell(1).value ?? '').trim();
          if (!rawCode) continue; // dòng trống
          const maNV = rawCode.toUpperCase();
          const empName = String(row.getCell(2).value ?? '').trim();
          const emp = empByCode.get(maNV);
          if (!emp) {
            errors.push({ row: r, maNV, name: empName, date: '', message: `Nhân viên không tồn tại: ${maNV}` });
            continue;
          }
          if (String(emp.employment_status || '') === 'TERMINATED') {
            errors.push({ row: r, maNV, name: empName, date: '', message: `${maNV} đã nghỉ việc — không xếp ca` });
            continue;
          }
          const branchId =
            canonicalBranch(String(row.getCell(3).value ?? '').trim().toUpperCase()) ||
            canonicalBranch(emp.default_branch_id) ||
            'CN130';

          for (let i = 0; i < 7; i++) {
            const date = weekDates[i];
            const code = normalizeCode(row.getCell(4 + i).value);
            if (!code) continue; // ô trống = không xếp ca
            if (!VALID_CODES.includes(code)) {
              errors.push({
                row: r,
                maNV,
                name: empName,
                date,
                message: `Mã ca "${code}" không hợp lệ (dùng CA_1/CA_2/CA_3)`,
              });
              continue;
            }

            const sameDay = (
              byEmpDate.get(`${emp.employee_id}|${date}|${canonicalBranch(branchId)}`) || []
            ).filter((s: any) => String(s.status || '') !== 'CANCELLED');

            if (sameDay.some((s: any) => String(s.shift_code) === code)) {
              kept += 1; // đã đúng ca → giữ nguyên (bảo toàn điểm danh/byt status)
              continue;
            }
            if (sameDay.length > 0) {
              // Có ca khác mã: chỉ sửa tương lai + chưa điểm danh
              if (date <= vnToday) {
                errors.push({
                  row: r,
                  maNV,
                  name: empName,
                  date,
                  message: `Ngày đã qua: hiện là ${sameDay[0].shift_code} — không sửa qua Excel`,
                });
                continue;
              }
              const hasAttend = await this.repo
                .getAttendanceEvents(String(emp.employee_id), date)
                .then((ev) => (ev || []).length > 0)
                .catch(() => true);
              if (hasAttend) {
                errors.push({
                  row: r,
                  maNV,
                  name: empName,
                  date,
                  message: `Đã có điểm danh ngày ${date} — không đổi ca qua Excel`,
                });
                continue;
              }
              const cur = sameDay[0];
              const hours = this.hoursOf(code)!;
              await this.repo.updateShiftAssignment(String(cur.assignment_id), {
                shift_code: code as ShiftCode,
                start_at: `${date}T${hours.startAt}`,
                end_at: `${date}T${hours.endAt}`,
                schedule_version: Number((cur as any).schedule_version || 1) + 1,
              });
              empSummary(String(emp.employee_id), maNV, empName).updated.push(`${date.slice(5)} ${code}`);
              updated += 1;
              continue;
            }

            // Tạo ca mới — hành xử như "Bổ Sung Lịch NV": DRAFT + tự hủy OFF trúng ngày
            const hours = this.hoursOf(code)!;
            await this.repo.createShiftAssignment({
              assignment_id: `SHIFT_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
              employee_id: String(emp.employee_id),
              branch_id: branchId,
              shift_code: code as ShiftCode,
              date,
              start_at: `${date}T${hours.startAt}`,
              end_at: `${date}T${hours.endAt}`,
              status: 'DRAFT',
              schedule_version: 1,
            });
            const offNotes = await this.schedulesService
              .cancelReceiverLeavesOnWorkDay(String(emp.employee_id), date)
              .catch(() => [] as string[]);
            const summary = empSummary(String(emp.employee_id), maNV, empName);
            summary.created.push(`${date.slice(5)} ${code}`);
            if (offNotes.length > 0) {
              summary.offNotes.push(...offNotes);
              warnings.push(`${maNV} ngày ${date}: ${offNotes.join(' ')}`);
            }
            created += 1;
          }
        }

        return { created, updated, kept, errors, warnings, perEmp: Array.from(perEmp.values()) };
      },
    });
    return (task as any).result as ImportReport & { perEmp: EmpImportSummary[] };
  }
}
