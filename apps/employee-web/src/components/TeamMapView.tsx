import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LocateFixed, RefreshCw, Users } from 'lucide-react';
import { apiRequest } from '../services/api';
import './team-map.css';

type TeamStatus = 'NORMAL' | 'WORKING' | 'COMPLETED' | 'MISSING';

interface TeamShift {
  assignment_id: string;
  shift_code: string;
  shift_label: string;
  start_at: string;
  end_at: string;
  status: TeamStatus;
  check_in_at?: string;
  check_out_at?: string;
  note?: string;
}

interface TeamEmployee {
  employee_id: string;
  employee_code: string;
  full_name: string;
  branch_id: string;
  branch_name: string;
  status: TeamStatus;
  status_label: string;
  shifts: TeamShift[];
  primary_shift?: TeamShift;
  latitude: number;
  longitude: number;
  gps_source: 'LIVE' | 'CHECK_IN' | 'CHECK_OUT' | 'BRANCH';
  last_gps_at?: string;
  note?: string;
}

interface TeamBranch {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
}

interface TeamSnapshot {
  server_time: string;
  date: string;
  me?: string;
  branches: TeamBranch[];
  employees: TeamEmployee[];
  summary: { total: number; normal: number; working: number; completed: number; missing: number; with_gps: number };
}

const STATUS_META: Record<TeamStatus, { label: string; color: string }> = {
  NORMAL: { label: 'Bình thường', color: '#94A3B8' },
  WORKING: { label: 'Đang làm việc', color: '#F59E0B' },
  COMPLETED: { label: 'Hoàn thành ca', color: '#22C55E' },
  MISSING: { label: 'Thiếu chấm công', color: '#EF4444' },
};

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
}

function timeAgo(iso?: string): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (mins < 1) return 'vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  return `${Math.floor(mins / 60)} giờ trước`;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const rad = (v: number) => (v * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function tooltipHtml(emp: TeamEmployee, isMe: boolean): string {
  const meta = STATUS_META[emp.status];
  const shiftRows = (emp.shifts || []).map(s => {
    const sm = STATUS_META[s.status];
    return `<div class="ubm-team-tt-row">
        <div class="ubm-team-tt-row-head"><b>${escapeHtml(s.shift_label || s.shift_code || 'Ca làm')}</b>
          <span style="color:${sm.color}">${sm.label}</span></div>
        <div class="ubm-team-tt-row-times">${fmtTime(s.start_at)} – ${fmtTime(s.end_at)}</div>
        <div class="ubm-team-tt-row-ci">✅ Vào: <b>${s.check_in_at ? fmtTime(s.check_in_at) : 'chưa'}</b>
          • ⏏️ Ra: <b>${s.check_out_at ? fmtTime(s.check_out_at) : 'chưa'}</b></div>
      </div>`;
  }).join('');

  return `<div class="ubm-team-tt">
      <div class="ubm-team-tt-title">${escapeHtml(emp.full_name)}${isMe ? ' <span class="ubm-team-tt-me">Bạn</span>' : ''}</div>
      <div class="ubm-team-tt-sub">${escapeHtml(emp.employee_code)} • ${escapeHtml(emp.branch_name)}</div>
      <div class="ubm-team-tt-status" style="color:${meta.color};border-color:${meta.color}">${meta.label}${emp.note ? ` — ${escapeHtml(emp.note)}` : ''}</div>
      ${shiftRows || '<div class="ubm-team-tt-row">Hôm nay không có ca làm</div>'}
      <div class="ubm-team-tt-gps">📍 ${emp.gps_source === 'LIVE'
        ? 'GPS trực tiếp (realtime)'
        : emp.gps_source === 'BRANCH' ? 'toạ độ cửa hàng' : `GPS lúc ${emp.gps_source === 'CHECK_OUT' ? 'check-out' : 'check-in'}`}
        • cập nhật ${timeAgo(emp.last_gps_at)}</div>
    </div>`;
}

export const TeamMapView: React.FC = () => {
  const [data, setData] = useState<TeamSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef(false);
  const inFlightRef = useRef(false);
  const dataRef = useRef<TeamSnapshot | null>(null);

  dataRef.current = data;

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!opts?.silent) setLoading(true);
    try {
      const res = await apiRequest<TeamSnapshot>('/employee/live-map');
      setData(res);
      setError(null);
      setLastUpdated(Date.now());
    } catch (e: any) {
      setError(e?.message || 'Không tải được bản đồ chi nhánh');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      load({ silent: true });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, load]);

  // Realtime từ App (Socket.IO): vị trí mới + tải lại khi có người bị khóa/mở khóa.
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
          return {
            ...e,
            latitude: lat,
            longitude: lng,
            gps_source: 'LIVE' as const,
            last_gps_at: String(p?.at || new Date().toISOString()),
          };
        });
        return changed ? { ...prev, employees } : prev;
      });
      setLastUpdated(Date.now());
    };
    let timer: number | null = null;
    const onReload = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => load({ silent: true }), 600);
    };
    window.addEventListener('ubm:team-location', onLive);
    window.addEventListener('ubm:team-map-reload', onReload);
    return () => {
      window.removeEventListener('ubm:team-location', onLive);
      window.removeEventListener('ubm:team-map-reload', onReload);
      if (timer) window.clearTimeout(timer);
    };
  }, [load]);

  const employees = data?.employees || [];
  const me = useMemo(() => employees.find(e => e.employee_id === data?.me), [employees, data?.me]);

  // Khởi tạo bản đồ 1 lần (Google Maps tile, fallback OpenStreetMap).
  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;
    const map = L.map(mapElRef.current, { center: [10.78, 106.7], zoom: 15, zoomControl: true });
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
    window.setTimeout(() => map.invalidateSize(), 120);
    return () => {
      try { map.remove(); } catch { /* non-fatal */ }
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Vẽ marker mỗi khi dữ liệu đổi.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer || !data) return;
    layer.clearLayers();

    const bounds: L.LatLngExpression[] = [];

    for (const b of data.branches || []) {
      const radius = Number(b.radius_meters) || 300;
      L.circle([b.latitude, b.longitude], {
        radius,
        color: '#7C3AED',
        weight: 1.5,
        opacity: 0.5,
        fillColor: '#7C3AED',
        fillOpacity: 0.05,
        interactive: false,
      }).addTo(layer);
      L.marker([b.latitude, b.longitude], {
        icon: L.divIcon({
          className: 'ubm-team-branch-icon',
          html: '<div class="ubm-team-branch-pin">🏬</div>',
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
        keyboard: false,
      })
        .bindTooltip(`<b>${escapeHtml(b.name)}</b><br/>${escapeHtml(b.address)}<br/>Bán kính ${radius} m`, {
          direction: 'top',
          offset: [0, -10],
          opacity: 1,
          className: 'ubm-team-tooltip',
        })
        .addTo(layer);
      bounds.push([b.latitude, b.longitude]);
    }

    // Nhóm nhân viên trùng toạ độ để tách điểm nhẹ, tránh chồng marker.
    const groups = new Map<string, TeamEmployee[]>();
    for (const e of employees) {
      const key = `${Number(e.latitude).toFixed(5)},${Number(e.longitude).toFixed(5)}`;
      const arr = groups.get(key) || [];
      arr.push(e);
      groups.set(key, arr);
    }
    for (const list of groups.values()) {
      const [lat0, lng0] = [Number(list[0].latitude), Number(list[0].longitude)];
      list.forEach((e, idx) => {
        const isMe = e.employee_id === data.me;
        const meta = STATUS_META[e.status];
        const offset = list.length > 1 && !isMe ? 0.000045 : 0;
        const angle = (idx / Math.max(1, list.length)) * Math.PI * 2;
        const lat = lat0 + Math.sin(angle) * offset;
        const lng = lng0 + Math.cos(angle) * offset;
        const marker = L.marker([lat, lng], {
          icon: L.divIcon({
            className: 'ubm-team-marker',
            html: `<div class="ubm-team-dot ubm-team-dot--${e.status.toLowerCase()}${isMe ? ' ubm-team-dot--me' : ''}">
                     <span class="ubm-team-dot-core" style="background:${meta.color}"></span>
                   </div>${isMe ? '<span class="ubm-team-me-label">Bạn</span>' : ''}`,
            iconSize: isMe ? [26, 26] : [22, 22],
            iconAnchor: isMe ? [13, 13] : [11, 11],
          }),
          zIndexOffset: isMe ? 1000 : 0,
          keyboard: false,
        });
        marker.bindTooltip(tooltipHtml(e, isMe), {
          direction: 'top',
          offset: [0, -12],
          opacity: 1,
          className: 'ubm-team-tooltip',
          sticky: false,
        });
        marker.addTo(layer);
        bounds.push([lat, lng]);
      });
    }

    if (!fittedRef.current && bounds.length > 0) {
      fittedRef.current = true;
      try { map.fitBounds(L.latLngBounds(bounds as any).pad(0.35), { maxZoom: 17 }); } catch { /* non-fatal */ }
    }
  }, [data, employees]);

  const locateMe = () => {
    const map = mapRef.current;
    if (!map) return;
    if (me && Number.isFinite(Number(me.latitude)) && Number.isFinite(Number(me.longitude))) {
      map.setView([Number(me.latitude), Number(me.longitude)], 17);
    } else {
      const branch = data?.branches?.[0];
      if (branch) map.setView([branch.latitude, branch.longitude], 17);
    }
  };

  const summary = data?.summary;
  const meDistance = me && data?.branches?.[0]
    ? haversineMeters(Number(me.latitude), Number(me.longitude), Number(data.branches[0].latitude), Number(data.branches[0].longitude))
    : null;

  return (
    <div className="ubm-team-map">
      <div className="ubm-team-map-head">
        <div>
          <div className="ubm-team-map-title">
            <Users size={16} /> Bản đồ chi nhánh
          </div>
          <div className="ubm-team-map-sub">
            {data?.branches?.[0]?.name || 'Đang tải chi nhánh…'} • {summary?.total ?? 0} nhân viên
            {meDistance != null && me && me.gps_source !== 'BRANCH' ? ` • bạn cách cửa hàng ${meDistance.toLocaleString('vi-VN')} m` : ''}
          </div>
        </div>
        <div className="ubm-team-map-actions">
          <button type="button" onClick={locateMe} title="Về vị trí của tôi"><LocateFixed size={16} /></button>
          <button type="button" onClick={() => load()} title="Tải lại">
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {summary && (
        <div className="ubm-team-map-chips">
          <span className="chip chip--working">🟡 {summary.working} đang làm</span>
          <span className="chip chip--completed">🟢 {summary.completed} xong ca</span>
          <span className="chip chip--missing">🔴 {summary.missing} thiếu chấm</span>
          <span className="chip chip--normal">⚪ {summary.normal} bình thường</span>
        </div>
      )}

      <div className="ubm-team-map-canvas" ref={mapElRef} />

      {error && <div className="ubm-team-map-error">{error}</div>}
      {loading && !data && <div className="ubm-team-map-loading">Đang tải bản đồ…</div>}

      <div className="ubm-team-map-foot">
        Chấm màu = trạng thái ca hôm nay. Chạm vào chấm để xem tên, mã NV, ca và giờ check-in/check-out.
        Vị trí cập nhật realtime khi đồng nghiệp mở cổng nhân viên trong khung ca.
        {lastUpdated ? ` Cập nhật ${timeAgo(new Date(lastUpdated).toISOString())}.` : ''}
        <button type="button" className="ubm-team-auto" onClick={() => setAutoRefresh(v => !v)}>
          {autoRefresh ? 'Tự làm mới: BẬT' : 'Tự làm mới: TẮT'}
        </button>
      </div>
    </div>
  );
};
