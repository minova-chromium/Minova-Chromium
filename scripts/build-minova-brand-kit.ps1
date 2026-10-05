param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\Minova Brand Kit")
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$brandRoot = Join-Path $projectRoot "brand"
$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
$archivePath = Join-Path $projectRoot "dist\brand\Minova-Brand-Kit-2.1.zip"

if (-not (Test-Path (Join-Path $brandRoot "assets\minova-symbol-color.svg"))) {
  throw "Minova brand masters were not found at $brandRoot"
}

if (Test-Path $outputRoot) {
  Remove-Item -LiteralPath $outputRoot -Recurse -Force
}

$directories = @(
  $outputRoot,
  (Join-Path $outputRoot "assets"),
  (Join-Path $outputRoot "exports"),
  (Join-Path $outputRoot "exports\icons"),
  (Join-Path $outputRoot "exports\logos"),
  (Join-Path $outputRoot "references"),
  (Join-Path $outputRoot "scripts"),
  (Join-Path $outputRoot "templates"),
  (Join-Path $outputRoot "tokens")
)
$directories | ForEach-Object { New-Item -ItemType Directory -Path $_ -Force | Out-Null }

$copies = @(
  @{ Source = "README.md"; Destination = "README.md" },
  @{ Source = "minova-brand-guide.html"; Destination = "minova-brand-guide.html" },
  @{ Source = "brand.css"; Destination = "brand.css" },
  @{ Source = "Export Minova Brand Assets.cmd"; Destination = "Export Minova Brand Assets.cmd" },
  @{ Source = "assets\minova-symbol-color.svg"; Destination = "assets\minova-symbol-color.svg" },
  @{ Source = "assets\minova-wordmark-dark.svg"; Destination = "assets\minova-wordmark-dark.svg" },
  @{ Source = "assets\minova-lockup-dark.svg"; Destination = "assets\minova-lockup-dark.svg" },
  @{ Source = "assets\minova-orbit-pattern.svg"; Destination = "assets\minova-orbit-pattern.svg" },
  @{ Source = "references\minova-wordmark-approved.png"; Destination = "references\minova-wordmark-approved.png" },
  @{ Source = "scripts\export-brand-assets.ps1"; Destination = "scripts\export-brand-assets.ps1" },
  @{ Source = "tokens\minova-brand-tokens.css"; Destination = "tokens\minova-brand-tokens.css" },
  @{ Source = "tokens\minova-brand-tokens.json"; Destination = "tokens\minova-brand-tokens.json" },
  @{ Source = "templates\minova-installer-panel.svg"; Destination = "templates\minova-installer-panel.svg" },
  @{ Source = "templates\minova-release-cover.svg"; Destination = "templates\minova-release-cover.svg" },
  @{ Source = "templates\minova-social-banner.svg"; Destination = "templates\minova-social-banner.svg" },
  @{ Source = "exports\icons\minova-16.png"; Destination = "exports\icons\minova-16.png" },
  @{ Source = "exports\icons\minova-24.png"; Destination = "exports\icons\minova-24.png" },
  @{ Source = "exports\icons\minova-32.png"; Destination = "exports\icons\minova-32.png" },
  @{ Source = "exports\icons\minova-48.png"; Destination = "exports\icons\minova-48.png" },
  @{ Source = "exports\icons\minova-64.png"; Destination = "exports\icons\minova-64.png" },
  @{ Source = "exports\icons\minova-128.png"; Destination = "exports\icons\minova-128.png" },
  @{ Source = "exports\icons\minova-256.png"; Destination = "exports\icons\minova-256.png" },
  @{ Source = "exports\icons\minova-512.png"; Destination = "exports\icons\minova-512.png" },
  @{ Source = "exports\icons\minova-1024.png"; Destination = "exports\icons\minova-1024.png" },
  @{ Source = "exports\icons\minova.ico"; Destination = "exports\icons\minova.ico" },
  @{ Source = "exports\logos\minova-lockup-dark.png"; Destination = "exports\logos\minova-lockup-dark.png" },
  @{ Source = "exports\logos\minova-wordmark-dark.png"; Destination = "exports\logos\minova-wordmark-dark.png" }
)

foreach ($copy in $copies) {
  $source = Join-Path $brandRoot $copy.Source
  if (-not (Test-Path $source)) {
    throw "Required brand asset is missing: $source"
  }
  Copy-Item -LiteralPath $source -Destination (Join-Path $outputRoot $copy.Destination) -Force
}

Copy-Item -LiteralPath (Join-Path $projectRoot "LICENSE") -Destination (Join-Path $outputRoot "LICENSE") -Force

$manifest = [ordered]@{
  name = "Minova Visual Identity"
  edition = "2.1"
  product = "Minova Chromium"
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  authoritativeAssets = @(
    "assets/minova-symbol-color.svg",
    "assets/minova-wordmark-dark.svg",
    "assets/minova-lockup-dark.svg"
  )
  taglines = @(
    "Shape your own path.",
    "The web, shaped around you.",
    "Your browser, your way."
  )
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $outputRoot "brand-kit.json") -Encoding utf8

$archiveDirectory = Split-Path -Parent $archivePath
New-Item -ItemType Directory -Path $archiveDirectory -Force | Out-Null
if (Test-Path $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}
Compress-Archive -Path (Join-Path $outputRoot "*") -DestinationPath $archivePath -CompressionLevel Optimal

Write-Host "Minova Brand Kit created at: $outputRoot" -ForegroundColor Cyan
Write-Host "Archive created at: $archivePath" -ForegroundColor Cyan
