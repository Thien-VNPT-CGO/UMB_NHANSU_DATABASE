import React, { useEffect, useRef } from 'react';
import { LoginThemeId } from './loginThemeData';

/**
 * ThemeAmbientEffects.tsx
 * Hệ thống hiệu ứng hạt môi trường Canvas 60fps sống động, rõ nét cho từng sự kiện:
 * - Halloween: Bé ma trắng 👻 bay bổng, đàn dơi 🦇 sải cánh, bí ngô 🎃 phát sáng & đom đóm ma trơi tím/cam rực rỡ.
 * - 2/9 (Quốc Khánh): Pháo hoa Tết Độc Lập đỏ vàng bung nở liên tục, sao vàng 5 cánh ⭐ và kim tuyến hào hùng.
 * - Noel: Tuyết trắng rơi lãng mạn (Snowfall flurries).
 * - Văn Hóa VN & 20/10: Cánh sen hồng mềm mại lượn gió (Lotus petals).
 * - 8/3: Mưa cánh hoa hồng đỏ & trái tim bay (Rose petals & hearts).
 * - 1/6 (Thiếu nhi): Bong bóng xà phòng ngũ sắc óng ánh (Iridescent bubbles).
 * - 30/4: Bồ câu trắng hòa bình & ánh sao chiến thắng (Peace doves & stars).
 * - Tết & Tết 2027: Cánh mai vàng & hoa đào phơi phới (Blossoms).
 */

interface ThemeAmbientEffectsProps {
  themeId: LoginThemeId;
}

export function ThemeAmbientEffects({ themeId }: ThemeAmbientEffectsProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (themeId === 'standard') return;

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

    let animationFrameId = 0;
    let tickCount = 0;

    // =========================================================================
    // 1. HALLOWEEN: MA NHỎ TRẮNG 👻, DƠI BAY 🦇 & BÍ NGÔ 🎃 PHÁT SÁNG
    // =========================================================================
    const halloweenGhosts = Array.from({ length: 5 }, () => ({
      x: Math.random() * width,
      y: height + Math.random() * 200,
      size: 26 + Math.random() * 12,
      vy: -(0.9 + Math.random() * 1.3),
      vx: (Math.random() - 0.5) * 0.8,
      wobble: Math.random() * Math.PI * 2,
      alpha: 0.75 + Math.random() * 0.25,
    }));

    const halloweenBats = Array.from({ length: 4 }, (v, i) => ({
      x: width + 40 + i * 160,
      y: height * 0.12 + Math.random() * (height * 0.4),
      size: 28 + Math.random() * 10,
      vx: -(2.4 + Math.random() * 1.4),
      vy: (Math.random() - 0.5) * 0.9,
      wing: Math.random() * Math.PI * 2,
    }));

    const halloweenOrbs = Array.from({ length: 18 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: 4 + Math.random() * 4,
      vx: (Math.random() - 0.5) * 0.9,
      vy: (Math.random() - 0.5) * 0.9,
      color: Math.random() > 0.5 ? '#A855F7' : '#F97316',
      alpha: 0.5 + Math.random() * 0.5,
    }));

    // =========================================================================
    // 2. QUỐC KHÁNH 2/9: PHÁO HOA TẾT ĐỘC LẬP & SAO VÀNG 5 CÁNH ⭐
    // =========================================================================
    interface Spark29 { x: number; y: number; vx: number; vy: number; alpha: number; color: string; decay: number; size: number; }
    const nationalSparks: Spark29[] = [];

    const triggerNationalFirework = (x: number, y: number, isGold = false) => {
      const colors = isGold
        ? ['#FDE047', '#FBBF24', '#F59E0B', '#FFFFFF']
        : ['#EF4444', '#DC2626', '#FBBF24', '#FEF08A'];
      const count = 55 + Math.floor(Math.random() * 30);
      for (let i = 0; i < count; i++) {
        const a = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.25;
        const s = 2 + Math.random() * 5.5;
        nationalSparks.push({
          x, y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          alpha: 1,
          color: colors[Math.floor(Math.random() * colors.length)],
          decay: 0.016 + Math.random() * 0.018,
          size: 2 + Math.random() * 2,
        });
      }
    };

    // Khởi đầu bắn 2 quả pháo hoa ngay lập tức cho 2/9
    triggerNationalFirework(width * 0.3, height * 0.22, false);
    triggerNationalFirework(width * 0.7, height * 0.28, true);

    const nationalStars = Array.from({ length: 16 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: 10 + Math.random() * 10,
      vy: 0.7 + Math.random() * 1.3,
      vx: (Math.random() - 0.5) * 0.8,
      rot: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 0.04,
      alpha: 0.6 + Math.random() * 0.4,
    }));

    // =========================================================================
    // 3. NOEL: TUYẾT RƠI (SNOWFALL)
    // =========================================================================
    const snowParticles = Array.from({ length: 50 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: 2 + Math.random() * 3.5,
      vy: 1.0 + Math.random() * 2.0,
      sway: Math.random() * Math.PI * 2,
      alpha: 0.5 + Math.random() * 0.5,
    }));

    // =========================================================================
    // 4. VĂN HÓA VN & 20/10: CÁNH SEN HỒNG
    // =========================================================================
    const lotusPetals = Array.from({ length: 24 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: 11 + Math.random() * 10,
      vy: 0.8 + Math.random() * 1.3,
      vx: 0.6 + Math.random() * 1.2,
      angle: Math.random() * Math.PI * 2,
      vAngle: (Math.random() - 0.5) * 0.035,
      alpha: 0.6 + Math.random() * 0.4,
    }));

    // =========================================================================
    // 5. 8/3: HOA HỒNG & TRÁI TIM
    // =========================================================================
    const roseItems = Array.from({ length: 26 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: 10 + Math.random() * 10,
      vy: 0.9 + Math.random() * 1.4,
      vx: (Math.random() - 0.5) * 1.2,
      angle: Math.random() * Math.PI * 2,
      vAngle: (Math.random() - 0.5) * 0.04,
      isHeart: Math.random() > 0.6,
      alpha: 0.6 + Math.random() * 0.4,
    }));

    // =========================================================================
    // 6. 1/6 THIẾU NHI: BONG BÓNG XÀ PHÒNG
    // =========================================================================
    const bubbles = Array.from({ length: 26 }, () => ({
      x: Math.random() * width,
      y: height + Math.random() * 100,
      r: 12 + Math.random() * 22,
      vy: -(0.8 + Math.random() * 1.6),
      wobble: Math.random() * Math.PI * 2,
      alpha: 0.45 + Math.random() * 0.45,
    }));

    // =========================================================================
    // 7. 30/4: BỒ CÂU HÒA BÌNH & SAO VÀNG
    // =========================================================================
    const doves = Array.from({ length: 4 }, (v, i) => ({
      x: -60 - i * 160,
      y: height * 0.18 + Math.random() * (height * 0.35),
      vx: 2.0 + Math.random() * 0.8,
      vy: -0.2 - Math.random() * 0.4,
      wing: 0,
      scale: 0.9 + Math.random() * 0.4,
    }));

    // =========================================================================
    // 8. TẾT & TẾT 2027: CÁNH MAI VÀNG & HOA ĐÀO
    // =========================================================================
    const blossoms = Array.from({ length: 28 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: 8 + Math.random() * 10,
      vy: 0.9 + Math.random() * 1.5,
      vx: 0.5 + Math.random() * 1.2,
      angle: Math.random() * Math.PI * 2,
      vAngle: (Math.random() - 0.5) * 0.04,
      isMai: Math.random() > 0.45,
      alpha: 0.65 + Math.random() * 0.35,
    }));

    // =========================================================================
    // MAIN RENDER LOOP (60 FPS)
    // =========================================================================
    const render = () => {
      ctx.clearRect(0, 0, width, height);
      tickCount++;

      // -----------------------------------------------------------------------
      // HALLOWEEN: MA NHỎ TRẮNG 👻, DƠI BAY 🦇 & ĐOM ĐÓM TÍM/CAM
      // -----------------------------------------------------------------------
      if (themeId === 'halloween') {
        // 1. Đom đóm tím & cam huyền bí lập lòe
        for (const o of halloweenOrbs) {
          o.x += o.vx;
          o.y += o.vy;
          if (o.x < 0 || o.x > width) o.vx *= -1;
          if (o.y < 0 || o.y > height) o.vy *= -1;

          ctx.beginPath();
          ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
          ctx.fillStyle = o.color;
          ctx.globalAlpha = o.alpha * (0.6 + Math.sin(tickCount * 0.06) * 0.4);
          ctx.shadowBlur = 12;
          ctx.shadowColor = o.color;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
        }

        // 2. Bé ma trắng má hồng 👻 bay từ dưới lên
        for (const g of halloweenGhosts) {
          g.y += g.vy;
          g.x += Math.sin(g.wobble) * 0.7;
          g.wobble += 0.035;

          if (g.y < -60) {
            g.y = height + 60;
            g.x = Math.random() * width;
          }

          ctx.save();
          ctx.translate(g.x, g.y);
          ctx.globalAlpha = g.alpha;

          // Thân ma trắng
          ctx.fillStyle = '#FFFFFF';
          ctx.shadowBlur = 10;
          ctx.shadowColor = 'rgba(168, 85, 247, 0.4)';
          ctx.beginPath();
          const w = g.size * 0.75;
          const h = g.size;
          ctx.moveTo(-w / 2, h / 2);
          ctx.quadraticCurveTo(-w / 2, -h / 2, 0, -h / 2);
          ctx.quadraticCurveTo(w / 2, -h / 2, w / 2, h / 2);
          ctx.quadraticCurveTo(w / 4, h * 0.35, 0, h / 2);
          ctx.quadraticCurveTo(-w / 4, h * 0.35, -w / 2, h / 2);
          ctx.fill();
          ctx.shadowBlur = 0;

          // Mắt đen & má hồng
          ctx.fillStyle = '#1E1B4B';
          ctx.beginPath();
          ctx.arc(-w * 0.22, -h * 0.1, 2.5, 0, Math.PI * 2);
          ctx.arc(w * 0.22, -h * 0.1, 2.5, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#FDA4AF';
          ctx.beginPath();
          ctx.arc(-w * 0.3, 0, 3, 0, Math.PI * 2);
          ctx.arc(w * 0.3, 0, 3, 0, Math.PI * 2);
          ctx.fill();

          ctx.restore();
        }

        // 3. Đàn dơi 🦇 sải cánh đen bay chéo qua trời đêm
        for (const b of halloweenBats) {
          b.x += b.vx;
          b.y += b.vy;
          b.wing += 0.25;

          if (b.x < -70) {
            b.x = width + 70;
            b.y = height * 0.1 + Math.random() * (height * 0.45);
          }

          ctx.save();
          ctx.translate(b.x, b.y);
          ctx.fillStyle = '#1E1035';
          ctx.strokeStyle = '#C084FC';
          ctx.lineWidth = 1;

          // Đầu và thân dơi
          ctx.beginPath();
          ctx.arc(0, 0, b.size * 0.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // Cánh dơi vỗ nhịp
          const wingSpan = Math.sin(b.wing) * (b.size * 0.45);
          ctx.beginPath();
          ctx.moveTo(-b.size * 0.7, -wingSpan);
          ctx.quadraticCurveTo(-b.size * 0.35, -wingSpan * 0.6, 0, 0);
          ctx.quadraticCurveTo(b.size * 0.35, -wingSpan * 0.6, b.size * 0.7, -wingSpan);
          ctx.lineTo(0, b.size * 0.25);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Mắt đỏ ma mị
          ctx.fillStyle = '#EF4444';
          ctx.beginPath();
          ctx.arc(-2.5, -2, 1.5, 0, Math.PI * 2);
          ctx.arc(2.5, -2, 1.5, 0, Math.PI * 2);
          ctx.fill();

          ctx.restore();
        }
      }

      // -----------------------------------------------------------------------
      // QUỐC KHÁNH 2/9: PHÁO HOA TẾT ĐỘC LẬP & SAO VÀNG 5 CÁNH ⭐
      // -----------------------------------------------------------------------
      else if (themeId === 'national_day_2_9') {
        // Cứ mỗi 36 tick (~0.6 giây) nổ 1 quả pháo hoa chúc mừng Quốc Khánh
        if (tickCount % 36 === 0) {
          const px = width * 0.18 + Math.random() * (width * 0.64);
          const py = height * 0.12 + Math.random() * (height * 0.36);
          triggerNationalFirework(px, py, Math.random() > 0.5);
        }

        // Vẽ và cập nhật tàn pháo hoa
        for (let i = nationalSparks.length - 1; i >= 0; i--) {
          const s = nationalSparks[i];
          s.x += s.vx;
          s.y += s.vy;
          s.vy += 0.08;
          s.vx *= 0.98;
          s.vy *= 0.98;
          s.alpha -= s.decay;

          if (s.alpha <= 0) {
            nationalSparks.splice(i, 1);
            continue;
          }

          ctx.save();
          ctx.globalAlpha = s.alpha;
          ctx.fillStyle = s.color;
          ctx.shadowBlur = 6;
          ctx.shadowColor = s.color;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // Vẽ sao vàng 5 cánh rơi nhẹ
        for (const st of nationalStars) {
          st.y += st.vy;
          st.x += st.vx;
          st.rot += st.vRot;

          if (st.y > height + 20) {
            st.y = -20;
            st.x = Math.random() * width;
          }

          ctx.save();
          ctx.translate(st.x, st.y);
          ctx.rotate(st.rot);
          ctx.globalAlpha = st.alpha;
          ctx.fillStyle = '#FBBF24';
          ctx.shadowBlur = 8;
          ctx.shadowColor = '#F59E0B';

          // Vẽ sao 5 cánh
          ctx.beginPath();
          for (let k = 0; k < 5; k++) {
            const rotA = (k * Math.PI * 2) / 5 - Math.PI / 2;
            const rotB = rotA + Math.PI / 5;
            const rOuter = st.size;
            const rInner = st.size * 0.45;
            if (k === 0) ctx.moveTo(Math.cos(rotA) * rOuter, Math.sin(rotA) * rOuter);
            else ctx.lineTo(Math.cos(rotA) * rOuter, Math.sin(rotA) * rOuter);
            ctx.lineTo(Math.cos(rotB) * rInner, Math.sin(rotB) * rInner);
          }
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }

      // -----------------------------------------------------------------------
      // NOEL: TUYẾT RƠI (SNOWFALL)
      // -----------------------------------------------------------------------
      else if (themeId === 'noel') {
        for (const p of snowParticles) {
          p.y += p.vy;
          p.x += Math.sin(p.sway) * 0.7;
          p.sway += 0.025;

          if (p.y > height + 10) {
            p.y = -10;
            p.x = Math.random() * width;
          }

          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha})`;
          ctx.shadowBlur = 4;
          ctx.shadowColor = '#FFFFFF';
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      // -----------------------------------------------------------------------
      // VĂN HÓA VN & 20/10: CÁNH SEN HỒNG
      // -----------------------------------------------------------------------
      else if (themeId === 'vietnam_culture' || themeId === 'vietnam_women_20_10') {
        for (const p of lotusPetals) {
          p.y += p.vy;
          p.x += p.vx;
          p.angle += p.vAngle;

          if (p.y > height + 20 || p.x > width + 20) {
            p.y = -20;
            p.x = Math.random() * (width * 0.85);
          }

          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          ctx.globalAlpha = p.alpha;
          ctx.beginPath();
          ctx.moveTo(0, -p.size);
          ctx.bezierCurveTo(p.size * 0.6, -p.size * 0.4, p.size * 0.6, p.size * 0.6, 0, p.size);
          ctx.bezierCurveTo(-p.size * 0.6, p.size * 0.6, -p.size * 0.6, -p.size * 0.4, 0, -p.size);
          ctx.fillStyle = '#FB7185';
          ctx.shadowBlur = 4;
          ctx.shadowColor = '#FDA4AF';
          ctx.fill();
          ctx.restore();
        }
      }

      // -----------------------------------------------------------------------
      // 8/3: HOA HỒNG & TRÁI TIM
      // -----------------------------------------------------------------------
      else if (themeId === 'women_day_8_3') {
        for (const p of roseItems) {
          p.y += p.vy;
          p.x += p.vx;
          p.angle += p.vAngle;

          if (p.y > height + 20) {
            p.y = -20;
            p.x = Math.random() * width;
          }

          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          ctx.globalAlpha = p.alpha;

          if (p.isHeart) {
            ctx.beginPath();
            const topCurveHeight = p.size * 0.3;
            ctx.moveTo(0, topCurveHeight);
            ctx.bezierCurveTo(0, 0, -p.size / 2, 0, -p.size / 2, topCurveHeight);
            ctx.bezierCurveTo(-p.size / 2, (p.size + topCurveHeight) / 2, 0, (p.size + topCurveHeight) / 2, 0, p.size);
            ctx.bezierCurveTo(0, (p.size + topCurveHeight) / 2, p.size / 2, (p.size + topCurveHeight) / 2, p.size / 2, topCurveHeight);
            ctx.bezierCurveTo(p.size / 2, 0, 0, 0, 0, topCurveHeight);
            ctx.fillStyle = '#F43F5E';
            ctx.shadowBlur = 6;
            ctx.shadowColor = '#FB7185';
            ctx.fill();
          } else {
            ctx.beginPath();
            ctx.ellipse(0, 0, p.size * 0.55, p.size * 0.85, 0, 0, Math.PI * 2);
            ctx.fillStyle = '#E11D48';
            ctx.fill();
          }
          ctx.restore();
        }
      }

      // -----------------------------------------------------------------------
      // 1/6 THIẾU NHI: BONG BÓNG XÀ PHÒNG
      // -----------------------------------------------------------------------
      else if (themeId === 'children_day_1_6') {
        for (const b of bubbles) {
          b.y += b.vy;
          b.x += Math.sin(b.wobble) * 0.6;
          b.wobble += 0.035;

          if (b.y < -40) {
            b.y = height + 40;
            b.x = Math.random() * width;
          }

          ctx.save();
          ctx.globalAlpha = b.alpha;
          const grad = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.1, b.x, b.y, b.r);
          grad.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
          grad.addColorStop(0.6, 'rgba(56, 189, 248, 0.25)');
          grad.addColorStop(0.9, 'rgba(244, 114, 182, 0.4)');
          grad.addColorStop(1, 'rgba(168, 85, 247, 0.5)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
          ctx.fill();

          ctx.beginPath();
          ctx.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.2, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.fill();
          ctx.restore();
        }
      }

      // -----------------------------------------------------------------------
      // 30/4: BỒ CÂU HÒA BÌNH
      // -----------------------------------------------------------------------
      else if (themeId === 'unification_30_4') {
        for (const d of doves) {
          d.x += d.vx;
          d.y += d.vy;
          d.wing += 0.18;

          if (d.x > width + 80) {
            d.x = -80;
            d.y = height * 0.18 + Math.random() * (height * 0.35);
          }

          ctx.save();
          ctx.translate(d.x, d.y);
          ctx.scale(d.scale, d.scale);
          ctx.fillStyle = '#FFFFFF';
          ctx.shadowBlur = 6;
          ctx.shadowColor = 'rgba(255, 255, 255, 0.6)';
          ctx.beginPath();
          ctx.ellipse(0, 0, 16, 7, 0.2, 0, Math.PI * 2);
          ctx.fill();

          const wingSpan = Math.sin(d.wing) * 14;
          ctx.beginPath();
          ctx.moveTo(-5, 0);
          ctx.lineTo(-2, -wingSpan - 4);
          ctx.lineTo(10, 0);
          ctx.fill();
          ctx.restore();
        }
      }

      // -----------------------------------------------------------------------
      // TẾT & TẾT 2027: CÁNH MAI VÀNG & HOA ĐÀO
      // -----------------------------------------------------------------------
      else if (themeId === 'tet' || themeId === 'tet_2027') {
        for (const b of blossoms) {
          b.y += b.vy;
          b.x += b.vx;
          b.angle += b.vAngle;

          if (b.y > height + 20 || b.x > width + 20) {
            b.y = -20;
            b.x = Math.random() * (width * 0.85);
          }

          ctx.save();
          ctx.translate(b.x, b.y);
          ctx.rotate(b.angle);
          ctx.globalAlpha = b.alpha;

          ctx.fillStyle = b.isMai ? '#FACC15' : '#F472B6';
          for (let i = 0; i < 5; i++) {
            const rot = (i * Math.PI * 2) / 5;
            ctx.beginPath();
            ctx.arc(Math.cos(rot) * (b.size * 0.5), Math.sin(rot) * (b.size * 0.5), b.size * 0.45, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.beginPath();
          ctx.arc(0, 0, b.size * 0.25, 0, Math.PI * 2);
          ctx.fillStyle = b.isMai ? '#EA580C' : '#DB2777';
          ctx.fill();

          ctx.restore();
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [themeId]);

  if (themeId === 'standard') return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    />
  );
}

export default ThemeAmbientEffects;
