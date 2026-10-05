@echo off
setlocal
set "ROOT=%~dp0"
pushd "%ROOT%" >nul
if errorlevel 1 (
  echo Unable to open the Minova project folder.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\build-updater-release.ps1" -Publish -UseExistingBuild %*
set "RESULT=%ERRORLEVEL%"
popd
if not "%RESULT%"=="0" (
  echo.
  echo Minova GitHub release failed.
  pause
  exit /b %RESULT%
)
echo.
echo Minova GitHub release completed successfully.
pause
