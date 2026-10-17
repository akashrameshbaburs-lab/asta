@echo off
rem Ask for the SRM / Haveloc passwords and store them encrypted (DPAPI).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-credentials.ps1"
echo.
pause
