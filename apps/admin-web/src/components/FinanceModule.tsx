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
  BI_KHIEU_NAI: { bg: '#FEE2E2', fg: '#991B1B', border: '#FCA5A5' },
  CHO_CHUYEN_KHOAN: { bg: '#FEF9C3', fg: '#854D0E', border: '#FDE047' },
  PAID: { bg: '#DCFCE7', fg: '#166534', border: '#86EFAC' },
};

/**
 * Quy trình kế toán (8 bước, khóa tuần tự theo workflow-status):
 * 1 Tổng quan → 2 Đối soát → 3 BCC → 4 Tính lương → 5 Bảng lương → 6 Kỳ lương → 7 Phiếu lương → 8 Thanh toán.
 * Khóa theo tháng: tháng đã hết → khóa toàn bộ (chỉ mở khóa tạm khi rollback có lý do);
 * tháng mới/hiện tại → không khóa theo tháng, chỉ khóa tuần tự.
 */
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

/* ---------- Full-column helper cho bảng phiếu lương (mọi bước Finance) ----------
 * Hiển thị ĐỦ các cột theo công thức Excel:
 * Giờ công · Lương ca · Phụ cấp · LCB · OT thêm · Bonus · TỔNG CỘNG
 * · Trừ KPI/phạt · Ứng lương · Trừ đồng phục · TỔNG LƯƠNG · THỰC LÃNH
 * Dùng chung cho: Bảng lương tháng, Kỳ lương, Phiếu lương, Thanh toán.
 */
const slipCalc = (s: any) => {
  const banCa = Number(s?.standard_pay) || 0;
  const lcb = Number(s?.luong_cb) || 0;
  const phuCap = Number(s?.allowance) || 0;
  const ot = Number(s?.ot_extra) || 0;
  const bonus = Number(s?.bonus) || 0;
  const tongCong = Number(s?.tong_cong) || (banCa + lcb + phuCap + ot + bonus);
  const truKpiPhat = (Number(s?.tru_kpi) || 0) + (Number(s?.deduction) || 0);
  const ung = Number(s?.ung_luong) || 0;
  const dongPhuc = Number(s?.dong_phuc) || 0;
  const tongLuong = Number(s?.tong_luong) || (tongCong - truKpiPhat);
  const thuc = Number(s?.thuc_lanh ?? s?.net_pay) || 0;
  return { banCa, lcb, phuCap, ot, bonus, tongCong, truKpiPhat, ung, dongPhuc, tongLuong, thuc, gio: Number(s?.standard_hours) || 0 };
};
const sumCalc = (rows: any[]) => rows.reduce((acc, s) => {
  const c = slipCalc(s);
  (['banCa','lcb','phuCap','ot','bonus','tongCong','truKpiPhat','ung','dongPhuc','tongLuong','thuc','gio'] as const).forEach(k => { (acc as any)[k] += (c as any)[k]; });
  return acc;
}, { banCa: 0, lcb: 0, phuCap: 0, ot: 0, bonus: 0, tongCong: 0, truKpiPhat: 0, ung: 0, dongPhuc: 0, tongLuong: 0, thuc: 0, gio: 0 } as ReturnType<typeof slipCalc>);

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
  // Tháng xử lý hiện tại — mọi request workflow/bảng đều gắn theo tháng này (độc lập theo tháng).
  const monthRef = useRef(month);
  useEffect(() => {
    localStorage.setItem(MONTH_KEY, month);
    monthRef.current = month;
  }, [month]);
  const isCurrentMonth = month === curPeriod;
  const options = useMemo(() => {
    const base = monthOptions();
    if (month && !base.some(o => o.value === month)) {
      base.push({ value: month, label: periodLabel(month) });
    }
    return base;
  }, [month]);

  /** Hiển thị cột theo tab (lưu server theo TÀI KHOẢN, đồng bộ 2 máy) */
  const FIN_COL_DEFS: Record<string, Array<{ key: string; label: string }>> = {
    'fin-timesheet': [
      { key: 'stt', label: 'STT' }, { key: 'fullName', label: 'Họ tên' }, { key: 'code', label: 'Mã NV' }, { key: 'branch', label: 'Chi nhánh' },
      { key: 'full', label: 'Ca đủ' }, { key: 'partial', label: 'Thiếu' }, { key: 'absent', label: 'Vắng' }, { key: 'hours', label: 'Giờ công' },
      { key: 'standardPay', label: 'Lương ca' }, { key: 'deduction', label: 'Trừ' }, { key: 'netPay', label: 'THỰC NHẬN' },
    ],
    'fin-bcc': [
      { key: 'summary', label: 'Tóm tắt NV (giờ/đủ/thiếu/vắng/tiền)' }, { key: 'date', label: 'Ngày' }, { key: 'shift', label: 'Ca' }, { key: 'hours', label: 'Giờ' },
      { key: 'status', label: 'Trạng thái' }, { key: 'checkIn', label: 'Check-in' }, { key: 'lateMin', label: 'Trễ (phút)' }, { key: 'shiftPay', label: 'Lương ca' }, { key: 'fineAmount', label: 'Phạt/Trừ' },
    ],
    'fin-calculate': [
      { key: 'stt', label: 'STT' }, { key: 'code', label: 'Mã NV' }, { key: 'name', label: 'Họ tên' }, { key: 'branch', label: 'Chi nhánh' },
      { key: 'luong_cb', label: 'LCB' }, { key: 'ot_extra', label: 'OT thêm' }, { key: 'bonus_extra', label: 'Bonus' }, { key: 'ung_luong', label: 'Ứng lương' },
      { key: 'tru_kpi', label: 'Trừ KPI' }, { key: 'dong_phuc', label: 'Trừ ĐP' }, { key: 'note', label: 'Ghi chú' },
      { key: 'b1', label: 'B1 Giờ/LCB' }, { key: 'b2', label: 'B2 Tổng cộng' }, { key: 'b3', label: 'B3 Tổng lương' }, { key: 'b4', label: 'B4 Thực lãnh' },
    ],
    'fin-payroll-sheet': [
      { key: 'stt', label: 'STT' }, { key: 'full_name', label: 'Họ tên' }, { key: 'employee_code', label: 'Mã NV' }, { key: 'branch', label: 'Chi nhánh' },
      { key: 'gio', label: 'Giờ công' }, { key: 'banCa', label: 'Lương ca' }, { key: 'phuCap', label: 'Phụ cấp' }, { key: 'lcb', label: 'LCB' },
      { key: 'ot', label: 'OT thêm' }, { key: 'bonus', label: 'Bonus' }, { key: 'tongCong', label: 'TỔNG CỘNG' }, { key: 'truKpiPhat', label: 'Trừ KPI/phạt' },
      { key: 'ung', label: 'Ứng lương' }, { key: 'dongPhuc', label: 'Trừ ĐP' }, { key: 'tongLuong', label: 'TỔNG LƯƠNG' }, { key: 'thuc', label: 'THỰC LÃNH' }, { key: 'status', label: 'Trạng thái' },
    ],
    'fin-payroll-periods': [
      { key: 'stt', label: 'STT' }, { key: 'full_name', label: 'Họ tên' }, { key: 'employee_code', label: 'Mã NV' }, { key: 'branch', label: 'Chi nhánh' },
      { key: 'gio', label: 'Giờ công' }, { key: 'banCa', label: 'Lương ca' }, { key: 'phuCap', label: 'Phụ cấp' }, { key: 'lcb', label: 'LCB' },
      { key: 'ot', label: 'OT thêm' }, { key: 'bonus', label: 'Bonus' }, { key: 'tongCong', label: 'TỔNG CỘNG' }, { key: 'truKpiPhat', label: 'Trừ KPI/phạt' },
      { key: 'ung', label: 'Ứng lương' }, { key: 'dongPhuc', label: 'Trừ ĐP' }, { key: 'tongLuong', label: 'TỔNG LƯƠNG' }, { key: 'thuc', label: 'THỰC LÃNH' },
      { key: 'status', label: 'Trạng thái phiếu' }, { key: 'edit', label: 'Sửa trực tiếp' },
    ],
    'fin-payslips': [
      { key: 'stt', label: 'STT' }, { key: 'full_name', label: 'Họ tên' }, { key: 'employee_code', label: 'Mã NV' }, { key: 'branch', label: 'Chi nhánh' },
      { key: 'gio', label: 'Giờ công' }, { key: 'banCa', label: 'Lương ca' }, { key: 'phuCap', label: 'Phụ cấp' }, { key: 'lcb', label: 'LCB' },
      { key: 'ot', label: 'OT thêm' }, { key: 'bonus', label: 'Bonus' }, { key: 'tongCong', label: 'TỔNG CỘNG' }, { key: 'truKpiPhat', label: 'Trừ KPI/phạt' },
      { key: 'ung', label: 'Ứng lương' }, { key: 'dongPhuc', label: 'Trừ ĐP' }, { key: 'tongLuong', label: 'TỔNG LƯƠNG' }, { key: 'thuc', label: 'THỰC LÃNH' },
      { key: 'sign', label: 'Trạng thái / Chữ ký' }, { key: 'action', label: 'Thao tác' },
    ],
    'fin-payment': [
      { key: 'stt', label: 'STT' }, { key: 'full_name', label: 'Họ tên' }, { key: 'employee_code', label: 'Mã NV' }, { key: 'branch', label: 'Chi nhánh' },
      { key: 'gio', label: 'Giờ công' }, { key: 'banCa', label: 'Lương ca' }, { key: 'phuCap', label: 'Phụ cấp' }, { key: 'lcb', label: 'LCB' },
      { key: 'ot', label: 'OT thêm' }, { key: 'bonus', label: 'Bonus' }, { key: 'tongCong', label: 'TỔNG CỘNG' }, { key: 'truKpiPhat', label: 'Trừ KPI/phạt' },
      { key: 'ung', label: 'Ứng lương' }, { key: 'dongPhuc', label: 'Trừ ĐP' }, { key: 'tongLuong', label: 'TỔNG LƯƠNG' }, { key: 'thuc', label: 'THỰC LÃNH' },
      { key: 'bank', label: 'Ngân hàng / STK' }, { key: 'qr', label: 'VietQR' }, { key: 'action', label: 'Thao tác' },
    ],
  };
  const [colVis, setColVis] = useState<Record<string, Record<string, boolean>>>({});
  const [colVisSaving, setColVisSaving] = useState(false);
  const colVisSavingRef = useRef(false);
  // Mở/đóng panel chọn cột của tab đang xem — 1 state dùng chung, render trong CardHead từng tab.
  const [colVisOpenTab, setColVisOpenTab] = useState<string>('');
  const colsVisible = useCallback((tabId: string) => {
    const defs = FIN_COL_DEFS[tabId] || [];
    return {
      show: (key: string) => colVis?.[tabId]?.[key] !== false,
      defs,
    };
  }, [colVis]);
  const saveColVis = useCallback(async (next: Record<string, Record<string, boolean>>) => {
    if (colVisSavingRef.current) return;
    colVisSavingRef.current = true;
    setColVisSaving(true);
    try {
      await apiRequest('/payroll/table-columns', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ columns: next }) });
      // Đồng bộ realtime cho các máy khác cùng tài khoản (socket trong App).
    } catch (e: any) {
      showToast?.(e?.message || 'Lưu ẩn/hiện cột thất bại');
    } finally {
      colVisSavingRef.current = false;
      setColVisSaving(false);
    }
  }, [showToast]);

  const toggleCol = useCallback((tabKey: string, colKey: string) => {
    setColVis(prev => {
      const next: Record<string, Record<string, boolean>> = {
        ...prev,
        [tabKey]: { ...(prev?.[tabKey] || {}), [colKey]: (prev?.[tabKey] || {})[colKey] === false ? true : false },
      };
      const defs = FIN_COL_DEFS[tabKey] || [];
      const visibleDefs = defs.filter(d => next[tabKey][d.key] !== false).length;
      if (visibleDefs === 0) return prev;
      void saveColVis(next);
      return next;
    });
  }, [saveColVis]);

  const showAllCols = useCallback((tabKey: string) => {
    const defs = FIN_COL_DEFS[tabKey] || [];
    const allTrue: Record<string, boolean> = {};
    defs.forEach(d => { allTrue[d.key] = true; });
    setColVis(prev => {
      const next = { ...prev, [tabKey]: allTrue };
      void saveColVis(next);
      return next;
    });
  }, [saveColVis]);

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
  const inputInflightRef = useRef(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [inputsSaving, setInputsSaving] = useState(false);
  const [inputsSavedAt, setInputsSavedAt] = useState<Date | null>(null);
  useEffect(() => { inputsRef.current = inputs; }, [inputs]);
  // Đổi tháng: XÓA NGAY trạng thái tháng cũ (workflow/phiếu/kỳ/bảng công/nhập tay) để
  // tháng mới KHÔNG hiển thị khóa/mở theo quy trình của tháng cũ. Các response cũ
  // về trễ sẽ bị bỏ qua (kiểm tra monthRef trước khi set trong từng loader).
  useEffect(() => {
    setWorkflow(null);
    setSlips([]);
    setRuns([]);
    setFinSheet(null);
    setFormula(null);
    setInputs([]);
  }, [month]);

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
  // Mỗi loader gắn theo đúng tháng tại lúc gọi (monthRef) và CHỈ nhận kết quả
  // khi tháng đó còn đang hiển thị — chống race khi đổi tháng nhanh làm tháng mới
  // nhận khóa/mở của tháng cũ (tháng nào theo tháng đó).
  const loadWorkflow = useCallback(async () => { const p = monthRef.current; try { const wf = await api(`/payroll/workflow-status?period=${encodeURIComponent(p)}`); if (monthRef.current === p && String((wf as any)?.period || p) === p) setWorkflow(wf); } catch { if (monthRef.current === p) setWorkflow(null); } }, [api]);
  const loadRuns = useCallback(async () => { setRunsLoading(true); try { const d = await api('/payroll/runs'); setRuns(Array.isArray(d) ? d : []); } catch { setRuns([]); } finally { setRunsLoading(false); } }, [api]);
  const loadSlips = useCallback(async () => { const p = monthRef.current; setSlipsLoading(true); try { const d = await api(`/payroll/period-slips/${encodeURIComponent(p)}`); if (monthRef.current !== p) return; setSlips((d as any)?.slips || []); } catch { if (monthRef.current === p) setSlips([]); } finally { if (monthRef.current === p) setSlipsLoading(false); } }, [api]);
  const loadFinSheet = useCallback(async () => { const p = monthRef.current; setFinSheetLoading(true); try { const fs = await api(`/admin/reports/finance-timesheet?period=${encodeURIComponent(p)}&branchScope=*`); if (monthRef.current !== p) return; setFinSheet(fs); if (activeTab === 'fin-dashboard') { try { setFinSheetSync(await api('/payroll/sync-status')); } catch { setFinSheetSync(null); } } } catch { if (monthRef.current === p) setFinSheet(null); } finally { if (monthRef.current === p) setFinSheetLoading(false); } }, [api, activeTab]);
  const loadFormula = useCallback(async () => { const p = monthRef.current; try { const f = await api(`/payroll/formula/${encodeURIComponent(p)}`); if (monthRef.current === p) setFormula(f); } catch { if (monthRef.current === p) setFormula(null); } }, [api]);
  const loadInputs = useCallback(async () => {
    // KHÔNG ghi đè ô đang gõ / đang chờ lưu / đang gửi: một sự kiện realtime
    // chen ngang có thể trả về bản cũ hơn và xóa sạch số Kế toán vừa nhập.
    if (inputPendingRef.current.size > 0 || inputTimersRef.current.size > 0 || inputInflightRef.current > 0) return;
    const p = monthRef.current;
    setInputsLoading(true);
    try {
      const arr: any[] = await api(`/payroll/inputs/${encodeURIComponent(p)}`);
      // Lần nữa sau khi await: người dùng có thể vừa bắt đầu gõ hoặc vừa đổi tháng.
      if (monthRef.current !== p) return;
      if (inputPendingRef.current.size > 0 || inputTimersRef.current.size > 0 || inputInflightRef.current > 0) return;
      setInputs((Array.isArray(arr) ? arr : []).map((i: any) => ({ ...i, note: String(i?.note ?? '') })));
    } catch { if (monthRef.current === p) setInputs([]); } finally { if (monthRef.current === p) setInputsLoading(false); }
  }, [api]);
  const loadDriveStatus = useCallback(async () => { const p = monthRef.current; try { const st = await api(`/payroll/drive-sync/status?period=${encodeURIComponent(p)}`); if (monthRef.current === p) { setSyncStatus(st); setDriveConfigured(!!st?.configured); } } catch { if (monthRef.current === p) setDriveConfigured(false); } }, [api]);
  const loadColVis = useCallback(async () => { try { const d: any = await api('/payroll/table-columns'); if (d?.columns) setColVis(d.columns); } catch { /* giữ mặc định hiện tất cả */ } }, [api]);

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
    const ent = String((evt.detail as any)?.entity || '');
    if (!ent) return;
    // Mọi nguồn dữ liệu của quy trình (công, ca, nghỉ, đổi ca, lương, phiếu,
    // nhân sự) đều có thể làm đổi trạng thái bước 1–7 → nạp lại workflow ngay
    // tại thời điểm dữ liệu vừa ghi xong để tab khóa/mở realtime (không F5).
    // Workflow là API nhẹ nên gọi NGAY; bảng số liệu nặng hơn vẫn gom 2s mới tải.
    const workflowEnt = [
      'all', 'payroll', 'payslips', 'employees',
      'attendance', 'shift', 'shift-rereg', 'schedules', 'schedule',
      'swap', 'swaps', 'leave', 'leaves', 'weekly-off',
      'adjustments', 'office-adjustments', 'office-attendance', 'office-leaves',
    ].includes(ent);
    if (!workflowEnt) return;
    try { void loadWorkflow(); } catch { /* noop */ }
    // Debounce trailing 2s cho bảng: 10 sự kiện liên tiếp trong 2s chỉ tải 1 lần.
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      if (!mountedRef.current) return;
      refreshCurrentTab();
    }, 2000);
  }, [refreshCurrentTab, loadWorkflow]);

  // Đổi lương 1 NV ở tab Cấu hình lương (máy này): bảng công + phiếu phải thấy
  // lương mới ngay, không chờ sự kiện socket vòng qua App (socket báo máy khác).
  const handleSalarySaved = useCallback(() => {
    if (['fin-timesheet', 'fin-bcc', 'fin-dashboard', 'fin-calculate', 'fin-payroll-sheet'].includes(activeTab)) loadFinSheet();
    if (activeTab === 'fin-calculate' && !isUserEditing()) loadInputs();
    loadWorkflow();
  }, [activeTab, loadFinSheet, loadInputs, loadWorkflow, isUserEditing]);

  useEffect(() => {
    window.addEventListener('ubm:fin-timesheet-reload', handleRealtime as any);
    window.addEventListener('ubm:payslips-reload', handleRealtime as any);
    window.addEventListener('data:updated', handleRealtime as any);
    window.addEventListener('ubm:salary-config-saved', handleSalarySaved as any);
    return () => { mountedRef.current = false; if (refreshTimerRef.current) { clearTimeout(refreshTimerRef.current); refreshTimerRef.current = null; } window.removeEventListener('ubm:fin-timesheet-reload', handleRealtime as any); window.removeEventListener('ubm:payslips-reload', handleRealtime as any); window.removeEventListener('data:updated', handleRealtime as any); window.removeEventListener('ubm:salary-config-saved', handleSalarySaved as any); };
  }, [handleRealtime, handleSalarySaved]);

  useEffect(() => {
    loadWorkflow();
    loadColVis();
    switch (activeTab) {
      case 'fin-dashboard': loadFinSheet(); loadRuns(); break;
      case 'fin-timesheet': case 'fin-bcc': case 'fin-calculate': case 'fin-payroll-sheet': loadFinSheet(); if (activeTab === 'fin-calculate') { loadFormula(); loadInputs(); } break;
      case 'fin-payroll-periods': loadRuns(); loadSlips(); break;
      case 'fin-payslips': case 'fin-payment': case 'fin-signatures': loadSlips(); break;
    }
    if (activeTab === 'fin-payment' || activeTab === 'fin-payslips') loadDriveStatus();
  }, [activeTab, month, loadWorkflow, loadFinSheet, loadRuns, loadSlips, loadFormula, loadInputs, loadDriveStatus, loadColVis]);

  // QUY TRÌNH TUẦN TỰ + KHÓA KHI HOÀN TẤT (realtime theo workflow-status):
  //  - Bước ĐÃ HOÀN TẤT -> khóa lại (tránh sửa số liệu đã chốt).
  //  - Bước CHƯA MỞ (bước trước chưa xong) -> khóa, chờ tới lượt.
  //  - Chỉ bước ĐANG XỬ LÝ (chưa xong, bước trước đã xong) là mở.
  //  - Tháng đã hết (periodMeta.monthLocked) -> khóa TOÀN BỘ bước; tháng mới/hiện tại
  //    không khóa theo tháng. Kế toán mở khóa tạm bằng nút "Quay về bước trước".
  // Workflow nạp lại ngay khi có sự kiện socket (handleRealtime gọi loadWorkflow),
  // nên khóa/mở thay đổi realtime, không cần F5.
  const monthLocked = !!workflow?.periodMeta?.monthLocked;
  const monthUnlockInfo = workflow?.periodMeta?.monthUnlock || null;
  const complainedCount = Number(workflow?.periodMeta?.complainedCount || 0);
  const tabLocked = useMemo(() => {
    if (!workflow?.steps?.length) return new Map<string, { locked: boolean; done: boolean; reason: string; completedReason: string; stat: string; completedAt: string; lockedDueToMonth: boolean; previousStepId: string | null; previousTitle: string | null; canRollback: boolean; canGoBack: boolean }>();
    const m = new Map<string, { locked: boolean; done: boolean; reason: string; completedReason: string; stat: string; completedAt: string; lockedDueToMonth: boolean; previousStepId: string | null; previousTitle: string | null; canRollback: boolean; canGoBack: boolean }>();
    for (const s of workflow.steps) {
      const idx = workflow.steps.indexOf(s);
      const prev = idx > 0 ? workflow.steps[idx - 1] : null;
      const done = !!s.done;
      const pending = !!(prev && !prev.done);
      const lockedDueToMonth = !!s.lockedDueToMonth || !!monthLocked;
      const locked = typeof s.locked === 'boolean' ? !!s.locked : (done || pending);
      const monthReason = lockedDueToMonth ? 'Tháng đã kết thúc — quy trình kế toán của tháng này đã KHÓA (chỉ xem). Nếu bước nào sai, bấm "Quay về bước trước" để mở khóa tạm và xử lý lại.' : '';
      m.set(s.id, {
        locked,
        done,
        reason: lockedDueToMonth ? monthReason : (pending ? (prev.reason || 'Vui lòng hoàn tất bước trước.') : ''),
        completedReason: done && !lockedDueToMonth ? `Bước "${s.title || s.id}" đã hoàn tất — tab đã khóa để giữ số liệu đã chốt.` : (done ? `Bước "${s.title || s.id}" đã hoàn tất và tháng đã khóa — tab đã khóa để giữ số liệu đã chốt.` : ''),
        stat: s.stat,
        completedAt: s.completedAt || '',
        lockedDueToMonth,
        previousStepId: s.previousStepId || prev?.id || null,
        previousTitle: s.previousTitle || prev?.title || null,
        canRollback: !!s.canRollback,
        canGoBack: !!s.canGoBack || !!prev,
      });
    }
    return m;
  }, [workflow, monthLocked]);
  // Bước đang xử lý: chưa done đầu tiên theo đúng thứ tự workflow.
  const currentOpenStep = useMemo(() => {
    if (!workflow?.steps?.length) return null;
    return workflow.steps.find((s: any) => !s.done) || null;
  }, [workflow]);

  const isTabOpen = (id: string) => { const l = tabLocked.get(id); return !l ? true : !l.locked; };
  const stageBadge = (stage?: string | null) => { const c = (STAGE_COLOR as any)[String(stage || 'DRAFT')]; return { ...c, label: (PAYSLIP_STAGE_LABEL as any)[String(stage || 'DRAFT')] || '—' }; };
  const slipQrUrl = slipQrUrlOf;

  // --- QUAY VỀ BƯỚC TRƯỚC (khi bước sai): ghi lý do, mở đúng bước mục tiêu lại
  //     (backend workflowOverride ép bước mục tiêu chưa xong), rồi điều hướng về
  //     bước trước. Realtime qua workflow-status. Cho phép kể cả PAID.
  //     Lấy tiêu đề bước trước từ TAB ĐANG XEM (activeTab), không phải bước đang xử lý.
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const rollbackToPrevious = useCallback(async (toStepId: string, fromTabId?: string) => {
    if (!toStepId) return;
    const lockedInfo = tabLocked.get(fromTabId || activeTab);
    const prevTitle = lockedInfo?.previousTitle || tabLocked.get(toStepId)?.previousTitle || '';
    const reason = window.prompt(`Quay về bước trước${prevTitle ? ` (${prevTitle})` : ''}?\nBước này sẽ MỞ LẠI để sửa (các bước sau khóa lại). Phiếu liên quan sẽ được hoàn về trạng thái trước bước đó. Vui lòng ghi LÝ DO quay về:`);
    if (reason === null) return;
    if (!String(reason).trim()) { showToast('Vui lòng ghi lý do quay về bước trước!'); return; }
    const paidSlips = slips.filter((s: any) => String(s?.status || '').toUpperCase() === 'PAID').length;
    const extraWarn = paidSlips > 0 ? `\n\n⚠️ Kỳ này có ${paidSlips} phiếu PAID — quay về sẽ hoàn ${paidSlips} phiếu để tính lại (xóa chữ ký NV). Hãy đối soát/thu hồi tiền ngoài hệ thống trước!` : '';
    if (!window.confirm(`Xác nhận quay về bước trước với lý do:\n${String(reason).trim()}\n\nTiếp tục?${extraWarn}`)) return;
    setRollbackBusy(true);
    try {
      const r: any = await post('/payroll/workflow/rollback', { period: month, stepId: toStepId, reason: String(reason).trim() });
      const payload: any = r?.result ?? r ?? {};
      const wf = payload?.workflow || r?.workflow || null;
      if (wf) setWorkflow(wf);
      showToast(`Đã quay về bước trước — hoàn ${payload?.revertedSlips ?? r?.revertedSlips ?? 0} phiếu${payload?.revertedPaid || r?.revertedPaid ? ` (gồm ${payload?.revertedPaid ?? r?.revertedPaid} PAID)` : ''} · đang mở bước ${prevTitle || toStepId}`);
      // Điều hướng NGAY tới bước mục tiêu; workflow mới đã chứa open=true cho bước đó.
      onNavigateTab?.(toStepId);
      await loadWorkflow();
    } catch (e: any) {
      showToast(e?.message || 'Quay về bước trước thất bại');
    } finally {
      setRollbackBusy(false);
      refreshCurrentTab();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, post, showToast, tabLocked, refreshCurrentTab, onNavigateTab, activeTab, slips]);

  // Nút quay về ở tab Kỳ lương bắn event này → gọi cùng rollbackToPrevious
  // (đặt SAU rollbackToPrevious để tránh TDZ ReferenceError).
  const handleRollbackKyLuong = useCallback((_evt: Event) => {
    const lastStepId = workflow?.steps?.[workflow.steps.length - 1]?.id || 'fin-payment';
    const prevId = (workflow?.steps?.find((s: any) => s.id === lastStepId) as any)?.previousStepId || 'fin-payslips';
    void rollbackToPrevious(prevId, lastStepId);
  }, [workflow, rollbackToPrevious]);
  useEffect(() => {
    const h = handleRollbackKyLuong as any;
    window.addEventListener('ubm:rollback-kyluong', h);
    return () => { window.removeEventListener('ubm:rollback-kyluong', h); };
  }, [handleRollbackKyLuong]);

  const fastSignLap = useCallback(async (itemId: string) => { try { await post(`/payroll/slips/${encodeURIComponent(itemId)}/fast-sign`, { lapName: 'Kế toán viên', lapImg: '', qlName: '', qlImg: '' }); showToast(`Đã ký lập phiếu ${itemId.replace('SLIP_', '')}`); refreshCurrentTab(); } catch (e: any) { showToast(e?.message || 'Ký lập thất bại'); } }, [post, showToast, refreshCurrentTab]);
  const fastSignLapAll = useCallback(async () => {
    const targets = (slips || []).filter((s: any) => String(s?.status || '').toUpperCase() === 'DRAFT' && !s?.sign_lap);
    if (!targets.length) { showToast('Không có phiếu nào chờ Kế toán ký lập (tất cả đã có chữ ký KT hoặc không phải DRAFT).'); return; }
    if (!window.confirm(`KÝ LẬP HÀNG LOẠT ${targets.length} phiếu DRAFT chưa có chữ ký Kế toán bằng chữ ký mẫu? Kế toán ký xong là Giám đốc sẽ thấy phiếu để ký.`)) return;
    let ok = 0; const fails: string[] = [];
    for (const s of targets) {
      try { await post(`/payroll/slips/${encodeURIComponent(String((s as any).item_id))}/fast-sign`, { lapName: 'Kế toán viên', lapImg: '', qlName: '', qlImg: '' }); ok++; }
      catch (e: any) { fails.push(`${(s as any).full_name || (s as any).employee_code || (s as any).item_id}: ${e?.message || ''}`); }
    }
    showToast(`Đã ký lập ${ok}/${targets.length} phiếu${fails.length ? ` — lỗi ${fails.length}: ${fails.slice(0, 2).join('; ')}` : ''}`);
    refreshCurrentTab();
  }, [post, showToast, refreshCurrentTab, slips]);
  const publishSlip = useCallback(async (itemId: string) => { if (!window.confirm('Gửi phiếu này đến nhân viên? Sau khi gửi, nhân viên có thể ký xác nhận.')) return; try { await post(`/payroll/slips/${encodeURIComponent(itemId)}/publish`, {}); showToast('Đã gửi phiếu lương đến nhân viên'); refreshCurrentTab(); } catch (e: any) { showToast(e?.message || 'Gửi thất bại'); } }, [post, showToast, refreshCurrentTab]);
  const returnSlip = useCallback(async (itemId: string) => { const reason = window.prompt('Thu hồi phiếu về DRAFT để kiểm tra lại? Vui lòng ghi lý do (hiển thị audit):', 'Kiểm tra lại sau khiếu nại chưa đúng'); if (reason === null) return; try { await post(`/payroll/slips/${encodeURIComponent(itemId)}/return`, {}); showToast('Đã hoàn phiếu về DRAFT — kiểm tra lại rồi ký/gửi lại'); refreshCurrentTab(); } catch (e: any) { showToast(e?.message || 'Hoàn phiếu thất bại'); } }, [post, showToast, refreshCurrentTab]);
  const markPaidSlip = useCallback(async (itemId: string) => { if (!window.confirm('Xác nhận ĐÃ CHUYỂN KHOẢN? Phiếu sẽ bị KHÓA và đồng bộ PDF lên Google Drive 04.')) return; try { const r = await post(`/payroll/slips/${encodeURIComponent(itemId)}/mark-paid`, {}); showToast('Đã chuyển khoản — phiếu khóa & đồng bộ Drive 04' + (r?.driveSync?.ok ? ' ✓' : '')); refreshCurrentTab(); } catch (e: any) { showToast(e?.message || 'Thanh toán thất bại'); } }, [post, showToast, refreshCurrentTab]);
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
  const saveFormula = useCallback(async () => {
    const rateTV = Math.floor(Number(formula?.rateTV));
    const rateCT = Math.floor(Number(formula?.rateCT));
    const t1 = Number(formula?.otThreshold1 ?? 10);
    const t2 = Number(formula?.otThreshold2 ?? 15);
    if (!Number.isFinite(rateTV) || rateTV <= 0) { showToast('Đơn giá TV phải > 0!'); return; }
    if (!Number.isFinite(rateCT) || rateCT <= 0) { showToast('Đơn giá CT phải > 0!'); return; }
    if (!Number.isFinite(t1) || !Number.isFinite(t2) || t1 < 0 || t2 <= t1 || t2 > 24) { showToast('Ngưỡng tăng ca phải 0 ≤ T1 < T2 ≤ 24!'); return; }
    try { await put(`/payroll/formula/${encodeURIComponent(month)}`, { rateTV, rateCT, otPerSlot: 0, otThreshold1: t1, otThreshold2: t2 }); showToast('Đã lưu công thức lương'); loadFormula(); } catch (e: any) { showToast(e?.message || 'Lưu công thức thất bại'); }
  }, [put, month, formula, showToast, loadFormula]);
  /** Payload chuẩn backend (employeeId camelCase + note string) từ ô đang sửa. */
  const buildInputPayload = useCallback((employeeId: string, field: string, value: string) => {
    const existing = (inputsRef.current || []).find((i: any) => i.employee_id === employeeId) || {};
    // Lưu ý: period/employeeId phải thắng existing (tránh dính kỳ cũ sau khi đổi tháng).
    const payload: any = { luong_cb: 0, ot_extra: 0, bonus_extra: 0, ung_luong: 0, tru_kpi: 0, dong_phuc: 0, note: '', ...existing, employeeId, employee_id: employeeId, period: month };
    const num = Number(value);
    payload[field] = field === 'note' ? String(value ?? '').slice(0, 1000) : (isNaN(num) ? 0 : Math.max(0, Math.floor(num)));
    payload.note = String(payload.note ?? '').slice(0, 1000);
    payload.employeeId = employeeId;
    payload.employee_id = employeeId;
    return payload;
  }, [month]);

  /** Gửi 1 ô đang chờ lên server (best-effort; lỗi thì trả lại hàng đợi để thử lại). */
  const flushInputKey = useCallback(async (key: string) => {
    const p = inputPendingRef.current.get(key);
    if (!p) return;
    inputPendingRef.current.delete(key);
    setPendingCount(inputPendingRef.current.size);
    const cur = (inputsRef.current || []).find((i: any) => i.employee_id === p.employeeId) || ({} as any);
    inputInflightRef.current += 1;
    try {
      await put(`/payroll/inputs/${encodeURIComponent(month)}`, buildInputPayload(p.employeeId, p.field, String(cur[p.field] ?? '')));
      setInputsSavedAt(new Date());
    } catch (e: any) {
      inputPendingRef.current.set(key, p);
      setPendingCount(inputPendingRef.current.size);
      showToast(e?.message || 'Lưu nhập tay thất bại — sẽ thử lại khi bạn gõ tiếp');
    } finally {
      inputInflightRef.current = Math.max(0, inputInflightRef.current - 1);
      setInputsSaving(inputPendingRef.current.size > 0 || inputTimersRef.current.size > 0 || inputInflightRef.current > 0);
    }
  }, [put, month, buildInputPayload, showToast]);

  /** Gọi mỗi lần gõ phím: cập nhật local ngay + hẹn lưu server sau 800ms. */
  const upsertInput = useCallback((employeeId: string, field: string, value: string) => {
    // Giữ NGUYÊN chuỗi đang gõ ("" khi xóa trắng) để ô nhập xóa được & gõ tiếp được.
    // Quy đổi số chỉ khi gửi server (buildInputPayload/flush) — trước đây đổi số ngay
    // khiến xóa trắng là nhảy thành 0, không gõ tiếp được ("nhập tay không hoạt động").
    const val = field === 'note' ? String(value ?? '').slice(0, 1000) : String(value ?? '');
    setInputs((prev: any[]) => {
      const arr = Array.isArray(prev) ? [...prev] : [];
      const i = arr.findIndex(x => x.employee_id === employeeId);
      if (i >= 0) arr[i] = { ...arr[i], [field]: val };
      else arr.push({ employee_id: employeeId, employeeId, period: month, luong_cb: '', ot_extra: '', bonus_extra: '', ung_luong: '', tru_kpi: '', dong_phuc: '', note: field === 'note' ? val : '', [field]: val });
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
    // Chỉ báo "đã lưu" khi tab nhập tay đã ghi xong lên Google Sheets — reload
    // hoặc restart server ngay sau đó vẫn khôi phục đủ dữ liệu.
    try {
      await post(`/payroll/inputs/${encodeURIComponent(month)}/flush`, {});
      showToast(flushed > 0 ? `Đã lưu ${flushed} ô và đồng bộ Google Sheets` : 'Đã đồng bộ Google Sheets — không có ô nào chờ lưu');
    } catch (e: any) {
      showToast(e?.message || 'Đã lưu vào hệ thống nhưng CHƯA ghi được Google Sheets — vui lòng thử lại');
    }
  }, [flushAllPendingInputs, post, month, showToast]);
  /** Tính lương kỳ (công thức Excel) + tạo/cập nhật phiếu — thay cho nút "Tính lương" bị thiếu ở bản cũ. */
  const runCalculate = useCallback(async () => {
    if (!window.confirm(`TÍNH LƯƠNG ${periodLabel(month)} theo CÔNG THỨC EXCEL?\nTỔNG CỘNG = LCB + giờ công + OT thêm + Bonus; THỰC LÃNH = TỔNG CỘNG − KPI − phạt − ứng − đồng phục.\nHệ thống sẽ tạo/cập nhật kỳ lương và phiếu cho toàn bộ nhân viên.`)) return;
    setCalcBusy(true);
    try {
      // Flush mọi ô nhập tay đang chờ trước khi tính — nếu không, kỳ lương đọc số cũ.
      await flushAllPendingInputs();
      const r: any = await post(`/payroll/${encodeURIComponent(month)}/calculate-formula`, { branchScope: '*' }, { _timeoutMs: 180000 });
      const res = r?.result ?? r;
      showToast(`Đã tính lương ${periodLabel(month)}: ${res?.run?.total_employees ?? '?'} NV — thực lãnh ${formatVND(res?.run?.total_amount || 0)}`);
      await post(`/payroll/period-slips/${encodeURIComponent(month)}/ensure`, { branchScope: '*' }, { _timeoutMs: 180000 }).catch(() => null);
      await Promise.all([loadSlips(), loadRuns(), loadWorkflow()]);
      refreshCurrentTab();
    } catch (e: any) { showToast(e?.message || 'Tính lương thất bại'); } finally { setCalcBusy(false); }
  }, [post, month, showToast, loadSlips, loadRuns, loadWorkflow, refreshCurrentTab, flushAllPendingInputs]);

  // CHỈ tài khoản FINANCE mới thấy thanh QUY TRÌNH KẾ TOÁN tuần tự/sẽ bị khóa theo workflow.
  // Các tài khoản khác (ADMIN, DIRECTOR, HR...) không hiển thị thanh quy trình và không bị khóa tuần tự khi mở tab.
  const isFinance = String((currentUser as any)?.role || '').toUpperCase() === 'FINANCE';
  const open = isFinance ? isTabOpen(activeTab) : true;
  const activeLock = tabLocked.get(activeTab);
  const activeStepDone = !!activeLock?.done;
  const lockReason = activeStepDone ? (activeLock?.completedReason || '') : (activeLock?.reason || '');
  const lockMeta = activeLock?.completedAt ? `Hoàn tất lúc: ${fmtDateTime(activeLock.completedAt)}` : '';
  // Cho phép XEM lại bước đã xong / tháng đã khóa ở chế độ chỉ xem (bấm nút ở lockscreen),
  // để kế toán kiểm tra dữ liệu trước khi quay về bước trước sửa số.
  const [viewLockedContent, setViewLockedContent] = useState(false);
  useEffect(() => { setViewLockedContent(false); }, [activeTab, month]);
  const isPendingLock = isFinance ? (!open && !activeStepDone) : false;
  const showTabContent = isFinance ? (open || (activeStepDone && viewLockedContent)) : true;
  const firstOpenStep = useMemo(() => {
    if (currentOpenStep?.id) return currentOpenStep.id;
    for (const s of PROCESS_STEPS) { if (s.id === 'fin-dashboard') continue; if (isTabOpen(s.id)) return s.id; }
    return 'fin-dashboard';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow, currentOpenStep]);
  const goTab = useCallback((id: string) => { onNavigateTab?.(id); }, [onNavigateTab]);

  // Xác nhận hoàn tất bước Đối soát/BCC theo đúng tháng (realtime cho mọi máy).
  const confirmWorkflowStep = useCallback(async (stepId: string) => {
    const r: any = await post('/payroll/workflow/confirm', { period: month, stepId });
    const payload: any = r?.result ?? r ?? {};
    if (payload?.workflow) setWorkflow(payload.workflow);
    else await loadWorkflow();
    broadcastUpdate?.('payroll', { action: 'workflow-confirm', period: month, stepId });
    return payload;
  }, [post, month, loadWorkflow]);

  // Thanh cuộn ngang NGAY khi click chuột vào bảng: bấm vào bảng → dùng phím mũi tên
  // ← → cuộn ngang nhanh (Shift + ← → cuộn 3×), ↑ ↓ cuộn dọc. Kéo chuột để cuộn
  // cũng được (grab). Áp dụng cho MỌI bảng .fin-table-wrap của mọi tab Finance.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const enhance = (wrap: HTMLElement) => {
      if (!wrap.hasAttribute('tabindex')) { wrap.setAttribute('tabindex', '0'); wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', wrap.getAttribute('aria-label') || 'Bảng — bấm rồi dùng phím ← → để cuộn ngang'); }
      if (!wrap.querySelector('.fin-scroll-hint')) {
        const hint = document.createElement('div');
        hint.className = 'fin-scroll-hint';
        hint.textContent = '⤢ Đã vào bảng — dùng ← → cuộn ngang · ↑ ↓ cuộn dọc';
        wrap.prepend(hint);
      }
    };
    const enhanceAll = () => { root.querySelectorAll<HTMLElement>('.fin-table-wrap').forEach(enhance); };
    enhanceAll();
    const mo = new MutationObserver(() => enhanceAll());
    mo.observe(root, { childList: true, subtree: true });

    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const wrap = (t?.closest?.('.fin-table-wrap') as HTMLElement | null) || null;
      if (!wrap || !root.contains(wrap)) return;
      // Không cướp phím mũi tên khi đang gõ trong ô nhập liệu/textarea/select của bảng.
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t as any)?.isContentEditable) return;
      const step = e.shiftKey ? 240 : 80;
      const vStep = e.shiftKey ? 180 : 60;
      if (e.key === 'ArrowLeft') { e.preventDefault(); wrap.scrollBy({ left: -step }); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); wrap.scrollBy({ left: step }); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); wrap.scrollBy({ top: -vStep }); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); wrap.scrollBy({ top: vStep }); }
      else if (e.key === 'Home') { e.preventDefault(); wrap.scrollTo({ left: 0 }); }
      else if (e.key === 'End') { e.preventDefault(); wrap.scrollTo({ left: wrap.scrollWidth }); }
    };
    // Kéo chuột (grab) để cuộn ngang cho nhanh.
    let drag: { wrap: HTMLElement; x: number; y: number; sl: number; st: number } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      const wrap = (e.target as HTMLElement | null)?.closest?.('.fin-table-wrap') as HTMLElement | null;
      if (!wrap || !root.contains(wrap)) return;
      if ((e.target as HTMLElement)?.closest?.('input,textarea,select,button,a,[contenteditable]')) return;
      drag = { wrap, x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
      wrap.setPointerCapture?.(e.pointerId);
      wrap.style.cursor = 'grabbing';
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!drag) return;
      drag.wrap.scrollLeft = drag.sl - (e.clientX - drag.x);
      drag.wrap.scrollTop = drag.st - (e.clientY - drag.y);
    };
    const onPointerUp = () => {
      if (!drag) return;
      drag.wrap.style.cursor = '';
      drag = null;
    };
    document.addEventListener('keydown', onKeyDown as any, { passive: false });
    document.addEventListener('pointerdown', onPointerDown as any);
    document.addEventListener('pointermove', onPointerMove as any);
    document.addEventListener('pointerup', onPointerUp as any);
    document.addEventListener('pointercancel', onPointerUp as any);
    return () => {
      mo.disconnect();
      document.removeEventListener('keydown', onKeyDown as any);
      document.removeEventListener('pointerdown', onPointerDown as any);
      document.removeEventListener('pointermove', onPointerMove as any);
      document.removeEventListener('pointerup', onPointerUp as any);
      document.removeEventListener('pointercancel', onPointerUp as any);
    };
  }, []);

  // Chuyển trạng thái KỲ LƯƠNG cấp run: DRAFT -> RECONCILED (Đối soát) -> APPROVED (Phê duyệt).
  // PUBLISHED/PAID của PHỤC KHÔNG dùng ở đây: phiếu được phát hành/chi trả TỪNG PHIẾU
  // ở tab 7 (đủ chữ ký 3 bên) và tab 8 — nút chuyển trạng thái cấp kỳ sẽ phát hành/
  // chi trả hàng loạt không qua chữ ký, sai quy trình xuất phiếu.
  const payRunAction = useCallback(async (runId: string, action: 'reconcile' | 'approve') => {
    const labels: Record<string, string> = {
      reconcile: 'Đối soát (đánh dấu kỳ đã chốt số tính)',
      approve: 'Phê duyệt (người duyệt phải khác người tính)',
    };
    if (!window.confirm(`${labels[action]} kỳ ${runId}?`)) return;
    try {
      await post(`/payroll/${encodeURIComponent(runId)}/${action}`, {});
      showToast(`Đã ${labels[action].toLowerCase()} kỳ lương!`);
      refreshCurrentTab();
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('SEPARATION_OF_DUTIES_VIOLATION')) showToast('⚠️ Người tính lương không được tự duyệt kỳ của mình!');
      else showToast(e?.message || 'Lỗi chuyển trạng thái kỳ!');
    }
  }, [post, showToast, refreshCurrentTab]);

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

      {isFinance && monthLocked && (
        <div className="fin-warn" role="alert" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Lock size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <b>Tháng {periodLabel(month)} đã kết thúc — quy trình kế toán đã KHÓA toàn bộ các bước</b> (chỉ xem, không sửa).
            Tháng mới ({periodLabel(curPeriod)}) không bị khóa — chuyển sang tháng mới để xử lý tiếp.
            Nếu bước nào sai, bấm nút <b>“↩ Quay về bước trước”</b> ngay bên dưới để mở khóa tạm (ghi lý do, hoàn phiếu về DRAFT, realtime cho mọi máy), hoặc bấm vào từng bước ở thanh stepper để xem màn hình khóa của bước đó.
            {monthUnlockInfo ? <span style={{ display: 'block', marginTop: 4, fontSize: 11 }}>Đã mở khóa tạm lúc {fmtDateTime(monthUnlockInfo.at)} bởi {monthUnlockInfo.by} — lý do: {monthUnlockInfo.reason}</span> : null}
          </div>
          <button type="button" className="fin-btn fin-btn-amber fin-btn-sm" disabled={rollbackBusy || !currentOpenStep?.previousStepId && !workflow?.steps?.length}
            onClick={() => {
              const target = (currentOpenStep as any)?.previousStepId || workflow?.steps?.[workflow.steps.length - 1]?.previousStepId || 'fin-payroll-periods';
              void rollbackToPrevious(target, currentOpenStep?.id || 'fin-payment');
            }}>
            {rollbackBusy ? 'Đang quay về…' : '↩ Quay về bước trước'}
          </button>
        </div>
      )}

      {/* ═══════════ DRIVE SYNC BAR ═══════════ */}
      <section className="fin-drivebar" aria-label="Đồng bộ Google Drive">
        <span className={`fin-drive-chip ${driveConfigured ? 'ok' : 'err'}`}><HardDrive size={12} /> DRIVE: {driveConfigured ? 'SẴN SÀNG' : 'CHƯA CẤU HÌNH'}</span>
        {syncStatus?.last && (
          <span className="fin-drive-meta">Đồng bộ gần nhất ({periodLabel(syncStatus?.last?.period || month)}): {fmtDateTime(syncStatus?.last?.at)} — {syncStatus?.last?.ok ? '✓ OK' : '✗ LỖI'}</span>
        )}
        <span className="fin-drive-path" title="Cấu trúc thư mục tự tạo trên Google Drive">04. PHIẾU LƯƠNG NHÂN VIÊN → THANG_MM → CHI_NHANH_… → PHIEU_LUONG_TMM.YYYY_TÊN NV.pdf&nbsp;&nbsp;|&nbsp;&nbsp;THANG_MM_YYYY/01…07_*.xlsx</span>
        <div className="fin-drive-actions">
          <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" disabled={!driveConfigured} onClick={syncMonthDrive}
            title="Tự tạo cây thư mục tháng + xuất Excel từng chức năng + PDF phiếu đã xác nhận/đã thanh toán lên Drive 04">
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

      {/* ═══════════ STEPPER QUY TRÌNH — CHỈ FINANCE ═══════════ */}
      {isFinance && (<nav className="fin-stepper-wrap" aria-label="Các bước xử lý lương">
        <div className="fin-stepper-title">
          <span>QUY TRÌNH KẾ TOÁN — XỬ LÝ TUẦN TỰ (REALTIME) · {periodLabel(month)} · THEO TỪNG THÁNG{monthLocked ? ' · ĐÃ KHÓA (HẾT THÁNG NÀY)' : ''}</span>
          <em>Tháng nào theo tháng đó (độc lập, không dùng chung): chỉ bước đang xử lý được mở · xong bước nào khóa bước đó · bước sau mở khi bước trước xong{currentOpenStep ? ` — đang xử lý: ${currentOpenStep.title}` : ' — đã hoàn tất toàn bộ'}{complainedCount ? ` · ⚠️ ${complainedCount} phiếu bị khiếu nại chờ kiểm tra lại` : ''}</em>
        </div>
        <div className="fin-stepper">
          {PROCESS_STEPS.map(t => {
            const l = tabLocked.get(t.id);
            const locked = t.id === 'fin-dashboard' ? false : (l ? l.locked : false);
            const wfStep = workflow?.steps?.find((s: any) => s.id === t.id);
            const done = !!wfStep?.done;
            const cur = activeTab === t.id;
            const cls = done && locked ? 'is-done is-locked' : locked ? 'is-locked' : cur ? 'is-current' : 'is-open';
            const Icon = t.icon;
            return (
              <button
                type="button"
                key={t.id}
                className={`fin-step ${cls}`}
                // KHÔNG disabled khi khóa: cho phép bấm vào để XEM màn hình khóa +
                // nút "Quay về bước trước" (sau khi xong/khóa hết/tháng đã khóa mới
                // cần quay về). Nút khóa vẫn giữ visual is-locked, chỉ không chặn click.
                onClick={() => goTab(t.id)}
                title={`${done ? (l?.completedReason || 'Đã hoàn tất — bấm để xem lý do khóa & nút quay về') : locked ? (l?.reason || 'Chưa mở khóa — hoàn tất bước trước') : t.label} — bấm để vào`}
                aria-current={cur ? 'step' : undefined}
              >
                <span className="fin-step-dot">{done ? <Check size={15} strokeWidth={3} /> : locked ? <Lock size={13} /> : <Icon size={15} />}</span>
                <span className="fin-step-name">{t.step}. {t.label}</span>
                <span className="fin-step-status">{done ? '✓ Xong — đã khóa (xem)' : locked ? 'Đã khóa (xem)' : (wfStep?.stat || 'Đang xử lý')}</span>
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
      </nav>)}

      {!isFinance && activeTab === 'fin-payroll-periods' && (
        <div style={{ border: '1.5px solid #fcd34d', background: '#fffbeb', borderRadius: 12, padding: '10px 14px' }}>
          <b style={{ fontSize: 12 }}>Duyệt kỳ (ADMIN):</b>
          <span style={{ fontSize: 11, color: 'var(--fin-muted)' }}> Bấm <b>Đối soát kỳ</b> (DRAFT → RECONCILED) rồi <b>Phê duyệt kỳ</b> (RECONCILED → APPROVED). ADMIN được duyệt kỳ của mình.</span>
        </div>
      )}

      {/* ═══════════ LOCK SCREEN — bước chưa mở (pending) mới chặn hẳn; bước đã xong/tháng khóa cho xem lại ═══════════ */}
      {isPendingLock && !viewLockedContent ? (
        <div className="fin-lockscreen" role="alert">
          <div className="fin-lock-icon">{activeStepDone ? <Check size={30} strokeWidth={3} /> : <Lock size={30} />}</div>
          <h3>{activeStepDone ? 'Bước đã hoàn tất — tab đã khóa' : 'Bước này đang bị khóa theo quy trình kế toán'}</h3>
          <p>{lockReason || 'Vui lòng hoàn tất các bước trước trong quy trình.'}</p>
          {lockMeta && <p style={{ fontSize: 11, color: 'var(--fin-muted)' }}>{lockMeta} — số liệu bước này đã chốt, không sửa trên tab này nữa.</p>}
          {activeStepDone && currentOpenStep && <p style={{ fontSize: 11 }}>Bước đang xử lý tiếp theo: <b>{currentOpenStep.title}</b></p>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 6 }}>
            {activeLock?.previousStepId && (
              <button type="button" className="fin-btn fin-btn-amber" disabled={rollbackBusy} onClick={() => rollbackToPrevious(activeLock.previousStepId!)}>
                <ArrowRight size={14} style={{ transform: 'scaleX(-1)' }} /> {rollbackBusy ? 'Đang quay về…' : `↩ Quay về bước trước${activeLock.previousTitle ? ` — ${activeLock.previousTitle}` : ''}`}
              </button>
            )}
            {firstOpenStep !== activeTab && (
              <button type="button" className="fin-btn fin-btn-dark" onClick={() => goTab(firstOpenStep)}>
                <ArrowRight size={14} /> Quay về bước đang xử lý
              </button>
            )}
            <button type="button" className="fin-btn fin-btn-ghost" onClick={() => goTab('fin-dashboard')}>
              Về Tổng quan (chỉ xem)
            </button>
          </div>
          {activeLock?.previousStepId && <p style={{ fontSize: 11, color: 'var(--fin-muted)' }}>Nút quay về: hoàn phiếu (đã gửi/khiếu nại/xác nhận/ĐÃ CHUYỂN KHOẢN) về DRAFT + kỳ lương về DRAFT, mở khóa tháng, mọi máy cập nhật realtime.</p>}
        </div>
      ) : activeStepDone && viewLockedContent ? (
        <div className="fin-past-banner" role="status" style={{ alignItems: 'center' }}>
          <Lock size={16} />
          <div style={{ flex: 1 }}>
            <b>Đang xem lại bước đã hoàn tất ở chế độ chỉ xem</b> ({lockReason || 'Đã khóa để giữ số liệu'})
            {lockMeta ? ` — ${lockMeta}` : ''}
          </div>
          {activeLock?.previousStepId && (
            <button type="button" className="fin-btn fin-btn-amber" disabled={rollbackBusy} onClick={() => rollbackToPrevious(activeLock.previousStepId!)}>
              ↩ Quay về bước trước{activeLock.previousTitle ? ` — ${activeLock.previousTitle}` : ''}
            </button>
          )}
          <button type="button" className="fin-btn fin-btn-ghost" onClick={() => setViewLockedContent(false)}>Khóa lại</button>
        </div>
      ) : !open ? (
        <div className="fin-lockscreen" role="alert">
          <div className="fin-lock-icon"><Lock size={30} /></div>
          <h3>Bước này đang bị khóa theo quy trình kế toán</h3>
          <p>{lockReason || 'Vui lòng hoàn tất các bước trước trong quy trình.'}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 6 }}>
            {activeLock?.previousStepId && (
              <button type="button" className="fin-btn fin-btn-amber" disabled={rollbackBusy} onClick={() => rollbackToPrevious(activeLock.previousStepId!)}>
                ↩ Quay về bước trước{activeLock.previousTitle ? ` — ${activeLock.previousTitle}` : ''}
              </button>
            )}
            {firstOpenStep !== activeTab && (
              <button type="button" className="fin-btn fin-btn-dark" onClick={() => goTab(firstOpenStep)}>
                <ArrowRight size={14} /> Quay về bước đang xử lý
              </button>
            )}
            <button type="button" className="fin-btn fin-btn-ghost" onClick={() => goTab('fin-dashboard')}>Về Tổng quan (chỉ xem)</button>
            <button type="button" className="fin-btn fin-btn-ghost" onClick={() => setViewLockedContent(true)}>👁 Xem dữ liệu bước này (chỉ xem)</button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--fin-muted)' }}>Bấm vào bước ở thanh stepper để quay lại màn hình này bất cứ lúc nào. Nếu bước này sai, bấm <b>“↩ Quay về bước trước”</b> để hoàn về DRAFT và xử lý lại.</p>
        </div>
      ) : null}

      {/* ═══════════ NỘI DUNG TAB ═══════════ */}
      {showTabContent && (
        <main style={{ flex: 1 }}>
          {activeTab === 'fin-dashboard' && <DashboardTab month={month} finSheet={finSheet} finSheetLoading={finSheetLoading} slips={slips} workflow={workflow} formatVND={formatVND} />}
          {activeTab === 'fin-timesheet' && <TimesheetTab month={month} finSheet={finSheet} finSheetLoading={finSheetLoading} loadFinSheet={loadFinSheet} formatVND={formatVND} cols={colsVisible('fin-timesheet')} onToggleCol={toggleCol} onShowAllCols={showAllCols} colVis={colVis} colVisSaving={colVisSaving} colDefs={FIN_COL_DEFS['fin-timesheet']} workflowStep={workflow?.steps?.find((s: any) => s.id === 'fin-timesheet') || null} onConfirmStep={confirmWorkflowStep} showToast={showToast} />}
          {activeTab === 'fin-bcc' && <BccTab month={month} finSheet={finSheet} finSheetLoading={finSheetLoading} formatVND={formatVND} cols={colsVisible('fin-bcc')} onToggleCol={toggleCol} onShowAllCols={showAllCols} colVis={colVis} colVisSaving={colVisSaving} colDefs={FIN_COL_DEFS['fin-bcc']} workflowStep={workflow?.steps?.find((s: any) => s.id === 'fin-bcc') || null} onConfirmStep={confirmWorkflowStep} showToast={showToast} />}
          {activeTab === 'fin-calculate' && <CalculateTab month={month} formula={formula} setFormula={setFormula} inputs={inputs} inputsLoading={inputsLoading} allEmployees={allEmployees} finSheet={finSheet} finSheetLoading={finSheetLoading} salaryConfigs={salaryConfigs} saveFormula={saveFormula} upsertInput={upsertInput} saveAllInputs={saveAllInputs} loadFormula={loadFormula} loadInputs={loadInputs} runCalculate={runCalculate} calcBusy={calcBusy} runs={runs} inputsSaving={inputsSaving} pendingCount={pendingCount} inputsSavedAt={inputsSavedAt} cols={colsVisible('fin-calculate')} onToggleCol={toggleCol} onShowAllCols={showAllCols} colVis={colVis} colVisSaving={colVisSaving} colDefs={FIN_COL_DEFS['fin-calculate']} />}
          {activeTab === 'fin-payroll-sheet' && <PayrollSheetTab month={month} slips={slips} allEmployees={allEmployees} formatVND={formatVND} stageBadge={stageBadge} cols={colsVisible('fin-payroll-sheet')} onToggleCol={toggleCol} onShowAllCols={showAllCols} colVis={colVis} colVisSaving={colVisSaving} colDefs={FIN_COL_DEFS['fin-payroll-sheet']} />}
          {activeTab === 'fin-payroll-periods' && <PayrollPeriodsTab month={month} runs={runs} runsLoading={runsLoading} loadRuns={loadRuns} slips={slips} allEmployees={allEmployees} formatVND={formatVND} runCalculate={runCalculate} calcBusy={calcBusy} payRunAction={payRunAction} onNavigateTab={goTab} inputs={inputs} loadInputs={loadInputs} loadSlips={loadSlips} showToast={showToast} cols={colsVisible('fin-payroll-periods')} onToggleCol={toggleCol} onShowAllCols={showAllCols} colVis={colVis} colVisSaving={colVisSaving} colDefs={FIN_COL_DEFS['fin-payroll-periods']} />}
          {activeTab === 'fin-payslips' && <PayslipsTab month={month} slips={slips} slipsLoading={slipsLoading} allEmployees={allEmployees} formatVND={formatVND} loadSlips={loadSlips} stageBadge={stageBadge} slipQrUrl={slipQrUrl} fastSignLap={fastSignLap} fastSignLapAll={fastSignLapAll} publishSlip={publishSlip} returnSlip={returnSlip} markPaidSlip={markPaidSlip} syncSlipDrive={syncSlipDrive} downloadSlipPdf={downloadSlipPdf} cols={colsVisible('fin-payslips')} onToggleCol={toggleCol} onShowAllCols={showAllCols} colVis={colVis} colVisSaving={colVisSaving} colDefs={FIN_COL_DEFS['fin-payslips']} />}
          {activeTab === 'fin-payment' && <PaymentTab month={month} slips={slips} allEmployees={allEmployees} formatVND={formatVND} loadSlips={loadSlips} slipQrUrl={slipQrUrl} markPaidSlip={markPaidSlip} downloadSlipPdf={downloadSlipPdf} cols={colsVisible('fin-payment')} onToggleCol={toggleCol} onShowAllCols={showAllCols} colVis={colVis} colVisSaving={colVisSaving} colDefs={FIN_COL_DEFS['fin-payment']} />}
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

function Kpi({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub: string; tone?: 'green' | 'blue' | 'violet' | 'amber' | 'red' }) {
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

/** Nút + panel ẩn/hiện cột cho 1 tab (dùng chung cho mọi tab Finance). */
const FIN_COL_HEADER_COUNT = (tabKey: string, defs: any, cols: any) => {
  const show = cols?.show;
  if (!show || !defs) return 1;
  return (defs as any[]).filter((d: any) => show(d.key)).length || 1;
};
function ColumnSettings({ tabKey, defs, value, onToggle, onShowAll, saving }: any) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={() => setOpen(v => !v)} title="Ẩn/hiện các cột bảng (lưu theo tài khoản, đồng bộ 2 máy)">
        <List size={13} /> {saving ? 'Đang lưu…' : 'Cột hiển thị'}
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 60, width: 280, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 12px 32px rgba(15,23,42,.18)', padding: '10px 12px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 6 }}>Cột hiển thị — tab này (lưu theo tài khoản)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
            {(defs || []).map((d: any) => (
              <label key={d.key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={value?.[tabKey]?.[d.key] !== false} onChange={() => onToggle(tabKey, d.key)} /> {d.label}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" onClick={onShowAll}>Hiện tất cả</button>
            <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={() => setOpen(false)}>Đóng</button>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--fin-muted)', marginTop: 6 }}>Sẽ đồng bộ realtime cho máy khác cùng tài khoản.</div>
        </div>
      )}
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
function TimesheetTab({ month, finSheet, finSheetLoading, loadFinSheet, formatVND, cols, onToggleCol, onShowAllCols, colVis, colVisSaving, colDefs, workflowStep, onConfirmStep, showToast }: any) {
  const fs = finSheet;
  const [q, setQ] = useState('');
  const show = cols?.show || (() => true);
  const groups = useMemo(() => {
    const all: any[] = fs?.rows || [];
    const filtered = all.filter(matchesFilter(q.trim()));
    return branchGroups(filtered, (r: any) => r.branchId);
  }, [fs, q]);
  const filteredCount = groups.reduce((s, g) => s + g.rows.length, 0);
  const colCount = FIN_COL_HEADER_COUNT('fin-timesheet', colDefs, cols);
  const dataReady = !!(fs?.totals?.totalShifts > 0);
  const confirmed = !!workflowStep?.done;
  const [confirming, setConfirming] = useState(false);
  const doConfirm = async () => {
    if (!window.confirm(`Xác nhận đã đối soát công kỳ ${periodLabel(month)}? Sau khi xác nhận, bước này sẽ khóa và bước BCC sẽ mở.`)) return;
    setConfirming(true);
    try { await onConfirmStep('fin-timesheet'); showToast?.('Đã xác nhận Đối soát công — bước BCC đã mở'); }
    catch (e: any) { showToast?.(e?.message || 'Xác nhận thất bại'); }
    finally { setConfirming(false); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TabHead step={2} title="Đối soát công & Bảng chấm công" desc={`Tổng hợp ca/giờ/phạt theo nhân viên — kỳ ${periodLabel(month)}. Dữ liệu realtime từ chấm công + lịch đã phát hành.`}>
        <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" onClick={loadFinSheet} disabled={finSheetLoading}>{finSheetLoading ? <Loader2 size={13} className="fin-spin" /> : <RefreshCw size={13} />} Tải lại bảng công</button>
        {!confirmed && (
          <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" onClick={doConfirm} disabled={!dataReady || confirming} title={!dataReady ? 'Chưa có ca đã phát hành — chờ Store/HR xếp ca' : 'Kế toán kiểm tra rồi xác nhận hoàn tất bước Đối soát công'}>
            {confirming ? 'Đang xác nhận…' : '✓ Xác nhận hoàn tất Đối soát công'}
          </button>
        )}
      </TabHead>
      {!dataReady && <div style={{ fontSize: 11, color: 'var(--fin-muted)' }}>Chưa có ca chấm công đã phát hành trong kỳ — chờ Store/HR xếp ca & xác nhận công. Bước vẫn mở, không tự động đóng.</div>}
      <div className="fin-card">
        <CardHead title={`Kỳ ${periodLabel(month)} — ${fs?.fromDate || ''} → ${fs?.toDate || ''}`} icon={<FileSpreadsheet size={14} color="#E85D92" />} sub={fs ? `${fs?.totals?.employees ?? 0} NV • ${fs?.totals?.totalShifts ?? 0} ca • ${Number(fs?.totals?.hours ?? 0).toFixed(1)} giờ` : 'Chưa có dữ liệu'}>
          <SearchBox value={q} onChange={setQ} />
          {q && <span className="fin-chip-stat">{filteredCount} kết quả</span>}
          <ColumnSettings tabKey="fin-timesheet" defs={colDefs} value={colVis} onToggle={onToggleCol} onShowAll={() => onShowAllCols('fin-timesheet')} saving={colVisSaving} />
        </CardHead>
        {finSheetLoading ? (
          <div className="fin-empty">Đang tải bảng chấm công {periodLabel(month)}…</div>
        ) : (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>{show('stt') && <th className="ctr">STT</th>}{show('fullName') && <th>Họ tên</th>}{show('code') && <th>Mã NV</th>}{show('branch') && <th>Chi nhánh</th>}{show('full') && <th className="num">Ca đủ</th>}{show('partial') && <th className="num">Thiếu</th>}{show('absent') && <th className="num">Vắng</th>}{show('hours') && <th className="num">Giờ công</th>}{show('standardPay') && <th className="num">Lương ca</th>}{show('deduction') && <th className="num">Trừ</th>}{show('netPay') && <th className="num">THỰC NHẬN</th>}</tr>
              </thead>
              <tbody>
                {groups.map(g => {
                  const gh = r1(sumBy(g.rows, 'hours'));
                  const gNet = sumBy(g.rows, 'netPay');
                  return (
                    <React.Fragment key={g.id}>
                      <BranchBandRow label={branchLabelOf(g.id)} count={g.rows.length} cols={colCount} totalText={`${gh.toFixed(1)} giờ • ${formatVND(gNet)}`} />
                      {g.rows.map((r: any, idx: number) => (
                        <tr key={r.employeeId}>
                          {show('stt') && <td className="ctr">{idx + 1}</td>}
                          {show('fullName') && <td style={{ fontWeight: 700 }}>{r.fullName}</td>}
                          {show('code') && <td className="ctr fin-mono">{r.employeeCode}</td>}
                          {show('branch') && <td>{branchLabelOf(r.branchId)}</td>}
                          {show('full') && <td className="num">{r.full ?? 0}</td>}
                          {show('partial') && <td className="num" style={{ color: '#92400e' }}>{r.partial ?? 0}</td>}
                          {show('absent') && <td className="num" style={{ color: 'var(--fin-red)', fontWeight: 800 }}>{r.absent ?? 0}</td>}
                          {show('hours') && <td className="num">{Number(r.hours ?? 0).toFixed(1)}</td>}
                          {show('standardPay') && <td className="num fin-money">{formatVND(r.standardPay)}</td>}
                          {show('deduction') && <td className="num fin-money" style={{ color: 'var(--fin-red)' }}>{formatVND(r.deduction)}</td>}
                          {show('netPay') && <td className="num fin-money" style={{ fontWeight: 800, color: 'var(--fin-green)' }}>{formatVND(r.netPay)}</td>}
                        </tr>
                      ))}
                      <tr className="fin-subtotal">
                        <td colSpan={colCount - 7}>CỘNG {branchLabelOf(g.id).toUpperCase()}</td>
                        {show('full') && <td className="num">{sumBy(g.rows, 'full')}</td>}
                        {show('partial') && <td className="num">{sumBy(g.rows, 'partial')}</td>}
                        {show('absent') && <td className="num">{sumBy(g.rows, 'absent')}</td>}
                        {show('hours') && <td className="num">{gh.toFixed(1)}</td>}
                        {show('standardPay') && <td className="num fin-money">{formatVND(sumBy(g.rows, 'standardPay'))}</td>}
                        {show('deduction') && <td className="num fin-money">{formatVND(sumBy(g.rows, 'deduction'))}</td>}
                        {show('netPay') && <td className="num fin-money">{formatVND(gNet)}</td>}
                      </tr>
                    </React.Fragment>
                  );
                })}
                {groups.length === 0 && <tr><td colSpan={colCount} className="fin-empty">{q ? 'Không tìm thấy nhân viên phù hợp.' : 'Chưa có dữ liệu chấm công tháng này.'}</td></tr>}
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

function BccTab({ month, finSheet, finSheetLoading, formatVND, cols, onToggleCol, onShowAllCols, colVis, colVisSaving, colDefs, workflowStep, onConfirmStep, showToast }: any) {
  const fs = finSheet;
  const [q, setQ] = useState('');
  const show = cols?.show || (() => true);
  const dataReady = !!(fs?.totals?.totalShifts > 0);
  const confirmed = !!workflowStep?.done;
  const [confirming, setConfirming] = useState(false);
  const doConfirm = async () => {
    if (!window.confirm(`Xác nhận đã kiểm tra BCC kỳ ${periodLabel(month)}? Sau khi xác nhận, bước Tính lương sẽ mở.`)) return;
    setConfirming(true);
    try { await onConfirmStep('fin-bcc'); showToast?.('Đã xác nhận BCC — bước Tính lương đã mở'); }
    catch (e: any) { showToast?.(e?.message || 'Xác nhận thất bại'); }
    finally { setConfirming(false); }
  };
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
        <ColumnSettings tabKey="fin-bcc" defs={colDefs} value={colVis} onToggle={onToggleCol} onShowAll={() => onShowAllCols('fin-bcc')} saving={colVisSaving} />
        {!confirmed && (
          <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" onClick={doConfirm} disabled={!dataReady || confirming} title={!dataReady ? 'Chưa có dữ liệu chấm công' : 'Kế toán đã kiểm tra BCC — xác nhận để mở bước Tính lương'}>
            {confirming ? 'Đang xác nhận…' : '✓ Xác nhận hoàn tất BCC'}
          </button>
        )}
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
                    {show('summary') && <>
                      <span className="fin-kv" style={{ color: '#2563eb' }}><b>{Number(r.hours ?? 0).toFixed(1)}</b> giờ</span>
                      <span className="fin-kv" style={{ color: '#166534' }}>Đủ {r.full || 0}</span>
                      <span className="fin-kv" style={{ color: '#92400e' }}>Thiếu {r.partial || 0}</span>
                      <span className="fin-kv" style={{ color: '#b91c1c' }}>Vắng {r.absent || 0}</span>
                      <span className="fin-kv" style={{ color: '#166534', marginLeft: 'auto' }}><b>{formatVND(r.netPay ?? r.standardPay ?? 0)}</b></span>
                    </>}
                  </summary>
                  <div className="fin-details-body">
                    <table className="fin-mini-table">
                      <thead>
                        <tr>{show('date') && <th>Ngày</th>}{show('shift') && <th>Ca</th>}{show('hours') && <th style={{ textAlign: 'center' }}>Giờ</th>}{show('status') && <th>Trạng thái</th>}{show('checkIn') && <th>Check-in</th>}{show('lateMin') && <th style={{ textAlign: 'right' }}>Trễ (phút)</th>}{show('shiftPay') && <th style={{ textAlign: 'right' }}>Lương ca</th>}{show('fineAmount') && <th style={{ textAlign: 'right' }}>Phạt/Trừ</th>}</tr>
                      </thead>
                      <tbody>
                        {(r.shifts || []).map((d: any, idx: number) => {
                          const meta = STATUS_META[String(d.status || '')] || { l: d.status || '—', cls: '' };
                          return (
                            <tr key={`${r.employeeId}-${idx}`}>
                              {show('date') && <td style={{ fontWeight: 700 }}>{String(d.date || '').slice(0, 10)}</td>}
                              {show('shift') && <td>{d.shiftCode || '—'}{d.branchId ? <span style={{ color: '#94a3b8' }}> ({branchLabelOf(d.branchId)})</span> : null}</td>}
                              {show('hours') && <td style={{ textAlign: 'center' }}>{Number(d.hours ?? 0).toFixed(1)}</td>}
                              {show('status') && <td className={meta.cls}>{meta.l}</td>}
                              {show('checkIn') && <td>{fmtTime(d.checkIn)}</td>}
                              {show('lateMin') && <td style={{ textAlign: 'right', color: (d.lateMin || 0) > 0 ? 'var(--fin-red)' : 'inherit' }}>{d.lateMin || 0}</td>}
                              {show('shiftPay') && <td style={{ textAlign: 'right' }} className="fin-money">{formatVND(d.shiftPay || 0)}</td>}
                              {show('fineAmount') && <td style={{ textAlign: 'right', color: (d.fineAmount || 0) > 0 ? 'var(--fin-red)' : 'inherit' }} className="fin-money">{formatVND(d.fineAmount || 0)}</td>}
                            </tr>
                          );
                        })}
                        {(r.shifts || []).length === 0 && <tr><td colSpan={FIN_COL_HEADER_COUNT('fin-bcc', colDefs, cols)} style={{ textAlign: 'center', color: 'var(--fin-muted)', padding: 10 }}>Không có ca trong kỳ.</td></tr>}
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
function CalculateTab({ month, formula, setFormula, inputs, inputsLoading, allEmployees, finSheet, finSheetLoading, salaryConfigs, saveFormula, upsertInput, saveAllInputs, loadFormula, loadInputs, runCalculate, calcBusy, runs, inputsSaving, pendingCount, inputsSavedAt, cols, onToggleCol, onShowAllCols, colVis, colVisSaving, colDefs }: any) {
  const [q, setQ] = useState('');
  const [expandId, setExpandId] = useState<string | null>(null);
  const show = cols?.show || (() => true);
  const fmt = useCallback((n: any) => `${Math.round(Number(n) || 0).toLocaleString('vi-VN')}đ`, []);
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
        <ColumnSettings tabKey="fin-calculate" defs={colDefs} value={colVis} onToggle={onToggleCol} onShowAll={() => onShowAllCols('fin-calculate')} saving={colVisSaving} />
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
            <input type="number" className="fin-input" value={formula?.rateTV ?? ''} placeholder="VD: 21000" onChange={e => setFormula({ ...(formula || {}), rateTV: e.target.value })} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 210 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--fin-muted)', letterSpacing: .6, textTransform: 'uppercase' }}>Đơn giá giờ CHÍNH THỨC (đ)</span>
            <input type="number" className="fin-input" value={formula?.rateCT ?? ''} placeholder="VD: 25500" onChange={e => setFormula({ ...(formula || {}), rateCT: e.target.value })} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 150 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--fin-muted)', letterSpacing: .6, textTransform: 'uppercase' }}>Ngưỡng tăng ca 1 (giờ/ngày)</span>
            <input type="number" className="fin-input" value={formula?.otThreshold1 ?? 10} onChange={e => setFormula({ ...(formula || {}), otThreshold1: e.target.value })} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 150 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--fin-muted)', letterSpacing: .6, textTransform: 'uppercase' }}>Ngưỡng tăng ca 2 (giờ/ngày)</span>
            <input type="number" className="fin-input" value={formula?.otThreshold2 ?? 15} onChange={e => setFormula({ ...(formula || {}), otThreshold2: e.target.value })} />
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
              <tr>{show('stt') && <th className="ctr">STT</th>}{show('code') && <th>Mã NV</th>}{show('name') && <th>Họ tên</th>}{show('branch') && <th>Chi nhánh</th>}{show('luong_cb') && <th className="num">LCB</th>}{show('ot_extra') && <th className="num">OT thêm</th>}{show('bonus_extra') && <th className="num">Bonus</th>}{show('ung_luong') && <th className="num">Ứng lương</th>}{show('tru_kpi') && <th className="num">Trừ KPI</th>}{show('dong_phuc') && <th className="num">Trừ ĐP</th>}{show('note') && <th style={{ minWidth: 280 }}>Ghi chú (nhiều dòng)</th>}</tr>
            </thead>
            <tbody>
              {groups.map(g => {
                const gInps = g.rows.map((emp: any) => (inputs || []).find((i: any) => i.employee_id === emp.employee_id) || {});
                const gSum = (k: string) => gInps.reduce((s: number, x: any) => s + (Number(x?.[k]) || 0), 0);
                const colCount = FIN_COL_HEADER_COUNT('fin-calculate', colDefs, cols);
                return (
                <React.Fragment key={g.id}>
                  <BranchBandRow label={branchLabelOf(g.id)} count={g.rows.length} cols={colCount} totalText={`LCB ${formatVND(gSum('luong_cb'))} · OT ${formatVND(gSum('ot_extra'))} · Bonus ${formatVND(gSum('bonus_extra'))} · Ứng ${formatVND(gSum('ung_luong'))} · KPI ${formatVND(gSum('tru_kpi'))} · ĐP ${formatVND(gSum('dong_phuc'))}`} />
                  {g.rows.map((emp: any, idx: number) => {
                    const inp = inputs.find((i: any) => i.employee_id === emp.employee_id) || {};
                    const cell = (field: string, width = '100%') => (
                      <input type="number" className="fin-input" style={{ width, padding: '5px 7px', fontSize: 11.5 }}
                        value={inp[field] ?? ''} onChange={v => upsertInput(emp.employee_id, field, v.target.value)} aria-label={field} />
                    );
                    return (
                      <tr key={emp.employee_id}>
                        {show('stt') && <td className="ctr">{idx + 1}</td>}
                        {show('code') && <td className="ctr fin-mono">{emp.employee_code}</td>}
                        {show('name') && <td style={{ fontWeight: 700 }}>{emp.full_name}</td>}
                        {show('branch') && <td>{branchLabelOf(g.id)}</td>}
                        {show('luong_cb') && <td className="num">{cell('luong_cb')}</td>}
                        {show('ot_extra') && <td className="num">{cell('ot_extra')}</td>}
                        {show('bonus_extra') && <td className="num">{cell('bonus_extra')}</td>}
                        {show('ung_luong') && <td className="num">{cell('ung_luong')}</td>}
                        {show('tru_kpi') && <td className="num">{cell('tru_kpi')}</td>}
                        {show('dong_phuc') && <td className="num">{cell('dong_phuc')}</td>}
                        {show('note') && <td>
                          <textarea className="fin-input" rows={2} value={inp.note ?? ''} onChange={v => upsertInput(emp.employee_id, 'note', v.target.value)} placeholder="Ghi chú… (nhiều dòng)" aria-label="Ghi chú" style={{ fontSize: 11.5, padding: '6px 8px', resize: 'vertical', minHeight: 42, lineHeight: 1.4, whiteSpace: 'pre-wrap' }} />
                        </td>}
                      </tr>
                    );
                  })}
                  <tr className="fin-subtotal">
                    <td colSpan={Math.max(0, colCount - 7)}>CỘNG {branchLabelOf(g.id).toUpperCase()} ({g.rows.length} NV)</td>
                    {show('luong_cb') && <td className="num fin-money">{formatVND(gSum('luong_cb'))}</td>}
                    {show('ot_extra') && <td className="num fin-money">{formatVND(gSum('ot_extra'))}</td>}
                    {show('bonus_extra') && <td className="num fin-money">{formatVND(gSum('bonus_extra'))}</td>}
                    {show('ung_luong') && <td className="num fin-money">{formatVND(gSum('ung_luong'))}</td>}
                    {show('tru_kpi') && <td className="num fin-money">{formatVND(gSum('tru_kpi'))}</td>}
                    {show('dong_phuc') && <td className="num fin-money">{formatVND(gSum('dong_phuc'))}</td>}
                    <td />
                  </tr>
                </React.Fragment>
                );
              })}
              {groups.length === 0 && <tr><td colSpan={FIN_COL_HEADER_COUNT('fin-calculate', colDefs, cols)} className="fin-empty">{q ? 'Không tìm thấy nhân viên phù hợp.' : 'Chưa có nhân viên.'}</td></tr>}
              {inputs.length > 0 && (
                <tr className="fin-grand">
                  <td colSpan={Math.max(0, FIN_COL_HEADER_COUNT('fin-calculate', colDefs, cols) - 7)}>TỔNG TOÀN CÔNG TY</td>
                  {show('luong_cb') && <td className="num fin-money">{formatVND(inputTotals.lcb)}</td>}
                  {show('ot_extra') && <td className="num fin-money">{formatVND(inputTotals.ot)}</td>}
                  {show('bonus_extra') && <td className="num fin-money">{formatVND(inputTotals.bonus)}</td>}
                  {show('ung_luong') && <td className="num fin-money">{formatVND(inputTotals.ung)}</td>}
                  {show('tru_kpi') && <td className="num fin-money">{formatVND(inputTotals.kpi)}</td>}
                  {show('dong_phuc') && <td className="num fin-money">{formatVND(inputTotals.dp)}</td>}
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, color: 'var(--fin-muted)' }}>Tự lưu 0,8s sau khi ngừng gõ · Sheets cập nhật gom 1 lượt sau 20s · Tổng trích: KPI <b className="fin-money">{formatVND(inputTotals.kpi)}</b> • Đồng phục <b className="fin-money">{formatVND(inputTotals.dp)}</b></span>
          <button type="button" className="fin-btn fin-btn-dark fin-btn-sm" onClick={saveAllInputs} disabled={inputsLoading || pendingCount === 0 && !inputsSaving}><Save size={13} /> Lưu tất cả nhập tay{pendingCount > 0 ? ` (${pendingCount})` : ''}</button>
        </div>
      </div>

      {/* B4 xem trước realtime: công thức kỳ × chấm công thật × nhập tay — bấm dòng để xem từng bước */}
      <div className="fin-card" style={{ border: '1.5px solid #a7f3d0' }}>
        <CardHead title="B4 — Các bước tính lương xem trước (realtime)" icon={<Calculator size={14} color="#059669" />} sub={`Kỳ ${periodLabel(month)} • B1 giờ công/LCB • B2 Tổng cộng • B3 Tổng lương • B4 Thực lãnh. Bấm ▶ để xem từng bước.`}>
          <ColumnSettings tabKey="fin-calculate" defs={colDefs} value={colVis} onToggle={onToggleCol} onShowAll={() => onShowAllCols('fin-calculate')} saving={colVisSaving} />
        </CardHead>
        <div className="fin-table-wrap" style={{ maxHeight: '60vh' }}>
          <table className="fin-table" style={{ minWidth: 980 }}>
            <thead><tr>{show('name') && <th>Nhân viên</th>}{show('b1') && <th className="num">B1 Giờ/LCB</th>}{show('b2') && <th className="num">B2 Tổng cộng</th>}{show('b3') && <th className="num">B3 Tổng lương</th>}{show('b4') && <th className="num">B4 Thực lãnh</th>}</tr></thead>
            <tbody>
              {finSheetLoading ? (
                <tr><td colSpan={FIN_COL_HEADER_COUNT('fin-calculate', colDefs, cols)} className="fin-empty">Đang tải bảng chấm công…</td></tr>
              ) : (() => {
                const rows: any[] = (() => {
                  const list = (finSheet?.rows || []) as any[];
                  if (!list.length) return [];
                  const qv = q.trim().toLowerCase();
                  return qv ? list.filter((r: any) => String(r.fullName || '').toLowerCase().includes(qv) || String(r.employeeCode || '').toLowerCase().includes(qv)) : list;
                })();
                if (!rows.length) return <tr><td colSpan={FIN_COL_HEADER_COUNT('fin-calculate', colDefs, cols)} className="fin-empty">{finSheet ? 'Kỳ này chưa có ca chấm công — xem trước hiện sau khi có chấm công. Vẫn bấm TÍNH LƯƠNG NGAY được.' : 'Chưa tải được bảng công — bấm Tải lại ở tab Đối soát công, hoặc bấm TÍNH LƯƠNG NGAY để tính trên server.'}</td></tr>;
                return rows.flatMap((r: any) => {
                  const inp = (inputs || []).find((i: any) => i.employee_id === r.employeeId) || {};
                  const num = (v: any) => Math.max(0, Math.floor(Number(v) || 0));
                  const isMonthly = r.payMode === 'MONTHLY';
                  const manualCb = inp.luong_cb !== undefined && inp.luong_cb !== null && String(inp.luong_cb).trim() !== '' && Number(inp.luong_cb) > 0;
                  const luongCB = isMonthly ? (manualCb ? num(inp.luong_cb) : num(r.monthlyBase ?? r.monthly_base)) : 0;
                  const allowance = num(r.allowance);
                  const hourly = isMonthly ? 0 : num(r.standardPay);
                  const b1 = isMonthly ? luongCB + allowance : hourly + allowance;
                  const ot = num(inp.ot_extra), bonus = num(inp.bonus_extra) + num(r.bonus);
                  const b2 = b1 + ot + bonus;
                  const kpi = num(inp.tru_kpi), ded = num(r.deduction);
                  const b3 = b2 - kpi - ded;
                  const b4 = b3 - num(inp.ung_luong) - num(inp.dong_phuc);
                  const open = expandId === r.employeeId;
                  const main = (
                    <tr key={r.employeeId} style={{ cursor: 'pointer', backgroundColor: open ? '#f0fdf4' : undefined }} onClick={() => setExpandId(open ? null : r.employeeId)}>
                      {show('name') && <td style={{ fontWeight: 700 }}>{open ? '▼ ' : '▶ '}{r.fullName}<div style={{ fontSize: 10, color: 'var(--fin-muted)', fontWeight: 400 }}>{r.employeeCode} • {Number(r.hours || 0).toFixed(1)}h • TV {Number(r.tvHours || 0)}h / CT {Number(r.ctHours || 0)}h</div></td>}
                      {show('b1') && <td className="num">{fmt(b1)}</td>}{show('b2') && <td className="num" style={{ fontWeight: 700 }}>{fmt(b2)}</td>}{show('b3') && <td className="num" style={{ fontWeight: 700 }}>{fmt(b3)}</td>}{show('b4') && <td className="num fin-money" style={{ fontWeight: 800, color: 'var(--fin-green)' }}>{fmt(b4)}</td>}
                    </tr>
                  );
                  if (!open) return [main];
                  return [main, (
                    <tr key={`${r.employeeId}-x`} style={{ backgroundColor: '#f8fafc' }}>
                      <td colSpan={FIN_COL_HEADER_COUNT('fin-calculate', colDefs, cols)} style={{ padding: '8px 14px 14px 22px', fontSize: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span><b style={{ color: '#059669' }}>B1.</b> {isMonthly ? `Lương tháng = LCB ${fmt(luongCB)} + phụ cấp ${fmt(allowance)} (không tính ca/giờ)` : `Lương giờ = TV ${Number(r.tvHours || 0)}h × ${fmt(Number(r.tvHours || 0) > 0 && Number(r.tvPay || 0) > 0 ? Number(r.tvPay) / Number(r.tvHours) : (formula?.rateTV ?? 21000))} + CT ${Number(r.ctHours || 0)}h × ${fmt(Number(r.ctHours || 0) > 0 && Number(r.ctPay || 0) > 0 ? Number(r.ctPay) / Number(r.ctHours) : (Number(r.rate) || formula?.rateCT || 25500))}; + phụ cấp ${fmt(allowance)}`}</span><strong>= {fmt(b1)}</strong></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span><b style={{ color: '#059669' }}>B2.</b> TỔNG CỘNG = LCB/giờ {fmt(b1)} + OT thêm {fmt(ot)} + Bonus {fmt(bonus)}</span><strong>= {fmt(b2)}</strong></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span><b style={{ color: '#059669' }}>B3.</b> TỔNG LƯƠNG = TỔNG CỘNG {fmt(b2)} − KPI {fmt(kpi)} − phạt trễ/vắng {fmt(ded)}</span><strong>= {fmt(b3)}</strong></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span><b style={{ color: '#059669' }}>B4.</b> THỰC LÃNH = TỔNG LƯƠNG {fmt(b3)} − Ứng {fmt(num(inp.ung_luong))} − Đồng phục {fmt(num(inp.dong_phuc))}</span><strong style={{ color: '#059669' }}>= {fmt(b4)}</strong></div>
                        <div style={{ fontSize: 11, color: 'var(--fin-muted)', marginTop: 6 }}>Nhập tay lấy từ bảng Nhập liệu tay phía trên. LCB trống/0 với NV lương tháng tự lấy LCB cấu hình. Bấm TÍNH LƯƠNG NGAY để chốt kỳ + phiếu.</div>
                      </td>
                    </tr>
                  )];
                });
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   5 · PAYMENT — BẢNG LƯƠNG THÁNG (nhóm chi nhánh + subtotal)
   ============================================================================ */
function PayrollSheetTab({ month, slips, allEmployees, formatVND, stageBadge, cols, onToggleCol, onShowAllCols, colVis, colVisSaving, colDefs }: any) {
  const [q, setQ] = useState('');
  const show = cols?.show || (() => true);
  const groups = useMemo(() => {
    const filtered = (slips || []).filter(matchesFilter(q.trim()));
    return branchGroups(filtered, (s: any) => slipBranchId(s, allEmployees));
  }, [slips, allEmployees, q]);
  const grand = sumCalc(slips || []);
  const COLS = FIN_COL_HEADER_COUNT('fin-payroll-sheet', colDefs, cols);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TabHead step={5} title="Payment — Bảng lương tháng" desc={`Bảng lương tổng hợp theo từng chi nhánh — kỳ ${periodLabel(month)}. Mỗi chi nhánh hiển thị TỪNG NHÂN VIÊN (STT, họ tên, mã, chi nhánh) với ĐỦ cột: Giờ công, Lương ca, Phụ cấp, LCB, OT, Bonus, TỔNG CỘNG, Trừ KPI/phạt, Ứng, Trừ ĐP, TỔNG LƯƠNG, THỰC LÃNH, Trạng thái. Mỗi chi nhánh có dòng CỘNG tổng tiền chi nhánh đó; cuối bảng là TỔNG TOÀN CÔNG TY.`}>
        <SearchBox value={q} onChange={setQ} />
        <ColumnSettings tabKey="fin-payroll-sheet" defs={colDefs} value={colVis} onToggle={onToggleCol} onShowAll={() => onShowAllCols('fin-payroll-sheet')} saving={colVisSaving} />
      </TabHead>
      <div className="fin-card">
        <CardHead title={`Kỳ ${periodLabel(month)} — Bảng lương theo chi nhánh (${slips.length} phiếu)`} icon={<FileText size={14} color="#E85D92" />} sub="Nhóm theo chi nhánh · mỗi chi nhánh 1 dòng CỘNG tổng tiền">
          <span className="fin-chip-stat">Tổng thực lãnh: {formatVND(grand.thuc)}</span>
        </CardHead>
        <div className="fin-table-wrap">
          <table className="fin-table" style={{ minWidth: 1980 }}>
            <thead>
              <tr>{show('stt') && <th className="ctr">STT</th>}{show('full_name') && <th>Họ tên</th>}{show('employee_code') && <th>Mã NV</th>}{show('branch') && <th>Chi nhánh</th>}{show('gio') && <th className="num">Giờ công</th>}{show('banCa') && <th className="num">Lương ca</th>}{show('phuCap') && <th className="num">Phụ cấp</th>}{show('lcb') && <th className="num">LCB</th>}{show('ot') && <th className="num">OT thêm</th>}{show('bonus') && <th className="num">Bonus</th>}{show('tongCong') && <th className="num">TỔNG CỘNG</th>}{show('truKpiPhat') && <th className="num">Trừ KPI/phạt</th>}{show('ung') && <th className="num">Ứng lương</th>}{show('dongPhuc') && <th className="num">Trừ ĐP</th>}{show('tongLuong') && <th className="num">TỔNG LƯƠNG</th>}{show('thuc') && <th className="num">THỰC LÃNH</th>}{show('status') && <th>Trạng thái</th>}</tr>
            </thead>
            <tbody>
              {groups.map(g => {
                const gs = sumCalc(g.rows);
                return (
                  <React.Fragment key={g.id}>
                    <BranchBandRow label={branchLabelOf(g.id)} count={g.rows.length} cols={COLS} totalText={`THỰC LÃNH ${formatVND(gs.thuc)} · TỔNG CỘNG ${formatVND(gs.tongCong)} · ${r1(gs.gio).toFixed(1)} giờ`} />
                    {g.rows.map((s: any, idx: number) => {
                      const c = slipCalc(s);
                      const st = stageBadge(s.stage ?? s.status);
                      return (
                        <tr key={s.item_id}>
                          {show('stt') && <td className="ctr">{idx + 1}</td>}
                          {show('full_name') && <td style={{ fontWeight: 700 }}>{s.full_name}</td>}
                          {show('employee_code') && <td className="ctr fin-mono">{s.employee_code}</td>}
                          {show('branch') && <td>{branchLabelOf(slipBranchId(s, allEmployees))}</td>}
                          {show('gio') && <td className="num">{r1(c.gio).toFixed(1)}</td>}
                          {show('banCa') && <td className="num fin-money">{formatVND(c.banCa)}</td>}
                          {show('phuCap') && <td className="num fin-money">{formatVND(c.phuCap)}</td>}
                          {show('lcb') && <td className="num fin-money">{formatVND(c.lcb)}</td>}
                          {show('ot') && <td className="num fin-money">{formatVND(c.ot)}</td>}
                          {show('bonus') && <td className="num fin-money">{formatVND(c.bonus)}</td>}
                          {show('tongCong') && <td className="num fin-money" style={{ fontWeight: 700 }}>{formatVND(c.tongCong)}</td>}
                          {show('truKpiPhat') && <td className="num fin-money" style={{ color: 'var(--fin-red)' }}>{formatVND(c.truKpiPhat)}</td>}
                          {show('ung') && <td className="num fin-money" style={{ color: 'var(--fin-red)' }}>{formatVND(c.ung)}</td>}
                          {show('dongPhuc') && <td className="num fin-money" style={{ color: 'var(--fin-red)' }}>{formatVND(c.dongPhuc)}</td>}
                          {show('tongLuong') && <td className="num fin-money">{formatVND(c.tongLuong)}</td>}
                          {show('thuc') && <td className="num fin-money" style={{ fontWeight: 800, color: 'var(--fin-green)' }}>{formatVND(c.thuc)}</td>}
                          {show('status') && <td><span className="fin-badge" style={{ color: st.fg, background: st.bg, borderColor: st.border }}><span className="fin-badge-dot" />{st.label}</span></td>}
                        </tr>
                      );
                    })}
                    <tr className="fin-subtotal">
                      <td colSpan={Math.max(1, COLS - 14)}>CỘNG {branchLabelOf(g.id).toUpperCase()} ({g.rows.length} NV)</td>
                      {show('gio') && <td className="num">{r1(gs.gio).toFixed(1)}</td>}
                      {show('banCa') && <td className="num fin-money">{formatVND(gs.banCa)}</td>}
                      {show('phuCap') && <td className="num fin-money">{formatVND(gs.phuCap)}</td>}
                      {show('lcb') && <td className="num fin-money">{formatVND(gs.lcb)}</td>}
                      {show('ot') && <td className="num fin-money">{formatVND(gs.ot)}</td>}
                      {show('bonus') && <td className="num fin-money">{formatVND(gs.bonus)}</td>}
                      {show('tongCong') && <td className="num fin-money">{formatVND(gs.tongCong)}</td>}
                      {show('truKpiPhat') && <td className="num fin-money">{formatVND(gs.truKpiPhat)}</td>}
                      {show('ung') && <td className="num fin-money">{formatVND(gs.ung)}</td>}
                      {show('dongPhuc') && <td className="num fin-money">{formatVND(gs.dongPhuc)}</td>}
                      {show('tongLuong') && <td className="num fin-money">{formatVND(gs.tongLuong)}</td>}
                      {show('thuc') && <td className="num fin-money">{formatVND(gs.thuc)}</td>}
                      {show('status') && <td />}
                    </tr>
                  </React.Fragment>
                );
              })}
              {groups.length === 0 && <tr><td colSpan={COLS} className="fin-empty">{q ? 'Không tìm thấy phiếu phù hợp.' : 'Chưa có bảng lương tháng này — hãy TÍNH LƯƠNG ở tab 4.'}</td></tr>}
              {slips.length > 0 && (
                <tr className="fin-grand">
                  <td colSpan={Math.max(1, COLS - 14)}>TỔNG TOÀN CÔNG TY ({slips.length} phiếu)</td>
                  {show('gio') && <td className="num">{r1(grand.gio).toFixed(1)}</td>}
                  {show('banCa') && <td className="num fin-money">{formatVND(grand.banCa)}</td>}
                  {show('phuCap') && <td className="num fin-money">{formatVND(grand.phuCap)}</td>}
                  {show('lcb') && <td className="num fin-money">{formatVND(grand.lcb)}</td>}
                  {show('ot') && <td className="num fin-money">{formatVND(grand.ot)}</td>}
                  {show('bonus') && <td className="num fin-money">{formatVND(grand.bonus)}</td>}
                  {show('tongCong') && <td className="num fin-money">{formatVND(grand.tongCong)}</td>}
                  {show('truKpiPhat') && <td className="num fin-money">{formatVND(grand.truKpiPhat)}</td>}
                  {show('ung') && <td className="num fin-money">{formatVND(grand.ung)}</td>}
                  {show('dongPhuc') && <td className="num fin-money">{formatVND(grand.dongPhuc)}</td>}
                  {show('tongLuong') && <td className="num fin-money">{formatVND(grand.tongLuong)}</td>}
                  {show('thuc') && <td className="num fin-money">{formatVND(grand.thuc)}</td>}
                  {show('status') && <td />}
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {slips.length > 0 && (
          <div style={{ padding: '10px 16px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end' }}>
            <span className="fin-chip-stat" style={{ fontSize: 11 }}>TỔNG THỰC LÃNH TOÀN CÔNG TY: {formatVND(grand.thuc)}</span>
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

const PERIOD_SLIP_FILTERS = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'DRAFT', label: 'Nháp' },
  { key: 'PUBLISHED', label: 'Đã gửi NV' },
  { key: 'CONFIRMED', label: 'NV đã ký' },
  { key: 'PAID', label: 'Đã chi trả' },
];

function PayrollPeriodsTab({ month, runs, runsLoading, loadRuns, slips, allEmployees, formatVND, runCalculate, calcBusy, payRunAction, onNavigateTab, inputs = [], loadInputs, loadSlips, showToast, cols, onToggleCol, onShowAllCols, colVis, colVisSaving, colDefs }: any) {
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVals, setEditVals] = useState<any>({});
  const [editSaving, setEditSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const show = cols?.show || (() => true);
  const monthRuns = useMemo(() => (Array.isArray(runs) ? runs : []).filter((r: any) => r.period === month).sort((a: any, b: any) => String(b?.created_at || '').localeCompare(String(a?.created_at || ''))), [runs, month]);
  const latest = monthRuns[0] || null;
  const allSlips = useMemo(() => Array.isArray(slips) ? slips : [], [slips]);
  const grand = sumCalc(allSlips);
  // Số học xuất phiếu: phiếu chỉ được xuất khi đủ KT lập + GĐ duyệt; NV ký xong mới CK được.
  const readiness = useMemo(() => ({
    needKtSign: allSlips.filter((s: any) => !s.sign_lap).length,
    needGdSign: allSlips.filter((s: any) => s.sign_lap && !s.sign_giamdoc).length,
    readyToSend: allSlips.filter((s: any) => s.sign_lap && s.sign_giamdoc && String(s.status || '') === 'DRAFT').length,
    waitingNvSign: allSlips.filter((s: any) => String(s.status || '') === 'PUBLISHED').length,
    waitingPayment: allSlips.filter((s: any) => String(s.status || '') === 'CONFIRMED').length,
    paid: allSlips.filter((s: any) => String(s.status || '') === 'PAID').length,
  }), [allSlips]);
  const filteredSlips = useMemo(() => {
    let rows = [...allSlips];
    if (statusFilter !== 'ALL') rows = rows.filter((s: any) => String(s?.status || '').toUpperCase() === statusFilter);
    const kw = q.trim().toLowerCase();
    if (kw) rows = rows.filter((s: any) => [s?.full_name, s?.fullName, s?.employee_code, s?.employeeCode, slipBranchId(s, allEmployees), branchLabelOf(slipBranchId(s, allEmployees))].some(v => String(v || '').toLowerCase().includes(kw)));
    rows.sort((a: any, b: any) => String(b?.updated_at || b?.created_at || '').localeCompare(String(a?.updated_at || a?.created_at || '')) || String(a?.full_name || '').localeCompare(String(b?.full_name || '')));
    return rows;
  }, [allSlips, statusFilter, q, allEmployees]);
  const branchGroupsFiltered = useMemo(() => branchGroups(filteredSlips, (s: any) => slipBranchId(s, allEmployees)), [filteredSlips, allEmployees]);
  const RUN_STAGES = ['DRAFT', 'RECONCILED', 'APPROVED', 'PUBLISHED', 'PAID'];
  const RUN_STAGE_LABEL: Record<string, string> = { DRAFT: 'Nháp', RECONCILED: 'Đối soát', APPROVED: 'Duyệt', PUBLISHED: 'Đã phát hành', PAID: 'Chi trả' };
  const latestStageIdx = latest ? RUN_STAGES.indexOf(String(latest.status || 'DRAFT').toUpperCase()) : -1;
  const canReconcile = latest && String(latest.status || '').toUpperCase() === 'DRAFT';
  const canApprove = latest && String(latest.status || '').toUpperCase() === 'RECONCILED';
  const canGoSign = latest && ['APPROVED', 'PUBLISHED', 'PAID'].includes(String(latest.status || '').toUpperCase());

  /** Chỉnh sửa trực tiếp trên nhân viên (nhập tay: LCB/OT/Bonus/Ứng/KPI/ĐP). */
  const startEdit = (s: any) => {
    const st = String(s?.status || '').toUpperCase();
    if (['CONFIRMED', 'PAID'].includes(st)) {
      showToast?.('Phiếu đã khóa (NV đã ký/đã chuyển khoản) — hãy dùng nút "Quay về bước trước" ở màn hình khóa để hoàn về DRAFT trước khi sửa!');
      return;
    }
    const inp: any = (inputs || []).find((i: any) => String(i?.employee_id) === String(s?.employee_id)) || {};
    setEditingId(String(s?.item_id || s?.employee_id));
    setEditVals({
      luong_cb: s.luong_cb ?? inp.luong_cb ?? '',
      ot_extra: s.ot_extra ?? inp.ot_extra ?? '',
      bonus_extra: s.bonus ?? inp.bonus_extra ?? '',
      ung_luong: s.ung_luong ?? inp.ung_luong ?? '',
      tru_kpi: s.tru_kpi ?? inp.tru_kpi ?? '',
      dong_phuc: s.dong_phuc ?? inp.dong_phuc ?? '',
      note: inp.note ?? s.input_note ?? '',
    });
  };
  const saveEdit = async (s: any) => {
    if (!String(editVals.note || '').trim() && !Number(editVals.luong_cb) && !Number(editVals.ot_extra) && !Number(editVals.bonus_extra) && !Number(editVals.ung_luong) && !Number(editVals.tru_kpi) && !Number(editVals.dong_phuc)) {
      if (!window.confirm('Bạn đang lưu toàn 0/trống cho NV này — hệ thống sẽ tính theo mặc định. Tiếp tục?')) return;
    }
    setEditSaving(true);
    try {
      await apiRequest(`/payroll/inputs/${encodeURIComponent(month)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: s.employee_id, employee_id: s.employee_id, period: month,
          luong_cb: Math.max(0, Math.floor(Number(editVals.luong_cb) || 0)),
          ot_extra: Math.max(0, Math.floor(Number(editVals.ot_extra) || 0)),
          bonus_extra: Math.max(0, Math.floor(Number(editVals.bonus_extra) || 0)),
          ung_luong: Math.max(0, Math.floor(Number(editVals.ung_luong) || 0)),
          tru_kpi: Math.max(0, Math.floor(Number(editVals.tru_kpi) || 0)),
          dong_phuc: Math.max(0, Math.floor(Number(editVals.dong_phuc) || 0)),
          note: String(editVals.note || '').slice(0, 1000),
        }),
      });
      setEditingId(null);
      try { loadInputs?.(); } catch { /* noop */ }
      showToast?.('Đã lưu chỉnh sửa trực tiếp — bấm "Cập nhật dữ liệu" để tính lại kỳ/phiếu theo số mới!');
    } catch (e: any) {
      showToast?.(e?.message || 'Lưu chỉnh sửa thất bại');
    } finally {
      setEditSaving(false);
    }
  };
  /** Cập nhật dữ liệu: tải lại inputs/phiếu/kỳ/workflow realtime (không tính lại). */
  const refreshData = async () => {
    setRefreshing(true);
    try {
      await loadInputs?.();
      await loadSlips?.();
      await loadRuns?.();
      showToast?.('Đã cập nhật dữ liệu mới nhất từ server (realtime)!');
    } catch (e: any) {
      showToast?.(e?.message || 'Cập nhật dữ liệu thất bại');
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TabHead step={6} title="Kỳ lương — DRAFT → PAID" desc={`Vòng đời kỳ lương ${periodLabel(month)}: Tính → Đối soát → Duyệt → từng phiếu gửi NV → NV ký → chi trả. Bảng dưới Nhóm theo CHI NHÁNH, mỗi NV 1 dòng với ĐỦ cột tiền + dòng CỘNG tổng tiền chi nhánh. Kế toán có thể SỬA TRỰC TIẾP từng NV (LCB/OT/Bonus/Ứng/KPI/ĐP) ngay trên bảng, rồi bấm CẬP NHẬT DỮ LIỆU để tải lại / TÍNH LẠI KỲ để áp số mới.`}>
        <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={loadRuns}><RefreshCw size={13} /> Tải lại</button>
        <ColumnSettings tabKey="fin-payroll-periods" defs={colDefs} value={colVis} onToggle={onToggleCol} onShowAll={() => onShowAllCols('fin-payroll-periods')} saving={colVisSaving} />
        <button type="button" className="fin-btn fin-btn-dark fin-btn-sm" onClick={refreshData} disabled={refreshing} title="Tải lại dữ liệu mới nhất từ server (inputs, phiếu, kỳ, workflow) — realtime">
          {refreshing ? <Loader2 size={13} className="fin-spin" /> : <RefreshCw size={13} />} Cập nhật dữ liệu
        </button>
        <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" onClick={runCalculate} disabled={calcBusy} title="Tính lại kỳ (tạo kỳ mới — phiếu cũ vẫn giữ để đối chiếu)">
          {calcBusy ? <Loader2 size={13} className="fin-spin" /> : <Calculator size={13} />} {latest ? 'Tính lại kỳ' : 'Tính lương ngay'}
        </button>
      </TabHead>

      {/* Vòng đời kỳ mới nhất DRAFT -> PAID */}
      <div className="fin-card">
        <CardHead title="Tiến độ kỳ lương (kỳ mới nhất)" icon={<CalendarRange size={14} color="#E85D92" />} sub={latest ? `${latest.run_id} — tạo ${fmtDateTime(latest.created_at)}` : 'Chưa có kỳ — hãy tính lương trước'}>
          {latest && (() => { const st = RUN_STATUS_STYLE[String(latest.status || 'DRAFT')] || RUN_STATUS_STYLE.DRAFT; return <span className="fin-badge" style={{ color: st.fg, background: st.bg, borderColor: st.fg + '40' }}><span className="fin-badge-dot" />{st.label}</span>; })()}
        </CardHead>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap', padding: '12px 16px' }}>
          {RUN_STAGES.map((s, i) => {
            const done = latestStageIdx >= 0 && i <= latestStageIdx;
            const cur = latestStageIdx === i;
            const st = RUN_STATUS_STYLE[s] || RUN_STATUS_STYLE.DRAFT;
            return (
              <span key={s} style={{ display: 'inline-flex', alignItems: 'center' }}>
                <span style={{ padding: '6px 14px', borderRadius: '999px', fontSize: 12, fontWeight: 800, background: done ? st.bg : '#F8FAFC', color: done ? st.fg : '#9CA3AF', border: `1.5px solid ${done ? st.fg + '40' : '#E5E7EB'}`, boxShadow: cur ? '0 0 0 3px rgba(16,185,129,0.15)' : undefined }}>
                  {done ? '✓ ' : ''}{RUN_STAGE_LABEL[s]}
                </span>
                {i < RUN_STAGES.length - 1 && <span style={{ width: 22, height: 2, background: latestStageIdx > i ? '#10B981' : '#E5E7EB', display: 'inline-block' }} />}
              </span>
            );
          })}
          {!latest && <span style={{ fontSize: 11, color: 'var(--fin-muted)' }}>Chưa có kỳ nào — bấm “Tính lương ngay”.</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '0 16px 14px', alignItems: 'center' }}>
          {latest && <span style={{ fontSize: 11, fontWeight: 800 }}>Trạng thái kỳ: {String(latest.status || 'DRAFT').toUpperCase()}</span>}
          <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" disabled={!canReconcile} title={canReconcile ? 'Đánh dấu kỳ đã đối soát (DRAFT → RECONCILED). Bước 1 bắt buộc trước khi duyệt.' : 'Chỉ bấm được khi kỳ đang ở trạng thái DRAFT'} onClick={() => payRunAction(latest.run_id, 'reconcile')}>Đối soát kỳ</button>
          <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" disabled={!canApprove} title={canApprove ? 'Phê duyệt kỳ (RECONCILED → APPROVED). ADMIN được duyệt kỳ của mình; FINANCE phải dùng tài khoản khác.' : 'Chỉ bấm được khi kỳ đã Đối soát (RECONCILED). Hãy bấm Đối soát kỳ trước.'} onClick={() => payRunAction(latest.run_id, 'approve')}>Phê duyệt kỳ</button>
          {canGoSign && <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" onClick={() => onNavigateTab?.('fin-payslips')}><Send size={12} /> Sang tab Phiếu lương: ký & gửi NV</button>}
          {latest && <button type="button" className="fin-btn fin-btn-amber fin-btn-sm" onClick={() => window.dispatchEvent(new CustomEvent('ubm:rollback-kyluong', { detail: { period: month } }))}>↩ Quay về bước trước</button>}
          {latest && !canReconcile && !canApprove && !canGoSign && <span style={{ fontSize: 11, color: 'var(--fin-muted)' }}>Kỳ đang ở trạng thái {String(latest.status || '').toUpperCase()} — theo quy trình, phiếu lương phát hành/chi trả TỪNG PHIẾU ở tab 7–8 (đủ chữ ký 3 bên).</span>}
          {latest && <span style={{ fontSize: 10.5, color: 'var(--fin-muted)' }}>Quy trình: DRAFT → Bấm <b>Đối soát kỳ</b> → RECONCILED → Bấm <b>Phê duyệt kỳ</b> → APPROVED → Sang tab Phiếu lương (KT ký → GĐ duyệt → NV ký → KT chuyển khoản).</span>}
        </div>
      </div>

      {/* Rà soát chuẩn bị xuất phiếu */}
      <div className="fin-card">
        <CardHead title="Rà soát chuẩn bị xuất phiếu lương" icon={<ShieldCheck size={14} color="#047857" />} sub="Đếm realtime từ trạng thái từng phiếu — không ước lượng">
          <span className="fin-chip-stat">{allSlips.length} phiếu</span>
          <span className="fin-chip-stat">{readiness.paid} đã chi trả</span>
        </CardHead>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, padding: '12px 16px' }}>
          {[
            { label: 'Chờ KT ký lập', value: readiness.needKtSign, hint: 'Tab 7: “Kế toán ký lập”' },
            { label: 'Chờ GĐ duyệt', value: readiness.needGdSign, hint: 'Cổng Giám đốc duyệt' },
            { label: 'Sẵn sàng gửi NV', value: readiness.readyToSend, hint: 'Tab 7: “Gửi NV ký”' },
            { label: 'Chờ NV ký', value: readiness.waitingNvSign, hint: 'NV ký trong Cổng NV' },
            { label: 'Chờ chuyển khoản', value: readiness.waitingPayment, hint: 'Tab 8: quét QR & CK' },
            { label: 'Đã chi trả', value: readiness.paid, hint: 'Khóa + PDF lên Drive' },
          ].map((c: any) => (
            <div key={c.label} className="fin-kpi" style={{ padding: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div className="fin-kpi-label">{c.label}</div>
                <div className="fin-kpi-value" style={{ fontSize: 20 }}>{c.value}</div>
                <div className="fin-kpi-sub">{c.hint}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Danh sách PHIẾU LƯƠNG từng nhân viên — nhóm theo chi nhánh, đủ cột, sửa trực tiếp */}
      <div className="fin-card">
        <CardHead title={`Danh sách phiếu lương — ${periodLabel(month)} (${filteredSlips.length}/${allSlips.length} phiếu)`} icon={<Receipt size={14} color="#E85D92" />} sub="Nhóm theo chi nhánh · mỗi NV 1 dòng với ĐỦ cột · mỗi chi nhánh 1 dòng CỘNG tổng tiền · bấm ✏️ để sửa trực tiếp (LCB/OT/Bonus/Ứng/KPI/ĐP)">
          <SearchBox value={q} onChange={setQ} />
          <ColumnSettings tabKey="fin-payroll-periods" defs={colDefs} value={colVis} onToggle={onToggleCol} onShowAll={() => onShowAllCols('fin-payroll-periods')} saving={colVisSaving} />
          <span className="fin-chip-stat">{r1(grand.gio).toFixed(1)} giờ</span>
          <span className="fin-chip-stat">THỰC LÃNH {formatVND(grand.thuc)}</span>
        </CardHead>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '10px 16px', borderBottom: '1px solid #f1f5f9' }}>
          {PERIOD_SLIP_FILTERS.map(f => (
            <button key={f.key} type="button" className={`fin-pill${statusFilter === f.key ? ' is-active' : ''}`} onClick={() => setStatusFilter(f.key)}>
              {f.label} <span style={{ opacity: .7 }}>({f.key === 'ALL' ? allSlips.length : allSlips.filter((s: any) => String(s?.status || '').toUpperCase() === f.key).length})</span>
            </button>
          ))}
        </div>
        {runsLoading && allSlips.length === 0 ? (
          <div className="fin-empty">Đang tải kỳ lương…</div>
        ) : allSlips.length === 0 ? (
          <div className="fin-empty">
            <Inbox size={28} style={{ margin: '0 auto 8px', color: '#cbd5e1' }} />
            <div style={{ fontWeight: 800, color: 'var(--fin-ink)', marginBottom: 4 }}>Chưa có phiếu lương cho {periodLabel(month)}</div>
            <div style={{ marginBottom: 12 }}>Bấm “Tính lương ngay” ở góc phải trên — hệ thống sẽ sinh phiếu cho toàn bộ nhân viên.</div>
            <button type="button" className="fin-btn fin-btn-primary" onClick={runCalculate} disabled={calcBusy}>{calcBusy ? <Loader2 size={15} className="fin-spin" /> : <Calculator size={15} />} TÍNH LƯƠNG NGAY</button>
          </div>
        ) : (
          <div className="fin-table-wrap">
            <table className="fin-table" style={{ minWidth: 2380 }}>
              <thead>
                <tr>{show('stt') && <th className="ctr">STT</th>}{show('full_name') && <th>Họ tên</th>}{show('employee_code') && <th>Mã NV</th>}{show('branch') && <th>Chi nhánh</th>}{show('gio') && <th className="num">Giờ công</th>}{show('banCa') && <th className="num">Lương ca</th>}{show('phuCap') && <th className="num">Phụ cấp</th>}{show('lcb') && <th className="num">LCB</th>}{show('ot') && <th className="num">OT thêm</th>}{show('bonus') && <th className="num">Bonus</th>}{show('tongCong') && <th className="num">TỔNG CỘNG</th>}{show('truKpiPhat') && <th className="num">Trừ KPI/phạt</th>}{show('ung') && <th className="num">Ứng lương</th>}{show('dongPhuc') && <th className="num">Trừ ĐP</th>}{show('tongLuong') && <th className="num">TỔNG LƯƠNG</th>}{show('thuc') && <th className="num">THỰC LÃNH</th>}{show('status') && <th>Trạng thái phiếu</th>}{show('edit') && <th className="ctr">Sửa trực tiếp</th>}</tr>
              </thead>
              <tbody>
                {branchGroupsFiltered.map(g => {
                  const gs = sumCalc(g.rows);
                  const colCount = FIN_COL_HEADER_COUNT('fin-payroll-periods', colDefs, cols);
                  return (
                    <React.Fragment key={g.id}>
                      <BranchBandRow label={branchLabelOf(g.id)} count={g.rows.length} cols={colCount} totalText={`THỰC LÃNH ${formatVND(gs.thuc)} · TỔNG CỘNG ${formatVND(gs.tongCong)} · ${r1(gs.gio).toFixed(1)} giờ`} />
                      {g.rows.map((s: any, idx: number) => {
                        const st = String(s?.status || 'DRAFT').toUpperCase();
                        const colors: Record<string, { bg: string; fg: string }> = { DRAFT: { bg: '#F1F5F9', fg: '#475569' }, PUBLISHED: { bg: '#ECFDF5', fg: '#047857' }, CONFIRMED: { bg: '#FEF3C7', fg: '#92400E' }, PAID: { bg: '#DCFCE7', fg: '#166534' }, COMPLAINED: { bg: '#FEF2F2', fg: '#991B1B' } };
                        const c = colors[st] || colors.DRAFT;
                        const calc = slipCalc(s);
                        const rowKey = String(s?.item_id || s?.employee_id);
                        const isEditing = editingId === rowKey;
                        const lockedEdit = ['CONFIRMED', 'PAID'].includes(st);
                        const numCell = (field: string) => (
                          <input type="number" className="fin-input" style={{ width: '100%', minWidth: 74, padding: '4px 6px', fontSize: 11.5 }}
                            value={editVals[field] ?? ''} onChange={e => setEditVals((p: any) => ({ ...p, [field]: e.target.value }))} aria-label={field} />
                        );
                        return (
                          <tr key={s?.item_id || `${s?.employee_id}-${s?.period}`} style={isEditing ? { backgroundColor: '#FFFBEB' } : undefined}>
                            {show('stt') && <td className="ctr">{idx + 1}</td>}
                            {show('full_name') && <td style={{ fontWeight: 700 }}>{s?.full_name || s?.fullName || '—'}</td>}
                            {show('employee_code') && <td className="ctr fin-mono">{s?.employee_code || s?.employeeCode || '—'}</td>}
                            {show('branch') && <td>{branchLabelOf(slipBranchId(s, allEmployees))}</td>}
                            {show('gio') && <td className="num">{r1(calc.gio).toFixed(1)}</td>}
                            {show('banCa') && <td className="num fin-money">{formatVND(calc.banCa)}</td>}
                            {show('phuCap') && <td className="num fin-money">{formatVND(calc.phuCap)}</td>}
                            {show('lcb') && <td className="num">{isEditing ? numCell('luong_cb') : <span className="fin-money">{formatVND(calc.lcb)}</span>}</td>}
                            {show('ot') && <td className="num">{isEditing ? numCell('ot_extra') : <span className="fin-money">{formatVND(calc.ot)}</span>}</td>}
                            {show('bonus') && <td className="num">{isEditing ? numCell('bonus_extra') : <span className="fin-money">{formatVND(calc.bonus)}</span>}</td>}
                            {show('tongCong') && <td className="num fin-money" style={{ fontWeight: 700 }}>{formatVND(calc.tongCong)}</td>}
                            {show('truKpiPhat') && <td className="num">{isEditing ? numCell('tru_kpi') : <span className="fin-money" style={{ color: 'var(--fin-red)' }}>{formatVND(calc.truKpiPhat)}</span>}</td>}
                            {show('ung') && <td className="num">{isEditing ? numCell('ung_luong') : <span className="fin-money" style={{ color: 'var(--fin-red)' }}>{formatVND(calc.ung)}</span>}</td>}
                            {show('dongPhuc') && <td className="num">{isEditing ? numCell('dong_phuc') : <span className="fin-money" style={{ color: 'var(--fin-red)' }}>{formatVND(calc.dongPhuc)}</span>}</td>}
                            {show('tongLuong') && <td className="num fin-money">{formatVND(calc.tongLuong)}</td>}
                            {show('thuc') && <td className="num fin-money" style={{ fontWeight: 800, color: 'var(--fin-green)' }}>{formatVND(calc.thuc)}</td>}
                            {show('status') && <td>
                              <span className="fin-badge" style={{ color: c.fg, background: c.bg, borderColor: c.fg + '40' }}><span className="fin-badge-dot" />{st}</span>
                              <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                                <span className={`fin-sign${s?.sign_lap ? ' ok' : ' pending'}`}>{s?.sign_lap ? '✓ KT' : 'KT?'}</span>
                                <span className={`fin-sign${s?.sign_giamdoc ? ' ok' : ' pending'}`}>{s?.sign_giamdoc ? '✓ GĐ' : 'GĐ?'}</span>
                                <span className={`fin-sign${s?.sign_nhanvien ? ' ok-green' : ' pending'}`}>{s?.sign_nhanvien ? '✓ NV' : 'NV?'}</span>
                              </div>
                            </td>}
                            {show('edit') && <td className="ctr">
                              {isEditing ? (
                                <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                                  <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" disabled={editSaving} onClick={() => saveEdit(s)}>{editSaving ? 'Đang lưu…' : <Save size={12} />}</button>
                                  <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" disabled={editSaving} onClick={() => setEditingId(null)}>Hủy</button>
                                </div>
                              ) : (
                                <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" disabled={lockedEdit}
                                  title={lockedEdit ? `Phiếu ${st} đã khóa — hãy quay về bước trước để hoàn DRAFT trước khi sửa` : 'Sửa trực tiếp: LCB, OT, Bonus, Trừ KPI, Ứng, Trừ ĐP'}
                                  onClick={() => startEdit(s)}>
                                  ✏️ Sửa
                                </button>
                              )}
                            </td>}
                          </tr>
                        );
                      })}
                      <tr className="fin-subtotal">
                        <td colSpan={Math.max(1, colCount - 14)}>CỘNG {branchLabelOf(g.id).toUpperCase()} ({g.rows.length} NV)</td>
                        {show('gio') && <td className="num">{r1(gs.gio).toFixed(1)}</td>}
                        {show('banCa') && <td className="num fin-money">{formatVND(gs.banCa)}</td>}
                        {show('phuCap') && <td className="num fin-money">{formatVND(gs.phuCap)}</td>}
                        {show('lcb') && <td className="num fin-money">{formatVND(gs.lcb)}</td>}
                        {show('ot') && <td className="num fin-money">{formatVND(gs.ot)}</td>}
                        {show('bonus') && <td className="num fin-money">{formatVND(gs.bonus)}</td>}
                        {show('tongCong') && <td className="num fin-money">{formatVND(gs.tongCong)}</td>}
                        {show('truKpiPhat') && <td className="num fin-money">{formatVND(gs.truKpiPhat)}</td>}
                        {show('ung') && <td className="num fin-money">{formatVND(gs.ung)}</td>}
                        {show('dongPhuc') && <td className="num fin-money">{formatVND(gs.dongPhuc)}</td>}
                        {show('tongLuong') && <td className="num fin-money">{formatVND(gs.tongLuong)}</td>}
                        {show('thuc') && <td className="num fin-money">{formatVND(gs.thuc)}</td>}
                        {show('status') && <td />}
                        {show('edit') && <td />}
                      </tr>
                    </React.Fragment>
                  );
                })}
                {filteredSlips.length === 0 && <tr><td colSpan={FIN_COL_HEADER_COUNT('fin-payroll-periods', colDefs, cols)} className="fin-empty">{q || statusFilter !== 'ALL' ? 'Không có phiếu phù hợp bộ lọc.' : 'Chưa có phiếu lương kỳ này.'}</td></tr>}
                {allSlips.length > 0 && (
                  <tr className="fin-grand">
                    <td colSpan={Math.max(1, FIN_COL_HEADER_COUNT('fin-payroll-periods', colDefs, cols) - 14)}>TỔNG TOÀN CÔNG TY ({allSlips.length} phiếu)</td>
                    {show('gio') && <td className="num">{r1(grand.gio).toFixed(1)}</td>}
                    {show('banCa') && <td className="num fin-money">{formatVND(grand.banCa)}</td>}
                    {show('phuCap') && <td className="num fin-money">{formatVND(grand.phuCap)}</td>}
                    {show('lcb') && <td className="num fin-money">{formatVND(grand.lcb)}</td>}
                    {show('ot') && <td className="num fin-money">{formatVND(grand.ot)}</td>}
                    {show('bonus') && <td className="num fin-money">{formatVND(grand.bonus)}</td>}
                    {show('tongCong') && <td className="num fin-money">{formatVND(grand.tongCong)}</td>}
                    {show('truKpiPhat') && <td className="num fin-money">{formatVND(grand.truKpiPhat)}</td>}
                    {show('ung') && <td className="num fin-money">{formatVND(grand.ung)}</td>}
                    {show('dongPhuc') && <td className="num fin-money">{formatVND(grand.dongPhuc)}</td>}
                    {show('tongLuong') && <td className="num fin-money">{formatVND(grand.tongLuong)}</td>}
                    {show('thuc') && <td className="num fin-money">{formatVND(grand.thuc)}</td>}
                    {show('status') && <td />}
                    {show('edit') && <td />}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Các kỳ trong tháng (metadata) */}
      <div className="fin-card">
        <CardHead title="Các kỳ lương trong tháng" icon={<Building2 size={14} color="#E85D92" />} sub="Mỗi lần TÍNH LƯƠNG tạo một kỳ mới — kỳ cũ vẫn giữ nguyên để đối chiếu" />
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
              {monthRuns.length === 0 && <tr><td colSpan={7} className="fin-empty">Chưa có kỳ — danh sách phiếu từng nhân viên ở trên sẽ hiện sau khi tính lương.</td></tr>}
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
  { key: 'BI_KHIEU_NAI', label: '⚠️ Khiếu nại' },
  { key: 'CHO_CHUYEN_KHOAN', label: 'Chờ chuyển khoản' },
  { key: 'PAID', label: 'Đã chuyển khoản' },
];

function PayslipsTab({ month, slips, slipsLoading, allEmployees, formatVND, loadSlips, stageBadge, slipQrUrl, fastSignLap, fastSignLapAll, publishSlip, returnSlip, markPaidSlip, syncSlipDrive, downloadSlipPdf, cols, onToggleCol, onShowAllCols, colVis, colVisSaving, colDefs }: any) {
  const [stageFilter, setStageFilter] = useState('ALL');
  const [q, setQ] = useState('');
  const show = cols?.show || (() => true);
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
      <TabHead step={7} title="Phiếu lương — KT ký → GĐ → NV ký / khiếu nại" desc="Luồng ký 3 bên theo đúng thứ tự: Kế toán lập & ký → Giám đốc ký duyệt → Kế toán gửi NV → Nhân viên ký (xác nhận đúng → phiếu trả về KT + PDF lên Drive 04) → Kế toán bấm ĐÃ CHUYỂN KHOẢN (phiếu khóa vĩnh viễn). NV khiếu nại → phiếu trả về KT kiểm tra lại (COMPLAINED).">
        <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" onClick={() => fastSignLapAll?.()} title="Ký lập bằng chữ ký mẫu cho mọi phiếu DRAFT chưa có chữ ký Kế toán. Giám đốc sẽ thấy phiếu ngay sau khi Kế toán ký.">
          <PenTool size={13} /> Ký lập hàng loạt (KT)
        </button>
      </TabHead>

      <div className="fin-kpi-grid">
        <Kpi icon={<Receipt size={18} />} label="Tổng phiếu" value={String(slips.length)} sub={`Kỳ ${periodLabel(month)}`} />
        <Kpi icon={<PenTool size={18} />} tone="amber" label="Chờ GĐ duyệt" value={String(counts['CHO_GD_DUYET'] || 0)} sub="KT đã ký lập" />
        <Kpi icon={<Send size={18} />} tone="violet" label="Chờ NV ký" value={String(counts['CHO_NV_KY'] || 0)} sub="Đã gửi nhân viên" />
        <Kpi icon={<AlertCircle size={18} />} tone="red" label="Khiếu nại" value={String(counts['BI_KHIEU_NAI'] || 0)} sub="Chờ KT kiểm tra lại" />
        <Kpi icon={<CreditCard size={18} />} tone="amber" label="Chờ chuyển khoản" value={String(confirmedCount)} sub="NV đã ký — hiện QR" />
        <Kpi icon={<CheckCircle size={18} />} tone="green" label="Đã chuyển khoản" value={String(paidCount)} sub="Phiếu khóa + PDF Drive 04" />
      </div>

      <div className="fin-card">
        <CardHead title={`Danh sách phiếu lương — ${periodLabel(month)} (${slips.length}/${slips.length} phiếu)`} icon={<Receipt size={14} color="#E85D92" />} sub="Nhóm theo chi nhánh · mỗi NV 1 dòng với ĐỦ cột tiền · mỗi chi nhánh 1 dòng CỘNG tổng tiền">
          <SearchBox value={q} onChange={setQ} />
          <ColumnSettings tabKey="fin-payslips" defs={colDefs} value={colVis} onToggle={onToggleCol} onShowAll={() => onShowAllCols('fin-payslips')} saving={colVisSaving} />
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
            <table className="fin-table" style={{ minWidth: 2150 }}>
              <thead>
                <tr>{show('stt') && <th className="ctr">STT</th>}{show('full_name') && <th>Họ tên</th>}{show('employee_code') && <th>Mã NV</th>}{show('branch') && <th>Chi nhánh</th>}{show('gio') && <th className="num">Giờ công</th>}{show('banCa') && <th className="num">Lương ca</th>}{show('phuCap') && <th className="num">Phụ cấp</th>}{show('lcb') && <th className="num">LCB</th>}{show('ot') && <th className="num">OT thêm</th>}{show('bonus') && <th className="num">Bonus</th>}{show('tongCong') && <th className="num">TỔNG CỘNG</th>}{show('truKpiPhat') && <th className="num">Trừ KPI/phạt</th>}{show('ung') && <th className="num">Ứng lương</th>}{show('dongPhuc') && <th className="num">Trừ ĐP</th>}{show('tongLuong') && <th className="num">TỔNG LƯƠNG</th>}{show('thuc') && <th className="num">THỰC LÃNH</th>}{show('sign') && <th>Trạng thái / Chữ ký</th>}{show('action') && <th>Thao tác</th>}</tr>
              </thead>
              <tbody>
                {groups.map(g => {
                  const gs = sumCalc(g.rows);
                  const COLS = FIN_COL_HEADER_COUNT('fin-payslips', colDefs, cols);
                  return (
                    <React.Fragment key={g.id}>
                      <BranchBandRow label={branchLabelOf(g.id)} count={g.rows.length} cols={COLS} totalText={`THỰC LÃNH ${formatVND(gs.thuc)} · TỔNG CỘNG ${formatVND(gs.tongCong)} · ${r1(gs.gio).toFixed(1)} giờ`} />
                      {g.rows.map((s: any, idx: number) => {
                        const st = stageBadge(s.stage ?? s.status);
                        const c = slipCalc(s);
                        const thuc = c.thuc;
                        const hasLap = !!s.sign_lap;
                        const hasGd = !!s.sign_giamdoc;
                        const hasNv = !!s.sign_nhanvien;
                        const isPaid = String(s.status) === 'PAID';
                        const isConfirmed = String(s.status) === 'CONFIRMED';
                        const isPublished = String(s.status) === 'PUBLISHED';
                        const qrUrl = slipQrUrl(s);
                        return (
                          <tr key={s.item_id}>
                            {show('stt') && <td className="ctr">{idx + 1}</td>}
                            {show('full_name') && <td style={{ fontWeight: 700 }}>{s.full_name}</td>}
                            {show('employee_code') && <td className="ctr fin-mono">{s.employee_code}</td>}
                            {show('branch') && <td>{branchLabelOf(slipBranchId(s, allEmployees))}</td>}
                            {show('gio') && <td className="num">{r1(c.gio).toFixed(1)}</td>}
                            {show('banCa') && <td className="num fin-money">{formatVND(c.banCa)}</td>}
                            {show('phuCap') && <td className="num fin-money">{formatVND(c.phuCap)}</td>}
                            {show('lcb') && <td className="num fin-money">{formatVND(c.lcb)}</td>}
                            {show('ot') && <td className="num fin-money">{formatVND(c.ot)}</td>}
                            {show('bonus') && <td className="num fin-money">{formatVND(c.bonus)}</td>}
                            {show('tongCong') && <td className="num fin-money" style={{ fontWeight: 700 }}>{formatVND(c.tongCong)}</td>}
                            {show('truKpiPhat') && <td className="num fin-money" style={{ color: 'var(--fin-red)' }}>{formatVND(c.truKpiPhat)}</td>}
                            {show('ung') && <td className="num fin-money" style={{ color: 'var(--fin-red)' }}>{formatVND(c.ung)}</td>}
                            {show('dongPhuc') && <td className="num fin-money" style={{ color: 'var(--fin-red)' }}>{formatVND(c.dongPhuc)}</td>}
                            {show('tongLuong') && <td className="num fin-money">{formatVND(c.tongLuong)}</td>}
                            {show('thuc') && <td className="num fin-money" style={{ fontWeight: 800, color: 'var(--fin-green)' }}>{formatVND(thuc)}</td>}
                            {show('sign') && <td>
                              <span className="fin-badge" style={{ color: st.fg, background: st.bg, borderColor: st.border, marginBottom: 5 }}><span className="fin-badge-dot" />{st.label}</span>
                              <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
                                <span className={`fin-sign ${hasLap ? 'ok' : 'pending'}`}>{hasLap ? '✓ KT lập' : 'KT?'}</span>
                                <span className={`fin-sign ${hasGd ? 'ok' : 'pending'}`}>{hasGd ? '✓ GĐ duyệt' : 'GĐ?'}</span>
                                <span className={`fin-sign ${hasNv ? 'ok-green' : 'pending'}`}>{hasNv ? '✓ NV ký' : 'NV?'}</span>
                              </div>
                              {String(s.status) === 'COMPLAINED' && (s.complaint_reason || s.complaint_detail) && (
                                <div style={{ marginTop: 6, fontSize: 10, lineHeight: 1.45, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, padding: '6px 8px', color: '#991B1B' }}>
                                  <b>⚠️ NV khiếu nại{s.complaint_at ? ` lúc ${fmtDateTime(s.complaint_at)}` : ''}:</b>
                                  <div><b>{s.complaint_reason || '—'}</b>{s.complaint_detail ? ` — ${s.complaint_detail}` : ''}</div>
                                </div>
                              )}
                              {s.drive_pdf_id && <div style={{ marginTop: 4, fontSize: 9.5, color: 'var(--fin-muted)' }}>✓ PDF Drive 04 ({s.drive_synced_at ? fmtDateTime(s.drive_synced_at) : ''})</div>}
                              {s.drive_sync_error && <div style={{ marginTop: 4, fontSize: 9.5, color: '#dc2626' }}>⚠ Drive: {s.drive_sync_error}</div>}
                            </td>}
                            {show('action') && (
                              <td>
                              {isPaid ? (
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                  <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={() => downloadSlipPdf(s.item_id, s.employee_code)} title="Tải PDF phiếu (đủ 3 chữ ký)"><FileDown size={12} /> PDF</button>
                                  <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={() => syncSlipDrive(s.item_id)} title="Đồng bộ lại PDF lên Drive 04"><Upload size={12} /> Drive{s.drive_pdf_id ? ' ✓' : ''}</button>
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
                                    <div style={{ color: 'var(--fin-muted)', fontSize: 9.5 }}>✓ Đã trả về KT + PDF Drive 04 ({s.drive_pdf_id ? 'đã lên' : 'đang chờ'})</div>
                                    <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" style={{ marginTop: 4 }} onClick={() => markPaidSlip(s.item_id)}><Check size={12} /> Đã Chuyển Khoản</button>
                                    <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" style={{ marginTop: 4, marginLeft: 4 }} onClick={() => syncSlipDrive(s.item_id)} title="Đồng bộ lại PDF lên Drive 04"><Upload size={12} /> Drive</button>
                                  </div>
                                </div>
                              ) : String(s.status) === 'COMPLAINED' ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  <span style={{ fontSize: 10.5, color: '#991B1B', fontWeight: 700 }}>Phiếu đã trả về Kế toán để kiểm tra lại…</span>
                                  <button type="button" className="fin-btn fin-btn-amber fin-btn-sm" onClick={() => returnSlip(s.item_id)} title="Hoàn phiếu về DRAFT để sửa số liệu khiếu nại, rồi ký/gửi lại NV"><RefreshCw size={12} /> Kiểm tra lại (về DRAFT)</button>
                                </div>
                              ) : isPublished ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  <span style={{ fontSize: 10.5, color: '#9a3412', fontWeight: 700 }}>Chờ nhân viên ký nhận…</span>
                                  <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={() => returnSlip(s.item_id)} title="Thu hồi phiếu đã gửi NV về DRAFT khi gửi nhầm"><RefreshCw size={12} /> Thu hồi</button>
                                </div>
                              ) : hasLap && !hasGd ? (
                                <span style={{ fontSize: 10.5, color: '#92400e', fontWeight: 700 }}>Chờ Giám đốc ký duyệt</span>
                              ) : hasGd && hasLap ? (
                                <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" onClick={() => publishSlip(s.item_id)}><Send size={12} /> Gửi NV ký</button>
                              ) : (
                                <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" onClick={() => fastSignLap(s.item_id)} disabled={hasLap}><PenTool size={12} /> Kế toán ký lập</button>
                              )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                      <tr className="fin-subtotal">
                        <td colSpan={Math.max(1, FIN_COL_HEADER_COUNT('fin-payslips', colDefs, cols) - 14)}>CỘNG {branchLabelOf(g.id).toUpperCase()} ({g.rows.length} NV)</td>
                        {show('gio') && <td className="num">{r1(gs.gio).toFixed(1)}</td>}
                        {show('banCa') && <td className="num fin-money">{formatVND(gs.banCa)}</td>}
                        {show('phuCap') && <td className="num fin-money">{formatVND(gs.phuCap)}</td>}
                        {show('lcb') && <td className="num fin-money">{formatVND(gs.lcb)}</td>}
                        {show('ot') && <td className="num fin-money">{formatVND(gs.ot)}</td>}
                        {show('bonus') && <td className="num fin-money">{formatVND(gs.bonus)}</td>}
                        {show('tongCong') && <td className="num fin-money">{formatVND(gs.tongCong)}</td>}
                        {show('truKpiPhat') && <td className="num fin-money">{formatVND(gs.truKpiPhat)}</td>}
                        {show('ung') && <td className="num fin-money">{formatVND(gs.ung)}</td>}
                        {show('dongPhuc') && <td className="num fin-money">{formatVND(gs.dongPhuc)}</td>}
                        {show('tongLuong') && <td className="num fin-money">{formatVND(gs.tongLuong)}</td>}
                        {show('thuc') && <td className="num fin-money">{formatVND(gs.thuc)}</td>}
                        {show('sign') && <td />}
                        {show('action') && <td />}
                      </tr>
                    </React.Fragment>
                  );
                })}
                {groups.length === 0 && <tr><td colSpan={FIN_COL_HEADER_COUNT('fin-payslips', colDefs, cols)} className="fin-empty">{q || stageFilter !== 'ALL' ? 'Không có phiếu phù hợp bộ lọc.' : 'Chưa có phiếu lương kỳ này — hãy TÍNH LƯƠNG ở tab 4.'}</td></tr>}
                {slips.length > 0 && (
                  <tr className="fin-grand">
                    <td colSpan={Math.max(1, FIN_COL_HEADER_COUNT('fin-payslips', colDefs, cols) - 14)}>TỔNG TOÀN CÔNG TY ({slips.length} phiếu)</td>
                    {show('gio') && <td className="num">{r1(sumCalc(slips).gio).toFixed(1)}</td>}
                    {show('banCa') && <td className="num fin-money">{formatVND(sumCalc(slips).banCa)}</td>}
                    {show('phuCap') && <td className="num fin-money">{formatVND(sumCalc(slips).phuCap)}</td>}
                    {show('lcb') && <td className="num fin-money">{formatVND(sumCalc(slips).lcb)}</td>}
                    {show('ot') && <td className="num fin-money">{formatVND(sumCalc(slips).ot)}</td>}
                    {show('bonus') && <td className="num fin-money">{formatVND(sumCalc(slips).bonus)}</td>}
                    {show('tongCong') && <td className="num fin-money">{formatVND(sumCalc(slips).tongCong)}</td>}
                    {show('truKpiPhat') && <td className="num fin-money">{formatVND(sumCalc(slips).truKpiPhat)}</td>}
                    {show('ung') && <td className="num fin-money">{formatVND(sumCalc(slips).ung)}</td>}
                    {show('dongPhuc') && <td className="num fin-money">{formatVND(sumCalc(slips).dongPhuc)}</td>}
                    {show('tongLuong') && <td className="num fin-money">{formatVND(sumCalc(slips).tongLuong)}</td>}
                    {show('thuc') && <td className="num fin-money">{formatVND(sumCalc(slips).thuc)}</td>}
                    {show('sign') && <td />}
                    {show('action') && <td />}
                  </tr>
                )}
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
function PaymentTab({ month, slips, allEmployees, formatVND, loadSlips, slipQrUrl, markPaidSlip, downloadSlipPdf, cols, onToggleCol, onShowAllCols, colVis, colVisSaving, colDefs }: any) {
  const [q, setQ] = useState('');
  const show = cols?.show || (() => true);
  const ready = useMemo(() => (slips || []).filter((s: any) => String(s?.status) === 'CONFIRMED').filter(matchesFilter(q.trim())), [slips, q]);
  const groups = useMemo(() => branchGroups(ready, (s: any) => slipBranchId(s, allEmployees)), [ready, allEmployees]);
  const grand = sumCalc(ready);
  const COLS = FIN_COL_HEADER_COUNT('fin-payment', colDefs, cols);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TabHead step={8} title="Thanh toán — VietQR & Đã chuyển khoản" desc="Chỉ hiện phiếu NHÂN VIÊN ĐÃ KÝ. Nhóm theo chi nhánh, mỗi NV 1 dòng với ĐỦ cột tiền + dòng CỘNG tổng tiền chi nhánh. Quét QR → chuyển khoản → bấm ĐÃ CHUYỂN KHOẢN: phiếu KHÓA vĩnh viễn và PDF (đủ 3 chữ ký) tự lên Drive theo 04. PHIẾU LƯƠNG NHÂN VIÊN/THANG_MM/CHI_NHANH_*/PHIEU_LUONG_TMM.YYYY_TÊN NV.pdf.">
        <SearchBox value={q} onChange={setQ} />
        <ColumnSettings tabKey="fin-payment" defs={colDefs} value={colVis} onToggle={onToggleCol} onShowAll={() => onShowAllCols('fin-payment')} saving={colVisSaving} />
        <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={loadSlips}><RefreshCw size={13} /> Tải lại</button>
      </TabHead>

      <div className="fin-kpi-grid">
        <Kpi icon={<CreditCard size={18} />} tone="amber" label="Phiếu chờ CK" value={String(ready.length)} sub="Đã đủ 3 chữ ký" />
        <Kpi icon={<Banknote size={18} />} label="Tổng cần chuyển" value={formatVND(grand.thuc)} sub="Theo thực lãnh" />
      </div>

      <div className="fin-card">
        <CardHead title={`Chờ chuyển khoản — ${periodLabel(month)} (${ready.length})`} icon={<CreditCard size={14} color="#E85D92" />} sub="Sau khi chuyển, bấm ĐÃ CHUYỂN KHOẢN để khóa phiếu + đẩy PDF lên Drive" />
        <div className="fin-table-wrap">
          <table className="fin-table" style={{ minWidth: 2250 }}>
            <thead>
              <tr>{show('stt') && <th className="ctr">STT</th>}{show('full_name') && <th>Họ tên</th>}{show('employee_code') && <th>Mã NV</th>}{show('branch') && <th>Chi nhánh</th>}{show('gio') && <th className="num">Giờ công</th>}{show('banCa') && <th className="num">Lương ca</th>}{show('phuCap') && <th className="num">Phụ cấp</th>}{show('lcb') && <th className="num">LCB</th>}{show('ot') && <th className="num">OT thêm</th>}{show('bonus') && <th className="num">Bonus</th>}{show('tongCong') && <th className="num">TỔNG CỘNG</th>}{show('truKpiPhat') && <th className="num">Trừ KPI/phạt</th>}{show('ung') && <th className="num">Ứng lương</th>}{show('dongPhuc') && <th className="num">Trừ ĐP</th>}{show('tongLuong') && <th className="num">TỔNG LƯƠNG</th>}{show('thuc') && <th className="num">THỰC LÃNH</th>}{show('bank') && <th>Ngân hàng / STK</th>}{show('qr') && <th className="ctr">VietQR</th>}{show('action') && <th>Thao tác</th>}</tr>
            </thead>
            <tbody>
              {groups.map(g => {
                const gs = sumCalc(g.rows);
                return (
                  <React.Fragment key={g.id}>
                    <BranchBandRow label={branchLabelOf(g.id)} count={g.rows.length} cols={COLS} totalText={`Cần chuyển ${formatVND(gs.thuc)} · TỔNG CỘNG ${formatVND(gs.tongCong)}`} />
                    {g.rows.map((s: any, idx: number) => {
                      const c = slipCalc(s);
                      const qrUrl = slipQrUrl(s);
                      return (
                        <tr key={s.item_id}>
                          {show('stt') && <td className="ctr">{idx + 1}</td>}
                          {show('full_name') && <td style={{ fontWeight: 700 }}>{s.full_name}</td>}
                          {show('employee_code') && <td className="ctr fin-mono">{s.employee_code}</td>}
                          {show('branch') && <td>{branchLabelOf(slipBranchId(s, allEmployees))}</td>}
                          {show('gio') && <td className="num">{r1(c.gio).toFixed(1)}</td>}
                          {show('banCa') && <td className="num fin-money">{formatVND(c.banCa)}</td>}
                          {show('phuCap') && <td className="num fin-money">{formatVND(c.phuCap)}</td>}
                          {show('lcb') && <td className="num fin-money">{formatVND(c.lcb)}</td>}
                          {show('ot') && <td className="num fin-money">{formatVND(c.ot)}</td>}
                          {show('bonus') && <td className="num fin-money">{formatVND(c.bonus)}</td>}
                          {show('tongCong') && <td className="num fin-money" style={{ fontWeight: 700 }}>{formatVND(c.tongCong)}</td>}
                          {show('truKpiPhat') && <td className="num fin-money" style={{ color: 'var(--fin-red)' }}>{formatVND(c.truKpiPhat)}</td>}
                          {show('ung') && <td className="num fin-money" style={{ color: 'var(--fin-red)' }}>{formatVND(c.ung)}</td>}
                          {show('dongPhuc') && <td className="num fin-money" style={{ color: 'var(--fin-red)' }}>{formatVND(c.dongPhuc)}</td>}
                          {show('tongLuong') && <td className="num fin-money">{formatVND(c.tongLuong)}</td>}
                          {show('thuc') && <td className="num fin-money" style={{ fontWeight: 800, color: 'var(--fin-green)' }}>{formatVND(c.thuc)}</td>}
                          {show('bank') && <td style={{ fontSize: 11 }}>{s.bank_name || '—'}<br /><span className="fin-mono" style={{ fontWeight: 800, color: 'var(--fin-ink)' }}>{s.bank_account || '—'}</span><br /><span style={{ color: 'var(--fin-muted)' }}>{s.bank_holder || ''}</span></td>}
                          {show('qr') && <td className="ctr">{qrUrl ? <img src={qrUrl} alt="VietQR" className="fin-qr" style={{ width: 72, height: 72 }} onError={(e: any) => { (e.target as any).style.display = 'none'; }} /> : <div className="fin-qr-missing">Chưa có STK</div>}</td>}
                          {show('action') && (
                            <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                              <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" onClick={() => markPaidSlip(s.item_id)}><Check size={12} /> Đã Chuyển Khoản</button>
                              <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={() => downloadSlipPdf(s.item_id, s.employee_code)}><FileDown size={12} /> PDF (3 chữ ký)</button>
                            </div>
                          </td>
                          )}
                        </tr>
                      );
                    })}
                    <tr className="fin-subtotal">
                      <td colSpan={Math.max(1, COLS - 14)}>CỘNG {branchLabelOf(g.id).toUpperCase()} ({g.rows.length} NV)</td>
                      {show('gio') && <td className="num">{r1(gs.gio).toFixed(1)}</td>}
                      {show('banCa') && <td className="num fin-money">{formatVND(gs.banCa)}</td>}
                      {show('phuCap') && <td className="num fin-money">{formatVND(gs.phuCap)}</td>}
                      {show('lcb') && <td className="num fin-money">{formatVND(gs.lcb)}</td>}
                      {show('ot') && <td className="num fin-money">{formatVND(gs.ot)}</td>}
                      {show('bonus') && <td className="num fin-money">{formatVND(gs.bonus)}</td>}
                      {show('tongCong') && <td className="num fin-money">{formatVND(gs.tongCong)}</td>}
                      {show('truKpiPhat') && <td className="num fin-money">{formatVND(gs.truKpiPhat)}</td>}
                      {show('ung') && <td className="num fin-money">{formatVND(gs.ung)}</td>}
                      {show('dongPhuc') && <td className="num fin-money">{formatVND(gs.dongPhuc)}</td>}
                      {show('tongLuong') && <td className="num fin-money">{formatVND(gs.tongLuong)}</td>}
                      {show('thuc') && <td className="num fin-money">{formatVND(gs.thuc)}</td>}
                      <td colSpan={[show('bank'), show('qr'), show('action')].filter(Boolean).length} />
                    </tr>
                  </React.Fragment>
                );
              })}
              {groups.length === 0 && <tr><td colSpan={COLS} className="fin-empty">Không có phiếu nào chờ chuyển khoản (chưa NV ký hoặc đã chuyển hết).</td></tr>}
              {ready.length > 0 && (
                <tr className="fin-grand">
                  <td colSpan={Math.max(1, COLS - 14)}>TỔNG TOÀN CÔNG TY ({ready.length} phiếu)</td>
                  {show('gio') && <td className="num">{r1(grand.gio).toFixed(1)}</td>}
                  {show('banCa') && <td className="num fin-money">{formatVND(grand.banCa)}</td>}
                  {show('phuCap') && <td className="num fin-money">{formatVND(grand.phuCap)}</td>}
                  {show('lcb') && <td className="num fin-money">{formatVND(grand.lcb)}</td>}
                  {show('ot') && <td className="num fin-money">{formatVND(grand.ot)}</td>}
                  {show('bonus') && <td className="num fin-money">{formatVND(grand.bonus)}</td>}
                  {show('tongCong') && <td className="num fin-money">{formatVND(grand.tongCong)}</td>}
                  {show('truKpiPhat') && <td className="num fin-money">{formatVND(grand.truKpiPhat)}</td>}
                  {show('ung') && <td className="num fin-money">{formatVND(grand.ung)}</td>}
                  {show('dongPhuc') && <td className="num fin-money">{formatVND(grand.dongPhuc)}</td>}
                  {show('tongLuong') && <td className="num fin-money">{formatVND(grand.tongLuong)}</td>}
                  {show('thuc') && <td className="num fin-money">{formatVND(grand.thuc)}</td>}
                  <td colSpan={[show('bank'), show('qr'), show('action')].filter(Boolean).length} />
                </tr>
              )}
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
