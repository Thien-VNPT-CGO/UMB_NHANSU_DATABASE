#!/usr/bin/env bash
# ==============================================================
# BẬT GZIP cho Nginx của UBM (idempotent — chạy nhiều lần không đúp).
#
# Vì sao: bundle admin ~1MB và employee ~vài trăm KB đang được Nginx trả
# KHÔNG nén (không có header Content-Encoding). Bật gzip giảm ~75% dung
# lượng truyền → cổng quản trị/nhân viên mở nhanh hơn nhiều trên 3G/4G.
#
# Chạy trên VPS:  sudo bash deploy/vps/fix-gzip-nginx.sh
# Script tự `nginx -t`; nếu config sai thì KHÔI PHỤC bản backup và không reload.
# Đánh dấu block chèn: # UBM-GZIP
# ==============================================================
set -euo pipefail

CONF="${1:-/etc/nginx/sites-available/ubm}"
MARK="# UBM-GZIP"

[ -f "$CONF" ] || { echo "Không thấy $CONF — chỉ định đường dẫn config Nginx thật: sudo bash $0 /etc/nginx/nginx.conf"; exit 1; }

if grep -q "UBM-GZIP" "$CONF"; then
  echo "[OK] Config đã có block gzip của UBM — không cần sửa ($CONF)."
  exit 0
fi
if grep -qE '^[[:space:]]*gzip[[:space:]]+on;' "$CONF"; then
  echo "[OK] Config đã bật 'gzip on;' — không cần sửa ($CONF)."
  exit 0
fi

# Chèn vào MỌI server block (sau certbot có 2 block: 80 redirect + 443).
# gzip hợp lệ ở http/server/location; chèn cả 2 để chắc chắn block HTTPS có.
TMP="$(mktemp)"
awk -v mark="$MARK" '
  /^[[:space:]]*server[[:space:]]*\{/ {
    print
    print "  " mark " > Bắt đầu: nén gzip cho static/API"
    print "  gzip on;"
    print "  gzip_comp_level 5;"
    print "  gzip_min_length 1024;"
    print "  gzip_vary on;"
    print "  gzip_proxied any;"
    print "  gzip_types text/plain text/css text/xml application/javascript application/json application/xml application/manifest+json image/svg+xml;"
    print "  " mark " < Kết thúc"
    inserted = 1
    next
  }
  { print }
' "$CONF" > "$TMP"

if ! grep -q "UBM-GZIP" "$TMP"; then
  echo "KHÔNG tìm thấy 'server {' trong $CONF — sửa tay theo deploy/vps/nginx/ubm.conf."
  rm -f "$TMP"
  exit 1
fi

BAK="$CONF.bak.$(date +%Y%m%d%H%M%S)"
cp "$CONF" "$BAK"
cp "$TMP" "$CONF"
rm -f "$TMP"

if ! nginx -t; then
  echo "[LOI] nginx -t that bai — khoi phuc $BAK"
  cp "$BAK" "$CONF"
  exit 1
fi

systemctl reload nginx
echo "[OK] Đã bật gzip trong $CONF (backup: $BAK)."
echo "Kiểm tra: curl -sI -H 'Accept-Encoding: gzip' https://umbomilk-nhansu-diemdanh.duckdns.org/admin/assets/<file>.js | grep -i content-encoding"
