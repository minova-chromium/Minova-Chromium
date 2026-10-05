[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [int]$OwnerProcessId
)

$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class MinovaEdgeRendererInspector
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr state);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr state);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr state);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint command);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hWnd, StringBuilder name, int count);

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
}
"@

function Get-ProcessId([IntPtr]$Handle) {
  [uint32]$processId = 0
  [void][MinovaEdgeRendererInspector]::GetWindowThreadProcessId($Handle, [ref]$processId)
  return [int]$processId
}

$owner = [IntPtr]::Zero
foreach ($window in [MinovaEdgeRendererInspector]::Windows()) {
  if ((Get-ProcessId $window) -eq $OwnerProcessId) { $owner = $window; break }
}
if ($owner -eq [IntPtr]::Zero) { throw "Minova owner window not found." }

$overlay = [IntPtr]::Zero
foreach ($window in [MinovaEdgeRendererInspector]::Windows()) {
  if ([MinovaEdgeRendererInspector]::GetWindow($window, 4) -eq $owner) { $overlay = $window; break }
}
if ($overlay -eq [IntPtr]::Zero) { throw "Owned Edge overlay not found." }

$overlayRect = [MinovaEdgeRendererInspector+RECT]::new()
[void][MinovaEdgeRendererInspector]::GetWindowRect($overlay, [ref]$overlayRect)
$children = foreach ($window in [MinovaEdgeRendererInspector]::Children($overlay)) {
  $rect = [MinovaEdgeRendererInspector+RECT]::new()
  [void][MinovaEdgeRendererInspector]::GetWindowRect($window, [ref]$rect)
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  [pscustomobject]@{
    Handle = $window.ToInt64().ToString()
    Class = [MinovaEdgeRendererInspector]::ClassName($window)
    Visible = [MinovaEdgeRendererInspector]::IsWindowVisible($window)
    X = $rect.Left
    Y = $rect.Top
    Width = $width
    Height = $height
    Area = [long]$width * [long]$height
    OffsetX = $rect.Left - $overlayRect.Left
    OffsetY = $rect.Top - $overlayRect.Top
  }
}

[pscustomobject]@{
  Owner = $owner.ToInt64().ToString()
  Overlay = @{ X = $overlayRect.Left; Y = $overlayRect.Top; Width = $overlayRect.Right - $overlayRect.Left; Height = $overlayRect.Bottom - $overlayRect.Top }
  Children = @($children | Sort-Object Area -Descending | Select-Object -First 20)
} | ConvertTo-Json -Depth 5
