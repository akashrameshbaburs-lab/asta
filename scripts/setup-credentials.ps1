# One-time (re-runnable) setup for the SRM and Haveloc portal logins.
#
# Passwords are entered with masked input and encrypted immediately with the
# Windows Data Protection API. They are never written in plain text, never
# printed, and never leave this machine. Only your Windows account can decrypt
# them.
#
# Run it by double-clicking scripts\setup-credentials.bat
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$file = Join-Path $root "secrets.json"

Write-Host ""
Write-Host "  Asta - portal credentials" -ForegroundColor Cyan
Write-Host "  -------------------------"
Write-Host "  Stored encrypted with Windows DPAPI, readable only by your Windows account."
Write-Host "  Press Enter on its own to leave a value unchanged."
Write-Host ""

$existing = $null
if (Test-Path $file) {
  try { $existing = Get-Content $file -Raw | ConvertFrom-Json } catch { $existing = $null }
}

function Read-Plain([string]$label, [string]$current) {
  $shown = if ($current) { " [$current]" } else { "" }
  return Read-Host -Prompt "$label$shown"
}

function Read-Secret([string]$label, [bool]$keep) {
  $prompt = if ($keep) { "$label [keep existing]" } else { $label }
  $sec = Read-Host -Prompt $prompt -AsSecureString
  $plainLen = $sec.Length
  if ($plainLen -eq 0) { return $null }
  return (ConvertFrom-SecureString $sec)
}

$srmUser = Read-Plain "SRM NetID (e.g. ab1234@srmist.edu.in)" $existing.srm.username
if (-not $srmUser) { $srmUser = $existing.srm.username }

$srmPass = Read-Secret "SRM password" ([bool]$existing.srm.passwordEnc)
if (-not $srmPass) { $srmPass = $existing.srm.passwordEnc }

$hUser = Read-Plain "Haveloc username or email" $existing.haveloc.username
if (-not $hUser) { $hUser = $existing.haveloc.username }

$hPass = Read-Secret "Haveloc password" ([bool]$existing.haveloc.passwordEnc)
if (-not $hPass) { $hPass = $existing.haveloc.passwordEnc }

if (-not $srmPass -and -not $hPass) {
  Write-Host "Nothing to save." -ForegroundColor Yellow
  exit 1
}

$payload = [ordered]@{
  srm     = [ordered]@{ username = $srmUser; passwordEnc = $srmPass }
  haveloc = [ordered]@{ username = $hUser; passwordEnc = $hPass }
  savedAt = (Get-Date).ToString("o")
}

$payload | ConvertTo-Json -Depth 5 | Set-Content -Path $file -Encoding UTF8

# Restrict the file to this account only.
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $file /inheritance:r /grant:r "${me}:(F)" | Out-Null

Write-Host ""
Write-Host "  Saved to $file" -ForegroundColor Green
Write-Host "  (readable only by $me)"
Write-Host ""
Write-Host "  Next: run  npm run portals  to verify the logins work."
Write-Host ""
