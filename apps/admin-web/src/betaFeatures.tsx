/**
 * BETA-FEATURES — nhãn "chạy thử" cho chức năng mới của cổng quản trị.
 *
 * CÁCH DÙNG (1 nơi duy nhất):
 *  - Ra tính năng mới: thêm 1 dòng `'<tabId>': { note: '...' }` vào BETA_FEATURES.
 *    → Sidebar hiện viền + chip BETA, click vào tab hiện dải banner BETA.
 *  - Tính năng chốt chính thức (đã qua xác động 1 tuần): XÓA dòng đó
 *    → hết chip, hết banner tại toàn bộ vị trí (không phải sửa code nơi khác).
 *
 * Tab id khớp mảng `tabs` theo vai trò trong App.tsx (ví dụ 'hr-schedule',
 * 'store-schedule', 'hr-leave'...). Ghi chú (note) hiện ngay trên banner.
 */
import React from 'react';

export type BetaFeatureNote = { note: string };

export const BETA_FEATURES: Record<string, BetaFeatureNote> = {
  // ==== VÍ DỤ (bỏ dòng dưới khi tính năng chính thức) ====
  'hr-schedule': { note: 'Nhập lịch làm việc bằng Excel đang chạy thử (Beta) — dùng thử, góp ý rồi chốt chính thức.' },
};

/** id tab có nổi Beta không */
export const isBetaFeature = (id?: string | null): boolean =>
  !!id && Object.prototype.hasOwnProperty.call(BETA_FEATURES, id);

/** Ghi chú của tính năng Beta (nếu có) */
export const betaNoteOf = (id?: string | null): string =>
  isBetaFeature(id) ? BETA_FEATURES[String(id)].note : '';

/** Chip pill nhỏ gắn cạnh tên tab / tiêu đề */
export const BetaChip: React.FC<{ title?: string }> = ({ title }) => (
  <span
    title={title || 'Tính năng đang chạy thử (Beta)'}
    style={{
      flexShrink: 0,
      fontSize: '9px',
      fontWeight: 800,
      letterSpacing: '0.5px',
      color: '#B45309',
      backgroundColor: '#FEF3C7',
      border: '1px solid #FCD34D',
      borderRadius: '10px',
      padding: '1px 6px',
      lineHeight: '14px',
    }}
  >
    BETA
  </span>
);

/** Dải banner chéo đầu trang khi tính năng đang mở là Beta */
export const BetaBanner: React.FC<{ tabId?: string | null }> = ({ tabId }) => {
  if (!isBetaFeature(tabId)) return null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 24px',
        fontSize: '12px',
        fontWeight: 600,
        color: '#92400E',
        backgroundColor: '#FFFBEB',
        borderBottom: '1px solid #FDE68A',
      }}
    >
      <span
        style={{
          fontSize: '10px',
          fontWeight: 800,
          letterSpacing: '0.6px',
          color: '#B45309',
          backgroundColor: '#FEF3C7',
          border: '1px solid #FCD34D',
          borderRadius: '10px',
          padding: '1px 8px',
        }}
      >
        BETA
      </span>
      <span>{betaNoteOf(tabId)}</span>
    </div>
  );
};
