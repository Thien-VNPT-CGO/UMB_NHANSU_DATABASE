import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CloudUpload,
  Delete,
  Gavel,
  KeyRound,
  Landmark,
  Loader2,
  LockKeyhole,
  Scale,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { ApiError, login } from '../services/api';
import type { AuthResult } from '../types';

interface Props {
  onSuccess: (result: AuthResult, pin: string) => void;
  notice?: string;
}

const DISPLAY_NAME = 'Tòa Án Tối Cao Ụm Bò Milk';
const SYSTEM_NAME = 'HỆ THỐNG KIỂM SOÁT & XỬ LÝ VI PHẠM';

export function LoginScreen({ onSuccess, notice }: Props) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lastSubmitted = useRef('');
  const panelRef = useRef<HTMLDivElement | null>(null);

  const submit = useCallback(
    async (value: string) => {
      if (busy) return;
      if (!/^\d{8}$/.test(value)) {
        setError('Vui lòng nhập đủ 8 chữ số.');
        return;
      }
      setBusy(true);
      setError('');
      try {
        const result = await login(value);
        onSuccess(result, value);
        setPin('');
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Không thể đăng nhập. Vui lòng thử lại.';
        setError(message);
        setPin('');
        lastSubmitted.current = '';
        window.setTimeout(() => panelRef.current?.focus(), 30);
      } finally {
        setBusy(false);
      }
    },
    [busy, onSuccess],
  );

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    if (pin.length === 8 && !busy && lastSubmitted.current !== pin) {
      lastSubmitted.current = pin;
      void submit(pin);
    }
  }, [pin, busy, submit]);

  const appendDigit = (digit: string) => {
    if (busy) return;
    setError('');
    setPin(current => (current.length >= 8 ? current : current + digit));
  };

  const backspace = () => {
    if (busy) return;
    setError('');
    setPin(current => current.slice(0, -1));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      appendDigit(event.key);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      backspace();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void submit(pin);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-aurora" aria-hidden="true" />
      <div className="login-grid" aria-hidden="true" />

      <a className="login-back" href="/" aria-label="Về hệ thống nhân sự">
        <ArrowLeft size={16} />
        <span>Về hệ thống nhân sự</span>
      </a>

      <section className="login-brand">
        <div className="brand-rule">
          <span />
          <span />
          <span />
        </div>
        <div className="brand-seal">
          <div className="seal-ring">
            <Landmark size={34} />
          </div>
          <span className="seal-caption">TÒA ÁN TỐI CAO</span>
        </div>

        <p className="brand-eyebrow">
          <Sparkles size={14} /> ỤM BÒ MILK · THẨM QUYỀN TỐI CAO
        </p>
        <h1>
          Hệ thống kiểm soát
          <br />
          <em>&amp; xử lý vi phạm</em>
        </h1>
        <p className="brand-description">
          Một cổng duy nhất để tra cứu quy chế, lập phiếu vi phạm, duyệt hình phạt và đồng bộ
          TRỪ KPI theo thời gian thực.
        </p>

        <div className="brand-features">
          <div className="brand-feature">
            <Scale size={18} />
            <div>
              <strong>Quy chế minh bạch</strong>
              <span>Toàn bộ lỗi vi phạm và mức phạt tập trung một nơi.</span>
            </div>
          </div>
          <div className="brand-feature">
            <Gavel size={18} />
            <div>
              <strong>Xử lý tức thời</strong>
              <span>Lưu tạm hoặc duyệt thẳng phiếu vi phạm chỉ trong vài giây.</span>
            </div>
          </div>
          <div className="brand-feature">
            <CloudUpload size={18} />
            <div>
              <strong>Lưu trữ &amp; KPI tự động</strong>
              <span>Phiếu đã duyệt được đẩy lên Drive và cấn trừ KPI ngay.</span>
            </div>
          </div>
        </div>

        <div className="brand-foot">
          <ShieldCheck size={16} />
          <span>Dữ liệu đồng bộ Google Sheets · Phiên bảo mật 12 giờ</span>
        </div>
      </section>

      <section className="login-panel-wrap">
        <div className="login-panel" ref={panelRef} tabIndex={0} onKeyDown={onKeyDown}>
          <div className="login-panel-head">
            <span className="login-chip">
              <LockKeyhole size={13} /> CỔNG NỘI BỘ
            </span>
            <h2>Đăng nhập tối cao</h2>
            <p>Chỉ cần mã PIN 8 số để mở phiên làm việc.</p>
          </div>

          <div className="login-account">
            <div className="account-avatar">UB</div>
            <div className="account-copy">
              <strong>{DISPLAY_NAME}</strong>
              <span>{SYSTEM_NAME}</span>
            </div>
            <span className="account-role">
              <BadgeCheck size={13} /> TOÀN QUYỀN
            </span>
          </div>

          {notice ? <div className="login-notice">{notice}</div> : null}

          <div className="pin-entry">
            <div className="pin-entry-label">
              <span>Mã PIN bảo mật</span>
              <small>{pin.length}/8</small>
            </div>
            <div
              className={`pin-slots ${error ? 'has-error' : ''} ${busy ? 'is-busy' : ''}`}
              onClick={() => panelRef.current?.focus()}
              role="group"
              aria-label="Mã PIN 8 số"
            >
              {Array.from({ length: 8 }).map((_, index) => {
                const filled = index < pin.length;
                const active = index === pin.length && !busy;
                return (
                  <span
                    key={index}
                    className={`pin-slot ${filled ? 'is-filled' : ''} ${active ? 'is-active' : ''}`}
                  >
                    {filled ? <i className="pin-dot" /> : active ? <i className="pin-caret" /> : null}
                  </span>
                );
              })}
            </div>
            {error ? <p className="form-error">{error}</p> : null}
          </div>

          <div className="keypad" aria-label="Bàn phím số">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(digit => (
              <button key={digit} type="button" className="keypad-key" onClick={() => appendDigit(digit)} disabled={busy}>
                {digit}
              </button>
            ))}
            <button type="button" className="keypad-key keypad-key-muted" onClick={() => setPin('')} disabled={busy || !pin}>
              Xóa
            </button>
            <button type="button" className="keypad-key" onClick={() => appendDigit('0')} disabled={busy}>
              0
            </button>
            <button type="button" className="keypad-key keypad-key-muted" onClick={backspace} disabled={busy || !pin} aria-label="Xóa một số">
              <Delete size={20} />
            </button>
          </div>

          <button
            type="button"
            className="btn btn-gold btn-login"
            onClick={() => void submit(pin)}
            disabled={busy || pin.length !== 8}
          >
            {busy ? <Loader2 size={18} className="spin" /> : <KeyRound size={18} />}
            {busy ? 'Đang xác thực...' : 'Mở khóa hệ thống'}
            {!busy ? <ArrowRight size={17} /> : null}
          </button>

          <p className="login-legal">
            Việc đăng nhập đồng nghĩa bạn đồng ý tuân thủ quy chế nội bộ và chịu trách nhiệm về mọi
            thao tác được ghi nhận trong phiên.
          </p>
        </div>
      </section>
    </div>
  );
}
