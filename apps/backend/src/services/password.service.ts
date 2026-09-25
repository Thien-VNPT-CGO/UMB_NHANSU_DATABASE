import bcrypt from 'bcryptjs';

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
