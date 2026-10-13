# =====================================================================================
# Daily Proactive Intelligence run - unattended entry point (Windows Task Scheduler)
#
#   Runs after the data simulator's daily load (06:00). Every step is idempotent.
#   1. Engine: profile (only changed tables are re-scanned), incremental KPI summary, processes,
#      analysis, explanations, projections, warnings, export for the app.
#   2. Claude Code (headless) /pi-daily: the agents write business reasons, real-world context and
#      plain-language warnings (they only touch text; the numbers come from the engine).
#   3. Export again so the app shows the agents' wording.
# Logs: reports\HEALTH_CARE\pi\logs\daily_<timestamp>.log
# =====================================================================================
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$logs = Join-Path $Root "reports\HEALTH_CARE\pi\logs"
New-Item -ItemType Directory -Force $logs | Out-Null
$log = Join-Path $logs ("daily_" + (Get-Date -Format "yyyy-MM-dd_HHmmss") + ".log")
function Log($m) { $l = "[$(Get-Date -Format s)] $m"; Write-Output $l; Add-Content -Path $log -Value $l -Encoding UTF8 }

$claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
if (-not $claude) { $claude = Join-Path $env:USERPROFILE ".local\bin\claude.exe" }

Log "engine starting"
& py -3.12 -m pi daily 2>&1 | Out-File -FilePath $log -Append -Encoding UTF8
Log "engine finished ($LASTEXITCODE)"

if (Test-Path $claude) {
    & $claude -p "/pi-daily" --allowedTools "Bash(py -3.12 -m pi:*)" "Bash(py -3.12 ml/train.py:*)" "Bash(py -3.12 ml/predict.py:*)" "PowerShell(py -3.12 -m pi:*)" "Read" "Glob" "Grep" "Write(./reports/**)" "Edit(./reports/**)" "Write(./config/semantic_overrides.yaml)" "Edit(./config/semantic_overrides.yaml)" "Write(./ml/data/**)" "WebSearch" "WebFetch" "Agent" 2>&1 | Out-File -FilePath $log -Append -Encoding UTF8
    Log "agents finished ($LASTEXITCODE)"
} else {
    Log "claude CLI not found - warnings keep the engine's default wording today"
}
& py -3.12 -m pi export 2>&1 | Out-File -FilePath $log -Append -Encoding UTF8
& py -3.12 -m pi status 2>&1 | Out-File -FilePath $log -Append -Encoding UTF8
Log "done"
