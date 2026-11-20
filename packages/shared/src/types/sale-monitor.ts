/**
 * Tool giám sát nhân viên Sale (Admin) — snapshot realtime theo ngày.
 *
 * Nguồn dữ liệu: PHAN_CONG_CA (lịch ca Sale 4 ca) + SU_KIEN_DIEM_DANH
 * (check-in/check-out do nhân viên bấm trên Cổng Employee Web).
 *
 * Backend trả snapshot đã chuẩn hoá; frontend tự suy lại trạng thái/đồng hồ
 * theo từng giây và tải lại ngay khi nhận socket `sale-monitor:updated`.
 */

export type SaleMonitorStatus =
  | 'WORKING'          // Đã check-in, đang trong ca
  | 'LATE'             // Đã check-in nhưng trễ giờ vào ca
  | 'COMPLETED'        // Đã check-in + check-out
  | 'MISSING_CHECKIN'  // Đã tới giờ vào ca nhưng chưa check-in
  | 'MISSING_CHECKOUT' // Hết ca nhưng chưa check-out
  | 'UPCOMING'         // Chưa tới giờ vào ca
  | 'ABSENT'           // Vắng ca
  | 'OFF';             // Không có ca trong ngày

export interface SaleMonitorShift {
  assignment_id: string;
  shift_code: string;
  shift_name: string;
  shift_time_label: string;
  start_at: string;
  end_at: string;
  status: SaleMonitorStatus;
  check_in_at?: string;
  check_out_at?: string;
  check_in_event_id?: string;
  check_out_event_id?: string;
  worked_minutes: number;
  scheduled_minutes: number;
  late_minutes: number;
  early_leave_minutes: number;
  overtime_minutes: number;
  fine_amount: number;
  is_late: boolean;
  is_absent: boolean;
  gps_status?: string;
}

export interface SaleMonitorEmployee {
  employee_id: string;
  employee_code: string;
  full_name: string;
  phone?: string;
  branch_id: string;
  group: string;
  employment_status: string;
  default_shift_code?: string;
  shifts: SaleMonitorShift[];
  status: SaleMonitorStatus;
  check_in_at?: string;
  check_out_at?: string;
  worked_minutes: number;
  scheduled_minutes: number;
  late_minutes: number;
  progress_percent: number;
  shift_count: number;
}

export interface SaleMonitorEvent {
  event_id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  type: 'CHECK_IN' | 'CHECK_OUT' | 'ABSENT' | string;
  time: string;
  shift_code?: string;
  is_late?: boolean;
  fine_amount?: number;
}

export interface SaleMonitorSummary {
  total: number;
  working: number;
  late: number;
  completed: number;
  missing_checkin: number;
  missing_checkout: number;
  upcoming: number;
  absent: number;
  off: number;
  checked_in: number;
  scheduled: number;
  total_worked_minutes: number;
  total_scheduled_minutes: number;
  progress_percent: number;
  attendance_rate: number;
}

export interface SaleMonitorSnapshot {
  date: string;
  is_today: boolean;
  generated_at: string;
  server_time: string;
  timezone: 'Asia/Ho_Chi_Minh';
  summary: SaleMonitorSummary;
  employees: SaleMonitorEmployee[];
  recent_events: SaleMonitorEvent[];
}
