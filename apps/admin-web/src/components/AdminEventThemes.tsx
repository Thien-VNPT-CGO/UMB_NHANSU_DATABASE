import React from 'react';
import { getThemeConfig, getLunarZodiacInfo } from './loginThemeData';
import type { LoginThemeId } from './loginThemeData';
import {
  WitchHatBadge,
  MiniPumpkinBadge,
  HangingSpiderDangler,
  CuteGhostAccent,
} from './HalloweenDecorations';

export const ADMIN_EVENT_THEMES: Array<{ id: string; name: string; icon: string; desc?: string }> = [
  { id: 'noel', name: 'Giáng Sinh (Noel)', icon: '🎄', desc: 'Cây thông, bông tuyết & mũ Noel đỏ viền lông' },
  { id: 'vietnam_culture', name: 'Văn Hóa Việt Nam', icon: '🪷', desc: 'Trống đồng Đông Sơn, hoa sen, nón lá truyền thống' },
  { id: 'tet', name: 'Tết Nguyên Đán', icon: '🧧', desc: 'Khăn đóng gấm đỏ, hoa mai đào & bao lì xì may mắn' },
  { id: 'tet_2027', name: 'Tết 2027', icon: '🐐', desc: 'Tết Đinh Mùi 2027, pháo hoa & rực rỡ đón xuân' },
  { id: 'unification_30_4', name: 'Ngày 30/4', icon: '⭐', desc: 'Cờ đỏ sao vàng, chim bồ câu hòa bình & thống nhất' },
  { id: 'children_day_1_6', name: 'Thiếu Nhi 1/6', icon: '🎈', desc: 'Mũ sinh nhật chóp nhọn, bong bóng & chong chóng' },
  { id: 'women_day_8_3', name: 'Phụ Nữ 8/3', icon: '🌹', desc: 'Vương miện hoa hồng quý phái & ruy băng tôn vinh' },
  { id: 'national_day_2_9', name: 'Quốc Khánh 2/9', icon: '🇻🇳', desc: 'Tết độc lập, cờ đỏ sao vàng & tự hào non sông' },
  { id: 'vietnam_women_20_10', name: 'Phụ Nữ VN 20/10', icon: '👒', desc: 'Nón quai thao Kinh Bắc & đóa sen hồng thanh tao' },
  { id: 'halloween', name: 'Halloween', icon: '🎃', desc: 'Mũ phù thủy tím, kẹo bí ngô & dơi chibi tinh nghịch' },
];

/**
 * Phụ kiện mũ/nón/hoa/biểu tượng đội lên logo Bò Sữa theo từng sự kiện
 */
export const AdminEventLogoAccessory: React.FC<{ themeId: string }> = ({ themeId }) => {
  if (themeId === 'halloween') {
    return (
      <>
        <WitchHatBadge />
        <MiniPumpkinBadge />
      </>
    );
  }

  const theme = getThemeConfig(themeId as LoginThemeId);
  const zodiac = getLunarZodiacInfo();

  if (theme?.renderLogoAccessory) {
    return (
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 12 }}>
        {theme.renderLogoAccessory(zodiac)}
      </div>
    );
  }

  return null;
};

/**
 * Dải phân cách đa sắc hoa văn dưới Header theo từng sự kiện
 */
export const AdminHeaderDivider: React.FC<{ themeId: string }> = ({ themeId }) => {
  const theme = getThemeConfig(themeId as LoginThemeId);
  const icons = theme?.garlandIcons && theme.garlandIcons.length > 0
    ? theme.garlandIcons
    : ['🍬', '🎃', '🍬', '🎃'];
  const gradient = theme?.garlandLineColor || 'linear-gradient(90deg, #FF7518 0%, #E14D77 50%, #4A2574 100%)';

  // Lặp lại chuỗi icons để trải đều trên màn hình lớn
  const displayIcons = [...icons, ...icons, ...icons, ...icons].slice(0, 16);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '3px',
        background: gradient,
        boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
        zIndex: 40,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '-8px',
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'space-around',
          alignItems: 'center',
          fontSize: '12px',
          lineHeight: 1,
          filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.22))',
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      >
        {displayIcons.map((ic, idx) => (
          <span key={idx} style={{ transform: idx % 2 === 0 ? 'translateY(-1px)' : 'translateY(1px)' }}>
            {ic}
          </span>
        ))}
      </div>
    </div>
  );
};

/**
 * Biểu tượng nhỏ xinh trang trí cạnh tiêu đề chính trên thanh Header
 */
export const AdminTitleOrnament: React.FC<{ themeId: string }> = ({ themeId }) => {
  const meta = ADMIN_EVENT_THEMES.find((t) => t.id === themeId);
  if (!meta) return null;

  if (themeId === 'halloween') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          marginLeft: '6px',
          animation: 'batFlutter 2.4s ease-in-out infinite',
          pointerEvents: 'none',
          userSelect: 'none',
          fontSize: '14px',
        }}
        title="Halloween Spooky-Cute"
      >
        🦇
      </span>
    );
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        marginLeft: '6px',
        animation: 'spiderBob 2.6s ease-in-out infinite',
        pointerEvents: 'none',
        userSelect: 'none',
        fontSize: '15px',
      }}
      title={meta.name}
    >
      {meta.icon}
    </span>
  );
};

/**
 * Nút bật/tắt nhanh chủ đề sự kiện trên Header Cổng Admin
 */
export const AdminThemeToggle: React.FC<{
  active: boolean;
  themeId: string;
  onToggle: (next: boolean) => void;
}> = ({ active, themeId, onToggle }) => {
  const meta = ADMIN_EVENT_THEMES.find((t) => t.id === themeId) || {
    id: themeId,
    name: 'Sự kiện',
    icon: '🎨',
  };

  const themeConfig = getThemeConfig(themeId as LoginThemeId);
  const accentColor = themeConfig?.accentColor || '#FF7518';

  return (
    <button
      onClick={() => onToggle(!active)}
      title={active ? `Đang bật giao diện ${meta.name} (Nhấp để về giao diện chuẩn)` : `Bật giao diện ${meta.name}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '5px 12px',
        borderRadius: '999px',
        fontSize: '12px',
        fontWeight: 700,
        cursor: 'pointer',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        backgroundColor: active ? '#FFFFFF' : 'var(--surface)',
        border: active ? `1.5px solid ${accentColor}` : '1px solid var(--border)',
        color: active ? accentColor : 'var(--text-muted)',
        boxShadow: active ? `0 2px 8px ${accentColor}33` : 'none',
      }}
    >
      <span style={{ fontSize: '13px' }}>{meta.icon}</span>
      <span style={{ fontWeight: 800 }}>{meta.name}</span>
      <span
        style={{
          display: 'inline-block',
          padding: '1px 6px',
          borderRadius: '999px',
          fontSize: '10px',
          fontWeight: 800,
          backgroundColor: active ? accentColor : '#E5E7EB',
          color: active ? '#FFFFFF' : '#4B5563',
          letterSpacing: '0.2px',
          transition: 'all 0.2s ease',
        }}
      >
        {active ? 'BẬT' : 'TẮT'}
      </span>
    </button>
  );
};

export const CuteTitleBat: React.FC = () => <AdminTitleOrnament themeId="halloween" />;
export const HalloweenHeaderDivider: React.FC = () => <AdminHeaderDivider themeId="halloween" />;
export const HalloweenThemeToggle: React.FC<{ active: boolean; onToggle: (next: boolean) => void }> = ({ active, onToggle }) => (
  <AdminThemeToggle active={active} themeId="halloween" onToggle={onToggle} />
);

export {
  WitchHatBadge,
  MiniPumpkinBadge,
  HangingSpiderDangler,
  CuteGhostAccent,
};
