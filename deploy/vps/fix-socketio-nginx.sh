#!/usr/bin/env bash
# ==============================================================
# SỬA NGAY: WebSocket realtime chết qua Nginx "Unexpected response
# code: 200" — client Socket.IO gọi /socket.io/ (path mặc định, không
# kèm /api) nhưng Nginx chỉ proxy /api/ nên WS trả về HTML 200 thay
# vì bắt tay 101. Script này chèn block location /socket.io/ vào
# config Nginx đang chạy (idempotent — chạy nhiều lần không đúp).
#
# Chạy trên VPS:  sudo bash deploy/vps/fix-socketio-nginx.sh
# Sau đó kiểm tra realtime vẫn sống: mở cổng admin/F5 xem console.
# Log/undo: block gốc giữ nguyên, dòng chèn đánh dấu # UBM-SOCKETIO
# ==============================================================
set -euo pipefail

CONF="${1:-/etc/nginx/sites-available/ubm}"
MARK="# UBM-SOCKETIO"

[ -f "$CONF" ] || { echo "Không thấy $CONF — chỉ định đường dẫn config Nginx thật: sudo bash $0 /etc/nginx/nginx.conf"; exit 1; }

if grep -q "location /socket.io/" "$CONF"; then
  echo "[OK] Config đã có block /socket.io/ — không cần sửa ($CONF)."
  exit 0
fi

# Chèn block VÀO TRƯỚC block location /admin/ (trong server block)
if ! grep -q "location /admin/" "$CONF"; then
  echo "KHÔNG tìm thấy mốc 'location /admin/' trong $CONF — config khác bản mẫu, sửa tay theo deploy/vps/nginx/ubm.conf."
  exit 1
fi

TMP="$(mktemp)"
awk -v mark="$MARK" '
  /location \/admin\// && !inserted {
    print mark " > Bắt đầu: proxy WebSocket Socket.IO (path mặc định /socket.io/ không kèm /api)"
    print "  location /socket.io/ {"
    print "    proxy_pass http://ubm_backend;"
    print "    proxy_http_version 1.1;"
    print "    proxy_set_header Upgrade $http_upgrade;"
    print "    proxy_set_header Connection $connection_upgrade;"
    print "    proxy_set_header Host $host;"
    print "    proxy_set_header X-Real-IP $remote_addr;"
    print "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;"
    print "    proxy_set_header X-Forwarded-Proto $scheme;"
    print "    proxy_read_timeout 75s;"
    print "    proxy_send_timeout 75s;"
    print "  }"
    print mark " < Kết thúc"
    inserted = 1
  }
  { print }
' "$CONF" > "$TMP"

# Chỉ áp dụng khi $connection_upgrade đã được define trong file (map $http_upgrade)
if ! grep -q 'map \$http_upgrade' "$CONF"; then
  echo "CẢNH BÁO: chưa thấy 'map \$http_upgrade $connection_upgrade' trong $CONF — chèn luôn lên đầu file."
  { echo 'map $http_upgrade $connection_upgrade {'; echo '  default upgrade;'; echo "  ''      close;"; echo '}'; echo ''; cat "$TMP"; } > "$TMP.new"
  mv "$TMP.new" "$TMP"
fi

sudo cp "$CONF" "$CONF.bak.$(date +%Y%m%d%H%M%S)" || true
sudo cp "$TMP" "$CONF"
sudo nginx -t
sudo systemctl reload nginx
rm -f "$TMP"
echo ""
echo "[OK] Đã chèn location /socket.io/ vào $CONF (backup tại $CONF.bak.*)."
echo "Kiểm tra: mở cổng Admin/NV, console không còn 'Unexpected response code: 200'."
