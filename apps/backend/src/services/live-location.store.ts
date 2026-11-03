/**
 * Kho vị trí GPS "sống" của cổng nhân viên.
 *
 * Cổng NV dùng `navigator.geolocation.watchPosition` và gửi toạ độ thật lên
 * backend định kỳ (~30s) khi đang trong khung ca. Vị trí chỉ giữ trong bộ nhớ
 * (không ghi Google Sheets) để bản đồ admin cập nhật realtime mà không đốt quota.
 *
 * Bản ghi cũ hơn TTL (mặc định 3 phút) tự bị loại — app NV tắt/mất mạng thì
 * bản đồ rơi về GPS lần chấm công gần nhất hoặc toạ độ cửa hàng.
 */
export interface LiveLocationPing {
  employee_id: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  assignment_id?: string;
  /** ISO thời điểm server nhận ping. */
  at: string;
  /** Epoch ms thời điểm server nhận ping (dùng để kiểm tra TTL). */
  at_ms: number;
}

export const LIVE_LOCATION_TTL_MS = 3 * 60_000;

export class LiveLocationStore {
  private map = new Map<string, LiveLocationPing>();
  private lastPruneAt = 0;

  constructor(private ttlMs: number = LIVE_LOCATION_TTL_MS) {}

  /** Lưu/cập nhật vị trí mới nhất của 1 nhân viên. */
  upsert(ping: Omit<LiveLocationPing, 'at' | 'at_ms'>, nowMs: number = Date.now()): LiveLocationPing {
    const record: LiveLocationPing = {
      ...ping,
      at: new Date(nowMs).toISOString(),
      at_ms: nowMs,
    };
    this.map.set(String(ping.employee_id), record);
    this.prune(nowMs);
    return record;
  }

  /** Vị trí còn "tươi" của nhân viên, hoặc null nếu chưa có/hết hạn. */
  get(employeeId: string, nowMs: number = Date.now()): LiveLocationPing | null {
    const rec = this.map.get(String(employeeId));
    if (!rec) return null;
    if (nowMs - rec.at_ms > this.ttlMs) {
      this.map.delete(String(employeeId));
      return null;
    }
    return rec;
  }

  /** Toàn bộ vị trí còn hiệu lực. */
  list(nowMs: number = Date.now()): LiveLocationPing[] {
    this.prune(nowMs);
    return Array.from(this.map.values());
  }

  /** Xoá các bản ghi quá TTL (chạy tối đa mỗi 30s/lần để không quét liên tục). */
  prune(nowMs: number = Date.now()): number {
    if (nowMs - this.lastPruneAt < 30_000) return 0;
    this.lastPruneAt = nowMs;
    let removed = 0;
    for (const [id, rec] of this.map) {
      if (nowMs - rec.at_ms > this.ttlMs) {
        this.map.delete(id);
        removed++;
      }
    }
    return removed;
  }

  clear() {
    this.map.clear();
    this.lastPruneAt = 0;
  }
}
