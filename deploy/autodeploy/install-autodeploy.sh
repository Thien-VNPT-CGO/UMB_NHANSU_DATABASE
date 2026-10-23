#!/usr/bin/env bash
# ==============================================================
# CAI DAT / GO BO AUTO-DEPLOY tren VPS (chay 1 lan tren VPS)
# --------------------------------------------------------------
# Cai dat (trong folder repo tren VPS, co nhanh moi nhat):
#   sudo bash deploy/autodeploy/install-autodeploy.sh
# Go bo:
#   sudo bash deploy/autodeploy/install-autodeploy.sh --off
#
# Sau khi cai: cron chay moi phut, tu dong kiem tra GitHub nhanh
# `vps` — commit moi -> tu deploy prod (cong 4005).
# (Moi truong beta da bo ngay 2026-10-20 — ban watcher cu co beta
#  se duoc thay bang ban moi nay tu dong khi chay install lai.)
# Log: /var/log/ubm-autodeploy.log
# ==============================================================
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="/opt/ubm/bin"
LOG_FILE="/var/log/ubm-autodeploy.log"
CRON_FILE="/etc/cron.d/ubm-autodeploy"

REPO_ROOT="$(cd "$SRC/../.." && pwd)"
# Thu muc repo prod tren VPS (tu dong nhan dien thu muc goc chua script):
PROD_DIR="${PROD_DIR:-$REPO_ROOT}"

if [ "${1:-}" = "--off" ]; then
  rm -f "$CRON_FILE"
  echo "[OK] Da go bo auto-deploy (xoa $CRON_FILE)."
  exit 0
fi

[ "$(id -u)" -eq 0 ] || { echo "Can chay voi sudo/root."; exit 1; }

mkdir -p "$BIN_DIR"
install -m 0755 "$SRC/autodeploy.sh" "$BIN_DIR/autodeploy.sh"

# Ghi cau hinh thu muc ngay trong ban cai dat (theo user chay install):
sed -i "s|^PROD_DIR=.*|PROD_DIR=\"$PROD_DIR\"|" "$BIN_DIR/autodeploy.sh"

cat > "$CRON_FILE" <<EOF
# UBM auto-deploy watcher prod (go bo = xoa file nay)
* * * * * root PROD_DIR="$PROD_DIR" /usr/bin/flock -n /tmp/ubm-autodeploy.lock $BIN_DIR/autodeploy.sh >> $LOG_FILE 2>&1
EOF
chmod 0644 "$CRON_FILE"
touch "$LOG_FILE"; chmod 0644 "$LOG_FILE"

echo "[OK] Da cai auto-deploy (PROD chi):"
echo "     - Cron moi phut: $CRON_FILE"
echo "     - Prod dir: $PROD_DIR (nhanh vps, cong 4005)"
echo "     - Log: tail -f $LOG_FILE"
