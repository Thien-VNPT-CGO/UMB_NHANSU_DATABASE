import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, ShieldAlert } from 'lucide-react';

/**
 * Thẻ đếm ngược chu kỳ đổi mật khẩu định kỳ (mặc định 6 tháng).
 *
 * - Client tự đếm lùi TỪNG GIÂY theo mốc giờ server (`server_now`) nên không lệch
 *   giờ máy người dùng và cập nhật realtime 100% theo thời gian thực.
 * - Màu trạng thái: XANH (còn hạn), VÀNG (≤ 30 ngày), ĐỎ (quá hạn), XÁM (chưa ghi mốc).
 * - Dùng chung cho mật khẩu đăng nhập Admin và mật khẩu VPS/root.
 */

export interface PasswordRotationStatus {
  scope: 'ADMIN' | 'VPS';
  level: 'OK' | 'SOON' | 'OVERDUE' | 'UNSET';
  cycle_months: number;
  changed_at: string;
  changed_at_iso: string | null;
  due_at: string;
  changed_ms: number;
  due_ms: number;
  ms_left: number;
  days_left: number;
  percent: number;
  server_now: number;
  updated_by?: string | null;
  updated_at?: string | null;
  note?: string;
}

interface Props {
  title: string;
  subtitle?: string;
  status: PasswordRotationStatus | null;
  loading?: boolean;
  error?: string | null;
  /** Nội dung thêm (form ghi nhận mốc) hiển thị dưới phần đếm ngược. */
  children?: React.ReactNode;
  /** Ẩn khối mốc "đổi gần nhất" khi cần gọn. */
  compact?: boolean;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

const LEVEL_STYLE: Record<PasswordRotationStatus['level'], {
  color: string;
  soft: string;
  border: string;
  label: string;
  icon: React.ReactNode;
}> = {
  OK: {
    color: '#065F46',
    soft: 'rgba(16, 185, 129, 0.12)',
    border: '#A7F3D0',
    label: 'Còn hạn',
    icon: <CheckCircle2 size={16} />,
  },
  SOON: {
    color: '#92400E',
    soft: 'rgba(245, 158, 11, 0.14)',
    border: '#FDE68A',
    label: 'Sắp đến hạn',
    icon: <AlertTriangle size={16} />,
  },
  OVERDUE: {
    color: '#991B1B',
    soft: 'rgba(239, 68, 68, 0.12)',
    border: '#FECACA',
    label: 'Đã quá hạn',
    icon: <ShieldAlert size={16} />,
  },
  UNSET: {
    color: '#475569',
    soft: 'rgba(100, 116, 139, 0.12)',
    border: 'var(--border)',
    label: 'Chưa ghi nhận',
    icon: <Clock size={16} />,
  },
};

/** 'YYYY-MM-DD' (giờ VN) -> 'DD/MM/YYYY'. */
function vnDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

function todayVn(nowMs: number): string {
  return new Date(nowMs + 7 * HOUR_MS).toISOString().slice(0, 10);
}

function splitRemaining(ms: number) {
  const left = Math.max(0, ms);
  return {
    days: Math.floor(left / DAY_MS),
    hours: Math.floor((left % DAY_MS) / HOUR_MS),
    minutes: Math.floor((left % HOUR_MS) / MINUTE_MS),
    seconds: Math.floor((left % MINUTE_MS) / 1000),
  };
}

export const PasswordRotationCard: React.FC<Props> = ({
  title,
  subtitle,
  status,
  loading,
  error,
  children,
  compact,
}) => {
  // Độ lệch giữa giờ server và giờ máy: server_now (ms) - thời điểm nhận dữ liệu.
  const receivedAt = useRef<number>(Date.now());
  const skewRef = useRef<number>(0);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    receivedAt.current = Date.now();
    skewRef.current = status ? Number(status.server_now) - receivedAt.current : 0;
    setNowMs(Date.now() + skewRef.current);
  }, [status]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now() + skewRef.current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const view = useMemo(() => {
    if (!status) return null;
    if (status.level === 'UNSET' || !status.due_ms) {
      return { msLeft: 0, parts: splitRemaining(0), percent: 0, overdueMs: 0 };
    }
    const msLeft = status.due_ms - nowMs;
    const total = Math.max(1, status.due_ms - status.changed_ms);
    const percent = Math.min(100, Math.max(0, ((nowMs - status.changed_ms) / total) * 100));
    return {
      msLeft,
      parts: splitRemaining(msLeft),
      percent,
      overdueMs: msLeft < 0 ? Math.abs(msLeft) : 0,
    };
  }, [status, nowMs]);

  const style = LEVEL_STYLE[status?.level || 'UNSET'];

  return (
    <section
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-soft)',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              display: 'grid',
              placeItems: 'center',
              backgroundColor: style.soft,
              color: style.color,
              border: `1px solid ${style.border}`,
            }}
          >
            <CalendarClock size={19} />
          </div>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text)' }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{subtitle}</div>
            )}
          </div>
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 10px',
            borderRadius: 999,
            fontSize: '12px',
            fontWeight: 800,
            backgroundColor: style.soft,
            color: style.color,
            border: `1px solid ${style.border}`,
          }}
        >
          {status ? style.icon : <Clock size={16} />}
          {status ? style.label : (loading ? 'Đang tải…' : 'Chưa có dữ liệu')}
        </div>
      </div>

      {error && (
        <div style={{ fontSize: '13px', color: '#991B1B', backgroundColor: 'var(--danger-soft)', border: '1px solid #FECACA', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
          {error}
        </div>
      )}

      {loading && !status && (
        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Đang tải chu kỳ đổi mật khẩu…</div>
      )}

      {status && (
        <>
          {status.level === 'UNSET' ? (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Chưa có mốc đổi mật khẩu. Ghi nhận ngày đổi gần nhất bên dưới để bắt đầu đếm ngược
              {' '}{status.cycle_months} tháng.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)' }}>
                  {view && view.msLeft > 0 ? 'Còn lại' : 'Đã quá hạn'}
                </span>
                <span
                  style={{
                    fontSize: '26px',
                    fontWeight: 900,
                    letterSpacing: '-0.5px',
                    color: style.color,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {view?.parts.days ?? 0} ngày {(view?.parts.hours ?? 0).toString().padStart(2, '0')}:
                  {(view?.parts.minutes ?? 0).toString().padStart(2, '0')}:
                  {(view?.parts.seconds ?? 0).toString().padStart(2, '0')}
                </span>
              </div>

              {/* Thanh tiến trình thời gian của chu kỳ */}
              <div style={{ height: 8, borderRadius: 999, backgroundColor: 'var(--border)', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.round(view?.percent || 0)}%`,
                    height: '100%',
                    borderRadius: 999,
                    backgroundColor: status.level === 'OVERDUE' ? '#EF4444' : status.level === 'SOON' ? '#F59E0B' : '#10B981',
                    transition: 'width 1s linear',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', fontSize: '12px', color: 'var(--text-muted)' }}>
                {!compact && (
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text)' }}>Đổi gần nhất</div>
                    <div>{status.changed_at ? vnDate(status.changed_at) : '—'}</div>
                  </div>
                )}
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--text)' }}>Hạn đổi tiếp theo</div>
                  <div>{status.due_at ? vnDate(status.due_at) : '—'}</div>
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--text)' }}>Chu kỳ</div>
                  <div>{status.cycle_months} tháng / lần</div>
                </div>
                {status.updated_by && (
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text)' }}>Người ghi nhận</div>
                    <div>{status.updated_by}</div>
                  </div>
                )}
              </div>

              {status.note && (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Ghi chú: {status.note}
                </div>
              )}

              {status.level === 'SOON' && (
                <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#92400E' }}>
                  Còn dưới 30 ngày — nên đổi mật khẩu ngay để tránh bị động.
                </div>
              )}
              {status.level === 'OVERDUE' && (
                <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#991B1B' }}>
                  Đã quá hạn {(view?.overdueMs ? Math.floor(view.overdueMs / DAY_MS) : 0)} ngày — đổi mật khẩu ngay!
                </div>
              )}
            </>
          )}
          {children}
          {!compact && (
            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
              Đồng hồ đếm ngược chạy theo giờ máy chủ, cập nhật mỗi giây.
            </div>
          )}
        </>
      )}
    </section>
  );
};

export { todayVn, vnDate };
