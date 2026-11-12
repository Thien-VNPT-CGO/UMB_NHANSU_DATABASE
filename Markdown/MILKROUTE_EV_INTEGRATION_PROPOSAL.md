# MILKROUTE EV - TÍCH HỢP VÀO HỆ THỐNG UBM v1.0.0

> **Tài liệu kiến trúc giải pháp** cho module Vận chuyển sữa bằng Xe điện (MilkRoute EV) tích hợp vào hệ thống UBM hiện có.
> Bao gồm: Driver Mobile App, Real-time Tracking, EV Charging Workflow, SLA Monitoring, Payroll Integration, và RBAC cho 4 vai trò quan sát: **Admin - HR - Kế Toán - Giám Đốc**.

---

## 1. TỔNG QUAN KIẾN TRÚC HỆ THỐNG MỞ RỘNG

### 1.1. Sơ đồ tổng thể (System Context)

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           MILKROUTE EV ECOSYSTEM                                     │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ DRIVER APP   │    │  ADMIN WEB   │    │   HR PORTAL  │    │ FINANCE PORT │      │
│  │ (React Native│    │  (Existing)  │    │  (Existing)  │    │  (Existing)  │      │
│  │  / PWA)      │    │              │    │              │    │              │      │
│  │  NEW APP     │    │  +EV MODULE  │    │  +EV MODULE  │    │  +EV MODULE  │      │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
│         │                   │                   │                   │                │
│         │         ┌─────────┴─────────┐         │                   │                │
│         │         │   BACKEND API     │◄────────┴───────────────────┘                │
│         │         │  (Express/Node)   │                                            │
│         │         │  + WebSocket      │                                            │
│         │         │  + PostGIS        │                                            │
│         │         └────────┬──────────┘                                            │
│         │                  │                                                        │
│         │         ┌────────┴────────┐                                               │
│         │         │   POSTGRESQL    │                                               │
│         │         │  + PostGIS      │                                               │
│         │         │  (Primary DB)   │                                               │
│         │         └────────┬────────┘                                               │
│         │                  │                                                        │
│         │         ┌────────┴────────┐                                               │
│         └────────►│  GOOGLE SHEETS  │◄──── Existing sync (payroll, attendance)       │
│                   │   (Legacy Sync) │                                               │
│                   └─────────────────┘                                               │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2. Các App mới/cần mở rộng

| App | Trạng thái | Mô tả |
|-----|-----------|-------|
| `apps/driver-app` | **MỚI** | React Native (Expo) / PWA cho tài xế |
| `apps/admin-web` | **MỞ RỘNG** | Thêm module: Live Map, EV Charging Approval, SLA Dashboard |
| `apps/hr-portal` | **MỞ RỘNG** (tách từ admin-web hoặc route riêng) | Phê duyệt cấp 1 phiếu sạc, quản lý nhân viên vận chuyển |
| `apps/finance-portal` | **MỞ RỘNG** | Xem bảng lương tài xế, khấu trừ phạt tự động, xuất báo cáo |
| `apps/director-portal` | **MỞ RỘNG** | Phê duyệt cấp 2 phiếu sạc, xem báo cáo tổng quan |
| `apps/backend` | **MỞ RỘNG** | Module `milkroute`: GPS tracking, geofencing, charging workflow, SLA engine, payroll integration |

---

## 2. MỞ RỘNG HỆ THỐNG PHÂN QUYỀN (RBAC)

### 2.1. Roles mới cho MilkRoute EV

```typescript
// packages/shared/src/types/roles.ts - MỞ RỘNG

export type SystemRole = 
  | 'DIRECTOR' 
  | 'ADMIN' 
  | 'HR' 
  | 'FINANCE' 
  | 'STORE' 
  | 'MARKETING' 
  | 'IT' 
  | 'EMPLOYEE'
  // --- MILKROUTE EV ROLES ---
  | 'DRIVER'           // Tài xế xe điện (chỉ dùng Driver App)
  | 'FLEET_MANAGER';   // Quản lý đội xe (có thể gán cho ADMIN/HR)

export type UserPermission =
  // ... existing permissions
  // --- MILKROUTE EV PERMISSIONS ---
  | 'EV_SHIFT_VIEW'           // Xem ca vận chuyển realtime
  | 'EV_SHIFT_MANAGE'         // Tạo/sửa/xóa lịch chạy xe
  | 'EV_GPS_TRACK'            // Theo dõi GPS realtime trên bản đồ
  | 'EV_GEOFENCE_MANAGE'      // Cấu hình geofence 100m các điểm
  | 'EV_SLA_MONITOR'          // Giám sát SLA từng chặng
  | 'EV_CHARGING_APPROVE_L1'  // HR: Phê duyệt cấp 1 phiếu sạc
  | 'EV_CHARGING_APPROVE_L2'  // Director: Phê duyệt cấp 2 phiếu sạc
  | 'EV_CHARGING_VIEW'        // Xem danh sách phiếu sạc
  | 'EV_PAYROLL_VIEW'         // Xem bảng lương tài xế (có phạt)
  | 'EV_PAYROLL_CREATE'       // Tạo bảng lương tài xế (Finance)
  | 'EV_PAYROLL_APPROVE'      // Duyệt bảng lương tài xế
  | 'EV_REPORT_VIEW'          // Xem báo cáo vận chuyển
  | 'EV_VEHICLE_MANAGE';      // Quản lý xe điện (số khung, pin, bảo dưỡng)
```

### 2.2. Ma trận quyền theo vai trò (Permission Matrix)

| Permission | DRIVER | FLEET_MANAGER | HR | ADMIN | FINANCE | DIRECTOR |
|------------|:------:|:-------------:|:--:|:-----:|:-------:|:--------:|
| **EV_SHIFT_VIEW** | ✅ (own) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **EV_SHIFT_MANAGE** | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ |
| **EV_GPS_TRACK** | ✅ (own) | ✅ | ✅ | ✅ | ❌ | ✅ |
| **EV_GEOFENCE_MANAGE** | ❌ | ✅ | ❌ | ✅ | ❌ | ✅ |
| **EV_SLA_MONITOR** | ✅ (own) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **EV_CHARGING_APPROVE_L1** | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ |
| **EV_CHARGING_APPROVE_L2** | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| **EV_CHARGING_VIEW** | ✅ (own) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **EV_PAYROLL_VIEW** | ✅ (own) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **EV_PAYROLL_CREATE** | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| **EV_PAYROLL_APPROVE** | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| **EV_REPORT_VIEW** | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **EV_VEHICLE_MANAGE** | ❌ | ✅ | ❌ | ✅ | ❌ | ✅ |

### 2.3. Cập nhật `AuthUser` interface

```typescript
// packages/shared/src/types/roles.ts - MỞ RỘNG

export interface AuthUser {
  id: string;
  employeeId?: string;
  role: SystemRole;
  branchScope?: string; // '*' = all, hoặc 'CN130,CN261' cho driver
  phone: string;
  fullName: string;
  permissions: UserPermission[];
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
```

---

## 3. DATABASE SCHEMA (PostgreSQL + PostGIS)

### 3.1. Bảng cốt lõi (Core Tables)

```sql
-- 1. XE ĐIỆN (EV Vehicles)
CREATE TABLE ev_vehicles (
  vehicle_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_plate     VARCHAR(20) NOT NULL UNIQUE,  -- Biển số xe
  frame_number      VARCHAR(50) UNIQUE,           -- Số khung
  battery_capacity  INTEGER,                      -- Dung lượng pin (kWh)
  current_battery   INTEGER DEFAULT 100,          -- % pin hiện tại
  status            VARCHAR(20) DEFAULT 'ACTIVE', -- ACTIVE, MAINTENANCE, RETIRED
  assigned_driver_id UUID REFERENCES employees(employee_id),
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- 2. LỘ TRÌNH CỐ ĐỊNH (Fixed Routes)
CREATE TABLE ev_routes (
  route_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(100) NOT NULL,        -- 'MILK_ROUTE_HCM'
  description       TEXT,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- 3. ĐIỂM DỪNG TRÊN LỘ TRÌNH (Route Stops - Geofence)
CREATE TABLE ev_route_stops (
  stop_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id          UUID REFERENCES ev_routes(route_id),
  stop_order        INTEGER NOT NULL,             -- 1,2,3,4,5,6
  name              VARCHAR(100) NOT NULL,        -- 'Xưởng Sản Xuất', 'CH130', ...
  address           TEXT,
  latitude          DECIMAL(10,8) NOT NULL,
  longitude         DECIMAL(11,8) NOT NULL,
  geofence_radius_m INTEGER DEFAULT 100,          -- Bán kính geofence (m)
  sla_minutes       INTEGER,                      -- SLA đến điểm này (từ điểm trước)
  stop_type         VARCHAR(20) NOT NULL,         -- 'START', 'DELIVERY', 'OFFICE', 'CHARGING', 'END'
  is_mandatory      BOOLEAN DEFAULT true,         -- Bắt buộc phải check-in
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT unique_route_order UNIQUE (route_id, stop_order)
);

-- 4. CA VẬN CHUYỂN (Shifts - Driver Assignments)
CREATE TABLE ev_shifts (
  shift_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id          UUID REFERENCES ev_routes(route_id),
  driver_id         UUID REFERENCES employees(employee_id),
  vehicle_id        UUID REFERENCES ev_vehicles(vehicle_id),
  shift_date        DATE NOT NULL,
  planned_start_at  TIMESTAMPTZ NOT NULL,         -- Giờ dự kiến bắt đầu
  planned_end_at    TIMESTAMPTZ,                  -- Giờ dự kiến kết thúc
  actual_start_at   TIMESTAMPTZ,                  -- Thực tế bấm BẮT ĐẦU
  actual_end_at     TIMESTAMPTZ,                  -- Thực tế bấm KẾT THÚC
  status            VARCHAR(20) DEFAULT 'SCHEDULED', -- SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED
  total_distance_km DECIMAL(8,2),
  total_duration_min INTEGER,
  penalty_points    INTEGER DEFAULT 0,            -- Tổng điểm phạt
  penalty_amount    DECIMAL(12,2) DEFAULT 0,      -- Tổng tiền phạt (VND)
  net_pay           DECIMAL(12,2) DEFAULT 0,      -- Thực nhận
  notes             TEXT,
  created_by        UUID REFERENCES employees(employee_id),
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT unique_driver_date UNIQUE (driver_id, shift_date)
);

-- 5. CHECK-IN TẠI ĐIỂM DỪNG (Stop Check-ins)
CREATE TABLE ev_shift_checkins (
  checkin_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id          UUID REFERENCES ev_shifts(shift_id),
  stop_id           UUID REFERENCES ev_route_stops(stop_id),
  stop_order        INTEGER NOT NULL,
  checked_in_at     TIMESTAMPTZ NOT NULL,         -- Thời gian bấm xác nhận
  latitude          DECIMAL(10,8) NOT NULL,       -- GPS thực tế khi bấm
  longitude         DECIMAL(11,8) NOT NULL,
  distance_m        DECIMAL(8,2),                 -- Khoảng cách Haversine đến tâm điểm
  is_within_geofence BOOLEAN,                     -- ≤100m?
  sla_minutes       INTEGER,                      -- SLA của chặng này
  actual_travel_min INTEGER,                      -- Thời gian di chuyển thực tế
  is_late           BOOLEAN DEFAULT false,        -- Vượt SLA?
  late_minutes      INTEGER DEFAULT 0,            -- Số phút trễ
  penalty_amount    DECIMAL(10,2) DEFAULT 0,      -- Tiền phạt chặng này
  is_missed         BOOLEAN DEFAULT false,        -- Quên không bấm?
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- 6. PHIẾU SẠC XE ĐIỆN (EV Charging Tickets)
CREATE TABLE ev_charging_tickets (
  ticket_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id          UUID REFERENCES ev_shifts(shift_id),
  driver_id         UUID REFERENCES employees(employee_id),
  requested_date    DATE NOT NULL,                -- Ngày muốn sạc
  battery_level_pct INTEGER,                      -- Mức pin khi tạo phiếu (%)
  notes             TEXT,
  status            VARCHAR(20) DEFAULT 'DRAFT',  -- DRAFT, PENDING_HR, PENDING_DIRECTOR, APPROVED, REJECTED, USED, EXPIRED
  hr_approved_by    UUID REFERENCES employees(employee_id),
  hr_approved_at    TIMESTAMPTZ,
  hr_notes          TEXT,
  director_approved_by UUID REFERENCES employees(employee_id),
  director_approved_at TIMESTAMPTZ,
  director_notes    TEXT,
  
  -- Thực tế sạc
  charging_start_at TIMESTAMPTZ,                  -- Bấm BẮT ĐẦU SẠC
  charging_end_at   TIMESTAMPTZ,                  -- Bấm ĐÃ SẠC XONG
  charging_latitude DECIMAL(10,8),                -- Tọa độ trạm sạc (lock khi bấm bắt đầu)
  charging_longitude DECIMAL(11,8),
  charging_station_name VARCHAR(200),             -- Reverse geocode tên trạm
  charging_duration_min INTEGER,                  -- Phút sạc thực tế
  
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- 7. GPS TRACKING POINTS (Raw GPS - partitioned by date)
CREATE TABLE ev_gps_points (
  point_id          BIGSERIAL,
  shift_id          UUID REFERENCES ev_shifts(shift_id),
  driver_id         UUID REFERENCES employees(employee_id),
  vehicle_id        UUID REFERENCES ev_vehicles(vehicle_id),
  recorded_at       TIMESTAMPTZ NOT NULL,
  latitude          DECIMAL(10,8) NOT NULL,
  longitude         DECIMAL(11,8) NOT NULL,
  accuracy_m        DECIMAL(6,2),
  speed_kmh         DECIMAL(6,2),
  heading           DECIMAL(5,2),
  battery_pct       INTEGER,
  is_mock           BOOLEAN DEFAULT false,        -- Chế độ giả lập
  created_at        TIMESTAMPTZ DEFAULT now()
) PARTITION BY RANGE (recorded_at);

-- Partition theo tháng (tạo tự động qua pg_partman hoặc script)
-- CREATE TABLE ev_gps_points_2026_01 PARTITION OF ev_gps_points FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
-- CREATE INDEX ON ev_gps_points_2026_01 (shift_id, recorded_at);

-- 8. BẢNG LƯƠNG TÀI XẾ (Driver Payroll - tích hợp với payroll hiện có)
CREATE TABLE ev_driver_payroll (
  payroll_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id         UUID REFERENCES employees(employee_id),
  period            VARCHAR(7) NOT NULL,          -- YYYY-MM
  total_shifts      INTEGER DEFAULT 0,
  total_work_days   INTEGER DEFAULT 0,            -- Số ngày công (28 ngày chuẩn + 2 ngày cuối)
  standard_pay      DECIMAL(12,2) DEFAULT 0,      -- Lương chuẩn (6.000.000 / 28 * ngày công)
  extra_pay         DECIMAL(12,2) DEFAULT 0,      -- Lương 2 ngày cuối (500.000 / 2 * ngày công)
  total_penalty_points INTEGER DEFAULT 0,
  total_penalty_amount DECIMAL(12,2) DEFAULT 0,
  penalty_breakdown JSONB,                        -- Chi tiết: {missed_checkins: 2, late_sla: 3, ...}
  net_pay           DECIMAL(12,2) DEFAULT 0,
  status            VARCHAR(20) DEFAULT 'DRAFT',  -- DRAFT, APPROVED, PAID
  created_by        UUID REFERENCES employees(employee_id),
  approved_by       UUID REFERENCES employees(employee_id),
  approved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT unique_driver_period UNIQUE (driver_id, period)
);
```

### 3.2. Indexes quan trọng

```sql
-- Performance indexes
CREATE INDEX idx_ev_shifts_driver_date ON ev_shifts(driver_id, shift_date);
CREATE INDEX idx_ev_shifts_status ON ev_shifts(status);
CREATE INDEX idx_ev_checkins_shift ON ev_shift_checkins(shift_id, stop_order);
CREATE INDEX idx_ev_tickets_driver_status ON ev_charging_tickets(driver_id, status);
CREATE INDEX idx_ev_gps_shift_time ON ev_gps_points(shift_id, recorded_at);
CREATE INDEX idx_ev_gps_driver_time ON ev_gps_points(driver_id, recorded_at);

-- PostGIS indexes (nếu dùng geography type)
ALTER TABLE ev_route_stops ADD COLUMN geom geography(POINT, 4326);
UPDATE ev_route_stops SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326);
CREATE INDEX idx_ev_stops_geom ON ev_route_stops USING GIST(geom);

ALTER TABLE ev_gps_points ADD COLUMN geom geography(POINT, 4326);
UPDATE ev_gps_points SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326);
CREATE INDEX idx_ev_gps_geom ON ev_gps_points USING GIST(geom);
```

---

## 4. BACKEND API DESIGN (REST + WebSocket)

### 4.1. REST Endpoints

```
# ============================================================
# DRIVER APP ENDPOINTS (Authentication: Driver JWT)
# ============================================================

POST   /api/v1/ev/auth/login              # Login: employee_code + PIN
POST   /api/v1/ev/auth/refresh            # Refresh token
GET    /api/v1/ev/shifts/current          # Ca hôm nay (hoặc ca sắp tới)
GET    /api/v1/ev/shifts/:shiftId         # Chi tiết ca
POST   /api/v1/ev/shifts/:shiftId/start   # BẮT ĐẦU CA (validate geofence Xưởng)
POST   /api/v1/ev/shifts/:shiftId/checkin # XÁC NHẬN ĐIỂM (validate geofence 100m)
POST   /api/v1/ev/shifts/:shiftId/end     # KẾT THÚC CA (validate geofence Xưởng)
GET    /api/v1/ev/routes/:routeId/stops   # Danh sách điểm dừng + geofence

# Phiếu sạc
GET    /api/v1/ev/charging-tickets        # Danh sách phiếu của tôi
POST   /api/v1/ev/charging-tickets        # Tạo phiếu mới
GET    /api/v1/ev/charging-tickets/:id    # Chi tiết phiếu
POST   /api/v1/ev/charging-tickets/:id/start-charging  # BẮT ĐẦU SẠC (lock GPS)
POST   /api/v1/ev/charging-tickets/:id/end-charging    # ĐÃ SẠC XONG

# GPS Tracking (Batch upload - offline sync)
POST   /api/v1/ev/gps/batch               # Gửi batch GPS points (từ IndexedDB)
GET    /api/v1/ev/gps/config              # Cấu hình tracking interval

# Bảng lương
GET    /api/v1/ev/payroll/me              # Bảng lương của tôi (theo kỳ)
GET    /api/v1/ev/payroll/me/:period      # Chi tiết kỳ

# ============================================================
# ADMIN/HR/FINANCE/DIRECTOR ENDPOINTS (Role-based auth)
# ============================================================

# Quản lý xe
GET    /api/v1/ev/admin/vehicles
POST   /api/v1/ev/admin/vehicles
PATCH  /api/v1/ev/admin/vehicles/:id
DELETE /api/v1/ev/admin/vehicles/:id

# Quản lý lộ trình
GET    /api/v1/ev/admin/routes
POST   /api/v1/ev/admin/routes
PATCH  /api/v1/ev/admin/routes/:id
GET    /api/v1/ev/admin/routes/:id/stops
POST   /api/v1/ev/admin/routes/:id/stops
PATCH  /api/v1/ev/admin/routes/:id/stops/:stopId

# Quản lý ca (Schedule)
GET    /api/v1/ev/admin/shifts
POST   /api/v1/ev/admin/shifts            # Tạo ca cho tài xế
PATCH  /api/v1/ev/admin/shifts/:id
DELETE /api/v1/ev/admin/shifts/:id

# Theo dõi realtime (Admin Map)
GET    /api/v1/ev/admin/live/shifts       # Danh sách ca đang chạy
GET    /api/v1/ev/admin/live/shifts/:id/gps-history  # Lịch sử GPS của ca
GET    /api/v1/ev/admin/live/vehicles     # Vị trí tất cả xe realtime

# Phiếu sạc - Phê duyệt
GET    /api/v1/ev/admin/charging-tickets           # Tất cả phiếu (filter status)
PATCH  /api/v1/ev/admin/charging-tickets/:id/approve-hr     # HR duyệt cấp 1
PATCH  /api/v1/ev/admin/charging-tickets/:id/approve-director # GĐ duyệt cấp 2
PATCH  /api/v1/ev/admin/charging-tickets/:id/reject         # Từ chối

# Báo cáo & Bảng lương
GET    /api/v1/ev/admin/reports/shifts              # Báo cáo ca
GET    /api/v1/ev/admin/reports/sla                 # Báo cáo SLA
GET    /api/v1/ev/admin/reports/charging            # Báo cáo sạc xe
GET    /api/v1/ev/admin/payroll                     # Danh sách bảng lương tài xế
POST   /api/v1/ev/admin/payroll/generate            # Tạo bảng lương kỳ (Finance)
PATCH  /api/v1/ev/admin/payroll/:id/approve         # Duyệt bảng lương
GET    /api/v1/ev/admin/payroll/:id/export          # Xuất Excel/PDF
```

### 4.2. WebSocket Events (Real-time)

```typescript
// Shared types for WebSocket
// packages/shared/src/types/milkroute-ws.ts

export type WSEventType = 
  // Driver -> Server
  | 'gps:update'              // Driver gửi GPS realtime
  | 'shift:start'             // Driver bấm BẮT ĐẦU
  | 'shift:checkin'           // Driver bấm XÁC NHẬN
  | 'shift:end'               // Driver bấm KẾT THÚC
  | 'charging:start'          // Driver bấm BẮT ĐẦU SẠC
  | 'charging:end'            // Driver bấm ĐÃ SẠC XONG
  | 'driver:status'           // Driver online/offline
  
  // Server -> Admin/HR/Finance/Director
  | 'live:shift:started'      // Ca bắt đầu
  | 'live:shift:checkin'      // Check-in tại điểm
  | 'live:shift:ended'        // Ca kết thúc
  | 'live:gps:update'         // GPS realtime của 1 xe
  | 'live:sla:warning'        // Cảnh báo SLA sắp hết (10p, 5p, 1p)
  | 'live:sla:violated'       // Vi phạm SLA
  | 'live:charging:started'   // Bắt đầu sạc
  | 'live:charging:ended'     // Kết thúc sạc
  | 'live:ticket:status'      // Phiếu sạc đổi trạng thái
  | 'live:payroll:updated';   // Bảng lương cập nhật

export interface WSPayload<T = any> {
  event: WSEventType;
  timestamp: string; // ISO
  data: T;
  shiftId?: string;
  driverId?: string;
  vehicleId?: string;
}

// GPS Update payload (từ Driver App)
export interface GPSUpdatePayload {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number;
  heading: number;
  battery: number;
  recordedAt: string;
  isMock: boolean;
}

// Check-in payload
export interface CheckinPayload {
  stopId: string;
  stopOrder: number;
  latitude: number;
  longitude: number;
  distanceM: number;
  isWithinGeofence: boolean;
}

// SLA Warning payload
export interface SLAWarningPayload {
  shiftId: string;
  currentStopOrder: number;
  nextStopName: string;
  remainingMinutes: number; // 10, 5, 1
  warningLevel: 'YELLOW' | 'ORANGE' | 'RED';
}
```

### 4.3. Backend Services mới (Module `milkroute`)

```
apps/backend/src/services/milkroute/
├── ev-vehicle.service.ts           # CRUD xe điện
├── ev-route.service.ts             # CRUD lộ trình, geofence
├── ev-shift.service.ts             # Quản lý ca, assign driver
├── ev-checkin.service.ts           # Xử lý check-in, Haversine, SLA
├── ev-charging.service.ts          # Workflow phiếu sạc 2 cấp
├── ev-gps.service.ts               # Ingest GPS, batch, realtime broadcast
├── ev-sla-engine.service.ts        # Tính toán SLA, cảnh báo, phạt
├── ev-payroll.service.ts           # Tính lương tài xế, tích hợp penalty
├── ev-realtime.service.ts          # WebSocket broadcast, room management
└── milkroute.module.ts             # NestJS/Express module registration
```

---

## 5. DRIVER MOBILE APP (apps/driver-app)

### 5.1. Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | **React Native (Expo SDK 51+)** + **Expo Router** |
| Language | TypeScript (strict mode) |
| State | **Zustand** + **React Query (TanStack Query)** |
| Maps | **react-native-maps** (iOS: Apple Maps / Android: Google Maps) + **Web fallback: Leaflet** |
| GPS | **expo-location** (managed) → **react-native-background-geolocation** (bare workflow cho production) |
| Offline | **WatermelonDB** (SQLite) + **Sync Engine** |
| Push | **Expo Push Notifications** (FCM/APNs) |
| UI | **NativeWind** (Tailwind CSS for RN) + **React Native Reanimated** |
| Auth | **expo-secure-store** (JWT storage) + **expo-local-authentication** (Biometric) |
| Build | **EAS Build** (Expo Application Services) |

### 5.2. Cấu trúc thư mục

```
apps/driver-app/
├── app/
│   ├── (auth)/
│   │   ├── login.tsx
│   │   └── pin-setup.tsx
│   ├── (tabs)/
│   │   ├── _layout.tsx              # Tab navigator
│   │   ├── home.tsx                 # Dashboard ca hiện tại
│   │   ├── live.tsx                 # Bản đồ realtime (full screen)
│   │   ├── charging.tsx             # Phiếu sạc
│   │   ├── history.tsx              # Lịch sử ca / Bảng lương
│   │   └── profile.tsx              # Hồ sơ, cài đặt
│   ├── shift/
│   │   ├── [shiftId].tsx            # Chi tiết ca (check-in flow)
│   │   └── checkin/[stopId].tsx     # Màn hình xác nhận điểm
│   ├── charging/
│   │   ├── create.tsx               # Tạo phiếu sạc
│   │   ├── detail/[id].tsx          # Chi tiết phiếu + nút sạc
│   │   └── scanning.tsx             # Quét QR trạm sạc (optional)
│   └── _layout.tsx                  # Root layout + providers
├── src/
│   ├── components/
│   │   ├── map/
│   │   │   ├── DriverMapView.tsx    # Bản đồ full screen
│   │   │   ├── RoutePolyline.tsx    # Vẽ đường đi
│   │   │   ├── GeofenceCircles.tsx  # Vòng tròn 100m
│   │   │   ├── VehicleMarker.tsx    # Icon xe điện + heading
│   │   │   └── SLACountdown.tsx     # Timer SLA overlay
│   │   ├── ui/
│   │   │   ├── PrimaryButton.tsx
│   │   │   ├── StatusBadge.tsx
│   │   │   ├── PenaltyAlert.tsx
│   │   │   └── OfflineBanner.tsx
│   │   └── forms/
│   │       ├── ChargingTicketForm.tsx
│   │       └── PinInput.tsx
│   ├── hooks/
│   │   ├── useGPS.ts                # watchPosition + background
│   │   ├── useShift.ts              # Shift state machine
│   │   ├── useGeofence.ts           # Haversine calculation
│   │   ├── useOfflineSync.ts        # WatermelonDB sync
│   │   ├── usePushNotifications.ts  # FCM/APNs handling
│   │   └── useBatteryOptimization.ts # Adaptive interval
│   ├── services/
│   │   ├── api.ts                   # Axios + interceptors
│   │   ├── ws.ts                    # WebSocket client
│   │   ├── storage.ts               # SecureStore + MMKV
│   │   └── database.ts              # WatermelonDB schema
│   ├── store/
│   │   ├── authStore.ts
│   │   ├── shiftStore.ts
│   │   ├── gpsStore.ts
│   │   └── chargingStore.ts
│   ├── utils/
│   │   ├── haversine.ts             # Tính khoảng cách GPS
│   │   ├── dateHelpers.ts
│   │   ├── formatCurrency.ts
│   │   └── validators.ts
│   └── types/
│       ├── shift.ts
│       ├── charging.ts
│       └── payroll.ts
├── assets/
├── eas.json
├── app.config.ts
└── package.json
```

### 5.3. State Machine cho Ca làm việc (Shift State Machine)

```typescript
// src/store/shiftStore.ts

type ShiftStatus = 
  | 'SCHEDULED'       // Ca đã phân, chưa bắt đầu
  | 'STARTING'        // Đang validate geofence Xưởng
  | 'IN_PROGRESS'     // Đang chạy, giữa các điểm
  | 'ARRIVED_STOP'    // Đã vào geofence điểm, chờ bấm xác nhận
  | 'CHECKED_IN'      // Vừa bấm xác nhận, chờ chuyển điểm tiếp
  | 'CHARGING_PENDING'// Đã giao xong VP, chờ phiếu sạc duyệt
  | 'CHARGING'        // Đang sạc xe
  | 'RETURNING'       // Đang về Xưởng (sau sạc)
  | 'ENDING'          // Validate geofence Xưởng để kết thúc
  | 'COMPLETED'       // Đã kết thúc ca
  | 'CANCELLED';

interface ShiftState {
  currentShift: Shift | null;
  status: ShiftStatus;
  currentStopOrder: number;
  nextStop: RouteStop | null;
  slaRemainingSeconds: number;
  isWithinGeofence: boolean;
  gpsAccuracy: number;
  penaltyWarnings: PenaltyWarning[];
  
  // Actions
  startShift: () => Promise<void>;
  checkinStop: (stopId: string) => Promise<void>;
  endShift: () => Promise<void>;
  updateGPS: (coord: GPSPoint) => void;
  updateSLATimer: () => void;
}
```

### 5.4. Offline-First GPS Sync Strategy

```typescript
// src/hooks/useOfflineSync.ts

// 1. GPS points lưu vào WatermelonDB (SQLite) ngay lập tức
// 2. Background sync mỗi 30s khi online
// 3. Batch upload: max 100 points/request
// 4. Retry exponential backoff: 1s, 2s, 4s, 8s, 30s, 60s
// 5. Priority queue: check-in points > GPS points

interface SyncQueueItem {
  id: string;
  type: 'CHECKIN' | 'GPS_BATCH' | 'CHARGING_START' | 'CHARGING_END' | 'SHIFT_START' | 'SHIFT_END';
  payload: any;
  priority: number; // 1=highest
  retries: number;
  createdAt: number;
}

// WatermelonDB schema
const schema = {
  version: 1,
  tables: [
    {
      name: 'gps_points',
      columns: [
        { name: 'shift_id', type: 'string', isIndexed: true },
        { name: 'recorded_at', type: 'number', isIndexed: true }, // timestamp
        { name: 'latitude', type: 'number' },
        { name: 'longitude', type: 'number' },
        { name: 'accuracy', type: 'number' },
        { name: 'speed', type: 'number' },
        { name: 'heading', type: 'number' },
        { name: 'battery', type: 'number' },
        { name: 'is_mock', type: 'boolean' },
        { name: 'synced', type: 'boolean', isIndexed: true },
      ],
    },
    {
      name: 'sync_queue',
      columns: [
        { name: 'type', type: 'string', isIndexed: true },
        { name: 'payload', type: 'string' }, // JSON
        { name: 'priority', type: 'number' },
        { name: 'retries', type: 'number' },
        { name: 'created_at', type: 'number' },
      ],
    },
  ],
};
```

---

## 6. ADMIN/HR/FINANCE/DIRECTOR WEB MODULES

### 6.1. Admin Web - Live Map Dashboard (`apps/admin-web/src/pages/EVLiveMap.tsx`)

```tsx
// Features:
// - Google Maps / Leaflet full screen
// - Real-time vehicle markers (WebSocket)
// - Route polyline đã đi (màu xanh/đỏ theo SLA)
// - Geofence circles 100m tại 5 điểm
// - Sidebar: Danh sách ca đang chạy
// - Click xe → xem chi tiết: speed, battery, next stop, SLA countdown
// - Replay ca đã xong (time-slider)
// - Export GPS track (GPX/KML)
```

### 6.2. HR Portal - Phê duyệt Phiếu Sạc Cấp 1 (`apps/hr-portal/src/pages/EVChargingApproval.tsx`)

```tsx
// Features:
// - Danh sách phiếu: PENDING_HR (cần duyệt), APPROVED, REJECTED
// - Xem chi tiết: nhân viên, ngày sạc, mức pin, ca liên quan
// - Nút: [DUYỆT] / [TỪ CHỐI + lý do]
// - Realtime notification khi Driver tạo phiếu mới
// - Filter theo ngày, nhân viên, trạng thái
```

### 6.3. Director Portal - Phê duyệt Phiếu Sạc Cấp 2 (`apps/director-portal/src/pages/EVChargingApproval.tsx`)

```tsx
// Giống HR nhưng chỉ thấy phiếu PENDING_DIRECTOR
// Có quyền OVERVIEW: xem tất cả phiếu, báo cáo sạc xe tháng
```

### 6.4. Finance Portal - Bảng Lương Tài Xế (`apps/finance-portal/src/pages/EVDriverPayroll.tsx`)

```tsx
// Features:
// - Tạo bảng lương tháng cho nhóm tài xế (tự động tính từ ev_shifts + ev_shift_checkins)
// - Hiển thị breakdown: 28 ngày chuẩn / 2 ngày cuối
// - Chi tiết phạt: thiếu check-in, trễ SLA
// - Nút: [TẠO BẢNG LƯƠNG] → [DUYỆT] → [XUẤT EXCEL/PDF] → [ĐÃ CHUYỂN KHOÁN]
// - Tích hợp với payroll hiện có (PayslipItem, PayrollRun)
// - VietQR động cho từng phiếu lương
```

---

## 7. TÍCH HỢP PAYROLL (QUAN TRỌNG)

### 7.1. Logic tính lương tài xế (theo spec VAN_CHUYEN_SUA_UMBOMILK.md)

```typescript
// apps/backend/src/services/milkroute/ev-payroll.service.ts

interface DriverPayrollConfig {
  // Quỹ 28 ngày công chuẩn
  standardMonthlySalary: 6_000_000;      // VND
  standardWorkDays: 28;
  standardDailyRate: 214_286;            // 6M / 28
  
  // Quỹ 2 ngày công cuối (ngày 29, 30)
  extraMonthlySalary: 500_000;           // VND
  extraWorkDays: 2;
  extraDailyRate: 250_000;               // 500k / 2
  
  // Phạt theo % ngày công
  penaltyPerMissedCheckin: {
    standard: 0.25,  // 25% ngày công chuẩn = 53,571đ
    extra: 0.25,     // 25% ngày công cuối = 62,500đ
  };
  penaltyPerLateSLA: {
    standard: 0.10,  // 10% ngày công chuẩn = 21,429đ
    extra: 0.10,     // 10% ngày công cuối = 25,000đ
  };
}

function calculateDriverPayroll(
  driverId: string,
  period: string, // YYYY-MM
  shifts: EVShift[],
  checkins: EVShiftCheckin[],
  config: DriverPayrollConfig
): DriverPayrollResult {
  
  // 1. Xác định ngày công chuẩn vs ngày công cuối
  const workDaysInPeriod = getWorkDaysInPeriod(period); // Từ lịch làm việc
  const standardDays = Math.min(workDaysInPeriod, 28);
  const extraDays = Math.max(0, workDaysInPeriod - 28);
  
  // 2. Lương cơ bản
  const standardPay = standardDays * config.standardDailyRate;
  const extraPay = extraDays * config.extraDailyRate;
  const grossPay = standardPay + extraPay;
  
  // 3. Tính phạt từ checkins
  let totalPenalty = 0;
  const penaltyBreakdown = {
    missedCheckins: 0,
    lateSLA: 0,
    details: [] as PenaltyDetail[],
  };
  
  for (const shift of shifts) {
    const isExtraDay = shift.workDayIndex > 28; // Cần track workDayIndex
    const dailyRate = isExtraDay ? config.extraDailyRate : config.standardDailyRate;
    const missedPenalty = dailyRate * config.penaltyPerMissedCheckin[isExtraDay ? 'extra' : 'standard'];
    const latePenalty = dailyRate * config.penaltyPerLateSLA[isExtraDay ? 'extra' : 'standard'];
    
    for (const checkin of shift.checkins) {
      if (checkin.is_missed) {
        totalPenalty += missedPenalty;
        penaltyBreakdown.missedCheckins++;
        penaltyBreakdown.details.push({
          date: shift.shift_date,
          stop: checkin.stop_name,
          type: 'MISSED_CHECKIN',
          amount: missedPenalty,
        });
      }
      if (checkin.is_late) {
        totalPenalty += latePenalty;
        penaltyBreakdown.lateSLA++;
        penaltyBreakdown.details.push({
          date: shift.shift_date,
          leg: `${checkin.prev_stop} → ${checkin.stop_name}`,
          type: 'LATE_SLA',
          lateMinutes: checkin.late_minutes,
          amount: latePenalty,
        });
      }
    }
  }
  
  // 4. Thực nhận
  const netPay = Math.max(0, grossPay - totalPenalty);
  
  return {
    driverId,
    period,
    workDays: workDaysInPeriod,
    standardDays,
    extraDays,
    standardPay,
    extraPay,
    grossPay,
    totalPenalty,
    penaltyBreakdown,
    netPay,
  };
}
```

### 7.2. Tích hợp với `PayrollRun` & `PayslipItem` hiện có

```typescript
// Mapping: ev_driver_payroll → PayrollRun + PayslipItem

// Khi Finance tạo bảng lương tháng:
// 1. Gọi ev-payroll.service.calculateForAllDrivers(period)
// 2. Tạo PayrollRun mới (branch_scope = 'EV_DRIVERS')
// 3. Tạo PayslipItem cho từng tài xế:
//    - standard_pay = standardPay + extraPay
//    - deduction = totalPenalty
//    - net_pay = netPay
//    - input_note = JSON.stringify(penaltyBreakdown)
// 4. Quý trình ký 3 bên: KT ký → GĐ ký → Gửi NV → NV ký → KT chuyển khoản
// 5. Sync sang Google Sheets (tab LƯƠNG_TÀI_XẾ)
```

---

## 8. REAL-TIME ARCHITECTURE (WebSocket + Redis)

### 8.1. Redis Pub/Sub cho WebSocket Scaling

```typescript
// apps/backend/src/services/milkroute/ev-realtime.service.ts

// Room naming convention:
// - `shift:{shiftId}` - Driver + Admin xem ca cụ thể
// - `driver:{driverId}` - Private room cho driver
// - `admin:live` - Admin dashboard (all live shifts)
// - `hr:charging` - HR phê duyệt phiếu sạc
// - `director:charging` - Director phê duyệt phiếu sạc
// - `finance:payroll` - Finance bảng lương

class EVRealtimeService {
  private io: Server;
  private redis: Redis;
  
  // Broadcast GPS cho Admin map
  async broadcastGPSUpdate(shiftId: string, gps: GPSPoint) {
    const payload: WSPayload<GPSUpdatePayload> = {
      event: 'live:gps:update',
      timestamp: new Date().toISOString(),
      data: gps,
      shiftId,
    };
    
    // Gửi tới room admin:live
    this.io.to('admin:live').emit('live:gps:update', payload);
    
    // Gửi tới room shift specific
    this.io.to(`shift:${shiftId}`).emit('live:gps:update', payload);
    
    // Publish to Redis cho horizontal scaling
    await this.redis.publish('ws:gps', JSON.stringify({ room: `shift:${shiftId}`, payload }));
    await this.redis.publish('ws:gps', JSON.stringify({ room: 'admin:live', payload }));
  }
  
  // SLA Warning broadcast
  async broadcastSLAWarning(shiftId: string, warning: SLAWarningPayload) {
    const payload: WSPayload<SLAWarningPayload> = {
      event: 'live:sla:warning',
      timestamp: new Date().toISOString(),
      data: warning,
      shiftId,
    };
    
    // Driver app nhận cảnh báo (push notification + in-app)
    this.io.to(`driver:${warning.driverId}`).emit('live:sla:warning', payload);
    this.io.to(`shift:${shiftId}`).emit('live:sla:warning', payload);
    this.io.to('admin:live').emit('live:sla:warning', payload);
  }
}
```

### 8.2. Horizontal Scaling (Multi-instance Backend)

```yaml
# docker-compose.yml - Backend scaling
services:
  backend:
    build: ./apps/backend
    deploy:
      replicas: 3
    environment:
      - REDIS_URL=redis://redis:6379
      - WS_ADAPTER=redis  # Socket.io Redis adapter
    depends_on:
      - redis
  
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
```

---

## 9. TRIỂN KHAI VÀ DEVOPS

### 9.1. Monorepo Structure (Mở rộng)

```
UBM_v1.0.0/
├── apps/
│   ├── admin-web/          # Existing + EV modules
│   ├── employee-web/       # Existing
│   ├── hr-portal/          # NEW (hoặc route /hr trong admin-web)
│   ├── finance-portal/     # NEW (hoặc route /finance trong admin-web)
│   ├── director-portal/    # NEW (hoặc route /director trong admin-web)
│   ├── driver-app/         # NEW - React Native (Expo)
│   └── backend/            # Existing + milkroute module
├── packages/
│   ├── shared/             # Existing + milkroute types
│   ├── ui/                 # NEW - Shared UI components (Tailwind/React)
│   └── config/             # NEW - Shared ESLint, TSConfig, Tailwind
├── docker-compose.yml
├── docker-compose.prod.yml
└── turbo.json              # Turborepo config
```

### 9.2. CI/CD Pipeline (GitHub Actions)

```yaml
# .github/workflows/ci.yml
jobs:
  # Shared packages
  shared:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: cd packages/shared && npm ci && npm run build && npm test

  # Backend
  backend:
    needs: shared
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgis/postgis:16-3.4
        env:
          POSTGRES_DB: ubm
          POSTGRES_PASSWORD: test
        ports: [5432:5432]
      redis:
        image: redis:7-alpine
        ports: [6379:6379]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: cd apps/backend && npm ci && npm run build && npm test
      - run: cd apps/backend && npm run db:migrate:test

  # Admin Web
  admin-web:
    needs: shared
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: cd apps/admin-web && npm ci && npm run build && npm test

  # Driver App (Expo EAS)
  driver-app:
    needs: shared
    runs-on: macos-latest  # iOS build cần macOS
    steps:
      - uses: actions/checkout@v4
      - uses: expo/expo-github-action@v8
      - run: cd apps/driver-app && npm ci
      - run: cd apps/driver-app && npx expo-doctor
      # Build preview
      - run: cd apps/driver-app && eas build --platform android --profile preview --non-interactive
      - run: cd apps/driver-app && eas build --platform ios --profile preview --non-interactive
```

### 9.3. Environment Variables

```bash
# .env.milkroute (Backend)
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/ubm?schema=public
REDIS_URL=redis://localhost:6379

# Google Maps
GOOGLE_MAPS_API_KEY=AIza...
GOOGLE_MAPS_TILE_URL=https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}

# OSRM Routing
OSRM_BASE_URL=http://router.project-osrm.org

# Expo Push Notifications
EXPO_PROJECT_ID=@ubm/milkroute
EXPO_ACCESS_TOKEN=...

# WebSocket
WS_PORT=3001
WS_ADAPTER=redis

# Driver App
DRIVER_APP_SCHEME=ubm-milkroute
DRIVER_APP_BUNDLE_ID=com.ubm.milkroute.driver
DRIVER_APP_PACKAGE=com.ubm.milkroute.driver

# Feature Flags
ENABLE_MOCK_GPS=true
ENABLE_BACKGROUND_TRACKING=true
```

---

## 10. ROADMAP TRIỂN KHAI (PHASES)

### Phase 1: Foundation (Tuần 1-3) - **Core Backend + Driver App MVP**

| Tuần | Deliverable |
|------|-------------|
| 1 | DB Schema (PostGIS), RBAC mở rộng, API CRUD xe/lộ trình/ca |
| 2 | Driver App: Login, Home, Start Shift, Check-in (4 điểm), End Shift |
| 3 | GPS Tracking (foreground), Haversine geofence 100m, SLA timer, Offline queue |

### Phase 2: Real-time & Charging (Tuần 4-6)

| Tuần | Deliverable |
|------|-------------|
| 4 | WebSocket infrastructure, Admin Live Map, Real-time GPS broadcast |
| 5 | EV Charging Workflow: Tạo phiếu → HR duyệt → GĐ duyệt → Bắt đầu sạc → Kết thúc sạc |
| 6 | Background GPS tracking, Battery optimization, Push notifications |

### Phase 3: Payroll & Reporting (Tuần 7-9)

| Tuần | Deliverable |
|------|-------------|
| 7 | Payroll Engine: Tính lương 2 quỹ, phạt tự động, tích hợp PayslipItem |
| 8 | Finance Portal: Tạo/duyệt/xuất bảng lương tài xế, VietQR |
| 9 | Reports: SLA compliance, Charging efficiency, Route optimization |

### Phase 4: Hardening & Scale (Tuần 10-12)

| Tuần | Deliverable |
|------|-------------|
| 10 | Load testing (100 xe đồng thời), GPS partition optimization |
| 11 | Security audit, Penetration testing, Data encryption |
| 12 | Documentation, Training, Production deployment, Monitoring setup |

---

## 11. CHECKLIST KIỂM TRA (Definition of Done)

### Backend
- [ ] Migration PostGIS chạy thành công
- [ ] RBAC mới hoạt động (4 roles quan sát + DRIVER)
- [ ] API CRUD đầy đủ cho Vehicle, Route, Shift, Checkin, ChargingTicket
- [ ] Haversine calculation chính xác (±1m)
- [ ] SLA engine tự động tính phạt
- [ ] WebSocket broadcast real-time (<200ms latency)
- [ ] GPS batch ingest xử lý 1000 points/s
- [ ] Payroll calculation đúng spec (2 quỹ, % phạt)
- [ ] Integration test coverage > 80%

### Driver App
- [ ] Login PIN + Biometric
- [ ] Offline-first: chạy ca hoàn toàn offline, sync khi online
- [ ] Geofence 100m validate đúng (không false positive/negative)
- [ ] SLA countdown timer realtime
- [ ] Charging workflow full cycle
- [ ] Background tracking ≥ 8h pin
- [ ] Push notification nhận cảnh báo SLA
- [ ] Build EAS thành công (iOS TestFlight, Android Play Console Internal)

### Web Portals
- [ ] Admin Live Map: realtime 50 xe, 60fps
- [ ] HR/Director Charging Approval: realtime status, audit trail
- [ ] Finance Payroll: tạo bảng lương < 30s cho 100 tài xế
- [ ] Responsive: desktop ≥ 1920px, tablet ≥ 768px
- [ ] Accessibility: WCAG 2.1 AA

---

## 12. RISK & MITIGATION

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| GPS accuracy kém ở khu vực đô thị dày đặc | High | High | Sử dụng fused location provider, increase accuracy threshold, allow manual check-in override với lý do |
| Driver app kill bởi OS (background) | High | High | Foreground service + persistent notification, battery optimization whitelist guide |
| WebSocket connection drop trên mobile network | Medium | High | Auto-reconnect exponential backoff, local queue, sync khi reconnect |
| Tính lương sai do logic phạt phức tạp | Low | Critical | Unit test exhaustivo cho payroll engine, audit trail mọi thay đổi |
| Google Maps API cost cao | Medium | Medium | Cache tiles, dùng OSM fallback, set budget alerts |
| PostGIS partition maintenance | Low | Medium | pg_partman automated, monitoring disk usage |

---

## 13. KẾT LUẬN & KHUYẾN NGHỊ

### Ưu tiên triển khai:
1. **Backend + Driver App MVP** (Phase 1-2) → Có thể test thực tế với 5-10 tài xế
2. **Admin Live Map** → Giám đốc/HR thấy giá trị ngay
3. **Payroll Integration** → Tự động hóa trả lương, giảm sai sót

### Quyết định cần từ bạn:
1. **Driver App platform**: React Native (Expo) **hoặc** PWA (chạy web, cài được)?
2. **Backend language**: Giữ Node.js/Express **hoặc** migrate sang NestJS/Fastify?
3. **Map provider**: Google Maps (cần billing) **hoặc** Mapbox/OSM miễn phí?
4. **Team size**: 1-2 devs (sequential) hay 4-5 devs (parallel phases)?
5. **Timeline**: Demo khi nào? Production khi nào?

### Next Steps:
1. Review tài liệu này → Feedback
2. Chốt tech stack & team allocation
3. Setup monorepo + shared packages
4. Sprint 1: DB schema + Auth + Vehicle/Route CRUD
5. Sprint 2: Driver App Login + Start Shift + Check-in flow

---

*Tài liệu này là blueprint kỹ thuật. Chi tiết implementation (code, UI/UX, test cases) sẽ được làm trong các sprint tiếp theo.*