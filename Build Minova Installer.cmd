@echo off
setlocal
set "ROOT=%~dp0"
pushd "%ROOT%" >nul
if errorlevel 1 (
  echo Unable to open the Minova project folder.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\build-updater-release.ps1" %*
set "RESULT=%ERRORLEVEL%"
popd
if not "%RESULT%"=="0" (
  echo.
  echo Minova updater-compatible installer build failed.
  pause
  exit /b %RESULT%
)
echo.
echo Minova updater-compatible installer build completed successfully.
pause
