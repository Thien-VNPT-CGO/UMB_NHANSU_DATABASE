export type PayrollRunStatus = 'DRAFT' | 'RECONCILED' | 'APPROVED' | 'PUBLISHED' | 'PAID';

export interface PayrollRun {
  run_id: string;
  period: string; // YYYY-MM
  branch_scope: string; // 'ALL' or specific branch
  status: PayrollRunStatus;
  total_employees: number;
  total_hours: number;
  total_amount: number;
  created_by: string; // Finance creator
  reconciled_by?: string;
  reconciled_at?: string;
  approved_by?: string; // Must be different from created_by (PAYROLL_APPROVER)
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
  rate_snapshot: number; // VND per hour
  standard_pay: number;
  allowance: number;
  bonus: number;
  deduction: number;
  net_pay: number;
  status: PayrollRunStatus;
  created_at: string;
  updated_at: string;
}
