/**
 * Tiện ích toạ độ / ngày dùng chung (không phụ thuộc bản đồ giám sát).
 * Tách ra từ live-map.service cũ để các nghiệp vụ điểm danh vẫn dùng được
 * sau khi gỡ chức năng bản đồ GPS.
 */

/** Chuẩn hoá mã chi nhánh (CN1 ↔ CN130...) — dữ liệu Sheet lưu cả 2 kiểu. */
export function canonicalBranchId(raw?: unknown): string {
  const x = String(raw ?? '').trim().toUpperCase();
  if (x === 'CN1' || x === 'CN130') return 'CN130';
  if (x === 'CN2' || x === 'CN261') return 'CN261';
  if (x === 'CN3' || x === 'CN120') return 'CN120';
  if (x === 'CN4' || x === 'CN111') return 'CN111';
  return x;
}

const VN_OFFSET_MS = 7 * 3_600_000;

/** Ngày theo múi giờ Việt Nam (YYYY-MM-DD). */
export function vnDateOf(input?: string | Date | number): string {
  const t = input === undefined ? Date.now() : new Date(input as any).getTime();
  if (!Number.isFinite(t)) return '';
  return new Date(t + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Khoảng cách (m) giữa 2 toạ độ — haversine. */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
