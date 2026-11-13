import React, { useState } from 'react';
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  LogOut,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { ApiError, changePin, resetPin } from '../services/api';
import type { AuthResult, ViolationAccount } from '../types';
import { ConfirmDialog, initials } from './ui';
import { useToast } from './toast';

interface Props {
  account: ViolationAccount;
  forced?: boolean;
  knownPin?: string;
  onChanged: (result: AuthResult, newPin: string) => void;
  onReset: (message: string) => void;
  onLogout: () => void;
}

function PinField({
  label,
  hint,
  value,
  onChange,
  reveal,
  autoFocus,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  reveal: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      <input
        className="input pin-input"
        type={reveal ? 'text' : 'password'}
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        value={value}
        autoFocus={autoFocus}
        onChange={event => onChange(event.target.value.replace(/\D/g, '').slice(0, 8))}
        placeholder="••••••••"
      />
    </label>
  );
}

export function PinChangeView({ account, forced = false, knownPin = '', onChanged, onReset, onLogout }: Props) {
  const toast = useToast();
  const [oldPin, setOldPin] = useState(knownPin);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [askReset, setAskReset] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!/^\d{8}$/.test(oldPin)) return setError('Mã PIN hiện tại phải gồm đúng 8 chữ số.');
    if (!/^\d{8}$/.test(newPin)) return setError('Mã PIN mới phải gồm đúng 8 chữ số.');
    if (newPin === oldPin) return setError('Mã PIN mới phải khác mã PIN hiện tại.');
    if (newPin !== confirmPin) return setError('Xác nhận mã PIN mới không khớp.');

    setBusy(true);
    setError('');
    try {
      const result = await changePin(oldPin, newPin);
      toast('Đã cập nhật mã PIN. Các phiên đăng nhập cũ đã bị thu hồi.', 'success');
      onChanged(result, newPin);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không thể đổi mã PIN.');
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    if (resetBusy) return;
    setResetBusy(true);
    try {
      const result = await resetPin();
      setAskReset(false);
      onReset(result.message || 'Vui lòng liên hệ Admin để lấy mã PIN.');
    } catch (err) {
      setAskReset(false);
      toast(err instanceof ApiError ? err.message : 'Không thể cấp lại mã PIN.', 'error');
    } finally {
      setResetBusy(false);
    }
  };

  const content = (
    <div className={`pin-change ${forced ? 'is-forced' : ''}`}>
      <div className="pin-change-head">
        <div className="pin-change-icon">
          <LockKeyhole size={24} />
        </div>
        <div>
          <span className="eyebrow">{forced ? 'BẢO MẬT BẮT BUỘC' : 'TRUNG TÂM BẢO MẬT'}</span>
          <h2>{forced ? 'Thiết lập mã PIN riêng của bạn' : 'Đổi mã PIN 8 số'}</h2>
          <p>
            {forced
              ? 'Đây là lần đăng nhập đầu tiên hoặc mã PIN vừa được cấp lại. Hãy đặt mã PIN mới trước khi tiếp tục.'
              : 'Mã PIN là lớp bảo vệ duy nhất của cổng tối cao. Hãy đổi định kỳ và không chia sẻ cho bất kỳ ai.'}
          </p>
        </div>
      </div>

      <div className="pin-account-strip">
        <span className="mini-avatar">{initials(account.display_name)}</span>
        <div>
          <strong>{account.display_name}</strong>
          <span>{account.system_name}</span>
        </div>
        <span className="pill pill-gold">
          <ShieldCheck size={12} /> PIN v{account.must_change_pin ? 'mặc định' : 'bảo mật'}
        </span>
      </div>

      {forced ? (
        <div className="alert alert-gold">
          <ShieldAlert size={18} />
          <span>
            Hệ thống yêu cầu đổi mã PIN trước khi cho phép tra cứu quy chế, lập phiếu hoặc duyệt vi phạm.
          </span>
        </div>
      ) : null}

      <form className="pin-form" onSubmit={submit}>
        <PinField
          label="Mã PIN hiện tại"
          hint={knownPin ? 'đã xác thực trong phiên này' : undefined}
          value={oldPin}
          onChange={setOldPin}
          reveal={reveal}
          autoFocus={!knownPin}
        />
        <div className="pin-form-grid">
          <PinField label="Mã PIN mới" hint="đúng 8 chữ số" value={newPin} onChange={setNewPin} reveal={reveal} />
          <PinField label="Xác nhận PIN mới" value={confirmPin} onChange={setConfirmPin} reveal={reveal} />
        </div>

        <label className="check-line">
          <input type="checkbox" checked={reveal} onChange={event => setReveal(event.target.checked)} />
          {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
          <span>Hiển thị mã PIN để kiểm tra</span>
        </label>

        {error ? <div className="form-error form-error-box">{error}</div> : null}

        <div className="pin-form-actions">
          {!forced ? (
            <button type="button" className="btn btn-ghost" onClick={() => setAskReset(true)}>
              <RotateCcw size={16} /> Cấp lại mật khẩu
            </button>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={onLogout}>
              <LogOut size={16} /> Đăng xuất
            </button>
          )}
          <button type="submit" className="btn btn-gold" disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
            {forced ? 'Lưu PIN và vào hệ thống' : 'Cập nhật mã PIN'}
          </button>
        </div>
      </form>

      <div className="security-notes">
        <div>
          <KeyRound size={16} />
          <span>PIN gồm đúng 8 chữ số, không dùng ngày sinh hay số điện thoại.</span>
        </div>
        <div>
          <ShieldCheck size={16} />
          <span>Đổi PIN thành công sẽ thu hồi mọi phiên đăng nhập cũ ngay lập tức.</span>
        </div>
        <div>
          <RotateCcw size={16} />
          <span>Cấp lại mật khẩu sẽ khóa phiên hiện tại và yêu cầu Admin cấp mã PIN mới.</span>
        </div>
      </div>

      <ConfirmDialog
        open={askReset}
        title="Cấp lại mật khẩu?"
        message={
          <>
            Toàn bộ phiên đăng nhập hiện tại sẽ bị khóa và mã PIN được đưa về trạng thái cấp lại.
            Bạn sẽ cần liên hệ Admin để nhận mã PIN mới.
          </>
        }
        confirmLabel="Cấp lại mật khẩu"
        tone="danger"
        busy={resetBusy}
        onConfirm={() => void doReset()}
        onCancel={() => setAskReset(false)}
      />
    </div>
  );

  if (!forced) return content;

  return (
    <div className="forced-screen">
      <div className="login-aurora" aria-hidden="true" />
      <div className="forced-top">
        <div className="brand-seal brand-seal-small">
          <div className="seal-ring">
            <LockKeyhole size={22} />
          </div>
        </div>
        <div>
          <strong>Tòa Án Tối Cao Ụm Bò Milk</strong>
          <span>Hệ thống kiểm soát &amp; xử lý vi phạm</span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onLogout}>
          <ArrowLeft size={15} /> Đăng xuất
        </button>
      </div>
      <div className="forced-body">{content}</div>
    </div>
  );
}
