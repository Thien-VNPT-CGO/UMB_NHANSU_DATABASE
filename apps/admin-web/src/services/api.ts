export const API_BASE = 'http://localhost:4005';

let authToken = localStorage.getItem('ubm_admin_token') || '';

export function setAuthToken(token: string) {
  authToken = token;
  if (token) {
    localStorage.setItem('ubm_admin_token', token);
  } else {
    localStorage.removeItem('ubm_admin_token');
  }
}

export function getAuthToken(): string {
  return authToken;
}

export async function apiRequest<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const url = `${API_BASE}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed with status ${res.status}`);
  }

  return data;
}
