/**
 * OfficePortal — giao diện cổng nhân viên KHỐI VĂN PHÒNG (group = VAN_PHONG).
 *
 * Quy chế Văn Phòng:
 * - Lịch làm việc HÀNH CHÍNH cố định: T2–T6 08:00–17:00, T7 08:00–12:00, CN nghỉ.
 * - Không xếp ca, không đăng ký OFF, không đổi ca, không thi test.
 * - Điểm danh: VÀO CA chỉ trong khung 08:00–08:30, GPS trong 300m.
 * - Lương: theo tháng = Lương cơ bản + Phụ cấp (Kế toán cấu hình), không tính theo ca.
 * - Bổ sung công: 4 phiếu/tháng.
 *
 * Thiết kế mới: card-based, màu xanh doanh nghiệp, mobile-first.
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

const BRAND = '#1D4ED8';
const BRAND_SOFT = '#EFF6FF';
const MUTED = '#64748B';
const BORDER = '#E2E8F0';
const BG = '#F8FAFC';
const SUCCESS = '#059669';
const SUCCESS_SOFT = '#ECFDF5';
const WARN = '#B45309';
const WARN_SOFT = '#FEF3C7';
const DANGER = '#DC2626';

const vnToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const mondayOf = (iso: string) => {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  const dow = new Date(t).getUTCDay();
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
  <div style={{ background: '#FFF', borderRadius: 16, border: `1px solid ${BORDER}`, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', margin: '0 16px 14px', ...(style || {}) }}>{children}</div>
);
const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A', marginBottom: 10, textTransform: 'uppercase' }}>{children}</div>
);
const ErrorBox = ({ msg }: { msg: string }) => (
  <div style={{ background: '#FEF2F2', color: '#991B1B', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, fontWeight: 600, marginBottom: 10, border: `1px solid #FECACA` }}>{msg}</div>
);
const Empty = ({ children }: { children: React.ReactNode }) => (
  <div style={{ textAlign: 'center', color: MUTED, fontSize: 13, padding: '24px 8px' }}>{children}</div>
);
const StatCard = ({ title, value, sub, color, icon }: { title: string; value: string; sub?: string; color?: string; icon?: string }) => (
  <div style={{ background: BG, borderRadius: 14, padding: '14px 12px', textAlign: 'center', border: `1px solid ${BORDER}` }}>
    <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, marginBottom: 4 }}>{title}</div>
    <div style={{ fontSize: 20, fontWeight: 800, color: color || '#0F172A' }}>{value}</div>
    {sub ? <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{sub}</div> : null}
  </div>
);

// ============================================================================
// 1. TRANG CHỦ — TỔNG QUAN
// ============================================================================
export function OfficeHomeView({ employee, showToast }: OfficeViewProps) {
  const [period, setPeriod] = useState(() => vnToday().slice(0, 7));
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const d: any = await apiRequest(`/me/office/timesheet?period=${period}`);
      setData(d);
    } catch (e: any) { setErr(e?.message || 'Không tải được dữ liệu.'); }
    finally { setLoading(false); }
  }, [period]);
  useEffect(() => { load(); }, [load]);

  const baseSalary = Number(data?.base_salary) || 0;
  const allowance = Number(data?.allowance) || 0;
  const monthlyTotal = Number(data?.monthly_total) || 0;

  return (
    <div style={{ paddingTop: 12 }}>
      <Card>
        <div style={{ padding: '18px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 20 }}>👋</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#0F172A' }}>{employee?.full_name || 'Nhân viên Văn Phòng'}</div>
              <div style={{ fontSize: 11.5, color: MUTED, fontWeight: 600 }}>{employee?.employee_code} • Văn Phòng Trụ Sở Chính</div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>
            Lương theo tháng = Lương cơ bản + Phụ cấp (Kế toán cấu hình). Không tính theo ca/giờ.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <StatCard title="Lương tháng" value={vnd(monthlyTotal)} sub="LCB + phụ cấp" color={BRAND} />
            <StatCard title="Ngày công" value={`${data?.work_days ?? 0} ngày`} sub="Trong tháng hiện tại" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <StatCard title="Tổng giờ" value={`${data?.total_hours ?? 0}h`} sub="Giờ làm theo chấm công" />
            <StatCard title="Ngày phép" value={`${data?.leave_days ?? 0} ngày`} sub="Đã nghỉ phép tháng này" color="#9D174D" />
          </div>
          {data && data.configured === false && (
            <div style={{ marginTop: 10, background: WARN_SOFT, border: `1px solid #FDE68A`, borderRadius: 10, padding: '8px 12px', fontSize: 12, color: WARN, fontWeight: 600 }}>
              ⚠️ Kế toán chưa cấu hình lương tháng cho bạn.
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div style={{ padding: '16px' }}>
          <SectionTitle>Lịch làm việc 7 ngày</SectionTitle>
          {loading && <div className="fx-skeleton" style={{ height: 400 }} />}
          {err && <ErrorBox msg={err} />}
          {!loading && data && data.days && data.days.length > 0 && (
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
              {data.days.slice(0, 7).map((d: any) => {
                const rule = officeRuleOfWeekday(Number(d.weekday));
                const isToday = d.date === vnToday();
                const isWork = !!rule?.work;
                const checkedIn = !!d.check_in_at;
                const checkedOut = !!d.check_out_at;
                const isCompleted = checkedIn && checkedOut;
                const statusColor = isCompleted ? SUCCESS : checkedIn ? WARN : isWork ? BRAND : MUTED;
                return (
                  <div key={d.date} style={{ flex: '0 0 auto', width: 95, background: isToday ? BRAND_SOFT : '#FFF', borderRadius: 14, border: `1px solid ${isToday ? BRAND : BORDER}`, padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: isWork ? (isToday ? BRAND : '#F1F5F9') : '#F1F5F9', color: isWork ? (isToday ? '#FFF' : MUTED) : '#9CA3AF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12 }}>
                      {d.weekday_label?.replace('Thứ ', 'T') || 'CN'}
                    </div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: '#0F172A', textAlign: 'center' }}>{fmtDate(d.date)}</div>
                    <div style={{ fontSize: 10, color: MUTED, textAlign: 'center' }}>{isWork ? officeDayHoursLabel(d.date) : 'Nghỉ'}</div>
                    <div style={{ width: 26, height: 26, borderRadius: 8, background: statusColor === SUCCESS ? SUCCESS_SOFT : statusColor === WARN ? WARN_SOFT : BG, color: statusColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 11 }}>
                      {isCompleted ? '✓' : checkedIn ? '⏱' : isWork ? '◐' : '—'}
                    </div>
                    <div style={{ fontSize: 9.5, color: MUTED, textAlign: 'center', fontWeight: 600 }}>
                      {isCompleted ? 'Đã ra ca' : checkedIn ? 'Đang làm' : isWork ? 'Chưa vào' : 'Nghỉ'}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div style={{ padding: '16px' }}>
          <SectionTitle>Chức năng nhanh</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button className="btn-primary" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '16px 10', borderRadius: 14, background: BRAND, color: '#FFF', border: 'none', fontWeight: 800, fontSize: 13, cursor: 'pointer' }} onClick={() => showToast('Chuyển sang tab Điểm danh')}>
              <span style={{ fontSize: 24 }}>📍</span>
              <span>Điểm danh</span>
            </button>
            <button className="btn-primary" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '16px 10', borderRadius: 14, background: '#FFF', color: BRAND, border: `1px solid ${BRAND}`, fontWeight: 800, fontSize: 13, cursor: 'pointer' }} onClick={() => showToast('Chuyển sang tab Công của tôi')}>
              <span style={{ fontSize: 24 }}>💰</span>
              <span>Xem lương</span>
            </button>
            <button className="btn-primary" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '16px 10', borderRadius: 14, background: '#FFF', color: '#0F172A', border: `1px solid ${BORDER}`, fontWeight: 800, fontSize: 13, cursor: 'pointer' }} onClick={() => showToast('Chuyển sang tab Bổ sung công')}>
              <span style={{ fontSize: 24 }}>📝</span>
              <span>Bổ sung công</span>
            </button>
            <button className="btn-primary" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '16px 10', borderRadius: 14, background: '#FFF', color: '#0F172A', border: `1px solid ${BORDER}`, fontWeight: 800, fontSize: 13, cursor: 'pointer' }} onClick={() => showToast('Chuyển sang tab Hồ Sơ')}>
              <span style={{ fontSize: 24 }}>👤</span>
              <span>Hồ sơ</span>
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
// 2. LỊCH LÀM VIỆC HÀNH CHÍNH
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
        <div style={{ padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <SectionTitle>Lịch làm việc hành chính</SectionTitle>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className={sel === 'THIS' ? 'btn-primary' : 'btn-secondary'} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 8, background: sel === 'THIS' ? BRAND : '#FFF', color: sel === 'THIS' ? '#FFF' : '#0F172A', border: `1px solid ${sel === 'THIS' ? BRAND : BORDER}` }} onClick={() => setSel('THIS')}>Tuần này</button>
              <button className={sel === 'NEXT' ? 'btn-primary' : 'btn-secondary'} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 8, background: sel === 'NEXT' ? BRAND : '#FFF', color: sel === 'NEXT' ? '#FFF' : '#0F172A', border: `1px solid ${sel === 'NEXT' ? BRAND : BORDER}` }} onClick={() => setSel('NEXT')}>Tuần sau</button>
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 14 }}>
            Thứ 2 – Thứ 6: 08:00 – 17:00 · Thứ 7: 08:00 – 12:00 · Chủ nhật nghỉ
          </div>

          {err && <Card><ErrorBox msg={err} /></Card>}
          {loading && <Card><div className="fx-skeleton" style={{ height: 60 }} /></Card>}

          {!loading && days.map((d) => {
            const rule = officeRuleOfWeekday(Number(d.weekday));
            const isToday = d.date === today;
            const isLeave = !!d.is_leave;
            const isWork = !!rule?.work;
            const status = isLeave ? 'Nghỉ phép (đã duyệt)'
              : !isWork ? 'Nghỉ tuần'
                : d.check_in_at && d.check_out_at ? 'Đã làm ' + fmtHours(Number(d.worked_minutes) || 0)
                  : d.check_in_at ? 'Đang làm (chưa ra ca)'
                    : d.date < today ? 'Không có công'
                      : d.date === today ? 'Hôm nay' : 'Sắp tới';
            const statusColor = isLeave ? '#9D174D' : d.check_in_at && d.check_out_at ? SUCCESS : d.check_in_at ? WARN : MUTED;
            return (
              <Card key={d.date} style={isToday ? { border: `1.5px solid ${BRAND}` } : undefined}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 42, height: 42, borderRadius: 12, flexShrink: 0,
                      background: isWork && !isLeave ? BRAND_SOFT : '#F1F5F9',
                      color: isWork && !isLeave ? BRAND : '#9CA3AF',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13,
                    }}>
                      {d.weekday_label?.replace('Thứ ', 'T') || 'CN'}
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 14, color: '#0F172A' }}>
                        {rule?.label || 'Chủ nhật'} · {fmtDate(d.date)} {isToday && <span style={{ color: BRAND, fontSize: 11, marginLeft: 4 }}>(Hôm nay)</span>}
                      </div>
                      <div style={{ fontSize: 11, color: MUTED }}>{isWork ? officeDayHoursLabel(d.date) : 'Ngày nghỉ'}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 11.5, fontWeight: 800, color: statusColor }}>{status}</div>
                </div>
                {isWork && !isLeave && (
                  <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 12, color: MUTED, padding: '0 16px 10px' }}>
                    <span>Vào: <b style={{ color: d.check_in_at ? SUCCESS : MUTED }}>{fmtTime(d.check_in_at)}</b></span>
                    <span>Ra: <b style={{ color: d.check_out_at ? SUCCESS : MUTED }}>{fmtTime(d.check_out_at)}</b></span>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
// 3. ĐIỂM DANH
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

  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

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

  const nowVn = new Date(tick + 7 * 3_600_000);
  const minutes = nowVn.getUTCHours() * 60 + nowVn.getUTCMinutes();
  const isWorkday = state?.is_workday !== false;
  const inWindow = isWorkday && minutes >= 8 * 60 && minutes <= 8 * 60 + 30;
  const checkedIn = !!state?.checked_in;
  const checkedOut = !!state?.checked_out;

  return (
    <div style={{ paddingTop: 12 }}>
      <Card>
        <div style={{ padding: '16px' }}>
          <SectionTitle>Điểm danh văn phòng</SectionTitle>
          {loading && <div className="fx-skeleton" style={{ height: 60 }} />}
          {err && <ErrorBox msg={err} />}
          {!loading && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                <div style={{ background: BG, borderRadius: 14, padding: 14, border: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: 11, color: MUTED, fontWeight: 700 }}>Giờ vào ca</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: checkedIn ? SUCCESS : MUTED }}>{fmtTime(state?.check_in_at)}</div>
                </div>
                <div style={{ background: BG, borderRadius: 14, padding: 14, border: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: 11, color: MUTED, fontWeight: 700 }}>Giờ ra ca</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: checkedOut ? SUCCESS : MUTED }}>{fmtTime(state?.check_out_at)}</div>
                </div>
              </div>

              <div style={{
                borderRadius: 12, padding: '12px 14px', fontSize: 12.5, fontWeight: 600, marginBottom: 14,
                background: withinRadius && goodAccuracy ? SUCCESS_SOFT : WARN_SOFT,
                color: withinRadius && goodAccuracy ? '#065F46' : WARN,
                border: `1px solid ${withinRadius && goodAccuracy ? '#A7F3D0' : '#FDE68A'}`,
              }}>
                <div>Khung giờ vào ca: <b>{state?.window_from || '08:00'} – {state?.window_to || '08:30'}</b></div>
                {gpsErr && <div style={{ marginTop: 4 }}>⚠️ {gpsErr}</div>}
                {!gpsErr && distance !== null && (
                  <div style={{ marginTop: 4 }}>
                    GPS: cách văn phòng <b>{distance}m</b> / bán kính {OFFICE_GPS_RADIUS_METERS}m
                    {coords ? ` (sai số ±${coords.accuracy}m)` : ''} — {withinRadius ? '✅ Trong bán kính' : '❌ Ngoài bán kính'}
                  </div>
                )}
                {!gpsErr && distance === null && <div style={{ marginTop: 4 }}>Đang xác định vị trí GPS…</div>}
              </div>

              {!checkedIn && (
                withinRadius && goodAccuracy && inWindow ? (
                  <button className={`btn-primary${busy === 'IN' ? ' fx-loading' : ''}`} disabled={busy !== null} style={{ width: '100%', padding: 16, fontSize: 16, fontWeight: 800, borderRadius: 12, background: SUCCESS, color: '#FFF', border: 'none' }} onClick={() => doAction('IN')}>
                    {busy === 'IN' ? 'ĐANG GỬI...' : '🟢 VÀO CA'}
                  </button>
                ) : (
                  <div style={{ textAlign: 'center', fontSize: 12.5, color: MUTED, padding: '14px 6px', background: BG, borderRadius: 12 }}>
                    {!isWorkday ? 'Hôm nay là ngày nghỉ — không cần điểm danh.'
                      : !inWindow ? `Nút VÀO CA chỉ hiện trong khung ${state?.window_from || '08:00'} – ${state?.window_to || '08:30'}.`
                        : !withinRadius ? 'Bạn đang ngoài bán kính 300m — nút điểm danh tạm ẩn.'
                          : 'Sóng GPS yếu — vui lòng ra nơi thoáng rồi thử lại.'}
                  </div>
                )
              )}

              {checkedIn && !checkedOut && (
                withinRadius && goodAccuracy ? (
                  <button className="btn-primary" disabled={busy !== null} style={{ width: '100%', padding: 16, fontSize: 16, fontWeight: 800, borderRadius: 12, background: DANGER, color: '#FFF', border: 'none' }} onClick={() => doAction('OUT')}>
                    {busy === 'OUT' ? 'ĐANG GỬI...' : '🔴 RA CA'}
                  </button>
                ) : (
                  <div style={{ textAlign: 'center', fontSize: 12.5, color: MUTED, padding: '14px 6px', background: BG, borderRadius: 12 }}>
                    Di chuyển lại trong bán kính 300m để RA CA.
                  </div>
                )
              )}

              {checkedIn && checkedOut && (
                <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 800, color: SUCCESS, padding: '14px 0', background: SUCCESS_SOFT, borderRadius: 12, border: `1px solid #A7F3D0` }}>
                  ✅ Đã hoàn tất điểm danh hôm nay · {fmtHours(Number(state?.worked_minutes) || 0)}
                </div>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

const OFFICE_LAT = 10.799540;
const OFFICE_LNG = 106.689620;

// ============================================================================
// 4. CÔNG CỦA TÔI (lương tạm tính theo tháng)
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
        <div style={{ padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <button className="btn-secondary" style={{ padding: '6px 12px', minHeight: 36, fontSize: 16 }} onClick={() => shiftMonth(-1)}>‹</button>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#0F172A' }}>Tháng {period}</div>
            <button className="btn-secondary" style={{ padding: '6px 12px', minHeight: 36, fontSize: 16 }} onClick={() => shiftMonth(1)}>›</button>
          </div>
          {loading && <div className="fx-skeleton" style={{ height: 90 }} />}
          {err && <ErrorBox msg={err} />}
          {!loading && data && (
            <div>
              <div style={{ background: 'linear-gradient(135deg, ' + BRAND_SOFT + ', #FFF)', borderRadius: 16, padding: 16, textAlign: 'center', marginBottom: 14, border: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 12, color: MUTED, fontWeight: 700 }}>Lương tháng (LCB + phụ cấp)</div>
                <div style={{ fontSize: 30, fontWeight: 900, color: BRAND, marginTop: 4 }}>{vnd(monthlyTotal)}</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
                  Lương CB {vnd(baseSalary)} + Phụ cấp {vnd(allowance)}
                </div>
                {data.configured === false && (
                  <div style={{ fontSize: 11.5, color: WARN, marginTop: 6, fontWeight: 600, background: WARN_SOFT, display: 'inline-block', padding: '4px 10px', borderRadius: 8, border: `1px solid #FDE68A` }}>
                    Kế toán chưa cấu hình lương tháng cho bạn.
                  </div>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
                <StatCard title="Ngày công" value={`${data.work_days}`} sub="Có điểm danh" color="#0F172A" />
                <StatCard title="Tổng giờ" value={`${data.total_hours}h`} sub="Giờ làm thực tế" color="#0F172A" />
                <StatCard title="Ngày phép" value={`${data.leave_days}`} sub="Đã nghỉ tháng này" color="#9D174D" />
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div style={{ padding: '16px' }}>
          <SectionTitle>Chi tiết theo ngày</SectionTitle>
          {!loading && days.length === 0 && <Empty>Chưa có ngày công nào trong tháng.</Empty>}
          {days.map((d) => (
            <div key={d.date} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${BORDER}`, padding: '12px 16px' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, color: '#0F172A' }}>{fmtDate(d.date)}</div>
                <div style={{ fontSize: 11.5, color: MUTED }}>
                  Vào {fmtTime(d.check_in_at)} | Ra {fmtTime(d.check_out_at)}
                  {d.missing_checkout && <span style={{ color: WARN }}> · thiếu ra ca</span>}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontWeight: 800, fontSize: 15, color: BRAND }}>
                {fmtHours(Number(d.worked_minutes) || 0)}
              </div>
            </div>
          ))}
        </div>
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
  const locked = !!quota.locked || quota.monthRemaining <= 0;
  const list: any[] = Array.isArray(data?.adjustments) ? data.adjustments : [];

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
    const map: Record<string, { label: string; cls: string }> = {
      PENDING: { label: 'Chờ duyệt', cls: 'badge-warning' },
      APPROVED: { label: 'Đã duyệt', cls: 'badge-success' },
      REJECTED: { label: 'Từ chối', cls: 'badge-danger' },
      PAID: { label: 'Đã chi trả', cls: 'badge-brand' },
    };
    const m = map[s] || { label: s, cls: 'badge-warning' };
    return <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: m.cls === 'badge-success' ? SUCCESS_SOFT : m.cls === 'badge-danger' ? '#FEF2F2' : m.cls === 'badge-brand' ? BRAND_SOFT : '#F1F5F9', color: m.cls === 'badge-success' ? '#065F46' : m.cls === 'badge-danger' ? '#991B1B' : m.cls === 'badge-brand' ? BRAND : '#475569' }}>{m.label}</span>;
  };

  return (
    <div style={{ paddingTop: 12 }}>
      <Card>
        <div style={{ padding: '16px' }}>
          <SectionTitle>Bổ sung công</SectionTitle>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 12 }}>
            Mỗi tháng được <b>{quota.monthLimit} phiếu bổ sung công</b>. Dùng hết sẽ khóa đến tháng sau.
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 8, background: '#F1F5F9', color: '#475569' }}>Còn {quota.monthRemaining} phiếu</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 8, background: '#F1F5F9', color: '#475569' }}>Đã dùng {quota.monthUsed}</span>
          </div>
          <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>Ngày cần bổ sung</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
          <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>Lý do</label>
          <textarea rows={3} placeholder="VD: Làm thêm dự án, hỗ trợ sự kiện..." value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: '100%', marginBottom: 8, resize: 'vertical' }} />
          <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>Số phút bổ sung</label>
          <input type="number" min={0} value={minutes} onChange={(e) => setMinutes(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
          {err && <ErrorBox msg={err} />}
          <button className={`btn-primary${busy ? ' fx-loading' : ''}`} disabled={busy || locked || quota.monthRemaining <= 0} style={{ width: '100%', padding: 14, fontSize: 15, fontWeight: 800, borderRadius: 12 }} onClick={submit}>
            {busy ? 'ĐANG GỬI...' : locked ? '🔒 ĐÃ KHÓA THÁNG NÀY' : quota.monthRemaining <= 0 ? '🔒 ĐÃ HẾT PHIẾU' : '📨 GỬI PHIẾU BỔ SUNG'}
          </button>
        </div>
      </Card>

      <Card>
        <div style={{ padding: '16px' }}>
          <SectionTitle>Lịch sử phiếu</SectionTitle>
          {loading && <div className="fx-skeleton" style={{ height: 50 }} />}
          {!loading && list.length === 0 && <Empty>Chưa có phiếu bổ sung công nào.</Empty>}
          {list.map((l) => (
            <div key={l.adjustment_id || l.id} style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 10, marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ fontWeight: 800, fontSize: 13 }}>Bổ sung ngày {fmtDate(l.date || l.adjustment_date)}</div>
                {badge(l.status || l.decision)}
              </div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>Lý do: {l.reason}</div>
              {l.minutes_requested > 0 && <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>Số phút: {l.minutes_requested} phút</div>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
