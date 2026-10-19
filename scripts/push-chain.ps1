# ===============================================================
# PUSH-CHAIN: May IT -> GitHub -> Beta -> main -> Vps
# (Quy trinh chot trong QUY_TRINH_CAP_NHAT_CODE.md)
# ===============================================================
# Cach dung (chay o folder goc du an):
#   powershell -ExecutionPolicy Bypass -File scripts\push-chain.ps1 -Message "mo ta thay doi"
# Tuy chon:
#   -SkipBuild  : bo qua build kiem thu (chi dung cho thay doi tai lieu nho)
#   -DryRun     : chi merge/build kiem thu, KHONG push
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

function OK($m)  { Write-Host "  [OK] $m" -ForegroundColor Green }
function STEP($m){ Write-Host "`n==> $m" -ForegroundColor Cyan }
function DIE($m) { Write-Host "`n  [STOP] $m" -ForegroundColor Red; exit 1 }

$script:GitOut = ''
function RunGit {
  $script:GitOut = (& git $args 2>&1 | ForEach-Object { "$_" }) -join "`n"
  return ($LASTEXITCODE -eq 0)
}

function NeedGit($ok, $what) { if (-not $ok) { DIE "$what FAILED" } }

if (-not $Message) { DIE "Bat buoc -Message de tao commit co y nghia." }
if (Test-Path $tmp) {
  & git worktree remove --force "$tmp\beta" 2>$null | Out-Null
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
} else { OK "Khong co thay doi moi de commit (chi dong bo 3 nhanh)" }

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

# ---- 2. BETA
STEP "2. BETA: merge main -> beta, kiem thu, push origin/beta"
& git worktree add "$tmp\beta" -B _chain-beta origin/beta 2>$null | Out-Null
NeedGit ($LASTEXITCODE -eq 0) "worktree add beta"
Push-Location "$tmp\beta"
$ok = RunGit merge main --no-edit
if (-not $ok) {
  Pop-Location
  Write-Host "`n  [Merge output]: $script:GitOut" -ForegroundColor Yellow
  Write-Host "  Giai quyet tay trong $tmp\beta (sua file, git add, git commit) roi push: git push origin HEAD:beta" -ForegroundColor Yellow
  DIE "Merge main -> beta xung dot"
}
OK "Merge main -> beta OK"
BuildHere "beta" "$tmp\beta" | Out-Null
if (-not $DryRun) {
  & git push origin "HEAD:beta" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Pop-Location; DIE "Push origin/beta FAIL" }
  OK "Push origin/beta xong"
} else { Write-Host "  [dry-run] ky vong push: origin/beta" }
Pop-Location

# ---- 3. MAIN
STEP "3. MAIN: nhan tu beta (fast-forward) roi push origin/main"
if (-not $DryRun) {
  & git merge --ff-only origin/beta 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { DIE "FF main <- beta FAIL" }
  & git push origin main 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { DIE "Push origin/main FAIL" }
  OK "Push origin/main xong"
} else { Write-Host "  [dry-run] ky vong push: origin/main (ff tu beta)" }

# ---- 4. VPS
STEP "4. VPS: merge main -> vps, kiem thu, push origin/vps"
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
OK "Merge main -> vps OK"
BuildHere "vps" "$tmp\vps" | Out-Null
if (-not $DryRun) {
  & git push origin "HEAD:vps" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Pop-Location; DIE "Push origin/vps FAIL" }
  OK "Push origin/vps xong"
} else { Write-Host "  [dry-run] ky vong push: origin/vps" }
Pop-Location

# ---- 5. Don dep
STEP "5. Don dep worktree tam"
& git worktree remove --force "$tmp\beta" 2>$null | Out-Null
& git worktree remove --force "$tmp\vps" 2>$null | Out-Null
& git branch -D _chain-beta _chain-vps 2>$null | Out-Null
OK "Hoan tat"

Write-Host "`n++ CHAIN DONE: IT -> GitHub(beta) -> main -> vps" -ForegroundColor Green
Write-Host "  NOTE: buoc chay deploy tren VPS van can 1 lenh SSH manual (deploy/vps/deploy.sh) tru khi da bat watcher tu dong." -ForegroundColor Yellow
