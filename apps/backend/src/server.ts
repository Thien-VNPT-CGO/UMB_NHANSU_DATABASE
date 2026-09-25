import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { AuthService } from './services/auth.service.js';
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
  console.log(`====================================================`);
});

export { server, io };
