@echo off
setlocal
set "ROOT=%~dp0"
set "DEVELOPER_BUILD=%ROOT%dist\update\win-unpacked\Minova.exe"
set "VERIFIED_FALLBACK=%ROOT%runtime\fallback\app-v1.0.1\Minova.exe"
set "SECONDARY_FALLBACK=%ROOT%runtime\fallback\app-v1.0.0\Minova.exe"
set "ELECTRON=%ROOT%node_modules\electron\dist\electron.exe"

if exist "%DEVELOPER_BUILD%" (
  start "" "%DEVELOPER_BUILD%" %*
  exit /b 0
)

if exist "%ELECTRON%" (
  start "" "%ELECTRON%" "%ROOT%." %*
  exit /b 0
)

if exist "%VERIFIED_FALLBACK%" (
  start "" "%VERIFIED_FALLBACK%" %*
  exit /b 0
)

if exist "%SECONDARY_FALLBACK%" (
  start "" "%SECONDARY_FALLBACK%" %*
  exit /b 0
)

echo Minova Browser could not find the local Electron runtime or a verified packaged fallback.
echo Run pnpm install or reinstall Minova.
pause
exit /b 1
