#!/usr/bin/env bash
# Cong xu ly vi pham (/violations/) la mot web app RIENG, publish tai
# /opt/ubm/violation-web. Neu Nginx thieu block location /violations/ thi
# request se roi vao SPA cong nhan vien (location /) va tra ve sai ung dung.
#
# Script nay chen block routing con thieu vao Nginx config (idempotent):
#   sudo bash deploy/vps/fix-violations-nginx.sh [duong-dan-config]
set -euo pipefail

CONF="${1:-/etc/nginx/sites-available/ubm}"
if [ ! -f "$CONF" ]; then
  echo "[SKIP] Khong tim thay Nginx config: $CONF"
  exit 0
fi

if grep -q 'location /violations/' "$CONF"; then
  echo "[OK] Da co block /violations/ trong Nginx — khong can sua ($CONF)."
  exit 0
fi

cp "$CONF" "$CONF.bak-violations-$(date +%Y%m%d%H%M%S)"

python3 - "$CONF" <<'PY'
import sys

path = sys.argv[1]
with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

block = """  # ---------- Cong xu ly vi pham (web app rieng, base /violations/) ----------
  location = /violations {
    return 301 /violations/;
  }
  location /violations/assets/ {
    alias /opt/ubm/violation-web/assets/;
    expires 7d;
    add_header Cache-Control "public, immutable";
  }
  location /violations/ {
    alias /opt/ubm/violation-web/;
    index index.html;
    try_files $uri $uri/ /violations/index.html;
    add_header Cache-Control "no-cache";
  }
"""

needles = ["  location = /public/interview/rsvp {", "  location / {"]
for needle in needles:
    if needle in src:
        src = src.replace(needle, block + needle, 1)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(src)
        print("[OK] Da chen block /violations/ truoc '%s'" % needle.strip())
        break
else:
    sys.stderr.write("[FAIL] Khong tim thay vi tri de chen block /violations/\n")
    sys.exit(1)
PY

nginx -t
nginx -s reload
echo "[OK] Nginx da reload voi block /violations/."
