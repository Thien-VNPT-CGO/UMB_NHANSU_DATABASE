import dotenv from 'dotenv';
dotenv.config();

import dns from 'dns';
// VPS có thể có IPv6 "nửa vời" (SYN rơi): Node 18+ ưu tiên IPv6 nên kết nối tới
// Google API treo tới khi timeout trong khi IPv4 vẫn tốt. Ép IPv4 cho outbound.
try { dns.setDefaultResultOrder((process.env.GOOGLE_DNS_ORDER as any) || 'ipv4first'); } catch { /* Node cũ: bỏ qua */ }

import http from 'http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { AuthService } from './services/auth.service.js';
import { weeklyOffScheduler } from './services/weekly-off.service.js';
import { pinRotationTick } from './services/pin-rotation.service.js';
import { dedupeDuplicateInterviews, enforceScreeningOutcomes } from './services/interview-dedupe.service.js';
import { interviewNoShowTick, interviewReminderTick } from './services/interview-reminders.service.js';
import { autoRemindersTick } from './services/auto-reminders.service.js';
import { notifySystemAlert, startSystemAlertMonitor } from './services/system-alert.service.js';
import {
  addDaysIso,
  runMonthlyBackup,
  syncPhotoBacklog,
  vnToday as backupVnToday,
  previousMonthOf as backupPreviousMonthOf,
} from './services/monthly-backup.service.js';
import { buildSocketCorsOptions, getAllowedOrigins } from './config/security.js';
import { isPostgresMode } from './repositories/repository.factory.js';
import { getDriveBackupScheduler } from './services/backup-drive.service.js';

const PORT = process.env.PORT || 4005;

const { app, services, adapter } = createApp();
const postgresMode = isPostgresMode(adapter);
const server = http.createServer(app);

const io = new Server(server, {
  cors: buildSocketCorsOptions(),
});

// Giám sát nền: Sheets mock/stale, hàng đợi ghi kẹt... (xem system-alert.service)
let stopSystemAlerts: (() => void) | null = null;
// Backup 4 tầng lên Drive (giờ/ngày/tuần/tháng) — chỉ bật khi PostgreSQL.
let backupScheduler: ReturnType<typeof getDriveBackupScheduler> | null = null;

// Attach io to express app for route broadcasting
app.set('io', io);

// Tự chữa ca DRAFT lọt vào tuần ĐÃ phát hành (dữ liệu cũ, nhập Excel muộn, BOT xếp
// lại, ca tạo tay sau publish): cả tuần đã publish thì mọi ca phải PUBLISHED —
// tránh NV thấy ca trên lịch nhưng Điểm danh báo "chưa phát hành" và Dữ liệu công
// gắn "Chờ duyệt (chưa tính công)". Chạy ngay sau pull đầu (khi tab PHAN_CONG_CA
// vừa đổi) + định kỳ 60s; throttle 20s để không dội single-writer.
let healDraftRunning = false;
let healDraftLastAt = 0;
let healDraftSoonTimer: ReturnType<typeof setTimeout> | null = null;
const runHealDraftShifts = () => {
  if (healDraftRunning) return;
  healDraftRunning = true;
  healDraftLastAt = Date.now();
  services.schedulesService
    .healDraftsInPublishedWeeks({ actorId: 'SYSTEM' })
    .then((r: any) => {
      const out = r?.result ?? r;
      if ((out?.healed || 0) > 0) {
        console.log(`[schedule-heal] Tự chốt ${out.healed} ca nháp trong tuần đã phát hành (${(out.weeks || []).join(', ')}).`);
      }
    })
    .catch((err: any) => console.warn('[schedule-heal] tick error:', err?.message || err))
    .finally(() => { healDraftRunning = false; });
};
const healDraftShiftsSoon = (delayMs = 1500) => {
  if (healDraftSoonTimer) return;
  const wait = Math.max(delayMs, 20_000 - (Date.now() - healDraftLastAt));
  healDraftSoonTimer = setTimeout(() => {
    healDraftSoonTimer = null;
    runHealDraftShifts();
  }, Math.max(0, wait));
  (healDraftSoonTimer as any)?.unref?.();
};

// Realtime Sheets -> Web: nhịp pull định kỳ HOẶC webhook onEdit phát hiện nội dung
// đổi (hash toàn bộ ô) thì bắn socket đúng 1 lần cho cả 2 cổng web. Đây là đường
// duy nhất bắn 'all' từ pull, tránh tick + webhook cùng bắn trùng một thay đổi.
{
  const syncSvc: any = postgresMode ? null : (adapter as any).syncService;
  if (syncSvc && typeof syncSvc.onDataChanged === 'function') {
    syncSvc.onDataChanged(({ counts, signature, changedTabs }: { counts: any; signature: string; changedTabs: string[] }) => {
      // Tab lịch vừa đổi (webhook sửa tay / pull sau downtime): chốt ca nháp lọt
      // vào tuần đã phát hành ngay, không đợi tick 60s.
      try {
        if ((changedTabs || []).some(t => /^PHAN_CONG_CA(_P\d+)?$/i.test(String(t)))) healDraftShiftsSoon(2500);
      } catch { /* non-fatal */ }
      // Write do chính server phát ra đã được middleware bắn realtime theo entity
      // ngay khi thao tác; bắn thêm 'all' là 2 cổng web tải lại toàn bộ lần 2.
      // Ngoại lệ: vừa có webhook onEdit (sửa tay trên Sheet) thì luôn bắn, trừ khi
      // webhook đến quá sát một write của hệ thống (API write cũng có thể sinh onEdit).
      // Chỉ bỏ emit khi MỌI tab vừa đổi đều do hệ thống vừa ghi (trước đây chặn
      // toàn cục 12s nên sửa tay 1 tab khác bị nuốt mất realtime).
      const selfWrite = (adapter as any).isSelfWriteRecent?.(12000, changedTabs);
      const selfWriteJustNow = (adapter as any).isSelfWriteRecent?.(3000, changedTabs);
      const externalEdit = (adapter as any).isExternalEditRecent?.(8000);
      if (selfWrite && (!externalEdit || selfWriteJustNow)) {
        console.log('🔄 [Sheets Realtime] Nội dung đổi do write của hệ thống (đã realtime theo entity) — bỏ emit "all" thừa.');
        return;
      }
      console.log(
        '🔄 [Sheets Realtime] Google Sheets đổi nội dung — bắn realtime tới 2 cổng web:',
        counts,
        changedTabs.length ? `[${changedTabs.join(', ')}]` : '',
        signature ? `hash ${signature.slice(0, 10)}…` : '',
      );
      io.emit('data:updated', {
        entity: 'all',
        data: { source: externalEdit ? 'sheets-webhook' : 'sheets-change', counts, signature, changedTabs },
        timestamp: new Date().toISOString(),
      });
    });
  }
}

// Pass io to services
services.accountsService.setSocketServer(io);
services.schedulesService.setSocketServer(io);
(services as any).autoScheduleService?.setSocketServer?.(io);
(services as any).testsService?.setSocketServer?.(io);
services.attendanceService.setSocketServer(io);
services.payrollService.setSocketServer(io);
services.notificationsService.setSocketServer(io);

// Socket.IO authentication and room management (có kiểm tra revoke qua DB)
const socketAuth = new AuthService(adapter);
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token || typeof token !== 'string') {
    return next(new Error('AUTHENTICATION_ERROR: Missing token'));
  }

  socketAuth
    .verifyAccessToken(token)
    .then(decoded => {
      (socket as any).user = decoded;
      next();
    })
    .catch(() => {
      next(new Error('AUTHENTICATION_ERROR: Invalid token'));
    });
});

io.on('connection', socket => {
  const user = (socket as any).user;
  const userId = user.employeeId || user.sub;

  // Join personal user room
  socket.join(`user:${userId}`);

  // Join branch room if scoped
  if (user.branchScope && user.branchScope !== '*') {
    socket.join(`branch:${user.branchScope}`);
  }

  // Join role room
  if (user.role) {
    socket.join(`role:${user.role}`);
  }

  socket.on('disconnect', () => {
    // disconnected
  });
});

server.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`ỤM BÒ MILK HR SYSTEM V5.1 - BACKEND SERVER STARTED`);
  console.log(`Port: ${PORT}`);
  console.log(`CORS origins: ${getAllowedOrigins().join(', ') || '(none — set CORS_ORIGINS in production)'}`);
  console.log(`Data store: ${adapter.getStatus().mode}`);
  console.log(`Google Sheets Mode: ${adapter.getStatus().mode}`);
  console.log(`Photo storage: ${postgresMode ? 'Google Drive (metadata trong PostgreSQL)' : 'Drive + inline fallback'}`);
  console.log(`Realtime Socket.IO: Ready`);
  console.log(`Weekly-OFF gate: Fri 09:00 -> Sat 09:00 (VN) + reminder 5 min before`);
  console.log(`System alerts: ${process.env.ALERT_WEBHOOK_URL ? 'webhook configured' : 'log only (set ALERT_WEBHOOK_URL to send externally)'}`);
  console.log(`====================================================`);

  // Cảnh báo vận hành: chờ pull Sheets đầu tiên rồi mới kiểm tra (90s), sau đó 5 phút/lần.
  stopSystemAlerts = startSystemAlertMonitor(adapter, {
    intervalMs: 5 * 60_000,
    initialDelayMs: 90_000,
  });

  // BACKUP 4 TẦNG LÊN GOOGLE DRIVE (chỉ PostgreSQL):
  //   giờ (15 phút) / ngày 02:00 / tuần 02:00 Chủ Nhật / tháng 02:00 ngày cuối tháng.
  if (postgresMode) {
    backupScheduler = getDriveBackupScheduler(adapter);
    void backupScheduler.start().catch((err: any) => {
      console.warn('[backup-drive] Không bật được scheduler:', err?.message || err);
    });
  }

  // Làm ấm cache kho lưu trữ chấm công (tab "Dữ Liệu Công Của Tôi" + bảng công
  // tháng) sau khi pull đầu tiên xong — chạy nền, không chặn khởi động.
  setTimeout(() => {
    if (postgresMode) return; // dữ liệu công nằm trong PostgreSQL, không cần cache Sheets
    try { (adapter as any).syncService?.warmArchivedAttendanceCache?.(); } catch { /* non-fatal */ }
  }, 20_000);

  // Scheduler nhắc mở cổng đăng ký OFF tuần (mỗi 60s + ngay khi boot).
  const weeklyOffTick = () => {
    weeklyOffScheduler
      .tick(adapter, services.notificationsService)
      .catch(err => console.warn('[weekly-off] tick failed:', err?.message || err));
  };
  weeklyOffTick();
  setInterval(weeklyOffTick, 60_000);

  // Background Auto-Sync Worker: tự động kéo dữ liệu từ Google Sheets mỗi 5 giây
  // (SHEETS_SYNC_INTERVAL_MS). Việc phát hiện thay đổi + bắn socket nằm ở
  // syncService.onDataChanged phía trên (hash nội dung, không phải counts).
  // Backoff khi pull lỗi: tránh 6 lần/phút lúc Google Sheets chậm/quota, vì
  // retry dồn dập càng làm pull kế tiếp khó thành công.
  let pullFailStreak = 0;
  let nextPullAllowedAt = 0;
  const autoPullSheetsTick = async () => {
    if (postgresMode) return;
    if (Date.now() < nextPullAllowedAt) return;
    try {
      const syncService = (adapter as any).syncService;
      if (syncService && syncService.getStatus().isConfigured) {
        // Tự chữa pull kẹt: nếu promise pull treo quá 20 phút thì giải phóng để
        // tick này pull lại (tránh tab công tháng đứng dữ liệu vô thời hạn).
        syncService.ensurePullNotStuck?.();
        const pullRes = await syncService.pullAllDataFromGoogleSheets(adapter);
        if (pullRes?.success) {
          pullFailStreak = 0;
          nextPullAllowedAt = 0;
        } else if (pullRes) {
          pullFailStreak += 1;
          const waitMs = Math.min(60_000, 10_000 * 2 ** Math.min(pullFailStreak - 1, 3));
          nextPullAllowedAt = Date.now() + waitMs;
          console.warn(`[sheets-auto-pull] Pull lỗi ${pullFailStreak} lần liên tiếp (${pullRes.message}) — thử lại sau ${Math.round(waitMs / 1000)}s`);
        }
      }
    } catch (err: any) {
      console.warn('[sheets-auto-pull] tick error:', err?.message || err);
    }
  };

  // Kéo dữ liệu tự động ngay sau khi khởi động 2 giây
  setTimeout(autoPullSheetsTick, 2000);
  // Định kỳ tự động quét và kéo dữ liệu mới từ Google Sheets (mặc định 15 giây).
  // Mỗi lượt pull tốn ~5 request đọc (1 batchGet 24 tab + 3-4 request ứng viên).
  // 5s = ~60 request/phút, đúng hạn mức 60/phút của service account -> Google trả
  // 429, pull phình 30-60s và mọi tab chậm theo. 15s vẫn gần realtime vì sửa tay
  // trên Sheet đã có webhook onEdit pull riêng đúng tab.
  const syncIntervalMs = Number(process.env.SHEETS_SYNC_INTERVAL_MS) || 15_000;
  setInterval(autoPullSheetsTick, syncIntervalMs);

  // Chẩn đoán đường GHI Google: khi hàng đợi append báo timeout, /health cần
  // phân biệt "Google chặn POST" hay "Sheet/quota" — probe chạy nền, POST no-op.
  {
    const probe = async () => {
      if (postgresMode) return;
      const syncService = (adapter as any).syncService;
      // KHÔNG probe khi hàng đợi đang tạm nghỉ: probe cũng là lệnh GHI, bắn thêm
      // lúc Google đang khoá chỉ làm khoá kéo dài và cạnh tranh với append thật.
      const queue = (adapter as any).getPendingSheetsWrites?.() || null;
      const paused = !!queue?.pausedUntil && new Date(queue.pausedUntil).getTime() > Date.now();
      const backlog = Number(queue?.pending || 0);
      try {
        if (!paused && backlog < 200
          && syncService?.getStatus?.().isConfigured && typeof syncService.runWriteProbe === 'function') {
          // Chỉ ghi thử 1 dòng AUDIT_LOG khi đường ghi đang có lỗi (tránh rác
          // nhật ký lúc mọi thứ bình thường).
          const includeAppend = !!syncService.getWriteStatus?.().lastWriteError;
          await syncService.runWriteProbe({ includeAppend });
        }
      } catch (err: any) {
        console.warn('[write-probe] error:', err?.message || err);
      }
      // Lỗi ghi đang diễn ra → đo lại mỗi 5 phút; bình thường 15 phút.
      const failing = !!syncService?.getWriteStatus?.().lastWriteError;
      setTimeout(probe, failing ? 5 * 60_000 : 15 * 60_000).unref?.();
    };
    setTimeout(probe, 45_000).unref?.();
  }

  // PUSH ngược toàn bộ tabs lên Sheets định kỳ: chỉ chạy khi bộ nhớ có thay đổi
  // CHƯA lên Sheet (cờ dirty do adapter đặt). Hết hạn tác vụ push khi hệ thống
  // nhàn rỗi — tab thiếu trên Sheet vẫn được tự tạo lại + push dữ liệu đầy đủ.
  // Mặc định 60 phút (theo .env.example), đặt SHEETS_AUTO_PUSH_MINUTES=0 để tắt.
  const rawPushMinutes = process.env.SHEETS_AUTO_PUSH_MINUTES;
  const pushPeriodMin = rawPushMinutes && rawPushMinutes.trim() !== '' && Number(rawPushMinutes) > 0 ? Number(rawPushMinutes) : 60;
  if (rawPushMinutes?.trim() !== '0' && !postgresMode) {
    const autoPushSheetsTick = async () => {
      try {
        const syncService = (adapter as any).syncService;
        if (syncService && syncService.getStatus().isConfigured) {
          // TRƯỚC ĐÂY: mỗi 5 phút ghi đè ~16-17 tab (~34-40 write/update+clear), lấp
          // quota 60 write/phút khiến thao tác người dùng phải chờ slot write — 2
          // cổng web cập nhật chậm. Chỉ push khi có thay đổi thật.
          if (typeof syncService.hasUnpushedChanges === 'function' && !syncService.hasUnpushedChanges()) {
            return;
          }
          const pushRes = await syncService.syncAllData(adapter);
          if (pushRes?.success) {
            console.log('🔁 [Sheets Auto-Push] Đã đồng bộ đầy đủ toàn bộ tabs lên Google Sheets.');
            // KHÔNG emit 'data:updated' sau push: mọi thay đổi đã được bắn realtime
            // theo entity ngay khi xảy ra (middleware + services) — bắn 'all' vô
            // điều kiện là nguyên nhân 2 cổng web tự tải lại toàn bộ chu kỳ 5 phút.
          }
        }
      } catch (err: any) {
        console.warn('[sheets-auto-push] tick error:', err?.message || err);
      }
    };
    // Không chạy auto-push ngay sau khi khởi động (tránh rủi ro push trước khi hoàn thành pull)
    setInterval(autoPushSheetsTick, pushPeriodMin * 60_000);
  }

  // Tự động kiểm tra & căn chỉnh Google Sheets: theo biến môi trường
  // SHEETS_AUTO_BEAUTIFY (mặc định BẬT) nhưng chỉ NGÀY 1 LẦN thay vì mỗi 15 phút —
  // mỗi lần tốn ~20-30 write + đọc 20 dòng mỗi tab, lấn quota write của thao tác
  // thật khiến 2 cổng web chậm.
  {
    const beautifyFlagV = String(process.env.SHEETS_AUTO_BEAUTIFY ?? '1').trim().toLowerCase();
    const beautifyOn = beautifyFlagV !== '0' && beautifyFlagV !== 'off' && beautifyFlagV !== 'false';
    if (beautifyOn && !postgresMode) {
      const autoBeautifyTick = async () => {
        try {
          const syncService = (adapter as any).syncService;
          if (syncService && syncService.getStatus().isConfigured) {
            // applyConditionalRules=false: chỉ căn chữ/độ rộng. Add rule status
            // mỗi ngày là nguyên nhân bảng tính phình ~430.000 conditional rule.
            await syncService.formatAndBeautifySpreadsheet(undefined, { applyConditionalRules: false });
            console.log('🎨 [Sheets Auto-Beautify] Đã tự động căn chỉnh & làm đẹp bảng tính Google Sheets định kỳ.');
          }
        } catch (e: any) {
          console.warn('[sheets-auto-beautify] tick error:', e?.message || e);
        }
      };
      setTimeout(autoBeautifyTick, 90_000); // 90s sau khởi động
      setInterval(autoBeautifyTick, 24 * 60 * 60_000); // mỗi 24h
    }
  }

  // Dọn conditional-format rule trùng vô hạn (beautify cũ add mỗi lần chạy mà
  // không xoá -> ~430.000 rule khiến mọi thao tác Sheets chậm 2-3s). Job chạy nền,
  // xoá theo lô và nhường ngay khi có ghi thật của người dùng — nhưng chỉ khi rảnh.
  {
    // Opt-in: xoá rule theo index rất tốn thời gian (~180ms/rule) và phải giữ khoá
    // ghi Sheets, nên mặc định TẮT. Chỉ bật khi rảnh và luôn giới hạn khung giờ.
    const cfFlag = String(process.env.SHEETS_CF_CLEANUP ?? '0').trim().toLowerCase();
    const cfOn = cfFlag === '1' || cfFlag === 'on' || cfFlag === 'true';
    if (cfOn) {
      const rawWindow = String(process.env.SHEETS_CF_CLEANUP_WINDOW || '0-5');
      const [wsRaw, weRaw] = rawWindow.split('-');
      const wStart = Math.min(23, Math.max(0, Number(wsRaw) || 0));
      const wEnd = Math.min(24, Math.max(1, Number(weRaw) || 5));
      // Giờ VN = UTC+7.
      const inCleanupWindow = () => {
        const h = new Date(Date.now() + 7 * 3_600_000).getUTCHours();
        return wStart <= wEnd ? (h >= wStart && h < wEnd) : (h >= wStart || h < wEnd);
      };
      const cfTick = async () => {
        try {
          // Ngoài khung giờ rảnh: không đụng Sheets (tránh làm chậm duyệt phiếu/
          // điểm danh), kiểm tra lại sau 15 phút.
          if (!inCleanupWindow()) {
            setTimeout(cfTick, 15 * 60_000).unref?.();
            return;
          }
          const syncService = (adapter as any).syncService;
          if (!syncService?.getStatus?.().isConfigured) return;
          const r = await syncService.cleanupConditionalFormats();
          if (r?.deleted > 0) {
            console.log(`🧹 [sheets-cf-cleanup] Đã dọn ${r.deleted} rule trùng (${r.tabs} tab).`);
            // Còn rule -> chạy tiếp sau 2 phút; dọn xong -> kiểm tra lại mỗi 6 giờ.
            setTimeout(cfTick, 2 * 60_000).unref?.();
          } else {
            // Đã dọn sạch: add lại đúng bộ rule chuẩn (1 lần) để status pill có màu.
            if (syncService.needsCfReapply) {
              syncService.needsCfReapply = false;
              await syncService.formatAndBeautifySpreadsheet(undefined, { applyConditionalRules: true })
                .catch((e: any) => console.warn('[sheets-cf-cleanup] add lại rule lỗi:', e?.message || e));
              console.log('🎨 [sheets-cf-cleanup] Đã add lại bộ conditional-format chuẩn sau khi dọn.');
            }
            setTimeout(cfTick, 6 * 60 * 60_000).unref?.();
          }
        } catch (e: any) {
          console.warn('[sheets-cf-cleanup] tick error:', e?.message || e);
          setTimeout(cfTick, 30 * 60_000).unref?.();
        }
      };
      setTimeout(cfTick, 120_000).unref?.();
    }
  }

  // Nhắc việc tự động mỗi 5 phút: check-in Zalo trước ca, PIN quá hạn, đơn tồn duyệt.
  const autoRemindersTickSafe = () => {
    autoRemindersTick(adapter, services.notificationsService, services.zaloService).catch(err =>
      console.warn('[auto-reminders] tick error:', err?.message || err)
    );
  };
  setTimeout(autoRemindersTickSafe, 60_000); // đợi dữ liệu load xong lần đầu
  setInterval(autoRemindersTickSafe, 5 * 60_000);

  // Phiếu bổ sung công gửi HR quá 30 phút chưa duyệt: tự động TỪ CHỐI (giữ phiếu
  // để đối soát) + báo inbox NV; phiếu đã tự từ chối quá 7 ngày nữa thì tự XÓA.
  // Chạy mỗi 1 phút để bám sát hiệu lực 30 phút của phiếu.
  const adjustmentExpiryTickSafe = async () => {
    try {
      const r = await services.attendanceService.expireStaleAdjustments(new Date());
      if (r.rejected.length > 0) {
        console.log(`[adjustments] Tự từ chối ${r.rejected.length} phiếu quá 30 phút HR chưa duyệt.`);
        for (const item of r.rejected) {
          try {
            await services.notificationsService.sendNotification({
              recipientIds: [item.employeeId],
              type: 'ADJUSTMENT_AUTO_REJECTED',
              severity: 'ACTION_REQUIRED',
              title: '⏳ Phiếu bổ sung công quá 30 phút chưa được duyệt',
              summary: 'HR chưa duyệt phiếu của bạn sau 30 phút nên hệ thống đã tự động từ chối. Cần thì gửi lại phiếu mới hoặc báo trực tiếp Store/HR!',
              targetPath: '/adjustment',
              actorId: 'SYSTEM',
            }).catch(() => null);
          } catch { /* best-effort từng người */ }
        }
        try {
          io.emit('data:updated', { entity: 'adjustments', data: { action: 'auto-rejected', ids: r.rejected.map(x => x.adjustmentId) }, timestamp: new Date().toISOString() });
        } catch { /* non-fatal */ }
      }
      if (r.deleted.length > 0) {
        console.log(`[adjustments] Tự xóa ${r.deleted.length} phiếu đã tự từ chối quá 7 ngày.`);
        try {
          io.emit('data:updated', { entity: 'adjustments', data: { action: 'auto-deleted', ids: r.deleted }, timestamp: new Date().toISOString() });
        } catch { /* non-fatal */ }
      }
    } catch (err: any) {
      console.warn('[adjustments] expiry tick error:', err?.message || err);
    }
  };
  setTimeout(adjustmentExpiryTickSafe, 60_000);
  setInterval(adjustmentExpiryTickSafe, 60_000);

  // Rà soát QR ngân hàng đã lưu (chạy lúc boot + mỗi giờ): đọc lại payload QR
  // trong ảnh để SỬA đúng thông tin chữ đang sai (VD nhầm ngân hàng khác),
  // GỠ ảnh hỏng/thiếu trường + báo NV tải lại. Sheets + realtime 2 cổng.
  const bankQrCleanupTickSafe = async () => {
    try {
      const r = await services.employeesService.auditBankQrCodes().catch(() => null);
      if (!r || ((r.fixed || []).length === 0 && (r.cleared || []).length === 0)) return;
      for (const f of r.fixed || []) {
        try {
          await services.notificationsService.sendNotification({
            recipientIds: [f.employee_id],
            type: 'BANK_QR_FIXED',
            severity: 'SYSTEM',
            title: 'ℹ️ Thông tin ngân hàng đã được hiệu chỉnh theo mã QR',
            summary: `Hệ thống đọc lại mã QR của bạn và đã cập nhật đúng: ${f.bank} • ${f.account} • ${f.holder}. Mở Hồ Sơ kiểm tra lại giúp!`,
            targetPath: '/profile',
            actorId: 'SYSTEM',
          });
        } catch { /* best-effort từng người */ }
      }
      for (const c of r.cleared || []) {
        try {
          await services.notificationsService.sendNotification({
            recipientIds: [c.employee_id],
            type: 'BANK_QR_INVALID',
            severity: 'ACTION_REQUIRED',
            title: '⚠️ Mã QR ngân hàng chưa đạt chuẩn đã được gỡ',
            summary: 'Ảnh QR của bạn thiếu tên ngân hàng / số tài khoản / tên chủ tài khoản nên hệ thống đã tự gỡ. Mở Hồ Sơ → tải lại ảnh mã QR VietQR rõ nét để Kế toán chuyển khoản lương!',
            targetPath: '/profile',
            actorId: 'SYSTEM',
          });
        } catch { /* best-effort từng người */ }
      }
      console.log(`[bank-qr] Rà soát ${r.checked} QR: sửa ${(r.fixed || []).length}, gỡ ${(r.cleared || []).length}.`);
      try {
        io.emit('data:updated', { entity: 'employees', data: { action: 'bank-qr-audit', fixed: (r.fixed || []).length, cleared: (r.cleared || []).length }, timestamp: new Date().toISOString() });
      } catch { /* non-fatal */ }
    } catch (err: any) {
      console.warn('[bank-qr] cleanup tick error:', err?.message || err);
    }
  };
  setTimeout(bankQrCleanupTickSafe, 90_000);
  setInterval(bankQrCleanupTickSafe, 60 * 60_000);

  // Tự ghi VẮNG: ca PUBLISHED qua giờ kết thúc 30p mà không check-in -> bản ghi
  // ABSENT làm chứng cứ (đỏ trên 2 cổng, đồng bộ Sheets). Chạy mỗi 15 phút.
  const absenteeTickSafe = async () => {
    try {
      const r = await services.attendanceService.markAbsentees(new Date(), 30);
      if (r.marked > 0 || (r as any).cleaned > 0) {
        console.log(`[absentee] Đã ghi vắng ${r.marked} ca + dọn ${(r as any).cleaned || 0} vắng oan (quét ${r.checked}).`);
        try {
          io.emit('data:updated', { entity: 'attendance', data: { action: 'absent-marked', ...r }, timestamp: new Date().toISOString() });
        } catch { /* non-fatal */ }
      }
    } catch (err: any) {
      console.warn('[absentee] tick error:', err?.message || err);
    }
  };
  setTimeout(absenteeTickSafe, 120_000); // sau pull đầu
  setInterval(absenteeTickSafe, 15 * 60_000);

  // Tuần chấm công T2–CN: CN 20h00 nhắc HR tải trước 23h30, 23h30 tự lưu trữ
  // (ZIP tuần lên Drive + chuyển dòng sang tab LUUTRU + reset bảng realtime sang tuần mới),
  // T2 00h05 chạy dự phòng nếu lúc 23h30 server ngủ. Mỗi mốc chạy 1 lần/tuần.
  const weeklyDone = new Set<string>();
  const vnParts = (d: Date) => {
    const vn = new Date(d.getTime() + 7 * 3_600_000);
    return { dowSun0: vn.getUTCDay(), hh: vn.getUTCHours(), mm: vn.getUTCMinutes(), dateStr: vn.toISOString().slice(0, 10) };
  };
  const mondayOf = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const t = Date.UTC(y, m - 1, d);
    const dt = new Date(t);
    const back = (dt.getUTCDay() + 6) % 7;
    return new Date(t - back * 86_400_000).toISOString().slice(0, 10);
  };
  // Reset phiếu đổi ca tuần (NV chính thức): CN 23h30 tự hủy các phiếu còn mở
  // (PENDING_PARTNER/PARTNER_ACCEPTED) của tuần vừa hết để web app sang tuần mới
  // sạch — NV tạo phiếu mới cho tuần mới. Phiếu APPROVED/REJECTED/CANCELLED giữ
  // nguyên lịch sử + công/lương. Bền vững Sheets (updateSwapRequest đẩy tab ngay)
  // + realtime 'swaps' cho 2 cổng tải lại.
  const swapWeekReset = async (weekMon: string, tag: string) => {
    try {
      const key = `swap-reset:${weekMon}`;
      if (weeklyDone.has(key)) return { total: 0, cancelled: 0 };
      weeklyDone.add(key);
      const all = await adapter.listSwapRequests().catch(() => []);
      const open = (all || []).filter((s: any) =>
        ['PENDING_PARTNER', 'PARTNER_ACCEPTED'].includes(String((s as any)?.status || '')));
      if (open.length === 0) return { total: 0, cancelled: 0 };
      // Thứ 2 tuần mới = thứ 2 tuần vừa hết + 7 ngày: phiếu còn mở mà ca thuộc
      // tuần cũ (ngày ca < thứ 2 tuần mới) thì hết hiệu lực; phiếu tuần mới giữ lại.
      const [wy, wm, wd] = weekMon.split('-').map(Number);
      const nextMon = new Date(Date.UTC(wy, wm - 1, wd) + 7 * 86_400_000).toISOString().slice(0, 10);
      let cancelled = 0;
      for (const sw of open) {
        let day = String((sw as any)?.support_date || '').slice(0, 10);
        if (!day) {
          const aid = (sw as any)?.requester_assignment_id || (sw as any)?.target_assignment_id;
          if (aid) {
            const sh: any = await adapter.getShiftById(aid).catch(() => null);
            if (sh) day = String((sh as any)?.date || '').slice(0, 10);
          }
        }
        if (!day) day = String((sw as any)?.created_at || '').slice(0, 10);
        if (!day || day >= nextMon) continue;
        try {
          await adapter.updateSwapRequest((sw as any).swap_id, {
            status: 'CANCELLED',
            rejection_reason: 'Tự động hủy khi reset tuần (CN 23:30) — phiếu tuần cũ hết hiệu lực, NV tạo phiếu mới cho tuần mới.',
          } as any);
          cancelled++;
        } catch { /* phiếu tiếp theo */ }
      }
      if (cancelled > 0) {
        try {
          io.emit('data:updated', { entity: 'swaps', data: { action: 'week-reset', weekMon, cancelled }, timestamp: new Date().toISOString() });
        } catch { /* non-fatal */ }
      }
      console.log(`[swap-week-reset] ${tag} tuần ${weekMon}: hủy ${cancelled}/${open.length} phiếu mở.`);
      return { total: open.length, cancelled };
    } catch (err: any) {
      console.warn('[swap-week-reset] tick error:', err?.message || err);
      return { total: 0, cancelled: 0 };
    }
  };
  const attendanceWeekTick = async () => {
    try {
      const now = new Date();
      const { dowSun0, hh, mm } = vnParts(now);
      const syncService = (adapter as any).syncService;
      if (!syncService?.archiveAttendanceWeek) return;
      // CN 20h00: nhắc HR tải ZIP tuần trước 23h30
      if (dowSun0 === 0 && hh === 20 && mm < 2) {
        const key = `remind:${vnParts(now).dateStr}`;
        if (!weeklyDone.has(key)) {
          weeklyDone.add(key);
          const admins = await adapter.listAdminAccounts().catch(() => []);
          const ids = admins.filter(a => (a.role === 'ADMIN' || a.role === 'HR') && a.is_active !== false).map(a => a.admin_id);
          if (ids.length > 0) {
            await services.notificationsService.sendNotification({
              recipientIds: ids,
              type: 'ATTENDANCE_WEEK_EXPORT',
              severity: 'ACTION_REQUIRED',
              title: '⏰ Tải điểm danh tuần trước 23h30 tối nay',
              summary: '23h30 hệ thống tự lưu trữ + reset bảng realtime sang tuần mới. HR tải ZIP tuần (tab Chấm công → Tải ZIP tuần) để lưu máy.',
              actorId: 'SYSTEM',
            }).catch(() => null);
          }
        }
        return;
      }
      // CN 23h30: lưu trữ + reset (chấm công + phiếu đổi ca tuần)
      if (dowSun0 === 0 && hh === 23 && mm >= 30 && mm < 32) {
        const weekMon = mondayOf(vnParts(now).dateStr);
        const key = `archive:${weekMon}`;
        if (!weeklyDone.has(key)) {
          weeklyDone.add(key);
          const r = postgresMode
            ? { archived: false, reason: 'POSTGRES_NO_WEEKLY_ARCHIVE' }
            : await syncService.archiveAttendanceWeek(adapter, weekMon).catch((e: any) => ({ archived: false, reason: e?.message }));
          console.log(`[attendance-week] Archive tuần ${weekMon}:`, JSON.stringify(r));
          try {
            io.emit('data:updated', { entity: 'attendance', data: { action: 'week-archived', weekMon, ...r }, timestamp: new Date().toISOString() });
          } catch { /* non-fatal */ }
        }
        await swapWeekReset(weekMon, 'CN 23h30');
        return;
      }
      // T2 00h05: dự phòng nếu CN 23h30 server ngủ
      if (dowSun0 === 1 && hh === 0 && mm >= 5 && mm < 7) {
        const ymd = vnParts(now).dateStr;
        const [y, m, d] = ymd.split('-').map(Number);
        const lastSun = new Date(Date.UTC(y, m - 1, d) - 86_400_000).toISOString().slice(0, 10);
        const weekMon = mondayOf(lastSun);
        const key = `archive:${weekMon}`;
        if (!weeklyDone.has(key)) {
          weeklyDone.add(key);
          const r = postgresMode
            ? { archived: false, reason: 'POSTGRES_NO_WEEKLY_ARCHIVE' }
            : await syncService.archiveAttendanceWeek(adapter, weekMon).catch((e: any) => ({ archived: false, reason: e?.message }));
          console.log(`[attendance-week] Archive bù tuần ${weekMon}:`, JSON.stringify(r));
        }
        await swapWeekReset(weekMon, 'T2 00h05 bù');
      }
    } catch (err: any) {
      console.warn('[attendance-week] tick error:', err?.message || err);
    }
  };
  setInterval(attendanceWeekTick, 60_000);

  // Tự tính nháp lương cuối tháng (Kế toán kiểm tra rồi duyệt tay):
  // 00h10 ngày mùng 1 HẰNG THÁNG: tự chạy công thức Excel cho tháng vừa qua,
  // tạo đúng 1 kỳ DRAFT (tháng đã có kỳ thì bỏ qua, không tính trùng).
  // Kế toán vào tab 5 kiểm tra B4 → sang tab 4 Đối soát/Duyệt/Phát hành.
  const payrollAutoDone = new Set<string>();
  const payrollAutoTick = async () => {
    try {
      const now = new Date();
      const { hh, mm, dateStr } = vnParts(now);
      if (dateStr.slice(8, 10) !== '01') return; // chỉ mùng 1
      if (hh !== 0 || mm < 10 || mm >= 30) return; // cửa sổ 00h10–00h30
      const [y, m] = dateStr.split('-').map(Number);
      const prev = new Date(Date.UTC(y, m - 1, 1) - 86_400_000);
      const period = prev.toISOString().slice(0, 7);
      const key = `payroll-auto:${period}`;
      if (payrollAutoDone.has(key)) return;
      payrollAutoDone.add(key);
      const existing = await adapter.listPayrollRuns().catch(() => []);
      if ((existing || []).some((r: any) => String((r as any).period) === period)) {
        console.log(`[payroll-auto] Kỳ ${period} đã có — bỏ qua tính nháp tự động.`);
        return;
      }
      const res: any = await services.payrollService
        .calculateFormulaPayroll(period, '*', 'SYSTEM')
        .catch((e: any) => ({ error: e?.message || String(e) }));
      if (res?.error) {
        console.warn(`[payroll-auto] Tính nháp kỳ ${period} thất bại:`, res.error);
        return;
      }
      const run = res?.run ?? res;
      console.log(`[payroll-auto] Đã tự tính nháp kỳ ${period}: ${run?.total_employees ?? '?'} NV, thực lãnh ${Number(run?.total_amount || 0).toLocaleString('vi-VN')}đ.`);
      const admins = await adapter.listAdminAccounts().catch(() => []);
      const ids = (admins || [])
        .filter((a: any) => ['ADMIN', 'FINANCE'].includes(a.role) && a.is_active !== false)
        .map((a: any) => a.admin_id);
      if (ids.length > 0) {
        await services.notificationsService.sendNotification({
          recipientIds: ids,
          type: 'PAYROLL_AUTO_DRAFT',
          severity: 'ACTION_REQUIRED',
          title: `🤖 Đã tự tính nháp lương tháng ${period.slice(5, 7)}/${period.slice(0, 4)}`,
          summary: `Hệ thống tự chạy công thức Excel lúc 00h10 mùng 1: ${run?.total_employees ?? '?'} NV, thực lãnh ${Number(run?.total_amount || 0).toLocaleString('vi-VN')}đ. Kế toán kiểm tra tab Tính lương (B4) rồi Đối soát/Duyệt/Phát hành.`,
          actorId: 'SYSTEM',
        }).catch(() => null);
      }
      try {
        io.emit('data:updated', { entity: 'payroll', data: { action: 'auto-draft', period, runId: run?.run_id }, timestamp: new Date().toISOString() });
      } catch { /* non-fatal */ }
    } catch (err: any) {
      console.warn('[payroll-auto] tick error:', err?.message || err);
    }
  };
  setInterval(payrollAutoTick, 5 * 60_000);

  // Reset hộp thư 23h00 HẰNG NGÀY (1 lần/ngày): xóa toàn bộ thông báo trong ngày
  // trong bộ nhớ để 2 cổng sang trạng thái sạch (tab Sheets THONGBAO_NV giữ nguyên
  // lịch sử; pull tối cũng chặn dòng cũ kéo lại nhờ mốc latch). Sáng sớm (00h–06h)
  // chạy bù nếu tối qua server ngủ.
  const notifResetDone = new Set<string>();
  const notifResetTick = async () => {
    try {
      const vn = new Date(Date.now() + 7 * 3_600_000);
      const hh = vn.getUTCHours();
      const today = vn.toISOString().slice(0, 10);
      const syncService = (adapter as any).syncService;
      if (hh >= 23) {
        const key = `notif-reset:${today}`;
        if (notifResetDone.has(key)) return;
        notifResetDone.add(key);
        // Chốt mốc latch trước rồi mới xóa: pull kế tiếp không kéo lại dòng cũ,
        // tin mới phát sinh sau 23h00 vẫn vào bình thường.
        const at = new Date().toISOString();
        try {
          if (syncService) syncService.notifResetCutoffIso = at;
        } catch { /* non-fatal */ }
        const removed = await adapter.pruneNotifications(at).catch(() => 0);
        console.log(`[notifications] Reset 23h00 ${today}: đã xóa ${removed} thông báo trong ngày (Sheets giữ nguyên).`);
        try {
          io.emit('data:updated', { entity: 'notifications', data: { action: 'daily-reset', today, removed }, timestamp: new Date().toISOString() });
        } catch { /* non-fatal */ }
      } else if (hh < 6) {
        const key = `notif-reset:${today}:catchup`;
        if (notifResetDone.has(key)) return;
        notifResetDone.add(key);
        // Mốc 00h00 hôm nay giờ VN (quy về UTC để so chuỗi ISO cho đúng)
        const [yy, mm, dd] = today.split('-').map(Number);
        const cutoff = new Date(Date.UTC(yy, mm - 1, dd) - 7 * 3_600_000).toISOString();
        const removed = await adapter.pruneNotifications(cutoff).catch(() => 0);
        if (removed > 0) {
          console.log(`[notifications] Reset bù sáng sớm ${today}: đã xóa ${removed} thông báo hôm qua (Sheets giữ nguyên).`);
          try {
            io.emit('data:updated', { entity: 'notifications', data: { action: 'daily-reset', today, removed }, timestamp: new Date().toISOString() });
          } catch { /* non-fatal */ }
        }
      }
    } catch (err: any) {
      console.warn('[notifications] reset tick error:', err?.message || err);
    }
  };
  setInterval(notifResetTick, 5 * 60_000);

  // Xoay PIN định kỳ hàng tháng (ngày 1-5): cấp PIN mới theo mẻ, báo NV + HR/Admin.
  const pinRotationTickSafe = () => {
    pinRotationTick(adapter, services.notificationsService)
      .then(prog => {
        if (prog && !prog.completed) {
          try {
            io.emit('data:updated', { entity: 'accounts', data: { action: 'pin-rotation', ...prog }, timestamp: new Date().toISOString() });
          } catch { /* non-fatal */ }
        }
      })
      .catch(err => console.warn('[pin-rotation] tick error:', err?.message || err));
  };
  setTimeout(pinRotationTickSafe, 90_000); // sau pull đầu
  setInterval(pinRotationTickSafe, 60 * 60_000);

  // Tự rà soát lịch PV trùng (< 30 phút cùng ngày): lịch HR đã đặt được GIỮ
  // NGUYÊN, chỉ báo HR xử lý tay (xóa tay chỉ khi HR bấm nút Xóa lịch trùng),
  // đồng thời tự loại ứng viên Kết Quả LOẠI (ẩn khỏi danh sách).
  // Chạy sau pull đầu + mỗi 5 phút (chỉ chạm lịch sắp tới, lịch đã qua không đụng).
  const interviewDedupeTickSafe = () => {
    dedupeDuplicateInterviews(adapter, services.notificationsService, { dryRun: true, actorId: 'SYSTEM' })
      .then(r => {
        if (r && r.removedCount > 0) {
          console.log(`[interview-dedupe] Phát hiện ${r.removedCount} lịch PV trùng — đã báo HR xử lý tay, giữ nguyên lịch HR đã đặt.`);
        }
        return enforceScreeningOutcomes(adapter, services.notificationsService, 'SYSTEM');
      })
      .then(r => {
        if (r && r.rejectedCount > 0) {
          console.log(`[interview-dedupe] Tự động loại ${r.rejectedCount} ứng viên LOẠI.`);
          try {
            io.emit('data:updated', { entity: 'candidates', data: { action: 'auto-rejected', rejected: r.rejectedCount }, timestamp: new Date().toISOString() });
          } catch { /* non-fatal */ }
        }
      })
      .catch(err => console.warn('[interview-dedupe] tick error:', err?.message || err));
  };
  setTimeout(interviewDedupeTickSafe, 120_000);
  setInterval(interviewDedupeTickSafe, 5 * 60_000);

  // Tự kẹp lịch OFF tuần quá 2 ngày/NV/tuần về đúng 2 ngày mới nhất (giữ 2 phiếu mới
  // nhất, hủy phần thừa do lọt đếm/bấm đúp/dữ liệu cũ) — chạy sau pull đầu + mỗi 5 phút,
  // không cần HR bấm nút. Có thay đổi -> bắn realtime để các cổng tải lại ngay.
  const weeklyOffClampTickSafe = () => {
    (services.schedulesService as any).clampWeeklyOffOverLimit('SYSTEM', false)
      .then((r: any) => {
        if (r && r.cancelledCount > 0) {
          console.log(`[weekly-off-clamp] Đã kẹp ${r.cancelledCount} phiếu OFF quá 2 ngày/tuần về đúng 2 ngày mới nhất.`);
          try {
            io.emit('data:updated', { entity: 'leaves', data: { action: 'weekly-off-overlimit-clamp', cancelled: r.cancelledCount }, timestamp: new Date().toISOString() });
          } catch { /* non-fatal */ }
        }
      })
      .catch((err: any) => console.warn('[weekly-off-clamp] tick error:', err?.message || err));
  };
  setTimeout(weeklyOffClampTickSafe, 150_000);
  setInterval(weeklyOffClampTickSafe, 5 * 60_000);

  // Tự gỡ OFF trùng cùng ca cùng chi nhánh về chưa đăng ký (người đăng ký
  // trước giữ ngày, người sau đăng ký lại) — chạy sau pull đầu + mỗi 5 phút,
  // dọn cả các cặp trùng đã lọt trước đây. Có thay đổi -> báo NV + realtime.
  const weeklyOffOverlapTickSafe = () => {
    (services.schedulesService as any).resolveSameShiftOffOverlaps('SYSTEM', false)
      .then(async (r: any) => {
        if (r && r.cancelledCount > 0) {
          console.log(`[weekly-off-overlap] Đã gỡ ${r.cancelledCount} OFF trùng về chưa đăng ký.`);
          for (const c of r.clashes || []) {
            for (const x of c.cancelled || []) {
              try {
                await services.notificationsService.sendNotification({
                  recipientIds: [x.employee_id],
                  type: 'WEEKLY_OFF_OVERLAP_RESET',
                  severity: 'ACTION_REQUIRED',
                  title: '⚠️ Ngày OFF của bạn bị trùng, cần đăng ký lại',
                  summary: `Ngày ${String(c.date || '').split('-').reverse().join('/')} đã có ${c.kept?.employee || 'đồng nghiệp'} cùng ${c.shift || 'ca'} đăng ký OFF trước nên OFF của bạn đã được gỡ về chưa đăng ký. Vui lòng chọn ngày khác (cổng mở T6 09h00 – T7 09h00 hoặc chờ Admin mở bù)!`,
                  targetPath: '/leave',
                  actorId: 'SYSTEM',
                });
              } catch { /* best-effort từng người */ }
            }
          }
          try {
            io.emit('data:updated', { entity: 'leaves', data: { action: 'weekly-off-overlap-reset', cancelled: r.cancelledCount }, timestamp: new Date().toISOString() });
          } catch { /* non-fatal */ }
        }
      })
      .catch((err: any) => console.warn('[weekly-off-overlap] tick error:', err?.message || err));
  };
  setTimeout(weeklyOffOverlapTickSafe, 160_000);
  setInterval(weeklyOffOverlapTickSafe, 5 * 60_000);
  // Tự đồng bộ ca trùng OFF cũ: ca làm trùng ngày OFF của cùng NV (từ hôm nay)
  // thì ngày OFF thành ca làm — chạy sau pull đầu + mỗi 60s, không cần HR bấm nút.
  // Có thay đổi -> bắn realtime để lịch 2 cổng hết cảnh báo trùng ngay.
  const shiftOffSyncTickSafe = () => {
    (services.schedulesService as any).syncShiftOffOverlaps('SYSTEM', false)
      .then((r: any) => {
        if (r && r.cancelledCount > 0) {
          console.log(`[shift-off-sync] Đã chuyển ${r.cancelledCount} ngày OFF trùng ca thành ca làm việc.`);
          try {
            io.emit('data:updated', { entity: 'leaves', data: { action: 'shift-off-overlap-sync', cancelled: r.cancelledCount }, timestamp: new Date().toISOString() });
            io.emit('data:updated', { entity: 'schedules', data: { action: 'shift-off-overlap-sync', cancelled: r.cancelledCount }, timestamp: new Date().toISOString() });
          } catch { /* non-fatal */ }
        }
      })
      .catch((err: any) => console.warn('[shift-off-sync] tick error:', err?.message || err));
  };
  setTimeout(shiftOffSyncTickSafe, 150_000);
  setInterval(shiftOffSyncTickSafe, 60_000);

  // Tự chữa ca DRAFT lọt vào tuần ĐÃ phát hành: dùng chung runHealDraftShifts
  // (định nghĩa đầu file, cũng được kích hoạt ngay khi pull thấy PHAN_CONG_CA đổi).
  // Chạy sớm (15s sau boot) để lịch hết "nháp" trước khi HR/NV kịp nhìn.
  setTimeout(runHealDraftShifts, 15_000);
  setInterval(runHealDraftShifts, 60_000);

  // Rà soát NV "dính" thử việc (mỗi 5 phút): NV còn PROBATION nhưng official_date
  // đã đến/quá -> tự chuyển chính thức + gỡ ca thử việc tương lai. Che 2 lỗ:
  // (1) HR sửa ngày chính thức tab Hồ Sơ mà quên "Chuyển chính thức";
  // (2) sửa trực tiếp Sheet bị merge pull lùi về bản cũ. Chạy muộn (2.2 phút)
  // để pull dữ liệu Sheet đầu tiên xong rồi mới heal — không heal khi rỗng.
  const employeesReconcileTickSafe = () => {
    (services.employeesService as any).reconcileProbationStatuses()
      .then((r: any) => {
        if (r && r.promoted && r.promoted.length > 0) {
          try {
            io.emit('data:updated', { entity: 'employees', data: { action: 'auto-promote-official', employees: r.promoted }, timestamp: new Date().toISOString() });
          } catch { /* non-fatal */ }
        }
      })
      .catch((err: any) => console.warn('[employees-reconcile] tick error:', err?.message || err));
  };
  setTimeout(employeesReconcileTickSafe, 130_000);
  setInterval(employeesReconcileTickSafe, 5 * 60_000);

  // Nhắc HR trước giờ PV 15 phút (mỗi 60s): inbox bền vững + popup realtime.
  const interviewReminderTickSafe = () => {
    interviewReminderTick(adapter, services.notificationsService, Date.now())
      .then(r => {
        if (!r || r.reminded.length === 0) return;
        for (const item of r.reminded) {
          console.log(`[interview-reminder] Sắp PV: ${item.candidateName} ${item.timeSlot} ${item.date} (còn ${item.minutesLeft}p).`);
          try {
            io.emit('system:notification', {
              id: `notif_${Date.now()}_${item.submissionId}`,
              type: 'CANDIDATE',
              title: `⏰ Sắp tới giờ PV: ${item.candidateName} (${item.timeSlot} — còn ${item.minutesLeft} phút)`,
              message: `${item.candidateName} phỏng vấn lúc ${item.timeSlot} ngày ${item.date}. HR chuẩn bị vào Meet trước 5 phút!`,
              linkTab: 'hr-interviews',
              origin: 'ADMIN',
              metadata: { submissionId: item.submissionId },
              targetRoles: ['ADMIN', 'HR'],
              timestamp: new Date().toISOString(),
            });
          } catch { /* non-fatal */ }
        }
      })
      .catch(err => console.warn('[interview-reminder] tick error:', err?.message || err));
  };
  setTimeout(interviewReminderTickSafe, 30_000);
  setInterval(interviewReminderTickSafe, 60_000);

  // Tự đánh VẮNG PV không phép (phương án A, mỗi 5 phút): INVITED quá giờ hẹn
  // 30 phút vẫn im lặng -> NO_SHOW + xóa lịch giải phóng slot + báo HR.
  const interviewNoShowTickSafe = () => {
    interviewNoShowTick(
      adapter,
      services.notificationsService,
      async (sid: string) => {
        await services.employeesService.markInterviewNoShow(sid, 'SYSTEM', 'Quá giờ hẹn 30 phút không xác nhận');
        try {
          const syncSvc = (adapter as any)?.syncService;
          syncSvc?.markInterviewScheduleCleared?.(sid);
          await (adapter as any)?.pushCandidatesNow?.();
        } catch { /* tick sau thử lại */ }
      },
      Date.now()
    )
      .then(r => {
        for (const m of r?.marked || []) {
          console.log(`[interview-noshow] Vắng PV: ${m.candidateName} (${m.submissionId}).`);
          try {
            io.emit('system:notification', {
              id: `notif_${Date.now()}_${m.submissionId}`,
              type: 'CANDIDATE',
              title: `🚫 ${m.candidateName} vắng PV không phép (quá giờ 30 phút)`,
              message: 'Lịch đã tự hủy để giải phóng slot. Muốn PV lại thì đặt lịch mới cho bạn.',
              linkTab: 'hr-interviews',
              origin: 'ADMIN',
              metadata: { submissionId: m.submissionId },
              targetRoles: ['ADMIN', 'HR'],
              timestamp: new Date().toISOString(),
            });
          } catch { /* non-fatal */ }
        }
      })
      .catch(err => console.warn('[interview-noshow] tick error:', err?.message || err));
  };
  setTimeout(interviewNoShowTickSafe, 60_000);
  setInterval(interviewNoShowTickSafe, 5 * 60_000);

  // Thử lại upload ảnh chấm công lỗi (đang giữ inline): Drive hồi là ảnh hiện
  // lại trên modal/ZIP ngay, không cần NV chụp lại.
  const photoRetryTickSafe = () => {
    services.attendanceService.retryFailedPhotoUploads(20)
      .then(r => {
        if (r && r.recovered > 0) {
          console.log(`[photo-retry] Đã phục hồi ${r.recovered} ảnh chấm công lên Drive.`);
        }
      })
      .catch(err => console.warn('[photo-retry] tick error:', err?.message || err));
  };
  setTimeout(photoRetryTickSafe, 180_000);
  setInterval(photoRetryTickSafe, 5 * 60_000);

  // TỰ ĐỘNG ĐỒNG BỘ HỢP ĐỒNG LAO ĐỘNG LÊN GOOGLE DRIVE (thư mục HOP_DONG_LAO_DONG):
  // Rà soát các hợp đồng đang lưu trên đĩa VPS (storage: 'DISK') hoặc chưa có
  // drive_id và tự động đẩy lên Google Drive, cập nhật ô contract_docs trên Sheets.
  const contractsAutoSyncTickSafe = () => {
    (services.employeesService as any).syncPendingContractsToDrive('SYSTEM')
      .then((r: any) => {
        if (r && r.synced > 0) {
          console.log(`[contracts-sync] Đã tự động đồng bộ ${r.synced} hợp đồng lao động lên Google Drive.`);
          try {
            io.emit('data:updated', { entity: 'employees', data: { action: 'contracts-synced', count: r.synced }, timestamp: new Date().toISOString() });
          } catch { /* non-fatal */ }
        }
      })
      .catch((err: any) => console.warn('[contracts-sync] tick error:', err?.message || err));
  };
  setTimeout(contractsAutoSyncTickSafe, 75_000); // 75s sau boot, sau khi pull Sheets xong
  setInterval(contractsAutoSyncTickSafe, 10 * 60_000); // mỗi 10 phút tự kiểm tra và đồng bộ

  // ĐỒNG BỘ ẢNH CHẤM CÔNG HẰNG NGÀY lên Drive (sau 02:00 VN) — ảnh đã có trên
  // Drive thì xóa bản đệm trên VPS để không đầy đĩa. Idempotent theo ngày.
  const dailyPhotoSyncTick = async () => {
    try {
      const syncSvc = (adapter as any)?.syncService;
      if (!syncSvc?.isDriveReady?.()) return;
      const vnNow = new Date(Date.now() + 7 * 3_600_000);
      const hour = vnNow.getUTCHours();
      if (hour < 2) return; // chờ qua 02:00 VN
      const today = backupVnToday();
      const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      const cur: any = await adapter.getSystemSettings().catch(() => ({})) || {};
      const st = cur.photos_backup || {};
      if (st.last_date === yesterday) return;
      // Bù MỌI ngày bị lỡ kể từ lần đồng bộ trước (VPS tắt / Drive lỗi nhiều
      // ngày), không chỉ "hôm qua" — tránh ảnh cũ dồn đĩa tới kỳ backup tháng.
      const last = /^\d{4}-\d{2}-\d{2}$/.test(String(st.last_date || '')) ? String(st.last_date) : '';
      const fromDate = last ? addDaysIso(last, 1) : yesterday;
      if (!fromDate || fromDate > yesterday) return;
      const r = await syncPhotoBacklog(syncSvc, adapter, { fromDate, toDate: yesterday, maxDays: 31 });
      if (!r.ok) {
        console.warn(`[photo-sync] ${r.from}→${r.to} lỗi: ${r.reason || 'PARTIAL'}`);
        return;
      }
      await adapter.updateSystemSettings({
        ...cur,
        photos_backup: {
          last_date: r.to,
          last_ok_at: new Date().toISOString(),
          last_result: r,
          last_error: null,
        },
      }).catch(() => null);
      if (r.uploaded > 0 || r.localDeleted > 0) {
        console.log(`[photo-sync] ${r.from}→${r.to} (${r.days.length} ngày): ${r.uploaded} ảnh mới, dọn ${r.localDeleted} ảnh đệm, thiếu ${r.missing}.`);
      }
    } catch (err: any) {
      console.warn('[photo-sync] tick error:', err?.message || err);
    }
  };
  setTimeout(dailyPhotoSyncTick, 150_000);
  setInterval(dailyPhotoSyncTick, 60 * 60_000);

  // BACKUP THÁNG: 09:00 ngày 5 hằng tháng lưu THÁNG TRƯỚC lên Drive theo cấu
  // trúc backup_YYYY-MM/<TAB>/<ngày>/...; nếu server downtime thì bù khi chạy lại.
  const monthlyBackupTick = async () => {
    try {
      const syncSvc = (adapter as any)?.syncService;
      if (!syncSvc?.isDriveReady?.()) return;
      const vnNow = new Date(Date.now() + 7 * 3_600_000);
      const day = vnNow.getUTCDate();
      const hour = vnNow.getUTCHours();
      // Chỉ chạy từ 09:00 ngày 5; sang ngày 6+ thì chạy bù bất kể giờ.
      if (!(day > 5 || (day === 5 && hour >= 9))) return;
      const month = backupVnToday().slice(0, 7);
      const target = backupPreviousMonthOf(month);
      if (!target) return;
      const cur: any = await adapter.getSystemSettings().catch(() => ({})) || {};
      const st = cur.monthly_backup || {};
      if (st.last_month === target) return;

      // PostgreSQL là nguồn sự thật: xuất một chiều DB -> Sheets trước khi lưu
      // CSV tháng để bản backup phản ánh đúng dữ liệu hiện tại.
      if (postgresMode) {
        try {
          const ex = await syncSvc.syncAllData(adapter);
          if (!ex?.success) {
            console.warn(`[monthly-backup] Xuất Sheets trước backup lỗi: ${ex?.message || 'UNKNOWN'}`);
          }
        } catch (e: any) {
          console.warn('[monthly-backup] Xuất Sheets trước backup lỗi:', e?.message || e);
        }
      }

      const r = await runMonthlyBackup(syncSvc, adapter, target);
      await adapter.updateSystemSettings({
        ...cur,
        monthly_backup: r.ok ? {
          last_month: target,
          last_ok_at: new Date().toISOString(),
          last_result: r,
          last_error: null,
        } : {
          ...st,
          last_error_at: new Date().toISOString(),
          last_error: r.error || r.reason || 'UNKNOWN',
          last_result: r,
        },
      }).catch(() => null);

      if (r.ok) {
        console.log(`[monthly-backup] ${target}: ${r.tabFiles} file tab, ${r.photosUploaded} ảnh mới, dọn ${r.localDeleted} ảnh đệm.`);
      } else {
        console.warn(`[monthly-backup] ${target} lỗi: ${r.error || r.reason}`);
        void notifySystemAlert({
          code: 'MONTHLY_BACKUP_FAILED',
          severity: 'URGENT',
          title: '🚨 Backup tháng thất bại',
          message: `Backup tháng ${target} lỗi: ${r.error || r.reason}. Kiểm tra Google Drive/quota — hệ thống sẽ thử lại giờ sau.`,
          details: { month: target, result: r },
        });
      }
    } catch (err: any) {
      console.warn('[monthly-backup] tick error:', err?.message || err);
    }
  };
  setTimeout(monthlyBackupTick, 180_000);
  setInterval(monthlyBackupTick, 60 * 60_000);

  // Backup snapshot tự động mỗi 24h + tự verify; fail thì báo ADMIN/HR trong app.
  const autoBackupTick = async () => {
    try {
      const snap = await adapter.createBackupSnapshot(`Auto ${new Date().toISOString().slice(0, 10)}`);
      const check = await adapter.testRecovery(snap.snapshot_id).catch(() => null);
      if (!check?.success) throw new Error('Verify snapshot thất bại');
      console.log(`[auto-backup] Snapshot ${snap.snapshot_id} OK (${snap.size_mb}MB)`);
    } catch (err: any) {
      console.error('[auto-backup] FAILED:', err?.message || err);
      void notifySystemAlert({
        code: 'BACKUP_FAILED',
        severity: 'URGENT',
        title: '🚨 Backup tự động thất bại',
        message: `Snapshot định kỳ lỗi: ${err?.message || err}. Kiểm tra Google Drive/Sheets và dung lượng lưu trữ.`,
        details: { host: process.env.HOSTNAME || 'ubm-server' },
      });
      try {
        const admins = await adapter.listAdminAccounts();
        const ids = admins.filter(a => (a.role === 'ADMIN' || a.role === 'HR') && a.is_active !== false).map(a => a.admin_id);
        if (ids.length > 0) {
          await services.notificationsService.sendNotification({
            recipientIds: ids,
            type: 'BACKUP_FAILED',
            severity: 'URGENT',
            title: '🚨 Backup tự động THẤT BẠI',
            summary: `Snapshot định kỳ lỗi: ${err?.message || err}. Kiểm tra Google Drive/Sheets ngay.`,
            actorId: 'SYSTEM',
          });
        }
      } catch { /* không làm sập scheduler */ }
    }
  };
  setTimeout(autoBackupTick, 5 * 60_000);
  setInterval(autoBackupTick, 24 * 60 * 60_000);
});

// Tắt êm khi Render sleep/deploy (gửi SIGTERM): xả hàng đợi ghi Sheets nền
// trước khi thoát — nếu không, check-in vừa báo "thành công" (mới nằm trong
// bộ nhớ, append đang bay) sẽ mất vĩnh viễn, reload lại báo chưa check-in.
let shuttingDown = false;
const gracefulShutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[${signal}] Đang tắt êm: xả ghi Sheets nền...`);
  (async () => {
    try {
      stopSystemAlerts?.();
    } catch { /* non-fatal */ }
    try {
      backupScheduler?.stop();
    } catch { /* non-fatal */ }
    try {
      await (adapter as any)?.flushSheetsWrites?.(20000);
    } catch { /* cố hết sức */ }
    try {
      await new Promise<void>(resolve => server.close(() => resolve()));
    } catch { /* bỏ qua */ }
    process.exit(0);
  })();
  // Lưới an toàn: quá 25s chưa xong thì thoát luôn (platform sẽ SIGKILL).
  setTimeout(() => process.exit(0), 25000).unref();
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export { server, io };
