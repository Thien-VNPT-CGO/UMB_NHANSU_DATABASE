import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const BCRYPT_COST = 12;
const BCRYPT_PREFIX = /^\$2[aby]\$\d{2}\$/;

/** True nếu chuỗi đã là bcrypt hash (để hỗ trợ migrate legacy plaintext). */
export function isBcryptHash(value: string | undefined | null): boolean {
  if (!value || typeof value !== 'string') return false;
  return BCRYPT_PREFIX.test(value) && value.length >= 59;
}

export async function hashPassword(plain: string): Promise<string> {
  if (!plain || typeof plain !== 'string' || plain.length < 6) {
    throw new Error('WEAK_PASSWORD');
  }
  if (plain.length > 72) {
    // Giới hạn của bcrypt (72 bytes)
    throw new Error('WEAK_PASSWORD');
  }
  return bcrypt.hash(plain, BCRYPT_COST);
}

export function hashPasswordSync(plain: string): string {
  if (!plain || typeof plain !== 'string' || plain.length < 6) {
    throw new Error('WEAK_PASSWORD');
  }
  return bcrypt.hashSync(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!plain || !hash) return false;
  if (!isBcryptHash(hash)) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/** Mã PIN hợp lệ: đúng 6 chữ số (ràng buộc từ 2026-10). */
export const PIN_RE = /^\d{6}$/;

/**
 * Đầu vào khi đăng nhập: chấp nhận 4-8 chữ số để tài khoản legacy (PIN cũ
 * chưa đủ 6 số) vẫn đăng nhập được 1 lần — server sẽ gắn cờ bắt đổi PIN 6 số
 * mới ngay (hoặc auto-reset nếu phát hiện qua cột pin_code).
 */
export const PIN_INPUT_RE = /^\d{4,8}$/;

/** Hệ thống tự sinh mã PIN khởi tạo (đúng 6 chữ số) gán cho từng tài khoản — không cần HR cấp tay. */
export function generateAutoPin(): string {
  return String(100000 + crypto.randomInt(0, 900000));
}

/** Mã PIN nhân viên: đúng 6 chữ số, hash bcrypt như mật khẩu. */
export async function hashPin(pin: string): Promise<string> {
  if (!pin || typeof pin !== 'string' || !PIN_RE.test(pin)) {
    throw new Error('WEAK_PIN');
  }
  return bcrypt.hash(pin, BCRYPT_COST);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  if (!pin || !hash || !PIN_INPUT_RE.test(pin)) return false;
  return verifyPassword(pin, hash);
}
