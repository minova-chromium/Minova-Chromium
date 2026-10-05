@echo off
setlocal
set "ROOT=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\test-branded-installer.ps1" %*
if errorlevel 1 (
  echo.
  echo Minova installer verification failed.
  pause
  exit /b 1
)
echo.
echo Minova installer verification completed successfully.
pause
