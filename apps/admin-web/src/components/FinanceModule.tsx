/**
 * FINANCE MODULE — Cổng Kế toán tính lương (UMB HR V5.1)
 * Layout theo quy trình 7 bước, khóa tab, realtime, đồng bộ Drive, ký phiếu 3 bên, thanh toán.
 */
// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DollarSign, FileSpreadsheet, Calendar, CreditCard, CheckCircle,
  PenTool, QrCode, FileText, Users, Bell, Loader2, RefreshCw,
  Upload, Download, Printer, ShieldAlert, ArrowRight, Eye, Copy,
  AlertCircle, Plus, Save, User, LayoutDashboard, List, Activity,
  Send, Check, X, ChevronDown, Folder, HardDrive, ShieldCheck, Lock,
  Clock,
} from 'lucide-react';
import { apiRequest, getApiBase } from '../services/api.js';
import {
  payslipStage, PAYSLIP_STAGE_LABEL,
  monthShortFolder, periodLabel, parsePeriod,
  branchDriveFolder, employeeDriveFolder, payslipDriveFileName,
} from '@ubm/shared';
import { SalaryConfigView } from './SalaryConfigView.js';
import { OfficeApprovalsView } from './OfficeApprovalsView.js';
import { formatVND } from '../utils/FinanceFormat';

const BRANCH_LABEL: Record<string, string> = {
  CN130: 'CN1 — 130 Vạn Kiếp', CN261: 'CN2 — 261 Tô Hiến Thành',
  CN120: 'CN3 — 120 Hoàng Diệu 2', CN111: 'CN4 — 111 Tôn Đản',
  XUONG_SX: 'Xưởng Sản Xuất (Củ Chi)', VAN_PHONG: 'Văn Phòng Trụ Sở',
};
const branchLabelOf = (id?: string | null) => BRANCH_LABEL[String(id || '').trim()] || String(id || '—');
const MONTH_KEY = 'ubm_fin_month';
const defaultMonth = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 7);

const STAGE_COLOR: Record<string, { bg: string; fg: string; border: string }> = {
  DRAFT: { bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1' },
  CHO_GD_DUYET: { bg: '#FEF3C7', fg: '#92400E', border: '#FCD34D' },
  CHO_GUI_NV: { bg: '#E0E7FF', fg: '#3730A3', border: '#BFDBFE' },
  CHO_NV_KY: { bg: '#FFEDD5', fg: '#9A3412', border: '#FDBA74' },
  CHO_CHUYEN_KHOAN: { bg: '#FEF9C3', fg: '#854D0E', border: '#FDE047' },
  PAID: { bg: '#DCFCE7', fg: '#166534', border: '#86EFAC' },
};

const TAB_ORDER: Array<{ id: string; label: string; step: number }> = [
  { id: 'fin-dashboard', label: '1. Dashboard Tài Chính', step: 0 },
  { id: 'fin-timesheet', label: '2. Đối Soát Công & Bảng Chấm Công', step: 1 },
  { id: 'fin-bcc', label: '3. BCC — Bảng Công Từng Ngày', step: 2 },
  { id: 'fin-calculate', label: '4. Tính Lương (Công Thức & Nhập Tay)', step: 3 },
  { id: 'fin-payroll-sheet', label: '5. Payment — Bảng Lương Tháng', step: 4 },
  { id: 'fin-payroll-periods', label: '6. Kỳ Lương (DRAFT → PAID)', step: 5 },
  { id: 'fin-payslips', label: '7. Phiếu Lương (KT ký → GĐ → NV ký)', step: 6 },
  { id: 'fin-payment', label: '8. Thanh Toán (VietQR — Đã Chuyển Khoản)', step: 7 },
  { id: 'fin-signatures', label: '9. Chữ Ký Mẫu', step: 8 },
  { id: 'fin-bank-qr', label: '10. QR Ngân Hàng NV', step: 8 },
  { id: 'bank-changes', label: '11. Duyệt Đổi STK', step: 8 },
  { id: 'office-approvals', label: '12. Duyệt Văn Phòng', step: 8 },
  { id: 'fin-salary-config', label: '13. Cấu Hình Lương CB & Phụ Cấp', step: 8 },
];

const btn = (active: boolean, busy = false, danger?: boolean) => ({
  display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px',
  borderRadius: '8px', fontSize: '12.5px', fontWeight: 700, border: 'none',
  cursor: busy || danger ? 'not-allowed' : 'pointer', disabled: busy || danger,
  backgroundColor: busy ? '#E2E8F0' : (danger ? '#FEE2E2' : (active ? '#E85D92' : '#FFFFFF')),
  color: busy ? '#94A3B8' : (danger ? '#B91C1C' : (active ? '#FFFFFF' : '#273142')),
  border: `1px solid ${busy ? '#CBD5E1' : (danger ? '#FCA5A5' : 'var(--border)')}`,
});

export interface FinanceModuleProps {
  activeTab: string; currentUser: any; allEmployees: any; shifts: any;
  payrollRuns: any; branches: any; salaryConfigs: any;
  systemNotifications: any; showToast: (msg: string) => void;
  onRefreshData?: () => void | Promise<void>; onSyncSheets?: () => void | Promise<void>; onPushSheets?: () => void | Promise<void>;
}

export default function FinanceModule(props: FinanceModuleProps) {
  const {
    activeTab, currentUser, allEmployees, shifts, payrollRuns, branches,
    salaryConfigs, showToast, onRefreshData, onPushSheets,
  } = props;
  const [month, setMonth] = useState<string>(() => {
    const saved = localStorage.getItem(MONTH_KEY);
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(saved || '')) return saved || '';
    return defaultMonth();
  });
  useEffect(() => { localStorage.setItem(MONTH_KEY, month); }, [month]);

  const [workflow, setWorkflow] = useState<any>(null);
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [driveConfigured, setDriveConfigured] = useState(false);
  const [slips, setSlips] = useState<any[]>([]);
  const [slipsLoading, setSlipsLoading] = useState(false);
  const [runs, setRuns] = useState<any[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [formula, setFormula] = useState<any>(null);
  const [inputs, setInputs] = useState<any[]>([]);
  const [inputsLoading, setInputsLoading] = useState(false);
  const [finSheet, setFinSheet] = useState<any>(null);
  const [finSheetLoading, setFinSheetLoading] = useState(false);
  const [finSheetSync, setFinSheetSync] = useState<any>(null);

  const mountedRef = useRef(true);
  const api = useCallback((path: string, opts?: RequestInit) => apiRequest(path, opts), []);
  const post = useCallback((path: string, body: any) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }), [api]);
  const put = useCallback((path: string, body: any) => api(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }), [api]);

  // Fix ReferenceError: Cannot access 'Bt' before initialization (TDZ):
  // Loaders MUST be declared BEFORE refreshCurrentTab / handleRealtime that
  // list them in their useCallback dependency arrays. Previously loaders were
  // defined after refreshCurrentTab, so evaluating the deps array at render
  // touched uninitialized const bindings and crashed the Finance module.
  const loadWorkflow = useCallback(async () => { try { setWorkflow(await api(`/payroll/workflow-status?period=${encodeURIComponent(month)}`)); } catch { setWorkflow(null); } }, [api, month]);
  const loadRuns = useCallback(async () => { try { setRuns(await api('/payroll/runs')); } catch { setRuns([]); } }, [api]);
  const loadSlips = useCallback(async () => { setSlipsLoading(true); try { const d = await api(`/payroll/period-slips/${encodeURIComponent(month)}`); setSlips((d as any)?.slips || []); } catch { setSlips([]); } finally { setSlipsLoading(false); } }, [api, month]);
  const loadFinSheet = useCallback(async () => { setFinSheetLoading(true); try { const fs = await api(`/admin/reports/finance-timesheet?period=${encodeURIComponent(month)}&branchScope=*`); setFinSheet(fs); if (activeTab === 'fin-dashboard') { try { setFinSheetSync(await api('/payroll/sync-status')); } catch { setFinSheetSync(null); } } } catch { setFinSheet(null); } finally { setFinSheetLoading(false); } }, [api, activeTab, month]);
  const loadFormula = useCallback(async () => { try { setFormula(await api(`/payroll/formula/${encodeURIComponent(month)}`)); } catch { setFormula(null); } }, [api, month]);
  const loadInputs = useCallback(async () => { setInputsLoading(true); try { setInputs(await api(`/payroll/inputs/${encodeURIComponent(month)}`)); } catch { setInputs([]); } finally { setInputsLoading(false); } }, [api, month]);
  const loadDriveStatus = useCallback(async () => { try { const st = await api(`/payroll/drive-sync/status?period=${encodeURIComponent(month)}`); setSyncStatus(st); setDriveConfigured(!!st?.configured); } catch { setDriveConfigured(false); } }, [api, month]);

  const refreshCurrentTab = useCallback(() => {
    loadWorkflow();
    onRefreshData?.();
    if (['fin-timesheet', 'fin-bcc', 'fin-dashboard', 'fin-calculate', 'fin-payroll-sheet'].includes(activeTab)) loadFinSheet();
    if (['fin-payslips', 'fin-payment', 'fin-payroll-periods', 'fin-signatures'].includes(activeTab)) loadSlips();
    if (['fin-payroll-periods', 'fin-dashboard'].includes(activeTab)) loadRuns();
    if (activeTab === 'fin-calculate') { loadFormula(); loadInputs(); }
    if (activeTab === 'fin-payment') loadSlips();
  }, [activeTab, loadWorkflow, onRefreshData, loadFinSheet, loadSlips, loadRuns, loadFormula, loadInputs]);

  const handleRealtime = useCallback((evt: CustomEvent) => {
    const ent = (evt.detail as any)?.entity;
    if (!ent) return;
    const want = ent === 'payroll' || ent === 'payslips' || ent === 'all';
    const att = ent === 'attendance' || ent === 'shift' || ent === 'swap' || ent === 'leave' || ent === 'all';
    const needTimesheet = ['fin-timesheet', 'fin-bcc', 'fin-dashboard', 'fin-calculate', 'fin-payroll-sheet'].includes(activeTab);
    const needPayslip = ['fin-payslips', 'fin-payment', 'fin-payroll-periods', 'fin-signatures'].includes(activeTab);
    if ((want && needPayslip) || (att && needTimesheet)) {
      refreshCurrentTab();
    }
  }, [activeTab, refreshCurrentTab]);

  useEffect(() => {
    window.addEventListener('ubm:fin-timesheet-reload', handleRealtime as any);
    window.addEventListener('ubm:payslips-reload', handleRealtime as any);
    window.addEventListener('data:updated', handleRealtime as any);
    return () => { mountedRef.current = false; window.removeEventListener('ubm:fin-timesheet-reload', handleRealtime as any); window.removeEventListener('ubm:payslips-reload', handleRealtime as any); window.removeEventListener('data:updated', handleRealtime as any); };
  }, [handleRealtime]);

  useEffect(() => {
    loadWorkflow();
    switch (activeTab) {
      case 'fin-dashboard': loadFinSheet(); loadRuns(); break;
      case 'fin-timesheet': case 'fin-bcc': case 'fin-calculate': case 'fin-payroll-sheet': loadFinSheet(); if (activeTab === 'fin-calculate') { loadFormula(); loadInputs(); } break;
      case 'fin-payroll-periods': loadRuns(); break;
      case 'fin-payslips': case 'fin-payment': case 'fin-signatures': loadSlips(); break;
    }
    if (activeTab === 'fin-payment' || activeTab === 'fin-payslips') loadDriveStatus();
  }, [activeTab, month, loadWorkflow, loadFinSheet, loadRuns, loadSlips, loadFormula, loadInputs, loadDriveStatus]);

  const tabLocked = useMemo(() => {
    if (!workflow) return new Map<string, { locked: boolean; reason: string; stat: string }>();
    const m = new Map<string, { locked: boolean; reason: string; stat: string }>();
    for (const s of workflow.steps) {
      const idx = workflow.steps.indexOf(s);
      const prev = idx > 0 ? workflow.steps[idx - 1] : null;
      m.set(s.id, { locked: !!(prev && !prev.done), reason: prev && !prev.done ? prev.reason : '', stat: s.stat });
    }
    return m;
  }, [workflow]);

  const isTabOpen = (id: string) => { const l = tabLocked.get(id); return !l ? true : !l.locked; };
  const stageBadge = (stage?: string | null) => { const c = (STAGE_COLOR as any)[String(stage || 'DRAFT')]; return { ...c, label: (PAYSLIP_STAGE_LABEL as any)[String(stage || 'DRAFT')] || '—' }; };
  const stripAccents = (s: unknown) => String(s ?? '').replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const vietQrSlug = (bankName?: string | null) => {
    const s = String(bankName || '').trim().toLowerCase();
    if (s.includes('vietcom') || s === 'vcb') return 'vietcombank';
    if (s.includes('techcom') || s === 'tcb') return 'techcombank';
    if (s.includes('sacom') || s.includes('stb')) return 'sacombank';
    if (s.includes('mb') || s.includes('quan doi')) return 'mbbank';
    if (s.includes('bidv')) return 'bidv';
    if (s.includes('vietin') || s === 'ctg') return 'vietinbank';
    if (s.includes('acb') || s.includes('a chau')) return 'acb';
    if (s.includes('vpbank') || s.includes('vp')) return 'vpbank';
    if (s.includes('tpbank') || s.includes('tp') || s.includes('tien phong')) return 'tpbank';
    if (s.includes('hdbank') || s.includes('hdb')) return 'hdbank';
    if (s.includes('vib')) return 'vib';
    if (s.includes('shb')) return 'shb';
    if (s.includes('ocb')) return 'ocb';
    if (s.includes('msb') || s.includes('hang hai')) return 'msb';
    if (s.includes('agribank') || s.includes('nong nghiep')) return 'agribank';
    return stripAccents(s).toLowerCase().replace(/[^a-z0-9]/g, '') || 'vietcombank';
  };
  const slipQrUrl = (s: any) => {
    const acct = String(s?.bank_account || '').trim();
    if (!acct) return null;
    const amt = Math.max(0, Math.round(Number(s?.thuc_lanh ?? s?.net_pay) || 0));
    const info = `LUONG ${s?.period || ''} ${s?.employee_code || ''}`.slice(0, 50);
    const holder = String(s?.bank_holder || s?.full_name || '').slice(0, 50);
    return `https://img.vietqr.io/image/${vietQrSlug(s?.bank_name)}-${encodeURIComponent(acct)}-compact2.png?amount=${amt}&addInfo=${encodeURIComponent(info)}&accountName=${encodeURIComponent(holder)}`;
  };

  const fastSignLap = useCallback(async (itemId: string) => { try { await post(`/payroll/slips/${encodeURIComponent(itemId)}/fast-sign`, { lapName: 'Kế toán viên', lapImg: '', qlName: '', qlImg: '' }); showToast(`Đã ký lập phiếu ${itemId.replace('SLIP_', '')}`); refreshCurrentTab(); } catch (e: any) { showToast(e?.message || 'Ký lập thất bại'); } }, [post, showToast, refreshCurrentTab]);
  const publishSlip = useCallback(async (itemId: string) => { if (!window.confirm('Gửi phiếu này đến nhân viên? Sau khi gửi, nhân viên có thể ký xác nhận.')) return; try { await post(`/payroll/slips/${encodeURIComponent(itemId)}/publish`, {}); showToast('Đã gửi phiếu lương đến nhân viên'); refreshCurrentTab(); } catch (e: any) { showToast(e?.message || 'Gửi thất bại'); } }, [post, showToast, refreshCurrentTab]);
  const markPaidSlip = useCallback(async (itemId: string) => { if (!window.confirm('Xác nhận ĐÃ CHUYỂN KHOẢN? Phiếu sẽ bị KHÓA và đồng bộ PDF lên Google Drive.')) return; try { await post(`/payroll/slips/${encodeURIComponent(itemId)}/mark-paid`, {}); showToast('Đã chuyển khoản — phiếu khóa & đồng bộ Drive'); refreshCurrentTab(); } catch (e: any) { showToast(e?.message || 'Thanh toán thất bại'); } }, [post, showToast, refreshCurrentTab]);
  const syncMonthDrive = useCallback(async () => { if (!driveConfigured) { showToast('Google Drive chưa cấu hình trên server.'); return; } try { setTimeout(() => {}, 0); const r = await post('/payroll/drive-sync', { period: month }); showToast(r?.ok ? `Đồng bộ xong: ${r?.slips?.pdfSynced ?? 0}/${r?.slips?.paid ?? 0} phiếu PDF` : 'Hoàn tất (có lỗi)'); await loadDriveStatus(); refreshCurrentTab(); } catch (e: any) { showToast('Lỗi Drive: ' + (e?.message || '')); } }, [post, driveConfigured, month, showToast, loadDriveStatus, refreshCurrentTab]);
  const syncSlipDrive = useCallback(async (itemId: string) => { try { const r = await post(`/payroll/slips/${encodeURIComponent(itemId)}/drive-sync`, {}); showToast(r?.ok ? 'Đã đồng bộ PDF phiếu lên Drive' : 'Lỗi: ' + (r?.error || '')); refreshCurrentTab(); } catch (e: any) { showToast('Lỗi: ' + (e?.message || '')); } }, [post, showToast, refreshCurrentTab]);
  const saveFormula = useCallback(async () => { try { await put(`/payroll/formula/${encodeURIComponent(month)}`, { rateTV: Number(formula?.rateTV) || 21000, rateCT: Number(formula?.rateCT) || 25500, otPerSlot: 0, otThreshold1: 10, otThreshold2: 15 }); showToast('Đã lưu công thức lương'); loadFormula(); } catch (e: any) { showToast(e?.message || 'Lưu công thức thất bại'); } }, [put, month, formula, showToast, loadFormula]);
  const upsertInput = useCallback(async (employeeId: string, field: string, value: string) => { const n = Number(value); const existing = inputs.find(i => i.employee_id === employeeId); const payload: any = { period: month, employee_id: employee_id, luong_cb: 0, ot_extra: 0, bonus_extra: 0, ung_luong: 0, tru_kpi: 0, dong_phuc: 0, note: '' }; if (existing) Object.assign(payload, existing); payload[field] = isNaN(n) ? 0 : n; try { await put(`/payroll/inputs/${encodeURIComponent(month)}`, payload); setInputs(inputs.map(i => i.employee_id === employeeId ? { ...i, [field]: payload[field], note: payload.note } : i)); if (!existing) setInputs([...inputs, { ...payload, employee_id }]); } catch (e: any) { showToast(e?.message || 'Lưu nhập tay thất bại'); } }, [put, month, inputs, showToast]);
  const saveAllInputs = useCallback(async () => { try { for (const i of inputs) { await put(`/payroll/inputs/${encodeURIComponent(month)}`, { ...i, period: month }); } showToast('Đã lưu tất cả nhập tay'); } catch (e: any) { showToast(e?.message || 'Lưu thất bại'); } }, [put, month, inputs, showToast]);

  const open = isTabOpen(activeTab);
  const lockReason = tabLocked.get(activeTab)?.reason || '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minHeight: '100vh' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#E85D92', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>$</div>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 800, letterSpacing: '-0.5px' }}>Cổng Kế toán — Tính lương</div>
              <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Tài khoản: {currentUser?.fullName || 'Kế toán'}  •  Vai trò: {currentUser?.role}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', color: '#E85D92' }}>REALTIME</span>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981', boxShadow: '0 0 0 2px rgba(16,185,129,0.25)' }} />
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Socket.IO — tự cập nhật khi có sự kiện mới</span>
          </div>
        </div>
        <div style={{ background: '#FDF7F2', border: '1.5px solid #FCD34D', borderRadius: '10px', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', fontWeight: 800, color: '#9A3412', textTransform: 'uppercase', letterSpacing: '1px' }}>Tháng đang xử lý</span>
          <select value={month} onChange={e => setMonth(e.target.value)} style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--border)', background: '#fff', fontSize: '13px', fontWeight: 700, color: '#E85D92', minWidth: '130px' }}>
            {[...Array(12)].map((_, i) => { const m = String(i + 1).padStart(2, '0'); const y = new Date(Date.now() + 7 * 3_600_000).getFullYear(); const val = `${y}-${m}`; return <option key={val} value={val}>{`Tháng ${m}/${y}`}</option>; })}
            {['2026-11', '2026-12', '2027-01', '2027-02'].map(v => <option key={v} value={v}>{periodLabel(v)}</option>)}
          </select>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>• Dữ liệu chỉ hiển thị tháng này. Tháng khác không bị ảnh hưởng.</span>
          <button onClick={onRefreshData} style={btn(false)} title="Tải lại dữ liệu tháng hiện tại"><RefreshCw size={14} style={{ marginRight: '4px' }} /> Tải lại</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', fontWeight: 800, color: driveConfigured ? '#166534' : '#B91C1C', textTransform: 'uppercase', letterSpacing: '1px' }}>{driveConfigured ? 'DRIVE: SẴN SÀNG' : 'DRIVE: CHƯA CẤU HÌNH'}</span>
          {syncStatus && (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Cuối: {syncStatus?.last?.at ? new Date(syncStatus.last.at).toLocaleString('vi-VN') : '—'}  •
              {syncStatus?.last?.ok ? 'OK' : 'CHƯA'}  • {syncStatus?.rootId ? `Root: ${String(syncStatus.rootId).slice(0, 10)}…` : '—'}
            </div>
          )}
          <button onClick={syncMonthDrive} disabled={!driveConfigured} style={btn(false, !driveConfigured)} title="Tự tạo cây folder tháng & xuất file lên Drive"><Upload size={14} style={{ marginRight: '4px' }} /> Đồng bộ tháng lên Drive</button>
          <span style={{ fontSize: '11.5px', color: '#94A3B8' }}>PHIEU_LUONG → THANG_10 → CN → TÊN NV → PDF</span>
        </div>
      </div>

      <div style={{ background: '#FFFFFF', border: '1px solid var(--border)', borderRadius: '12px', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '6px', overflowX: 'auto' }}>
        {TAB_ORDER.map((t, i) => {
          const l = tabLocked.get(t.id);
          const locked = !l ? false : l.locked;
          const done = l ? (!!workflow?.steps.find(s => s.id === t.id)?.done) : false;
          const cur = activeTab === t.id;
          const color = locked ? '#CBD5E1' : (done ? '#10B981' : cur ? '#E85D92' : '#6B7280');
          return (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              {i > 0 && <ArrowRight size={13} style={{ color: locked ? '#E2E8F0' : '#9CA3AF' }} />}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '92px', opacity: locked ? 0.55 : 1 }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: locked ? '#F1F5F9' : color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '12px', border: cur ? '2px solid #E85D92' : 'none', boxShadow: cur ? '0 0 0 3px rgba(232,93,146,0.2)' : 'none' }}>{t.step === 0 ? '1' : t.step}</div>
                <div style={{ fontSize: '9.5px', fontWeight: 700, color: locked ? '#9CA3AF' : '#273142', textAlign: 'center', lineHeight: 1.25, marginTop: '4px', width: '86px' }}>{t.label.split(' ').slice(1).join(' ')}</div>
                {locked && l && <div style={{ fontSize: '7.5px', color: '#EF4444', marginTop: '2px', whiteSpace: 'nowrap', maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.reason}</div>}
                {!locked && !done && l && <div style={{ fontSize: '7.5px', color: '#65A30D', marginTop: '2px' }}>{l.stat}</div>}
                {done && <div style={{ fontSize: '7.5px', color: '#10B981', marginTop: '2px' }}>✓ Hoàn tất</div>}
              </div>
            </div>
          );
        })}
      </div>

      {!open && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '10px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <ShieldAlert size={18} style={{ color: '#B91C1C' }} />
          <div style={{ fontSize: '13px', color: '#B91C1C', fontWeight: 700 }}>Tab đã khóa theo quy trình kế toán</div>
          <div style={{ fontSize: '12px', color: '#7F1D1D', marginLeft: '8px', flex: 1 }}>{lockReason}</div>
        </div>
      )}
      <div style={{ flex: 1, padding: '0 4px', overflowY: 'auto' }}>
        {activeTab === 'fin-dashboard' && <DashboardTab month={month} finSheet={finSheet} finSheetLoading={finSheetLoading} slips={slips} workflow={workflow} loadFinSheet={loadFinSheet} loadRuns={loadRuns} periodLabel={periodLabel} formatVND={formatVND} />}
        {activeTab === 'fin-timesheet' && <TimesheetTab month={month} finSheet={finSheet} finSheetLoading={finSheetLoading} loadFinSheet={loadFinSheet} branchLabelOf={branchLabelOf} formatVND={formatVND} periodLabel={periodLabel} />}
        {activeTab === 'fin-bcc' && <div style={{ padding: '16px' }}><div style={{ fontSize: '18px', fontWeight: 800 }}>🗓 BCC — Bảng Công Từng Ngày</div><div style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '4px' }}>Chi tiết từng ngày công theo chi nhánh — dữ liệu realtime tháng {periodLabel(month)}.</div></div>}
        {activeTab === 'fin-calculate' && <CalculateTab month={month} formula={formula} setFormula={setFormula} inputs={inputs} setInputs={setInputs} inputsLoading={inputsLoading} allEmployees={allEmployees} saveFormula={saveFormula} upsertInput={upsertInput} saveAllInputs={saveAllInputs} loadFormula={loadFormula} loadInputs={loadInputs} />}
        {activeTab === 'fin-payroll-sheet' && <PayrollSheetTab month={month} slips={slips} allEmployees={allEmployees} branchLabelOf={branchLabelOf} formatVND={formatVND} periodLabel={periodLabel} />}
        {activeTab === 'fin-payroll-periods' && <PayrollPeriodsTab month={month} runs={runs} runsLoading={runsLoading} loadRuns={loadRuns} periodLabel={periodLabel} formatVND={formatVND} />}
        {activeTab === 'fin-payslips' && <PayslipsTab month={month} slips={slips} slipsLoading={slipsLoading} allEmployees={allEmployees} branchLabelOf={branchLabelOf} formatVND={formatVND} loadSlips={loadSlips} stageBadge={stageBadge} slipQrUrl={slipQrUrl} fastSignLap={fastSignLap} publishSlip={publishSlip} markPaidSlip={markPaidSlip} syncSlipDrive={syncSlipDrive} periodLabel={periodLabel} />}
        {activeTab === 'fin-payment' && <PaymentTab month={month} slips={slips} allEmployees={allEmployees} branchLabelOf={branchLabelOf} formatVND={formatVND} loadSlips={loadSlips} slipQrUrl={slipQrUrl} markPaidSlip={markPaidSlip} periodLabel={periodLabel} />}
        {activeTab === 'fin-signatures' && <div style={{ padding: '16px' }}><div style={{ fontSize: '18px', fontWeight: 800 }}>✍ Chữ Ký Mẫu</div><div style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '4px' }}>Cài đặt chữ ký mẫu Kế toán & Quản lý chi nhánh.</div></div>}
        {activeTab === 'fin-bank-qr' && <div style={{ padding: '16px' }}><div style={{ fontSize: '18px', fontWeight: 800 }}>🏦 QR Ngân Hàng Từng Nhân Viên</div><div style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '4px' }}>Danh sách tài khoản ngân hàng NV để quét QR chuyển khoản lương.</div></div>}
        {activeTab === 'fin-salary-config' && <SalaryConfigView currentUser={currentUser} />}
        {activeTab === 'office-approvals' && <OfficeApprovalsView currentUser={currentUser} />}
        {activeTab === 'bank-changes' && <div style={{ padding: '16px' }}><div style={{ fontSize: '18px', fontWeight: 800 }}>💳 Duyệt Đổi STK</div><div style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '4px' }}>Duyệt đổi số tài khoản ngân hàng (dùng chung ADMIN/HR/FINANCE).</div></div>}
      </div>
    </div>
  );
}

/* ============================================================================
   SUB COMPONENTS
   ============================================================================ */

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div style={{ background: 'var(--surface)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)', boxShadow: '0 4px 14px rgba(15,23,42,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: '#FDF2F7', color: '#E85D92', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>{icon}</div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      </div>
      <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text)', marginTop: '8px' }}>{value}</div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>{sub}</div>
    </div>
  );
}

function DashboardTab({ month, finSheet, finSheetLoading, slips, workflow, loadFinSheet, loadRuns, periodLabel, formatVND }: any) {
  const fs = finSheet;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text)' }}>💰 1. Dashboard Tài Chính & Tính Lương</div>
      <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Tổng quan quỹ lương toàn công ty theo từng Khối.</div>
      {finSheetLoading && <div style={{ padding: '16px', color: 'var(--text-muted)' }}>Đang tải dữ liệu tháng {periodLabel(month)}…</div>}
      {!finSheetLoading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px' }}>
          <StatCard icon={<DollarSign size={16} />} label="Quỹ lương dự kiến" value={formatVND(fs?.totals?.totalAmount ?? 0)} sub="Tổng thực lĩnh tháng" />
          <StatCard icon={<Clock size={16} />} label="Tổng giờ công" value={`${Number(fs?.totals?.hours ?? 0).toFixed(1)} giờ`} sub="Từ dữ liệu chấm công thực" />
          <StatCard icon={<FileText size={16} />} label="Phiếu lương" value={`${slips.filter(s => ['PUBLISHED', 'CONFIRMED', 'PAID'].includes(String(s.status))).length} / ${slips.length}`} sub="Đã phát hành / tổng phiếu" />
          <StatCard icon={<Activity size={16} />} label="Trạng thái kỳ" value={workflow?.steps.find(s => s.id === 'fin-payroll-periods')?.stat || '—'} sub="Kỳ mới nhất" />
        </div>
      )}
      {fs && (
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', fontWeight: 800, fontSize: '13px', color: 'var(--text)', borderBottom: '1px solid var(--border)' }}>📦 Lương theo từng Khối — Kỳ {periodLabel(month)}</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '10px 14px', fontWeight: 800 }}>Khối</th>
                  <th style={{ padding: '10px 14px', fontWeight: 800, textAlign: 'right' }}>NV</th>
                  <th style={{ padding: '10px 14px', fontWeight: 800, textAlign: 'right' }}>Giờ công</th>
                  <th style={{ padding: '10px 14px', fontWeight: 800, textAlign: 'right' }}>Tổng tiền</th>
                  <th style={{ padding: '10px 14px', fontWeight: 800, textAlign: 'right' }}>Thực lĩnh</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(fs?.byBlock || {}).map((b: any) => (
                  <tr key={b.key} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 700 }}>{b.label}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>{b.employees}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(b.hours ?? 0).toFixed(1)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700 }}>{formatVND(b.value ?? 0)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>{formatVND(b.netPay ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function TimesheetTab({ month, finSheet, finSheetLoading, loadFinSheet, branchLabelOf, formatVND, periodLabel }: any) {
  const fs = finSheet;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text)' }}>📋 2. Đối Soát Công & Bảng Chấm Công</div>
        <button onClick={loadFinSheet} disabled={finSheetLoading} style={{ ...{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 700, border: 'none', cursor: 'pointer', backgroundColor: '#E85D92', color: '#fff' } } }><RefreshCw size={14} style={{ marginRight: '4px' }} /> Tải lại bảng công</button>
      </div>
      <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Tổng hợp công theo nhân viên, chi nhánh, tháng — dữ liệu realtime.</div>
      {finSheetLoading ? (
        <div style={{ padding: '20px', color: 'var(--text-muted)' }}>Đang tải bảng chấm công tháng {periodLabel(month)}…</div>
      ) : finSheet ? (
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', fontWeight: 800, fontSize: '12.5px', color: 'var(--text)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
            <span>Kỳ {periodLabel(month)} — {fs.fromDate} → {fs.toDate} ({fs.daysInMonth} ngày)</span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{fs.totals?.employees} NV • {fs.totals?.totalShifts} ca • {Number(fs.totals?.hours ?? 0).toFixed(1)} giờ</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
              <thead>
                <tr style={{ background: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '10px 14px', fontWeight: 800 }}>Họ tên</th>
                  <th style={{ padding: '10px 14px', fontWeight: 800 }}>Mã NV</th>
                  <th style={{ padding: '10px 14px', fontWeight: 800 }}>Chi nhánh</th>
                  <th style={{ padding: '10px 14px', fontWeight: 800, textAlign: 'right' }}>Giờ công</th>
                  <th style={{ padding: '10px 14px', fontWeight: 800, textAlign: 'right' }}>Ca đủ</th>
                  <th style={{ padding: '10px 14px', fontWeight: 800, textAlign: 'right' }}>Ca vắng</th>
                  <th style={{ padding: '10px 14px', fontWeight: 800, textAlign: 'right' }}>Tiền lương</th>
                </tr>
              </thead>
              <tbody>
                {(fs.rows || []).map((r: any) => (
                  <tr key={r.employeeId} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 700 }}>{r.fullName}</td>
                    <td style={{ padding: '10px 14px' }}>{r.employeeCode}</td>
                    <td style={{ padding: '10px 14px' }}>{branchLabelOf(r.branchId)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(r.hours ?? 0).toFixed(1)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>{r.full}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: '#B91C1C', fontWeight: 700 }}>{r.absent}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700 }}>{formatVND(r.netPay ?? r.salary ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div style={{ padding: '20px', color: 'var(--text-muted)', textAlign: 'center' }}>Chưa có dữ liệu chấm công tháng này.</div>
      )}
    </div>
  );
}

function CalculateTab({ month, formula, setFormula, inputs, setInputs, inputsLoading, allEmployees, saveFormula, upsertInput, saveAllInputs, loadFormula, loadInputs }: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text)' }}>🧮 4. Tính Lương (Công Thức & Nhập Tay)</div>
      <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Lưu công thức + nhập liệu tay cho từng NV.</div>
      <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: '12px', padding: '14px' }}>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>Công thức kỳ {month}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', marginBottom: '10px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 700 }}>Đơn giá giờ thử việc (rateTV)</div>
            <input type="number" value={formula?.rateTV ?? ''} onChange={e => setFormula({ ...formula, rateTV: Number(e.target.value) || 0 })} style={{ padding: '6px 8px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '12px' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 700 }}>Đơn giá giờ chính thức (rateCT)</div>
            <input type="number" value={formula?.rateCT ?? ''} onChange={e => setFormula({ ...formula, rateCT: Number(e.target.value) || 0 })} style={{ padding: '6px 8px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '12px' }} />
          </div>
        </div>
        <button onClick={saveFormula} disabled={inputsLoading} style={{ ...{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 700, border: 'none', cursor: 'pointer', backgroundColor: '#E85D92', color: '#fff' } } }><Save size={14} style={{ marginRight: '4px' }} /> Lưu công thức lương</button>
      </div>
      <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: '12px', padding: '14px' }}>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>Nhập liệu tay theo kỳ</div>
        <div style={{ overflowX: 'auto', marginBottom: '8px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', minWidth: '820px' }}>
            <thead>
              <tr style={{ background: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '8px 10px', fontWeight: 800 }}>Mã NV</th><th style={{ padding: '8px 10px', fontWeight: 800 }}>Họ tên</th>
                <th style={{ padding: '8px 10px', fontWeight: 800, textAlign: 'right' }}>LCB</th><th style={{ padding: '8px 10px', fontWeight: 800, textAlign: 'right' }}>OT thêm</th>
                <th style={{ padding: '8px 10px', fontWeight: 800, textAlign: 'right' }}>Bonus</th><th style={{ padding: '8px 10px', fontWeight: 800, textAlign: 'right' }}>Ứng lương</th>
                <th style={{ padding: '8px 10px', fontWeight: 800, textAlign: 'right' }}>Trừ KPI</th><th style={{ padding: '8px 10px', fontWeight: 800, textAlign: 'right' }}>Trừ ĐP</th><th style={{ padding: '8px 10px', fontWeight: 800 }}>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {allEmployees.map((emp: any) => {
                const inp = inputs.find((i: any) => i.employee_id === emp.employee_id) || {};
                return (
                  <tr key={emp.employee_id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td style={{ padding: '7px 10px', fontWeight: 700 }}>{emp.employee_code}</td>
                    <td style={{ padding: '7px 10px' }}>{emp.full_name}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right' }}><input type="number" value={inp.luong_cb ?? ''} onChange={v => upsertInput(emp.employee_id, 'luong_cb', v.target.value)} style={{ width: '100%', padding: '4px 6px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '11.5px', background: '#fff' }} /></td>
                    <td style={{ padding: '7px 10px', textAlign: 'right' }}><input type="number" value={inp.ot_extra ?? ''} onChange={v => upsertInput(emp.employee_id, 'ot_extra', v.target.value)} style={{ width: '100%', padding: '4px 6px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '11.5px', background: '#fff' }} /></td>
                    <td style={{ padding: '7px 10px', textAlign: 'right' }}><input type="number" value={inp.bonus_extra ?? ''} onChange={v => upsertInput(emp.employee_id, 'bonus_extra', v.target.value)} style={{ width: '100%', padding: '4px 6px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '11.5px', background: '#fff' }} /></td>
                    <td style={{ padding: '7px 10px', textAlign: 'right' }}><input type="number" value={inp.ung_luong ?? ''} onChange={v => upsertInput(emp.employee_id, 'ung_luong', v.target.value)} style={{ width: '100%', padding: '4px 6px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '11.5px', background: '#fff' }} /></td>
                    <td style={{ padding: '7px 10px', textAlign: 'right' }}><input type="number" value={inp.tru_kpi ?? ''} onChange={v => upsertInput(emp.employee_id, 'tru_kpi', v.target.value)} style={{ width: '100%', padding: '4px 6px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '11.5px', background: '#fff' }} /></td>
                    <td style={{ padding: '7px 10px', textAlign: 'right' }}><input type="number" value={inp.dong_phuc ?? ''} onChange={v => upsertInput(emp.employee_id, 'dong_phuc', v.target.value)} style={{ width: '100%', padding: '4px 6px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '11.5px', background: '#fff' }} /></td>
                    <td style={{ padding: '7px 10px' }}><input value={inp.note ?? ''} onChange={v => upsertInput(emp.employee_id, 'note', v.target.value)} style={{ width: '100%', padding: '4px 6px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '11.5px', background: '#fff' }} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button onClick={saveAllInputs} disabled={inputsLoading} style={{ ...{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 700, border: 'none', cursor: 'pointer', backgroundColor: '#E85D92', color: '#fff' } } }><Save size={14} style={{ marginRight: '4px' }} /> Lưu tất cả nhập tay</button>
      </div>
    </div>
  );
}

function PayrollSheetTab({ month, slips, allEmployees, branchLabelOf, formatVND, periodLabel }: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text)' }}>📊 5. Payment — Bảng Lương Tháng</div>
      <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Bảng lương tháng theo từng chi nhánh.</div>
      <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', fontWeight: 800, fontSize: '12.5px', color: 'var(--text)', borderBottom: '1px solid var(--border)' }}>Kỳ {periodLabel(month)} — Bảng lương theo chi nhánh</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', minWidth: '900px' }}>
            <thead>
              <tr style={{ background: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '10px 14px', fontWeight: 800 }}>Họ tên</th><th style={{ padding: '10px 14px', fontWeight: 800 }}>Mã NV</th><th style={{ padding: '10px 14px', fontWeight: 800 }}>Chi nhánh</th>
                <th style={{ padding: '10px 14px', fontWeight: 800, textAlign: 'right' }}>LCB</th><th style={{ padding: '10px 14px', fontWeight: 800, textAlign: 'right' }}>OT</th><th style={{ padding: '10px 14px', fontWeight: 800, textAlign: 'right' }}>Bonus</th>
                <th style={{ padding: '10px 14px', fontWeight: 800, textAlign: 'right' }}>Tổng cộng</th><th style={{ padding: '10px 14px', fontWeight: 800, textAlign: 'right' }}>Khấu trừ</th><th style={{ padding: '10px 14px', fontWeight: 800, textAlign: 'right' }}>Ứng</th><th style={{ padding: '10px 14px', fontWeight: 800, textAlign: 'right' }}>THỰC LÃNH</th><th style={{ padding: '10px 14px', fontWeight: 800 }}>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {slips.map((s: any) => {
                const kpi = (Number(s.tru_kpi) || 0) + (Number(s.deduction) || 0);
                const tongCong = Number(s.tong_cong) || ((Number(s.standard_pay) || 0) + (Number(s.luong_cb) || 0) + (Number(s.ot_extra) || 0) + (Number(s.bonus) || 0));
                const thuc = Number(s.thuc_lanh ?? s.net_pay) || 0;
                const st = stageBadge(s.stage ?? s.status);
                const emp = allEmployees.find((e: any) => String(e.employee_id) === String(s.employee_id));
                return (
                  <tr key={s.item_id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td style={{ padding: '9px 14px', fontWeight: 700 }}>{s.full_name}</td>
                    <td style={{ padding: '9px 14px' }}>{s.employee_code}</td>
                    <td style={{ padding: '9px 14px' }}>{branchLabelOf(emp?.default_branch_id || s.branch_id)}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right' }}>{formatVND(s.luong_cb)}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right' }}>{formatVND(s.ot_extra)}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right' }}>{formatVND(s.bonus)}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 700 }}>{formatVND(tongCong)}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color: '#B91C1C' }}>{formatVND(kpi)}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color: '#B91C1C' }}>{formatVND(s.ung_luong)}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 800, color: '#166534' }}>{formatVND(thuc)}</td>
                    <td style={{ padding: '9px 14px' }}><span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: '6px', background: st.bg, color: st.fg, fontSize: '10.5px', fontWeight: 800, border: `1px solid ${st.border}` }}>{st.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {slips.length === 0 && <div style={{ padding: '16px', color: 'var(--text-muted)', textAlign: 'center' }}>Chưa có bảng lương tháng này.</div>}
      </div>
    </div>
  );
}

function PayrollPeriodsTab({ month, runs, runsLoading, loadRuns, periodLabel, formatVND }: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text)' }}>📅 6. Kỳ Lương (DRAFT → PAID)</div>
      <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Quản lý vòng đời kỳ lương.</div>
      <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: '12px', padding: '14px' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--text-muted)' }}>Kỳ: {periodLabel(month)}</span>
          <button onClick={loadRuns} style={{ ...{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 700, border: 'none', cursor: 'pointer', backgroundColor: '#E85D92', color: '#fff' } } }><RefreshCw size={14} style={{ marginRight: '4px' }} /> Tải lại</button>
        </div>
        {runsLoading ? <div style={{ padding: '16px', color: 'var(--text-muted)' }}>Đang tải kỳ lương…</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', minWidth: '620px' }}>
              <thead>
                <tr style={{ background: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '10px 14px', fontWeight: 800 }}>Kỳ</th><th style={{ padding: '10px 14px', fontWeight: 800 }}>Trạng thái</th><th style={{ padding: '10px 14px', fontWeight: 800, textAlign: 'right' }}>NV</th><th style={{ padding: '10px 14px', fontWeight: 800, textAlign: 'right' }}>Giờ</th><th style={{ padding: '10px 14px', fontWeight: 800, textAlign: 'right' }}>Tiền</th><th style={{ padding: '10px 14px', fontWeight: 800 }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {(runs.filter((r: any) => r.period === month).length ? runs.filter((r: any) => r.period === month) : [{ run_id: 'PAY_' + month, period: month, status: 'DRAFT', total_employees: 0, total_hours: 0, total_amount: 0 }]).map((r: any) => {
                  const st = String(r.status || 'DRAFT');
                  const color = st === 'PAID' ? '#166534' : st === 'PUBLISHED' ? '#059669' : st === 'APPROVED' ? '#7C3AED' : st === 'RECONCILED' ? '#2563EB' : '#6B7280';
                  return (
                    <tr key={r.run_id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 700 }}>{r.period}</td>
                      <td style={{ padding: '10px 14px' }}><span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: '6px', background: `${color}15`, color, fontSize: '10.5px', fontWeight: 800, border: `1px solid ${color}40` }}>{st}</span></td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>{r.total_employees}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(r.total_hours ?? 0).toFixed(1)}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700 }}>{formatVND(r.total_amount)}</td>
                      <td style={{ padding: '10px 14px' }}>{st === 'PAID' ? <span style={{ fontSize: '11px', color: '#166534', fontWeight: 800 }}>✓ Hoàn tất</span> : <span style={{ fontSize: '11px', color: '#6B7280' }}>Đang xử lý</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function PayslipsTab({ month, slips, slipsLoading, allEmployees, branchLabelOf, formatVND, loadSlips, stageBadge, slipQrUrl, fastSignLap, publishSlip, markPaidSlip, syncSlipDrive, periodLabel }: any) {
  const confirmed = slips.filter(s => String(s.status) === 'CONFIRMED' || s.sign_nhanvien);
  const published = slips.filter(s => String(s.status) === 'PUBLISHED');
  const paid = slips.filter(s => String(s.status) === 'PAID');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text)' }}>🧾 7. Phiếu Lương (KT ký → GĐ → NV ký)</div>
      <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Quy trình 3 chữ ký: Kế toán ký lập → Giám đốc ký duyệt → Kế toán gửi NV → Nhân viên ký → Kế toán chuyển khoản (khóa phiếu + QR ngân hàng).</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '6px' }}>
        <StatCard icon={<FileText size={16} />} label="Tổng phiếu" value={slips.length.toString()} sub="Kỳ" />
        <StatCard icon={<PenTool size={16} />} label="Chờ GĐ duyệt" value={slips.filter(s => String(s.status) === 'DRAFT' && s.sign_lap).length.toString()} sub="KT đã ký lập" />
        <StatCard icon={<Send size={16} />} label="Chờ NV ký" value={published.length.toString()} sub="Đã gửi nhân viên" />
        <StatCard icon={<CreditCard size={16} />} label="Chờ chuyển khoản" value={confirmed.length.toString()} sub="NV đã ký — hiện QR" />
        <StatCard icon={<Check size={16} />} label="Đã chuyển khoản" value={paid.length.toString()} sub="Phiếu khóa + PDF Drive" />
      </div>
      <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', fontWeight: 800, fontSize: '12.5px', color: 'var(--text)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Danh sách phiếu lương — Kỳ {periodLabel(month)}</span>
          <button onClick={loadSlips} disabled={slipsLoading} style={{ ...{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 700, border: 'none', cursor: 'pointer', backgroundColor: '#E85D92', color: '#fff' } } }><RefreshCw size={13} style={{ marginRight: '4px' }} /> Tải lại</button>
        </div>
        {slipsLoading && <div style={{ padding: '16px', color: 'var(--text-muted)' }}>Đang tải phiếu lương…</div>}
        {!slipsLoading && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', minWidth: '980px' }}>
              <thead>
                <tr style={{ background: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '9px 14px', fontWeight: 800 }}>Họ tên</th><th style={{ padding: '9px 14px', fontWeight: 800 }}>Mã NV</th><th style={{ padding: '9px 14px', fontWeight: 800 }}>Chi nhánh</th>
                  <th style={{ padding: '9px 14px', fontWeight: 800, textAlign: 'right' }}>THỰC LÃNH</th><th style={{ padding: '9px 14px', fontWeight: 800 }}>Trạng thái / Chữ ký</th><th style={{ padding: '9px 14px', fontWeight: 800 }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {slips.map((s: any) => {
                  const st = stageBadge(s.stage ?? s.status);
                  const thuc = Number(s.thuc_lanh ?? s.net_pay) || 0;
                  const emp = allEmployees.find((e: any) => String(e.employee_id) === String(s.employee_id));
                  const hasLap = !!s.sign_lap;
                  const hasGd = !!s.sign_giamdoc;
                  const hasNv = !!s.sign_nhanvien;
                  const isPaid = String(s.status) === 'PAID';
                  const qrUrl = slipQrUrl(s);
                  return (
                    <tr key={s.item_id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td style={{ padding: '9px 14px', fontWeight: 700 }}>{s.full_name}</td>
                      <td style={{ padding: '9px 14px' }}>{s.employee_code}</td>
                      <td style={{ padding: '9px 14px' }}>{branchLabelOf(emp?.default_branch_id || s.branch_id)}</td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 800, color: '#166534' }}>{formatVND(thuc)}</td>
                      <td style={{ padding: '9px 14px' }}>
                        <div style={{ fontSize: '10.5px', fontWeight: 800, color: st.fg, background: st.bg, border: `1px solid ${st.border}`, borderRadius: '6px', padding: '4px 8px', display: 'inline-block', marginBottom: '4px' }}>{st.label}</div>
                        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '9px', padding: '1px 6px', borderRadius: '4px', background: hasLap ? '#DBEAFE' : '#F1F5F9', color: hasLap ? '#1D4ED8' : '#64748B', fontWeight: 700 }}>{hasLap ? '✓ KT' : 'KT?'}</span>
                          <span style={{ fontSize: '9px', padding: '1px 6px', borderRadius: '4px', background: hasGd ? '#DBEAFE' : '#F1F5F9', color: hasGd ? '#1D4ED8' : '#64748B', fontWeight: 700 }}>{hasGd ? '✓ GĐ' : 'GĐ?'}</span>
                          <span style={{ fontSize: '9px', padding: '1px 6px', borderRadius: '4px', background: hasNv ? '#D1FAE5' : '#F1F5F9', color: hasNv ? '#065F46' : '#64748B', fontWeight: 700 }}>{hasNv ? '✓ NV' : 'NV?'}</span>
                        </div>
                      </td>
                      <td style={{ padding: '9px 14px' }}>
                        {isPaid ? (
                          <>
                            <button onClick={() => syncSlipDrive(s.item_id)} style={{ ...{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', border: '1px solid var(--border)', background: '#F3F4F6', color: '#374151', cursor: 'pointer' } } }><Download size={12} style={{ marginRight: '4px' }} /> PDF Drive</button>
                            <span style={{ fontSize: '11px', color: '#166534', fontWeight: 800, marginLeft: '8px' }}>ĐÃ CHUYỂN KHOẢN — khóa</span>
                          </>
                        ) : String(s.status) === 'CONFIRMED' ? (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                              {qrUrl && <img src={qrUrl} alt="VietQR" style={{ width: '64px', height: '64px', border: '1px solid #CBD5E1', borderRadius: '6px', background: '#fff' }} onError={(e: any) => { (e.target as any).style.display = 'none'; }} />}
                              <div style={{ fontSize: '11.5px' }}>
                                <div style={{ fontWeight: 800, color: '#273142' }}>{formatVND(thuc)}</div>
                                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Ngân hàng: {s.bank_name || '—'} / STK: {s.bank_account || '—'}</div>
                              </div>
                              <button onClick={() => markPaidSlip(s.item_id)} style={{ ...{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, border: 'none', cursor: 'pointer', backgroundColor: '#E85D92', color: '#fff' } } }><Check size={13} style={{ marginRight: '4px' }} /> Đã Chuyển Khoản</button>
                            </div>
                            <div style={{ fontSize: '10.5px', color: '#9A3412', marginTop: '4px' }}>Phiếu đã khóa sau khi NV ký — chỉ Kế toán có thể bấm "Đã Chuyển Khoản".</div>
                          </>
                        ) : String(s.status) === 'PUBLISHED' ? (
                          <button onClick={() => publishSlip(s.item_id)} style={{ ...{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, border: 'none', cursor: 'pointer', backgroundColor: '#E85D92', color: '#fff' } } }><Send size={13} style={{ marginRight: '4px' }} /> Gửi NV ký</button>
                        ) : hasLap && !hasGd ? (
                          <span style={{ fontSize: '10.5px', color: '#92400E', fontWeight: 700 }}>Chờ Giám đốc ký duyệt</span>
                        ) : (
                          <button onClick={() => fastSignLap(s.item_id)} disabled={!hasLap} style={{ ...{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, border: 'none', cursor: !hasLap ? 'not-allowed' : 'pointer', backgroundColor: !hasLap ? '#E2E8F0' : '#E85D92', color: !hasLap ? '#94A3B8' : '#fff' } } }><PenTool size={13} style={{ marginRight: '4px' }} /> Kế toán ký lập</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {slips.length === 0 && <div style={{ padding: '16px', color: 'var(--text-muted)', textAlign: 'center' }}>Chưa có phiếu lương kỳ này. Hãy tính lương và phát hành phiếu trước.</div>}
      </div>
    </div>
  );
}

function PaymentTab({ month, slips, allEmployees, branchLabelOf, formatVND, loadSlips, slipQrUrl, markPaidSlip, periodLabel }: any) {
  const ready = slips.filter(s => String(s.status) === 'CONFIRMED');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text)' }}>💳 8. Thanh Toán (VietQR — Đã Chuyển Khoản)</div>
      <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Chỉ hiển thị phiếu NV đã ký (CONFIRMED). Quét QR → chuyển khoản → bấm "Đã Chuyển Khoản" → phiếu khóa + đồng bộ PDF Drive.</div>
      <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', fontWeight: 800, fontSize: '12.5px', color: 'var(--text)', borderBottom: '1px solid var(--border)' }}>Phiếu chờ chuyển khoản — Kỳ {periodLabel(month)} ({ready.length} phiếu)</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', minWidth: '860px' }}>
            <thead>
              <tr style={{ background: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '10px 14px', fontWeight: 800 }}>Họ tên</th><th style={{ padding: '10px 14px', fontWeight: 800 }}>Mã NV</th><th style={{ padding: '10px 14px', fontWeight: 800 }}>Chi nhánh</th>
                <th style={{ padding: '10px 14px', fontWeight: 800, textAlign: 'right' }}>THỰC LÃNH</th><th style={{ padding: '10px 14px', fontWeight: 800 }}>Ngân hàng / STK</th><th style={{ padding: '10px 14px', fontWeight: 800 }}>VietQR quét</th><th style={{ padding: '10px 14px', fontWeight: 800 }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {ready.map((s: any) => {
                const thuc = Number(s.thuc_lanh ?? s.net_pay) || 0;
                const qrUrl = slipQrUrl(s);
                const emp = allEmployees.find((e: any) => String(e.employee_id) === String(s.employee_id));
                return (
                  <tr key={s.item_id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 700 }}>{s.full_name}</td>
                    <td style={{ padding: '10px 14px' }}>{s.employee_code}</td>
                    <td style={{ padding: '10px 14px' }}>{branchLabelOf(emp?.default_branch_id || s.branch_id)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, color: '#166534' }}>{formatVND(thuc)}</td>
                    <td style={{ padding: '10px 14px', fontSize: '11px' }}>{s.bank_name || '—'}<br /><span style={{ fontWeight: 800, color: '#273142' }}>{s.bank_account || '—'}</span></td>
                    <td style={{ padding: '10px 14px' }}>
                      {qrUrl ? <img src={qrUrl} alt="VietQR" style={{ width: '56px', height: '56px', border: '1px solid #CBD5E1', borderRadius: '6px', background: '#fff' }} onError={(e: any) => { (e.target as any).style.display = 'none'; }} /> : <div style={{ width: '56px', height: '56px', border: '1.5px dashed #F87171', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#DC2626' }}>Chưa có STK</div>}
                    </td>
                    <td style={{ padding: '10px 14px' }}><button onClick={() => markPaidSlip(s.item_id)} style={{ ...{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, border: 'none', cursor: 'pointer', backgroundColor: '#E85D92', color: '#fff' } } }><Check size={13} style={{ marginRight: '4px' }} /> Đã Chuyển Khoản</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {ready.length === 0 && <div style={{ padding: '16px', color: 'var(--text-muted)', textAlign: 'center' }}>Không có phiếu nào chờ chuyển khoản (chưa NV ký hoặc đã chuyển hết).</div>}
      </div>
    </div>
  );
}
