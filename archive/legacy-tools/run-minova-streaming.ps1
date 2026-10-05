[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$MinovaArguments
)

$ErrorActionPreference = "Stop"
$launcher = Join-Path $PSScriptRoot "run-minova.ps1"
& $launcher @MinovaArguments
