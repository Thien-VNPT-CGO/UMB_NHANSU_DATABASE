#!/usr/bin/env node
/**
 * In ra 4 dòng cấu hình OAuth2 Google Drive để dán vào `.env` trên VPS.
 *
 * Cách dùng (tại thư mục gốc dự án):
 *   node scripts/print-google-oauth-env.cjs
 *
 * Script chỉ đọc `apps/backend/.env` trên máy đang chạy, KHÔNG gọi mạng
 * và KHÔNG chứa bí mật nào trong mã nguồn.
 */
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '..', 'apps', 'backend', '.env');

if (!fs.existsSync(envPath)) {
  console.error(`Không tìm thấy ${envPath}`);
  process.exit(1);
}

const envText = fs.readFileSync(envPath, 'utf8');

function get(name) {
  const match = envText.match(new RegExp('^' + name + '=(.*)$', 'm'));
  if (!match) return '';
  return match[1].trim().replace(/^"|"$/g, '');
}

const keys = [
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_REFRESH_TOKEN',
  'GOOGLE_OAUTH_ACCOUNT_EMAIL',
];

const missing = keys.filter((key) => !get(key));
if (missing.length > 0) {
  console.error('Thiếu cấu hình trong apps/backend/.env: ' + missing.join(', '));
  console.error('Chạy scripts/get-google-oauth-refresh-token.cjs trước.');
  process.exit(1);
}

const attendanceFolder = get('GOOGLE_DRIVE_ATTENDANCE_FOLDER_ID');

console.log('# ==== Dán 4 dòng dưới vào apps/backend/.env trên VPS ====');
for (const key of keys) {
  console.log(`${key}=${get(key)}`);
}

if (attendanceFolder) {
  console.log('');
  console.log('# Thư mục gốc điểm danh trên Drive (không bắt buộc, đã có mặc định)');
  console.log(`GOOGLE_DRIVE_ATTENDANCE_FOLDER_ID=${attendanceFolder}`);
}

console.log('');
console.log('# Sau khi dán: pm2 restart ubm-backend --update-env');
