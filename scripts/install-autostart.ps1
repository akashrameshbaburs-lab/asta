# Registers Asta to start automatically when you log in.
# Run from an ordinary PowerShell window (no admin needed for a user task).
$ErrorActionPreference = "Stop"

$taskName = "Asta Voice Assistant"
$vbs = "C:\Users\akash\asta\scripts\asta.vbs"

if (-not (Test-Path $vbs)) { throw "Missing launcher: $vbs" }

$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Description "Starts Asta, the local voice assistant, at logon." -Force | Out-Null

Write-Host "Installed scheduled task '$taskName'." -ForegroundColor Green
Write-Host "Asta will start the next time you log in."
Write-Host ""
Write-Host "Start it now with:  Start-ScheduledTask -TaskName '$taskName'"
Write-Host "Remove it with:     powershell -File C:\Users\akash\asta\scripts\uninstall-autostart.ps1"
