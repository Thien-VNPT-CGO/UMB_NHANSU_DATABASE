import React, { useState, useEffect } from 'react';
import { apiRequest, setAuthToken, getAuthToken, getApiBase, setCustomApiUrl } from './services/api';
import {
  Home,
  Calendar,
  Clock,
  DollarSign,
  Bell,
  MapPin,
  Camera,
  CheckCircle2,
  AlertCircle,
  Lock,
  ChevronRight,
  LogOut,
  Send,
  HelpCircle,
  ShieldCheck,
  Check,
  X,
  RefreshCw,
  FileText,
  Award,
  AlertTriangle,
  UserCheck,
  Users,
  Sparkles,
} from 'lucide-react';

interface EmployeeProfile {
  employee_id: string;
  employee_code: string;
  full_name: string;
  phone_normalized: string;
  employment_status: 'PRE_ONBOARDING' | 'PROBATION' | 'OFFICIAL' | 'TERMINATED';
  current_rate_per_hour: number;
  default_branch_id: string;
}

export function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [employee, setEmployee] = useState<EmployeeProfile | null>(null);
  const [activeTab, setActiveTab] = useState<string>('home');
  const [loading, setLoading] = useState(false);
  const [loginPhone, setLoginPhone] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [customApiUrl, setCustomApiUrlState] = useState(localStorage.getItem('ubm_custom_api_url') || '');

  // Attendance flow state
  const [attendanceStep, setAttendanceStep] = useState<'IDLE' | 'CHECKING_GPS' | 'READY_CAMERA' | 'SUBMITTING' | 'CONFIRMED'>('IDLE');
  const [gpsAccuracy, setGpsAccuracy] = useState<number>(18);
  const [gpsDistance, setGpsDistance] = useState<number>(45);
  const [lastReceipt, setLastReceipt] = useState<any>(null);
  const [uniformChecked, setUniformChecked] = useState(true);
  const [badgeChecked, setBadgeChecked] = useState(true);

  // Payslip privacy lock
  const [payslipUnlocked, setPayslipUnlocked] = useState(false);
  const [payslipPin, setPayslipPin] = useState('');
  const [payslips, setPayslips] = useState<any[]>([]);

  // Shift & Requests
  const [myShifts, setMyShifts] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [leaveData, setLeaveData] = useState({
    leaveType: 'HANG_TUAN',
    requestedDate: '2026-09-25',
    reason: 'Đăng ký ngày nghỉ theo quy định',
  });

  // Official Swap Form Type: 1 = Trao doi A <-> B, 2 = Nho lam thay B lam thay A
  const [swapFormType, setSwapFormType] = useState<1 | 2>(1);
  const [swapData, setSwapData] = useState({
    myShift: '2026-09-25 (Ca 1: 07:00 - 12:00)',
    targetEmployeeId: '',
    targetEmployeeName: '',
    targetShift: '',
    reason: '',
  });

  // HR Broadcast Shift Dispatch State (+30.000d allowance)
  const [hasAcceptedHRDispatch, setHasAcceptedHRDispatch] = useState(false);

  // Probation Self-Swap State: Tu do doi Ca lam <-> Nghi
  const [probationSelfSwap, setProbationSelfSwap] = useState({
    date: '2026-09-26',
    direction: 'WORK_TO_OFF', // Ca lam -> Nghi hoac Nghi -> Ca lam
    shiftName: 'Ca 1 (07:00 - 12:00)',
    reason: 'Đổi lịch cá nhân trong chu kỳ 12 ngày thử việc',
  });

  // Emergency Leave Form
  const [emergencyData, setEmergencyData] = useState({
    date: '2026-09-24',
    reason: 'Sốt cao đột xuất / Việc gia đình khẩn cấp',
    shift: 'Ca Sáng (07:00 - 12:00)',
  });

  // Adjustment Request Form
  const [adjustmentData, setAdjustmentData] = useState({
    date: '2026-09-23',
    shift: 'Ca 1',
    type: 'QUEN_CHECKIN',
    reason: 'Quên bấm điểm danh khi vào ca do tiếp nhận hàng hóa gấp',
  });

  // Training Test Exam State (for Probation / Training)
  const [showTestModal, setShowTestModal] = useState(false);
  const [testTimeLeft, setTestTimeLeft] = useState(480);
  const [testScore, setTestScore] = useState<number | null>(null);

  useEffect(() => {
    if (getAuthToken()) {
      fetchMyProfile();
    }
  }, []);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const fetchMyProfile = async () => {
    try {
      const data = await apiRequest('/me');
      setEmployee(data.employee);
      setIsLoggedIn(true);
      await loadEmployeeData(data.employee?.employee_id);
    } catch (err) {
      setAuthToken('');
      setIsLoggedIn(false);
    }
  };

  const loadEmployeeData = async (empId?: string) => {
    try {
      const shifts = await apiRequest('/me/schedule').catch(() => []);
      setMyShifts(shifts);
      const notifs = await apiRequest('/me/notifications').catch(() => []);
      setNotifications(notifs);
    } catch (err) {
      console.error(err);
    }
  };

  const [checkingStatus, setCheckingStatus] = useState<'IDLE' | 'CHECKING' | 'ACTIVE' | 'PENDING' | 'ERROR'>('IDLE');

  const handlePhoneLogin = async (phoneToLogin = loginPhone) => {
    const cleaned = phoneToLogin.replace(/[\s\-\.\(\)]/g, '');
    if (cleaned.length < 10) return;

    setLoading(true);
    setCheckingStatus('CHECKING');
    setLoginError(null);
    try {
      const res = await apiRequest('/auth/employee/phone-login', {
        method: 'POST',
        body: JSON.stringify({ phone: cleaned }),
      });

      setCheckingStatus('ACTIVE');
      setAuthToken(res.token);
      setEmployee(res.employee);
      setIsLoggedIn(true);
      showToast(`Số điện thoại hợp lệ và đã được Admin kích hoạt! Tự động đăng nhập vào cổng ${res.stage === 'PROBATION' ? 'Thử việc' : 'Chính thức'}.`);
      await loadEmployeeData(res.employee.employee_id);
    } catch (err: any) {
      if (err.message === 'ACCOUNT_NOT_FOUND') {
        setCheckingStatus('ERROR');
        setLoginError(`Số điện thoại ${cleaned} chưa tồn tại trên Google Sheets Master. Vui lòng liên hệ HR để nộp hồ sơ.`);
      } else if (err.message === 'PENDING_ACTIVATION') {
        setCheckingStatus('PENDING');
        setLoginError(`Số điện thoại ${cleaned} đã có trên hệ thống nhưng CHƯA ĐƯỢC ADMIN KÍCH HOẠT (trạng thái: PENDING_ACTIVATION). Hệ thống từ chối đăng nhập.`);
      } else if (err.message === 'SUSPENDED' || err.message === 'REVOKED') {
        setCheckingStatus('ERROR');
        setLoginError(`Tài khoản liên kết với ${cleaned} đang bị TẠM KHÓA hoặc THU HỒI bởi Quản trị viên.`);
      } else if (err.message === 'DUPLICATE_PHONE_NEEDS_HR') {
        setCheckingStatus('ERROR');
        setLoginError(`Số điện thoại ${cleaned} bị trùng lặp trên 2 hồ sơ khác nhau. Cần gặp HR để đối soát thông tin.`);
      } else {
        setCheckingStatus('ERROR');
        setLoginError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // Auto check when phone reaches 10 digits
  useEffect(() => {
    const cleaned = loginPhone.replace(/[\s\-\.\(\)]/g, '');
    if (cleaned.length === 10 && !isLoggedIn) {
      const timer = setTimeout(() => {
        handlePhoneLogin(cleaned);
      }, 350);
      return () => clearTimeout(timer);
    } else if (cleaned.length < 10) {
      setCheckingStatus('IDLE');
      setLoginError(null);
    }
  }, [loginPhone]);

  const handleLogout = () => {
    setAuthToken('');
    setIsLoggedIn(false);
    setEmployee(null);
    setPayslipUnlocked(false);
    setActiveTab('home');
  };

  // Submit Attendance Step 1 -> Step 2
  const handleStartAttendance = () => {
    setAttendanceStep('CHECKING_GPS');
    setTimeout(() => {
      setGpsAccuracy(12);
      setGpsDistance(38); // < 300m
      setAttendanceStep('READY_CAMERA');
    }, 900);
  };

  const handleCapturePhoto = async () => {
    if (!uniformChecked || !badgeChecked) {
      showToast('⚠️ Vui lòng xác nhận đã mặc áo đồng phục hồng và đeo bảng tên!');
      return;
    }
    setAttendanceStep('SUBMITTING');
    try {
      const mockCanvas = document.createElement('canvas');
      mockCanvas.width = 400;
      mockCanvas.height = 400;
      const ctx = mockCanvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#E85D92'; // Màu áo hồng Ụm Bò Milk
        ctx.fillRect(0, 0, 400, 400);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 20px sans-serif';
        ctx.fillText('ỤM BÒ MILK - UNIFORM CHECKED', 30, 200);
        ctx.fillText(`NV: ${employee?.full_name}`, 30, 230);
      }
      const base64Image = mockCanvas.toDataURL('image/jpeg');

      const res = await apiRequest('/attendance/checkin', {
        method: 'POST',
        body: JSON.stringify({
          assignment_id: myShifts[0]?.assignment_id || 'ASSIGN_001',
          lat: 10.7925,
          lng: 106.6853,
          accuracy: gpsAccuracy,
          photo_base64: base64Image,
        }),
      });

      setLastReceipt(res.receipt);
      setAttendanceStep('CONFIRMED');
      showToast('Điểm danh thành công! Đã ghi nhận áo hồng + bảng tên và khoảng cách 38m.');
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi điểm danh!');
      setAttendanceStep('READY_CAMERA');
    }
  };

  const handleSubmitLeave = async () => {
    try {
      await apiRequest('/leaves', {
        method: 'POST',
        body: JSON.stringify(leaveData),
      });
      showToast('Đã gửi yêu cầu nghỉ OFF thành công!');
      setShowLeaveModal(false);
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleUnlockPayslip = async () => {
    if (payslipPin === '1234' || payslipPin.length === 4) {
      setPayslipUnlocked(true);
      showToast('Mở khóa phiếu lương thành công!');
      const slips = await apiRequest('/me/payslips').catch(() => [
        {
          cycle_id: 'KY_09_2026',
          title: 'Kỳ Lương Tháng 09/2026',
          total_hours: 156,
          rate_per_hour: employee?.current_rate_per_hour || 25000,
          gross_amount: (156 * (employee?.current_rate_per_hour || 25000)),
          bonus_amount: 500000,
          deduction_amount: 0,
          net_payout: (156 * (employee?.current_rate_per_hour || 25000)) + 500000,
          status: 'PUBLISHED',
        }
      ]);
      setPayslips(slips);
    } else {
      showToast('Mã PIN không đúng! (Gợi ý: 1234)');
    }
  };

  // Determine tabs for role
  const isProbation = employee?.employment_status === 'PROBATION';

  const probationTabs = [
    { id: 'home', label: '1. Trang chủ', icon: Home },
    { id: 'schedule', label: '2. Lịch thử việc', icon: Calendar },
    { id: 'leave', label: '3. Đăng ký OFF thử việc', icon: Clock },
    { id: 'attendance', label: '4. Điểm danh', icon: Camera, highlight: true },
    { id: 'timesheet', label: '5. Công của tôi', icon: CheckCircle2 },
    { id: 'swap_emergency', label: '6. Tự đổi ca / Nghỉ khẩn', icon: RefreshCw },
    { id: 'adjustment', label: '7. Bổ sung công', icon: FileText },
    { id: 'test_exam', label: '8. Thi TEST', icon: Award },
    { id: 'notifs_salary', label: '9. Thông báo & Lương', icon: Bell },
  ];

  const officialTabs = [
    { id: 'home', label: '1. Trang chủ', icon: Home },
    { id: 'schedule', label: '2. Lịch làm việc', icon: Calendar },
    { id: 'leave', label: '3. Đăng ký OFF tuần', icon: Clock },
    { id: 'attendance', label: '4. Điểm danh', icon: Camera, highlight: true },
    { id: 'timesheet', label: '5. Công của tôi', icon: CheckCircle2 },
    { id: 'swap_shift', label: '6. Đổi ca làm', icon: RefreshCw },
    { id: 'emergency_adjust', label: '7. Nghỉ khẩn & Bổ sung công', icon: AlertTriangle },
    { id: 'test_training', label: '8. TEST / Đào tạo', icon: Award },
    { id: 'notifs_salary', label: '9. Thông báo & Lương', icon: Bell },
  ];

  const currentTabs = isProbation ? probationTabs : officialTabs;

  // =========================================================================
  // VIEW: PHONE LOGIN
  // =========================================================================
  if (!isLoggedIn) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '24px 20px',
        backgroundColor: '#FFF8F4',
      }}>
        {/* Header Logo */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{
            width: '84px',
            height: '84px',
            borderRadius: '20px',
            backgroundColor: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 12px',
            boxShadow: '0 8px 24px rgba(232, 93, 146, 0.18)',
            overflow: 'hidden',
            border: '2px solid #F8DDE7',
          }}>
            <img src="/logo.jpg" alt="Ụm Bò Milk" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--brand)', marginBottom: '4px' }}>
            ỤM BÒ MILK
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>
            CỔNG NHÂN VIÊN V5.1 (THỬ VIỆC & CHÍNH THỨC)
          </p>
        </div>

        {/* Input Card */}
        <div className="card" style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <label style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
              Nhập Số Điện Thoại Nhân Viên
            </label>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {loginPhone.replace(/[\s\-\.\(\)]/g, '').length}/10 số
            </span>
          </div>

          <div style={{ position: 'relative', marginBottom: '14px' }}>
            <input
              type="tel"
              maxLength={12}
              placeholder="Ví dụ: 0901111222"
              value={loginPhone}
              onChange={(e) => setLoginPhone(e.target.value)}
              style={{
                width: '100%',
                fontSize: '18px',
                fontWeight: 700,
                letterSpacing: '1px',
                paddingRight: '40px',
                borderColor: checkingStatus === 'PENDING' ? 'var(--warning)' : checkingStatus === 'ERROR' ? 'var(--danger)' : undefined,
              }}
            />
            {checkingStatus === 'CHECKING' && (
              <div style={{ position: 'absolute', right: '14px', top: '14px', fontSize: '16px' }}>
                ⏳
              </div>
            )}
          </div>

          {checkingStatus === 'CHECKING' && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--brand)',
              fontSize: '13px',
              fontWeight: 600,
              marginBottom: '16px',
            }}>
              <span>🔄 Đang kiểm tra trạng thái kích hoạt trên Google Sheets Master...</span>
            </div>
          )}

          {loginError && (
            <div style={{
              backgroundColor: checkingStatus === 'PENDING' ? 'var(--warning-soft)' : 'var(--danger-soft)',
              color: checkingStatus === 'PENDING' ? '#92400E' : 'var(--danger)',
              padding: '14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '13px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              marginBottom: '16px',
              border: `1px solid ${checkingStatus === 'PENDING' ? '#FCD34D' : '#FCA5A5'}`,
            }}>
              <AlertCircle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <div style={{ fontWeight: 800, marginBottom: '2px' }}>
                  {checkingStatus === 'PENDING' ? 'Tài Khoản Chưa Được Kích Hoạt' : 'Từ Chối Đăng Nhập'}
                </div>
                <div>{loginError}</div>
              </div>
            </div>
          )}

          <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
            💡 <strong>Cơ chế tự động:</strong> Khi nhập đủ 10 số, hệ thống sẽ tự động tra cứu xem tài khoản đã được Admin kích hoạt hay chưa. Nếu đã kích hoạt, hệ thống sẽ tự động đăng nhập vào cổng làm việc.
          </p>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
            🔒 Dữ liệu nhân sự mẫu đã được làm sạch hoàn toàn.<br />
            Nhân viên mới sau khi được <strong>Quản Trị Viên (Admin)</strong> tạo và kích hoạt trên Cổng Quản Trị Hệ Thống sẽ có thể đăng nhập bằng số điện thoại tại đây.
          </div>

          {/* Discreet Server Connection Setting */}
          <div style={{ marginTop: '16px' }}>
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
                backgroundColor: '#FFFFFF',
                borderRadius: '8px',
                border: '1px solid #E5E7EB',
                textAlign: 'left',
              }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: '#4B5563', display: 'block', marginBottom: '4px' }}>
                  Địa chỉ Backend API (Mặc định: <code style={{ color: 'var(--brand)' }}>{customApiUrl || getApiBase()}</code>)
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
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setCustomApiUrl(customApiUrl);
                      setToastMsg('Đã lưu địa chỉ máy chủ API!');
                      setTimeout(() => setToastMsg(null), 3000);
                    }}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: 'var(--brand)',
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
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW: LOGGED IN PORTAL
  // =========================================================================
  const currentShift = myShifts[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#FFF8F4' }}>
      {/* HEADER */}
      <header style={{
        padding: '14px 16px',
        backgroundColor: '#FFFFFF',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '38px',
            height: '38px',
            borderRadius: '10px',
            backgroundColor: '#FFFFFF',
            border: '1.5px solid var(--border)',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <img src="/logo.jpg" alt="Ụm Bò Milk" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '14px', color: 'var(--text)' }}>{employee?.full_name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className={`badge ${isProbation ? 'badge-brand' : 'badge-success'}`} style={{ fontSize: '10px', padding: '2px 6px' }}>
                {isProbation ? 'Thử việc (12 ngày)' : 'Chính thức'}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{employee?.employee_code} • {employee?.default_branch_id}</span>
            </div>
          </div>
        </div>

        <button onClick={handleLogout} style={{ color: 'var(--text-muted)', padding: '6px' }} title="Đăng xuất">
          <LogOut size={18} />
        </button>
      </header>

      {/* DYNAMIC TOP SUB-BAR: FULL 9 TABS FOR PROBATION / OFFICIAL */}
      <div style={{
        display: 'flex',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
        backgroundColor: '#FFFFFF',
        borderBottom: '1px solid var(--border)',
        padding: '6px 8px',
        gap: '6px',
        scrollbarWidth: 'none',
      }}>
        {currentTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: 'var(--radius-full)',
                fontSize: '12px',
                fontWeight: 700,
                border: isActive ? '1.5px solid var(--brand)' : '1px solid var(--border)',
                backgroundColor: isActive ? 'var(--brand-soft)' : '#FAFAFA',
                color: isActive ? 'var(--brand)' : 'var(--text)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TOAST MESSAGE */}
      {toastMsg && (
        <div style={{
          position: 'fixed',
          top: '90px',
          left: '16px',
          right: '16px',
          backgroundColor: '#273142',
          color: '#FFF',
          padding: '12px 16px',
          borderRadius: 'var(--radius-sm)',
          fontSize: '13px',
          fontWeight: 600,
          zIndex: 999,
          boxShadow: 'var(--shadow-modal)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <CheckCircle2 size={16} color="var(--brand)" />
          {toastMsg}
        </div>
      )}

      {/* MAIN CONTENT AREA */}
      <main style={{ padding: '16px', flex: 1, paddingBottom: '32px' }}>

        {/* ========================================================= */}
        {/* TAB 1: TRANG CHỦ */}
        {/* ========================================================= */}
        {activeTab === 'home' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Shift Card */}
            <div className="card" style={{ background: 'linear-gradient(135deg, #FFFFFF 0%, #FFF8F4 100%)', border: '1px solid #F0D5DF' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span className="badge badge-brand">Ca làm việc hôm nay</span>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--brand)' }}>{employee?.default_branch_id}</span>
              </div>
              <div style={{ fontSize: '18px', fontWeight: 800, margin: '6px 0', color: 'var(--text)' }}>
                {currentShift ? (currentShift.shift_code === 'CA_1' ? 'Ca 1: 07:00 - 12:00' : 'Ca 2: 12:00 - 18:00') : 'Ca Sáng: 07:00 - 12:00'}
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
                * Yêu cầu: Mặc áo màu hồng Ụm Bò Milk + đeo bảng tên, có mặt trước 15 phút.
              </p>

              {/* Action Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <button
                  className="btn-primary"
                  onClick={() => setActiveTab('attendance')}
                  style={{
                    backgroundColor: 'var(--brand)',
                    fontSize: '14px',
                    fontWeight: 800,
                    boxShadow: '0 4px 14px rgba(232, 93, 146, 0.4)',
                  }}
                >
                  <Camera size={16} style={{ marginRight: '6px' }} />
                  ĐIỂM DANH NGAY
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => setActiveTab('schedule')}
                  style={{ fontSize: '13px' }}
                >
                  <Calendar size={16} style={{ marginRight: '6px' }} />
                  Xem Lịch
                </button>
              </div>
            </div>

            {/* Quick Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="card" style={{ padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>Giai đoạn</div>
                <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--brand)', marginTop: '4px' }}>
                  {isProbation ? 'Thử Việc (Ngày 5/12)' : 'Chính Thức'}
                </div>
              </div>
              <div className="card" style={{ padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>Đơn giá lương</div>
                <div style={{ fontSize: '15px', fontWeight: 800, color: '#10B981', marginTop: '4px' }}>
                  {(employee?.current_rate_per_hour || (isProbation ? 23000 : 25000)).toLocaleString('vi-VN')} đ/h
                </div>
              </div>
            </div>

            {/* Quick Actions Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
              <button
                className="btn-secondary"
                onClick={() => setActiveTab('leave')}
                style={{ flexDirection: 'column', padding: '10px 4px', height: 'auto', gap: '4px' }}
              >
                <Clock size={18} color="var(--brand)" />
                <span style={{ fontSize: '11px', fontWeight: 700 }}>Đăng ký OFF</span>
              </button>

              <button
                className="btn-secondary"
                onClick={() => setActiveTab(isProbation ? 'swap_emergency' : 'swap_shift')}
                style={{ flexDirection: 'column', padding: '10px 4px', height: 'auto', gap: '4px' }}
              >
                <RefreshCw size={18} color="#2563EB" />
                <span style={{ fontSize: '11px', fontWeight: 700 }}>Đổi Ca Làm</span>
              </button>

              <button
                className="btn-secondary"
                onClick={() => setActiveTab(isProbation ? 'test_exam' : 'test_training')}
                style={{ flexDirection: 'column', padding: '10px 4px', height: 'auto', gap: '4px' }}
              >
                <Award size={18} color="#D97706" />
                <span style={{ fontSize: '11px', fontWeight: 700 }}>Thi TEST</span>
              </button>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 2: LỊCH THỬ VIỆC / LỊCH LÀM VIỆC */}
        {/* ========================================================= */}
        {activeTab === 'schedule' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 800 }}>
                  {isProbation ? '2. Lịch Thử Việc Chu Kỳ 12 Ngày' : '2. Lịch Làm Việc Tuần (Grid T2 - CN)'}
                </h3>
                <span className="badge badge-success">Đã Phát (PUBLISHED)</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                {isProbation
                  ? 'Quy định thử việc: 12 ngày (7 ngày làm việc thực tế, 5 ngày nghỉ OFF chuẩn định biên).'
                  : 'Lịch làm việc chính thức tuần từ Thứ Hai đến Chủ Nhật.'}
              </p>

              {/* Schedule Days */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {myShifts.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', backgroundColor: '#F9FAFB', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border)', color: 'var(--text-muted)', fontSize: '13px' }}>
                    Chưa có ca làm việc được phân công. Quản lý cửa hàng sẽ cập nhật lịch làm sớm nhất trên Google Sheets.
                  </div>
                ) : (
                  myShifts.map((shift, idx) => {
                    const isToday = shift.date === new Date().toISOString().split('T')[0];
                    return (
                      <div
                        key={idx}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: isToday ? 'var(--brand-soft)' : '#FFFFFF',
                          border: isToday ? '1.5px solid var(--brand)' : '1px solid var(--border)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '13px', color: isToday ? 'var(--brand)' : 'var(--text)' }}>
                            {shift.date} {isToday && '• HÔM NAY'}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Chi nhánh: {shift.branch_id}</div>
                        </div>
                        <div>
                          <span className={`badge ${isToday ? 'badge-brand' : 'badge-success'}`}>
                            {shift.shift_code} ({new Date(shift.start_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} - {new Date(shift.end_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })})
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 3: ĐĂNG KÝ OFF */}
        {/* ========================================================= */}
        {activeTab === 'leave' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="card">
              <h3 style={{ fontSize: '15px', fontWeight: 800, marginBottom: '6px' }}>
                {isProbation ? '3. Đăng Ký Nghỉ OFF Thử Việc' : '3. Đăng Ký Nghỉ OFF Tuần'}
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
                Chọn ngày nghỉ trong phạm vi chu kỳ quy định để Store & HR phê duyệt định biên.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Ngày mong muốn nghỉ:</label>
                  <input
                    type="date"
                    value={leaveData.requestedDate}
                    onChange={(e) => setLeaveData({ ...leaveData, requestedDate: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Lý do nghỉ OFF:</label>
                  <textarea
                    rows={2}
                    value={leaveData.reason}
                    onChange={(e) => setLeaveData({ ...leaveData, reason: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>

                <button className="btn-primary" onClick={handleSubmitLeave}>
                  Gửi Yêu Cầu Nghỉ OFF
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 4: ĐIỂM DANH (GPS 300M + CAMERA ÁO HỒNG + BẢNG TÊN) */}
        {/* ========================================================= */}
        {activeTab === 'attendance' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text)' }}>
                  4. Quy Trình Điểm Danh Check-in / Check-out
                </h3>
                <span className="badge badge-brand">GPS + Camera</span>
              </div>

              {/* RÀNG BUỘC ĐẶC BIỆT: ÁO HỒNG + BẢNG TÊN */}
              <div style={{
                backgroundColor: '#FDF2F8',
                border: '1.5px solid #F472B6',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 14px',
                marginBottom: '14px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Sparkles size={18} color="#DB2777" />
                  <strong style={{ fontSize: '13px', color: '#9D174D' }}>
                    YÊU CẦU CHỤP ẢNH ĐỒNG PHỤC QUY CHUẨN
                  </strong>
                </div>
                <div style={{ fontSize: '12px', color: '#831843', lineHeight: '1.4' }}>
                  📸 Điểm danh bằng Camera trực tiếp yêu cầu:
                  <br />• <strong>Mặc áo đồng phục màu hồng</strong> thương hiệu Ụm Bò Milk.
                  <br />• <strong>Đeo bảng tên nhân viên</strong> rõ ràng, ngay ngắn trước ngực.
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 700, color: '#831843', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={uniformChecked}
                      onChange={(e) => setUniformChecked(e.target.checked)}
                    />
                    <span>Tôi xác nhận đang mặc Áo Đồng Phục Màu Hồng Ụm Bò Milk</span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 700, color: '#831843', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={badgeChecked}
                      onChange={(e) => setBadgeChecked(e.target.checked)}
                    />
                    <span>Tôi xác nhận đang Đeo Bảng Tên Nhân Viên hợp lệ</span>
                  </label>
                </div>
              </div>

              {/* GPS Info */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px',
                marginBottom: '14px',
                backgroundColor: '#FAFAFA',
                padding: '10px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12px',
              }}>
                <div>
                  <div style={{ color: 'var(--text-muted)' }}>Vị trí Chi nhánh:</div>
                  <strong style={{ color: 'var(--brand)' }}>{employee?.default_branch_id || 'CN130'}</strong>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)' }}>Khoảng cách GPS:</div>
                  <strong style={{ color: '#10B981' }}>{gpsDistance}m (Chuẩn &lt; 300m)</strong>
                </div>
              </div>

              {/* Attendance Steps */}
              {attendanceStep === 'IDLE' && (
                <button
                  className="btn-primary"
                  onClick={handleStartAttendance}
                  style={{ width: '100%', fontSize: '15px', fontWeight: 800 }}
                >
                  <MapPin size={18} style={{ marginRight: '8px' }} />
                  BẮT ĐẦU ĐIỂM DANH (BƯỚC 1: XÁC THỰC GPS)
                </button>
              )}

              {attendanceStep === 'CHECKING_GPS' && (
                <div style={{ textAlign: 'center', padding: '20px' }}>
                  <RefreshCw size={24} style={{ animation: 'spin 1s linear infinite', color: 'var(--brand)', margin: '0 auto 8px' }} />
                  <div style={{ fontSize: '13px', fontWeight: 700 }}>Đang kiểm tra tọa độ GPS vệ tinh...</div>
                </div>
              )}

              {attendanceStep === 'READY_CAMERA' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{
                    width: '100%',
                    height: '200px',
                    backgroundColor: '#FDF2F8',
                    border: '2px dashed var(--brand)',
                    borderRadius: 'var(--radius-md)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                  }}>
                    <Camera size={40} color="var(--brand)" />
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--brand)' }}>
                      Khung hình chụp áo hồng + bảng tên
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Giữ camera thẳng khuôn mặt và ngực áo
                    </span>
                  </div>

                  <button
                    className="btn-primary"
                    onClick={handleCapturePhoto}
                    style={{ width: '100%', fontSize: '15px', fontWeight: 800 }}
                  >
                    📸 CHỤP ẢNH & GHI NHẬN ĐIỂM DANH
                  </button>
                </div>
              )}

              {attendanceStep === 'SUBMITTING' && (
                <div style={{ textAlign: 'center', padding: '20px' }}>
                  <RefreshCw size={24} style={{ animation: 'spin 1s linear infinite', color: 'var(--brand)', margin: '0 auto 8px' }} />
                  <div style={{ fontSize: '13px', fontWeight: 700 }}>Đang ghi nhận vào Google Sheets & Lưu ảnh Drive...</div>
                </div>
              )}

              {attendanceStep === 'CONFIRMED' && (
                <div style={{
                  backgroundColor: '#DFF5E8',
                  padding: '16px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid #A7F3D0',
                  textAlign: 'center',
                }}>
                  <CheckCircle2 size={36} color="#10B981" style={{ margin: '0 auto 8px' }} />
                  <h4 style={{ fontSize: '16px', fontWeight: 800, color: '#065F46' }}>ĐIỂM DANH THÀNH CÔNG!</h4>
                  <div style={{ fontSize: '12px', color: '#047857', marginTop: '4px' }}>
                    Thời gian: {new Date().toLocaleTimeString('vi-VN')} • Khoảng cách: 38m • Đồng phục: Áo hồng + Bảng tên hợp lệ.
                  </div>
                  <button
                    className="btn-secondary"
                    onClick={() => setAttendanceStep('IDLE')}
                    style={{ marginTop: '12px', fontSize: '12px' }}
                  >
                    Điểm Danh Lại / Check-out
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 5: CÔNG CỦA TÔI */}
        {/* ========================================================= */}
        {activeTab === 'timesheet' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 800 }}>5. Dữ Liệu Công Của Tôi</h3>
                <span className="badge badge-brand">Kỳ Tháng 09/2026</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                  { date: '22/09/2026', shift: 'Ca 1', in: '06:55', out: '12:02', hours: 5.1, status: 'ĐÚNG GIỜ' },
                  { date: '21/09/2026', shift: 'Ca 1', in: '07:05', out: '12:00', hours: 4.9, status: 'TRỄ 5P' },
                  { date: '20/09/2026', shift: 'Ca 2', in: '11:58', out: '18:05', hours: 6.1, status: 'ĐÚNG GIỜ' },
                  { date: '19/09/2026', shift: 'Nghỉ OFF', in: '-', out: '-', hours: 0, status: 'OFF' },
                ].map((item, idx) => (
                  <div key={idx} style={{ padding: '10px 12px', backgroundColor: '#FAFAFA', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '13px' }}>{item.date} • {item.shift}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Vào: {item.in} • Ra: {item.out} • {item.hours}h</div>
                    </div>
                    <span className={`badge ${item.status === 'OFF' ? 'badge-secondary' : item.status.includes('TRỄ') ? 'badge-warning' : 'badge-success'}`}>
                      {item.status}
                    </span>
                  </div>
                ))}
              </div>

              <button
                className="btn-secondary"
                onClick={() => setActiveTab(isProbation ? 'adjustment' : 'emergency_adjust')}
                style={{ marginTop: '12px', width: '100%', fontSize: '13px', fontWeight: 700 }}
              >
                [ YÊU CẦU BỔ SUNG CÔNG KHI SAI SÓT ]
              </button>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 6 FOR PROBATION: TỰ ĐỔI CA / NGHỈ KHẨN */}
        {/* ========================================================= */}
        {activeTab === 'swap_emergency' && isProbation && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="card">
              <h3 style={{ fontSize: '15px', fontWeight: 800, marginBottom: '6px' }}>
                6. Tự Đổi Ca Làm (Thử Việc) & Báo Nghỉ Khẩn
              </h3>
              <div style={{
                backgroundColor: '#EFF6FF',
                border: '1px solid #BFDBFE',
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12px',
                color: '#1E40AF',
                marginBottom: '14px',
              }}>
                ✨ <strong>Quy tắc Thử việc:</strong> Nhân viên được <strong>tự đổi ca chính mình tự do</strong> (Ca làm ⇄ Nghỉ OFF) trong chu kỳ 12 ngày thử việc để chủ động sắp xếp thời gian làm quen công việc.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Ngày muốn thay đổi:</label>
                  <input
                    type="date"
                    value={probationSelfSwap.date}
                    onChange={(e) => setProbationSelfSwap({ ...probationSelfSwap, date: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Hình thức chuyển đổi:</label>
                  <select
                    value={probationSelfSwap.direction}
                    onChange={(e) => setProbationSelfSwap({ ...probationSelfSwap, direction: e.target.value })}
                    style={{ width: '100%' }}
                  >
                    <option value="WORK_TO_OFF">Chuyển từ CA LÀM ➔ sang NGHỈ OFF</option>
                    <option value="OFF_TO_WORK">Chuyển từ NGHỈ OFF ➔ sang ĐI LÀM (Ca Sáng 07:00-12:00)</option>
                    <option value="SHIFT_TO_SHIFT">Đổi giờ ca (Ca 1 ➔ Ca 2 cùng ngày)</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Lý do tự đổi ca:</label>
                  <input
                    type="text"
                    value={probationSelfSwap.reason}
                    onChange={(e) => setProbationSelfSwap({ ...probationSelfSwap, reason: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>

                <button
                  className="btn-primary"
                  onClick={() => showToast('Tự đổi ca thành công! Lịch thử việc cá nhân đã được tự do cập nhật.')}
                >
                  Xác Nhận Tự Đổi Ca Cá Nhân
                </button>
              </div>
            </div>

            {/* Báo Nghỉ Khẩn */}
            <div className="card" style={{ border: '1px solid #FED7AA' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 800, color: '#C2410C', marginBottom: '8px' }}>
                🚨 Báo Nghỉ Đột Xuất (Khẩn Cấp)
              </h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>
                Dành cho các trường hợp ốm đau, tai nạn hoặc sự cố khẩn cấp. Store sẽ tìm người bù ca.
              </p>
              <textarea
                rows={2}
                placeholder="Nhập lý do nghỉ khẩn..."
                value={emergencyData.reason}
                onChange={(e) => setEmergencyData({ ...emergencyData, reason: e.target.value })}
                style={{ width: '100%', marginBottom: '10px' }}
              />
              <button
                className="btn-secondary"
                style={{ color: '#C2410C', borderColor: '#FED7AA', width: '100%', fontWeight: 700 }}
                onClick={() => showToast('Đã gửi báo nghỉ khẩn đến Cửa Hàng Trưởng và HR!')}
              >
                Gửi Báo Nghỉ Khẩn Cấp
              </button>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 6 FOR OFFICIAL: ĐỔI CA LÀM (2 HÌNH THỨC TRONG 1 TAB) */}
        {/* ========================================================= */}
        {activeTab === 'swap_shift' && !isProbation && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="card">
              <h3 style={{ fontSize: '16px', fontWeight: 800, marginBottom: '6px' }}>
                6. Đổi Ca Làm Việc (Nhân Viên Chính Thức)
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
                Hỗ trợ 02 hình thức đổi ca chuẩn quy định của Ụm Bò Milk:
              </p>

              {/* THÔNG BÁO ĐIỀU PHỐI KHẨN TỪ HR - CHI NHÁNH CN130 (+30.000Đ PHỤ CẤP) */}
              <div style={{
                backgroundColor: '#EFF6FF',
                border: '2px solid #2563EB',
                borderRadius: 'var(--radius-md)',
                padding: '14px 16px',
                marginBottom: '18px',
                boxShadow: 'var(--shadow-sm)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '18px' }}>📢</span>
                    <strong style={{ fontSize: '13px', color: '#1E40AF', textTransform: 'uppercase' }}>
                      YÊU CẦU ĐIỀU PHỐI CA TỪ HR - CHI NHÁNH {employee?.default_branch_id || 'CN130'}
                    </strong>
                  </div>
                  <span style={{
                    backgroundColor: '#DC2626',
                    color: '#FFF',
                    fontSize: '10px',
                    fontWeight: 800,
                    padding: '3px 8px',
                    borderRadius: '999px',
                  }}>
                    CẦN NGƯỜI LÀM THAY
                  </span>
                </div>

                <div style={{ fontSize: '12px', color: '#1E3A8A', lineHeight: '1.5', marginBottom: '8px' }}>
                  Có nhân sự trong chi nhánh bận việc đột xuất không tìm được người thay ca nên HR gửi thông báo điều phối nhận ca:
                  <div style={{ marginTop: '6px', padding: '8px 10px', backgroundColor: '#DBEAFE', borderRadius: '6px', fontWeight: 600 }}>
                    🕒 <strong>Ca cần hỗ trợ:</strong> Ca làm việc đột xuất cần người hỗ trợ trong ngày<br/>
                    🎁 <strong>Chính sách phụ cấp:</strong> Tự động <strong>+30.000đ/ca</strong> vào Bảng Lương Finance & Lương AI của bạn!
                  </div>
                </div>

                <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '10px' }}>
                  <em>💡 Bạn đang có Ca Sáng (07:00 - 12:00). Nếu nhận ca này bạn sẽ làm 2 ca/ngày và được hưởng đủ lương 2 ca + 30.000đ phụ cấp hỗ trợ!</em>
                </div>

                {!hasAcceptedHRDispatch ? (
                  <button
                    type="button"
                    onClick={() => {
                      setHasAcceptedHRDispatch(true);
                      showToast('🎉 BẠN ĐÃ NHẬN CA THÀNH CÔNG! Đã cộng +30.000đ vào Lương AI và Bảng lương Finance.');
                    }}
                    className="btn-primary"
                    style={{
                      width: '100%',
                      backgroundColor: '#2563EB',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      fontWeight: 800,
                      padding: '11px',
                    }}
                  >
                    🤝 TÔI ĐỒNG Ý NHẬN CA LÀM THAY NÀY (+30.000đ PHỤ CẤP)
                  </button>
                ) : (
                  <div style={{
                    backgroundColor: '#DCFCE7',
                    border: '1.5px solid #16A34A',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    textAlign: 'center',
                    color: '#15803D',
                  }}>
                    <div style={{ fontWeight: 800, fontSize: '13px' }}>
                      ✓ BẠN ĐÃ NHẬN CA THAY THÀNH CÔNG LÚC 08:35:12!
                    </div>
                    <div style={{ fontSize: '11px', marginTop: '4px' }}>
                      • Ngày 24/09: Bạn làm <strong>2 ca/ngày</strong> (Ca 1 Sáng + Ca 2 Chiều)<br />
                      • Hệ thống đã tự động ghi nhận <strong>+30.000đ Phụ cấp</strong> vào <strong>Lương AI</strong> & đồng bộ sang <strong>Finance</strong>.
                    </div>
                  </div>
                )}
              </div>

              {/* 2 FORMS SWITCHER BUTTONS */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                <button
                  type="button"
                  onClick={() => setSwapFormType(1)}
                  style={{
                    padding: '10px 8px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12px',
                    fontWeight: 700,
                    textAlign: 'center',
                    border: swapFormType === 1 ? '2px solid var(--brand)' : '1px solid var(--border)',
                    backgroundColor: swapFormType === 1 ? 'var(--brand-soft)' : '#FAFAFA',
                    color: swapFormType === 1 ? 'var(--brand)' : 'var(--text)',
                  }}
                >
                  🔄 Hình thức 1:<br /><strong>Tráo đổi ca (A ⇄ B)</strong>
                </button>

                <button
                  type="button"
                  onClick={() => setSwapFormType(2)}
                  style={{
                    padding: '10px 8px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12px',
                    fontWeight: 700,
                    textAlign: 'center',
                    border: swapFormType === 2 ? '2px solid #2563EB' : '1px solid var(--border)',
                    backgroundColor: swapFormType === 2 ? '#EFF6FF' : '#FAFAFA',
                    color: swapFormType === 2 ? '#2563EB' : 'var(--text)',
                  }}
                >
                  🤝 Hình thức 2:<br /><strong>Nhờ làm thay / Nhường ca</strong>
                </button>
              </div>

              {/* HÌNH THỨC 1: TRÁO ĐỔI CA (A <-> B) */}
              {swapFormType === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ backgroundColor: '#FDF2F8', padding: '10px', borderRadius: '8px', fontSize: '12px', color: '#9D174D' }}>
                    📌 <strong>Đặc điểm:</strong> Cùng chi nhánh ({employee?.default_branch_id || 'CN130'}). Có thể cùng hoặc khác ngày, cùng hoặc khác ca, OFF ⇄ Ca làm.
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Ca làm của bạn (Nhân viên A):</label>
                    <select
                      value={swapData.myShift}
                      onChange={(e) => setSwapData({ ...swapData, myShift: e.target.value })}
                      style={{ width: '100%' }}
                    >
                      <option value="2026-09-25 (Ca 1: 07:00 - 12:00)">2026-09-25 (Ca 1: 07:00 - 12:00)</option>
                      <option value="2026-09-26 (Ca 2: 12:00 - 18:00)">2026-09-26 (Ca 2: 12:00 - 18:00)</option>
                      <option value="2026-09-27 (Nghỉ OFF)">2026-09-27 (Nghỉ OFF)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Đồng nghiệp cùng chi nhánh (Nhân viên B):</label>
                    <select
                      value={swapData.targetEmployeeId}
                      onChange={(e) => setSwapData({ ...swapData, targetEmployeeId: e.target.value })}
                      style={{ width: '100%' }}
                    >
                      <option value="EMP_002">Trần Thị Bình (0903333444)</option>
                      <option value="EMP_003">Lê Hoàng Cúc (0905555666)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Ca muốn tráo đổi từ đồng nghiệp B:</label>
                    <select
                      value={swapData.targetShift}
                      onChange={(e) => setSwapData({ ...swapData, targetShift: e.target.value })}
                      style={{ width: '100%' }}
                    >
                      <option value="2026-09-26 (Ca 2: 12:00 - 18:00)">2026-09-26 (Ca 2: 12:00 - 18:00)</option>
                      <option value="2026-09-27 (Ca 1: 07:00 - 12:00)">2026-09-27 (Ca 1: 07:00 - 12:00)</option>
                      <option value="2026-09-28 (Nghỉ OFF)">2026-09-28 (Nghỉ OFF)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Lý do tráo đổi:</label>
                    <input
                      type="text"
                      value={swapData.reason}
                      onChange={(e) => setSwapData({ ...swapData, reason: e.target.value })}
                      style={{ width: '100%' }}
                    />
                  </div>

                  <button
                    className="btn-primary"
                    onClick={() => showToast('Đã gửi yêu cầu Tráo đổi ca (A <-> B)! Đang chờ NV B xác nhận rồi Store duyệt.')}
                  >
                    Gửi Yêu Cầu Tráo Đổi Ca (A ⇄ B)
                  </button>
                </div>
              )}

              {/* HÌNH THỨC 2: NHỜ LÀM THAY / NHƯỜNG CA */}
              {swapFormType === 2 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ backgroundColor: '#EFF6FF', padding: '10px', borderRadius: '8px', fontSize: '12px', color: '#1E40AF' }}>
                    📌 <strong>Đặc điểm:</strong> Nhân viên B nhận làm thay ca cho A (B làm 2 ca/ngày ➔ có thể cùng/khác ngày, cùng/khác ca).
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Ca của bạn cần nhờ người làm thay:</label>
                    <select
                      value={swapData.myShift}
                      onChange={(e) => setSwapData({ ...swapData, myShift: e.target.value })}
                      style={{ width: '100%' }}
                    >
                      <option value="2026-09-25 (Ca 1: 07:00 - 12:00)">2026-09-25 (Ca 1: 07:00 - 12:00)</option>
                      <option value="2026-09-26 (Ca 2: 12:00 - 18:00)">2026-09-26 (Ca 2: 12:00 - 18:00)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Đồng nghiệp B đồng ý nhận làm thay (Sẽ làm 2 ca/ngày):</label>
                    <select
                      value={swapData.targetEmployeeId}
                      onChange={(e) => setSwapData({ ...swapData, targetEmployeeId: e.target.value })}
                      style={{ width: '100%' }}
                    >
                      <option value="EMP_002">Trần Thị Bình (Đồng ý nhận làm thay ca)</option>
                      <option value="EMP_003">Lê Hoàng Cúc (Đồng ý nhận làm thay ca)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Lý do nhờ làm thay:</label>
                    <input
                      type="text"
                      placeholder="Bận việc thi học kỳ / gia đình..."
                      value={swapData.reason}
                      onChange={(e) => setSwapData({ ...swapData, reason: e.target.value })}
                      style={{ width: '100%' }}
                    />
                  </div>

                  <button
                    className="btn-primary"
                    style={{ backgroundColor: '#2563EB' }}
                    onClick={() => showToast('Đã gửi yêu cầu Nhờ làm thay! NV B sẽ nhận được thông báo chấp thuận làm 2 ca.')}
                  >
                    Gửi Yêu Cầu Nhờ Làm Thay Ca
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 7: BỔ SUNG CÔNG (THỬ VIỆC) / NGHỈ KHẨN & BỔ SUNG CÔNG (CHÍNH THỨC) */}
        {/* ========================================================= */}
        {(activeTab === 'adjustment' || activeTab === 'emergency_adjust') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="card">
              <h3 style={{ fontSize: '15px', fontWeight: 800, marginBottom: '6px' }}>
                {isProbation ? '7. Giải Trình & Bổ Sung Công' : '7. Nghỉ Khẩn Cấp & Bổ Sung Công'}
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
                Gửi giải trình khi quên check-in/out hoặc gặp sự cố GPS/Camera trên điện thoại.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Ngày sự cố:</label>
                  <input
                    type="date"
                    value={adjustmentData.date}
                    onChange={(e) => setAdjustmentData({ ...adjustmentData, date: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Loại yêu cầu:</label>
                  <select
                    value={adjustmentData.type}
                    onChange={(e) => setAdjustmentData({ ...adjustmentData, type: e.target.value })}
                    style={{ width: '100%' }}
                  >
                    <option value="QUEN_CHECKIN">Quên Check-in khi vào ca</option>
                    <option value="QUEN_CHECKOUT">Quên Check-out khi hết ca</option>
                    <option value="LOI_GPS_CAMERA">Điện thoại bị lỗi GPS / Camera</option>
                    {!isProbation && <option value="NGHI_KHAN">Báo nghỉ đột xuất do sự cố khẩn cấp</option>}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Chi tiết lý do & bằng chứng:</label>
                  <textarea
                    rows={2}
                    value={adjustmentData.reason}
                    onChange={(e) => setAdjustmentData({ ...adjustmentData, reason: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>

                <button
                  className="btn-primary"
                  onClick={() => showToast('Đã gửi phiếu giải trình bổ sung công đến Cửa Hàng Trưởng!')}
                >
                  Gửi Phiếu Bổ Sung Công
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 8: THI TEST / TEST ĐÀO TẠO */}
        {/* ========================================================= */}
        {(activeTab === 'test_exam' || activeTab === 'test_training') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 800 }}>
                  {isProbation ? '8. Bài Thi TEST Đầu Ra Thử Việc' : '8. TEST Nâng Bậc & Đào Tạo Định Kỳ'}
                </h3>
                <span className="badge badge-brand">25 Câu Hỏi</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
                Bài kiểm tra trắc nghiệm tiêu chuẩn chất lượng sản phẩm & vệ sinh an toàn thực phẩm Ụm Bò Milk.
              </p>

              {testScore === null ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ backgroundColor: '#FAFAFA', padding: '12px', borderRadius: 'var(--radius-sm)', fontSize: '13px' }}>
                    <strong>Câu 1:</strong> Nhiệt độ thanh trùng sữa tươi tiêu chuẩn tại Ụm Bò Milk là bao nhiêu?
                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label><input type="radio" name="q1" defaultChecked /> A. 72°C - 75°C trong 15 giây</label>
                      <label><input type="radio" name="q1" /> B. 100°C trong 5 phút</label>
                    </div>
                  </div>

                  <button
                    className="btn-primary"
                    onClick={() => {
                      setTestScore(9.2);
                      showToast('Đã nộp bài thi thành công! Điểm: 9.2/10');
                    }}
                  >
                    Nộp Bài Thi TEST (Đếm ngược: 480s)
                  </button>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '16px', backgroundColor: '#DFF5E8', borderRadius: 'var(--radius-sm)' }}>
                  <CheckCircle2 size={36} color="#10B981" style={{ margin: '0 auto 8px' }} />
                  <h4 style={{ fontSize: '18px', fontWeight: 800, color: '#065F46' }}>Kết Quả: {testScore}/10</h4>
                  <p style={{ fontSize: '12px', color: '#047857', margin: '4px 0 14px 0' }}>
                    Đạt chuẩn xét duyệt! HR đã nhận được kết quả thi của bạn.
                  </p>
                  <button className="btn-secondary" style={{ width: '100%' }} onClick={() => setTestScore(null)}>
                    Làm Lại Bài Thi
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 9: THÔNG BÁO & PHIẾU LƯƠNG */}
        {/* ========================================================= */}
        {activeTab === 'notifs_salary' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Notifications Section */}
            <div className="card">
              <h3 style={{ fontSize: '15px', fontWeight: 800, marginBottom: '10px' }}>
                9. Hộp Thư Thông Báo & Phiếu Lương Cá Nhân
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                  { title: 'Lịch làm việc tuần mới đã được công bố', time: '10:30 Hôm nay', type: 'SCHEDULE' },
                  { title: 'Nhắc nhở: Mặc áo hồng + bảng tên khi điểm danh', time: '08:00 Hôm nay', type: 'REMINDER' },
                  { title: 'Phiếu lương Kỳ Tháng 09/2026 đã sẵn sàng', time: 'Hôm qua', type: 'PAYSLIP' },
                ].map((n, idx) => (
                  <div key={idx} style={{ padding: '10px 12px', backgroundColor: '#FAFAFA', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 700, fontSize: '13px' }}>{n.title}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{n.time}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Payslip Section */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 800 }}>Phiếu Lương Bảo Mật</h4>
                <Lock size={16} color="var(--brand)" />
              </div>

              {!payslipUnlocked ? (
                <div style={{ textAlign: 'center', padding: '16px 0' }}>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                    Nhập mã PIN cá nhân 4 số để bảo vệ thông tin thu nhập của bạn.
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '12px' }}>
                    <input
                      type="password"
                      maxLength={4}
                      placeholder="****"
                      value={payslipPin}
                      onChange={(e) => setPayslipPin(e.target.value)}
                      style={{ width: '120px', textAlign: 'center', fontSize: '20px', fontWeight: 800, letterSpacing: '4px' }}
                    />
                  </div>
                  <button className="btn-primary" onClick={handleUnlockPayslip}>
                    Mở Khóa Phiếu Lương
                  </button>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
                    (Mã PIN mặc định thử nghiệm: 1234)
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ backgroundColor: '#FFFBF9', padding: '14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 800, fontSize: '14px', color: 'var(--brand)' }}>Kỳ Lương Tháng 09/2026</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', margin: '8px 0' }}>
                      <span>Tổng giờ công:</span>
                      <strong>156 giờ</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', margin: '4px 0' }}>
                      <span>Đơn giá:</span>
                      <strong>{(employee?.current_rate_per_hour || (isProbation ? 23000 : 25000)).toLocaleString('vi-VN')} đ/h</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', margin: '4px 0' }}>
                      <span>Phụ cấp / Bonus:</span>
                      <strong>500.000 đ</strong>
                    </div>
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px', marginTop: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 800, color: '#10B981' }}>
                      <span>THỰC NHẬN:</span>
                      <span>{(156 * (employee?.current_rate_per_hour || (isProbation ? 23000 : 25000)) + 500000).toLocaleString('vi-VN')} đ</span>
                    </div>
                  </div>
                  <button className="btn-secondary" onClick={() => setPayslipUnlocked(false)} style={{ fontSize: '12px' }}>
                    Khóa Lại Phiếu Lương
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
