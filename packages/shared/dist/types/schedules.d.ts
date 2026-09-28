export type ShiftCode = 'CA_1' | 'CA_2' | 'CA_3';
export interface ShiftTemplate {
    code: ShiftCode;
    name: string;
    start_hour: number;
    start_minute: number;
    end_hour: number;
    end_minute: number;
    duration_hours: number;
}
export type AssignmentStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
export interface ShiftAssignment {
    assignment_id: string;
    employee_id: string;
    branch_id: string;
    shift_code: ShiftCode;
    date: string;
    start_at: string;
    end_at: string;
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
    requested_date: string;
    shift_code?: ShiftCode;
    reason: string;
    status: RequestApprovalStatus;
    reviewed_by?: string;
    reviewed_at?: string;
    review_note?: string;
    created_at: string;
    version: number;
}
/** Loại phiếu đổi ca: NV tự tráo với nhau (không phụ cấp) hay HR điều phối nhường ca (+30k). */
export type SwapKind = 'EMPLOYEE_SWAP' | 'HR_DISPATCH';
export declare const HR_DISPATCH_BONUS_VND = 30000;
export interface SwapRequest {
    swap_id: string;
    swap_kind: SwapKind;
    requester_id: string;
    requester_assignment_id: string;
    target_employee_id: string;
    target_assignment_id: string;
    reason: string;
    status: 'PENDING_PARTNER' | 'PARTNER_ACCEPTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
    partner_responded_at?: string;
    approved_by?: string;
    approved_at?: string;
    rejection_reason?: string;
    /** Phụ cấp nhường ca (đ): chỉ HR_DISPATCH đã APPROVED mới có 30.000. */
    bonus_amount?: number;
    created_at: string;
    version: number;
}
