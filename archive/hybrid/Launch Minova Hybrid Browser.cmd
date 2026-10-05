@echo off
setlocal
set "ROOT=%~dp0"
if "%~1"=="" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%ROOT%run-minova-hybrid.ps1"
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%ROOT%run-minova-hybrid.ps1" -Url "%~1"
)
endlocal
