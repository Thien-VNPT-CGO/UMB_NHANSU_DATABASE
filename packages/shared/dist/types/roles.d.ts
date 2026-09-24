export type SystemRole = 'ADMIN' | 'HR' | 'STORE' | 'FINANCE' | 'MARKETING' | 'EMPLOYEE';
export type UserPermission = 'ACCOUNTS_MANAGE' | 'EMPLOYEES_MANAGE' | 'SCHEDULE_MANAGE' | 'LEAVE_APPROVE' | 'ATTENDANCE_VIEW' | 'ATTENDANCE_VERIFY' | 'PAYROLL_CREATE' | 'PAYROLL_APPROVER' | 'ANNOUNCEMENTS_MANAGE' | 'AUDIT_VIEW' | 'READ_ONLY';
export interface AuthUser {
    id: string;
    employeeId?: string;
    role: SystemRole;
    branchScope?: string;
    phone: string;
    fullName: string;
    permissions: UserPermission[];
}
