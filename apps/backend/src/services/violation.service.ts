/**
 * HỆ THỐNG KIỂM SOÁT & XỬ LÝ VI PHẠM
 * ==================================
 * Web app riêng "Tòa Án Tối Cao Ụm Bò Milk".
 *
 * - Đăng nhập bằng PIN 8 số (mặc định 12345678, reset 68686868).
 * - Quy chế + phiếu vi phạm lưu trong system settings (tab CAU_HINH_HE_THONG)
 *   để đi theo luồng đồng bộ Sheet sẵn có.
 * - Chỉ phiếu ĐÃ DUYỆT mới:
 *     1) sinh PDF và đẩy lên Drive theo cây THÁNG / CHI NHÁNH / NGÀY / NHÂN VIÊN;
 *     2) cộng tổng phạt vào TRỪ KPI của bảng DULIEU_LUONG_KY tháng tương ứng;
 *     3) nối tên quy chế + ngày vi phạm vào cột Ghi Chú.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import PDFDocument from 'pdfkit';
import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { AuthenticatedRequest } from '../middlewares/auth.middleware.js';
import { getJwtSecret } from './auth.service.js';
import { hashPassword, verifyPassword } from './password.service.js';
import { getDriveStorage } from './drive-storage.service.js';

// ---------------------------------------------------------------- constants
export const VIOLATION_REGULATIONS_KEY = 'violationRegulations';
export const VIOLATION_TICKETS_KEY = 'violationTickets';
export const VIOLATION_ACCOUNT_KEY = 'violationPortalAccount';

export const VIOLATION_PORTAL_DISPLAY_NAME = 'Tòa Án Tối Cao Ụm Bò Milk';
export const VIOLATION_PORTAL_SYSTEM_NAME = 'HỆ THỐNG KIỂM SOÁT & XỬ LÝ VI PHẠM';
export const VIOLATION_DEFAULT_PIN = '12345678';
export const VIOLATION_RESET_PIN = '68686868';
export const VIOLATION_PIN_RE = /^\d{8}$/;

export const VIOLATION_DRIVE_ROOT_ID = '1ZX8PitPsemXHjZz7ftPJR-Y10PgWOb-h';
export const VIOLATION_DRIVE_ROOT_NAME = '05. LỖI VI PHẠM QUY CHẾ CÔNG TY';

export type ViolationTicketStatus = 'PENDING' | 'APPROVED';

export interface ViolationRegulation {
  regulation_id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  fine_amount: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface ViolationTicketItem {
  regulation_id: string;
  name: string;
  category: string;
  fine_amount: number;
}

export interface ViolationTicket {
  ticket_id: string;
  ticket_code: string;
  employee_id: string;
  employee_code?: string;
  employee_name: string;
  branch_id: string;
  branch_name: string;
  violation_date: string;      // YYYY-MM-DD
  period: string;              // YYYY-MM
  items: ViolationTicketItem[];
  total_amount: number;
  note?: string;
  status: ViolationTicketStatus;
  created_by: string;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
  approved_by?: string;
  approved_by_name?: string;
  approved_at?: string;
  payroll_applied_amount?: number;
  payroll_applied_at?: string;
  payroll_period?: string;
  drive_file_id?: string;
  drive_view_url?: string;
  drive_synced_at?: string;
  drive_sync_status?: 'PENDING' | 'SYNCED' | 'ERROR' | 'NOT_CONFIGURED';
  drive_sync_error?: string;
}

export interface ViolationPortalAccount {
  account_id: string;
  display_name: string;
  system_name: string;
  pin_hash: string;
  pin_version: number;
  must_change_pin: boolean;
  last_login_at?: string;
  reset_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ViolationEmployeeRow {
  employee_id: string;
  employee_code: string;
  full_name: string;
  branch_id: string;
  branch_name: string;
  employment_status: string;
}

export interface ViolationActor {
  id: string;
  name?: string;
}

export const VIOLATION_CAPABILITIES = [
  { code: 'REGULATIONS_VIEW', name: 'Tra cứu Quy chế Công ty', description: 'Xem toàn bộ lỗi vi phạm và mức phạt đang áp dụng.' },
  { code: 'VIOLATION_CREATE', name: 'Bắt lỗi vi phạm', description: 'Lập phiếu vi phạm cho bất kỳ nhân viên nào trong hệ thống.' },
  { code: 'VIOLATION_DRAFT', name: 'Lưu tạm phiếu', description: 'Lưu phiếu vào khu vực Chưa duyệt để kiểm tra lại.' },
  { code: 'VIOLATION_APPROVE', name: 'Duyệt phiếu vi phạm', description: 'Duyệt thẳng hoặc duyệt phiếu đang chờ — kích hoạt đồng bộ Drive và TRỪ KPI.' },
  { code: 'VIOLATION_ADJUST_FINE', name: 'Điều chỉnh mức phạt trên phiếu', description: 'Sửa mức phạt tùy ý cho từng lỗi trước khi lưu/duyệt.' },
  { code: 'REGULATIONS_MANAGE', name: 'Điều chỉnh Quy chế', description: 'Thêm – sửa – xóa quy chế và mức phạt, đồng bộ realtime.' },
  { code: 'PAYROLL_KPI_SYNC', name: 'Đồng bộ TRỪ KPI', description: 'Ghi tổng phạt vào TRỪ KPI và ghi chú của kỳ lương tháng vi phạm.' },
  { code: 'DRIVE_ARCHIVE', name: 'Lưu trữ Drive tối cao', description: 'Đẩy phiếu đã duyệt lên Drive theo cây THÁNG / CHI NHÁNH / NGÀY / NHÂN VIÊN.' },
  { code: 'ACCOUNT_SECURITY', name: 'Quản trị mã PIN tối cao', description: 'Đổi PIN 8 số và cấp lại PIN khẩn cấp theo quy trình bảo mật.' },
  { code: 'PERSONAL_SOVEREIGNTY', name: 'Thông tin cá nhân tối cao', description: 'Xem đầy đủ thẩm quyền, dấu ấn phiên và trạng thái bảo mật của tài khoản.' },
];

// ---------------------------------------------------------------- defaults
const DEFAULT_REGULATIONS: ViolationRegulation[] = [
  ['VIO_001', 'QC-001', 'Đi trễ / về sớm không phép', 'CHẤM CÔNG', 100000, 'Mỗi lần đi trễ hoặc về sớm không có lý do chính đáng.'],
  ['VIO_002', 'QC-002', 'Nghỉ không phép', 'CHẤM CÔNG', 300000, 'Vắng mặt không đăng ký nghỉ, không báo trước.'],
  ['VIO_003', 'QC-003', 'Không mặc đồng phục đúng quy định', 'TÁC PHONG', 50000, 'Thiếu áo đồng phục, tạp dề hoặc trang phục bảo hộ theo ca.'],
  ['VIO_004', 'QC-004', 'Không đeo bảng tên', 'TÁC PHONG', 30000, 'Không đeo bảng tên trong suốt thời gian làm việc.'],
  ['VIO_005', 'QC-005', 'Sử dụng điện thoại trong giờ làm', 'TÁC PHONG', 50000, 'Dùng điện thoại cá nhân ngoài giờ nghỉ hoặc không phục vụ công việc.'],
  ['VIO_006', 'QC-006', 'Ngủ trong giờ làm', 'TÁC PHONG', 100000, 'Ngủ gật hoặc rời vị trí để nghỉ trong giờ làm.'],
  ['VIO_007', 'QC-007', 'Không vệ sinh khu vực làm việc', 'VỆ SINH', 100000, 'Khu vực quầy, bếp, kho không đạt chuẩn vệ sinh theo ca.'],
  ['VIO_008', 'QC-008', 'Thái độ không chuẩn mực với khách hàng', 'DỊCH VỤ', 200000, 'Cáu gắt, thiếu lễ phép hoặc tranh cãi với khách hàng.'],
  ['VIO_009', 'QC-009', 'Không chấp hành chỉ đạo cấp trên', 'KỶ LUẬT', 200000, 'Không thực hiện hoặc cố ý làm sai chỉ đạo hợp lệ.'],
  ['VIO_010', 'QC-010', 'Làm hỏng tài sản / thiết bị', 'TÀI SẢN', 300000, 'Làm hỏng dụng cụ, máy móc, tài sản của công ty.'],
  ['VIO_011', 'QC-011', 'Vi phạm an toàn thực phẩm', 'AN TOÀN', 500000, 'Sai quy trình bảo quản, chế biến hoặc vệ sinh an toàn thực phẩm.'],
  ['VIO_012', 'QC-012', 'Gian lận giờ công / dữ liệu', 'NGHIÊM TRỌNG', 1000000, 'Sửa giờ công, nhờ người chấm công hộ hoặc làm sai lệch dữ liệu.'],
  ['VIO_013', 'QC-013', 'Uống rượu bia trong giờ làm', 'KỶ LUẬT', 500000, 'Sử dụng rượu bia hoặc chất kích thích trong giờ làm việc.'],
  ['VIO_014', 'QC-014', 'Hút thuốc sai nơi quy định', 'KỶ LUẬT', 100000, 'Hút thuốc ngoài khu vực được phép.'],
].map(([regulation_id, code, name, category, fine_amount, description]) => ({
  regulation_id: String(regulation_id),
  code: String(code),
  name: String(name),
  description: String(description),
  category: String(category),
  fine_amount: Number(fine_amount),
  active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  created_by: 'SYSTEM',
}));

// ---------------------------------------------------------------- helpers
let settingsLock: Promise<unknown> = Promise.resolve();
function withViolationLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = settingsLock.then(fn, fn);
  settingsLock = run.then(() => undefined, () => undefined);
  return run;
}

export function vnd(value: unknown): string {
  return `${Math.round(Number(value) || 0).toLocaleString('vi-VN')}đ`;
}

function vnToday(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
}

function normalizeDate(input: unknown): string {
  const raw = String(input || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [d, m, y] = raw.split('/');
    return `${y}-${m}-${d}`;
  }
  const t = Date.parse(raw);
  if (Number.isFinite(t)) return new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
  return vnToday();
}

function shortDate(iso: string): string {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : String(iso || '');
}

function safeMoney(v: unknown): number {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function normalizeRegulation(raw: any): ViolationRegulation | null {
  if (!raw || typeof raw !== 'object' || !(raw.regulation_id || raw.name)) return null;
  const now = new Date().toISOString();
  const name = String(raw.name || '').trim().slice(0, 200);
  if (!name) return null;
  return {
    regulation_id: String(raw.regulation_id || `REG_${randomUUID()}`),
    code: String(raw.code || '').trim().slice(0, 40) || `QC-${String(raw.regulation_id || '').replace(/\D/g, '').slice(-3).padStart(3, '0')}`,
    name,
    description: String(raw.description || '').slice(0, 2000),
    category: String(raw.category || 'CHUNG').trim().slice(0, 60) || 'CHUNG',
    fine_amount: safeMoney(raw.fine_amount),
    active: raw.active !== false,
    created_at: String(raw.created_at || now),
    updated_at: String(raw.updated_at || now),
    created_by: raw.created_by ? String(raw.created_by) : undefined,
  };
}

function normalizeTicket(raw: any): ViolationTicket | null {
  if (!raw || typeof raw !== 'object' || !raw.ticket_id) return null;
  const items = Array.isArray(raw.items) ? raw.items.map((it: any) => ({
    regulation_id: String(it?.regulation_id || ''),
    name: String(it?.name || 'Lỗi vi phạm').slice(0, 200),
    category: String(it?.category || 'CHUNG').slice(0, 60),
    fine_amount: safeMoney(it?.fine_amount),
  })) : [];
  const date = normalizeDate(raw.violation_date || raw.created_at);
  return {
    ticket_id: String(raw.ticket_id),
    ticket_code: String(raw.ticket_code || raw.ticket_id),
    employee_id: String(raw.employee_id || ''),
    employee_code: raw.employee_code ? String(raw.employee_code) : undefined,
    employee_name: String(raw.employee_name || ''),
    branch_id: String(raw.branch_id || ''),
    branch_name: String(raw.branch_name || raw.branch_id || ''),
    violation_date: date,
    period: String(raw.period || date.slice(0, 7)),
    items,
    total_amount: items.reduce((s: number, it: ViolationTicketItem) => s + it.fine_amount, 0),
    note: raw.note ? String(raw.note).slice(0, 4000) : undefined,
    status: raw.status === 'APPROVED' ? 'APPROVED' : 'PENDING',
    created_by: String(raw.created_by || 'VIOLATION_PORTAL'),
    created_by_name: raw.created_by_name ? String(raw.created_by_name) : undefined,
    created_at: String(raw.created_at || new Date().toISOString()),
    updated_at: String(raw.updated_at || new Date().toISOString()),
    approved_by: raw.approved_by ? String(raw.approved_by) : undefined,
    approved_by_name: raw.approved_by_name ? String(raw.approved_by_name) : undefined,
    approved_at: raw.approved_at ? String(raw.approved_at) : undefined,
    payroll_applied_amount: raw.payroll_applied_amount !== undefined ? safeMoney(raw.payroll_applied_amount) : undefined,
    payroll_applied_at: raw.payroll_applied_at ? String(raw.payroll_applied_at) : undefined,
    payroll_period: raw.payroll_period ? String(raw.payroll_period) : undefined,
    drive_file_id: raw.drive_file_id ? String(raw.drive_file_id) : undefined,
    drive_view_url: raw.drive_view_url ? String(raw.drive_view_url) : undefined,
    drive_synced_at: raw.drive_synced_at ? String(raw.drive_synced_at) : undefined,
    drive_sync_status: ['PENDING', 'SYNCED', 'ERROR', 'NOT_CONFIGURED'].includes(raw.drive_sync_status)
      ? raw.drive_sync_status
      : undefined,
    drive_sync_error: raw.drive_sync_error ? String(raw.drive_sync_error).slice(0, 500) : undefined,
  };
}

function publicAccount(acc: ViolationPortalAccount) {
  return {
    account_id: acc.account_id,
    display_name: acc.display_name,
    system_name: acc.system_name,
    must_change_pin: acc.must_change_pin === true,
    last_login_at: acc.last_login_at || null,
    reset_at: acc.reset_at || null,
    created_at: acc.created_at,
    updated_at: acc.updated_at,
    capabilities: VIOLATION_CAPABILITIES,
  };
}

async function getSettings(repo: ISheetsRepository): Promise<any> {
  return (await repo.getSystemSettings().catch(() => ({}))) || {};
}

async function persistSettings(repo: ISheetsRepository, patch: Record<string, any>): Promise<void> {
  await withViolationLock(async () => {
    const settings = await getSettings(repo);
    await repo.updateSystemSettings({ ...(settings as any), ...patch });
  });
}

// ---------------------------------------------------------------- account
export async function ensureViolationAccount(repo: ISheetsRepository): Promise<ViolationPortalAccount> {
  const settings = await getSettings(repo);
  const existing = settings?.[VIOLATION_ACCOUNT_KEY];
  if (existing && existing.pin_hash) {
    return {
      account_id: String(existing.account_id || 'VIOLATION_PORTAL'),
      display_name: String(existing.display_name || VIOLATION_PORTAL_DISPLAY_NAME),
      system_name: String(existing.system_name || VIOLATION_PORTAL_SYSTEM_NAME),
      pin_hash: String(existing.pin_hash),
      pin_version: Number(existing.pin_version || 1),
      must_change_pin: existing.must_change_pin !== false,
      last_login_at: existing.last_login_at ? String(existing.last_login_at) : undefined,
      reset_at: existing.reset_at ? String(existing.reset_at) : undefined,
      created_at: String(existing.created_at || new Date().toISOString()),
      updated_at: String(existing.updated_at || new Date().toISOString()),
    };
  }

  const now = new Date().toISOString();
  const account: ViolationPortalAccount = {
    account_id: 'VIOLATION_PORTAL',
    display_name: VIOLATION_PORTAL_DISPLAY_NAME,
    system_name: VIOLATION_PORTAL_SYSTEM_NAME,
    pin_hash: await hashPassword(VIOLATION_DEFAULT_PIN),
    pin_version: 1,
    must_change_pin: true,
    created_at: now,
    updated_at: now,
  };
  await persistSettings(repo, { [VIOLATION_ACCOUNT_KEY]: account });
  return account;
}

export async function loginViolationPortal(repo: ISheetsRepository, pinInput: string) {
  const pin = String(pinInput || '').trim();
  if (!VIOLATION_PIN_RE.test(pin)) throw new Error('INVALID_PIN');
  const account = await ensureViolationAccount(repo);
  if (!(await verifyPassword(pin, account.pin_hash))) throw new Error('INVALID_PIN');

  const now = new Date().toISOString();
  const next: ViolationPortalAccount = { ...account, last_login_at: now, updated_at: now };
  await persistSettings(repo, { [VIOLATION_ACCOUNT_KEY]: next });

  const token = jwt.sign(
    { sub: next.account_id, typ: 'violation-access', pv: next.pin_version, role: 'VIOLATION_PORTAL' },
    getJwtSecret(),
    { expiresIn: '12h' },
  );
  return { token, account: publicAccount(next), mustChangePin: next.must_change_pin === true };
}

export async function changeViolationPin(
  repo: ISheetsRepository,
  oldPinInput: string,
  newPinInput: string,
) {
  const oldPin = String(oldPinInput || '').trim();
  const newPin = String(newPinInput || '').trim();
  if (!VIOLATION_PIN_RE.test(newPin)) throw new Error('WEAK_PIN');
  if (oldPin === newPin) throw new Error('SAME_PIN');

  const account = await ensureViolationAccount(repo);
  if (!(await verifyPassword(oldPin, account.pin_hash))) throw new Error('INVALID_PIN');

  const now = new Date().toISOString();
  const next: ViolationPortalAccount = {
    ...account,
    pin_hash: await hashPassword(newPin),
    pin_version: Number(account.pin_version || 1) + 1,
    must_change_pin: false,
    updated_at: now,
  };
  await persistSettings(repo, { [VIOLATION_ACCOUNT_KEY]: next });

  const token = jwt.sign(
    { sub: next.account_id, typ: 'violation-access', pv: next.pin_version, role: 'VIOLATION_PORTAL' },
    getJwtSecret(),
    { expiresIn: '12h' },
  );
  return { token, account: publicAccount(next), mustChangePin: false };
}

/**
 * Cấp lại PIN khẩn cấp: đặt PIN về 68686868, tăng version (văng mọi phiên cũ),
 * trả về thông điệp "liên hệ Admin" để không lộ PIN qua giao diện.
 */
export async function resetViolationPin(repo: ISheetsRepository): Promise<{ message: string }> {
  const account = await ensureViolationAccount(repo);
  const now = new Date().toISOString();
  const next: ViolationPortalAccount = {
    ...account,
    pin_hash: await hashPassword(VIOLATION_RESET_PIN),
    pin_version: Number(account.pin_version || 1) + 1,
    must_change_pin: true,
    reset_at: now,
    updated_at: now,
  };
  await persistSettings(repo, { [VIOLATION_ACCOUNT_KEY]: next });
  return { message: 'Vui lòng liên hệ Admin để lấy mã PIN.' };
}

export interface ViolationTokenPayload {
  sub: string;
  typ: 'violation-access';
  pv: number;
  role: 'VIOLATION_PORTAL';
  account: ViolationPortalAccount;
}

export async function verifyViolationToken(
  repo: ISheetsRepository,
  token: string,
): Promise<ViolationTokenPayload> {
  let decoded: any;
  try {
    decoded = jwt.verify(token, getJwtSecret()) as any;
  } catch (e: any) {
    if (e?.name === 'TokenExpiredError') throw new Error('TOKEN_EXPIRED');
    throw new Error('INVALID_TOKEN');
  }
  if (decoded?.typ !== 'violation-access') throw new Error('INVALID_TOKEN');
  const account = await ensureViolationAccount(repo);
  if (Number(decoded.pv) !== Number(account.pin_version)) throw new Error('TOKEN_REVOKED');
  return { ...decoded, account };
}

/** Middleware xác thực riêng cho cổng vi phạm (không dùng token nhân viên/admin). */
export function createViolationAuthMiddleware(repo: ISheetsRepository) {
  return async function violationAuth(req: AuthenticatedRequest & { violation?: ViolationTokenPayload }, res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Thiếu mã xác thực.' });
    }
    try {
      const payload = await verifyViolationToken(repo, header.slice(7));
      const acc = payload.account;
      (req as any).violation = payload;
      // PIN mặc định / vừa reset: chỉ cho đổi PIN + xem hồ sơ.
      if (acc.must_change_pin === true && !(req.path.includes('/auth/') || req.path.endsWith('/me'))) {
        return res.status(403).json({
          error: 'PIN_CHANGE_REQUIRED',
          message: 'Bạn bắt buộc đổi mã PIN 8 số trước khi sử dụng hệ thống.',
          code: 'PIN_CHANGE_REQUIRED',
        });
      }
      return next();
    } catch (e: any) {
      const msg = String(e?.message || 'UNAUTHORIZED');
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: msg === 'TOKEN_EXPIRED' ? 'Phiên đăng nhập đã hết hạn.' : 'Phiên đăng nhập không hợp lệ hoặc đã bị thu hồi.',
        code: msg,
      });
    }
  };
}

// ---------------------------------------------------------------- regulations
export async function listViolationRegulations(repo: ISheetsRepository): Promise<ViolationRegulation[]> {
  const settings = await getSettings(repo);
  const raw = settings?.[VIOLATION_REGULATIONS_KEY];
  if (!Array.isArray(raw)) {
    // Seed lần đầu, giữ nguyên nếu người dùng đã xóa hết (mảng rỗng hợp lệ).
    await persistSettings(repo, { [VIOLATION_REGULATIONS_KEY]: DEFAULT_REGULATIONS });
    return DEFAULT_REGULATIONS.map(r => ({ ...r }));
  }
  return raw
    .map(normalizeRegulation)
    .filter((r): r is ViolationRegulation => !!r)
    .sort((a, b) => a.code.localeCompare(b.code, 'vi'));
}

export async function upsertViolationRegulation(
  repo: ISheetsRepository,
  input: any,
  actor: ViolationActor,
): Promise<ViolationRegulation> {
  const list = await listViolationRegulations(repo);
  const now = new Date().toISOString();
  const id = String(input?.regulation_id || '').trim() || `REG_${randomUUID()}`;
  const existing = list.find(r => r.regulation_id === id);
  const name = String(input?.name ?? existing?.name ?? '').trim();
  if (!name) throw new Error('MISSING_NAME');

  const regulation: ViolationRegulation = {
    regulation_id: id,
    code: String(input?.code ?? existing?.code ?? `QC-${String(list.length + 1).padStart(3, '0')}`).trim().slice(0, 40),
    name: name.slice(0, 200),
    description: String(input?.description ?? existing?.description ?? '').slice(0, 2000),
    category: String(input?.category ?? existing?.category ?? 'CHUNG').trim().slice(0, 60) || 'CHUNG',
    fine_amount: input?.fine_amount !== undefined ? safeMoney(input.fine_amount) : (existing?.fine_amount ?? 0),
    active: input?.active !== undefined ? input.active !== false : (existing?.active !== false),
    created_at: existing?.created_at || now,
    updated_at: now,
    created_by: existing?.created_by || actor.id,
  };

  const next = existing ? list.map(r => (r.regulation_id === id ? regulation : r)) : [regulation, ...list];
  await persistSettings(repo, { [VIOLATION_REGULATIONS_KEY]: next });
  return regulation;
}

export async function deleteViolationRegulation(repo: ISheetsRepository, id: string): Promise<boolean> {
  const list = await listViolationRegulations(repo);
  const next = list.filter(r => r.regulation_id !== id);
  if (next.length === list.length) return false;
  await persistSettings(repo, { [VIOLATION_REGULATIONS_KEY]: next });
  return true;
}

// ---------------------------------------------------------------- tickets
export async function listViolationTickets(
  repo: ISheetsRepository,
  filter: { status?: ViolationTicketStatus; period?: string; branch_id?: string; employee_id?: string } = {},
): Promise<ViolationTicket[]> {
  const settings = await getSettings(repo);
  const raw = Array.isArray(settings?.[VIOLATION_TICKETS_KEY]) ? settings[VIOLATION_TICKETS_KEY] : [];
  return raw
    .map(normalizeTicket)
    .filter((t): t is ViolationTicket => !!t)
    .filter(t => !filter.status || t.status === filter.status)
    .filter(t => !filter.period || t.period === filter.period)
    .filter(t => !filter.branch_id || t.branch_id === filter.branch_id)
    .filter(t => !filter.employee_id || t.employee_id === filter.employee_id)
    .sort((a, b) => {
      const at = Date.parse(a.created_at) || 0;
      const bt = Date.parse(b.created_at) || 0;
      return bt - at;
    });
}

async function saveTicket(repo: ISheetsRepository, ticket: ViolationTicket): Promise<void> {
  await withViolationLock(async () => {
    const settings = await getSettings(repo);
    const raw = Array.isArray(settings?.[VIOLATION_TICKETS_KEY]) ? settings[VIOLATION_TICKETS_KEY] : [];
    const list = raw.map(normalizeTicket).filter((t: ViolationTicket | null): t is ViolationTicket => !!t);
    const idx = list.findIndex((t: ViolationTicket) => t.ticket_id === ticket.ticket_id);
    if (idx >= 0) list[idx] = ticket;
    else list.unshift(ticket);
    await repo.updateSystemSettings({ ...(settings as any), [VIOLATION_TICKETS_KEY]: list });
  });
}

export async function listViolationEmployees(repo: ISheetsRepository): Promise<ViolationEmployeeRow[]> {
  const [employees, branches] = await Promise.all([
    repo.listEmployees().catch(() => []),
    repo.getBranches().catch(() => []),
  ]);
  const branchMap = new Map<string, string>((branches as any[]).map(b => [String(b.id), String(b.name)]));
  return (employees as any[])
    .filter(e => e.employment_status !== 'TERMINATED' && e.blacklisted !== true)
    .map(e => ({
      employee_id: String(e.employee_id),
      employee_code: String(e.employee_code || ''),
      full_name: String(e.full_name || ''),
      branch_id: String(e.default_branch_id || ''),
      branch_name: branchMap.get(String(e.default_branch_id || '')) || String(e.default_branch_id || 'Chưa xác định'),
      employment_status: String(e.employment_status || ''),
    }))
    .sort((a, b) => {
      const byBranch = a.branch_name.localeCompare(b.branch_name, 'vi');
      return byBranch !== 0 ? byBranch : a.full_name.localeCompare(b.full_name, 'vi');
    });
}

function makeTicketCode(date: string): string {
  const compact = date.replace(/-/g, '');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `VP-${compact}-${suffix}`;
}

export async function createViolationTicket(
  repo: ISheetsRepository,
  input: any,
  actor: ViolationActor,
): Promise<ViolationTicket> {
  const employeeId = String(input?.employee_id || '').trim();
  if (!employeeId) throw new Error('MISSING_EMPLOYEE');
  const employee = await repo.getEmployeeById(employeeId);
  if (!employee) throw new Error('EMPLOYEE_NOT_FOUND');

  const [branches, regulations] = await Promise.all([
    repo.getBranches().catch(() => []),
    listViolationRegulations(repo),
  ]);
  const branchName = (branches as any[]).find(b => String(b.id) === String((employee as any).default_branch_id))?.name
    || String((employee as any).default_branch_id || 'Chưa xác định');

  const rawItems = Array.isArray(input?.items) ? input.items : [];
  const items: ViolationTicketItem[] = rawItems
    .map((it: any) => {
      const reg = regulations.find(r => r.regulation_id === String(it?.regulation_id || ''));
      const name = String(it?.name || reg?.name || '').trim();
      if (!name) return null;
      return {
        regulation_id: String(it?.regulation_id || reg?.regulation_id || ''),
        name: name.slice(0, 200),
        category: String(it?.category || reg?.category || 'CHUNG').slice(0, 60),
        fine_amount: safeMoney(it?.fine_amount !== undefined ? it.fine_amount : reg?.fine_amount),
      } as ViolationTicketItem;
    })
    .filter((it: ViolationTicketItem | null): it is ViolationTicketItem => !!it);

  if (items.length === 0) throw new Error('MISSING_ITEMS');

  const date = normalizeDate(input?.violation_date);
  const now = new Date().toISOString();
  const desiredApproved = input?.status === 'APPROVED';
  const ticket: ViolationTicket = {
    ticket_id: `VT_${Date.now()}_${randomUUID().slice(0, 8)}`,
    ticket_code: makeTicketCode(date),
    employee_id: String(employee.employee_id),
    employee_code: String((employee as any).employee_code || ''),
    employee_name: String(employee.full_name || ''),
    branch_id: String((employee as any).default_branch_id || ''),
    branch_name: String(branchName),
    violation_date: date,
    period: date.slice(0, 7),
    items,
    total_amount: items.reduce((s: number, it: ViolationTicketItem) => s + it.fine_amount, 0),
    note: input?.note ? String(input.note).slice(0, 4000) : undefined,
    // Luôn lưu PENDING trước; nếu người dùng chọn duyệt ngay thì gọi
    // approveViolationTicket bên dưới để kích hoạt TRỪ KPI + Drive đúng một lần.
    status: 'PENDING',
    created_by: actor.id,
    created_by_name: actor.name,
    created_at: now,
    updated_at: now,
    drive_sync_status: 'PENDING',
  };

  await saveTicket(repo, ticket);

  if (desiredApproved) {
    const approved = await approveViolationTicket(repo, ticket.ticket_id, actor);
    return approved || ticket;
  }
  return ticket;
}

export async function approveViolationTicket(
  repo: ISheetsRepository,
  ticketId: string,
  actor: ViolationActor,
): Promise<ViolationTicket | null> {
  const tickets = await listViolationTickets(repo);
  const ticket = tickets.find(t => t.ticket_id === ticketId);
  if (!ticket) return null;
  if (ticket.status === 'APPROVED') return ticket;

  const now = new Date().toISOString();
  const next: ViolationTicket = {
    ...ticket,
    status: 'APPROVED',
    approved_by: actor.id,
    approved_by_name: actor.name,
    approved_at: now,
    updated_at: now,
  };

  // 1) TRỪ KPI + ghi chú (chỉ một lần cho mỗi phiếu).
  if (!next.payroll_applied_at) {
    try {
      await applyPayrollDeduction(repo, next);
      next.payroll_applied_amount = next.total_amount;
      next.payroll_applied_at = new Date().toISOString();
      next.payroll_period = next.period;
    } catch (e: any) {
      console.warn('[violation] Không cập nhật được TRỪ KPI:', e?.message || e);
    }
  }

  // 2) Drive PDF.
  if (next.drive_sync_status !== 'SYNCED' || !next.drive_file_id) {
    try {
      const drive = await syncTicketToDrive(repo, next);
      next.drive_file_id = drive.fileId;
      next.drive_view_url = drive.viewUrl;
      next.drive_synced_at = new Date().toISOString();
      next.drive_sync_status = 'SYNCED';
      next.drive_sync_error = undefined;
    } catch (e: any) {
      const code = String(e?.message || e);
      next.drive_sync_status = code === 'DRIVE_NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'ERROR';
      next.drive_sync_error = code.slice(0, 500);
      console.warn('[violation] Không đồng bộ Drive:', code);
    }
  }

  await saveTicket(repo, next);
  return next;
}

export async function deleteViolationTicket(repo: ISheetsRepository, ticketId: string): Promise<boolean> {
  const tickets = await listViolationTickets(repo);
  const ticket = tickets.find(t => t.ticket_id === ticketId);
  if (!ticket || ticket.status === 'APPROVED') return false;
  const next = tickets.filter(t => t.ticket_id !== ticketId);
  await persistSettings(repo, { [VIOLATION_TICKETS_KEY]: next });
  return true;
}

// ---------------------------------------------------------------- payroll KPI
export async function applyPayrollDeduction(repo: ISheetsRepository, ticket: ViolationTicket): Promise<void> {
  if (!ticket.employee_id) throw new Error('MISSING_EMPLOYEE');
  const amount = Math.round(Number(ticket.total_amount) || 0);
  if (amount <= 0) return;
  const period = ticket.period || ticket.violation_date.slice(0, 7);
  const inputs = await repo.getPayrollInputs(period).catch(() => []);
  const existing = (inputs as any[]).find(i => String(i.employee_id) === String(ticket.employee_id));

  const base = existing || {
    period,
    employee_id: ticket.employee_id,
    luong_cb: 0,
    ot_extra: 0,
    bonus_extra: 0,
    ung_luong: 0,
    tru_kpi: 0,
    dong_phuc: 0,
    note: '',
  };

  const dateLabel = shortDate(ticket.violation_date);
  const itemLines = ticket.items.map(it => `[VI PHẠM ${dateLabel}] ${it.name}: ${vnd(it.fine_amount)}`);
  const header = `[VI PHẠM ${dateLabel}] Phiếu ${ticket.ticket_code} — Tổng phạt ${vnd(amount)}`;
  const prevNote = String(base.note || '').trim();
  const note = [prevNote, header, ...itemLines].filter(Boolean).join('\n');

  await repo.upsertPayrollInput({
    ...base,
    period,
    employee_id: ticket.employee_id,
    tru_kpi: Math.round(Number(base.tru_kpi || 0) + amount),
    note,
    updatedBy: 'VIOLATION_PORTAL',
    updatedAt: new Date().toISOString(),
  } as any);
}

// ---------------------------------------------------------------- Drive PDF
function findFontDir(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'assets', 'fonts'),
    path.resolve(__dirname, '..', '..', '..', 'assets', 'fonts'),
    path.join(process.cwd(), 'apps', 'backend', 'assets', 'fonts'),
    path.join(process.cwd(), 'assets', 'fonts'),
    '/app/apps/backend/assets/fonts',
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'BeVietnamPro-Regular.ttf'))) return c;
  }
  return candidates[0];
}

function buildViolationPdf(ticket: ViolationTicket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 42, info: { Title: `Phiếu vi phạm ${ticket.ticket_code}` } });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const fontDir = findFontDir();
      const regular = path.join(fontDir, 'BeVietnamPro-Regular.ttf');
      const bold = path.join(fontDir, 'BeVietnamPro-Bold.ttf');
      const hasFont = fs.existsSync(regular) && fs.existsSync(bold);
      if (hasFont) {
        doc.registerFont('body', regular);
        doc.registerFont('bold', bold);
        doc.font('body');
      }

      const gold = '#B8892F';
      const ink = '#1F2937';
      const muted = '#6B7280';

      // Header
      doc.rect(0, 0, doc.page.width, 112).fill('#0B1220');
      doc.fillColor('#E8C87A').fontSize(10).text('TÒA ÁN TỐI CAO ỤM BÒ MILK', 42, 30, { characterSpacing: 2 });
      doc.fillColor('#FFFFFF').fontSize(19).text('PHIẾU LỖI VI PHẠM ĐÃ DUYỆT', 42, 48);
      doc.fillColor('#C9B27A').fontSize(9).text(VIOLATION_PORTAL_SYSTEM_NAME, 42, 78, { characterSpacing: 1.2 });
      doc.fillColor('#FFFFFF').fontSize(9).text(ticket.ticket_code, 400, 48, { width: 150, align: 'right' });

      doc.fillColor(ink).font('bold').fontSize(12).text('THÔNG TIN NHÂN VIÊN', 42, 136);
      doc.moveTo(42, 154).lineTo(553, 154).strokeColor(gold).lineWidth(1).stroke();

      const info: Array<[string, string]> = [
        ['Họ và tên', ticket.employee_name],
        ['Mã nhân viên', ticket.employee_code || ticket.employee_id],
        ['Chi nhánh', ticket.branch_name],
        ['Ngày vi phạm', shortDate(ticket.violation_date)],
        ['Kỳ ghi nhận', ticket.period],
        ['Trạng thái', 'ĐÃ DUYỆT'],
      ];
      let y = 168;
      info.forEach(([label, value], i) => {
        const x = i % 2 === 0 ? 42 : 306;
        if (i > 0 && i % 2 === 0) y += 24;
        doc.fillColor(muted).font('body').fontSize(8.5).text(label.toUpperCase(), x, y);
        doc.fillColor(ink).font('bold').fontSize(10.5).text(value || '—', x, y + 11, { width: 220 });
      });

      y += 52;
      doc.fillColor(ink).font('bold').fontSize(12).text('DANH SÁCH LỖI VI PHẠM', 42, y);
      y += 20;
      doc.rect(42, y, 511, 24).fill('#F4EBDD');
      doc.fillColor('#6B4C16').font('bold').fontSize(8.5);
      doc.text('STT', 50, y + 8);
      doc.text('TÊN QUY CHẾ / LỖI VI PHẠM', 82, y + 8);
      doc.text('NHÓM', 360, y + 8);
      doc.text('MỨC PHẠT', 470, y + 8, { width: 76, align: 'right' });
      y += 24;

      ticket.items.forEach((it, idx) => {
        const rowH = 26;
        if (y + rowH > 690) { doc.addPage(); y = 48; }
        if (idx % 2 === 0) doc.rect(42, y, 511, rowH).fill('#FCFAF6');
        doc.fillColor(ink).font('body').fontSize(9.5);
        doc.text(String(idx + 1), 50, y + 8);
        doc.text(it.name, 82, y + 8, { width: 265 });
        doc.text(it.category || 'CHUNG', 360, y + 8, { width: 100 });
        doc.font('bold').text(vnd(it.fine_amount), 470, y + 8, { width: 76, align: 'right' });
        y += rowH;
      });

      y += 8;
      doc.moveTo(330, y).lineTo(553, y).strokeColor(gold).lineWidth(1).stroke();
      y += 10;
      doc.fillColor(muted).font('body').fontSize(9).text('TỔNG MỨC PHẠT', 330, y + 4);
      doc.fillColor('#B42318').font('bold').fontSize(18).text(vnd(ticket.total_amount), 400, y, { width: 153, align: 'right' });
      y += 40;

      if (ticket.note) {
        doc.fillColor(ink).font('bold').fontSize(9).text('GHI CHÚ:', 42, y);
        doc.fillColor(muted).font('body').fontSize(9).text(ticket.note, 42, y + 13, { width: 511 });
        y += 52;
      }

      y = Math.max(y + 30, 640);
      doc.fillColor(muted).font('body').fontSize(8.5);
      doc.text(`Người lập: ${ticket.created_by_name || ticket.created_by}`, 42, y);
      doc.text(`Người duyệt: ${ticket.approved_by_name || ticket.approved_by || '—'}`, 306, y);
      doc.text(`Thời điểm duyệt: ${ticket.approved_at ? new Date(ticket.approved_at).toLocaleString('vi-VN') : '—'}`, 42, y + 18);
      doc.text('Hệ thống kiểm soát & xử lý vi phạm — Ụm Bò Milk', 306, y + 18);

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

async function syncTicketToDrive(repo: ISheetsRepository, ticket: ViolationTicket) {
  const drive = getDriveStorage();
  if (!drive.isConfigured()) throw new Error('DRIVE_NOT_CONFIGURED');
  const rootId = String(process.env.GOOGLE_DRIVE_VIOLATION_ROOT_ID || '').trim() || VIOLATION_DRIVE_ROOT_ID;

  // Root có thể là thư mục cha hoặc chính thư mục "05. LỖI VI PHẠM...".
  let rootName = '';
  try {
    const meta = await drive.getFileMetadata(rootId);
    rootName = String(meta?.name || '');
  } catch { /* vẫn thử upload */ }

  const rootIsSection = /^\s*0?5\s*[\.\-]/.test(rootName) || /LỖI\s*VI\s*PHẠM/i.test(rootName);
  const [y, m, d] = ticket.violation_date.split('-');
  const monthLabel = `THÁNG ${m}.${y}`;
  const dateLabel = `NGÀY ${d}-${m}-${y}`;
  const branchLabel = ticket.branch_name || ticket.branch_id || 'CHI NHÁNH KHÁC';
  const employeeLabel = ticket.employee_name || ticket.employee_id;

  const segments = [
    ...(rootIsSection ? [] : [VIOLATION_DRIVE_ROOT_NAME]),
    monthLabel,
    branchLabel,
    dateLabel,
    employeeLabel,
  ];

  const pdf = await buildViolationPdf(ticket);
  const fileName = `PHIẾU LỖI VI PHẠM ĐÃ DUYỆT - ${ticket.ticket_code}.pdf`;
  const uploaded = await drive.uploadBuffer(fileName, 'application/pdf', pdf, segments, rootId, {
    upsert: true,
    appProperties: {
      violation_ticket_id: ticket.ticket_id,
      employee_id: ticket.employee_id,
      period: ticket.period,
    },
  });
  return uploaded;
}

export async function retryViolationDriveSync(repo: ISheetsRepository, ticketId: string): Promise<ViolationTicket | null> {
  const tickets = await listViolationTickets(repo);
  const ticket = tickets.find(t => t.ticket_id === ticketId);
  if (!ticket) return null;
  if (ticket.status !== 'APPROVED') throw new Error('TICKET_NOT_APPROVED');

  try {
    const uploaded = await syncTicketToDrive(repo, ticket);
    ticket.drive_file_id = uploaded.fileId;
    ticket.drive_view_url = uploaded.viewUrl;
    ticket.drive_synced_at = new Date().toISOString();
    ticket.drive_sync_status = 'SYNCED';
    ticket.drive_sync_error = undefined;
  } catch (e: any) {
    const code = String(e?.message || e);
    ticket.drive_sync_status = code === 'DRIVE_NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'ERROR';
    ticket.drive_sync_error = code.slice(0, 500);
  }
  ticket.updated_at = new Date().toISOString();
  await saveTicket(repo, ticket);
  return ticket;
}

// ---------------------------------------------------------------- overview
export async function getViolationOverview(repo: ISheetsRepository) {
  const [regulations, tickets, employees] = await Promise.all([
    listViolationRegulations(repo),
    listViolationTickets(repo),
    repo.listEmployees().catch(() => []),
  ]);
  const pending = tickets.filter(t => t.status === 'PENDING');
  const approved = tickets.filter(t => t.status === 'APPROVED');
  const now = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 7);
  const thisMonth = approved.filter(t => t.period === now);
  return {
    regulations_active: regulations.filter(r => r.active !== false).length,
    regulations_total: regulations.length,
    employees_total: (employees as any[]).filter(e => e.employment_status !== 'TERMINATED').length,
    pending_count: pending.length,
    pending_amount: pending.reduce((s, t) => s + t.total_amount, 0),
    approved_count: approved.length,
    approved_amount: approved.reduce((s, t) => s + t.total_amount, 0),
    month: now,
    month_count: thisMonth.length,
    month_amount: thisMonth.reduce((s, t) => s + t.total_amount, 0),
    drive_error_count: approved.filter(t => t.drive_sync_status === 'ERROR' || t.drive_sync_status === 'NOT_CONFIGURED').length,
  };
}
