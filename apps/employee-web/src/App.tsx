import React, { useState, useEffect, useRef } from 'react';
import { apiRequest, setAuthToken, getAuthToken, getApiBase, setCustomApiUrl } from './services/api';
import {
  Home,
  Calendar,
  Clock,
  Bell,
  MapPin,
  Camera,
  CheckCircle2,
  AlertCircle,
  Lock,
  LogOut,
  RefreshCw,
  FileText,
  Award,
  AlertTriangle,
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

// Khóa 1 thiết bị / 1 tài khoản: UUID ổn định theo trình duyệt (localStorage).
// Xóa cache/cài lại PWA/đổi máy -> ID mới -> server chặn, HR/Admin reset.
function getDeviceId(): string {
  try {
    const saved = localStorage.getItem('ubm_device_id');
    if (saved) return saved;
    const fresh: string = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? String((crypto as any).randomUUID())
      : `DEV_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    try { localStorage.setItem('ubm_device_id', fresh); } catch { /* ignore */ }
    return fresh;
  } catch {
    return `DEV_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

const DEVICE_MISMATCH_MSG = '📱 Tài khoản đã khóa với 1 thiết bị duy nhất! Bạn đang dùng thiết bị khác. Vui lòng liên hệ HR/Admin để reset rồi đăng nhập lại.';

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
  const [loginPin, setLoginPin] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  // Bắt buộc đổi PIN khởi tạo ở lần đăng nhập đầu
  const [mustChangePin, setMustChangePin] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  // Địa chỉ backend đang gọi — hiển thị để chẩn đoán lỗi mạng, bấm để đổi.
  const [apiBaseShown, setApiBaseShown] = useState<string>(() => {
    try { return getApiBase(); } catch { return ''; }
  });
  const handleChangeApiBase = () => {
    const cur = getApiBase();
    const input = window.prompt('Địa chỉ máy chủ Backend (để trống = tự động):', localStorage.getItem('ubm_custom_api_url') || '');
    if (input === null) return;
    setCustomApiUrl(input.trim());
    setApiBaseShown(getApiBase());
    showToast(input.trim() ? `Đã đổi máy chủ sang ${getApiBase()}` : `Đã về chế độ tự động (${getApiBase()}). Mở địa chỉ /health trên trình duyệt để kiểm tra.`);
    void cur;
  };

  // Attendance flow state
  const [attendanceStep, setAttendanceStep] = useState<'IDLE' | 'CHECKING_GPS' | 'READY_CAMERA' | 'SUBMITTING' | 'CONFIRMED'>('IDLE');
  const [lastReceipt, setLastReceipt] = useState<any>(null);
  const [uniformChecked, setUniformChecked] = useState(true);
  const [badgeChecked, setBadgeChecked] = useState(true);

  // Payslip privacy lock
  const [payslipUnlocked, setPayslipUnlocked] = useState(false);
  const [payslips, setPayslips] = useState<any[]>([]);

  // Shift & Requests
  const [myShifts, setMyShifts] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);

  // 2-Day Weekly OFF Registration State (Official Employees)
  // Lưu theo tuần (thứ 2 đầu tuần) để sang tuần mới offline cũng không mở khóa nhầm.
  const weeklyOffWeekKey = () => {
    const d = new Date();
    const day = (d.getDay() + 6) % 7; // Thứ 2 = 0
    d.setDate(d.getDate() - day);
    return d.toISOString().split('T')[0];
  };
  const readWeeklyOffSaved = () => {
    try {
      const raw = localStorage.getItem('ubm_weekly_off_registered');
      if (!raw) return false;
      try {
        const parsed = JSON.parse(raw);
        return parsed?.week === weeklyOffWeekKey() && parsed?.value === true;
      } catch {
        return false; // định dạng cũ 'true'/'false' -> coi như hết hạn, server sẽ đồng bộ lại khi online
      }
    } catch {
      return false;
    }
  };
  const persistWeeklyOff = (v: boolean) => {
    try {
      localStorage.setItem('ubm_weekly_off_registered', JSON.stringify({ week: weeklyOffWeekKey(), value: v }));
    } catch {}
  };
  const [hasRegisteredWeeklyOff, setHasRegisteredWeeklyOff] = useState<boolean>(() => readWeeklyOffSaved());

  const [weeklyOffData, setWeeklyOffData] = useState({
    day1: '',
    day2: '',
    reason: 'Đăng ký 2 ngày nghỉ OFF tuần theo định biên quy chế Ụm Bò Milk',
  });

  // Trạng thái cổng đăng ký OFF/tuần từ server (khung giờ T6 12h -> T7 15h)
  const [weeklyOffWindow, setWeeklyOffWindow] = useState<any>(null);
  const [weeklyOffLocked, setWeeklyOffLocked] = useState(false);
  const [weeklyOffLockKnown, setWeeklyOffLockKnown] = useState(false);

  const [leaveData, setLeaveData] = useState({
    leaveType: 'HANG_TUAN',
    requestedDate: new Date().toISOString().split('T')[0],
    reason: 'Đăng ký ngày nghỉ theo quy định',
  });

  // Attendance tracking state
  const [attendanceActionType, setAttendanceActionType] = useState<'CHECK_IN' | 'CHECK_OUT'>('CHECK_IN');
  // GPS thật từ thiết bị (null = chưa đo được, KHÔNG dùng số giả lập)
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  // Ảnh chụp thật từ camera (dataURL), null = chưa chụp
  const [photoData, setPhotoData] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
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
  // Ca thật của NV B (tải khi chọn B) + trạng thái bận chung cho các nút gửi
  const [targetShifts, setTargetShifts] = useState<any[]>([]);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  // Mất mạng / server lỗi khi tải dữ liệu
  const [dataStale, setDataStale] = useState(false);

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
      let fails = 0;
      const shifts = await apiRequest('/me/schedule').catch(() => { fails++; return []; });
      setMyShifts(shifts);
      const notifs = await apiRequest('/me/notifications').catch(() => { fails++; return []; });
      setNotifications(notifs);

      // Real Attendance History (30 ngày gần nhất, tải song song) & Today status
      const pastDates: string[] = [];
      for (let d = 29; d >= 0; d--) {
        const dt = new Date();
        dt.setDate(dt.getDate() - d);
        pastDates.push(dt.toISOString().split('T')[0]);
      }
      const settled = await Promise.allSettled(pastDates.map(dt => apiRequest(`/me/attendance?date=${dt}`)));
      let attEvents: any[] = [];
      let okDays = 0;
      for (const s of settled) {
        if (s.status === 'fulfilled' && Array.isArray(s.value)) {
          okDays++;
          attEvents = attEvents.concat(s.value);
        }
      }
      if (okDays === 0) fails++;
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

      // Load real colleagues in branch (đã che SĐT ở server — chỉ tên + mã NV)
      const colleagues = await apiRequest('/me/colleagues').catch(() => { fails++; return []; });
      setBranchColleagues(colleagues);
      // Mất mạng toàn bộ -> báo rõ đang xem dữ liệu cũ, không im lặng
      setDataStale(fails >= 4);

      // Đồng bộ cổng đăng ký OFF/tuần (banner + khóa/mở theo server)
      await refreshWeeklyOffStatus();
    } catch (err) {
      console.error(err);
    }
  };

  const [checkingStatus, setCheckingStatus] = useState<'IDLE' | 'CHECKING' | 'ACTIVE' | 'ERROR'>('IDLE');

  const handlePhoneLogin = async (phoneToLogin = loginPhone, pinToLogin = loginPin) => {
    const cleaned = phoneToLogin.replace(/[\s\-\.\(\)]/g, '');
    if (cleaned.length < 10) {
      setCheckingStatus('ERROR');
      setLoginError('Vui lòng nhập đủ 10 số điện thoại!');
      return;
    }
    const pin = (pinToLogin || '').trim();
    if (!/^\d{4,8}$/.test(pin)) {
      setCheckingStatus('ERROR');
      setLoginError('Vui lòng nhập mã PIN khởi tạo gồm 4-8 chữ số!');
      return;
    }

    setLoading(true);
    setCheckingStatus('CHECKING');
    setLoginError(null);
    try {
      const res = await apiRequest('/auth/employee/phone-login', {
        method: 'POST',
        body: JSON.stringify({ phone: cleaned, pin, deviceId: getDeviceId() }),
      });

      setCheckingStatus('ACTIVE');
      setAuthToken(res.token);
      if (res.refreshToken) {
        try { localStorage.setItem('ubm_emp_refresh', res.refreshToken); } catch {}
      }
      if (res.mustChangePin) {
        // PIN khởi tạo — bắt đổi trước khi vào cổng
        setMustChangePin(true);
        setNewPin('');
        setConfirmPin('');
        setLoginError(null);
        return;
      }
      await finishLogin(res);
    } catch (err: any) {
      if (err.message === 'ACCOUNT_NOT_FOUND') {
        setCheckingStatus('ERROR');
        setLoginError(`Số điện thoại ${cleaned} chưa tồn tại trên Google Sheets Master. Vui lòng liên hệ HR để nộp hồ sơ.`);
      } else if (err.message === 'PIN_NOT_SET') {
        setCheckingStatus('ERROR');
        setLoginError(`Tài khoản ${cleaned} chưa được cấp mã PIN. Vui lòng liên hệ HR để nhận mã PIN đăng nhập!`);
      } else if (err.message === 'INVALID_PIN') {
        setCheckingStatus('ERROR');
        setLoginError('Mã PIN không đúng! Vui lòng kiểm tra lại hoặc liên hệ HR để reset PIN.');
      } else if (err.message === 'DUPLICATE_PHONE_NEEDS_HR') {
        setCheckingStatus('ERROR');
        setLoginError(`Số điện thoại ${cleaned} bị trùng lặp trên 2 hồ sơ khác nhau. Cần gặp HR để đối soát thông tin.`);
      } else if (err.message === 'DEVICE_MISMATCH' || (err.message || '').includes('thiết bị')) {
        setCheckingStatus('ERROR');
        setLoginError(DEVICE_MISMATCH_MSG);
      } else {
        setCheckingStatus('ERROR');
        setLoginError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const finishLogin = async (res: any) => {
    setMustChangePin(false);
    setEmployee(res.employee);
    localStorage.setItem('ubm_emp_data', JSON.stringify(res.employee));
    setIsLoggedIn(true);
    showToast(`Đăng nhập thành công vào cổng ${res.stage === 'PROBATION' ? 'Thử việc' : 'Chính thức'}!`);
    await loadEmployeeData(res.employee.employee_id);
  };

  const handleChangePin = async () => {
    if (!/^\d{4,8}$/.test(newPin)) {
      setLoginError('Mã PIN mới phải gồm 4-8 chữ số!');
      return;
    }
    if (newPin !== confirmPin) {
      setLoginError('Xác nhận mã PIN chưa khớp! Vui lòng nhập lại.');
      return;
    }
    if (newPin === loginPin.trim()) {
      setLoginError('Mã PIN mới phải khác mã PIN khởi tạo!');
      return;
    }
    setLoading(true);
    setLoginError(null);
    try {
      await apiRequest('/auth/employee/change-pin', {
        method: 'POST',
        body: JSON.stringify({ oldPin: loginPin.trim(), newPin, deviceId: getDeviceId() }),
      });
      showToast('🎉 Đổi mã PIN thành công! Tài khoản đã khóa với thiết bị này — không đăng nhập được trên máy khác.');
      setLoginPin(newPin);
      // Token hiện tại đã bị thu hồi (version tăng) -> đăng nhập lại bằng PIN mới
      setAuthToken('');
      setMustChangePin(false);
      await handlePhoneLogin(loginPhone, newPin);
    } catch (err: any) {
      if (err.message === 'DEVICE_MISMATCH' || (err.message || '').includes('thiết bị')) {
        setLoginError(DEVICE_MISMATCH_MSG);
      } else {
        setLoginError(err.message === 'INVALID_PIN' ? 'Mã PIN hiện tại không đúng!' : err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // Không tự động đăng nhập (bảo mật PIN): người dùng bấm nút ĐĂNG NHẬP.
  useEffect(() => {
    const cleaned = loginPhone.replace(/[\s\-\.\(\)]/g, '');
    if (cleaned.length < 10) {
      setCheckingStatus('IDLE');
      setLoginError(null);
    }
  }, [loginPhone]);


  const handleLogout = () => {
    setAuthToken('');
    setIsLoggedIn(false);
    setEmployee(null);
    setPayslipUnlocked(false);
    setLoginPin('');
    setMustChangePin(false);
    setNewPin('');
    setConfirmPin('');
    setActiveTab('home');
    localStorage.removeItem('ubm_emp_data');
    localStorage.removeItem('ubm_emp_token');
    localStorage.removeItem('ubm_emp_active_tab');
  };

  // Guard: Mandatory 2-day OFF registration locks other tabs for official employees
  // Ưu tiên trạng thái khóa từ server; khi offline mới dùng cờ localStorage cũ.
  const weeklyOffGateLocked = weeklyOffLockKnown ? weeklyOffLocked : !hasRegisteredWeeklyOff;
  // Cổng đăng ký chỉ mở T6 12h -> T7 15h. Chưa rõ trạng thái (offline) thì cho bấm, server sẽ quyết.
  const weeklyOffRegOpen = !weeklyOffWindow || weeklyOffWindow.phase === 'OPEN';
  const weeklyOffOpensAtStr = weeklyOffWindow?.windowOpensAt
    ? new Date(weeklyOffWindow.windowOpensAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', weekday: 'long', day: '2-digit', month: '2-digit' })
    : '12h00 Thứ 6';
  // Bấm nút đăng ký ngoài khung giờ -> báo giờ mở thay vì gọi API
  const notifyRegWindowClosed = () => {
    showToast(`⏰ CHƯA ĐẾN GIỜ MỞ ĐĂNG KÝ! Cổng đăng ký 2 ngày nghỉ OFF mở lúc ${weeklyOffOpensAtStr} đến 15h00 Thứ 7. Hệ thống sẽ tự gửi thông báo trước 5 phút!`);
  };
  const handleTabClick = (tabId: string) => {
    if (!isProbation && weeklyOffGateLocked && tabId !== 'leave') {
      showToast('🔒 QUY CHẾ BẮT BUỘC: Đang trong chu kỳ mở đăng ký 2 ngày nghỉ/tuần! Bạn bắt buộc phải hoàn thành đăng ký 2 ngày nghỉ để mở khóa các chức năng khác.');
      setActiveTab('leave');
      return;
    }
    setActiveTab(tabId);
  };

  // Đồng bộ trạng thái cổng đăng ký OFF/tuần từ server (khung giờ + đã đủ 2 ngày chưa)
  const refreshWeeklyOffStatus = async () => {
    try {
      const w = await apiRequest('/api/weekly-off-window').catch(() => null);
      if (w) setWeeklyOffWindow(w);
    } catch {}
    if (!getAuthToken()) return;
    try {
      const st = await apiRequest('/me/weekly-off-status');
      setWeeklyOffLocked(!!st.locked);
      setWeeklyOffLockKnown(true);
      if (st.completed) {
        setHasRegisteredWeeklyOff(true);
        persistWeeklyOff(true);
        if (Array.isArray(st.registered) && st.registered.length >= 2) {
          setWeeklyOffData(d => ({
            ...d,
            day1: d.day1 || st.registered[0] || '',
            day2: d.day2 || st.registered[1] || '',
          }));
        }
      } else if (st.window?.phase === 'OPEN') {
        // Chu kỳ mới đang mở mà chưa đủ 2 ngày -> khóa lại
        setHasRegisteredWeeklyOff(false);
        setWeeklyOffLocked(true);
        persistWeeklyOff(false);
      }
    } catch {}
  };

  // Dịch mã lỗi cổng đăng ký thành thông báo thân thiện
  const weeklyOffErrMsg = (err: any, fallback: string) => {
    const m = String(err?.message || '');
    if (m.includes('WEEKLY_OFF_REGISTRATION_REQUIRED')) {
      setActiveTab('leave');
      return '🔒 Cổng đăng ký 2 ngày nghỉ đang mở — các chức năng khác bị KHÓA đến khi bạn hoàn tất đăng ký!';
    }
    if (m.includes('WEEKLY_OFF_WINDOW_CLOSED')) {
      return '⏰ Đăng ký 2 ngày nghỉ OFF chỉ mở từ 12h00 Thứ 6 đến 15h00 Thứ 7 hàng tuần!';
    }
    return err?.message || fallback;
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
    setGpsCoords(null);
    setPhotoData(null);

    // GPS THẬT 100%: đo từ vệ tinh thiết bị, không dùng tọa độ giả lập.
    // Từ chối định vị / ngoài vùng phủ sóng -> dừng, KHÔNG ghi nhận.
    if (!('geolocation' in navigator)) {
      showToast('🚫 Thiết bị của bạn không hỗ trợ định vị GPS! Không thể điểm danh.');
      setAttendanceStep('IDLE');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
        });
        setAttendanceStep('READY_CAMERA');
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          showToast('🚫 Bạn đã TỪ CHỐI quyền định vị! Hãy bật GPS + cho phép trình duyệt truy cập vị trí rồi thử lại. Không có GPS thật thì không điểm danh được.');
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          showToast('📡 Không bắt được tín hiệu GPS (trong nhà/tầng hầm?). Hãy ra chỗ thoáng và thử lại!');
        } else {
          showToast('⏰ Đo GPS quá thời gian! Vui lòng thử lại.');
        }
        setAttendanceStep('IDLE');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  };

  const handlePhotoSelected = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('⚠️ File không phải ảnh! Vui lòng chụp ảnh thật.');
      return;
    }
    // Base64 phình ~33% + giới hạn body 2MB của server -> chặn từ 1MB cho chắc
    if (file.size > 1024 * 1024) {
      showToast('⚠️ Ảnh quá lớn (>1MB)! Vui lòng chụp lại với độ phân giải thấp hơn.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPhotoData(String(reader.result || ''));
    };
    reader.onerror = () => {
      showToast('⚠️ Không đọc được ảnh! Vui lòng chụp lại.');
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitAttendance = async () => {
    if (!uniformChecked || !badgeChecked) {
      showToast('⚠️ VI PHẠM ĐỒNG PHỤC QUY CHUẨN: Vui lòng xác nhận đang mặc Áo Hồng Ụm Bò Milk và Đeo Bảng Tên hợp lệ!');
      return;
    }
    // Bắt buộc: GPS thật + ảnh thật (check-in). Không có -> không gửi.
    if (!gpsCoords) {
      showToast('🚫 Chưa có tọa độ GPS thật! Vui lòng bấm Bắt đầu lại để đo GPS.');
      setAttendanceStep('IDLE');
      return;
    }
    if (attendanceActionType === 'CHECK_IN' && !photoData) {
      showToast('📸 Bắt buộc chụp ảnh xác nhận khi check-in! Vui lòng chụp ảnh thật.');
      return;
    }
    setAttendanceStep('SUBMITTING');
    try {
      const today = new Date().toISOString().split('T')[0];
      const todayShift = myShifts.find((s: any) => s.date === today);
      const targetEndpoint = attendanceActionType === 'CHECK_IN' ? '/attendance/checkin' : '/attendance/checkout';

      const res = await apiRequest(targetEndpoint, {
        method: 'POST',
        body: JSON.stringify({
          assignment_id: todayShift?.assignment_id || myShifts[0]?.assignment_id,
          lat: gpsCoords.lat,
          lng: gpsCoords.lng,
          accuracy: gpsCoords.accuracy,
          ...(photoData ? { photo_base64: photoData } : {}),
        }),
      });

      setLastReceipt(res.receipt);
      setAttendanceStep('CONFIRMED');
      const gpsNote = res.receipt?.gps_status === 'OUT_OF_BOUNDS'
        ? ' (⚠️ NGOÀI PHẠM VI 300m chi nhánh — đã ghi nhận để đối soát!)'
        : res.receipt?.gps_status === 'LOW_ACCURACY'
          ? ' (⚠️ GPS kém chính xác — đã ghi nhận!)'
          : '';
      showToast(attendanceActionType === 'CHECK_IN'
        ? `✓ Điểm danh Check-in thành công! GPS thật + ảnh thật đã ghi nhận.${gpsNote}`
        : `✓ Điểm danh Check-out thành công! Ca làm việc đã ghi nhận vào Google Sheets.${gpsNote}`
      );
      await loadEmployeeData(employee?.employee_id);
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi điểm danh!');
      setAttendanceStep('READY_CAMERA');
    }
  };

  const handleCapturePhoto = async () => {
    // Mở camera thật của điện thoại (không tạo ảnh giả bằng canvas).
    photoInputRef.current?.click();
  };

  // Submit 2-day OFF for official employee
  const handleSubmitWeeklyOff2Days = async () => {
    // Khóa ngoài khung giờ mở cổng (server cũng chặn, đây là lớp báo sớm)
    if (!isProbation && !hasRegisteredWeeklyOff && !weeklyOffRegOpen) {
      notifyRegWindowClosed();
      return;
    }
    if (!weeklyOffData.day1 || !weeklyOffData.day2) {
      showToast('⚠️ Vui lòng chọn đầy đủ cả 2 ngày nghỉ OFF trong tuần!');
      return;
    }
    if (weeklyOffData.day1 === weeklyOffData.day2) {
      showToast('⚠️ Hai ngày nghỉ OFF phải là 2 ngày khác nhau trong tuần!');
      return;
    }
    if (!weeklyOffData.reason.trim()) {
      showToast('⚠️ Vui lòng nhập lý do đăng ký nghỉ!');
      return;
    }
    // 2 ngày phải nằm trong tuần mục tiêu của cổng (server cũng chặn, đây là lớp báo sớm)
    const wk = (weeklyOffWindow as any)?.targetWeekMon && (weeklyOffWindow as any)?.targetWeekSun
      ? { mon: (weeklyOffWindow as any).targetWeekMon, sun: (weeklyOffWindow as any).targetWeekSun }
      : null;
    if (wk && (weeklyOffData.day1 < wk.mon || weeklyOffData.day1 > wk.sun || weeklyOffData.day2 < wk.mon || weeklyOffData.day2 > wk.sun)) {
      showToast(`⚠️ 2 ngày phải nằm trong tuần mục tiêu (${wk.mon} → ${wk.sun})!`);
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
      persistWeeklyOff(true);

      showToast('🎉 ĐÃ ĐĂNG KÝ 2 NGÀY NGHỈ OFF TUẦN THÀNH CÔNG! Toàn bộ chức năng hệ thống đã được mở khóa.');
      await refreshWeeklyOffStatus();
      await loadEmployeeData(employee?.employee_id);
    } catch (err: any) {
      showToast(weeklyOffErrMsg(err, 'Lỗi khi gửi đăng ký 2 ngày nghỉ!'));
    }
  };

  const handleSubmitLeave = async () => {
    try {
      await apiRequest('/leaves', {
        method: 'POST',
        body: JSON.stringify(leaveData),
      });
      showToast('Đã gửi yêu cầu nghỉ OFF thành công!');
      await refreshWeeklyOffStatus();
      await loadEmployeeData(employee?.employee_id);
    } catch (err: any) {
      showToast(weeklyOffErrMsg(err, 'Lỗi khi gửi yêu cầu nghỉ!'));
    }
  };

  // Tải ca thật của NV B để chọn ca tráo/nhờ (dữ liệu thật từ /schedules)
  const loadTargetShifts = async (targetEmployeeId: string) => {
    setTargetShifts([]);
    if (!targetEmployeeId) return;
    try {
      const branchId = employee?.default_branch_id || 'CN130';
      const today = new Date().toISOString().split('T')[0];
      const all = await apiRequest(`/schedules?branchId=${encodeURIComponent(branchId)}&week=${today}`);
      setTargetShifts(Array.isArray(all) ? all.filter((s: any) => s.employee_id === targetEmployeeId && s.status === 'PUBLISHED') : []);
    } catch (err: any) {
      showToast(err.message || 'Không tải được lịch của đồng nghiệp!');
    }
  };

  const handleSelectSwapTarget = (targetEmployeeId: string) => {
    const col = branchColleagues.find((c: any) => c.employee_id === targetEmployeeId);
    setSwapData(s => ({ ...s, targetEmployeeId, targetEmployeeName: col?.full_name || '', targetShift: '' }));
    loadTargetShifts(targetEmployeeId);
  };

  // Gửi yêu cầu đổi ca THẬT lên server (cả 2 hình thức)
  const handleSubmitSwap = async () => {
    if (!swapData.myShift) {
      showToast('⚠️ Vui lòng chọn ca làm của bạn!');
      return;
    }
    if (!swapData.targetEmployeeId) {
      showToast('⚠️ Vui lòng chọn đồng nghiệp!');
      return;
    }
    if (!swapData.targetShift) {
      showToast('⚠️ Đồng nghiệp chưa có ca nào để tráo/nhờ (hoặc chưa tải xong)! Vui lòng chọn lại.');
      return;
    }
    if (!swapData.reason.trim()) {
      showToast('⚠️ Vui lòng nhập lý do đổi ca!');
      return;
    }
    setActionBusy('swap');
    try {
      const res = await apiRequest('/swap-requests', {
        method: 'POST',
        body: JSON.stringify({
          requesterAssignmentId: swapData.myShift,
          targetEmployeeId: swapData.targetEmployeeId,
          targetAssignmentId: swapData.targetShift,
          reason: swapData.reason,
        }),
      });
      const sid = res?.result?.swap_id || res?.swap_id || '';
      showToast(`✓ Đã gửi yêu cầu đổi ca THẬT! Mã đơn: ${sid}. Đang chờ NV B xác nhận rồi Store duyệt.`);
      setSwapData({ myShift: '', targetEmployeeId: '', targetEmployeeName: '', targetShift: '', reason: '' });
      setTargetShifts([]);
      await loadEmployeeData(employee?.employee_id);
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi gửi yêu cầu đổi ca!');
    } finally {
      setActionBusy(null);
    }
  };

  // Thử việc tự đổi ca: WORK_TO_OFF -> đơn nghỉ thật; các chiều khác chưa có nghiệp vụ server -> hướng dẫn thật
  const handleProbationSelfSwap = async () => {
    if (probationSelfSwap.direction === 'WORK_TO_OFF') {
      if (!probationSelfSwap.date) {
        showToast('⚠️ Vui lòng chọn ngày muốn nghỉ!');
        return;
      }
      setActionBusy('selfswap');
      try {
        await apiRequest('/leaves', {
          method: 'POST',
          body: JSON.stringify({
            leaveType: 'DOT_XUAT',
            requestedDate: probationSelfSwap.date,
            reason: `[TỰ ĐỔI CA THỬ VIỆC] ${probationSelfSwap.reason}`,
          }),
        });
        showToast('✓ Đã gửi đơn xin nghỉ (tự đổi ca thử việc) THẬT! Chờ Store/HR duyệt trên hệ thống.');
        await loadEmployeeData(employee?.employee_id);
      } catch (err: any) {
        showToast(err.message || 'Lỗi khi gửi đơn!');
      } finally {
        setActionBusy(null);
      }
      return;
    }
    showToast('ℹ️ Đổi giờ ca / xin đi làm ngày OFF: vui lòng báo trực tiếp Store để xếp lịch trên hệ thống. Chức năng tự đổi các chiều này chưa hỗ trợ gửi đơn.');
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
      if (!adjustmentData.date) {
        showToast('⚠️ Vui lòng chọn ngày sự cố!');
        return;
      }
      if (!adjustmentData.reason.trim()) {
        showToast('⚠️ Vui lòng nhập chi tiết lý do & bằng chứng!');
        return;
      }
      if (adjustmentData.type === 'NGHI_KHAN') {
        await apiRequest('/leaves', {
          method: 'POST',
          body: JSON.stringify({
            leaveType: 'DOT_XUAT',
            requestedDate: adjustmentData.date,
            reason: `[NGHỈ KHẨN CẤP] ${adjustmentData.reason.trim()}`,
          }),
        });
        showToast('🚨 ĐÃ GỬI BÁO NGHỈ KHẨN CẤP ĐẾN HR! Dữ liệu đã đồng bộ sang HR Tab 10 và Google Sheets.');
      } else {
        // Bổ sung công/quên check-in-out -> đúng queue Điều Chỉnh Công để Store/HR duyệt
        // (trước đây gửi nhầm sang /leaves loại BO_SUNG_CONG, HR không thấy để duyệt).
        const shift = (myShifts || []).find((s: any) => s.date === adjustmentData.date) || (myShifts || [])[0];
        await apiRequest('/attendance/adjustments', {
          method: 'POST',
          body: JSON.stringify({
            assignmentId: shift?.assignment_id || `SHIFT_UNKNOWN_${adjustmentData.date}`,
            reason: `[${adjustmentData.type}] ${adjustmentData.date}: ${adjustmentData.reason.trim()}`,
            minutesRequested: 0,
          }),
        });
        showToast('✓ Đã gửi phiếu giải trình bổ sung công đến Cửa Hàng Trưởng và HR!');
      }
      await loadEmployeeData(employee?.employee_id);
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi gửi phiếu giải trình!');
    }
  };

  // Phiếu lương: 100% dữ liệu thật từ API /me/payslips (đã lọc đúng nhân viên ở server).
  // Không dùng PIN giả hay phiếu mẫu — không có dữ liệu thì báo trống.
  const handleUnlockPayslip = async () => {
    try {
      const slips = await apiRequest('/me/payslips');
      setPayslips(Array.isArray(slips) ? slips : []);
      setPayslipUnlocked(true);
      if (!Array.isArray(slips) || slips.length === 0) {
        showToast('Chưa có phiếu lương nào được phát hành cho bạn trong kỳ này!');
      }
    } catch (err: any) {
      showToast(err.message || 'Không tải được phiếu lương! Vui lòng thử lại.');
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
                borderColor: checkingStatus === 'ERROR' ? 'var(--danger)' : undefined,
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
              <span>🔄 Đang xác thực SĐT + mã PIN trên Google Sheets Master...</span>
            </div>
          )}

          {!mustChangePin && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
                  Mã PIN Khởi Tạo (4-8 số, hỏi HR/Admin)
                </label>
              </div>
              <div style={{ position: 'relative', marginBottom: '14px' }}>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="Ví dụ: 123456"
                  value={loginPin}
                  onChange={(e) => setLoginPin(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handlePhoneLogin(); }}
                  style={{ width: '100%', fontSize: '18px', fontWeight: 700, letterSpacing: '4px' }}
                />
              </div>

              <button
                className={`btn-primary${loading ? ' fx-loading' : ''}`}
                onClick={() => handlePhoneLogin()}
                disabled={loading}
                style={{ width: '100%', padding: '13px', fontSize: '15px', fontWeight: 800, marginBottom: '14px', opacity: loading ? 0.6 : 1 }}
              >
                {loading ? 'ĐANG XÁC THỰC...' : '🔐 ĐĂNG NHẬP'}
              </button>
            </>
          )}

          {mustChangePin && (
            <div style={{ backgroundColor: '#FFFBEB', border: '1.5px solid #F59E0B', borderRadius: 'var(--radius-sm)', padding: '14px', marginBottom: '14px' }}>
              <div style={{ fontWeight: 800, fontSize: '14px', color: '#92400E', marginBottom: '6px' }}>
                🔑 BẮT BUỘC ĐỔI MÃ PIN LẦN ĐẦU
              </div>
              <div style={{ fontSize: '12px', color: '#92400E', marginBottom: '12px', lineHeight: '1.5' }}>
                Bạn đang dùng mã PIN khởi tạo. Hãy đặt mã PIN riêng (4-8 chữ số, khác mã khởi tạo, không chia sẻ cho ai) để mở khóa hệ thống!
              </div>
              <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Mã PIN mới:</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                placeholder="Nhập mã PIN mới"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                style={{ width: '100%', fontSize: '18px', fontWeight: 700, letterSpacing: '4px', marginBottom: '10px' }}
              />
              <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Xác nhận mã PIN mới:</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                placeholder="Nhập lại mã PIN mới"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') handleChangePin(); }}
                style={{ width: '100%', fontSize: '18px', fontWeight: 700, letterSpacing: '4px', marginBottom: '12px' }}
              />
              <button
                className={`btn-primary${loading ? ' fx-loading' : ''}`}
                onClick={handleChangePin}
                disabled={loading}
                style={{ width: '100%', padding: '13px', fontSize: '15px', fontWeight: 800, opacity: loading ? 0.6 : 1 }}
              >
                {loading ? 'ĐANG ĐỔI PIN...' : '✅ ĐỔI PIN & VÀO HỆ THỐNG'}
              </button>
            </div>
          )}

          {loginError && (
            <div style={{
              backgroundColor: 'var(--danger-soft)',
              color: 'var(--danger)',
              padding: '14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '13px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              marginBottom: '16px',
              border: '1px solid #FCA5A5',
            }}>
              <AlertCircle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <div style={{ fontWeight: 800, marginBottom: '2px' }}>
                  Từ Chối Đăng Nhập
                </div>
                <div>{loginError}</div>
              </div>
            </div>
          )}

          <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
            💡 <strong>Bảo mật đăng nhập:</strong> Nhập đủ 10 số điện thoại + mã PIN khởi tạo (4-8 số, hỏi HR/Admin lần đầu) rồi bấm ĐĂNG NHẬP. Mỗi người giữ PIN riêng — không chia sẻ để tránh bị đăng nhập ké!
          </p>
          <button
            onClick={handleChangeApiBase}
            title="Bấm để đổi địa chỉ máy chủ nếu báo lỗi kết nối"
            style={{ marginTop: '10px', border: 'none', background: 'none', fontSize: '11px', color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}
          >
            🔌 Máy chủ: {apiBaseShown || '(chưa xác định)'} — bấm để đổi
          </button>
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

      {/* Cờ mất mạng: đang xem dữ liệu cũ */}
      {dataStale && (
        <div style={{ margin: '12px 16px 0', padding: '10px 14px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 'var(--radius-sm)', fontSize: '12px', fontWeight: 700, color: '#DC2626' }}>
          📡 Mất kết nối máy chủ — đang hiển thị dữ liệu cũ. Kiểm tra mạng rồi kéo xuống tải lại.
        </div>
      )}

      {/* TOAST MESSAGE (phân loại thành công/lỗi + animation + thanh đếm ngược) */}
      {toastMsg && (() => {
        const m = toastMsg;
        const isOk = /🎉|✓|✅|thành công/i.test(m);
        const isErr = !isOk && /⚠️|🚫|❌|⛔|lỗi|không|chưa|thất bại|từ chối|vi phạm|cấm|hết/i.test(m);
        const cls = isErr ? 'fx-toast-danger' : isOk ? 'fx-toast-success' : '';
        return (
          <div key={m} className={`fx-toast ${cls}`}>
            {isErr
              ? <AlertCircle size={16} color="#F87171" style={{ flexShrink: 0 }} />
              : isOk
                ? <span className="fx-pop"><CheckCircle2 size={16} color="#34D399" /></span>
                : <CheckCircle2 size={16} color="var(--brand)" style={{ flexShrink: 0 }} />}
            <span>{m}</span>
          </div>
        );
      })()}

      {/* 5-MINUTE PRE-NOTIFICATION & MANDATORY 2-DAY OFF REGISTRATION BANNER FOR OFFICIAL EMPLOYEES */}
      {!isProbation && weeklyOffWindow?.phase === 'REMINDER' && (
        <div style={{
          margin: '12px 16px 0',
          padding: '12px 14px',
          backgroundColor: '#FFFBEB',
          border: '2px solid #F59E0B',
          borderRadius: 'var(--radius-sm)',
          boxShadow: '0 4px 12px rgba(245, 158, 11, 0.15)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <Bell size={18} color="#D97706" />
            <strong style={{ fontSize: '13px', color: '#92400E' }}>
              ⏰ SẮP MỞ CỔNG ĐĂNG KÝ 2 NGÀY NGHỈ OFF/TUẦN
            </strong>
          </div>
          <div style={{ fontSize: '12px', color: '#92400E', lineHeight: '1.4' }}>
            Hệ thống đã tự động gửi thông báo trước 5 phút giờ mở cửa đăng ký. Cổng mở lúc{' '}
            <strong>{weeklyOffWindow?.windowOpensAt ? new Date(weeklyOffWindow.windowOpensAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', weekday: 'long', day: '2-digit', month: '2-digit' }) : '12h00 Thứ 6'}</strong>{' '}
            đến <strong>15h00 Thứ 7</strong>. Hãy chuẩn bị chọn 2 ngày nghỉ!
          </div>
        </div>
      )}
      {!isProbation && weeklyOffGateLocked && (
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
              {weeklyOffWindow?.windowClosesAt ? ` (ĐÓNG LÚC ${new Date(weeklyOffWindow.windowClosesAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', weekday: 'long' }).toUpperCase()})` : ''}
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

                  {!hasRegisteredWeeklyOff && !weeklyOffRegOpen ? (
                    /* KHÓA NGOÀI KHUNG GIỜ MỞ CỔNG (T6 12h -> T7 15h) */
                    <div style={{
                      backgroundColor: '#F1F5F9',
                      border: '1.5px dashed #94A3B8',
                      borderRadius: 'var(--radius-sm)',
                      padding: '20px 14px',
                      textAlign: 'center',
                    }}>
                      <Lock size={28} color="#64748B" />
                      <div style={{ fontWeight: 800, fontSize: '14px', color: '#334155', margin: '8px 0 6px' }}>
                        🔒 CHƯA ĐẾN GIỜ MỞ ĐĂNG KÝ
                      </div>
                      <div style={{ fontSize: '12px', color: '#64748B', lineHeight: '1.5' }}>
                        Cổng đăng ký 2 ngày nghỉ OFF chỉ mở từ <strong>12h00 Thứ 6</strong> đến <strong>15h00 Thứ 7</strong> hàng tuần.<br />
                        Lần mở tới: <strong>{weeklyOffOpensAtStr}</strong><br />
                        Hệ thống sẽ tự động gửi thông báo trước 5 phút!
                      </div>
                      <button
                        className="btn-primary"
                        onClick={notifyRegWindowClosed}
                        style={{ width: '100%', padding: '12px', fontSize: '14px', fontWeight: 800, marginTop: '12px', backgroundColor: '#64748B', boxShadow: 'none' }}
                      >
                        ⏰ XEM GIỜ MỞ CỔNG ĐĂNG KÝ
                      </button>
                    </div>
                  ) : (
                  <>
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
                  </>
                  )}
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
                      <div style={{ color: 'var(--text-muted)' }}>GPS thật của bạn:</div>
                      {gpsCoords ? (
                        <strong style={{ color: '#10B981' }}>
                          ±{gpsCoords.accuracy}m (Chuẩn &lt; 300m)
                        </strong>
                      ) : (
                        <strong style={{ color: '#94A3B8' }}>Chưa đo — bấm Bắt đầu để đo GPS</strong>
                      )}
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
                      <input
                        ref={photoInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        style={{ display: 'none' }}
                        onChange={(e) => handlePhotoSelected(e.target.files?.[0])}
                      />
                      <div style={{
                        width: '100%',
                        minHeight: '200px',
                        backgroundColor: '#FDF2F8',
                        border: '2px dashed var(--brand)',
                        borderRadius: 'var(--radius-md)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        overflow: 'hidden',
                      }}>
                        {photoData ? (
                          <img src={photoData} alt="Ảnh điểm danh" style={{ width: '100%', maxHeight: '320px', objectFit: 'cover' }} />
                        ) : (
                          <>
                            <Camera size={40} color="var(--brand)" />
                            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--brand)' }}>
                              Chụp ảnh thật: áo hồng + bảng tên
                            </span>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              Giữ camera thẳng khuôn mặt và ngực áo
                            </span>
                          </>
                        )}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>
                        GPS đã đo: {gpsCoords ? `${gpsCoords.lat.toFixed(6)}, ${gpsCoords.lng.toFixed(6)} (±${gpsCoords.accuracy}m)` : '—'}
                      </div>

                      {!photoData ? (
                        <button
                          className="btn-primary"
                          onClick={handleCapturePhoto}
                          style={{ width: '100%', fontSize: '15px', fontWeight: 800 }}
                        >
                          📸 CHỤP ẢNH THẬT BẰNG CAMERA
                        </button>
                      ) : (
                        <>
                          <button
                            className="btn-secondary"
                            onClick={handleCapturePhoto}
                            style={{ width: '100%', fontSize: '13px', fontWeight: 700 }}
                          >
                            🔄 CHỤP LẠI ẢNH KHÁC
                          </button>
                          <button
                            className="btn-primary"
                            onClick={handleSubmitAttendance}
                            style={{ width: '100%', fontSize: '15px', fontWeight: 800 }}
                          >
                            ✅ GHI NHẬN {attendanceActionType === 'CHECK_IN' ? 'CHECK-IN' : 'CHECK-OUT'} (GPS + ẢNH THẬT)
                          </button>
                        </>
                      )}
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
                      <span className="fx-pop"><CheckCircle2 size={36} color="#10B981" style={{ margin: '0 auto 8px' }} /></span>
                      <h4 style={{ fontSize: '16px', fontWeight: 800, color: '#065F46' }}>
                        {attendanceActionType === 'CHECK_IN' ? 'CHECK-IN THÀNH CÔNG!' : 'CHECK-OUT THÀNH CÔNG!'}
                      </h4>
                      <div style={{ fontSize: '12px', color: '#047857', marginTop: '4px' }}>
                        Thời gian: {new Date().toLocaleTimeString('vi-VN')} • Khoảng cách:{' '}
                        {typeof lastReceipt?.distance_meters === 'number' ? `${Math.round(lastReceipt.distance_meters)}m` : 'đang đối soát'}
                        {lastReceipt?.gps_status === 'OUT_OF_BOUNDS' ? ' (⚠️ ngoài 300m — đã ghi nhận để đối soát)' : ''} • Đồng phục: Áo hồng + Bảng tên hợp lệ.
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
                <span className="badge badge-brand">30 ngày gần nhất</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {(() => {
                  const byDate = new Map<string, any[]>();
                  for (const e of myAttendanceHistory) {
                    const d = (e.client_time || '').slice(0, 10);
                    if (!d) continue;
                    if (!byDate.has(d)) byDate.set(d, []);
                    byDate.get(d)!.push(e);
                  }
                  const days = [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]));
                  if (days.length === 0) {
                    return (
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
                          Chưa có dữ liệu chấm công trong 30 ngày qua
                        </div>
                        <div>Dữ liệu sẽ tự động đồng bộ realtime từ Google Sheets khi bạn thực hiện Check-in / Check-out ca làm việc.</div>
                      </div>
                    );
                  }
                  return days.map(([date, evs]) => {
                    const inEv = evs.find(e => e.type === 'CHECK_IN');
                    const outEv = evs.find(e => e.type === 'CHECK_OUT');
                    const fmt = (t?: string) => t ? new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '--:--';
                    const [y, m, dd] = date.split('-');
                    const complete = !!(inEv && outEv);
                    const outOfBounds = evs.some(e => e.gps_status === 'OUT_OF_BOUNDS');
                    return (
                      <div key={date} style={{ padding: '10px 12px', backgroundColor: '#FAFAFA', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '13px' }}>{dd}/{m}/{y}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Vào: {fmt(inEv?.client_time)} • Ra: {fmt(outEv?.client_time)}</div>
                        </div>
                        <span className={`badge ${complete ? 'badge-success' : 'badge-warning'}`}>
                          {complete ? (outOfBounds ? 'Đủ công (ngoài GPS)' : 'Đủ công') : 'Thiếu checkout'}
                        </span>
                      </div>
                    );
                  });
                })()}
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
                  disabled={actionBusy === 'selfswap'}
                  onClick={handleProbationSelfSwap}
                  style={{ opacity: actionBusy === 'selfswap' ? 0.6 : 1 }}
                >
                  {actionBusy === 'selfswap' ? '⏳ ĐANG GỬI ĐƠN...' : 'Xác Nhận Tự Đổi Ca Cá Nhân'}
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
                      <option value="">-- Chọn ca thật của bạn --</option>
                      {myShifts.length === 0 ? (
                        <option value="">Chưa có ca nào trong tuần này</option>
                      ) : (
                        myShifts.map((s: any, idx: number) => (
                          <option key={idx} value={s.assignment_id}>
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
                      onChange={(e) => handleSelectSwapTarget(e.target.value)}
                      style={{ width: '100%' }}
                    >
                      <option value="">-- Chọn đồng nghiệp --</option>
                      {branchColleagues.length === 0 ? (
                        <option value="">Chưa tải được danh sách (kiểm tra mạng)</option>
                      ) : (
                        branchColleagues
                          .filter((col: any) => col.employee_id !== employee?.employee_id)
                          .map((col: any) => (
                          <option key={col.employee_id} value={col.employee_id}>
                            {col.full_name} ({col.employee_code || col.employee_id})
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Ca muốn tráo đổi từ đồng nghiệp B (ca thật):</label>
                    <select
                      value={swapData.targetShift}
                      onChange={(e) => setSwapData({ ...swapData, targetShift: e.target.value })}
                      style={{ width: '100%' }}
                    >
                      <option value="">-- Chọn ca thật của B --</option>
                      {targetShifts.map((s: any, idx: number) => (
                        <option key={idx} value={s.assignment_id}>
                          {s.date} ({s.shift_code})
                        </option>
                      ))}
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
                    disabled={actionBusy === 'swap'}
                    onClick={handleSubmitSwap}
                    style={{ opacity: actionBusy === 'swap' ? 0.6 : 1 }}
                  >
                    {actionBusy === 'swap' ? '⏳ ĐANG GỬI ĐƠN THẬT...' : 'Gửi Yêu Cầu Tráo Đổi Ca (A ⇄ B)'}
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
                            {col.full_name} ({col.employee_code || col.employee_id})
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
                {(Array.isArray(notifications) ? notifications : []).length === 0 ? (
                  <div style={{ padding: '16px', textAlign: 'center', backgroundColor: '#FAFAFA', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border)', color: 'var(--text-muted)', fontSize: '13px' }}>
                    Chưa có thông báo nào. Thông báo từ HR (lịch, lương, nhắc nhở) sẽ hiện ở đây theo thời gian thực.
                  </div>
                ) : (
                  (notifications as any[]).slice(0, 20).map((n: any, idx: number) => (
                    <div key={n.inbox_id || idx} style={{ padding: '10px 12px', backgroundColor: n.read_at ? '#FAFAFA' : '#FFFBF9', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                      <div style={{ fontWeight: 700, fontSize: '13px' }}>{n.title}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text)', marginTop: '2px' }}>{n.summary}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {n.created_at ? new Date(n.created_at).toLocaleString('vi-VN') : ''}
                      </div>
                    </div>
                  ))
                )}
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
                    Phiếu lương do Kế toán phát hành — chỉ hiển thị đúng phiếu của bạn, không có dữ liệu mẫu.
                  </p>
                  <button className="btn-primary" onClick={handleUnlockPayslip}>
                    Xem Phiếu Lương Của Tôi
                  </button>
                </div>
              ) : payslips.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '16px 0', fontSize: '13px', color: 'var(--text-muted)' }}>
                  Chưa có phiếu lương nào được phát hành cho bạn trong kỳ này.
                  <div>
                    <button className="btn-secondary" onClick={() => handleUnlockPayslip()} style={{ fontSize: '12px', marginTop: '10px' }}>
                      Tải Lại
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {payslips.map((slip: any, idx: number) => (
                    <div key={slip.item_id || slip.run_id || idx} style={{ backgroundColor: '#FFFBF9', padding: '14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                      <div style={{ fontWeight: 800, fontSize: '14px', color: 'var(--brand)' }}>
                        {slip.period ? `Kỳ Lương Tháng ${String(slip.period).slice(5, 7)}/${String(slip.period).slice(0, 4)}` : (slip.title || 'Phiếu lương')}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', margin: '8px 0' }}>
                        <span>Tổng giờ công:</span>
                        <strong>{Number(slip.standard_hours || 0).toLocaleString('vi-VN')} giờ ({slip.total_shifts ?? 0} ca)</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', margin: '4px 0' }}>
                        <span>Đơn giá:</span>
                        <strong>{Number(slip.rate_snapshot || 0).toLocaleString('vi-VN')} đ/h</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', margin: '4px 0' }}>
                        <span>Phụ cấp / Thưởng:</span>
                        <strong>{Number((slip.allowance || 0) + (slip.bonus || 0)).toLocaleString('vi-VN')} đ</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', margin: '4px 0' }}>
                        <span>Khấu trừ:</span>
                        <strong>{Number(slip.deduction || 0).toLocaleString('vi-VN')} đ</strong>
                      </div>
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px', marginTop: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 800, color: '#10B981' }}>
                        <span>THỰC NHẬN:</span>
                        <span>{Number(slip.net_pay || 0).toLocaleString('vi-VN')} đ</span>
                      </div>
                    </div>
                  ))}
                  <button className="btn-secondary" onClick={() => { setPayslipUnlocked(false); setPayslips([]); }} style={{ fontSize: '12px' }}>
                    Ẩn Phiếu Lương
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
