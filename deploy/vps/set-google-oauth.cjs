#!/usr/bin/env node
/**
 * Cập nhật cấu hình OAuth2 Google Drive vào `apps/backend/.env` trên VPS.
 *
 * Cách dùng (chạy tại thư mục gốc dự án trên VPS):
 *   node deploy/vps/set-google-oauth.cjs
 *
 * Script sẽ hỏi lần lượt Client ID, Client Secret, Refresh Token, Email.
 * Phần Secret và Refresh Token được nhập ẩn (không hiện lên màn hình,
 * không lưu vào lịch sử shell). File .env cũ được sao lưu trước khi ghi.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const repoRoot = path.resolve(__dirname, '..', '..');
const envPath = path.join(repoRoot, 'apps', 'backend', '.env');

if (!fs.existsSync(envPath)) {
  console.error(`Không tìm thấy ${envPath}`);
  console.error('Hãy chắc chắn đã tạo apps/backend/.env từ deploy/vps/.env.vps.example');
  process.exit(1);
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    if (hidden) {
      const onData = (char) => {
        const text = String(char);
        if (text === '\n' || text === '\r' || text === '\u0004') return;
        // Xoá ký tự vừa hiện ra để không lộ giá trị
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(question);
      };
      process.stdin.on('data', onData);
      rl.question(question, (answer) => {
        process.stdin.removeListener('data', onData);
        rl.close();
        process.stdout.write('\n');
        resolve(answer.trim());
      });
      return;
    }

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function upsert(envText, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp('^' + key + '=.*$', 'm');
  if (pattern.test(envText)) return envText.replace(pattern, line);
  return envText.trimEnd() + '\n' + line + '\n';
}

(async () => {
  console.log('Cấu hình OAuth2 Google Drive cho backend UBM');
  console.log(`File đích: ${envPath}`);
  console.log('(Nhấn Enter để giữ nguyên giá trị đang có)\n');

  const current = fs.readFileSync(envPath, 'utf8');
  const read = (key) => {
    const match = current.match(new RegExp('^' + key + '=(.*)$', 'm'));
    return match ? match[1].trim() : '';
  };

  const clientId = (await ask(`GOOGLE_OAUTH_CLIENT_ID [${read('GOOGLE_OAUTH_CLIENT_ID') || 'trống'}]: `)) || read('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = (await ask('GOOGLE_OAUTH_CLIENT_SECRET (nhập ẩn): ', { hidden: true })) || read('GOOGLE_OAUTH_CLIENT_SECRET');
  const refreshToken = (await ask('GOOGLE_OAUTH_REFRESH_TOKEN (nhập ẩn): ', { hidden: true })) || read('GOOGLE_OAUTH_REFRESH_TOKEN');
  const email = (await ask(`GOOGLE_OAUTH_ACCOUNT_EMAIL [${read('GOOGLE_OAUTH_ACCOUNT_EMAIL') || 'trống'}]: `)) || read('GOOGLE_OAUTH_ACCOUNT_EMAIL');

  const missing = [
    ['GOOGLE_OAUTH_CLIENT_ID', clientId],
    ['GOOGLE_OAUTH_CLIENT_SECRET', clientSecret],
    ['GOOGLE_OAUTH_REFRESH_TOKEN', refreshToken],
  ].filter(([, value]) => !value).map(([key]) => key);

  if (missing.length > 0) {
    console.error('\nThiếu giá trị: ' + missing.join(', '));
    process.exit(1);
  }

  let next = current;
  next = upsert(next, 'GOOGLE_OAUTH_CLIENT_ID', clientId);
  next = upsert(next, 'GOOGLE_OAUTH_CLIENT_SECRET', clientSecret);
  next = upsert(next, 'GOOGLE_OAUTH_REFRESH_TOKEN', refreshToken);
  if (email) next = upsert(next, 'GOOGLE_OAUTH_ACCOUNT_EMAIL', email);

  const backupPath = `${envPath}.bak-${Date.now()}`;
  fs.copyFileSync(envPath, backupPath);
  fs.writeFileSync(envPath, next);

  console.log('\nĐã cập nhật xong.');
  console.log(`Bản sao lưu: ${backupPath}`);
  console.log('Bước tiếp theo (backend chạy bằng Docker, cần tạo lại container để nạp .env):');
  console.log('  docker compose up -d --force-recreate backend');
  console.log('Kiểm tra: curl -s https://<domain>/api/health | grep -A12 \'"drive"\'');
})().catch((error) => {
  console.error('LỖI:', error.message);
  process.exit(1);
});
