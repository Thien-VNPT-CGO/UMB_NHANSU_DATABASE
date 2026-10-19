#!/usr/bin/env bash
# ==============================================================
# UBM AUTO-DEPLOY WATCHER (chay tren VPS, khong push di dau)
# --------------------------------------------------------------
# Kiem tra GitHub xem nhanh `vps` (prod) va `beta` (beta) co commit
# moi khong -> co thi tu chay deploy tuong ung. Duoc cron goi moi 5 phut.
# Cai dat (chay 1 lan trong folder repo tren VPS):
#   sudo bash deploy/autodeploy/install-autodeploy.sh
# Xem log:   tail -f /var/log/ubm-autodeploy.log
# Tat tu dong: sudo bash deploy/autodeploy/install-autodeploy.sh --off
# ==============================================================
set -uo pipefail

# Thu muc repo tre nhanh tung moi truong tren VPS (sua neu khac):
PROD_DIR="${PROD_DIR:-$HOME/ubm-vps}"
BETA_DIR="${BETA_DIR:-$HOME/ubm-beta}"

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
    git pull --ff-only origin "$branch" >>/var/log/ubm-autodeploy.log 2>&1 || { LOG "[$label] git pull FAIL"; return 1; }
    if bash "$script" >>/var/log/ubm-autodeploy.log 2>&1; then
      LOG "[$label] DEPLOY OK ($after)"
    else
      LOG "[$label] DEPLOY FAIL — chi tiet trong log, va he thong dang chay ban cu"
    fi
  fi
}

sync_branch "$PROD_DIR" vps    deploy/vps/deploy.sh    "PROD(vps)"
sync_branch "$BETA_DIR" beta   deploy/beta/deploy-beta.sh "BETA(beta)"
exit 0
