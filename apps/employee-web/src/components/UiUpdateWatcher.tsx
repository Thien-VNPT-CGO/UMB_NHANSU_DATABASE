import { useEffect, useRef, useState } from 'react';
import { getApiBase } from '../services/api';

/**
 * Lịch cập nhật giao diện/phần mềm do Admin hẹn trong tab "Bảo trì kỹ thuật".
 * - Hiện banner đếm ngược trên MỌI màn hình (kể cả đăng nhập).
 * - Hết giờ: xóa cache PWA + yêu cầu service worker cập nhật rồi tự reload
 *   để nhận giao diện mới; chống lặp bằng localStorage theo đúng mốc đã hẹn.
 */
const APPLIED_KEY = 'ubm_ui_update_applied_at';
const POLL_MS = 30_000;

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const hms = `${pad(h)}:${pad(m)}:${pad(s)}`;
  return days > 0 ? `${days} ngày ${hms}` : hms;
}

async function applyUpdateAndReload(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
      if (reg) {
        await reg.update().catch(() => null);
        reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
      }
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter(k => k.startsWith('ubm-employee-')).map(k => caches.delete(k)),
      );
    }
  } catch {
    /* lỗi cache/SW không được chặn reload */
  }
  // Chờ 1 nhịp để service worker kịp activate + overlay hiện rõ rồi mới tải lại.
  setTimeout(() => window.location.reload(), 1500);
}

export function UiUpdateWatcher() {
  const [schedule, setSchedule] = useState<{ at: number; message: string } | null>(null);
  const [clockSkew, setClockSkew] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);
  // Thời điểm trang được nạp: nếu mốc hẹn đã qua TRƯỚC khi nạp trang thì bản
  // mới đã được tải sẵn — chỉ ghi nhận, không reload thêm lần nữa.
  const pageLoadedAtRef = useRef(Date.now());
  const appliedRef = useRef<string>(
    (() => {
      try { return localStorage.getItem(APPLIED_KEY) || ''; } catch { return ''; }
    })(),
  );

  // Tải lịch hẹn giờ (endpoint public) + đồng bộ lại mỗi 30s hoặc khi quay lại tab.
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12_000);
        const res = await fetch(`${getApiBase()}/public/portal-maintenance`, {
          signal: ctrl.signal,
          cache: 'no-store',
        });
        clearTimeout(timer);
        if (!res.ok) return;
        const m: any = await res.json();
        if (stopped) return;
        const serverTime = Date.parse(String(m?.server_time || ''));
        setClockSkew(Number.isFinite(serverTime) ? serverTime - Date.now() : 0);
        const at = Date.parse(String(m?.ui_update_at || ''));
        if (m?.ui_update_enabled && Number.isFinite(at)) {
          setSchedule({ at, message: String(m?.ui_update_message || '') });
        } else {
          setSchedule(null);
        }
      } catch {
        /* offline: giữ lịch đã biết, không chặn app */
      }
    };
    void load();
    const poll = setInterval(load, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Đồng hồ đếm ngược 1s/lần (chỉ khi có lịch).
  useEffect(() => {
    if (!schedule) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [schedule]);

  // Đến giờ -> tự cập nhật đúng 1 lần cho mỗi mốc hẹn.
  useEffect(() => {
    if (!schedule || applyingRef.current) return;
    if (now + clockSkew < schedule.at) return;
    const key = String(schedule.at);
    if (appliedRef.current === key) return;
    if (schedule.at <= pageLoadedAtRef.current) {
      // Mở cổng sau giờ hẹn: HTML/asset đã lấy bản mới ngay khi nạp trang.
      appliedRef.current = key;
      try { localStorage.setItem(APPLIED_KEY, key); } catch { /* private mode */ }
      return;
    }
    appliedRef.current = key;
    applyingRef.current = true;
    setApplying(true);
    try { localStorage.setItem(APPLIED_KEY, key); } catch { /* private mode */ }
    void applyUpdateAndReload();
  }, [now, clockSkew, schedule]);

  if (applying) {
    return (
      <div
        role="status"
        aria-live="assertive"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 99999,
          backgroundColor: 'rgba(39, 49, 66, 0.92)',
          color: '#FFF',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '18px',
          padding: '28px',
          textAlign: 'center',
        }}
      >
        <div
          className="animate-spin"
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '50%',
            border: '4px solid rgba(255,255,255,0.25)',
            borderTopColor: 'var(--brand)',
          }}
        />
        <div style={{ fontSize: '17px', fontWeight: 800 }}>Đang cập nhật giao diện mới...</div>
        <div style={{ fontSize: '13px', opacity: 0.8, maxWidth: '320px' }}>
          {schedule?.message || 'Vui lòng chờ vài giây, ứng dụng sẽ tự tải lại bản mới nhất.'}
        </div>
      </div>
    );
  }

  if (!schedule) return null;
  const remaining = schedule.at - (now + clockSkew);
  if (remaining <= 0) return null; // đã tới giờ: overlay xử lý (hoặc đã cập nhật xong)

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: '480px',
        zIndex: 9998,
        padding: '9px 14px',
        paddingBottom: 'calc(9px + env(safe-area-inset-bottom, 0px))',
        backgroundColor: '#273142',
        color: '#FFF',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        boxShadow: '0 -4px 14px rgba(0, 0, 0, 0.18)',
      }}
    >
      <span style={{ fontSize: '17px', lineHeight: 1 }} aria-hidden="true">🔄</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: '12.5px', fontWeight: 700 }}>
          Giao diện/phần mềm mới sẽ tự cập nhật sau{' '}
          <span style={{ color: '#F8DDE7', fontVariantNumeric: 'tabular-nums' }}>{formatRemaining(remaining)}</span>
        </div>
        {schedule.message && (
          <div style={{ fontSize: '11px', opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {schedule.message}
          </div>
        )}
      </div>
    </div>
  );
}
