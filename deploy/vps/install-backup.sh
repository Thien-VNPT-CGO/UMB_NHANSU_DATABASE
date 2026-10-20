#!/usr/bin/env bash
# ==============================================================
# CAI DAT / GO BO BACKUP TU DONG UBM (chay 1 lan tren VPS)
# --------------------------------------------------------------
# Cai dat: sudo bash deploy/vps/install-backup.sh
# Go bo:   sudo bash deploy/vps/install-backup.sh --off
#
# Lam gi:
#   - Cron moi GIO goi /internal/backup-run (backend copy spreadsheet
#     ra Drive — 1 backup/ngay, gio nao chay duoc thi coi nhu ngay do)
#   - Tai du lieu cu >30 ngay bi tu xoa (env BACKUP_RETENTION_DAYS)
#   - Su dung lai INTERNAL_ALERT_SECRET da sinh boi install-watchdog.sh
#     (neu chua co thi sinh moi + can restart backend 1 lan)
# Log: /var/log/ubm-backup.log
# ==============================================================
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="/opt/ubm/bin"
LOG_FILE="/var/log/ubm-backup.log"
CRON_FILE="/etc/cron.d/ubm-backup"
PROD_DIR="${PROD_DIR:-$HOME/ubm-vps}"

if [ "${1:-}" = "--off" ]; then
  rm -f "$CRON_FILE"
  echo "[OK] Da go bo backup cron (xoa $CRON_FILE)."
  exit 0
fi

[ "$(id -u)" -eq 0 ] || { echo "Can chay voi sudo/root."; exit 1; }
[ -f "$PROD_DIR/apps/backend/.env" ] || { echo "THIEU $PROD_DIR/apps/backend/.env — deploy prod chua chay lan nao?"; exit 1; }

# Dam bao co INTERNAL_ALERT_SECRET (watchdog da sinh roi thi dung lai)
if ! grep -qE '^INTERNAL_ALERT_SECRET=' "$PROD_DIR/apps/backend/.env"; then
  SECRET="$(openssl rand -hex 24 2>/dev/null || head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  echo "" >> "$PROD_DIR/apps/backend/.env"
  echo "INTERNAL_ALERT_SECRET=$SECRET" >> "$PROD_DIR/apps/backend/.env"
  echo "[LUU Y] Da sinh secret moi — restart backend 1 lan: cd $PROD_DIR && docker compose restart backend"
fi

mkdir -p "$BIN_DIR"
install -m 0755 "$SRC/backup.sh" "$BIN_DIR/backup.sh"
sed -i "s|^REPO_DIR=.*|REPO_DIR=\"$PROD_DIR\"|" "$BIN_DIR/backup.sh"

cat > "$CRON_FILE" <<EOF
# UBM backup hang ngay (go bo = xoa file nay) — backend tu dedupe theo ngay VN
7 * * * * root PROD_DIR="$PROD_DIR" /usr/bin/flock -n /tmp/ubm-backup.lock $BIN_DIR/backup.sh >> $LOG_FILE 2>&1
EOF
chmod 0644 "$CRON_FILE"
touch "$LOG_FILE"; chmod 0644 "$LOG_FILE"

echo "[OK] Da cai backup tu dong:"
echo "     - Cron moi gio (tick 07 phut): $CRON_FILE"
echo "     - Backup ngay dau tien se chay o gio tiep theo"
echo "     - Kiem tra thu cong ngay: sudo $BIN_DIR/backup.sh"
echo "     - Log: tail -f $LOG_FILE"
