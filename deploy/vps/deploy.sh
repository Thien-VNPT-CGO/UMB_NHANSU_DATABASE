#!/usr/bin/env bash
# Deploy ban VPS (nhanh vps). Chay tren VPS, khong push di dau.
# Domain: https://umbomilk-nhansu-diemdanh.duckdns.org/
#   /          -> cong nhan vien
#   /admin/    -> cong quan tri
#   /api/      -> backend API + Socket.IO
set -euo pipefail
cd "$(dirname "$0")/../.."

API_BASE="https://umbomilk-nhansu-diemdanh.duckdns.org/api"

echo "==> 1. Lay code moi nhat nhanh vps"
git fetch origin vps 2>/dev/null || true
git checkout vps
git pull --ff-only 2>/dev/null || true

echo "==> 2. Build 2 web tro ve API VPS (${API_BASE})"
export GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "")
node apps/backend/scripts/gen-version.cjs 2>/dev/null || true

if [ ! -d "node_modules" ] || [ ! -f "node_modules/.bin/tsc" ]; then
  echo "==> Phat hien thieu node_modules tren VPS moi -> Dang chay npm ci..."
  npm ci
fi

# Dam bao node_modules/.bin luon co mat trong PATH cho moi sub-script
export PATH="$(pwd)/node_modules/.bin:$PATH"

echo "==> Build @ubm/shared..."
npm run build:shared

VITE_API_URL="${API_BASE}" npm run build:admin
VITE_API_URL="${API_BASE}" npm run build:employee

echo "==> 3. Publish static cho Nginx"
sudo mkdir -p /opt/ubm/admin-web /opt/ubm/employee-web
sudo rm -rf /opt/ubm/admin-web/* /opt/ubm/employee-web/*
sudo cp -r apps/admin-web/dist/* /opt/ubm/admin-web/
sudo cp -r apps/employee-web/dist/* /opt/ubm/employee-web/

echo "==> 4. Build + chay backend (Docker)"
test -f apps/backend/.env || { echo "THIEU apps/backend/.env (copy tu deploy/vps/.env.vps.example)"; exit 1; }
export GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "")
docker compose up --build -d

echo "==> 5. Dam bao Nginx proxy Socket.IO"
if [ -f "deploy/vps/fix-socketio-nginx.sh" ]; then
  sudo bash deploy/vps/fix-socketio-nginx.sh || true
fi

echo "==> 6. Kiem tra suc khoe"
sleep 8
curl -fsS http://localhost:4005/health | head -c 300; echo
echo "XONG:"
echo "  NV:    https://umbomilk-nhansu-diemdanh.duckdns.org/"
echo "  Admin: https://umbomilk-nhansu-diemdanh.duckdns.org/admin/"
echo "  API:   https://umbomilk-nhansu-diemdanh.duckdns.org/api/health"
