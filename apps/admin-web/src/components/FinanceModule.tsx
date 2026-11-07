/**
 * FINANCE MODULE — Cổng Kế toán tính lương (UMB Milk V5.1)
 * Bố cục thiết kế lại: topbar + chuyển dữ liệu tháng + Drive bar +
 * stepper quy trình 8 bước + bảng theo CHI NHÁNH (band + subtotal).
 * Nghiệp vụ giữ nguyên: đối soát → BCC → tính lương → kỳ lương →
 * phiếu lương (KT → GĐ → NV ký) → đã chuyển khoản (khóa + Drive PDF).
 */
// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DollarSign, FileSpreadsheet, Calendar, CalendarRange, CreditCard, CheckCircle,
  PenTool, QrCode, FileText, Users, Loader2, RefreshCw,
  Upload, Download, Printer, ShieldAlert, ArrowRight,
  Plus, Save, LayoutDashboard, List, Activity, Receipt,
  Send, Check, X, ChevronDown, Folder, HardDrive, Lock,
  Clock, Wallet, History, Archive, Search, FileDown, Building2,
  ShieldCheck, AlertCircle, Banknote, Calculator, Settings2, Inbox,
} from 'lucide-react';
import { apiRequest, getApiBase, getAuthToken } from '../services/api.js';
import {
  payslipStage, PAYSLIP_STAGE_LABEL,
  monthShortFolder, periodLabel, parsePeriod,
} from '@ubm/shared';
import { SalaryConfigView } from './SalaryConfigView.js';
import { OfficeApprovalsView } from './OfficeApprovalsView.js';
import RateAdjustTab from './RateAdjustTab';
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
const MONTH_KEY = 'ubm_fin_month';
const VN_OFFSET_MS = 7 * 3_600_000;
const currentPeriod = () => new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 7);
const defaultMonth = currentPeriod;
const monthOptions = () => {
  const out: Array<{ value: string; label: string }> = [];
  const base = new Date(Date.now() + VN_OFFSET_MS);
  for (let i = 0; i < 13; i++) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
    const v = d.toISOString().slice(0, 7);
    out.push({ value: v, label: `Tháng ${v.slice(5, 7)}/${v.slice(0, 4)}${i === 0 ? ' (hiện tại)' : ''}` });
  }
  return out;
};

const STAGE_COLOR: Record<string, { bg: string; fg: string; border: string }> = {
  DRAFT: { bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1' },
  CHO_GD_DUYET: { bg: '#FEF3C7', fg: '#92400E', border: '#FCD34D' },
  CHO_GUI_NV: { bg: '#E0E7FF', fg: '#3730A3', border: '#BFDBFE' },
  CHO_NV_KY: { bg: '#FFEDD5', fg: '#9A3412', border: '#FDBA74' },
  CHO_CHUYEN_KHOAN: { bg: '#FEF9C3', fg: '#854D0E', border: '#FDE047' },
  PAID: { bg: '#DCFCE7', fg: '#166534', border: '#86EFAC' },
};

/** Quy trình kế toán (8 bước, khóa tuần tự theo workflow-status). */
const PROCESS_STEPS = [
  { id: 'fin-dashboard', label: 'Tổng quan', icon: LayoutDashboard, step: 1 },
  { id: 'fin-timesheet', label: 'Đối soát công', icon: FileSpreadsheet, step: 2 },
  { id: 'fin-bcc', label: 'BCC theo ngày', icon: Calendar, step: 3 },
  { id: 'fin-calculate', label: 'Tính lương', icon: Calculator, step: 4 },
  { id: 'fin-payroll-sheet', label: 'Bảng lương tháng', icon: FileText, step: 5 },
  { id: 'fin-payroll-periods', label: 'Kỳ lương', icon: CalendarRange, step: 6 },
  { id: 'fin-payslips', label: 'Phiếu lương', icon: Receipt, step: 7 },
  { id: 'fin-payment', label: 'Thanh toán', icon: CreditCard, step: 8 },
];
/** Tiện ích & cài đặt (luôn mở, không thuộc chuỗi khóa). */
const UTIL_TABS = [
  { id: 'fin-signatures', label: 'Chữ ký mẫu', icon: PenTool },
  { id: 'fin-bank-qr', label: 'QR ngân hàng NV', icon: QrCode },
  { id: 'fin-rate-adjust', label: 'Điều chỉnh lương ca', icon: Banknote },
  { id: 'bank-changes', label: 'Duyệt đổi STK', icon: CreditCard },
  { id: 'office-approvals', label: 'Duyệt văn phòng', icon: FileText },
  { id: 'fin-salary-config', label: 'Cấu hình lương CB', icon: Settings2 },
];
const ALL_TAB_IDS = [...PROCESS_STEPS.map(t => t.id), ...UTIL_TABS.map(t => t.id)];

const accentStrip = (s: unknown) => String(s ?? '').replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
/** Slug ngân hàng cho ảnh VietQR (img.vietqr.io). */
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
  return accentStrip(s).toLowerCase().replace(/[^a-z0-9]/g, '') || 'vietcombank';
};
/** QR chuyển khoản có số tiền theo phiếu (khi đã biết thực lãnh). */
const slipQrUrlOf = (s: any) => {
  const acct = String(s?.bank_account || '').trim();
  if (!acct) return null;
  const amt = Math.max(0, Math.round(Number(s?.thuc_lanh ?? s?.net_pay) || 0));
  const info = `LUONG ${s?.period || ''} ${s?.employee_code || ''}`.slice(0, 50);
  const holder = String(s?.bank_holder || s?.full_name || '').slice(0, 50);
  return `https://img.vietqr.io/image/${vietQrSlug(s?.bank_name)}-${encodeURIComponent(acct)}-compact2.png?amount=${amt}&addInfo=${encodeURIComponent(info)}&accountName=${encodeURIComponent(holder)}`;
};
/** QR đây/mã STK tự do (không gắn số tiền) — dùng tab QR Ngân Hàng NV. */
const bankQrUrlOf = (b: string, acct: string, holder?: string) => {
  if (!String(acct || '').trim()) return null;
  return `https://img.vietqr.io/image/${vietQrSlug(b)}-${encodeURIComponent(acct.trim())}-compact2.png?accountName=${encodeURIComponent(String(holder || '').slice(0, 50))}`;
};

/** Gom list theo chi nhánh — trả về [{id, rows}] theo thứ tự chuẩn toàn hệ thống. */
function branchGroups<T>(items: T[], getBranch: (x: T) => any) {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = String(getBranch(it) ?? '—');
    const arr = map.get(k);
    if (arr) arr.push(it); else map.set(k, [it]);
  }
  return orderedBranchKeys(map.keys()).map(id => ({ id, rows: map.get(id)! }));
}

const sumBy = (rows: any[], key: string) => rows.reduce((s, r) => s + (Number(r?.[key]) || 0), 0);
const r1 = (n: number) => Math.round(n * 10) / 10;
const fmtDateTime = (v?: string | null) => (v ? new Date(v).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');

export interface FinanceModuleProps {
  activeTab: string; currentUser: any; allEmployees: any; shifts: any;
  payrollRuns: any; branches: any; salaryConfigs: any;
  systemNotifications: any; showToast: (msg: string) => void;
  onRefreshData?: () => void | Promise<void>; onSyncSheets?: () => void | Promise<void>; onPushSheets?: () => void | Promise<void>;
  /** Điều hướng tab (sidebar của cổng admin) — dùng cho nút "Quay về bước đang xử lý". */
  onNavigateTab?: (id: string) => void;
}

export default function FinanceModule(props: FinanceModuleProps) {
  const {
    activeTab, currentUser, allEmployees, shifts, payrollRuns, branches,
    salaryConfigs, showToast, onRefreshData, onPushSheets, onNavigateTab,
  } = props;
  const curPeriod = useMemo(() => currentPeriod(), []);
  const [month, setMonth] = useState<string>(() => {
    const saved = localStorage.getItem(MONTH_KEY);
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(saved || '')) return saved || curPeriod;
    return curPeriod;
  });
  useEffect(() => { localStorage.setItem(MONTH_KEY, month); }, [month]);
  const isCurrentMonth = month === curPeriod;
  const options = useMemo(() => {
    const base = monthOptions();
    if (month && !base.some(o => o.value === month)) {
      base.push({ value: month, label: periodLabel(month) });
    }
    return base;
  }, [month]);

  const [workflow, setWorkflow] = useState<any>(null);
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [driveConfigured, setDriveConfigured] = useState(false);
  const [lastSync, setLastSync] = useState<any>(null);
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
  const [calcBusy, setCalcBusy] = useState(false);
  // Nhập tay: lưu local ngay + debounce PUT 800ms (trước đây mỗi phím gõ là 1 PUT +
  // ghi đè toàn bộ tab Sheets → Google chặn quota → "nhập tay không hoạt động").
  const inputsRef = useRef<any[]>([]);
  const inputTimersRef = useRef<Map<string, any>>(new Map());
  const inputPendingRef = useRef<Map<string, { employeeId: string; field: string }>>(new Map());
  const [pendingCount, setPendingCount] = useState(0);
  const [inputsSaving, setInputsSaving] = useState(false);
  const [inputsSavedAt, setInputsSavedAt] = useState<Date | null>(null);
  useEffect(() => { inputsRef.current = inputs; }, [inputs]);

  const mountedRef = useRef(true);
  // Chống "tự reload" làm mất ô đang gõ: nếu kế toán đang focus 1 ô nhập trong
  // module thì HOÃN việc tải lại dữ liệu chỉnh sửa (inputs) sang lần realtime sau.
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Gộp bão realtime: backend bắn nhiều data:updated liên tiếp (điểm danh, lịch,
  // pull Sheets 15s...) — mỗi event một lần refresh sẽ nhấp nháy bảng & đốt API.
  // Gộp về 1 lần refresh "trailing" 2s, chỉ khi đang ở tab cần dữ liệu đó.
  const refreshTimerRef = useRef<any>(null);
  const api = useCallback((path: string, opts?: RequestInit) => apiRequest(path, opts), []);
  const post = useCallback((path: string, body: any, extra?: any) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), ...extra } as any), [api]);
  const put = useCallback((path: string, body: any) => api(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }), [api]);

  // Fix ReferenceError: Cannot access 'Bt' before initialization (TDZ):
  // Loaders MUST be declared BEFORE refreshCurrentTab / handleRealtime that
  // list them in their useCallback dependency arrays.
  const loadWorkflow = useCallback(async () => { try { setWorkflow(await api(`/payroll/workflow-status?period=${encodeURIComponent(month)}`)); } catch { setWorkflow(null); } }, [api, month]);
  const loadRuns = useCallback(async () => { setRunsLoading(true); try { const d = await api('/payroll/runs'); setRuns(Array.isArray(d) ? d : []); } catch { setRuns([]); } finally { setRunsLoading(false); } }, [api]);
  const loadSlips = useCallback(async () => { setSlipsLoading(true); try { const d = await api(`/payroll/period-slips/${encodeURIComponent(month)}`); setSlips((d as any)?.slips || []); } catch { setSlips([]); } finally { setSlipsLoading(false); } }, [api, month]);
  const loadFinSheet = useCallback(async () => { setFinSheetLoading(true); try { const fs = await api(`/admin/reports/finance-timesheet?period=${encodeURIComponent(month)}&branchScope=*`); setFinSheet(fs); if (activeTab === 'fin-dashboard') { try { setFinSheetSync(await api('/payroll/sync-status')); } catch { setFinSheetSync(null); } } } catch { setFinSheet(null); } finally { setFinSheetLoading(false); } }, [api, activeTab, month]);
  const loadFormula = useCallback(async () => { try { setFormula(await api(`/payroll/formula/${encodeURIComponent(month)}`)); } catch { setFormula(null); } }, [api, month]);
  const loadInputs = useCallback(async () => { setInputsLoading(true); try { const arr: any[] = await api(`/payroll/inputs/${encodeURIComponent(month)}`); setInputs((Array.isArray(arr) ? arr : []).map((i: any) => ({ ...i, note: String(i?.note ?? '') }))); } catch { setInputs([]); } finally { setInputsLoading(false); } }, [api, month]);
  const loadDriveStatus = useCallback(async () => { try { const st = await api(`/payroll/drive-sync/status?period=${encodeURIComponent(month)}`); setSyncStatus(st); setDriveConfigured(!!st?.configured); } catch { setDriveConfigured(false); } }, [api, month]);

  /** Đang có ô nhập liệu trong module được focus → không clobber dữ liệu đang gõ. */
  const isUserEditing = useCallback(() => {
    try {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') && !!rootRef.current?.contains(el);
    } catch { return false; }
  }, []);

  const refreshCurrentTab = useCallback(() => {
    loadWorkflow();
    if (['fin-timesheet', 'fin-bcc', 'fin-dashboard', 'fin-calculate', 'fin-payroll-sheet'].includes(activeTab)) loadFinSheet();
    if (['fin-payslips', 'fin-payment', 'fin-payroll-periods', 'fin-signatures'].includes(activeTab)) loadSlips();
    if (['fin-payroll-periods', 'fin-dashboard'].includes(activeTab)) loadRuns();
    if (activeTab === 'fin-calculate') { loadFormula(); if (!isUserEditing()) loadInputs(); }
    if (activeTab === 'fin-payment') loadSlips();
    // KHÔNG gọi onRefreshData (loadAllData 10 API của App) trong realtime nữa;
    // nút "Tải lại" trên topbar vẫn gọi onRefreshData như cũ.
  }, [activeTab, loadWorkflow, loadFinSheet, loadSlips, loadRuns, loadFormula, loadInputs, isUserEditing]);

  const handleRealtime = useCallback((evt: CustomEvent) => {
    const ent = (evt.detail as any)?.entity;
    if (!ent) return;
    const want = ent === 'payroll' || ent === 'payslips' || ent === 'all';
    const att = ent === 'attendance' || ent === 'shift' || ent === 'swap' || ent === 'leave' || ent === 'all';
    const needTimesheet = ['fin-timesheet', 'fin-bcc', 'fin-dashboard', 'fin-calculate', 'fin-payroll-sheet'].includes(activeTab);
    const needPayslip = ['fin-payslips', 'fin-payment', 'fin-payroll-periods', 'fin-signatures'].includes(activeTab);
    if ((want && needPayslip) || (att && needTimesheet)) {
      // Debounce trailing 2s: 10 sự kiện liên tiếp trong 2s chỉ refresh 1 lần.
      if (refreshTimerRef.current) return;
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        if (!mountedRef.current) return;
        refreshCurrentTab();
      }, 2000);
    }
  }, [activeTab, refreshCurrentTab]);

  useEffect(() => {
    window.addEventListener('ubm:fin-timesheet-reload', handleRealtime as any);
    window.addEventListener('ubm:payslips-reload', handleRealtime as any);
    window.addEventListener('data:updated', handleRealtime as any);
    return () => { mountedRef.current = false; if (refreshTimerRef.current) { clearTimeout(refreshTimerRef.current); refreshTimerRef.current = null; } window.removeEventListener('ubm:fin-timesheet-reload', handleRealtime as any); window.removeEventListener('ubm:payslips-reload', handleRealtime as any); window.removeEventListener('data:updated', handleRealtime as any); };
  }, [handleRealtime]);

  useEffect(() => {
    loadWorkflow();
    switch (activeTab) {
      case 'fin-dashboard': loadFinSheet(); loadRuns(); break;
      case 'fin-timesheet': case 'fin-bcc': case 'fin-calculate': case 'fin-payroll-sheet': loadFinSheet(); if (activeTab === 'fin-calculate') { loadFormula(); loadInputs(); } break;
      case 'fin-payroll-periods': loadRuns(); loadSlips(); break;
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
  const slipQrUrl = slipQrUrlOf;

  const fastSignLap = useCallback(async (itemId: string) => { try { await post(`/payroll/slips/${encodeURIComponent(itemId)}/fast-sign`, { lapName: 'Kế toán viên', lapImg: '', qlName: '', qlImg: '' }); showToast(`Đã ký lập phiếu ${itemId.replace('SLIP_', '')}`); refreshCurrentTab(); } catch (e: any) { showToast(e?.message || 'Ký lập thất bại'); } }, [post, showToast, refreshCurrentTab]);
  const publishSlip = useCallback(async (itemId: string) => { if (!window.confirm('Gửi phiếu này đến nhân viên? Sau khi gửi, nhân viên có thể ký xác nhận.')) return; try { await post(`/payroll/slips/${encodeURIComponent(itemId)}/publish`, {}); showToast('Đã gửi phiếu lương đến nhân viên'); refreshCurrentTab(); } catch (e: any) { showToast(e?.message || 'Gửi thất bại'); } }, [post, showToast, refreshCurrentTab]);
  const markPaidSlip = useCallback(async (itemId: string) => { if (!window.confirm('Xác nhận ĐÃ CHUYỂN KHOẢN? Phiếu sẽ bị KHÓA và đồng bộ PDF lên Google Drive.')) return; try { const r = await post(`/payroll/slips/${encodeURIComponent(itemId)}/mark-paid`, {}); showToast('Đã chuyển khoản — phiếu khóa & đồng bộ Drive' + (r?.driveSync?.ok ? ' ✓' : '')); refreshCurrentTab(); } catch (e: any) { showToast(e?.message || 'Thanh toán thất bại'); } }, [post, showToast, refreshCurrentTab]);
  const calendarLabel = useMemo(() => { const p = parsePeriod(month); return p ? `THÁNG ${String(p.month).padStart(2, '0')}` : 'THÁNG'; }, [month]);
  const syncMonthDrive = useCallback(async () => {
    if (!driveConfigured) { showToast('Google Drive chưa cấu hình trên server.'); return; }
    if (!window.confirm(`Đồng bộ TOÀN BỘ dữ liệu ${periodLabel(month)} lên Google Drive?\nHệ thống sẽ tự tạo cây thư mục: ${calendarLabel}_${month.slice(0, 4)}/* (Excel từng chức năng) + PHIEU_LUONG/${calendarLabel}/CN/TÊN NV/*.pdf`)) return;
    try {
      setLastSync({ pending: true });
      const r = await post('/payroll/drive-sync', { period: month });
      setLastSync(r);
      const errs = Array.isArray(r?.exportErrors) ? r.exportErrors : [];
      showToast(r?.ok ? `Đồng bộ xong: ${r?.slips?.pdfSynced ?? 0}/${r?.slips?.paid ?? 0} phiếu PDF${errs.length ? ` — ${errs.length} mục lỗi` : ''}` : 'Hoàn tất (có lỗi)');
      await loadDriveStatus();
      refreshCurrentTab();
    } catch (e: any) { setLastSync(null); showToast('Lỗi Drive: ' + (e?.message || '')); }
  }, [post, driveConfigured, month, showToast, loadDriveStatus, refreshCurrentTab, calendarLabel]);
  const syncSlipDrive = useCallback(async (itemId: string) => { try { const r = await post(`/payroll/slips/${encodeURIComponent(itemId)}/drive-sync`, {}); showToast(r?.ok ? 'Đã đồng bộ PDF phiếu lên Drive' : 'Lỗi: ' + (r?.error || '')); refreshCurrentTab(); } catch (e: any) { showToast('Lỗi: ' + (e?.message || '')); } }, [post, showToast, refreshCurrentTab]);
  const downloadSlipPdf = useCallback(async (itemId: string, employeeCode?: string) => {
    try {
      const base = getApiBase();
      const token = getAuthToken();
      const resp = await fetch(`${base}/payroll/slips/${encodeURIComponent(itemId)}/pdf`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!resp.ok) { const j = await resp.json().catch(() => ({})); throw new Error(j?.error || `HTTP ${resp.status}`); }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `PHIEU_LUONG_${month.replace('-', '')}_${employeeCode || itemId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) { showToast('Không tải được PDF: ' + (e?.message || '')); }
  }, [month, showToast]);
  const saveFormula = useCallback(async () => { try { await put(`/payroll/formula/${encodeURIComponent(month)}`, { rateTV: Number(formula?.rateTV) || 21000, rateCT: Number(formula?.rateCT) || 25500, otPerSlot: 0, otThreshold1: 10, otThreshold2: 15 }); showToast('Đã lưu công thức lương'); loadFormula(); } catch (e: any) { showToast(e?.message || 'Lưu công thức thất bại'); } }, [put, month, formula, showToast, loadFormula]);
  /** Payload chuẩn backend (employeeId camelCase + note string) từ ô đang sửa. */
  const buildInputPayload = useCallback((employeeId: string, field: string, value: string) => {
    const existing = (inputsRef.current || []).find((i: any) => i.employee_id === employeeId) || {};
    const payload: any = { employeeId, employee_id: employeeId, period: month, luong_cb: 0, ot_extra: 0, bonus_extra: 0, ung_luong: 0, tru_kpi: 0, dong_phuc: 0, note: '', ...existing };
    const num = Number(value);
    payload[field] = field === 'note' ? String(value ?? '') : (isNaN(num) ? 0 : num);
    payload.note = String(payload.note ?? '');
    payload.employeeId = employeeId;
    return payload;
  }, [month]);

  /** Gửi 1 ô đang chờ lên server (best-effort; lỗi thì trả lại hàng đợi để thử lại). */
  const flushInputKey = useCallback(async (key: string) => {
    const p = inputPendingRef.current.get(key);
    if (!p) return;
    inputPendingRef.current.delete(key);
    setPendingCount(inputPendingRef.current.size);
    const cur = (inputsRef.current || []).find((i: any) => i.employee_id === p.employeeId) || ({} as any);
    try {
      await put(`/payroll/inputs/${encodeURIComponent(month)}`, buildInputPayload(p.employeeId, p.field, String(cur[p.field] ?? '')));
      setInputsSavedAt(new Date());
    } catch (e: any) {
      inputPendingRef.current.set(key, p);
      setPendingCount(inputPendingRef.current.size);
      showToast(e?.message || 'Lưu nhập tay thất bại — sẽ thử lại khi bạn gõ tiếp');
    } finally {
      setInputsSaving(inputPendingRef.current.size > 0 || inputTimersRef.current.size > 0);
    }
  }, [put, month, buildInputPayload, showToast]);

  /** Gọi mỗi lần gõ phím: cập nhật local ngay + hẹn lưu server sau 800ms. */
  const upsertInput = useCallback((employeeId: string, field: string, value: string) => {
    const num = Number(value);
    const val = field === 'note' ? String(value ?? '') : (isNaN(num) ? 0 : num);
    setInputs((prev: any[]) => {
      const arr = Array.isArray(prev) ? [...prev] : [];
      const i = arr.findIndex(x => x.employee_id === employeeId);
      if (i >= 0) arr[i] = { ...arr[i], [field]: val };
      else arr.push({ employee_id: employeeId, employeeId, period: month, luong_cb: 0, ot_extra: 0, bonus_extra: 0, ung_luong: 0, tru_kpi: 0, dong_phuc: 0, note: field === 'note' ? String(value ?? '') : '', [field]: val });
      return arr;
    });
    const key = `${employeeId}|${field}`;
    inputPendingRef.current.set(key, { employeeId, field });
    setPendingCount(inputPendingRef.current.size);
    setInputsSaving(true);
    const t = inputTimersRef.current.get(key);
    if (t) clearTimeout(t);
    inputTimersRef.current.set(key, setTimeout(() => { inputTimersRef.current.delete(key); void flushInputKey(key); }, 800));
  }, [flushInputKey, month]);

  /** Flush mọi ô đang chờ (dùng cho nút Lưu tất cả + khi rời tab). */
  const flushAllPendingInputs = useCallback(async () => {
    for (const [, t] of inputTimersRef.current) clearTimeout(t);
    inputTimersRef.current.clear();
    const keys = [...inputPendingRef.current.keys()];
    for (const key of keys) { await flushInputKey(key); }
    return keys.length;
  }, [flushInputKey]);

  // Rời module / đổi tháng / đổi tab → flush mọi ô đang chờ (không mất dữ liệu)
  useEffect(() => () => {
    for (const [, t] of inputTimersRef.current) clearTimeout(t);
    for (const key of [...inputPendingRef.current.keys()]) {
      const p = inputPendingRef.current.get(key);
      if (!p) continue;
      const cur = (inputsRef.current || []).find((i: any) => i.employee_id === p.employeeId) || ({} as any);
      const payload = (() => {
        const existing = cur;
        const body: any = { employeeId: p.employeeId, employee_id: p.employeeId, period: month, luong_cb: 0, ot_extra: 0, bonus_extra: 0, ung_luong: 0, tru_kpi: 0, dong_phuc: 0, note: '', ...existing };
        const num = Number(cur[p.field]);
        body[p.field] = p.field === 'note' ? String(cur[p.field] ?? '') : (isNaN(num) ? 0 : num);
        body.note = String(body.note ?? '');
        return body;
      })();
      // fire-and-forget khi unmount
      try { apiRequest(`/payroll/inputs/${encodeURIComponent(month)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => null); } catch { /* ignore */ }
    }
    inputPendingRef.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const saveAllInputs = useCallback(async () => {
    const flushed = await flushAllPendingInputs();
    showToast(flushed > 0 ? `Đã lưu ${flushed} ô đang chờ` : 'Không có thay đổi chờ lưu — mọi ô đã tự lưu realtime');
  }, [flushAllPendingInputs, showToast]);
  /** Tính lương kỳ (công thức Excel) + tạo/cập nhật phiếu — thay cho nút "Tính lương" bị thiếu ở bản cũ. */
  const runCalculate = useCallback(async () => {
    if (!window.confirm(`TÍNH LƯƠNG ${periodLabel(month)} theo CÔNG THỨC EXCEL?\nTỔNG CỘNG = LCB + giờ công + OT thêm + Bonus; THỰC LÃNH = TỔNG CỘNG − KPI − phạt − ứng − đồng phục.\nHệ thống sẽ tạo/cập nhật kỳ lương và phiếu cho toàn bộ nhân viên.`)) return;
    setCalcBusy(true);
    try {
      const r: any = await post(`/payroll/${encodeURIComponent(month)}/calculate-formula`, { branchScope: '*' }, { _timeoutMs: 180000 });
      const res = r?.result ?? r;
      showToast(`Đã tính lương ${periodLabel(month)}: ${res?.run?.total_employees ?? '?'} NV — thực lãnh ${formatVND(res?.run?.total_amount || 0)}`);
      await post(`/payroll/period-slips/${encodeURIComponent(month)}/ensure`, { branchScope: '*' }, { _timeoutMs: 180000 }).catch(() => null);
      await Promise.all([loadSlips(), loadRuns(), loadWorkflow()]);
      refreshCurrentTab();
    } catch (e: any) { showToast(e?.message || 'Tính lương thất bại'); } finally { setCalcBusy(false); }
  }, [post, month, showToast, loadSlips, loadRuns, loadWorkflow, refreshCurrentTab]);

  const open = isTabOpen(activeTab);
  const lockReason = tabLocked.get(activeTab)?.reason || '';
  const firstOpenStep = useMemo(() => {
    for (const s of PROCESS_STEPS) { if (s.id === 'fin-dashboard') continue; if (isTabOpen(s.id)) return s.id; }
    return 'fin-dashboard';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow]);
  const goTab = useCallback((id: string) => { onNavigateTab?.(id); }, [onNavigateTab]);

  return (
    <div ref={rootRef} className="fin-shell">
      {/* ═══════════ TOPBAR ═══════════ */}
      <header className="fin-topbar">
        <div className="fin-brand">
          <div className="fin-logo" aria-hidden="true"><Wallet size={22} strokeWidth={2.2} /></div>
          <div>
            <div className="fin-title">Cổng Kế toán — Tính lương</div>
            <div className="fin-subtitle">Tài khoản: {currentUser?.fullName || 'Kế toán'} &nbsp;•&nbsp; Vai trò: {currentUser?.role} &nbsp;•&nbsp; UMB Milk HR</div>
          </div>
        </div>
        <div className="fin-topbar-right">
          <span className="fin-realtime" title="Socket.IO — tự cập nhật khi có sự kiện mới, không cần F5"><span className="fin-dot" /> REALTIME</span>
          <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={onRefreshData} title="Tải lại toàn bộ dữ liệu tháng đang chọn">
            <RefreshCw size={13} /> Tải lại
          </button>
        </div>
      </header>

      {/* ═══════════ THANH CHUYỂN DỮ LIỆU THÁNG ═══════════ */}
      <section className={`fin-monthbar${isCurrentMonth ? '' : ' is-past'}`} aria-label="Chọn tháng xử lý">
        <div className="fin-monthbar-left">
          <div className="fin-monthbar-icon">{isCurrentMonth ? <CalendarRange size={20} /> : <History size={20} />}</div>
          <div>
            <div className="fin-monthbar-label">KẾ TOÁN ĐANG XỬ LÝ</div>
            <div className="fin-monthbar-value">
              {periodLabel(month)}
              {isCurrentMonth
                ? <span className="fin-chip fin-chip-current">THÁNG HIỆN TẠI</span>
                : <span className="fin-chip fin-chip-past">DỮ LIỆU THÁNG CŨ</span>}
            </div>
          </div>
          <select className="fin-month-select" value={month} onChange={e => setMonth(e.target.value)} aria-label="Chọn tháng xử lý">
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {!isCurrentMonth ? (
          <button type="button" className="fin-btn fin-btn-amber" onClick={() => setMonth(curPeriod)}>
            <History size={14} /> Dùng dữ liệu hiện tại ({periodLabel(curPeriod)})
          </button>
        ) : (
          <div className="fin-monthbar-note">Dữ liệu realtime — tháng nào hiển thị tháng đó, không ảnh hưởng tháng khác.</div>
        )}
      </section>

      {!isCurrentMonth && (
        <div className="fin-past-banner" role="status">
          <Archive size={18} />
          <div>
            Bạn đang xử lý <b>{periodLabel(month)}</b>. Toàn bộ màn hình (đối soát, BCC, tính lương, phiếu lương, thanh toán) đang hiển thị <b>dữ liệu tháng này</b> — tháng hiện tại <b>{periodLabel(curPeriod)}</b> vẫn cập nhật bình thường ở chế độ nền, không bị ảnh hưởng.
            Khi xử lý xong, bấm <b>“Dùng dữ liệu hiện tại”</b> để quay về {periodLabel(curPeriod)} — lúc đó hệ thống sẽ nạp lại dữ liệu hiện tại.
          </div>
        </div>
      )}

      {/* ═══════════ DRIVE SYNC BAR ═══════════ */}
      <section className="fin-drivebar" aria-label="Đồng bộ Google Drive">
        <span className={`fin-drive-chip ${driveConfigured ? 'ok' : 'err'}`}><HardDrive size={12} /> DRIVE: {driveConfigured ? 'SẴN SÀNG' : 'CHƯA CẤU HÌNH'}</span>
        {syncStatus?.last && (
          <span className="fin-drive-meta">Đồng bộ gần nhất ({periodLabel(syncStatus?.last?.period || month)}): {fmtDateTime(syncStatus?.last?.at)} — {syncStatus?.last?.ok ? '✓ OK' : '✗ LỖI'}</span>
        )}
        <span className="fin-drive-path" title="Cấu trúc thư mục tự tạo trên Google Drive">PHIEU_LUONG → THANG_MM → CN… → TÊN NV → PDF&nbsp;&nbsp;|&nbsp;&nbsp;THANG_MM_YYYY/01…07_*.xlsx</span>
        <div className="fin-drive-actions">
          <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" disabled={!driveConfigured} onClick={syncMonthDrive}
            title="Tự tạo cây thư mục tháng + xuất Excel từng chức năng + PDF phiếu đã thanh toán lên Drive">
            <Upload size={13} /> Đồng bộ {calendarLabel.toLowerCase()} lên Drive
          </button>
        </div>
      </section>
      {(() => {
        const errs: string[] = (lastSync?.exportErrors?.length ? lastSync.exportErrors : (syncStatus?.last?.exportErrors || [])) as string[];
        if (!errs.length) return null;
        return (
          <div className="fin-warn" role="alert">
            <b>⚠ Một số file chưa đồng bộ được:</b>
            <ul style={{ margin: '6px 0 0 16px' }}>{errs.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>
          </div>
        );
      })()}

      {/* ═══════════ STEPPER QUY TRÌNH ═══════════ */}
      <nav className="fin-stepper-wrap" aria-label="Các bước xử lý lương">
        <div className="fin-stepper-title">
          <span>QUY TRÌNH KẾ TOÁN — XỬ LÝ TUẦN TỰ</span>
          <em>Bước sau chỉ mở khi bước trước hoàn tất</em>
        </div>
        <div className="fin-stepper">
          {PROCESS_STEPS.map(t => {
            const l = tabLocked.get(t.id);
            const locked = t.id === 'fin-dashboard' ? false : (l ? l.locked : false);
            const wfStep = workflow?.steps?.find((s: any) => s.id === t.id);
            const done = !!wfStep?.done;
            const cur = activeTab === t.id;
            const cls = locked ? 'is-locked' : done ? 'is-done' : cur ? 'is-current' : 'is-open';
            const Icon = t.icon;
            return (
              <button
                type="button"
                key={t.id}
                className={`fin-step ${cls}`}
                disabled={locked}
                onClick={() => goTab(t.id)}
                title={locked ? (l?.reason || 'Chưa mở khóa — hoàn tất bước trước') : t.label}
                aria-current={cur ? 'step' : undefined}
              >
                <span className="fin-step-dot">{done ? <Check size={15} strokeWidth={3} /> : locked ? <Lock size={13} /> : <Icon size={15} />}</span>
                <span className="fin-step-name">{t.step}. {t.label}</span>
                <span className="fin-step-status">{locked ? 'Đã khóa' : done ? '✓ Hoàn tất' : (wfStep?.stat || 'Đang xử lý')}</span>
              </button>
            );
          })}
        </div>
        <div className="fin-utilbar">
          <span className="fin-utilbar-label">TIỆN ÍCH &amp; CÀI ĐẶT</span>
          {UTIL_TABS.map(t => {
            const Icon = t.icon;
            const cur = activeTab === t.id;
            return (
              <button key={t.id} type="button" className={`fin-util-chip${cur ? ' is-active' : ''}`} onClick={() => goTab(t.id)}>
                <Icon size={12} /> {t.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ═══════════ LOCK SCREEN — KHÔNG render nội dung tab khi còn khóa ═══════════ */}
      {!open && (
        <div className="fin-lockscreen" role="alert">
          <div className="fin-lock-icon"><Lock size={30} /></div>
          <h3>Bước này đang bị khóa theo quy trình kế toán</h3>
          <p>{lockReason || 'Vui lòng hoàn tất các bước trước trong quy trình.'}</p>
          <button type="button" className="fin-btn fin-btn-dark" onClick={() => goTab(firstOpenStep)}>
            <ArrowRight size={14} /> Quay về bước đang xử lý
          </button>
        </div>
      )}

      {/* ═══════════ NỘI DUNG TAB ═══════════ */}
      {open && (
        <main style={{ flex: 1 }}>
          {activeTab === 'fin-dashboard' && <DashboardTab month={month} finSheet={finSheet} finSheetLoading={finSheetLoading} slips={slips} workflow={workflow} formatVND={formatVND} />}
          {activeTab === 'fin-timesheet' && <TimesheetTab month={month} finSheet={finSheet} finSheetLoading={finSheetLoading} loadFinSheet={loadFinSheet} formatVND={formatVND} />}
          {activeTab === 'fin-bcc' && <BccTab month={month} finSheet={finSheet} finSheetLoading={finSheetLoading} formatVND={formatVND} />}
          {activeTab === 'fin-calculate' && <CalculateTab month={month} formula={formula} setFormula={setFormula} inputs={inputs} inputsLoading={inputsLoading} allEmployees={allEmployees} saveFormula={saveFormula} upsertInput={upsertInput} saveAllInputs={saveAllInputs} loadFormula={loadFormula} loadInputs={loadInputs} runCalculate={runCalculate} calcBusy={calcBusy} runs={runs} inputsSaving={inputsSaving} pendingCount={pendingCount} inputsSavedAt={inputsSavedAt} />}
          {activeTab === 'fin-payroll-sheet' && <PayrollSheetTab month={month} slips={slips} allEmployees={allEmployees} formatVND={formatVND} stageBadge={stageBadge} />}
          {activeTab === 'fin-payroll-periods' && <PayrollPeriodsTab month={month} runs={runs} runsLoading={runsLoading} loadRuns={loadRuns} slips={slips} allEmployees={allEmployees} formatVND={formatVND} runCalculate={runCalculate} calcBusy={calcBusy} />}
          {activeTab === 'fin-payslips' && <PayslipsTab month={month} slips={slips} slipsLoading={slipsLoading} allEmployees={allEmployees} formatVND={formatVND} loadSlips={loadSlips} stageBadge={stageBadge} slipQrUrl={slipQrUrl} fastSignLap={fastSignLap} publishSlip={publishSlip} markPaidSlip={markPaidSlip} syncSlipDrive={syncSlipDrive} downloadSlipPdf={downloadSlipPdf} />}
          {activeTab === 'fin-payment' && <PaymentTab month={month} slips={slips} allEmployees={allEmployees} formatVND={formatVND} loadSlips={loadSlips} slipQrUrl={slipQrUrl} markPaidSlip={markPaidSlip} downloadSlipPdf={downloadSlipPdf} />}
          {activeTab === 'fin-signatures' && <SignatureTemplatesTab currentUser={currentUser} showToast={showToast} />}
          {activeTab === 'fin-rate-adjust' && <RateAdjustTab month={month} currentUser={currentUser} showToast={showToast} />}
          {activeTab === 'fin-bank-qr' && <BankQrTab allEmployees={allEmployees} month={month} />}
          {activeTab === 'bank-changes' && <BankChangesTab currentUser={currentUser} showToast={showToast} />}
          {activeTab === 'fin-salary-config' && <SalaryConfigView currentUser={currentUser} />}
          {activeTab === 'office-approvals' && <OfficeApprovalsView currentUser={currentUser} />}
        </main>
      )}
    </div>
  );
}

/* ============================================================================
   SHARED PIECES
   ============================================================================ */

function Kpi({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub: string; tone?: 'green' | 'blue' | 'violet' | 'amber' }) {
  return (
    <div className="fin-kpi">
      <div className={`fin-kpi-icon${tone ? ' ' + tone : ''}`}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div className="fin-kpi-label">{label}</div>
        <div className="fin-kpi-value">{value}</div>
        <div className="fin-kpi-sub">{sub}</div>
      </div>
    </div>
  );
}

function CardHead({ title, icon, sub, children }: { title: string; icon?: React.ReactNode; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="fin-card-head">
      <div>
        <div className="fin-card-title">{icon}{title}</div>
        {sub && <div className="fin-card-sub">{sub}</div>}
      </div>
      {children && <div className="fin-chips">{children}</div>}
    </div>
  );
}

function TabHead({ step, title, desc, children }: { step: number | string; title: string; desc: string; children?: React.ReactNode }) {
  return (
    <div className="fin-tab-head">
      <div>
        <div className="fin-tab-title"><span className="fin-tab-num">{step}</span>{title}</div>
        <div className="fin-tab-desc">{desc}</div>
      </div>
      {children && <div className="fin-chips">{children}</div>}
    </div>
  );
}

const matchesFilter = (q: string) => (row: any) => {
  if (!q) return true;
  const s = q.toLowerCase();
  return [row?.fullName, row?.full_name, row?.employeeCode, row?.employee_code, row?.branchId, branchLabelOf(row?.branchId || row?.default_branch_id)]
    .some(v => String(v || '').toLowerCase().includes(s));
};

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="fin-search" role="search">
      <Search size={14} color="#94a3b8" />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder || 'Tìm theo tên / mã NV / chi nhánh…'} aria-label="Tìm kiếm" />
      {value && <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" style={{ border: 'none', padding: 2 }} onClick={() => onChange('')} aria-label="Xóa tìm kiếm"><X size={14} /></button>}
    </div>
  );
}

function BranchBandRow({ label, count, cols, totalText }: { label: string; count: number; cols: number; totalText?: string }) {
  return (
    <tr className="fin-band">
      <td colSpan={cols}>
        <Building2 size={12} style={{ verticalAlign: -1, marginRight: 6 }} />
        {label}
        <span className="fin-band-count">{count} NV</span>
        {totalText && <span className="fin-band-total">{totalText}</span>}
      </td>
    </tr>
  );
}

const slipBranchId = (s: any, allEmployees: any[]) => {
  const emp = (allEmployees || []).find((e: any) => String(e.employee_id) === String(s?.employee_id));
  return emp?.default_branch_id || s?.branch_id || 'KHAC';
};

/* ============================================================================
   1 · DASHBOARD TÀI CHÍNH
   ============================================================================ */
function DashboardTab({ month, finSheet, finSheetLoading, slips, workflow, formatVND }: any) {
  const fs = finSheet;
  const rows: any[] = fs?.rows || [];
  const branchGroupsAll = useMemo(() => branchGroups(rows, (r: any) => r.branchId), [rows]);
  const publishedCount = slips.filter((s: any) => ['PUBLISHED', 'CONFIRMED', 'PAID'].includes(String(s?.status))).length;
  const blockEntries = Object.values(fs?.byBlock || {}) as any[];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TabHead step={1} title="Tổng quan Tài chính & Quỹ lương" desc={`Tổng quan kỳ ${periodLabel(month)} — quỹ lương, giờ công, tiến độ phiếu lương. Bấm vào từng bước trên thanh quy trình để xử lý tuần tự.`} />
      {finSheetLoading && <div className="fin-empty">Đang tải dữ liệu {periodLabel(month)}…</div>}
      {!finSheetLoading && (
        <div className="fin-kpi-grid">
          <Kpi icon={<Banknote size={18} />} label="Quỹ lương dự kiến" value={formatVND(fs?.totals?.totalAmount ?? fs?.totals?.netPay ?? 0)} sub="Tổng thực nhận kỳ" />
          <Kpi icon={<Clock size={18} />} tone="blue" label="Tổng giờ công" value={`${Number(fs?.totals?.hours ?? 0).toFixed(1)} giờ`} sub="Từ chấm công thực tế" />
          <Kpi icon={<Receipt size={18} />} tone="violet" label="Phiếu đã phát hành" value={`${publishedCount} / ${slips.length}`} sub="PUBLISHED + CONFIRMED + PAID" />
          <Kpi icon={<Activity size={18} />} tone="amber" label="Trạng thái kỳ" value={workflow?.steps?.find((s: any) => s.id === 'fin-payroll-periods')?.stat || '—'} sub="Theo workflow kỳ lương" />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 7fr)', gap: 12, alignItems: 'start' }} className="fin-dash-grid">
        {/* Khối */}
        <div className="fin-card">
          <CardHead title="Lương theo Khối" icon={<Users size={14} color="#E85D92" />} sub={`Kỳ ${periodLabel(month)}`} />
          <div className="fin-table-wrap" style={{ maxHeight: 'none' }}>
            <table className="fin-table">
              <thead>
                <tr><th>Khối</th><th className="num">NV</th><th className="num">Giờ</th><th className="num">T.Cộng</th><th className="num">Thực lĩnh</th></tr>
              </thead>
              <tbody>
                {blockEntries.map((b: any) => (
                  <tr key={b.key}>
                    <td style={{ fontWeight: 700 }}>{b.label}</td>
                    <td className="num">{b.employees}</td>
                    <td className="num">{Number(b.hours ?? 0).toFixed(1)}</td>
                    <td className="num fin-money">{formatVND(b.value ?? 0)}</td>
                    <td className="num fin-money" style={{ fontWeight: 800, color: 'var(--fin-green)' }}>{formatVND(b.netPay ?? 0)}</td>
                  </tr>
                ))}
                {blockEntries.length === 0 && <tr><td colSpan={5} className="fin-empty">Chưa có dữ liệu.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* Chi nhánh */}
        <div className="fin-card">
          <CardHead title="Lương theo Chi nhánh" icon={<Building2 size={14} color="#E85D92" />} sub="Gộp từ bảng chấm công kỳ này" />
          <div className="fin-table-wrap" style={{ maxHeight: 'none' }}>
            <table className="fin-table">
              <thead>
                <tr><th>Chi nhánh</th><th className="num">NV</th><th className="num">Giờ</th><th className="num">Lương ca</th><th className="num">Trừ</th><th className="num">Thực nhận</th></tr>
              </thead>
              <tbody>
                {branchGroupsAll.map(g => (
                  <React.Fragment key={g.id}>
                    <tr className="fin-band"><td colSpan={6}>{branchLabelOf(g.id)}<span className="fin-band-count">{g.rows.length} NV</span></td></tr>
                    <tr className="fin-subtotal">
                      <td>Cộng {branchLabelOf(g.id)}</td>
                      <td className="num">{g.rows.length}</td>
                      <td className="num">{r1(sumBy(g.rows, 'hours')).toFixed(1)}</td>
                      <td className="num fin-money">{formatVND(sumBy(g.rows, 'standardPay'))}</td>
                      <td className="num fin-money" style={{ color: 'var(--fin-red)' }}>{formatVND(sumBy(g.rows, 'deduction'))}</td>
                      <td className="num fin-money">{formatVND(sumBy(g.rows, 'netPay'))}</td>
                    </tr>
                  </React.Fragment>
                ))}
                {branchGroupsAll.length > 0 && (
                  <tr className="fin-grand"><td>TỔNG CỘNG</td><td className="num">{rows.length}</td><td className="num">{r1(sumBy(rows, 'hours')).toFixed(1)}</td><td className="num fin-money">{formatVND(sumBy(rows, 'standardPay'))}</td><td className="num fin-money">{formatVND(sumBy(rows, 'deduction'))}</td><td className="num fin-money">{formatVND(sumBy(rows, 'netPay'))}</td></tr>
                )}
                {branchGroupsAll.length === 0 && <tr><td colSpan={6} className="fin-empty">Chưa có dữ liệu chi nhánh.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <style>{`@media (max-width: 1100px) { .fin-dash-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

/* ============================================================================
   2 · ĐỐI SOÁT CÔNG & BẢNG CHẤM CÔNG
   ============================================================================ */
function TimesheetTab({ month, finSheet, finSheetLoading, loadFinSheet, formatVND }: any) {
  const fs = finSheet;
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const all: any[] = fs?.rows || [];
    const filtered = all.filter(matchesFilter(q.trim()));
    return branchGroups(filtered, (r: any) => r.branchId);
  }, [fs, q]);
  const filteredCount = groups.reduce((s, g) => s + g.rows.length, 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TabHead step={2} title="Đối soát công & Bảng chấm công" desc={`Tổng hợp ca/giờ/phạt theo nhân viên — kỳ ${periodLabel(month)}. Dữ liệu realtime từ chấm công + lịch đã phát hành.`}>
        <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" onClick={loadFinSheet} disabled={finSheetLoading}>{finSheetLoading ? <Loader2 size={13} className="fin-spin" /> : <RefreshCw size={13} />} Tải lại bảng công</button>
      </TabHead>
      <div className="fin-card">
        <CardHead title={`Kỳ ${periodLabel(month)} — ${fs?.fromDate || ''} → ${fs?.toDate || ''}`} icon={<FileSpreadsheet size={14} color="#E85D92" />} sub={fs ? `${fs?.totals?.employees ?? 0} NV • ${fs?.totals?.totalShifts ?? 0} ca • ${Number(fs?.totals?.hours ?? 0).toFixed(1)} giờ` : 'Chưa có dữ liệu'}>
          <SearchBox value={q} onChange={setQ} />
          {q && <span className="fin-chip-stat">{filteredCount} kết quả</span>}
        </CardHead>
        {finSheetLoading ? (
          <div className="fin-empty">Đang tải bảng chấm công {periodLabel(month)}…</div>
        ) : (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr><th>Họ tên</th><th>Mã NV</th><th>Chi nhánh</th><th className="num">Ca đủ</th><th className="num">Thiếu</th><th className="num">Vắng</th><th className="num">Giờ công</th><th className="num">Lương ca</th><th className="num">Trừ</th><th className="num">THỰC NHẬN</th></tr>
              </thead>
              <tbody>
                {groups.map(g => {
                  const gh = r1(sumBy(g.rows, 'hours'));
                  const gNet = sumBy(g.rows, 'netPay');
                  return (
                    <React.Fragment key={g.id}>
                      <BranchBandRow label={branchLabelOf(g.id)} count={g.rows.length} cols={10} totalText={`${gh.toFixed(1)} giờ • ${formatVND(gNet)}`} />
                      {g.rows.map((r: any) => (
                        <tr key={r.employeeId}>
                          <td style={{ fontWeight: 700 }}>{r.fullName}</td>
                          <td className="ctr fin-mono">{r.employeeCode}</td>
                          <td>{branchLabelOf(r.branchId)}</td>
                          <td className="num">{r.full ?? 0}</td>
                          <td className="num" style={{ color: '#92400e' }}>{r.partial ?? 0}</td>
                          <td className="num" style={{ color: 'var(--fin-red)', fontWeight: 800 }}>{r.absent ?? 0}</td>
                          <td className="num">{Number(r.hours ?? 0).toFixed(1)}</td>
                          <td className="num fin-money">{formatVND(r.standardPay)}</td>
                          <td className="num fin-money" style={{ color: 'var(--fin-red)' }}>{formatVND(r.deduction)}</td>
                          <td className="num fin-money" style={{ fontWeight: 800, color: 'var(--fin-green)' }}>{formatVND(r.netPay)}</td>
                        </tr>
                      ))}
                      <tr className="fin-subtotal">
                        <td colSpan={3}>CỘNG {branchLabelOf(g.id).toUpperCase()}</td>
                        <td className="num">{sumBy(g.rows, 'full')}</td>
                        <td className="num">{sumBy(g.rows, 'partial')}</td>
                        <td className="num">{sumBy(g.rows, 'absent')}</td>
                        <td className="num">{gh.toFixed(1)}</td>
                        <td className="num fin-money">{formatVND(sumBy(g.rows, 'standardPay'))}</td>
                        <td className="num fin-money">{formatVND(sumBy(g.rows, 'deduction'))}</td>
                        <td className="num fin-money">{formatVND(gNet)}</td>
                      </tr>
                    </React.Fragment>
                  );
                })}
                {groups.length === 0 && <tr><td colSpan={10} className="fin-empty">{q ? 'Không tìm thấy nhân viên phù hợp.' : 'Chưa có dữ liệu chấm công tháng này.'}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
   3 · BCC — BẢNG CÔNG TỪNG NGÀY (nhóm chi nhánh, accordion từng NV)
   ============================================================================ */
const STATUS_META: Record<string, { l: string; cls: string }> = {
  DU: { l: 'Đủ', cls: 'fin-status-DU' },
  VANG: { l: 'Vắng', cls: 'fin-status-VANG' },
  THIEU: { l: 'Thiếu chấm', cls: 'fin-status-THIEU' },
};

function BccTab({ month, finSheet, finSheetLoading, formatVND }: any) {
  const fs = finSheet;
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const all: any[] = fs?.rows || [];
    return branchGroups(all.filter(matchesFilter(q.trim())), (r: any) => r.branchId);
  }, [fs, q]);
  const fmtTime = (v: any) => {
    if (!v) return '—';
    const t = String(v);
    const d = new Date(t.length > 12 && /^\d+$/.test(t) ? Number(t) : t);
    return Number.isFinite(d.getTime()) ? d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—';
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TabHead step={3} title="BCC — Bảng công từng ngày" desc={`Chi tiết check-in/out, giờ, lương ca, trễ/vắng từng ngày — kỳ ${periodLabel(month)}. Mở từng nhân viên để xem chi tiết.`}>
        <SearchBox value={q} onChange={setQ} />
      </TabHead>
      {finSheetLoading ? (
        <div className="fin-empty">Đang tải bảng công {periodLabel(month)}…</div>
      ) : !fs ? (
        <div className="fin-empty">Chưa có dữ liệu công tháng này.</div>
      ) : (
        groups.map(g => (
          <div key={g.id} className="fin-card fin-bcc-branch">
            <div className="fin-bcc-branch-head">
              <span><Building2 size={13} style={{ verticalAlign: -2, marginRight: 6 }} />{branchLabelOf(g.id)}</span>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'none', letterSpacing: 0 }}>
                {g.rows.length} NV • {r1(sumBy(g.rows, 'hours')).toFixed(1)} giờ • {formatVND(sumBy(g.rows, 'netPay'))}
              </span>
            </div>
            <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {g.rows.map((r: any) => (
                <details key={r.employeeId} className="fin-details">
                  <summary>
                    <span style={{ fontWeight: 800 }}>{r.fullName} <span style={{ color: '#94a3b8', fontWeight: 600 }}>({r.employeeCode})</span></span>
                    <span className="fin-kv" style={{ color: '#2563eb' }}><b>{Number(r.hours ?? 0).toFixed(1)}</b> giờ</span>
                    <span className="fin-kv" style={{ color: '#166534' }}>Đủ {r.full || 0}</span>
                    <span className="fin-kv" style={{ color: '#92400e' }}>Thiếu {r.partial || 0}</span>
                    <span className="fin-kv" style={{ color: '#b91c1c' }}>Vắng {r.absent || 0}</span>
                    <span className="fin-kv" style={{ color: '#166534', marginLeft: 'auto' }}><b>{formatVND(r.netPay ?? r.standardPay ?? 0)}</b></span>
                  </summary>
                  <div className="fin-details-body">
                    <table className="fin-mini-table">
                      <thead>
                        <tr><th>Ngày</th><th>Ca</th><th style={{ textAlign: 'center' }}>Giờ</th><th>Trạng thái</th><th>Check-in</th><th style={{ textAlign: 'right' }}>Trễ (phút)</th><th style={{ textAlign: 'right' }}>Lương ca</th><th style={{ textAlign: 'right' }}>Phạt/Trừ</th></tr>
                      </thead>
                      <tbody>
                        {(r.shifts || []).map((d: any, idx: number) => {
                          const meta = STATUS_META[String(d.status || '')] || { l: d.status || '—', cls: '' };
                          return (
                            <tr key={`${r.employeeId}-${idx}`}>
                              <td style={{ fontWeight: 700 }}>{String(d.date || '').slice(0, 10)}</td>
                              <td>{d.shiftCode || '—'}{d.branchId ? <span style={{ color: '#94a3b8' }}> ({branchLabelOf(d.branchId)})</span> : null}</td>
                              <td style={{ textAlign: 'center' }}>{Number(d.hours ?? 0).toFixed(1)}</td>
                              <td className={meta.cls}>{meta.l}</td>
                              <td>{fmtTime(d.checkIn)}</td>
                              <td style={{ textAlign: 'right', color: (d.lateMin || 0) > 0 ? 'var(--fin-red)' : 'inherit' }}>{d.lateMin || 0}</td>
                              <td style={{ textAlign: 'right' }} className="fin-money">{formatVND(d.shiftPay || 0)}</td>
                              <td style={{ textAlign: 'right', color: (d.fineAmount || 0) > 0 ? 'var(--fin-red)' : 'inherit' }} className="fin-money">{formatVND(d.fineAmount || 0)}</td>
                            </tr>
                          );
                        })}
                        {(r.shifts || []).length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--fin-muted)', padding: 10 }}>Không có ca trong kỳ.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))}
              {g.rows.length === 0 && <div className="fin-empty">Không có nhân viên phù hợp.</div>}
            </div>
          </div>
        ))
      )}
      {groups.length === 0 && !finSheetLoading && fs && <div className="fin-empty">Không tìm thấy nhân viên phù hợp.</div>}
    </div>
  );
}

/* ============================================================================
   4 · TÍNH LƯƠNG — CÔNG THỨC & NHẬP TAY (+ NÚT TÍNH LƯƠNG)
   ============================================================================ */
function CalculateTab({ month, formula, setFormula, inputs, inputsLoading, allEmployees, saveFormula, upsertInput, saveAllInputs, loadFormula, loadInputs, runCalculate, calcBusy, runs, inputsSaving, pendingCount, inputsSavedAt }: any) {
  const [q, setQ] = useState('');
  const latestRun = useMemo(() => (Array.isArray(runs) ? runs : []).filter((r: any) => r.period === month).sort((a: any, b: any) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')))[0] || null, [runs, month]);
  const groups = useMemo(() => {
    const filtered = (allEmployees || []).filter(matchesFilter(q.trim()));
    return branchGroups(filtered, (e: any) => e.default_branch_id);
  }, [allEmployees, q]);
  const inputTotals = useMemo(() => ({
    lcb: sumBy(inputs, 'luong_cb'), ot: sumBy(inputs, 'ot_extra'), bonus: sumBy(inputs, 'bonus_extra'),
    ung: sumBy(inputs, 'ung_luong'), kpi: sumBy(inputs, 'tru_kpi'), dp: sumBy(inputs, 'dong_phuc'),
  }), [inputs]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TabHead step={4} title="Tính lương — Công thức & Nhập tay" desc={`Lưu công thức kỳ, nhập liệu tay từng NV, rồi bấm TÍNH LƯƠNG để sinh kỳ + phiếu. Kỳ ${periodLabel(month)}.`}>
        <SearchBox value={q} onChange={setQ} />
      </TabHead>

      {/* Nút tính lương — tạo kỳ + phiếu cho toàn bộ NV */}
      <div className="fin-card" style={{ border: '1.5px solid var(--fin-brand-line)', background: 'linear-gradient(120deg, #fff 0%, #fdf2f7 100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 18px', flexWrap: 'wrap' }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--fin-brand)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 16px rgba(232,93,146,.45)' }}>
            <Calculator size={26} />
          </div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--fin-ink)' }}>TÍNH LƯƠNG {periodLabel(month).toUpperCase()} — SINH KỲ &amp; PHIẾU</div>
            <div style={{ fontSize: 11, color: 'var(--fin-muted)', marginTop: 2, lineHeight: 1.5 }}>
              Chạy công thức Excel trên toàn bộ NV (LCB + giờ công × đơn giá + OT + Bonus − KPI − phạt − ứng − đồng phục).
              {latestRun
                ? <> Kỳ gần nhất: <b>{latestRun.run_id}</b> — trạng thái <b>{latestRun.status}</b>. Bấm lại sẽ TÍNH LẠI và tạo kỳ mới.</>
                : <> Chưa có kỳ lương cho tháng này — bấm nút bên phải để tạo.</>}
            </div>
          </div>
          <button type="button" className="fin-btn fin-btn-primary" style={{ fontSize: 13, padding: '12px 20px' }} onClick={runCalculate} disabled={calcBusy}>
            {calcBusy ? <Loader2 size={16} className="fin-spin" /> : <Calculator size={16} />} {calcBusy ? 'Đang tính…' : 'TÍNH LƯƠNG NGAY'}
          </button>
        </div>
      </div>

      {/* Công thức */}
      <div className="fin-card">
        <CardHead title={`Công thức kỳ ${periodLabel(month)}`} icon={<Settings2 size={14} color="#E85D92" />} sub="Dùng cho cả BẢNG TỔNG HỢP, TÍNH LƯƠNG và PHIẾU từng NV" />
        <div style={{ padding: '14px 16px', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 210 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--fin-muted)', letterSpacing: .6, textTransform: 'uppercase' }}>Đơn giá giờ THỬ VIỆC (đ)</span>
            <input type="number" className="fin-input" value={formula?.rateTV ?? ''} onChange={e => setFormula({ ...formula, rateTV: Number(e.target.value) || 0 })} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 210 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--fin-muted)', letterSpacing: .6, textTransform: 'uppercase' }}>Đơn giá giờ CHÍNH THỨC (đ)</span>
            <input type="number" className="fin-input" value={formula?.rateCT ?? ''} onChange={e => setFormula({ ...formula, rateCT: Number(e.target.value) || 0 })} />
          </label>
          <button type="button" className="fin-btn fin-btn-dark" onClick={saveFormula} disabled={inputsLoading}><Save size={14} /> Lưu công thức</button>
        </div>
      </div>

      {/* Nhập tay theo chi nhánh */}
      <div className="fin-card">
        <CardHead title="Nhập liệu tay theo kỳ" icon={<FileSpreadsheet size={14} color="#E85D92" />} sub="Nhóm theo chi nhánh — tự động lưu 0,8s sau khi ngừng gõ"
          >
          {inputsSaving
            ? <span className="fin-chip-stat" style={{ borderColor: '#fcd34d', background: '#fffbeb', color: '#92400e' }}><Loader2 size={11} className="fin-spin" style={{ verticalAlign: -1 }} /> Đang lưu {pendingCount} ô…</span>
            : inputsSavedAt
              ? <span className="fin-chip-stat" style={{ borderColor: '#86efac', background: '#f0fdf4', color: '#166534' }}>✓ Đã lưu lúc {inputsSavedAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              : <span className="fin-chip-stat">Chưa có thay đổi</span>}
          <span className="fin-chip-stat">LCB {formatVND(inputTotals.lcb)}</span>
          <span className="fin-chip-stat">OT {formatVND(inputTotals.ot)}</span>
          <span className="fin-chip-stat">Bonus {formatVND(inputTotals.bonus)}</span>
          <span className="fin-chip-stat">Ứng {formatVND(inputTotals.ung)}</span>
        </CardHead>
        <div className="fin-table-wrap" style={{ maxHeight: '62vh' }}>
          <table className="fin-table" style={{ minWidth: 1080 }}>
            <thead>
              <tr><th>Mã NV</th><th>Họ tên</th><th className="num">LCB</th><th className="num">OT thêm</th><th className="num">Bonus</th><th className="num">Ứng lương</th><th className="num">Trừ KPI</th><th className="num">Trừ ĐP</th><th style={{ minWidth: 280 }}>Ghi chú (nhiều dòng)</th></tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <React.Fragment key={g.id}>
                  <BranchBandRow label={branchLabelOf(g.id)} count={g.rows.length} cols={9} />
                  {g.rows.map((emp: any) => {
                    const inp = inputs.find((i: any) => i.employee_id === emp.employee_id) || {};
                    const cell = (field: string, width = '100%') => (
                      <input type="number" className="fin-input" style={{ width, padding: '5px 7px', fontSize: 11.5 }}
                        value={inp[field] ?? ''} onChange={v => upsertInput(emp.employee_id, field, v.target.value)} aria-label={field} />
                    );
                    return (
                      <tr key={emp.employee_id}>
                        <td className="ctr fin-mono">{emp.employee_code}</td>
                        <td style={{ fontWeight: 700 }}>{emp.full_name}</td>
                        <td className="num">{cell('luong_cb')}</td>
                        <td className="num">{cell('ot_extra')}</td>
                        <td className="num">{cell('bonus_extra')}</td>
                        <td className="num">{cell('ung_luong')}</td>
                        <td className="num">{cell('tru_kpi')}</td>
                        <td className="num">{cell('dong_phuc')}</td>
                        <td>
                          <textarea className="fin-input" rows={2} value={inp.note ?? ''} onChange={v => upsertInput(emp.employee_id, 'note', v.target.value)} placeholder="Ghi chú… (nhiều dòng)" aria-label="Ghi chú" style={{ fontSize: 11.5, padding: '6px 8px', resize: 'vertical', minHeight: 42, lineHeight: 1.4, whiteSpace: 'pre-wrap' }} />
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
              {groups.length === 0 && <tr><td colSpan={9} className="fin-empty">{q ? 'Không tìm thấy nhân viên phù hợp.' : 'Chưa có nhân viên.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, color: 'var(--fin-muted)' }}>Tự lưu 0,8s sau khi ngừng gõ · Sheets cập nhật gom 1 lượt sau 20s · Tổng trích: KPI <b className="fin-money">{formatVND(inputTotals.kpi)}</b> • Đồng phục <b className="fin-money">{formatVND(inputTotals.dp)}</b></span>
          <button type="button" className="fin-btn fin-btn-dark fin-btn-sm" onClick={saveAllInputs} disabled={inputsLoading || pendingCount === 0 && !inputsSaving}><Save size={13} /> Lưu tất cả nhập tay{pendingCount > 0 ? ` (${pendingCount})` : ''}</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   5 · PAYMENT — BẢNG LƯƠNG THÁNG (nhóm chi nhánh + subtotal)
   ============================================================================ */
function PayrollSheetTab({ month, slips, allEmployees, formatVND, stageBadge }: any) {
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const filtered = (slips || []).filter(matchesFilter(q.trim()));
    return branchGroups(filtered, (s: any) => slipBranchId(s, allEmployees));
  }, [slips, allEmployees, q]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TabHead step={5} title="Payment — Bảng lương tháng" desc={`Bảng lương tổng hợp theo từng chi nhánh — kỳ ${periodLabel(month)}. Dữ liệu phiếu đã tạo (cột THỰC LÃNH gồm cả LCB, giờ công, OT, bonus − khấu trừ).`}>
        <SearchBox value={q} onChange={setQ} />
      </TabHead>
      <div className="fin-card">
        <CardHead title={`Kỳ ${periodLabel(month)} — Bảng lương theo chi nhánh`} icon={<FileText size={14} color="#E85D92" />} sub={`${slips.length} phiếu`}>
          <span className="fin-chip-stat">Tổng thực lãnh: {formatVND(sumBy(slips || [], 'thuc_lanh') || sumBy(slips || [], 'net_pay'))}</span>
        </CardHead>
        <div className="fin-table-wrap">
          <table className="fin-table" style={{ minWidth: 1150 }}>
            <thead>
              <tr><th>Họ tên</th><th>Mã NV</th><th>Chi nhánh</th><th className="num">LCB</th><th className="num">OT</th><th className="num">Bonus</th><th className="num">Tổng cộng</th><th className="num">Khấu trừ</th><th className="num">Ứng</th><th className="num">THỰC LÃNH</th><th>Trạng thái</th></tr>
            </thead>
            <tbody>
              {groups.map(g => {
                const gThuc = g.rows.reduce((s: number, r: any) => s + (Number(r.thuc_lanh ?? r.net_pay) || 0), 0);
                return (
                  <React.Fragment key={g.id}>
                    <BranchBandRow label={branchLabelOf(g.id)} count={g.rows.length} cols={11} totalText={`THỰC LÃNH ${formatVND(gThuc)}`} />
                    {g.rows.map((s: any) => {
                      const kpi = (Number(s.tru_kpi) || 0) + (Number(s.deduction) || 0);
                      const tongCong = Number(s.tong_cong) || ((Number(s.standard_pay) || 0) + (Number(s.luong_cb) || 0) + (Number(s.ot_extra) || 0) + (Number(s.bonus) || 0));
                      const thuc = Number(s.thuc_lanh ?? s.net_pay) || 0;
                      const st = stageBadge(s.stage ?? s.status);
                      return (
                        <tr key={s.item_id}>
                          <td style={{ fontWeight: 700 }}>{s.full_name}</td>
                          <td className="ctr fin-mono">{s.employee_code}</td>
                          <td>{branchLabelOf(slipBranchId(s, allEmployees))}</td>
                          <td className="num fin-money">{formatVND(s.luong_cb)}</td>
                          <td className="num fin-money">{formatVND(s.ot_extra)}</td>
                          <td className="num fin-money">{formatVND(s.bonus)}</td>
                          <td className="num fin-money" style={{ fontWeight: 700 }}>{formatVND(tongCong)}</td>
                          <td className="num fin-money" style={{ color: 'var(--fin-red)' }}>{formatVND(kpi)}</td>
                          <td className="num fin-money" style={{ color: 'var(--fin-red)' }}>{formatVND(s.ung_luong)}</td>
                          <td className="num fin-money" style={{ fontWeight: 800, color: 'var(--fin-green)' }}>{formatVND(thuc)}</td>
                          <td><span className="fin-badge" style={{ color: st.fg, background: st.bg, borderColor: st.border }}><span className="fin-badge-dot" />{st.label}</span></td>
                        </tr>
                      );
                    })}
                    <tr className="fin-subtotal">
                      <td colSpan={9}>CỘNG {branchLabelOf(g.id).toUpperCase()}</td>
                      <td className="num fin-money">{formatVND(gThuc)}</td>
                      <td />
                    </tr>
                  </React.Fragment>
                );
              })}
              {groups.length === 0 && <tr><td colSpan={11} className="fin-empty">{q ? 'Không tìm thấy phiếu phù hợp.' : 'Chưa có bảng lương tháng này — hãy TÍNH LƯƠNG ở tab 4.'}</td></tr>}
            </tbody>
          </table>
        </div>
        {slips.length > 0 && (
          <div style={{ padding: '10px 16px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end' }}>
            <span className="fin-chip-stat" style={{ fontSize: 11 }}>TỔNG THỰC LÃNH TOÀN CÔNG TY: {formatVND(sumBy(slips || [], 'thuc_lanh') || sumBy(slips || [], 'net_pay'))}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
   6 · KỲ LƯƠNG — PHÂN THEO CHI NHÁNH + VÒNG ĐỜI KỲ
   ============================================================================ */
const RUN_STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  DRAFT: { bg: '#F1F5F9', fg: '#475569', label: 'Nháp' },
  RECONCILED: { bg: '#EFF6FF', fg: '#1D4ED8', label: 'Đã đối soát' },
  APPROVED: { bg: '#F5F3FF', fg: '#7C3AED', label: 'Đã duyệt' },
  PUBLISHED: { bg: '#ECFDF5', fg: '#047857', label: 'Đã phát hành' },
  PAID: { bg: '#DCFCE7', fg: '#166534', label: 'ĐÃ THANH TOÁN' },
  CONFIRMED: { bg: '#FEF9C3', fg: '#854D0E', label: 'Đã xác nhận' },
};

function PayrollPeriodsTab({ month, runs, runsLoading, loadRuns, slips, allEmployees, formatVND, runCalculate, calcBusy }: any) {
  const monthRuns = useMemo(() => (Array.isArray(runs) ? runs : []).filter((r: any) => r.period === month).sort((a: any, b: any) => String(b?.created_at || '').localeCompare(String(a?.created_at || ''))), [runs, month]);
  const latest = monthRuns[0] || null;
  // Tổng hợp theo CHI NHÁNH từ phiếu của kỳ (số liệu sống)
  const byBranch = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const s of slips || []) {
      const k = String(slipBranchId(s, allEmployees) || 'KHAC');
      const arr = map.get(k);
      if (arr) arr.push(s); else map.set(k, [s]);
    }
    return orderedBranchKeys(map.keys()).map(k => ({ id: k, rows: map.get(k)! }));
  }, [slips, allEmployees]);
  const grandThuc = (slips || []).reduce((s: number, x: any) => s + (Number(x?.thuc_lanh ?? x?.net_pay) || 0), 0);
  const grandHours = (slips || []).reduce((s: number, x: any) => s + (Number(x?.standard_hours) || 0), 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TabHead step={6} title="Kỳ lương — DRAFT → PAID" desc={`Vòng đời kỳ lương ${periodLabel(month)}: tính → đối soát → duyệt → phát hành → thanh toán. Bảng dưới gộp theo TỪNG CHI NHÁNH.`}>
        <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={loadRuns}><RefreshCw size={13} /> Tải lại</button>
        <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" onClick={runCalculate} disabled={calcBusy} title="Tính lại kỳ (tạo kỳ mới — không mất dữ liệu kỳ cũ)">
          {calcBusy ? <Loader2 size={13} className="fin-spin" /> : <Calculator size={13} />} {latest ? 'Tính lại kỳ' : 'Tính lương ngay'}
        </button>
      </TabHead>

      {/* Bảng tổng hợp THEO CHI NHÁNH */}
      <div className="fin-card">
        <CardHead title={`Kỳ ${periodLabel(month)} — Tổng hợp theo chi nhánh`} icon={<Building2 size={14} color="#E85D92" />} sub="Gộp từ phiếu của kỳ đang hiển thị">
          <span className="fin-chip-stat">{(slips || []).length} phiếu</span>
          <span className="fin-chip-stat">{r1(grandHours).toFixed(1)} giờ</span>
          <span className="fin-chip-stat">THỰC LÃNH {formatVND(grandThuc)}</span>
        </CardHead>
        {runsLoading && slips.length === 0 ? (
          <div className="fin-empty">Đang tải kỳ lương…</div>
        ) : byBranch.length === 0 ? (
          <div className="fin-empty">
            <Inbox size={28} style={{ margin: '0 auto 8px', color: '#cbd5e1' }} />
            <div style={{ fontWeight: 800, color: 'var(--fin-ink)', marginBottom: 4 }}>Chưa có phiếu lương cho {periodLabel(month)}</div>
            <div style={{ marginBottom: 12 }}>Bấm “Tính lương ngay” ở góc phải trên — hệ thống sẽ sinh kỳ và phiếu cho toàn bộ nhân viên.</div>
            <button type="button" className="fin-btn fin-btn-primary" onClick={runCalculate} disabled={calcBusy}>{calcBusy ? <Loader2 size={15} className="fin-spin" /> : <Calculator size={15} />} TÍNH LƯƠNG NGAY</button>
          </div>
        ) : (
          <div className="fin-table-wrap">
            <table className="fin-table" style={{ minWidth: 1060 }}>
              <thead>
                <tr><th>Chi nhánh</th><th className="num">NV</th><th className="num">Giờ công</th><th className="num">Lương ca</th><th className="num">TỔNG CỘNG</th><th className="num">THỰC LÃNH</th><th className="ctr">Đã ký NV</th><th className="ctr">Đã chuyển</th><th>Tiến độ</th></tr>
              </thead>
              <tbody>
                {byBranch.map(g => {
                  const rows = g.rows;
                  const hours = r1(sumBy(rows, 'standard_hours'));
                  const stdPay = sumBy(rows, 'standard_pay');
                  const tongCong = rows.reduce((s: number, x: any) => s + (Number(x.tong_cong) || ((Number(x.standard_pay) || 0) + (Number(x.luong_cb) || 0) + (Number(x.ot_extra) || 0) + (Number(x.bonus) || 0))), 0);
                  const thuc = rows.reduce((s: number, x: any) => s + (Number(x.thuc_lanh ?? x.net_pay) || 0), 0);
                  const signed = rows.filter((x: any) => ['CONFIRMED', 'PAID'].includes(String(x.status))).length;
                  const paid = rows.filter((x: any) => String(x.status) === 'PAID').length;
                  const pct = rows.length ? Math.round((paid / rows.length) * 100) : 0;
                  return (
                    <tr key={g.id}>
                      <td style={{ fontWeight: 800 }}><Building2 size={13} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--fin-brand)' }} />{branchLabelOf(g.id)}</td>
                      <td className="num">{rows.length}</td>
                      <td className="num">{hours.toFixed(1)}</td>
                      <td className="num fin-money">{formatVND(stdPay)}</td>
                      <td className="num fin-money">{formatVND(tongCong)}</td>
                      <td className="num fin-money" style={{ fontWeight: 800, color: 'var(--fin-green)' }}>{formatVND(thuc)}</td>
                      <td className="ctr">{signed}/{rows.length}</td>
                      <td className="ctr" style={{ fontWeight: 800, color: paid === rows.length ? 'var(--fin-green)' : 'var(--fin-ink)' }}>{paid}/{rows.length}</td>
                      <td>
                        <div className="fin-progress" title={`${pct}% đã chuyển khoản`}><div style={{ width: `${pct}%` }} /></div>
                        <div style={{ fontSize: 8.5, color: 'var(--fin-muted)', marginTop: 3, textAlign: 'right' }}>{pct}% đã CK</div>
                      </td>
                    </tr>
                  );
                })}
                <tr className="fin-grand">
                  <td>TỔNG CỘNG</td>
                  <td className="num">{(slips || []).length}</td>
                  <td className="num">{grandHours.toFixed(1)}</td>
                  <td className="num fin-money">{formatVND(sumBy(slips || [], 'standard_pay'))}</td>
                  <td className="num fin-money">{formatVND((slips || []).reduce((s: number, x: any) => s + (Number(x.tong_cong) || 0), 0))}</td>
                  <td className="num fin-money">{formatVND(grandThuc)}</td>
                  <td className="ctr">{(slips || []).filter((x: any) => ['CONFIRMED', 'PAID'].includes(String(x.status))).length}/{(slips || []).length}</td>
                  <td className="ctr">{(slips || []).filter((x: any) => String(x.status) === 'PAID').length}/{(slips || []).length}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Vòng đời kỳ (runs) */}
      <div className="fin-card">
        <CardHead title="Các kỳ lương trong tháng" icon={<CalendarRange size={14} color="#E85D92" />} sub="Mỗi lần TÍNH LƯƠNG tạo một kỳ mới — kỳ cũ vẫn giữ nguyên để đối chiếu" />
        <div className="fin-table-wrap" style={{ maxHeight: 'none' }}>
          <table className="fin-table">
            <thead>
              <tr><th>Kỳ</th><th>Phạm vi</th><th>Trạng thái</th><th className="num">NV</th><th className="num">Giờ</th><th className="num">Tổng tiền</th><th>Tạo lúc</th></tr>
            </thead>
            <tbody>
              {monthRuns.map((r: any) => {
                const st = RUN_STATUS_STYLE[String(r.status || 'DRAFT')] || RUN_STATUS_STYLE.DRAFT;
                return (
                  <tr key={r.run_id}>
                    <td className="fin-mono" style={{ fontWeight: 700 }}>{r.run_id}</td>
                    <td>{String(r.branch_scope || 'ALL') === 'ALL' ? 'Toàn hệ thống' : branchLabelOf(r.branch_scope)}</td>
                    <td><span className="fin-badge" style={{ color: st.fg, background: st.bg, borderColor: st.fg + '40' }}><span className="fin-badge-dot" />{st.label}</span></td>
                    <td className="num">{r.total_employees ?? 0}</td>
                    <td className="num">{Number(r.total_hours ?? 0).toFixed(1)}</td>
                    <td className="num fin-money" style={{ fontWeight: 800 }}>{formatVND(r.total_amount)}</td>
                    <td style={{ color: 'var(--fin-muted)', fontSize: 11 }}>{fmtDateTime(r.created_at)}</td>
                  </tr>
                );
              })}
              {monthRuns.length === 0 && <tr><td colSpan={7} className="fin-empty">Chưa có kỳ — vẫn hiển thị bảng tổng hợp theo chi nhánh ở trên.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   7 · PHIẾU LƯƠNG — KT ký → GĐ ký → KT gửi NV → NV ký → KT chuyển khoản
   ============================================================================ */
const STAGE_FILTERS = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'DRAFT', label: 'Chờ KT ký' },
  { key: 'CHO_GD_DUYET', label: 'Chờ GĐ duyệt' },
  { key: 'CHO_GUI_NV', label: 'Chờ KT gửi NV' },
  { key: 'CHO_NV_KY', label: 'Chờ NV ký' },
  { key: 'CHO_CHUYEN_KHOAN', label: 'Chờ chuyển khoản' },
  { key: 'PAID', label: 'Đã chuyển khoản' },
];

function PayslipsTab({ month, slips, slipsLoading, allEmployees, formatVND, loadSlips, stageBadge, slipQrUrl, fastSignLap, publishSlip, markPaidSlip, syncSlipDrive, downloadSlipPdf }: any) {
  const [stageFilter, setStageFilter] = useState('ALL');
  const [q, setQ] = useState('');
  const stageOf = (s: any) => String(s?.stage || payslipStage(s) || 'DRAFT');
  const counts = useMemo(() => {
    const m: Record<string, number> = { ALL: slips.length };
    for (const s of slips) { const k = stageOf(s); m[k] = (m[k] || 0) + 1; }
    return m;
  }, [slips]);
  const groups = useMemo(() => {
    let filtered = (slips || []).filter(matchesFilter(q.trim()));
    if (stageFilter !== 'ALL') filtered = filtered.filter((s: any) => stageOf(s) === stageFilter);
    return branchGroups(filtered, (s: any) => slipBranchId(s, allEmployees));
  }, [slips, allEmployees, q, stageFilter]);
  const confirmedCount = slips.filter((s: any) => String(s?.status) === 'CONFIRMED' || s?.sign_nhanvien).length;
  const paidCount = slips.filter((s: any) => String(s?.status) === 'PAID').length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TabHead step={7} title="Phiếu lương — KT ký → GĐ → NV ký" desc="Luồng ký 3 bên theo đúng thứ tự: Kế toán lập & ký → Giám đốc ký duyệt → Kế toán gửi NV → Nhân viên ký → Phiếu trả về Kế toán (khóa + hiện QR) → Kế toán bấm ĐÃ CHUYỂN KHOẢN (phiếu khóa vĩnh viễn + PDF lên Drive)." />

      <div className="fin-kpi-grid">
        <Kpi icon={<Receipt size={18} />} label="Tổng phiếu" value={String(slips.length)} sub={`Kỳ ${periodLabel(month)}`} />
        <Kpi icon={<PenTool size={18} />} tone="amber" label="Chờ GĐ duyệt" value={String(counts['CHO_GD_DUYET'] || 0)} sub="KT đã ký lập" />
        <Kpi icon={<Send size={18} />} tone="violet" label="Chờ NV ký" value={String(counts['CHO_NV_KY'] || 0)} sub="Đã gửi nhân viên" />
        <Kpi icon={<CreditCard size={18} />} tone="amber" label="Chờ chuyển khoản" value={String(confirmedCount)} sub="NV đã ký — hiện QR" />
        <Kpi icon={<CheckCircle size={18} />} tone="green" label="Đã chuyển khoản" value={String(paidCount)} sub="Phiếu khóa + PDF Drive" />
      </div>

      <div className="fin-card">
        <CardHead title={`Danh sách phiếu — ${periodLabel(month)}`} icon={<Receipt size={14} color="#E85D92" />} sub="Lọc theo bước xử lý hoặc tìm theo tên/mã">
          <SearchBox value={q} onChange={setQ} />
          <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={loadSlips} disabled={slipsLoading}>{slipsLoading ? <Loader2 size={13} className="fin-spin" /> : <RefreshCw size={13} />} Tải lại</button>
        </CardHead>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '10px 16px', borderBottom: '1px solid #f1f5f9' }}>
          {STAGE_FILTERS.map(f => (
            <button key={f.key} type="button" className={`fin-pill${stageFilter === f.key ? ' is-active' : ''}`} onClick={() => setStageFilter(f.key)}>
              {f.label} <span style={{ opacity: .7 }}>({counts[f.key] || 0})</span>
            </button>
          ))}
        </div>
        {slipsLoading && <div className="fin-empty">Đang tải phiếu lương…</div>}
        {!slipsLoading && (
          <div className="fin-table-wrap">
            <table className="fin-table" style={{ minWidth: 1180 }}>
              <thead>
                <tr><th>Họ tên</th><th>Mã NV</th><th>Chi nhánh</th><th className="num">THỰC LÃNH</th><th>Trạng thái / Chữ ký</th><th>Thao tác</th></tr>
              </thead>
              <tbody>
                {groups.map(g => {
                  const gThuc = g.rows.reduce((x: number, r: any) => x + (Number(r.thuc_lanh ?? r.net_pay) || 0), 0);
                  return (
                    <React.Fragment key={g.id}>
                      <BranchBandRow label={branchLabelOf(g.id)} count={g.rows.length} cols={6} totalText={`THỰC LÃNH ${formatVND(gThuc)}`} />
                      {g.rows.map((s: any) => {
                        const st = stageBadge(s.stage ?? s.status);
                        const thuc = Number(s.thuc_lanh ?? s.net_pay) || 0;
                        const hasLap = !!s.sign_lap;
                        const hasGd = !!s.sign_giamdoc;
                        const hasNv = !!s.sign_nhanvien;
                        const isPaid = String(s.status) === 'PAID';
                        const isConfirmed = String(s.status) === 'CONFIRMED';
                        const isPublished = String(s.status) === 'PUBLISHED';
                        const qrUrl = slipQrUrl(s);
                        return (
                          <tr key={s.item_id}>
                            <td style={{ fontWeight: 700 }}>{s.full_name}</td>
                            <td className="ctr fin-mono">{s.employee_code}</td>
                            <td>{branchLabelOf(slipBranchId(s, allEmployees))}</td>
                            <td className="num fin-money" style={{ fontWeight: 800, color: 'var(--fin-green)' }}>{formatVND(thuc)}</td>
                            <td>
                              <span className="fin-badge" style={{ color: st.fg, background: st.bg, borderColor: st.border, marginBottom: 5 }}><span className="fin-badge-dot" />{st.label}</span>
                              <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
                                <span className={`fin-sign ${hasLap ? 'ok' : 'pending'}`}>{hasLap ? '✓ KT lập' : 'KT?'}</span>
                                <span className={`fin-sign ${hasGd ? 'ok' : 'pending'}`}>{hasGd ? '✓ GĐ duyệt' : 'GĐ?'}</span>
                                <span className={`fin-sign ${hasNv ? 'ok-green' : 'pending'}`}>{hasNv ? '✓ NV ký' : 'NV?'}</span>
                              </div>
                            </td>
                            <td>
                              {isPaid ? (
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                  <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={() => downloadSlipPdf(s.item_id, s.employee_code)} title="Tải PDF phiếu (đủ 3 chữ ký)"><FileDown size={12} /> PDF</button>
                                  <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={() => syncSlipDrive(s.item_id)} title="Đồng bộ lại PDF lên Drive"><Upload size={12} /> Drive{s.drive_pdf_id ? ' ✓' : ''}</button>
                                  <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--fin-green)', background: 'var(--fin-green-soft)', padding: '3px 8px', borderRadius: 6, border: '1px solid #86efac' }}>ĐÃ CHUYỂN KHOẢN — KHÓA</span>
                                </div>
                              ) : isConfirmed ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                  {qrUrl
                                    ? <img src={qrUrl} alt="VietQR chuyển khoản" className="fin-qr" onError={(e: any) => { (e.target as any).style.display = 'none'; }} />
                                    : <div className="fin-qr-missing">Chưa có STK</div>}
                                  <div style={{ fontSize: 10.5, lineHeight: 1.45 }}>
                                    <div className="fin-money" style={{ fontWeight: 800, fontSize: 13 }}>{formatVND(thuc)}</div>
                                    <div style={{ color: 'var(--fin-muted)' }}>{s.bank_name || '—'} • STK <span className="fin-mono" style={{ color: 'var(--fin-ink)', fontWeight: 800 }}>{s.bank_account || '—'}</span></div>
                                    <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" style={{ marginTop: 4 }} onClick={() => markPaidSlip(s.item_id)}><Check size={12} /> Đã Chuyển Khoản</button>
                                  </div>
                                </div>
                              ) : isPublished ? (
                                <span style={{ fontSize: 10.5, color: '#9a3412', fontWeight: 700 }}>Chờ nhân viên ký nhận…</span>
                              ) : hasLap && !hasGd ? (
                                <span style={{ fontSize: 10.5, color: '#92400e', fontWeight: 700 }}>Chờ Giám đốc ký duyệt</span>
                              ) : hasGd && hasLap ? (
                                <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" onClick={() => publishSlip(s.item_id)}><Send size={12} /> Gửi NV ký</button>
                              ) : (
                                <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" onClick={() => fastSignLap(s.item_id)} disabled={hasLap}><PenTool size={12} /> Kế toán ký lập</button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="fin-subtotal">
                        <td colSpan={3}>CỘNG {branchLabelOf(g.id).toUpperCase()}</td>
                        <td className="num fin-money">{formatVND(gThuc)}</td>
                        <td colSpan={2} />
                      </tr>
                    </React.Fragment>
                  );
                })}
                {groups.length === 0 && <tr><td colSpan={6} className="fin-empty">{q || stageFilter !== 'ALL' ? 'Không có phiếu phù hợp bộ lọc.' : 'Chưa có phiếu lương kỳ này — hãy TÍNH LƯƠNG ở tab 4.'}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
   8 · THANH TOÁN — CHỈ PHIẾU NV ĐÃ KÝ (CONFIRMED)
   ============================================================================ */
function PaymentTab({ month, slips, allEmployees, formatVND, loadSlips, slipQrUrl, markPaidSlip, downloadSlipPdf }: any) {
  const [q, setQ] = useState('');
  const ready = useMemo(() => (slips || []).filter((s: any) => String(s?.status) === 'CONFIRMED').filter(matchesFilter(q.trim())), [slips, q]);
  const groups = useMemo(() => branchGroups(ready, (s: any) => slipBranchId(s, allEmployees)), [ready, allEmployees]);
  const totalReady = ready.reduce((s: number, x: any) => s + (Number(x?.thuc_lanh ?? x?.net_pay) || 0), 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TabHead step={8} title="Thanh toán — VietQR & Đã chuyển khoản" desc="Chỉ hiện phiếu NHÂN VIÊN ĐÃ KÝ. Quét QR → chuyển khoản → bấm ĐÃ CHUYỂN KHOẢN: phiếu KHÓA vĩnh viễn và PDF (đủ 3 chữ ký) tự lên Drive theo PHIEU_LUONG/THANG_MM/CHI_NHÁNH/TÊN NV.">
        <SearchBox value={q} onChange={setQ} />
        <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={loadSlips}><RefreshCw size={13} /> Tải lại</button>
      </TabHead>

      <div className="fin-kpi-grid">
        <Kpi icon={<CreditCard size={18} />} tone="amber" label="Phiếu chờ CK" value={String(ready.length)} sub="Đã đủ 3 chữ ký" />
        <Kpi icon={<Banknote size={18} />} label="Tổng cần chuyển" value={formatVND(totalReady)} sub="Theo thực lãnh" />
      </div>

      <div className="fin-card">
        <CardHead title={`Chờ chuyển khoản — ${periodLabel(month)} (${ready.length})`} icon={<CreditCard size={14} color="#E85D92" />} sub="Sau khi chuyển, bấm ĐÃ CHUYỂN KHOẢN để khóa phiếu + đẩy PDF lên Drive" />
        <div className="fin-table-wrap">
          <table className="fin-table" style={{ minWidth: 1080 }}>
            <thead>
              <tr><th>Họ tên</th><th>Mã NV</th><th>Chi nhánh</th><th className="num">THỰC LÃNH</th><th>Ngân hàng / STK</th><th className="ctr">VietQR</th><th>Thao tác</th></tr>
            </thead>
            <tbody>
              {groups.map(g => {
                const gTotal = g.rows.reduce((x: number, r: any) => x + (Number(r.thuc_lanh ?? r.net_pay) || 0), 0);
                return (
                  <React.Fragment key={g.id}>
                    <BranchBandRow label={branchLabelOf(g.id)} count={g.rows.length} cols={7} totalText={`Cần chuyển ${formatVND(gTotal)}`} />
                    {g.rows.map((s: any) => {
                      const thuc = Number(s.thuc_lanh ?? s.net_pay) || 0;
                      const qrUrl = slipQrUrl(s);
                      return (
                        <tr key={s.item_id}>
                          <td style={{ fontWeight: 700 }}>{s.full_name}</td>
                          <td className="ctr fin-mono">{s.employee_code}</td>
                          <td>{branchLabelOf(slipBranchId(s, allEmployees))}</td>
                          <td className="num fin-money" style={{ fontWeight: 800, color: 'var(--fin-green)' }}>{formatVND(thuc)}</td>
                          <td style={{ fontSize: 11 }}>{s.bank_name || '—'}<br /><span className="fin-mono" style={{ fontWeight: 800, color: 'var(--fin-ink)' }}>{s.bank_account || '—'}</span><br /><span style={{ color: 'var(--fin-muted)' }}>{s.bank_holder || ''}</span></td>
                          <td className="ctr">{qrUrl ? <img src={qrUrl} alt="VietQR" className="fin-qr" style={{ width: 72, height: 72 }} onError={(e: any) => { (e.target as any).style.display = 'none'; }} /> : <div className="fin-qr-missing">Chưa có STK</div>}</td>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                              <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" onClick={() => markPaidSlip(s.item_id)}><Check size={12} /> Đã Chuyển Khoản</button>
                              <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={() => downloadSlipPdf(s.item_id, s.employee_code)}><FileDown size={12} /> PDF (3 chữ ký)</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="fin-subtotal">
                      <td colSpan={3}>CỘNG {branchLabelOf(g.id).toUpperCase()}</td>
                      <td className="num fin-money">{formatVND(gTotal)}</td>
                      <td colSpan={3} />
                    </tr>
                  </React.Fragment>
                );
              })}
              {groups.length === 0 && <tr><td colSpan={7} className="fin-empty">Không có phiếu nào chờ chuyển khoản (chưa NV ký hoặc đã chuyển hết).</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   9 · CHỮ KÝ MẪU (Kế toán) — lưu server, mọi máy dùng chung
   ============================================================================ */
function SignatureTemplatesTab({ currentUser, showToast }: any) {
  const [sigs, setSigs] = React.useState<any>(() => { try { return JSON.parse(localStorage.getItem('ubm_default_signatures') || '') || { lap: { name: '', img: null }, quanly: { name: '', img: null } }; } catch { return { lap: { name: '', img: null }, quanly: { name: '', img: null } }; } });
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    apiRequest('/payroll/signature-templates').then((data: any) => {
      if (data && (data.lap?.img || data.quanly?.img)) {
        setSigs({ lap: data.lap || { name: '', img: null }, quanly: data.quanly || { name: '', img: null } });
        localStorage.setItem('ubm_default_signatures', JSON.stringify({ lap: data.lap || { name: '', img: null }, quanly: data.quanly || { name: '', img: null } }));
      }
    }).catch(() => null);
  }, []);
  const onFile = (key: 'lap' | 'quanly', file: File | null) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) { showToast('Chọn file ảnh (PNG/JPG) để làm chữ ký mẫu'); return; }
    const reader = new FileReader();
    reader.onload = () => setSigs((prev: any) => ({ ...prev, [key]: { ...prev[key], img: reader.result } }));
    reader.readAsDataURL(file);
  };
  const save = async () => {
    setBusy(true);
    try {
      localStorage.setItem('ubm_default_signatures', JSON.stringify(sigs));
      await apiRequest('/payroll/signature-templates', { method: 'PUT', body: JSON.stringify(sigs) });
      showToast('💾 Đã lưu chữ ký mẫu — nút "Kế toán ký lập" sẽ dùng mẫu này');
    } catch (e: any) { showToast('Lưu máy chủ lỗi: ' + (e?.message || '')); } finally { setBusy(false); }
  };
  const rows = [
    { key: 'lap' as const, title: 'Chữ ký Kế toán (người lập phiếu)', hint: 'Dùng cho nút "Kế toán ký lập" và tự bù khi gửi NV', required: true },
    { key: 'quanly' as const, title: 'Chữ ký Quản lý chi nhánh (dự phòng)', hint: 'Không bắt buộc trong quy trình 3 chữ ký hiện hành (KT → GĐ → NV)', required: false },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TabHead step={9} title="Chữ ký mẫu — Ký nhanh 1 chạm" desc="Lưu tại máy chủ: mọi máy của Kế toán dùng chung một bộ chữ ký khi bấm “Kế toán ký lập”. Ảnh nên nền trong suốt (PNG), nén sẵn." />
      <div className="fin-card">
        {rows.map(r => (
          <div key={r.key} className="fin-sig-row" style={{ borderBottom: '1px solid #f1f5f9' }}>
            <div className="fin-sig-preview">
              {sigs[r.key]?.img
                ? <img src={sigs[r.key].img} alt={r.title} />
                : <span style={{ fontSize: 10, color: '#94a3b8' }}>Chưa có mẫu</span>}
            </div>
            <div style={{ flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--fin-ink)' }}>
                {r.title}
                {r.required && <span className="fin-chip fin-chip-past" style={{ marginLeft: 8 }}>BẮT BUỘC</span>}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--fin-muted)' }}>{r.hint}</div>
              <input className="fin-input" style={{ maxWidth: 420 }} value={sigs[r.key]?.name || ''} onChange={(e: any) => setSigs((prev: any) => ({ ...prev, [r.key]: { ...prev[r.key], name: e.target.value } }))} placeholder="Tên hiển thị trên phiếu (VD: Nguyễn Thị A — Kế toán)" aria-label="Tên chữ ký" />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label className="fin-btn fin-btn-ghost fin-btn-sm" style={{ cursor: 'pointer' }}>
                  <Upload size={13} /> Tải ảnh ký lên<input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e: any) => onFile(r.key, e.target.files?.[0] || null)} />
                </label>
                {sigs[r.key]?.img && <button type="button" className="fin-btn fin-btn-danger fin-btn-sm" onClick={() => setSigs((prev: any) => ({ ...prev, [r.key]: { ...prev[r.key], img: null } }))}><X size={13} /> Xóa ảnh</button>}
              </div>
            </div>
          </div>
        ))}
        <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" className="fin-btn fin-btn-primary" onClick={save} disabled={busy}>{busy ? <Loader2 size={14} className="fin-spin" /> : <Save size={14} />} Lưu chữ ký mẫu</button>
          <span style={{ fontSize: 10.5, color: 'var(--fin-muted)' }}>Bởi: {currentUser?.fullName || 'Kế toán'} — ảnh lưu chung mọi thiết bị.</span>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   10 · QR NGÂN HÀNG TỪNG NV (chuyển lương tự do)
   ============================================================================ */
function BankQrTab({ allEmployees, month }: any) {
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const filtered = (allEmployees || []).filter((e: any) => String(e?.employment_status || '').toUpperCase() !== 'TERMINATED').filter(matchesFilter(q.trim()));
    return branchGroups(filtered, (e: any) => e.default_branch_id);
  }, [allEmployees, q]);
  const withStk = (allEmployees || []).filter((e: any) => String(e?.bank_account || '').trim()).length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TabHead step={10} title="QR ngân hàng từng nhân viên" desc={`Quét QR để chuyển khoản lương tự do (không kèm số tiền). ${withStk}/${(allEmployees || []).length} NV đã có STK. Dữ liệu tháng đang chọn: ${periodLabel(month)}.`}>
        <SearchBox value={q} onChange={setQ} />
      </TabHead>
      {groups.map(g => (
        <div key={g.id} className="fin-card">
          <div className="fin-bcc-branch-head"><span><Building2 size={13} style={{ verticalAlign: -2, marginRight: 6 }} />{branchLabelOf(g.id)}</span><span style={{ fontSize: 10 }}>{g.rows.length} NV</span></div>
          <div className="fin-qr-grid">
            {g.rows.map((e: any) => {
              const acct = String(e.bank_account || '').trim();
              const qr = bankQrUrlOf(e.bank_name, acct, e.bank_holder || e.full_name);
              return (
                <div key={e.employee_id} className="fin-qr-card">
                  {qr
                    ? <img src={qr} alt={`VietQR ${e.full_name}`} className="fin-qr" style={{ width: 76, height: 76 }} onError={(ev: any) => { (ev.target as any).style.display = 'none'; }} />
                    : <div className="fin-qr-missing" style={{ width: 76, height: 76 }}>Chưa có STK</div>}
                  <div style={{ fontSize: 11, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, color: 'var(--fin-ink)' }}>{e.full_name} <span style={{ color: '#94a3b8', fontWeight: 600 }}>{e.employee_code}</span></div>
                    <div style={{ color: 'var(--fin-muted)', marginTop: 1 }}>{e.bank_name || '—'}</div>
                    <div className="fin-mono" style={{ fontWeight: 800, color: 'var(--fin-ink)', fontSize: 12 }}>{acct || '—'}</div>
                    <div style={{ color: 'var(--fin-muted)' }}>{e.bank_holder || e.full_name}</div>
                  </div>
                </div>
              );
            })}
            {g.rows.length === 0 && <div className="fin-empty">Không có nhân viên phù hợp.</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================================================================
   11 · DUYỆT ĐỔI STK (Kế toán / Admin / HR)
   ============================================================================ */
function BankChangesTab({ currentUser, showToast }: any) {
  const [reqs, setReqs] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const load = React.useCallback(async () => {
    setLoading(true);
    try { setReqs(await apiRequest('/admin/bank-change-requests')); } catch (e: any) { showToast('Lỗi tải yêu cầu đổi STK: ' + (e?.message || '')); } finally { setLoading(false); }
  }, [showToast]);
  React.useEffect(() => { load(); }, [load]);
  const review = async (employeeId: string, action: 'approve' | 'reject') => {
    const emp = reqs.find((r: any) => String(r.employee_id) === String(employeeId));
    const label = action === 'approve' ? 'PHÊ DUYỆT đổi STK' : 'TỪ CHỐI đổi STK';
    if (!window.confirm(`${label} cho ${emp?.full_name || employeeId}? Số TK mới: ${emp?.new_bank_account || emp?.bank_account || '—'}`)) return;
    setBusy(employeeId + action);
    try {
      await apiRequest(`/admin/bank-change-requests/${encodeURIComponent(employeeId)}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: `${label} bởi ${currentUser?.fullName || 'Kế toán'}` }) });
      showToast(`Đã ${action === 'approve' ? 'phê duyệt' : 'từ chối'} đổi STK của ${emp?.full_name || employeeId}`);
      load();
    } catch (e: any) { showToast(e?.message || 'Thao tác thất bại'); } finally { setBusy(null); }
  };
  const pending = reqs.filter((r: any) => String(r.status || '').toUpperCase() === 'PENDING');
  const done = reqs.filter((r: any) => String(r.status || '').toUpperCase() !== 'PENDING');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TabHead step={11} title="Duyệt đổi tài khoản ngân hàng" desc="Yêu cầu đổi STK từ nhân viên — kiểm tra kỹ số tài khoản mới trước khi phê duyệt (ảnh hưởng chuyển lương).">
        <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={load} disabled={loading}>{loading ? <Loader2 size={13} className="fin-spin" /> : <RefreshCw size={13} />} Tải lại</button>
      </TabHead>
      <div className="fin-card">
        <CardHead title={`⏳ Chờ duyệt (${pending.length})`} icon={<AlertCircle size={14} color="#d97706" />} />
        {pending.map((r: any) => (
          <div key={r.employee_id || r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontWeight: 800, fontSize: 13 }}>{r.full_name} <span style={{ color: '#94a3b8', fontWeight: 600 }}>{r.employee_code}</span></div>
              <div style={{ fontSize: 11.5, color: 'var(--fin-muted)', marginTop: 2 }}>STK mới: <span className="fin-mono" style={{ fontWeight: 800, color: 'var(--fin-ink)' }}>{r.new_bank_account || r.bank_account || '—'}</span> — {r.new_bank_name || r.bank_name || '—'}{r.new_bank_holder ? ` (CTK: ${r.new_bank_holder})` : ''}</div>
              {r.requested_at && <div style={{ fontSize: 9.5, color: '#94a3b8', marginTop: 2 }}>Yêu cầu lúc: {fmtDateTime(r.requested_at)}</div>}
            </div>
            <button type="button" className="fin-btn fin-btn-green fin-btn-sm" onClick={() => review(r.employee_id, 'approve')} disabled={!!busy}><Check size={12} /> Duyệt đổi STK</button>
            <button type="button" className="fin-btn fin-btn-danger fin-btn-sm" onClick={() => review(r.employee_id, 'reject')} disabled={!!busy}><X size={12} /> Từ chối</button>
          </div>
        ))}
        {pending.length === 0 && <div className="fin-empty">Không có yêu cầu đổi STK nào đang chờ.</div>}
      </div>
      {done.length > 0 && (
        <div className="fin-card">
          <CardHead title={`Đã xử lý gần đây (${done.length})`} icon={<ShieldCheck size={14} color="#059669" />} />
          {done.slice(0, 20).map((r: any) => (
            <div key={r.employee_id || r.id} style={{ display: 'flex', gap: 12, padding: '8px 16px', borderBottom: '1px solid #f1f5f9', fontSize: 11.5, color: 'var(--fin-muted)', alignItems: 'center' }}>
              <span style={{ fontWeight: 800, color: 'var(--fin-ink)' }}>{r.full_name}</span>
              <span className="fin-mono">{r.new_bank_account || r.bank_account}</span>
              <span style={{ marginLeft: 'auto', fontWeight: 800, color: String(r.status).toUpperCase() === 'APPROVED' ? 'var(--fin-green)' : 'var(--fin-red)' }}>{String(r.status).toUpperCase()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
