[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [int]$OwnerProcessId,

  [int]$ChromeHeightDip = 102,

  [int]$ToolbarHeightDip = 60,

  [int]$SidebarWidthDip = 0,

  [int]$SampleDelayMilliseconds = 32
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class MinovaMotionInspector
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr state);

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
    [DllImport("user32.dll")]
    public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")]
    public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
    [DllImport("user32.dll")]
    public static extern uint GetDpiForWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder className, int count);
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

[MinovaMotionInspector]::EnablePerMonitorDpi()

function Get-ProcessId([IntPtr]$Handle) {
  [uint32]$processId = 0
  [void][MinovaMotionInspector]::GetWindowThreadProcessId($Handle, [ref]$processId)
  return [int]$processId
}

function Get-Rect([IntPtr]$Handle) {
  $rect = [MinovaMotionInspector+RECT]::new()
  if (-not [MinovaMotionInspector]::GetWindowRect($Handle, [ref]$rect)) { return $null }
  return $rect
}

function Get-Delta([int]$Actual, [int]$Expected) {
  return [Math]::Abs($Actual - $Expected)
}

function Wait-RendererRect([IntPtr]$Handle, [int]$TimeoutMilliseconds = 2000) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
  do {
    $renderer = [MinovaMotionInspector+RECT]::new()
    if ([MinovaMotionInspector]::TryGetLargestRenderer($Handle, [ref]$renderer)) {
      return $renderer
    }
    Start-Sleep -Milliseconds 25
  } while ([DateTime]::UtcNow -lt $deadline)
  return $null
}

$ownerHandle = [IntPtr]::Zero
$ownerArea = 0L
foreach ($handle in [MinovaMotionInspector]::Windows()) {
  if (-not [MinovaMotionInspector]::IsWindowVisible($handle)) { continue }
  if ((Get-ProcessId $handle) -ne $OwnerProcessId) { continue }
  $rect = Get-Rect $handle
  if (-not $rect) { continue }
  $area = [long][Math]::Max(0, $rect.Right - $rect.Left) * [long][Math]::Max(0, $rect.Bottom - $rect.Top)
  if ($area -gt $ownerArea) {
    $ownerArea = $area
    $ownerHandle = $handle
  }
}
if ($ownerHandle -eq [IntPtr]::Zero) { throw "The Minova owner window was not found." }

$overlayHandle = [IntPtr]::Zero
foreach ($handle in [MinovaMotionInspector]::Windows()) {
  if (-not [MinovaMotionInspector]::IsWindowVisible($handle)) { continue }
  if ([MinovaMotionInspector]::GetWindow($handle, 4) -ne $ownerHandle) { continue }
  $rect = Get-Rect $handle
  if ($rect -and ($rect.Right - $rect.Left) -ge 320 -and ($rect.Bottom - $rect.Top) -ge 240) {
    $overlayHandle = $handle
    break
  }
}
if ($overlayHandle -eq [IntPtr]::Zero) { throw "The owned Edge streaming window was not found." }

$toolbarHandle = [IntPtr]::Zero
$toolbarArea = 0L
$toolbarCandidates = @()
foreach ($handle in [MinovaMotionInspector]::Windows()) {
  if (-not [MinovaMotionInspector]::IsWindowVisible($handle)) { continue }
  if ((Get-ProcessId $handle) -ne $OwnerProcessId) { continue }
  if ($handle -eq $ownerHandle) { continue }
  $rect = Get-Rect $handle
  if ($rect -and ($rect.Right - $rect.Left) -ge 320 -and ($rect.Bottom - $rect.Top) -le 160) {
    $area = [long]($rect.Right - $rect.Left) * [long]($rect.Bottom - $rect.Top)
    $toolbarCandidates += [pscustomobject]@{
      Handle = $handle.ToInt64().ToString()
      Owner = [MinovaMotionInspector]::GetWindow($handle, 4).ToInt64().ToString()
      X = $rect.Left
      Y = $rect.Top
      Width = $rect.Right - $rect.Left
      Height = $rect.Bottom - $rect.Top
    }
    if ($area -gt $toolbarArea) {
      $toolbarArea = $area
      $toolbarHandle = $handle
    }
  }
}
if ($toolbarHandle -eq [IntPtr]::Zero) { throw "The streaming toolbar proxy was not found." }

[void][MinovaMotionInspector]::ShowWindow($ownerHandle, 9)
$positions = @(
  @{ X = 120; Y = 90; Width = 1380; Height = 820 },
  @{ X = 150; Y = 110; Width = 1410; Height = 835 },
  @{ X = 185; Y = 135; Width = 1440; Height = 850 },
  @{ X = 220; Y = 160; Width = 1470; Height = 865 },
  @{ X = 255; Y = 185; Width = 1500; Height = 880 },
  @{ X = 290; Y = 210; Width = 1530; Height = 895 },
  @{ X = 240; Y = 170; Width = 1480; Height = 870 },
  @{ X = 190; Y = 130; Width = 1430; Height = 845 }
)

$samples = @()
foreach ($position in $positions) {
  [void][MinovaMotionInspector]::SetWindowPos(
    $ownerHandle,
    [IntPtr]::Zero,
    $position.X,
    $position.Y,
    $position.Width,
    $position.Height,
    0x0040
  )
  Start-Sleep -Milliseconds $SampleDelayMilliseconds

  $client = [MinovaMotionInspector+RECT]::new()
  $origin = [MinovaMotionInspector+POINT]::new()
  [void][MinovaMotionInspector]::GetClientRect($ownerHandle, [ref]$client)
  [void][MinovaMotionInspector]::ClientToScreen($ownerHandle, [ref]$origin)
  $dpi = [MinovaMotionInspector]::GetDpiForWindow($ownerHandle)
  if ($dpi -le 0) { $dpi = 96 }
  $scale = [double]$dpi / 96.0
  $chromePixels = [int][Math]::Round($ChromeHeightDip * $scale)
  $toolbarPixels = [int][Math]::Round($ToolbarHeightDip * $scale)
  $titlebarPixels = $chromePixels - $toolbarPixels
  $sidebarPixels = [int][Math]::Round($SidebarWidthDip * $scale)

  $renderer = Wait-RendererRect -Handle $overlayHandle
  if (-not $renderer) {
    throw "Edge's renderer disappeared during movement."
  }
  $toolbar = Get-Rect $toolbarHandle
  if (-not $toolbar) { throw "The toolbar proxy disappeared during movement." }

  $expectedPage = @{
    X = $origin.X + $sidebarPixels
    Y = $origin.Y + $chromePixels
    Width = ($client.Right - $client.Left) - $sidebarPixels
    Height = ($client.Bottom - $client.Top) - $chromePixels
  }
  $expectedToolbar = @{
    X = $origin.X + $sidebarPixels
    Y = $origin.Y + $titlebarPixels
    Width = ($client.Right - $client.Left) - $sidebarPixels
    Height = $toolbarPixels
  }
  $pageDelta = @{
    X = Get-Delta $renderer.Left $expectedPage.X
    Y = Get-Delta $renderer.Top $expectedPage.Y
    Width = Get-Delta ($renderer.Right - $renderer.Left) $expectedPage.Width
    Height = Get-Delta ($renderer.Bottom - $renderer.Top) $expectedPage.Height
  }
  $toolbarDelta = @{
    X = Get-Delta $toolbar.Left $expectedToolbar.X
    Y = Get-Delta $toolbar.Top $expectedToolbar.Y
    Width = Get-Delta ($toolbar.Right - $toolbar.Left) $expectedToolbar.Width
    Height = Get-Delta ($toolbar.Bottom - $toolbar.Top) $expectedToolbar.Height
  }
  $samples += [pscustomobject]@{
    Requested = $position
    PageDelta = $pageDelta
    ToolbarDelta = $toolbarDelta
    SeamDelta = Get-Delta $renderer.Top $toolbar.Bottom
  }
}

$maximumDelta = 0
foreach ($sample in $samples) {
  foreach ($value in @($sample.PageDelta.Values) + @($sample.ToolbarDelta.Values) + @($sample.SeamDelta)) {
    $maximumDelta = [Math]::Max($maximumDelta, [int]$value)
  }
}

[pscustomobject]@{
  Passed = $maximumDelta -le 2
  MaximumDeltaPixels = $maximumDelta
  SampleDelayMilliseconds = $SampleDelayMilliseconds
  ToolbarCandidates = $toolbarCandidates
  Samples = $samples
} | ConvertTo-Json -Depth 6

if ($maximumDelta -gt 2) { exit 1 }
