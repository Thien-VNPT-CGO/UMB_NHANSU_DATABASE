import { randomUUID } from 'node:crypto';
import { ISheetsRepository } from '../repositories/sheets.interface.js';

/**
 * Quy trình yêu cầu công việc nội bộ giữa các phòng ban:
 * Giám Đốc – Kế toán (FINANCE) – Nhân sự (HR) – IT.
 *
 * Luồng: bộ phận tạo yêu cầu gửi tới bộ phận thực hiện → các bộ phận phối hợp
 * xử lý (cập nhật timeline realtime) → khi xong PHẢI chuyển Giám đốc KÝ DUYỆT
 * mới được triển khai.
 *
 * Lưu trữ: tái dùng system settings (không đổi schema Sheets), khóa
 * `internalRequest:<id>` — cùng cách với bank-change.service để an toàn với
 * read-modify-write đồng thời.
 */
export type DepartmentCode = 'DIRECTOR' | 'FINANCE' | 'HR' | 'IT';

export type InternalRequestStatus =
  | 'PENDING'          // đã gửi, chờ bộ phận đích tiếp nhận
  | 'IN_PROGRESS'      // bộ phận đang xử lý
  | 'AWAITING_DIRECTOR'// các bộ phận xong, chờ Giám đốc ký duyệt
  | 'APPROVED'         // Giám đốc đã ký duyệt -> được triển khai
  | 'REJECTED'         // bị từ chối
  | 'CANCELLED';

export interface InternalTimelineEntry {
  at: string;
  by: string;
  by_name?: string;
  role?: string;
  action: string;
  note?: string;
}

export interface InternalRequest {
  request_id: string;
  code: string;
  title: string;
  description?: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  from_dept: DepartmentCode;
  to_dept: DepartmentCode;
  current_dept: DepartmentCode;
  status: InternalRequestStatus;
  created_by: string;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
  timeline: InternalTimelineEntry[];
  director_signature?: { name: string; at: string; by: string } | null;
  result_note?: string;
}

export const INTERNAL_REQUEST_KEY_PREFIX = 'internalRequest:';

/** Serialize read-modify-write system settings (nhiều request song song không ghi đè). */
let settingsLock: Promise<unknown> = Promise.resolve();
function withSettingsLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = settingsLock.then(fn, fn);
  settingsLock = run.then(() => undefined, () => undefined);
  return run;
}

export function roleToDepartment(role?: string): DepartmentCode {
  const r = String(role || '').toUpperCase();
  if (r === 'DIRECTOR' || r === 'ADMIN') return 'DIRECTOR';
  if (r === 'FINANCE') return 'FINANCE';
  if (r === 'HR') return 'HR';
  if (r === 'IT') return 'IT';
  return 'HR';
}

const VALID_DEPTS: DepartmentCode[] = ['DIRECTOR', 'FINANCE', 'HR', 'IT'];
export const isDepartment = (v: any): v is DepartmentCode => VALID_DEPTS.includes(v);

function isRequest(value: any): value is InternalRequest {
  return !!value
    && typeof value === 'object'
    && typeof value.request_id === 'string'
    && typeof value.title === 'string'
    && isDepartment(value.to_dept)
    && typeof value.status === 'string';
}

export async function listInternalRequests(repo: ISheetsRepository): Promise<InternalRequest[]> {
  const settings = (await repo.getSystemSettings().catch(() => ({}))) || {};
  return Object.entries(settings)
    .filter(([key]) => key.startsWith(INTERNAL_REQUEST_KEY_PREFIX))
    .map(([, value]) => value)
    .filter((value): value is InternalRequest => isRequest(value))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

async function persist(repo: ISheetsRepository, req: InternalRequest): Promise<InternalRequest> {
  return withSettingsLock(async () => {
    const settings = (await repo.getSystemSettings().catch(() => ({}))) || {};
    await repo.updateSystemSettings({ ...settings, [`${INTERNAL_REQUEST_KEY_PREFIX}${req.request_id}`]: req });
    return req;
  });
}

export interface CreateInternalRequestInput {
  title: string;
  description?: string;
  to_dept: DepartmentCode;
  priority?: InternalRequest['priority'];
  from_dept: DepartmentCode;
  created_by: string;
  created_by_name?: string;
}

export async function createInternalRequest(
  repo: ISheetsRepository,
  input: CreateInternalRequestInput,
): Promise<InternalRequest> {
  const now = new Date().toISOString();
  const requestId = `IWR_${randomUUID()}`;
  const req: InternalRequest = {
    request_id: requestId,
    code: `YC-${now.slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    title: String(input.title || '').trim().slice(0, 200),
    description: String(input.description || '').trim().slice(0, 4000),
    priority: input.priority || 'NORMAL',
    from_dept: input.from_dept,
    to_dept: input.to_dept,
    current_dept: input.to_dept,
    status: 'PENDING',
    created_by: input.created_by,
    created_by_name: input.created_by_name,
    created_at: now,
    updated_at: now,
    timeline: [
      {
        at: now,
        by: input.created_by,
        by_name: input.created_by_name,
        role: input.from_dept,
        action: 'CREATED',
        note: `Tạo yêu cầu gửi tới bộ phận ${input.to_dept}.`,
      },
    ],
  };
  return persist(repo, req);
}

async function getById(repo: ISheetsRepository, id: string): Promise<InternalRequest | null> {
  const settings = (await repo.getSystemSettings().catch(() => ({}))) || {};
  const value = settings[`${INTERNAL_REQUEST_KEY_PREFIX}${id}`];
  return isRequest(value) ? value : null;
}

/** Bộ phận đang giữ yêu cầu đánh dấu đã xử lý xong -> chờ Giám đốc ký duyệt. */
export async function markInternalRequestDone(
  repo: ISheetsRepository,
  id: string,
  actor: { id: string; name?: string; role?: string },
  note?: string,
): Promise<InternalRequest> {
  const req = await getById(repo, id);
  if (!req) throw new Error('INTERNAL_REQUEST_NOT_FOUND');
  if (req.status === 'APPROVED' || req.status === 'CANCELLED' || req.status === 'REJECTED') {
    throw new Error('INTERNAL_REQUEST_CLOSED');
  }
  const now = new Date().toISOString();
  req.timeline = [...(req.timeline || []), {
    at: now, by: actor.id, by_name: actor.name, role: actor.role,
    action: 'DEPT_DONE', note: note || `Bộ phận ${req.current_dept} hoàn tất phần việc.`,
  }];
  req.status = 'AWAITING_DIRECTOR';
  req.updated_at = now;
  return persist(repo, req);
}

/** Chuyển tiếp yêu cầu sang bộ phận phối hợp khác (vẫn trong luồng xử lý). */
export async function forwardInternalRequest(
  repo: ISheetsRepository,
  id: string,
  toDept: DepartmentCode,
  actor: { id: string; name?: string; role?: string },
  note?: string,
): Promise<InternalRequest> {
  const req = await getById(repo, id);
  if (!req) throw new Error('INTERNAL_REQUEST_NOT_FOUND');
  if (req.status === 'APPROVED' || req.status === 'CANCELLED' || req.status === 'REJECTED') {
    throw new Error('INTERNAL_REQUEST_CLOSED');
  }
  const now = new Date().toISOString();
  req.timeline = [...(req.timeline || []), {
    at: now, by: actor.id, by_name: actor.name, role: actor.role,
    action: 'FORWARDED', note: note || `Chuyển tiếp tới bộ phận ${toDept}.`,
  }];
  req.current_dept = toDept;
  req.to_dept = toDept;
  req.status = 'IN_PROGRESS';
  req.updated_at = now;
  return persist(repo, req);
}

/** Giám đốc KÝ DUYỆT — bắt buộc trước khi triển khai. */
export async function approveInternalRequest(
  repo: ISheetsRepository,
  id: string,
  actor: { id: string; name: string; role?: string },
  note?: string,
): Promise<InternalRequest> {
  const req = await getById(repo, id);
  if (!req) throw new Error('INTERNAL_REQUEST_NOT_FOUND');
  if (req.status === 'APPROVED') throw new Error('INTERNAL_REQUEST_ALREADY_APPROVED');
  const now = new Date().toISOString();
  req.timeline = [...(req.timeline || []), {
    at: now, by: actor.id, by_name: actor.name, role: 'DIRECTOR',
    action: 'DIRECTOR_APPROVED', note: note || 'Giám đốc đã ký duyệt — được triển khai.',
  }];
  req.director_signature = { name: actor.name, at: now, by: actor.id };
  req.status = 'APPROVED';
  req.result_note = note;
  req.updated_at = now;
  return persist(repo, req);
}

/** Từ chối / hủy yêu cầu (bất kỳ bộ phận hoặc Giám đốc). */
export async function rejectInternalRequest(
  repo: ISheetsRepository,
  id: string,
  actor: { id: string; name?: string; role?: string },
  reason?: string,
): Promise<InternalRequest> {
  const req = await getById(repo, id);
  if (!req) throw new Error('INTERNAL_REQUEST_NOT_FOUND');
  const now = new Date().toISOString();
  req.timeline = [...(req.timeline || []), {
    at: now, by: actor.id, by_name: actor.name, role: actor.role,
    action: 'REJECTED', note: reason || 'Yêu cầu bị từ chối.',
  }];
  req.status = 'REJECTED';
  req.result_note = reason;
  req.updated_at = now;
  return persist(repo, req);
}
