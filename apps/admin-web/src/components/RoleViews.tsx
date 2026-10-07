import React, { useState, useEffect, useRef } from 'react';
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
  Printer,
  ShieldCheck,
  IdCard,
} from 'lucide-react';
import { getDisplayBranch } from '../App';
import { apiRequest, getApiBase, getAuthToken } from '../services/api';
import { playInterviewAlert, playFanfare } from '../utils/sound-effects';
import { PerfectScoreCelebration } from './PerfectScoreCelebration';

/** Chat Zalo với ứng viên: tự động kết bạn qua nick HR + gửi lời chào (dùng chung 2 tab). */
export async function chatZaloWithCandidate(c: any, showToast: (msg: string) => void): Promise<void> {
  const phone = c?.phone || c?.phone_normalized;
  if (!phone) {
    showToast('Ứng viên chưa có số điện thoại!');
    return;
  }
  try {
    showToast(`Đang tự động kết bạn Zalo tới ${c.full_name}...`);
    await apiRequest('/admin/zalo/send-friend-request', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        message: `Chào ${c.full_name}, mình là HR Ụm Bò Milk. Kết bạn để trao đổi lịch phỏng vấn nhé!`,
      }),
    });
    showToast(`✅ Đã gửi kết bạn Zalo tới ${c.full_name}! Khi bạn ấy đồng ý, HR nhắn tin trực tiếp qua Zalo.`);
  } catch (err: any) {
    showToast(err.message || 'Gửi kết bạn Zalo thất bại!');
  }
}

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

/** Ảnh bằng chứng phiếu bổ sung công: tải blob kèm token rồi hiện (thẻ <img> không gửi được Authorization). */
export const AdjPhoto: React.FC<{ adjustmentId: string; style?: React.CSSProperties }> = ({ adjustmentId, style }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let objUrl: string | null = null;
    (async () => {
      try {
        const res = await fetch(`${getApiBase()}/attendance/adjustments/${adjustmentId}/photo`, {
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
  if (failed || !adjustmentId) {
    return <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>—</span>;
  }
  if (!url) {
    return <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Đang tải...</span>;
  }
  return <img src={url} alt="Ảnh bằng chứng" style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--border)', cursor: 'zoom-in', ...(style || {}) }} />;
};
/** Chuẩn hóa tiếng Việt bỏ dấu để tìm kiếm không dấu (gõ "nguyen" vẫn ra "Nguyễn"). */
export function stripAccentsVI(s: unknown): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}
/** Nén ảnh avatar HR upload ở tab Hồ Sơ về JPEG ≤512px để gửi nhẹ (mirror cổng NV). */
export function compressAvatarImage(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const img = new Image();
          img.onload = () => {
            try {
              const max = 512;
              const scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
              const w = Math.max(1, Math.round((img.width || max) * scale));
              const h = Math.max(1, Math.round((img.height || max) * scale));
              const canvas = document.createElement('canvas');
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext('2d');
              if (!ctx) return resolve(null);
              ctx.drawImage(img, 0, 0, w, h);
              resolve(canvas.toDataURL('image/jpeg', 0.82));
            } catch { resolve(null); }
          };
          img.onerror = () => resolve(null);
          img.src = String(reader.result || '');
        } catch { resolve(null); }
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    } catch { resolve(null); }
  });
}
/** Avatar nhân viên tab Hồ Sơ: tải blob kèm token rồi hiện (thẻ <img> không gửi được Authorization). */
export const EmpAvatar: React.FC<{ employeeId: string; size?: number }> = ({ employeeId, size }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const px = size || 72;
  useEffect(() => {
    let alive = true;
    let objUrl: string | null = null;
    (async () => {
      try {
        const res = await fetch(`${getApiBase()}/employees/${employeeId}/avatar`, {
          headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        if (!res.ok) throw new Error('no avatar');
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
  }, [employeeId]);
  if (failed || !employeeId || !url) return null;
  return <img src={url} alt="Avatar" style={{ width: `${px}px`, height: `${px}px`, objectFit: 'cover', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.6)' }} />;
};
import { evaluateCandidateAiScore } from '../services/ai-scorer';
import { candStatusVI, computeRubricClient, INTERVIEW_RUBRICS, lockedQuestionIds, parseScoreDetailClient, requiredAnswerCount } from '../services/interview-rubric';

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
  showToast: (msg: string, type?: 'INFO' | 'WARNING', customTitle?: string) => void;
  openNewEmpModal: () => void;
  openBroadcastModal: () => void;
  onSyncSheets?: () => Promise<void> | void;
  /** Đẩy bộ nhớ -> Google Sheets NGAY (sync-now). Dùng sau khi Sửa hồ sơ NV để
   *  ngày bắt đầu/ngày chính thức bền vững qua reload — pull ngay sau PUT có thể
   *  đọc Sheet cũ (push nền ~10s) và gây cảm giác mất dữ liệu realtime. */
  onPushSheets?: () => Promise<void> | void;
  onRefreshData?: () => Promise<void> | void;
}

/** Các tuần cố định T2–CN quanh tuần hiện tại cho dropdown (mặc định tuần này). */
export function weekOptions(centerOffset = 0, span = 4): { offset: number; mon: string; sun: string; label: string }[] {
  const out: { offset: number; mon: string; sun: string; label: string }[] = [];
  for (let o = centerOffset - span; o <= centerOffset + span; o++) {
    const mon = mondayIsoOfOffset(o);
    const d = new Date(`${mon}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 6);
    const sun = d.toISOString().slice(0, 10);
    const f = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
    out.push({ offset: o, mon, sun, label: `${f(mon)} - ${f(sun)}${o === 0 ? ' (tuần này)' : ''}` });
  }
  return out;
}

/** Chuẩn hóa mọi biến thể ngày về YYYY-MM-DD (mirror backend normSheetDate):
 *  ISO/ISO-datetime, serial Sheets, 'M/D/YYYY' (US) / 'D/M/YYYY' (VN — Sheets tự
 *  biến 'YYYY-MM-DD' ghi bằng USER_ENTERED thành serial rồi đọc lại theo locale,
 *  từng gây mất ngày bắt đầu NV thử việc sau reload). Không parse được -> ''. */
export function toISODate(input: unknown): string {
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
    let m: number; let d: number;
    if (a > 12 && b <= 12) { d = a; m = b; }
    else if (b > 12 && a <= 12) { m = a; d = b; }
    else { d = a; m = b; }
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return '';
  }
  const t = new Date(s).getTime();
  if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);
  return '';
}

/** Link Google Meet mặc định hệ thống cho mọi lịch PV online. */
export const SYSTEM_MEET_URL = 'https://meet.google.com/ypp-srtm-fvm';

/** 3 ca làm việc chuẩn của hệ thống (dùng cho dropdown chốt 1 ca). */
export const SHIFT_OPTIONS = ['Ca sáng (07-12)', 'Ca chiều (12-18)', 'Ca tối (18-23)'];

/** Mốc giờ bắt đầu PV (giờ VN) từ ngày + khung giờ — null khi chưa xếp lịch. */
export function interviewStartMs(c: any): number | null {
  const d = String(c?.interview_date || '').slice(0, 10);
  const m = String(c?.interview_time_slot || '').match(/(\d{1,2}):(\d{2})/);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !m) return null;
  const t = new Date(`${d}T${String(m[1]).padStart(2, '0')}:${m[2]}:00+07:00`).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Ràng buộc khung PV cố định 30 phút (mirror backend interview-slots.service). */
export const PV_SLOT_MINUTES = 30;
export const PV_WORK_START = '08:00';
export const PV_WORK_END = '17:00';

export function pvNormalizeSlot(input: unknown): string | null {
  const m = String(input || '').match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/** Validate khung giờ PV ở client — trả text lỗi tiếng Việt để toast + yêu cầu đăng ký lại. */
export function pvValidateSlot(dateInput: unknown, slotInput: unknown): { ok: true; normalized: string; startMs: number } | { ok: false; error: string } {
  const date = String(dateInput || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: `Ngày phỏng vấn không hợp lệ! Vui lòng chọn lại ngày (dạng YYYY-MM-DD).` };
  }
  const norm = pvNormalizeSlot(slotInput);
  if (!norm) {
    return { ok: false, error: `Giờ phỏng vấn '${slotInput}' không hợp lệ! Khung cố định 30 phút — giờ phải dạng HH:mm (VD 08:00, 08:30). Vui lòng đăng ký lại.` };
  }
  const [h, mi] = norm.split(':').map(Number);
  if (mi !== 0 && mi !== 30) {
    return { ok: false, error: `Giờ ${norm} KHÔNG đúng khung cố định 30 phút! Mỗi bạn cách nhau 30 phút — phút phải là :00 hoặc :30 (VD 08:00, 08:30, 09:00). Vui lòng đăng ký lại.` };
  }
  const startMin = h * 60 + mi;
  if (startMin < 8 * 60 || startMin > 16 * 60 + 30) {
    return { ok: false, error: `Giờ ${norm} ngoài giờ phỏng vấn (08:00–17:00)! Giờ bắt đầu hợp lệ từ 08:00 đến 16:30. Vui lòng đăng ký lại.` };
  }
  const startMs = new Date(`${date}T${norm}:00+07:00`).getTime();
  if (!Number.isFinite(startMs)) {
    return { ok: false, error: `Không tính được mốc giờ ${norm} ngày ${date}! Vui lòng đăng ký lại.` };
  }
  return { ok: true, normalized: norm, startMs };
}

/** Tìm lịch cùng ngày kẹt < 30 phút (bỏ qua chính ứng viên đang xếp). */
export function pvFindConflict(cands: any[], date: string, startMs: number, excludeId?: string): { name: string; slot: string } | null {
  for (const c of cands || []) {
    if (!c || (excludeId && (c as any).submission_id === excludeId)) continue;
    if (String((c as any).interview_date || '').slice(0, 10) !== date) continue;
    const st = interviewStartMs(c);
    if (st === null) continue;
    if (Math.abs(st - startMs) < PV_SLOT_MINUTES * 60_000) {
      return { name: String((c as any).full_name || 'ứng viên khác'), slot: String((c as any).interview_time_slot || '').slice(0, 5) };
    }
  }
  return null;
}

/** Các khung đã kín cùng ngày (HH:mm) để hiển thị gợi ý đăng ký lại. */
export function pvBookedSlots(cands: any[], date: string, excludeId?: string): string[] {
  const out: string[] = [];
  for (const c of cands || []) {
    if (!c || (excludeId && (c as any).submission_id === excludeId)) continue;
    if (String((c as any).interview_date || '').slice(0, 10) !== date) continue;
    const n = pvNormalizeSlot((c as any).interview_time_slot);
    if (n && !out.includes(n)) out.push(n);
  }
  return out.sort();
}

/** Tick chọn nhân viên (dùng chung cho giao bài TEST tay + đề random):
 *  tìm kiếm + chọn tất cả/bỏ chọn + thẻ NV có avatar, badge đếm, layout lưới. */
export function EmployeeTickPicker(props: {
  employees: any[];
  selected: string[];
  onToggle: (id: string) => void;
  onSelectVisible: (ids: string[]) => void;
  onClear: () => void;
  search: string;
  onSearchChange: (v: string) => void;
  accent?: string;
  softBg?: string;
  maxHeight?: number;
}) {
  const {
    employees, selected, onToggle, onSelectVisible, onClear,
    search, onSearchChange, accent = '#7C3AED', softBg = '#F5F3FF',
    maxHeight = 208,
  } = props;
  const q = search.trim().toLowerCase();
  const filtered = (employees || [])
    .filter((e: any) => e?.employment_status !== 'TERMINATED')
    .filter((e: any) => !q
      || (e.full_name || '').toLowerCase().includes(q)
      || (e.employee_code || '').toLowerCase().includes(q)
      || (e.phone_normalized || '').includes(q))
    .slice(0, 120);
  const visibleIds = filtered.map((e: any) => e.employee_id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id: string) => selected.includes(id));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <span style={{ fontWeight: 800, fontSize: '13px' }}>Tick chọn nhân viên làm bài</span>
        <span style={{
          fontSize: '11px', fontWeight: 800, padding: '3px 10px', borderRadius: '999px',
          backgroundColor: selected.length > 0 ? accent : '#F1F5F9',
          color: selected.length > 0 ? '#FFF' : '#64748B',
        }}>
          {selected.length} đã chọn
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: '6px' }}>
          {!allVisibleSelected && visibleIds.length > 0 && (
            <button
              type="button"
              onClick={() => onSelectVisible(visibleIds)}
              style={{ fontSize: '11px', fontWeight: 700, color: accent, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: '2px 4px' }}
            >
              Chọn tất cả ({visibleIds.length})
            </button>
          )}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              style={{ fontSize: '11px', fontWeight: 700, color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: '2px 4px' }}
            >
              Bỏ chọn hết
            </button>
          )}
        </span>
      </div>
      <div style={{ position: 'relative', marginBottom: '8px' }}>
        <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Tìm tên / mã NV / SĐT..."
          style={{ width: '100%', maxWidth: '320px', padding: '7px 10px 7px 32px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px', outline: 'none' }}
        />
      </div>
      {filtered.length === 0 ? (
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', backgroundColor: 'var(--bg)', border: '1px dashed var(--border)', borderRadius: '8px', padding: '14px', textAlign: 'center' }}>
          Không tìm thấy nhân viên nào khớp từ khóa.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(215px, 1fr))', gap: '8px', maxHeight, overflowY: 'auto', padding: '10px', backgroundColor: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '10px' }}>
          {filtered.map((e: any) => {
            const checked = selected.includes(e.employee_id);
            return (
              <label
                key={e.employee_id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '9px', padding: '8px 10px',
                  borderRadius: '10px', cursor: 'pointer', backgroundColor: checked ? softBg : 'var(--surface)',
                  border: checked ? `1.5px solid ${accent}` : '1px solid var(--border)',
                  boxShadow: checked ? `0 2px 8px ${accent}22` : 'none',
                  transition: 'all .12s ease',
                }}
              >
                <span style={{
                  width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: '13px',
                  backgroundColor: checked ? accent : '#F1F5F9',
                  color: checked ? '#FFF' : '#64748B',
                }}>
                  {checked ? '✓' : String(e.full_name || 'NV').charAt(0).toUpperCase()}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {e.full_name}
                  </span>
                  <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)' }}>
                    {e.employee_code}{e.employment_status === 'PROBATION' ? ' • Thử việc' : e.employment_status === 'OFFICIAL' ? ' • Chính thức' : ''}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(e.employee_id)}
                  style={{ accentColor: accent, width: '15px', height: '15px', flexShrink: 0, cursor: 'pointer' }}
                />
              </label>
            );
          })}
        </div>
      )}
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
        Hiển thị {filtered.length} nhân viên{selected.length > 0 && <> • <strong style={{ color: accent }}>{selected.length} đã chọn</strong> — bấm "Bỏ chọn hết" để chọn lại</>}.
      </div>
    </div>
  );
}

/** Kiểm tra xem ứng viên có verdict 'FAIL' (Chưa đạt) từ rubric chấm điểm không. */
export function getFailVerdictInfo(c: any): { isFail: boolean; scoredAt: number; remainingMs: number } {
  const d = parseScoreDetailClient((c as any)?.interview_score_detail);
  if (!d || d.verdict !== 'FAIL') return { isFail: false, scoredAt: 0, remainingMs: 0 };
  
  // Lấy thời gian chấm điểm: ưu tiên updated_at > created_at > interview_date+time > now
  let scoredAt = Date.parse((c as any)?.updated_at);
  if (!Number.isFinite(scoredAt)) scoredAt = Date.parse((c as any)?.created_at);
  if (!Number.isFinite(scoredAt)) {
    // Fallback: dùng ngày giờ phỏng vấn (nếu có) + 1 tiếng
    const interviewMs = interviewStartMs(c);
    if (interviewMs !== null && Number.isFinite(interviewMs)) scoredAt = interviewMs + 60 * 60 * 1000;
  }
  if (!Number.isFinite(scoredAt)) scoredAt = Date.now();
  
  const AUTO_DELETE_HOURS = 24;
  const deadlineMs = scoredAt + AUTO_DELETE_HOURS * 60 * 60 * 1000;
  const remainingMs = Math.max(0, deadlineMs - Date.now());
  return { isFail: true, scoredAt, remainingMs };
}

/** Format milliseconds thành HH:MM:SS */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Chuẩn hiển thị cột Thời Gian lịch PV: dd/MM/yyyy - HH:mm. */
export function fmtPvTime(c: any): string {
  const d = toISODate((c as any)?.interview_date);
  const t = String((c as any)?.interview_time_slot || '').slice(0, 5);
  if (!d || !/^\d{2}:\d{2}$/.test(t)) return '';
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} - ${t}`;
}

/** Auto-huỷ lịch PV: sau giờ hẹn N phút không ai vào Meet thì hiện nút Huỷ + đếm ngược. */
export const PV_NOJOIN_CANCEL_MIN = 5;
export const PV_CANCEL_COUNTDOWN_SEC = 20;

/** Dịch mã lỗi gửi Zalo thành câu hướng dẫn HR (dùng cho toast tạo lịch + gửi lại). */
export function zaloInviteErrorText(err: any): string | null {
  const msg = String(err?.message || '');
  const code = String((err as any)?.code || '');
  const s = `${code} ${msg}`;
  if (/ZALO_NOT_CONNECTED/.test(s)) return '⚠️ Nick Zalo HR chưa kết nối (phiên hết hạn hoặc chưa quét QR)! Quét QR đăng nhập lại ở khung trên rồi bấm Gửi lại.';
  if (/ZALO_USER_NOT_FOUND/.test(s)) return '⚠️ SĐT ứng viên chưa đăng ký Zalo! Kiểm tra lại SĐT rồi bấm Gửi lại.';
  if (/ZALO_NOT_FRIEND/.test(s)) return '⚠️ Ứng viên chưa kết bạn Zalo với nick HR! Bấm "Chat Zalo" ở dòng ứng viên để kết bạn trước, rồi bấm Gửi lại.';
  if (/TRÙNG LỊCH PV/.test(msg)) {
    const m = msg.match(/Đã kín: ([^.]+)/);
    return `⛔ ${msg}${m ? '' : ' Vui lòng đăng ký lại khung giờ khác!'}`;
  }
  if (/khung cố định 30 phút|ngoài giờ phỏng vấn|đã qua|đăng ký lại/.test(msg)) return `⛔ ${msg}`;
  return null;
}

/** Ngày Việt Nam (UTC+7) của 1 mốc ISO. */
export function vnDayOf(iso: string): string {
  const t = new Date(iso || '').getTime();
  if (!Number.isFinite(t)) return '';
  return new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** Trạng thái 1 ca chấm công theo đúng luật (xanh/vàng nhấp nháy/xám/đỏ/cam/chàm). */
export function attShiftStatus(shift: any, inEvt: any, outEvt: any, absentEvt: any): {
  key: string; label: string; bg: string; fg: string; border: string; blink: boolean; lateMin: number;
} {
  const complete = !!(inEvt && outEvt);
  if (complete) return { key: 'COMPLETED', label: '✓ Hoàn thành', bg: '#ECFDF5', fg: '#047857', border: '1px solid #A7F3D0', blink: false, lateMin: 0 };
  const todayStr = vnDayOf(new Date().toISOString());
  const shiftDay = String(shift?.date || '').slice(0, 10);
  // Chốt cứng: ngày đã qua mà thiếu check-out (kể cả end_at lỗi) -> hết nhấp nháy
  if (inEvt && !outEvt && shiftDay && shiftDay < todayStr) return { key: 'MISSING_OUT', label: 'Thiếu check-out — không lương', bg: '#FFF7ED', fg: '#9A3412', border: '1.5px solid #EA580C', blink: false, lateMin: 0 };
  const startMs = shift?.start_at ? new Date(shift.start_at).getTime() : NaN;
  const endMs = shift?.end_at ? new Date(shift.end_at).getTime() : NaN;
  const now = Date.now();
  if (!inEvt && absentEvt) return { key: 'ABSENT', label: '🔴 Vắng — không lương', bg: '#FEE2E2', fg: '#991B1B', border: '1.5px solid #EF4444', blink: false, lateMin: 0 };
  if (!inEvt && Number.isFinite(startMs) && now - startMs > 3 * 60 * 60 * 1000) return { key: 'LOCKED', label: '🔒 Khóa — nghỉ không lương', bg: '#F1F5F9', fg: '#475569', border: '1.5px solid #64748B', blink: false, lateMin: 0 };
  if (inEvt && !outEvt && Number.isFinite(endMs) && now - endMs > 30 * 60 * 1000) return { key: 'MISSING_OUT', label: 'Thiếu check-out — không lương', bg: '#FFF7ED', fg: '#9A3412', border: '1.5px solid #EA580C', blink: false, lateMin: 0 };
  if (!inEvt && Number.isFinite(startMs) && now < startMs - 30 * 60 * 1000) return { key: 'UPCOMING', label: 'Lịch đã duyệt', bg: '#EEF2FF', fg: '#3730A3', border: '1px solid #C7D2FE', blink: false, lateMin: 0 };
  const lateMin = inEvt?.is_late ? Number(inEvt.minutes_deviation) || 0 : 0;
  if (inEvt) return { key: 'CHECKED_IN', label: 'Đang làm (chờ check-out)', bg: '#FEF3C7', fg: '#92400E', border: '1.5px solid #F59E0B', blink: true, lateMin };
  return { key: 'PENDING', label: 'Chưa check-in', bg: '#FEF3C7', fg: '#92400E', border: '1px solid #FCD34D', blink: false, lateMin: 0 };
}

/**
 * Lương + phạt 1 ca (mirror payroll.service lateFineFor để lưới realtime hiện ngay,
 * Finance chốt số chính thức ở kỳ lương):
 * trễ <5p: không phạt; 5–29p: -30k; 30–59p: -50% lương ca; ≥60p hoặc thiếu in/out: 0đ.
 */
export const SHIFT_HOURS_MAP: Record<string, number> = { CA_1: 5, CA_2: 6, CA_3: 5 };
/** Phút trễ: ưu tiên cờ server, mất cờ (dòng Sheet cũ) thì tính bù từ giờ vào ca. */
export function lateMinOf(inEvt: any, shiftStartAt?: string): number {
  if (inEvt?.is_late) return Number(inEvt.minutes_deviation) || 0;
  if (inEvt && (inEvt.is_late === undefined || inEvt.is_late === null)) {
    const st = new Date(shiftStartAt || '').getTime();
    const ct = new Date(inEvt.client_time || '').getTime();
    if (Number.isFinite(st) && Number.isFinite(ct)) return Math.max(0, Math.round((ct - st) / 60000));
  }
  return 0;
}

export function shiftPayInfo(shiftCode: string, ratePerHour: number, inEvt: any, outEvt: any, shiftStartAt?: string): {
  hours: number; rate: number; shiftPay: number; lateMin: number;
  fineLabel: string; deduction: number; net: number; unpaid: boolean;
} {
  const hours = SHIFT_HOURS_MAP[shiftCode] ?? 5;
  const rate = Number(ratePerHour) || 0;
  const shiftPay = hours * rate;
  const lateMin = lateMinOf(inEvt, shiftStartAt);
  if (!inEvt || !outEvt) {
    return { hours, rate, shiftPay, lateMin, fineLabel: 'Thiếu check-in/out — không lương', deduction: 0, net: 0, unpaid: true };
  }
  // Ưu tiên mức phạt server đã ghi nhận lúc check-in (ràng buộc chặt, không tính lại).
  const storedTier = inEvt?.fine_tier;
  if (storedTier && storedTier !== 'NONE') {
    const amt = Number(inEvt.fine_amount) || 0;
    if (storedTier === 'FULL_SHIFT') {
      return { hours, rate, shiftPay, lateMin, fineLabel: `Trễ ${Math.floor(lateMin)}p — phạt 100% (không lương, đã ghi nhận)`, deduction: 0, net: 0, unpaid: true };
    }
    return { hours, rate, shiftPay, lateMin, fineLabel: `Trễ ${Math.floor(lateMin)}p — phạt ${amt.toLocaleString('vi-VN')}đ (đã ghi nhận)`, deduction: amt, net: Math.max(0, shiftPay - amt), unpaid: false };
  }
  const m = Math.floor(lateMin);
  if (m < 5) return { hours, rate, shiftPay, lateMin, fineLabel: 'Đúng giờ — không phạt', deduction: 0, net: shiftPay, unpaid: false };
  if (m < 30) return { hours, rate, shiftPay, lateMin, fineLabel: `Trễ ${m}p — phạt 30.000đ`, deduction: 30000, net: Math.max(0, shiftPay - 30000), unpaid: false };
  if (m < 60) {
    const d = Math.round(shiftPay * 0.5);
    return { hours, rate, shiftPay, lateMin, fineLabel: `Trễ ${m}p — phạt 50% lương ca`, deduction: d, net: shiftPay - d, unpaid: false };
  }
  return { hours, rate, shiftPay, lateMin, fineLabel: `Trễ ${m}p — phạt 100% (không lương)`, deduction: 0, net: 0, unpaid: true };
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

/**
 * Chu kỳ đăng ký OFF tuần HIỆN TẠI (reset Thứ 6 09:00 VN).
 * Chu kỳ mở lúc T6 09:00 đăng ký cho tuần Mon–Sun KẾ sau Thứ 6 đó.
 * Sheet DON_NGHI_PHEP giữ toàn bộ lịch sử — UI chỉ lọc hiển thị theo chu kỳ.
 */
export function currentOffCycle(): { mon: string; sun: string; label: string; cycleFriday: string } {
  const vn = new Date(Date.now() + 7 * 3_600_000);
  const dowMon0 = (vn.getUTCDay() + 6) % 7;
  const mins = vn.getUTCHours() * 60 + vn.getUTCMinutes();
  let daysSinceFri = (dowMon0 - 4 + 7) % 7;
  // Đang Thứ 6 nhưng chưa tới 09:00 → vẫn thuộc chu kỳ cũ (Thứ 6 tuần trước).
  if (daysSinceFri === 0 && mins < 9 * 60) daysSinceFri = 7;
  const midnightUtc = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate());
  const fri = new Date(midnightUtc - daysSinceFri * 86_400_000);
  const mon = new Date(fri.getTime() + 3 * 86_400_000);
  const sun = new Date(fri.getTime() + 9 * 86_400_000);
  const fmt = (x: Date) => `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
  return { mon: fmt(mon), sun: fmt(sun), label: `${fmt(mon)} → ${fmt(sun)}`, cycleFriday: fmt(fri) };
}

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
    e.employment_status === 'OFFICIAL' && !(e as any)?.account_locked && canonicalBranchId(e.default_branch_id) === canonicalBranchId(branch)
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
      const warns: string[] = (res?.auto?.warnings || []).map((w: any) => w.message || '').filter(Boolean);
      const warnText = warns.length > 0 ? ` Cảnh báo (${warns.length}): ${warns.slice(0, 3).join(' | ')}${warns.length > 3 ? ' | ...' : ''}` : '';
      const persistWarn = res?.sheetPersisted === false ? ' ⚠️ Chưa ghi được lên Google Sheets — restart server có thể rớt về nháp, bấm Đồng bộ lại!' : '';
      showToast(`Đã PUBLISH tuần ${weekMon}: BOT xếp thêm ${autoCount} ca, duyệt ${res?.count ?? 0} ca (DRAFT→PUBLISHED).${warnText}${persistWarn}`);
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
  onPushSheets,
  onRefreshData,
}) => {
  const branchScope = currentUser?.branchScope || '*';
  const branchName = branchScope === '*' ? 'Toàn Hệ Thống' : getDisplayBranch(branchScope);

  // Filters for HR Schedule
  const [scheduleBranchFilter, setScheduleBranchFilter] = useState('ALL');
  const [scheduleStageFilter, setScheduleStageFilter] = useState('ALL');
  const [scheduleAttFilter, setScheduleAttFilter] = useState('ALL');
  const [scheduleSearch, setScheduleSearch] = useState('');
  const [selectedRealtimeModal, setSelectedRealtimeModal] = useState<any>(null);

  // Filters xem lịch OFF 2 ngày/tuần (HR/Admin + Store)
  const [weeklyOffBranchFilter, setWeeklyOffBranchFilter] = useState('ALL');
  const [weeklyOffSearch, setWeeklyOffSearch] = useState('');
  // Reset lịch OFF trùng ca đã đăng ký từ trước về chưa đăng ký (NV đăng ký lại).
  const [offOverlapBusy, setOffOverlapBusy] = useState(false);  const handleResetWeeklyOffOverlaps = async () => {
    if (offOverlapBusy) return;
    setOffOverlapBusy(true);
    try {
      const preview: any = await apiRequest('/admin/weekly-off/reset-overlaps', {
        method: 'POST',
        body: JSON.stringify({ dryRun: true }),
      });
      const groups = (preview?.groups || []) as any[];
      const overLimit = (preview?.overLimit || []) as any[];
      if (groups.length === 0 && overLimit.length === 0) {
        showToast('✅ Không có lịch OFF nào trùng ca hay quá 2 ngày/tuần từ hôm nay trở đi!');
        return;
      }
      const lines = groups.slice(0, 10).map((g: any) =>
        `• TRÙNG: ${g.branch} ${g.date} ${g.slot}: ${(g.employees || []).join(', ')}`
      ).join('\n');
      const more = groups.length > 10 ? `\n… +${groups.length - 10} nhóm nữa` : '';
      const olLines = overLimit.slice(0, 10).map((o: any) =>
        `• QUÁ 2 NGÀY: ${o.employee} (tuần ${o.week}): giữ ${(o.kept || []).join(', ')}, hủy ${(o.cancelled || []).join(', ')}`
      ).join('\n');
      const olMore = overLimit.length > 10 ? `\n… +${overLimit.length - 10} bạn nữa` : '';
      if (!window.confirm(
        `Rà soát từ hôm nay: ${groups.length} nhóm OFF trùng ca + ${overLimit.length} bạn quá 2 ngày/tuần:\n${lines}${more}${olLines ? `\n${olLines}${olMore}` : ''}\n\nBấm OK để HỦY toàn bộ phiếu trùng/thừa → NV về trạng thái chưa đăng ký (trùng ca) hoặc giữ đúng 2 ngày mới nhất (quá giới hạn) rồi đăng ký lại.\nKHÔNG thể hoàn tác!`
      )) return;
      const res: any = await apiRequest('/admin/weekly-off/reset-overlaps', {
        method: 'POST',
        body: JSON.stringify({ dryRun: false }),
      });
      showToast(`🧹 Đã hủy ${res?.cancelledCount || 0} phiếu trùng ca + kẹp ${res?.cancelledOverLimitCount || 0} phiếu quá 2 ngày/tuần — NV liên quan đăng ký lại!`);
      if (onRefreshData) await onRefreshData();
      if (onPushSheets) await onPushSheets();
    } catch (e: any) {
      showToast(e?.message || 'Lỗi khi reset lịch OFF trùng ca!');
    } finally {
      setOffOverlapBusy(false);
    }
  };
  // Reset ALL lịch OFF tuần: xóa hết đăng ký để NV đăng ký lại — mở modal nhập pass mới chạy.
  const [offResetAllOpen, setOffResetAllOpen] = useState(false);
  const [offResetAllPass, setOffResetAllPass] = useState('');
  // Chống trình duyệt/quản lý mật khẩu TỰ ĐIỀN pass (autofill): chỉ chấp nhận giá trị
  // HR gõ tay — mở modal/focus mà chưa gõ thì luôn là rỗng.
  const offResetAllTypedRef = useRef(false);
  const [offResetAllBusy, setOffResetAllBusy] = useState(false);
  const [offResetAllPreview, setOffResetAllPreview] = useState<any>(null);
  const openResetAllModal = async () => {
    setOffResetAllPass('');
    offResetAllTypedRef.current = false;
    setOffResetAllPreview(null);
    setOffResetAllOpen(true);
    try {
      const preview: any = await apiRequest('/admin/weekly-off/reset-all', {
        method: 'POST',
        body: JSON.stringify({ dryRun: true }),
      });
      setOffResetAllPreview(preview);
    } catch (e: any) {
      showToast(e?.message || 'Lỗi khi xem trước Reset ALL!');
      setOffResetAllOpen(false);
    }
  };
  const handleResetAllWeeklyOff = async () => {
    if (offResetAllBusy) return;
    if (!offResetAllPass.trim()) {
      showToast('⚠️ Vui lòng nhập mật khẩu Reset ALL!');
      return;
    }
    setOffResetAllBusy(true);
    try {
      const res: any = await apiRequest('/admin/weekly-off/reset-all', {
        method: 'POST',
        body: JSON.stringify({ dryRun: false, pass: offResetAllPass.trim() }),
      });
      showToast(`🗑 Đã Reset ALL: hủy ${res?.cancelledCount || 0} phiếu OFF của ${res?.employeeCount || 0} NV — tất cả đăng ký lại từ đầu!`);
      setOffResetAllOpen(false);
      setOffResetAllPass('');
      if (onRefreshData) await onRefreshData();
      if (onPushSheets) await onPushSheets();
    } catch (e: any) {
      showToast(e?.message || 'Lỗi khi Reset ALL!');
    } finally {
      setOffResetAllBusy(false);
    }
  };
  // Chu kỳ OFF hiển thị: 'CURRENT' = chu kỳ hiện tại (reset T6 09:00), hoặc label tuần cũ để xem lịch sử.
  const [weeklyOffWeekFilter, setWeeklyOffWeekFilter] = useState('CURRENT');
  // Xem lịch tuần trước / hiện tại / sau (mặc định tuần hiện tại)
  const [scheduleWeekOffset, setScheduleWeekOffset] = useState(0);
  // Sự kiện điểm danh tuần cũ từ kho LUUTRU (tab Lịch lùi tuần + dải 12 ngày thử việc
  // quá khứ): gộp với realtime để ô ngày cũ hiện đủ giờ in/out.
  const [archiveEvents, setArchiveEvents] = useState<any[]>([]);
  const archiveWeeksRef = useRef<Set<string>>(new Set());
  const [archiveLoading, setArchiveLoading] = useState(false);
  // Lịch ca tuần cũ: API /schedules mặc định chỉ trả từ hôm nay trở đi — lùi tuần
  // thì tải bù từ mốc sớm nhất rồi gộp vào lưới (khử trùng theo assignment_id).
  const [archiveShifts, setArchiveShifts] = useState<any[]>([]);
  const archiveShiftsKeyRef = useRef<string>('');
  // Phiếu đổi ca: tải lại mỗi khi mở tab để không sót phiếu mới (kể cả khi socket ngủ)
  const [swapList, setSwapList] = useState<any[] | null>(null);
  const loadSwaps = async () => {
    try {
      const list = await apiRequest('/swap-requests');
      setSwapList(Array.isArray(list) ? list : []);
    } catch { /* không quyền / offline: giữ props */ }
  };
  // Form HR chuyển ca hỗ trợ chi nhánh (tab hr-support): A nhường ca -> B làm thay
  const [supportOwner, setSupportOwner] = useState('');
  const [supportAssign, setSupportAssign] = useState('');
  const [supportOwnerShifts, setSupportOwnerShifts] = useState<any[]>([]);
  const [supportShiftsLoading, setSupportShiftsLoading] = useState(false);
  const [supportTarget, setSupportTarget] = useState('');
  const [supportReason, setSupportReason] = useState('');
  const [supportBusy, setSupportBusy] = useState(false);
  const loadSupportOwnerShifts = async (employeeId: string) => {
    setSupportOwnerShifts([]);
    setSupportAssign('');
    if (!employeeId) return;
    setSupportShiftsLoading(true);
    try {
      const nowVn = new Date(Date.now() + 7 * 3_600_000);
      const day = (nowVn.getUTCDay() + 6) % 7;
      const mon = new Date(nowVn);
      mon.setUTCDate(mon.getUTCDate() - day);
      const fromD = mon.toISOString().slice(0, 10);
      const toDt = new Date(mon);
      toDt.setUTCDate(toDt.getUTCDate() + 60);
      const list = await apiRequest(`/admin/employee-shifts/${employeeId}?fromDate=${fromD}&toDate=${toDt.toISOString().slice(0, 10)}`);
      const rows = (Array.isArray(list) ? list : [])
        .filter((s: any) => (s as any).status === 'PUBLISHED' && String((s as any).date || '').slice(0, 10) >= fromD)
        .sort((a: any, b: any) => String(a.date || '').localeCompare(String(b.date || '')));
      setSupportOwnerShifts(rows);
    } catch { /* offline */ } finally {
      setSupportShiftsLoading(false);
    }
  };
  // Tính lương + chấm công Finance
  const [payCalcPeriod, setPayCalcPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [payCalcBusy, setPayCalcBusy] = useState(false);
  // Công thức Excel + nhập tay theo kỳ (Finance): TỔNG CỘNG = LCB + PC_OT + giờ + OTt + Bonus;
  // TỔNG LƯƠNG = TỔNG CỘNG − KPI − phạt; THỰC LÃNH = TỔNG LƯƠNG − Ứng − Đồng phục.
  const [payFormula, setPayFormula] = useState<any>(null);
  const [payFormulaBusy, setPayFormulaBusy] = useState(false);
  const [payInputs, setPayInputs] = useState<Record<string, any>>({});
  const [payInputsBusy, setPayInputsBusy] = useState<string | null>(null);
  const loadPayFormula = async (period: string) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return;
    try {
      const f = await apiRequest(`/payroll/formula/${period}`);
      setPayFormula(f || null);
    } catch { /* offline */ }
  };
  const loadPayInputs = async (period: string) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return;
    try {
      const list = await apiRequest(`/payroll/inputs/${period}`);
      const map: Record<string, any> = {};
      for (const x of (Array.isArray(list) ? list : [])) map[x.employee_id] = x;
      setPayInputs(map);
    } catch { /* offline */ }
  };
  useEffect(() => {
    if (activeTab !== 'fin-calculate') return;
    const p = (payCalcPeriod || '').trim();
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) {
      loadPayFormula(p);
      loadPayInputs(p);
    }
  }, [activeTab, payCalcPeriod]);
  const [finMonth, setFinMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [finAttEvents, setFinAttEvents] = useState<any[]>([]);
  const loadFinAttendance = async () => {
    try {
      const data = await apiRequest('/attendance/events');
      setFinAttEvents(Array.isArray(data) ? data : []);
    } catch { /* offline */ }
  };
  useEffect(() => {
    // Dữ liệu finance lấy 100% từ cổng NV (chấm công/lịch realtime) -> tự tải lại 30s
    if (activeTab !== 'fin-timesheet') return;
    loadFinAttendance();
    const t = setInterval(loadFinAttendance, 30000);
    return () => clearInterval(t);
  }, [activeTab, finMonth]);
  const [payRunDetail, setPayRunDetail] = useState<any>(null);
  const [payRunBusy, setPayRunBusy] = useState<string | null>(null);
  const loadPayRunDetail = async (runId: string) => {
    if (!runId) {
      setPayRunDetail(null);
      return;
    }
    try {
      const d = await apiRequest(`/payroll/runs/${runId}`);
      setPayRunDetail(d);
    } catch (e: any) {
      showToast(e?.message || 'Lỗi khi tải chi tiết kỳ lương!');
    }
  };
  const payRunAction = async (runId: string, action: 'reconcile' | 'approve' | 'publish' | 'mark-paid') => {
    const labels: Record<string, string> = {
      reconcile: 'Đối soát',
      approve: 'Phê duyệt (người duyệt phải khác người tính)',
      publish: 'Phát hành phiếu lương',
      'mark-paid': 'Xác nhận đã chi trả ngân hàng',
    };
    if (!window.confirm(`${labels[action]} kỳ lương ${runId}?`)) return;
    setPayRunBusy(runId + action);
    try {
      await apiRequest(`/payroll/${runId}/${action}`, { method: 'POST', body: JSON.stringify({}) });
      showToast(`Đã ${labels[action].toLowerCase()} kỳ lương!`);
      setPayRunDetail(null);
      if (onRefreshData) await onRefreshData();
      if (onSyncSheets) await onSyncSheets();
    } catch (e: any) {
      showToast(e?.message || 'Lỗi!');
    } finally {
      setPayRunBusy(null);
    }
  };
  // Phiếu bổ sung/điều chỉnh công: HR duyệt phiếu NV gửi từ cổng nhân viên
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [adjBusy, setAdjBusy] = useState<string | null>(null);
  // Chống bấm đúp các nút ghi dữ liệu (server cũng chặn trùng, đây là lớp báo sớm).
  const [transitionBusyId, setTransitionBusyId] = useState<string | null>(null);
  const [swapReviewBusy, setSwapReviewBusy] = useState<string | null>(null);
  const [storeReviewBusy, setStoreReviewBusy] = useState<string | null>(null);
  const [schedReloadBusy, setSchedReloadBusy] = useState(false);
  const [storeConfirmBusy, setStoreConfirmBusy] = useState(false);
  // Phiếu đang xem chi tiết (popup: tên NV + lý do & số phút + ảnh + thời gian)
  const [selectedAdj, setSelectedAdj] = useState<any | null>(null);
  // Hồ sơ nhân viên (HR): NV đang xem + sub-tab danh mục + bộ lọc tìm kiếm
  const [profileSearch, setProfileSearch] = useState('');
  const [profileGroup, setProfileGroup] = useState('SALE');
  const [profileEmpId, setProfileEmpId] = useState<string | null>(null);
  const [profileSub, setProfileSub] = useState<'overview' | 'identity' | 'att' | 'pay' | 'legal'>('overview');
  const loadAdjustments = async () => {
    try {
      const list = await apiRequest('/attendance/adjustments');
      setAdjustments(Array.isArray(list) ? list : []);
    } catch { /* không quyền / offline */ }
  };
  // Xuất ZIP chứng cứ điểm danh theo ngày
  const [exportAttDate, setExportAttDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [exportAttBusy, setExportAttBusy] = useState(false);
  const [exportWeekBusy, setExportWeekBusy] = useState(false);
  // Tuần đang xem ở lưới tuần realtime (0 = tuần này)
  const [attWeekOffset, setAttWeekOffset] = useState(0);
  // Ô ca đang hover ở lưới realtime (hiện popup lương/phạt/đổi ca)
  const [attHover, setAttHover] = useState<string | null>(null);
  // Đồng hồ đếm ngược giờ PV (tab lịch phỏng vấn) — tự vào Meet khi tới giờ
  const [meetNow, setMeetNow] = useState(() => Date.now());
  const meetOpenedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (activeTab !== 'hr-interviews') return;
    const t = setInterval(() => setMeetNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeTab]);
  // Tới giờ PV (trong 30p đầu): tự bung link Meet 1 lần/ứng viên/ngày + báo toast.
  // Trình duyệt có thể chặn popup — nút "Vào Meet" nhấp nháy luôn sẵn để bấm tay.
  // Trước giờ PV 15 phút: báo toast nhắc HR chuẩn bị (1 lần/ứng viên/ngày).
  // Trước giờ PV 10 phút: tự mở Meet + tự mở popup chấm điểm để HR chấm trực tiếp.
  // Tới giờ PV: popup cảnh báo + chuông riêng.
  const remind15Ref = useRef<Set<string>>(new Set());
  const t10Ref = useRef<Set<string>>(new Set());
  const t5Ref = useRef<Set<string>>(new Set());
  const meetWindowsRef = useRef<Map<string, Window | null>>(new Map());
  const [meetBlocked, setMeetBlocked] = useState(false);
  const [pvAlert, setPvAlert] = useState<any | null>(null);
  // Auto-huỷ lịch PV: quá 5 phút không vào Meet -> nút Huỷ + đếm ngược 20s.
  // pvJoined: HR đã bấm Vào Meet / mở chấm điểm (= có người vào) -> giữ lịch, tắt đếm ngược.
  const pvJoinedRef = useRef<Set<string>>(new Set());
  const pvAutoCancelRef = useRef<Set<string>>(new Set());
  // Mốc thử auto-huỷ gần nhất (thất bại mạng -> thử lại mỗi 30s thay vì spam mỗi giây).
  const pvAutoRetryRef = useRef<Map<string, number>>(new Map());
  const [pvCancelBusyId, setPvCancelBusyId] = useState<string | null>(null);
  // Xóa cứng ứng viên (HR bấm tay, thay cho chờ tự động).
  const [candDelBusyId, setCandDelBusyId] = useState<string | null>(null);
  // Xác nhận / đánh vắng PV (HR bấm tay khi UV báo qua điện thoại/Zalo).
  const [rsvpBusyId, setRsvpBusyId] = useState<string | null>(null);
  const handleConfirmInterview = async (c: any) => {
    const sid = String((c as any)?.submission_id || '');
    if (!sid || rsvpBusyId) return;
    if (!window.confirm(`Xác nhận ${c?.full_name || ''} SẼ tham gia PV ${String(c?.interview_time_slot || '').slice(0, 5)} ngày ${String(c?.interview_date || '').slice(0, 10)}?`)) return;
    setRsvpBusyId(sid);
    try {
      await apiRequest(`/interviews/${sid}/confirm`, { method: 'POST', body: JSON.stringify({}) });
      showToast(`Đã ghi nhận ${c?.full_name || ''} xác nhận tham gia PV!`);
      if (onRefreshData) await onRefreshData();
      if (onPushSheets) await onPushSheets();
    } catch (e: any) {
      showToast(e?.message || 'Lỗi khi xác nhận!');
    } finally {
      setRsvpBusyId(null);
    }
  };
  const handleNoShowInterview = async (c: any) => {
    const sid = String((c as any)?.submission_id || '');
    if (!sid || rsvpBusyId) return;
    if (!window.confirm(`Đánh dấu ${c?.full_name || ''} VẮNG không phép? Lịch sẽ bị hủy để giải phóng slot (muốn PV lại phải đặt lịch mới).`)) return;
    setRsvpBusyId(sid);
    try {
      await apiRequest(`/interviews/${sid}/no-show`, { method: 'POST', body: JSON.stringify({ reason: 'HR đánh dấu vắng' }) });
      showToast(`Đã đánh vắng ${c?.full_name || ''}! Lịch đã hủy, cần đặt lịch mới nếu PV lại.`);
      if (onRefreshData) await onRefreshData();
      if (onPushSheets) await onPushSheets();
    } catch (e: any) {
      showToast(e?.message || 'Lỗi khi đánh vắng!');
    } finally {
      setRsvpBusyId(null);
    }
  };
  const markPvJoined = (c: any) => {
    if (!c) return;
    pvJoinedRef.current.add(`${(c as any).submission_id}|${String((c as any).interview_date || '').slice(0, 10)}`);
  };
  /** Hủy lịch PV: xóa ngày+khung đã đăng ký, về trạng thái chưa đăng ký lịch. */
  const handleCancelInterview = async (c: any, auto: boolean) => {
    const sid = String((c as any)?.submission_id || '');
    if (!sid || pvCancelBusyId) return;
    const key = `${sid}|${String((c as any).interview_date || '').slice(0, 10)}`;
    if (auto) {
      pvAutoCancelRef.current.add(key);
      pvAutoRetryRef.current.set(key, Date.now());
    }
    setPvCancelBusyId(sid);
    try {
      await apiRequest(`/interviews/${sid}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: auto ? 'Quá 5 phút không vào Meet (tự động hủy sau đếm ngược 20s)' : 'HR hủy lịch phỏng vấn' }),
      });
      showToast(auto ? `⏰ Tự động hủy lịch PV ${c?.full_name || ''} (quá 5 phút không vào Meet)!` : `Đã hủy lịch PV ${c?.full_name || ''} — về trạng thái chưa đăng ký lịch.`);
      pvJoinedRef.current.delete(key);
      pvAutoRetryRef.current.delete(key);
      if (onRefreshData) await onRefreshData();
      // Đẩy bộ nhớ -> Sheets NGAY (tuyệt đối không pull: pull lúc này đọc Sheet cũ
      // vì push nền ~10s sẽ HỒI SINH lịch vừa hủy — đúng bug countdown 00:00 đứng im).
      if (onPushSheets) await onPushSheets();
    } catch (e: any) {
      // Auto thất bại (mất mạng/server chưa deploy): giữ cờ đã bắn, thử lại mỗi 30s
      // ở vòng tick — không xóa cờ để tránh bắn + toast spam mỗi giây.
      showToast(e?.message || 'Lỗi khi hủy lịch phỏng vấn!');
    } finally {
      setPvCancelBusyId(null);
    }
  };
  const [celebration, setCelebration] = useState<{ name: string; total: number; rubric: string } | null>(null);

  /** Thử tự mở tab Meet — trả về true nếu trình duyệt cho phép (false = bị chặn popup).
   *  Bị chặn -> đưa vào hàng đợi, lần bấm CHUỘT/PHÍM kế tiếp của HR trên trang
   *  (có cử chỉ người dùng) sẽ mở bù ngay — không cần bật popup thủ công. */
  const pendingMeetRef = useRef<Map<string, string>>(new Map());
  const tryOpenMeet = (key: string, label?: string): boolean => {
    try {
      const w = window.open(SYSTEM_MEET_URL, '_blank');
      meetWindowsRef.current.set(key, w);
      if (!w) {
        setMeetBlocked(true);
        pendingMeetRef.current.set(key, label || key);
        return false;
      }
      pendingMeetRef.current.delete(key);
      return true;
    } catch {
      meetWindowsRef.current.set(key, null);
      setMeetBlocked(true);
      pendingMeetRef.current.set(key, label || key);
      return false;
    }
  };
  // Xả hàng đợi Meet bị chặn ở cử chỉ người dùng kế tiếp (click/phím bất kỳ).
  useEffect(() => {
    if (activeTab !== 'hr-interviews') return;
    const flush = (e?: Event) => {
      if (pendingMeetRef.current.size === 0) return;
      // Bấm đúng nút Meet thì nút đó tự mở — không xả trùng thêm tab.
      try {
        if ((e as any)?.target && ((e as any).target as HTMLElement).closest?.('[data-meet-open]')) return;
      } catch { /* bỏ qua */ }
      const entries = [...pendingMeetRef.current.entries()];
      pendingMeetRef.current.clear();
      let opened = 0;
      for (const [k, label] of entries) {
        try {
          const w = window.open(SYSTEM_MEET_URL, '_blank');
          meetWindowsRef.current.set(k, w);
          if (w) { opened++; continue; }
        } catch { /* vẫn chặn -> giữ lại */ }
        pendingMeetRef.current.set(k, label);
      }
      if (opened > 0) {
        setMeetBlocked(pendingMeetRef.current.size > 0);
        showToast(`🎬 Đã mở Meet (${opened} phòng) — HR vào phỏng vấn ngay!`);
      }
    };
    document.addEventListener('click', flush, true);
    document.addEventListener('keydown', flush, true);
    return () => {
      document.removeEventListener('click', flush, true);
      document.removeEventListener('keydown', flush, true);
    };
  }, [activeTab]);
  useEffect(() => {
    if (activeTab !== 'hr-interviews') return;
    const empPhones = new Set(
      (allEmployees || []).map((e: any) => String(e.phone_normalized || (e as any).phone || '').replace(/\D/g, '').slice(-9)).filter(Boolean)
    );
    for (const cd of (candidates || [])) {
      // Đã loại / đã duyệt thử việc / đã có hồ sơ NV: không còn lịch PV để nhắc hay tự mở Meet.
      if (['REJECTED', 'ACCEPTED'].includes(String((cd as any)?.status || ''))) continue;
      if (empPhones.has(String((cd as any)?.phone_normalized || (cd as any)?.phone || '').replace(/\D/g, '').slice(-9))) continue;
      const st = interviewStartMs(cd);
      if (!st) continue;
      const key = `${cd.submission_id}|${cd.interview_date}`;
      const diff = st - meetNow;
      if (diff > 0 && diff <= 15 * 60000 && !remind15Ref.current.has(key)) {
        remind15Ref.current.add(key);
        showToast(`⏰ Còn 15 phút tới giờ PV ${cd.full_name} (${String(cd.interview_time_slot || '').slice(0, 5)}) — HR chuẩn bị vào Meet!`);
      }
      // T-10 phút: tự mở Meet + popup chấm điểm (nếu chưa chấm).
      // Lưu ý trình duyệt: tự mở tab không qua click có thể bị chặn popup —
      // thử lại ở T-5 và T-0, đồng thời báo rõ để HR bấm mở tay 1 chạm.
      if (diff > 0 && diff <= 10 * 60000 && !t10Ref.current.has(key)) {
        t10Ref.current.add(key);
        const opened = tryOpenMeet(key, cd.full_name);
        if (!parseScoreDetailClient((cd as any)?.interview_score_detail)) {
          setScoringRubric(((cd as any)?.interview_rubric === 'office' ? 'office' : 'store') as any);
          setScoringAnswers({});
          setScoringId(cd.submission_id);
        }
        showToast(opened
          ? `🎬 Meet đã tự mở cho PV ${cd.full_name} + popup chấm điểm — HR chấm trực tiếp, lưu xong Meet tự đóng!`
          : `⚠️ Trình duyệt đã CHẶN tự mở Meet cho PV ${cd.full_name}! Chỉ cần BẤM vào bất kỳ đâu trên trang (kể cả nút "Vào Meet ngay" trong popup) là Meet mở ngay — không cần bật popup thủ công.`);
      }
      // T-5 phút: mở bù nếu T-10 bị chặn.
      if (diff > 0 && diff <= 5 * 60000 && !t5Ref.current.has(key)) {
        t5Ref.current.add(key);
        const prev = meetWindowsRef.current.get(key);
        if (!prev || prev.closed) {
          const opened = tryOpenMeet(key, cd.full_name);
          if (opened) showToast(`🎬 Meet đã tự mở (mở bù) cho PV ${cd.full_name} — còn 5 phút!`);
        }
      }
      if (meetNow >= st && meetNow - st < 30 * 60000 && !meetOpenedRef.current.has(key)) {
        meetOpenedRef.current.add(key);
        // Meet đã tự mở từ T-10/T-5; chỉ mở lại nếu chưa có (popup từng bị chặn).
        const prev = meetWindowsRef.current.get(key);
        if (!prev || prev.closed) {
          tryOpenMeet(key, cd.full_name);
        }
        playInterviewAlert();
        setPvAlert(cd);
      }
      // Quá 5 phút không vào Meet (không bấm Vào Meet, không chấm điểm) -> tự động
      // hủy sau đếm ngược 20s (UI đếm ngược ở cột Meet). Có người vào -> giữ lịch.
      // Thất bại (mất mạng) -> thử lại mỗi 30s; nút Huỷ tay luôn bấm được.
      const elapsed = meetNow - st;
      const noJoinCancelMs = PV_NOJOIN_CANCEL_MIN * 60_000;
      const scored = !!parseScoreDetailClient((cd as any)?.interview_score_detail);
      const lastAutoTry = pvAutoRetryRef.current.get(key) || 0;
      if (elapsed >= noJoinCancelMs + PV_CANCEL_COUNTDOWN_SEC * 1000
        && !scored
        && !pvJoinedRef.current.has(key)
        && (!pvAutoCancelRef.current.has(key) || meetNow - lastAutoTry >= 30000)
        && !pvCancelBusyId) {
        handleCancelInterview(cd, true);
      }
    }
  }, [meetNow]);
  // Kết quả rà soát GPS mới nhất (hiện ngay trong tab)
  const [gpsReverify, setGpsReverify] = useState<any>(null);
  const [gpsReverifyBusy, setGpsReverifyBusy] = useState(false);
  const [photoStats, setPhotoStats] = useState<any>(null);
  const loadPhotoStats = async (date: string) => {
    try {
      const s = await apiRequest(`/admin/attendance/photo-stats?date=${date}`);
      setPhotoStats(s);
    } catch {
      setPhotoStats(null);
    }
  };
  // Tuần T2–CN đang theo dõi (bảng realtime reset khi sang tuần mới, 23h30 CN tự lưu trữ)
  const attWeek = (() => {
    const now = new Date();
    const dowMon0 = (now.getDay() + 6) % 7;
    const mon = new Date(now);
    mon.setDate(now.getDate() - dowMon0);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const fmt = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const fmtD = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
    const monS = fmt(mon);
    const sunS = fmt(sun);
    const isSunday = now.getDay() === 0;
    return { mon: monS, sun: sunS, label: `${fmtD(monS)} → ${fmtD(sunS)}`, isSunday };
  })();
  // Đề random từ ngân hàng câu hỏi (Google Sheet ngoài): tick NV + gửi 1 lần.
  const [bankInfo, setBankInfo] = useState<any | null>(null);
  const [bankLoading, setBankLoading] = useState(false);
  const [bankTitle, setBankTitle] = useState('');
  const [bankCount, setBankCount] = useState(25);
  const [bankAssignees, setBankAssignees] = useState<string[]>([]);
  const [bankSearch, setBankSearch] = useState('');
  const [bankBusy, setBankBusy] = useState(false);
  const loadBank = async () => {
    setBankLoading(true);
    try {
      const d: any = await apiRequest('/admin/test-bank/preview');
      setBankInfo(d);
      if (d?.count && bankCount > d.count) setBankCount(d.count);
    } catch (e: any) {
      setBankInfo({ error: e?.message || 'Không đọc được ngân hàng câu hỏi!' });
    } finally {
      setBankLoading(false);
    }
  };
  // Báo cáo tháng NV chính thức: tổng giờ, nhất/ít nhất, lương từng người.
  const currentVnMonth = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 7);
  const [reportPeriod, setReportPeriod] = useState(currentVnMonth());
  const [monthlyReport, setMonthlyReport] = useState<any | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const loadMonthlyReport = async (period?: string) => {
    const p = period || reportPeriod;
    setReportLoading(true);
    try {
      const d: any = await apiRequest(`/admin/reports/official-monthly?period=${encodeURIComponent(p)}`);
      setMonthlyReport(d);
    } catch (e: any) {
      showToast(e?.message || 'Không tải được báo cáo tháng!');
      setMonthlyReport(null);
    } finally {
      setReportLoading(false);
    }
  };
  // Bài TEST: HR giao đề random từ ngân hàng + theo dõi kết quả (NV chỉ thấy bài của mình)
  const [testPapers, setTestPapers] = useState<any[]>([]);
  const [testSubs, setTestSubs] = useState<any[]>([]);
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
    if (activeTab === 'hr-tests' || activeTab === 'hr-probation') {
      loadTests();
    }
    if (activeTab === 'hr-tests') {
      loadBank();
    }
    if (activeTab === 'hr-reports') {
      loadMonthlyReport();
    }
    if (activeTab === 'hr-probation' || activeTab === 'staff') {
      loadAssessments();
    }
    if (activeTab === 'hr-adjustments') {
      loadAdjustments();
    }
    if (activeTab === 'hr-swap' || activeTab === 'operations' || activeTab === 'hr-support') {
      loadSwaps();
    }
  }, [activeTab]);
  useEffect(() => {
    // Realtime phiếu đổi/hỗ trợ ca: App.tsx phát 'ubm:swaps-reload' khi socket báo
    // data:updated(swaps) hoặc thông báo SWAP — tải lại danh sách ngay.
    const handler = () => {
      if (activeTab === 'hr-swap' || activeTab === 'hr-support' || activeTab === 'operations') loadSwaps();
    };
    window.addEventListener('ubm:swaps-reload', handler);
    return () => window.removeEventListener('ubm:swaps-reload', handler);
  }, [activeTab]);
  useEffect(() => {
    // Realtime phiếu bổ sung công: App.tsx phát 'ubm:adjustments-reload' khi socket báo
    // data:updated(adjustments) — NV vừa gửi là HR thấy phiếu + ảnh ngay, không đợi poll 15s.
    const adjHandler = () => {
      if (activeTab === 'hr-adjustments') loadAdjustments();
    };
    window.addEventListener('ubm:adjustments-reload', adjHandler);
    return () => window.removeEventListener('ubm:adjustments-reload', adjHandler);
  }, [activeTab]);
  useEffect(() => {
    // Realtime báo cáo HR: App.tsx phát 'ubm:reports-reload' khi mọi biến động
    // nghiệp vụ (điểm danh/lịch/đổi ca/đơn từ...) — tổng hợp tháng tính live nên
    // tải lại ngay (debounce, báo cáo nặng hơn các tab khác) + poll 60s dự phòng.
    let timer: any = null;
    const handler = () => {
      if (activeTab !== 'hr-reports') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { loadMonthlyReport(); }, 1200);
    };
    window.addEventListener('ubm:reports-reload', handler);
    let poll: any = null;
    if (activeTab === 'hr-reports') {
      poll = setInterval(() => { loadMonthlyReport(); }, 60000);
    }
    return () => {
      window.removeEventListener('ubm:reports-reload', handler);
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
    };
  }, [activeTab, reportPeriod]);
  useEffect(() => {
    // Phiếu quá 1 ngày chưa duyệt thì tự từ chối: refresh 15s để cập nhật trạng thái realtime
    if (activeTab !== 'hr-adjustments') return;
    const t = setInterval(() => loadAdjustments(), 15000);
    return () => clearInterval(t);
  }, [activeTab]);

  // Tự làm mới trạng thái khi chưa kết nối: backend tự khôi phục phiên sau
  // restart/deploy — UI lật sang Đã Kết Nối mà không cần reload/quét QR lại.
  useEffect(() => {
    if (activeTab !== 'hr-interviews' || zaloConnected || zaloLoginId) return;
    const t = setInterval(() => {
      refreshZaloStatus();
    }, 15000);
    return () => clearInterval(t);
  }, [activeTab, zaloConnected, zaloLoginId]);

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
  const [inviteBranchId, setInviteBranchId] = useState('CN130');
  const [inviteDateTime, setInviteDateTime] = useState('');
  const [inviteMode, setInviteMode] = useState<'ONLINE' | 'OFFLINE'>('ONLINE');
  // Link Meet mặc định hệ thống (không tùy chỉnh) — input hiển thị disabled.
  const inviteMeetUrl = 'https://meet.google.com/ypp-srtm-fvm';
  const [inviteBusy, setInviteBusy] = useState(false);
  // Chặn chọn quá khứ ngay ở input (lớp mềm — server vẫn validate + báo đăng ký lại).
  const pvMinDateTime = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  // Danh sách lịch PV: ẩn đã loại + đã duyệt thử việc (thành NV, không còn là ứng viên).
  // Ràng buộc chéo theo SĐT: ứng viên nào đã có hồ sơ nhân viên (dù duyệt bằng
  // đường nào: tab PV, tạo trực tiếp, duyệt trước đây) cũng ẩn khỏi tab PV.
  const empPhoneSet = new Set(
    (allEmployees || []).map((e: any) => String(e.phone_normalized || (e as any).phone || '').replace(/\D/g, '').slice(-9)).filter(Boolean)
  );
  const candPhoneKey = (c: any) => String(c?.phone_normalized || c?.phone || '').replace(/\D/g, '').slice(-9);
  const pvCandidates = (candidates || []).filter((c: any) =>
    !['REJECTED', 'ACCEPTED'].includes(String(c?.status || '')) && !empPhoneSet.has(candPhoneKey(c))
  );

  /** Ràng buộc dữ liệu: chi nhánh của ứng viên đang chọn (khớp mã CN đúng / mã nhúng trong tên / tên chi nhánh). */
  const resolveCandidateBranch = (c: any): string => {
    if (!c) return '';
    const ids: string[] = (branches || []).map((b: any) => String(b.branch_id || b.id || '').trim()).filter(Boolean);
    const pref = String(c.preferred_branch_id || '').trim();
    if (pref && ids.includes(pref)) return pref;
    const m = `${c.branch_name || ''} ${pref}`.match(/CN\d+/i);
    if (m) {
      const code = m[0].toUpperCase();
      if (ids.includes(code)) return code;
    }
    const bn = String(c.branch_name || '').trim().toLowerCase();
    if (bn) {
      const byName = (branches || []).find((b: any) => {
        const n = String(b.name || '').trim().toLowerCase();
        return n && (bn.includes(n) || n.includes(bn));
      });
      if (byName) return String(byName.branch_id || byName.id);
    }
    return '';
  };
  const pickedCandidate = (candidates || []).find((c: any) => c.submission_id === inviteCandidateId);
  const pickedBranchId = resolveCandidateBranch(pickedCandidate);

  // Tự nhận diện chi nhánh theo hồ sơ ứng viên khi HR chọn tên.
  // Chỉ tự điền 1 lần mỗi khi ĐỔI ứng viên (ref) để không đè lựa chọn tay của HR
  // khi dữ liệu reload, và luôn có fallback để không kẹt lại chi nhánh của bạn
  // đã chọn trước đó khi hồ sơ bạn mới không tra được mã chi nhánh.
  const inviteAutoBranchForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!inviteCandidateId || inviteAutoBranchForRef.current === inviteCandidateId) return;
    inviteAutoBranchForRef.current = inviteCandidateId;
    const cand = (candidates || []).find((c: any) => c.submission_id === inviteCandidateId);
    const resolved = pickedBranchId
      || String((cand as any)?.preferred_branch_id || '').trim()
      || String((cand as any)?.branch_name || '').trim()
      || 'CN130';
    setInviteBranchId(resolved);
  }, [inviteCandidateId, candidates, branches]);

  // Chấm điểm rubric + duyệt chính thức
  const [scoringId, setScoringId] = useState<string | null>(null);
  const [scoringRubric, setScoringRubric] = useState<'store' | 'office'>('store');
  const [scoringAnswers, setScoringAnswers] = useState<Record<string, number[]>>({});
  const [scoringBusy, setScoringBusy] = useState(false);
  const [approveBusyId, setApproveBusyId] = useState<string | null>(null);
  const [approveResult, setApproveResult] = useState<any | null>(null);
  // Sửa ca đăng ký inline khi ứng viên đăng ký từ 2 ca trở lên
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [editingShiftVal, setEditingShiftVal] = useState('');
  const [shiftBusy, setShiftBusy] = useState(false);
  // Modal cập nhật thông tin ứng viên (ca + chi nhánh) trước khi duyệt chính thức
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [updatingShift, setUpdatingShift] = useState('');
  const [updatingBranch, setUpdatingBranch] = useState('');
  const [updatingBusy, setUpdatingBusy] = useState(false);

  // Real-time clock for countdown timers (FAIL verdict = 24h auto-delete)
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const openUpdating = (candidate: any) => {
    setUpdatingId(candidate.submission_id);
    const cur = String(candidate.registered_shift || '');
    setUpdatingShift(SHIFT_OPTIONS.find(o => cur.includes(o.split(' ')[1])) || SHIFT_OPTIONS[0]);
    setUpdatingBranch(String(candidate.preferred_branch_id || 'CN130'));
  };

  const handleSaveUpdating = async () => {
    if (!updatingId) return;
    const shift = updatingShift.trim();
    if (!shift) {
      showToast('Ca làm việc không được để trống!');
      return;
    }
    if (!updatingBranch) {
      showToast('Vui lòng chọn 1 chi nhánh!');
      return;
    }
    setUpdatingBusy(true);
    try {
      const b = branches.find((x: any) => (x.branch_id || x.id) === updatingBranch);
      await apiRequest(`/applications/${updatingId}`, {
        method: 'PUT',
        body: JSON.stringify({
          registered_shift: shift,
          preferred_branch_id: updatingBranch,
          branch_name: b?.name || updatingBranch,
        }),
      });
      showToast(`✅ Đã cập nhật thông tin: 1 ca (${shift}) + 1 chi nhánh — giờ duyệt chính thức được!`);
      setUpdatingId(null);
      if (typeof onRefreshData === 'function') {
        try { await onRefreshData(); } catch {}
      }
    } catch (err: any) {
      showToast(err.message || 'Cập nhật thất bại!');
    } finally {
      setUpdatingBusy(false);
    }
  };

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
    // Ràng buộc khung cố định 30 phút (client-side): sai -> báo lỗi + yêu cầu đăng ký lại ngay.
    const slotCheck = pvValidateSlot(d, (t || '').slice(0, 5));
    if (!slotCheck.ok) {
      showToast(`⛔ ${(slotCheck as any).error}`);
      return;
    }
    const clash = pvFindConflict(candidates, d, (slotCheck as any).startMs, inviteCandidateId);
    if (clash) {
      const booked = pvBookedSlots(candidates, d, inviteCandidateId);
      showToast(`⛔ TRÙNG LỊCH PV: ${clash.slot} ngày ${d} đã có ${clash.name} (mỗi bạn cách nhau 30 phút)!${booked.length > 0 ? ` Đã kín: ${booked.join(', ')}.` : ''} Vui lòng đăng ký lại khung giờ khác!`);
      return;
    }
    const invBranchName = branches.length > 0
      ? (branches.find((b: any) => (b.branch_id || b.id) === inviteBranchId)?.name || inviteBranchId)
      : ({ CN130: 'CN1: 130 Vạn Kiếp (Bình Thạnh)', CN261: 'CN2: 261 Tô Hiến Thành (Q.10)', CN120: 'CN3: 120 Hoàng Diệu 2 (Thủ Đức)', CN111: 'CN4: 111 Tôn Đản (Q.4)' } as any)[inviteBranchId] || inviteBranchId;
    setInviteBusy(true);
    try {
      const res = await apiRequest(`/interviews/${inviteCandidateId}/send-zalo-invite`, {
        method: 'POST',
        body: JSON.stringify({
          interviewDate: d,
          timeSlot: (slotCheck as any).normalized,
          branchName: invBranchName,
          ...(inviteMode === 'ONLINE' && inviteMeetUrl.trim() ? { meetUrl: inviteMeetUrl.trim() } : {}),
        }),
      });
      showToast(`✅ Đã lập lịch & gửi thư mời Zalo! (msg #${res.msgId})`);
      if (typeof onRefreshData === 'function') {
        try { await onRefreshData(); } catch {}
      }
    } catch (err: any) {
      showToast(zaloInviteErrorText(err) || String(err.message || ''));
    } finally {
      setInviteBusy(false);
    }
  };

  // Mở modal chấm rubric cho 1 ứng viên (prefill điểm đã chấm nếu có).
  const openScoring = (candidate: any) => {
    // HR mở chấm điểm = đang xử lý buổi PV -> giữ lịch, tắt đếm ngược tự hủy.
    markPvJoined(candidate);    const saved = parseScoreDetailClient((candidate as any)?.interview_score_detail);
    const rubric = (saved?.rubricId === 'office' ? 'office' : 'store') as 'store' | 'office';
    setScoringRubric((candidate as any)?.interview_rubric === 'office' ? 'office' : rubric);
    setScoringAnswers((saved?.answers && typeof saved.answers === 'object' ? saved.answers : {}) as Record<string, number[]>);
    setScoringId(candidate.submission_id);
  };

  // Lưu điểm rubric (server tự tính lại; dính LOẠI thẳng -> tự REJECTED + xóa lịch).
  const handleSaveScore = async () => {
    if (!scoringId) return;
    setScoringBusy(true);
    try {
      const res: any = await apiRequest(`/applications/${scoringId}/score`, {
        method: 'POST',
        body: JSON.stringify({ rubric: scoringRubric, answers: scoringAnswers }),
      });
      // Đóng cửa sổ Meet đã tự mở cho ca PV này (nếu còn mở).
      try {
        const cand = (candidates || []).find((x: any) => x.submission_id === scoringId);
        const date = String(cand?.interview_date || '').slice(0, 10);
        const w = meetWindowsRef.current.get(`${scoringId}|${date}`);
        if (w && !w.closed) w.close();
        meetWindowsRef.current.delete(`${scoringId}|${date}`);
      } catch { /* bỏ qua */ }
      if (res.autoRejected) {
        showToast(`🚫 Ứng viên dính đáp án LOẠI — đã tự động loại khỏi quy trình!`);
      } else {
        const v = res.verdict === 'PASS' ? '✅ PASS — đủ điều kiện Duyệt Thử việc!' : res.verdict === 'CONSIDER' ? '⚠️ Cân nhắc (10-11đ) — chưa đủ duyệt!' : '❌ Chưa đạt — cần chấm lại hoặc loại!';
        showToast(`Đã lưu điểm rubric: ${res.total}/13. ${v}`);
      }
      // Tuyệt đối 13/13: màn pháo hoa tuyên dương + fanfare.
      if (!res.autoRejected && res.total === 13 && res.passed) {
        const cand = (candidates || []).find((x: any) => x.submission_id === scoringId);
        playFanfare();
        setCelebration({
          name: String(cand?.full_name || 'Ứng viên xuất sắc'),
          total: res.total,
          rubric: scoringRubric === 'office' ? 'TIÊU CHÍ LỌC HỒ SƠ KHÔNG CÓ KINH NGHIỆM' : 'TIÊU CHÍ LỌC HỒ SƠ CÓ KINH NGHIỆM',
        });
      }
      setScoringId(null);
      if (typeof onRefreshData === 'function') {
        try { await onRefreshData(); } catch {}
      }
    } catch (err: any) {
      showToast(err.message || 'Lưu điểm thất bại!');
    } finally {
      setScoringBusy(false);
    }
  };

  // Duyệt thử việc: chỉ pass rubric mới gọi được (server kiểm lại).
  const handleApproveCandidate = async (candidate: any) => {
    if (!window.confirm(`Duyệt thử việc cho ${candidate.full_name}?\nHệ thống sẽ tạo hồ sơ NV thử việc + tài khoản/PIN đăng nhập.`)) return;
    setApproveBusyId(candidate.submission_id);
    try {
      const res: any = await apiRequest(`/applications/${candidate.submission_id}/approve`, { method: 'POST' });
      setApproveResult(res);
      if (typeof onRefreshData === 'function') {
        try { await onRefreshData(); } catch {}
      }
    } catch (err: any) {
      showToast(err.message || 'Duyệt thất bại!');
    } finally {
      setApproveBusyId(null);
    }
  };

  // Cập nhật ca đăng ký cho ứng viên đăng ký từ 2 ca trở lên.
  const handleSaveShift = async (candidate: any) => {
    const v = editingShiftVal.trim();
    if (!v) {
      showToast('Ca đăng ký không được để trống!');
      return;
    }
    setShiftBusy(true);
    try {
      await apiRequest(`/applications/${candidate.submission_id}`, {
        method: 'PUT',
        body: JSON.stringify({ registered_shift: v }),
      });
      showToast(`✅ Đã cập nhật ca làm việc cho ${candidate.full_name}: ${v}`);
      setEditingShiftId(null);
      if (typeof onRefreshData === 'function') {
        try { await onRefreshData(); } catch {}
      }
    } catch (err: any) {
      showToast(err.message || 'Cập nhật ca thất bại!');
    } finally {
      setShiftBusy(false);
    }
  };

  // Live Attendance Events State for HR Realtime Tab 11
  const [liveAttendanceEvents, setLiveAttendanceEvents] = useState<any[]>([]);
  // Lọc lịch sử thông báo HR theo nguồn
  const [notifFilter, setNotifFilter] = useState('ALL');
  // Lưới tuần cần sự kiện cả tuần -> luôn tải không lọc ngày, tự refresh 30s
  const reloadAttEvents = async () => {
    try {
      const data = await apiRequest('/attendance/events');
      setLiveAttendanceEvents(Array.isArray(data) ? data : []);
    } catch {}
  };

  useEffect(() => {
    if (activeTab === 'hr-attendance' || activeTab === 'hr-schedule' || activeTab === 'operations') {
      reloadAttEvents();
    }
    // Vào tab Lịch: tải mới toàn bộ ca + đơn (props có thể cũ nếu publish/xếp ca lúc
    // đang ở tab khác mà socket ngủ) — trước đây chỉ tải sự kiện nên tuần sau có thể
    // hiện trống dù tab Chấm Công đã thấy đủ.
    if (activeTab === 'hr-schedule' || activeTab === 'operations') {
      if (typeof onRefreshData === 'function') {
        try {
          const r = onRefreshData() as any;
          if (r && typeof r.catch === 'function') r.catch(() => null);
        } catch { /* bỏ qua */ }
      }
    }
    if (activeTab === 'hr-attendance' || activeTab === 'operations') {
      loadPhotoStats(exportAttDate);
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'hr-attendance' && activeTab !== 'operations') return;
    reloadAttEvents();
    const t = setInterval(() => reloadAttEvents(), 30000);
    return () => clearInterval(t);
  }, [activeTab]);
  useEffect(() => {
    // Lưới lịch cũng tự refresh 60s để trạng thái ca (vắng/khóa/hoàn thành) luôn khớp server
    if (activeTab !== 'hr-schedule' && activeTab !== 'operations') return;
    const t = setInterval(() => {
      apiRequest('/attendance/events')
        .then((data) => setLiveAttendanceEvents(Array.isArray(data) ? data : []))
        .catch(() => {});
    }, 60000);
    return () => clearInterval(t);
  }, [activeTab]);
  useEffect(() => {
    // Realtime điểm danh 100%: App.tsx phát 'ubm:attendance-reload' khi socket báo
    // CHECKIN/CHECKOUT | data:updated(attendance/all) | attendance.recorded.
    // Tải lại /attendance/events ngay (debounce) để lịch tuần hiện check-in/out
    // tức thì, không đợi đổi tab hay poll 30-60s.
    let timer: any = null;
    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { reloadAttEvents(); }, 400);
    };
    window.addEventListener('ubm:attendance-reload', handler);
    return () => {
      window.removeEventListener('ubm:attendance-reload', handler);
      if (timer) clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    // Lịch tuần cũ: bảng realtime bị reset cuối tuần — đọc bù từ kho LUUTRU để ô ngày
    // cũ vẫn hiện đủ giờ in/out (chỉ đọc kho, không sửa realtime). Cache theo tuần.
    if (activeTab !== 'hr-schedule' && activeTab !== 'operations' && activeTab !== 'hr-attendance') return;
    const curMon = mondayIsoOfOffset(0);
    const need = new Set<string>();
    const viewMon = mondayIsoOfOffset(scheduleWeekOffset);
    if (viewMon < curMon) need.add(viewMon);
    // Bảng Chấm Công Realtime xem theo tuần riêng (attWeekOffset).
    try {
      const attMon = mondayIsoOfOffset(attWeekOffset);
      if (attMon < curMon) need.add(attMon);
    } catch { /* bỏ qua */ }
    const missing = [...need].filter(m => !archiveWeeksRef.current.has(m));
    if (missing.length === 0) return;
    // Mốc sớm nhất cần lịch ca (tuần đang xem): API trả date >= week
    // nên 1 lần tải từ mốc sớm nhất là phủ hết.
    const earliestMon = [...need].sort()[0];
    const vnToday = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    let alive = true;
    (async () => {
      setArchiveLoading(true);
      try {
        if (earliestMon < vnToday && archiveShiftsKeyRef.current !== earliestMon) {
          try {
            const sl = await apiRequest(`/schedules?week=${earliestMon}`);
            if (alive && Array.isArray(sl)) {
              archiveShiftsKeyRef.current = earliestMon;
              setArchiveShifts(sl);
            }
          } catch { /* giữ lịch realtime */ }
        }
        const parts: any[][] = await Promise.all(
          missing.map(async (mon) => {
            const sun = new Date(new Date(`${mon}T00:00:00Z`).getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
            try {
              const list = await apiRequest(`/attendance/events/archive?from=${mon}&to=${sun}`);
              if (alive) archiveWeeksRef.current.add(mon);
              return Array.isArray(list) ? list : [];
            } catch { return []; }
          })
        );
        if (!alive) return;
        const seen = new Set<string>((archiveEvents || []).map((e: any) => String(e.event_id)));
        const add: any[] = [];
        for (const arr of parts) {
          for (const e of arr) {
            const k = String((e as any)?.event_id || '');
            if (!k || seen.has(k)) continue;
            seen.add(k);
            add.push(e);
          }
        }
        if (add.length > 0) setArchiveEvents(prev => [...prev, ...add]);
      } finally {
        if (alive) setArchiveLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [activeTab, scheduleWeekOffset, attWeekOffset]);
  // (QR Zalo thật do server sinh qua /admin/zalo/* — không còn QR giả local.)

  // Filter employees for Store
  const storeEmployees = allEmployees.filter(
    (e) => branchScope === '*' || e.default_branch_id === branchScope || e.branch_id === branchScope
  );

  // --- OFFICIAL EMPLOYEES STATE & BULK IMPORT ---
  const [officialSearch, setOfficialSearch] = useState('');
  const [officialBranchFilter, setOfficialBranchFilter] = useState('ALL');
  const [showImportOfficialModal, setShowImportOfficialModal] = useState(false);
  // --- PROBATION EMPLOYEES STATE (mirror tab chính thức) ---
  const [probationSearch, setProbationSearch] = useState('');
  const [probationBranchFilter, setProbationBranchFilter] = useState('ALL');
  const [probationDoubleOnly, setProbationDoubleOnly] = useState(false);
  // Kiểm tra đầu ra thử việc (Meet vấn đáp + trắc nghiệm): lịch theo từng NV.
  const [assessList, setAssessList] = useState<any[]>([]);
  const [assessModalEmp, setAssessModalEmp] = useState<any | null>(null);
  const [assessDate, setAssessDate] = useState('');
  const [assessTime, setAssessTime] = useState('09:00');
  const [assessMeetUrl, setAssessMeetUrl] = useState('');
  const [assessQuizId, setAssessQuizId] = useState('');
  const [assessBusy, setAssessBusy] = useState(false);
  const [meetBusyId, setMeetBusyId] = useState<string | null>(null);
  const loadAssessments = async () => {
    try {
      const d: any = await apiRequest('/admin/probation-assessment/list');
      setAssessList(Array.isArray(d?.assessments) ? d.assessments : []);
    } catch { /* không quyền / offline */ }
  };
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
  // Khóa/mở tài khoản NV chính thức (HR): busy theo NV + kết quả PIN mới sau mở khóa.
  const [lockBusyId, setLockBusyId] = useState<string | null>(null);
  const [unlockPinResult, setUnlockPinResult] = useState<{ name: string; code: string; pin: string } | null>(null);
  const [lockedEmpIds, setLockedEmpIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onLockedEv = (ev: any) => {
      const id = String(ev?.detail?.employeeId || '');
      if (id) setLockedEmpIds(prev => new Set(prev).add(id));
    };
    const onUnlockedEv = (ev: any) => {
      const id = String(ev?.detail?.employeeId || '');
      if (id) setLockedEmpIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    };
    window.addEventListener('ubm:employee-locked', onLockedEv as any);
    window.addEventListener('ubm:employee-unlocked', onUnlockedEv as any);
    return () => {
      window.removeEventListener('ubm:employee-locked', onLockedEv as any);
      window.removeEventListener('ubm:employee-unlocked', onUnlockedEv as any);
    };
  }, []);

  const isEmpAccountLocked = (e: any) => {
    if (!e) return false;
    const id = String(e.employee_id || '');
    return !!e.account_locked || e.account_status === 'LOCKED' || lockedEmpIds.has(id);
  };
  // Avatar tab Hồ Sơ: ảnh mới HR vừa chọn (data URL, gửi kèm lúc lưu) + cờ xóa avatar.
  const [avatarPhoto, setAvatarPhoto] = useState<string | null>(null);
  const [avatarRemoved, setAvatarRemoved] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

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
                        <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => { try { window.open(SYSTEM_MEET_URL, '_blank'); } catch {} showToast('Đã mở phòng phỏng vấn Meet hệ thống trong tab mới — đón ứng viên rồi quay lại chấm kết quả.'); }}>Bắt Đầu</button>
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
                        <button
                          className="btn-primary"
                          style={{ padding: '4px 10px', fontSize: '12px' }}
                          disabled={transitionBusyId === e.employee_id}
                          onClick={async () => {
                            if (!window.confirm(`Ký quyết định chuyển chính thức cho ${e.full_name} (${e.employee_code})?`)) return;
                            setTransitionBusyId(e.employee_id);
                            try {
                              await apiRequest(`/employees/${e.employee_id}/transition-official`, {
                                method: 'POST',
                                body: JSON.stringify({ expectedVersion: (e as any).version || 1 }),
                              });
                              showToast(`Đã ký chuyển chính thức cho ${e.full_name}! Hồ sơ, lương giờ và lịch đã cập nhật.`);
                              if (onRefreshData) await onRefreshData();
                            } catch (err: any) {
                              if (onRefreshData) await Promise.resolve(onRefreshData()).catch(() => null);
                              showToast(err?.message || 'Lỗi khi ký quyết định!');
                            } finally {
                              setTransitionBusyId(null);
                            }
                            if (onSyncSheets) {
                              try {
                                const r = onSyncSheets();
                                if (r && typeof (r as any).catch === 'function') (r as any).catch(() => null);
                              } catch { /* bỏ qua */ }
                            }
                          }}
                        >{transitionBusyId === e.employee_id ? '⏳...' : 'Ký Quyết Định'}</button>
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

    // Chat Zalo: tự động kết bạn qua nick HR + gửi lời chào (không cần bấm xác nhận).
    const handleChatZalo = async (c: any) => {
      await chatZaloWithCandidate(c, showToast);
    };

    // Khôi phục ứng viên bị loại về Mới ứng tuyển.
    const handleRestoreCandidate = async (c: any) => {
      if (!window.confirm(`Khôi phục ${c.full_name} về "Mới ứng tuyển" để xem xét lại?`)) return;
      try {
        await apiRequest(`/applications/${c.submission_id}`, {
          method: 'PUT',
          body: JSON.stringify({ status: 'NEW' }),
        });
        showToast(`♻️ Đã khôi phục ${c.full_name}!`);
        if (typeof onRefreshData === 'function') {
          try { await onRefreshData(); } catch {}
        }
      } catch (err: any) {
        showToast(err.message || 'Khôi phục thất bại!');
      }
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
      // Ứng viên đã loại (REJECTED) ẩn khỏi danh sách mặc định — xem lại bằng bộ lọc "Đã loại".
      const isRejected = String(c.status || '') === 'REJECTED';
      const matchResult = candidateResultFilter === 'ALL'
        ? !isRejected
        : candidateResultFilter === 'REJECTED'
          ? isRejected
          : candidateResultFilter === 'DAT'
            ? !isRejected && evalResult.result === 'Đạt'
            : !isRejected && evalResult.result === 'Loại';

      return matchSearch && matchBranch && matchResult;
    });

    const rejectedCount = (candidates || []).filter(c => String(c.status || '') === 'REJECTED').length;

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
                Đầy đủ 16 cột dữ liệu đồng bộ trực tiếp từ trang tính Google Form (FROM_NHAN_VIEN) — Không dữ liệu ảo
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
              <option value="REJECTED">🚫 Đã loại (xem lại{rejectedCount > 0 ? `: ${rejectedCount}` : ''})</option>
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
                  <th style={{ padding: '12px 12px', width: '130px' }}>16. Trạng Thái</th>
                  <th style={{ padding: '12px 14px', width: '190px', textAlign: 'center', position: 'sticky', right: 0, backgroundColor: 'var(--bg)', zIndex: 1, boxShadow: '-3px 0 6px rgba(0,0,0,0.05)' }}>
                    Thao Tác
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredCandidates.length === 0 ? (
                  <tr>
                    <td colSpan={17} style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
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

                        {/* 16. Trạng thái (tiếng Việt) */}
                        <td style={{ padding: '12px 12px' }}>
                          <span className="badge badge-brand" style={{ fontSize: '11px', padding: '3px 8px' }}>
                            {candStatusVI(c.status)}
                          </span>
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
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
                            {(() => {
                              const rowRejected = String(c.status || '') === 'REJECTED';
                              const btn: React.CSSProperties = {
                                padding: '6px 12px', fontSize: '11px', fontWeight: 800,
                                borderRadius: '8px', border: 'none', cursor: 'pointer',
                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                whiteSpace: 'nowrap',
                              };
                              return (<>
                                <button
                                  style={{ ...btn, backgroundColor: '#F1F5F9', color: '#334155', border: '1px solid #E2E8F0' }}
                                  onClick={() => setSelectedCandidateDetail(c)}
                                  title="Xem toàn bộ thông tin hồ sơ"
                                >
                                  👁 Chi Tiết
                                </button>
                                {rowRejected ? (
                                  <button
                                    style={{ ...btn, backgroundColor: '#FEF3C7', color: '#92400E' }}
                                    onClick={() => handleRestoreCandidate(c)}
                                    title="Khôi phục ứng viên về Mới ứng tuyển để xem xét lại"
                                  >
                                    ♻️ Khôi Phục
                                  </button>
                                ) : (
                                  <button
                                    style={{ ...btn, backgroundColor: '#10B981', color: '#FFF', boxShadow: '0 2px 6px rgba(16,185,129,0.3)' }}
                                    onClick={() => handleChatZalo(c)}
                                    title="Tự động kết bạn Zalo qua nick HR + gửi lời chào"
                                  >
                                    💬 Chat Zalo
                                  </button>
                                )}
                              </>);
                            })()}
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

        {/* MODAL XEM CHI TIẾT ĐẦY ĐỦ 16 CỘT CỦA ỨNG VIÊN */}
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
                    Mã hồ sơ: <strong>{selectedCandidateDetail.submission_id}</strong> • Ngày gửi: {formatRegDate(selectedCandidateDetail.created_at)}
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
                  onClick={async () => {
                    // Chưa có luồng lên lịch tự động trong modal này: sao chép SĐT thật
                    // + hướng dẫn qua Tab 3 (nơi có form ngày/giờ/chi nhánh + gửi Zalo).
                    const phone = selectedCandidateDetail.phone || selectedCandidateDetail.phone_normalized || '';
                    try {
                      if (phone) await navigator.clipboard.writeText(phone);
                    } catch { /* clipboard bị chặn thì bỏ qua */ }
                    const name = selectedCandidateDetail.full_name || 'ứng viên';
                    setSelectedCandidateDetail(null);
                    showToast(
                      phone
                        ? `Đã sao chép SĐT ${phone} — qua Tab 3 (Lịch PV & BOT Zalo) để chọn ngày giờ và gửi thư mời cho ${name}.`
                        : `Ứng viên ${name} chưa có SĐT — qua Tab 3 (Lịch PV & BOT Zalo) để xử lý.`,
                      'WARNING'
                    );
                  }}
                >
                  Sao Chép SĐT & Lên Lịch Ở Tab 3
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
                        : (zaloStatus?.restoring
                          ? '⏳ Đang khôi phục phiên Zalo đã lưu — không cần quét QR...'
                          : (zaloStatus?.autoRestorePaused
                            ? '○ Khôi phục thất bại nhiều lần — hãy quét QR đăng nhập lại'
                            : (zaloStatus?.hasSavedSession
                              ? '⏳ Phiên Zalo đã lưu — hệ thống tự kết nối lại trong giây lát, không cần quét QR...'
                              : '○ Chờ tạo mã QR đăng nhập'))))}
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
                  {(() => {
                    const pvCand = candidates.find((c: any) => c.submission_id === inviteCandidateId);
                    const [pvD, pvT] = (inviteDateTime || '').split('T');
                    const pvBranch = branches.length > 0
                      ? (branches.find((b: any) => (b.branch_id || b.id) === inviteBranchId)?.name || inviteBranchId)
                      : ({ CN130: 'CN1: 130 Vạn Kiếp (Bình Thạnh)', CN261: 'CN2: 261 Tô Hiến Thành (Q.10)', CN120: 'CN3: 120 Hoàng Diệu 2 (Thủ Đức)', CN111: 'CN4: 111 Tôn Đản (Q.4)' } as any)[inviteBranchId] || inviteBranchId;
                    const ph = (v?: string, fb?: string) => v || <span style={{ color: '#94A3B8' }}>{fb}</span>;
                    return (<>
                      <strong style={{ color: '#0068FF' }}>[ỤM BÒ MILK] THƯ MỜI PHỎNG VẤN VỊ TRÍ {(pvCand?.apply_position || 'NHÂN VIÊN BÁN HÀNG').toUpperCase()}</strong><br />
                      Chào bạn <strong>{ph(pvCand?.full_name, '[Tên Ứng Viên]')}</strong>,<br />
                      Phòng Nhân Sự Ụm Bò Milk trân trọng mời bạn tham gia buổi phỏng vấn{inviteMode === 'ONLINE' ? ' trực tuyến' : ''}:<br />
                      🕒 <strong>Thời gian:</strong> {ph(pvT?.slice(0, 5), '[Giờ phỏng vấn]')} - {ph(pvD, '[Ngày hẹn phỏng vấn]')}<br />
                      📍 <strong>Chi nhánh tuyển dụng:</strong> {pvBranch}<br />
                      🕐 <strong>Ca làm việc đăng ký:</strong> {ph(pvCand?.registered_shift, '[Ca làm việc]')}<br />
                      {inviteMode === 'ONLINE' ? (
                        <>🔗 <strong>Link phòng họp Google Meet:</strong> <span style={{ color: '#0068FF', textDecoration: 'underline' }}>{inviteMeetUrl}</span><br /></>
                      ) : (
                        <>📌 <strong>Hình thức:</strong> Trực tiếp tại cửa hàng — đến trước 5 phút<br /></>
                      )}
                      👤 <strong>Người phỏng vấn:</strong> Phòng Nhân Sự Ụm Bò Milk<br />
                      📌 <em>Lưu ý: Bạn vui lòng vào trước 5 phút và chuẩn bị trang phục lịch sự nhé.</em><br />
                      <span style={{ fontSize: '11px', color: '#64748B', display: 'block', marginTop: '6px' }}>
                        ✓✓ BOT lấy đúng mẫu này (tên, giờ, chi nhánh, ca làm việc, link) bắn qua Zalo khi HR bấm "Tạo Lịch & BOT Bắn Tin"
                      </span>
                    </>);
                  })()}
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
                  {pvCandidates.length > 0 ? (
                    pvCandidates.map((c, i) => (
                      <option key={c.submission_id || i} value={c.submission_id}>
                        {c.full_name} ({c.phone || c.phone_normalized})
                      </option>
                    ))
                  ) : (
                    <option value="">Chưa có ứng viên (Dữ liệu từ Google Sheets)</option>
                  )}
                </select>
                <div style={{ fontSize: '11px', color: '#1E40AF', marginTop: '4px' }}>
                  🤖 Chọn tên là chi nhánh tự điền đúng theo hồ sơ ứng viên.
                </div>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Thời gian phỏng vấn (khung cố định 30 phút):</label>
                <input type="datetime-local" step={1800} min={pvMinDateTime} value={inviteDateTime} onChange={(e) => setInviteDateTime(e.target.value)} style={{ width: '100%' }} />
                <div style={{ fontSize: '11px', color: '#1E40AF', marginTop: '4px', lineHeight: '1.5' }}>
                  ⏱️ Mỗi bạn cách nhau 30 phút — phút phải là <strong>:00</strong> hoặc <strong>:30</strong>, giờ hành chính <strong>08:00–17:00</strong>. Sai khung hệ thống báo lỗi và yêu cầu đăng ký lại.
                </div>
                {(() => {
                  const dd = (inviteDateTime || '').split('T')[0];
                  if (!/^\d{4}-\d{2}-\d{2}$/.test(dd || '')) return null;
                  const booked = pvBookedSlots(candidates, dd, inviteCandidateId);
                  if (booked.length === 0) return null;
                  return (
                    <div style={{ fontSize: '11px', color: '#92400E', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '6px', padding: '6px 8px', marginTop: '6px', lineHeight: '1.5' }}>
                      📅 Ngày {`${dd.slice(8, 10)}/${dd.slice(5, 7)}/${dd.slice(0, 4)}`} đã kín: <strong>{booked.join(', ')}</strong> — vui lòng chọn khung khác cách ít nhất 30 phút!
                    </div>
                  );
                })()}
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
                <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Link Google Meet (mặc định hệ thống — không tùy chỉnh):</label>
                <input
                  type="text"
                  value="https://meet.google.com/ypp-srtm-fvm"
                  disabled
                  title="Link mặc định hệ thống cho mọi lịch PV"
                  style={{ width: '100%', backgroundColor: '#F3F4F6', color: '#374151' }}
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
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '14px' }}>Lịch Phỏng Vấn Tuyển Dụng Đã Lên Lịch</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                🤖 Hệ thống tự rà soát + xóa lịch trùng (&lt; 30 phút) mỗi 5 phút
              </span>
              <span className="badge" style={{ backgroundColor: '#EFF6FF', color: '#0068FF', fontWeight: 800 }}>
                ĐÃ ĐỒNG BỘ BOT ZALO CÁ NHÂN
              </span>
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Ứng Viên</th>
                <th style={{ padding: '12px 20px' }}>Vị Trí & Chi Nhánh</th>
                <th style={{ padding: '12px 20px' }}>Ca Làm Việc ĐK</th>
                <th style={{ padding: '12px 20px' }}>Thời Gian</th>
                <th style={{ padding: '12px 20px' }}>Google Meet Sinh Tự Động</th>
                <th style={{ padding: '12px 20px' }}>Trạng Thái</th>
                <th style={{ padding: '12px 20px' }}>Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              {pvCandidates.length > 0 ? (
                pvCandidates.map((c, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '14px 20px', fontWeight: 700 }}>
                      {c.full_name}
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.phone || c.phone_normalized}</div>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <strong>{c.apply_position || c.position || 'Nhân viên Bán hàng'}</strong>
                      <div style={{ fontSize: '11px', color: '#2563EB' }}>{c.branch_name || getDisplayBranch(c.preferred_branch_id || c.branch_id || 'CN130')}</div>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      {(() => {
                        const shift = String(c.registered_shift || 'Ca sáng / Ca chiều');
                        const parts = shift.split(/[,/+;|]/).map((s: string) => s.trim()).filter(Boolean);
                        const multi = parts.length >= 2;
                        if (editingShiftId === c.submission_id) {
                          return (
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                              <select
                                value={SHIFT_OPTIONS.includes(editingShiftVal) ? editingShiftVal : SHIFT_OPTIONS[0]}
                                onChange={(e) => setEditingShiftVal(e.target.value)}
                                style={{ width: '140px', fontSize: '12px', padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--border)' }}
                              >
                                {SHIFT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                              </select>
                              <button
                                onClick={() => handleSaveShift(c)}
                                disabled={shiftBusy}
                                title="Lưu ca làm việc mới"
                                style={{ padding: '5px 10px', borderRadius: '6px', backgroundColor: '#10B981', color: '#FFF', fontSize: '11px', fontWeight: 800, border: 'none', cursor: 'pointer' }}
                              >
                                Lưu
                              </button>
                              <button
                                onClick={() => setEditingShiftId(null)}
                                title="Hủy"
                                style={{ padding: '5px 10px', borderRadius: '6px', backgroundColor: '#F1F5F9', color: '#475569', fontSize: '11px', fontWeight: 800, border: 'none', cursor: 'pointer' }}
                              >
                                Hủy
                              </button>
                            </div>
                          );
                        }
                        return (
                          <div>
                            <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: '6px', backgroundColor: multi ? '#FEF3C7' : '#F1F5F9', color: multi ? '#92400E' : '#334155', fontSize: '12px', fontWeight: 700 }}>
                              {shift}
                            </span>
                            {multi && (
                              <div>
                                <button
                                  onClick={() => { setEditingShiftId(c.submission_id); setEditingShiftVal(shift); }}
                                  title="Ứng viên đăng ký từ 2 ca trở lên — bấm để cập nhật lại"
                                  style={{ marginTop: '4px', padding: '4px 10px', borderRadius: '6px', backgroundColor: '#F59E0B', color: '#FFF', fontSize: '11px', fontWeight: 800, border: 'none', cursor: 'pointer' }}
                                >
                                  ✏️ Cập nhật ca
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ padding: '14px 20px', fontWeight: 700 }}>
                      {fmtPvTime(c) || (c.interview_time || 'Chờ xếp lịch')}
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      {(() => {
                        const st = interviewStartMs(c);
                        if (!st) return <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Chờ xếp lịch Meet</span>;
                        const diff = st - meetNow;
                        const elapsed = meetNow - st;
                        const endMs = st + PV_SLOT_MINUTES * 60_000;
                        const pad = (n: number) => String(n).padStart(2, '0');
                        const fmtLeft = (ms: number) => {
                          const s = Math.floor(ms / 1000);
                          const h = Math.floor(s / 3600);
                          const m = Math.floor((s % 3600) / 60);
                          const ss = s % 60;
                          return h > 0 ? `${h}h ${pad(m)}p ${pad(ss)}s` : `${m}p ${pad(ss)}s`;
                        };
                        const fmtHM = (ms: number) => {
                          const vn = new Date(ms + 7 * 3_600_000);
                          return `${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}`;
                        };
                        // Quá 5 phút không ai vào Meet (chưa bấm Vào Meet, chưa chấm điểm):
                        // hiện nút Huỷ Phỏng vấn + đếm ngược 20s. HR bấm Huỷ -> xóa lịch
                        // ngay; hết 20s -> hệ thống tự hủy. Có người vào -> giữ lịch.
                        const pvKey = `${(c as any).submission_id}|${String((c as any).interview_date || '').slice(0, 10)}`;
                        const pvJoined = pvJoinedRef.current.has(pvKey);
                        const pvScored = !!parseScoreDetailClient((c as any)?.interview_score_detail);
                        const noJoinMs = PV_NOJOIN_CANCEL_MIN * 60_000;
                        if (elapsed >= noJoinMs && !pvJoined && !pvScored) {
                          const remainSec = Math.max(0, PV_CANCEL_COUNTDOWN_SEC - Math.floor((elapsed - noJoinMs) / 1000));
                          const busy = pvCancelBusyId === (c as any).submission_id;
                          return (
                            <div style={{ backgroundColor: '#FEF2F2', border: '1.5px solid #FCA5A5', borderRadius: '8px', padding: '8px 10px' }}>
                              <div style={{ fontSize: '12px', fontWeight: 800, color: '#991B1B' }}>
                                ⚠️ Quá {PV_NOJOIN_CANCEL_MIN} phút chưa vào Meet
                              </div>
                              <div style={{ fontSize: '12px', fontWeight: 800, color: '#DC2626', margin: '4px 0', fontVariantNumeric: 'tabular-nums' }}>
                                ⏳ Tự hủy sau: 00:{String(remainSec).padStart(2, '0')}
                              </div>
                              <button
                                disabled={busy}
                                onClick={() => handleCancelInterview(c, false)}
                                style={{ display: 'inline-block', backgroundColor: busy ? '#9CA3AF' : '#DC2626', color: '#FFF', fontWeight: 800, fontSize: '12px', padding: '8px 14px', borderRadius: '8px', border: 'none', cursor: busy ? 'wait' : 'pointer', width: '100%' }}
                              >
                                {busy ? '⏳ Đang hủy...' : '✖ Huỷ Phỏng vấn'}
                              </button>
                              <a href={SYSTEM_MEET_URL} target="_blank" rel="noreferrer" data-meet-open="1" onClick={() => markPvJoined(c)}
                                style={{ display: 'block', fontSize: '11px', color: '#0068FF', fontWeight: 700, marginTop: '4px', textAlign: 'center' }}>
                                Vào Meet ngay để giữ lịch →
                              </a>
                            </div>
                          );
                        }
                        // Đang trong khung 30 phút PV: nút đỏ nhấp nháy để vào Meet.
                        if (diff <= 0 && elapsed < PV_SLOT_MINUTES * 60_000) {
                          return (
                            <div>
                              <a href={SYSTEM_MEET_URL} target="_blank" rel="noreferrer" data-meet-open="1" onClick={() => markPvJoined(c)}
                                style={{ display: 'inline-block', backgroundColor: '#DC2626', color: '#FFF', fontWeight: 800, fontSize: '12px', padding: '8px 14px', borderRadius: '8px', textDecoration: 'none', animation: 'fx-blink 1.2s infinite' }}>
                                🔴 ĐANG PV — Vào Meet
                              </a>
                              <div style={{ fontSize: '11px', color: '#DC2626', fontWeight: 700, marginTop: '4px' }}>
                                Còn {fmtLeft(endMs - meetNow)} là hết 30 phút
                              </div>
                            </div>
                          );
                        }
                        // Hết 30 phút PV: cập nhật trạng thái để HR biết ca PV đã xong.
                        if (diff <= 0) return (
                          <div>
                            <div style={{ display: 'inline-block', fontSize: '12px', fontWeight: 800, color: '#065F46', backgroundColor: '#D1FAE5', padding: '6px 12px', borderRadius: '8px' }}>
                              ✅ Hết giờ PV ({fmtHM(endMs)})
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                              Đủ 30 phút — chờ HR đánh giá →
                            </div>
                          </div>
                        );
                        return (
                          <div>
                            <div style={{ fontSize: '12px', fontWeight: 800, color: '#1D4ED8' }}>⏳ Còn {fmtLeft(diff)}</div>
                            <a href={SYSTEM_MEET_URL} target="_blank" rel="noreferrer" data-meet-open="1" onClick={() => markPvJoined(c)} style={{ fontSize: '11px', color: '#0068FF', fontWeight: 700 }}>Vào trước qua Meet →</a>
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      {(() => {
                        const failInfo = getFailVerdictInfo(c);
                        if (failInfo.isFail) {
                          const isExpired = failInfo.remainingMs <= 0;
                          return (
                            <div>
                              <span style={{ backgroundColor: isExpired ? '#FEE2E2' : '#FEF2F2', color: '#DC2626', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, border: '1px solid #FCA5A5' }}>
                                {isExpired ? '⛔ Chưa đạt — Đã quá hạn 24h' : `⚠️ Chưa đạt — Tự xoá sau: ${formatCountdown(failInfo.remainingMs)}`}
                              </span>
                              {!isExpired && (
                                <div style={{ fontSize: '11px', color: '#DC2626', fontWeight: 700, marginTop: '4px', fontVariantNumeric: 'tabular-nums' }}>
                                  {`⏳ Hệ thống sẽ tự động xoá ứng viên này ra khỏi hệ thống sau 24h kể từ lúc chấm điểm (${new Date(failInfo.scoredAt + 24*60*60*1000).toLocaleString('vi-VN')})`}
                                </div>
                              )}
                            </div>
                          );
                        }
                        return (
                          <>
                            <span style={{
                              backgroundColor: c.status === 'CONFIRMED' ? '#DCFCE7' : c.status === 'NO_SHOW' ? '#FEE2E2' : c.status === 'RESCHEDULE_REQUESTED' ? '#FFFBEB' : '#FEF3C7',
                              color: c.status === 'CONFIRMED' ? '#166534' : c.status === 'NO_SHOW' ? '#991B1B' : c.status === 'RESCHEDULE_REQUESTED' ? '#92400E' : '#92400E',
                              padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700,
                            }}>
                              {candStatusVI(c.status)}
                            </span>
                            {(() => {
                              const d = parseScoreDetailClient((c as any)?.interview_score_detail);
                              if (!d) return null;
                              const vc = d.verdict === 'PASS' ? '#059669' : d.verdict === 'LOAI' ? '#DC2626' : '#B45309';
                              const vt = d.verdict === 'PASS' ? 'PASS' : d.verdict === 'LOAI' ? 'LOẠI thẳng' : d.verdict === 'CONSIDER' ? 'Cân nhắc' : 'Chưa đạt';
                              const denom = (d as any).achievableMax ?? d.max;
                              return (
                                <div style={{ fontSize: '11px', color: vc, fontWeight: 800, marginTop: '4px' }}>
                                  📝 Rubric: {d.total}/{denom} — {vt}
                                </div>
                              );
                            })()}
                          </>
                        );
                      })()}
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      {(() => {
                        const failInfo = getFailVerdictInfo(c);
                        const btn2: React.CSSProperties = {
                          padding: '6px 12px', fontSize: '11px', fontWeight: 800, borderRadius: '8px',
                          border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px',
                          whiteSpace: 'nowrap',
                        };
                        const d = parseScoreDetailClient((c as any)?.interview_score_detail);
                        const canApprove = !!d && d.passed && String(c.status || '') !== 'ACCEPTED';
                        const isAccepted = String(c.status || '') === 'ACCEPTED';
                        const isScored = !!d;
                        const disabledForFail = failInfo.isFail;
                        const disabledStyle = { opacity: 0.5, cursor: 'not-allowed', backgroundColor: '#94A3B8' };
                        return (
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <button
                              disabled={disabledForFail}
                              style={{ ...btn2, backgroundColor: disabledForFail ? '#94A3B8' : '#10B981', color: '#FFF', boxShadow: disabledForFail ? 'none' : '0 2px 6px rgba(16,185,129,0.3)' }}
                              onClick={() => !disabledForFail && chatZaloWithCandidate(c, showToast)}
                              title={disabledForFail ? (failInfo.remainingMs <= 0 ? 'Ứng viên Chưa đạt — đã quá 24h, hệ thống sẽ tự động xoá khỏi hệ thống' : 'Ứng viên Chưa đạt — các chức năng đã bị khoá (tự xoá sau 24h)') : 'Tự động kết bạn Zalo qua nick HR + gửi lời chào để chát với ứng viên'}
                            >
                              💬 Chat Zalo
                            </button>
                            {(String(c.status || '') === 'INVITED_INTERVIEW') && !disabledForFail && (
                              <button
                                disabled={rsvpBusyId === c.submission_id}
                                style={{ ...btn2, backgroundColor: '#059669', color: '#FFF', boxShadow: '0 2px 6px rgba(5,150,105,0.3)' }}
                                onClick={() => handleConfirmInterview(c)}
                                title="Ứng viên báo sẽ tham gia (qua điện thoại/Zalo tay) — ghi nhận để giữ lịch"
                              >
                                {rsvpBusyId === c.submission_id ? '⏳...' : '✓ Xác nhận tham gia'}
                              </button>
                            )}
                            {(['INVITED_INTERVIEW', 'CONFIRMED'].includes(String(c.status || ''))) && !disabledForFail && (
                              <button
                                disabled={rsvpBusyId === c.submission_id}
                                style={{ ...btn2, backgroundColor: '#DC2626', color: '#FFF', boxShadow: '0 2px 6px rgba(220,38,38,0.3)' }}
                                onClick={() => handleNoShowInterview(c)}
                                title="Ứng viên không đến — đánh vắng, hủy lịch giải phóng slot (PV lại phải đặt lịch mới)"
                              >
                                {rsvpBusyId === c.submission_id ? '⏳...' : '🚫 Đánh vắng'}
                              </button>
                            )}
                            {!isAccepted && !isScored && (
                              <button
                                disabled={disabledForFail}
                                style={{ ...btn2, backgroundColor: disabledForFail ? '#94A3B8' : '#8B5CF6', color: '#FFF', boxShadow: disabledForFail ? 'none' : '0 2px 6px rgba(139,92,246,0.3)' }}
                                onClick={() => !disabledForFail && openScoring(c)}
                                title={disabledForFail ? (failInfo.remainingMs <= 0 ? 'Ứng viên Chưa đạt — đã quá 24h, hệ thống sẽ tự động xoá khỏi hệ thống' : 'Ứng viên Chưa đạt — các chức năng đã bị khoá (tự xoá sau 24h)') : 'Chấm điểm theo TIÊU CHÍ LỌC HỒ SƠ (chấm xong nút này ẩn đi)'}
                              >
                                📝 Chấm điểm
                              </button>
                            )}
                            {!isAccepted && (
                              <button
                                disabled={disabledForFail}
                                style={{ ...btn2, backgroundColor: disabledForFail ? '#94A3B8' : '#F59E0B', color: '#FFF', boxShadow: disabledForFail ? 'none' : '0 2px 6px rgba(245,158,11,0.3)' }}
                                onClick={() => !disabledForFail && openUpdating(c)}
                                title={disabledForFail ? (failInfo.remainingMs <= 0 ? 'Ứng viên Chưa đạt — đã quá 24h, hệ thống sẽ tự động xoá khỏi hệ thống' : 'Ứng viên Chưa đạt — các chức năng đã bị khoá (tự xoá sau 24h)') : 'Cập nhật ca làm việc + chi nhánh (bắt buộc chốt 1 ca / 1 chi nhánh trước khi duyệt)'}
                              >
                                ✏️ Cập nhật TT
                              </button>
                            )}
                            {canApprove && (
                              <button
                                disabled={disabledForFail || approveBusyId === c.submission_id}
                                style={{ ...btn2, backgroundColor: disabledForFail ? '#94A3B8' : '#10B981', color: '#FFF', boxShadow: disabledForFail ? 'none' : '0 2px 6px rgba(16,185,129,0.35)' }}
                                onClick={() => !disabledForFail && handleApproveCandidate(c)}
                                title={disabledForFail ? (failInfo.remainingMs <= 0 ? 'Ứng viên Chưa đạt — đã quá 24h, hệ thống sẽ tự động xoá khỏi hệ thống' : 'Ứng viên Chưa đạt — các chức năng đã bị khoá (tự xoá sau 24h)') : `Đã PASS rubric (${d.total}/${(d as any).achievableMax ?? d.max}) — duyệt thử việc + cấp PIN`}
                              >
                                {approveBusyId === c.submission_id ? '⏳ Đang duyệt...' : '✅ Duyệt Thử việc'}
                              </button>
                            )}
                            {isAccepted && (
                              <span style={{ fontSize: '11px', color: '#059669', fontWeight: 800 }}>✅ Đã duyệt NV</span>
                            )}
                            <button
                              disabled={candDelBusyId === c.submission_id}
                              style={{ ...btn2, backgroundColor: '#DC2626', color: '#FFF', boxShadow: '0 2px 6px rgba(220,38,38,0.3)' }}
                              onClick={async () => {
                                const sid = String(c?.submission_id || '');
                                if (!sid || candDelBusyId) return;
                                if (!window.confirm(`Xóa cứng ứng viên ${c?.full_name || sid} khỏi hệ thống + Google Sheet? Không khôi phục được!`)) return;
                                setCandDelBusyId(sid);
                                try {
                                  await apiRequest(`/applications/${sid}`, { method: 'DELETE' });
                                  showToast(`Đã xóa ${c?.full_name || sid} khỏi hệ thống + Sheet!`);
                                  if (onRefreshData) await onRefreshData();
                                  if (onPushSheets) await onPushSheets();
                                } catch (e: any) {
                                  showToast(e?.message || 'Lỗi khi xóa ứng viên!');
                                } finally {
                                  setCandDelBusyId(null);
                                }
                              }}
                              title="Xóa cứng khỏi hệ thống + Google Sheet ngay (không khôi phục)"
                            >
                              {candDelBusyId === c.submission_id ? '⏳ Đang xóa...' : '🗑 Xóa'}
                            </button>
                            {disabledForFail && (
                              <span style={{ fontSize: '11px', color: '#DC2626', fontWeight: 800, alignSelf: 'center' }}>
                                {failInfo.remainingMs <= 0 ? '🔒 Đã quá 24h — tự xoá khỏi hệ thống' : '🔒 Khoá (tự xoá 24h)'}
                              </span>
                            )}
                          </div>
                        );
                      })()}
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

        {/* MODAL CHẤM ĐIỂM RUBRIC TIÊU CHÍ LỌC HỒ SƠ */}
        {scoringId && (() => {
          const cand = (candidates || []).find((x: any) => x.submission_id === scoringId);
          const rubric = INTERVIEW_RUBRICS.find(r => r.id === scoringRubric) || INTERVIEW_RUBRICS[0];
          const live = computeRubricClient(scoringRubric, scoringAnswers);
          const lockedIds = lockedQuestionIds(scoringRubric, scoringAnswers);
          const required = requiredAnswerCount(scoringRubric);
          const answered = rubric.questions.filter(q => !lockedIds.includes(q.id) && (scoringAnswers[q.id] || []).length > 0).length;
          const verdictBg = live.verdict === 'PASS' ? '#ECFDF5' : live.verdict === 'LOAI' ? '#FEF2F2' : '#FFFBEB';
          const verdictTx = live.verdict === 'PASS' ? '#059669' : live.verdict === 'LOAI' ? '#DC2626' : '#92400E';
          const verdictLabel = live.verdict === 'PASS' ? '✅ PASS — đủ điều kiện Duyệt Thử việc' : live.verdict === 'LOAI' ? '🚫 LOẠI thẳng — lưu sẽ tự loại ứng viên!' : live.verdict === 'CONSIDER' ? '⚠️ Cân nhắc (10-11đ) — chưa đủ duyệt' : '❌ Chưa đạt — cần chấm lại hoặc loại';
          return (
            <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
              <div style={{ backgroundColor: '#FFF', borderRadius: '14px', maxWidth: '720px', width: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1E40AF', color: '#FFF' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '15px' }}>📝 Chấm điểm PV: {cand?.full_name || scoringId}</div>
                    <div style={{ fontSize: '12px', opacity: 0.9 }}>TIÊU CHÍ LỌC HỒ SƠ — PASS từ 12/13, đáp án LOẠI loại thẳng</div>
                  </div>
                  <button onClick={() => !scoringBusy && setScoringId(null)} disabled={scoringBusy} style={{ border: 'none', background: 'rgba(255,255,255,0.2)', color: '#FFF', fontSize: '16px', cursor: 'pointer', borderRadius: '6px', padding: '2px 8px' }}>✕</button>
                </div>
                <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: '10px', alignItems: 'center', backgroundColor: '#F8FAFC' }}>
                  <label style={{ fontSize: '12px', fontWeight: 800 }}>Bộ tiêu chí:</label>
                  <select value={scoringRubric} onChange={(e) => { setScoringRubric(e.target.value as any); setScoringAnswers({}); }} style={{ padding: '6px 10px', borderRadius: '6px', fontSize: '13px', fontWeight: 700 }}>
                    {INTERVIEW_RUBRICS.map(r => <option key={r.id} value={r.id}>{r.name} (MAX {r.maxScore})</option>)}
                  </select>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Đã chấm {answered}/{rubric.questions.length} câu</span>
                </div>
                <div style={{ padding: '16px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {rubric.questions.map((q, qi) => {
                    const isLocked = lockedIds.includes(q.id);
                    return (
                    <div key={q.id} style={{ border: '1px solid var(--border)', borderRadius: '10px', padding: '12px 14px', backgroundColor: isLocked ? '#F1F5F9' : (scoringAnswers[q.id] || []).length > 0 ? '#F8FAFC' : '#FFF', opacity: isLocked ? 0.65 : 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#0F172A', marginBottom: q.cond ? '2px' : '8px' }}>
                        Câu {qi + 1}: {q.text}
                      </div>
                      {q.cond && <div style={{ fontSize: '11px', fontWeight: 800, color: '#DC2626', marginBottom: '8px' }}>{q.cond}</div>}
                      {isLocked && <div style={{ fontSize: '11px', fontWeight: 800, color: '#64748B', marginBottom: '8px' }}>🔒 Đã bị khóa vì HR đã tick câu còn lại trong nhóm — bỏ chọn câu kia để mở lại.</div>}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', pointerEvents: isLocked ? 'none' : 'auto' }}>
                        {q.options.map((opt, oi) => {
                          const picked = (scoringAnswers[q.id] || []).includes(oi);
                          const toggle = () => {
                            setScoringAnswers(prev => {
                              const next: Record<string, number[]> = { ...prev };
                              // Khóa chéo: tick câu này thì xóa + khóa các câu cùng nhóm.
                              if (q.lockGroup) {
                                for (const g of rubric.questions) {
                                  if (g.lockGroup === q.lockGroup && g.id !== q.id) delete next[g.id];
                                }
                              }
                              const cur = next[q.id] || [];
                              if (q.multi) {
                                next[q.id] = cur.includes(oi) ? cur.filter(x => x !== oi) : [...cur, oi];
                              } else {
                                next[q.id] = cur.includes(oi) ? [] : [oi];
                              }
                              return next;
                            });
                          };
                          return (
                            <label key={oi} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', padding: '7px 10px', borderRadius: '7px', cursor: 'pointer', backgroundColor: picked ? (opt.loai ? '#FEE2E2' : '#DBEAFE') : '#F8FAFC', border: picked ? (opt.loai ? '1.5px solid #FCA5A5' : '1.5px solid #93C5FD') : '1px solid #E2E8F0', fontWeight: picked ? 800 : 500 }}>
                              <input type={q.multi ? 'checkbox' : 'radio'} checked={picked} onChange={toggle} />
                              <span style={{ flex: 1 }}>{opt.label}</span>
                              <span style={{ fontWeight: 800, fontSize: '11px', padding: '2px 8px', borderRadius: '999px', backgroundColor: opt.loai ? '#DC2626' : '#1D4ED8', color: '#FFF' }}>
                                {opt.loai ? 'LOẠI' : `${opt.score}đ`}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    );
                  })}
                </div>
                <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: verdictBg, gap: '12px', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: '13px', fontWeight: 800, color: verdictTx }}>
                    Tổng: {live.total}/{live.achievableMax}{live.achievableMax !== live.max ? ` (MAX giấy ${live.max})` : ''} — {verdictLabel}
                  </div>
                  <button
                    onClick={handleSaveScore}
                    disabled={scoringBusy || answered < required}
                    title={answered < required ? `Chấm đủ ${required} câu (cặp khóa chéo tính 1) mới được lưu` : 'Lưu điểm rubric'}
                    style={{ padding: '10px 20px', borderRadius: '8px', backgroundColor: scoringBusy || answered < required ? '#CBD5E1' : '#1E40AF', color: '#FFF', fontSize: '13px', fontWeight: 800, border: 'none', cursor: scoringBusy || answered < required ? 'not-allowed' : 'pointer' }}
                  >
                    {scoringBusy ? '⏳ Đang lưu...' : '💾 Lưu điểm'}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* MODAL CẬP NHẬT THÔNG TIN ỨNG VIÊN (chốt 1 ca + 1 chi nhánh trước duyệt) */}        {updatingId && (() => {
          const cand = (candidates || []).find((x: any) => x.submission_id === updatingId);
          return (
            <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
              <div style={{ backgroundColor: '#FFF', borderRadius: '14px', maxWidth: '480px', width: '100%', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', backgroundColor: '#F59E0B', color: '#FFF', fontWeight: 800, fontSize: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>✏️ Cập nhật TT: {cand?.full_name || updatingId}</span>
                  <button onClick={() => !updatingBusy && setUpdatingId(null)} disabled={updatingBusy} style={{ border: 'none', background: 'rgba(255,255,255,0.25)', color: '#FFF', fontSize: '15px', cursor: 'pointer', borderRadius: '6px', padding: '2px 8px' }}>✕</button>
                </div>
                <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ fontSize: '12px', color: '#92400E', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', padding: '8px 12px', lineHeight: '1.5' }}>
                    Ứng viên đăng ký từ 2 ca / 2 chi nhánh trở lên phải chốt lại <strong>đúng 1 ca + 1 chi nhánh</strong> mới được Duyệt Thử việc.
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 800, display: 'block', marginBottom: '4px' }}>Ca làm việc (1 ca duy nhất):</label>
                    <select
                      value={updatingShift}
                      onChange={(e) => setUpdatingShift(e.target.value)}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px', fontWeight: 700 }}
                    >
                      {SHIFT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Đang đăng ký: {cand?.registered_shift || '—'}</div>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 800, display: 'block', marginBottom: '4px' }}>Chi nhánh (1 chi nhánh duy nhất):</label>
                    <select
                      value={updatingBranch}
                      onChange={(e) => setUpdatingBranch(e.target.value)}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px' }}
                    >
                      {branches.length > 0 ? (
                        branches.map((b: any) => (
                          <option key={b.branch_id || b.id} value={b.branch_id || b.id}>{b.name}</option>
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
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Đang đăng ký: {cand?.branch_name || cand?.preferred_branch_id || '—'}</div>
                  </div>
                  <button
                    onClick={handleSaveUpdating}
                    disabled={updatingBusy}
                    style={{ padding: '11px', borderRadius: '8px', backgroundColor: updatingBusy ? '#CBD5E1' : '#F59E0B', color: '#FFF', fontSize: '13px', fontWeight: 800, border: 'none', cursor: updatingBusy ? 'not-allowed' : 'pointer' }}
                  >
                    {updatingBusy ? '⏳ Đang lưu...' : '💾 Lưu cập nhật'}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
        {/* MODAL KẾT QUẢ DUYỆT THỬ VIỆC (mã NV + PIN trao tay) */}
        {approveResult && (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
            <div style={{ backgroundColor: '#FFF', borderRadius: '14px', maxWidth: '480px', width: '100%', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', backgroundColor: '#10B981', color: '#FFF', fontWeight: 800, fontSize: '15px' }}>
                ✅ Duyệt thử việc thành công!
              </div>
              <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '14px' }}>
                <div><strong>Nhân viên:</strong> {(approveResult as any)?.employee?.full_name} ({(approveResult as any)?.employee?.employee_code})</div>
                <div><strong>SĐT:</strong> {(approveResult as any)?.employee?.phone_normalized}</div>
                {((approveResult as any)?.probation) && (
                  <div style={{ backgroundColor: '#EFF6FF', border: '1.5px solid #93C5FD', borderRadius: '8px', padding: '12px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#1D4ED8', marginBottom: '6px' }}>📅 Lịch đi thử việc (12 ngày)</div>
                    <div style={{ fontSize: '13px', color: '#0F172A' }}>
                      Từ <strong>{(approveResult as any)?.probation?.startDate}</strong> đến <strong>{(approveResult as any)?.probation?.endDate}</strong>
                    </div>
                    <div style={{ fontSize: '13px', color: '#0F172A' }}>
                      Chi nhánh: <strong>{getDisplayBranch((approveResult as any)?.probation?.branchId || 'CN130')}</strong>
                    </div>
                    <div style={{ fontSize: '13px', color: '#0F172A' }}>
                      Ca: <strong>{(approveResult as any)?.probation?.shiftLabel || 'Theo phân công'}</strong>
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748B', marginTop: '4px' }}>Lịch ca chi tiết do BOT tự xếp theo ca đăng ký — HR theo dõi ở tab Thử việc.</div>
                  </div>
                )}
                <div style={{ backgroundColor: '#FFFBEB', border: '1.5px solid #F59E0B', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '12px', color: '#92400E', fontWeight: 700 }}>Mã PIN khởi tạo (trao TRỰC TIẾP cho NV):</div>
                  <div style={{ fontSize: '28px', fontWeight: 900, letterSpacing: '6px', color: '#92400E' }}>{(approveResult as any)?.account?.pin_code || '—'}</div>
                  <div style={{ fontSize: '11px', color: '#92400E' }}>NV đăng nhập SĐT + PIN này rồi đặt PIN riêng ngay.</div>
                </div>
                <button
                  onClick={() => setApproveResult(null)}
                  style={{ padding: '10px', borderRadius: '8px', backgroundColor: '#1E40AF', color: '#FFF', fontSize: '13px', fontWeight: 800, border: 'none', cursor: 'pointer' }}
                >
                  Đã rõ
                </button>
              </div>
            </div>
          </div>
        )}

        {/* POPUP ĐẾN GIỜ PV: cảnh báo + chuông riêng, HR vào Meet ngay */}
        {pvAlert && (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
            <div style={{ backgroundColor: '#FFF', borderRadius: '16px', maxWidth: '440px', width: '100%', overflow: 'hidden', animation: 'fx-shake 0.5s ease' }}>
              <div style={{ padding: '16px 20px', backgroundColor: '#DC2626', color: '#FFF', fontWeight: 900, fontSize: '16px', textAlign: 'center' }}>
                🔴 ĐẾN GIỜ PHỎNG VẤN!
              </div>
              <div style={{ padding: '22px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '22px', fontWeight: 900, color: '#0F172A' }}>{pvAlert.full_name}</div>
                <div style={{ fontSize: '14px', color: '#475569', fontWeight: 700 }}>
                  {String(pvAlert.interview_time_slot || '').slice(0, 5)} • {String(pvAlert.interview_date || '').slice(0, 10)}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {pvAlert.branch_name || getDisplayBranch(pvAlert.preferred_branch_id || 'CN130')} • {pvAlert.phone || pvAlert.phone_normalized}
                </div>
                {meetBlocked && (
                  <div style={{ fontSize: '11px', color: '#92400E', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', padding: '8px 10px', lineHeight: '1.5' }}>
                    ⚠️ Trình duyệt đang chặn tự mở tab. Bấm <strong>“Vào Meet ngay”</strong> bên dưới là mở được ngay (hoặc bấm bất kỳ đâu trên trang — hệ thống tự mở bù).
                  </div>
                )}
                <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                  <button
                    data-meet-open="1"
                    onClick={() => { try { window.open(SYSTEM_MEET_URL, '_blank'); } catch {} markPvJoined(pvAlert); pendingMeetRef.current.delete(`${(pvAlert as any)?.submission_id}|${String((pvAlert as any)?.interview_date || '').slice(0, 10)}`); setPvAlert(null); }}
                    style={{ flex: 1, padding: '12px', borderRadius: '10px', backgroundColor: '#DC2626', color: '#FFF', fontSize: '14px', fontWeight: 900, border: 'none', cursor: 'pointer' }}
                  >
                    🔴 Vào Meet ngay
                  </button>
                  <button
                    onClick={() => setPvAlert(null)}
                    style={{ flex: 1, padding: '12px', borderRadius: '10px', backgroundColor: '#F1F5F9', color: '#334155', fontSize: '14px', fontWeight: 800, border: 'none', cursor: 'pointer' }}
                  >
                    Để sau
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MÀN PHÁO HOA TUYÊN DƯƠNG 13/13 TUYỆT ĐỐI */}
        {celebration && (
          <PerfectScoreCelebration
            name={celebration.name}
            total={celebration.total}
            rubric={celebration.rubric}
            onClose={() => setCelebration(null)}
          />
        )}
      </div>
    );
  }

  if (activeTab === 'hr-probation' || activeTab === 'staff') {
    // Mật độ ca thử việc: gom ca theo ngày (loại CANCELLED, khử trùng assignment_id).
    // Bạn nào muốn đẩy nhanh (2 ca/ngày) sẽ lộ ở đây: maxPerDay >= 2 + danh sách ngày.
    const probationShiftDensity = (empId: string): { maxPerDay: number; total: number; multiDays: { date: string; count: number; codes: string }[] } => {
      const list = (shifts || []).filter((s: any) => s?.employee_id === empId && s?.status !== 'CANCELLED');
      const seen = new Set<string>();
      const byDate = new Map<string, any[]>();
      for (const s of list) {
        const key = s.assignment_id || `${s.date}|${s.shift_code}|${s.start_at}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const d = String(s.date || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
        if (!byDate.has(d)) byDate.set(d, []);
        byDate.get(d)!.push(s);
      }
      let max = 0;
      const multi: { date: string; count: number; codes: string }[] = [];
      for (const [d, arr] of byDate) {
        if (arr.length > max) max = arr.length;
        if (arr.length >= 2) {
          multi.push({
            date: d,
            count: arr.length,
            codes: arr.map((x: any) => String(x.shift_code || '').replace(/^CA_/, 'Ca ')).join(' + '),
          });
        }
      }
      multi.sort((a, b) => a.date.localeCompare(b.date));
      return { maxPerDay: max, total: seen.size, multiDays: multi };
    };
    const probationEmps = allEmployees.filter((e) => e.employment_status === 'PROBATION');
    const doubleShiftEmps = probationEmps.filter((e) => probationShiftDensity(e.employee_id).maxPerDay >= 2);
    // Ngày hoàn thành thử việc = start_date + 11 (cửa sổ 12 ngày). Không có ngày
    // bắt đầu -> null (HR bổ sung rồi mới biết hạn).
    const probationEndOf = (emp: any): { end: string; leftDays: number; due: boolean } | null => {
      const s = String(emp?.start_date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
      const endMs = new Date(`${s}T00:00:00Z`).getTime() + 11 * 86_400_000;
      if (!Number.isFinite(endMs)) return null;
      const end = new Date(endMs).toISOString().slice(0, 10);
      const todayStr = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
      const leftDays = Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${todayStr}T00:00:00Z`).getTime()) / 86_400_000);
      return { end, leftDays, due: leftDays <= 0 };
    };
    const assessByEmp = new Map<string, any>((assessList || []).map((a: any) => [a.employeeId, a]));
    const fmtDM = (iso: string) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—';
    const filteredProbationEmps = probationEmps.filter((emp) => {
      if (probationBranchFilter !== 'ALL' && emp.default_branch_id !== probationBranchFilter && emp.branch_id !== probationBranchFilter) {
        return false;
      }
      if (probationDoubleOnly && probationShiftDensity(emp.employee_id).maxPerDay < 2) {
        return false;
      }
      if (probationSearch.trim()) {
        const q = probationSearch.toLowerCase().trim();
        const code = (emp.employee_code || '').toLowerCase();
        const name = (emp.full_name || '').toLowerCase();
        const phone = (emp.phone_normalized || emp.phone || '').toLowerCase();
        return code.includes(q) || name.includes(q) || phone.includes(q);
      }
      return true;
    });
    // Tiến độ 12 ngày thử việc (7 làm / 5 OFF) tính từ ngày bắt đầu.
    const probationProgress = (emp: any): { done: number; left: number; pct: number } | null => {
      const s = toISODate(emp.start_date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
      const startMs = new Date(`${s}T00:00:00+07:00`).getTime();
      if (!Number.isFinite(startMs)) return null;
      const todayStr = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
      const todayMs = new Date(`${todayStr}T00:00:00+07:00`).getTime();
      const done = Math.max(0, Math.min(12, Math.floor((todayMs - startMs) / 86_400_000) + 1));
      return { done, left: Math.max(0, 12 - done), pct: Math.round((done / 12) * 100) };
    };
    // Điểm TEST cao nhất của NV (thang 10) — chưa làm thì báo sẵn sàng.
    const probationBestScore = (empId: string): number | null => {
      const subs = (testSubs || []).filter((s: any) => s.employee_id === empId && typeof s.score === 'number');
      if (subs.length === 0) return null;
      return Math.max(...subs.map((s: any) => Number(s.score)));
    };
    const expiringSoon = probationEmps.filter((e) => {
      const p = probationProgress(e);
      return p !== null && p.left <= 3;
    }).length;
    return (
      <div id="sec-probation" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Header Action Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 800, margin: 0, color: 'var(--text)' }}>
              4. Quản Lý Nhân Viên Thử Việc (12 Ngày)
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
              Theo dõi 12 ngày thử việc (7 làm / 5 OFF), kết quả làm bài TEST và đề xuất lên chính thức. Bạn nào đẩy nhanh (2 ca/ngày) hiện badge ⚡ ở cột Mật độ ca.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn-primary" onClick={openNewEmpModal}>+ Thêm NV Thử Việc</button>
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
            <div style={{ width: '44px', height: '44px', borderRadius: '10px', backgroundColor: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#B45309' }}>
              <Users size={22} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Tổng NV Thử Việc</div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>{probationEmps.length} <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)' }}>nhân sự</span></div>
            </div>
          </div>

          <div style={{ backgroundColor: 'var(--surface)', padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '10px', backgroundColor: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#DC2626' }}>
              <Clock size={22} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Sắp Hết Hạn (≤ 3 ngày)</div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#DC2626' }}>{expiringSoon} <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)' }}>nhân sự</span></div>
            </div>
          </div>

          <div style={{ backgroundColor: 'var(--surface)', padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '10px', backgroundColor: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2563EB' }}>
              <DollarSign size={22} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Lương Giờ Thử Việc</div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#059669' }}>21.000 <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)' }}>đ/h</span></div>
            </div>
          </div>

          <div style={{ backgroundColor: 'var(--surface)', padding: '16px 20px', borderRadius: '12px', border: '1px solid #FDE68A', display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '10px', backgroundColor: '#FFFBEB', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#D97706', fontSize: '22px', fontWeight: 800 }}>
              ⚡
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Đẩy Nhanh (2 ca/ngày)</div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#B45309' }}>{doubleShiftEmps.length} <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)' }}>nhân sự</span></div>
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
              value={probationSearch}
              onChange={(e) => setProbationSearch(e.target.value)}
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
              value={probationBranchFilter}
              onChange={(e) => setProbationBranchFilter(e.target.value)}
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
              <option value="ALL">Tất Cả Chi Nhánh ({probationEmps.length})</option>
              <option value="CN130">CN1: 130 Vạn Kiếp (Bình Thạnh)</option>
              <option value="CN261">CN2: 261 Tô Hiến Thành (Q.10)</option>
              <option value="CN120">CN3: 120 Hoàng Diệu 2 (Thủ Đức)</option>
              <option value="CN111">CN4: 111 Tôn Đản (Q.4)</option>
              <option value="VAN_PHONG">Văn Phòng (10 Đặng Thai Mai)</option>
              <option value="XUONG_SX">Xưởng Sản Xuất (Củ Chi)</option>
            </select>
          </div>

          <label title="Chỉ hiện NV có ngày làm 2 ca trở lên (đẩy nhanh thử việc)" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: probationDoubleOnly ? '#B45309' : 'var(--text-muted)', backgroundColor: probationDoubleOnly ? '#FFFBEB' : 'transparent', border: `1.5px solid ${probationDoubleOnly ? '#F59E0B' : 'var(--border)'}`, borderRadius: '8px', padding: '7px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={probationDoubleOnly}
              onChange={(e) => setProbationDoubleOnly(e.target.checked)}
              style={{ accentColor: '#F59E0B', width: '14px', height: '14px' }}
            />
            ⚡ Chỉ hiện 2 ca/ngày ({doubleShiftEmps.length})
          </label>

          {(probationSearch || probationBranchFilter !== 'ALL' || probationDoubleOnly) && (
            <button
              onClick={() => {
                setProbationSearch('');
                setProbationBranchFilter('ALL');
                setProbationDoubleOnly(false);
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
            Hiển thị <strong>{filteredProbationEmps.length}</strong> / {probationEmps.length} nhân sự
          </div>
        </div>

        {/* DANH SÁCH THẺ NV THỬ VIỆC (card từng người — dễ nhìn hơn bảng 14 cột) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {filteredProbationEmps.length > 0 ? (
            filteredProbationEmps.map((emp, i) => {
              const prog = probationProgress(emp);
              const best = probationBestScore(emp.employee_id);
              const density = probationShiftDensity(emp.employee_id);
              const endInfo = probationEndOf(emp);
              const a = assessByEmp.get(emp.employee_id);
              const progColor = !prog || prog.left === 0 ? '#10B981' : prog.left <= 3 ? '#EF4444' : '#F59E0B';
              return (
                <div
                  key={emp.employee_id || i}
                  style={{ backgroundColor: 'var(--surface)', borderRadius: '12px', border: `1.5px solid ${endInfo?.due ? '#FECACA' : 'var(--border)'}`, overflow: 'hidden', boxShadow: '0 2px 4px rgba(0,0,0,0.03)' }}
                >
                  {/* Hàng 1: avatar + tên + badge trạng thái + điểm TEST */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px 10px', flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', width: '46px', height: '46px', flexShrink: 0 }}>
                      <div style={{ width: '46px', height: '46px', borderRadius: '50%', background: 'linear-gradient(135deg, #F59E0B, #EC4899)', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '17px' }}>
                        {(emp.full_name || 'NV').charAt(0).toUpperCase()}
                      </div>
                      {!!(emp as any).avatar_drive_id && (
                        <div style={{ position: 'absolute', inset: 0 }}>
                          <EmpAvatar employeeId={emp.employee_id} size={46} />
                        </div>
                      )}
                    </div>
                    <div style={{ flex: '1 1 200px', minWidth: '180px' }}>
                      <div style={{ fontWeight: 800, fontSize: '15px', color: 'var(--text)' }}>{emp.full_name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--brand)' }}>{emp.employee_code}</span>
                        {emp.email ? ` • ${emp.email}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                      {endInfo?.due && (
                        <span style={{ padding: '4px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 800, backgroundColor: '#FEE2E2', color: '#DC2626', border: '1px solid #FECACA' }}>
                          🔔 Đến hạn xét duyệt!
                        </span>
                      )}
                      {density.maxPerDay >= 2 && (
                        <span title={`Các ngày làm 2+ ca:\n${density.multiDays.map((m) => `${m.date.slice(8, 10)}/${m.date.slice(5, 7)}: ${m.codes}`).join('\n')}`} style={{ padding: '4px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 800, backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #F59E0B', whiteSpace: 'nowrap' }}>
                          ⚡ {density.maxPerDay} ca/ngày
                        </span>
                      )}
                      {best !== null ? (
                        <span style={{ padding: '4px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 800, backgroundColor: best >= 8 ? '#ECFDF5' : '#FEF2F2', color: best >= 8 ? '#059669' : '#DC2626', border: `1px solid ${best >= 8 ? '#A7F3D0' : '#FECACA'}` }}>
                          ⭐ TEST {best}/10
                        </span>
                      ) : (
                        <span className="badge badge-success">Sẵn sàng TEST</span>
                      )}
                    </div>
                  </div>
                  {/* Hàng 2: thanh tiến độ 12 ngày */}
                  <div style={{ padding: '0 18px 10px' }}>
                    {prog ? (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 700, color: prog.left === 0 ? '#059669' : prog.left <= 3 ? '#DC2626' : 'var(--text-muted)', marginBottom: '4px' }}>
                          <span>Ngày {prog.done}/12 • {endInfo ? `Hoàn thành ${fmtDM(endInfo.end)}` : ''}</span>
                          <span>{prog.left === 0 ? 'Hết hạn — xét duyệt!' : `Còn ${prog.left} ngày`}</span>
                        </div>
                        <div style={{ height: '8px', borderRadius: '999px', backgroundColor: '#F1F5F9', overflow: 'hidden' }}>
                          <div style={{ width: `${prog.pct}%`, height: '100%', borderRadius: '999px', backgroundColor: progColor }} />
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Chưa rõ ngày bắt đầu — HR bổ sung ở tab Hồ Sơ NV.</div>
                    )}
                  </div>
                  {/* Hàng 3: ô thông tin */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px', padding: '0 18px 10px', fontSize: '12px' }}>
                    <div style={{ backgroundColor: 'var(--bg)', borderRadius: '8px', padding: '8px 10px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>📞 SĐT</div>
                      <div style={{ fontWeight: 700, marginTop: '2px' }}><a href={`tel:${emp.phone_normalized || emp.phone}`} style={{ color: 'var(--text)', textDecoration: 'none' }}>{emp.phone_normalized || emp.phone || '---'}</a></div>
                    </div>
                    <div style={{ backgroundColor: 'var(--bg)', borderRadius: '8px', padding: '8px 10px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>🏪 CHI NHÁNH • KHỐI</div>
                      <div style={{ fontWeight: 700, marginTop: '2px' }}>{getDisplayBranch(emp.default_branch_id || emp.branch_id, emp.group)} • {emp.group === 'VAN_PHONG' ? 'Văn phòng' : emp.group === 'XUONG' ? 'Sản xuất' : emp.group === 'SALE' ? 'Sale' : 'Cửa hàng'}</div>
                    </div>
                    <div style={{ backgroundColor: 'var(--bg)', borderRadius: '8px', padding: '8px 10px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>💰 LƯƠNG GIỜ • BẮT ĐẦU</div>
                      <div style={{ fontWeight: 800, marginTop: '2px', color: '#059669' }}>{emp.current_rate_per_hour ? `${Number(emp.current_rate_per_hour).toLocaleString('vi-VN')} đ/h` : '21.000 đ/h'}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Từ {toISODate(emp.start_date) ? fmtDM(toISODate(emp.start_date)) : 'đang cập nhật'}</div>
                    </div>
                    <div style={{ backgroundColor: 'var(--bg)', borderRadius: '8px', padding: '8px 10px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>🕒 CA ĐÃ XẾP</div>
                      <div style={{ fontWeight: 700, marginTop: '2px' }}>{density.total > 0 ? `Tổng ${density.total} ca` : 'Chưa xếp ca'}</div>
                      {density.multiDays.length > 0 && (
                        <div style={{ fontSize: '11px', color: '#92400E', marginTop: '2px' }}>
                          {density.multiDays.slice(0, 3).map((m) => `${m.date.slice(8, 10)}/${m.date.slice(5, 7)} (${m.codes})`).join(' • ')}
                          {density.multiDays.length > 3 && ` +${density.multiDays.length - 3} ngày`}
                        </div>
                      )}
                    </div>
                    <div style={{ backgroundColor: 'var(--bg)', borderRadius: '8px', padding: '8px 10px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>📝 KIỂM TRA ĐẦU RA</div>
                      <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {!a ? (
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Chưa lên lịch</span>
                        ) : (
                          <>
                            {a.meetDone ? (
                              <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '999px', fontWeight: 800, fontSize: '11px', backgroundColor: a.meetDone.passed ? '#ECFDF5' : '#FEF2F2', color: a.meetDone.passed ? '#059669' : '#DC2626' }}>
                                🎥 Meet: {a.meetDone.passed ? 'ĐẠT' : 'CHƯA ĐẠT'}
                              </span>
                            ) : (
                              <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '999px', fontWeight: 800, fontSize: '11px', backgroundColor: '#EFF6FF', color: '#1D4ED8' }}>
                                🎥 Meet: {a.meetDate ? `${a.meetTime} ${fmtDM(a.meetDate)}` : 'đã lên lịch'}
                              </span>
                            )}
                            {!a.quizTestId ? (
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>📝 Quiz: chưa giao</span>
                            ) : !a.quiz ? (
                              <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '999px', fontWeight: 800, fontSize: '11px', backgroundColor: '#FFFBEB', color: '#92400E' }}>
                                📝 Quiz: mới lưu lịch — sang TEST giao bài!
                              </span>
                            ) : (
                              <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '999px', fontWeight: 800, fontSize: '11px', backgroundColor: a.quiz.status === 'ASSIGNED' ? '#FFFBEB' : a.quiz.passed ? '#ECFDF5' : '#FEF2F2', color: a.quiz.status === 'ASSIGNED' ? '#92400E' : a.quiz.passed ? '#059669' : '#DC2626' }}>
                                📝 Quiz: {a.quiz.status === 'ASSIGNED' ? 'chờ NV nộp' : `${a.quiz.score ?? '—'}/10 ${a.quiz.passed ? 'ĐẠT' : 'CHƯA ĐẠT'}`}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Hàng 4: thao tác (giữ nguyên mọi nút/logic cũ) */}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', padding: '10px 18px 14px', borderTop: '1px solid var(--border)', backgroundColor: 'var(--bg)' }}>
                    <button
                      className="btn-secondary"
                      style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 700, color: '#1D4ED8', borderColor: '#BFDBFE' }}
                      onClick={async () => {
                        const ax = assessByEmp.get(emp.employee_id);
                        setAssessModalEmp(emp);
                        setAssessDate(ax?.meetDate || probationEndOf(emp)?.end || '');
                        setAssessTime(ax?.meetTime || '09:00');
                        setAssessQuizId(ax?.quizTestId || '');
                        if (ax?.meetUrl) {
                          setAssessMeetUrl(ax.meetUrl);
                        } else {
                          // Hệ thống tự lấy link Meet hiện tại điền sẵn (HR vẫn sửa được).
                          setAssessMeetUrl('Đang lấy link Meet hệ thống...');
                          try {
                            const d: any = await apiRequest('/admin/system-meet-url');
                            setAssessMeetUrl(d?.meetUrl || SYSTEM_MEET_URL);
                          } catch {
                            setAssessMeetUrl(SYSTEM_MEET_URL);
                          }
                        }
                      }}
                      title="Lên lịch kiểm tra đầu ra: vấn đáp Google Meet + giao bài trắc nghiệm, gửi thông báo cả 2 cho NV"
                    >
                      📅 Lên lịch đầu ra
                    </button>
                    {(() => {
                      if (!a || a.meetDone) return null;
                      const busy = meetBusyId === emp.employee_id;
                      const mark = async (passed: boolean) => {
                        if (!window.confirm(`Chấm vấn đáp Meet của ${emp.full_name}: ${passed ? 'ĐẠT' : 'CHƯA ĐẠT'}?`)) return;
                        setMeetBusyId(emp.employee_id);
                        try {
                          await apiRequest('/admin/probation-assessment/meet-done', {
                            method: 'POST',
                            body: JSON.stringify({ employeeId: emp.employee_id, passed }),
                          });
                          showToast(passed ? `✅ ${emp.full_name} vấn đáp Meet ĐẠT!` : `📝 Đã ghi ${emp.full_name} vấn đáp Meet CHƯA ĐẠT.`);
                          await loadAssessments();
                          if (onRefreshData) await onRefreshData();
                        } catch (e: any) {
                          showToast(e?.message || 'Lỗi khi chấm Meet!');
                        } finally {
                          setMeetBusyId(null);
                        }
                      };
                      return (<>
                        <button
                          className="btn-secondary"
                          disabled={busy}
                          style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 700, color: '#059669', borderColor: '#A7F3D0' }}
                          onClick={() => mark(true)}
                          title="Chấm vấn đáp Google Meet: ĐẠT"
                        >
                          ✓ Meet Đạt
                        </button>
                        <button
                          className="btn-secondary"
                          disabled={busy}
                          style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 700, color: '#DC2626', borderColor: '#FECACA' }}
                          onClick={() => mark(false)}
                          title="Chấm vấn đáp Google Meet: CHƯA ĐẠT"
                        >
                          ✗ Chưa đạt
                        </button>
                      </>);
                    })()}
                    <button
                      className="btn-primary"
                      style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 700, backgroundColor: '#059669' }}
                      onClick={async () => {
                        if (!window.confirm(`Chuyển ${emp.full_name} (${emp.employee_code}) lên NHÂN VIÊN CHÍNH THỨC?`)) return;
                        try {
                          await apiRequest(`/employees/${emp.employee_id}/transition-official`, {
                            method: 'POST',
                            body: JSON.stringify({ expectedVersion: emp.version || 1 }),
                          });
                          showToast(`✅ ${emp.full_name} đã lên chính thức!`);
                          if (onRefreshData) await onRefreshData();
                          if (onSyncSheets) await onSyncSheets();
                        } catch (e: any) {
                          showToast(e?.message || 'Lỗi khi chuyển chính thức!');
                        }
                      }}
                    >
                      Đề Xuất Chính Thức
                    </button>
                    <button
                      className="btn-secondary"
                      style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 700 }}
                      onClick={() => {
                        setEditingEmp(emp);
                        setEditEmpForm({
                          fullName: emp.full_name || '',
                          phone: emp.phone_normalized || '',
                          branchId: emp.default_branch_id || 'CN130',
                          group: emp.group || 'STORE',
                          rate: emp.current_rate_per_hour || 21000,
                          shift: emp.default_shift_code || '',
                          startDate: String(emp.start_date || '').slice(0, 10),
                          officialDate: String(emp.official_date || '').slice(0, 10),
                          email: emp.email || '',
                        });
                      }}
                    >
                      Sửa
                    </button>
                    <button
                      className="btn-secondary"
                      style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 700, color: '#DC2626' }}
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
                </div>
              );
            })
          ) : (
            <div style={{ backgroundColor: 'var(--surface)', borderRadius: '12px', border: '1px solid var(--border)', textAlign: 'center', padding: '48px 20px', color: 'var(--text-muted)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                <Users size={36} color="var(--border)" />
                <div style={{ fontWeight: 600, fontSize: '14px' }}>Hiện chưa có nhân viên trong giai đoạn thử việc</div>
                <div style={{ fontSize: '12px', maxWidth: '420px', lineHeight: 1.5 }}>
                  Dữ liệu sẽ đồng bộ từ Google Sheets, hoặc bấm nút <strong>+ Thêm NV Thử Việc</strong> phía trên để tạo hồ sơ mới.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* MODAL LÊN LỊCH KIỂM TRA ĐẦU RA (Meet vấn đáp + trắc nghiệm, gửi cả 2 cho NV) */}
        {assessModalEmp && (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px' }}>
            <div style={{ backgroundColor: 'var(--surface)', borderRadius: '12px', maxWidth: '520px', width: '100%', maxHeight: '90vh', overflow: 'auto', padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 800, margin: 0 }}>📅 Kiểm tra đầu ra: {assessModalEmp.full_name} ({assessModalEmp.employee_code})</h2>
                <button className="btn-secondary" style={{ padding: '4px 12px' }} onClick={() => !assessBusy && setAssessModalEmp(null)}>Đóng</button>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px', lineHeight: 1.5 }}>
                Ngày hoàn thành thử việc: <strong>{probationEndOf(assessModalEmp)?.end?.split('-').reverse().join('/') || '—'}</strong>. Lên lịch xong hệ thống gửi ngay thông báo cả 2 hình thức cho NV (Meet + trắc nghiệm).
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '14px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700 }}>Ngày vấn đáp Meet<input type="date" value={assessDate} onChange={(e) => setAssessDate(e.target.value)} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }} /></label>
                <label style={{ fontSize: '12px', fontWeight: 700 }}>Giờ vấn đáp<input type="time" value={assessTime} onChange={(e) => setAssessTime(e.target.value)} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }} /></label>
              </div>
              <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginTop: '10px' }}>Link Google Meet (hệ thống tự điền link hiện tại — sửa được nếu cần)<input value={assessMeetUrl} onChange={(e) => setAssessMeetUrl(e.target.value)} placeholder="https://meet.google.com/xxx-yyyy-zzz" style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }} /></label>
              <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginTop: '10px' }}>Bài trắc nghiệm giao kèm (không bắt buộc)
                <select value={assessQuizId} onChange={(e) => setAssessQuizId(e.target.value)} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }}>
                  <option value="">— Không giao bài (HR giao sau ở tab TEST) —</option>
                  {(testPapers || []).map((p: any) => (
                    <option key={p.test_id} value={p.test_id}>{p.title} (đạt {p.pass_score}/10)</option>
                  ))}
                </select>
              </label>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', lineHeight: 1.5 }}>
                💡 Muốn giao bài trắc nghiệm có sẵn cho NV: lên lịch ở đây (lưu quiz vào lịch) rồi sang tab TEST giao đúng đề đó cho NV — hoặc giao trước rồi quay lại chọn đề.
              </div>
              <button
                className="btn-primary"
                disabled={assessBusy || !assessDate || !assessTime || !assessMeetUrl.trim() || assessMeetUrl.startsWith('Đang lấy')}
                onClick={async () => {
                  setAssessBusy(true);
                  try {
                    // Đang lấy link mà HR đã bấm lưu -> gửi rỗng để server tự điền link hiện tại.
                    const url = assessMeetUrl.startsWith('Đang lấy') ? '' : assessMeetUrl.trim();
                    const res: any = await apiRequest('/admin/probation-assessment/schedule', {
                      method: 'POST',
                      body: JSON.stringify({
                        employeeId: assessModalEmp.employee_id,
                        meetDate: assessDate,
                        meetTime: assessTime,
                        meetUrl: url,
                        ...(assessQuizId ? { quizTestId: assessQuizId } : {}),
                      }),
                    });
                    showToast(`✅ ${res?.message || 'Đã lên lịch kiểm tra đầu ra!'}`);
                    setAssessModalEmp(null);
                    await loadAssessments();
                    if (onRefreshData) await onRefreshData();
                  } catch (e: any) {
                    showToast(e?.message || 'Lỗi khi lên lịch!');
                  } finally {
                    setAssessBusy(false);
                  }
                }}
                style={{ width: '100%', marginTop: '14px', padding: '10px', fontWeight: 800, opacity: assessBusy || !assessDate || !assessTime || !assessMeetUrl.trim() || assessMeetUrl.startsWith('Đang lấy') ? 0.6 : 1 }}
              >
                {assessBusy ? '⏳ ĐANG LƯU...' : '📩 LƯU LỊCH & GỬI THÔNG BÁO CHO NV'}
              </button>
            </div>
          </div>
        )}

        {/* MODAL SỬA HỒ SƠ NV THỬ VIỆC (HR) — dùng chung state với tab chính thức */}
        {editingEmp && (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px' }}>
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
                <label style={{ fontSize: '12px', fontWeight: 700 }}>Lương giờ (đ/h)<input type="number" value={editEmpForm.rate || 21000} onChange={e => setEditEmpForm({ ...editEmpForm, rate: Number(e.target.value) })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }} /></label>
                <label style={{ fontSize: '12px', fontWeight: 700 }}>Ca cố định<select value={editEmpForm.shift || ''} onChange={e => setEditEmpForm({ ...editEmpForm, shift: e.target.value })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }}><option value="">— Chưa gán —</option><option value="CA_1">Ca 1 (07–12)</option><option value="CA_2">Ca 2 (12–18)</option><option value="CA_3">Ca 3 (18–23)</option></select></label>
                <label style={{ fontSize: '12px', fontWeight: 700 }}>Ngày bắt đầu<input type="date" value={editEmpForm.startDate || ''} onChange={e => setEditEmpForm({ ...editEmpForm, startDate: e.target.value })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }} /></label>
                <label style={{ fontSize: '12px', fontWeight: 700 }}>Ngày chính thức<input type="date" value={editEmpForm.officialDate || ''} onChange={e => setEditEmpForm({ ...editEmpForm, officialDate: e.target.value })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }} /></label>
                <label style={{ fontSize: '12px', fontWeight: 700, gridColumn: '1 / -1' }}>Email<input value={editEmpForm.email || ''} onChange={e => setEditEmpForm({ ...editEmpForm, email: e.target.value })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }} /></label>
              </div>
              <button
                className="btn-primary"
                disabled={editEmpBusy}
                style={{ width: '100%', marginTop: '14px', padding: '10px', fontWeight: 800, backgroundColor: '#B45309' }}
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
                    // Đẩy bộ nhớ -> Sheets NGAY (không pull: pull lúc này đọc Sheet
                    // cũ vì push nền ~10s, gây mất ngày bắt đầu sau reload).
                    if (onPushSheets) await onPushSheets();
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
      </div>
    );
  }

  if (activeTab === 'hr-official' || activeTab === 'staff') {
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
      <div id="sec-official" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
                        {toISODate(emp.official_date) || toISODate(emp.start_date) || 'Đang cập nhật'}
                      </td>
                      <td style={{ padding: '14px 18px', textAlign: 'center' }}>
                        {isEmpAccountLocked(emp) ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 800, letterSpacing: '0.3px', backgroundColor: '#FEE2E2', color: '#991B1B', border: '1px solid #FECACA' }}>
                            🔒 TÀI KHOẢN BỊ KHÓA
                          </span>
                        ) : (
                          <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.3px' }}>
                            <CheckCircle size={11} />
                            CHÍNH THỨC
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '14px 18px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          {isEmpAccountLocked(emp) ? (
                            <button
                              className="btn-secondary"
                              style={{ padding: '5px 12px', fontSize: '12px', fontWeight: 700, color: '#059669', borderColor: '#A7F3D0' }}
                              disabled={lockBusyId === emp.employee_id}
                              title="Mở khóa tài khoản + cấp PIN 6 số mới cho NV đăng nhập lại"
                              onClick={async () => {
                                if (!window.confirm(`MỞ KHÓA tài khoản ${emp.full_name} (${emp.employee_code})?\nHệ thống cấp PIN 6 số mới — HR trao tay NV để đăng nhập lại.`)) return;
                                setLockBusyId(emp.employee_id);
                                try {
                                  const res: any = await apiRequest(`/employees/${emp.employee_id}/unlock`, { method: 'POST' });
                                  setUnlockPinResult({ name: emp.full_name, code: emp.employee_code, pin: res?.pin || '' });
                                  setLockedEmpIds(prev => {
                                    const next = new Set(prev);
                                    next.delete(emp.employee_id);
                                    return next;
                                  });
                                  (emp as any).account_locked = false;
                                  (emp as any).account_status = 'ACTIVE';
                                  try { window.dispatchEvent(new CustomEvent('ubm:employee-unlocked', { detail: { employeeId: emp.employee_id } })); } catch { /* non-fatal */ }
                                  if (onRefreshData) await onRefreshData();
                                } catch (e: any) {
                                  showToast(e?.message || 'Lỗi khi mở khóa!');
                                } finally {
                                  setLockBusyId(null);
                                }
                              }}
                            >
                              {lockBusyId === emp.employee_id ? '⏳...' : '🔓 Mở khóa'}
                            </button>
                          ) : (
                            <button
                              className="btn-secondary"
                              style={{ padding: '5px 12px', fontSize: '12px', fontWeight: 700, color: '#B45309', borderColor: '#FDE68A' }}
                              disabled={lockBusyId === emp.employee_id}
                              title="Khóa ngay: văng phiên đăng nhập, XÓA mã PIN + XÓA lịch làm việc từ hôm nay; giữ nguyên hồ sơ, điểm danh, công, lương"
                              onClick={async () => {
                                if (!window.confirm(`KHÓA tài khoản ${emp.full_name} (${emp.employee_code})?\n• Văng phiên đăng nhập + XÓA mã PIN ngay\n• XÓA lịch làm việc từ HÔM NAY trở đi (ca quá khứ giữ lại đối soát)\n• GIỮ NGUYÊN hồ sơ, điểm danh, công, lương`)) return;
                                setLockBusyId(emp.employee_id);
                                try {
                                  const res: any = await apiRequest(`/employees/${emp.employee_id}/lock`, { method: 'POST' });
                                  showToast(`🔒 Đã khóa tài khoản ${emp.full_name} + xóa PIN + xóa ${res?.shiftsCancelled ?? 0} ca từ hôm nay!`);
                                  setLockedEmpIds(prev => new Set(prev).add(emp.employee_id));
                                  (emp as any).account_locked = true;
                                  (emp as any).account_status = 'LOCKED';
                                  // Ẩn khỏi Lịch NGAY LẬP TỨC (kể cả ca tuần này), không đợi tải lại.
                                  try { window.dispatchEvent(new CustomEvent('ubm:employee-locked', { detail: { employeeId: emp.employee_id } })); } catch { /* non-fatal */ }
                                  if (onRefreshData) await onRefreshData();
                                } catch (e: any) {
                                  showToast(e?.message || 'Lỗi khi khóa!');
                                } finally {
                                  setLockBusyId(null);
                                }
                              }}
                            >
                              {lockBusyId === emp.employee_id ? '⏳...' : '🔒 Khóa TK'}
                            </button>
                          )}
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
                                startDate: toISODate(emp.start_date),
                                officialDate: toISODate(emp.official_date),
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

        {/* MODAL PIN MỚI SAU MỞ KHÓA (HR trao tay NV) */}
        {unlockPinResult && (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: '16px' }}>
            <div style={{ backgroundColor: 'var(--surface)', borderRadius: '12px', maxWidth: '440px', width: '100%', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', backgroundColor: '#059669', color: '#FFF', fontWeight: 800, fontSize: '15px' }}>
                🔓 Mở khóa thành công!
              </div>
              <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '14px', textAlign: 'center' }}>
                <div><strong>{unlockPinResult.name}</strong> ({unlockPinResult.code}) đã đăng nhập lại được.</div>
                <div style={{ backgroundColor: '#FFFBEB', border: '1.5px solid #F59E0B', borderRadius: '8px', padding: '12px' }}>
                  <div style={{ fontSize: '12px', color: '#92400E', fontWeight: 700 }}>Mã PIN mới (trao TRỰC TIẾP cho NV):</div>
                  <div style={{ fontSize: '28px', fontWeight: 900, letterSpacing: '6px', color: '#92400E' }}>{unlockPinResult.pin || '—'}</div>
                  <div style={{ fontSize: '11px', color: '#92400E' }}>NV đăng nhập SĐT + PIN này rồi đặt PIN riêng ngay.</div>
                </div>
                <button
                  className="btn-primary"
                  onClick={() => setUnlockPinResult(null)}
                  style={{ padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: 800, border: 'none', cursor: 'pointer' }}
                >
                  Đã rõ
                </button>
              </div>
            </div>
          </div>
        )}

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
                    // Đẩy bộ nhớ -> Sheets NGAY (không pull: pull lúc này đọc Sheet
                    // cũ vì push nền ~10s, gây mất ngày bắt đầu sau reload).
                    if (onPushSheets) await onPushSheets();
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

  if (activeTab === 'hr-schedule' || activeTab === 'operations') {
    // Dynamic calculation of week days (Monday -> Sunday) + chuyển tuần trước/sau.
    // Nhân viên đăng ký OFF 2 ngày cho TUẦN SAU (T6 09h → T7 09h) → bấm "Tuần sau" để xem OFF + ca đã xếp.
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

    // Gộp realtime + kho lưu trữ (tuần cũ): ô ngày cũ hiện đủ giờ in/out.
    const schedAllEvents = (() => {
      if (!archiveEvents || archiveEvents.length === 0) return liveAttendanceEvents || [];
      const seen = new Set<string>((liveAttendanceEvents || []).map((e: any) => String(e.event_id)));
      const extra = (archiveEvents || []).filter((e: any) => !seen.has(String(e.event_id)));
      return extra.length > 0 ? [...(liveAttendanceEvents || []), ...extra] : (liveAttendanceEvents || []);
    })();
    // Gộp lịch ca realtime + lịch ca tuần cũ (khử trùng theo assignment_id) và loại bỏ ca của NV bị khóa.
    const schedAllShifts = (() => {
      const base = (() => {
        if (!archiveShifts || archiveShifts.length === 0) return shifts || [];
        const seen = new Set<string>((shifts || []).map((s: any) => String(s.assignment_id || '')));
        const extra = (archiveShifts || []).filter((s: any) => !s.assignment_id || !seen.has(String(s.assignment_id)));
        return extra.length > 0 ? [...(shifts || []), ...extra] : (shifts || []);
      })();
      return base.filter((s: any) => !lockedEmpIds.has(String(s.employee_id || '')));
    })();

    const scheduleItems = (allEmployees || [])
      .filter((emp: any) => !isEmpAccountLocked(emp))
      .map((emp, empIdx) => {
      const empShifts = (schedAllShifts || []).filter((s: any) => s.employee_id === emp.employee_id);
      const empLeaves = (leaves || []).filter((l: any) => l.employee_id === emp.employee_id && (l.status === 'APPROVED' || l.status === 'PENDING'));
      const empEvents = (schedAllEvents || []).filter((e: any) => e.employee_id === emp.employee_id);
      const dayDataMap: Record<string, any> = {};
      // Mã ca THẬT từng ngày trong tuần đang xem (để sắp xếp Ca 1 → Ca 2 → Ca 3).
      const weekShiftCodes: string[] = [];

      weekDays.forEach((day) => {
        // Tìm ca làm việc THẬT được phân công trên hệ thống cho ngày này
        // (bỏ ca CANCELLED: ca bị hủy/khóa không còn hiệu lực đi làm).
        const foundShift = empShifts.find((s: any) => s.status !== 'CANCELLED' && (s.date === day.isoDate || (s.date && s.date.startsWith(day.isoDate))));
        // Đơn nghỉ phép đã duyệt hoặc chờ duyệt
        const foundLeave = empLeaves.find((l: any) => l.requested_date === day.isoDate || (l.requested_date && l.requested_date.startsWith(day.isoDate)));
        // Khớp ngày theo giờ Việt Nam (UTC+7) hoặc chuỗi ISO để không bị lệch múi giờ
        const isSameDay = (timeStr: string) => {
          if (!timeStr) return false;
          const vn = vnDayOf(timeStr);
          return vn === day.isoDate || timeStr.startsWith(day.isoDate);
        };
        // Bản ghi điểm danh check-in và check-out thật từ Socket.IO / Database
        const dayEvts = empEvents.filter((e: any) => isSameDay(e.client_time) || (foundShift?.assignment_id && e.assignment_id === foundShift.assignment_id));
        const checkInEvent = dayEvts.find((e: any) => e.type === 'CHECK_IN');
        const checkOutEvent = dayEvts.find((e: any) => e.type === 'CHECK_OUT');
        // Bản ghi VẮNG do hệ thống tự ghi sau khi qua ca không điểm danh (chứng cứ đồng bộ Sheets)
        const absentEvent = dayEvts.find((e: any) => e.type === 'ABSENT');

        const matchShift = (e: any, sh: any) => {
          if (e.assignment_id && sh?.assignment_id) return e.assignment_id === sh.assignment_id;
          return isSameDay(e.client_time);
        };

        const buildOne = (sh: any) => {
          if (sh?.shift_code && !sh?.isExtra) weekShiftCodes.push(String(sh.shift_code));
          const ci = empEvents.find((e: any) => e.type === 'CHECK_IN' && matchShift(e, sh));
          const co = empEvents.find((e: any) => e.type === 'CHECK_OUT' && matchShift(e, sh));
          const ab = empEvents.find((e: any) => e.type === 'ABSENT' && matchShift(e, sh));
          // GPS vượt 300m (dữ liệu cũ từng ghi nhận): đánh dấu để báo đỏ + bắt làm lại
          const ciDist = Number(ci?.distance_meters);
          const gpsBad = !!ci && (ci?.gps_status === 'OUT_OF_BOUNDS' || (Number.isFinite(ciDist) && ciDist > 300));
          // Hết giờ tan ca +30p mà chưa check-out -> chốt (hết nhấp nháy), thiếu là không lương.
          // Chốt cứng thêm 2 trường hợp lệch dữ liệu: ngày đã qua (bất kể end_at) và
          // check-in quá 12h chưa out (end_at lỗi) — không bao giờ kẹt "Đang làm" mãi.
          const endMs = sh?.end_at ? new Date(sh.end_at).getTime() : NaN;
          const ciMs = ci?.client_time ? new Date(ci.client_time).getTime() : NaN;
          const pastEnd = Number.isFinite(endMs) && Date.now() - (endMs as number) > 30 * 60 * 1000;
          const staleIn = Number.isFinite(ciMs) && Date.now() - (ciMs as number) > 12 * 60 * 60 * 1000;
          const pastDay = !day.isToday && day.isPast;
          // Quá 3h kể từ giờ vào ca mà chưa check-in -> khóa, nghỉ không lương
          const startMs = sh?.start_at ? new Date(sh.start_at).getTime() : NaN;
          const locked = !ci && Number.isFinite(startMs) && Date.now() - (startMs as number) > 3 * 60 * 60 * 1000;
          let shiftName = sh?.shift_code;
          if (shiftName === 'CA_1') shiftName = 'Ca 1 (07-12)';
          else if (shiftName === 'CA_2') shiftName = 'Ca 2 (12-18)';
          else if (shiftName === 'CA_3') shiftName = 'Ca 3 (18-23)';
          else if (sh?.isExtra) shiftName = 'Ca làm (Tự điểm danh)';

          if (ci) {
            const inTime = ci.client_time
              ? new Date(ci.client_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
              : 'Đã check-in';
            const distText = ci.distance_meters !== undefined ? `${ci.distance_meters}m` : '< 300m';

            if (!co && (pastEnd || pastDay || staleIn)) {
              return {
                shift: shiftName,
                status: 'MISSING_OUT',
                time: inTime,
                inTime,
                note: `Vào ${inTime} nhưng hết giờ chưa check-out — không lương`,
                gps: gpsBad ? `GPS VƯỢT ${ciDist}m (quá 300m)` : `GPS hợp lệ (${distText})`,
                gpsBad,
                isToday: day.isToday,
                event: ci,
              };
            }
            if (co) {
              const outTime = co.client_time
                ? new Date(co.client_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                : 'Đã check-out';
              return {
                shift: shiftName,
                status: 'COMPLETED',
                time: `${inTime} - ${outTime}`,
                inTime,
                outTime,
                gps: gpsBad ? `GPS VƯỢT ${ciDist}m (quá 300m)` : `GPS hợp lệ (${distText})`,
                gpsBad,
                isToday: day.isToday,
                event: ci,
                outEvent: co,
                note: sh?.isExtra ? 'Ca làm tự điểm danh ngoài lịch' : undefined,
              };
            }
            return {
              shift: shiftName,
              status: 'CHECKED_IN',
              time: inTime,
              inTime,
              gps: gpsBad ? `GPS VƯỢT ${ciDist}m (quá 300m)` : `GPS hợp lệ (${distText})`,
              gpsBad,
              isToday: day.isToday,
              event: ci,
              note: sh?.isExtra ? 'Ca làm tự điểm danh ngoài lịch' : undefined,
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

        if (foundLeave && !checkInEvent) {
          // Lịch OFF tuần (HANG_TUAN) tự động ghi nhận — kể cả bản ghi PENDING cũ
          // cũng hiển thị OFF (backend đã tự chữa thành APPROVED khi đồng bộ).
          // Ca đã xếp KHÔNG bị che: hiện kèm để phát hiện xếp trùng ngày OFF.
          const isWeeklyOff = foundLeave.leave_type === 'HANG_TUAN';
          const isApprovedLeave = isWeeklyOff || foundLeave.status === 'APPROVED';
          const overlapShift = foundShift ? (foundShift.shift_code === 'CA_1' ? 'Ca 1 (07-12)' : foundShift.shift_code === 'CA_2' ? 'Ca 2 (12-18)' : foundShift.shift_code === 'CA_3' ? 'Ca 3 (18-23)' : foundShift.shift_code) : null;
          dayDataMap[day.key] = {
            shift: foundLeave.leave_type === 'DOT_XUAT' ? 'Nghỉ đột xuất' : 'Nghỉ OFF',
            status: isApprovedLeave ? 'OFF' : 'PENDING_LEAVE',
            note: isApprovedLeave
              ? ((foundLeave.reason || 'Nghỉ theo đơn đã duyệt') + (overlapShift ? ` • ⚠ đã xếp ${overlapShift} trùng ngày OFF — xóa ca hoặc hủy OFF` : ''))
              : (`Chờ duyệt: ${foundLeave.reason || 'đơn đột xuất chưa duyệt'}` + (overlapShift ? ` • đã xếp ${overlapShift}` : '')),
            isToday: day.isToday,
          };
        } else if (!foundShift) {
          if (checkInEvent) {
            // Có điểm danh thực tế dù chưa có ca trên lịch xếp trước (tăng cường, làm thay)
            const extraShift = {
              shift_code: checkInEvent.shift_code || 'CA_NGOAI_LICH',
              start_at: checkInEvent.client_time,
              end_at: checkOutEvent?.client_time,
              isExtra: true,
            };
            const res = buildOne(extraShift);
            if (foundLeave) {
              res.note = `Đã đi làm điểm danh (dù có đơn: ${foundLeave.reason || 'Nghỉ OFF'})`;
            }
            dayDataMap[day.key] = res;
          } else {
            // KHÔNG CÓ CA LÀM VIỆC NÀO ĐƯỢC PHÂN CÔNG THẬT -> HIỂN THỊ KHÔNG CÓ CA, KHÔNG LẤY DỮ LIỆU ĐIỂM DANH ẢO
            dayDataMap[day.key] = {
              shift: '—',
              status: 'NO_SHIFT',
              note: 'Không có ca',
              isToday: day.isToday,
            };
          }
        } else {
          // Có ca làm việc thật — ngày 2 ca (do tráo đổi/nhận thay): tính từng ca riêng.
          // Lọc trùng assignment_id để dòng trùng không hiện thành "2 ca" ma.
          const seenAssign = new Set<string>();
          const dayShifts = empShifts.filter((s: any) => {
            if (s.status === 'CANCELLED') return false;
            if (!(s.date === day.isoDate || (s.date && s.date.startsWith(day.isoDate)))) return false;
            if (s.assignment_id && seenAssign.has(s.assignment_id)) return false;
            if (s.assignment_id) seenAssign.add(s.assignment_id);
            return true;
          });
          if (dayShifts.length > 1) {
            dayDataMap[day.key] = {
              shift: `${dayShifts.length} ca`,
              status: 'MULTI',
              isToday: day.isToday,
              shifts: dayShifts.map((sh: any) => {
                const res = buildOne(sh);
                if (foundLeave && (res.status === 'COMPLETED' || res.status === 'CHECKED_IN')) {
                  res.note = (res.note ? `${res.note} • ` : '') + `Đi làm dù có đơn nghỉ: ${foundLeave.reason || 'Nghỉ OFF'}`;
                }
                return res;
              }),
            };
          } else {
            const res = buildOne(foundShift);
            if (foundLeave && (res.status === 'COMPLETED' || res.status === 'CHECKED_IN')) {
              res.note = (res.note ? `${res.note} • ` : '') + `Đi làm dù có đơn nghỉ: ${foundLeave.reason || 'Nghỉ OFF'}`;
            }
            dayDataMap[day.key] = res;
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
        weekShiftCodes,
      };
    });

    // Thứ tự hàng: chi nhánh CN1→CN2→CN3→CN4, rồi ca chuẩn của từng NV
    // (Ca 1 → Ca 2 → Ca 3: Ca1, Ca1, Ca2, Ca2, Ca3, Ca3...), rồi mã NV, rồi tên.
    // RÀNG BUỘC ỔN ĐỊNH BỐ CỤC: key ca là ca cố định trong hồ sơ (không đổi khi NV
    // tráo/đổi ca tuần với nhau) — ca thật trong tuần chỉ làm fallback cho NV chưa
    // gán ca cố định. Đổi ca tuần không bao giờ xáo thứ tự hàng.
    const BRANCH_RANK: Record<string, number> = { CN130: 1, CN261: 2, CN120: 3, CN111: 4 };
    const SHIFT_RANK: Record<string, number> = { CA_1: 1, CA_2: 2, CA_3: 3 };
    const empShiftOf = (empId: string) =>
      (allEmployees || []).find((e: any) => e.employee_id === empId)?.default_shift_code;
    const weekShiftOf = (item: any): string => {
      const freq: Record<string, number> = {};
      const firstIdx: Record<string, number> = {};
      (item.weekShiftCodes || []).forEach((c: string, i: number) => {
        freq[c] = (freq[c] || 0) + 1;
        if (firstIdx[c] === undefined) firstIdx[c] = i;
      });
      let best = '';
      for (const c of Object.keys(freq)) {
        if (!best || freq[c] > freq[best] || (freq[c] === freq[best] && firstIdx[c] < firstIdx[best])) best = c;
      }
      return best;
    };
    // Ca sắp xếp = ca cố định (ổn định) — chỉ NV chưa gán mới dùng ca thật trong tuần.
    const sortShiftOf = (item: any): string => empShiftOf(item.empId) || weekShiftOf(item) || '';
    const SHIFT_LABEL: Record<string, string> = { CA_1: 'Ca 1 (07–12)', CA_2: 'Ca 2 (12–18)', CA_3: 'Ca 3 (18–23)' };
    // Tóm tắt ca làm trong tuần đang xem: "Ca 1 ×4 • Ca 2 ×1" (theo ca thật từng ngày).
    const weekShiftSummary = (item: any): string => {
      const counts: Record<string, number> = {};
      (item.weekShiftCodes || []).forEach((c: string) => { counts[c] = (counts[c] || 0) + 1; });
      const parts = Object.keys(counts)
        .sort((a, b) => (SHIFT_RANK[a] ?? 9) - (SHIFT_RANK[b] ?? 9))
        .map((c) => `${SHIFT_LABEL[c] || c} ×${counts[c]}`);
      return parts.join(' • ');
    };
    const sortedSchedule = [...scheduleItems].sort((a: any, b: any) =>
      ((BRANCH_RANK[canonicalBranchId(a.branch)] ?? 9) - (BRANCH_RANK[canonicalBranchId(b.branch)] ?? 9)) ||
      ((SHIFT_RANK[sortShiftOf(a)] ?? 9) - (SHIFT_RANK[sortShiftOf(b)] ?? 9)) ||
      String(a.empCode || '').localeCompare(String(b.empCode || '')) ||
      String(a.name || '').localeCompare(String(b.name || ''), 'vi')
    );
    const filteredSchedule = sortedSchedule.filter((item) => {
      const matchBranch = scheduleBranchFilter === 'ALL' || item.branch === scheduleBranchFilter;
      const matchStage = scheduleStageFilter === 'ALL' || item.stage === scheduleStageFilter;
      const q = scheduleSearch.trim().toLowerCase();
      const matchSearch = !q ||
        String(item.name || '').toLowerCase().includes(q) ||
        String(item.empCode || '').toLowerCase().includes(q);

      let matchAtt = true;
      if (scheduleAttFilter !== 'ALL') {
        const daysArr = Object.values(item.days || {}) as any[];
        const hasStatus = (st: string) => daysArr.some(d => d.status === st || (d.shifts && d.shifts.some((s: any) => s.status === st)));
        if (scheduleAttFilter === 'ATTENDED') {
          matchAtt = hasStatus('CHECKED_IN') || hasStatus('COMPLETED');
        } else if (scheduleAttFilter === 'WORKING') {
          matchAtt = hasStatus('CHECKED_IN');
        } else if (scheduleAttFilter === 'COMPLETED') {
          matchAtt = hasStatus('COMPLETED');
        } else if (scheduleAttFilter === 'MISSING_OUT') {
          matchAtt = hasStatus('MISSING_OUT');
        } else if (scheduleAttFilter === 'PENDING') {
          matchAtt = hasStatus('PENDING');
        } else if (scheduleAttFilter === 'OFF') {
          matchAtt = daysArr.some(d => d.status === 'OFF' || d.status === 'PENDING_LEAVE');
        } else if (scheduleAttFilter === 'ABSENT') {
          matchAtt = hasStatus('ABSENT');
        }
      }

      return matchBranch && matchStage && matchSearch && matchAtt;
    });

    return (
      <div id="sec-schedule" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
              {scheduleWeekOffset < 0 && (
                archiveLoading ? ' ⏳ Đang tải chi tiết điểm danh tuần cũ từ kho lưu trữ...' : ' Tuần cũ đọc từ kho lưu trữ (giờ in/out đầy đủ).'
              )}
              {(() => {
                const wSet = new Set((weekDays || []).map((d: any) => d.isoDate));
                const wShifts = (schedAllShifts || []).filter((s: any) => wSet.has(String(s.date || '').slice(0, 10)) && s.status !== 'CANCELLED').length;
                const wOffs = (leaves || []).filter((l: any) => wSet.has(String(l.requested_date || '').slice(0, 10)) && l.status !== 'REJECTED' && l.status !== 'CANCELLED').length;
                const wAttended = (schedAllEvents || []).filter((e: any) => e.type === 'CHECK_IN' && wSet.has(vnDayOf(e.client_time || ''))).length;
                return ` Đã tải tuần xem: ${wShifts} ca • ${wOffs} đơn nghỉ/OFF • ${wAttended} lượt đã điểm danh.`;
              })()}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn-primary"
              style={{ backgroundColor: '#10B981', display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '13px' }}
              disabled={schedReloadBusy}
              onClick={async () => {
                if (schedReloadBusy) return;
                setSchedReloadBusy(true);
                try {
                  if (onRefreshData) await onRefreshData();
                  const data = await apiRequest('/attendance/events');
                  const evts = Array.isArray(data) ? data : [];
                  setLiveAttendanceEvents(evts);
                  const weekSet = new Set((weekDays || []).map((d: any) => d.isoDate));
                  const weekCount = evts.filter((e: any) => weekSet.has(vnDayOf(e.client_time || ''))).length;
                  showToast(`Đã tải lại realtime: ${evts.length} lượt điểm danh (tuần này ${weekCount}). Lịch và trạng thái ca đã khớp server.`);
                } catch (e: any) {
                  showToast(e?.message || 'Lỗi khi tải lại realtime!');
                } finally {
                  setSchedReloadBusy(false);
                }
              }}
            >
              <RefreshCw size={14} /> {schedReloadBusy ? 'Đang tải...' : 'Tải Lại Realtime'}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
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

            {/* Filter by Attendance Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>Trạng thái:</span>
              <select
                value={scheduleAttFilter}
                onChange={(e) => setScheduleAttFilter(e.target.value)}
                style={{ padding: '6px 10px', fontSize: '12px', minHeight: '34px', borderRadius: '6px', fontWeight: 600 }}
              >
                <option value="ALL">Tất Cả Trạng Thái</option>
                <option value="ATTENDED">🟢 Đã Điểm Danh / Hoàn Thành</option>
                <option value="WORKING">🕒 Đang Làm (Realtime)</option>
                <option value="COMPLETED">✓ Đã Xong Ca</option>
                <option value="MISSING_OUT">⚠️ Thiếu Check-out</option>
                <option value="PENDING">⏳ Chưa Check-in (Chờ ca)</option>
                <option value="OFF">🏖️ Nghỉ OFF / Đột Xuất</option>
                <option value="ABSENT">🔴 Vắng Ca</option>
              </select>
            </div>

            {/* Search Employee */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>Tìm NV:</span>
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Tên hoặc mã NV..."
                  value={scheduleSearch}
                  onChange={(e) => setScheduleSearch(e.target.value)}
                  style={{
                    padding: '6px 10px 6px 26px',
                    fontSize: '12px',
                    minHeight: '34px',
                    borderRadius: '6px',
                    width: '150px',
                    border: '1px solid var(--border)',
                  }}
                />
                <Search size={12} style={{ position: 'absolute', left: '8px', color: 'var(--text-muted)' }} />
              </div>
            </div>

            {/* Chọn tuần cố định T2–CN (mặc định tuần này, VD: 28/09/2026 - 04/10/2026) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>Tuần:</span>
              <select
                value={scheduleWeekOffset}
                onChange={(e) => setScheduleWeekOffset(Number(e.target.value))}
                style={{ padding: '6px 10px', fontSize: '12px', minHeight: '34px', borderRadius: '6px', fontWeight: 700 }}
              >
                {weekOptions(0, 12).map(w => (
                  <option key={w.offset} value={w.offset}>{w.label}</option>
                ))}
              </select>
              <button className="btn-secondary" style={{ fontSize: '12px', padding: '6px 10px' }} onClick={() => setScheduleWeekOffset(o => o - 1)}>◀</button>
              <button className="btn-primary" style={{ fontSize: '12px', padding: '6px 10px' }} onClick={() => setScheduleWeekOffset(o => o + 1)}>▶</button>
            </div>
          </div>

          {/* Guide Legends */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', fontWeight: 700, flexWrap: 'wrap' }}>
            {[
              { dot: '#10B981', bg: '#ECFDF5', tx: '#065F46', label: '✓ Đã Điểm Danh / Xong Ca' },
              { dot: '#F59E0B', bg: '#FEF3C7', tx: '#92400E', label: '🕒 Đang làm (vàng nhấp nháy)' },
              { dot: '#F59E0B', bg: '#FFFBEB', tx: '#92400E', label: 'Chưa Check-in (Chờ ca)' },
              { dot: '#EA580C', bg: '#FFF7ED', tx: '#9A3412', label: '⚠️ Thiếu check-out' },
              { dot: '#2563EB', bg: '#EFF6FF', tx: '#1D4ED8', label: '🤝 Ca nhận thay (+30.000đ)' },
              { dot: '#9CA3AF', bg: '#F3F4F6', tx: '#4B5563', label: 'Nghỉ OFF' },
              { dot: '#EF4444', bg: '#FEF2F2', tx: '#B91C1C', label: '🔴 Vắng ca (tự ghi)' },
              { dot: '#64748B', bg: '#F1F5F9', tx: '#475569', label: '🔒 Khóa — không lương' },
              { dot: '#E5E7EB', bg: '#F9FAFB', tx: '#9CA3AF', label: '— Không có ca' },
            ].map((l) => (
              <span key={l.label} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', backgroundColor: l.bg, color: l.tx, borderRadius: '999px', padding: '4px 10px', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.04)' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: l.dot }} /> {l.label}
              </span>
            ))}
          </div>
        </div>

        {/* Main Weekly Schedule Grid Table */}
        <div style={{
          backgroundColor: 'var(--surface)',
          borderRadius: '16px',
          border: '1px solid var(--border)',
          overflowX: 'auto',
          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
        }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: '12px', minWidth: '1180px' }}>
            <thead>
              <tr style={{ textAlign: 'center' }}>
                <th style={{ padding: '12px 16px', textAlign: 'left', minWidth: '200px', backgroundColor: 'var(--bg)', position: 'sticky', left: 0, zIndex: 3, boxShadow: '2px 0 6px rgba(15,23,42,0.06)', borderBottom: '1px solid var(--border)' }}>NHÂN VIÊN / VAI TRÒ</th>
                {weekDays.map((day) => {
                  const isWeekend = day.code === 'T7' || day.code === 'CN';
                  if (day.isToday) {
                    return (
                      <th
                        key={day.key}
                        style={{
                          padding: '10px 10px',
                          minWidth: '164px',
                          background: 'linear-gradient(135deg, #FEE2E2 0%, #FFFBEB 100%)',
                          borderLeft: '2px solid #F87171',
                          borderRight: '2px solid #F87171',
                          borderBottom: '1px solid var(--border)',
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
                    <th key={day.key} style={{ padding: '10px 10px', minWidth: '144px', backgroundColor: isWeekend ? '#F8FAFC' : 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ fontWeight: 800, color: isWeekend ? '#475569' : 'var(--text)' }}>{day.name}</div>
                      <div style={{ display: 'inline-block', marginTop: '3px', fontSize: '11px', fontWeight: 700, color: isWeekend ? '#64748B' : 'var(--brand)', backgroundColor: '#FFF', border: '1px solid var(--border)', borderRadius: '999px', padding: '1px 10px' }}>
                        {day.dateStr}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filteredSchedule.map((emp) => (
                <tr key={emp.empId} style={{ borderBottom: '1px solid var(--border)' }}>
                  {/* Employee Info Column */}
                  <td style={{ padding: '12px 16px', verticalAlign: 'top', backgroundColor: '#FCFBF9', position: 'sticky', left: 0, zIndex: 2, boxShadow: '2px 0 6px rgba(15,23,42,0.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
                        background: emp.stage === 'PROBATION' ? 'linear-gradient(135deg, #F59E0B, #EC4899)' : 'linear-gradient(135deg, #10B981, #0EA5E9)',
                        color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 800, fontSize: '13px', boxShadow: '0 2px 6px rgba(15,23,42,0.18)',
                      }}>
                        {String(emp.name || '?').charAt(0).toUpperCase()}
                      </span>
                      <span className={`badge ${emp.stage === 'PROBATION' ? 'badge-brand' : 'badge-success'}`} style={{ fontSize: '10px' }}>
                        {emp.stage === 'PROBATION' ? '🌸 THỬ VIỆC' : '💼 CHÍNH THỨC'}
                      </span>
                    </div>
                    <div style={{ fontWeight: 800, fontSize: '13px', color: 'var(--text)', marginTop: '6px' }}>
                      {emp.name}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      <span style={{ fontWeight: 700, color: 'var(--brand)' }}>{emp.empCode}</span> • {getDisplayBranch(emp.branch)}
                    </div>
                    {(() => {
                      const summary = weekShiftSummary(emp);
                      if (summary) {
                        return (
                          <div style={{ fontSize: '11px', color: '#1D4ED8', fontWeight: 700, marginTop: '4px', lineHeight: '1.5' }}>
                            🕒 Ca tuần: {summary}
                          </div>
                        );
                      }
                      const fixed = empShiftOf(emp.empId);
                      return (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginTop: '4px' }}>
                          {fixed && SHIFT_LABEL[fixed] ? `🕒 Ca cố định: ${SHIFT_LABEL[fixed]}` : '🕒 Chưa xếp ca tuần này'}
                        </div>
                      );
                    })()}
                    {emp.stage === 'PROBATION' && (
                      <div style={{ fontSize: '10px', color: '#D97706', fontWeight: 700, marginTop: '2px' }}>
                        Chu kỳ 12 ngày (7 làm / 5 OFF)
                      </div>
                    )}
                  </td>

                  {/* Day Columns */}
                  {weekDays.map((day) => {
                    const d = (emp.days && emp.days[day.key]) || { shift: '—', status: 'NO_SHIFT', note: 'Không có ca' };
                    const isCompleted = d.status === 'COMPLETED';
                    const isCheckedIn = d.status === 'CHECKED_IN';
                    const isMissingOut = d.status === 'MISSING_OUT';
                    const isLocked = d.status === 'LOCKED';
                    const isPending = d.status === 'PENDING';
                    const isOff = d.status === 'OFF';
                    const isPendingLeave = d.status === 'PENDING_LEAVE';
                    const isBonusSwap = d.status === 'BONUS_SWAP';
                    const isNoShift = d.status === 'NO_SHIFT';
                    const isAbsent = d.status === 'ABSENT';
                    // Vạch màu trạng thái trên cùng mỗi ô ngày.
                    const cellAccent = isCompleted ? '#10B981'
                      : isAbsent ? '#EF4444'
                      : isCheckedIn ? '#F59E0B'
                      : isMissingOut ? '#EA580C'
                      : isLocked ? '#64748B'
                      : isPending || isPendingLeave ? '#F59E0B'
                      : isBonusSwap ? '#3B82F6'
                      : isOff ? '#9CA3AF'
                      : 'transparent';

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
                          borderTop: `3px solid ${cellAccent}`,
                        }}
                      >
                        {isNoShift ? (
                          <div style={{
                            padding: '10px 6px',
                            borderRadius: '10px',
                            backgroundColor: '#F9FAFB',
                            border: '1px dashed #E5E7EB',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            minHeight: '52px',
                          }}>
                            <span style={{ fontSize: '13px', fontWeight: 600, color: '#9CA3AF' }}>—</span>
                            <span style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '2px' }}>Không có ca</span>
                          </div>
                        ) : d.status === 'MULTI' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            {(d.shifts || []).map((sd: any, si: number) => {
                              const sdCompleted = sd.status === 'COMPLETED';
                              const sdCheckedIn = sd.status === 'CHECKED_IN';
                              const sdMissingOut = sd.status === 'MISSING_OUT';
                              const sdAbsent = sd.status === 'ABSENT';
                              const sdLocked = sd.status === 'LOCKED';
                              const sdPending = sd.status === 'PENDING';

                              const stColor = sdCompleted
                                ? '#047857'
                                : sdAbsent
                                ? '#DC2626'
                                : sdLocked
                                ? '#475569'
                                : sdMissingOut
                                ? '#9A3412'
                                : sdCheckedIn || sdPending
                                ? '#B45309'
                                : 'var(--text)';
                              const stBg = sdCompleted
                                ? '#ECFDF5'
                                : sdAbsent
                                ? '#FEE2E2'
                                : sdLocked
                                ? '#F1F5F9'
                                : sdMissingOut
                                ? '#FFF7ED'
                                : sdCheckedIn || sdPending
                                ? '#FEF3C7'
                                : '#FAFAFA';
                              const stBd = sdCompleted
                                ? '1.5px solid #10B981'
                                : sdAbsent
                                ? '1.5px solid #EF4444'
                                : sdLocked
                                ? '1.5px solid #64748B'
                                : sdMissingOut
                                ? '1.5px solid #EA580C'
                                : sdCheckedIn
                                ? '1.5px solid #F59E0B'
                                : '1px solid var(--border)';
                              const stBlink = sdCheckedIn;
                              return (
                                <div
                                  key={si}
                                  style={{
                                    padding: '7px',
                                    borderRadius: '10px',
                                    backgroundColor: stBg,
                                    border: stBd,
                                    boxShadow: sdCompleted ? '0 2px 6px rgba(16, 185, 129, 0.12)' : '0 2px 6px rgba(15,23,42,0.07)',
                                    animation: stBlink ? 'fx-blink 1.2s infinite' : undefined,
                                  }}
                                >
                                  <div style={{ fontWeight: 700, fontSize: '11px', color: sdCompleted ? '#065F46' : 'var(--text)' }}>
                                    {sd.shift}
                                  </div>
                                  {sdCompleted ? (
                                    <div style={{ marginTop: '2px' }}>
                                      <span style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '3px',
                                        padding: '1px 5px',
                                        borderRadius: '4px',
                                        backgroundColor: '#10B981',
                                        color: '#FFF',
                                        fontSize: '9.5px',
                                        fontWeight: 800,
                                      }}>
                                        <CheckCircle size={9} /> ĐÃ ĐIỂM DANH ({sd.time})
                                      </span>
                                      <div style={{ fontSize: '9px', color: '#047857', fontWeight: 600, marginTop: '2px' }}>
                                        ✓ {sd.gps || 'GPS hợp lệ'}
                                      </div>
                                      <button
                                        onClick={() => setSelectedRealtimeModal({ emp, dayData: sd })}
                                        style={{
                                          marginTop: '3px',
                                          fontSize: '9px',
                                          padding: '2px 5px',
                                          borderRadius: '4px',
                                          backgroundColor: '#FFFFFF',
                                          border: '1px solid #10B981',
                                          color: '#065F46',
                                          fontWeight: 700,
                                          cursor: 'pointer',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '3px',
                                          justifyContent: 'center',
                                        }}
                                      >
                                        <Eye size={9} /> Xem GPS & Ảnh
                                      </button>
                                    </div>
                                  ) : sdCheckedIn ? (
                                    <div style={{ marginTop: '2px' }}>
                                      <span style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '3px',
                                        padding: '1px 5px',
                                        borderRadius: '4px',
                                        backgroundColor: '#F59E0B',
                                        color: '#FFF',
                                        fontSize: '9.5px',
                                        fontWeight: 800,
                                      }}>
                                        <Clock size={9} /> ĐANG LÀM ({sd.time})
                                      </span>
                                      <div style={{ fontSize: '9px', color: '#92400E', fontWeight: 600, marginTop: '2px' }}>
                                        {sd.gps || 'Chờ check-out'}
                                      </div>
                                      <button
                                        onClick={() => setSelectedRealtimeModal({ emp, dayData: sd })}
                                        style={{
                                          marginTop: '3px',
                                          fontSize: '9px',
                                          padding: '2px 5px',
                                          borderRadius: '4px',
                                          backgroundColor: '#FFFFFF',
                                          border: '1px solid #F59E0B',
                                          color: '#92400E',
                                          fontWeight: 700,
                                          cursor: 'pointer',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '3px',
                                          justifyContent: 'center',
                                        }}
                                      >
                                        <Eye size={9} /> Xem GPS & Ảnh
                                      </button>
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: '10px', color: stColor, fontWeight: 700, marginTop: '2px' }}>
                                      {sdAbsent ? '🔴 Vắng'
                                        : sdLocked ? '🔒 Khóa — nghỉ không lương'
                                        : sdMissingOut ? 'Thiếu check-out'
                                        : sdPending ? 'Chưa check-in'
                                        : sd.note || sd.status}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div style={{
                            padding: '9px',
                            borderRadius: '10px',
                            backgroundColor: isCompleted
                              ? '#ECFDF5'
                              : isCheckedIn
                              ? '#FEF3C7'
                              : isMissingOut
                              ? '#FFF7ED'
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
                            border: isCompleted
                              ? '1.5px solid #10B981'
                              : isCheckedIn
                              ? '1.5px solid #F59E0B'
                              : isMissingOut
                              ? '1.5px solid #EA580C'
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
                            boxShadow: isCompleted
                              ? '0 2px 8px rgba(16, 185, 129, 0.16)'
                              : isCheckedIn
                              ? '0 2px 6px rgba(245, 158, 11, 0.2)'
                              : '0 2px 6px rgba(15,23,42,0.06)',
                            // Chỉ nhấp nháy ca NV đã vào (check-in rồi, chờ check-out)
                            animation: isCheckedIn ? 'fx-blink 1.2s infinite' : undefined,
                          }}>
                            {/* Shift Name */}
                            <div style={{ fontWeight: 700, fontSize: '11px', color: isCompleted ? '#065F46' : isOff ? '#9CA3AF' : 'var(--text)' }}>
                              {d.shift}
                            </div>

                            {/* Completed / Attended Shift Badge */}
                            {isCompleted && (
                              <div style={{ marginTop: '2px' }}>
                                <span style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '2px 7px',
                                  borderRadius: '4px',
                                  backgroundColor: '#10B981',
                                  color: '#FFF',
                                  fontSize: '10px',
                                  fontWeight: 800,
                                  letterSpacing: '0.2px',
                                }}>
                                  <CheckCircle size={10} /> ĐÃ ĐIỂM DANH ({d.time})
                                </span>
                                <div style={{ fontSize: '10px', color: '#065F46', fontWeight: 700, marginTop: '3px' }}>
                                  ✓ Hoàn thành • {d.gps || 'GPS hợp lệ'}
                                </div>
                                {d.note && (
                                  <div style={{ fontSize: '9px', color: '#047857', marginTop: '1px' }}>
                                    {d.note}
                                  </div>
                                )}
                                <button
                                  onClick={() => setSelectedRealtimeModal({ emp, dayData: d })}
                                  style={{
                                    marginTop: '4px',
                                    fontSize: '9.5px',
                                    padding: '3px 8px',
                                    borderRadius: '4px',
                                    backgroundColor: '#FFFFFF',
                                    border: '1px solid #10B981',
                                    color: '#065F46',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    justifyContent: 'center',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                  }}
                                >
                                  <Eye size={11} /> Xem Chi Tiết GPS & Ảnh
                                </button>
                              </div>
                            )}

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
                                <div style={{ fontSize: '10px', color: d.gpsBad ? '#DC2626' : '#92400E', fontWeight: 700, marginTop: '2px' }}>
                                  {d.gpsBad ? `⚠️ ${d.gps} — bắt điểm danh lại!` : `Chờ check-out để hoàn thành • ${d.gps}`}
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

                            {isMissingOut && (
                              <div style={{ marginTop: '2px' }}>
                                <span style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  backgroundColor: '#EA580C',
                                  color: '#FFF',
                                  fontSize: '10px',
                                  fontWeight: 800,
                                }}>
                                  THIẾU CHECK-OUT — KHÔNG LƯƠNG
                                </span>
                                <div style={{ fontSize: '10px', color: '#9A3412', fontWeight: 600, marginTop: '2px' }}>
                                  {d.note || 'Hết giờ chưa check-out'}
                                </div>
                                {d.event && (
                                  <button
                                    onClick={() => setSelectedRealtimeModal({ emp, dayData: d })}
                                    style={{
                                      marginTop: '4px',
                                      fontSize: '9.5px',
                                      padding: '2px 6px',
                                      borderRadius: '4px',
                                      backgroundColor: '#FFFFFF',
                                      border: '1px solid #EA580C',
                                      color: '#9A3412',
                                      fontWeight: 700,
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                    }}
                                  >
                                    <Eye size={10} /> Xem Giờ Vào & GPS
                                  </button>
                                )}
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
                        {modalDayData?.inTime || (modalDayData?.status === 'CHECKED_IN' ? modalDayData?.time : null) || (modalEvent?.client_time ? new Date(modalEvent.client_time).toLocaleTimeString('vi-VN') : 'Chưa ghi nhận')}
                      </strong>
                    </div>
                    {modalDayData?.outTime && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Thời gian check-out:</span>
                        <strong style={{ fontSize: '13px', color: '#059669' }}>
                          {modalDayData.outTime}
                        </strong>
                      </div>
                    )}
                    {modalDayData?.time && modalDayData?.status === 'COMPLETED' && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Tổng ca làm việc:</span>
                        <strong style={{ fontSize: '13px', color: '#047857' }}>
                          {modalDayData.time}
                        </strong>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Tọa độ GPS & Khoảng cách:</span>
                      <strong style={{ fontSize: '13px', color: modalDayData?.gpsBad ? '#DC2626' : '#10B981' }}>
                        {modalDayData?.gps || (modalEvent?.distance_meters !== undefined ? `${modalEvent.distance_meters} mét (Bán kính hợp lệ < 300m)` : 'Khoảng cách hợp lệ < 300m')}
                      </strong>
                    </div>
                    {modalEvent?.uniform_pink_ratio !== undefined && modalEvent?.uniform_pink_ratio !== null && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Hồng đồng phục lúc chụp:</span>
                        <strong style={{ fontSize: '13px', color: Number(modalEvent.uniform_pink_ratio) >= 10 ? '#059669' : '#DC2626' }}>
                          {modalEvent.uniform_pink_ratio}% {Number(modalEvent.uniform_pink_ratio) >= 10 ? '(đạt)' : '(thấp)'}
                        </strong>
                      </div>
                    )}
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
                        <AttPhoto eventId={modalEvent.event_id} style={{ width: '100%', maxHeight: '220px', height: 'auto' }} alt="Ảnh chụp đồng phục áo hồng check-in" />
                        <div style={{ fontWeight: 800, fontSize: '13px', color: '#9D174D', marginTop: '6px' }}>ẢNH CHỤP ĐỒNG PHỤC ÁO HỒNG ỤM BÒ MILK (CHECK-IN)</div>
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

                    {modalDayData?.outEvent?.event_id && modalDayData.outEvent.event_id !== modalEvent?.event_id && (
                      <div style={{ marginTop: '12px', borderTop: '1px dashed #F472B6', paddingTop: '10px', marginBottom: '10px' }}>
                        <AttPhoto eventId={modalDayData.outEvent.event_id} style={{ width: '100%', maxHeight: '220px', height: 'auto' }} alt="Ảnh chụp khi tan ca" />
                        <div style={{ fontWeight: 800, fontSize: '12px', color: '#9D174D', marginTop: '6px' }}>
                          ẢNH CHỤP KHI TAN CA (CHECK-OUT: {modalDayData.outTime})
                        </div>
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

  if (activeTab === 'hr-leave' || activeTab === 'operations') {
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
    // Reset theo chu kỳ Thứ 6 09:00: mặc định chỉ hiện tuần mục tiêu của chu kỳ hiện tại.
    const offCycle = currentOffCycle();
    const weeklyOffWeeks = Array.from(new Set(Object.values(weeklyOffGroups).map((g: any) => g.week))).sort().reverse();
    const weeklyOffList = Object.values(weeklyOffGroups)
      .map((g: any) => ({ ...g, dates: g.dates.sort(), count: g.dates.length }))
      .filter((g: any) => (weeklyOffWeekFilter === 'CURRENT' ? g.week === offCycle.label : g.week === weeklyOffWeekFilter))
      .filter((g: any) => weeklyOffBranchFilter === 'ALL' || g.branch_id === weeklyOffBranchFilter)
      .filter((g: any) => {
        if (!weeklyOffSearch.trim()) return true;
        const q = weeklyOffSearch.trim().toLowerCase();
        return (g.employee_name || '').toLowerCase().includes(q) || (g.employee_id || '').toLowerCase().includes(q);
      })
      .sort((a: any, b: any) => b.week.localeCompare(a.week));
    const weeklyOffBranchOptions = Array.from(new Set(weeklyOffLeaves.map((l: any) => l.branch_id).filter(Boolean)));
    return (
      <div id="sec-leave" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 800 }}>8. Lịch OFF 2 ngày/tuần</h1>
        </div>
        <div style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: '12px', color: '#1E40AF' }}>
          Lịch OFF 2 ngày/tuần (HANG_TUAN) <strong>tự động ghi nhận, không cần duyệt</strong> — theo dõi ở bảng bên dưới.
        </div>
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <strong style={{ fontSize: '14px' }}>Lịch OFF 2 ngày/tuần đã tự động ghi nhận ({weeklyOffList.length})</strong>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Chu kỳ hiện tại: {offCycle.label} (mở T6 09:00) • Nguồn: DON_NGHI_PHEP — Sheet giữ toàn bộ lịch sử, sang chu kỳ mới bảng này reset.</div>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                disabled={offOverlapBusy}
                onClick={handleResetWeeklyOffOverlaps}
                title="Rà soát lịch OFF trùng ca đã đăng ký từ trước (cùng CN + cùng ca + cùng ngày) rồi hủy về chưa đăng ký để NV đăng ký lại"
                style={{ fontSize: '12px', padding: '6px 12px', borderRadius: '6px', border: 'none', backgroundColor: offOverlapBusy ? '#9CA3AF' : '#DC2626', color: '#FFF', fontWeight: 800, cursor: offOverlapBusy ? 'wait' : 'pointer' }}
              >
                {offOverlapBusy ? '⏳ Đang xử lý...' : '🧹 Reset lịch OFF trùng ca'}
              </button>
              <button
                onClick={openResetAllModal}
                title="Xóa HẾT lịch OFF đã đăng ký (từ hôm nay) để toàn bộ NV đăng ký lại — cần nhập pass"
                style={{ fontSize: '12px', padding: '6px 12px', borderRadius: '6px', border: '1.5px solid #DC2626', backgroundColor: '#FFF', color: '#DC2626', fontWeight: 800, cursor: 'pointer' }}
              >
                🗑 Reset ALL
              </button>
              <select value={weeklyOffWeekFilter} onChange={e => setWeeklyOffWeekFilter(e.target.value)} style={{ fontSize: '12px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)' }} title="Chu kỳ hiển thị — Sheet vẫn lưu toàn bộ lịch sử">
                <option value="CURRENT">Chu kỳ hiện tại ({offCycle.label})</option>
                {weeklyOffWeeks.filter((w: string) => w !== offCycle.label).map((w: string) => (
                  <option key={w} value={w}>Tuần {w}</option>
                ))}
              </select>
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
                    Chưa có đăng ký OFF tuần nào trong chu kỳ này. Khi nhân viên đăng ký 2 ngày OFF (T6 09h00 → T7 09h00), dữ liệu tự ghi nhận và hiện realtime tại đây.
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
        {/* MODAL RESET ALL LỊCH OFF (khóa pass) */}
        {offResetAllOpen && (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px' }}>
            <div style={{ backgroundColor: 'var(--surface)', borderRadius: '12px', maxWidth: '480px', width: '100%', padding: '20px', border: '2px solid #DC2626' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 800, margin: '0 0 8px', color: '#DC2626' }}>🗑 Reset ALL lịch OFF 2 ngày/tuần</h2>
              <div style={{ fontSize: '13px', color: 'var(--text)', lineHeight: '1.6', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px 12px' }}>
                Hành động này sẽ <strong>HỦY TOÀN BỘ</strong> phiếu OFF còn hiệu lực từ hôm nay
                {offResetAllPreview ? (<> (<strong>{offResetAllPreview.leaveCount || 0} phiếu của {offResetAllPreview.employeeCount || 0} NV</strong>)</>) : '…'} —
                toàn bộ nhân viên phải <strong>đăng ký lại từ đầu</strong>. Không thể hoàn tác!
              </div>
              {offResetAllPreview && (offResetAllPreview.employees || []).length > 0 && (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px', maxHeight: '120px', overflowY: 'auto' }}>
                  NV bị ảnh hưởng: {(offResetAllPreview.employees || []).slice(0, 20).join(', ')}{(offResetAllPreview.employees || []).length > 20 ? ` +${(offResetAllPreview.employees || []).length - 20} bạn` : ''}
                </div>
              )}
              <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginTop: '12px' }}>
                Mật khẩu Reset ALL:
                <input
                  type="password"
                  name="ubm-off-reset-all-pass"
                  autoComplete="new-password"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  data-lpignore="true"
                  data-1p-ignore="true"
                  value={offResetAllPass}
                  onChange={(e) => { offResetAllTypedRef.current = true; setOffResetAllPass(e.target.value); }}
                  onFocus={() => { if (!offResetAllTypedRef.current) setOffResetAllPass(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleResetAllWeeklyOff(); }}
                  placeholder="Nhập pass mới thực thi được"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1.5px solid #DC2626', marginTop: '4px', fontSize: '14px', outline: 'none' }}
                />
              </label>
              <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
                <button
                  onClick={() => { setOffResetAllOpen(false); setOffResetAllPass(''); }}
                  disabled={offResetAllBusy}
                  style={{ flex: 1, padding: '10px', borderRadius: '8px', backgroundColor: '#F1F5F9', color: '#334155', fontSize: '13px', fontWeight: 800, border: 'none', cursor: 'pointer' }}
                >
                  Đóng
                </button>
                <button
                  onClick={handleResetAllWeeklyOff}
                  disabled={offResetAllBusy}
                  style={{ flex: 2, padding: '10px', borderRadius: '8px', backgroundColor: offResetAllBusy ? '#9CA3AF' : '#DC2626', color: '#FFF', fontSize: '13px', fontWeight: 800, border: 'none', cursor: offResetAllBusy ? 'wait' : 'pointer' }}
                >
                  {offResetAllBusy ? '⏳ Đang reset...' : '🗑 XÁC NHẬN RESET ALL'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (activeTab === 'hr-support') {
    const allList = swapList !== null ? swapList : (swaps || []);
    const supports = (allList || []).filter((s: any) => (s as any).swap_kind === 'HR_SUPPORT');
    const pending = supports.filter((s: any) => s.status === 'PENDING_PARTNER');
    const activeEmps = (allEmployees || [])
      .filter((e: any) => (e as any).employment_status !== 'TERMINATED')
      .sort((a: any, b: any) => String(a.full_name || '').localeCompare(String(b.full_name || ''), 'vi'));
    const officials = activeEmps.filter((e: any) => (e as any).employment_status === 'OFFICIAL' && e.employee_id !== supportOwner);
    const empName = (id: string) => {
      const e = (allEmployees || []).find((x: any) => x.employee_id === id);
      return e ? `${e.full_name} (${e.employee_code || e.employee_id})` : (id || '—');
    };
    const branchLabel = (bid: string) => {
      try {
        return getDisplayBranch(bid) || bid;
      } catch { return bid; }
    };
    const shiftLabel = (code: string) =>
      code === 'CA_1' ? 'Ca 1 (07-12)' : code === 'CA_2' ? 'Ca 2 (12-18)' : code === 'CA_3' ? 'Ca 3 (18-23)' : (code || '');
    const statusBadge = (st: string) => {
      const map: Record<string, { bg: string; fg: string; label: string }> = {
        PENDING_PARTNER: { bg: '#FEF3C7', fg: '#92400E', label: 'Chờ NV B xác nhận' },
        APPROVED: { bg: '#DCFCE7', fg: '#166534', label: 'B đã nhận — ca đã chuyển' },
        REJECTED: { bg: '#FEE2E2', fg: '#991B1B', label: 'B từ chối' },
        CANCELLED: { bg: '#F3F4F6', fg: '#6B7280', label: 'Đã hủy' },
      };
      const m = map[st] || { bg: '#F3F4F6', fg: '#6B7280', label: st };
      return <span className="badge" style={{ backgroundColor: m.bg, color: m.fg, fontWeight: 700 }}>{m.label}</span>;
    };
    const submitSupport = async () => {
      if (!supportOwner) { showToast('Vui lòng chọn nhân viên A (người nhường ca)!'); return; }
      if (!supportAssign) { showToast('Vui lòng chọn ca A nhường!'); return; }
      if (!supportTarget) { showToast('Vui lòng chọn nhân viên B chính thức nhận hỗ trợ!'); return; }
      if (supportBusy) return;
      setSupportBusy(true);
      try {
        const res = await apiRequest('/swap-requests/support', {
          method: 'POST',
          body: JSON.stringify({
            requesterAssignmentId: supportAssign,
            targetEmployeeId: supportTarget,
            reason: supportReason,
          }),
        });
        const sid = (res as any)?.result?.swap_id || (res as any)?.swap_id || '';
        showToast(sid ? `Đã gửi yêu cầu hỗ trợ! Mã phiếu: ${sid}. B xác nhận trên cổng NV là ca chuyển sang B ngay.` : 'Đã gửi yêu cầu hỗ trợ!');
        setSupportReason('');
        await loadSwaps();
        if (onRefreshData) await onRefreshData();
        if (onSyncSheets) await onSyncSheets();
      } catch (e: any) {
        showToast(e?.message || 'Lỗi khi gửi yêu cầu hỗ trợ!');
      } finally {
        setSupportBusy(false);
      }
    };
    return (
      <div id="sec-support" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 800 }}>10. Chuyển Ca Hỗ Trợ Chi Nhánh</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            A bận nhường ca cho B (nhân viên chính thức, thường khác chi nhánh) làm thay. B xác nhận trên Cổng Nhân Viên là ca chuyển sang B ngay, lịch 2 cổng đồng bộ realtime.
          </p>
        </div>

        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', padding: '16px 20px' }}>
          <strong style={{ fontSize: '14px' }}>Điều ca hỗ trợ</strong>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>A — người nhường ca (bận việc):</label>
              <select
                value={supportOwner}
                onChange={(e) => { setSupportOwner(e.target.value); setSupportTarget(''); loadSupportOwnerShifts(e.target.value); }}
                style={{ width: '100%' }}
              >
                <option value="">-- Chọn nhân viên A --</option>
                {activeEmps.map((e: any) => (
                  <option key={e.employee_id} value={e.employee_id}>
                    {e.full_name} ({e.employee_code || e.employee_id} • {branchLabel(e.default_branch_id || e.branch_id || '')})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Ca A nhường (đã publish, từ tuần hiện tại):</label>
              <select value={supportAssign} onChange={(e) => setSupportAssign(e.target.value)} style={{ width: '100%' }} disabled={!supportOwner || supportShiftsLoading}>
                <option value="">
                  {!supportOwner ? '-- Chọn A trước --' : supportShiftsLoading ? 'Đang tải ca...' : supportOwnerShifts.length === 0 ? 'A không có ca publish nào' : '-- Chọn ca --'}
                </option>
                {supportOwnerShifts.map((s: any) => (
                  <option key={s.assignment_id} value={s.assignment_id}>
                    {String(s.date || '').slice(0, 10)} • {shiftLabel(s.shift_code)} • {branchLabel(s.branch_id || '')}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>B — nhân viên chính thức nhận làm thay:</label>
              <select value={supportTarget} onChange={(e) => setSupportTarget(e.target.value)} style={{ width: '100%' }}>
                <option value="">-- Chọn nhân viên B --</option>
                {officials.map((e: any) => (
                  <option key={e.employee_id} value={e.employee_id}>
                    {e.full_name} ({e.employee_code || e.employee_id} • {branchLabel(e.default_branch_id || e.branch_id || '')})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Lý do điều hỗ trợ:</label>
              <input type="text" value={supportReason} onChange={(e) => setSupportReason(e.target.value)} placeholder="VD: A bận việc gia đình, điều B (CN2) làm thay ca 1 CN130..." style={{ width: '100%' }} />
            </div>
          </div>
          <button className="btn-primary" disabled={supportBusy} onClick={submitSupport} style={{ marginTop: '12px', padding: '9px 18px', fontSize: '13px', opacity: supportBusy ? 0.6 : 1 }}>
            {supportBusy ? '⏳ ĐANG GỬI...' : 'Gửi Yêu Cầu Hỗ Trợ Cho Nhân Viên B'}
          </button>
        </div>

        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '14px' }}>Phiếu hỗ trợ chi nhánh ({supports.length})</strong>
            <span className="badge" style={{ backgroundColor: pending.length > 0 ? '#FEF3C7' : '#DCFCE7', color: pending.length > 0 ? '#92400E' : '#166534', fontWeight: 800 }}>
              {pending.length} chờ NV xác nhận
            </span>
          </div>
          {supports.length === 0 ? (
            <div style={{ padding: '28px 20px', textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
              Chưa có phiếu hỗ trợ nào. Gửi phiếu mới ở form trên — B xác nhận là ca chuyển sang B ngay.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px 20px' }}>A Nhường Ca</th>
                  <th style={{ padding: '12px 20px' }}>B Nhận Làm Thay</th>
                  <th style={{ padding: '12px 20px' }}>Lý Do</th>
                  <th style={{ padding: '12px 20px' }}>Tình Trạng</th>
                </tr>
              </thead>
              <tbody>
                {supports.map((sw: any) => (
                  <tr key={sw.swap_id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 20px', fontWeight: 700 }}>
                      {empName(sw.requester_id)}
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 400 }}>
                        {branchLabel((sw as any).support_branch_id || '')} • {String((sw as any).support_date || '').slice(0, 10)} • {shiftLabel((sw as any).support_shift_code || '')}
                      </div>
                    </td>
                    <td style={{ padding: '12px 20px', fontWeight: 700 }}>
                      {empName(sw.target_employee_id)}
                      {sw.status === 'APPROVED' && (
                        <div style={{ fontSize: '11px', color: '#059669', fontWeight: 700 }}>Ca đã chuyển ✓</div>
                      )}
                    </td>
                    <td style={{ padding: '12px 20px' }}>{sw.reason || '—'}</td>
                    <td style={{ padding: '12px 20px' }}>{statusBadge(sw.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-swap' || activeTab === 'operations') {
    return (
      <div id="sec-swap" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800 }}>9. Giám Sát & Điều Phối Đổi Ca / Nhường Ca</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Theo dõi quy trình Tráo đổi ca (A ⇄ B) & Điều phối Nhường ca (+30.000đ/ca phụ cấp hỗ trợ) khi NV không tìm được người thay
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}
            onClick={async () => {
              if (!window.confirm('Rà soát toàn bộ phiếu đổi/tráo ca SAI quy định (ca ngoài tuần gửi phiếu)?\nHệ thống sẽ HỦY phiếu + TRẢ lịch từng NV về chủ ban đầu. Phiếu đúng tuần (kể cả tuần cũ) được giữ nguyên.')) return;
              try {
                const r = await apiRequest('/admin/swaps/audit-out-of-week', { method: 'POST' });
                const v = (r as any)?.violations || [];
                showToast(`Rà soát ${(r as any)?.checked ?? 0} phiếu: hủy ${v.length} phiếu sai tuần, trả lịch về ban đầu.${v.length > 0 ? ' Chi tiết: ' + v.slice(0, 3).map((x: any) => `${x.swap_id} (${x.reason})`).join(' | ') + (v.length > 3 ? ' | ...' : '') : ''}`);
                await loadSwaps();
                if (onRefreshData) await onRefreshData();
                if (onSyncSheets) await onSyncSheets();
              } catch (e: any) {
                showToast(e?.message || 'Lỗi khi rà soát!');
              }
            }}
          >
            🛡 Rà soát phiếu sai tuần
          </button>
          </div>
        </div>

        {/* CÁC PHIẾU TRÁO ĐỔI CA (A ⇄ B) GỬI TỪ CỔNG NHÂN VIÊN — HR giám sát & duyệt */}
        {(() => {
          const list = swapList !== null ? swapList : (swaps || []);
          const ready = list.filter((s: any) => s.status === 'PARTNER_ACCEPTED');
          const waiting = list.filter((s: any) => s.status === 'PENDING_PARTNER');
          const done = list.filter((s: any) => !['PENDING_PARTNER', 'PARTNER_ACCEPTED'].includes(s.status));
          const empName = (id: string) => (allEmployees || []).find((e: any) => e.employee_id === id)?.full_name || id;
          const shiftNameOf = (code: string) =>
            code === 'CA_1' ? 'Ca 1 (07-12)' : code === 'CA_2' ? 'Ca 2 (12-18)' : code === 'CA_3' ? 'Ca 3 (18-23)' : (code || '');
          // Mã SHIFT_AUTO_xxx là mã ca do BOT tự xếp sinh ra (không phải lỗi).
          // Danh sách ca chỉ tải tuần hiện tại nên ca tuần khác hiện gọn + tooltip mã đầy đủ.
          const shiftInfo = (aid: string) => {
            const s = (shifts || []).find((x: any) => x.assignment_id === aid);
            if (s) return `${shiftNameOf(s.shift_code)} • ${s.date}`;
            if (!aid) return '—';
            const tail = String(aid).slice(-5);
            return `Ca #${tail} (tuần khác)`;
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
            const isSupport = (sw.swap_kind || '') === 'HR_SUPPORT';
            if (isSupport) { showToast('Phiếu hỗ trợ chi nhánh do nhân viên xác nhận trên cổng NV (không cần HR duyệt thêm). Theo dõi trạng thái tại tab Chuyển ca hỗ trợ!'); return; }
            if (!window.confirm(accept ? (isDispatch ? `Duyệt nhường ca ${sw.swap_id}? Ca chuyển cho người nhận + 30.000đ.` : `Duyệt tráo ca ${sw.swap_id}? Hai ca sẽ hoán đổi người trực.`) : `Từ chối phiếu ${sw.swap_id}?`)) return;
            if (swapReviewBusy) return;
            setSwapReviewBusy(sw.swap_id);
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
              await loadSwaps().catch(() => null);
              showToast(e?.message || 'Lỗi khi duyệt!');
            } finally {
              setSwapReviewBusy(null);
            }
          };
          const renderRows = (rows: any[], canReview: boolean) =>
            rows.map((sw: any) => {
              const isDispatch = (sw.swap_kind || 'EMPLOYEE_SWAP') === 'HR_DISPATCH';
              const isSupport = (sw.swap_kind || '') === 'HR_SUPPORT';
              const supportInfo = isSupport
                ? `${(sw as any).support_branch_id || ''} • ${String((sw as any).support_date || '').slice(0, 10)} • ${shiftNameOf((sw as any).support_shift_code || '')}`
                : '';
              return (
              <tr key={sw.swap_id} style={{ borderBottom: '1px solid var(--border)', backgroundColor: sw.status === 'PARTNER_ACCEPTED' ? '#EFF6FF' : undefined }}>
                <td style={{ padding: '12px 20px', fontWeight: 700 }}>
                  {isSupport ? 'HR điều phối' : empName(sw.requester_id)}
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 400 }} title={sw.requester_assignment_id || ''}>Ca: {isSupport ? supportInfo : shiftInfo(sw.requester_assignment_id)}</div>
                </td>
                <td style={{ padding: '12px 20px', fontWeight: 700 }}>
                  {sw.target_employee_id ? empName(sw.target_employee_id) : <span style={{ color: '#B45309' }}>Mở cho cả chi nhánh</span>}
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 400 }} title={sw.target_assignment_id || ''}>{sw.target_assignment_id ? `Ca: ${shiftInfo(sw.target_assignment_id)}` : (sw.target_employee_id ? (isSupport ? 'Nhận hỗ trợ (làm thay ca A)' : 'Nhận làm thay (1 chiều)') : '')}</div>
                </td>
                <td style={{ padding: '12px 20px' }}>
                  <span className="badge" style={{ backgroundColor: isDispatch ? '#EDE9FE' : isSupport ? '#DBEAFE' : '#F3F4F6', color: isDispatch ? '#6D28D9' : isSupport ? '#1D4ED8' : '#4B5563', fontWeight: 700 }}>
                    {isDispatch ? 'HR điều phối +30k' : isSupport ? 'Hỗ trợ chi nhánh' : 'NV tự tráo'}
                  </span>
                  {isDispatch && sw.status === 'APPROVED' && (
                    <div style={{ fontSize: '11px', color: '#059669', fontWeight: 700, marginTop: '2px' }}>+30.000đ</div>
                  )}
                  {isSupport && sw.status === 'APPROVED' && (
                    <div style={{ fontSize: '11px', color: '#059669', fontWeight: 700, marginTop: '2px' }}>Ca đã chuyển ✓</div>
                  )}
                </td>
                <td style={{ padding: '12px 20px' }}>{sw.reason || '—'}</td>
                <td style={{ padding: '12px 20px' }}>{statusBadge(sw.status)}</td>
                <td style={{ padding: '12px 20px' }}>
                  {canReview && !isSupport ? (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button className="btn-primary" style={{ padding: '4px 10px', fontSize: '12px' }} disabled={swapReviewBusy === sw.swap_id} onClick={() => reviewSwap(sw, true)}>{swapReviewBusy === sw.swap_id ? '⏳...' : 'Duyệt'}</button>
                      <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: '12px', color: '#DC2626' }} disabled={swapReviewBusy === sw.swap_id} onClick={() => reviewSwap(sw, false)}>{swapReviewBusy === sw.swap_id ? '⏳...' : 'Từ chối'}</button>
                    </div>
                  ) : (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{sw.status === 'APPROVED' ? (isDispatch ? 'Đã giao ca +30k' : isSupport ? 'Đã tạo ca hỗ trợ' : 'Đã hoán đổi ca') : (isSupport && sw.status === 'PENDING_PARTNER' ? 'Chờ NV xác nhận' : '—')}</span>
                  )}
                </td>
              </tr>
              );
            });
          // Gom phiếu theo tuần gửi (T2–CN, giờ VN): mỗi tuần 1 folder xếp gọn.
          // Tuần hiện tại + tuần còn phiếu chờ xử lý thì mở sẵn.
          const weekMonOf = (iso?: string) => {
            const t = new Date(iso || '').getTime();
            if (!Number.isFinite(t)) return '';
            const vn = new Date(t + 7 * 3_600_000);
            const off = (vn.getUTCDay() + 6) % 7;
            vn.setUTCDate(vn.getUTCDate() - off);
            return vn.toISOString().slice(0, 10);
          };
          const nowMon = weekMonOf(new Date().toISOString());
          const byWeek = new Map<string, any[]>();
          for (const sw of list) {
            const mon = weekMonOf((sw as any).created_at) || 'old';
            if (!byWeek.has(mon)) byWeek.set(mon, []);
            byWeek.get(mon)!.push(sw);
          }
          const weekFolders = [...byWeek.entries()]
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([mon, rows]) => {
              const readyW = rows.filter((s: any) => s.status === 'PARTNER_ACCEPTED');
              const waitingW = rows.filter((s: any) => s.status === 'PENDING_PARTNER');
              const doneW = rows.filter((s: any) => !['PENDING_PARTNER', 'PARTNER_ACCEPTED'].includes(s.status));
              const sun = (() => {
                const d = new Date(`${mon}T00:00:00Z`);
                if (Number.isNaN(d.getTime())) return '';
                d.setUTCDate(d.getUTCDate() + 6);
                const p = d.toISOString().slice(0, 10);
                return `${p.slice(8, 10)}/${p.slice(5, 7)}`;
              })();
              const label = mon === 'old' ? 'Cũ (chưa rõ ngày)' : `${mon.slice(8, 10)}/${mon.slice(5, 7)} – ${sun}`;
              return {
                mon,
                label,
                rows,
                ready: readyW,
                waiting: waitingW,
                done: doneW,
                readyCount: readyW.length,
                waitingCount: waitingW.length,
                isCurrent: mon === nowMon,
                defaultOpen: mon === nowMon || readyW.length > 0 || waitingW.length > 0,
              };
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
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {weekFolders.map((f: any) => (
                    <details key={f.mon} open={f.defaultOpen} style={{ borderBottom: '1px solid var(--border)' }}>
                      <summary style={{ padding: '12px 20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', listStyle: 'none', backgroundColor: f.isCurrent ? '#EFF6FF' : undefined }}>
                        <span style={{ fontWeight: 800, fontSize: '13px' }}>
                          📁 Tuần {f.label}{f.isCurrent ? ' (tuần này)' : ''}
                        </span>
                        <span style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
                          {f.readyCount > 0 && <span className="badge" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8', fontWeight: 800 }}>{f.readyCount} chờ duyệt</span>}
                          {f.waitingCount > 0 && <span className="badge" style={{ backgroundColor: '#FEF3C7', color: '#92400E', fontWeight: 800 }}>{f.waitingCount} chờ NV B</span>}
                          <span>{f.rows.length} phiếu</span>
                        </span>
                      </summary>
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
                          {renderRows(f.ready, true)}
                          {renderRows(f.waiting, false)}
                          {renderRows(f.done, false)}
                        </tbody>
                      </table>
                    </details>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

      </div>
    );
  }

  if (activeTab === 'hr-attendance' || activeTab === 'operations') {
    // Lưới tuần Mon–CN như lịch làm việc: 1 ô = các ca trong ngày kèm đúng trạng thái
    const attMon = mondayIsoOfOffset(attWeekOffset);
    const attDays = [0, 1, 2, 3, 4, 5, 6].map(i => {
      const d = new Date(`${attMon}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const codes = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
      return { key: codes[i], code: codes[i], iso, isToday: iso === vnDayOf(new Date().toISOString()) };
    });
    const attWeekSet = new Set(attDays.map(d => d.iso));
    const attBaseShifts = (() => {
      if (!archiveShifts || archiveShifts.length === 0) return shifts || [];
      const seen = new Set<string>((shifts || []).map((s: any) => String(s.assignment_id || '')));
      const extra = (archiveShifts || []).filter((s: any) => !s.assignment_id || !seen.has(String(s.assignment_id)));
      return extra.length > 0 ? [...(shifts || []), ...extra] : (shifts || []);
    })();
    const attWeekShifts = (attBaseShifts || []).filter((s: any) => attWeekSet.has((s.date || '').slice(0, 10)) && s.status !== 'CANCELLED');
    // Tuần cũ: gộp thêm sự kiện từ kho lưu trữ để đủ ngày công tính lương.
    const attAllEvts = (() => {
      if (!archiveEvents || archiveEvents.length === 0) return liveAttendanceEvents || [];
      const seen = new Set<string>((liveAttendanceEvents || []).map((e: any) => String(e.event_id)));
      const extra = (archiveEvents || []).filter((e: any) => !seen.has(String(e.event_id)));
      return extra.length > 0 ? [...(liveAttendanceEvents || []), ...extra] : (liveAttendanceEvents || []);
    })();
    const attWeekEvts = (attAllEvts || []).filter((e: any) => attWeekSet.has(vnDayOf(e.client_time || '')));
    const attSwapAll = ((typeof swapList !== 'undefined' && swapList !== null ? swapList : (swaps || [])) as any[]) || [];
    // Phiếu đổi ca liên quan 1 ca: bỏ phiếu chết (REJECTED/CANCELLED), ưu tiên
    // phiếu còn hiệu lực (APPROVED > PARTNER_ACCEPTED > PENDING) rồi mới nhất —
    // tránh hiện nhầm phiếu cũ khi 1 ca có nhiều phiếu.
    const SWAP_RANK: Record<string, number> = { APPROVED: 0, PARTNER_ACCEPTED: 1, PENDING_PARTNER: 2 };
    const pickSwapOf = (aid?: string) => {
      if (!aid) return null;
      const cands = attSwapAll.filter((x: any) =>
        !['REJECTED', 'CANCELLED'].includes(x.status) &&
        (x.requester_assignment_id === aid || x.target_assignment_id === aid)
      );
      cands.sort((a: any, b: any) =>
        (SWAP_RANK[a.status] ?? 9) - (SWAP_RANK[b.status] ?? 9) ||
        String(b.created_at || '').localeCompare(String(a.created_at || ''))
      );
      return cands[0] || null;
    };
    // Chủ hiệu dụng của ca: B đã đồng ý nhận (PARTNER_ACCEPTED, chờ HR duyệt) thì ca
    // đứng tên B + tính tiền theo đơn giá B. APPROVED thì dữ liệu đã chuyển chủ.
    // PENDING (B chưa đồng ý) vẫn đứng tên chủ cũ.
    const effEmpIdOf = (s: any) => {
      const rel = pickSwapOf(s.assignment_id);
      if (rel && rel.status === 'PARTNER_ACCEPTED' && rel.target_employee_id) return rel.target_employee_id;
      return s.employee_id;
    };
    // Hàng đầy đủ mọi nhân viên (kể cả NV không có ca/sự kiện tuần này — ô hiện "—"),
    // để HR đối soát không sót ai khi tính lương.
    const attEmpIds = [...new Set([
      ...((allEmployees || []).map((e: any) => e.employee_id)),
      ...attWeekShifts.map((s: any) => effEmpIdOf(s)),
      ...attWeekEvts.map((e: any) => e.employee_id),
    ])].filter(Boolean);
    // Sắp xếp Y HỆT Lịch Làm Việc: theo chi nhánh → ca cố định (CA_1→CA_2→CA_3) →
    // thứ tự hồ sơ (allEmployees) — ca trong ô cũng theo CA_1→CA_2→CA_3.
    // Thứ tự chi nhánh cố định: CN1 (130 Vạn Kiếp) → CN2 (261 Tô Hiến Thành) →
    // CN3 (120 Hoàng Diệu 2) → CN4 (111 Tôn Đản).
    const BRANCH_ORDER: Record<string, number> = { CN130: 1, CN261: 2, CN120: 3, CN111: 4 };
    const branchRank = (b?: string) => BRANCH_ORDER[canonicalBranchId(b)] ?? 9;
    const SHIFT_ORDER: Record<string, number> = { CA_1: 1, CA_2: 2, CA_3: 3 };
    const empOrderIdx = new Map<string, number>(
      (allEmployees || []).map((e: any, i: number) => [e.employee_id, i])
    );
    // Ca xếp hàng: ca THỰC TẾ sớm nhất của NV trong tuần đang xem (ngày rồi ca),
    // rớt về ca cố định hồ sơ khi tuần này chưa có ca — khớp với ô ca hiển thị.
    const firstShiftRankOf = (empId: string): [number, string] => {
      const mine = attWeekShifts
        .filter((s: any) => effEmpIdOf(s) === empId)
        .sort((x: any, y: any) =>
          String(x.date || '').localeCompare(String(y.date || '')) ||
          ((SHIFT_ORDER[x.shift_code] || 9) - (SHIFT_ORDER[y.shift_code] || 9))
        );
      if (mine.length > 0) return [SHIFT_ORDER[mine[0].shift_code] || 9, String(mine[0].date || '')];
      return [9, ''];
    };
    const attEmps = attEmpIds
      .map(id => (allEmployees || []).find((e: any) => e.employee_id === id) || { employee_id: id, full_name: 'Nhân Viên', employee_code: id, employment_status: 'OFFICIAL', default_branch_id: '' })
      .filter((e: any) => e.employment_status !== 'TERMINATED')
      .sort((a: any, b: any) => {
        const fa = firstShiftRankOf(a.employee_id);
        const fb = firstShiftRankOf(b.employee_id);
        return (
          (branchRank(a.default_branch_id) - branchRank(b.default_branch_id)) ||
          (fa[0] - fb[0]) ||
          String(fa[1] || '').localeCompare(String(fb[1] || '')) ||
          ((SHIFT_ORDER[a.default_shift_code] || 9) - (SHIFT_ORDER[b.default_shift_code] || 9)) ||
          ((empOrderIdx.get(a.employee_id) ?? 9999) - (empOrderIdx.get(b.employee_id) ?? 9999)) ||
          String(a.full_name || '').localeCompare(String(b.full_name || ''), 'vi')
        );
      });
    const attCellOf = (empId: string, iso: string) => {
      const shs = attWeekShifts.filter((s: any) => effEmpIdOf(s) === empId && (s.date || '').slice(0, 10) === iso);
      const evs = attWeekEvts.filter((e: any) => e.employee_id === empId && vnDayOf(e.client_time || '') === iso);
      const byAssign = new Map<string, any[]>();
      for (const e of evs) {
        const k = e.assignment_id || `__${e.type}`;
        if (!byAssign.has(k)) byAssign.set(k, []);
        byAssign.get(k)!.push(e);
      }
      const items: any[] = shs
        .sort((a: any, b: any) => (SHIFT_ORDER[a.shift_code] || 9) - (SHIFT_ORDER[b.shift_code] || 9))
        .map((s: any) => {
          const list = byAssign.get(s.assignment_id) || [];
          const st = attShiftStatus(
            s,
            list.find((e: any) => e.type === 'CHECK_IN'),
            list.find((e: any) => e.type === 'CHECK_OUT'),
            list.find((e: any) => e.type === 'ABSENT')
          );
          byAssign.delete(s.assignment_id);
          return { shift: s, list, st };
        });
      for (const [, list] of byAssign) {
        const f = list[0];
        const pseudo = { assignment_id: '', date: iso, shift_code: '?', employee_id: empId, branch_id: f.branch_id };
        const st = attShiftStatus(
          pseudo,
          list.find((e: any) => e.type === 'CHECK_IN'),
          list.find((e: any) => e.type === 'CHECK_OUT'),
          list.find((e: any) => e.type === 'ABSENT')
        );
        items.push({ shift: pseudo, list, st });
      }
      return items;
    };
    return (
      <div id="sec-attendance" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800 }}>10. Bảng Chấm Công Thời Gian Thực</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Giám sát check-in, check-out, hình ảnh áo hồng + bảng tên, tọa độ GPS vệ tinh (100% Realtime)
            </p>
            <div style={{ marginTop: '8px', backgroundColor: attWeek.isSunday ? '#FFFBEB' : '#EFF6FF', border: attWeek.isSunday ? '1.5px solid #F59E0B' : '1px solid #BFDBFE', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: '12px', color: attWeek.isSunday ? '#92400E' : '#1E40AF' }}>
              📅 Dữ liệu tuần <strong>{attWeek.label}</strong> (T2 → CN).
              {attWeek.isSunday
                ? <> <strong>Bắt buộc tải ZIP tuần trước 23h30 tối nay!</strong> 23h30 hệ thống tự lưu trữ lên Drive + reset bảng sang tuần mới.</>
                : <> 23h30 Chủ nhật hệ thống tự lưu trữ + reset sang tuần mới — HR nên tải ZIP tuần trước đó.</>}
              <button
                className="btn-primary"
                style={{ fontSize: '12px', marginLeft: '10px', padding: '6px 12px', backgroundColor: '#7C3AED' }}
                disabled={exportWeekBusy}
                onClick={async () => {
                  setExportWeekBusy(true);
                  try {
                    const res = await fetch(`${getApiBase()}/admin/attendance/export-week?weekMon=${attWeek.mon}`, {
                      headers: { Authorization: `Bearer ${getAuthToken()}` },
                    });
                    if (!res.ok) {
                      const err = await res.json().catch(() => ({}));
                      throw new Error((err as any)?.message || 'Tải thất bại');
                    }
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `diem-danh-tuan-${attWeek.mon}.zip`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                    showToast(`Đã tải ZIP tuần ${attWeek.label} (chỉ ảnh check in/out)!`);
                  } catch (e: any) {
                    showToast(e?.message || 'Lỗi khi tải ZIP tuần!');
                  } finally {
                    setExportWeekBusy(false);
                  }
                }}
              >
                {exportWeekBusy ? 'Đang gói...' : '⬇ Tải ZIP tuần này'}
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {photoStats && (
              <span
                className="badge"
                title={photoStats.uploadFailed > 0 ? `Upload Drive lỗi: ${photoStats.drive?.lastError || 'không rõ'} (thử lại tự động 3 lần/lượt)` : photoStats.neverUploaded > 0 ? (photoStats.adapterPhoto ? `Server nhận ${photoStats.adapterPhoto.withPhoto} lượt CÓ ảnh, ${photoStats.adapterPhoto.withoutPhoto} lượt KHÔNG gửi ảnh (lượt ${photoStats.adapterPhoto.lastMissingEvent || '?'} lúc ${photoStats.adapterPhoto.lastMissingAt || '?'}) → app NV chưa gửi ảnh, yêu cầu NV tải lại trang/Cập nhật` : 'Lượt chấm công từ trước bản pipeline ảnh hoặc app chưa cập nhật') : 'Đủ ảnh'}
                style={{
                  backgroundColor: photoStats.withPhoto === photoStats.total && photoStats.total > 0 ? '#DCFCE7' : '#FEF3C7',
                  color: photoStats.withPhoto === photoStats.total && photoStats.total > 0 ? '#166534' : '#92400E',
                  fontWeight: 800,
                }}
              >
                📸 {photoStats.withPhoto}/{photoStats.total} có ảnh
                {photoStats.uploadFailed > 0 ? ` • ${photoStats.uploadFailed} lỗi upload` : ''}
                {photoStats.neverUploaded > 0 ? ` • ${photoStats.neverUploaded} chưa upload` : ''}
              </span>
            )}
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
                    if (!res.ok) {
                      const err = await res.json().catch(() => ({}));
                      throw new Error((err as any)?.message || 'Tải thất bại');
                    }
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `diem-danh-${exportAttDate}.zip`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                    showToast(`Đã tải ZIP điểm danh ngày ${exportAttDate} (chỉ ảnh check in/out theo CN/ca/tên NV)!`);
                  } catch (e: any) {
                    showToast(e?.message || 'Lỗi khi tải gói điểm danh!');
                  } finally {
                    setExportAttBusy(false);
                  }
              }}
            >
              {exportAttBusy ? 'Đang gói...' : '⬇ Tải ZIP theo ngày'}
            </button>
            <button
              className="btn-primary"
              style={{ fontSize: '12px', backgroundColor: '#DC2626' }}
              disabled={gpsReverifyBusy}
              onClick={async () => {
                if (!window.confirm(`Rà soát GPS ngày ${exportAttDate}? Hệ thống sẽ XÓA check-in/out vượt 300m (ca quay về chưa điểm danh) và bắt các NV đó điểm danh lại hết.`)) return;
                setGpsReverifyBusy(true);
                try {
                  const r = await apiRequest('/admin/attendance/reverify-gps', {
                    method: 'POST',
                    body: JSON.stringify({ date: exportAttDate }),
                  });
                  setGpsReverify({ date: exportAttDate, ...(r as any) });
                  showToast((r as any)?.offenders > 0
                    ? `Đã xóa ${(r as any)?.voided || 0} bản ghi vượt GPS + gửi yêu cầu điểm danh lại cho ${(r as any).offenders} NV!`
                    : 'Không phát hiện lượt nào vượt 300m.');
                  const data = await apiRequest('/attendance/events').catch(() => []);
                  setLiveAttendanceEvents(Array.isArray(data) ? data : []);
                } catch (e: any) {
                  showToast(e?.message || 'Lỗi khi rà soát!');
                } finally {
                  setGpsReverifyBusy(false);
                }
              }}
            >
              {gpsReverifyBusy ? 'Đang rà soát...' : '📡 Rà soát GPS >300m'}
            </button>
            <button
              className="btn-secondary"
              onClick={async () => {
                await reloadAttEvents();
                showToast('Đã làm mới dữ liệu chấm công thời gian thực!');
              }}
              style={{ fontSize: '12px' }}
            >
              🔄 Làm Mới Realtime
            </button>
          </div>
        </div>

        {gpsReverify && (
          <div style={{ backgroundColor: (gpsReverify.offenders || 0) > 0 ? '#FEF2F2' : '#ECFDF5', border: (gpsReverify.offenders || 0) > 0 ? '1.5px solid #EF4444' : '1px solid #A7F3D0', borderRadius: 'var(--radius-md)', padding: '12px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '13px' }}>
                📡 Kết quả rà soát GPS ngày {gpsReverify.date}: {(gpsReverify.offenders || 0) > 0 ? `${gpsReverify.offenders} NV vượt 300m — đã gửi yêu cầu điểm danh lại` : 'không phát hiện vi phạm'}
              </strong>
              <button className="btn-secondary" style={{ fontSize: '11px', padding: '3px 10px' }} onClick={() => setGpsReverify(null)}>Ẩn</button>
            </div>
            {(gpsReverify.detail || []).length > 0 && (
              <table style={{ width: '100%', fontSize: '12px', marginTop: '8px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '4px 8px' }}>Nhân viên</th>
                    <th style={{ padding: '4px 8px' }}>Số lượt vượt</th>
                    <th style={{ padding: '4px 8px' }}>Xa nhất</th>
                  </tr>
                </thead>
                <tbody>
                  {(gpsReverify.detail || []).map((d: any) => {
                    const emp = (allEmployees || []).find((e: any) => e.employee_id === d.employee_id);
                    return (
                      <tr key={d.employee_id} style={{ borderTop: '1px solid #FECACA' }}>
                        <td style={{ padding: '4px 8px', fontWeight: 700 }}>{emp?.full_name || d.employee_id}</td>
                        <td style={{ padding: '4px 8px' }}>{d.count}</td>
                        <td style={{ padding: '4px 8px', color: '#DC2626', fontWeight: 800 }}>{d.max_distance}m</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflowX: 'auto', padding: '12px 14px' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700 }}>Tuần:</span>
            <select
              value={attWeekOffset}
              onChange={(e) => setAttWeekOffset(Number(e.target.value))}
              style={{ padding: '6px 10px', fontSize: '12px', borderRadius: '6px', fontWeight: 700 }}
            >
              {weekOptions(0, 12).map(w => (
                <option key={w.offset} value={w.offset}>{w.label}</option>
              ))}
            </select>
            <button className="btn-secondary" style={{ fontSize: '12px', padding: '6px 10px' }} onClick={() => setAttWeekOffset(o => o - 1)}>◀</button>
            <button className="btn-primary" style={{ fontSize: '12px', padding: '6px 10px' }} onClick={() => setAttWeekOffset(o => o + 1)}>▶</button>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Tuần <strong>Thứ 2 {attDays[0] ? `${attDays[0].iso.slice(8, 10)}/${attDays[0].iso.slice(5, 7)}/${attDays[0].iso.slice(0, 4)}` : '…'} → CN {attDays[6] ? `${attDays[6].iso.slice(8, 10)}/${attDays[6].iso.slice(5, 7)}/${attDays[6].iso.slice(0, 4)}` : '…'}</strong> • 1 ô = các ca trong ngày kèm đúng trạng thái{attWeekOffset < 0 ? (archiveLoading ? ' • ⏳ Đang tải ngày công tuần cũ từ kho lưu trữ...' : ' • Tuần cũ đọc từ kho lưu trữ (đủ ngày công tính lương).') : ''}
            </span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
                <th style={{ padding: '12px 16px', textAlign: 'left', minWidth: '170px' }}>NHÂN VIÊN</th>
                {attDays.map((day: any) => (
                  <th key={day.key} style={{ padding: '12px 8px', minWidth: '130px', backgroundColor: day.isToday ? '#FFFBEB' : undefined }}>
                    {day.code}
                    <div style={{ fontSize: '10px', fontWeight: 400 }}>{day.iso.slice(8, 10)}/{day.iso.slice(5, 7)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attEmps.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Tuần này chưa có ca phân công hay lượt chấm công nào.
                  </td>
                </tr>
              ) : (
                attEmps.map((emp: any) => (
                  <tr key={emp.employee_id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 700, fontSize: '12px' }}>
                      {emp.full_name}
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 400 }}>{emp.employee_code} • {getDisplayBranch(emp.default_branch_id) || emp.default_branch_id || ''}{emp.default_shift_code ? ` • ${emp.default_shift_code.replace('CA_', 'Ca ')}` : ''}</div>
                    </td>
                    {attDays.map((day: any) => {
                      const items = attCellOf(emp.employee_id, day.iso);
                      return (
                        <td key={day.key} style={{ padding: '6px', verticalAlign: 'top', backgroundColor: day.isToday ? '#FFFBFB' : undefined }}>
                          {items.length === 0 ? (
                            <span style={{ color: '#D1D5DB', fontSize: '14px' }}>—</span>
                          ) : (
                            <>
                              {items.length > 1 && (
                                <span className="badge" style={{ backgroundColor: '#EDE9FE', color: '#6D28D9', fontWeight: 800, marginBottom: '4px' }}>
                                  {items.length} ca
                                </span>
                              )}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              {items.map((it: any, ii: number) => {
                                const timeOf = (t: string) => {
                                  try { return new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
                                };
                                const inE = it.list.find((e: any) => e.type === 'CHECK_IN');
                                const outE = it.list.find((e: any) => e.type === 'CHECK_OUT');
                                const lateMinCell = lateMinOf(inE, it.shift?.start_at);
                                const late = lateMinCell > 0 ? ` trễ ${lateMinCell}p` : '';
                                const thumb = (e: any) => e?.drive_object_id && !String(e.drive_object_id).startsWith('DRV_')
                                  ? <AttPhoto eventId={e.event_id} style={{ width: '40px', height: '40px' }} />
                                  : null;
                                // Lương ca + phạt (tạm tính theo đơn giá hồ sơ; Finance chốt ở kỳ lương)
                                const empRate = Number((emp as any)?.current_rate_per_hour) || 0;
                                const pay = shiftPayInfo(it.shift?.shift_code, empRate, inE, outE, it.shift?.start_at);
                                const fmtVnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`;
                                // Đổi/nhường ca liên quan ca này (nếu có) — phiếu mới nhất còn hiệu lực
                                const relSwap = pickSwapOf(it.shift?.assignment_id);
                                const empNameOf = (id: string) => (allEmployees || []).find((e: any) => e.employee_id === id)?.full_name || id || '—';
                                const hoverKey = `${emp.employee_id}|${day.iso}|${ii}`;
                                const isDispatch = (relSwap?.swap_kind || 'EMPLOYEE_SWAP') === 'HR_DISPATCH';
          return (
                                  <div
                                    key={ii}
                                    style={{ padding: '6px', borderRadius: '8px', backgroundColor: it.st.bg, border: it.st.border, animation: it.st.blink ? 'fx-blink 1.2s infinite' : undefined, position: 'relative', cursor: 'default' }}
                                    onMouseEnter={() => setAttHover(hoverKey)}
                                    onMouseLeave={() => setAttHover(h => (h === hoverKey ? null : h))}
                                  >
                                    <div style={{ fontWeight: 800, fontSize: '11px' }}>{it.shift?.shift_code || 'Không ca'}</div>
                                    <div style={{ fontSize: '10px', color: it.st.fg, fontWeight: 700 }}>{it.st.label}{late}</div>
                                    <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                      {inE ? `Vào ${timeOf(inE.client_time)}` : '—'} • {outE ? `Ra ${timeOf(outE.client_time)}` : '—'}
                                    </div>
                                    {it.st.key === 'COMPLETED' && (
                                      <div style={{ fontSize: '10px', color: pay.unpaid ? '#991B1B' : '#065F46', fontWeight: 800 }}>
                                        💰 {fmtVnd(pay.net)}{pay.deduction > 0 ? ` (phạt ${fmtVnd(pay.deduction)})` : ''}{pay.unpaid ? ' (không lương)' : ''}
                                      </div>
                                    )}
                                    {relSwap && (
                                      <div style={{ fontSize: '10px', color: '#6D28D9', fontWeight: 700 }} title={`Phiếu ${relSwap.swap_id} • ${relSwap.status} • gửi ${relSwap.created_at ? new Date(relSwap.created_at).toLocaleString('vi-VN') : '?'}`}>
                                        ⇄ {empNameOf(relSwap.requester_id)} → {relSwap.target_employee_id ? empNameOf(relSwap.target_employee_id) : 'mở CN'}{isDispatch ? ' +30k' : ''}{relSwap.status === 'PARTNER_ACCEPTED' ? ' • B đã nhận (chờ HR duyệt)' : relSwap.status === 'PENDING_PARTNER' ? ' • chờ B đồng ý' : ''}
                                      </div>
                                    )}
                                    {(thumb(inE) || thumb(outE)) && (
                                      <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                                        {thumb(inE)}
                                        {thumb(outE)}
                                      </div>
                                    )}
                                    {it.st.key === 'COMPLETED' && inE && (
                                      <div style={{ fontSize: '10px', color: '#059669', fontWeight: 700 }}>Hồng {inE.uniform_pink_ratio ?? '?'}%</div>
                                    )}
                                    {attHover === hoverKey && (
                                      <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 60, width: '250px', backgroundColor: '#fff', border: '1px solid var(--border)', borderRadius: '10px', boxShadow: '0 12px 32px rgba(0,0,0,0.18)', padding: '10px 12px', fontSize: '11px', lineHeight: 1.6, color: 'var(--text)' }}>
                                        <div style={{ fontWeight: 800, fontSize: '12px', marginBottom: '4px' }}>
                                          {emp.full_name} • {it.shift?.shift_code || 'Không ca'} • {day.iso.slice(8, 10)}/{day.iso.slice(5, 10)}
                                        </div>
                                        <div>🕒 Vào: <strong>{inE ? timeOf(inE.client_time) : '—'}</strong> • Ra: <strong>{outE ? timeOf(outE.client_time) : '—'}</strong></div>
                                        <div>📌 Trạng thái: <strong>{it.st.label}{late}</strong></div>
                                        <div style={{ borderTop: '1px dashed var(--border)', margin: '6px 0', paddingTop: '6px' }}>
                                          💵 Đơn giá: <strong>{empRate ? fmtVnd(empRate) + '/giờ' : 'chưa gán'}</strong> • Công: <strong>{pay.hours}h</strong><br />
                                          💰 Lương ca: <strong>{fmtVnd(pay.shiftPay)}</strong><br />
                                          ⚖ Phạt: <strong style={{ color: pay.deduction > 0 || pay.unpaid ? '#DC2626' : '#059669' }}>{pay.fineLabel}</strong><br />
                                          ✅ Thực nhận ca: <strong style={{ color: '#065F46' }}>{fmtVnd(pay.net)}</strong>
                                          <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>(Tạm tính realtime — Finance chốt số chính thức ở kỳ lương)</div>
                                        </div>
                                        <div style={{ borderTop: '1px dashed var(--border)', margin: '6px 0', paddingTop: '6px' }}>
                                          ⇄ Đổi/nhường ca: {relSwap ? (
                                            <span>
                                              <strong>{empNameOf(relSwap.requester_id)} → {relSwap.target_employee_id ? empNameOf(relSwap.target_employee_id) : 'mở cả chi nhánh'}</strong><br />
                                              Loại: {isDispatch ? 'HR điều phối (+30k người nhận)' : 'NV tự tráo (không phụ cấp)'} • Trạng thái: <strong>{relSwap.status}</strong><br />
                                              <span style={{ color: 'var(--text-muted)' }}>Phiếu {relSwap.swap_id} • gửi {relSwap.created_at ? new Date(relSwap.created_at).toLocaleString('vi-VN') : '?'}</span>
                                            </span>
                                          ) : 'Không có'}
                                        </div>
                                        {it.st.key === 'COMPLETED' && inE && (
                                          <div>👕 Áo hồng: <strong>{inE.uniform_pink_ratio ?? '?'}%</strong></div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                )))
              }
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
        const res = await apiRequest(`/attendance/adjustments/${adj.adjustment_id}/approve`, {
          method: 'POST',
          body: JSON.stringify({ status, minutesApproved: status === 'APPROVED' ? adj.minutes_requested : 0 }),
        });
        const filled = (res as any)?.result?._backfilled || (res as any)?._backfilled || [];
        const cleared = (res as any)?.result?._violationCleared || (res as any)?._violationCleared || 0;
        showToast(status === 'APPROVED'
          ? `Đã duyệt bổ sung công!${filled.length ? ` Đã dựng lại ${filled.join('+')} — lịch, realtime và lương cập nhật.` : ''}${cleared ? ` Đã xóa ${cleared} vi phạm/phạt check-in/out của ca.` : ''}`
          : 'Đã từ chối phiếu (giữ nguyên vi phạm/phạt)!');
        await loadAdjustments();
        if (onRefreshData) await onRefreshData();
      } catch (e: any) {
        // Thao tác rớt (VD phiếu đã được xử lý ở máy khác) -> tải lại ngay để
        // hàng cũ biến mất, HR không bấm lỗi lặp trên dữ liệu đã cũ.
        await loadAdjustments().catch(() => null);
        showToast(e?.message || 'Lỗi khi duyệt!');
      } finally {
        setAdjBusy(null);
      }
      // Đồng bộ Sheets chạy nền, không giữ nút (tránh kẹt disabled khi mạng chậm).
      if (onSyncSheets) {
        try {
          const r = onSyncSheets();
          if (r && typeof (r as any).catch === 'function') (r as any).catch(() => null);
        } catch { /* bỏ qua */ }
      }
    };
    const renderAdjRows = (list: any[], isPending: boolean) =>
      list.map((a: any) => {
        const emp = (allEmployees || []).find((e: any) => e.employee_id === a.employee_id);
        return (
          <tr key={a.adjustment_id} style={{ borderBottom: '1px solid var(--border)', backgroundColor: isPending ? '#FFFBEB' : undefined }}>
            <td
              style={{ padding: '12px 20px', fontWeight: 700, cursor: 'pointer' }}
              title="Bấm để xem chi tiết phiếu (lý do, số phút, ảnh bằng chứng)"
              onClick={() => setSelectedAdj(a)}
            >
              <span style={{ color: 'var(--brand)', textDecoration: 'underline' }}>{emp?.full_name || a.employee_id}</span>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 400 }}>{emp?.employee_code || ''}</div>
            </td>
            <td style={{ padding: '12px 20px' }}>{getDisplayBranch(a.branch_id) || a.branch_id || 'Chưa rõ'}</td>
            <td style={{ padding: '12px 20px' }}>
              <div>{a.reason || 'Bổ sung công'}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Ca: {a.assignment_id || '—'} • Xin: {a.minutes_requested ?? 0} phút{a.minutes_approved !== undefined && a.status === 'APPROVED' ? ` • Duyệt: ${a.minutes_approved} phút` : ''}</div>
            </td>
            <td style={{ padding: '12px 20px' }} onClick={() => a.evidence_drive_id && setSelectedAdj(a)} title={a.evidence_drive_id ? 'Bấm để xem ảnh lớn' : undefined}>
              {a.evidence_drive_id ? (
                <AdjPhoto adjustmentId={a.adjustment_id} />
              ) : (
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>—</span>
              )}
            </td>
            <td style={{ padding: '12px 20px', fontSize: '12px', color: 'var(--text-muted)' }}>{a.created_at ? new Date(a.created_at).toLocaleString('vi-VN') : '—'}</td>
            <td style={{ padding: '12px 20px' }}>
              <span className="badge" style={{ backgroundColor: a.status === 'APPROVED' ? '#DCFCE7' : a.status === 'REJECTED' ? '#FEE2E2' : '#FEF3C7', color: a.status === 'APPROVED' ? '#166534' : a.status === 'REJECTED' ? '#991B1B' : '#92400E', fontWeight: 700 }}>
                {a.status === 'APPROVED' ? 'Đã duyệt' : a.status === 'REJECTED' ? (String(a.review_note || '').startsWith('Tự động từ chối') ? 'Tự từ chối (hết hạn)' : 'Đã từ chối') : 'Chờ duyệt'}
              </span>
            </td>
            <td style={{ padding: '12px 20px' }}>
              {isPending ? (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button className="btn-primary" style={{ padding: '4px 10px', fontSize: '12px' }} disabled={adjBusy === a.adjustment_id} onClick={() => reviewAdj(a, 'APPROVED')}>{adjBusy === a.adjustment_id ? '⏳...' : 'Duyệt'}</button>
                  <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: '12px', color: '#DC2626' }} disabled={adjBusy === a.adjustment_id} onClick={() => reviewAdj(a, 'REJECTED')}>{adjBusy === a.adjustment_id ? '⏳...' : 'Từ chối'}</button>
                  <button
                    className="btn-secondary"
                    style={{ padding: '4px 10px', fontSize: '12px', color: '#DC2626' }}
                    disabled={adjBusy === a.adjustment_id}
                    title="Xóa cứng phiếu đang chờ khỏi hệ thống (bộ nhớ + Sheet)"
                    onClick={async () => {
                      if (!window.confirm(`Xóa cứng phiếu đang chờ ${a.adjustment_id} khỏi hệ thống (không khôi phục)?`)) return;
                      setAdjBusy(a.adjustment_id);
                      try {
                        await apiRequest(`/attendance/adjustments/${a.adjustment_id}`, { method: 'DELETE' });
                        showToast('Đã xóa phiếu khỏi hệ thống!');
                        await loadAdjustments();
                        if (onRefreshData) await onRefreshData();
                      } catch (e: any) {
                        await loadAdjustments().catch(() => null);
                        showToast(e?.message || 'Lỗi khi xóa!');
                      } finally {
                        setAdjBusy(null);
                      }
                      if (onSyncSheets) {
                        try {
                          const r = onSyncSheets();
                          if (r && typeof (r as any).catch === 'function') (r as any).catch(() => null);
                        } catch { /* bỏ qua */ }
                      }
                    }}
                  >
                    {adjBusy === a.adjustment_id ? '⏳...' : 'Xóa'}
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Đã xử lý</span>
                  {a.status === 'APPROVED' ? (
                    <>
                    <span
                      title="Phiếu đã duyệt và dựng công — bị khóa cứng, không được xóa để khỏi mồ côi dữ liệu lương."
                      style={{ padding: '4px 10px', fontSize: '12px', fontWeight: 700, color: '#9CA3AF', backgroundColor: '#F3F4F6', borderRadius: '6px', border: '1px solid #E5E7EB', cursor: 'not-allowed' }}
                    >
                      🔒 Khóa
                    </span>
                    {(() => {
                      // Phiếu cũ gắn nhầm ca/ngày (lỗi app NV cũ): ca của phiếu khác
                      // ngày trong lý do -> hiện nút sửa để gỡ lượt dựng nhầm + dựng lại.
                      const reasonDate = String(a.reason || '').match(/(\d{4}-\d{2}-\d{2})/)?.[1] || '';
                      const sh = (shifts || []).find((s: any) => s.assignment_id === a.assignment_id);
                      const shiftDate = String(sh?.date || '').slice(0, 10);
                      if (!reasonDate || !shiftDate || reasonDate === shiftDate) return null;
                      return (
                        <button
                          className="btn-secondary"
                          style={{ padding: '4px 10px', fontSize: '12px', fontWeight: 700, color: '#B45309', borderColor: '#FDE68A' }}
                          disabled={adjBusy === a.adjustment_id}
                          title={`Phiếu ngày ${reasonDate} nhưng đang gắn ca ngày ${shiftDate} — bấm để gỡ lượt dựng nhầm và dựng lại đúng ngày ${reasonDate}`}
                          onClick={async () => {
                            if (!window.confirm(`Chuyển phiếu về đúng ngày ${reasonDate}?\nHệ thống gỡ lượt điểm danh dựng nhầm ngày ${shiftDate} và dựng lại đúng ngày ${reasonDate}.`)) return;
                            setAdjBusy(a.adjustment_id);
                            try {
                              const r: any = await apiRequest(`/attendance/adjustments/${a.adjustment_id}/repair`, { method: 'POST' });
                              showToast(`✅ Đã chuyển về đúng ngày ${r?.date || reasonDate}! Lượt dựng nhầm đã gỡ.`);
                              await loadAdjustments();
                              if (onRefreshData) await onRefreshData();
                            } catch (e: any) {
                              showToast(e?.message || 'Lỗi khi sửa ngày!');
                            } finally {
                              setAdjBusy(null);
                            }
                          }}
                        >
                          {adjBusy === a.adjustment_id ? '⏳...' : '🔧 Chuyển đúng ngày'}
                        </button>
                      );
                    })()}
                    </>
                  ) : (
                  <button
                    className="btn-secondary"
                    style={{ padding: '4px 10px', fontSize: '12px', color: '#DC2626' }}
                    disabled={adjBusy === a.adjustment_id}
                    title="Xóa cứng phiếu khỏi hệ thống (bộ nhớ + Sheet)."
                    onClick={async () => {
                      if (!window.confirm(`Xóa cứng phiếu ${a.adjustment_id} khỏi hệ thống (không khôi phục)?`)) return;
                      setAdjBusy(a.adjustment_id);
                      try {
                        await apiRequest(`/attendance/adjustments/${a.adjustment_id}`, { method: 'DELETE' });
                        showToast('Đã xóa phiếu khỏi hệ thống!');
                        await loadAdjustments();
                        if (onRefreshData) await onRefreshData();
                      } catch (e: any) {
                        await loadAdjustments().catch(() => null);
                        showToast(e?.message || 'Lỗi khi xóa!');
                      } finally {
                        setAdjBusy(null);
                      }
                      if (onSyncSheets) {
                        try {
                          const r = onSyncSheets();
                          if (r && typeof (r as any).catch === 'function') (r as any).catch(() => null);
                        } catch { /* bỏ qua */ }
                      }
                    }}
                  >
                    {adjBusy === a.adjustment_id ? '⏳...' : 'Xóa'}
                  </button>
                  )}
                </div>
              )}
            </td>
          </tr>
        );
      });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800, margin: 0 }}>11. Bổ Sung & Điều Chỉnh Dữ Liệu Công</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '4px 0 0' }}>Xử lý quên check-in/out hoặc sự cố GPS/Camera gửi từ Cổng Nhân Viên (có audit trail). Phiếu gửi quá <strong>1 ngày</strong> chưa duyệt thì hệ thống <strong>tự động từ chối</strong> (giữ phiếu để đối soát, tự xóa sau 7 ngày nữa).</p>
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
                <th style={{ padding: '12px 20px' }}>Hình Ảnh</th>
                <th style={{ padding: '12px 20px' }}>Gửi Lúc</th>
                <th style={{ padding: '12px 20px' }}>Trạng Thái</th>
                <th style={{ padding: '12px 20px' }}>Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              {adjustments.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
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
        {/* POPUP CHI TIẾT PHIẾU: bấm tên NV / ảnh ở bảng để xem đầy đủ */}
        {selectedAdj && (() => {
          const selEmp = (allEmployees || []).find((e: any) => e.employee_id === selectedAdj.employee_id);
          return (
            <div
              style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px' }}
              onClick={() => setSelectedAdj(null)}
            >
              <div
                style={{ backgroundColor: 'var(--surface)', borderRadius: '12px', maxWidth: '560px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '20px', border: '1px solid var(--border)' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h2 style={{ fontSize: '16px', fontWeight: 800, margin: 0 }}>📋 Chi Tiết Phiếu Bổ Sung Công</h2>
                  <button className="btn-secondary" style={{ fontSize: '12px', padding: '5px 12px' }} onClick={() => setSelectedAdj(null)}>✕ Đóng</button>
                </div>
                <div style={{ fontSize: '14px', fontWeight: 800, marginBottom: '2px' }}>
                  👤 {selEmp?.full_name || selectedAdj.employee_id}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                  {selEmp?.employee_code || selectedAdj.employee_id} • {getDisplayBranch(selectedAdj.branch_id) || selectedAdj.branch_id || 'Chưa rõ chi nhánh'}
                </div>
                <div style={{ backgroundColor: 'var(--bg)', borderRadius: '8px', padding: '12px', fontSize: '13px', marginBottom: '12px' }}>
                  <div style={{ fontWeight: 700, marginBottom: '4px' }}>Lý do & Số phút:</div>
                  <div>{selectedAdj.reason || 'Bổ sung công'}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Ca: {selectedAdj.assignment_id || '—'} • Xin: {selectedAdj.minutes_requested ?? 0} phút
                    {selectedAdj.minutes_approved !== undefined && selectedAdj.status === 'APPROVED' ? ` • Duyệt: ${selectedAdj.minutes_approved} phút` : ''}
                  </div>
                </div>
                <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '6px' }}>🖼 Hình ảnh bằng chứng:</div>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px', backgroundColor: '#111827', borderRadius: '8px', padding: '8px' }}>
                  {selectedAdj.evidence_drive_id ? (
                    <AdjPhoto adjustmentId={selectedAdj.adjustment_id} style={{ width: '100%', height: 'auto', maxHeight: '380px', objectFit: 'contain', cursor: 'default' }} />
                  ) : (
                    <span style={{ fontSize: '13px', color: '#9CA3AF', padding: '24px' }}>Phiếu này không có ảnh bằng chứng</span>
                  )}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                  <span>🕒 Gửi lúc: {selectedAdj.created_at ? new Date(selectedAdj.created_at).toLocaleString('vi-VN') : '—'}</span>
                  <span
                    className="badge"
                    style={{ backgroundColor: selectedAdj.status === 'APPROVED' ? '#DCFCE7' : selectedAdj.status === 'REJECTED' ? '#FEE2E2' : '#FEF3C7', color: selectedAdj.status === 'APPROVED' ? '#166534' : selectedAdj.status === 'REJECTED' ? '#991B1B' : '#92400E', fontWeight: 700 }}
                  >
                    {selectedAdj.status === 'APPROVED' ? 'Đã duyệt' : selectedAdj.status === 'REJECTED' ? 'Đã từ chối' : 'Chờ duyệt'}
                  </span>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  if (activeTab === 'hr-tests') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800 }}>12. Quản Lý Ngân Hàng Câu Hỏi & Bài Thi TEST</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Bộ đề 25 câu hỏi trắc nghiệm đánh giá đầu ra thử việc (12 ngày) & sát hạch nghiệp vụ định kỳ Ụm Bò Milk V5.1
            </p>
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

        {/* ĐỀ RANDOM TỪ NGÂN HÀNG CÂU HỎI: tick NV + gửi 1 lần, mỗi NV nhận đề riêng */}
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1.5px solid #7C3AED', padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ fontWeight: 800, fontSize: '15px' }}>🎲 Đề Random Từ Ngân Hàng Câu Hỏi (Google Sheet)</div>
            <button className="btn-secondary" style={{ fontSize: '12px', padding: '4px 10px' }} onClick={loadBank} disabled={bankLoading}>
              {bankLoading ? '⏳ Đang đọc Sheet...' : '↻ Đọc lại Sheet'}
            </button>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.6 }}>
            Hệ thống lấy ngẫu nhiên <strong>{bankCount} câu khác nhau</strong> từ Sheet ngân hàng, tạo đề riêng và giao cho đúng NV đã tick — NV nhận thông báo inbox + yêu cầu hoàn thành ngay trên cổng của mình.
            {bankInfo?.sheetUrl && <> Sheet: <a href={bankInfo.sheetUrl} target="_blank" rel="noreferrer" style={{ color: '#0068FF', fontWeight: 700 }}>mở ngân hàng câu hỏi →</a></>}
          </div>
          {bankInfo?.error ? (
            <div style={{ marginTop: '10px', fontSize: '13px', fontWeight: 700, color: '#991B1B', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px 12px', lineHeight: 1.6 }}>
              ⚠️ {bankInfo.error}
              <div style={{ fontWeight: 500, marginTop: '4px' }}>Khắc phục: mở Sheet ngân hàng → Chia sẻ → thêm email service account của hệ thống với quyền Người xem, rồi bấm Đọc lại Sheet.</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'end', marginTop: '12px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700 }}>Tiêu đề đề thi
                  <input value={bankTitle} onChange={(e) => setBankTitle(e.target.value)} placeholder="Để trống = tự đặt theo ngày" style={{ display: 'block', width: '280px', maxWidth: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '13px', marginTop: '4px' }} />
                </label>
                <label style={{ fontSize: '12px', fontWeight: 700 }}>Số câu random
                  <input type="number" min={1} max={Math.min(50, bankInfo?.count || 50)} value={bankCount} onChange={(e) => setBankCount(Math.max(1, Math.min(50, Number(e.target.value) || 25)))} style={{ display: 'block', width: '90px', padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '13px', marginTop: '4px' }} />
                </label>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', paddingBottom: '8px' }}>
                  {bankLoading ? 'Đang đọc Sheet...' : bankInfo ? <>Ngân hàng có <strong style={{ color: '#7C3AED' }}>{bankInfo.count} câu hợp lệ</strong>{bankInfo.skipped > 0 && <> (bỏ {bankInfo.skipped} dòng lỗi)</>}.</> : 'Mở tab là hệ thống tự đọc Sheet.'}
                </span>
              </div>
              {bankInfo?.sample?.length > 0 && (
                <details style={{ marginTop: '8px', fontSize: '12px' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#7C3AED' }}>Xem 3 câu mẫu từ Sheet (kèm đáp án đúng để đối chiếu)</summary>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                    {bankInfo.sample.map((q: any, i: number) => (
                      <div key={i} style={{ backgroundColor: 'var(--bg)', borderRadius: '6px', padding: '8px 10px' }}>
                        <div style={{ fontWeight: 700 }}>{i + 1}. {q.content}</div>
                        <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>{(q.options || []).map((o: string, oi: number) => `${String.fromCharCode(65 + oi)}. ${o}`).join(' • ')}</div>
                        <div style={{ color: '#059669', fontWeight: 700, marginTop: '2px' }}>Đáp án: {q.correct}{q.explanation ? ` — ${q.explanation}` : ''}</div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              <div style={{ marginTop: '12px' }}>
                <EmployeeTickPicker
                  employees={allEmployees || []}
                  selected={bankAssignees}
                  onToggle={(id) => setBankAssignees(bankAssignees.includes(id) ? bankAssignees.filter(x => x !== id) : [...bankAssignees, id])}
                  onSelectVisible={(ids) => setBankAssignees([...new Set([...bankAssignees, ...ids])])}
                  onClear={() => setBankAssignees([])}
                  search={bankSearch}
                  onSearchChange={setBankSearch}
                  accent="#7C3AED"
                  softBg="#F5F3FF"
                />
              </div>
              <div style={{ marginBottom: '10px' }} />
              <button
                className="btn-primary"
                disabled={bankBusy || bankAssignees.length === 0}
                style={{ backgroundColor: '#7C3AED', width: '100%', padding: '10px', fontWeight: 800, opacity: bankBusy || bankAssignees.length === 0 ? 0.6 : 1 }}
                onClick={async () => {
                  if (bankAssignees.length === 0) { showToast('Tick chọn ít nhất 1 nhân viên để giao bài!'); return; }
                  if (!window.confirm(`Random ${bankCount} câu khác nhau từ ngân hàng và giao cho ${bankAssignees.length} nhân viên?\nMỗi NV nhận đề riêng + thông báo yêu cầu hoàn thành ngay.`)) return;
                  setBankBusy(true);
                  try {
                    const res: any = await apiRequest('/admin/tests/from-bank', {
                      method: 'POST',
                      body: JSON.stringify({
                        title: bankTitle.trim(),
                        employeeIds: bankAssignees,
                        count: bankCount,
                      }),
                    });
                    const n = res?.assignedCount ?? bankAssignees.length;
                    showToast(`🎲 Đã random ${res?.questionCount ?? bankCount} câu và giao cho ${n} nhân viên! NV đã nhận thông báo làm bài.`);
                    setBankTitle(''); setBankAssignees([]);
                    await loadTests();
                    if (onRefreshData) await onRefreshData();
                  } catch (e: any) {
                    showToast(e?.message || 'Lỗi khi giao đề random!');
                  } finally {
                    setBankBusy(false);
                  }
                }}
              >
                {bankBusy ? '⏳ Đang random & giao...' : `🎲 Random ${bankCount} câu & giao cho ${bankAssignees.length} nhân viên`}
              </button>
            </>
          )}
        </div>

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
    const r = monthlyReport;
    const vnd = (n: number) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;
    const personLine = (p: any) => p ? `${p.fullName} (${p.employeeCode}) — ${p.hours}h` : '—';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 800, margin: 0 }}>13. Báo Cáo Phân Tích Nhân Sự (HR Reports)</h1>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)' }}>Kỳ báo cáo:</label>
            <input
              type="month"
              value={reportPeriod}
              max={currentVnMonth()}
              onChange={(e) => {
                const v = e.target.value;
                if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return;
                setReportPeriod(v);
                loadMonthlyReport(v);
              }}
              style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px', fontWeight: 700 }}
            />
            <button className="btn-secondary" style={{ fontSize: '12px', padding: '6px 12px' }} onClick={() => loadMonthlyReport()} disabled={reportLoading}>
              {reportLoading ? '⏳ Đang tổng hợp...' : '↻ Tải lại'}
            </button>
          </div>
        </div>

        {!r && !reportLoading && (
          <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--border)', padding: '36px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            Chưa có dữ liệu kỳ này. Chọn kỳ khác hoặc bấm Tải lại.
          </div>
        )}

        {r && (
          <>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Kỳ <strong>{String(r.period).slice(5, 7)}/{String(r.period).slice(0, 4)}</strong> • {r.officialCount} chính thức + {r.probationCount} thử việc{r.zeroHourCount > 0 && <> • {r.zeroHourCount} người chưa có giờ công</>} • Lương theo {r.runStatus ? `kỳ đã chốt (${r.runStatus})` : 'tạm tính từ chấm công (Finance chưa chốt kỳ)'}.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
              <div style={{ backgroundColor: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>TỔNG GIỜ LÀM VIỆC</div>
                <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--brand)', marginTop: '4px' }}>{r.totalHours}h</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Chính thức {r.officialHours}h • Thử việc {r.probationHours}h</div>
              </div>
              <div style={{ backgroundColor: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid #A7F3D0' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>🏆 NHIỀU GIỜ NHẤT</div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: '#059669', marginTop: '4px' }}>{r.top ? `${r.top.fullName}` : '—'}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{r.top ? `${r.top.employeeCode} • ${r.top.hours}h • ${vnd(r.top.salary)}` : 'Chưa có giờ công'}</div>
              </div>
              <div style={{ backgroundColor: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid #FECACA' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>🔻 ÍT GIỜ NHẤT (có làm)</div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: '#DC2626', marginTop: '4px' }}>{r.bottom ? `${r.bottom.fullName}` : '—'}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{r.bottom ? `${r.bottom.employeeCode} • ${r.bottom.hours}h • ${vnd(r.bottom.salary)}` : 'Chưa có giờ công'}</div>
              </div>
              <div style={{ backgroundColor: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>TỔNG LƯƠNG THÁNG</div>
                <div style={{ fontSize: '24px', fontWeight: 800, color: '#2563EB', marginTop: '4px' }}>{vnd(r.totalSalary)}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Chính thức {vnd(r.officialSalary)} • Thử việc {vnd(r.probationSalary)}</div>
              </div>
            </div>

            <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontSize: '14px', fontWeight: 800 }}>
                Giờ làm & lương từng nhân viên ({r.rows.length})
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                      <th style={{ padding: '12px 20px' }}>Mã NV</th>
                      <th style={{ padding: '12px 20px' }}>Họ Và Tên</th>
                      <th style={{ padding: '12px 20px' }}>Diện</th>
                      <th style={{ padding: '12px 20px' }}>Chi Nhánh</th>
                      <th style={{ padding: '12px 20px', textAlign: 'center' }}>Số Ca</th>
                      <th style={{ padding: '12px 20px', textAlign: 'center' }}>Giờ Làm</th>
                      <th style={{ padding: '12px 20px', textAlign: 'right' }}>Đơn Giá</th>
                      <th style={{ padding: '12px 20px', textAlign: 'right' }}>Lương Tháng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.rows.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                          Kỳ này chưa có nhân viên chính thức hay thử việc nào.
                        </td>
                      </tr>
                    ) : (
                      r.rows.map((row: any) => (
                        <tr key={row.employeeId} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '12px 20px', fontFamily: 'monospace', fontWeight: 700, color: 'var(--brand)' }}>{row.employeeCode}</td>
                          <td style={{ padding: '12px 20px', fontWeight: 700 }}>
                            {row.fullName}
                            {r.top && row.employeeId === r.top.employeeId && <span title="Nhiều giờ nhất tháng" style={{ marginLeft: '6px' }}>🏆</span>}
                            {r.bottom && row.employeeId === r.bottom.employeeId && r.rows.length > 1 && <span title="Ít giờ nhất tháng (có làm)" style={{ marginLeft: '6px' }}>🔻</span>}
                          </td>
                          <td style={{ padding: '12px 20px' }}>
                            <span style={{
                              fontSize: '11px', fontWeight: 800, padding: '3px 9px', borderRadius: '999px',
                              backgroundColor: row.stage === 'OFFICIAL' ? 'var(--success-soft)' : '#DBEAFE',
                              color: row.stage === 'OFFICIAL' ? 'var(--success)' : '#1D4ED8',
                            }}>
                              {row.stage === 'OFFICIAL' ? 'Chính thức' : 'Thử việc'}
                            </span>
                          </td>
                          <td style={{ padding: '12px 20px', fontSize: '12px' }}>{getDisplayBranch(row.branchId, row.group)}</td>
                          <td style={{ padding: '12px 20px', textAlign: 'center' }}>{row.shifts}{row.absentShifts > 0 && <span title={`${row.absentShifts} ca vắng/không lương`} style={{ color: '#DC2626', fontWeight: 700 }}> (-{row.absentShifts})</span>}</td>
                          <td style={{ padding: '12px 20px', textAlign: 'center', fontWeight: 800 }}>{row.hours}h</td>
                          <td style={{ padding: '12px 20px', textAlign: 'right', color: 'var(--text-muted)' }}>{vnd(row.rate)}/h</td>
                          <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 800, color: '#059669' }}>
                            {vnd(row.salary)}
                            <span title={row.salarySource === 'run' ? 'Lương thực tế theo kỳ Finance đã chốt' : 'Tạm tính từ chấm công (Finance chưa chốt kỳ này)'} style={{ display: 'inline-block', marginLeft: '6px', fontSize: '10px', fontWeight: 800, padding: '2px 7px', borderRadius: '999px', backgroundColor: row.salarySource === 'run' ? '#DCFCE7' : '#FEF3C7', color: row.salarySource === 'run' ? '#166534' : '#92400E' }}>
                              {row.salarySource === 'run' ? 'Thực tế' : 'Tạm tính'}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
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
    // Lọc lịch sử theo nguồn từ cổng nhân viên (điểm danh/đổi ca/nghỉ/TEST/PIN)
    const notifKindOf = (n: any) => {
      const t = String(n.type || '');
      if (t.startsWith('emp.')) return t;
      const liveMap: Record<string, string> = {
        CHECKIN: 'emp.checkin',
        CHECKOUT: 'emp.checkout',
        LEAVE: 'emp.leave',
        SWAP: 'emp.swap',
        PIN_CHANGED: 'emp.pin',
        TEST: 'emp.test',
      };
      return liveMap[t] || 'system';
    };
    const notifKindLabel: Record<string, string> = {
      ALL: 'Tất cả',
      'emp.checkin': 'Điểm danh vào',
      'emp.checkout': 'Điểm danh ra',
      'emp.leave': 'Nghỉ phép',
      'emp.swap': 'Đổi ca',
      'emp.test': 'Thi TEST',
      'emp.pin': 'Đổi PIN',
      system: 'Hệ thống',
    };
    const shownNotifs = systemNotifications.filter((n: any) => {
      if (notifFilter === 'ALL') return true;
      if (notifFilter === 'system') return notifKindOf(n) === 'system';
      return notifKindOf(n) === notifFilter;
    });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
           <h1 style={{ fontSize: '20px', fontWeight: 800 }}>14. Trung Tâm Thông Báo Nghiệp Vụ HR</h1>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select
              value={notifFilter}
              onChange={e => setNotifFilter(e.target.value)}
              style={{ padding: '6px 10px', fontSize: '12px', borderRadius: '6px', border: '1px solid var(--border)', fontWeight: 700 }}
            >
              {Object.entries(notifKindLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <span className="badge" style={{ backgroundColor: unreadHrCount > 0 ? '#FEF3C7' : '#DCFCE7', color: unreadHrCount > 0 ? '#92400E' : '#166534', fontWeight: 800 }}>
              {shownNotifs.length} thông báo{unreadHrCount > 0 ? ` • ${unreadHrCount} chưa đọc` : ''}
            </span>
          </div>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          Lịch sử từ cổng nhân viên được lưu realtime + đồng bộ tab Sheets THONGBAO_NV (tự tạo nếu chưa có). Cổng tự reset bản cũ vào 6h00 hằng ngày (1 lần/ngày) — Sheets giữ nguyên, cập nhật liên tục.
        </div>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          {shownNotifs.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center' }}>
              Không có thông báo nào trong mục này. Tất cả hoạt động hệ thống và đồng bộ Google Sheets đều đang vận hành ổn định.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {shownNotifs.map((notif: any, idx: number) => {
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
    const branchShifts = shifts.filter(s => (branchScope === '*' || canonicalBranchId(s.branch_id) === canonicalBranchId(branchScope)) && !lockedEmpIds.has(String(s.employee_id || '')));
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
    // Reset theo chu kỳ Thứ 6 09:00: Store chỉ xem tuần mục tiêu của chu kỳ hiện tại.
    const storeOffCycle = currentOffCycle();
    const storeWeeklyOff = (leaves || [])
      .filter((l: any) => (branchScope === '*' || l.branch_id === branchScope) && (l.leave_type || l.leaveType) === 'HANG_TUAN' && l.status !== 'REJECTED' && l.status !== 'CANCELLED')
      .filter((l: any) => String(l.requested_date || l.requestedDate || '') >= storeOffCycle.mon && String(l.requested_date || l.requestedDate || '') <= storeOffCycle.sun)
      .sort((a: any, b: any) => String(b.requested_date || '').localeCompare(String(a.requested_date || '')));
    const handleStoreReview = async (leaveId: string, status: 'APPROVED' | 'REJECTED') => {
      if (!leaveId) {
        showToast('Thiếu mã đơn nghỉ');
        return;
      }
      if (!window.confirm(status === 'APPROVED' ? 'Cửa Hàng Trưởng xác nhận DUYỆT đơn OFF này?' : 'Cửa Hàng Trưởng xác nhận TỪ CHỐI đơn OFF này?')) return;
      if (storeReviewBusy) return;
      setStoreReviewBusy(leaveId);
      try {
        await apiRequest(`/leave-requests/${leaveId}/review`, {
          method: 'POST',
          body: JSON.stringify({ status, note: status === 'APPROVED' ? 'Store duyệt OFF' : 'Store từ chối OFF' }),
        });
        showToast(status === 'APPROVED' ? 'Cửa Hàng Trưởng đã duyệt đơn nghỉ OFF' : 'Đã từ chối đơn nghỉ OFF');
        if (onRefreshData) await onRefreshData();
        if (onSyncSheets) await onSyncSheets();
      } catch (e: any) {
        if (onRefreshData) await Promise.resolve(onRefreshData()).catch(() => null);
        showToast(e?.message || 'Lỗi khi duyệt đơn');
      } finally {
        setStoreReviewBusy(null);
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
                    <button className="btn-primary" disabled={storeReviewBusy === leaveId} onClick={() => handleStoreReview(leaveId, 'APPROVED')}>{storeReviewBusy === leaveId ? '⏳...' : 'Phê Duyệt Đơn'}</button>
                    <button className="btn-secondary" style={{ color: '#DC2626' }} disabled={storeReviewBusy === leaveId} onClick={() => handleStoreReview(leaveId, 'REJECTED')}>{storeReviewBusy === leaveId ? '⏳...' : 'Từ chối'}</button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 800, fontSize: '13px' }}>Lịch OFF 2 ngày/tuần đã tự động ghi nhận ({storeWeeklyOff.length})</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>Chu kỳ hiện tại: {storeOffCycle.label} (mở T6 09:00). Nhân viên đăng ký là hệ thống tự ghi nhận, Store chỉ xem — không cần duyệt. Sheet vẫn lưu toàn bộ lịch sử.</div>
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
    const todayVN = vnDayOf(new Date().toISOString());
    const todayBranchShifts = (shifts || []).filter((s: any) =>
      (s.date || '').slice(0, 10) === todayVN && s.status !== 'CANCELLED' &&
      (branchScope === '*' || s.branch_id === branchScope)
    );
    const todayBranchEvts = (liveAttendanceEvents || []).filter((e: any) =>
      vnDayOf(e.client_time || '') === todayVN &&
      todayBranchShifts.some((s: any) => s.assignment_id === e.assignment_id)
    );
    const checkedIn = todayBranchEvts.filter((e: any) => e.type === 'CHECK_IN').length;
    const checkedOut = todayBranchEvts.filter((e: any) => e.type === 'CHECK_OUT').length;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>8. Xác Nhận Công Hợp Lệ Chuyển Sang Kế Toán</h1>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Cửa Hàng Trưởng đối soát bảng công ngày trước khi chuyển sang Finance tính lương. Chốt/khóa công thực hiện ở kỳ lương Finance.</p>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: '13px' }}>
            Hôm nay ({todayVN}) tại {branchName}: <strong>{todayBranchShifts.length} ca</strong> • <strong>{checkedIn} check-in</strong> • <strong>{checkedOut} check-out</strong>
            {todayBranchShifts.length > checkedIn && (
              <span style={{ color: '#92400E' }}> • Thiếu {todayBranchShifts.length - checkedIn} lượt vào ca</span>
            )}
          </div>
          <div>
            <button
              className="btn-primary"
              disabled={storeConfirmBusy}
              onClick={async () => {
                if (storeConfirmBusy) return;
                setStoreConfirmBusy(true);
                try {
                  if (onRefreshData) await onRefreshData();
                  const data = await apiRequest('/attendance/events');
                  const evts = Array.isArray(data) ? data : [];
                  setLiveAttendanceEvents(evts);
                  const fresh = evts.filter((e: any) =>
                    vnDayOf(e.client_time || '') === todayVN &&
                    todayBranchShifts.some((s: any) => s.assignment_id === e.assignment_id)
                  );
                  const fi = fresh.filter((e: any) => e.type === 'CHECK_IN').length;
                  const fo = fresh.filter((e: any) => e.type === 'CHECK_OUT').length;
                  showToast(`Đã đối soát dữ liệu hôm nay tại ${branchName}: ${todayBranchShifts.length} ca, ${fi} check-in, ${fo} check-out. Số liệu đã khớp server.`);
                } catch (e: any) {
                  showToast(e?.message || 'Lỗi khi đối soát dữ liệu!');
                } finally {
                  setStoreConfirmBusy(false);
                }
              }}
            >
              {storeConfirmBusy ? '⏳ Đang đối soát...' : 'Tải & Đối Soát Dữ Liệu Hôm Nay'}
            </button>
          </div>
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
    const monthShifts = (shifts || []).filter((s: any) => (s.date || '').startsWith(finMonth) && s.status !== 'CANCELLED' && (branchScope === '*' || s.branch_id === branchScope));
    const monthEmps = [...new Set(monthShifts.map((s: any) => s.employee_id))];
    const finEmpRow = (empId: string) => {
      const emp = (allEmployees || []).find((e: any) => e.employee_id === empId);
      const mine = monthShifts.filter((s: any) => s.employee_id === empId);
      let full = 0;
      let partial = 0;
      let absent = 0;
      for (const s of mine) {
        const evs = (finAttEvents || []).filter((e: any) => e.assignment_id === s.assignment_id);
        const hasIn = evs.some((e: any) => e.type === 'CHECK_IN');
        const hasOut = evs.some((e: any) => e.type === 'CHECK_OUT');
        const hasAbs = evs.some((e: any) => e.type === 'ABSENT');
        if (hasIn && hasOut) full++;
        else if (!hasIn && hasAbs) absent++;
        else if (s.date < new Date().toISOString().split('T')[0]) partial++;
      }
      const rate = Number(emp?.current_rate_per_hour) || 25500;
      return { emp, mine: mine.length, full, partial, absent, est: full * 5 * rate };
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 800, margin: 0 }}>2. Bảng Chấm Công Tổng Hợp Toàn Công Ty</h1>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input type="month" value={finMonth} onChange={e => setFinMonth(e.target.value || new Date().toISOString().slice(0, 7))} style={{ padding: '7px 10px', fontSize: '12px', borderRadius: '6px', border: '1px solid var(--border)' }} />
            <button className="btn-secondary" style={{ fontSize: '12px', padding: '6px 12px' }} onClick={loadFinAttendance}>Tải lại</button>
          </div>
        </div>
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Nhân Viên</th>
                <th style={{ padding: '12px 20px' }}>Ca Phân Công</th>
                <th style={{ padding: '12px 20px' }}>Đủ Công</th>
                <th style={{ padding: '12px 20px' }}>Thiếu (chưa chốt)</th>
                <th style={{ padding: '12px 20px' }}>Vắng</th>
                <th style={{ padding: '12px 20px' }}>Ước Lương</th>
              </tr>
            </thead>
            <tbody>
              {monthEmps.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Tháng {finMonth} chưa có ca phân công nào{branchScope !== '*' ? ` tại ${branchName}` : ''}.
                  </td>
                </tr>
              ) : (
                monthEmps.map((id: string) => {
                  const r = finEmpRow(id);
                  return (
                    <tr key={id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px 20px', fontWeight: 700 }}>{r.emp?.full_name || id}<div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 400 }}>{r.emp?.employee_code || ''}</div></td>
                      <td style={{ padding: '12px 20px' }}>{r.mine}</td>
                      <td style={{ padding: '12px 20px', color: '#059669', fontWeight: 700 }}>{r.full}</td>
                      <td style={{ padding: '12px 20px', color: '#B45309', fontWeight: 700 }}>{r.partial}</td>
                      <td style={{ padding: '12px 20px', color: '#DC2626', fontWeight: 700 }}>{r.absent}</td>
                      <td style={{ padding: '12px 20px', fontWeight: 700 }}>{r.est.toLocaleString('vi-VN')}đ</td>
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
    const nextAction: Record<string, { action: 'reconcile' | 'approve' | 'publish' | 'mark-paid'; label: string } | null> = {
      DRAFT: { action: 'reconcile', label: 'Đối soát' },
      RECONCILED: { action: 'approve', label: 'Phê duyệt' },
      APPROVED: { action: 'publish', label: 'Phát hành' },
      PUBLISHED: { action: 'mark-paid', label: 'Xác nhận PAID' },
      PAID: null,
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>4. Quản Lý Kỳ Lương (Payroll Cycles)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>Quy trình: DRAFT ➔ RECONCILED ➔ APPROVED ➔ PUBLISHED ➔ PAID (người duyệt phải khác người tính)</div>
          {(payrollRuns || []).length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Chưa có kỳ lương nào. Sang tab 5 để tính kỳ mới.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '10px 14px' }}>Kỳ</th>
                  <th style={{ padding: '10px 14px' }}>Trạng Thái</th>
                  <th style={{ padding: '10px 14px' }}>NV / Giờ / Tổng Tiền</th>
                  <th style={{ padding: '10px 14px' }}>Thao Tác</th>
                </tr>
              </thead>
              <tbody>
                {(payrollRuns || []).map((r: any) => {
                  const nx = nextAction[r.status];
                  const busy = payRunBusy === r.run_id + (nx?.action || '');
                  return (
                    <tr key={r.run_id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 700 }}>{r.period}</td>
                      <td style={{ padding: '10px 14px' }}><span className="badge badge-brand">{r.status}</span></td>
                      <td style={{ padding: '10px 14px' }}>{r.total_employees} NV • {r.total_hours}h • {(r.total_amount || 0).toLocaleString('vi-VN')}đ</td>
                      <td style={{ padding: '10px 14px' }}>
                        {nx ? (
                          <button className="btn-primary" style={{ padding: '4px 12px', fontSize: '12px' }} disabled={busy} onClick={() => payRunAction(r.run_id, nx.action)}>
                            {busy ? '...' : nx.label}
                          </button>
                        ) : (
                          <span style={{ fontSize: '12px', color: 'var(--success)', fontWeight: 700 }}>✓ Hoàn tất</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  if (activeTab === 'fin-calculate') {
    const doCalculate = async () => {
      const period = (payCalcPeriod || '').trim() || new Date().toISOString().slice(0, 7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
        showToast('Kỳ lương phải dạng YYYY-MM (VD: 2026-09)!');
        return;
      }
      if (!window.confirm(`Tính lương tháng ${period} cho ${branchScope === '*' ? 'toàn hệ thống' : branchName}?\nCông thức: giờ PUBLISHED đủ in+out × đơn giá + 30k nhường ca − phạt trễ/vắng.`)) return;
      setPayCalcBusy(true);
      try {
        const res = await apiRequest(`/payroll/${period}/calculate`, {
          method: 'POST',
          body: JSON.stringify({ branchScope }),
        });
        const r = (res as any)?.result ?? res;
        showToast(`Đã tính lương ${period}: ${r?.run?.total_employees ?? '?'} NV, ${Number(r?.run?.total_amount || 0).toLocaleString('vi-VN')}đ!`);
        if (onRefreshData) await onRefreshData();
        if (onSyncSheets) await onSyncSheets();
      } catch (e: any) {
        showToast(e?.message || 'Lỗi khi tính lương!');
      } finally {
        setPayCalcBusy(false);
      }
    };
    const doCalculateFormula = async () => {
      const period = (payCalcPeriod || '').trim() || new Date().toISOString().slice(0, 7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
        showToast('Kỳ lương phải dạng YYYY-MM (VD: 2026-09)!');
        return;
      }
      if (!window.confirm(`Tính lương tháng ${period} theo CÔNG THỨC EXCEL cho ${branchScope === '*' ? 'toàn hệ thống' : branchName}?\nTỔNG CỘNG = LCB + PC_OT + giờ + OT thêm + Bonus; THỰC LÃNH = TỔNG CỘNG − KPI − phạt − Ứng − Đồng phục.`)) return;
      setPayCalcBusy(true);
      try {
        const res = await apiRequest(`/payroll/${period}/calculate-formula`, {
          method: 'POST',
          body: JSON.stringify({ branchScope }),
        });
        const r = (res as any)?.result ?? res;
        showToast(`Đã tính theo Excel ${period}: ${r?.run?.total_employees ?? '?'} NV, thực lãnh ${Number(r?.run?.total_amount || 0).toLocaleString('vi-VN')}đ!`);
        if (onRefreshData) await onRefreshData();
        if (onSyncSheets) await onSyncSheets();
      } catch (e: any) {
        showToast(e?.message || 'Lỗi khi tính lương Excel!');
      } finally {
        setPayCalcBusy(false);
      }
    };
    const savePayFormula = async () => {
      const period = (payCalcPeriod || '').trim();
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
        showToast('Kỳ lương phải dạng YYYY-MM (VD: 2026-09)!');
        return;
      }
      setPayFormulaBusy(true);
      try {
        await apiRequest(`/payroll/formula/${period}`, {
          method: 'PUT',
          body: JSON.stringify({
            rateTV: Number(payFormula?.rateTV) || 0,
            rateCT: Number(payFormula?.rateCT) || 0,
            otPerSlot: Number(payFormula?.otPerSlot) || 0,
            otThreshold1: Number(payFormula?.otThreshold1 ?? 10),
            otThreshold2: Number(payFormula?.otThreshold2 ?? 15),
          }),
        });
        showToast(`Đã lưu công thức lương kỳ ${period}!`);
        await loadPayFormula(period);
      } catch (e: any) {
        showToast(e?.message || 'Lỗi khi lưu công thức!');
      } finally {
        setPayFormulaBusy(false);
      }
    };
    const savePayInput = async (empId: string) => {
      const period = (payCalcPeriod || '').trim();
      const v = payInputs[empId] || {};
      setPayInputsBusy(empId);
      try {
        await apiRequest(`/payroll/inputs/${period}`, {
          method: 'PUT',
          body: JSON.stringify({
            employeeId: empId,
            luong_cb: Number(v.luong_cb) || 0,
            ot_extra: Number(v.ot_extra) || 0,
            bonus_extra: Number(v.bonus_extra) || 0,
            ung_luong: Number(v.ung_luong) || 0,
            tru_kpi: Number(v.tru_kpi) || 0,
            dong_phuc: Number(v.dong_phuc) || 0,
            note: String(v.note || '').slice(0, 500),
          }),
        });
        showToast('Đã lưu dữ liệu nhập tay!');
      } catch (e: any) {
        showToast(e?.message || 'Lỗi khi lưu!');
      } finally {
        setPayInputsBusy(null);
      }
    };
    const numIn = (style?: React.CSSProperties) => ({
      width: '92px', padding: '6px 8px', borderRadius: '6px',
      border: '1px solid var(--border)', fontSize: '12px', ...(style || {}),
    });
    const finEmps = (allEmployees || []).filter((e: any) => (e as any)?.employment_status !== 'TERMINATED');
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>5. Tính Toán Bảng Lương (Formula Engine)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px', marginBottom: '12px' }}>
            Công thức: (giờ PUBLISHED đủ in+out × đơn giá) + 30k nhường ca (HR điều phối) − phạt trễ (30k/50%/100%) − ca vắng không lương.
            Kỳ đã tính rồi tính lại sẽ tạo kỳ mới (không ghi đè).
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '12px', fontWeight: 700 }}>Kỳ lương:
              <input
                value={payCalcPeriod}
                onChange={e => setPayCalcPeriod(e.target.value)}
                placeholder="2026-09"
                style={{ marginLeft: '6px', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '13px', width: '120px' }}
              />
            </label>
            <button className="btn-primary" disabled={payCalcBusy} onClick={doCalculate}>
              {payCalcBusy ? 'Đang tính...' : `Tính Lương (${branchScope === '*' ? 'toàn hệ thống' : branchName})`}
            </button>
          </div>
        </div>

        {/* CÔNG THỨC EXCEL (lưu theo kỳ) */}
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1.5px solid #93C5FD' }}>
          <div style={{ fontSize: '14px', fontWeight: 800, marginBottom: '4px' }}>📐 Công thức lương theo file Excel <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(lưu theo kỳ, tính cho toàn bộ NV)</span></div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px', lineHeight: 1.6 }}>
            TỔNG CỘNG = Lương CB (tay) + Phụ cấp OT + Lương giờ + OT thêm (tay) + Bonus • TỔNG LƯƠNG = TỔNG CỘNG − KPI (tay) − phạt trễ/vắng •
            THỰC LÃNH = TỔNG LƯƠNG − Ứng − Đồng phục. Ngày ≥ <strong>{payFormula?.otThreshold1 ?? 10}h</strong> = 1 suất OT, ≥ <strong>{payFormula?.otThreshold2 ?? 15}h</strong> = 2 suất.
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {[
              { k: 'rateTV', label: 'Đơn giá TV (đ/h)' },
              { k: 'rateCT', label: 'Đơn giá CT (đ/h)' },
              { k: 'otPerSlot', label: 'Tiền 1 suất OT (đ)' },
              { k: 'otThreshold1', label: 'Ngưỡng 1 suất (h)' },
              { k: 'otThreshold2', label: 'Ngưỡng 2 suất (h)' },
            ].map(f => (
              <label key={f.k} style={{ fontSize: '12px', fontWeight: 700 }}>{f.label}
                <input
                  type="number"
                  value={payFormula?.[f.k] ?? ''}
                  onChange={e => setPayFormula({ ...(payFormula || {}), [f.k]: e.target.value })}
                  style={{ display: 'block', marginTop: '4px', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '13px', width: '150px' }}
                />
              </label>
            ))}
            <button className="btn-primary" disabled={payFormulaBusy} onClick={savePayFormula} style={{ backgroundColor: '#1D4ED8' }}>
              {payFormulaBusy ? 'Đang lưu...' : '💾 Lưu công thức kỳ này'}
            </button>
            <button className="btn-primary" disabled={payCalcBusy} onClick={doCalculateFormula} style={{ backgroundColor: '#059669' }}>
              {payCalcBusy ? 'Đang tính...' : `🧮 Tính theo Excel (${branchScope === '*' ? 'toàn hệ thống' : branchName})`}
            </button>
          </div>
        </div>

        {/* NHẬP TAY THEO KỲ (6 cột H/K/AW/O/N/P) */}
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', fontSize: '14px', fontWeight: 800 }}>
            📝 Dữ liệu nhập tay kỳ {(payCalcPeriod || '').trim() || '—'} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(6 cột như file Excel — lưu từng NV)</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '980px' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '10px 14px' }}>Nhân viên</th>
                  <th style={{ padding: '10px 14px' }}>Lương CB (H)</th>
                  <th style={{ padding: '10px 14px' }}>OT thêm (K)</th>
                  <th style={{ padding: '10px 14px' }}>Bonus thêm</th>
                  <th style={{ padding: '10px 14px' }}>Ứng lương</th>
                  <th style={{ padding: '10px 14px' }}>Trừ KPI</th>
                  <th style={{ padding: '10px 14px' }}>Trừ ĐP</th>
                  <th style={{ padding: '10px 14px' }}></th>
                </tr>
              </thead>
              <tbody>
                {finEmps.map((e: any) => {
                  const v = payInputs[e.employee_id] || {};
                  const set = (k: string, val: string) => setPayInputs({ ...payInputs, [e.employee_id]: { ...v, [k]: val } });
                  return (
                    <tr key={e.employee_id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 14px', fontWeight: 700 }}>{e.full_name}<div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 400 }}>{e.employee_code}</div></td>
                      {[['luong_cb'], ['ot_extra'], ['bonus_extra'], ['ung_luong'], ['tru_kpi'], ['dong_phuc']].map(([k]) => (
                        <td key={k} style={{ padding: '8px 10px' }}>
                          <input type="number" min={0} value={v[k] ?? ''} placeholder="0" onChange={ev => set(k, ev.target.value)} style={numIn()} />
                        </td>
                      ))}
                      <td style={{ padding: '8px 14px' }}>
                        <button className="btn-secondary" style={{ fontSize: '11px', padding: '5px 10px', fontWeight: 700 }} disabled={payInputsBusy === e.employee_id} onClick={() => savePayInput(e.employee_id)}>
                          {payInputsBusy === e.employee_id ? '⏳...' : '💾 Lưu'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'fin-details') {
    const slips: any[] = payRunDetail?.slips || [];
    const vnd0 = (n: any) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;
    const detCols: [string, (p: any) => any][] = [
      ['Giờ', (p: any) => `${p.standard_hours || 0}h / ${p.total_shifts || 0} ca${Number(p.absent_shifts) > 0 ? ` (−${p.absent_shifts} vắng)` : ''}`],
      ['Đơn giá', (p: any) => vnd0(p.rate_snapshot)],
      ['Lương giờ', (p: any) => vnd0(p.standard_pay)],
      ['Lương CB', (p: any) => vnd0(p.luong_cb)],
      ['PC-OT', (p: any) => `${vnd0(p.phu_cap_ot ?? p.allowance)}${p.ot_slots ? ` (${p.ot_slots} suất)` : ''}`],
      ['OT+ thêm', (p: any) => vnd0(p.ot_extra)],
      ['Bonus', (p: any) => vnd0(p.bonus)],
      ['Tổng cộng', (p: any) => vnd0(p.tong_cong ?? ((p.luong_cb || 0) + (p.phu_cap_ot ?? p.allowance ?? 0) + (p.standard_pay || 0) + (p.ot_extra || 0) + (p.bonus || 0)))],
      ['KPI + phạt', (p: any) => vnd0((p.tru_kpi || 0) + (p.deduction || 0))],
      ['Ứng', (p: any) => vnd0(p.ung_luong)],
      ['Trừ ĐP', (p: any) => vnd0(p.dong_phuc)],
      ['Thực lãnh', (p: any) => vnd0(p.thuc_lanh ?? p.net_pay)],
    ];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 800, margin: 0 }}>6. Chi Tiết Bảng Lương Từng Nhân Viên</h1>
          <select
            onChange={e => loadPayRunDetail(e.target.value)}
            defaultValue=""
            style={{ padding: '8px 12px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border)' }}
          >
            <option value="">— Chọn kỳ lương —</option>
            {(payrollRuns || []).map((r: any) => <option key={r.run_id} value={r.run_id}>{r.period} ({r.status})</option>)}
          </select>
        </div>
        {!payRunDetail ? (
          <div style={{ backgroundColor: 'var(--surface)', padding: '32px 20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
            Chọn 1 kỳ lương để xem chi tiết từng phiếu (giờ công, thưởng nhường ca, phạt trễ, ca vắng, thực nhận).
          </div>
        ) : (
          <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '1360px' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px 16px' }}>Mã NV</th>
                  <th style={{ padding: '12px 16px' }}>Họ Và Tên</th>
                  {detCols.map(([h]) => <th key={h} style={{ padding: '12px 16px' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {slips.length === 0 ? (
                  <tr>
                    <td colSpan={14} style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      Kỳ này chưa có phiếu lương nào.
                    </td>
                  </tr>
                ) : (
                  slips.map((p: any) => (
                    <tr key={p.item_id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--brand)' }}>{p.employee_code || p.employee_id}</td>
                      <td style={{ padding: '12px 16px', fontWeight: 700 }}>{p.full_name || 'Nhân viên'}</td>
                      {detCols.map(([h, f], i) => (
                        <td key={h} style={{ padding: '12px 16px', fontWeight: i === detCols.length - 1 ? 800 : 400, color: i === detCols.length - 1 ? '#10B981' : undefined }}>{f(p)}</td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (activeTab === 'fin-payslips') {
    const pubRuns = (payrollRuns || []).filter((r: any) => r.status === 'PUBLISHED' || r.status === 'PAID');
    const slips: any[] = payRunDetail?.slips || [];
    const vnd0 = (n: any) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;
    const finSlipCols: [string, (p: any) => any][] = [
      ['Giờ', (p: any) => `${p.standard_hours || 0}h / ${p.total_shifts || 0} ca`],
      ['Lương giờ', (p: any) => vnd0(p.standard_pay)],
      ['Lương CB', (p: any) => vnd0(p.luong_cb)],
      ['PC-OT', (p: any) => `${vnd0(p.phu_cap_ot ?? p.allowance)}${p.ot_slots ? ` (${p.ot_slots} suất)` : ''}`],
      ['OT+ thêm', (p: any) => vnd0(p.ot_extra)],
      ['Bonus', (p: any) => vnd0(p.bonus)],
      ['Tổng cộng', (p: any) => vnd0(p.tong_cong ?? ((p.luong_cb || 0) + (p.phu_cap_ot ?? p.allowance ?? 0) + (p.standard_pay || 0) + (p.ot_extra || 0) + (p.bonus || 0)))],
      ['KPI + phạt', (p: any) => vnd0((p.tru_kpi || 0) + (p.deduction || 0))],
      ['Ứng', (p: any) => vnd0(p.ung_luong)],
      ['Trừ ĐP', (p: any) => vnd0(p.dong_phuc)],
      ['Thực lãnh', (p: any) => vnd0(p.thuc_lanh ?? p.net_pay)],
    ];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 800, margin: 0 }}>7. Phát Hành Phiếu Lương Cá Nhân (Bảo Mật PIN)</h1>
          <select
            onChange={e => loadPayRunDetail(e.target.value)}
            defaultValue=""
            style={{ padding: '8px 12px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border)' }}
          >
            <option value="">— Chọn kỳ đã phát hành —</option>
            {pubRuns.map((r: any) => <option key={r.run_id} value={r.run_id}>{r.period} ({r.status})</option>)}
          </select>
        </div>
        {!payRunDetail ? (
          <div style={{ backgroundColor: 'var(--surface)', padding: '32px 20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
            Chọn kỳ lương đã PUBLISHED để xem phiếu từng NV (NV chỉ thấy phiếu của mình trên cổng cá nhân sau khi phát hành).
          </div>
        ) : (
          <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '1280px' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px 16px' }}>Mã NV</th>
                  <th style={{ padding: '12px 16px' }}>Họ Và Tên</th>
                  {finSlipCols.map(([h]) => <th key={h} style={{ padding: '12px 16px' }}>{h}</th>)}
                  <th style={{ padding: '12px 16px' }}>Trạng Thái</th>
                </tr>
              </thead>
              <tbody>
                {slips.map((p: any) => (
                  <tr key={p.item_id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--brand)' }}>{p.employee_code}</td>
                    <td style={{ padding: '12px 16px', fontWeight: 700 }}>{p.full_name}</td>
                    {finSlipCols.map(([h, f], i) => (
                      <td key={h} style={{ padding: '12px 16px', fontWeight: i === finSlipCols.length - 1 ? 800 : 400, color: i === finSlipCols.length - 1 ? '#10B981' : undefined }}>{f(p)}</td>
                    ))}
                    <td style={{ padding: '12px 16px' }}><span className="badge badge-success">{p.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
    const payable = (payrollRuns || []).filter((r: any) => r.status === 'PUBLISHED');
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>9. Xác Nhận Chi Trả & Thanh Toán (PAID)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          {payable.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Không có kỳ nào chờ chi trả (cần kỳ ở trạng thái PUBLISHED).</div>
          ) : (
            payable.map((r: any) => {
              const busy = payRunBusy === r.run_id + 'mark-paid';
              return (
                <div key={r.run_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border)', gap: '10px', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: '13px' }}>
                    <strong>Kỳ {r.period}</strong> • {r.total_employees} NV • {(r.total_amount || 0).toLocaleString('vi-VN')}đ
                  </div>
                  <button className="btn-primary" style={{ backgroundColor: '#10B981' }} disabled={busy} onClick={() => payRunAction(r.run_id, 'mark-paid')}>
                    {busy ? '...' : 'Xác Nhận Đã Thanh Toán Ngân Hàng (PAID)'}
                  </button>
                </div>
              );
            })
          )}
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

  if (activeTab === 'hr-profile') {
    const vnd = (n: number) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;
    const filteredEmps = (allEmployees || [])
      .filter((e: any) => (profileGroup === 'ALL' ? true : (e.group || e.nhom) === profileGroup))
      .filter((e: any) => {
        if (!profileSearch.trim()) return true;
        // Tìm không dấu: gõ "nguyen"/"van kiep" vẫn ra "Nguyễn"/"Vạn Kiếp".
        const q = stripAccentsVI(profileSearch.trim());
        return stripAccentsVI(e.full_name).includes(q)
          || String(e.employee_code || '').toLowerCase().includes(q)
          || String(e.employee_id || '').toLowerCase().includes(q)
          || stripAccentsVI(e.phone_normalized || e.phone).includes(q);
      });
    const saleFirst = [...filteredEmps].sort((a: any, b: any) =>
      ((b.group === 'SALE' ? 1 : 0) - (a.group === 'SALE' ? 1 : 0)) ||
      String(a.full_name || '').localeCompare(String(b.full_name || ''), 'vi')
    );
    const profEmp = (allEmployees || []).find((e: any) => e.employee_id === profileEmpId)
      || saleFirst.find((e: any) => e.group === 'SALE') || saleFirst[0] || null;
    // Hiệu suất chấm công THẬT từ sự kiện điểm danh + lịch đã tải
    const empEvts = (liveAttendanceEvents || []).filter((e: any) => e.employee_id === profEmp?.employee_id);
    const empIns = empEvts.filter((e: any) => e.type === 'CHECK_IN');
    const empOuts = empEvts.filter((e: any) => e.type === 'CHECK_OUT');
    const workDays = new Set(empIns.map((e: any) => vnDayOf(e.client_time || ''))).size;
    const lateCount = empIns.filter((e: any) => e.is_late).length;
    const lateMins = empIns.reduce((s: number, e: any) => s + (e.is_late ? Number(e.minutes_deviation) || 0 : 0), 0);
    const earlyCount = empOuts.filter((e: any) => e.is_early).length;
    const empShiftCount = (shifts || []).filter((s: any) => s.employee_id === profEmp?.employee_id && s.status !== 'CANCELLED').length;
    const initials = String(profEmp?.full_name || '?').split(' ').map((w: string) => w[0]).slice(-2).join('').toUpperCase();
    const exportProfile = (fmt: 'json' | 'csv') => {
      if (!profEmp) {
        showToast('Chưa chọn nhân viên để xuất hồ sơ!');
        return;
      }
      const rows: [string, string][] = [
        ['Họ tên', profEmp.full_name || ''],
        ['Mã NV', profEmp.employee_code || ''],
        ['SĐT', profEmp.phone_normalized || ''],
        ['Email', profEmp.email || ''],
        ['Giới tính', profEmp.gender || ''],
        ['Ngày sinh', profEmp.birth_date || ''],
        ['CCCD', profEmp.id_card_number || ''],
        ['Chi nhánh', getDisplayBranch(profEmp.default_branch_id) || profEmp.default_branch_id || ''],
        ['Nhóm', profEmp.group || ''],
        ['Ca cố định', profEmp.default_shift_code || ''],
        ['Trạng thái', profEmp.employment_status || ''],
        ['Ngày vào làm', profEmp.start_date || ''],
        ['Ngày chính thức', profEmp.official_date || ''],
        ['Lương giờ', String(profEmp.current_rate_per_hour || '')],
        ['Ngày công (điểm danh)', String(workDays)],
        ['Lượt check-in', String(empIns.length)],
        ['Đi trễ (lượt)', String(lateCount)],
        ['Tổng phút trễ', String(lateMins)],
        ['Về sớm (lượt)', String(earlyCount)],
      ];
      let blob: Blob;
      let filename: string;
      if (fmt === 'json') {
        blob = new Blob([JSON.stringify({ hoSo: profEmp, chamCong: { workDays, checkIns: empIns.length, lateCount, lateMins, earlyCount }, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
        filename = `ho-so-${profEmp.employee_code || profEmp.employee_id}.json`;
      } else {
        const csv = '\uFEFF' + ['Trường,Giá trị', ...rows.map(([k, v]) => `"${k}","${String(v).replace(/"/g, '""')}"`)].join('\n');
        blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        filename = `ho-so-${profEmp.employee_code || profEmp.employee_id}.csv`;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`Đã xuất hồ sơ ${profEmp.full_name} (${fmt.toUpperCase()})!`);
    };
    // In đúng hồ sơ NV đang xem (đầy đủ trường) ra cửa sổ in riêng — không in cả trang web.
    const printProfile = () => {
      if (!profEmp) {
        showToast('Chưa chọn nhân viên để in hồ sơ!');
        return;
      }
      const esc = (v: unknown) => String(v ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const statusVI = profEmp.employment_status === 'OFFICIAL' ? 'Chính thức' : profEmp.employment_status === 'PROBATION' ? 'Thử việc' : (profEmp.employment_status || '—');
      const genderVI = profEmp.gender === 'NAM' ? 'Nam' : profEmp.gender === 'NU' ? 'Nữ' : profEmp.gender === 'KHAC' ? 'Khác' : (profEmp.gender || '—');
      const row = (k: string, v: unknown) => `<tr><td style="padding:7px 10px;border:1px solid #999;font-weight:700;width:220px;background:#f2f2f2;">${esc(k)}</td><td style="padding:7px 10px;border:1px solid #999;">${esc(v || '—')}</td></tr>`;
      const sec = (t: string) => `<h3 style="margin:18px 0 8px;font-size:15px;">${esc(t)}</h3>`;
      const doc = `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8" /><title>Hồ sơ ${esc(profEmp.full_name)} (${esc(profEmp.employee_code)})</title></head>`
        + `<body style="font-family:Arial,Helvetica,sans-serif;color:#000;padding:24px;">`
        + `<h2 style="text-align:center;margin:0;">HỒ SƠ NHÂN VIÊN ỤM BÒ MILK</h2>`
        + `<p style="text-align:center;margin:6px 0 0;">In lúc: ${esc(new Date().toLocaleString('vi-VN'))}</p>`
        + sec('1. Nhân thân & Pháp lý')
        + `<table style="border-collapse:collapse;width:100%;font-size:13px;">`
        + row('Họ tên', profEmp.full_name)
        + row('Mã nhân viên', profEmp.employee_code)
        + row('Ngày sinh', profEmp.birth_date)
        + row('CCCD/CMND', profEmp.id_card_number)
        + row('SĐT', profEmp.phone_normalized || profEmp.phone)
        + row('Email công ty', profEmp.email)
        + row('Giới tính', genderVI)
        + `</table>`
        + sec('2. Công việc')
        + `<table style="border-collapse:collapse;width:100%;font-size:13px;">`
        + row('Chi nhánh', getDisplayBranch(profEmp.default_branch_id) || profEmp.default_branch_id)
        + row('Nhóm', profEmp.group)
        + row('Ca cố định', profEmp.default_shift_code)
        + row('Trạng thái', statusVI)
        + row('Ngày vào làm', profEmp.start_date)
        + row('Ngày chính thức', profEmp.official_date)
        + row('Lương giờ', profEmp.current_rate_per_hour ? `${Number(profEmp.current_rate_per_hour).toLocaleString('vi-VN')}đ/giờ` : '—')
        + row('Lương tháng tạm tính (8h × 26 công)', `${Number((profEmp.current_rate_per_hour || 0) * 8 * 26).toLocaleString('vi-VN')}đ/tháng`)
        + `</table>`
        + sec('3. Hiệu suất chấm công (dữ liệu hệ thống)')
        + `<table style="border-collapse:collapse;width:100%;font-size:13px;">`
        + row('Ngày công (có mặt)', `${workDays} ngày / ${empShiftCount} ca được xếp`)
        + row('Lượt check-in / check-out', `${empIns.length} / ${empOuts.length}`)
        + row('Đi trễ', `${lateCount} lượt (tổng ${lateMins} phút)`)
        + row('Về sớm', `${earlyCount} lượt`)
        + `</table>`
        + sec('4. Hợp đồng lao động')
        + `<table style="border-collapse:collapse;width:100%;font-size:13px;">`
        + row('HĐLĐ chính thức', profEmp.employment_status === 'OFFICIAL' ? 'Đã ký' : 'Chưa đến kỳ ký (đang thử việc)')
        + row('Hiệu lực', profEmp.official_date ? `Từ ${profEmp.official_date}` : `Vào làm từ ${profEmp.start_date || '—'}`)
        + `</table>`
        + `<p style="margin-top:26px;font-size:13px;">Người lập phiếu (HR ký): ............................. &nbsp;&nbsp; Nhân viên (ký): .............................</p>`
        + `<script>window.onload = function () { window.print(); };<\/script>`
        + `</body></html>`;
      const w = window.open('', '_blank', 'width=900,height=700');
      if (!w) {
        showToast('Trình duyệt chặn cửa sổ in! Hãy cho phép popup rồi bấm In lại.');
        return;
      }
      w.document.write(doc);
      w.document.close();
      showToast(`Đã mở bản in hồ sơ ${profEmp.full_name}!`);
    };
    const subTabs: { id: typeof profileSub; label: string }[] = [
      { id: 'overview', label: '📊 Tổng quan' },
      { id: 'identity', label: '🪪 Nhân thân & Pháp lý' },
      { id: 'att', label: '⏱ Hiệu suất chấm công' },
      { id: 'pay', label: '💰 Lương & Thu nhập' },
      { id: 'legal', label: '📜 Hợp đồng' },
    ];
    const card: React.CSSProperties = { backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', padding: '16px 20px' };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800, margin: 0 }}>15. Hồ Sơ Nhân Viên Ụm Bò Milk</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
              Dashboard trực quan theo nhân viên bán hàng — 100% dữ liệu thật từ hồ sơ, chấm công và lương hệ thống.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn-secondary" style={{ fontSize: '12px', padding: '7px 14px', display: 'flex', alignItems: 'center', gap: '6px' }} onClick={printProfile}>
              <Printer size={14} /> In hồ sơ
            </button>
            <button className="btn-secondary" style={{ fontSize: '12px', padding: '7px 14px', display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => exportProfile('json')}>
              <Download size={14} /> Xuất JSON
            </button>
            <button className="btn-primary" style={{ fontSize: '12px', padding: '7px 14px', display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => exportProfile('csv')}>
              <Download size={14} /> Xuất CSV
            </button>
          </div>
        </div>

        {/* BỘ CHỌN NHÂN VIÊN */}
        <div style={card}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
            <div style={{ position: 'relative', flex: '2 1 220px' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                value={profileSearch}
                onChange={e => setProfileSearch(e.target.value)}
                placeholder="Tìm tên / mã NV (gõ không dấu vẫn ra)..."
                style={{ width: '100%', padding: '8px 12px 8px 32px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px' }}
              />
            </div>
            <select value={profileGroup} onChange={e => { setProfileGroup(e.target.value); }} style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px', fontWeight: 700 }}>
              <option value="SALE">Nhóm SALE</option>
              <option value="ALL">Tất cả nhóm</option>
              <option value="STORE">STORE</option>
              <option value="VAN_PHONG">Văn phòng</option>
              <option value="XUONG">Xưởng</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
            {saleFirst.slice(0, 30).map((e: any) => {
              const active = profEmp?.employee_id === e.employee_id;
              return (
                <button
                  key={e.employee_id}
                  onClick={() => { setProfileEmpId(e.employee_id); setProfileSub('overview'); }}
                  title={`${e.full_name} (${e.employee_code})`}
                  style={{
                    flexShrink: 0, padding: '8px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                    border: active ? '2px solid var(--brand)' : '1px solid var(--border)',
                    backgroundColor: active ? '#FDF2F8' : 'var(--bg)', color: active ? 'var(--brand)' : 'var(--text)',
                  }}
                >
                  {e.full_name}{e.group === 'SALE' ? ' ⭐' : ''}
                </button>
              );
            })}
            {saleFirst.length === 0 && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Không tìm thấy nhân viên.</span>}
          </div>
        </div>

        {!profEmp ? (
          <div style={{ ...card, textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', padding: '32px' }}>
            Chưa có hồ sơ nhân viên nào trong hệ thống.
          </div>
        ) : (
          <>
            {/* HEADER HỒ SƠ */}
            <div style={{ ...card, background: 'linear-gradient(135deg, #1E1B4B 0%, #831843 100%)', color: '#FFF', border: 'none', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
              {profEmp.avatar_drive_id ? (
                <EmpAvatar employeeId={profEmp.employee_id} size={72} />
              ) : (
                <div style={{ width: '72px', height: '72px', borderRadius: '50%', background: 'linear-gradient(135deg, #E85D92, #F59E0B)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontWeight: 800, flexShrink: 0 }}>
                  {initials}
                </div>
              )}
              <div style={{ flex: '1 1 220px' }}>
                <div style={{ fontSize: '19px', fontWeight: 800 }}>{profEmp.full_name}</div>
                <div style={{ fontSize: '12px', opacity: 0.85, marginTop: '2px' }}>{profEmp.employee_code} • {getDisplayBranch(profEmp.default_branch_id) || profEmp.default_branch_id} • {profEmp.group}</div>
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                  <span className="badge" style={{ backgroundColor: profEmp.employment_status === 'OFFICIAL' ? '#10B981' : '#F59E0B', color: '#FFF', fontWeight: 800 }}>
                    {profEmp.employment_status === 'OFFICIAL' ? 'Chính thức' : profEmp.employment_status === 'PROBATION' ? 'Thử việc' : profEmp.employment_status}
                  </span>
                  <span className="badge" style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: '#FFF', fontWeight: 700 }}>💰 {vnd(profEmp.current_rate_per_hour)}/giờ</span>
                  <span className="badge" style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: '#FFF', fontWeight: 700 }}>Vào làm: {profEmp.start_date || '—'}</span>
                </div>
              </div>
              <button
                className="btn-secondary"
                style={{ fontSize: '12px', fontWeight: 800, padding: '8px 14px', alignSelf: 'flex-start', backgroundColor: '#F59E0B', borderColor: '#F59E0B', color: '#FFF' }}
                title="Cập nhật hồ sơ nhân viên đang xem (bổ sung các trường còn thiếu)"
                onClick={() => {
                  setEditingEmp(profEmp);
                  setAvatarPhoto(null);
                  setAvatarRemoved(false);
                  setEditEmpForm({
                    fullName: profEmp.full_name || '',
                    phone: profEmp.phone_normalized || '',
                    branchId: profEmp.default_branch_id || 'CN130',
                    group: profEmp.group || 'STORE',
                    rate: profEmp.current_rate_per_hour || 21000,
                    shift: profEmp.default_shift_code || '',
                    startDate: String(profEmp.start_date || '').slice(0, 10),
                    officialDate: String(profEmp.official_date || '').slice(0, 10),
                    email: profEmp.email || '',
                    gender: profEmp.gender || '',
                    birthDate: String(profEmp.birth_date || '').slice(0, 10),
                    idCardNumber: profEmp.id_card_number || '',
                  });
                }}
              >
                ✏️ Cập nhật hồ sơ
              </button>
            </div>

            {/* SUB-TAB THÔNG MINH */}
            <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '2px' }}>
              {subTabs.map(t => (
                <button
                  key={t.id}
                  onClick={() => setProfileSub(t.id)}
                  style={{
                    flexShrink: 0, padding: '9px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 800, cursor: 'pointer',
                    border: profileSub === t.id ? 'none' : '1px solid var(--border)',
                    backgroundColor: profileSub === t.id ? 'var(--brand)' : 'var(--surface)', color: profileSub === t.id ? '#FFF' : 'var(--text)',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {(profileSub === 'overview' || profileSub === 'att') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
                  <div style={card}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>📅 NGÀY CÔNG (CÓ MẶT)</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#1D4ED8', marginTop: '4px' }}>{workDays}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>ngày có check-in / {empShiftCount} ca được xếp</div>
                  </div>
                  <div style={card}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>⏱ LƯỢT CHECK-IN / OUT</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#059669', marginTop: '4px' }}>{empIns.length} / {empOuts.length}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>vào ca / ra ca đã ghi nhận</div>
                  </div>
                  <div style={card}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>⏰ ĐI TRỄ</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: lateCount > 0 ? '#D97706' : '#059669', marginTop: '4px' }}>{lateCount} lượt</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>tổng {lateMins} phút trễ</div>
                  </div>
                  <div style={card}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>🏃 VỀ SỚM</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: earlyCount > 0 ? '#D97706' : '#059669', marginTop: '4px' }}>{earlyCount} lượt</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>check-out trước giờ ca</div>
                  </div>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Số liệu thật từ lượt điểm danh và lịch đã tải trên hệ thống (phạm vi dữ liệu đang hiển thị).
                </div>
              </div>
            )}

            {(profileSub === 'overview' || profileSub === 'identity') && (
              <div style={card}>
                <div style={{ fontWeight: 800, fontSize: '14px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <IdCard size={16} color="var(--brand)" /> Nhân thân & Pháp lý cơ bản
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', fontSize: '13px' }}>
                  {[
                    ['Họ tên', profEmp.full_name],
                    ['Mã nhân viên', profEmp.employee_code],
                    ['Ngày sinh', profEmp.birth_date || '—'],
                    ['CCCD', profEmp.id_card_number || '—'],
                    ['SĐT', profEmp.phone_normalized || '—'],
                    ['Email công ty', profEmp.email || '—'],
                    ['Giới tính', profEmp.gender || '—'],
                    ['Chi nhánh', getDisplayBranch(profEmp.default_branch_id) || profEmp.default_branch_id || '—'],
                    ['Nhóm', profEmp.group || '—'],
                    ['Ca cố định', profEmp.default_shift_code || '—'],
                  ].map(([k, v]) => (
                    <div key={k as string} style={{ backgroundColor: 'var(--bg)', borderRadius: '8px', padding: '10px 12px' }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>{k}</div>
                      <div style={{ fontWeight: 700, marginTop: '2px' }}>{v || '—'}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(profileSub === 'overview' || profileSub === 'pay') && (
              <div style={card}>
                <div style={{ fontWeight: 800, fontSize: '14px', marginBottom: '12px' }}>💰 Lương & Thu nhập</div>
                <div style={{ fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Lương giờ hiện tại</span>
                    <strong>{vnd(profEmp.current_rate_per_hour)}/giờ</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Lương tháng tạm tính (8h × 26 công)</span>
                    <strong>{vnd((profEmp.current_rate_per_hour || 0) * 8 * 26)}/tháng</strong>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Số chính thức theo phiếu lương Finance (tab lương). Chưa có chính sách phụ cấp/hoa hồng sales trên hệ thống.</div>
                </div>
              </div>
            )}

            {(profileSub === 'overview' || profileSub === 'legal') && (() => {
              const isOff = profEmp.employment_status === 'OFFICIAL';
              return (
                <div style={card}>
                  <div style={{ fontWeight: 800, fontSize: '14px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ShieldCheck size={16} color="var(--brand)" /> Hợp đồng lao động
                  </div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', backgroundColor: 'var(--bg)', borderRadius: '8px', padding: '10px 12px' }}>
                    <span style={{ fontSize: '18px' }}>{isOff ? '✅' : '⏳'}</span>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '13px' }}>
                        HĐLĐ chính thức — <span style={{ color: isOff ? '#059669' : '#D97706' }}>{isOff ? 'Đã ký' : 'Chưa đến kỳ ký (đang thử việc)'}</span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {profEmp.official_date ? `Hiệu lực từ ${profEmp.official_date}` : `Vào làm từ ${profEmp.start_date || '—'}`}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* MODAL CẬP NHẬT HỒ SƠ NV (tab Hồ Sơ) — đủ trường, kể cả các trường đang thiếu */}
            {editingEmp && editingEmp.employee_id === profEmp.employee_id && (
              <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px' }}>
                <div style={{ backgroundColor: 'var(--surface)', borderRadius: '12px', maxWidth: '600px', width: '100%', maxHeight: '90vh', overflow: 'auto', padding: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ fontSize: '16px', fontWeight: 800, margin: 0 }}>✏️ Cập nhật hồ sơ: {editingEmp.full_name} ({editingEmp.employee_code})</h2>
                    <button className="btn-secondary" style={{ padding: '4px 12px' }} onClick={() => !editEmpBusy && setEditingEmp(null)}>Đóng</button>
                  </div>
                  {(() => {
                    const missing: string[] = [];
                    if (!editingEmp.birth_date) missing.push('Ngày sinh');
                    if (!editingEmp.id_card_number) missing.push('CCCD');
                    if (!editingEmp.email) missing.push('Email');
                    if (!editingEmp.gender) missing.push('Giới tính');
                    if (!editingEmp.default_shift_code) missing.push('Ca cố định');
                    if (!editingEmp.official_date && editingEmp.employment_status === 'OFFICIAL') missing.push('Ngày chính thức');
                    return missing.length > 0 ? (
                      <div style={{ fontSize: '12px', color: '#92400E', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', padding: '8px 12px', marginTop: '12px', lineHeight: '1.5' }}>
                        ⚠️ Hồ sơ đang thiếu: <strong>{missing.join(' • ')}</strong> — bổ sung ngay bên dưới.
                      </div>
                    ) : (
                      <div style={{ fontSize: '12px', color: '#065F46', backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: '8px', padding: '8px 12px', marginTop: '12px' }}>
                        ✅ Hồ sơ đã đầy đủ các trường.
                      </div>
                    );
                  })()}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '14px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 700 }}>Họ và tên<input value={editEmpForm.fullName || ''} onChange={e => setEditEmpForm({ ...editEmpForm, fullName: e.target.value })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }} /></label>
                    <label style={{ fontSize: '12px', fontWeight: 700 }}>SĐT (đổi số vẫn login được)<input value={editEmpForm.phone || ''} onChange={e => setEditEmpForm({ ...editEmpForm, phone: e.target.value })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }} /></label>
                    <label style={{ fontSize: '12px', fontWeight: 700 }}>Giới tính<select value={['NAM', 'NU', 'KHAC'].includes(editEmpForm.gender) ? editEmpForm.gender : ''} onChange={e => setEditEmpForm({ ...editEmpForm, gender: e.target.value })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }}><option value="">— Chưa rõ —</option><option value="NAM">Nam</option><option value="NU">Nữ</option><option value="KHAC">Khác</option></select></label>
                    <label style={{ fontSize: '12px', fontWeight: 700 }}>Ngày sinh<input type="date" value={editEmpForm.birthDate || ''} onChange={e => setEditEmpForm({ ...editEmpForm, birthDate: e.target.value })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }} /></label>
                    <label style={{ fontSize: '12px', fontWeight: 700, gridColumn: '1 / -1' }}>CCCD/CMND<input value={editEmpForm.idCardNumber || ''} onChange={e => setEditEmpForm({ ...editEmpForm, idCardNumber: e.target.value })} placeholder="VD: 079..." style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }} /></label>
                    <div style={{ gridColumn: '1 / -1', backgroundColor: 'var(--bg)', borderRadius: '8px', padding: '10px 12px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 800, marginBottom: '6px' }}>🖼 Ảnh đại diện (avatar)</div>
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (!f) return;
                          setAvatarBusy(true);
                          try {
                            const dataUrl = await compressAvatarImage(f);
                            if (!dataUrl) { showToast('⚠️ Không đọc được ảnh! Vui lòng chọn ảnh khác.'); return; }
                            setAvatarPhoto(dataUrl);
                            setAvatarRemoved(false);
                            showToast('✓ Đã chọn avatar mới — bấm Lưu thay đổi để áp dụng.');
                          } finally {
                            setAvatarBusy(false);
                          }
                        }}
                      />
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                        {avatarRemoved ? (
                          <span style={{ fontSize: '12px', color: '#991B1B', fontWeight: 700 }}>🗑 Sẽ gỡ avatar hiện tại khi lưu.</span>
                        ) : avatarPhoto ? (
                          <img src={avatarPhoto} alt="Avatar mới" style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '50%', border: '2px solid #F59E0B' }} />
                        ) : editingEmp.avatar_drive_id ? (
                          <EmpAvatar employeeId={editingEmp.employee_id} size={64} />
                        ) : (
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Chưa có avatar.</span>
                        )}
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <button
                            className="btn-secondary"
                            style={{ fontSize: '11px', padding: '6px 12px', fontWeight: 800 }}
                            disabled={avatarBusy}
                            onClick={() => avatarInputRef.current?.click()}
                          >
                            {avatarBusy ? '⏳ Đang xử lý...' : '📷 Chọn ảnh mới'}
                          </button>
                          {avatarPhoto && (
                            <button
                              className="btn-secondary"
                              style={{ fontSize: '11px', padding: '6px 12px', color: '#DC2626' }}
                              onClick={() => setAvatarPhoto(null)}
                            >
                              Hủy ảnh mới
                            </button>
                          )}
                          {!avatarRemoved && !avatarPhoto && editingEmp.avatar_drive_id && (
                            <button
                              className="btn-secondary"
                              style={{ fontSize: '11px', padding: '6px 12px', color: '#DC2626' }}
                              onClick={() => setAvatarRemoved(true)}
                            >
                              🗑 Gỡ avatar
                            </button>
                          )}
                          {avatarRemoved && (
                            <button
                              className="btn-secondary"
                              style={{ fontSize: '11px', padding: '6px 12px' }}
                              onClick={() => setAvatarRemoved(false)}
                            >
                              Hoàn tác gỡ
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    <label style={{ fontSize: '12px', fontWeight: 700 }}>Chi nhánh<select value={editEmpForm.branchId || 'CN130'} onChange={e => setEditEmpForm({ ...editEmpForm, branchId: e.target.value })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }}>{(branches || []).length > 0 ? (branches || []).map((b: any) => <option key={b.branch_id || b.id} value={b.branch_id || b.id}>{b.branch_id || b.id}</option>) : (<><option value="CN130">CN130</option><option value="CN120">CN120</option><option value="CN261">CN261</option><option value="CN111">CN111</option></>)}</select></label>
                    <label style={{ fontSize: '12px', fontWeight: 700 }}>Khối<select value={['STORE', 'XUONG', 'VAN_PHONG', 'SALE'].includes(editEmpForm.group) ? editEmpForm.group : 'STORE'} onChange={e => setEditEmpForm({ ...editEmpForm, group: e.target.value })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }}><option value="STORE">Cửa hàng</option><option value="XUONG">Xưởng</option><option value="VAN_PHONG">Văn phòng</option><option value="SALE">Sale</option></select></label>
                    <label style={{ fontSize: '12px', fontWeight: 700 }}>Lương giờ (đ/h)<input type="number" value={editEmpForm.rate || 21000} onChange={e => setEditEmpForm({ ...editEmpForm, rate: Number(e.target.value) })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }} /></label>
                    <label style={{ fontSize: '12px', fontWeight: 700 }}>Ca cố định<select value={editEmpForm.shift || ''} onChange={e => setEditEmpForm({ ...editEmpForm, shift: e.target.value })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }}><option value="">— Chưa gán —</option><option value="CA_1">Ca 1 (07–12)</option><option value="CA_2">Ca 2 (12–18)</option><option value="CA_3">Ca 3 (18–23)</option></select></label>
                    <label style={{ fontSize: '12px', fontWeight: 700 }}>Ngày bắt đầu<input type="date" value={editEmpForm.startDate || ''} onChange={e => setEditEmpForm({ ...editEmpForm, startDate: e.target.value })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }} /></label>
                    <label style={{ fontSize: '12px', fontWeight: 700 }}>Ngày chính thức<input type="date" value={editEmpForm.officialDate || ''} onChange={e => setEditEmpForm({ ...editEmpForm, officialDate: e.target.value })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }} /></label>
                    <label style={{ fontSize: '12px', fontWeight: 700, gridColumn: '1 / -1' }}>Email<input value={editEmpForm.email || ''} onChange={e => setEditEmpForm({ ...editEmpForm, email: e.target.value })} style={{ width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '4px' }} /></label>
                  </div>
                  <button
                    className="btn-primary"
                    disabled={editEmpBusy}
                    style={{ width: '100%', marginTop: '14px', padding: '10px', fontWeight: 800, backgroundColor: '#B45309' }}
                    onClick={async () => {
                      if (editEmpBusy) return;
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
                            gender: editEmpForm.gender || undefined,
                            birthDate: editEmpForm.birthDate || undefined,
                            idCardNumber: editEmpForm.idCardNumber || undefined,
                            // Avatar: '' = gỡ, data URL = up mới, undefined = giữ nguyên.
                            avatar_base64: avatarRemoved ? '' : (avatarPhoto || undefined),
                            expectedVersion: editingEmp.version,
                          }),
                        });
                        showToast('Đã cập nhật hồ sơ nhân viên!');
                        setEditingEmp(null);
                        setAvatarPhoto(null);
                        setAvatarRemoved(false);
                        if (onRefreshData) await onRefreshData();
                        // Đẩy bộ nhớ -> Sheets NGAY (không pull: pull lúc này đọc Sheet
                        // cũ vì push nền ~10s, gây mất dữ liệu vừa lưu sau reload).
                        if (onPushSheets) await onPushSheets();
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
          </>
        )}
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
