export function getApiBase(): string {
  if (typeof window === 'undefined') return 'http://localhost:4005';
  const custom = localStorage.getItem('ubm_custom_api_url');
  if (custom) return custom.trim().replace(/\/+$/, '');
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (envUrl) return envUrl.trim().replace(/\/+$/, '');
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:4005';
  }
  return window.location.origin;
}

export function setCustomApiUrl(url: string) {
  if (!url) {
    localStorage.removeItem('ubm_custom_api_url');
  } else {
    localStorage.setItem('ubm_custom_api_url', url.trim().replace(/\/+$/, ''));
  }
}

export const API_BASE = getApiBase();

let authToken = localStorage.getItem('ubm_emp_token') || '';

export function setAuthToken(token: string) {
  authToken = token;
  if (token) {
    localStorage.setItem('ubm_emp_token', token);
  } else {
    localStorage.removeItem('ubm_emp_token');
  }
}

export function getAuthToken(): string {
  return authToken;
}

export async function apiRequest<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const base = getApiBase();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const url = `${base}${endpoint}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || data.message || `Lỗi ${res.status}`);
    }

    return data;
  } catch (err: any) {
    if (err.message && err.message.toLowerCase().includes('failed to fetch')) {
      throw new Error(`Không thể kết nối đến máy chủ Backend (${base}). Nếu máy chủ Render miễn phí đang khởi động (Sleep mode), vui lòng đợi 20-30 giây rồi thử lại.`);
    }
    throw err;
  }
}
