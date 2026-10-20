/**
 * SMOKE TEST: Nhập lịch làm việc tuần bằng Excel (ScheduleExcelService).
 * Round-trip KHÔNG cần mạng/Google API (mock adapter):
 *   1) Sinh file mẫu cho 1 tuần (backend thật + exceljs).
 *   2) "HR điền ca" vào file mẫu rồi xuất lại như 1 file nộp.
 *   3) IMPORT lần 1 → kỳ vọng: tạo ca DRAFT đúng mã/ngày/NV.
 *   4) IMPORT lần 2 (file như nhau) → kỳ vọng: kept đủ, created = 0.
 *   5) IMPORT lần 3 (duỗi CA khác cho ngày tương lai) → kỳ vọng: updated tăng.
 * Chạy từ GỐC repo: node scripts/smoke-excel-import.mjs
 */
import fs from 'fs';
import ExcelJS from 'exceljs';
import { MockSheetsAdapter } from '../apps/backend/dist/repositories/mock-sheets.adapter.js';
import { SchedulesService } from '../apps/backend/dist/services/schedules.service.js';
import { EmployeesService } from '../apps/backend/dist/services/employees.service.js';
import { ScheduleExcelService } from '../apps/backend/dist/services/schedule-excel.service.js';

const fail = (m) => { console.error('SMOKE FAIL:', m); process.exit(1); };

const repo = new MockSheetsAdapter();
// Mock seed rỗng → tự tạo 2 nhân viên test qua API adapter (chất như bài từ Sheets)
let nextNv = 1;
const mkEmp = async (branch) => {
  const id = `EMP_SMOKE${nextNv}`;
  const emp = await repo.createEmployee({
    employee_id: id,
    employee_code: `UBM_NV00${nextNv}`,
    full_name: `Nhan Vien Smoke ${nextNv}`,
    phone_normalized: `090000000${nextNv}`,
    employment_status: 'OFFICIAL',
    default_branch_id: branch,
    default_shift_code: 'CA_1',
    employment_type: 'OFFICIAL',
  });
  nextNv += 1;
  return emp;
};
await mkEmp('CN130'); // NV001 (lát lấy lại qua listEmployees)
await mkEmp('CN130'); // NV002
await mkEmp('CN120'); // NV003 (chi nhánh khác — kiểm tra tùy chọn l)
const schedulesService = new SchedulesService(repo);
const employeesService = new EmployeesService(repo);
const svc = new ScheduleExcelService(repo, schedulesService, employeesService);

const WEEK_MON = '2026-11-02';
const emps = await employeesService.listEmployees(undefined);
if (!emps || emps.length === 0) fail('mock listEmployees rỗng — không thể test');
const activeEmps = emps.filter((e) => String(e.employment_status) !== 'TERMINATED');
if (activeEmps.length < 2) fail('mock cần ít nhất 2 nhân viên active');
const E1 = activeEmps.find((e) => e.employee_code === 'UBM_NV001');
const E2 = activeEmps.find((e) => e.employee_code === 'UBM_NV002');
if (!E1 || !E2) fail(`thiếu NV test: ${activeEmps.map((e) => e.employee_code).join()}`);
console.log('NV test:', E1.employee_code, E2.employee_code);

// 1) FILE MẦU
const tpl = await svc.buildTemplateBuffer(WEEK_MON);
if (!tpl.buffer?.length || tpl.buffer.slice(0, 2).toString('latin1') !== 'PK') fail('buffer mẫu không phải .xlsx');
if (tpl.week !== WEEK_MON) fail(`tuần máy tính: ${tpl.week}`);
console.log('TEMPLATE_OK: size', tpl.buffer.length, 'NV', tpl.employees);

const wbIn = new ExcelJS.Workbook();
await wbIn.xlsx.load(tpl.buffer);
const sheetIn = wbIn.worksheets.find((w) => String(w.name).toUpperCase() === 'LICH');
if (!sheetIn) fail('file mẫu thiếu sheet LICH');
console.log('HEADER:', sheetIn.getRow(1).values.slice(1, 10).join(' | '));

// 2) HR "điền" ca:
//    NV1: T2..CN = CA_1 (7 ô) ; NV2: T2 CA_1, T4 "ca 2" (chuẩn hóa) + CN CA_3
const dates = [];
for (let c = 4; c <= 10; c++) dates.push(String(sheetIn.getRow(1).getCell(c).text || ''));
if (dates.length !== 7 || dates[0] !== WEEK_MON) fail(`cột ngày sai: ${dates.join()}`);
const fillRow = (emp, cells) => {
  const rowIdx = String(emp.employee_code) === E1.employee_code ? 2 : 3;
  const row = sheetIn.getRow(rowIdx);
  cells.forEach((v, i) => (row.getCell(4 + i).value = v));
};
fillRow(E1, ['CA_1', 'CA_1', 'CA_1', 'CA_1', 'CA_1', 'CA_1', 'CA_1']);
fillRow(E2, ['CA_1', '', 'ca 2', '', '', '', 'CA_3']);
const wbOut = new ExcelJS.Workbook();
const wsOut = wbOut.addWorksheet('LICH');
wsOut.addRow(['MA_NV', 'HO_TEN', 'CHI_NHANH', ...dates]);
for (const e of [E1, E2]) {
  const src = sheetIn.getRow(String(e.employee_code) === E1.employee_code ? 2 : 3);
  wsOut.addRow([
    e.employee_code,
    e.full_name || '',
    e.default_branch_id || '',
    ...Array.from({ length: 7 }, (_, i) => src.getCell(4 + i).value ?? null),
  ]);
}
const submitBuf = Buffer.from(await wbOut.xlsx.writeBuffer());
console.log('SUBMIT_OK: size', submitBuf.length);

// 3) IMPORT lần 1
const b64 = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${submitBuf.toString('base64')}`;
const rep1 = await svc.importFromExcel(b64, WEEK_MON, 'smoke-admin');
console.log('IMPORT1:', JSON.stringify({
  created: rep1.created, updated: rep1.updated, kept: rep1.kept,
  errors: rep1.errors?.length, err: rep1.errors?.[0], week: rep1.week,
}));
const expectCreated = 7 + 3; // NV1: 7 ca ; NV2: T2 + T4 + CN = 3
if (rep1.week !== WEEK_MON) fail(`week import: ${rep1.week}`);
if (rep1.created !== expectCreated) fail(`created=${rep1.created} kỳ vọng ${expectCreated}`);
if ((rep1.errors || []).length !== 0) fail('lần 1 không được có lỗi');
// Kiểm tra thật trong repo: DRAFT + đúng mã + chuẩn CHINA CN
const shifts = await repo.getShiftsForWeek('*', WEEK_MON);
const live = shifts.filter((s) => String(s.status) !== 'CANCELLED');
if (live.length !== expectCreated) fail(`repo shifts: ${live.length} kỳ vọng ${expectCreated}`);
if (!live.every((s) => String(s.status) === 'DRAFT')) fail('ca import phải DRAFT');
const meta2 = live.find((s) => String(s.employee_id) === String(E2.employee_id) && String(s.date) === '2026-11-04');
if (!meta2 || String(meta2.shift_code) !== 'CA_2') fail(`"ca 2" không chuẩn hóa: ${JSON.stringify(meta2)}`);
const sat1 = live.find((s) => String(s.employee_id) === String(E1.employee_id) && String(s.date) === '2026-11-02');
if (!/T07:00:00\+07:00$/.test(String(sat1.start_at || ''))) fail(`start_at sai: ${sat1?.start_at}`);

// 4) IMPORT lần 2 — nguyên file: giữ nguyên all, created = 0
const rep2 = await svc.importFromExcel(b64, WEEK_MON, 'smoke-admin');
console.log('IMPORT2:', JSON.stringify({ created: rep2.created, updated: rep2.updated, kept: rep2.kept }));
if (rep2.created !== 0 || rep2.updated !== 0) fail('lần 2 phải 0 tạo/0 sửa');
if (rep2.kept !== expectCreated) fail(`kept=${rep2.kept} kỳ vọng ${expectCreated}`);

// 5) IMPORT lần 3 — NV2 đổi T4 CA_2 → CA_1 (ngày TƯƠNG LAI): updated +1
const wb3 = new ExcelJS.Workbook();
const ws3 = wb3.addWorksheet('LICH');
ws3.addRow(['MA_NV', 'HO_TEN', 'CHI_NHANH', ...dates]);
for (const e of [E1, E2]) {
  const src = sheetIn.getRow(String(e.employee_code) === E1.employee_code ? 2 : 3);
  const cells = Array.from({ length: 7 }, (_, i) => src.getCell(4 + i).value ?? null);
  if (String(e.employee_code) === E2.employee_code) cells[2] = 'CA_1'; // T4: CA_2 → CA_1
  ws3.addRow([e.employee_code, e.full_name || '', e.default_branch_id || '', ...cells]);
}
const buf3 = Buffer.from(await wb3.xlsx.writeBuffer());
const rep3 = await svc.importFromExcel(buf3.toString('base64'), WEEK_MON, 'smoke-admin');
console.log('IMPORT3:', JSON.stringify({ created: rep3.created, updated: rep3.updated, kept: rep3.kept }));
if (rep3.updated !== 1) fail(`updated=${rep3.updated} kỳ vọng 1`);
const afterT4 = (await repo.getShiftsForWeek('*', WEEK_MON))
  .filter((s) => String(s.employee_id) === String(E2.employee_id) && String(s.date) === '2026-11-04' && String(s.status) !== 'CANCELLED');
if (afterT4.length !== 1 || String(afterT4[0].shift_code) !== 'CA_1') fail(`T4 NV2 kỳ vọng 1 ca CA_1: ${JSON.stringify(afterT4)}`);

// 6) File sai mã ca → lỗi từng dòng, không crash + không tạo sai
const wb4 = new ExcelJS.Workbook();
const ws4 = wb4.addWorksheet('LICH');
ws4.addRow(['MA_NV', 'HO_TEN', 'CHI_NHANH', ...dates]);
const src2 = sheetIn.getRow(2);
ws4.addRow([E1.employee_code, E1.full_name || '', '', ...Array.from({ length: 7 }, (_, i) => src2.getCell(4 + i).value ?? null)]);
const r4 = ws4.getRow(2);
r4.getCell(5).value = 'CA_XYZ'; // T3 sai mã
const buf4 = Buffer.from(await wb4.xlsx.writeBuffer());
const rep4 = await svc.importFromExcel(buf4.toString('base64'), WEEK_MON, 'smoke-admin');
console.log('IMPORT4:', JSON.stringify({ created: rep4.created, errors: rep4.errors?.[0] }));
if ((rep4.errors || []).length !== 1 || !/CA_XYZ/.test(String(rep4.errors?.[0]?.message || ''))) fail('kỳ vọng lỗi CA_XYZ');

console.log('\n*** SMOKE EXCEL PASS: template + import (tạo/giữ/đè/lỗi) + chuẩn hóa mã ca + giờ +07:00 OK ***');

// 7) 2 CA CÙNG NGÀY qua ô "1+2" → tạo đủ 2 ca
const wb5 = new ExcelJS.Workbook();
const ws5 = wb5.addWorksheet('LICH');
ws5.addRow(['MA_NV', 'HO_TEN', 'CHI_NHANH', ...dates]);
for (const e of [E1, E2]) {
  const src = sheetIn.getRow(String(e.employee_code) === E1.employee_code ? 2 : 3);
  ws5.addRow([e.employee_code, e.full_name || '', e.default_branch_id || '', ...Array.from({ length: 7 }, (_, i) => src.getCell(4 + i).value ?? null)]);
}
const r5 = ws5.getRow(3); // NV2
r5.getCell(7).value = '1+2'; // 2026-11-05 (T5): 2 ca CA_1 + CA_2
const buf5 = Buffer.from(await wb5.xlsx.writeBuffer());
const rep5 = await svc.importFromExcel(buf5.toString('base64'), WEEK_MON, 'smoke-admin');
console.log('IMPORT5 (2 ca/ngày):', JSON.stringify({ created: rep5.created, updated: rep5.updated, kept: rep5.kept, warn: rep5.warnings?.length }));
if (rep5.created !== 2) fail(`2 ca/ngày: created=${rep5.created} kỳ vọng 2`);
const day5 = (await repo.getShiftsForWeek('*', WEEK_MON))
  .filter((s) => String(s.employee_id) === String(E2.employee_id) && String(s.date) === '2026-11-05' && String(s.status) !== 'CANCELLED')
  .map((s) => String(s.shift_code)).sort();
if (day5.join(',') !== 'CA_1,CA_2') fail(`2 ca/ngày repo: ${day5.join(',')}`);

// 8) Nhập lại ô "1+2" như nhau → kept +2, không đẻ ca thừa
const rep6 = await svc.importFromExcel(buf5.toString('base64'), WEEK_MON, 'smoke-admin');
console.log('IMPORT6 (nhập lại 2 ca):', JSON.stringify({ created: rep6.created, kept: rep6.kept }));
if (rep6.created !== 0 || rep6.kept < 2) fail(`nhập lại 2 ca: created=${rep6.created} kept=${rep6.kept}`);
const day5b = (await repo.getShiftsForWeek('*', WEEK_MON))
  .filter((s) => String(s.employee_id) === String(E2.employee_id) && String(s.date) === '2026-11-05' && String(s.status) !== 'CANCELLED')
  .map((s) => String(s.shift_code)).sort();
if (day5b.join(',') !== 'CA_1,CA_2') fail(`nhập lại 2 ca đẻ thừa: ${day5b.join(',')}`);

console.log('\n*** SMOKE PASS ĐẦY ĐỦ (kể cả 2 ca/ngày "1+2") ***');
