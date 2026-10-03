import { io, Socket } from 'socket.io-client';

export interface RealtimeGuards {
  onConnect?: () => void;
  onDisconnect?: () => void;
  /** Lỗi xác thực (token hết hạn/bị thu hồi) — không tính vào số lần lỗi kết nối. */
  onAuthError?: (msg: string) => void;
  /** Quá nhiều lỗi liên tiếp: đã tự ngắt để khỏi spam console + tốn pin. */
  onGiveUp?: (attempts: number) => void;
  maxAttempts?: number;
}

/**
 * Tạo Socket.IO realtime có bảo vệ:
 * - Backoff reconnect 2s -> 15s, timeout handshake 15s.
 * - Sai địa chỉ máy chủ (frontend tĩnh Vercel...), server ngủ/không tới được,
 *   websocket bị chặn: thử lại `maxAttempts` lần (mặc định 8) rồi TỰ NGẮT để
 *   khỏi spam lỗi "WebSocket is closed before the connection is established"
 *   vô hạn. Đăng nhập lại / đổi máy chủ sẽ nối lại từ đầu.
 * - Lỗi xác thực KHÔNG tính vào số lần (xử lý riêng qua onAuthError).
 */
export function connectRealtime(base: string, token: string, guards: RealtimeGuards = {}): Socket {
  const socket: Socket = io(base, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 15000,
    timeout: 15000,
  });
  const maxAttempts = guards.maxAttempts ?? 8;
  let fails = 0;
  let gaveUp = false;
  socket.on('connect', () => {
    fails = 0;
    gaveUp = false;
    guards.onConnect?.();
  });
  socket.on('disconnect', () => {
    guards.onDisconnect?.();
  });
  socket.on('connect_error', (err: any) => {
    const msg = String((err as any)?.message || '');
    if (/AUTHENTICATION_ERROR/.test(msg)) {
      guards.onAuthError?.(msg);
      return;
    }
    fails += 1;
    if (fails >= maxAttempts && !gaveUp) {
      gaveUp = true;
      try {
        socket.disconnect();
      } catch {
        /* bỏ qua */
      }
      guards.onGiveUp?.(fails);
    }
  });
  return socket;
}
