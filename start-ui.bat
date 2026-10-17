@echo off
rem Start Asta (if it is not already running) and open the dashboard window.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\open-ui.ps1"
if errorlevel 1 pause
