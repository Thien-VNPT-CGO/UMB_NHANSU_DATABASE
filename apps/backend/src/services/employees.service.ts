import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import {
  CandidateApplication,
  EmployeeMaster,
  EmploymentStatus,
  STANDARD_HOURLY_RATES,
} from '@ubm/shared';
import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { singleWriterQueue } from '../repositories/single-writer-queue.js';
import { getJwtSecret, normalizePhone } from './auth.service.js';
import { generateAutoPin, hashPin } from './password.service.js';
import {
  buildConflictMessage,
  findSlotConflict,
  suggestFreeSlots,
  validateInterviewSlot,
} from './interview-slots.service.js';

/** Chuẩn hóa SĐT về dạng so sánh được (10 số, đầu 0) — DÙNG DUY NHẤT ở mọi nơi.
 *  Bao phủ: '+84...'/84... (Sheet ghi quốc tế), số bị rớt số 0 đầu (ô numeric),
 *  khoảng trắng/gạch/ngoặc/chấm, dấu nháy text "'" của Sheets. */
export function canonicalPhone(phone: string): string {
  let digits = normalizePhone(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  // 0084... -> 0...
  if (digits.startsWith('0084') && digits.length > 4) digits = '0' + digits.slice(4);
  // 84 + 9 số (11 chữ số) -> 0 + 9 số
  if (digits.length === 11 && digits.startsWith('84')) return '0' + digits.slice(2);
  // Rớt số 0 đầu do ô numeric (9 số di động VN: 3/5/7/8/9...) -> thêm 0
  if (digits.length === 9 && /^[35789]/.test(digits)) return '0' + digits;
  return digits;
}

/** Chuẩn hóa mọi biến thể ngày về YYYY-MM-DD — DÙNG DUY NHẤT ở mọi nơi.
 *  Bao phủ: 'YYYY-MM-DD', ISO datetime ('....T..'), số serial Sheets, và chuỗi
 *  ngày theo locale do Sheets trả về ('M/D/YYYY' US hoặc 'D/M/YYYY' VN — Sheets
 *  tự biến '2026-10-05' ghi bằng USER_ENTERED thành serial rồi đọc lại theo
 *  locale, từng gây mất ngày bắt đầu NV thử việc sau reload). Không parse được -> ''. */
export function normSheetDate(input: unknown): string {
  let s = String(input ?? '').trim().replace(/^'/, '');
  if (!s) return '';
  // Serial Sheets (số ngày từ 1899-12-30): '45929' hoặc 45929
  if (/^\d{4,6}$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) {
      const ms = Math.round((n - 25569) * 86_400_000);
      return new Date(ms).toISOString().slice(0, 10);
    }
    return '';
  }
  // ISO: 'YYYY-MM-DD' hoặc 'YYYY-MM-DDTHH...' (kể cả có giờ +07:00)
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const y = Number(iso[1]); const m = Number(iso[2]); const d = Number(iso[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return '';
  }
  // Slash: 'a/b/yyyy' — a>12 chắc chắn D/M/Y; b>12 chắc chắn M/D/Y;
  // còn lại mơ hồ -> ưu tiên D/M/Y (locale vi của Sheet sản xuất).
  const sl = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (sl) {
    let y = Number(sl[3]); if (y < 100) y += 2000;
    const a = Number(sl[1]); const b = Number(sl[2]);
    let m: number; let d: number;
    if (a > 12 && b <= 12) { d = a; m = b; }
    else if (b > 12 && a <= 12) { m = a; d = b; }
    else { d = a; m = b; }
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return '';
  }
  // Thử Date parser cuối cùng (VD 'Oct 5, 2026'), quy về ngày UTC để ổn định.
  const t = new Date(s).getTime();
  if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);
  return '';
}

/** Ép Sheets lưu ngày dạng TEXT ('YYYY-MM-DD) để USER_ENTERED không biến thành
 *  serial rồi đọc lại theo locale. Đọc về vẫn ra đúng 'YYYY-MM-DD' (dấu nháy là
 *  marker nhập liệu, không nằm trong giá trị). */
export function sheetDateText(input: unknown): string {
  const iso = normSheetDate(input);
  return iso ? `'${iso}` : '';
}

/** Chuẩn hóa mọi biến thể GIỜ GIẤC về ISO instant (UTC, '...Z') — DÙNG cho mọi
 *  cột datetime đọc từ Sheet (client_time, start_at...). Bao phủ: ISO có/không
 *  múi giờ (kể cả prefix TEXT nháy đơn '...), serial Sheets (nguyên + thập phân),
 *  chuỗi locale 'M/D/YYYY [H:mm:ss]' hoặc 'D/M/YYYY [...]' (ưu tiên D/M/Y theo
 *  locale vi, giờ wall hiểu là giờ VN +07:00). Không parse được -> ''. */
export function normSheetDateTime(input: unknown): string {
  let s = String(input ?? '').trim().replace(/^'/, '');
  if (!s) return '';
  // ISO: có T + giờ là instant tuyệt đối (kể cả thiếu Z — hiểu là UTC như cũ).
  if (/^\d{4}-\d{1,2}-\d{1,2}T/.test(s)) {
    const t = new Date(s).getTime();
    return Number.isFinite(t) ? new Date(t).toISOString() : '';
  }
  // Serial Sheets (số ngày từ 1899-12-30, phần thập phân = giờ trong ngày UTC).
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) {
      return new Date(Math.round((n - 25569) * 86_400_000)).toISOString();
    }
    return '';
  }
  // Locale 'a/b/yyyy[ hh:mm[:ss]]' — a>12 chắc chắn D/M/Y; b>12 chắc chắn M/D/Y;
  // còn lại mơ hồ -> ưu tiên D/M/Y (locale vi). Giờ wall = giờ VN.
  const sl = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (sl) {
    let y = Number(sl[3]); if (y < 100) y += 2000;
    const a = Number(sl[1]); const b = Number(sl[2]);
    let m: number; let d: number;
    if (a > 12 && b <= 12) { d = a; m = b; }
    else if (b > 12 && a <= 12) { m = a; d = b; }
    else { d = a; m = b; }
    const hh = Number(sl[4] ?? 0); const mm = Number(sl[5] ?? 0); const ss = Number(sl[6] ?? 0);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && hh <= 23 && mm <= 59 && ss <= 59) {
      return new Date(Date.UTC(y, m - 1, d, hh - 7, mm, ss)).toISOString();
    }
    return '';
  }
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}

/** Ép Sheets lưu datetime dạng TEXT ('iso) để USER_ENTERED không parse thành
 *  datetime locale rồi đọc lại sai giờ sau restart (từng gây mất check-in/out
 *  sau reload). Đọc về qua normSheetDateTime (tự strip nháy đơn). */
export function sheetDateTimeText(input: unknown): string {
  const iso = normSheetDateTime(input);
  return iso ? `'${iso}` : '';
}

export interface DuplicatePhoneGroup {
  phone: string;
  employees: { employee_id: string; employee_code: string; full_name: string }[];
  accounts: { account_id: string; employee_id: string; account_status: string }[];
}

/** Tách giá trị đa lựa chọn (ca / chi nhánh): "A / B, C" -> ["A","B","C"]. */
export function splitMultiValue(input: unknown): string[] {
  return String(input || '')
    .split(/[,/+;|]/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** Chuẩn hóa khối/vị trí về 4 mã chuẩn (dữ liệu Sheets cũ ghi tiếng Việt tự do,
 *  VD: 'Nhân viên bán hàng', 'Nhân viên cửa hàng'). Nhận diện theo từ khóa. */
export function normalizeGroup(input: unknown): 'STORE' | 'XUONG' | 'VAN_PHONG' | 'SALE' {
  const g = String(input || '').trim().toUpperCase();
  if (!g) throw new Error(`INVALID_GROUP: khối '' không hợp lệ (STORE/XUONG/VAN_PHONG/SALE).`);
  if (g === 'STORE' || g.includes('CỬA HÀNG') || g.includes('CUA HANG') || g.includes('SHOP') || g.includes('STORE')) return 'STORE';
  if (g === 'XUONG' || g.includes('XƯỞNG') || g.includes('XUONG') || g.includes('SẢN XUẤT') || g.includes('SAN XUAT') || g.includes('CÔNG NHÂN') || g.includes('CONG NHAN')) return 'XUONG';
  if (g === 'VAN_PHONG' || g.includes('VĂN PHÒNG') || g.includes('VAN PHONG') || g.includes('OFFICE') || g.includes('TRỤ SỞ') || g.includes('TRU SO')) return 'VAN_PHONG';
  if (g === 'SALE' || g.includes('BÁN HÀNG') || g.includes('BAN HANG') || g.includes('KINH DOANH') || g.includes('SALE')) return 'SALE';
  throw new Error(`INVALID_GROUP: khối '${input}' không hợp lệ (STORE/XUONG/VAN_PHONG/SALE).`);
}

/** Quét toàn bộ SĐT trùng trên Sheets (nhân viên + tài khoản). */
export async function findDuplicatePhones(repo: ISheetsRepository): Promise<DuplicatePhoneGroup[]> {
  const [emps, accs] = await Promise.all([repo.listEmployees(), repo.listAccounts()]);
  const byPhone = new Map<string, DuplicatePhoneGroup>();
  const key = (phone: string) => {
    const c = canonicalPhone(phone);
    if (!c) return null;
    let g = byPhone.get(c);
    if (!g) {
      g = { phone: c, employees: [], accounts: [] };
      byPhone.set(c, g);
    }
    return g;
  };
  for (const e of emps) {
    const g = key(e.phone_normalized);
    if (g) g.employees.push({ employee_id: e.employee_id, employee_code: e.employee_code, full_name: e.full_name });
  }
  for (const a of accs) {
    const g = key(a.phone_normalized);
    if (g) g.accounts.push({ account_id: a.account_id, employee_id: a.employee_id, account_status: a.account_status });
  }
  return [...byPhone.values()].filter(g => g.employees.length + g.accounts.length > 2 || (g.employees.length > 1 || g.accounts.length > 1));
}

export class EmployeesService {
  constructor(private repo: ISheetsRepository) {}

  async listEmployees(branchScope?: string, status?: string) {
    return this.repo.listEmployees({ branch: branchScope, status });
  }

  async getEmployee(id: string) {
    return this.repo.getEmployeeById(id);
  }

  async createEmployee(data: {
    fullName: string;
    phone: string;
    branchId: string;
    employmentStatus: EmploymentStatus;
    gender?: 'NAM' | 'NU' | 'KHAC';
    birthDate?: string;
    group?: 'STORE' | 'XUONG' | 'VAN_PHONG' | 'SALE';
    employeeCode?: string;
    idCardNumber?: string;
    email?: string;
    startDate?: string;
    officialDate?: string;
    ratePerHour?: number;
    defaultShiftCode?: 'CA_1' | 'CA_2' | 'CA_3';
    actorId: string;
  }) {
    const employeeId = `EMP_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    let employeeCode = data.employeeCode?.trim();
    if (!employeeCode || !/^UBM_NV\d+$/i.test(employeeCode)) {
      const randomDigits = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
      employeeCode = `UBM_NV${randomDigits}`;
    } else {
      employeeCode = employeeCode.toUpperCase();
    }
    const rate = data.ratePerHour || (data.employmentStatus === 'PROBATION'
      ? STANDARD_HOURLY_RATES.PROBATION
      : STANDARD_HOURLY_RATES.OFFICIAL);

    return singleWriterQueue.enqueue({
      entityType: 'NHAN_VIEN_MASTER',
      entityId: employeeId,
      actorId: data.actorId,
      execute: async () => {
        // Ràng buộc SĐT duy nhất toàn hệ thống (so sánh sau chuẩn hóa).
        // Chuẩn hóa về digits-only ngay từ đầu để login exact-match luôn trúng
        // (tránh SĐT có khoảng trắng/gạch ngang tạo ở POST /employees).
        const normPhone = canonicalPhone(data.phone);
        if (!normPhone) throw new Error('INVALID_PHONE');
        const existingEmps = await this.repo.listEmployees();
        const clashEmp = existingEmps.find(e => canonicalPhone(e.phone_normalized) === normPhone);
        if (clashEmp) {
          throw new Error(`DUPLICATE_PHONE: SĐT ${data.phone} đã thuộc về ${clashEmp.full_name} (${clashEmp.employee_code})! Mỗi SĐT chỉ dùng cho 1 nhân viên.`);
        }
        const clashAccs = (await this.repo.listAccounts()).filter(
          a => canonicalPhone(a.phone_normalized) === normPhone
        );
        if (clashAccs.length > 0) {
          throw new Error(`DUPLICATE_PHONE: SĐT ${data.phone} đã có tài khoản ${clashAccs[0].account_id}! Mỗi SĐT chỉ dùng cho 1 nhân viên.`);
        }

        const emp = await this.repo.createEmployee({
          employee_id: employeeId,
          employee_code: employeeCode,
          full_name: data.fullName,
          phone_normalized: normPhone,
          employment_status: data.employmentStatus,
          group: data.group || 'STORE',
          default_branch_id: data.branchId,
          current_rate_per_hour: rate,
          // Chuẩn hóa YYYY-MM-DD ngay khi ghi để mọi nguồn (form/import/Sheet tay)
          // đều lưu 1 định dạng, không vỡ tiến độ 12 ngày sau reload.
          start_date: normSheetDate(data.startDate) || new Date().toISOString().split('T')[0],
          official_date: normSheetDate(data.officialDate) || (data.employmentStatus === 'OFFICIAL' ? (normSheetDate(data.startDate) || new Date().toISOString().split('T')[0]) : undefined),
          gender: data.gender,
          birth_date: data.birthDate,
          id_card_number: data.idCardNumber,
          email: data.email,
          ...(data.defaultShiftCode ? { default_shift_code: data.defaultShiftCode } : {}),
        });

        // Add stage history
        await this.repo.addStageHistory({
          period_id: uuidv4(),
          employee_id: employeeId,
          stage: data.employmentStatus,
          effective_from: emp.start_date,
          rate_per_hour: rate,
          approved_by: data.actorId,
          note: 'Khởi tạo hồ sơ ban đầu',
        });

        // Tự động tạo tài khoản nhân viên tương ứng và đồng bộ xuống Sheet TAI_KHOAN_NHAN_VIEN.
        // Không còn luồng kích hoạt/cấp PIN tay: tài khoản luôn ACTIVE, hệ thống tự sinh
        // mã PIN khởi tạo — nhân viên đăng nhập lần đầu rồi đặt PIN riêng ngay.
        const newAcc = await this.repo.createAccount({
          account_id: `ACC_${Date.now()}`,
          employee_id: employeeId,
          phone_normalized: normPhone,
          account_status: 'ACTIVE',
          role: 'EMPLOYEE',
          branch_scope: data.branchId || 'CN130',
        });
        const autoPin = generateAutoPin();
        await this.repo.setAccountPin(
          newAcc.account_id,
          await hashPin(autoPin),
          true,
          data.actorId,
          autoPin
        );

        return emp;
      },
    });
  }

  async transitionToOfficial(employeeId: string, actorId: string, expectedVersion: number) {
    return singleWriterQueue.enqueue({
      entityType: 'NHAN_VIEN_MASTER',
      entityId: employeeId,
      expectedVersion,
      actorId,
      execute: async () => {
        const cur = await this.repo.getEmployeeById(employeeId).catch(() => null);
        if (!cur) throw new Error('EMPLOYEE_NOT_FOUND');
        const curStatus = String((cur as any).employment_status || '');
        if (curStatus === 'OFFICIAL') {
          throw new Error(`Ứng viên ${(cur as any).full_name || ''} đã là nhân viên chính thức rồi!`);
        }
        if (curStatus === 'TERMINATED') {
          throw new Error(`Ứng viên ${(cur as any).full_name || ''} đã nghỉ việc — không thể chuyển chính thức!`);
        }
        if (curStatus !== 'PROBATION') {
          throw new Error(`Chỉ chuyển chính thức được nhân viên đang thử việc (hiện: ${curStatus})!`);
        }
        // Kích hoạt chính thức: lập tức gỡ toàn bộ lịch làm việc thử việc từ hôm
        // nay trở đi (lịch sử điểm danh/lương đã qua được giữ nguyên).
        const todayVn = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
        let deletedShifts = 0;
        try {
          deletedShifts = (await this.repo.deleteShiftsForEmployee(employeeId, todayVn).catch(() => 0)) || 0;
        } catch { deletedShifts = 0; }
        const updated = await this.repo.updateEmployee(
          employeeId,
          {
            employment_status: 'OFFICIAL',
            current_rate_per_hour: STANDARD_HOURLY_RATES.OFFICIAL,
            official_date: new Date().toISOString().split('T')[0],
          },
          expectedVersion
        );

        await this.repo.addStageHistory({
          period_id: uuidv4(),
          employee_id: employeeId,
          stage: 'OFFICIAL',
          effective_from: updated.official_date!,
          rate_per_hour: STANDARD_HOURLY_RATES.OFFICIAL,
          approved_by: actorId,
          note: 'Xét duyệt chuyển nhân viên chính thức',
        });

        await this.repo.recordAuditLog({
          log_id: `LOG_${Date.now()}`,
          actor_id: actorId,
          actor_role: 'HR',
          action: 'PROBATION_SCHEDULE_CLEARED',
          target_entity: 'NHAN_VIEN_MASTER',
          target_id: employeeId,
          details: `Kích hoạt chính thức ${(cur as any).full_name || employeeId}: đã gỡ ${deletedShifts} ca thử việc từ ${todayVn} (giữ lịch sử đã qua); NV đăng ký 2 ngày OFF theo quy chế chính thức`,
        } as any).catch(() => null);

        return { ...(updated as any), deletedShifts };
      },
    });
  }

  /** Gán / đổi ca cố định cho nhân viên (BOT dựa vào đây để tự xếp lịch). */
  async setDefaultShift(employeeId: string, shiftCode: 'CA_1' | 'CA_2' | 'CA_3' | null, actorId: string) {
    const emp = await this.repo.getEmployeeById(employeeId);
    if (!emp) throw new Error('EMPLOYEE_NOT_FOUND');
    return singleWriterQueue.enqueue({
      entityType: 'NHAN_VIEN_MASTER',
      entityId: employeeId,
      actorId,
      execute: async () => {
        const fresh = await this.repo.getEmployeeById(employeeId);
        if (!fresh) throw new Error('EMPLOYEE_NOT_FOUND');
        return this.repo.updateEmployee(
          employeeId,
          shiftCode ? { default_shift_code: shiftCode } : { default_shift_code: undefined } as any,
          fresh.version
        );
      },
    });
  }

  /** HR/Admin cập nhật hồ sơ nhân viên (tên, SĐT, chi nhánh, khối, lương, ca...). */
  async updateEmployee(
    employeeId: string,
    updates: {
      fullName?: string;
      phone?: string;
      branchId?: string;
      group?: 'STORE' | 'XUONG' | 'VAN_PHONG' | 'SALE';
      ratePerHour?: number;
      defaultShiftCode?: 'CA_1' | 'CA_2' | 'CA_3' | null;
      startDate?: string;
      officialDate?: string;
      email?: string;
      gender?: 'NAM' | 'NU' | 'KHAC';
      birthDate?: string;
      idCardNumber?: string;
      /** Ảnh avatar base64 (transient) — adapter upload Drive thành avatar_drive_id rồi bỏ. Chuỗi rỗng = xóa avatar. */
      avatarBase64?: string;
      expectedVersion?: number;
    },
    actorId: string
  ) {
    const emp = await this.repo.getEmployeeById(employeeId);
    if (!emp) throw new Error('EMPLOYEE_NOT_FOUND');
    const patch: any = {};
    if (updates.fullName !== undefined) {
      const name = String(updates.fullName).trim();
      if (!name) throw new Error('INVALID_FULL_NAME: Họ tên không được để trống.');
      patch.full_name = name;
    }
    let normPhone: string | undefined;
    if (updates.phone !== undefined) {
      normPhone = canonicalPhone(updates.phone);
      if (!normPhone) throw new Error('INVALID_PHONE');
      if (normPhone !== canonicalPhone(emp.phone_normalized)) {
        const existingEmps = await this.repo.listEmployees();
        const clash = existingEmps.find(
          e => e.employee_id !== employeeId && canonicalPhone(e.phone_normalized) === normPhone
        );
        if (clash) throw new Error(`DUPLICATE_PHONE: SĐT đã thuộc về ${clash.full_name} (${clash.employee_code})!`);
        patch.phone_normalized = normPhone;
      }
    }
    if (updates.branchId !== undefined) patch.default_branch_id = String(updates.branchId).trim() || emp.default_branch_id;
    if (updates.group !== undefined && updates.group !== null && String(updates.group).trim() !== '') {
      patch.group = normalizeGroup(updates.group);
    }
    if (updates.ratePerHour !== undefined) {
      const rate = Number(updates.ratePerHour);
      if (!Number.isFinite(rate) || rate < 0 || rate > 10_000_000) throw new Error('INVALID_RATE');
      patch.current_rate_per_hour = Math.floor(rate);
    }
    if (updates.defaultShiftCode !== undefined) {
      patch.default_shift_code = updates.defaultShiftCode || undefined;
    }
    // Chuẩn hóa YYYY-MM-DD trước khi lưu: input có thể là 'D/M/YYYY' do HR gõ tay
    // hoặc locale-string từ Sheet — không chuẩn hóa sẽ vỡ tiến độ 12 ngày sau reload.
    if (updates.startDate !== undefined && updates.startDate) {
      patch.start_date = normSheetDate(updates.startDate) || String(updates.startDate).trim();
    }
    if (updates.officialDate !== undefined && updates.officialDate) {
      patch.official_date = normSheetDate(updates.officialDate) || String(updates.officialDate).trim();
    }
    if (updates.email !== undefined) patch.email = String(updates.email).trim() || undefined;
    if (updates.gender !== undefined) patch.gender = updates.gender;
    if (updates.birthDate !== undefined && updates.birthDate) patch.birth_date = String(updates.birthDate);
    if (updates.idCardNumber !== undefined) patch.id_card_number = String(updates.idCardNumber).trim() || undefined;
    // Avatar: chuỗi rỗng = HR xóa avatar; có ảnh = adapter upload Drive rồi bỏ base64.
    if (updates.avatarBase64 !== undefined) {
      if (String(updates.avatarBase64).trim() === '') {
        (patch as any).clear_avatar = true;
      } else {
        (patch as any).photo_base64 = String(updates.avatarBase64);
      }
    }

    return singleWriterQueue.enqueue({
      entityType: 'NHAN_VIEN_MASTER',
      entityId: employeeId,
      actorId,
      execute: async () => {
        const fresh = await this.repo.getEmployeeById(employeeId);
        if (!fresh) throw new Error('EMPLOYEE_NOT_FOUND');
        const expected = Number(updates.expectedVersion) || fresh.version;
        if (expected !== fresh.version) throw new Error('VERSION_CONFLICT: Dữ liệu vừa bị thay đổi, tải lại rồi sửa tiếp.');
        const updated = await this.repo.updateEmployee(employeeId, patch, fresh.version);
        // Đổi SĐT / chi nhánh -> đồng bộ tài khoản đăng nhập theo để NV vẫn login
        // được số mới và không dính BRANCH_SCOPE_VIOLATION oan khi đổi ca cùng chi nhánh.
        if (patch.phone_normalized || patch.default_branch_id) {
          const accs = await this.repo.listAccounts().catch(() => []);
          for (const acc of accs) {
            if (acc.employee_id !== employeeId) continue;
            let touched = false;
            if (patch.phone_normalized && acc.phone_normalized !== patch.phone_normalized) {
              (acc as any).phone_normalized = patch.phone_normalized;
              touched = true;
            }
            if (patch.default_branch_id && (acc as any).branch_scope !== patch.default_branch_id) {
              (acc as any).branch_scope = patch.default_branch_id;
              touched = true;
            }
            if (touched) (acc as any).updated_at = new Date().toISOString();
          }
        }
        return updated;
      },
    });
  }

  /**
   * HR khóa tài khoản NV (cột Thao tác tab Chính thức): LOCKED + XÓA PIN
   * (hash + bản rõ) + văng phiên đang dùng ngay. Hồ sơ, điểm danh, công, lương
   * GIỮ NGUYÊN tuyệt đối — chỉ chặn đăng nhập + ẩn khỏi Lịch làm việc.
   */
  async lockEmployeeAccount(employeeId: string, actorId: string) {
    const emp = await this.repo.getEmployeeById(employeeId);
    if (!emp) throw new Error('EMPLOYEE_NOT_FOUND');
    const normPhone = emp.phone_normalized ? canonicalPhone(emp.phone_normalized) : '';
    const allAccs = await this.repo.listAccounts().catch(() => []);
    let accs = allAccs.filter(a =>
      a.employee_id === employeeId ||
      (normPhone && a.phone_normalized && canonicalPhone(a.phone_normalized) === normPhone)
    );
    if (accs.length === 0) {
      // Tự động tạo tài khoản trạng thái LOCKED để đảm bảo hồ sơ luôn có tài khoản bị khóa
      const newAcc = await this.repo.createAccount({
        account_id: `ACC_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        employee_id: employeeId,
        phone_normalized: emp.phone_normalized || '',
        account_status: 'LOCKED',
        role: 'EMPLOYEE',
        branch_scope: emp.default_branch_id || 'CN130',
      });
      accs = [newAcc];
    }
    const locked: string[] = [];
    for (const a of accs) {
      await this.repo.setAccountStatus(a.account_id, 'LOCKED', actorId);
      // Xóa PIN triệt để: hash rỗng + xóa bản rõ, cờ đổi PIN về false.
      await this.repo.setAccountPin(a.account_id, '', false, actorId, null);
      (a as any).account_status = 'LOCKED';
      (a as any).pin_hash = '';
      (a as any).pin_code = '';
      delete (a as any).pin_code;
      delete (a as any).pin_hash;
      (a as any).pin_must_change = false;
      locked.push(a.account_id);
    }

    // Cập nhật trạng thái khóa trực tiếp lên hồ sơ EmployeeMaster
    (emp as any).account_locked = true;
    (emp as any).account_status = 'LOCKED';
    if ((this.repo as any).updateEmployee) {
      await (this.repo as any).updateEmployee(employeeId, {
        account_locked: true,
        account_status: 'LOCKED',
      } as any, emp.version).catch(() => null);
    }

    // Đẩy cập nhật tab TAI_KHOAN_NHAN_VIEN lên Google Sheets ngay lập tức (xóa trắng PIN trên Sheet)
    if ((this.repo as any).syncService?.pushAccountsTab) {
      try {
        await (this.repo as any).syncService.pushAccountsTab((this.repo as any).fallbackAdapter || this.repo);
      } catch (e) {
        console.warn('[employeesService] pushAccountsTab sau khi khóa thất bại:', e);
      }
    }

    // XÓA LỊCH LÀM VIỆC TỪ HÔM NAY TRỞ ĐI RA KHỎI LỊCH LÀM VIỆC LẬP TỨC:
    // Ca quá khứ giữ nguyên để đối soát điểm danh/công/lương.
    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    let shiftsCancelled = 0;
    try {
      if ((this.repo as any).deleteShiftsForEmployee) {
        shiftsCancelled = await (this.repo as any).deleteShiftsForEmployee(employeeId, today);
      } else {
        const all = await this.repo.getShiftsForWeek('*', '2000-01-01').catch(() => []);
        for (const s of all || []) {
          if (String((s as any).employee_id) !== String(employeeId)) continue;
          if (String((s as any).date || '').slice(0, 10) < today) continue;
          if ((s as any).status === 'CANCELLED') continue;
          try {
            await this.repo.updateShiftAssignment((s as any).assignment_id, { status: 'CANCELLED' } as any);
            shiftsCancelled++;
          } catch { /* tiếp ca khác */ }
        }
      }
    } catch { /* best-effort */ }

    await this.repo.recordAuditLog({
      log_id: `LOG_${Date.now()}`,
      actor_id: actorId,
      actor_role: 'HR',
      action: 'EMPLOYEE_LOCKED',
      target_entity: 'TAI_KHOAN_NHAN_VIEN',
      target_id: employeeId,
      details: `HR khóa tài khoản + xóa PIN của ${(emp as any).full_name || employeeId} (giữ hồ sơ/công/lương) + xóa ${shiftsCancelled} ca từ hôm nay ra khỏi lịch`,
    } as any).catch(() => null);
    return { employeeId, locked, shiftsCancelled };
  }

  /**
   * HR mở khóa lại: ACTIVE + cấp PIN 6 số mới (bắt đổi) — trả PIN để trao tay NV.
   */
  async unlockEmployeeAccount(employeeId: string, actorId: string) {
    const emp = await this.repo.getEmployeeById(employeeId);
    if (!emp) throw new Error('EMPLOYEE_NOT_FOUND');
    const normPhone = emp.phone_normalized ? canonicalPhone(emp.phone_normalized) : '';
    const allAccs = await this.repo.listAccounts().catch(() => []);
    let accs = allAccs.filter(a =>
      a.employee_id === employeeId ||
      (normPhone && a.phone_normalized && canonicalPhone(a.phone_normalized) === normPhone)
    );
    if (accs.length === 0) throw new Error('ACCOUNT_NOT_FOUND: NV chưa có tài khoản đăng nhập!');
    const locked = accs.filter(a => (a as any).account_status === 'LOCKED');
    if (locked.length === 0) throw new Error('ACCOUNT_NOT_LOCKED: Tài khoản đang hoạt động bình thường!');
    const freshPin = generateAutoPin();
    const hash = await hashPin(freshPin);
    const opened: string[] = [];
    for (const a of locked) {
      await this.repo.setAccountStatus(a.account_id, 'ACTIVE', actorId);
      await this.repo.setAccountPin(a.account_id, hash, true, actorId, freshPin);
      opened.push(a.account_id);
    }
    // Gỡ cờ khóa trực tiếp trên hồ sơ EmployeeMaster
    (emp as any).account_locked = false;
    (emp as any).account_status = 'ACTIVE';
    if ((this.repo as any).updateEmployee) {
      await (this.repo as any).updateEmployee(employeeId, {
        account_locked: false,
        account_status: 'ACTIVE',
      } as any, emp.version).catch(() => null);
    }
    await this.repo.recordAuditLog({
      log_id: `LOG_${Date.now()}`,
      actor_id: actorId,
      actor_role: 'HR',
      action: 'EMPLOYEE_UNLOCKED',
      target_entity: 'TAI_KHOAN_NHAN_VIEN',
      target_id: employeeId,
      details: `HR mở khóa + cấp PIN mới cho ${(emp as any).full_name || employeeId}`,
    } as any).catch(() => null);
    return { employeeId, opened, pin: freshPin };
  }

  // Candidates & Recruitment
  async listCandidates() {
    return this.repo.listCandidates();
  }

  async importCandidate(candidateData: Omit<CandidateApplication, 'submission_id' | 'created_at'>) {
    const submissionId = `SUB_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    return this.repo.createCandidate({
      ...candidateData,
      submission_id: submissionId,
    });
  }

  async scheduleInterview(
    submissionId: string,
    interviewDate: string,
    timeSlot: string,
    interviewerId: string
  ) {
    // Ứng viên đã bị LOẠI: chặn xếp lịch, yêu cầu xem lại.
    const existing = (await this.repo.listCandidates().catch(() => []))
      .find((c: any) => c.submission_id === submissionId) as any;
    if (existing?.status === 'REJECTED') {
      throw new Error(`Ứng viên ${existing.full_name || ''} đã bị LOẠI khỏi quy trình tuyển dụng! Không thể xếp lịch phỏng vấn.`);
    }
    // Ứng viên đã phỏng vấn xong (đã chấm điểm / đã duyệt thử việc): không sắp lịch tiếp.
    const existStatus = String((existing as any)?.status || '');
    const existScore = (existing as any)?.interview_score;
    if (existStatus === 'SCORED' || existStatus === 'ACCEPTED') {
      throw new Error(
        `Ứng viên ${(existing as any)?.full_name || ''} đã phỏng vấn xong${existStatus === 'ACCEPTED' ? ' và đã duyệt thử việc' : ' (đã chấm điểm)'}! Không được sắp lịch tiếp.`
      );
    }
    if (existScore !== undefined && existScore !== null && String(existScore).trim() !== '') {
      throw new Error(
        `Ứng viên ${(existing as any)?.full_name || ''} đã có điểm phỏng vấn (${existScore}) — đã phỏng vấn xong, không được sắp lịch tiếp.`
      );
    }
    // Lịch HR đã đặt còn sắp tới: giữ nguyên — muốn đổi thì Hủy lịch trước rồi đặt lại.
    const curDate = String((existing as any)?.interview_date || '').slice(0, 10);
    const todayVn = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    if (curDate && curDate >= todayVn && ['INVITED_INTERVIEW', 'CONFIRMED'].includes(existStatus)) {
      const curSlot = String((existing as any)?.interview_time_slot || '').slice(0, 5);
      throw new Error(
        `Ứng viên ${(existing as any)?.full_name || ''} đã có lịch PV ${curSlot} ngày ${curDate} (HR đã đặt — giữ nguyên)! Muốn đổi thì bấm Hủy lịch trước rồi đặt lại khung mới.`
      );
    }
    try {
      const { evaluateCandidateAiScore } = await import('./ai-scorer.js');
      if (evaluateCandidateAiScore(existing || {}).result === 'Loại') {
        throw new Error(`Ứng viên ${existing?.full_name || ''} có Kết Quả sàng lọc là LOẠI! Không thể xếp lịch — cần HR xem lại hồ sơ.`);
      }
    } catch (e: any) {
      if (String(e?.message || '').includes('LOẠI')) throw e;
      // AI lỗi thì bỏ qua, validate khung giờ bên dưới vẫn chạy.
    }
    // Ràng buộc khung cố định 30 phút: sai khung -> lỗi + yêu cầu đăng ký lại.
    const checked = validateInterviewSlot(interviewDate, timeSlot);
    if (!checked.ok) {
      throw new Error(checked.error);
    }
    // Trùng lịch cùng ngày (< 30 phút với bạn khác) -> lỗi + gợi ý khung trống.
    const all = await this.repo.listCandidates().catch(() => []);
    const conflict = findSlotConflict(all, String(interviewDate).slice(0, 10), checked.value.startMs, submissionId);
    if (conflict) {
      throw new Error(buildConflictMessage(conflict, String(interviewDate).slice(0, 10), suggestFreeSlots(all, String(interviewDate).slice(0, 10), 5, submissionId)));
    }
    return this.repo.updateCandidate(submissionId, {
      status: 'INVITED_INTERVIEW',
      interview_date: String(interviewDate).slice(0, 10),
      interview_time_slot: checked.value.normalized,
      interviewer_id: interviewerId,
    });
  }

  /** Cập nhật thông tin ứng viên (ca đăng ký, chi nhánh...): whitelist chặt. */
  async updateCandidateFields(submissionId: string, updates: any, actorId: string) {
    // VIP rank cần đọc snapshot cùng chi nhánh rồi tính hạng — bắt buộc đi qua
    // hàng đợi ghi tuần tự, nếu không 2 lần bấm VIP liên tiếp sẽ đọc cùng 1
    // snapshot → cả 2 đều ra rank 1 → VIP 2 ghi đè VIP 1 (tưởng "mất VIP").
    if (updates.vip !== undefined) {
      return singleWriterQueue.enqueue({
        entityType: 'UNG_VIEN',
        entityId: submissionId,
        actorId,
        execute: () => this.updateCandidateFieldsInternal(submissionId, updates, actorId),
      }).then((r: any) => r.result);
    }
    return this.updateCandidateFieldsInternal(submissionId, updates, actorId);
  }

  private async updateCandidateFieldsInternal(submissionId: string, updates: any, actorId: string) {
    const allowed: any = {};
    if (updates.registered_shift !== undefined) {
      const v = String(updates.registered_shift || '').trim().slice(0, 200);
      if (!v) throw new Error('Ca đăng ký không được để trống!');
      allowed.registered_shift = v;
    }
    if (updates.preferred_branch_id !== undefined) {
      allowed.preferred_branch_id = String(updates.preferred_branch_id || '').trim().slice(0, 32);
    }
    if (updates.branch_name !== undefined) {
      allowed.branch_name = String(updates.branch_name || '').trim().slice(0, 200);
    }
    // Đánh dấu ưu tiên vào việc (HR chọn sau khi phỏng vấn xong).
    // Cấp bậc VIP độc lập theo chi nhánh: cùng chi nhánh xếp hạng 1,2,3...
    // khác chi nhánh thì không so sánh (mỗi chi nhánh có bảng xếp hạng riêng).
    if (updates.vip !== undefined) {
      const nextVip = !!updates.vip;
      allowed.vip = nextVip;
      allowed.vip_at = nextVip ? new Date().toISOString() : undefined;
      allowed.vip_by = nextVip ? actorId : undefined;
      if (nextVip) {
        const cur = (await this.repo.listCandidates().catch(() => []))
          .find((c: any) => c.submission_id === submissionId) as any;
        if (!cur) throw new Error('CANDIDATE_NOT_FOUND');
        const branch = cur.preferred_branch_id || cur.branch_id || '';
        const sameBranchVips = (await this.repo.listCandidates().catch(() => []))
          .filter((c: any) => c.submission_id !== submissionId
            && (c.preferred_branch_id || c.branch_id || '') === branch
            && c.vip)
          .map((c: any) => Number(c.vip_rank) || 0)
          .filter((r: number) => r > 0)
          .sort((a: number, b: number) => a - b);
        let rank = 1;
        for (const r of sameBranchVips) {
          if (r === rank) rank++;
          else if (r > rank) break;
        }
        allowed.vip_rank = rank;
      } else {
        // Bỏ VIP: giảm hạng các ứng viên cùng chi nhánh có rank cao hơn.
        const cur = (await this.repo.listCandidates().catch(() => []))
          .find((c: any) => c.submission_id === submissionId) as any;
        if (cur) {
          const branch = cur.preferred_branch_id || cur.branch_id || '';
          const oldRank = Number(cur.vip_rank) || 0;
          const others = (await this.repo.listCandidates().catch(() => []))
            .filter((c: any) => c.submission_id !== submissionId
              && (c.preferred_branch_id || c.branch_id || '') === branch
              && c.vip
              && (Number(c.vip_rank) || 0) > oldRank)
            .sort((a: any, b: any) => (Number(a.vip_rank) || 0) - (Number(b.vip_rank) || 0));
          for (const o of others) {
            await this.repo.updateCandidate(o.submission_id, { vip_rank: (Number(o.vip_rank) || 0) - 1 });
          }
        }
        allowed.vip_rank = undefined;
      }
    }
    // Khôi phục ứng viên bị loại -> về MỚI (HR xem xét lại).
    if (updates.status === 'NEW') {
      const cur = (await this.repo.listCandidates().catch(() => []))
        .find((c: any) => c.submission_id === submissionId) as any;
      if (!cur) throw new Error('CANDIDATE_NOT_FOUND');
      if (cur.status !== 'REJECTED') throw new Error('Chỉ khôi phục được ứng viên đang bị LOẠI!');
      allowed.status = 'NEW';
    }
    if (Object.keys(allowed).length === 0) throw new Error('Không có trường nào được phép cập nhật!');
    const updated = await this.repo.updateCandidate(submissionId, allowed);
    await this.repo.recordAuditLog({
      log_id: `LOG_${Date.now()}`,
      actor_id: actorId,
      actor_role: 'HR',
      action: 'CANDIDATE_UPDATED',
      target_entity: 'UNG_VIEN',
      target_id: submissionId,
      details: `Updated ${Object.keys(allowed).join(', ')} for ${(updated as any).full_name || submissionId}`,
    }).catch(() => null);
    return updated;
  }

  /** HR hủy lịch PV (quá 5 phút không vào Meet / chủ động hủy): xóa ngày+khung giờ
   *  đã đăng ký, trạng thái về NEW (chưa đăng ký lịch PV). Giữ nguyên điểm đã chấm. */
  async cancelInterviewSchedule(submissionId: string, actorId: string, reason?: string) {
    const cur = (await this.repo.listCandidates().catch(() => []))
      .find((c: any) => c.submission_id === submissionId) as any;
    if (!cur) throw new Error('CANDIDATE_NOT_FOUND');
    if (!cur.interview_date) throw new Error('Ứng viên chưa có lịch phỏng vấn để hủy!');
    if (cur.status === 'ACCEPTED') throw new Error('Ứng viên đã duyệt thử việc — không thể hủy lịch PV!');
    const updated = await this.repo.updateCandidate(submissionId, {
      status: 'NEW',
      interview_date: undefined,
      interview_time_slot: undefined,
      interviewer_id: undefined,
    } as any);
    await this.repo.recordAuditLog({
      log_id: `LOG_${Date.now()}`,
      actor_id: actorId,
      actor_role: 'HR',
      action: 'INTERVIEW_CANCELLED',
      target_entity: 'UNG_VIEN',
      target_id: submissionId,
      details: `Hủy lịch PV ${cur.interview_time_slot || ''} ${String(cur.interview_date || '').slice(0, 10)} của ${(updated as any).full_name || submissionId}${reason ? ` — ${reason}` : ''}; về trạng thái chưa đăng ký lịch`,
    }).catch(() => null);
    return updated;
  }

  /** Xác nhận ứng viên SẼ tham gia PV (HR bấm tay khi UV báo qua điện thoại/Zalo,
   *  hoặc UV tự bấm link xác nhận). Chỉ từ INVITED_INTERVIEW. Giữ nguyên lịch. */
  async confirmInterview(submissionId: string, actorId: string, by: 'HR' | 'CANDIDATE' = 'HR') {
    const cur = (await this.repo.listCandidates().catch(() => []))
      .find((c: any) => c.submission_id === submissionId) as any;
    if (!cur) throw new Error('CANDIDATE_NOT_FOUND');
    if (cur.status !== 'INVITED_INTERVIEW') {
      throw new Error(`Chỉ xác nhận được lịch đang chờ (hiện: ${cur.status})!`);
    }
    if (!cur.interview_date) throw new Error('Ứng viên chưa có lịch phỏng vấn để xác nhận!');
    const updated = await this.repo.updateCandidate(submissionId, { status: 'CONFIRMED' } as any);
    await this.repo.recordAuditLog({
      log_id: `LOG_${Date.now()}`,
      actor_id: actorId,
      actor_role: by === 'HR' ? 'HR' : 'SYSTEM',
      action: 'INTERVIEW_CONFIRMED',
      target_entity: 'UNG_VIEN',
      target_id: submissionId,
      details: `${(updated as any).full_name || submissionId} xác nhận tham gia PV ${cur.interview_time_slot || ''} ${String(cur.interview_date || '').slice(0, 10)} (qua ${by === 'HR' ? 'HR' : 'link ứng viên'})`,
    }).catch(() => null);
    return updated;
  }

  /** Đánh dấu ứng viên VẮNG không phép (HR bấm tay, hoặc tick tự động khi quá giờ
   *  30 phút vẫn im lặng): trạng thái NO_SHOW + XÓA lịch để giải phóng slot.
   *  Muốn PV lại thì HR đặt lịch mới (lịch mới về INVITED). */
  async markInterviewNoShow(submissionId: string, actorId: string, reason?: string) {
    const cur = (await this.repo.listCandidates().catch(() => []))
      .find((c: any) => c.submission_id === submissionId) as any;
    if (!cur) throw new Error('CANDIDATE_NOT_FOUND');
    if (!['INVITED_INTERVIEW', 'CONFIRMED'].includes(String(cur.status || ''))) {
      throw new Error(`Chỉ đánh vắng được lịch đang chờ/đã xác nhận (hiện: ${cur.status})!`);
    }
    const slot = `${cur.interview_time_slot || ''} ${String(cur.interview_date || '').slice(0, 10)}`.trim();
    const updated = await this.repo.updateCandidate(submissionId, {
      status: 'NO_SHOW',
      interview_date: undefined,
      interview_time_slot: undefined,
      interviewer_id: undefined,
    } as any);
    await this.repo.recordAuditLog({
      log_id: `LOG_${Date.now()}`,
      actor_id: actorId,
      actor_role: actorId === 'SYSTEM' ? 'SYSTEM' : 'HR',
      action: 'INTERVIEW_NO_SHOW',
      target_entity: 'UNG_VIEN',
      target_id: submissionId,
      details: `${(updated as any).full_name || submissionId} vắng PV ${slot}${reason ? ` — ${reason}` : ''}; đã giải phóng slot, cần đặt lịch mới nếu PV lại`,
    }).catch(() => null);
    return updated;
  }

  /** Ứng viên bấm "Xin dời lịch" qua link RSVP: trạng thái RESCHEDULE_REQUESTED +
   *  XÓA lịch cũ để giải phóng slot, HR đặt lịch mới cho bạn. */
  async requestInterviewReschedule(submissionId: string) {
    const cur = (await this.repo.listCandidates().catch(() => []))
      .find((c: any) => c.submission_id === submissionId) as any;
    if (!cur) throw new Error('CANDIDATE_NOT_FOUND');
    if (!['INVITED_INTERVIEW', 'CONFIRMED'].includes(String(cur.status || ''))) {
      throw new Error('Lịch này không còn hiệu lực để xin dời! Liên hệ HR đặt lịch mới.');
    }
    const updated = await this.repo.updateCandidate(submissionId, {
      status: 'RESCHEDULE_REQUESTED',
      interview_date: undefined,
      interview_time_slot: undefined,
      interviewer_id: undefined,
    } as any);
    await this.repo.recordAuditLog({
      log_id: `LOG_${Date.now()}`,
      actor_id: 'CANDIDATE',
      actor_role: 'SYSTEM',
      action: 'INTERVIEW_RESCHEDULE_REQUESTED',
      target_entity: 'UNG_VIEN',
      target_id: submissionId,
      details: `${(updated as any).full_name || submissionId} xin dời lịch PV qua link xác nhận; chờ HR đặt lịch mới`,
    }).catch(() => null);
    return updated;
  }

  /** Link RSVP cho ứng viên bấm xác nhận/dời lịch (không cần đăng nhập):
   *  JWT ký theo submission_id, hết hạn 7 ngày. Giả mạo = verify rớt. */
  buildRsvpToken(submissionId: string): string {
    return jwt.sign({ typ: 'interview-rsvp', sid: submissionId }, getJwtSecret(), {
      expiresIn: '7d',
    } as any);
  }

  verifyRsvpToken(token: string): string {
    try {
      const d: any = jwt.verify(String(token || ''), getJwtSecret());
      if (!d || d.typ !== 'interview-rsvp' || !d.sid) throw new Error('BAD_TOKEN');
      return String(d.sid);
    } catch {
      throw new Error('RSVP_LINK_INVALID: Link xác nhận hết hạn hoặc không hợp lệ! Liên hệ HR gửi lại thư mời.');
    }
  }

  /** Đánh LOẠI: trạng thái REJECTED + xóa lịch PV + xóa thư mời Zalo (ẩn khỏi 2 danh sách). */
  async rejectCandidate(submissionId: string, actorId: string, reason?: string) {
    const updated = await this.repo.updateCandidate(submissionId, {
      status: 'REJECTED',
      interview_date: undefined,
      interview_time_slot: undefined,
      interviewer_id: undefined,
      zalo_invite_status: undefined,
      zalo_uid: undefined,
      zalo_invite_at: undefined,
      zalo_invite_error: undefined,
    } as any);
    await this.repo.recordAuditLog({
      log_id: `LOG_${Date.now()}`,
      actor_id: actorId,
      actor_role: 'HR',
      action: 'CANDIDATE_REJECTED',
      target_entity: 'UNG_VIEN',
      target_id: submissionId,
      details: `Rejected ${(updated as any).full_name || submissionId}${reason ? ` — ${reason}` : ''}; interview schedule cleared`,
    }).catch(() => null);
    return updated;
  }

  /** Chấm điểm rubric PV (server tự tính từ đáp án; có LOẠI thẳng -> REJECTED luôn). */
  async scoreCandidate(
    submissionId: string,
    rubricId: string,
    answers: Record<string, number | number[]>,
    actorId: string
  ) {
    const { computeRubricScore } = await import('./interview-rubric.service.js');
    const scored = computeRubricScore(rubricId, answers || {});
    const detail = JSON.stringify({ ...scored, answers: answers || {}, scoredBy: actorId, scoredAt: new Date().toISOString() });
    if (scored.hasLoai) {
      await this.repo.updateCandidate(submissionId, {
        interview_score: scored.total,
        interview_rubric: rubricId,
        interview_score_detail: detail,
      } as any);
      const rejected = await this.rejectCandidate(
        submissionId,
        actorId,
        `Rubric ${rubricId}: dính đáp án LOẠI (${scored.loaiQuestions.slice(0, 2).join('; ')})`
      );
      return { total: scored.total, passed: false, verdict: scored.verdict, autoRejected: true, candidate: rejected };
    }
    const cur = (await this.repo.listCandidates().catch(() => []))
      .find((c: any) => c.submission_id === submissionId) as any;
    // PV xong thì gỡ lịch khỏi danh sách "Đã Lên Lịch" (giữ nguyên điểm đã chấm):
    // lịch cũ để lại khiến tab vẫn đếm ngược + cho vào Meet dù đã xong.
    const doneSlot = `${(cur as any)?.interview_time_slot || ''} ${String((cur as any)?.interview_date || '').slice(0, 10)}`.trim();
    const updated = await this.repo.updateCandidate(submissionId, {
      interview_score: scored.total,
      interview_rubric: rubricId,
      interview_score_detail: detail,
      // Chấm xong -> chờ HR duyệt thử việc (nút Chấm điểm ẩn đi, không chấm lại).
      ...(cur && cur.status !== 'ACCEPTED' ? { status: 'SCORED' } : {}),
      interview_date: undefined,
      interview_time_slot: undefined,
      interviewer_id: undefined,
    } as any);
    await this.repo.recordAuditLog({
      log_id: `LOG_${Date.now()}`,
      actor_id: actorId,
      actor_role: 'HR',
      action: 'CANDIDATE_SCORED',
      target_entity: 'UNG_VIEN',
      target_id: submissionId,
      details: `Rubric ${rubricId}: ${scored.total}/${scored.max} (${scored.verdict})${doneSlot ? `; lịch PV ${doneSlot} đã xong và được gỡ` : ''}`,
    }).catch(() => null);
    return { total: scored.total, passed: scored.passed, verdict: scored.verdict, autoRejected: false, candidate: updated };
  }

  /** Duyệt thử việc: yêu cầu rubric PASS (≥12, không LOẠI) -> tạo NV thử việc + PIN, ACCEPTED. */
  async approveCandidate(submissionId: string, actorId: string) {
    const cand = (await this.repo.listCandidates().catch(() => []))
      .find((c: any) => c.submission_id === submissionId) as any;
    if (!cand) throw new Error('CANDIDATE_NOT_FOUND');
    if (cand.status === 'ACCEPTED') throw new Error('Ứng viên này đã được duyệt thử việc rồi!');
    if (cand.status === 'REJECTED') throw new Error('Ứng viên đã bị LOẠI! Khôi phục trước khi duyệt.');
    // Chặn duyệt khi đăng ký từ 2 ca / 2 chi nhánh trở lên: HR cập nhật lại 1 giá trị trước.
    const shiftParts = splitMultiValue(cand.registered_shift);
    if (shiftParts.length >= 2) {
      throw new Error(`⛔ ${cand.full_name} đăng ký ${shiftParts.length} ca (${shiftParts.join(' + ')})! HR bấm "Cập nhật TT" cập nhật lại đúng 1 ca làm việc rồi mới được duyệt chính thức!`);
    }
    const branchParts = splitMultiValue(cand.preferred_branch_id).length >= 2
      ? splitMultiValue(cand.preferred_branch_id)
      : splitMultiValue(cand.branch_name);
    if (branchParts.length >= 2) {
      throw new Error(`⛔ ${cand.full_name} đăng ký ${branchParts.length} chi nhánh (${branchParts.join(' + ')})! HR bấm "Cập nhật TT" cập nhật lại đúng 1 chi nhánh rồi mới được duyệt chính thức!`);
    }
    // Tính lại điểm từ đáp án đã lưu (logic khóa chéo / ngưỡng hiện hành).
    const { computeRubricScore, parseScoreDetail } = await import('./interview-rubric.service.js');
    const saved = parseScoreDetail((cand as any).interview_score_detail);
    let detail = saved;
    if (saved?.rubricId && saved.answers) {
      try {
        detail = { ...computeRubricScore(saved.rubricId, saved.answers), answers: saved.answers };
      } catch {
        detail = saved;
      }
    }
    if (!detail || detail.total < Math.min(12, detail.achievableMax ?? 12) || detail.hasLoai) {
      throw new Error(
        !detail
          ? 'Ứng viên chưa được chấm điểm rubric! HR chấm điểm trước (tab Lịch PV → Chấm điểm).'
          : `Chưa đạt TIÊU CHÍ (đang ${detail.total}/${detail.achievableMax ?? detail.max}${detail.hasLoai ? ', dính đáp án LOẠI' : ''})! Cần PASS từ 12 điểm và không có đáp án LOẠI mới được duyệt thử việc.`
      );
    }
    const branchId = (cand.preferred_branch_id || 'CN130').trim() || 'CN130';
    const genderRaw = String(cand.gender || '').trim().toLowerCase();
    // Map ca đăng ký (1 ca duy nhất) -> ca cố định để BOT tự xếp lịch thử việc.
    const shiftText = String(cand.registered_shift || '').toLowerCase();
    const defaultShiftCode = /sáng|morning|ca\s*1/.test(shiftText) ? 'CA_1' as const
      : /chiều|chieu|afternoon|ca\s*2/.test(shiftText) ? 'CA_2' as const
      : /tối|toi|evening|night|ca\s*3/.test(shiftText) ? 'CA_3' as const
      : undefined;
    const created: any = await this.createEmployee({
      fullName: cand.full_name,
      phone: cand.phone_normalized || cand.phone,
      branchId,
      employmentStatus: 'PROBATION',
      gender: genderRaw.startsWith('nữ') || genderRaw === 'nu' ? 'NU' : 'NAM',
      group: 'STORE',
      ...(defaultShiftCode ? { defaultShiftCode } : {}),
      actorId,
    });
    const emp = created?.result || created;
    // Lịch thử việc 12 ngày để hiển thị cho HR + NV mới.
    const startDate = normSheetDate((emp as any).start_date) || new Date().toISOString().slice(0, 10);
    const endDate = new Date(`${startDate}T00:00:00Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 11);
    const probation = {
      startDate,
      endDate: endDate.toISOString().slice(0, 10),
      days: 12,
      branchId,
      shiftCode: defaultShiftCode || null,
      shiftLabel: String(cand.registered_shift || ''),
    };
    const updated = await this.repo.updateCandidate(submissionId, {
      status: 'ACCEPTED',
    } as any);
    await this.repo.recordAuditLog({
      log_id: `LOG_${Date.now()}`,
      actor_id: actorId,
      actor_role: 'HR',
      action: 'CANDIDATE_APPROVED',
      target_entity: 'UNG_VIEN',
      target_id: submissionId,
      details: `Approved ${(cand as any).full_name} (rubric ${detail.total}/13) -> employee ${(emp as any).employee_code}`,
    }).catch(() => null);
    // Kèm tài khoản + PIN khởi tạo để HR trao cho NV mới.
    let account: any = null;
    try {
      const accs = await this.repo.findAccountByPhone(canonicalPhone(cand.phone_normalized || cand.phone));
      const found = accs.find(a => a.employee_id === (emp as any).employee_id) || accs[0];
      if (found) {
        const { pin_hash: _omit, ...rest } = found as any;
        account = rest;
      }
    } catch { /* UI tự tải lại */ }
    return { employee: emp, account, candidate: updated, probation };
  }
}
