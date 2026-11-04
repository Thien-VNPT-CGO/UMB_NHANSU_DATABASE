import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, RefreshCw, Users, AlertTriangle, CheckCircle2, Clock, Wifi, WifiOff } from 'lucide-react';
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
  last_gps_at?: string;
  note?: string;
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
  };
}

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

/** Tooltip khi rê chuột: Tên + mã NV + ca làm + giờ check-in/out (realtime). */
function tooltipHtml(emp: LiveMapEmployee): string {
  const meta = STATUS_META[emp.status];
  const shiftRows = (emp.shifts || []).map(s => {
    const sMeta = STATUS_META[s.status];
    return `
      <div class="ubm-map-tt-shift">
        <div class="ubm-map-tt-shift-head">
          <span>${escapeHtml(s.shift_label || s.shift_code || 'Ca làm')}</span>
          <span class="ubm-map-tt-chip" style="color:${sMeta.color};background:${sMeta.bg};border-color:${sMeta.border}">${sMeta.label}</span>
        </div>
        <div class="ubm-map-tt-line">⏱️ Ca: <b>${fmtRange(s.start_at, s.end_at)}</b></div>
        <div class="ubm-map-tt-line">🟢 Check-in: <b>${fmtTime(s.check_in_at)}</b></div>
        <div class="ubm-map-tt-line">🔵 Check-out: <b>${fmtTime(s.check_out_at)}</b></div>
        ${s.note ? `<div class="ubm-map-tt-note">⚠️ ${escapeHtml(s.note)}</div>` : ''}
      </div>`;
  }).join('');

  const placeLine = emp.gps_source === 'BRANCH'
    ? '<div class="ubm-map-tt-line">🏬 Vị trí: <b>chưa có GPS thiết bị</b> — hiển thị tại toạ độ cửa hàng</div>'
    : (emp.at_branch
      ? '<div class="ubm-map-tt-line">🏬 Vị trí: <b style="color:#6EE7B7">Đang ở cửa hàng</b> (trong bán kính cho phép)</div>'
      : '<div class="ubm-map-tt-line">🚶 Vị trí: <b style="color:#FCA5A5">Ngoài cửa hàng</b> — không có mặt tại điểm làm việc</div>');

  const gpsLine = emp.gps_source === 'BRANCH'
    ? '<div class="ubm-map-tt-line">📍 Toạ độ: <b>toạ độ cửa hàng</b> (chưa có GPS chấm công)</div>'
    : `<div class="ubm-map-tt-line">📍 GPS ${emp.gps_source === 'LIVE' ? 'trực tiếp (realtime)' : emp.gps_source === 'CHECK_OUT' ? 'check-out' : 'check-in'}:
        <b>${Number(emp.latitude).toFixed(6)}, ${Number(emp.longitude).toFixed(6)}</b></div>
       <div class="ubm-map-tt-line">🎯 Cách cửa hàng: <b>${Number(emp.distance_meters || 0).toLocaleString('vi-VN')} m</b>
        ${emp.radius_meters ? ` / bán kính ${Number(emp.radius_meters).toLocaleString('vi-VN')} m` : ''}
        ${emp.gps_accuracy ? ` • sai số ±${Math.round(Number(emp.gps_accuracy))} m` : ''}
        ${emp.gps_status && emp.gps_status !== 'VALID' ? ` • <span style="color:#FCA5A5">${escapeHtml(emp.gps_status)}</span>` : ''}</div>
       <div class="ubm-map-tt-line">🕒 Cập nhật GPS: <b>${timeAgo(emp.last_gps_at)}</b></div>`;

  return `
    <div class="ubm-map-tt">
      <div class="ubm-map-tt-title">${escapeHtml(emp.full_name)}</div>
      <div class="ubm-map-tt-sub">${escapeHtml(emp.employee_code)} • ${escapeHtml(emp.branch_name)}</div>
      <div class="ubm-map-tt-status" style="color:${meta.color};background:${meta.bg};border-color:${meta.border}">
        ${meta.label}${emp.note ? ` — ${escapeHtml(emp.note)}` : ''}
      </div>
      ${shiftRows || '<div class="ubm-map-tt-line">Hôm nay không có ca làm</div>'}
      ${placeLine}
      ${gpsLine}
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
  const [placeFilter, setPlaceFilter] = useState<'ALL' | 'AT_STORE' | 'OUTSIDE'>('ALL');
  const [autoRefresh, setAutoRefresh] = useState(true);

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

  const employees = useMemo(() => {
    const list = data?.employees || [];
    return list.filter(e =>
      (branchFilter === '*' || e.branch_id === branchFilter)
      && (statusFilter === 'ALL' || e.status === statusFilter)
      // Lọc theo vị trí: chỉ NV có GPS thật (đang ở cửa hàng / ở ngoài).
      && (placeFilter === 'ALL'
        || (placeFilter === 'AT_STORE' && e.gps_source !== 'BRANCH' && e.at_branch === true)
        || (placeFilter === 'OUTSIDE' && e.gps_source !== 'BRANCH' && e.at_branch !== true))
    );
  }, [data, branchFilter, statusFilter, placeFilter]);

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
        const marker = L.marker([lat, lng], {
          icon: L.divIcon({
            className: 'ubm-map-marker',
            html: `<div class="ubm-map-dot ubm-map-dot--${emp.status.toLowerCase()}${outside ? ' ubm-map-dot--outside' : ''}" style="--dot-color:${meta.color}"></div>`,
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
  }, [data, employees, branchFilter]);

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
          <Wifi size={16} /> <span>Có GPS</span> <b>{summary?.with_gps ?? 0}</b>
        </div>
        <div className="ubm-map-stat ubm-map-stat--at-store">
          <span aria-hidden>🏬</span> <span>Tại cửa hàng</span> <b>{summary?.at_store ?? 0}</b>
        </div>
        <div className="ubm-map-stat ubm-map-stat--outside">
          <span aria-hidden>🚶</span> <span>Ngoài cửa hàng</span> <b>{summary?.outside ?? 0}</b>
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
          <select
            value={placeFilter}
            onChange={e => setPlaceFilter(e.target.value as 'ALL' | 'AT_STORE' | 'OUTSIDE')}
            className="ubm-map-select"
            title="Lọc theo vị trí so với cửa hàng"
          >
            <option value="ALL">Mọi vị trí</option>
            <option value="AT_STORE">🏬 Đang ở cửa hàng</option>
            <option value="OUTSIDE">🚶 Ngoài cửa hàng</option>
          </select>
          <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="ubm-map-select">
            <option value="*">Tất cả cửa hàng</option>
            {(data?.branches || []).map(b => (
              <option key={b.id} value={b.id}>{b.name} ({b.id})</option>
            ))}
          </select>
          <span className="ubm-map-updated">Cập nhật: {lastUpdated ? fmtTime(new Date(lastUpdated).toISOString()) : '—'}</span>
        </div>
      </div>

      {error && (
        <div className="ubm-map-error">
          ⚠️ {error}
          <button className="ubm-map-btn" onClick={() => load()}>Thử lại</button>
        </div>
      )}

      <div className="ubm-map-canvas-wrap">
        <div ref={mapElRef} className="ubm-map-canvas" />
        {loading && !data && <div className="ubm-map-overlay">Đang tải bản đồ...</div>}
        {!loading && data && employees.length === 0 && (
          <div className="ubm-map-overlay ubm-map-overlay--soft">Không có nhân viên phù hợp bộ lọc.</div>
        )}
      </div>
      <div className="ubm-map-foot">
        Rê chuột vào điểm màu để xem <b>Tên NV + Mã NV + ca làm + giờ check-in/out</b> theo thời gian thực.
        Điểm vàng nhấp nháy = đang trong ca. Vị trí ưu tiên GPS trực tiếp từ cổng NV (cập nhật ~30 giây/lần),
        sau đó GPS lần chấm công gần nhất; nếu chưa có GPS sẽ hiển thị tại cửa hàng.
        Điểm có <b>viền cam nét đứt</b> = NV đang ở <b>ngoài cửa hàng</b> (ngoài bán kính cho phép);
        dùng ô <b>“Đang ở cửa hàng / Ngoài cửa hàng”</b> để lọc nhanh.
      </div>
    </div>
  );
};
