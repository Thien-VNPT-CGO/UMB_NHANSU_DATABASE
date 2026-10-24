import React from 'react';

/**
 * Mũ phù thủy tím chibi đội trên logo Bò Sữa
 * Tím phù thủy (#4A2574) với dải ruy băng cam bí ngô (#FF7518) và khóa vàng
 */
export const WitchHatBadge: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      top: '-14px',
      left: '-8px',
      width: '32px',
      height: '26px',
      pointerEvents: 'none',
      zIndex: 12,
      filter: 'drop-shadow(0 2px 4px rgba(74, 37, 116, 0.45))',
      transform: 'rotate(-12deg)',
    }}
  >
    <svg viewBox="0 0 48 40" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
      {/* Vành mũ phù thủy */}
      <ellipse cx="24" cy="31" rx="22" ry="5.5" fill="#351755" />
      <ellipse cx="24" cy="29.5" rx="20" ry="4" fill="#4A2574" />
      {/* Chóp nón nhọn uốn nhẹ */}
      <path d="M24 2C24 2 28 13 35 27H13C20 13 24 2 24 2Z" fill="#4A2574" />
      <path d="M24 2C24 2 21 8 20 16C23 18 28 17 31 15C33 21 35 27 35 27H28C27 23 25 17 24 2Z" fill="#5F3294" />
      {/* Dải băng màu cam bí ngô */}
      <path d="M14 25.5C18 27.5 30 27.5 34 25.5L34.5 28.5C31 30.5 17 30.5 13.5 28.5L14 25.5Z" fill="#FF7518" />
      {/* Khóa vàng sang trọng */}
      <rect x="21" y="24" width="6" height="5" rx="1.5" fill="#F59E0B" stroke="#B45309" strokeWidth="0.8" />
      <rect x="22.5" y="25.5" width="3" height="2" fill="#4A2574" />
    </svg>
  </div>
);

/**
 * Quả bí ngô nhỏ xinh xắn ở góc dưới logo Bò Sữa
 */
export const MiniPumpkinBadge: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      bottom: '-6px',
      right: '-8px',
      width: '22px',
      height: '22px',
      pointerEvents: 'none',
      zIndex: 12,
      filter: 'drop-shadow(0 2px 4px rgba(255, 117, 24, 0.45))',
    }}
  >
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
      {/* Cuống bí ngô xanh lá */}
      <path d="M16 3C15 6 17 8 16 10" stroke="#15803D" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M17 5C19 4 21 6 21 7" stroke="#16A34A" strokeWidth="1.5" strokeLinecap="round" />
      {/* Thân bí ngô cam căng tròn */}
      <ellipse cx="16" cy="19" rx="12" ry="10" fill="#FF7518" />
      <ellipse cx="11" cy="19" rx="7" ry="9" fill="#FF8C38" />
      <ellipse cx="21" cy="19" rx="7" ry="9" fill="#FF8C38" />
      <ellipse cx="16" cy="19" rx="5" ry="9" fill="#FFA25B" />
      {/* Mắt và nụ cười cute tím phù thủy */}
      <path d="M12 16L13.5 18H10.5L12 16Z" fill="#351755" />
      <path d="M20 16L21.5 18H18.5L20 16Z" fill="#351755" />
      <path d="M12 21C13.5 24 18.5 24 20 21C18 22 14 22 12 21Z" fill="#351755" />
    </svg>
  </div>
);

/**
 * Dải phân cách (Divider) kẹo ngọt xen kẽ bí ngô (🍬 🎃 🍬)
 * Trên thanh tiến trình chuyển sắc cam (#FF7518) - hồng (#E14D77) - tím (#4A2574)
 */
export const HalloweenHeaderDivider: React.FC = () => (
  <div
    style={{
      position: 'relative',
      width: '100%',
      height: '6px',
      background: 'linear-gradient(90deg, #FF7518 0%, #E14D77 50%, #4A2574 100%)',
      boxShadow: '0 2px 6px rgba(255, 117, 24, 0.25)',
      pointerEvents: 'none',
      zIndex: 40,
    }}
  >
    <div
      style={{
        position: 'absolute',
        top: '-7px',
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center',
        fontSize: '11px',
        lineHeight: 1,
        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))',
        userSelect: 'none',
        pointerEvents: 'none',
      }}
    >
      <span>🍬</span>
      <span>🎃</span>
      <span>🍬</span>
      <span>🎃</span>
      <span>🍬</span>
      <span>🎃</span>
      <span>🍬</span>
      <span>🎃</span>
      <span>🍬</span>
    </div>
  </div>
);

/**
 * Nhện nhỏ thả tơ đu đưa bên lề phải
 */
export const HangingSpiderDangler: React.FC = () => (
  <div
    className="halloween-spider-dangler"
    style={{
      position: 'fixed',
      top: 0,
      right: '18px',
      zIndex: 35,
      pointerEvents: 'none',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
    }}
  >
    {/* Sợi tơ nhện mỏng manh */}
    <div style={{ width: '1px', height: '54px', backgroundColor: '#F5D0C5', opacity: 0.9 }} />
    {/* Thân chú nhện chibi tím */}
    <div
      style={{
        width: '18px',
        height: '18px',
        borderRadius: '50%',
        backgroundColor: '#4A2574',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 3px 6px rgba(74, 37, 116, 0.35)',
      }}
    >
      {/* 2 mắt cam sáng lấp lánh */}
      <div style={{ width: '3px', height: '3px', borderRadius: '50%', backgroundColor: '#FF7518', position: 'absolute', top: '4.5px', left: '4px' }} />
      <div style={{ width: '3px', height: '3px', borderRadius: '50%', backgroundColor: '#FF7518', position: 'absolute', top: '4.5px', right: '4px' }} />
      {/* Nụ cười mỉm trắng cute */}
      <div style={{ width: '5px', height: '2.5px', borderBottom: '1.2px solid #FFFFFF', borderRadius: '0 0 4px 4px', position: 'absolute', bottom: '4px' }} />
      {/* 4 cặp chân nhện */}
      <svg style={{ position: 'absolute', top: '-4px', left: '-8px', width: '34px', height: '26px', pointerEvents: 'none' }} viewBox="0 0 34 26">
        <path d="M8 8 Q2 12 4 18" stroke="#4A2574" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <path d="M8 12 Q1 17 3 24" stroke="#4A2574" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <path d="M26 8 Q32 12 30 18" stroke="#4A2574" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <path d="M26 12 Q33 17 31 24" stroke="#4A2574" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  </div>
);

/**
 * Chú dơi tím nhỏ sải cánh cạnh tiêu đề chính
 */
export const CuteTitleBat: React.FC = () => (
  <span
    className="halloween-bat-flutter"
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: '6px',
      pointerEvents: 'none',
      verticalAlign: 'middle',
    }}
  >
    <svg width="18" height="13" viewBox="0 0 32 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M16 10C18 6 22 2 28 4C27 9 28 13 32 15C28 17 25 15 24 19C21 16 19 18 16 14C13 18 11 16 8 19C7 15 4 17 0 15C4 13 5 9 4 4C10 2 14 6 16 10Z"
        fill="#4A2574"
      />
      <circle cx="14" cy="9.5" r="1.3" fill="#FF7518" />
      <circle cx="18" cy="9.5" r="1.3" fill="#FF7518" />
      <polygon points="13,7.5 14,4.5 15,7.5" fill="#4A2574" />
      <polygon points="17,7.5 18,4.5 19,7.5" fill="#4A2574" />
    </svg>
  </span>
);

/**
 * Bé ma trắng dễ thương 👻 bay lượn ở góc màn hình / chân trang
 */
export const CuteGhostAccent: React.FC<{ inline?: boolean }> = ({ inline = false }) => (
  <div
    className="halloween-ghost-float"
    style={{
      position: inline ? 'relative' : 'fixed',
      bottom: inline ? 'auto' : '14px',
      right: inline ? 'auto' : '14px',
      pointerEvents: 'none',
      zIndex: 30,
      userSelect: 'none',
      fontSize: inline ? '16px' : '22px',
      filter: 'drop-shadow(0 3px 6px rgba(74, 37, 116, 0.25))',
    }}
  >
    👻
  </div>
);

/**
 * Nút bật/tắt nhanh chế độ Spooky-Cute Halloween trên Header
 */
export const HalloweenThemeToggle: React.FC<{
  active?: boolean;
  onToggle?: (next: boolean) => void;
}> = () => null;
