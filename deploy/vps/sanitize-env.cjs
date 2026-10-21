#!/usr/bin/env node
/**
 * Auto-sanitize apps/backend/.env before docker-compose parses it.
 * Fixes common mistake: pasting multi-line Google Service Account JSON into .env.
 */
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../../apps/backend/.env');
if (!fs.existsSync(envPath)) {
  process.exit(0);
}

let content = fs.readFileSync(envPath, 'utf8');
let modified = false;

// 1. Trường hợp: GOOGLE_SERVICE_ACCOUNT_JSON={ \n ... \n } (nhiều dòng)
const multiLineRegex = /GOOGLE_SERVICE_ACCOUNT_JSON\s*=\s*(\{[\s\S]*?\n\s*\})/m;
const match = content.match(multiLineRegex);

if (match) {
  try {
    const rawJson = match[1].trim();
    // Validate valid JSON
    const parsed = JSON.parse(rawJson);
    const minified = JSON.stringify(parsed);
    // Wrap in single quotes so docker-compose treats it as a single scalar
    const replacement = `GOOGLE_SERVICE_ACCOUNT_JSON='${minified}'`;
    content = content.replace(match[0], replacement);
    modified = true;
    console.log('[sanitize-env] Đã tự động gộp GOOGLE_SERVICE_ACCOUNT_JSON từ nhiều dòng về 1 dòng chuẩn cho Docker Compose.');
  } catch (err) {
    console.warn('[sanitize-env] Không thể parse JSON đa dòng trong GOOGLE_SERVICE_ACCOUNT_JSON:', err.message);
  }
}

// 2. Trường hợp: Người dùng paste nguyên file JSON mà quên chữ GOOGLE_SERVICE_ACCOUNT_JSON=
if (!content.includes('GOOGLE_SERVICE_ACCOUNT_JSON=')) {
  const orphanJsonRegex = /(\{\s*"type"\s*:\s*"service_account"[\s\S]*?\n\s*\})/m;
  const orphanMatch = content.match(orphanJsonRegex);
  if (orphanMatch) {
    try {
      const parsed = JSON.parse(orphanMatch[1].trim());
      const minified = JSON.stringify(parsed);
      const replacement = `GOOGLE_SERVICE_ACCOUNT_JSON='${minified}'`;
      content = content.replace(orphanMatch[0], replacement);
      modified = true;
      console.log('[sanitize-env] Phát hiện JSON Service Account dán trực tiếp, đã tự động thêm tiền tố GOOGLE_SERVICE_ACCOUNT_JSON.');
    } catch (err) {
      console.warn('[sanitize-env] Không thể parse orphan JSON:', err.message);
    }
  }
}

// 3. Trường hợp: private_key có ký tự xuống dòng thực tế thay vì \n
// Nếu đã ở dạng GOOGLE_SERVICE_ACCOUNT_JSON='...' hoặc "..." nhưng bên trong có newline
const quotedRegex = /GOOGLE_SERVICE_ACCOUNT_JSON\s*=\s*(["'])([\s\S]*?)\1/m;
const quotedMatch = content.match(quotedRegex);
if (quotedMatch && quotedMatch[2].includes('\n')) {
  try {
    const parsed = JSON.parse(quotedMatch[2]);
    const minified = JSON.stringify(parsed);
    content = content.replace(quotedMatch[0], `GOOGLE_SERVICE_ACCOUNT_JSON='${minified}'`);
    modified = true;
    console.log('[sanitize-env] Đã chuẩn hóa newline trong GOOGLE_SERVICE_ACCOUNT_JSON.');
  } catch (err) {
    // Có thể format chưa chuẩn, giữ nguyên
  }
}

if (modified) {
  // Tạo backup trước khi ghi đè
  try {
    fs.writeFileSync(envPath + '.bak', fs.readFileSync(envPath));
  } catch (e) {}
  fs.writeFileSync(envPath, content, 'utf8');
  console.log('[sanitize-env] Cập nhật apps/backend/.env thành công!');
}
