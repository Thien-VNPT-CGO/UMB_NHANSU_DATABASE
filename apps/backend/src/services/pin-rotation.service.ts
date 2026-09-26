import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { NotificationsService } from './notifications.service.js';
import { generateAutoPin, hashPin } from './password.service.js';

/**
 * Xoay mã PIN định kỳ hàng tháng (ngày 1-5):
 *  - Ngày 1: chốt danh sách tài khoản NV đang hoạt động, cấp PIN mới (mustChange),
 *    báo NV (in-app) + báo HR/Admin (dùng nút Gửi PIN Zalo hàng loạt để phát PIN).
 *  - Xử lý theo mẻ 15 tài khoản/tick để bcrypt không chặn server.
 *  - NV bắt đổi PIN riêng ở lần đăng nhập sau (cổng PIN_CHANGE_REQUIRED có sẵn).
 *  - Trạng thái theo dõi trên cổng Admin/HR: cột Mã PIN + Trạng thái PIN + Đổi PIN cuối.
 */

const CHUNK = 15;

function tzOffsetHours(): number {
  const raw = Number(process.env.WEEKLY_OFF_TZ_OFFSET_HOURS);
  return Number.isFinite(raw) && raw !== 0 ? raw : 7;
}

function vnNow(now: Date = new Date()): Date {
  return new Date(now.getTime() + tzOffsetHours() * 3_600_000);
}

function cycleKey(now: Date): string {
  const vn = vnNow(now);
  return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function hrAdminIds(repo: ISheetsRepository): Promise<string[]> {
  try {
    const admins = await repo.listAdminAccounts();
    return admins.filter(a => (a.role === 'ADMIN' || a.role === 'HR') && a.is_active !== false).map(a => a.admin_id);
  } catch {
    return [];
  }
}

export interface PinRotationProgress {
  cycle: string;
  rotated: number;
  pending: number;
  total: number;
  completed: boolean;
}

export async function pinRotationTick(
  repo: ISheetsRepository,
  notifications: NotificationsService,
  now: Date = new Date()
): Promise<PinRotationProgress | null> {
  const cycle = cycleKey(now);
  // Kỳ mới mở khi sang tháng (chu kỳ YYYY-MM); ngày 1-5 là hạn NV hoàn tất đổi PIN
  // (thông báo ghi rõ, cổng PIN_CHANGE_REQUIRED cưỡng chế ở mọi lần đăng nhập).
  let settings: any = {};
  try {
    settings = (await repo.getSystemSettings()) || {};
  } catch {
    return null;
  }
  let rot = settings.pinRotation || {};

  if (!rot.cycle || rot.cycle < cycle) {
    // Mở kỳ mới: chốt danh sách tài khoản NV đang hoạt động.
    const accounts = await repo.listAccounts().catch(() => []);
    const ids: string[] = [];
    for (const a of accounts) {
      try {
        const emp = await repo.getEmployeeById(a.employee_id).catch(() => null);
        if (!emp || emp.employment_status === 'TERMINATED') continue;
      } catch {
        continue;
      }
      ids.push(a.account_id);
    }
    rot = { cycle, remaining: ids, total: ids.length, startedAt: now.toISOString(), doneNotified: false };
    try {
      await repo.updateSystemSettings({ ...settings, pinRotation: rot });
    } catch { /* thử lại tick sau */ }
    const monthLabel = cycle;
    const adminIds = await hrAdminIds(repo);
    try {
      await notifications.sendNotification({
        recipientIds: ['ALL'],
        type: 'PIN_ROTATION_STARTED',
        severity: 'ACTION_REQUIRED',
        title: `🔑 Kỳ đổi PIN định kỳ tháng ${monthLabel} (1-5/${monthLabel.split('-')[1]})`,
        summary: 'Hệ thống đã cấp mã PIN mới cho toàn bộ nhân viên. Vui lòng liên hệ HR nhận PIN mới, đăng nhập và đặt PIN riêng trong ngày 1-5. Sau ngày 5 chưa đổi vẫn phải đổi mới dùng được hệ thống!',
        targetPath: '/home',
        actorId: 'SYSTEM',
      }).catch(() => null);
      if (adminIds.length > 0) {
        await notifications.sendNotification({
          recipientIds: adminIds,
          type: 'PIN_ROTATION_STARTED',
          severity: 'ACTION_REQUIRED',
          title: `🔑 Đã mở kỳ đổi PIN tháng ${monthLabel}: ${ids.length} tài khoản`,
          summary: `Đã cấp PIN mới cho ${ids.length} tài khoản NV. Dùng nút "Gửi PIN Zalo hàng loạt" ở tab PIN & TK để phát PIN. Theo dõi cột Trạng thái PIN + Đổi PIN cuối.`,
          targetPath: '/activation',
          actorId: 'SYSTEM',
        }).catch(() => null);
      }
    } catch { /* best-effort */ }
  }

  if (rot.cycle !== cycle) return null;
  const remaining: string[] = Array.isArray(rot.remaining) ? rot.remaining : [];
  if (remaining.length === 0) {
    if (!rot.doneNotified && (rot.total || 0) > 0) {
      rot.doneNotified = true;
      try {
        await repo.updateSystemSettings({ ...(await repo.getSystemSettings().catch(() => ({}))), pinRotation: rot });
      } catch { /* ignore */ }
      const ids = await hrAdminIds(repo);
      if (ids.length > 0) {
        await notifications.sendNotification({
          recipientIds: ids,
          type: 'PIN_ROTATION_DONE',
          severity: 'SYSTEM',
          title: `✅ Đã cấp xong PIN tháng ${cycle}: ${rot.total}/${rot.total}`,
          summary: 'Toàn bộ tài khoản đã có PIN mới. NV sẽ đổi PIN riêng khi đăng nhập — theo dõi cột Trạng thái PIN.',
          targetPath: '/activation',
          actorId: 'SYSTEM',
        }).catch(() => null);
      }
    }
    return { cycle, rotated: rot.total || 0, pending: 0, total: rot.total || 0, completed: true };
  }

  const chunk = remaining.slice(0, CHUNK);
  for (const id of chunk) {
    try {
      const pin = generateAutoPin();
      await repo.setAccountPin(id, await hashPin(pin), true, 'SYSTEM', pin);
    } catch {
      // tài khoản lỗi bỏ qua, các kỳ sau đối chiếu lại
    }
  }
  rot.remaining = remaining.slice(chunk.length);
  try {
    await repo.updateSystemSettings({ ...(await repo.getSystemSettings().catch(() => ({}))), pinRotation: rot });
  } catch { /* thử lại tick sau */ }
  return { cycle, rotated: (rot.total || 0) - rot.remaining.length, pending: rot.remaining.length, total: rot.total || 0, completed: false };
}
