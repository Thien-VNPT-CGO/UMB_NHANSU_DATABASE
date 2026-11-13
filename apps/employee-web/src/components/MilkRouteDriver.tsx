/**
 * MilkRouteDriver — Tab "Vận chuyển sữa" cho tài xế (nhãn BETA).
 *
 * Nghiệp vụ theo Markdown/VAN_CHUYEN_SUA_UMBOMILK.md:
 * - Bắt đầu ca phải đứng trong geofence điểm xuất phát (≤100m, sai số GPS ≤30m).
 * - Theo dõi GPS bằng watchPosition, gửi batch lên /ev/me/gps (Live Map admin).
 * - Bấm xác nhận từng điểm: chỉ hợp lệ khi cách điểm ≤ geofence_radius_m (100m).
 * - Đếm ngược SLA từng chặng (60/45/45/45/60/15 phút) — trễ = trừ điểm phạt.
 * - Phiếu sạc: tạo sau khi giao xong ở Văn phòng, duyệt 2 cấp (HR → GĐ),
 *   bắt đầu sạc phải đúng ngày + ghim GPS.
 *
 * Mọi call đi qua apiRequest (tự refresh token, tự đánh thức backend).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../services/api';
import {
  Truck,
  Navigation,
  BatteryCharging,
  CheckCircle2,
  Circle,
  MapPin,
  Clock,
  Play,
  Square,
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface Props {
  employee: any;
  showToast: (msg: string) => void;
  /** Tăng khi realtime báo dữ liệu đổi → tự tải lại. */
  refreshKey?: number;
}

const BRAND = '#0F766E';
const BRAND_SOFT = '#F0FDFA';
const MUTED = '#64748B';
const BORDER = '#E2E8F0';
const BG = '#F8FAFC';
const SUCCESS = '#059669';
const WARN = '#B45309';
const WARN_SOFT = '#FEF3C7';
const DANGER = '#DC2626';
const DANGER_SOFT = '#FEF2F2';

const STATUS_LABEL: Record<string, { text: string; fg: string; bg: string }> = {
  SCHEDULED: { text: 'Chờ bắt đầu', fg: '#1D4ED8', bg: '#EFF6FF' },
  IN_PROGRESS: { text: 'Đang chạy', fg: SUCCESS, bg: '#ECFDF5' },
  CHARGING: { text: 'Đang sạc', fg: '#7C3AED', bg: '#F5F3FF' },
  RETURNING: { text: 'Về xưởng', fg: '#0369A1', bg: '#F0F9FF' },
  PAUSED: { text: 'Tạm dừng', fg: WARN, bg: WARN_SOFT },
  COMPLETED: { text: 'Hoàn thành', fg: MUTED, bg: '#F1F5F9' },
  CANCELLED: { text: 'Đã hủy', fg: DANGER, bg: DANGER_SOFT },
};

const TICKET_STATUS: Record<string, { text: string; fg: string; bg: string }> = {
  DRAFT: { text: 'Nháp', fg: MUTED, bg: '#F1F5F9' },
  PENDING_HR: { text: 'Chờ HR duyệt', fg: WARN, bg: WARN_SOFT },
  PENDING_DIRECTOR: { text: 'Chờ Giám đốc duyệt', fg: '#1D4ED8', bg: '#EFF6FF' },
  APPROVED: { text: 'Đã duyệt', fg: SUCCESS, bg: '#ECFDF5' },
  REJECTED: { text: 'Từ chối', fg: DANGER, bg: DANGER_SOFT },
  USED: { text: 'Đã dùng sạc', fg: '#7C3AED', bg: '#F5F3FF' },
  EXPIRED: { text: 'Hết hạn', fg: MUTED, bg: '#F1F5F9' },
};

const haversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const fmtClock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
};

const fmtMin = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `${min} phút`);

const fmtTime = (iso?: string) => {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
};

type Coords = { lat: number; lng: number; accuracy: number; speed: number | null; heading: number | null; at: number };

export function MilkRouteDriverView({ employee, showToast, refreshKey = 0 }: Props) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [current, setCurrent] = useState<any>(null);
  const [todayShifts, setTodayShifts] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [tickets, setTickets] = useState<any[]>([]);
  const [payroll, setPayroll] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [gpsErr, setGpsErr] = useState('');
  const [gpsSent, setGpsSent] = useState(0);
  const [showPayroll, setShowPayroll] = useState(false);
  const [showTicketForm, setShowTicketForm] = useState(false);
  const [ticketForm, setTicketForm] = useState({ date: '', battery: '', notes: '' });
  const [nowMs, setNowMs] = useState(Date.now());

  const watchIdRef = useRef<number | null>(null);
  const coordsRef = useRef<Coords | null>(null);
  const bufferRef = useRef<any[]>([]);
  const shiftRef = useRef<any>(null);
  const sendingRef = useRef(false);

  const status = String(current?.status || '');
  const isRunning = status === 'IN_PROGRESS' || status === 'CHARGING' || status === 'RETURNING' || status === 'PAUSED';

  // ------------------------------------------------------------------
  // Dữ liệu
  // ------------------------------------------------------------------
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const d: any = await apiRequest('/ev/me/shifts');
      const cur = d?.current || null;
      setCurrent(cur);
      setTodayShifts(Array.isArray(d?.items) ? d.items : []);
      shiftRef.current = cur;

      if (cur) {
        const det: any = await apiRequest(`/ev/me/shifts/${cur.shift_id}`).catch(() => null);
        setDetail(det);
      } else {
        setDetail(null);
      }
      const tks: any = await apiRequest('/ev/me/charging-tickets').catch(() => []);
      setTickets(Array.isArray(tks) ? tks : []);
      setErr('');
    } catch (e: any) {
      if (!silent) setErr(e?.message || 'Không tải được ca vận chuyển.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  // Tự làm mới khi còn phiếu chờ duyệt (HR/Giám đốc duyệt xong là tài xế thấy ngay)
  // hoặc khi ca đang chạy (đồng bộ trạng thái ca/điểm dừng). Không cần F5.
  useEffect(() => {
    const hasPendingTicket = tickets.some((t: any) => t.status === 'PENDING_HR' || t.status === 'PENDING_DIRECTOR');
    if (!hasPendingTicket && !isRunning) return;
    const timer = setInterval(() => { void load(true); }, 30000);
    return () => clearInterval(timer);
  }, [tickets, isRunning, load]);

  // Đồng hồ đếm ngược SLA (1s/lần, chỉ khi ca đang chạy).
  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isRunning]);

  const loadPayroll = useCallback(async () => {
    try {
      const p: any = await apiRequest('/ev/me/payroll').catch(() => []);
      setPayroll(Array.isArray(p) ? p : p ? [p] : []);
    } catch { /* tab lương lỗi không chặn vận hành */ }
  }, []);

  // ------------------------------------------------------------------
  // GPS: watchPosition + gửi batch định kỳ khi ca đang chạy
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!navigator.geolocation) { setGpsErr('Thiết bị không hỗ trợ định vị GPS.'); return; }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsErr('');
        const c: Coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy || 0),
          speed: pos.coords.speed,
          heading: pos.coords.heading,
          at: Date.now(),
        };
        coordsRef.current = c;
        setCoords(c);
      },
      () => setGpsErr('Không lấy được GPS — bật định vị & cấp quyền cho ứng dụng.'),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 },
    );
    return () => {
      if (watchIdRef.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  const flushGps = useCallback(async () => {
    const shift = shiftRef.current;
    if (!shift || sendingRef.current || !bufferRef.current.length) return;
    const st = String(shift.status || '');
    if (st !== 'IN_PROGRESS' && st !== 'CHARGING' && st !== 'RETURNING') return;
    const points = bufferRef.current.splice(0, bufferRef.current.length);
    sendingRef.current = true;
    try {
      const r: any = await apiRequest('/ev/me/gps', {
        method: 'POST',
        body: JSON.stringify({ points }),
      });
      setGpsSent((n) => n + Number(r?.saved || 0));
    } catch {
      // Giữ điểm trong buffer để gửi lượt sau (mạng yếu giữa các điểm giao).
      bufferRef.current.unshift(...points);
      if (bufferRef.current.length > 300) bufferRef.current.splice(0, bufferRef.current.length - 300);
    } finally {
      sendingRef.current = false;
    }
  }, []);

  // Gửi 1 lượt mỗi 15s khi ca đang chạy.
  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => { void flushGps(); }, 15000);
    return () => clearInterval(t);
  }, [isRunning, flushGps]);

  // Đưa vị trí vào buffer (gộp nếu quá dày — tối thiểu 5s/điểm).
  useEffect(() => {
    if (!isRunning || !coords) return;
    const last = bufferRef.current[bufferRef.current.length - 1];
    if (last && Date.now() - last._at < 5000) return;
    const battery = (navigator as any)?.getBattery ? undefined : undefined;
    bufferRef.current.push({
      shift_id: shiftRef.current?.shift_id,
      recorded_at: new Date().toISOString(),
      latitude: coords.lat,
      longitude: coords.lng,
      accuracy: coords.accuracy,
      speed: coords.speed ?? undefined,
      heading: coords.heading ?? undefined,
      battery: battery,
      is_mock: false,
      _at: Date.now(),
    });
  }, [coords, isRunning]);

  // Gửi nốt khi rời tab / đóng app.
  useEffect(() => () => { void flushGps(); }, [flushGps]);

  // ------------------------------------------------------------------
  // Hành động
  // ------------------------------------------------------------------
  const needCoords = (label: string): Coords | null => {
    const c = coordsRef.current;
    if (!c) { showToast(`⚠️ Chưa có vị trí GPS — ${label} cần định vị. Chờ vài giây rồi thử lại.`); return null; }
    if (c.accuracy > 30) { showToast(`⚠️ Sai số GPS ${c.accuracy}m (yêu cầu ≤30m) — ra chỗ thoáng chờ cập nhật.`); return null; }
    return c;
  };

  const startShift = async () => {
    const c = needCoords('bắt đầu ca');
    if (!c || !current) return;
    setBusy('start');
    try {
      const r: any = await apiRequest('/ev/me/shifts/start', {
        method: 'POST',
        body: JSON.stringify({ shift_id: current.shift_id, latitude: c.lat, longitude: c.lng, accuracy: c.accuracy }),
      });
      showToast('✅ Đã bắt đầu ca — hệ thống đang theo dõi GPS.');
      setCurrent(r);
      shiftRef.current = r;
      void load(true);
    } catch (e: any) { showToast(`⚠️ ${e?.message || 'Không bắt đầu được ca.'}`); }
    finally { setBusy(null); }
  };

  const endShift = async () => {
    const c = needCoords('kết thúc ca');
    if (!c || !current) return;
    if (!window.confirm('Kết thúc ca vận chuyển? Bạn phải ở điểm Xưởng (điểm cuối) mới đóng ca được.')) return;
    setBusy('end');
    try {
      const r: any = await apiRequest('/ev/me/shifts/end', {
        method: 'POST',
        body: JSON.stringify({ shift_id: current.shift_id, latitude: c.lat, longitude: c.lng, accuracy: c.accuracy }),
      });
      showToast('🏁 Đã kết thúc ca. Cảm ơn bạn!');
      await flushGps();
      setCurrent(r);
      shiftRef.current = r;
      setDetail(null);
      void load(true);
    } catch (e: any) { showToast(`⚠️ ${e?.message || 'Không kết thúc được ca.'}`); }
    finally { setBusy(null); }
  };

  const checkin = async (stop: any) => {
    const c = needCoords('bấm điểm');
    if (!c || !current) return;
    const d = haversine(c.lat, c.lng, Number(stop.latitude), Number(stop.longitude));
    if (d > Number(stop.geofence_radius_m || 100)) {
      showToast(`⛔ Bạn đang cách "${stop.name}" ${Math.round(d)}m (cho phép ≤${stop.geofence_radius_m}m).`);
      return;
    }
    setBusy(`ci_${stop.stop_id}`);
    try {
      await apiRequest('/ev/me/checkins', {
        method: 'POST',
        body: JSON.stringify({ shift_id: current.shift_id, stop_id: stop.stop_id, latitude: c.lat, longitude: c.lng, accuracy: c.accuracy }),
      });
      showToast(`✅ Đã xác nhận ${stop.name}`);
      await load(true);
    } catch (e: any) { showToast(`⚠️ ${e?.message || 'Xác nhận điểm thất bại.'}`); }
    finally { setBusy(null); }
  };

  const createTicket = async () => {
    if (!current) return;
    if (!ticketForm.date) return showToast('⚠️ Chọn ngày dự kiến sạc!');
    setBusy('ticket');
    try {
      const t: any = await apiRequest('/ev/me/charging-tickets', {
        method: 'POST',
        body: JSON.stringify({
          shift_id: current.shift_id,
          requested_date: ticketForm.date,
          battery_level_pct: ticketForm.battery ? Number(ticketForm.battery) : undefined,
          notes: ticketForm.notes || undefined,
        }),
      });
      showToast('🎫 Đã gửi phiếu sạc — chờ HR duyệt rồi Giám đốc duyệt.');
      setShowTicketForm(false);
      setTicketForm({ date: '', battery: '', notes: '' });
      setTickets((p) => [t, ...p]);
      void load(true);
    } catch (e: any) { showToast(`⚠️ ${e?.message || 'Tạo phiếu sạc thất bại.'}`); }
    finally { setBusy(null); }
  };

  const chargingAction = async (kind: 'start' | 'end', ticketId: string) => {
    if (kind === 'start') {
      const c = needCoords('bắt đầu sạc');
      if (!c) return;
      setBusy('cstart');
      try {
        await apiRequest('/ev/me/charging/start', {
          method: 'POST',
          body: JSON.stringify({ ticket_id: ticketId, latitude: c.lat, longitude: c.lng, accuracy: c.accuracy }),
        });
        showToast('🔌 Đã bắt đầu sạc — trạm được ghim theo GPS.');
        await load(true);
      } catch (e: any) { showToast(`⚠️ ${e?.message || 'Không bắt đầu sạc được.'}`); }
      finally { setBusy(null); }
      return;
    }
    setBusy('cend');
    try {
      await apiRequest('/ev/me/charging/end', { method: 'POST', body: JSON.stringify({ ticket_id: ticketId }) });
      showToast('🔋 Đã kết thúc sạc.');
      await load(true);
    } catch (e: any) { showToast(`⚠️ ${e?.message || 'Không kết thúc sạc được.'}`); }
    finally { setBusy(null); }
  };

  // ------------------------------------------------------------------
  // SLA countdown cho điểm kế tiếp
  // ------------------------------------------------------------------
  const stops: any[] = detail?.stops || [];
  const nextStop = useMemo(() => stops.find((s: any) => {
    if (s.isCompleted) return false;
    const lat = Number(s.latitude);
    const lng = Number(s.longitude);
    // Trạm sạc (tùy chọn) ghim toạ độ động, seed là (0,0) — không phải điểm giao cần đi tới.
    if (!s.is_mandatory && (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0))) return false;
    return true;
  }), [stops]);
  const slaLeftSec = useMemo(() => {
    if (!nextStop || !current) return null;
    // Mốc bắt đầu chặng = check-in điểm trước (hoặc giờ bắt đầu ca).
    const prevDone = stops.filter((s: any) => s.isCompleted && s.stop_order < nextStop.stop_order).pop();
    const baseIso = prevDone?.checkedInAt || current.actual_start_at || current.planned_start_at;
    const base = Date.parse(baseIso || '');
    if (!Number.isFinite(base)) return null;
    const deadline = base + Number(nextStop.sla_minutes || 0) * 60000;
    return Math.round((deadline - nowMs) / 1000);
  }, [stops, nextStop, current, nowMs]);

  const distToNext = coords && nextStop
    ? haversine(coords.lat, coords.lng, Number(nextStop.latitude), Number(nextStop.longitude))
    : null;

  const checkedCount = stops.filter((s: any) => s.isCompleted).length;
  const mandatoryLeft = stops.filter((s: any) => !s.isCompleted && s.is_mandatory).length;
  const lastTicket = tickets[0];
  // Phiếu đang sạc: backend chuyển APPROVED -> USED ngay khi bắt đầu sạc,
  // nên phải nhận cả 2 trạng thái để nút "Kết thúc sạc" không biến mất.
  const chargingTicket = tickets.find((t: any) => (t.status === 'APPROVED' || t.status === 'USED') && !t.charging_end_at);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  if (loading) {
    return (
      <div style={{ padding: '40px 16px', textAlign: 'center', color: MUTED, fontSize: '13px', fontWeight: 700 }}>
        ⏳ Đang tải ca vận chuyển...
      </div>
    );
  }

  if (err && !current) {
    return (
      <div style={{ padding: '16px' }}>
        <div style={{ backgroundColor: DANGER_SOFT, border: `1.5px solid ${DANGER}`, borderRadius: '10px', padding: '14px', fontSize: '12.5px', color: DANGER, fontWeight: 700 }}>
          ⚠️ {err}
        </div>
        <button className="btn-secondary" style={{ marginTop: '10px' }} onClick={() => void load()}>
          <RefreshCw size={14} /> Thử lại
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '640px' }}>
      {/* ---------- Banner BETA ---------- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', backgroundColor: '#FFFBEB', border: '1.5px solid #FDE68A', borderRadius: '10px', fontSize: '11.5px', color: '#92400E', fontWeight: 700 }}>
        <Truck size={16} />
        Vận chuyển sữa — quản lý tài xế & định vị GPS
        <span style={{ marginLeft: 'auto', fontSize: '9px', fontWeight: 800, padding: '2px 7px', borderRadius: '999px', backgroundColor: '#FDE68A', color: '#92400E', letterSpacing: '0.5px' }}>BETA</span>
      </div>

      {/* ---------- Chỉ số GPS ---------- */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 140px', backgroundColor: gpsErr ? DANGER_SOFT : BRAND_SOFT, border: `1.5px solid ${gpsErr ? '#FECACA' : '#99F6E4'}`, borderRadius: '10px', padding: '9px 11px' }}>
          <div style={{ fontSize: '10.5px', fontWeight: 800, color: gpsErr ? DANGER : BRAND, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Vị trí GPS</div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: gpsErr ? DANGER : '#0F172A', marginTop: '3px' }}>
            {gpsErr ? gpsErr : coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : 'Đang tìm satellites...'}
          </div>
          {coords && !gpsErr && (
            <div style={{ fontSize: '11px', color: MUTED, marginTop: '2px', fontWeight: 600 }}>
              Sai số ±{coords.accuracy}m{coords.speed != null && coords.speed >= 0 ? ` • ${Math.round(coords.speed * 3.6)} km/h` : ''}
            </div>
          )}
        </div>
        <div style={{ flex: '0 1 130px', backgroundColor: BG, border: `1.5px solid ${BORDER}`, borderRadius: '10px', padding: '9px 11px' }}>
          <div style={{ fontSize: '10.5px', fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.4px' }}>GPS đã gửi</div>
          <div style={{ fontSize: '17px', fontWeight: 900, color: '#0F172A', marginTop: '2px' }}>{gpsSent}</div>
          <div style={{ fontSize: '10.5px', color: MUTED, fontWeight: 600 }}>điểm trong phiên này</div>
        </div>
      </div>

      {/* ---------- Ca hiện tại ---------- */}
      {!current && (
        <div style={{ backgroundColor: '#FFF', border: `1.5px solid ${BORDER}`, borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
          <MapPin size={28} color={MUTED} style={{ margin: '0 auto 8px' }} />
          <div style={{ fontSize: '14px', fontWeight: 800, color: '#0F172A' }}>Hôm nay bạn không có ca vận chuyển</div>
          <div style={{ fontSize: '12px', color: MUTED, marginTop: '5px', lineHeight: 1.6 }}>
            Ca mới do Quản lý vận chuyển phân công sẽ tự xuất hiện ở đây.
          </div>
          <button className="btn-secondary" style={{ marginTop: '12px' }} onClick={() => void load()}>
            <RefreshCw size={14} /> Kiểm tra lại
          </button>
          {todayShifts.length > 0 && (
            <div style={{ marginTop: '14px', textAlign: 'left' }}>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#0F172A', marginBottom: '6px' }}>Các ca gần đây</div>
              {todayShifts.slice(0, 5).map((s: any) => {
                const st = STATUS_LABEL[s.status] || STATUS_LABEL.SCHEDULED;
                return (
                  <div key={s.shift_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', border: `1px solid ${BORDER}`, borderRadius: '8px', marginBottom: '6px', fontSize: '12px' }}>
                    <span style={{ fontWeight: 700 }}>{s.shift_date} • {fmtTime(s.planned_start_at)}</span>
                    <span style={{ fontSize: '10.5px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px', color: st.fg, backgroundColor: st.bg }}>{st.text}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {current && (
        <div style={{ backgroundColor: '#FFF', border: `1.5px solid ${BORDER}`, borderRadius: '12px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 900, color: '#0F172A' }}>{detail?.routeName || 'Lộ trình giao sữa'}</div>
              <div style={{ fontSize: '11.5px', color: MUTED, fontWeight: 600, marginTop: '3px' }}>
                🚐 {detail?.vehiclePlate || '—'} • Ca {String(current.shift_date || '').split('-').reverse().join('/')} • {fmtTime(current.planned_start_at)}
              </div>
              {current.product_name && (
                <div style={{ marginTop: '5px' }}>
                  <span style={{ fontSize: '10.5px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px', backgroundColor: '#FFF7ED', color: '#7C2D12' }}>
                    🧃 Sản phẩm: {current.product_name}
                  </span>
                </div>
              )}
            </div>
            {(() => {
              const st = STATUS_LABEL[status] || STATUS_LABEL.SCHEDULED;
              return <span style={{ flexShrink: 0, fontSize: '10.5px', fontWeight: 800, padding: '4px 10px', borderRadius: '999px', color: st.fg, backgroundColor: st.bg }}>{st.text}</span>;
            })()}
          </div>

          {/* Tiến độ + SLA */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 110px', backgroundColor: BG, border: `1px solid ${BORDER}`, borderRadius: '8px', padding: '8px 10px' }}>
              <div style={{ fontSize: '10.5px', fontWeight: 800, color: MUTED }}>ĐIỂM ĐÃ XÁC NHẬN</div>
              <div style={{ fontSize: '16px', fontWeight: 900, color: '#0F172A' }}>{checkedCount}/{stops.length}</div>
            </div>
            <div style={{ flex: '1 1 110px', backgroundColor: mandatoryLeft > 0 && isRunning ? WARN_SOFT : BG, border: `1px solid ${mandatoryLeft > 0 && isRunning ? '#FDE68A' : BORDER}`, borderRadius: '8px', padding: '8px 10px' }}>
              <div style={{ fontSize: '10.5px', fontWeight: 800, color: mandatoryLeft > 0 && isRunning ? WARN : MUTED }}>CÒN LẠI (BẮT BUỘC)</div>
              <div style={{ fontSize: '16px', fontWeight: 900, color: mandatoryLeft > 0 && isRunning ? WARN : '#0F172A' }}>{mandatoryLeft}</div>
            </div>
            {slaLeftSec != null && isRunning && (
              <div style={{ flex: '1 1 120px', backgroundColor: slaLeftSec < 0 ? DANGER_SOFT : slaLeftSec < 600 ? WARN_SOFT : '#EFF6FF', border: `1px solid ${slaLeftSec < 0 ? '#FECACA' : slaLeftSec < 600 ? '#FDE68A' : '#BFDBFE'}`, borderRadius: '8px', padding: '8px 10px' }}>
                <div style={{ fontSize: '10.5px', fontWeight: 800, color: slaLeftSec < 0 ? DANGER : slaLeftSec < 600 ? WARN : '#1D4ED8' }}>SLA CHẶNG TIẾP</div>
                <div style={{ fontSize: '16px', fontWeight: 900, color: slaLeftSec < 0 ? DANGER : slaLeftSec < 600 ? WARN : '#1D4ED8', fontVariantNumeric: 'tabular-nums' }}>
                  {slaLeftSec < 0 ? `+${fmtClock(-slaLeftSec)}` : fmtClock(slaLeftSec)}
                </div>
              </div>
            )}
          </div>

          {/* Nút điều khiển ca */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {current.status === 'SCHEDULED' && (
              <button className="btn-primary" disabled={busy === 'start'} onClick={startShift}
                style={{ flex: 1, backgroundColor: BRAND, padding: '12px', fontSize: '14px', fontWeight: 800 }}>
                <Play size={16} /> {busy === 'start' ? 'Đang bắt đầu...' : 'BẮT ĐẦU CA'}
              </button>
            )}
            {isRunning && (
              <button className="btn-secondary" disabled={busy === 'end'} onClick={endShift}
                style={{ flex: 1, padding: '12px', fontSize: '14px', fontWeight: 800, color: DANGER, borderColor: '#FECACA' }}>
                <Square size={15} /> {busy === 'end' ? 'Đang kết thúc...' : 'KẾT THÚC CA'}
              </button>
            )}
            {current.status === 'COMPLETED' && (
              <div style={{ flex: 1, textAlign: 'center', padding: '12px', backgroundColor: '#ECFDF5', border: `1.5px solid #A7F3D0`, borderRadius: '8px', fontSize: '13px', fontWeight: 800, color: SUCCESS }}>
                ✅ Ca đã hoàn thành
              </div>
            )}
          </div>

          {/* Gợi ý khoảng cách tới điểm kế tiếp */}
          {isRunning && nextStop && distToNext != null && (
            <div style={{ fontSize: '12px', fontWeight: 700, color: distToNext <= Number(nextStop.geofence_radius_m || 100) ? SUCCESS : MUTED, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Navigation size={14} />
              Điểm kế tiếp: <strong>{nextStop.name}</strong> — còn {Math.round(distToNext)}m
              {distToNext <= Number(nextStop.geofence_radius_m || 100) ? ' (trong bán kính — bấm xác nhận được)' : ''}
            </div>
          )}
        </div>
      )}

      {/* ---------- Danh sách điểm dừng ---------- */}
      {current && stops.length > 0 && (
        <div style={{ backgroundColor: '#FFF', border: `1.5px solid ${BORDER}`, borderRadius: '12px', padding: '14px' }}>
          <div style={{ fontSize: '13px', fontWeight: 900, color: '#0F172A', marginBottom: '10px' }}>
            Điểm giao trên lộ trình
            {stops.some((s: any) => s.change_request_id) && (
              <span style={{ marginLeft: '8px', fontSize: '10px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px', backgroundColor: '#F5F3FF', color: '#7C3AED' }}>
                LỘ TRÌNH ĐÃ ĐIỀU CHỈNH
              </span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {stops.map((s: any) => {
              const done = !!s.isCompleted;
              const isNext = nextStop?.stop_id === s.stop_id;
              const d = coords ? haversine(coords.lat, coords.lng, Number(s.latitude), Number(s.longitude)) : null;
              const within = d != null && d <= Number(s.geofence_radius_m || 100);
              const canCheck = isRunning && !done && within && !!coords && coords.accuracy <= 30;
              return (
                <div key={s.stop_id} style={{
                  border: `1.5px solid ${done ? '#A7F3D0' : isNext ? '#99F6E4' : BORDER}`,
                  backgroundColor: done ? '#F0FDF4' : isNext ? BRAND_SOFT : '#FFF',
                  borderRadius: '10px', padding: '10px 12px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                    <span style={{ flexShrink: 0, width: '22px', height: '22px', borderRadius: '999px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 900, backgroundColor: done ? SUCCESS : isNext ? BRAND : '#E2E8F0', color: done || isNext ? '#FFF' : MUTED }}>
                      {done ? <CheckCircle2 size={13} /> : s.stop_order}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#0F172A', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        {s.name}
                        {!s.is_mandatory && <span style={{ fontSize: '9.5px', fontWeight: 800, padding: '1px 6px', borderRadius: '999px', backgroundColor: '#F1F5F9', color: MUTED }}>TÙY CHỌN</span>}
                        {s.stop_type === 'CHARGING' && <span style={{ fontSize: '9.5px', fontWeight: 800, padding: '1px 6px', borderRadius: '999px', backgroundColor: '#F5F3FF', color: '#7C3AED' }}>TRẠM SẠC</span>}
                      </div>
                      <div style={{ fontSize: '11px', color: MUTED, fontWeight: 600, marginTop: '2px' }}>
                        {s.address || ''} {s.address ? '•' : ''} SLA {fmtMin(Number(s.sla_minutes || 0))} • bán kính {s.geofence_radius_m}m
                      </div>
                      {done && (
                        <div style={{ fontSize: '11px', color: SUCCESS, fontWeight: 700, marginTop: '3px' }}>
                          ✅ {fmtTime(s.checkedInAt)}
                          {s.isLate ? ` • TRỄ ${s.lateMinutes} phút` : ''}
                          {Number(s.penaltyAmount) > 0 ? ` • phạt ${Number(s.penaltyAmount).toLocaleString('vi-VN')}đ` : ''}
                        </div>
                      )}
                    </div>
                    {done ? <Circle size={0} style={{ display: 'none' }} /> : (
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        {d != null && (
                          <div style={{ fontSize: '11.5px', fontWeight: 800, color: within ? SUCCESS : MUTED, fontVariantNumeric: 'tabular-nums' }}>
                            {Math.round(d)}m
                          </div>
                        )}
                        {isRunning && (
                          <button
                            disabled={!canCheck || busy === `ci_${s.stop_id}`}
                            onClick={() => void checkin(s)}
                            style={{
                              marginTop: '5px', padding: '7px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 800,
                              cursor: canCheck ? 'pointer' : 'not-allowed',
                              backgroundColor: canCheck ? BRAND : '#F1F5F9',
                              color: canCheck ? '#FFF' : MUTED,
                              border: 'none', opacity: canCheck ? 1 : 0.75,
                            }}
                            title={within ? 'Xác nhận bạn đang ở điểm này' : 'Cần đứng trong bán kính điểm để xác nhận'}
                          >
                            {busy === `ci_${s.stop_id}` ? '...' : isNext ? 'XÁC NHẬN' : 'Bấm điểm'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ---------- Phiếu sạc ---------- */}
      <div style={{ backgroundColor: '#FFF', border: `1.5px solid ${BORDER}`, borderRadius: '12px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <BatteryCharging size={17} color="#7C3AED" />
          <div style={{ fontSize: '13px', fontWeight: 900, color: '#0F172A' }}>Phiếu sạc xe điện</div>
          <button className="btn-secondary" style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: '12px', fontWeight: 700 }}
            onClick={() => setShowTicketForm(v => !v)}>
            {showTicketForm ? <><ChevronUp size={14} /> Đóng</> : <><ChevronDown size={14} /> Tạo phiếu</>}
          </button>
        </div>

        {showTicketForm && (
          <div style={{ backgroundColor: BG, border: `1px solid ${BORDER}`, borderRadius: '10px', padding: '11px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '11.5px', fontWeight: 700, color: MUTED, lineHeight: 1.6 }}>
              Chỉ tạo được sau khi đã xác nhận điểm Văn phòng. Phiếu cần <strong>HR duyệt → Giám đốc duyệt</strong> rồi mới sạc được.
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <label style={{ flex: '1 1 130px', fontSize: '11.5px', fontWeight: 700 }}>
                Ngày dự kiến sạc *
                <input type="date" value={ticketForm.date} onChange={e => setTicketForm(f => ({ ...f, date: e.target.value }))}
                  style={{ width: '100%', marginTop: '3px', padding: '8px 9px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${BORDER}` }} />
              </label>
              <label style={{ flex: '1 1 100px', fontSize: '11.5px', fontWeight: 700 }}>
                Pin lúc tạo (%)
                <input type="number" min={0} max={100} value={ticketForm.battery} placeholder="VD: 25"
                  onChange={e => setTicketForm(f => ({ ...f, battery: e.target.value }))}
                  style={{ width: '100%', marginTop: '3px', padding: '8px 9px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${BORDER}` }} />
              </label>
            </div>
            <input type="text" value={ticketForm.notes} placeholder="Ghi chú (không bắt buộc)"
              onChange={e => setTicketForm(f => ({ ...f, notes: e.target.value }))}
              style={{ padding: '8px 10px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${BORDER}` }} />
            <button className="btn-primary" disabled={busy === 'ticket'} onClick={createTicket}
              style={{ backgroundColor: '#7C3AED', padding: '10px', fontSize: '13px', fontWeight: 800 }}>
              {busy === 'ticket' ? 'Đang gửi...' : 'Gửi phiếu sạc'}
            </button>
          </div>
        )}

        {chargingTicket && (
          <div style={{ border: '1.5px solid #C4B5FD', backgroundColor: '#F5F3FF', borderRadius: '10px', padding: '11px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
            <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#5B21B6' }}>
              🔌 Phiếu đã duyệt — sạc được trong ngày {String(chargingTicket.requested_date || '').split('-').reverse().join('/')}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {!chargingTicket.charging_start_at ? (
                <button className="btn-primary" disabled={busy === 'cstart'} onClick={() => chargingAction('start', chargingTicket.ticket_id)}
                  style={{ flex: 1, backgroundColor: '#7C3AED', padding: '10px', fontSize: '13px', fontWeight: 800 }}>
                  Bắt đầu sạc
                </button>
              ) : (
                <button className="btn-secondary" disabled={busy === 'cend'} onClick={() => chargingAction('end', chargingTicket.ticket_id)}
                  style={{ flex: 1, padding: '10px', fontSize: '13px', fontWeight: 800 }}>
                  Kết thúc sạc {chargingTicket.charging_start_at ? `(${fmtTime(chargingTicket.charging_start_at)}–${chargingTicket.charging_end_at ? fmtTime(chargingTicket.charging_end_at) : '...'})` : ''}
                </button>
              )}
            </div>
          </div>
        )}

        {tickets.length === 0 && !showTicketForm && (
          <div style={{ fontSize: '12px', color: MUTED, fontWeight: 600 }}>Chưa có phiếu sạc nào.</div>
        )}

        {tickets.slice(0, 6).map((t: any) => {
          const st = TICKET_STATUS[t.status] || TICKET_STATUS.DRAFT;
          return (
            <div key={t.ticket_id} style={{ display: 'flex', alignItems: 'center', gap: '8px', border: `1px solid ${BORDER}`, borderRadius: '9px', padding: '9px 11px', fontSize: '12px' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 800, color: '#0F172A' }}>Ngày {String(t.requested_date || '').split('-').reverse().join('/')}
                  {t.battery_level_pct != null ? ` • pin ${t.battery_level_pct}%` : ''}</div>
                {t.hr_approved_at && <div style={{ color: MUTED, fontSize: '11px', marginTop: '2px' }}>HR duyệt {fmtTime(t.hr_approved_at)}{t.director_approved_at ? ` • GĐ duyệt ${fmtTime(t.director_approved_at)}` : ''}</div>}
                {t.charging_start_at && <div style={{ color: '#7C3AED', fontSize: '11px', marginTop: '2px', fontWeight: 700 }}>Sạc {fmtTime(t.charging_start_at)}{t.charging_end_at ? `–${fmtTime(t.charging_end_at)}` : '...'} {t.charging_station_name ? `• ${t.charging_station_name}` : ''}</div>}
                {t.status === 'REJECTED' && (t.hr_notes || t.director_notes) && (
                  <div style={{ color: DANGER, fontSize: '11px', marginTop: '2px' }}>Lý do: {t.hr_notes || t.director_notes}</div>
                )}
              </div>
              <span style={{ flexShrink: 0, fontSize: '10px', fontWeight: 800, padding: '3px 8px', borderRadius: '999px', color: st.fg, backgroundColor: st.bg }}>{st.text}</span>
            </div>
          );
        })}
      </div>

      {/* ---------- Lương tài xế ---------- */}
      <div style={{ backgroundColor: '#FFF', border: `1.5px solid ${BORDER}`, borderRadius: '12px', padding: '14px' }}>
        <button onClick={() => { setShowPayroll(v => !v); if (!showPayroll) void loadPayroll(); }}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <Clock size={17} color={BRAND} />
          <span style={{ fontSize: '13px', fontWeight: 900, color: '#0F172A', flex: 1, textAlign: 'left' }}>Bảng lương tài xế</span>
          {showPayroll ? <ChevronUp size={16} color={MUTED} /> : <ChevronDown size={16} color={MUTED} />}
        </button>
        {showPayroll && (
          <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
            {payroll.length === 0 && <div style={{ fontSize: '12px', color: MUTED, fontWeight: 600 }}>Chưa có bảng lương kỳ nào được phát hành.</div>}
            {payroll.slice(0, 6).map((p: any) => (
              <div key={p.payroll_id} style={{ border: `1px solid ${BORDER}`, borderRadius: '9px', padding: '10px 11px', fontSize: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, color: '#0F172A' }}>
                  <span>Kỳ {String(p.period || '').replace('-', '/')}</span>
                  <span>{Number(p.net_pay || 0).toLocaleString('vi-VN')}đ</span>
                </div>
                <div style={{ color: MUTED, fontSize: '11px', marginTop: '4px' }}>
                  {p.total_shifts} ca • {p.total_work_days} ngày công
                  {Number(p.total_penalty_amount) > 0 ? ` • phạt ${Number(p.total_penalty_amount).toLocaleString('vi-VN')}đ (${p.total_penalty_points} điểm)` : ' • không phạt'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------- Quy tắc ---------- */}
      <div style={{ backgroundColor: '#FFFBEB', border: '1.5px solid #FDE68A', borderRadius: '10px', padding: '11px 13px', fontSize: '11.5px', color: '#92400E', lineHeight: 1.7, fontWeight: 600 }}>
        <div style={{ fontWeight: 900, marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <AlertTriangle size={13} /> Quy tắc ca vận chuyển
        </div>
        • Bấm điểm khi đứng <strong>≤100m</strong> so với điểm giao, sai số GPS ≤30m.<br />
        • Mỗi chặng có SLA riêng — trễ <strong>1 điểm phạt/điểm</strong> (trừ vào lương).<br />
        • Quên bấm điểm bắt buộc = <strong>điểm bỏ lọt</strong>, bị tính phạt khi kết thúc ca.<br />
        • Sạc xe: tạo phiếu → HR duyệt → Giám đốc duyệt → sạc đúng ngày đăng ký.
      </div>
    </div>
  );
}
