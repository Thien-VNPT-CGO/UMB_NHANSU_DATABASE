#!/usr/bin/env bash
# ==============================================================
# SCRIPT SAO LƯU TOÀN BỘ HỆ THỐNG VPS UBM
# ==============================================================
# Tự động nén toàn bộ cấu hình .env, data, mã nguồn và snapshot
# vào thư mục lưu trữ an toàn /var/backups/ubm-system/
# Tự động xoá các bản sao lưu cũ quá 30 ngày.
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

BACKUP_DIR="/var/backups/ubm-system"
mkdir -p "$BACKUP_DIR"
mkdir -p /var/log

DATE_STR="$(date '+%Y-%m-%d_%H%M%S')"
ARCHIVE_NAME="UBM_VPS_BACKUP_${DATE_STR}.tar.gz"
ARCHIVE_PATH="${BACKUP_DIR}/${ARCHIVE_NAME}"

echo "==========================================================" | tee -a /var/log/ubm-backup.log
echo "$(date '+%Y-%m-%d %H:%M:%S') [Backup] Bắt đầu sao lưu hệ thống VPS UBM..." | tee -a /var/log/ubm-backup.log
echo "[Backup] Thư mục nguồn: $PROJECT_DIR" | tee -a /var/log/ubm-backup.log
echo "[Backup] Đang nén các thành phần cốt lõi (.env, data, mã nguồn)..." | tee -a /var/log/ubm-backup.log

# Nén hệ thống loại trừ các file rác build / node_modules để dung lượng siêu nhẹ (~5-10MB)
tar -czf "$ARCHIVE_PATH" \
  --exclude="node_modules" \
  --exclude=".git/objects" \
  --exclude="*.log" \
  --exclude="dist" \
  --exclude="coverage" \
  -C "$PROJECT_DIR" .

SIZE_MB="$(du -sh "$ARCHIVE_PATH" | cut -f1)"

echo "[Backup] ✅ ĐÃ TẠO BẢN SAO LƯU THÀNH CÔNG!" | tee -a /var/log/ubm-backup.log
echo "[Backup] Đường dẫn: $ARCHIVE_PATH ($SIZE_MB)" | tee -a /var/log/ubm-backup.log

# Dọn dẹp các bản sao lưu cũ quá 30 ngày
echo "[Backup] Đang dọn dẹp các bản sao lưu cũ quá 30 ngày..." | tee -a /var/log/ubm-backup.log
find "$BACKUP_DIR" -type f -name "UBM_VPS_BACKUP_*.tar.gz" -mtime +30 -exec rm -f {} \;

REMAINING_COUNT="$(ls -1 "$BACKUP_DIR"/UBM_VPS_BACKUP_*.tar.gz 2>/dev/null | wc -l)"
echo "[Backup] Tổng số bản sao lưu an toàn đang lưu trữ: $REMAINING_COUNT bản." | tee -a /var/log/ubm-backup.log
echo "==========================================================" | tee -a /var/log/ubm-backup.log

exit 0
