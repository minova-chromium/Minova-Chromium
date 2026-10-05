[CmdletBinding()]
param(
  [string]$Version,
  [string]$RuntimePath,
  [string]$OutputDirectory,
  [switch]$KeepBuildFiles
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $root "package.json") -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = [string]$package.version
}
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
  throw "Version must use semantic versioning, for example 1.0.1."
}

if ([string]::IsNullOrWhiteSpace($RuntimePath)) {
  $runtimeCandidates = @(
    (Join-Path $root "dist\minova-$Version"),
    (Join-Path $root "app-v$Version"),
    (Join-Path $root "app-$Version")
  )
  $RuntimePath = $runtimeCandidates | Where-Object {
    Test-Path -LiteralPath (Join-Path $_ "Minova.exe")
  } | Select-Object -First 1
  if ([string]::IsNullOrWhiteSpace($RuntimePath)) {
    throw "No runtime was found for Minova $Version. Pass -RuntimePath explicitly."
  }
}
$runtime = (Resolve-Path -LiteralPath $RuntimePath).Path
if (-not (Test-Path -LiteralPath (Join-Path $runtime "Minova.exe"))) {
  throw "Runtime is missing Minova.exe: $runtime"
}
if (-not (Test-Path -LiteralPath (Join-Path $runtime "resources\app\src\app-main.js"))) {
  throw "Runtime is missing its unpacked Minova application source."
}
if (-not (Test-Path -LiteralPath (Join-Path $runtime "resources\minova-runtime.asar"))) {
  throw "Runtime is missing minova-runtime.asar."
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $root "dist\installer"
}
$output = [System.IO.Path]::GetFullPath($OutputDirectory)
$distRoot = [System.IO.Path]::GetFullPath((Join-Path $root "dist"))
if (-not $output.StartsWith($distRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Installer output must stay inside the project dist directory."
}
[System.IO.Directory]::CreateDirectory($output) | Out-Null

$build = Join-Path $output ".build-$Version"
if (Test-Path -LiteralPath $build) {
  $resolvedBuild = (Resolve-Path -LiteralPath $build).Path
  if (-not $resolvedBuild.StartsWith($distRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean a build directory outside dist."
  }
  Remove-Item -LiteralPath $resolvedBuild -Recurse -Force
}
[System.IO.Directory]::CreateDirectory($build) | Out-Null

$payloadZip = Join-Path $build "minova-payload.zip"
$releaseFile = Join-Path $build "release.properties"
$assemblyInfo = Join-Path $build "AssemblyInfo.cs"
$logoPng = Join-Path $build "minova-logo.png"
$iconFile = Join-Path $build "minova.ico"
$uninstaller = Join-Path $build "Uninstall Minova.exe"
$setup = Join-Path $output "Minova-Setup-$Version.exe"
$latest = Join-Path $output "latest.json"
$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$source = Join-Path $root "installer\MinovaInstaller.cs"
$sourceLogo = Join-Path $root "assets\logos\minova-browser.png"

if (-not (Test-Path -LiteralPath $compiler)) {
  throw "The Windows C# compiler was not found: $compiler"
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Drawing

Write-Host "Compressing Minova $Version runtime..."
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $runtime,
  $payloadZip,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $false
)

$runtimeBytes = (Get-ChildItem -LiteralPath $runtime -File -Recurse | Measure-Object -Property Length -Sum).Sum
$payloadHash = (Get-FileHash -LiteralPath $payloadZip -Algorithm SHA256).Hash.ToLowerInvariant()
@(
  "version=$Version"
  "payloadBytes=$runtimeBytes"
  "payloadSha256=$payloadHash"
) | Set-Content -LiteralPath $releaseFile -Encoding ASCII

$numericVersion = ($Version -split '-', 2)[0]
$versionParts = @($numericVersion.Split('.') | ForEach-Object { [int]$_ })
while ($versionParts.Count -lt 4) {
  $versionParts += 0
}
$assemblyVersion = ($versionParts[0..3] -join '.')
@"
using System.Reflection;
[assembly: AssemblyTitle("Minova Installer")]
[assembly: AssemblyDescription("Installs and updates Minova Browser")]
[assembly: AssemblyCompany("Minova")]
[assembly: AssemblyProduct("Minova Browser")]
[assembly: AssemblyCopyright("Copyright Minova contributors")]
[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$assemblyVersion")]
[assembly: AssemblyInformationalVersion("$Version")]
"@ | Set-Content -LiteralPath $assemblyInfo -Encoding UTF8

$sourceImage = [System.Drawing.Image]::FromFile($sourceLogo)
try {
  $bitmap = New-Object System.Drawing.Bitmap 256, 256
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.DrawImage($sourceImage, 0, 0, 256, 256)
    } finally {
      $graphics.Dispose()
    }
    $bitmap.Save($logoPng, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $bitmap.Dispose()
  }
} finally {
  $sourceImage.Dispose()
}

$pngBytes = [System.IO.File]::ReadAllBytes($logoPng)
$iconStream = [System.IO.File]::Create($iconFile)
$writer = New-Object System.IO.BinaryWriter $iconStream
try {
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]1)
  $writer.Write([Byte]0)
  $writer.Write([Byte]0)
  $writer.Write([Byte]0)
  $writer.Write([Byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$pngBytes.Length)
  $writer.Write([UInt32]22)
  $writer.Write($pngBytes)
} finally {
  $writer.Dispose()
  $iconStream.Dispose()
}

$references = @(
  "/reference:System.dll"
  "/reference:System.Core.dll"
  "/reference:System.Drawing.dll"
  "/reference:System.Windows.Forms.dll"
  "/reference:System.IO.Compression.dll"
  "/reference:System.IO.Compression.FileSystem.dll"
)
$common = @(
  "/nologo"
  "/target:winexe"
  "/platform:anycpu"
  "/optimize+"
  "/warn:4"
  "/win32icon:$iconFile"
  "/resource:$logoPng,minova.logo"
  "/resource:$releaseFile,minova.release"
) + $references

Write-Host "Compiling Minova uninstaller..."
& $compiler @common "/define:UNINSTALLER" "/out:$uninstaller" $source $assemblyInfo
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $uninstaller)) {
  throw "The Minova uninstaller failed to compile."
}

Write-Host "Compiling self-contained Minova installer..."
if (Test-Path -LiteralPath $setup) {
  Remove-Item -LiteralPath $setup -Force
}
& $compiler @common "/out:$setup" "/resource:$payloadZip,minova.payload" "/resource:$uninstaller,minova.uninstaller" $source $assemblyInfo
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $setup)) {
  throw "The Minova installer failed to compile."
}

$setupFile = Get-Item -LiteralPath $setup
$setupHash = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
$releaseMetadata = [ordered]@{
  schemaVersion = 1
  product = "Minova"
  channel = "stable"
  version = $Version
  installer = $setupFile.Name
  sha256 = $setupHash
  size = $setupFile.Length
  publishedAt = [DateTime]::UtcNow.ToString("o")
}
$releaseMetadata | ConvertTo-Json | Set-Content -LiteralPath $latest -Encoding UTF8
Set-Content -LiteralPath "$setup.sha256" -Value "$setupHash  $($setupFile.Name)" -Encoding ASCII

if (-not $KeepBuildFiles) {
  Remove-Item -LiteralPath $build -Recurse -Force
}

Write-Host ""
Write-Host "Minova installer ready:"
Write-Host "  $setup"
Write-Host "  SHA-256 $setupHash"
Write-Host "  Update metadata $latest"
