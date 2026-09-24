export type ShiftCode = 'CA_1' | 'CA_2' | 'CA_3';

export interface ShiftTemplate {
  code: ShiftCode;
  name: string;
  start_hour: number; // 7, 12, 18
  start_minute: number;
  end_hour: number;   // 12, 18, 23
  end_minute: number;
  duration_hours: number; // 5, 6, 5
}

export type AssignmentStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED';

export interface ShiftAssignment {
  assignment_id: string;
  employee_id: string;
  branch_id: string;
  shift_code: ShiftCode;
  date: string; // YYYY-MM-DD
  start_at: string; // ISO 8601
  end_at: string;   // ISO 8601
  status: AssignmentStatus;
  schedule_version: number;
  created_at: string;
  updated_at: string;
}

export type LeaveType = 'DOT_XUAT' | 'HANG_TUAN';
export type RequestApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface LeaveRequest {
  request_id: string;
  employee_id: string;
  branch_id: string;
  leave_type: LeaveType;
  requested_date: string; // YYYY-MM-DD
  shift_code?: ShiftCode; // optional for full day
  reason: string;
  status: RequestApprovalStatus;
  reviewed_by?: string;
  reviewed_at?: string;
  review_note?: string;
  created_at: string;
  version: number;
}

export interface SwapRequest {
  swap_id: string;
  requester_id: string; // Employee A
  requester_assignment_id: string;
  target_employee_id: string; // Employee B
  target_assignment_id: string;
  reason: string;
  status: 'PENDING_PARTNER' | 'PARTNER_ACCEPTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  partner_responded_at?: string;
  approved_by?: string;
  approved_at?: string;
  rejection_reason?: string;
  created_at: string;
  version: number;
}
