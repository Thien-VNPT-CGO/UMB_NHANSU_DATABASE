#!/usr/bin/env bash
# ==============================================================
# Helper: Nap Google Service Account JSON vao apps/backend/.env
# Cach dung tren VPS:
#   bash deploy/vps/set-service-account.sh /duong-dan/file-key.json
# ==============================================================
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="apps/backend/.env"

if [ ! -f "$ENV_FILE" ]; then
  if [ -f "deploy/vps/.env.vps.example" ]; then
    echo "==> Chưa có $ENV_FILE, đang copy từ .env.vps.example..."
    cp deploy/vps/.env.vps.example "$ENV_FILE"
  else
    echo "LỖI: Không tìm thấy $ENV_FILE"
    exit 1
  fi
fi

if [ $# -ge 1 ] && [ -f "$1" ]; then
  KEY_FILE="$1"
  echo "==> Đang đọc key từ file: $KEY_FILE"
  node -e '
    const fs = require("fs");
    const keyPath = process.argv[1];
    const envPath = "apps/backend/.env";
    const raw = fs.readFileSync(keyPath, "utf8");
    const parsed = JSON.parse(raw);
    const minified = JSON.stringify(parsed);
    
    let env = fs.readFileSync(envPath, "utf8");
    const target = `GOOGLE_SERVICE_ACCOUNT_JSON=\x27${minified}\x27`;
    
    // Thay the hoac them moi
    if (/GOOGLE_SERVICE_ACCOUNT_JSON\s*=/.test(env)) {
      env = env.replace(/GOOGLE_SERVICE_ACCOUNT_JSON\s*=[\s\S]*?(?=\n[A-Z_]+|\n*$)/, target);
    } else {
      env += "\n" + target + "\n";
    }
    fs.writeFileSync(envPath, env, "utf8");
    console.log("==> [THÀNH CÔNG] Đã ghi GOOGLE_SERVICE_ACCOUNT_JSON chuẩn 1 dòng vào apps/backend/.env!");
  ' "$KEY_FILE"
else
  echo "Cách dùng:"
  echo "  bash deploy/vps/set-service-account.sh <đường_dẫn_file_json>"
  echo "Ví dụ:"
  echo "  bash deploy/vps/set-service-account.sh ~/google-key.json"
fi
