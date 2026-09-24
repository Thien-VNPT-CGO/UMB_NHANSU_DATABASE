export type AttendanceEventType = 'CHECK_IN' | 'CHECK_OUT';
export interface GPSCoordinates {
    latitude: number;
    longitude: number;
    accuracy: number;
}
export type GPSStatus = 'VALID' | 'OUT_OF_BOUNDS' | 'LOW_ACCURACY' | 'MOCK_DETECTED' | 'UNAVAILABLE';
export interface AttendanceEvent {
    event_id: string;
    request_id: string;
    assignment_id: string;
    employee_id: string;
    branch_id: string;
    type: AttendanceEventType;
    client_time: string;
    server_received_at: string;
    gps_latitude?: number;
    gps_longitude?: number;
    gps_accuracy?: number;
    distance_meters?: number;
    gps_status: GPSStatus;
    drive_object_id?: string;
    drive_path?: string;
    is_early?: boolean;
    is_late?: boolean;
    minutes_deviation?: number;
    created_at: string;
}
export type AdjustmentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export interface AttendanceAdjustment {
    adjustment_id: string;
    assignment_id: string;
    employee_id: string;
    branch_id: string;
    reason: string;
    minutes_requested: number;
    minutes_approved?: number;
    approver_id?: string;
    status: AdjustmentStatus;
    review_note?: string;
    created_at: string;
    updated_at: string;
    version: number;
}
