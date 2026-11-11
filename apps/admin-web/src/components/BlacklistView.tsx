import React, { useMemo, useState } from 'react';
import { Ban, Search, ShieldAlert, Unlock, Users } from 'lucide-react';
import { apiRequest } from '../services/api';
import { getDisplayBranch } from '../App';

/**
 * DANH SÁCH ĐEN — NV THỬ VIỆC nghỉ giữa kỳ.
 *
 * Quy tắc nghiệp vụ:
 *  - Đưa NV vào danh sách đen => khóa đăng nhập web app (xóa PIN) + hủy ca từ
 *    hôm nay => NV KHÔNG còn hiện trên Lịch làm việc của cổng admin.
 *  - Hồ sơ + điểm danh + công + lương GIỮ NGUYÊN => Phiếu lương vẫn hiển thị
 *    đầy đủ để tính lương (server không đổi trạng thái sang TERMINATED).
 *  - Bỏ khỏi danh sách đen => mở khóa + cấp PIN 6 số mới.
 */

const BLACKLIST_REASONS = [
  'Nghỉ giữa kỳ thử việc',
  'Nghỉ trước 7 ngày thử việc',
  'Nghỉ sau 7 ngày thử việc',
  'Tự ý nghỉ không báo trước',
  'Vi phạm nội quy thử việc',
  'Khác (ghi rõ ở ghi chú)',
];

const fmtDateTime = (iso: string) => {
  const s = String(iso || '');
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 16).replace('T', ' ');
  const vn = new Date(d.getTime() + 7 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(vn.getUTCDate())}/${p(vn.getUTCMonth() + 1)}/${vn.getUTCFullYear()} ${p(vn.getUTCHours())}:${p(vn.getUTCMinutes())}`;
};

export const isBlacklisted = (emp: any): boolean =>
  !!emp && ((emp as any).blacklisted === true || !!(emp as any).blacklist);

/** Nút "Đưa vào danh sách đen" đặt trên thẻ NV thử việc (kèm modal lý do). */
export const BlacklistButton: React.FC<{
  emp: any;
  showToast: (msg: string) => void;
  onRefreshData?: () => Promise<void> | void;
}> = ({ emp, showToast, onRefreshData }) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(BLACKLIST_REASONS[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res: any = await apiRequest(`/employees/${emp.employee_id}/blacklist`, {
        method: 'POST',
        body: JSON.stringify({ reason, note }),
      });
      showToast(`🚫 Đã đưa ${emp.full_name} vào Danh sách đen + khóa đăng nhập + xóa ${res?.shiftsCancelled ?? 0} ca từ hôm nay!`);
      try { window.dispatchEvent(new CustomEvent('ubm:employee-locked', { detail: { employeeId: emp.employee_id } })); } catch { /* non-fatal */ }
      setOpen(false);
      setNote('');
      if (onRefreshData) await onRefreshData();
      try { window.dispatchEvent(new CustomEvent('ubm:data-changed', { detail: { source: 'blacklist' } })); } catch { /* non-fatal */ }
    } catch (e: any) {
      showToast(e?.message || 'Lỗi khi đưa vào Danh sách đen!');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        className="btn-secondary"
        style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 700, color: '#991B1B', borderColor: '#FECACA', backgroundColor: '#FEF2F2' }}
        onClick={() => setOpen(true)}
        title="NV thử việc nghỉ giữa kỳ: đưa vào Danh sách đen — khóa đăng nhập, ẩn khỏi Lịch làm việc, GIỮ phiếu lương để tính lương"
      >
        🚫 Danh sách đen
      </button>
      {open && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: '16px' }}>
          <div style={{ backgroundColor: 'var(--surface)', borderRadius: '12px', width: '100%', maxWidth: '480px', overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', backgroundColor: '#991B1B', color: '#FFF', fontWeight: 800, fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldAlert size={17} /> Đưa vào Danh sách đen
            </div>
            <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontSize: '13px' }}>
                Nhân viên: <strong>{emp.full_name}</strong> ({emp.employee_code})
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {getDisplayBranch(emp.default_branch_id)} • Thử việc
                </div>
              </div>
              <div style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#991B1B', lineHeight: 1.55 }}>
                Khi xác nhận: <strong>khóa đăng nhập web app</strong> + xóa PIN + <strong>xóa lịch làm việc từ hôm nay</strong>.
                Hồ sơ, điểm danh, công và <strong>Phiếu lương vẫn giữ đầy đủ</strong> để tính lương.
              </div>
              <label style={{ fontSize: '12px', fontWeight: 800, color: 'var(--text)' }}>
                Lý do
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  style={{ width: '100%', marginTop: '5px', padding: '9px 10px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px', backgroundColor: 'var(--surface)', color: 'var(--text)' }}
                >
                  {BLACKLIST_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label style={{ fontSize: '12px', fontWeight: 800, color: 'var(--text)' }}>
                Ghi chú (không bắt buộc)
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 1000))}
                  rows={3}
                  placeholder="Ví dụ: nghỉ sau 5 ngày, đã bàn giao đồng phục, chưa nhận lương..."
                  style={{ width: '100%', marginTop: '5px', padding: '9px 10px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px', fontFamily: 'inherit', resize: 'vertical', color: 'var(--text)' }}
                />
              </label>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button className="btn-secondary" style={{ padding: '8px 16px', fontSize: '13px' }} disabled={busy} onClick={() => setOpen(false)}>Hủy</button>
                <button
                  className="btn-primary"
                  style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 800, backgroundColor: '#991B1B' }}
                  disabled={busy}
                  onClick={submit}
                >
                  {busy ? '⏳ Đang xử lý...' : '🚫 Xác nhận Danh sách đen'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

/** Tab quản lý Danh sách đen: xem lý do/ngày/người đưa vào + bỏ khỏi danh sách đen. */
export const BlacklistView: React.FC<{
  employees: any[];
  showToast: (msg: string) => void;
  onRefreshData?: () => Promise<void> | void;
}> = ({ employees, showToast, onRefreshData }) => {
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pinResult, setPinResult] = useState<{ name: string; code: string; pin: string } | null>(null);

  const listed = useMemo(() => (employees || []).filter(isBlacklisted), [employees]);
  const branches = useMemo(() => {
    const set = new Set<string>();
    listed.forEach((e: any) => { if (e.default_branch_id) set.add(String(e.default_branch_id)); });
    return Array.from(set).sort();
  }, [listed]);
  const rows = useMemo(() => listed.filter((e: any) => {
    if (branchFilter !== 'ALL' && String(e.default_branch_id || '') !== branchFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [e.full_name, e.employee_code, e.phone_normalized, (e as any).blacklist?.reason, (e as any).blacklist?.note]
      .map((v) => String(v || '').toLowerCase()).some((v) => v.includes(q));
  }), [listed, branchFilter, search]);

  const remove = async (emp: any) => {
    if (busyId) return;
    if (!window.confirm(`BỎ ${emp.full_name} (${emp.employee_code}) khỏi Danh sách đen?\nHệ thống mở khóa đăng nhập và cấp PIN 6 số mới (nếu tài khoản đang khóa).`)) return;
    setBusyId(emp.employee_id);
    try {
      const res: any = await apiRequest(`/employees/${emp.employee_id}/unblacklist`, { method: 'POST' });
      setPinResult({ name: emp.full_name, code: emp.employee_code, pin: res?.pin || '' });
      showToast(`✅ Đã bỏ ${emp.full_name} khỏi Danh sách đen!`);
      try { window.dispatchEvent(new CustomEvent('ubm:employee-unlocked', { detail: { employeeId: emp.employee_id } })); } catch { /* non-fatal */ }
      if (onRefreshData) await onRefreshData();
    } catch (e: any) {
      showToast(e?.message || 'Lỗi khi bỏ khỏi Danh sách đen!');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div id="sec-blacklist" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <h1 style={{ fontSize: '22px', fontWeight: 800, margin: 0, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Ban size={22} color="#991B1B" /> Danh Sách Đen — Nhân Viên Thử Việc
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
          NV thử việc nghỉ giữa kỳ (chưa đủ hoặc đã đủ 7 ngày). Đăng nhập web app bị khóa, KHÔNG hiện trên Lịch làm việc;
          hồ sơ + điểm danh + công + <strong>Phiếu lương vẫn giữ đầy đủ</strong> để tính lương.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', backgroundColor: 'var(--surface)', padding: '12px 16px', borderRadius: '10px', border: '1px solid var(--border)' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '220px' }}>
          <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Tìm theo Mã NV, Họ Tên, SĐT, lý do..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', padding: '8px 12px 8px 36px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px', backgroundColor: 'var(--surface)', color: 'var(--text)' }}
          />
        </div>
        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px', backgroundColor: 'var(--surface)', color: 'var(--text)' }}
        >
          <option value="ALL">Tất cả chi nhánh</option>
          {branches.map((b) => <option key={b} value={b}>{getDisplayBranch(b)}</option>)}
        </select>
        <span style={{ fontSize: '12px', fontWeight: 800, color: '#991B1B', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '999px', padding: '4px 12px' }}>
          {rows.length} nhân viên
        </span>
      </div>

      <div style={{ backgroundColor: 'var(--surface)', borderRadius: '10px', border: '1px solid var(--border)', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--bg)' }}>
              {['Nhân viên', 'Chi nhánh', 'Lý do', 'Thử việc', 'Thời điểm', 'Người đưa vào', 'Trạng thái', 'Thao tác'].map((h) => (
                <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((emp: any) => {
              const rec = (emp as any).blacklist || {};
              const locked = !!(emp.account_locked || emp.account_status === 'LOCKED');
              return (
                <tr key={emp.employee_id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ fontWeight: 800, color: 'var(--text)' }}>{emp.full_name}</div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>{emp.employee_code} • {emp.phone_normalized || emp.phone || '—'}</div>
                  </td>
                  <td style={{ padding: '12px 14px', color: 'var(--text-muted)' }}>{getDisplayBranch(emp.default_branch_id)}</td>
                  <td style={{ padding: '12px 14px', maxWidth: '240px' }}>
                    <div style={{ fontWeight: 700, color: '#991B1B' }}>{rec.reason || '—'}</div>
                    {rec.note ? <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px', whiteSpace: 'pre-wrap' }}>{rec.note}</div> : null}
                  </td>
                  <td style={{ padding: '12px 14px', fontWeight: 700, color: rec.probation_days >= 7 ? '#B45309' : '#DC2626' }}>
                    {typeof rec.probation_days === 'number' ? `${rec.probation_days}/12 ngày` : '—'}
                  </td>
                  <td style={{ padding: '12px 14px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtDateTime(rec.blacklisted_at)}</td>
                  <td style={{ padding: '12px 14px', color: 'var(--text-muted)' }}>{rec.blacklisted_by || '—'}</td>
                  <td style={{ padding: '12px 14px' }}>
                    {locked ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 800, backgroundColor: '#FEE2E2', color: '#991B1B', border: '1px solid #FECACA', whiteSpace: 'nowrap' }}>
                        🔒 ĐÃ KHÓA
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 800, backgroundColor: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A', whiteSpace: 'nowrap' }}>
                        ⚠️ CHƯA KHÓA
                      </span>
                    )}
                    <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '3px' }}>Ẩn khỏi lịch làm việc</div>
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <button
                      className="btn-secondary"
                      style={{ padding: '5px 12px', fontSize: '12px', fontWeight: 700, color: '#059669', borderColor: '#A7F3D0', whiteSpace: 'nowrap' }}
                      disabled={busyId === emp.employee_id}
                      onClick={() => remove(emp)}
                      title="Gỡ khỏi danh sách đen + mở khóa + cấp PIN mới"
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <Unlock size={12} /> {busyId === emp.employee_id ? '⏳...' : 'Bỏ khỏi DS đen'}
                      </span>
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-muted)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                    <Users size={34} color="var(--border)" />
                    <div style={{ fontWeight: 700 }}>Chưa có nhân viên nào trong Danh sách đen</div>
                    <div style={{ fontSize: '12px' }}>Vào tab <strong>Nhân Viên Thử Việc</strong> → bấm <strong>🚫 Danh sách đen</strong> trên thẻ NV đã nghỉ.</div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pinResult && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: '16px' }}>
          <div style={{ backgroundColor: 'var(--surface)', borderRadius: '12px', maxWidth: '440px', width: '100%', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', backgroundColor: '#059669', color: '#FFF', fontWeight: 800, fontSize: '15px' }}>🔓 Đã bỏ khỏi Danh sách đen!</div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '14px', textAlign: 'center' }}>
              <div><strong>{pinResult.name}</strong> ({pinResult.code}) đã được mở khóa đăng nhập.</div>
              {pinResult.pin ? (
                <div style={{ backgroundColor: '#FFFBEB', border: '1.5px solid #F59E0B', borderRadius: '8px', padding: '12px' }}>
                  <div style={{ fontSize: '12px', color: '#92400E', fontWeight: 700 }}>Mã PIN mới (trao TRỰC TIẾP cho NV):</div>
                  <div style={{ fontSize: '28px', fontWeight: 900, letterSpacing: '6px', color: '#92400E' }}>{pinResult.pin}</div>
                  <div style={{ fontSize: '11px', color: '#92400E' }}>NV đăng nhập SĐT + PIN này rồi đặt PIN riêng ngay.</div>
                </div>
              ) : (
                <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Tài khoản đang hoạt động bình thường — không cần cấp PIN mới.</div>
              )}
              <button className="btn-primary" onClick={() => setPinResult(null)} style={{ padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: 800, border: 'none', cursor: 'pointer' }}>Đã rõ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
