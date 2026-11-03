import React, { useEffect, useMemo, useState } from 'react';
import { Sliders, Plus, RefreshCw, Trash2, Users, Store, Globe, Pencil } from 'lucide-react';
import { apiRequest } from '../services/api';

/**
 * Cấu hình quy chế công ty và chọn ĐỐI TƯỢNG áp dụng:
 *  - Từng nhân viên
 *  - Từng chi nhánh
 *  - Tất cả nhân viên
 * Realtime: mọi tài khoản nội bộ thấy quy chế mới ngay.
 */
type TargetType = 'ALL' | 'BRANCH' | 'EMPLOYEE';

interface PolicyTarget { type: TargetType; branchIds?: string[]; employeeIds?: string[] }
interface Policy {
  policy_id: string; code: string; title: string; content: string; category: string;
  effective_from?: string; active: boolean; targets: PolicyTarget;
  created_at: string; updated_at: string; created_by: string; created_by_name?: string;
}

const emptyForm = () => ({
  policy_id: '', code: '', title: '', content: '', category: 'CHUNG', effective_from: '',
  active: true, targetType: 'ALL' as TargetType, branchIds: [] as string[], employeeIds: [] as string[],
});

export const CompanyPolicyView: React.FC<{ currentUser: any }> = ({ currentUser }) => {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [empSearch, setEmpSearch] = useState('');

  const canEdit = ['DIRECTOR', 'ADMIN'].includes(String(currentUser?.role || ''));

  const load = async () => {
    setLoading(true);
    try {
      const [pol, emps, brs] = await Promise.all([
        apiRequest('/company-policies').catch(() => []),
        apiRequest('/employees').catch(() => []),
        apiRequest('/admin/branches').catch(() => []),
      ]);
      setPolicies(Array.isArray(pol) ? pol : []);
      setEmployees(Array.isArray(emps) ? emps : []);
      setBranches(Array.isArray(brs) ? brs : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const handler = () => { load(); };
    window.addEventListener('ubm:company-policies-reload', handler as any);
    const timer = window.setInterval(handler, 20_000);
    return () => {
      window.removeEventListener('ubm:company-policies-reload', handler as any);
      window.clearInterval(timer);
    };
  }, []);

  const branchIds = useMemo(
    () => Array.from(new Set(branches.map((b: any) => String(b.id || b.branch_id || '')).filter(Boolean))),
    [branches],
  );

  const edit = (p: Policy) => {
    setForm({
      policy_id: p.policy_id,
      code: p.code, title: p.title, content: p.content, category: p.category,
      effective_from: p.effective_from || '',
      active: p.active,
      targetType: p.targets?.type || 'ALL',
      branchIds: p.targets?.branchIds || [],
      employeeIds: p.targets?.employeeIds || [],
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.title.trim()) { setNotice({ kind: 'err', text: 'Nhập tên quy chế.' }); return; }
    if (form.targetType === 'BRANCH' && form.branchIds.length === 0) { setNotice({ kind: 'err', text: 'Chọn ít nhất 1 chi nhánh.' }); return; }
    if (form.targetType === 'EMPLOYEE' && form.employeeIds.length === 0) { setNotice({ kind: 'err', text: 'Chọn ít nhất 1 nhân viên.' }); return; }
    setBusy('save');
    setNotice(null);
    try {
      await apiRequest('/company-policies', {
        method: 'POST',
        body: JSON.stringify({
          policy_id: form.policy_id || undefined,
          code: form.code || undefined,
          title: form.title,
          content: form.content,
          category: form.category,
          effective_from: form.effective_from || undefined,
          active: form.active,
          targets: {
            type: form.targetType,
            branchIds: form.targetType === 'BRANCH' ? form.branchIds : undefined,
            employeeIds: form.targetType === 'EMPLOYEE' ? form.employeeIds : undefined,
          },
        }),
      });
      setNotice({ kind: 'ok', text: 'Đã lưu quy chế và áp dụng cho đối tượng đã chọn.' });
      setShowForm(false);
      setForm(emptyForm());
      await load();
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Không lưu được quy chế: ${err?.message || err}` });
    } finally {
      setBusy('');
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Xóa quy chế này khỏi hệ thống?')) return;
    setBusy(id);
    try {
      await apiRequest(`/company-policies/${id}`, { method: 'DELETE' });
      await load();
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Không xóa được: ${err?.message || err}` });
    } finally {
      setBusy('');
    }
  };

  const targetLabel = (t: PolicyTarget) => {
    if (t?.type === 'BRANCH') return `Chi nhánh: ${(t.branchIds || []).join(', ') || '—'}`;
    if (t?.type === 'EMPLOYEE') {
      const names = (t.employeeIds || []).map(id => employees.find(e => e.employee_id === id)?.full_name || id);
      return `Nhân viên: ${names.slice(0, 6).join(', ')}${names.length > 6 ? ` +${names.length - 6}` : ''}`;
    }
    return 'Tất cả nhân viên';
  };

  const input: React.CSSProperties = {
    width: '100%', padding: '9px 11px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
    backgroundColor: 'var(--surface)', color: 'var(--text)', fontSize: '13px',
  };
  const card: React.CSSProperties = {
    backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-soft)',
  };

  const filteredEmps = employees
    .filter(e => {
      if (!empSearch.trim()) return true;
      const q = empSearch.toLowerCase();
      return String(e.full_name || '').toLowerCase().includes(q) || String(e.employee_code || '').toLowerCase().includes(q);
    })
    .slice(0, 60);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sliders size={20} /> Quy chế công ty
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Tạo quy chế và chọn đối tượng áp dụng: từng nhân viên, từng chi nhánh hoặc tất cả nhân viên. Realtime toàn hệ thống.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={load} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            <RefreshCw size={14} /> Tải lại
          </button>
          {canEdit && (
            <button onClick={() => { setForm(emptyForm()); setShowForm(v => !v); }} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: 'var(--radius-sm)', border: 'none', backgroundColor: 'var(--brand)', color: '#FFF', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
              <Plus size={15} /> Thêm quy chế
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div style={{ padding: '10px 12px', borderRadius: 'var(--radius-sm)', fontSize: '13px', fontWeight: 600, backgroundColor: notice.kind === 'ok' ? 'var(--success-soft)' : 'var(--danger-soft)', color: notice.kind === 'ok' ? '#065F46' : '#991B1B', border: `1px solid ${notice.kind === 'ok' ? '#A7F3D0' : '#FECACA'}` }}>
          {notice.text}
        </div>
      )}

      {showForm && canEdit && (
        <div style={{ ...card, padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontWeight: 800, fontSize: '15px' }}>{form.policy_id ? 'Sửa quy chế' : 'Thêm quy chế mới'}</div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ flex: 2, minWidth: '240px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '5px' }}>Tên quy chế *</label>
              <input style={input} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="VD: Quy chế đồng phục – tác phong" />
            </div>
            <div style={{ flex: 1, minWidth: '140px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '5px' }}>Mã / danh mục</label>
              <input style={input} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="CHUNG / LUONG / AN_TOAN" />
            </div>
            <div style={{ minWidth: '160px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '5px' }}>Hiệu lực từ</label>
              <input type="date" style={input} value={form.effective_from} onChange={e => setForm({ ...form, effective_from: e.target.value })} />
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '5px' }}>Nội dung quy chế</label>
            <textarea style={{ ...input, minHeight: '90px' }} value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '6px' }}>Đối tượng áp dụng</label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {([['ALL', 'Tất cả nhân viên', Globe], ['BRANCH', 'Từng chi nhánh', Store], ['EMPLOYEE', 'Từng nhân viên', Users]] as const).map(([k, label, Icon]) => (
                <button key={k} type="button" onClick={() => setForm({ ...form, targetType: k })} style={{
                  display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                  border: `1px solid ${form.targetType === k ? 'var(--brand)' : 'var(--border)'}`,
                  backgroundColor: form.targetType === k ? 'var(--brand)' : 'var(--surface)',
                  color: form.targetType === k ? '#FFF' : 'var(--text)',
                }}>
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
          </div>

          {form.targetType === 'BRANCH' && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {branchIds.map(b => {
                const on = form.branchIds.includes(b);
                return (
                  <button key={b} type="button" onClick={() => setForm({ ...form, branchIds: on ? form.branchIds.filter(x => x !== b) : [...form.branchIds, b] })} style={{
                    padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                    border: `1px solid ${on ? 'var(--brand)' : 'var(--border)'}`,
                    backgroundColor: on ? 'var(--brand)' : 'var(--surface)',
                    color: on ? '#FFF' : 'var(--text)',
                  }}>{b}</button>
                );
              })}
              {branchIds.length === 0 && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Chưa có chi nhánh.</span>}
            </div>
          )}

          {form.targetType === 'EMPLOYEE' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input style={input} placeholder="Tìm nhân viên theo tên hoặc mã…" value={empSearch} onChange={e => setEmpSearch(e.target.value)} />
              <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                {filteredEmps.map(e => {
                  const id = String(e.employee_id);
                  const on = form.employeeIds.includes(id);
                  return (
                    <label key={id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 10px', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: '13px' }}>
                      <input type="checkbox" checked={on} onChange={() => setForm({ ...form, employeeIds: on ? form.employeeIds.filter(x => x !== id) : [...form.employeeIds, id] })} />
                      <span style={{ fontWeight: 600 }}>{e.full_name}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{e.employee_code} • {e.branch_id || '—'}</span>
                    </label>
                  );
                })}
                {filteredEmps.length === 0 && <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>Không tìm thấy nhân viên.</div>}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Đã chọn {form.employeeIds.length} nhân viên.</div>
            </div>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600 }}>
            <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> Kích hoạt áp dụng
          </label>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={save} disabled={busy === 'save'} style={{ padding: '9px 16px', borderRadius: 'var(--radius-sm)', border: 'none', backgroundColor: 'var(--brand)', color: '#FFF', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              {busy === 'save' ? 'Đang lưu…' : 'Lưu quy chế'}
            </button>
            <button onClick={() => { setShowForm(false); setForm(emptyForm()); }} style={{ padding: '9px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text)', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>
              Đóng
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {policies.length === 0 ? (
          <div style={{ ...card, padding: '26px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            {loading ? 'Đang tải…' : 'Chưa có quy chế nào. Bấm "Thêm quy chế" để tạo.'}
          </div>
        ) : policies.map(p => (
          <div key={p.policy_id} style={{ ...card, padding: '16px', display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '260px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)' }}>{p.code}</span>
                <span style={{ fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px', backgroundColor: p.active ? '#D1FAE5' : '#E5E7EB', color: p.active ? '#065F46' : '#374151' }}>
                  {p.active ? 'Đang áp dụng' : 'Tạm ẩn'}
                </span>
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>• {p.category}</span>
              </div>
              <div style={{ fontSize: '15px', fontWeight: 800, marginTop: '5px' }}>{p.title}</div>
              {p.content && <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '3px', whiteSpace: 'pre-wrap' }}>{p.content}</div>}
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
                🎯 {targetLabel(p.targets)}{p.effective_from ? ` • Hiệu lực từ ${p.effective_from}` : ''}
              </div>
            </div>
            {canEdit && (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <button onClick={() => edit(p)} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                  <Pencil size={13} /> Sửa
                </button>
                <button onClick={() => remove(p.policy_id)} disabled={busy === p.policy_id} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid #FCA5A5', backgroundColor: '#FEF2F2', color: '#991B1B', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                  <Trash2 size={13} /> Xóa
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
