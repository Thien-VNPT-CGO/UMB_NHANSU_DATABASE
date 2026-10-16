#!/usr/bin/env bash
# Deploy ban VPS (nhanh vps). Chay tren VPS, khong push di dau.
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "==> 1. Lay code moi nhat nhanh vps"
git fetch origin vps 2>/dev/null || true
git checkout vps
git pull --ff-only 2>/dev/null || true

echo "==> 2. Build frontend voi API cua VPS (doi API_DOMAIN truoc khi chay)"
API_DOMAIN="${API_DOMAIN:?Khai bao API_DOMAIN, vd API_DOMAIN=api.ten-mien-cua-ban}"
VITE_API_URL="https://${API_DOMAIN}" npm run build:admin
VITE_API_URL="https://${API_DOMAIN}" npm run build:employee

echo "==> 3. Publish static cho Nginx"
sudo mkdir -p /opt/ubm/admin-web /opt/ubm/employee-web
sudo rm -rf /opt/ubm/admin-web/* /opt/ubm/employee-web/*
sudo cp -r apps/admin-web/dist/* /opt/ubm/admin-web/
sudo cp -r apps/employee-web/dist/* /opt/ubm/employee-web/

echo "==> 4. Build + chay backend (Docker)"
test -f apps/backend/.env || { echo "THIEU apps/backend/.env (copy tu deploy/vps/.env.vps.example)"; exit 1; }
docker compose up --build -d

echo "==> 5. Kiem tra suc khoe"
sleep 8
curl -fsS http://localhost:4005/health | head -c 300; echo
echo "XONG. Mo https://${API_DOMAIN}/health de kiem tra."
