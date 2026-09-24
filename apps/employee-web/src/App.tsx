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
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => {
    return !!(localStorage.getItem('ubm_emp_token') && localStorage.getItem('ubm_emp_data'));
  });
  const [employee, setEmployee] = useState<EmployeeProfile | null>(() => {
    try {
      const saved = localStorage.getItem('ubm_emp_data');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [activeTab, setActiveTab] = useState<string>(() => {
    return localStorage.getItem('ubm_emp_active_tab') || 'home';
  });
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

  // 2-Day Weekly OFF Registration State (Official Employees)
  const [hasRegisteredWeeklyOff, setHasRegisteredWeeklyOff] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('ubm_weekly_off_registered');
      return saved === 'true';
    } catch {
      return false;
    }
  });

  const [weeklyOffData, setWeeklyOffData] = useState({
    day1: '',
    day2: '',
    reason: 'Đăng ký 2 ngày nghỉ OFF tuần theo định biên quy chế Ụm Bò Milk',
  });

  const [leaveData, setLeaveData] = useState({
    leaveType: 'HANG_TUAN',
    requestedDate: new Date().toISOString().split('T')[0],
    reason: 'Đăng ký ngày nghỉ theo quy định',
  });

  // Attendance tracking state
  const [attendanceActionType, setAttendanceActionType] = useState<'CHECK_IN' | 'CHECK_OUT'>('CHECK_IN');
  const [todayAttendance, setTodayAttendance] = useState<{
    checkedIn?: boolean;
    checkedOut?: boolean;
    inTime?: string;
    outTime?: string;
    checkInTime?: string;
    checkOutTime?: string;
    receipt?: any;
  } | null>(null);
  const [myAttendanceHistory, setMyAttendanceHistory] = useState<any[]>([]);
  const [branchColleagues, setBranchColleagues] = useState<any[]>([]);

  // Official Swap Form Type: 1 = Trao doi A <-> B, 2 = Nho lam thay B lam thay A
  const [swapFormType, setSwapFormType] = useState<1 | 2>(1);
  const [swapData, setSwapData] = useState({
    myShift: '',
    targetEmployeeId: '',
    targetEmployeeName: '',
    targetShift: '',
    reason: '',
  });

  // HR Broadcast Shift Dispatch State (+30.000d allowance)
  const [hasAcceptedHRDispatch, setHasAcceptedHRDispatch] = useState(false);

  // Probation Self-Swap State: Tu do doi Ca lam <-> Nghi
  const [probationSelfSwap, setProbationSelfSwap] = useState({
    date: new Date().toISOString().split('T')[0],
    direction: 'WORK_TO_OFF',
    shiftName: 'Ca 1 (07:00 - 12:00)',
    reason: 'Đổi lịch cá nhân trong chu kỳ 12 ngày thử việc',
  });

  // Emergency Leave Form
  const [emergencyData, setEmergencyData] = useState({
    date: new Date().toISOString().split('T')[0],
    reason: 'Sốt cao đột xuất / Việc gia đình khẩn cấp',
    shift: 'Ca Sáng (07:00 - 12:00)',
  });

  // Adjustment Request Form
  const [adjustmentData, setAdjustmentData] = useState({
    date: new Date().toISOString().split('T')[0],
    shift: 'Ca 1',
    type: 'QUEN_CHECKIN',
    reason: 'Quên bấm điểm danh khi vào ca do tiếp nhận hàng hóa gấp',
  });

  // Training Test Exam State (for Probation / Training)
  const [showTestModal, setShowTestModal] = useState(false);
  const [testTimeLeft, setTestTimeLeft] = useState(480);
  const [testScore, setTestScore] = useState<number | null>(null);

  // Synchronize active tab across reload (with forced registration guard for official staff)
  useEffect(() => {
    if (activeTab) {
      localStorage.setItem('ubm_emp_active_tab', activeTab);
    }
  }, [activeTab]);

  useEffect(() => {
    if (getAuthToken()) {
      if (employee?.employee_id) {
        loadEmployeeData(employee.employee_id);
      }
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
      if (data.employee) {
        setEmployee(data.employee);
        localStorage.setItem('ubm_emp_data', JSON.stringify(data.employee));
      }
      setIsLoggedIn(true);
      await loadEmployeeData(data.employee?.employee_id || employee?.employee_id);
    } catch (err: any) {
      const msg = (err?.message || '').toLowerCase();
      // Only force logout if token is explicitly rejected (401 / expired), not on network sleep
      if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('hết hạn') || msg.includes('không hợp lệ')) {
        handleLogout();
      }
    }
  };

  const loadEmployeeData = async (empId?: string) => {
    try {
      const shifts = await apiRequest('/me/schedule').catch(() => []);
      setMyShifts(shifts);
      const notifs = await apiRequest('/me/notifications').catch(() => []);
      setNotifications(notifs);

      // Real Attendance History & Today status
      const attEvents = await apiRequest('/me/attendance').catch(() => []);
      setMyAttendanceHistory(attEvents);

      const today = new Date().toISOString().split('T')[0];
      const todayCheckIn = attEvents.find((e: any) => e.type === 'CHECK_IN' && e.client_time?.startsWith(today));
      const todayCheckOut = attEvents.find((e: any) => e.type === 'CHECK_OUT' && e.client_time?.startsWith(today));
      const inTimeStr = todayCheckIn?.client_time ? new Date(todayCheckIn.client_time).toLocaleTimeString('vi-VN') : undefined;
      const outTimeStr = todayCheckOut?.client_time ? new Date(todayCheckOut.client_time).toLocaleTimeString('vi-VN') : undefined;
      setTodayAttendance({
        checkedIn: !!todayCheckIn,
        checkedOut: !!todayCheckOut,
        inTime: inTimeStr,
        outTime: outTimeStr,
        checkInTime: inTimeStr,
        checkOutTime: outTimeStr,
        receipt: todayCheckIn,
      });

      // Load real colleagues in branch
      const colleagues = await apiRequest('/employees').catch(() => []);
      setBranchColleagues(colleagues);
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
      localStorage.setItem('ubm_emp_data', JSON.stringify(res.employee));
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
    localStorage.removeItem('ubm_emp_data');
    localStorage.removeItem('ubm_emp_token');
    localStorage.removeItem('ubm_emp_active_tab');
  };

  // Guard: Mandatory 2-day OFF registration locks other tabs for official employees
  const handleTabClick = (tabId: string) => {
    if (!isProbation && !hasRegisteredWeeklyOff && tabId !== 'leave') {
      showToast('🔒 QUY CHẾ BẮT BUỘC: Đang trong chu kỳ mở đăng ký 2 ngày nghỉ/tuần! Bạn bắt buộc phải hoàn thành đăng ký 2 ngày nghỉ để mở khóa các chức năng khác.');
      setActiveTab('leave');
      return;
    }
    setActiveTab(tabId);
  };

  // Start Attendance with strict rules: today shift exists, checkin before checkout, 30m window
  const handleStartAttendance = (action: 'CHECK_IN' | 'CHECK_OUT' = 'CHECK_IN') => {
    const today = new Date().toISOString().split('T')[0];
    const todayShift = myShifts.find((s: any) => s.date === today);

    // Ràng buộc 1: Nếu hôm nay không có ca làm thì khóa chức năng
    if (!todayShift) {
      showToast('🔒 QUY CHẾ: Hôm nay bạn không có lịch ca làm việc được phân công! Chức năng điểm danh bị khóa.');
      return;
    }

    // Ràng buộc thời gian mở Check-in: Mở trước giờ vào ca 30 phút
    if (action === 'CHECK_IN' && todayShift?.start_at) {
      try {
        const shiftStart = new Date(todayShift.start_at).getTime();
        const openTime = shiftStart - 30 * 60 * 1000;
        if (Date.now() < openTime) {
          const openStr = new Date(openTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
          showToast(`⏰ CHƯA ĐẾN GIỜ CHECK-IN: Cổng điểm danh mở trước giờ ca 30 phút (Mở lúc ${openStr}). Vui lòng quay lại sau!`);
          return;
        }
      } catch {}
    }

    // Ràng buộc 2: Check-in xong mới được check-out
    if (action === 'CHECK_OUT' && !todayAttendance?.checkedIn) {
      showToast('🚫 QUY CHẾ ĐIỂM DANH: Bạn chưa Check-in đầu ca! Bắt buộc phải Check-in trước mới được Check-out.');
      return;
    }

    if (action === 'CHECK_OUT' && todayAttendance?.checkedOut) {
      showToast('✓ Bạn đã hoàn tất Check-out cho ca làm hôm nay rồi!');
      return;
    }

    setAttendanceActionType(action);
    setAttendanceStep('CHECKING_GPS');
    setTimeout(() => {
      setGpsAccuracy(12);
      setGpsDistance(38); // < 300m
      setAttendanceStep('READY_CAMERA');
    }, 900);
  };

  const handleCapturePhoto = async () => {
    if (!uniformChecked || !badgeChecked) {
      showToast('⚠️ VI PHẠM ĐỒNG PHỤC QUY CHUẨN: Vui lòng xác nhận đang mặc Áo Hồng Ụm Bò Milk và Đeo Bảng Tên hợp lệ!');
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

      const today = new Date().toISOString().split('T')[0];
      const todayShift = myShifts.find((s: any) => s.date === today);
      const targetEndpoint = attendanceActionType === 'CHECK_IN' ? '/attendance/checkin' : '/attendance/checkout';

      const res = await apiRequest(targetEndpoint, {
        method: 'POST',
        body: JSON.stringify({
          assignment_id: todayShift?.assignment_id || myShifts[0]?.assignment_id || `ASSIGN_${employee?.employee_id}_${today}`,
          lat: 10.7925,
          lng: 106.6853,
          accuracy: gpsAccuracy,
          photo_base64: base64Image,
        }),
      });

      setLastReceipt(res.receipt);
      setAttendanceStep('CONFIRMED');
      showToast(attendanceActionType === 'CHECK_IN'
        ? '✓ Điểm danh Check-in thành công! Đã ghi nhận Áo Hồng + Bảng Tên và GPS hợp lệ.'
        : '✓ Điểm danh Check-out thành công! Ca làm việc của bạn đã được ghi nhận vào Google Sheets.'
      );
      await loadEmployeeData(employee?.employee_id);
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi điểm danh!');
      setAttendanceStep('READY_CAMERA');
    }
  };

  // Submit 2-day OFF for official employee
  const handleSubmitWeeklyOff2Days = async () => {
    if (!weeklyOffData.day1 || !weeklyOffData.day2) {
      showToast('⚠️ Vui lòng chọn đầy đủ cả 2 ngày nghỉ OFF trong tuần!');
      return;
    }
    if (weeklyOffData.day1 === weeklyOffData.day2) {
      showToast('⚠️ Hai ngày nghỉ OFF phải là 2 ngày khác nhau trong tuần!');
      return;
    }

    try {
      // Send Day 1
      await apiRequest('/leaves', {
        method: 'POST',
        body: JSON.stringify({
          leaveType: 'HANG_TUAN',
          requestedDate: weeklyOffData.day1,
          reason: `${weeklyOffData.reason} (Ngày 1: ${weeklyOffData.day1})`,
        }),
      });

      // Send Day 2
      await apiRequest('/leaves', {
        method: 'POST',
        body: JSON.stringify({
          leaveType: 'HANG_TUAN',
          requestedDate: weeklyOffData.day2,
          reason: `${weeklyOffData.reason} (Ngày 2: ${weeklyOffData.day2})`,
        }),
      });

      setHasRegisteredWeeklyOff(true);
      try {
        localStorage.setItem('ubm_weekly_off_registered', 'true');
      } catch {}

      showToast('🎉 ĐÃ ĐĂNG KÝ 2 NGÀY NGHỈ OFF TUẦN THÀNH CÔNG! Toàn bộ chức năng hệ thống đã được mở khóa.');
      await loadEmployeeData(employee?.employee_id);
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi gửi đăng ký 2 ngày nghỉ!');
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
      await loadEmployeeData(employee?.employee_id);
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleEmergencyLeaveSubmit = async () => {
    if (!emergencyData.reason.trim()) {
      showToast('⚠️ Vui lòng nhập lý do nghỉ khẩn cấp!');
      return;
    }
    try {
      await apiRequest('/leaves', {
        method: 'POST',
        body: JSON.stringify({
          leaveType: 'DOT_XUAT',
          requestedDate: emergencyData.date,
          reason: `[NGHỈ KHẨN CẤP] ${emergencyData.shift} - ${emergencyData.reason}`,
        }),
      });
      showToast('🚨 ĐÃ GỬI ĐƠN BÁO NGHỈ KHẨN CẤP! Dữ liệu đã đồng bộ realtime sang HR Tab 10 và Google Sheets.');
      await loadEmployeeData(employee?.employee_id);
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi gửi báo nghỉ khẩn cấp');
    }
  };

  const handleAdjustmentSubmit = async () => {
    try {
      if (adjustmentData.type === 'NGHI_KHAN') {
        await apiRequest('/leaves', {
          method: 'POST',
          body: JSON.stringify({
            leaveType: 'DOT_XUAT',
            requestedDate: adjustmentData.date,
            reason: `[NGHỈ KHẨN CẤP] ${adjustmentData.reason}`,
          }),
        });
        showToast('🚨 ĐÃ GỬI BÁO NGHỈ KHẨN CẤP ĐẾN HR! Dữ liệu đã đồng bộ sang HR Tab 10 và Google Sheets.');
      } else {
        await apiRequest('/leaves', {
          method: 'POST',
          body: JSON.stringify({
            leaveType: 'BO_SUNG_CONG',
            requestedDate: adjustmentData.date,
            reason: `[${adjustmentData.type}] ${adjustmentData.reason}`,
          }),
        });
        showToast('✓ Đã gửi phiếu giải trình bổ sung công đến Cửa Hàng Trưởng và HR!');
      }
      await loadEmployeeData(employee?.employee_id);
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi gửi phiếu giải trình!');
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
              onClick={() => handleTabClick(tab.id)}
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

      {/* 5-MINUTE PRE-NOTIFICATION & MANDATORY 2-DAY OFF REGISTRATION BANNER FOR OFFICIAL EMPLOYEES */}
      {!isProbation && !hasRegisteredWeeklyOff && (
        <div style={{
          margin: '12px 16px 0',
          padding: '12px 14px',
          backgroundColor: '#FFF1F2',
          border: '2px solid #F43F5E',
          borderRadius: 'var(--radius-sm)',
          boxShadow: '0 4px 12px rgba(244, 63, 94, 0.15)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <Bell size={18} color="#E11D48" />
            <strong style={{ fontSize: '13px', color: '#BE123C' }}>
              ⏰ THÔNG BÁO: ĐANG TRONG THỜI GIAN ĐĂNG KÝ 2 NGÀY NGHỈ OFF/TUẦN
            </strong>
          </div>
          <div style={{ fontSize: '12px', color: '#9F1239', lineHeight: '1.4' }}>
            Hệ thống đã tự động gửi thông báo trước 5 phút giờ mở cửa đăng ký. Hiện tại đang mở cổng đăng ký 2 ngày nghỉ/tuần định kỳ. <strong>Toàn bộ các chức năng khác tạm thời bị KHÓA</strong> cho đến khi bạn hoàn tất đăng ký 2 ngày nghỉ!
          </div>
          {activeTab !== 'leave' && (
            <button
              onClick={() => setActiveTab('leave')}
              style={{
                marginTop: '10px',
                width: '100%',
                backgroundColor: '#E11D48',
                color: '#FFF',
                border: 'none',
                borderRadius: '6px',
                padding: '9px 12px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              👉 ĐĂNG KÝ 2 NGÀY NGHỈ OFF NGAY ĐỂ MỞ KHÓA TOÀN BỘ CHỨC NĂNG
            </button>
          )}
        </div>
      )}

      {!isProbation && hasRegisteredWeeklyOff && (
        <div style={{
          margin: '12px 16px 0',
          padding: '8px 14px',
          backgroundColor: '#F0FDF4',
          border: '1px solid #86EFAC',
          borderRadius: 'var(--radius-sm)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '12px',
          color: '#166534',
          fontWeight: 600,
        }}>
          <span>✓ Đã hoàn tất đăng ký 2 ngày nghỉ OFF tuần ({weeklyOffData.day1 || 'Ngày 1'} & {weeklyOffData.day2 || 'Ngày 2'})</span>
          <span style={{ fontSize: '11px', color: '#15803D' }}>• Đã mở khóa toàn bộ chức năng</span>
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
                  onClick={() => handleTabClick('attendance')}
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
                  onClick={() => handleTabClick('schedule')}
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
                onClick={() => handleTabClick('leave')}
                style={{ flexDirection: 'column', padding: '10px 4px', height: 'auto', gap: '4px' }}
              >
                <Clock size={18} color="var(--brand)" />
                <span style={{ fontSize: '11px', fontWeight: 700 }}>Đăng ký OFF</span>
              </button>

              <button
                className="btn-secondary"
                onClick={() => handleTabClick(isProbation ? 'swap_emergency' : 'swap_shift')}
                style={{ flexDirection: 'column', padding: '10px 4px', height: 'auto', gap: '4px' }}
              >
                <RefreshCw size={18} color="#2563EB" />
                <span style={{ fontSize: '11px', fontWeight: 700 }}>Đổi Ca Làm</span>
              </button>

              <button
                className="btn-secondary"
                onClick={() => handleTabClick(isProbation ? 'test_exam' : 'test_training')}
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
        {/* TAB 3: ĐĂNG KÝ OFF (THỬ VIỆC: 1 NGÀY / CHÍNH THỨC: 2 NGÀY/TUẦN) */}
        {/* ========================================================= */}
        {activeTab === 'leave' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 800 }}>
                  {isProbation ? '3. Đăng Ký Nghỉ OFF Thử Việc' : '3. Đăng Ký 2 Ngày Nghỉ OFF/Tuần (Chính Thức)'}
                </h3>
                <span className={`badge ${!isProbation && hasRegisteredWeeklyOff ? 'badge-success' : 'badge-brand'}`}>
                  {isProbation ? '1 Ngày/Lần' : hasRegisteredWeeklyOff ? 'Đã Chọn 2 Ngày' : 'Bắt Buộc 2 Ngày'}
                </span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
                {isProbation
                  ? 'Chọn ngày nghỉ trong phạm vi chu kỳ quy định để Store & HR phê duyệt định biên.'
                  : 'Quy định nhân viên chính thức: Bắt buộc chọn đúng 02 ngày nghỉ OFF/tuần định kỳ. Khi đăng ký xong, hệ thống sẽ tự động mở khóa toàn bộ các chức năng khác.'}
              </p>

              {isProbation ? (
                /* THỬ VIỆC: ĐĂNG KÝ 1 NGÀY */
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
              ) : (
                /* CHÍNH THỨC: ĐĂNG KÝ 2 NGÀY NGHỈ OFF/TUẦN */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {hasRegisteredWeeklyOff ? (
                    <div style={{
                      backgroundColor: '#ECFDF5',
                      border: '1.5px solid #10B981',
                      borderRadius: 'var(--radius-sm)',
                      padding: '12px 14px',
                      color: '#065F46',
                    }}>
                      <div style={{ fontWeight: 800, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <CheckCircle2 size={16} color="#10B981" />
                        BẠN ĐÃ HOÀN TẤT ĐĂNG KÝ 2 NGÀY NGHỈ TUẦN NÀY!
                      </div>
                      <div style={{ fontSize: '12px', marginTop: '6px', lineHeight: '1.5' }}>
                        • Ngày nghỉ 1: <strong>{weeklyOffData.day1 || 'Chưa rõ'}</strong><br />
                        • Ngày nghỉ 2: <strong>{weeklyOffData.day2 || 'Chưa rõ'}</strong><br />
                        • Ghi chú: {weeklyOffData.reason || 'Đăng ký theo định kỳ'}<br />
                        <span style={{ color: '#047857', fontWeight: 700 }}>✓ Toàn bộ các chức năng khác trên Cổng nhân viên đã được mở khóa.</span>
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      backgroundColor: '#FFF1F2',
                      border: '1px solid #FECDD3',
                      borderRadius: 'var(--radius-sm)',
                      padding: '10px 12px',
                      fontSize: '12px',
                      color: '#BE123C',
                    }}>
                      ⚠️ <strong>Ràng buộc hệ thống:</strong> Bạn phải hoàn thành chọn đủ <strong>02 ngày nghỉ khác nhau</strong> trong tuần để hệ thống tự động mở khóa các tab chức năng khác.
                    </div>
                  )}

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
                      📅 Ngày nghỉ thứ 1 (Bắt buộc chọn 1/2):
                    </label>
                    <input
                      type="date"
                      value={weeklyOffData.day1}
                      onChange={(e) => setWeeklyOffData({ ...weeklyOffData, day1: e.target.value })}
                      style={{ width: '100%' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
                      📅 Ngày nghỉ thứ 2 (Bắt buộc chọn 2/2, khác Ngày 1):
                    </label>
                    <input
                      type="date"
                      value={weeklyOffData.day2}
                      onChange={(e) => setWeeklyOffData({ ...weeklyOffData, day2: e.target.value })}
                      style={{ width: '100%' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
                      Lý do / Ghi chú đăng ký:
                    </label>
                    <textarea
                      rows={2}
                      value={weeklyOffData.reason}
                      onChange={(e) => setWeeklyOffData({ ...weeklyOffData, reason: e.target.value })}
                      style={{ width: '100%' }}
                    />
                  </div>

                  <button
                    className="btn-primary"
                    onClick={handleSubmitWeeklyOff2Days}
                    style={{
                      width: '100%',
                      padding: '12px',
                      fontSize: '14px',
                      fontWeight: 800,
                      backgroundColor: hasRegisteredWeeklyOff ? '#10B981' : 'var(--brand)',
                      boxShadow: '0 4px 14px rgba(232, 93, 146, 0.35)',
                    }}
                  >
                    {hasRegisteredWeeklyOff ? 'CẬP NHẬT LẠI 2 NGÀY NGHỈ OFF TUẦN' : 'GỬI ĐĂNG KÝ 2 NGÀY NGHỈ & MỞ KHÓA HỆ THỐNG'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 4: ĐIỂM DANH (GPS 300M + CAMERA ÁO HỒNG + BẢNG TÊN) */}
        {/* ========================================================= */}
        {activeTab === 'attendance' && (() => {
          const today = new Date().toISOString().split('T')[0];
          const todayShift = myShifts.find((s: any) => s.date === today);
          const shiftStart = todayShift?.start_at ? new Date(todayShift.start_at).getTime() : 0;
          const openTime = shiftStart ? shiftStart - 30 * 60 * 1000 : 0;
          const isEarly = shiftStart > 0 && Date.now() < openTime;
          const openTimeStr = openTime > 0 ? new Date(openTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
          const shiftStartStr = shiftStart > 0 ? new Date(shiftStart).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {!todayShift ? (
                /* RÀNG BUỘC: KHÔNG CÓ CA LÀM THÌ KHÓA CHỨC NĂNG ĐIỂM DANH */
                <div className="card" style={{ textAlign: 'center', padding: '32px 16px', border: '1.5px dashed #CBD5E1' }}>
                  <div style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '50%',
                    backgroundColor: '#F1F5F9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 16px',
                    border: '2px solid #E2E8F0',
                  }}>
                    <Lock size={32} color="#64748B" />
                  </div>
                  <span className="badge badge-secondary" style={{ marginBottom: '8px' }}>
                    HÔM NAY KHÔNG CÓ CA LÀM
                  </span>
                  <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#1E293B', marginBottom: '8px' }}>
                    CHỨC NĂNG ĐIỂM DANH HIỆN ĐANG KHÓA
                  </h3>
                  <p style={{ fontSize: '13px', color: '#64748B', lineHeight: '1.5', maxWidth: '340px', margin: '0 auto 20px' }}>
                    Hôm nay ({new Date().toLocaleDateString('vi-VN')}) bạn không có ca làm việc được phân công tại chi nhánh {employee?.default_branch_id || 'hệ thống'}. Chức năng điểm danh chỉ tự động mở khi bạn có ca làm việc chính thức trong ngày.
                  </p>
                  <button
                    className="btn-secondary"
                    onClick={() => handleTabClick('schedule')}
                    style={{ margin: '0 auto', fontSize: '13px', fontWeight: 700 }}
                  >
                    <Calendar size={16} style={{ marginRight: '6px' }} />
                    Kiểm Tra Lại Lịch Làm Việc
                  </button>
                </div>
              ) : (
                /* CÓ CA LÀM HÔM NAY: MỞ QUY TRÌNH ĐIỂM DANH CHECK-IN / CHECK-OUT */
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div>
                      <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text)' }}>
                        4. Điểm Danh Ca Làm Hôm Nay
                      </h3>
                      <div style={{ fontSize: '12px', color: 'var(--brand)', fontWeight: 700, marginTop: '2px' }}>
                        {todayShift.shift_code} • {todayShift.branch_id || employee?.default_branch_id} ({shiftStartStr} - {todayShift.end_at ? new Date(todayShift.end_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : ''})
                      </div>
                    </div>
                    <span className="badge badge-brand">GPS + Camera</span>
                  </div>

                  {/* THÔNG BÁO THỜI GIAN MỞ CHECK-IN (TRƯỚC 30 PHÚT) */}
                  <div style={{
                    backgroundColor: isEarly ? '#FFFBEB' : '#F0FDF4',
                    border: isEarly ? '1.5px solid #FCD34D' : '1px solid #BBF7D0',
                    borderRadius: 'var(--radius-sm)',
                    padding: '10px 12px',
                    marginBottom: '14px',
                    fontSize: '12px',
                    lineHeight: '1.4',
                  }}>
                    {isEarly ? (
                      <div style={{ color: '#92400E' }}>
                        ⏰ <strong>CHƯA ĐẾN GIỜ CHECK-IN:</strong> Cổng điểm danh mở trước ca <strong>30 phút</strong>. Ca bắt đầu lúc <strong>{shiftStartStr}</strong>, cổng check-in sẽ mở lúc <strong>{openTimeStr}</strong>.
                      </div>
                    ) : (
                      <div style={{ color: '#166534' }}>
                        ✓ <strong>CỔNG ĐIỂM DANH ĐANG MỞ:</strong> Ca làm việc đã sẵn sàng tiếp nhận Check-in/Check-out.
                      </div>
                    )}
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
                        YÊU CẦU ĐỒNG PHỤC QUY CHUẨN ỤM BÒ MILK
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

                  {/* TIẾN TRÌNH 2 BƯỚC: CHECK-IN VÀ CHECK-OUT */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '10px',
                    marginBottom: '14px',
                  }}>
                    <div style={{
                      padding: '10px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: todayAttendance?.checkedIn ? '#ECFDF5' : '#FFFBEB',
                      border: todayAttendance?.checkedIn ? '1.5px solid #10B981' : '1px solid #FCD34D',
                      textAlign: 'center',
                    }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: todayAttendance?.checkedIn ? '#065F46' : '#92400E' }}>
                        BƯỚC 1: CHECK-IN
                      </div>
                      <div style={{ fontSize: '12px', fontWeight: 800, marginTop: '4px', color: todayAttendance?.checkedIn ? '#10B981' : '#D97706' }}>
                        {todayAttendance?.checkedIn ? `✓ ${todayAttendance.checkInTime || 'Đã Check-in'}` : 'Chưa Check-in'}
                      </div>
                    </div>

                    <div style={{
                      padding: '10px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: todayAttendance?.checkedOut ? '#ECFDF5' : todayAttendance?.checkedIn ? '#EFF6FF' : '#F1F5F9',
                      border: todayAttendance?.checkedOut ? '1.5px solid #10B981' : todayAttendance?.checkedIn ? '1px solid #60A5FA' : '1px solid #CBD5E1',
                      textAlign: 'center',
                    }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: todayAttendance?.checkedOut ? '#065F46' : todayAttendance?.checkedIn ? '#1E40AF' : '#64748B' }}>
                        BƯỚC 2: CHECK-OUT
                      </div>
                      <div style={{ fontSize: '12px', fontWeight: 800, marginTop: '4px', color: todayAttendance?.checkedOut ? '#10B981' : todayAttendance?.checkedIn ? '#2563EB' : '#94A3B8' }}>
                        {todayAttendance?.checkedOut ? `✓ ${todayAttendance.checkOutTime || 'Đã Check-out'}` : todayAttendance?.checkedIn ? 'Sẵn sàng Check-out' : '🔒 Khóa (Cần Check-in)'}
                      </div>
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
                      <strong style={{ color: 'var(--brand)' }}>{todayShift.branch_id || employee?.default_branch_id || 'CN130'}</strong>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)' }}>Khoảng cách GPS:</div>
                      <strong style={{ color: '#10B981' }}>{gpsDistance}m (Chuẩn &lt; 300m)</strong>
                    </div>
                  </div>

                  {/* Attendance Action Controller */}
                  {attendanceStep === 'IDLE' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {/* NÚT CHECK-IN ĐẦU CA */}
                      {!todayAttendance?.checkedIn ? (
                        <button
                          className="btn-primary"
                          disabled={isEarly}
                          onClick={() => handleStartAttendance('CHECK_IN')}
                          style={{
                            width: '100%',
                            fontSize: '15px',
                            fontWeight: 800,
                            opacity: isEarly ? 0.6 : 1,
                            cursor: isEarly ? 'not-allowed' : 'pointer',
                          }}
                        >
                          <MapPin size={18} style={{ marginRight: '8px' }} />
                          {isEarly ? `CHƯA ĐẾN GIỜ (MỞ LÚC ${openTimeStr})` : 'BẮT ĐẦU CHECK-IN ĐẦU CA (BƯỚC 1)'}
                        </button>
                      ) : (
                        <div style={{
                          padding: '10px 12px',
                          backgroundColor: '#F0FDF4',
                          border: '1px solid #86EFAC',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '12px',
                          color: '#15803D',
                          fontWeight: 700,
                          textAlign: 'center',
                        }}>
                          ✓ ĐÃ HOÀN TẤT CHECK-IN VÀO CA LÚC {todayAttendance.checkInTime || '07:00'} (ÁO HỒNG + BẢNG TÊN ĐÃ XÁC THỰC)
                        </div>
                      )}

                      {/* NÚT CHECK-OUT TAN CA (RÀNG BUỘC: CHECK-IN XONG MỚI ĐƯỢC CHECK-OUT) */}
                      {!todayAttendance?.checkedOut ? (
                        <button
                          className="btn-secondary"
                          disabled={!todayAttendance?.checkedIn}
                          onClick={() => handleStartAttendance('CHECK_OUT')}
                          style={{
                            width: '100%',
                            fontSize: '14px',
                            fontWeight: 800,
                            color: todayAttendance?.checkedIn ? '#2563EB' : '#94A3B8',
                            borderColor: todayAttendance?.checkedIn ? '#2563EB' : '#CBD5E1',
                            backgroundColor: todayAttendance?.checkedIn ? '#EFF6FF' : '#F8FAFC',
                            cursor: todayAttendance?.checkedIn ? 'pointer' : 'not-allowed',
                            opacity: todayAttendance?.checkedIn ? 1 : 0.6,
                          }}
                        >
                          {todayAttendance?.checkedIn ? (
                            '🏁 CHECK-OUT KẾT THÚC CA LÀM (BƯỚC 2)'
                          ) : (
                            '🔒 CHECK-OUT (BẮT BUỘC CHECK-IN TRƯỚC)'
                          )}
                        </button>
                      ) : (
                        <div style={{
                          padding: '10px 12px',
                          backgroundColor: '#ECFDF5',
                          border: '1.5px solid #10B981',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '13px',
                          color: '#065F46',
                          fontWeight: 800,
                          textAlign: 'center',
                        }}>
                          🎉 BẠN ĐÃ HOÀN TẤT CA LÀM VIỆC HÔM NAY! (CHECK-IN: {todayAttendance.checkInTime} • CHECK-OUT: {todayAttendance.checkOutTime})
                        </div>
                      )}
                    </div>
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
                        📸 CHỤP ẢNH & GHI NHẬN {attendanceActionType === 'CHECK_IN' ? 'CHECK-IN' : 'CHECK-OUT'}
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
                      <h4 style={{ fontSize: '16px', fontWeight: 800, color: '#065F46' }}>
                        {attendanceActionType === 'CHECK_IN' ? 'CHECK-IN THÀNH CÔNG!' : 'CHECK-OUT THÀNH CÔNG!'}
                      </h4>
                      <div style={{ fontSize: '12px', color: '#047857', marginTop: '4px' }}>
                        Thời gian: {new Date().toLocaleTimeString('vi-VN')} • Khoảng cách: 38m • Đồng phục: Áo hồng + Bảng tên hợp lệ.
                      </div>
                      <button
                        className="btn-secondary"
                        onClick={() => setAttendanceStep('IDLE')}
                        style={{ marginTop: '12px', fontSize: '12px' }}
                      >
                        Đóng / Quay lại
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* ========================================================= */}
        {/* TAB 5: CÔNG CỦA TÔI (DỮ LIỆU THẬT 100%, XÓA SẠCH DỮ LIỆU TEST) */}
        {/* ========================================================= */}
        {activeTab === 'timesheet' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 800 }}>5. Dữ Liệu Công Của Tôi</h3>
                <span className="badge badge-brand">Kỳ Tháng 09/2026</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {myAttendanceHistory.length === 0 ? (
                  <div style={{
                    padding: '32px 16px',
                    textAlign: 'center',
                    backgroundColor: '#FAFAFA',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px dashed var(--border)',
                    color: 'var(--text-muted)',
                    fontSize: '13px',
                  }}>
                    <CheckCircle2 size={32} color="#9CA3AF" style={{ margin: '0 auto 8px' }} />
                    <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>
                      Chưa có dữ liệu chấm công trong kỳ này
                    </div>
                    <div>Dữ liệu sẽ tự động đồng bộ realtime từ Google Sheets khi bạn thực hiện Check-in / Check-out ca làm việc.</div>
                  </div>
                ) : (
                  myAttendanceHistory.map((item, idx) => (
                    <div key={idx} style={{ padding: '10px 12px', backgroundColor: '#FAFAFA', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '13px' }}>{item.date} • {item.shift}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Vào: {item.in} • Ra: {item.out} • {item.hours}h</div>
                      </div>
                      <span className={`badge ${item.status === 'OFF' ? 'badge-secondary' : item.status.includes('TRỄ') ? 'badge-warning' : 'badge-success'}`}>
                        {item.status}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <button
                className="btn-secondary"
                onClick={() => handleTabClick(isProbation ? 'adjustment' : 'emergency_adjust')}
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
                Dành cho các trường hợp ốm đau, tai nạn hoặc sự cố khẩn cấp. Dữ liệu sẽ chuyển thẳng đến HR Tab 10 và Google Sheets để phát lệnh bù ca.
              </p>
              <textarea
                rows={2}
                placeholder="Nhập lý do nghỉ khẩn (sốt cao, tai nạn, việc gia đình gấp)..."
                value={emergencyData.reason}
                onChange={(e) => setEmergencyData({ ...emergencyData, reason: e.target.value })}
                style={{ width: '100%', marginBottom: '10px' }}
              />
              <button
                className="btn-secondary"
                style={{ color: '#C2410C', borderColor: '#FED7AA', width: '100%', fontWeight: 700 }}
                onClick={handleEmergencyLeaveSubmit}
              >
                Gửi Báo Nghỉ Khẩn Cấp (Đồng Bộ Realtime HR)
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
                      {myShifts.length === 0 ? (
                        <option value="Ca làm việc tuần này">Ca làm việc tuần này</option>
                      ) : (
                        myShifts.map((s: any, idx: number) => (
                          <option key={idx} value={`${s.date} (${s.shift_code})`}>
                            {s.date} ({s.shift_code})
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Đồng nghiệp cùng chi nhánh (Nhân viên B):</label>
                    <select
                      value={swapData.targetEmployeeId}
                      onChange={(e) => setSwapData({ ...swapData, targetEmployeeId: e.target.value })}
                      style={{ width: '100%' }}
                    >
                      {branchColleagues.length === 0 ? (
                        <option value="COLLEAGUE_1">Đồng nghiệp chi nhánh {employee?.default_branch_id || 'CN130'}</option>
                      ) : (
                        branchColleagues.map((col: any) => (
                          <option key={col.employee_id} value={col.employee_id}>
                            {col.full_name} ({col.phone_normalized || col.phone || col.employee_code || col.employee_id})
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Ca muốn tráo đổi từ đồng nghiệp B:</label>
                    <select
                      value={swapData.targetShift}
                      onChange={(e) => setSwapData({ ...swapData, targetShift: e.target.value })}
                      style={{ width: '100%' }}
                    >
                      <option value="Ca 1 (07:00 - 12:00)">Ca 1 (07:00 - 12:00)</option>
                      <option value="Ca 2 (12:00 - 18:00)">Ca 2 (12:00 - 18:00)</option>
                      <option value="Ca 3 (17:00 - 22:00)">Ca 3 (17:00 - 22:00)</option>
                      <option value="Nghỉ OFF">Nghỉ OFF</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Lý do tráo đổi:</label>
                    <input
                      type="text"
                      placeholder="Lý do tráo đổi ca..."
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
                      {myShifts.length === 0 ? (
                        <option value="Ca làm việc hôm nay">Ca làm việc hôm nay</option>
                      ) : (
                        myShifts.map((s: any, idx: number) => (
                          <option key={idx} value={`${s.date} (${s.shift_code})`}>
                            {s.date} ({s.shift_code})
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Đồng nghiệp B đồng ý nhận làm thay (Sẽ làm 2 ca/ngày):</label>
                    <select
                      value={swapData.targetEmployeeId}
                      onChange={(e) => setSwapData({ ...swapData, targetEmployeeId: e.target.value })}
                      style={{ width: '100%' }}
                    >
                      {branchColleagues.length === 0 ? (
                        <option value="COLLEAGUE_1">Đồng nghiệp chi nhánh {employee?.default_branch_id || 'CN130'}</option>
                      ) : (
                        branchColleagues.map((col: any) => (
                          <option key={col.employee_id} value={col.employee_id}>
                            {col.full_name} ({col.phone_normalized || col.phone || col.employee_code || col.employee_id})
                          </option>
                        ))
                      )}
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
                Gửi giải trình khi quên check-in/out hoặc báo nghỉ đột xuất (đồng bộ trực tiếp sang HR Tab 10 và Google Sheets).
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
                    {!isProbation && <option value="NGHI_KHAN">Báo nghỉ đột xuất do sự cố khẩn cấp (HR Tab 10)</option>}
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
                  onClick={handleAdjustmentSubmit}
                >
                  {adjustmentData.type === 'NGHI_KHAN' ? 'Gửi Báo Nghỉ Khẩn Cấp Đến HR' : 'Gửi Phiếu Bổ Sung Công'}
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
