/**
 * Tab "Tôi" — hồ sơ tài xế, xe được gán, lịch sử ca và đăng xuất.
 */
import { useEffect } from 'react';
import {
  BatteryMedium, CalendarDays, ChevronRight, LogOut, MapPin, Phone, RefreshCw, ShieldCheck, Truck, User,
} from 'lucide-react';
import { Card, DC, Empty, Pill, ScreenTitle, STATUS_LABEL, fmtDay, fmtMin, fmtMoney } from './driver-shared';
import type { DriverData } from './useDriverData';

export function DriverProfile({ d, onLogout }: { d: DriverData; onLogout: () => void }) {
  useEffect(() => { void d.loadHistory(); }, [d.loadHistory]);

  const info = d.profile?.driver || {};
  const vehicle = d.profile?.vehicle || null;
  const initials = String(info.full_name || 'T')
    .trim().split(/\s+/).slice(-2).map((w: string) => w[0] || '').join('').toUpperCase();
  const history = d.history || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScreenTitle title="Tài khoản của tôi" sub="Tài khoản tài xế — công việc tính theo ca vận chuyển" />

      {/* Hồ sơ */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 54, height: 54, borderRadius: 16, flexShrink: 0,
            background: 'linear-gradient(135deg,#0F766E,#0D9488)', color: '#FFF',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 900,
            boxShadow: '0 4px 12px rgba(15,118,110,0.28)',
          }}>{initials || <User size={22} />}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 16, fontWeight: 900, color: DC.ink }}>{info.full_name || '—'}</span>
              <Pill text="TÀI XẾ" fg={DC.brand} bg={DC.brandSoft} />
            </div>
            <div style={{ fontSize: 11.5, color: DC.muted, fontWeight: 700, marginTop: 3 }}>
              {info.employee_code || '—'} • {info.branch || '—'}
            </div>
            <div style={{ fontSize: 11.5, color: DC.muted, fontWeight: 600, marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Phone size={11} /> {info.phone || '—'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <div style={{ flex: 1, backgroundColor: DC.bg, border: `1px solid ${DC.border}`, borderRadius: 11, padding: '8px 10px' }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, color: DC.muted, textTransform: 'uppercase' }}>Bộ phận</div>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: DC.ink, marginTop: 2 }}>
              {info.group === 'XUONG' ? 'Xưởng sản xuất' : (info.group || '—')}
            </div>
          </div>
          <div style={{ flex: 1, backgroundColor: DC.bg, border: `1px solid ${DC.border}`, borderRadius: 11, padding: '8px 10px' }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, color: DC.muted, textTransform: 'uppercase' }}>Trạng thái</div>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: info.employment_status === 'PROBATION' ? DC.warn : DC.success, marginTop: 2 }}>
              {info.employment_status === 'PROBATION' ? 'Thử việc' : info.employment_status === 'OFFICIAL' ? 'Chính thức' : (info.employment_status || '—')}
            </div>
          </div>
        </div>
      </Card>

      {/* Xe được gán */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
          <Truck size={16} color={DC.brand} />
          <span style={{ fontSize: 13.5, fontWeight: 900, color: DC.ink }}>Xe điện được gán</span>
          {vehicle?.status && <Pill text={vehicle.status === 'ACTIVE' ? 'Sẵn sàng' : vehicle.status} fg={DC.success} bg={DC.successSoft} style={{ marginLeft: 'auto' }} />}
        </div>
        {!vehicle && (
          <div style={{ fontSize: 12, color: DC.muted, fontWeight: 600 }}>
            Chưa được gán xe. Quản lý vận chuyển gán xe khi tạo ca.
          </div>
        )}
        {vehicle && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: DC.ink, letterSpacing: 0.4 }}>{vehicle.license_plate}</div>
              <div style={{ fontSize: 11, color: DC.muted, fontWeight: 600 }}>
                {vehicle.battery_capacity_kwh ? `${vehicle.battery_capacity_kwh} kWh` : ''}
                {vehicle.frame_number ? ` • khung ${vehicle.frame_number}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <BatteryMedium size={16} color={Number(vehicle.current_battery_pct) <= 20 ? DC.danger : DC.success} />
              <div style={{ flex: 1, height: 8, borderRadius: 999, backgroundColor: '#E2E8F0', overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.min(100, Math.max(0, Number(vehicle.current_battery_pct) || 0))}%`,
                  height: '100%', borderRadius: 999,
                  backgroundColor: Number(vehicle.current_battery_pct) <= 20 ? DC.danger : DC.success,
                }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 900, color: DC.ink, fontVariantNumeric: 'tabular-nums' }}>
                {Number(vehicle.current_battery_pct) || 0}%
              </span>
            </div>
            <div style={{ fontSize: 10.5, color: DC.muted, fontWeight: 600, marginTop: 5 }}>
              % pin cập nhật theo GPS tài xế gửi lên trong ca chạy.
            </div>
          </>
        )}
      </Card>

      {/* Lịch sử ca */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
          <CalendarDays size={16} color={DC.brand} />
          <span style={{ fontSize: 13.5, fontWeight: 900, color: DC.ink }}>Lịch sử ca vận chuyển</span>
          <button
            onClick={() => void d.loadHistory(true)}
            style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: DC.muted, padding: 4 }}
            title="Tải lại"
          ><RefreshCw size={14} /></button>
        </div>

        {d.history === null && <div style={{ fontSize: 12, color: DC.muted, fontWeight: 700, padding: '8px 0' }}>⏳ Đang tải lịch sử...</div>}
        {d.history !== null && history.length === 0 && (
          <Empty icon={<MapPin size={28} />} title="Chưa có ca nào" desc="Ca đã chạy sẽ được lưu tại đây để bạn đối chiếu công và phạt." />
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {history.slice(0, 30).map((s: any) => {
            const st = STATUS_LABEL[s.status] || STATUS_LABEL.SCHEDULED;
            return (
              <div key={s.shift_id} style={{ border: `1px solid ${DC.border}`, borderRadius: 11, padding: '10px 11px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: DC.ink }}>{fmtDay(s.shift_date)}</div>
                    <div style={{ fontSize: 10.5, color: DC.muted, fontWeight: 600, marginTop: 2 }}>
                      {Number(s.stops_done || 0)}/{Number(s.stops_total || 0)} điểm
                      {Number(s.distance_km) > 0 ? ` • ${Number(s.distance_km)} km` : ''}
                      {Number(s.duration_min) > 0 ? ` • ${fmtMin(Number(s.duration_min))}` : ''}
                    </div>
                    {Number(s.penalty_amount || 0) > 0 && (
                      <div style={{ fontSize: 10.5, color: DC.danger, fontWeight: 700, marginTop: 2 }}>
                        Phạt {fmtMoney(s.penalty_amount)} • {Number(s.penalty_points || 0)} điểm
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                    <Pill text={st.text} fg={st.fg} bg={st.bg} />
                    <ChevronRight size={14} color="#CBD5E1" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Ghi chú tài khoản */}
      <Card style={{ backgroundColor: DC.brandSoft, borderColor: DC.brandLine }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
          <ShieldCheck size={15} color={DC.brand} />
          <span style={{ fontSize: 12, fontWeight: 900, color: DC.brandDark }}>Tài khoản tài xế</span>
        </div>
        <div style={{ fontSize: 11.5, color: DC.brandDark, fontWeight: 600, lineHeight: 1.7 }}>
          Tài khoản này chỉ dùng cho vận chuyển sữa: ca giao, bản đồ, phiếu sạc và thu nhập tài xế.
          Công việc được tính theo ca vận chuyển và điểm giao đã xác nhận — không dùng lịch hành chính,
          nghỉ phép hay đổi ca của khối văn phòng/cửa hàng.
        </div>
      </Card>

      <button
        onClick={() => { if (window.confirm('Đăng xuất khỏi tài khoản tài xế?')) onLogout(); }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '13px', borderRadius: 12, border: `1.5px solid #FECACA`,
          backgroundColor: DC.dangerSoft, color: DC.danger, fontSize: 13.5, fontWeight: 900, cursor: 'pointer',
        }}
      >
        <LogOut size={16} /> ĐĂNG XUẤT
      </button>
    </div>
  );
}
