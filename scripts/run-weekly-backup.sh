#!/usr/bin/env bash
# ==============================================================
# SCRIPT CHẠY SAO LƯU HỆ THỐNG VPS LÊN GOOGLE DRIVE (CHO CRON)
# ==============================================================
set -uo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

POSSIBLE_DIRS=(
  "/ubm-vps"
  "$HOME/ubm-vps"
  "/root/ubm-vps"
  "$(pwd)"
  "$(dirname "$0")/.."
)

PROJECT_DIR=""
for dir in "${POSSIBLE_DIRS[@]}"; do
  if [ -f "$dir/apps/backend/package.json" ]; then
    PROJECT_DIR="$dir"
    break
  fi
done

if [ -z "$PROJECT_DIR" ]; then
  echo "[Backup] LỖI: Không tìm thấy thư mục dự án UBM!" | tee -a /var/log/ubm-backup.log
  exit 1
fi

cd "$PROJECT_DIR"

echo "--------------------------------------------------------" | tee -a /var/log/ubm-backup.log
echo "$(date '+%Y-%m-%d %H:%M:%S') [Backup] Bắt đầu chạy sao lưu từ thư mục $PROJECT_DIR..." | tee -a /var/log/ubm-backup.log

node scripts/backup-system-to-drive.cjs 2>&1 | tee -a /var/log/ubm-backup.log

EXIT_CODE=${PIPESTATUS[0]}
if [ $EXIT_CODE -eq 0 ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') [Backup] Sao lưu thành công!" | tee -a /var/log/ubm-backup.log
else
  echo "$(date '+%Y-%m-%d %H:%M:%S') [Backup] Sao lưu THẤT BẠI (exit code: $EXIT_CODE)!" | tee -a /var/log/ubm-backup.log
fi

exit $EXIT_CODE
