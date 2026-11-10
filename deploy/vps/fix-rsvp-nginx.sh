#!/usr/bin/env bash
# Link xac nhan phong van CU (/public/interview/rsvp...) do SPA cong nhan vien
# phuc vu nen truoc day roi vao form dang nhap SDT. Chen redirect 302 sang API
# cong khai cua backend (/api/public/interview/rsvp) de link da gui trong Zalo
# van mo dung bang xac nhan cua ung vien, khong can dang nhap.
#
# Idempotent: chay lai nhieu lan khong chen trung. Dung:
#   sudo bash deploy/vps/fix-rsvp-nginx.sh [duong-dan-config]
set -euo pipefail

CONF="${1:-/etc/nginx/sites-available/ubm}"
if [ ! -f "$CONF" ]; then
  echo "[SKIP] Khong tim thay Nginx config: $CONF"
  exit 0
fi

if grep -q 'location = /public/interview/rsvp' "$CONF"; then
  echo "[OK] Da co redirect RSVP cong khai — khong can sua ($CONF)."
  exit 0
fi

cp "$CONF" "$CONF.bak-rsvp-$(date +%Y%m%d%H%M%S)"

python3 - "$CONF" <<'PY'
import sys

path = sys.argv[1]
with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

block = """  # Link xac nhan phong van cu (SPA nhan vien) -> API cong khai backend.
  location = /public/interview/rsvp {
    return 302 /api/public/interview/rsvp$is_args$args;
  }
"""

needle = "  location / {"
if needle not in src:
    sys.stderr.write("[FAIL] Khong tim thay 'location / {' de chen redirect RSVP\n")
    sys.exit(1)

src = src.replace(needle, block + needle, 1)
with open(path, 'w', encoding='utf-8') as f:
    f.write(src)
print("[OK] Da chen redirect /public/interview/rsvp -> /api/public/interview/rsvp")
PY

nginx -t
nginx -s reload
echo "[OK] Nginx da reload voi redirect RSVP cong khai."
