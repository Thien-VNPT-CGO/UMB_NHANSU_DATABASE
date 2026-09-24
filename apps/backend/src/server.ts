import http from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { createApp } from './app.js';
import { JWT_SECRET } from './services/auth.service.js';

const PORT = process.env.PORT || 4005;

const { app, services, adapter } = createApp();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Pass io to services
services.accountsService.setSocketServer(io);
services.schedulesService.setSocketServer(io);
services.attendanceService.setSocketServer(io);
services.payrollService.setSocketServer(io);
services.notificationsService.setSocketServer(io);

// Socket.IO authentication and room management
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token || typeof token !== 'string') {
    return next(new Error('AUTHENTICATION_ERROR: Missing token'));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    (socket as any).user = decoded;
    next();
  } catch (err) {
    next(new Error('AUTHENTICATION_ERROR: Invalid token'));
  }
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

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`ỤM BÒ MILK HR SYSTEM V5.1 - BACKEND SERVER STARTED`);
  console.log(`Port: ${PORT}`);
  console.log(`Google Sheets Mode: ${adapter.getStatus().mode}`);
  console.log(`Realtime Socket.IO: Ready`);
  console.log(`====================================================`);
});

export { server, io };
