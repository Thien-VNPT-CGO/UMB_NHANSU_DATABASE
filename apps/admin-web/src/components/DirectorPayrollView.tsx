import React, { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, CheckCircle, RefreshCw, PenTool } from 'lucide-react';
import { apiRequest } from '../services/api';

/**
 * Giám đốc ký phiếu lương TRƯỚC, sau đó chuyển cho Quản lý chi nhánh ký,
 * Kế toán mới phát hành phiếu đến nhân viên (đủ 3 chữ ký).
 * Màn hình này chỉ để Giám đốc ký (role 'giamdoc'); không tạo/phát hành phiếu.
 */
const prevMonthOf = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
};
const thisMonthOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export const DirectorPayrollView: React.FC<{ currentUser: any }> = ({ currentUser }) => {
  const [period, setPeriod] = useState<string>(() => thisMonthOf(new Date()));
  const [slips, setSlips] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string>('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [signName, setSignName] = useState<string>(currentUser?.fullName || 'Giám Đốc');

  const vnd = (n: any) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;

  const load = async (p = period) => {
    setLoading(true);
    try {
      const data: any = await apiRequest(`/payroll/period-slips/${p}`);
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.slips) ? data.slips : []);
      setSlips(arr || []);
    } catch (err: any) {
      setSlips([]);
      setNotice({ kind: 'err', text: `Không tải được phiếu lương kỳ ${p}: ${err?.message || err}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(period); /* eslint-disable-next-line */ }, [period]);

  // Realtime: máy khác (Kế toán/Quản lý) thao tác -> tải lại danh sách.
  useEffect(() => {
    const handler = () => { load(period); };
    window.addEventListener('ubm:payslips-reload', handler as any);
    const timer = window.setInterval(handler, 45_000);
    return () => {
      window.removeEventListener('ubm:payslips-reload', handler as any);
      window.clearInterval(timer);
    };
    // eslint-disable-next-line
  }, [period]);

  const pending = useMemo(
    () => slips.filter(s => !s?.sign_giamdoc && s?.status !== 'PAID' && s?.status !== 'CONFIRMED'),
    [slips],
  );

  const sign = async (itemId: string) => {
    if (!signName.trim()) {
      setNotice({ kind: 'err', text: 'Vui lòng nhập tên người ký (Giám đốc).' });
      return;
    }
    setBusy(itemId);
    setNotice(null);
    try {
      await apiRequest(`/payroll/slips/${itemId}/sign`, {
        method: 'POST',
        body: JSON.stringify({ role: 'giamdoc', name: signName.trim() }),
      });
      setNotice({ kind: 'ok', text: 'Đã ký phiếu. Đã chuyển sang Quản lý chi nhánh ký tiếp.' });
      await load(period);
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Không ký được phiếu: ${err?.message || err}` });
    } finally {
      setBusy('');
    }
  };

  const statusLabel: Record<string, string> = {
    DRAFT: 'Chờ ký',
    PUBLISHED: 'Đã phát hành',
    CONFIRMED: 'NV đã xác nhận',
    PAID: 'Đã chi trả',
    CANCELLED: 'Đã hủy',
  };

  const card: React.CSSProperties = {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-soft)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileSpreadsheet size={20} /> Phê duyệt phiếu lương
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Quy trình: Kế toán lập → <b>Giám đốc ký</b> → Quản lý chi nhánh ký → Kế toán phát hành đến nhân viên. Dữ liệu cập nhật realtime.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label style={{ fontSize: '13px', fontWeight: 700 }}>Kỳ lương</label>
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text)', fontSize: '13px' }}
          >
            {[thisMonthOf(new Date()), prevMonthOf(new Date())].map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
            {period && ![thisMonthOf(new Date()), prevMonthOf(new Date())].includes(period) && (
              <option value={period}>{period}</option>
            )}
          </select>
          <button
            onClick={() => load(period)}
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Tải lại
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <PenTool size={16} />
        <label style={{ fontSize: '13px', fontWeight: 700 }}>Tên người ký (Giám đốc)</label>
        <input
          value={signName}
          onChange={e => setSignName(e.target.value)}
          style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text)', fontSize: '13px', minWidth: '220px' }}
        />
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Còn <b>{pending.length}</b> phiếu chờ Giám đốc ký.
        </span>
      </div>

      {notice && (
        <div style={{
          padding: '10px 12px', borderRadius: 'var(--radius-sm)', fontSize: '13px', fontWeight: 600,
          backgroundColor: notice.kind === 'ok' ? 'var(--success-soft)' : 'var(--danger-soft)',
          color: notice.kind === 'ok' ? '#065F46' : '#991B1B',
          border: `1px solid ${notice.kind === 'ok' ? '#A7F3D0' : '#FECACA'}`,
        }}>
          {notice.text}
        </div>
      )}

      <div style={{ ...card, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--surface-2, #F8FAFC)', textAlign: 'left' }}>
              <th style={{ padding: '10px 12px' }}>Mã NV</th>
              <th style={{ padding: '10px 12px' }}>Họ tên</th>
              <th style={{ padding: '10px 12px' }}>Chi nhánh</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>Thực lãnh</th>
              <th style={{ padding: '10px 12px' }}>Trạng thái</th>
              <th style={{ padding: '10px 12px' }}>Chữ ký GĐ</th>
              <th style={{ padding: '10px 12px' }}>Chữ ký QL</th>
              <th style={{ padding: '10px 12px', textAlign: 'center' }}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {slips.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '22px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  {loading ? 'Đang tải…' : `Chưa có phiếu lương cho kỳ ${period}.`}
                </td>
              </tr>
            ) : slips.map((s: any) => {
              const signedGd = !!s.sign_giamdoc;
              const signedQl = !!s.sign_quanly;
              const canSign = !signedGd && s.status !== 'PAID' && s.status !== 'CONFIRMED';
              return (
                <tr key={s.item_id || s.slip_id || s.employee_id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>{s.employee_code || s.employee_id}</td>
                  <td style={{ padding: '10px 12px' }}>{s.full_name}</td>
                  <td style={{ padding: '10px 12px' }}>{s.branch_id || s.branch_name || '—'}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{vnd(s.thuc_lanh)}</td>
                  <td style={{ padding: '10px 12px' }}>{statusLabel[s.status] || s.status}</td>
                  <td style={{ padding: '10px 12px' }}>
                    {signedGd
                      ? <span style={{ color: '#065F46', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}><CheckCircle size={14} /> {s.sign_giamdoc?.name || 'Đã ký'}</span>
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {signedQl
                      ? <span style={{ color: '#065F46', fontWeight: 700 }}>{s.sign_quanly?.name || 'Đã ký'}</span>
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    <button
                      onClick={() => sign(s.item_id)}
                      disabled={!canSign || busy === s.item_id}
                      style={{
                        padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: 'none', fontSize: '12px', fontWeight: 700,
                        backgroundColor: canSign ? 'var(--brand)' : '#E5E7EB',
                        color: canSign ? '#FFF' : '#9CA3AF',
                        cursor: canSign && busy !== s.item_id ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {busy === s.item_id ? '⏳ Đang ký…' : signedGd ? 'Đã ký' : '✍️ Ký duyệt'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
