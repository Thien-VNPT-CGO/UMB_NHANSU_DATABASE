/**
 * Thành phần & hằng số dùng chung cho APP TÀI XẾ (MilkRoute EV).
 *
 * Tài khoản tài xế có bộ màu + bố cục riêng (teal, thẻ lớn, nút to) để khác
 * hẳn cổng nhân viên văn phòng/cửa hàng (hồng thương hiệu, nhiều tab HR).
 */
import type { CSSProperties, ReactNode } from 'react';

export const DC = {
  brand: '#0F766E',
  brandDark: '#115E59',
  brandSoft: '#F0FDFA',
  brandLine: '#99F6E4',
  ink: '#0F172A',
  muted: '#64748B',
  border: '#E2E8F0',
  bg: '#F1F5F9',
  card: '#FFFFFF',
  success: '#059669',
  successSoft: '#ECFDF5',
  warn: '#B45309',
  warnSoft: '#FEF3C7',
  danger: '#DC2626',
  dangerSoft: '#FEF2F2',
  purple: '#7C3AED',
  purpleSoft: '#F5F3FF',
  blue: '#1D4ED8',
  blueSoft: '#EFF6FF',
};

export type Coords = {
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  at: number;
};

export const STATUS_LABEL: Record<string, { text: string; fg: string; bg: string }> = {
  SCHEDULED: { text: 'Chờ bắt đầu', fg: DC.blue, bg: DC.blueSoft },
  IN_PROGRESS: { text: 'Đang chạy', fg: DC.success, bg: DC.successSoft },
  CHARGING: { text: 'Đang sạc', fg: DC.purple, bg: DC.purpleSoft },
  RETURNING: { text: 'Về xưởng', fg: '#0369A1', bg: '#F0F9FF' },
  PAUSED: { text: 'Tạm dừng', fg: DC.warn, bg: DC.warnSoft },
  COMPLETED: { text: 'Hoàn thành', fg: DC.muted, bg: '#F1F5F9' },
  CANCELLED: { text: 'Đã hủy', fg: DC.danger, bg: DC.dangerSoft },
};

export const TICKET_STATUS: Record<string, { text: string; fg: string; bg: string }> = {
  DRAFT: { text: 'Nháp', fg: DC.muted, bg: '#F1F5F9' },
  PENDING_HR: { text: 'Chờ HR duyệt', fg: DC.warn, bg: DC.warnSoft },
  PENDING_DIRECTOR: { text: 'Chờ Giám đốc', fg: DC.blue, bg: DC.blueSoft },
  APPROVED: { text: 'Đã duyệt', fg: DC.success, bg: DC.successSoft },
  REJECTED: { text: 'Từ chối', fg: DC.danger, bg: DC.dangerSoft },
  USED: { text: 'Đã sạc', fg: DC.purple, bg: DC.purpleSoft },
  EXPIRED: { text: 'Hết hạn', fg: DC.muted, bg: '#F1F5F9' },
};

export const haversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const fmtClock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
};

export const fmtMin = (min: number) =>
  (min >= 60 ? `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}` : `${Math.round(min)} phút`);

export const fmtTime = (iso?: string) => {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
};

/** '2026-11-13' → 'T5, 13/11/2026' */
export const fmtDay = (day?: string) => {
  const s = String(day || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || '—';
  const t = new Date(`${s}T00:00:00+07:00`);
  return t.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
};

export const fmtMoney = (n: unknown) => `${Math.round(Number(n) || 0).toLocaleString('vi-VN')}đ`;

export function Card({ children, style, onClick }: { children: ReactNode; style?: CSSProperties; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        backgroundColor: DC.card,
        border: `1px solid ${DC.border}`,
        borderRadius: 16,
        padding: 14,
        boxShadow: '0 1px 3px rgba(15,23,42,0.05)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Pill({ text, fg, bg, style }: { text: string; fg: string; bg: string; style?: CSSProperties }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
      fontSize: 10.5, fontWeight: 800, letterSpacing: 0.2,
      padding: '3px 9px', borderRadius: 999, color: fg, backgroundColor: bg,
      ...style,
    }}>{text}</span>
  );
}

export function Stat({
  label, value, tone = 'ink', style,
}: { label: string; value: ReactNode; tone?: 'ink' | 'brand' | 'success' | 'warn' | 'danger' | 'muted'; style?: CSSProperties }) {
  const color = tone === 'brand' ? DC.brand
    : tone === 'success' ? DC.success
      : tone === 'warn' ? DC.warn
        : tone === 'danger' ? DC.danger
          : tone === 'muted' ? DC.muted : DC.ink;
  return (
    <div style={{
      flex: '1 1 0', minWidth: 0, backgroundColor: DC.bg, border: `1px solid ${DC.border}`,
      borderRadius: 12, padding: '9px 10px', ...style,
    }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, color: DC.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 900, color, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

export function ScreenTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 19, fontWeight: 900, color: DC.ink, letterSpacing: -0.2 }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: DC.muted, fontWeight: 600, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export function Empty({ icon, title, desc, action }: { icon: ReactNode; title: string; desc?: string; action?: ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '28px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10, color: DC.muted }}>{icon}</div>
      <div style={{ fontSize: 14.5, fontWeight: 800, color: DC.ink }}>{title}</div>
      {desc && <div style={{ fontSize: 12.5, color: DC.muted, marginTop: 5, lineHeight: 1.6, fontWeight: 600 }}>{desc}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function BigButton({
  children, onClick, disabled, tone = 'brand', style,
}: { children: ReactNode; onClick?: () => void; disabled?: boolean; tone?: 'brand' | 'ghost' | 'danger' | 'purple'; style?: CSSProperties }) {
  const palette = tone === 'ghost'
    ? { bg: '#FFFFFF', fg: DC.ink, border: `1.5px solid ${DC.border}` }
    : tone === 'danger'
      ? { bg: DC.dangerSoft, fg: DC.danger, border: `1.5px solid #FECACA` }
      : tone === 'purple'
        ? { bg: DC.purple, fg: '#FFFFFF', border: '1.5px solid transparent' }
        : { bg: DC.brand, fg: '#FFFFFF', border: '1.5px solid transparent' };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: '13px 14px', borderRadius: 12, fontSize: 14, fontWeight: 900,
        backgroundColor: palette.bg, color: palette.fg, border: palette.border,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
        ...style,
      }}
    >{children}</button>
  );
}

/** Mở Google Maps chỉ đường tới toạ độ (dùng trên điện thoại của tài xế). */
export function openDirections(lat: number, lng: number, label?: string) {
  const q = Number.isFinite(lat) && Number.isFinite(lng)
    ? `${lat},${lng}`
    : encodeURIComponent(label || '');
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${q}`, '_blank', 'noopener,noreferrer');
}
