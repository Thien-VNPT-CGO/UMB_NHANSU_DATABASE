#!/usr/bin/env bash
# ==============================================================
# UBM BACKUP HẰNG NGÀY (prod, cron host gọi; backend tự dedupe)
# --------------------------------------------------------------
# Cron chạy mỗi giờ — tick đầu tiên sau nửa đêm VN sẽ chạy thật,
# các tick còn lại bị backend skip (ALREADY_BACKED_UP_TODAY).
# Lỗi → backend thông báo Admin + cron thử lại giờ sau.
# Cài đặt: sudo bash deploy/vps/install-backup.sh
# Gỡ:      sudo bash deploy/vps/install-backup.sh --off
# Log: /var/log/ubm-backup.log
# ==============================================================
set -uo pipefail

REPO_DIR="${PROD_DIR:-$HOME/ubm-vps}"
ENV_FILE="$REPO_DIR/apps/backend/.env"

SECRET="$(grep -E '^INTERNAL_ALERT_SECRET=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')"
if [ -z "$SECRET" ]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [skip] .env chua co INTERNAL_ALERT_SECRET (chay install-backup.sh truoc)"
  exit 0
fi

RESULT="$(curl -fsS -m 600 -X POST "http://localhost:4005/internal/backup-run" \
  -H "Content-Type: application/json" \
  -H "x-internal-secret: $SECRET" \
  -d '{}' 2>&1 || true)"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup-run -> ${RESULT:-KHONG_PHAN_HOI}"

# Đồng bộ ảnh chấm công hằng ngày lên Drive (backend tự dedupe theo ngày VN).
PHOTOS="$(curl -fsS -m 900 -X POST "http://localhost:4005/internal/photos-backup-run" \
  -H "Content-Type: application/json" \
  -H "x-internal-secret: $SECRET" \
  -d '{}' 2>&1 || true)"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) photos-backup-run -> ${PHOTOS:-KHONG_PHAN_HOI}"

# Backup THÁNG: backend chỉ chạy thật từ 09:00 ngày 5 (hoặc bù ngày 6+);
# các tick khác trả NOT_DUE_YET / ALREADY_BACKED_UP_MONTH.
MONTHLY="$(curl -fsS -m 1800 -X POST "http://localhost:4005/internal/monthly-backup-run" \
  -H "Content-Type: application/json" \
  -H "x-internal-secret: $SECRET" \
  -d '{}' 2>&1 || true)"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) monthly-backup-run -> ${MONTHLY:-KHONG_PHAN_HOI}"
