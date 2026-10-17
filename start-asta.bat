@echo off
rem Start Asta in a visible window so you can watch what it is doing.
cd /d C:\Users\akash\asta
title Asta
node src\asta.js
echo.
echo Asta has stopped. Press any key to close.
pause >nul
