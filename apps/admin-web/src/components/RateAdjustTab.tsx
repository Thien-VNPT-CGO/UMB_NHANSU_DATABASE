/**
 * 12 · ĐIỀU CHỈNH LƯƠNG CA — theo TỪNG nhân viên (Cổng Kế toán)
 *
 * - Không có "một đơn giá áp cho tất cả": mỗi NV nhập đơn giá MỚI riêng tại dòng của mình.
 * - Lưu bằng lịch sử giai đoạn/đơn giá (không ghi đè) — payroll engine lấy đúng rate theo từng ngày.
 * - "Áp dụng cho THÁNG CŨ": chỉ tính lại kỳ mà mọi phiếu đều DRAFT (hoặc chưa có phiếu);
 *   kỳ đã có phiếu NV ký/PAID → bỏ qua + nêu lý do (phiếu khóa, không đổi số tiền đã cam kết).
 */
// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2, Search, RefreshCw, Loader2, Check, X, Banknote, Users, ArrowRight,
  ShieldCheck, AlertCircle, History, Info, Lock, Filter,
} from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { periodLabel } from '@ubm/shared';
import { formatVND } from '../utils/FinanceFormat';
import './finance.css';

const BRANCH_LABEL: Record<string, string> = {
  CN130: 'CN1 — 130 Vạn Kiếp', CN261: 'CN2 — 261 Tô Hiến Thành',
  CN120: 'CN3 — 120 Hoàng Diệu 2', CN111: 'CN4 — 111 Tôn Đản',
  XUONG_SX: 'Xưởng Sản Xuất (Củ Chi)', VAN_PHONG: 'Văn Phòng Trụ Sở',
};
const BRANCH_ORDER = ['CN130', 'CN261', 'CN120', 'CN111', 'XUONG_SX', 'VAN_PHONG'];
const branchLabelOf = (id?: string | null) => BRANCH_LABEL[String(id || '').trim()] || String(id || '—');
const orderedBranchKeys = (keys: Iterable<string>) => {
  const set = new Set([...keys].map(k => String(k || 'KHAC')));
  return [...BRANCH_ORDER.filter(k => set.has(k)), ...[...set].filter(k => !BRANCH_ORDER.includes(k)).sort()];
};
const VN_OFFSET_MS = 7 * 3_600_000;
const todayVN = () => new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);
const monthOptions = () => {
  const out: Array<{ value: string; label: string }> = [];
  const base = new Date(Date.now() + VN_OFFSET_MS);
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
    const v = d.toISOString().slice(0, 7);
    out.push({ value: v, label: `Tháng ${v.slice(5, 7)}/${v.slice(0, 4)}${i === 0 ? ' (hiện tại)' : ''}` });
  }
  return out;
};
const sum = (rows: any[], key: string) => rows.reduce((s, r) => s + (Number(r?.[key]) || 0), 0);

export default function RateAdjustTab({ month, currentUser, showToast }: { month: string; currentUser: any; showToast: (msg: string) => void }) {
  const [branch, setBranch] = useState('*');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [includeProbation, setIncludeProbation] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(todayVN());
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [newRates, setNewRates] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [applyPast, setApplyPast] = useState(false);
  const [pastFromPeriod, setPastFromPeriod] = useState(() => monthOptions()[0]?.value || month);
  const [preview, setPreview] = useState<any>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitResult, setCommitResult] = useState<any>(null);
  const [historyFor, setHistoryFor] = useState<any>(null);
  const [historyRows, setHistoryRows] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // showToast đổi identity mỗi lần App re-render (inline arrow) — dùng ref để
  // effect load() KHÔNG bị re-trigger liên tục (gây fetch storm/giật lag).
  const showToastRef = useRef(showToast);
  useEffect(() => { showToastRef.current = showToast; });
  const inflightRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 400);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    setLoading(true);
    try {
      const params = new URLSearchParams({ period: month, branch, includeProbation: includeProbation ? '1' : '0', effectiveFrom });
      if (debouncedQ) params.set('q', debouncedQ);
      const data: any = await apiRequest(`/payroll/rates/eligible?${params.toString()}`);
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      if (effectiveFrom && !data?.rows) { /* giữ rows cũ nếu server lỗi */ }
    } catch (e: any) {
      showToastRef.current?.(e?.message || 'Không tải được danh sách nhân viên');
      // KHÔNG xoá rows hiện có — tránh bảng nhấp nháy/mất dữ liệu đang xem
    } finally {
      inflightRef.current = false;
      setLoading(false);
    }
  }, [month, branch, includeProbation, effectiveFrom, debouncedQ]);

  useEffect(() => { load(); /* tải khi đổi lọc/kỳ/ngày hiệu lực */ }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const r of rows) {
      const k = String(r.branchId || 'KHAC');
      const arr = map.get(k);
      if (arr) arr.push(r); else map.set(k, [r]);
    }
    return orderedBranchKeys(map.keys()).map(id => ({ id, rows: map.get(id)! }));
  }, [rows]);

  const validChanges = useMemo(() => {
    const out: Array<{ employeeId: string; employeeCode: string; fullName: string; branchId: string; stage: string; currentRate: number; newRate: number }> = [];
    for (const r of rows) {
      if (!checked[r.employeeId]) continue;
      const raw = String(newRates[r.employeeId] ?? '').trim();
      if (!raw) continue;
      const v = Math.round(Number(raw));
      if (!Number.isFinite(v) || v < 1000 || v > 1_000_000) continue;
      if (v === r.currentRate) continue;
      out.push({ employeeId: r.employeeId, employeeCode: r.employeeCode, fullName: r.fullName, branchId: r.branchId, stage: r.stage, currentRate: r.currentRate, newRate: v });
    }
    return out;
  }, [rows, checked, newRates]);

  const setRate = (r: any, value: string) => {
    setNewRates(prev => ({ ...prev, [r.employeeId]: value }));
    const v = Math.round(Number(value));
    const valid = value.trim() !== '' && Number.isFinite(v) && v >= 1000 && v <= 1_000_000 && v !== r.currentRate;
    setChecked(prev => ({ ...prev, [r.employeeId]: valid }));
  };

  const toggleAll = (on: boolean) => {
    const next: Record<string, boolean> = {};
    for (const r of rows) next[r.employeeId] = on && String(newRates[r.employeeId] ?? '').trim() !== '' && (() => { const v = Math.round(Number(newRates[r.employeeId])); return Number.isFinite(v) && v !== r.currentRate; })();
    setChecked(prev => ({ ...prev, ...next }));
  };

  const openHistory = useCallback(async (r: any) => {
    setHistoryFor(r);
    setHistoryLoading(true);
    try {
      const data: any = await apiRequest(`/payroll/rates/history?employeeId=${encodeURIComponent(r.employeeId)}&limit=100`);
      setHistoryRows(Array.isArray(data) ? data : []);
    } catch { setHistoryRows([]); } finally { setHistoryLoading(false); }
  }, []);

  const canPreview = validChanges.length > 0 && reason.trim().length >= 3;
  const buildPayload = () => ({
    changes: validChanges.map(({ employeeId, newRate }) => ({ employeeId, newRate })),
    effectiveFrom,
    applyPast,
    pastFromPeriod: applyPast ? pastFromPeriod : undefined,
    reason: reason.trim(),
  });

  const doPreview = useCallback(async () => {
    if (!canPreview) { showToast('Nhập đơn giá mới cho ít nhất 1 NV + lý do (tối thiểu 3 ký tự).'); return; }
    setPreviewBusy(true);
    try {
      const data: any = await apiRequest('/payroll/rates/adjust/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildPayload()),
      });
      setPreview(data);
    } catch (e: any) {
      showToast(e?.message || 'Không tạo được bản xem trước');
    } finally { setPreviewBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPreview, effectiveFrom, applyPast, pastFromPeriod, reason, validChanges, showToast]);

  const doCommit = useCallback(async () => {
    setCommitBusy(true);
    try {
      const data: any = await apiRequest('/payroll/rates/adjust/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildPayload()),
      });
      setCommitResult(data);
      setPreview(null);
      setNewRates({});
      setChecked({});
      showToast(`Đã áp dụng đơn giá mới cho ${data?.applied?.length ?? 0} nhân viên`);
      load();
    } catch (e: any) {
      showToast(e?.message || 'Áp dụng thất bại');
    } finally { setCommitBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveFrom, applyPast, pastFromPeriod, reason, validChanges, showToast, load]);

  const totalDelta = validChanges.reduce((s, r) => s + (r.newRate - r.currentRate), 0);
  const estMoney = preview?.totals?.estDelta ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Tab head */}
      <div className="fin-tab-head">
        <div>
          <div className="fin-tab-title"><span className="fin-tab-num">12</span>Điều chỉnh lương ca — theo TỪNG nhân viên</div>
          <div className="fin-tab-desc">Nhập đơn giá MỚI riêng cho từng người (không có “giá chung áp cho tất cả”). Lưu vào lịch sử — tính lương tự lấy đúng đơn giá theo từng ngày công. “Áp dụng cho tháng cũ” chỉ tính lại kỳ mà mọi phiếu đều DRAFT/chưa có phiếu.</div>
        </div>
        <div className="fin-chips">
          <span className="fin-chip-stat">{rows.length} NV hiển thị</span>
          <span className="fin-chip-stat" style={validChanges.length ? { borderColor: '#f9a8d4', color: '#b4457c' } : undefined}>Đang chọn: {validChanges.length} NV</span>
        </div>
      </div>

      {/* Lọc + ngày hiệu lực */}
      <div className="fin-card">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', padding: '12px 16px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: 'var(--fin-muted)', textTransform: 'uppercase' }}><Filter size={10} style={{ verticalAlign: -1 }} /> Chi nhánh</span>
            <select className="fin-input" style={{ minWidth: 210 }} value={branch} onChange={e => setBranch(e.target.value)}>
              <option value="*">Tất cả chi nhánh</option>
              {BRANCH_ORDER.map(id => <option key={id} value={id}>{branchLabelOf(id)}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: 'var(--fin-muted)', textTransform: 'uppercase' }}>Ngày hiệu lực</span>
            <input type="date" className="fin-input" style={{ minWidth: 170 }} value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} />
          </label>
          <div className="fin-search" style={{ minWidth: 230 }}>
            <Search size={14} color="#94a3b8" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm tên / mã NV…" aria-label="Tìm nhân viên" />
            {q && <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" style={{ border: 'none', padding: 2 }} onClick={() => setQ('')}><X size={14} /></button>}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--fin-muted)', cursor: 'pointer', userSelect: 'none', paddingBottom: 8 }}>
            <input type="checkbox" checked={includeProbation} onChange={e => setIncludeProbation(e.target.checked)} /> Gồm cả thử việc
          </label>
          <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={load} disabled={loading}>{loading ? <Loader2 size={13} className="fin-spin" /> : <RefreshCw size={13} />} Tải lại</button>
        </div>
      </div>

      {/* Bảng NV — nhập đơn giá riêng từng người */}
      <div className="fin-card">
        <div className="fin-card-head">
          <div>
            <div className="fin-card-title"><Users size={14} color="#E85D92" /> Danh sách nhân viên <span style={{ fontWeight: 600, color: 'var(--fin-muted)' }}>({periodLabel(month)})</span></div>
            <div className="fin-card-sub">Chỉ nhập đơn giá MỚI ở những NV cần điều chỉnh — bỏ trống = giữ nguyên. Đơn giá cũ được giữ nguyên trong lịch sử, không ghi đè.</div>
          </div>
          <div className="fin-chips">
            <button type="button" className="fin-pill" onClick={() => toggleAll(true)}>Chọn hết dòng có giá mới</button>
            <button type="button" className="fin-pill" onClick={() => toggleAll(false)}>Bỏ chọn hết</button>
          </div>
        </div>
        {loading ? (
          <div className="fin-empty">Đang tải danh sách…</div>
        ) : (
          <div className="fin-table-wrap" style={{ maxHeight: '52vh' }}>
            <table className="fin-table" style={{ minWidth: 1060 }}>
              <thead>
                <tr><th className="ctr" style={{ width: 44 }}>Chọn</th><th>Mã NV</th><th>Họ tên</th><th>Giai đoạn</th><th className="num">Đơn giá hiện tại</th><th className="num" style={{ minWidth: 150 }}>Đơn giá MỚI (đ/giờ)</th><th className="num">Chênh lệch</th><th className="ctr">Lịch sử</th></tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <React.Fragment key={g.id}>
                    <tr className="fin-band"><td colSpan={8}><Building2 size={12} style={{ verticalAlign: -1, marginRight: 6 }} />{branchLabelOf(g.id)}<span className="fin-band-count">{g.rows.length} NV</span></td></tr>
                    {g.rows.map((r: any) => {
                      const raw = String(newRates[r.employeeId] ?? '');
                      const v = Number(raw);
                      const isValid = raw.trim() !== '' && Number.isFinite(v) && v >= 1000 && v <= 1_000_000 && Math.round(v) !== r.currentRate;
                      const delta = isValid ? Math.round(v) - r.currentRate : 0;
                      const isChecked = !!checked[r.employeeId];
                      return (
                        <tr key={r.employeeId} style={isChecked ? { background: '#fff7fb' } : undefined}>
                          <td className="ctr"><input type="checkbox" checked={isChecked} onChange={e => setChecked(prev => ({ ...prev, [r.employeeId]: e.target.checked }))} aria-label={`Chọn ${r.fullName}`} /></td>
                          <td className="ctr fin-mono">{r.employeeCode}</td>
                          <td style={{ fontWeight: 700 }}>{r.fullName}</td>
                          <td><span className="fin-sign" style={r.stage === 'OFFICIAL' ? { background: '#eff6ff', color: '#1d4ed8' } : { background: '#fff7ed', color: '#92400e' }}>{r.stage === 'OFFICIAL' ? 'CHÍNH THỨC' : 'THỬ VIỆC'}</span></td>
                          <td className="num fin-money" style={{ fontWeight: 700 }}>{r.currentRate.toLocaleString('vi-VN')} đ</td>
                          <td className="num">
                            <input type="number" className="fin-input" style={{ textAlign: 'right', fontWeight: 800, borderColor: isChecked ? '#f9a8d4' : undefined, background: isChecked ? '#fff' : undefined }}
                              min={1000} step={500} placeholder={String(r.currentRate)} value={raw}
                              onChange={e => setRate(r, e.target.value)} aria-label={`Đơn giá mới của ${r.fullName}`} />
                          </td>
                          <td className="num fin-money" style={{ color: delta > 0 ? 'var(--fin-green)' : delta < 0 ? 'var(--fin-red)' : 'inherit', fontWeight: delta !== 0 ? 800 : 400 }}>{delta !== 0 ? `${delta > 0 ? '+' : ''}${delta.toLocaleString('vi-VN')}` : '—'}</td>
                          <td className="ctr"><button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={() => openHistory(r)} title="Xem lịch sử đơn giá"><History size={13} /></button></td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
                {groups.length === 0 && <tr><td colSpan={8} className="fin-empty">{debouncedQ ? 'Không tìm thấy nhân viên phù hợp.' : 'Chưa có nhân viên.'}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Áp dụng & lý do */}
      <div className="fin-card">
        <div className="fin-card-head"><div className="fin-card-title"><Banknote size={14} color="#E85D92" /> Áp dụng điều chỉnh</div></div>
        <div style={{ padding: '14px 16px', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 340px' }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: 'var(--fin-muted)', textTransform: 'uppercase' }}>Lý do * (bắt buộc)</span>
            <input className="fin-input" value={reason} onChange={e => setReason(e.target.value)} placeholder="VD: Nâng lương định kỳ 11/2026 cho CN1–CN4…" maxLength={300} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none', cursor: 'pointer', paddingBottom: 9, fontSize: 12.5, fontWeight: 800, color: applyPast ? '#92400e' : 'var(--fin-muted)' }}>
            <input type="checkbox" checked={applyPast} onChange={e => setApplyPast(e.target.checked)} />
            <span>Áp dụng cho THÁNG CŨ<br /><span style={{ fontSize: 9, fontWeight: 600, color: '#a16207' }}>(chỉ kỳ mọi phiếu đều DRAFT — kỳ đã ký/đã chi trả sẽ BỎ QUA)</span></span>
          </label>
          {applyPast && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: 'var(--fin-muted)', textTransform: 'uppercase' }}>Hồi tố từ kỳ</span>
              <select className="fin-input" style={{ minWidth: 170 }} value={pastFromPeriod} onChange={e => setPastFromPeriod(e.target.value)}>
                {monthOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )}
          <button type="button" className="fin-btn fin-btn-dark" onClick={doPreview} disabled={!canPreview || previewBusy} title={canPreview ? '' : 'Cần ≥ 1 NV hợp lệ + lý do'}>
            {previewBusy ? <Loader2 size={14} className="fin-spin" /> : <ShieldCheck size={14} />} Xem trước & áp dụng
          </button>
        </div>
        <div style={{ padding: '0 16px 12px', fontSize: 10.5, color: 'var(--fin-muted)', display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <span>Đang chọn: <b style={{ color: 'var(--fin-ink)' }}>{validChanges.length} NV</b></span>
          <span>Tổng chênh lệch đơn giá: <b style={{ color: totalDelta >= 0 ? 'var(--fin-green)' : 'var(--fin-red)' }}>{totalDelta >= 0 ? '+' : ''}{totalDelta.toLocaleString('vi-VN')} đ/giờ</b></span>
          <span style={{ fontStyle: 'italic' }}>Phiếu đã ký/PAID không bao giờ bị đổi số tiền.</span>
        </div>
      </div>

      {/* ═══ Preview modal ═══ */}
      {preview && (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(15,23,42,.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 12px', overflowY: 'auto' }} onClick={() => setPreview(null)}>
          <div className="fin-card" style={{ maxWidth: 980, width: '100%' }} onClick={e => e.stopPropagation()}>
            <div className="fin-card-head">
              <div className="fin-card-title"><ShieldCheck size={15} color="#059669" /> Xác nhận áp dụng — {preview.totals?.count ?? 0} nhân viên</div>
              <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={() => setPreview(null)}><X size={14} /></button>
            </div>
            <div style={{ maxHeight: '56vh', overflowY: 'auto' }}>
              <table className="fin-table">
                <thead><tr><th>Mã NV</th><th>Họ tên</th><th>CN</th><th className="num">Cũ</th><th className="num">Mới</th><th className="num">Chênh</th></tr></thead>
                <tbody>
                  {(preview.rows || []).filter((r: any) => r.ok).map((r: any) => (
                    <tr key={r.employeeId}>
                      <td className="fin-mono">{r.employeeCode}</td>
                      <td style={{ fontWeight: 700 }}>{r.fullName}</td>
                      <td>{branchLabelOf(r.branchId)}</td>
                      <td className="num fin-money">{Number(r.oldRate).toLocaleString('vi-VN')}</td>
                      <td className="num fin-money" style={{ fontWeight: 800 }}>{Number(r.newRate).toLocaleString('vi-VN')}</td>
                      <td className="num fin-money" style={{ color: r.deltaRate >= 0 ? 'var(--fin-green)' : 'var(--fin-red)', fontWeight: 800 }}>{r.deltaRate >= 0 ? '+' : ''}{Number(r.deltaRate).toLocaleString('vi-VN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.applyPast && (
                <div style={{ padding: '12px 16px' }}>
                  <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: 'var(--fin-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Các kỳ được xét hồi tố</div>
                  <table className="fin-table">
                    <thead><tr><th>Kỳ</th><th className="num">Phiếu</th><th className="num">Draft</th><th className="num">NV đã ký</th><th className="num">Đã CK</th><th>Hành động</th></tr></thead>
                    <tbody>
                      {(preview.periods || []).map((p: any) => (
                        <tr key={p.period}>
                          <td style={{ fontWeight: 800 }}>{periodLabel(p.period)}</td>
                          <td className="num">{p.slips}</td>
                          <td className="num">{p.draft}</td>
                          <td className="num">{p.confirmed}</td>
                          <td className="num">{p.paid}</td>
                          <td>{p.action === 'recalc'
                            ? <span style={{ color: 'var(--fin-green)', fontWeight: 800, fontSize: 11 }}><Check size={11} style={{ verticalAlign: -1 }} /> Sẽ TÍNH LẠI (phiếu chưa ký)</span>
                            : <span style={{ color: 'var(--fin-red)', fontWeight: 800, fontSize: 11 }}><Lock size={11} style={{ verticalAlign: -1 }} /> BỎ QUA — đã có phiếu ký/CK</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, color: 'var(--fin-muted)' }}>
                Ước tính chênh lệch quỹ lương: <b className="fin-money" style={{ color: (estMoney ?? 0) >= 0 ? 'var(--fin-green)' : 'var(--fin-red)', fontSize: 13 }}>{estMoney == null ? '—' : `${(estMoney ?? 0) >= 0 ? '+' : ''}${Number(estMoney).toLocaleString('vi-VN')} đ`}</b>
                <div style={{ fontSize: 9.5, marginTop: 2 }}>Hiệu lực: {effectiveFrom} · Lý do: {reason.trim()}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="fin-btn fin-btn-ghost" onClick={() => setPreview(null)}>Quay lại</button>
                <button type="button" className="fin-btn fin-btn-primary" onClick={doCommit} disabled={commitBusy}>{commitBusy ? <Loader2 size={14} className="fin-spin" /> : <Check size={14} />} XÁC NHẬN ÁP DỤNG</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Commit result modal ═══ */}
      {commitResult && (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(15,23,42,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setCommitResult(null)}>
          <div className="fin-card" style={{ maxWidth: 640, width: '100%' }} onClick={e => e.stopPropagation()}>
            <div className="fin-card-head">
              <div className="fin-card-title"><Check size={15} color="#059669" /> Đã áp dụng cho {commitResult?.applied?.length ?? 0} nhân viên</div>
              <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={() => setCommitResult(null)}><X size={14} /></button>
            </div>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--fin-muted)', lineHeight: 1.6 }}>
                Đơn giá mới có hiệu lực từ <b>{effectiveFrom}</b>. Payroll engine sẽ lấy đúng đơn giá theo từng ngày công khi tính lương.
                {commitResult?.periods?.length > 0 && <> Các kỳ hồi tố đã được xử lý:</>}
              </div>
              {(commitResult?.periods || []).length > 0 && (
                <table className="fin-table">
                  <thead><tr><th>Kỳ</th><th>Kết quả</th></tr></thead>
                  <tbody>
                    {commitResult.periods.map((p: any) => (
                      <tr key={p.period}>
                        <td style={{ fontWeight: 800 }}>{periodLabel(p.period)}</td>
                        <td>{p.action === 'recalculated'
                          ? <span style={{ color: 'var(--fin-green)', fontWeight: 800 }}><Check size={12} style={{ verticalAlign: -2 }} /> Đã tính lại kỳ (phiếu MỚI, chưa ký)</span>
                          : p.action === 'skip_locked'
                            ? <span style={{ color: 'var(--fin-red)', fontWeight: 800 }}><Lock size={12} style={{ verticalAlign: -2 }} /> Bỏ qua — phiếu đã ký/PAID</span>
                            : <span style={{ color: 'var(--fin-red)' }}>Lỗi: {p.error || p.action}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div style={{ fontSize: 10.5, color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, padding: '10px 12px', lineHeight: 1.6 }}>
                <Info size={12} style={{ verticalAlign: -1, marginRight: 6 }} />
                Kỳ được tính lại sẽ có <b>phiếu MỚI ở trạng thái DRAFT</b> — kế toán kiểm tra lại rồi thực hiện Ký → Gửi NV → … như bình thường. Phiếu cũ đã ký/PAID được giữ nguyên, không đổi số tiền.
              </div>
              <button type="button" className="fin-btn fin-btn-primary" onClick={() => setCommitResult(null)} style={{ alignSelf: 'flex-end' }}><Check size={14} /> Đã hiểu</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ History drawer/modal ═══ */}
      {historyFor && (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(15,23,42,.5)', display: 'flex', justifyContent: 'flex-end' }} onClick={() => setHistoryFor(null)}>
          <div style={{ width: 'min(560px, 100vw)', height: '100%', background: '#fff', boxShadow: '-8px 0 32px rgba(15,23,42,.25)', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div className="fin-card-head" style={{ position: 'sticky', top: 0, background: '#fff', borderBottom: '1px solid #f1f5f9' }}>
              <div className="fin-card-title"><History size={14} color="#E85D92" /> Lịch sử đơn giá — {historyFor.fullName}</div>
              <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={() => setHistoryFor(null)}><X size={14} /></button>
            </div>
            <div style={{ overflowY: 'auto', padding: '12px 16px', flex: 1 }}>
              {historyLoading ? <div className="fin-empty">Đang tải…</div> : historyRows.length === 0 ? (
                <div className="fin-empty">Chưa có lần điều chỉnh nào qua chức năng này.</div>
              ) : historyRows.map((h: any, i: number) => (
                <div key={i} style={{ border: '1px solid #f1f5f9', borderRadius: 12, padding: '10px 12px', marginBottom: 8, background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                    <div style={{ fontWeight: 800, color: 'var(--fin-ink)' }}>{Number(h.rate_per_hour || 0).toLocaleString('vi-VN')} đ/giờ</div>
                    <div style={{ fontSize: 10, color: 'var(--fin-muted)' }}>Hiệu lực từ {String(h.effective_from || '').slice(0, 10)}</div>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--fin-muted)', marginTop: 4, lineHeight: 1.5 }}>{String(h.note || '').replace('[RATE_ADJUST]', '').trim() || 'Điều chỉnh đơn giá'}</div>
                  <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 4 }}>Bởi: {h.approved_by || '—'} · {h.created_at ? new Date(h.created_at).toLocaleString('vi-VN') : ''}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
