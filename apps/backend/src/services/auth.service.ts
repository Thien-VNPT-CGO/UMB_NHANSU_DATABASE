import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import {
  AuthUser,
  ERROR_CODES,
  SystemRole,
  UserPermission,
  EmployeeMaster,
} from '@ubm/shared';
import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { hashPassword, hashPin, isBcryptHash, verifyPassword, verifyPin } from './password.service.js';

const DEFAULT_FALLBACK_JWT_SECRET =
  'ubm-milk-hr-system-jwt-production-secret-key-2026-secure-random-token-v5';

// Production thiếu JWT_SECRET: sinh secret ngẫu nhiên mỗi lần boot thay vì dùng
// key cứng trong source (ai đọc source cũng ký được token giả). Token cũ hết
// hiệu lực sau mỗi lần restart — chấp nhận được so với nguy cơ giả mạo.
let ephemeralProdSecret: string | null = null;

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.trim().length >= 16) return secret.trim();

  if (process.env.NODE_ENV === 'production') {
    if (!ephemeralProdSecret) {
      ephemeralProdSecret = crypto.randomBytes(48).toString('hex');
      console.error(
        '[auth] NGUY HIỂM: JWT_SECRET chưa được cấu hình! Đã sinh secret ngẫu nhiên tạm thời — mọi phiên đăng nhập sẽ hết hiệu lực khi restart. Hãy cấu hình JWT_SECRET (tối thiểu 16 ký tự) ngay.'
      );
    }
    return ephemeralProdSecret;
  }

  // Dev/local: fallback hằng số cho tiện, không dùng ở production.
  console.warn(
    '[auth] JWT_SECRET chưa được cấu hình — dùng dev fallback key. Không dùng cấu hình này ở production.'
  );
  return DEFAULT_FALLBACK_JWT_SECRET;
}

export function getAccessTtl(): string {
  return process.env.JWT_ACCESS_TTL || '8h';
}

export function getRefreshTtl(): string {
  return process.env.JWT_REFRESH_TTL || '7d';
}

export type AccessTokenType = 'access';
export type RefreshTokenType = 'refresh';

interface BasePayload {
  sub: string;
  role: SystemRole;
  branchScope: string;
  fullName?: string;
  tv: number; // token version = account.version lúc phát hành (để revoke)
  typ: AccessTokenType | RefreshTokenType;
  did?: string; // deviceId đã khóa (chỉ tài khoản EMPLOYEE)
}

interface EmployeePayload extends BasePayload {
  employeeId: string;
  phone: string;
  permissions: UserPermission[];
}

interface AdminPayload extends BasePayload {
  permissions: UserPermission[];
}

function signAccess(payload: Omit<BasePayload, 'typ'> & Partial<EmployeePayload & AdminPayload>): string {
  return jwt.sign({ ...payload, typ: 'access' as const }, getJwtSecret(), {
    expiresIn: getAccessTtl() as any,
  });
}

function signRefresh(payload: Omit<BasePayload, 'typ'> & Partial<EmployeePayload & AdminPayload>): string {
  return jwt.sign({ ...payload, typ: 'refresh' as const }, getJwtSecret(), {
    expiresIn: getRefreshTtl() as any,
  });
}

export function normalizePhone(phone: string): string {
  if (!phone) return '';
  let cleaned = phone.replace(/[\s\-\.\(\)]/g, '');
  if (cleaned.startsWith('+84')) {
    cleaned = '0' + cleaned.slice(3);
  } else if (cleaned.startsWith('84')) {
    cleaned = '0' + cleaned.slice(2);
  }
  return cleaned;
}

export function getPermissionsForRole(role: SystemRole): UserPermission[] {
  switch (role) {
    case 'ADMIN':
      return [
        'ACCOUNTS_MANAGE',
        'EMPLOYEES_MANAGE',
        'SCHEDULE_MANAGE',
        'LEAVE_APPROVE',
        'ATTENDANCE_VIEW',
        'ATTENDANCE_VERIFY',
        'PAYROLL_CREATE',
        'PAYROLL_APPROVER',
        'ANNOUNCEMENTS_MANAGE',
        'AUDIT_VIEW',
      ];
    case 'HR':
      return [
        'EMPLOYEES_MANAGE',
        'SCHEDULE_MANAGE',
        'LEAVE_APPROVE',
        'ATTENDANCE_VIEW',
        'ATTENDANCE_VERIFY',
        'ANNOUNCEMENTS_MANAGE',
      ];
    case 'STORE':
      return [
        'SCHEDULE_MANAGE',
        'LEAVE_APPROVE',
        'ATTENDANCE_VIEW',
        'ATTENDANCE_VERIFY',
      ];
    case 'FINANCE':
      return [
        'ATTENDANCE_VIEW',
        'PAYROLL_CREATE',
        'PAYROLL_APPROVER',
      ];
    case 'MARKETING':
      return [
        'ANNOUNCEMENTS_MANAGE',
      ];
    case 'EMPLOYEE':
    default:
      return [];
  }
}

/** Ẩn password_hash trước khi trả về qua API. */
export function sanitizeAdmin(admin: any) {
  if (!admin || typeof admin !== 'object') return admin;
  const { password_hash: _omit, ...rest } = admin;
  return rest;
}

export class AuthService {
  constructor(private repo: ISheetsRepository) {}

  async loginWithPhone(phoneInput: string, pinInput?: string, deviceId?: string): Promise<{
    token: string;
    refreshToken: string;
    employee: EmployeeMaster;
    role: SystemRole;
    stage: string;
    mustChangePin: boolean;
    deviceLocked: boolean;
  }> {
    const normalized = normalizePhone(phoneInput);
    if (!normalized) {
      throw new Error(ERROR_CODES.ACCOUNT_NOT_FOUND);
    }

    const accounts = await this.repo.findAccountByPhone(normalized);

    if (accounts.length === 0) {
      throw new Error(ERROR_CODES.ACCOUNT_NOT_FOUND);
    }

    // SĐT trùng nhiều tài khoản: dùng mã PIN để phân biệt — PIN đúng của
    // tài khoản nào thì vào tài khoản đó, khỏi cần HR đối soát tay.
    // (Kẻ chỉ biết SĐT mà không biết PIN vẫn không vào được.)
    let account = accounts[0];
    if (accounts.length > 1) {
      const matched = [];
      for (const a of accounts) {
        if (!a.pin_hash || !pinInput) continue;
        if (await verifyPin(pinInput, a.pin_hash)) matched.push(a);
      }
      if (matched.length === 1) {
        account = matched[0];
      } else if (matched.length === 0) {
        // Không lộ có bao nhiêu tài khoản: báo sai PIN như bình thường.
        throw new Error('INVALID_PIN');
      } else {
        // Hiếm: 2 tài khoản trùng cả SĐT lẫn PIN -> vẫn cần HR đối soát.
        throw new Error(ERROR_CODES.DUPLICATE_PHONE_NEEDS_HR);
      }
    }

    // Không còn luồng kích hoạt/khóa: SĐT + PIN hợp lệ là đăng nhập được.

    // PIN do HR cấp — chặn ké tài khoản chỉ biết SĐT.
    if (!account.pin_hash) {
      throw new Error('PIN_NOT_SET');
    }
    if (!pinInput || !(await verifyPin(pinInput, account.pin_hash))) {
      throw new Error('INVALID_PIN');
    }

    const employee = await this.repo.getEmployeeById(account.employee_id);
    if (!employee || employee.employment_status === 'TERMINATED') {
      throw new Error(ERROR_CODES.EMPLOYMENT_NOT_ELIGIBLE);
    }

    // KHÓA 1 THIẾT BỊ DUY NHẤT: tài khoản đã khóa mà device gửi lên khác -> chặn.
    // Chưa khóa + client gửi deviceId -> bind ngay lần đăng nhập này (kể cả
    // tài khoản cũ đã qua đổi PIN, để dần khóa hết toàn hệ thống).
    const bound = (account as any).bound_device_id as string | undefined;
    const did = (deviceId || '').trim();
    if (bound) {
      if (!did || did !== bound) {
        await this.repo.recordAuditLog({
          log_id: `LOG_${Date.now()}`,
          actor_id: employee.employee_id,
          actor_role: 'EMPLOYEE',
          action: 'LOGIN_DEVICE_MISMATCH',
          target_entity: 'TAI_KHOAN_NHAN_VIEN',
          target_id: account.account_id,
          details: `Login blocked: device ${did || '(missing)'} != bound device`,
        }).catch(() => null);
        throw new Error('DEVICE_MISMATCH');
      }
    } else if (did) {
      try {
        const updated = await this.repo.setAccountDevice(account.account_id, did, employee.employee_id);
        account = updated;
      } catch {
        // Bind thất bại không chặn đăng nhập (client cũ/Sheets lỗi) — lần sau thử lại.
      }
    }

    const base = {
      sub: account.account_id,
      employeeId: employee.employee_id,
      role: 'EMPLOYEE' as SystemRole,
      branchScope: account.branch_scope,
      phone: employee.phone_normalized,
      fullName: employee.full_name,
      permissions: [] as UserPermission[],
      tv: account.version,
      did: (account as any).bound_device_id || did || undefined,
    };

    const token = signAccess(base);
    const refreshToken = signRefresh(base);

    // Record audit
    await this.repo.recordAuditLog({
      log_id: `LOG_${Date.now()}`,
      actor_id: employee.employee_id,
      actor_role: 'EMPLOYEE',
      action: 'LOGIN_PHONE_SUCCESS',
      target_entity: 'TAI_KHOAN_NHAN_VIEN',
      target_id: account.account_id,
      details: `Phone ${normalized} logged in as ${employee.employment_status}`,
    });

    return {
      token,
      refreshToken,
      employee,
      role: 'EMPLOYEE',
      stage: employee.employment_status,
      mustChangePin: account.pin_must_change === true,
      deviceLocked: !!(account as any).bound_device_id,
    };
  }

  /** Nhân viên tự đổi PIN (luôn yêu cầu PIN cũ). Xóa cờ bắt-đổi-lần-đầu + khóa thiết bị. */
  async changeEmployeePin(accountId: string, oldPin: string, newPin: string, deviceId?: string) {
    const account = await this.repo.getAccountById(accountId);
    if (!account) throw new Error('ACCOUNT_NOT_FOUND');
    if (!account.pin_hash || !(await verifyPin(oldPin, account.pin_hash))) {
      throw new Error('INVALID_PIN');
    }
    // Thiết bị lạ không được đổi PIN để chiếm khóa.
    const bound = (account as any).bound_device_id as string | undefined;
    const did = (deviceId || '').trim();
    if (bound && did && did !== bound) {
      throw new Error('DEVICE_MISMATCH');
    }
    const hashed = await hashPin(newPin); // ném WEAK_PIN nếu sai định dạng
    // NV tự đổi PIN -> cập nhật luôn bản rõ để HR dễ quản lý (cột Mã PIN hiển thị mã mới nhất).
    const updated = await this.repo.setAccountPin(accountId, hashed, false, account.employee_id, newPin);
    // Khóa thiết bị ngay khi đổi PIN (trường hợp login chưa bind, ví dụ client cũ).
    if (!bound && did) {
      try {
        await this.repo.setAccountDevice(accountId, did, account.employee_id);
      } catch {
        // không chặn — đã đổi PIN thành công
      }
    }
    return updated;
  }

  async loginAdmin(username: string, password: string): Promise<{
    token: string;
    refreshToken: string;
    user: AuthUser;
  }> {
    const admin = await this.repo.getAdminByUsername(username);

    if (!admin) {
      throw new Error('INVALID_CREDENTIALS');
    }
    // Tài khoản nội bộ bị khóa: không cho đăng nhập lại.
    if (admin.is_active === false) {
      throw new Error('ACCOUNT_LOCKED');
    }

    let ok = false;
    if (isBcryptHash(admin.password_hash)) {
      ok = await verifyPassword(password, admin.password_hash);
    } else {
      // Migrate legacy plaintext một lần duy nhất, sau đó hash lại.
      // Không có backdoor: chỉ chấp nhận đúng mật khẩu đang lưu.
      if (admin.password_hash === password) {
        ok = true;
        try {
          const hashed = await hashPassword(password);
          await this.repo.updateAdminAccount(admin.admin_id, {
            password_hash: hashed,
          } as any);
          admin.password_hash = hashed;
        } catch (e) {
          console.warn('[auth] legacy password re-hash failed:', (e as Error).message);
        }
      }
    }

    if (!ok) {
      throw new Error('INVALID_CREDENTIALS');
    }

    const permissions = getPermissionsForRole(admin.role);

    const user: AuthUser = {
      id: admin.admin_id,
      role: admin.role,
      branchScope: admin.branch_scope,
      phone: '',
      fullName: admin.full_name,
      permissions,
    };

    const base = {
      sub: admin.admin_id,
      role: admin.role,
      branchScope: admin.branch_scope,
      fullName: admin.full_name,
      permissions,
      tv: admin.version,
    };

    const token = signAccess(base);
    const refreshToken = signRefresh(base);

    await this.repo.recordAuditLog({
      log_id: `LOG_${Date.now()}`,
      actor_id: admin.admin_id,
      actor_role: admin.role,
      action: 'ADMIN_LOGIN_SUCCESS',
      target_entity: 'TAI_KHOAN_ADMIN',
      target_id: admin.admin_id,
      details: `User ${admin.username} logged in with role ${admin.role}`,
    });

    return { token, refreshToken, user };
  }

  /** Đổi mật khẩu admin (yêu cầu mật khẩu cũ). */
  async changeAdminPassword(adminId: string, oldPassword: string, newPassword: string) {
    const admins = await this.repo.listAdminAccounts();
    const admin = admins.find(a => a.admin_id === adminId);
    if (!admin || admin.is_active === false) throw new Error('ADMIN_NOT_FOUND');

    let ok = false;
    if (isBcryptHash(admin.password_hash)) {
      ok = await verifyPassword(oldPassword, admin.password_hash);
    } else {
      ok = admin.password_hash === oldPassword;
    }
    if (!ok) throw new Error('INVALID_CREDENTIALS');

    const hashed = await hashPassword(newPassword); // ném WEAK_PASSWORD nếu yếu
    const updated = await this.repo.updateAdminAccount(adminId, {
      password_hash: hashed,
    } as any);

    await this.repo.recordAuditLog({
      log_id: `LOG_${Date.now()}`,
      actor_id: adminId,
      actor_role: admin.role,
      action: 'ADMIN_PASSWORD_CHANGED',
      target_entity: 'TAI_KHOAN_ADMIN',
      target_id: adminId,
      details: 'Password changed',
    });

    return sanitizeAdmin(updated);
  }

  /** Dùng refresh token (typ=refresh) để cấp lại access token mới, có kiểm tra version/khóa. */
  async refreshAccessToken(refreshToken: string): Promise<{ token: string }> {
    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, getJwtSecret()) as any;
    } catch {
      throw new Error('INVALID_REFRESH_TOKEN');
    }
    if (decoded.typ !== 'refresh') throw new Error('INVALID_REFRESH_TOKEN');

    if (decoded.role === 'EMPLOYEE') {
      const account = await this.repo.getAccountById(decoded.sub);
      if (!account || account.version !== decoded.tv) {
        throw new Error('REFRESH_REVOKED');
      }
      // Token refresh từ thiết bị lạ -> chặn (kẻ có refresh token copy cũng vô dụng).
      const boundRefresh = (account as any).bound_device_id as string | undefined;
      if (boundRefresh && decoded.did !== boundRefresh) {
        throw new Error('DEVICE_MISMATCH');
      }
      const employee = await this.repo.getEmployeeById(account.employee_id);
      const token = signAccess({
        sub: account.account_id,
        employeeId: account.employee_id,
        role: 'EMPLOYEE',
        branchScope: account.branch_scope,
        phone: employee?.phone_normalized || decoded.phone || '',
        fullName: employee?.full_name || decoded.fullName || '',
        permissions: [],
        tv: account.version,
        did: boundRefresh || decoded.did,
      });
      return { token };
    }

    const admins = await this.repo.listAdminAccounts();
    const admin = admins.find(a => a.admin_id === decoded.sub);
    if (!admin || admin.is_active === false || admin.version !== decoded.tv) {
      throw new Error('REFRESH_REVOKED');
    }
    const token = signAccess({
      sub: admin.admin_id,
      role: admin.role,
      branchScope: admin.branch_scope,
      fullName: admin.full_name,
      permissions: getPermissionsForRole(admin.role),
      tv: admin.version,
    });
    return { token };
  }

  /** Xác thực access token + kiểm tra version/khóa. Dùng chung cho middleware & socket. */
  async verifyAccessToken(token: string): Promise<AuthUser & { tv: number }> {
    let decoded: any;
    try {
      decoded = jwt.verify(token, getJwtSecret()) as any;
    } catch (e: any) {
      if (e?.name === 'TokenExpiredError') throw new Error('TOKEN_EXPIRED');
      throw new Error('INVALID_TOKEN');
    }
    if (decoded.typ && decoded.typ !== 'access') throw new Error('INVALID_TOKEN');

    if (decoded.role === 'EMPLOYEE') {
      let account = null;
      try {
        account = await this.repo.getAccountById(decoded.sub);
      } catch (e: any) {
        // DB/Sheets sự cố: degraded mode — tin claims trong token để route
        // handler tự trả lỗi SHEETS_UNAVAILABLE thay vì middleware chặn 401.
        if (String(e?.message || '').includes('SHEETS_')) {
          return {
            id: decoded.sub,
            employeeId: decoded.employeeId,
            role: decoded.role,
            branchScope: decoded.branchScope || '*',
            phone: decoded.phone || '',
            fullName: decoded.fullName || '',
            permissions: decoded.permissions || [],
            tv: decoded.tv,
          };
        }
        throw e;
      }
      if (!account) throw new Error('ACCOUNT_REVOKED');
      if (typeof decoded.tv === 'number' && account.version !== decoded.tv) {
        throw new Error('TOKEN_REVOKED');
      }
      // Access token từ thiết bị lạ (kể cả token cũ chưa có did) -> chặn.
      const boundVerify = (account as any).bound_device_id as string | undefined;
      if (boundVerify && decoded.did !== boundVerify) {
        throw new Error('DEVICE_MISMATCH');
      }
      return {
        id: decoded.sub,
        employeeId: decoded.employeeId,
        role: decoded.role,
        branchScope: decoded.branchScope || '*',
        phone: decoded.phone || '',
        fullName: decoded.fullName || '',
        permissions: decoded.permissions || [],
        mustChangePin: account.pin_must_change === true,
        tv: decoded.tv,
      };
    }

    let admin = null;
    try {
      const admins = await this.repo.listAdminAccounts();
      admin = admins.find(a => a.admin_id === decoded.sub);
    } catch (e: any) {
      // Degraded mode khi Sheets lỗi — xem employee branch ở trên.
      if (String(e?.message || '').includes('SHEETS_')) {
        return {
          id: decoded.sub,
          role: decoded.role,
          branchScope: decoded.branchScope || '*',
          phone: decoded.phone || '',
          fullName: decoded.fullName || '',
          permissions: decoded.permissions || [],
          tv: decoded.tv,
        };
      }
      throw e;
    }
    if (!admin || admin.is_active === false) throw new Error('ACCOUNT_REVOKED');
    if (typeof decoded.tv === 'number' && admin.version !== decoded.tv) {
      throw new Error('TOKEN_REVOKED');
    }
    return {
      id: decoded.sub,
      role: decoded.role,
      branchScope: decoded.branchScope || '*',
      phone: decoded.phone || '',
      fullName: decoded.fullName || admin.full_name || '',
      permissions: decoded.permissions || getPermissionsForRole(admin.role),
      tv: decoded.tv,
    };
  }
}
