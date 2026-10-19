#!/usr/bin/env bash
# Deploy ban BETA (nhanh beta) — chay SONG SONG ban chinh, khong push.
# Domain: https://umbomilk-beta.duckdns.org/ (/ | /admin/ | /api/)
set -euo pipefail

API_BASE="https://umbomilk-beta.duckdns.org/api"
DIR="$HOME/ubm-beta"

if [ ! -d "$DIR" ]; then
  git clone <repo> "$DIR"
fi
cd "$DIR"
git fetch origin beta 2>/dev/null || true
git checkout beta
git pull --ff-only 2>/dev/null || true

echo "==> Build 2 web tro ve API beta (${API_BASE})"
test -d node_modules || npm ci
VITE_API_URL="${API_BASE}" npm run build:admin
VITE_API_URL="${API_BASE}" npm run build:employee

echo "==> Publish static cho Nginx"
sudo mkdir -p /opt/ubm-beta/admin-web /opt/ubm-beta/employee-web
sudo rm -rf /opt/ubm-beta/admin-web/* /opt/ubm-beta/employee-web/*
sudo cp -r apps/admin-web/dist/* /opt/ubm-beta/admin-web/
sudo cp -r apps/employee-web/dist/* /opt/ubm-beta/employee-web/

echo "==> Build + chay backend beta (cong 4006)"
test -f apps/backend/.env || { echo "THIEU apps/backend/.env (copy tu deploy/beta/.env.beta.example)"; exit 1; }
export BACKEND_HOST_PORT=4006 BACKEND_PORT=4006
docker compose -p ubm-beta -f docker-compose.yml -f deploy/beta/docker-compose.beta.yml up --build -d

echo "==> Kiem tra suc khoe"
sleep 8
curl -fsS http://localhost:4006/health | head -c 300; echo
echo "XONG:"
echo "  NV:    https://umbomilk-beta.duckdns.org/"
echo "  Admin: https://umbomilk-beta.duckdns.org/admin/"
