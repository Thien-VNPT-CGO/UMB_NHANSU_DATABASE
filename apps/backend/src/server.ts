import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { AuthService } from './services/auth.service.js';
import { weeklyOffScheduler } from './services/weekly-off.service.js';
import { pinRotationTick } from './services/pin-rotation.service.js';
import { autoRemindersTick } from './services/auto-reminders.service.js';
import { buildSocketCorsOptions, getAllowedOrigins } from './config/security.js';

const PORT = process.env.PORT || 4005;

const { app, services, adapter } = createApp();
const server = http.createServer(app);

const io = new Server(server, {
  cors: buildSocketCorsOptions(),
});

// Attach io to express app for route broadcasting
app.set('io', io);

// Pass io to services
services.accountsService.setSocketServer(io);
services.schedulesService.setSocketServer(io);
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
  console.log(`Google Sheets Mode: ${adapter.getStatus().mode}`);
  console.log(`Realtime Socket.IO: Ready`);
  console.log(`Weekly-OFF gate: Fri 12:00 -> Sat 15:00 (VN) + reminder 5 min before`);
  console.log(`====================================================`);

  // Scheduler nhắc mở cổng đăng ký OFF tuần (mỗi 60s + ngay khi boot).
  const weeklyOffTick = () => {
    weeklyOffScheduler
      .tick(adapter, services.notificationsService)
      .catch(err => console.warn('[weekly-off] tick failed:', err?.message || err));
  };
  weeklyOffTick();
  setInterval(weeklyOffTick, 60_000);

  // Background Auto-Sync Worker: Tự động kéo toàn bộ dữ liệu từ Google Sheets mỗi 15 giây
  // và phát tín hiệu realtime qua Socket.IO tới toàn bộ ứng dụng web khi có dữ liệu thay đổi.
  let lastSyncSignature = '';
  const autoPullSheetsTick = async () => {
    try {
      const syncService = (adapter as any).syncService;
      if (syncService && syncService.getStatus().isConfigured) {
        const pullRes = await syncService.pullAllDataFromGoogleSheets(adapter);
        if (pullRes && pullRes.success && pullRes.counts) {
          const currentSignature = JSON.stringify(pullRes.counts);
          if (lastSyncSignature && lastSyncSignature !== currentSignature) {
            console.log('🔄 [Sheets Auto-Sync] Dữ liệu Google Sheets có thay đổi, đã tự động nạp lên hệ thống:', pullRes.counts);
            io.emit('data:updated', { entity: 'all', data: pullRes.counts, timestamp: new Date().toISOString() });
          }
          lastSyncSignature = currentSignature;
        }
      }
    } catch (err: any) {
      console.warn('[sheets-auto-pull] tick error:', err?.message || err);
    }
  };

  // Kéo dữ liệu tự động ngay sau khi khởi động 2 giây
  setTimeout(autoPullSheetsTick, 2000);
  // Định kỳ tự động quét và kéo dữ liệu mới từ Google Sheets mỗi 10 giây
  const syncIntervalMs = Number(process.env.SHEETS_SYNC_INTERVAL_MS) || 10_000;
  setInterval(autoPullSheetsTick, syncIntervalMs);

  // Nhắc việc tự động mỗi 5 phút: check-in Zalo trước ca, PIN quá hạn, đơn tồn duyệt.
  const autoRemindersTickSafe = () => {
    autoRemindersTick(adapter, services.notificationsService, services.zaloService).catch(err =>
      console.warn('[auto-reminders] tick error:', err?.message || err)
    );
  };
  setTimeout(autoRemindersTickSafe, 60_000); // đợi dữ liệu load xong lần đầu
  setInterval(autoRemindersTickSafe, 5 * 60_000);

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

  // Backup snapshot tự động mỗi 24h + tự verify; fail thì báo ADMIN/HR trong app.
  const autoBackupTick = async () => {
    try {
      const snap = await adapter.createBackupSnapshot(`Auto ${new Date().toISOString().slice(0, 10)}`);
      const check = await adapter.testRecovery(snap.snapshot_id).catch(() => null);
      if (!check?.success) throw new Error('Verify snapshot thất bại');
      console.log(`[auto-backup] Snapshot ${snap.snapshot_id} OK (${snap.size_mb}MB)`);
    } catch (err: any) {
      console.error('[auto-backup] FAILED:', err?.message || err);
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

export { server, io };
