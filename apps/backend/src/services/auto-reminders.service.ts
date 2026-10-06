import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { NotificationsService } from './notifications.service.js';
import { ZaloService } from './zalo.service.js';

/**
 * Nhắc việc tự động (chạy mỗi 5 phút từ server.ts):
 *  1. Nhắc check-in qua Zalo trước ca 15 phút (NV chưa check-in).
 *  2. Nhắc HR/Admin (in-app): NV chưa đổi PIN khởi tạo quá 3 ngày.
 *  3. Nhắc HR/Admin (in-app): đơn chờ duyệt quá 24h (nghỉ/đổi ca/bổ sung công).
 *  4. Nhắc hoàn thành thử việc (in-app): NV hết hạn hôm nay / còn ≤2 ngày
 *     (ngày hoàn thành = start_date + 11) + báo chính NV đó trong ngày cuối.
 * Chống spam bằng cờ theo ngày trong bộ nhớ.
 */

const DAY_MS = 86_400_000;

function tzOffsetHours(): number {
  const raw = Number(process.env.WEEKLY_OFF_TZ_OFFSET_HOURS);
  return Number.isFinite(raw) && raw !== 0 ? raw : 7;
}

function vnNow(now: Date = new Date()): Date {
  return new Date(now.getTime() + tzOffsetHours() * 3_600_000);
}

function vnDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Parse giờ bắt đầu ca: ISO đầy đủ hoặc "HH:mm" ghép với ngày ca, fallback theo mã ca (CA_1/CA_2/CA_3). */
function parseShiftStart(date: string, startAt?: string, shiftCode?: string): number | null {
  if (startAt) {
    try {
      if (startAt.includes('T')) {
        const t = new Date(startAt).getTime();
        if (Number.isFinite(t)) return t;
      }
      const m = startAt.match(/(\d{1,2}):(\d{2})/);
      if (m) {
        // date YYYY-MM-DD + giờ VN -> epoch (trừ offset vì server tính theo UTC).
        const t = Date.parse(`${date}T${m[1].padStart(2, '0')}:${m[2]}:00Z`);
        if (Number.isFinite(t)) return t - tzOffsetHours() * 3_600_000;
      }
    } catch {}
  }
  if (shiftCode) {
    const hoursMap: Record<string, number> = { CA_1: 7, CA_2: 12, CA_3: 18 };
    const h = hoursMap[shiftCode];
    if (h !== undefined) {
      const t = Date.parse(`${date}T${String(h).padStart(2, '0')}:00:00Z`);
      if (Number.isFinite(t)) return t - tzOffsetHours() * 3_600_000;
    }
  }
  return null;
}

const remindedCheckin = new Set<string>(); // `${date}:${assignment_id}:${employee_id}`
const notifiedDaily = new Set<string>(); // `${date}:${kind}`
let notifiedDay = '';

function resetDaily(nowDay: string) {
  if (notifiedDay !== nowDay) {
    notifiedDay = nowDay;
    remindedCheckin.clear();
    notifiedDaily.clear();
  }
}

async function hrAdminIds(repo: ISheetsRepository): Promise<string[]> {
  try {
    const admins = await repo.listAdminAccounts();
    return admins.filter(a => (a.role === 'ADMIN' || a.role === 'HR') && a.is_active !== false).map(a => a.admin_id);
  } catch {
    return [];
  }
}

export async function autoRemindersTick(
  repo: ISheetsRepository,
  notifications: NotificationsService,
  zalo: ZaloService
): Promise<void> {
  const now = Date.now();
  const vn = vnNow(new Date(now));
  const today = vnDateStr(vn);
  resetDaily(today);

  // 1. Nhắc check-in trước ca 15 phút (In-App notification + Zalo)
  try {
    const branches = await repo.getBranches();
    for (const b of branches) {
      let shifts: any[] = [];
      try {
        shifts = await repo.getShiftsForWeek(b.id, today);
      } catch {
        continue;
      }
      for (const s of shifts) {
        if (s.date !== today || s.status !== 'PUBLISHED') continue;
        const startMs = parseShiftStart(s.date, s.start_at, s.shift_code);
        if (startMs === null) continue;
        const minsToStart = (startMs - now) / 60_000;
        if (minsToStart < 5 || minsToStart > 20) continue; // cửa sổ nhắc 5-20 phút trước ca
        const key = `${today}:${s.assignment_id}:${s.employee_id}`;
        if (remindedCheckin.has(key)) continue;
        remindedCheckin.add(key);
        try {
          const emp = await repo.getEmployeeById(s.employee_id);
          const events = await repo.getAttendanceEvents(s.employee_id, today);
          if (events.some(e => e.type === 'CHECK_IN' && (e.assignment_id === s.assignment_id || !e.assignment_id))) continue;

          const shiftName = s.shift_code === 'CA_1' ? 'Ca 1 (07:00 - 12:00)'
            : s.shift_code === 'CA_2' ? 'Ca 2 (12:00 - 18:00)'
            : s.shift_code === 'CA_3' ? 'Ca 3 (18:00 - 23:00)'
            : (s.shift_code || 'Ca làm việc');
          const startStr = new Date(startMs).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

          // Gửi thông báo trong App (Socket.IO realtime + chuông thông báo)
          await notifications.sendNotification({
            recipientIds: [s.employee_id],
            type: 'CHECKIN_REMINDER',
            severity: 'ACTION_REQUIRED',
            title: `⏰ Nhắc Check-in ${shiftName}`,
            summary: `Ca làm việc bắt đầu lúc ${startStr}. Cổng điểm danh đã mở, vui lòng mở Cổng Nhân Viên điểm danh (GPS + áo hồng) ngay!`,
            targetPath: '/attendance',
            actorId: 'SYSTEM',
          }).catch(() => null);

          // Gửi tin nhắn Zalo cá nhân nếu có số điện thoại
          const phone = emp?.phone_normalized || '';
          if (phone && zalo.isConnected()) {
            const found = await zalo.findUserByPhone(phone).catch(() => null);
            if (found?.uid) {
              await zalo.sendText(
                found.uid,
                `⏰ [Ụm Bò Milk] Nhắc check-in: ${shiftName} của ${emp?.full_name || 'bạn'} bắt đầu lúc ${startStr} hôm nay.\n👉 Cổng điểm danh đã mở trước ca 30 phút. Vui lòng mở Cổng Nhân Viên chụp ảnh áo hồng + bật GPS để điểm danh trước giờ vào ca nhé!`
              );
            }
          }
        } catch (e: any) {
          console.warn('[auto-reminders] Nhắc check-in thất bại:', e?.message || e);
        }
      }
    }
  } catch (e: any) {
    console.warn('[auto-reminders] checkin tick:', e?.message || e);
  }

  // 2 & 3. Nhắc HR/Admin trong app (1 lần/ngày cho mỗi loại)
  try {
    const ids = await hrAdminIds(repo);
    if (ids.length === 0) return;

    // 2. PIN khởi tạo quá 3 ngày chưa đổi (chỉ tài khoản mới chưa từng tự đổi;
    // kỳ xoay hàng tháng đã có thông báo riêng từ pin-rotation, không nhắc lại ở đây).
    if (!notifiedDaily.has(`pin:${today}`)) {
      const accounts = await repo.listAccounts();
      const stale = accounts.filter(a => {
        if (a.pin_must_change !== true) return false;
        if ((a as any).pin_changed_at) return false;
        const created = new Date(a.created_at || a.updated_at).getTime();
        return Number.isFinite(created) && now - created > 3 * DAY_MS;
      });
      if (stale.length > 0) {
        notifiedDaily.add(`pin:${today}`);
        const names = stale.slice(0, 5).map(a => a.phone_normalized).join(', ');
        await notifications.sendNotification({
          recipientIds: ids,
          type: 'PIN_STALE',
          severity: 'ACTION_REQUIRED',
          title: `🔑 ${stale.length} nhân viên chưa đổi PIN khởi tạo quá 3 ngày`,
          summary: `SĐT: ${names}${stale.length > 5 ? ` (+${stale.length - 5} người khác)` : ''}. Liên hệ nhắc NV đổi PIN riêng để bảo mật.`,
          targetPath: '/activation',
          actorId: 'SYSTEM',
        }).catch(() => null);
      }
    }

    // 4. Hoàn thành thử việc: hết hạn hôm nay / còn ≤2 ngày (ngày hoàn thành
    // = start_date + 11). Báo HR 1 lần/ngày + báo chính NV trong ngày cuối.
    if (!notifiedDaily.has(`prob:${today}`)) {
      try {
        const emps = await repo.listEmployees().catch(() => []);
        const endOf = (startDate: string): string => {
          const s = String(startDate || '').slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
          const d = new Date(`${s}T00:00:00Z`);
          if (!Number.isFinite(d.getTime())) return '';
          d.setUTCDate(d.getUTCDate() + 11);
          return d.toISOString().slice(0, 10);
        };
        const dayMs = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
        const probs = (emps || []).filter((e: any) => (e as any)?.employment_status === 'PROBATION');
        const endingToday = probs.filter((e: any) => endOf((e as any).start_date) === today);
        const endingSoon = probs.filter((e: any) => {
          const end = endOf((e as any).start_date);
          if (!end || end <= today) return false;
          return dayMs(end) - dayMs(today) <= 2 * DAY_MS;
        });
        if (endingToday.length > 0 || endingSoon.length > 0) {
          notifiedDaily.add(`prob:${today}`);
          const fmt = (e: any) => `${(e as any).full_name} (${(e as any).employee_code})`;
          const parts: string[] = [];
          if (endingToday.length > 0) parts.push(`Hết hạn HÔM NAY (${today.split('-').reverse().join('/')}): ${endingToday.slice(0, 5).map(fmt).join('; ')}${endingToday.length > 5 ? ` (+${endingToday.length - 5} người)` : ''}`);
          if (endingSoon.length > 0) parts.push(`Còn ≤2 ngày: ${endingSoon.slice(0, 5).map(fmt).join('; ')}${endingSoon.length > 5 ? ` (+${endingSoon.length - 5} người)` : ''}`);
          await notifications.sendNotification({
            recipientIds: ids,
            type: 'PROBATION_ENDING',
            severity: 'ACTION_REQUIRED',
            title: `🎓 ${endingToday.length + endingSoon.length} NV sắp/đến hạn hoàn thành thử việc`,
            summary: `${parts.join(' • ')}. Lên lịch kiểm tra đầu ra (Meet + trắc nghiệm) rồi xét duyệt chính thức!`,
            targetPath: '/hr-probation',
            actorId: 'SYSTEM',
          }).catch(() => null);
        }
        // Báo chính NV trong ngày hoàn thành để chuẩn bị kiểm tra đầu ra.
        for (const e of endingToday) {
          try {
            await notifications.sendNotification({
              recipientIds: [(e as any).employee_id],
              type: 'PROBATION_ENDING',
              severity: 'ACTION_REQUIRED',
              title: '🎓 Hôm nay là ngày hoàn thành thử việc của bạn!',
              summary: 'Chuẩn bị kiểm tra đầu ra (vấn đáp Google Meet + bài trắc nghiệm theo lịch HR đã gửi). Chúc bạn đạt kết quả tốt!',
              targetPath: '/schedule',
              actorId: 'SYSTEM',
            }).catch(() => null);
          } catch { /* best-effort từng người */ }
        }
      } catch (e: any) {
        console.warn('[auto-reminders] probation tick:', e?.message || e);
      }
    }

    // 3. Đơn chờ duyệt quá 24h
    if (!notifiedDaily.has(`appr:${today}`)) {
      const [leaves, swaps, adjs] = await Promise.all([
        repo.listLeaveRequests().catch(() => []),
        repo.listSwapRequests().catch(() => []),
        repo.listAttendanceAdjustments().catch(() => []),
      ]);
      const old = (t: string) => {
        const ms = new Date(t).getTime();
        return Number.isFinite(ms) && now - ms > DAY_MS;
      };
      const nLeaves = leaves.filter((l: any) => l.status === 'PENDING' && old(l.created_at)).length;
      const nSwaps = swaps.filter((s: any) => (s.status === 'PENDING_PARTNER' || s.status === 'PARTNER_ACCEPTED') && old(s.created_at)).length;
      const nAdjs = adjs.filter((a: any) => a.status === 'PENDING' && old(a.created_at)).length;
      const total = nLeaves + nSwaps + nAdjs;
      if (total > 0) {
        notifiedDaily.add(`appr:${today}`);
        await notifications.sendNotification({
          recipientIds: ids,
          type: 'APPROVAL_STALE',
          severity: 'ACTION_REQUIRED',
          title: `⏳ ${total} yêu cầu chờ duyệt quá 24h`,
          summary: `Nghỉ/OFF: ${nLeaves} • Đổi ca: ${nSwaps} • Bổ sung công: ${nAdjs}. Duyệt sớm để không kẹt lương/công.`,
          actorId: 'SYSTEM',
        }).catch(() => null);
      }
    }
  } catch (e: any) {
    console.warn('[auto-reminders] hr tick:', e?.message || e);
  }
}
