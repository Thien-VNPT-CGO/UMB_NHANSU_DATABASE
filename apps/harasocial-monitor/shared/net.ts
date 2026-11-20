/** Kiểm tra URL an toàn (chống SSRF) — logic thuần, không truy vấn DNS. */

export interface SafeUrlOptions {
  requireHttps?: boolean;
  allowLocalhost?: boolean;
}

export function isPrivateIpv4(ip: string): boolean {
  const parts = String(ip).trim().split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true; // multicast + reserved
  return false;
}

export function isPrivateIpv6(raw: string): boolean {
  const ip = String(raw).trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (!ip.includes(':')) return false;
  if (ip === '::' || ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;
  if (ip.startsWith('::ffff:')) {
    const v4 = ip.slice('::ffff:'.length);
    if (v4.includes('.')) return isPrivateIpv4(v4);
    // ::ffff:7f00:1 => 127.0.0.1
    const hex = v4.split(':');
    if (hex.length === 2) {
      const hi = parseInt(hex[0], 16);
      const lo = parseInt(hex[1], 16);
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        return isPrivateIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
      }
    }
    return true;
  }
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true; // fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(ip)) return true; // fe80::/10
  if (ip.startsWith('ff')) return true; // multicast
  return false;
}

/** Host nội bộ / metadata cloud / localhost. */
export function isPrivateHostname(hostname: string): boolean {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home')) return true;
  if (host === 'metadata.google.internal') return true;
  if (/^\d+$/.test(host)) return true; // số nguyên thuần (dạng thập phân của IPv4)
  if (/^0x[0-9a-f]+$/i.test(host)) return true;
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) return true;
  return false;
}

/**
 * Chỉ cho phép URL HTTPS công khai. Ném lỗi với thông báo tiếng Việt
 * để hiển thị trực tiếp trên UI cấu hình cổng.
 */
export function assertSafeHttpUrl(raw: string, options: SafeUrlOptions = {}): URL {
  const requireHttps = options.requireHttps !== false;
  const allowLocalhost = options.allowLocalhost === true;
  let url: URL;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    throw new Error('URL không hợp lệ.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Chỉ chấp nhận URL http/https.');
  }
  if (requireHttps && url.protocol !== 'https:') {
    throw new Error('Bắt buộc dùng HTTPS để bảo vệ token API.');
  }
  if (url.username || url.password) {
    throw new Error('URL không được chứa thông tin đăng nhập.');
  }
  const host = url.hostname.toLowerCase();
  if (!allowLocalhost && isPrivateHostname(host)) {
    throw new Error('URL trỏ vào địa chỉ nội bộ/không công khai (chặn SSRF).');
  }
  return url;
}

export function isPrivateAddress(address: string): boolean {
  return isPrivateIpv4(address) || isPrivateIpv6(address);
}
