#!/usr/bin/env bash
# ==============================================================
# UBM AUTO-DEPLOY WATCHER (chay tren VPS, khong push di dau)
# --------------------------------------------------------------
# Kiem tra GitHub xem nhanh `vps` (prod, cong 4005) co commit moi
# khong -> co thi tu chay deploy.sh. Duoc cron goi moi phut.
# (Moi truong beta da bo ngay 2026-10-20 theo yeu cau chu du an.)
# Cai dat (chay 1 lan trong folder repo tren VPS):
#   sudo bash deploy/autodeploy/install-autodeploy.sh
# Xem log:   tail -f /var/log/ubm-autodeploy.log
# Tat tu dong: sudo bash deploy/autodeploy/install-autodeploy.sh --off
# ==============================================================
set -uo pipefail

# Thu muc repo nhanh prod tren VPS (sua neu khac):
PROD_DIR="${PROD_DIR:-$HOME/ubm-vps}"

LOG() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

sync_branch() {
  local dir="$1" branch="$2" script="$3" label="$4"
  [ -d "$dir/.git" ] || { LOG "[$label] bo qua (khong ton tai $dir)"; return 0; }
  cd "$dir" || return 1
  local before after
  before="$(git rev-parse HEAD 2>/dev/null || echo '')"
  git fetch origin "$branch" >/dev/null 2>&1 || { LOG "[$label] fetch FAIL (mang/phan quyen?)"; return 1; }
  after="$(git rev-parse "origin/$branch" 2>/dev/null || echo '')"
  if [ -n "$after" ] && [ "$before" != "$after" ]; then
    LOG "[$label] Phat hien commit moi ($before .. ${after:0:7}) — chay deploy..."
    # Dong bo CUNG theo origin: file build (packages/shared/dist) tung lam cay git
    # "dirty" khien `git pull --ff-only` fail moi phut -> prod ket o commit cu.
    # checkout -f + reset --hard bo qua thay doi do build sinh ra; .env (untracked)
    # va data/ van duoc giu nguyen.
    git checkout -f "$branch" >>/var/log/ubm-autodeploy.log 2>&1 || git checkout -f -B "$branch" "origin/$branch" >>/var/log/ubm-autodeploy.log 2>&1 || { LOG "[$label] checkout FAIL"; return 1; }
    git reset --hard "origin/$branch" >>/var/log/ubm-autodeploy.log 2>&1 || { LOG "[$label] reset FAIL"; return 1; }
    if bash "$script" >>/var/log/ubm-autodeploy.log 2>&1; then
      LOG "[$label] DEPLOY OK ($after)"
    else
      LOG "[$label] DEPLOY FAIL — chi tiet trong log, he thong dang chay cu"
    fi
  fi
}

sync_branch "$PROD_DIR" vps deploy/vps/deploy.sh "PROD(vps)"
exit 0
