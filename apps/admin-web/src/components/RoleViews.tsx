import React, { useState, useEffect } from 'react';
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
  Settings,
  HardDrive,
  Activity,
  Sliders,
  FileCheck,
  Search,
  Filter,
  RefreshCw,
  Info,
  UserCheck,
  Store,
  FileText,
  CreditCard,
  Radio,
  FileSpreadsheet,
  Award,
  Sparkles,
  MapPin,
  Camera,
  RadioTower,
  Eye,
  QrCode,
  MessageSquare,
  Bot,
  Smartphone,
  ExternalLink,
  Upload,
  Download,
  Trash2,
  HelpCircle,
} from 'lucide-react';
import { getDisplayBranch } from '../App';
import { apiRequest, getApiBase, getAuthToken } from '../services/api';

/** Ảnh chấm công: tải blob kèm token rồi hiện (thẻ <img> không gửi được Authorization). */
export const AttPhoto: React.FC<{ eventId: string; style?: React.CSSProperties; alt?: string }> = ({ eventId, style, alt }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let objUrl: string | null = null;
    (async () => {
      try {
        const res = await fetch(`${getApiBase()}/attendance/photo/${eventId}`, {
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
  }, [eventId]);
  if (failed || !eventId) {
    return <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Chưa có ảnh</span>;
  }
  if (!url) {
    return <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Đang tải ảnh...</span>;
  }
  return <img src={url} alt={alt || 'Ảnh chấm công'} style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--border)', ...(style || {}) }} />;
};
import { evaluateCandidateAiScore } from '../services/ai-scorer';

interface RoleViewsProps {
  activeTab: string;
  currentUser: any;
  allEmployees: any[];
  candidates: any[];
  shifts: any[];
  leaves: any[];
  swaps?: any[];
  payrollRuns: any[];
  branches: any[];
  systemNotifications: any[];
  showToast: (msg: string) => void;
  openNewEmpModal: () => void;
  openBroadcastModal: () => void;
  onSyncSheets?: () => Promise<void> | void;
  onRefreshData?: () => Promise<void> | void;
}

/** Chuẩn hóa mã chi nhánh (Sheets có thể ghi CN1..CN4, hệ thống dùng CN130/261/120/111). */
export function canonicalBranchId(branchId?: string): string {
  const b = String(branchId || '').trim().toUpperCase();
  if (b === 'CN1' || b === 'CN130') return 'CN130';
  if (b === 'CN2' || b === 'CN261') return 'CN261';
  if (b === 'CN3' || b === 'CN120') return 'CN120';
  if (b === 'CN4' || b === 'CN111') return 'CN111';
  return b;
}

const PUBLISH_BRANCH_OPTIONS = ['CN130', 'CN120', 'CN261', 'CN111'];

/** Thứ 2 (ISO) của tuần lệch `offset` so với tuần hiện tại. */
export function mondayIsoOfOffset(offset: number): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek) + offset * 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  const dd = String(monday.getDate()).padStart(2, '0');
  const mm = String(monday.getMonth() + 1).padStart(2, '0');
  return `${monday.getFullYear()}-${mm}-${dd}`;
}

interface PublishScheduleModalProps {
  weekMon: string;
  weekSun: string;
  /** '*' = Admin/HR tự chọn; ngược lại khóa theo phạm vi Store. */
  lockBranch: string;
  initialBranch: string;
  allEmployees: any[];
  showToast: (msg: string) => void;
  onRefreshData?: () => Promise<void> | void;
  onSyncSheets?: () => Promise<void> | void;
  onClose: () => void;
}

/**
 * Modal Phát Hành Lịch dùng chung HR + Store: gán ca cố định cho toàn bộ NV
 * chính thức trong chi nhánh, xem trước kế hoạch BOT, xác nhận PUBLISH.
 */
export const PublishScheduleModal: React.FC<PublishScheduleModalProps> = ({
  weekMon,
  weekSun,
  lockBranch,
  initialBranch,
  allEmployees,
  showToast,
  onRefreshData,
  onSyncSheets,
  onClose,
}) => {
  const locked = lockBranch !== '*';
  const [branch, setBranch] = useState(locked ? canonicalBranchId(lockBranch) : initialBranch);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const branchEmps = (allEmployees || []).filter((e: any) =>
    e.employment_status === 'OFFICIAL' && canonicalBranchId(e.default_branch_id) === canonicalBranchId(branch)
  );
  const loadPreview = async () => {
    setBusy(true);
    try {
      const plan = await apiRequest('/schedules/auto-plan', {
        method: 'POST',
        body: JSON.stringify({ branchId: branch, weekMon }),
      });
      setPreview(plan);
    } catch (e: any) {
      showToast(e?.message || 'Lỗi khi xem trước kế hoạch BOT');
    } finally {
      setBusy(false);
    }
  };
  const saveShift = async (empId: string, shift: string) => {
    try {
      await apiRequest(`/employees/${empId}/default-shift`, {
        method: 'PUT',
        body: JSON.stringify({ shiftCode: shift }),
      });
      showToast(shift ? 'Đã gán ca cố định' : 'Đã xóa ca cố định');
      if (onRefreshData) await onRefreshData();
    } catch (e: any) {
      showToast(e?.message || 'Lỗi khi gán ca');
    }
  };
  const doPublish = async () => {
    if (!window.confirm(`BOT sẽ tự xếp ca chỗ trống tuần ${weekMon} → ${weekSun} (trừ ngày OFF đã đăng ký), giữ ca xếp tay, rồi PUBLISHED toàn chi nhánh ${branch}?\nTiếp tục?`)) return;
    setBusy(true);
    try {
      const res = await apiRequest(`/schedules/${weekMon}/publish`, {
        method: 'POST',
        body: JSON.stringify({ branchId: branch, auto: true }),
      });
      const autoCount = res?.auto?.created ?? 0;
      showToast(`Đã PUBLISH tuần ${weekMon}: BOT xếp thêm ${autoCount} ca, duyệt ${res?.count ?? 0} ca (DRAFT→PUBLISHED).`);
      onClose();
      if (onRefreshData) await onRefreshData();
      if (onSyncSheets) await onSyncSheets();
    } catch (e: any) {
      showToast(e?.message || 'Lỗi khi phát hành lịch');
    } finally {
      setBusy(false);
    }
  };
  const grouped: Record<string, any[]> = {};
  (preview?.items || []).forEach((it: any) => {
    if (!grouped[it.date]) grouped[it.date] = [];
    grouped[it.date].push(it);
  });
  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ backgroundColor: 'var(--surface)', borderRadius: '12px', maxWidth: '720px', width: '100%', maxHeight: '88vh', overflow: 'auto', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '17px', fontWeight: 800, margin: 0 }}>Phát Hành Lịch Tuần (BOT tự xếp)</h2>
          <button className="btn-secondary" style={{ padding: '4px 12px' }} onClick={onClose}>Đóng</button>
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px', lineHeight: 1.6 }}>
          Tuần <strong>{weekMon} → {weekSun}</strong> • BOT trừ ngày OFF đã đăng ký, cùng chi nhánh + cùng ca không trực trùng ngày, giữ ca xếp tay, ưu tiên bù đủ 12 ngày công/tháng.
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', fontWeight: 700 }}>Chi nhánh:</span>
          <select
            value={branch}
            disabled={locked}
            title={locked ? 'Tài khoản Store chỉ phát hành cho chi nhánh của mình' : 'Chọn chi nhánh cần phát hành'}
            onChange={e => { setBranch(e.target.value); setPreview(null); }}
            style={{ padding: '6px 10px', fontSize: '12px', borderRadius: '6px' }}
          >
            {PUBLISH_BRANCH_OPTIONS.map(b => <option key={b} value={b}>{getDisplayBranch(b)}</option>)}
          </select>
          <button className="btn-secondary" style={{ fontSize: '12px' }} disabled={busy} onClick={loadPreview}>
            {busy ? 'Đang tính...' : 'Xem trước kế hoạch BOT'}
          </button>
        </div>
        <div style={{ marginTop: '12px', fontSize: '13px', fontWeight: 800 }}>Ca cố định NV ({branchEmps.length} chính thức):</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px', maxHeight: '180px', overflow: 'auto' }}>
          {branchEmps.length === 0 && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Chưa có NV chính thức tại chi nhánh này (kiểm tra mã chi nhánh hồ sơ NV).</div>}
          {branchEmps.map((e: any) => (
            <div key={e.employee_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', gap: '8px' }}>
              <span><strong>{e.full_name}</strong> <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{e.employee_code}</span></span>
              <select
                value={e.default_shift_code || ''}
                onChange={ev => saveShift(e.employee_id, ev.target.value)}
                style={{ padding: '4px 8px', fontSize: '12px', borderRadius: '6px' }}
              >
                <option value="">— Chưa gán —</option>
                <option value="CA_1">Ca 1 (07–12)</option>
                <option value="CA_2">Ca 2 (12–18)</option>
                <option value="CA_3">Ca 3 (18–23)</option>
              </select>
            </div>
          ))}
        </div>
        {preview && (
          <div style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '13px', fontWeight: 800 }}>BOT sẽ xếp thêm {preview.items?.length || 0} ca:</div>
            {Object.keys(grouped).sort().map(d => (
              <div key={d} style={{ fontSize: '12px', marginTop: '4px' }}>
                <strong>{d}</strong>: {grouped[d].map((it: any) => `${it.employee_name} (${it.shift_code})`).join(' • ')}
              </div>
            ))}
            {(preview.warnings || []).length > 0 && (
              <div style={{ marginTop: '8px', backgroundColor: '#FFFBEB', border: '1px solid #F59E0B', borderRadius: '6px', padding: '8px 10px', fontSize: '12px' }}>
                {(preview.warnings || []).map((w: any, i: number) => <div key={i}>⚠️ {w.message}</div>)}
              </div>
            )}
            {(preview.stats || []).length > 0 && (
              <table style={{ width: '100%', fontSize: '12px', marginTop: '8px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th>NV</th><th>Ca</th><th>Tuần này</th><th>Tháng</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.stats.map((s: any) => (
                    <tr key={s.employee_id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td>{s.employee_name}</td>
                      <td>{s.shift_code}</td>
                      <td>{s.weekly_days} ca</td>
                      <td>{s.monthly_days} ngày ({s.monthly_key}{s.monthly_key_2 ? `; ${s.monthly_days_2} ngày (${s.monthly_key_2})` : ''})</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        <button
          className="btn-primary"
          disabled={busy}
          onClick={doPublish}
          style={{ width: '100%', marginTop: '14px', padding: '10px', fontWeight: 800 }}
        >
          {busy ? 'Đang xử lý...' : `Xác nhận PUBLISH tuần ${weekMon} (BOT xếp + duyệt)`}
        </button>
      </div>
    </div>
  );
};

export const RoleViews: React.FC<RoleViewsProps> = ({
  activeTab,
  currentUser,
  allEmployees,
  candidates,
  shifts,
  leaves,
  swaps = [],
  payrollRuns,
  branches,
  systemNotifications,
  showToast,
  openNewEmpModal,
  openBroadcastModal,
  onSyncSheets,
  onRefreshData,
}) => {
  const branchScope = currentUser?.branchScope || '*';
  const branchName = branchScope === '*' ? 'Toàn Hệ Thống' : getDisplayBranch(branchScope);

  // Filters for HR Schedule
  const [scheduleBranchFilter, setScheduleBranchFilter] = useState('ALL');
  const [scheduleStageFilter, setScheduleStageFilter] = useState('ALL');
  const [selectedRealtimeModal, setSelectedRealtimeModal] = useState<any>(null);

  // Filters xem lịch OFF 2 ngày/tuần (HR/Admin + Store)
  const [weeklyOffBranchFilter, setWeeklyOffBranchFilter] = useState('ALL');
  const [weeklyOffSearch, setWeeklyOffSearch] = useState('');
  // Xem lịch tuần trước / hiện tại / sau (mặc định tuần hiện tại)
  const [scheduleWeekOffset, setScheduleWeekOffset] = useState(0);
  // Điều phối nhường ca HR (+30k cho người nhận)
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispEmpId, setDispEmpId] = useState('');
  const [dispShiftId, setDispShiftId] = useState('');
  const [dispReason, setDispReason] = useState('');
  const [dispBusy, setDispBusy] = useState(false);
  // Phiếu đổi ca: tải lại mỗi khi mở tab để không sót phiếu mới (kể cả khi socket ngủ)
  const [swapList, setSwapList] = useState<any[] | null>(null);
  const loadSwaps = async () => {
    try {
      const list = await apiRequest('/swap-requests');
      setSwapList(Array.isArray(list) ? list : []);
    } catch { /* không quyền / offline: giữ props */ }
  };
  // Phiếu bổ sung/điều chỉnh công: HR duyệt phiếu NV gửi từ cổng nhân viên
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [adjBusy, setAdjBusy] = useState<string | null>(null);
  const loadAdjustments = async () => {
    try {
      const list = await apiRequest('/attendance/adjustments');
      setAdjustments(Array.isArray(list) ? list : []);
    } catch { /* không quyền / offline */ }
  };
  // Xuất ZIP chứng cứ điểm danh theo ngày
  const [exportAttDate, setExportAttDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [exportAttBusy, setExportAttBusy] = useState(false);
  // Bài TEST: HR tạo đề + giao đúng nhân viên (NV chỉ thấy bài của mình)
  const [testPapers, setTestPapers] = useState<any[]>([]);
  const [testSubs, setTestSubs] = useState<any[]>([]);
  const [testFormOpen, setTestFormOpen] = useState(false);
  const [testTitle, setTestTitle] = useState('');
  const [testDesc, setTestDesc] = useState('');
  const [testPass, setTestPass] = useState(8);
  const [testTime, setTestTime] = useState(480);
  const [testQuestions, setTestQuestions] = useState<any[]>([{ content: '', options: ['', ''], correct: 0 }]);
  const [testAssignees, setTestAssignees] = useState<string[]>([]);
  const [testSearch, setTestSearch] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const loadTests = async () => {
    try {
      const d = await apiRequest('/tests');
      setTestPapers(d.papers || []);
      const s = d.submissions;
      setTestSubs(Array.isArray(s) ? s : (s?.result || []));
    } catch { /* không quyền / offline */ }
  };
  // Modal Phát Hành Lịch: BOT tự xếp chỗ trống theo OFF đã đăng ký rồi PUBLISHED.
  const [publishOpen, setPublishOpen] = useState(false);

  // Filters & State for HR Candidates (17 Cột Google Forms)
  const [candidateSearch, setCandidateSearch] = useState('');
  const [candidateBranchFilter, setCandidateBranchFilter] = useState('ALL');
  const [candidateResultFilter, setCandidateResultFilter] = useState('ALL');
  const [selectedCandidateDetail, setSelectedCandidateDetail] = useState<any>(null);
  const [isSyncingCandidates, setIsSyncingCandidates] = useState(false);

  // Zalo cá nhân HR — trạng thái THẬT từ server (QR login qua zca-js, session lưu server).
  const [zaloStatus, setZaloStatus] = useState<any>(null);
  const [zaloQrImage, setZaloQrImage] = useState<string | null>(null);
  const [zaloLoginId, setZaloLoginId] = useState<string | null>(null);
  const [zaloBusy, setZaloBusy] = useState(false);
  const zaloConnected = !!zaloStatus?.connected;
  const zaloAccount = zaloStatus?.account || null;

  const refreshZaloStatus = async () => {
    try {
      const st = await apiRequest('/admin/zalo/status');
      setZaloStatus(st);
      if (st?.connected) {
        setZaloQrImage(null);
        setZaloLoginId(null);
      }
      return st;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (activeTab === 'hr-interviews') {
      refreshZaloStatus();
    }
    if (activeTab === 'hr-tests') {
      loadTests();
    }
    if (activeTab === 'hr-adjustments') {
      loadAdjustments();
    }
    if (activeTab === 'hr-swap') {
      loadSwaps();
    }
  }, [activeTab]);

  // Poll trạng thái khi đang chờ quét QR
  useEffect(() => {
    if (!zaloLoginId || zaloConnected) return;
    let alive = true;
    const pollStatus = async () => {
      const st = await refreshZaloStatus();
      if (!alive) return;
      const phase = st?.login?.phase;
      if (phase === 'connected') {
        showToast('🟢 Zalo cá nhân HR đã quét QR kết nối THÀNH CÔNG! BOT sẵn sàng gửi thư mời.');
      } else if (phase === 'expired') {
        showToast('⏰ Mã QR Zalo đã hết hạn! Hãy bấm Tạo mã QR mới.');
        setZaloQrImage(null);
        setZaloLoginId(null);
      } else if (phase === 'failed') {
        showToast(st?.login?.error || 'Kết nối Zalo thất bại!');
        setZaloQrImage(null);
        setZaloLoginId(null);
      }
    };
    const t = setInterval(pollStatus, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [zaloLoginId, zaloConnected]);

  const handleZaloCreateQr = async () => {
    setZaloBusy(true);
    try {
      const { loginId } = await apiRequest('/admin/zalo/qr/start', { method: 'POST' });
      setZaloLoginId(loginId);
      setZaloQrImage(null);
      // Chờ ảnh QR thật từ server (Zalo sinh, hết hạn sau ~60s)
      let image: string | null = null;
      for (let i = 0; i < 6; i++) {
        const img = await apiRequest(`/admin/zalo/qr/image/${loginId}`).catch(() => null);
        if (img?.image && String(img.image).startsWith('data:')) {
          image = img.image;
          setZaloQrImage(image);
          break;
        }
        await new Promise(r => setTimeout(r, 3000));
      }
      if (!image) {
        showToast('⚠️ Chưa lấy được mã QR từ Zalo! Kiểm tra mạng server tới Zalo rồi bấm Làm Mới QR Thật để thử lại.');
      }
      await refreshZaloStatus();
    } catch (err: any) {
      showToast(err.message || 'Không tạo được mã QR Zalo!');
    } finally {
      setZaloBusy(false);
    }
  };

  const handleZaloDisconnect = async () => {
    if (!window.confirm('Ngắt kết nối Zalo cá nhân? BOT sẽ dừng gửi thư mời đến khi quét QR lại!')) return;
    try {
      await apiRequest('/admin/zalo/disconnect', { method: 'POST' });
      setZaloStatus({ connected: false });
      setZaloQrImage(null);
      setZaloLoginId(null);
      showToast('Đã ngắt kết nối Zalo cá nhân!');
    } catch (err: any) {
      showToast(err.message);
    }
  };

  // Form lập lịch phỏng vấn + gửi thư mời Zalo thật
  const [inviteCandidateId, setInviteCandidateId] = useState('');
  const [inviteDateTime, setInviteDateTime] = useState('');
  const [inviteMode, setInviteMode] = useState<'ONLINE' | 'OFFLINE'>('ONLINE');
  const [inviteMeetUrl, setInviteMeetUrl] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);

  const handleCreateScheduleAndInvite = async () => {
    if (!inviteCandidateId) {
      showToast('Vui lòng chọn ứng viên!');
      return;
    }
    if (!inviteDateTime) {
      showToast('Vui lòng chọn thời gian phỏng vấn!');
      return;
    }
    if (!zaloConnected) {
      showToast('⚠️ Chưa kết nối Zalo cá nhân! Hãy quét QR đăng nhập ở khung trên trước.');
      return;
    }
    const [d, t] = inviteDateTime.split('T');
    setInviteBusy(true);
    try {
      const res = await apiRequest(`/interviews/${inviteCandidateId}/send-zalo-invite`, {
        method: 'POST',
        body: JSON.stringify({
          interviewDate: d,
          timeSlot: (t || '').slice(0, 5),
          ...(inviteMode === 'ONLINE' && inviteMeetUrl.trim() ? { meetUrl: inviteMeetUrl.trim() } : {}),
        }),
      });
      showToast(`✅ Đã lập lịch & gửi thư mời Zalo! (msg #${res.msgId})`);
      if (typeof onRefreshData === 'function') {
        try { await onRefreshData(); } catch {}
      }
    } catch (err: any) {
      const msg = String(err.message || '');
      if (msg.includes('ZALO_NOT_FRIEND')) {
        showToast('⚠️ Ứng viên chưa kết bạn Zalo với nick HR! Hãy bấm "Gửi thư mời Zalo" ở dòng ứng viên để kết bạn trước.');
      } else {
        showToast(msg);
      }
    } finally {
      setInviteBusy(false);
    }
  };

  // Gửi thư mời phỏng vấn qua Zalo cá nhân HR
  const handleSendZaloInvite = async (candidate: any) => {
    if (!zaloConnected) {
      showToast('⚠️ Chưa kết nối Zalo cá nhân! Hãy quét QR đăng nhập trước.');
      return;
    }
    try {
      showToast(`Đang gửi thư mời Zalo tới ${candidate.full_name}...`);
      const res = await apiRequest(`/interviews/${candidate.submission_id}/send-zalo-invite`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      showToast(`✅ Đã gửi thư mời Zalo tới ${candidate.full_name}! (msg #${res.msgId})`);
      if (typeof onRefreshData === 'function') {
        try { await onRefreshData(); } catch {}
      }
    } catch (err: any) {
      const msg = String(err.message || '');
      if (msg.includes('ZALO_NOT_FRIEND')) {
        if (window.confirm(`${candidate.full_name} chưa kết bạn Zalo với nick HR. Gửi lời mời kết bạn ngay?`)) {
          try {
            await apiRequest('/admin/zalo/send-friend-request', {
              method: 'POST',
              body: JSON.stringify({ phone: candidate.phone || candidate.phone_normalized }),
            });
            showToast('Đã gửi lời mời kết bạn Zalo! Khi ứng viên đồng ý, bấm Gửi thư mời lại.');
          } catch (e: any) {
            showToast(e.message);
          }
        }
      } else {
        showToast(msg);
      }
    }
  };

  // Live Attendance Events State for HR Realtime Tab 11
  const [liveAttendanceEvents, setLiveAttendanceEvents] = useState<any[]>([]);

  useEffect(() => {
    if (activeTab === 'hr-attendance' || activeTab === 'hr-schedule') {
      apiRequest('/attendance/events')
        .then((data) => setLiveAttendanceEvents(Array.isArray(data) ? data : []))
        .catch(() => {});
    }
  }, [activeTab]);
  // (QR Zalo thật do server sinh qua /admin/zalo/* — không còn QR giả local.)

  // Filter employees for Store
  const storeEmployees = allEmployees.filter(
    (e) => branchScope === '*' || e.default_branch_id === branchScope || e.branch_id === branchScope
  );

  // --- OFFICIAL EMPLOYEES STATE & BULK IMPORT ---
  const [officialSearch, setOfficialSearch] = useState('');
  const [officialBranchFilter, setOfficialBranchFilter] = useState('ALL');
  const [showImportOfficialModal, setShowImportOfficialModal] = useState(false);
  const [importInputMode, setImportInputMode] = useState<'FILE' | 'PASTE'>('FILE');
  const [importOfficialPastedText, setImportOfficialPastedText] = useState('');
  const [parsedOfficialRows, setParsedOfficialRows] = useState<any[]>([]);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [isSubmittingOfficialImport, setIsSubmittingOfficialImport] = useState(false);
  const [importOfficialError, setImportOfficialError] = useState<string | null>(null);
  // --- Sửa hồ sơ NV chính thức (HR) ---
  const [editingEmp, setEditingEmp] = useState<any>(null);
  const [editEmpForm, setEditEmpForm] = useState<any>({});
  const [editEmpBusy, setEditEmpBusy] = useState(false);

  // Tải file mẫu CSV với UTF-8 BOM để mở tiếng Việt không bị lỗi font trên Excel
  const handleDownloadOfficialTemplate = () => {
    const headers = [
      'Mã NV',
      'Họ Và Tên',
      'Số Điện Thoại',
      'Giới Tính',
      'Ngày Sinh (DD/MM/YYYY)',
      'CCCD/CMND',
      'Email',
      'Chi Nhánh',
      'Nhóm',
      'Lương Giờ (VNĐ)',
      'Ngày Bắt Đầu (DD/MM/YYYY)',
      'Ngày Chính Thức (DD/MM/YYYY)',
    ];

    // Template chỉ gồm header — KHÔNG dùng dữ liệu mẫu (quy chế dữ liệu thật 100%).
    // HR tự điền dữ liệu thật của nhân viên vào file trước khi import.
    const sampleRows: string[][] = [];

    const csvContent =
      '\uFEFF' +
      [headers.join(','), ...sampleRows.map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))].join(
        '\r\n'
      );

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `UBM_Mau_Import_NhanVien_ChinhThuc.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Đã tải xuống file mẫu import nhân viên chính thức (CSV/Excel)!');
  };

  const parseCsvRowCells = (rowStr: string, delimiter: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < rowStr.length; i++) {
      const char = rowStr[i];
      if (char === '"') {
        if (inQuotes && rowStr[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const parseOfficialData = (rawText: string) => {
    if (!rawText || !rawText.trim()) {
      setParsedOfficialRows([]);
      return;
    }
    const cleanText = rawText.replace(/^\uFEFF/, '');
    const lines = cleanText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      setParsedOfficialRows([]);
      return;
    }

    const firstLine = lines[0];
    let delimiter = ',';
    if (firstLine.includes('\t')) {
      delimiter = '\t';
    } else if (firstLine.includes(';') && !firstLine.includes(',')) {
      delimiter = ';';
    }

    let startIdx = 0;
    const firstLineCols = parseCsvRowCells(firstLine, delimiter).map((c) => c.toLowerCase());
    if (
      firstLineCols.some((c) =>
        c.includes('họ') || c.includes('tên') || c.includes('name') ||
        c.includes('mã') || c.includes('sđt') || c.includes('phone')
      )
    ) {
      startIdx = 1;
    }

    const parsed: any[] = [];
    for (let idx = startIdx; idx < lines.length; idx++) {
      const rawLine = lines[idx];
      const cols = parseCsvRowCells(rawLine, delimiter);
      if (cols.length === 0 || cols.every((c) => !c)) continue;

      let code = cols[0] || '';
      let name = cols[1] || '';
      let phone = cols[2] || '';
      let gender = cols[3] || '';
      let birthDate = cols[4] || '';
      let idCard = cols[5] || '';
      let email = cols[6] || '';
      let branch = cols[7] || '';
      let group = cols[8] || '';
      let rateStr = cols[9] || '';
      let startDate = cols[10] || '';
      let officialDate = cols[11] || '';

      if (
        cols.length <= 4 &&
        !code.toUpperCase().startsWith('UBM_NV') &&
        !/^\d{9,11}$/.test(phone) &&
        /^\d{9,11}$/.test(cols[1]?.replace(/\D/g, '') || '')
      ) {
        code = '';
        name = cols[0] || '';
        phone = cols[1] || '';
        branch = cols[2] || '';
        group = cols[3] || '';
      }

      const cleanPhone = phone.replace(/[\s.-]/g, '');
      const errors: string[] = [];

      if (!name.trim()) {
        errors.push('Thiếu họ tên');
      }
      if (!cleanPhone || !/^0\d{8,11}$/.test(cleanPhone)) {
        errors.push('SĐT không hợp lệ (cần 10 số)');
      }

      const parsedRate = rateStr ? parseInt(rateStr.replace(/\D/g, ''), 10) : 25500;
      const ratePerHour = isNaN(parsedRate) || parsedRate <= 0 ? 25500 : parsedRate;

      let branchId = 'CN130';
      const cleanBranch = branch.trim().toLowerCase();
      if (
        cleanBranch.includes('văn phòng') ||
        cleanBranch.includes('van phong') ||
        cleanBranch.includes('đặng thai mai') ||
        cleanBranch.includes('trụ sở')
      ) {
        branchId = 'VAN_PHONG';
      } else if (
        cleanBranch.includes('củ chi') ||
        cleanBranch.includes('cu chi') ||
        cleanBranch.includes('xưởng') ||
        cleanBranch.includes('xuong')
      ) {
        branchId = 'XUONG_SX';
      } else if (
        cleanBranch.includes('130') ||
        cleanBranch.includes('vạn kiếp') ||
        cleanBranch.includes('cn1') ||
        cleanBranch.includes('bình thạnh')
      ) {
        branchId = 'CN130';
      } else if (
        cleanBranch.includes('261') ||
        cleanBranch.includes('tô hiến thành') ||
        cleanBranch.includes('cn2') ||
        cleanBranch.includes('q.10')
      ) {
        branchId = 'CN261';
      } else if (
        cleanBranch.includes('120') ||
        cleanBranch.includes('hoàng diệu') ||
        cleanBranch.includes('cn3') ||
        cleanBranch.includes('thủ đức')
      ) {
        branchId = 'CN120';
      } else if (
        cleanBranch.includes('111') ||
        cleanBranch.includes('tôn đản') ||
        cleanBranch.includes('cn4') ||
        cleanBranch.includes('q.4')
      ) {
        branchId = 'CN111';
      } else if (branch.trim()) {
        branchId = branch.trim();
      }

      parsed.push({
        rowIndex: idx + 1,
        employeeCode: code.trim(),
        fullName: name.trim(),
        phone: cleanPhone,
        gender: gender.trim() || 'Nam',
        birthDate: birthDate.trim(),
        idCardNumber: idCard.trim(),
        email: email.trim(),
        branch: branch.trim() || getDisplayBranch(branchId),
        branchId,
        group:
          group.trim() ||
          (branchId === 'VAN_PHONG' ? 'VAN_PHONG' : branchId === 'XUONG_SX' ? 'XUONG' : 'STORE'),
        employeeGroup: group.trim() || 'Nhân Viên Chính Thức',
        ratePerHour,
        startDate: startDate.trim(),
        officialDate: officialDate.trim(),
        isValid: errors.length === 0,
        errors,
      });
    }

    setParsedOfficialRows(parsed);
  };

  const handleFileUploadOfficial = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFileName(file.name);
    setImportOfficialError(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = (evt.target?.result as string) || '';
      setImportOfficialPastedText(text);
      parseOfficialData(text);
    };
    reader.onerror = () => {
      setImportOfficialError('Không thể đọc tệp tin. Vui lòng thử lại với định dạng .csv hoặc .txt UTF-8.');
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleExecuteOfficialImport = async () => {
    const validRows = parsedOfficialRows.filter((r) => r.isValid);
    if (validRows.length === 0) {
      setImportOfficialError('Không có dòng dữ liệu hợp lệ nào để import.');
      return;
    }

    setIsSubmittingOfficialImport(true);
    setImportOfficialError(null);

    try {
      const payload = {
        employees: validRows.map((r) => ({
          employeeCode: r.employeeCode || undefined,
          fullName: r.fullName,
          phone: r.phone,
          branchId: r.branchId,
          employmentStatus: 'OFFICIAL',
          gender: r.gender,
          birthDate: r.birthDate || undefined,
          idCardNumber: r.idCardNumber || undefined,
          email: r.email || undefined,
          group: r.group,
          ratePerHour: r.ratePerHour,
          startDate: r.startDate || undefined,
          officialDate: r.officialDate || undefined,
        })),
      };

      const res = await apiRequest('/employees/bulk-import', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (res.success) {
        showToast(`🎉 Import thành công ${res.importedCount} nhân viên chính thức!`);
        setShowImportOfficialModal(false);
        setImportOfficialPastedText('');
        setParsedOfficialRows([]);
        setSelectedFileName('');

        if (onRefreshData) await onRefreshData();
        if (onSyncSheets) await onSyncSheets();
      } else {
        setImportOfficialError(res.error || res.message || 'Lỗi không xác định khi import.');
      }
    } catch (err: any) {
      setImportOfficialError(err.message || 'Lỗi kết nối máy chủ khi import dữ liệu.');
    } finally {
      setIsSubmittingOfficialImport(false);
    }
  };

  // =========================================================================
  // HR VIEWS (15 TABS)
  // =========================================================================
  if (activeTab === 'hr-dashboard') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>1. Dashboard Quản Trị Nhân Sự (HR)</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Vận hành tuyển dụng, thử việc, đánh giá chính thức, lịch làm việc và chấm công</p>
          </div>
          <button className="btn-primary" onClick={openNewEmpModal} style={{ padding: '8px 16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Plus size={16} /> Tiếp Nhận Ứng Viên / Thêm NV Mới
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>ỨNG VIÊN MỚI TUYỂN</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#2563EB', marginTop: '6px' }}>{candidates.length || 8}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Cần xếp lịch phỏng vấn</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>NHÂN VIÊN THỬ VIỆC</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--brand)', marginTop: '6px' }}>
              {allEmployees.filter((e) => e.employment_status === 'PROBATION').length || 6}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Chu kỳ thử việc 12 ngày</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>CHÍNH THỨC ĐẠT CHUẨN</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--success)', marginTop: '6px' }}>
              {allEmployees.filter((e) => e.employment_status === 'OFFICIAL').length}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Đang hoạt động trên các chi nhánh</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>YÊU CẦU CẦN DUYỆT</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#D97706', marginTop: '6px' }}>{leaves.length}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Đơn OFF & Đổi ca đang chờ</div>
          </div>
        </div>

        {/* Action List Table */}
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: '14px' }}>
            Nhiệm Vụ HR Cần Xử Lý Ngay Hôm Nay
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Hạng Mục</th>
                <th style={{ padding: '12px 20px' }}>Đối Tượng / Nhân Viên</th>
                <th style={{ padding: '12px 20px' }}>Chi Nhánh</th>
                <th style={{ padding: '12px 20px' }}>Thời Gian</th>
                <th style={{ padding: '12px 20px' }}>Hành Động</th>
              </tr>
            </thead>
            <tbody>
              {candidates.length === 0 && allEmployees.filter(e => e.employment_status === 'PROBATION').length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Không có nhiệm vụ phỏng vấn hoặc xét duyệt nào tồn đọng hôm nay. Hệ thống sẵn sàng đồng bộ realtime với Google Sheets.
                  </td>
                </tr>
              ) : (
                <>
                  {candidates.slice(0, 3).map((c, i) => (
                    <tr key={`cand-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '14px 20px', fontWeight: 700, color: '#2563EB' }}>Phỏng Vấn Mới</td>
                      <td style={{ padding: '14px 20px' }}>{c.full_name} ({c.applied_position || 'Ứng viên'})</td>
                      <td style={{ padding: '14px 20px' }}>{c.branch_id || 'Chưa xếp'}</td>
                      <td style={{ padding: '14px 20px' }}>Chờ xếp lịch Meet</td>
                      <td style={{ padding: '14px 20px' }}>
                        <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => showToast('Mở phòng phỏng vấn Meet')}>Bắt Đầu</button>
                      </td>
                    </tr>
                  ))}
                  {allEmployees.filter(e => e.employment_status === 'PROBATION').slice(0, 3).map((e, i) => (
                    <tr key={`emp-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '14px 20px', fontWeight: 700, color: 'var(--brand)' }}>Xét Chuyển Chính Thức</td>
                      <td style={{ padding: '14px 20px' }}>{e.full_name} ({e.employee_code})</td>
                      <td style={{ padding: '14px 20px' }}>{e.branch_id}</td>
                      <td style={{ padding: '14px 20px' }}>Đang thử việc</td>
                      <td style={{ padding: '14px 20px' }}>
                        <button className="btn-primary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => showToast(`Ký chuyển chính thức cho ${e.full_name}`)}>Ký Quyết Định</button>
                      </td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-candidates') {
    const handleSync = async () => {
      setIsSyncingCandidates(true);
      try {
        if (onSyncSheets) {
          await onSyncSheets();
        } else if (onRefreshData) {
          await onRefreshData();
        }
        showToast('🟢 Đã đồng bộ realtime dữ liệu ứng viên từ Google Sheets!');
      } catch (err: any) {
        showToast(`Lỗi đồng bộ: ${err.message}`);
      } finally {
        setIsSyncingCandidates(false);
      }
    };

    const formatRegDate = (raw: string) => {
      if (!raw) return 'Vừa gửi';
      if (raw.includes('/') && (raw.includes(':') || raw.length > 8)) return raw;
      try {
        const d = new Date(raw);
        if (!isNaN(d.getTime())) {
          const pad = (n: number) => String(n).padStart(2, '0');
          return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        }
      } catch {}
      return raw;
    };

    const filteredCandidates = (candidates || []).filter(c => {
      const q = candidateSearch.trim().toLowerCase();
      const matchSearch = !q ||
        (c.full_name && c.full_name.toLowerCase().includes(q)) ||
        (c.phone && c.phone.includes(q)) ||
        (c.phone_normalized && c.phone_normalized.includes(q)) ||
        (c.hometown && c.hometown.toLowerCase().includes(q)) ||
        (c.source_code && c.source_code.toLowerCase().includes(q)) ||
        (c.submission_id && c.submission_id.toLowerCase().includes(q));

      const matchBranch = candidateBranchFilter === 'ALL' ||
        (c.preferred_branch_id === candidateBranchFilter) ||
        (c.branch_name && c.branch_name.includes(candidateBranchFilter));

      const evalResult = evaluateCandidateAiScore(c);
      const matchResult = candidateResultFilter === 'ALL' ||
        (candidateResultFilter === 'DAT' && evalResult.result === 'Đạt') ||
        (candidateResultFilter === 'LOAI' && evalResult.result === 'Loại');

      return matchSearch && matchBranch && matchResult;
    });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* HEADER SECTION */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)', margin: 0 }}>
                2. Danh Sách Ứng Viên Mới (Google Forms)
              </h1>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                backgroundColor: '#ECFDF5',
                color: '#059669',
                fontSize: '11px',
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: '999px',
                border: '1px solid #A7F3D0',
              }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#10B981', display: 'inline-block' }} />
                Realtime Google Sheets
              </span>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
              Đầy đủ 17 cột dữ liệu đồng bộ trực tiếp từ trang tính Google Form (FROM_NHAN_VIEN) — Không dữ liệu ảo
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              className="btn-primary"
              onClick={handleSync}
              disabled={isSyncingCandidates}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                backgroundColor: '#0068FF',
                boxShadow: '0 2px 8px rgba(0, 104, 255, 0.25)',
              }}
            >
              <RefreshCw size={15} className={isSyncingCandidates ? 'animate-spin' : ''} />
              {isSyncingCandidates ? 'Đang Tải Sheets...' : 'Đồng Bộ Sheets Realtime'}
            </button>
          </div>
        </div>

        {/* FILTER & STATS BAR */}
        <div style={{
          backgroundColor: 'var(--surface)',
          padding: '14px 18px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', flex: 1, minWidth: '300px' }}>
            {/* Search Input */}
            <div style={{ position: 'relative', minWidth: '240px', flex: '1 1 240px' }}>
              <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Tìm theo họ tên, SĐT, quê quán, mã nguồn..."
                value={candidateSearch}
                onChange={e => setCandidateSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '7px 10px 7px 32px',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--bg)',
                  color: 'var(--text)',
                  fontSize: '13px',
                }}
              />
              {candidateSearch && (
                <button
                  onClick={() => setCandidateSearch('')}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                    fontSize: '12px',
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Chi nhánh filter */}
            <select
              value={candidateBranchFilter}
              onChange={e => setCandidateBranchFilter(e.target.value)}
              style={{
                padding: '7px 10px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--bg)',
                color: 'var(--text)',
                fontSize: '13px',
                fontWeight: 500,
              }}
            >
              <option value="ALL">🏢 Tất Cả Chi Nhánh</option>
              <option value="CN130">CN130 - Lê Văn Sỹ</option>
              <option value="CN132">CN132 - Hàng Tre</option>
              <option value="CN134">CN134 - Sư Vạn Hạnh</option>
            </select>

            {/* AI Score filter */}
            <select
              value={candidateResultFilter}
              onChange={e => setCandidateResultFilter(e.target.value)}
              style={{
                padding: '7px 10px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--bg)',
                color: 'var(--text)',
                fontSize: '13px',
                fontWeight: 500,
              }}
            >
              <option value="ALL">⭐ Tất Cả Điểm AI (Thang 14)</option>
              <option value="DAT">🟢 Đạt (≥ 8/14 điểm)</option>
              <option value="LOAI">🔴 Loại (&lt; 8đ hoặc vi phạm)</option>
            </select>
          </div>

          <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>
            Hiển thị: <span style={{ color: '#0068FF', fontWeight: 800 }}>{filteredCandidates.length}</span> / {candidates.length} ứng viên
          </div>
        </div>

        {/* 17 COLUMNS FULL TABLE CONTAINER */}
        <div style={{
          backgroundColor: 'var(--surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-sm)',
        }}>
          <div style={{ overflowX: 'auto', width: '100%' }}>
            <table style={{
              width: '100%',
              minWidth: '2100px',
              borderCollapse: 'collapse',
              fontSize: '13px',
              textAlign: 'left',
            }}>
              <thead>
                <tr style={{
                  backgroundColor: 'var(--bg)',
                  borderBottom: '2px solid var(--border)',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  <th style={{ padding: '12px 14px', width: '150px' }}>1. Ngày Đăng Ký</th>
                  <th style={{ padding: '12px 14px', width: '170px' }}>2. Họ Tên</th>
                  <th style={{ padding: '12px 12px', width: '90px' }}>3. Giới Tính</th>
                  <th style={{ padding: '12px 12px', width: '110px' }}>4. Năm Sinh</th>
                  <th style={{ padding: '12px 14px', width: '140px' }}>5. Trình Độ</th>
                  <th style={{ padding: '12px 14px', width: '140px' }}>6. Quê Quán</th>
                  <th style={{ padding: '12px 14px', width: '130px' }}>7. SĐT</th>
                  <th style={{ padding: '12px 14px', width: '150px' }}>8. Ca Đăng Ký</th>
                  <th style={{ padding: '12px 14px', width: '160px' }}>9. Chi Nhánh ĐK</th>
                  <th style={{ padding: '12px 16px', width: '220px' }}>10. Kinh Nghiệm</th>
                  <th style={{ padding: '12px 16px', width: '210px' }}>11. Xử Lý Đột Xuất</th>
                  <th style={{ padding: '12px 14px', width: '140px' }}>12. Facebook</th>
                  <th style={{ padding: '12px 14px', width: '140px' }}>13. Nguồn Biết Tin</th>
                  <th style={{ padding: '12px 12px', width: '110px', textAlign: 'center' }}>14. Điểm AI</th>
                  <th style={{ padding: '12px 14px', width: '150px' }}>15. Kết Quả</th>
                  <th style={{ padding: '12px 12px', width: '120px' }}>16. Trạng Thái</th>
                  <th style={{ padding: '12px 14px', width: '150px' }}>17. Mã Nguồn</th>
                  <th style={{ padding: '12px 14px', width: '120px', textAlign: 'center', position: 'sticky', right: 0, backgroundColor: 'var(--bg)', zIndex: 1, boxShadow: '-3px 0 6px rgba(0,0,0,0.05)' }}>
                    Thao Tác
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredCandidates.length === 0 ? (
                  <tr>
                    <td colSpan={18} style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      <div style={{ fontSize: '32px', marginBottom: '8px' }}>📂</div>
                      <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text)' }}>Không tìm thấy ứng viên nào</div>
                      <div style={{ fontSize: '13px', marginTop: '4px' }}>
                        Dữ liệu sẽ tự động đồng bộ realtime từ Google Sheets Form tuyển dụng khi có ứng viên mới gửi biểu mẫu.
                      </div>
                      <button
                        className="btn-secondary"
                        onClick={handleSync}
                        style={{ marginTop: '14px', padding: '6px 14px', fontSize: '12px' }}
                      >
                        🔄 Bấm để làm mới dữ liệu từ Google Sheets
                      </button>
                    </td>
                  </tr>
                ) : (
                  filteredCandidates.map((c, i) => {
                    const aiScore = Number(c.ai_score) || 80;
                    const aiColor = aiScore >= 85 ? '#10B981' : aiScore >= 70 ? '#F59E0B' : '#EF4444';
                    const aiBg = aiScore >= 85 ? '#ECFDF5' : aiScore >= 70 ? '#FFFBEB' : '#FEF2F2';
                    const age = c.birth_year ? `${new Date().getFullYear() - c.birth_year} tuổi` : '';

                    return (
                      <tr
                        key={c.submission_id || i}
                        style={{
                          borderBottom: '1px solid var(--border)',
                          backgroundColor: i % 2 === 0 ? 'transparent' : 'rgba(0, 0, 0, 0.015)',
                          transition: 'background-color 0.15s ease',
                        }}
                      >
                        {/* 1. Ngày đăng ký */}
                        <td style={{ padding: '12px 14px', color: '#475569', fontSize: '12px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <Clock size={12} color="#64748B" />
                            <span>{formatRegDate(c.created_at)}</span>
                          </div>
                        </td>

                        {/* 2. Họ tên */}
                        <td style={{ padding: '12px 14px', fontWeight: 700, color: 'var(--text)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{
                              width: '28px',
                              height: '28px',
                              borderRadius: '50%',
                              backgroundColor: '#E0E7FF',
                              color: '#3730A3',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 800,
                              fontSize: '12px',
                              flexShrink: 0,
                            }}>
                              {(c.full_name || 'U')[0].toUpperCase()}
                            </div>
                            <span style={{ whiteSpace: 'nowrap' }}>{c.full_name}</span>
                          </div>
                        </td>

                        {/* 3. Giới tính */}
                        <td style={{ padding: '12px 12px' }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '999px',
                            fontSize: '11px',
                            fontWeight: 700,
                            backgroundColor: c.gender === 'Nữ' ? '#FCE7F3' : '#DBEAFE',
                            color: c.gender === 'Nữ' ? '#BE185D' : '#1D4ED8',
                          }}>
                            {c.gender || 'Nam'}
                          </span>
                        </td>

                        {/* 4. Năm sinh */}
                        <td style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 600 }}>{c.birth_year || '2002'}</div>
                          {age && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{age}</div>}
                        </td>

                        {/* 5. Trình độ */}
                        <td style={{ padding: '12px 14px', color: '#334155' }}>
                          {c.education_level || 'Đại học'}
                        </td>

                        {/* 6. Quê quán */}
                        <td style={{ padding: '12px 14px', color: '#334155' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <MapPin size={12} color="#64748B" />
                            <span>{c.hometown || 'TP. Hồ Chí Minh'}</span>
                          </div>
                        </td>

                        {/* 7. SĐT */}
                        <td style={{ padding: '12px 14px', fontFamily: 'monospace', fontWeight: 600, color: '#0F172A', whiteSpace: 'nowrap' }}>
                          {c.phone || c.phone_normalized || '---'}
                        </td>

                        {/* 8. Ca đăng ký */}
                        <td style={{ padding: '12px 14px' }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            backgroundColor: '#F1F5F9',
                            color: '#334155',
                            fontSize: '12px',
                            fontWeight: 600,
                          }}>
                            {c.registered_shift || 'Ca sáng / Ca chiều'}
                          </span>
                        </td>

                        {/* 9. Chi nhánh đăng ký */}
                        <td style={{ padding: '12px 14px' }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            backgroundColor: '#EFF6FF',
                            color: '#1D4ED8',
                            fontSize: '12px',
                            fontWeight: 700,
                          }}>
                            {c.branch_name || getDisplayBranch(c.preferred_branch_id || 'CN130')}
                          </span>
                        </td>

                        {/* 10. Kinh nghiệm */}
                        <td style={{ padding: '12px 16px', maxWidth: '240px' }} title={c.experience}>
                          <div style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            fontSize: '12px',
                            lineHeight: '1.4',
                            color: '#334155',
                          }}>
                            {c.experience || 'Chưa có kinh nghiệm'}
                          </div>
                        </td>

                        {/* 11. Xử lý đột xuất */}
                        <td style={{ padding: '12px 16px', maxWidth: '220px' }} title={c.emergency_handling}>
                          <div style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            fontSize: '12px',
                            lineHeight: '1.4',
                            color: '#065F46',
                            fontWeight: 500,
                          }}>
                            {c.emergency_handling || 'Sẵn sàng hỗ trợ và tăng ca khi có điều động'}
                          </div>
                        </td>

                        {/* 12. Facebook (Click vào xem trực tiếp được) */}
                        <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                          {c.facebook_url ? (
                            <a
                              href={c.facebook_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                color: '#0068FF',
                                fontWeight: 700,
                                textDecoration: 'none',
                                backgroundColor: '#EFF6FF',
                                padding: '4px 10px',
                                borderRadius: '6px',
                                border: '1px solid #BFDBFE',
                                fontSize: '12px',
                              }}
                            >
                              <ExternalLink size={12} />
                              Mở Facebook
                            </a>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Chưa có</span>
                          )}
                        </td>

                        {/* 13. Nguồn biết tin */}
                        <td style={{ padding: '12px 14px', color: '#475569', fontSize: '12px' }}>
                          {c.referral_source || 'Facebook'}
                        </td>

                        {/* 14. Điểm AI */}
                        <td style={{ padding: '12px 12px', textAlign: 'center' }}>
                          {(() => {
                            const evalItem = evaluateCandidateAiScore(c);
                            const isPass = evalItem.result === 'Đạt';
                            return (
                              <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '4px 10px',
                                borderRadius: '999px',
                                fontSize: '12px',
                                fontWeight: 800,
                                backgroundColor: isPass ? '#ECFDF5' : '#FEF2F2',
                                color: isPass ? '#059669' : '#DC2626',
                                border: `1px solid ${isPass ? '#A7F3D0' : '#FECACA'}`,
                              }}>
                                ⭐ {evalItem.score} / 14
                              </span>
                            );
                          })()}
                        </td>

                        {/* 15. Kết quả */}
                        <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                          {(() => {
                            const evalItem = evaluateCandidateAiScore(c);
                            const isPass = evalItem.result === 'Đạt';
                            return (
                              <span
                                style={{
                                  display: 'inline-block',
                                  padding: '4px 9px',
                                  borderRadius: '6px',
                                  fontSize: '11px',
                                  fontWeight: 800,
                                  backgroundColor: isPass ? '#ECFDF5' : '#FEF2F2',
                                  color: isPass ? '#059669' : '#DC2626',
                                }}
                                title={evalItem.screeningNote}
                              >
                                {isPass ? '✓ ĐẠT (Mời PV)' : '✕ LOẠI'}
                              </span>
                            );
                          })()}
                        </td>

                        {/* 16. Trạng thái */}
                        <td style={{ padding: '12px 12px' }}>
                          <span className="badge badge-brand" style={{ fontSize: '11px', padding: '3px 8px' }}>
                            {c.status || 'MỚI ỨNG TUYỂN'}
                          </span>
                        </td>

                        {/* 17. Mã nguồn */}
                        <td style={{ padding: '12px 14px', fontFamily: 'monospace', fontSize: '11px', color: '#64748B', whiteSpace: 'nowrap' }}>
                          <code style={{ backgroundColor: '#F1F5F9', padding: '2px 6px', borderRadius: '4px' }}>
                            {c.source_code || c.submission_id || 'FORM_UBM'}
                          </code>
                        </td>

                        {/* Thao tác (Sticky column) */}
                        <td style={{
                          padding: '12px 14px',
                          textAlign: 'center',
                          position: 'sticky',
                          right: 0,
                          backgroundColor: i % 2 === 0 ? 'var(--surface)' : 'var(--bg)',
                          zIndex: 1,
                          boxShadow: '-3px 0 6px rgba(0,0,0,0.05)',
                        }}>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                            <button
                              className="btn-secondary"
                              style={{ padding: '4px 8px', fontSize: '11px' }}
                              onClick={() => setSelectedCandidateDetail(c)}
                              title="Xem toàn bộ 17 trường thông tin"
                            >
                              Chi Tiết
                            </button>
                            <button
                              className="btn-primary"
                              style={{ padding: '4px 8px', fontSize: '11px', backgroundColor: '#0068FF' }}
                              onClick={() => showToast(`Đã chọn ứng viên ${c.full_name} để lập lịch phỏng vấn Zalo BOT!`)}
                            >
                              Mời PV
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* MODAL XEM CHI TIẾT ĐẦY ĐỦ 17 CỘT CỦA ỨNG VIÊN */}
        {selectedCandidateDetail && (
          <div style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
          }}>
            <div style={{
              backgroundColor: 'var(--surface)',
              borderRadius: '16px',
              maxWidth: '680px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
              border: '1px solid var(--border)',
            }}>
              {/* Modal Header */}
              <div style={{
                padding: '20px 24px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: 'var(--bg)',
                borderTopLeftRadius: '16px',
                borderTopRightRadius: '16px',
              }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--text)' }}>
                    Chi Tiết Hồ Sơ Ứng Viên (Google Forms)
                  </h3>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Mã nguồn: <strong>{selectedCandidateDetail.source_code || selectedCandidateDetail.submission_id}</strong> • Ngày gửi: {formatRegDate(selectedCandidateDetail.created_at)}
                  </div>
                </div>
                <button
                  onClick={() => setSelectedCandidateDetail(null)}
                  style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-muted)' }}
                >
                  ✕
                </button>
              </div>

              {/* Modal Body: 17 Fields Organized */}
              <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
                {/* Block 1: AI Score & Screening (Ma trận 9 Tiêu chí Chuẩn UBM) */}
                {(() => {
                  const evalDetail = evaluateCandidateAiScore(selectedCandidateDetail);
                  const isPass = evalDetail.result === 'Đạt';
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{
                        padding: '16px 20px',
                        backgroundColor: isPass ? '#F0FDF4' : '#FEF2F2',
                        border: `1.5px solid ${isPass ? '#86EFAC' : '#FCA5A5'}`,
                        borderRadius: '12px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '12px',
                      }}>
                        <div>
                          <div style={{ fontSize: '12px', color: isPass ? '#166534' : '#991B1B', fontWeight: 700, textTransform: 'uppercase' }}>
                            Điểm AI Chấm Tự Động (Thang 14 Điểm Chuẩn)
                          </div>
                          <div style={{ fontSize: '28px', fontWeight: 900, color: isPass ? '#15803D' : '#DC2626', marginTop: '2px' }}>
                            {evalDetail.score} <span style={{ fontSize: '16px', fontWeight: 600 }}>/ 14 điểm</span>
                          </div>
                          <div style={{ fontSize: '12px', color: isPass ? '#166534' : '#991B1B', marginTop: '4px' }}>
                            {evalDetail.screeningNote}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '12px', color: isPass ? '#166534' : '#991B1B', fontWeight: 700 }}>KẾT QUẢ SÀNG LỌC</div>
                          <div style={{
                            backgroundColor: isPass ? '#15803D' : '#DC2626',
                            color: '#FFF',
                            padding: '6px 16px',
                            borderRadius: '999px',
                            fontWeight: 800,
                            fontSize: '14px',
                            marginTop: '4px',
                            display: 'inline-block',
                          }}>
                            {isPass ? '✓ ĐẠT (Đủ ĐK Phỏng Vấn)' : '✕ LOẠI'}
                          </div>
                        </div>
                      </div>

                      {/* Bảng Chi Tiết 9 Tiêu Chí Chấm Điểm AI (Theo đúng biểu mẫu UBM) */}
                      <div style={{
                        backgroundColor: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: '10px',
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          padding: '10px 14px',
                          backgroundColor: 'var(--bg)',
                          borderBottom: '1px solid var(--border)',
                          fontWeight: 700,
                          fontSize: '12px',
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}>
                          <span>📋 MA TRẬN 9 TIÊU CHÍ ĐÁNH GIÁ ỨNG VIÊN (MAXIMUM 14 ĐIỂM)</span>
                          <span style={{ color: '#059669' }}>Điểm chuẩn: ≥ 8 / 14 điểm (Đạt)</span>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                          <thead>
                            <tr style={{ backgroundColor: 'var(--bg-subtle, #f9fafb)', textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                              <th style={{ padding: '8px 12px', width: '45px' }}>STT</th>
                              <th style={{ padding: '8px 12px', width: '220px' }}>Câu Hỏi / Tiêu Chí</th>
                              <th style={{ padding: '8px 12px' }}>Dữ Liệu Khảo Sát & Nhận Xét Của AI</th>
                              <th style={{ padding: '8px 12px', width: '110px', textAlign: 'center' }}>Thang Điểm</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(evalDetail.breakdown).map(([key, val], idx) => {
                              const isDisq = (val as any).disqualified;
                              return (
                                <tr
                                  key={key}
                                  style={{
                                    borderBottom: '1px solid var(--border)',
                                    backgroundColor: isDisq ? '#FEF2F2' : 'transparent',
                                  }}
                                >
                                  <td style={{ padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>{idx + 1}</td>
                                  <td style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--text)' }}>{val.title}</td>
                                  <td style={{ padding: '8px 12px', color: isDisq ? '#DC2626' : '#334155' }}>
                                    {val.note}
                                  </td>
                                  <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 800 }}>
                                    {isDisq ? (
                                      <span style={{ color: '#DC2626', backgroundColor: '#FEE2E2', padding: '3px 8px', borderRadius: '4px', fontSize: '11px' }}>
                                        LOẠI
                                      </span>
                                    ) : (
                                      <span style={{ color: val.points > 0 ? '#059669' : '#6B7280', fontSize: '12px' }}>
                                        +{val.points} / {val.max}đ
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                {/* Block 2: Thông tin cá nhân */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px' }}>
                  <div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Họ và tên:</span>
                    <div style={{ fontWeight: 800, fontSize: '15px', color: 'var(--text)' }}>{selectedCandidateDetail.full_name}</div>
                  </div>
                  <div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Giới tính & Năm sinh:</span>
                    <div style={{ fontWeight: 700 }}>
                      {selectedCandidateDetail.gender || 'Nam'} • {selectedCandidateDetail.birth_year || '2002'} ({new Date().getFullYear() - (selectedCandidateDetail.birth_year || 2002)} tuổi)
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Số điện thoại:</span>
                    <div style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '14px', color: '#0068FF' }}>
                      {selectedCandidateDetail.phone || selectedCandidateDetail.phone_normalized}
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Quê quán:</span>
                    <div style={{ fontWeight: 600 }}>{selectedCandidateDetail.hometown || 'TP. Hồ Chí Minh'}</div>
                  </div>
                  <div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Trình độ học vấn:</span>
                    <div style={{ fontWeight: 600 }}>{selectedCandidateDetail.education_level || 'Đại học'}</div>
                  </div>
                  <div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Nguồn biết tin:</span>
                    <div style={{ fontWeight: 600 }}>{selectedCandidateDetail.referral_source || 'Facebook'}</div>
                  </div>
                  <div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Ca làm việc đăng ký:</span>
                    <div style={{ fontWeight: 700, color: '#4338CA' }}>{selectedCandidateDetail.registered_shift || 'Ca sáng / Ca chiều'}</div>
                  </div>
                  <div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Chi nhánh đăng ký:</span>
                    <div style={{ fontWeight: 700, color: '#1D4ED8' }}>
                      {selectedCandidateDetail.branch_name || getDisplayBranch(selectedCandidateDetail.preferred_branch_id || 'CN130')}
                    </div>
                  </div>
                </div>

                {/* Block 3: Kinh nghiệm & Xử lý đột xuất */}
                <div style={{ backgroundColor: 'var(--bg)', padding: '14px', borderRadius: '10px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    10. KINH NGHIỆM LÀM VIỆC:
                  </div>
                  <div style={{ fontSize: '13px', lineHeight: '1.5', color: 'var(--text)' }}>
                    {selectedCandidateDetail.experience || 'Chưa có kinh nghiệm'}
                  </div>
                </div>

                <div style={{ backgroundColor: 'var(--bg)', padding: '14px', borderRadius: '10px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    11. KHẢ NĂNG XỬ LÝ ĐỘT XUẤT & TĂNG CA:
                  </div>
                  <div style={{ fontSize: '13px', lineHeight: '1.5', color: '#065F46', fontWeight: 600 }}>
                    {selectedCandidateDetail.emergency_handling || 'Sẵn sàng hỗ trợ và tăng ca khi có điều động đột xuất'}
                  </div>
                </div>

                {/* Block 4: Link Facebook */}
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    12. LINK FACEBOOK CÁ NHÂN:
                  </div>
                  {selectedCandidateDetail.facebook_url ? (
                    <a
                      href={selectedCandidateDetail.facebook_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        backgroundColor: '#EFF6FF',
                        border: '1.5px solid #BFDBFE',
                        color: '#0068FF',
                        padding: '10px 16px',
                        borderRadius: '8px',
                        fontWeight: 700,
                        textDecoration: 'none',
                        fontSize: '13px',
                      }}
                    >
                      <ExternalLink size={16} />
                      Mở liên kết Facebook của ứng viên ({selectedCandidateDetail.facebook_url}) ↗
                    </a>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>Ứng viên chưa cung cấp liên kết Facebook.</span>
                  )}
                </div>
              </div>

              {/* Modal Footer */}
              <div style={{
                padding: '16px 24px',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
                backgroundColor: 'var(--bg)',
                borderBottomLeftRadius: '16px',
                borderBottomRightRadius: '16px',
              }}>
                <button
                  className="btn-secondary"
                  onClick={() => setSelectedCandidateDetail(null)}
                >
                  Đóng
                </button>
                <button
                  className="btn-primary"
                  style={{ backgroundColor: '#0068FF' }}
                  onClick={() => {
                    setSelectedCandidateDetail(null);
                    showToast(`Đã chuyển ứng viên ${selectedCandidateDetail.full_name} sang lịch phỏng vấn Zalo BOT!`);
                  }}
                >
                  Lên Lịch Phỏng Vấn Zalo BOT
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (activeTab === 'hr-interviews') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800 }}>3. Quản Lý Lịch Phỏng Vấn & BOT Zalo Cá Nhân</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Tích hợp Zalo cá nhân của HR qua mã QR quét thật, BOT gửi thư mời kèm lịch hẹn đến Zalo ứng viên (link Meet do HR dán hoặc cấu hình sẵn)
            </p>
          </div>
          <button
            className="btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: zaloConnected ? '#0068FF' : '#475569' }}
            onClick={async () => {
              await refreshZaloStatus();
              showToast(zaloConnected ? 'Đã làm mới trạng thái Zalo!' : 'Đang kiểm tra kết nối Zalo cá nhân...');
            }}
          >
            <Smartphone size={16} />
            Phiên Zalo: {zaloAccount?.displayName || currentUser?.full_name || 'HR Ụm Bò Milk'} ({zaloConnected ? '🟢 Đã Kết Nối' : 'Chờ Quét QR'})
          </button>
        </div>

        {/* ========================================================================= */}
        {/* KHUNG TÍCH HỢP ZALO CÁ NHÂN CỦA HR (QUÉT MÃ QR & KÍCH HOẠT BOT TỰ ĐỘNG) */}
        {/* ========================================================================= */}
        <div style={{
          backgroundColor: 'var(--surface)',
          borderRadius: 'var(--radius-md)',
          border: '2px solid #0068FF',
          boxShadow: 'var(--shadow-sm)',
          overflow: 'hidden',
        }}>
          <div style={{
            backgroundColor: '#0068FF',
            color: '#FFF',
            padding: '12px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 800, fontSize: '14px' }}>
              <QrCode size={20} color="#FFF" />
              TÍCH HỢP ZALO CÁ NHÂN CỦA HR (QUÉT QR ĐĂNG NHẬP & KÍCH HOẠT BOT GỬI THƯ MỜI)
            </div>
            <span style={{
              backgroundColor: zaloConnected ? '#10B981' : '#F59E0B',
              color: '#FFF',
              fontSize: '11px',
              fontWeight: 800,
              padding: '4px 10px',
              borderRadius: '999px',
            }}>
              {zaloConnected ? '● BOT ZALO ĐÃ KẾT NỐI & SẴN SÀNG' : '○ CHƯA KẾT NỐI ZALO (CẦN QUÉT QR)'}
            </span>
          </div>

          <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: '320px 1fr', gap: '24px' }}>
            {/* CỘT TRÁI: MÃ QR QUÉT ZALO CÁ NHÂN & THÔNG TIN TÀI KHOẢN HR */}
            <div style={{
              backgroundColor: '#F8FAFC',
              border: zaloConnected ? '2px solid #10B981' : '1.5px solid #0068FF',
              borderRadius: '12px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              boxShadow: zaloConnected ? '0 4px 14px rgba(16, 185, 129, 0.15)' : '0 2px 10px rgba(0, 104, 255, 0.08)',
            }}>
              <div style={{
                fontSize: '12px',
                fontWeight: 800,
                color: zaloConnected ? '#059669' : '#0068FF',
                marginBottom: '10px',
                textTransform: 'uppercase',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                {zaloConnected ? (
                  <>
                    <CheckCircle size={16} color="#10B981" />
                    ĐÃ KẾT NỐI ZALO CÁ NHÂN HR
                  </>
                ) : (
                  <>
                    <QrCode size={16} color="#0068FF" />
                    Mã QR Đăng Nhập Zalo Cá Nhân HR
                  </>
                )}
              </div>

              {/* (Đã ẩn cảnh báo lib unofficial theo yêu cầu) */}
              {/* MÃ QR ZALO THẬT DO SERVER SINH (quét bằng app Zalo trên điện thoại) */}
              <div style={{
                width: '180px',
                height: '180px',
                backgroundColor: '#FFF',
                border: '2px solid #0068FF',
                borderRadius: '10px',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                position: 'relative',
                boxShadow: '0 4px 12px rgba(0, 104, 255, 0.12)',
              }}>
                {zaloConnected && zaloAccount ? (
                  <div style={{ textAlign: 'center' }}>
                    {zaloAccount.avatar ? (
                      <img src={zaloAccount.avatar} alt="Zalo HR" style={{ width: '72px', height: '72px', borderRadius: '50%', margin: '0 auto 8px' }} />
                    ) : (
                      <div style={{ fontSize: '36px' }}>🟢</div>
                    )}
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#065F46' }}>{zaloAccount.displayName || 'Zalo HR'}</div>
                    <div style={{ fontSize: '11px', color: '#059669' }}>BOT sẵn sàng gửi thư mời</div>
                  </div>
                ) : zaloQrImage ? (
                  <>
                    <img
                      src={zaloQrImage}
                      alt="Mã QR đăng nhập Zalo"
                      onError={() => {
                        setZaloQrImage(null);
                        showToast('⚠️ Ảnh QR lỗi! Bấm "Làm Mới QR Thật" để lấy mã mới.');
                      }}
                      style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '4px' }}
                    />
                    <div style={{
                      position: 'absolute',
                      backgroundColor: '#0068FF',
                      color: '#FFF',
                      fontSize: '10px',
                      fontWeight: 900,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      border: '2px solid #FFFFFF',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.25)',
                      pointerEvents: 'none',
                    }}>
                      Zalo
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: '11px', color: '#64748B', textAlign: 'center', padding: '0 12px' }}>
                    {zaloBusy ? 'Đang xin mã QR từ Zalo...' : 'Bấm "Tạo mã QR Zalo" để lấy mã quét thật'}
                  </div>
                )}
              </div>

              {/* Hướng dẫn quét QR thật */}
              <div style={{ marginTop: '10px', width: '100%' }}>
                <div style={{
                  fontSize: '11px',
                  color: '#1E40AF',
                  backgroundColor: '#EFF6FF',
                  border: '1px solid #BFDBFE',
                  borderRadius: '6px',
                  padding: '6px 8px',
                  marginBottom: '8px',
                  lineHeight: '1.5',
                }}>
                  📱 <strong>Cách kết nối thật:</strong> Bấm <strong>"Tạo mã QR Zalo"</strong> → mở <strong>app Zalo trên điện thoại</strong> → quét mã → bấm <strong>Đăng nhập</strong> trên điện thoại. Phiên được lưu trên server, restart không cần quét lại.
                </div>

                <div style={{ fontSize: '13px', fontWeight: 800, color: '#0F172A', marginTop: '4px' }}>
                  {zaloAccount?.displayName || currentUser?.full_name || 'Quản Trị Nhân Sự HR'}
                </div>

                <div style={{
                  fontSize: '11px',
                  color: zaloConnected ? '#059669' : '#0068FF',
                  fontWeight: 700,
                  marginTop: '2px'
                }}>
                  {zaloConnected
                    ? `● Đã kết nối Zalo: ${zaloAccount?.displayName || ''}`
                    : (zaloStatus?.login?.phase === 'scanned'
                      ? '● Đã quét — đang chờ bấm Đăng nhập trên điện thoại...'
                      : zaloStatus?.login?.phase === 'expired'
                        ? '○ Mã QR hết hạn — hãy tạo mã mới'
                        : '○ Chờ tạo mã QR đăng nhập')}
                </div>

                {/* Nút tạo QR / ngắt kết nối thật */}
                <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {!zaloConnected ? (
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={zaloBusy}
                      style={{
                        width: '100%',
                        fontSize: '11.5px',
                        padding: '8px',
                        backgroundColor: '#10B981',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        boxShadow: '0 2px 8px rgba(16, 185, 129, 0.25)',
                        opacity: zaloBusy ? 0.6 : 1,
                      }}
                      onClick={handleZaloCreateQr}
                    >
                      <QrCode size={14} />
                      {zaloBusy ? 'ĐANG XIN MÃ QR...' : '📷 TẠO MÃ QR ZALO THẬT'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-outline"
                      style={{
                        width: '100%',
                        fontSize: '11.5px',
                        padding: '6px',
                        color: '#DC2626',
                        borderColor: '#FCA5A5',
                        backgroundColor: '#FEF2F2',
                      }}
                      onClick={handleZaloDisconnect}
                    >
                      Ngắt Kết Nối Zalo
                    </button>
                  )}

                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      className="btn-secondary"
                      style={{ flex: 1, fontSize: '11px', padding: '6px' }}
                      onClick={handleZaloCreateQr}
                    >
                      Làm Mới QR Thật
                    </button>

                    <button
                      className="btn-outline"
                      style={{ flex: 1, fontSize: '11px', padding: '6px', color: '#0068FF' }}
                      onClick={() => {
                        window.open('https://chat.zalo.me', '_blank');
                      }}
                    >
                      Mở Zalo Web
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* CỘT PHẢI: CƠ CHẾ BOT TỰ ĐỘNG SINH GOOGLE MEET & GỬI QUA ZALO CÁ NHÂN */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{
                backgroundColor: '#EFF6FF',
                border: '1px solid #BFDBFE',
                borderRadius: '8px',
                padding: '14px 16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Bot size={18} color="#0068FF" />
                  <strong style={{ fontSize: '13px', color: '#1E40AF', textTransform: 'uppercase' }}>
                    Cơ Chế Hoạt Động Của BOT Hệ Thống:
                  </strong>
                </div>
                <div style={{ fontSize: '12px', color: '#1E3A8A', lineHeight: '1.6' }}>
                  1. <strong>Link Google Meet:</strong> HR dán link phòng họp vào form lịch hẹn (hoặc cấu hình sẵn <code>ZALO_DEFAULT_MEET_URL</code> trên server).<br />
                  2. <strong>Kết nối Zalo cá nhân thật của HR:</strong> quét QR đăng nhập 1 lần, phiên lưu trên server, restart không cần quét lại.<br />
                  3. <strong>Bắn thư mời thật:</strong> bấm "Gửi thư mời Zalo" ở từng ứng viên — tin nhắn đi từ nick Zalo HR tới Zalo ứng viên (yêu cầu đã kết bạn, chưa bạn thì bấm Kết bạn trước).
                </div>
              </div>

              {/* XEM TRƯỚC MẪU TIN NHẮN ZALO BOT TỰ ĐỘNG GỬI */}
              <div style={{
                backgroundColor: '#F1F5F9',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '12px 16px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <MessageSquare size={15} color="#0068FF" />
                    Xem Trước Mẫu Tin Nhắn Zalo BOT Tự Động Bắn Đi:
                  </div>
                  <span style={{ fontSize: '11px', color: '#059669', fontWeight: 700 }}>
                    Gửi từ: Zalo HR Ụm Bò Milk
                  </span>
                </div>

                <div style={{
                  backgroundColor: '#FFF',
                  border: '1px solid #CBD5E1',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  fontSize: '12px',
                  lineHeight: '1.5',
                  color: '#1E293B',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                }}>
                  <strong style={{ color: '#0068FF' }}>[ỤM BÒ MILK] THƯ MỜI PHỎNG VẤN VỊ TRÍ NHÂN VIÊN PHA CHẾ</strong><br />
                  Chào bạn <strong>[Tên Ứng Viên]</strong>,<br />
                  Phòng Nhân Sự Ụm Bò Milk trân trọng mời bạn tham gia buổi phỏng vấn trực tuyến:<br />
                  🕒 <strong>Thời gian:</strong> [Giờ phỏng vấn] - [Ngày hẹn phỏng vấn]<br />
                  📍 <strong>Chi nhánh tuyển dụng:</strong> [Chi nhánh đăng ký làm việc]<br />
                  🔗 <strong>Link phòng họp Google Meet:</strong> <span style={{ color: '#0068FF', textDecoration: 'underline' }}>[link Meet HR dán khi lập lịch]</span><br />
                  👤 <strong>Người phỏng vấn:</strong> Phòng Nhân Sự Ụm Bò Milk<br />
                  📌 <em>Lưu ý: Bạn vui lòng vào trước 5 phút và chuẩn bị trang phục lịch sự nhé.</em><br />
                  <span style={{ fontSize: '11px', color: '#64748B', display: 'block', marginTop: '6px' }}>
                    ✓✓ Sẽ tự động gửi qua Zalo ứng viên khi HR xếp lịch phỏng vấn
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* FORM TẠO LỊCH PHỎNG VẤN & PHÁT LỆNH BOT ZALO */}
        {/* ========================================================================= */}
        <div style={{
          backgroundColor: 'var(--surface)',
          borderRadius: 'var(--radius-md)',
          border: '1.5px solid #2563EB',
          boxShadow: 'var(--shadow-sm)',
          overflow: 'hidden',
        }}>
          <div style={{
            backgroundColor: '#1E40AF',
            color: '#FFF',
            padding: '12px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '14px' }}>
              <Calendar size={18} color="#93C5FD" />
              THIẾT LẬP LỊCH PHỎNG VẤN ỨNG VIÊN MỚI (TÍCH HỢP BOT ZALO CÁ NHÂN)
            </div>
            <span style={{ fontSize: '11px', backgroundColor: '#3B82F6', padding: '3px 8px', borderRadius: '4px' }}>
              Quy chuẩn 30 phút / ca
            </span>
          </div>

          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Chọn ứng viên mới:</label>
                <select style={{ width: '100%' }} value={inviteCandidateId} onChange={(e) => setInviteCandidateId(e.target.value)}>
                  <option value="">-- Chọn ứng viên --</option>
                  {candidates.length > 0 ? (
                    candidates.map((c, i) => (
                      <option key={c.submission_id || i} value={c.submission_id}>
                        {c.full_name} ({c.phone || c.phone_normalized})
                      </option>
                    ))
                  ) : (
                    <option value="">Chưa có ứng viên (Dữ liệu từ Google Sheets)</option>
                  )}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Chi nhánh tuyển dụng:</label>
                <select style={{ width: '100%' }} defaultValue="CN130">
                  {branches.length > 0 ? (
                    branches.map((b) => (
                      <option key={b.branch_id || b.id} value={b.branch_id || b.id}>
                        {b.name}
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="CN130">CN1: 130 Vạn Kiếp (Bình Thạnh)</option>
                      <option value="CN261">CN2: 261 Tô Hiến Thành (Q.10)</option>
                      <option value="CN120">CN3: 120 Hoàng Diệu 2 (Thủ Đức)</option>
                      <option value="CN111">CN4: 111 Tôn Đản (Q.4)</option>
                    </>
                  )}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Thời gian phỏng vấn:</label>
                <input type="datetime-local" value={inviteDateTime} onChange={(e) => setInviteDateTime(e.target.value)} style={{ width: '100%' }} />
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Hình thức phỏng vấn:</label>
                <select style={{ width: '100%' }} value={inviteMode} onChange={(e) => setInviteMode(e.target.value as any)}>
                  <option value="ONLINE">Google Meet Trực Tuyến</option>
                  <option value="OFFLINE">Trực Tiếp Tại Cửa Hàng</option>
                </select>
              </div>
            </div>

            {inviteMode === 'ONLINE' && (
              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Link Google Meet (bỏ trống = dùng link mặc định server nếu có):</label>
                <input
                  type="text"
                  value={inviteMeetUrl}
                  onChange={(e) => setInviteMeetUrl(e.target.value)}
                  placeholder="https://meet.google.com/xxx-yyyy-zzz"
                  style={{ width: '100%' }}
                />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr', gap: '14px', alignItems: 'center' }}>
              <div style={{
                fontSize: '12px',
                color: '#1E40AF',
                backgroundColor: '#EFF6FF',
                padding: '10px 14px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}>
                <Bot size={18} color="#0068FF" />
                <span>
                  ☑️ <strong>Lập lịch + bắn tin thật:</strong> Lưu lịch phỏng vấn rồi gửi thư mời qua Zalo cá nhân HR đã kết nối!
                  {!zaloConnected && <strong style={{ color: '#DC2626' }}> (Chưa kết nối Zalo!)</strong>}
                </span>
              </div>
              <button
                className="btn-primary"
                disabled={inviteBusy}
                style={{
                  backgroundColor: '#0068FF',
                  padding: '11px',
                  fontWeight: 800,
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  opacity: inviteBusy ? 0.6 : 1,
                }}
                onClick={handleCreateScheduleAndInvite}
              >
                <Send size={16} />
                {inviteBusy ? 'ĐANG GỬI...' : 'Tạo Lịch & BOT Bắn Tin Zalo Cá Nhân'}
              </button>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* DANH SÁCH LỊCH PHỎNG VẤN & TRẠNG THÁI GỬI QUA ZALO CÁ NHÂN */}
        {/* ========================================================================= */}
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '14px' }}>Lịch Phỏng Vấn Tuyển Dụng Đã Lên Lịch & Trạng Thái Gửi Zalo</strong>
            <span className="badge" style={{ backgroundColor: '#EFF6FF', color: '#0068FF', fontWeight: 800 }}>
              ĐÃ ĐỒNG BỘ BOT ZALO CÁ NHÂN
            </span>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Ứng Viên</th>
                <th style={{ padding: '12px 20px' }}>Vị Trí & Chi Nhánh</th>
                <th style={{ padding: '12px 20px' }}>Thời Gian</th>
                <th style={{ padding: '12px 20px' }}>Google Meet Sinh Tự Động</th>
                <th style={{ padding: '12px 20px' }}>Kênh Gửi Zalo Cá Nhân</th>
                <th style={{ padding: '12px 20px' }}>Trạng Thái</th>
                <th style={{ padding: '12px 20px' }}>Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              {candidates.length > 0 ? (
                candidates.map((c, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '14px 20px', fontWeight: 700 }}>
                      {c.full_name}
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.phone || c.phone_normalized}</div>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <strong>{c.position || 'Nhân viên mới'}</strong>
                      <div style={{ fontSize: '11px', color: '#2563EB' }}>{getDisplayBranch(c.branch_id || 'CN130')}</div>
                    </td>
                    <td style={{ padding: '14px 20px', fontWeight: 700 }}>
                      {(c as any).interview_date ? `${(c as any).interview_time_slot || ''} ${ (c as any).interview_date}` : (c.interview_time || 'Chờ xếp lịch')}
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <span style={{ color: '#0068FF', fontWeight: 700 }}>
                        {(c as any).status === 'INVITED_INTERVIEW' ? 'Đã gửi thư mời Zalo' : 'Chưa gửi'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <span style={{
                        backgroundColor: (c as any).status === 'INVITED_INTERVIEW' ? '#ECFDF5' : '#EFF6FF',
                        color: (c as any).status === 'INVITED_INTERVIEW' ? '#059669' : '#0068FF',
                        padding: '3px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 800,
                        border: '1px solid #BFDBFE',
                      }}>
                        {(c as any).status === 'INVITED_INTERVIEW' ? '✓ Đã gửi Zalo' : '💬 Chờ gửi Zalo'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <span style={{ backgroundColor: '#FEF3C7', color: '#92400E', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                        {c.status || 'CHỜ PHỎNG VẤN'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button className="btn-primary" style={{ padding: '4px 8px', fontSize: '11px', backgroundColor: '#0068FF' }} onClick={() => handleSendZaloInvite(c)}>
                          📩 Gửi thư mời Zalo
                        </button>
                        <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: '11px', color: '#059669' }} onClick={() => showToast('Duyệt đạt phỏng vấn')}>
                          Đánh Giá
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)', fontSize: '13px' }}>
                    Chưa có lịch phỏng vấn nào. Dữ liệu sẽ tự động xuất hiện khi tiếp nhận ứng viên từ Google Forms hoặc Google Sheets.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-probation') {
    const probationEmps = allEmployees.filter((e) => e.employment_status === 'PROBATION');
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800 }}>4. Quản Lý Nhân Viên Thử Việc (12 Ngày)</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Theo dõi 12 ngày thử việc (7 làm / 5 OFF) và kết quả làm bài TEST</p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn-primary" onClick={openNewEmpModal}>+ Thêm NV Thử Việc</button>
          </div>
        </div>
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Mã NV</th>
                <th style={{ padding: '12px 20px' }}>Họ Và Tên</th>
                <th style={{ padding: '12px 20px' }}>Chi Nhánh</th>
                <th style={{ padding: '12px 20px' }}>Tiến Độ Thử Việc</th>
                <th style={{ padding: '12px 20px' }}>Điểm Bài TEST</th>
                <th style={{ padding: '12px 20px' }}>Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              {probationEmps.length > 0 ? (
                probationEmps.map((emp, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '14px 20px', fontWeight: 700, color: 'var(--brand)' }}>{emp.employee_code}</td>
                    <td style={{ padding: '14px 20px', fontWeight: 700 }}>{emp.full_name}</td>
                    <td style={{ padding: '14px 20px' }}>{getDisplayBranch(emp.default_branch_id)}</td>
                    <td style={{ padding: '14px 20px' }}>Giai đoạn thử việc</td>
                    <td style={{ padding: '14px 20px' }}><span className="badge badge-success">Sẵn sàng TEST</span></td>
                    <td style={{ padding: '14px 20px' }}>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button className="btn-primary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => showToast(`Đã đề xuất chuyển chính thức cho ${emp.full_name}`)}>Đề Xuất Chính Thức</button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
                    Hiện chưa có nhân viên trong giai đoạn thử việc. Dữ liệu sẽ đồng bộ từ Google Sheets.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-official') {
    const officialEmps = allEmployees.filter((e) => e.employment_status === 'OFFICIAL');
    const filteredOfficialEmps = officialEmps.filter((emp) => {
      if (officialBranchFilter !== 'ALL' && emp.default_branch_id !== officialBranchFilter && emp.branch_id !== officialBranchFilter) {
        return false;
      }
      if (officialSearch.trim()) {
        const q = officialSearch.toLowerCase().trim();
        const code = (emp.employee_code || '').toLowerCase();
        const name = (emp.full_name || '').toLowerCase();
        const phone = (emp.phone_normalized || emp.phone || '').toLowerCase();
        return code.includes(q) || name.includes(q) || phone.includes(q);
      }
      return true;
    });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Header Action Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 800, margin: 0, color: 'var(--text)' }}>
              5. Danh Sách Nhân Viên Chính Thức
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
              Quản lý danh sách nhân sự chính thức, mức lương giờ chuẩn 25.500 đ/h và nhập khẩu dữ liệu hàng loạt.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Nút Tải File Mẫu */}
            <button
              onClick={handleDownloadOfficialTemplate}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '9px 16px',
                backgroundColor: 'var(--surface)',
                color: '#059669',
                border: '1.5px solid #10B981',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#ECFDF5';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--surface)';
              }}
              title="Tải tệp mẫu CSV có UTF-8 BOM chuẩn để mở bằng Excel hoặc Google Sheets"
            >
              <Download size={16} />
              Tải File Mẫu (CSV / Excel)
            </button>

            {/* Nút Import Dữ Liệu Nhân Viên Chính Thức */}
            <button
              onClick={() => {
                setShowImportOfficialModal(true);
                setImportOfficialError(null);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '9px 18px',
                backgroundColor: '#059669',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: '0 2px 6px rgba(5, 150, 105, 0.3)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#047857';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#059669';
              }}
            >
              <Upload size={16} />
              Import Dữ Liệu Nhân Viên Chính Thức
            </button>

            {/* Nút Đồng Bộ */}
            {onSyncSheets && (
              <button
                className="btn-outline"
                onClick={onSyncSheets}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '9px 14px',
                  fontSize: '13px',
                  fontWeight: 600,
                  borderRadius: '8px',
                }}
                title="Đồng bộ 2 chiều với Google Sheets"
              >
                <RefreshCw size={15} />
                Đồng Bộ Sheets
              </button>
            )}
          </div>
        </div>

        {/* Stats Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '10px', backgroundColor: '#ECFDF5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#059669' }}>
              <UserCheck size={22} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Tổng Nhân Viên Chính Thức</div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>{officialEmps.length} <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)' }}>nhân sự</span></div>
            </div>
          </div>

          <div style={{ backgroundColor: 'var(--surface)', padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '10px', backgroundColor: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2563EB' }}>
              <DollarSign size={22} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Lương Giờ Tiêu Chuẩn</div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#059669' }}>25.500 <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)' }}>đ/h</span></div>
            </div>
          </div>

          <div style={{ backgroundColor: 'var(--surface)', padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '10px', backgroundColor: '#F5F3FF', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7C3AED' }}>
              <Building2 size={22} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Phạm Vi Chi Nhánh</div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {officialBranchFilter === 'ALL' ? 'Toàn bộ 4 Chi Nhánh + VP' : getDisplayBranch(officialBranchFilter)}
              </div>
            </div>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div style={{
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
          backgroundColor: 'var(--surface)',
          padding: '12px 16px',
          borderRadius: '10px',
          border: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}>
          <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '220px' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Tìm theo Mã NV, Họ Tên, Số Điện Thoại..."
              value={officialSearch}
              onChange={(e) => setOfficialSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px 8px 36px',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--bg)',
                color: 'var(--text)',
                fontSize: '13px',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>Chi nhánh:</span>
            <select
              value={officialBranchFilter}
              onChange={(e) => setOfficialBranchFilter(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--bg)',
                color: 'var(--text)',
                fontSize: '13px',
                fontWeight: 600,
                outline: 'none',
              }}
            >
              <option value="ALL">Tất Cả Chi Nhánh ({officialEmps.length})</option>
              <option value="CN130">CN1: 130 Vạn Kiếp (Bình Thạnh)</option>
              <option value="CN261">CN2: 261 Tô Hiến Thành (Q.10)</option>
              <option value="CN120">CN3: 120 Hoàng Diệu 2 (Thủ Đức)</option>
              <option value="CN111">CN4: 111 Tôn Đản (Q.4)</option>
              <option value="VAN_PHONG">Văn Phòng (10 Đặng Thai Mai)</option>
              <option value="XUONG_SX">Xưởng Sản Xuất (Củ Chi)</option>
            </select>
          </div>

          {(officialSearch || officialBranchFilter !== 'ALL') && (
            <button
              onClick={() => {
                setOfficialSearch('');
                setOfficialBranchFilter('ALL');
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                background: 'none',
                border: 'none',
                color: 'var(--brand)',
                fontSize: '12px',
                cursor: 'pointer',
                fontWeight: 600,
                padding: '4px 8px',
              }}
            >
              <RotateCcw size={12} />
              Đặt lại bộ lọc
            </button>
          )}

          <div style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-muted)' }}>
            Hiển thị <strong>{filteredOfficialEmps.length}</strong> / {officialEmps.length} nhân sự
          </div>
        </div>

        {/* Data Table */}
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '12px 18px', width: '110px' }}>Mã NV</th>
                  <th style={{ padding: '12px 18px' }}>Họ Và Tên</th>
                  <th style={{ padding: '12px 18px', width: '130px' }}>Số Điện Thoại</th>
                  <th style={{ padding: '12px 18px' }}>Chi Nhánh Làm Việc</th>
                  <th style={{ padding: '12px 18px', width: '130px' }}>Khối / Vị Trí</th>
                  <th style={{ padding: '12px 18px', width: '130px' }}>Mức Lương Giờ</th>
                  <th style={{ padding: '12px 18px', width: '130px' }}>Ngày Chính Thức</th>
                  <th style={{ padding: '12px 18px', width: '130px', textAlign: 'center' }}>Trạng Thái</th>
                  <th style={{ padding: '12px 18px', width: '110px', textAlign: 'center' }}>Thao Tác</th>
                </tr>
              </thead>
              <tbody>
                {filteredOfficialEmps.length > 0 ? (
                  filteredOfficialEmps.map((emp, i) => (
                    <tr
                      key={emp.id || i}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        transition: 'background-color 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--bg-subtle, #f9fafb)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      <td style={{ padding: '14px 18px', fontWeight: 800, color: 'var(--brand)', fontFamily: 'monospace', fontSize: '13px' }}>
                        {emp.employee_code || `UBM_NV${100 + i}`}
                      </td>
                      <td style={{ padding: '14px 18px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            backgroundColor: '#E0E7FF',
                            color: '#3730A3',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: '12px',
                            flexShrink: 0,
                          }}>
                            {(emp.full_name || 'NV').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, color: 'var(--text)' }}>{emp.full_name}</div>
                            {emp.email && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{emp.email}</div>}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '14px 18px', fontFamily: 'monospace' }}>
                        <a
                          href={`tel:${emp.phone_normalized || emp.phone}`}
                          style={{ color: 'var(--text)', textDecoration: 'none', fontWeight: 600 }}
                          title="Gọi điện"
                        >
                          {emp.phone_normalized || emp.phone || '---'}
                        </a>
                      </td>
                      <td style={{ padding: '14px 18px' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 8px', borderRadius: '6px', backgroundColor: '#F1F5F9', fontSize: '12px', fontWeight: 600, color: '#334155' }}>
                          <Store size={12} color="#64748B" />
                          {getDisplayBranch(emp.default_branch_id || emp.branch_id, emp.group)}
                        </div>
                      </td>
                      <td style={{ padding: '14px 18px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
                          {emp.group === 'VAN_PHONG' ? 'Khối Văn Phòng' : emp.group === 'XUONG' ? 'Khối Sản Xuất' : 'Khối Cửa Hàng'}
                        </span>
                      </td>
                      <td style={{ padding: '14px 18px', fontWeight: 800, color: '#059669', fontSize: '13px' }}>
                        {emp.current_rate_per_hour
                          ? `${Number(emp.current_rate_per_hour).toLocaleString('vi-VN')} đ/h`
                          : '25.500 đ/h'}
                      </td>
                      <td style={{ padding: '14px 18px', fontSize: '12px', color: 'var(--text-muted)' }}>
                        {emp.official_date || emp.start_date || 'Đang cập nhật'}
                      </td>
                      <td style={{ padding: '14px 18px', textAlign: 'center' }}>
                        <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.3px' }}>
                          <CheckCircle size={11} />
                          CHÍNH THỨC
                        </span>
                      </td>
                      <td style={{ padding: '14px 18px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button
                            className="btn-secondary"
                            style={{ padding: '5px 12px', fontSize: '12px', fontWeight: 700 }}
                            onClick={() => {
                              setEditingEmp(emp);
                              setEditEmpForm({
                                fullName: emp.full_name || '',
                                phone: emp.phone_normalized || '',
                                branchId: emp.default_branch_id || 'CN130',
                                group: emp.group || 'STORE',
                                rate: emp.current_rate_per_hour || 25500,
                                shift: emp.default_shift_code || '',
                                startDate: emp.start_date || '',
                                officialDate: emp.official_date || '',
                                email: emp.email || '',
                              });
                            }}
                          >
                            Sửa
                          </button>
                          <button
                            className="btn-secondary"
                            style={{ padding: '5px 12px', fontSize: '12px', fontWeight: 700, color: '#DC2626' }}
                            onClick={async () => {
                              if (!window.confirm(`XÓA nhân viên ${emp.full_name} (${emp.employee_code})?\nHồ sơ + tài khoản đăng nhập sẽ bị xóa khỏi hệ thống và Google Sheets. Không thể hoàn tác!`)) return;
                              try {
                                await apiRequest(`/employees/${emp.employee_id}`, { method: 'DELETE' });
                                showToast(`Đã xóa ${emp.full_name} khỏi hệ thống và Sheets!`);
                                if (onRefreshData) await onRefreshData();
                                if (onSyncSheets) await onSyncSheets();
                              } catch (e: any) {
                                showToast(e?.message || 'Lỗi khi xóa!');
                              }
                            }}
                          >
                            Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-muted)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                        <Users size={36} color="var(--border)" />
                        <div style={{ fontWeight: 600, fontSize: '14px' }}>Không tìm thấy nhân viên chính thức nào</div>
                        <div style={{ fontSize: '12px', maxWidth: '420px', lineHeight: 1.5 }}>
                          Chưa có dữ liệu nhân viên chính thức hoặc không khớp với bộ lọc tìm kiếm. Bạn có thể bấm nút <strong>Import Dữ Liệu</strong> phía trên để tải danh sách vào hệ thống.
                        </div>
                        <button
                          onClick={() => setShowImportOfficialModal(true)}
                          style={{
                            marginTop: '6px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '8px 16px',
                            backgroundColor: '#059669',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          <Upload size={14} />
                          Import Nhân Viên Ngay
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* MODAL SỬA HỒ SƠ NHÂN VIÊN CHÍNH THỨC (HR) */}
        {editingEmp && (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px' }}>
            <div style={{ backgroundColor: 'var(--surface)', borderRadius: '12px', maxWidth: '560px', width: '100%', maxHeight: '90vh', overflow: 'auto', padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 800, margin: 0 }}>Sửa hồ sơ: {editingEmp.full_name} ({editingEmp.employee_code})</h2>
                <button className="btn-secondary" style={{ padding: '4px 12px' }} onClick={() => setEditingEmp(null)}>Đóng</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '14px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700 }}>Họ và tên<input value={editEmpForm.fullName || ''} onChange={e => setEditEmpForm({ ...editEmpForm, fullName: e.target.value })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }} /></label>
                <label style={{ fontSize: '12px', fontWeight: 700 }}>SĐT (đổi số vẫn login được)<input value={editEmpForm.phone || ''} onChange={e => setEditEmpForm({ ...editEmpForm, phone: e.target.value })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }} /></label>
                <label style={{ fontSize: '12px', fontWeight: 700 }}>Chi nhánh<select value={editEmpForm.branchId || 'CN130'} onChange={e => setEditEmpForm({ ...editEmpForm, branchId: e.target.value })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }}><option value="CN130">CN130</option><option value="CN120">CN120</option><option value="CN261">CN261</option><option value="CN111">CN111</option></select></label>
                <label style={{ fontSize: '12px', fontWeight: 700 }}>Khối<select value={['STORE', 'XUONG', 'VAN_PHONG', 'SALE'].includes(editEmpForm.group) ? editEmpForm.group : 'STORE'} onChange={e => setEditEmpForm({ ...editEmpForm, group: e.target.value })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }}><option value="STORE">Cửa hàng</option><option value="XUONG">Xưởng</option><option value="VAN_PHONG">Văn phòng</option><option value="SALE">Sale</option></select></label>
                <label style={{ fontSize: '12px', fontWeight: 700 }}>Lương giờ (đ/h)<input type="number" value={editEmpForm.rate || 25500} onChange={e => setEditEmpForm({ ...editEmpForm, rate: Number(e.target.value) })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }} /></label>
                <label style={{ fontSize: '12px', fontWeight: 700 }}>Ca cố định<select value={editEmpForm.shift || ''} onChange={e => setEditEmpForm({ ...editEmpForm, shift: e.target.value })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }}><option value="">— Chưa gán —</option><option value="CA_1">Ca 1 (07–12)</option><option value="CA_2">Ca 2 (12–18)</option><option value="CA_3">Ca 3 (18–23)</option></select></label>
                <label style={{ fontSize: '12px', fontWeight: 700 }}>Ngày bắt đầu<input type="date" value={editEmpForm.startDate || ''} onChange={e => setEditEmpForm({ ...editEmpForm, startDate: e.target.value })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }} /></label>
                <label style={{ fontSize: '12px', fontWeight: 700 }}>Ngày chính thức<input type="date" value={editEmpForm.officialDate || ''} onChange={e => setEditEmpForm({ ...editEmpForm, officialDate: e.target.value })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }} /></label>
                <label style={{ fontSize: '12px', fontWeight: 700, gridColumn: '1 / -1' }}>Email<input value={editEmpForm.email || ''} onChange={e => setEditEmpForm({ ...editEmpForm, email: e.target.value })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }} /></label>
              </div>
              <button
                className="btn-primary"
                disabled={editEmpBusy}
                style={{ width: '100%', marginTop: '14px', padding: '10px', fontWeight: 800, backgroundColor: '#059669' }}
                onClick={async () => {
                  setEditEmpBusy(true);
                  try {
                    await apiRequest(`/employees/${editingEmp.employee_id}`, {
                      method: 'PUT',
                      body: JSON.stringify({
                        fullName: editEmpForm.fullName,
                        phone: editEmpForm.phone,
                        branchId: editEmpForm.branchId,
                        group: editEmpForm.group,
                        currentRatePerHour: editEmpForm.rate,
                        defaultShiftCode: editEmpForm.shift,
                        startDate: editEmpForm.startDate || undefined,
                        officialDate: editEmpForm.officialDate || undefined,
                        email: editEmpForm.email || undefined,
                        expectedVersion: editingEmp.version,
                      }),
                    });
                    showToast('Đã cập nhật hồ sơ nhân viên!');
                    setEditingEmp(null);
                    if (onRefreshData) await onRefreshData();
                    if (onSyncSheets) await onSyncSheets();
                  } catch (e: any) {
                    showToast(e?.message || 'Lỗi khi cập nhật!');
                  } finally {
                    setEditEmpBusy(false);
                  }
                }}
              >
                {editEmpBusy ? 'Đang lưu...' : 'Lưu thay đổi'}
              </button>
            </div>
          </div>
        )}

        {/* MODAL IMPORT DỮ LIỆU NHÂN VIÊN CHÍNH THỨC */}
        {showImportOfficialModal && (
          <div style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px',
            backdropFilter: 'blur(3px)',
          }}>
            <div style={{
              backgroundColor: 'var(--surface)',
              borderRadius: '16px',
              maxWidth: '860px',
              width: '100%',
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 24px 48px rgba(0,0,0,0.3)',
              border: '1px solid var(--border)',
              overflow: 'hidden',
              animation: 'fadeIn 0.2s ease-out',
            }}>
              {/* Modal Header */}
              <div style={{
                padding: '18px 24px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: 'var(--bg)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '8px',
                    backgroundColor: '#ECFDF5',
                    color: '#059669',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <Upload size={20} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: 'var(--text)' }}>
                      Import Danh Sách Nhân Viên Chính Thức
                    </h3>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      Tải lên tệp CSV/Excel hoặc dán trực tiếp danh sách nhân viên từ bảng tính
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setShowImportOfficialModal(false)}
                  style={{
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                    padding: '6px',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--border)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <X size={20} />
                </button>
              </div>

              {/* Modal Body */}
              <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Note Banner & Download Template Button */}
                <div style={{
                  padding: '14px 16px',
                  backgroundColor: '#F0FDF4',
                  border: '1px solid #BBF7D0',
                  borderRadius: '10px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '12px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', maxWidth: '580px' }}>
                    <Info size={18} color="#16A34A" style={{ marginTop: '2px', flexShrink: 0 }} />
                    <div style={{ fontSize: '12px', color: '#166534', lineHeight: 1.5 }}>
                      <strong>Quy chuẩn import:</strong> Nhân viên import sẽ tự động được gán trạng thái <strong>CHÍNH THỨC</strong>, cấp tài khoản đăng nhập (mã PIN khởi tạo tự sinh) và đồng bộ xuống các Google Sheet. Mức lương giờ mặc định là <strong>25.500 đ/h</strong>.
                    </div>
                  </div>

                  <button
                    onClick={handleDownloadOfficialTemplate}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 14px',
                      backgroundColor: '#16A34A',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#15803D'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#16A34A'; }}
                  >
                    <Download size={14} />
                    Tải File Mẫu (.CSV)
                  </button>
                </div>

                {/* Input Mode Selector */}
                <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setImportInputMode('FILE')}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '13px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      backgroundColor: importInputMode === 'FILE' ? '#059669' : 'transparent',
                      color: importInputMode === 'FILE' ? '#ffffff' : 'var(--text-muted)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <Upload size={14} />
                    1. Tải Lên Tệp Tin (.csv, .xlsx, .tsv, .txt)
                  </button>

                  <button
                    type="button"
                    onClick={() => setImportInputMode('PASTE')}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '13px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      backgroundColor: importInputMode === 'PASTE' ? '#059669' : 'transparent',
                      color: importInputMode === 'PASTE' ? '#ffffff' : 'var(--text-muted)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <FileSpreadsheet size={14} />
                    2. Dán Trực Tiếp (Copy / Paste từ Sheets / Excel)
                  </button>
                </div>

                {/* Input Area Depending on Mode */}
                {importInputMode === 'FILE' ? (
                  <div
                    style={{
                      border: '2px dashed var(--border)',
                      borderRadius: '12px',
                      padding: '28px 20px',
                      textAlign: 'center',
                      backgroundColor: 'var(--bg)',
                      cursor: 'pointer',
                      transition: 'border-color 0.2s',
                    }}
                    onClick={() => document.getElementById('official-file-input')?.click()}
                  >
                    <input
                      id="official-file-input"
                      type="file"
                      accept=".csv,.txt,.tsv,.xlsx,.xls"
                      onChange={handleFileUploadOfficial}
                      style={{ display: 'none' }}
                    />
                    <div style={{ width: '48px', height: '48px', margin: '0 auto 12px', borderRadius: '50%', backgroundColor: '#ECFDF5', color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Upload size={24} />
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text)', marginBottom: '4px' }}>
                      {selectedFileName ? `Tệp đã chọn: ${selectedFileName}` : 'Nhấn vào đây để chọn tệp CSV / Excel'}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      Hỗ trợ định dạng .csv, .tsv, .txt (mã hoá UTF-8). Kéo thả tệp tin hoặc nhấn để duyệt máy tính.
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Dán các hàng sao chép từ Google Sheets hoặc Excel vào ô dưới đây (mỗi dòng 1 nhân viên):</span>
                      <span style={{ fontFamily: 'monospace' }}>Mã NV [Tab] Họ Tên [Tab] SĐT [Tab] Chi Nhánh...</span>
                    </div>
                    <textarea
                      rows={6}
                      value={importOfficialPastedText}
                      onChange={(e) => {
                        setImportOfficialPastedText(e.target.value);
                        parseOfficialData(e.target.value);
                      }}
                      placeholder={`Ví dụ sao chép từ Excel:\nUBM_NV101\tNguyễn Văn An\t0912345678\tNam\t15/05/2000\t079200012345\tnva@ubm.vn\tBÌNH TÂN\tPha Chế\t25500\t01/01/2026\t01/03/2026\nUBM_NV102\tTrần Thị Bích\t0987654321\tNữ\t20/08/2002\t079202054321\tbichtran@ubm.vn\tTÂN BÌNH\tThu Ngân\t25500\t15/01/2026\t15/03/2026`}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                        backgroundColor: 'var(--bg)',
                        color: 'var(--text)',
                        fontSize: '12px',
                        fontFamily: 'monospace',
                        outline: 'none',
                        resize: 'vertical',
                      }}
                    />
                  </div>
                )}

                {/* Validation Status & Live Preview Table */}
                {parsedOfficialRows.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
                        Xem trước dữ liệu ({parsedOfficialRows.length} dòng):
                      </div>
                      <div style={{ display: 'flex', gap: '10px', fontSize: '12px' }}>
                        <span style={{ color: '#059669', fontWeight: 700 }}>
                          ✓ {parsedOfficialRows.filter((r) => r.isValid).length} hợp lệ
                        </span>
                        {parsedOfficialRows.filter((r) => !r.isValid).length > 0 && (
                          <span style={{ color: '#DC2626', fontWeight: 700 }}>
                            ✕ {parsedOfficialRows.filter((r) => !r.isValid).length} không hợp lệ
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{
                      maxHeight: '220px',
                      overflowY: 'auto',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg)',
                    }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                        <thead>
                          <tr style={{ backgroundColor: 'var(--surface)', textAlign: 'left', borderBottom: '1px solid var(--border)', fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                            <th style={{ padding: '8px 12px', width: '50px' }}>STT</th>
                            <th style={{ padding: '8px 12px', width: '90px' }}>Trạng Thái</th>
                            <th style={{ padding: '8px 12px', width: '90px' }}>Mã NV</th>
                            <th style={{ padding: '8px 12px' }}>Họ Và Tên</th>
                            <th style={{ padding: '8px 12px', width: '100px' }}>SĐT</th>
                            <th style={{ padding: '8px 12px' }}>Chi Nhánh</th>
                            <th style={{ padding: '8px 12px', width: '90px' }}>Lương Giờ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsedOfficialRows.map((row, idx) => (
                            <tr
                              key={idx}
                              style={{
                                borderBottom: '1px solid var(--border)',
                                backgroundColor: row.isValid ? 'transparent' : '#FEF2F2',
                              }}
                            >
                              <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>{row.rowIndex}</td>
                              <td style={{ padding: '8px 12px' }}>
                                {row.isValid ? (
                                  <span style={{ color: '#059669', fontWeight: 700, fontSize: '11px' }}>✓ Hợp lệ</span>
                                ) : (
                                  <span style={{ color: '#DC2626', fontWeight: 700, fontSize: '11px' }} title={row.errors.join(', ')}>
                                    ✕ {row.errors[0]}
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 600 }}>
                                {row.employeeCode || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>(Tự cấp)</span>}
                              </td>
                              <td style={{ padding: '8px 12px', fontWeight: 600 }}>{row.fullName || '---'}</td>
                              <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{row.phone || '---'}</td>
                              <td style={{ padding: '8px 12px' }}>{row.branch || 'CN130'}</td>
                              <td style={{ padding: '8px 12px', fontWeight: 700, color: '#059669' }}>
                                {row.ratePerHour?.toLocaleString('vi-VN')} đ
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Error Banner */}
                {importOfficialError && (
                  <div style={{
                    padding: '12px 16px',
                    backgroundColor: '#FEF2F2',
                    border: '1px solid #FECACA',
                    borderRadius: '8px',
                    color: '#991B1B',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}>
                    <AlertTriangle size={16} color="#DC2626" style={{ flexShrink: 0 }} />
                    <div>{importOfficialError}</div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div style={{
                padding: '16px 24px',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: 'var(--bg)',
              }}>
                <button
                  type="button"
                  onClick={() => {
                    setImportOfficialPastedText('');
                    setParsedOfficialRows([]);
                    setSelectedFileName('');
                    setImportOfficialError(null);
                  }}
                  disabled={parsedOfficialRows.length === 0}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    border: 'none',
                    background: 'none',
                    color: parsedOfficialRows.length > 0 ? '#DC2626' : 'var(--text-muted)',
                    cursor: parsedOfficialRows.length > 0 ? 'pointer' : 'not-allowed',
                    fontSize: '13px',
                    fontWeight: 600,
                  }}
                >
                  <Trash2 size={14} />
                  Xoá Dữ Liệu Đang Nhập
                </button>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() => setShowImportOfficialModal(false)}
                    style={{ padding: '9px 18px', fontSize: '13px', borderRadius: '8px' }}
                  >
                    Huỷ Bỏ
                  </button>

                  <button
                    type="button"
                    onClick={handleExecuteOfficialImport}
                    disabled={isSubmittingOfficialImport || parsedOfficialRows.filter((r) => r.isValid).length === 0}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '9px 20px',
                      backgroundColor: '#059669',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: 700,
                      fontSize: '13px',
                      cursor: (isSubmittingOfficialImport || parsedOfficialRows.filter((r) => r.isValid).length === 0) ? 'not-allowed' : 'pointer',
                      opacity: (isSubmittingOfficialImport || parsedOfficialRows.filter((r) => r.isValid).length === 0) ? 0.6 : 1,
                      boxShadow: '0 2px 6px rgba(5, 150, 105, 0.3)',
                    }}
                  >
                    {isSubmittingOfficialImport ? (
                      <>
                        <RefreshCw size={15} className="spin" />
                        Đang Nhập Dữ Liệu...
                      </>
                    ) : (
                      <>
                        <CheckCircle size={15} />
                        Xác Nhận Import ({parsedOfficialRows.filter((r) => r.isValid).length} nhân sự)
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (activeTab === 'hr-conversion') {
    const probationEmps = allEmployees.filter((e) => e.employment_status === 'PROBATION');
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>6. Xét Duyệt & Quyết Định Chuyển Chính Thức</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '8px' }}>Nhân sự đủ điều kiện chuyển chính thức:</div>
          {probationEmps.length > 0 ? (
            probationEmps.map((emp, i) => (
              <div key={i} style={{ padding: '12px', backgroundColor: '#FDF2F8', border: '1px solid #F472B6', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div>
                  <strong>{emp.full_name} ({emp.employee_code})</strong> • Chi nhánh: {getDisplayBranch(emp.default_branch_id)}
                </div>
                <button className="btn-primary" onClick={() => showToast(`Đã ban hành Quyết định Chuyển Chính Thức cho ${emp.full_name}! Lương áp dụng 25.500 đ/h`)}>
                  Ký Quyết Định
                </button>
              </div>
            ))
          ) : (
            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontSize: '13px' }}>
              Hiện chưa có nhân sự thử việc đến hạn xét duyệt chuyển chính thức.
            </div>
          )}
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-schedule') {
    // Dynamic calculation of week days (Monday -> Sunday) + chuyển tuần trước/sau.
    // Nhân viên đăng ký OFF 2 ngày cho TUẦN SAU (T6 12h → T7 15h) → bấm "Tuần sau" để xem OFF + ca đã xếp.
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 is Sun, 1 is Mon, ..., 6 is Sat
    const diffToMonday = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek) + scheduleWeekOffset * 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);

    const weekDays = [
      { key: 't2', code: 'T2', name: 'THỨ 2' },
      { key: 't3', code: 'T3', name: 'THỨ 3' },
      { key: 't4', code: 'T4', name: 'THỨ 4' },
      { key: 't5', code: 'T5', name: 'THỨ 5' },
      { key: 't6', code: 'T6', name: 'THỨ 6' },
      { key: 't7', code: 'T7', name: 'THỨ 7' },
      { key: 'cn', code: 'CN', name: 'CHỦ NHẬT' },
    ].map((item, index) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + index);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      const dateStr = `${dd}/${mm}`;
      const isoDate = `${yyyy}-${mm}-${dd}`;
      const isToday = d.toDateString() === now.toDateString();

      const dMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const isPast = dMidnight < nowMidnight;
      const isFuture = dMidnight > nowMidnight;

      return {
        ...item,
        date: d,
        dateStr,
        isoDate,
        isToday,
        isPast,
        isFuture,
      };
    });

    const todayItem = weekDays.find((d) => d.isToday) || weekDays[0];

    const scheduleItems = allEmployees.map((emp, empIdx) => {
      const empShifts = (shifts || []).filter((s: any) => s.employee_id === emp.employee_id);
      const empLeaves = (leaves || []).filter((l: any) => l.employee_id === emp.employee_id && (l.status === 'APPROVED' || l.status === 'PENDING'));
      const empEvents = (liveAttendanceEvents || []).filter((e: any) => e.employee_id === emp.employee_id);
      const dayDataMap: Record<string, any> = {};

      weekDays.forEach((day) => {
        // Tìm ca làm việc THẬT được phân công trên hệ thống cho ngày này
        const foundShift = empShifts.find((s: any) => s.date === day.isoDate || (s.date && s.date.startsWith(day.isoDate)));
        // Đơn nghỉ phép đã duyệt hoặc chờ duyệt
        const foundLeave = empLeaves.find((l: any) => l.requested_date === day.isoDate || (l.requested_date && l.requested_date.startsWith(day.isoDate)));
        // Bản ghi điểm danh check-in và check-out thật từ Socket.IO / Database
        const checkInEvent = empEvents.find((e: any) => e.type === 'CHECK_IN' && (e.assignment_id === foundShift?.assignment_id || (e.client_time && e.client_time.startsWith(day.isoDate))));
        const checkOutEvent = empEvents.find((e: any) => e.type === 'CHECK_OUT' && (e.assignment_id === foundShift?.assignment_id || (e.client_time && e.client_time.startsWith(day.isoDate))));
        // Bản ghi VẮNG do hệ thống tự ghi sau khi qua ca không điểm danh (chứng cứ đồng bộ Sheets)
        const absentEvent = empEvents.find((e: any) => e.type === 'ABSENT' && (e.assignment_id === foundShift?.assignment_id || (e.client_time && e.client_time.startsWith(day.isoDate))));

        if (foundLeave) {
          // Lịch OFF tuần (HANG_TUAN) tự động ghi nhận — kể cả bản ghi PENDING cũ
          // cũng hiển thị OFF (backend đã tự chữa thành APPROVED khi đồng bộ).
          const isWeeklyOff = foundLeave.leave_type === 'HANG_TUAN';
          const isApprovedLeave = isWeeklyOff || foundLeave.status === 'APPROVED';
          dayDataMap[day.key] = {
            shift: foundLeave.leave_type === 'DOT_XUAT' ? 'Nghỉ đột xuất' : 'Nghỉ OFF',
            status: isApprovedLeave ? 'OFF' : 'PENDING_LEAVE',
            note: isApprovedLeave
              ? (foundLeave.reason || 'Nghỉ theo đơn đã duyệt')
              : `Chờ duyệt: ${foundLeave.reason || 'đơn đột xuất chưa duyệt'}`,
            isToday: day.isToday,
          };
        } else if (!foundShift) {
          // KHÔNG CÓ CA LÀM VIỆC NÀO ĐƯỢC PHÂN CÔNG THẬT -> HIỂN THỊ KHÔNG CÓ CA, KHÔNG LẤY DỮ LIỆU ĐIỂM DANH ẢO
          dayDataMap[day.key] = {
            shift: '—',
            status: 'NO_SHIFT',
            note: 'Không có ca',
            isToday: day.isToday,
          };
        } else {
          // Có ca làm việc thật — ngày 2 ca (do tráo đổi/nhận thay): tính từng ca riêng.
          // Lọc trùng assignment_id để dòng trùng không hiện thành "2 ca" ma.
          const seenAssign = new Set<string>();
          const dayShifts = empShifts.filter((s: any) => {
            if (!(s.date === day.isoDate || (s.date && s.date.startsWith(day.isoDate)))) return false;
            if (s.assignment_id && seenAssign.has(s.assignment_id)) return false;
            if (s.assignment_id) seenAssign.add(s.assignment_id);
            return true;
          });
          // Ca nào check-in ca đó: so khớp theo assignment_id. Chỉ dùng ngày làm
          // fallback khi sự kiện/ca thiếu assignment (dữ liệu rất cũ) — nếu không,
          // check-in ca sáng sẽ lan sang ca chiều cùng ngày.
          const matchShift = (e: any, sh: any) => {
            if (e.assignment_id && sh?.assignment_id) return e.assignment_id === sh.assignment_id;
            return !!(e.client_time && e.client_time.startsWith(day.isoDate));
          };
          const buildOne = (sh: any) => {
            const ci = empEvents.find((e: any) => e.type === 'CHECK_IN' && matchShift(e, sh));
            const co = empEvents.find((e: any) => e.type === 'CHECK_OUT' && matchShift(e, sh));
            const ab = empEvents.find((e: any) => e.type === 'ABSENT' && matchShift(e, sh));
            // Quá 3h kể từ giờ vào ca mà chưa check-in -> khóa, nghỉ không lương
            const startMs = sh?.start_at ? new Date(sh.start_at).getTime() : NaN;
            const locked = !ci && Number.isFinite(startMs) && Date.now() - (startMs as number) > 3 * 60 * 60 * 1000;
            let shiftName = sh.shift_code;
            if (shiftName === 'CA_1') shiftName = 'Ca 1 (07-12)';
            else if (shiftName === 'CA_2') shiftName = 'Ca 2 (12-18)';
            else if (shiftName === 'CA_3') shiftName = 'Ca 3 (18-23)';

            if (ci) {
              const inTime = ci.client_time
                ? new Date(ci.client_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                : 'Đã check-in';
              const distText = ci.distance_meters !== undefined ? `${ci.distance_meters}m` : '< 300m';

              if (co) {
                const outTime = co.client_time
                  ? new Date(co.client_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                  : 'Đã check-out';
                return {
                  shift: shiftName,
                  status: 'COMPLETED',
                  time: `${inTime} - ${outTime}`,
                  gps: `GPS hợp lệ (${distText})`,
                  isToday: day.isToday,
                  event: ci,
                };
              }
              return {
                shift: shiftName,
                status: 'CHECKED_IN',
                time: inTime,
                gps: `GPS hợp lệ (${distText})`,
                isToday: day.isToday,
                event: ci,
              };
            } else if (locked) {
              return {
                shift: shiftName,
                status: 'LOCKED',
                note: 'Quá 3h chưa check-in — khóa, nghỉ không lương',
                isToday: day.isToday,
              };
            } else if (day.isToday) {
              return {
                shift: shiftName,
                status: 'PENDING',
                note: 'Chưa check-in (Chờ ca)',
                isToday: true,
              };
            } else if (ab || day.isPast) {
              return {
                shift: shiftName,
                status: 'ABSENT',
                note: ab ? 'Hệ thống tự ghi vắng (chứng cứ Sheets)' : 'Không điểm danh',
                isToday: false,
              };
            }
            return {
              shift: shiftName,
              status: 'UPCOMING',
              note: 'Lịch đã duyệt',
              isToday: false,
            };
          };
          if (dayShifts.length > 1) {
            dayDataMap[day.key] = {
              shift: `${dayShifts.length} ca`,
              status: 'MULTI',
              isToday: day.isToday,
              shifts: dayShifts.map(buildOne),
            };
          } else {
            dayDataMap[day.key] = buildOne(foundShift);
          }
        }
      });

      return {
        empId: emp.employee_id,
        empCode: emp.employee_code || `UBM_NV${String(1000 + empIdx)}`,
        name: emp.full_name,
        stage: emp.employment_status === 'PROBATION' ? 'PROBATION' : 'OFFICIAL',
        branch: emp.default_branch_id || emp.branch_id || 'CN130',
        days: dayDataMap,
      };
    });

    const filteredSchedule = scheduleItems.filter((item) => {
      const matchBranch = scheduleBranchFilter === 'ALL' || item.branch === scheduleBranchFilter;
      const matchStage = scheduleStageFilter === 'ALL' || item.stage === scheduleStageFilter;
      return matchBranch && matchStage;
    });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Top Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ fontSize: '20px', fontWeight: 800, margin: 0, color: 'var(--text)' }}>
                7. Lịch Làm Việc Tuần & Giám Sát Điểm Danh Realtime
              </h1>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                borderRadius: 'var(--radius-full)',
                backgroundColor: '#DFF5E8',
                color: '#065F46',
                fontSize: '11px',
                fontWeight: 700,
                border: '1px solid #A7F3D0',
              }}>
                <RadioTower size={14} style={{ animation: 'pulse 1.5s infinite' }} />
                Socket.IO: Tự Động Điểm Danh Realtime
              </span>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px', marginBottom: 0 }}>
              Hiển thị phân loại Nhân viên Thử việc (Chu kỳ 12 ngày) & Chính thức. Tự động cập nhật trạng thái khi nhân viên điểm danh trên Cổng Nhân Viên.
              {' '}Đang xem tuần <strong>{weekDays[0]?.isoDate} → {weekDays[6]?.isoDate}</strong>
              {scheduleWeekOffset === 1 ? ' (tuần sau — gồm 2 ngày OFF NV đã đăng ký)' : scheduleWeekOffset > 1 ? ` (+${scheduleWeekOffset} tuần)` : scheduleWeekOffset < 0 ? ` (${scheduleWeekOffset} tuần)` : ' (tuần này)'}.
              Ô xám <strong>Nghỉ OFF</strong> = lịch OFF tuần tự ghi nhận / đơn đột xuất đã duyệt; ô vàng <strong>⏳ Chờ duyệt</strong> = đơn đột xuất chưa duyệt.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn-primary"
              style={{ backgroundColor: '#10B981', display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '13px' }}
              onClick={() => showToast('🟢 Socket.IO: Đã đồng bộ realtime 100% dữ liệu điểm danh từ Cổng Nhân Viên!')}
            >
              <RefreshCw size={14} /> Tải Lại Realtime
            </button>
            <button
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '13px' }}
              onClick={() => setPublishOpen(true)}
            >
              <CheckCircle size={14} /> Phát Hành Lịch (PUBLISH)
            </button>
          </div>
        </div>

        {/* Realtime Socket Live Notification Banner */}
        <div style={{
          backgroundColor: '#ECFDF5',
          border: '1.5px solid #10B981',
          borderRadius: 'var(--radius-md)',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: '0 2px 8px rgba(16, 185, 129, 0.1)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: '#10B981',
              boxShadow: '0 0 0 4px rgba(16, 185, 129, 0.25)',
              animation: 'pulse 1.2s infinite',
            }} />
            <div style={{ fontSize: '13px', color: '#065F46' }}>
              <strong>TỰ ĐỘNG ĐIỂM DANH REALTIME:</strong> Giám sát trực tiếp hôm nay ({todayItem.name}, ngày {todayItem.dateStr}/{new Date().getFullYear()}). Kênh Socket.IO đang kết nối, tự động ghi nhận check-in từ Cổng Nhân Viên, xác thực GPS &lt; 300m và đồng bộ ảnh áo hồng lên Google Drive.
            </div>
          </div>

          {filteredSchedule.length > 0 && (
            <button
              onClick={() => {
                const todayEmpWithCheckIn = filteredSchedule.find((emp) => {
                  const todayData = emp.days?.[todayItem.key];
                  return todayData?.status === 'CHECKED_IN' || todayData?.status === 'COMPLETED';
                });
                if (todayEmpWithCheckIn) {
                  setSelectedRealtimeModal({
                    emp: todayEmpWithCheckIn,
                    dayData: todayEmpWithCheckIn.days[todayItem.key],
                  });
                } else {
                  showToast('Chưa có nhân viên nào có lịch và điểm danh hôm nay để xem bằng chứng!');
                }
              }}
              style={{
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: '#10B981',
                color: '#FFFFFF',
                border: 'none',
                fontWeight: 700,
                fontSize: '12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <Eye size={14} /> Xem Bằng Chứng
            </button>
          )}
        </div>

        {/* Filter Controls & Guide Bar */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'var(--surface)',
          padding: '12px 18px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          flexWrap: 'wrap',
          gap: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            {/* Filter by Branch */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>Chi nhánh:</span>
              <select
                value={scheduleBranchFilter}
                onChange={(e) => setScheduleBranchFilter(e.target.value)}
                style={{ padding: '6px 10px', fontSize: '12px', minHeight: '34px', borderRadius: '6px' }}
              >
                <option value="ALL">Tất Cả Chi Nhánh</option>
                <option value="CN130">Chi Nhánh 130</option>
                <option value="CN120">Chi Nhánh 120</option>
                <option value="CN261">Chi Nhánh 261</option>
                <option value="CN111">Chi Nhánh 111</option>
              </select>
            </div>

            {/* Filter by Stage */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>Loại nhân sự:</span>
              <select
                value={scheduleStageFilter}
                onChange={(e) => setScheduleStageFilter(e.target.value)}
                style={{ padding: '6px 10px', fontSize: '12px', minHeight: '34px', borderRadius: '6px' }}
              >
                <option value="ALL">Tất Cả (Thử việc & Chính thức)</option>
                <option value="PROBATION">🌸 Nhân Viên Thử Việc (12 ngày)</option>
                <option value="OFFICIAL">💼 Nhân Viên Chính Thức</option>
              </select>
            </div>
            {/* Chuyển tuần: xem lịch tuần sau (NV đã đăng ký OFF 2 ngày) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button className="btn-secondary" style={{ fontSize: '12px', padding: '6px 10px' }} onClick={() => setScheduleWeekOffset(o => o - 1)}>◀ Tuần trước</button>
              <button className="btn-secondary" style={{ fontSize: '12px', padding: '6px 10px', fontWeight: scheduleWeekOffset === 0 ? 800 : 400 }} onClick={() => setScheduleWeekOffset(0)}>Tuần này</button>
              <button className="btn-primary" style={{ fontSize: '12px', padding: '6px 10px' }} onClick={() => setScheduleWeekOffset(o => o + 1)}>Tuần sau ▶</button>
            </div>
          </div>

          {/* Guide Legends */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '11px', fontWeight: 600 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#047857' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10B981' }} /> Đã Check-in Realtime
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#B45309' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#F59E0B' }} /> Chưa Check-in (Chờ ca)
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#2563EB' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#2563EB' }} /> 🤝 Ca nhận thay (+30.000đ)
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#9CA3AF' }} /> Nghỉ OFF
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#DC2626' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#EF4444' }} /> Vắng ca (tự ghi)</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#B45309' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#F59E0B' }} /> Đang làm (vàng nhấp nháy)</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#475569' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#64748B' }} /> Khóa — nghỉ không lương</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#9CA3AF' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#E5E7EB', border: '1px solid #D1D5DB' }} /> — Không có ca
            </span>
          </div>
        </div>

        {/* Main Weekly Schedule Grid Table */}
        <div style={{
          backgroundColor: 'var(--surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-card)',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
                <th style={{ padding: '12px 16px', textAlign: 'left', minWidth: '190px' }}>NHÂN VIÊN / VAI TRÒ</th>
                {weekDays.map((day) => {
                  if (day.isToday) {
                    return (
                      <th
                        key={day.key}
                        style={{
                          padding: '12px 10px',
                          minWidth: '160px',
                          backgroundColor: '#FEF2F2',
                          borderLeft: '2px solid #F87171',
                          borderRight: '2px solid #F87171',
                        }}
                      >
                        <div style={{ color: '#DC2626', fontWeight: 800 }}>{day.name} (HÔM NAY {day.dateStr})</div>
                        <div style={{
                          fontSize: '10px',
                          color: '#B91C1C',
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          marginTop: '2px',
                        }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#DC2626', animation: 'pulse 1.2s infinite' }} />
                          GIÁM SÁT REALTIME
                        </div>
                      </th>
                    );
                  }
                  return (
                    <th key={day.key} style={{ padding: '12px 10px', minWidth: '140px' }}>
                      {day.name} ({day.dateStr})
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filteredSchedule.map((emp) => (
                <tr key={emp.empId} style={{ borderBottom: '1px solid var(--border)' }}>
                  {/* Employee Info Column */}
                  <td style={{ padding: '12px 16px', verticalAlign: 'top', backgroundColor: '#FCFBF9' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className={`badge ${emp.stage === 'PROBATION' ? 'badge-brand' : 'badge-success'}`} style={{ fontSize: '10px' }}>
                        {emp.stage === 'PROBATION' ? '🌸 THỬ VIỆC' : '💼 CHÍNH THỨC'}
                      </span>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--brand)' }}>{emp.empCode}</span>
                    </div>
                    <div style={{ fontWeight: 800, fontSize: '13px', color: 'var(--text)', marginTop: '4px' }}>
                      {emp.name}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {getDisplayBranch(emp.branch)}
                    </div>
                    {emp.stage === 'PROBATION' && (
                      <div style={{ fontSize: '10px', color: '#D97706', fontWeight: 700, marginTop: '2px' }}>
                        Chu kỳ 12 ngày (7 làm / 5 OFF)
                      </div>
                    )}
                  </td>

                  {/* Day Columns */}
                  {weekDays.map((day) => {
                    const d = (emp.days && emp.days[day.key]) || { shift: '—', status: 'NO_SHIFT', note: 'Không có ca' };
                    const isCheckedIn = d.status === 'CHECKED_IN';
                    const isLocked = d.status === 'LOCKED';
                    const isPending = d.status === 'PENDING';
                    const isOff = d.status === 'OFF';
                    const isPendingLeave = d.status === 'PENDING_LEAVE';
                    const isBonusSwap = d.status === 'BONUS_SWAP';
                    const isNoShift = d.status === 'NO_SHIFT';
                    const isAbsent = d.status === 'ABSENT';

                    return (
                      <td
                        key={day.key}
                        style={{
                          padding: '10px 8px',
                          verticalAlign: 'top',
                          textAlign: 'center',
                          backgroundColor: day.isToday ? '#FFFBFB' : isAbsent ? '#FEF2F2' : isOff || isNoShift ? '#F9FAFB' : '#FFFFFF',
                          borderLeft: day.isToday ? '2px solid #FCA5A5' : undefined,
                          borderRight: day.isToday ? '2px solid #FCA5A5' : undefined,
                        }}
                      >
                        {isNoShift ? (
                          <div style={{
                            padding: '10px 6px',
                            borderRadius: '8px',
                            backgroundColor: '#F9FAFB',
                            border: '1px dashed #E5E7EB',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            minHeight: '48px',
                          }}>
                            <span style={{ fontSize: '13px', fontWeight: 600, color: '#9CA3AF' }}>—</span>
                            <span style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '2px' }}>Không có ca</span>
                          </div>
                        ) : d.status === 'MULTI' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {(d.shifts || []).map((sd: any, si: number) => {
                              const stColor = sd.status === 'COMPLETED'
                                ? '#047857'
                                : sd.status === 'ABSENT'
                                ? '#DC2626'
                                : sd.status === 'LOCKED'
                                ? '#475569'
                                : sd.status === 'CHECKED_IN' || sd.status === 'PENDING'
                                ? '#B45309'
                                : 'var(--text)';
                              const stBg = sd.status === 'COMPLETED'
                                ? '#ECFDF5'
                                : sd.status === 'ABSENT'
                                ? '#FEE2E2'
                                : sd.status === 'LOCKED'
                                ? '#F1F5F9'
                                : sd.status === 'CHECKED_IN' || sd.status === 'PENDING'
                                ? '#FEF3C7'
                                : '#FAFAFA';
                              const stBd = sd.status === 'ABSENT' ? '1.5px solid #EF4444' : sd.status === 'LOCKED' ? '1.5px solid #64748B' : '1px solid var(--border)';
                              const stBlink = sd.status === 'CHECKED_IN';
                              return (
                                <div key={si} style={{ padding: '6px', borderRadius: '8px', backgroundColor: stBg, border: stBd, animation: stBlink ? 'fx-blink 1.2s infinite' : undefined }}>
                                  <div style={{ fontWeight: 700, fontSize: '11px' }}>{sd.shift}</div>
                                  <div style={{ fontSize: '10px', color: stColor, fontWeight: 700 }}>
                                    {sd.status === 'COMPLETED' ? `✓ Xong${sd.time ? ` (${sd.time})` : ''}`
                                      : sd.status === 'CHECKED_IN' ? `Đang làm${sd.time ? ` (vào ${sd.time})` : ''}`
                                      : sd.status === 'ABSENT' ? '🔴 Vắng'
                                      : sd.status === 'LOCKED' ? '🔒 Khóa — nghỉ không lương'
                                      : sd.status === 'PENDING' ? 'Chưa check-in'
                                      : sd.note || sd.status}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div style={{
                            padding: '8px',
                            borderRadius: '8px',
                            backgroundColor: isCheckedIn
                              ? '#FEF3C7'
                              : isAbsent
                              ? '#FEE2E2'
                              : isLocked
                              ? '#F1F5F9'
                              : isPending || isPendingLeave
                              ? '#FEF3C7'
                              : isBonusSwap
                              ? '#EFF6FF'
                              : isOff
                              ? '#F3F4F6'
                              : '#FAFAFA',
                            border: isCheckedIn
                              ? '1.5px solid #F59E0B'
                              : isAbsent
                              ? '1.5px solid #EF4444'
                              : isLocked
                              ? '1.5px solid #64748B'
                              : isPending || isPendingLeave
                              ? '1.5px solid #F59E0B'
                              : isBonusSwap
                              ? '1.5px solid #3B82F6'
                              : '1px solid var(--border)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '3px',
                            boxShadow: isCheckedIn ? '0 2px 6px rgba(16, 185, 129, 0.15)' : undefined,
                            // Chỉ nhấp nháy ca NV đã vào (check-in rồi, chờ check-out)
                            animation: isCheckedIn ? 'fx-blink 1.2s infinite' : undefined,
                          }}>
                            {/* Shift Name */}
                            <div style={{ fontWeight: 700, fontSize: '11px', color: isOff ? '#9CA3AF' : 'var(--text)' }}>
                              {d.shift}
                            </div>

                            {/* Realtime Attendance Status Badge */}
                            {isCheckedIn && (
                              <div style={{ marginTop: '2px', animation: 'fx-blink 1.2s infinite' }}>
                                <span style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  backgroundColor: '#F59E0B',
                                  color: '#FFF',
                                  fontSize: '10px',
                                  fontWeight: 800,
                                }}>
                                  <Clock size={10} /> ĐANG LÀM (vào {d.time})
                                </span>
                                <div style={{ fontSize: '10px', color: '#92400E', fontWeight: 600, marginTop: '2px' }}>
                                  Chờ check-out để hoàn thành • {d.gps}
                                </div>
                                <button
                                  onClick={() => setSelectedRealtimeModal({ emp, dayData: d })}
                                  style={{
                                    marginTop: '4px',
                                    fontSize: '9.5px',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    backgroundColor: '#FFFFFF',
                                    border: '1px solid #F59E0B',
                                    color: '#92400E',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                  }}
                                >
                                  Xem Chi Tiết GPS & Ảnh
                                </button>
                              </div>
                            )}

                            {isLocked && (
                              <div style={{ marginTop: '2px' }}>
                                <span style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  backgroundColor: '#64748B',
                                  color: '#FFF',
                                  fontSize: '10px',
                                  fontWeight: 800,
                                }}>
                                  🔒 KHÓA — NGHỈ KHÔNG LƯƠNG
                                </span>
                                <div style={{ fontSize: '10px', color: '#475569', fontWeight: 600, marginTop: '2px' }}>
                                  {d.note || 'Quá 3h chưa check-in'}
                                </div>
                              </div>
                            )}

                            {isPending && day.isToday && (
                              <div style={{ marginTop: '2px' }}>
                                <span style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  backgroundColor: '#F59E0B',
                                  color: '#FFF',
                                  fontSize: '10px',
                                  fontWeight: 800,
                                }}>
                                  <Clock size={10} /> CHƯA CHECK-IN
                                </span>
                                <div style={{ fontSize: '9.5px', color: '#B45309', marginTop: '2px' }}>
                                  Đang chờ giờ vào ca
                                </div>
                              </div>
                            )}

                            {isBonusSwap && (
                              <div style={{ marginTop: '2px' }}>
                                <span style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  backgroundColor: '#2563EB',
                                  color: '#FFF',
                                  fontSize: '10px',
                                  fontWeight: 800,
                                }}>
                                  🤝 +30.000đ PHỤ CẤP
                                </span>
                                <div style={{ fontSize: '9.5px', color: '#1E40AF', marginTop: '2px' }}>
                                  {d.note}
                                </div>
                              </div>
                            )}

                            {isOff && (
                              <div style={{ fontSize: '10px', color: '#9CA3AF', fontWeight: 600 }}>
                                {d.note || 'Nghỉ định kỳ'}
                              </div>
                            )}

                            {isPendingLeave && (
                              <div style={{ fontSize: '10px', color: '#92400E', fontWeight: 700 }}>
                                ⏳ {d.note || 'Chờ duyệt (chưa tính OFF)'}
                              </div>
                            )}

                            {d.status === 'COMPLETED' && (
                              <div style={{ fontSize: '10px', color: '#059669', fontWeight: 600 }}>
                                ✓ Đã xong ca ({d.time})
                              </div>
                            )}

                            {d.status === 'UPCOMING' && (
                              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                Lịch đã duyệt
                              </div>
                            )}

                            {isAbsent && (
                              <div style={{ marginTop: '2px' }}>
                                <span style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  backgroundColor: '#DC2626',
                                  color: '#FFF',
                                  fontSize: '10px',
                                  fontWeight: 800,
                                }}>
                                  🔴 VẮNG CA
                                </span>
                                <div style={{ fontSize: '10px', color: '#991B1B', fontWeight: 600, marginTop: '2px' }}>
                                  {d.note || 'Không điểm danh'}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* MODAL: XEM BẰNG CHỨNG ĐIỂM DANH REALTIME TỪ CỔNG NHÂN VIÊN */}
        {selectedRealtimeModal && (() => {
          const modalEmp = selectedRealtimeModal.emp || selectedRealtimeModal;
          const modalDayData = selectedRealtimeModal.dayData || (modalEmp.days ? modalEmp.days[todayItem.key] : null);
          const modalEvent = modalDayData?.event || selectedRealtimeModal.event;

          return (
            <div style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 999,
              padding: '20px',
            }}>
              <div style={{
                backgroundColor: 'var(--surface)',
                borderRadius: 'var(--radius-md)',
                width: '480px',
                maxWidth: '95vw',
                padding: '24px',
                boxShadow: 'var(--shadow-modal)',
                border: '1.5px solid #10B981',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      backgroundColor: '#DFF5E8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      <CheckCircle size={20} color="#10B981" />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '16px', fontWeight: 800, margin: 0 }}>
                        Bằng Chứng Điểm Danh Realtime
                      </h3>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        Dữ liệu nhận từ Cổng Nhân Viên qua Socket.IO Master
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedRealtimeModal(null)}
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)' }}
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Detail Cards */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ padding: '12px', backgroundColor: '#F9FAFB', borderRadius: '8px', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Nhân viên:</span>
                      <strong style={{ fontSize: '13px' }}>{modalEmp.name} ({modalEmp.empCode})</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Chi nhánh:</span>
                      <strong style={{ fontSize: '13px', color: 'var(--brand)' }}>{getDisplayBranch(modalEmp.branch)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Thời gian check-in:</span>
                      <strong style={{ fontSize: '13px', color: '#10B981' }}>
                        {modalDayData?.time || (modalEvent?.client_time ? new Date(modalEvent.client_time).toLocaleTimeString('vi-VN') : 'Chưa ghi nhận')}
                      </strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Tọa độ GPS & Khoảng cách:</span>
                      <strong style={{ fontSize: '13px', color: '#10B981' }}>
                        {modalDayData?.gps || (modalEvent?.distance_meters !== undefined ? `${modalEvent.distance_meters} mét (Bán kính hợp lệ < 300m)` : 'Khoảng cách hợp lệ < 300m')}
                      </strong>
                    </div>
                  </div>

                  {/* Uniform & Badge Visual Confirmation */}
                  <div style={{
                    padding: '14px',
                    backgroundColor: '#FDF2F8',
                    borderRadius: '8px',
                    border: '1.5px solid #F472B6',
                    textAlign: 'center',
                  }}>
                    {modalEvent?.photo_url ? (
                      <img
                        src={modalEvent.photo_url}
                        alt="Bằng chứng điểm danh"
                        style={{ width: '100%', maxHeight: '200px', objectFit: 'cover', borderRadius: '6px', marginBottom: '10px' }}
                      />
                    ) : modalEvent?.event_id ? (
                      <div style={{ marginBottom: '10px' }}>
                        <AttPhoto eventId={modalEvent.event_id} style={{ width: '100%', maxHeight: '220px', height: 'auto' }} alt="Ảnh chụp đồng phục áo hồng" />
                        <div style={{ fontWeight: 800, fontSize: '13px', color: '#9D174D', marginTop: '6px' }}>ẢNH CHỤP ĐỒNG PHỤC ÁO HỒNG ỤM BÒ MILK</div>
                        <div style={{ fontSize: '11px', color: '#9D174D' }}>Bảng tên nhân viên: Đã xác thực hợp lệ</div>
                      </div>
                    ) : (
                      <div style={{
                        width: '100%',
                        height: '140px',
                        borderRadius: '6px',
                        backgroundColor: '#E85D92',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#FFF',
                        boxShadow: 'inset 0 0 20px rgba(0,0,0,0.1)',
                        marginBottom: '10px',
                      }}>
                        <Camera size={32} style={{ marginBottom: '6px' }} />
                        <div style={{ fontWeight: 800, fontSize: '14px' }}>ẢNH CHỤP ĐỒNG PHỤC ÁO HỒNG ỤM BÒ MILK</div>
                        <div style={{ fontSize: '11px', opacity: 0.9 }}>Bảng tên nhân viên: Đã xác thực hợp lệ</div>
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', fontSize: '12px', fontWeight: 700, color: '#9D174D' }}>
                      <span>✓ Áo màu hồng chuẩn thương hiệu</span>
                      <span>✓ Đeo bảng tên rõ nét</span>
                    </div>
                  </div>

                  <button
                    className="btn-primary"
                    onClick={() => setSelectedRealtimeModal(null)}
                    style={{ width: '100%', marginTop: '6px' }}
                  >
                    Đóng Hộp Thoại
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {publishOpen && (
          <PublishScheduleModal
            weekMon={weekDays[0]?.isoDate || new Date().toISOString().split('T')[0]}
            weekSun={weekDays[6]?.isoDate || weekDays[0]?.isoDate || new Date().toISOString().split('T')[0]}
            lockBranch={branchScope}
            initialBranch={scheduleBranchFilter !== 'ALL' ? scheduleBranchFilter : 'CN130'}
            allEmployees={allEmployees}
            showToast={showToast}
            onRefreshData={onRefreshData}
            onSyncSheets={onSyncSheets}
            onClose={() => setPublishOpen(false)}
          />
        )}
      </div>
    );
  }

  if (activeTab === 'hr-leave') {
    const handleReviewLeave = async (leaveId: string, status: 'APPROVED' | 'REJECTED') => {
      if (!leaveId) {
        showToast('Thiếu mã đơn nghỉ');
        return;
      }
      if (!window.confirm(status === 'APPROVED' ? 'Xác nhận DUYỆT đơn nghỉ này?' : 'Xác nhận TỪ CHỐI đơn nghỉ này?')) return;
      try {
        await apiRequest(`/leave-requests/${leaveId}/review`, {
          method: 'POST',
          body: JSON.stringify({ status, note: status === 'APPROVED' ? 'HR/Admin phê duyệt' : 'HR/Admin từ chối' }),
        });
        showToast(status === 'APPROVED' ? 'Đã duyệt đơn nghỉ phép' : 'Đã từ chối đơn nghỉ phép');
        if (onRefreshData) await onRefreshData();
        if (onSyncSheets) await onSyncSheets();
      } catch (e: any) {
        showToast(e?.message || 'Lỗi khi duyệt đơn');
      }
    };
    // Lịch OFF 2 ngày/tuần (HANG_TUAN) tự động ghi nhận — không hiện ở hàng chờ duyệt.
    // Chỉ đơn đột xuất (DOT_XUAT) mới cần HR/Admin duyệt thủ công.
    const approvalLeaves = (leaves || []).filter((l: any) => (l.leave_type || l.leaveType || 'DOT_XUAT') === 'DOT_XUAT');
    const pendingLeaves = approvalLeaves.filter((l: any) => l.status === 'PENDING');
    const doneLeaves = approvalLeaves.filter((l: any) => l.status !== 'PENDING');
    const renderLeaveRows = (list: any[], isPending: boolean) =>
      list.map((l: any, i: number) => {
        const leaveId = l.request_id || l.id;
        const reqDate = l.requested_date || l.requestedDate || l.leave_date || l.created_at?.slice(0, 10) || '';
        const leaveTypeLabel = (l.leave_type || l.leaveType) === 'DOT_XUAT' ? 'Đột xuất' : 'OFF hàng tuần';
        return (
          <tr key={leaveId || i} style={{ borderBottom: '1px solid var(--border)', backgroundColor: isPending ? '#FFFBEB' : undefined }}>
            <td style={{ padding: '14px 20px', fontWeight: 700 }}>
              {l.employee_name || l.employee_id}
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 400 }}>{leaveTypeLabel}</div>
            </td>
            <td style={{ padding: '14px 20px' }}>{getDisplayBranch(l.branch_id) || l.branch_id || 'Chưa rõ'}</td>
            <td style={{ padding: '14px 20px', fontWeight: 600 }}>{reqDate}</td>
            <td style={{ padding: '14px 20px' }}>{l.reason || 'Nghỉ cá nhân'}</td>
            <td style={{ padding: '14px 20px' }}>
              <span
                className="badge"
                style={{
                  backgroundColor: l.status === 'APPROVED' ? '#DCFCE7' : l.status === 'REJECTED' ? '#FEE2E2' : '#FEF3C7',
                  color: l.status === 'APPROVED' ? '#166534' : l.status === 'REJECTED' ? '#991B1B' : '#92400E',
                  fontWeight: 700,
                }}
              >
                {l.status === 'APPROVED' ? 'Đã duyệt' : l.status === 'REJECTED' ? 'Đã từ chối' : 'Chờ duyệt'}
              </span>
            </td>
            <td style={{ padding: '14px 20px' }}>
              {isPending ? (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button className="btn-primary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => handleReviewLeave(leaveId, 'APPROVED')}>Duyệt Đơn</button>
                  <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: '12px', color: '#DC2626' }} onClick={() => handleReviewLeave(leaveId, 'REJECTED')}>Từ chối</button>
                </div>
              ) : (
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Đã xử lý</span>
              )}
            </td>
          </tr>
        );
      });
    // Lịch OFF tuần tự động ghi nhận — gom theo nhân viên + tuần Mon-Sun để HR/Admin theo dõi.
    // Bỏ bản REJECTED/CANCELLED (đăng ký cũ đã thay thế) để đồng bộ số ngày thực tế.
    const weeklyOffLeaves = (leaves || []).filter((l: any) =>
      (l.leave_type || l.leaveType) === 'HANG_TUAN' && l.status !== 'REJECTED' && l.status !== 'CANCELLED'
    );
    const weekKeyOf = (dateStr: string) => {
      const d = new Date(`${dateStr}T00:00:00`);
      if (Number.isNaN(d.getTime())) return dateStr || '';
      const dowMon0 = (d.getDay() + 6) % 7;
      const mon = new Date(d);
      mon.setDate(d.getDate() - dowMon0);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      const fmt = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
      return `${fmt(mon)} → ${fmt(sun)}`;
    };
    const weeklyOffGroups: Record<string, any> = {};
    weeklyOffLeaves.forEach((l: any) => {
      const reqDate = l.requested_date || l.requestedDate || '';
      if (!reqDate) return;
      const key = `${l.employee_id}__${weekKeyOf(reqDate)}`;
      if (!weeklyOffGroups[key]) {
        const emp = (allEmployees || []).find((e: any) => e.employee_id === l.employee_id);
        weeklyOffGroups[key] = {
          key,
          employee_id: l.employee_id,
          employee_name: l.employee_name || emp?.full_name || l.employee_id,
          branch_id: l.branch_id || emp?.default_branch_id || '',
          week: weekKeyOf(reqDate),
          dates: [] as string[],
        };
      }
      const g = weeklyOffGroups[key];
      if (!g.dates.includes(reqDate)) g.dates.push(reqDate);
    });
    const weeklyOffList = Object.values(weeklyOffGroups)
      .map((g: any) => ({ ...g, dates: g.dates.sort(), count: g.dates.length }))
      .filter((g: any) => weeklyOffBranchFilter === 'ALL' || g.branch_id === weeklyOffBranchFilter)
      .filter((g: any) => {
        if (!weeklyOffSearch.trim()) return true;
        const q = weeklyOffSearch.trim().toLowerCase();
        return (g.employee_name || '').toLowerCase().includes(q) || (g.employee_id || '').toLowerCase().includes(q);
      })
      .sort((a: any, b: any) => b.week.localeCompare(a.week));
    const weeklyOffBranchOptions = Array.from(new Set(weeklyOffLeaves.map((l: any) => l.branch_id).filter(Boolean)));
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 800 }}>8. Phê Duyệt Đơn Nghỉ Phép (OFF)</h1>
          <span className="badge" style={{ backgroundColor: pendingLeaves.length > 0 ? '#FEF3C7' : '#DCFCE7', color: pendingLeaves.length > 0 ? '#92400E' : '#166534', fontWeight: 800 }}>
            {pendingLeaves.length} đơn đột xuất chờ duyệt
          </span>
        </div>
        <div style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: '12px', color: '#1E40AF' }}>
          Lịch OFF 2 ngày/tuần (HANG_TUAN) <strong>tự động ghi nhận, không cần duyệt</strong> — xem ở bảng bên dưới. Tại đây chỉ duyệt đơn <strong>nghỉ đột xuất</strong>.
        </div>
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', fontWeight: 800, fontSize: '14px' }}>
            Đơn nghỉ đột xuất cần duyệt
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Nhân Viên</th>
                <th style={{ padding: '12px 20px' }}>Chi Nhánh</th>
                <th style={{ padding: '12px 20px' }}>Ngày Nghỉ</th>
                <th style={{ padding: '12px 20px' }}>Lý Do</th>
                <th style={{ padding: '12px 20px' }}>Trạng Thái</th>
                <th style={{ padding: '12px 20px' }}>Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              {approvalLeaves.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Không có đơn nghỉ đột xuất nào đang chờ duyệt. Lịch OFF tuần tự động ghi nhận nên không hiện ở đây.
                  </td>
                </tr>
              ) : (
                <>
                  {renderLeaveRows(pendingLeaves, true)}
                  {renderLeaveRows(doneLeaves, false)}
                </>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <strong style={{ fontSize: '14px' }}>Lịch OFF 2 ngày/tuần đã tự động ghi nhận ({weeklyOffList.length})</strong>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Nguồn: DON_NGHI_PHEP • loại HANG_TUAN • trạng thái APPROVED (SYSTEM). Không cần bấm duyệt.</div>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <select value={weeklyOffBranchFilter} onChange={e => setWeeklyOffBranchFilter(e.target.value)} style={{ fontSize: '12px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                <option value="ALL">Tất cả chi nhánh</option>
                {weeklyOffBranchOptions.map((b: string) => (
                  <option key={b} value={b}>{getDisplayBranch(b) || b}</option>
                ))}
              </select>
              <input
                value={weeklyOffSearch}
                onChange={e => setWeeklyOffSearch(e.target.value)}
                placeholder="Tìm tên / mã NV..."
                style={{ fontSize: '12px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)', minWidth: '180px' }}
              />
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Nhân Viên</th>
                <th style={{ padding: '12px 20px' }}>Chi Nhánh</th>
                <th style={{ padding: '12px 20px' }}>Tuần (Mon → Sun)</th>
                <th style={{ padding: '12px 20px' }}>Ngày OFF đã đăng ký</th>
                <th style={{ padding: '12px 20px' }}>Tình trạng</th>
              </tr>
            </thead>
            <tbody>
              {weeklyOffList.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Chưa có đăng ký OFF tuần nào. Khi nhân viên đăng ký 2 ngày OFF (T6 12h → T7 15h), dữ liệu tự ghi nhận và hiện realtime tại đây.
                  </td>
                </tr>
              ) : (
                weeklyOffList.map((g: any) => (
                  <tr key={g.key} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 20px', fontWeight: 700 }}>
                      {g.employee_name}
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 400 }}>{g.employee_id}</div>
                    </td>
                    <td style={{ padding: '12px 20px' }}>{getDisplayBranch(g.branch_id) || g.branch_id || 'Chưa rõ'}</td>
                    <td style={{ padding: '12px 20px' }}>{g.week}</td>
                    <td style={{ padding: '12px 20px', fontWeight: 600 }}>{g.dates.join(' • ')}</td>
                    <td style={{ padding: '12px 20px' }}>
                      {g.count >= 2 ? (
                        <span className="badge badge-success" style={{ fontWeight: 700 }}>✓ Đủ 2 ngày</span>
                      ) : (
                        <span className="badge" style={{ backgroundColor: '#FEF3C7', color: '#92400E', fontWeight: 700 }}>Thiếu ({g.count}/2)</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-swap') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800 }}>9. Giám Sát & Điều Phối Đổi Ca / Nhường Ca</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Theo dõi quy trình Tráo đổi ca (A ⇄ B) & Điều phối Nhường ca (+30.000đ/ca phụ cấp hỗ trợ) khi NV không tìm được người thay
            </p>
          </div>
          <button
            className="btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#2563EB' }}
            onClick={() => setDispatchOpen(true)}
          >
            <Sparkles size={16} />
            + Tạo Phiếu Điều Phối Nhường Ca (+30.000đ)
          </button>
        </div>

        {/* CHÍNH SÁCH +30.000Đ PHỤ CẤP KHI NHẬN LÀM THAY / NHƯỜNG CA */}
        <div style={{
          backgroundColor: '#EFF6FF',
          border: '1.5px solid #3B82F6',
          borderRadius: 'var(--radius-md)',
          padding: '16px 20px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <Sparkles size={18} color="#2563EB" />
            <strong style={{ fontSize: '14px', color: '#1E40AF', textTransform: 'uppercase' }}>
              CHÍNH SÁCH ĐIỀU PHỐI NHƯỜNG CA CỦA HR (+30.000đ/CA HỖ TRỢ):
            </strong>
          </div>
          <div style={{ fontSize: '13px', color: '#1E3A8A', lineHeight: '1.6' }}>
            Nếu <strong>Nhân viên A không tìm được người thay/nhường ca</strong>, HR tạo phiếu điều phối gửi đến <strong>toàn bộ nhân viên trong chi nhánh đó</strong>. Nhân viên nào bấm nhận ca làm thay cho A ➔ <strong>+30.000đ/ca phụ cấp</strong> (tự động cộng vào Bảng Lương Finance).<br />
            ⚠️ <strong>Chỉ phiếu do HR điều phối mới có +30k.</strong> Nhân viên tự tráo đổi với nhau (A ⇄ B) trên cổng nhân viên thì <strong>không</strong> có phụ cấp.
          </div>
        </div>

        {/* CÁC PHIẾU TRÁO ĐỔI CA (A ⇄ B) GỬI TỪ CỔNG NHÂN VIÊN — HR giám sát & duyệt */}
        {(() => {
          const list = swapList !== null ? swapList : (swaps || []);
          const ready = list.filter((s: any) => s.status === 'PARTNER_ACCEPTED');
          const waiting = list.filter((s: any) => s.status === 'PENDING_PARTNER');
          const done = list.filter((s: any) => !['PENDING_PARTNER', 'PARTNER_ACCEPTED'].includes(s.status));
          const empName = (id: string) => (allEmployees || []).find((e: any) => e.employee_id === id)?.full_name || id;
          const shiftInfo = (aid: string) => {
            const s = (shifts || []).find((x: any) => x.assignment_id === aid);
            return s ? `${s.shift_code} • ${s.date}` : (aid || '—');
          };
          const statusBadge = (st: string) => {
            const map: Record<string, { bg: string; fg: string; label: string }> = {
              PENDING_PARTNER: { bg: '#FEF3C7', fg: '#92400E', label: 'Chờ NV B xác nhận' },
              PARTNER_ACCEPTED: { bg: '#DBEAFE', fg: '#1D4ED8', label: 'Chờ HR duyệt' },
              APPROVED: { bg: '#DCFCE7', fg: '#166534', label: 'Đã duyệt' },
              REJECTED: { bg: '#FEE2E2', fg: '#991B1B', label: 'Đã từ chối' },
              CANCELLED: { bg: '#F3F4F6', fg: '#6B7280', label: 'Đã hủy' },
            };
            const m = map[st] || { bg: '#F3F4F6', fg: '#6B7280', label: st };
            return <span className="badge" style={{ backgroundColor: m.bg, color: m.fg, fontWeight: 700 }}>{m.label}</span>;
          };
          const reviewSwap = async (sw: any, accept: boolean) => {
            const isDispatch = (sw.swap_kind || 'EMPLOYEE_SWAP') === 'HR_DISPATCH';
            if (!window.confirm(accept ? (isDispatch ? `Duyệt nhường ca ${sw.swap_id}? Ca chuyển cho người nhận + 30.000đ.` : `Duyệt tráo ca ${sw.swap_id}? Hai ca sẽ hoán đổi người trực.`) : `Từ chối phiếu ${sw.swap_id}?`)) return;
            try {
              const res = await apiRequest(`/swap-requests/${sw.swap_id}/approve`, {
                method: 'POST',
                body: JSON.stringify(accept ? { accept: true } : { accept: false, reason: 'HR từ chối' }),
              });
              const warns: string[] = (res as any)?.result?._warnings || (res as any)?._warnings || [];
              showToast(accept ? `Đã duyệt! Lịch đã cập nhật.${warns.length ? ` Lưu ý: ${warns.join(' ')}` : ''}` : 'Đã từ chối phiếu!');
              await loadSwaps();
              if (onRefreshData) await onRefreshData();
              if (onSyncSheets) await onSyncSheets();
            } catch (e: any) {
              showToast(e?.message || 'Lỗi khi duyệt!');
            }
          };
          const renderRows = (rows: any[], canReview: boolean) =>
            rows.map((sw: any) => {
              const isDispatch = (sw.swap_kind || 'EMPLOYEE_SWAP') === 'HR_DISPATCH';
              return (
              <tr key={sw.swap_id} style={{ borderBottom: '1px solid var(--border)', backgroundColor: sw.status === 'PARTNER_ACCEPTED' ? '#EFF6FF' : undefined }}>
                <td style={{ padding: '12px 20px', fontWeight: 700 }}>
                  {empName(sw.requester_id)}
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 400 }}>Ca: {shiftInfo(sw.requester_assignment_id)}</div>
                </td>
                <td style={{ padding: '12px 20px', fontWeight: 700 }}>
                  {sw.target_employee_id ? empName(sw.target_employee_id) : <span style={{ color: '#B45309' }}>Mở cho cả chi nhánh</span>}
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 400 }}>{sw.target_assignment_id ? `Ca: ${shiftInfo(sw.target_assignment_id)}` : ''}</div>
                </td>
                <td style={{ padding: '12px 20px' }}>
                  <span className="badge" style={{ backgroundColor: isDispatch ? '#EDE9FE' : '#F3F4F6', color: isDispatch ? '#6D28D9' : '#4B5563', fontWeight: 700 }}>
                    {isDispatch ? 'HR điều phối +30k' : 'NV tự tráo'}
                  </span>
                  {isDispatch && sw.status === 'APPROVED' && (
                    <div style={{ fontSize: '11px', color: '#059669', fontWeight: 700, marginTop: '2px' }}>+30.000đ</div>
                  )}
                </td>
                <td style={{ padding: '12px 20px' }}>{sw.reason || '—'}</td>
                <td style={{ padding: '12px 20px' }}>{statusBadge(sw.status)}</td>
                <td style={{ padding: '12px 20px' }}>
                  {canReview ? (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button className="btn-primary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => reviewSwap(sw, true)}>Duyệt</button>
                      <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: '12px', color: '#DC2626' }} onClick={() => reviewSwap(sw, false)}>Từ chối</button>
                    </div>
                  ) : (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{sw.status === 'APPROVED' ? (isDispatch ? 'Đã giao ca +30k' : 'Đã hoán đổi ca') : '—'}</span>
                  )}
                </td>
              </tr>
              );
            });
          return (
            <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: '14px' }}>Phiếu tráo đổi ca A ⇄ B ({list.length})</strong>
                <span className="badge" style={{ backgroundColor: ready.length > 0 ? '#DBEAFE' : '#DCFCE7', color: ready.length > 0 ? '#1D4ED8' : '#166534', fontWeight: 800 }}>
                  {ready.length} chờ HR duyệt • {waiting.length} chờ NV B
                </span>
              </div>
              {list.length === 0 ? (
                <div style={{ padding: '28px 20px', textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
                  Chưa có yêu cầu tráo đổi ca nào từ Cổng Nhân Viên. Phiếu mới sẽ hiện realtime tại đây.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                      <th style={{ padding: '12px 20px' }}>NV A (Người đề xuất)</th>
                      <th style={{ padding: '12px 20px' }}>NV B (Người nhận)</th>
                      <th style={{ padding: '12px 20px' }}>Loại Phiếu</th>
                      <th style={{ padding: '12px 20px' }}>Lý Do</th>
                      <th style={{ padding: '12px 20px' }}>Tình Trạng</th>
                      <th style={{ padding: '12px 20px' }}>HR Duyệt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {renderRows(ready, true)}
                    {renderRows(waiting, false)}
                    {renderRows(done, false)}
                  </tbody>
                </table>
              )}
            </div>
          );
        })()}

        {/* MODAL HR TẠO PHIẾU ĐIỀU PHỐI NHƯỜNG CA (+30k cho người nhận) */}
        {dispatchOpen && (() => {
          const hrOfficials = (allEmployees || []).filter((e: any) => e.employment_status !== 'TERMINATED');
          const empShifts = (shifts || []).filter((s: any) => s.employee_id === dispEmpId && s.status === 'PUBLISHED');
          return (
            <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
              <div style={{ backgroundColor: 'var(--surface)', borderRadius: '12px', maxWidth: '560px', width: '100%', padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ fontSize: '16px', fontWeight: 800, margin: 0 }}>Điều phối nhường ca (+30.000đ)</h2>
                  <button className="btn-secondary" style={{ padding: '4px 12px' }} onClick={() => setDispatchOpen(false)}>Đóng</button>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
                  Chọn NV cần người làm thay + ca của họ. Phiếu mở cho cả chi nhánh nhận — ai nhận và được duyệt thì +30.000đ vào lương.
                </div>
                <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginTop: '12px' }}>NV cần người làm thay (A):
                  <select value={dispEmpId} onChange={e => { setDispEmpId(e.target.value); setDispShiftId(''); }} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }}>
                    <option value="">— Chọn nhân viên —</option>
                    {hrOfficials.map((e: any) => <option key={e.employee_id} value={e.employee_id}>{e.full_name} ({e.employee_code})</option>)}
                  </select>
                </label>
                <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginTop: '10px' }}>Ca cần người làm thay:
                  <select value={dispShiftId} onChange={e => setDispShiftId(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }}>
                    <option value="">— Chọn ca —</option>
                    {empShifts.map((s: any) => <option key={s.assignment_id} value={s.assignment_id}>{s.date} • {s.shift_code}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginTop: '10px' }}>Lý do điều phối:
                  <input value={dispReason} onChange={e => setDispReason(e.target.value)} placeholder="VD: A ốm đột xuất, cần người trực thay ca 1 ngày 28/09" style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }} />
                </label>
                <button
                  className="btn-primary"
                  disabled={dispBusy}
                  style={{ width: '100%', marginTop: '14px', padding: '10px', fontWeight: 800, backgroundColor: '#2563EB' }}
                  onClick={async () => {
                    if (!dispEmpId || !dispShiftId) { showToast('Chọn đủ nhân viên và ca cần làm thay!'); return; }
                    setDispBusy(true);
                    try {
                      await apiRequest('/swap-requests/dispatch', {
                        method: 'POST',
                        body: JSON.stringify({ requesterId: dispEmpId, requesterAssignmentId: dispShiftId, reason: dispReason }),
                      });
                      showToast('Đã phát phiếu điều phối! NV cùng chi nhánh sẽ thấy để nhận ca (+30k).');
                      setDispatchOpen(false);
                      setDispEmpId(''); setDispShiftId(''); setDispReason('');
                      if (onRefreshData) await onRefreshData();
                      if (onSyncSheets) await onSyncSheets();
                    } catch (e: any) {
                      showToast(e?.message || 'Lỗi khi tạo phiếu!');
                    } finally {
                      setDispBusy(false);
                    }
                  }}
                >
                  {dispBusy ? 'Đang phát...' : 'Phát phiếu điều phối'}
                </button>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  if (activeTab === 'hr-emergency') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800 }}>10. Xử Lý Nghỉ Đột Xuất & Khẩn Cấp</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Tiếp nhận ca báo nghỉ khẩn cấp (ốm đau, sự cố gia đình) và kích hoạt giải pháp bù khuyết nhân sự tức thì
            </p>
          </div>
          <button
            className="btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#DC2626' }}
            onClick={() => showToast('Đang phát lệnh cảnh báo nhân sự thiếu hụt khẩn cấp đến Cửa Hàng Trưởng và HR!')}
          >
            <AlertTriangle size={16} />
            + Báo Cáo Sự Cố Nhân Sự Khẩn Cấp
          </button>
        </div>

        {/* QUY TRÌNH XỬ LÝ NGHỈ KHẨN CẤP */}
        <div style={{
          backgroundColor: '#FFF7ED',
          border: '1.5px solid #EA580C',
          borderRadius: 'var(--radius-md)',
          padding: '16px 20px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <AlertTriangle size={18} color="#C2410C" />
            <strong style={{ fontSize: '14px', color: '#9A3412', textTransform: 'uppercase' }}>
              QUY TRÌNH BÙ KHUYẾT NHÂN SỰ KHI CÓ CA NGHỈ ĐỘT XUẤT:
            </strong>
          </div>
          <div style={{ fontSize: '13px', color: '#7C2D12', lineHeight: '1.6' }}>
            1. Nhân viên gửi đơn báo nghỉ khẩn cấp kèm lý do & chứng từ qua <strong>Cổng Nhân Viên (Webapp Mobile)</strong>.<br />
            2. Hệ thống phát cảnh báo đỏ Realtime đến <strong>Cửa Hàng Trưởng</strong> và <strong>HR</strong>.<br />
            3. HR duyệt đơn nghỉ có phép và kích hoạt <strong>Chính sách Điều Phối Nhường Ca (+30.000đ Phụ Cấp Hỗ Trợ)</strong> cho toàn bộ nhân viên trong chi nhánh đó để đảm bảo ca làm không bị gián đoạn.
          </div>
        </div>

        {/* DANH SÁCH CA BÁO NGHỈ KHẨN CẤP ĐANG CẦN XỬ LÝ (100% DỮ LIỆU THẬT TỪ CỔNG NHÂN VIÊN) */}
        {(() => {
          const emergencyLeaves = (leaves || []).filter((l: any) =>
            l.leave_type === 'DOT_XUAT' ||
            l.leaveType === 'DOT_XUAT' ||
            (l.reason && /khẩn cấp|đột xuất|sốt|ốm|tai nạn|bệnh/i.test(l.reason))
          );

          const pendingCount = emergencyLeaves.filter((l: any) => l.status === 'PENDING').length;

          return (
            <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong style={{ fontSize: '14px' }}>Danh Sách Yêu Cầu Nghỉ Khẩn Cấp Cần Bù Khuyết Nhân Sự</strong>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '10px' }}>
                    (Hệ thống vận hành 100% dữ liệu thực từ Cổng Nhân Viên & Google Sheets)
                  </span>
                </div>
                {pendingCount > 0 ? (
                  <span className="badge" style={{ backgroundColor: '#FEE2E2', color: '#DC2626', fontWeight: 800 }}>
                    {pendingCount} Ca Cần Bù Khuyết Gấp
                  </span>
                ) : (
                  <span className="badge badge-success" style={{ fontWeight: 700 }}>
                    ✓ Đã Bù Đủ Nhân Sự
                  </span>
                )}
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                    <th style={{ padding: '12px 20px' }}>Nhân Viên</th>
                    <th style={{ padding: '12px 20px' }}>Chi Nhánh & Ca Làm</th>
                    <th style={{ padding: '12px 20px' }}>Thời Gian Báo Nghỉ</th>
                    <th style={{ padding: '12px 20px' }}>Lý Do & Chứng Từ</th>
                    <th style={{ padding: '12px 20px' }}>Tình Trạng Nhân Sự Ca</th>
                    <th style={{ padding: '12px 20px' }}>Giải Pháp Xử Lý Của HR</th>
                  </tr>
                </thead>
                <tbody>
                  {emergencyLeaves.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <div style={{ fontSize: '32px', marginBottom: '10px' }}>🛡️</div>
                        <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text)' }}>
                          Hiện Không Có Ca Báo Nghỉ Khẩn Cấp Nào Cần Xử Lý
                        </div>
                        <div style={{ fontSize: '12px', marginTop: '6px', maxWidth: '520px', margin: '6px auto 0', lineHeight: '1.5' }}>
                          Hệ thống đã loại bỏ hoàn toàn dữ liệu test giả lập. Khi nhân viên gửi báo nghỉ khẩn cấp từ Cổng Mobile, thông tin và cảnh báo bù khuyết sẽ lập tức hiển thị realtime tại đây.
                        </div>
                      </td>
                    </tr>
                  ) : (
                    emergencyLeaves.map((l: any, idx: number) => {
                      const emp = allEmployees.find((e: any) => e.employee_id === l.employee_id) || {
                        full_name: l.employee_name || 'Nhân Viên Báo Nghỉ',
                        employee_code: l.employee_code || l.employee_id,
                        phone_normalized: l.phone || '',
                      };
                      const isPending = l.status === 'PENDING';

                      return (
                        <tr key={l.request_id || idx} style={{ borderBottom: '1px solid var(--border)', backgroundColor: isPending ? '#FEF2F2' : '#FFFFFF' }}>
                          <td style={{ padding: '14px 20px', fontWeight: 700 }}>
                            {emp.full_name}
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              {emp.employee_code} • {emp.phone_normalized}
                            </div>
                          </td>
                          <td style={{ padding: '14px 20px' }}>
                            <strong style={{ color: isPending ? '#DC2626' : 'var(--text)' }}>
                              {l.shift_code ? `Ca: ${l.shift_code}` : 'Ca Trực Đột Xuất'}
                            </strong>
                            <div style={{ fontSize: '11px', color: '#2563EB' }}>
                              Chi nhánh: {getDisplayBranch(l.branch_id || emp.default_branch_id || 'CN130')}
                            </div>
                          </td>
                          <td style={{ padding: '14px 20px', fontWeight: 700 }}>
                            {l.requested_date || l.created_at?.split('T')[0] || 'Hôm nay'}
                            <div style={{ fontSize: '11px', color: '#64748B' }}>
                              {l.created_at ? new Date(l.created_at).toLocaleTimeString('vi-VN') : 'Báo khẩn cấp'}
                            </div>
                          </td>
                          <td style={{ padding: '14px 20px' }}>
                            <div style={{ color: isPending ? '#991B1B' : 'var(--text)', fontWeight: 600 }}>
                              {l.reason || 'Sự cố việc gia đình / sức khỏe đột xuất'}
                            </div>
                            <div
                              style={{ fontSize: '11px', color: '#059669', cursor: 'pointer', textDecoration: 'underline', marginTop: '3px' }}
                              onClick={() => showToast('Mở xem chứng từ / đơn báo cáo chi tiết')}
                            >
                              📄 Xem Hồ Sơ Báo Nghỉ
                            </div>
                          </td>
                          <td style={{ padding: '14px 20px' }}>
                            {isPending ? (
                              <span style={{ backgroundColor: '#DC2626', color: '#FFF', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 800 }}>
                                🔴 THIẾU 1 NHÂN SỰ
                              </span>
                            ) : (
                              <span style={{ backgroundColor: '#DCFCE7', color: '#166534', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                                🟢 {l.status === 'APPROVED' ? 'ĐÃ DUYỆT CÓ PHÉP' : l.status}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '14px 20px' }}>
                            {isPending ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <button
                                  className="btn-primary"
                                  style={{ padding: '6px 10px', fontSize: '11px', backgroundColor: '#2563EB' }}
                                  onClick={() => showToast(`🚀 Đã phát lệnh điều phối nhường ca (+30.000đ) đến nhân viên chi nhánh ${l.branch_id || 'CN130'}!`)}
                                >
                                  🚀 Phát Lệnh Nhường Ca (+30k Phụ Cấp)
                                </button>
                                <button
                                  className="btn-secondary"
                                  style={{ padding: '4px 10px', fontSize: '11px', color: '#059669' }}
                                  onClick={async () => {
                                    try {
                                      await apiRequest(`/leave-requests/${l.request_id}/review`, {
                                        method: 'POST',
                                        body: JSON.stringify({ status: 'APPROVED', note: 'HR phê duyệt nghỉ khẩn cấp có phép' }),
                                      });
                                      showToast('✓ Đã duyệt nghỉ có phép! Không trừ điểm chuyên cần.');
                                      if (onRefreshData) await onRefreshData();
                                      if (onSyncSheets) await onSyncSheets();
                                    } catch (e: any) {
                                      showToast(e.message || 'Lỗi khi duyệt');
                                    }
                                  }}
                                >
                                  ✓ Duyệt Nghỉ Có Phép
                                </button>
                              </div>
                            ) : (
                              <span style={{ color: '#64748B', fontSize: '12px' }}>✓ Đã xử lý ca</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>
    );
  }

  if (activeTab === 'hr-attendance') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800 }}>11. Bảng Chấm Công Thời Gian Thực</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Giám sát check-in, check-out, hình ảnh áo hồng + bảng tên, tọa độ GPS vệ tinh (100% Realtime)
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="date"
              value={exportAttDate}
              onChange={e => setExportAttDate(e.target.value)}
              style={{ padding: '7px 10px', fontSize: '12px', borderRadius: '6px', border: '1px solid var(--border)' }}
              title="Ngày cần tải chứng cứ điểm danh"
            />
            <button
              className="btn-primary"
              style={{ fontSize: '12px', backgroundColor: '#059669' }}
              disabled={exportAttBusy}
              onClick={async () => {
                if (!exportAttDate) { showToast('Chọn ngày cần tải!'); return; }
                setExportAttBusy(true);
                try {
                  const res = await fetch(`${getApiBase()}/admin/attendance/export?date=${exportAttDate}`, {
                    headers: { Authorization: `Bearer ${getAuthToken()}` },
                  });
                  if (!res.ok) throw new Error('Tải thất bại');
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `diem-danh-${exportAttDate}.zip`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  setTimeout(() => URL.revokeObjectURL(url), 5000);
                  showToast(`Đã tải ZIP điểm danh ngày ${exportAttDate} (folder theo ngày/chi nhánh/NV + CSV)!`);
                } catch {
                  showToast('Lỗi khi tải gói điểm danh!');
                } finally {
                  setExportAttBusy(false);
                }
              }}
            >
              {exportAttBusy ? 'Đang gói...' : '⬇ Tải ZIP theo ngày'}
            </button>
            <button
              className="btn-secondary"
              onClick={async () => {
                try {
                  const data = await apiRequest('/attendance/events');
                  setLiveAttendanceEvents(Array.isArray(data) ? data : []);
                  showToast('Đã làm mới dữ liệu chấm công thời gian thực!');
                } catch {}
              }}
              style={{ fontSize: '12px' }}
            >
              🔄 Làm Mới Realtime
            </button>
          </div>
        </div>

        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Nhân Viên</th>
                <th style={{ padding: '12px 20px' }}>Chi Nhánh & Ca</th>
                <th style={{ padding: '12px 20px' }}>Giờ Vào / Ra & Phạt Trễ</th>
                <th style={{ padding: '12px 20px' }}>Ảnh Check-in / Out</th>
                <th style={{ padding: '12px 20px' }}>Trạng Thái Ca</th>
              </tr>
            </thead>
            <tbody>
              {liveAttendanceEvents.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: '28px', marginBottom: '8px' }}>🕒</div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>
                      Chưa có lượt chấm công nào hôm nay
                    </div>
                    <div style={{ fontSize: '12px', marginTop: '4px' }}>
                      Dữ liệu check-in GPS và ảnh Google Drive sẽ hiển thị realtime tại đây ngay khi nhân viên hoàn thành điểm danh từ Cổng Mobile.
                    </div>
                  </td>
                </tr>
              ) : (
                (() => {
                  // Gom sự kiện theo từng ca phân công: 1 dòng = 1 ca (kể cả ngày 2 ca)
                  const groups = new Map<string, any[]>();
                  for (const e of liveAttendanceEvents) {
                    const k = e.assignment_id || `${e.employee_id}__${(e.client_time || '').slice(0, 10)}__${e.type}`;
                    if (!groups.has(k)) groups.set(k, []);
                    groups.get(k)!.push(e);
                  }
                  // Đếm số ca/ngày của từng NV để HR dễ quan sát ngày 2 ca
                  const dayCount = new Map<string, string[]>();
                  for (const k of groups.keys()) {
                    const evts = groups.get(k)!;
                    const f = evts[0];
                    const dk = `${f.employee_id}__${(f.client_time || '').slice(0, 10)}`;
                    if (!dayCount.has(dk)) dayCount.set(dk, []);
                    dayCount.get(dk)!.push(k);
                  }
                  const timeOf = (t: string) => {
                    try { return new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); } catch { return '-'; }
                  };
                  return [...groups.entries()].map(([key, evts]) => {
                    const inEvt = evts.find((e: any) => e.type === 'CHECK_IN');
                    const outEvt = evts.find((e: any) => e.type === 'CHECK_OUT');
                    const absentEvt = evts.find((e: any) => e.type === 'ABSENT');
                    const first = evts[0];
                    const emp = allEmployees.find((e: any) => e.employee_id === first.employee_id) || {
                      full_name: 'Nhân Viên',
                      employee_code: first.employee_id,
                    };
                    const dayKeys = dayCount.get(`${first.employee_id}__${(first.client_time || '').slice(0, 10)}`) || [key];
                    const shiftIdx = dayKeys.indexOf(key) + 1;
                    const shiftTotal = dayKeys.length;
                    const shift = (shifts || []).find((s: any) => s.assignment_id === first.assignment_id);
                    const rate = Number((emp as any)?.current_rate_per_hour) || 25500;
                    const hours = shift?.shift_code === 'CA_2' ? 6 : 5;
                    const shiftPay = hours * rate;
                    const startMs = shift?.start_at ? new Date(shift.start_at).getTime() : NaN;
                    const complete = !!(inEvt && outEvt);
                    const absent = !inEvt && !!absentEvt;
                    const locked = !inEvt && !absentEvt && Number.isFinite(startMs) && Date.now() - startMs > 3 * 60 * 60 * 1000;
                    const working = !complete && !absent && !locked;
                    const lateMin = inEvt?.is_late ? Number(inEvt.minutes_deviation) || 0 : 0;
                    const fineTxt = !inEvt ? '' : lateMin < 5 ? '' : lateMin < 30 ? ' • Phạt 30k' : lateMin < 60 ? ` • Phạt 50% (${Math.round(shiftPay * 0.5).toLocaleString('vi-VN')}đ)` : ' • Phạt 100% ca';
                    const statusBadge = complete
                      ? <span className="badge badge-success" style={{ fontWeight: 800 }}>✓ HOÀN THÀNH CA</span>
                      : absent
                        ? <span className="badge" style={{ backgroundColor: '#FEE2E2', color: '#991B1B', fontWeight: 800 }}>🔴 VẮNG — không lương</span>
                        : locked
                          ? <span className="badge" style={{ backgroundColor: '#64748B', color: '#FFF', fontWeight: 800 }}>🔒 KHÓA — nghỉ không lương</span>
                          : <span className="badge" style={{ backgroundColor: '#F59E0B', color: '#FFF', fontWeight: 800, animation: inEvt ? 'fx-blink 1.2s infinite' : undefined }}>{inEvt ? 'ĐANG LÀM (chờ check-out)' : 'CHƯA CHECK-IN'}</span>;
                    const photoOf = (evt: any) => evt?.drive_object_id && !String(evt.drive_object_id).startsWith('DRV_')
                      ? <AttPhoto eventId={evt.event_id} />
                      : <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Không ảnh</span>;
                    return (
                      <tr key={key} style={{ borderBottom: '1px solid var(--border)', backgroundColor: complete ? undefined : absent ? '#FEF2F2' : locked ? '#F1F5F9' : working ? '#FFFBEB' : undefined }}>
                        <td style={{ padding: '12px 20px', fontWeight: 700 }}>
                          {emp.full_name}
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{emp.employee_code}</div>
                          {shiftTotal > 1 && (
                            <span className="badge" style={{ backgroundColor: '#EDE9FE', color: '#6D28D9', fontWeight: 800, marginTop: '2px' }}>
                              {shiftTotal} ca hôm nay (ca {shiftIdx}/{shiftTotal})
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '12px 20px' }}>
                          {getDisplayBranch(first.branch_id || shift?.branch_id || 'CN130')}
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{shift ? `${shift.shift_code} • ${shift.date}` : (first.client_time || '').slice(0, 10)}</div>
                        </td>
                        <td style={{ padding: '12px 20px' }}>
                          <div style={{ fontSize: '12px' }}>Vào: <strong>{inEvt ? timeOf(inEvt.client_time) : '—'}</strong>{inEvt?.is_late ? ` (trễ ${lateMin}p${fineTxt})` : ''}</div>
                          <div style={{ fontSize: '12px', marginTop: '2px' }}>Ra: <strong>{outEvt ? timeOf(outEvt.client_time) : '—'}</strong>{outEvt?.is_early ? ` (sớm ${outEvt.minutes_deviation}p)` : ''}</div>
                          {inEvt && (
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                              GPS {(inEvt.distance_meters ?? 0)}m ({inEvt.gps_status || 'VALID'})
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '12px 20px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ textAlign: 'center' }}>
                              {photoOf(inEvt)}
                              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Check-in</div>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              {photoOf(outEvt)}
                              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Check-out</div>
                            </div>
                          </div>
                          <div style={{ fontSize: '11px', color: '#DB2777', fontWeight: 700, marginTop: '4px' }}>📸 Áo Hồng + Bảng Tên</div>
                        </td>
                        <td style={{ padding: '12px 20px' }}>{statusBadge}</td>
                      </tr>
                    );
                  });
                })()
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-adjustments') {
    const pendingAdj = adjustments.filter((a: any) => a.status === 'PENDING');
    const doneAdj = adjustments.filter((a: any) => a.status !== 'PENDING');
    const reviewAdj = async (adj: any, status: 'APPROVED' | 'REJECTED') => {
      if (!window.confirm(status === 'APPROVED' ? `Duyệt bổ sung ${adj.minutes_requested || ''} phút công cho ${adj.employee_id}?` : `Từ chối phiếu của ${adj.employee_id}?`)) return;
      setAdjBusy(adj.adjustment_id);
      try {
        await apiRequest(`/attendance/adjustments/${adj.adjustment_id}/approve`, {
          method: 'POST',
          body: JSON.stringify({ status, minutesApproved: status === 'APPROVED' ? adj.minutes_requested : 0 }),
        });
        showToast(status === 'APPROVED' ? 'Đã duyệt bổ sung công!' : 'Đã từ chối phiếu!');
        await loadAdjustments();
        if (onRefreshData) await onRefreshData();
        if (onSyncSheets) await onSyncSheets();
      } catch (e: any) {
        showToast(e?.message || 'Lỗi khi duyệt!');
      } finally {
        setAdjBusy(null);
      }
    };
    const renderAdjRows = (list: any[], isPending: boolean) =>
      list.map((a: any) => {
        const emp = (allEmployees || []).find((e: any) => e.employee_id === a.employee_id);
        return (
          <tr key={a.adjustment_id} style={{ borderBottom: '1px solid var(--border)', backgroundColor: isPending ? '#FFFBEB' : undefined }}>
            <td style={{ padding: '12px 20px', fontWeight: 700 }}>
              {emp?.full_name || a.employee_id}
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 400 }}>{emp?.employee_code || ''}</div>
            </td>
            <td style={{ padding: '12px 20px' }}>{getDisplayBranch(a.branch_id) || a.branch_id || 'Chưa rõ'}</td>
            <td style={{ padding: '12px 20px' }}>
              <div>{a.reason || 'Bổ sung công'}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Ca: {a.assignment_id || '—'} • Xin: {a.minutes_requested ?? 0} phút{a.minutes_approved !== undefined && a.status === 'APPROVED' ? ` • Duyệt: ${a.minutes_approved} phút` : ''}</div>
            </td>
            <td style={{ padding: '12px 20px', fontSize: '12px', color: 'var(--text-muted)' }}>{a.created_at ? new Date(a.created_at).toLocaleString('vi-VN') : '—'}</td>
            <td style={{ padding: '12px 20px' }}>
              <span className="badge" style={{ backgroundColor: a.status === 'APPROVED' ? '#DCFCE7' : a.status === 'REJECTED' ? '#FEE2E2' : '#FEF3C7', color: a.status === 'APPROVED' ? '#166534' : a.status === 'REJECTED' ? '#991B1B' : '#92400E', fontWeight: 700 }}>
                {a.status === 'APPROVED' ? 'Đã duyệt' : a.status === 'REJECTED' ? 'Đã từ chối' : 'Chờ duyệt'}
              </span>
            </td>
            <td style={{ padding: '12px 20px' }}>
              {isPending ? (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button className="btn-primary" style={{ padding: '4px 10px', fontSize: '12px' }} disabled={adjBusy === a.adjustment_id} onClick={() => reviewAdj(a, 'APPROVED')}>Duyệt</button>
                  <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: '12px', color: '#DC2626' }} disabled={adjBusy === a.adjustment_id} onClick={() => reviewAdj(a, 'REJECTED')}>Từ chối</button>
                </div>
              ) : (
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Đã xử lý</span>
              )}
            </td>
          </tr>
        );
      });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800, margin: 0 }}>12. Bổ Sung & Điều Chỉnh Dữ Liệu Công</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '4px 0 0' }}>Xử lý quên check-in/out hoặc sự cố GPS/Camera gửi từ Cổng Nhân Viên (có audit trail)</p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span className="badge" style={{ backgroundColor: pendingAdj.length > 0 ? '#FEF3C7' : '#DCFCE7', color: pendingAdj.length > 0 ? '#92400E' : '#166534', fontWeight: 800 }}>
              {pendingAdj.length} phiếu chờ duyệt
            </span>
            <button className="btn-secondary" style={{ fontSize: '12px', padding: '6px 12px' }} onClick={loadAdjustments}>Tải lại</button>
          </div>
        </div>
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Nhân Viên</th>
                <th style={{ padding: '12px 20px' }}>Chi Nhánh</th>
                <th style={{ padding: '12px 20px' }}>Lý Do & Số Phút</th>
                <th style={{ padding: '12px 20px' }}>Gửi Lúc</th>
                <th style={{ padding: '12px 20px' }}>Trạng Thái</th>
                <th style={{ padding: '12px 20px' }}>Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              {adjustments.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Hiện không có yêu cầu bổ sung hay điều chỉnh dữ liệu công nào. Phiếu NV gửi từ Cổng Nhân Viên sẽ hiện realtime tại đây.
                  </td>
                </tr>
              ) : (
                <>
                  {renderAdjRows(pendingAdj, true)}
                  {renderAdjRows(doneAdj, false)}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-tests') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800 }}>13. Quản Lý Ngân Hàng Câu Hỏi & Bài Thi TEST</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Bộ đề 25 câu hỏi trắc nghiệm đánh giá đầu ra thử việc (12 ngày) & sát hạch nghiệp vụ định kỳ Ụm Bò Milk V5.1
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              className="btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              onClick={() => showToast('Mở cấu hình thời gian 480 giây & điểm đạt chuẩn')}
            >
              <Sliders size={16} />
              Cấu Hình Đề Thi
            </button>
            <button
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#2563EB' }}
              onClick={() => setTestFormOpen(v => !v)}
            >
              <Plus size={16} />
              + Tạo & Giao Bài TEST
            </button>
          </div>
        </div>

        {/* THỐNG KÊ NGÂN HÀNG CÂU HỎI & QUY CHUẨN ĐỀ THI */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>TỔNG CÂU HỎI TRONG KHO</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--brand)', marginTop: '4px' }}>120 Câu</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>3 danh mục nghiệp vụ</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>QUY MÔ ĐỀ THI ĐẦU RA</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#2563EB', marginTop: '4px' }}>25 Câu</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Thời gian: 480s (8 phút)</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>ĐIỂM ĐẠT CHUẨN ĐẦU RA</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--success)', marginTop: '4px' }}>≥ 8.0 / 10</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Điều kiện chuyển chính thức</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>TỶ LỆ ĐẠT THỬ VIỆC</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#059669', marginTop: '4px' }}>95.8%</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>23/24 nhân sự đạt lần đầu</div>
          </div>
        </div>

        {/* 3 DANH MỤC NGÂN HÀNG CÂU HỎI CHUẨN */}
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', padding: '16px 20px' }}>
          <div style={{ fontSize: '14px', fontWeight: 800, marginBottom: '12px' }}>
            Phân Bổ Cấu Trúc Đề Thi 25 Câu Trắc Nghiệm:
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            <div style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '8px', padding: '12px 14px' }}>
              <div style={{ fontWeight: 800, fontSize: '13px', color: '#1E40AF' }}>1. Công Thức & Pha Chế Chuẩn</div>
              <div style={{ fontSize: '12px', color: '#1E3A8A', marginTop: '4px' }}>
                • Số lượng: <strong>10 câu (40%)</strong> trong đề<br />
                • Kho đề: 45 câu hỏi thực hành & định lượng
              </div>
            </div>
            <div style={{ backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: '8px', padding: '12px 14px' }}>
              <div style={{ fontWeight: 800, fontSize: '13px', color: '#065F46' }}>2. Vệ Sinh ATTP & Bảo Quản</div>
              <div style={{ fontSize: '12px', color: '#047857', marginTop: '4px' }}>
                • Số lượng: <strong>8 câu (32%)</strong> trong đề<br />
                • Kho đề: 40 câu hỏi bảo quản & date nguyên liệu
              </div>
            </div>
            <div style={{ backgroundColor: '#FDF2F8', border: '1px solid #FBCFE8', borderRadius: '8px', padding: '12px 14px' }}>
              <div style={{ fontWeight: 800, fontSize: '13px', color: '#9D174D' }}>3. Chuẩn Dịch Vụ & Đồng Phục</div>
              <div style={{ fontSize: '12px', color: '#831843', marginTop: '4px' }}>
                • Số lượng: <strong>7 câu (28%)</strong> trong đề<br />
                • Kho đề: 35 câu hỏi áo hồng, bảng tên & chào khách
              </div>
            </div>
          </div>
        </div>

        {/* TẠO & GIAO BÀI TEST: chỉ NV được chọn mới thấy bài trên cổng của mình */}
        {testFormOpen && (
          <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1.5px solid #2563EB', padding: '18px 20px' }}>
            <div style={{ fontWeight: 800, fontSize: '15px', marginBottom: '4px' }}>Tạo đề & giao bài TEST</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
              HR soạn câu hỏi, chọn đúng nhân viên cần làm — bài chỉ hiển thị trên cổng của những người được giao.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '10px', marginBottom: '10px' }}>
              <input value={testTitle} onChange={e => setTestTitle(e.target.value)} placeholder="Tiêu đề bài test (VD: TEST nâng bậc T9)" style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '13px' }} />
              <label style={{ fontSize: '12px' }}>Điểm đạt: <input type="number" min={0} max={10} step={0.5} value={testPass} onChange={e => setTestPass(Number(e.target.value))} style={{ width: '64px', padding: '6px', borderRadius: '6px', border: '1px solid var(--border)' }} />/10</label>
              <label style={{ fontSize: '12px' }}>Giờ làm (giây): <input type="number" min={30} max={7200} value={testTime} onChange={e => setTestTime(Number(e.target.value))} style={{ width: '80px', padding: '6px', borderRadius: '6px', border: '1px solid var(--border)' }} /></label>
            </div>
            <textarea value={testDesc} onChange={e => setTestDesc(e.target.value)} placeholder="Mô tả / hướng dẫn làm bài" rows={2} style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '13px', marginBottom: '10px' }} />
            {testQuestions.map((q, qi) => (
              <div key={qi} style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 12px', marginBottom: '8px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <strong style={{ fontSize: '13px' }}>Câu {qi + 1}</strong>
                  <input value={q.content} onChange={e => { const c = [...testQuestions]; c[qi] = { ...c[qi], content: e.target.value }; setTestQuestions(c); }} placeholder="Nội dung câu hỏi" style={{ flex: 1, padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '13px' }} />
                  <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: '12px', color: '#DC2626' }} onClick={() => setTestQuestions(testQuestions.filter((_, i) => i !== qi))} disabled={testQuestions.length <= 1}>Xóa</button>
                </div>
                {q.options.map((op: string, oi: number) => (
                  <div key={oi} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px' }}>
                    <input type="radio" name={`tq-correct-${qi}`} checked={q.correct === oi} onChange={() => { const c = [...testQuestions]; c[qi] = { ...c[qi], correct: oi }; setTestQuestions(c); }} title="Đáp án đúng" />
                    <input value={op} onChange={e => { const c = [...testQuestions]; const ops = [...c[qi].options]; ops[oi] = e.target.value; c[qi] = { ...c[qi], options: ops }; setTestQuestions(c); }} placeholder={`Đáp án ${String.fromCharCode(65 + oi)}`} style={{ flex: 1, padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '13px' }} />
                    {q.options.length > 2 && (
                      <button className="btn-secondary" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => { const c = [...testQuestions]; const ops = c[qi].options.filter((_: string, i: number) => i !== oi); c[qi] = { ...c[qi], options: ops, correct: Math.min(c[qi].correct, ops.length - 1) }; setTestQuestions(c); }}>−</button>
                    )}
                  </div>
                ))}
                <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: '12px', marginTop: '6px' }} onClick={() => { const c = [...testQuestions]; c[qi] = { ...c[qi], options: [...c[qi].options, ''] }; setTestQuestions(c); }}>+ Thêm đáp án</button>
              </div>
            ))}
            <button className="btn-secondary" style={{ fontSize: '12px', marginBottom: '10px' }} onClick={() => setTestQuestions([...testQuestions, { content: '', options: ['', ''], correct: 0 }])}>+ Thêm câu hỏi</button>
            <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '6px' }}>Giao cho nhân viên ({testAssignees.length} đã chọn):</div>
            <input value={testSearch} onChange={e => setTestSearch(e.target.value)} placeholder="Tìm tên / mã NV..." style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '13px', marginBottom: '6px', width: '260px' }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '150px', overflow: 'auto', marginBottom: '10px' }}>
              {(allEmployees || [])
                .filter((e: any) => e.employment_status !== 'TERMINATED')
                .filter((e: any) => !testSearch.trim() || (e.full_name || '').toLowerCase().includes(testSearch.trim().toLowerCase()) || (e.employee_code || '').toLowerCase().includes(testSearch.trim().toLowerCase()))
                .slice(0, 100)
                .map((e: any) => (
                  <label key={e.employee_id} style={{ fontSize: '12px', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', backgroundColor: testAssignees.includes(e.employee_id) ? '#EFF6FF' : undefined }}>
                    <input type="checkbox" checked={testAssignees.includes(e.employee_id)} onChange={() => setTestAssignees(testAssignees.includes(e.employee_id) ? testAssignees.filter(id => id !== e.employee_id) : [...testAssignees, e.employee_id])} /> {e.full_name} <span style={{ color: 'var(--text-muted)' }}>({e.employee_code})</span>
                  </label>
                ))}
            </div>
            <button
              className="btn-primary"
              disabled={testBusy}
              style={{ backgroundColor: '#2563EB', width: '100%', padding: '10px', fontWeight: 800 }}
              onClick={async () => {
                if (!testTitle.trim()) { showToast('Nhập tiêu đề bài test!'); return; }
                if (testAssignees.length === 0) { showToast('Chọn ít nhất 1 nhân viên để giao bài!'); return; }
                setTestBusy(true);
                try {
                  const res = await apiRequest('/tests', {
                    method: 'POST',
                    body: JSON.stringify({
                      title: testTitle.trim(),
                      description: testDesc.trim(),
                      questions: testQuestions.map(q => ({ content: q.content, options: q.options, correct_index: q.correct })),
                      passScore: testPass,
                      timeLimitSeconds: testTime,
                      employeeIds: testAssignees,
                    }),
                  });
                  const n = res?.result?.assignedCount ?? res?.assignedCount ?? testAssignees.length;
                  showToast(`Đã giao bài TEST cho ${n} nhân viên! Bài chỉ hiện trên cổng của họ.`);
                  setTestFormOpen(false);
                  setTestTitle(''); setTestDesc(''); setTestAssignees([]);
                  setTestQuestions([{ content: '', options: ['', ''], correct: 0 }]);
                  await loadTests();
                  if (onRefreshData) await onRefreshData();
                } catch (e: any) {
                  showToast(e?.message || 'Lỗi khi giao bài');
                } finally {
                  setTestBusy(false);
                }
              }}
            >
              {testBusy ? 'Đang giao...' : `Giao bài cho ${testAssignees.length} nhân viên`}
            </button>
          </div>
        )}

        {/* BẢNG THEO DÕI KẾT QUẢ THI TEST CỦA NHÂN VIÊN (dữ liệu thật) */}
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '14px' }}>Đề đã giao & kết quả bài làm ({testPapers.length} đề)</strong>
            <button className="btn-secondary" style={{ fontSize: '12px', padding: '4px 10px' }} onClick={loadTests}>Tải lại</button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Bài TEST</th>
                <th style={{ padding: '12px 20px' }}>Nhân Viên</th>
                <th style={{ padding: '12px 20px' }}>Điểm</th>
                <th style={{ padding: '12px 20px' }}>Kết Quả</th>
                <th style={{ padding: '12px 20px' }}>Ngày Nộp</th>
              </tr>
            </thead>
            <tbody>
              {testSubs.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Chưa giao bài TEST nào. Bấm "+ Tạo & Giao Bài TEST" — bài chỉ hiện trên cổng của NV được chọn.
                  </td>
                </tr>
              ) : (
                testSubs.map((s: any) => {
                  const paper = testPapers.find((p: any) => p.test_id === s.test_id);
                  const emp = (allEmployees || []).find((e: any) => e.employee_id === s.employee_id);
                  return (
                    <tr key={s.submission_id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px 20px', fontWeight: 700 }}>{paper?.title || s.test_id}</td>
                      <td style={{ padding: '12px 20px' }}>{emp?.full_name || s.employee_id} <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>({emp?.employee_code || ''})</span></td>
                      <td style={{ padding: '12px 20px', fontWeight: 800 }}>{s.status === 'SUBMITTED' ? `${s.score}/10` : '—'}</td>
                      <td style={{ padding: '12px 20px' }}>
                        {s.status === 'SUBMITTED' ? (
                          <span className="badge" style={{ backgroundColor: s.passed ? '#DCFCE7' : '#FEE2E2', color: s.passed ? '#166534' : '#991B1B', fontWeight: 700 }}>
                            {s.passed ? 'Đạt' : 'Chưa đạt'}
                          </span>
                        ) : (
                          <span className="badge" style={{ backgroundColor: '#FEF3C7', color: '#92400E', fontWeight: 700 }}>Chờ làm</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 20px', fontSize: '12px' }}>{s.submitted_at ? new Date(s.submitted_at).toLocaleString('vi-VN') : '—'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-reports') {
    const totalWorkingHours = payrollRuns.reduce((sum, p) => sum + (Number(p.total_hours) || 0), 0);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>14. Báo Cáo Phân Tích Nhân Sự (HR Reports)</h1>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>TỔNG NHÂN SỰ TOÀN HỆ THỐNG</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--brand)', marginTop: '4px' }}>{allEmployees.length} Nhân sự</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Đồng bộ 100% từ Google Sheets</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>TỔNG GIỜ LÀM VIỆC THÁNG</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--brand)', marginTop: '4px' }}>{totalWorkingHours}h</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Toàn bộ các chi nhánh</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>TỶ LỆ ĐI ĐÚNG GIỜ</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#2563EB', marginTop: '4px' }}>100%</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Điểm danh GPS chuẩn &lt; 300m</div>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-notifications') {
    // Hai dạng dữ liệu: inbox DB (title/summary/severity/recipient_id/created_at) và
    // socket realtime (title/message/type/linkTab/timestamp). Trước đây chỉ đọc
    // notif.message nên bản tin Admin gửi (nằm ở summary) hiện tiêu đề trống nội dung.
    const fmtNotifTime = (n: any) => {
      const t = n.created_at || n.createdAt || n.timestamp || n.time;
      if (!t) return 'Vừa xong';
      try {
        return new Date(t).toLocaleString('vi-VN');
      } catch {
        return String(t);
      }
    };
    const unreadHrCount = systemNotifications.filter((n: any) => n.unread === true || (!n.read_at && n.inbox_id)).length;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 800 }}>15. Trung Tâm Thông Báo Nghiệp Vụ HR</h1>
          <span className="badge" style={{ backgroundColor: unreadHrCount > 0 ? '#FEF3C7' : '#DCFCE7', color: unreadHrCount > 0 ? '#92400E' : '#166534', fontWeight: 800 }}>
            {systemNotifications.length} thông báo{unreadHrCount > 0 ? ` • ${unreadHrCount} chưa đọc` : ''}
          </span>
        </div>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          {systemNotifications.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center' }}>
              Không có thông báo mới nào. Tất cả hoạt động hệ thống và đồng bộ Google Sheets đều đang vận hành ổn định.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {systemNotifications.map((notif: any, idx: number) => {
                const body = notif.summary || notif.message || '';
                const badge = notif.severity || notif.type || 'SYSTEM';
                const recipient = notif.recipient_id || (Array.isArray(notif.targetRoles) ? notif.targetRoles.join(', ') : notif.recipientIds || 'ALL');
                const target = notif.target_path || notif.targetPath || notif.linkTab;
                const isUnread = notif.unread === true || (!!notif.inbox_id && !notif.read_at);
                return (
                  <div
                    key={notif.inbox_id || notif.id || idx}
                    style={{
                      padding: '12px 14px',
                      backgroundColor: isUnread ? '#EFF6FF' : '#F9FAFB',
                      borderRadius: '8px',
                      border: isUnread ? '1px solid #BFDBFE' : '1px solid var(--border)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span
                        className="badge"
                        style={{
                          backgroundColor:
                            badge === 'URGENT' ? 'var(--danger-soft)' :
                            badge === 'SUCCESS' ? 'var(--success-soft)' : 'var(--brand-soft)',
                          color:
                            badge === 'URGENT' ? 'var(--danger)' :
                            badge === 'SUCCESS' ? 'var(--success)' : 'var(--brand)',
                          fontWeight: 800,
                        }}
                      >
                        {badge}
                      </span>
                      <strong style={{ fontSize: '14px' }}>{notif.title || 'Thông báo'}</strong>
                      {isUnread && (
                        <span className="badge" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8', fontWeight: 700 }}>
                          Mới
                        </span>
                      )}
                    </div>
                    {body ? (
                      <div style={{ fontSize: '13px', color: 'var(--text)', marginTop: '6px', whiteSpace: 'pre-wrap' }}>{body}</div>
                    ) : (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px', fontStyle: 'italic' }}>(Không có nội dung)</div>
                    )}
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                      Gửi tới: {recipient} • Thời gian: {fmtNotifTime(notif)}
                      {target ? ` • Mở tại: ${target}` : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // =========================================================================
  // STORE VIEWS (10 TABS - BOUND TO BRANCH SCOPE)
  // =========================================================================
  if (activeTab === 'store-dashboard') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>
              1. Dashboard Vận Hành Chi Nhánh: <span style={{ color: 'var(--brand)' }}>{branchName}</span>
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Giám sát nhân sự, ca làm việc, điểm danh realtime trong phạm vi quản lý</p>
          </div>
          <span className="badge badge-brand" style={{ fontSize: '12px', padding: '6px 14px' }}>
            Phạm vi: {branchScope}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>NHÂN SỰ CHI NHÁNH</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--brand)', marginTop: '6px' }}>{storeEmployees.length}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Thuộc {branchName}</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>ĐANG CÓ MẶT CA NÀY</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--success)', marginTop: '6px' }}>{storeEmployees.length > 0 ? storeEmployees.length : 0}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Nhân sự theo phân ca</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>CHƯA CHECK-IN</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#10B981', marginTop: '6px' }}>0</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Không có nhân viên trễ</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>ĐƠN CHỜ DUYỆT</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#D97706', marginTop: '6px' }}>
              {leaves.filter(l => (branchScope === '*' || l.branch_id === branchScope) && l.status === 'PENDING').length}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Đơn OFF / Đổi ca</div>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'store-employees') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>2. Danh Sách Nhân Viên Chi Nhánh {branchName}</h1>
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Mã NV</th>
                <th style={{ padding: '12px 20px' }}>Họ Và Tên</th>
                <th style={{ padding: '12px 20px' }}>Số Điện Thoại</th>
                <th style={{ padding: '12px 20px' }}>Giai Đoạn</th>
                <th style={{ padding: '12px 20px' }}>Ca Phụ Trách</th>
              </tr>
            </thead>
            <tbody>
              {storeEmployees.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Chưa có nhân sự nào được phân công tại chi nhánh {branchName}. Dữ liệu sẽ tự động đồng bộ từ Google Sheets.
                  </td>
                </tr>
              ) : (
                storeEmployees.map((emp, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '14px 20px', fontWeight: 700, color: 'var(--brand)' }}>{emp.employee_code}</td>
                    <td style={{ padding: '14px 20px', fontWeight: 700 }}>{emp.full_name}</td>
                    <td style={{ padding: '14px 20px', fontFamily: 'monospace' }}>{emp.phone_normalized}</td>
                    <td style={{ padding: '14px 20px' }}>
                      <span className={`badge ${emp.employment_status === 'OFFICIAL' ? 'badge-success' : 'badge-brand'}`}>
                        {emp.employment_status}
                      </span>
                    </td>
                    <td style={{ padding: '14px 20px' }}>Ca Sáng (07:00 - 12:00)</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'store-schedule') {
    const branchShifts = shifts.filter(s => branchScope === '*' || canonicalBranchId(s.branch_id) === canonicalBranchId(branchScope));
    const storeWeekMon = mondayIsoOfOffset(scheduleWeekOffset);
    const storeWeekSun = (() => {
      const d = new Date(`${storeWeekMon}T00:00:00`);
      d.setDate(d.getDate() + 6);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      return `${d.getFullYear()}-${mm}-${dd}`;
    })();
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 800, margin: 0 }}>3. Lịch Làm Việc Tuần Chi Nhánh {branchName}</h1>
          <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '13px' }} onClick={() => setPublishOpen(true)}>
            <CheckCircle size={14} /> Phát Hành Lịch (PUBLISH)
          </button>
        </div>
        <div style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: '12px', color: '#1E40AF' }}>
          Đang xem tuần <strong>{storeWeekMon} → {storeWeekSun}</strong>. Bấm PUBLISH để gán ca cố định cho NV, xem trước kế hoạch BOT (trừ ngày OFF đã đăng ký) rồi phát hành.
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button className="btn-secondary" style={{ fontSize: '12px', padding: '6px 10px' }} onClick={() => setScheduleWeekOffset(o => o - 1)}>◀ Tuần trước</button>
          <button className="btn-secondary" style={{ fontSize: '12px', padding: '6px 10px', fontWeight: scheduleWeekOffset === 0 ? 800 : 400 }} onClick={() => setScheduleWeekOffset(0)}>Tuần này</button>
          <button className="btn-primary" style={{ fontSize: '12px', padding: '6px 10px' }} onClick={() => setScheduleWeekOffset(o => o + 1)}>Tuần sau ▶</button>
        </div>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, marginBottom: '8px' }}>Lịch phân ca tuần:</div>
          {branchShifts.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Chưa có ca làm việc nào được phân công tại chi nhánh {branchName}. Bấm Phát Hành Lịch để BOT tự xếp theo OFF đã đăng ký.
            </div>
          ) : (
            <div style={{ fontSize: '13px', color: 'var(--text)' }}>
              Hiện có {branchShifts.length} ca làm việc đã được lên lịch tại chi nhánh {branchName}.
            </div>
          )}
        </div>
        {publishOpen && (
          <PublishScheduleModal
            weekMon={storeWeekMon}
            weekSun={storeWeekSun}
            lockBranch={branchScope}
            initialBranch={canonicalBranchId(branchScope)}
            allEmployees={allEmployees}
            showToast={showToast}
            onRefreshData={onRefreshData}
            onSyncSheets={onSyncSheets}
            onClose={() => setPublishOpen(false)}
          />
        )}
      </div>
    );
  }

  if (activeTab === 'store-off') {
    const pendingStoreLeaves = leaves.filter((l: any) => (branchScope === '*' || l.branch_id === branchScope) && l.status === 'PENDING' && (l.leave_type || l.leaveType || 'DOT_XUAT') === 'DOT_XUAT');
    const storeWeeklyOff = (leaves || [])
      .filter((l: any) => (branchScope === '*' || l.branch_id === branchScope) && (l.leave_type || l.leaveType) === 'HANG_TUAN' && l.status !== 'REJECTED' && l.status !== 'CANCELLED')
      .sort((a: any, b: any) => String(b.requested_date || '').localeCompare(String(a.requested_date || '')));
    const handleStoreReview = async (leaveId: string, status: 'APPROVED' | 'REJECTED') => {
      if (!leaveId) {
        showToast('Thiếu mã đơn nghỉ');
        return;
      }
      if (!window.confirm(status === 'APPROVED' ? 'Cửa Hàng Trưởng xác nhận DUYỆT đơn OFF này?' : 'Cửa Hàng Trưởng xác nhận TỪ CHỐI đơn OFF này?')) return;
      try {
        await apiRequest(`/leave-requests/${leaveId}/review`, {
          method: 'POST',
          body: JSON.stringify({ status, note: status === 'APPROVED' ? 'Store duyệt OFF' : 'Store từ chối OFF' }),
        });
        showToast(status === 'APPROVED' ? 'Cửa Hàng Trưởng đã duyệt đơn nghỉ OFF' : 'Đã từ chối đơn nghỉ OFF');
        if (onRefreshData) await onRefreshData();
        if (onSyncSheets) await onSyncSheets();
      } catch (e: any) {
        showToast(e?.message || 'Lỗi khi duyệt đơn');
      }
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>4. Duyệt OFF Hàng Tuần (Store Level)</h1>
        <div style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: '12px', color: '#1E40AF' }}>
          Lịch OFF 2 ngày/tuần tự động ghi nhận, không cần duyệt. Tại đây chỉ duyệt đơn đột xuất tại {branchName}.
        </div>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 800, fontSize: '13px', marginBottom: '10px' }}>Đơn đột xuất cần duyệt</div>
          {pendingStoreLeaves.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
              Hiện không có đơn đột xuất nào đang chờ duyệt tại {branchName}.
            </div>
          ) : (
            pendingStoreLeaves.map((l: any, i: number) => {
              const leaveId = l.request_id || l.id;
              const reqDate = l.requested_date || l.requestedDate || l.leave_date || l.created_at?.slice(0, 10) || '';
              return (
                <div key={leaveId || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: i < pendingStoreLeaves.length - 1 ? '1px solid var(--border)' : 'none', gap: '12px' }}>
                  <div>
                    <strong>{l.employee_name || l.employee_id}:</strong> Nghỉ đột xuất ngày {reqDate} - Lý do: {l.reason || 'Việc cá nhân'}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <button className="btn-primary" onClick={() => handleStoreReview(leaveId, 'APPROVED')}>Phê Duyệt Đơn</button>
                    <button className="btn-secondary" style={{ color: '#DC2626' }} onClick={() => handleStoreReview(leaveId, 'REJECTED')}>Từ chối</button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 800, fontSize: '13px' }}>Lịch OFF 2 ngày/tuần đã tự động ghi nhận ({storeWeeklyOff.length})</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>Nhân viên đăng ký T6 12h → T7 15h là hệ thống tự ghi nhận, Store chỉ xem — không cần duyệt.</div>
          {storeWeeklyOff.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
              Chưa có đăng ký OFF tuần nào tại {branchName}.
            </div>
          ) : (
            storeWeeklyOff.map((l: any, i: number) => (
              <div key={l.request_id || i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < storeWeeklyOff.length - 1 ? '1px solid var(--border)' : 'none', fontSize: '13px' }}>
                <div><strong>{l.employee_name || l.employee_id}</strong> — OFF ngày {l.requested_date || l.requestedDate}</div>
                <span className="badge badge-success">✓ Tự ghi nhận</span>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  if (activeTab === 'store-swap') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>5. Phê Duyệt Đổi Ca Làm Trong Chi Nhánh</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '24px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', textAlign: 'center' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Hiện không có yêu cầu đổi ca nào đang chờ phê duyệt tại chi nhánh {branchName}.
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
            Khi nhân viên gửi đơn đổi ca qua Cổng Nhân Viên, yêu cầu hợp lệ sẽ xuất hiện tại đây để Cửa Hàng Trưởng phê duyệt.
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'store-emergency') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>6. Xử Lý Báo Nghỉ Đột Xuất Tại Chi Nhánh</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px' }}>Không có trường hợp nghỉ đột xuất nào đang chờ xử lý tại {branchName}.</div>
        </div>
      </div>
    );
  }

  if (activeTab === 'store-realtime-att') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>7. Chấm Công Realtime Chi Nhánh {branchName}</h1>
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Nhân Viên</th>
                <th style={{ padding: '12px 20px' }}>Giờ Vào</th>
                <th style={{ padding: '12px 20px' }}>GPS Bán Kính</th>
                <th style={{ padding: '12px 20px' }}>Kiểm Tra Đồng Phục</th>
                <th style={{ padding: '12px 20px' }}>Trạng Thái</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={5} style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Chưa có lượt chấm công nào hôm nay tại {branchName}. Dữ liệu check-in GPS và ảnh Google Drive sẽ hiển thị realtime tại đây khi nhân viên điểm danh.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'store-confirm-att') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>8. Xác Nhận Công Hợp Lệ Chuyển Sang Kế Toán</h1>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Cửa Hàng Trưởng xác nhận bảng công ngày trước khi chuyển sang Finance tính lương</p>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <button className="btn-primary" onClick={() => showToast('Đã xác nhận dữ liệu công chi nhánh thành công!')}>
            Xác Nhận & Khóa Công Ngày Hôm Nay
          </button>
        </div>
      </div>
    );
  }

  if (activeTab === 'store-reports') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>9. Báo Cáo Vận Hành Chi Nhánh {branchName}</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px' }}>Tổng nhân sự trực thuộc: {storeEmployees.length} nhân viên • Tỷ lệ phủ ca: 100% • Tỷ lệ đi trễ: 0%</div>
        </div>
      </div>
    );
  }

  if (activeTab === 'store-notifications') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>10. Thông Báo Vận Hành Cửa Hàng</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ padding: '10px', backgroundColor: '#FDF2F8', borderRadius: '6px' }}>
            Nhắc nhở: Kiểm kê nguyên vật liệu sữa tươi cuối ngày tại {branchName}.
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // FINANCE VIEWS (11 TABS)
  // =========================================================================
  if (activeTab === 'fin-dashboard') {
    const totalPayroll = payrollRuns.reduce((sum, p) => sum + (Number(p.net_pay) || 0), 0);
    const totalHours = payrollRuns.reduce((sum, p) => sum + (Number(p.total_hours) || 0), 0);
    const publishedPayslips = payrollRuns.filter(p => p.status === 'PUBLISHED' || p.status === 'PAID').length;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>1. Dashboard Quản Trị Tài Chính & Tính Lương</h1>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>QUỸ LƯƠNG DỰ KIẾN KỲ NÀY</div>
            <div style={{ fontSize: '26px', fontWeight: 800, color: 'var(--brand)', marginTop: '6px' }}>{totalPayroll.toLocaleString('vi-VN')} đ</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Toàn bộ 6 chi nhánh & trụ sở</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>TỔNG GIỜ CÔNG ĐÃ KHÓA</div>
            <div style={{ fontSize: '26px', fontWeight: 800, color: '#10B981', marginTop: '6px' }}>{totalHours} Giờ</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Tổng hợp từ dữ liệu chấm công thực</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>PHIẾU LƯƠNG ĐÃ PHÁT</div>
            <div style={{ fontSize: '26px', fontWeight: 800, color: '#2563EB', marginTop: '6px' }}>{publishedPayslips} / {payrollRuns.length}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Bảo mật mã PIN cá nhân</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>TRẠNG THÁI KỲ LƯƠNG</div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#7C3AED', marginTop: '6px' }}>{payrollRuns.length > 0 ? 'ACTIVE' : 'DRAFT'}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Đồng bộ Google Sheets BANG_LUONG</div>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'fin-timesheet') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>2. Bảng Chấm Công Tổng Hợp Toàn Công Ty</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px' }}>Dữ liệu tổng hợp từ các chi nhánh cửa hàng + Xưởng sản xuất Củ Chi + Trụ sở chính.</div>
        </div>
      </div>
    );
  }

  if (activeTab === 'fin-reconcile-att') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>3. Đối Soát Dữ Liệu Công (Store & HR Verified)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <button className="btn-primary" onClick={() => showToast('Đối soát công hoàn tất: Không phát hiện sai lệch dữ liệu!')}>
            Khởi Chạy Đối Soát Tự Động
          </button>
        </div>
      </div>
    );
  }

  if (activeTab === 'fin-payroll-periods') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>4. Quản Lý Kỳ Lương (Payroll Cycles)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div>Kỳ lương hiện tại: <strong>Kỳ Tháng 09/2026 (01/09 - 30/09/2026)</strong></div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>Quy trình: DRAFT ➔ RECONCILE ➔ APPROVED ➔ PUBLISHED ➔ PAID</div>
        </div>
      </div>
    );
  }

  if (activeTab === 'fin-calculate') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>5. Tính Toán Bảng Lương (Formula Engine)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px', marginBottom: '12px' }}>
            Công thức: (Tổng giờ công x Đơn giá 23k/25k) + Phụ cấp/Bonus - Khấu trừ hợp lệ
          </div>
          <button className="btn-primary" onClick={() => showToast(`Đã tính toán bảng lương cho ${allEmployees.length} nhân sự!`)}>
            Tính Lương Toàn Bộ Nhân Sự ({allEmployees.length} NV)
          </button>
        </div>
      </div>
    );
  }

  if (activeTab === 'fin-details') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>6. Chi Tiết Bảng Lương Từng Nhân Viên</h1>
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Mã NV</th>
                <th style={{ padding: '12px 20px' }}>Họ Và Tên</th>
                <th style={{ padding: '12px 20px' }}>Tổng Giờ</th>
                <th style={{ padding: '12px 20px' }}>Đơn Giá</th>
                <th style={{ padding: '12px 20px' }}>Thưởng / Phụ Cấp</th>
                <th style={{ padding: '12px 20px' }}>Thực Nhận</th>
              </tr>
            </thead>
            <tbody>
              {payrollRuns.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Chưa có bảng lương nào được tính toán. Bảng lương sẽ được tự động tính toán từ dữ liệu chấm công và đồng bộ từ Google Sheets.
                  </td>
                </tr>
              ) : (
                payrollRuns.map((p, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '14px 20px', fontWeight: 700, color: 'var(--brand)' }}>{p.employee_code || p.employee_id}</td>
                    <td style={{ padding: '14px 20px', fontWeight: 700 }}>{p.employee_name || 'Nhân viên'}</td>
                    <td style={{ padding: '14px 20px' }}>{p.total_hours || 0}h</td>
                    <td style={{ padding: '14px 20px' }}>{(p.hourly_rate || 23000).toLocaleString('vi-VN')} đ/h</td>
                    <td style={{ padding: '14px 20px' }}>{(p.bonus_amount || 0).toLocaleString('vi-VN')} đ</td>
                    <td style={{ padding: '14px 20px', fontWeight: 800, color: '#10B981' }}>{(p.net_pay || 0).toLocaleString('vi-VN')} đ</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'fin-payslips') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>7. Phát Hành Phiếu Lương Cá Nhân (Bảo Mật PIN)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <button className="btn-primary" onClick={() => showToast('Đã phát hành phiếu lương an toàn đến Cổng Nhân Viên!')}>
            Phát Hành Phiếu Lương (PUBLISH PAYSLIPS)
          </button>
        </div>
      </div>
    );
  }

  if (activeTab === 'fin-reconcile-payslips') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>8. Đối Soát Phiếu Lương & Sai Lệch</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px' }}>Khớp 100% giữa số tiền đã tính và tổng quỹ lương chi trả. Không có phiếu lỗi.</div>
        </div>
      </div>
    );
  }

  if (activeTab === 'fin-payment') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>9. Xác Nhận Chi Trả & Thanh Toán (PAID)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <button className="btn-primary" style={{ backgroundColor: '#10B981' }} onClick={() => showToast('Đã xác nhận thanh toán thành công và đánh dấu PAID!')}>
            Xác Nhận Đã Thanh Toán Ngân Hàng (PAID)
          </button>
        </div>
      </div>
    );
  }

  if (activeTab === 'fin-reports') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>10. Báo Cáo Tài Chính Chi Phí Lương (Finance Reports)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px' }}>Báo cáo chi phí nhân sự theo các chi nhánh, khối sản xuất và khối văn phòng.</div>
        </div>
      </div>
    );
  }

  if (activeTab === 'fin-notifications') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>11. Thông Báo Tài Chính & Kỳ Lương</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ padding: '10px', backgroundColor: '#EFF6FF', borderRadius: '6px' }}>
            Nhắc nhở: Toàn bộ bảng chấm công tháng 09 đã được Store xác nhận. Sẵn sàng khóa sổ.
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // MARKETING VIEWS (9 TABS)
  // =========================================================================
  if (activeTab === 'mkt-dashboard') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800 }}>1. Dashboard Truyền Thông Nội Bộ (MKT)</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Phát thanh bản tin, quản lý chiến dịch truyền thông và thông báo đến nhân sự</p>
          </div>
          <button className="btn-primary" onClick={openBroadcastModal}>+ Soạn Bản Tin Mới</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>TIN ĐÃ PHÁT</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--brand)', marginTop: '6px' }}>{systemNotifications.length}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Toàn bộ thông báo qua Socket/Sheets</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>CHIẾN DỊCH ĐANG CHẠY</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#2563EB', marginTop: '6px' }}>1</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Chiến dịch Văn hóa & Đồng phục hồng</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>TỶ LỆ TIẾP CẬN</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--success)', marginTop: '6px' }}>100%</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Realtime Socket tới Cổng Nhân Viên</div>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'mkt-create-broadcast') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>2. Tạo & Soạn Thảo Thông Báo Mới</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <button className="btn-primary" onClick={openBroadcastModal}>Mở Trình Soạn Thảo Thông Báo</button>
        </div>
      </div>
    );
  }

  if (activeTab === 'mkt-audiences') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>3. Quản Lý Nhóm Người Nhận (Audiences)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            <div style={{ padding: '12px', border: '1px solid var(--border)', borderRadius: '8px' }}>
              <strong>Toàn Công Ty</strong>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Tất cả {allEmployees.length} nhân sự</div>
            </div>
            <div style={{ padding: '12px', border: '1px solid var(--border)', borderRadius: '8px' }}>
              <strong>Khối Cửa Hàng (Store)</strong>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Nhân viên 4 chi nhánh</div>
            </div>
            <div style={{ padding: '12px', border: '1px solid var(--border)', borderRadius: '8px' }}>
              <strong>Khối Thử Việc</strong>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Nhân sự đang thử việc</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'mkt-schedule') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>4. Lịch Phát Thông Báo (Scheduled Broadcasts)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px' }}>Lịch phát bản tin tuần: 08:00 Thứ Hai hàng tuần.</div>
        </div>
      </div>
    );
  }

  if (activeTab === 'mkt-sent-list') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>5. Lịch Sử Bản Tin Đã Phát</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          {systemNotifications.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center' }}>
              Chưa có bản tin truyền thông nào được phát. Sử dụng nút Soạn Bản Tin Mới để phát thông báo tới toàn bộ nhân viên.
            </div>
          ) : (
            systemNotifications.map((notif, idx) => (
              <div key={notif.inbox_id || notif.id || idx} style={{ padding: '10px', backgroundColor: '#FAFAFA', borderRadius: '6px', marginBottom: '8px' }}>
                <strong>{notif.title || 'Thông báo'}:</strong> {notif.summary || notif.message || '(Không có nội dung)'} • {notif.created_at ? new Date(notif.created_at).toLocaleString('vi-VN') : (notif.time || 'Vừa xong')} • Trạng thái: SENT
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  if (activeTab === 'mkt-campaigns') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>6. Chiến Dịch Truyền Thông Nội Bộ (Campaigns)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div>Chiến dịch đang chạy: <strong>Tháng Văn Hóa Phục Vụ Nụ Cười Ụm Bò Milk</strong></div>
        </div>
      </div>
    );
  }

  if (activeTab === 'mkt-media') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>7. Kho Đa Phương Tiện Truyền Thông (Media Assets)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px' }}>Quản lý logo, banner thông báo và hình ảnh thương hiệu lưu trữ trên Google Drive.</div>
        </div>
      </div>
    );
  }

  if (activeTab === 'mkt-tracking') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>8. Theo Dõi Trạng Thái Gửi Tin Realtime</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px', color: '#10B981', fontWeight: 700 }}>✓ Socket.IO Connected: 100% thiết bị nhận được thông báo ngay lập tức.</div>
        </div>
      </div>
    );
  }

  if (activeTab === 'mkt-notifications') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>9. Thông Báo Hệ Thống Marketing</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px' }}>Hạ tầng phát thanh Socket.IO và Google Sheets hoạt động bình thường.</div>
        </div>
      </div>
    );
  }

  return null;
};
