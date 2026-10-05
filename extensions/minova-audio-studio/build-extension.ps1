$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Get-Content -LiteralPath (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
$outputDirectory = Join-Path $root "dist"
$stagingDirectory = Join-Path $outputDirectory "staging"
$archivePath = Join-Path $outputDirectory ("Minova-Audio-Studio-Chrome-{0}.zip" -f $manifest.version)

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
if (Test-Path -LiteralPath $stagingDirectory) {
  Remove-Item -LiteralPath $stagingDirectory -Recurse -Force
}
New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $root "manifest.json") -Destination $stagingDirectory
Copy-Item -LiteralPath (Join-Path $root "README.md") -Destination $stagingDirectory
Copy-Item -LiteralPath (Join-Path $root "icons") -Destination $stagingDirectory -Recurse
Copy-Item -LiteralPath (Join-Path $root "src") -Destination $stagingDirectory -Recurse

if (Test-Path -LiteralPath $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}
Compress-Archive -Path (Join-Path $stagingDirectory "*") -DestinationPath $archivePath -CompressionLevel Optimal
Remove-Item -LiteralPath $stagingDirectory -Recurse -Force

Write-Host "Chrome extension ready: $archivePath" -ForegroundColor Cyan
