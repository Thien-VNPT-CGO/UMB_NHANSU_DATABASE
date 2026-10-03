import fs from 'fs';
import path from 'path';
import { ISheetsRepository } from '../repositories/sheets.interface.js';

// zca-js đóng gói types hỏng cho TS NodeNext (bản CJS không có types) nên
// import động kiểu any. Runtime đã kiểm chứng: Zalo, ThreadType,
// LoginQRCallbackEventType đều tồn tại (zca-js@2.2.0).
let _zca: any = null;
async function zca(): Promise<any> {
  if (!_zca) _zca = await import('zca-js');
  return _zca;
}

export type ZaloLoginPhase = 'idle' | 'qr_waiting' | 'scanned' | 'connected' | 'expired' | 'failed';

export interface ZaloLoginSession {
  loginId: string;
  phase: ZaloLoginPhase;
  qrImage: string | null; // dataURL PNG để frontend hiển thị
  scannedBy?: { avatar: string; display_name: string };
  account?: { displayName: string; avatar: string; ownId: string };
  error?: string;
  startedAt: string;
  abort?: () => unknown;
}

interface PersistedSession {
  imei: string;
  cookie: unknown;
  userAgent: string;
  displayName?: string;
  avatar?: string;
  ownId?: string;
  savedAt: string;
}

function sessionPath(): string {
  return process.env.ZALO_SESSION_PATH || path.resolve(process.cwd(), 'apps/backend/.zalo-session.json');
}

function loadPersisted(): PersistedSession | null {
  try {
    const p = sessionPath();
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (!raw?.imei || !raw?.cookie || !raw?.userAgent) return null;
    return raw as PersistedSession;
  } catch {
    return null;
  }
}

function savePersisted(s: PersistedSession): void {
  try {
    fs.writeFileSync(sessionPath(), JSON.stringify(s), { encoding: 'utf-8', mode: 0o600 });
  } catch (e) {
    console.warn('[zalo] cannot persist session:', (e as Error).message);
  }
}

function clearPersisted(): void {
  try {
    if (fs.existsSync(sessionPath())) fs.unlinkSync(sessionPath());
  } catch {
    // ignore
  }
}

const ZALO_SESSION_SETTINGS_KEY = 'zaloSession';

/**
 * Tích hợp Zalo CÁ NHÂN của HR qua lib unofficial zca-js (mô phỏng Zalo Web).
 * CẢNH BÁO: dùng API unofficial có thể khiến tài khoản HR bị Zalo khóa —
 * nên dùng tài khoản phụ, không dùng tài khoản chính.
 */
export class ZaloService {
  private api: any = null;
  private account: PersistedSession | null = null;
  private login: ZaloLoginSession | null = null;
  // Tự khôi phục phiên đã lưu: trạng thái + chống spam Zalo khi cookie hỏng.
  private restoring = false;
  private restoreFailCount = 0;
  private savedSessionExists: boolean | null = null;
  private lastRestoreError: string | null = null;
  /** Sau quá nhiều lần khôi phục thất bại liên tiếp: dừng tự thử (tránh khóa nick), chờ HR quét QR lại. */
  private static readonly MAX_RESTORE_FAILS = 12;

  constructor(private repo: ISheetsRepository) {}

  isConnected(): boolean {
    return !!this.api && !!this.account;
  }

  /** Backend có đang giữ phiên Zalo đã lưu không (để UI báo "đang khôi phục" thay vì bắt quét QR). */
  hasSavedSessionSync(): boolean | null {
    return this.savedSessionExists;
  }

  status() {
    return {
      connected: this.isConnected(),
      account: this.account
        ? { displayName: this.account.displayName, avatar: this.account.avatar, ownId: this.account.ownId }
        : null,
      login: this.login
        ? {
            loginId: this.login.loginId,
            phase: this.login.phase,
            scannedBy: this.login.scannedBy,
            account: this.login.account,
            error: this.login.error,
            startedAt: this.login.startedAt,
          }
        : null,
      restoring: this.restoring,
      hasSavedSession: this.savedSessionExists,
      autoRestorePaused: this.restoreFailCount >= ZaloService.MAX_RESTORE_FAILS,
      lastRestoreError: this.lastRestoreError,
    };
  }

  /** Đọc phiên bền vững: file trước, rớt về cài đặt hệ thống (đồng bộ Sheets). */
  private async loadPersistedAsync(): Promise<PersistedSession | null> {
    const fromFile = loadPersisted();
    if (fromFile) return fromFile;
    try {
      const settings = (await this.repo.getSystemSettings().catch(() => null)) || {};
      const s = (settings as any)[ZALO_SESSION_SETTINGS_KEY];
      if (s && typeof s === 'object' && s.imei && s.cookie && s.userAgent) {
        // Ghi lại file để lần sau đọc nhanh.
        savePersisted(s as PersistedSession);
        return s as PersistedSession;
      }
    } catch (e) {
      console.warn('[zalo] load session from settings failed:', (e as Error).message);
    }
    return null;
  }

  /** Ghi phiên bền vững: file + cài đặt hệ thống (sống qua restart/deploy Render). */
  private async savePersistedAsync(s: PersistedSession): Promise<void> {
    savePersisted(s);
    this.savedSessionExists = true;
    this.restoreFailCount = 0;
    this.lastRestoreError = null;
    try {
      const settings = (await this.repo.getSystemSettings().catch(() => ({}))) || {};
      await this.repo.updateSystemSettings({ ...settings, [ZALO_SESSION_SETTINGS_KEY]: s });
    } catch (e) {
      console.warn('[zalo] save session to settings failed:', (e as Error).message);
    }
  }

  private async clearPersistedAsync(): Promise<void> {
    clearPersisted();
    this.savedSessionExists = false;
    this.restoreFailCount = 0;
    this.lastRestoreError = null;
    try {
      const settings = (await this.repo.getSystemSettings().catch(() => ({}))) || {};
      await this.repo.updateSystemSettings({ ...settings, [ZALO_SESSION_SETTINGS_KEY]: null });
    } catch {
      // ignore
    }
  }

  /** Khôi phục phiên cũ sau restart (không cần quét QR lại).
   *  Thất bại KHÔNG xóa phiên đã lưu (chỉ HR đăng xuất mới xóa) — tick nền sẽ thử lại. */
  async restoreSession(): Promise<boolean> {
    if (this.restoring) return false;
    if (this.isConnected()) return true;
    this.restoring = true;
    try {
      const saved = await this.loadPersistedAsync();
      this.savedSessionExists = !!saved;
      if (!saved) return false;
      try {
        const { Zalo } = await zca();
        const zalo = new Zalo({ logging: false, checkUpdate: false });
        const api = await zalo.login({
          imei: saved.imei,
          cookie: saved.cookie,
          userAgent: saved.userAgent,
        });
        this.api = api;
        this.account = saved;
        this.restoreFailCount = 0;
        this.lastRestoreError = null;
        console.log('[zalo] session restored for', saved.displayName || saved.ownId);
        return true;
      } catch (e) {
        this.restoreFailCount++;
        this.lastRestoreError = (e as Error).message;
        console.warn(`[zalo] restore failed (${this.restoreFailCount}x):`, (e as Error).message);
        return false;
      }
    } finally {
      this.restoring = false;
    }
  }

  /** Tick nền (5 phút/lần từ server.ts): chưa kết nối + còn phiên lưu + không quét QR
   *  dở + chưa vượt ngưỡng lỗi -> thử khôi phục. Giữ phiên tới khi HR đăng xuất. */
  async autoRestoreTick(): Promise<boolean> {
    if (this.isConnected() || this.restoring) return this.isConnected();
    if (this.restoreFailCount >= ZaloService.MAX_RESTORE_FAILS) return false;
    if (this.login && (this.login.phase === 'qr_waiting' || this.login.phase === 'scanned')) return false;
    return this.restoreSession();
  }

  /** Bắt đầu luồng quét QR (chạy nền, frontend poll image + status). */
  startQrLogin(actorId: string): { loginId: string } {
    if (this.login && (this.login.phase === 'qr_waiting' || this.login.phase === 'scanned')) {
      return { loginId: this.login.loginId };
    }
    const loginId = `ZQ_${Date.now()}`;
    const session: ZaloLoginSession = {
      loginId,
      phase: 'qr_waiting',
      qrImage: null,
      startedAt: new Date().toISOString(),
    };
    this.login = session;

    void (async () => {
      const { Zalo, LoginQRCallbackEventType } = await zca();
      const zalo = new Zalo({ logging: false, checkUpdate: false });
      const done = (phase: ZaloLoginPhase, patch: Partial<ZaloLoginSession> = {}) => {
        if (this.login?.loginId === loginId) Object.assign(this.login, { phase }, patch);
      };

      const onEvent = (event: any) => {
        try {
          switch (event.type) {
            case LoginQRCallbackEventType.QRCodeGenerated:
              done('qr_waiting', { qrImage: event.data?.image || null });
              break;
            case LoginQRCallbackEventType.QRCodeScanned:
              done('scanned', {
                scannedBy: {
                  avatar: event.data?.avatar,
                  display_name: event.data?.display_name,
                },
              });
              break;
            case LoginQRCallbackEventType.QRCodeExpired:
              done('expired', { error: 'Mã QR đã hết hạn, vui lòng tạo mã mới!' });
              break;
            case LoginQRCallbackEventType.QRCodeDeclined:
              done('failed', { error: 'Đã từ chối đăng nhập trên điện thoại!' });
              break;
            case LoginQRCallbackEventType.GotLoginInfo: {
              const persisted: PersistedSession = {
                imei: event.data.imei,
                cookie: event.data.cookie,
                userAgent: event.data.userAgent,
                savedAt: new Date().toISOString(),
              };
              void this.savePersistedAsync(persisted);
              this.account = persisted;
              break;
            }
          }
        } catch (e) {
          console.warn('[zalo] qr event error:', (e as Error).message);
        }
      };

      try {
        const api = await zalo.loginQR({}, onEvent);
        if (!api) {
          done('failed', { error: 'Đăng nhập thất bại!' });
          return;
        }
        this.api = api;
        let displayName = '';
        let avatar = '';
        let ownId = '';
        try {
          ownId = await api.getOwnId();
        } catch {}
        try {
          const me = await api.fetchAccountInfo();
          displayName = me?.profile?.display_name || me?.display_name || '';
          avatar = me?.profile?.avatar || me?.avatar || '';
        } catch {}
        if (this.account) {
          this.account.displayName = displayName;
          this.account.avatar = avatar;
          this.account.ownId = ownId;
          void this.savePersistedAsync(this.account);
        }
        done('connected', { account: { displayName, avatar, ownId } });
        await this.repo
          .recordAuditLog({
            log_id: `LOG_${Date.now()}`,
            actor_id: actorId,
            actor_role: 'HR',
            action: 'ZALO_QR_CONNECTED',
            target_entity: 'ZALO_SESSION',
            target_id: loginId,
            details: `HR linked personal Zalo (${displayName || ownId})`,
          })
          .catch(() => {});
      } catch (e: any) {
        done('failed', { error: e?.message || 'Đăng nhập thất bại!' });
      }
    })();

    return { loginId };
  }

  /** Ảnh QR hiện tại, chuẩn hóa thành dataURL PNG (frontend <img> dùng trực tiếp). */
  async waitQrImage(loginId: string, timeoutMs = 10000): Promise<string | null> {
    const raw = await this.waitQrRaw(loginId, timeoutMs);
    if (!raw) return null;
    if (raw.startsWith('data:')) return raw;
    return `data:image/png;base64,${raw}`;
  }

  /** Ảnh QR hiện tại (frontend poll). Hết timeout chưa có QR -> null. */
  private async waitQrRaw(loginId: string, timeoutMs = 10000): Promise<string | null> {
    if (this.login?.loginId !== loginId) return null;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.login?.qrImage) return this.login.qrImage;
      if (this.login && this.login.phase !== 'qr_waiting') return this.login.qrImage;
      await new Promise(r => setTimeout(r, 500));
    }
    return this.login?.qrImage || null;
  }

  cancelQrLogin(loginId: string): boolean {
    if (this.login?.loginId !== loginId) return false;
    try {
      this.login.abort?.();
    } catch {}
    this.login = null;
    return true;
  }

  async disconnect(actorId: string): Promise<void> {
    this.api = null;
    this.account = null;
    this.login = null;
    await this.clearPersistedAsync();
    await this.repo
      .recordAuditLog({
        log_id: `LOG_${Date.now()}`,
        actor_id: actorId,
        actor_role: 'HR',
        action: 'ZALO_DISCONNECTED',
        target_entity: 'ZALO_SESSION',
        target_id: 'personal',
        details: 'HR unlinked personal Zalo',
      })
      .catch(() => {});
  }

  private requireApi(): any {
    if (!this.api) throw new Error('ZALO_NOT_CONNECTED');
    return this.api;
  }

  /** Tra cứu user Zalo theo SĐT ứng viên. */
  async findUserByPhone(phone: string) {
    const api = this.requireApi();
    const normalized = (phone || '').replace(/[\s\-\.\(\)]/g, '');
    try {
      const u = await api.findUser(normalized);
      if (!u?.uid) throw new Error('ZALO_USER_NOT_FOUND');
      return { uid: u.uid, displayName: u.display_name || u.zalo_name || '', avatar: u.avatar || '' };
    } catch (e: any) {
      if (e?.message === 'ZALO_USER_NOT_FOUND') throw e;
      throw new Error(`ZALO_LOOKUP_FAILED: ${e?.message || e}`);
    }
  }

  /** Gửi lời mời kết bạn (khi ứng viên chưa phải bạn bè). */
  async sendFriendRequest(uid: string, message: string) {
    const api = this.requireApi();
    await api.sendFriendRequest(message, uid);
    return { success: true };
  }

  /** Gửi tin nhắn văn bản tới 1 user (yêu cầu đã là bạn bè). */
  async sendText(uid: string, text: string) {
    const { ThreadType } = await zca();
    const api = this.requireApi();
    const res = await api.sendMessage(text, uid, ThreadType.User);
    const msgId = res?.message?.msgId;
    if (msgId === undefined || msgId === null) throw new Error('ZALO_SEND_FAILED');
    return { success: true, msgId };
  }

  /** Mẫu tin nhắn gửi mã PIN đăng nhập cho nhân viên. */
  buildPinText(o: { employeeName: string; pin: string }): string {
    return [
      `Chào ${o.employeeName},`,
      `Mã PIN đăng nhập Cổng Nhân Viên Ụm Bò Milk của bạn là: ${o.pin}`,
      `Dùng SĐT + mã PIN này để đăng nhập, rồi ĐỔI mã PIN riêng ngay ở lần đầu.`,
      `Không chia sẻ mã PIN cho bất kỳ ai! (tin nhắn tự động từ HR).`,
    ].join('\n');
  }

  /** Mẫu tin nhắn BOT bắn đi — khớp khung "Xem Trước Mẫu Tin Nhắn Zalo BOT Tự Động Bắn Đi" trên cổng HR. */
  buildInviteText(o: {    candidateName: string;
    position?: string;
    branchName?: string;
    shift?: string;
    interviewDate: string;
    timeSlot: string;
    meetUrl?: string;
    /** Link xác nhận tham gia/dời lịch cho ứng viên (không cần đăng nhập). */
    rsvpUrl?: string;
  }): string {
    const lines = [
      `[ỤM BÒ MILK] THƯ MỜI PHỎNG VẤN VỊ TRÍ ${(o.position || 'NHÂN VIÊN BÁN HÀNG').toUpperCase()}`,
      `Chào bạn ${o.candidateName},`,
      `Phòng Nhân Sự Ụm Bò Milk trân trọng mời bạn tham gia buổi phỏng vấn${o.meetUrl ? ' trực tuyến' : ''}:`,
      `🕒 Thời gian: ${o.timeSlot} - ${o.interviewDate}`,
      `📍 Chi nhánh tuyển dụng: ${o.branchName || 'sẽ báo khi xác nhận'}`,
      `🕐 Ca làm việc đăng ký: ${o.shift || 'sẽ trao đổi khi xác nhận'}`,
    ];
    if (o.meetUrl) {
      lines.push(`🔗 Link phòng họp Google Meet: ${o.meetUrl}`);
    } else {
      lines.push(`📌 Hình thức: Trực tiếp tại cửa hàng — bạn đến trước 5 phút nhé.`);
    }
    lines.push(`👤 Người phỏng vấn: Phòng Nhân Sự Ụm Bò Milk`);
    if (o.rsvpUrl) {
      lines.push(`✅ BẤM XÁC NHẬN THAM GIA / XIN DỜI LỊCH tại đây (trước giờ hẹn):`);
      lines.push(o.rsvpUrl);
      lines.push(`Quá giờ hẹn 30 phút không xác nhận, lịch sẽ tự hủy để nhường slot.`);
    }
    lines.push(`📌 Lưu ý: Bạn vui lòng vào trước 5 phút và chuẩn bị trang phục lịch sự nhé.`);
    return lines.join('\n');
  }
}

/** Link Google Meet mặc định HỆ THỐNG cho mọi lịch PV online — ràng buộc cứng, HR không tùy chỉnh. */
export const SYSTEM_MEET_URL = 'https://meet.google.com/ypp-srtm-fvm';

/** Link Meet hiện tại của hệ thống (đổi được qua env SYSTEM_MEET_URL mà không cần sửa code). */
export const defaultMeetUrl = (): string => {
  const env = String(process.env.SYSTEM_MEET_URL || '').trim();
  return env || SYSTEM_MEET_URL;
};
