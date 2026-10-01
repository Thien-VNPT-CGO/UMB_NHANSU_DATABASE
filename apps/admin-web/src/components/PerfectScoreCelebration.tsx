import React, { useEffect, useRef } from 'react';

interface Props {
  name: string;
  total: number;
  rubric: string;
  onClose: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface Rocket {
  x: number;
  y: number;
  vy: number;
  color: string;
}

const COLORS = ['#FFD166', '#EF476F', '#06D6A0', '#118AB2', '#9B5DE5', '#F15BB5', '#FFFFFF'];

/** Màn pháo hoa + bảng tuyên dương ứng viên đạt tuyệt đối. Canvas 2D thuần, không phụ thuộc lib. */
export const PerfectScoreCelebration: React.FC<Props> = ({ name, total, rubric, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let rockets: Rocket[] = [];
    let sparks: Particle[] = [];
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const launch = () => {
      rockets.push({
        x: Math.random() * canvas.width * 0.8 + canvas.width * 0.1,
        y: canvas.height + 10,
        vy: -(canvas.height * 0.012 + Math.random() * 3),
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      });
    };

    const explode = (x: number, y: number, color: string) => {
      const n = 70 + Math.floor(Math.random() * 40);
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 * i) / n + Math.random() * 0.2;
        const speed = 1.5 + Math.random() * 4.5;
        sparks.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          maxLife: 50 + Math.random() * 30,
          color: Math.random() < 0.25 ? '#FFFFFF' : color,
          size: 1.5 + Math.random() * 2.5,
        });
      }
    };

    let frames = 0;
    const tick = () => {
      frames++;
      if (frames % 28 === 0 && rockets.length < 6) launch();
      ctx.fillStyle = 'rgba(5, 8, 25, 0.22)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      rockets = rockets.filter(r => {
        r.y += r.vy;
        ctx.fillStyle = r.color;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 3, 0, Math.PI * 2);
        ctx.fill();
        if (r.vy > -1 || r.y < canvas.height * 0.25 + Math.random() * 40) {
          explode(r.x, r.y, r.color);
          return false;
        }
        return true;
      });

      sparks = sparks.filter(p => {
        p.life++;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.045;
        p.vx *= 0.985;
        const alpha = Math.max(0, 1 - p.life / p.maxLife);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        return p.life < p.maxLife;
      });

      raf = requestAnimationFrame(tick);
    };
    ctx.fillStyle = '#050819';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    raf = requestAnimationFrame(tick);

    const auto = setTimeout(onClose, 15000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(auto);
      window.removeEventListener('resize', resize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <div style={{ position: 'relative', textAlign: 'center', padding: '0 20px', animation: 'fx-pop-in 0.5s ease' }}>
        <div style={{ fontSize: '15px', fontWeight: 800, letterSpacing: '4px', color: '#FFD166', marginBottom: '10px' }}>
          🎉 TUYÊN DƯƠNG 🎉
        </div>
        <div style={{
          fontSize: 'clamp(28px, 6vw, 54px)', fontWeight: 900, color: '#FFF',
          textShadow: '0 0 24px rgba(255,209,102,0.9), 0 4px 0 rgba(0,0,0,0.4)',
          marginBottom: '12px', lineHeight: 1.2,
        }}>
          {name}
        </div>
        <div style={{
          display: 'inline-block', fontSize: 'clamp(18px, 4vw, 30px)', fontWeight: 900,
          color: '#050819', background: 'linear-gradient(135deg, #FFD166, #FF9F1C)',
          padding: '8px 28px', borderRadius: '999px', boxShadow: '0 0 32px rgba(255,209,102,0.8)',
          marginBottom: '12px',
        }}>
          ⭐ {total}/13 TUYỆT ĐỐI ⭐
        </div>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#E2E8F0', marginBottom: '20px' }}>
          {rubric}
        </div>
        <button
          onClick={onClose}
          style={{ padding: '12px 36px', borderRadius: '999px', backgroundColor: '#FFF', color: '#050819', fontSize: '15px', fontWeight: 900, border: 'none', cursor: 'pointer', boxShadow: '0 4px 20px rgba(255,255,255,0.35)' }}
        >
          Tuyệt vời! Đóng lại
        </button>
      </div>
    </div>
  );
};
