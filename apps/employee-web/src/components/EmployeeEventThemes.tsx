import React from 'react';
import { getThemeConfig, getLunarZodiacInfo } from './loginThemeData';
import type { LoginThemeId } from './loginThemeData';
import {
  WitchHatBadge,
  MiniPumpkinBadge,
  HangingSpiderDangler,
  CuteGhostAccent,
} from './HalloweenDecorations';

export const EMPLOYEE_EVENT_THEMES: Array<{ id: string; name: string; icon: string; desc?: string }> = [
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
 * Phụ kiện mũ/nón/hoa/biểu tượng đội lên logo Bò Sữa trên Cổng Nhân Viên
 * Chỉ hiển thị khi đến thời gian sự kiện (activePortalThemeId không null).
 */
export const EmployeeEventLogoAccessory: React.FC<{ themeId?: string | null }> = ({ themeId }) => {
  if (!themeId) return null;

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
 * Dải phân cách hoa văn lễ hội dưới Header Cổng Nhân Viên
 * Tự động đồng bộ theo sự kiện khi đến giờ bắt đầu.
 */
export const EmployeeHeaderDivider: React.FC<{ themeId?: string | null }> = ({ themeId }) => {
  if (!themeId) return null;

  const theme = getThemeConfig(themeId as LoginThemeId);
  const icons = theme?.garlandIcons && theme.garlandIcons.length > 0
    ? theme.garlandIcons
    : ['🍬', '🎃', '🍬', '🎃'];
  const gradient = theme?.garlandLineColor || 'linear-gradient(90deg, #FF7518 0%, #E14D77 50%, #4A2574 100%)';

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
 * Biểu tượng nhỏ xinh trang trí cạnh tên nhân viên trên thanh Header khi sự kiện bắt đầu
 */
export const EmployeeTitleOrnament: React.FC<{ themeId?: string | null }> = ({ themeId }) => {
  if (!themeId) return null;

  const meta = EMPLOYEE_EVENT_THEMES.find((t) => t.id === themeId);
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

export const CuteTitleBat: React.FC = () => <EmployeeTitleOrnament themeId="halloween" />;
export const HalloweenHeaderDivider: React.FC = () => <EmployeeHeaderDivider themeId="halloween" />;

export {
  WitchHatBadge,
  MiniPumpkinBadge,
  HangingSpiderDangler,
  CuteGhostAccent,
};
