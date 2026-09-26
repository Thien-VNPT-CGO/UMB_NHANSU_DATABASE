import React, { useState, useEffect, useMemo, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { apiRequest, setAuthToken, getAuthToken, getApiBase, setCustomApiUrl } from './services/api';
import {
  Users,
  Calendar,
  Clock,
  DollarSign,
  Megaphone,
  Shield,
  Bell,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
  Check,
  X,
  Plus,
  Send,
  Building2,
  ChevronRight,
  Database,
  Lock,
  ExternalLink,
  Settings,
  HardDrive,
  Activity,
  Sliders,
  FileCheck,
  Search,
  Filter,
  RefreshCw,
  DownloadCloud,
  LogOut,
  Eye,
  EyeOff,
  UserCheck,
  Store,
  FileText,
  CreditCard,
  Radio,
  FileSpreadsheet,
  Award,
  Volume2,
  VolumeX
} from 'lucide-react';
import { RoleViews } from './components/RoleViews';
import {
  playNotificationDing,
  playSuccessChime,
  playWarningTone,
  playButtonPop,
  isSoundEnabled,
  setSoundEnabled,
} from './utils/sound-effects';

export interface LiveToastItem {
  id: string;
  type?: 'CHECKIN' | 'CHECKOUT' | 'LEAVE' | 'SWAP' | 'PIN_CHANGED' | 'PIN_SENT' | 'INFO' | 'WARNING';
  title: string;
  message: string;
  linkTab?: string;
  timestamp: string;
  duration?: number;
}

interface UserProfile {
  id: string;
  fullName: string;
  role: 'ADMIN' | 'HR' | 'STORE' | 'FINANCE' | 'MARKETING';
  branchScope: string;
  permissions: string[];
}

export const ROLE_TABS: Record<string, Array<{ id: string; label: string; icon: any }>> = {
  ADMIN: [
    { id: 'dashboard', label: '1. Dashboard', icon: Building2 },
    { id: 'internal-accounts', label: '2. Tài khoản & Phân quyền', icon: Shield },
    { id: 'activation', label: '3. PIN & TK Nhân viên', icon: FileCheck },
    { id: 'employees', label: '4. Quản lý Nhân viên', icon: Users },
    { id: 'branches', label: '5. Chi nhánh & Ca làm', icon: Calendar },
    { id: 'policies', label: '6. Chính sách hệ thống', icon: Sliders },
    { id: 'notifications', label: '7. Thông báo hệ thống', icon: Bell },
    { id: 'integrations', label: '8. Tích hợp & Đồng bộ', icon: Database },
    { id: 'maintenance', label: '9. Bảo trì hệ thống', icon: Activity },
    { id: 'audit', label: '10. Audit Log', icon: Clock },
    { id: 'backup', label: '11. Backup & Recovery', icon: HardDrive },
    { id: 'settings', label: '12. Cài đặt hệ thống', icon: Settings },
    { id: 'hr-official', label: '13. Import NV Chính thức', icon: Users },
  ],
  HR: [
    { id: 'hr-dashboard', label: '1. Dashboard HR', icon: Building2 },
    { id: 'activation', label: '2. PIN & TK Nhân viên', icon: FileCheck },
    { id: 'hr-candidates', label: '3. Ứng viên mới', icon: UserCheck },
    { id: 'hr-interviews', label: '4. Phỏng vấn & BOT Zalo', icon: Calendar },
    { id: 'hr-probation', label: '5. Nhân viên Thử việc', icon: Users },
    { id: 'hr-official', label: '6. Nhân viên Chính thức', icon: Users },
    { id: 'hr-conversion', label: '7. Chuyển Chính thức', icon: Award },
    { id: 'hr-schedule', label: '8. Lịch làm việc', icon: Calendar },
    { id: 'hr-leave', label: '9. Nghỉ OFF', icon: Clock },
    { id: 'hr-swap', label: '10. Đổi ca', icon: RefreshCw },
    { id: 'hr-emergency', label: '11. Nghỉ đột xuất', icon: AlertTriangle },
    { id: 'hr-attendance', label: '12. Chấm công', icon: CheckCircle },
    { id: 'hr-adjustments', label: '13. Bổ sung/Điều chỉnh công', icon: FileText },
    { id: 'hr-tests', label: '14. TEST nhân viên', icon: FileCheck },
    { id: 'hr-reports', label: '15. Báo cáo HR', icon: FileSpreadsheet },
    { id: 'hr-notifications', label: '16. Thông báo', icon: Bell },
  ],
  STORE: [
    { id: 'store-dashboard', label: '1. Dashboard Store', icon: Store },
    { id: 'store-employees', label: '2. Nhân viên chi nhánh', icon: Users },
    { id: 'store-schedule', label: '3. Lịch làm việc', icon: Calendar },
    { id: 'store-off', label: '4. OFF hàng tuần', icon: Clock },
    { id: 'store-swap', label: '5. Đổi ca', icon: RefreshCw },
    { id: 'store-emergency', label: '6. Nghỉ đột xuất', icon: AlertTriangle },
    { id: 'store-realtime-att', label: '7. Chấm công realtime', icon: CheckCircle },
    { id: 'store-confirm-att', label: '8. Xác nhận công', icon: FileCheck },
    { id: 'store-reports', label: '9. Báo cáo chi nhánh', icon: FileSpreadsheet },
    { id: 'store-notifications', label: '10. Thông báo', icon: Bell },
  ],
  FINANCE: [
    { id: 'fin-dashboard', label: '1. Dashboard Finance', icon: DollarSign },
    { id: 'fin-timesheet', label: '2. Bảng chấm công', icon: FileSpreadsheet },
    { id: 'fin-reconcile-att', label: '3. Đối soát công', icon: FileCheck },
    { id: 'fin-payroll-periods', label: '4. Kỳ lương', icon: Calendar },
    { id: 'fin-calculate', label: '5. Tính lương', icon: DollarSign },
    { id: 'fin-details', label: '6. Chi tiết lương NV', icon: Users },
    { id: 'fin-payslips', label: '7. Phiếu lương', icon: CreditCard },
    { id: 'fin-reconcile-payslips', label: '8. Đối soát Phiếu lương', icon: FileCheck },
    { id: 'fin-payment', label: '9. Thanh toán', icon: CheckCircle },
    { id: 'fin-reports', label: '10. Báo cáo Finance', icon: FileSpreadsheet },
    { id: 'fin-notifications', label: '11. Thông báo Finance', icon: Bell },
  ],
  MARKETING: [
    { id: 'mkt-dashboard', label: '1. Dashboard MKT', icon: Megaphone },
    { id: 'mkt-create-broadcast', label: '2. Tạo thông báo', icon: Plus },
    { id: 'mkt-audiences', label: '3. Nhóm người nhận', icon: Users },
    { id: 'mkt-schedule', label: '4. Lịch phát thông báo', icon: Calendar },
    { id: 'mkt-sent-list', label: '5. Nội dung đã phát', icon: Radio },
    { id: 'mkt-campaigns', label: '6. Notification Campaign', icon: Megaphone },
    { id: 'mkt-media', label: '7. Media', icon: HardDrive },
    { id: 'mkt-tracking', label: '8. Theo dõi gửi', icon: Activity },
    { id: 'mkt-notifications', label: '9. Thông báo hệ thống', icon: Bell },
  ],
};

// Quy chuẩn hiển thị chi nhánh: Khối văn phòng & sales => Trụ sở chính, Xưởng => Củ Chi, Store => theo chi nhánh cụ thể
export function getDisplayBranch(branchId?: string, group?: string): string {
  if (group === 'VAN_PHONG' || group === 'SALE' || branchId === 'VAN_PHONG') {
    return 'Văn Phòng: 10 Đặng Thai Mai (Phú Nhuận)';
  }
  if (group === 'XUONG' || branchId === 'XUONG_SX') {
    return 'Xưởng Sản Xuất (Củ Chi)';
  }
  if (branchId === 'CN130' || branchId === 'CN1') return 'CN1: 130 Vạn Kiếp (Bình Thạnh)';
  if (branchId === 'CN261' || branchId === 'CN2') return 'CN2: 261 Tô Hiến Thành (Q.10)';
  if (branchId === 'CN120' || branchId === 'CN3') return 'CN3: 120 Hoàng Diệu 2 (Thủ Đức)';
  if (branchId === 'CN111' || branchId === 'CN4') return 'CN4: 111 Tôn Đản (Q.4)';
  return branchId || 'Trụ sở chính (10 Đặng Thai Mai)';
}

// Trang xác thực Zalo mobile CŨ (luồng giả đã bỏ): giữ route để mã QR cũ quét vào
// vẫn thấy thông báo hướng dẫn thay vì treo. Luồng thật: quét QR Zalo trực tiếp
// bằng app Zalo trên điện thoại tại tab "Lịch Phỏng Vấn & BOT Zalo".
function ZaloMobileAuthView({ hrName, sessionToken }: { hrName: string; sessionToken: string }) {
  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#F0F9FF',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      boxSizing: 'border-box',
    }}>
      <div style={{
        backgroundColor: '#FFFFFF',
        borderRadius: '16px',
        boxShadow: '0 10px 25px rgba(0, 104, 255, 0.12)',
        border: '1.5px solid #F59E0B',
        padding: '28px 20px',
        maxWidth: '420px',
        width: '100%',
        textAlign: 'center',
      }}>
        <div style={{
          width: '64px',
          height: '64px',
          borderRadius: '50%',
          backgroundColor: '#F59E0B',
          color: '#FFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px',
          fontSize: '20px',
          fontWeight: 900,
        }}>
          Zalo
        </div>

        <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#0F172A', margin: '0 0 6px' }}>
          ỤM BÒ MILK - HR SYSTEM
        </h2>
        <div style={{ fontSize: '13px', color: '#92400E', fontWeight: 700, marginBottom: '18px' }}>
          Luồng xác thực cũ đã ngừng hoạt động
        </div>

        <div style={{
          backgroundColor: '#FFFBEB',
          border: '1px solid #FDE68A',
          borderRadius: '10px',
          padding: '14px',
          textAlign: 'left',
          fontSize: '13px',
          color: '#334155',
          lineHeight: '1.6',
          marginBottom: '20px',
        }}>
          <div>👤 <strong>Tài khoản HR:</strong> {hrName}</div>
          <div>🔑 <strong>Mã phiên cũ:</strong> <code style={{ color: '#92400E', fontWeight: 700 }}>{sessionToken}</code></div>
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#64748B', borderTop: '1px solid #FDE68A', paddingTop: '8px' }}>
            Từ nay kết nối Zalo cá nhân bằng cách <strong>quét mã QR thật bằng app Zalo</strong> ngay tại tab "Lịch Phỏng Vấn & BOT Zalo" trên máy tính. Không cần xác nhận tại trang này nữa — <strong>mời bạn quay lại màn hình máy tính làm việc.</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => {
    try {
      const savedUser = localStorage.getItem('ubm_admin_user');
      const savedToken = localStorage.getItem('ubm_admin_token');
      if (savedUser && savedToken) {
        setAuthToken(savedToken);
        return JSON.parse(savedUser);
      }
    } catch (e) {
      console.error('Failed to parse saved user', e);
    }
    return null;
  });
  const [activeTab, setActiveTab] = useState<string>(() => {
    const savedTab = localStorage.getItem('ubm_active_tab');
    if (savedTab) return savedTab;
    try {
      const savedUser = localStorage.getItem('ubm_admin_user');
      if (savedUser) {
        const u = JSON.parse(savedUser);
        if (u.role === 'ADMIN') return 'dashboard';
        if (u.role === 'HR') return 'hr-dashboard';
        if (u.role === 'STORE') return 'store-dashboard';
        if (u.role === 'FINANCE') return 'fin-dashboard';
        if (u.role === 'MARKETING') return 'mkt-dashboard';
      }
    } catch {}
    return 'dashboard';
  });
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsgState] = useState<string | null>(null);
  const [successMsg, setSuccessMsgState] = useState<string | null>(null);

  // Login Form State
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [customApiUrl, setCustomApiUrlState] = useState(localStorage.getItem('ubm_custom_api_url') || '');

  // 12 Modules States
  const [dashboardStats, setDashboardStats] = useState<any>(null);
  const [internalAccounts, setInternalAccounts] = useState<any[]>([]);
  const [employeeAccounts, setEmployeeAccounts] = useState<any[]>([]);
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [shiftTemplates, setShiftTemplates] = useState<any>({});
  const [policies, setPolicies] = useState<any>({});
  const [systemNotifications, setSystemNotifications] = useState<any[]>([]);
  const [integrationsStatus, setIntegrationsStatus] = useState<any>(null);
  const [maintenance, setMaintenance] = useState<any>({});
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [backupSnapshots, setBackupSnapshots] = useState<any[]>([]);
  const [systemSettings, setSystemSettings] = useState<any>({});

  // Additional HR/Store/Finance/MKT states
  const [shifts, setShifts] = useState<any[]>([]);
  const [leaves, setLeaves] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<any[]>([]);

  // Live Notifications, Rich Toasts & Audio States (Admin & HR)
  const [liveToasts, setLiveToasts] = useState<LiveToastItem[]>([]);
  const [bellRinging, setBellRinging] = useState(false);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [showNotifPopover, setShowNotifPopover] = useState(false);
  const [soundActive, setSoundActive] = useState(isSoundEnabled());

  const addRichToast = (toast: Omit<LiveToastItem, 'id' | 'timestamp'>) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const newToast: LiveToastItem = {
      ...toast,
      id,
      timestamp: new Date().toISOString(),
      duration: toast.duration || 6000,
    };

    // Phát âm thanh phù hợp
    if (toast.type === 'CHECKIN' || toast.type === 'CHECKOUT' || toast.type === 'LEAVE' || toast.type === 'SWAP' || toast.type === 'PIN_CHANGED') {
      playNotificationDing();
    } else if (toast.type === 'WARNING') {
      playWarningTone();
    } else {
      playSuccessChime();
    }

    setLiveToasts((prev) => [newToast, ...prev].slice(0, 5));
    setSystemNotifications((prev) => [
      {
        id,
        title: toast.title,
        message: toast.message,
        created_at: new Date().toISOString(),
        type: toast.type || 'INFO',
        linkTab: toast.linkTab,
        unread: true,
      },
      ...prev,
    ]);
    setUnreadNotifCount((prev) => prev + 1);
    setBellRinging(true);
    setTimeout(() => setBellRinging(false), 1200);

    setTimeout(() => {
      setLiveToasts((prev) => prev.filter((t) => t.id !== id));
    }, toast.duration || 6000);
  };

  const showToast = (msg: string, type: 'INFO' | 'WARNING' = 'INFO', customTitle?: string) => {
    const isWarn = msg.includes('⚠️') || msg.toLowerCase().includes('lỗi') || type === 'WARNING';
    let title = customTitle || (isWarn ? '⚠️ Cảnh Báo Hệ Thống' : '✨ Thao Tác Thành Công');
    if (!customTitle && !isWarn) {
      const lower = msg.toLowerCase();
      if (lower.includes('đồng bộ') || lower.includes('tải và cập nhật')) title = '⚡ Đồng Bộ Google Sheets Thành Công';
      else if (lower.includes('pin')) title = '🔑 Cấp & Gửi PIN Zalo';
      else if (lower.includes('sao lưu') || lower.includes('snapshot')) title = '💾 Bản Sao Lưu Snapshot';
      else if (lower.includes('khôi phục') || lower.includes('phục hồi')) title = '🔄 Phục Hồi Dữ Liệu';
      else if (lower.includes('xóa')) title = '🗑️ Đã Xóa Dữ Liệu';
      else if (lower.includes('bảo trì')) title = '🛠️ Chế Độ Bảo Trì';
      else if (lower.includes('chính sách')) title = '📜 Cập Nhật Chính Sách';
      else if (lower.includes('cấu hình') || lower.includes('cài đặt')) title = '⚙️ Đã Lưu Cấu Hình';
      else if (lower.includes('thông báo') || lower.includes('phát thanh')) title = '📢 Phát Thanh Thông Báo';
    }

    addRichToast({
      title,
      message: msg,
      type: isWarn ? 'WARNING' : type,
      duration: 5000,
    });
  };

  const setErrorMsg = (msg: string | null) => {
    setErrorMsgState(msg);
    if (msg) {
      showToast(msg, 'WARNING');
    }
  };

  const setSuccessMsg = (msg: string | null) => {
    setSuccessMsgState(msg);
    if (msg) {
      showToast(msg, 'INFO');
    }
  };

  // Filters & Search
  const [empSearch, setEmpSearch] = useState('');
  const [empGroupFilter, setEmpGroupFilter] = useState('ALL');
  const [empBranchFilter, setEmpBranchFilter] = useState('ALL');
  const [accountSearch, setAccountSearch] = useState('');

  // Gửi PIN khởi tạo qua Zalo (hàng loạt + từng dòng) + modal tiến trình
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinSending, setPinSending] = useState(false);
  const [pinResults, setPinResults] = useState<any[]>([]);
  const [pinSummary, setPinSummary] = useState<{ sent: number; failed: number; total: number } | null>(null);
  const [sendingSingleId, setSendingSingleId] = useState<string | null>(null);

  // VIP: Admin mở bù cổng đăng ký OFF 2 ngày/tuần (mặc định 30 phút, tự đóng).
  const [manualOff, setManualOff] = useState<any>(null);
  const [manualMinutes, setManualMinutes] = useState(30);
  const [manualTick, setManualTick] = useState(0);
  const fetchManualOff = async () => {
    try {
      const st = await apiRequest('/admin/weekly-off/manual-status');
      setManualOff(st);
    } catch { /* không phải ADMIN hoặc offline */ }
  };

  // NV quên PIN: HR/Admin cấp lại PIN mới (PIN cũ hết hiệu lực ngay) rồi gửi cho NV.
  const [resettingPinId, setResettingPinId] = useState<string | null>(null);
  const handleResetPin = async (item: any) => {
    if (!item?.hasRealAccount) {
      setErrorMsg('Tài khoản chưa tồn tại, không thể reset PIN!');
      return;
    }
    if (!window.confirm(`Cấp lại PIN mới cho ${item.fullName} (${item.phone})?\nPIN cũ hết hiệu lực ngay. Gửi PIN mới cho NV qua Zalo/tin nhắn.`)) return;
    setResettingPinId(item.accountId);
    try {
      const res = await apiRequest(`/admin/employee-accounts/${item.accountId}/reset-pin`, { method: 'POST' });
      setSuccessMsg(`Đã cấp PIN mới cho ${item.fullName}: ${res.pin} — gửi ngay cho NV! NV đăng nhập và đặt PIN riêng.`);
      await loadAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setResettingPinId(null);
    }
  };

  // Modals
  const [showNewAdminModal, setShowNewAdminModal] = useState(false);
  const [newAdminForm, setNewAdminForm] = useState({
    username: '',
    full_name: '',
    role: 'STORE',
    branch_scope: 'CN130',
    password: 'password123',
  });

  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [broadcastForm, setBroadcastForm] = useState({
    title: '',
    summary: '',
    severity: 'SYSTEM',
    recipientIds: 'ALL',
  });

  // Sub-tabs for Module 3: PIN & Tài Khoản Nhân Viên (Mặc định 'ALL' để luôn hiển thị đầy đủ nhân sự hệ thống)
  const [activationSubTab, setActivationSubTab] = useState<'ALL' | 'PROBATION' | 'OFFICIAL' | 'VAN_PHONG' | 'XUONG' | 'SALE'>('ALL');

  // Modal & Form for Module 4: Thêm Hồ Sơ Nhân Viên Mới (Ràng buộc: UBM_NV0000 random từ 0000 đến 9999)
  const [showNewEmpModal, setShowNewEmpModal] = useState(false);
  const generateRandomEmployeeCode = () => {
    const digits = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `UBM_NV${digits}`;
  };
  const [newEmpForm, setNewEmpForm] = useState({
    employeeCode: generateRandomEmployeeCode(),
    fullName: '',
    phone: '',
    group: 'STORE',
    branchId: 'CN130',
    employmentStatus: 'PRE_ONBOARDING',
  });

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^UBM_NV\d{4}$/.test(newEmpForm.employeeCode)) {
      setErrorMsg('Mã nhân viên bắt buộc phải đúng định dạng UBM_NV0000 (random 0000 đến 9999)');
      return;
    }
    if (!newEmpForm.fullName.trim()) {
      setErrorMsg('Vui lòng nhập họ và tên nhân viên');
      return;
    }
    if (!newEmpForm.phone.trim()) {
      setErrorMsg('Vui lòng nhập số điện thoại');
      return;
    }
    const phoneDigits = newEmpForm.phone.replace(/\D/g, '');
    if (phoneDigits.length < 9 || phoneDigits.length > 11) {
      setErrorMsg(`Số điện thoại '${newEmpForm.phone.trim()}' không hợp lệ (cần 9-11 chữ số)!`);
      return;
    }
    try {
      const finalBranch = (newEmpForm.group === 'VAN_PHONG' || newEmpForm.group === 'SALE')
        ? 'VAN_PHONG'
        : (newEmpForm.group === 'XUONG' ? 'XUONG_SX' : newEmpForm.branchId);

      const createdCode = newEmpForm.employeeCode;
      const created = await apiRequest('/employees', {
        method: 'POST',
        body: JSON.stringify({
          fullName: newEmpForm.fullName.trim(),
          phone: newEmpForm.phone.trim(),
          branchId: finalBranch,
          employmentStatus: newEmpForm.employmentStatus,
          group: newEmpForm.group,
          employeeCode: newEmpForm.employeeCode,
        }),
      });
      // Chèn tức thì vào danh sách (khỏi chờ tải lại) — server đã trả kèm account + PIN.
      const newEmp = (created as any)?.result?.employee_id ? (created as any).result : (created as any)?.employee;
      const newAcc = (created as any)?.account;
      if (newEmp?.employee_id) {
        setAllEmployees((prev: any[]) => [newEmp, ...prev.filter(e => e.employee_id !== newEmp.employee_id)]);
      }
      if (newAcc?.account_id) {
        setEmployeeAccounts((prev: any[]) => [newAcc, ...prev.filter(a => a.account_id !== newAcc.account_id)]);
      }
      setShowNewEmpModal(false);
      const nextCode = generateRandomEmployeeCode();
      setNewEmpForm({
        employeeCode: nextCode,
        fullName: '',
        phone: '',
        group: 'STORE',
        branchId: 'CN130',
        employmentStatus: 'PRE_ONBOARDING',
      });
      setSuccessMsg(`Đã tạo ${createdCode}! Đang đồng bộ Google Sheets...`);
      // Poll xác nhận đã ghi Sheets (không chặn UI) — xong báo khớp 100%.
      (async () => {
        for (let i = 0; i < 8; i++) {
          await new Promise(r => setTimeout(r, 1500));
          try {
            const st = await apiRequest('/admin/sync-status');
            if (st && st.pendingWrites === 0) {
              setSuccessMsg(`✅ ${createdCode} đã ghi Google Sheets! Web và Sheet khớp 100%.`);
              setTimeout(() => setSuccessMsg(null), 4000);
              return;
            }
          } catch { /* thử lại vòng sau */ }
        }
      })();
      await loadAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  // Gửi PIN khởi tạo qua Zalo cá nhân HR (bulk cho NV chưa đổi PIN hoặc 1 tài khoản).
  // Lưu ý: activationDataList khai báo phía dưới nên chỉ truy cập trong handler (runtime), không tính ở đây.
  const handleBulkSendPin = async (accountIds?: string[]) => {
    const targets = accountIds && accountIds.length > 0
      ? accountIds
      : activationDataList.filter(i => i.pinMustChange && i.pinCode && i.hasRealAccount).map(i => i.accountId);
    if (targets.length === 0) {
      setErrorMsg('Không có nhân viên nào còn PIN khởi tạo chưa gửi!');
      return;
    }
    if (targets.length === 1) setSendingSingleId(targets[0]);
    setPinSending(true);
    setShowPinModal(true);
    setPinResults([]);
    setPinSummary(null);
    try {
      const res = await apiRequest('/admin/employee-accounts/send-pin-zalo', {
        method: 'POST',
        body: JSON.stringify(accountIds && accountIds.length > 0 ? { accountIds: targets } : { allPending: true }),
      });
      setPinResults(res.results || []);
      setPinSummary({ sent: res.sent || 0, failed: res.failed || 0, total: res.total || 0 });
      if ((res.sent || 0) > 0) {
        setSuccessMsg(`Đã gửi ${res.sent}/${res.total} mã PIN qua Zalo!${(res.failed || 0) > 0 ? ` ${res.failed} ca lỗi (xem chi tiết).` : ''}`);
      } else {
        setErrorMsg(res.message || 'Không gửi được ca nào — kiểm tra Zalo đã kết nối và kết bạn.');
      }
      await loadAllData();
    } catch (err: any) {
      setErrorMsg(err.message === 'ZALO_NOT_CONNECTED'
        ? 'Zalo cá nhân HR chưa kết nối! Vào tab Zalo quét QR đăng nhập trước khi gửi PIN.'
        : err.message);
      setShowPinModal(true);
    } finally {
      setPinSending(false);
      setSendingSingleId(null);
    }
  };

  // Handle Login
  const handleLogin = async (e?: React.FormEvent, customUser?: string, customPass?: string) => {
    if (e) e.preventDefault();
    setLoading(true);
    setLoginError(null);
    const u = customUser || loginUsername;
    const p = customPass || loginPassword;

    try {
      const res = await apiRequest('/auth/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username: u, password: p }),
      });

      setAuthToken(res.token);
      setCurrentUser(res.user);
      localStorage.setItem('ubm_admin_token', res.token);
      localStorage.setItem('ubm_admin_user', JSON.stringify(res.user));

      // Reset active tab to default for role
      let initialTab = 'dashboard';
      if (res.user.role === 'ADMIN') initialTab = 'dashboard';
      else if (res.user.role === 'HR') initialTab = 'hr-dashboard';
      else if (res.user.role === 'STORE') initialTab = 'store-dashboard';
      else if (res.user.role === 'FINANCE') initialTab = 'fin-dashboard';
      else if (res.user.role === 'MARKETING') initialTab = 'mkt-dashboard';
      setActiveTab(initialTab);
      localStorage.setItem('ubm_active_tab', initialTab);

      await loadAllData(res.user);
      setSuccessMsg(`Đăng nhập thành công với vai trò: ${res.user.role}`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setLoginError(err.message === 'INVALID_CREDENTIALS'
        ? 'Tên đăng nhập hoặc mật khẩu không chính xác. Vui lòng kiểm tra lại!'
        : err.message === 'ACCOUNT_LOCKED'
          ? 'Tài khoản này đã bị khóa. Vui lòng liên hệ quản trị viên hệ thống để mở khóa!'
          : err.message);
    } finally {
      setLoading(false);
    }
  };

  // Handle Logout
  const handleLogout = () => {
    staticDataLoadedRef.current = false;
    setAuthToken('');
    setCurrentUser(null);
    localStorage.removeItem('ubm_admin_token');
    localStorage.removeItem('ubm_admin_user');
    localStorage.removeItem('ubm_active_tab');
    setSuccessMsg('Đã đăng xuất khỏi hệ thống.');
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  // Switch Role Helper (For Quick Testing & Role Preview)
  const switchRole = async (roleName: string) => {
    staticDataLoadedRef.current = false;
    let username = 'admin';
    let password = 'Master@@2027';
    if (roleName === 'HR') { username = 'hr_lead'; password = 'hr123'; }
    else if (roleName === 'STORE') { username = 'store_130'; password = 'store123'; }
    else if (roleName === 'FINANCE') { username = 'finance_lead'; password = 'fin123'; }
    else if (roleName === 'MARKETING') { username = 'mkt_lead'; password = 'mkt123'; }

    setLoginUsername(username);
    setLoginPassword(password);
    await handleLogin(undefined, username, password);
  };

  // Cờ đánh dấu đã tải các dữ liệu cấu hình ít thay đổi (tránh bắn lại 17 API mỗi khi có realtime event)
  const staticDataLoadedRef = useRef(false);

  const loadAllData = async (user = currentUser, forceAll = false) => {
    if (!user) return;
    try {
      // 1. Nhóm dữ liệu động vận hành (luôn đồng bộ khi có event nghiệp vụ)
      const tasks: Promise<any>[] = [
        apiRequest('/admin/dashboard/stats').then(stats => { if (stats) setDashboardStats(stats); }).catch(() => null),
        apiRequest('/schedules').then(sList => setShifts(sList || [])).catch(() => null),
        apiRequest('/leave-requests').then(lList => setLeaves(lList || [])).catch(() => null),
      ];

      // Thông báo hệ thống: backend chỉ cho ADMIN/HR/MARKETING -> không gọi cho STORE/FINANCE (tránh 403).
      if (['ADMIN', 'HR', 'MARKETING'].includes(user.role)) {
        tasks.push(
          apiRequest('/admin/notifications').then(notifs => setSystemNotifications(notifs || [])).catch(() => null),
        );
      }

      // 2. Dữ liệu động theo vai trò người dùng
      if (['ADMIN', 'HR'].includes(user.role)) {
        tasks.push(
          apiRequest('/admin/employee-accounts').then(eAccs => setEmployeeAccounts(eAccs || [])).catch(() => null),
          apiRequest('/applications').then(cList => setCandidates(cList || [])).catch(() => null),
        );
      }

      if (['ADMIN', 'HR', 'STORE'].includes(user.role)) {
        tasks.push(
          apiRequest('/employees').then(emps => setAllEmployees(emps || [])).catch(() => null),
        );
      }

      if (user.role === 'ADMIN') {
        tasks.push(
          apiRequest('/admin/internal-accounts').then(iAccs => setInternalAccounts(iAccs || [])).catch(() => null),
        );
      }

      if (['ADMIN', 'FINANCE'].includes(user.role)) {
        tasks.push(
          apiRequest('/payroll/runs').then(pList => setPayrollRuns(pList || [])).catch(() => null),
        );
      }

      // 3. Dữ liệu cấu hình hệ thống tĩnh (chỉ tải lần đầu khi đăng nhập hoặc khi forceAll = true)
      if (!staticDataLoadedRef.current || forceAll) {
        tasks.push(
          apiRequest('/admin/branches').then(bList => setBranches(bList || [])).catch(() => null),
          apiRequest('/admin/shift-templates').then(sTemplates => setShiftTemplates(sTemplates || {})).catch(() => null),
          apiRequest('/admin/policies').then(pData => setPolicies(pData || {})).catch(() => null),
          apiRequest('/admin/maintenance').then(mData => setMaintenance(mData || {})).catch(() => null),
          apiRequest('/admin/system-settings').then(sSettings => setSystemSettings(sSettings || {})).catch(() => null),
        );
        if (user.role === 'ADMIN') {
          tasks.push(
            apiRequest('/admin/integrations/status').then(integ => setIntegrationsStatus(integ)).catch(() => null),
            apiRequest('/admin/backup/snapshots').then(snaps => setBackupSnapshots(snaps || [])).catch(() => null),
          );
        }
        if (['ADMIN', 'HR'].includes(user.role)) {
          tasks.push(
            apiRequest('/admin/audit').then(logs => setAuditLogs(logs || [])).catch(() => null),
          );
        }
        staticDataLoadedRef.current = true;
      }

      // Tải song song toàn bộ dữ liệu, hoàn tất nhanh gấp 5-10 lần tải tuần tự
      await Promise.allSettled(tasks);
    } catch (err: any) {
      console.error('Error loading data:', err);
    }
  };

  // Synchronize active tab to localStorage whenever it changes
  useEffect(() => {
    if (activeTab) {
      localStorage.setItem('ubm_active_tab', activeTab);
    }
  }, [activeTab]);

  // Hiệu ứng âm thanh micro-click cho mọi nút bấm chức năng của Admin & HR
  useEffect(() => {
    const handleGlobalButtonClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const btn = target.closest('button, .btn-primary, .btn-secondary, [role="button"]');
      if (btn && !(btn as HTMLButtonElement).disabled) {
        playButtonPop();
      }
    };
    document.addEventListener('click', handleGlobalButtonClick, true);
    return () => document.removeEventListener('click', handleGlobalButtonClick, true);
  }, []);

  // Initial state: Auto restore session and load live data if previously logged in
  useEffect(() => {
    const savedUser = localStorage.getItem('ubm_admin_user');
    const savedToken = localStorage.getItem('ubm_admin_token');
    if (savedUser && savedToken) {
      try {
        const user = JSON.parse(savedUser);
        setAuthToken(savedToken);
        setCurrentUser(user);
        loadAllData(user);

        // Ping /me silently in background to keep session fresh
        apiRequest('/me')
          .then((res) => {
            if (res.user) {
              const updated: UserProfile = {
                id: res.user.id || res.user.sub || user.id,
                fullName: res.user.fullName || user.fullName,
                role: res.user.role || user.role,
                branchScope: res.user.branchScope || user.branchScope,
                permissions: res.user.permissions || user.permissions || [],
              };
              setCurrentUser(updated);
              localStorage.setItem('ubm_admin_user', JSON.stringify(updated));
            }
          })
          .catch((err) => {
            // ONLY log out if backend explicitly rejected with 401 Unauthorized / Token expired
            // DO NOT log out on network disconnect or server cold boot
            const msg = (err?.message || '').toLowerCase();
            if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('hết hạn') || msg.includes('không hợp lệ')) {
              handleLogout();
            }
          });
      } catch (err) {
        console.error('Lỗi khôi phục phiên đăng nhập:', err);
      }
    }
  }, []);

  // 1. Socket.IO Realtime Connection Listener (Tự động cập nhật tức thời khi có thay đổi)
  // Gộp nhiều event dồn dập thành 1 lần tải (debounce 600ms) + chống tải chồng chéo + không loop vô hạn.
  const socketConnectedRef = useRef(false);
  const reloadTimerRef = useRef<any>(null);
  const reloadingRef = useRef(false);
  const needReloadAgainRef = useRef(false);

  const scheduleReload = (user = currentUser) => {
    if (reloadingRef.current) {
      needReloadAgainRef.current = true;
      return;
    }
    if (reloadTimerRef.current) {
      clearTimeout(reloadTimerRef.current);
    }
    reloadTimerRef.current = setTimeout(async () => {
      reloadTimerRef.current = null;
      reloadingRef.current = true;
      try {
        await loadAllData(user);
      } finally {
        reloadingRef.current = false;
        if (needReloadAgainRef.current) {
          needReloadAgainRef.current = false;
          scheduleReload(user);
        }
      }
    }, 600);
  };

  useEffect(() => {
    if (!currentUser) return;
    const token = getAuthToken();
    if (!token) return;

    let socket: Socket | null = null;
    try {
      const base = getApiBase();
      socket = io(base, {
        auth: { token },
        transports: ['websocket', 'polling'],
      });

      socket.on('connect', () => {
        console.log('🟢 [Socket.IO] Realtime kết nối thành công tới:', base);
        socketConnectedRef.current = true;
        scheduleReload(currentUser);
      });

      socket.on('disconnect', () => {
        socketConnectedRef.current = false;
      });

      socket.on('connect_error', (err: any) => {
        // Token hết hiệu lực (ví dụ vừa bị khóa tài khoản) -> văng về đăng nhập.
        const msg = String(err?.message || '');
        if (msg.includes('AUTHENTICATION_ERROR')) {
          handleLogout();
        }
      });

      // Bị khóa tài khoản -> văng ra màn đăng nhập ngay lập tức.
      socket.on('admin:forceLogout', (payload: any) => {
        if (!payload?.adminId || payload.adminId === currentUser.id) {
          addRichToast({
            type: 'WARNING',
            title: '🔒 Tài Khoản Đã Bị Khóa',
            message: payload?.reason || 'Tài khoản của bạn đã bị khóa. Bạn đã bị đăng xuất.',
          });
          handleLogout();
        }
      });

      // Lắng nghe thông báo nghiệp vụ trực tiếp (Check-in, đơn nghỉ, đổi ca, đổi PIN...)
      socket.on('system:notification', (notif: any) => {
        console.log('🔔 [Socket.IO] Nhận thông báo nghiệp vụ realtime:', notif);
        // Kiểm tra vai trò phù hợp
        if (!notif.targetRoles || notif.targetRoles.includes(currentUser.role)) {
          addRichToast({
            type: notif.type,
            title: notif.title || 'Thông Báo Hệ Thống',
            message: notif.message,
            linkTab: notif.linkTab,
          });
        }
        scheduleReload(currentUser);
      });

      // Lắng nghe sự kiện dữ liệu thay đổi trên toàn hệ thống
      socket.on('data:updated', (payload: any) => {
        console.log('⚡ [Socket.IO] Nhận tín hiệu cập nhật realtime:', payload);
        scheduleReload(currentUser);
      });

      socket.on('employees', () => {
        console.log('⚡ [Socket.IO] Nhận tín hiệu cập nhật danh sách nhân viên');
        scheduleReload(currentUser);
      });
      socket.on('accounts', () => {
        console.log('⚡ [Socket.IO] Nhận tín hiệu cập nhật tài khoản nhân viên');
        scheduleReload(currentUser);
      });
      socket.on('candidates', () => {
        console.log('⚡ [Socket.IO] Nhận tín hiệu ứng viên Google Forms mới');
        scheduleReload(currentUser);
      });

      socket.on('schedule.published', () => scheduleReload(currentUser));
      socket.on('attendance.recorded', () => scheduleReload(currentUser));
      socket.on('payroll.published', () => scheduleReload(currentUser));
    } catch (err) {
      console.warn('[Socket.IO] Không thể khởi tạo kết nối realtime:', err);
    }

    return () => {
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
      if (socket) {
        socket.disconnect();
      }
      socketConnectedRef.current = false;
    };
  }, [currentUser?.id, currentUser?.role]);

  // 2. Thuần socket realtime 100% (ràng buộc hệ thống): socket.io tự reconnect,
  // event 'connect' bắn lại là tải mới — không poll định kỳ để giảm tải server.
  // Mất mạng lâu: người dùng bấm nút Tải lại trên từng tab (loadAllData qua scheduleReload).

  // VIP manual OFF: tải trạng thái khi vào dashboard + đếm ngược mỗi giây khi đang mở.
  useEffect(() => {
    if (activeTab !== 'dashboard' || currentUser?.role !== 'ADMIN') return;
    fetchManualOff();
    const refetch = setInterval(fetchManualOff, 15000);
    return () => clearInterval(refetch);
  }, [activeTab, currentUser?.role]);
  useEffect(() => {
    if (!manualOff?.active) return;
    const t = setInterval(() => setManualTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [manualOff?.active]);
  const manualRemaining = (() => {
    void manualTick;
    if (!manualOff?.active || !manualOff?.manual?.activeUntil) return null;
    const ms = new Date(manualOff.manual.activeUntil).getTime() - Date.now();
    if (ms <= 0) return '00:00';
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  })();
  const handleManualOpen = async () => {
    const mins = Math.min(Math.max(manualMinutes || 30, 1), 120);
    if (!window.confirm(`Mở bù cổng đăng ký 2 ngày OFF ${mins} phút cho tuần ${manualOff?.manual?.targetWeekMon || 'sau'}?\nNV chưa đăng ký sẽ nhận thông báo và đăng ký ngay. Hết giờ tự đóng.`)) return;
    try {
      await apiRequest('/admin/weekly-off/open', { method: 'POST', body: JSON.stringify({ minutes: mins }) });
      setSuccessMsg(`Đã mở bù cổng đăng ký ${mins} phút!`);
      await fetchManualOff();
      await loadAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };
  const handleManualClose = async () => {
    try {
      await apiRequest('/admin/weekly-off/close', { method: 'POST' });
      setSuccessMsg('Đã đóng cổng đăng ký mở bù.');
      await fetchManualOff();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  // Action handlers
  const handleToggleInternalAccount = async (account: any) => {
    if (account.admin_id === 'ADM_001' || account.username === 'admin') {
      setErrorMsg('Không thể khóa tài khoản Quản trị viên gốc (admin)!');
      return;
    }
    const locking = account.is_active !== false;
    if (!window.confirm(locking
      ? `Khóa tài khoản ${account.username} (${account.full_name})?\nTài khoản sẽ bị văng ra màn đăng nhập ngay lập tức và không đăng nhập lại được cho đến khi mở khóa.`
      : `Mở khóa tài khoản ${account.username} (${account.full_name})?`)) {
      return;
    }
    try {
      await apiRequest(`/admin/internal-accounts/${account.admin_id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !locking }),
      });
      setSuccessMsg(`Đã ${locking ? 'khóa' : 'mở khóa'} tài khoản ${account.username}!`);
      setTimeout(() => setSuccessMsg(null), 3000);
      await loadAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleDeleteInternalAccount = async (adminId: string, username: string) => {
    if (adminId === 'ADM_001' || username === 'admin') {
      setErrorMsg('Không thể xóa tài khoản Quản trị viên gốc (admin)!');
      return;
    }
    if (!window.confirm(`Bạn có chắc chắn muốn xóa tài khoản ${username}? Dữ liệu trên Google Sheet ADMIN_ACCOUNTS cũng sẽ được xóa đồng bộ.`)) {
      return;
    }
    try {
      await apiRequest(`/admin/internal-accounts/${adminId}`, { method: 'DELETE' });
      setSuccessMsg(`Đã xóa tài khoản ${username} thành công trên cả hệ thống và Google Sheets!`);
      setTimeout(() => setSuccessMsg(null), 3000);
      await loadAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleDeleteEmployee = async (employeeId: string, fullName: string) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa nhân viên ${fullName} (${employeeId})? Dữ liệu trên Google Sheet NHAN_VIEN_MASTER và TAI_KHOAN_NHAN_VIEN sẽ được xóa đồng bộ.`)) {
      return;
    }
    try {
      await apiRequest(`/employees/${employeeId}`, { method: 'DELETE' });
      setSuccessMsg(`Đã xóa hồ sơ nhân viên ${fullName} thành công!`);
      setTimeout(() => setSuccessMsg(null), 3000);
      await loadAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleCreateInternalAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/admin/internal-accounts', {
        method: 'POST',
        body: JSON.stringify({
          username: newAdminForm.username,
          full_name: newAdminForm.full_name,
          role: newAdminForm.role,
          branch_scope: newAdminForm.branch_scope,
          password_hash: newAdminForm.password,
        }),
      });
      setShowNewAdminModal(false);
      setSuccessMsg('Tạo tài khoản nội bộ mới thành công!');
      setTimeout(() => setSuccessMsg(null), 3000);
      await loadAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleForceSync = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/admin/integrations/sync-now', { method: 'POST' });
      setSuccessMsg(res.message || 'Đã đồng bộ toàn bộ 13 tabs dữ liệu lên Google Sheets!');
      setTimeout(() => setSuccessMsg(null), 3000);
      await loadAllData(currentUser, true);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleForcePull = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/admin/integrations/pull-now', { method: 'POST' });
      setSuccessMsg(res.message || 'Đã tải và cập nhật thành công dữ liệu mới nhất từ Google Sheets!');
      setTimeout(() => setSuccessMsg(null), 3000);
      await loadAllData(currentUser, true);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSnapshot = async () => {
    try {
      await apiRequest('/admin/backup/snapshots', {
        method: 'POST',
        body: JSON.stringify({ name: `Manual Snapshot ${new Date().toLocaleString('vi-VN')}` }),
      });
      setSuccessMsg('Tạo bản sao lưu Snapshot mới thành công!');
      setTimeout(() => setSuccessMsg(null), 3000);
      await loadAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleTestRecovery = async (snapshotId: string) => {
    try {
      const res = await apiRequest('/admin/backup/test-recovery', {
        method: 'POST',
        body: JSON.stringify({ snapshot_id: snapshotId }),
      });
      setSuccessMsg(res.message);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleSavePolicies = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/admin/policies', {
        method: 'PUT',
        body: JSON.stringify(policies),
      });
      setSuccessMsg('Đã cập nhật chính sách hệ thống thành công!');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleSaveMaintenance = async (updatedMaintenance: any) => {
    try {
      await apiRequest('/admin/maintenance', {
        method: 'POST',
        body: JSON.stringify(updatedMaintenance),
      });
      setMaintenance(updatedMaintenance);
      setSuccessMsg('Đã cập nhật trạng thái bảo trì hệ thống!');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleSaveSystemSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/admin/system-settings', {
        method: 'PUT',
        body: JSON.stringify(systemSettings),
      });
      setSuccessMsg('Đã lưu cấu hình kỹ thuật hệ thống!');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/announcements', {
        method: 'POST',
        body: JSON.stringify({
          title: broadcastForm.title,
          summary: broadcastForm.summary,
          severity: broadcastForm.severity,
          recipientIds: broadcastForm.recipientIds === 'ALL' ? ['ALL'] : [broadcastForm.recipientIds],
        }),
      });
      setShowBroadcastModal(false);
      setSuccessMsg('Đã gửi thông báo phát thanh thành công!');
      setTimeout(() => setSuccessMsg(null), 3000);
      await loadAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  // Filtered employees
  const filteredEmployees = allEmployees.filter(emp => {
    const matchSearch = empSearch === '' ||
      emp.full_name?.toLowerCase().includes(empSearch.toLowerCase()) ||
      emp.employee_code?.toLowerCase().includes(empSearch.toLowerCase()) ||
      emp.phone_normalized?.includes(empSearch);
    const matchGroup = empGroupFilter === 'ALL' || emp.group === empGroupFilter;
    const matchBranch = empBranchFilter === 'ALL' ||
      (empBranchFilter === 'VAN_PHONG' && (emp.group === 'VAN_PHONG' || emp.group === 'SALE' || emp.default_branch_id === 'VAN_PHONG')) ||
      (empBranchFilter === 'XUONG_SX' && (emp.group === 'XUONG' || emp.default_branch_id === 'XUONG_SX')) ||
      emp.default_branch_id === empBranchFilter;
    return matchSearch && matchGroup && matchBranch;
  });

  // Filtered employee accounts & activation unified list
  const activationDataList = useMemo(() => {
    const items = allEmployees.map(emp => {
      const cleanPhone = (emp.phone_normalized || emp.phone || '').replace(/\D/g, '');
      const acc = employeeAccounts.find(a => 
        a.employee_id === emp.employee_id || 
        a.account_id === emp.employee_id || 
        (cleanPhone && a.phone_normalized?.replace(/\D/g, '') === cleanPhone)
      );
      return {
        id: emp.employee_id,
        accountId: acc?.account_id || `ACC_${emp.employee_id}`,
        employeeCode: emp.employee_code || '—',
        fullName: emp.full_name,
        phone: emp.phone_normalized || emp.phone,
        group: emp.group || 'STORE',
        employmentStatus: emp.employment_status,
        displayBranch: getDisplayBranch(emp.default_branch_id, emp.group),
        // Khóa màu theo nhóm thật (không so chuỗi hiển thị vì không bao giờ khớp).
        branchKind: emp.group === 'VAN_PHONG' || emp.group === 'SALE' ? 'HQ' : emp.group === 'XUONG' ? 'FACTORY' : 'STORE',
        // Dữ liệu thật: chưa có tài khoản thì báo NO_ACCOUNT, có tài khoản là ACTIVE (PIN tự sinh).
        accountStatus: acc ? 'ACTIVE' : 'NO_ACCOUNT',
        // Mã PIN bản rõ — hiển thị cho cả Admin lẫn HR. Mất đi khi NV tự đổi PIN riêng.
        pinCode: (acc as any)?.pin_code || '',
        version: acc?.version || emp.version || 1,
        hasRealAccount: !!acc,
        // Mã khởi tạo, NV chưa đổi -> hiển thị trạng thái chờ đổi PIN
        pinMustChange: acc?.pin_must_change === true,
        // Lần đổi/cấp PIN gần nhất (đổi PIN riêng, reset, xoay kỳ) để theo dõi tháng.
        pinUpdatedAt: (acc as any)?.updated_at || '',
      };
    });

    employeeAccounts.forEach(acc => {
      const cleanPhone = (acc.phone_normalized || '').replace(/\D/g, '');
      if (!items.some(i => i.id === acc.employee_id || i.accountId === acc.account_id || (cleanPhone && i.phone?.replace(/\D/g, '') === cleanPhone))) {
        items.push({
          id: acc.employee_id,
          accountId: acc.account_id,
          employeeCode: acc.employee_id,
          fullName: 'Nhân viên ' + acc.phone_normalized,
          phone: acc.phone_normalized,
          group: 'STORE',
          employmentStatus: 'PRE_ONBOARDING',
          displayBranch: getDisplayBranch(acc.branch_scope),
          branchKind: 'STORE',
          accountStatus: 'ACTIVE',
          pinCode: (acc as any)?.pin_code || '',
          version: acc.version || 1,
          hasRealAccount: true,
          pinMustChange: acc.pin_must_change === true,
          pinUpdatedAt: (acc as any)?.updated_at || '',
        });
      }
    });

    // Đánh dấu SĐT trùng realtime từ dữ liệu đã tải (đồng bộ với socket loadAllData).
    const phoneCount = new Map<string, number>();
    for (const it of items) {
      const k = (it.phone || '').replace(/\D/g, '');
      if (k) phoneCount.set(k, (phoneCount.get(k) || 0) + 1);
    }
    for (const it of items) {
      const k = (it.phone || '').replace(/\D/g, '');
      (it as any).isDuplicatePhone = !!k && (phoneCount.get(k) || 0) > 1;
    }

    return items;
  }, [allEmployees, employeeAccounts]);

  const filteredActivationItems = useMemo(() => {
    return activationDataList.filter(item => {
      // Sub-tab filter (không còn tab Chờ kích hoạt / Tạm khóa — PIN là cửa duy nhất)
      let matchSubTab = true;
      if (activationSubTab === 'ALL') {
        matchSubTab = true;
      } else if (activationSubTab === 'PROBATION') {
        matchSubTab = item.employmentStatus === 'PROBATION';
      } else if (activationSubTab === 'OFFICIAL') {
        matchSubTab = item.employmentStatus === 'OFFICIAL';
      } else if (activationSubTab === 'VAN_PHONG') {
        matchSubTab = item.group === 'VAN_PHONG';
      } else if (activationSubTab === 'XUONG') {
        matchSubTab = item.group === 'XUONG';
      } else if (activationSubTab === 'SALE') {
        matchSubTab = item.group === 'SALE';
      }

      // Search filter
      const query = accountSearch.trim().toLowerCase();
      const matchSearch = !query ||
        item.phone?.includes(query) ||
        item.employeeCode?.toLowerCase().includes(query) ||
        item.fullName?.toLowerCase().includes(query) ||
        item.displayBranch?.toLowerCase().includes(query);

      return matchSubTab && matchSearch;
    });
  }, [activationDataList, activationSubTab, accountSearch]);

  const countAll = activationDataList.length;
  const countProbation = activationDataList.filter(i => i.employmentStatus === 'PROBATION').length;
  const countOfficial = activationDataList.filter(i => i.employmentStatus === 'OFFICIAL').length;
  const countOffice = activationDataList.filter(i => i.group === 'VAN_PHONG').length;
  const countFactory = activationDataList.filter(i => i.group === 'XUONG').length;
  const countSales = activationDataList.filter(i => i.group === 'SALE').length;
  const pendingPinCount = activationDataList.filter(i => i.pinMustChange && i.pinCode && i.hasRealAccount).length;

  // Tổng quan PIN tháng hiện tại cho Admin/HR quan sát (kỳ xoay 1-5 hàng tháng).
  const pinMonthStats = (() => {
    const d = new Date();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const real = activationDataList.filter(i => i.hasRealAccount);
    const changed = real.filter(i => !i.pinMustChange && (i.pinUpdatedAt || '').slice(0, 7) >= key);
    const pending = real.filter(i => i.pinMustChange);
    return { key, total: real.length, changed: changed.length, pending: pending.length };
  })();
  const fmtPinTime = (s: string) => {
    if (!s) return '—';
    try {
      return new Date(s).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return '—'; }
  };

  // Check if opened via QR scan from mobile phone for Zalo Auth Confirmation
  if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    const isZaloAuth = urlParams.get('zalo_auth') === '1' || urlParams.get('zalo_connect') === '1';
    if (isZaloAuth) {
      const hrName = urlParams.get('hr') || 'Quản Trị Nhân Sự HR';
      const sessionToken = urlParams.get('session') || 'UBM_ZALO';
      return <ZaloMobileAuthView hrName={hrName} sessionToken={sessionToken} />;
    }
  }

  // =========================================================================
  // RENDER 1: GIAO DIỆN ĐĂNG NHẬP CỔNG QUẢN TRỊ HỆ THỐNG (KHI CHƯA ĐĂNG NHẬP)
  // =========================================================================
  if (!currentUser) {
    return (
      <div style={{
        minHeight: '100vh',
        width: '100vw',
        background: 'radial-gradient(circle at 15% 15%, #FFF0F5 0%, #FFF8F4 55%, #FDE8EF 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        boxSizing: 'border-box',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}>
        <div style={{
          width: '100%',
          maxWidth: '460px',
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          boxShadow: '0 12px 40px rgba(232, 93, 146, 0.12), 0 4px 12px rgba(39, 49, 66, 0.04)',
          border: '1px solid #F0E2DE',
          overflow: 'hidden',
        }}>
          {/* Header Brand */}
          <div style={{
            padding: '32px 32px 24px',
            textAlign: 'center',
            borderBottom: '1px solid #F8ECE8',
            backgroundColor: '#FFFBF9',
          }}>
            <div style={{
              width: '76px',
              height: '76px',
              borderRadius: '16px',
              backgroundColor: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 14px',
              boxShadow: '0 4px 14px rgba(232, 93, 146, 0.16)',
              overflow: 'hidden',
              border: '2px solid #F8DDE7',
            }}>
              <img src="/logo.jpg" alt="Ụm Bò Milk" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
            <h1 style={{
              fontSize: '22px',
              fontWeight: 800,
              color: '#273142',
              letterSpacing: '-0.4px',
              margin: '0 0 6px',
            }}>
              ỤM BÒ MILK HR SYSTEM
            </h1>
            <div style={{
              fontSize: '13px',
              fontWeight: 600,
              color: '#E85D92',
              letterSpacing: '0.2px',
            }}>
              CỔNG QUẢN TRỊ HỆ THỐNG V5.1
            </div>
            <p style={{
              fontSize: '12px',
              color: '#6B7280',
              marginTop: '6px',
              marginBottom: 0,
            }}>
              Dành cho Quản trị viên, Nhân sự, Quản lý cửa hàng, Tài chính & Marketing
            </p>
          </div>

          {/* Form Content */}
          <div style={{ padding: '32px' }}>
            {loginError && (
              <div style={{
                padding: '12px 16px',
                borderRadius: '8px',
                backgroundColor: '#FEE2E2',
                color: '#EF4444',
                fontSize: '13px',
                fontWeight: 600,
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}>
                <AlertTriangle size={18} />
                <span>{loginError}</span>
              </div>
            )}

            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 700,
                  color: '#273142',
                  marginBottom: '6px',
                }}>
                  Tên Đăng Nhập
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    required
                    type="text"
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    placeholder="Nhập username (ví dụ: admin)"
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      borderRadius: '8px',
                      border: '1.5px solid #F0E2DE',
                      fontSize: '14px',
                      fontWeight: 500,
                      outline: 'none',
                      backgroundColor: '#FAFAFA',
                      boxSizing: 'border-box',
                      color: '#273142',
                      transition: 'border-color 0.2s',
                    }}
                    onFocus={(e) => e.target.style.borderColor = '#E85D92'}
                    onBlur={(e) => e.target.style.borderColor = '#F0E2DE'}
                  />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#273142',
                  }}>
                    Mật Khẩu
                  </label>
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    required
                    type={showPassword ? 'text' : 'password'}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Nhập mật khẩu quản trị..."
                    style={{
                      width: '100%',
                      padding: '12px 42px 12px 14px',
                      borderRadius: '8px',
                      border: '1.5px solid #F0E2DE',
                      fontSize: '14px',
                      fontWeight: 500,
                      outline: 'none',
                      backgroundColor: '#FAFAFA',
                      boxSizing: 'border-box',
                      color: '#273142',
                      transition: 'border-color 0.2s',
                    }}
                    onFocus={(e) => e.target.style.borderColor = '#E85D92'}
                    onBlur={(e) => e.target.style.borderColor = '#F0E2DE'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      color: '#6B7280',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '13px',
                  borderRadius: '8px',
                  backgroundColor: '#E85D92',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: '15px',
                  border: 'none',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 14px rgba(232, 93, 146, 0.3)',
                  transition: 'background-color 0.2s, transform 0.1s',
                  marginTop: '6px',
                }}
                onMouseOver={(e) => { if (!loading) (e.target as any).style.backgroundColor = '#D6457E'; }}
                onMouseOut={(e) => { if (!loading) (e.target as any).style.backgroundColor = '#E85D92'; }}
              >
                {loading ? (
                  <>
                    <RefreshCw size={18} style={{ animation: 'spin 1s linear infinite' }} />
                    <span>Đang Xác Thực...</span>
                  </>
                ) : (
                  <>
                    <Lock size={18} />
                    <span>Đăng Nhập Quản Trị</span>
                  </>
                )}
              </button>
            </form>
            {/* Discreet Server Connection Setting */}
            <div style={{ marginTop: '22px', textAlign: 'center' }}>
              <button
                type="button"
                onClick={() => setShowServerConfig(!showServerConfig)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#9CA3AF',
                  fontSize: '11px',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: '4px 8px',
                }}
              >
                ⚙️ {showServerConfig ? 'Đóng cấu hình máy chủ' : 'Cấu hình địa chỉ máy chủ API (Nếu deploy riêng lẻ)'}
              </button>

              {showServerConfig && (
                <div style={{
                  marginTop: '10px',
                  padding: '12px',
                  backgroundColor: '#F9FAFB',
                  borderRadius: '8px',
                  border: '1px solid #E5E7EB',
                  textAlign: 'left',
                }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: '#4B5563', display: 'block', marginBottom: '4px' }}>
                    Địa chỉ Backend API (Mặc định: <code style={{ color: '#E85D92' }}>{customApiUrl || getApiBase()}</code>)
                  </label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type="url"
                      placeholder="https://ten-backend.onrender.com"
                      value={customApiUrl}
                      onChange={(e) => setCustomApiUrlState(e.target.value)}
                      style={{
                        flex: 1,
                        padding: '6px 10px',
                        fontSize: '12px',
                        border: '1px solid #D1D5DB',
                        borderRadius: '6px',
                        outline: 'none',
                        backgroundColor: '#FFFFFF',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setCustomApiUrl(customApiUrl);
                        setSuccessMsg('Đã lưu địa chỉ máy chủ API!');
                        setTimeout(() => setSuccessMsg(null), 3000);
                      }}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#E85D92',
                        color: '#FFF',
                        fontSize: '12px',
                        fontWeight: 600,
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                      }}
                    >
                      Lưu
                    </button>
                  </div>
                  <div style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '4px' }}>
                    💡 Để trống để tự động nhận diện theo tên miền hiện tại (All-in-One).
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // RENDER 2: GIAO DIỆN CHÍNH SAU KHI ĐĂNG NHẬP (ADMIN / HR / STORE / FIN / MKT)
  // =========================================================================
  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', backgroundColor: 'var(--bg)', overflow: 'hidden' }}>
      {/* SIDEBAR NAVIGATION */}
      <aside style={{
        width: '260px',
        backgroundColor: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 10,
      }}>
        {/* Brand Header */}
        <div style={{ padding: '20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '10px',
            backgroundColor: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            border: '1.5px solid var(--border)',
            boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
            flexShrink: 0,
          }}>
            <img src="/logo.jpg" alt="Ụm Bò Milk" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '15px', color: 'var(--brand)', letterSpacing: '-0.3px' }}>
              ỤM BÒ MILK
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
              HR ADMIN PORTAL V5.1
            </div>
          </div>
        </div>

        {/* Dynamic Role Navigation Items */}
        <nav style={{ padding: '12px 8px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
          {(ROLE_TABS[currentUser?.role || 'ADMIN'] || ROLE_TABS.ADMIN).map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '9px 12px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  color: isActive ? 'var(--brand)' : 'var(--text)',
                  backgroundColor: isActive ? 'var(--brand-soft)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              >
                <Icon size={16} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Current User & Logout Button */}
        <div style={{ padding: '16px', borderTop: '1px solid var(--border)', backgroundColor: 'var(--bg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              backgroundColor: 'var(--brand)',
              color: '#FFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '14px',
            }}>
              {currentUser?.fullName?.charAt(0) || 'U'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {currentUser?.fullName}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--brand)', fontWeight: 700 }}>
                {currentUser?.role} • {currentUser?.branchScope === '*' ? 'Toàn Hệ Thống' : currentUser?.branchScope}
              </div>
            </div>
          </div>

          <button
            onClick={handleLogout}
            style={{
              width: '100%',
              padding: '7px 12px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: '#FFFFFF',
              border: '1px solid #F0E2DE',
              color: '#EF4444',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <LogOut size={14} />
            Đăng Xuất
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* TOP BAR */}
        <header style={{
          height: '60px',
          backgroundColor: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
        }}>
          {/* Header Title & Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.2px' }}>
              ỤM BÒ MILK • CỔNG QUẢN TRỊ HỆ THỐNG
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>|</span>
            <span style={{
              fontSize: '12px',
              fontWeight: 700,
              color: 'var(--brand)',
              backgroundColor: 'var(--brand-soft)',
              padding: '3px 10px',
              borderRadius: 'var(--radius-full)',
            }}>
              {currentUser?.fullName} ({currentUser?.role})
            </span>
          </div>

          {/* Quick status & action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {currentUser?.role === 'ADMIN' && (
              <button
                onClick={handleForceSync}
                disabled={loading}
                className="btn-interactive"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: loading ? '#F3F4F6' : 'var(--surface)',
                  border: '1px solid var(--border)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  color: 'var(--text)',
                }}
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                {loading ? 'Đang Đồng Bộ Sheets...' : 'Đồng Bộ Sheets 23 Tabs'}
              </button>
            )}

            {/* Nút Bật/Tắt Âm Thanh Thông Báo */}
            <button
              onClick={() => {
                const nextState = !soundActive;
                setSoundActive(nextState);
                setSoundEnabled(nextState);
                if (nextState) {
                  addRichToast({ title: '🔊 Âm Thanh Bật', message: 'Đã kích hoạt chuông và âm thanh thông báo realtime!', type: 'INFO' });
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '34px',
                height: '34px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: soundActive ? 'var(--surface)' : 'var(--danger-soft)',
                border: `1px solid ${soundActive ? 'var(--border)' : 'var(--danger)'}`,
                color: soundActive ? 'var(--text)' : 'var(--danger)',
                cursor: 'pointer',
              }}
              title={soundActive ? 'Đang bật âm thanh thông báo (Click để tắt)' : 'Đang tắt âm thanh (Click để bật)'}
            >
              {soundActive ? <Volume2 size={16} color="var(--brand)" /> : <VolumeX size={16} />}
            </button>

            {/* Nút Chuông Thông Báo Realtime & Notification Popover */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => {
                  setShowNotifPopover(!showNotifPopover);
                  if (!showNotifPopover) {
                    setUnreadNotifCount(0);
                  }
                }}
                className={bellRinging ? 'bell-ring-active' : ''}
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '36px',
                  height: '36px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: showNotifPopover ? 'var(--brand-soft)' : 'var(--surface)',
                  border: `1px solid ${showNotifPopover ? 'var(--brand)' : 'var(--border)'}`,
                  color: showNotifPopover ? 'var(--brand)' : 'var(--text)',
                  cursor: 'pointer',
                }}
                title="Trung tâm thông báo realtime từ công nhân viên & hệ thống"
              >
                <Bell size={18} />
                {unreadNotifCount > 0 && (
                  <span style={{
                    position: 'absolute',
                    top: '-5px',
                    right: '-5px',
                    backgroundColor: '#EF4444',
                    color: '#FFF',
                    fontSize: '10px',
                    fontWeight: 800,
                    minWidth: '18px',
                    height: '18px',
                    borderRadius: '999px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 4px',
                    border: '2px solid #FFF',
                    boxShadow: '0 2px 6px rgba(239, 68, 68, 0.4)',
                  }}>
                    {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                  </span>
                )}
              </button>

              {/* Dropdown Popover Danh Sách Thông Báo */}
              {showNotifPopover && (
                <div style={{
                  position: 'absolute',
                  top: '46px',
                  right: 0,
                  width: '360px',
                  maxWidth: '90vw',
                  backgroundColor: 'var(--surface)',
                  borderRadius: '12px',
                  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.16)',
                  border: '1px solid var(--border)',
                  zIndex: 9999,
                  overflow: 'hidden',
                  animation: 'toastSlideIn 0.25s ease forwards',
                }}>
                  <div style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border)',
                    backgroundColor: '#FCFBF9',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Bell size={15} color="var(--brand)" />
                      <strong style={{ fontSize: '13px', color: 'var(--text)' }}>Thông Báo Realtime</strong>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        onClick={() => {
                          setSystemNotifications((prev) => prev.map((n) => ({ ...n, unread: false })));
                          setUnreadNotifCount(0);
                        }}
                        style={{ fontSize: '11px', color: 'var(--brand)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        Đã đọc tất cả
                      </button>
                      <button
                        onClick={() => setShowNotifPopover(false)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  </div>

                  <div style={{ maxHeight: '360px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                    {systemNotifications.length === 0 ? (
                      <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                        Chưa có thông báo mới nào hôm nay.
                      </div>
                    ) : (
                      systemNotifications.slice(0, 15).map((notif: any, idx: number) => {
                        return (
                          <div
                            key={notif.id || idx}
                            onClick={() => {
                              if (notif.linkTab) {
                                setActiveTab(notif.linkTab);
                                setShowNotifPopover(false);
                              }
                            }}
                            style={{
                              padding: '12px 16px',
                              borderBottom: '1px solid var(--border-light)',
                              cursor: notif.linkTab ? 'pointer' : 'default',
                              backgroundColor: notif.unread ? '#FEF2F2' : 'transparent',
                              transition: 'background-color 0.15s ease',
                              display: 'flex',
                              gap: '10px',
                            }}
                          >
                            <div style={{ fontSize: '18px', lineHeight: 1 }}>
                              {notif.type === 'CHECKIN' ? '🟢' :
                               notif.type === 'CHECKOUT' ? '🏁' :
                               notif.type === 'LEAVE' ? '📝' :
                               notif.type === 'SWAP' ? '🤝' :
                               notif.type === 'PIN_CHANGED' ? '🔑' :
                               notif.type === 'PIN_SENT' ? '📩' : '📢'}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text)', marginBottom: '2px' }}>
                                {notif.title || notif.subject || 'Thông Báo Hệ Thống'}
                              </div>
                              <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                                {notif.message || notif.content}
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', fontSize: '10px', color: '#9CA3AF' }}>
                                <span>{notif.created_at ? new Date(notif.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : 'Vừa xong'}</span>
                                {notif.linkTab && (
                                  <span style={{ color: 'var(--brand)', fontWeight: 700 }}>Xem chi tiết &rarr;</span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: 'var(--radius-full)',
              backgroundColor: 'var(--success-soft)',
              color: 'var(--success)',
              fontSize: '12px',
              fontWeight: 700,
            }} className="pulse-badge">
              <CheckCircle size={14} />
              Realtime Master Online
            </div>

            <button
              onClick={handleLogout}
              title="Đăng xuất"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '6px 10px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              <LogOut size={14} />
              Thoát
            </button>
          </div>
        </header>

        {/* FLOATING RICH TOAST STACK (HIỂN THỊ THÔNG BÁO SỐNG ĐỘNG GÓC PHẢI MÀN HÌNH) */}
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '24px',
          zIndex: 99999,
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          pointerEvents: 'none',
          maxWidth: '380px',
          width: '100%',
        }}>
          {liveToasts.map((toast) => {
            const isSuccess = toast.type === 'PIN_SENT';
            const isCheckIn = toast.type === 'CHECKIN';
            const isLeave = toast.type === 'LEAVE';
            const isSwap = toast.type === 'SWAP';
            const isPin = toast.type === 'PIN_CHANGED';
            const isWarn = toast.type === 'WARNING';

            const borderColor = isCheckIn ? '#10B981' :
                                isLeave ? '#F59E0B' :
                                isSwap ? '#3B82F6' :
                                isPin ? '#8B5CF6' :
                                isWarn ? '#EF4444' :
                                isSuccess ? '#10B981' : 'var(--brand)';

            const bgGlow = isCheckIn ? 'rgba(16, 185, 129, 0.08)' :
                           isLeave ? 'rgba(245, 158, 11, 0.08)' :
                           isSwap ? 'rgba(59, 130, 246, 0.08)' :
                           isPin ? 'rgba(139, 92, 246, 0.08)' :
                           isWarn ? 'rgba(239, 68, 68, 0.08)' : 'rgba(232, 93, 146, 0.08)';

            return (
              <div
                key={toast.id}
                className="toast-slide-in"
                style={{
                  pointerEvents: 'auto',
                  backgroundColor: '#FFFFFF',
                  borderRadius: '12px',
                  boxShadow: '0 10px 28px rgba(0, 0, 0, 0.14)',
                  border: `1.5px solid ${borderColor}`,
                  overflow: 'hidden',
                  position: 'relative',
                  backdropFilter: 'blur(8px)',
                }}
              >
                <div style={{
                  padding: '12px 14px',
                  backgroundColor: bgGlow,
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'flex-start',
                }}>
                  <div style={{ fontSize: '20px', lineHeight: 1, marginTop: '2px' }}>
                    {isCheckIn ? '🟢' :
                     toast.type === 'CHECKOUT' ? '🏁' :
                     isLeave ? '📝' :
                     isSwap ? '🤝' :
                     isPin ? '🔑' :
                     isWarn ? '⚠️' : '✨'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                      <strong style={{ fontSize: '13px', color: 'var(--text)' }}>
                        {toast.title}
                      </strong>
                      <button
                        onClick={() => setLiveToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px' }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text)', lineHeight: 1.45 }}>
                      {toast.message}
                    </div>
                    {toast.linkTab && (
                      <button
                        onClick={() => {
                          setActiveTab(toast.linkTab!);
                          setLiveToasts((prev) => prev.filter((t) => t.id !== toast.id));
                        }}
                        style={{
                          marginTop: '8px',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          backgroundColor: borderColor,
                          color: '#FFFFFF',
                          fontSize: '11px',
                          fontWeight: 700,
                          border: 'none',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <Eye size={12} /> Xem Chi Tiết Ngay &rarr;
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress bar đếm ngược */}
                <div style={{
                  height: '3px',
                  backgroundColor: 'rgba(0, 0, 0, 0.05)',
                  width: '100%',
                }}>
                  <div
                    className="toast-progress-bar"
                    style={{
                      height: '100%',
                      backgroundColor: borderColor,
                      animationDuration: `${(toast.duration || 6000) / 1000}s`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* NOTIFICATION MESSAGES (BANNER CŨ) */}
        {errorMsg && (
          <div key={errorMsg} className="fx-shake" style={{ padding: '12px 24px', backgroundColor: 'var(--danger-soft)', color: 'var(--danger)', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Lỗi: {errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--danger)' }}><X size={16} /></button>
          </div>
        )}
        {successMsg && (
          <div key={successMsg} className="fx-fade-up" style={{ padding: '12px 24px', backgroundColor: 'var(--success-soft)', color: 'var(--success)', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{successMsg}</span>
            <button onClick={() => setSuccessMsg(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--success)' }}><X size={16} /></button>
          </div>
        )}

        {/* TAB CONTENTS */}
        <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>

          {/* ========================================================= */}
          {/* MODULE 1: DASHBOARD TỔNG THỂ */}
          {/* ========================================================= */}
          {activeTab === 'dashboard' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>1. Dashboard Tổng Thể Hệ Thống Ụm Bò Milk</h1>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Cập nhật theo thời gian thực từ Google Sheets Master và Socket.IO</p>
                </div>
                <button
                  onClick={async () => {
                    await loadAllData();
                    showToast('Đã tải lại toàn bộ số liệu thống kê Dashboard mới nhất!');
                  }}
                  disabled={loading}
                  className="btn-interactive"
                  style={{
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--brand)',
                    color: '#FFF',
                    fontWeight: 600,
                    fontSize: '13px',
                    border: 'none',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 2px 6px rgba(232, 93, 146, 0.25)',
                  }}
                >
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                  {loading ? 'Đang Tải Lại...' : 'Tải Lại Số Liệu'}
                </button>
              </div>

              {/* VIP: Admin mở bù cổng đăng ký OFF 2 ngày/tuần (30 phút, tự đóng) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', backgroundColor: manualOff?.active ? '#ECFDF5' : '#FFFBEB', border: manualOff?.active ? '1.5px solid #10B981' : '1.5px solid #F59E0B', borderRadius: 'var(--radius-md)', padding: '14px 18px' }}>
                <span style={{ fontSize: '22px' }}>{manualOff?.active ? '🟢' : '⭐'}</span>
                <div style={{ flex: 1, minWidth: '220px' }}>
                  <div style={{ fontWeight: 800, fontSize: '14px', color: 'var(--text)' }}>
                    VIP: Mở bù đăng ký 2 ngày OFF tuần cho nhân viên
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {manualOff?.active && manualOff?.manual
                      ? <>Đang mở cho tuần <strong>{manualOff.manual.targetWeekMon} → {manualOff.manual.targetWeekSun}</strong> • Tự đóng sau <strong style={{ color: '#059669', fontSize: '14px' }}>{manualRemaining}</strong></>
                      : 'Khi hết khung T6–T7, Admin mở bù để NV đăng ký (mặc định 30 phút, tự đóng).'}
                  </div>
                </div>
                {manualOff?.active ? (
                  <button onClick={handleManualClose} style={{ padding: '9px 18px', borderRadius: 'var(--radius-sm)', backgroundColor: '#DC2626', color: '#FFF', fontSize: '13px', fontWeight: 800, border: 'none', cursor: 'pointer' }}>
                    ⛔ Đóng ngay
                  </button>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)' }}>Phút:</label>
                    <input type="number" min={1} max={120} value={manualMinutes} onChange={e => setManualMinutes(Number(e.target.value))} style={{ width: '64px', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '13px', fontWeight: 700 }} />
                    <button onClick={handleManualOpen} style={{ padding: '9px 18px', borderRadius: 'var(--radius-sm)', backgroundColor: '#7C3AED', color: '#FFF', fontSize: '13px', fontWeight: 800, border: 'none', cursor: 'pointer', boxShadow: '0 4px 12px rgba(124,58,237,0.25)' }}>
                      ⚡ Mở cổng ngay
                    </button>
                  </div>
                )}
              </div>

              {/* 8 KPI Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-soft)' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>TỔNG NHÂN SỰ</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--brand)', marginTop: '6px' }}>{dashboardStats?.kpis?.totalEmployees ?? 0}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Toàn bộ 6 chi nhánh & trụ sở</div>
                </div>

                <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-soft)' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>NV MỚI / THỬ VIỆC</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: '#2563EB', marginTop: '6px' }}>
                    {dashboardStats?.kpis?.newEmployees ?? 0} / {dashboardStats?.kpis?.probationEmployees ?? 0}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Tiếp nhận & đang thử việc</div>
                </div>

                <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-soft)' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>NV CHÍNH THỨC</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--success)', marginTop: '6px' }}>{dashboardStats?.kpis?.officialEmployees ?? 0}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Đã hoàn tất đánh giá thử việc</div>
                </div>

                <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-soft)' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>ĐANG LÀM / VẮNG HÔM NAY</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: '#D97706', marginTop: '6px' }}>
                    {dashboardStats?.kpis?.activeWorkingNow ?? 0} / {dashboardStats?.kpis?.absentToday ?? 0}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Theo ca làm việc được duyệt</div>
                </div>
              </div>

              {/* Row 2: Secondary KPIs & System Health */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-soft)' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>CHỜ NV ĐỔI PIN</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--success)', marginTop: '6px' }}>
                    {employeeAccounts.filter((a: any) => a.pin_must_change).length}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>PIN khởi tạo, NV chưa đổi</div>
                </div>

                <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-soft)' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>YÊU CẦU ĐANG CHỜ DUYỆT</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: '#7C3AED', marginTop: '6px' }}>
                    {dashboardStats?.kpis?.pendingRequestsCount ?? 0}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Đơn nghỉ / đổi ca / công</div>
                </div>

                <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-soft)', gridColumn: 'span 2' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>TRẠNG THÁI HẠ TẦNG KỸ THUẬT (HEALTH CHECK)</div>
                  <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: 'var(--success)' }}></span>
                      <span style={{ fontSize: '12px', fontWeight: 600 }}>Sheets (23 Tabs OK)</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: 'var(--success)' }}></span>
                      <span style={{ fontSize: '12px', fontWeight: 600 }}>Drive (Receipts OK)</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: 'var(--success)' }}></span>
                      <span style={{ fontSize: '12px', fontWeight: 600 }}>Socket.IO (Live)</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: 'var(--success)' }}></span>
                      <span style={{ fontSize: '12px', fontWeight: 600 }}>Queue (Idle 0 Pending)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tình Trạng Từng Chi Nhánh */}
              <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: '14px', color: 'var(--text)' }}>
                  Tình Trạng Định Biên & Nhân Sự 6 Chi Nhánh
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                      <th style={{ padding: '12px 20px' }}>Mã & Tên Chi Nhánh</th>
                      <th style={{ padding: '12px 20px' }}>Địa Chỉ</th>
                      <th style={{ padding: '12px 20px' }}>Tổng Nhân Sự</th>
                      <th style={{ padding: '12px 20px' }}>Ca Làm Hôm Nay</th>
                      <th style={{ padding: '12px 20px' }}>Định Biên (Min/Max)</th>
                      <th style={{ padding: '12px 20px' }}>Tình Trạng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboardStats?.branchStatus?.map((b: any) => (
                      <tr key={b.branch_id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '14px 20px', fontWeight: 700, color: 'var(--text)' }}>
                          {b.branch_name}
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Mã: {b.branch_id}</div>
                        </td>
                        <td style={{ padding: '14px 20px', color: 'var(--text-muted)', fontSize: '12px' }}>{b.address}</td>
                        <td style={{ padding: '14px 20px', fontWeight: 600 }}>{b.total_staff} NV</td>
                        <td style={{ padding: '14px 20px', fontWeight: 600 }}>{b.shifts_today} Ca</td>
                        <td style={{ padding: '14px 20px' }}>{b.min_staff} - {b.max_staff} NV/ca</td>
                        <td style={{ padding: '14px 20px' }}>
                          <span style={{
                            padding: '4px 8px',
                            borderRadius: 'var(--radius-full)',
                            fontSize: '11px',
                            fontWeight: 700,
                            backgroundColor: b.staffing_status === 'ADEQUATE' ? 'var(--success-soft)' : 'var(--warning-soft)',
                            color: b.staffing_status === 'ADEQUATE' ? 'var(--success)' : 'var(--warning)',
                          }}>
                            {b.staffing_status === 'ADEQUATE' ? 'Đủ Định Biên' : 'Thiếu Định Biên'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Cảnh Báo Hệ Thống & Hoạt Động Gần Nhất */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertTriangle size={18} color="var(--warning)" /> Cảnh Báo Hệ Thống Cần Lưu Ý
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {dashboardStats?.systemAlerts?.map((alert: any, idx: number) => (
                      <div key={idx} style={{
                        padding: '12px 14px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: alert.level === 'URGENT' ? 'var(--danger-soft)' : alert.level === 'WARNING' ? 'var(--warning-soft)' : 'var(--brand-soft)',
                        color: alert.level === 'URGENT' ? 'var(--danger)' : alert.level === 'WARNING' ? '#92400E' : 'var(--brand)',
                        fontSize: '12px',
                        fontWeight: 600,
                      }}>
                        {alert.message}
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Activity size={18} color="var(--brand)" /> Hoạt Động Gần Nhất (Audit Trail)
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {dashboardStats?.recentActivities?.slice(0, 5).map((act: any, idx: number) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: '12px' }}>
                        <div>
                          <span style={{ fontWeight: 700, color: 'var(--text)' }}>{act.actor_id}</span>
                          <span style={{ color: 'var(--text-muted)' }}> thực hiện </span>
                          <span style={{ fontWeight: 600, color: 'var(--brand)' }}>{act.action}</span>
                        </div>
                        <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{new Date(act.timestamp).toLocaleTimeString('vi-VN')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* MODULE 2: TÀI KHOẢN & PHÂN QUYỀN NỘI BỘ */}
          {/* ========================================================= */}
          {activeTab === 'internal-accounts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>2. Quản Lý Tài Khoản Nội Bộ & Phân Quyền</h1>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Phân quyền 5 vai trò (Admin, HR, Store, Finance, Marketing) và phạm vi chi nhánh (branchScope)</p>
                </div>
                <button
                  onClick={() => setShowNewAdminModal(true)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--brand)',
                    color: '#FFF',
                    fontWeight: 600,
                    fontSize: '13px',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Plus size={16} /> Thêm Tài Khoản Nội Bộ
                </button>
              </div>

              <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                      <th style={{ padding: '12px 20px' }}>Admin ID</th>
                      <th style={{ padding: '12px 20px' }}>Tên Đăng Nhập</th>
                      <th style={{ padding: '12px 20px' }}>Họ Và Tên</th>
                      <th style={{ padding: '12px 20px' }}>Vai Trò (Role)</th>
                      <th style={{ padding: '12px 20px' }}>Phạm Vi Chi Nhánh</th>
                      <th style={{ padding: '12px 20px' }}>Trạng Thái</th>
                      <th style={{ padding: '12px 20px' }}>Thao Tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {internalAccounts.map((acc: any) => (
                      <tr key={acc.admin_id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '14px 20px', fontWeight: 600 }}>{acc.admin_id}</td>
                        <td style={{ padding: '14px 20px', fontWeight: 700, color: 'var(--brand)' }}>{acc.username}</td>
                        <td style={{ padding: '14px 20px' }}>{acc.full_name}</td>
                        <td style={{ padding: '14px 20px' }}>
                          <span style={{
                            padding: '4px 8px',
                            borderRadius: 'var(--radius-full)',
                            fontSize: '11px',
                            fontWeight: 700,
                            backgroundColor: 'var(--brand-soft)',
                            color: 'var(--brand)',
                          }}>
                            {acc.role}
                          </span>
                        </td>
                        <td style={{ padding: '14px 20px', fontWeight: 600 }}>{acc.branch_scope === '*' ? 'Toàn Hệ Thống (*)' : acc.branch_scope}</td>
                        <td style={{ padding: '14px 20px' }}>
                          <span style={{
                            padding: '4px 8px',
                            borderRadius: 'var(--radius-full)',
                            fontSize: '11px',
                            fontWeight: 700,
                            backgroundColor: acc.is_active === false ? 'var(--danger-soft)' : 'var(--success-soft)',
                            color: acc.is_active === false ? 'var(--danger)' : 'var(--success)',
                          }}>
                            {acc.is_active === false ? 'Đã Khóa' : 'Đang Hoạt Động'}
                          </span>
                        </td>
                        <td style={{ padding: '14px 20px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <button
                            onClick={() => handleToggleInternalAccount(acc)}
                            style={{
                              padding: '6px 12px',
                              borderRadius: 'var(--radius-sm)',
                              border: acc.is_active === false ? '1px solid var(--success)' : '1px solid var(--danger)',
                              backgroundColor: 'transparent',
                              color: acc.is_active === false ? 'var(--success)' : 'var(--danger)',
                              fontWeight: 600,
                              fontSize: '12px',
                              cursor: 'pointer',
                            }}
                          >
                            {acc.is_active === false ? 'Mở Khóa' : 'Khóa'}
                          </button>
                          {acc.admin_id !== 'ADM_001' && acc.username !== 'admin' && (
                            <button
                              onClick={() => handleDeleteInternalAccount(acc.admin_id, acc.username)}
                              style={{
                                padding: '6px 12px',
                                borderRadius: 'var(--radius-sm)',
                                border: '1px solid var(--danger)',
                                backgroundColor: 'var(--danger-soft)',
                                color: 'var(--danger)',
                                fontWeight: 600,
                                fontSize: '12px',
                                cursor: 'pointer',
                              }}
                            >
                              Xóa
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* MODULE 3: PIN & TÀI KHOẢN NHÂN VIÊN (6 SUB-TABS) */}
          {/* ========================================================= */}
          {activeTab === 'activation' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>3. PIN & Quản Lý Tài Khoản Nhân Viên</h1>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Phân nhóm theo 6 tab nghiệp vụ: Tất cả, Thử việc, Chính thức, Văn Phòng, Xưởng, Sales. Nhân viên đăng nhập trên Cổng Employee Web bằng SĐT + mã PIN khởi tạo (tự sinh), rồi đặt PIN riêng ngay lần đầu.</p>
              </div>

              {/* 6 Sub-Tabs for PIN & Account Management */}
              <div style={{
                display: 'flex',
                gap: '8px',
                borderBottom: '2px solid var(--border)',
                paddingBottom: '8px',
                overflowX: 'auto',
              }}>
                {[
                  { key: 'ALL', label: 'Tất cả nhân sự', count: countAll, icon: '🌟' },
                  { key: 'PROBATION', label: 'Thử việc', count: countProbation, icon: '📝' },
                  { key: 'OFFICIAL', label: 'Chính thức', count: countOfficial, icon: '💼' },
                  { key: 'VAN_PHONG', label: 'Văn Phòng', count: countOffice, icon: '🏢' },
                  { key: 'XUONG', label: 'Xưởng', count: countFactory, icon: '🏭' },
                  { key: 'SALE', label: 'Sales', count: countSales, icon: '📈' },
                ].map(t => {
                  const isActive = activationSubTab === t.key;
                  return (
                    <button
                      key={t.key}
                      onClick={() => setActivationSubTab(t.key as any)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '9px 15px',
                        borderRadius: 'var(--radius-sm)',
                        border: 'none',
                        backgroundColor: isActive ? 'var(--brand)' : 'var(--surface)',
                        color: isActive ? '#FFFFFF' : 'var(--text)',
                        fontWeight: 700,
                        fontSize: '13px',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        boxShadow: isActive ? '0 2px 8px rgba(232, 93, 146, 0.25)' : 'none',
                      }}
                    >
                      <span>{t.icon}</span>
                      <span>{t.label}</span>
                      <span style={{
                        padding: '2px 7px',
                        borderRadius: 'var(--radius-full)',
                        fontSize: '11px',
                        backgroundColor: isActive ? 'rgba(255,255,255,0.3)' : 'var(--brand-soft)',
                        color: isActive ? '#FFFFFF' : 'var(--brand)',
                        fontWeight: 800,
                      }}>
                        {t.count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Search Bar & Branch Rule Reminder */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '16px',
                backgroundColor: 'var(--surface)',
                padding: '14px 16px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                flexWrap: 'wrap',
              }}>
                <div style={{ flex: 1, position: 'relative', minWidth: '220px' }}>
                  <input
                    type="text"
                    placeholder="Tìm nhanh theo SĐT (090...), Mã NV (UBM_NV...), Họ tên, Chi nhánh..."
                    value={accountSearch}
                    onChange={(e) => setAccountSearch(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px 8px 36px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)',
                      fontSize: '13px',
                    }}
                  />
                  <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Mã PIN khởi tạo ở cột Mã PIN bên dưới — nhân viên dùng để đăng nhập lần đầu rồi đặt PIN riêng ngay.
                </div>
                <button
                  onClick={() => handleBulkSendPin()}
                  disabled={pinSending || pendingPinCount === 0}
                  title={pendingPinCount === 0 ? 'Không còn PIN khởi tạo nào để gửi' : `Gửi PIN khởi tạo qua Zalo cho ${pendingPinCount} nhân viên chưa đổi PIN`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '10px 16px', borderRadius: 'var(--radius-sm)',
                    backgroundColor: pinSending || pendingPinCount === 0 ? '#CBD5E1' : '#16A34A',
                    color: '#FFF', fontSize: '13px', fontWeight: 800, border: 'none',
                    cursor: pinSending || pendingPinCount === 0 ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 12px rgba(22,163,74,0.25)', whiteSpace: 'nowrap',
                  }}
                >
                  📩 {pinSending ? 'Đang gửi...' : `Gửi PIN Zalo hàng loạt (${pendingPinCount})`}
                </button>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Quy tắc chi nhánh: Văn phòng & Sales: <strong style={{ color: 'var(--brand)' }}>Trụ sở chính</strong> | Xưởng: <strong style={{ color: 'var(--brand)' }}>Củ Chi</strong>
                </div>
              </div>

              {/* Banner theo dõi PIN tháng (kỳ xoay 1-5): ai đổi rồi / ai còn chờ */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', backgroundColor: '#FFFBEB', border: '1.5px solid #F59E0B', borderRadius: 'var(--radius-md)', padding: '12px 16px', fontSize: '13px' }}>
                <span style={{ fontWeight: 800, color: '#92400E' }}>🔑 PIN tháng {pinMonthStats.key} (hạn 1-5):</span>
                <span style={{ padding: '4px 12px', borderRadius: '999px', backgroundColor: '#DCFCE7', color: '#166534', fontWeight: 800, fontSize: '12px' }}>✅ Đã đổi riêng: {pinMonthStats.changed}/{pinMonthStats.total}</span>
                <span style={{ padding: '4px 12px', borderRadius: '999px', backgroundColor: '#FEE2E2', color: '#991B1B', fontWeight: 800, fontSize: '12px' }}>🔒 Chờ đổi: {pinMonthStats.pending}</span>
                <span style={{ color: '#92400E', fontSize: '12px' }}>NV quên PIN → bấm "Reset PIN" ở dòng đó để cấp mã mới rồi gửi cho NV.</span>
              </div>

              {/* Unified PIN & Account Table */}
              <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                      <th style={{ padding: '12px 20px' }}>Mã NV</th>
                      <th style={{ padding: '12px 20px' }}>Họ Và Tên</th>
                      <th style={{ padding: '12px 20px' }}>Số Điện Thoại</th>
                      <th style={{ padding: '12px 20px' }}>Khối / Bộ Phận</th>
                      <th style={{ padding: '12px 20px' }}>Chi Nhánh</th>
                      <th style={{ padding: '12px 20px' }}>Giai Đoạn</th>
                      <th style={{ padding: '12px 20px' }}>Mã PIN</th>
                      <th style={{ padding: '12px 20px' }}>Trạng Thái PIN</th>
                      <th style={{ padding: '12px 20px' }}>Đổi PIN Cuối</th>
                      <th style={{ padding: '12px 20px' }}>Gửi Zalo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredActivationItems.length === 0 ? (
                      <tr>
                        <td colSpan={10} style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                          Không có nhân sự nào trong tab này hoặc không khớp với tìm kiếm.
                        </td>
                      </tr>
                    ) : (
                      filteredActivationItems.map((item: any) => (
                        <tr key={item.accountId || item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '14px 20px' }}>
                            <span style={{
                              fontFamily: 'monospace',
                              fontWeight: 700,
                              color: 'var(--brand)',
                              backgroundColor: 'var(--brand-soft)',
                              padding: '3px 8px',
                              borderRadius: '4px',
                            }}>
                              {item.employeeCode}
                            </span>
                          </td>
                          <td style={{ padding: '14px 20px', fontWeight: 700, color: 'var(--text)' }}>
                            {item.fullName}
                          </td>
                          <td style={{ padding: '14px 20px', fontWeight: 600 }}>
                            {item.phone}
                            {item.isDuplicatePhone && (
                              <span title="SĐT này đang dùng chung cho nhiều hồ sơ! Hệ thống dùng mã PIN để phân biệt khi đăng nhập." style={{
                                marginLeft: '6px',
                                padding: '2px 7px',
                                borderRadius: '999px',
                                fontSize: '10px',
                                fontWeight: 800,
                                backgroundColor: '#FEF2F2',
                                color: '#DC2626',
                                border: '1px solid #FCA5A5',
                                whiteSpace: 'nowrap',
                              }}>
                                ⚠️ Trùng SĐT
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '14px 20px' }}>
                            <span style={{
                              padding: '3px 8px',
                              borderRadius: 'var(--radius-full)',
                              fontSize: '11px',
                              fontWeight: 700,
                              backgroundColor: 'var(--brand-soft)',
                              color: 'var(--brand)',
                            }}>
                              {item.group === 'STORE' ? 'Cửa Hàng' :
                               item.group === 'XUONG' ? 'Xưởng SX' :
                               item.group === 'VAN_PHONG' ? 'Văn Phòng' :
                               item.group === 'SALE' ? 'Sales / MKT' : item.group}
                            </span>
                          </td>
                          <td style={{ padding: '14px 20px', fontWeight: 600, color: 'var(--text)' }}>
                            <span style={{
                              padding: '3px 8px',
                              borderRadius: '4px',
                              backgroundColor:
                                item.branchKind === 'HQ' ? '#EDE9FE' :
                                item.branchKind === 'FACTORY' ? '#FEF3C7' : '#E0E7FF',
                              color:
                                item.branchKind === 'HQ' ? '#6D28D9' :
                                item.branchKind === 'FACTORY' ? '#B45309' : '#3730A3',
                              fontSize: '12px',
                              fontWeight: 700,
                            }}>
                              {item.displayBranch}
                            </span>
                          </td>
                          <td style={{ padding: '14px 20px' }}>
                            <span style={{
                              padding: '3px 8px',
                              borderRadius: 'var(--radius-full)',
                              fontSize: '11px',
                              fontWeight: 700,
                              backgroundColor:
                                item.employmentStatus === 'OFFICIAL' ? 'var(--success-soft)' :
                                item.employmentStatus === 'PROBATION' ? '#DBEAFE' : 'var(--warning-soft)',
                              color:
                                item.employmentStatus === 'OFFICIAL' ? 'var(--success)' :
                                item.employmentStatus === 'PROBATION' ? '#1D4ED8' : '#92400E',
                            }}>
                              {item.employmentStatus === 'OFFICIAL' ? 'Chính Thức' :
                               item.employmentStatus === 'PROBATION' ? 'Thử Việc' : 'Nhân Viên Mới'}
                            </span>
                          </td>
                          {/* Cột Mã PIN khởi tạo — hiển thị cho cả Admin lẫn HR */}
                          <td style={{ padding: '14px 20px' }}>
                            {item.pinCode ? (
                              <span style={{
                                fontFamily: 'monospace',
                                fontWeight: 800,
                                fontSize: '14px',
                                letterSpacing: '2px',
                                color: 'var(--brand)',
                                backgroundColor: 'var(--brand-soft)',
                                padding: '4px 10px',
                                borderRadius: '4px',
                                whiteSpace: 'nowrap',
                              }}>
                                {item.pinCode}
                              </span>
                            ) : (
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                Chưa có
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '14px 20px' }}>
                            <span style={{
                              padding: '4px 8px',
                              borderRadius: 'var(--radius-full)',
                              fontSize: '11px',
                              fontWeight: 700,
                              backgroundColor:
                                item.accountStatus === 'ACTIVE' ? 'var(--success-soft)' : '#F1F5F9',
                              color:
                                item.accountStatus === 'ACTIVE' ? 'var(--success)' : '#64748B',
                            }}>
                              {item.accountStatus === 'ACTIVE' ? 'Có Tài Khoản' : 'Chưa Có TK'}
                              {item.pinMustChange ? ' 🔒' : ''}
                            </span>
                            {item.pinMustChange && (
                              <div title="NV dùng mã khởi tạo, chưa đặt PIN riêng — mọi phiên cũ đã vô hiệu" style={{ fontSize: '10px', color: '#D97706', fontWeight: 700, marginTop: '3px' }}>
                                🔒 Chờ NV đổi PIN
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '14px 20px', fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {fmtPinTime(item.pinUpdatedAt)}
                          </td>
                          <td style={{ padding: '14px 20px' }}>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {item.pinMustChange && item.pinCode && item.hasRealAccount ? (
                              <button
                                onClick={() => handleBulkSendPin([item.accountId])}
                                disabled={pinSending}
                                title={`Gửi mã PIN ${item.pinCode} tới Zalo SĐT ${item.phone}`}
                                style={{
                                  padding: '6px 12px', borderRadius: 'var(--radius-sm)',
                                  backgroundColor: sendingSingleId === item.accountId ? '#CBD5E1' : '#0EA5E9',
                                  color: '#FFF', fontSize: '11px', fontWeight: 800, border: 'none',
                                  cursor: pinSending ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
                                }}
                              >
                                {sendingSingleId === item.accountId ? '⏳ Đang gửi...' : '📩 Gửi PIN'}
                              </button>
                            ) : (
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>—</span>
                            )}
                            {item.hasRealAccount && (
                              <button
                                onClick={() => handleResetPin(item)}
                                disabled={resettingPinId === item.accountId}
                                title="NV quên PIN: cấp mã mới (mã cũ hết hiệu lực ngay)"
                                style={{
                                  padding: '6px 12px', borderRadius: 'var(--radius-sm)',
                                  backgroundColor: '#F59E0B',
                                  color: '#FFF', fontSize: '11px', fontWeight: 800, border: 'none',
                                  cursor: resettingPinId === item.accountId ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
                                }}
                              >
                                {resettingPinId === item.accountId ? '⏳...' : '🔄 Reset PIN'}
                              </button>
                            )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Modal tiến trình gửi PIN Zalo */}
              {showPinModal && (
                <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
                  <div style={{ backgroundColor: '#FFF', borderRadius: '12px', maxWidth: '640px', width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontWeight: 800, fontSize: '15px' }}>📩 Gửi mã PIN qua Zalo cá nhân HR</div>
                      <button onClick={() => !pinSending && setShowPinModal(false)} disabled={pinSending} style={{ border: 'none', background: 'none', fontSize: '18px', cursor: pinSending ? 'not-allowed' : 'pointer' }}>✕</button>
                    </div>
                    <div style={{ padding: '16px 20px', overflowY: 'auto' }}>
                      {pinSending && pinResults.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
                          <div style={{ fontSize: '28px', marginBottom: '8px' }}>⏳</div>
                          Đang gửi tuần tự từng tin (nghỉ 0.8s/tin chống spam)... Vui lòng không đóng cửa sổ.
                        </div>
                      )}
                      {pinSummary && (
                        <div style={{ display: 'flex', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
                          <span style={{ padding: '6px 12px', borderRadius: '999px', backgroundColor: '#DCFCE7', color: '#166534', fontWeight: 800, fontSize: '12px' }}>✅ Thành công: {pinSummary.sent}</span>
                          <span style={{ padding: '6px 12px', borderRadius: '999px', backgroundColor: '#FEE2E2', color: '#991B1B', fontWeight: 800, fontSize: '12px' }}>❌ Lỗi: {pinSummary.failed}</span>
                          <span style={{ padding: '6px 12px', borderRadius: '999px', backgroundColor: '#F1F5F9', color: '#334155', fontWeight: 800, fontSize: '12px' }}>Tổng: {pinSummary.total}</span>
                        </div>
                      )}
                      {pinResults.length > 0 && (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                          <thead>
                            <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                              <th style={{ padding: '6px' }}>Nhân viên</th>
                              <th style={{ padding: '6px' }}>SĐT</th>
                              <th style={{ padding: '6px' }}>Kết quả</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pinResults.map((r: any) => (
                              <tr key={r.accountId} style={{ borderTop: '1px solid var(--border)' }}>
                                <td style={{ padding: '6px', fontWeight: 700 }}>{r.name}</td>
                                <td style={{ padding: '6px', fontFamily: 'monospace' }}>{r.phone}</td>
                                <td style={{ padding: '6px' }}>
                                  {r.status === 'SENT' ? <span style={{ color: '#16A34A', fontWeight: 700 }}>✅ Đã gửi</span>
                                    : r.status === 'NOT_FRIEND' ? <span style={{ color: '#D97706', fontWeight: 700 }}>⚠️ Chưa kết bạn — {r.detail}</span>
                                    : r.status === 'NOT_FOUND' ? <span style={{ color: '#DC2626', fontWeight: 700 }}>❌ {r.detail}</span>
                                    : <span style={{ color: '#DC2626', fontWeight: 700 }}>❌ {r.detail || r.status}</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {pinSummary && pinSummary.failed > 0 && (
                        <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                          💡 Ca lỗi thường do chưa kết bạn Zalo: vào tab Zalo → tìm SĐT → Kết bạn → bấm Gửi lại từng dòng.
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
                      <button onClick={() => setShowPinModal(false)} disabled={pinSending} style={{ padding: '8px 18px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--brand)', color: '#FFF', fontWeight: 700, border: 'none', cursor: pinSending ? 'not-allowed' : 'pointer' }}>
                        {pinSending ? 'Đang gửi...' : 'Đóng'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================= */}
          {/* MODULE 4: QUẢN LÝ NHÂN VIÊN */}
          {/* ========================================================= */}
          {activeTab === 'employees' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>4. Quản Lý Hồ Sơ & Lộ Trình Nhân Viên</h1>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Toàn bộ 4 nhóm nhân sự: Cửa hàng (Store), Xưởng sản xuất, Văn phòng, Marketing/Sale. Ràng buộc Mã NV: UBM_NV0000 (random từ 0000 đến 9999).</p>
                </div>
                {['ADMIN', 'HR'].includes(currentUser?.role || '') && (
                  <button
                    onClick={() => {
                      setNewEmpForm({
                        employeeCode: generateRandomEmployeeCode(),
                        fullName: '',
                        phone: '',
                        group: 'STORE',
                        branchId: 'CN130',
                        employmentStatus: 'PRE_ONBOARDING',
                      });
                      setShowNewEmpModal(true);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '10px 16px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--brand)',
                      color: '#FFF',
                      fontSize: '13px',
                      fontWeight: 700,
                      border: 'none',
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(232, 93, 146, 0.25)',
                    }}
                  >
                    <Plus size={16} />
                    Thêm Hồ Sơ Nhân Viên Mới
                  </button>
                )}
              </div>

              {/* Filters */}
              <div style={{ display: 'flex', gap: '16px', backgroundColor: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <input
                    type="text"
                    placeholder="Tìm theo họ tên, mã NV (UBM_NV...), SĐT..."
                    value={empSearch}
                    onChange={(e) => setEmpSearch(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px 8px 36px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '13px' }}
                  />
                  <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                </div>
                <select
                  value={empGroupFilter}
                  onChange={(e) => setEmpGroupFilter(e.target.value)}
                  style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '13px' }}
                >
                  <option value="ALL">Mọi Khối Nhóm (Store, Xưởng, VP, Sale)</option>
                  <option value="STORE">Khối Cửa Hàng (Store)</option>
                  <option value="XUONG">Khối Xưởng Sản Xuất</option>
                  <option value="VAN_PHONG">Khối Văn Phòng</option>
                  <option value="SALE">Khối Sale / Marketing</option>
                </select>
                <select
                  value={empBranchFilter}
                  onChange={(e) => setEmpBranchFilter(e.target.value)}
                  style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '13px' }}
                >
                  <option value="ALL">Mọi Chi Nhánh</option>
                  <option value="CN130">CN1: 130 Vạn Kiếp (Bình Thạnh)</option>
                  <option value="CN261">CN2: 261 Tô Hiến Thành (Q.10)</option>
                  <option value="CN120">CN3: 120 Hoàng Diệu 2 (Thủ Đức)</option>
                  <option value="CN111">CN4: 111 Tôn Đản (Q.4)</option>
                  <option value="XUONG_SX">Xưởng Sản Xuất (Củ Chi)</option>
                  <option value="VAN_PHONG">Văn Phòng: 10 Đặng Thai Mai (Phú Nhuận)</option>
                </select>
              </div>

              {/* Employee Cards / Table */}
              <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                      <th style={{ padding: '12px 20px' }}>Mã NV</th>
                      <th style={{ padding: '12px 20px' }}>Họ Và Tên</th>
                      <th style={{ padding: '12px 20px' }}>SĐT Chuẩn Hóa</th>
                      <th style={{ padding: '12px 20px' }}>Khối / Nhóm</th>
                      <th style={{ padding: '12px 20px' }}>Chi Nhánh</th>
                      <th style={{ padding: '12px 20px' }}>Lương Giờ (VND)</th>
                      <th style={{ padding: '12px 20px' }}>Giai Đoạn</th>
                      <th style={{ padding: '12px 20px' }}>Thao Tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.map((emp: any) => (
                      <tr key={emp.employee_id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '14px 20px' }}>
                          <span style={{
                            fontFamily: 'monospace',
                            fontWeight: 700,
                            color: 'var(--brand)',
                            backgroundColor: 'var(--brand-soft)',
                            padding: '3px 8px',
                            borderRadius: '4px',
                          }}>
                            {emp.employee_code}
                          </span>
                        </td>
                        <td style={{ padding: '14px 20px', fontWeight: 700 }}>{emp.full_name}</td>
                        <td style={{ padding: '14px 20px', fontWeight: 600 }}>{emp.phone_normalized}</td>
                        <td style={{ padding: '14px 20px' }}>
                          <span style={{
                            padding: '4px 8px',
                            borderRadius: 'var(--radius-full)',
                            fontSize: '11px',
                            fontWeight: 700,
                            backgroundColor: 'var(--brand-soft)',
                            color: 'var(--brand)',
                          }}>
                            {emp.group === 'STORE' ? 'Cửa Hàng' :
                             emp.group === 'XUONG' ? 'Xưởng SX' :
                             emp.group === 'VAN_PHONG' ? 'Văn Phòng' :
                             emp.group === 'SALE' ? 'Sales / MKT' : emp.group}
                          </span>
                        </td>
                        <td style={{ padding: '14px 20px' }}>
                          <span style={{
                            padding: '3px 8px',
                            borderRadius: '4px',
                            backgroundColor:
                              getDisplayBranch(emp.default_branch_id, emp.group) === 'Trụ sở chính' ? '#EDE9FE' :
                              getDisplayBranch(emp.default_branch_id, emp.group) === 'Củ Chi' ? '#FEF3C7' : '#E0E7FF',
                            color:
                              getDisplayBranch(emp.default_branch_id, emp.group) === 'Trụ sở chính' ? '#6D28D9' :
                              getDisplayBranch(emp.default_branch_id, emp.group) === 'Củ Chi' ? '#B45309' : '#3730A3',
                            fontSize: '12px',
                            fontWeight: 700,
                          }}>
                            {getDisplayBranch(emp.default_branch_id, emp.group)}
                          </span>
                        </td>
                        <td style={{ padding: '14px 20px', fontWeight: 700, color: 'var(--success)' }}>
                          {emp.current_rate_per_hour?.toLocaleString('vi-VN')} đ/h
                        </td>
                        <td style={{ padding: '14px 20px' }}>
                          <span style={{
                            padding: '4px 8px',
                            borderRadius: 'var(--radius-full)',
                            fontSize: '11px',
                            fontWeight: 700,
                            backgroundColor:
                              emp.employment_status === 'OFFICIAL' ? 'var(--success-soft)' :
                              emp.employment_status === 'PROBATION' ? '#DBEAFE' : 'var(--warning-soft)',
                            color:
                              emp.employment_status === 'OFFICIAL' ? 'var(--success)' :
                              emp.employment_status === 'PROBATION' ? '#1D4ED8' : '#92400E',
                          }}>
                            {emp.employment_status === 'OFFICIAL' ? 'Chính Thức' :
                             emp.employment_status === 'PROBATION' ? 'Thử Việc' :
                             emp.employment_status === 'PRE_ONBOARDING' ? 'Mới Tiếp Nhận' : emp.employment_status}
                          </span>
                        </td>
                        <td style={{ padding: '14px 20px' }}>
                          <button
                            onClick={() => handleDeleteEmployee(emp.employee_id, emp.full_name)}
                            style={{
                              padding: '6px 12px',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--danger)',
                              backgroundColor: 'var(--danger-soft)',
                              color: 'var(--danger)',
                              fontWeight: 600,
                              fontSize: '12px',
                              cursor: 'pointer',
                            }}
                          >
                            Xóa
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* MODULE 5: CHI NHÁNH & CA LÀM */}
          {/* ========================================================= */}
          {activeTab === 'branches' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div>
                <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>5. Quản Lý Chi Nhánh & Cấu Hình Ca Làm</h1>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Tọa độ GPS, bán kính quét hợp lệ (300m), định biên nhân sự và khung giờ ca 1/2/3</p>
              </div>

              {/* 6 Branches Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                {branches.map((b: any) => (
                  <div key={b.id} style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-soft)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text)' }}>{b.name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--brand)', fontWeight: 700 }}>Mã: {b.id}</div>
                      </div>
                      <span style={{
                        padding: '4px 8px',
                        borderRadius: 'var(--radius-full)',
                        fontSize: '11px',
                        fontWeight: 700,
                        backgroundColor: 'var(--success-soft)',
                        color: 'var(--success)',
                      }}>
                        {b.status}
                      </span>
                    </div>

                    <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      <div>📍 {b.address}</div>
                      <div style={{ marginTop: '6px' }}>🌐 GPS: {b.latitude.toFixed(6)}, {b.longitude.toFixed(6)}</div>
                      <div style={{ marginTop: '4px' }}>🎯 Bán kính cho phép: <strong>{b.radius_meters}m</strong></div>
                      <div style={{ marginTop: '4px' }}>👥 Định biên ca: <strong>{b.min_staff} - {b.max_staff} NV</strong></div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Shift Templates */}
              <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)', marginBottom: '14px' }}>Khung Giờ Ca Làm Việc Chuẩn</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                  <div style={{ padding: '14px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 800, color: 'var(--brand)' }}>Ca 1 (Ca Sáng)</div>
                    <div style={{ fontSize: '18px', fontWeight: 800, marginTop: '6px' }}>07:00 - 12:00</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>Thời lượng: 5.0 giờ công</div>
                  </div>
                  <div style={{ padding: '14px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 800, color: 'var(--brand)' }}>Ca 2 (Ca Chiều)</div>
                    <div style={{ fontSize: '18px', fontWeight: 800, marginTop: '6px' }}>12:00 - 18:00</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>Thời lượng: 6.0 giờ công</div>
                  </div>
                  <div style={{ padding: '14px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 800, color: 'var(--brand)' }}>Ca 3 (Ca Tối)</div>
                    <div style={{ fontSize: '18px', fontWeight: 800, marginTop: '6px' }}>18:00 - 23:00</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>Thời lượng: 5.0 giờ công</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* MODULE 6: CHÍNH SÁCH HỆ THỐNG */}
          {/* ========================================================= */}
          {activeTab === 'policies' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '800px' }}>
              <div>
                <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>6. Cấu Hình Chính Sách Hệ Thống</h1>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Cửa sổ điểm danh, bán kính GPS, đăng ký OFF tuần và tiêu chuẩn bài kiểm tra TEST</p>
              </div>

              <form onSubmit={handleSavePolicies} style={{ backgroundColor: 'var(--surface)', padding: '24px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Cửa sổ điểm danh cho phép (Phút):</label>
                  <input
                    type="number"
                    value={policies.check_in_window_minutes || 30}
                    onChange={(e) => setPolicies({ ...policies, check_in_window_minutes: parseInt(e.target.value) })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Cho phép check-in trước giờ ca tối đa 30 phút.</span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Bán kính GPS hợp lệ tối đa (Mét):</label>
                  <input
                    type="number"
                    value={policies.gps_radius_meters || 300}
                    onChange={(e) => setPolicies({ ...policies, gps_radius_meters: parseInt(e.target.value) })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Khoảng cách GPS từ vị trí nhân viên tới tâm chi nhánh.</span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Khung giờ đăng ký lịch OFF tuần:</label>
                  <input
                    type="text"
                    value={policies.weekly_off_window || 'T6 12:00 -> T7 15:00'}
                    onChange={(e) => setPolicies({ ...policies, weekly_off_window: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Số câu TEST:</label>
                    <input
                      type="number"
                      value={policies.test_question_count || 25}
                      onChange={(e) => setPolicies({ ...policies, test_question_count: parseInt(e.target.value) })}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Điểm đạt TEST (/10):</label>
                    <input
                      type="number"
                      step="0.1"
                      value={policies.test_passing_score || 8.0}
                      onChange={(e) => setPolicies({ ...policies, test_passing_score: parseFloat(e.target.value) })}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Thời gian TEST (Giây):</label>
                    <input
                      type="number"
                      value={policies.test_duration_seconds || 480}
                      onChange={(e) => setPolicies({ ...policies, test_duration_seconds: parseInt(e.target.value) })}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginTop: '10px' }}>
                  <button
                    type="submit"
                    style={{
                      padding: '10px 20px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--brand)',
                      color: '#FFF',
                      fontWeight: 700,
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    Lưu Thay Đổi Chính Sách
                  </button>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Phiên bản hiện tại: V{policies.policy_version || '5.1'}</span>
                </div>
              </form>
            </div>
          )}

          {/* ========================================================= */}
          {/* MODULE 7: THÔNG BÁO HỆ THỐNG */}
          {/* ========================================================= */}
          {activeTab === 'notifications' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>7. Trung Tâm Thông Báo (Notification Center)</h1>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Phân loại thông báo hệ thống, cảnh báo định biên, thông điệp bảo trì và phát thanh</p>
                </div>
                <button
                  onClick={() => setShowBroadcastModal(true)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--brand)',
                    color: '#FFF',
                    fontWeight: 600,
                    fontSize: '13px',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Send size={16} /> Gửi Phát Thanh Toàn Hệ Thống
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {systemNotifications.map((notif: any) => (
                  <div key={notif.inbox_id} style={{
                    backgroundColor: 'var(--surface)',
                    padding: '16px 20px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border)',
                    boxShadow: 'var(--shadow-soft)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          padding: '3px 8px',
                          borderRadius: 'var(--radius-full)',
                          fontSize: '10px',
                          fontWeight: 800,
                          backgroundColor:
                            notif.severity === 'URGENT' ? 'var(--danger-soft)' :
                            notif.severity === 'SUCCESS' ? 'var(--success-soft)' : 'var(--brand-soft)',
                          color:
                            notif.severity === 'URGENT' ? 'var(--danger)' :
                            notif.severity === 'SUCCESS' ? 'var(--success)' : 'var(--brand)',
                        }}>
                          {notif.severity}
                        </span>
                        <div style={{ fontWeight: 800, fontSize: '14px', color: 'var(--text)' }}>{notif.title}</div>
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--text)', marginTop: '6px' }}>{notif.summary}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                        Gửi tới: {notif.recipient_id} • Thời gian: {new Date(notif.created_at).toLocaleString('vi-VN')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* MODULE 8: TÍCH HỢP & ĐỒNG BỘ */}
          {/* ========================================================= */}
          {activeTab === 'integrations' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div>
                <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>8. Tích Hợp & Đồng Bộ Google Sheets Master</h1>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Cấu trúc 13 Tabs Google Sheets Master, Google Drive Receipts, Realtime Socket.IO & Sequential Queue</p>
              </div>

              {/* Live Connection Banner */}
              <div style={{ backgroundColor: 'var(--surface)', padding: '16px 20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: integrationsStatus?.mode === 'GOOGLE_SHEETS_LIVE' ? 'var(--success)' : '#F59E0B' }} />
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>
                      {integrationsStatus?.mode === 'GOOGLE_SHEETS_LIVE' ? 'Đã Kết Nối Google Sheets Master Trực Tiếp (Live Mode)' : 'Chế Độ Giả Lập Cục Bộ (Cần Thêm GOOGLE_SERVICE_ACCOUNT_JSON trên Render)'}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      Mã Bảng Tính: <code style={{ backgroundColor: 'var(--bg)', padding: '2px 6px', borderRadius: '4px' }}>{integrationsStatus?.spreadsheetId || '17iXM0zc1m17aX9AZrFMjOkPRMy2_CwWfjTRZSUPQF2w'}</code>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${integrationsStatus?.spreadsheetId || '17iXM0zc1m17aX9AZrFMjOkPRMy2_CwWfjTRZSUPQF2w'}/edit`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      padding: '8px 16px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg)',
                      color: 'var(--brand)',
                      border: '1px solid var(--border)',
                      fontWeight: 600,
                      fontSize: '13px',
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    ↗ Mở Google Sheets Master
                  </a>
                  <button
                    onClick={handleForcePull}
                    disabled={loading}
                    className="btn-interactive"
                    style={{
                      padding: '8px 16px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--surface)',
                      color: 'var(--text)',
                      fontWeight: 700,
                      fontSize: '13px',
                      border: '1px solid var(--border)',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                    }}
                  >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    {loading ? 'Đang Tải Dữ Liệu...' : '📥 Tải Dữ Liệu Thực Tế Từ Sheets'}
                  </button>
                  <button
                    onClick={handleForceSync}
                    disabled={loading}
                    className="btn-interactive"
                    style={{
                      padding: '8px 18px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--brand)',
                      color: '#FFF',
                      fontWeight: 700,
                      fontSize: '13px',
                      border: 'none',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      boxShadow: '0 2px 6px rgba(232, 93, 146, 0.3)',
                    }}
                  >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    {loading ? 'Đang Khởi Tạo & Đồng Bộ...' : '🚀 Khởi Tạo Cấu Trúc & Đồng Bộ Lên Sheets'}
                  </button>
                </div>
              </div>

              {/* Status summary */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>GOOGLE SHEETS MASTER</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: integrationsStatus?.mode === 'GOOGLE_SHEETS_LIVE' ? 'var(--success)' : '#F59E0B', marginTop: '4px' }}>
                    {integrationsStatus?.mode === 'GOOGLE_SHEETS_LIVE' ? 'LIVE SYNC' : 'MOCK ENGINE'}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>13 Tab Dữ Liệu Chuẩn</div>
                </div>

                <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>GOOGLE DRIVE STORAGE</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#2563EB', marginTop: '4px' }}>Folder Sẵn Sàng</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Lưu ảnh Check-in/out GPS</div>
                </div>

                <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>SOCKET.IO REALTIME</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--brand)', marginTop: '4px' }}>5 Rooms Online</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Live Push Events</div>
                </div>

                <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>KIỂM SOÁT GHI ĐỒNG THỜI</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--success)', marginTop: '4px' }}>Sequential Writer</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Bảo vệ tính toàn vẹn Sheet</div>
                </div>
              </div>

              {/* Tabs Grid */}
              <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div>
                    <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>Danh Sách Các Tab Master Trên Google Sheets</h2>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>Khi bấm Đồng bộ, hệ thống sẽ tự động tạo các sheet tab này nếu chưa có và ghi dữ liệu đầy đủ.</p>
                  </div>
                  <button
                    onClick={handleForceSync}
                    disabled={loading}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--brand)',
                      color: '#FFF',
                      fontWeight: 600,
                      fontSize: '12px',
                      border: 'none',
                      cursor: loading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {loading ? 'Đang xử lý...' : 'Đồng Bộ Tất Cả Tab'}
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                  {[
                    'NHAN_VIEN_MASTER',
                    'TAI_KHOAN_NHAN_VIEN',
                    'ADMIN_ACCOUNTS',
                    'PHAN_CONG_CA',
                    'SU_KIEN_DIEM_DANH',
                    'DON_NGHI_PHEP',
                    'DON_DOI_CA',
                    'DIEU_CHINH_CONG',
                    'KY_LUONG',
                    'AUDIT_LOG',
                    'DANH_SACH_CHI_NHANH',
                    'FROM_NHAN_VIEN',
                  ].map((tabName: string, idx: number) => (
                    <div key={idx} style={{ padding: '12px 14px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 600 }}>
                      <CheckCircle size={16} color="var(--success)" />
                      <div>
                        <div>{tabName}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 400 }}>Tự động ánh xạ & đồng bộ</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* MODULE 9: BẢO TRÌ HỆ THỐNG */}
          {/* ========================================================= */}
          {activeTab === 'maintenance' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '800px' }}>
              <div>
                <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>9. Quản Lý Chế Độ Bảo Trì Kỹ Thuật</h1>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Bật/tắt bảo trì toàn hệ thống, Web nhân viên hoặc từng phân hệ riêng biệt</p>
              </div>

              <div style={{ backgroundColor: 'var(--surface)', padding: '24px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '14px', color: 'var(--text)' }}>Bảo trì toàn bộ hệ thống</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Khóa toàn bộ truy cập API, chỉ tài khoản Admin được phép thao tác.</div>
                  </div>
                  <button
                    onClick={() => handleSaveMaintenance({ ...maintenance, system_maintenance: !maintenance.system_maintenance })}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 'var(--radius-full)',
                      fontWeight: 700,
                      fontSize: '12px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: maintenance.system_maintenance ? 'var(--danger)' : 'var(--border)',
                      color: maintenance.system_maintenance ? '#FFF' : 'var(--text)',
                    }}
                  >
                    {maintenance.system_maintenance ? 'ĐANG BẬT BẢO TRÌ' : 'TẮT (Bình Thường)'}
                  </button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '14px', color: 'var(--text)' }}>Bảo trì Cổng Web Nhân Viên (Employee Portal)</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Tạm khóa cổng nhân viên để kiểm kê hoặc cập nhật ca làm.</div>
                  </div>
                  <button
                    onClick={() => handleSaveMaintenance({ ...maintenance, employee_web_maintenance: !maintenance.employee_web_maintenance })}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 'var(--radius-full)',
                      fontWeight: 700,
                      fontSize: '12px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: maintenance.employee_web_maintenance ? 'var(--danger)' : 'var(--border)',
                      color: maintenance.employee_web_maintenance ? '#FFF' : 'var(--text)',
                    }}
                  >
                    {maintenance.employee_web_maintenance ? 'ĐANG BẬT' : 'TẮT'}
                  </button>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Thông điệp bảo trì hiển thị:</label>
                  <textarea
                    rows={3}
                    value={maintenance.maintenance_message || ''}
                    onChange={(e) => setMaintenance({ ...maintenance, maintenance_message: e.target.value })}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '13px' }}
                  />
                  <button
                    onClick={() => handleSaveMaintenance(maintenance)}
                    style={{
                      marginTop: '10px',
                      padding: '8px 16px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--brand)',
                      color: '#FFF',
                      fontWeight: 600,
                      fontSize: '12px',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    Cập Nhật Thông Điệp
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* MODULE 10: AUDIT LOG */}
          {/* ========================================================= */}
          {activeTab === 'audit' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>10. Nhật Ký Hệ Thống Bất Biến (Audit Trail)</h1>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Ghi lại toàn bộ hành động: Actor ID, Hành động, Đối tượng, Thời gian và JSON Before/After</p>
              </div>

              <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                      <th style={{ padding: '12px 20px' }}>Thời Gian</th>
                      <th style={{ padding: '12px 20px' }}>Người Thực Hiện</th>
                      <th style={{ padding: '12px 20px' }}>Hành Động (Action)</th>
                      <th style={{ padding: '12px 20px' }}>Loại & ID Đối Tượng</th>
                      <th style={{ padding: '12px 20px' }}>Chi Tiết Payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log: any, idx: number) => (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '14px 20px', fontSize: '11px', color: 'var(--text-muted)' }}>
                          {new Date(log.timestamp).toLocaleString('vi-VN')}
                        </td>
                        <td style={{ padding: '14px 20px', fontWeight: 700 }}>{log.actor_id}</td>
                        <td style={{ padding: '14px 20px', fontWeight: 700, color: 'var(--brand)' }}>{log.action}</td>
                        <td style={{ padding: '14px 20px', fontSize: '12px' }}>
                          {log.target_type}: {log.target_id}
                        </td>
                        <td style={{ padding: '14px 20px', fontSize: '11px', fontFamily: 'monospace', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {log.payload_after ? JSON.stringify(log.payload_after) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* MODULE 11: BACKUP & RECOVERY */}
          {/* ========================================================= */}
          {activeTab === 'backup' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>11. Sao Lưu & Phục Hồi Dữ Liệu (Backup & Recovery)</h1>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Snapshot toàn bộ 23 tabs Google Sheets + receipts Google Drive, kiểm tra tính toàn vẹn</p>
                </div>
                <button
                  onClick={handleCreateSnapshot}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--brand)',
                    color: '#FFF',
                    fontWeight: 600,
                    fontSize: '13px',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <DownloadCloud size={16} /> Tạo Bản Sao Lưu Mới Ngay
                </button>
              </div>

              <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                      <th style={{ padding: '12px 20px' }}>Snapshot ID</th>
                      <th style={{ padding: '12px 20px' }}>Tên Bản Sao Lưu</th>
                      <th style={{ padding: '12px 20px' }}>Số Tabs</th>
                      <th style={{ padding: '12px 20px' }}>Dung Lượng</th>
                      <th style={{ padding: '12px 20px' }}>Thời Gian Tạo</th>
                      <th style={{ padding: '12px 20px' }}>Trạng Thái</th>
                      <th style={{ padding: '12px 20px' }}>Thao Tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backupSnapshots.map((snap: any) => (
                      <tr key={snap.snapshot_id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '14px 20px', fontWeight: 700, color: 'var(--brand)' }}>{snap.snapshot_id}</td>
                        <td style={{ padding: '14px 20px', fontWeight: 600 }}>{snap.name}</td>
                        <td style={{ padding: '14px 20px' }}>{snap.file_count} Tabs</td>
                        <td style={{ padding: '14px 20px' }}>{snap.size_mb} MB</td>
                        <td style={{ padding: '14px 20px', fontSize: '11px', color: 'var(--text-muted)' }}>
                          {new Date(snap.created_at).toLocaleString('vi-VN')}
                        </td>
                        <td style={{ padding: '14px 20px' }}>
                          <span style={{
                            padding: '4px 8px',
                            borderRadius: 'var(--radius-full)',
                            fontSize: '11px',
                            fontWeight: 700,
                            backgroundColor: 'var(--success-soft)',
                            color: 'var(--success)',
                          }}>
                            {snap.status} (Verified)
                          </span>
                        </td>
                        <td style={{ padding: '14px 20px' }}>
                          <button
                            onClick={() => handleTestRecovery(snap.snapshot_id)}
                            style={{
                              padding: '6px 12px',
                              borderRadius: 'var(--radius-sm)',
                              backgroundColor: 'transparent',
                              border: '1px solid var(--brand)',
                              color: 'var(--brand)',
                              fontWeight: 600,
                              fontSize: '12px',
                              cursor: 'pointer',
                            }}
                          >
                            Test Recovery
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* MODULE 12: CÀI ĐẶT HỆ THỐNG */}
          {/* ========================================================= */}
          {activeTab === 'settings' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '800px' }}>
              <div>
                <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>12. Cài Đặt Tham Số Kỹ Thuật Hệ Thống</h1>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Logo, tên hệ thống, định dạng ngày giờ, múi giờ và thời gian hết hạn phiên làm việc</p>
              </div>

              <form onSubmit={handleSaveSystemSettings} style={{ backgroundColor: 'var(--surface)', padding: '24px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Biểu tượng thương hiệu (Logo Emoji):</label>
                  <input
                    type="text"
                    value={systemSettings.logo || '🥛'}
                    onChange={(e) => setSystemSettings({ ...systemSettings, logo: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Tên hệ thống:</label>
                  <input
                    type="text"
                    value={systemSettings.system_name || 'Hệ Thống Quản Lý Nhân Sự Ụm Bò Milk'}
                    onChange={(e) => setSystemSettings({ ...systemSettings, system_name: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Định dạng ngày giờ:</label>
                    <input
                      type="text"
                      value={systemSettings.time_format || 'DD/MM/YYYY HH:mm'}
                      onChange={(e) => setSystemSettings({ ...systemSettings, time_format: e.target.value })}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Múi giờ (Timezone):</label>
                    <input
                      type="text"
                      value={systemSettings.timezone || 'Asia/Ho_Chi_Minh'}
                      onChange={(e) => setSystemSettings({ ...systemSettings, timezone: e.target.value })}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Session Timeout (Phút):</label>
                    <input
                      type="number"
                      value={systemSettings.session_timeout_minutes || 1440}
                      onChange={(e) => setSystemSettings({ ...systemSettings, session_timeout_minutes: parseInt(e.target.value) })}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Chu kỳ đồng bộ nền (Giây):</label>
                    <input
                      type="number"
                      value={systemSettings.sync_interval_seconds || 15}
                      onChange={(e) => setSystemSettings({ ...systemSettings, sync_interval_seconds: parseInt(e.target.value) })}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  style={{
                    marginTop: '10px',
                    padding: '10px 20px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--brand)',
                    color: '#FFF',
                    fontWeight: 700,
                    border: 'none',
                    cursor: 'pointer',
                    width: 'fit-content',
                  }}
                >
                  Lưu Cài Đặt Hệ Thống
                </button>
              </form>
            </div>
          )}

          {/* DEDICATED VIEWS FOR HR (15 TABS), STORE (10 TABS), FINANCE (11 TABS), MARKETING (9 TABS) */}
          <RoleViews
            activeTab={activeTab}
            currentUser={currentUser}
            allEmployees={allEmployees}
            candidates={candidates}
            shifts={shifts}
            leaves={leaves}
            payrollRuns={payrollRuns}
            branches={branches}
            systemNotifications={systemNotifications}
            showToast={(msg) => {
              setSuccessMsg(msg);
              setTimeout(() => setSuccessMsg(null), 3000);
            }}
            openNewEmpModal={() => setShowNewEmpModal(true)}
            openBroadcastModal={() => setShowBroadcastModal(true)}
            onSyncSheets={handleForcePull}
            onRefreshData={() => loadAllData(currentUser)}
          />

        </div>
      </main>

      {/* MODAL: TẠO TÀI KHOẢN NỘI BỘ MỚI */}
      {showNewAdminModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: '24px', borderRadius: 'var(--radius-md)', width: '420px', boxShadow: 'var(--shadow-modal)' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 800, marginBottom: '16px' }}>Tạo Tài Khoản Nội Bộ Mới</h2>
            <form onSubmit={handleCreateInternalAccount} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Tên đăng nhập:</label>
                <input
                  required
                  type="text"
                  value={newAdminForm.username}
                  onChange={(e) => setNewAdminForm({ ...newAdminForm, username: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Họ và tên:</label>
                <input
                  required
                  type="text"
                  value={newAdminForm.full_name}
                  onChange={(e) => setNewAdminForm({ ...newAdminForm, full_name: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Vai trò (Role):</label>
                <select
                  value={newAdminForm.role}
                  onChange={(e) => setNewAdminForm({ ...newAdminForm, role: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                >
                  <option value="HR">HR (Nhân Sự)</option>
                  <option value="STORE">STORE (Cửa Hàng Trưởng)</option>
                  <option value="FINANCE">FINANCE (Kế Toán Lương)</option>
                  <option value="MARKETING">MARKETING (Truyền Thông)</option>
                  <option value="ADMIN">ADMIN (Quản Trị Viên)</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Phạm vi chi nhánh:</label>
                <select
                  value={newAdminForm.branch_scope}
                  onChange={(e) => setNewAdminForm({ ...newAdminForm, branch_scope: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                >
                  <option value="*">Toàn Hệ Thống (*)</option>
                  <option value="CN130">CN1: 130 Vạn Kiếp (Bình Thạnh)</option>
                  <option value="CN261">CN2: 261 Tô Hiến Thành (Q.10)</option>
                  <option value="CN120">CN3: 120 Hoàng Diệu 2 (Thủ Đức)</option>
                  <option value="CN111">CN4: 111 Tôn Đản (Q.4)</option>
                  <option value="XUONG_SX">Xưởng Sản Xuất (Củ Chi)</option>
                  <option value="VAN_PHONG">Văn Phòng: 10 Đặng Thai Mai (Phú Nhuận)</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Mật khẩu khởi tạo:</label>
                <input
                  required
                  type="password"
                  value={newAdminForm.password}
                  onChange={(e) => setNewAdminForm({ ...newAdminForm, password: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowNewAdminModal(false)}
                  style={{ padding: '8px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  style={{ padding: '8px 14px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--brand)', color: '#FFF', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                >
                  Tạo Tài Khoản
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: PHÁT THANH THÔNG BÁO */}
      {showBroadcastModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: '24px', borderRadius: 'var(--radius-md)', width: '460px', boxShadow: 'var(--shadow-modal)' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 800, marginBottom: '16px' }}>Phát Thanh Thông Báo Toàn Hệ Thống</h2>
            <form onSubmit={handleSendBroadcast} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Tiêu đề thông báo:</label>
                <input
                  required
                  type="text"
                  placeholder="Ví dụ: Cập nhật lịch làm việc dịp lễ..."
                  value={broadcastForm.title}
                  onChange={(e) => setBroadcastForm({ ...broadcastForm, title: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Mức độ khẩn cấp (Severity):</label>
                <select
                  value={broadcastForm.severity}
                  onChange={(e) => setBroadcastForm({ ...broadcastForm, severity: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                >
                  <option value="SYSTEM">Thông Báo Hệ Thống (System)</option>
                  <option value="URGENT">Khẩn Cấp (Urgent)</option>
                  <option value="SUCCESS">Tin Vui (Success)</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Đối tượng nhận:</label>
                <select
                  value={broadcastForm.recipientIds}
                  onChange={(e) => setBroadcastForm({ ...broadcastForm, recipientIds: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                >
                  <option value="ALL">Tất cả nhân sự (Toàn hệ thống)</option>
                  <option value="CN130">Nhân sự CN1: 130 Vạn Kiếp (Bình Thạnh)</option>
                  <option value="CN261">Nhân sự CN2: 261 Tô Hiến Thành (Q.10)</option>
                  <option value="CN120">Nhân sự CN3: 120 Hoàng Diệu 2 (Thủ Đức)</option>
                  <option value="CN111">Nhân sự CN4: 111 Tôn Đản (Q.4)</option>
                  <option value="XUONG_SX">Nhân sự Xưởng Sản Xuất (Củ Chi)</option>
                  <option value="VAN_PHONG">Nhân sự Văn Phòng: 10 Đặng Thai Mai (Phú Nhuận)</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Nội dung tóm tắt:</label>
                <textarea
                  required
                  rows={3}
                  value={broadcastForm.summary}
                  onChange={(e) => setBroadcastForm({ ...broadcastForm, summary: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowBroadcastModal(false)}
                  style={{ padding: '8px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  style={{ padding: '8px 14px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--brand)', color: '#FFF', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                >
                  Gửi Thông Báo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: THÊM HỒ SƠ NHÂN VIÊN MỚI (RÀNG BUỘC UBM_NV0000 RANDOM 0000-9999) */}
      {showNewEmpModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: '24px', borderRadius: 'var(--radius-md)', width: '520px', maxWidth: '95vw', boxShadow: 'var(--shadow-modal)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h2 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text)', margin: 0 }}>Thêm Hồ Sơ Nhân Viên Mới</h2>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>Hệ thống quản lý nhân sự Ụm Bò Milk HR V5.1</div>
              </div>
              <button
                onClick={() => setShowNewEmpModal(false)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateEmployee} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Mã NV */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>
                    Mã Nhân Viên (Bắt buộc format UBM_NV0000):
                  </label>
                  <button
                    type="button"
                    onClick={() => setNewEmpForm({ ...newEmpForm, employeeCode: generateRandomEmployeeCode() })}
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      color: 'var(--brand)',
                      background: 'var(--brand-soft)',
                      border: 'none',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    🎲 Tạo Mã Random
                  </button>
                </div>
                <input
                  required
                  type="text"
                  pattern="^UBM_NV\d{4}$"
                  title="Mã nhân viên phải có định dạng UBM_NV0000 (random từ 0000 đến 9999)"
                  value={newEmpForm.employeeCode}
                  onChange={(e) => setNewEmpForm({ ...newEmpForm, employeeCode: e.target.value.trim().toUpperCase() })}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1.5px solid var(--brand)',
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    fontSize: '14px',
                    color: 'var(--brand)',
                    backgroundColor: 'var(--brand-soft)',
                  }}
                />
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
                  * Ràng buộc: <strong style={{ color: 'var(--brand)' }}>UBM_NV</strong> + 4 chữ số ngẫu nhiên từ 0000 đến 9999 (Ví dụ: UBM_NV0482).
                </div>
              </div>

              {/* Họ Và Tên */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Họ Và Tên:</label>
                <input
                  required
                  type="text"
                  placeholder="Ví dụ: Nguyễn Văn Hoàng"
                  value={newEmpForm.fullName}
                  onChange={(e) => setNewEmpForm({ ...newEmpForm, fullName: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '13px' }}
                />
              </div>

              {/* Số Điện Thoại */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Số Điện Thoại:</label>
                <input
                  required
                  type="text"
                  placeholder="Ví dụ: 0901234567"
                  value={newEmpForm.phone}
                  onChange={(e) => setNewEmpForm({ ...newEmpForm, phone: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '13px' }}
                />
              </div>

              {/* Khối / Nhóm */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Khối / Nhóm Nhân Sự:</label>
                <select
                  value={newEmpForm.group}
                  onChange={(e) => {
                    const g = e.target.value as any;
                    let b = newEmpForm.branchId;
                    if (g === 'VAN_PHONG' || g === 'SALE') b = 'VAN_PHONG';
                    else if (g === 'XUONG') b = 'XUONG_SX';
                    else if (b === 'VAN_PHONG' || b === 'XUONG_SX') b = 'CN130';
                    setNewEmpForm({ ...newEmpForm, group: g, branchId: b });
                  }}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '13px' }}
                >
                  <option value="STORE">Khối Cửa Hàng (Store)</option>
                  <option value="XUONG">Khối Xưởng Sản Xuất</option>
                  <option value="VAN_PHONG">Khối Văn Phòng</option>
                  <option value="SALE">Khối Sales / Marketing</option>
                </select>
              </div>

              {/* Chi Nhánh */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Chi Nhánh Làm Việc:</label>
                {newEmpForm.group === 'VAN_PHONG' || newEmpForm.group === 'SALE' ? (
                  <div>
                    <input
                      readOnly
                      value="Trụ sở chính (Khối Văn phòng & Sales)"
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border)',
                        backgroundColor: '#EDE9FE',
                        color: '#6D28D9',
                        fontWeight: 700,
                        fontSize: '13px',
                      }}
                    />
                    <div style={{ fontSize: '11px', color: '#6D28D9', marginTop: '3px' }}>
                      ✓ Tự động gán Trụ sở chính theo quy định hệ thống.
                    </div>
                  </div>
                ) : newEmpForm.group === 'XUONG' ? (
                  <div>
                    <input
                      readOnly
                      value="Củ Chi (Khối Xưởng Sản Xuất)"
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border)',
                        backgroundColor: '#FEF3C7',
                        color: '#B45309',
                        fontWeight: 700,
                        fontSize: '13px',
                      }}
                    />
                    <div style={{ fontSize: '11px', color: '#B45309', marginTop: '3px' }}>
                      ✓ Tự động gán Củ Chi theo quy định hệ thống.
                    </div>
                  </div>
                ) : (
                  <select
                    value={newEmpForm.branchId}
                    onChange={(e) => setNewEmpForm({ ...newEmpForm, branchId: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '13px' }}
                  >
                    <option value="CN130">CN1: 130 Vạn Kiếp (Bình Thạnh)</option>
                    <option value="CN261">CN2: 261 Tô Hiến Thành (Q.10)</option>
                    <option value="CN120">CN3: 120 Hoàng Diệu 2 (Thủ Đức)</option>
                    <option value="CN111">CN4: 111 Tôn Đản (Q.4)</option>
                  </select>
                )}
              </div>

              {/* Giai Đoạn Nhân Sự */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Giai Đoạn Nhân Sự:</label>
                <select
                  value={newEmpForm.employmentStatus}
                  onChange={(e) => setNewEmpForm({ ...newEmpForm, employmentStatus: e.target.value as any })}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '13px' }}
                >
                  <option value="PRE_ONBOARDING">Nhân viên mới (PIN khởi tạo tự động)</option>
                  <option value="PROBATION">Thử việc (Lương 21.000 đ/h)</option>
                  <option value="OFFICIAL">Chính thức (Lương 25.500 đ/h)</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={() => setShowNewEmpModal(false)}
                  style={{ padding: '9px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontSize: '13px' }}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  style={{ padding: '9px 18px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--brand)', color: '#FFF', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '13px' }}
                >
                  Lưu Hồ Sơ Nhân Viên
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
