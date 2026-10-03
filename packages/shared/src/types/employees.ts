export type EmploymentStatus = 'PRE_ONBOARDING' | 'PROBATION' | 'OFFICIAL' | 'TERMINATED';
export type EmployeeGroup = 'STORE' | 'XUONG' | 'VAN_PHONG' | 'SALE';

export interface EmployeeMaster {
  employee_id: string;
  employee_code: string; // e.g. UBM_NV000001
  full_name: string;
  phone_normalized: string;
  id_card_number?: string;
  email?: string;
  gender?: 'NAM' | 'NU' | 'KHAC';
  birth_date?: string;
  employment_status: EmploymentStatus;
  group: EmployeeGroup;
  default_branch_id: string; // e.g. CN130
  /** Ca làm cố định (CA_1/CA_2/CA_3) — BOT dựa vào đây để tự xếp lịch khi PUBLISH. */
  default_shift_code?: 'CA_1' | 'CA_2' | 'CA_3';
  current_rate_per_hour: number; // e.g. 21000 for probation, 25500 for official
  start_date: string;
  official_date?: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface EmployeeStageHistory {
  period_id: string;
  employee_id: string;
  stage: EmploymentStatus;
  effective_from: string;
  effective_to?: string;
  rate_per_hour: number;
  rate_policy_id?: string;
  note?: string;
  approved_by: string;
  version: number;
  created_at: string;
}

export interface CandidateApplication {
  submission_id: string;
  full_name: string;
  phone_normalized: string;
  birth_year: number;
  apply_position: string;
  preferred_branch_id: string;
  status: 'NEW' | 'NEED_INFO' | 'INVITED_INTERVIEW' | 'CONFIRMED' | 'RESCHEDULE_REQUESTED' | 'INTERVIEWED' | 'ACCEPTED' | 'REJECTED' | 'NO_SHOW' | string;
  interview_date?: string;
  interview_time_slot?: string;
  interviewer_id?: string;
  interview_score?: number;
  /** Bộ rubric đã chấm: 'store' (9 câu) | 'office' (7 câu). */
  interview_rubric?: string;
  /** Chi tiết chấm rubric (JSON: {rubric, total, hasLoai, answers}). */
  interview_score_detail?: string;
  interview_notes?: string;
  /** Trạng thái gửi thư mời Zalo: SENT | NOT_FRIEND | FAILED */
  zalo_invite_status?: string;
  zalo_uid?: string;
  zalo_invite_at?: string;
  zalo_invite_error?: string;
  created_at: string;

  // 17 Cột Biểu Mẫu Tuyển Dụng Google Forms theo yêu cầu HR
  gender?: string; // Giới tính (Nam / Nữ / Khác)
  education_level?: string; // Trình độ (Đại học, Cao đẳng, THPT...)
  hometown?: string; // Quê quán
  phone?: string; // SĐT hiển thị gốc
  registered_shift?: string; // Ca đăng ký
  branch_name?: string; // Chi nhánh đăng ký
  experience?: string; // Kinh nghiệm
  emergency_handling?: string; // Xử lý đột xuất
  facebook_url?: string; // Link Facebook (click xem trực tiếp)
  referral_source?: string; // Nguồn biết tin
  ai_score?: number; // Điểm AI tự động chấm
  screening_result?: string; // Kết quả sàng lọc
  source_code?: string; // Mã nguồn
}
