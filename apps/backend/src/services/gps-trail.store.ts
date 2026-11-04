import fs from 'fs';
import path from 'path';

/**
 * Lưu VẾT GPS (hành trình) của cổng nhân viên xuống đĩa dạng JSONL theo ngày.
 *
 * - Mỗi dòng là 1 điểm: `{ employee_id, latitude, longitude, accuracy?, at, at_ms }`.
 * - Một file/ngày giờ VN: `data/gps-trail/YYYY-MM-DD.jsonl`.
 * - KHÔNG ghi Google Sheets (đang quá tải quota) và không đụng PostgreSQL: file
 *   nằm cùng volume `data/` sẵn có của Docker nên sống sót qua restart/redeploy.
 * - Ghi có tiết chế: chỉ ghi khi di chuyển ≥ MIN_MOVE_M hoặc cách điểm trước
 *   ≥ MIN_INTERVAL_MS, tránh phình file khi NV đứng yên.
 */

const MIN_MOVE_M = 30;
const MIN_INTERVAL_MS = 120_000;
const VN_OFFSET_MS = 7 * 3_600_000;
/** Giữ bao nhiêu ngày vết (dọn file cũ hơn khi ghi). */
const RETENTION_DAYS = 60;

export interface GpsTrailPoint {
  employee_id: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  assignment_id?: string;
  branch_id?: string;
  at: string;
  at_ms: number;
}

export interface GpsTrailSummary {
  points: number;
  first_at: string | null;
  last_at: string | null;
  tracked_minutes: number;
  inside_minutes: number;
  outside_minutes: number;
  distance_meters: number;
}

function resolveTrailDir(): string {
  if (process.env.GPS_TRAIL_DIR) {
    try { fs.mkdirSync(process.env.GPS_TRAIL_DIR, { recursive: true }); } catch { /* ignore */ }
    return process.env.GPS_TRAIL_DIR;
  }
  const cwd = process.cwd();
  const rootData = path.join(cwd, 'data', 'gps-trail');
  const backendData = path.join(cwd, 'apps', 'backend', 'data', 'gps-trail');
  let selected = rootData;
  if (!fs.existsSync(path.join(cwd, 'data')) && fs.existsSync(path.join(cwd, 'apps', 'backend', 'data'))) {
    selected = backendData;
  }
  try { fs.mkdirSync(selected, { recursive: true }); } catch { /* ignore */ }
  return selected;
}

/** Resolve lười để test có thể đổi GPS_TRAIL_DIR trước lần dùng đầu tiên. */
let trailDirCache: string | null = null;
export function gpsTrailDir(): string {
  if (!trailDirCache) trailDirCache = resolveTrailDir();
  return trailDirCache;
}

function vnDateOf(ms: number): string {
  return new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10);
}

function safeDate(date?: string): string {
  const raw = String(date || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return vnDateOf(Date.now());
}

function trailPath(date: string): string {
  return path.join(gpsTrailDir(), `${safeDate(date)}.jsonl`);
}

/** Khoảng cách (m) giữa 2 toạ độ — haversine. */
export function trailDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const rad = (v: number) => (v * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** Điểm ghi gần nhất theo NV để tiết chế ghi (chỉ trong bộ nhớ). */
const lastWritten = new Map<string, GpsTrailPoint>();

/**
 * Ghi 1 điểm vết (best-effort, không bao giờ throw, không chặn request).
 * Trả về true nếu thực sự ghi (đã qua ngưỡng tiết chế).
 */
export function appendGpsTrail(p: Omit<GpsTrailPoint, 'at_ms'> & { at_ms?: number }, nowMs = Date.now()): boolean {
  try {
    if (!p || !p.employee_id) return false;
    const lat = Number(p.latitude);
    const lon = Number(p.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    const atMs = Number.isFinite(Number(p.at_ms)) ? Number(p.at_ms) : nowMs;
    const record: GpsTrailPoint = {
      employee_id: String(p.employee_id),
      latitude: lat,
      longitude: lon,
      accuracy: Number.isFinite(Number(p.accuracy)) ? Number(p.accuracy) : undefined,
      assignment_id: p.assignment_id ? String(p.assignment_id) : undefined,
      branch_id: p.branch_id ? String(p.branch_id) : undefined,
      at: String(p.at || new Date(atMs).toISOString()),
      at_ms: atMs,
    };

    const prev = lastWritten.get(record.employee_id);
    if (prev) {
      const moved = trailDistanceMeters(prev.latitude, prev.longitude, record.latitude, record.longitude);
      const elapsed = atMs - prev.at_ms;
      if (moved < MIN_MOVE_M && elapsed < MIN_INTERVAL_MS) return false;
      // Cùng ngày nhưng lùi thời gian (đồng hồ máy lệch): vẫn ghi để không mất vết.
    }

    const line = JSON.stringify(record) + '\n';
    fs.appendFile(trailPath(vnDateOf(atMs)), line, () => { /* best-effort */ });
    lastWritten.set(record.employee_id, record);
    return true;
  } catch {
    return false;
  }
}

/** Đọc vết 1 ngày (tuỳ chọn lọc theo NV). Best-effort, trả [] khi lỗi. */
export function readGpsTrail(date?: string, employeeId?: string): GpsTrailPoint[] {
  try {
    const p = trailPath(safeDate(date));
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, 'utf8');
    const out: GpsTrailPoint[] = [];
    for (const line of raw.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        const rec = JSON.parse(s) as GpsTrailPoint;
        if (!rec || !rec.employee_id) continue;
        if (employeeId && String(rec.employee_id) !== String(employeeId)) continue;
        if (!Number.isFinite(Number(rec.at_ms))) rec.at_ms = new Date(rec.at).getTime();
        out.push(rec);
      } catch { /* dòng hỏng: bỏ qua */ }
    }
    out.sort((a, b) => a.at_ms - b.at_ms);
    return out;
  } catch {
    return [];
  }
}

/** Ngày có vết (mới nhất trước) — cho bộ chọn ngày. */
export function listGpsTrailDates(): string[] {
  try {
    return fs.readdirSync(gpsTrailDir())
      .filter(n => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n))
      .map(n => n.replace('.jsonl', ''))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/**
 * Tổng hợp vết thành số liệu: tổng thời gian theo dõi + thời gian trong/ngoài
 * bán kính cửa hàng + quãng đường di chuyển. Khoảng nghỉ giữa 2 điểm quá dài
 * (> 15 phút) coi như mất tín hiệu, không tính vào thời gian.
 */
export function summarizeGpsTrail(
  points: GpsTrailPoint[],
  center?: { lat: number; lng: number; radius: number },
): GpsTrailSummary {
  const list = (points || []).slice().sort((a, b) => a.at_ms - b.at_ms);
  if (list.length === 0) {
    return { points: 0, first_at: null, last_at: null, tracked_minutes: 0, inside_minutes: 0, outside_minutes: 0, distance_meters: 0 };
  }
  const GAP_CAP_MIN = 15;
  const radius = Number(center?.radius) || 0;
  let inside = 0;
  let outside = 0;
  let dist = 0;
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1];
    const b = list[i];
    const dtMin = (b.at_ms - a.at_ms) / 60_000;
    if (!Number.isFinite(dtMin) || dtMin <= 0) continue;
    dist += trailDistanceMeters(a.latitude, a.longitude, b.latitude, b.longitude);
    const capped = Math.min(dtMin, GAP_CAP_MIN);
    if (center && radius > 0) {
      const d = trailDistanceMeters(a.latitude, a.longitude, center.lat, center.lng);
      if (d <= radius) inside += capped; else outside += capped;
    } else {
      outside += capped;
    }
  }
  return {
    points: list.length,
    first_at: list[0].at || new Date(list[0].at_ms).toISOString(),
    last_at: list[list.length - 1].at || new Date(list[list.length - 1].at_ms).toISOString(),
    tracked_minutes: Math.round(inside + outside),
    inside_minutes: Math.round(inside),
    outside_minutes: Math.round(outside),
    distance_meters: Math.round(dist),
  };
}

/** Dọn file vết cũ hơn RETENTION_DAYS (chạy nền định kỳ). */
export function pruneGpsTrail(retentionDays = RETENTION_DAYS): number {
  try {
    const cutoff = Date.now() - retentionDays * 24 * 3_600_000;
    let removed = 0;
    for (const name of fs.readdirSync(gpsTrailDir())) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue;
      const dateIso = name.replace('.jsonl', '');
      const ms = Date.parse(`${dateIso}T00:00:00+07:00`);
      if (Number.isFinite(ms) && ms < cutoff) {
        try { fs.unlinkSync(path.join(gpsTrailDir(), name)); removed++; } catch { /* ignore */ }
      }
    }
    return removed;
  } catch {
    return 0;
  }
}
