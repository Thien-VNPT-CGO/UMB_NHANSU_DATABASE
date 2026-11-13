/**
 * Tab "Sạc" — phiếu sạc xe điện: tạo phiếu, theo dõi duyệt 2 cấp, bắt đầu/kết thúc sạc.
 */
import { useState } from 'react';
import { BatteryCharging, ChevronDown, ChevronUp, Clock, Plus, Zap } from 'lucide-react';
import {
  BigButton, Card, DC, Empty, Pill, ScreenTitle, TICKET_STATUS, fmtDay, fmtTime,
} from './driver-shared';
import type { DriverData } from './useDriverData';

export function DriverCharging({ d }: { d: DriverData }) {
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ date: today, battery: '', notes: '' });

  const active = d.chargingTicket;
  const pending = d.tickets.filter((t: any) => t.status === 'PENDING_HR' || t.status === 'PENDING_DIRECTOR');

  const submit = async () => {
    const ok = await d.createTicket(form);
    if (ok) {
      setShowForm(false);
      setForm({ date: today, battery: '', notes: '' });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScreenTitle title="Phiếu sạc xe điện" sub="Tạo phiếu → HR duyệt → Giám đốc duyệt → sạc đúng ngày" />

      {/* Đang sạc */}
      {active && active.charging_start_at && (
        <Card style={{ background: 'linear-gradient(135deg,#BE185D,#E85D92)', border: 'none', color: '#FFF' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Zap size={16} />
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5 }}>ĐANG SẠC</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, opacity: 0.9 }}>
              từ {fmtTime(active.charging_start_at)}
            </span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, marginTop: 6 }}>
            {active.charging_station_name || 'Trạm sạc theo GPS'}
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.9, marginTop: 3 }}>
            Ngày đăng ký {fmtDay(active.requested_date)}{active.battery_level_pct != null ? ` • pin lúc tạo ${active.battery_level_pct}%` : ''}
          </div>
          <button
            onClick={() => void d.chargingAction('end', active.ticket_id)}
            disabled={d.busy === 'cend'}
            style={{
              marginTop: 12, width: '100%', padding: '11px', borderRadius: 11, border: 'none',
              backgroundColor: 'rgba(255,255,255,0.18)', color: '#FFF', fontSize: 13, fontWeight: 900,
              cursor: d.busy === 'cend' ? 'not-allowed' : 'pointer',
            }}
          >
            {d.busy === 'cend' ? 'ĐANG KẾT THÚC...' : 'KẾT THÚC SẠC'}
          </button>
        </Card>
      )}

      {/* Phiếu đã duyệt chờ sạc */}
      {active && !active.charging_start_at && (
        <Card style={{ borderColor: DC.brandLine, backgroundColor: DC.brandSoft }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <BatteryCharging size={17} color={DC.brand} />
            <span style={{ fontSize: 13, fontWeight: 900, color: DC.brandDark }}>Phiếu đã duyệt — sạc được hôm nay</span>
          </div>
          <div style={{ fontSize: 11.5, color: '#9D174D', fontWeight: 600, marginTop: 4 }}>
            Ngày đăng ký {fmtDay(active.requested_date)}. Bấm bắt đầu khi đã cắm sạc — hệ thống ghim trạm theo GPS.
          </div>
          <BigButton
            style={{ marginTop: 10 }}
            disabled={d.busy === 'cstart'}
            onClick={() => void d.chargingAction('start', active.ticket_id)}
          >
            <Zap size={15} /> {d.busy === 'cstart' ? 'ĐANG BẮT ĐẦU...' : 'BẮT ĐẦU SẠC'}
          </BigButton>
        </Card>
      )}

      {/* Trạng thái chờ duyệt */}
      {!active && pending.length > 0 && (
        <Card style={{ backgroundColor: DC.warnSoft, borderColor: '#FDE68A' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Clock size={15} color={DC.warn} />
            <span style={{ fontSize: 12.5, fontWeight: 800, color: DC.warn }}>
              {pending.length} phiếu đang chờ duyệt
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: '#92400E', fontWeight: 600, marginTop: 4 }}>
            HR duyệt xong chuyển Giám đốc; khi cả 2 cấp duyệt, phiếu sẽ hiện nút "Bắt đầu sạc".
          </div>
        </Card>
      )}

      {/* Nút tạo phiếu */}
      <Card>
        <button
          onClick={() => setShowForm(v => !v)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: 0,
            border: 'none', background: 'none', cursor: 'pointer',
          }}
        >
          <Plus size={17} color={DC.brand} />
          <span style={{ fontSize: 13.5, fontWeight: 900, color: DC.ink, flex: 1, textAlign: 'left' }}>Tạo phiếu sạc mới</span>
          {showForm ? <ChevronUp size={16} color={DC.muted} /> : <ChevronDown size={16} color={DC.muted} />}
        </button>

        {showForm && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
            {!d.current && (
              <div style={{ fontSize: 11.5, fontWeight: 700, color: DC.danger, backgroundColor: DC.dangerSoft, borderRadius: 9, padding: '8px 10px' }}>
                Bạn chưa có ca vận chuyển hôm nay nên chưa tạo được phiếu sạc.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <label style={{ flex: 1, fontSize: 11.5, fontWeight: 700, color: DC.muted }}>
                Ngày dự kiến sạc *
                <input
                  type="date"
                  value={form.date}
                  min={today}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  style={{ width: '100%', marginTop: 4, padding: '10px 11px', fontSize: 13, borderRadius: 10, border: `1px solid ${DC.border}`, color: DC.ink }}
                />
              </label>
              <label style={{ flex: 1, fontSize: 11.5, fontWeight: 700, color: DC.muted }}>
                Pin hiện tại (%)
                <input
                  type="number" min={0} max={100} inputMode="numeric" placeholder="VD: 25"
                  value={form.battery}
                  onChange={e => setForm(f => ({ ...f, battery: e.target.value }))}
                  style={{ width: '100%', marginTop: 4, padding: '10px 11px', fontSize: 13, borderRadius: 10, border: `1px solid ${DC.border}`, color: DC.ink }}
                />
              </label>
            </div>
            <input
              type="text"
              placeholder="Ghi chú (không bắt buộc)"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              style={{ padding: '10px 11px', fontSize: 13, borderRadius: 10, border: `1px solid ${DC.border}`, color: DC.ink }}
            />
            <div style={{ fontSize: 11, color: DC.muted, fontWeight: 600, lineHeight: 1.6 }}>
              Chỉ tạo được sau khi đã xác nhận điểm Văn phòng. Phiếu cần <b>HR duyệt → Giám đốc duyệt</b> rồi mới sạc được.
            </div>
            <BigButton onClick={submit} disabled={!d.current || d.busy === 'ticket'}>
              {d.busy === 'ticket' ? 'ĐANG GỬI...' : 'GỬI PHIẾU SẠC'}
            </BigButton>
          </div>
        )}
      </Card>

      {/* Danh sách phiếu */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
          <BatteryCharging size={16} color={DC.brand} />
          <span style={{ fontSize: 13.5, fontWeight: 900, color: DC.ink }}>Phiếu của tôi</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: DC.muted, fontWeight: 700 }}>{d.tickets.length} phiếu</span>
        </div>

        {d.tickets.length === 0 && (
          <Empty icon={<BatteryCharging size={30} />} title="Chưa có phiếu sạc nào" desc="Phiếu sạc dùng để xin phép sạc xe điện trong ca." />
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {d.tickets.slice(0, 12).map((t: any) => {
            const st = TICKET_STATUS[t.status] || TICKET_STATUS.DRAFT;
            return (
              <div key={t.ticket_id} style={{ border: `1px solid ${DC.border}`, borderRadius: 11, padding: '10px 11px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: DC.ink, flex: 1 }}>
                    {fmtDay(t.requested_date)}
                    {t.battery_level_pct != null ? ` • pin ${t.battery_level_pct}%` : ''}
                  </div>
                  <Pill text={st.text} fg={st.fg} bg={st.bg} />
                </div>
                {t.hr_approved_at && (
                  <div style={{ fontSize: 10.5, color: DC.muted, fontWeight: 600, marginTop: 4 }}>
                    HR duyệt {fmtTime(t.hr_approved_at)}
                    {t.director_approved_at ? ` • GĐ duyệt ${fmtTime(t.director_approved_at)}` : ''}
                  </div>
                )}
                {t.charging_start_at && (
                  <div style={{ fontSize: 10.5, color: DC.brandDark, fontWeight: 700, marginTop: 4 }}>
                    ⚡ Sạc {fmtTime(t.charging_start_at)}{t.charging_end_at ? ` – ${fmtTime(t.charging_end_at)}` : '...'}
                    {t.charging_station_name ? ` • ${t.charging_station_name}` : ''}
                  </div>
                )}
                {t.status === 'REJECTED' && (t.hr_notes || t.director_notes) && (
                  <div style={{ fontSize: 10.5, color: DC.danger, fontWeight: 700, marginTop: 4 }}>
                    Lý do: {t.hr_notes || t.director_notes}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card style={{ backgroundColor: DC.brandSoft, borderColor: DC.brandLine }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: DC.brandDark, marginBottom: 4 }}>Quy trình duyệt phiếu sạc</div>
        <div style={{ fontSize: 11.5, color: '#9D174D', lineHeight: 1.7, fontWeight: 600 }}>
          1. Tài xế tạo phiếu sau khi giao xong điểm Văn phòng.<br />
          2. HR kiểm tra & duyệt cấp 1.<br />
          3. Giám đốc duyệt cấp 2.<br />
          4. Tài xế bấm bắt đầu sạc đúng ngày đăng ký — GPS ghim vị trí trạm.
        </div>
      </Card>
    </div>
  );
}
