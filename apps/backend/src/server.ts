import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { AuthService } from './services/auth.service.js';
import { weeklyOffScheduler } from './services/weekly-off.service.js';
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
  // Định kỳ tự động quét và kéo dữ liệu mới từ Google Sheets mỗi 15 giây
  const syncIntervalMs = Number(process.env.SHEETS_SYNC_INTERVAL_MS) || 15_000;
  setInterval(autoPullSheetsTick, syncIntervalMs);
});

export { server, io };
