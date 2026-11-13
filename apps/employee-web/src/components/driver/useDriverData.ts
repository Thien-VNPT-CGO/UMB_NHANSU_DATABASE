/**
 * useDriverData — toàn bộ dữ liệu + hành động của APP TÀI XẾ.
 *
 * Gộp 1 lần gọi /ev/me/profile (hồ sơ, xe, ca hiện tại, thống kê tháng, lương
 * tạm tính) + chi tiết ca + phiếu sạc. GPS dùng watchPosition và gửi batch 15s
 * đúng như tab vận chuyển cũ, nhưng tách khỏi khung tab HR.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../../services/api';
import { haversine, type Coords } from './driver-shared';

const NO_CACHE = { _noCache: true } as any;

export function useDriverData(showToast: (msg: string) => void, refreshKey = 0, initialProfile: any = null) {
  const [loading, setLoading] = useState(!initialProfile);
  const [err, setErr] = useState('');
  const [profile, setProfile] = useState<any>(initialProfile || null);
  const [current, setCurrent] = useState<any>(null);
  const [todayShifts, setTodayShifts] = useState<any[]>([]);
  const [weekShifts, setWeekShifts] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [tickets, setTickets] = useState<any[]>([]);
  const [payroll, setPayroll] = useState<any[]>([]);
  const [history, setHistory] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [gpsErr, setGpsErr] = useState('');
  const [gpsSent, setGpsSent] = useState(0);
  const [nowMs, setNowMs] = useState(Date.now());

  const watchIdRef = useRef<number | null>(null);
  const firstLoadRef = useRef(true);
  const coordsRef = useRef<Coords | null>(null);
  const bufferRef = useRef<any[]>([]);
  const shiftRef = useRef<any>(null);
  const sendingRef = useRef(false);

  const status = String(current?.status || '');
  const isRunning = ['IN_PROGRESS', 'CHARGING', 'RETURNING', 'PAUSED'].includes(status);
  // Xe đã gán cho tài xế → mở app là chia sẻ vị trí (không cần bắt đầu ca),
  // để Quản lý vận chuyển / HR / Kế toán / Giám đốc thấy xe trên Live Map.
  const canTrack = !!profile?.vehicle?.vehicle_id;

  // ------------------------------------------------------------------
  // Tải dữ liệu
  // ------------------------------------------------------------------
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const p: any = await apiRequest('/ev/me/profile', NO_CACHE);
      setProfile(p || null);
      const cur = p?.current_shift || null;
      setCurrent(cur);
      shiftRef.current = cur;
      setTodayShifts(Array.isArray(p?.today_shifts) ? p.today_shifts : []);
      setWeekShifts(Array.isArray(p?.week_shifts) ? p.week_shifts : []);

      if (cur) {
        const det: any = await apiRequest(`/ev/me/shifts/${cur.shift_id}`, NO_CACHE).catch(() => null);
        setDetail(det);
      } else {
        setDetail(null);
      }

      const tks: any = await apiRequest('/ev/me/charging-tickets', NO_CACHE).catch(() => []);
      setTickets(Array.isArray(tks) ? tks : []);

      const pay: any = await apiRequest('/ev/me/payroll', NO_CACHE).catch(() => []);
      setPayroll(Array.isArray(pay) ? pay : pay ? [pay] : []);

      setErr('');
    } catch (e: any) {
      if (!silent) setErr(e?.message || 'Không tải được dữ liệu tài xế.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Lần đầu đã có hồ sơ tải sẵn ở App → tải ngầm, không nháy màn hình chờ.
    const silent = firstLoadRef.current && !!initialProfile;
    firstLoadRef.current = false;
    void load(silent);
  }, [load, refreshKey, initialProfile]);

  // Ca đang chạy hoặc còn phiếu chờ duyệt → tự làm mới (HR/GĐ duyệt xong thấy ngay).
  useEffect(() => {
    const hasPending = tickets.some((t: any) => t.status === 'PENDING_HR' || t.status === 'PENDING_DIRECTOR');
    const every = isRunning || hasPending ? 30_000 : 90_000;
    const timer = setInterval(() => { void load(true); }, every);
    return () => clearInterval(timer);
  }, [tickets, isRunning, load]);

  // Đồng hồ SLA 1s/lần khi ca đang chạy.
  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isRunning]);

  const loadHistory = useCallback(async (force = false) => {
    if (history && !force) return history;
    try {
      const h: any = await apiRequest('/ev/me/history', NO_CACHE).catch(() => []);
      const list = Array.isArray(h) ? h : [];
      setHistory(list);
      return list;
    } catch {
      setHistory([]);
      return [];
    }
  }, [history]);

  // ------------------------------------------------------------------
  // GPS: watchPosition + gửi batch 15s khi ca đang chạy
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
    if (sendingRef.current || !bufferRef.current.length) return;
    const points = bufferRef.current.splice(0, bufferRef.current.length);
    sendingRef.current = true;
    try {
      const r: any = await apiRequest('/ev/me/gps', {
        method: 'POST',
        body: JSON.stringify({ points }),
      });
      setGpsSent((n) => n + Number(r?.saved || 0));
    } catch {
      bufferRef.current.unshift(...points);
      if (bufferRef.current.length > 300) bufferRef.current.splice(0, bufferRef.current.length - 300);
    } finally {
      sendingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!canTrack) return;
    const t = setInterval(() => { void flushGps(); }, 15000);
    return () => clearInterval(t);
  }, [canTrack, flushGps]);

  useEffect(() => {
    if (!canTrack || !coords) return;
    const last = bufferRef.current[bufferRef.current.length - 1];
    if (last && Date.now() - last._at < 5000) return;
    const shift = shiftRef.current;
    const running = !!shift && ['IN_PROGRESS', 'CHARGING', 'RETURNING'].includes(String(shift.status || ''));
    bufferRef.current.push({
      // Chỉ gắn ca khi ca đang chạy — ngoài ca vẫn gửi vị trí nhưng không
      // làm sai lịch sử/quãng đường của ca.
      shift_id: running ? shift.shift_id : undefined,
      recorded_at: new Date().toISOString(),
      latitude: coords.lat,
      longitude: coords.lng,
      accuracy: coords.accuracy,
      speed: coords.speed ?? undefined,
      heading: coords.heading ?? undefined,
      is_mock: false,
      _at: Date.now(),
    });
  }, [coords, canTrack]);

  useEffect(() => () => { void flushGps(); }, [flushGps]);

  // ------------------------------------------------------------------
  // Hành động
  // ------------------------------------------------------------------
  const needCoords = (label: string, maxAccuracy = 30): Coords | null => {
    const c = coordsRef.current;
    if (!c) { showToast(`⚠️ Chưa có vị trí GPS — ${label} cần định vị. Chờ vài giây rồi thử lại.`); return null; }
    if (c.accuracy > maxAccuracy) {
      showToast(`⚠️ Sai số GPS ±${c.accuracy}m (yêu cầu ≤${maxAccuracy}m) — ra chỗ thoáng chờ GPS cập nhật.`);
      return null;
    }
    return c;
  };

  const startShift = async () => {
    // Bắt đầu/kết thúc ca dùng sai số rộng hơn điểm giao (GPS trong cabin).
    const c = needCoords('bắt đầu ca', 120);
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
    const c = needCoords('kết thúc ca', 120);
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
      setHistory(null);
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

  const createTicket = async (input: { date: string; battery?: string; notes?: string }): Promise<boolean> => {
    // Phiếu sạc chỉ cần gắn vào ca gần nhất của tài xế (hôm nay hoặc ca sắp tới)
    // — không phụ thuộc tiến độ giao hàng.
    const anchor = current || weekShifts[0] || todayShifts[0] || null;
    if (!anchor) { showToast('⚠️ Bạn chưa có ca vận chuyển nào để gắn phiếu sạc.'); return false; }
    if (!input.date) { showToast('⚠️ Chọn ngày dự kiến sạc!'); return false; }
    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    if (input.date < today) { showToast('⚠️ Ngày dự kiến sạc đã qua — chọn hôm nay hoặc ngày tới.'); return false; }
    setBusy('ticket');
    try {
      const t: any = await apiRequest('/ev/me/charging-tickets', {
        method: 'POST',
        body: JSON.stringify({
          shift_id: anchor.shift_id,
          requested_date: input.date,
          battery_level_pct: input.battery ? Number(input.battery) : undefined,
          notes: input.notes || undefined,
        }),
      });
      showToast('🎫 Đã gửi phiếu sạc — chờ Giám đốc hoặc Kế toán duyệt.');
      setTickets((p) => [t, ...p]);
      void load(true);
      return true;
    } catch (e: any) {
      showToast(`⚠️ ${e?.message || 'Tạo phiếu sạc thất bại.'}`);
      return false;
    } finally { setBusy(null); }
  };

  const chargingAction = async (kind: 'start' | 'end', ticketId: string) => {
    if (kind === 'start') {
      const c = needCoords('bắt đầu sạc', 120);
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
  // Dữ liệu dẫn xuất
  // ------------------------------------------------------------------
  const stops: any[] = detail?.stops || [];
  const nextStop = useMemo(() => stops.find((s: any) => {
    if (s.isCompleted) return false;
    const lat = Number(s.latitude);
    const lng = Number(s.longitude);
    // Trạm sạc tùy chọn ghim toạ độ động, seed (0,0) → không phải điểm cần đi tới.
    if (!s.is_mandatory && (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0))) return false;
    return true;
  }), [stops]);

  const slaLeftSec = useMemo(() => {
    if (!nextStop || !current) return null;
    const prevDone = stops.filter((s: any) => s.isCompleted && s.stop_order < nextStop.stop_order).pop();
    const baseIso = prevDone?.checkedInAt || current.actual_start_at || current.planned_start_at;
    const base = Date.parse(baseIso || '');
    if (!Number.isFinite(base)) return null;
    return Math.round((base + Number(nextStop.sla_minutes || 0) * 60000 - nowMs) / 1000);
  }, [stops, nextStop, current, nowMs]);

  const distToNext = coords && nextStop
    ? haversine(coords.lat, coords.lng, Number(nextStop.latitude), Number(nextStop.longitude))
    : null;

  // Khoảng cách tới điểm xuất phát (Xưởng) — hiện ngay dưới nút "Bắt đầu ca"
  // để tài xế biết vì sao chưa bấm được.
  const startStop = stops[0] || null;
  const startRadius = Math.max(Number(startStop?.geofence_radius_m || 100), 500);
  const distToStart = coords && startStop
    ? haversine(coords.lat, coords.lng, Number(startStop.latitude), Number(startStop.longitude))
    : null;

  const checkedCount = stops.filter((s: any) => s.isCompleted).length;
  const mandatoryLeft = stops.filter((s: any) => !s.isCompleted && s.is_mandatory).length;
  const chargingTicket = tickets.find((t: any) => (t.status === 'APPROVED' || t.status === 'USED') && !t.charging_end_at);

  return {
    loading, err, profile, current, todayShifts, weekShifts, detail, tickets, payroll, history,
    busy, coords, gpsErr, gpsSent, nowMs,
    status, isRunning, canTrack, stops, nextStop, slaLeftSec, distToNext, startStop, startRadius, distToStart,
    checkedCount, mandatoryLeft, chargingTicket,
    reload: load, loadHistory,
    startShift, endShift, checkin, createTicket, chargingAction,
  };
}

export type DriverData = ReturnType<typeof useDriverData>;
