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
  Unlock,
  ExternalLink,
  Settings,
  HardDrive,
  Activity,
  Sliders,
  FileCheck,
  Search,
  Filter,
  RefreshCw,
  Info,
  Server,
  DownloadCloud,
  LogOut,
  Eye,
  EyeOff,
  UserCheck,
  Briefcase,
  Store,
  FileText,
  CreditCard,
  Radio,
  FileSpreadsheet,
  Award
} from 'lucide-react';
import { RoleViews } from './components/RoleViews';

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
    { id: 'activation', label: '3. Kích hoạt tài khoản NV', icon: FileCheck },
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
    { id: 'hr-candidates', label: '2. Ứng viên mới', icon: UserCheck },
    { id: 'hr-interviews', label: '3. Phỏng vấn', icon: Calendar },
    { id: 'hr-probation', label: '4. Nhân viên Thử việc', icon: Users },
    { id: 'hr-official', label: '5. Nhân viên Chính thức', icon: Users },
    { id: 'hr-conversion', label: '6. Chuyển Chính thức', icon: Award },
    { id: 'hr-schedule', label: '7. Lịch làm việc', icon: Calendar },
    { id: 'hr-leave', label: '8. Nghỉ OFF', icon: Clock },
    { id: 'hr-swap', label: '9. Đổi ca', icon: RefreshCw },
    { id: 'hr-emergency', label: '10. Nghỉ đột xuất', icon: AlertTriangle },
    { id: 'hr-attendance', label: '11. Chấm công', icon: CheckCircle },
    { id: 'hr-adjustments', label: '12. Bổ sung/Điều chỉnh công', icon: FileText },
    { id: 'hr-tests', label: '13. TEST nhân viên', icon: FileCheck },
    { id: 'hr-reports', label: '14. Báo cáo HR', icon: FileSpreadsheet },
    { id: 'hr-notifications', label: '15. Thông báo', icon: Bell },
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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

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

  // Filters & Search
  const [empSearch, setEmpSearch] = useState('');
  const [empGroupFilter, setEmpGroupFilter] = useState('ALL');
  const [empBranchFilter, setEmpBranchFilter] = useState('ALL');
  const [accountSearch, setAccountSearch] = useState('');
  const [accountStatusFilter, setAccountStatusFilter] = useState('ALL');

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

  // Sub-tabs for Module 3: Kích Hoạt & Quản Lý Tài Khoản Nhân Viên (Mặc định 'ALL' để luôn hiển thị đầy đủ nhân sự hệ thống)
  const [activationSubTab, setActivationSubTab] = useState<'ALL' | 'NEW' | 'PROBATION' | 'OFFICIAL' | 'VAN_PHONG' | 'XUONG' | 'SALE' | 'SUSPENDED'>('ALL');

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
    try {
      const finalBranch = (newEmpForm.group === 'VAN_PHONG' || newEmpForm.group === 'SALE')
        ? 'VAN_PHONG'
        : (newEmpForm.group === 'XUONG' ? 'XUONG_SX' : newEmpForm.branchId);

      await apiRequest('/employees', {
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
      setSuccessMsg(`Đã tạo thành công hồ sơ nhân viên mới với mã ${newEmpForm.employeeCode}!`);
      setTimeout(() => setSuccessMsg(null), 3000);
      await loadAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
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
        : err.message);
    } finally {
      setLoading(false);
    }
  };

  // Handle Logout
  const handleLogout = () => {
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

  const loadAllData = async (user = currentUser) => {
    if (!user) return;
    try {
      // 1. Dashboard stats
      const stats = await apiRequest('/admin/dashboard/stats').catch(() => null);
      if (stats) setDashboardStats(stats);

      // 2. Internal accounts
      if (user.role === 'ADMIN') {
        const iAccs = await apiRequest('/admin/internal-accounts').catch(() => []);
        setInternalAccounts(iAccs);
      }

      // 3. Employee accounts
      if (['ADMIN', 'HR'].includes(user.role)) {
        const eAccs = await apiRequest('/admin/employee-accounts').catch(() => []);
        setEmployeeAccounts(eAccs);
      }

      // 4. Employees
      if (['ADMIN', 'HR', 'STORE'].includes(user.role)) {
        const emps = await apiRequest('/employees').catch(() => []);
        setAllEmployees(emps);
      }

      // 5. Branches & Shifts
      const bList = await apiRequest('/admin/branches').catch(() => []);
      setBranches(bList);
      const sTemplates = await apiRequest('/admin/shift-templates').catch(() => ({}));
      setShiftTemplates(sTemplates);

      // Schedules & Leaves
      const sList = await apiRequest('/schedules').catch(() => []);
      setShifts(sList);
      const lList = await apiRequest('/leave-requests').catch(() => []);
      setLeaves(lList);

      // Candidates
      if (['ADMIN', 'HR'].includes(user.role)) {
        const cList = await apiRequest('/applications').catch(() => []);
        setCandidates(cList);
      }

      // Payroll
      if (['ADMIN', 'FINANCE'].includes(user.role)) {
        const pList = await apiRequest('/payroll/runs').catch(() => []);
        setPayrollRuns(pList);
      }

      // 6. Policies
      const pData = await apiRequest('/admin/policies').catch(() => ({}));
      setPolicies(pData);

      // 7. Notifications
      const notifs = await apiRequest('/admin/notifications').catch(() => []);
      setSystemNotifications(notifs);

      // 8. Integrations
      if (user.role === 'ADMIN') {
        const integ = await apiRequest('/admin/integrations/status').catch(() => null);
        setIntegrationsStatus(integ);
      }

      // 9. Maintenance
      const mData = await apiRequest('/admin/maintenance').catch(() => ({}));
      setMaintenance(mData);

      // 10. Audit
      if (['ADMIN', 'HR'].includes(user.role)) {
        const logs = await apiRequest('/admin/audit').catch(() => []);
        setAuditLogs(logs);
      }

      // 11. Backup
      if (user.role === 'ADMIN') {
        const snaps = await apiRequest('/admin/backup/snapshots').catch(() => []);
        setBackupSnapshots(snaps);
      }

      // 12. Settings
      const sSettings = await apiRequest('/admin/system-settings').catch(() => ({}));
      setSystemSettings(sSettings);

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
  // Gộp nhiều event dồn dập thành 1 lần tải (debounce 800ms) + chống tải chồng chéo.
  const socketConnectedRef = useRef(false);
  const reloadTimerRef = useRef<any>(null);
  const reloadingRef = useRef(false);
  const scheduleReload = (user = currentUser) => {
    if (reloadTimerRef.current) return;
    reloadTimerRef.current = setTimeout(async () => {
      reloadTimerRef.current = null;
      if (reloadingRef.current) {
        scheduleReload(user);
        return;
      }
      reloadingRef.current = true;
      try {
        await loadAllData(user);
      } finally {
        reloadingRef.current = false;
      }
    }, 800);
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

      socket.on('account.activated', () => scheduleReload(currentUser));
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
  }, [currentUser]);

  // 2. Poll dự phòng: chỉ khi socket mất kết nối (giảm tải server, mặc định realtime qua socket)
  useEffect(() => {
    if (!currentUser) return;

    const interval = setInterval(() => {
      if (
        !socketConnectedRef.current &&
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible'
      ) {
        scheduleReload(currentUser);
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [currentUser]);

  // Action handlers
  const handleActivateEmpAccount = async (id: string, ver: number) => {
    try {
      await apiRequest(`/admin/employee-accounts/${id}/activate`, {
        method: 'POST',
        body: JSON.stringify({ expectedVersion: ver }),
      });
      setSuccessMsg('Kích hoạt tài khoản nhân viên thành công!');
      setTimeout(() => setSuccessMsg(null), 3000);
      await loadAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleRevokeEmpAccount = async (id: string, ver: number, status: 'SUSPENDED' | 'REVOKED') => {
    try {
      await apiRequest(`/admin/employee-accounts/${id}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ expectedVersion: ver, status }),
      });
      setSuccessMsg(`Đã chuyển trạng thái tài khoản thành ${status}!`);
      setTimeout(() => setSuccessMsg(null), 3000);
      await loadAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  // HR cấp mới / reset mã PIN đăng nhập cho nhân viên (4-8 chữ số).
  // Dùng cho cả 2 trường hợp: cấp lần đầu và nhân viên QUÊN PIN (cấp lại số mới,
  // PIN cũ + mọi phiên đăng nhập cũ tự vô hiệu ngay). Hệ thống tự sinh PIN
  // ngẫu nhiên 4 số điền sẵn — HR copy gửi NV, OK để cấp.
  const handleSetEmpPin = async (id: string, fullName: string) => {
    const randomPin = String(1000 + Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
    const pin = window.prompt(
      `Cấp / RESET mã PIN cho ${fullName}.\nHệ thống đã tạo sẵn PIN ngẫu nhiên bên dưới — COPY gửi nhân viên TRƯỚC khi bấm OK!\nLưu ý: PIN cũ (nếu có) và mọi phiên đăng nhập của NV sẽ bị vô hiệu ngay. NV phải đổi PIN ở lần đăng nhập tiếp theo. Trao trực tiếp, KHÔNG gửi qua nhóm chat!`,
      randomPin
    );
    if (pin === null) return;
    if (!/^\d{4,8}$/.test(pin.trim())) {
      setErrorMsg('Mã PIN phải gồm 4-8 chữ số!');
      return;
    }
    try {
      await apiRequest(`/admin/employee-accounts/${id}/set-pin`, {
        method: 'POST',
        body: JSON.stringify({ pin: pin.trim() }),
      });
      setSuccessMsg(`Đã cấp mã PIN mới cho ${fullName}! Nhớ trao trực tiếp cho nhân viên.`);
      setTimeout(() => setSuccessMsg(null), 4000);
      await loadAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleToggleInternalAccount = async (account: any) => {
    try {
      await apiRequest(`/admin/internal-accounts/${account.admin_id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !account.is_active }),
      });
      setSuccessMsg(`Đã ${account.is_active ? 'khóa' : 'mở khóa'} tài khoản ${account.username}!`);
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
          is_active: true,
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
      await loadAllData();
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
      await loadAllData();
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
        // Dữ liệu thật: chưa có tài khoản thì báo NO_ACCOUNT, KHÔNG giả ACTIVE.
        accountStatus: acc?.account_status || 'NO_ACCOUNT',
        activatedAt: acc?.activated_at,
        activatedBy: acc?.activated_by,
        revokedAt: acc?.revoked_at,
        version: acc?.version || emp.version || 1,
        hasRealAccount: !!acc,
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
          accountStatus: acc.account_status,
          activatedAt: acc.activated_at,
          activatedBy: acc.activated_by,
          revokedAt: acc.revoked_at,
          version: acc.version || 1,
          hasRealAccount: true,
        });
      }
    });

    return items;
  }, [allEmployees, employeeAccounts]);

  const filteredActivationItems = useMemo(() => {
    return activationDataList.filter(item => {
      // Sub-tab filter
      let matchSubTab = true;
      if (activationSubTab === 'ALL') {
        matchSubTab = true;
      } else if (activationSubTab === 'NEW') {
        matchSubTab = item.employmentStatus === 'PRE_ONBOARDING' || item.accountStatus === 'PENDING_ACTIVATION' || item.accountStatus === 'NO_ACCOUNT';
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
      } else if (activationSubTab === 'SUSPENDED') {
        matchSubTab = item.accountStatus === 'SUSPENDED' || item.accountStatus === 'REVOKED';
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
  const countNew = activationDataList.filter(i => i.employmentStatus === 'PRE_ONBOARDING' || i.accountStatus === 'PENDING_ACTIVATION' || i.accountStatus === 'NO_ACCOUNT').length;
  const countProbation = activationDataList.filter(i => i.employmentStatus === 'PROBATION').length;
  const countOfficial = activationDataList.filter(i => i.employmentStatus === 'OFFICIAL').length;
  const countOffice = activationDataList.filter(i => i.group === 'VAN_PHONG').length;
  const countFactory = activationDataList.filter(i => i.group === 'XUONG').length;
  const countSales = activationDataList.filter(i => i.group === 'SALE').length;
  const countSuspended = activationDataList.filter(i => i.accountStatus === 'SUSPENDED' || i.accountStatus === 'REVOKED').length;

  // Filtered employee accounts (legacy fallback)
  const filteredAccounts = employeeAccounts.filter(acc => {
    const matchSearch = accountSearch === '' ||
      acc.phone_normalized?.includes(accountSearch) ||
      acc.employee_id?.toLowerCase().includes(accountSearch.toLowerCase());
    const matchStatus = accountStatusFilter === 'ALL' || acc.account_status === accountStatusFilter;
    return matchSearch && matchStatus;
  });

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
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  color: 'var(--text)',
                }}
              >
                <RefreshCw size={14} />
                Đồng Bộ Sheets 23 Tabs
              </button>
            )}

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
            }}>
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

        {/* NOTIFICATION MESSAGES */}
        {errorMsg && (
          <div style={{ padding: '12px 24px', backgroundColor: 'var(--danger-soft)', color: 'var(--danger)', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Lỗi: {errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--danger)' }}><X size={16} /></button>
          </div>
        )}
        {successMsg && (
          <div style={{ padding: '12px 24px', backgroundColor: 'var(--success-soft)', color: 'var(--success)', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
                  onClick={() => loadAllData()}
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
                  <RefreshCw size={14} /> Tải Lại Số Liệu
                </button>
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
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>CHỜ KÍCH HOẠT SĐT</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: dashboardStats?.kpis?.pendingActivationCount > 0 ? 'var(--danger)' : 'var(--success)', marginTop: '6px' }}>
                    {dashboardStats?.kpis?.pendingActivationCount ?? 0}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Cần Admin/HR kích hoạt</div>
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
                            backgroundColor: acc.is_active ? 'var(--success-soft)' : 'var(--danger-soft)',
                            color: acc.is_active ? 'var(--success)' : 'var(--danger)',
                          }}>
                            {acc.is_active ? 'Đang Hoạt Động' : 'Đã Khóa'}
                          </span>
                        </td>
                        <td style={{ padding: '14px 20px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <button
                            onClick={() => handleToggleInternalAccount(acc)}
                            style={{
                              padding: '6px 12px',
                              borderRadius: 'var(--radius-sm)',
                              border: acc.is_active ? '1px solid var(--danger)' : '1px solid var(--success)',
                              backgroundColor: 'transparent',
                              color: acc.is_active ? 'var(--danger)' : 'var(--success)',
                              fontWeight: 600,
                              fontSize: '12px',
                              cursor: 'pointer',
                            }}
                          >
                            {acc.is_active ? 'Khóa' : 'Mở Khóa'}
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
          {/* MODULE 3: KÍCH HOẠT TÀI KHOẢN NHÂN VIÊN (6 SUB-TABS) */}
          {/* ========================================================= */}
          {activeTab === 'activation' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>3. Kích Hoạt & Quản Lý Tài Khoản Nhân Viên</h1>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Phân nhóm theo 6 tab nghiệp vụ: Nhân viên mới, Thử việc, Chính thức, Văn Phòng, Xưởng, Sales. Phê duyệt kích hoạt để nhân viên tự động đăng nhập trên Cổng Employee Web.</p>
              </div>

              {/* 6 Sub-Tabs for Activation & Account Management */}
              <div style={{
                display: 'flex',
                gap: '8px',
                borderBottom: '2px solid var(--border)',
                paddingBottom: '8px',
                overflowX: 'auto',
              }}>
                {[
                  { key: 'ALL', label: 'Tất cả nhân sự', count: countAll, icon: '🌟' },
                  { key: 'NEW', label: 'Chờ kích hoạt', count: countNew, icon: '⏳' },
                  { key: 'PROBATION', label: 'Thử việc', count: countProbation, icon: '📝' },
                  { key: 'OFFICIAL', label: 'Chính thức', count: countOfficial, icon: '💼' },
                  { key: 'VAN_PHONG', label: 'Văn Phòng', count: countOffice, icon: '🏢' },
                  { key: 'XUONG', label: 'Xưởng', count: countFactory, icon: '🏭' },
                  { key: 'SALE', label: 'Sales', count: countSales, icon: '📈' },
                  { key: 'SUSPENDED', label: 'Tạm khóa', count: countSuspended, icon: '🔒' },
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
              }}>
                <div style={{ flex: 1, position: 'relative' }}>
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
                  Quy tắc chi nhánh: Văn phòng & Sales: <strong style={{ color: 'var(--brand)' }}>Trụ sở chính</strong> | Xưởng: <strong style={{ color: 'var(--brand)' }}>Củ Chi</strong>
                </div>
              </div>

              {/* Unified Activation & Account Table */}
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
                      <th style={{ padding: '12px 20px' }}>Trạng Thái TK</th>
                      <th style={{ padding: '12px 20px' }}>Lịch Sử Kích Hoạt</th>
                      <th style={{ padding: '12px 20px' }}>Thao Tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredActivationItems.length === 0 ? (
                      <tr>
                        <td colSpan={9} style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
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
                          <td style={{ padding: '14px 20px' }}>
                            <span style={{
                              padding: '4px 8px',
                              borderRadius: 'var(--radius-full)',
                              fontSize: '11px',
                              fontWeight: 700,
                              backgroundColor:
                                item.accountStatus === 'ACTIVE' ? 'var(--success-soft)' :
                                item.accountStatus === 'PENDING_ACTIVATION' ? 'var(--warning-soft)' :
                                item.accountStatus === 'NO_ACCOUNT' ? '#F1F5F9' : 'var(--danger-soft)',
                              color:
                                item.accountStatus === 'ACTIVE' ? 'var(--success)' :
                                item.accountStatus === 'PENDING_ACTIVATION' ? '#92400E' :
                                item.accountStatus === 'NO_ACCOUNT' ? '#64748B' : 'var(--danger)',
                            }}>
                              {item.accountStatus === 'ACTIVE' ? 'Đã Kích Hoạt' :
                               item.accountStatus === 'PENDING_ACTIVATION' ? 'Chờ Kích Hoạt' :
                               item.accountStatus === 'NO_ACCOUNT' ? 'Chưa Có TK' :
                               item.accountStatus === 'SUSPENDED' ? 'Tạm Khóa' : 'Đã Thu Hồi'}
                            </span>
                          </td>
                          <td style={{ padding: '14px 20px', fontSize: '11px', color: 'var(--text-muted)' }}>
                            {item.activatedAt ? `Kích hoạt: ${new Date(item.activatedAt).toLocaleDateString('vi-VN')} (${item.activatedBy || 'Admin'})` :
                             item.revokedAt ? `Khóa: ${new Date(item.revokedAt).toLocaleDateString('vi-VN')}` : 'Chưa kích hoạt'}
                          </td>
                          <td style={{ padding: '14px 20px' }}>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              <button
                                onClick={() => handleSetEmpPin(item.accountId, item.fullName || item.phone)}
                                disabled={!item.hasRealAccount}
                                title={item.hasRealAccount ? 'Cấp mới hoặc RESET khi nhân viên quên PIN (PIN cũ vô hiệu ngay, NV bắt đổi lần sau)' : 'Kích hoạt tài khoản trước khi cấp PIN!'}
                                style={{
                                  padding: '6px 12px',
                                  borderRadius: 'var(--radius-sm)',
                                  backgroundColor: 'transparent',
                                  border: '1px solid var(--brand)',
                                  color: 'var(--brand)',
                                  fontWeight: 600,
                                  fontSize: '12px',
                                  cursor: item.hasRealAccount ? 'pointer' : 'not-allowed',
                                  opacity: item.hasRealAccount ? 1 : 0.5,
                                }}
                              >
                                🔑 Cấp / Reset PIN
                              </button>
                              {item.accountStatus !== 'ACTIVE' ? (
                                <button
                                  onClick={() => handleActivateEmpAccount(item.hasRealAccount ? item.accountId : item.id, item.version)}
                                  style={{
                                    padding: '6px 12px',
                                    borderRadius: 'var(--radius-sm)',
                                    backgroundColor: 'var(--success)',
                                    color: '#FFF',
                                    fontWeight: 600,
                                    fontSize: '12px',
                                    border: 'none',
                                    cursor: 'pointer',
                                    boxShadow: '0 2px 4px rgba(16, 185, 129, 0.2)',
                                  }}
                                >
                                  Kích Hoạt Ngay
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleRevokeEmpAccount(item.accountId, item.version, 'SUSPENDED')}
                                  style={{
                                    padding: '6px 12px',
                                    borderRadius: 'var(--radius-sm)',
                                    backgroundColor: 'transparent',
                                    border: '1px solid var(--danger)',
                                    color: 'var(--danger)',
                                    fontWeight: 600,
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                  }}
                                >
                                  Khóa
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
                    }}
                  >
                    {loading ? 'Đang Tải Dữ Liệu...' : '📥 Tải Dữ Liệu Thực Tế Từ Sheets'}
                  </button>
                  <button
                    onClick={handleForceSync}
                    disabled={loading}
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
                    }}
                  >
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
            activationDataList={activationDataList}
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
                  <option value="PRE_ONBOARDING">Nhân viên mới (Chờ kích hoạt tài khoản)</option>
                  <option value="PROBATION">Thử việc (Lương 23.000 đ/h)</option>
                  <option value="OFFICIAL">Chính thức (Lương 25.000 đ/h)</option>
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
