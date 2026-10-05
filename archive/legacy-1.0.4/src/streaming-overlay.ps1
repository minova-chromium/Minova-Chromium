[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$BrowserPath,

  [Parameter(Mandatory = $true)]
  [string]$ArgumentsBase64,

  [Parameter(Mandatory = $true)]
  [long]$OwnerHandle,

  [Parameter(Mandatory = $true)]
  [long]$ToolbarHandle,

  [Parameter(Mandatory = $true)]
  [int]$ChromeHeightDip,

  [Parameter(Mandatory = $true)]
  [int]$ToolbarHeightDip,

  [Parameter(Mandatory = $true)]
  [int]$SidebarWidthDip,

  [Parameter(Mandatory = $true)]
  [int]$X,

  [Parameter(Mandatory = $true)]
  [int]$Y,

  [Parameter(Mandatory = $true)]
  [int]$Width,

  [Parameter(Mandatory = $true)]
  [int]$Height
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class MinovaNativeWindow
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MONITORINFO
    {
        public int Size;
        public RECT Monitor;
        public RECT WorkArea;
        public uint Flags;
    }

    // Console.In.ReadLineAsync blocks synchronously under Windows PowerShell
    // 5.1. Keep command input on a background thread so native window tracking
    // never pauses while waiting for JavaScript IPC.
    public sealed class CommandReader
    {
        private readonly ConcurrentQueue<string> lines = new ConcurrentQueue<string>();
        private readonly Thread thread;
        private volatile bool ended;

        public CommandReader()
        {
            thread = new Thread(ReadLoop);
            thread.IsBackground = true;
            thread.Name = "Minova streaming command reader";
            thread.Start();
        }

        private void ReadLoop()
        {
            try
            {
                string line;
                while ((line = Console.In.ReadLine()) != null)
                    lines.Enqueue(line);
            }
            finally
            {
                ended = true;
            }
        }

        public string TryReadLine()
        {
            string line;
            return lines.TryDequeue(out line) ? line : null;
        }

        public bool HasEnded
        {
            get { return ended && lines.IsEmpty; }
        }
    }

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr hWnd, uint command);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

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
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);

    [DllImport("user32.dll")]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);

    [DllImport("user32.dll")]
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

    [DllImport("user32.dll")]
    public static extern int GetWindowLong(IntPtr hWnd, int index);

    [DllImport("user32.dll")]
    public static extern int SetWindowLong(IntPtr hWnd, int index, int value);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr")]
    private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int index, IntPtr value);

    [DllImport("user32.dll", EntryPoint = "SetWindowLong")]
    private static extern int SetWindowLong32(IntPtr hWnd, int index, int value);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr SetFocus(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetFocus();

    [DllImport("user32.dll")]
    public static extern IntPtr SetActiveWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool EnableWindow(IntPtr hWnd, bool enable);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint attachThread, uint attachToThread, bool attach);

    [DllImport("user32.dll")]
    public static extern IntPtr SetParent(IntPtr child, IntPtr parent);

    [DllImport("user32.dll")]
    public static extern IntPtr GetParent(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool DestroyWindow(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateWindowEx(int extendedStyle, string className, string windowName, int style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);

    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern int SetWindowRgn(IntPtr hWnd, IntPtr region, bool redraw);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteObject(IntPtr value);

    public static bool TryGetMonitorRect(IntPtr window, out RECT monitorRect)
    {
        var monitor = MonitorFromWindow(window, 2);
        var info = new MONITORINFO();
        info.Size = Marshal.SizeOf(typeof(MONITORINFO));
        if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref info))
        {
            monitorRect = new RECT();
            return false;
        }
        monitorRect = info.Monitor;
        return true;
    }

    public static void SendF11(IntPtr browser)
    {
        const uint WM_KEYDOWN = 0x0100;
        const uint WM_KEYUP = 0x0101;
        var renderer = GetLargestRendererHandle(browser);
        var target = renderer != IntPtr.Zero ? renderer : browser;
        PostMessage(target, WM_KEYDOWN, new IntPtr(0x7A), new IntPtr(0x00570001));
        PostMessage(target, WM_KEYUP, new IntPtr(0x7A), new IntPtr(unchecked((long)0xC0570001)));
    }

    public static IntPtr[] GetTopLevelWindows()
    {
        var windows = new List<IntPtr>();
        EnumWindows((window, state) =>
        {
            windows.Add(window);
            return true;
        }, IntPtr.Zero);
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
            var width = Math.Max(0, rect.Right - rect.Left);
            var height = Math.Max(0, rect.Bottom - rect.Top);
            var area = (long)width * height;
            if (area <= largestArea) return true;
            largestArea = area;
            largestRect = rect;
            found = true;
            return true;
        }, IntPtr.Zero);
        rendererRect = largestRect;
        return found;
    }

    public static IntPtr GetLargestRendererHandle(IntPtr parent)
    {
        var largestHandle = IntPtr.Zero;
        var largestArea = 0L;
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
            largestHandle = window;
            return true;
        }, IntPtr.Zero);
        return largestHandle;
    }

    private static uint attachedOwnerThread;
    private static uint attachedBrowserThread;
    private static uint attachedHostThread;

    public static bool ConnectInputQueues(IntPtr owner, IntPtr host, IntPtr browser)
    {
        uint ignored;
        attachedOwnerThread = GetWindowThreadProcessId(owner, out ignored);
        attachedHostThread = GetWindowThreadProcessId(host, out ignored);
        attachedBrowserThread = GetWindowThreadProcessId(browser, out ignored);
        var currentThread = GetCurrentThreadId();
        var connected = true;
        if (attachedOwnerThread != 0 && attachedOwnerThread != currentThread)
            connected = AttachThreadInput(currentThread, attachedOwnerThread, true) && connected;
        if (attachedBrowserThread != 0 && attachedBrowserThread != currentThread)
            connected = AttachThreadInput(currentThread, attachedBrowserThread, true) && connected;
        if (attachedOwnerThread != 0 && attachedBrowserThread != 0 && attachedOwnerThread != attachedBrowserThread)
            AttachThreadInput(attachedOwnerThread, attachedBrowserThread, true);
        return connected;
    }

    public static void DisconnectInputQueues()
    {
        var currentThread = GetCurrentThreadId();
        if (attachedOwnerThread != 0 && attachedBrowserThread != 0 && attachedOwnerThread != attachedBrowserThread)
            AttachThreadInput(attachedOwnerThread, attachedBrowserThread, false);
        if (attachedBrowserThread != 0 && attachedBrowserThread != currentThread)
            AttachThreadInput(currentThread, attachedBrowserThread, false);
        if (attachedOwnerThread != 0 && attachedOwnerThread != currentThread)
            AttachThreadInput(currentThread, attachedOwnerThread, false);
        attachedOwnerThread = 0;
        attachedBrowserThread = 0;
        attachedHostThread = 0;
    }

    public static bool FocusEmbeddedBrowser(IntPtr owner, IntPtr host, IntPtr browser)
    {
        if (host != IntPtr.Zero) EnableWindow(host, true);
        EnableWindow(browser, true);
        ConnectInputQueues(owner, host, browser);
        SetForegroundWindow(browser);
        BringWindowToTop(browser);
        SetActiveWindow(browser);
        var renderer = GetLargestRendererHandle(browser);
        var focusTarget = renderer != IntPtr.Zero ? renderer : browser;
        SetFocus(focusTarget);
        return GetFocus() == focusTarget;
    }

    public static IntPtr SetOwner(IntPtr window, IntPtr owner)
    {
        return IntPtr.Size == 8
            ? SetWindowLongPtr64(window, -8, owner)
            : new IntPtr(SetWindowLong32(window, -8, owner.ToInt32()));
    }

    public static void EnablePerMonitorDpi()
    {
        try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { }
    }

    public static IntPtr CreateClipHost(IntPtr parent)
    {
        const int WS_CHILD = 0x40000000;
        const int WS_CLIPCHILDREN = 0x02000000;
        const int WS_CLIPSIBLINGS = 0x04000000;
        const int WS_TABSTOP = 0x00010000;
        return CreateWindowEx(0, "Static", "", WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS | WS_TABSTOP, 0, 0, 1, 1, parent, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
    }
}
"@

[MinovaNativeWindow]::EnablePerMonitorDpi()

function Write-OverlayEvent {
  param([hashtable]$Payload)
  [Console]::Out.WriteLine(($Payload | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

function Get-BrowserWindows {
  $processName = [System.IO.Path]::GetFileNameWithoutExtension($BrowserPath)
  $processIds = @(
    Get-Process -Name $processName -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty Id
  )
  if (-not $processIds.Count) { return @() }

  $idSet = [System.Collections.Generic.HashSet[uint32]]::new()
  foreach ($processId in $processIds) { [void]$idSet.Add([uint32]$processId) }
  $windows = @()
  foreach ($handle in [MinovaNativeWindow]::GetTopLevelWindows()) {
    if (-not [MinovaNativeWindow]::IsWindowVisible($handle)) { continue }
    [uint32]$processId = 0
    [void][MinovaNativeWindow]::GetWindowThreadProcessId($handle, [ref]$processId)
    if (-not $idSet.Contains($processId)) { continue }
    $rect = [MinovaNativeWindow+RECT]::new()
    if (-not [MinovaNativeWindow]::GetWindowRect($handle, [ref]$rect)) { continue }
    $windowWidth = [Math]::Max(0, $rect.Right - $rect.Left)
    $windowHeight = [Math]::Max(0, $rect.Bottom - $rect.Top)
    if ($windowWidth -lt 320 -or $windowHeight -lt 240) { continue }
    $windows += [pscustomobject]@{
      Handle = $handle
      ProcessId = $processId
      Area = [long]$windowWidth * [long]$windowHeight
    }
  }
  return $windows
}

function Set-EmbeddedBounds {
  param(
    [IntPtr]$Handle,
    [int]$Left,
    [int]$Top,
    [int]$OverlayWidth,
    [int]$OverlayHeight,
    [switch]$RefreshFrame,
    [switch]$Calibrate
  )
  $windowRect = [MinovaNativeWindow+RECT]::new()
  $rendererRect = [MinovaNativeWindow+RECT]::new()
  $hasWindowRect = [MinovaNativeWindow]::GetWindowRect($Handle, [ref]$windowRect)
  $hasRenderer = [MinovaNativeWindow]::TryGetLargestRenderer($Handle, [ref]$rendererRect)
  if ($hasWindowRect -and $hasRenderer) {
    $leftCrop = [Math]::Max(0, $rendererRect.Left - $windowRect.Left)
    $topCrop = [Math]::Max(0, $rendererRect.Top - $windowRect.Top)
    $rightCrop = [Math]::Max(0, $windowRect.Right - $rendererRect.Right)
    $bottomCrop = [Math]::Max(0, $windowRect.Bottom - $rendererRect.Bottom)
  } elseif ($hasWindowRect) {
    # Current Edge builds do not always expose a visible renderer HWND. The
    # top-level client rectangle is the exact webpage viewport in that case and
    # is more reliable than guessed frame insets at non-default DPI settings.
    $clientRect = [MinovaNativeWindow+RECT]::new()
    $clientOrigin = [MinovaNativeWindow+POINT]::new()
    if (
      [MinovaNativeWindow]::GetClientRect($Handle, [ref]$clientRect) -and
      [MinovaNativeWindow]::ClientToScreen($Handle, [ref]$clientOrigin)
    ) {
      $clientRight = $clientOrigin.X + [Math]::Max(0, $clientRect.Right - $clientRect.Left)
      $clientBottom = $clientOrigin.Y + [Math]::Max(0, $clientRect.Bottom - $clientRect.Top)
      $leftCrop = [Math]::Max(0, $clientOrigin.X - $windowRect.Left)
      $topCrop = [Math]::Max(0, $clientOrigin.Y - $windowRect.Top)
      $rightCrop = [Math]::Max(0, $windowRect.Right - $clientRight)
      $bottomCrop = [Math]::Max(0, $windowRect.Bottom - $clientBottom)
    } else {
      $hasWindowRect = $false
    }
  }
  if (-not $hasWindowRect) {
    # Last-resort defaults are only used if Win32 cannot read either rectangle.
    # A later layout pass will retry with live window geometry.
    $dpi = [MinovaNativeWindow]::GetDpiForWindow($Handle)
    if ($dpi -le 0) { $dpi = 96 }
    $scale = [double]$dpi / 96.0
    $leftCrop = [Math]::Max(1, [int][Math]::Round(6 * $scale))
    $topCrop = [Math]::Max(1, [int][Math]::Round(28 * $scale))
    $rightCrop = $leftCrop
    $bottomCrop = [Math]::Max(1, [int][Math]::Round(8 * $scale))
  }
  # Recalculate from Edge's current renderer frame every time. Persistent
  # corrections drift after DPI, maximize, or sidebar changes.
  $nativeWidth = [Math]::Max(320, $OverlayWidth) + $leftCrop + $rightCrop
  $nativeHeight = [Math]::Max(240, $OverlayHeight) + $topCrop + $bottomCrop
  $nativeX = $Left - $leftCrop
  $nativeY = $Top - $topCrop
  $flags = [uint32]0x0054
  if ($RefreshFrame) { $flags = $flags -bor [uint32]0x0020 }
  [void][MinovaNativeWindow]::SetWindowPos(
    $Handle,
    [IntPtr]::Zero,
    $nativeX,
    $nativeY,
    $nativeWidth,
    $nativeHeight,
    $flags
  )
  $updatedWindowRect = [MinovaNativeWindow+RECT]::new()
  [void][MinovaNativeWindow]::GetWindowRect($Handle, [ref]$updatedWindowRect)
  $regionLeft = [Math]::Max(0, $Left - $updatedWindowRect.Left)
  $regionTop = [Math]::Max(0, $Top - $updatedWindowRect.Top)
  $region = [MinovaNativeWindow]::CreateRectRgn($regionLeft, $regionTop, $regionLeft + [Math]::Max(320, $OverlayWidth), $regionTop + [Math]::Max(240, $OverlayHeight))
  if ([MinovaNativeWindow]::SetWindowRgn($Handle, $region, $true) -eq 0) {
    [void][MinovaNativeWindow]::DeleteObject($region)
  }

  if ($Calibrate) {
    # Edge may finish replacing its startup renderer after the first move.
    # Converge directly on the requested renderer rectangle without retaining
    # a correction that can become stale later.
    for ($attempt = 0; $attempt -lt 3; $attempt += 1) {
      Start-Sleep -Milliseconds 18
      $actualRenderer = [MinovaNativeWindow+RECT]::new()
      if (-not [MinovaNativeWindow]::TryGetLargestRenderer($Handle, [ref]$actualRenderer)) { break }
      $deltaX = [Math]::Max(-16, [Math]::Min(16, $Left - $actualRenderer.Left))
      $deltaY = [Math]::Max(-16, [Math]::Min(16, $Top - $actualRenderer.Top))
      $deltaWidth = [Math]::Max(-16, [Math]::Min(16, [Math]::Max(320, $OverlayWidth) - ($actualRenderer.Right - $actualRenderer.Left)))
      $deltaHeight = [Math]::Max(-16, [Math]::Min(16, [Math]::Max(240, $OverlayHeight) - ($actualRenderer.Bottom - $actualRenderer.Top)))
      if (-not ($deltaX -or $deltaY -or $deltaWidth -or $deltaHeight)) { break }
      $currentWindow = [MinovaNativeWindow+RECT]::new()
      if (-not [MinovaNativeWindow]::GetWindowRect($Handle, [ref]$currentWindow)) { break }
      [void][MinovaNativeWindow]::SetWindowPos(
        $Handle,
        [IntPtr]::Zero,
        $currentWindow.Left + $deltaX,
        $currentWindow.Top + $deltaY,
        [Math]::Max(320, ($currentWindow.Right - $currentWindow.Left) + $deltaWidth),
        [Math]::Max(240, ($currentWindow.Bottom - $currentWindow.Top) + $deltaHeight),
        $flags
      )
    }
    [void][MinovaNativeWindow]::GetWindowRect($Handle, [ref]$updatedWindowRect)
    $regionLeft = [Math]::Max(0, $Left - $updatedWindowRect.Left)
    $regionTop = [Math]::Max(0, $Top - $updatedWindowRect.Top)
    $region = [MinovaNativeWindow]::CreateRectRgn($regionLeft, $regionTop, $regionLeft + [Math]::Max(320, $OverlayWidth), $regionTop + [Math]::Max(240, $OverlayHeight))
    if ([MinovaNativeWindow]::SetWindowRgn($Handle, $region, $true) -eq 0) {
      [void][MinovaNativeWindow]::DeleteObject($region)
    }
  }
}

function Set-ToolbarBounds {
  param(
    [IntPtr]$Handle,
    [int]$Left,
    [int]$Top,
    [int]$ToolbarWidth,
    [int]$ToolbarHeight
  )
  if ($Handle -eq [IntPtr]::Zero -or -not [MinovaNativeWindow]::IsWindow($Handle)) { return }
  [void][MinovaNativeWindow]::SetWindowPos(
    $Handle,
    [IntPtr]::Zero,
    $Left,
    $Top,
    [Math]::Max(320, $ToolbarWidth),
    [Math]::Max(1, $ToolbarHeight),
    0x0070
  )
}

function Test-RendererFillsWindow {
  param([IntPtr]$Handle)
  $windowRect = [MinovaNativeWindow+RECT]::new()
  $rendererRect = [MinovaNativeWindow+RECT]::new()
  if (-not [MinovaNativeWindow]::GetWindowRect($Handle, [ref]$windowRect)) { return $false }
  if (-not [MinovaNativeWindow]::TryGetLargestRenderer($Handle, [ref]$rendererRect)) { return $false }
  $tolerance = 2
  return (
    [Math]::Abs($rendererRect.Left - $windowRect.Left) -le $tolerance -and
    [Math]::Abs($rendererRect.Top - $windowRect.Top) -le $tolerance -and
    [Math]::Abs($rendererRect.Right - $windowRect.Right) -le $tolerance -and
    [Math]::Abs($rendererRect.Bottom - $windowRect.Bottom) -le $tolerance
  )
}

function Enter-StreamingFullscreen {
  param(
    [IntPtr]$Handle,
    [IntPtr]$Owner,
    [IntPtr]$Toolbar
  )
  $monitorRect = [MinovaNativeWindow+RECT]::new()
  if (-not [MinovaNativeWindow]::TryGetMonitorRect($Owner, [ref]$monitorRect)) { return $false }
  [void][MinovaNativeWindow]::SetWindowRgn($Handle, [IntPtr]::Zero, $true)
  if ($Toolbar -ne [IntPtr]::Zero -and [MinovaNativeWindow]::IsWindow($Toolbar)) {
    [void][MinovaNativeWindow]::ShowWindow($Toolbar, 0)
  }
  [void][MinovaNativeWindow]::SetWindowPos(
    $Handle,
    [IntPtr]::Zero,
    $monitorRect.Left,
    $monitorRect.Top,
    [Math]::Max(320, $monitorRect.Right - $monitorRect.Left),
    [Math]::Max(240, $monitorRect.Bottom - $monitorRect.Top),
    0x0044
  )
  [void][MinovaNativeWindow]::BringWindowToTop($Handle)
  return $true
}

function Restore-StreamingBounds {
  param(
    [IntPtr]$Handle,
    [IntPtr]$Toolbar,
    [pscustomobject]$Bounds
  )
  Set-EmbeddedBounds -Handle $Handle -Left $Bounds.Left -Top $Bounds.Top -OverlayWidth $Bounds.Width -OverlayHeight $Bounds.Height -RefreshFrame
  Set-ToolbarBounds -Handle $Toolbar -Left $Bounds.ToolbarLeft -Top $Bounds.ToolbarTop -ToolbarWidth $Bounds.ToolbarWidth -ToolbarHeight $Bounds.ToolbarHeight
  if ($Toolbar -ne [IntPtr]::Zero -and [MinovaNativeWindow]::IsWindow($Toolbar)) {
    [void][MinovaNativeWindow]::ShowWindow($Toolbar, 4)
  }
}

function Get-OwnerContentBounds {
  param([IntPtr]$Handle)
  if (-not [MinovaNativeWindow]::IsWindow($Handle) -or [MinovaNativeWindow]::IsIconic($Handle)) { return $null }
  $client = [MinovaNativeWindow+RECT]::new()
  $origin = [MinovaNativeWindow+POINT]::new()
  if (-not [MinovaNativeWindow]::GetClientRect($Handle, [ref]$client)) { return $null }
  if (-not [MinovaNativeWindow]::ClientToScreen($Handle, [ref]$origin)) { return $null }
  $dpi = [MinovaNativeWindow]::GetDpiForWindow($Handle)
  if ($dpi -le 0) { $dpi = 96 }
  $toolbarPixels = [Math]::Max(1, [int][Math]::Round($ToolbarHeightDip * ([double]$dpi / 96.0)))
  $titlebarPixels = [Math]::Max(0, [int][Math]::Round(($ChromeHeightDip - $ToolbarHeightDip) * ([double]$dpi / 96.0)))
  $chromePixels = [Math]::Max(0, [int][Math]::Round($ChromeHeightDip * ([double]$dpi / 96.0)))
  $sidebarPixels = [Math]::Max(0, [int][Math]::Round($SidebarWidthDip * ([double]$dpi / 96.0)))
  $clientWidth = [Math]::Max(320, ($client.Right - $client.Left) - $sidebarPixels)
  $clientHeight = [Math]::Max(240, ($client.Bottom - $client.Top) - $chromePixels)
  return [pscustomobject]@{
    Left = $origin.X + $sidebarPixels
    Top = $origin.Y + $chromePixels
    Width = $clientWidth
    Height = $clientHeight
    ToolbarLeft = $origin.X + $sidebarPixels
    ToolbarTop = $origin.Y + $titlebarPixels
    ToolbarWidth = $clientWidth
    ToolbarHeight = $toolbarPixels
  }
}

$streamingHandle = [IntPtr]::Zero
$hostHandle = [IntPtr]::Zero
try {
  if (-not (Test-Path -LiteralPath $BrowserPath -PathType Leaf)) {
    throw "The certified streaming browser executable was not found."
  }

  $baseline = [System.Collections.Generic.HashSet[string]]::new()
  foreach ($window in Get-BrowserWindows) {
    [void]$baseline.Add($window.Handle.ToInt64().ToString())
  }

  $argumentJson = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ArgumentsBase64))
  $browserArguments = @((ConvertFrom-Json $argumentJson)) | ForEach-Object {
    $argument = [string]$_
    if ($argument -match '\s') { '"' + $argument.Replace('"', '\"') + '"' } else { $argument }
  }
  $startedProcess = Start-Process -FilePath $BrowserPath -ArgumentList $browserArguments -PassThru

  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  while ([DateTime]::UtcNow -lt $deadline -and $streamingHandle -eq [IntPtr]::Zero) {
    $candidate = Get-BrowserWindows |
      Where-Object { -not $baseline.Contains($_.Handle.ToInt64().ToString()) } |
      Sort-Object Area -Descending |
      Select-Object -First 1
    if ($candidate) {
      $streamingHandle = $candidate.Handle
      break
    }
    Start-Sleep -Milliseconds 80
  }

  if ($streamingHandle -eq [IntPtr]::Zero) {
    throw "The streaming page opened, but Minova could not attach its window."
  }

  [void][MinovaNativeWindow]::SetOwner($streamingHandle, [IntPtr]::new($OwnerHandle))
  if ($ToolbarHandle -ne 0 -and [MinovaNativeWindow]::IsWindow([IntPtr]::new($ToolbarHandle))) {
    $toolbarNativeHandle = [IntPtr]::new($ToolbarHandle)
    [void][MinovaNativeWindow]::SetOwner($toolbarNativeHandle, $streamingHandle)
    $toolbarStyle = [MinovaNativeWindow]::GetWindowLong($toolbarNativeHandle, -16)
    $toolbarPopupStyle = (($toolbarStyle -band (-bnot 0x00CF0000)) -bor 0x80000000)
    [void][MinovaNativeWindow]::SetWindowLong($toolbarNativeHandle, -16, $toolbarPopupStyle)
    $toolbarExtendedStyle = [MinovaNativeWindow]::GetWindowLong($toolbarNativeHandle, -20)
    $toolbarToolWindowStyle = ($toolbarExtendedStyle -band (-bnot 0x00040000)) -bor 0x00000080
    [void][MinovaNativeWindow]::SetWindowLong($toolbarNativeHandle, -20, $toolbarToolWindowStyle)
  }

  $style = [MinovaNativeWindow]::GetWindowLong($streamingHandle, -16)
  $popupStyle = (($style -band (-bnot 0x00CF0000)) -bor 0x80000000)
  [void][MinovaNativeWindow]::SetWindowLong($streamingHandle, -16, $popupStyle)

  $extendedStyle = [MinovaNativeWindow]::GetWindowLong($streamingHandle, -20)
  $toolWindowStyle = ($extendedStyle -band (-bnot 0x00040000)) -bor 0x00000080
  [void][MinovaNativeWindow]::SetWindowLong($streamingHandle, -20, $toolWindowStyle)
  [void][MinovaNativeWindow]::EnableWindow($streamingHandle, $true)
  [void][MinovaNativeWindow]::ConnectInputQueues([IntPtr]::new($OwnerHandle), [IntPtr]::Zero, $streamingHandle)
  $ownerBounds = Get-OwnerContentBounds -Handle ([IntPtr]::new($OwnerHandle))
  if (-not $ownerBounds) { throw "Minova's content area is unavailable." }
  $X = $ownerBounds.Left
  $Y = $ownerBounds.Top
  $Width = $ownerBounds.Width
  $Height = $ownerBounds.Height
  Set-EmbeddedBounds -Handle $streamingHandle -Left $X -Top $Y -OverlayWidth $Width -OverlayHeight $Height -RefreshFrame -Calibrate
  Set-ToolbarBounds -Handle ([IntPtr]::new($ToolbarHandle)) -Left $ownerBounds.ToolbarLeft -Top $ownerBounds.ToolbarTop -ToolbarWidth $ownerBounds.ToolbarWidth -ToolbarHeight $ownerBounds.ToolbarHeight
  $focused = [MinovaNativeWindow]::FocusEmbeddedBrowser([IntPtr]::new($OwnerHandle), [IntPtr]::Zero, $streamingHandle)

  Write-OverlayEvent @{
    event = "ready"
    handle = $streamingHandle.ToInt64().ToString()
    hostHandle = $hostHandle.ToInt64().ToString()
    processId = $startedProcess.Id
    focused = $focused
  }

  $commandReader = [MinovaNativeWindow+CommandReader]::new()
  $closeRequested = $false
  $lastBoundsKey = "$X,$Y,$Width,$Height,$($ownerBounds.ToolbarTop),$($ownerBounds.ToolbarHeight)"
  $lastReportedBoundsKey = ""
  $nextBoundsReport = [DateTime]::UtcNow
  $nextFullscreenProbe = [DateTime]::UtcNow.AddMilliseconds(100)
  $fullscreenCandidateCount = 0
  $fullscreenActive = $false
  $overlaySuspended = $false
  while ([MinovaNativeWindow]::IsWindow($streamingHandle) -and -not $closeRequested) {
    if (-not [MinovaNativeWindow]::IsWindow([IntPtr]::new($OwnerHandle))) {
      $closeRequested = $true
      break
    }
    $commandsRead = 0
    while ($commandsRead -lt 100 -and -not $closeRequested) {
      $line = $commandReader.TryReadLine()
      if ($null -eq $line) { break }
      $commandsRead += 1
      try {
        $command = $line | ConvertFrom-Json
        if ($command.action -eq "position") {
          $X = [int]$command.x
          $Y = [int]$command.y
          $Width = [int]$command.width
          $Height = [int]$command.height
        } elseif ($command.action -eq "sidebar") {
          $SidebarWidthDip = [Math]::Max(0, [int]$command.width)
        } elseif ($command.action -eq "layout") {
          $SidebarWidthDip = [Math]::Max(0, [int]$command.width)
          if ($null -ne $command.toolbarHeight) {
            $ToolbarHeightDip = [Math]::Max(1, [int]$command.toolbarHeight)
          }
          $ChromeHeightDip = [Math]::Max($ToolbarHeightDip, [int]$command.chromeHeight)
        } elseif ($command.action -eq "focus") {
          if (-not $overlaySuspended) {
            $focusResult = [MinovaNativeWindow]::FocusEmbeddedBrowser([IntPtr]::new($OwnerHandle), [IntPtr]::Zero, $streamingHandle)
            Write-OverlayEvent @{ event = "focused"; focused = $focusResult }
          }
        } elseif ($command.action -eq "suspend") {
          if (-not $overlaySuspended) {
            # APPCOMMAND_MEDIA_PAUSE pauses active playback without toggling an
            # already-paused video back on.
            [void][MinovaNativeWindow]::PostMessage($streamingHandle, 0x0319, $streamingHandle, [IntPtr]::new(47 -shl 16))
            [void][MinovaNativeWindow]::ShowWindow([IntPtr]::new($ToolbarHandle), 0)
            [void][MinovaNativeWindow]::ShowWindow($streamingHandle, 0)
            $overlaySuspended = $true
            Write-OverlayEvent @{ event = "backgrounded"; active = $true }
          }
        } elseif ($command.action -eq "resume") {
          if ($overlaySuspended) {
            $resumeBounds = Get-OwnerContentBounds -Handle ([IntPtr]::new($OwnerHandle))
            if ($resumeBounds) {
              Restore-StreamingBounds -Handle $streamingHandle -Toolbar ([IntPtr]::new($ToolbarHandle)) -Bounds $resumeBounds
              [void][MinovaNativeWindow]::ShowWindow($streamingHandle, 4)
              [void][MinovaNativeWindow]::ShowWindow([IntPtr]::new($ToolbarHandle), 4)
              [void][MinovaNativeWindow]::BringWindowToTop($streamingHandle)
              $overlaySuspended = $false
              $focusResult = [MinovaNativeWindow]::FocusEmbeddedBrowser([IntPtr]::new($OwnerHandle), [IntPtr]::Zero, $streamingHandle)
              Write-OverlayEvent @{ event = "backgrounded"; active = $false }
              Write-OverlayEvent @{ event = "focused"; focused = $focusResult }
            }
          }
        } elseif ($command.action -in @("back", "forward", "reload")) {
          if (-not $overlaySuspended) {
            $appCommand = @{ back = 1; forward = 2; reload = 3 }[$command.action]
            [void][MinovaNativeWindow]::PostMessage($streamingHandle, 0x0319, $streamingHandle, [IntPtr]::new($appCommand -shl 16))
          }
        } elseif ($command.action -eq "fullscreen") {
          if (-not $overlaySuspended) {
            [void][MinovaNativeWindow]::FocusEmbeddedBrowser([IntPtr]::new($OwnerHandle), [IntPtr]::Zero, $streamingHandle)
            [MinovaNativeWindow]::SendF11($streamingHandle)
          }
        } elseif ($command.action -eq "close") {
          $closeRequested = $true
        }
      } catch {
        Write-OverlayEvent @{ event = "warning"; message = $_.Exception.Message }
      }
    }
    if ($commandReader.HasEnded) {
      $closeRequested = $true
      break
    }
    if ($overlaySuspended) {
      Start-Sleep -Milliseconds 16
      continue
    }
    $ownerBounds = Get-OwnerContentBounds -Handle ([IntPtr]::new($OwnerHandle))
    if (-not $ownerBounds) {
      Start-Sleep -Milliseconds 16
      continue
    }
    $X = $ownerBounds.Left
    $Y = $ownerBounds.Top
    $Width = $ownerBounds.Width
    $Height = $ownerBounds.Height
    $boundsKey = "$X,$Y,$Width,$Height,$($ownerBounds.ToolbarTop),$($ownerBounds.ToolbarHeight)"
    $now = [DateTime]::UtcNow
    if ($now -ge $nextFullscreenProbe) {
      $rendererFillsWindow = Test-RendererFillsWindow -Handle $streamingHandle
      if (-not $fullscreenActive) {
        $fullscreenCandidateCount = if ($rendererFillsWindow) { $fullscreenCandidateCount + 1 } else { 0 }
        if ($fullscreenCandidateCount -ge 2) {
          $toolbarHandleValue = [IntPtr]::new($ToolbarHandle)
          if (Enter-StreamingFullscreen -Handle $streamingHandle -Owner ([IntPtr]::new($OwnerHandle)) -Toolbar $toolbarHandleValue) {
            $fullscreenActive = $true
            $fullscreenCandidateCount = 0
            Write-OverlayEvent @{ event = "fullscreen"; active = $true }
          }
        }
      } elseif (-not $rendererFillsWindow) {
        $fullscreenActive = $false
        $fullscreenCandidateCount = 0
        Restore-StreamingBounds -Handle $streamingHandle -Toolbar ([IntPtr]::new($ToolbarHandle)) -Bounds $ownerBounds
        $lastBoundsKey = $boundsKey
        Write-OverlayEvent @{ event = "fullscreen"; active = $false }
      }
      $nextFullscreenProbe = $now.AddMilliseconds(50)
    }
    if (-not $fullscreenActive -and $boundsKey -ne $lastBoundsKey) {
      Set-EmbeddedBounds -Handle $streamingHandle -Left $X -Top $Y -OverlayWidth $Width -OverlayHeight $Height
      Set-ToolbarBounds -Handle ([IntPtr]::new($ToolbarHandle)) -Left $ownerBounds.ToolbarLeft -Top $ownerBounds.ToolbarTop -ToolbarWidth $ownerBounds.ToolbarWidth -ToolbarHeight $ownerBounds.ToolbarHeight
      $lastBoundsKey = $boundsKey
    }
    if ($boundsKey -ne $lastReportedBoundsKey -and [DateTime]::UtcNow -ge $nextBoundsReport) {
      Write-OverlayEvent @{
        event = "bounds"
        x = $X
        y = $Y
        width = $Width
        height = $Height
      }
      $lastReportedBoundsKey = $boundsKey
      $nextBoundsReport = [DateTime]::UtcNow.AddMilliseconds(100)
    }
    Start-Sleep -Milliseconds 8
  }

  if ($closeRequested -and [MinovaNativeWindow]::IsWindow($streamingHandle)) {
    [MinovaNativeWindow]::DisconnectInputQueues()
    [void][MinovaNativeWindow]::PostMessage($streamingHandle, 0x0112, [IntPtr]::new(0xF060), [IntPtr]::Zero)
    [void][MinovaNativeWindow]::PostMessage($streamingHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    $closeDeadline = [DateTime]::UtcNow.AddMilliseconds(1200)
    while ([DateTime]::UtcNow -lt $closeDeadline -and [MinovaNativeWindow]::IsWindow($streamingHandle)) {
      Start-Sleep -Milliseconds 100
    }
    if ([MinovaNativeWindow]::IsWindow($streamingHandle)) {
      [uint32]$streamingProcessId = 0
      [void][MinovaNativeWindow]::GetWindowThreadProcessId($streamingHandle, [ref]$streamingProcessId)
      if ($streamingProcessId -gt 0) {
        Stop-Process -Id $streamingProcessId -Force -ErrorAction SilentlyContinue
      }
      $closeDeadline = [DateTime]::UtcNow.AddMilliseconds(1200)
      while ([DateTime]::UtcNow -lt $closeDeadline -and [MinovaNativeWindow]::IsWindow($streamingHandle)) {
        Start-Sleep -Milliseconds 50
      }
    }
  }

  [MinovaNativeWindow]::DisconnectInputQueues()
  if ($hostHandle -ne [IntPtr]::Zero -and [MinovaNativeWindow]::IsWindow($hostHandle)) {
    [void][MinovaNativeWindow]::DestroyWindow($hostHandle)
  }

  Write-OverlayEvent @{ event = "closed" }
} catch {
  if ($streamingHandle -ne [IntPtr]::Zero -and [MinovaNativeWindow]::IsWindow($streamingHandle)) {
    [void][MinovaNativeWindow]::PostMessage($streamingHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  } elseif ($startedProcess -and -not $startedProcess.HasExited) {
    [void]$startedProcess.CloseMainWindow()
  }
  [MinovaNativeWindow]::DisconnectInputQueues()
  if ($hostHandle -ne [IntPtr]::Zero -and [MinovaNativeWindow]::IsWindow($hostHandle)) {
    [void][MinovaNativeWindow]::DestroyWindow($hostHandle)
  }
  Write-OverlayEvent @{
    event = "error"
    message = $_.Exception.Message
    detail = $_.ScriptStackTrace
  }
  exit 1
}
