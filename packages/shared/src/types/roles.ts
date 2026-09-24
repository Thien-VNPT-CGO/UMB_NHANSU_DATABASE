export type SystemRole = 'ADMIN' | 'HR' | 'STORE' | 'FINANCE' | 'MARKETING' | 'EMPLOYEE';

export type UserPermission =
  | 'ACCOUNTS_MANAGE'      // Kích hoạt/khóa tài khoản, cấp vai trò
  | 'EMPLOYEES_MANAGE'     // Tiếp nhận nhân viên, chuyển chính thức
  | 'SCHEDULE_MANAGE'      // Lập/duyệt/phát lịch
  | 'LEAVE_APPROVE'        // Duyệt nghỉ phép, đổi ca
  | 'ATTENDANCE_VIEW'      // Xem chấm công
  | 'ATTENDANCE_VERIFY'    // Xác nhận công, duyệt điều chỉnh công
  | 'PAYROLL_CREATE'       // Lập bảng lương DRAFT
  | 'PAYROLL_APPROVER'     // Duyệt bảng lương (tách biệt nhiệm vụ)
  | 'ANNOUNCEMENTS_MANAGE' // Phát thông báo nội bộ
  | 'AUDIT_VIEW'           // Xem audit log và sức khỏe hệ thống
  | 'READ_ONLY';           // Chỉ xem

export interface AuthUser {
  id: string;
  employeeId?: string;
  role: SystemRole;
  branchScope?: string; // e.g. 'CN130', 'CN261', or '*' for all branches
  phone: string;
  fullName: string;
  permissions: UserPermission[];
}
