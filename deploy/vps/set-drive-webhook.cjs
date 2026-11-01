#!/usr/bin/env node
/**
 * Cập nhật cấu hình Google Apps Script Webhook (upload ảnh Drive) vào
 * `apps/backend/.env` trên VPS.
 *
 * Vì sao dùng webhook: script chạy dưới quyền chủ thư mục Drive nên KHÔNG cần
 * refresh token OAuth — không có gì hết hạn. Đây là phương án "vĩnh viễn" cho
 * tài khoản Gmail cá nhân.
 *
 * Cách dùng (chạy tại thư mục gốc dự án trên VPS):
 *   node deploy/vps/set-drive-webhook.cjs
 *
 * Hoặc truyền thẳng tham số (không hỏi):
 *   node deploy/vps/set-drive-webhook.cjs \
 *     --url "https://script.google.com/macros/s/.../exec" --secret "chuoi-bi-mat"
 *
 * Secret được nhập ẩn, file .env cũ được sao lưu trước khi ghi.
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

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? String(process.argv[i + 1] || '').trim() : '';
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const onData = () => {
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
  const commented = new RegExp('^#\\s*' + key + '=.*$', 'm');
  if (pattern.test(envText)) return envText.replace(pattern, line);
  if (commented.test(envText)) return envText.replace(commented, line);
  return envText.trimEnd() + '\n' + line + '\n';
}

(async () => {
  console.log('Cấu hình Google Apps Script Webhook (ảnh điểm danh) cho backend UBM');
  console.log(`File đích: ${envPath}`);
  console.log('(Nhấn Enter để giữ nguyên giá trị đang có)\n');

  const current = fs.readFileSync(envPath, 'utf8');
  const read = (key) => {
    const match = current.match(new RegExp('^' + key + '=(.*)$', 'm'));
    return match ? match[1].trim() : '';
  };

  let url = arg('url');
  let secret = arg('secret');

  if (!url) {
    const shown = read('GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL');
    url = (await ask(`GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL [${shown ? 'đã có' : 'trống'}]: `)) || shown;
  }
  if (!secret) {
    secret = (await ask('GOOGLE_DRIVE_WEBHOOK_SECRET (nhập ẩn): ', { hidden: true })) || read('GOOGLE_DRIVE_WEBHOOK_SECRET');
  }

  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) {
    console.error('\nURL không hợp lệ. Phải có dạng: https://script.google.com/macros/s/<id>/exec');
    process.exit(1);
  }

  let next = current;
  next = upsert(next, 'GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL', url);
  if (secret) next = upsert(next, 'GOOGLE_DRIVE_WEBHOOK_SECRET', secret);

  const backupPath = `${envPath}.bak-${Date.now()}`;
  fs.copyFileSync(envPath, backupPath);
  fs.writeFileSync(envPath, next);

  console.log('\nĐã cập nhật xong.');
  console.log(`Bản sao lưu: ${backupPath}`);
  console.log('Bước tiếp theo (backend chạy bằng Docker, cần tạo lại container để nạp .env):');
  console.log('  docker compose up -d --force-recreate backend');
  console.log('Kiểm tra:');
  console.log('  node scripts/test-drive-webhook.cjs');
  console.log('  curl -s https://<domain>/api/health | grep -A12 \'"drive"\'');
})().catch((error) => {
  console.error('LỖI:', error.message);
  process.exit(1);
});
