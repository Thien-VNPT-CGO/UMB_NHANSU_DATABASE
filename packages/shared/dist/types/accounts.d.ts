import { SystemRole } from './roles.js';
export type AccountStatus = 'ACTIVE';
export interface EmployeeAccount {
    account_id: string;
    employee_id: string;
    phone_normalized: string;
    account_status: AccountStatus;
    role: SystemRole;
    branch_scope: string;
    /** Bcrypt hash của mã PIN đăng nhập (HR cấp, nhân viên bắt đổi lần đầu). */
    pin_hash?: string;
    /** Mã PIN bản rõ — CHỈ hiển thị trên cổng quản trị (Admin/HR), không trả cho employee-web. */
    pin_code?: string;
    /** True khi PIN hiện tại do HR cấp/reset — bắt buộc đổi ở lần đăng nhập sau. */
    pin_must_change?: boolean;
    /** ISO lần NV tự đổi PIN gần nhất (dùng cho xoay PIN định kỳ hàng tháng 1-5, không reset). */
    pin_changed_at?: string;
    /** Kỳ YYYY-MM mà NV đã hoàn tất tự đổi PIN (VD 2026-10). */
    pin_rotation_cycle?: string;
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
    /** false = bị khóa: văng ra đăng nhập ngay và không đăng nhập lại được. */
    is_active: boolean;
    version: number;
    created_at: string;
    updated_at: string;
}
