import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  RefreshCw,
  Search,
  Users,
  Zap,
} from 'lucide-react';
import type {
  SaleMonitorEmployee,
  SaleMonitorShift,
  SaleMonitorSnapshot,
  SaleMonitorStatus,
} from '@ubm/shared';
import { apiRequest } from '../services/api';

type LiveShift = SaleMonitorShift & { live_status: SaleMonitorStatus };
type LiveEmployee = Omit<SaleMonitorEmployee, 'shifts'> & { shifts: LiveShift[] };

interface StatusMeta {
  label: string;
  short: string;
  color: string;
  bg: string;
  dot: string;
}

const STATUS_META: Record<SaleMonitorStatus, StatusMeta> = {
  WORKING: { label: 'Đang làm việc', short: 'Đang làm', color: '#047857', bg: '#D1FAE5', dot: '#10B981' },
  LATE: { label: 'Đi trễ', short: 'Đi trễ', color: '#B45309', bg: '#FEF3C7', dot: '#F59E0B' },
  COMPLETED: { label: 'Đã hoàn thành ca', short: 'Hoàn thành', color: '#1D4ED8', bg: '#DBEAFE', dot: '#3B82F6' },
  MISSING_CHECKIN: { label: 'Chưa vào ca', short: 'Chưa vào ca', color: '#B91C1C', bg: '#FEE2E2', dot: '#EF4444' },
  MISSING_CHECKOUT: { label: 'Chưa ra ca', short: 'Chưa ra ca', color: '#9A3412', bg: '#FFEDD5', dot: '#F97316' },
  UPCOMING: { label: 'Sắp vào ca', short: 'Sắp ca', color: '#6D28D9', bg: '#EDE9FE', dot: '#8B5CF6' },
  ABSENT: { label: 'Vắng ca', short: 'Vắng ca', color: '#991B1B', bg: '#FEE2E2', dot: '#DC2626' },
  OFF: { label: 'Không có ca', short: 'Không ca', color: '#475569', bg: '#F1F5F9', dot: '#94A3B8' },
};

const STATUS_ORDER: SaleMonitorStatus[] = [
  'WORKING', 'LATE', 'COMPLETED', 'MISSING_CHECKIN', 'MISSING_CHECKOUT', 'UPCOMING', 'ABSENT', 'OFF',
];

const VN_TZ = 'Asia/Ho_Chi_Minh';
const GRACE_MISSING_CHECKIN_MIN = 10;
const GRACE_MISSING_CHECKOUT_MIN = 15;

function parseMs(value?: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

function fmtHM(value?: string | null): string {
  const ms = parseMs(value);
  if (ms === null) return '—';
  return new Date(ms).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: VN_TZ,
  });
}

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: VN_TZ,
  });
}

function fmtDuration(ms: number, withSeconds = false): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (withSeconds) {
    if (h > 0) return `${h}h ${pad2(m)}p ${pad2(s)}s`;
    return `${m}p ${pad2(s)}s`;
  }
  return h > 0 ? `${h}h ${pad2(m)}p` : `${m}p`;
}

function fmtMinutes(minutes: number): string {
  return fmtDuration(Math.max(0, Number(minutes) || 0) * 60_000);
}

function deriveShiftStatus(shift: SaleMonitorShift, nowMs: number): SaleMonitorStatus {
  const start = parseMs(shift.start_at);
  const end = parseMs(shift.end_at);
  if (start === null || end === null) return shift.status || 'OFF';
  const checkIn = parseMs(shift.check_in_at);
  const checkOut = parseMs(shift.check_out_at);
  if (checkOut !== null) return 'COMPLETED';
  if (checkIn !== null) {
    if (nowMs > end + GRACE_MISSING_CHECKOUT_MIN * 60_000) return 'MISSING_CHECKOUT';
    return Number(shift.late_minutes || 0) > 0 || shift.is_late ? 'LATE' : 'WORKING';
  }
  if (shift.is_absent) return 'ABSENT';
  if (nowMs < start) return 'UPCOMING';
  if (nowMs > end + 30 * 60_000) return 'ABSENT';
  return 'MISSING_CHECKIN';
}

function aggregateStatus(shifts: LiveShift[]): SaleMonitorStatus {
  if (shifts.length === 0) return 'OFF';
  const has = (status: SaleMonitorStatus) => shifts.some((s) => s.live_status === status);
  if (has('LATE')) return 'LATE';
  if (has('WORKING')) return 'WORKING';
  if (has('MISSING_CHECKIN')) return 'MISSING_CHECKIN';
  if (has('MISSING_CHECKOUT')) return 'MISSING_CHECKOUT';
  if (has('UPCOMING')) return 'UPCOMING';
  if (shifts.every((s) => s.live_status === 'COMPLETED')) return 'COMPLETED';
  if (has('ABSENT')) return 'ABSENT';
  return shifts[0]?.live_status || 'OFF';
}

function workedMsOfShift(shift: LiveShift, nowMs: number, clampToShiftEnd = false): number {
  const checkIn = parseMs(shift.check_in_at);
  if (checkIn === null) return 0;
  const checkOut = parseMs(shift.check_out_at);
  const shiftEnd = parseMs(shift.end_at);
  const effectiveNow = clampToShiftEnd && shiftEnd !== null ? Math.min(nowMs, Math.max(shiftEnd, checkIn)) : nowMs;
  const end = checkOut ?? effectiveNow;
  return Math.max(0, end - checkIn);
}

interface StatCard {
  key: string;
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
}

export interface SaleMonitorViewProps {
  showToast?: (message: string) => void;
}

/**
 * Tool giám sát nhân viên Sale (Admin).
 *
 * - Snapshot lịch ca + điểm danh lấy từ `/admin/sale-monitor`.
 * - Đồng hồ làm việc tự chạy từng giây; trạng thái tự đổi đúng mốc giờ ca.
 * - Nhận CustomEvent `ubm:sale-monitor-reload` từ Socket.IO của App để tải lại
 *   ngay khi nhân viên Sale check-in/check-out hoặc HR đổi ca trên web app.
 */
export const SaleMonitorView: React.FC<SaleMonitorViewProps> = ({ showToast }) => {
  const [data, setData] = useState<SaleMonitorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const clockOffsetRef = useRef<number>(0);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | SaleMonitorStatus>('ALL');
  const [shiftFilter, setShiftFilter] = useState('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dateSel, setDateSel] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const qs = dateSel ? `?date=${encodeURIComponent(dateSel)}` : '';
      const snapshot = await apiRequest<SaleMonitorSnapshot>(`/admin/sale-monitor${qs}`, {
        cache: 'no-store',
      } as RequestInit);
      setData(snapshot);
      setError(null);
      setLastSync(Date.now());
      const serverMs = Date.parse(String(snapshot?.server_time || ''));
      if (Number.isFinite(serverMs)) clockOffsetRef.current = serverMs - Date.now();
    } catch (e: any) {
      setError(e?.message || 'Không tải được dữ liệu giám sát nhân viên Sale.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dateSel]);

  useEffect(() => {
    load(false);
  }, [load]);

  // Đồng hồ realtime: cập nhật mỗi giây để thời gian làm việc của từng NV chạy liên tục.
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Fallback khi mạng chập chờn: tự đồng bộ lại mỗi 20 giây (silent).
  useEffect(() => {
    const id = window.setInterval(() => load(true), 20_000);
    return () => window.clearInterval(id);
  }, [load]);

  // Socket.IO từ App.tsx bắn CustomEvent khi có check-in/out hoặc đổi ca.
  useEffect(() => {
    let timer: number | null = null;
    const onReload = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => load(true), 200);
    };
    window.addEventListener('ubm:sale-monitor-reload', onReload as EventListener);
    return () => {
      window.removeEventListener('ubm:sale-monitor-reload', onReload as EventListener);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [load]);

  const nowMs = nowTick + clockOffsetRef.current;

  // Mốc tính trạng thái/công: hôm nay = hiện tại (đồng hồ chạy từng giây);
  // ngày quá khứ chốt cuối ngày, ngày tương lai chốt đầu ngày.
  const refNowMs = useMemo(() => {
    const date = data?.date;
    if (!date) return nowMs;
    const start = Date.parse(`${date}T00:00:00+07:00`);
    const end = Date.parse(`${date}T23:59:59+07:00`);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return nowMs;
    if (nowMs < start) return start;
    if (nowMs > end) return end;
    return nowMs;
  }, [data?.date, nowMs]);

  const liveEmployees = useMemo<LiveEmployee[]>(() => {
    return (data?.employees || []).map((emp) => {
      const shifts: LiveShift[] = (emp.shifts || []).map((shift) => ({
        ...shift,
        live_status: deriveShiftStatus(shift, refNowMs),
      }));
      const checkIns = shifts.map((s) => parseMs(s.check_in_at)).filter((v): v is number => v !== null);
      const checkOuts = shifts.map((s) => parseMs(s.check_out_at)).filter((v): v is number => v !== null);
      const workedMs = shifts.reduce((sum, s) => sum + workedMsOfShift(s, refNowMs, !data?.is_today), 0);
      const workedMinutes = Math.floor(workedMs / 60_000);
      const scheduledMinutes = shifts.reduce((sum, s) => sum + Number(s.scheduled_minutes || 0), 0);
      return {
        ...emp,
        shifts,
        status: aggregateStatus(shifts),
        check_in_at: checkIns.length ? new Date(Math.min(...checkIns)).toISOString() : undefined,
        check_out_at: checkOuts.length ? new Date(Math.max(...checkOuts)).toISOString() : undefined,
        worked_minutes: workedMinutes,
        scheduled_minutes: scheduledMinutes,
        late_minutes: shifts.reduce((sum, s) => sum + Number(s.late_minutes || 0), 0),
        progress_percent: scheduledMinutes > 0
          ? Math.min(100, Math.round((workedMinutes / scheduledMinutes) * 1000) / 10)
          : 0,
        shift_count: shifts.length,
      };
    });
  }, [data, refNowMs]);

  const summary = useMemo(() => {
    const counts: Record<SaleMonitorStatus, number> = {
      WORKING: 0, LATE: 0, COMPLETED: 0, MISSING_CHECKIN: 0,
      MISSING_CHECKOUT: 0, UPCOMING: 0, ABSENT: 0, OFF: 0,
    };
    let late = 0;
    let checkedIn = 0;
    let scheduled = 0;
    let workedMinutes = 0;
    let scheduledMinutes = 0;
    for (const emp of liveEmployees) {
      counts[emp.status] += 1;
      if (emp.shifts.some((s) => Number(s.late_minutes || 0) > 0 || s.is_late)) late += 1;
      if (emp.shift_count > 0) {
        scheduled += 1;
        scheduledMinutes += emp.scheduled_minutes;
      }
      if (emp.check_in_at) checkedIn += 1;
      workedMinutes += emp.worked_minutes;
    }
    return {
      total: liveEmployees.length,
      counts,
      working: counts.WORKING + counts.LATE,
      late,
      completed: counts.COMPLETED,
      missingCheckin: counts.MISSING_CHECKIN,
      missingCheckout: counts.MISSING_CHECKOUT,
      upcoming: counts.UPCOMING,
      absent: counts.ABSENT,
      off: counts.OFF,
      checkedIn,
      scheduled,
      workedMinutes,
      scheduledMinutes,
      progress: scheduledMinutes > 0 ? Math.min(100, Math.round((workedMinutes / scheduledMinutes) * 1000) / 10) : 0,
      attendanceRate: scheduled > 0 ? Math.round((checkedIn / scheduled) * 1000) / 10 : 0,
    };
  }, [liveEmployees]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return liveEmployees.filter((emp) => {
      if (statusFilter !== 'ALL' && emp.status !== statusFilter) return false;
      if (shiftFilter !== 'ALL' && !emp.shifts.some((s) => s.shift_code === shiftFilter)) return false;
      if (!q) return true;
      const hay = `${emp.full_name} ${emp.employee_code} ${emp.phone || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [liveEmployees, search, statusFilter, shiftFilter]);

  const dateLabel = useMemo(() => {
    if (!data?.date) return '';
    const d = new Date(`${data.date}T00:00:00+07:00`);
    if (!Number.isFinite(d.getTime())) return data.date;
    return new Intl.DateTimeFormat('vi-VN', {
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    }).format(d);
  }, [data?.date]);

  const stats: StatCard[] = [
    {
      key: 'total', label: 'Nhân viên Sale', value: String(summary.total),
      hint: `${summary.scheduled} bạn có ca hôm nay`,
      icon: <Users size={18} />, color: '#0F172A', bg: '#E2E8F0',
    },
    {
      key: 'working', label: 'Đang làm việc', value: String(summary.working),
      hint: summary.checkedIn > 0 ? `${summary.checkedIn} đã vào ca` : 'Chưa có ai vào ca',
      icon: <Activity size={18} />, color: '#047857', bg: '#D1FAE5',
    },
    {
      key: 'late', label: 'Đi trễ', value: String(summary.late),
      hint: summary.late > 0 ? 'Cần nhắc nhở' : 'Đúng giờ',
      icon: <AlertTriangle size={18} />, color: '#B45309', bg: '#FEF3C7',
    },
    {
      key: 'completed', label: 'Hoàn thành', value: String(summary.completed),
      hint: 'Đã vào + ra ca',
      icon: <CheckCircle size={18} />, color: '#1D4ED8', bg: '#DBEAFE',
    },
    {
      key: 'missing', label: 'Chưa vào ca', value: String(summary.missingCheckin),
      hint: summary.missingCheckout > 0 ? `${summary.missingCheckout} chưa ra ca` : 'Theo dõi ngay',
      icon: <Clock size={18} />, color: '#B91C1C', bg: '#FEE2E2',
    },
    {
      key: 'worked', label: 'Tổng giờ làm', value: fmtMinutes(summary.workedMinutes),
      hint: `Tiến độ ${summary.progress}%`,
      icon: <Zap size={18} />, color: '#6D28D9', bg: '#EDE9FE',
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <style>{`
        @keyframes smPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.78); } }
        @keyframes smSpin { to { transform: rotate(360deg); } }
        @keyframes smFadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .sm-pulse { animation: smPulse 1.35s ease-in-out infinite; }
        .sm-spin { animation: smSpin .8s linear infinite; }
        .sm-fade { animation: smFadeUp .35s ease both; }
        .sm-row:hover td { background: #FFF7FB !important; }
        .sm-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
      `}</style>

      {/* HERO */}
      <div style={{
        position: 'relative', overflow: 'hidden', borderRadius: '20px',
        background: 'linear-gradient(120deg, #0F172A 0%, #3B0764 52%, #9D174D 100%)',
        color: '#FFF', padding: '22px 24px', boxShadow: '0 18px 40px rgba(59, 7, 100, 0.24)',
      }}>
        <div style={{
          position: 'absolute', width: '260px', height: '260px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(244,114,182,.32), transparent 68%)',
          top: '-120px', right: '-40px', pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', width: '180px', height: '180px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(56,189,248,.20), transparent 70%)',
          bottom: '-100px', left: '26%', pointerEvents: 'none',
        }} />

        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{
                width: '38px', height: '38px', borderRadius: '12px', display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center',
                background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)',
              }}>
                <Activity size={20} />
              </span>
              <div>
                <h1 style={{ margin: 0, fontSize: '21px', fontWeight: 900, letterSpacing: '-0.3px' }}>
                  Tool Giám Sát Nhân Viên Sale
                </h1>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.72)', marginTop: '2px' }}>
                  Lịch làm việc &amp; thời gian làm việc realtime 100% · Khối Sales / MKT
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '7px',
              padding: '7px 12px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 800,
              background: 'rgba(16,185,129,0.16)', border: '1px solid rgba(52,211,153,0.5)',
              color: '#A7F3D0', letterSpacing: '0.2px',
            }}>
              <span className="sm-pulse" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#34D399' }} />
              REALTIME · SOCKET.IO
            </span>
            <span style={{
              padding: '7px 12px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 700,
              background: 'rgba(255,255,255,0.09)', border: '1px solid rgba(255,255,255,0.16)',
              color: 'rgba(255,255,255,0.82)',
            }}>
              Đồng bộ: {lastSync ? fmtHM(new Date(lastSync).toISOString()) : '—'}
            </span>
          </div>
        </div>

        <div style={{
          position: 'relative', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginTop: '20px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '10.5px', fontWeight: 800, letterSpacing: '1.2px', color: 'rgba(255,255,255,0.55)' }}>
                GIỜ VIỆT NAM
              </div>
              <div style={{ fontSize: '30px', fontWeight: 900, lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
                {fmtClock(nowMs)}
              </div>
            </div>
            <div style={{ width: '1px', height: '42px', background: 'rgba(255,255,255,0.18)' }} />
            <div>
              <div style={{ fontSize: '10.5px', fontWeight: 800, letterSpacing: '1.2px', color: 'rgba(255,255,255,0.55)' }}>
                NGÀY GIÁM SÁT
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13.5px', fontWeight: 800, marginTop: '3px' }}>
                <Calendar size={15} /> {dateLabel || 'Hôm nay'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '11.5px', fontWeight: 800, color: '#FBCFE8',
              background: 'rgba(232,93,146,0.15)', border: '1px solid rgba(244,114,182,0.32)',
              padding: '7px 12px', borderRadius: '999px',
            }}>
              Tỉ lệ vào ca: {summary.attendanceRate}%
            </span>
            <button
              onClick={() => { load(false); showToast?.('Đang làm mới dữ liệu giám sát Sale...'); }}
              disabled={refreshing}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '7px',
                padding: '8px 14px', borderRadius: '10px', fontWeight: 800, fontSize: '12px',
                background: '#FFF', color: '#9D174D', border: '1px solid rgba(255,255,255,0.6)',
                cursor: refreshing ? 'wait' : 'pointer',
              }}
            >
              <RefreshCw size={14} className={refreshing ? 'sm-spin' : ''} />
              Làm mới ngay
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px',
          borderRadius: '12px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA',
          color: '#991B1B', fontWeight: 700, fontSize: '13px',
        }}>
          <AlertTriangle size={16} /> {error}
          <button className="btn-secondary" style={{ marginLeft: 'auto', fontSize: '12px', padding: '5px 12px' }} onClick={() => load(false)}>
            Thử lại
          </button>
        </div>
      ) : null}

      {/* SUMMARY */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px' }}>
        {stats.map((s) => (
          <div key={s.key} style={{
            backgroundColor: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: '14px', padding: '13px 15px', boxShadow: 'var(--shadow-sm)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.2px' }}>
                {s.label}
              </span>
              <span style={{
                width: '30px', height: '30px', borderRadius: '9px', display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center', color: s.color, backgroundColor: s.bg,
              }}>
                {s.icon}
              </span>
            </div>
            <div style={{ fontSize: '24px', fontWeight: 900, color: s.color, lineHeight: 1.2, marginTop: '4px', fontVariantNumeric: 'tabular-nums' }}>
              {s.value}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginTop: '2px' }}>
              {s.hint}
            </div>
          </div>
        ))}
      </div>

      {/* FILTER + SEARCH */}
      <div className="card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={() => setStatusFilter('ALL')}
            style={{
              padding: '6px 12px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 800,
              border: `1px solid ${statusFilter === 'ALL' ? 'var(--brand)' : 'var(--border)'}`,
              backgroundColor: statusFilter === 'ALL' ? 'var(--brand-soft)' : '#FFF',
              color: statusFilter === 'ALL' ? '#9D174D' : 'var(--text-muted)',
            }}
          >
            Tất cả ({summary.total})
          </button>
          {STATUS_ORDER.map((status) => {
            const meta = STATUS_META[status];
            const count = summary.counts[status];
            if (status === 'OFF' && count === 0) return null;
            return (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  padding: '6px 11px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 800,
                  border: `1px solid ${statusFilter === status ? meta.dot : 'var(--border)'}`,
                  backgroundColor: statusFilter === status ? meta.bg : '#FFF',
                  color: statusFilter === status ? meta.color : 'var(--text-muted)',
                }}
              >
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: meta.dot }} />
                {meta.short} ({count})
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 250px' }}>
            <Search size={15} style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm tên, mã NV, số điện thoại..."
              aria-label="Tìm nhân viên Sale"
              style={{ width: '100%', paddingLeft: '34px', fontSize: '13px', minHeight: '38px' }}
            />
          </div>
          <select
            value={shiftFilter}
            onChange={(e) => setShiftFilter(e.target.value)}
            aria-label="Lọc theo ca"
            style={{ fontSize: '12.5px', minHeight: '38px', fontWeight: 700, minWidth: '150px' }}
          >
            <option value="ALL">Tất cả ca</option>
            <option value="CA_1">Ca 1 (07:00–11:00)</option>
            <option value="CA_2">Ca 2 (11:00–15:00)</option>
            <option value="CA_3">Ca 3 (15:00–19:00)</option>
            <option value="CA_4">Ca 4 (19:00–23:00)</option>
          </select>
          <input
            type="date"
            value={dateSel || (data?.date || '')}
            onChange={(e) => setDateSel(e.target.value)}
            aria-label="Chọn ngày giám sát"
            title="Chọn ngày giám sát (để trống = hôm nay)"
            style={{ fontSize: '12.5px', minHeight: '38px', fontWeight: 700, minWidth: '150px' }}
          />
          {dateSel ? (
            <button
              className="btn-secondary"
              style={{ fontSize: '12px', padding: '8px 12px', fontWeight: 800 }}
              onClick={() => setDateSel('')}
            >
              Về hôm nay
            </button>
          ) : null}
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)' }}>
            Hiển thị {filtered.length}/{liveEmployees.length} nhân viên
          </span>
        </div>
      </div>

      {/* TABLE */}
      <div style={{
        backgroundColor: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: '16px', overflow: 'hidden', boxShadow: 'var(--shadow-card)',
      }}>
        <div className="sm-scroll" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: '1000px', fontSize: '12.5px' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                {['Nhân viên Sale', 'Ca làm hôm nay', 'Vào ca', 'Ra ca', 'Thời gian làm việc', 'Trạng thái', ''].map((label, i) => (
                  <th key={i} style={{
                    padding: '12px 14px', fontSize: '10.5px', letterSpacing: '0.5px',
                    textTransform: 'uppercase', backgroundColor: '#FFFBF9',
                    borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 2,
                    whiteSpace: 'nowrap',
                  }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)', fontWeight: 700 }}>
                    <RefreshCw size={18} className="sm-spin" style={{ verticalAlign: 'middle', marginRight: '8px' }} />
                    Đang kết nối dữ liệu giám sát nhân viên Sale...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <div style={{ fontWeight: 800, fontSize: '14px', marginBottom: '4px' }}>
                      {liveEmployees.length === 0 ? 'Chưa có nhân viên khối Sale' : 'Không có nhân viên khớp bộ lọc'}
                    </div>
                    <div style={{ fontSize: '12.5px' }}>
                      {liveEmployees.length === 0
                        ? 'Thêm nhân viên với nhóm SALE và xếp ca để tool hiển thị lịch làm việc realtime.'
                        : 'Thử xoá bộ lọc hoặc từ khoá tìm kiếm.'}
                    </div>
                  </td>
                </tr>
              ) : filtered.map((emp) => {
                const meta = STATUS_META[emp.status];
                const expanded = expandedId === emp.employee_id;
                const workedMs = emp.shifts.reduce((sum, s) => sum + workedMsOfShift(s, refNowMs, !data?.is_today), 0);
                const hasCheckIn = !!emp.check_in_at;
                return (
                  <React.Fragment key={emp.employee_id}>
                    <tr className="sm-row sm-fade" style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td style={{ padding: '13px 14px', verticalAlign: 'top' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{
                            width: '38px', height: '38px', borderRadius: '50%', flexShrink: 0,
                            background: 'linear-gradient(135deg, #E85D92, #9D174D)',
                            color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: 900, fontSize: '14px', boxShadow: '0 3px 8px rgba(157,23,77,0.25)',
                          }}>
                            {String(emp.full_name || '?').trim().charAt(0).toUpperCase()}
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 800, fontSize: '13px', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '220px' }}>
                              {emp.full_name}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>
                              <strong style={{ color: 'var(--brand)' }}>{emp.employee_code || emp.employee_id}</strong>
                              {emp.phone ? ` · ${emp.phone}` : ''}
                            </div>
                            <div style={{ fontSize: '10.5px', color: '#64748B', marginTop: '1px' }}>
                              {emp.employment_status === 'PROBATION' ? 'Thử việc' : emp.employment_status === 'OFFICIAL' ? 'Chính thức' : emp.employment_status || '—'}
                              {emp.default_shift_code ? ` · Ca cố định ${emp.default_shift_code.replace('_', ' ')}` : ''}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td style={{ padding: '13px 14px', verticalAlign: 'top' }}>
                        {emp.shifts.length === 0 ? (
                          <span style={{ color: '#94A3B8', fontWeight: 700 }}>Không có ca</span>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {emp.shifts.map((s) => {
                              const sm = STATUS_META[s.live_status];
                              return (
                                <span
                                  key={s.assignment_id}
                                  title={s.shift_name}
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '6px', width: 'fit-content',
                                    padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 800,
                                    backgroundColor: sm.bg, color: sm.color, border: `1px solid ${sm.dot}33`,
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: sm.dot }} />
                                  {s.shift_time_label || s.shift_name}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </td>

                      <td style={{ padding: '13px 14px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                        {hasCheckIn ? (
                          <div>
                            <div style={{ fontWeight: 900, fontSize: '14px', color: '#047857', fontVariantNumeric: 'tabular-nums' }}>
                              {fmtHM(emp.check_in_at)}
                            </div>
                            {emp.late_minutes > 0 ? (
                              <div style={{ fontSize: '10.5px', color: '#B45309', fontWeight: 800 }}>
                                Trễ {emp.late_minutes}p
                              </div>
                            ) : (
                              <div style={{ fontSize: '10.5px', color: '#059669', fontWeight: 700 }}>Đúng giờ</div>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: '#94A3B8', fontWeight: 700 }}>—</span>
                        )}
                      </td>

                      <td style={{ padding: '13px 14px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                        {emp.check_out_at ? (
                          <div>
                            <div style={{ fontWeight: 900, fontSize: '14px', color: '#1D4ED8', fontVariantNumeric: 'tabular-nums' }}>
                              {fmtHM(emp.check_out_at)}
                            </div>
                            {emp.shifts.some((s) => s.live_status === 'MISSING_CHECKOUT') ? (
                              <div style={{ fontSize: '10.5px', color: '#9A3412', fontWeight: 800 }}>Còn ca chưa ra</div>
                            ) : (
                              <div style={{ fontSize: '10.5px', color: '#64748B', fontWeight: 700 }}>Đã ra ca</div>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: '#94A3B8', fontWeight: 700 }}>—</span>
                        )}
                      </td>

                      <td style={{ padding: '13px 14px', verticalAlign: 'top', width: '230px' }}>
                        {hasCheckIn ? (
                          <div>
                            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
                              <span style={{ fontSize: '17px', fontWeight: 900, color: '#4C1D95', fontVariantNumeric: 'tabular-nums' }}>
                                {fmtDuration(workedMs, true)}
                              </span>
                              <span style={{ fontSize: '10.5px', fontWeight: 800, color: emp.progress_percent >= 100 ? '#047857' : '#6B7280' }}>
                                {emp.progress_percent}%
                              </span>
                            </div>
                            <div style={{ height: '7px', backgroundColor: '#F1F5F9', borderRadius: '999px', overflow: 'hidden', marginTop: '5px' }}>
                              <div style={{
                                width: `${Math.min(100, emp.progress_percent)}%`, height: '100%',
                                borderRadius: '999px',
                                background: emp.progress_percent >= 100
                                  ? 'linear-gradient(90deg, #10B981, #059669)'
                                  : 'linear-gradient(90deg, #E85D92, #9333EA)',
                                transition: 'width 1s linear',
                              }} />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '3px', fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 600 }}>
                              <span>Ca: {fmtMinutes(emp.scheduled_minutes)}</span>
                              {emp.shifts.some((s) => s.overtime_minutes > 0) ? (
                                <span style={{ color: '#B45309', fontWeight: 800 }}>
                                  +{Math.max(...emp.shifts.map((s) => s.overtime_minutes || 0))}p tăng ca
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: '#94A3B8', fontWeight: 700 }}>Chưa bắt đầu</span>
                        )}
                      </td>

                      <td style={{ padding: '13px 14px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '6px',
                          padding: '5px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 800,
                          backgroundColor: meta.bg, color: meta.color, border: `1px solid ${meta.dot}44`,
                        }}>
                          <span
                            className={emp.status === 'WORKING' || emp.status === 'LATE' ? 'sm-pulse' : ''}
                            style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: meta.dot }}
                          />
                          {meta.label}
                        </span>
                        {emp.shifts.some((s) => Number(s.fine_amount) > 0) ? (
                          <div style={{ fontSize: '10.5px', color: '#B91C1C', fontWeight: 800, marginTop: '4px' }}>
                            Phạt trễ: {Math.max(...emp.shifts.map((s) => Number(s.fine_amount) || 0)).toLocaleString('vi-VN')} đ
                          </div>
                        ) : null}
                      </td>

                      <td style={{ padding: '13px 10px', verticalAlign: 'top', textAlign: 'center' }}>
                        <button
                          onClick={() => setExpandedId(expanded ? null : emp.employee_id)}
                          aria-label={expanded ? 'Thu gọn chi tiết ca' : 'Xem chi tiết ca'}
                          title={expanded ? 'Thu gọn' : 'Xem chi tiết ca'}
                          style={{
                            width: '32px', height: '32px', borderRadius: '9px', display: 'inline-flex',
                            alignItems: 'center', justifyContent: 'center',
                            backgroundColor: expanded ? 'var(--brand-soft)' : '#FFF',
                            color: expanded ? '#9D174D' : 'var(--text-muted)',
                            border: '1px solid var(--border)',
                          }}
                        >
                          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </td>
                    </tr>

                    {expanded ? (
                      <tr>
                        <td colSpan={7} style={{ padding: '0 14px 14px', backgroundColor: '#FFFBFC' }}>
                          <div style={{
                            border: '1px solid #F3E1E8', borderRadius: '12px', padding: '12px',
                            display: 'flex', flexDirection: 'column', gap: '8px',
                          }}>
                            <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#9D174D', letterSpacing: '0.2px' }}>
                              CHI TIẾT CA LÀM &amp; ĐIỂM DANH — {emp.full_name}
                            </div>
                            {emp.shifts.length === 0 ? (
                              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                Hôm nay nhân viên không có ca trong lịch. Nếu cần, HR/Admin vào “Lịch làm việc” xếp ca ngay.
                              </div>
                            ) : emp.shifts.map((s) => {
                              const sm = STATUS_META[s.live_status];
                              const shiftWorkedMs = workedMsOfShift(s, refNowMs, !data?.is_today);
                              const scheduledMs = Math.max(0, Number(s.scheduled_minutes || 0)) * 60_000;
                              const progress = scheduledMs > 0 ? Math.min(100, Math.round((shiftWorkedMs / scheduledMs) * 1000) / 10) : 0;
                              return (
                                <div key={s.assignment_id} style={{
                                  backgroundColor: '#FFF', border: `1px solid ${sm.dot}33`,
                                  borderLeft: `4px solid ${sm.dot}`, borderRadius: '10px', padding: '10px 12px',
                                }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                      <strong style={{ fontSize: '12.5px' }}>{s.shift_name}</strong>
                                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>
                                        {s.shift_time_label}
                                      </span>
                                      <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '10px', fontWeight: 800, backgroundColor: sm.bg, color: sm.color }}>
                                        {sm.label}
                                      </span>
                                      {s.gps_status ? (
                                        <span style={{ fontSize: '10px', fontWeight: 700, color: s.gps_status === 'VALID' ? '#047857' : '#B45309' }}>
                                          GPS: {s.gps_status}
                                        </span>
                                      ) : null}
                                    </div>
                                    <span style={{ fontSize: '11.5px', fontWeight: 900, color: '#4C1D95' }}>
                                      {fmtDuration(shiftWorkedMs, true)} / {fmtMinutes(s.scheduled_minutes)}
                                    </span>
                                  </div>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px', marginTop: '8px' }}>
                                    <div style={{ fontSize: '11px' }}>
                                      <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>Vào ca: </span>
                                      <strong style={{ color: s.check_in_at ? '#047857' : '#94A3B8' }}>{fmtHM(s.check_in_at)}</strong>
                                    </div>
                                    <div style={{ fontSize: '11px' }}>
                                      <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>Ra ca: </span>
                                      <strong style={{ color: s.check_out_at ? '#1D4ED8' : '#94A3B8' }}>{fmtHM(s.check_out_at)}</strong>
                                    </div>
                                    <div style={{ fontSize: '11px' }}>
                                      <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>Trễ: </span>
                                      <strong style={{ color: s.late_minutes > 0 ? '#B45309' : '#047857' }}>{s.late_minutes}p</strong>
                                    </div>
                                    <div style={{ fontSize: '11px' }}>
                                      <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>Về sớm: </span>
                                      <strong style={{ color: s.early_leave_minutes > 0 ? '#B45309' : '#047857' }}>{s.early_leave_minutes}p</strong>
                                    </div>
                                  </div>
                                  <div style={{ height: '6px', backgroundColor: '#F1F5F9', borderRadius: '999px', overflow: 'hidden', marginTop: '8px' }}>
                                    <div style={{
                                      width: `${progress}%`, height: '100%', borderRadius: '999px',
                                      background: progress >= 100 ? '#10B981' : 'linear-gradient(90deg, #E85D92, #9333EA)',
                                      transition: 'width 1s linear',
                                    }} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* RECENT EVENTS */}
      <div className="card" style={{ padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 900 }}>Dòng thời gian điểm danh realtime</div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '1px' }}>
              Cập nhật tức thì khi nhân viên Sale bấm Vào ca / Ra ca trên Cổng Employee Web
            </div>
          </div>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px',
            fontWeight: 800, color: '#047857', backgroundColor: '#D1FAE5',
            border: '1px solid #6EE7B7', padding: '5px 10px', borderRadius: '999px',
          }}>
            <span className="sm-pulse" style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#10B981' }} />
            LIVE
          </span>
        </div>

        <div className="sm-scroll" style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px', marginTop: '12px' }}>
          {(data?.recent_events || []).length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '8px 0' }}>
              Chưa có lượt điểm danh nào hôm nay.
            </div>
          ) : (data?.recent_events || []).map((ev) => {
            const isIn = ev.type === 'CHECK_IN';
            const isOut = ev.type === 'CHECK_OUT';
            const color = isIn ? '#047857' : isOut ? '#1D4ED8' : '#B91C1C';
            const bg = isIn ? '#ECFDF5' : isOut ? '#EFF6FF' : '#FEF2F2';
            const dot = isIn ? '#10B981' : isOut ? '#3B82F6' : '#EF4444';
            const label = isIn ? 'vào ca' : isOut ? 'ra ca' : 'vắng ca';
            return (
              <div key={ev.event_id || `${ev.employee_id}-${ev.time}-${ev.type}`} style={{
                minWidth: '205px', flex: '0 0 auto', padding: '9px 11px', borderRadius: '10px',
                backgroundColor: bg, border: `1px solid ${dot}33`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10.5px', color, fontWeight: 900 }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: dot }} />
                  {fmtHM(ev.time)} · {label.toUpperCase()}
                  {ev.is_late ? <span style={{ color: '#B45309' }}>· TRỄ</span> : null}
                </div>
                <div style={{ fontSize: '12px', fontWeight: 800, color: 'var(--text)', marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {ev.employee_name}
                </div>
                <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '1px' }}>
                  {ev.employee_code}{ev.shift_code ? ` · ${ev.shift_code.replace('_', ' ')}` : ''}
                  {Number(ev.fine_amount) > 0 ? ` · phạt ${Number(ev.fine_amount).toLocaleString('vi-VN')}đ` : ''}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 14px',
        borderRadius: '12px', backgroundColor: '#F8FAFC', border: '1px dashed #CBD5E1',
        fontSize: '11.5px', color: '#475569', lineHeight: 1.6,
      }}>
        <Zap size={16} style={{ flexShrink: 0, marginTop: '1px', color: '#9333EA' }} />
        <div>
          <strong>Đồng bộ 100% realtime:</strong> Tool đọc trực tiếp lịch ca (PHAN_CONG_CA) và lượt điểm danh
          (SU_KIEN_DIEM_DANH) mà Cổng Employee Web đang ghi. Khi nhân viên Sale vào ca / ra ca / đổi ca / nghỉ,
          backend phát Socket.IO <code>sale-monitor:updated</code> → tool tải lại ngay, không cần F5.
          Đồng hồ thời gian làm việc tự chạy từng giây theo giờ Việt Nam.
        </div>
      </div>
    </div>
  );
};
