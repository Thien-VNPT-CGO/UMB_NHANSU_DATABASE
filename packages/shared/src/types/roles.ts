export type SystemRole = 'DIRECTOR' | 'ADMIN' | 'HR' | 'STORE' | 'FINANCE' | 'MARKETING' | 'IT' | 'EMPLOYEE' | 'DRIVER' | 'FLEET_MANAGER';

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
  | 'READ_ONLY'            // Chỉ xem
  // --- MILKROUTE EV PERMISSIONS ---
  | 'EV_SHIFT_VIEW'              // Xem ca vận chuyển (own)
  | 'EV_SHIFT_VIEW_ALL'          // Xem tất cả ca vận chuyển
  | 'EV_SHIFT_MANAGE'            // Tạo/sửa/xóa ca vận chuyển
  | 'EV_GPS_TRACK'               // Theo dõi GPS realtime (own)
  | 'EV_GPS_TRACK_ALL'           // Theo dõi GPS tất cả xe
  | 'EV_GEOFENCE_MANAGE'         // Cấu hình geofence
  | 'EV_SLA_MONITOR'             // Giám sát SLA
  | 'EV_CHARGING_VIEW'           // Xem phiếu sạc (own)
  | 'EV_CHARGING_VIEW_ALL'       // Xem tất cả phiếu sạc
  | 'EV_CHARGING_CREATE'         // Tạo phiếu sạc
  | 'EV_CHARGING_START'          // Bắt đầu sạc (lock GPS)
  | 'EV_CHARGING_END'            // Kết thúc sạc
  | 'EV_CHARGING_APPROVE_L1'     // HR: Phê duyệt cấp 1
  | 'EV_CHARGING_APPROVE_L2'     // Director: Phê duyệt cấp 2
  | 'EV_PAYROLL_VIEW'            // Xem bảng lương tài xế (own)
  | 'EV_PAYROLL_VIEW_ALL'        // Xem tất cả bảng lương tài xế
  | 'EV_PAYROLL_CREATE'          // Tạo bảng lương tài xế (Finance)
  | 'EV_PAYROLL_APPROVE'         // Duyệt bảng lương tài xế
  | 'EV_REPORT_VIEW'             // Xem báo cáo vận chuyển
  | 'EV_VEHICLE_MANAGE';         // Quản lý xe điện

export interface AuthUser {
  id: string;
  employeeId?: string;
  role: SystemRole;
  branchScope?: string; // e.g. 'CN130', 'CN261', or '*' for all branches
  phone: string;
  fullName: string;
  permissions: UserPermission[];
  /** Nhân viên đang dùng PIN do HR cấp — bị chặn API ngoài allowlist đến khi đổi. */
  mustChangePin?: boolean;
  
  // --- MILKROUTE EV FIELDS ---
  /** ID xe điện được gán (nếu role = DRIVER) */
  assignedVehicleId?: string;
  /** Loại ca vận chuyển: 'MILK_ROUTE' | 'NORMAL' */
  shiftType?: 'MILK_ROUTE' | 'NORMAL';
  /** Cấu hình GPS tracking */
  gpsConfig?: {
    trackingIntervalSec: number;      // 5s di chuyển, 30s dừng
    backgroundTrackingEnabled: boolean;
    accuracyThresholdMeters: number;  // 30m
  };
}
