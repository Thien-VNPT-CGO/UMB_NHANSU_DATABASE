/**
 * SMOKE TEST: Phiếu "Cập Nhật Ca Làm" tự phục vụ của nhân viên (ShiftReRegService).
 * Round-trip KHÔNG cần mạng/Google API (mock adapter + fake Sheet sync):
 *   1) NV cũ (ngày qua) + chưa điểm danh → TỰ TẠO ca → bot chấm HOÀN THÀNH
 *      (2 chân CHECK_IN + CHECK_OUT gắn ca, giờ chuẩn ca +07:00) + tiền ca ước tính.
 *   2) NV chưa tới (ngày tương lai) → TỰ TẠO ca, chờ điểm danh (không có event).
 *   3) Gửi phiếu lặp ca đã hoàn thành → GIỮ (kept) + vẫn đủ công, không ghi đôi.
 *   4) 2 ca cùng ngày → tạo đủ 2; ngày ngoài đợt 01/10 → 24/10 → bị chặn.
 *   5) Đè ca khác mã ở ngày đã có CHẤM CÔNG → bị chặn, giữ bằng chứng công.
 *   6) Phiếu ghi đồng bộ fake Sheet: đủ dòng = số ca trong phiếu.
 * Chạy từ GỐC repo: node scripts/smoke-shift-rereg.mjs (npm run build:backend trước).
 */
import { MockSheetsAdapter } from '../apps/backend/dist/repositories/mock-sheets.adapter.js';
import { SchedulesService } from '../apps/backend/dist/services/schedules.service.js';
import { EmployeesService } from '../apps/backend/dist/services/employees.service.js';
import { AttendanceService } from '../apps/backend/dist/services/attendance.service.js';
import { ShiftReRegService } from '../apps/backend/dist/services/shift-rereg.service.js';

const fail = (m) => { console.error('SMOKE FAIL:', m); process.exit(1); };

const repo = new MockSheetsAdapter();
const emp = await repo.createEmployee({
  employee_id: 'EMP_SMOKE_REREG',
  employee_code: 'UBM_NR001',
  full_name: 'Nhan Vien ReReg',
  phone_normalized: '0900000011',
  employment_status: 'OFFICIAL',
  employment_type: 'OFFICIAL',
  default_branch_id: 'CN130',
  default_shift_code: 'CA_1',
  current_rate_per_hour: 30000,
});
console.log('NV test:', emp.employee_code, '| rate:', emp.current_rate_per_hour);

const schedulesService = new SchedulesService(repo);
const employeesService = new EmployeesService(repo);
const attendanceService = new AttendanceService(repo);
// Fake Sheet sync: bắt dòng phiếu để kiểm số lượng
const slipRows = [];
const fakeSync = {
  initSpreadsheetStructure: async () => ({ success: true, createdSheets: ['PHIEU_NV_CAP_NHAT_CA'], existingSheets: [] }),
  appendRow: async (_tab, row) => { slipRows.push(row); return true; },
};
const svc = new ShiftReRegService(
  schedulesService,
  employeesService,
  attendanceService,
  fakeSync,
  repo,
);

const { from, to, today } = svc.window();
console.log('ĐỢT mặc định (env):', from, '→', to, '| hôm nay:', today);
if (from !== '2026-10-01' || to !== '2026-10-24') fail(`cửa sổ mặc định sai: ${from} → ${to}`);

// 0) LUỒNG ADMIN: mặc định ĐÓNG → mở phiếu + đặt thời gian riêng
const st0 = await svc.getStatus('EMP_SMOKE_REREG');
console.log('STATUS0:', JSON.stringify({ enabled: st0.enabled, from: st0.from, to: st0.to, endsAt: st0.endsAt }));
if (st0.enabled !== false) fail('phiếu mặc định phải ĐÓNG (chưa có Admin bật)');
if (st0.endsAt !== `${st0.to}T23:59:59+07:00`) fail(`mốc đếm ngược endsAt sai: ${st0.endsAt}`);
let disBlocked = false;
try { await svc.submitForm('EMP_SMOKE_REREG', [{ date: '2026-10-10', codes: ['CA_1'] }], 'X'); }
catch (e) { disBlocked = String(e?.message || '').startsWith('FEATURE_DISABLED'); }
if (!disBlocked) fail('gửi phiếu khi đang ĐÓNG chưa bị chặn FEATURE_DISABLED');
const cfg = await svc.saveConfig('ADMIN_SMOKE', { enabled: true, from: '2026-10-05', to: '2026-10-22' });
console.log('ADMIN SAVED:', JSON.stringify(cfg));
if (!cfg.enabled || cfg.from !== '2026-10-05' || cfg.to !== '2026-10-22') fail('saveConfig không giữ đúng giá trị!');
const st1 = await svc.getStatus('EMP_SMOKE_REREG');
if (st1.enabled !== true || st1.from !== '2026-10-05' || st1.to !== '2026-10-22') fail('cổng NV không thấy phiếu MỞ với thời gian Admin đặt!');
const persisted = (await repo.getSystemSettings())?.shift_re_registration;
if (persisted?.enabled !== true || persisted?.updated_by !== 'ADMIN_SMOKE') fail('cấu hình chưa bền (systemSettings)!');
// Lỗi cấu hình: from > to / ngày sai
let badRange = false;
try { await svc.saveConfig('ADMIN_SMOKE', { enabled: true, from: '2026-10-20', to: '2026-10-01' }); }
catch (e) { badRange = String(e?.message || '').startsWith('BAD_RANGE'); }
if (!badRange) fail('from > to chưa bị chặn BAD_RANGE');

const pastDate = '2026-10-10';
const past2 = '2026-10-18';
const futureDate = st1.to; // 2026-10-22: tương lai nếu đang chạy trước 22/10
if (futureDate <= today) fail('máy chạy sau 22/10 — không đủ cả ca tương lai để test');

// 1) CA ĐÃ QUA → TẠO + BOT CHẤM HOÀN THÀNH
const r1 = await svc.submitForm('EMP_SMOKE_REREG', [
  { date: pastDate, codes: ['CA_1'] },
  { date: futureDate, codes: ['CA_2'] },
], 'EMP_SMOKE_REREG');
console.log('R1:', JSON.stringify({ created: r1.created, kept: r1.kept, completed: r1.completed, pending: r1.pending, sheets: r1.sheetsSynced }));
if (r1.created !== 2) fail(`kỳ vọng tạo 2 ca, got ${r1.created}`);
if (r1.completed !== 1) fail(`kỳ vọng bot chấm 1 ca đã qua, got ${r1.completed}`);
if (r1.pending !== 1) fail(`kỳ vọng 1 ca chờ, got ${r1.pending}`);
if (!r1.sheetsSynced) fail('phiếu chưa đồng bộ Sheet (fake sync)');
if (slipRows.length !== 2) fail(`kỳ vọng 2 dòng phiếu, got ${slipRows.length}`);
const evsPast = await repo.getAttendanceEvents('EMP_SMOKE_REREG', pastDate);
const evIn = evsPast.find((e) => e.type === 'CHECK_IN');
const evOut = evsPast.find((e) => e.type === 'CHECK_OUT');
if (!evIn || !evOut) fail(`ca đã qua thiếu công: ${evsPast.map((e) => e.type).join('+')}`);
const shiftPast = (await repo.getShiftsForEmployee('EMP_SMOKE_REREG', pastDate, pastDate))[0];
if (!evIn.assignment_id || String(evIn.assignment_id) !== String(shiftPast.assignment_id)) fail('CHECK_IN không gắn đúng ca');
if (String(evIn.client_time).slice(11, 13) !== '07') fail(`giờ vào ca chuẩn +07:00 phải là 07:00, got ${evIn.client_time}`);
const evsFuture = await repo.getAttendanceEvents('EMP_SMOKE_REREG', futureDate);
if (evsFuture.length !== 0) fail(`ca tương lai không được có ${evsFuture.length} event tự sinh`);
const payLine = r1.entries.flatMap((e) => e.lines).find((l) => l.attendance === 'COMPLETED');
if (!payLine || payLine.payEstimate !== 150000) fail(`tiền ca 5h×30k kỳ vọng 150000, got ${payLine?.payEstimate}`);

// 2) GỬI LẠI CA ĐÃ HOÀN THÀNH → KEPT, không đẻ/ghi đôi
const r2 = await svc.submitForm('EMP_SMOKE_REREG', [{ date: pastDate, codes: ['CA_1'] }], 'EMP_SMOKE_REREG');
console.log('R2:', JSON.stringify({ created: r2.created, kept: r2.kept, completed: r2.completed }));
if (r2.created !== 0 || r2.kept !== 1) fail(`lặp phiếu kỳ vọng kept=1 created=0, got kept=${r2.kept} created=${r2.created}`);
if (r2.completed !== 1) fail(`kỳ vọng vẫn hoàn thành (đã đủ công → coi như xong), got ${r2.completed}`);

// 3) 2 CA CÙNG NGÀY (tương lai, ngày đã có CA_2 từ bước 1) → đè CA_2→CA_1 + tạo CA_3
const r3 = await svc.submitForm('EMP_SMOKE_REREG', [{ date: futureDate, codes: ['CA_1', 'CA_3'] }], 'EMP_SMOKE_REREG');
console.log('R3:', JSON.stringify({ created: r3.created, updated: r3.updated, kept: r3.kept, pending: r3.pending }));
if (r3.created !== 1 || r3.updated !== 1) fail(`kỳ vọng 1 đè + 1 tạo mới, got created=${r3.created} updated=${r3.updated}`);
const dayShifts = (await repo.getShiftsForEmployee('EMP_SMOKE_REREG', futureDate, futureDate))
  .filter((s) => s.status !== 'CANCELLED').map((s) => s.shift_code).sort();
if (dayShifts.join(',') !== 'CA_1,CA_3') fail(`Ngày ${futureDate} kỳ vọng CA_1+CA_3 (CA_2 bị đè đúng theo phiếu), got: ${dayShifts.join(',')}`);

// 4) NGÀY NGOÀI ĐỢT → bị chặn
let blocked = false;
try {
  await svc.submitForm('EMP_SMOKE_REREG', [{ date: '2026-11-01', codes: ['CA_1'] }], 'X');
} catch (e) {
  blocked = String(e?.message || '').startsWith('WINDOW_OUT_OF_RANGE');
}
if (!blocked) fail('ngày ngoài đợt chưa bị chặn');

// 5) ĐÈ CA Ở NGÀY ĐÃ CÓ ĐIỂM DANH → bị chặn, giữ bằng chứng công
//    Drill: tự tạo điểm danh thật ngày 2026-10-12 trước (như app NV chấm).
await repo.recordAttendanceEvent({
  event_id: 'EVT_MANUAL_1', request_id: 'REQ_MAN_1', assignment_id: '', employee_id: 'EMP_SMOKE_REREG',
  branch_id: 'CN130', type: 'CHECK_IN', client_time: '2026-10-12T07:05:00+07:00',
  server_received_at: new Date().toISOString(), distance_meters: 0, gps_status: 'OK',
  is_early: false, is_late: false, minutes_deviation: 0, fine_tier: 'NONE', fine_amount: 0,
});
console.log('Seed event chấm tay ngày 2026-10-12 OK');
// Bấm chạy przez service tạo ca 2026-10-12 CA_3 (đã qua, NHƯNG ngày có điểm danh mồ côi → đè không thỏa)
const r5 = await svc.submitForm('EMP_SMOKE_REREG', [{ date: '2026-10-12', codes: ['CA_3'] }], 'X');
console.log('R5:', JSON.stringify({ created: r5.created, kept: r5.kept, errors: r5.errors.length }));
// Ngày có điểm danh (mồ côi không gắn ca) => vẫn TẠO ca được (chưa có ca nào để đè),
// nhưng khi đè ca khác mã ở ngày có ca + điểm danh thì mới chặn:
const r6 = await svc.submitForm('EMP_SMOKE_REREG', [{ date: '2026-10-12', codes: ['CA_1'] }], 'X');
console.log('R6:', JSON.stringify({ created: r6.created, updated: r6.updated, kept: r6.kept, errors: r6.errors.length }));
const err6 = r6.errors[0];
if (!err6) fail('ngày có điểm danh + ca khác mã phải bị chặn giữ bằng chứng');
console.log('   chặn giữ:', err6.message?.slice(0, 60), '...');

// 7) Nhiều ngày 1 phiếu + notify + slip đủ dòng
slipRows.length = 0;
const r7 = await svc.submitForm('EMP_SMOKE_REREG', [
  { date: '2026-10-13', codes: ['CA_2'] },
  { date: '2026-10-16', codes: ['CA_3'] },
], 'X');
console.log('R7:', JSON.stringify({ created: r7.created, completed: r7.completed, slipRows: slipRows.length, notified: r7.notified }));
if (r7.created !== 2 || r7.completed !== 2) fail(`kỳ vọng 2 ca mới + bot chấm 2, got created=${r7.created} completed=${r7.completed}`);
if (slipRows.length !== 2) fail(`kỳ vọng 2 dòng phiếu, got ${slipRows.length}`);

console.log('\n*** SMOKE REREG PASS: cửa sổ đợt + tạo/chấm tự hoàn thành/lặp/2 ca/ngày/chặn ngoài đợt/bảo vệ công đã chấm + phiếu sync Sheet OK ***');
