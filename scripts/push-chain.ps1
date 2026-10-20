# ===============================================================
# PUSH-CHAIN: May IT -> GitHub(vps) -> main
# (Quy trinh chot trong QUY_TRINH_CAP_NHAT_CODE.md, 2026-10-20:
#  bo moi truong beta; thu tu moi — vps TRUOC, main nhan tu vps)
# ===============================================================
# Cach dung (chay o folder goc du an, PowerShell):
#   powershell -ExecutionPolicy Bypass -File scripts\push-chain.ps1 -Message "mo ta thay doi"
# Tuy chon:
#   -SkipBuild  : bo qua build kiem thu (chi dung cho thay doi tai lieu nho)
#   -DryRun     : chi merge/build kiem thu, KHONG push
# Luu y:
#   - Commit cua May IT vao nhanh `vps` TRUOC (production deploy tu nay),
#     roi `main` nhan tu `vps` (fast-forward) -> 2 nhanh cung SHA.
#   - Config rieng tung nhanh KHONG bi chep de: merge trong worktree,
#     khong thay the file.
# ===============================================================
param(
  [string]$Message = "",
  [switch]$SkipBuild,
  [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
$root = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location $root
$tmp = Join-Path $env:TEMP 'ubm-chain'

$script:GitOut = ''
function RunGit {
  $script:GitOut = (& git $args 2>&1 | ForEach-Object { "$_" }) -join "`n"
  return ($LASTEXITCODE -eq 0)
}

function OK($m)  { Write-Host "  [OK] $m" -ForegroundColor Green }
function STEP($m){ Write-Host "`n==> $m" -ForegroundColor Cyan }
function DIE($m) { Write-Host "`n  [STOP] $m" -ForegroundColor Red; exit 1 }

function NeedGit($ok, $what) { if (-not $ok) { Write-Host "`n  [Git output]: $script:GitOut"; DIE "$what FAILED" } }

if (-not $Message) { DIE "Bat buoc -Message de tao commit co y nghia." }
if (Test-Path $tmp) {
  & git worktree remove --force "$tmp\vps" 2>$null | Out-Null
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  & git worktree prune 2>$null | Out-Null
}

STEP "0. Fetch origin"
$ok = RunGit fetch origin; NeedGit $ok "git fetch"

STEP "1. May IT: stage + commit toan bo thay doi"
& git add -u 2>$null
& git add -A -- apps packages scripts deploy .github 2>$null
$stagedFiles = & git diff --cached --name-only 2>$null
if ($stagedFiles) {
  & git commit -m $Message 2>$null | Out-Null
  NeedGit ($LASTEXITCODE -eq 0) "git commit"
  OK ("Commit: " + (& git rev-parse --short HEAD))
} else { OK "Khong co thay doi moi de commit (chi dong bo 2 nhanh)" }

function BuildHere($label, $dir) {
  if ($SkipBuild) { Write-Host "  [skip] bo qua build" ; return $true }
  cmd /c mklink /J "$dir\node_modules" "$root\node_modules" | Out-Null
  try {
    Push-Location $dir
    & npm run build *>> "$env:TEMP\ubm-chain-build.log"
    $code = $LASTEXITCODE
    Pop-Location
  } finally {
    cmd /c "rmdir `"$dir\node_modules`"" | Out-Null
  }
  if ($code -ne 0) { Write-Host "`n  [BUILD LOG CUOI]:"; Get-Content "$env:TEMP\ubm-chain-build.log" -Tail 15; DIE "Build FAIL tai $label" }
  OK "Build PASS ($label)"
  return $true
}

if (-not $SkipBuild) {
  STEP "1b. Build kiem thu tai may IT"
  & npm run build *>> "$env:TEMP\ubm-chain-build.log"
  if ($LASTEXITCODE -ne 0) { Write-Host "`n  [BUILD LOG CUOI]:"; Get-Content "$env:TEMP\ubm-chain-build.log" -Tail 15; DIE "Build FAIL tai may IT" }
  OK "Build PASS (may IT)"
}

# ---- 2. GITHUB(vps): merge commit May IT -> vps, kiem thu, push TRUOC
STEP "2. GITHUB(nhanh vps): merge thay doi -> vps, kiem thu, push origin/vps"
& git fetch origin vps 2>$null | Out-Null
& git worktree add "$tmp\vps" -B _chain-vps origin/vps 2>$null | Out-Null
NeedGit ($LASTEXITCODE -eq 0) "worktree add vps"
Push-Location "$tmp\vps"
$ok = RunGit merge main --no-edit
if (-not $ok) {
  Pop-Location
  Write-Host "`n  [Merge output]: $script:GitOut" -ForegroundColor Yellow
  Write-Host "  Giai quyet tay trong $tmp\vps (sua file, git add, git commit) roi push: git push origin HEAD:vps" -ForegroundColor Yellow
  DIE "Merge main -> vps xung dot"
}
OK "Merge may IT -> vps OK"
BuildHere "vps" "$tmp\vps" | Out-Null
if (-not $DryRun) {
  & git push origin "HEAD:vps" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Pop-Location; DIE "Push origin/vps FAIL" }
  OK "Push origin/vps xong (production san sang deploy)"
} else { Write-Host "  [dry-run] ky vong push: origin/vps" }
Pop-Location

# ---- 3. MAIN: nhan tu vps (fast-forward) roi push SAU
STEP "3. MAIN: nhan tu vps (fast-forward) roi push origin/main"
& git fetch origin vps 2>$null | Out-Null
if (-not $DryRun) {
  $ok = RunGit merge --ff-only "origin/vps"
  if (-not $ok) {
    # main khong ff duoc (tu chenh lech) -> merge tuong minh
    Write-Host "  [info] main khong fast-forward duoc -> merge --no-edit tu origin/vps" -ForegroundColor Yellow
    $ok2 = RunGit merge origin/vps --no-edit
    NeedGit $ok2 "merge origin/vps vao main"
  }
  & git push origin main 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { DIE "Push origin/main FAIL" }
  OK "Push origin/main xong (main = vps, cung SHA)"
} else { Write-Host "  [dry-run] ky vong push: origin/main (nhan tu vps)" }

# ---- 4. Don dep
STEP "4. Don dep worktree tam"
& git worktree remove --force "$tmp\vps" 2>$null | Out-Null
& git branch -D _chain-vps 2>$null | Out-Null
OK "Hoan tat"

Write-Host "`n++ CHAIN DONE: May IT -> GitHub(vps) -> main" -ForegroundColor Green
Write-Host "  NOTE: deploy tren VPS van can 1 lenh SSH (deploy/vps/deploy.sh) tru khi da bat watcher tu dong." -ForegroundColor Yellow
