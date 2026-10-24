import React from 'react';

/**
 * loginThemeData.tsx — Hệ thống chủ đề sự kiện phong phú cho cổng nhân viên UBM.
 * Giữ nguyên 100% Logo gốc hiện tại của Ụm Bò Milk (/logo.jpg) trên mọi chủ đề,
 * kết hợp các phụ kiện trang trí theo mùa lễ hội tinh tế trên vành logo (nón Noel,
 * nón phù thủy Halloween, nón lá Việt Nam, khăn đóng Tết, vương miện 8/3, v.v...).
 */

export type LoginThemeId =
  | 'auto'
  | 'tet'
  | 'tet_2027'
  | 'noel'
  | 'vietnam_culture'
  | 'unification_30_4'
  | 'children_day_1_6'
  | 'women_day_8_3'
  | 'national_day_2_9'
  | 'vietnam_women_20_10'
  | 'halloween'
  | 'standard';

export interface LunarZodiacInfo {
  year: number;
  canChiName: string; // e.g. "Bính Ngọ", "Ất Tỵ", "Giáp Thìn"
  animal: string;     // e.g. "Ngựa", "Rắn", "Rồng"
  icon: string;       // e.g. "🐴", "🐍", "🐲"
  headline: string;   // e.g. "Tết Bính Ngọ 2026 🐴 • Vạn Sự Như Ý"
}

export function getLunarZodiacInfo(date = new Date()): LunarZodiacInfo {
  const year = date.getFullYear();
  const CANS = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
  const CHIS = [
    { name: 'Tý', animal: 'Chuột', icon: '🐭' },
    { name: 'Sửu', animal: 'Trâu', icon: '🐮' },
    { name: 'Dần', animal: 'Hổ', icon: '🐯' },
    { name: 'Mão', animal: 'Mèo', icon: '🐱' },
    { name: 'Thìn', animal: 'Rồng', icon: '🐲' },
    { name: 'Tỵ', animal: 'Rắn', icon: '🐍' },
    { name: 'Ngọ', animal: 'Ngựa', icon: '🐴' },
    { name: 'Mùi', animal: 'Dê', icon: '🐐' },
    { name: 'Thân', animal: 'Khỉ', icon: '🐵' },
    { name: 'Dậu', animal: 'Gà', icon: '🐔' },
    { name: 'Tuất', animal: 'Chó', icon: '🐶' },
    { name: 'Hợi', animal: 'Heo', icon: '🐷' },
  ];

  const canIndex = (year + 6) % 10;
  const chiIndex = (year + 8) % 12;
  const can = CANS[canIndex];
  const chi = CHIS[chiIndex];

  return {
    year,
    canChiName: `${can} ${chi.name}`,
    animal: chi.animal,
    icon: chi.icon,
    headline: `Xuân ${can} ${chi.name} ${year} ${chi.icon} • Vạn Sự Như Ý`,
  };
}

export function detectCurrentHolidayTheme(date = new Date()): LoginThemeId {
  const month = date.getMonth() + 1;
  const day = date.getDate();

  if ((month === 1 && day >= 10) || (month === 2 && day <= 22)) return 'tet';
  if (month === 3 && day >= 1 && day <= 10) return 'women_day_8_3';
  if ((month === 4 && day >= 25) || (month === 5 && day <= 3)) return 'unification_30_4';
  if ((month === 5 && day >= 28) || (month === 6 && day <= 5)) return 'children_day_1_6';
  if ((month === 8 && day >= 25) || (month === 9 && day <= 5)) return 'national_day_2_9';
  if (month === 10 && day >= 15 && day <= 22) return 'vietnam_women_20_10';
  if ((month === 10 && day >= 23) || (month === 11 && day <= 2)) return 'halloween';
  if (month === 12 && day >= 12) return 'noel';

  return 'vietnam_culture';
}

export interface ThemeMeta {
  id: LoginThemeId;
  name: string;
  badgeLabel: string;
  icon: string;
  dateRangeDesc: string;
  subTitle: string;
  bgGradient: string;
  ambientStarsColor: string;
  cardBg: string;
  cardBorder: string;
  cardShadow: string;
  logoBorderColor: string;
  logoGlowColor: string;
  brandTitleColor: string;
  brandSubColor: string;
  badgeBg: string;
  badgeColor: string;
  badgeBorder: string;
  garlandLineColor: string;
  garlandIcons: string[];
  fieldLabel: string;
  prefixBg: string;
  prefixColor: string;
  accentColor: string;
  confettiColors: string[];
  renderLogoAccessory?: (zodiac: LunarZodiacInfo) => React.ReactNode;
  renderPeekaboo: (zodiac: LunarZodiacInfo) => React.ReactNode;
  renderBottomLeftOrnament?: (zodiac: LunarZodiacInfo) => React.ReactNode;
  renderTopRightOrnament?: (zodiac: LunarZodiacInfo) => React.ReactNode;
}

export const THEME_LIST: Array<{ id: LoginThemeId; name: string; icon: string; desc: string }> = [
  { id: 'auto', name: 'Tự động theo lịch', icon: '🔄', desc: 'Tự nhận diện ngày lễ thực tế theo thời gian thực' },
  { id: 'tet', name: 'Tết Nguyên Đán', icon: '🧧', desc: 'Realtime theo con giáp của năm (Tý - Hợi)' },
  { id: 'tet_2027', name: 'Tết Đinh Mùi 2027', icon: '🐐', desc: 'Đếm ngược Giao Thừa & Bắn pháo hoa rực rỡ đón xuân Đinh Mùi' },
  { id: 'noel', name: 'Giáng Sinh (Noel)', icon: '🎄', desc: 'Cây thông, bông tuyết, mũ noel đỏ viền lông' },
  { id: 'vietnam_culture', name: 'Văn Hóa Việt Nam', icon: '🪷', desc: 'Trống đồng Đông Sơn, hoa sen, nón lá truyền thống' },
  { id: 'unification_30_4', name: 'Ngày 30/4', icon: '⭐', desc: 'Giải phóng miền Nam, cờ đỏ sao vàng, bồ câu hòa bình' },
  { id: 'children_day_1_6', name: 'Quốc Tế Thiếu Nhi', icon: '🎈', desc: 'Bong bóng nhiều màu, kẹo ngọt, chong chóng tuổi thơ' },
  { id: 'women_day_8_3', name: 'Quốc Tế Phụ Nữ 8/3', icon: '🌹', desc: 'Hoa hồng, tulip, ruy băng lụa tôn vinh phái đẹp' },
  { id: 'national_day_2_9', name: 'Quốc Khánh 2/9', icon: '🇻🇳', desc: 'Tết độc lập, cờ hoa rực rỡ, tự hào non sông' },
  { id: 'vietnam_women_20_10', name: 'Phụ Nữ Việt Nam 20/10', icon: '👒', desc: 'Tà áo dài, đóa sen hồng, nét đẹp người phụ nữ Việt' },
  { id: 'halloween', name: 'Sự kiện Halloween', icon: '🎃', desc: 'Bí ngô, mũ phù thủy, dơi bay, ma nhỏ tinh nghịch' },
  { id: 'standard', name: 'Giao diện tiêu chuẩn', icon: '🌸', desc: 'Phong cách hồng sữa Ụm Bò Milk nguyên bản' },
];

export function getThemeConfig(themeId: LoginThemeId, date = new Date()): ThemeMeta {
  const zodiac = getLunarZodiacInfo(date);
  const resolvedId = themeId === 'auto' ? detectCurrentHolidayTheme(date) : themeId;

  switch (resolvedId) {
    // =========================================================================
    // 1. TẾT THEO TỪNG NĂM (REALTIME CON GIÁP)
    // =========================================================================
    case 'tet':
      return {
        id: 'tet',
        name: `Tết ${zodiac.canChiName}`,
        badgeLabel: `Xuân ${zodiac.canChiName} ${zodiac.year}`,
        icon: '🧧',
        dateRangeDesc: `Năm ${zodiac.animal} may mắn`,
        subTitle: `Nhập SĐT để nhận mã PIN mừng ${zodiac.headline}.`,
        bgGradient: 'linear-gradient(180deg, #7F1D1D 0%, #991B1B 45%, #B91C1C 100%)',
        ambientStarsColor: '#FDE047',
        cardBg: '#FFFBEB',
        cardBorder: '2px solid #D97706',
        cardShadow: '0 25px 60px rgba(120, 15, 15, 0.55), 0 10px 25px rgba(217, 119, 6, 0.28), 0 0 0 6px rgba(245, 158, 11, 0.2)',
        logoBorderColor: '#F59E0B',
        logoGlowColor: 'rgba(245, 158, 11, 0.4)',
        brandTitleColor: '#B91C1C',
        brandSubColor: '#B45309',
        badgeBg: '#FEF3C7',
        badgeColor: '#B45309',
        badgeBorder: '#FCD34D',
        garlandLineColor: 'linear-gradient(90deg, #DC2626, #F59E0B, #DC2626)',
        garlandIcons: ['🌸', '🧧', '💰', zodiac.icon, '💰', '🧧', '🌸'],
        fieldLabel: `SỐ ĐIỆN THOẠI ${zodiac.icon}`,
        prefixBg: '#FEE2E2',
        prefixColor: '#991B1B',
        accentColor: '#DC2626',
        confettiColors: ['#DC2626', '#F59E0B', '#FBBF24', '#F87171', '#FEF08A', '#FFFFFF'],
        renderLogoAccessory: () => (
          <>
            {/* Khăn đóng vàng gấm Tết trên logo */}
            <div style={{ position: 'absolute', top: -11, left: 6, pointerEvents: 'none' }}>
              <svg width="40" height="20" viewBox="0 0 60 30" fill="none">
                <ellipse cx="30" cy="18" rx="26" ry="8" fill="#F59E0B" stroke="#D97706" strokeWidth="1.5" />
                <path d="M6 18 Q30 4 54 18 L51 12 Q30 0 9 12 Z" fill="#D97706" />
                <circle cx="30" cy="16" r="3.5" fill="#DC2626" />
              </svg>
            </div>
            {/* Bao lì xì may mắn góc dưới logo */}
            <div style={{ position: 'absolute', bottom: -5, right: -6, pointerEvents: 'none' }}>
              <svg width="22" height="24" viewBox="0 0 30 35" fill="none">
                <rect x="4" y="4" width="22" height="28" rx="3" fill="#DC2626" stroke="#FEF08A" strokeWidth="1.5" transform="rotate(-12 4 4)" />
                <circle cx="16" cy="18" r="4.5" fill="#FBBF24" />
              </svg>
            </div>
          </>
        ),
        renderPeekaboo: () => (
          <div style={{ display: 'flex', alignItems: 'center', paddingRight: 12, fontSize: 20 }}>
            <span title={`Linh vật ${zodiac.animal} ${zodiac.year}`}>{zodiac.icon}</span>
          </div>
        ),
        renderBottomLeftOrnament: () => (
          <div style={{ position: 'absolute', bottom: -20, left: -10, pointerEvents: 'none' }}>
            <svg width="84" height="64" viewBox="0 0 100 80" fill="none">
              <rect x="10" y="40" width="34" height="34" rx="4" fill="#15803D" stroke="#166534" strokeWidth="2" />
              <line x1="27" y1="40" x2="27" y2="74" stroke="#FEF08A" strokeWidth="2" />
              <line x1="10" y1="57" x2="44" y2="57" stroke="#FEF08A" strokeWidth="2" />
              <path d="M48 55 Q65 42 82 55 L78 68 Q65 72 52 68 Z" fill="#FBBF24" stroke="#D97706" strokeWidth="1.5" />
              <ellipse cx="65" cy="54" rx="12" ry="5" fill="#FDE047" />
              <circle cx="36" cy="32" r="5" fill="#FACC15" />
              <circle cx="28" cy="24" r="4" fill="#FACC15" />
            </svg>
          </div>
        ),
        renderTopRightOrnament: () => (
          <div style={{ position: 'absolute', top: 10, right: 14, pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 24 }} className="pl-float">🏮</span>
            <span style={{ fontSize: 20 }}>🌸</span>
          </div>
        ),
      };

    // =========================================================================
    // 1B. TẾT ĐINH MÙI 2027 (ĐẾM NGƯỢC GIAO THỪA & BẮN PHÁO HOA)
    // =========================================================================
    case 'tet_2027':
      return {
        id: 'tet_2027',
        name: 'Tết Đinh Mùi 2027',
        badgeLabel: 'Giao Thừa 2027 🐐',
        icon: '🐐',
        dateRangeDesc: 'Xuân Đinh Mùi may mắn',
        subTitle: 'Chào đón thời khắc Giao thừa Tết Đinh Mùi 2027 🐐 • An Khang Thịnh Vượng.',
        bgGradient: 'linear-gradient(180deg, #7F1D1D 0%, #991B1B 45%, #B91C1C 100%)',
        ambientStarsColor: '#FDE047',
        cardBg: '#FFFBEB',
        cardBorder: '2px solid #D97706',
        cardShadow: '0 25px 60px rgba(120, 15, 15, 0.55), 0 10px 25px rgba(217, 119, 6, 0.28), 0 0 0 6px rgba(245, 158, 11, 0.2)',
        logoBorderColor: '#F59E0B',
        logoGlowColor: 'rgba(245, 158, 11, 0.45)',
        brandTitleColor: '#B91C1C',
        brandSubColor: '#B45309',
        badgeBg: '#FEF3C7',
        badgeColor: '#B45309',
        badgeBorder: '#FCD34D',
        garlandLineColor: 'linear-gradient(90deg, #DC2626, #F59E0B, #DC2626)',
        garlandIcons: ['🌸', '🧧', '💰', '🐐', '💰', '🧧', '🌸'],
        fieldLabel: 'SỐ ĐIỆN THOẠI 🐐',
        prefixBg: '#FEE2E2',
        prefixColor: '#991B1B',
        accentColor: '#DC2626',
        confettiColors: ['#DC2626', '#F59E0B', '#FBBF24', '#F87171', '#FEF08A', '#FFFFFF'],
        renderLogoAccessory: () => (
          <>
            {/* Cặp sừng dê vàng may mắn & nón khăn đóng trên logo */}
            <div style={{ position: 'absolute', top: -14, left: 4, pointerEvents: 'none' }}>
              <svg width="44" height="24" viewBox="0 0 60 30" fill="none">
                <path d="M14 20 Q6 6 12 2 Q18 4 16 14" stroke="#FBBF24" strokeWidth="3" strokeLinecap="round" fill="none" />
                <path d="M46 20 Q54 6 48 2 Q42 4 44 14" stroke="#FBBF24" strokeWidth="3" strokeLinecap="round" fill="none" />
                <ellipse cx="30" cy="18" rx="20" ry="7" fill="#F59E0B" stroke="#D97706" strokeWidth="1.5" />
                <circle cx="30" cy="17" r="3" fill="#DC2626" />
              </svg>
            </div>
            {/* Dê vàng mini góc logo */}
            <div style={{ position: 'absolute', bottom: -5, right: -5, pointerEvents: 'none', fontSize: 16 }}>
              <span>🐐</span>
            </div>
          </>
        ),
        renderPeekaboo: () => (
          <div style={{ display: 'flex', alignItems: 'center', paddingRight: 12, fontSize: 20 }}>
            <span title="Dê vàng Đinh Mùi 2027">🐐</span>
          </div>
        ),
        renderBottomLeftOrnament: () => (
          <div style={{ position: 'absolute', bottom: -20, left: -10, pointerEvents: 'none' }}>
            <svg width="84" height="64" viewBox="0 0 100 80" fill="none">
              <rect x="10" y="40" width="34" height="34" rx="4" fill="#15803D" stroke="#166534" strokeWidth="2" />
              <line x1="27" y1="40" x2="27" y2="74" stroke="#FEF08A" strokeWidth="2" />
              <line x1="10" y1="57" x2="44" y2="57" stroke="#FEF08A" strokeWidth="2" />
              <path d="M48 55 Q65 42 82 55 L78 68 Q65 72 52 68 Z" fill="#FBBF24" stroke="#D97706" strokeWidth="1.5" />
              <ellipse cx="65" cy="54" rx="12" ry="5" fill="#FDE047" />
              <circle cx="36" cy="32" r="5" fill="#FACC15" />
              <circle cx="28" cy="24" r="4" fill="#FACC15" />
            </svg>
          </div>
        ),
        renderTopRightOrnament: () => (
          <div style={{ position: 'absolute', top: 10, right: 14, pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 24 }} className="pl-float">🏮</span>
            <span style={{ fontSize: 20 }}>🌸</span>
          </div>
        ),
      };
    case 'noel':
      return {
        id: 'noel',
        name: 'Giáng Sinh (Noel)',
        badgeLabel: 'Giáng Sinh An Lành',
        icon: '🎄',
        dateRangeDesc: 'Mùa đông ấm áp',
        subTitle: 'Nhập số điện thoại để vào cổng chấm công mùa Giáng Sinh.',
        bgGradient: 'linear-gradient(180deg, #06281E 0%, #0C3829 50%, #134B38 100%)',
        ambientStarsColor: '#FFFFFF',
        cardBg: '#F8FAF8',
        cardBorder: '2px solid #059669',
        cardShadow: '0 25px 60px rgba(4, 40, 28, 0.6), 0 10px 25px rgba(5, 150, 105, 0.25), 0 0 0 6px rgba(16, 185, 129, 0.16)',
        logoBorderColor: '#10B981',
        logoGlowColor: 'rgba(16, 185, 129, 0.4)',
        brandTitleColor: '#B91C1C',
        brandSubColor: '#047857',
        badgeBg: '#D1FAE5',
        badgeColor: '#065F46',
        badgeBorder: '#6EE7B7',
        garlandLineColor: 'linear-gradient(90deg, #EF4444, #10B981, #EF4444)',
        garlandIcons: ['🎄', '❄️', '🎁', '🎅', '🔔', '❄️', '🎄'],
        fieldLabel: 'SỐ ĐIỆN THOẠI 🎄',
        prefixBg: '#FEE2E2',
        prefixColor: '#B91C1C',
        accentColor: '#DC2626',
        confettiColors: ['#DC2626', '#10B981', '#34D399', '#FBBF24', '#FFFFFF', '#60A5FA'],
        renderLogoAccessory: () => (
          <>
            {/* Nón Noel đỏ viền lông trắng đặt trên logo */}
            <div style={{ position: 'absolute', top: -14, left: 6, pointerEvents: 'none' }}>
              <svg width="42" height="26" viewBox="0 0 60 36" fill="none">
                <ellipse cx="28" cy="28" rx="24" ry="6" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="1.5" />
                <path d="M12 28 C18 10 38 2 52 14" stroke="#DC2626" strokeWidth="14" strokeLinecap="round" />
                <circle cx="53" cy="14" r="6.5" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="1" />
              </svg>
            </div>
            {/* Nhành lá thông đính góc dưới logo */}
            <div style={{ position: 'absolute', bottom: -4, right: -4, pointerEvents: 'none' }}>
              <svg width="20" height="20" viewBox="0 0 30 30" fill="none">
                <circle cx="12" cy="12" r="4" fill="#10B981" />
                <circle cx="18" cy="10" r="4" fill="#059669" />
                <circle cx="15" cy="18" r="3.5" fill="#EF4444" />
              </svg>
            </div>
          </>
        ),
        renderPeekaboo: () => (
          <div style={{ display: 'flex', alignItems: 'center', paddingRight: 12, fontSize: 20 }}>
            <span title="Người tuyết Giáng Sinh">⛄</span>
          </div>
        ),
        renderBottomLeftOrnament: () => (
          <div style={{ position: 'absolute', bottom: -20, left: -8, pointerEvents: 'none' }}>
            <svg width="80" height="60" viewBox="0 0 100 80" fill="none">
              <rect x="20" y="35" width="36" height="36" rx="4" fill="#DC2626" />
              <rect x="18" y="30" width="40" height="9" rx="3" fill="#B91C1C" />
              <line x1="38" y1="30" x2="38" y2="71" stroke="#FEF08A" strokeWidth="4" />
              <line x1="20" y1="50" x2="56" y2="50" stroke="#FEF08A" strokeWidth="4" />
              <circle cx="38" cy="28" r="4" fill="#FBBF24" />
              <circle cx="70" cy="55" r="14" fill="#10B981" />
              <polygon points="70,30 58,55 82,55" fill="#059669" />
            </svg>
          </div>
        ),
        renderTopRightOrnament: () => (
          <div style={{ position: 'absolute', top: 12, right: 14, pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 24 }} className="pl-float">❄️</span>
            <span style={{ fontSize: 22 }}>🔔</span>
          </div>
        ),
      };

    // =========================================================================
    // 3. VĂN HÓA VIỆT NAM (TRỐNG ĐỒNG, HOA SEN, NÓN LÁ)
    // =========================================================================
    case 'vietnam_culture':
      return {
        id: 'vietnam_culture',
        name: 'Văn Hóa Việt Nam',
        badgeLabel: 'Bản Sắc Việt Nam',
        icon: '🪷',
        dateRangeDesc: 'Hồn thiêng sông núi',
        subTitle: 'Chào mừng bạn đến với cổng nhân viên đậm đà bản sắc Việt.',
        bgGradient: 'linear-gradient(180deg, #450A0A 0%, #7F1D1D 45%, #991B1B 100%)',
        ambientStarsColor: '#FDE047',
        cardBg: '#FFFBEB',
        cardBorder: '2px solid #B45309',
        cardShadow: '0 25px 60px rgba(70, 10, 10, 0.6), 0 10px 25px rgba(180, 83, 9, 0.25), 0 0 0 6px rgba(245, 158, 11, 0.18)',
        logoBorderColor: '#D97706',
        logoGlowColor: 'rgba(217, 119, 6, 0.4)',
        brandTitleColor: '#991B1B',
        brandSubColor: '#B45309',
        badgeBg: '#FEF3C7',
        badgeColor: '#92400E',
        badgeBorder: '#FCD34D',
        garlandLineColor: 'linear-gradient(90deg, #B45309, #DC2626, #B45309)',
        garlandIcons: ['🪷', '🏺', '🌾', '🪷', '🌾', '🏺', '🪷'],
        fieldLabel: 'SỐ ĐIỆN THOẠI 🪷',
        prefixBg: '#FEF3C7',
        prefixColor: '#B45309',
        accentColor: '#991B1B',
        confettiColors: ['#DC2626', '#D97706', '#FBBF24', '#059669', '#F472B6', '#FFFFFF'],
        renderLogoAccessory: () => (
          <>
            {/* Nón lá nghiêng trên logo */}
            <div style={{ position: 'absolute', top: -13, left: 4, pointerEvents: 'none' }}>
              <svg width="42" height="24" viewBox="0 0 60 30" fill="none">
                <polygon points="30,4 6,26 54,26" fill="#FDE68A" stroke="#D97706" strokeWidth="1.5" />
                <line x1="30" y1="4" x2="30" y2="26" stroke="#D97706" strokeWidth="1" />
                <line x1="30" y1="4" x2="18" y2="26" stroke="#D97706" strokeWidth="0.8" />
                <line x1="30" y1="4" x2="42" y2="26" stroke="#D97706" strokeWidth="0.8" />
              </svg>
            </div>
            {/* Đóa sen hồng góc logo */}
            <div style={{ position: 'absolute', bottom: -5, right: -5, pointerEvents: 'none' }}>
              <svg width="22" height="22" viewBox="0 0 30 30" fill="none">
                <circle cx="15" cy="15" r="7" fill="#F472B6" />
                <circle cx="15" cy="15" r="3.5" fill="#DB2777" />
              </svg>
            </div>
          </>
        ),
        renderPeekaboo: () => (
          <div style={{ display: 'flex', alignItems: 'center', paddingRight: 12, fontSize: 20 }}>
            <span title="Hoa sen Việt Nam">🪷</span>
          </div>
        ),
        renderBottomLeftOrnament: () => (
          <div style={{ position: 'absolute', bottom: -18, left: -10, pointerEvents: 'none' }}>
            <svg width="80" height="60" viewBox="0 0 100 80" fill="none">
              <circle cx="45" cy="50" r="28" fill="#FDE68A" stroke="#B45309" strokeWidth="3" />
              <circle cx="45" cy="50" r="18" stroke="#D97706" strokeWidth="2" strokeDasharray="3 3" />
              <polygon points="45,35 48,45 58,45 50,52 53,62 45,56 37,62 40,52 32,45 42,45" fill="#B45309" />
              <circle cx="78" cy="56" r="10" fill="#F472B6" />
              <ellipse cx="78" cy="56" rx="6" ry="12" fill="#FDA4AF" />
            </svg>
          </div>
        ),
        renderTopRightOrnament: () => (
          <div style={{ position: 'absolute', top: 12, right: 14, pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 22 }}>🌾</span>
            <span style={{ fontSize: 20 }}>🪷</span>
          </div>
        ),
      };

    // =========================================================================
    // 4. NGÀY 30/4 (GIẢI PHÓNG MIỀN NAM - THỐNG NHẤT)
    // =========================================================================
    case 'unification_30_4':
      return {
        id: 'unification_30_4',
        name: 'Ngày 30/4 (Thống Nhất)',
        badgeLabel: 'Thống Nhất Non Sông',
        icon: '⭐',
        dateRangeDesc: '30/4 & 1/5 Hào hùng',
        subTitle: 'Chào mừng ngày giải phóng miền Nam, thống nhất đất nước.',
        bgGradient: 'linear-gradient(180deg, #0F172A 0%, #1E3A8A 45%, #991B1B 100%)',
        ambientStarsColor: '#FDE047',
        cardBg: '#F8FAFC',
        cardBorder: '2px solid #DC2626',
        cardShadow: '0 25px 60px rgba(15, 23, 42, 0.6), 0 10px 25px rgba(220, 38, 38, 0.25), 0 0 0 6px rgba(239, 68, 68, 0.16)',
        logoBorderColor: '#DC2626',
        logoGlowColor: 'rgba(220, 38, 38, 0.4)',
        brandTitleColor: '#DC2626',
        brandSubColor: '#1E3A8A',
        badgeBg: '#FEE2E2',
        badgeColor: '#991B1B',
        badgeBorder: '#FCA5A5',
        garlandLineColor: 'linear-gradient(90deg, #DC2626, #FBBF24, #0284C7)',
        garlandIcons: ['⭐', '🕊️', '🇻🇳', '⭐', '🇻🇳', '🕊️', '⭐'],
        fieldLabel: 'SỐ ĐIỆN THOẠI ⭐',
        prefixBg: '#FEE2E2',
        prefixColor: '#DC2626',
        accentColor: '#DC2626',
        confettiColors: ['#DC2626', '#FBBF24', '#0284C7', '#FFFFFF', '#38BDF8', '#F59E0B'],
        renderLogoAccessory: () => (
          <>
            {/* Mũ tai bèo giải phóng trên logo */}
            <div style={{ position: 'absolute', top: -12, left: 5, pointerEvents: 'none' }}>
              <svg width="42" height="22" viewBox="0 0 60 28" fill="none">
                <path d="M10 24 Q30 14 50 24 Q30 6 10 24 Z" fill="#15803D" stroke="#166534" strokeWidth="1.5" />
                <ellipse cx="30" cy="22" rx="22" ry="6" fill="#166534" />
                <polygon points="30,12 32,17 37,17 33,20 35,25 30,22 25,25 27,20 23,17 28,17" fill="#FBBF24" />
              </svg>
            </div>
            {/* Sao vàng nhỏ góc logo */}
            <div style={{ position: 'absolute', bottom: -4, right: -4, pointerEvents: 'none' }}>
              <span style={{ fontSize: 16 }}>⭐</span>
            </div>
          </>
        ),
        renderPeekaboo: () => (
          <div style={{ display: 'flex', alignItems: 'center', paddingRight: 12, fontSize: 20 }}>
            <span title="Chim bồ câu hòa bình">🕊️</span>
          </div>
        ),
        renderBottomLeftOrnament: () => (
          <div style={{ position: 'absolute', bottom: -18, left: -10, pointerEvents: 'none' }}>
            <svg width="80" height="60" viewBox="0 0 100 80" fill="none">
              <rect x="20" y="32" width="46" height="32" rx="3" fill="#DC2626" />
              <polygon points="43,40 45,45 50,45 46,48 48,53 43,50 38,53 40,48 36,45 41,45" fill="#FBBF24" />
              <line x1="20" y1="28" x2="20" y2="72" stroke="#475569" strokeWidth="3" />
            </svg>
          </div>
        ),
        renderTopRightOrnament: () => (
          <div style={{ position: 'absolute', top: 12, right: 14, pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 22 }} className="pl-float">🕊️</span>
            <span style={{ fontSize: 20 }}>⭐</span>
          </div>
        ),
      };

    // =========================================================================
    // 5. QUỐC TẾ THIẾU NHI (1/6)
    // =========================================================================
    case 'children_day_1_6':
      return {
        id: 'children_day_1_6',
        name: 'Quốc Tế Thiếu Nhi (1/6)',
        badgeLabel: 'Tuổi Thơ Rực Rỡ',
        icon: '🎈',
        dateRangeDesc: 'Vui cùng ngày 1/6',
        subTitle: 'Cùng Ụm Bò Milk quay về tuổi thơ ngập tràn tiếng cười và màu sắc.',
        bgGradient: 'linear-gradient(180deg, #0284C7 0%, #38BDF8 45%, #F472B6 100%)',
        ambientStarsColor: '#FDE047',
        cardBg: '#FDF4FF',
        cardBorder: '2px solid #EC4899',
        cardShadow: '0 25px 60px rgba(14, 116, 144, 0.45), 0 10px 25px rgba(236, 72, 153, 0.25), 0 0 0 6px rgba(244, 114, 182, 0.2)',
        logoBorderColor: '#EC4899',
        logoGlowColor: 'rgba(236, 72, 153, 0.4)',
        brandTitleColor: '#DB2777',
        brandSubColor: '#0284C7',
        badgeBg: '#FCE7F3',
        badgeColor: '#BE185D',
        badgeBorder: '#FBCFE8',
        garlandLineColor: 'linear-gradient(90deg, #38BDF8, #F472B6, #FBBF24)',
        garlandIcons: ['🎈', '🍭', '🎡', '🧸', '🍬', '🎠', '🎈'],
        fieldLabel: 'SỐ ĐIỆN THOẠI 🎈',
        prefixBg: '#FFE4E6',
        prefixColor: '#E11D48',
        accentColor: '#EC4899',
        confettiColors: ['#F472B6', '#38BDF8', '#FBBF24', '#34D399', '#A855F7', '#FB923C'],
        renderLogoAccessory: () => (
          <>
            {/* Mũ sinh nhật nhiều màu trên logo */}
            <div style={{ position: 'absolute', top: -16, left: 12, pointerEvents: 'none' }}>
              <svg width="26" height="26" viewBox="0 0 40 40" fill="none">
                <polygon points="20,4 6,34 34,34" fill="#EC4899" />
                <circle cx="20" cy="4" r="3.5" fill="#FBBF24" />
                <line x1="10" y1="20" x2="30" y2="20" stroke="#38BDF8" strokeWidth="2" />
                <line x1="13" y1="27" x2="27" y2="27" stroke="#FBBF24" strokeWidth="2" />
              </svg>
            </div>
            {/* Nơ kẹo mini góc logo */}
            <div style={{ position: 'absolute', bottom: -5, right: -5, pointerEvents: 'none' }}>
              <span style={{ fontSize: 16 }}>🍭</span>
            </div>
          </>
        ),
        renderPeekaboo: () => (
          <div style={{ display: 'flex', alignItems: 'center', paddingRight: 12, fontSize: 20 }}>
            <span title="Bé gấu bông ngộ nghĩnh">🧸</span>
          </div>
        ),
        renderBottomLeftOrnament: () => (
          <div style={{ position: 'absolute', bottom: -18, left: -8, pointerEvents: 'none' }}>
            <svg width="80" height="60" viewBox="0 0 100 80" fill="none">
              <circle cx="35" cy="40" r="14" fill="#EF4444" />
              <circle cx="55" cy="35" r="14" fill="#38BDF8" />
              <circle cx="45" cy="50" r="14" fill="#FBBF24" />
              <path d="M35 54 Q42 68 45 78 M55 49 Q48 68 45 78 M45 64 L45 78" stroke="#94A3B8" strokeWidth="1.5" />
            </svg>
          </div>
        ),
        renderTopRightOrnament: () => (
          <div style={{ position: 'absolute', top: 12, right: 14, pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 22 }} className="pl-float">🎈</span>
            <span style={{ fontSize: 20 }}>🍭</span>
          </div>
        ),
      };

    // =========================================================================
    // 6. QUỐC TẾ PHỤ NỮ (8/3)
    // =========================================================================
    case 'women_day_8_3':
      return {
        id: 'women_day_8_3',
        name: 'Quốc Tế Phụ Nữ (8/3)',
        badgeLabel: 'Tôn Vinh Phái Đẹp',
        icon: '🌹',
        dateRangeDesc: 'Yêu thương ngày 8/3',
        subTitle: 'Kính chúc phái đẹp luôn xinh đẹp, hạnh phúc và thành công rực rỡ.',
        bgGradient: 'linear-gradient(180deg, #4C0519 0%, #831843 45%, #9D174D 100%)',
        ambientStarsColor: '#FDA4AF',
        cardBg: '#FFF1F2',
        cardBorder: '2px solid #E11D48',
        cardShadow: '0 25px 60px rgba(76, 5, 25, 0.6), 0 10px 25px rgba(225, 29, 72, 0.25), 0 0 0 6px rgba(244, 63, 94, 0.18)',
        logoBorderColor: '#E11D48',
        logoGlowColor: 'rgba(225, 29, 72, 0.4)',
        brandTitleColor: '#BE185D',
        brandSubColor: '#9D174D',
        badgeBg: '#FFE4E6',
        badgeColor: '#9F1239',
        badgeBorder: '#FECDD3',
        garlandLineColor: 'linear-gradient(90deg, #F43F5E, #FB7185, #F43F5E)',
        garlandIcons: ['🌹', '💖', '🌷', '💐', '🌷', '💖', '🌹'],
        fieldLabel: 'SỐ ĐIỆN THOẠI 🌹',
        prefixBg: '#FCE7F3',
        prefixColor: '#9D174D',
        accentColor: '#E11D48',
        confettiColors: ['#E11D48', '#FB7185', '#F472B6', '#FBBF24', '#FFFFFF', '#FDA4AF'],
        renderLogoAccessory: () => (
          <>
            {/* Vương miện hoa hồng quý phái trên logo */}
            <div style={{ position: 'absolute', top: -12, left: 6, pointerEvents: 'none' }}>
              <svg width="40" height="20" viewBox="0 0 50 25" fill="none">
                <path d="M5 22 L12 8 L25 16 L38 8 L45 22 Z" fill="#FBBF24" stroke="#D97706" strokeWidth="1.5" />
                <circle cx="12" cy="7" r="2.5" fill="#E11D48" />
                <circle cx="25" cy="15" r="2.5" fill="#E11D48" />
                <circle cx="38" cy="7" r="2.5" fill="#E11D48" />
              </svg>
            </div>
            {/* Nhành hoa hồng góc logo */}
            <div style={{ position: 'absolute', bottom: -5, right: -5, pointerEvents: 'none' }}>
              <span style={{ fontSize: 16 }}>🌹</span>
            </div>
          </>
        ),
        renderPeekaboo: () => (
          <div style={{ display: 'flex', alignItems: 'center', paddingRight: 12, fontSize: 20 }}>
            <span title="Hoa hồng yêu thương">🌹</span>
          </div>
        ),
        renderBottomLeftOrnament: () => (
          <div style={{ position: 'absolute', bottom: -18, left: -8, pointerEvents: 'none' }}>
            <svg width="80" height="60" viewBox="0 0 100 80" fill="none">
              <circle cx="35" cy="42" r="10" fill="#E11D48" />
              <circle cx="50" cy="36" r="12" fill="#BE185D" />
              <circle cx="62" cy="44" r="10" fill="#FB7185" />
              <path d="M48 48 L48 72 M42 52 L36 68 M54 52 L60 68" stroke="#15803D" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </div>
        ),
        renderTopRightOrnament: () => (
          <div style={{ position: 'absolute', top: 12, right: 14, pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 22 }} className="pl-float">💖</span>
            <span style={{ fontSize: 20 }}>🌷</span>
          </div>
        ),
      };

    // =========================================================================
    // 7. QUỐC KHÁNH VIỆT NAM (2/9)
    // =========================================================================
    case 'national_day_2_9':
      return {
        id: 'national_day_2_9',
        name: 'Quốc Khánh (2/9)',
        badgeLabel: 'Tết Độc Lập 2/9',
        icon: '🇻🇳',
        dateRangeDesc: 'Tự hào non sông Việt Nam',
        subTitle: 'Chào mừng ngày Quốc khánh 2/9 • Độc lập - Tự do - Hạnh phúc.',
        bgGradient: 'linear-gradient(180deg, #450A0A 0%, #7F1D1D 45%, #991B1B 100%)',
        ambientStarsColor: '#FDE047',
        cardBg: '#FEF2F2',
        cardBorder: '2px solid #DC2626',
        cardShadow: '0 25px 60px rgba(69, 10, 10, 0.6), 0 10px 25px rgba(220, 38, 38, 0.28), 0 0 0 6px rgba(239, 68, 68, 0.18)',
        logoBorderColor: '#DC2626',
        logoGlowColor: 'rgba(220, 38, 38, 0.4)',
        brandTitleColor: '#DC2626',
        brandSubColor: '#B91C1C',
        badgeBg: '#FEE2E2',
        badgeColor: '#991B1B',
        badgeBorder: '#FCA5A5',
        garlandLineColor: 'linear-gradient(90deg, #DC2626, #FBBF24, #DC2626)',
        garlandIcons: ['🇻🇳', '⭐', '🪷', '🇻🇳', '🪷', '⭐', '🇻🇳'],
        fieldLabel: 'SỐ ĐIỆN THOẠI 🇻🇳',
        prefixBg: '#FEE2E2',
        prefixColor: '#DC2626',
        accentColor: '#DC2626',
        confettiColors: ['#DC2626', '#FBBF24', '#F59E0B', '#EF4444', '#FFFFFF'],
        renderLogoAccessory: () => (
          <>
            {/* Ruy băng cờ đỏ sao vàng trên logo */}
            <div style={{ position: 'absolute', top: -10, left: 4, pointerEvents: 'none' }}>
              <svg width="44" height="18" viewBox="0 0 60 22" fill="none">
                <rect x="5" y="4" width="50" height="14" rx="4" fill="#DC2626" stroke="#FEF08A" strokeWidth="1" />
                <polygon points="30,6 32,10 36,10 33,13 34,17 30,14 26,17 27,13 24,10 28,10" fill="#FBBF24" />
              </svg>
            </div>
            {/* Cờ mini góc logo */}
            <div style={{ position: 'absolute', bottom: -5, right: -5, pointerEvents: 'none' }}>
              <span style={{ fontSize: 16 }}>🇻🇳</span>
            </div>
          </>
        ),
        renderPeekaboo: () => (
          <div style={{ display: 'flex', alignItems: 'center', paddingRight: 12, fontSize: 20 }}>
            <span title="Quốc kỳ Việt Nam">🇻🇳</span>
          </div>
        ),
        renderBottomLeftOrnament: () => (
          <div style={{ position: 'absolute', bottom: -18, left: -8, pointerEvents: 'none' }}>
            <svg width="80" height="60" viewBox="0 0 100 80" fill="none">
              <rect x="22" y="30" width="48" height="32" rx="3" fill="#DC2626" />
              <polygon points="46,38 48,43 53,43 49,46 51,51 46,48 41,51 43,46 39,43 44,43" fill="#FBBF24" />
              <line x1="22" y1="26" x2="22" y2="72" stroke="#B45309" strokeWidth="3" />
            </svg>
          </div>
        ),
        renderTopRightOrnament: () => (
          <div style={{ position: 'absolute', top: 12, right: 14, pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 22 }} className="pl-float">🇻🇳</span>
            <span style={{ fontSize: 20 }}>⭐</span>
          </div>
        ),
      };

    // =========================================================================
    // 8. NGÀY PHỤ NỮ VIỆT NAM (20/10)
    // =========================================================================
    case 'vietnam_women_20_10':
      return {
        id: 'vietnam_women_20_10',
        name: 'Phụ Nữ Việt Nam (20/10)',
        badgeLabel: 'Duyên Dáng Việt Nam',
        icon: '👒',
        dateRangeDesc: 'Tôn vinh phụ nữ Việt Nam',
        subTitle: 'Kính chúc chị em phụ nữ luôn rạng ngời, duyên dáng và thành công.',
        bgGradient: 'linear-gradient(180deg, #500724 0%, #831843 45%, #A21CAF 100%)',
        ambientStarsColor: '#F472B6',
        cardBg: '#FFF1F2',
        cardBorder: '2px solid #DB2777',
        cardShadow: '0 25px 60px rgba(80, 7, 36, 0.6), 0 10px 25px rgba(219, 39, 119, 0.25), 0 0 0 6px rgba(244, 114, 182, 0.18)',
        logoBorderColor: '#DB2777',
        logoGlowColor: 'rgba(219, 39, 119, 0.4)',
        brandTitleColor: '#DB2777',
        brandSubColor: '#9D174D',
        badgeBg: '#FCE7F3',
        badgeColor: '#9D174D',
        badgeBorder: '#FBCFE8',
        garlandLineColor: 'linear-gradient(90deg, #DB2777, #F472B6, #DB2777)',
        garlandIcons: ['🪷', '👒', '🌸', '💐', '🌸', '👒', '🪷'],
        fieldLabel: 'SỐ ĐIỆN THOẠI 🪷',
        prefixBg: '#FCE7F3',
        prefixColor: '#9D174D',
        accentColor: '#DB2777',
        confettiColors: ['#DB2777', '#F472B6', '#C084FC', '#FBBF24', '#FFFFFF', '#FDA4AF'],
        renderLogoAccessory: () => (
          <>
            {/* Nón lá duyên dáng quai lụa hồng trên logo */}
            <div style={{ position: 'absolute', top: -13, left: 4, pointerEvents: 'none' }}>
              <svg width="42" height="24" viewBox="0 0 60 30" fill="none">
                <polygon points="30,4 6,26 54,26" fill="#FDE68A" stroke="#F59E0B" strokeWidth="1.5" />
                <path d="M16 26 C16 35 30 40 30 40 C30 40 44 35 44 26" stroke="#DB2777" strokeWidth="1.5" fill="none" />
              </svg>
            </div>
            {/* Búp sen hồng góc logo */}
            <div style={{ position: 'absolute', bottom: -5, right: -5, pointerEvents: 'none' }}>
              <span style={{ fontSize: 16 }}>🪷</span>
            </div>
          </>
        ),
        renderPeekaboo: () => (
          <div style={{ display: 'flex', alignItems: 'center', paddingRight: 12, fontSize: 20 }}>
            <span title="Sen hồng e ấp">🪷</span>
          </div>
        ),
        renderBottomLeftOrnament: () => (
          <div style={{ position: 'absolute', bottom: -18, left: -8, pointerEvents: 'none' }}>
            <svg width="80" height="60" viewBox="0 0 100 80" fill="none">
              <circle cx="45" cy="48" r="18" fill="#FDF2F8" stroke="#DB2777" strokeWidth="2" />
              <circle cx="45" cy="48" r="10" fill="#F472B6" />
              <polygon points="45,28 25,48 65,48" fill="#FDE68A" />
            </svg>
          </div>
        ),
        renderTopRightOrnament: () => (
          <div style={{ position: 'absolute', top: 12, right: 14, pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 22 }} className="pl-float">🪷</span>
            <span style={{ fontSize: 20 }}>🌸</span>
          </div>
        ),
      };

    // =========================================================================
    // 9. HALLOWEEN (ĐÃ BÁM SÁT MOCKUP GỐC CỦA BẠN)
    // =========================================================================
    case 'halloween':
      return {
        id: 'halloween',
        name: 'Sự kiện Halloween',
        badgeLabel: 'Halloween Huyền Bí',
        icon: '🎃',
        dateRangeDesc: '31/10 Đêm lễ hội',
        subTitle: 'Nhập số điện thoại đã đăng ký với HR để nhận mã PIN và vào cổng chấm công.',
        bgGradient: 'linear-gradient(180deg, #180928 0%, #290F3D 45%, #3B1654 100%)',
        ambientStarsColor: '#FDE047',
        cardBg: '#FFF5F8',
        cardBorder: '2px solid #5B21B6',
        cardShadow: '0 25px 60px rgba(15, 5, 29, 0.65), 0 10px 25px rgba(147, 51, 234, 0.25), 0 0 0 6px rgba(168, 85, 247, 0.18)',
        logoBorderColor: '#7C3AED',
        logoGlowColor: 'rgba(124, 58, 237, 0.4)',
        brandTitleColor: '#A21CAF',
        brandSubColor: '#701A75',
        badgeBg: '#D1FAE5',
        badgeColor: '#065F46',
        badgeBorder: '#6EE7B7',
        garlandLineColor: 'linear-gradient(90deg, #F472B6, #FB923C, #F472B6)',
        garlandIcons: ['🍬', '🎃', '🍬', '🎃', '🍬', '🎃', '🍬'],
        fieldLabel: 'SỐ ĐIỆN THOẠI 🎃',
        prefixBg: '#FFEDD5',
        prefixColor: '#C2410C',
        accentColor: '#EA580C',
        confettiColors: ['#F97316', '#FB923C', '#A855F7', '#C084FC', '#10B981', '#34D399', '#FBBF24', '#FFFFFF'],
        renderLogoAccessory: () => (
          <>
            {/* Nón phù thủy tím viền cam trên logo (bám sát mockup) */}
            <div style={{ position: 'absolute', top: -14, left: 6, pointerEvents: 'none' }}>
              <svg width="42" height="26" viewBox="0 0 60 36" fill="none">
                <ellipse cx="30" cy="28" rx="28" ry="6" fill="#6B21A8" />
                <polygon points="30,4 18,26 42,26" fill="#581C87" />
                <rect x="18" y="22" width="24" height="4" fill="#F97316" />
              </svg>
            </div>
            {/* Cặp bí ngô mini góc logo */}
            <div style={{ position: 'absolute', bottom: -5, right: -6, pointerEvents: 'none' }}>
              <svg width="24" height="18" viewBox="0 0 35 25" fill="none">
                <circle cx="12" cy="14" r="9" fill="#EA580C" />
                <circle cx="22" cy="14" r="7" fill="#F97316" />
              </svg>
            </div>
          </>
        ),
        renderPeekaboo: () => (
          <div style={{ display: 'flex', alignItems: 'center', paddingRight: 12 }}>
            <svg width="34" height="34" viewBox="0 0 100 100" fill="none">
              <path d="M50 15 C32 15 22 30 22 52 C22 75 32 80 40 75 C46 71 54 71 60 75 C68 80 78 75 78 52 C78 30 68 15 50 15 Z" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="2.5" />
              <circle cx="42" cy="40" r="4.5" fill="#1E1B4B" />
              <circle cx="58" cy="40" r="4.5" fill="#1E1B4B" />
              <ellipse cx="36" cy="46" rx="4" ry="2.5" fill="#FDA4AF" />
              <ellipse cx="64" cy="46" rx="4" ry="2.5" fill="#FDA4AF" />
              <path d="M46 51 Q50 55 54 51" stroke="#1E1B4B" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </div>
        ),
        renderBottomLeftOrnament: () => (
          <div style={{ position: 'absolute', bottom: -24, left: -12, pointerEvents: 'none' }}>
            <svg width="76" height="58" viewBox="0 0 110 85" fill="none">
              <ellipse cx="45" cy="58" rx="30" ry="22" fill="#F97316" />
              <ellipse cx="45" cy="58" rx="16" ry="22" fill="#EA580C" />
              <ellipse cx="45" cy="42" rx="26" ry="6" fill="#6B21A8" />
              <polygon points="45,10 34,40 56,40" fill="#581C87" />
              <rect x="34" y="36" width="22" height="4" fill="#FBBF24" />
              <ellipse cx="85" cy="64" rx="20" ry="16" fill="#FB923C" />
              <ellipse cx="85" cy="52" rx="17" ry="4.5" fill="#6B21A8" />
              <polygon points="85,30 76,51 94,51" fill="#581C87" />
            </svg>
          </div>
        ),
        renderTopRightOrnament: () => (
          <div style={{ position: 'absolute', top: 12, right: 16, pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 24 }} className="pl-float">👻</span>
            <span style={{ fontSize: 22 }}>🎃</span>
          </div>
        ),
      };

    // =========================================================================
    // 10. TIÊU CHUẨN (STANDARD PINK & MILK)
    // =========================================================================
    case 'standard':
    default:
      return {
        id: 'standard',
        name: 'Giao diện Tiêu Chuẩn',
        badgeLabel: 'Cổng Nhân Viên',
        icon: '🌸',
        dateRangeDesc: 'Phong cách nguyên bản',
        subTitle: 'Nhập số điện thoại đã đăng ký với HR để nhận mã PIN và vào cổng chấm công.',
        bgGradient: 'linear-gradient(180deg, #FFF8F4 0%, #FDF0F4 55%, #FBE7EE 100%)',
        ambientStarsColor: 'rgba(232, 93, 146, 0.1)',
        cardBg: '#FFFFFF',
        cardBorder: '1px solid #F0E2DE',
        cardShadow: '0 1px 0 rgba(255,255,255,.9) inset, 0 20px 50px rgba(157,23,77,.12), 0 8px 20px rgba(232,93,146,.14), 0 0 0 8px rgba(232,93,146,.05)',
        logoBorderColor: '#F8DDE7',
        logoGlowColor: 'rgba(232, 93, 146, 0.35)',
        brandTitleColor: '#E85D92',
        brandSubColor: '#6B7280',
        badgeBg: '#DFF5E8',
        badgeColor: '#065F46',
        badgeBorder: '#A7E3C5',
        garlandLineColor: 'linear-gradient(90deg, #F5D9E3, #E85D92, #10B981)',
        garlandIcons: ['●', '●', '●'],
        fieldLabel: 'SỐ ĐIỆN THOẠI',
        prefixBg: '#F8DDE7',
        prefixColor: '#9D174D',
        accentColor: '#E85D92',
        confettiColors: ['#E85D92', '#F472B6', '#F9A8D4', '#10B981', '#34D399', '#F59E0B', '#FFFFFF'],
        renderLogoAccessory: undefined,
        renderPeekaboo: () => null,
      };
  }
}
