/**
 * Tab "Bản đồ" — vị trí tài xế + toàn bộ điểm giao + chỉ đường.
 * Dùng Leaflet + OpenStreetMap (không cần API key, chạy trên điện thoại).
 */
import { useEffect, useMemo, useRef } from 'react';
import * as LeafletModule from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CheckCircle2, LocateFixed, MapPin, Navigation } from 'lucide-react';
import { BigButton, Card, DC, Pill, ScreenTitle, fmtMin, openDirections } from './driver-shared';
import type { DriverData } from './useDriverData';

const L = ((LeafletModule as any).default ?? LeafletModule) as typeof LeafletModule;

export function DriverMap({ d }: { d: DriverData }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const fittedRef = useRef(false);

  const stops = useMemo(() => (d.stops || [])
    .filter((s: any) => {
      const lat = Number(s.latitude);
      const lng = Number(s.longitude);
      return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
    })
    .sort((a: any, b: any) => Number(a.stop_order) - Number(b.stop_order)), [d.stops]);

  // Khởi tạo map 1 lần.
  useEffect(() => {
    if (!boxRef.current || mapRef.current) return;
    const map = L.map(boxRef.current, { zoomControl: false, attributionControl: true })
      .setView([10.7769, 106.7009], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const t = setTimeout(() => map.invalidateSize(), 80);
    return () => {
      clearTimeout(t);
      try { map.remove(); } catch { /* ignore */ }
      mapRef.current = null;
      layerRef.current = null;
      fittedRef.current = false;
    };
  }, []);

  // Vẽ lại điểm dừng + vị trí mỗi khi dữ liệu đổi.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    if (stops.length > 1) {
      L.polyline(
        stops.map((s: any) => [Number(s.latitude), Number(s.longitude)] as [number, number]),
        { color: DC.brand, weight: 4, opacity: 0.55, dashArray: '8 7' },
      ).addTo(layer);
    }

    stops.forEach((s: any) => {
      const done = !!s.isCompleted;
      const isNext = d.nextStop?.stop_id === s.stop_id;
      const bg = done ? DC.success : isNext ? DC.brand : '#64748B';
      const ring = isNext ? '0 0 0 4px rgba(232,93,146,0.22)' : '0 1px 4px rgba(0,0,0,0.25)';
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:26px;height:26px;border-radius:999px;background:${bg};color:#fff;display:flex;align-items:center;justify-content:center;font:800 11px system-ui;box-shadow:${ring};border:2px solid #fff">${done ? '✓' : s.stop_order}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      L.marker([Number(s.latitude), Number(s.longitude)], { icon })
        .addTo(layer)
        .bindTooltip(`${s.name}${s.address ? ` • ${s.address}` : ''}`, { direction: 'top', offset: [0, -12] });
    });

    if (d.coords) {
      const ll: [number, number] = [d.coords.lat, d.coords.lng];
      L.circle(ll, {
        radius: Math.max(d.coords.accuracy || 10, 8),
        color: '#2563EB', weight: 1, fillColor: '#3B82F6', fillOpacity: 0.12,
      }).addTo(layer);
      L.circleMarker(ll, { radius: 8, color: '#FFFFFF', weight: 3, fillColor: '#2563EB', fillOpacity: 1 })
        .addTo(layer)
        .bindTooltip('Bạn đang ở đây', { direction: 'top', offset: [0, -10] });
    }

    if (!fittedRef.current) {
      const pts: Array<[number, number]> = stops.map((s: any) => [Number(s.latitude), Number(s.longitude)]);
      if (d.coords) pts.push([d.coords.lat, d.coords.lng]);
      if (pts.length) {
        map.fitBounds(L.latLngBounds(pts), { padding: [34, 34], maxZoom: 15 });
        fittedRef.current = true;
      }
    }
  }, [stops, d.coords, d.nextStop]);

  const centerMe = () => {
    if (mapRef.current && d.coords) {
      mapRef.current.setView([d.coords.lat, d.coords.lng], 16, { animate: true });
    }
  };

  const next = d.nextStop;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScreenTitle title="Bản đồ lộ trình" sub={d.current ? (d.detail?.routeName || 'Lộ trình giao sữa') : 'Chưa có ca đang chạy'} />

      <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', border: `1px solid ${DC.border}`, boxShadow: '0 2px 8px rgba(15,23,42,0.06)' }}>
        <div ref={boxRef} style={{ height: 360, width: '100%', backgroundColor: '#E2E8F0' }} />
        <button
          onClick={centerMe}
          disabled={!d.coords}
          title="Về vị trí của tôi"
          style={{
            position: 'absolute', right: 12, top: 12, zIndex: 500,
            width: 38, height: 38, borderRadius: 999, border: 'none',
            backgroundColor: '#FFFFFF', boxShadow: '0 2px 8px rgba(15,23,42,0.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: d.coords ? 'pointer' : 'not-allowed', opacity: d.coords ? 1 : 0.6,
          }}
        >
          <LocateFixed size={18} color={DC.brand} />
        </button>
        {!d.coords && (
          <div style={{
            position: 'absolute', left: 12, right: 12, bottom: 12, zIndex: 500,
            backgroundColor: 'rgba(255,251,235,0.96)', border: '1px solid #FDE68A',
            borderRadius: 10, padding: '8px 10px', fontSize: 11, fontWeight: 700, color: DC.warn,
          }}>
            {d.gpsErr || 'Đang chờ GPS...'}
          </div>
        )}
      </div>

      {/* Chú thích */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 10.5, fontWeight: 700, color: DC.muted, padding: '0 2px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: '#2563EB', display: 'inline-block' }} /> Vị trí của bạn
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: DC.brand, display: 'inline-block' }} /> Điểm kế tiếp
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: DC.success, display: 'inline-block' }} /> Đã giao
        </span>
      </div>

      {next ? (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
            <Navigation size={14} color={DC.brand} />
            <span style={{ fontSize: 10.5, fontWeight: 800, color: DC.brand, letterSpacing: 0.4 }}>ĐIỂM KẾ TIẾP</span>
            <Pill text={`SLA ${fmtMin(Number(next.sla_minutes || 0))}`} fg={DC.blue} bg={DC.blueSoft} style={{ marginLeft: 'auto' }} />
          </div>
          <div style={{ fontSize: 15.5, fontWeight: 900, color: DC.ink }}>{next.name}</div>
          {next.address && <div style={{ fontSize: 11.5, color: DC.muted, fontWeight: 600, marginTop: 3 }}>{next.address}</div>}
          <div style={{ fontSize: 11.5, color: DC.muted, fontWeight: 700, marginTop: 5 }}>
            {d.distToNext == null ? 'Chưa có GPS để tính khoảng cách' : `Còn cách ${Math.round(d.distToNext)}m • bán kính cho phép ${next.geofence_radius_m}m`}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
            <BigButton tone="ghost" style={{ flex: 1, padding: '11px', fontSize: 12.5 }} onClick={() => openDirections(Number(next.latitude), Number(next.longitude), next.name)}>
              <Navigation size={14} /> Mở Google Maps
            </BigButton>
            <BigButton
              style={{ flex: 1, padding: '11px', fontSize: 12.5 }}
              disabled={!d.isRunning || d.distToNext == null || d.distToNext > Number(next.geofence_radius_m || 100) || !d.coords || d.coords.accuracy > 30 || d.busy === `ci_${next.stop_id}`}
              onClick={() => void d.checkin(next)}
            >
              <CheckCircle2 size={15} /> Xác nhận
            </BigButton>
          </div>
        </Card>
      ) : (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, color: DC.muted }}>
            <MapPin size={16} /> {d.current ? 'Không còn điểm nào cần giao.' : 'Chưa có ca nên chưa có lộ trình hiển thị.'}
          </div>
        </Card>
      )}
    </div>
  );
}
