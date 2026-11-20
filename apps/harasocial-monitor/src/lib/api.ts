import type {
  ChannelConfig,
  HarasocialConversation,
  HrConfig,
  NotificationLog,
  SalesStaff,
  WorkspaceConfig,
  ZaloConfig,
} from '../../shared/types';

const rawBase = (import.meta.env.VITE_API_BASE as string | undefined) || '';
export const API_BASE = rawBase.replace(/\/+$/, '');

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

let tokenGetter: (() => Promise<string | null>) | null = null;

export function setTokenGetter(fn: (() => Promise<string | null>) | null): void {
  tokenGetter = fn;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = tokenGetter ? await tokenGetter() : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(await authHeaders()) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Không kết nối được máy chủ. Kiểm tra mạng hoặc địa chỉ API.');
  }
  const text = await response.text();
  let json: any = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      json?.code || 'HTTP_ERROR',
      json?.error || `Máy chủ trả lỗi HTTP ${response.status}.`,
      json?.details
    );
  }
  return (json ?? {}) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/* --------------------------------------------------------------- payloads */

export interface PublicConfig {
  app: string;
  version: string;
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId?: string;
    appId: string;
    messagingSenderId?: string;
  } | null;
  firebaseAdminReady: boolean;
  authError: string | null;
  devAuthEnabled: boolean;
  databaseConfigured: boolean;
  serverNow: string;
  googleClientId: string | null;
  auth: { firebase: boolean; google: boolean; accessCode: boolean; dev: boolean };
}

export interface BootstrapPayload {
  user: { uid: string; email: string; displayName: string };
  workspace: WorkspaceConfig;
  staff: SalesStaff[];
  conversations: HarasocialConversation[];
  logs: NotificationLog[];
  serverNow: string;
  baseUrl: string;
  links: { harasocialWebhook: string; hrWebhook: string };
  worker: { enabled: boolean; lastRunAt: string | null; intervalSeconds: number };
}

export interface ZaloGroup {
  id: string;
  name: string;
  avatar?: string;
  memberCount?: number;
}

export interface ZaloMember {
  uid: string;
  name: string;
  avatar: string;
}

export interface PersonalStatus {
  connected: boolean;
  hasSavedSession: boolean;
  account: { uid: string; displayName: string; avatar: string } | null;
  login: {
    loginId: string;
    phase: 'idle' | 'qr_waiting' | 'scanned' | 'connected' | 'expired' | 'failed';
    qrImage: string | null;
    scannedBy?: { avatar: string; display_name: string };
    account?: { displayName: string; avatar: string; ownId: string };
    error?: string;
    startedAt: string;
  } | null;
  restoring: boolean;
  restoreFailCount: number;
  lastError: string | null;
}

export interface DeliveryResult {
  groupId: string;
  groupName: string;
  provider: string;
  mode: 'live_api' | 'sandbox_log';
  success: boolean;
  detail: string;
}

export interface HrSummary {
  received: number;
  matched: number;
  created: number;
  unmatched: Array<{ name?: string; email?: string; externalHrId?: string }>;
  applied: number;
}

export interface SlaRunResult {
  scanned: number;
  due: number;
  alerted: number;
  failures: number;
  skipped: number;
  details: Array<{
    conversationId: string;
    customerName: string;
    channelId: string;
    alertCount: number;
    targets: string[];
    groups: number;
    success: boolean;
    errors: string[];
  }>;
}

export interface ChannelPullResult {
  channelId: string;
  channelName: string;
  ok: boolean;
  conversations: number;
  created: number;
  skipped: number;
  error?: string;
}

/* ------------------------------------------------------------------ calls */

export const endpoints = {
  publicConfig: () => api.get<PublicConfig>('/api/public-config'),
  devLogin: () => api.post<{ token: string; user: { uid: string; email: string; displayName: string } }>('/api/auth/dev'),
  accessLogin: (code: string) =>
    api.post<{ token: string; user: { uid: string; email: string; displayName: string } }>('/api/auth/access', { code }),
  googleLogin: (credential: string) =>
    api.post<{ token: string; user: { uid: string; email: string; displayName: string } }>('/api/auth/google', { credential }),
  bootstrap: () => api.get<BootstrapPayload>('/api/bootstrap'),

  updateWorkspace: (body: {
    zalo?: Partial<ZaloConfig>;
    channels?: ChannelConfig[];
    hr?: Partial<HrConfig>;
    harasocialWebhookSecret?: string;
    slaThresholdMinutes?: number;
    repeatAlertIntervalMinutes?: number;
    cloudWorkerEnabled?: boolean;
  }) => api.patch<{ workspace: WorkspaceConfig }>('/api/workspace', body),

  rotateSecret: (field: 'harasocial' | 'hr') =>
    api.post<{ field: string; secret: string }>('/api/workspace/secret', { field }),

  createStaff: (body: Partial<SalesStaff> & { name: string }) => api.post<{ staff: SalesStaff }>('/api/staff', body),
  updateStaff: (id: string, body: Partial<SalesStaff>) => api.patch<{ staff: SalesStaff }>(`/api/staff/${id}`, body),
  deleteStaff: (id: string) => api.del<{ ok: boolean }>(`/api/staff/${id}`),

  reply: (id: string) => api.post<{ conversation: HarasocialConversation }>('/api/conversations/reply', { id }),
  alertNow: (id: string) =>
    api.post<{ ok: boolean; detail: SlaRunResult['details'][number]; result: SlaRunResult }>('/api/conversations/alert', { id }),
  setStatus: (id: string, status: HarasocialConversation['status']) =>
    api.post<{ conversation: HarasocialConversation }>('/api/conversations/status', { id, status }),
  clearData: () => api.post<{ ok: boolean; conversations: number; logs: number }>('/api/conversations/clear'),

  syncHarasocial: () => api.post<{ ok: boolean; channels: ChannelPullResult[]; total: number }>('/api/sync/harasocial'),
  runSla: () => api.post<SlaRunResult>('/api/sla/run'),
  pullHr: () => api.post<{ ok: boolean; summary?: HrSummary }>('/api/hr/pull'),
  logs: (limit = 200) => api.get<{ logs: NotificationLog[] }>(`/api/logs?limit=${limit}`),

  testChannel: (channelId: string, groupId?: string) =>
    api.post<DeliveryResult>('/api/channels/test', { channelId, groupId }),

  personalStatus: () => api.get<PersonalStatus>('/api/zalo/personal/status'),
  startQr: () => api.post<{ loginId: string }>('/api/zalo/personal/qr'),
  qrStatus: (loginId: string) => api.get<PersonalStatus['login']>(`/api/zalo/personal/qr/${encodeURIComponent(loginId)}`),
  cancelQr: (loginId: string) => api.del<{ ok: boolean }>(`/api/zalo/personal/qr/${encodeURIComponent(loginId)}`),
  cookieLogin: (body: { cookie: string; imei: string; userAgent: string }) =>
    api.post<{ ok: boolean; account: { displayName: string; uid: string; avatar: string } }>('/api/zalo/personal/cookie', body),
  disconnect: () => api.post<{ ok: boolean }>('/api/zalo/personal/disconnect'),
  groups: () => api.get<{ groups: ZaloGroup[] }>('/api/zalo/groups'),
  members: (groupId: string) => api.get<{ members: ZaloMember[] }>(`/api/zalo/groups/${encodeURIComponent(groupId)}/members`),
};

/* -------------------------------------------------------------- SSE feed */

export interface StreamHandlers {
  onEvent: (event: string, data: any) => void;
  onStatus?: (connected: boolean) => void;
}

function parseEventChunk(chunk: string, onEvent: StreamHandlers['onEvent']): void {
  let event = 'message';
  const dataLines: string[] = [];
  for (const rawLine of chunk.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return;
  const raw = dataLines.join('\n');
  let data: unknown = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    // giữ nguyên chuỗi
  }
  onEvent(event, data);
}

/** Mở SSE bằng fetch + ReadableStream (gửi được header Authorization). */
export function openEventStream(handlers: StreamHandlers): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let retryMs = 1000;

  const connect = async () => {
    if (stopped) return;
    controller = new AbortController();
    try {
      const headers: Record<string, string> = { Accept: 'text/event-stream', ...(await authHeaders()) };
      const response = await fetch(apiUrl('/api/stream'), {
        headers,
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok || !response.body) throw new Error(`SSE HTTP ${response.status}`);
      handlers.onStatus?.(true);
      retryMs = 1000;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf('\n\n');
        while (index >= 0) {
          parseEventChunk(buffer.slice(0, index), handlers.onEvent);
          buffer = buffer.slice(index + 2);
          index = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // mất kết nối → tự thử lại
    } finally {
      handlers.onStatus?.(false);
      if (!stopped) {
        const wait = retryMs;
        retryMs = Math.min(retryMs * 2, 15_000);
        window.setTimeout(() => void connect(), wait);
      }
    }
  };

  void connect();
  return () => {
    stopped = true;
    controller?.abort();
  };
}
