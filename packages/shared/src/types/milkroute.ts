/**
 * MilkRoute EV - Type Definitions
 * Hệ thống quản lý lộ trình vận chuyển sữa bằng xe điện
 * Tích hợp vào UBM HR System
 */

// ============================================================
// ROLES & PERMISSIONS EXTENSION
// ============================================================

export type MilkRouteRole = 'DRIVER' | 'FLEET_MANAGER';

export type MilkRoutePermission =
  // Driver permissions
  | 'EV_SHIFT_VIEW'              // Xem ca vận chuyển của mình
  | 'EV_GPS_TRACK'               // Theo dõi GPS realtime (own)
  | 'EV_CHARGING_VIEW'           // Xem phiếu sạc của mình
  | 'EV_CHARGING_CREATE'         // Tạo phiếu sạc
  | 'EV_CHARGING_START'          // Bắt đầu sạc (lock GPS)
  | 'EV_CHARGING_END'            // Kết thúc sạc
  | 'EV_PAYROLL_VIEW'            // Xem bảng lương của mình
  // Fleet Manager / Admin permissions
  | 'EV_SHIFT_MANAGE'            // Tạo/sửa/xóa ca vận chuyển
  | 'EV_SHIFT_VIEW_ALL'          // Xem tất cả ca
  | 'EV_GPS_TRACK_ALL'           // Theo dõi GPS tất cả xe
  | 'EV_GEOFENCE_MANAGE'         // Cấu hình geofence
  | 'EV_SLA_MONITOR'             // Giám sát SLA
  | 'EV_CHARGING_APPROVE_L1'     // HR: Phê duyệt cấp 1
  | 'EV_CHARGING_APPROVE_L2'     // Director: Phê duyệt cấp 2
  | 'EV_CHARGING_VIEW_ALL'       // Xem tất cả phiếu sạc
  | 'EV_PAYROLL_CREATE'          // Tạo bảng lương tài xế (Finance)
  | 'EV_PAYROLL_APPROVE'         // Duyệt bảng lương tài xế
  | 'EV_PAYROLL_VIEW_ALL'        // Xem tất cả bảng lương
  | 'EV_REPORT_VIEW'             // Xem báo cáo vận chuyển
  | 'EV_VEHICLE_MANAGE';         // Quản lý xe điện

// ============================================================
// CORE ENTITIES
// ============================================================

/** Xe điện */
export interface EVVehicle {
  vehicle_id: string;
  license_plate: string;           // Biển số xe
  frame_number?: string;           // Số khung
  battery_capacity_kwh?: number;   // Dung lượng pin (kWh)
  current_battery_pct: number;     // % pin hiện tại (0-100)
  status: 'ACTIVE' | 'MAINTENANCE' | 'RETIRED';
  assigned_driver_id?: string;     // Employee ID
  gps_device_id?: string;          // ID thiết bị GPS (nếu có)
  notes?: string;
  created_at: string;
  updated_at: string;
  version: number;
}

/** Lộ trình cố định */
export interface EVRoute {
  route_id: string;
  name: string;                    // 'MILK_ROUTE_HCM'
  description?: string;
  is_active: boolean;
  total_distance_km?: number;
  estimated_duration_min?: number;
  created_at: string;
  updated_at: string;
  version: number;
}

/** Điểm dừng trên lộ trình (có geofence) */
export interface EVRouteStop {
  stop_id: string;
  route_id: string;
  stop_order: number;              // 1,2,3,4,5,6
  name: string;                    // 'Xưởng Sản Xuất', 'CH130', ...
  /** Chi nhánh tương ứng (nếu có) — toạ độ tự đồng bộ theo tab Quản Lý Chi Nhánh. */
  branch_id?: string;
  address?: string;
  latitude: number;
  longitude: number;
  geofence_radius_m: number;       // Mặc định 100m
  sla_minutes: number;             // SLA từ điểm trước đến điểm này
  stop_type: 'START' | 'DELIVERY' | 'OFFICE' | 'CHARGING' | 'END';
  is_mandatory: boolean;           // Bắt buộc check-in
  notes?: string;
  /**
   * Chỉ có trên điểm dừng HIỆU LỰC (lấy từ phiếu đổi lộ trình đã duyệt):
   * id phiếu + sản phẩm áp dụng. Điểm dừng gốc không có 2 trường này.
   */
  change_request_id?: string;
  product_name?: string;
  created_at: string;
  updated_at: string;
  version: number;
}

/**
 * Điểm dừng trong phiếu đề xuất đổi lộ trình.
 * - `stop_id` giữ id điểm dừng gốc khi chỉ sửa điểm cũ (để check-in cũ khớp).
 * - Điểm mới thêm sẽ được cấp id dạng `RCS_<request_id>_<order>`.
 */
export interface EVRouteChangeStop {
  stop_id?: string;
  stop_order: number;
  name: string;
  branch_id?: string;
  address?: string;
  latitude: number;
  longitude: number;
  geofence_radius_m: number;
  sla_minutes: number;
  stop_type: EVRouteStop['stop_type'];
  is_mandatory: boolean;
  notes?: string;
}

export type EVRouteChangeStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/**
 * Phiếu đổi lộ trình giao sữa (Nhân sự/Kế toán tạo — Giám đốc ký duyệt).
 * Khi APPROVED, các ca có `shift_date` nằm trong [effective_from, effective_to]
 * sẽ dùng danh sách điểm dừng trong phiếu thay cho lộ trình gốc.
 */
export interface EVRouteChangeRequest {
  request_id: string;
  request_code?: string;            // VD: RCR-20261113-0001
  route_id: string;
  route_name: string;
  /** Sản phẩm áp dụng (VD: 'Sữa tươi 100%'). Rỗng = áp dụng chung cho lộ trình. */
  product_name?: string;
  effective_from: string;           // YYYY-MM-DD
  effective_to: string;             // YYYY-MM-DD
  reason?: string;
  status: EVRouteChangeStatus;
  stops: EVRouteChangeStop[];
  created_by: string;               // employee_id / username người tạo (Nhân sự / Kế toán)
  created_by_name?: string;
  submitted_at: string;
  approved_by?: string;             // Giám đốc
  approved_by_name?: string;
  approved_at?: string;
  approval_notes?: string;
  rejected_by?: string;
  rejected_by_name?: string;
  rejected_at?: string;
  rejected_reason?: string;
  cancelled_by?: string;
  cancelled_at?: string;
  cancel_reason?: string;
  version: number;
  created_at: string;
  updated_at: string;
}

/** Ca vận chuyển (Driver Assignment) */
export interface EVShift {
  shift_id: string;
  route_id: string;
  driver_id: string;               // Employee ID
  vehicle_id: string;
  shift_date: string;              // YYYY-MM-DD
  planned_start_at: string;        // ISO timestamp
  planned_end_at?: string;
  /** Sản phẩm của ca (VD: 'Sữa tươi 100%') — dùng để chọn phiếu đổi lộ trình phù hợp. */
  product_name?: string;
  actual_start_at?: string;
  actual_end_at?: string;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'CHARGING' | 'RETURNING' | 'COMPLETED' | 'CANCELLED' | 'PAUSED';
  total_distance_km?: number;
  total_duration_min?: number;
  penalty_points: number;          // Tổng điểm phạt
  penalty_amount: number;          // Tổng tiền phạt (VND)
  net_pay: number;                 // Thực nhận
  work_day_index?: number;         // Ngày công thứ mấy trong tháng (1-30)
  notes?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  version: number;
}

/** Check-in tại điểm dừng */
export interface EVShiftCheckin {
  checkin_id: string;
  shift_id: string;
  stop_id: string;
  stop_order: number;
  /** Tên điểm dừng tại thời điểm check-in (điểm dừng có thể đến từ phiếu đổi lộ trình). */
  stop_name?: string;
  checked_in_at: string;           // ISO timestamp
  latitude: number;
  longitude: number;
  distance_m: number;              // Khoảng cách Haversine đến tâm điểm
  is_within_geofence: boolean;     // ≤ geofence_radius_m
  sla_minutes: number;             // SLA của chặng này
  actual_travel_min: number;       // Thời gian di chuyển thực tế
  is_late: boolean;                // Vượt SLA?
  late_minutes: number;            // Số phút trễ
  penalty_amount: number;          // Tiền phạt chặng này
  is_missed: boolean;              // Quên không bấm (tự động phát hiện)
  notes?: string;
  created_at: string;
}

/** Phiếu sạc xe điện */
export interface EVChargingTicket {
  ticket_id: string;
  shift_id: string;
  driver_id: string;
  requested_date: string;          // YYYY-MM-DD
  battery_level_pct?: number;      // Mức pin khi tạo phiếu (%)
  notes?: string;
  status: 'DRAFT' | 'PENDING_HR' | 'PENDING_DIRECTOR' | 'APPROVED' | 'REJECTED' | 'USED' | 'EXPIRED';
  
  // Cấp 1: HR duyệt
  hr_approved_by?: string;
  hr_approved_at?: string;
  hr_notes?: string;
  
  // Cấp 2: Giám đốc duyệt
  director_approved_by?: string;
  director_approved_at?: string;
  director_notes?: string;
  
  // Thực tế sạc
  charging_start_at?: string;
  charging_end_at?: string;
  charging_latitude?: number;
  charging_longitude?: number;
  charging_station_name?: string;  // Reverse geocode
  charging_duration_min?: number;
  energy_charged_kwh?: number;
  
  created_at: string;
  updated_at: string;
}

/** GPS Tracking Point */
export interface EVGPSPoint {
  point_id: string;                // UUID
  shift_id: string;
  driver_id: string;
  vehicle_id: string;
  recorded_at: string;             // ISO timestamp
  latitude: number;
  longitude: number;
  accuracy_m?: number;
  speed_kmh?: number;
  heading?: number;                // 0-360 độ
  battery_pct?: number;
  is_mock: boolean;                // Chế độ giả lập
  created_at: string;
}

/** Bảng lương tài xế */
export interface EVDriverPayroll {
  payroll_id: string;
  driver_id: string;
  period: string;                  // YYYY-MM
  total_shifts: number;
  total_work_days: number;
  standard_days: number;           // Số ngày trong 28 ngày đầu
  extra_days: number;              // Số ngày trong 2 ngày cuối
  standard_pay: number;            // Lương 28 ngày chuẩn
  extra_pay: number;               // Lương 2 ngày cuối
  total_penalty_points: number;
  total_penalty_amount: number;
  penalty_breakdown: {
    missed_checkins: number;
    late_sla: number;
    details: Array<{
      date: string;
      stop_name?: string;
      leg?: string;
      type: 'MISSED_CHECKIN' | 'LATE_SLA';
      amount: number;
      late_minutes?: number;
    }>;
  };
  gross_pay: number;
  net_pay: number;
  status: 'DRAFT' | 'APPROVED' | 'PAID';
  created_by: string;
  approved_by?: string;
  approved_at?: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// PAYROLL CONFIG (Theo spec VAN_CHUYEN_SUA_UMBOMILK.md)
// ============================================================

export interface EVPayrollConfig {
  // Quỹ 28 ngày công chuẩn
  standard_monthly_salary: number;    // 6.000.000 VND
  standard_work_days: number;         // 28
  standard_daily_rate: number;        // 214.286 VND
  
  // Quỹ 2 ngày công cuối (ngày 29, 30)
  extra_monthly_salary: number;       // 500.000 VND
  extra_work_days: number;            // 2
  extra_daily_rate: number;           // 250.000 VND
  
  // Phạt theo % ngày công
  penalty_per_missed_checkin: {
    standard: number;  // 0.25 (25%)
    extra: number;     // 0.25 (25%)
  };
  penalty_per_late_sla: {
    standard: number;  // 0.10 (10%)
    extra: number;     // 0.10 (10%)
  };
  
  // SLA warnings
  sla_warning_minutes: number[];      // [10, 5, 1]
}

export const DEFAULT_EV_PAYROLL_CONFIG: EVPayrollConfig = {
  standard_monthly_salary: 6_000_000,
  standard_work_days: 28,
  standard_daily_rate: 214_286,
  extra_monthly_salary: 500_000,
  extra_work_days: 2,
  extra_daily_rate: 250_000,
  penalty_per_missed_checkin: {
    standard: 0.25,
    extra: 0.25,
  },
  penalty_per_late_sla: {
    standard: 0.10,
    extra: 0.10,
  },
  sla_warning_minutes: [10, 5, 1],
};

// ============================================================
// REALTIME WEBSOCKET EVENTS
// ============================================================

export type EVWSEventType =
  // Driver -> Server
  | 'ev:gps:update'
  | 'ev:shift:start'
  | 'ev:shift:checkin'
  | 'ev:shift:end'
  | 'ev:charging:start'
  | 'ev:charging:end'
  | 'ev:driver:status'
  // Server -> Clients
  | 'ev:live:shift:started'
  | 'ev:live:shift:checkin'
  | 'ev:live:shift:ended'
  | 'ev:live:gps:update'
  | 'ev:live:sla:warning'
  | 'ev:live:sla:violated'
  | 'ev:live:charging:started'
  | 'ev:live:charging:ended'
  | 'ev:live:charging-station'
  | 'ev:live:route-changed'
  | 'ev:live:ticket:status'
  | 'ev:live:payroll:updated';

export interface EVWSPayload<T = any> {
  event: EVWSEventType;
  timestamp: string;
  data: T;
  shiftId?: string;
  driverId?: string;
  vehicleId?: string;
}

export interface EVGPSUpdatePayload {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number;
  heading: number;
  battery: number;
  recordedAt: string;
  isMock: boolean;
  /** Xe nhận điểm GPS — có cả khi tài xế chưa vào ca (chỉ chia sẻ vị trí). */
  vehicleId?: string;
}

export interface EVCheckinPayload {
  stopId: string;
  stopOrder: number;
  latitude: number;
  longitude: number;
  distanceM: number;
  isWithinGeofence: boolean;
}

export interface EVSLAWarningPayload {
  shiftId: string;
  driverId: string;
  currentStopOrder: number;
  nextStopName: string;
  remainingMinutes: number;   // 10, 5, 1
  warningLevel: 'YELLOW' | 'ORANGE' | 'RED';
}

export interface EVChargingStatusPayload {
  ticketId: string;
  shiftId: string;
  driverId: string;
  status: 'APPROVED' | 'CHARGING' | 'COMPLETED' | 'REJECTED';
  chargingStartAt?: string;
  chargingEndAt?: string;
  stationName?: string;
}

// ============================================================
// API REQUEST/RESPONSE TYPES
// ============================================================

export interface EVStartShiftRequest {
  shiftId: string;
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface EVCheckinRequest {
  shiftId: string;
  stopId: string;
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface EVEndShiftRequest {
  shiftId: string;
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface EVCreateChargingTicketRequest {
  shiftId: string;
  requestedDate: string;       // YYYY-MM-DD
  batteryLevelPct?: number;
  notes?: string;
}

export interface EVStartChargingRequest {
  ticketId: string;
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface EVEndChargingRequest {
  ticketId: string;
}

export interface EVGpsBatchRequest {
  points: Array<{
    shiftId: string;
    recordedAt: string;
    latitude: number;
    longitude: number;
    accuracy?: number;
    speed?: number;
    heading?: number;
    battery?: number;
    isMock?: boolean;
  }>;
}

export interface EVLiveShiftSummary {
  shiftId: string;
  driverId: string;
  driverName: string;
  vehicleId: string;
  licensePlate: string;
  routeName: string;
  status: EVShift['status'];
  currentStopOrder: number;
  nextStopName: string;
  slaRemainingSeconds: number;
  lastGpsUpdate: string;
  latitude: number;
  longitude: number;
  speed: number;
  battery: number;
  penaltyPoints: number;
  penaltyAmount: number;
}

export interface EVShiftDetail extends EVShift {
  driverName: string;
  driverCode: string;
  vehiclePlate: string;
  routeName: string;
  stops: Array<EVRouteStop & {
    checkedInAt?: string;
    isCompleted: boolean;
    isLate: boolean;
    lateMinutes: number;
    penaltyAmount: number;
  }>;
}

export interface EVDriverDashboardData {
  currentShift: EVShiftDetail | null;
  todayShifts: EVShift[];
  pendingChargingTickets: EVChargingTicket[];
  recentPayroll: EVDriverPayroll[];
  stats: {
    totalShiftsThisMonth: number;
    totalPenaltyThisMonth: number;
    netPayThisMonth: number;
    onTimeRate: number;
  };
}