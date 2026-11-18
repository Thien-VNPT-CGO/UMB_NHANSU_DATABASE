import React, { useCallback, useEffect, useState } from 'react';
import { Save, CalendarCheck2 } from 'lucide-react';
import { apiRequest } from '../services/api';
import { toVietnameseErrorMessage } from '@ubm/shared';
import { PasswordRotationCard, todayVn, type PasswordRotationStatus } from './PasswordRotationCard';

/**
 * Đếm ngược chu kỳ đổi mật khẩu VPS/root (dành cho ADMIN).
 *
 * Hệ thống KHÔNG đọc được mật khẩu thật của VPS — quản trị viên tự ghi nhận ngày
 * đã đổi; từ mốc đó hệ thống đếm ngược 6 tháng và cảnh báo trước 30 ngày.
 * Hiển thị trong tab Bảo trì (Hệ thống & Dữ liệu).
 */
export const VpsPasswordCard: React.FC = () => {
  const [status, setStatus] = useState<PasswordRotationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [changedAt, setChangedAt] = useState('');
  const [cycleMonths, setCycleMonths] = useState('6');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formMsg, setFormMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const applyStatus = useCallback((next: PasswordRotationStatus | null) => {
    setStatus(next);
    if (!next) return;
    setChangedAt(next.changed_at || '');
    setCycleMonths(String(next.cycle_months || 6));
    setNote(next.note || '');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest('/admin/vps-password');
      applyStatus(data as PasswordRotationStatus);
      setError(null);
    } catch (err: any) {
      setError(toVietnameseErrorMessage(err?.message, 'Không tải được chu kỳ đổi mật khẩu VPS.'));
    } finally {
      setLoading(false);
    }
  }, [applyStatus]);

  useEffect(() => {
    void load();
    const onReload = () => { void load(); };
    window.addEventListener('ubm:password-rotation-reload', onReload);
    // Tự làm mới mỗi 10 phút để bắt thay đổi từ thiết bị khác nếu lỡ mất socket.
    const timer = window.setInterval(() => { void load(); }, 10 * 60_000);
    return () => {
      window.removeEventListener('ubm:password-rotation-reload', onReload);
      window.clearInterval(timer);
    };
  }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormMsg(null);
    const cycle = Number(cycleMonths);
    if (!changedAt) {
      setFormMsg({ kind: 'err', text: 'Chọn ngày đổi mật khẩu gần nhất.' });
      return;
    }
    if (!Number.isFinite(cycle) || cycle < 1 || cycle > 24) {
      setFormMsg({ kind: 'err', text: 'Chu kỳ phải từ 1 đến 24 tháng.' });
      return;
    }
    setSaving(true);
    try {
      const next = await apiRequest('/admin/vps-password', {
        method: 'PUT',
        body: JSON.stringify({ changedAt, cycleMonths: cycle, note }),
      });
      applyStatus(next as PasswordRotationStatus);
      setFormMsg({ kind: 'ok', text: 'Đã ghi nhận mốc đổi mật khẩu VPS — đếm ngược đã được reset.' });
    } catch (err: any) {
      setFormMsg({ kind: 'err', text: toVietnameseErrorMessage(err?.message, 'Không lưu được mốc đổi mật khẩu VPS.') });
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '9px 11px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    fontSize: '13.5px',
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
  };

  return (
    <PasswordRotationCard
      title="Chu kỳ đổi mật khẩu VPS / root"
      subtitle="Định kỳ 6 tháng / lần — đếm ngược theo thời gian thực"
      status={status}
      loading={loading}
      error={error}
    >
      <form
        onSubmit={save}
        style={{
          borderTop: '1px dashed var(--border)',
          paddingTop: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text)' }}>
          Ghi nhận lần đổi mật khẩu gần nhất
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '5px' }}>Ngày đã đổi</label>
            <input
              type="date"
              value={changedAt}
              max={todayVn(Date.now())}
              onChange={e => setChangedAt(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '5px' }}>Chu kỳ (tháng)</label>
            <input
              type="number"
              min={1}
              max={24}
              value={cycleMonths}
              onChange={e => setCycleMonths(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '5px' }}>Ghi chú (không bắt buộc)</label>
          <input
            type="text"
            value={note}
            maxLength={500}
            placeholder="VD: đổi qua console nhà cung cấp VPS, đã lưu vào trình quản lý mật khẩu"
            onChange={e => setNote(e.target.value)}
            style={inputStyle}
          />
        </div>

        {formMsg && (
          <div
            style={{
              fontSize: '12.5px',
              fontWeight: 600,
              padding: '9px 11px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: formMsg.kind === 'ok' ? 'var(--success-soft)' : 'var(--danger-soft)',
              color: formMsg.kind === 'ok' ? '#065F46' : '#991B1B',
              border: `1px solid ${formMsg.kind === 'ok' ? '#A7F3D0' : '#FECACA'}`,
            }}
          >
            {formMsg.text}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="submit"
            disabled={saving}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '9px 14px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              backgroundColor: 'var(--brand)',
              color: '#FFF',
              fontWeight: 700,
              fontSize: '13px',
              cursor: saving ? 'wait' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}
          >
            <Save size={15} />
            {saving ? 'Đang lưu…' : 'Lưu mốc đổi mật khẩu'}
          </button>
          <button
            type="button"
            onClick={() => setChangedAt(todayVn(Date.now()))}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '9px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              backgroundColor: 'transparent',
              color: 'var(--text)',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            <CalendarCheck2 size={15} />
            Đã đổi hôm nay
          </button>
        </div>
      </form>
    </PasswordRotationCard>
  );
};
