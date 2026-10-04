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

export type LeaveType = 'DOT_XUAT' | 'HANG_TUAN' | 'THU_VIEC';
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

/** Loại phiếu đổi ca: NV tự tráo với nhau (không phụ cấp), HR điều phối nhường ca (+30k),
 *  HR chuyển ca hỗ trợ chi nhánh (chỉ định NV chính thức sang CN khác, NV xác nhận là tạo ca ngay). */
export type SwapKind = 'EMPLOYEE_SWAP' | 'HR_DISPATCH' | 'HR_SUPPORT';

export const HR_DISPATCH_BONUS_VND = 30000;

export interface SwapRequest {
  swap_id: string;
  swap_kind: SwapKind; // mặc định EMPLOYEE_SWAP
  requester_id: string; // Employee A (với HR_DISPATCH: chủ ca cần người làm thay)
  requester_assignment_id: string;
  target_employee_id: string; // Employee B (với HR_DISPATCH: '' khi mở, NV nhận ca khi chấp nhận)
  target_assignment_id: string;
  reason: string;
  status: 'PENDING_PARTNER' | 'PARTNER_ACCEPTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  partner_responded_at?: string;
  approved_by?: string;
  approved_at?: string;
  rejection_reason?: string;
  /** Phụ cấp nhường ca (đ): chỉ HR_DISPATCH đã APPROVED mới có 30.000. */
  bonus_amount?: number;
  /** HR chuyển ca hỗ trợ chi nhánh: CN cần hỗ trợ (ca tạo tại CN này khi NV đồng ý). */
  support_branch_id?: string;
  /** Ngày cần hỗ trợ (YYYY-MM-DD, từ tuần hiện tại trở đi). */
  support_date?: string;
  /** Ca cần hỗ trợ: CA_1 | CA_2 | CA_3. */
  support_shift_code?: string;
  created_at: string;
  version: number;
}
