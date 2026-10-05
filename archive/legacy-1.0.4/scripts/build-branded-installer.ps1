[CmdletBinding()]
param(
  [string]$Version,
  [string]$CoreSetup,
  [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $root "package.json") -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = [string]$package.version
}
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
  throw "Version must use semantic versioning, for example 1.0.2."
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $root "dist\update"
}
$output = [System.IO.Path]::GetFullPath($OutputDirectory)
$distRoot = [System.IO.Path]::GetFullPath((Join-Path $root "dist"))
if (-not $output.StartsWith($distRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Installer output must remain inside the project dist directory."
}
[System.IO.Directory]::CreateDirectory($output) | Out-Null

if ([string]::IsNullOrWhiteSpace($CoreSetup)) {
  $CoreSetup = Join-Path $output "Minova-Chromium-Update-$Version.exe"
}
$core = (Resolve-Path -LiteralPath $CoreSetup).Path
$coreFile = Get-Item -LiteralPath $core
$coreHash = (Get-FileHash -LiteralPath $core -Algorithm SHA256).Hash.ToLowerInvariant()
$build = Join-Path $output ".bootstrapper-$Version"
if (Test-Path -LiteralPath $build) {
  $resolvedBuild = (Resolve-Path -LiteralPath $build).Path
  if (-not $resolvedBuild.StartsWith($distRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean a bootstrapper directory outside dist."
  }
  Remove-Item -LiteralPath $resolvedBuild -Recurse -Force
}
[System.IO.Directory]::CreateDirectory($build) | Out-Null

$metadata = Join-Path $build "bootstrapper.properties"
$assemblyInfo = Join-Path $build "AssemblyInfo.cs"
$logoPng = Join-Path $build "minova-logo.png"
$iconFile = Join-Path $build "minova.ico"
$setup = Join-Path $output "Minova-Chromium-Setup-$Version.exe"
$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$frameworkDirectory = Split-Path -Parent $compiler
$wpfDirectory = Join-Path $frameworkDirectory "WPF"
$source = Join-Path $root "installer\MinovaBootstrapper.cs"
$sourceLogo = Join-Path $root "assets\logos\minova-browser.png"

if (-not (Test-Path -LiteralPath $compiler)) {
  throw "The Windows C# compiler was not found: $compiler"
}
if (-not (Test-Path -LiteralPath $source)) {
  throw "The branded installer source is missing: $source"
}

@(
  "version=$Version"
  "setupFileName=$($coreFile.Name)"
  "setupBytes=$($coreFile.Length)"
  "setupSha256=$coreHash"
) | Set-Content -LiteralPath $metadata -Encoding ASCII

$numericVersion = ($Version -split '-', 2)[0]
$versionParts = @($numericVersion.Split('.') | ForEach-Object { [int]$_ })
while ($versionParts.Count -lt 4) {
  $versionParts += 0
}
$assemblyVersion = ($versionParts[0..3] -join '.')
@"
using System.Reflection;
[assembly: AssemblyTitle("Minova Setup")]
[assembly: AssemblyDescription("Installs Minova Chromium")]
[assembly: AssemblyCompany("Minova")]
[assembly: AssemblyProduct("Minova Chromium")]
[assembly: AssemblyCopyright("Copyright Minova contributors")]
[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$assemblyVersion")]
[assembly: AssemblyInformationalVersion("$Version")]
"@ | Set-Content -LiteralPath $assemblyInfo -Encoding UTF8

Add-Type -AssemblyName System.Drawing
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
  "/reference:$(Join-Path $frameworkDirectory 'System.dll')"
  "/reference:$(Join-Path $frameworkDirectory 'System.Core.dll')"
  "/reference:$(Join-Path $frameworkDirectory 'System.Drawing.dll')"
  "/reference:$(Join-Path $frameworkDirectory 'System.Windows.Forms.dll')"
  "/reference:$(Join-Path $wpfDirectory 'WindowsBase.dll')"
  "/reference:$(Join-Path $wpfDirectory 'PresentationCore.dll')"
  "/reference:$(Join-Path $wpfDirectory 'PresentationFramework.dll')"
  "/reference:$(Join-Path $frameworkDirectory 'System.Xaml.dll')"
)
$arguments = @(
  "/nologo"
  "/target:winexe"
  "/platform:anycpu"
  "/optimize+"
  "/warn:4"
  "/win32icon:$iconFile"
  "/resource:$logoPng,minova.logo"
  "/resource:$metadata,minova.bootstrapper"
  "/resource:$core,minova.setup"
  "/out:$setup"
) + $references + @($source, $assemblyInfo)

if (Test-Path -LiteralPath $setup) {
  Remove-Item -LiteralPath $setup -Force
}
Write-Host "Compiling the branded Minova $Version installer..."
& $compiler @arguments
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $setup)) {
  throw "The branded Minova installer failed to compile."
}

$setupHash = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
$signature = Get-AuthenticodeSignature -LiteralPath $setup
if ($signature.Status -eq [System.Management.Automation.SignatureStatus]::NotSigned) {
  Write-Warning "The branded installer is not Authenticode signed. Configure Windows code signing before a public production release to avoid SmartScreen warnings."
}
Remove-Item -LiteralPath $build -Recurse -Force
Write-Host "Branded installer ready:"
Write-Host "  $setup"
Write-Host "  SHA-256 $setupHash"
