export type AttendanceEventType = 'CHECK_IN' | 'CHECK_OUT';

export interface GPSCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number; // in meters
}

export type GPSStatus = 'VALID' | 'OUT_OF_BOUNDS' | 'LOW_ACCURACY' | 'MOCK_DETECTED' | 'UNAVAILABLE';

export interface AttendanceEvent {
  event_id: string;
  request_id: string; // Idempotency
  assignment_id: string;
  employee_id: string;
  branch_id: string;
  type: AttendanceEventType;
  client_time: string; // ISO 8601
  server_received_at: string; // ISO 8601
  gps_latitude?: number;
  gps_longitude?: number;
  gps_accuracy?: number;
  distance_meters?: number;
  gps_status: GPSStatus;
  drive_object_id?: string;
  drive_path?: string; // attendance/YYYY/MM/DD/{branch_id}/{employee_id}/{shift_id}/{event_id}_IN.jpg
  is_early?: boolean;
  is_late?: boolean;
  minutes_deviation?: number; // Minutes early or late
  created_at: string;
}

export type AdjustmentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AttendanceAdjustment {
  adjustment_id: string;
  assignment_id: string;
  employee_id: string;
  branch_id: string;
  reason: string;
  minutes_requested: number; // e.g. 300 minutes (5h)
  minutes_approved?: number;
  approver_id?: string;
  status: AdjustmentStatus;
  review_note?: string;
  created_at: string;
  updated_at: string;
  version: number;
}
