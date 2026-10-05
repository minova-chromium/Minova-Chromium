@echo off
setlocal
set "ROOT=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\manage-github-release-token.ps1" -Remove
if errorlevel 1 (
  echo.
  echo The saved GitHub token could not be removed.
  pause
  exit /b 1
)
echo.
pause
