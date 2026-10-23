/**
 * Khóa đăng nhập tạm thời theo (phạm vi + tài khoản + IP).
 *
 * Vì sao không khóa theo tài khoản một mình: kẻ xấu chỉ cần biết SĐT/tên đăng
 * nhập là có thể cố tình nhập sai 5 lần để khóa tài khoản của người khác (DoS).
 * Ghép thêm IP giúp người dùng thật ở mạng khác không bị ảnh hưởng; đồng thời
 * vẫn chặn được dò PIN/mật khẩu từ một máy.
 *
 * Bộ đếm nằm trong bộ nhớ (phù hợp mô hình 1 instance hiện tại). Khi chuyển
 * sang nhiều instance/Postgres+Redis, thay phần lưu trữ bằng Redis cùng API.
 */

export interface LoginLockoutOptions {
  maxFailures?: number;
  windowMs?: number;
  lockMs?: number;
  now?: () => number;
}

export interface LoginLockoutResult {
  locked: boolean;
  /** Số giây cần chờ trước khi thử lại (0 nếu không bị khóa). */
  retryAfterSeconds: number;
  /** Số lần sai trong cửa sổ hiện tại. */
  failures: number;
  /** Số lần thử còn lại trước khi bị khóa. */
  remainingAttempts: number;
}

interface AttemptState {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
}

const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_WINDOW_MS = 15 * 60_000;
const DEFAULT_LOCK_MS = 15 * 60_000;
const MAX_TRACKED_KEYS = 5_000;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

/** Chuẩn hóa SĐT để các biến thể +84/84/0... dùng chung một bộ đếm. */
export function normalizeLoginIdentifier(scope: 'employee' | 'admin', identifier: string): string {
  const raw = String(identifier || '').trim().toLowerCase();
  if (scope !== 'employee') return raw;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return raw;
  // 84xxxxxxxxx / +84xxxxxxxxx / 0084xxxxxxxxx -> 0xxxxxxxxx
  if (digits.startsWith('0084')) return `0${digits.slice(4)}`;
  if (digits.length >= 9 && digits.startsWith('84')) return `0${digits.slice(2)}`;
  return digits;
}

/**
 * Khóa theo tài khoản + IP. IP do route truyền vào (đã lấy qua proxy header).
 */
export function buildLoginLockoutKey(
  scope: 'employee' | 'admin',
  identifier: string,
  ip: string,
): string {
  const id = normalizeLoginIdentifier(scope, identifier);
  const safeIp = String(ip || 'unknown').trim() || 'unknown';
  return `${scope}:${id}:${safeIp}`;
}

export class LoginLockoutService {
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly lockMs: number;
  private readonly now: () => number;
  private readonly attempts = new Map<string, AttemptState>();

  constructor(options: LoginLockoutOptions = {}) {
    this.maxFailures = Math.max(1, Math.floor(options.maxFailures ?? DEFAULT_MAX_FAILURES));
    this.windowMs = Math.max(1_000, Math.floor(options.windowMs ?? DEFAULT_WINDOW_MS));
    this.lockMs = Math.max(1_000, Math.floor(options.lockMs ?? DEFAULT_LOCK_MS));
    this.now = options.now ?? (() => Date.now());
  }

  /** Kiểm tra trạng thái khóa mà không tăng bộ đếm. */
  check(key: string): LoginLockoutResult {
    const now = this.now();
    const state = this.attempts.get(key);
    if (!state) return this.unlocked(0);
    if (state.lockedUntil > now) {
      return {
        locked: true,
        retryAfterSeconds: Math.max(1, Math.ceil((state.lockedUntil - now) / 1000)),
        failures: state.failures,
        remainingAttempts: 0,
      };
    }
    // Hết hạn khóa hoặc cửa sổ đếm cũ: dọn để lần đăng nhập tới bắt đầu lại.
    if (state.lockedUntil > 0 || now - state.firstFailureAt > this.windowMs) {
      this.attempts.delete(key);
      return this.unlocked(0);
    }
    return {
      locked: false,
      retryAfterSeconds: 0,
      failures: state.failures,
      remainingAttempts: Math.max(0, this.maxFailures - state.failures),
    };
  }

  /** Ghi nhận một lần đăng nhập thất bại; tự khóa khi vượt ngưỡng. */
  recordFailure(key: string): LoginLockoutResult {
    const now = this.now();
    this.pruneIfNeeded(now);

    let current = this.attempts.get(key);
    if (current && current.lockedUntil > now) {
      return this.check(key);
    }
    // Vừa hết thời gian khóa: mở cửa sổ mới, không cộng dồn số lần sai cũ
    // (nếu cộng dồn, chỉ cần sai thêm 1 lần là bị khóa lại ngay).
    if (current && current.lockedUntil > 0 && current.lockedUntil <= now) {
      this.attempts.delete(key);
      current = undefined;
    }

    const withinWindow = !!current && now - current.firstFailureAt <= this.windowMs;
    const failures = (withinWindow && current ? current.failures : 0) + 1;
    const firstFailureAt = withinWindow && current ? current.firstFailureAt : now;

    if (failures >= this.maxFailures) {
      const state: AttemptState = {
        failures,
        firstFailureAt,
        lockedUntil: now + this.lockMs,
      };
      this.attempts.set(key, state);
      return {
        locked: true,
        retryAfterSeconds: Math.max(1, Math.ceil(this.lockMs / 1000)),
        failures,
        remainingAttempts: 0,
      };
    }

    this.attempts.set(key, { failures, firstFailureAt, lockedUntil: 0 });
    return {
      locked: false,
      retryAfterSeconds: 0,
      failures,
      remainingAttempts: Math.max(0, this.maxFailures - failures),
    };
  }

  /** Đăng nhập thành công: xóa bộ đếm của key này. */
  reset(key: string): void {
    this.attempts.delete(key);
  }

  /** Chỉ dùng cho test/giám sát. */
  size(): number {
    return this.attempts.size;
  }

  private unlocked(failures: number): LoginLockoutResult {
    return {
      locked: false,
      retryAfterSeconds: 0,
      failures,
      remainingAttempts: Math.max(0, this.maxFailures - failures),
    };
  }

  private pruneIfNeeded(now: number): void {
    if (this.attempts.size < MAX_TRACKED_KEYS) return;
    for (const [key, state] of this.attempts) {
      if (state.lockedUntil <= now && now - state.firstFailureAt > this.windowMs) {
        this.attempts.delete(key);
      }
    }
  }
}

/**
 * Singleton dùng chung cho toàn server. Đọc cấu hình một lần lúc khởi động.
 * Muốn đổi ngưỡng: LOGIN_MAX_FAILURES / LOGIN_FAILURE_WINDOW_MINUTES /
 * LOGIN_LOCKOUT_MINUTES trong .env rồi restart.
 */
export const loginLockout = new LoginLockoutService({
  maxFailures: positiveInt(process.env.LOGIN_MAX_FAILURES, DEFAULT_MAX_FAILURES),
  windowMs: positiveInt(process.env.LOGIN_FAILURE_WINDOW_MINUTES, DEFAULT_WINDOW_MS / 60_000) * 60_000,
  lockMs: positiveInt(process.env.LOGIN_LOCKOUT_MINUTES, DEFAULT_LOCK_MS / 60_000) * 60_000,
});
