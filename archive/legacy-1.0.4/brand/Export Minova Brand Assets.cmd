@echo off
setlocal
title Minova Brand Exporter

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\export-brand-assets.ps1"
if errorlevel 1 (
  echo.
  echo Minova brand export failed.
  pause
  exit /b 1
)

echo.
echo Minova brand assets are ready in:
echo %~dp0exports
pause

