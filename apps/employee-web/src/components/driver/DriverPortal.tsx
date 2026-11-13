/**
 * DriverPortal — APP TÀI XẾ (MilkRoute EV) thay thế toàn bộ cổng nhân viên
 * thông thường khi tài khoản được xác định là tài xế giao sữa.
 *
 * Vì sao tách riêng: tài xế làm việc ngoài đường, thao tác 1 tay trên điện
 * thoại. Các tab HR (lịch hành chính, nghỉ phép, đổi ca, thi...) không dùng đến
 * nên được ẩn hoàn toàn; thay bằng 5 mục cố định dưới đáy màn hình.
 */
import { useState } from 'react';
import {
  BatteryCharging, BatteryMedium, LogOut, Map as MapIcon, RefreshCw, Truck, UserRound, Wallet, Sun,
} from 'lucide-react';
import { useDriverData } from './useDriverData';
import { DC, Pill, STATUS_LABEL } from './driver-shared';
import { DriverToday } from './DriverToday';
import { DriverMap } from './DriverMap';
import { DriverCharging } from './DriverCharging';
import { DriverIncome } from './DriverIncome';
import { DriverProfile } from './DriverProfile';

interface Props {
  employee: any;
  showToast: (msg: string) => void;
  onLogout: () => void;
  /** Tăng khi realtime báo dữ liệu đổi → tự tải lại. */
  refreshKey?: number;
  /** Hồ sơ đã tải sẵn ở App (tránh gọi lặp /ev/me/profile). */
  initialProfile?: any;
}

type DriverTab = 'today' | 'map' | 'charge' | 'income' | 'me';

const TABS: Array<{ id: DriverTab; label: string; icon: any }> = [
  { id: 'today', label: 'Hôm nay', icon: Sun },
  { id: 'map', label: 'Bản đồ', icon: MapIcon },
  { id: 'charge', label: 'Sạc', icon: BatteryCharging },
  { id: 'income', label: 'Thu nhập', icon: Wallet },
  { id: 'me', label: 'Tôi', icon: UserRound },
];

export function DriverPortal({ employee, showToast, onLogout, refreshKey = 0, initialProfile = null }: Props) {
  const d = useDriverData(showToast, refreshKey, initialProfile);
  const [tab, setTab] = useState<DriverTab>('today');

  const driver = d.profile?.driver || {};
  const vehicle = d.profile?.vehicle || null;
  const name = driver.full_name || employee?.full_name || 'Tài xế';
  const st = STATUS_LABEL[d.status] || null;
  const gpsOk = !!d.coords && d.coords.accuracy <= 30;
  const gpsColor = d.gpsErr ? DC.danger : gpsOk ? DC.success : '#F59E0B';
  const battery = Number(vehicle?.current_battery_pct ?? 0);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: DC.bg, display: 'flex', flexDirection: 'column' }}>
      {/* ------------------------- HEADER ------------------------- */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 60,
        background: 'linear-gradient(135deg, #0F766E 0%, #115E59 100%)',
        color: '#FFFFFF',
        boxShadow: '0 4px 14px rgba(15,118,110,0.25)',
      }}>
        <div style={{ maxWidth: 620, margin: '0 auto', padding: '12px 14px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 11, flexShrink: 0, overflow: 'hidden',
              backgroundColor: '#FFFFFF', border: '1.5px solid rgba(255,255,255,0.55)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <img src="/logo.jpg" alt="Ụm Bò Milk" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14.5, fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                <span style={{
                  fontSize: 8.5, fontWeight: 900, letterSpacing: 0.6, padding: '2px 6px', borderRadius: 999,
                  backgroundColor: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.35)',
                }}>TÀI XẾ</span>
              </div>
              <div style={{ fontSize: 10.5, fontWeight: 700, opacity: 0.9, marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <Truck size={11} /> {vehicle?.license_plate || driver.employee_code || '—'}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <BatteryMedium size={11} /> {battery}%
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: gpsColor, boxShadow: `0 0 0 3px ${gpsColor}33` }} />
                  GPS {d.gpsErr ? 'lỗi' : gpsOk ? 'tốt' : 'yếu'}
                </span>
              </div>
            </div>
            <button
              onClick={() => void d.reload(true)}
              title="Tải lại"
              style={{ background: 'rgba(255,255,255,0.16)', border: 'none', borderRadius: 10, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#FFF' }}
            >
              <RefreshCw size={15} />
            </button>
            <button
              onClick={() => { if (window.confirm('Đăng xuất khỏi tài khoản tài xế?')) onLogout(); }}
              title="Đăng xuất"
              style={{ background: 'rgba(255,255,255,0.16)', border: 'none', borderRadius: 10, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#FFF' }}
            >
              <LogOut size={15} />
            </button>
          </div>

          {d.current && st && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 9, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.18)' }}>
              <Pill text={st.text} fg={st.fg} bg={st.bg} />
              <span style={{ fontSize: 10.5, fontWeight: 700, opacity: 0.9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {d.detail?.routeName || 'Ca vận chuyển'}
                {d.current.product_name ? ` • ${d.current.product_name}` : ''}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* ------------------------- NỘI DUNG ------------------------- */}
      <main style={{ flex: 1, width: '100%', maxWidth: 620, margin: '0 auto', padding: '14px 14px 96px' }}>
        {d.loading && (
          <div style={{ textAlign: 'center', padding: '48px 16px', color: DC.muted, fontSize: 13, fontWeight: 700 }}>
            ⏳ Đang tải dữ liệu tài xế...
          </div>
        )}

        {!d.loading && d.err && !d.profile && (
          <div style={{
            backgroundColor: DC.dangerSoft, border: `1.5px solid ${DC.danger}`, borderRadius: 12,
            padding: 14, fontSize: 12.5, color: DC.danger, fontWeight: 700,
          }}>
            ⚠️ {d.err}
            <button
              onClick={() => void d.reload()}
              style={{ marginTop: 10, display: 'block', width: '100%', padding: '10px', borderRadius: 10, border: 'none', backgroundColor: DC.danger, color: '#FFF', fontWeight: 800, cursor: 'pointer' }}
            >
              Thử lại
            </button>
          </div>
        )}

        {!d.loading && d.profile && (
          <>
            {tab === 'today' && <DriverToday d={d} />}
            {tab === 'map' && <DriverMap d={d} />}
            {tab === 'charge' && <DriverCharging d={d} />}
            {tab === 'income' && <DriverIncome d={d} />}
            {tab === 'me' && <DriverProfile d={d} onLogout={onLogout} showToast={showToast} />}
          </>
        )}
      </main>

      {/* ------------------------- BOTTOM NAV ------------------------- */}
      <nav style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 70,
        backgroundColor: '#FFFFFF',
        borderTop: `1px solid ${DC.border}`,
        boxShadow: '0 -4px 16px rgba(15,23,42,0.07)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        <div style={{ maxWidth: 620, margin: '0 auto', display: 'flex' }}>
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                style={{
                  flex: 1, border: 'none', background: 'none', cursor: 'pointer',
                  padding: '9px 4px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                  color: active ? DC.brand : DC.muted,
                }}
              >
                <span style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 38, height: 26, borderRadius: 999,
                  backgroundColor: active ? DC.brandSoft : 'transparent',
                  transition: 'background-color .15s',
                }}>
                  <Icon size={19} strokeWidth={active ? 2.6 : 2} />
                </span>
                <span style={{ fontSize: 9.5, fontWeight: active ? 900 : 700, letterSpacing: 0.1 }}>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
