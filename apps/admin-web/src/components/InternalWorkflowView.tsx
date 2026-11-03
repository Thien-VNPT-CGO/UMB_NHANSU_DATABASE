import React, { useEffect, useMemo, useState } from 'react';
import { Send, Plus, RefreshCw, CheckCircle, XCircle, ArrowRight, Clock, PenTool } from 'lucide-react';
import { apiRequest } from '../services/api';

/**
 * Quy trình yêu cầu công việc nội bộ giữa các phòng ban:
 * Giám Đốc – Kế toán (FINANCE) – Nhân sự (HR) – IT.
 * Các bộ phận tạo yêu cầu, phối hợp xử lý; khi xong PHẢI qua Giám đốc ký duyệt
 * mới được triển khai. Realtime: tới bộ phận nào đều cập nhật tức thời.
 */

type Dept = 'DIRECTOR' | 'FINANCE' | 'HR' | 'IT';

const DEPT_LABEL: Record<Dept, string> = {
  DIRECTOR: 'Giám đốc',
  FINANCE: 'Kế toán',
  HR: 'Nhân sự',
  IT: 'IT',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Chờ tiếp nhận',
  IN_PROGRESS: 'Đang xử lý',
  AWAITING_DIRECTOR: 'Chờ Giám đốc ký duyệt',
  APPROVED: 'Đã duyệt — triển khai',
  REJECTED: 'Đã từ chối',
  CANCELLED: 'Đã hủy',
};

const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  PENDING: { bg: '#FEF3C7', fg: '#92400E' },
  IN_PROGRESS: { bg: '#DBEAFE', fg: '#1E40AF' },
  AWAITING_DIRECTOR: { bg: '#EDE9FE', fg: '#5B21B6' },
  APPROVED: { bg: '#D1FAE5', fg: '#065F46' },
  REJECTED: { bg: '#FEE2E2', fg: '#991B1B' },
  CANCELLED: { bg: '#E5E7EB', fg: '#374151' },
};

export const InternalWorkflowView: React.FC<{ currentUser: any }> = ({ currentUser }) => {
  const role: string = currentUser?.role || 'IT';
  const myDept: Dept = role === 'DIRECTOR' || role === 'ADMIN' ? 'DIRECTOR'
    : role === 'FINANCE' ? 'FINANCE' : role === 'HR' ? 'HR' : 'IT';
  const isDirector = myDept === 'DIRECTOR';

  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<{ title: string; description: string; to_dept: Dept; priority: string }>({
    title: '', description: '', to_dept: 'HR', priority: 'NORMAL',
  });
  const [filter, setFilter] = useState<'ALL' | 'MINE' | 'AWAITING'>('ALL');
  const [expanded, setExpanded] = useState<string>('');

  const load = async () => {
    setLoading(true);
    try {
      const data: any = await apiRequest('/internal-requests');
      setList(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Không tải được yêu cầu: ${err?.message || err}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const handler = () => { load(); };
    window.addEventListener('ubm:internal-workflow-reload', handler as any);
    const timer = window.setInterval(handler, 15_000);
    return () => {
      window.removeEventListener('ubm:internal-workflow-reload', handler as any);
      window.clearInterval(timer);
    };
  }, []);

  const create = async () => {
    if (!form.title.trim()) { setNotice({ kind: 'err', text: 'Nhập tiêu đề yêu cầu.' }); return; }
    setBusy('create');
    setNotice(null);
    try {
      await apiRequest('/internal-requests', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setShowCreate(false);
      setForm({ title: '', description: '', to_dept: 'HR', priority: 'NORMAL' });
      setNotice({ kind: 'ok', text: 'Đã gửi yêu cầu tới bộ phận xử lý.' });
      await load();
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Không gửi được yêu cầu: ${err?.message || err}` });
    } finally {
      setBusy('');
    }
  };

  const act = async (id: string, action: 'done' | 'approve' | 'reject') => {
    let body: any = {};
    if (action === 'reject') {
      const reason = window.prompt('Lý do từ chối yêu cầu?') || '';
      if (!reason.trim()) return;
      body = { reason };
    }
    if (action === 'approve') {
      const note = window.prompt('Ghi chú ký duyệt (tuỳ chọn):') || '';
      body = { note };
    }
    setBusy(`${id}:${action}`);
    setNotice(null);
    try {
      await apiRequest(`/internal-requests/${id}/${action}`, { method: 'POST', body: JSON.stringify(body) });
      setNotice({ kind: 'ok', text: action === 'approve' ? 'Đã ký duyệt yêu cầu.' : action === 'done' ? 'Đã đánh dấu hoàn tất, chuyển Giám đốc.' : 'Đã từ chối yêu cầu.' });
      await load();
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Thao tác thất bại: ${err?.message || err}` });
    } finally {
      setBusy('');
    }
  };

  const filtered = useMemo(() => {
    if (filter === 'AWAITING') return list.filter(r => r.status === 'AWAITING_DIRECTOR');
    if (filter === 'MINE') return list.filter(r => r.current_dept === myDept || r.from_dept === myDept);
    return list;
  }, [list, filter, myDept]);

  const card: React.CSSProperties = {
    backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-soft)',
  };
  const input: React.CSSProperties = {
    width: '100%', padding: '9px 11px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
    backgroundColor: 'var(--surface)', color: 'var(--text)', fontSize: '13px',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Send size={20} /> Yêu cầu công việc nội bộ
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Bộ phận của bạn: <b>{DEPT_LABEL[myDept]}</b>. Quy trình: tạo yêu cầu → bộ phận phối hợp xử lý → <b>Giám đốc ký duyệt</b> → triển khai. Realtime toàn hệ thống.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={load} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            <RefreshCw size={14} /> Tải lại
          </button>
          <button onClick={() => setShowCreate(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: 'var(--radius-sm)', border: 'none', backgroundColor: 'var(--brand)', color: '#FFF', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
            <Plus size={15} /> Tạo yêu cầu
          </button>
        </div>
      </div>

      {notice && (
        <div style={{ padding: '10px 12px', borderRadius: 'var(--radius-sm)', fontSize: '13px', fontWeight: 600, backgroundColor: notice.kind === 'ok' ? 'var(--success-soft)' : 'var(--danger-soft)', color: notice.kind === 'ok' ? '#065F46' : '#991B1B', border: `1px solid ${notice.kind === 'ok' ? '#A7F3D0' : '#FECACA'}` }}>
          {notice.text}
        </div>
      )}

      {showCreate && (
        <div style={{ ...card, padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontWeight: 800, fontSize: '15px' }}>Tạo yêu cầu công việc nội bộ</div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '5px' }}>Tiêu đề *</label>
            <input style={input} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="VD: Cấp tài khoản Zalo OA cho nhân sự mới" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '5px' }}>Mô tả chi tiết</label>
            <textarea style={{ ...input, minHeight: '80px' }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '5px' }}>Gửi tới bộ phận</label>
              <select style={{ ...input, minWidth: '180px' }} value={form.to_dept} onChange={e => setForm({ ...form, to_dept: e.target.value as Dept })}>
                {(['DIRECTOR', 'FINANCE', 'HR', 'IT'] as Dept[]).map(d => <option key={d} value={d}>{DEPT_LABEL[d]}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '5px' }}>Mức ưu tiên</label>
              <select style={{ ...input, minWidth: '160px' }} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                <option value="LOW">Thấp</option>
                <option value="NORMAL">Bình thường</option>
                <option value="HIGH">Cao</option>
                <option value="URGENT">Khẩn</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={create} disabled={busy === 'create'} style={{ padding: '9px 16px', borderRadius: 'var(--radius-sm)', border: 'none', backgroundColor: 'var(--brand)', color: '#FFF', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              {busy === 'create' ? 'Đang gửi…' : 'Gửi yêu cầu'}
            </button>
            <button onClick={() => setShowCreate(false)} style={{ padding: '9px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text)', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>
              Đóng
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {([['ALL', 'Tất cả'], ['MINE', 'Liên quan tôi'], ['AWAITING', 'Chờ Giám đốc']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} style={{
            padding: '6px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
            border: `1px solid ${filter === k ? 'var(--brand)' : 'var(--border)'}`,
            backgroundColor: filter === k ? 'var(--brand)' : 'var(--surface)',
            color: filter === k ? '#FFF' : 'var(--text)',
          }}>{label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {filtered.length === 0 ? (
          <div style={{ ...card, padding: '26px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            {loading ? 'Đang tải…' : 'Chưa có yêu cầu công việc nội bộ nào.'}
          </div>
        ) : filtered.map((r: any) => {
          const sc = STATUS_COLOR[r.status] || STATUS_COLOR.PENDING;
          const canDone = r.status === 'PENDING' || r.status === 'IN_PROGRESS';
          const canApprove = isDirector && (r.status === 'AWAITING_DIRECTOR' || r.status === 'PENDING' || r.status === 'IN_PROGRESS');
          const open = expanded === r.request_id;
          return (
            <div key={r.request_id} style={card}>
              <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ minWidth: '260px', flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)' }}>{r.code}</span>
                    <span style={{ fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px', backgroundColor: sc.bg, color: sc.fg }}>{STATUS_LABEL[r.status] || r.status}</span>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>• {DEPT_LABEL[r.from_dept as Dept]} <ArrowRight size={11} style={{ verticalAlign: 'middle' }} /> {DEPT_LABEL[r.current_dept as Dept]}</span>
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 800, marginTop: '6px' }}>{r.title}</div>
                  {r.description && <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>{r.description}</div>}
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <span><Clock size={12} style={{ verticalAlign: 'middle' }} /> {new Date(r.created_at).toLocaleString('vi-VN')}</span>
                    <span>Người tạo: {r.created_by_name || r.created_by}</span>
                    {r.director_signature && <span style={{ color: '#065F46', fontWeight: 700 }}><PenTool size={12} style={{ verticalAlign: 'middle' }} /> GĐ ký: {r.director_signature.name}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {canDone && (
                    <button onClick={() => act(r.request_id, 'done')} disabled={busy === `${r.request_id}:done`} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px', borderRadius: 'var(--radius-sm)', border: 'none', backgroundColor: '#2563EB', color: '#FFF', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                      <CheckCircle size={14} /> Hoàn tất phần việc
                    </button>
                  )}
                  {canApprove && (
                    <button onClick={() => act(r.request_id, 'approve')} disabled={busy === `${r.request_id}:approve`} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px', borderRadius: 'var(--radius-sm)', border: 'none', backgroundColor: '#059669', color: '#FFF', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                      <PenTool size={14} /> Giám đốc ký duyệt
                    </button>
                  )}
                  {r.status !== 'APPROVED' && r.status !== 'REJECTED' && r.status !== 'CANCELLED' && (
                    <button onClick={() => act(r.request_id, 'reject')} disabled={busy === `${r.request_id}:reject`} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid #FCA5A5', backgroundColor: '#FEF2F2', color: '#991B1B', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                      <XCircle size={14} /> Từ chối
                    </button>
                  )}
                  <button onClick={() => setExpanded(open ? '' : r.request_id)} style={{ padding: '7px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                    {open ? 'Ẩn lịch sử' : 'Lịch sử'}
                  </button>
                </div>
              </div>
              {open && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', backgroundColor: 'var(--surface-2, #F8FAFC)' }}>
                  <div style={{ fontSize: '12px', fontWeight: 800, marginBottom: '8px' }}>Lịch sử xử lý (realtime)</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {(r.timeline || []).map((t: any, i: number) => (
                      <div key={i} style={{ fontSize: '12px', display: 'flex', gap: '8px' }}>
                        <span style={{ color: 'var(--text-muted)', minWidth: '140px' }}>{new Date(t.at).toLocaleString('vi-VN')}</span>
                        <span style={{ fontWeight: 700 }}>{t.action}</span>
                        {t.role && <span style={{ color: 'var(--text-muted)' }}>[{DEPT_LABEL[t.role as Dept] || t.role}]</span>}
                        <span>{t.by_name || t.by}{t.note ? ` — ${t.note}` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
