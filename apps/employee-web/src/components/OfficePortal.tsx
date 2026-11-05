/**
 * OfficePortal — giao diện riêng cho nhân viên KHỐI VĂN PHÒNG (group = VAN_PHONG).
 *
 * Gồm 5 màn hình được nhúng vào cổng nhân viên:
 *  - Lịch làm việc hành chính (T2–T6 08:00–17:00, T7 08:00–12:00).
 *  - Đăng ký nghỉ phép (1 ngày/tháng, duyệt Nhân sự → Kế toán → Giám đốc).
 *  - Điểm danh (VÀO CA 08:00–08:30, RA CA; GPS realtime trong 300m mới hiện nút).
 *  - Công của tôi (văn phòng: lương cơ bản theo THÁNG = LBH + phụ cấp, không theo ca).
 *  - Bổ sung công (4 phiếu/tháng, dùng hết khóa tới tháng sau).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../services/api';
import {
  OFFICE_ADJUST_MONTHLY_QUOTA,
  OFFICE_LEAVE_MONTHLY_QUOTA,
  OFFICE_GPS_RADIUS_METERS,
  officeDayHoursLabel,
  officeRuleOfWeekday,
} from '@ubm/shared';

interface OfficeViewProps {
  employee: any;
  showToast: (msg: string) => void;
}

const BRAND = 'var(--brand)';
const MUTED = 'var(--text-muted)';
const BORDER = 'var(--border)';

// ============================================================================
// Helpers chung
// ============================================================================
const vnToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const mondayOf = (iso: string) => {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  const dow = new Date(t).getUTCDay(); // 0 = CN
  return addDays(iso, -((dow + 6) % 7));
};
const fmtTime = (iso?: string | null) => {
  if (!iso) return '--:--';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '--:--';
  return new Date(t + 7 * 3_600_000).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
};
const fmtDate = (iso: string) => {
  const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
};
const fmtHours = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
const vnd = (n: number) => `${Math.round(Number(n) || 0).toLocaleString('vi-VN')}đ`;

const haversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const Card = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div className="card" style={{ margin: '0 16px 14px', ...(style || {}) }}>{children}</div>
);
const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 10 }}>{children}</div>
);
const ErrorBox = ({ msg }: { msg: string }) => (
  <div style={{ background: 'var(--danger-soft)', color: '#991B1B', borderRadius: 'var(--radius-sm)', padding: '10px 12px', fontSize: 12.5, fontWeight: 600, marginBottom: 10 }}>{msg}</div>
);
const Empty = ({ children }: { children: React.ReactNode }) => (
  <div style={{ textAlign: 'center', color: MUTED, fontSize: 13, padding: '18px 8px' }}>{children}</div>
);

// ============================================================================
// 1. LỊCH LÀM VIỆC HÀNH CHÍNH
// ============================================================================
export function OfficeScheduleView({ employee }: OfficeViewProps) {
  void employee;
  const [sel, setSel] = useState<'THIS' | 'NEXT'>('THIS');
  const [days, setDays] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const base = vnToday();
      const monday = addDays(mondayOf(base), sel === 'NEXT' ? 7 : 0);
      const sunday = addDays(monday, 6);
      const data: any = await apiRequest(`/me/office/schedule?fromDate=${monday}&toDate=${sunday}`);
      setDays(Array.isArray(data?.days) ? data.days : []);
    } catch (e: any) {
      setErr(e?.message || 'Không tải được lịch làm việc.');
    } finally { setLoading(false); }
  }, [sel]);
  useEffect(() => { load(); }, [load]);

  const today = vnToday();
  return (
    <div style={{ paddingTop: 12 }}>
      <Card>
        <SectionTitle>🕗 Lịch làm việc hành chính</SectionTitle>
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 10 }}>
          Thứ 2 – Thứ 6: 08:00 – 17:00 · Thứ 7: 08:00 – 12:00 · Chủ nhật nghỉ
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={sel === 'THIS' ? 'btn-primary' : 'btn-secondary'} style={{ flex: 1, padding: '8px', fontSize: 13 }} onClick={() => setSel('THIS')}>Tuần này</button>
          <button className={sel === 'NEXT' ? 'btn-primary' : 'btn-secondary'} style={{ flex: 1, padding: '8px', fontSize: 13 }} onClick={() => setSel('NEXT')}>Tuần sau</button>
        </div>
      </Card>

      {err && <Card><ErrorBox msg={err} /></Card>}
      {loading && <Card><div className="fx-skeleton" style={{ height: 60 }} /></Card>}

      {!loading && days.map((d) => {
        const rule = officeRuleOfWeekday(Number(d.weekday));
        const isToday = d.date === today;
        const isLeave = !!d.is_leave;
        const status = isLeave ? 'Nghỉ phép (đã duyệt)'
          : !rule.work ? 'Ngày nghỉ tuần'
            : d.check_in_at && d.check_out_at ? `Đã làm ${fmtHours(Number(d.worked_minutes) || 0)}`
              : d.check_in_at ? 'Đang làm (chưa ra ca)'
                : d.date < today ? 'Không có công'
                  : d.date === today ? 'Hôm nay' : 'Sắp tới';
        const statusColor = isLeave ? '#9D174D' : d.check_in_at && d.check_out_at ? '#047857' : d.check_in_at ? '#92400E' : MUTED;
        return (
          <Card key={d.date} style={isToday ? { border: `1.5px solid ${BRAND}` } : undefined}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  background: rule.work && !isLeave ? 'var(--brand-soft)' : '#F1F5F9',
                  color: rule.work && !isLeave ? BRAND : '#64748B',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12,
                }}>{d.weekday_label?.replace('Thứ ', 'T') || 'CN'}</div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 13.5 }}>
                    {rule.label} · {fmtDate(d.date)} {isToday && <span style={{ color: BRAND }}>(Hôm nay)</span>}
                  </div>
                  <div style={{ fontSize: 12, color: MUTED }}>{officeDayHoursLabel(d.date)}</div>
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 11.5, fontWeight: 700, color: statusColor }}>{status}</div>
            </div>
            {rule.work && !isLeave && (
              <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 12, color: MUTED }}>
                <span>Vào: <b style={{ color: d.check_in_at ? '#047857' : MUTED }}>{fmtTime(d.check_in_at)}</b></span>
                <span>Ra: <b style={{ color: d.check_out_at ? '#047857' : MUTED }}>{fmtTime(d.check_out_at)}</b></span>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ============================================================================
// 2. ĐĂNG KÝ NGHỈ PHÉP
// ============================================================================
export function OfficeLeaveView({ employee, showToast }: OfficeViewProps) {
  void employee;
  const [data, setData] = useState<any>(null);
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const d: any = await apiRequest('/me/office/leaves');
      setData(d);
    } catch (e: any) { setErr(e?.message || 'Không tải được phiếu nghỉ phép.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const quota = data?.quota || { monthRemaining: OFFICE_LEAVE_MONTHLY_QUOTA, monthLimit: OFFICE_LEAVE_MONTHLY_QUOTA, monthUsed: 0 };
  const leaves: any[] = Array.isArray(data?.leaves) ? data.leaves : [];

  const submit = async () => {
    if (!date) return showToast('⚠️ Vui lòng chọn ngày nghỉ!');
    if (reason.trim().length < 2) return showToast('⚠️ Vui lòng nhập lý do nghỉ phép!');
    setBusy(true); setErr('');
    try {
      await apiRequest('/me/office/leaves', { method: 'POST', body: JSON.stringify({ date, reason }) });
      showToast('✅ Đã gửi phiếu nghỉ phép! Chờ Nhân sự → Kế toán → Giám đốc duyệt.');
      setDate(''); setReason('');
      await load();
    } catch (e: any) { setErr(e?.message || 'Lỗi gửi phiếu.'); showToast(`⚠️ ${e?.message || 'Lỗi gửi phiếu.'}`); }
    finally { setBusy(false); }
  };

  const statusBadge = (s: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      PENDING_HR: { label: 'Chờ Nhân sự duyệt', cls: 'badge-warning' },
      PENDING_FINANCE: { label: 'Chờ Kế toán duyệt', cls: 'badge-warning' },
      PENDING_DIRECTOR: { label: 'Chờ Giám đốc duyệt', cls: 'badge-brand' },
      APPROVED: { label: 'Đã duyệt — có hiệu lực', cls: 'badge-success' },
      REJECTED: { label: 'Từ chối', cls: 'badge-danger' },
    };
    const m = map[s] || { label: s, cls: 'badge-warning' };
    return <span className={`badge ${m.cls}`}>{m.label}</span>;
  };

  const chain = (l: any) => {
    const steps = [
      { key: 'HR', label: 'Nhân sự' },
      { key: 'FINANCE', label: 'Kế toán' },
      { key: 'DIRECTOR', label: 'Giám đốc' },
    ];
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        {steps.map((st, i) => {
          const done = (l.history || []).some((h: any) => h.step === st.key && h.decision === 'APPROVE');
          const active = l.current_step === st.key && l.status !== 'REJECTED';
          return (
            <span key={st.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 999,
                background: done ? 'var(--success-soft)' : active ? 'var(--warning-soft)' : '#F1F5F9',
                color: done ? '#065F46' : active ? '#92400E' : '#64748B',
              }}>{done ? '✓ ' : active ? '⏳ ' : ''}{st.label}</span>
              {i < steps.length - 1 && <span style={{ color: '#CBD5E1', fontSize: 11 }}>→</span>}
            </span>
          );
        })}
      </div>
    );
  };

  const minDate = (() => {
    const t = vnToday();
    return t;
  })();

  return (
    <div style={{ paddingTop: 12 }}>
      <Card>
        <SectionTitle>🌴 Đăng ký nghỉ phép</SectionTitle>
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>
          Mỗi tháng được <b>{quota.monthLimit ?? OFFICE_LEAVE_MONTHLY_QUOTA} ngày phép</b>. Phiếu duyệt tuần tự
          <b> Nhân sự → Kế toán → Giám đốc</b>; chỉ có hiệu lực sau khi Giám đốc duyệt.
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <span className="badge badge-brand">Còn {quota.monthRemaining} ngày phép tháng {quota.month}</span>
          <span className="badge" style={{ background: '#F1F5F9', color: '#475569' }}>Đã dùng {quota.monthUsed}</span>
        </div>
        <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>Ngày nghỉ</label>
        <input type="date" min={minDate} value={date} onChange={(e) => setDate(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
        <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>Lý do</label>
        <textarea rows={3} placeholder="VD: Việc gia đình, khám sức khỏe..." value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: '100%', marginBottom: 12, resize: 'vertical' }} />
        {err && <ErrorBox msg={err} />}
        <button className={`btn-primary${busy ? ' fx-loading' : ''}`} disabled={busy || quota.monthRemaining <= 0} style={{ width: '100%' }} onClick={submit}>
          {busy ? 'ĐANG GỬI...' : quota.monthRemaining <= 0 ? '🔒 ĐÃ DÙNG HẾT NGÀY PHÉP THÁNG NÀY' : '📨 GỬI PHIẾU NGHỈ PHÉP'}
        </button>
      </Card>

      <Card>
        <SectionTitle>Phiếu của tôi</SectionTitle>
        {loading && <div className="fx-skeleton" style={{ height: 50 }} />}
        {!loading && leaves.length === 0 && <Empty>Chưa có phiếu nghỉ phép nào.</Empty>}
        {leaves.map((l) => (
          <div key={l.leave_id} style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 10, marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 13 }}>Nghỉ ngày {fmtDate(l.leave_date)}</div>
              {statusBadge(l.status)}
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>Lý do: {l.reason}</div>
            {l.status !== 'REJECTED' && chain(l)}
            {l.rejection_note && <div style={{ fontSize: 11.5, color: '#991B1B', marginTop: 4 }}>Lý do từ chối: {l.rejection_note}</div>}
          </div>
        ))}
      </Card>
    </div>
  );
}

// ============================================================================
// 3. ĐIỂM DANH (VÀO CA 08:00–08:30 + GPS 300m realtime)
// ============================================================================
export function OfficeAttendanceView({ employee, showToast }: OfficeViewProps) {
  void employee;
  const [state, setState] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<'IN' | 'OUT' | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsErr, setGpsErr] = useState('');
  const [distance, setDistance] = useState<number | null>(null);
  const [tick, setTick] = useState(Date.now());
  const watchId = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const d: any = await apiRequest('/me/office/attendance/state');
      setState(d);
    } catch (e: any) { setErr(e?.message || 'Không tải được trạng thái điểm danh.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Đồng hồ realtime để tự cập nhật trạng thái khung giờ.
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  // Theo dõi GPS realtime.
  useEffect(() => {
    if (!navigator.geolocation) { setGpsErr('Thiết bị không hỗ trợ định vị GPS.'); return; }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsErr('');
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy || 0) };
        setCoords(c);
        setDistance(haversine(c.lat, c.lng, OFFICE_LAT, OFFICE_LNG));
      },
      () => setGpsErr('Không lấy được GPS. Hãy bật định vị và cấp quyền cho ứng dụng.'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
    return () => { if (watchId.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId.current); };
  }, []);

  const withinRadius = distance !== null && distance <= OFFICE_GPS_RADIUS_METERS;
  const goodAccuracy = !!coords && coords.accuracy > 0 && coords.accuracy <= 150;

  const doAction = async (kind: 'IN' | 'OUT') => {
    if (!coords) return showToast('⚠️ Chưa có vị trí GPS, vui lòng chờ trong giây lát!');
    setBusy(kind);
    try {
      await apiRequest(`/me/office/${kind === 'IN' ? 'checkin' : 'checkout'}`, {
        method: 'POST',
        body: JSON.stringify({ gps: { latitude: coords.lat, longitude: coords.lng, accuracy: coords.accuracy } }),
      });
      showToast(kind === 'IN' ? '✅ Vào ca thành công!' : '✅ Ra ca thành công!');
      await load();
    } catch (e: any) { showToast(`⚠️ ${e?.message || 'Điểm danh thất bại.'}`); }
    finally { setBusy(null); }
  };

  // Cập nhật trạng thái khung giờ theo đồng hồ máy (server vẫn chốt cứng).
  const nowVn = new Date(tick + 7 * 3_600_000);
  const minutes = nowVn.getUTCHours() * 60 + nowVn.getUTCMinutes();
  const isWorkday = state?.is_workday !== false;
  const inWindow = isWorkday && minutes >= 8 * 60 && minutes <= 8 * 60 + 30;
  const checkedIn = !!state?.checked_in;
  const checkedOut = !!state?.checked_out;

  return (
    <div style={{ paddingTop: 12 }}>
      <Card>
        <SectionTitle>📍 Điểm danh văn phòng</SectionTitle>
        {loading && <div className="fx-skeleton" style={{ height: 60 }} />}
        {err && <ErrorBox msg={err} />}
        {!loading && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div style={{ background: '#F8FAFC', borderRadius: 'var(--radius-sm)', padding: 10 }}>
                <div style={{ fontSize: 11, color: MUTED, fontWeight: 700 }}>GIỜ VÀO CA</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: checkedIn ? '#047857' : MUTED }}>{fmtTime(state?.check_in_at)}</div>
              </div>
              <div style={{ background: '#F8FAFC', borderRadius: 'var(--radius-sm)', padding: 10 }}>
                <div style={{ fontSize: 11, color: MUTED, fontWeight: 700 }}>GIỜ RA CA</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: checkedOut ? '#047857' : MUTED }}>{fmtTime(state?.check_out_at)}</div>
              </div>
            </div>

            <div style={{
              borderRadius: 'var(--radius-sm)', padding: '10px 12px', fontSize: 12.5, fontWeight: 600, marginBottom: 12,
              background: withinRadius && goodAccuracy ? 'var(--success-soft)' : 'var(--warning-soft)',
              color: withinRadius && goodAccuracy ? '#065F46' : '#92400E',
            }}>
              <div>Khung giờ vào ca: <b>{state?.window_from || '08:00'} – {state?.window_to || '08:30'}</b></div>
              {gpsErr && <div>⚠️ {gpsErr}</div>}
              {!gpsErr && distance !== null && (
                <div>
                  GPS: cách văn phòng <b>{distance}m</b> / bán kính {OFFICE_GPS_RADIUS_METERS}m
                  {coords ? ` (sai số ±${coords.accuracy}m)` : ''} — {withinRadius ? '✅ trong bán kính' : '❌ ngoài bán kính'}
                </div>
              )}
              {!gpsErr && distance === null && <div>Đang xác định vị trí GPS…</div>}
            </div>

            {/* Nút VÀO CA: chỉ hiện khi đúng khung 08:00–08:30 + trong 300m + chưa vào ca */}
            {!checkedIn && (
              withinRadius && goodAccuracy && inWindow ? (
                <button className={`btn-primary${busy === 'IN' ? ' fx-loading' : ''}`} disabled={busy !== null} style={{ width: '100%', padding: 14, fontSize: 15 }} onClick={() => doAction('IN')}>
                  {busy === 'IN' ? 'ĐANG GỬI...' : '🟢 VÀO CA'}
                </button>
              ) : (
                <div style={{ textAlign: 'center', fontSize: 12.5, color: MUTED, padding: '10px 6px', background: '#F8FAFC', borderRadius: 'var(--radius-sm)' }}>
                  {!isWorkday ? 'Hôm nay là ngày nghỉ — không cần điểm danh.'
                    : !inWindow ? `Nút VÀO CA chỉ hiện trong khung ${state?.window_from || '08:00'} – ${state?.window_to || '08:30'}.`
                      : !withinRadius ? 'Bạn đang ngoài bán kính 300m — nút điểm danh tạm ẩn.'
                        : 'Sóng GPS yếu — vui lòng ra nơi thoáng rồi thử lại.'}
                </div>
              )
            )}

            {/* Nút RA CA: sau khi đã vào ca + vẫn trong 300m */}
            {checkedIn && !checkedOut && (
              withinRadius && goodAccuracy ? (
                <button className="btn-secondary" disabled={busy !== null} style={{ width: '100%', padding: 14, fontSize: 15, fontWeight: 800, borderColor: BRAND, color: BRAND }} onClick={() => doAction('OUT')}>
                  {busy === 'OUT' ? 'ĐANG GỬI...' : '🔴 RA CA'}
                </button>
              ) : (
                <div style={{ textAlign: 'center', fontSize: 12.5, color: MUTED, padding: '10px 6px', background: '#F8FAFC', borderRadius: 'var(--radius-sm)' }}>
                  Di chuyển lại trong bán kính 300m để RA CA.
                </div>
              )
            )}

            {checkedIn && checkedOut && (
              <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 800, color: '#047857', padding: '10px 0' }}>
                ✅ Đã hoàn tất điểm danh hôm nay · {fmtHours(Number(state?.worked_minutes) || 0)}
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

const OFFICE_LAT = 10.799540;
const OFFICE_LNG = 106.689620;

// ============================================================================
// 4. CÔNG CỦA TÔI (lương tạm tính)
// ============================================================================
export function OfficeTimesheetView({ employee, showToast }: OfficeViewProps) {
  void showToast;
  void employee;
  const [period, setPeriod] = useState(() => vnToday().slice(0, 7));
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const d: any = await apiRequest(`/me/office/timesheet?period=${period}`);
      setData(d);
    } catch (e: any) { setErr(e?.message || 'Không tải được công của tôi.'); }
    finally { setLoading(false); }
  }, [period]);
  useEffect(() => { load(); }, [load]);

  const shiftMonth = (delta: number) => {
    const [y, m] = period.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setPeriod(d.toISOString().slice(0, 7));
  };

  const baseSalary = Number(data?.base_salary) || 0;
  const allowance = Number(data?.allowance) || 0;
  const monthlyTotal = Number(data?.monthly_total) || 0;
  const days: any[] = Array.isArray(data?.days) ? data.days : [];

  return (
    <div style={{ paddingTop: 12 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <button className="btn-secondary" style={{ padding: '6px 12px', minHeight: 36 }} onClick={() => shiftMonth(-1)}>‹</button>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Tháng {period}</div>
          <button className="btn-secondary" style={{ padding: '6px 12px', minHeight: 36 }} onClick={() => shiftMonth(1)}>›</button>
        </div>
        {loading && <div className="fx-skeleton" style={{ height: 90 }} />}
        {err && <ErrorBox msg={err} />}
        {!loading && data && (
          <>
            <div style={{ background: 'linear-gradient(135deg, var(--brand-soft), #FFF)', borderRadius: 'var(--radius-md)', padding: 14, textAlign: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: MUTED, fontWeight: 700 }}>LƯƠNG CƠ BẢN (THEO THÁNG)</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: BRAND }}>{vnd(monthlyTotal)}</div>
              <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>
                Lương CB {vnd(baseSalary)} + Phụ cấp {vnd(allowance)} · Không tính theo ca
              </div>
              {data.configured === false && (
                <div style={{ fontSize: 11, color: '#9A3412', marginTop: 4, fontWeight: 600 }}>
                  Kế toán chưa cấu hình lương tháng cho bạn.
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <div style={{ background: '#F8FAFC', borderRadius: 'var(--radius-sm)', padding: 9, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: MUTED, fontWeight: 700 }}>NGÀY CÔNG</div>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{data.work_days}</div>
              </div>
              <div style={{ background: '#F8FAFC', borderRadius: 'var(--radius-sm)', padding: 9, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: MUTED, fontWeight: 700 }}>TỔNG GIỜ</div>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{data.total_hours}h</div>
              </div>
              <div style={{ background: '#F8FAFC', borderRadius: 'var(--radius-sm)', padding: 9, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: MUTED, fontWeight: 700 }}>NGÀY PHÉP</div>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{data.leave_days}</div>
              </div>
            </div>
          </>
        )}
      </Card>

      <Card>
        <SectionTitle>Chi tiết theo ngày</SectionTitle>
        {!loading && days.length === 0 && <Empty>Chưa có ngày công nào trong tháng.</Empty>}
        {days.map((d) => (
          <div key={d.date} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${BORDER}`, paddingTop: 8, marginTop: 8 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{fmtDate(d.date)}</div>
              <div style={{ fontSize: 11.5, color: MUTED }}>
                Vào {fmtTime(d.check_in_at)} · Ra {fmtTime(d.check_out_at)}
                {d.missing_checkout && <span style={{ color: '#9A3412' }}> · thiếu ra ca</span>}
              </div>
            </div>
            <div style={{ textAlign: 'right', fontWeight: 800, fontSize: 13 }}>
              {fmtHours(Number(d.worked_minutes) || 0)}
            </div>
          </div>
        ))}
      </Card>
      <div style={{ margin: '0 16px 24px', fontSize: 11, color: MUTED, textAlign: 'center' }}>
        * Văn phòng hưởng lương cơ bản theo tháng = Lương CB + Phụ cấp (Kế toán cấu hình), không tính theo ca. Số chính thức do Kế toán chốt ở kỳ lương.
      </div>
    </div>
  );
}

// ============================================================================
// 5. BỔ SUNG CÔNG (4 phiếu/tháng)
// ============================================================================
export function OfficeAdjustmentView({ employee, showToast }: OfficeViewProps) {
  void employee;
  const [data, setData] = useState<any>(null);
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const d: any = await apiRequest('/me/office/adjustments');
      setData(d);
    } catch (e: any) { setErr(e?.message || 'Không tải được phiếu bổ sung công.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const quota = data?.quota || { monthRemaining: OFFICE_ADJUST_MONTHLY_QUOTA, monthLimit: OFFICE_ADJUST_MONTHLY_QUOTA, monthUsed: 0, locked: false };
  const list: any[] = Array.isArray(data?.adjustments) ? data.adjustments : [];
  const locked = !!quota.locked || quota.monthRemaining <= 0;

  const submit = async () => {
    if (locked) return;
    if (!date) return showToast('⚠️ Vui lòng chọn ngày cần bổ sung công!');
    if (reason.trim().length < 2) return showToast('⚠️ Vui lòng nhập lý do!');
    setBusy(true); setErr('');
    try {
      await apiRequest('/me/office/adjustments', {
        method: 'POST',
        body: JSON.stringify({ date, reason, minutesRequested: Number(minutes) || 0 }),
      });
      showToast('✅ Đã gửi phiếu bổ sung công!');
      setDate(''); setReason(''); setMinutes('');
      await load();
    } catch (e: any) { setErr(e?.message || 'Lỗi gửi phiếu.'); showToast(`⚠️ ${e?.message || 'Lỗi gửi phiếu.'}`); }
    finally { setBusy(false); }
  };

  const badge = (s: string) => {
    const m: Record<string, string> = { PENDING: 'badge-warning', APPROVED: 'badge-success', REJECTED: 'badge-danger' };
    const label: Record<string, string> = { PENDING: 'Chờ duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Từ chối' };
    return <span className={`badge ${m[s] || 'badge-warning'}`}>{label[s] || s}</span>;
  };

  return (
    <div style={{ paddingTop: 12 }}>
      <Card>
        <SectionTitle>📝 Bổ sung công</SectionTitle>
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>
          Mỗi tháng có <b>{quota.monthLimit ?? OFFICE_ADJUST_MONTHLY_QUOTA} phiếu</b>. Dùng hết thì chức năng khóa tới tháng sau.
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <span className="badge badge-brand">Còn {quota.monthRemaining}/{quota.monthLimit ?? OFFICE_ADJUST_MONTHLY_QUOTA} phiếu tháng {quota.month}</span>
        </div>

        {locked ? (
          <div style={{ background: 'var(--warning-soft)', color: '#92400E', borderRadius: 'var(--radius-sm)', padding: 14, textAlign: 'center', fontWeight: 700, fontSize: 13 }}>
            🔒 Bạn đã dùng hết {OFFICE_ADJUST_MONTHLY_QUOTA} phiếu bổ sung công trong tháng.<br />
            <span style={{ fontWeight: 500, fontSize: 12 }}>Sang tháng mới hệ thống tự động mở lại.</span>
          </div>
        ) : (
          <>
            <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>Ngày cần bổ sung</label>
            <input type="date" max={vnToday()} value={date} onChange={(e) => setDate(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
            <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>Số phút cần bổ sung (không bắt buộc)</label>
            <input type="number" min={0} max={1440} placeholder="VD: 480 (8 giờ)" value={minutes} onChange={(e) => setMinutes(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
            <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>Lý do</label>
            <textarea rows={3} placeholder="VD: Quên vào ca / lỗi GPS / sự cố..." value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: '100%', marginBottom: 12, resize: 'vertical' }} />
            {err && <ErrorBox msg={err} />}
            <button className={`btn-primary${busy ? ' fx-loading' : ''}`} disabled={busy} style={{ width: '100%' }} onClick={submit}>
              {busy ? 'ĐANG GỬI...' : '📨 GỬI PHIẾU BỔ SUNG CÔNG'}
            </button>
          </>
        )}
      </Card>

      <Card>
        <SectionTitle>Phiếu của tôi</SectionTitle>
        {loading && <div className="fx-skeleton" style={{ height: 50 }} />}
        {!loading && list.length === 0 && <Empty>Chưa có phiếu bổ sung công nào.</Empty>}
        {list.map((a) => (
          <div key={a.adjustment_id} style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 10, marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 13 }}>Ngày {fmtDate(a.work_date)}</div>
              {badge(a.status)}
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>Lý do: {a.reason}</div>
            {Number(a.minutes_requested) > 0 && <div style={{ fontSize: 11.5, color: MUTED }}>Số phút: {a.minutes_requested} phút</div>}
            {a.review_note && <div style={{ fontSize: 11.5, color: '#991B1B', marginTop: 2 }}>Phản hồi: {a.review_note}</div>}
          </div>
        ))}
      </Card>
    </div>
  );
}
