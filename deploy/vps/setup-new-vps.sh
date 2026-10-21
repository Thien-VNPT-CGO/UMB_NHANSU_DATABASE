#!/usr/bin/env bash
# ==============================================================
# SCRIPT THIẾT LẬP TỰ ĐỘNG TOÀN DIỆN CHO VPS MỚI (Ubuntu 22/24)
# IP VPS: 103.167.89.125
# Domain: https://umbomilk-nhansu-diemdanh.duckdns.org
# Chạy trên VPS: bash deploy/vps/setup-new-vps.sh
# ==============================================================
set -euo pipefail

echo "=========================================================="
echo "==> 1. Cập nhật hệ điều hành & cài đặt công cụ cơ bản"
echo "=========================================================="
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg ufw git nginx certbot python3-certbot-nginx

echo "=========================================================="
echo "==> 2. Mở cổng tường lửa UFW (22, 80, 443)"
echo "=========================================================="
sudo ufw allow 22/tcp || true
sudo ufw allow 80/tcp || true
sudo ufw allow 443/tcp || true
sudo ufw --force enable || true

echo "=========================================================="
echo "==> 3. Cài đặt Node.js 20 (LTS)"
echo "=========================================================="
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi
echo "Node version: $(node -v)"
echo "NPM version:  $(npm -v)"

echo "=========================================================="
echo "==> 4. Cài đặt Docker & Docker Compose"
echo "=========================================================="
if ! command -v docker &> /dev/null; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt update
  sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER" || true
fi
docker --version
docker compose version

echo "=========================================================="
echo "==> 5. Cấu hình Nginx cho domain DuckDNS"
echo "=========================================================="
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
sudo cp deploy/vps/nginx/ubm.conf /etc/nginx/sites-available/ubm
sudo ln -sf /etc/nginx/sites-available/ubm /etc/nginx/sites-enabled/ubm
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

echo "=========================================================="
echo "==> 6. Cấp chứng chỉ SSL HTTPS (Let's Encrypt)"
echo "=========================================================="
sudo certbot --nginx -d umbomilk-nhansu-diemdanh.duckdns.org --non-interactive --agree-tos --register-unsafely-without-email --redirect || {
  echo "Lưu ý certbot: Nếu certbot chưa lấy được SSL ngay, hãy chạy lại lệnh:"
  echo "sudo certbot --nginx -d umbomilk-nhansu-diemdanh.duckdns.org"
}

echo ""
echo "=========================================================="
echo "THIẾT LẬP HẠ TẦNG VPS THÀNH CÔNG!"
echo "Bước tiếp theo:"
echo "1. Đảm bảo file apps/backend/.env đã có dữ liệu Google Service Account"
echo "2. Chạy deploy: bash deploy/vps/deploy.sh"
echo "=========================================================="
