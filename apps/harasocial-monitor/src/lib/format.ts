import { vnDayKey, vnParts } from '../../shared/time';

const pad = (n: number) => String(n).padStart(2, '0');

/** "12 phút" / "1 giờ 05 phút" / "2 ngày 3 giờ". */
export function formatMinutes(totalMinutes: number | null | undefined): string {
  if (totalMinutes === null || totalMinutes === undefined || !Number.isFinite(totalMinutes)) return '—';
  const mins = Math.max(0, Math.floor(totalMinutes));
  if (mins < 60) return `${mins} phút`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (hours < 24) return rest ? `${hours} giờ ${pad(rest)} phút` : `${hours} giờ`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} ngày ${restHours} giờ` : `${days} ngày`;
}

/** Đồng hồ chờ dạng 05:12 hoặc 1:05:12. */
export function formatElapsed(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** dd/MM/yyyy HH:mm theo giờ Việt Nam. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = vnParts(d);
  return `${pad(p.day)}/${pad(p.month)}/${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** HH:mm:ss theo giờ Việt Nam. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = vnParts(d);
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = vnParts(d);
  return `${pad(p.day)}/${pad(p.month)}/${p.year}`;
}

export function todayVn(): string {
  return vnDayKey(new Date());
}

/** "vừa xong", "3 phút trước", "2 giờ trước"... */
export function relativeFrom(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const diff = Math.max(0, now - ms);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}

export function initials(name: string): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Cắt ngắn văn bản dài cho bảng. */
export function truncate(text: string, max = 120): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
