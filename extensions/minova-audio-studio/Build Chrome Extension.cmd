@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-extension.ps1"
if errorlevel 1 (
  echo.
  echo Minova Audio Studio build failed.
  pause
  exit /b 1
)
echo.
echo The Chrome extension ZIP is ready in the dist folder.
pause
