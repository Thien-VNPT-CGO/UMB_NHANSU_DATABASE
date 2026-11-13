import { io, Socket } from 'socket.io-client';
import { getSocketBase } from './api';

export type RealtimeStatus = 'connecting' | 'online' | 'offline';

interface Handlers {
  onUpdate: () => void;
  onStatus: (status: RealtimeStatus) => void;
  onAuthError?: () => void;
}

/**
 * Kết nối Socket.IO bằng token của cổng vi phạm.
 * Server phát `data:updated` cho mọi thay đổi; ta chỉ cần tải lại dữ liệu
 * khi entity là violations/payroll để KPI và phiếu đồng bộ tức thời.
 */
export function connectViolationRealtime(token: string, handlers: Handlers): () => void {
  const socket: Socket = io(getSocketBase(), {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1500,
    reconnectionDelayMax: 12000,
    timeout: 15000,
  });

  let stopped = false;
  let authFailed = false;

  handlers.onStatus(socket.connected ? 'online' : 'connecting');

  socket.on('connect', () => {
    if (stopped) return;
    handlers.onStatus('online');
  });

  socket.on('disconnect', () => {
    if (stopped || authFailed) return;
    handlers.onStatus('offline');
  });

  socket.on('connect_error', (error: any) => {
    if (stopped) return;
    const message = String(error?.message || '');
    if (/AUTHENTICATION_ERROR/.test(message)) {
      authFailed = true;
      handlers.onStatus('offline');
      handlers.onAuthError?.();
      return;
    }
    handlers.onStatus('offline');
  });

  socket.on('data:updated', (payload: any) => {
    if (stopped) return;
    const entity = String(payload?.entity || '').toLowerCase();
    if (entity === 'violations' || entity === 'payroll') handlers.onUpdate();
  });

  return () => {
    stopped = true;
    try {
      socket.removeAllListeners();
      socket.disconnect();
    } catch {
      /* bỏ qua */
    }
  };
}
