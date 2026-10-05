[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [int]$OwnerProcessId,

  [Parameter(Mandatory = $true)]
  [string]$ScreenshotPath,

  [string]$CompositeScreenshotPath = "",

  [int]$ChromeHeightDip = 102,

  [int]$SidebarWidthDip = 0,

  [int]$MoveX,
  [int]$MoveY,
  [int]$MoveWidth,
  [int]$MoveHeight
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class MinovaOverlayInspector
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr state);
    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr state);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr hWnd, uint command);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder className, int count);
    [DllImport("user32.dll")]
    public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")]
    public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
    [DllImport("user32.dll")]
    public static extern uint GetDpiForWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern int GetWindowLong(IntPtr hWnd, int index);
    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr deviceContext, uint flags);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")]
    public static extern int GetWindowRgn(IntPtr hWnd, IntPtr region);
    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
    [DllImport("gdi32.dll")]
    public static extern int GetRgnBox(IntPtr region, out RECT rect);
    [DllImport("gdi32.dll")]
    public static extern bool DeleteObject(IntPtr value);
    [DllImport("user32.dll")]
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

    public static IntPtr[] Windows()
    {
        var windows = new List<IntPtr>();
        EnumWindows((window, state) => { windows.Add(window); return true; }, IntPtr.Zero);
        return windows.ToArray();
    }

    public static bool TryGetLargestRenderer(IntPtr parent, out RECT rendererRect)
    {
        var found = false;
        var largestArea = 0L;
        var largestRect = new RECT();
        EnumChildWindows(parent, (window, state) =>
        {
            if (!IsWindowVisible(window)) return true;
            var className = new StringBuilder(256);
            GetClassName(window, className, className.Capacity);
            if (!className.ToString().Contains("Chrome_RenderWidgetHostHWND")) return true;
            RECT rect;
            if (!GetWindowRect(window, out rect)) return true;
            var area = (long)Math.Max(0, rect.Right - rect.Left) * Math.Max(0, rect.Bottom - rect.Top);
            if (area <= largestArea) return true;
            largestArea = area;
            largestRect = rect;
            found = true;
            return true;
        }, IntPtr.Zero);
        rendererRect = largestRect;
        return found;
    }

    public static void EnablePerMonitorDpi()
    {
        try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { }
    }
}
"@

[MinovaOverlayInspector]::EnablePerMonitorDpi()

function Get-WindowProcessId([IntPtr]$Handle) {
  [uint32]$processId = 0
  [void][MinovaOverlayInspector]::GetWindowThreadProcessId($Handle, [ref]$processId)
  return [int]$processId
}

$ownerHandle = [IntPtr]::Zero
$ownerArea = 0L
foreach ($handle in [MinovaOverlayInspector]::Windows()) {
  if ([MinovaOverlayInspector]::IsWindowVisible($handle) -and (Get-WindowProcessId $handle) -eq $OwnerProcessId) {
    $candidateRect = [MinovaOverlayInspector+RECT]::new()
    if (-not [MinovaOverlayInspector]::GetWindowRect($handle, [ref]$candidateRect)) { continue }
    $candidateArea = [long][Math]::Max(0, $candidateRect.Right - $candidateRect.Left) * [long][Math]::Max(0, $candidateRect.Bottom - $candidateRect.Top)
    if ($candidateArea -gt $ownerArea) {
      $ownerHandle = $handle
      $ownerArea = $candidateArea
    }
  }
}
if ($ownerHandle -eq [IntPtr]::Zero) { throw "The Minova test window was not found." }

if ($PSBoundParameters.ContainsKey("MoveX") -and $MoveWidth -gt 0 -and $MoveHeight -gt 0) {
  [void][MinovaOverlayInspector]::ShowWindow($ownerHandle, 9)
  [void][MinovaOverlayInspector]::SetWindowPos($ownerHandle, [IntPtr]::Zero, $MoveX, $MoveY, $MoveWidth, $MoveHeight, 0x0040)
  Start-Sleep -Milliseconds 1200
}

$overlayHandle = [IntPtr]::Zero
foreach ($handle in [MinovaOverlayInspector]::Windows()) {
  if (-not [MinovaOverlayInspector]::IsWindowVisible($handle)) { continue }
  if ([MinovaOverlayInspector]::GetWindow($handle, 4) -eq $ownerHandle) {
    $rect = [MinovaOverlayInspector+RECT]::new()
    [void][MinovaOverlayInspector]::GetWindowRect($handle, [ref]$rect)
    if (($rect.Right - $rect.Left) -ge 320 -and ($rect.Bottom - $rect.Top) -ge 240) {
      $overlayHandle = $handle
      break
    }
  }
}
if ($overlayHandle -eq [IntPtr]::Zero) { throw "No Minova-owned streaming window was found." }

$ownerRect = [MinovaOverlayInspector+RECT]::new()
$overlayRect = [MinovaOverlayInspector+RECT]::new()
[void][MinovaOverlayInspector]::GetWindowRect($ownerHandle, [ref]$ownerRect)
[void][MinovaOverlayInspector]::GetWindowRect($overlayHandle, [ref]$overlayRect)
$style = [MinovaOverlayInspector]::GetWindowLong($overlayHandle, -16)
$extendedStyle = [MinovaOverlayInspector]::GetWindowLong($overlayHandle, -20)
$overlayProcessId = Get-WindowProcessId $overlayHandle
$overlayProcess = Get-Process -Id $overlayProcessId -ErrorAction Stop
$ownerClient = [MinovaOverlayInspector+RECT]::new()
$ownerOrigin = [MinovaOverlayInspector+POINT]::new()
[void][MinovaOverlayInspector]::GetClientRect($ownerHandle, [ref]$ownerClient)
[void][MinovaOverlayInspector]::ClientToScreen($ownerHandle, [ref]$ownerOrigin)
$ownerDpi = [MinovaOverlayInspector]::GetDpiForWindow($ownerHandle)
if ($ownerDpi -le 0) { $ownerDpi = 96 }
$chromePixels = [Math]::Round($ChromeHeightDip * ([double]$ownerDpi / 96.0))
$sidebarPixels = [Math]::Round($SidebarWidthDip * ([double]$ownerDpi / 96.0))
$expectedVisible = @{
  X = $ownerOrigin.X + $sidebarPixels
  Y = $ownerOrigin.Y + $chromePixels
  Width = ($ownerClient.Right - $ownerClient.Left) - $sidebarPixels
  Height = ($ownerClient.Bottom - $ownerClient.Top) - $chromePixels
}
$rendererRect = [MinovaOverlayInspector+RECT]::new()
$rendererMeasurement = "renderer"
if (-not [MinovaOverlayInspector]::TryGetLargestRenderer($overlayHandle, [ref]$rendererRect)) {
  $overlayClient = [MinovaOverlayInspector+RECT]::new()
  $overlayClientOrigin = [MinovaOverlayInspector+POINT]::new()
  if (
    -not [MinovaOverlayInspector]::GetClientRect($overlayHandle, [ref]$overlayClient) -or
    -not [MinovaOverlayInspector]::ClientToScreen($overlayHandle, [ref]$overlayClientOrigin)
  ) {
    throw "Edge's webpage client rectangle was not found."
  }
  $rendererRect.Left = $overlayClientOrigin.X
  $rendererRect.Top = $overlayClientOrigin.Y
  $rendererRect.Right = $overlayClientOrigin.X + ($overlayClient.Right - $overlayClient.Left)
  $rendererRect.Bottom = $overlayClientOrigin.Y + ($overlayClient.Bottom - $overlayClient.Top)
  $rendererMeasurement = "client"
}
$leftCrop = $rendererRect.Left - $overlayRect.Left
$topCrop = $rendererRect.Top - $overlayRect.Top
$rightCrop = $overlayRect.Right - $rendererRect.Right
$bottomCrop = $overlayRect.Bottom - $rendererRect.Bottom
$geometryDelta = @{
  X = [Math]::Abs($rendererRect.Left - $expectedVisible.X)
  Y = [Math]::Abs($rendererRect.Top - $expectedVisible.Y)
  Width = [Math]::Abs(($rendererRect.Right - $rendererRect.Left) - $expectedVisible.Width)
  Height = [Math]::Abs(($rendererRect.Bottom - $rendererRect.Top) - $expectedVisible.Height)
}
$maximumGeometryDelta = ($geometryDelta.Values | Measure-Object -Maximum).Maximum

$width = [Math]::Max(1, $overlayRect.Right - $overlayRect.Left)
$height = [Math]::Max(1, $overlayRect.Bottom - $overlayRect.Top)
$bitmap = [System.Drawing.Bitmap]::new($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$deviceContext = $graphics.GetHdc()
try {
  $captured = [MinovaOverlayInspector]::PrintWindow($overlayHandle, $deviceContext, 2)
} finally {
  $graphics.ReleaseHdc($deviceContext)
  $graphics.Dispose()
}
$visibleRectangle = [System.Drawing.Rectangle]::new($leftCrop, $topCrop, [Math]::Max(1, $rendererRect.Right - $rendererRect.Left), [Math]::Max(1, $rendererRect.Bottom - $rendererRect.Top))
$visibleBitmap = $bitmap.Clone($visibleRectangle, $bitmap.PixelFormat)
$visibleBitmap.Save($ScreenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
$visibleBitmap.Dispose()
$bitmap.Dispose()

$regionRect = [MinovaOverlayInspector+RECT]::new()
$region = [MinovaOverlayInspector]::CreateRectRgn(0, 0, 0, 0)
$regionType = [MinovaOverlayInspector]::GetWindowRgn($overlayHandle, $region)
if ($regionType -gt 0) { [void][MinovaOverlayInspector]::GetRgnBox($region, [ref]$regionRect) }
[void][MinovaOverlayInspector]::DeleteObject($region)

if ($CompositeScreenshotPath) {
  $ownerWidth = [Math]::Max(1, $ownerRect.Right - $ownerRect.Left)
  $ownerHeight = [Math]::Max(1, $ownerRect.Bottom - $ownerRect.Top)
  $composite = [System.Drawing.Bitmap]::new($ownerWidth, $ownerHeight)
  $compositeGraphics = [System.Drawing.Graphics]::FromImage($composite)
  $compositeGraphics.CopyFromScreen($ownerRect.Left, $ownerRect.Top, 0, 0, $composite.Size)
  $compositeGraphics.Dispose()
  $composite.Save($CompositeScreenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $composite.Dispose()
}

[pscustomobject]@{
  OwnerHandle = $ownerHandle.ToInt64().ToString()
  OverlayHandle = $overlayHandle.ToInt64().ToString()
  OverlayProcess = $overlayProcess.ProcessName
  Owner = @{ X = $ownerRect.Left; Y = $ownerRect.Top; Width = $ownerRect.Right - $ownerRect.Left; Height = $ownerRect.Bottom - $ownerRect.Top }
  Overlay = @{ X = $overlayRect.Left; Y = $overlayRect.Top; Width = $width; Height = $height }
  RendererInsets = @{ Left = $leftCrop; Top = $topCrop; Right = $rightCrop; Bottom = $bottomCrop }
  AppliedRegion = @{ Type = $regionType; Left = $regionRect.Left; Top = $regionRect.Top; Right = $regionRect.Right; Bottom = $regionRect.Bottom }
  VisibleOverlay = @{ X = $rendererRect.Left; Y = $rendererRect.Top; Width = $rendererRect.Right - $rendererRect.Left; Height = $rendererRect.Bottom - $rendererRect.Top }
  RendererMeasurement = $rendererMeasurement
  ExpectedVisibleOverlay = $expectedVisible
  GeometryDelta = $geometryDelta
  MaximumGeometryDeltaPixels = $maximumGeometryDelta
  GeometryMatches = $maximumGeometryDelta -le 2
  FrameBitsRemoved = (($style -band 0x00CF0000) -eq 0)
  ToolWindow = (($extendedStyle -band 0x00000080) -ne 0)
  AppWindow = (($extendedStyle -band 0x00040000) -ne 0)
  ScreenshotCaptured = [bool]$captured
  ScreenshotPath = $ScreenshotPath
  CompositeScreenshotPath = $CompositeScreenshotPath
} | ConvertTo-Json -Depth 4
