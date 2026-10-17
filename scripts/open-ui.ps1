# Make sure Asta is running, then open its dashboard as a standalone app window.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\open-ui.ps1
#
# The daemon opens the window itself when ui.openOnStart is true, so this
# script only opens a second window when Asta was already running (i.e. you
# closed the dashboard but the assistant kept listening).
$ErrorActionPreference = "SilentlyContinue"

$root = Split-Path -Parent $PSScriptRoot
$configFile = Join-Path $root "config.json"
$port = 7373
$openOnStart = $true

try {
  $cfg = Get-Content $configFile -Raw | ConvertFrom-Json
  if ($cfg.ui.port)     { $port     = [int]$cfg.ui.port }
  if ($null -ne $cfg.ui.openOnStart) { $openOnStart = [bool]$cfg.ui.openOnStart }
} catch {
  Write-Host "Could not read config.json - using the default port $port."
}

$url = "http://127.0.0.1:$port/"

function Test-Asta {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    return $r.StatusCode -eq 200
  } catch {
    return $false
  }
}

$wasRunning = Test-Asta

if (-not $wasRunning) {
  Write-Host "Starting Asta..."
  $vbs = Join-Path $root "scripts\asta.vbs"
  if (Test-Path $vbs) {
    Start-Process wscript.exe -ArgumentList "`"$vbs`"" -WindowStyle Hidden
  } else {
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$root\start-asta.bat`"" -WindowStyle Minimized
  }

  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 400
    if (Test-Asta) { break }
  }
  if (-not (Test-Asta)) {
    Write-Host "Asta did not come up. Check logs\asta.log" -ForegroundColor Red
    exit 1
  }
}

# The daemon opens its own window on a fresh start; only open one here when it
# was already running (or when auto-open is switched off).
if ($wasRunning -or -not $openOnStart) {
  $candidates = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )
  $browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

  if ($browser) {
    Start-Process -FilePath $browser -ArgumentList "--app=$url", "--window-size=1280,880", "--no-first-run"
  } else {
    Start-Process $url
  }
} else {
  Write-Host "Asta is running - its dashboard window opens automatically."
}
