@echo off
setlocal
set "ROOT=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\manage-github-release-token.ps1"
if errorlevel 1 (
  echo.
  echo The GitHub token was not saved.
  pause
  exit /b 1
)
echo.
pause
