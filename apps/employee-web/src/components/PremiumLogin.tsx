import React, { useState, useRef, useEffect, useCallback } from 'react';

/**
 * PremiumLogin — Màn hình đăng nhập SĐT + PIN 6 số cho cổng nhân viên UBM.
 * Senior UI/UX: tông HỒNG ban đầu (nền kem #FFF8F4 + brand #E85D92, success Emerald),
 * card 20px bo mềm, đổ bóng đa tầng, responsive mobile -> desktop,
 * zero external dependencies (chỉ React).
 *
 * Luồng 3 bước: phone -> pin (6 ô) -> success (SVG tick + confetti canvas).
 * Mặc định demo PIN đúng là `123456` khi không truyền `onLogin` (test ngay không cần backend).
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
}

const DEMO_DEFAULT_PIN = '123456';

function normalizePhone(raw: string): string {
  return (raw || '').replace(/\D/g, '').slice(0, 11);
}

function isValidPhone(digits: string): boolean {
  // Cho phép 9-11 số: 9 số (thiếu 0), 10 số (0xxx), 11-12 số (84xxx)
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
}: PremiumLoginProps) {
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
  // SĐT đã kiểm tra xong / đã vào màn PIN — quay lại "Đổi số khác" thì giữ nguyên
  // số cũ trên ô nhập và KHÔNG tự kiểm tra lại cho tới khi user sửa số.
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

  // Tự động kiểm tra SĐT trong CSDL khi nhập đủ số (không cần bấm nút).
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
        // Demo mode: SĐT hợp lệ là tồn tại.
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

  // Debounce: ngừng gõ 700ms mới gọi kiểm tra (tránh spam API từng ký tự).
  // Bỏ qua khi số chưa thay đổi kể từ lần kiểm tra trước (VD: vừa bấm "Đổi số
  // khác" quay lại — giữ số cũ trên ô nhập, không đẩy về màn PIN ngay).
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

  // ---- Confetti thuần Canvas, zero lib ----
  const fireConfetti = useCallback(() => {
    const canvas = confettiRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = (canvas.width = Math.floor(canvas.offsetWidth * dpr));
    const h = (canvas.height = Math.floor(canvas.offsetHeight * dpr));
    const colors = ['#E85D92', '#F472B6', '#F9A8D4', '#10B981', '#34D399', '#F59E0B', '#FFFFFF'];
    const cx = w / 2;
    const cy = h * 0.38;
    const parts = Array.from({ length: 140 }, () => {
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
  }, []);

  const doVerify = useCallback(async (fullPin: string) => {
    if (verifying || loading) return;
    setVerifying(true);
    setError(null);
    try {
      if (onLogin) {
        await onLogin(phone, fullPin);
      } else {
        // Demo mode: PIN đúng = demoPin (mặc định 123456)
        await new Promise((r) => setTimeout(r, 650));
        if (fullPin !== demoPin) throw new Error('demo-invalid');
      }
      setStep('success');
      setTimeout(fireConfetti, 60);
      successTimer.current = setTimeout(() => onSuccess?.(phone), 1900);
    } catch (e: any) {
      // Tài khoản bắt đổi PIN (kỳ 1-5 / PIN legacy / PIN mới reset): parent chuyển
      // sang màn đổi PIN, không hiện lỗi ở đây.
      if (e?.message === 'MUST_CHANGE_PIN' || e?.code === 'MUST_CHANGE_PIN') return;
      const msg = e?.message === 'demo-invalid'
        ? `Mã PIN chưa đúng (demo: ${demoPin}). Nhập lại nhé!`
        : (e?.message || 'Mã PIN chưa đúng. Vui lòng thử lại!');
      // Nếu parent tự xử lý lỗi (truyền externalError), không set ở đây để tránh đúp
      if (!onLogin) setError(msg);
      else if (!externalError) setError(msg);
      setShakeKey((k) => k + 1);
      setPin(Array(pinLength).fill(''));
      setTimeout(() => inputRefs.current[0]?.focus(), 450);
    } finally {
      setVerifying(false);
    }
  }, [verifying, loading, onLogin, phone, demoPin, pinLength, fireConfetti, onSuccess, externalError]);

  // Tự động verify khi điền đủ ô cuối
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
    <div className="pl-root">
      <style>{`
        .pl-root { min-height: 100vh; min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 20px 16px; position: relative; overflow: hidden;
          background: radial-gradient(1000px 480px at 50% -8%, rgba(232,93,146,.16), transparent 60%), radial-gradient(800px 420px at 50% 115%, rgba(245,158,11,.10), transparent 60%), linear-gradient(180deg, #FFF8F4 0%, #FDF0F4 55%, #FBE7EE 100%); color: #273142;
          font-family: 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
        .pl-bg-grid { position: absolute; inset: 0; pointer-events: none; opacity: .6;
          background-image: linear-gradient(rgba(232,93,146,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(232,93,146,.07) 1px, transparent 1px);
          background-size: 44px 44px; mask-image: radial-gradient(ellipse 90% 70% at 50% 40%, black 30%, transparent 75%); }
        .pl-orb { position: absolute; border-radius: 50%; filter: blur(70px); pointer-events: none; }
        .pl-card { position: relative; width: 100%; max-width: 420px; border-radius: 20px; padding: 28px 26px 24px;
          background: #FFFFFF;
          border: 1px solid #F0E2DE;
          box-shadow: 0 1px 0 rgba(255,255,255,.9) inset, 0 20px 50px rgba(157,23,77,.12), 0 8px 20px rgba(232,93,146,.14), 0 0 0 8px rgba(232,93,146,.05); }
        .pl-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
        .pl-logo { width: 48px; height: 48px; border-radius: 16px; overflow: hidden; flex-shrink: 0;
          background: linear-gradient(135deg,#E85D92,#D6457E); display: flex; align-items: center; justify-content: center;
          font-weight: 800; font-size: 20px; color: #fff; box-shadow: 0 8px 20px rgba(232,93,146,.40); border: 2px solid #F8DDE7; }
        .pl-logo img { width: 100%; height: 100%; object-fit: cover; }
        .pl-steps { display: flex; gap: 6px; margin: 14px 0 18px; }
        .pl-stepbar { height: 4px; flex: 1; border-radius: 999px; background: #F5D9E3; overflow: hidden; }
        .pl-stepbar > i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg,#E85D92,#10B981); transition: width .45s cubic-bezier(.16,1,.3,1); }
        .pl-title { font-size: 22px; font-weight: 800; letter-spacing: -.02em; margin: 0 0 6px; color: #273142; }
        .pl-sub { font-size: 13px; color: #6B7280; margin: 0 0 18px; line-height: 1.55; }
        .pl-field-label { font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #9D174D; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
        .pl-phone-wrap { display: flex; align-items: stretch; gap: 0; border-radius: 16px; overflow: hidden; border: 1.5px solid #F0E2DE; background: #FFF8F4; transition: border-color .2s, box-shadow .2s; }
        .pl-phone-wrap:focus-within { border-color: #E85D92; box-shadow: 0 0 0 4px rgba(232,93,146,.15); }
        .pl-phone-wrap.pl-err { border-color: #EF4444; box-shadow: 0 0 0 4px rgba(239,68,68,.12); }
        .pl-prefix { display: flex; align-items: center; gap: 6px; padding: 0 14px; font-weight: 800; font-size: 16px; color: #9D174D; background: #F8DDE7; border-right: 1px solid #F0E2DE; white-space: nowrap; }
        .pl-phone-input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: #273142; font-size: 19px; font-weight: 700; letter-spacing: .08em; padding: 15px 14px; }
        .pl-phone-input::placeholder { color: #B6BFC9; font-weight: 500; letter-spacing: .02em; }
        .pl-hint { font-size: 12px; margin-top: 8px; min-height: 18px; color: #DC2626; font-weight: 600; }
        .pl-btn { width: 100%; border: none; cursor: pointer; border-radius: 16px; padding: 15px 16px; font-size: 15px; font-weight: 800; letter-spacing: .01em; color: #fff; margin-top: 14px;
          background: linear-gradient(135deg, #E85D92 0%, #D6457E 100%);
          box-shadow: 0 10px 24px rgba(232,93,146,.35), 0 2px 6px rgba(214,69,126,.25), 0 1px 0 rgba(255,255,255,.25) inset;
          transition: transform .12s ease, box-shadow .2s ease, filter .2s ease; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .pl-btn:hover:not(:disabled) { filter: brightness(1.05); box-shadow: 0 14px 32px rgba(232,93,146,.45), 0 1px 0 rgba(255,255,255,.25) inset; transform: translateY(-1px); }
        .pl-btn:active:not(:disabled) { transform: translateY(1px) scale(.99); background: #D6457E; }
        .pl-btn:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }
        .pl-btn.pl-loading { pointer-events: none; opacity: .8; }
        .pl-spinner { width: 17px; height: 17px; border-radius: 50%; border: 2.5px solid rgba(255,255,255,.4); border-top-color: #fff; animation: pl-spin .7s linear infinite; }
        @keyframes pl-spin { to { transform: rotate(360deg); } }
        .pl-pin-row { display: flex; gap: 10px; justify-content: center; margin: 6px 0 4px; }
        .pl-pin-box { width: 48px; height: 56px; text-align: center; font-size: 24px; font-weight: 800; color: #273142; caret-color: #E85D92;
          background: #FFF8F4; border: 1.5px solid #F0E2DE; border-radius: 16px; outline: none;
          transition: border-color .18s, box-shadow .18s, transform .12s, background .18s; }
        .pl-pin-box:focus { border-color: #E85D92; box-shadow: 0 0 0 4px rgba(232,93,146,.15); transform: translateY(-2px); background: #FFFFFF; }
        .pl-pin-box.pl-filled { border-color: #10B981; background: #DFF5E8; }
        .pl-pin-row.pl-err .pl-pin-box { border-color: #EF4444; background: #FEE2E2; }
        @keyframes pl-shake { 0%,100% { transform: translateX(0); } 15% { transform: translateX(-9px); } 30% { transform: translateX(8px); } 45% { transform: translateX(-6px); } 60% { transform: translateX(5px); } 75% { transform: translateX(-3px); } 90% { transform: translateX(2px); } }
        .pl-shake { animation: pl-shake .45s ease; }
        .pl-err-box { margin-top: 12px; font-size: 13px; font-weight: 600; color: #991B1B; background: #FEE2E2; border: 1px solid #FCA5A5; padding: 10px 12px; border-radius: 12px; line-height: 1.5; }
        .pl-back { margin-top: 12px; width: 100%; background: transparent; border: none; color: #9D174D; font-size: 13px; font-weight: 700; cursor: pointer; padding: 10px; border-radius: 10px; transition: background .15s; }
        .pl-back:hover { background: #F8DDE7; }
        .pl-success { text-align: center; padding: 8px 0 4px; position: relative; }
        .pl-confetti { position: absolute; inset: -26px; width: calc(100% + 52px); height: calc(100% + 52px); pointer-events: none; }
        .pl-check { width: 110px; height: 110px; margin: 6px auto 14px; }
        .pl-check circle { stroke-dasharray: 302; stroke-dashoffset: 302; animation: pl-draw .7s cubic-bezier(.65,0,.35,1) forwards; }
        .pl-check path { stroke-dasharray: 60; stroke-dashoffset: 60; animation: pl-draw .45s .65s cubic-bezier(.65,0,.35,1) forwards; }
        @keyframes pl-draw { to { stroke-dashoffset: 0; } }
        @keyframes pl-fadeup { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        .pl-fadeup { animation: pl-fadeup .6s cubic-bezier(.16,1,.3,1) both; }
        .pl-fadeup-1 { animation-delay: .85s; } .pl-fadeup-2 { animation-delay: 1s; } .pl-fadeup-3 { animation-delay: 1.15s; }
        .pl-secure { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 16px; font-size: 11.5px; color: #6B7280; }
        @media (max-width: 400px) { .pl-pin-box { width: 44px; height: 52px; } .pl-pin-row { gap: 8px; } .pl-card { padding: 24px 18px 20px; } }
      `}</style>

      <div className="pl-bg-grid" />
      <div className="pl-orb" style={{ width: 320, height: 320, left: -90, top: -80, background: 'rgba(232,93,146,.22)' }} />
      <div className="pl-orb" style={{ width: 260, height: 260, right: -70, bottom: -60, background: 'rgba(16,185,129,.16)' }} />

      <div className="pl-card">
        <div className="pl-brand">
          <div className="pl-logo">
            <img src="/logo.jpg" alt="UBM" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <span style={{ display: 'none' }}>U</span>
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-.01em', color: '#E85D92' }}>ỤM BÒ MILK</div>
            <div style={{ fontSize: 11.5, color: '#6B7280', fontWeight: 600, letterSpacing: '.08em' }}>CỔNG NHÂN VIÊN • V5.1</div>
          </div>
          <div style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: '#065F46', background: '#DFF5E8', border: '1px solid #A7E3C5', padding: '4px 10px', borderRadius: 999 }}>
            ● Bảo mật
          </div>
        </div>

        <div className="pl-steps">
          {['phone', 'pin', 'success'].map((s, i) => {
            const order = { phone: 0, pin: 1, success: 2 } as const;
            const activeIdx = order[step];
            return (
              <div key={s} className="pl-stepbar">
                <i style={{ width: i <= activeIdx ? '100%' : '0%' }} />
              </div>
            );
          })}
        </div>

        {step !== 'success' && (
          <>
            <h2 className="pl-title">{step === 'phone' ? 'Đăng nhập' : 'Nhập mã PIN'}</h2>
            <p className="pl-sub">
              {step === 'phone'
                ? 'Nhập số điện thoại đã đăng ký với HR để nhận mã PIN và vào cổng chấm công.'
                : <>Xác thực SĐT <b style={{ color: '#E85D92' }}>{maskedPhone}</b> bằng mã PIN 6 số được cấp.</>}
            </p>
          </>
        )}

        {step === 'phone' && (
          <div>
            <div className="pl-field-label"><span>Số điện thoại</span><span>{phone.length}/11</span></div>
            <div className={`pl-phone-wrap${showPhoneError ? ' pl-err' : ''}`}>
              <span className="pl-prefix">🇻🇳 +84</span>
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
            </div>
            <div className="pl-hint">{showPhoneError ? 'Số điện thoại cần 9–12 chữ số (VD: 0901111222).' : ''}</div>
            {checkingPhone && phoneValid && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, fontSize: 13, fontWeight: 700, color: '#E85D92' }}>
                <span className="pl-spinner" style={{ borderColor: 'rgba(232,93,146,.3)', borderTopColor: '#E85D92' }} /> Đang kiểm tra SĐT trong hệ thống...
              </div>
            )}
            {!checkingPhone && phoneCheckError && phoneValid && (
              <div className="pl-err-box">⚠️ {phoneCheckError}</div>
            )}
            {!checkingPhone && !phoneCheckError && (
              <div style={{ textAlign: 'center', marginTop: 14, fontSize: 12.5, color: '#6B7280', fontWeight: 600 }}>
                {!phoneValid
                  ? 'Nhập đủ số, hệ thống sẽ tự kiểm tra và chuyển sang nhập PIN.'
                  : phone === checkedPhoneRef.current
                    ? 'Số được giữ lại — sửa số rồi hệ thống sẽ tự kiểm tra lại.'
                    : '✓ Đủ số — hệ thống đang tự kiểm tra...'}
              </div>
            )}
            <div className="pl-secure">🔒 Dữ liệu được mã hóa • Không chia sẻ PIN cho bất kỳ ai</div>
          </div>
        )}

        {step === 'pin' && (
          <div>
            <div className="pl-field-label"><span>Mã PIN • 6 số</span><span>{pin.filter(Boolean).length}/6</span></div>
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12, fontSize: 13, fontWeight: 700, color: '#E85D92' }}>
                <span className="pl-spinner" style={{ borderColor: 'rgba(232,93,146,.3)', borderTopColor: '#E85D92' }} /> Đang xác thực...
              </div>
            )}
            {error && !verifying && !loading && <div className="pl-err-box">⚠️ {error}</div>}
            {!error && !verifying && !loading && (
              <div style={{ textAlign: 'center', marginTop: 12, fontSize: 12.5, color: '#6B7280', fontWeight: 600 }}>
                Nhập đủ 6 số là hệ thống tự kiểm tra — không cần bấm thêm nút nào.
              </div>
            )}
            <button className="pl-back" onClick={() => { setStep('phone'); setError(null); setPin(Array(pinLength).fill('')); }}>
              ← Đổi số khác
            </button>
          </div>
        )}

        {step === 'success' && (
          <div className="pl-success">
            <canvas ref={confettiRef} className="pl-confetti" />
            <svg className="pl-check" viewBox="0 0 110 110" fill="none">
              <circle cx="55" cy="55" r="48" stroke="#10B981" strokeWidth="6" strokeLinecap="round" />
              <circle cx="55" cy="55" r="48" stroke="rgba(16,185,129,.25)" strokeWidth="12" />
              <path d="M36 56 L50 70 L75 42" stroke="#34D399" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="pl-fadeup pl-fadeup-1" style={{ fontSize: 21, fontWeight: 800, color: '#273142' }}>Xác thực thành công</div>
            <div className="pl-fadeup pl-fadeup-2" style={{ fontSize: 13, color: '#6B7280', marginTop: 6 }}>
              Xin chào <b style={{ color: '#E85D92' }}>{maskedPhone}</b> • Đang chuẩn bị chuyển hướng...
            </div>
            <div className="pl-fadeup pl-fadeup-3" style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 14 }}>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: '#10B981', display: 'inline-block', animation: `pl-spin 1s ${i * 0.15}s infinite` }} />
              ))}
            </div>
          </div>
        )}
        {onCheckUpdate && step !== 'success' && (
          <UpdateCheckFooter onCheckUpdate={onCheckUpdate} />
        )}
      </div>
    </div>
  );
}

function UpdateCheckFooter({ onCheckUpdate }: { onCheckUpdate: () => Promise<'new' | 'same' | 'fail'> }) {
  const [st, setSt] = useState<'idle' | 'checking' | 'new' | 'same' | 'fail'>('idle');
  return (
    <div style={{ textAlign: 'center', marginTop: 14 }}>
      <button
        onClick={async () => {
          if (st === 'checking') return;
          setSt('checking');
          try {
            setSt(await onCheckUpdate());
          } catch {
            setSt('fail');
          }
        }}
        style={{ border: 'none', background: 'none', fontSize: 11.5, color: '#9CA3AF', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontWeight: 600 }}
      >
        {st === 'checking' ? 'Đang kiểm tra...' : '🔄 Kiểm tra bản cập nhật'}
      </button>
      {st === 'same' && <div style={{ fontSize: 11.5, color: '#059669', fontWeight: 700, marginTop: 4 }}>✓ Đang dùng bản mới nhất.</div>}
      {st === 'fail' && <div style={{ fontSize: 11.5, color: '#DC2626', fontWeight: 700, marginTop: 4 }}>⚠️ Không kiểm tra được (mất mạng?).</div>}
      {st === 'new' && <div style={{ fontSize: 11.5, color: '#D97706', fontWeight: 700, marginTop: 4 }}>🚀 Có bản mới! Tải lại trang để cập nhật.</div>}
    </div>
  );
}

export default PremiumLogin;
