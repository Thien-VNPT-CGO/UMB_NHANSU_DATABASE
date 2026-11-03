import { randomUUID } from 'node:crypto';
import { ISheetsRepository } from '../repositories/sheets.interface.js';

/**
 * Đổi số tài khoản ngân hàng của nhân viên:
 * - STK hợp lệ được TỰ DUYỆT ngay khi nhận yêu cầu (không còn chờ 48h).
 * - STK trùng với STK đang dùng hoặc trùng STK của nhân viên khác bị TỪ CHỐI ngay.
 * - Payroll luôn dùng STK mới nhất đã được duyệt.
 *
 * Vẫn giữ các helper PENDING để đọc / xử lý các yêu cầu cũ còn sót trong
 * system settings (không đổi schema tab NHAN_VIEN_MASTER).
 */
export const BANK_CHANGE_COOLDOWN_MS = 0;
export const BANK_CHANGE_KEY_PREFIX = 'bankChangeRequest:';

export interface BankInfo {
  bank_name?: string;
  bank_account?: string;
  bank_holder?: string;
  bank_qr_img?: string;
}

export interface BankChangeRequest {
  request_id: string;
  employee_id: string;
  requested_at: string;
  requested_by: string;
  apply_after: string;
  status: 'PENDING';
  old: BankInfo;
  requested: BankInfo;
}

/** Serialize read-modify-write system settings: 2 NV gửi cùng lúc không ghi đè nhau. */
let settingsLock: Promise<unknown> = Promise.resolve();
function withSettingsLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = settingsLock.then(fn, fn);
  settingsLock = run.then(() => undefined, () => undefined);
  return run;
}

const text = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  return String(v).trim();
};

/** Chuẩn hóa dữ liệu ngân hàng từ body/employee, giữ chuỗi rỗng để biết NV chủ động xóa. */
export function normalizeBankInfo(raw: any): BankInfo {
  const qr = text(raw?.bankQrImg ?? raw?.bank_qr_img);
  return {
    bank_name: text(raw?.bankName ?? raw?.bank_name)?.slice(0, 100),
    bank_account: text(raw?.bankAccount ?? raw?.bank_account)?.slice(0, 64),
    bank_holder: text(raw?.bankHolder ?? raw?.bank_holder)?.slice(0, 100),
    // Client đã nén QR ≤45KB; cắt thêm để không vượt giới hạn ô Sheets.
    bank_qr_img: qr ? qr.slice(0, 45_000) : (qr === '' ? '' : undefined),
  };
}

const bankNameKey = (v?: string) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
const bankHolderKey = (v?: string) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
/** Khóa so sánh STK: bỏ khoảng trắng/gạch/dấu chấm, giữ nguyên số 0 đầu. */
export const bankAccountKey = (v?: string) => String(v || '').replace(/[\s.-]/g, '').toLowerCase();

/** Tìm nhân viên khác đang dùng cùng STK (so sánh sau chuẩn hóa). */
export function findBankAccountConflict(
  employees: Array<{ employee_id?: string; employee_code?: string; full_name?: string; bank_account?: string }>,
  employeeId: string,
  requestedAccount?: string
): { employee_id: string; employee_code?: string; full_name?: string } | null {
  const key = bankAccountKey(requestedAccount);
  if (!key) return null;
  const clash = employees.find(
    e => !!e?.employee_id && e.employee_id !== employeeId && bankAccountKey(e.bank_account) === key
  );
  if (!clash) return null;
  return {
    employee_id: clash.employee_id as string,
    employee_code: clash.employee_code,
    full_name: clash.full_name,
  };
}

export function bankInfoChanged(current: BankInfo, requested: BankInfo): boolean {
  return (
    bankNameKey(current.bank_name) !== bankNameKey(requested.bank_name) ||
    bankAccountKey(current.bank_account) !== bankAccountKey(requested.bank_account) ||
    bankHolderKey(current.bank_holder) !== bankHolderKey(requested.bank_holder) ||
    String(current.bank_qr_img || '') !== String(requested.bank_qr_img || '')
  );
}

/** Chưa từng có STK -> cho lưu ngay, không cần duyệt. */
export function isFirstBankEntry(current: BankInfo, requested: BankInfo): boolean {
  return !String(current.bank_account || '').trim() && !!String(requested.bank_account || '').trim();
}

export function maskBankAccount(account?: string): string {
  const s = String(account || '').replace(/\s+/g, '');
  if (!s) return '—';
  if (s.length <= 4) return `••${s.slice(-2)}`;
  const visible = s.slice(-4);
  const hidden = '•'.repeat(Math.min(8, Math.max(3, s.length - 4)));
  return `${hidden}${visible}`;
}

export function buildBankChangeRequest(params: {
  employeeId: string;
  requestedBy: string;
  current: BankInfo;
  requested: BankInfo;
  now?: number;
}): BankChangeRequest {
  const now = params.now ?? Date.now();
  return {
    request_id: `BCR_${now}_${randomUUID().slice(0, 8)}`,
    employee_id: params.employeeId,
    requested_at: new Date(now).toISOString(),
    requested_by: params.requestedBy,
    apply_after: new Date(now + BANK_CHANGE_COOLDOWN_MS).toISOString(),
    status: 'PENDING',
    // Không lưu QR cũ trong request: QR cũ vẫn nằm ở hồ sơ NV, tránh payload 2 ảnh > 50KB.
    old: {
      bank_name: params.current.bank_name,
      bank_account: params.current.bank_account,
      bank_holder: params.current.bank_holder,
    },
    requested: {
      bank_name: params.requested.bank_name,
      bank_account: params.requested.bank_account,
      bank_holder: params.requested.bank_holder,
      bank_qr_img: params.requested.bank_qr_img,
    },
  };
}

/** Mốc được duyệt (ms). Giá trị hỏng -> 0 để không khóa cứng yêu cầu cũ. */
export function bankChangeApplyAtMs(request: BankChangeRequest): number {
  const t = new Date(request.apply_after).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Không còn chặn 48h: yêu cầu cũ (nếu có) được duyệt ngay khi HR/Finance xử lý. */
export function canApproveBankChange(_request: BankChangeRequest, _now = Date.now()): boolean {
  return true;
}

export function bankChangeRemainingSeconds(_request: BankChangeRequest, _now = Date.now()): number {
  return 0;
}

function isRequest(value: any, employeeId?: string): value is BankChangeRequest {
  return !!value
    && typeof value === 'object'
    && typeof value.request_id === 'string'
    && typeof value.employee_id === 'string'
    && (!employeeId || value.employee_id === employeeId)
    && value.status === 'PENDING'
    && !!value.requested
    && typeof value.requested === 'object';
}

export async function listPendingBankChangeRequests(repo: ISheetsRepository): Promise<BankChangeRequest[]> {
  const settings = (await repo.getSystemSettings().catch(() => ({}))) || {};
  return Object.entries(settings)
    .filter(([key]) => key.startsWith(BANK_CHANGE_KEY_PREFIX))
    .map(([, value]) => value)
    .filter((value): value is BankChangeRequest => isRequest(value))
    .sort((a, b) => String(a.requested_at).localeCompare(String(b.requested_at)));
}

export async function getPendingBankChangeRequest(
  repo: ISheetsRepository,
  employeeId: string
): Promise<BankChangeRequest | null> {
  const settings = (await repo.getSystemSettings().catch(() => ({}))) || {};
  const value = settings[`${BANK_CHANGE_KEY_PREFIX}${employeeId}`];
  return isRequest(value, employeeId) ? value : null;
}

export async function savePendingBankChangeRequest(
  repo: ISheetsRepository,
  request: BankChangeRequest
): Promise<BankChangeRequest> {
  return withSettingsLock(async () => {
    const settings = (await repo.getSystemSettings().catch(() => ({}))) || {};
    await repo.updateSystemSettings({
      ...settings,
      [`${BANK_CHANGE_KEY_PREFIX}${request.employee_id}`]: request,
    });
    return request;
  });
}

export async function deletePendingBankChangeRequest(
  repo: ISheetsRepository,
  employeeId: string
): Promise<boolean> {
  return withSettingsLock(async () => {
    const settings = (await repo.getSystemSettings().catch(() => ({}))) || {};
    const key = `${BANK_CHANGE_KEY_PREFIX}${employeeId}`;
    if (!(key in settings)) return false;
    // updateSystemSettings MERGE top-level key nên không thể xóa bằng cách bỏ key.
    // Ghi null để vô hiệu hóa yêu cầu; list/get đều bỏ qua giá trị null/rỗng.
    await repo.updateSystemSettings({ ...settings, [key]: null });
    return true;
  });
}

/** Dữ liệu trả về UI: che STK cũ, vẫn đủ thông tin để HR/Finance đối chiếu STK mới. */
export function publicBankChangeRequest(request: BankChangeRequest) {
  return {
    request_id: request.request_id,
    employee_id: request.employee_id,
    requested_at: request.requested_at,
    requested_by: request.requested_by,
    apply_after: request.apply_after,
    status: request.status,
    old: {
      bank_name: request.old?.bank_name || '',
      bank_account: maskBankAccount(request.old?.bank_account),
      bank_holder: request.old?.bank_holder || '',
    },
    requested: {
      bank_name: request.requested?.bank_name || '',
      bank_account: request.requested?.bank_account || '',
      bank_holder: request.requested?.bank_holder || '',
      bank_qr_img: request.requested?.bank_qr_img || '',
    },
  };
}
