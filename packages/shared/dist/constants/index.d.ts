import { ShiftTemplate } from '../types/schedules.js';
export declare const DESIGN_TOKENS: {
    colors: {
        bg: string;
        surface: string;
        brandSoft: string;
        brand: string;
        brandHover: string;
        text: string;
        textMuted: string;
        border: string;
        successSoft: string;
        success: string;
        warningSoft: string;
        warning: string;
        dangerSoft: string;
        danger: string;
    };
    radii: {
        sm: string;
        md: string;
        lg: string;
        full: string;
    };
    shadows: {
        soft: string;
        card: string;
        modal: string;
    };
    transitions: {
        fast: string;
        normal: string;
    };
};
export interface BranchInfo {
    id: string;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    radius_meters: number;
    min_staff: number;
    max_staff: number;
    manager_name?: string;
    status: 'ACTIVE' | 'MAINTENANCE' | 'CLOSED';
}
export declare const BRANCHES: BranchInfo[];
export declare const SHIFT_TEMPLATES: Record<string, ShiftTemplate>;
export declare const STANDARD_HOURLY_RATES: {
    PROBATION: number;
    OFFICIAL: number;
};
export declare const ERROR_CODES: {
    readonly ACCOUNT_NOT_FOUND: "ACCOUNT_NOT_FOUND";
    readonly PENDING_ACTIVATION: "PENDING_ACTIVATION";
    readonly SUSPENDED: "SUSPENDED";
    readonly REVOKED: "REVOKED";
    readonly DUPLICATE_PHONE_NEEDS_HR: "DUPLICATE_PHONE_NEEDS_HR";
    readonly EMPLOYMENT_NOT_ELIGIBLE: "EMPLOYMENT_NOT_ELIGIBLE";
    readonly UNAUTHORIZED: "UNAUTHORIZED";
    readonly FORBIDDEN: "FORBIDDEN";
    readonly BRANCH_SCOPE_VIOLATION: "BRANCH_SCOPE_VIOLATION";
    readonly VERSION_CONFLICT: "VERSION_CONFLICT";
    readonly NEEDS_RECONCILIATION: "NEEDS_RECONCILIATION";
    readonly SHEETS_UNAVAILABLE: "SHEETS_UNAVAILABLE";
    readonly GPS_OUT_OF_BOUNDS: "GPS_OUT_OF_BOUNDS";
    readonly GPS_ACCURACY_LOW: "GPS_ACCURACY_LOW";
    readonly CAMERA_REQUIRED: "CAMERA_REQUIRED";
    readonly SHIFT_NOT_FOUND: "SHIFT_NOT_FOUND";
    readonly ATTENDANCE_ALREADY_RECORDED: "ATTENDANCE_ALREADY_RECORDED";
    readonly SEPARATION_OF_DUTIES_VIOLATION: "SEPARATION_OF_DUTIES_VIOLATION";
};
export type ErrorCode = keyof typeof ERROR_CODES;
