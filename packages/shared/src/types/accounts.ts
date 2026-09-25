import { SystemRole } from './roles.js';

export type AccountStatus = 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';

export interface EmployeeAccount {
  account_id: string;
  employee_id: string;
  phone_normalized: string;
  account_status: AccountStatus;
  role: SystemRole;
  branch_scope: string; // 'ALL' or specific branchId
  /** Bcrypt hash của mã PIN đăng nhập (HR cấp, nhân viên bắt đổi lần đầu). */
  pin_hash?: string;
  /** True khi PIN hiện tại do HR cấp/reset — bắt buộc đổi ở lần đăng nhập sau. */
  pin_must_change?: boolean;
  activated_by?: string;
  activated_at?: string; // ISO 8601
  revoked_by?: string;
  revoked_at?: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AdminAccount {
  admin_id: string;
  username: string;
  password_hash: string;
  full_name: string;
  role: SystemRole;
  branch_scope: string;
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}
