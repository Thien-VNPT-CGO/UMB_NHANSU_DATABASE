/**
 * Hình thức lương ("pay mode") — quyết định cách tính lương của 1 nhân viên.
 *
 * Quy tắc (theo quyết định của chủ dự án, 2026-11):
 *  - Khối Cửa Hàng (STORE)   : theo ca (giờ × đơn giá) — CỐ ĐỊNH, không tùy chỉnh.
 *  - Khối Văn Phòng (VAN_PHONG): lương cơ bản theo THÁNG   — CỐ ĐỊNH, không tùy chỉnh.
 *  - Khối Xưởng (XUONG)      : tùy chọn theo ca / theo tháng, cấu hình TỪNG NV (mặc định theo ca).
 *  - Khối Sale (SALE)        : tùy chọn theo tháng / theo ca, cấu hình TỪNG NV (mặc định theo tháng).
 *
 * Kế toán (FINANCE) + Admin cấu hình cho từng NV tại tab "Cấu hình Lương CB & Phụ cấp".
 * Lương 1 NV = Lương cơ bản (tháng, nếu MONTHLY) else (giờ công × đơn giá) + Phụ cấp.
 */
export type PayMode = 'MONTHLY' | 'HOURLY';

export type PayModeGroup = 'STORE' | 'XUONG' | 'VAN_PHONG' | 'SALE' | string;

function groupOf(group: unknown): string {
  return String(group ?? '').trim().toUpperCase();
}

/** Hình thức lương mặc định của khối khi NV chưa được Kế toán cấu hình. */
export function defaultPayModeForGroup(group: unknown): PayMode {
  const g = groupOf(group);
  if (g === 'VAN_PHONG') return 'MONTHLY';
  if (g === 'SALE') return 'MONTHLY';
  // STORE, XUONG và nhóm lạ -> theo ca
  return 'HOURLY';
}

/** Hình thức lương khóa cứng theo khối? (true = không cho tùy chỉnh). */
export function isPayModeLockedToGroup(group: unknown): boolean {
  const g = groupOf(group);
  return g === 'STORE' || g === 'VAN_PHONG';
}

/** Chuẩn hóa một giá trị cấu hình hình thức lương từ input thô (null nếu không hợp lệ). */
export function normalizePayMode(input: unknown): PayMode | undefined {
  const v = String(input ?? '').trim().toUpperCase();
  if (v === 'MONTHLY' || v === 'HOURLY') return v;
  return undefined;
}

/**
 * Hình thức lương HIỆU LỰC của 1 NV.
 * Khối STORE/VAN_PHONG luôn bị ép theo khối; XUONG/SALE theo cấu hình
 * của Kế toán (chưa cấu hình -> mặc định của khối).
 */
export function effectivePayMode(group: unknown, configured?: string | null): PayMode {
  const g = groupOf(group);
  if (g === 'VAN_PHONG') return 'MONTHLY';
  if (g === 'STORE') return 'HOURLY';
  const c = normalizePayMode(configured);
  if (c) return c;
  return defaultPayModeForGroup(g);
}

/** Nhãn hiển thị tiếng Việt cho 1 hình thức lương. */
export function payModeLabel(mode: PayMode): string {
  return mode === 'MONTHLY' ? 'Theo tháng' : 'Theo ca';
}
