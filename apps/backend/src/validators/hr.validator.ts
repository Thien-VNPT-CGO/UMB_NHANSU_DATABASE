import { z } from 'zod';
import {
  PERIOD_RE,
  accuracyField,
  dateQuery,
  expectedVersion,
  gpsObject,
  idParams,
  latField,
  lngField,
  optString,
  photoField,
  queryString,
  shortId,
} from './common.js';

// --- Employee accounts ---
export const activateAccountBody = z.object({
  expectedVersion,
});

export const revokeAccountBody = z.object({
  expectedVersion,
  status: z.enum(['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'REVOKED']).default('REVOKED'),
});

// --- Employees ---
// Handler hỗ trợ cả camelCase + snake_case và tự default, nên schema chỉ
// khóa kiểu/chặn payload quá khổ, dùng passthrough để không mất field lạ.
export const employeeCreateBody = z
  .object({
    fullName: optString(100),
    full_name: optString(100),
    phone: optString(20),
    phone_normalized: optString(20),
    branchId: optString(32),
    branch_id: optString(32),
    default_branch_id: optString(32),
    employmentStatus: optString(32),
    employment_status: optString(32),
    gender: optString(10),
    group: optString(32),
    employeeCode: optString(32),
    employee_code: optString(32),
    idCardNumber: optString(32),
    id_card_number: optString(32),
    email: optString(100),
    birthDate: optString(64),
    birth_date: optString(64),
    startDate: optString(64),
    start_date: optString(64),
    officialDate: optString(64),
    official_date: optString(64),
    currentRatePerHour: z.coerce.number().int().min(0).max(10_000_000).optional(),
    current_rate_per_hour: z.coerce.number().int().min(0).max(10_000_000).optional(),
  })
  .passthrough();

export const bulkImportBody = z.object({
  employees: z.array(z.object({}).passthrough()).min(1).max(500),
});

export const transitionBody = z.object({
  expectedVersion,
});

// --- Recruitment ---
export const candidateImportBody = z
  .object({
    full_name: optString(100),
    phone: optString(20),
    phone_normalized: optString(20),
  })
  .passthrough();

export const interviewBody = z.object({
  submissionId: shortId(),
  interviewDate: z.string().trim().min(1).max(64),
  timeSlot: z.string().trim().min(1).max(64),
});

// --- Zalo cá nhân HR ---
export const zaloLoginIdParams = z.object({
  loginId: shortId(128),
});

export const zaloFindUserBody = z.object({
  phone: z.string().trim().min(9).max(15),
});

export const zaloFriendRequestBody = z
  .object({
    phone: optString(20),
    uid: optString(64),
    message: z.string().trim().min(1).max(500).default('Chào bạn, mình là HR Ụm Bò Milk. Kết bạn để trao đổi lịch phỏng vấn nhé!'),
  })
  .superRefine((v, ctx) => {
    if (!v.phone && !v.uid) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Cần phone hoặc uid', path: ['phone'] });
    }
  });

export const zaloSendInviteBody = z.object({
  interviewDate: optString(64),
  timeSlot: optString(64),
  meetUrl: optString(500),
});

// --- Schedules ---
export const schedulesQuery = z.object({
  branchId: queryString(32),
  week: dateQuery,
});

export const meScheduleQuery = z.object({
  fromDate: dateQuery,
  toDate: dateQuery,
});

export const shiftCreateBody = z
  .object({
    branchId: optString(32),
    date: optString(32),
    shift_code: optString(32),
    shiftCode: optString(32),
  })
  .passthrough();

export const publishWeekParams = z.object({
  week: z.string().trim().min(1).max(32),
});

export const publishWeekBody = z.object({
  branchId: optString(32),
});

// --- Leave & Swap ---
export const leaveCreateBody = z
  .object({
    employeeId: optString(64),
    branchId: optString(32),
    leaveType: optString(64),
    requestedDate: optString(32),
    reason: optString(1000),
  })
  .passthrough();

export const leaveListQuery = z.object({
  branchId: queryString(32),
  employeeId: queryString(64),
});

export const leaveReviewBody = z.object({
  status: z.string().trim().min(1).max(32),
  note: optString(500),
});

export const swapCreateBody = z
  .object({
    requesterId: optString(64),
    requesterAssignmentId: optString(64),
    targetEmployeeId: optString(64),
    targetAssignmentId: optString(64),
    reason: optString(1000),
  })
  .passthrough();

export const swapRespondBody = z.object({
  accept: z.boolean(),
  partnerId: optString(64),
});

export const swapApproveBody = z.object({
  accept: z.boolean(),
  reason: optString(500),
});

// --- Attendance ---
const checkBody = z.object({
  employee_id: optString(64),
  employeeId: optString(64),
  assignment_id: optString(64),
  assignmentId: optString(64),
  clientTime: optString(64),
  lat: latField,
  latitude: latField,
  lng: lngField,
  longitude: lngField,
  accuracy: accuracyField,
  photo_base64: photoField,
  requestId: optString(128),
});

export const checkinBody = checkBody;
export const checkoutBody = checkBody;

export const leavesAliasBody = z
  .object({
    employeeId: optString(64),
    branchId: optString(32),
  })
  .passthrough();

export const meAttendanceQuery = z.object({
  date: dateQuery,
});

export const attendanceEventBody = z
  .object({
    employeeId: optString(64),
    requestId: optString(128),
    assignmentId: optString(64),
    type: z.enum(['CHECK_IN', 'CHECK_OUT']).optional(),
    clientTime: optString(64),
    gps: gpsObject,
  })
  .passthrough();

export const attendanceEventsQuery = z.object({
  employeeId: queryString(64),
  date: dateQuery,
});

export const adjustmentCreateBody = z
  .object({
    employeeId: optString(64),
  })
  .passthrough();

export const adjustmentsQuery = z.object({
  branchId: queryString(32),
});

export const adjustmentApproveBody = z.object({
  status: z.string().trim().min(1).max(32),
  minutesApproved: z.coerce.number().int().min(0).max(1440).optional(),
  note: optString(500),
});

// --- Payroll ---
export const payrollPeriodParams = z.object({
  period: z.string().regex(PERIOD_RE, 'Kỳ lương phải dạng YYYY-MM'),
});

export const payrollCalculateBody = z.object({
  branchScope: z.string().trim().max(32).default('*'),
});

export const payrollRunParams = z.object({
  run: shortId(128),
});

export const payrollRunIdParams = z.object({
  id: shortId(128),
});

// --- Notifications / Announcements ---
export const notificationsQuery = z.object({
  filter: queryString(32),
});

export const announcementBody = z.object({
  title: z.string().trim().min(1).max(200),
  summary: optString(2000),
  recipientIds: z.array(z.string().trim().max(64)).max(200).default(['ALL']),
  severity: z.string().trim().max(32).default('SYSTEM'),
  targetPath: optString(256),
});

export { idParams };
