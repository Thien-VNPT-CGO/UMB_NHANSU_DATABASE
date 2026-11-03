import React, { useState } from 'react';
import { KeyRound, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../services/api';

/**
 * Đổi mật khẩu tài khoản nội bộ (Giám đốc / IT / các vai trò quản trị).
 * Dùng chung endpoint /auth/admin/change-password (bắt buộc mật khẩu cũ).
 */
export const ChangePasswordView: React.FC = () => {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (newPassword.length < 6) {
      setMessage({ kind: 'err', text: 'Mật khẩu mới phải có ít nhất 6 ký tự.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ kind: 'err', text: 'Xác nhận mật khẩu không khớp.' });
      return;
    }
    if (newPassword === oldPassword) {
      setMessage({ kind: 'err', text: 'Mật khẩu mới phải khác mật khẩu hiện tại.' });
      return;
    }
    setBusy(true);
    try {
      await apiRequest('/auth/admin/change-password', {
        method: 'POST',
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      setMessage({ kind: 'ok', text: 'Đã đổi mật khẩu thành công. Hãy dùng mật khẩu mới ở lần đăng nhập sau.' });
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      const code = String(err?.message || '');
      setMessage({
        kind: 'err',
        text: code === 'INVALID_CREDENTIALS' || code === 'INVALID_PASSWORD'
          ? 'Mật khẩu hiện tại không đúng.'
          : code === 'WEAK_PASSWORD'
            ? 'Mật khẩu mới quá yếu, vui lòng chọn mật khẩu mạnh hơn.'
            : (code || 'Không đổi được mật khẩu, vui lòng thử lại.'),
      });
    } finally {
      setBusy(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    fontSize: '14px',
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', maxWidth: '520px' }}>
      <div>
        <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <KeyRound size={20} /> Đổi mật khẩu
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Bảo mật tài khoản nội bộ: nhập mật khẩu hiện tại rồi đặt mật khẩu mới (tối thiểu 6 ký tự).
        </p>
      </div>

      <form
        onSubmit={submit}
        style={{
          backgroundColor: 'var(--surface)',
          padding: '22px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          boxShadow: 'var(--shadow-soft)',
        }}
      >
        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Mật khẩu hiện tại</label>
          <div style={{ position: 'relative' }}>
            <input
              type={show ? 'text' : 'password'}
              value={oldPassword}
              onChange={e => setOldPassword(e.target.value)}
              autoComplete="current-password"
              required
              style={{ ...inputStyle, paddingRight: '42px' }}
            />
            <button
              type="button"
              onClick={() => setShow(v => !v)}
              title={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Mật khẩu mới</label>
          <input
            type={show ? 'text' : 'password'}
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            autoComplete="new-password"
            required
            style={inputStyle}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Xác nhận mật khẩu mới</label>
          <input
            type={show ? 'text' : 'password'}
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
            style={inputStyle}
          />
        </div>

        {message && (
          <div
            style={{
              fontSize: '13px',
              fontWeight: 600,
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: message.kind === 'ok' ? 'var(--success-soft)' : 'var(--danger-soft)',
              color: message.kind === 'ok' ? '#065F46' : '#991B1B',
              border: `1px solid ${message.kind === 'ok' ? '#A7F3D0' : '#FECACA'}`,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {message.kind === 'ok' && <ShieldCheck size={16} />}
            {message.text}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          style={{
            padding: '11px 18px',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            backgroundColor: 'var(--brand)',
            color: '#FFF',
            fontWeight: 700,
            fontSize: '14px',
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? 'Đang lưu…' : 'Cập nhật mật khẩu'}
        </button>
      </form>
    </div>
  );
};
