import React, { useCallback, useEffect, useState } from 'react';
import { Building2, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { apiRequest } from '../services/api';

/**
 * Duyệt Văn Phòng — 2 hàng đợi cho nhân viên khối VĂN PHÒNG (group = VAN_PHONG):
 *  1. Nghỉ phép: Nhân sự → Kế toán → Giám đốc (tuần tự).
 *  2. Bổ sung công (Nhân sự/Giám đốc duyệt, 4 phiếu/tháng/NV).
 *
 * Lương & phụ cấp KHÔNG còn chỉnh ở đây: Kế toán cấu hình tại tab
 * "Cấu hình Lương CB & Phụ cấp (Theo Khối)" — văn phòng lương theo THÁNG.
 *
 * Mỗi vai trò chỉ thấy/xử lý đúng bước của mình; Giám đốc duyệt xong phiếu nghỉ
 * phép mới có hiệu lực. Realtime: tự tải lại khi có sự kiện "office-*" phát ra.
 */

const LEAVE_STATUS_LABEL: Record<string, string> = {
  PENDING_HR: 'Chờ Nhân sự duyệt',
  PENDING_FINANCE: 'Chờ Kế toán duyệt',
  PENDING_DIRECTOR: 'Chờ Giám đốc duyệt',
  APPROVED: 'Đã duyệt — có hiệu lực',
  REJECTED: 'Đã từ chối',
};

const LEAVE_STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  PENDING_HR: { bg: '#FEF3C7', fg: '#92400E' },
  PENDING_FINANCE: { bg: '#FEF3C7', fg: '#92400E' },
  PENDING_DIRECTOR: { bg: '#EDE9FE', fg: '#5B21B6' },
  APPROVED: { bg: '#D1FAE5', fg: '#065F46' },
  REJECTED: { bg: '#FEE2E2', fg: '#991B1B' },
};

const ADJ_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Đã từ chối',
};

export const OfficeApprovalsView: React.FC<{ currentUser: any }> = ({ currentUser }) => {
  const role: string = String(currentUser?.role || '').toUpperCase();
  const canHr = ['HR', 'ADMIN'].includes(role);
  const canFinance = ['FINANCE', 'ADMIN'].includes(role);
  const canDirector = ['DIRECTOR', 'ADMIN'].includes(role);
  const canAdj = ['HR', 'DIRECTOR', 'ADMIN'].includes(role);

  const [leaves, setLeaves] = useState<any[]>([]);
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [tab, setTab] = useState<'leave' | 'adjust'>('leave');

  const load = useCallback(async () => {
    setLoading(true); setNotice(null);
    try {
      const [l, a] = await Promise.allSettled([
        apiRequest('/office/leaves'),
        apiRequest('/office/adjustments'),
      ]);
      if (l.status === 'fulfilled') setLeaves((l.value as any)?.leaves || []);
      if (a.status === 'fulfilled') setAdjustments((a.value as any)?.adjustments || []);
      else setAdjustments([]);
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Không tải được hàng đợi: ${err?.message || err}` });
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const review = async (kind: 'leave' | 'adjust', id: string, decision: 'APPROVE' | 'REJECT') => {
    let note = '';
    if (decision === 'REJECT') {
      note = window.prompt('Lý do từ chối?') || '';
      if (!note.trim()) return;
    }
    setBusy(`${id}:${decision}`); setNotice(null);
    try {
      await apiRequest(`/office/${kind === 'leave' ? 'leaves' : 'adjustments'}/${encodeURIComponent(id)}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision, note }),
      });
      setNotice({ kind: 'ok', text: decision === 'APPROVE' ? 'Đã duyệt phiếu.' : 'Đã từ chối phiếu.' });
      await load();
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Thao tác thất bại: ${err?.message || err}` });
    } finally { setBusy(''); }
  };

  const canActOnLeave = (s: string) => {
    if (s === 'PENDING_HR') return canHr;
    if (s === 'PENDING_FINANCE') return canFinance;
    if (s === 'PENDING_DIRECTOR') return canDirector;
    return false;
  };
  const canActOnAdjust = (s: string) => s === 'PENDING' && canAdj;

  const card: React.CSSProperties = {
    backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-soft)',
  };
  const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase' };
  const td: React.CSSProperties = { padding: '10px 12px', fontSize: 13, borderTop: '1px solid var(--border)', verticalAlign: 'top' };

  const pendingLeaves = leaves.filter(l => String(l.status).startsWith('PENDING'));
  const pendingAdjust = adjustments.filter(a => a.status === 'PENDING');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Building2 size={20} /> Duyệt Văn Phòng
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Vai trò của bạn: <b>{role}</b>. Nghỉ phép duyệt tuần tự <b>Nhân sự → Kế toán → Giám đốc</b>.
          </p>
        </div>
        <button onClick={load} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
          <RefreshCw size={14} /> Tải lại
        </button>
      </div>

      {notice && (
        <div style={{ padding: '10px 12px', borderRadius: 'var(--radius-sm)', fontSize: '13px', fontWeight: 600, backgroundColor: notice.kind === 'ok' ? 'var(--success-soft)' : 'var(--danger-soft)', color: notice.kind === 'ok' ? '#065F46' : '#991B1B', border: `1px solid ${notice.kind === 'ok' ? '#A7F3D0' : '#FECACA'}` }}>
          {notice.text}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={() => setTab('leave')} style={{ padding: '8px 16px', borderRadius: '999px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', border: `1px solid ${tab === 'leave' ? 'var(--brand)' : 'var(--border)'}`, backgroundColor: tab === 'leave' ? 'var(--brand)' : 'var(--surface)', color: tab === 'leave' ? '#FFF' : 'var(--text)' }}>
          Nghỉ phép ({pendingLeaves.length} chờ)
        </button>
        <button onClick={() => setTab('adjust')} style={{ padding: '8px 16px', borderRadius: '999px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', border: `1px solid ${tab === 'adjust' ? 'var(--brand)' : 'var(--border)'}`, backgroundColor: tab === 'adjust' ? 'var(--brand)' : 'var(--surface)', color: tab === 'adjust' ? '#FFF' : 'var(--text)' }}>
          Bổ sung công ({pendingAdjust.length} chờ)
        </button>
      </div>

      {tab === 'leave' && (
        <div style={{ ...card, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
            <thead><tr><th style={th}>Nhân viên</th><th style={th}>Ngày nghỉ</th><th style={th}>Lý do</th><th style={th}>Trạng thái</th><th style={th}>Duyệt</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td style={td} colSpan={5}>Đang tải…</td></tr>
              ) : leaves.length === 0 ? (
                <tr><td style={td} colSpan={5}>Chưa có phiếu nghỉ phép văn phòng nào.</td></tr>
              ) : leaves.map((l: any) => {
                const sc = LEAVE_STATUS_COLOR[l.status] || LEAVE_STATUS_COLOR.PENDING_HR;
                return (
                  <tr key={l.leave_id}>
                    <td style={td}><b>{l.full_name}</b><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l.employee_code}</div></td>
                    <td style={td}>{String(l.leave_date).slice(0, 10).split('-').reverse().join('/')}</td>
                    <td style={td}>{l.reason}</td>
                    <td style={td}><span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: '999px', backgroundColor: sc.bg, color: sc.fg }}>{LEAVE_STATUS_LABEL[l.status] || l.status}</span></td>
                    <td style={td}>
                      {canActOnLeave(l.status) ? (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button onClick={() => review('leave', l.leave_id, 'APPROVE')} disabled={!!busy} style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: 'none', backgroundColor: '#059669', color: '#FFF', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}><CheckCircle size={13} /> Duyệt</button>
                          <button onClick={() => review('leave', l.leave_id, 'REJECT')} disabled={!!busy} style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid #FCA5A5', backgroundColor: '#FEF2F2', color: '#991B1B', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}><XCircle size={13} /> Từ chối</button>
                        </div>
                      ) : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'adjust' && (
        <div style={{ ...card, overflow: 'auto' }}>
          {!canAdj ? (
            <div style={{ padding: '18px', fontSize: 13, color: 'var(--text-muted)' }}>Vai trò của bạn không có quyền duyệt phiếu bổ sung công văn phòng.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
              <thead><tr><th style={th}>Nhân viên</th><th style={th}>Ngày cần bổ sung</th><th style={th}>Lý do</th><th style={th}>Trạng thái</th><th style={th}>Duyệt</th></tr></thead>
              <tbody>
                {loading ? (
                  <tr><td style={td} colSpan={5}>Đang tải…</td></tr>
                ) : adjustments.length === 0 ? (
                  <tr><td style={td} colSpan={5}>Chưa có phiếu bổ sung công văn phòng nào.</td></tr>
                ) : adjustments.map((a: any) => (
                  <tr key={a.adjustment_id}>
                    <td style={td}><b>{a.full_name}</b><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.employee_code}</div></td>
                    <td style={td}>{String(a.work_date).slice(0, 10).split('-').reverse().join('/')}</td>
                    <td style={td}>{a.reason}{Number(a.minutes_requested) > 0 ? ` (${a.minutes_requested} phút)` : ''}</td>
                    <td style={td}><span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: '999px', backgroundColor: a.status === 'APPROVED' ? '#D1FAE5' : a.status === 'REJECTED' ? '#FEE2E2' : '#FEF3C7', color: a.status === 'APPROVED' ? '#065F46' : a.status === 'REJECTED' ? '#991B1B' : '#92400E' }}>{ADJ_STATUS_LABEL[a.status] || a.status}</span></td>
                    <td style={td}>
                      {canActOnAdjust(a.status) ? (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button onClick={() => review('adjust', a.adjustment_id, 'APPROVE')} disabled={!!busy} style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: 'none', backgroundColor: '#059669', color: '#FFF', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}><CheckCircle size={13} /> Duyệt</button>
                          <button onClick={() => review('adjust', a.adjustment_id, 'REJECT')} disabled={!!busy} style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid #FCA5A5', backgroundColor: '#FEF2F2', color: '#991B1B', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}><XCircle size={13} /> Từ chối</button>
                        </div>
                      ) : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};
