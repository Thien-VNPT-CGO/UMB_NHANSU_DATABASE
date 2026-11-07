#!/usr/bin/env bash
set -euo pipefail
# Backup PostgreSQL -> .sql.gz lên Drive (P2, VPS_DataBase_Sheet.md Prompt 2)
# Chạy từ cron mỗi ngày 02:00 VN, ngoài backup JSONL 4 tầng hiện có.
# Cần: pg_dump (postgresql-client), gzip, rclone hoặc gsutil cho Drive.
# Biến môi trường lấy từ apps/backend/.env hoặc deploy/vps/.env.vps
set -a
# shellcheck disable=SC1091
[ -f ./apps/backend/.env ] && . ./apps/backend/.env
set +a

DB_URL="${DATABASE_URL:-postgresql://ubm:${POSTGRES_PASSWORD:-}@postgres:5432/${POSTGRES_DB:-ubm_hr}}"
DATE_STR="$(TZ=Asia/Ho_Chi_Minh date +%F)"
OUT_DIR="${BACKUP_SQL_DIR:-data/backups/sql}"
mkdir -p "$OUT_DIR"
FILE="$OUT_DIR/postgres_${DATE_STR}.sql.gz"
TMP="$(mktemp)"

echo "[backup-sql] pg_dump -> $FILE"
pg_dump "$DB_URL" --no-owner --no-acl --clean --if-exists | gzip > "$TMP"
mv "$TMP" "$FILE"
SIZE="$(stat -c%s "$FILE" 2>/dev/null || stat -f%z "$FILE" 2>/dev/null || echo 0)"
echo "[backup-sql] size=${SIZE} bytes"

# Đẩy lên Drive bằng rclone (khuyến nghị, xem ý tưởng Rclone ở báo cáo)
if command -v rclone >/dev/null 2>&1; then
  REMOTE="${RCLONE_REMOTE:-gdrive:UBM_BACKUP/sql}"
  rclone copyto "$FILE" "${REMOTE}/postgres_${DATE_STR}.sql.gz" --transfers 2
  echo "[backup-sql] uploaded to ${REMOTE}/postgres_${DATE_STR}.sql.gz"
else
  echo "[backup-sql] rclone not found — file kept locally at $FILE (install rclone to push Drive)"
fi

# Dọn bản local cũ hơn 30 ngày
find "$OUT_DIR" -name "postgres_*.sql.gz" -mtime +30 -delete || true
