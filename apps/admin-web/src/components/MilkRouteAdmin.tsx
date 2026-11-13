/**
 * MilkRouteAdminView — Cổng quản trị MilkRoute EV (nhãn BETA).
 *
 * 5 màn hình theo spec Markdown/VAN_CHUYEN_SUA_UMBOMILK.md:
 *   1. Live Map    — Leaflet + GPS realtime (poll /ev/admin/live/* 10s).
 *   2. Xe & Lộ trình — CRUD xe điện, xem lộ trình + điểm dừng/geofence/SLA.
 *   3. Ca vận chuyển — tạo/sắp xếp ca tài xế, xem tiến độ check-in, hủy ca.
 *   4. Phiếu sạc   — duyệt 2 cấp: HR (cấp 1) → Giám đốc (cấp 2).
 *   5. Lương tài xế — sinh bảng lương theo kỳ (28 ngày chuẩn + 2 ngày cuối).
 *
 * Mọi call đi qua apiRequest (tự refresh token, tự đánh thức backend).
 * Phân quyền bám đúng backend: EV_ADMIN_ROLES = ADMIN/HR/DIRECTOR/FLEET_MANAGER/FINANCE.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as LeafletModule from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { apiRequest } from '../services/api';
import {
  Truck,
  MapPin,
  Route as RouteIcon,
  BatteryCharging,
  CalendarClock,
  Wallet,
  RefreshCw,
  Plus,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Gauge,
  Navigation,
} from 'lucide-react';

/** Leaflet là UMD/CJS: namespace import có thể là default hoặc named tùy bundler. */
const L = ((LeafletModule as any).default ?? LeafletModule) as typeof LeafletModule;

export interface MilkRouteAdminProps {
  currentUser: any;
  allEmployees?: any[];
  showToast?: (msg: string) => void;
}

type SubTab = 'map' | 'fleet' | 'shifts' | 'charging' | 'payroll';

const MUTED = '#64748B';
const BORDER = '#E2E8F0';
const BG = '#F8FAFC';
const BRAND = '#1D4ED8';

const SHIFT_STATUS: Record<string, { text: string; fg: string; bg: string }> = {
  SCHEDULED: { text: 'Chờ chạy', fg: '#1D4ED8', bg: '#EFF6FF' },
  IN_PROGRESS: { text: 'Đang chạy', fg: '#047857', bg: '#ECFDF5' },
  CHARGING: { text: 'Đang sạc', fg: '#6D28D9', bg: '#F5F3FF' },
  RETURNING: { text: 'Về xưởng', fg: '#0369A1', bg: '#F0F9FF' },
  PAUSED: { text: 'Tạm dừng', fg: '#B45309', bg: '#FEF3C7' },
  COMPLETED: { text: 'Hoàn thành', fg: '#475569', bg: '#F1F5F9' },
  CANCELLED: { text: 'Đã hủy', fg: '#B91C1C', bg: '#FEF2F2' },
};

const TICKET_STATUS: Record<string, { text: string; fg: string; bg: string }> = {
  DRAFT: { text: 'Nháp', fg: '#475569', bg: '#F1F5F9' },
  PENDING_HR: { text: 'Chờ HR duyệt', fg: '#B45309', bg: '#FEF3C7' },
  PENDING_DIRECTOR: { text: 'Chờ Giám đốc', fg: '#1D4ED8', bg: '#EFF6FF' },
  APPROVED: { text: 'Đã duyệt', fg: '#047857', bg: '#ECFDF5' },
  REJECTED: { text: 'Từ chối', fg: '#B91C1C', bg: '#FEF2F2' },
  USED: { text: 'Đã dùng sạc', fg: '#6D28D9', bg: '#F5F3FF' },
  EXPIRED: { text: 'Hết hạn', fg: '#64748B', bg: '#F1F5F9' },
};

const VEHICLE_STATUS: Record<string, { text: string; fg: string; bg: string }> = {
  ACTIVE: { text: 'Hoạt động', fg: '#047857', bg: '#ECFDF5' },
  MAINTENANCE: { text: 'Bảo trì', fg: '#B45309', bg: '#FEF3C7' },
  RETIRED: { text: 'Ngừng hoạt động', fg: '#B91C1C', bg: '#FEF2F2' },
};

const PAY_STATUS: Record<string, { text: string; fg: string; bg: string }> = {
  DRAFT: { text: 'Nháp', fg: '#B45309', bg: '#FEF3C7' },
  APPROVED: { text: 'Đã duyệt', fg: '#047857', bg: '#ECFDF5' },
  PAID: { text: 'Đã trả', fg: '#1D4ED8', bg: '#EFF6FF' },
};

const fmtMoney = (n: number) => Math.round(Number(n) || 0).toLocaleString('vi-VN') + 'đ';
const fmtTime = (iso?: string) => {
  if (!iso) return '—';
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—';
};
const fmtDay = (iso?: string) => {
  if (!iso) return '—';
  const t = Date.parse(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('vi-VN') : '—';
};
const agoLabel = (iso?: string, now = Date.now()) => {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s} giây trước`;
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  return `${Math.floor(s / 3600)} giờ trước`;
};
const pad2 = (n: number) => String(Math.max(0, n)).padStart(2, '0');
const fmtCountdown = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  return h > 0 ? `${h}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}` : `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
};

const pill = (fg: string, bg: string, text: string) => (
  <span style={{ fontSize: '10.5px', fontWeight: 800, padding: '3px 9px', borderRadius: '999px', color: fg, backgroundColor: bg, whiteSpace: 'nowrap' }}>
    {text}
  </span>
);

/** Thẻ bọc nội dung thống nhất với phong cách admin. */
const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px', ...style }}>
    {children}
  </div>
);

/** Bỏ dấu tiếng Việt để so khớp tên điểm dừng với chi nhánh ổn định. */
const normText = (v: any) => String(v || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/gi, 'd')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

/** Từ khoá nhận diện điểm dừng của chi nhánh (dữ liệu seed cũ chưa có branch_id). */
const BRANCH_STOP_KEYWORDS: Record<string, string[]> = {
  CN130: ['ch130', '130 van kiep'],
  CN261: ['ch261', '261 to hien thanh'],
  CN120: ['ch120', '120 hoang dieu'],
  CN111: ['ch111', '111 ton dan'],
  XUONG_SX: ['xuong san xuat', 'bui cong trung'],
  VAN_PHONG: ['tru so', 'van phong', 'dang thai mai'],
};

/**
 * Tài xế MilkRoute chỉ lấy nhân sự khối Xưởng (group XUONG hoặc chi nhánh
 * XUONG_SX). Nhân sự đã nghỉ việc (TERMINATED) không hiện trong danh sách.
 */
const isWorkshopEmployee = (e: any): boolean => {
  if (!e || e.employment_status === 'TERMINATED') return false;
  const group = String(e.group || '').trim().toUpperCase();
  const branch = String(e.default_branch_id || e.branch_id || '').trim().toUpperCase();
  return group === 'XUONG' || branch === 'XUONG_SX';
};

/** Tìm chi nhánh tương ứng với một điểm dừng lộ trình (null nếu không có). */
const findBranchForStop = (stop: any, branches: any[]): any | null => {
  if (!stop || stop.stop_type === 'CHARGING') return null;
  const bid = String(stop.branch_id || '').trim();
  if (bid) return branches.find((b: any) => String(b.id) === bid) || null;
  const hay = `${normText(stop.name)} | ${normText(stop.address)}`;
  return branches.find((b: any) => {
    const id = normText(b.id);
    if (id && hay.includes(id)) return true;
    const kws = BRANCH_STOP_KEYWORDS[String(b.id)] || [];
    return kws.some((k) => hay.includes(normText(k)));
  }) || null;
};

// ============================================================
// 1. LIVE MAP
// ============================================================
const LiveMapView: React.FC<{ showToast: (m: string) => void }> = ({ showToast }) => {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [liveShifts, setLiveShifts] = useState<any[]>([]);
  const [stops, setStops] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [tick, setTick] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Record<string, any>>({});
  const routeLayerRef = useRef<any>(null);
  const branchLayerRef = useRef<any>(null);
  const branchesSigRef = useRef('');
  const fittedRef = useRef(false);

  const loadLive = useCallback(async () => {
    try {
      const [vRes, sRes, bRes] = await Promise.allSettled([
        apiRequest('/ev/admin/live/vehicles'),
        apiRequest('/ev/admin/live/shifts'),
        // Toạ độ chi nhánh lấy trực tiếp từ tab Quản Lý Chi Nhánh.
        apiRequest('/admin/branches'),
      ]);
      if (vRes.status === 'fulfilled') setVehicles(Array.isArray(vRes.value) ? vRes.value : []);
      if (sRes.status === 'fulfilled') setLiveShifts(Array.isArray(sRes.value) ? sRes.value : []);
      if (bRes.status === 'fulfilled') {
        const list = Array.isArray(bRes.value) ? bRes.value : [];
        // Chỉ vẽ lại lớp chi nhánh khi cấu hình thật sự đổi (tránh nhấp nháy 10s/lần).
        const sig = JSON.stringify(list.map((b: any) => [
          b.id, b.name, b.address, b.latitude, b.longitude,
          b.radius_meters, b.map_visible, b.gps_enabled,
        ]));
        if (sig !== branchesSigRef.current) {
          branchesSigRef.current = sig;
          setBranches(list);
        }
      }
      setErr('');
    } catch (e: any) {
      setErr(e?.message || 'Không tải được dữ liệu realtime.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Lộ trình + điểm dừng. Tải lại khi có realtime báo toạ độ trạm sạc/chi nhánh
  // thay đổi (trạm sạc không cố định — GPS tài xế gửi lúc bắt đầu sạc).
  const loadRouteData = useCallback(async () => {
    try {
      const rs: any = await apiRequest('/ev/admin/routes');
      const routeList = Array.isArray(rs) ? rs : [];
      setRoutes(routeList);
      const lists = await Promise.all(
        routeList.map((r: any) =>
          apiRequest(`/ev/admin/stops?routeId=${encodeURIComponent(r.route_id)}`).catch(() => []),
        ),
      );
      setStops(lists.flat().filter(Boolean));
    } catch {
      /* thiếu lộ trình vẫn chạy được map (chỉ không vẽ tuyến) */
    }
  }, []);

  useEffect(() => {
    void loadRouteData();
  }, [loadRouteData]);

  // Realtime: App.tsx phát 2 event khi backend báo chi nhánh/trạm sạc đổi toạ độ.
  useEffect(() => {
    const onStationOrBranchChanged = () => {
      void loadRouteData();
      void loadLive();
    };
    window.addEventListener('ubm:ev-station-reload', onStationOrBranchChanged);
    window.addEventListener('ubm:branches-reload', onStationOrBranchChanged);
    return () => {
      window.removeEventListener('ubm:ev-station-reload', onStationOrBranchChanged);
      window.removeEventListener('ubm:branches-reload', onStationOrBranchChanged);
    };
  }, [loadRouteData, loadLive]);

  // Khởi tạo map 1 lần.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true })
      .setView([10.83, 106.75], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    mapRef.current = map;
    branchLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    // Chống "map co0" khi vừa mount (layout chưa chốt).
    const t = setTimeout(() => map.invalidateSize(), 250);
    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      markersRef.current = {};
      routeLayerRef.current = null;
      branchLayerRef.current = null;
      fittedRef.current = false;
    };
  }, []);

  // Điểm dừng lộ trình LUÔN lấy toạ độ hiện tại của chi nhánh tương ứng
  // (tab Quản Lý Chi Nhánh) — kể cả dữ liệu seed cũ chưa được đồng bộ.
  const resolvedStops = useMemo(() => stops.map((s: any) => {
    const branch = findBranchForStop(s, branches);
    if (!branch) return s;
    const lat = Number(branch.latitude);
    const lng = Number(branch.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return s;
    return { ...s, latitude: lat, longitude: lng };
  }), [stops, branches]);

  // Vẽ chi nhánh (ghim + vòng bán kính) theo cấu hình Quản Lý Chi Nhánh.
  useEffect(() => {
    const map = mapRef.current;
    const layer = branchLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    branches.forEach((b: any) => {
      if (b.map_visible === false) return;
      const lat = Number(b.latitude);
      const lng = Number(b.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return;
      const pos: [number, number] = [lat, lng];
      L.circle(pos, {
        radius: Number(b.radius_meters) || 300,
        color: '#1D4ED8',
        weight: 1.5,
        opacity: 0.55,
        fillColor: '#1D4ED8',
        fillOpacity: 0.05,
        dashArray: b.gps_enabled === false ? '2 6' : undefined,
      }).addTo(layer);
      L.marker(pos, {
        icon: L.divIcon({
          className: '',
          html: `<div style="width:18px;height:18px;border-radius:5px;background:#1D4ED8;border:2px solid #fff;box-shadow:0 2px 6px rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;color:#fff;font:900 10px/1 system-ui,sans-serif">B</div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
          popupAnchor: [0, -9],
        }),
      })
        .bindTooltip(
          `${b.name || b.id}${b.gps_enabled === false ? ' • GPS tắt' : ''}<br/><span style="font-weight:600">${b.address || ''}</span><br/>Bán kính ${Number(b.radius_meters) || 300}m`,
          { direction: 'top', offset: [0, -10] },
        )
        .addTo(layer);
    });
  }, [branches]);

  // Vẽ tuyến + điểm dừng (geofence).
  useEffect(() => {
    const map = mapRef.current;
    const layer = routeLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!resolvedStops.length) return;
    const latlngs: any[] = [];
    resolvedStops
      .slice()
      .sort((a, b) => Number(a.stop_order) - Number(b.stop_order))
      .forEach((s: any) => {
        const pos: [number, number] = [Number(s.latitude), Number(s.longitude)];
        // (0,0) = điểm sạc chưa ghim toạ độ → không vẽ để khỏi kéo bản đồ về
        // giữa đại dương (làm hỏng fitBounds của cả lộ trình).
        if (!Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) return;
        if (pos[0] === 0 && pos[1] === 0) return;
        latlngs.push(pos);
        L.circle(pos, {
          radius: Number(s.geofence_radius_m) || 100,
          color: '#0F766E',
          weight: 1,
          opacity: 0.45,
          fillColor: '#0F766E',
          fillOpacity: 0.06,
          dashArray: '4 4',
        }).addTo(layer);
        L.circleMarker(pos, {
          radius: 7,
          color: '#0F766E',
          weight: 2,
          fillColor: '#FFFFFF',
          fillOpacity: 1,
        })
          .bindTooltip(`${s.stop_order}. ${s.name}`, { direction: 'top', offset: [0, -8] })
          .addTo(layer);
      });
    if (latlngs.length >= 2) {
      L.polyline(latlngs, { color: '#0F766E', weight: 3, opacity: 0.55, dashArray: '8 6' }).addTo(layer);
    }
    if (latlngs.length && !fittedRef.current) {
      fittedRef.current = true;
      map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
    }
  }, [resolvedStops]);

  // Đánh dấu xe realtime.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<string>();
    vehicles.forEach((v: any) => {
      const id = String(v.vehicleId || '');
      const lat = Number(v.latitude);
      const lng = Number(v.longitude);
      if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
      seen.add(id);
      const pos: [number, number] = [lat, lng];
      let marker = markersRef.current[id];
      if (!marker) {
        marker = L.marker(pos, {
          icon: L.divIcon({
            className: '',
            html: `<div style="width:24px;height:24px;border-radius:50% 50% 50% 4px;transform:rotate(-45deg);background:#0F766E;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(15,23,42,.45)"></div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
            popupAnchor: [0, -12],
          }),
        }).addTo(map);
        marker.bindTooltip(String(v.licensePlate || 'Xe'), { direction: 'top', offset: [0, -14], permanent: false });
        marker.on('click', () => setSelectedId(id));
        markersRef.current[id] = marker;
      } else {
        marker.setLatLng(pos);
      }
      const live = liveShifts.find((s: any) => String(s.shiftId) === String(v.shiftId));
      marker.setPopupContent(`
        <div style="font:600 12px/1.55 system-ui,sans-serif;min-width:190px">
          <strong style="font-size:13px">${v.licensePlate || 'Xe'} — ${v.driverName || '—'}</strong><br/>
          🚀 Tốc độ: ${Math.round(Number(v.speed) || 0)} km/h<br/>
          🔋 Pin: ${Math.round(Number(v.battery) || 0)}%<br/>
          📍 GPS: ${agoLabel(v.lastUpdate)}<br/>
          ${live ? `➡️ Điểm tiếp: ${live.nextStopName || '—'} (SLA còn ${fmtCountdown(Number(live.slaRemainingSeconds) || 0)})` : ''}
        </div>`);
    });
    Object.keys(markersRef.current).forEach((id) => {
      if (!seen.has(id)) {
        map.removeLayer(markersRef.current[id]);
        delete markersRef.current[id];
      }
    });
    if (seen.size && !fittedRef.current) {
      const pts = vehicles
        .map((v: any) => [Number(v.latitude), Number(v.longitude)])
        .filter((p: any) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
      if (pts.length) {
        fittedRef.current = true;
        map.fitBounds(L.latLngBounds(pts as any), { padding: [50, 50] });
      }
    }
  }, [vehicles, liveShifts]);

  // Poll 10s + giây chạy cho nhãn "x giây trước".
  useEffect(() => {
    void loadLive();
    const a = setInterval(() => void loadLive(), 10000);
    const b = setInterval(() => setTick((n) => n + 1), 5000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [loadLive]);
  void tick;

  const flyTo = (v: any) => {
    const map = mapRef.current;
    if (!map) return;
    setSelectedId(String(v.vehicleId));
    map.flyTo([Number(v.latitude), Number(v.longitude)], Math.max(map.getZoom(), 15), { duration: 0.6 });
    const m = markersRef.current[String(v.vehicleId)];
    if (m) m.openPopup();
  };

  const liveById = useMemo(() => {
    const m: Record<string, any> = {};
    liveShifts.forEach((s: any) => { m[String(s.shiftId)] = s; });
    return m;
  }, [liveShifts]);

  return (
    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'stretch' }}>
      <Card style={{ flex: '1 1 520px', minWidth: '0', padding: '10px' }}>
        <div
          ref={containerRef}
          style={{ width: '100%', height: '480px', borderRadius: '8px', overflow: 'hidden', background: '#E2E8F0' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 4px 2px', fontSize: '11.5px', color: MUTED, fontWeight: 600, flexWrap: 'wrap' }}>
          <span>🟢 Xe đang chạy • 🏢 chi nhánh (vòng bán kính theo cấu hình) • ⭕ geofence điểm giao</span>
          <button className="btn-secondary" style={{ marginLeft: 'auto', padding: '5px 11px', fontSize: '11.5px', fontWeight: 700 }} onClick={() => void loadLive()}>
            <RefreshCw size={13} /> Làm mới
          </button>
        </div>
        <div style={{ padding: '0 4px 4px', fontSize: '11px', color: MUTED, fontWeight: 600 }}>
          Toạ độ chi nhánh & điểm giao đồng bộ với tab <b>Quản Lý Chi Nhánh</b> — tự cập nhật sau mỗi 10 giây.
        </div>
      </Card>

      <Card style={{ flex: '0 1 360px', minWidth: '300px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Gauge size={17} color={BRAND} />
          <span style={{ fontSize: '14px', fontWeight: 900, color: 'var(--text)' }}>Xe đang vận hành</span>
          <span style={{ marginLeft: 'auto', fontSize: '11px', color: MUTED, fontWeight: 700 }}>
            {err ? '⚠️ lỗi kết nối' : loading ? 'đang tải…' : `cập nhật ${new Date().toLocaleTimeString('vi-VN')}`}
          </span>
        </div>

        {err && (
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#B91C1C', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '9px 11px' }}>
            {err}
          </div>
        )}

        {!err && vehicles.length === 0 && !loading && (
          <div style={{ fontSize: '12.5px', color: MUTED, fontWeight: 600, lineHeight: 1.7, padding: '10px 2px' }}>
            Hiện không có xe nào đang chạy ca.<br />
            Tài xế bấm <b>Bắt đầu ca</b> trong app là xe xuất hiện ở đây (GPS gửi mỗi 15 giây).
          </div>
        )}

        {vehicles.map((v: any) => {
          const live = liveById[String(v.shiftId)];
          const isSel = selectedId === String(v.vehicleId);
          const stale = Date.now() - Date.parse(v.lastUpdate || '') > 90000;
          return (
            <button
              key={String(v.vehicleId) + String(v.shiftId)}
              onClick={() => flyTo(v)}
              style={{
                textAlign: 'left', cursor: 'pointer', padding: '10px 12px', borderRadius: '10px',
                border: `1.5px solid ${isSel ? '#0F766E' : BORDER}`,
                backgroundColor: isSel ? '#F0FDFA' : 'var(--bg)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Truck size={15} color="#0F766E" />
                <span style={{ fontSize: '13px', fontWeight: 900, color: 'var(--text)' }}>{v.licensePlate || 'Xe'}</span>
                <span style={{ fontSize: '12px', color: MUTED, fontWeight: 700 }}>• {v.driverName || '—'}</span>
                <span style={{ marginLeft: 'auto' }}>
                  {stale ? pill('#B45309', '#FEF3C7', 'GPS cũ') : pill('#047857', '#ECFDF5', 'Live')}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '11.5px', color: MUTED, fontWeight: 700, flexWrap: 'wrap' }}>
                <span>🚀 {Math.round(Number(v.speed) || 0)} km/h</span>
                <span>🔋 {Math.round(Number(v.battery) || 0)}%</span>
                <span>📍 {agoLabel(v.lastUpdate)}</span>
              </div>
              {live && (
                <div style={{ marginTop: '6px', fontSize: '11.5px', fontWeight: 700, color: BRAND }}>
                  ➡️ Điểm tiếp: {live.nextStopName || '—'}
                  {' • '}SLA còn <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtCountdown(Number(live.slaRemainingSeconds) || 0)}</span>
                  {Number(live.penaltyPoints) > 0 && (
                    <span style={{ color: '#B91C1C' }}> • phạt {fmtMoney(live.penaltyAmount)}</span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </Card>
    </div>
  );
};

// ============================================================
// 2. XE & LỘ TRÌNH
// ============================================================
const FleetView: React.FC<{ allEmployees: any[]; showToast: (m: string) => void; canManage: boolean }> = ({
  allEmployees, showToast, canManage,
}) => {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [stops, setStops] = useState<any[]>([]);
  const [routeId, setRouteId] = useState('');
  const [busy, setBusy] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ license_plate: '', current_battery_pct: '100', status: 'ACTIVE', assigned_driver_id: '', notes: '' });

  // Chỉ nhân sự khối Xưởng được chọn làm tài xế phụ trách xe.
  const workshopDrivers = useMemo(() => {
    const list = allEmployees.filter(isWorkshopEmployee);
    // Giữ tài xế đang gán (dữ liệu cũ ngoài Xưởng) để ô chọn không bị trống.
    const currentId = String(form.assigned_driver_id || '');
    if (currentId && !list.some((e: any) => String(e.employee_id) === currentId)) {
      const current = allEmployees.find((e: any) => String(e.employee_id) === currentId);
      if (current) return [...list, current];
    }
    return list;
  }, [allEmployees, form.assigned_driver_id]);

  const load = useCallback(async () => {
    try {
      const [vRes, rRes] = await Promise.allSettled([
        apiRequest('/ev/admin/vehicles'),
        apiRequest('/ev/admin/routes'),
      ]);
      const vList = vRes.status === 'fulfilled' && Array.isArray(vRes.value) ? vRes.value : [];
      const rList = rRes.status === 'fulfilled' && Array.isArray(rRes.value) ? rRes.value : [];
      setVehicles(vList);
      setRoutes(rList);
      setRouteId((cur) => cur || (rList[0]?.route_id ?? ''));
    } catch (e: any) {
      showToast(`⚠️ ${e?.message || 'Không tải được danh sách xe.'}`);
    }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!routeId) { setStops([]); return; }
    apiRequest(`/ev/admin/stops?routeId=${encodeURIComponent(routeId)}`)
      .then((d: any) => setStops(Array.isArray(d) ? d : []))
      .catch(() => setStops([]));
  }, [routeId]);

  const createVehicle = async () => {
    if (!form.license_plate.trim()) return showToast('⚠️ Nhập biển số xe!');
    setBusy('create');
    try {
      await apiRequest('/ev/admin/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          license_plate: form.license_plate.trim(),
          current_battery_pct: Number(form.current_battery_pct) || 0,
          status: form.status,
          assigned_driver_id: form.assigned_driver_id || undefined,
          notes: form.notes || undefined,
        }),
      });
      showToast('✅ Đã thêm xe điện.');
      setForm({ license_plate: '', current_battery_pct: '100', status: 'ACTIVE', assigned_driver_id: '', notes: '' });
      setShowForm(false);
      await load();
    } catch (e: any) {
      showToast(`⚠️ ${e?.message || 'Thêm xe thất bại.'}`);
    } finally { setBusy(''); }
  };

  const setVehicleStatus = async (v: any, status: string) => {
    setBusy(v.vehicle_id);
    try {
      await apiRequest(`/ev/admin/vehicles/${encodeURIComponent(v.vehicle_id)}`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      showToast(`✅ ${v.license_plate} → ${VEHICLE_STATUS[status]?.text || status}`);
      await load();
    } catch (e: any) {
      showToast(`⚠️ ${e?.message || 'Cập nhật thất bại.'}`);
    } finally { setBusy(''); }
  };

  const removeVehicle = async (v: any) => {
    if (!window.confirm(`Xóa xe ${v.license_plate}? Hành động này không hoàn tác.`)) return;
    setBusy(v.vehicle_id);
    try {
      await apiRequest(`/ev/admin/vehicles/${encodeURIComponent(v.vehicle_id)}`, { method: 'DELETE' });
      showToast('🗑️ Đã xóa xe.');
      await load();
    } catch (e: any) {
      showToast(`⚠️ ${e?.message || 'Xóa xe thất bại.'}`);
    } finally { setBusy(''); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* DANH SÁCH XE */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <Truck size={17} color={BRAND} />
          <span style={{ fontSize: '14px', fontWeight: 900, color: 'var(--text)' }}>Xe điện ({vehicles.length})</span>
          {canManage && (
            <button className="btn-secondary" style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: '12px', fontWeight: 700 }} onClick={() => setShowForm((s) => !s)}>
              {showForm ? <><ChevronUp size={14} /> Đóng</> : <><Plus size={14} /> Thêm xe</>}
            </button>
          )}
        </div>

        {showForm && canManage && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', padding: '11px', backgroundColor: BG, border: `1px solid ${BORDER}`, borderRadius: '10px', marginBottom: '12px', alignItems: 'flex-end' }}>
            <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text)' }}>
              Biển số *
              <input value={form.license_plate} onChange={(e) => setForm((f) => ({ ...f, license_plate: e.target.value }))}
                placeholder="29H-123.45"
                style={{ display: 'block', marginTop: '3px', padding: '7px 9px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${BORDER}`, width: '130px' }} />
            </label>
            <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text)' }}>
              Pin (%)
              <input type="number" min={0} max={100} value={form.current_battery_pct}
                onChange={(e) => setForm((f) => ({ ...f, current_battery_pct: e.target.value }))}
                style={{ display: 'block', marginTop: '3px', padding: '7px 9px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${BORDER}`, width: '90px' }} />
            </label>
            <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text)' }}>
              Trạng thái
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                style={{ display: 'block', marginTop: '3px', padding: '7px 9px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${BORDER}` }}>
                <option value="ACTIVE">Hoạt động</option>
                <option value="MAINTENANCE">Bảo trì</option>
                <option value="RETIRED">Ngừng hoạt động</option>
              </select>
            </label>
            <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text)' }}>
              Tài xế phụ trách (khối Xưởng)
              <select value={form.assigned_driver_id} onChange={(e) => setForm((f) => ({ ...f, assigned_driver_id: e.target.value }))}
                style={{ display: 'block', marginTop: '3px', padding: '7px 9px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${BORDER}`, maxWidth: '210px' }}>
                <option value="">— Chưa gán —</option>
                {workshopDrivers.map((e: any) => (
                  <option key={e.employee_id} value={e.employee_id}>{e.full_name} ({e.employee_code || e.employee_id})</option>
                ))}
              </select>
              {workshopDrivers.length === 0 && (
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#B45309', marginTop: '4px', maxWidth: '210px' }}>
                  Chưa có nhân sự khối Xưởng. Thêm nhân sự với Khối = Xưởng ở tab Nhân sự trước.
                </div>
              )}
            </label>
            <button className="btn-primary" disabled={busy === 'create'} onClick={createVehicle}
              style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 800 }}>
              {busy === 'create' ? 'Đang lưu…' : 'Lưu xe'}
            </button>
          </div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: MUTED, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                <th style={{ padding: '8px 10px' }}>Biển số</th>
                <th style={{ padding: '8px 10px' }}>Tài xế</th>
                <th style={{ padding: '8px 10px' }}>Pin</th>
                <th style={{ padding: '8px 10px' }}>Trạng thái</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v: any) => {
                const st = VEHICLE_STATUS[v.status] || VEHICLE_STATUS.ACTIVE;
                const driver = allEmployees.find((e: any) => e.employee_id === v.assigned_driver_id);
                const pct = Number(v.current_battery_pct) || 0;
                return (
                  <tr key={v.vehicle_id} style={{ borderTop: `1px solid ${BORDER}` }}>
                    <td style={{ padding: '10px', fontWeight: 800, color: 'var(--text)' }}>{v.license_plate}</td>
                    <td style={{ padding: '10px', color: driver ? 'var(--text)' : MUTED, fontWeight: 600 }}>
                      {driver ? driver.full_name : (v.assigned_driver_id || '— chưa gán')}
                    </td>
                    <td style={{ padding: '10px', minWidth: '130px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                        <div style={{ flex: 1, height: '7px', backgroundColor: '#E2E8F0', borderRadius: '999px', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: pct > 40 ? '#0F766E' : pct > 15 ? '#D97706' : '#DC2626' }} />
                        </div>
                        <span style={{ fontSize: '11.5px', fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px' }}>{pill(st.fg, st.bg, st.text)}</td>
                    <td style={{ padding: '10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {canManage && (
                        <>
                          <select
                            value={v.status}
                            disabled={busy === v.vehicle_id}
                            onChange={(e) => setVehicleStatus(v, e.target.value)}
                            style={{ padding: '5px 7px', fontSize: '11.5px', borderRadius: '7px', border: `1px solid ${BORDER}`, marginRight: '7px', fontWeight: 700 }}
                          >
                            <option value="ACTIVE">Hoạt động</option>
                            <option value="MAINTENANCE">Bảo trì</option>
                            <option value="RETIRED">Ngừng</option>
                          </select>
                          <button className="btn-secondary" disabled={busy === v.vehicle_id}
                            onClick={() => removeVehicle(v)}
                            style={{ padding: '5px 10px', fontSize: '11.5px', fontWeight: 700, color: '#B91C1C' }}>
                            <XCircle size={13} /> Xóa
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!vehicles.length && (
                <tr><td colSpan={5} style={{ padding: '22px', textAlign: 'center', color: MUTED, fontWeight: 600 }}>
                  Chưa có xe điện nào. Bấm “Thêm xe” để đăng ký xe đầu tiên.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* LỘ TRÌNH & ĐIỂM DỪNG */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <RouteIcon size={17} color="#0F766E" />
          <span style={{ fontSize: '14px', fontWeight: 900, color: 'var(--text)' }}>Lộ trình & điểm giao</span>
          <select value={routeId} onChange={(e) => setRouteId(e.target.value)}
            style={{ marginLeft: 'auto', padding: '6px 9px', fontSize: '12.5px', fontWeight: 700, borderRadius: '8px', border: `1px solid ${BORDER}` }}>
            {routes.map((r: any) => <option key={r.route_id} value={r.route_id}>{r.name}</option>)}
            {!routes.length && <option value="">— Chưa có lộ trình —</option>}
          </select>
        </div>
        {routes.find((r: any) => r.route_id === routeId)?.description && (
          <div style={{ fontSize: '12px', color: MUTED, fontWeight: 600, marginBottom: '10px', lineHeight: 1.6 }}>
            {routes.find((r: any) => r.route_id === routeId)?.description}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {stops.map((s: any) => (
            <div key={s.stop_id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 11px', border: `1px solid ${BORDER}`, borderRadius: '10px', backgroundColor: 'var(--bg)' }}>
              <span style={{ width: '24px', height: '24px', flexShrink: 0, borderRadius: '999px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 900, backgroundColor: '#0F766E', color: '#fff' }}>
                {s.stop_order}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text)' }}>
                  {s.name}
                  {!s.is_mandatory && <span style={{ fontSize: '9.5px', fontWeight: 800, padding: '1px 6px', borderRadius: '999px', backgroundColor: '#F1F5F9', color: MUTED, marginLeft: '6px' }}>TÙY CHỌN</span>}
                  {s.stop_type === 'CHARGING' && <span style={{ fontSize: '9.5px', fontWeight: 800, padding: '1px 6px', borderRadius: '999px', backgroundColor: '#F5F3FF', color: '#6D28D9', marginLeft: '6px' }}>TRẠM SẠC</span>}
                </div>
                <div style={{ fontSize: '11px', color: MUTED, fontWeight: 600, marginTop: '2px' }}>
                  {s.address ? `${s.address} • ` : ''}
                  SLA {s.sla_minutes} phút • geofence {s.geofence_radius_m}m • {Number(s.latitude).toFixed(5)}, {Number(s.longitude).toFixed(5)}
                </div>
              </div>
              {s.stop_type === 'START' || s.stop_type === 'END'
                ? pill('#0369A1', '#F0F9FF', s.stop_type === 'START' ? 'XUẤT PHÁT' : 'KẾT THÚC')
                : pill('#475569', '#F1F5F9', 'GIAO HÀNG')}
            </div>
          ))}
          {!stops.length && (
            <div style={{ fontSize: '12.5px', color: MUTED, fontWeight: 600, padding: '12px 2px' }}>
              Chưa có điểm dừng cho lộ trình này (dữ liệu seed sẽ tự tạo khi backend khởi động).
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

// ============================================================
// 3. CA VẬN CHUYỂN
// ============================================================
const ShiftsView: React.FC<{ allEmployees: any[]; showToast: (m: string) => void; canManage: boolean }> = ({
  allEmployees, showToast, canManage,
}) => {
  const [items, setItems] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [statusF, setStatusF] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [busy, setBusy] = useState('');
  const [openId, setOpenId] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    route_id: '', driver_id: '', vehicle_id: '', shift_date: '',
    planned_start_at: '', planned_end_at: '', notes: '',
  });

  // Ca vận chuyển chỉ chọn tài xế thuộc khối Xưởng.
  const workshopDrivers = useMemo(() => allEmployees.filter(isWorkshopEmployee), [allEmployees]);

  const load = useCallback(async () => {
    setBusy('load');
    try {
      const qs = new URLSearchParams({ limit: '100' });
      if (statusF) qs.set('status', statusF);
      if (dateFrom) qs.set('date_from', dateFrom);
      if (dateTo) qs.set('date_to', dateTo);
      const [sRes, vRes, rRes] = await Promise.allSettled([
        apiRequest(`/ev/admin/shifts?${qs.toString()}`),
        apiRequest('/ev/admin/vehicles'),
        apiRequest('/ev/admin/routes'),
      ]);
      if (sRes.status === 'fulfilled') setItems((sRes.value as any)?.items || []);
      if (vRes.status === 'fulfilled' && Array.isArray(vRes.value)) setVehicles(vRes.value);
      if (rRes.status === 'fulfilled' && Array.isArray(rRes.value)) {
        setRoutes(rRes.value);
        setForm((f) => ({ ...f, route_id: f.route_id || rRes.value[0]?.route_id || '' }));
      }
    } catch (e: any) {
      showToast(`⚠️ ${e?.message || 'Không tải được danh sách ca.'}`);
    } finally { setBusy(''); }
  }, [statusF, dateFrom, dateTo, showToast]);

  useEffect(() => { void load(); }, [load]);

  const openDetail = async (s: any) => {
    const id = String(s.shift_id);
    if (openId === id) { setOpenId(''); setDetail(null); return; }
    setOpenId(id); setDetail(null);
    try {
      const d: any = await apiRequest(`/ev/admin/shifts/${encodeURIComponent(id)}`);
      setDetail(d);
    } catch (e: any) {
      showToast(`⚠️ ${e?.message || 'Không tải được chi tiết ca.'}`);
      setOpenId('');
    }
  };

  const createShift = async () => {
    if (!form.route_id || !form.driver_id || !form.vehicle_id || !form.shift_date || !form.planned_start_at) {
      return showToast('⚠️ Điền đủ: lộ trình, tài xế, xe, ngày ca và giờ bắt đầu!');
    }
    setBusy('create');
    try {
      await apiRequest('/ev/admin/shifts', {
        method: 'POST',
        body: JSON.stringify({
          route_id: form.route_id,
          driver_id: form.driver_id,
          vehicle_id: form.vehicle_id,
          shift_date: form.shift_date,
          planned_start_at: new Date(form.planned_start_at).toISOString(),
          planned_end_at: form.planned_end_at ? new Date(form.planned_end_at).toISOString() : undefined,
          notes: form.notes || undefined,
        }),
      });
      showToast('✅ Đã tạo ca vận chuyển — tài xế thấy ca trong app ngay.');
      setShowForm(false);
      setForm((f) => ({ ...f, driver_id: '', vehicle_id: '', shift_date: '', planned_start_at: '', planned_end_at: '', notes: '' }));
      await load();
    } catch (e: any) {
      showToast(`⚠️ ${e?.message || 'Tạo ca thất bại.'}`);
    } finally { setBusy(''); }
  };

  const setStatus = async (s: any, status: string) => {
    setBusy(s.shift_id);
    try {
      await apiRequest(`/ev/admin/shifts/${encodeURIComponent(s.shift_id)}`, {
        method: 'PUT', body: JSON.stringify({ status }),
      });
      showToast(`✅ Ca ${fmtDay(s.shift_date)} → ${SHIFT_STATUS[status]?.text || status}`);
      await load();
    } catch (e: any) {
      showToast(`⚠️ ${e?.message || 'Cập nhật ca thất bại.'}`);
    } finally { setBusy(''); }
  };

  const removeShift = async (s: any) => {
    if (!window.confirm(`Xóa ca ${fmtDay(s.shift_date)} của tài xế?`)) return;
    setBusy(s.shift_id);
    try {
      await apiRequest(`/ev/admin/shifts/${encodeURIComponent(s.shift_id)}`, { method: 'DELETE' });
      showToast('🗑️ Đã xóa ca.');
      await load();
    } catch (e: any) {
      showToast(`⚠️ ${e?.message || 'Xóa ca thất bại.'}`);
    } finally { setBusy(''); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <CalendarClock size={17} color={BRAND} />
          <span style={{ fontSize: '14px', fontWeight: 900, color: 'var(--text)' }}>Ca vận chuyển ({items.length})</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '7px', flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={statusF} onChange={(e) => setStatusF(e.target.value)}
              style={{ padding: '6px 8px', fontSize: '12px', fontWeight: 700, borderRadius: '8px', border: `1px solid ${BORDER}` }}>
              <option value="">Mọi trạng thái</option>
              {Object.keys(SHIFT_STATUS).map((k) => <option key={k} value={k}>{SHIFT_STATUS[k].text}</option>)}
            </select>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              style={{ padding: '6px 8px', fontSize: '12px', fontWeight: 700, borderRadius: '8px', border: `1px solid ${BORDER}` }} />
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              style={{ padding: '6px 8px', fontSize: '12px', fontWeight: 700, borderRadius: '8px', border: `1px solid ${BORDER}` }} />
            <button className="btn-secondary" onClick={() => void load()} disabled={busy === 'load'}
              style={{ padding: '6px 11px', fontSize: '12px', fontWeight: 700 }}>
              <RefreshCw size={13} /> Tải lại
            </button>
            {canManage && (
              <button className="btn-primary" onClick={() => setShowForm((s) => !s)}
                style={{ padding: '6px 13px', fontSize: '12px', fontWeight: 800 }}>
                {showForm ? <><ChevronUp size={14} /> Đóng</> : <><Plus size={14} /> Tạo ca</>}
              </button>
            )}
          </div>
        </div>

        {showForm && canManage && (
          <div style={{ display: 'flex', gap: '9px', flexWrap: 'wrap', padding: '12px', backgroundColor: BG, border: `1px solid ${BORDER}`, borderRadius: '10px', marginBottom: '12px', alignItems: 'flex-end' }}>
            <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text)' }}>
              Ngày ca *
              <input type="date" value={form.shift_date} onChange={(e) => setForm((f) => ({ ...f, shift_date: e.target.value }))}
                style={{ display: 'block', marginTop: '3px', padding: '7px 9px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${BORDER}` }} />
            </label>
            <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text)' }}>
              Giờ bắt đầu *
              <input type="datetime-local" value={form.planned_start_at} onChange={(e) => setForm((f) => ({ ...f, planned_start_at: e.target.value }))}
                style={{ display: 'block', marginTop: '3px', padding: '7px 9px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${BORDER}` }} />
            </label>
            <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text)' }}>
              Giờ dự kiến kết thúc
              <input type="datetime-local" value={form.planned_end_at} onChange={(e) => setForm((f) => ({ ...f, planned_end_at: e.target.value }))}
                style={{ display: 'block', marginTop: '3px', padding: '7px 9px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${BORDER}` }} />
            </label>
            <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text)' }}>
              Lộ trình *
              <select value={form.route_id} onChange={(e) => setForm((f) => ({ ...f, route_id: e.target.value }))}
                style={{ display: 'block', marginTop: '3px', padding: '7px 9px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${BORDER}` }}>
                {routes.map((r: any) => <option key={r.route_id} value={r.route_id}>{r.name}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text)' }}>
              Tài xế (khối Xưởng) *
              <select value={form.driver_id} onChange={(e) => setForm((f) => ({ ...f, driver_id: e.target.value }))}
                style={{ display: 'block', marginTop: '3px', padding: '7px 9px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${BORDER}`, maxWidth: '210px' }}>
                <option value="">— Chọn tài xế —</option>
                {workshopDrivers.map((e: any) => (
                  <option key={e.employee_id} value={e.employee_id}>{e.full_name} ({e.employee_code || e.employee_id})</option>
                ))}
              </select>
              {workshopDrivers.length === 0 && (
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#B45309', marginTop: '4px', maxWidth: '210px' }}>
                  Chưa có nhân sự khối Xưởng. Thêm nhân sự với Khối = Xưởng ở tab Nhân sự trước.
                </div>
              )}
            </label>
            <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text)' }}>
              Xe *
              <select value={form.vehicle_id} onChange={(e) => setForm((f) => ({ ...f, vehicle_id: e.target.value }))}
                style={{ display: 'block', marginTop: '3px', padding: '7px 9px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${BORDER}` }}>
                <option value="">— Chọn xe —</option>
                {vehicles.map((v: any) => <option key={v.vehicle_id} value={v.vehicle_id}>{v.license_plate}</option>)}
              </select>
            </label>
            <button className="btn-primary" disabled={busy === 'create'} onClick={createShift}
              style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 800 }}>
              {busy === 'create' ? 'Đang tạo…' : 'Tạo ca'}
            </button>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
          {items.map((s: any) => {
            const st = SHIFT_STATUS[s.status] || SHIFT_STATUS.SCHEDULED;
            const isOpen = openId === String(s.shift_id);
            const drv = allEmployees.find((e: any) => e.employee_id === s.driver_id);
            const veh = vehicles.find((v: any) => v.vehicle_id === s.vehicle_id);
            return (
              <div key={s.shift_id} style={{ border: `1.5px solid ${isOpen ? '#93C5FD' : BORDER}`, borderRadius: '10px', overflow: 'hidden', backgroundColor: isOpen ? '#EFF6FF' : 'var(--bg)' }}>
                <button onClick={() => void openDetail(s)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 13px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13px', fontWeight: 900, color: 'var(--text)' }}>
                    {fmtDay(s.shift_date)} • {fmtTime(s.planned_start_at)}
                  </span>
                  {pill(st.fg, st.bg, st.text)}
                  <span style={{ fontSize: '12px', color: MUTED, fontWeight: 700 }}>
                    Tài xế {drv?.full_name || s.driver_id} • Xe {veh?.license_plate || s.vehicle_id}
                  </span>
                  {Number(s.penalty_points) > 0 && (
                    <span style={{ fontSize: '11.5px', fontWeight: 800, color: '#B91C1C' }}>
                      ⚠️ {s.penalty_points} điểm phạt ({fmtMoney(s.penalty_amount)})
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 800, color: BRAND }}>
                    {isOpen ? 'Ẩn chi tiết' : 'Xem tiến độ'} {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </span>
                </button>

                {isOpen && (
                  <div style={{ padding: '4px 13px 13px', borderTop: `1px solid ${BORDER}` }}>
                    {!detail && <div style={{ fontSize: '12px', color: MUTED, fontWeight: 600, padding: '10px 0' }}>⏳ Đang tải chi tiết…</div>}
                    {detail && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ fontSize: '12.5px', fontWeight: 800, color: 'var(--text)' }}>
                          🧑 {detail.driverName} ({detail.driverCode}) • 🚐 {detail.vehiclePlate} • 🛣️ {detail.routeName}
                          {detail.shift.total_distance_km != null && <> • 📏 {Number(detail.shift.total_distance_km).toFixed(1)} km</>}
                          {detail.shift.net_pay != null && <> • 💰 thực nhận {fmtMoney(detail.shift.net_pay)}</>}
                        </div>
                        {(detail.stops || []).map((st2: any) => (
                          <div key={st2.stop_id} style={{ display: 'flex', alignItems: 'center', gap: '9px', fontSize: '12.5px', padding: '7px 10px', borderRadius: '8px', backgroundColor: st2.isCompleted ? '#ECFDF5' : '#fff', border: `1px solid ${st2.isCompleted ? '#A7F3D0' : BORDER}` }}>
                            <span style={{ fontWeight: 900, color: st2.isCompleted ? '#047857' : MUTED, width: '20px' }}>{st2.stop_order}</span>
                            <span style={{ fontWeight: 800, color: 'var(--text)', flex: 1 }}>{st2.name}</span>
                            {st2.isCompleted ? (
                              <span style={{ color: '#047857', fontWeight: 700, fontSize: '11.5px' }}>
                                ✅ {fmtTime(st2.checkedInAt)}{st2.isLate ? ` • trễ ${st2.lateMinutes}p` : ''}
                                {Number(st2.penaltyAmount) > 0 ? ` • ${fmtMoney(st2.penaltyAmount)}` : ''}
                              </span>
                            ) : (
                              <span style={{ color: MUTED, fontWeight: 700, fontSize: '11.5px' }}>chưa bấm</span>
                            )}
                          </div>
                        ))}
                        {canManage && (
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', paddingTop: '4px' }}>
                            {['SCHEDULED', 'PAUSED', 'CANCELLED'].includes(s.status) && (
                              <button className="btn-primary" disabled={busy === s.shift_id} onClick={() => setStatus(s, 'CANCELLED')}
                                style={{ padding: '7px 13px', fontSize: '12px', fontWeight: 800, backgroundColor: '#B91C1C' }}>
                                Hủy ca
                              </button>
                            )}
                            {s.status !== 'CANCELLED' && s.status !== 'COMPLETED' && (
                              <button className="btn-secondary" disabled={busy === s.shift_id} onClick={() => setStatus(s, 'CANCELLED')}
                                style={{ padding: '7px 13px', fontSize: '12px', fontWeight: 800 }}>
                                Đánh dấu hủy
                              </button>
                            )}
                            <button className="btn-secondary" disabled={busy === s.shift_id} onClick={() => removeShift(s)}
                              style={{ padding: '7px 13px', fontSize: '12px', fontWeight: 800, color: '#B91C1C' }}>
                              <XCircle size={13} /> Xóa ca
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {!items.length && !busy && (
            <div style={{ fontSize: '12.5px', color: MUTED, fontWeight: 600, padding: '14px 4px', lineHeight: 1.7 }}>
              Không có ca nào khớp bộ lọc. Backend seed 7 ca thử nghiệm theo đúng tọa độ GPS trong spec — bấm “Tạo ca” để thêm ca mới.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

// ============================================================
// 4. PHIẾU SẠC (DUYỆT 2 CẤP)
// ============================================================
const ChargingView: React.FC<{ showToast: (m: string) => void; canHr: boolean; canDirector: boolean; allEmployees: any[] }> = ({
  showToast, canHr, canDirector, allEmployees,
}) => {
  // Mặc định mở đúng hàng đợi của vai trò: HR → cấp 1, Giám đốc → cấp 2,
  // vai trò khác (Kế toán/Admin xem) → tất cả. Tránh chọn sẵn tab bị ẩn.
  const [filter, setFilter] = useState<string>(canHr ? 'PENDING_HR' : canDirector ? 'PENDING_DIRECTOR' : 'ALL');
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState('');

  // Đổi vai trò/khả năng duyệt → đưa bộ lọc về hàng đợi còn được phép xem.
  useEffect(() => {
    const allowed = [
      ...(canHr ? ['PENDING_HR'] : []),
      ...(canDirector ? ['PENDING_DIRECTOR'] : []),
      'APPROVED', 'REJECTED', 'ALL',
    ];
    if (!allowed.includes(filter)) setFilter(canHr ? 'PENDING_HR' : canDirector ? 'PENDING_DIRECTOR' : 'ALL');
  }, [canHr, canDirector, filter]);

  const load = useCallback(async () => {
    try {
      const q = filter === 'ALL' ? '' : `?status=${encodeURIComponent(filter)}`;
      const d: any = await apiRequest(`/ev/admin/charging-tickets${q}`);
      // Backend trả mảng trần cho hàng đợi pending, trả {total, items} cho phần còn lại.
      setItems(Array.isArray(d) ? d : (Array.isArray(d?.items) ? d.items : []));
    } catch (e: any) {
      showToast(`⚠️ ${e?.message || 'Không tải được phiếu sạc.'}`);
    }
  }, [filter, showToast]);

  useEffect(() => { void load(); }, [load]);

  const act = async (t: any, action: 'approve-hr' | 'reject-hr' | 'approve-director' | 'reject-director') => {
    let notes: string | undefined;
    if (action.startsWith('reject')) {
      const reason = window.prompt('Lý do từ chối phiếu sạc?');
      if (!reason || !reason.trim()) return;
      notes = reason.trim();
    }
    setBusy(`${t.ticket_id}:${action}`);
    try {
      await apiRequest(`/ev/admin/charging-tickets/${encodeURIComponent(t.ticket_id)}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ notes }),
      });
      showToast(
        action === 'approve-hr' ? '✅ HR duyệt — chuyển sang Giám đốc duyệt.'
          : action === 'approve-director' ? '✅ Giám đốc duyệt — tài xế sạc được trong ngày đăng ký.'
            : '❌ Đã từ chối phiếu sạc.',
      );
      await load();
    } catch (e: any) {
      showToast(`⚠️ ${e?.message || 'Xử lý phiếu thất bại.'}`);
    } finally { setBusy(''); }
  };

  const TABS: Array<{ id: string; label: string; need: boolean }> = [
    { id: 'PENDING_HR', label: 'Chờ HR (cấp 1)', need: canHr },
    { id: 'PENDING_DIRECTOR', label: 'Chờ Giám đốc (cấp 2)', need: canDirector },
    { id: 'APPROVED', label: 'Đã duyệt', need: true },
    { id: 'REJECTED', label: 'Từ chối', need: true },
    { id: 'ALL', label: 'Tất cả', need: true },
  ];
  const visibleTabs = TABS.filter((t) => t.need);

  /** Mã tài xế (EMP_...) → "Họ tên (mã)" để HR/GĐ đọc được ngay. */
  const driverLabel = (driverId: string) => {
    const emp = allEmployees.find((e: any) => e.employee_id === driverId);
    return emp ? `${emp.full_name} (${emp.employee_code || driverId})` : driverId;
  };

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <BatteryCharging size={17} color="#6D28D9" />
        <span style={{ fontSize: '14px', fontWeight: 900, color: 'var(--text)' }}>Phiếu sạc xe điện — duyệt 2 cấp</span>
        <button className="btn-secondary" style={{ marginLeft: 'auto', padding: '6px 11px', fontSize: '12px', fontWeight: 700 }} onClick={() => void load()}>
          <RefreshCw size={13} /> Làm mới
        </button>
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
        {visibleTabs.map((t) => (
          <button key={t.id} onClick={() => setFilter(t.id)}
            style={{
              padding: '7px 13px', borderRadius: '999px', fontSize: '12px', fontWeight: 800, cursor: 'pointer',
              border: filter === t.id ? '1.5px solid #6D28D9' : `1px solid ${BORDER}`,
              backgroundColor: filter === t.id ? '#F5F3FF' : 'var(--surface)',
              color: filter === t.id ? '#6D28D9' : 'var(--text-muted)',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {items.map((t: any) => {
          const st = TICKET_STATUS[t.status] || TICKET_STATUS.DRAFT;
          const pendingHr = t.status === 'PENDING_HR' && canHr;
          const pendingDir = t.status === 'PENDING_DIRECTOR' && canDirector;
          return (
            <div key={t.ticket_id} style={{ border: `1.5px solid ${pendingHr || pendingDir ? '#FDE68A' : BORDER}`, borderRadius: '10px', padding: '12px 13px', backgroundColor: pendingHr || pendingDir ? '#FFFBEB' : 'var(--bg)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '13px', fontWeight: 900, color: 'var(--text)' }}>
                  🎫 Ngày sạc {fmtDay(t.requested_date)} • tài xế {driverLabel(t.driver_id)}
                </span>
                {t.battery_level_pct != null && (
                  <span style={{ fontSize: '12px', fontWeight: 700, color: MUTED }}>pin {t.battery_level_pct}%</span>
                )}
                <span style={{ marginLeft: 'auto' }}>{pill(st.fg, st.bg, st.text)}</span>
              </div>

              <div style={{ fontSize: '11.5px', color: MUTED, fontWeight: 600, marginTop: '6px', lineHeight: 1.7 }}>
                {t.hr_approved_at && <div>✅ HR duyệt {fmtTime(t.hr_approved_at)}{t.hr_notes ? ` — ${t.hr_notes}` : ''}</div>}
                {t.director_approved_at && <div>✅ Giám đốc duyệt {fmtTime(t.director_approved_at)}{t.director_notes ? ` — ${t.director_notes}` : ''}</div>}
                {t.status === 'REJECTED' && (t.hr_notes || t.director_notes) && (
                  <div style={{ color: '#B91C1C', fontWeight: 700 }}>❌ Lý do: {t.hr_notes || t.director_notes}</div>
                )}
                {t.charging_start_at && (
                  <div style={{ color: '#6D28D9', fontWeight: 700 }}>
                    🔌 Sạc {fmtTime(t.charging_start_at)}{t.charging_end_at ? `–${fmtTime(t.charging_end_at)}` : '…'}
                    {t.charging_duration_min != null ? ` (${t.charging_duration_min} phút)` : ''}
                    {t.charging_station_name ? ` • ${t.charging_station_name}` : ''}
                    {t.energy_charged_kwh != null ? ` • ${Number(t.energy_charged_kwh).toFixed(1)} kWh` : ''}
                  </div>
                )}
                {t.notes && <div>📝 {t.notes}</div>}
              </div>

              {(pendingHr || pendingDir) && (
                <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                  <button className="btn-primary" disabled={!!busy}
                    onClick={() => act(t, pendingHr ? 'approve-hr' : 'approve-director')}
                    style={{ padding: '7px 15px', fontSize: '12.5px', fontWeight: 800, backgroundColor: '#047857' }}>
                    <CheckCircle2 size={14} /> {pendingHr ? 'HR duyệt' : 'Giám đốc duyệt'}
                  </button>
                  <button className="btn-secondary" disabled={!!busy}
                    onClick={() => act(t, pendingHr ? 'reject-hr' : 'reject-director')}
                    style={{ padding: '7px 15px', fontSize: '12.5px', fontWeight: 800, color: '#B91C1C' }}>
                    <XCircle size={14} /> Từ chối
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {!items.length && (
          <div style={{ fontSize: '12.5px', color: MUTED, fontWeight: 600, padding: '14px 4px', lineHeight: 1.7 }}>
            Không có phiếu sạc nào ở trạng thái này.
          </div>
        )}
      </div>

      <div style={{ marginTop: '14px', padding: '10px 12px', backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '9px', fontSize: '11.5px', fontWeight: 600, color: '#1E40AF', lineHeight: 1.7 }}>
        <b>Quy trình:</b> tài xế tạo phiếu sau khi giao xong ở Văn phòng → <b>HR duyệt (cấp 1)</b> → <b>Giám đốc duyệt (cấp 2)</b> →
        tài xế bắt đầu sạc đúng ngày đăng ký (ghim GPS tại trạm) → kết thúc sạc tự ghi kWh.
      </div>
    </Card>
  );
};

// ============================================================
// 5. LƯƠNG TÀI XẾ
// ============================================================
const PayrollView: React.FC<{ allEmployees: any[]; showToast: (m: string) => void; canManage: boolean }> = ({
  allEmployees, showToast, canManage,
}) => {
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setBusy('load');
    try {
      const d: any = await apiRequest(`/ev/admin/payroll?period=${encodeURIComponent(period)}`);
      setItems(Array.isArray(d) ? d : (d?.items || []));
    } catch (e: any) {
      showToast(`⚠️ ${e?.message || 'Không tải được bảng lương.'}`);
    } finally { setBusy(''); }
  }, [period, showToast]);

  useEffect(() => { void load(); }, [load]);

  const generate = async () => {
    if (!window.confirm(`Sinh bảng lương tài xế kỳ ${period}? Hệ thống tính lại từ ca + điểm phạt.`)) return;
    setBusy('gen');
    try {
      const r: any = await apiRequest('/ev/admin/payroll/generate', {
        method: 'POST', body: JSON.stringify({ period }),
      });
      showToast(`✅ Đã tính lương ${r?.count ?? 0} tài xế kỳ ${period}.`);
      await load();
    } catch (e: any) {
      showToast(`⚠️ ${e?.message || 'Sinh bảng lương thất bại.'}`);
    } finally { setBusy(''); }
  };

  const approve = async (p: any) => {
    setBusy(p.payroll_id);
    try {
      await apiRequest('/ev/admin/payroll/approve', {
        method: 'POST', body: JSON.stringify({ payroll_id: p.payroll_id }),
      });
      showToast(`✅ Đã duyệt lương tài xế ${p.driver_id}.`);
      await load();
    } catch (e: any) {
      showToast(`⚠️ ${e?.message || 'Duyệt lương thất bại.'}`);
    } finally { setBusy(''); }
  };

  const nameOf = (id: string) => allEmployees.find((e: any) => e.employee_id === id)?.full_name || id;

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <Wallet size={17} color={BRAND} />
        <span style={{ fontSize: '14px', fontWeight: 900, color: 'var(--text)' }}>Bảng lương tài xế</span>
        <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)}
          style={{ padding: '6px 9px', fontSize: '12.5px', fontWeight: 700, borderRadius: '8px', border: `1px solid ${BORDER}` }} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '7px' }}>
          <button className="btn-secondary" disabled={busy === 'load'} onClick={() => void load()}
            style={{ padding: '7px 12px', fontSize: '12px', fontWeight: 700 }}>
            <RefreshCw size={13} /> Tải lại
          </button>
          {canManage && (
            <button className="btn-primary" disabled={busy === 'gen'} onClick={generate}
              style={{ padding: '7px 14px', fontSize: '12px', fontWeight: 800 }}>
              <Navigation size={14} /> Tính lương kỳ {period}
            </button>
          )}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: MUTED, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              <th style={{ padding: '8px 10px' }}>Tài xế</th>
              <th style={{ padding: '8px 10px' }}>Ca / ngày công</th>
              <th style={{ padding: '8px 10px' }}>Phạt</th>
              <th style={{ padding: '8px 10px' }}>Thực nhận</th>
              <th style={{ padding: '8px 10px' }}>Trạng thái</th>
              <th style={{ padding: '8px 10px', textAlign: 'right' }}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p: any) => {
              const st = PAY_STATUS[p.status] || PAY_STATUS.DRAFT;
              return (
                <tr key={p.payroll_id} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={{ padding: '10px', fontWeight: 800, color: 'var(--text)' }}>
                    {nameOf(p.driver_id)}
                    <div style={{ fontSize: '10.5px', color: MUTED, fontWeight: 600 }}>{p.driver_id}</div>
                  </td>
                  <td style={{ padding: '10px', color: 'var(--text)', fontWeight: 600 }}>
                    {p.total_shifts} ca • {p.total_work_days} ngày ({p.standard_days}× chuẩn + {p.extra_days}× cuối)
                  </td>
                  <td style={{ padding: '10px' }}>
                    {Number(p.total_penalty_points) > 0 ? (
                      <span style={{ color: '#B91C1C', fontWeight: 800 }}>
                        {p.total_penalty_points} điểm • {fmtMoney(p.total_penalty_amount)}
                      </span>
                    ) : (
                      <span style={{ color: '#047857', fontWeight: 700 }}>không phạt</span>
                    )}
                  </td>
                  <td style={{ padding: '10px', fontWeight: 900, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtMoney(p.net_pay)}
                    <div style={{ fontSize: '10.5px', color: MUTED, fontWeight: 600 }}>gross {fmtMoney(p.gross_pay)}</div>
                  </td>
                  <td style={{ padding: '10px' }}>{pill(st.fg, st.bg, st.text)}</td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>
                    {canManage && p.status === 'DRAFT' && (
                      <button className="btn-primary" disabled={busy === p.payroll_id} onClick={() => approve(p)}
                        style={{ padding: '6px 13px', fontSize: '11.5px', fontWeight: 800, backgroundColor: '#047857' }}>
                        <CheckCircle2 size={13} /> Duyệt
                      </button>
                    )}
                    {p.status !== 'DRAFT' && (
                      <span style={{ fontSize: '11px', color: MUTED, fontWeight: 700 }}>
                        {p.approved_at ? `duyệt ${fmtDay(p.approved_at)}` : '—'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!items.length && !busy && (
              <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: MUTED, fontWeight: 600, lineHeight: 1.7 }}>
                Chưa có bảng lương kỳ {period}. Bấm <b>“Tính lương kỳ {period}”</b> để hệ thống tự dựng từ ca vận chuyển + điểm phạt SLA/điểm bỏ lọt.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '14px', padding: '10px 12px', backgroundColor: '#F0FDFA', border: '1px solid #99F6E4', borderRadius: '9px', fontSize: '11.5px', fontWeight: 600, color: '#115E59', lineHeight: 1.7 }}>
        <b>Công thức:</b> lương = lương ngày chuẩn × ngày công 1–28 + lương ngày cuối × ngày 29–30 − phạt
        (25% ngày công/điểm bỏ lọt + phạt trễ SLA). Kỳ lương VPS chạy ngày 25–26 hàng tháng.
      </div>
    </Card>
  );
};

// ============================================================
// SHELL
// ============================================================
export const MilkRouteAdminView: React.FC<MilkRouteAdminProps> = ({ currentUser, allEmployees = [], showToast = () => {} }) => {
  const role = String(currentUser?.role || '').toUpperCase();
  const isEvAdmin = ['ADMIN', 'HR', 'DIRECTOR', 'FLEET_MANAGER', 'FINANCE'].includes(role);
  const canHr = ['ADMIN', 'HR'].includes(role);
  const canDirector = ['ADMIN', 'DIRECTOR'].includes(role);
  const canManage = ['ADMIN', 'FLEET_MANAGER'].includes(role);
  // Bảng lương tài xế: CHỈ tài khoản Kế toán (FINANCE) thấy tab con này.
  const canPayroll = role === 'FINANCE';

  const [tab, setTab] = useState<SubTab>('map');

  // Đổi vai trò giữa chừng đang ở màn Lương -> đá về Live Map (tránh render màn bị ẩn).
  useEffect(() => {
    if (tab === 'payroll' && !canPayroll) setTab('map');
  }, [tab, canPayroll]);

  if (!isEvAdmin) {
    return (
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', fontWeight: 700, color: '#B91C1C' }}>
          <AlertTriangle size={17} /> Tài khoản của bạn không có quyền quản lý vận chuyển (EV_ADMIN_ROLES).
        </div>
      </Card>
    );
  }

  const TABS: Array<{ id: SubTab; label: string; icon: any }> = [
    { id: 'map', label: 'Live Map', icon: MapPin },
    { id: 'fleet', label: 'Xe & Lộ trình', icon: Truck },
    { id: 'shifts', label: 'Ca vận chuyển', icon: CalendarClock },
    { id: 'charging', label: 'Phiếu sạc', icon: BatteryCharging },
    // Lương tài xế: chỉ FINANCE (Kế toán) — các vai trò khác không thấy tab này.
    ...(canPayroll ? [{ id: 'payroll' as SubTab, label: 'Lương tài xế', icon: Wallet }] : []),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: '19px', fontWeight: 900, margin: 0, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '9px' }}>
            <Truck size={21} color="#0F766E" /> Vận chuyển sữa — Quản lý tài xế & định vị GPS
          </h1>
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: '4px 0 0', fontWeight: 600 }}>
            Live Map realtime • SLA + phạt tự động • phiếu sạc duyệt 2 cấp • phân ca tài xế • bảng lương theo kỳ
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', borderBottom: `1px solid ${BORDER}`, paddingBottom: '10px' }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '7px',
                padding: '8px 15px', borderRadius: '999px', fontSize: '12.5px', fontWeight: 800, cursor: 'pointer',
                border: active ? '1.5px solid #0F766E' : `1px solid ${BORDER}`,
                backgroundColor: active ? '#F0FDFA' : 'var(--surface)',
                color: active ? '#0F766E' : 'var(--text-muted)',
              }}>
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'map' && <LiveMapView showToast={showToast} />}
      {tab === 'fleet' && <FleetView allEmployees={allEmployees} showToast={showToast} canManage={canManage} />}
      {tab === 'shifts' && <ShiftsView allEmployees={allEmployees} showToast={showToast} canManage={canManage} />}
      {tab === 'charging' && <ChargingView showToast={showToast} canHr={canHr} canDirector={canDirector} allEmployees={allEmployees} />}
      {tab === 'payroll' && canPayroll && <PayrollView allEmployees={allEmployees} showToast={showToast} canManage={canPayroll} />}
    </div>
  );
};
