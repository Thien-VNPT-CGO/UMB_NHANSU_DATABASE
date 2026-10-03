import React, { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { apiRequest, setAuthToken, getAuthToken, getApiBase, setCustomApiUrl } from './services/api';
import { connectRealtime } from './services/realtime';
import { APP_COMMIT } from './app-version';
import { PremiumLogin } from './components/PremiumLogin';
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
  // PIN cũ nhập tay khi khôi phục phiên sau reload (loginPin đã mất)
  const [oldPinInput, setOldPinInput] = useState('');
  // Cổng kiểm tra phiên đã lưu với server khi mở web (chống reload lách đổi PIN)
  const [sessionChecked, setSessionChecked] = useState<boolean>(() => {
    try {
      return !(localStorage.getItem('ubm_emp_token') && localStorage.getItem('ubm_emp_data'));
    } catch {
      return true;
    }
  });

  // Boot: phiên cũ còn token thì XÁC MINH lại với server — tài khoản chưa đổi
  // PIN thì bắt đổi ngay, không cho vào cổng (reload không lách được).
  useEffect(() => {
    if (sessionChecked) return;
    let alive = true;
    (async () => {
      try {
        const me: any = await apiRequest('/me');
        if (!alive) return;
        if (me?.user?.mustChangePin) {
          // Treo ở màn đổi PIN: giữ token để gọi đổi, buộc nhập lại PIN cũ + PIN mới.
          setEmployee(me.employee || null);
          try {
            const ph = (me.employee?.phone_normalized || me.employee?.phone || '').replace(/\D/g, '');
            if (ph) setLoginPhone(ph);
          } catch {}
          setLoginPin('');
          setOldPinInput('');
          setNewPin('');
          setConfirmPin('');
          setMustChangePin(true);
          setIsLoggedIn(false);
          setLoginError('🔑 Tài khoản của bạn chưa đổi mã PIN mới! Vui lòng đổi PIN để vào hệ thống — tải lại trang cũng không bỏ qua được.');
        } else {
          if (me?.employee) {
            setEmployee(me.employee);
            try { localStorage.setItem('ubm_emp_data', JSON.stringify(me.employee)); } catch {}
          }
          setMustChangePin(false);
          setIsLoggedIn(true);
        }
      } catch {
        if (!alive) return;
        // Token hết hạn/không hợp lệ -> xóa phiên cũ, về màn đăng nhập.
        try {
          localStorage.removeItem('ubm_emp_data');
          localStorage.removeItem('ubm_emp_token');
          localStorage.removeItem('ubm_emp_refresh');
          localStorage.removeItem('ubm_emp_active_tab');
        } catch {}
        setAuthToken('');
        setEmployee(null);
        setIsLoggedIn(false);
        setMustChangePin(false);
      } finally {
        if (alive) setSessionChecked(true);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  // Địa chỉ backend đang gọi — hiển thị để chẩn đoán lỗi mạng, bấm để đổi.
  const [apiBaseShown, setApiBaseShown] = useState<string>(() => {
    try { return getApiBase(); } catch { return ''; }
  });
  // Bản API đang chạy (so với bản app để biết đã cập nhật chưa)
  const [apiCommit, setApiCommit] = useState<string | null>(null);
  useEffect(() => {
    apiRequest('/version').then((v: any) => {
      if (v?.commit) setApiCommit(String(v.commit).slice(0, 7));
    }).catch(() => null);
  }, []);
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
  const readWeeklyOffSaved = (weekKey?: string) => {
    try {
      const raw = localStorage.getItem('ubm_weekly_off_registered');
      if (!raw) return false;
      try {
        const parsed = JSON.parse(raw);
        // Định dạng mới: map { [weekMon]: true } — hỗ trợ đợt mở bù VIP cho tuần sau.
        let map: Record<string, boolean> = {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.week === undefined) {
          map = parsed;
        } else if (parsed?.week && parsed?.value === true) {
          map[parsed.week] = true;
        }
        const wk = weekKey || weeklyOffWeekKey();
        if (map[wk] === true) return true;
        // Đăng ký cho tuần MỤC TIÊU (sau tuần hiện tại): reload cuối tuần vẫn khóa.
        // Key cũ hơn tuần hiện tại tự hết hiệu lực (không mở khóa nhầm tuần mới).
        return Object.keys(map).some(k => map[k] === true && /^\d{4}-\d{2}-\d{2}$/.test(k) && k >= wk);
      } catch {
        return false; // định dạng cũ 'true'/'false' -> coi như hết hạn, server sẽ đồng bộ lại khi online
      }
    } catch {
      return false;
    }
  };
  const persistWeeklyOff = (v: boolean, weekKey?: string) => {
    try {
      const wk = weekKey || weeklyOffWeekKey();
      let map: Record<string, boolean> = {};
      try {
        const raw = localStorage.getItem('ubm_weekly_off_registered');
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === 'object' && parsed.week === undefined) map = parsed;
        else if (parsed?.week && parsed?.value === true) map[parsed.week] = true;
      } catch {}
      if (v) map[wk] = true;
      else delete map[wk];
      localStorage.setItem('ubm_weekly_off_registered', JSON.stringify(map));
    } catch {}
  };
  const [hasRegisteredWeeklyOff, setHasRegisteredWeeklyOff] = useState<boolean>(() => readWeeklyOffSaved());

  const [weeklyOffData, setWeeklyOffData] = useState({
    day1: '',
    day2: '',
    reason: 'Đăng ký 2 ngày nghỉ OFF tuần theo định biên quy chế Ụm Bò Milk',
  });
  // Chống bấm gửi 2 lần (bấm đúp tạo phiếu trùng ngày thứ 3).
  const [weeklyOffBusy, setWeeklyOffBusy] = useState(false);

  // Trạng thái cổng đăng ký OFF/tuần từ server (khung giờ T6 12h -> T7 15h)
  const [weeklyOffWindow, setWeeklyOffWindow] = useState<any>(null);
  const [weeklyOffLocked, setWeeklyOffLocked] = useState(false);
  const [weeklyOffLockKnown, setWeeklyOffLockKnown] = useState(false);

  const [leaveData, setLeaveData] = useState({
    leaveType: 'HANG_TUAN',
    requestedDate: new Date().toISOString().split('T')[0],
    reason: 'Đăng ký ngày nghỉ theo quy định',
  });

  // NV thử việc: chọn 5 ngày OFF trong 12 ngày thử việc (7 làm / 5 OFF)
  const [probOffSelected, setProbOffSelected] = useState<string[]>([]);
  const [probOffDone, setProbOffDone] = useState<{ offDates: string[]; workDates: string[] } | null>(null);
  const [probOffBusy, setProbOffBusy] = useState(false);

  // Attendance tracking state
  const [attendanceActionType, setAttendanceActionType] = useState<'CHECK_IN' | 'CHECK_OUT'>('CHECK_IN');
  // GPS thật từ thiết bị (null = chưa đo được, KHÔNG dùng số giả lập)
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  // Ảnh chụp thật từ camera (dataURL), null = chưa chụp
  const [photoData, setPhotoData] = useState<string | null>(null);
  // % hồng đồng phục đo được lúc chụp (gửi kèm để HR đối soát)
  const [photoPinkRatio, setPhotoPinkRatio] = useState<number | null>(null);
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
  // Phiếu đổi ca liên quan đến tôi (gửi đi + chờ tôi xác nhận)
  const [mySwaps, setMySwaps] = useState<any[]>([]);
  const fetchMySwaps = async () => {
    try {
      const list = await apiRequest('/swap-requests');
      setMySwaps(Array.isArray(list) ? list : []);
    } catch { /* offline: giữ danh sách cũ */ }
  };
  // NV B xác nhận / từ chối phiếu tráo ca (B đồng ý là 2 ca hoán đổi ngay, không cần HR duyệt)
  const handleRespondSwap = async (swapId: string, accept: boolean) => {
    if (!window.confirm(accept ? 'Đồng ý tráo đổi ca này? Hai ca sẽ hoán đổi người trực ngay!' : 'Từ chối phiếu tráo đổi ca này?')) return;
    setActionBusy('respond');
    try {
      const res = await apiRequest(`/swap-requests/${swapId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ accept }),
      });
      const warns: string[] = (res as any)?.result?._warnings || (res as any)?._warnings || [];
      showToast(accept ? `✓ Đã đồng ý! Hai ca hoán đổi ngay.${warns.length ? ` Lưu ý: ${warns.join(' ')}` : ''}` : 'Đã từ chối phiếu đổi ca.');
      await fetchMySwaps();
      await loadEmployeeData(employee?.employee_id);
    } catch (e: any) {
      showToast(e?.message || 'Lỗi khi phản hồi!');
    } finally {
      setActionBusy(null);
    }
  };
  // Mất mạng / server lỗi khi tải dữ liệu
  const [dataStale, setDataStale] = useState(false);

  // Probation Self-Swap State: Tu do doi Ca lam <-> Nghi
  const [probationSelfSwap, setProbationSelfSwap] = useState({
    date: new Date().toISOString().split('T')[0],
    direction: 'WORK_TO_OFF',
    shiftName: 'Ca 1 (07:00 - 12:00)',
    reason: 'Đổi lịch cá nhân trong chu kỳ 12 ngày thử việc',
  });

  // NV thử việc TỰ thêm ca đẩy nhanh (không cần HR duyệt, tối đa 2 ca/ngày).
  const [extraShift, setExtraShift] = useState({
    date: '',
    shiftCode: 'CA_2',
  });
  const [extraShiftBusy, setExtraShiftBusy] = useState(false);
  const handleAddExtraShift = async () => {
    if (!extraShift.date) {
      showToast('⚠️ Vui lòng chọn ngày muốn thêm ca!');
      return;
    }
    setExtraShiftBusy(true);
    try {
      const res: any = await apiRequest('/me/probation-extra-shift', {
        method: 'POST',
        body: JSON.stringify({ date: extraShift.date, shiftCode: extraShift.shiftCode }),
      });
      const s = res?.result || res;
      showToast(`⚡ Đã tự thêm ${s.shift_code} ngày ${s.date} thành công! Không cần HR duyệt — HR đã nhận thông báo theo dõi.`);
      await loadEmployeeData(employee?.employee_id);
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (/MAX_2_SHIFTS_PER_DAY/.test(msg)) {
        showToast(`🚨 Ngày này bạn đã đủ 2 ca — hệ thống KHÔNG cho xếp thêm và đã báo Nhân sự! ${msg.replace(/^MAX_2_SHIFTS_PER_DAY:\s*/, '')}`);
      } else {
        showToast(msg || 'Lỗi khi tự thêm ca!');
      }
    } finally {
      setExtraShiftBusy(false);
    }
  };

  // Emergency Leave Form
  const [emergencyData, setEmergencyData] = useState({
    date: new Date().toISOString().split('T')[0],
    reason: 'Sốt cao đột xuất / Việc gia đình khẩn cấp',
    shift: 'Ca Sáng (07:00 - 12:00)',
  });
  // Báo nghỉ khẩn với NV thử việc: mặc định ẨN, chỉ hiện khi Admin/HR kích hoạt
  // 1 lượt duy nhất. Gửi xong phiếu là lượt bị tiêu thụ -> tự ẩn lại ngay.
  const [emergencyEnabled, setEmergencyEnabled] = useState(false);
  const fetchEmergencyStatus = async () => {
    try {
      const st: any = await apiRequest('/me/emergency-leave-status');
      setEmergencyEnabled(!!st?.enabled);
    } catch { /* offline: giữ trạng thái cũ */ }
  };

  // Adjustment Request Form
  const [adjustmentData, setAdjustmentData] = useState({
    date: new Date().toISOString().split('T')[0],
    shift: 'Ca Sáng (07:00 - 12:00)',
    type: 'QUEN_CHECKIN',
    reason: 'Quên bấm điểm danh khi vào ca do tiếp nhận hàng hóa gấp',
  });
  // Ca cần bổ sung (ngày 2 ca: phải chọn đúng ca thì HR duyệt mới cập nhật đúng)
  const [adjustShiftId, setAdjustShiftId] = useState('');
  // Phiếu bổ sung công của tôi (trạng thái realtime + đếm ngược 30 phút)
  const [myAdjustments, setMyAdjustments] = useState<any[]>([]);
  const [adjNow, setAdjNow] = useState(() => Date.now());
  // Nhịp realtime trang chủ: tự nhảy trạng thái ca (sắp tới -> đang diễn ra -> đã xong)
  const [homeNow, setHomeNow] = useState(() => Date.now());
  useEffect(() => {
    if (activeTab !== 'home') return;
    const t = setInterval(() => setHomeNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [activeTab]);
  const fetchMyAdjustments = async () => {
    try {
      const list = await apiRequest('/attendance/adjustments');
      setMyAdjustments(Array.isArray(list) ? list : []);
    } catch { /* offline */ }
  };

  // Lịch kiểm tra đầu ra thử việc (Meet vấn đáp + trắc nghiệm) do HR lên lịch.
  const [probationAssessment, setProbationAssessment] = useState<any | null>(null);
  const fetchProbationAssessment = async () => {
    try {
      const d: any = await apiRequest('/me/probation-assessment');
      setProbationAssessment(d?.assessment || null);
    } catch { /* offline: giữ trạng thái cũ */ }
  };

  // Bài TEST do HR giao riêng cho mình (không được giao thì không thấy bài)
  const [myTests, setMyTests] = useState<any[]>([]);
  const [activeTestId, setActiveTestId] = useState<string | null>(null);
  const [testAnswers, setTestAnswers] = useState<number[]>([]);
  const [testLeft, setTestLeft] = useState(0);
  const fetchMyTests = async () => {
    try {
      const list = await apiRequest('/me/tests');
      setMyTests(Array.isArray(list) ? list : []);
    } catch { /* offline: giữ danh sách cũ */ }
  };
  const submitActiveTest = async (isAuto = false) => {
    if (!activeTestId) return;
    const filled = testAnswers.map(a => (a < 0 ? 0 : a));
    try {
      const res = await apiRequest(`/me/tests/${activeTestId}/submit`, {
        method: 'POST',
        body: JSON.stringify({ answers: filled }),
      });
      const r = (res as any)?.result || res;
      showToast(isAuto ? `Hết giờ — tự nộp bài! Điểm: ${r.score}/10.` : `Đã nộp bài! Điểm: ${r.score}/10 — ${r.passed ? 'Đạt' : 'Chưa đạt'}.`);
      setActiveTestId(null);
      await fetchMyTests();
    } catch (e: any) {
      showToast(e?.message || 'Lỗi khi nộp bài!');
    }
  };

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

  // Bài TEST: tải khi mở tab + đếm ngược tự nộp khi hết giờ
  useEffect(() => {
    if (activeTab === 'test_exam' || activeTab === 'test_training') fetchMyTests();
    if (activeTab === 'swap_shift') fetchMySwaps();
    // Lịch kiểm tra đầu ra: tải lại khi mở trang chủ / lịch / thi (luôn tươi).
    if (activeTab === 'home' || activeTab === 'schedule' || activeTab === 'test_exam' || activeTab === 'test_training') {
      fetchProbationAssessment();
    }
    // Trạng thái kích hoạt báo nghỉ khẩn (NV thử việc): mở tab là kiểm tra lại.
    if (activeTab === 'swap_emergency') fetchEmergencyStatus();
    // Đồng hồ đếm ngược phiếu 30 phút (chỉ chạy ở tab bổ sung công)
    if (activeTab === 'adjustment' || activeTab === 'emergency_adjust') {
      const clock = setInterval(() => setAdjNow(Date.now()), 1000);
      return () => clearInterval(clock);
    }
    if (activeTab === 'adjustment' || activeTab === 'emergency_adjust') {
      fetchMyAdjustments();
      const t = setInterval(fetchMyAdjustments, 15000);
      return () => clearInterval(t);
    }
    // Điểm danh/lịch: tải mới mỗi lần mở để trạng thái (vắng/khóa/bị thu hồi do GPS...)
    // luôn khớp server — không giữ trạng thái cũ (VD: vẫn hiện "đang làm" dù đã bị xóa).
    if ((activeTab === 'attendance' || activeTab === 'schedule') && employee?.employee_id) {
      loadEmployeeData(employee.employee_id);
    }
  }, [activeTab]);
  useEffect(() => {
    if (!activeTestId) return;
    if (testLeft <= 0) {
      submitActiveTest(true);
      return;
    }
    const t = setTimeout(() => setTestLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [activeTestId, testLeft]);

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
      // 4 nhóm độc lập bắn SONG SONG (trước await nối tiếp + 30 request attendance).
      // Dùng ngày VN để toDate bao trọn sự kiện hôm nay (backend lọc theo ngày VN).
      const toDate = new Date(Date.now() + 7 * 3_600_000).toISOString().split('T')[0];
      const fromDt = new Date(Date.now() + 7 * 3_600_000);
      fromDt.setDate(fromDt.getDate() - 29);
      const fromDate = fromDt.toISOString().split('T')[0];
      const [shifts, notifs, attRange, colleagues] = await Promise.all([
        apiRequest('/me/schedule').catch(() => { fails++; return []; }),
        apiRequest('/me/notifications').catch(() => { fails++; return []; }),
        apiRequest(`/me/attendance?fromDate=${fromDate}&toDate=${toDate}`).catch(() => { fails++; return null; }),
        apiRequest('/me/colleagues').catch(() => { fails++; return []; }),
        refreshWeeklyOffStatus(),
      ]);
      setMyShifts(shifts);
      setNotifications(notifs);
      const attEvents: any[] = Array.isArray(attRange) ? attRange : [];

      const today = new Date().toISOString().split('T')[0];
      const todayCheckIn = attEvents.find((e: any) => e.type === 'CHECK_IN' && e.client_time?.startsWith(today));
      const todayCheckOut = attEvents.find((e: any) => e.type === 'CHECK_OUT' && e.client_time?.startsWith(today));
      const inTimeStr = todayCheckIn?.client_time ? new Date(todayCheckIn.client_time).toLocaleTimeString('vi-VN') : undefined;
      const outTimeStr = todayCheckOut?.client_time ? new Date(todayCheckOut.client_time).toLocaleTimeString('vi-VN') : undefined;
      setMyAttendanceHistory(attEvents);
      setTodayAttendance({
        checkedIn: !!todayCheckIn,
        checkedOut: !!todayCheckOut,
        inTime: inTimeStr,
        outTime: outTimeStr,
        checkInTime: inTimeStr,
        checkOutTime: outTimeStr,
        receipt: todayCheckIn,
      });

      setBranchColleagues(colleagues);
      // Lịch kiểm tra đầu ra thử việc (banner Meet + Quiz luôn tươi theo realtime)
      fetchProbationAssessment().catch(() => null);
      // Phiếu đổi ca chờ xác nhận (banner realtime)
      fetchMySwaps().catch(() => null);
      // Mất mạng toàn bộ -> báo rõ đang xem dữ liệu cũ, không im lặng
      setDataStale(fails >= 4);
    } catch (err) {
      console.error(err);
    }
  };

  const [checkingStatus, setCheckingStatus] = useState<'IDLE' | 'CHECKING' | 'ACTIVE' | 'ERROR'>('IDLE');

  const handlePhoneLogin = async (phoneToLogin = loginPhone, pinToLogin = loginPin) => {
    const cleaned = phoneToLogin.replace(/[\s\-\.\(\)]/g, '');
    // Chấp nhận 3 kiểu: 0946914474 (10 số) / 946914474 (9 số, thiếu 0) / 84946914474 (84...).
    // Server chuẩn hóa về 1 mối nên kiểu nào cũng hợp lệ.
    if (cleaned.length < 9 || cleaned.length > 12) {
      setCheckingStatus('ERROR');
      setLoginError('Vui lòng nhập số điện thoại (9-11 chữ số, ví dụ 0946914474)!');
      return;
    }
    const pin = (pinToLogin || '').trim();
    if (!/^\d{6}$/.test(pin)) {
      setCheckingStatus('ERROR');
      setLoginError('Vui lòng nhập mã PIN đúng 6 chữ số!');
      return;
    }

    setLoading(true);
    setCheckingStatus('CHECKING');
    setLoginError(null);
    try {
      const res = await apiRequest('/auth/employee/phone-login', {
        method: 'POST',
        body: JSON.stringify({ phone: cleaned, pin }),
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
      } else if (err.message === 'PIN_RESET_REQUIRED') {
        setCheckingStatus('ERROR');
        setLoginError('Mã PIN cũ của bạn chưa đủ 6 số nên hệ thống đã tự động reset. Vui lòng hỏi HR lấy mã PIN 6 số mới rồi đăng nhập và đổi PIN riêng!');
      } else if (err.message === 'INVALID_PIN') {
        setCheckingStatus('ERROR');
        setLoginError('Mã PIN không đúng! Nhập lại mã PIN 6 số của bạn. Nếu quên, hỏi HR xem lại mã PIN hiện tại.');
      } else if (err.message === 'DUPLICATE_PHONE_NEEDS_HR') {
        setCheckingStatus('ERROR');
        setLoginError(`Số điện thoại ${cleaned} bị trùng lặp trên 2 hồ sơ khác nhau. Cần gặp HR để đối soát thông tin.`);
      } else if (err.message === 'SHEETS_LOADING') {
        setCheckingStatus('ERROR');
        setLoginError('⏳ Hệ thống vừa khởi động, đang tải dữ liệu (khoảng 30 giây). Vui lòng đợi rồi bấm ĐĂNG NHẬP lại — tài khoản của bạn vẫn còn, KHÔNG cần tạo lại!');
      } else if (err.message === 'SHEETS_UNAVAILABLE') {
        setCheckingStatus('ERROR');
        setLoginError('⚠️ Máy chủ tạm thời không đọc được dữ liệu. Vui lòng báo HR/Admin kiểm tra, không tạo lại tài khoản.');
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

  // Bước 1 login mới (không nút Tiếp tục): SĐT có tồn tại trong CSDL không.
  const handleCheckPhone = async (phoneToCheck: string): Promise<boolean> => {
    const cleaned = phoneToCheck.replace(/[\s\-\.\(\)]/g, '');
    setLoginPhone(phoneToCheck);
    try {
      const res = await apiRequest('/auth/employee/check-phone', {
        method: 'POST',
        body: JSON.stringify({ phone: cleaned }),
      });
      return (res as any)?.exists === true;
    } catch (err: any) {
      throw new Error(premiumErrorText(err, cleaned));
    }
  };

  // Premium 3-step login: verify thật qua API, ném lỗi để UI rung + đỏ (không vào success).
  const premiumResRef = useRef<any>(null);
  const premiumErrorText = (err: any, cleaned: string): string => {
    const code = String(err?.code || err?.message || '');
    if (/ACCOUNT_NOT_FOUND/.test(code)) return `Số ${cleaned} chưa tồn tại trên Master. Liên hệ HR để nộp hồ sơ.`;
    if (/PIN_NOT_SET/.test(code)) return `Tài khoản ${cleaned} chưa được cấp PIN. Liên hệ HR để nhận mã!`;
    if (/PIN_RESET_REQUIRED/.test(code)) return 'Mã PIN cũ của bạn chưa đủ 6 số nên hệ thống đã tự động reset. Hỏi HR lấy mã PIN 6 số mới rồi đăng nhập và đổi PIN riêng!';
    if (/INVALID_PIN/.test(code)) return 'Mã PIN chưa đúng! Kiểm tra lại hoặc hỏi HR xem lại mã hiện tại.';
    if (/DUPLICATE_PHONE_NEEDS_HR/.test(code)) return `SĐT ${cleaned} bị trùng 2 hồ sơ. Gặp HR để đối soát.`;
    if (/SHEETS_LOADING/.test(code)) return '⏳ Hệ thống vừa khởi động, đang tải dữ liệu (~30s). Đợi rồi thử lại!';
    if (/SHEETS_UNAVAILABLE/.test(code)) return '⚠️ Máy chủ tạm không đọc được dữ liệu. Báo HR/Admin kiểm tra.';
    return err?.message || 'Đăng nhập thất bại. Thử lại!';
  };
  const handlePremiumLogin = async (phoneToLogin: string, pinToLogin: string) => {
    const cleaned = phoneToLogin.replace(/[\s\-\.\(\)]/g, '');
    setLoginPhone(phoneToLogin);
    setLoginPin(pinToLogin);
    setCheckingStatus('CHECKING');
    setLoginError(null);
    try {
      const res = await apiRequest('/auth/employee/phone-login', {
        method: 'POST',
        body: JSON.stringify({ phone: cleaned, pin: (pinToLogin || '').trim() }),
      });
      setAuthToken(res.token);
      if (res.refreshToken) {
        try { localStorage.setItem('ubm_emp_refresh', res.refreshToken); } catch {}
      }
      if (res.mustChangePin) {
        // Không vào success — chuyển sang màn đổi PIN bắt buộc.
        setEmployee(res.employee || null);
        setNewPin('');
        setConfirmPin('');
        setOldPinInput('');
        setMustChangePin(true);
        setIsLoggedIn(false);
        setLoginError('🔑 Tài khoản của bạn chưa đổi mã PIN mới! Vui lòng đổi PIN để vào hệ thống.');
        const e: any = new Error('MUST_CHANGE_PIN');
        e.code = 'MUST_CHANGE_PIN';
        throw e;
      }
      // Giữ kết quả, chờ success animation xong mới vào cổng.
      premiumResRef.current = res;
      setCheckingStatus('ACTIVE');
    } catch (err: any) {
      if (err?.code === 'MUST_CHANGE_PIN' || err?.message === 'MUST_CHANGE_PIN') throw err;
      setCheckingStatus('ERROR');
      const msg = premiumErrorText(err, cleaned);
      setLoginError(msg);
      throw new Error(msg);
    }
  };
  const handlePremiumSuccess = async () => {
    const res = premiumResRef.current;
    premiumResRef.current = null;
    if (!res) return;
    await finishLogin(res);
  };

  const handleChangePin = async () => {
    // Sau reload loginPin đã mất -> lấy PIN cũ từ ô nhập tay (bắt buộc nhập lại).
    // PIN cũ chấp nhận 4-8 số (tài khoản legacy đổi lần cuối), PIN mới bắt buộc đúng 6 số.
    const effectiveOld = (loginPin.trim() || oldPinInput.trim());
    if (!/^\d{4,8}$/.test(effectiveOld)) {
      setLoginError('Vui lòng nhập mã PIN cũ hiện tại!');
      return;
    }
    if (!/^\d{6}$/.test(newPin)) {
      setLoginError('Mã PIN mới phải đúng 6 chữ số!');
      return;
    }
    if (newPin !== confirmPin) {
      setLoginError('Xác nhận mã PIN chưa khớp! Vui lòng nhập lại.');
      return;
    }
    if (newPin === effectiveOld) {
      setLoginError('Mã PIN mới phải khác mã PIN cũ hiện tại!');
      return;
    }
    setLoading(true);
    setLoginError(null);
    try {
      await apiRequest('/auth/employee/change-pin', {
        method: 'POST',
        body: JSON.stringify({ oldPin: effectiveOld, newPin }),
      });
      showToast('🎉 Đổi mã PIN thành công! Đây là mã PIN riêng của bạn, không chia sẻ cho người khác.');
      setLoginPin(newPin);
      // Xóa ô PIN mới/xác nhận để trình duyệt không giữ/gi autofill mã cũ.
      setNewPin('');
      setConfirmPin('');
      setOldPinInput('');
      // Token hiện tại đã bị thu hồi (version tăng) -> đăng nhập lại bằng PIN mới
      setAuthToken('');
      setMustChangePin(false);
      await handlePhoneLogin(loginPhone, newPin);
    } catch (err: any) {
      if (err.message === 'SAME_PIN') {
        setLoginError('Mã PIN mới phải khác mã PIN cũ hiện tại!');
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
    if (cleaned.length < 9) {
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
    setOldPinInput('');
    setActiveTab('home');
    localStorage.removeItem('ubm_emp_data');
    localStorage.removeItem('ubm_emp_token');
    localStorage.removeItem('ubm_emp_refresh');
    localStorage.removeItem('ubm_emp_active_tab');
  };

  // Refs chống stale-closure cho socket realtime (đặt sau loadEmployeeData).
  const loadEmployeeDataRef = useRef(loadEmployeeData);
  loadEmployeeDataRef.current = loadEmployeeData;
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const fetchMySwapsRef = useRef(fetchMySwaps);
  fetchMySwapsRef.current = fetchMySwaps;
  const fetchMyAdjustmentsRef = useRef(fetchMyAdjustments);
  fetchMyAdjustmentsRef.current = fetchMyAdjustments;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const empIdRef = useRef<string | undefined>(undefined);
  empIdRef.current = employee?.employee_id;

  // Realtime Socket.IO: lịch/HR đổi gì là app NV cập nhật tức thì (debounce 1s).
  useEffect(() => {
    if (!isLoggedIn) return;
    const token = getAuthToken();
    if (!token) return;
    let socket: Socket | null = null;
    let timer: any = null;
    let reloading = false;
    let queued = false;
    const reload = (entity?: string) => {
      if (reloading) { queued = true; return; }
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        timer = null;
        reloading = true;
        try {
          await loadEmployeeDataRef.current(empIdRef.current);
          await fetchMySwapsRef.current().catch(() => null);
          // Kết quả duyệt phiếu công: tải lại ngay khi đang ở tab phiếu (khỏi chờ poll 15s).
          if (entity === 'adjustments' && (activeTabRef.current === 'adjustment' || activeTabRef.current === 'emergency_adjust')) {
            await fetchMyAdjustmentsRef.current().catch(() => null);
          }
        } catch { /* lần sau */ } finally {
          reloading = false;
          if (queued) { queued = false; reload(); }
        }
      }, 1000);
    };
    try {
      const base = getApiBase();
      // Realtime có bảo vệ: backoff reconnect + tự ngắt sau nhiều lỗi liên tiếp
      // (sai địa chỉ máy chủ / server ngủ) để khỏi spam lỗi WebSocket vô hạn.
      socket = connectRealtime(base, token, {
        onConnect: () => reload(),
        onGiveUp: () => {
          console.warn(
            `[Socket.IO] Không nối được realtime tới ${base} sau nhiều lần thử (địa chỉ máy chủ sai / server đang ngủ / mạng chặn websocket). Đã tạm dừng thử lại — bấm "đổi máy chủ" dưới màn hình đăng nhập nếu cần. Dữ liệu vẫn tải được khi mở tab.`
          );
          showToastRef.current('📡 Không kết nối được realtime — dữ liệu vẫn tải khi bạn mở từng tab. Kiểm tra địa chỉ máy chủ nếu lỗi kéo dài!');
        },
      });
      socket.on('data:updated', (p: any) => reload(p?.entity));
      socket.on('notification.created', reload);
      // Phiếu đổi ca gửi tới tôi: tải ngay + popup để xác nhận/từ chối.
      socket.on('swap.updated', async (p: any) => {
        try { await fetchMySwapsRef.current(); } catch { /* bỏ qua */ }
        if (p?.status === 'PENDING_PARTNER') {
          showToastRef.current('🔔 Có phiếu đổi ca mới chờ bạn xác nhận! Mở tab Đổi ca để Đồng ý / Từ chối.');
        } else if (p?.status === 'PARTNER_ACCEPTED') {
          showToastRef.current('✓ Đồng nghiệp đã xác nhận đổi ca! Chờ Store duyệt.');
        } else if (p?.status === 'APPROVED') {
          showToastRef.current('✓ Store đã duyệt tráo ca! Lịch làm việc đã cập nhật.');
        }
        reload();
      });
      socket.on('system:notification', (n: any) => {
        // Ràng buộc 2 chiều: cổng nhân viên chỉ popup tin TỪ phía quản trị (HR).
        const fromAdmin = !n?.origin || n.origin === 'ADMIN';
        if (fromAdmin && (n?.message || n?.title)) showToastRef.current(`🔔 ${n.title || ''}${n.title && n.message ? ': ' : ''}${n.message || ''}`.trim());
        reload();
      });
    } catch { /* offline — lần mở sau thử lại */ }
    return () => {
      if (timer) clearTimeout(timer);
      if (socket) socket.disconnect();
    };
  }, [isLoggedIn]);

  // Guard: Mandatory 2-day OFF registration locks other tabs for official employees
  // Ưu tiên trạng thái khóa từ server; khi offline mới dùng cờ localStorage cũ.
  const weeklyOffGateLocked = weeklyOffLockKnown ? weeklyOffLocked : !hasRegisteredWeeklyOff;
  // Cổng đăng ký chỉ mở T6 11h45 -> T7 15h. Chưa rõ trạng thái (offline) thì cho bấm, server sẽ quyết.
  const weeklyOffRegOpen = !weeklyOffWindow || weeklyOffWindow.phase === 'OPEN';
  const weeklyOffOpensAtStr = weeklyOffWindow?.windowOpensAt
    ? new Date(weeklyOffWindow.windowOpensAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', weekday: 'long', day: '2-digit', month: '2-digit' })
    : '11h45 Thứ 6';
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
      // Khóa local theo tuần MỤC TIÊU của cổng (kể cả đợt mở bù VIP cho tuần sau).
      const targetWk = st?.window?.targetWeekMon || undefined;
      if (st.completed) {
        setHasRegisteredWeeklyOff(true);
        persistWeeklyOff(true, targetWk);
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
        persistWeeklyOff(false, targetWk);
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
      return '⏰ Đăng ký 2 ngày nghỉ OFF chỉ mở từ 11h45 Thứ 6 đến 15h00 Thứ 7 hàng tuần!';
    }
    if (err?.code === 'SESSION_EXPIRED' || /unauthorized|401|hết hạn|đăng nhập lại/i.test(m)) {
      return '🔒 Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại rồi đăng ký tiếp!';
    }
    if (m === 'UNAUTHORIZED') {
      return '🔒 Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại rồi đăng ký tiếp!';
    }
    return err?.message || fallback;
  };

  // Ca đang điểm danh (ngày 2 ca do tráo đổi: phải chọn đúng ca để check-in/out)
  const [attendShiftId, setAttendShiftId] = useState('');
  /** Mật độ ca của chính NV: gom ca theo ngày (loại CANCELLED, khử trùng) để
   *  biết mình có ngày nào làm 2 ca (đẩy nhanh thử việc) hay không. */
  const shiftDensityOf = (list: any[]) => {
    const seen = new Set<string>();
    const byDate = new Map<string, any[]>();
    for (const s of list || []) {
      if (!s || s.status === 'CANCELLED') continue;
      const key = s.assignment_id || `${s.date}|${s.shift_code}|${s.start_at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = String(s.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(s);
    }
    const multiDays: { date: string; count: number; codes: string }[] = [];
    for (const [d, arr] of byDate) {
      if (arr.length >= 2) {
        multiDays.push({ date: d, count: arr.length, codes: arr.map((x: any) => String(x.shift_code || '')).join(' + ') });
      }
    }
    multiDays.sort((a, b) => a.date.localeCompare(b.date));
    return { total: seen.size, multiDays };
  };
  /** Ngày hôm nay theo giờ VN (tránh lệch ngày UTC 00:00–07:00). */
  const vnTodayStr = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  /** Chuẩn hóa mọi biến thể ngày về YYYY-MM-DD (mirror backend normSheetDate):
   *  ISO/ISO-datetime, serial Sheets, 'M/D/YYYY'/'D/M/YYYY' (Sheets tự biến
   *  'YYYY-MM-DD' ghi bằng USER_ENTERED thành serial rồi đọc lại theo locale). */
  const toISODate = (input: unknown): string => {
    let s = String(input ?? '').trim().replace(/^'/, '');
    if (!s) return '';
    if (/^\d{4,6}$/.test(s)) {
      const n = Number(s);
      if (n > 20000 && n < 80000) return new Date(Math.round((n - 25569) * 86_400_000)).toISOString().slice(0, 10);
      return '';
    }
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) {
      const m = Number(iso[2]); const d = Number(iso[3]);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${iso[1]}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      return '';
    }
    const sl = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (sl) {
      let y = Number(sl[3]); if (y < 100) y += 2000;
      const a = Number(sl[1]); const b = Number(sl[2]);
      let m: number; let dd: number;
      if (a > 12 && b <= 12) { dd = a; m = b; }
      else if (b > 12 && a <= 12) { m = a; dd = b; }
      else { dd = a; m = b; }
      if (m >= 1 && m <= 12 && dd >= 1 && dd <= 31) return `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      return '';
    }
    const t = new Date(s).getTime();
    if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);
    return '';
  };
  const SHIFT_HOURS_LABEL: Record<string, string> = {
    CA_1: 'Ca 1: 07:00 - 12:00',
    CA_2: 'Ca 2: 12:00 - 18:00',
    CA_3: 'Ca 3: 18:00 - 23:00',
  };
  const shiftLabelOf = (s: any) => SHIFT_HOURS_LABEL[s?.shift_code] || (s?.shift_code ? String(s.shift_code) : '');
  const getTodayShifts = () => {
    const today = vnTodayStr();
    return myShifts.filter((s: any) => s.date === today);
  };
  /** Tuần hiện tại (Mon-Sun, giờ VN): chỉ được đổi/tráo ca trong tuần đã sắp lịch này. */
  const swapWeekRange = () => {
    const vn = new Date(Date.now() + 7 * 3_600_000);
    const dowMon0 = (vn.getUTCDay() + 6) % 7;
    const monMs = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - dowMon0 * 86_400_000;
    const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    return { mon: fmt(monMs), sun: fmt(monMs + 6 * 86_400_000) };
  };
  const inSwapWeek = (dateStr?: string) => {
    const wk = swapWeekRange();
    const d = String(dateStr || '').slice(0, 10);
    return !!d && d >= wk.mon && d <= wk.sun;
  };
  /**
   * Ca hiển thị realtime ở trang chủ: đang diễn ra > sắp tới hôm nay > ca cuối hôm nay.
   * Không có ca nào -> shift null (hiện trạng thái nghỉ).
   */
  const getCurrentShift = (): { shift: any; all: any[]; phase: 'LIVE' | 'UPCOMING' | 'DONE' | 'NONE' } => {
    const today = vnTodayStr();
    const list = myShifts
      .filter((s: any) => s.date === today && s.status !== 'CANCELLED')
      .sort((a: any, b: any) => String(a.start_at || '').localeCompare(String(b.start_at || '')));
    if (list.length === 0) return { shift: null, all: [], phase: 'NONE' };
    const now = Date.now();
    const startOf = (s: any) => new Date(s.start_at || `${s.date}T00:00:00+07:00`).getTime();
    const endOf = (s: any) => new Date(s.end_at || `${s.date}T23:59:59+07:00`).getTime();
    const live = list.find((s: any) => {
      const st = startOf(s);
      const en = endOf(s);
      return Number.isFinite(st) && Number.isFinite(en) && now >= st && now <= en;
    });
    if (live) return { shift: live, all: list, phase: 'LIVE' };
    const upcoming = list.find((s: any) => Number.isFinite(startOf(s)) && startOf(s) > now);
    if (upcoming) return { shift: upcoming, all: list, phase: 'UPCOMING' };
    return { shift: list[list.length - 1], all: list, phase: 'DONE' };
  };
  const getAttendShift = () => {
    const list = getTodayShifts();
    return list.find((s: any) => s.assignment_id === attendShiftId) || list[0];
  };
  const shiftChecked = (assignmentId?: string) => {
    if (!assignmentId) return { in: false, out: false };
    const evts = (myAttendanceHistory || []).filter((e: any) => e.assignment_id === assignmentId);
    return {
      in: evts.some((e: any) => e.type === 'CHECK_IN'),
      out: evts.some((e: any) => e.type === 'CHECK_OUT'),
    };
  };

  // Start Attendance with strict rules: today shift exists, checkin before checkout, 30m window
  const handleStartAttendance = (action: 'CHECK_IN' | 'CHECK_OUT' = 'CHECK_IN') => {
    const todayShift = getAttendShift();

    // Ràng buộc 1: Nếu hôm nay không có ca làm thì khóa chức năng
    if (!todayShift) {
      showToast('🔒 QUY CHẾ: Hôm nay bạn không có lịch ca làm việc được phân công! Chức năng điểm danh bị khóa.');
      return;
    }
    const st = shiftChecked(todayShift.assignment_id);

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

    // Ràng buộc 2: Check-in xong mới được check-out (theo từng ca)
    if (action === 'CHECK_OUT' && !st.in) {
      showToast('🚫 QUY CHẾ ĐIỂM DANH: Bạn chưa Check-in ca này! Bắt buộc phải Check-in trước mới được Check-out.');
      return;
    }

    if (action === 'CHECK_OUT' && st.out) {
      showToast('✓ Bạn đã hoàn tất Check-out cho ca này rồi!');
      return;
    }

    setAttendanceActionType(action);
    setAttendanceStep('CHECKING_GPS');
    setGpsCoords(null);
    setPhotoData(null);
    setPhotoPinkRatio(null);

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

  // Kiểm tra màu hồng đồng phục ngay trên máy (Canvas, không tốn server):
  // áo mẫu hồng bụi (H ~300-360°, bão hòa vừa) phải chiếm tối thiểu khung hình,
  // nếu không thì từ chối để NV chụp lại đúng đồng phục.
  const checkPinkUniform = (dataUrl: string): Promise<{ ratio: number; pass: boolean }> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const W = 96;
          const scale = W / img.width;
          const H = Math.max(1, Math.round(img.height * scale));
          const cv = document.createElement('canvas');
          cv.width = W;
          cv.height = H;
          const ctx = cv.getContext('2d', { willReadFrequently: true });
          if (!ctx) return resolve({ ratio: 0, pass: false });
          ctx.drawImage(img, 0, 0, W, H);
          const px = ctx.getImageData(0, 0, W, H).data;
          let pink = 0;
          const total = W * H;
          for (let i = 0; i < total; i++) {
            const r = px[i * 4] / 255;
            const g = px[i * 4 + 1] / 255;
            const b = px[i * 4 + 2] / 255;
            const mx = Math.max(r, g, b);
            const mn = Math.min(r, g, b);
            const d = mx - mn;
            const s = mx === 0 ? 0 : d / mx;
            let h = 0;
            if (d !== 0) {
              if (mx === r) h = ((g - b) / d) % 6;
              else if (mx === g) h = (b - r) / d + 2;
              else h = (r - g) / d + 4;
              h *= 60;
              if (h < 0) h += 360;
            }
            // Hồng bụi áo mẫu (pastel nên bão hòa vừa): tông hồng/đỏ hồng, không quá tối
            if (s > 0.18 && mx > 0.3 && (h >= 285 || h <= 12)) pink++;
          }
          const ratio = pink / total;
          resolve({ ratio, pass: ratio >= 0.1 });
        } catch {
          resolve({ ratio: 0, pass: false });
        }
      };
      img.onerror = () => resolve({ ratio: 0, pass: false });
      img.src = dataUrl;
    });
  };

  // Nén ảnh ngay trên máy: ảnh gốc điện thoại 3-8MB -> JPEG cạnh dài 1280px,
  // chất lượng giảm dần đến khi ≤800KB. Hết lỗi quá dung lượng, upload nhanh.
  const compressPhoto = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const MAX = 1280;
          const scale = Math.min(1, MAX / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const cv = document.createElement('canvas');
          cv.width = w;
          cv.height = h;
          cv.getContext('2d')!.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          let q = 0.85;
          const attempt = (): void => {
            cv.toBlob((blob) => {
              if (!blob) {
                reject(new Error('compress'));
                return;
              }
              if (blob.size > 800 * 1024 && q > 0.4) {
                q = Math.round((q - 0.15) * 100) / 100;
                attempt();
                return;
              }
              const r = new FileReader();
              r.onload = () => resolve(String(r.result || ''));
              r.onerror = () => reject(new Error('read'));
              r.readAsDataURL(blob);
            }, 'image/jpeg', q);
          };
          attempt();
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('decode'));
      };
      img.src = url;
    });
  };

  const handlePhotoSelected = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('⚠️ File không phải ảnh! Vui lòng chụp ảnh thật.');
      return;
    }
    // Chặn file dị thường >15MB để khỏi treo máy; còn lại tự nén xuống ≤800KB.
    if (file.size > 15 * 1024 * 1024) {
      showToast('⚠️ Ảnh quá lớn (>15MB)! Vui lòng chụp lại.');
      return;
    }
    try {
      showToast('⏳ Đang xử lý ảnh...');
      const dataUrl = await compressPhoto(file);
      if (!dataUrl) {
        showToast('⚠️ Không đọc được ảnh! Vui lòng chụp lại.');
        return;
      }
      showToast('⏳ Đang kiểm tra đồng phục áo hồng...');
      const { ratio, pass } = await checkPinkUniform(dataUrl);
      if (!pass) {
        showToast(`🚫 Ảnh thiếu màu hồng đồng phục (chỉ ${Math.round(ratio * 100)}%, cần từ 10%)! Hãy mặc áo hồng Ụm Bò Milk, chụp rõ thân áo rồi thử lại.`);
        return;
      }
      setPhotoData(dataUrl);
      setPhotoPinkRatio(Math.round(ratio * 100));
      showToast(`✓ Ảnh đạt chuẩn đồng phục (hồng ${Math.round(ratio * 100)}%)!`);
    } catch {
      showToast('⚠️ Không xử lý được ảnh! Vui lòng chụp lại.');
    }
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
      const todayShift = getAttendShift();
      const targetEndpoint = attendanceActionType === 'CHECK_IN' ? '/attendance/checkin' : '/attendance/checkout';

      const res = await apiRequest(targetEndpoint, {
        method: 'POST',
        body: JSON.stringify({
          assignment_id: todayShift?.assignment_id,
          lat: gpsCoords.lat,
          lng: gpsCoords.lng,
          accuracy: gpsCoords.accuracy,
          ...(photoData ? { photo_base64: photoData } : {}),
          ...(photoPinkRatio !== null ? { uniform_pink_ratio: photoPinkRatio } : {}),
        }),
      });
      setPhotoPinkRatio(null);

      setLastReceipt(res.receipt);
      setAttendanceStep('CONFIRMED');
      // Điểm danh lại xong -> tự tắt banner bắt điểm danh lại (GPS vượt 300m)
      try {
        const redoIds = (Array.isArray(notifications) ? notifications : [])
          .filter((n: any) => !n.read_at && (n.target_path === '/attendance') && /GPS|300m|phạm vi|vượt/i.test(`${n.title || ''} ${n.summary || ''}`))
          .map((n: any) => n.inbox_id)
          .filter(Boolean);
        if (redoIds.length > 0) {
          await Promise.all(redoIds.map(id => apiRequest(`/me/notifications/${id}/read`, { method: 'POST' }).catch(() => null)));
          setNotifications((prev: any[]) => (Array.isArray(prev) ? prev.map(x => redoIds.includes(x.inbox_id) ? { ...x, read_at: new Date().toISOString() } : x) : prev));
        }
      } catch { /* không chặn luồng chính */ }
      // GPS yếu/vượt phạm vi bị server từ chối thẳng (không ghi nhận) nên không còn nhánh này.
      const gpsNote = '';
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
    if (weeklyOffBusy) return;
    // Đã đăng ký đủ 2 ngày -> khóa cứng, không cho gửi lại (kể cả gọi trực tiếp).
    if (hasRegisteredWeeklyOff) {
      showToast('🔒 Bạn đã đăng ký đủ 2 ngày OFF tuần này! Mỗi tuần chỉ được đăng ký 1 lần — cần đổi ngày vui lòng liên hệ HR/Store.');
      return;
    }    // Khóa ngoài khung giờ mở cổng (server cũng chặn, đây là lớp báo sớm)
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
      setWeeklyOffBusy(true);
      // API nguyên tử: ghi 2 ngày trong 1 request (kể cả đợt mở bù VIP + cập nhật lại).
      try {
        await apiRequest('/leaves/weekly-off', {
          method: 'PUT',
          body: JSON.stringify({
            day1: weeklyOffData.day1,
            day2: weeklyOffData.day2,
            reason: weeklyOffData.reason,
          }),
        });
      } catch (e: any) {
        // Fallback máy chủ cũ chưa có API mới: gửi 2 POST rời rạc như trước.
        if (!String(e?.message || '').includes('NOT_FOUND') && !String(e?.message || '').includes('404')) throw e;
        await apiRequest('/leaves', {
          method: 'POST',
          body: JSON.stringify({
            leaveType: 'HANG_TUAN',
            requestedDate: weeklyOffData.day1,
            reason: `${weeklyOffData.reason} (Ngày 1: ${weeklyOffData.day1})`,
          }),
        });
        await apiRequest('/leaves', {
          method: 'POST',
          body: JSON.stringify({
            leaveType: 'HANG_TUAN',
            requestedDate: weeklyOffData.day2,
            reason: `${weeklyOffData.reason} (Ngày 2: ${weeklyOffData.day2})`,
          }),
        });
      }

      setHasRegisteredWeeklyOff(true);
      persistWeeklyOff(true, (weeklyOffWindow as any)?.targetWeekMon || undefined);

      showToast('🎉 ĐÃ ĐĂNG KÝ 2 NGÀY NGHỈ OFF TUẦN THÀNH CÔNG! Toàn bộ chức năng hệ thống đã được mở khóa.');
      await refreshWeeklyOffStatus();
      await loadEmployeeData(employee?.employee_id);
    } catch (err: any) {
      showToast(weeklyOffErrMsg(err, 'Lỗi khi gửi đăng ký 2 ngày nghỉ!'));
    } finally {
      setWeeklyOffBusy(false);
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

  // Ngày VN hiện tại (YYYY-MM-DD) cho lưới OFF thử việc
  const probVnToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

  // 12 ngày thử việc tính từ ngày bắt đầu (start_date → +11)
  const probationWindowDays = (): string[] => {
    const s = toISODate((employee as any)?.start_date);
    if (!s) return [];
    const out: string[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(`${s}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  };

  // Tải trạng thái đã đăng ký 5 ngày OFF thử việc (nếu có)
  const loadProbationOff = async () => {
    try {
      const list: any = await apiRequest('/leave-requests');
      const arr = Array.isArray(list) ? list : [];
      const win = probationWindowDays();
      const mine = arr
        .filter((l: any) => l?.leave_type === 'THU_VIEC' && l?.status === 'APPROVED' && win.includes(toISODate(l.requested_date)))
        .map((l: any) => toISODate(l.requested_date))
        .filter(Boolean)
        .sort();
      if (mine.length >= 5) {
        const off = new Set(mine.slice(0, 5));
        setProbOffDone({ offDates: [...off].sort(), workDates: win.filter(d => !off.has(d)) });
      } else {
        setProbOffDone(null);
        if (mine.length > 0) setProbOffSelected(mine);
      }
    } catch { /* offline — giữ trạng thái cũ */ }
  };

  useEffect(() => {
    if (activeTab === 'leave' && isLoggedIn && (employee as any)?.employment_status === 'PROBATION') {
      loadProbationOff();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isLoggedIn, (employee as any)?.employee_id]);

  // Xác nhận đăng ký 5 ngày OFF thử việc -> hệ thống TỰ XẾP 7 ca làm
  const handleSubmitProbationOff = async () => {
    const dates = [...probOffSelected].sort();
    if (dates.length !== 5) {
      showToast('⚠️ Vui lòng chọn đúng 5 ngày OFF trong 12 ngày thử việc!');
      return;
    }
    if (!window.confirm(`Xác nhận đăng ký 5 ngày OFF thử việc (${dates.join(', ')})?\nHệ thống sẽ TỰ XẾP 7 ca làm vào các ngày còn lại. Đã xác nhận KHÔNG đổi lại được (liên hệ Store/HR)!`)) return;
    setProbOffBusy(true);
    try {
      const res: any = await apiRequest('/leaves/probation-off', {
        method: 'POST',
        body: JSON.stringify({ dates }),
      });
      const r = res?.result || res;
      setProbOffDone({ offDates: r.offDates || dates, workDates: r.workDates || [] });
      showToast(`🎉 ĐÃ ĐĂNG KÝ 5 NGÀY OFF THỬ VIỆC! Hệ thống đã tự xếp ${(r.workDates || []).length} ca làm cho bạn.`);
      await loadEmployeeData(employee?.employee_id);
    } catch (err: any) {
      showToast(err?.message || 'Lỗi khi đăng ký OFF thử việc!');
    } finally {
      setProbOffBusy(false);
    }
  };

  // Tải ca thật của NV B để chọn ca tráo/nhờ.
  // Dùng API /me/colleague-shifts (xác thực theo chi nhánh hồ sơ, không dính scope token cũ).
  const loadTargetShifts = async (targetEmployeeId: string) => {
    setTargetShifts([]);
    if (!targetEmployeeId) return;
    const pickPublished = (all: any) =>
      setTargetShifts(Array.isArray(all) ? all.filter((s: any) => s.status === 'PUBLISHED') : []);
    try {
      const today = vnTodayStr();
      const all = await apiRequest(`/me/colleague-shifts?employeeId=${encodeURIComponent(targetEmployeeId)}&fromDate=${today}`);
      pickPublished(all);
      if ((all as any[]).length === 0) showToast('Đồng nghiệp chưa có ca nào để tráo/nhờ (hoặc chưa tải xong)! Vui lòng chọn lại.');
    } catch (err: any) {
      // Fallback server cũ chưa có API mới (404 không mã lỗi).
      if (!err?.code && /404/.test(String(err?.message || ''))) {
        try {
          const branchId = employee?.default_branch_id || 'CN130';
          const today = vnTodayStr();
          const all = await apiRequest(`/schedules?branchId=${encodeURIComponent(branchId)}&week=${today}`);
          pickPublished(Array.isArray(all) ? all.filter((s: any) => s.employee_id === targetEmployeeId) : []);
        } catch (e2: any) {
          showToast(e2.message || 'Không tải được lịch của đồng nghiệp!');
        }
        return;
      }
      if (err?.code === 'SESSION_EXPIRED' || /hết hạn|đăng nhập lại/i.test(String(err?.message || ''))) {
        showToast('🔒 Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!');
        return;
      }
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
      showToast(`✓ Đã gửi yêu cầu đổi ca THẬT! Mã đơn: ${sid}. B đồng ý là 2 ca hoán đổi ngay.`);
      setSwapData({ myShift: '', targetEmployeeId: '', targetEmployeeName: '', targetShift: '', reason: '' });
      setTargetShifts([]);
      await fetchMySwaps();
      await loadEmployeeData(employee?.employee_id);
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi gửi yêu cầu đổi ca!');
    } finally {
      setActionBusy(null);
    }
  };

  // Thử việc tự đổi ca: WORK_TO_OFF -> đơn nghỉ thật; OFF_TO_WORK chưa có nghiệp vụ server -> hướng dẫn báo Store
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
    showToast('ℹ️ Xin đi làm ngày OFF: vui lòng báo trực tiếp Store để xếp lịch trên hệ thống. Chức năng tự gửi đơn chiều này chưa hỗ trợ.');
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
      // Lượt dùng 1 lần đã bị tiêu thụ ở server — ẩn chức năng ngay lập tức.
      setEmergencyEnabled(false);
      showToast('🚨 ĐÃ GỬI ĐƠN BÁO NGHỈ KHẨN CẤP! Lượt dùng 1 lần của bạn đã hết — chức năng tự ẩn. Dữ liệu đã đồng bộ realtime sang HR Tab 10 và Google Sheets.');
      await loadEmployeeData(employee?.employee_id);
    } catch (err: any) {
      if (String(err?.message || '').includes('EMERGENCY_LEAVE_NOT_GRANTED')) {
        setEmergencyEnabled(false);
      }
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
        // Ngày 2 ca: ưu tiên ca đã chọn, HR duyệt sẽ cập nhật đúng check-in/out ca đó.
        const dayShifts = (myShifts || []).filter((s: any) => s.date === adjustmentData.date);
        const shift = dayShifts.find((s: any) => s.assignment_id === adjustShiftId) || dayShifts[0] || (myShifts || [])[0];
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
      await fetchMyAdjustments();
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
  // Đang xác minh phiên đã lưu với server: đứng ở màn chờ, không cho vào cổng.
  if (!sessionChecked) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        padding: '24px 20px',
        backgroundColor: '#FFF8F4',
        gap: '12px',
      }}>
        <div style={{ fontSize: '40px' }}>🔐</div>
        <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--brand)' }}>
          Đang kiểm tra phiên đăng nhập...
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Tài khoản chưa đổi PIN sẽ bị bắt đổi ngay, tải lại trang cũng không bỏ qua được.
        </div>
      </div>
    );
  }

  // Màn đổi PIN bắt buộc giữ giao diện cũ (an toàn nghiệp vụ 1-5 hàng tháng).
  if (!isLoggedIn && mustChangePin) {
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
                  Mã PIN hiện tại (đúng 6 số)
                </label>
              </div>
              <div style={{ position: 'relative', marginBottom: '14px' }}>
                <input
                  type="password"
                  name="ubm-login-pin"
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Ví dụ: 123456"
                  value={loginPin}
                  onChange={(e) => setLoginPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
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
                🔑 TỚI KỲ ĐỔI PIN ĐỊNH KỲ (HẠN 1-5 HÀNG THÁNG)
              </div>
              <div style={{ fontSize: '12px', color: '#92400E', marginBottom: '12px', lineHeight: '1.5' }}>
                Bạn đang dùng PIN cũ. Hãy tự đặt mã PIN mới (đúng 6 chữ số, khác PIN cũ, không chia sẻ cho ai) để mở khóa hệ thống! Mã PIN chưa đủ 6 số đã bị hệ thống tự động reset — hỏi HR lấy mã 6 số mới nếu chưa có. Quên PIN cũ thì hỏi HR xem lại mã hiện tại.
              </div>
              {!loginPin && (
                <>
                  <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Mã PIN cũ hiện tại (bắt buộc nhập lại sau khi tải lại trang):</label>
                  <input
                    type="password"
                    name="ubm-old-pin"
                    autoComplete="new-password"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    inputMode="numeric"
                    maxLength={8}
                    placeholder="Nhập mã PIN cũ"
                    value={oldPinInput}
                    onChange={(e) => setOldPinInput(e.target.value.replace(/\D/g, ''))}
                    style={{ width: '100%', fontSize: '18px', fontWeight: 700, letterSpacing: '4px', marginBottom: '10px' }}
                  />
                </>
              )}
              <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Mã PIN mới (đúng 6 số):</label>
              <input
                type="password"
                name="ubm-new-pin"
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore="true"
                inputMode="numeric"
                maxLength={6}
                placeholder="Nhập mã PIN mới 6 số"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                style={{ width: '100%', fontSize: '18px', fontWeight: 700, letterSpacing: '4px', marginBottom: '10px' }}
              />
              <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Xác nhận mã PIN mới:</label>
              <input
                type="password"
                name="ubm-confirm-pin"
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore="true"
                inputMode="numeric"
                maxLength={6}
                placeholder="Nhập lại mã PIN mới 6 số"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
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
              {!loginPin && (
                <button
                  onClick={() => {
                    setMustChangePin(false);
                    setOldPinInput('');
                    setNewPin('');
                    setConfirmPin('');
                    setLoginError(null);
                  }}
                  style={{ width: '100%', marginTop: '8px', border: 'none', background: 'none', fontSize: '12px', color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer' }}
                >
                  ← Nhập lại SĐT / mã PIN khác
                </button>
              )}
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
            💡 <strong>Bảo mật đăng nhập:</strong> Nhập SĐT (0946914474, 946914474 hoặc 84946914474 đều được) + mã PIN đúng 6 số rồi bấm ĐĂNG NHẬP. Mã PIN chưa đủ 6 số sẽ bị hệ thống tự động reset — hỏi HR lấy mã 6 số mới rồi đổi PIN riêng! Tới kỳ 1-5 hàng tháng, hệ thống yêu cầu tự đổi PIN mới từ PIN cũ. Mỗi người giữ PIN riêng — không chia sẻ!
          </p>
          <button
            onClick={handleChangeApiBase}
            title="Bấm để đổi địa chỉ máy chủ nếu báo lỗi kết nối"
            style={{ marginTop: '10px', border: 'none', background: 'none', fontSize: '11px', color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}
          >
            🔌 Máy chủ: {apiBaseShown || '(chưa xác định)'} — bấm để đổi
          </button>
          <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--text-muted)' }}>
            Bản app: <code>{APP_COMMIT}</code> • Bản API: <code>{apiCommit || 'đang kiểm tra...'}</code>
            {apiCommit && apiCommit !== APP_COMMIT && APP_COMMIT !== 'local' && (
              <span style={{ color: 'var(--danger)', fontWeight: 700 }}> • Lệch bản — tải lại trang để nhận bản mới!</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Premium 3-step login (SĐT -> PIN 6 ô -> success + confetti). Nhánh đổi PIN ở trên.
  if (!isLoggedIn) {
    return (
      <PremiumLogin
        initialPhone={loginPhone}
        loading={loading}
        onLogin={handlePremiumLogin}
        onCheckPhone={handleCheckPhone}
        onSuccess={handlePremiumSuccess}
      />
    );
  }

  // =========================================================================
  // VIEW: LOGGED IN PORTAL
  // =========================================================================
  const { shift: currentShift, all: todayShiftList, phase: currentShiftPhase } = getCurrentShift();

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
            <strong>{weeklyOffWindow?.windowOpensAt ? new Date(weeklyOffWindow.windowOpensAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', weekday: 'long', day: '2-digit', month: '2-digit' }) : '11h45 Thứ 6'}</strong>{' '}
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
              {(weeklyOffWindow as any)?.manual && (weeklyOffWindow as any)?.manualClosesAt
                ? ` (ADMIN MỞ BÙ — ĐÓNG LÚC ${new Date((weeklyOffWindow as any).manualClosesAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit' }).toUpperCase()})`
                : weeklyOffWindow?.windowClosesAt ? ` (ĐÓNG LÚC ${new Date(weeklyOffWindow.windowClosesAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', weekday: 'long' }).toUpperCase()})` : ''}
            </strong>
          </div>
          <div style={{ fontSize: '12px', color: '#9F1239', lineHeight: '1.4' }}>
            {(weeklyOffWindow as any)?.manual
              ? <>Admin vừa mở bổ sung cổng đăng ký cho tuần <strong>{(weeklyOffWindow as any)?.targetWeekMon} → {(weeklyOffWindow as any)?.targetWeekSun}</strong>. Tranh thủ đăng ký ngay trước giờ đóng! <strong>Toàn bộ các chức năng khác tạm thời bị KHÓA</strong> cho đến khi bạn hoàn tất đăng ký 2 ngày nghỉ!</>
              : <>Hệ thống đã tự động gửi thông báo trước 5 phút giờ mở cửa đăng ký. Hiện tại đang mở cổng đăng ký 2 ngày nghỉ/tuần định kỳ. <strong>Toàn bộ các chức năng khác tạm thời bị KHÓA</strong> cho đến khi bạn hoàn tất đăng ký 2 ngày nghỉ!</>}
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

      {/* BANNER BẮT ĐIỂM DANH LẠI (GPS vượt 300m) — hiện mọi tab đến khi xử lý */}
      {(() => {
        const redo = (Array.isArray(notifications) ? notifications : []).filter((n: any) =>
          !n.read_at && (n.target_path === '/attendance') && /GPS|300m|phạm vi|vượt/i.test(`${n.title || ''} ${n.summary || ''}`)
        );
        if (redo.length === 0) return null;
        return (
          <div style={{
            margin: '12px 16px 0',
            padding: '12px 14px',
            backgroundColor: '#FEF2F2',
            border: '2px solid #DC2626',
            borderRadius: 'var(--radius-sm)',
            boxShadow: '0 4px 12px rgba(220, 38, 38, 0.2)',
          }}>
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#991B1B' }}>
              🚨 {redo[0].title || 'GPS vượt phạm vi — bắt buộc điểm danh lại!'}
            </div>
            <div style={{ fontSize: '12px', color: '#7F1D1D', marginTop: '4px' }}>{redo[0].summary || ''}</div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
              <button
                onClick={() => setActiveTab('attendance')}
                style={{ flex: 1, backgroundColor: '#DC2626', color: '#FFF', border: 'none', borderRadius: '6px', padding: '9px 12px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
              >
                👉 Điểm danh lại ngay
              </button>
              <button
                onClick={async () => {
                  try {
                    await apiRequest(`/me/notifications/${redo[0].inbox_id}/read`, { method: 'POST' });
                    setNotifications((prev: any[]) => prev.map(x => x.inbox_id === redo[0].inbox_id ? { ...x, read_at: new Date().toISOString() } : x));
                  } catch {}
                }}
                style={{ backgroundColor: '#FFF', color: '#991B1B', border: '1px solid #FCA5A5', borderRadius: '6px', padding: '9px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
              >
                Để sau
              </button>
            </div>
          </div>
        );
      })()}

      {/* BANNER PHIẾU ĐỔI CA CHỜ XÁC NHẬN — hiện mọi tab cho đến khi B bấm Đồng ý/Từ chối */}
      {!isProbation && (mySwaps.some((s: any) => s.target_employee_id === employee?.employee_id && s.status === 'PENDING_PARTNER') || mySwaps.some((s: any) => (s.swap_kind || '') === 'HR_DISPATCH' && s.status === 'PENDING_PARTNER' && !s.target_employee_id)) && (
        <div style={{
          margin: '12px 16px 0',
          padding: '12px 14px',
          backgroundColor: '#FFFBEB',
          border: '2px solid #F59E0B',
          borderRadius: 'var(--radius-sm)',
          boxShadow: '0 4px 12px rgba(245, 158, 11, 0.2)',
        }}>
          <div style={{ fontSize: '13px', fontWeight: 800, color: '#92400E' }}>
            🔔 Bạn có {mySwaps.filter((s: any) => s.target_employee_id === employee?.employee_id && s.status === 'PENDING_PARTNER').length} phiếu đổi ca chờ xác nhận{mySwaps.some((s: any) => (s.swap_kind || '') === 'HR_DISPATCH' && s.status === 'PENDING_PARTNER' && !s.target_employee_id) ? ' + ca HR điều phối (+30k) đang mở' : ''}!
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            <button
              onClick={() => setActiveTab('swap_shift')}
              style={{ flex: 1, backgroundColor: '#D97706', color: '#FFF', border: 'none', borderRadius: '6px', padding: '9px 12px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
            >
              👉 Xem & xác nhận ngay
            </button>
          </div>
        </div>
      )}

      {/* MAIN CONTENT AREA */}
      <main style={{ padding: '16px', flex: 1, paddingBottom: '32px' }}>

        {/* ========================================================= */}
        {/* TAB 1: TRANG CHỦ */}
        {/* ========================================================= */}
        {activeTab === 'home' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* BANNER KIỂM TRA ĐẦU RA THỬ VIỆC (Meet vấn đáp + trắc nghiệm) */}
            {isProbation && probationAssessment && !probationAssessment?.meetDone && (() => {
              const a = probationAssessment;
              const meetMs = new Date(`${a.meetDate}T${String(a.meetTime || '09:00').slice(0, 5)}:00+07:00`).getTime();
              const diffMs = Number.isFinite(meetMs) ? meetMs - Date.now() : NaN;
              const diffTxt = !Number.isFinite(diffMs) ? '' : diffMs <= 0 ? 'ĐÃ ĐẾN GIỜ — vào ngay!' : (() => {
                const m = Math.floor(diffMs / 60000);
                const d = Math.floor(m / 1440);
                const h = Math.floor((m % 1440) / 60);
                const mm = m % 60;
                return d > 0 ? `Còn ${d} ngày ${h} giờ` : h > 0 ? `Còn ${h} giờ ${mm} phút` : `Còn ${mm} phút`;
              })();
              const q = a.quiz;
              const quizPending = !!a.quizTestId && (!q || q.status === 'ASSIGNED');
              return (
                <div style={{ padding: '12px 14px', backgroundColor: '#EFF6FF', border: '2px solid #2563EB', borderRadius: 'var(--radius-sm)', boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)' }}>
                  <div style={{ fontSize: '13px', fontWeight: 800, color: '#1E40AF' }}>
                    🎓 Kiểm tra đầu ra thử việc — {a.meetTime} ngày {String(a.meetDate || '').split('-').reverse().join('/')}
                  </div>
                  <div style={{ fontSize: '12px', color: '#1E40AF', marginTop: '4px' }}>
                    1️⃣ Vấn đáp Google Meet {diffTxt ? `(${diffTxt})` : ''} • 2️⃣ Bài trắc nghiệm{quizPending ? ' (đang chờ bạn làm)' : q ? ` (đã nộp: ${q.score ?? '—'}/10)` : ''}.
                    {a.endDate ? <> Ngày hoàn thành thử việc của bạn: <strong>{String(a.endDate).split('-').reverse().join('/')}</strong>.</> : null}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                    <a href={a.meetUrl} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: '140px', backgroundColor: '#2563EB', color: '#FFF', borderRadius: '6px', padding: '9px 12px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', textDecoration: 'none', textAlign: 'center' }}>
                      🎥 Vào Meet vấn đáp
                    </a>
                    {quizPending && (
                      <button
                        onClick={() => setActiveTab(isProbation ? 'test_exam' : 'test_training')}
                        style={{ flex: 1, minWidth: '140px', backgroundColor: '#FFF', color: '#1E40AF', border: '1.5px solid #2563EB', borderRadius: '6px', padding: '9px 12px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                      >
                        📝 Làm bài trắc nghiệm
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
            {/* Shift Card */}
            <div className="card" style={{ background: 'linear-gradient(135deg, #FFFFFF 0%, #FFF8F4 100%)', border: '1px solid #F0D5DF' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span className="badge badge-brand">Ca làm việc hôm nay</span>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--brand)' }}>{employee?.default_branch_id}</span>
              </div>
              <div style={{ fontSize: '18px', fontWeight: 800, margin: '6px 0', color: 'var(--text)' }}>
                {currentShift ? shiftLabelOf(currentShift) : '😴 Hôm nay không có ca làm'}
              </div>
              {currentShift && (
                <div style={{ marginBottom: '8px' }}>
                  <span className="badge" style={{
                    backgroundColor: currentShiftPhase === 'LIVE' ? '#DCFCE7' : currentShiftPhase === 'UPCOMING' ? '#FEF3C7' : '#F3F4F6',
                    color: currentShiftPhase === 'LIVE' ? '#166534' : currentShiftPhase === 'UPCOMING' ? '#92400E' : '#6B7280',
                    fontWeight: 800,
                  }}>
                    {currentShiftPhase === 'LIVE' ? '● Đang trong ca' : currentShiftPhase === 'UPCOMING' ? '⏳ Ca sắp tới' : '✓ Ca đã xong'}
                  </span>
                  {todayShiftList.length > 1 && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px' }}>
                      (hôm nay bạn có {todayShiftList.length} ca)
                    </span>
                  )}
                </div>
              )}
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
                {currentShift
                  ? '* Yêu cầu: Mặc áo màu hồng Ụm Bò Milk + đeo bảng tên, có mặt trước 15 phút.'
                  : 'Hôm nay bạn không có lịch làm — nghỉ ngơi nhé! Muốn nhận ca thay, qua tab Đổi ca.'}
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
              {isProbation && probationAssessment?.endDate && (
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#1E40AF', backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 'var(--radius-sm)', padding: '8px 12px', marginBottom: '12px' }}>
                  🎓 Ngày hoàn thành thử việc của bạn: {String(probationAssessment.endDate).split('-').reverse().join('/')} — HR sẽ gửi lịch kiểm tra đầu ra (Meet + trắc nghiệm) trước ngày này.
                </div>
              )}

              {/* NV thử việc: bạn có đang đẩy nhanh (2 ca/ngày) không */}
              {isProbation && myShifts.length > 0 && (() => {
                const density = shiftDensityOf(myShifts);
                if (density.multiDays.length === 0) {
                  return (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', backgroundColor: '#F9FAFB', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', marginBottom: '12px', fontWeight: 600 }}>
                      📅 Bạn đang làm chuẩn <strong>1 ca/ngày</strong> • Tổng <strong>{density.total} ca</strong> đã xếp. Muốn đẩy nhanh 2 ca/ngày thì báo Store xếp thêm ca.
                    </div>
                  );
                }
                return (
                  <div style={{ fontSize: '12px', color: '#92400E', backgroundColor: '#FFFBEB', border: '1.5px solid #F59E0B', borderRadius: 'var(--radius-sm)', padding: '10px 12px', marginBottom: '12px', lineHeight: 1.6 }}>
                    <div style={{ fontWeight: 800, fontSize: '13px' }}>⚡ Bạn đang đẩy nhanh: {density.multiDays.length} ngày làm 2 ca!</div>
                    {density.multiDays.map(m => (
                      <div key={m.date}>• <strong>{m.date.slice(8, 10)}/{m.date.slice(5, 7)}</strong>: {m.codes} ({m.count} ca)</div>
                    ))}
                    <div style={{ marginTop: '4px' }}>Tổng <strong>{density.total} ca</strong> đã xếp trong kỳ thử việc.</div>
                  </div>
                );
              })()}

              {/* Schedule Days */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {myShifts.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', backgroundColor: '#F9FAFB', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border)', color: 'var(--text-muted)', fontSize: '13px' }}>
                    Chưa có ca làm việc được phân công. Quản lý cửa hàng sẽ cập nhật lịch làm sớm nhất trên Google Sheets.
                  </div>
                ) : (
                  myShifts.filter((s: any, i: number, arr: any[]) => !s.assignment_id || arr.findIndex((x: any) => x.assignment_id === s.assignment_id) === i).map((shift, idx) => {
                    const todayStr = vnTodayStr();
                    const isToday = shift.date === todayStr;
                    // Ngày này có mấy ca (để gắn thẻ 2 ca/ngày khi đẩy nhanh thử việc).
                    const dayShiftCount = myShifts.filter((x: any) => x?.status !== 'CANCELLED' && String(x?.date || '').slice(0, 10) === String(shift.date || '').slice(0, 10)).length;
                    const evts = (myAttendanceHistory || []).filter((e: any) => e.assignment_id === shift.assignment_id);
                    const hasCheckIn = evts.some((e: any) => e.type === 'CHECK_IN');
                    const hasCheckOut = evts.some((e: any) => e.type === 'CHECK_OUT');
                    const absentRecorded = evts.some((e: any) => e.type === 'ABSENT');
                    const startMs = shift.start_at ? new Date(shift.start_at).getTime() : NaN;
                    const endMs = shift.end_at ? new Date(shift.end_at).getTime() : NaN;
                    // Quá 3h chưa check-in -> khóa, nghỉ không lương
                    const isLocked = !hasCheckIn && Number.isFinite(startMs) && Date.now() - startMs > 3 * 60 * 60 * 1000;
                    const isComplete = hasCheckIn && hasCheckOut;
                    const isAbsent = !hasCheckIn && absentRecorded;
                    // Hết giờ tan ca +30p mà chưa check-out -> chốt (hết nhấp nháy), thiếu là không lương.
                    // Chốt cứng thêm: ngày đã qua hoặc check-in quá 12h (end_at lỗi cũng chốt).
                    const inMs = (myAttendanceHistory || []).filter((e: any) => e.assignment_id === shift.assignment_id).find((e: any) => e.type === 'CHECK_IN')?.client_time;
                    const inMsNum = inMs ? new Date(inMs).getTime() : NaN;
                    const pastDay = shift.date < todayStr;
                    const isMissingOut = hasCheckIn && !hasCheckOut && (Number.isFinite(endMs) && Date.now() - endMs > 30 * 60 * 1000 || pastDay || (Number.isFinite(inMsNum) && Date.now() - inMsNum > 12 * 60 * 60 * 1000));
                    // Vàng khi thiếu; chỉ NHẤP NHÁY khi NV đã vào ca và ca chưa hết giờ
                    const isWorking = !isComplete && !isAbsent && !isLocked && !isMissingOut;
                    const isDoing = isWorking && hasCheckIn && !hasCheckOut;
                    const cardBg = isAbsent ? '#FEF2F2' : isLocked ? '#F1F5F9' : isComplete ? '#ECFDF5' : isMissingOut ? '#FFF7ED' : isWorking ? '#FFFBEB' : isToday ? 'var(--brand-soft)' : '#FFFFFF';
                    const cardBd = isAbsent ? '1.5px solid #EF4444' : isLocked ? '1.5px solid #64748B' : isComplete ? '1.5px solid #10B981' : isMissingOut ? '1.5px solid #EA580C' : isWorking ? '1.5px solid #F59E0B' : isToday ? '1.5px solid var(--brand)' : '1px solid var(--border)';
                    const titleColor = isAbsent ? '#DC2626' : isLocked ? '#475569' : isComplete ? '#065F46' : isMissingOut ? '#9A3412' : isWorking ? '#92400E' : isToday ? 'var(--brand)' : 'var(--text)';
                    return (
                      <div
                        key={idx}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: cardBg,
                          border: cardBd,
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          animation: isDoing ? 'fx-blink 1.2s infinite' : undefined,
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '13px', color: titleColor }}>
                            {shift.date} {isToday && '• HÔM NAY'}
                            {dayShiftCount >= 2 && ' • ⚡ 2 CA/NGÀY'}
                            {isComplete && ' • ✓ HOÀN THÀNH'}
                            {isAbsent && ' • 🔴 VẮNG'}
                            {isLocked && !isAbsent && ' • 🔒 KHÓA'}
                            {isMissingOut && ' • THIẾU CHECK-OUT'}
                            {isDoing && ' • ĐANG LÀM'}
                          </div>
                          <div style={{ fontSize: '11px', color: isAbsent ? '#991B1B' : 'var(--text-muted)' }}>
                            Chi nhánh: {shift.branch_id}
                            {isComplete && ' • Đủ check-in + check-out'}
                            {isAbsent && ' • Hệ thống tự ghi vắng (không check-in/check-out qua ca)'}
                            {isLocked && !isAbsent && ' • Quá 3h chưa check-in — nghỉ không lương'}
                            {isMissingOut && ' • Hết giờ chưa check-out — không lương'}
                            {isWorking && !hasCheckIn && ' • Chưa check-in'}
                            {isWorking && hasCheckIn && !hasCheckOut && ' • Chờ check-out'}
                          </div>
                        </div>
                        <div>
                          <span
                            className={`badge ${isComplete ? 'badge-success' : isToday && !isWorking && !isLocked && !isAbsent && !isMissingOut ? 'badge-brand' : ''}`}
                            style={
                              isAbsent ? { backgroundColor: '#DC2626', color: '#FFF', fontWeight: 800 }
                              : isLocked ? { backgroundColor: '#64748B', color: '#FFF', fontWeight: 800 }
                              : isMissingOut ? { backgroundColor: '#EA580C', color: '#FFF', fontWeight: 800 }
                              : isWorking ? { backgroundColor: '#F59E0B', color: '#FFF', fontWeight: 800 }
                              : undefined
                            }
                          >
                            {isAbsent ? 'VẮNG CA' : isLocked ? 'KHÓA' : isMissingOut ? 'THIẾU OUT' : isComplete ? 'HOÀN THÀNH' : `${shift.shift_code} (${new Date(shift.start_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} - ${new Date(shift.end_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })})`}
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
                  {isProbation ? '5 Ngày/Kỳ Thử Việc' : hasRegisteredWeeklyOff ? 'Đã Chọn 2 Ngày' : 'Bắt Buộc 2 Ngày'}
                </span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
                {isProbation
                  ? 'Quy định thử việc 12 ngày (7 làm / 5 OFF): bạn chọn 5 ngày OFF, bấm xác nhận là hệ thống TỰ XẾP 7 ca làm vào các ngày còn lại. Chỉ được 1 lần duy nhất!'
                  : 'Quy định nhân viên chính thức: Bắt buộc chọn đúng 02 ngày nghỉ OFF/tuần định kỳ. Khi đăng ký xong, hệ thống sẽ tự động mở khóa toàn bộ các chức năng khác.'}
              </p>

              {isProbation ? (
                /* THỬ VIỆC: CHỌN 5 NGÀY OFF TRONG 12 NGÀY -> TỰ XẾP 7 CA LÀM */
                (() => {
                  const win = probationWindowDays();
                  const today = probVnToday();
                  const fmtD = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
                  const dow = (s: string) => ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][new Date(`${s}T00:00:00Z`).getUTCDay()];
                  if (win.length === 0) {
                    return (
                      <div style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 'var(--radius-sm)', padding: '14px', fontSize: '13px', color: '#92400E' }}>
                        ⚠️ Hồ sơ chưa có ngày bắt đầu thử việc! Liên hệ HR bổ sung rồi quay lại đăng ký.
                      </div>
                    );
                  }
                  if (probOffDone) {
                    return (
                      <div style={{ backgroundColor: '#ECFDF5', border: '1.5px solid #10B981', borderRadius: 'var(--radius-sm)', padding: '12px 14px', color: '#065F46' }}>
                        <div style={{ fontWeight: 800, fontSize: '13px' }}>🎉 BẠN ĐÃ ĐĂNG KÝ XONG 5 NGÀY OFF THỬ VIỆC!</div>
                        <div style={{ fontSize: '12px', marginTop: '6px', lineHeight: '1.6' }}>
                          • 5 ngày OFF: <strong>{probOffDone.offDates.join(', ')}</strong><br />
                          • 7 ngày làm (hệ thống tự xếp ca): <strong>{probOffDone.workDates.join(', ')}</strong><br />
                          <span style={{ fontWeight: 700 }}>✓ Muốn đổi ngày liên hệ Store/HR.</span>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 800 }}>
                        Kỳ thử việc: <strong>{win[0]} → {win[win.length - 1]}</strong> • Đã chọn <strong style={{ color: '#1D4ED8' }}>{probOffSelected.length}/5</strong> ngày OFF
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                        {win.map((d) => {
                          const past = d <= today;
                          const sel = probOffSelected.includes(d);
                          return (
                            <button
                              key={d}
                              disabled={past || probOffBusy}
                              onClick={() => {
                                if (sel) {
                                  setProbOffSelected(probOffSelected.filter(x => x !== d));
                                } else if (probOffSelected.length >= 5) {
                                  showToast('⚠️ Chỉ được chọn tối đa 5 ngày OFF!');
                                } else {
                                  setProbOffSelected([...probOffSelected, d]);
                                }
                              }}
                              title={past ? (d === today ? 'Hôm nay đang trong ca thử việc — không được đăng ký OFF!' : 'Ngày đã qua — không được đăng ký OFF!') : sel ? 'Bấm để bỏ chọn' : 'Bấm để chọn OFF'}
                              style={{
                                padding: '10px 4px',
                                borderRadius: '8px',
                                border: sel ? '2px solid #1D4ED8' : '1px solid var(--border)',
                                backgroundColor: sel ? '#DBEAFE' : past ? '#F1F5F9' : 'var(--surface)',
                                color: sel ? '#1D4ED8' : past ? '#94A3B8' : 'var(--text)',
                                fontWeight: 800,
                                fontSize: '12px',
                                cursor: past ? 'not-allowed' : 'pointer',
                                opacity: past ? 0.7 : 1,
                              }}
                            >
                              <div>{past ? '🔒' : sel ? '✅' : '⭕'} {dow(d)}</div>
                              <div>{fmtD(d)}</div>
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                        🔒 Ngày hôm nay trở về trước đang trong kỳ thử việc — <strong>không được đăng ký OFF</strong>, chỉ chọn ngày tương lai.
                      </div>
                      <button
                        className="btn-primary"
                        disabled={probOffBusy || probOffSelected.length !== 5}
                        onClick={handleSubmitProbationOff}
                        style={{ opacity: probOffSelected.length !== 5 ? 0.6 : 1 }}
                      >
                        {probOffBusy ? 'ĐANG XẾP LỊCH...' : `XÁC NHẬN 5 NGÀY OFF & TỰ XẾP 7 CA LÀM (${probOffSelected.length}/5)`}
                      </button>
                    </div>
                  );
                })()
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

                  {hasRegisteredWeeklyOff ? (
                    /* ĐÃ ĐĂNG KÝ ĐỦ 2 NGÀY -> KHÓA CỨNG CHỨC NĂNG (kể cả reload lại web).
                       Muốn đổi ngày thì liên hệ HR. */
                    <div style={{
                      backgroundColor: '#F1F5F9',
                      border: '1.5px dashed #94A3B8',
                      borderRadius: 'var(--radius-sm)',
                      padding: '20px 14px',
                      textAlign: 'center',
                    }}>
                      <Lock size={28} color="#059669" />
                      <div style={{ fontWeight: 800, fontSize: '14px', color: '#065F46', margin: '8px 0 6px' }}>
                        🔒 ĐÃ KHÓA ĐĂNG KÝ (đủ 2 ngày OFF/tuần)
                      </div>
                      <div style={{ fontSize: '12px', color: '#475569', lineHeight: '1.6' }}>
                        Bạn đã đăng ký: <strong>{weeklyOffData.day1 || '—'}</strong> và <strong>{weeklyOffData.day2 || '—'}</strong>.<br />
                        Mỗi tuần chỉ được đăng ký 1 lần duy nhất — cần đổi ngày vui lòng liên hệ HR/Store.
                      </div>
                    </div>
                  ) : !weeklyOffRegOpen ? (
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
                        Cổng đăng ký 2 ngày nghỉ OFF chỉ mở từ <strong>11h45 Thứ 6</strong> đến <strong>15h00 Thứ 7</strong> hàng tuần.<br />
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
                  <div style={{ fontSize: '11px', color: '#92400E', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '6px', padding: '8px 10px', marginBottom: '4px', lineHeight: '1.5' }}>
                    ⚠️ <strong>Luật chống trống ca:</strong> 2 bạn cùng ca — cùng chi nhánh không được OFF chung 1 ngày. Ai đăng ký trước giữ ngày, người đăng ký trùng sẽ bị chặn và phải chọn ngày khác!
                  </div>
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
                    disabled={weeklyOffBusy}
                    style={{
                      width: '100%',
                      padding: '12px',
                      fontSize: '14px',
                      fontWeight: 800,
                      backgroundColor: weeklyOffBusy ? '#9CA3AF' : hasRegisteredWeeklyOff ? '#10B981' : 'var(--brand)',
                      boxShadow: '0 4px 14px rgba(232, 93, 146, 0.35)',
                      opacity: weeklyOffBusy ? 0.7 : 1,
                    }}
                  >
                    {weeklyOffBusy ? '⏳ ĐANG GỬI...' : hasRegisteredWeeklyOff ? 'CẬP NHẬT LẠI 2 NGÀY NGHỈ OFF TUẦN' : 'GỬI ĐĂNG KÝ 2 NGÀY NGHỈ & MỞ KHÓA HỆ THỐNG'}
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
          // Ngày VN (UTC+7): cổng CA_1 mở 06:30 VN (= 23:30 UTC hôm trước) nên phải
          // dùng ngày VN — dùng ngày UTC sẽ lookup nhầm ca 00:00–07:00 VN.
          const today = vnTodayStr();
          const todayShifts = myShifts.filter((s: any) => s.date === today);
          const todayShift = todayShifts.find((s: any) => s.assignment_id === attendShiftId) || todayShifts[0];
          // Trạng thái theo TỪNG ca (ngày 2 ca do tráo đổi: mỗi ca check-in/out độc lập)
          const shiftStartMs = todayShift?.start_at ? new Date(todayShift.start_at).getTime() : NaN;
          const shiftLocked = Number.isFinite(shiftStartMs) && Date.now() - shiftStartMs > 3 * 60 * 60 * 1000;
          const shiftEvts = (myAttendanceHistory || []).filter((e: any) => e.assignment_id === todayShift?.assignment_id);
          const shiftIn = shiftEvts.find((e: any) => e.type === 'CHECK_IN');
          const shiftOut = shiftEvts.find((e: any) => e.type === 'CHECK_OUT');
          const tabAtt = {
            checkedIn: !!shiftIn,
            checkedOut: !!shiftOut,
            checkInTime: shiftIn?.client_time ? new Date(shiftIn.client_time).toLocaleTimeString('vi-VN') : undefined,
            checkOutTime: shiftOut?.client_time ? new Date(shiftOut.client_time).toLocaleTimeString('vi-VN') : undefined,
          };
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

                  {/* NGÀY 2 CA (do tráo đổi/nhận thay): chọn đúng ca để điểm danh */}
                  {todayShifts.length > 1 && (
                    <div style={{ marginBottom: '12px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
                        Hôm nay bạn có {todayShifts.length} ca — chọn ca để điểm danh:
                      </label>
                      <select
                        value={todayShift?.assignment_id || ''}
                        onChange={e => setAttendShiftId(e.target.value)}
                        style={{ width: '100%', padding: '9px', borderRadius: '6px', border: '1.5px solid var(--brand)', fontSize: '13px', fontWeight: 700 }}
                      >
                        {todayShifts.map((s: any) => (
                          <option key={s.assignment_id} value={s.assignment_id}>
                            {s.shift_code} • {s.date} ({s.start_at ? new Date(s.start_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : ''} - {s.end_at ? new Date(s.end_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : ''})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* KHÓA CA: quá 3h chưa check-in -> nghỉ không lương */}
                  {todayShift && shiftLocked && !tabAtt.checkedIn && (
                    <div style={{ backgroundColor: '#F1F5F9', border: '1.5px solid #64748B', borderRadius: 'var(--radius-sm)', padding: '10px 12px', marginBottom: '14px', fontSize: '12px', color: '#475569', fontWeight: 700 }}>
                      🔒 Ca này đã bị KHÓA (quá 3 tiếng chưa check-in) — tính nghỉ việc không lương, không thể điểm danh bù.
                    </div>
                  )}

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
                      backgroundColor: tabAtt.checkedIn ? '#ECFDF5' : '#FFFBEB',
                      border: tabAtt.checkedIn ? '1.5px solid #10B981' : '1px solid #FCD34D',
                      textAlign: 'center',
                    }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: tabAtt.checkedIn ? '#065F46' : '#92400E' }}>
                        BƯỚC 1: CHECK-IN
                      </div>
                      <div style={{ fontSize: '12px', fontWeight: 800, marginTop: '4px', color: tabAtt.checkedIn ? '#10B981' : '#D97706' }}>
                        {tabAtt.checkedIn ? `✓ ${tabAtt.checkInTime || 'Đã Check-in'}` : 'Chưa Check-in'}
                      </div>
                    </div>

                    <div style={{
                      padding: '10px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: tabAtt.checkedOut ? '#ECFDF5' : tabAtt.checkedIn ? '#EFF6FF' : '#F1F5F9',
                      border: tabAtt.checkedOut ? '1.5px solid #10B981' : tabAtt.checkedIn ? '1px solid #60A5FA' : '1px solid #CBD5E1',
                      textAlign: 'center',
                    }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: tabAtt.checkedOut ? '#065F46' : tabAtt.checkedIn ? '#1E40AF' : '#64748B' }}>
                        BƯỚC 2: CHECK-OUT
                      </div>
                      <div style={{ fontSize: '12px', fontWeight: 800, marginTop: '4px', color: tabAtt.checkedOut ? '#10B981' : tabAtt.checkedIn ? '#2563EB' : '#94A3B8' }}>
                        {tabAtt.checkedOut ? `✓ ${tabAtt.checkOutTime || 'Đã Check-out'}` : tabAtt.checkedIn ? 'Sẵn sàng Check-out' : '🔒 Khóa (Cần Check-in)'}
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
                      {!tabAtt.checkedIn ? (
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
                          ✓ ĐÃ HOÀN TẤT CHECK-IN VÀO CA LÚC {tabAtt.checkInTime || '07:00'} (ÁO HỒNG + BẢNG TÊN ĐÃ XÁC THỰC)
                        </div>
                      )}

                      {/* NÚT CHECK-OUT TAN CA (RÀNG BUỘC: CHECK-IN XONG MỚI ĐƯỢC CHECK-OUT) */}
                      {!tabAtt.checkedOut ? (
                        <button
                          className="btn-secondary"
                          disabled={!tabAtt.checkedIn}
                          onClick={() => handleStartAttendance('CHECK_OUT')}
                          style={{
                            width: '100%',
                            fontSize: '14px',
                            fontWeight: 800,
                            color: tabAtt.checkedIn ? '#2563EB' : '#94A3B8',
                            borderColor: tabAtt.checkedIn ? '#2563EB' : '#CBD5E1',
                            backgroundColor: tabAtt.checkedIn ? '#EFF6FF' : '#F8FAFC',
                            cursor: tabAtt.checkedIn ? 'pointer' : 'not-allowed',
                            opacity: tabAtt.checkedIn ? 1 : 0.6,
                          }}
                        >
                          {tabAtt.checkedIn ? (
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
                          🎉 BẠN ĐÃ HOÀN TẤT CA LÀM VIỆC HÔM NAY! (CHECK-IN: {tabAtt.checkInTime} • CHECK-OUT: {tabAtt.checkOutTime})
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

              {/* Mật độ ca hiện tại của bạn (để biết mình có đang 2 ca/ngày không) */}
              {(() => {
                const density = shiftDensityOf(myShifts);
                if (myShifts.length === 0) return null;
                return (
                  <div style={{
                    backgroundColor: density.multiDays.length > 0 ? '#FFFBEB' : '#F9FAFB',
                    border: density.multiDays.length > 0 ? '1.5px solid #F59E0B' : '1px solid var(--border)',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12px',
                    color: density.multiDays.length > 0 ? '#92400E' : 'var(--text-muted)',
                    marginBottom: '14px',
                    lineHeight: 1.6,
                  }}>
                    {density.multiDays.length > 0 ? (
                      <>⚡ <strong>Bạn đang đẩy nhanh:</strong> {density.multiDays.map(m => `${m.date.slice(8, 10)}/${m.date.slice(5, 7)} (${m.codes})`).join(' • ')} — tổng {density.total} ca đã xếp.</>
                    ) : (
                      <>📅 Hiện tại bạn làm <strong>1 ca/ngày</strong> — tổng <strong>{density.total} ca</strong> đã xếp. Muốn đẩy nhanh 2 ca/ngày thì báo Store xếp thêm ca.</>
                    )}
                  </div>
                );
              })()}

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

            {/* TỰ THÊM CA ĐẨY NHANH: NV thử việc tự xếp thêm ca vào ngày muốn tăng
                tiến độ — không cần HR duyệt, tối đa 2 ca/ngày. Quá 2 ca là hệ
                thống chặn + báo HR ngay. */}
            <div className="card" style={{ border: '1.5px solid #F59E0B' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 800, color: '#92400E', marginBottom: '8px' }}>
                ⚡ Tự Thêm Ca Đẩy Nhanh Tiến Độ
              </h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px', lineHeight: 1.5 }}>
                Muốn đẩy nhanh thì tự chọn <strong>ngày + ca</strong> để thêm vào lịch của chính bạn — có hiệu lực ngay, <strong>không cần HR duyệt</strong>. Ràng buộc cứng: <strong>tối đa 2 ca/ngày</strong>, quá là hệ thống chặn và báo Nhân sự!
              </p>
              {(() => {
                const win = probationWindowDays();
                const today = probVnToday();
                const dayShifts = extraShift.date
                  ? myShifts.filter((s: any) => s?.status !== 'CANCELLED' && String(s?.date || '').slice(0, 10) === extraShift.date)
                  : [];
                const full = dayShifts.length >= 2;
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Ngày thêm ca:</label>
                        <input
                          type="date"
                          value={extraShift.date}
                          min={today}
                          max={win.length > 0 ? win[win.length - 1] : undefined}
                          onChange={(e) => setExtraShift({ ...extraShift, date: e.target.value })}
                          style={{ width: '100%' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Ca muốn thêm:</label>
                        <select
                          value={extraShift.shiftCode}
                          onChange={(e) => setExtraShift({ ...extraShift, shiftCode: e.target.value })}
                          style={{ width: '100%' }}
                        >
                          <option value="CA_1">Ca 1 (07:00 - 12:00)</option>
                          <option value="CA_2">Ca 2 (12:00 - 18:00)</option>
                          <option value="CA_3">Ca 3 (18:00 - 23:00)</option>
                        </select>
                      </div>
                    </div>
                    {extraShift.date && (
                      <div style={{
                        fontSize: '12px', fontWeight: 700, padding: '8px 12px', borderRadius: '8px',
                        backgroundColor: full ? '#FEF2F2' : '#F0FDF4',
                        border: full ? '1.5px solid #EF4444' : '1px solid #86EFAC',
                        color: full ? '#991B1B' : '#166534',
                      }}>
                        {full
                          ? `🚨 Ngày ${extraShift.date} đã đủ 2 ca (${dayShifts.map((s: any) => s.shift_code).join(' + ')}) — hệ thống KHÔNG cho xếp thêm!`
                          : dayShifts.length === 0
                            ? `📅 Ngày ${extraShift.date} chưa có ca nào — thêm ca là bạn có 1 ca.`
                            : `📅 Ngày ${extraShift.date} đang có 1 ca (${dayShifts[0].shift_code}) — thêm nữa là đủ 2 ca.`}
                      </div>
                    )}
                    <button
                      className="btn-primary"
                      disabled={extraShiftBusy || !extraShift.date || full}
                      onClick={handleAddExtraShift}
                      title={full ? 'Ngày này đã đủ 2 ca — hệ thống chặn xếp thêm!' : 'Tự thêm ca vào lịch của bạn (có hiệu lực ngay)'}
                      style={{ opacity: extraShiftBusy || !extraShift.date || full ? 0.6 : 1 }}
                    >
                      {extraShiftBusy ? '⏳ ĐANG THÊM CA...' : '⚡ THÊM CA NÀY VÀO LỊCH CỦA TÔI'}
                    </button>
                  </div>
                );
              })()}
            </div>

            {/* Báo Nghỉ Khẩn: mặc định ẨN với NV thử việc — chỉ hiện khi Admin/HR
                kích hoạt 1 lượt duy nhất. Gửi xong phiếu là tự ẩn lại ngay. */}
            {emergencyEnabled && (
            <div className="card" style={{ border: '1.5px solid #F59E0B' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 800, color: '#C2410C', marginBottom: '8px' }}>
                🚨 Báo Nghỉ Đột Xuất (Khẩn Cấp)
              </h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>
                Dành cho các trường hợp ốm đau, tai nạn hoặc sự cố khẩn cấp. Dữ liệu sẽ chuyển thẳng đến HR Tab 10 và Google Sheets để phát lệnh bù ca.
              </p>
              <div style={{ fontSize: '12px', color: '#92400E', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', padding: '8px 12px', marginBottom: '10px', fontWeight: 700 }}>
                ✅ Admin đã kích hoạt cho bạn <strong>1 lần duy nhất</strong> — gửi xong phiếu này chức năng sẽ tự ẩn!
              </div>
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
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 6 FOR OFFICIAL: ĐỔI CA LÀM (2 HÌNH THỨC TRONG 1 TAB) */}
        {/* ========================================================= */}
        {activeTab === 'swap_shift' && !isProbation && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* PHIẾU CHỜ TÔI (NV B) XÁC NHẬN — đồng nghiệp A gửi sang */}
            {mySwaps.some((s: any) => s.target_employee_id === employee?.employee_id && s.status === 'PENDING_PARTNER') && (
              <div className="card" style={{ border: '2px solid #F59E0B', backgroundColor: '#FFFBEB' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 800, color: '#92400E' }}>🔔 Có {mySwaps.filter((s: any) => s.target_employee_id === employee?.employee_id && s.status === 'PENDING_PARTNER').length} phiếu chờ bạn xác nhận</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                  {mySwaps.filter((s: any) => s.target_employee_id === employee?.employee_id && s.status === 'PENDING_PARTNER').map((s: any) => {
                    const reqName = s.requester_name || (branchColleagues || []).find((c: any) => c.employee_id === s.requester_id)?.full_name || s.requester_id;
                    return (
                    <div key={s.swap_id} style={{ backgroundColor: '#FFF', borderRadius: '8px', padding: '10px', fontSize: '12px' }}>
                      <div><strong>{reqName}</strong> muốn tráo đổi ca với bạn</div>
                      <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>Lý do: {s.reason || '—'}</div>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                        <button className="btn-primary" style={{ flex: 1, padding: '9px' }} disabled={actionBusy === 'respond'} onClick={() => handleRespondSwap(s.swap_id, true)}>✓ Đồng ý</button>
                        <button className="btn-secondary" style={{ flex: 1, padding: '9px', color: '#DC2626' }} disabled={actionBusy === 'respond'} onClick={() => handleRespondSwap(s.swap_id, false)}>✕ Từ chối</button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* CA HR ĐIỀU PHỐI CẦN NGƯỜI LÀM THAY (+30k) — mở cho cả chi nhánh */}
            {mySwaps.some((s: any) => (s.swap_kind || 'EMPLOYEE_SWAP') === 'HR_DISPATCH' && s.status === 'PENDING_PARTNER' && !s.target_employee_id) && (
              <div className="card" style={{ border: '2px solid #2563EB', backgroundColor: '#EFF6FF' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 800, color: '#1E40AF' }}>🚀 Ca cần người làm thay (+30.000đ/ca)</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                  {mySwaps.filter((s: any) => (s.swap_kind || 'EMPLOYEE_SWAP') === 'HR_DISPATCH' && s.status === 'PENDING_PARTNER' && !s.target_employee_id).map((s: any) => (
                    <div key={s.swap_id} style={{ backgroundColor: '#FFF', borderRadius: '8px', padding: '10px', fontSize: '12px' }}>
                      <div><strong>{s.shift?.date || ''} • {s.shift?.shift_code || ''}</strong> — {s.reason || 'Cần người làm thay'}</div>
                      <div style={{ color: '#059669', fontWeight: 700, marginTop: '2px' }}>Nhận ca được +30.000đ phụ cấp (HR điều phối)</div>
                      <button className="btn-primary" style={{ width: '100%', marginTop: '8px', padding: '9px', backgroundColor: '#2563EB' }} disabled={actionBusy === 'respond'} onClick={() => handleRespondSwap(s.swap_id, true)}>Nhận ca này</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* PHIẾU TÔI ĐÃ GỬI — theo dõi trạng thái */}
            {mySwaps.some((s: any) => s.requester_id === employee?.employee_id) && (
              <div className="card">
                <h3 style={{ fontSize: '13px', fontWeight: 800 }}>Phiếu tôi đã gửi ({mySwaps.filter((s: any) => s.requester_id === employee?.employee_id).length})</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px', fontSize: '12px' }}>
                  {mySwaps.filter((s: any) => s.requester_id === employee?.employee_id).map((s: any) => {
                    const tgtName = s.target_name || (branchColleagues || []).find((c: any) => c.employee_id === s.target_employee_id)?.full_name || s.target_employee_id;
                    return (
                    <div key={s.swap_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                      <span>→ {tgtName}: {s.reason || ''}</span>
                      <strong style={{ color: s.status === 'APPROVED' ? '#059669' : s.status === 'REJECTED' ? '#DC2626' : '#B45309' }}>
                        {s.status === 'APPROVED' ? 'Đã duyệt' : s.status === 'REJECTED' ? 'Từ chối' : s.status === 'PARTNER_ACCEPTED' ? 'Chờ Store duyệt' : 'Chờ NV B'}
                      </strong>
                    </div>
                    );
                  })}
                </div>
              </div>
            )}
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
                    📌 <strong>Đặc điểm:</strong> Cùng chi nhánh ({employee?.default_branch_id || 'CN130'}). Chỉ tráo ca <strong>trong tuần hiện tại</strong> ({swapWeekRange().mon} → {swapWeekRange().sun}) đã sắp lịch — ngoài tuần hệ thống từ chối.
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Ca làm của bạn (Nhân viên A):</label>
                    <select
                      value={swapData.myShift}
                      onChange={(e) => setSwapData({ ...swapData, myShift: e.target.value })}
                      style={{ width: '100%' }}
                    >
                      <option value="">-- Chọn ca thật của bạn --</option>
                      {myShifts.filter((s: any) => inSwapWeek(s.date)).length === 0 ? (
                        <option value="">Chưa có ca nào trong tuần này</option>
                      ) : (
                        myShifts.filter((s: any) => inSwapWeek(s.date)).map((s: any, idx: number) => (
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
                      <option value="">-- Chọn ca thật của B (tuần hiện tại) --</option>
                      {targetShifts.filter((s: any) => inSwapWeek(s.date)).map((s: any, idx: number) => (
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
                    📌 <strong>Đặc điểm:</strong> Nhân viên B nhận làm thay ca cho A (B làm 2 ca/ngày). Chỉ nhờ ca <strong>trong tuần hiện tại</strong> ({swapWeekRange().mon} → {swapWeekRange().sun}) — ngoài tuần hệ thống từ chối.<br />
                    ⚠️ Tự thỏa thuận với nhau thì <strong>không</strong> có phụ cấp — chỉ ca do <strong>HR điều phối</strong> (mục trên) mới +30.000đ.
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Ca của bạn cần nhờ người làm thay:</label>
                    <select
                      value={swapData.myShift}
                      onChange={(e) => setSwapData({ ...swapData, myShift: e.target.value })}
                      style={{ width: '100%' }}
                    >
                      <option value="">-- Chọn ca của bạn (tuần hiện tại) --</option>
                      {myShifts.filter((s: any) => inSwapWeek(s.date)).map((s: any, idx: number) => (
                        <option key={s.assignment_id || idx} value={s.assignment_id}>
                          {s.date} ({s.shift_code})
                        </option>
                      ))}
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
                    disabled={actionBusy === 'swap'}
                    onClick={async () => {
                      if (!swapData.myShift) {
                        showToast('⚠️ Vui lòng chọn ca của bạn cần nhờ làm thay!');
                        return;
                      }
                      if (!swapData.targetEmployeeId) {
                        showToast('⚠️ Vui lòng chọn đồng nghiệp nhận làm thay!');
                        return;
                      }
                      if (!swapData.reason.trim()) {
                        showToast('⚠️ Vui lòng nhập lý do nhờ làm thay!');
                        return;
                      }
                      setActionBusy('swap');
                      try {
                        const res = await apiRequest('/swap-requests', {
                          method: 'POST',
                          body: JSON.stringify({
                            requesterAssignmentId: swapData.myShift,
                            targetEmployeeId: swapData.targetEmployeeId,
                            targetAssignmentId: '',
                            reason: swapData.reason,
                          }),
                        });
                        const sid = res?.result?.swap_id || res?.swap_id || '';
                        showToast(`✓ Đã gửi yêu cầu nhờ làm thay! Mã đơn: ${sid}. B đồng ý là ca chuyển ngay.`);
                        setSwapData({ myShift: '', targetEmployeeId: '', targetEmployeeName: '', targetShift: '', reason: '' });
                        setTargetShifts([]);
                        await fetchMySwaps();
                        await loadEmployeeData(employee?.employee_id);
                      } catch (err: any) {
                        showToast(err.message || 'Lỗi khi gửi yêu cầu!');
                      } finally {
                        setActionBusy(null);
                      }
                    }}
                  >
                    {actionBusy === 'swap' ? '⏳ ĐANG GỬI...' : 'Gửi Yêu Cầu Nhờ Làm Thay Ca'}
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
                Gửi giải trình khi quên check-in/out hoặc báo nghỉ đột xuất (đồng bộ trực tiếp sang HR Tab 10 và Google Sheets). Phiếu hiệu lực <strong>30 phút</strong> (tính từ lúc gửi) — quá hạn HR chưa duyệt thì hệ thống tự xóa phiếu.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Ngày sự cố:</label>
                  <input
                    type="date"
                    value={adjustmentData.date}
                    onChange={(e) => { setAdjustmentData({ ...adjustmentData, date: e.target.value }); setAdjustShiftId(''); }}
                    style={{ width: '100%' }}
                  />
                </div>

                {(() => {
                  const dayShifts = (myShifts || []).filter((s: any) => s.date === adjustmentData.date);
                  if (dayShifts.length <= 1) return null;
                  return (
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
                        Ca cần bổ sung (ngày này có {dayShifts.length} ca — chọn đúng ca thì duyệt mới cập nhật đúng):
                      </label>
                      <select
                        value={adjustShiftId || dayShifts[0]?.assignment_id || ''}
                        onChange={(e) => setAdjustShiftId(e.target.value)}
                        style={{ width: '100%', padding: '9px', borderRadius: '6px', border: '1.5px solid var(--brand)', fontSize: '13px', fontWeight: 700 }}
                      >
                        {dayShifts.map((s: any) => (
                          <option key={s.assignment_id} value={s.assignment_id}>
                            {s.shift_code} ({s.start_at ? new Date(s.start_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : ''} - {s.end_at ? new Date(s.end_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : ''})
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })()}

                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Loại yêu cầu:</label>
                  <select
                    value={adjustmentData.type}
                    onChange={(e) => setAdjustmentData({ ...adjustmentData, type: e.target.value })}
                    style={{ width: '100%' }}
                  >
                    <option value="QUEN_CHECKIN">Quên Check-in khi vào ca → duyệt là ghi check-in ca đó</option>
                    <option value="QUEN_CHECKOUT">Quên Check-out khi hết ca → duyệt là ghi check-out ca đó</option>
                    <option value="LOI_GPS_CAMERA">Điện thoại bị lỗi GPS / Camera → duyệt là ghi cả in + out</option>
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
                {/* PHIẾU CỦA TÔI — trạng thái realtime + đếm ngược 30 phút */}
            {myAdjustments.length > 0 && (
              <div className="card">
                <h3 style={{ fontSize: '14px', fontWeight: 800, marginBottom: '8px' }}>
                  Phiếu của tôi ({myAdjustments.length})
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {myAdjustments.map((a: any) => {
                    const created = new Date(a.created_at).getTime();
                    const leftMs = Number.isFinite(created) ? Math.max(0, 30 * 60000 - (adjNow - created)) : 0;
                    const leftMin = Math.floor(leftMs / 60000);
                    const leftSec = Math.floor((leftMs % 60000) / 1000);
                    const auto = a.status === 'REJECTED' && String(a.review_note || '').startsWith('Tự động từ chối');
                    return (
                      <div key={a.adjustment_id} style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '10px', fontSize: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                          <strong style={{ flex: 1 }}>{a.reason || 'Bổ sung công'}</strong>
                          <span className="badge" style={{
                            backgroundColor: a.status === 'APPROVED' ? '#DCFCE7' : (auto ? '#F3F4F6' : '#FEE2E2'),
                            color: a.status === 'APPROVED' ? '#166534' : (auto ? '#6B7280' : '#991B1B'),
                            fontWeight: 800,
                          }}>
                            {a.status === 'APPROVED' ? 'Đã duyệt' : auto ? 'Tự hủy (hết 30p)' : a.status === 'REJECTED' ? 'Bị từ chối' : 'Chờ duyệt'}
                          </span>
                        </div>
                        {a.status === 'PENDING' && (
                          <div style={{ marginTop: '4px', color: '#B45309', fontWeight: 700 }}>
                            ⏳ Còn {leftMin}p {String(leftSec).padStart(2, '0')}s hiệu lực (tính từ lúc gửi) — quá hạn hệ thống tự xóa phiếu
                          </div>
                        )}
                        {a.status === 'PENDING' && (
                          <button
                            className="btn-secondary"
                            style={{ marginTop: '6px', fontSize: '11px', padding: '5px 10px', color: '#DC2626' }}
                            onClick={async () => {
                              if (!window.confirm('Hủy phiếu này? Phiếu sẽ bị XÓA KHỎI hệ thống (không khôi phục).')) return;
                              try {
                                await apiRequest(`/attendance/adjustments/${a.adjustment_id}`, { method: 'DELETE' });
                                showToast('Đã hủy và xóa phiếu khỏi hệ thống!');
                                await fetchMyAdjustments();
                              } catch (e: any) {
                                showToast(e?.message || 'Lỗi khi hủy phiếu!');
                              }
                            }}
                          >
                            🗑 Hủy phiếu (xóa khỏi hệ thống)
                          </button>
                        )}
                        {a.status === 'APPROVED' && (
                          <div style={{ marginTop: '4px', color: '#047857' }}>✓ Lịch, chấm công và lương đã cập nhật theo phiếu.</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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
                <button className="btn-secondary" style={{ fontSize: '11px', padding: '4px 10px' }} onClick={fetchMyTests}>Tải lại</button>
              </div>
              {myTests.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--text-muted)' }}>
                  <Award size={32} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>Chưa có bài TEST nào được giao</div>
                  <div style={{ fontSize: '12px', marginTop: '4px' }}>Khi HR tạo bài và chọn đúng tên bạn, bài làm sẽ hiện ở đây.</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {myTests.map((t: any) => {
                    const sub = t.submission;
                    const paper = t.paper;
                    const isActive = activeTestId === sub.submission_id;
                    const done = sub.status === 'SUBMITTED';
                    return (
                      <div key={sub.submission_id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                          <strong style={{ fontSize: '14px' }}>{paper.title}</strong>
                          {done ? (
                            <span className="badge" style={{ backgroundColor: sub.passed ? '#DCFCE7' : '#FEE2E2', color: sub.passed ? '#166534' : '#991B1B', fontWeight: 800 }}>
                              {sub.score}/10 • {sub.passed ? 'Đạt' : 'Chưa đạt'}
                            </span>
                          ) : (
                            <span className="badge badge-brand">Chờ làm • {paper.questions?.length || 0} câu</span>
                          )}
                        </div>
                        {!!paper.description && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{paper.description}</div>}
                        {done ? (
                          <div style={{ fontSize: '12px', color: '#047857', marginTop: '6px' }}>
                            Đã nộp{sub.submitted_at ? ` lúc ${new Date(sub.submitted_at).toLocaleString('vi-VN')}` : ''}. HR đã nhận kết quả.
                          </div>
                        ) : !isActive ? (
                          <button
                            className="btn-primary"
                            style={{ width: '100%', marginTop: '10px' }}
                            onClick={() => {
                              setActiveTestId(sub.submission_id);
                              setTestAnswers(new Array(paper.questions?.length || 0).fill(-1));
                              setTestLeft(paper.time_limit_seconds || 480);
                            }}
                          >
                            Bắt đầu làm bài ({paper.time_limit_seconds || 480}s)
                          </button>
                        ) : (
                          <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 800, color: testLeft < 60 ? '#DC2626' : 'var(--text)' }}>
                              ⏱ Còn lại: {Math.floor(testLeft / 60)}:{String(testLeft % 60).padStart(2, '0')} (tự nộp khi hết giờ)
                            </div>
                            {(paper.questions || []).map((q: any, qi: number) => (
                              <div key={qi} style={{ backgroundColor: '#FAFAFA', padding: '10px', borderRadius: 'var(--radius-sm)', fontSize: '13px' }}>
                                <strong>Câu {qi + 1}:</strong> {q.content}
                                <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  {(q.options || []).map((op: string, oi: number) => (
                                    <label key={oi}>
                                      <input
                                        type="radio"
                                        name={`t-${sub.submission_id}-${qi}`}
                                        checked={testAnswers[qi] === oi}
                                        onChange={() => { const a = [...testAnswers]; a[qi] = oi; setTestAnswers(a); }}
                                      /> {String.fromCharCode(65 + oi)}. {op}
                                    </label>
                                  ))}
                                </div>
                              </div>
                            ))}
                            <button
                              className="btn-primary"
                              onClick={async () => {
                                if (testAnswers.some(a => a < 0)) {
                                  if (!window.confirm('Còn câu chưa chọn đáp án. Vẫn nộp bài?')) return;
                                }
                                await submitActiveTest(false);
                              }}
                            >
                              Nộp bài
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
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
                  (notifications as any[]).slice(0, 20).map((n: any, idx: number) => {
                    const goTab = String(n.target_path || '');
                    const canGo = ['/schedule', '/home', '/attendance', '/leave', '/test_exam', '/test_training'].includes(goTab);
                    return (
                    <div
                      key={n.inbox_id || idx}
                      onClick={async () => {
                        if (n.inbox_id && !n.read_at) {
                          try {
                            await apiRequest(`/me/notifications/${n.inbox_id}/read`, { method: 'POST' });
                            setNotifications((prev: any[]) => (Array.isArray(prev) ? prev.map(x => x.inbox_id === n.inbox_id ? { ...x, read_at: new Date().toISOString() } : x) : prev));
                          } catch { /* offline: vẫn cho điều hướng */ }
                        }
                        if (goTab === '/test_exam' || goTab === '/test_training') setActiveTab(isProbation ? 'test_exam' : 'test_training');
                        else if (canGo) setActiveTab(goTab.slice(1));
                      }}
                      title={canGo ? 'Bấm để mở đúng mục liên quan' : undefined}
                      style={{ padding: '10px 12px', backgroundColor: n.read_at ? '#FAFAFA' : '#FFFBF9', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', cursor: canGo ? 'pointer' : 'default' }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '13px' }}>{n.title} {canGo && '→'}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text)', marginTop: '2px' }}>{n.summary}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {n.created_at ? new Date(n.created_at).toLocaleString('vi-VN') : ''}
                      </div>
                    </div>
                    );
                  })
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
