#!/usr/bin/env bash
# ==============================================================
# UBM WATCHDOG (prod, chay cron moi phut tren HOST VPS)
# --------------------------------------------------------------
# - Ping backend moi phut: http://localhost:4005/health
# - DOWN 3 phut lien tiep -> tu dong `docker compose restart backend`
#   (Docker chi tu restart khi process CHET HAN; backend "chung song"
#   khong phan hoi thi watchdog giup xu ly).
# - Khi phuc hoi -> POST /internal/downtime-report (kem secret trong
#   apps/backend/.env) de backend luu lich su su co + thong bao Admin/HR.
# Log: /var/log/ubm-watchdog.log
# Cai dat: sudo bash deploy/vps/install-watchdog.sh
# Bo cu:   sudo bash deploy/vps/install-watchdog.sh --off
# ==============================================================
set -uo pipefail

REPO_DIR="${PROD_DIR:-$HOME/ubm-vps}"
STATE_DIR="/opt/ubm/watchdog"
HEALTH_URL="http://localhost:4005/health"
ENV_FILE="$REPO_DIR/apps/backend/.env"
mkdir -p "$STATE_DIR"

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

if curl -fsS -m 8 "$HEALTH_URL" >/dev/null 2>&1; then
  # --- KHOE MANH ---
  if [ -f "$STATE_DIR/down_since" ]; then
    DOWN_SINCE="$(cat "$STATE_DIR/down_since" 2>/dev/null || true)"
    RESTARTS="$(cat "$STATE_DIR/restart_count" 2>/dev/null || echo 0)"
    rm -f "$STATE_DIR/down_since" "$STATE_DIR/fail_count" "$STATE_DIR/restart_count"
    SECRET="$(grep -E '^INTERNAL_ALERT_SECRET=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')"
    if [ -n "$SECRET" ] && [ -n "$DOWN_SINCE" ]; then
      # Backend vua song lai -> bao su co cho Admin/HR qua notification + lich su
      curl -fsS -m 10 -X POST "http://localhost:4005/internal/downtime-report" \
        -H "Content-Type: application/json" \
        -H "x-internal-secret: $SECRET" \
        -d "{\"down_since\":\"$DOWN_SINCE\",\"recovered_at\":\"$(now_iso)\",\"restart_attempts\":$RESTARTS}" \
        >/dev/null 2>&1 || true
    fi
    echo "[recovery] $(now_iso) phuc hoi OK (su co bat dau: $DOWN_SINCE, restarts: $RESTARTS)"
  fi
  rm -f "$STATE_DIR/fail_count"
  exit 0
fi

# --- DOWN ---
FAILS=$(( $(cat "$STATE_DIR/fail_count" 2>/dev/null || echo 0) + 1 ))
echo "$FAILS" > "$STATE_DIR/fail_count"
if [ ! -f "$STATE_DIR/down_since" ]; then
  now_iso > "$STATE_DIR/down_since"
  echo 0 > "$STATE_DIR/restart_count"
fi
echo "[warn] $(now_iso) health FAIL lien tiep lan thu $FAILS"

# Restart 1 lan duy nhat khi du 3 phut chet (tranh spam restart khi deploy/build)
if [ "$FAILS" -eq 3 ]; then
  RESTARTS=$(( $(cat "$STATE_DIR/restart_count" 2>/dev/null || echo 0) + 1 ))
  echo "$RESTARTS" > "$STATE_DIR/restart_count"
  echo "[action] $(now_iso) docker compose restart backend (lan $RESTARTS)"
  (cd "$REPO_DIR" && docker compose restart backend) >> "$STATE_DIR/restart.log" 2>&1 || true
fi

if [ "$FAILS" -ge 15 ]; then
  echo "[CRITICAL] $(now_iso) server DOWN $FAILS phut lien tiep — can nguoi kiem tra VPS!"
fi
exit 0
