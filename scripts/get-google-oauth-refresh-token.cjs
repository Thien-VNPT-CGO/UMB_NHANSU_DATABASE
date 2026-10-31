#!/usr/bin/env node
/**
 * LẤY GOOGLE OAUTH2 REFRESH TOKEN CHO GOOGLE DRIVE
 * =================================================
 * Service Account KHÔNG có quota trên Google Drive cá nhân (Gmail) nên ảnh
 * check-in/check-out không upload được ("Service Accounts do not have storage
 * quota"). Cách khắc phục: cấp quyền bằng chính tài khoản Gmail sở hữu thư mục
 * Drive, rồi dán refresh token vào apps/backend/.env.
 *
 * CÁCH DÙNG (máy có trình duyệt, chạy 1 lần):
 *   1. Vào https://console.cloud.google.com/apis/credentials
 *      - Create Credentials -> OAuth client ID -> Application type: Desktop app
 *      - Bật "Google Drive API" cho project nếu chưa bật.
 *   2. Chạy:
 *        set GOOGLE_OAUTH_CLIENT_ID=xxxx.apps.googleusercontent.com
 *        set GOOGLE_OAUTH_CLIENT_SECRET=xxxx
 *        node scripts/get-google-oauth-refresh-token.cjs
 *      (PowerShell: $env:GOOGLE_OAUTH_CLIENT_ID="..."; $env:GOOGLE_OAUTH_CLIENT_SECRET="...")
 *   3. Trình duyệt mở ra, đăng nhập ĐÚNG tài khoản Gmail sở hữu thư mục
 *      "04. ĐIỂM DANH (CHECK-IN + CHECK-OUT)" và bấm Cho phép.
 *   4. Copy 3 dòng in ra vào apps/backend/.env trên VPS rồi restart backend:
 *        GOOGLE_OAUTH_CLIENT_ID=...
 *        GOOGLE_OAUTH_CLIENT_SECRET=...
 *        GOOGLE_OAUTH_REFRESH_TOKEN=...
 *        GOOGLE_OAUTH_ACCOUNT_EMAIL=umbomilk@gmail.com
 *
 * Script cũng đọc được apps/backend/.env nếu đã có sẵn CLIENT_ID/SECRET.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

const envFile = loadEnvFile(path.resolve(__dirname, '../apps/backend/.env'));

function pick(...names) {
  for (const name of names) {
    const value = String(process.env[name] || envFile[name] || '').trim();
    if (value) return value;
  }
  return '';
}

const clientId = pick('GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_DRIVE_OAUTH_CLIENT_ID');
const clientSecret = pick('GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_DRIVE_OAUTH_CLIENT_SECRET');
const scopes = ['https://www.googleapis.com/auth/drive'];

if (!clientId || !clientSecret) {
  console.error('\n❌ Thiếu OAuth Client ID / Client Secret.\n');
  console.error('Tạo tại: https://console.cloud.google.com/apis/credentials');
  console.error('  Create Credentials -> OAuth client ID -> Desktop app\n');
  console.error('Sau đó chạy lại:');
  console.error('  PowerShell:');
  console.error('    $env:GOOGLE_OAUTH_CLIENT_ID="xxxx.apps.googleusercontent.com"');
  console.error('    $env:GOOGLE_OAUTH_CLIENT_SECRET="xxxx"');
  console.error('    node scripts/get-google-oauth-refresh-token.cjs\n');
  process.exit(1);
}

let google;
try {
  ({ google } = require('googleapis'));
} catch {
  console.error('❌ Không tìm thấy gói googleapis. Chạy: npm install (tại thư mục gốc dự án)');
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/oauth2callback') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h3>Bị từ chối: ${error}</h3>`);
      finish(1);
      return;
    }
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h3>Thiếu mã ?code=</h3>');
      return;
    }

    const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<h3>Không nhận được refresh_token</h3>' +
        '<p>Google chỉ trả refresh_token ở lần cấp quyền đầu tiên. ' +
        'Vào https://myaccount.google.com/permissions gỡ quyền ứng dụng rồi chạy lại script.</p>'
      );
      finish(1);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h3>✅ Thành công! Có thể đóng tab này và quay lại cửa sổ lệnh.</h3>');

    console.log('\n================ COPY 4 DÒNG SAU VÀO apps/backend/.env ================\n');
    console.log(`GOOGLE_OAUTH_CLIENT_ID=${clientId}`);
    console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${clientSecret}`);
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('GOOGLE_OAUTH_ACCOUNT_EMAIL=<email-vừa-đăng-nhập>');
    console.log('\nSau khi dán: restart backend (docker compose restart backend / pm2 restart ...)');
    console.log('Kiểm tra: curl https://<domain>/api/health  ->  drive.authMode phải là "oauth"\n');
    console.log('=======================================================================\n');
    finish(0);
  } catch (err) {
    console.error('\n❌ Đổi code lấy token thất bại:', err?.response?.data || err?.message || err);
    finish(1);
  }
});

let redirectUri = '';
let finished = false;

function finish(code) {
  if (finished) return;
  finished = true;
  setTimeout(() => {
    try { server.close(); } catch { /* ignore */ }
    process.exit(code);
  }, 300);
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === 'win32'
    ? `start "" "${url}"`
    : platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd, () => { /* nếu không mở được, người dùng tự copy URL */ });
}

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // ép trả refresh_token kể cả khi đã cấp quyền trước đó
    scope: scopes,
  });

  console.log('\nMở trình duyệt và đăng nhập tài khoản Gmail SỞ HỮU thư mục Drive điểm danh.');
  console.log('Nếu trình duyệt không tự mở, copy URL sau:\n');
  console.log(authUrl);
  console.log('\nĐang chờ bạn bấm "Cho phép"...\n');
  openBrowser(authUrl);
});

server.on('error', (err) => {
  console.error('❌ Không mở được cổng local:', err?.message || err);
  process.exit(1);
});
