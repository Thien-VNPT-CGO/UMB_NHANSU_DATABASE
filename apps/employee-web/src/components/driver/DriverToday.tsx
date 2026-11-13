/**
 * Tab "Hôm nay" — ca đang chạy, tiến độ giao, SLA và bấm xác nhận điểm.
 */
import {
  AlertTriangle, CalendarDays, CheckCircle2, Clock, MapPin, Navigation, Play, RefreshCw, Square, Truck,
} from 'lucide-react';
import {
  BigButton, Card, DC, Empty, Pill, ScreenTitle, STATUS_LABEL, Stat,
  fmtDay, fmtMin, fmtTime, haversine, openDirections,
} from './driver-shared';
import type { DriverData } from './useDriverData';

function HeroStat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div style={{
      flex: 1, minWidth: 0, backgroundColor: 'rgba(255,255,255,0.14)',
      border: `1px solid ${alert ? 'rgba(254,202,202,0.65)' : 'rgba(255,255,255,0.22)'}`,
      borderRadius: 11, padding: '8px 9px',
    }}>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.4, opacity: 0.85 }}>{label}</div>
      <div style={{
        fontSize: 16, fontWeight: 900, marginTop: 2, fontVariantNumeric: 'tabular-nums',
        color: alert ? '#FECACA' : '#FFFFFF',
      }}>{value}</div>
    </div>
  );
}

export function DriverToday({ d }: { d: DriverData }) {
  const {
    profile, current, todayShifts, weekShifts, detail, status, isRunning, stops, nextStop,
    slaLeftSec, distToNext, checkedCount, mandatoryLeft, busy, coords,
  } = d;
  const st = STATUS_LABEL[status] || STATUS_LABEL.SCHEDULED;
  const firstName = String(profile?.driver?.full_name || '').trim().split(/\s+/).pop() || 'tài xế';
  const pct = stops.length ? Math.round((checkedCount / stops.length) * 100) : 0;
  const within = nextStop && distToNext != null && distToNext <= Number(nextStop.geofence_radius_m || 100);
  const gpsReady = !!coords && coords.accuracy <= 30;
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  const shiftIsToday = String(current?.shift_date || '').slice(0, 10) === today;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScreenTitle title={`Xin chào, ${firstName}`} sub={fmtDay(today)} />

      {/* ---------------- Ca hiện tại ---------------- */}
      <div style={{
        borderRadius: 18, padding: 16, color: '#FFFFFF',
        background: current
          ? 'linear-gradient(135deg, #E85D92 0%, #D6457E 58%, #BE185D 100%)'
          : 'linear-gradient(135deg, #9CA3AF 0%, #6B7280 100%)',
        boxShadow: current ? '0 10px 24px rgba(232,93,146,0.22)' : '0 10px 24px rgba(107,114,128,0.18)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, opacity: 0.85 }}>
              {shiftIsToday ? 'CA VẬN CHUYỂN HÔM NAY' : current ? `CA SẮP TỚI • ${fmtDay(current.shift_date)}` : 'CA VẬN CHUYỂN HÔM NAY'}
            </div>
            <div style={{ fontSize: 18, fontWeight: 900, marginTop: 3, lineHeight: 1.25 }}>
              {current ? (detail?.routeName || 'Lộ trình giao sữa') : 'Chưa có ca được phân công'}
            </div>
            {current && (
              <div style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.9, marginTop: 4 }}>
                🚐 {detail?.vehiclePlate || profile?.vehicle?.license_plate || '—'}
                {current.product_name ? ` • ${current.product_name}` : ''}
                {current.planned_start_at ? ` • ${fmtTime(current.planned_start_at)}` : ''}
              </div>
            )}
            {!current && (
              <div style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.9, marginTop: 4, lineHeight: 1.5 }}>
                Quản lý vận chuyển phân công ca xong sẽ tự hiện tại đây.
              </div>
            )}
          </div>
          {current && <Pill text={st.text} fg={st.fg} bg={st.bg} />}
        </div>

        {current && (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 14 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, opacity: 0.85 }}>ĐIỂM ĐÃ XÁC NHẬN</div>
                <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
                  {checkedCount}<span style={{ fontSize: 14, opacity: 0.8 }}>/{stops.length || '—'}</span>
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 11, fontWeight: 700, opacity: 0.9 }}>
                {pct}% lộ trình
              </div>
            </div>
            <div style={{ height: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.22)', marginTop: 7, overflow: 'hidden' }}>
              <div style={{ width: `${Math.max(pct, pct > 0 ? 6 : 0)}%`, height: '100%', borderRadius: 999, backgroundColor: '#FFD1E3', transition: 'width .3s' }} />
            </div>

            <div style={{ display: 'flex', gap: 7, marginTop: 12 }}>
              <HeroStat label="CÒN BẮT BUỘC" value={String(mandatoryLeft)} alert={mandatoryLeft > 0 && isRunning} />
              <HeroStat
                label="SLA CHẶNG TIẾP"
                value={slaLeftSec == null ? '—' : slaLeftSec < 0 ? `+${Math.floor(-slaLeftSec / 60)}p` : `${Math.floor(slaLeftSec / 60)}p`}
                alert={slaLeftSec != null && slaLeftSec < 600}
              />
              <HeroStat
                label="CÁCH ĐIỂM"
                value={distToNext == null ? '—' : `${Math.round(distToNext)}m`}
              />
            </div>
          </>
        )}
      </div>

      {/* ---------------- Nút điều khiển ca ---------------- */}
      {current && current.status === 'SCHEDULED' && (
        <BigButton onClick={d.startShift} disabled={busy === 'start'}>
          <Play size={17} /> {busy === 'start' ? 'ĐANG BẮT ĐẦU...' : 'BẮT ĐẦU CA'}
        </BigButton>
      )}
      {current && isRunning && (
        <BigButton tone="danger" onClick={d.endShift} disabled={busy === 'end'}>
          <Square size={16} /> {busy === 'end' ? 'ĐANG KẾT THÚC...' : 'KẾT THÚC CA'}
        </BigButton>
      )}
      {current && current.status === 'COMPLETED' && (
        <Card style={{ backgroundColor: DC.successSoft, borderColor: '#A7F3D0', textAlign: 'center', padding: 13 }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: DC.success, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            <CheckCircle2 size={17} /> Ca đã hoàn thành
          </div>
          <div style={{ fontSize: 11.5, color: '#047857', fontWeight: 700, marginTop: 4 }}>
            {fmtTime(current.actual_start_at)} – {fmtTime(current.actual_end_at)}
            {Number(current.penalty_points) > 0 ? ` • ${current.penalty_points} điểm phạt` : ' • không phát sinh phạt'}
          </div>
        </Card>
      )}
      {current && isRunning && !gpsReady && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7, padding: '9px 12px',
          backgroundColor: DC.warnSoft, border: '1px solid #FDE68A', borderRadius: 11,
          fontSize: 11.5, fontWeight: 700, color: DC.warn,
        }}>
          <AlertTriangle size={14} />
          {d.gpsErr || (coords ? `Sai số GPS ±${coords.accuracy}m — cần ≤30m mới bấm điểm được.` : 'Đang chờ GPS...')}
        </div>
      )}

      {/* ---------------- Điểm kế tiếp ---------------- */}
      {current && isRunning && nextStop && (
        <Card style={{ borderColor: within ? DC.brandLine : DC.border, backgroundColor: within ? DC.brandSoft : DC.card }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <Navigation size={14} color={DC.brand} />
            <div style={{ fontSize: 10.5, fontWeight: 800, color: DC.brand, letterSpacing: 0.4 }}>ĐIỂM KẾ TIẾP</div>
            {within && <Pill text="TRONG BÁN KÍNH" fg={DC.success} bg={DC.successSoft} style={{ marginLeft: 'auto' }} />}
          </div>
          <div style={{ fontSize: 16, fontWeight: 900, color: DC.ink }}>{nextStop.name}</div>
          {nextStop.address && (
            <div style={{ fontSize: 11.5, color: DC.muted, fontWeight: 600, marginTop: 3, lineHeight: 1.5 }}>{nextStop.address}</div>
          )}
          <div style={{ display: 'flex', gap: 7, marginTop: 10 }}>
            <BigButton
              tone="ghost"
              style={{ flex: 1, padding: '11px 10px', fontSize: 12.5 }}
              onClick={() => openDirections(Number(nextStop.latitude), Number(nextStop.longitude), nextStop.name)}
            >
              <Navigation size={14} /> Chỉ đường
            </BigButton>
            <BigButton
              style={{ flex: 1.15, padding: '11px 10px', fontSize: 12.5 }}
              disabled={!within || !gpsReady || busy === `ci_${nextStop.stop_id}`}
              onClick={() => void d.checkin(nextStop)}
            >
              <CheckCircle2 size={15} />
              {busy === `ci_${nextStop.stop_id}` ? 'ĐANG GỬI...' : within ? 'XÁC NHẬN' : `${distToNext == null ? '—' : Math.round(distToNext)}m`}
            </BigButton>
          </div>
        </Card>
      )}

      {/* ---------------- Danh sách điểm ---------------- */}
      {current && stops.length > 0 && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
            <MapPin size={16} color={DC.brand} />
            <div style={{ fontSize: 13.5, fontWeight: 900, color: DC.ink }}>Điểm giao trên lộ trình</div>
            {stops.some((s: any) => s.change_request_id) && (
              <Pill text="ĐÃ ĐIỀU CHỈNH" fg={DC.brandDark} bg={DC.brandSoft} style={{ marginLeft: 'auto' }} />
            )}
          </div>

          <div style={{ position: 'relative' }}>
            {stops.map((s: any, idx: number) => {
              const done = !!s.isCompleted;
              const isNext = nextStop?.stop_id === s.stop_id;
              const dist = coords && Number(s.latitude) && Number(s.longitude)
                ? haversine(coords.lat, coords.lng, Number(s.latitude), Number(s.longitude))
                : null;
              const inRange = dist != null && dist <= Number(s.geofence_radius_m || 100);
              const canCheck = isRunning && !done && inRange && gpsReady;
              return (
                <div key={s.stop_id} style={{ display: 'flex', gap: 10, paddingBottom: idx === stops.length - 1 ? 0 : 14 }}>
                  {/* timeline */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 24, flexShrink: 0 }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10.5, fontWeight: 900,
                      backgroundColor: done ? DC.success : isNext ? DC.brand : '#E2E8F0',
                      color: done || isNext ? '#FFF' : DC.muted,
                    }}>
                      {done ? <CheckCircle2 size={13} /> : s.stop_order}
                    </div>
                    {idx !== stops.length - 1 && (
                      <div style={{ width: 2, flex: 1, minHeight: 20, backgroundColor: done ? '#A7F3D0' : DC.border, marginTop: 3 }} />
                    )}
                  </div>

                  <div style={{
                    flex: 1, minWidth: 0, borderRadius: 12, padding: '9px 11px',
                    border: `1px solid ${done ? '#A7F3D0' : isNext ? DC.brandLine : DC.border}`,
                    backgroundColor: done ? '#F0FDF4' : isNext ? DC.brandSoft : '#FFFFFF',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: DC.ink }}>{s.name}</span>
                      {!s.is_mandatory && <Pill text="TÙY CHỌN" fg={DC.muted} bg="#F1F5F9" />}
                      {s.stop_type === 'CHARGING' && <Pill text="TRẠM SẠC" fg={DC.purple} bg={DC.purpleSoft} />}
                    </div>
                    <div style={{ fontSize: 10.5, color: DC.muted, fontWeight: 600, marginTop: 2 }}>
                      SLA {fmtMin(Number(s.sla_minutes || 0))} • bán kính {s.geofence_radius_m}m
                      {dist != null ? ` • cách ${Math.round(dist)}m` : ''}
                    </div>
                    {done && (
                      <div style={{ fontSize: 10.5, color: DC.success, fontWeight: 700, marginTop: 3 }}>
                        ✅ {fmtTime(s.checkedInAt)}
                        {s.isLate ? ` • trễ ${s.lateMinutes} phút` : ''}
                        {Number(s.penaltyAmount) > 0 ? ` • phạt ${Number(s.penaltyAmount).toLocaleString('vi-VN')}đ` : ''}
                      </div>
                    )}
                    {!done && isRunning && (
                      <button
                        onClick={() => void d.checkin(s)}
                        disabled={!canCheck || busy === `ci_${s.stop_id}`}
                        style={{
                          marginTop: 7, padding: '7px 12px', borderRadius: 9, fontSize: 11.5, fontWeight: 800,
                          border: 'none', cursor: canCheck ? 'pointer' : 'not-allowed',
                          backgroundColor: canCheck ? DC.brand : '#F1F5F9',
                          color: canCheck ? '#FFF' : DC.muted, opacity: canCheck ? 1 : 0.8,
                        }}
                      >
                        {busy === `ci_${s.stop_id}` ? '...' : isNext ? 'XÁC NHẬN ĐIỂM' : 'Bấm điểm'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ---------------- Không có ca ---------------- */}
      {!current && (
        <Card>
          <Empty
            icon={<Truck size={34} />}
            title="Hôm nay bạn chưa có ca"
            desc="Ca mới do Quản lý vận chuyển phân công sẽ tự xuất hiện ở đây."
            action={<BigButton tone="ghost" style={{ width: 'auto', padding: '10px 16px', fontSize: 12.5 }} onClick={() => void d.reload()}><RefreshCw size={14} /> Kiểm tra lại</BigButton>}
          />
          {todayShifts.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: DC.ink, marginBottom: 7 }}>Ca trong ngày</div>
              {todayShifts.map((s: any) => {
                const sl = STATUS_LABEL[s.status] || STATUS_LABEL.SCHEDULED;
                return (
                  <div key={s.shift_id} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px',
                    border: `1px solid ${DC.border}`, borderRadius: 10, marginBottom: 6,
                  }}>
                    <Clock size={14} color={DC.muted} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: DC.ink }}>{fmtTime(s.planned_start_at)}</span>
                    <span style={{ marginLeft: 'auto' }}><Pill text={sl.text} fg={sl.fg} bg={sl.bg} /></span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* ---------------- Lịch ca tuần ---------------- */}
      {weekShifts.length > 0 && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
            <CalendarDays size={16} color={DC.brand} />
            <div style={{ fontSize: 13.5, fontWeight: 900, color: DC.ink }}>Lịch ca 7 ngày tới</div>
            <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: DC.muted }}>{weekShifts.length} ca</span>
          </div>
          {weekShifts.map((s: any) => {
            const sl = STATUS_LABEL[s.status] || STATUS_LABEL.SCHEDULED;
            const isToday = String(s.shift_date).slice(0, 10) === today;
            return (
              <div key={s.shift_id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                borderRadius: 10, marginBottom: 5,
                border: `1px solid ${isToday ? DC.brandLine : DC.border}`,
                backgroundColor: isToday ? DC.brandSoft : '#FFFFFF',
              }}>
                <span style={{ fontSize: 11.5, fontWeight: 900, color: isToday ? DC.brandDark : DC.ink, minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {isToday ? 'Hôm nay • ' : ''}{fmtDay(s.shift_date)}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: DC.muted, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtTime(s.planned_start_at)}{s.planned_end_at ? `–${fmtTime(s.planned_end_at)}` : ''}
                </span>
                <Pill text={sl.text} fg={sl.fg} bg={sl.bg} />
              </div>
            );
          })}
          <div style={{ fontSize: 10.5, color: DC.muted, fontWeight: 600, marginTop: 5, lineHeight: 1.6 }}>
            Hệ thống tự tạo ca 08:00–14:00 cho cả tuần. Quản lý vận chuyển có thể sửa giờ từng ngày.
          </div>
        </Card>
      )}

      {/* ---------------- Quy tắc ---------------- */}
      <Card style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: '#92400E', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
          <AlertTriangle size={14} /> Quy tắc ca vận chuyển
        </div>
        <div style={{ fontSize: 11.5, color: '#92400E', lineHeight: 1.75, fontWeight: 600 }}>
          • Bấm điểm khi đứng <b>≤100m</b> so với điểm giao, sai số GPS ≤30m.<br />
          • Mở app là chia sẻ vị trí xe với quản lý (kể cả trước khi bắt đầu ca).<br />
          • Mỗi chặng có SLA riêng — trễ bị trừ điểm phạt vào lương.<br />
          • Quên bấm điểm bắt buộc = điểm bỏ lọt, tính phạt khi kết thúc ca.<br />
          • Sạc xe: tạo phiếu → HR duyệt → Giám đốc duyệt → sạc đúng ngày đăng ký.
        </div>
      </Card>
    </div>
  );
}
