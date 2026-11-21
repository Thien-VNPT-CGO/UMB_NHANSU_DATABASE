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
#
# Tu 2026-11-21: deploy FAIL se duoc tu retry sau RETRY_SECONDS (mac dinh
# 900s = 15 phut) cho cung commit, thay vi ket o ban cu den khi co commit moi.
# ==============================================================
set -uo pipefail

# Thu muc repo nhanh prod tren VPS (sua neu khac):
PROD_DIR="${PROD_DIR:-$HOME/ubm-vps}"
STATE_DIR="${STATE_DIR:-/var/lib/ubm-autodeploy}"
RETRY_SECONDS="${RETRY_SECONDS:-900}"
mkdir -p "$STATE_DIR" 2>/dev/null || true

LOG() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

state_key() { printf '%s' "$1" | tr -c 'A-Za-z0-9_.-' '_'; }

# Commit backend dang chay that te (de lan dau cai dat khong deploy lai vo ich).
deployed_commit() {
  curl -fsS -m 5 http://127.0.0.1:4005/version 2>/dev/null \
    | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p' | head -1
}

sync_branch() {
  local dir="$1" branch="$2" script="$3" label="$4"
  [ -d "$dir/.git" ] || { LOG "[$label] bo qua (khong ton tai $dir)"; return 0; }
  cd "$dir" || return 1
  local before after key ok_file fail_at_file fail_commit_file
  local last_ok failed_at failed_commit now deployed
  before="$(git rev-parse HEAD 2>/dev/null || echo '')"
  git fetch origin "$branch" >/dev/null 2>&1 || { LOG "[$label] fetch FAIL (mang/phan quyen?)"; return 1; }
  after="$(git rev-parse "origin/$branch" 2>/dev/null || echo '')"

  key="$(state_key "$label")"
  ok_file="$STATE_DIR/$key.last_ok"
  fail_at_file="$STATE_DIR/$key.fail_at"
  fail_commit_file="$STATE_DIR/$key.fail_commit"
  last_ok="$(cat "$ok_file" 2>/dev/null || true)"

  # Lan dau cai dat: so voi commit backend dang chay de khong deploy lai vo ich.
  if [ -z "$last_ok" ]; then
    deployed="$(deployed_commit)"
    if [ -n "$deployed" ]; then
      case "$after" in
        "$deployed"*) last_ok="$after" ;;
      esac
      [ -n "$last_ok" ] && printf '%s\n' "$last_ok" > "$ok_file" 2>/dev/null || true
    fi
  fi

  if [ -n "$after" ] && [ "$after" != "$last_ok" ]; then
    now="$(date +%s)"
    failed_at="$(cat "$fail_at_file" 2>/dev/null || echo 0)"
    failed_commit="$(cat "$fail_commit_file" 2>/dev/null || true)"

    # Cung 1 commit vua FAIL: chi retry sau cooldown, tranh build lien tuc.
    if [ "$failed_commit" = "$after" ] && [ $((now - failed_at)) -lt "$RETRY_SECONDS" ]; then
      LOG "[$label] $after tung deploy FAIL — cho retry sau $((RETRY_SECONDS - (now - failed_at)))s"
      return 0
    fi

    LOG "[$label] Phat hien commit moi ($before .. ${after:0:7}) — chay deploy..."
    # Dong bo CUNG theo origin: file build (packages/shared/dist) tung lam cay git
    # "dirty" khien `git pull --ff-only` fail moi phut -> prod ket o commit cu.
    # checkout -f + reset --hard bo qua thay doi do build sinh ra; .env (untracked)
    # va data/ van duoc giu nguyen.
    git checkout -f "$branch" >>/var/log/ubm-autodeploy.log 2>&1 || git checkout -f -B "$branch" "origin/$branch" >>/var/log/ubm-autodeploy.log 2>&1 || { LOG "[$label] checkout FAIL"; return 1; }
    git reset --hard "origin/$branch" >>/var/log/ubm-autodeploy.log 2>&1 || { LOG "[$label] reset FAIL"; return 1; }
    if bash "$script" >>/var/log/ubm-autodeploy.log 2>&1; then
      printf '%s\n' "$after" > "$ok_file" 2>/dev/null || true
      rm -f "$fail_at_file" "$fail_commit_file" 2>/dev/null || true
      LOG "[$label] DEPLOY OK ($after)"
    else
      date +%s > "$fail_at_file" 2>/dev/null || true
      printf '%s\n' "$after" > "$fail_commit_file" 2>/dev/null || true
      LOG "[$label] DEPLOY FAIL — se tu retry sau ${RETRY_SECONDS}s (chi tiet trong log)"
    fi
  fi
}

sync_branch "$PROD_DIR" vps deploy/vps/deploy.sh "PROD(vps)"
exit 0
