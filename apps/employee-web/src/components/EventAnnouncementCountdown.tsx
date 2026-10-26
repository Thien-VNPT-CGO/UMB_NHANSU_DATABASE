import React, { useState, useEffect } from 'react';
import type { LoginThemeId } from './loginThemeData';
import { THEME_LIST } from './loginThemeData';

export interface ScheduledThemeProp {
  enabled: boolean;
  event: LoginThemeId;
  startAt: number;
  endAt: number;
  serverOffsetMs?: number;
}

export interface EventAnnouncementProps {
  /** Lịch sự kiện do Admin cấu hình từ Admin Web (như hình ảnh người dùng cung cấp) */
  scheduledTheme?: ScheduledThemeProp | null;
  /** Chủ đề sự kiện hiện tại */
  currentThemeId?: LoginThemeId;
  /** Callback khi đồng hồ đếm ngược chạm 00:00:00 -> tự động cập nhật sang theme sự kiện tương ứng */
  onAutoUpdateTheme?: (themeId: LoginThemeId) => void;
  /** Biến thể hiển thị: 'card' (trong màn hình đăng nhập) hoặc 'bar' (thanh thông báo đầu trang sau đăng nhập) */
  variant?: 'card' | 'bar';
  /** Cho phép thu gọn/mở rộng */
  allowCollapse?: boolean;
}

export function EventAnnouncementCountdown({
  scheduledTheme,
  currentThemeId = 'standard',
  onAutoUpdateTheme,
  variant = 'card',
}: EventAnnouncementProps) {
  const [now, setNow] = useState(() => Date.now());

  // Cập nhật đồng hồ mỗi giây 1 lần để đếm ngược chính xác từng giây.
  // Tick cả trước giờ bắt đầu (đang đếm ngược) lẫn trong lúc diễn ra.
  useEffect(() => {
    if (!scheduledTheme?.enabled) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [scheduledTheme?.enabled, scheduledTheme?.startAt, scheduledTheme?.endAt]);

  // Lịch hợp lệ? (Admin chưa kích hoạt hẹn giờ -> không hiển thị khung đếm ngược)
  const validSchedule = !!scheduledTheme?.enabled
    && Number.isFinite(scheduledTheme.startAt)
    && Number.isFinite(scheduledTheme.endAt)
    && scheduledTheme.endAt > scheduledTheme.startAt;

  const serverNow = now + (scheduledTheme?.serverOffsetMs || 0);
  const isUpcoming = validSchedule && serverNow < (scheduledTheme?.startAt ?? 0);
  const isExpired = validSchedule && serverNow >= (scheduledTheme?.endAt ?? 0);

  // Lấy metadata chủ đề sự kiện Admin đã chọn (Noel, Halloween, 30/4, Tết...)
  const eventId = (scheduledTheme?.event || 'standard') as LoginThemeId;
  const eventMeta = THEME_LIST.find((t) => t.id === eventId) || {
    id: eventId,
    name: 'Sự kiện Đặc Biệt',
    icon: '🎉',
    desc: '',
  };

  // Mốc thời gian mục tiêu đếm ngược:
  // - Nếu sắp diễn ra (upcoming): Đếm ngược đến ngày & giờ bắt đầu (startAt) để CẬP NHẬT giao diện
  // - Nếu đang diễn ra (active): Đếm ngược đến ngày & giờ kết thúc (endAt)
  const targetTimestamp = isUpcoming ? (scheduledTheme?.startAt ?? 0) : (scheduledTheme?.endAt ?? 0);
  const diffMs = Math.max(0, targetTimestamp - serverNow);

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

  // KHI THỜI GIAN ĐẾM NGƯỢC KẾT THÚC (chạm 00:00:00):
  // Tự động gọi callback để cập nhật ngay giao diện vào cổng nhân viên!
  // Hook phải nằm TRƯỚC mọi early-return để không vi phạm Rules of Hooks.
  useEffect(() => {
    if (validSchedule && !isExpired && diffMs <= 0 && isUpcoming && onAutoUpdateTheme) {
      onAutoUpdateTheme(eventId);
    }
  }, [validSchedule, isExpired, diffMs, isUpcoming, eventId, onAutoUpdateTheme]);

  // Lịch chưa bật / không hợp lệ / đã kết thúc -> ẩn thông báo.
  if (!validSchedule || isExpired) return null;

  // Định dạng ngày giờ bắt đầu để hiển thị rõ ràng cho nhân viên biết mốc giờ Admin đã setup
  const startDateStr = new Date(scheduledTheme.startAt).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  });

  const endDateStr = new Date(scheduledTheme.endAt).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  });

  // =========================================================================
  // BIẾN THỂ 1: THANH THÔNG BÁO GỌN (BAR) - HIỂN THỊ ĐẦU TRANG CỔNG ĐÃ ĐĂNG NHẬP
  // =========================================================================
  if (variant === 'bar') {
    return (
      <div
        style={{
          background: isUpcoming
            ? 'linear-gradient(90deg, #1E1B4B 0%, #312E81 50%, #4338CA 100%)'
            : 'linear-gradient(90deg, #064E3B 0%, #047857 50%, #059669 100%)',
          borderBottom: isUpcoming ? '2px solid #818CF8' : '2px solid #34D399',
          color: '#FFFFFF',
          padding: '8px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          fontSize: 12.5,
          zIndex: 40,
          position: 'relative',
          boxShadow: isUpcoming ? '0 4px 15px rgba(99, 102, 241, 0.35)' : '0 4px 15px rgba(16, 185, 129, 0.35)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 16 }}>{eventMeta.icon}</span>
          <span
            style={{
              fontWeight: 800,
              padding: '2px 8px',
              borderRadius: 6,
              background: 'rgba(255,255,255,0.2)',
              color: '#FFFFFF',
              fontSize: 11,
              letterSpacing: '.04em',
            }}
          >
            {isUpcoming ? '● SẮP DIỄN RA' : '● ĐANG DIỄN RA'}
          </span>
          <span style={{ fontWeight: 800 }}>
            {eventMeta.name}:
          </span>
          <span style={{ color: '#E0E7FF' }}>
            {isUpcoming ? 'Tự động cập nhật giao diện sau:' : 'Thời gian còn lại:'}
          </span>
          <span
            style={{
              fontFamily: 'monospace',
              fontWeight: 900,
              fontSize: 13.5,
              color: '#FDE047',
              background: 'rgba(0,0,0,0.35)',
              padding: '2px 8px',
              borderRadius: 6,
              border: '1px solid rgba(253, 224, 71, 0.5)',
            }}
          >
            {days > 0 ? `${days} ngày ` : ''}
            {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
          </span>
        </div>
      </div>
    );
  }

  // =========================================================================
  // BIẾN THỂ 2: HỘP THÔNG BÁO SỰ KIỆN GỌN NHỎ (CARD) - TRONG MÀN HÌNH ĐĂNG NHẬP
  // =========================================================================
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        marginBottom: 12,
        borderRadius: 14,
        overflow: 'hidden',
        background: isUpcoming
          ? 'linear-gradient(135deg, rgba(24, 18, 43, 0.95) 0%, rgba(45, 27, 78, 0.95) 100%)'
          : 'linear-gradient(135deg, rgba(6, 78, 59, 0.95) 0%, rgba(4, 120, 87, 0.95) 100%)',
        border: isUpcoming ? '1.5px solid #F59E0B' : '1.5px solid #10B981',
        boxShadow: isUpcoming
          ? '0 4px 16px rgba(245, 158, 11, 0.25)'
          : '0 4px 16px rgba(16, 185, 129, 0.25)',
        color: '#FFFFFF',
        padding: '9px 12px 8px',
        transition: 'all .3s ease',
      }}
    >
      {/* Hàng 1: Tiêu đề thông báo + Badge trạng thái + Tên sự kiện */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 7,
          fontSize: 11,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 13 }}>📢</span>
          <span
            style={{
              fontWeight: 900,
              letterSpacing: '.05em',
              textTransform: 'uppercase',
              color: '#FFFFFF',
              fontSize: 10.5,
            }}
          >
            Thông Báo Sự Kiện
          </span>
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 800,
              padding: '1.5px 6px',
              borderRadius: 999,
              background: isUpcoming ? '#F59E0B' : '#10B981',
              color: '#FFFFFF',
              boxShadow: isUpcoming ? '0 0 6px rgba(245, 158, 11, 0.6)' : '0 0 6px rgba(16, 185, 129, 0.6)',
            }}
          >
            ● {isUpcoming ? 'SẮP DIỄN RA' : 'ĐANG ÁP DỤNG'}
          </span>
        </div>

        <div
          style={{
            fontSize: 11.5,
            fontWeight: 800,
            color: '#FDE047',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span>{eventMeta.icon}</span>
          <span>{eventMeta.name}</span>
        </div>
      </div>

      {/* Hàng 2: Thời gian đếm ngược dạng thanh số digital gọn gàng */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
        }}
      >
        <div style={{ fontSize: 11.5, fontWeight: 700, color: '#F1F5F9' }}>
          {isUpcoming ? '⏰ Cập nhật sau:' : '🎉 Còn lại:'}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {days > 0 && (
            <span
              style={{
                background: 'rgba(0, 0, 0, 0.45)',
                padding: '2.5px 6px',
                borderRadius: 6,
                color: isUpcoming ? '#FDE047' : '#6EE7B7',
                fontWeight: 900,
                fontFamily: 'monospace',
                fontSize: 12.5,
                border: '1px solid rgba(255, 255, 255, 0.12)',
              }}
            >
              {days} ngày
            </span>
          )}
          <span
            style={{
              background: 'rgba(0, 0, 0, 0.45)',
              padding: '2.5px 8px',
              borderRadius: 6,
              color: isUpcoming ? '#FDE047' : '#6EE7B7',
              fontWeight: 900,
              fontFamily: 'monospace',
              fontSize: 13,
              letterSpacing: '.05em',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              textShadow: isUpcoming ? '0 0 8px rgba(253, 224, 71, 0.5)' : '0 0 8px rgba(110, 231, 183, 0.5)',
            }}
          >
            {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
          </span>
        </div>
      </div>

      {/* Hàng 3: Mốc giờ áp dụng theo lịch Admin */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 6,
          paddingTop: 5,
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          fontSize: 10,
          color: '#94A3B8',
        }}
      >
        <span>
          {isUpcoming ? 'Áp dụng lúc: ' : 'Kết thúc: '}
          <b style={{ color: isUpcoming ? '#FDE047' : '#6EE7B7' }}>
            {isUpcoming ? startDateStr : endDateStr}
          </b>
        </span>
        <span style={{ fontStyle: 'italic', color: '#CBD5E1' }}>
          {isUpcoming ? 'Tự động kích hoạt khi đến giờ' : 'Đang chạy theo lịch Admin'}
        </span>
      </div>
    </div>
  );
}
