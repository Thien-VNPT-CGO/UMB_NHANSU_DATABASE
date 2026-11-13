import type {
  AuthResult,
  CreateTicketInput,
  Regulation,
  ViolationAccount,
  ViolationEmployee,
  ViolationOverview,
  ViolationTicket,
} from '../types';

const TOKEN_KEY = 'ubm_violation_token';

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 0, code = 'REQUEST_FAILED') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Cổng vi phạm được phục vụ cùng origin với backend qua /api (Nginx strip prefix). */
export function getApiBase(): string {
  const env = String((import.meta as any).env?.VITE_VIOLATION_API_URL || '').trim();
  if (env) return env.replace(/\/+$/, '');
  return '/api';
}

export function getSocketBase(): string {
  const env = String((import.meta as any).env?.VITE_VIOLATION_SOCKET_URL || '').trim();
  if (env) return env.replace(/\/+$/, '');
  if (typeof window === 'undefined') return 'http://localhost:4005';
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:4005';
  return window.location.origin;
}

let token = '';
try {
  token = localStorage.getItem(TOKEN_KEY) || '';
} catch {
  token = '';
}

export function getToken(): string {
  return token;
}

export function setToken(next: string | null) {
  token = String(next || '');
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* bỏ qua */
  }
}

function authEvent(type: 'unauthorized' | 'pin-required') {
  try {
    window.dispatchEvent(new CustomEvent('violation:auth', { detail: { type } }));
  } catch {
    /* bỏ qua */
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const base = getApiBase();
  // Khi chạy trực tiếp backend (không qua Nginx), route API nằm ở gốc chứ
  // không phải /api. Thử /api trước, nếu trả HTML 404 thì gọi lại đường dẫn gốc.
  const urls = base === '/api' ? [`/api${path}`, path] : [`${base}${path}`];

  let response: Response | null = null;
  try {
    for (const url of urls) {
      response = await fetch(url, { ...init, headers });
      if (urls.length > 1 && response.status === 404) {
        const type = String(response.headers.get('content-type') || '');
        if (!type.includes('application/json')) continue;
      }
      break;
    }
  } catch {
    throw new ApiError('Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.', 0, 'NETWORK_ERROR');
  }
  if (!response) {
    throw new ApiError('Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.', 0, 'NETWORK_ERROR');
  }

  const raw = await response.text();
  let payload: any = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const code = String(payload?.error || payload?.code || `HTTP_${response.status}`);
    const message = String(payload?.message || 'Yêu cầu không thành công.');
    if (response.status === 401 && code !== 'INVALID_PIN') authEvent('unauthorized');
    if (response.status === 403 && code === 'PIN_CHANGE_REQUIRED') authEvent('pin-required');
    throw new ApiError(message, response.status, code);
  }

  return payload as T;
}

// ---------------------------------------------------------------- auth
export function login(pin: string) {
  return request<AuthResult>('/violations/auth/login', {
    method: 'POST',
    body: JSON.stringify({ pin }),
  });
}

export function fetchMe() {
  return request<ViolationAccount>('/violations/me');
}

export function changePin(oldPin: string, newPin: string) {
  return request<AuthResult>('/violations/auth/change-pin', {
    method: 'POST',
    body: JSON.stringify({ old_pin: oldPin, new_pin: newPin }),
  });
}

export function resetPin() {
  return request<{ ok: boolean; message: string }>('/violations/auth/reset-pin', { method: 'POST' });
}

// ---------------------------------------------------------------- regulations
export function fetchRegulations() {
  return request<Regulation[]>('/violations/regulations');
}

export function saveRegulation(input: Partial<Regulation>) {
  return request<Regulation>('/violations/regulations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function removeRegulation(id: string) {
  return request<{ ok: boolean }>(`/violations/regulations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------- employees / tickets
export function fetchEmployees() {
  return request<ViolationEmployee[]>('/violations/employees');
}

export function fetchTickets(status?: 'PENDING' | 'APPROVED') {
  const query = status ? `?status=${status}` : '';
  return request<ViolationTicket[]>(`/violations/tickets${query}`);
}

export function createTicket(input: CreateTicketInput) {
  return request<ViolationTicket>('/violations/tickets', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function approveTicket(id: string) {
  return request<ViolationTicket>(`/violations/tickets/${encodeURIComponent(id)}/approve`, { method: 'POST' });
}

export function deleteTicket(id: string) {
  return request<{ ok: boolean }>(`/violations/tickets/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function syncTicketDrive(id: string) {
  return request<ViolationTicket>(`/violations/tickets/${encodeURIComponent(id)}/sync-drive`, { method: 'POST' });
}

export function fetchOverview() {
  return request<ViolationOverview>('/violations/overview');
}
