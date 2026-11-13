import { z } from 'zod';

// ============================================================
// MILKROUTE EV VALIDATORS
// ============================================================

// ID trong hệ thống không phải UUID thuần: vehicle/route/shift là uuidv4 nhưng
// driver_id/employee_id có dạng EMP_<timestamp>_<random> (xem employees.service).
// Vì vậy mọi id chỉ kiểm tra là chuỗi không rỗng (độ dài hợp lý).
const idSchema = z.string().min(1).max(64);

// Trạng thái ca vận chuyển (khớp EVShift.status trong @ubm/shared)
const evShiftStatus = z.enum([
  'SCHEDULED',
  'IN_PROGRESS',
  'CHARGING',
  'RETURNING',
  'COMPLETED',
  'CANCELLED',
  'PAUSED',
]);

// GPS Coordinates
const gpsCoordSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).optional(),
});

// EV Vehicle
export const evVehicleCreateBody = z.object({
  license_plate: z.string().min(1).max(20),
  frame_number: z.string().max(50).optional(),
  battery_capacity_kwh: z.number().positive().optional(),
  current_battery_pct: z.number().min(0).max(100).default(100),
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'RETIRED']).default('ACTIVE'),
  assigned_driver_id: idSchema.optional(),
  gps_device_id: z.string().optional(),
  notes: z.string().optional(),
});

export const evVehicleUpdateBody = z.object({
  license_plate: z.string().min(1).max(20).optional(),
  frame_number: z.string().max(50).optional(),
  battery_capacity_kwh: z.number().positive().optional(),
  current_battery_pct: z.number().min(0).max(100).optional(),
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'RETIRED']).optional(),
  assigned_driver_id: idSchema.nullable().optional(),
  gps_device_id: z.string().nullable().optional(),
  notes: z.string().optional(),
});

export const evVehicleIdParams = z.object({
  id: idSchema,
});

// EV Route
export const evRouteCreateBody = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  is_active: z.boolean().default(true),
  total_distance_km: z.number().positive().optional(),
  estimated_duration_min: z.number().positive().optional(),
});

export const evRouteUpdateBody = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  is_active: z.boolean().optional(),
  total_distance_km: z.number().positive().optional(),
  estimated_duration_min: z.number().positive().optional(),
});

export const evRouteIdParams = z.object({
  id: idSchema,
});

// EV Route Stop
export const evRouteStopCreateBody = z.object({
  route_id: idSchema,
  stop_order: z.number().int().positive(),
  name: z.string().min(1).max(100),
  branch_id: z.string().max(64).optional(),
  address: z.string().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  geofence_radius_m: z.number().int().positive().default(100),
  sla_minutes: z.number().int().nonnegative(),
  stop_type: z.enum(['START', 'DELIVERY', 'OFFICE', 'CHARGING', 'END']),
  is_mandatory: z.boolean().default(true),
  notes: z.string().optional(),
});

export const evRouteStopUpdateBody = z.object({
  route_id: idSchema.optional(),
  stop_order: z.number().int().positive().optional(),
  name: z.string().min(1).max(100).optional(),
  branch_id: z.string().max(64).optional(),
  address: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  geofence_radius_m: z.number().int().positive().optional(),
  sla_minutes: z.number().int().nonnegative().optional(),
  stop_type: z.enum(['START', 'DELIVERY', 'OFFICE', 'CHARGING', 'END']).optional(),
  is_mandatory: z.boolean().optional(),
  notes: z.string().optional(),
});

export const evRouteStopIdParams = z.object({
  id: idSchema,
});

export const evRouteStopsQuery = z.object({
  routeId: idSchema,
  /** Ngày hiệu lực (mặc định hôm nay) — trả điểm dừng sau khi áp phiếu đổi lộ trình. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  product_name: z.string().max(100).optional(),
  /** 'true' = lấy điểm dừng gốc (không áp phiếu đổi lộ trình). */
  base: z.enum(['true', 'false']).optional(),
});

// EV Shift
export const evShiftCreateBody = z.object({
  route_id: idSchema,
  driver_id: idSchema,
  vehicle_id: idSchema,
  shift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  planned_start_at: z.string().datetime(),
  planned_end_at: z.string().datetime().optional(),
  product_name: z.string().max(100).optional(),
  work_day_index: z.number().int().positive().optional(),
  notes: z.string().optional(),
});

export const evShiftUpdateBody = z.object({
  route_id: idSchema.optional(),
  driver_id: idSchema.optional(),
  vehicle_id: idSchema.optional(),
  shift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  planned_start_at: z.string().datetime().optional(),
  planned_end_at: z.string().datetime().optional(),
  product_name: z.string().max(100).optional(),
  status: evShiftStatus.optional(),
  work_day_index: z.number().int().positive().optional(),
  notes: z.string().optional(),
});

export const evShiftIdParams = z.object({
  id: idSchema,
});

export const evShiftsQuery = z.object({
  driver_id: idSchema.optional(),
  vehicle_id: idSchema.optional(),
  route_id: idSchema.optional(),
  status: evShiftStatus.optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

/** Tạo ca tự động cho cả tuần (mặc định 08:00–14:00, T2→CN). */
export const evShiftGenerateWeekBody = z.object({
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  driver_ids: z.array(idSchema).max(200).optional(),
  route_id: idSchema.optional(),
  vehicle_id: idSchema.optional(),
  start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  end_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  include_past: z.boolean().optional(),
});

// Driver Shift Actions
// accuracy: validator chỉ chặn giá trị vô lý; ngưỡng nghiệp vụ (≤120m khi
// bắt đầu/kết thúc ca, ≤30m khi bấm điểm) do service kiểm tra để trả thông báo
// tiếng Việt rõ ràng thay vì lỗi VALIDATION_ERROR khó hiểu.
export const evStartShiftBody = z.object({
  shift_id: idSchema,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(500),
});

export const evCheckinBody = z.object({
  shift_id: idSchema,
  stop_id: idSchema,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100),
});

export const evEndShiftBody = z.object({
  shift_id: idSchema,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(500),
});

// EV Charging Ticket
export const evChargingTicketCreateBody = z.object({
  shift_id: idSchema,
  requested_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  battery_level_pct: z.number().int().min(0).max(100).optional(),
  notes: z.string().optional(),
});

export const evChargingTicketApproveBody = z.object({
  notes: z.string().optional(),
});

export const evChargingTicketRejectBody = z.object({
  notes: z.string().min(1),
});

export const evChargingStartBody = z.object({
  ticket_id: idSchema,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  // Ngưỡng nghiệp vụ do service kiểm tra (GPS ghim trạm sạc).
  accuracy: z.number().min(0).max(500),
});

export const evChargingEndBody = z.object({
  ticket_id: idSchema,
});

export const evChargingTicketIdParams = z.object({
  id: idSchema,
});

export const evChargingTicketsQuery = z.object({
  status: z.enum(['DRAFT', 'PENDING_HR', 'PENDING_DIRECTOR', 'APPROVED', 'REJECTED', 'USED', 'EXPIRED']).optional(),
  driver_id: idSchema.optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

// GPS Batch
export const evGpsBatchBody = z.object({
  points: z.array(z.object({
    // Không bắt buộc: tài xế vừa đăng nhập app đã chia sẻ vị trí (chưa vào ca).
    shift_id: idSchema.optional(),
    recorded_at: z.string().datetime(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().min(0).optional(),
    speed: z.number().min(0).optional(),
    heading: z.number().min(0).max(360).optional(),
    battery: z.number().min(0).max(100).optional(),
    is_mock: z.boolean().optional(),
  })).min(1).max(500),
});

// Payroll
export const evPayrollGenerateBody = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  driver_ids: z.array(idSchema).optional(),
});

export const evPayrollApproveBody = z.object({
  payroll_id: z.string(),
});

export const evPayrollQuery = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  driver_id: idSchema.optional(),
  status: z.enum(['DRAFT', 'APPROVED', 'PAID']).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

// Live tracking
export const evLiveShiftsQuery = z.object({
  status: z.enum(['IN_PROGRESS', 'CHARGING', 'RETURNING']).optional(),
});

// ============================================================
// PHIẾU ĐỔI LỘ TRÌNH (tạo là có hiệu lực ngay; bước duyệt chỉ còn cho phiếu cũ)
// ============================================================

const evRouteChangeStopBody = z.object({
  stop_id: idSchema.optional(),
  stop_order: z.number().int().positive(),
  name: z.string().min(1).max(100),
  branch_id: z.string().max(64).optional(),
  address: z.string().max(300).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  geofence_radius_m: z.number().int().positive().default(100),
  sla_minutes: z.number().int().nonnegative().default(0),
  stop_type: z.enum(['START', 'DELIVERY', 'OFFICE', 'CHARGING', 'END']),
  is_mandatory: z.boolean().default(true),
  notes: z.string().max(500).optional(),
});

const evRouteChangeDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const evRouteChangeCreateBody = z.object({
  route_id: idSchema,
  product_name: z.string().max(100).optional(),
  effective_from: evRouteChangeDate,
  effective_to: evRouteChangeDate,
  reason: z.string().max(1000).optional(),
  stops: z.array(evRouteChangeStopBody).min(2).max(50),
});

export const evRouteChangeUpdateBody = z.object({
  product_name: z.string().max(100).optional(),
  effective_from: evRouteChangeDate.optional(),
  effective_to: evRouteChangeDate.optional(),
  reason: z.string().max(1000).optional(),
  stops: z.array(evRouteChangeStopBody).min(2).max(50).optional(),
});

export const evRouteChangeIdParams = z.object({
  id: idSchema,
});

export const evRouteChangeApproveBody = z.object({
  notes: z.string().max(1000).optional(),
});

export const evRouteChangeRejectBody = z.object({
  reason: z.string().min(1).max(1000),
});

export const evRouteChangeCancelBody = z.object({
  reason: z.string().max(1000).optional(),
});

export const evRouteChangeQuery = z.object({
  route_id: idSchema.optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  date: evRouteChangeDate.optional(),
  date_from: evRouteChangeDate.optional(),
  date_to: evRouteChangeDate.optional(),
  limit: z.coerce.number().int().positive().max(200).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});