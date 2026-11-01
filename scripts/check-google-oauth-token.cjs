#!/usr/bin/env node
/**
 * Kiểm tra refresh token Google OAuth2 trong `apps/backend/.env` còn dùng được không.
 *
 * Cách dùng (tại thư mục gốc dự án):
 *   node scripts/check-google-oauth-token.cjs
 *
 * Script gọi https://oauth2.googleapis.com/token để đổi refresh token thành
 * access token. Không in ra token — chỉ in trạng thái và thời hạn access token.
 * Mã thoát: 0 = OK, 1 = lỗi (invalid_grant, sai client, mất mạng...).
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const envPath = path.join(repoRoot, 'apps', 'backend', '.env');

function loadEnv() {
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const clientId = String(process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
const clientSecret = String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
const refreshToken = String(process.env.GOOGLE_OAUTH_REFRESH_TOKEN || '').trim();
const account = String(process.env.GOOGLE_OAUTH_ACCOUNT_EMAIL || '').trim();

const missing = [
  ['GOOGLE_OAUTH_CLIENT_ID', clientId],
  ['GOOGLE_OAUTH_CLIENT_SECRET', clientSecret],
  ['GOOGLE_OAUTH_REFRESH_TOKEN', refreshToken],
].filter(([, v]) => !v).map(([k]) => k);

if (missing.length) {
  console.error('Thiếu biến trong .env:', missing.join(', '));
  process.exit(1);
}

(async () => {
  console.log('Client ID :', clientId.slice(0, 24) + '...' + clientId.slice(-12));
  console.log('Tài khoản :', account || '(không khai báo)');
  console.log('Refresh token:', `${refreshToken.slice(0, 6)}...${refreshToken.slice(-4)} (${refreshToken.length} ký tự)`);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.access_token) {
    console.error('\n✗ Refresh token KHÔNG dùng được (HTTP', res.status + ')');
    console.error('  error:', data.error || '(không có)', '| error_description:', data.error_description || '(không có)');
    if (String(data.error) === 'invalid_grant') {
      console.error('  Nguyên nhân thường gặp: token đã hết hạn 7 ngày (app còn Testing),');
      console.error('  người dùng đã thu hồi quyền, hoặc đã tạo quá 100 refresh token cho client này.');
      console.error('  Cách xử lý: Publish app sang In production rồi chạy lại');
      console.error('  node scripts/get-google-oauth-refresh-token.cjs');
    }
    process.exit(1);
  }

  const expiresIn = Number(data.expires_in) || 0;
  console.log('\n✓ Refresh token HOẠT ĐỘNG');
  console.log('  access_token mới hạn:', expiresIn, 'giây (~' + Math.round(expiresIn / 60) + ' phút)');
  console.log('  scope:', data.scope || '(không trả về)');
  console.log('\nLưu ý: Google không trả về hạn của refresh token. Nếu app còn Testing, token');
  console.log('sẽ chết sau 7 ngày kể từ lúc cấp; xem docs mục 2.4 để bỏ hạn này.');
})().catch((error) => {
  console.error('LỖI:', error.message);
  process.exit(1);
});
