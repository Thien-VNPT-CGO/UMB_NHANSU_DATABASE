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

// Tự gia hạn access token bằng refresh token khi gặp 401 (cùng lỗi cổng NV từng gặp).
async function tryRefreshSession(): Promise<'ok' | 'none' | 'expired' | 'revoked'> {
  try {
    const rt = localStorage.getItem('ubm_admin_refresh') || '';
    if (!rt) return 'none';
    const base = getApiBase();
    const res = await fetch(`${base}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !(data as any)?.token) {
      const msg = String((data as any)?.error || '');
      if (/REVOKED|LOCKED/i.test(msg)) return 'revoked';
      return 'expired';
    }
    setAuthToken((data as any).token);
    return 'ok';
  } catch {
    return 'expired';
  }
}

function clearSession() {
  setAuthToken('');
  try { localStorage.removeItem('ubm_admin_refresh'); } catch {}
}

export async function apiRequest<T = any>(endpoint: string, options: RequestInit = {}, retries = 2): Promise<T> {
  const base = getApiBase();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const url = `${base}${endpoint}`;
  const alreadyRefreshed = (options as any)._refreshed === true;
  try {
    const res = await fetch(url, {
      ...options,
      headers,
    });

    // Tự động retry thông minh nếu gặp 429 (Too Many Requests)
    if (res.status === 429 && retries > 0) {
      const retryAfterHeader = res.headers.get('Retry-After');
      const waitMs = retryAfterHeader ? Math.min(Number(retryAfterHeader) * 1000, 3000) : 1000;
      console.warn(`[API] 429 Too Many Requests tại ${endpoint}. Tự động thử lại sau ${waitMs}ms...`);
      await new Promise(r => setTimeout(r, waitMs));
      return apiRequest<T>(endpoint, options, retries - 1);
    }

    // 401 hết hạn token -> thử gia hạn 1 lần rồi gọi lại (trừ chính API refresh).
    let refreshWhy: string | null = null;
    if (res.status === 401 && !alreadyRefreshed && endpoint !== '/auth/refresh' && retries > 0) {
      const r = await tryRefreshSession();
      if (r === 'ok') {
        return apiRequest<T>(endpoint, { ...options, _refreshed: true } as any, retries - 1);
      }
      refreshWhy = r;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) {
        clearSession();
        const msg = refreshWhy === 'revoked'
          ? 'Tài khoản có thay đổi (đổi mật khẩu, phân quyền hoặc bị khóa), vui lòng đăng nhập lại!'
          : refreshWhy === 'none'
            ? 'Phiên đăng nhập cũ không có mã gia hạn, vui lòng đăng nhập lại một lần!'
            : 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!';
        const err: any = new Error(msg);
        err.code = 'SESSION_EXPIRED';
        throw err;
      }
      const detailText = Array.isArray((data as any)?.details)
        ? ` — ${(data as any)?.details.map((d: any) => `${d.path || 'field'}: ${d.message}`).join('; ')}`
        : '';
      // Ưu tiên message tiếng Việt của server (VD: thiếu quyền role nào) thay vì
      // mã lỗi khô (VD: FORBIDDEN) để HR/Kế toán đọc là hiểu ngay.
      const serverMsg = String((data as any)?.message || '').trim();
      const err: any = new Error(`${serverMsg || data.error || `Lỗi máy chủ (${res.status})`}${detailText}`);
      err.code = data.error;
      err.details = (data as any)?.details;
      throw err;
    }

    return data;
  } catch (err: any) {
    const msg = String(err?.message || '').toLowerCase();
    // Safari iOS báo "Load failed", Chrome "Failed to fetch", Firefox "NetworkError".
    if (msg.includes('failed to fetch') || msg.includes('load failed') || msg.includes('networkerror') || msg.includes('network request failed') || msg === 'load failed') {
      throw new Error(`Không thể kết nối đến máy chủ Backend (${base}). Kiểm tra: 1) Backend đã chạy chưa, 2) Địa chỉ API đúng chưa (mở Cấu hình máy chủ API để xem), 3) Nếu dùng Render miễn phí đang Sleep thì đợi 20-30 giây rồi thử lại.`);
    }
    throw err;
  }
}
