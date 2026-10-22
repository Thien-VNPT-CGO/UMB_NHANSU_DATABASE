#!/usr/bin/env bash
# Cài các location CỔNG DEMO (/demo/ NV + /demo-admin/) vào config Nginx đang
# chạy trên VPS — IDEMPOTENT (chạy nhiều lần không đap lặp).
#   sudo bash deploy/vps/install-demo-nginx.sh [duong-dan-config]
# Mặc định: /etc/nginx/sites-available/ubm
set -euo pipefail

CONF="${1:-/etc/nginx/sites-available/ubm}"
[ -f "$CONF" ] || { echo "Không thấy $CONF — chỉ định đường dẫn config Nginx thật: sudo bash $0 /etc/nginx/nginx.conf"; exit 1; }

if grep -q "location /demo-admin/" "$CONF" && grep -q "location /demo/" "$CONF"; then
  echo "[OK] Config đã có block DEMO /demo/ + /demo-admin/ — không cần sửa ($CONF)."
  exit 0
fi

if ! grep -q "location /admin/" "$CONF"; then
  echo "KHÔNG tìm thấy mốc 'location /admin/' trong $CONF — config khác bản mẫu, sửa tay theo deploy/vps/nginx/ubm.conf."
  exit 1
fi

TMP="$(mktemp)"
awk '
  /location \/admin\// && !inserted {
    print "  # ---------- Cổng DEMO quan tri (CHI XEM — backend chặn ghi qua header demo) ----------"
    print "  location /demo-admin/ {"
    print "    alias /opt/ubm/admin-web-demo/;"
    print "    index index.html;"
    print "    try_files $uri $uri/ /demo-admin/index.html;"
    print "  }"
    print "  location /demo-admin/assets/ {"
    print "    alias /opt/ubm/admin-web-demo/assets/;"
    print "    expires 7d;"
    print "    add_header Cache-Control \"public, immutable\";"
    print "  }"
    print ""
    print "  # ---------- Cổng DEMO nhan vien (CHI XEM) ----------"
    print "  location /demo/ {"
    print "    alias /opt/ubm/employee-web-demo/;"
    print "    index index.html;"
    print "    try_files $uri $uri/ /demo/index.html;"
    print "  }"
    print "  location /demo/assets/ {"
    print "    alias /opt/ubm/employee-web-demo/assets/;"
    print "    expires 7d;"
    print "    add_header Cache-Control \"public, immutable\";"
    print "  }"
    print ""
    inserted = 1
  }
  { print }
' "$CONF" > "$TMP"

sudo cp "$CONF" "$CONF.bak.$(date +%Y%m%d%H%M%S)" || true
sudo cp "$TMP" "$CONF"
sudo nginx -t
sudo systemctl reload nginx
rm -f "$TMP"
echo ""
echo "[OK] Đã thêm location /demo/ + /demo-admin/ vào $CONF (backup tại $CONF.bak.*)."
