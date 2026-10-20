#!/usr/bin/env bash
# ==============================================================
# CAI DAT / GO BO WATCHDOG giam sat server UBM (chay 1 lan tren VPS)
# --------------------------------------------------------------
# Cai dat (trong folder repo tren VPS):
#   sudo bash deploy/vps/install-watchdog.sh
# Go bo:
#   sudo bash deploy/vps/install-watchdog.sh --off
#
# Lam gi:
#   - Cron moi phut ping http://localhost:4005/health
#   - Chet 3 phut lien tiep -> tu restart docker backend
#   - Phuc hoi -> backend luu su co + thong bao Admin/HR (notification)
#   - Tu sinh INTERNAL_ALERT_SECRET vao apps/backend/.env neu chua co
#     (restart backend 1 lan sau khi cai de nhan secret moi)
# Log: /var/log/ubm-watchdog.log
# ==============================================================
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="/opt/ubm/bin"
LOG_FILE="/var/log/ubm-watchdog.log"
CRON_FILE="/etc/cron.d/ubm-watchdog"
PROD_DIR="${PROD_DIR:-$HOME/ubm-vps}"

if [ "${1:-}" = "--off" ]; then
  rm -f "$CRON_FILE"
  echo "[OK] Da go bo watchdog (xoa $CRON_FILE)."
  exit 0
fi

[ "$(id -u)" -eq 0 ] || { echo "Can chay voi sudo/root."; exit 1; }
[ -f "$PROD_DIR/apps/backend/.env" ] || { echo "THIEU $PROD_DIR/apps/backend/.env — deploy prod chua chay lan nao?"; exit 1; }

# 1) Dam bao co INTERNAL_ALERT_SECRET trong .env (sinh moi neu thieu)
if ! grep -qE '^INTERNAL_ALERT_SECRET=' "$PROD_DIR/apps/backend/.env"; then
  SECRET="$(openssl rand -hex 24 2>/dev/null || head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  echo "" >> "$PROD_DIR/apps/backend/.env"
  echo "# Watchdog bao su co server (tach bang secret header)" >> "$PROD_DIR/apps/backend/.env"
  echo "INTERNAL_ALERT_SECRET=$SECRET" >> "$PROD_DIR/apps/backend/.env"
  NEED_RESTART=1
  echo "[OK] Da sinh INTERNAL_ALERT_SECRET vao apps/backend/.env"
fi

# 2) Cai watchdog vao /opt/ubm/bin (ghi PROD_DIR ban cai dat)
mkdir -p "$BIN_DIR"
install -m 0755 "$SRC/watchdog.sh" "$BIN_DIR/watchdog.sh"
sed -i "s|^REPO_DIR=.*|REPO_DIR=\"$PROD_DIR\"|" "$BIN_DIR/watchdog.sh"

# 3) Cron moi phut
cat > "$CRON_FILE" <<EOF
# UBM watchdog giam sat server prod (go bo = xoa file nay)
* * * * * root PROD_DIR="$PROD_DIR" /usr/bin/flock -n /tmp/ubm-watchdog.lock $BIN_DIR/watchdog.sh >> $LOG_FILE 2>&1
EOF
chmod 0644 "$CRON_FILE"
mkdir -p /opt/ubm/watchdog
touch "$LOG_FILE"; chmod 0644 "$LOG_FILE"

echo "[OK] Da cai watchdog:"
echo "     - Cron moi phut: $CRON_FILE"
echo "     - Prod dir: $PROD_DIR (docker compose restart backend khi chet 3 phut)"
echo "     - Log: tail -f $LOG_FILE"
if [ "${NEED_RESTART:-0}" = "1" ]; then
  echo ""
  echo "[CAN LAM] Backend chua biet secret moi -> restart 1 lan de nhan:"
  echo "           cd $PROD_DIR && docker compose restart backend"
fi
