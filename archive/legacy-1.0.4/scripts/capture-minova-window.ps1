param(
  [Parameter(Mandatory = $true)]
  [int]$ProcessId,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class MinovaWindowCapture
{
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@

$process = Get-Process -Id $ProcessId -ErrorAction Stop
$deadline = [DateTime]::UtcNow.AddSeconds(12)
while ($process.MainWindowHandle -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline) {
  Start-Sleep -Milliseconds 150
  $process.Refresh()
}

if ($process.MainWindowHandle -eq [IntPtr]::Zero) {
  throw "The Minova process does not have a capturable main window."
}

$rect = New-Object MinovaWindowCapture+Rect
if (-not [MinovaWindowCapture]::GetWindowRect($process.MainWindowHandle, [ref]$rect)) {
  throw "Windows could not read the Minova window bounds."
}

$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -lt 1 -or $height -lt 1) {
  throw "The Minova window has invalid bounds: ${width}x${height}."
}

$directory = Split-Path -Parent $OutputPath
if ($directory) {
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

[MinovaWindowCapture]::ShowWindowAsync($process.MainWindowHandle, 9) | Out-Null
[MinovaWindowCapture]::BringWindowToTop($process.MainWindowHandle) | Out-Null
[MinovaWindowCapture]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 420

$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen(
    (New-Object System.Drawing.Point($rect.Left, $rect.Top)),
    [System.Drawing.Point]::Empty,
    (New-Object System.Drawing.Size($width, $height))
  )
  $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}

[pscustomobject]@{
  ProcessId = $ProcessId
  OutputPath = (Resolve-Path -LiteralPath $OutputPath).Path
  Width = $width
  Height = $height
} | ConvertTo-Json -Compress
