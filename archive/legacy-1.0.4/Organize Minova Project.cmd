@echo off
setlocal
set "ROOT=%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\organize-project.ps1"
if errorlevel 1 (
  echo.
  echo Minova project organization failed.
  pause
  exit /b 1
)

echo.
echo Minova project organization completed successfully.
pause
