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

/** Chuẩn hóa SĐT về dạng so sánh được (10 số, đầu 0). */
export function canonicalPhone(phone: string): string {
  const digits = normalizePhone(phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('84')) return '0' + digits.slice(2);
  return digits;
}

export interface DuplicatePhoneGroup {
  phone: string;
  employees: { employee_id: string; employee_code: string; full_name: string }[];
  accounts: { account_id: string; employee_id: string; account_status: string }[];
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
          phone_normalized: data.phone,
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
        // Không còn luồng kích hoạt: tài khoản luôn ACTIVE, đăng nhập bằng mã PIN do HR cấp.
        await this.repo.createAccount({
          account_id: `ACC_${Date.now()}`,
          employee_id: employeeId,
          phone_normalized: data.phone,
          account_status: 'ACTIVE',
          role: 'EMPLOYEE',
          branch_scope: data.branchId || 'CN130',
        });

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
    return this.repo.updateCandidate(submissionId, {
      status: 'INVITED_INTERVIEW',
      interview_date: interviewDate,
      interview_time_slot: timeSlot,
      interviewer_id: interviewerId,
    });
  }
}
