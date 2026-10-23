import React, { useState, useEffect, useRef } from 'react';

/**
 * TetCountdownAndFireworks.tsx
 * Đồng hồ đếm ngược thời gian thực đến thời khắc Giao Thừa Tết Đinh Mùi 2027 (00:00:00 ngày 06/02/2027 Dương lịch)
 * và tự động khai hỏa màn trình diễn pháo hoa tầm cao Canvas 60fps khi đến Giao Thừa.
 */

interface TetCountdownProps {
  targetYear?: number;
  zodiacAnimal?: string; // 'Dê'
  zodiacIcon?: string;   // '🐐'
  canChiName?: string;   // 'Đinh Mùi'
}

// 00:00:00 ngày 06/02/2027 Dương lịch (Thời khắc Giao thừa chuyển sang Mùng 1 Tết Đinh Mùi 2027)
const TET_2027_MIDNIGHT = new Date('2027-02-06T00:00:00+07:00').getTime();

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
}

function calculateTimeLeft(targetTime: number): TimeLeft {
  const now = Date.now();
  const diff = targetTime - now;
  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, totalMs: 0 };
  }
  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / (1000 * 60)) % 60),
    seconds: Math.floor((diff / 1000) % 60),
    totalMs: diff,
  };
}

export function TetCountdownAndFireworks({
  targetYear = 2027,
  zodiacAnimal = 'Dê',
  zodiacIcon = '🐐',
  canChiName = 'Đinh Mùi',
}: TetCountdownProps) {
  const targetTimestamp = TET_2027_MIDNIGHT;
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(() => calculateTimeLeft(targetTimestamp));
  const [isFireworksActive, setIsFireworksActive] = useState(() => Date.now() >= TET_2027_MIDNIGHT);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number>(0);

  // Cập nhật đồng hồ đếm ngược mỗi giây
  useEffect(() => {
    const timer = setInterval(() => {
      const left = calculateTimeLeft(targetTimestamp);
      setTimeLeft(left);

      // Khi đến thời khắc Giao Thừa (diff <= 0), tự động bắn pháo hoa
      if (left.totalMs <= 0 && !isFireworksActive) {
        setIsFireworksActive(true);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [targetTimestamp, isFireworksActive]);

  // =========================================================================
  // Canvas Fireworks Simulation Engine (60 FPS Particle Physics)
  // =========================================================================
  useEffect(() => {
    if (!isFireworksActive) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    interface Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      alpha: number;
      color: string;
      size: number;
      decay: number;
    }

    interface Rocket {
      x: number;
      y: number;
      targetY: number;
      vx: number;
      vy: number;
      color: string;
      trail: Array<{ x: number; y: number }>;
    }

    const fireworksPalette = [
      '#EF4444', '#F59E0B', '#FBBF24', '#10B981', '#3B82F6',
      '#A855F7', '#EC4899', '#F43F5E', '#FDE047', '#FFFFFF',
    ];

    const particles: Particle[] = [];
    const rockets: Rocket[] = [];

    const createExplosion = (x: number, y: number, baseColor: string) => {
      const count = 90 + Math.floor(Math.random() * 60);
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.2;
        const speed = 2 + Math.random() * 7;
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          alpha: 1,
          color: Math.random() > 0.3 ? baseColor : fireworksPalette[Math.floor(Math.random() * fireworksPalette.length)],
          size: 2 + Math.random() * 2.5,
          decay: 0.012 + Math.random() * 0.016,
        });
      }
    };

    const launchRocket = () => {
      const x = width * 0.15 + Math.random() * (width * 0.7);
      const targetY = height * 0.12 + Math.random() * (height * 0.45);
      const color = fireworksPalette[Math.floor(Math.random() * fireworksPalette.length)];
      rockets.push({
        x,
        y: height,
        targetY,
        vx: (Math.random() - 0.5) * 2,
        vy: -(11 + Math.random() * 5),
        color,
        trail: [],
      });
    };

    // Khởi đầu bắn pháo hoa
    launchRocket();
    launchRocket();
    setTimeout(launchRocket, 400);

    let launchCooldown = 0;

    const render = () => {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.22)';
      ctx.fillRect(0, 0, width, height);

      launchCooldown++;
      if (launchCooldown > 26) {
        launchRocket();
        if (Math.random() > 0.4) launchRocket();
        launchCooldown = 0;
      }

      // Tên lửa bay lên
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.trail.push({ x: r.x, y: r.y });
        if (r.trail.length > 8) r.trail.shift();

        for (const t of r.trail) {
          ctx.beginPath();
          ctx.arc(t.x, t.y, 2, 0, Math.PI * 2);
          ctx.fillStyle = r.color;
          ctx.fill();
        }

        r.x += r.vx;
        r.y += r.vy;
        r.vy += 0.08;

        if (r.y <= r.targetY || r.vy >= 0) {
          createExplosion(r.x, r.y, r.color);
          rockets.splice(i, 1);
        }
      }

      // Tàn hoa nở bung
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.12;
        p.vx *= 0.98;
        p.vy *= 0.98;
        p.alpha -= p.decay;

        if (p.alpha <= 0) {
          particles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isFireworksActive]);

  return (
    <div style={{ position: 'relative', width: '100%', marginBottom: 16 }}>
      {/* =====================================================================
          COUNTDOWN WIDGET (HỘP ĐỒNG HỒ ĐẾM NGƯỢC GIAO THỪA 2027)
          ===================================================================== */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(127, 29, 29, 0.95), rgba(153, 27, 27, 0.95))',
          borderRadius: 20,
          border: '2px solid #F59E0B',
          boxShadow: '0 8px 24px rgba(185, 28, 28, 0.35), 0 0 0 4px rgba(245, 158, 11, 0.18)',
          padding: '14px 16px',
          color: '#FFFFFF',
          textAlign: 'center',
          backdropFilter: 'blur(8px)',
        }}
      >
        {/* Tiêu đề Giao Thừa */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, fontWeight: 900, color: '#FEF08A', letterSpacing: '.03em', textTransform: 'uppercase' }}>
          <span>⏳</span>
          <span>Đếm ngược Giao Thừa {canChiName} {targetYear} {zodiacIcon}</span>
        </div>

        <div style={{ fontSize: 11.5, color: '#FCD34D', marginTop: 3, fontWeight: 600 }}>
          Thời khắc chuyển giao: 00:00:00 • 06/02/{targetYear} Dương lịch
        </div>

        {/* 4 Khung thời gian: Ngày - Giờ - Phút - Giây */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginTop: 10,
          }}
        >
          {[
            { val: timeLeft.days, label: 'Ngày' },
            { val: timeLeft.hours, label: 'Giờ' },
            { val: timeLeft.minutes, label: 'Phút' },
            { val: timeLeft.seconds, label: 'Giây' },
          ].map((item, idx) => (
            <React.Fragment key={item.label}>
              <div
                style={{
                  background: 'linear-gradient(180deg, #450A0A 0%, #1C0404 100%)',
                  borderRadius: 12,
                  border: '1.5px solid #FBBF24',
                  boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
                  padding: '6px 8px',
                  minWidth: 54,
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 20, fontWeight: 900, color: '#FDE047', fontFamily: 'monospace', lineHeight: 1.1 }}>
                  {String(item.val).padStart(2, '0')}
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#FCA5A5', marginTop: 2, textTransform: 'uppercase' }}>
                  {item.label}
                </div>
              </div>
              {idx < 3 && (
                <span style={{ fontSize: 18, fontWeight: 900, color: '#F59E0B' }}>:</span>
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Thông báo trạng thái tinh tế (không còn nút demo thử) */}
        <div style={{ marginTop: 10, fontSize: 11.5, color: '#FEF08A', fontWeight: 600 }}>
          {timeLeft.totalMs <= 0
            ? '🎆 Giao thừa đã điểm — Chúc Mừng Năm Mới Đinh Mùi 2027!'
            : '✨ Pháo hoa tự động khai hỏa khi đồng hồ điểm đúng 00:00:00 Giao Thừa'}
        </div>
      </div>

      {/* =====================================================================
          CANVAS FULLSCREEN FIREWORKS OVERLAY
          ===================================================================== */}
      {isFireworksActive && (
        <>
          <canvas
            ref={canvasRef}
            style={{
              position: 'fixed',
              inset: 0,
              width: '100vw',
              height: '100vh',
              pointerEvents: 'none',
              zIndex: 990,
            }}
          />

          {/* Biểu ngữ chúc mừng năm mới lấp lánh trên đầu */}
          <div
            style={{
              position: 'fixed',
              top: 18,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 995,
              background: 'linear-gradient(135deg, rgba(185, 28, 28, 0.95), rgba(120, 15, 15, 0.95))',
              border: '2px solid #FBBF24',
              borderRadius: 999,
              padding: '10px 24px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.5), 0 0 20px rgba(245, 158, 11, 0.5)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              color: '#FFFFFF',
              whiteSpace: 'nowrap',
              animation: 'pl-banner-float 3s ease-in-out infinite alternate',
            }}
          >
            <span style={{ fontSize: 26 }}>🎆</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 900, color: '#FDE047', letterSpacing: '.02em' }}>
                CHÚC MỪNG NĂM MỚI {canChiName.toUpperCase()} {targetYear} {zodiacIcon}
              </div>
              <div style={{ fontSize: 12, color: '#FEF08A', fontWeight: 700 }}>
                VẠN SỰ NHƯ Ý • AN KHANG THỊNH VƯỢNG • ỤM BÒ MILK
              </div>
            </div>
            <button
              onClick={() => setIsFireworksActive(false)}
              style={{
                marginLeft: 10,
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                borderRadius: '50%',
                width: 26,
                height: 26,
                color: '#FFF',
                fontWeight: 900,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Đóng pháo hoa"
            >
              ✕
            </button>
          </div>
        </>
      )}

      <style>{`
        @keyframes pl-banner-float {
          0% { transform: translate(-50%, 0); }
          100% { transform: translate(-50%, -6px); }
        }
      `}</style>
    </div>
  );
}

export default TetCountdownAndFireworks;
