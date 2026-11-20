#!/usr/bin/env bash
# Cài đặt / cập nhật HaraSocial Zalo Alert trên VPS:
#   - Tạo role + database PostgreSQL riêng (idempotent)
#   - Sinh file apps/harasocial-monitor/.env (giữ nguyên mã truy cập cũ)
#   - Áp migration drizzle/0000_init.sql
#   - Cài systemd service cổng 3010
# Chạy trên VPS: sudo bash deploy/vps/setup-harasocial.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

APP_DIR="apps/harasocial-monitor"
ENV_FILE="$APP_DIR/.env"
UNIT_FILE="/etc/systemd/system/harasocial-monitor.service"
DB_NAME="harasocial"
DB_USER="harasocial"
SERVICE_PORT="${HARASOCIAL_PORT:-3010}"
DOMAIN="umbomilk-nhansu-diemdanh.duckdns.org"

gen_hex() { openssl rand -hex "$1"; }

read_env() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | head -1 | sed 's/^"//; s/"$//'
}

ROOT="$(pwd)"

# Giữ nguyên mã truy cập / secret cũ nếu đã có.
DB_PASS="$(read_env HARA_DB_PASSWORD)"
if [ -z "$DB_PASS" ]; then
  DB_URL="$(read_env DATABASE_URL)"
  if [ -n "$DB_URL" ]; then
    DB_PASS=$(printf '%s' "$DB_URL" | sed -n 's#.*://[^:]*:\([^@]*\)@.*#\1#p')
  fi
fi
[ -n "$DB_PASS" ] || DB_PASS=$(gen_hex 16)

ACCESS_CODE="$(read_env HARA_ACCESS_CODE)"
[ -n "$ACCESS_CODE" ] || ACCESS_CODE=$(gen_hex 9)
SESSION_SECRET="$(read_env HARA_SESSION_SECRET)"
[ -n "$SESSION_SECRET" ] || SESSION_SECRET=$(gen_hex 32)

GOOGLE_CLIENT_ID="$(read_env GOOGLE_OAUTH_CLIENT_ID)"
if [ -z "$GOOGLE_CLIENT_ID" ] && [ -f apps/backend/.env ]; then
  GOOGLE_CLIENT_ID=$(sed -n 's/^GOOGLE_OAUTH_CLIENT_ID=//p' apps/backend/.env | head -1 | tr -d '"')
fi

echo "==> 1. Database PostgreSQL ($DB_NAME / $DB_USER)"
PG_USER=$(docker compose exec -T postgres printenv POSTGRES_USER | tr -d '\r\n')
PG_USER="${PG_USER:-ubm}"

ROLE_EXISTS=$(docker compose exec -T postgres psql -U "$PG_USER" -d postgres -tAc \
  "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | tr -d '[:space:]')
if [ "$ROLE_EXISTS" = "1" ]; then
  docker compose exec -T postgres psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 \
    -c "ALTER ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS'" >/dev/null
else
  docker compose exec -T postgres psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS'" >/dev/null
  echo "    đã tạo role $DB_USER"
fi

DB_EXISTS=$(docker compose exec -T postgres psql -U "$PG_USER" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | tr -d '[:space:]')
if [ "$DB_EXISTS" != "1" ]; then
  docker compose exec -T postgres psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE $DB_NAME OWNER $DB_USER" >/dev/null
  echo "    đã tạo database $DB_NAME"
fi

echo "==> 2. Ghi $ENV_FILE"
umask 077
cat > "$ENV_FILE" <<EOF
# Tự sinh bởi deploy/vps/setup-harasocial.sh — không commit file này.
NODE_ENV=production
PORT=$SERVICE_PORT
PUBLIC_URL=https://$DOMAIN/harasocial

DATABASE_URL=postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME
PGSSL=disable

# Xác thực: mã truy cập quản trị (mặc định) + Google OAuth nếu client ID hợp lệ.
HARA_ACCESS_CODE=$ACCESS_CODE
HARA_SESSION_SECRET=$SESSION_SECRET
HARA_OWNER_UID=ubm-director
HARA_OWNER_EMAIL=director@ubm.local
HARA_OWNER_NAME="Giám đốc UBM"
GOOGLE_OAUTH_CLIENT_ID=$GOOGLE_CLIENT_ID
HARA_ALLOWED_EMAILS=

# Không dùng Firebase cho tới khi dự án Firebase được bật.
FIREBASE_PROJECT_ID=
FIREBASE_SERVICE_ACCOUNT_JSON=
FIREBASE_WEB_API_KEY=
FIREBASE_AUTH_DOMAIN=
FIREBASE_WEB_APP_ID=

HARA_DB_PASSWORD=$DB_PASS
ALLOW_INSECURE_PULL=0
HARA_WORKER_DISABLED=0
EOF
umask 022
chmod 600 "$ENV_FILE"

echo "==> 3. Áp migration schema"
docker compose exec -T -e PGPASSWORD="$DB_PASS" postgres \
  psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  < "$APP_DIR/drizzle/0000_init.sql" >/dev/null
echo "    schema OK"

echo "==> 4. systemd service (cổng $SERVICE_PORT)"
if [ ! -f "$APP_DIR/dist/server/index.js" ]; then
  echo "THIEU $APP_DIR/dist/server/index.js — hãy build trước (npm run build --workspace=@ubm/harasocial-monitor)"
  exit 1
fi
cat > /tmp/harasocial-monitor.service <<EOF
[Unit]
Description=HaraSocial Zalo Alert (HaraSocial Monitor)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT/$APP_DIR
EnvironmentFile=$ROOT/$ENV_FILE
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/server/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
if ! cmp -s /tmp/harasocial-monitor.service "$UNIT_FILE"; then
  install -m 644 /tmp/harasocial-monitor.service "$UNIT_FILE"
  systemctl daemon-reload
  echo "    đã cập nhật unit"
fi
systemctl enable harasocial-monitor >/dev/null 2>&1 || true
systemctl restart harasocial-monitor
echo "    service: $(systemctl is-active harasocial-monitor || true)"

echo "==> 5. Kết nối HR webhook (UBM backend -> HaraSocial)"
READY=0
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$SERVICE_PORT/api/health" >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -eq 1 ] && [ -f apps/backend/.env ]; then
  OWNER_UID="$(read_env HARA_OWNER_UID)"
  OWNER_UID="${OWNER_UID:-ubm-director}"
  TOKEN=$(curl -fsS -X POST "http://127.0.0.1:$SERVICE_PORT/api/auth/access" \
    -H 'Content-Type: application/json' -d "{\"code\":\"$ACCESS_CODE\"}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))' 2>/dev/null || true)
  if [ -n "$TOKEN" ]; then
    # bootstrap trước để tạo user + workspace (PATCH sẽ trả 404 nếu workspace chưa tồn tại).
    curl -fsS "http://127.0.0.1:$SERVICE_PORT/api/bootstrap" \
      -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
    curl -fsS -X PATCH "http://127.0.0.1:$SERVICE_PORT/api/workspace" \
      -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d '{"hr":{"enabled":true}}' >/dev/null 2>&1 || true
    HR_SECRET=$(curl -fsS "http://127.0.0.1:$SERVICE_PORT/api/bootstrap" \
      -H "Authorization: Bearer $TOKEN" \
      | python3 -c 'import json,sys; print((json.load(sys.stdin).get("workspace",{}).get("hr",{}) or {}).get("webhookSecret",""))' 2>/dev/null || true)
    if [ -n "$HR_SECRET" ]; then
      cp apps/backend/.env "apps/backend/.env.bak-harasocial"
      sed -i '/^HR_SCHEDULE_WEBHOOK_/d' apps/backend/.env
      cat >> apps/backend/.env <<EOF
HR_SCHEDULE_WEBHOOK_ENABLED=1
HR_SCHEDULE_WEBHOOK_URL=https://$DOMAIN/harasocial/api/webhooks/hr?workspace=$OWNER_UID
HR_SCHEDULE_WEBHOOK_SECRET=$HR_SECRET
HR_SCHEDULE_WEBHOOK_TIMEOUT_MS=10000
EOF
      docker compose up -d backend >/dev/null 2>&1 || true
      echo "    đã cấu hình HR_SCHEDULE_WEBHOOK_URL + secret cho backend UBM"
    else
      echo "    [CANH BAO] không đọc được hr.webhookSecret — cấu hình HR thủ công trong tab Cài đặt"
    fi
  else
    echo "    [CANH BAO] không đăng nhập được bằng mã truy cập để tự cấu hình HR"
  fi
else
  echo "    [CANH BAO] HaraSocial chưa sẵn sàng — bỏ qua cấu hình HR webhook"
fi

echo
echo "Mã truy cập quản trị (lưu lại, không chia sẻ): $ACCESS_CODE"
