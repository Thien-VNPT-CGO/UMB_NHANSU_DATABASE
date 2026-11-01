#!/usr/bin/env node
/**
 * Kiểm tra Google Apps Script Webhook (upload ảnh Drive) đã đúng chưa.
 *
 * Cách dùng (chạy tại thư mục gốc dự án):
 *   node scripts/test-drive-webhook.cjs
 *
 * Đọc GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL và GOOGLE_DRIVE_WEBHOOK_SECRET trong
 * apps/backend/.env (hoặc biến môi trường). Script KHÔNG tạo file trên Drive —
 * chỉ kiểm tra 3 thứ:
 *   1. URL sống và trả {"ok":true,...}
 *   2. Secret sai bị từ chối (FORBIDDEN)
 *   3. Secret đúng được chấp nhận (báo MISSING_FIELDS vì không gửi file)
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

const url = String(process.env.GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL || '').trim();
const secret = String(process.env.GOOGLE_DRIVE_WEBHOOK_SECRET || '').trim();

if (!url) {
  console.error('Thiếu GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL trong apps/backend/.env');
  console.error('Xem hướng dẫn: docs/GOOGLE_DRIVE_ANH_DIEM_DANH.md (mục 3)');
  process.exit(1);
}

async function post(body, withSecret) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(withSecret && secret ? { 'X-Webhook-Secret': secret } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* HTML (trang đăng nhập) */ }
  return { status: res.status, json, text };
}

(async () => {
  console.log('Webhook:', url);
  console.log('Secret :', secret ? `đã cấu hình (${secret.length} ký tự)` : 'TRỐNG (script chấp nhận mọi request)');

  const ping = await fetch(url, { method: 'GET' });
  const pingText = await ping.text();
  let pingJson = null;
  try { pingJson = JSON.parse(pingText); } catch { /* ignore */ }
  if (!pingJson || pingJson.ok !== true) {
    console.error('✗ GET thất bại:', ping.status, pingText.slice(0, 200));
    console.error('  Kiểm tra: Deploy → Manage deployments → Who has access = Anyone.');
    process.exit(1);
  }
  console.log('✓ GET ok — service:', pingJson.service || '(không rõ)');

  if (secret) {
    const bad = await post({ action: 'upload', fileName: 'x.jpg', base64: '' }, false);
    const badOk = bad.json && String(bad.json.error || '') === 'FORBIDDEN';
    console.log(badOk ? '✓ Secret sai bị từ chối đúng' : '✗ Cảnh báo: secret sai KHÔNG bị từ chối', bad.text.slice(0, 120));

    const good = await post({ action: 'upload', fileName: 'x.jpg', base64: '' }, true);
    const goodOk = good.json && String(good.json.error || '') === 'MISSING_FIELDS';
    console.log(goodOk ? '✓ Secret đúng được chấp nhận' : '✗ Secret đúng bị từ chối', good.text.slice(0, 160));
    if (!badOk || !goodOk) process.exit(1);
  }

  console.log('\nKết luận: webhook sẵn sàng. Backend sẽ ưu tiên upload qua webhook khi đã cấu hình.');
  console.log('Sau khi thêm .env: docker compose up -d --force-recreate backend');
})().catch((error) => {
  console.error('LỖI:', error.message);
  process.exit(1);
});
