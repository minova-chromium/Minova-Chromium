[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$brandRoot = Split-Path -Parent $PSScriptRoot
$assetRoot = Join-Path $brandRoot 'assets'
$exportRoot = Join-Path $brandRoot 'exports'
$iconRoot = Join-Path $exportRoot 'icons'
$logoRoot = Join-Path $exportRoot 'logos'
$iconSizes = @(16, 24, 32, 48, 64, 128, 256, 512, 1024)

Add-Type -AssemblyName System.Drawing

function Render-Svg {
  param(
    [Parameter(Mandatory)][string]$Source,
    [Parameter(Mandatory)][string]$Output,
    [Parameter(Mandatory)][int]$Width,
    [Parameter(Mandatory)][int]$Height
  )

  $browser = @(
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
  ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

  if (-not $browser) {
    throw 'Minova brand export requires Microsoft Edge or Google Chrome to render SVG assets.'
  }

  if (Test-Path -LiteralPath $Output) {
    Remove-Item -LiteralPath $Output -Force
  }

  $sourceUri = (New-Object System.Uri($Source)).AbsoluteUri
  & $browser `
    --headless=new `
    --disable-gpu `
    --disable-software-rasterizer `
    --no-sandbox `
    --disable-features=UseSkiaRenderer,Vulkan `
    --hide-scrollbars `
    --run-all-compositor-stages-before-draw `
    --default-background-color=00000000 `
    "--window-size=$Width,$Height" `
    "--screenshot=$Output" `
    $sourceUri | Out-Null

  for ($attempt = 0; $attempt -lt 100 -and -not (Test-Path -LiteralPath $Output); $attempt++) {
    Start-Sleep -Milliseconds 100
  }

  if (-not (Test-Path -LiteralPath $Output)) {
    throw "SVG render failed: $Source"
  }
}

function Resize-Png {
  param(
    [Parameter(Mandatory)][string]$Source,
    [Parameter(Mandatory)][string]$Output,
    [Parameter(Mandatory)][int]$Size
  )

  $sourceImage = [System.Drawing.Image]::FromFile($Source)
  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($sourceImage, 0, 0, $Size, $Size)
    $bitmap.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  finally {
    $graphics.Dispose()
    $bitmap.Dispose()
    $sourceImage.Dispose()
  }
}

function Write-PngIco {
  param(
    [Parameter(Mandatory)][array]$Images,
    [Parameter(Mandatory)][string]$Output
  )

  $records = foreach ($image in $Images) {
    [pscustomobject]@{
      Size = [int]$image.Size
      Bytes = [System.IO.File]::ReadAllBytes([string]$image.Path)
    }
  }

  $stream = [System.IO.File]::Open($Output, [System.IO.FileMode]::Create)
  $writer = New-Object System.IO.BinaryWriter($stream)

  try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$records.Count)
    $offset = 6 + (16 * $records.Count)

    foreach ($record in $records) {
      $dimension = if ($record.Size -ge 256) { 0 } else { $record.Size }
      $writer.Write([byte]$dimension)
      $writer.Write([byte]$dimension)
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      $writer.Write([uint16]1)
      $writer.Write([uint16]32)
      $writer.Write([uint32]$record.Bytes.Length)
      $writer.Write([uint32]$offset)
      $offset += $record.Bytes.Length
    }

    foreach ($record in $records) {
      $writer.Write($record.Bytes)
    }
  }
  finally {
    $writer.Dispose()
    $stream.Dispose()
  }
}

$approvedIcon = Join-Path $assetRoot 'minova-symbol-color.svg'
$approvedLockup = Join-Path $assetRoot 'minova-lockup-dark.svg'
$approvedWordmark = Join-Path $assetRoot 'minova-wordmark-dark.svg'
if (-not (Test-Path -LiteralPath $approvedIcon)) { throw "Missing approved icon master: $approvedIcon" }
if (-not (Test-Path -LiteralPath $approvedLockup)) { throw "Missing approved lockup master: $approvedLockup" }
if (-not (Test-Path -LiteralPath $approvedWordmark)) { throw "Missing approved wordmark master: $approvedWordmark" }

New-Item -ItemType Directory -Path $iconRoot -Force | Out-Null
New-Item -ItemType Directory -Path $logoRoot -Force | Out-Null

# Render the vector master first, then derive every raster size from that file.
$iconMaster = Join-Path $iconRoot 'minova-1024.png'
Render-Svg -Source $approvedIcon -Output $iconMaster -Width 1024 -Height 1024

foreach ($size in $iconSizes) {
  if ($size -eq 1024) { continue }
  Resize-Png -Source $iconMaster -Output (Join-Path $iconRoot "minova-$size.png") -Size $size
}

$icoImages = foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
  [pscustomobject]@{ Size = $size; Path = Join-Path $iconRoot "minova-$size.png" }
}
Write-PngIco -Images $icoImages -Output (Join-Path $iconRoot 'minova.ico')

Render-Svg -Source $approvedLockup -Output (Join-Path $logoRoot 'minova-lockup-dark.png') -Width 1810 -Height 512
Render-Svg -Source $approvedWordmark -Output (Join-Path $logoRoot 'minova-wordmark-dark.png') -Width 875 -Height 182

$obsoleteLightLockup = Join-Path $logoRoot 'minova-lockup-light.png'
if (Test-Path -LiteralPath $obsoleteLightLockup) {
  Remove-Item -LiteralPath $obsoleteLightLockup -Force
}

Write-Host "Minova brand exports written to $exportRoot"
