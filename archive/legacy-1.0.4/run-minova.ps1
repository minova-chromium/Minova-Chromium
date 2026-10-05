[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$MinovaArguments
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$developerBuild = Join-Path $root "dist\update\win-unpacked\Minova.exe"
$verifiedFallback = Join-Path $root "runtime\fallback\app-v1.0.1\Minova.exe"
$secondaryFallback = Join-Path $root "runtime\fallback\app-v1.0.0\Minova.exe"
$electron = Join-Path $root "node_modules\electron\dist\electron.exe"

if (Test-Path $developerBuild) {
  Start-Process -FilePath $developerBuild -ArgumentList $MinovaArguments
  return
}

if (Test-Path $electron) {
  $arguments = @("`"$root`"") + $MinovaArguments
  Start-Process -FilePath $electron -ArgumentList $arguments
  return
}

if (Test-Path $verifiedFallback) {
  Start-Process -FilePath $verifiedFallback -ArgumentList $MinovaArguments
  return
}

if (Test-Path $secondaryFallback) {
  Start-Process -FilePath $secondaryFallback -ArgumentList $MinovaArguments
  return
}

Write-Error "Minova Browser could not find the local Electron runtime or a verified packaged fallback. Run pnpm install or reinstall Minova."
