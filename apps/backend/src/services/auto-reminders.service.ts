import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { NotificationsService } from './notifications.service.js';
import { ZaloService } from './zalo.service.js';

/**
 * Nhắc việc tự động (chạy mỗi 5 phút từ server.ts):
 *  1. Nhắc check-in qua Zalo trước ca 15 phút (NV chưa check-in).
 *  2. Nhắc HR/Admin (in-app): NV chưa đổi PIN khởi tạo quá 3 ngày.
 *  3. Nhắc HR/Admin (in-app): đơn chờ duyệt quá 24h (nghỉ/đổi ca/bổ sung công).
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

/** Parse giờ bắt đầu ca: ISO đầy đủ hoặc "HH:mm" ghép với ngày ca. */
function parseShiftStart(date: string, startAt: string): number | null {
  if (!startAt) return null;
  try {
    if (startAt.includes('T')) {
      const t = new Date(startAt).getTime();
      return Number.isFinite(t) ? t : null;
    }
    const m = startAt.match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    // date YYYY-MM-DD + giờ VN -> epoch (trừ offset vì server tính theo UTC).
    const t = Date.parse(`${date}T${m[1].padStart(2, '0')}:${m[2]}:00Z`);
    if (!Number.isFinite(t)) return null;
    return t - tzOffsetHours() * 3_600_000;
  } catch {
    return null;
  }
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

  // 1. Nhắc check-in Zalo trước ca 15 phút
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
        const startMs = parseShiftStart(s.date, s.start_at);
        if (startMs === null) continue;
        const minsToStart = (startMs - now) / 60_000;
        if (minsToStart < 5 || minsToStart > 20) continue; // cửa sổ nhắc 5-20 phút
        const key = `${today}:${s.assignment_id}:${s.employee_id}`;
        if (remindedCheckin.has(key)) continue;
        remindedCheckin.add(key);
        try {
          const emp = await repo.getEmployeeById(s.employee_id);
          const phone = emp?.phone_normalized || '';
          if (!phone) continue;
          const events = await repo.getAttendanceEvents(s.employee_id, today);
          if (events.some(e => e.type === 'CHECK_IN' && e.assignment_id === s.assignment_id)) continue;
          const found = await zalo.findUserByPhone(phone);
          const startStr = new Date(startMs).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
          await zalo.sendText(
            found.uid,
            `⏰ Nhắc check-in: ca của ${emp?.full_name || 'bạn'} bắt đầu lúc ${startStr} hôm nay. Mở Cổng Nhân Viên điểm danh trước giờ vào ca nhé!`
          );
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

    // 2. PIN khởi tạo quá 3 ngày chưa đổi
    if (!notifiedDaily.has(`pin:${today}`)) {
      const accounts = await repo.listAccounts();
      const stale = accounts.filter(a => {
        if (a.pin_must_change !== true) return false;
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
