import { v4 as uuidv4 } from 'uuid';
import {
  CandidateApplication,
  EmployeeMaster,
  EmploymentStatus,
  STANDARD_HOURLY_RATES,
} from '@ubm/shared';
import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { singleWriterQueue } from '../repositories/single-writer-queue.js';

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

        // Tự động tạo tài khoản nhân viên tương ứng và đồng bộ xuống Sheet TAI_KHOAN_NHAN_VIEN
        const initialStatus = (data.employmentStatus === 'PRE_ONBOARDING' || !data.employmentStatus)
          ? 'PENDING_ACTIVATION'
          : 'ACTIVE';

        await this.repo.createAccount({
          account_id: `ACC_${Date.now()}`,
          employee_id: employeeId,
          phone_normalized: data.phone,
          account_status: initialStatus as any,
          role: 'EMPLOYEE',
          branch_scope: data.branchId || 'CN130',
          activated_by: initialStatus === 'ACTIVE' ? data.actorId : undefined,
          activated_at: initialStatus === 'ACTIVE' ? new Date().toISOString() : undefined,
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
