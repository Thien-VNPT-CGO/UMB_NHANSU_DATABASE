export type TicketStatus = 'PENDING' | 'APPROVED';
export type DriveSyncStatus = 'PENDING' | 'SYNCED' | 'ERROR' | 'NOT_CONFIGURED';

export interface Capability {
  code: string;
  name: string;
  description: string;
}

export interface ViolationAccount {
  account_id: string;
  display_name: string;
  system_name: string;
  must_change_pin: boolean;
  last_login_at?: string | null;
  reset_at?: string | null;
  created_at: string;
  updated_at: string;
  capabilities: Capability[];
}

export interface AuthResult {
  token: string;
  account: ViolationAccount;
  mustChangePin: boolean;
}

export interface Regulation {
  regulation_id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  fine_amount: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface TicketItem {
  regulation_id: string;
  name: string;
  category: string;
  fine_amount: number;
}

export interface ViolationTicket {
  ticket_id: string;
  ticket_code: string;
  employee_id: string;
  employee_code?: string;
  employee_name: string;
  branch_id: string;
  branch_name: string;
  violation_date: string;
  period: string;
  items: TicketItem[];
  total_amount: number;
  note?: string;
  status: TicketStatus;
  created_by: string;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
  approved_by?: string;
  approved_by_name?: string;
  approved_at?: string;
  payroll_applied_amount?: number;
  payroll_applied_at?: string;
  payroll_period?: string;
  drive_file_id?: string;
  drive_view_url?: string;
  drive_synced_at?: string;
  drive_sync_status?: DriveSyncStatus;
  drive_sync_error?: string;
}

export interface ViolationEmployee {
  employee_id: string;
  employee_code: string;
  full_name: string;
  branch_id: string;
  branch_name: string;
  employment_status: string;
}

export interface ViolationOverview {
  regulations_active: number;
  regulations_total: number;
  employees_total: number;
  pending_count: number;
  pending_amount: number;
  approved_count: number;
  approved_amount: number;
  month: string;
  month_count: number;
  month_amount: number;
  drive_error_count: number;
}

export interface CreateTicketInput {
  employee_id: string;
  violation_date: string;
  note?: string;
  status: TicketStatus;
  items: Array<{ regulation_id: string; name: string; category: string; fine_amount: number }>;
}

export type ViewKey =
  | 'dashboard'
  | 'regulations'
  | 'catch'
  | 'pending'
  | 'approved'
  | 'adjust'
  | 'change-pin'
  | 'profile';
