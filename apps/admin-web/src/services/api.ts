// Backend VPS tự vận hành (Docker + Nginx + SSL) đồng bộ 2 cổng web (admin + nhân viên).
export const DEFAULT_API_BASE = 'https://umbomilk-nhansu-diemdanh.duckdns.org/api';
// Backend Render (PaaS) đã ngừng sử dụng — URL cũ lưu trong máy người dùng tự migrate về mặc định mới.
const isLegacyApiBase = (url: string): boolean => url.includes('.onrender.com');
export function getApiBase(): string {
  if (typeof window === 'undefined') return 'http://localhost:4005';
  const custom = (localStorage.getItem('ubm_custom_api_url') || '').trim().replace(/\/+$/, '');
  if (isLegacyApiBase(custom)) {
    try { localStorage.removeItem('ubm_custom_api_url'); } catch { /* bỏ qua */ }
  } else if (custom) {
    return custom;
  }
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (envUrl) return String(envUrl).trim().replace(/\/+$/, '');
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:4005';
  }
  // Mặc định trỏ backend VPS đang sống (đồng bộ admin + employee).
  return DEFAULT_API_BASE;
}

export function setCustomApiUrl(url: string) {
  if (!url) {
    localStorage.removeItem('ubm_custom_api_url');
  } else {
    localStorage.setItem('ubm_custom_api_url', url.trim().replace(/\/+$/, ''));
  }
}

let authToken = localStorage.getItem('ubm_admin_token') || '';

function stripInternalOpts(options: RequestInit): RequestInit {
  const { _timeoutMs, _wakeRounds, _refreshed, _noCache, ...rest }: any = options || {};
  return rest as RequestInit;
}

function fetchWithTimeout(url: string, options: RequestInit = {}, ms = 45000): Promise<Response> {
  const method = String(options.method || 'GET').toUpperCase();
  const defaultMs = (method === 'POST' || method === 'PUT' || method === 'DELETE') ? 60000 : ms;
  const timeoutMs = Number((options as any)?._timeoutMs) || defaultMs;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...stripInternalOpts(options), signal: ctrl.signal }).finally(() => clearTimeout(t));
}

// Server có thể vừa khởi động lại (VD nhánh vps restart backend): fetch đầu tiên
// có thể mất vài chục giây mới 200. Tự gọi /ping + chờ + thử lại tối đa 5 vòng
// (~40s) trước khi lên lớp — chết đớ với cửa sổ restart dài, nhờ watchdog VPS
// backend nhìn chung tự phục hồi trong 3-4 phút.
async function wakeBackend(base: string): Promise<boolean> {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetchWithTimeout(`${base}/ping`, {}, 20000);
      if (r.ok) return true;
    } catch { /* thử tiếp */ }
    await new Promise(r => setTimeout(r, [2000, 5000, 10000, 10000, 10000][i] || 5000));
  }
  return false;
}

function isNetworkFailure(err: any): boolean {
  const msg = String(err?.message || err?.name || '').toLowerCase();
  return msg.includes('failed to fetch') || msg.includes('load failed') || msg.includes('networkerror')
    || msg.includes('network request failed') || msg === 'load failed'
    || msg.includes('abort') || msg.includes('timeout') || msg === 'aborted';
}

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
// Export để Socket.IO nối lại được với token mới thay vì văng người dùng khi
// access token hết hạn giữa phiên (xem App.tsx socket connect_error).
export async function tryRefreshSession(): Promise<'ok' | 'none' | 'expired' | 'revoked'> {
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
    const res = await fetchWithTimeout(url, {
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

    // 401 hết hạn token -> thử gia hạn 1 lần rồi gọi lại (trừ API login và chính API refresh).
    const isLoginEndpoint = endpoint.startsWith('/auth/admin/login') || endpoint.startsWith('/auth/login') || endpoint.startsWith('/auth/employee/login');
    let refreshWhy: string | null = null;
    if (res.status === 401 && !alreadyRefreshed && !isLoginEndpoint && endpoint !== '/auth/refresh' && retries > 0) {
      const r = await tryRefreshSession();
      if (r === 'ok') {
        return apiRequest<T>(endpoint, { ...options, _refreshed: true } as any, retries - 1);
      }
      refreshWhy = r;
    }

    const data = await res.json().catch(() => ({}));

    // Backend vừa restart đang tải dữ liệu (503 SHEETS_LOADING): KHÔNG xóa phiên —
    // tự thử lại vài lần, giữ đăng nhập của Admin/HR sau mỗi lần deploy.
    if (res.status === 503 && ((data as any)?.code === 'SHEETS_LOADING' || (data as any)?.error === 'SHEETS_LOADING')) {
      if (retries > 0) {
        await new Promise(r => setTimeout(r, 4000));
        return apiRequest<T>(endpoint, options, retries - 1);
      }
      const err: any = new Error('Hệ thống đang khởi động/tải dữ liệu — thử lại sau ít giây (F5 nếu kéo dài).');
      err.code = 'SHEETS_LOADING';
      throw err;
    }

    // 502/503/504: nginx báo backend chưa sẵn sàng (đang deploy/khởi động lại).
    // GET thì tự thử lại vài lần, KHÔNG xóa phiên đăng nhập của người dùng.
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      const method = String(options.method || 'GET').toUpperCase();
      if (method === 'GET' && retries > 0) {
        await new Promise(r => setTimeout(r, 4000));
        return apiRequest<T>(endpoint, options, retries - 1);
      }
      const err: any = new Error(`Máy chủ đang khởi động lại hoặc quá tải (${res.status}). Vui lòng thử lại sau ít giây.`);
      err.code = `HTTP_${res.status}`;
      throw err;
    }

    if (!res.ok) {
      if (res.status === 401 && !isLoginEndpoint) {
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
    // Lỗi mạng/timeout:
    // - GET: tự đánh thức backend rồi thử lại tối đa 2 vòng (server vừa restart).
    // - GHI (POST/PUT/DELETE): KHÔNG tự gửi lại — server có thể đã xử lý nhưng
    //   phản hồi bị mất, gửi lại gây trùng (đắc biệt /payroll/rates/adjust/commit
    //   sẽ ghi thêm 1 lượt lịch sử đơn giá). Báo rõ để người dùng kiểm tra rồi bấm lại.
    const method = String(options.method || 'GET').toUpperCase();
    const isWrite = method !== 'GET' && method !== 'HEAD';
    if (isWrite) {
      if (isNetworkFailure(err)) {
        const timeoutErr = String(err?.name || err?.message || '').toLowerCase().includes('abort');
        throw new Error(timeoutErr
          ? `Máy chủ xử lý lâu khi gửi (${endpoint}) — thao tác có thể ĐÃ được ghi. Vui lòng tải lại trang để kiểm tra kết quả trước khi bấm lại (hệ thống không tự gửi trùng).`
          : `Không gửi được lên máy chủ (${endpoint}) — kiểm tra mạng rồi thử lại. Dữ liệu bạn vừa nhập vẫn còn trên form.`);
      }
      throw err;
    }
    const wokenRounds = (options as any)._wakeRounds ?? 0;
    if (isNetworkFailure(err) && wokenRounds < 2 && endpoint !== '/ping' && endpoint !== '/version') {
      const round = wokenRounds + 1;
      console.warn(`[API] Mất kết nối ${endpoint} — đang đánh thức backend (vòng ${round}/2)...`);
      if (await wakeBackend(base)) {
        return apiRequest<T>(endpoint, { ...options, _wakeRounds: round } as any, retries);
      }
      if (round < 2) {
        // Vòng wake không thấy server sống — thử tiếp 1 lần nữa rồi mới báo lỗi
        return apiRequest<T>(endpoint, { ...options, _wakeRounds: round } as any, retries);
      }
    }
    if (isNetworkFailure(err)) {
      throw new Error(`Không thể kết nối đến máy chủ Backend (${base}) sau khi đã thử lại 2 vòng (~80s). Backend có thể đang khởi động lại — trên VPS đã có watchdog tự khắc phục trong 3-4 phút; HÃY THỬ LẠI SAU 2 PHÚT (F5). Mẹo kiểm nhanh: mở ${base}/ping bằng trình duyệt xem có hiện {"status":"ok"} không (hoặc mở Cấu hình máy chủ API để xem địa chỉ).`);
    }
    throw err;
  }
}
