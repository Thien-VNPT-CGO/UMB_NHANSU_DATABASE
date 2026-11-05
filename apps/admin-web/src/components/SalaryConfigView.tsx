import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DollarSign, RefreshCw, Save, Search, CheckCircle2, AlertTriangle, Building2, Lock, Wallet } from 'lucide-react';
import { apiRequest } from '../services/api';
import { effectivePayMode, isPayModeLockedToGroup, payModeLabel, type PayMode } from '@ubm/shared';
import {
  FINANCE_BLOCK_OPTIONS,
  FINANCE_BLOCK_SHORT,
  FINANCE_BLOCK_STYLE,
  financeBlockOf,
  type FinanceBlock,
} from '../utils/financeBlocks';

/**
 * Cấu hình Lương cơ bản + Phụ cấp — Kế toán (FINANCE) / Admin.
 *
 * Quy tắc nghiệp vụ (chủ dự án chốt 2026-11):
 *  - HR (và nhân sự) thêm hồ sơ nhân viên mới tại tab "Nhân sự" nhưng KHÔNG đặt lương.
 *  - Kế toán cấu hình mức lương cơ bản + phụ cấp cho TỪNG nhân viên, phụ thuộc khối
 *    làm việc của nhân viên trong hệ thống (Văn Phòng / Xưởng SX / Sales / Cửa Hàng).
 *  - Lương 1 NV = Lương cơ bản + Phụ cấp.
 *  - Cấu hình là hồ sơ gốc — kỳ lương vẫn do kế toán nhập tay tại tab "Tính Lương"
 *    (không tự động đổ sang kỳ lương).
 *
 * Bền vững: backend lưu trong CÀI ĐẶT HỆ THỐNG (Google Sheets) — không đổi schema.
 */

type SalaryEntry = { pay_mode?: PayMode; base_salary?: number; allowance?: number; updatedAt?: string; updatedByName?: string };
type Draft = { base: string; allowance: string; mode: PayMode | '' };

const fmtVnd = (n: number) => `${Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('vi-VN')} đ`;

const STATUS_LABEL: Record<string, string> = {
  PRE_ONBOARDING: 'Mới tiếp nhận',
  PROBATION: 'Thử việc',
  OFFICIAL: 'Chính thức',
  TERMINATED: 'Đã nghỉ',
};

export const SalaryConfigView: React.FC<{ currentUser: any }> = ({ currentUser }) => {
  const role: string = String(currentUser?.role || '').toUpperCase();
  const canEdit = ['FINANCE', 'ADMIN'].includes(role);

  const [employees, setEmployees] = useState<any[]>([]);
  const [configs, setConfigs] = useState<Record<string, SalaryEntry>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});
  const [savingAll, setSavingAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [block, setBlock] = useState<FinanceBlock>('ALL');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Ref mirror để `load()` (useCallback deps=[]) luôn đọc đúng tập dirty mới nhất.
  const dirtyRef = useRef<Record<string, boolean>>({});
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const [empsRes, cfgRes] = await Promise.allSettled([
        apiRequest('/employees'),
        apiRequest('/salary-config'),
      ]);
      const list = empsRes.status === 'fulfilled' && Array.isArray(empsRes.value) ? (empsRes.value as any[]) : [];
      const cfgRaw = cfgRes.status === 'fulfilled' ? (cfgRes.value as any)?.configs : null;
      const cfg: Record<string, SalaryEntry> = cfgRaw && typeof cfgRaw === 'object' ? cfgRaw : {};
      const active = list.filter(e => String(e?.employment_status || '') !== 'TERMINATED');
      setEmployees(active);
      setConfigs(cfg);
      setDrafts(prev => {
        const next: Record<string, Draft> = {};
        const curDirty = dirtyRef.current;
        for (const e of active) {
          const entry = cfg[e.employee_id];
          // Giữ nguyên draft đang sửa dở của NV chưa lưu.
          next[e.employee_id] = prev[e.employee_id] && curDirty[e.employee_id]
            ? prev[e.employee_id]
            : {
                base: entry?.base_salary != null ? String(entry.base_salary) : '',
                allowance: entry?.allowance != null ? String(entry.allowance) : '',
                mode: entry?.pay_mode ?? '',
              };
        }
        return next;
      });
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Không tải được dữ liệu: ${err?.message || err}` });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    const onReload = () => { load(); };
    window.addEventListener('ubm:employees-reload', onReload);
    return () => window.removeEventListener('ubm:employees-reload', onReload);
  }, [load]);

  const setDraft = (employeeId: string, field: 'base' | 'allowance' | 'mode', value: string) => {
    if (!canEdit) return;
    setDrafts(prev => {
      const cur = prev[employeeId] || { base: '', allowance: '', mode: '' };
      return { ...prev, [employeeId]: { ...cur, [field]: field === 'mode' ? (value as PayMode | '') : value } };
    });
    setDirty(prev => ({ ...prev, [employeeId]: true }));
  };

  /** Hình thức lương đang hiển thị: cấu hình đã lưu (hoặc mặc định khối), bị bản nháp ghi đè. */
  const effectiveModeOf = useCallback((emp: any): PayMode => {
    const draft = drafts[emp.employee_id];
    if (draft && draft.mode) return draft.mode;
    return effectivePayMode(emp?.group, configs[emp.employee_id]?.pay_mode);
  }, [drafts, configs]);

  const saveOne = async (employeeId: string): Promise<boolean> => {
    if (!canEdit) return false;
    const draft = drafts[employeeId] || { base: '0', allowance: '0', mode: '' };
    const baseSalary = Math.max(0, Math.floor(Number(draft.base || 0) || 0));
    const allowance = Math.max(0, Math.floor(Number(draft.allowance || 0) || 0));
    const payMode = draft.mode || undefined;
    setSavingIds(prev => ({ ...prev, [employeeId]: true }));
    try {
      const res: any = await apiRequest(`/salary-config/${encodeURIComponent(employeeId)}`, {
        method: 'PUT',
        body: JSON.stringify({ baseSalary, allowance, ...(payMode ? { payMode } : {}) }),
      });
      const entry: SalaryEntry = res?.config || { base_salary: baseSalary, allowance, pay_mode: payMode };
      setConfigs(prev => ({ ...prev, [employeeId]: entry }));
      setDrafts(prev => ({ ...prev, [employeeId]: { base: String(entry.base_salary ?? 0), allowance: String(entry.allowance ?? 0), mode: entry.pay_mode ?? '' } }));
      setDirty(prev => ({ ...prev, [employeeId]: false }));
      window.dispatchEvent(new CustomEvent('ubm:salary-config-saved'));
      return true;
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Lưu lương thất bại: ${err?.message || err}` });
      return false;
    } finally {
      setSavingIds(prev => ({ ...prev, [employeeId]: false }));
    }
  };

  const dirtyIds = useMemo(() => Object.keys(dirty).filter(k => dirty[k]), [dirty]);

  const saveAll = async () => {
    if (!canEdit || dirtyIds.length === 0) return;
    setSavingAll(true);
    setNotice(null);
    let ok = 0;
    for (const id of dirtyIds) {
      // Tuần tự để tránh ghi đè cấu hình (backend đã có khóa tuần tự, đây là lớp bảo vệ thứ 2).
      // eslint-disable-next-line no-await-in-loop
      const saved = await saveOne(id);
      if (saved) ok += 1;
    }
    setSavingAll(false);
    setNotice(ok === dirtyIds.length
      ? { kind: 'ok', text: `Đã lưu cấu hình lương cho ${ok} nhân viên.` }
      : { kind: 'err', text: `Đã lưu ${ok}/${dirtyIds.length} nhân viên — kiểm tra lại các dòng lỗi.` });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter(e => {
      if (block !== 'ALL' && financeBlockOf(e) !== block) return false;
      if (!q) return true;
      const hay = `${e.full_name || ''} ${e.employee_code || ''} ${e.phone_normalized || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [employees, search, block]);

  const grouped = useMemo(() => {
    const order: Exclude<FinanceBlock, 'ALL'>[] = ['VAN_PHONG', 'XUONG', 'SALE', 'CUA_HANG'];
    const map = new Map<Exclude<FinanceBlock, 'ALL'>, any[]>();
    for (const key of order) map.set(key, []);
    for (const e of filtered) map.get(financeBlockOf(e))!.push(e);
    for (const key of order) {
      map.get(key)!.sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || ''), 'vi'));
    }
    return order.map(key => ({ key, label: FINANCE_BLOCK_SHORT[key], rows: map.get(key)! })).filter(g => g.rows.length > 0);
  }, [filtered]);

  const summary = useMemo(() => {
    const order: Exclude<FinanceBlock, 'ALL'>[] = ['VAN_PHONG', 'XUONG', 'SALE', 'CUA_HANG'];
    return order.map(key => {
      const rows = employees.filter(e => financeBlockOf(e) === key);
      const configured = rows.filter(e => {
        const c = configs[e.employee_id];
        const mode = effectivePayMode(e?.group, c?.pay_mode);
        const base = Number(c?.base_salary) || 0;
        const allowance = Number(c?.allowance) || 0;
        if (mode === 'MONTHLY') return base > 0 || allowance > 0;
        return allowance > 0 || !!c?.pay_mode; // HOURLY: phụ cấp hoặc đã chọn hình thức
      }).length;
      return { key, total: rows.length, configured };
    });
  }, [employees, configs]);

  const totalConfigured = summary.reduce((s, x) => s + x.configured, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
            <Wallet size={22} color="var(--brand)" />
            Cấu hình Lương cơ bản & Phụ cấp — theo Khối
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px', maxWidth: '900px' }}>
            Kế toán cấu hình <strong>hình thức lương</strong> + <strong>lương cơ bản</strong> + <strong>phụ cấp</strong> cho từng nhân viên, phụ thuộc khối làm việc.
            Khối <strong>Cửa hàng</strong>: theo ca (cố định) · Khối <strong>Văn phòng</strong>: lương cơ bản theo tháng (cố định) · Khối <strong>Xưởng / Sale</strong>: tùy chọn theo tháng hoặc theo ca, đổi riêng từng NV.
            <strong>Lương (theo tháng) = Lương cơ bản + Phụ cấp</strong>; phụ cấp cộng cả cho hình thức theo ca. HR không đặt lương (chỉ xem). Cấu hình là hồ sơ gốc — kỳ lương nhập tay như cũ tại tab "Tính Lương" (NV lương tháng để trống LCB = tự lấy số cấu hình).
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={load}
            disabled={loading}
            title="Tải lại danh sách"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
            Tải lại
          </button>
          <button
            onClick={saveAll}
            disabled={!canEdit || dirtyIds.length === 0 || savingAll}
            title={dirtyIds.length === 0 ? 'Chưa có thay đổi cần lưu' : `Lưu ${dirtyIds.length} nhân viên đang sửa`}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '9px 18px', borderRadius: 'var(--radius-sm)',
              backgroundColor: !canEdit || dirtyIds.length === 0 ? 'var(--border)' : 'var(--brand)',
              color: '#FFF', border: 'none', fontWeight: 800, fontSize: '13px',
              cursor: !canEdit || dirtyIds.length === 0 || savingAll ? 'not-allowed' : 'pointer',
              opacity: savingAll ? 0.75 : 1,
            }}
          >
            <Save size={15} />
            {savingAll ? 'Đang lưu...' : `Lưu tất cả${dirtyIds.length ? ` (${dirtyIds.length})` : ''}`}
          </button>
        </div>
      </div>

      {/* Read-only banner for non-finance roles */}
      {!canEdit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 'var(--radius-sm)', color: '#92400E', fontSize: '12px', fontWeight: 600 }}>
          <Lock size={14} />
          Bạn chỉ có quyền XEM cấu hình lương. Lương cơ bản + phụ cấp do Kế toán (FINANCE) hoặc Admin cấu hình.
        </div>
      )}

      {/* Notice */}
      {notice && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: 'var(--radius-sm)', fontSize: '13px', fontWeight: 600,
          backgroundColor: notice.kind === 'ok' ? '#ECFDF5' : '#FEF2F2',
          border: `1px solid ${notice.kind === 'ok' ? '#A7F3D0' : '#FECACA'}`,
          color: notice.kind === 'ok' ? '#065F46' : '#991B1B',
        }}>
          {notice.kind === 'ok' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {notice.text}
          <button onClick={() => setNotice(null)} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', fontWeight: 800 }}>✕</button>
        </div>
      )}

      {/* Summary per block */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '12px' }}>
        {summary.map(s => {
          const opt = FINANCE_BLOCK_OPTIONS.find(o => o.id === s.key)!;
          const style = FINANCE_BLOCK_STYLE[s.key];
          return (
            <button
              key={s.key}
              onClick={() => setBlock(block === s.key ? 'ALL' : s.key)}
              title="Bấm để lọc theo khối này"
              style={{
                textAlign: 'left', cursor: 'pointer',
                backgroundColor: block === s.key ? style.bg : 'var(--surface)',
                border: `1.5px solid ${block === s.key ? style.c : 'var(--border)'}`,
                borderRadius: 'var(--radius-md)', padding: '12px 14px',
                display: 'flex', flexDirection: 'column', gap: '4px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 800, color: style.c }}>
                <span style={{ fontSize: '16px' }}>{opt.icon}</span> {opt.label}
              </div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>
                {s.configured}<span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 700 }}> / {s.total} đã cấu hình</span>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Lương CB + phụ cấp riêng từng NV</div>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', backgroundColor: 'var(--surface)', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '220px', position: 'relative' }}>
          <input
            type="text"
            placeholder="Tìm theo họ tên, mã NV (UBM_NV...), SĐT..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', padding: '9px 12px 9px 36px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '13px' }}
          />
          <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {FINANCE_BLOCK_OPTIONS.map(o => {
            const active = block === o.id;
            return (
              <button
                key={o.id}
                onClick={() => setBlock(o.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '7px 12px', borderRadius: 'var(--radius-full)',
                  border: `1px solid ${active ? 'var(--brand)' : 'var(--border)'}`,
                  backgroundColor: active ? 'var(--brand-soft)' : 'var(--surface)',
                  color: active ? 'var(--brand)' : 'var(--text)',
                  fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                }}
              >
                <span>{o.icon}</span>{o.short}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 700 }}>
          {filtered.length} NV hiển thị · {totalConfigured} đã cấu hình
        </div>
      </div>

      {/* Table, grouped by block */}
      <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: '1280px', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
              <th style={{ padding: '11px 16px' }}>Mã NV</th>
              <th style={{ padding: '11px 16px' }}>Họ và tên</th>
              <th style={{ padding: '11px 16px' }}>Khối</th>
              <th style={{ padding: '11px 16px' }}>Chi nhánh</th>
              <th style={{ padding: '11px 16px' }}>Giai đoạn</th>
              <th style={{ padding: '11px 16px', width: '170px' }}>Hình thức lương</th>
              <th style={{ padding: '11px 16px', width: '150px' }}>Lương cơ bản (đ/tháng)</th>
              <th style={{ padding: '11px 16px', width: '140px' }}>Phụ cấp (đ/tháng)</th>
              <th style={{ padding: '11px 16px', width: '140px' }}>Tổng lương</th>
              <th style={{ padding: '11px 16px' }}>Cập nhật</th>
              <th style={{ padding: '11px 16px', width: '90px' }}>Lưu</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(group => (
              <React.Fragment key={group.key}>
                <tr style={{ backgroundColor: FINANCE_BLOCK_STYLE[group.key].bg }}>
                  <td colSpan={11} style={{ padding: '7px 16px', fontSize: '11px', fontWeight: 800, color: FINANCE_BLOCK_STYLE[group.key].c, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    {FINANCE_BLOCK_OPTIONS.find(o => o.id === group.key)?.icon} Khối {group.label} — {group.rows.length} nhân viên
                  </td>
                </tr>
                {group.rows.map((emp: any) => {
                  const draft = drafts[emp.employee_id] || { base: '', allowance: '' };
                  const base = Number(draft.base || 0) || 0;
                  const allowance = Number(draft.allowance || 0) || 0;
                  const isDirty = !!dirty[emp.employee_id];
                  const isSaving = !!savingIds[emp.employee_id];
                  const cfg = configs[emp.employee_id];
                  const blk = financeBlockOf(emp);
                  const blkStyle = FINANCE_BLOCK_STYLE[blk];
                  const effMode = effectiveModeOf(emp);
                  const modeLocked = isPayModeLockedToGroup(emp?.group);
                  const monthly = effMode === 'MONTHLY';
                  return (
                    <tr key={emp.employee_id} style={{ borderBottom: '1px solid var(--border)', backgroundColor: isDirty ? '#FFFBEB' : undefined }}>
                      <td style={{ padding: '10px 16px' }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--brand)', backgroundColor: 'var(--brand-soft)', padding: '3px 8px', borderRadius: '4px' }}>
                          {emp.employee_code}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px', fontWeight: 700 }}>{emp.full_name}</td>
                      <td style={{ padding: '10px 16px' }}>
                        <span style={{ padding: '3px 10px', borderRadius: 'var(--radius-full)', fontSize: '11px', fontWeight: 700, backgroundColor: blkStyle.bg, color: blkStyle.c, whiteSpace: 'nowrap' }}>
                          {FINANCE_BLOCK_SHORT[blk]}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: '12px' }}>{emp.default_branch_id}</td>
                      <td style={{ padding: '10px 16px', fontSize: '12px' }}>{STATUS_LABEL[emp.employment_status] || emp.employment_status}</td>
                      <td style={{ padding: '10px 16px' }}>
                        {modeLocked ? (
                          <span title={effMode === 'MONTHLY' ? 'Khối văn phòng: lương cơ bản theo tháng (cố định)' : 'Khối cửa hàng: lương theo ca (cố định)'} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: 'var(--radius-full)', fontSize: '11px', fontWeight: 800, backgroundColor: effMode === 'MONTHLY' ? '#DBEAFE' : '#FEF3C7', color: effMode === 'MONTHLY' ? '#1D4ED8' : '#92400E', whiteSpace: 'nowrap' }}>
                            <Lock size={11} /> {payModeLabel(effMode)} (cố định)
                          </span>
                        ) : (
                          <select
                            value={effMode}
                            disabled={!canEdit}
                            onChange={(e) => setDraft(emp.employee_id, 'mode', e.target.value)}
                            title={canEdit ? 'Chọn hình thức lương cho NV này (chỉ Xưởng / Sale được tùy chỉnh)' : 'Kế toán chọn hình thức lương'}
                            style={{ width: '100%', padding: '7px 9px', borderRadius: 'var(--radius-sm)', border: `1px solid ${isDirty ? '#F59E0B' : 'var(--border)'}`, fontSize: '12px', fontWeight: 700, backgroundColor: canEdit ? '#FFF' : 'var(--bg)' }}
                          >
                            <option value="MONTHLY">Theo tháng (lương cơ bản)</option>
                            <option value="HOURLY">Theo ca (giờ công)</option>
                          </select>
                        )}
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <input
                          type="number"
                          min={0}
                          step={100000}
                          disabled={!canEdit || !monthly}
                          value={monthly ? draft.base : ''}
                          placeholder={monthly ? '0' : '— theo ca'}
                          onChange={(e) => setDraft(emp.employee_id, 'base', e.target.value)}
                          title={canEdit ? 'Nhập lương cơ bản (đ/tháng)' : 'Kế toán cấu hình'}
                          style={{ width: '100%', padding: '7px 9px', borderRadius: 'var(--radius-sm)', border: `1px solid ${isDirty ? '#F59E0B' : 'var(--border)'}`, fontSize: '13px', fontWeight: 700, textAlign: 'right', backgroundColor: canEdit ? '#FFF' : 'var(--bg)' }}
                        />
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <input
                          type="number"
                          min={0}
                          step={50000}
                          disabled={!canEdit}
                          value={draft.allowance}
                          placeholder="0"
                          onChange={(e) => setDraft(emp.employee_id, 'allowance', e.target.value)}
                          title={canEdit ? 'Nhập phụ cấp (đ/tháng)' : 'Kế toán cấu hình'}
                          style={{ width: '100%', padding: '7px 9px', borderRadius: 'var(--radius-sm)', border: `1px solid ${isDirty ? '#F59E0B' : 'var(--border)'}`, fontSize: '13px', fontWeight: 700, textAlign: 'right', backgroundColor: canEdit ? '#FFF' : 'var(--bg)' }}
                        />
                      </td>
                      <td style={{ padding: '10px 16px', fontWeight: 800, color: 'var(--success)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {monthly
                          ? fmtVnd(base + allowance)
                          : <span title="NV hình thức theo ca: lương = giờ công × đơn giá; phụ cấp vẫn cộng theo tháng" style={{ fontSize: '11px', fontWeight: 800, color: '#92400E', backgroundColor: '#FEF3C7', borderRadius: 'var(--radius-full)', padding: '3px 10px' }}>Theo ca + PC {allowance > 0 ? fmtVnd(allowance) : '0 đ'}</span>}
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {cfg?.updatedAt ? new Date(cfg.updatedAt).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Chưa cấu hình'}
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <button
                          onClick={() => saveOne(emp.employee_id)}
                          disabled={!canEdit || !isDirty || isSaving}
                          title={!canEdit ? 'Chỉ Kế toán / Admin lưu được' : isDirty ? 'Lưu cấu hình cho nhân viên này' : 'Không có thay đổi'}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '5px',
                            padding: '7px 12px', borderRadius: 'var(--radius-sm)',
                            border: `1px solid ${!canEdit || !isDirty ? 'var(--border)' : '#059669'}`,
                            backgroundColor: !canEdit || !isDirty ? 'var(--bg)' : '#ECFDF5',
                            color: !canEdit || !isDirty ? 'var(--text-muted)' : '#047857',
                            fontWeight: 800, fontSize: '12px',
                            cursor: !canEdit || !isDirty || isSaving ? 'not-allowed' : 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <Save size={13} />
                          {isSaving ? 'Đang lưu' : 'Lưu'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                  <Building2 size={28} style={{ opacity: 0.4, marginBottom: '6px' }} />
                  <div>Không tìm thấy nhân viên phù hợp bộ lọc.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <DollarSign size={12} />
        Văn phòng & NV hình thức lương tháng: lương theo THÁNG = LCB + phụ cấp (không tính theo ca). NV hình thức theo ca: giờ công × đơn giá + phụ cấp. HR thêm hồ sơ NV mới (tab Nhân sự) nhưng không đặt lương — Kế toán cấu hình tại đây, phụ thuộc khối làm việc. Lưu xong áp dụng cho hồ sơ gốc; kỳ lương nhập tại tab "Tính Lương".
      </div>
    </div>
  );
};
