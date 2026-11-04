import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, RefreshCw, Users, AlertTriangle, CheckCircle2, Clock, Wifi, WifiOff, Bell, X, Search } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { apiRequest } from '../services/api';
import './live-map.css';

type LiveMapStatus = 'NORMAL' | 'WORKING' | 'COMPLETED' | 'MISSING';

interface LiveMapGps {
  latitude: number;
  longitude: number;
  accuracy?: number;
  gps_status?: string;
  distance_meters?: number;
  at: string;
}

interface LiveMapShift {
  assignment_id: string;
  shift_code: string;
  shift_label: string;
  start_at: string;
  end_at: string;
  status: LiveMapStatus;
  check_in_at?: string;
  check_out_at?: string;
  check_in_gps?: LiveMapGps;
  check_out_gps?: LiveMapGps;
  note?: string;
}

interface LiveMapEmployee {
  employee_id: string;
  employee_code: string;
  full_name: string;
  branch_id: string;
  branch_name: string;
  employment_status: string;
  status: LiveMapStatus;
  status_label: string;
  shifts: LiveMapShift[];
  primary_shift?: LiveMapShift;
  latitude: number;
  longitude: number;
  gps_source: 'LIVE' | 'CHECK_IN' | 'CHECK_OUT' | 'BRANCH';
  gps_status?: string;
  gps_accuracy?: number;
  distance_meters?: number;
  radius_meters?: number;
  /** Có GPS thật và đang nằm trong bán kính cửa hàng (đang làm việc tại cửa hàng). */
  at_branch?: boolean;
  /** Đang trong khung giờ chia sẻ GPS (trước vào ca 30p → sau tan ca 30p). */
  sharing_now?: boolean;
  /** Có ping GPS trực tiếp còn hiệu lực (thiết bị còn online). */
  live_online?: boolean;
  /** Đang trong ca nhưng mất tín hiệu GPS quá lâu. */
  gps_stale?: boolean;
  last_gps_at?: string;
  note?: string;
}

type LiveMapAlertType = 'GEOFENCE_EXIT' | 'GEOFENCE_RETURN' | 'GPS_STALE' | 'GPS_RESTORED' | 'GPS_SUSPICIOUS';

interface LiveMapAlert {
  type: LiveMapAlertType;
  severity: 'INFO' | 'WARNING';
  employee_id: string;
  employee_code: string;
  full_name: string;
  branch_id: string;
  branch_name: string;
  latitude: number;
  longitude: number;
  distance_meters?: number;
  radius_meters?: number;
  at: string;
  message: string;
}

interface LiveMapBranch {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  status: string;
  employees_total: number;
  employees_working: number;
  employees_missing: number;
}

interface LiveMapSnapshot {
  server_time: string;
  date: string;
  branches: LiveMapBranch[];
  employees: LiveMapEmployee[];
  summary: {
    total: number;
    normal: number;
    working: number;
    completed: number;
    missing: number;
    with_gps: number;
    at_store: number;
    outside: number;
    stale: number;
  };
}

const ALERT_META: Record<LiveMapAlertType, { label: string; icon: string; color: string }> = {
  GEOFENCE_EXIT: { label: 'Rời cửa hàng', icon: '🚶', color: '#B45309' },
  GEOFENCE_RETURN: { label: 'Đã quay lại', icon: '🏬', color: '#047857' },
  GPS_STALE: { label: 'Mất tín hiệu GPS', icon: '📵', color: '#B91C1C' },
  GPS_RESTORED: { label: 'Có tín hiệu lại', icon: '📶', color: '#047857' },
  GPS_SUSPICIOUS: { label: 'Nghi vấn GPS', icon: '🛑', color: '#B91C1C' },
};

const STATUS_META: Record<LiveMapStatus, { label: string; color: string; bg: string; border: string }> = {
  NORMAL: { label: 'Bình thường', color: '#475569', bg: '#F1F5F9', border: '#CBD5E1' },
  WORKING: { label: 'Đang làm việc', color: '#B45309', bg: '#FEF3C7', border: '#FCD34D' },
  COMPLETED: { label: 'Hoàn thành ca', color: '#047857', bg: '#D1FAE5', border: '#6EE7B7' },
  MISSING: { label: 'Thiếu check-in/out', color: '#B91C1C', bg: '#FEE2E2', border: '#FCA5A5' },
};

const escapeHtml = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function fmtTime(iso?: string): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
}

function fmtRange(start?: string, end?: string): string {
  return `${fmtTime(start)} – ${fmtTime(end)}`;
}

/** Khoảng cách (m) giữa 2 toạ độ — dùng khi cập nhật GPS realtime phía client. */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const rad = (v: number) => (v * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** Độ tươi vị trí dạng "vừa xong / 12s trước" — cập nhật mỗi giây (A3). */
function ageLabel(iso: string | undefined, nowMs: number): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 5) return 'vừa xong';
  if (s < 60) return `${s}s trước`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} phút trước`;
  return `${Math.floor(m / 60)} giờ trước`;
}

function timeAgo(iso?: string): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (mins < 1) return 'vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}

/** Tooltip khi rê chuột: thẻ gọn gàng nhưng đầy đủ (định danh, trạng thái, vị trí, GPS, ca làm). */
function tooltipHtml(emp: LiveMapEmployee): string {
  const meta = STATUS_META[emp.status];

  // Dòng vị trí (ưu tiên cảnh báo mất tín hiệu).
  const place = emp.gps_stale
    ? { icon: '📵', label: 'Mất tín hiệu GPS', cls: 'is-danger', hint: 'Thiết bị đang không gửi vị trí' }
    : emp.gps_source === 'BRANCH'
      ? { icon: '🏬', label: 'Chưa có GPS thiết bị', cls: 'is-muted', hint: 'Chưa từng gửi vị trí' }
      : emp.at_branch
        ? { icon: '🏬', label: 'Đang ở cửa hàng', cls: 'is-ok', hint: 'Trong bán kính cho phép' }
        : { icon: '🚶', label: 'Ngoài cửa hàng', cls: 'is-warn', hint: 'Không có mặt tại điểm làm việc' };

  const sourceLabel = emp.gps_source === 'LIVE' ? 'GPS trực tiếp'
    : emp.gps_source === 'CHECK_OUT' ? 'GPS lúc check-out'
      : emp.gps_source === 'CHECK_IN' ? 'GPS lúc check-in'
        : 'Toạ độ cửa hàng';
  const acc = emp.gps_accuracy ? `±${Math.round(Number(emp.gps_accuracy))} m` : '—';
  const initial = escapeHtml((emp.full_name || '?').trim().charAt(0).toUpperCase());

  const shiftRows = (emp.shifts || []).map(s => {
    const sMeta = STATUS_META[s.status];
    return `
      <div class="ubm-map-tt-shift">
        <div class="ubm-map-tt-shift-top">
          <span class="ubm-map-tt-shift-name">${escapeHtml(s.shift_label || s.shift_code || 'Ca làm')}</span>
          <span class="ubm-map-tt-badge ubm-map-tt-badge--sm" style="color:${sMeta.color};background:${sMeta.bg};border-color:${sMeta.border}">${sMeta.label}</span>
        </div>
        <div class="ubm-map-tt-times">
          <span class="t">⏱️ ${fmtRange(s.start_at, s.end_at)}</span>
          <span class="in">🟢 ${s.check_in_at ? fmtTime(s.check_in_at) : 'chưa vào'}</span>
          <span class="out">🔵 ${s.check_out_at ? fmtTime(s.check_out_at) : 'chưa ra'}</span>
        </div>
        ${s.note ? `<div class="ubm-map-tt-note">⚠️ ${escapeHtml(s.note)}</div>` : ''}
      </div>`;
  }).join('');

  return `
    <div class="ubm-map-tt">
      <div class="ubm-map-tt-head">
        <span class="ubm-map-tt-avatar" style="background:${meta.color}">${initial}</span>
        <div class="ubm-map-tt-ident">
          <div class="ubm-map-tt-name">${escapeHtml(emp.full_name)}</div>
          <div class="ubm-map-tt-meta">${escapeHtml(emp.employee_code)} • ${escapeHtml(emp.branch_name)}</div>
        </div>
      </div>

      <div class="ubm-map-tt-badge ubm-map-tt-badge--full" style="color:${meta.color};background:${meta.bg};border-color:${meta.border}">
        ${meta.label}${emp.note ? ` — ${escapeHtml(emp.note)}` : ''}
      </div>

      <div class="ubm-map-tt-place ${place.cls}">
        <span class="ico">${place.icon}</span>
        <span class="txt"><b>${place.label}</b> · ${place.hint}</span>
      </div>

      <div class="ubm-map-tt-grid">
        <div class="ubm-map-tt-cell"><span class="k">🛰️ Nguồn</span><span class="v">${escapeHtml(sourceLabel)}</span></div>
        <div class="ubm-map-tt-cell"><span class="k">🕒 Cập nhật</span><span class="v">${timeAgo(emp.last_gps_at)}</span></div>
        <div class="ubm-map-tt-cell"><span class="k">🎯 Cách cửa hàng</span><span class="v">${Number(emp.distance_meters || 0).toLocaleString('vi-VN')} m${emp.radius_meters ? ` <small>/ ${Number(emp.radius_meters).toLocaleString('vi-VN')} m</small>` : ''}</span></div>
        <div class="ubm-map-tt-cell"><span class="k">📐 Sai số</span><span class="v">${acc}${emp.gps_status && emp.gps_status !== 'VALID' ? ` <small class="is-danger">${escapeHtml(emp.gps_status)}</small>` : ''}</span></div>
        <div class="ubm-map-tt-cell ubm-map-tt-cell--full"><span class="k">📌 Toạ độ</span><span class="v mono">${Number(emp.latitude).toFixed(6)}, ${Number(emp.longitude).toFixed(6)}</span></div>
      </div>

      <div class="ubm-map-tt-sec">Ca làm hôm nay</div>
      ${shiftRows || '<div class="ubm-map-tt-empty">Hôm nay không có ca làm</div>'}
    </div>`;
}

export interface LiveMapViewProps {
  currentUserRole?: string;
}

export const LiveMapView: React.FC<LiveMapViewProps> = ({ currentUserRole }) => {
  const [data, setData] = useState<LiveMapSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number>(0);
  const [branchFilter, setBranchFilter] = useState<string>('*');
  const [statusFilter, setStatusFilter] = useState<'ALL' | LiveMapStatus>('ALL');
  const [placeFilter, setPlaceFilter] = useState<'ALL' | 'AT_STORE' | 'OUTSIDE' | 'STALE'>('ALL');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [alerts, setAlerts] = useState<LiveMapAlert[]>([]);
  const [alertsOpen, setAlertsOpen] = useState(true);
  // Nhịp 1 giây để đồng hồ "cập nhật cách đây Ns" chạy mượt (A3).
  const [nowTick, setNowTick] = useState(() => Date.now());
  // NV đang được chọn (bấm từ danh sách/marker) để tô sáng + zoom (A4).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  // B1/B2: lịch sử hành trình + báo cáo trong/ngoài cửa hàng.
  const [historyDate, setHistoryDate] = useState<string>(() => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10));
  const [trail, setTrail] = useState<any | null>(null);
  const [trailBusy, setTrailBusy] = useState(false);
  const [reportRows, setReportRows] = useState<any[] | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const trailLayerRef = useRef<L.LayerGroup | null>(null);

  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef(false);
  const inFlightRef = useRef(false);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!opts?.silent) setLoading(true);
    try {
      const res = await apiRequest<LiveMapSnapshot>('/admin/live-map');
      setData(res);
      setError(null);
      setLastUpdated(Date.now());
    } catch (e: any) {
      setError(e?.message || 'Không tải được dữ liệu bản đồ');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  // Tải lần đầu + tự làm mới mỗi 30s (trạng thái ca đổi theo giờ dù không có sự kiện).
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => load({ silent: true }), 30_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, load]);

  // A3: nhịp 1 giây cho đồng hồ độ tươi vị trí.
  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Realtime: backend bắn data:updated(attendance/schedules/config) → App phát event này.
  useEffect(() => {
    let timer: number | null = null;
    const onReload = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => load({ silent: true }), 800);
    };
    window.addEventListener('ubm:live-map-reload', onReload);
    return () => {
      window.removeEventListener('ubm:live-map-reload', onReload);
      if (timer) window.clearTimeout(timer);
    };
  }, [load]);

  // GPS trực tiếp từ cổng NV (Socket.IO -> App phát event): cập nhật toạ độ
  // marker ngay, không cần tải lại toàn bộ snapshot.
  useEffect(() => {
    const onLive = (ev: Event) => {
      const p: any = (ev as CustomEvent).detail;
      const id = String(p?.employee_id || '');
      const lat = Number(p?.latitude);
      const lng = Number(p?.longitude);
      if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
      setData(prev => {
        if (!prev) return prev;
        let changed = false;
        const employees = prev.employees.map(e => {
          if (e.employee_id !== id) return e;
          changed = true;
          const branch = prev.branches.find(b => b.id === e.branch_id);
          const distance = branch
            ? haversineMeters(lat, lng, Number(branch.latitude), Number(branch.longitude))
            : e.distance_meters;
          const radius = Number(branch?.radius_meters) || Number(e.radius_meters) || 300;
          return {
            ...e,
            latitude: lat,
            longitude: lng,
            gps_source: 'LIVE' as const,
            gps_status: 'VALID',
            gps_accuracy: Number.isFinite(Number(p?.accuracy)) ? Number(p.accuracy) : e.gps_accuracy,
            distance_meters: distance,
            radius_meters: radius,
            at_branch: Number(distance) <= radius,
            live_online: true,
            gps_stale: false,
            last_gps_at: String(p?.at || new Date().toISOString()),
          };
        });
        return changed ? { ...prev, employees } : prev;
      });
      setLastUpdated(Date.now());
    };
    window.addEventListener('ubm:live-location', onLive);
    return () => window.removeEventListener('ubm:live-location', onLive);
  }, []);

  // A1/A2: cảnh báo realtime (rời cửa hàng / mất tín hiệu) → banner + danh sách.
  useEffect(() => {
    const onAlert = (ev: Event) => {
      const a = (ev as CustomEvent).detail as LiveMapAlert;
      if (!a || !a.type) return;
      setAlerts(prev => [a, ...prev].slice(0, 40));
      setAlertsOpen(true);
    };
    window.addEventListener('ubm:live-map-alert', onAlert);
    return () => window.removeEventListener('ubm:live-map-alert', onAlert);
  }, []);

  const employees = useMemo(() => {
    const list = data?.employees || [];
    const q = searchText.trim().toLowerCase();
    return list.filter(e =>
      // KHÔNG hiển thị NV chỉ có "toạ độ cửa hàng" (GPS gán cứng) — bản đồ chỉ
      // vẽ NV thực sự có GPS thật (live hoặc từ phiên chấm công).
      e.gps_source !== 'BRANCH'
      && (branchFilter === '*' || e.branch_id === branchFilter)
      && (statusFilter === 'ALL' || e.status === statusFilter)
      // Lọc theo vị trí: đang ở cửa hàng / ở ngoài / mất tín hiệu.
      && (placeFilter === 'ALL'
        || (placeFilter === 'AT_STORE' && e.at_branch === true)
        || (placeFilter === 'OUTSIDE' && e.at_branch !== true)
        || (placeFilter === 'STALE' && e.gps_stale === true))
      && (!q
        || String(e.full_name || '').toLowerCase().includes(q)
        || String(e.employee_code || '').toLowerCase().includes(q))
    );
  }, [data, branchFilter, statusFilter, placeFilter, searchText]);

  // Khởi tạo bản đồ 1 lần.
  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;
    const map = L.map(mapElRef.current, {
      center: [10.78, 106.7],
      zoom: 13,
      zoomControl: true,
      preferCanvas: false,
    });
    // Nền bản đồ Google Maps (không cần API key). Nếu Google chặn tile, tự
    // chuyển sang OpenStreetMap để bản đồ không bao giờ trắng.
    let usingGoogle = true;
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    });
    const googleLayer = L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'],
      maxZoom: 20,
      attribution: '&copy; Google Maps',
    });
    googleLayer.once('tileerror', () => {
      if (!usingGoogle) return;
      usingGoogle = false;
      try { map.removeLayer(googleLayer); } catch { /* non-fatal */ }
      osmLayer.addTo(map);
    });
    googleLayer.addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // iOS/Chrome đôi khi render sai kích thước khi tab vừa hiện.
    window.setTimeout(() => map.invalidateSize(), 120);
    return () => {
      try { map.remove(); } catch { /* non-fatal */ }
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Vẽ lại marker mỗi khi dữ liệu/bộ lọc đổi.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer || !data) return;
    layer.clearLayers();

    const branchIds = new Set(employees.map(e => e.branch_id));

    // Cửa hàng: vòng bán kính + nhãn tên.
    for (const b of data.branches || []) {
      if (branchFilter !== '*' && b.id !== branchFilter) continue;
      if (branchFilter === '*' && employees.length > 0 && !branchIds.has(b.id)) continue;
      const radius = Number(b.radius_meters) || 300;
      L.circle([b.latitude, b.longitude], {
        radius,
        color: '#7C3AED',
        weight: 1.5,
        opacity: 0.55,
        fillColor: '#7C3AED',
        fillOpacity: 0.06,
        interactive: false,
      }).addTo(layer);
      L.marker([b.latitude, b.longitude], {
        icon: L.divIcon({
          className: 'ubm-map-branch-icon',
          html: `<div class="ubm-map-branch-pin">🏬</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
        interactive: true,
        keyboard: false,
      })
        .bindTooltip(
          `<b>${escapeHtml(b.name)}</b><br/>${escapeHtml(b.address)}<br/>` +
          `👥 ${b.employees_total} NV • 🟡 ${b.employees_working} đang làm • 🔴 ${b.employees_missing} thiếu chấm`,
          { direction: 'top', offset: [0, -10], opacity: 1, className: 'ubm-map-tooltip ubm-map-tooltip--branch' }
        )
        .addTo(layer);
    }

    // Gom các NV trùng toạ độ để tách điểm (tránh chồng marker).
    const groups = new Map<string, LiveMapEmployee[]>();
    for (const e of employees) {
      const key = `${Number(e.latitude).toFixed(5)},${Number(e.longitude).toFixed(5)}`;
      const arr = groups.get(key) || [];
      arr.push(e);
      groups.set(key, arr);
    }

    const points: Array<[number, number]> = [];
    for (const [, list] of groups) {
      const n = list.length;
      list.forEach((emp, idx) => {
        let lat = Number(emp.latitude);
        let lng = Number(emp.longitude);
        if (n > 1) {
          const angle = (2 * Math.PI * idx) / n - Math.PI / 2;
          const ring = 0.00009 + Math.floor(idx / 8) * 0.00005;
          lat += Math.sin(angle) * ring;
          lng += Math.cos(angle) * ring;
        }
        points.push([lat, lng]);
        const meta = STATUS_META[emp.status];
        const outside = emp.gps_source !== 'BRANCH' && emp.at_branch !== true;
        const stale = emp.gps_stale === true;
        const selected = emp.employee_id === selectedIdRef.current;
        const marker = L.marker([lat, lng], {
          icon: L.divIcon({
            className: 'ubm-map-marker',
            html: `<div class="ubm-map-dot ubm-map-dot--${emp.status.toLowerCase()}${outside ? ' ubm-map-dot--outside' : ''}${stale ? ' ubm-map-dot--stale' : ''}${selected ? ' ubm-map-dot--selected' : ''}" style="--dot-color:${meta.color}"></div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          }),
          riseOnHover: true,
          keyboard: false,
        });
        marker.bindTooltip(tooltipHtml(emp), {
          direction: 'top',
          offset: [0, -10],
          opacity: 1,
          className: 'ubm-map-tooltip',
          sticky: false,
        });
        marker.on('click', () => setSelectedId(emp.employee_id));
        marker.addTo(layer);
      });
    }

    if (!fittedRef.current && points.length > 0) {
      fittedRef.current = true;
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds.pad(0.25), { maxZoom: 16 });
      // Chỉ 1 cửa hàng/1 điểm thì fitBounds sẽ zoom quá sâu — kẹp lại mức hợp lý.
      window.setTimeout(() => {
        if (map.getZoom() > 16) map.setZoom(16);
        map.invalidateSize();
      }, 60);
    }
    map.invalidateSize();
  }, [data, employees, branchFilter, selectedId]);

  // A4: zoom tới NV được chọn từ danh sách bên trái.
  const focusEmployee = useCallback((emp: LiveMapEmployee) => {
    setSelectedId(emp.employee_id);
    const map = mapRef.current;
    if (!map) return;
    const lat = Number(emp.latitude);
    const lng = Number(emp.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    try {
      map.flyTo([lat, lng], Math.max(map.getZoom(), 16), { duration: 0.6 });
    } catch { /* non-fatal */ }
  }, []);

  // B1: tải vết hành trình 1 NV trong ngày.
  const loadTrail = useCallback(async (employeeId: string | null) => {
    if (!employeeId) { setError('Chọn 1 nhân viên ở danh sách bên trái để xem hành trình.'); return; }
    setTrailBusy(true);
    try {
      const res = await apiRequest<any>(`/admin/live-map/trail?employeeId=${encodeURIComponent(employeeId)}&date=${encodeURIComponent(historyDate)}`);
      setTrail(res);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Không tải được hành trình');
    } finally {
      setTrailBusy(false);
    }
  }, [historyDate]);

  // B2: tải báo cáo thời gian trong/ngoài cửa hàng theo ngày.
  const loadReport = useCallback(async () => {
    setTrailBusy(true);
    try {
      const res = await apiRequest<any>(`/admin/live-map/location-report?date=${encodeURIComponent(historyDate)}`);
      setReportRows(Array.isArray(res?.rows) ? res.rows : []);
      setReportOpen(true);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Không tải được báo cáo');
    } finally {
      setTrailBusy(false);
    }
  }, [historyDate]);

  // Vẽ đường hành trình lên lớp riêng (không bị xoá khi marker realtime vẽ lại).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!trailLayerRef.current) trailLayerRef.current = L.layerGroup().addTo(map);
    const layer = trailLayerRef.current;
    layer.clearLayers();
    const pts: any[] = Array.isArray(trail?.points) ? trail.points : [];
    if (pts.length === 0) return;
    const latlngs = pts
      .map(p => [Number(p.latitude), Number(p.longitude)] as [number, number])
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
    if (latlngs.length === 0) return;
    if (trail?.center) {
      L.circle([Number(trail.center.lat), Number(trail.center.lng)], {
        radius: Number(trail.center.radius) || 300,
        color: '#2563EB', weight: 1.5, opacity: 0.6, fillColor: '#2563EB', fillOpacity: 0.05,
        interactive: false,
      }).addTo(layer);
    }
    if (latlngs.length > 1) {
      L.polyline(latlngs, { color: '#2563EB', weight: 4, opacity: 0.85 }).addTo(layer);
    }
    const pin = (label: string, cls: string) => L.divIcon({
      className: 'ubm-trail-pin-icon',
      html: `<div class="ubm-trail-pin ${cls}">${label}</div>`,
      iconSize: [22, 22], iconAnchor: [11, 11],
    });
    L.marker(latlngs[0], { icon: pin('A', 'ubm-trail-pin--start'), keyboard: false }).addTo(layer)
      .bindTooltip(`Bắt đầu • ${fmtTime(trail?.summary?.first_at)}`, { direction: 'top', offset: [0, -10], opacity: 1, className: 'ubm-map-tooltip' });
    L.marker(latlngs[latlngs.length - 1], { icon: pin('B', 'ubm-trail-pin--end'), keyboard: false }).addTo(layer)
      .bindTooltip(`Kết thúc • ${fmtTime(trail?.summary?.last_at)}`, { direction: 'top', offset: [0, -10], opacity: 1, className: 'ubm-map-tooltip' });
    try {
      map.fitBounds(L.latLngBounds(latlngs).pad(0.2), { maxZoom: 17 });
    } catch { /* non-fatal */ }
  }, [trail]);

  const summary = data?.summary;
  const roleLabel = currentUserRole === 'FINANCE' ? 'Kế toán' : currentUserRole === 'HR' ? 'HR' : 'Giám đốc';

  return (
    <div className="ubm-map-shell">
      <div className="ubm-map-head">
        <div>
          <h1 className="ubm-map-title">
            <MapPin size={20} /> Bản Đồ GPS Nhân Viên Realtime
          </h1>
          <p className="ubm-map-sub">
            Giám sát nhân viên tại các cửa hàng đã cấu hình toạ độ • Quyền xem: {roleLabel} • Ngày{' '}
            <b>{data?.date || '—'}</b>
          </p>
        </div>
        <div className="ubm-map-head-actions">
          <label className="ubm-map-switch" title="Tự làm mới mỗi 30 giây">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            {autoRefresh ? <Wifi size={14} /> : <WifiOff size={14} />} Realtime
          </label>
          <button className="ubm-map-btn" onClick={() => load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {loading ? 'Đang tải...' : 'Làm mới'}
          </button>
        </div>
      </div>

      <div className="ubm-map-stats">
        <div className="ubm-map-stat">
          <Users size={16} /> <span>Tổng NV</span> <b>{summary?.total ?? 0}</b>
        </div>
        <div className="ubm-map-stat ubm-map-stat--working">
          <Clock size={16} /> <span>Đang làm</span> <b>{summary?.working ?? 0}</b>
        </div>
        <div className="ubm-map-stat ubm-map-stat--completed">
          <CheckCircle2 size={16} /> <span>Hoàn thành ca</span> <b>{summary?.completed ?? 0}</b>
        </div>
        <div className="ubm-map-stat ubm-map-stat--missing">
          <AlertTriangle size={16} /> <span>Thiếu chấm công</span> <b>{summary?.missing ?? 0}</b>
        </div>
        <div className="ubm-map-stat ubm-map-stat--normal">
          <MapPin size={16} /> <span>Bình thường</span> <b>{summary?.normal ?? 0}</b>
        </div>
        <div className="ubm-map-stat">
          <Wifi size={16} /> <span>Có GPS thật</span> <b>{summary?.with_gps ?? 0}</b>
        </div>
        <div className="ubm-map-stat ubm-map-stat--normal">
          <span aria-hidden>🛰️</span> <span>Chưa gửi GPS</span>{' '}
          <b>{Math.max(0, (summary?.total ?? 0) - (summary?.with_gps ?? 0))}</b>
        </div>
        <div className="ubm-map-stat ubm-map-stat--at-store">
          <span aria-hidden>🏬</span> <span>Tại cửa hàng</span> <b>{summary?.at_store ?? 0}</b>
        </div>
        <div className="ubm-map-stat ubm-map-stat--outside">
          <span aria-hidden>🚶</span> <span>Ngoài cửa hàng</span> <b>{summary?.outside ?? 0}</b>
        </div>
        <div className="ubm-map-stat ubm-map-stat--stale">
          <span aria-hidden>📵</span> <span>Mất tín hiệu</span> <b>{summary?.stale ?? 0}</b>
        </div>
      </div>

      <div className="ubm-map-toolbar">
        <div className="ubm-map-legend">
          {(Object.keys(STATUS_META) as LiveMapStatus[]).map(k => (
            <button
              key={k}
              type="button"
              className={`ubm-map-legend-item${statusFilter === k ? ' is-active' : ''}`}
              onClick={() => setStatusFilter(prev => (prev === k ? 'ALL' : k))}
              title={`Lọc: ${STATUS_META[k].label}`}
            >
              <span className={`ubm-map-dot ubm-map-dot--${k.toLowerCase()}`} style={{ '--dot-color': STATUS_META[k].color } as React.CSSProperties} />
              {STATUS_META[k].label}
            </button>
          ))}
          {statusFilter !== 'ALL' && (
            <button type="button" className="ubm-map-clear" onClick={() => setStatusFilter('ALL')}>Bỏ lọc</button>
          )}
        </div>
        <div className="ubm-map-toolbar-right">
          <label className="ubm-map-search">
            <Search size={14} />
            <input
              type="text"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder="Tìm tên / mã NV…"
            />
            {searchText && (
              <button type="button" onClick={() => setSearchText('')} title="Xóa tìm kiếm"><X size={13} /></button>
            )}
          </label>
          <select
            value={placeFilter}
            onChange={e => setPlaceFilter(e.target.value as 'ALL' | 'AT_STORE' | 'OUTSIDE' | 'STALE')}
            className="ubm-map-select"
            title="Lọc theo vị trí so với cửa hàng"
          >
            <option value="ALL">Mọi vị trí</option>
            <option value="AT_STORE">🏬 Đang ở cửa hàng</option>
            <option value="OUTSIDE">🚶 Ngoài cửa hàng</option>
            <option value="STALE">📵 Mất tín hiệu GPS</option>
          </select>
          <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="ubm-map-select">
            <option value="*">Tất cả cửa hàng</option>
            {(data?.branches || []).map(b => (
              <option key={b.id} value={b.id}>{b.name} ({b.id})</option>
            ))}
          </select>
          <span className="ubm-map-updated">
            Cập nhật: <b>{lastUpdated ? ageLabel(new Date(lastUpdated).toISOString(), nowTick) : '—'}</b>
          </span>
        </div>
      </div>

      {/* B1/B2: hành trình + báo cáo vị trí theo ngày */}
      <div className="ubm-map-history">
        <label className="ubm-map-history-date">
          Ngày
          <input
            type="date"
            value={historyDate}
            max={new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)}
            onChange={e => { setHistoryDate(e.target.value); setTrail(null); setReportRows(null); setReportOpen(false); }}
          />
        </label>
        <button type="button" className="ubm-map-btn" disabled={trailBusy}
          onClick={() => loadTrail(selectedId)} title="Xem đường đi của NV đang chọn trong ngày">
          🧭 Hành trình NV đang chọn
        </button>
        <button type="button" className="ubm-map-btn" disabled={trailBusy} onClick={loadReport}>
          📊 Báo cáo trong/ngoài cửa hàng
        </button>
        {trail && (
          <button type="button" className="ubm-map-clear" onClick={() => setTrail(null)}>Ẩn hành trình</button>
        )}
        {trail && trail.summary && (
          <span className="ubm-map-history-sum">
            <b>{trail.full_name || trail.employee_id}</b> • {trail.summary.points} điểm
            • 🚗 {Number(trail.summary.distance_meters || 0).toLocaleString('vi-VN')} m
            • 🏬 {trail.summary.inside_minutes} phút trong
            • 🚶 {trail.summary.outside_minutes} phút ngoài
            {trail.summary.first_at ? ` • ${fmtTime(trail.summary.first_at)}–${fmtTime(trail.summary.last_at)}` : ''}
          </span>
        )}
      </div>

      {reportOpen && reportRows && (
        <div className="ubm-map-report">
          <div className="ubm-map-report-head">
            <b>Báo cáo vị trí ngày {historyDate}</b> — {reportRows.length} NV có dữ liệu
            <button type="button" className="ubm-map-alerts-clear" onClick={() => { setReportOpen(false); setReportRows(null); }}>Đóng</button>
          </div>
          {reportRows.length === 0
            ? <div className="ubm-map-report-empty">Chưa có vết GPS cho ngày này.</div>
            : (
              <div className="ubm-map-report-scroll">
                <table className="ubm-map-report-table">
                  <thead>
                    <tr>
                      <th>Nhân viên</th><th>Chi nhánh</th><th>Điểm</th><th>Trong CH</th>
                      <th>Ngoài CH</th><th>Quãng đường</th><th>Bắt đầu</th><th>Kết thúc</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportRows.map(r => (
                      <tr key={r.employee_id}>
                        <td>{r.full_name || r.employee_id}<small> {r.employee_code}</small></td>
                        <td>{r.branch_name}</td>
                        <td>{r.points}</td>
                        <td className="is-in">{r.inside_minutes} phút</td>
                        <td className="is-out">{r.outside_minutes} phút</td>
                        <td>{Number(r.distance_meters || 0).toLocaleString('vi-VN')} m</td>
                        <td>{fmtTime(r.first_at)}</td>
                        <td>{fmtTime(r.last_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}

      {error && (
        <div className="ubm-map-error">
          ⚠️ {error}
          <button className="ubm-map-btn" onClick={() => load()}>Thử lại</button>
        </div>
      )}

      {alerts.length > 0 && (
        <div className="ubm-map-alerts">
          <div className="ubm-map-alerts-head">
            <button type="button" className="ubm-map-alerts-toggle" onClick={() => setAlertsOpen(v => !v)}>
              <Bell size={15} /> {alerts.length} cảnh báo bản đồ {alertsOpen ? '▾' : '▸'}
            </button>
            <button type="button" className="ubm-map-alerts-clear" onClick={() => setAlerts([])}>Xóa hết</button>
          </div>
          {alertsOpen && (
            <ul className="ubm-map-alerts-list">
              {alerts.slice(0, 8).map((a, i) => (
                <li key={`${a.employee_id}-${a.type}-${a.at}-${i}`} className={`ubm-map-alert ubm-map-alert--${a.severity.toLowerCase()}`}>
                  <span className="ubm-map-alert-ico" style={{ color: ALERT_META[a.type]?.color }}>{ALERT_META[a.type]?.icon || '⚠️'}</span>
                  <span className="ubm-map-alert-txt">{a.message}</span>
                  <span className="ubm-map-alert-time">{ageLabel(a.at, nowTick)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="ubm-map-body">
        <aside className="ubm-map-list">
          <div className="ubm-map-list-head">{employees.length} NV hiển thị</div>
          <ul>
            {employees.map(e => (
              <li
                key={e.employee_id}
                className={`ubm-map-list-item${e.employee_id === selectedId ? ' is-selected' : ''}`}
                onClick={() => focusEmployee(e)}
              >
                <span
                  className={`ubm-map-dot ubm-map-dot--${e.status.toLowerCase()}${e.gps_source !== 'BRANCH' && e.at_branch !== true ? ' ubm-map-dot--outside' : ''}${e.gps_stale ? ' ubm-map-dot--stale' : ''}`}
                  style={{ '--dot-color': STATUS_META[e.status].color } as React.CSSProperties}
                />
                <span className="ubm-map-list-name">
                  <b>{e.full_name}</b>
                  <small>{e.employee_code} • {e.branch_name}</small>
                </span>
                <span className="ubm-map-list-meta">
                  <em style={{ color: STATUS_META[e.status].color }}>{STATUS_META[e.status].label}</em>
                  {e.gps_stale
                    ? <small className="is-stale">📵 mất tín hiệu</small>
                    : e.gps_source !== 'BRANCH'
                      ? <small>{e.at_branch ? '🏬 tại cửa hàng' : `🚶 ${Number(e.distance_meters || 0).toLocaleString('vi-VN')} m`}</small>
                      : <small>chưa có GPS</small>}
                </span>
              </li>
            ))}
            {employees.length === 0 && <li className="ubm-map-list-empty">Không có NV phù hợp bộ lọc.</li>}
          </ul>
        </aside>

        <div className="ubm-map-canvas-wrap">
          <div ref={mapElRef} className="ubm-map-canvas" />
          {loading && !data && <div className="ubm-map-overlay">Đang tải bản đồ...</div>}
          {!loading && data && employees.length === 0 && (
            <div className="ubm-map-overlay ubm-map-overlay--soft">Không có nhân viên phù hợp bộ lọc.</div>
          )}
        </div>
      </div>
      <div className="ubm-map-foot">
        Rê chuột vào điểm màu để xem <b>Tên NV + Mã NV + ca làm + giờ check-in/out</b> theo thời gian thực.
        Điểm vàng nhấp nháy = đang trong ca. Bản đồ <b>chỉ vẽ vị trí GPS thật</b> của nhân viên (từ cổng NV
        hoặc lần chấm công gần nhất); <b>không còn hiển thị toạ độ cửa hàng thay thế</b> — NV chưa gửi GPS
        chỉ được đếm ở ô <b>“Chưa gửi GPS”</b> và không vẽ lên bản đồ.
        Điểm có <b>viền cam nét đứt</b> = đang ở <b>ngoài cửa hàng</b>; <b>viền xám nét đứt</b> = <b>mất tín hiệu GPS</b>.
        Bấm vào NV ở <b>danh sách bên trái</b> để zoom tới vị trí.
      </div>
    </div>
  );
};
