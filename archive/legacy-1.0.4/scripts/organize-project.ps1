[CmdletBinding(SupportsShouldProcess)]
param()

$ErrorActionPreference = "Stop"

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..")).TrimEnd(
  [IO.Path]::DirectorySeparatorChar,
  [IO.Path]::AltDirectorySeparatorChar
)

function Get-CheckedProjectPath {
  param(
    [Parameter(Mandatory)]
    [string]$Path
  )

  $fullPath = [IO.Path]::GetFullPath($Path)
  $rootPrefix = "$projectRoot$([IO.Path]::DirectorySeparatorChar)"
  $isRoot = $fullPath.Equals($projectRoot, [StringComparison]::OrdinalIgnoreCase)
  $isChild = $fullPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)

  if (-not ($isRoot -or $isChild)) {
    throw "Refusing to access a path outside the Minova project: $fullPath"
  }

  return $fullPath
}

function Move-KnownProjectItem {
  param(
    [Parameter(Mandatory)]
    [string]$SourcePath,

    [Parameter(Mandatory)]
    [string]$DestinationDirectory
  )

  $checkedSource = Get-CheckedProjectPath -Path $SourcePath
  $checkedDirectory = Get-CheckedProjectPath -Path $DestinationDirectory
  $itemName = Split-Path -Leaf $checkedSource
  $checkedDestination = Get-CheckedProjectPath -Path (Join-Path $checkedDirectory $itemName)

  if (-not (Test-Path -LiteralPath $checkedSource)) {
    if (Test-Path -LiteralPath $checkedDestination) {
      Write-Host "Already organized: $itemName"
    }
    return
  }

  if (Test-Path -LiteralPath $checkedDestination) {
    Write-Warning "Skipped $itemName because its destination already exists."
    return
  }

  if ($PSCmdlet.ShouldProcess($checkedSource, "Move to $checkedDestination")) {
    $null = New-Item -ItemType Directory -Path $checkedDirectory -Force
    Move-Item -LiteralPath $checkedSource -Destination $checkedDestination
    Write-Host "Moved $itemName"
  }
}

$verifiedFallbackDirectory = Get-CheckedProjectPath -Path (
  Join-Path $projectRoot "runtime\fallback"
)
$legacyBuildDirectory = Get-CheckedProjectPath -Path (
  Join-Path $projectRoot "inactive\legacy-builds"
)
$legacyReleaseDirectory = Get-CheckedProjectPath -Path (
  Join-Path $projectRoot "inactive\legacy-releases"
)
$legacyToolDirectory = Get-CheckedProjectPath -Path (
  Join-Path $projectRoot "inactive\legacy-tools"
)

foreach ($verifiedBuild in @("app-v1.0.1", "app-v1.0.0")) {
  Move-KnownProjectItem `
    -SourcePath (Join-Path $projectRoot $verifiedBuild) `
    -DestinationDirectory $verifiedFallbackDirectory
}

Move-KnownProjectItem `
  -SourcePath (Join-Path $projectRoot "app") `
  -DestinationDirectory $legacyBuildDirectory

$datedBuilds = Get-ChildItem -LiteralPath $projectRoot -Directory |
  Where-Object { $_.Name -match "^app-v20\d{6}-\d+$" } |
  Sort-Object Name

foreach ($datedBuild in $datedBuilds) {
  Move-KnownProjectItem `
    -SourcePath $datedBuild.FullName `
    -DestinationDirectory $legacyBuildDirectory
}

Move-KnownProjectItem `
  -SourcePath (Join-Path $projectRoot "Releases") `
  -DestinationDirectory $legacyReleaseDirectory

foreach ($retiredTool in @(
  "Build Minova Legacy Installer.cmd",
  "Launch Minova Streaming Browser.cmd",
  "Minova Streaming Browser.lnk",
  "run-minova-streaming.ps1"
)) {
  Move-KnownProjectItem `
    -SourcePath (Join-Path $projectRoot $retiredTool) `
    -DestinationDirectory $legacyToolDirectory
}

Write-Host ""
Write-Host "Minova project organization is complete."
Write-Host "No files were deleted."
