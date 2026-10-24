import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  LoginThemeId,
  THEME_LIST,
  getThemeConfig,
  getLunarZodiacInfo,
  detectCurrentHolidayTheme,
} from './loginThemeData';
import { TetCountdownAndFireworks } from './TetCountdownAndFireworks';
import { ThemeAmbientEffects } from './ThemeAmbientEffects';
import { EventAnnouncementCountdown, ScheduledThemeProp } from './EventAnnouncementCountdown';

/**
 * PremiumLogin — Màn hình đăng nhập SĐT + PIN 6 số cho cổng nhân viên UBM.
 * Hỗ trợ toàn diện 10 chủ đề sự kiện:
 * 1. Noel (Giáng sinh)
 * 2. Văn Hóa Việt Nam (Trống đồng, hoa sen, nón lá)
 * 3. Tết theo từng năm (Realtime theo con giáp và Can Chi)
 * 4. 30/4 (Giải phóng miền Nam - Thống nhất đất nước)
 * 5. Quốc tế thiếu nhi (1/6)
 * 6. Quốc tế phụ nữ (8/3)
 * 7. Quốc khánh Việt Nam (2/9)
 * 8. Phụ nữ Việt Nam (20/10)
 * 9. Halloween (Đêm huyền bí)
 * 10. Tiêu chuẩn (Hồng UBM nguyên bản)
 * + Chế độ "Tự động theo lịch" (Realtime Calendar Auto Detection)
 *
 * Luồng 3 bước: phone -> pin (6 ô) -> success (SVG tick + confetti canvas).
 * Giữ nguyên 100% logic bảo mật, tự kiểm tra SĐT, auto verify PIN, kiểm tra bản cập nhật.
 */

export interface PremiumLoginProps {
  initialPhone?: string;
  loading?: boolean;
  externalError?: string | null;
  /** Verify thật (gọi API). Ném lỗi khi sai. Nếu không truyền -> dùng demoPin để test. */
  onLogin?: (phone: string, pin: string) => Promise<void>;
  /** Kiểm tra SĐT có tồn tại trong CSDL không. Không truyền -> demo luôn tồn tại. */
  onCheckPhone?: (phone: string) => Promise<boolean>;
  /** Gọi sau khi hiện success ~1.8s (để parent chuyển hướng / setLoggedIn). */
  onSuccess?: (phone: string) => void;
  /** Kiểm tra bản cập nhật thủ công (parent so hash index.html). Trả 'new' nếu có bản mới. */
  onCheckUpdate?: () => Promise<'new' | 'same' | 'fail'>;
  demoPin?: string;
  pinLength?: number;
  /** 'auto' hoặc themeId cụ thể */
  eventTheme?: LoginThemeId;
  /**
   * Lịch giao diện sự kiện do Admin cấu hình.
   * Có mặt => khóa giao diện theo lịch: trong khoảng sự kiện dùng đúng theme,
   * ngoài khoảng (trước khi bắt đầu / sau khi kết thúc) dùng giao diện mặc định.
   */
  scheduledTheme?: ScheduledLoginTheme | null;
}

export interface ScheduledLoginTheme {
  enabled: boolean;
  event: LoginThemeId;
  startAt: number;
  endAt: number;
  /** Chênh lệch giờ server - giờ máy (ms) để tính mốc chính xác. */
  serverOffsetMs: number;
}

const DEMO_DEFAULT_PIN = '123456';

function normalizePhone(raw: string): string {
  return (raw || '').replace(/\D/g, '').slice(0, 11);
}

function isValidPhone(digits: string): boolean {
  return digits.length >= 9 && digits.length <= 12;
}

export function PremiumLogin({
  initialPhone = '',
  loading = false,
  externalError = null,
  onLogin,
  onCheckPhone,
  onSuccess,
  onCheckUpdate,
  demoPin = DEMO_DEFAULT_PIN,
  pinLength = 6,
  eventTheme = 'auto',
  scheduledTheme = null,
}: PremiumLoginProps) {
  // Theme state: lưu lựa chọn người dùng vào localStorage
  const [selectedThemeId, setSelectedThemeId] = useState<LoginThemeId>(() => {
    try {
      const saved = localStorage.getItem('ubm_login_theme') as LoginThemeId;
      if (saved && THEME_LIST.some((t) => t.id === saved)) return saved;
    } catch { /* ignore */ }
    return eventTheme;
  });

  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);

  // Lịch sự kiện do Admin cấu hình (nhận qua prop từ server hoặc qua storage mô phỏng)
  const effectiveSchedule = scheduledTheme || (() => {
    try {
      const s = localStorage.getItem('ubm_mock_admin_schedule');
      if (s) {
        const p = JSON.parse(s);
        if (p?.enabled) return p as ScheduledThemeProp;
      }
    } catch {}
    return null;
  })();

  // Đồng hồ nội bộ để tự đổi giao diện đúng mốc bắt đầu/kết thúc sự kiện mà
  // không cần tải lại trang. Chỉ tick khi Admin có bật lịch sự kiện.
  const [scheduleNow, setScheduleNow] = useState(() => Date.now());
  useEffect(() => {
    if (!effectiveSchedule?.enabled) return;
    setScheduleNow(Date.now());
    const t = setInterval(() => setScheduleNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [
    effectiveSchedule?.enabled,
    effectiveSchedule?.event,
    effectiveSchedule?.startAt,
    effectiveSchedule?.endAt,
  ]);

  const scheduledWindowValid = !!effectiveSchedule?.enabled
    && Number.isFinite(effectiveSchedule.startAt)
    && Number.isFinite(effectiveSchedule.endAt)
    && effectiveSchedule.endAt > effectiveSchedule.startAt;

  // Trong khoảng sự kiện -> ép đúng theme Admin chọn; trước/sau khoảng ->
  // giao diện mặc định (standard). Không để localStorage ghi đè.
  const scheduledServerNow = scheduleNow + (effectiveSchedule?.serverOffsetMs || 0);
  const adminThemeId: LoginThemeId | null = effectiveSchedule?.enabled
    ? (scheduledWindowValid
      && scheduledServerNow >= effectiveSchedule!.startAt
      && scheduledServerNow < effectiveSchedule!.endAt
      ? effectiveSchedule!.event
      : 'standard')
    : null;
  const effectiveThemeId: LoginThemeId = adminThemeId ?? selectedThemeId;
  const themeLockedByAdmin = adminThemeId !== null;

  useEffect(() => {
    if (themeLockedByAdmin) setIsThemeMenuOpen(false);
  }, [themeLockedByAdmin]);

  // Lấy cấu hình theme hiện tại (nếu chọn 'auto' thì tự động tính theo ngày hôm nay)
  const today = new Date();
  const zodiac = getLunarZodiacInfo(today);
  const theme = getThemeConfig(effectiveThemeId, today);
  const isAuto = effectiveThemeId === 'auto';

  const selectTheme = (id: LoginThemeId) => {
    setSelectedThemeId(id);
    setIsThemeMenuOpen(false);
    try {
      localStorage.setItem('ubm_login_theme', id);
    } catch { /* ignore */ }
  };

  const [step, setStep] = useState<'phone' | 'pin' | 'success'>('phone');
  const [phone, setPhone] = useState(() => normalizePhone(initialPhone));
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [pin, setPin] = useState<string[]>(() => Array(pinLength).fill(''));
  const [verifying, setVerifying] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [checkingPhone, setCheckingPhone] = useState(false);
  const [phoneCheckError, setPhoneCheckError] = useState<string | null>(null);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const confettiRef = useRef<HTMLCanvasElement | null>(null);
  const successTimer = useRef<any>(null);
  const phoneCheckSeq = useRef(0);
  const checkedPhoneRef = useRef<string | null>(null);

  // Đồng bộ lỗi từ parent (API thật báo sai PIN...)
  useEffect(() => {
    if (externalError) {
      setError(externalError);
      setShakeKey((k) => k + 1);
      setPin(Array(pinLength).fill(''));
      setTimeout(() => inputRefs.current[0]?.focus(), 450);
    }
  }, [externalError, pinLength]);

  useEffect(() => () => { if (successTimer.current) clearTimeout(successTimer.current); }, []);

  const phoneValid = isValidPhone(phone);
  const showPhoneError = phoneTouched && phone.length > 0 && !phoneValid;

  const goToPin = useCallback(() => {
    setPhoneTouched(true);
    if (!isValidPhone(phone)) return;
    checkedPhoneRef.current = phone;
    setError(null);
    setPhoneCheckError(null);
    setCheckingPhone(false);
    setStep('pin');
    setPin(Array(pinLength).fill(''));
    setTimeout(() => inputRefs.current[0]?.focus(), 80);
  }, [phone, pinLength]);

  // Tự động kiểm tra SĐT trong CSDL khi nhập đủ số
  const runPhoneCheck = useCallback(async () => {
    if (!isValidPhone(phone)) return;
    const seq = ++phoneCheckSeq.current;
    setCheckingPhone(true);
    setPhoneCheckError(null);
    try {
      let exists: boolean;
      if (onCheckPhone) {
        exists = await onCheckPhone(phone);
      } else {
        await new Promise((r) => setTimeout(r, 600));
        exists = true;
      }
      if (phoneCheckSeq.current !== seq) return;
      if (exists) {
        goToPin();
      } else {
        setPhoneCheckError(`Số ${phone} chưa tồn tại trong hệ thống. Vui lòng kiểm tra lại hoặc liên hệ HR để nộp hồ sơ!`);
      }
    } catch (e: any) {
      if (phoneCheckSeq.current !== seq) return;
      setPhoneCheckError(e?.message || 'Không kiểm tra được SĐT. Vui lòng thử lại!');
    } finally {
      if (phoneCheckSeq.current === seq) setCheckingPhone(false);
    }
  }, [phone, onCheckPhone, goToPin]);

  useEffect(() => {
    if (step !== 'phone' || !isValidPhone(phone)) {
      setCheckingPhone(false);
      return;
    }
    if (phone === checkedPhoneRef.current) return;
    setPhoneCheckError(null);
    const t = setTimeout(() => { void runPhoneCheck(); }, 700);
    return () => clearTimeout(t);
  }, [phone, step, runPhoneCheck]);

  // Confetti động theo bảng màu của từng chủ đề
  const fireConfetti = useCallback(() => {
    const canvas = confettiRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = (canvas.width = Math.floor(canvas.offsetWidth * dpr));
    const h = (canvas.height = Math.floor(canvas.offsetHeight * dpr));
    const colors = theme.confettiColors;
    const cx = w / 2;
    const cy = h * 0.38;
    const parts = Array.from({ length: 150 }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = (4 + Math.random() * 9) * dpr;
      return {
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 4 * dpr,
        size: (3 + Math.random() * 5) * dpr,
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.25,
        life: 1,
        decay: 0.008 + Math.random() * 0.008,
        rect: Math.random() > 0.4,
      };
    });
    let raf = 0;
    const gravity = 0.22 * dpr;
    const drag = 0.985;
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      let alive = false;
      for (const p of parts) {
        p.vy += gravity;
        p.vx *= drag; p.vy *= drag;
        p.x += p.vx; p.y += p.vy;
        p.rot += p.vr;
        p.life -= p.decay;
        if (p.life > 0 && p.y < h + 20) alive = true;
        else continue;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.rect) ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.62);
        else { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
      if (alive) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w, h);
    };
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [theme.confettiColors]);

  const doVerify = useCallback(async (fullPin: string) => {
    if (verifying || loading) return;
    setVerifying(true);
    setError(null);
    try {
      if (onLogin) {
        await onLogin(phone, fullPin);
      } else {
        await new Promise((r) => setTimeout(r, 650));
        if (fullPin !== demoPin) throw new Error('demo-invalid');
      }
      setStep('success');
      setTimeout(fireConfetti, 60);
      successTimer.current = setTimeout(() => onSuccess?.(phone), 1900);
    } catch (e: any) {
      if (e?.message === 'MUST_CHANGE_PIN' || e?.code === 'MUST_CHANGE_PIN') return;
      const msg = e?.message === 'demo-invalid'
        ? `Mã PIN chưa đúng (demo: ${demoPin}). Nhập lại nhé!`
        : (e?.message || 'Mã PIN chưa đúng. Vui lòng thử lại!');
      if (!onLogin) setError(msg);
      else if (!externalError) setError(msg);
      setShakeKey((k) => k + 1);
      setPin(Array(pinLength).fill(''));
      setTimeout(() => inputRefs.current[0]?.focus(), 450);
    } finally {
      setVerifying(false);
    }
  }, [verifying, loading, onLogin, phone, demoPin, pinLength, fireConfetti, onSuccess, externalError]);

  useEffect(() => {
    if (step !== 'pin') return;
    if (pin.every((d) => d !== '') && pin.length === pinLength) {
      const t = setTimeout(() => doVerify(pin.join('')), 180);
      return () => clearTimeout(t);
    }
  }, [pin, step, pinLength, doVerify]);

  const handlePinChange = (idx: number, val: string) => {
    const digit = val.replace(/\D/g, '').slice(-1);
    setPin((prev) => {
      const next = [...prev];
      next[idx] = digit;
      return next;
    });
    if (digit && idx < pinLength - 1) {
      setTimeout(() => inputRefs.current[idx + 1]?.focus(), 10);
    }
  };

  const handlePinKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (pin[idx]) {
        setPin((prev) => { const n = [...prev]; n[idx] = ''; return n; });
      } else if (idx > 0) {
        e.preventDefault();
        setPin((prev) => { const n = [...prev]; n[idx - 1] = ''; return n; });
        setTimeout(() => { inputRefs.current[idx - 1]?.focus(); }, 10);
      }
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    } else if (e.key === 'ArrowRight' && idx < pinLength - 1) {
      inputRefs.current[idx + 1]?.focus();
    } else if (e.key === 'Enter') {
      if (pin.every((d) => d !== '')) doVerify(pin.join(''));
    }
  };

  const handlePinPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, pinLength);
    if (!text) return;
    const next = Array(pinLength).fill('');
    text.split('').forEach((ch, i) => { next[i] = ch; });
    setPin(next);
    const focusIdx = Math.min(text.length, pinLength - 1);
    setTimeout(() => {
      inputRefs.current[focusIdx]?.focus();
      if (text.length === pinLength) doVerify(text);
    }, 10);
  };

  const maskedPhone = phone.length >= 4
    ? `*** *** ${phone.slice(-3)}`
    : phone;

  return (
    <div
      className="pl-root"
      style={{
        background: theme.bgGradient,
      }}
    >
      <style>{`
        .pl-root {
          min-height: 100vh;
          min-height: 100dvh;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 16px;
          position: relative;
          overflow: hidden;
          font-family: 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
          transition: background .4s ease;
          box-sizing: border-box;
        }

        .pl-card {
          position: relative;
          width: 100%;
          max-width: 430px;
          border-radius: 26px;
          padding: 26px 24px 22px;
          transition: transform .25s ease, box-shadow .25s ease, background .25s ease;
          z-index: 10;
          box-sizing: border-box;
        }

        /* Floating Theme Switcher Button */
        .pl-theme-toggle {
          position: absolute;
          top: 14px;
          right: 14px;
          z-index: 40;
          background: rgba(255, 255, 255, 0.94);
          border: 1px solid rgba(0, 0, 0, 0.12);
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.16);
          border-radius: 999px;
          padding: 6px 14px;
          font-size: 12px;
          font-weight: 800;
          color: #1E293B;
          display: flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          backdrop-filter: blur(10px);
          transition: all .18s ease;
        }
        .pl-theme-toggle:hover {
          transform: translateY(-1.5px);
          background: #FFFFFF;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
        }

        /* Theme Modal Backdrop & Panel */
        .pl-theme-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.65);
          backdrop-filter: blur(6px);
          z-index: 999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          animation: pl-fade-in .2s ease-out;
        }
        @keyframes pl-fade-in { from { opacity: 0; } to { opacity: 1; } }

        .pl-theme-modal {
          background: #FFFFFF;
          border-radius: 24px;
          max-width: 460px;
          width: 100%;
          max-height: 88vh;
          overflow-y: auto;
          box-shadow: 0 25px 60px rgba(0, 0, 0, 0.35);
          padding: 22px 20px 20px;
          position: relative;
          animation: pl-scale-up .25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes pl-scale-up { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }

        .pl-theme-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 10px;
          margin-top: 14px;
        }

        .pl-theme-item {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px 14px;
          border-radius: 16px;
          border: 1.5px solid #E2E8F0;
          background: #F8FAFC;
          cursor: pointer;
          text-align: left;
          transition: all .15s ease;
        }
        .pl-theme-item:hover {
          border-color: #38BDF8;
          background: #F0F9FF;
          transform: translateY(-1px);
        }
        .pl-theme-item.active {
          border-color: #0284C7;
          background: #E0F2FE;
          box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.15);
        }

        /* Ambient elements */
        .pl-bg-stars {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background-image: 
            radial-gradient(1.5px 1.5px at 15% 12%, currentColor 100%, transparent),
            radial-gradient(2px 2px at 85% 18%, currentColor 100%, transparent),
            radial-gradient(1.5px 1.5px at 75% 45%, currentColor 100%, transparent),
            radial-gradient(2px 2px at 12% 70%, currentColor 100%, transparent),
            radial-gradient(1.5px 1.5px at 90% 82%, currentColor 100%, transparent),
            radial-gradient(2.5px 2.5px at 28% 88%, currentColor 100%, transparent),
            radial-gradient(1px 1px at 50% 25%, #FFFFFF 100%, transparent);
          opacity: .85;
          animation: pl-twinkle 4s ease-in-out infinite alternate;
        }
        @keyframes pl-twinkle { 0% { opacity: .5; } 100% { opacity: 1; } }

        .pl-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; position: relative; }
        .pl-logo {
          width: 52px;
          height: 52px;
          border-radius: 18px;
          overflow: hidden;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #FFFFFF;
          border: 2px solid ${theme.logoBorderColor || '#F0E2DE'};
          box-shadow: 0 8px 20px ${theme.logoGlowColor || 'rgba(0, 0, 0, 0.12)'};
          transition: border-color .25s ease, box-shadow .25s ease;
        }
        .pl-logo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .pl-title {
          font-size: 23px;
          font-weight: 900;
          letter-spacing: -.02em;
          margin: 0 0 6px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .pl-sub {
          font-size: 13.5px;
          color: #64748B;
          margin: 0 0 16px;
          line-height: 1.55;
          font-weight: 500;
        }

        .pl-field-label {
          font-size: 12px;
          font-weight: 800;
          letter-spacing: .06em;
          text-transform: uppercase;
          margin-bottom: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .pl-phone-wrap {
          display: flex;
          align-items: stretch;
          border-radius: 18px;
          overflow: hidden;
          background: #FFFFFF;
          border: 2px solid #E2E8F0;
          transition: border-color .2s, box-shadow .2s;
          position: relative;
        }
        .pl-phone-wrap:focus-within {
          border-color: ${theme.accentColor};
          box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.1);
        }
        .pl-phone-wrap.pl-err {
          border-color: #EF4444;
          box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.15);
        }

        .pl-prefix {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 0 14px;
          font-weight: 900;
          font-size: 16px;
          white-space: nowrap;
          border-right: 1.5px solid rgba(0,0,0,0.06);
          transition: background .2s, color .2s;
        }

        .pl-phone-input {
          flex: 1;
          min-width: 0;
          border: none;
          outline: none;
          background: transparent;
          color: #1E293B;
          font-size: 20px;
          font-weight: 800;
          letter-spacing: .08em;
          padding: 15px 12px;
        }
        .pl-phone-input::placeholder {
          color: #94A3B8;
          font-weight: 500;
          letter-spacing: .02em;
        }

        .pl-pin-row {
          display: flex;
          gap: 10px;
          justify-content: center;
          margin: 8px 0 6px;
        }
        .pl-pin-box {
          width: 50px;
          height: 58px;
          text-align: center;
          font-size: 26px;
          font-weight: 900;
          color: #1E293B;
          background: #FFFFFF;
          border: 2px solid #E2E8F0;
          border-radius: 16px;
          outline: none;
          transition: border-color .18s, box-shadow .18s, transform .12s, background .18s;
        }
        .pl-pin-box:focus {
          border-color: ${theme.accentColor};
          box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.12);
          transform: translateY(-2px);
          background: #FFFFFF;
        }
        .pl-pin-box.pl-filled {
          border-color: #10B981;
          background: #DFF5E8;
          color: #065F46;
        }
        .pl-pin-row.pl-err .pl-pin-box {
          border-color: #EF4444;
          background: #FEE2E2;
          color: #991B1B;
        }

        @keyframes pl-shake {
          0%,100% { transform: translateX(0); }
          15% { transform: translateX(-9px); }
          30% { transform: translateX(8px); }
          45% { transform: translateX(-6px); }
          60% { transform: translateX(5px); }
          75% { transform: translateX(-3px); }
          90% { transform: translateX(2px); }
        }
        .pl-shake { animation: pl-shake .45s ease; }

        .pl-err-box {
          margin-top: 12px;
          font-size: 13px;
          font-weight: 700;
          color: #991B1B;
          background: #FEE2E2;
          border: 1px solid #FCA5A5;
          padding: 10px 14px;
          border-radius: 14px;
          line-height: 1.5;
        }

        .pl-back {
          margin-top: 14px;
          width: 100%;
          background: transparent;
          border: none;
          color: ${theme.accentColor};
          font-size: 13.5px;
          font-weight: 800;
          cursor: pointer;
          padding: 10px;
          border-radius: 12px;
          transition: background .15s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .pl-back:hover { background: rgba(0, 0, 0, 0.05); }

        .pl-spinner {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          border: 2.5px solid rgba(0,0,0,0.15);
          border-top-color: ${theme.accentColor};
          animation: pl-spin .7s linear infinite;
        }
        @keyframes pl-spin { to { transform: rotate(360deg); } }

        .pl-success { text-align: center; padding: 12px 0 6px; position: relative; }
        .pl-confetti { position: absolute; inset: -26px; width: calc(100% + 52px); height: calc(100% + 52px); pointer-events: none; }
        .pl-check { width: 105px; height: 105px; margin: 4px auto 14px; }
        .pl-check circle { stroke-dasharray: 302; stroke-dashoffset: 302; animation: pl-draw .7s cubic-bezier(.65,0,.35,1) forwards; }
        .pl-check path { stroke-dasharray: 60; stroke-dashoffset: 60; animation: pl-draw .45s .65s cubic-bezier(.65,0,.35,1) forwards; }
        @keyframes pl-draw { to { stroke-dashoffset: 0; } }

        .pl-float { animation: pl-float-anim 3s ease-in-out infinite alternate; }
        @keyframes pl-float-anim { 0% { transform: translateY(0); } 100% { transform: translateY(-5px); } }

        @media (max-width: 400px) {
          .pl-pin-box { width: 44px; height: 52px; font-size: 22px; }
          .pl-pin-row { gap: 6px; }
          .pl-card { padding: 22px 18px 18px; border-radius: 22px; }
        }
      `}</style>

      {/* Floating Theme Selector Button */}
      <button
        className="pl-theme-toggle"
        onClick={() => { if (!themeLockedByAdmin) setIsThemeMenuOpen(true); }}
        disabled={themeLockedByAdmin}
        title={themeLockedByAdmin
          ? 'Giao diện sự kiện đang được Admin cài đặt theo lịch'
          : 'Chọn chủ đề sự kiện (Tết, Noel, 30/4, Quốc khánh, v.v...)'}
        style={themeLockedByAdmin ? { cursor: 'default' } : undefined}
      >
        <span>{theme.icon}</span>
        <span>{themeLockedByAdmin ? `Sự kiện: ${theme.name}` : isAuto ? `Tự động: ${theme.name}` : theme.name}</span>
        <span style={{ fontSize: 10, opacity: 0.6 }}>{themeLockedByAdmin ? '🔒' : '▼'}</span>
      </button>

      {/* Theme Selection Modal */}
      {isThemeMenuOpen && !themeLockedByAdmin && (
        <div className="pl-theme-backdrop" onClick={() => setIsThemeMenuOpen(false)}>
          <div className="pl-theme-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #E2E8F0', paddingBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 900, color: '#0F172A', margin: 0 }}>
                  🎨 Chọn Chủ Đề Sự Kiện
                </h3>
                <p style={{ fontSize: 12.5, color: '#64748B', margin: '3px 0 0' }}>
                  Thiết kế theo mùa lễ hội & văn hóa Việt Nam
                </p>
              </div>
              <button
                onClick={() => setIsThemeMenuOpen(false)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  border: 'none',
                  background: '#F1F5F9',
                  color: '#475569',
                  fontSize: 16,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>

            <div className="pl-theme-grid">
              {THEME_LIST.map((t) => {
                const isActive = selectedThemeId === t.id;
                const isAutoOption = t.id === 'auto';
                return (
                  <button
                    key={t.id}
                    className={`pl-theme-item ${isActive ? 'active' : ''}`}
                    onClick={() => selectTheme(t.id)}
                  >
                    <span style={{ fontSize: 24, lineHeight: 1 }}>{t.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: '#1E293B' }}>
                        {t.name}
                        {isAutoOption && <span style={{ fontSize: 10.5, color: '#0284C7', marginLeft: 4 }}>(Hiện tại: {theme.name})</span>}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748B', marginTop: 2, lineHeight: 1.35 }}>
                        {t.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #E2E8F0', textAlign: 'center', fontSize: 12, color: '#64748B' }}>
              💡 Lựa chọn của bạn sẽ được tự động ghi nhớ cho lần đăng nhập sau.
            </div>
          </div>
        </div>
      )}

      {/* Ambient Twinkling Stars */}
      <div className="pl-bg-stars" style={{ color: theme.ambientStarsColor }} />

      {/* Hiệu ứng hạt động 60fps cho từng sự kiện (Tuyết rơi, Sen hồng, Hoa hồng, Bong bóng, Dơi...) */}
      <ThemeAmbientEffects themeId={theme.id} />

      {/* Top-Right Background Ornament */}
      {theme.renderTopRightOrnament?.(zodiac)}

      {/* MAIN LOGIN CARD */}
      <div
        className="pl-card"
        style={{
          background: theme.cardBg,
          border: theme.cardBorder,
          boxShadow: theme.cardShadow,
        }}
      >
        {/* BRAND HEADER */}
        <div className="pl-brand">
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div className="pl-logo">
              <img
                src="/logo.jpg"
                alt="UBM"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </div>
            {/* Phụ kiện trang trí nhỏ theo chủ đề đặt trên vành logo */}
            {theme.renderLogoAccessory?.(zodiac)}
          </div>

          <div>
            <div
              style={{
                fontWeight: 900,
                fontSize: 17,
                letterSpacing: '-.01em',
                color: theme.brandTitleColor,
              }}
            >
              ỤM BÒ MILK
            </div>
            <div
              style={{
                fontSize: 12,
                color: theme.brandSubColor,
                fontWeight: 700,
                letterSpacing: '.06em',
              }}
            >
              CỔNG NHÂN VIÊN • V5.1
            </div>
          </div>

          {/* Event Security Badge */}
          <div
            style={{
              marginLeft: 'auto',
              fontSize: 11.5,
              fontWeight: 800,
              color: theme.badgeColor,
              background: theme.badgeBg,
              border: `1px solid ${theme.badgeBorder}`,
              padding: '4px 11px',
              borderRadius: 999,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              whiteSpace: 'nowrap',
            }}
          >
            <span>●</span> {theme.badgeLabel}
          </div>
        </div>

        {/* DIVIDER: GARLAND ICONS */}
        <div style={{ margin: '14px 0 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, position: 'relative' }}>
          <div style={{ position: 'absolute', inset: '0 6px', height: '2px', top: '50%', background: theme.garlandLineColor, zIndex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', position: 'relative', zIndex: 2, padding: '0 4px' }}>
            {theme.garlandIcons.map((icon, idx) => (
              <span
                key={idx}
                style={{
                  fontSize: icon.length > 1 ? 16 : 13,
                  background: theme.cardBg,
                  padding: '2px 4px',
                  borderRadius: '50%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.06)',
                }}
              >
                {icon}
              </span>
            ))}
          </div>
        </div>

        {/* STEP HEADER TEXT */}
        {step !== 'success' && (
          <>
            <h2 className="pl-title" style={{ color: theme.brandTitleColor }}>
              <span>{step === 'phone' ? 'Đăng nhập' : 'Nhập mã PIN'}</span>
              <span>{theme.icon}</span>
            </h2>
            <p className="pl-sub">
              {step === 'phone'
                ? theme.subTitle
                : <>Xác thực SĐT <b style={{ color: theme.brandTitleColor }}>{maskedPhone}</b> bằng mã PIN 6 số được cấp.</>}
            </p>
          </>
        )}

        {/* THÔNG BÁO SỰ KIỆN CÓ THỜI GIAN ĐẾM NGƯỢC CẬP NHẬT GIAO DIỆN */}
        {step !== 'success' && (
          (theme.id === 'tet_2027' && !effectiveSchedule?.enabled) ? (
            <TetCountdownAndFireworks
              targetYear={2027}
              canChiName="Đinh Mùi"
              zodiacIcon="🐐"
              zodiacAnimal="Dê"
            />
          ) : (
            <EventAnnouncementCountdown
              scheduledTheme={effectiveSchedule}
              currentThemeId={effectiveThemeId}
              onAutoUpdateTheme={(newThemeId) => {
                setScheduleNow(Date.now());
              }}
              variant="card"
            />
          )
        )}

        {/* STEP 1: PHONE INPUT */}
        {step === 'phone' && (
          <div>
            <div className="pl-field-label">
              <span style={{ color: theme.accentColor }}>
                {theme.fieldLabel}
              </span>
              <span style={{ color: '#64748B', fontWeight: 800 }}>
                {phone.length}/11
              </span>
            </div>

            <div className={`pl-phone-wrap${showPhoneError ? ' pl-err' : ''}`}>
              <span
                className="pl-prefix"
                style={{
                  background: theme.prefixBg,
                  color: theme.prefixColor,
                }}
              >
                VN +84
              </span>
              <input
                className="pl-phone-input"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                placeholder="901 111 222"
                value={phone}
                autoFocus
                onChange={(e) => setPhone(normalizePhone(e.target.value))}
                onBlur={() => setPhoneTouched(true)}
                onKeyDown={(e) => { if (e.key === 'Enter') void runPhoneCheck(); }}
              />

              {/* Theme Peekaboo Mascot/Icon */}
              {theme.renderPeekaboo(zodiac)}
            </div>

            <div style={{ fontSize: 12, marginTop: 7, minHeight: 18, color: '#DC2626', fontWeight: 600 }}>
              {showPhoneError ? 'Số điện thoại cần 9–12 chữ số (VD: 0901111222).' : ''}
            </div>

            {checkingPhone && phoneValid && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12, fontSize: 13, fontWeight: 700, color: theme.accentColor }}>
                <span className="pl-spinner" /> Đang kiểm tra SĐT trong hệ thống...
              </div>
            )}

            {!checkingPhone && phoneCheckError && phoneValid && (
              <div className="pl-err-box">⚠️ {phoneCheckError}</div>
            )}

            {!checkingPhone && !phoneCheckError && (
              <div style={{ textAlign: 'center', marginTop: 12, fontSize: 13, color: '#475569', fontWeight: 600 }}>
                {!phoneValid
                  ? 'Nhập đủ số, hệ thống sẽ tự kiểm tra và chuyển sang nhập PIN.'
                  : phone === checkedPhoneRef.current
                    ? 'Số được giữ lại — sửa số rồi hệ thống sẽ tự kiểm tra lại.'
                    : '✓ Đủ số — hệ thống đang tự kiểm tra...'}
              </div>
            )}

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              marginTop: 16,
              fontSize: 12,
              color: '#64748B',
              fontWeight: 600,
            }}>
              <span>🔒</span>
              <span>Dữ liệu được mã hóa • Không chia sẻ PIN cho bất kỳ ai</span>
            </div>
          </div>
        )}

        {/* STEP 2: PIN INPUT */}
        {step === 'pin' && (
          <div>
            <div className="pl-field-label">
              <span style={{ color: theme.accentColor }}>
                MÃ PIN • 6 SỐ {theme.icon}
              </span>
              <span style={{ color: '#64748B', fontWeight: 800 }}>
                {pin.filter(Boolean).length}/6
              </span>
            </div>

            <div key={shakeKey} className={`pl-pin-row${shakeKey > 0 && error ? ' pl-err pl-shake' : ''}`}>
              {pin.map((d, i) => (
                <input
                  key={`${i}-${shakeKey}`}
                  ref={(el) => { inputRefs.current[i] = el; }}
                  className={`pl-pin-box${d ? ' pl-filled' : ''}`}
                  type="password"
                  inputMode="numeric"
                  autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  maxLength={1}
                  value={d}
                  onChange={(e) => handlePinChange(i, e.target.value)}
                  onKeyDown={(e) => handlePinKeyDown(i, e)}
                  onPaste={handlePinPaste}
                  onFocus={(e) => e.target.select()}
                  aria-label={`PIN digit ${i + 1}`}
                />
              ))}
            </div>

            {(verifying || loading) && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, fontSize: 13.5, fontWeight: 700, color: theme.accentColor }}>
                <span className="pl-spinner" /> Đang xác thực mã PIN bảo mật...
              </div>
            )}

            {error && !verifying && !loading && <div className="pl-err-box">⚠️ {error}</div>}

            {!error && !verifying && !loading && (
              <div style={{ textAlign: 'center', marginTop: 12, fontSize: 13, color: '#475569', fontWeight: 600 }}>
                Nhập đủ 6 số là hệ thống tự kiểm tra — không cần bấm thêm nút nào.
              </div>
            )}

            <button className="pl-back" onClick={() => { setStep('phone'); setError(null); setPin(Array(pinLength).fill('')); }}>
              <span>← Đổi số khác</span>
            </button>
          </div>
        )}

        {/* STEP 3: SUCCESS */}
        {step === 'success' && (
          <div className="pl-success">
            <canvas ref={confettiRef} className="pl-confetti" />
            <svg className="pl-check" viewBox="0 0 110 110" fill="none">
              <circle cx="55" cy="55" r="48" stroke="#10B981" strokeWidth="6" strokeLinecap="round" />
              <circle cx="55" cy="55" r="48" stroke="rgba(16,185,129,.22)" strokeWidth="12" />
              <path d="M36 56 L50 70 L75 42" stroke="#34D399" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div style={{ fontSize: 22, fontWeight: 900, color: theme.brandTitleColor }}>
              Xác thực thành công {theme.icon}
            </div>
            <div style={{ fontSize: 13.5, color: '#64748B', marginTop: 6, fontWeight: 600 }}>
              Xin chào <b style={{ color: theme.brandTitleColor }}>{maskedPhone}</b> • Đang chuẩn bị chuyển hướng...
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 14 }}>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: '#10B981', display: 'inline-block', animation: `pl-spin 1s ${i * 0.15}s infinite` }} />
              ))}
            </div>
          </div>
        )}

        {/* Card Footer: Update checker & Bottom Ornament */}
        <div style={{ marginTop: 14, position: 'relative' }}>
          <UpdateCheckFooter onCheckUpdate={onCheckUpdate} theme={theme} />
          {theme.renderBottomLeftOrnament?.(zodiac)}
        </div>
      </div>
    </div>
  );
}

function UpdateCheckFooter({
  onCheckUpdate,
  theme,
}: {
  onCheckUpdate?: () => Promise<'new' | 'same' | 'fail'>;
  theme: any;
}) {
  const [st, setSt] = useState<'idle' | 'checking' | 'new' | 'same' | 'fail'>('idle');

  return (
    <div style={{ textAlign: 'center' }}>
      <button
        onClick={async () => {
          if (!onCheckUpdate) {
            setSt('same');
            return;
          }
          if (st === 'checking') return;
          setSt('checking');
          try {
            setSt(await onCheckUpdate());
          } catch {
            setSt('fail');
          }
        }}
        style={{
          border: 'none',
          background: 'none',
          fontSize: 12.5,
          color: '#64748B',
          cursor: 'pointer',
          padding: '4px 8px',
          fontWeight: 700,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ fontSize: 14 }}>🔄</span>
        <span>Kiểm tra bản cập nhật</span>
        <span style={{ fontSize: 13 }}>{theme.icon}</span>
      </button>

      {st === 'same' && (
        <div style={{ fontSize: 12, color: '#059669', fontWeight: 800, marginTop: 4 }}>
          ✓ Đang dùng bản mới nhất.
        </div>
      )}
      {st === 'fail' && (
        <div style={{ fontSize: 12, color: '#DC2626', fontWeight: 800, marginTop: 4 }}>
          ⚠️ Không kiểm tra được (mất mạng?).
        </div>
      )}
      {st === 'new' && (
        <div style={{ fontSize: 12, color: '#D97706', fontWeight: 800, marginTop: 4 }}>
          🚀 Có bản mới! Tải lại trang để cập nhật.
        </div>
      )}
    </div>
  );
}

export default PremiumLogin;
