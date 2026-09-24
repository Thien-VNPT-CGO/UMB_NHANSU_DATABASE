export type EmploymentStatus = 'PRE_ONBOARDING' | 'PROBATION' | 'OFFICIAL' | 'TERMINATED';
export type EmployeeGroup = 'STORE' | 'XUONG' | 'VAN_PHONG' | 'SALE';
export interface EmployeeMaster {
    employee_id: string;
    employee_code: string;
    full_name: string;
    phone_normalized: string;
    id_card_number?: string;
    email?: string;
    gender?: 'NAM' | 'NU' | 'KHAC';
    birth_date?: string;
    employment_status: EmploymentStatus;
    group: EmployeeGroup;
    default_branch_id: string;
    current_rate_per_hour: number;
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
    status: 'NEW' | 'NEED_INFO' | 'INVITED_INTERVIEW' | 'INTERVIEWED' | 'ACCEPTED' | 'REJECTED' | string;
    interview_date?: string;
    interview_time_slot?: string;
    interviewer_id?: string;
    interview_score?: number;
    interview_notes?: string;
    created_at: string;
    gender?: string;
    education_level?: string;
    hometown?: string;
    phone?: string;
    registered_shift?: string;
    branch_name?: string;
    experience?: string;
    emergency_handling?: string;
    facebook_url?: string;
    referral_source?: string;
    ai_score?: number;
    screening_result?: string;
    source_code?: string;
}
