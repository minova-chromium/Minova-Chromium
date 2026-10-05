@echo off
setlocal
set "ROOT=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\build-windows-installer.ps1" %*
if errorlevel 1 (
  echo.
  echo Minova legacy installer build failed.
  pause
  exit /b 1
)
echo.
echo Minova legacy installer build completed successfully.
pause
