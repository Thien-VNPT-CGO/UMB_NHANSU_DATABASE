#!/usr/bin/env bash
# Thêm location /harasocial/ vào Nginx (proxy sang HaraSocial Monitor cổng 3010).
# Chạy trên VPS: sudo bash deploy/vps/fix-harasocial-nginx.sh
set -euo pipefail

CONF="/etc/nginx/sites-available/ubm"
[ -f "$CONF" ] || { echo "Khong tim thay $CONF"; exit 1; }

if grep -q "location /harasocial/" "$CONF"; then
  echo "Nginx da co /harasocial/ - bo qua"
  exit 0
fi

python3 - "$CONF" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text()
block = """
  # ---------- HaraSocial Zalo Alert (app riêng, cổng 3010) ----------
  # Dùng proxy_buffering off để SSE /harasocial/api/stream chạy realtime.
  location = /harasocial {
    return 301 /harasocial/;
  }
  location /harasocial/ {
    proxy_pass http://127.0.0.1:3010/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Prefix /harasocial;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
  }

"""
marker = "location / {"
index = text.find(marker)
if index < 0:
    sys.exit('Khong tim thay "location / {" trong cau hinh nginx')
path.write_text(text[:index] + block + text[index:])
PY

nginx -t
systemctl reload nginx
echo "Da them /harasocial/ va reload nginx"
