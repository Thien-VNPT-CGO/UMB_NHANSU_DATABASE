export type PayrollRunStatus = 'DRAFT' | 'RECONCILED' | 'APPROVED' | 'PUBLISHED' | 'PAID';
export interface PayrollRun {
    run_id: string;
    period: string;
    branch_scope: string;
    status: PayrollRunStatus;
    total_employees: number;
    total_hours: number;
    total_amount: number;
    created_by: string;
    reconciled_by?: string;
    reconciled_at?: string;
    approved_by?: string;
    approved_at?: string;
    published_by?: string;
    published_at?: string;
    paid_by?: string;
    paid_at?: string;
    version: number;
    created_at: string;
    updated_at: string;
}
export interface PayslipItem {
    item_id: string;
    run_id: string;
    employee_id: string;
    employee_code: string;
    full_name: string;
    period: string;
    total_shifts: number;
    standard_hours: number;
    rate_snapshot: number;
    standard_pay: number;
    allowance: number;
    bonus: number;
    deduction: number;
    net_pay: number;
    status: PayrollRunStatus;
    created_at: string;
    updated_at: string;
}
