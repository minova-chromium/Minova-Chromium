@echo off
setlocal
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH. Install Node.js 22.16 or newer, then run this command again.
  exit /b 1
)
node "%~dp0build-minova-shell.js" %*
exit /b %errorlevel%
