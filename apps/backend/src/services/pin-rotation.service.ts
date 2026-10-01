import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Xoay mã PIN định kỳ hàng tháng — CHẾ ĐỘ TỰ ĐỔI TỪ PIN CŨ (từ 2026-10):
 *  - KHÔNG reset / KHÔNG sinh PIN mới hàng loạt, KHÔNG cần HR gửi PIN.
 *  - Từ ngày 1 mỗi tháng: tài khoản nào chưa tự đổi PIN trong tháng hiện tại
 *    (pin_changed_at trước 00:00 ngày 1, hoặc pin_must_change đang true)
 *    sẽ bị gắn cờ pin_must_change=true — GIỮ NGUYÊN hash cũ.
 *  - NV đăng nhập bằng SĐT + PIN CŨ (vẫn hợp lệ), bị chặn mọi API ngoài
 *    đổi PIN / xem hồ sơ (PIN_CHANGE_REQUIRED có sẵn) cho tới khi tự đặt
 *    PIN mới khác PIN cũ trong hạn 1-5. Sau ngày 5 vẫn chặn đến khi đổi xong.
 *  - HR KHÔNG reset PIN nữa: khi NV quên PIN cũ thì HR xem cột Mã PIN
 *    (bản rõ hiện tại) để nhắc lại, NV tự đổi từ PIN đó.
 */

function tzOffsetHours(): number {
  const raw = Number(process.env.WEEKLY_OFF_TZ_OFFSET_HOURS);
  return Number.isFinite(raw) && raw !== 0 ? raw : 7;
}

export function vnNow(now: Date = new Date()): Date {
  return new Date(now.getTime() + tzOffsetHours() * 3_600_000);
}

export function cycleKey(now: Date = new Date()): string {
  const vn = vnNow(now);
  return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Mốc 00:00 ngày 1 đầu tháng hiện tại (giờ VN, trả về epoch ms UTC). */
export function monthStartMs(now: Date = new Date()): number {
  const vn = vnNow(now);
  const y = vn.getUTCFullYear();
  const m = vn.getUTCMonth();
  return Date.UTC(y, m, 1) - tzOffsetHours() * 3_600_000;
}

/** True khi tài khoản tới hạn tự đổi PIN trong kỳ hiện tại. */
export function isPinRotationDue(account: any, now: Date = new Date()): boolean {
  if (!account) return false;
  if (account.pin_must_change === true) return true;
  const cycle = cycleKey(now);
  // Đã tự đổi trong kỳ này -> xong.
  if ((account as any).pin_rotation_cycle === cycle) return false;
  const changedAt = (account as any).pin_changed_at;
  if (!changedAt) {
    // Tài khoản legacy chưa có mốc đổi: chỉ bắt đổi nếu đã tồn tại từ trước
    // tháng này (tài khoản mới tạo trong tháng đã có mustChange riêng).
    const created = new Date(account.created_at || '').getTime();
    if (Number.isFinite(created) && created >= monthStartMs(now)) return false;
    return true;
  }
  const t = new Date(changedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return t < monthStartMs(now);
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
  let settings: any = {};
  try {
    settings = (await repo.getSystemSettings()) || {};
  } catch {
    return null;
  }
  let rot = settings.pinRotation || {};

  // Sang tháng mới -> mở kỳ mới (reset cờ đã thông báo).
  if (!rot.cycle || rot.cycle !== cycle) {
    rot = { cycle, notifiedEmployee: false, notifiedAdmin: false, startedAt: now.toISOString() };
    try {
      await repo.updateSystemSettings({ ...settings, pinRotation: rot });
    } catch { /* thử lại tick sau */ }
    settings = { ...settings, pinRotation: rot };
  }

  // Chốt danh sách tài khoản NV đang hoạt động + tới hạn tự đổi.
  let accounts: any[] = [];
  try {
    accounts = await repo.listAccounts();
  } catch {
    return null;
  }
  const active: any[] = [];
  for (const a of accounts) {
    try {
      const emp = await repo.getEmployeeById(a.employee_id).catch(() => null);
      if (!emp || (emp as any).employment_status === 'TERMINATED') continue;
    } catch {
      continue;
    }
    active.push(a);
  }

  // Gắn cờ (giữ hash cũ) cho tài khoản tới hạn mà chưa bị gắn.
  for (const a of active) {
    if (a.pin_must_change === true) continue;
    if (!isPinRotationDue(a, now)) continue;
    try {
      if (typeof (repo as any).markAccountPinMustChange === 'function') {
        await (repo as any).markAccountPinMustChange(a.account_id, 'SYSTEM');
      } else {
        // Fallback cho adapter cũ: tự gắn cờ trực tiếp (không đổi hash/version).
        (a as any).pin_must_change = true;
        (a as any).updated_at = new Date().toISOString();
      }
    } catch { /* bỏ qua, tick sau thử lại */ }
  }

  const pending = active.filter(a => a.pin_must_change === true || isPinRotationDue(a, now)).length;
  // Đếm lại sau khi gắn cờ: tài khoản đã gắn đều tính là pending cho tới khi NV tự đổi.
  let pendingAfter = 0;
  let done = 0;
  try {
    const fresh = await repo.listAccounts();
    const freshActive = [];
    for (const a of fresh) {
      const emp = await repo.getEmployeeById(a.employee_id).catch(() => null);
      if (!emp || (emp as any).employment_status === 'TERMINATED') continue;
      freshActive.push(a);
    }
    for (const a of freshActive) {
      if (a.pin_must_change === true) pendingAfter++;
      else done++;
    }
    const total = freshActive.length;
    // Thông báo 1 lần/kỳ (ngày 1 hoặc lần đầu phát hiện nợ PIN).
    const monthLabel = cycle;
    const day = vnNow(now).getUTCDate();
    if (pendingAfter > 0) {
      if (!rot.notifiedEmployee) {
        rot.notifiedEmployee = true;
        try {
          await repo.updateSystemSettings({ ...(await repo.getSystemSettings().catch(() => ({}))), pinRotation: rot });
        } catch { /* ignore */ }
        try {
          await notifications.sendNotification({
            recipientIds: ['ALL'],
            type: 'PIN_ROTATION_STARTED',
            severity: 'ACTION_REQUIRED',
            title: `🔑 Kỳ đổi PIN định kỳ tháng ${monthLabel} (hạn 1-5/${monthLabel.split('-')[1]})`,
            summary: `Từ PIN CŨ của bạn: đăng nhập bằng SĐT + PIN cũ, rồi tự đặt PIN mới khác PIN cũ trong ngày 1-5. Quá hạn vẫn phải đổi mới dùng được. KHÔNG cần HR reset/gửi PIN — quên PIN cũ thì hỏi HR xem lại mã hiện tại.`,
            targetPath: '/home',
            actorId: 'SYSTEM',
          }).catch(() => null);
        } catch { /* best-effort */ }
      }
      if (!rot.notifiedAdmin && day >= 1) {
        rot.notifiedAdmin = true;
        try {
          await repo.updateSystemSettings({ ...(await repo.getSystemSettings().catch(() => ({}))), pinRotation: rot });
        } catch { /* ignore */ }
        const ids = await hrAdminIds(repo);
        if (ids.length > 0) {
          try {
            await notifications.sendNotification({
              recipientIds: ids,
              type: 'PIN_ROTATION_STARTED',
              severity: 'ACTION_REQUIRED',
              title: `🔑 Kỳ tự đổi PIN tháng ${monthLabel}: ${pendingAfter}/${total} chưa đổi`,
              summary: `NV tự đổi từ PIN cũ (hạn 1-5, sau hạn vẫn chặn tới khi đổi). HR KHÔNG reset/gửi PIN hàng loạt nữa — chỉ xem cột Mã PIN để nhắc lại PIN cũ khi NV quên. Theo dõi cột Trạng thái PIN + Đổi PIN cuối.`,
              targetPath: '/activation',
              actorId: 'SYSTEM',
            }).catch(() => null);
          } catch { /* best-effort */ }
        }
      }
    } else if (total > 0 && !rot.doneNotified) {
      rot.doneNotified = true;
      try {
        await repo.updateSystemSettings({ ...(await repo.getSystemSettings().catch(() => ({}))), pinRotation: rot });
      } catch { /* ignore */ }
      const ids = await hrAdminIds(repo);
      if (ids.length > 0) {
        try {
          await notifications.sendNotification({
            recipientIds: ids,
            type: 'PIN_ROTATION_DONE',
            severity: 'SYSTEM',
            title: `✅ Xong kỳ tự đổi PIN tháng ${cycle}: ${done}/${total}`,
            summary: 'Toàn bộ NV đã tự đổi PIN mới từ PIN cũ trong kỳ này.',
            targetPath: '/activation',
            actorId: 'SYSTEM',
          }).catch(() => null);
        } catch { /* best-effort */ }
      }
    }
    return { cycle, rotated: done, pending: pendingAfter, total, completed: pendingAfter === 0 };
  } catch {
    return { cycle, rotated: 0, pending, total: active.length, completed: false };
  }
}
