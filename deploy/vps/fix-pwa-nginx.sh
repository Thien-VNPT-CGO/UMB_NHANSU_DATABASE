#!/usr/bin/env bash
# ==============================================================
# ĐẢM BẢO NGINX PHỤC VỤ PWA VÀ ICON CHUẨN TRÊN VPS (idempotent)
#
# 1. Thêm MIME type "application/manifest+json webmanifest;" vào /etc/nginx/mime.types
#    để Chrome/Android PWA nhận diện đúng manifest không bị fallback thành chữ U.
# 2. Đảm bảo nginx reload cấu hình mới nhất.
# ==============================================================
set -euo pipefail

# 1. Bổ sung mime type cho .webmanifest nếu chưa có
MIME_FILE="/etc/nginx/mime.types"
if [ -f "$MIME_FILE" ]; then
  if ! grep -q "application/manifest+json" "$MIME_FILE"; then
    echo "==> Bổ sung application/manifest+json vào $MIME_FILE..."
    sudo sed -i '/types {/a \    application/manifest+json             webmanifest;' "$MIME_FILE"
  else
    echo "[OK] $MIME_FILE đã hỗ trợ application/manifest+json."
  fi
fi

# 2. Kiểm tra cú pháp nginx và reload
if command -v nginx &> /dev/null; then
  echo "==> Kiểm tra cấu hình Nginx..."
  if sudo nginx -t >/dev/null 2>&1; then
    sudo systemctl reload nginx 2>/dev/null || sudo nginx -s reload 2>/dev/null || true
    echo "[OK] Nginx reload thành công."
  else
    echo "[CẢNH BÁO] Nginx test không vượt qua, giữ nguyên không reload."
    sudo nginx -t || true
  fi
fi
