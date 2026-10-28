#!/usr/bin/env bash
# ==============================================================
# SCRIPT CHẠY SAO LƯU HỆ THỐNG VPS LÊN GOOGLE DRIVE (CHO CRON)
# ==============================================================
set -uo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

# Tìm thư mục chứa mã nguồn repo
POSSIBLE_DIRS=(
  "$HOME/ubm-vps"
  "/root/ubm-vps"
  "/home/ubuntu/ubm-vps"
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
  echo "$(date '+%Y-%m-%d %H:%M:%S') [Backup] LỖI: Không tìm thấy thư mục dự án UBM!" >> /var/log/ubm-backup.log 2>&1
  exit 1
fi

cd "$PROJECT_DIR"

echo "$(date '+%Y-%m-%d %H:%M:%S') [Backup] Bắt đầu chạy sao lưu từ thư mục $PROJECT_DIR..." >> /var/log/ubm-backup.log 2>&1

node scripts/backup-system-to-drive.cjs >> /var/log/ubm-backup.log 2>&1

EXIT_CODE=$?
if [ $EXIT_CODE -eq 0 ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') [Backup] Sao lưu thành công!" >> /var/log/ubm-backup.log 2>&1
else
  echo "$(date '+%Y-%m-%d %H:%M:%S') [Backup] Sao lưu THẤT BẠI (exit code: $EXIT_CODE)!" >> /var/log/ubm-backup.log 2>&1
fi

exit $EXIT_CODE
