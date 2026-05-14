# deploy-push.ps1 — Algebraic_CDS deploy push (PowerShell).
#
# Pushes the current branch to GitHub origin, which fans out to:
#   * Cloudflare Pages — auto-deploys via .github/workflows/deploy-ui.yml on
#     push to `main` (only when ui/** or the workflow itself changes).
#   * Railway — auto-deploys the Julia engine via Dockerfile when railway.json
#     is wired up to the GitHub repo (dashboard integration).
#
# Usage (from the repo root, an open PowerShell):
#   .\scripts\deploy-push.ps1 "fix: wire ApptBasedOn morphism in UI"
#
# Optional flags:
#   -SkipBuild   — skip the local Vite build (faster, but you miss type errors
#                  that the GH Actions runner will eventually surface 4 min later)
#   -SkipJlTest  — skip the local Julia smoke test
#   -DryRun      — run all checks but don't actually `git push`
#
# Exits non-zero on any failure so it composes in a CI step.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0,
               HelpMessage = "Commit message (use quotes for multi-word).")]
    [string]$Message,

    [switch]$SkipBuild,
    [switch]$SkipJlTest,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# Resolve repo root from the script's location so the script works no matter
# where the user invokes it from.
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $RepoRoot

function Write-Section($title) {
    Write-Host ""
    Write-Host "=== $title ===" -ForegroundColor Cyan
}

function Invoke-Step($label, [scriptblock]$cmd) {
    Write-Host "→ $label" -ForegroundColor Yellow
    & $cmd
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ $label failed (exit $LASTEXITCODE)" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

# ----- Preflight ------------------------------------------------------------

Write-Section "Preflight"

# Repo sanity — must be inside the Algebraic_CDS git checkout.
if (-not (Test-Path (Join-Path $RepoRoot '.git'))) {
    Write-Host "✗ Not a git repository: $RepoRoot" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path (Join-Path $RepoRoot 'Dockerfile'))) {
    Write-Host "✗ Missing Dockerfile — is this the Algebraic_CDS repo root?" -ForegroundColor Red
    exit 1
}

# Surface what we're about to ship.
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
Write-Host "Branch:  $branch"
Write-Host "Message: $Message"

# Warn (but don't block) on non-main branches — Cloudflare Pages and Railway
# only auto-deploy from `main`. Pushing a feature branch just lands the
# commit on origin without triggering a deploy.
if ($branch -ne 'main') {
    Write-Host "⚠ You are on '$branch', not 'main'. The push will NOT trigger Cloudflare or Railway." -ForegroundColor Yellow
}

# Is there anything to commit?
$status = (git status --porcelain) -join "`n"
if (-not $status) {
    Write-Host "✗ Working tree clean — nothing to commit." -ForegroundColor Red
    Write-Host "  (If you only want to push existing commits, run: git push origin $branch)" -ForegroundColor DarkGray
    exit 1
}

# Show the user what's about to ship.
Write-Section "Changes to ship"
git status --short
Write-Host ""
git diff --stat

# ----- Local validation -----------------------------------------------------

# UI build catches TS errors before the GitHub Actions runner does, saving
# ~4 min of CI runtime on every type error.
if (-not $SkipBuild) {
    Write-Section "UI build (Vite)"
    if (-not (Test-Path (Join-Path $RepoRoot 'ui\node_modules'))) {
        Invoke-Step "ui: npm ci" { Push-Location ui; npm ci; Pop-Location }
    }
    Invoke-Step "ui: npm run build" { Push-Location ui; npm run build; Pop-Location }
} else {
    Write-Host "⚠ Skipping UI build (-SkipBuild)" -ForegroundColor Yellow
}

# Julia smoke test — fast end-to-end check that the engine still parses and
# fires sample rules. Skipped by default if julia isn't on PATH.
if (-not $SkipJlTest) {
    Write-Section "Julia smoke test"
    $juliaCmd = Get-Command julia -ErrorAction SilentlyContinue
    if (-not $juliaCmd) {
        Write-Host "⚠ julia not found on PATH — skipping smoke test" -ForegroundColor Yellow
    }
    elseif (-not (Test-Path (Join-Path $RepoRoot 'test_new_resources.jl'))) {
        Write-Host "⚠ test_new_resources.jl not found — skipping smoke test" -ForegroundColor Yellow
    }
    else {
        Invoke-Step "julia: test_new_resources.jl" { julia --project=. test_new_resources.jl }
    }
} else {
    Write-Host "⚠ Skipping Julia smoke test (-SkipJlTest)" -ForegroundColor Yellow
}

# ----- Commit + push --------------------------------------------------------

Write-Section "Git commit"
Invoke-Step "git add -A"        { git add -A }
Invoke-Step "git commit"        { git commit -m $Message }

if ($DryRun) {
    Write-Section "Dry run"
    Write-Host "Would now run: git push origin $branch" -ForegroundColor Yellow
    Write-Host "Stopping here (-DryRun)." -ForegroundColor Yellow
    exit 0
}

Write-Section "Push to origin"
Invoke-Step "git push origin $branch" { git push origin $branch }

# ----- Deploy trail ---------------------------------------------------------

Write-Section "Deploy"
$remote = (git config --get remote.origin.url).Trim()
# Normalize either git@github.com:user/repo.git or https://github.com/user/repo.git
$slug = $null
if ($remote -match 'github\.com[:/](.+?)(?:\.git)?$') {
    $slug = $Matches[1]
}

if ($branch -eq 'main') {
    if ($slug) {
        Write-Host "Cloudflare Pages (UI):  https://github.com/$slug/actions/workflows/deploy-ui.yml" -ForegroundColor Green
    }
    Write-Host "Railway      (engine):  https://railway.app/dashboard" -ForegroundColor Green
    Write-Host ""
    Write-Host "Both deploys run async — typical times:"
    Write-Host "  Cloudflare Pages:  ~2 min (Vite build is the long pole)"
    Write-Host "  Railway:           ~3-6 min (Docker layer cache helps after first build)"
}
else {
    Write-Host "Pushed to '$branch' — no deploy triggered. Merge to main to ship." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "✓ Done." -ForegroundColor Green
