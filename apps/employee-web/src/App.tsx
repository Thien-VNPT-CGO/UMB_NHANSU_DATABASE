import React, { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { apiRequest, setAuthToken, getAuthToken, getApiBase, setCustomApiUrl, onPinLockRequired } from './services/api';
import { connectRealtime, stopRealtimeRevive } from './services/realtime';
import { APP_COMMIT } from './app-version';
import { PremiumLogin } from './components/PremiumLogin';
import { SignaturePad } from './components/SignaturePad';
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
  Wrench,
  Sun,
  Moon,
  Coffee,
  ChevronRight,
  CalendarDays,
  Check,
  Briefcase,
  Palmtree,
  Filter,
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

/** Ảnh bằng chứng phiếu bổ sung công của tôi: tải blob kèm token rồi hiện (thẻ <img> không gửi được Authorization). */
function MyAdjPhoto({ adjustmentId, style }: { adjustmentId: string; style?: React.CSSProperties }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let objUrl: string | null = null;
    (async () => {
      try {
        const res = await fetch(`${getApiBase()}/me/attendance/adjustments/${adjustmentId}/photo`, {
          headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        if (!res.ok) throw new Error('no photo');
        const blob = await res.blob();
        objUrl = URL.createObjectURL(blob);
        if (alive) setUrl(objUrl);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [adjustmentId]);
  if (failed) return null;
  if (!url) return <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Đang tải ảnh...</span>;
  return <img src={url} alt="Ảnh bằng chứng" style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--border)', ...(style || {}) }} />;
}

/** Banner bản cập nhật mới từ IT: hiện khi index.html trên server đã đổi
 *  (frontend có bản mới thật). Bấm là tải lại trang lấy bản mới. */
function UpdateBanner({ onLater }: { onLater: () => void }) {
  return (
    <div style={{
      position: 'fixed',
      left: '12px',
      right: '12px',
      bottom: '12px',
      zIndex: 9998,
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '12px 14px',
      borderRadius: '14px',
      background: 'linear-gradient(135deg, #0F172A 0%, #1E1B4B 60%, #831843 100%)',
      color: '#FFF',
      boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
      border: '1px solid rgba(232, 93, 146, 0.5)',
    }}>
      <span style={{ fontSize: '22px' }}>🚀</span>
      <div style={{ flex: 1, fontSize: '12px', lineHeight: 1.5 }}>
        <div style={{ fontWeight: 800, fontSize: '13px' }}>Có bản cập nhật mới từ IT!</div>
        <div style={{ color: 'rgba(255,255,255,0.75)' }}>Bấm "Cập nhật ngay" để tải bản mới nhất (sửa lỗi + tính năng mới).</div>
      </div>
      <button
        onClick={() => window.location.reload()}
        style={{ padding: '9px 16px', borderRadius: '999px', border: 'none', background: 'linear-gradient(135deg, #E85D92, #F59E0B)', color: '#FFF', fontSize: '12px', fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        Cập nhật ngay
      </button>
      <button
        onClick={onLater}
        style={{ padding: '9px 10px', borderRadius: '999px', border: '1px solid rgba(255,255,255,0.35)', background: 'transparent', color: 'rgba(255,255,255,0.8)', fontSize: '12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        Để sau
      </button>
    </div>
  );
}

/** Màn hình bảo trì cổng nhân viên: hiện đại, tự hồi khi Admin tắt bảo trì. */
function MaintenanceScreen({ message, checking, onRetry }: { message: string; checking: boolean; onRetry: () => void }) {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px 20px',
      background: 'linear-gradient(160deg, #0F172A 0%, #1E1B4B 45%, #831843 100%)',
      color: '#FFF',
      textAlign: 'center',
    }}>
      <style>{`
        @keyframes ubm-maint-spin { to { transform: rotate(360deg); } }
        @keyframes ubm-maint-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        @keyframes ubm-maint-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
      `}</style>
      <div style={{ animation: 'ubm-maint-float 3s ease-in-out infinite', marginBottom: '20px', position: 'relative' }}>
        <div style={{
          width: '112px',
          height: '112px',
          borderRadius: '32px',
          background: 'linear-gradient(135deg, #E85D92 0%, #F59E0B 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 20px 60px rgba(232, 93, 146, 0.45)',
        }}>
          <Wrench size={52} color="#FFF" />
        </div>
        <div style={{
          position: 'absolute',
          inset: '-10px',
          borderRadius: '40px',
          border: '2px dashed rgba(255,255,255,0.35)',
          animation: 'ubm-maint-spin 14s linear infinite',
        }} />
      </div>
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '11px',
        fontWeight: 800,
        letterSpacing: '2px',
        color: '#FDE68A',
        backgroundColor: 'rgba(245, 158, 11, 0.15)',
        border: '1px solid rgba(245, 158, 11, 0.4)',
        borderRadius: '999px',
        padding: '6px 14px',
        marginBottom: '14px',
      }}>
        <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#F59E0B', animation: 'ubm-maint-pulse 1.5s ease-in-out infinite' }} />
        BẢO TRÌ KỸ THUẬT
      </div>
      <h1 style={{ fontSize: '24px', fontWeight: 800, margin: '0 0 8px' }}>Cổng nhân viên tạm khóa</h1>
      <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.85)', maxWidth: '420px', lineHeight: 1.6, margin: '0 0 6px' }}>
        {message || 'Hệ thống đang bảo trì kỹ thuật định kỳ. Quý khách vui lòng thử lại sau ít phút.'}
      </p>
      <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', maxWidth: '420px', lineHeight: 1.6, margin: '0 0 22px' }}>
        Nhân sự đang kiểm kê hoặc cập nhật ca làm — mọi dữ liệu chấm công của bạn được giữ nguyên.
      </p>
      <button
        onClick={onRetry}
        disabled={checking}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 28px',
          borderRadius: '999px',
          border: 'none',
          background: 'linear-gradient(135deg, #E85D92, #F59E0B)',
          color: '#FFF',
          fontSize: '14px',
          fontWeight: 800,
          cursor: checking ? 'wait' : 'pointer',
          opacity: checking ? 0.7 : 1,
          boxShadow: '0 8px 24px rgba(232, 93, 146, 0.4)',
        }}
      >
        <RefreshCw size={16} style={checking ? { animation: 'ubm-maint-spin 1s linear infinite' } : undefined} />
        {checking ? 'Đang kiểm tra...' : 'Kiểm tra lại ngay'}
      </button>
      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginTop: '14px' }}>
        Hệ thống tự động kiểm tra lại mỗi 30 giây
      </div>
      <div style={{ fontSize: '12px', fontWeight: 800, color: 'rgba(255,255,255,0.7)', marginTop: '26px', letterSpacing: '1px' }}>
        ỤM BÒ MILK • CỔNG NHÂN VIÊN
      </div>
    </div>
  );
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
  // Bản API đang chạy (chỉ hiển thị để đối chiếu, KHÔNG dùng để quyết định banner).
  const [apiCommit, setApiCommit] = useState<string | null>(null);
  // Banner "Có bản cập nhật": so HASH index.html của chính frontend đang chạy
  // với bản mới nhất trên server (fetch no-store). Reload là hết banner — không
  // bao giờ kẹt như kiểu so commit frontend với commit backend (2 deploy khác nhịp).
  const [updateReady, setUpdateReady] = useState(false);
  const indexHashRef = useRef<string | null>(null);
  const latestHashRef = useRef<string | null>(null);
  const updateSnoozedRef = useRef<string | null>(null);
  const hashStr = (s: string): string => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return String(h);
  };
  const checkAppVersion = async (): Promise<'new' | 'same' | 'fail'> => {
    // Giữ hiển thị bản API (thông tin).
    try {
      const v: any = await apiRequest('/version');
      if (v?.commit) setApiCommit(String(v.commit).slice(0, 7));
    } catch { /* offline: giữ cũ */ }
    // Tín hiệu chính: nội dung index.html đã đổi -> frontend có bản mới thật.
    try {
      const res = await fetch('index.html', { cache: 'no-store' });
      if (!res.ok) return 'fail';
      const text = await res.text();
      const h = hashStr(text);
      latestHashRef.current = h;
      if (!indexHashRef.current) {
        indexHashRef.current = h;
        return 'same';
      }
      if (h !== indexHashRef.current && updateSnoozedRef.current !== h) {
        setUpdateReady(true);
        return 'new';
      }
      if (h === indexHashRef.current || updateSnoozedRef.current === h) setUpdateReady(false);
      return 'same';
    } catch { /* offline: giữ trạng thái cũ */ return 'fail'; }
  };
  const checkAppVersionRef = useRef(checkAppVersion);
  checkAppVersionRef.current = checkAppVersion;
  useEffect(() => {
    checkAppVersionRef.current().catch(() => null);
    // Poll mỗi 5 phút + mỗi lần mở lại tab (về từ nền là kiểm tra ngay).
    const t = setInterval(() => { checkAppVersionRef.current().catch(() => null); }, 5 * 60 * 1000);
    const onVis = () => {
      if (document.visibilityState === 'visible') checkAppVersionRef.current().catch(() => null);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  const snoozeAppUpdate = () => {
    // Ghi nhớ hash đang lệch để không hiện lại cho tới khi có bản mới hơn nữa.
    updateSnoozedRef.current = latestHashRef.current;
    setUpdateReady(false);
  };
  const handleChangeApiBase = async () => {
    const input = window.prompt('Địa chỉ máy chủ Backend (để trống = tự động):', localStorage.getItem('ubm_custom_api_url') || '');
    if (input === null) return;
    setCustomApiUrl(input.trim());
    const base = getApiBase();
    setApiBaseShown(base);
    // Kiểm chứng thật bằng /health trước khi báo — tránh đổi sang địa chỉ chết
    // rồi mọi thao tác sau mới lòi lỗi.
    showToast('⏳ Đang kiểm tra kết nối máy chủ...');
    try {
      const res = await fetch(`${base}/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast(input.trim() ? `Đã đổi máy chủ sang ${base} — kết nối OK!` : `Đã về chế độ tự động (${base}) — kết nối OK!`);
    } catch {
      showToast(`⚠️ Địa chỉ ${base} không phản hồi! Kiểm tra lại địa chỉ hoặc mạng — mọi chức năng sẽ lỗi cho tới khi đúng.`);
    }
  };

  // Attendance flow state
  const [attendanceStep, setAttendanceStep] = useState<'IDLE' | 'CHECKING_GPS' | 'READY_CAMERA' | 'SUBMITTING' | 'CONFIRMED'>('IDLE');
  const [lastReceipt, setLastReceipt] = useState<any>(null);
  const [uniformChecked, setUniformChecked] = useState(true);
  const [badgeChecked, setBadgeChecked] = useState(true);

  // Payslip privacy lock
  const [payslipUnlocked, setPayslipUnlocked] = useState(false);
  const [payslips, setPayslips] = useState<any[]>([]);
  const payslipUnlockedRef = useRef(payslipUnlocked);
  payslipUnlockedRef.current = payslipUnlocked;
  const payslipsRef = useRef<any[]>([]);
  payslipsRef.current = payslips;

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

  // Trạng thái cổng đăng ký OFF/tuần từ server (khung giờ T6 09h -> T7 09h)
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
  // Ca đầu tuần->hôm qua cho tab Dữ Liệu Công tuần (myShifts chỉ từ hôm nay trở
  // đi). Ca quá khứ là lịch sử bất biến nên chỉ tải khi mở tab công — sự kiện
  // điểm danh vẫn realtime qua loadEmployeeData.
  const [weekPastShifts, setWeekPastShifts] = useState<any[]>([]);
  useEffect(() => {
    if (activeTab !== 'timesheet') return;
    (async () => {
      try {
        const nowVn = new Date(Date.now() + 7 * 3_600_000);
        const off = (nowVn.getUTCDay() + 6) % 7;
        const mon = new Date(nowVn);
        mon.setUTCDate(mon.getUTCDate() - off);
        const fromD = mon.toISOString().slice(0, 10);
        const toD = new Date(Date.now() + 7 * 3_600_000).toISOString().split('T')[0];
        const list = await apiRequest(`/me/schedule?fromDate=${fromD}&toDate=${toD}`);
        setWeekPastShifts(Array.isArray(list) ? list : []);
      } catch { /* offline: giữ danh sách cũ */ }
    })();
  }, [activeTab]);

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
  const [targetShiftsLoading, setTargetShiftsLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  // Guard đồng bộ chống bấm đúp gửi 2 phiếu đổi ca (setState async không kịp
  // disable nút khi 2 click cùng tick / double-tap mobile -> 2 POST trùng nội dung).
  const swapBusyRef = useRef(false);
  // Phiếu đổi ca liên quan đến tôi (gửi đi + chờ tôi xác nhận)
  const [mySwaps, setMySwaps] = useState<any[]>([]);
  // Phiếu dispatch mở đã ẩn trong phiên (không muốn nhận thì ẩn, không kẹt banner).
  const [hiddenDispatchIds, setHiddenDispatchIds] = useState<string[]>([]);
  const fetchMySwaps = async () => {
    try {
      const list = await apiRequest('/swap-requests');
      setMySwaps(Array.isArray(list) ? list : []);
    } catch { /* offline: giữ danh sách cũ */ }
  };
  // NV B xác nhận / từ chối phiếu tráo ca (B đồng ý là 2 ca hoán đổi ngay, không cần HR duyệt)
  // + xác nhận / từ chối phiếu HR hỗ trợ chi nhánh (đồng ý là ca hỗ trợ vào lịch ngay)
  const handleRespondSwap = async (swapId: string, accept: boolean) => {
    const swKind = (mySwaps || []).find((s: any) => s.swap_id === swapId)?.swap_kind;
    const isSupportKind = swKind === 'HR_SUPPORT';
    if (!window.confirm(accept
      ? (isSupportKind ? 'Đồng ý làm thay ca này? Ca sẽ chuyển sang bạn ngay!' : 'Đồng ý tráo đổi ca này? Hai ca sẽ hoán đổi người trực ngay!')
      : 'Từ chối phiếu này?')) return;
    // Chỉ chặn bấm đúp (guard đồng bộ) — trạng thái thật do SERVER quyết định
    // (state local có thể cũ: banner hiện PENDING nhưng phiếu đã chốt / có bản
    // ma trùng id; chặn ở local sẽ kẹt vĩnh viễn "đã xử lý" mà phiếu không mất).
    if (swapBusyRef.current || actionBusy) return;
    swapBusyRef.current = true;
    setActionBusy('respond');
    try {
      const res = await apiRequest(`/swap-requests/${swapId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ accept }),
      });
      const warns: string[] = (res as any)?.result?._warnings || (res as any)?._warnings || [];
      showToast(accept ? `✓ Đã đồng ý! Hai ca hoán đổi ngay.${warns.length ? ` Lưu ý: ${warns.join(' ')}` : ''}` : 'Đã từ chối phiếu đổi ca.');
      // Tải lịch trước rồi mới tải phiếu (nối tiếp): loadEmployeeData cũng fetch
      // phiếu ngầm — fetch song song response cũ về sau sẽ ghi đè, reload hiện sai.
      await loadEmployeeData(employee?.employee_id);
      await fetchMySwaps();
    } catch (e: any) {
      showToast(e?.message || 'Lỗi khi phản hồi!');
      await fetchMySwaps().catch(() => null);
    } finally {
      swapBusyRef.current = false;
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

  // Trạng thái bảo trì cổng NV do Admin bật (null = chưa tải xong -> fail-open, không khóa nhầm).
  const [portalMaint, setPortalMaint] = useState<{ active: boolean; message: string } | null>(null);
  const [maintChecking, setMaintChecking] = useState(false);
  const fetchPortalMaintenance = async (): Promise<boolean | null> => {
    try {
      const m: any = await apiRequest('/public/portal-maintenance');
      const active = !!(m?.system_maintenance || m?.employee_web_maintenance);
      setPortalMaint({ active, message: String(m?.maintenance_message || '') });
      return active;
    } catch { /* offline/server cũ: coi như không bảo trì */ return null; }
  };
  const fetchPortalMaintenanceRef = useRef(fetchPortalMaintenance);
  fetchPortalMaintenanceRef.current = fetchPortalMaintenance;
  const handleRetryMaintenance = async () => {
    setMaintChecking(true);
    try { await fetchPortalMaintenance(); } finally { setMaintChecking(false); }
  };

  // Trạng thái bảo trì: tải ngay khi mở cổng (kể cả chưa đăng nhập) để khóa kịp thời.
  useEffect(() => {
    fetchPortalMaintenanceRef.current().catch(() => null);
  }, []);
  // Đang bảo trì -> tự kiểm tra lại mỗi 30s để mở cổng ngay khi Admin tắt (khỏi cần F5).
  useEffect(() => {
    if (!portalMaint?.active) return;
    const t = setInterval(() => { fetchPortalMaintenanceRef.current().catch(() => null); }, 30000);
    return () => clearInterval(t);
  }, [portalMaint?.active]);

  // Adjustment Request Form
  const [adjustmentData, setAdjustmentData] = useState({
    date: new Date().toISOString().split('T')[0],
    shift: 'Ca Sáng (07:00 - 12:00)',
    type: 'QUEN_CHECKIN',
    reason: 'Quên bấm điểm danh khi vào ca do tiếp nhận hàng hóa gấp',
  });
  // Ca cần bổ sung (ngày 2 ca: phải chọn đúng ca thì HR duyệt mới cập nhật đúng)
  const [adjustShiftId, setAdjustShiftId] = useState('');
  // Ca ĐÚNG NGÀY sự cố (tải riêng theo ngày đã chọn — myShifts chỉ từ hôm nay trở
  // đi nên ngày cũ không có ca; dùng sai ca là duyệt nhầm sang ngày khác).
  const [adjDayShifts, setAdjDayShifts] = useState<any[]>([]);
  const [adjDayLoading, setAdjDayLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    const d = adjustmentData.date;
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) { setAdjDayShifts([]); return; }
    setAdjDayLoading(true);
    apiRequest(`/me/schedule?fromDate=${d}&toDate=${d}`)
      .then((list: any) => {
        if (!alive) return;
        const arr = Array.isArray(list) ? list.filter((s: any) => String(s.date || '').slice(0, 10) === d) : [];
        setAdjDayShifts(arr);
        if (adjustShiftId && !arr.some((s: any) => s.assignment_id === adjustShiftId)) setAdjustShiftId('');
      })
      .catch(() => { if (alive) setAdjDayShifts([]); })
      .finally(() => { if (alive) setAdjDayLoading(false); });
    return () => { alive = false; };
  }, [adjustmentData.date]);
  // Ảnh bằng chứng kèm phiếu bổ sung công (dataURL đã nén ≤800KB, null = chưa chọn)
  const [evidencePhoto, setEvidencePhoto] = useState<string | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const evidenceInputRef = useRef<HTMLInputElement | null>(null);
  // Phiếu bổ sung công của tôi (trạng thái realtime)
  const [myAdjustments, setMyAdjustments] = useState<any[]>([]);
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
  const [testSubmitBusy, setTestSubmitBusy] = useState(false);
  // Chặn nộp lặp: hết giờ effect bắn mỗi giây, fail mà không khóa sẽ spam POST vô hạn.
  const autoSubmitRef = useRef<string | null>(null);
  const fetchMyTests = async () => {
    try {
      const list = await apiRequest('/me/tests');
      setMyTests(Array.isArray(list) ? list : []);
    } catch { /* offline: giữ danh sách cũ */ }
  };
  const submitActiveTest = async (isAuto = false) => {
    if (!activeTestId) return;
    if (testSubmitBusy) return;
    setTestSubmitBusy(true);
    const filled = testAnswers.map(a => (a < 0 ? 0 : a));
    try {
      const res = await apiRequest(`/me/tests/${activeTestId}/submit`, {
        method: 'POST',
        body: JSON.stringify({ answers: filled }),
      });
      const r = (res as any)?.result || res;
      // Chỉ báo điểm khi server trả điểm số thật, không thì báo đã ghi nhận chung.
      if (r && Number.isFinite(Number(r.score))) {
        showToast(isAuto ? `Hết giờ — tự nộp bài! Điểm: ${r.score}/10.` : `Đã nộp bài! Điểm: ${r.score}/10 — ${r.passed ? 'Đạt' : 'Chưa đạt'}.`);
      } else {
        showToast(isAuto ? 'Hết giờ — đã tự nộp bài! Chờ HR chấm điểm.' : 'Đã nộp bài! Chờ HR chấm điểm.');
      }
      setActiveTestId(null);
      autoSubmitRef.current = null;
      await fetchMyTests();
    } catch (e: any) {
      showToast(e?.message || 'Lỗi khi nộp bài!');
    } finally {
      setTestSubmitBusy(false);
    }
  };

  // Synchronize active tab across reload (with forced registration guard for official staff)
  useEffect(() => {
    if (activeTab) {
      localStorage.setItem('ubm_emp_active_tab', activeTab);
    }
  }, [activeTab]);

  // Khóa cứng chu kỳ PIN: dính gate PIN_CHANGE_REQUIRED ở BẤT KỲ API nào (kể cả
  // giữa phiên, VD sang tháng mới) -> quăng toàn bộ cổng về màn đổi PIN, khóa
  // mọi chức năng cho tới khi NV đặt PIN mới xong. Backend đã chặn request.
  useEffect(() => {
    onPinLockRequired(() => {
      setMustChangePin(true);
      setIsLoggedIn(false);
      setNewPin('');
      setConfirmPin('');
      setOldPinInput('');
      setLoginError('🔒 Tài khoản của bạn chưa đổi mã PIN mới theo chu kỳ! Toàn bộ chức năng tạm thời bị KHÓA — vui lòng đặt mã PIN mới (đúng 6 số, khác PIN cũ) để mở khóa hệ thống.');
    });
    return () => onPinLockRequired(null);
  }, []);

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
    // Mở tab đổi ca: tải mới lịch để trạng thái publish của HR luôn tươi —
    // HR vừa publish tuần mới mà giữ lịch cũ (DRAFT) thì rào publish chặn oan.
    if ((activeTab === 'swap_shift' || activeTab === 'swap_emergency') && employee?.employee_id) {
      loadEmployeeData(employee.employee_id);
    }
    // Lịch kiểm tra đầu ra: tải lại khi mở trang chủ / lịch / thi (luôn tươi).
    if (activeTab === 'home' || activeTab === 'schedule' || activeTab === 'test_exam' || activeTab === 'test_training') {
      fetchProbationAssessment();
    }
    // Trạng thái kích hoạt báo nghỉ khẩn (NV thử việc): mở tab là kiểm tra lại.
    if (activeTab === 'swap_emergency') fetchEmergencyStatus();
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
    if (!activeTestId) {
      autoSubmitRef.current = null;
      return;
    }
    if (testLeft <= 0) {
      // Hết giờ chỉ tự nộp 1 lần/bài — fail thì chờ NV bấm nộp tay, không spam POST.
      if (autoSubmitRef.current !== activeTestId) {
        autoSubmitRef.current = activeTestId;
        submitActiveTest(true);
      }
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
      const cleanNotifs = (Array.isArray(notifs) ? notifs : []).filter((n: any) =>
        n.type !== 'CHECKIN_REMINDER' &&
        !/nhắc.*(?:check-?in|điểm danh)/i.test(`${n.title || ''} ${n.summary || ''}`)
      );
      setNotifications(cleanNotifs);
      const attEvents: any[] = Array.isArray(attRange) ? attRange : [];

      // Ngày VN (UTC+7) + so ngày VN của sự kiện (server lưu client_time UTC ISO):
      // dùng ngày UTC sẽ lệch 00:00–07:00 VN, reload báo chưa check-in dù vừa điểm danh.
      const vnDayOf = (iso?: string) => {
        const t = new Date(iso || '').getTime();
        if (!Number.isFinite(t)) return '';
        return new Date(t + 7 * 3_600_000).toISOString().split('T')[0];
      };
      const today = new Date(Date.now() + 7 * 3_600_000).toISOString().split('T')[0];
      const todayCheckIn = attEvents.find((e: any) => e.type === 'CHECK_IN' && vnDayOf(e.client_time) === today);
      const todayCheckOut = attEvents.find((e: any) => e.type === 'CHECK_OUT' && vnDayOf(e.client_time) === today);
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
    // Đăng nhập xong kiểm tra bảo trì ngay để khóa kịp nếu Admin vừa bật.
    await fetchPortalMaintenance().catch(() => null);
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
    if (/ACCOUNT_LOCKED/.test(code)) return '🔒 Tài khoản này đã bị khóa! Mã PIN đã bị vô hiệu hóa trên hệ thống. Không thể đăng nhập lại.';
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
  const employeeRef = useRef<any>(null);
  employeeRef.current = employee;
  // Tab Lịch: chuyển Tuần này / Tuần sau (khai báo sớm để socket realtime dùng được).
  type SchedWeek = 'THIS' | 'NEXT';
  const [schedWeekSel, setSchedWeekSel] = useState<SchedWeek>('THIS');
  const schedWeekTouched = useRef(false);
  const [schedRefresh, setSchedRefresh] = useState(0);

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
          // FIX publish mẫu không tới NV: phiếu lương chỉ load khi bấm "Xem",
          // realtime về chỉ reload lịch/thông báo nên NV đã mở khóa vẫn thấy trống.
          // Tự tải lại phiếu khi đã mở khóa để Realtime 100% với Kế toán.
          if (payslipUnlockedRef.current && (!entity || entity === 'payslips' || entity === 'payroll' || entity === 'notifications' || entity === 'all')) {
            try {
              const slips = await apiRequest('/me/payslips');
              const arr = Array.isArray(slips) ? slips : [];
              const prevIds = new Set((payslipsRef.current || []).map((s: any) => s.item_id));
              const hasNew = arr.some((s: any) => !prevIds.has(s.item_id) || s.status === 'PUBLISHED');
              setPayslips(arr);
              if (hasNew && arr.length > (payslipsRef.current || []).length) {
                showToastRef.current('💰 Kế toán vừa phát hành phiếu lương mới cho bạn! Mở mục Thông báo & Lương để kiểm tra.');
              }
            } catch { /* giữ phiếu cũ khi offline */ }
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
          showToastRef.current('📡 Không kết nối được realtime — app sẽ tự thử nối lại mỗi phút, dữ liệu vẫn tải khi bạn mở từng tab. Kiểm tra địa chỉ máy chủ nếu lỗi kéo dài!');
        },
      });
      socket.on('data:updated', (p: any) => {
        reload(p?.entity);
        // Lịch publish/thay đổi → tải lại dải ngày tab Lịch (kể cả tuần sau).
        if (!p?.entity || p.entity === 'schedules' || p.entity === 'all') setSchedRefresh(k => k + 1);
        // Admin bật/tắt bảo trì -> cập nhật màn khóa cổng ngay (kể cả đang đăng nhập).
        if (p?.entity === 'config') fetchPortalMaintenanceRef.current().catch(() => null);
      });
      socket.on('notification.created', (p: any) => {
        reload();
        // Thông báo inbox mới (VD HR phát hành lịch tuần) → tab Lịch tải lại dải ngày.
        setSchedRefresh(k => k + 1);
      });
      // HR publish lịch tuần (kể cả tuần sau): NV cùng chi nhánh tự mở lịch tuần
      // đó + báo rõ để thấy ngay lịch làm việc của mình.
      socket.on('schedule.published', (p: any) => {
        try {
          const canon = (b?: string) => {
            const x = String(b || '').trim().toUpperCase();
            if (x === 'CN1' || x === 'CN130') return 'CN130';
            if (x === 'CN2' || x === 'CN261') return 'CN261';
            if (x === 'CN3' || x === 'CN120') return 'CN120';
            if (x === 'CN4' || x === 'CN111') return 'CN111';
            return x;
          };
          const myB = canon((employeeRef.current as any)?.default_branch_id);
          if (p?.branchId && myB && canon(p.branchId) !== myB) return;
          const wk = String(p?.weekStartDate || (p as any)?.week || '').slice(0, 10);
          const thisDays = empWeekDaysOf(0);
          if (wk && wk > thisDays[6]) {
            schedWeekTouched.current = true;
            setSchedWeekSel('NEXT');
            const nd = empWeekDaysOf(1);
            const fmt = (s: string) => s.split('-').reverse().join('/');
            showToastRef.current(`📅 HR vừa phát hành lịch tuần ${fmt(nd[0])} – ${fmt(nd[6])}. Mở xem lịch làm việc của bạn!`);
          }
          setSchedRefresh(k => k + 1);
          reload('schedules');
        } catch { /* bỏ qua */ }
      });
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
      if (socket) {
        stopRealtimeRevive(socket);
        socket.disconnect();
      }
    };
  }, [isLoggedIn]);

  // Guard: Mandatory 2-day OFF registration locks other tabs for official employees
  // Ưu tiên trạng thái khóa từ server; khi offline mới dùng cờ localStorage cũ.
  const weeklyOffGateLocked = weeklyOffLockKnown ? weeklyOffLocked : !hasRegisteredWeeklyOff;
  // Cổng đăng ký chỉ mở T6 09h00 -> T7 09h00. Chưa rõ trạng thái (offline) thì cho bấm, server sẽ quyết.
  const weeklyOffRegOpen = !weeklyOffWindow || weeklyOffWindow.phase === 'OPEN';
  const weeklyOffOpensAtStr = weeklyOffWindow?.windowOpensAt
    ? new Date(weeklyOffWindow.windowOpensAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', weekday: 'long', day: '2-digit', month: '2-digit' })
    : '09h00 Thứ 6';
  // Bấm nút đăng ký ngoài khung giờ -> báo giờ mở thay vì gọi API
  const notifyRegWindowClosed = () => {
      showToast(`⏰ CHƯA ĐẾN GIỜ MỞ ĐĂNG KÝ! Cổng đăng ký 2 ngày nghỉ OFF mở lúc ${weeklyOffOpensAtStr} đến 09h00 Thứ 7. Hệ thống sẽ tự gửi thông báo trước 5 phút!`);
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
      return '⏰ Đăng ký 2 ngày nghỉ OFF chỉ mở từ 09h00 Thứ 6 đến 09h00 Thứ 7 hàng tuần!';
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
  /** Dải T2–CN của tuần hiện tại (offset 0) hoặc tuần sau (offset 1), theo giờ VN.
   *  Khai báo function để socket effect ở trên dùng được (hoisted). */
  function empWeekDaysOf(offsetWeeks: number): string[] {
    const nowVn = new Date(Date.now() + 7 * 3_600_000);
    const off = (nowVn.getUTCDay() + 6) % 7;
    const mon = new Date(nowVn);
    mon.setUTCDate(mon.getUTCDate() - off + offsetWeeks * 7);
    const days: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setUTCDate(mon.getUTCDate() + i);
      days.push(d.toISOString().slice(0, 10));
    }
    return days;
  }
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
    // Tuần HR đã publish (kể cả tuần sau) thì được đổi: chặn ca tuần đã qua,
    // ca tương lai do rào PUBLISHED quyết định (chưa publish -> server từ chối).
    const wk = swapWeekRange();
    const d = String(dateStr || '').slice(0, 10);
    return !!d && d >= wk.mon;
  };
  /** Chỉ ca HR đã PUBLISH (NV đã thấy trên lịch) mới được đổi/tráo — ca DRAFT
   *  (nháp, HR chưa chốt) chặn cả 2 chiều; tuần nào chưa publish thì tuần đó
   *  không đổi được. Server là lớp chặn cuối (SWAP_SHIFT_NOT_PUBLISHED). */
  const isSwapReadyShift = (s: any) => !!s && s.status === 'PUBLISHED';
  const swapReadyShifts = (list: any[]) => (list || []).filter((s: any) => inSwapWeek(s.date) && isSwapReadyShift(s));
  const swapDraftCount = (list: any[]) => (list || []).filter((s: any) => inSwapWeek(s.date) && !isSwapReadyShift(s)).length;
  const swapNotReadyMsg = (label: string) => `⛔ ${label} chưa được HR publish (đang nháp) — chỉ đổi ca đã publish mà bạn đã thấy trên lịch. Báo HR publish lịch tuần này để mở đổi ca.`;
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
    const picked = list.find((s: any) => s.assignment_id === attendShiftId);
    if (picked) return picked;
    // Chưa chọn ca (ngày 2 ca): mặc định ca ĐANG diễn ra thay vì ca đầu danh
    // sách — tránh CONFIRMED nhầm ca rồi ca đúng vẫn "chưa check-in".
    const now = Date.now();
    const live = list.find((s: any) => {
      const st = new Date(s.start_at || '').getTime();
      const en = new Date(s.end_at || '').getTime();
      return Number.isFinite(st) && Number.isFinite(en) && now >= st && now <= en;
    });
    return live || list[0];
  };
  // Guard đồng bộ chống bấm đúp GHI NHẬN (setState async không kịp chặn 2 click
  // cùng tick -> 2 POST trùng ca; server cũng chặn trùng, đây là lớp báo sớm).
  const attendBusyRef = useRef(false);
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
          const openStr = new Date(openTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
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
      // NV thử việc miễn kiểm tra áo hồng — nhận ảnh luôn.
      if (isProbation) {
        setPhotoData(dataUrl);
        setPhotoPinkRatio(null);
        showToast('✓ Đã nhận ảnh điểm danh!');
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
    // NV thử việc được miễn yêu cầu đồng phục (không cần tick 2 ô xác nhận).
    if (!isProbation && (!uniformChecked || !badgeChecked)) {
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
    // Chặn bấm đúp + chặn gửi khi không có ca (tránh POST vô nghĩa).
    if (attendBusyRef.current) return;
    const todayShiftPre = getAttendShift();
    if (!todayShiftPre) {
      showToast('🔒 Hôm nay bạn không có lịch ca làm việc được phân công! Chức năng điểm danh bị khóa.');
      return;
    }
    attendBusyRef.current = true;
    setAttendanceStep('SUBMITTING');
    try {
      const todayShift = getAttendShift();
      if (!todayShift) throw new Error('Hôm nay bạn không có lịch ca làm việc được phân công!');
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
    } finally {
      attendBusyRef.current = false;
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
    if (actionBusy) return;
    setActionBusy('leave-submit');
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
    } finally {
      setActionBusy(null);
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
      const myId = (employee as any)?.employee_id;
      const list: any = await apiRequest(`/leave-requests${myId ? `?employeeId=${encodeURIComponent(myId)}` : ''}`);
      const arr = Array.isArray(list) ? list : [];
      const win = probationWindowDays();
      const mine = [...new Set(
        arr
          .filter((l: any) => (!myId || !l?.employee_id || l.employee_id === myId) && l?.leave_type === 'THU_VIEC' && l?.status === 'APPROVED' && win.includes(toISODate(l.requested_date)))
          .map((l: any) => toISODate(l.requested_date))
          .filter(Boolean)
      )].sort();
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

  // Tab Lịch: dải ngày hiển thị đầy đủ (thử việc: 12 ngày từ start_date; chính
  // thức: T2-CN tuần này hoặc tuần sau theo nút chuyển) + ca + đơn OFF + sự
  // kiện điểm danh theo ngày.
  const [schedRange, setSchedRange] = useState<string[]>([]);
  const [schedRangeShifts, setSchedRangeShifts] = useState<any[]>([]);
  const [schedRangeLeaves, setSchedRangeLeaves] = useState<any[]>([]);
  const [schedFilter, setSchedFilter] = useState<'ALL' | 'WORK' | 'OFF'>('ALL');
  const [selectedSchedDate, setSelectedSchedDate] = useState<string | null>(null);
  // HR đã phát hành lịch tuần sau (có ca PUBLISHED) mà NV chưa tự chuyển tuần
  // thì mặc định mở tuần sau — đúng yêu cầu "publish xong NV thấy lịch tuần sau".
  useEffect(() => {
    if (!isLoggedIn || isProbation || schedWeekTouched.current) return;
    let alive = true;
    (async () => {
      try {
        const days = empWeekDaysOf(1);
        const sh = await apiRequest(`/me/schedule?fromDate=${days[0]}&toDate=${days[6]}`).catch(() => []);
        if (!alive || schedWeekTouched.current) return;
        if (Array.isArray(sh) && sh.some((s: any) => s?.status === 'PUBLISHED')) setSchedWeekSel('NEXT');
      } catch { /* offline: giữ tuần này */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, (employee as any)?.employee_id]);
  useEffect(() => {
    if (activeTab !== 'schedule' || !isLoggedIn) return;
    let alive = true;
    (async () => {
      try {
        let days: string[] = [];
        if (isProbation) {
          days = probationWindowDays();
        } else {
          days = empWeekDaysOf(schedWeekSel === 'NEXT' ? 1 : 0);
        }
        if (days.length === 0) { if (alive) { setSchedRange([]); setSchedRangeShifts([]); setSchedRangeLeaves([]); } return; }
        if (alive) setSchedRange(days);
        const myEmpId = (employee as any)?.employee_id;
        const [sh, lv] = await Promise.all([
          apiRequest(`/me/schedule?fromDate=${days[0]}&toDate=${days[days.length - 1]}`).catch(() => []),
          apiRequest(`/leave-requests${myEmpId ? `?employeeId=${encodeURIComponent(myEmpId)}` : ''}`).catch(() => []),
        ]);
        if (!alive) return;
        setSchedRangeShifts(Array.isArray(sh) ? sh : []);
        const leaves = Array.isArray(lv) ? lv : [];
        const seenLeaveDates = new Set<string>();
        const filteredLeaves = leaves.filter((l: any) => {
          if (myEmpId && l?.employee_id && l.employee_id !== myEmpId) return false;
          const t = (l as any)?.leave_type;
          if (t !== 'HANG_TUAN' && t !== 'THU_VIEC' && t !== 'DOT_XUAT') return false;
          if (['REJECTED', 'CANCELLED'].includes((l as any)?.status)) return false;
          const reqD = toISODate((l as any)?.requested_date);
          if (!days.includes(reqD)) return false;
          if (seenLeaveDates.has(reqD)) return false;
          seenLeaveDates.add(reqD);
          return true;
        });
        setSchedRangeLeaves(filteredLeaves);
      } catch { /* offline: giữ dữ liệu cũ */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab,
    isLoggedIn,
    (employee as any)?.employee_id,
    (employee as any)?.start_date,
    schedWeekSel,
    schedRefresh,
  ]);

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
    if (!targetEmployeeId) {
      setTargetShiftsLoading(false);
      return;
    }
    setTargetShiftsLoading(true);
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
    } finally {
      setTargetShiftsLoading(false);
    }
  };

  const handleSelectSwapTarget = (targetEmployeeId: string) => {
    const col = branchColleagues.find((c: any) => c.employee_id === targetEmployeeId);
    setSwapData(s => ({ ...s, targetEmployeeId, targetEmployeeName: col?.full_name || '', targetShift: '' }));
    loadTargetShifts(targetEmployeeId);
  };

  // Gửi yêu cầu đổi ca THẬT lên server (cả 2 hình thức)
  const handleSubmitSwap = async () => {
    // Chặn bấm đúp / double-tap: 2 POST cùng tick sẽ tạo 2 phiếu trùng nội dung
    // (server cũng chặn SWAP_DUPLICATE, đây là lớp báo sớm).
    if (swapBusyRef.current || actionBusy === 'swap') return;
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
    // Chặn sớm ca chưa publish (server cũng chặn SWAP_SHIFT_NOT_PUBLISHED).
    const mySh = (myShifts || []).find((s: any) => s.assignment_id === swapData.myShift);
    if (mySh && !isSwapReadyShift(mySh)) {
      showToast(swapNotReadyMsg('Ca của bạn'));
      return;
    }
    const tgtSh = (targetShifts || []).find((s: any) => s.assignment_id === swapData.targetShift);
    if (tgtSh && !isSwapReadyShift(tgtSh)) {
      showToast(swapNotReadyMsg('Ca của đồng nghiệp'));
      return;
    }
    setActionBusy('swap');
    swapBusyRef.current = true;
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
      showToast(sid ? `✓ Đã gửi yêu cầu đổi ca THẬT! Mã đơn: ${sid}. B đồng ý là 2 ca hoán đổi ngay.` : '✓ Đã gửi yêu cầu đổi ca! Mở danh sách phiếu để kiểm tra trạng thái.');
      setSwapData({ myShift: '', targetEmployeeId: '', targetEmployeeName: '', targetShift: '', reason: '' });
      setTargetShifts([]);
      // Lịch trước, phiếu sau (nối tiếp) — tránh response cũ ghi đè danh sách mới.
      await loadEmployeeData(employee?.employee_id);
      await fetchMySwaps();
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi gửi yêu cầu đổi ca!');
    } finally {
      swapBusyRef.current = false;
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
    // Lượt 1 lần duy nhất: chặn bấm đúp race 2 POST (server cũng chặn, đây là lớp báo sớm).
    if (actionBusy) return;
    setActionBusy('emg-submit');
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
    } finally {
      setActionBusy(null);
    }
  };

  // Ảnh bằng chứng kèm phiếu bổ sung công: nén ngay trên máy (tái dùng compressPhoto
  // của điểm danh, KHÔNG kiểm tra áo hồng — bằng chứng có thể là ảnh chụp màn hình/giấy tờ).
  const handleEvidenceSelected = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('⚠️ File không phải ảnh! Vui lòng chụp/chọn ảnh thật.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      showToast('⚠️ Ảnh quá lớn (>15MB)! Vui lòng chụp lại.');
      return;
    }
    setEvidenceBusy(true);
    try {
      const dataUrl = await compressPhoto(file);
      if (!dataUrl) {
        showToast('⚠️ Không đọc được ảnh! Vui lòng chụp lại.');
        return;
      }
      setEvidencePhoto(dataUrl);
      showToast('✓ Đã đính kèm ảnh bằng chứng! Ảnh sẽ gửi cùng phiếu cho HR duyệt.');
    } catch {
      showToast('⚠️ Không xử lý được ảnh! Vui lòng chụp lại.');
    } finally {
      setEvidenceBusy(false);
    }
  };

  const handleAdjustmentSubmit = async () => {
    // Chống bấm đúp gửi trùng phiếu (server cũng chặn trùng, đây là lớp báo sớm).
    if (actionBusy === 'adj-submit') return;
    try {
      if (!adjustmentData.date) {
        showToast('⚠️ Vui lòng chọn ngày sự cố!');
        return;
      }
      if (!adjustmentData.reason.trim()) {
        showToast('⚠️ Vui lòng nhập chi tiết lý do & bằng chứng!');
        return;
      }
      setActionBusy('adj-submit');
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
        // Chốt đúng ca ĐÚNG NGÀY sự cố (tải riêng theo ngày): không bao giờ rớt về
        // ca ngày khác — gửi sai ngày là duyệt nhầm sang ngày khác.
        const dayShifts = (adjDayShifts || []).filter((s: any) => String(s.date || '').slice(0, 10) === adjustmentData.date);
        if (dayShifts.length === 0) {
          showToast(`⚠️ Ngày ${adjustmentData.date} không có ca làm việc nào được xếp! Kiểm tra lại ngày hoặc liên hệ HR xếp ca trước — hệ thống chặn gửi để khỏi duyệt nhầm ngày.`);
          return;
        }
        const shift = dayShifts.find((s: any) => s.assignment_id === adjustShiftId) || dayShifts[0];
        await apiRequest('/attendance/adjustments', {
          method: 'POST',
          body: JSON.stringify({
            assignmentId: shift.assignment_id,
            incidentDate: adjustmentData.date,
            reason: `[${adjustmentData.type}] ${adjustmentData.date}: ${adjustmentData.reason.trim()}`,
            minutesRequested: 0,
            // Ảnh bằng chứng: server upload Drive rồi chỉ lưu Drive ID (không lưu base64).
            ...(evidencePhoto ? { photo_base64: evidencePhoto } : {}),
          }),
        });
        setEvidencePhoto(null);
        showToast('✓ Đã gửi phiếu giải trình bổ sung công đến Cửa Hàng Trưởng và HR!');
      }
      await fetchMyAdjustments();
      await loadEmployeeData(employee?.employee_id);
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi gửi phiếu giải trình!');
    } finally {
      setActionBusy(null);
    }
  };

  // Phiếu lương: 100% dữ liệu thật từ API /me/payslips (đã lọc đúng nhân viên ở server).
  // Không dùng PIN giả hay phiếu mẫu — không có dữ liệu thì báo trống.
  const handleUnlockPayslip = async () => {
    if (actionBusy) return;
    setActionBusy('payslip');
    try {
      const slips = await apiRequest('/me/payslips');
      setPayslips(Array.isArray(slips) ? slips : []);
      setPayslipUnlocked(true);
      if (!Array.isArray(slips) || slips.length === 0) {
        showToast('Chưa có phiếu lương nào được phát hành cho bạn trong kỳ này!');
      }
    } catch (err: any) {
      showToast(err.message || 'Không tải được phiếu lương! Vui lòng thử lại.');
    } finally {
      setActionBusy(null);
    }
  };

  const [confirmSlipBusy, setConfirmSlipBusy] = useState<string | null>(null);
  const handleConfirmPayslip = async (slipId: string, img: string, signerName: string) => {
    if (!img) {
      showToast('⚠️ Vui lòng vẽ chữ ký trước khi xác nhận!');
      return;
    }
    setConfirmSlipBusy(slipId);
    try {
      const confirmRaw: any = await apiRequest(`/me/payslips/${slipId}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ name: signerName || employee?.full_name || '', img }),
      });
      // Backend trả { operationId, result } qua hàng đợi ghi — bóc result.
      const updated = confirmRaw?.result ?? confirmRaw;
      showToast('✅ Bạn đã ký xác nhận phiếu lương thành công! Kế toán đã nhận được thông báo để chuyển khoản.');
      setPayslips(prev => prev.map(s => s.item_id === slipId ? {
        ...s,
        ...(updated || {}),
        status: 'CONFIRMED',
        sign_nhanvien: { name: signerName || employee?.full_name || '', at: new Date().toISOString(), img },
      } : s));
    } catch (err: any) {
      showToast(err?.message || 'Lỗi khi ký xác nhận phiếu lương!');
    } finally {
      setConfirmSlipBusy(null);
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

  // Cổng bị Admin tạm khóa bảo trì -> chặn TOÀN BỘ (kể cả màn đăng nhập/đổi PIN),
  // hiện màn bảo trì hiện đại thay vì để NV thao tác trong lúc kiểm kê/cập nhật ca.
  if (portalMaint?.active) {
    return (
      <MaintenanceScreen message={portalMaint.message} checking={maintChecking} onRetry={handleRetryMaintenance} />
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
            disabled={actionBusy === 'apibase'}
            onClick={() => { if (actionBusy) return; setActionBusy('apibase'); handleChangeApiBase().finally(() => setActionBusy(null)); }}
            title="Bấm để đổi địa chỉ máy chủ nếu báo lỗi kết nối"
            style={{ marginTop: '10px', border: 'none', background: 'none', fontSize: '11px', color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}
          >
            {actionBusy === 'apibase' ? '⏳ Đang kiểm tra máy chủ...' : `🔌 Máy chủ: ${apiBaseShown || '(chưa xác định)'} — bấm để đổi`}
          </button>
          <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--text-muted)' }}>
            Bản app: <code>{APP_COMMIT}</code> • Bản API: <code>{apiCommit || 'đang kiểm tra...'}</code>
            {updateReady && (
              <span style={{ color: 'var(--danger)', fontWeight: 700 }}> • Có bản mới — tải lại trang để nhận!</span>
            )}
            {' • '}
            <button
              disabled={actionBusy === 'appver'}
              onClick={async () => {
                if (actionBusy) return;
                setActionBusy('appver');
                try {
                  const r = await checkAppVersionRef.current().catch(() => 'fail' as const);
                  if (r === 'same') showToast('✓ Đang dùng bản mới nhất.');
                  else if (r === 'fail') showToast('⚠️ Không kiểm tra được (mất mạng?)!');
                } finally {
                  setActionBusy(null);
                }
              }}
              style={{ border: 'none', background: 'none', fontSize: '10px', color: 'var(--brand)', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontWeight: 700 }}
            >
              {actionBusy === 'appver' ? '⏳ Đang kiểm tra...' : 'Kiểm tra cập nhật'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Premium 3-step login (SĐT -> PIN 6 ô -> success + confetti). Nhánh đổi PIN ở trên.
  if (!isLoggedIn) {
    return (
      <>
        <PremiumLogin
          initialPhone={loginPhone}
          loading={loading}
          onLogin={handlePremiumLogin}
          onCheckPhone={handleCheckPhone}
          onSuccess={handlePremiumSuccess}
          onCheckUpdate={checkAppVersion}
        />
        {updateReady && <UpdateBanner onLater={snoozeAppUpdate} />}
      </>
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
                <strong>{weeklyOffWindow?.windowOpensAt ? new Date(weeklyOffWindow.windowOpensAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', weekday: 'long', day: '2-digit', month: '2-digit' }) : '09h00 Thứ 6'}</strong>{' '}
                đến <strong>09h00 Thứ 7</strong>. Hãy chuẩn bị chọn 2 ngày nghỉ!
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
          !n.read_at &&
          n.type !== 'CHECKIN_REMINDER' &&
          !/nhắc.*(?:check-?in|điểm danh)/i.test(`${n.title || ''} ${n.summary || ''}`) &&
          (n.target_path === '/attendance') &&
          /(?:vượt|ngoài phạm vi|sai vị trí|bắt buộc điểm danh lại|300m.*vượt)/i.test(`${n.title || ''} ${n.summary || ''}`)
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
                disabled={actionBusy === 'notif-later'}
                onClick={async () => {
                  if (actionBusy) return;
                  setActionBusy('notif-later');
                  try {
                    await apiRequest(`/me/notifications/${redo[0].inbox_id}/read`, { method: 'POST' });
                    setNotifications((prev: any[]) => prev.map(x => x.inbox_id === redo[0].inbox_id ? { ...x, read_at: new Date().toISOString() } : x));
                  } catch {} finally {
                    setActionBusy(null);
                  }
                }}
                style={{ backgroundColor: '#FFF', color: '#991B1B', border: '1px solid #FCA5A5', borderRadius: '6px', padding: '9px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
              >
                {actionBusy === 'notif-later' ? '⏳...' : 'Để sau'}
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
        {/* ========================================================= */}
        {/* TAB 2: LỊCH THỬ VIỆC / LỊCH LÀM VIỆC TUẦN */}
        {/* ========================================================= */}
        {activeTab === 'schedule' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Header Card */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <CalendarDays size={18} color="var(--brand)" />
                    {isProbation ? '2. Lịch Thử Việc Chu Kỳ 12 Ngày' : '2. Lịch Làm Việc Tuần'}
                  </h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', marginBottom: 0 }}>
                    {isProbation
                      ? 'Quy định thử việc: 12 ngày (7 ngày làm việc thực tế, 5 ngày nghỉ OFF chuẩn định biên).'
                      : (() => {
                        const d = empWeekDaysOf(schedWeekSel === 'NEXT' ? 1 : 0);
                        const fmt = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
                        return `Lịch làm việc tuần ${fmt(d[0])} – ${fmt(d[6])} (Thứ Hai đến Chủ Nhật).`;
                      })()}
                  </p>
                </div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 10px', borderRadius: '999px', backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0', color: '#065F46', fontSize: '11px', fontWeight: 800 }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10B981', display: 'inline-block' }} />
                  Đã Phát (PUBLISHED)
                </div>
              </div>

              {/* Chuyển Tuần này / Tuần sau: HR publish lịch tuần sau xong NV mở xem ngay */}
              {!isProbation && (() => {
                const t = empWeekDaysOf(0);
                const n = empWeekDaysOf(1);
                const fmt = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
                const btn = (sel: 'THIS' | 'NEXT', label: string) => (
                  <button
                    key={sel}
                    onClick={() => { schedWeekTouched.current = true; setSchedWeekSel(sel); }}
                    style={{
                      padding: '7px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 800, cursor: 'pointer',
                      border: schedWeekSel === sel ? '1.5px solid var(--brand)' : '1px solid var(--border)',
                      backgroundColor: schedWeekSel === sel ? '#FFF0F5' : '#FFFFFF',
                      color: schedWeekSel === sel ? 'var(--brand)' : 'var(--text-muted)',
                    }}
                  >
                    {label}
                  </button>
                );
                return (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {btn('THIS', `Tuần này (${fmt(t[0])}–${fmt(t[6])})`)}
                    {btn('NEXT', `Tuần sau (${fmt(n[0])}–${fmt(n[6])})`)}
                  </div>
                );
              })()}

              {isProbation && probationAssessment?.endDate && (
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#1E40AF', backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 'var(--radius-sm)', padding: '10px 12px', lineHeight: 1.5 }}>
                  🎓 <strong>Ngày hoàn thành thử việc:</strong> {String(probationAssessment.endDate).split('-').reverse().join('/')} — HR sẽ gửi lịch kiểm tra đầu ra (Meet + trắc nghiệm) trước ngày này.
                </div>
              )}

              {/* NV thử việc: bạn có đang đẩy nhanh (2 ca/ngày) không */}
              {isProbation && myShifts.length > 0 && (() => {
                const density = shiftDensityOf(myShifts);
                if (density.multiDays.length === 0) {
                  return (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', backgroundColor: '#F9FAFB', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', fontWeight: 600 }}>
                      📅 Bạn đang làm chuẩn <strong>1 ca/ngày</strong> • Tổng <strong>{density.total} ca</strong> đã xếp. Muốn đẩy nhanh 2 ca/ngày thì báo Store xếp thêm ca.
                    </div>
                  );
                }
                return (
                  <div style={{ fontSize: '12px', color: '#92400E', backgroundColor: '#FFFBEB', border: '1.5px solid #F59E0B', borderRadius: 'var(--radius-sm)', padding: '10px 12px', lineHeight: 1.6 }}>
                    <div style={{ fontWeight: 800, fontSize: '13px' }}>⚡ Bạn đang đẩy nhanh: {density.multiDays.length} ngày làm 2 ca!</div>
                    {density.multiDays.map(m => (
                      <div key={m.date}>• <strong>{m.date.slice(8, 10)}/{m.date.slice(5, 7)}</strong>: {m.codes} ({m.count} ca)</div>
                    ))}
                    <div style={{ marginTop: '4px' }}>Tổng <strong>{density.total} ca</strong> đã xếp trong kỳ thử việc.</div>
                  </div>
                );
              })()}

              {/* Lịch theo NGÀY đầy đủ trạng thái */}
              {(() => {
                const todayStr = vnTodayStr();
                const dowName = (s: string) => ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][new Date(`${s}T00:00:00Z`).getUTCDay()];
                const fullDowName = (s: string) => ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'][new Date(`${s}T00:00:00Z`).getUTCDay()];
                const fmtD = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
                const fmtHM = (iso?: string) => {
                  const t = new Date(iso || '').getTime();
                  if (!Number.isFinite(t)) return '';
                  const d = new Date(t);
                  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                };

                const getBranchDisplayName = (bId?: string) => {
                  if (!bId) return 'Chi nhánh phụ trách';
                  const id = String(bId).toUpperCase();
                  if (id === 'CN130' || id === 'CN1') return 'CN1: 130 Vạn Kiếp (Bình Thạnh)';
                  if (id === 'CN261' || id === 'CN2') return 'CN2: 261 Tô Hiến Thành (Q.10)';
                  if (id === 'CN120' || id === 'CN3') return 'CN3: 120 Hoàng Diệu 2 (Thủ Đức)';
                  if (id === 'CN111' || id === 'CN4') return 'CN4: 111 Tôn Đản (Q.4)';
                  if (id === 'VAN_PHONG') return 'Văn Phòng Công Ty';
                  if (id === 'XUONG_SX' || id === 'XUONG') return 'Xưởng Sản Xuất';
                  return bId;
                };

                const getShiftMeta = (shiftCode?: string, startAt?: string, endAt?: string) => {
                  const code = String(shiftCode || '').toUpperCase();
                  const timeStr = (startAt && endAt) ? `${fmtHM(startAt)} – ${fmtHM(endAt)}` : '';
                  if (code.includes('CA_1') || code.includes('CA 1') || code.includes('SANG')) {
                    return {
                      title: 'Ca 1 (Ca Sáng)',
                      time: timeStr || '07:00 – 12:00',
                      duration: '5 giờ',
                      icon: '☀️',
                      accent: '#D97706',
                      bg: '#FFFDF5',
                      border: '#FDE68A',
                      badgeBg: '#FEF3C7',
                      badgeFg: '#92400E',
                    };
                  }
                  if (code.includes('CA_2') || code.includes('CA 2') || code.includes('CHIEU')) {
                    return {
                      title: 'Ca 2 (Ca Chiều)',
                      time: timeStr || '12:00 – 18:00',
                      duration: '6 giờ',
                      icon: '🌤️',
                      accent: '#0284C7',
                      bg: '#F8FCFF',
                      border: '#BAE6FD',
                      badgeBg: '#E0F2FE',
                      badgeFg: '#075985',
                    };
                  }
                  if (code.includes('CA_3') || code.includes('CA 3') || code.includes('TOI')) {
                    return {
                      title: 'Ca 3 (Ca Tối)',
                      time: timeStr || '18:00 – 23:00',
                      duration: '5 giờ',
                      icon: '🌙',
                      accent: '#7C3AED',
                      bg: '#FAF8FF',
                      border: '#DDD6FE',
                      badgeBg: '#F3E8FF',
                      badgeFg: '#6B21A8',
                    };
                  }
                  return {
                    title: shiftCode || 'Ca Làm Việc',
                    time: timeStr || 'Theo phân công',
                    duration: '',
                    icon: '💼',
                    accent: '#E85D92',
                    bg: '#FFF8FA',
                    border: '#FBCFE8',
                    badgeBg: '#FCE7F0',
                    badgeFg: '#9D174D',
                  };
                };

                // Ca trong dải (gộp tải theo dải + realtime), khử trùng, bỏ ca đã hủy.
                const seenAid = new Set<string>();
                const rangeShifts: any[] = [];
                for (const s of [...(schedRangeShifts || []), ...(myShifts || [])]) {
                  const k = String(s?.assignment_id || '');
                  if (k && seenAid.has(k)) continue;
                  if (k) seenAid.add(k);
                  if ((s as any)?.status === 'CANCELLED') continue;
                  rangeShifts.push(s);
                }
                const days = schedRange.length > 0 ? schedRange : [];
                if (days.length === 0) {
                  return (
                    <div style={{ padding: '28px 20px', textAlign: 'center', backgroundColor: '#F9FAFB', borderRadius: 'var(--radius-md)', border: '1px dashed var(--border)', color: 'var(--text-muted)', fontSize: '13px' }}>
                      {isProbation
                        ? 'Hồ sơ chưa có ngày bắt đầu thử việc! Liên hệ HR bổ sung để hiện dải 12 ngày.'
                        : 'Chưa tải được tuần hiện tại. Vui lòng kiểm tra kết nối mạng rồi tải lại trang.'}
                    </div>
                  );
                }

                // 1. Tập hợp ca làm việc và các ngày có ca trong dải `days`
                const shiftsInDays = rangeShifts.filter((s: any) => days.includes(String(s.date || '').slice(0, 10)));
                const workDaysSet = new Set(shiftsInDays.map((s: any) => String(s.date || '').slice(0, 10)));
                const workCount = shiftsInDays.length;

                // 2. Ngày có đơn nghỉ phép hợp lệ trong dải `days`
                const leaveDatesInDays = new Set(
                  (schedRangeLeaves || [])
                    .map((l: any) => toISODate(l.requested_date))
                    .filter((d: string) => days.includes(d))
                );

                // 3. Ngày Nghỉ OFF trong dải `days`: ngày KHÔNG có ca làm việc.
                // Đi làm thì không còn OFF — ngày vừa có ca active vừa có đơn OFF
                // chỉ hiện ca làm (không hiện thẻ OFF gây rắc rối).
                const offDays = days.filter(d => !workDaysSet.has(d));
                const offDaysSet = new Set(offDays);
                const offCount = offDays.length;

                // Tóm tắt trạng thái hôm nay
                const todayShifts = rangeShifts.filter((s: any) => String(s.date || '').slice(0, 10) === todayStr);
                const todayOffs = (schedRangeLeaves || []).filter((l: any) => toISODate(l.requested_date) === todayStr);
                const isTodayOff = offDaysSet.has(todayStr);
                const todaySummary = todayShifts.length > 0
                  ? `${todayShifts.length} Ca làm việc`
                  : (todayOffs.length > 0 || isTodayOff)
                  ? (isProbation ? 'Nghỉ OFF thử việc' : 'Nghỉ OFF tuần')
                  : 'Không có ca';

                // Trạng thái 1 ca (điểm danh tính gộp cả ca trùng đã gộp _mergedAids)
                const shiftStatusOf = (sh: any) => {
                  const aids = [(sh as any).assignment_id, ...((sh as any)._mergedAids || [])].filter(Boolean);
                  const evts = (myAttendanceHistory || []).filter((e: any) => aids.length > 0 ? aids.includes((e as any).assignment_id) : (e as any).assignment_id === sh.assignment_id);
                  const hasIn = evts.some((e: any) => e.type === 'CHECK_IN');
                  const hasOut = evts.some((e: any) => e.type === 'CHECK_OUT');
                  const absent = evts.some((e: any) => e.type === 'ABSENT');
                  const inE = evts.find((e: any) => e.type === 'CHECK_IN');
                  const outE = evts.find((e: any) => e.type === 'CHECK_OUT');
                  const startMs = sh.start_at ? new Date(sh.start_at).getTime() : NaN;
                  const endMs = sh.end_at ? new Date(sh.end_at).getTime() : NaN;
                  const inMs = inE?.client_time ? new Date(inE.client_time).getTime() : NaN;
                  const pastDay = String(sh.date || '').slice(0, 10) < todayStr;
                  const locked = !hasIn && Number.isFinite(startMs) && Date.now() - (startMs as number) > 3 * 60 * 60 * 1000;
                  const complete = hasIn && hasOut;
                  const isAbsent = !hasIn && absent;
                  const missingOut = hasIn && !hasOut && (Number.isFinite(endMs) && Date.now() - (endMs as number) > 30 * 60 * 1000 || pastDay || (Number.isFinite(inMs) && Date.now() - (inMs as number) > 12 * 60 * 60 * 1000));

                  if (complete) {
                    return {
                      label: '✓ Đã hoàn thành',
                      detail: `Vào ${fmtHM(inE?.client_time)} – Ra ${fmtHM(outE?.client_time)}`,
                      bg: '#ECFDF5',
                      fg: '#065F46',
                      bd: '1px solid #A7F3D0',
                      icon: '✓',
                    };
                  }
                  if (isAbsent) {
                    return {
                      label: '🔴 Vắng không phép',
                      detail: 'Hệ thống tự ghi vắng do không điểm danh',
                      bg: '#FEF2F2',
                      fg: '#991B1B',
                      bd: '1px solid #FECACA',
                      icon: '✕',
                    };
                  }
                  if (locked) {
                    return {
                      label: '🔒 Đã khóa ca',
                      detail: 'Quá 3h không điểm danh vào ca',
                      bg: '#F1F5F9',
                      fg: '#475569',
                      bd: '1px solid #CBD5E1',
                      icon: '🔒',
                    };
                  }
                  if (missingOut) {
                    return {
                      label: '⚠️ Thiếu check-out',
                      detail: `Vào lúc ${fmtHM(inE?.client_time)} nhưng chưa check-out`,
                      bg: '#FFF7ED',
                      fg: '#9A3412',
                      bd: '1px solid #FFEDD5',
                      icon: '◐',
                    };
                  }
                  if (hasIn) {
                    return {
                      label: '▶ Đang làm việc',
                      detail: `Đã check-in lúc ${fmtHM(inE?.client_time)}`,
                      bg: '#FFFBEB',
                      fg: '#92400E',
                      bd: '1px solid #FDE68A',
                      icon: '▶',
                    };
                  }
                  if (String(sh.date || '').slice(0, 10) === todayStr) {
                    return {
                      label: '⏱️ Ca hôm nay',
                      detail: 'Sẵn sàng điểm danh khi có mặt tại chi nhánh',
                      bg: '#FFF0F5',
                      fg: '#BE185D',
                      bd: '1px solid #FBCFE8',
                      icon: '⏱️',
                    };
                  }
                  return {
                    label: 'Chưa điểm danh',
                    detail: 'Lịch đã duyệt • Chờ đến ngày làm việc',
                    bg: '#FFFFFF',
                    fg: '#64748B',
                    bd: '1px solid #E2E8F0',
                    icon: '📅',
                  };
                };

                // Lọc ngày theo bộ lọc (Tất cả / Có ca / Nghỉ OFF)
                const displayedDays = days.filter(d => {
                  if (schedFilter === 'WORK') {
                    return workDaysSet.has(d);
                  }
                  if (schedFilter === 'OFF') {
                    return offDaysSet.has(d);
                  }
                  return true;
                });

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {/* KPI Summary Cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                      <div style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '12px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: 700, color: '#1D4ED8' }}>
                          <Briefcase size={13} />
                          <span>Ca Làm Việc</span>
                        </div>
                        <div style={{ fontSize: '18px', fontWeight: 800, color: '#1E40AF', marginTop: '2px' }}>
                          {workCount} <span style={{ fontSize: '12px', fontWeight: 600 }}>ca</span>
                        </div>
                        <div style={{ fontSize: '10px', color: '#3B82F6' }}>
                          ~{workCount * 5} giờ dự kiến
                        </div>
                      </div>

                      <div style={{ backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: '12px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: 700, color: '#059669' }}>
                          <Palmtree size={13} />
                          <span>Nghỉ OFF</span>
                        </div>
                        <div style={{ fontSize: '18px', fontWeight: 800, color: '#065F46', marginTop: '2px' }}>
                          {offCount} <span style={{ fontSize: '12px', fontWeight: 600 }}>ngày</span>
                        </div>
                        <div style={{ fontSize: '10px', color: '#10B981' }}>
                          {isProbation ? '5 ngày OFF thử việc' : 'Theo lịch đã duyệt'}
                        </div>
                      </div>

                      <div style={{ backgroundColor: '#FDF2F8', border: '1px solid #FBCFE8', borderRadius: '12px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: 700, color: '#DB2777' }}>
                          <Sparkles size={13} />
                          <span>Hôm Nay</span>
                        </div>
                        <div style={{ fontSize: '13px', fontWeight: 800, color: '#9D174D', marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {todaySummary}
                        </div>
                        <div style={{ fontSize: '10px', color: '#E85D92' }}>
                          {fmtD(todayStr)} ({dowName(todayStr)})
                        </div>
                      </div>
                    </div>

                    {/* Interactive Week Calendar Strip */}
                    <div style={{ backgroundColor: '#FAF8F6', border: '1px solid #EFE4DE', borderRadius: '14px', padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                          📅 Toàn Cảnh {isProbation ? 'Thử Việc' : 'Tuần'} ({days[0] && fmtD(days[0])} → {days[days.length - 1] && fmtD(days[days.length - 1])})
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Chạm để tới ngày</span>
                      </div>

                      <div style={{ display: 'flex', gap: '4px', overflowX: isProbation ? 'auto' : 'visible', paddingBottom: isProbation ? '4px' : '0' }}>
                        {days.map((d) => {
                          const isToday = d === todayStr;
                          const dayShifts = rangeShifts.filter((s: any) => String(s.date || '').slice(0, 10) === d);
                          const isOffDay = offDaysSet.has(d);
                          return (
                            <div
                              key={`strip-${d}`}
                              onClick={() => {
                                const el = document.getElementById(`sched-day-${d}`);
                                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              }}
                              style={{
                                flex: isProbation ? '0 0 52px' : 1,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                padding: '8px 2px',
                                borderRadius: '10px',
                                cursor: 'pointer',
                                backgroundColor: isToday ? 'var(--brand-soft)' : '#FFFFFF',
                                border: isToday ? '2px solid var(--brand)' : '1px solid var(--border)',
                                boxShadow: isToday ? '0 3px 10px rgba(232, 93, 146, 0.2)' : 'none',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              <span style={{ fontSize: '11px', fontWeight: isToday ? 800 : 700, color: isToday ? 'var(--brand)' : 'var(--text-muted)' }}>
                                {dowName(d)}
                              </span>
                              <span style={{ fontSize: '14px', fontWeight: 800, color: isToday ? 'var(--brand)' : 'var(--text)', margin: '2px 0' }}>
                                {d.slice(8, 10)}
                              </span>
                              <div style={{ minHeight: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {dayShifts.length > 0 ? (
                                  <span style={{ fontSize: '9px', fontWeight: 800, color: '#7C3AED', backgroundColor: '#F3E8FF', borderRadius: '4px', padding: '1px 4px' }}>
                                    {dayShifts[0].shift_code === 'CA_1' ? 'Ca 1' : dayShifts[0].shift_code === 'CA_2' ? 'Ca 2' : dayShifts[0].shift_code === 'CA_3' ? 'Ca 3' : `${dayShifts.length} ca`}
                                  </span>
                                ) : isOffDay ? (
                                  <span style={{ fontSize: '9px', fontWeight: 800, color: '#065F46', backgroundColor: '#D1FAE5', borderRadius: '4px', padding: '1px 4px' }}>
                                    OFF
                                  </span>
                                ) : (
                                  <span style={{ fontSize: '10px', color: '#CBD5E1', fontWeight: 700 }}>•</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Filter Pills */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={() => setSchedFilter('ALL')}
                        style={{
                          flex: 1,
                          minHeight: '34px',
                          padding: '6px 10px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          fontWeight: 700,
                          backgroundColor: schedFilter === 'ALL' ? 'var(--brand)' : '#FFFFFF',
                          color: schedFilter === 'ALL' ? '#FFFFFF' : 'var(--text-muted)',
                          border: schedFilter === 'ALL' ? 'none' : '1px solid var(--border)',
                          boxShadow: schedFilter === 'ALL' ? '0 2px 8px rgba(232, 93, 146, 0.25)' : 'none',
                        }}
                      >
                        Tất Cả ({days.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setSchedFilter('WORK')}
                        style={{
                          flex: 1,
                          minHeight: '34px',
                          padding: '6px 10px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          fontWeight: 700,
                          backgroundColor: schedFilter === 'WORK' ? '#1D4ED8' : '#FFFFFF',
                          color: schedFilter === 'WORK' ? '#FFFFFF' : 'var(--text-muted)',
                          border: schedFilter === 'WORK' ? 'none' : '1px solid var(--border)',
                          boxShadow: schedFilter === 'WORK' ? '0 2px 8px rgba(29, 78, 216, 0.25)' : 'none',
                        }}
                      >
                        💼 Có Ca ({workCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setSchedFilter('OFF')}
                        style={{
                          flex: 1,
                          minHeight: '34px',
                          padding: '6px 10px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          fontWeight: 700,
                          backgroundColor: schedFilter === 'OFF' ? '#059669' : '#FFFFFF',
                          color: schedFilter === 'OFF' ? '#FFFFFF' : 'var(--text-muted)',
                          border: schedFilter === 'OFF' ? 'none' : '1px solid var(--border)',
                          boxShadow: schedFilter === 'OFF' ? '0 2px 8px rgba(5, 150, 105, 0.25)' : 'none',
                        }}
                      >
                        🌴 Nghỉ OFF ({offCount})
                      </button>
                    </div>

                    {/* Detailed Day Cards */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {displayedDays.map((d) => {
                        const isToday = d === todayStr;
                        const isMilestone = isProbation && days[0] === d;
                        const offs = (schedRangeLeaves || []).filter((l: any) => toISODate(l.requested_date) === d);
                        const shsRaw = rangeShifts.filter((s: any) => String(s.date || '').slice(0, 10) === d);
                        // Gộp ca trùng cùng shift_code trong ngày (ca DRAFT ma + ca thật):
                        // 1 thẻ duy nhất, điểm danh tính gộp — hết thẻ ma "Thiếu check-out".
                        const shs: any[] = [];
                        {
                          const byCode = new Map<string, any[]>();
                          for (const sh of shsRaw) {
                            const k = String((sh as any).shift_code || '');
                            if (!byCode.has(k)) byCode.set(k, []);
                            byCode.get(k)!.push(sh);
                          }
                          for (const [, group] of byCode) {
                            if (group.length === 1) { shs.push(group[0]); continue; }
                            const hasIn = (s: any) => (myAttendanceHistory || []).some((e: any) => (e as any).assignment_id === s.assignment_id && (e as any).type === 'CHECK_IN');
                            const ranked = [...group].sort((a: any, b: any) => {
                              const ai = hasIn(a) ? 0 : 1;
                              const bi = hasIn(b) ? 0 : 1;
                              if (ai !== bi) return ai - bi;
                              return ((a as any).status === 'PUBLISHED' ? 0 : 1) - ((b as any).status === 'PUBLISHED' ? 0 : 1);
                            });
                            const base = ranked[0];
                            (base as any)._mergedAids = group.map((g: any) => g.assignment_id).filter(Boolean);
                            shs.push(base);
                          }
                          // An the thua "Thieu check-out": the chi co check-in ma gio
                          // check-in trung (<30p) voi 1 the DA DU cap in+out khac cung
                          // ngay thi an (luot diem danh do da tinh o the kia).
                          const inOutOf = (sh: any) => {
                            const aids = [(sh as any).assignment_id, ...((sh as any)._mergedAids || [])].filter(Boolean);
                            const evts = (myAttendanceHistory || []).filter((e: any) => aids.length > 0 ? aids.includes((e as any).assignment_id) : (e as any).assignment_id === sh.assignment_id);
                            const ins = evts.filter((e: any) => (e as any).type === 'CHECK_IN').map((e: any) => new Date((e as any).client_time).getTime()).filter((t: number) => Number.isFinite(t));
                            const outs = evts.filter((e: any) => (e as any).type === 'CHECK_OUT').map((e: any) => new Date((e as any).client_time).getTime()).filter((t: number) => Number.isFinite(t));
                            return { ins, outs };
                          };
                          const doneIns: number[] = [];
                          const ioList = shs.map((sh: any) => ({ sh, ...inOutOf(sh) }));
                          for (const x of ioList) {
                            if (x.ins.length > 0 && x.outs.length > 0) doneIns.push(...x.ins);
                          }
                          const keptShs = ioList.filter((x) => {
                            if (x.ins.length === 0 || x.outs.length > 0) return true;
                            return !x.ins.some((t: number) => doneIns.some((dt: number) => Math.abs(t - dt) < 30 * 60 * 1000));
                          }).map((x: any) => x.sh);
                          shs.length = 0;
                          shs.push(...keptShs);
                        }
                        const isOffDay = offDaysSet.has(d);

                        return (
                          <div
                            key={d}
                            id={`sched-day-${d}`}
                            style={{
                              backgroundColor: '#FFFFFF',
                              borderRadius: '16px',
                              border: isToday ? '2px solid var(--brand)' : '1px solid #EFE4DE',
                              boxShadow: isToday ? '0 6px 20px -2px rgba(232, 93, 146, 0.16)' : '0 2px 8px rgba(39, 49, 66, 0.04)',
                              overflow: 'hidden',
                              transition: 'all 0.18s ease',
                            }}
                          >
                            {/* Day Header */}
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '10px 14px',
                                backgroundColor: isToday ? 'linear-gradient(90deg, #FDF2F8 0%, #FFFFFF 100%)' : '#FAF8F6',
                                borderBottom: isToday ? '1px solid #FBCFE8' : '1px solid #F0E8E3',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '13px', fontWeight: 800, color: isToday ? 'var(--brand)' : 'var(--text)' }}>
                                  {fullDowName(d)} • {fmtD(d)}
                                </span>
                                {isToday && (
                                  <span style={{ fontSize: '10px', fontWeight: 800, color: '#FFFFFF', backgroundColor: 'var(--brand)', padding: '2px 8px', borderRadius: '999px', letterSpacing: '0.4px', boxShadow: '0 2px 6px rgba(232, 93, 146, 0.3)' }}>
                                    HÔM NAY
                                  </span>
                                )}
                                {isMilestone && (
                                  <span style={{ fontSize: '10px', fontWeight: 800, color: '#1E40AF', backgroundColor: '#DBEAFE', padding: '2px 8px', borderRadius: '999px' }}>
                                    MỐC 1
                                  </span>
                                )}
                              </div>

                              <div style={{ fontSize: '11px', fontWeight: 700 }}>
                                {shs.length > 0 ? (
                                  <span style={{ color: '#7C3AED', backgroundColor: '#F3E8FF', padding: '3px 8px', borderRadius: '6px' }}>
                                    {shs.length} Ca làm việc
                                  </span>
                                ) : isOffDay ? (
                                  <span style={{ color: '#065F46', backgroundColor: '#D1FAE5', padding: '3px 8px', borderRadius: '6px' }}>
                                    Nghỉ OFF
                                  </span>
                                ) : (
                                  <span style={{ color: '#94A3B8' }}>Không có ca</span>
                                )}
                              </div>
                            </div>

                            {/* Day Body */}
                            <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              {/* 1. OFF Leaves — chỉ hiện khi ngày không có ca làm (có ca thì chỉ hiện ca) */}
                              {shs.length === 0 && offs.map((l: any, i: number) => (
                                <div
                                  key={`off-${i}`}
                                  style={{
                                    backgroundColor: '#F0FDF4',
                                    border: '1px solid #BBF7D0',
                                    borderLeft: '5px solid #10B981',
                                    borderRadius: '12px',
                                    padding: '10px 12px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '4px',
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 800, color: '#065F46' }}>
                                      <span>🌴</span>
                                      <span>
                                        {l.status === 'APPROVED' || l.leave_type === 'HANG_TUAN' || l.leave_type === 'THU_VIEC'
                                          ? (isProbation ? 'Nghỉ Thử Việc (OFF)' : 'Nghỉ Định Kỳ Tuần (OFF)')
                                          : 'Đơn Nghỉ Phép Chờ Duyệt'}
                                      </span>
                                    </div>
                                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#059669', backgroundColor: '#DCFCE7', padding: '2px 7px', borderRadius: '4px' }}>
                                      {l.leave_type === 'THU_VIEC' ? 'Thử việc' : l.leave_type === 'HANG_TUAN' ? 'Tuần' : 'Đột xuất'}
                                    </span>
                                  </div>
                                  <div style={{ fontSize: '11px', color: '#047857' }}>
                                    {isProbation
                                      ? 'Lịch 5 ngày OFF thử việc đã được ghi nhận • Bạn không cần có mặt tại cửa hàng'
                                      : 'Lịch nghỉ định kỳ đã được duyệt hợp lệ • Bạn không cần có mặt tại cửa hàng'}
                                  </div>
                                </div>
                              ))}

                              {/* 2. Shifts Ticket */}
                              {shs.map((sh: any, si: number) => {
                                const st = shiftStatusOf(sh);
                                const meta = getShiftMeta(sh.shift_code, sh.start_at, sh.end_at);

                                return (
                                  <div
                                    key={`${sh.assignment_id || 'noid'}-${si}`}
                                    style={{
                                      backgroundColor: meta.bg,
                                      border: `1px solid ${meta.border}`,
                                      borderLeft: `5px solid ${meta.accent}`,
                                      borderRadius: '12px',
                                      padding: '11px 12px',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: '8px',
                                      boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
                                    }}
                                  >
                                    {/* Top row: Shift title and time */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '6px' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span style={{ fontSize: '16px' }}>{meta.icon}</span>
                                        <div>
                                          <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text)' }}>
                                            {meta.title}
                                          </div>
                                          <div style={{ fontSize: '11px', color: meta.accent, fontWeight: 700 }}>
                                            {meta.time} {meta.duration ? `(${meta.duration})` : ''}
                                          </div>
                                        </div>
                                      </div>

                                      <span style={{ fontSize: '11px', fontWeight: 800, color: meta.badgeFg, backgroundColor: meta.badgeBg, padding: '3px 8px', borderRadius: '6px' }}>
                                        {sh.shift_code}
                                      </span>
                                    </div>

                                    {/* Branch info */}
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#334155', backgroundColor: '#FFFFFF', padding: '5px 9px', borderRadius: '6px', border: '1px solid #E2E8F0', width: 'fit-content' }}>
                                      <MapPin size={13} color="var(--brand)" />
                                      <span style={{ fontWeight: 600 }}>{getBranchDisplayName(sh.branch_id)}</span>
                                    </div>

                                    {/* Attendance Status Bar */}
                                    <div
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '7px 10px',
                                        borderRadius: '8px',
                                        backgroundColor: st.bg,
                                        color: st.fg,
                                        border: st.bd,
                                        fontSize: '11px',
                                        fontWeight: 700,
                                      }}
                                    >
                                      <span>{st.label}</span>
                                      <span style={{ fontWeight: 500, fontSize: '10.5px', opacity: 0.9 }}>{st.detail}</span>
                                    </div>
                                  </div>
                                );
                              })}

                              {/* 3. Empty Day but is OFF */}
                              {offs.length === 0 && shs.length === 0 && isOffDay && (
                                <div
                                  style={{
                                    backgroundColor: '#F0FDF4',
                                    border: '1px solid #BBF7D0',
                                    borderLeft: '5px solid #10B981',
                                    borderRadius: '12px',
                                    padding: '10px 12px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '4px',
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 800, color: '#065F46' }}>
                                      <span>🌴</span>
                                      <span>{isProbation ? 'Ngày Nghỉ Thử Việc (OFF)' : 'Nghỉ Định Kỳ (OFF)'}</span>
                                    </div>
                                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#059669', backgroundColor: '#DCFCE7', padding: '2px 7px', borderRadius: '4px' }}>
                                      {isProbation ? '5 ngày OFF' : 'Nghỉ tuần'}
                                    </span>
                                  </div>
                                  <div style={{ fontSize: '11px', color: '#047857' }}>
                                    {isProbation
                                      ? 'Ngày nghỉ trong kế hoạch 5 ngày OFF thử việc • Bạn không cần có mặt tại cửa hàng'
                                      : 'Lịch nghỉ định kỳ hợp lệ • Bạn không cần có mặt tại cửa hàng'}
                                  </div>
                                </div>
                              )}

                              {/* 4. Empty Day not marked as OFF */}
                              {offs.length === 0 && shs.length === 0 && !isOffDay && (
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '10px 12px',
                                    backgroundColor: '#FAF8F6',
                                    border: '1px dashed #E5DBD5',
                                    borderRadius: '10px',
                                    color: '#94A3B8',
                                    fontSize: '12px',
                                  }}
                                >
                                  <Coffee size={14} color="#A8A29E" />
                                  <span>{isToday ? 'Không có ca xếp hôm nay • Chúc bạn một ngày nghỉ ngơi vui vẻ!' : 'Không có ca làm việc xếp cho ngày này'}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Quick navigation actions */}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => handleTabClick('leave')}
                        style={{ flex: 1, padding: '10px', fontSize: '12px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                      >
                        <Palmtree size={14} color="#059669" />
                        {isProbation ? 'Đăng Ký OFF Thử Việc' : 'Đăng Ký OFF Tuần'}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => handleTabClick(isProbation ? 'swap_emergency' : 'swap_shift')}
                        style={{ flex: 1, padding: '10px', fontSize: '12px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                      >
                        <RefreshCw size={14} color="var(--brand)" />
                        Yêu Cầu Đổi Ca
                      </button>
                    </div>
                  </div>
                );
              })()}
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
                    /* KHÓA NGOÀI KHUNG GIỜ MỞ CỔNG (T6 09h -> T7 09h) */
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
                        Cổng đăng ký 2 ngày nghỉ OFF chỉ mở từ <strong>09h00 Thứ 6</strong> đến <strong>09h00 Thứ 7</strong> hàng tuần.<br />
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
          const shiftStartHour = todayShift?.shift_code === 'CA_1' ? 7 : todayShift?.shift_code === 'CA_2' ? 12 : todayShift?.shift_code === 'CA_3' ? 18 : undefined;
          const shiftStart = todayShift?.start_at ? new Date(todayShift.start_at).getTime() : 0;
          const openTime = shiftStart ? shiftStart - 30 * 60 * 1000 : 0;
          const isEarly = shiftStart > 0 && Date.now() < openTime;
          const openTimeStr = openTime > 0 ? new Date(openTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) : (shiftStartHour !== undefined ? `${String(shiftStartHour === 7 ? 6 : shiftStartHour - 1).padStart(2, '0')}:30` : '');
          const shiftStartStr = shiftStartHour !== undefined
            ? `${String(shiftStartHour).padStart(2, '0')}:00`
            : (shiftStart > 0 ? new Date(shiftStart).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) : '');

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
                        {todayShift.shift_code} • {todayShift.branch_id || employee?.default_branch_id} ({shiftStartStr} - {todayShift.end_at ? new Date(todayShift.end_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) : (todayShift.shift_code === 'CA_1' ? '12:00' : todayShift.shift_code === 'CA_2' ? '18:00' : todayShift.shift_code === 'CA_3' ? '23:00' : '')})
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
                            {s.shift_code} • {s.date} ({s.start_at ? new Date(s.start_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) : (s.shift_code === 'CA_1' ? '07:00' : s.shift_code === 'CA_2' ? '12:00' : s.shift_code === 'CA_3' ? '18:00' : '')} - {s.end_at ? new Date(s.end_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) : (s.shift_code === 'CA_1' ? '12:00' : s.shift_code === 'CA_2' ? '18:00' : s.shift_code === 'CA_3' ? '23:00' : '')})
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

                  {/* RÀNG BUỘC ĐẶC BIỆT: ÁO HỒNG + BẢNG TÊN (chỉ NV chính thức — thử việc được miễn) */}
                  {!isProbation && (
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
                  )}

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
                <span className="badge badge-brand">Tuần này (T2–CN)</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {(() => {
                  // Ngày Việt Nam (UTC+7) — slice UTC sẽ lệch ngày 00:00–07:00.
                  const vnDay = (iso?: string) => {
                    const t = new Date(iso || '').getTime();
                    if (!Number.isFinite(t)) return '';
                    return new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
                  };
                  const todayVN = vnDay(new Date().toISOString());
                  // 7 ngày T2–CN của tuần hiện tại (luôn hiện đủ tuần)
                  const nowVn = new Date(Date.now() + 7 * 3_600_000);
                  const off = (nowVn.getUTCDay() + 6) % 7;
                  const monDt = new Date(nowVn);
                  monDt.setUTCDate(monDt.getUTCDate() - off);
                  const monStr = monDt.toISOString().slice(0, 10);
                  const weekDays: string[] = [];
                  for (let i = 0; i < 7; i++) {
                    const d = new Date(monDt);
                    d.setUTCDate(d.getUTCDate() + i);
                    weekDays.push(d.toISOString().slice(0, 10));
                  }
                  const fmtT = (t?: string) => t ? new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) : '--:--';
                  const fmtHM = (t?: string) => {
                    const ms = t ? new Date(t).getTime() : NaN;
                    if (!Number.isFinite(ms)) return '';
                    return new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
                  };
                  const shiftNameOf = (code?: string) => code === 'CA_1' ? 'Ca 1' : code === 'CA_2' ? 'Ca 2' : code === 'CA_3' ? 'Ca 3' : (code || 'Ca');
                  const money = (n: number) => Number(n || 0).toLocaleString('vi-VN');
                  const wdName = (iso: string) => {
                    const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
                    return d === 0 ? 'CN' : `T${d + 1}`;
                  };
                  // Gộp ca đầu tuần + ca hiện tại/tương lai, khử trùng
                  const seenAssign = new Set<string>();
                  const allShifts: any[] = [];
                  for (const s of [...(weekPastShifts || []), ...(myShifts || [])]) {
                    const k = (s as any).assignment_id || `${(s as any).date}_${(s as any).shift_code}`;
                    if (seenAssign.has(k)) continue;
                    seenAssign.add(k);
                    allShifts.push(s);
                  }
                  const shiftDays = new Map<string, any[]>();
                  for (const s of allShifts) {
                    const d = String((s as any).date || '').slice(0, 10);
                    if (!d || d < monStr) continue;
                    if (!shiftDays.has(d)) shiftDays.set(d, []);
                    shiftDays.get(d)!.push(s);
                  }
                  const evtDays = new Map<string, any[]>();
                  for (const e of (myAttendanceHistory || [])) {
                    const d = vnDay((e as any).client_time);
                    if (!d || d < monStr) continue;
                    if (!evtDays.has(d)) evtDays.set(d, []);
                    evtDays.get(d)!.push(e);
                  }
                  // Chuẩn bị dữ liệu từng ca + tổng hợp tuần
                  let cDone = 0, cWorking = 0, cMissingOut = 0, cAbsent = 0, cNoCheck = 0, cUpcoming = 0, cCancelled = 0;
                  let fineTotal = 0;
                  const fineTextOf = (ev: any) => {
                    const tier = String(ev?.fine_tier || 'NONE');
                    const amt = Number(ev?.fine_amount) || 0;
                    if (tier === 'NONE' && amt <= 0) return '';
                    if (tier === 'FULL_SHIFT') return `Phạt 100% lương ca${amt > 0 ? ` (${money(amt)}đ)` : ''}`;
                    if (tier === 'HALF_SHIFT') return `Phạt 50% lương ca${amt > 0 ? ` (${money(amt)}đ)` : ''}`;
                    if (tier === 'FLAT_30K' || amt === 30000) return `Phạt ${money(amt || 30000)}đ`;
                    if (amt > 0) return `Phạt ${money(amt)}đ`;
                    return tier !== 'NONE' ? `Phạt (${tier})` : '';
                  };
                  const dayBlocks = weekDays.map((date) => {
                    const [y, m, dd] = date.split('-');
                    const dShifts = (shiftDays.get(date) || []).filter((s: any) => (s as any).status !== 'CANCELLED');
                    const cancelledShifts = (shiftDays.get(date) || []).filter((s: any) => (s as any).status === 'CANCELLED');
                    const evs = evtDays.get(date) || [];
                    // So khớp sự kiện theo ca (chuẩn 2 tab admin + lương): cứng theo
                    // assignment trước; phiếu mồ côi (chưa gắn ca / gắn ca đã hủy
                    // hoặc ca không còn trong ngày sau khi HR xếp lại) bù cho ca
                    // thiếu — phiếu gắn ca live khác thì giữ nguyên (không cướp,
                    // tránh lan ca sáng sang chiều). VẮNG chỉ tính khi gắn cứng.
                    const usedEvIds = new Set<string>();
                    const liveIds = new Set((dShifts || []).map((x: any) => String((x as any)?.assignment_id || '')).filter(Boolean));
                    const deadIds = new Set((cancelledShifts || []).map((x: any) => String((x as any)?.assignment_id || '')).filter(Boolean));
                    const matchEv = (sh: any, type: string) => {
                      const aid = String((sh as any)?.assignment_id || '');
                      const byAssign = evs.find((e: any) => e.type === type && (e as any).assignment_id && aid && (e as any).assignment_id === aid);
                      if (byAssign) return byAssign;
                      if (type === 'ABSENT') return undefined;
                      return evs.find((e: any) => {
                        if (e.type !== type) return false;
                        const eid = String((e as any)?.event_id || '');
                        if (eid && usedEvIds.has(eid)) return false;
                        const ea = String((e as any).assignment_id || '');
                        const ok = !ea || deadIds.has(ea) || !liveIds.has(ea);
                        if (ok && eid) usedEvIds.add(eid);
                        return ok;
                      });
                    };
                    const rows = dShifts.map((sh: any) => {
                      const ci = matchEv(sh, 'CHECK_IN');
                      const co = matchEv(sh, 'CHECK_OUT');
                      const ab = matchEv(sh, 'ABSENT');
                      const startMs = (sh as any).start_at ? new Date((sh as any).start_at).getTime() : NaN;
                      const endMs = (sh as any).end_at ? new Date((sh as any).end_at).getTime() : NaN;
                      const isPastDay = date < todayVN;
                      const isToday = date === todayVN;
                      const locked = !ci && Number.isFinite(startMs) && Date.now() - (startMs as number) > 3 * 60 * 60 * 1000;
                      const pastEnd = Number.isFinite(endMs) && Date.now() - (endMs as number) > 30 * 60 * 1000;
                      const lateMin = ci?.is_late ? Number(ci.minutes_deviation) || 0 : 0;
                      const earlyMin = co?.is_early ? Number(co.minutes_deviation) || 0 : 0;
                      const fine = ci ? fineTextOf(ci) : '';
                      if (fine) { fineTotal += Number(ci?.fine_amount) || 0; }
                      const ciDist = Number(ci?.distance_meters);
                      const gpsBad = !!ci && ((ci as any)?.gps_status === 'OUT_OF_BOUNDS' || (Number.isFinite(ciDist) && ciDist > 300));
                      let badge: string, bg: string, fg: string, border: string;
                      if (ci && co) {
                        cDone++;
                        badge = '✓ Đủ công'; bg = '#ECFDF5'; fg = '#047857'; border = '1px solid #A7F3D0';
                      } else if (ci && !co && (pastEnd || isPastDay)) {
                        cMissingOut++;
                        badge = 'Thiếu check-out — không lương'; bg = '#FFF7ED'; fg = '#9A3412'; border = '1px solid #FDBA74';
                      } else if (ci && !co) {
                        cWorking++;
                        badge = 'Đang làm (chờ check-out)'; bg = '#FFFBEB'; fg = '#92400E'; border = '1px solid #FCD34D';
                      } else if (ab) {
                        cAbsent++;
                        badge = '🔴 Vắng — không lương'; bg = '#FEE2E2'; fg = '#991B1B'; border = '1px solid #FCA5A5';
                      } else if (locked || isPastDay) {
                        cNoCheck++;
                        badge = 'Không điểm danh — nghỉ không lương'; bg = '#FEE2E2'; fg = '#991B1B'; border = '1px solid #FCA5A5';
                      } else if (isToday) {
                        cUpcoming++;
                        badge = 'Chưa check-in (Chờ ca)'; bg = '#FFFBEB'; fg = '#92400E'; border = '1px solid #FCD34D';
                      } else {
                        cUpcoming++;
                        badge = 'Lịch đã duyệt'; bg = '#EEF2FF'; fg = '#3730A3'; border = '1px solid #C7D2FE';
                      }
                      const sched = `${fmtHM((sh as any).start_at)}${(sh as any).end_at ? `–${fmtHM((sh as any).end_at)}` : ''}`;
                      const notes: string[] = [];
                      if (lateMin > 0) notes.push(`Trễ ${lateMin}p`);
                      if (earlyMin > 0) notes.push(`Về sớm ${earlyMin}p`);
                      if (fine) notes.push(fine);
                      if (gpsBad) notes.push(`GPS vượt ${ciDist}m (quá 300m)`);
                      if (ab && !ci) notes.push('Hệ thống tự ghi vắng');
                      return { sh, ci, co, badge, bg, fg, border, sched, notes };
                    });
                    // Sự kiện lẻ không ca nào nhận (điểm danh ngoài lịch). Vắng mồ côi
                    // (không gắn cứng ca nào) thì ẩn — VẮNG chỉ tính khi gắn cứng.
                    // (Dùng ID đã claim, không gọi lại matchEv — gọi lại sẽ loại
                    // phiếu vừa nhận vì usedEvIds, khiến phiếu hiện 2 lần.)
                    const claimedEvIds = new Set<string>([...usedEvIds]);
                    for (const s of dShifts) {
                      for (const t of ['CHECK_IN', 'CHECK_OUT', 'ABSENT']) {
                        const aid = String((s as any)?.assignment_id || '');
                        if (!aid) continue;
                        const f = evs.find((e: any) => e.type === t && String((e as any).assignment_id || '') === aid);
                        if (f && (f as any).event_id) claimedEvIds.add(String((f as any).event_id));
                      }
                    }
                    const orphans = evs.filter((e: any) => {
                      if ((e as any).type === 'ABSENT') return false;
                      const id = String((e as any)?.event_id || '');
                      if (id && claimedEvIds.has(id)) return false;
                      if (!id) return !dShifts.some((sh: any) => matchEv(sh, (e as any).type) === e);
                      return true;
                    });
                    for (const c of cancelledShifts) cCancelled++;
                    return { date, y, m, dd, rows, orphans, cancelledShifts };
                  });
                  const sumBox = (label: string, val: string, color: string) => (
                    <div style={{ flex: 1, minWidth: '70px', backgroundColor: '#FAFAFA', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 4px', textAlign: 'center' }}>
                      <div style={{ fontSize: '15px', fontWeight: 800, color }}>{val}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{label}</div>
                    </div>
                  );
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {sumBox('Đủ công', String(cDone), '#047857')}
                        {sumBox('Đang làm', String(cWorking), '#92400E')}
                        {sumBox('Thiếu check-out', String(cMissingOut), '#9A3412')}
                        {sumBox('Vắng / Không điểm danh', String(cAbsent + cNoCheck), '#991B1B')}
                        {sumBox('Tổng phạt tuần', fineTotal > 0 ? `${money(fineTotal)}đ` : '0đ', '#991B1B')}
                      </div>
                      {dayBlocks.map((blk: any) => (
                        <div key={blk.date} style={{ padding: '10px 12px', backgroundColor: blk.date === todayVN ? '#FFFBEB' : '#FAFAFA', borderRadius: 'var(--radius-sm)', border: blk.date === todayVN ? '1.5px solid #F59E0B' : '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ fontWeight: 800, fontSize: '13px' }}>{wdName(blk.date)} • {blk.dd}/{blk.m}/{blk.y}{blk.date === todayVN ? ' (hôm nay)' : ''}</div>
                          {blk.rows.map((r: any, i: number) => (
                            <div key={(r.sh as any)?.assignment_id || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', paddingTop: i > 0 ? '8px' : 0, borderTop: i > 0 ? '1px dashed var(--border)' : 'none' }}>
                              <div>
                                <div style={{ fontWeight: 700, fontSize: '12px' }}>{shiftNameOf((r.sh as any)?.shift_code)}{r.sched ? ` (${r.sched})` : ''}</div>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Vào: {fmtT(r.ci?.client_time)} • Ra: {fmtT(r.co?.client_time)}</div>
                                {r.notes.length > 0 && (
                                  <div style={{ fontSize: '11px', marginTop: '2px', color: r.notes.some((n: string) => /Phạt|GPS vượt|không lương/i.test(n)) ? '#991B1B' : 'var(--text-muted)', fontWeight: 600 }}>
                                    {r.notes.join(' • ')}
                                  </div>
                                )}
                              </div>
                              <span style={{ fontSize: '11px', fontWeight: 700, padding: '4px 8px', borderRadius: '999px', backgroundColor: r.bg, color: r.fg, border: r.border, whiteSpace: 'nowrap' }}>
                                {r.badge}
                              </span>
                            </div>
                          ))}
                          {blk.cancelledShifts.map((s: any, i: number) => (
                            <div key={`cx_${(s as any)?.assignment_id || i}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{shiftNameOf((s as any)?.shift_code)} — ca đã hủy</div>
                              <span style={{ fontSize: '11px', fontWeight: 700, padding: '4px 8px', borderRadius: '999px', backgroundColor: '#F1F5F9', color: '#64748B', border: '1px solid #CBD5E1', whiteSpace: 'nowrap' }}>Ca hủy</span>
                            </div>
                          ))}
                          {blk.orphans.map((e: any) => (
                            <div key={(e as any)?.event_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Điểm danh ngoài lịch: {(e as any).type === 'CHECK_IN' ? 'Vào' : 'Ra'} {fmtT((e as any)?.client_time)}</div>
                              <span style={{ fontSize: '11px', fontWeight: 700, padding: '4px 8px', borderRadius: '999px', backgroundColor: '#EEF2FF', color: '#3730A3', border: '1px solid #C7D2FE', whiteSpace: 'nowrap' }}>Ngoài lịch</span>
                            </div>
                          ))}
                          {blk.rows.length === 0 && blk.cancelledShifts.length === 0 && blk.orphans.length === 0 && (
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Chưa có ca — ngày nghỉ</div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
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
                style={{ color: '#C2410C', borderColor: '#FED7AA', width: '100%', fontWeight: 700, opacity: actionBusy ? 0.6 : 1 }}
                disabled={!!actionBusy}
                onClick={handleEmergencyLeaveSubmit}
              >
                {actionBusy ? '⏳ ĐANG GỬI...' : 'Gửi Báo Nghỉ Khẩn Cấp (Đồng Bộ Realtime HR)'}
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
                    const isSupport = (s as any).swap_kind === 'HR_SUPPORT';
                    const supShiftLabel = (c?: string) => c === 'CA_1' ? 'Ca 1 (07-12)' : c === 'CA_2' ? 'Ca 2 (12-18)' : c === 'CA_3' ? 'Ca 3 (18-23)' : (c || '');
                    return (
                    <div key={s.swap_id} style={{ backgroundColor: '#FFF', borderRadius: '8px', padding: '10px', fontSize: '12px', border: isSupport ? '1.5px solid #2563EB' : undefined }}>
                      {isSupport ? (
                        <div>🆘 <strong>HR điều bạn làm thay tại {s.support_branch_id || ''}</strong> — {supShiftLabel(s.support_shift_code)} ngày {String(s.support_date || '').slice(0, 10)}</div>
                      ) : (
                        <div><strong>{reqName}</strong> muốn tráo đổi ca với bạn</div>
                      )}
                      <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>Lý do: {s.reason || '—'}</div>
                      {isSupport && (
                        <div style={{ color: '#1D4ED8', fontWeight: 700, marginTop: '2px' }}>Đồng ý là ca chuyển sang bạn ngay — từ chối thì ca ở nguyên với chủ cũ.</div>
                      )}
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
            {mySwaps.some((s: any) => (s.swap_kind || 'EMPLOYEE_SWAP') === 'HR_DISPATCH' && s.status === 'PENDING_PARTNER' && !s.target_employee_id && !hiddenDispatchIds.includes(s.swap_id)) && (
              <div className="card" style={{ border: '2px solid #2563EB', backgroundColor: '#EFF6FF' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 800, color: '#1E40AF' }}>🚀 Ca cần người làm thay (+30.000đ/ca)</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                  {mySwaps.filter((s: any) => (s.swap_kind || 'EMPLOYEE_SWAP') === 'HR_DISPATCH' && s.status === 'PENDING_PARTNER' && !s.target_employee_id && !hiddenDispatchIds.includes(s.swap_id)).map((s: any) => (
                    <div key={s.swap_id} style={{ backgroundColor: '#FFF', borderRadius: '8px', padding: '10px', fontSize: '12px' }}>
                      <div><strong>{s.shift?.date || ''} • {s.shift?.shift_code || ''}</strong> — {s.reason || 'Cần người làm thay'}</div>
                      <div style={{ color: '#059669', fontWeight: 700, marginTop: '2px' }}>Nhận ca được +30.000đ phụ cấp (HR điều phối)</div>
                      <button className="btn-primary" style={{ width: '100%', marginTop: '8px', padding: '9px', backgroundColor: '#2563EB' }} disabled={actionBusy === 'respond'} onClick={() => handleRespondSwap(s.swap_id, true)}>Nhận ca này</button>
                      <button className="btn-secondary" style={{ width: '100%', marginTop: '6px', padding: '7px', fontSize: '12px' }} onClick={() => setHiddenDispatchIds(prev => prev.includes(s.swap_id) ? prev : [...prev, s.swap_id])}>Ẩn (không nhận)</button>
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
                        {s.status === 'APPROVED' ? 'Đã duyệt' : s.status === 'REJECTED' ? 'Từ chối' : s.status === 'PARTNER_ACCEPTED' ? 'Chờ Store duyệt' : s.status === 'CANCELLED' ? 'Đã hủy' : 'Chờ NV B'}
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
                    📌 <strong>Đặc điểm:</strong> Cùng chi nhánh ({employee?.default_branch_id || 'CN130'}). Đổi ca <strong>từ tuần hiện tại trở đi</strong> ({swapWeekRange().mon} → …) <strong>khi tuần đó đã được HR publish</strong> — ca nháp/chưa publish và ca tuần đã qua hệ thống đều từ chối.
                    {swapDraftCount(myShifts) > 0 && swapReadyShifts(myShifts).length > 0 && (
                      <><br />⚠️ Bạn có {swapDraftCount(myShifts)} ca tuần này chưa publish — báo HR publish để đổi được.</>
                    )}
                    {myShifts.some((s: any) => inSwapWeek(s.date)) && swapReadyShifts(myShifts).length === 0 && (
                      <><br />⛔ Tuần này bạn có ca nhưng <strong>HR chưa publish ca nào</strong> nên ô chọn ca trống là đúng — báo HR publish lịch rồi mở lại tab này.</>
                    )}
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Ca làm của bạn (Nhân viên A — chỉ ca đã publish):</label>
                    <select
                      value={swapData.myShift}
                      onChange={(e) => setSwapData({ ...swapData, myShift: e.target.value })}
                      style={{ width: '100%' }}
                    >
                      <option value="">-- Chọn ca thật của bạn --</option>
                      {(() => {
                        const ready = swapReadyShifts(myShifts);
                        if (ready.length > 0) {
                          return ready.map((s: any, idx: number) => (
                            <option key={idx} value={s.assignment_id}>
                              {s.date} ({s.shift_code})
                            </option>
                          ));
                        }
                        const hasAny = (myShifts || []).some((s: any) => inSwapWeek(s.date));
                        return (
                          <option value="">
                            {hasAny
                              ? 'Chưa có ca publish nào — HR chưa publish lịch (báo HR publish)'
                              : 'Chưa có lịch từ tuần hiện tại trở đi — báo HR xếp lịch & publish'}
                          </option>
                        );
                      })()}
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
                      <option value="">-- Chọn ca thật của B (tuần hiện tại trở đi) --</option>
                      {targetShiftsLoading && (
                        <option value="">⏳ Đang tải lịch của B...</option>
                      )}
                      {!targetShiftsLoading && swapData.targetEmployeeId && targetShifts.filter((s: any) => inSwapWeek(s.date)).length === 0 && (
                        <option value="">B chưa có ca publish nào từ tuần hiện tại trở đi — báo HR publish lịch cho B</option>
                      )}
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
                    📌 <strong>Đặc điểm:</strong> Nhân viên B nhận làm thay ca cho A (B làm 2 ca/ngày). Chỉ nhờ ca <strong>từ tuần hiện tại trở đi</strong> ({swapWeekRange().mon} → …) <strong>khi tuần đó đã được HR publish</strong> — ca tuần đã qua hệ thống từ chối.<br />
                    ⚠️ Tự thỏa thuận với nhau thì <strong>không</strong> có phụ cấp — chỉ ca do <strong>HR điều phối</strong> (mục trên) mới +30.000đ.
                    {swapDraftCount(myShifts) > 0 && swapReadyShifts(myShifts).length > 0 && (
                      <><br />⚠️ Bạn có {swapDraftCount(myShifts)} ca tuần này chưa publish — báo HR publish để nhờ được.</>
                    )}
                    {myShifts.some((s: any) => inSwapWeek(s.date)) && swapReadyShifts(myShifts).length === 0 && (
                      <><br />⛔ Tuần này bạn có ca nhưng <strong>HR chưa publish ca nào</strong> nên ô chọn ca trống là đúng — báo HR publish lịch rồi mở lại tab này.</>
                    )}
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Ca của bạn cần nhờ người làm thay (chỉ ca đã publish):</label>
                    <select
                      value={swapData.myShift}
                      onChange={(e) => setSwapData({ ...swapData, myShift: e.target.value })}
                      style={{ width: '100%' }}
                    >
                      <option value="">-- Chọn ca của bạn (tuần hiện tại trở đi) --</option>
                      {(() => {
                        const ready = swapReadyShifts(myShifts);
                        if (ready.length > 0) {
                          return ready.map((s: any, idx: number) => (
                            <option key={s.assignment_id || idx} value={s.assignment_id}>
                              {s.date} ({s.shift_code})
                            </option>
                          ));
                        }
                        const hasAny = (myShifts || []).some((s: any) => inSwapWeek(s.date));
                        return (
                          <option value="">
                            {hasAny
                              ? 'Chưa có ca publish nào — HR chưa publish lịch (báo HR publish)'
                              : 'Chưa có lịch từ tuần hiện tại trở đi — báo HR xếp lịch & publish'}
                          </option>
                        );
                      })()}
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
                      // Chặn bấm đúp / double-tap (guard đồng bộ, disabled async không kịp).
                      if (swapBusyRef.current || actionBusy === 'swap') return;
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
                      {
                        const mySh = (myShifts || []).find((s: any) => s.assignment_id === swapData.myShift);
                        if (mySh && !isSwapReadyShift(mySh)) {
                          showToast(swapNotReadyMsg('Ca của bạn'));
                          return;
                        }
                      }
                      setActionBusy('swap');
                      swapBusyRef.current = true;
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
                        showToast(sid ? `✓ Đã gửi yêu cầu nhờ làm thay! Mã đơn: ${sid}. B đồng ý là ca chuyển ngay.` : '✓ Đã gửi yêu cầu nhờ làm thay! Mở danh sách phiếu để kiểm tra trạng thái.');
                        setSwapData({ myShift: '', targetEmployeeId: '', targetEmployeeName: '', targetShift: '', reason: '' });
                        setTargetShifts([]);
                        await loadEmployeeData(employee?.employee_id);
                        await fetchMySwaps();
                      } catch (err: any) {
                        showToast(err.message || 'Lỗi khi gửi yêu cầu!');
                      } finally {
                        swapBusyRef.current = false;
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
                {isProbation ? '7. Giải Trình & Bổ Sung Công' : '7. Bổ Sung Công'}
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
                Gửi giải trình khi quên check-in/out hoặc báo nghỉ đột xuất (đồng bộ trực tiếp sang HR Tab 10 và Google Sheets). Nhân viên chính thức chỉ được <strong>1 phiếu/tuần</strong> (duyệt hoặc đang chờ đều tính đã dùng; bị từ chối/hết hạn được gửi lại). Phiếu gửi HR quá <strong>30 phút</strong> chưa duyệt thì hệ thống <strong>tự động từ chối</strong> (giữ phiếu để đối soát, tự xóa sau 7 ngày nữa).
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
                  const dayShifts = (adjDayShifts || []).filter((s: any) => String(s.date || '').slice(0, 10) === adjustmentData.date);
                  if (adjDayLoading) {
                    return <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>⏳ Đang tải ca ngày {adjustmentData.date}...</div>;
                  }
                  if (dayShifts.length === 0) {
                    return (
                      <div style={{ fontSize: '12px', color: '#92400E', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', padding: '8px 12px' }}>
                        ⚠️ Ngày {adjustmentData.date} chưa có ca nào được xếp — kiểm tra lại ngày hoặc liên hệ HR. Hệ thống chặn gửi để khỏi duyệt nhầm ngày khác.
                      </div>
                    );
                  }
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
                            {s.shift_code} ({s.start_at ? new Date(s.start_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) : (s.shift_code === 'CA_1' ? '07:00' : s.shift_code === 'CA_2' ? '12:00' : s.shift_code === 'CA_3' ? '18:00' : '')} - {s.end_at ? new Date(s.end_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) : (s.shift_code === 'CA_1' ? '12:00' : s.shift_code === 'CA_2' ? '18:00' : s.shift_code === 'CA_3' ? '23:00' : '')})
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
                    onChange={(e) => {
                      setAdjustmentData({ ...adjustmentData, type: e.target.value });
                      // Báo nghỉ khẩn đi luồng đơn nghỉ (không kèm ảnh) -> bỏ ảnh đã chọn nếu có.
                      if (e.target.value === 'NGHI_KHAN') setEvidencePhoto(null);
                    }}
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

                {adjustmentData.type !== 'NGHI_KHAN' && (
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
                      📷 Ảnh bằng chứng <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(không bắt buộc — chọn ảnh có sẵn trong thư viện để HR duyệt nhanh)</span>:
                    </label>
                    <input
                      ref={evidenceInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => { handleEvidenceSelected(e.target.files?.[0]); e.target.value = ''; }}
                    />
                    {evidencePhoto ? (
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', border: '1.5px solid #86EFAC', backgroundColor: '#F0FDF4', borderRadius: '8px', padding: '8px' }}>
                        <img src={evidencePhoto} alt="Ảnh bằng chứng" style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--border)' }} />
                        <div style={{ flex: 1, fontSize: '12px', color: '#166534', fontWeight: 700 }}>✓ Đã đính kèm ảnh — sẽ gửi cùng phiếu.</div>
                        <button
                          className="btn-secondary"
                          style={{ fontSize: '11px', padding: '5px 10px', color: '#DC2626' }}
                          onClick={() => setEvidencePhoto(null)}
                        >
                          🗑 Xóa ảnh
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn-secondary"
                        style={{ width: '100%', padding: '12px', fontSize: '13px', fontWeight: 700, border: '2px dashed var(--brand)', backgroundColor: '#FDF2F8' }}
                        disabled={evidenceBusy}
                        onClick={() => evidenceInputRef.current?.click()}
                      >
                        {evidenceBusy ? '⏳ Đang xử lý ảnh...' : '🖼️ Chọn ảnh bằng chứng từ thư viện'}
                      </button>
                    )}
                  </div>
                )}

                <button
                  className="btn-primary"
                  disabled={actionBusy === 'adj-submit'}
                  onClick={handleAdjustmentSubmit}
                  style={{ opacity: actionBusy === 'adj-submit' ? 0.6 : 1 }}
                >
                  {actionBusy === 'adj-submit' ? '⏳ ĐANG GỬI...' : (adjustmentData.type === 'NGHI_KHAN' ? 'Gửi Báo Nghỉ Khẩn Cấp Đến HR' : 'Gửi Phiếu Bổ Sung Công')}
                </button>
              </div>
            </div>
                {/* PHIẾU CỦA TÔI — trạng thái realtime (quá 30 phút HR chưa duyệt -> tự từ chối) */}
            {myAdjustments.length > 0 && (
              <div className="card">
                <h3 style={{ fontSize: '14px', fontWeight: 800, marginBottom: '8px' }}>
                  Phiếu của tôi ({myAdjustments.length})
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {myAdjustments.map((a: any) => {
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
                            {a.status === 'APPROVED' ? 'Đã duyệt' : auto ? 'Tự động từ chối (quá 30 phút)' : a.status === 'REJECTED' ? 'Bị từ chối' : 'Chờ duyệt'}
                          </span>
                        </div>
                        {a.evidence_drive_id && (
                          <div style={{ marginTop: '6px' }}>
                            <MyAdjPhoto adjustmentId={a.adjustment_id} />
                          </div>
                        )}
                        {a.status === 'PENDING' && (
                          <button
                            className="btn-secondary"
                            style={{ marginTop: '6px', fontSize: '11px', padding: '5px 10px', color: '#DC2626' }}
                            disabled={actionBusy === `cancel-${a.adjustment_id}`}
                            onClick={async () => {
                              if (!window.confirm('Hủy phiếu này? Phiếu sẽ bị XÓA KHỎI hệ thống (không khôi phục).')) return;
                              if (actionBusy) return;
                              setActionBusy(`cancel-${a.adjustment_id}`);
                              try {
                                await apiRequest(`/attendance/adjustments/${a.adjustment_id}`, { method: 'DELETE' });
                                showToast('Đã hủy và xóa phiếu khỏi hệ thống!');
                                await fetchMyAdjustments();
                              } catch (e: any) {
                                showToast(e?.message || 'Lỗi khi hủy phiếu!');
                              } finally {
                                setActionBusy(null);
                              }
                            }}
                          >
                            {actionBusy === `cancel-${a.adjustment_id}` ? '⏳ Đang hủy...' : '🗑 Hủy phiếu (xóa khỏi hệ thống)'}
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
                <button className="btn-secondary" style={{ fontSize: '11px', padding: '4px 10px' }} disabled={actionBusy === 'tests'} onClick={() => { if (actionBusy) return; setActionBusy('tests'); fetchMyTests().finally(() => setActionBusy(null)); }}>{actionBusy === 'tests' ? '⏳...' : 'Tải lại'}</button>
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
                              disabled={testSubmitBusy}
                              onClick={async () => {
                                if (testAnswers.some(a => a < 0)) {
                                  if (!window.confirm('Còn câu chưa chọn đáp án. Vẫn nộp bài?')) return;
                                }
                                await submitActiveTest(false);
                              }}
                              style={{ opacity: testSubmitBusy ? 0.6 : 1 }}
                            >
                              {testSubmitBusy ? '⏳ ĐANG NỘP...' : 'Nộp bài'}
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
                    const canGo = ['/schedule', '/home', '/attendance', '/leave', '/test_exam', '/test_training', '/adjustment'].includes(goTab);
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
                        else if (goTab === '/adjustment') setActiveTab(isProbation ? 'adjustment' : 'emergency_adjust');
                        else if (canGo) {
                          // Thông báo phát hành lịch tuần → mở tab Lịch đúng tuần sau vừa publish.
                          if ((n as any)?.type === 'schedule.published') { schedWeekTouched.current = true; setSchedWeekSel('NEXT'); }
                          setActiveTab(goTab.slice(1));
                        }
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
                  <button className="btn-primary" onClick={handleUnlockPayslip} disabled={actionBusy === 'payslip'}>
                    {actionBusy === 'payslip' ? '⏳ Đang tải...' : 'Xem Phiếu Lương Của Tôi'}
                  </button>
                </div>
              ) : payslips.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '16px 0', fontSize: '13px', color: 'var(--text-muted)' }}>
                  Chưa có phiếu lương nào được phát hành cho bạn trong kỳ này.
                  <div>
                    <button className="btn-secondary" onClick={() => handleUnlockPayslip()} disabled={actionBusy === 'payslip'} style={{ fontSize: '12px', marginTop: '10px' }}>
                      {actionBusy === 'payslip' ? '⏳ Đang tải...' : 'Tải Lại'}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {payslips.map((slip: any, idx: number) => {
                    const vnd = (n: any) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;
                    const row = (k: string, v: string, bold = false, color?: string) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', margin: '4px 0', fontWeight: bold ? 800 : 400, color: color || 'var(--text)' }}>
                        <span>{k}</span>
                        <strong>{v}</strong>
                      </div>
                    );
                    const tongCong = slip.tong_cong ?? ((slip.luong_cb || 0) + (slip.phu_cap_ot ?? slip.allowance ?? 0) + (slip.standard_pay || 0) + (slip.ot_extra || 0) + (slip.bonus || 0));
                    const netPayVal = slip.thuc_lanh ?? slip.net_pay ?? 0;
                    const st = slip.status || 'DRAFT';
                    return (
                      <div key={slip.item_id || slip.run_id || idx} style={{ backgroundColor: '#FFFBF9', padding: '16px', borderRadius: '12px', border: '1.5px solid #F59E0B', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                          <div style={{ fontWeight: 800, fontSize: '15px', color: 'var(--brand)' }}>
                            💰 PHIẾU LƯƠNG {slip.period ? `KỲ ${String(slip.period).slice(5, 7)}/${String(slip.period).slice(0, 4)}` : (slip.title || '')}
                          </div>
                          <div>
                            {st === 'PUBLISHED' && (
                              <span style={{ fontSize: '11px', fontWeight: 800, padding: '3px 10px', borderRadius: '999px', backgroundColor: '#FEF3C7', color: '#B45309', border: '1px solid #FDE68A' }}>
                                🔔 Chờ bạn kiểm tra & ký nhận
                              </span>
                            )}
                            {st === 'CONFIRMED' && (
                              <span style={{ fontSize: '11px', fontWeight: 800, padding: '3px 10px', borderRadius: '999px', backgroundColor: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }}>
                                ✍️ Đã ký xác nhận (3/3 chữ ký) • Chờ chuyển khoản
                              </span>
                            )}
                            {st === 'PAID' && (
                              <span style={{ fontSize: '11px', fontWeight: 800, padding: '3px 10px', borderRadius: '999px', backgroundColor: '#ECFDF5', color: '#047857', border: '1px solid #A7F3D0' }}>
                                🎉 Đã thanh toán (Hoàn thành)
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Breakdown */}
                        <div style={{ backgroundColor: '#FFF', padding: '12px', borderRadius: '8px', border: '1px solid #FDE68A' }}>
                          {row(`Công: ${slip.standard_hours || 0} giờ (${slip.total_shifts ?? 0} ca${Number(slip.absent_shifts) > 0 ? `, vắng ${slip.absent_shifts}` : ''}) × ${vnd(slip.rate_snapshot).replace('đ', '')}/h`, vnd(slip.standard_pay))}
                          {Number(slip.luong_cb) > 0 && row('Lương cơ bản', vnd(slip.luong_cb))}
                          {row(`Phụ cấp OT${slip.ot_slots ? ` (${slip.ot_slots} suất)` : ''}`, vnd(slip.phu_cap_ot ?? slip.allowance))}
                          {Number(slip.ot_extra) > 0 && row('OT thêm', vnd(slip.ot_extra))}
                          {Number(slip.bonus) > 0 && row('Thưởng/Bonus', `+${vnd(slip.bonus)}`)}
                          {row('TỔNG CỘNG THU NHẬP', vnd(tongCong), true)}
                          {(Number(slip.tru_kpi) > 0 || Number(slip.deduction) > 0) && row(`Trừ KPI + phạt (${vnd(slip.tru_kpi)} + ${vnd(slip.deduction)})`, `−${vnd((slip.tru_kpi || 0) + (slip.deduction || 0))}`)}
                          {Number(slip.ung_luong) > 0 && row('Ứng lương', `−${vnd(slip.ung_luong)}`)}
                          {Number(slip.dong_phuc) > 0 && row('Trừ đồng phục', `−${vnd(slip.dong_phuc)}`)}
                          <div style={{ borderTop: '2px solid #F59E0B', paddingTop: '8px', marginTop: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: 900, color: '#059669' }}>
                            <span>THỰC LÃNH:</span>
                            <span>{vnd(netPayVal)}</span>
                          </div>
                        </div>

                        {/* Mục kiểm tra tiền thực lãnh & Ký tên */}
                        {st === 'PUBLISHED' && (
                          <div style={{ backgroundColor: '#FFFBEB', border: '1.5px solid #F59E0B', borderRadius: '10px', padding: '14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                              <span style={{ fontSize: '18px' }}>🔍</span>
                              <strong style={{ fontSize: '14px', color: '#92400E' }}>XÁC NHẬN SỐ TIỀN THỰC LÃNH: {vnd(netPayVal)}</strong>
                            </div>
                            <p style={{ fontSize: '12px', color: '#78350F', margin: '0 0 12px', lineHeight: 1.5 }}>
                              Bạn vui lòng kiểm tra lại thật kỹ số giờ công, phụ cấp, thưởng và số tiền <strong>thực lãnh</strong> ở trên.
                              Nếu tất cả đều đúng, vui lòng vẽ chữ ký của bạn vào khung bên dưới và bấm nút <strong>Xác Nhận & Ký Tên</strong> để gửi về cho Kế toán chuẩn bị chuyển khoản.
                            </p>

                            <SignaturePad
                              label="✍️ Chữ ký Người nhận tiền (Nhân viên)"
                              value={null}
                              signerName={employee?.full_name || ''}
                              disabled={confirmSlipBusy === slip.item_id}
                              onSave={async (img, signerName) => {
                                await handleConfirmPayslip(slip.item_id, img, signerName);
                              }}
                              onClear={() => {}}
                            />
                            {confirmSlipBusy === slip.item_id && (
                              <div style={{ textAlign: 'center', fontSize: '12px', color: '#B45309', marginTop: '8px', fontWeight: 700 }}>
                                ⏳ Đang gửi xác nhận và thông báo đến Kế toán...
                              </div>
                            )}
                          </div>
                        )}

                        {st === 'CONFIRMED' && (
                          <div style={{ backgroundColor: '#EFF6FF', border: '1.5px solid #3B82F6', borderRadius: '10px', padding: '14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                              <span style={{ fontSize: '18px' }}>✅</span>
                              <strong style={{ fontSize: '14px', color: '#1D4ED8' }}>ĐÃ XÁC NHẬN ĐỦ 3 CHỮ KÝ — CHỜ CHUYỂN KHOẢN</strong>
                            </div>
                            <p style={{ fontSize: '12px', color: '#1E40AF', margin: 0, lineHeight: 1.5 }}>
                              Bạn đã xác nhận đúng số tiền thực lãnh <strong>{vnd(netPayVal)}</strong>.
                              Hệ thống đã thông báo đến Kế toán để quét mã QR ngân hàng chuyển khoản vào tài khoản của bạn.
                            </p>
                            {slip.sign_nhanvien?.img && (
                              <div style={{ marginTop: '10px', textAlign: 'center' }}>
                                <img src={slip.sign_nhanvien.img} alt="Chữ ký của bạn" style={{ maxHeight: '70px', maxWidth: '200px', backgroundColor: '#FFF', border: '1px dashed #93C5FD', borderRadius: '6px', padding: '4px' }} />
                                <div style={{ fontSize: '11px', color: '#64748B', marginTop: '4px' }}>{slip.sign_nhanvien.name || employee?.full_name} • Ký lúc {slip.sign_nhanvien.at ? new Date(slip.sign_nhanvien.at).toLocaleString('vi-VN') : 'Vừa xong'}</div>
                              </div>
                            )}
                          </div>
                        )}

                        {st === 'PAID' && (
                          <div style={{ backgroundColor: '#ECFDF5', border: '1.5px solid #10B981', borderRadius: '10px', padding: '14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                              <span style={{ fontSize: '18px' }}>🎉</span>
                              <strong style={{ fontSize: '14px', color: '#065F46' }}>ĐÃ HOÀN THÀNH — ĐÃ CHUYỂN KHOẢN LƯƠNG</strong>
                            </div>
                            <p style={{ fontSize: '12px', color: '#047857', margin: 0, lineHeight: 1.5 }}>
                              Kế toán đã hoàn tất chuyển khoản số tiền <strong>{vnd(netPayVal)}</strong> vào tài khoản ngân hàng của bạn.
                              {slip.slip_paid_at && ` (Thời gian xác nhận: ${new Date(slip.slip_paid_at).toLocaleString('vi-VN')})`}
                            </p>
                          </div>
                        )}

                        {/* 3 Chữ ký điện tử đối soát */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', borderTop: '1px dashed #CBD5E1', paddingTop: '10px', marginTop: '4px' }}>
                          <div style={{ textAlign: 'center', fontSize: '11px', padding: '8px', backgroundColor: '#F8FAFC', borderRadius: '8px' }}>
                            <div style={{ fontWeight: 700, color: '#475569', marginBottom: '4px' }}>1. Người Lập Phiếu</div>
                            {slip.sign_lap?.img ? (
                              <>
                                <img src={slip.sign_lap.img} alt="Kế toán" style={{ height: '40px', maxWidth: '100px', objectFit: 'contain', backgroundColor: '#FFF' }} />
                                <div style={{ fontWeight: 700, color: '#047857', marginTop: '2px' }}>{slip.sign_lap.name || 'Kế toán viên'}</div>
                                <div style={{ fontSize: '9px', color: '#94A3B8' }}>{slip.sign_lap.at ? new Date(slip.sign_lap.at).toLocaleDateString('vi-VN') : ''}</div>
                              </>
                            ) : (
                              <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>Chưa ký</span>
                            )}
                          </div>
                          <div style={{ textAlign: 'center', fontSize: '11px', padding: '8px', backgroundColor: '#F8FAFC', borderRadius: '8px' }}>
                            <div style={{ fontWeight: 700, color: '#475569', marginBottom: '4px' }}>2. Quản Lý Chi Nhánh</div>
                            {slip.sign_quanly?.img ? (
                              <>
                                <img src={slip.sign_quanly.img} alt="Quản lý" style={{ height: '40px', maxWidth: '100px', objectFit: 'contain', backgroundColor: '#FFF' }} />
                                <div style={{ fontWeight: 700, color: '#047857', marginTop: '2px' }}>{slip.sign_quanly.name || 'Quản lý'}</div>
                                <div style={{ fontSize: '9px', color: '#94A3B8' }}>{slip.sign_quanly.at ? new Date(slip.sign_quanly.at).toLocaleDateString('vi-VN') : ''}</div>
                              </>
                            ) : (
                              <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>Chưa ký</span>
                            )}
                          </div>
                          <div style={{ textAlign: 'center', fontSize: '11px', padding: '8px', backgroundColor: '#F8FAFC', borderRadius: '8px' }}>
                            <div style={{ fontWeight: 700, color: '#475569', marginBottom: '4px' }}>3. Người Nhận Tiền</div>
                            {slip.sign_nhanvien?.img ? (
                              <>
                                <img src={slip.sign_nhanvien.img} alt="Nhân viên" style={{ height: '40px', maxWidth: '100px', objectFit: 'contain', backgroundColor: '#FFF' }} />
                                <div style={{ fontWeight: 700, color: '#047857', marginTop: '2px' }}>{slip.sign_nhanvien.name || employee?.full_name}</div>
                                <div style={{ fontSize: '9px', color: '#94A3B8' }}>{slip.sign_nhanvien.at ? new Date(slip.sign_nhanvien.at).toLocaleDateString('vi-VN') : ''}</div>
                              </>
                            ) : (
                              <span style={{ color: '#E11D48', fontStyle: 'italic' }}>Chờ ký</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <button className="btn-secondary" onClick={() => { setPayslipUnlocked(false); setPayslips([]); }} style={{ fontSize: '12px' }}>
                    Ẩn Phiếu Lương
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

      </main>
      {updateReady && <UpdateBanner onLater={snoozeAppUpdate} />}
    </div>
  );
}
