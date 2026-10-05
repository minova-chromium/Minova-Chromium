@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-minova-brand-kit.ps1"
if errorlevel 1 (
  echo.
  echo Minova Brand Kit build failed.
  pause
  exit /b 1
)
echo.
echo Minova Brand Kit is ready.
pause
