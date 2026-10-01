import { v4 as uuidv4 } from 'uuid';
import {
  CandidateApplication,
  EmployeeMaster,
  EmploymentStatus,
  STANDARD_HOURLY_RATES,
} from '@ubm/shared';
import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { singleWriterQueue } from '../repositories/single-writer-queue.js';
import { normalizePhone } from './auth.service.js';
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
          start_date: data.startDate || new Date().toISOString().split('T')[0],
          official_date: data.officialDate || (data.employmentStatus === 'OFFICIAL' ? (data.startDate || new Date().toISOString().split('T')[0]) : undefined),
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

        return updated;
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
    if (updates.startDate !== undefined && updates.startDate) patch.start_date = String(updates.startDate);
    if (updates.officialDate !== undefined && updates.officialDate) patch.official_date = String(updates.officialDate);
    if (updates.email !== undefined) patch.email = String(updates.email).trim() || undefined;
    if (updates.gender !== undefined) patch.gender = updates.gender;
    if (updates.birthDate !== undefined && updates.birthDate) patch.birth_date = String(updates.birthDate);
    if (updates.idCardNumber !== undefined) patch.id_card_number = String(updates.idCardNumber).trim() || undefined;

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
    const updated = await this.repo.updateCandidate(submissionId, {
      interview_score: scored.total,
      interview_rubric: rubricId,
      interview_score_detail: detail,
      // Chấm xong -> chờ HR duyệt thử việc (nút Chấm điểm ẩn đi, không chấm lại).
      ...(cur && cur.status !== 'ACCEPTED' ? { status: 'SCORED' } : {}),
    } as any);
    await this.repo.recordAuditLog({
      log_id: `LOG_${Date.now()}`,
      actor_id: actorId,
      actor_role: 'HR',
      action: 'CANDIDATE_SCORED',
      target_entity: 'UNG_VIEN',
      target_id: submissionId,
      details: `Rubric ${rubricId}: ${scored.total}/${scored.max} (${scored.verdict})`,
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
    const startDate = String((emp as any).start_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
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
