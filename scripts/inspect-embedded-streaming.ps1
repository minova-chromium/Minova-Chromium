[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [int]$OwnerProcessId,

  [Parameter(Mandatory = $true)]
  [string]$RendererScreenshotPath,

  [Parameter(Mandatory = $true)]
  [string]$CompositeScreenshotPath,

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

public static class MinovaEmbeddedInspector
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr state);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr state);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr state);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hWnd, StringBuilder name, int count);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

    public static IntPtr[] Windows()
    {
        var result = new List<IntPtr>();
        EnumWindows((window, state) => { result.Add(window); return true; }, IntPtr.Zero);
        return result.ToArray();
    }

    public static IntPtr[] Children(IntPtr parent)
    {
        var result = new List<IntPtr>();
        EnumChildWindows(parent, (window, state) => { result.Add(window); return true; }, IntPtr.Zero);
        return result.ToArray();
    }

    public static string ClassName(IntPtr window)
    {
        var name = new StringBuilder(256);
        GetClassName(window, name, name.Capacity);
        return name.ToString();
    }

    public static void EnablePerMonitorDpi()
    {
        try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { }
    }
}
"@

[MinovaEmbeddedInspector]::EnablePerMonitorDpi()

function Get-ProcessId([IntPtr]$Handle) {
  [uint32]$processId = 0
  [void][MinovaEmbeddedInspector]::GetWindowThreadProcessId($Handle, [ref]$processId)
  return [int]$processId
}

function Save-ScreenRectangle([System.Drawing.Rectangle]$Rectangle, [string]$Path) {
  $bitmap = [System.Drawing.Bitmap]::new($Rectangle.Width, $Rectangle.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($Rectangle.X, $Rectangle.Y, 0, 0, $bitmap.Size)
  $graphics.Dispose()
  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
}

$owner = [IntPtr]::Zero
foreach ($window in [MinovaEmbeddedInspector]::Windows()) {
  if ([MinovaEmbeddedInspector]::IsWindowVisible($window) -and (Get-ProcessId $window) -eq $OwnerProcessId) {
    $owner = $window
    break
  }
}
if ($owner -eq [IntPtr]::Zero) { throw "The Minova test window was not found." }

if ($PSBoundParameters.ContainsKey("MoveX") -and $MoveWidth -gt 0 -and $MoveHeight -gt 0) {
  [void][MinovaEmbeddedInspector]::ShowWindow($owner, 9)
  [void][MinovaEmbeddedInspector]::SetWindowPos($owner, [IntPtr]::Zero, $MoveX, $MoveY, $MoveWidth, $MoveHeight, 0x0040)
  Start-Sleep -Milliseconds 1200
}

$renderer = [IntPtr]::Zero
$rendererRect = [MinovaEmbeddedInspector+RECT]::new()
$largestArea = 0L
foreach ($child in [MinovaEmbeddedInspector]::Children($owner)) {
  if (-not [MinovaEmbeddedInspector]::IsWindowVisible($child)) { continue }
  if ([MinovaEmbeddedInspector]::ClassName($child) -notlike "*Chrome_RenderWidgetHostHWND*") { continue }
  $childProcess = Get-Process -Id (Get-ProcessId $child) -ErrorAction SilentlyContinue
  if (-not $childProcess -or $childProcess.ProcessName -ne "msedge") { continue }
  $rect = [MinovaEmbeddedInspector+RECT]::new()
  if (-not [MinovaEmbeddedInspector]::GetWindowRect($child, [ref]$rect)) { continue }
  $area = [long]($rect.Right - $rect.Left) * [long]($rect.Bottom - $rect.Top)
  if ($area -le $largestArea) { continue }
  $largestArea = $area
  $renderer = $child
  $rendererRect = $rect
}
if ($renderer -eq [IntPtr]::Zero) { throw "The embedded Edge webpage renderer was not found below Minova." }

$ownerRect = [MinovaEmbeddedInspector+RECT]::new()
$ownerClient = [MinovaEmbeddedInspector+RECT]::new()
$ownerOrigin = [MinovaEmbeddedInspector+POINT]::new()
[void][MinovaEmbeddedInspector]::GetWindowRect($owner, [ref]$ownerRect)
[void][MinovaEmbeddedInspector]::GetClientRect($owner, [ref]$ownerClient)
[void][MinovaEmbeddedInspector]::ClientToScreen($owner, [ref]$ownerOrigin)
$dpi = [MinovaEmbeddedInspector]::GetDpiForWindow($owner)
if ($dpi -le 0) { $dpi = 96 }
$chromePixels = [int][Math]::Round(102 * ([double]$dpi / 96.0))
$expected = @{
  X = $ownerOrigin.X
  Y = $ownerOrigin.Y + $chromePixels
  Width = $ownerClient.Right - $ownerClient.Left
  Height = ($ownerClient.Bottom - $ownerClient.Top) - $chromePixels
}

$rendererCapture = [System.Drawing.Rectangle]::new($rendererRect.Left, $rendererRect.Top, $rendererRect.Right - $rendererRect.Left, $rendererRect.Bottom - $rendererRect.Top)
$ownerCapture = [System.Drawing.Rectangle]::new($ownerRect.Left, $ownerRect.Top, $ownerRect.Right - $ownerRect.Left, $ownerRect.Bottom - $ownerRect.Top)
Save-ScreenRectangle $rendererCapture $RendererScreenshotPath
Save-ScreenRectangle $ownerCapture $CompositeScreenshotPath

$ancestors = @()
$ancestor = [MinovaEmbeddedInspector]::GetParent($renderer)
while ($ancestor -ne [IntPtr]::Zero -and $ancestor -ne $owner) {
  $rect = [MinovaEmbeddedInspector+RECT]::new()
  $client = [MinovaEmbeddedInspector+RECT]::new()
  $clientOrigin = [MinovaEmbeddedInspector+POINT]::new()
  [void][MinovaEmbeddedInspector]::GetWindowRect($ancestor, [ref]$rect)
  [void][MinovaEmbeddedInspector]::GetClientRect($ancestor, [ref]$client)
  [void][MinovaEmbeddedInspector]::ClientToScreen($ancestor, [ref]$clientOrigin)
  $ancestors += [pscustomobject]@{
    Handle = $ancestor.ToInt64().ToString()
    Class = [MinovaEmbeddedInspector]::ClassName($ancestor)
    ProcessId = Get-ProcessId $ancestor
    X = $rect.Left
    Y = $rect.Top
    Width = $rect.Right - $rect.Left
    Height = $rect.Bottom - $rect.Top
    ClientX = $clientOrigin.X
    ClientY = $clientOrigin.Y
    ClientWidth = $client.Right - $client.Left
    ClientHeight = $client.Bottom - $client.Top
  }
  $ancestor = [MinovaEmbeddedInspector]::GetParent($ancestor)
}

[pscustomobject]@{
  OwnerHandle = $owner.ToInt64().ToString()
  RendererHandle = $renderer.ToInt64().ToString()
  RendererProcess = (Get-Process -Id (Get-ProcessId $renderer) -ErrorAction Stop).ProcessName
  Renderer = @{ X = $rendererRect.Left; Y = $rendererRect.Top; Width = $rendererRect.Right - $rendererRect.Left; Height = $rendererRect.Bottom - $rendererRect.Top }
  Expected = $expected
  GeometryMatches = (
    $rendererRect.Left -eq $expected.X -and
    $rendererRect.Top -eq $expected.Y -and
    ($rendererRect.Right - $rendererRect.Left) -eq $expected.Width -and
    ($rendererRect.Bottom - $rendererRect.Top) -eq $expected.Height
  )
  Ancestors = $ancestors
  RendererScreenshotPath = $RendererScreenshotPath
  CompositeScreenshotPath = $CompositeScreenshotPath
} | ConvertTo-Json -Depth 6
