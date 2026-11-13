/**
 * Tab "Thu nhập" — lương tài xế theo tháng + thống kê ca/điểm giao/phạt.
 * Lưu ý: bảng lương chính thức do Kế toán (FINANCE) chốt; số ở đây có thể là tạm tính.
 */
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, Banknote, CalendarCheck2, Clock, MapPin, Route, TrendingUp, Wallet } from 'lucide-react';
import { Card, DC, Empty, Pill, ScreenTitle, fmtMin, fmtMoney } from './driver-shared';
import type { DriverData } from './useDriverData';

const PAYROLL_STATUS: Record<string, { text: string; fg: string; bg: string }> = {
  ESTIMATED: { text: 'Tạm tính', fg: DC.warn, bg: DC.warnSoft },
  DRAFT: { text: 'Chờ chốt', fg: DC.warn, bg: DC.warnSoft },
  APPROVED: { text: 'Đã duyệt', fg: DC.blue, bg: DC.blueSoft },
  PAID: { text: 'Đã trả', fg: DC.success, bg: DC.successSoft },
  PUBLISHED: { text: 'Đã phát hành', fg: DC.success, bg: DC.successSoft },
};

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      padding: strong ? '9px 0 2px' : '6px 0',
      borderTop: strong ? `1.5px dashed ${DC.border}` : 'none',
    }}>
      <span style={{ fontSize: strong ? 12.5 : 12, fontWeight: strong ? 900 : 700, color: strong ? DC.ink : DC.muted }}>{label}</span>
      <span style={{ fontSize: strong ? 15 : 12.5, fontWeight: 900, color: tone || (strong ? DC.brand : DC.ink), fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

export function DriverIncome({ d }: { d: DriverData }) {
  const stats = d.profile?.stats || {};
  const currentPayroll = d.profile?.payroll || null;
  const period = String(d.profile?.period || '').slice(0, 7);
  const [yy, mm] = period.split('-');
  const status = PAYROLL_STATUS[String(currentPayroll?.status || 'ESTIMATED')] || PAYROLL_STATUS.ESTIMATED;

  const periods = useMemo(() => {
    const seen = new Set<string>();
    const out: any[] = [];
    const push = (p: any) => {
      if (!p || !p.period) return;
      const key = String(p.period);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(p);
    };
    push(currentPayroll);
    [...(d.payroll || [])]
      .sort((a: any, b: any) => String(b.period).localeCompare(String(a.period)))
      .forEach(push);
    return out;
  }, [currentPayroll, d.payroll]);

  const penaltyDetails: any[] = currentPayroll?.penalty_breakdown?.details || [];
  const penaltyAmount = Number(currentPayroll?.total_penalty_amount || stats.penalty_amount || 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScreenTitle title="Thu nhập của tôi" sub={period ? `Kỳ lương tháng ${mm}/${yy}` : 'Chưa có kỳ lương'} />

      {/* Thẻ thu nhập tháng */}
      <div style={{
        borderRadius: 18, padding: 16, color: '#FFF',
        background: 'linear-gradient(135deg,#BE185D 0%,#D6457E 55%,#E85D92 100%)',
        boxShadow: '0 10px 24px rgba(232,93,146,0.22)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Wallet size={16} />
          <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, opacity: 0.9 }}>THỰC NHẬN KỲ NÀY</span>
          <span style={{ marginLeft: 'auto' }}><Pill text={status.text} fg={status.fg} bg={status.bg} /></span>
        </div>
        <div style={{ fontSize: 30, fontWeight: 900, marginTop: 6, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5 }}>
          {fmtMoney(currentPayroll?.net_pay ?? 0)}
        </div>
        <div style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.9, marginTop: 3 }}>
          {Number(currentPayroll?.total_work_days || stats.work_days || 0)} ngày công • {Number(currentPayroll?.total_shifts || stats.shifts_total || 0)} ca
          {penaltyAmount > 0 ? ` • trừ phạt ${fmtMoney(penaltyAmount)}` : ' • không phạt'}
        </div>
        {Number(currentPayroll?.absent_days || 0) > 0 && (
          <div style={{ marginTop: 9, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 9, padding: '7px 10px', fontSize: 10.5, fontWeight: 700, lineHeight: 1.5 }}>
            {currentPayroll.absent_days} ngày có lịch nhưng không hoạt động — không tính lương
            {Array.isArray(currentPayroll.absent_dates) && currentPayroll.absent_dates.length > 0
              ? ` (${currentPayroll.absent_dates.map((d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`).join(', ')})`
              : ''}
          </div>
        )}
        {currentPayroll?.status === 'ESTIMATED' && (
          <div style={{ marginTop: 10, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 9, padding: '7px 10px', fontSize: 10.5, fontWeight: 700, lineHeight: 1.5 }}>
            Số tạm tính theo công thức lương tài xế. Kế toán chốt bảng lương sẽ cập nhật chính thức.
          </div>
        )}
      </div>

      {/* Thống kê tháng */}
      <Card>
        <div style={{ fontSize: 13, fontWeight: 900, color: DC.ink, marginBottom: 9, display: 'flex', alignItems: 'center', gap: 6 }}>
          <TrendingUp size={16} color={DC.brand} /> Thống kê tháng này
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <StatCell icon={<CalendarCheck2 size={13} />} label="Ca hoàn thành" value={`${stats.shifts_completed ?? 0}/${stats.shifts_total ?? 0}`} />
          <StatCell icon={<MapPin size={13} />} label="Điểm đã giao" value={`${stats.stops_done ?? 0}/${stats.stops_total ?? 0}`} />
          <StatCell icon={<Clock size={13} />} label="Đúng giờ" value={stats.on_time_rate == null ? '—' : `${stats.on_time_rate}%`} tone={(stats.on_time_rate ?? 100) >= 90 ? DC.success : DC.warn} />
          <StatCell icon={<Route size={13} />} label="Quãng đường" value={`${stats.distance_km ?? 0} km`} />
          <StatCell icon={<Clock size={13} />} label="Thời gian chạy" value={fmtMin(Number(stats.duration_min || 0))} />
          <StatCell icon={<AlertTriangle size={13} />} label="Điểm phạt" value={String(stats.penalty_points ?? 0)} tone={Number(stats.penalty_points || 0) > 0 ? DC.danger : DC.success} />
        </div>
      </Card>

      {/* Bảng lương chi tiết */}
      <Card>
        <div style={{ fontSize: 13, fontWeight: 900, color: DC.ink, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Banknote size={16} color={DC.brand} /> Chi tiết kỳ {period ? `${mm}/${yy}` : ''}
        </div>
        {!currentPayroll && (
          <Empty icon={<Wallet size={28} />} title="Chưa có dữ liệu lương" desc="Lương tài xế được tính từ ca vận chuyển và điểm giao đã xác nhận." />
        )}
        {currentPayroll && (
          <div>
            <Row label={`Lương ${Number(currentPayroll.standard_days || 0)} ngày chuẩn`} value={fmtMoney(currentPayroll.standard_pay)} />
            {Number(currentPayroll.extra_days || 0) > 0 && (
              <Row label={`Lương ${Number(currentPayroll.extra_days)} ngày vượt`} value={fmtMoney(currentPayroll.extra_pay)} />
            )}
            <Row label="Tổng trước phạt" value={fmtMoney(currentPayroll.gross_pay)} />
            <Row
              label={`Phạt (${Number(currentPayroll.total_penalty_points || 0)} điểm)`}
              value={penaltyAmount > 0 ? `-${fmtMoney(penaltyAmount)}` : '0đ'}
              tone={penaltyAmount > 0 ? DC.danger : DC.success}
            />
            <Row label="Thực nhận" value={fmtMoney(currentPayroll.net_pay)} strong />
          </div>
        )}
      </Card>

      {/* Chi tiết phạt */}
      {penaltyDetails.length > 0 && (
        <Card style={{ backgroundColor: DC.dangerSoft, borderColor: '#FECACA' }}>
          <div style={{ fontSize: 12.5, fontWeight: 900, color: DC.danger, marginBottom: 7, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={15} /> Chi tiết phạt trong kỳ
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {penaltyDetails.slice(0, 10).map((p: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11.5 }}>
                <span style={{ color: '#991B1B', fontWeight: 700, flex: 1, lineHeight: 1.5 }}>
                  {String(p.date || '').split('-').reverse().join('/')} • {p.type === 'MISSED_CHECKIN' ? 'Bỏ lọt điểm' : 'Trễ SLA'}
                  {p.stop_name ? ` • ${p.stop_name}` : ''}
                  {p.late_minutes ? ` (trễ ${p.late_minutes} phút)` : ''}
                </span>
                <span style={{ color: DC.danger, fontWeight: 900, flexShrink: 0 }}>-{fmtMoney(p.amount)}</span>
              </div>
            ))}
            {penaltyDetails.length > 10 && (
              <div style={{ fontSize: 10.5, color: '#991B1B', fontWeight: 700 }}>... và {penaltyDetails.length - 10} mục khác</div>
            )}
          </div>
        </Card>
      )}

      {/* Các kỳ trước */}
      <Card>
        <div style={{ fontSize: 13, fontWeight: 900, color: DC.ink, marginBottom: 8 }}>Các kỳ lương</div>
        {periods.length === 0 && <div style={{ fontSize: 12, color: DC.muted, fontWeight: 600 }}>Chưa có bảng lương kỳ nào được phát hành.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {periods.map((p: any) => {
            const st = PAYROLL_STATUS[String(p.status || 'DRAFT')] || PAYROLL_STATUS.DRAFT;
            const [y, m] = String(p.period || '').split('-');
            return (
              <div key={p.payroll_id || p.period} style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${DC.border}`, borderRadius: 10, padding: '9px 11px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: DC.ink }}>Tháng {m}/{y}</div>
                  <div style={{ fontSize: 10.5, color: DC.muted, fontWeight: 600, marginTop: 2 }}>
                    {Number(p.total_shifts || 0)} ca • {Number(p.total_work_days || 0)} ngày công
                    {Number(p.total_penalty_amount || 0) > 0 ? ` • phạt ${fmtMoney(p.total_penalty_amount)}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 900, color: DC.ink }}>{fmtMoney(p.net_pay)}</div>
                  <Pill text={st.text} fg={st.fg} bg={st.bg} style={{ marginTop: 3 }} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card style={{ backgroundColor: DC.brandSoft, borderColor: DC.brandLine }}>
        <div style={{ fontSize: 11.5, color: DC.brandDark, fontWeight: 600, lineHeight: 1.7 }}>
          <b>Quỹ lương tài xế:</b> {fmtMoney(d.profile?.config?.standard_daily_rate)}/ngày chuẩn
          ({d.profile?.config?.standard_work_days} ngày/tháng), ngày vượt {fmtMoney(d.profile?.config?.extra_daily_rate)}/ngày.
          Bỏ lọt điểm phạt {Math.round(Number(d.profile?.config?.penalty_missed_pct || 0.25) * 100)}% ngày công, trễ SLA phạt {Math.round(Number(d.profile?.config?.penalty_late_pct || 0.1) * 100)}% ngày công.
        </div>
      </Card>
    </div>
  );
}

function StatCell({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone?: string }) {
  return (
    <div style={{ backgroundColor: DC.bg, border: `1px solid ${DC.border}`, borderRadius: 11, padding: '9px 10px' }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, color: DC.muted, textTransform: 'uppercase', letterSpacing: 0.4, display: 'flex', alignItems: 'center', gap: 4 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 900, color: tone || DC.ink, marginTop: 2 }}>{value}</div>
    </div>
  );
}
