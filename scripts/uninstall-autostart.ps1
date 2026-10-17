# Removes the Asta logon task and stops a running Asta.
$ErrorActionPreference = "SilentlyContinue"
$taskName = "Asta Voice Assistant"

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like "*src\asta.js*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Write-Host "Removed scheduled task '$taskName' and stopped any running Asta." -ForegroundColor Green
