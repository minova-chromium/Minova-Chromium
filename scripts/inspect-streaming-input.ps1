[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [int]$OwnerProcessId,

  [string]$TestText = "minova-input-test@example.com"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class MinovaInputProbe
{
    public delegate bool EnumWindowsProc(IntPtr window, IntPtr state);
    [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion data; }
    [StructLayout(LayoutKind.Explicit)] public struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mouse;
        [FieldOffset(0)] public KEYBDINPUT keyboard;
        [FieldOffset(0)] public HARDWAREINPUT hardware;
    }
    [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT
    {
        public int dx; public int dy; public uint mouseData; public uint flags; public uint time; public UIntPtr extraInfo;
    }
    [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT
    {
        public ushort virtualKey; public ushort scanCode; public uint flags; public uint time; public UIntPtr extraInfo;
    }
    [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT
    {
        public uint message; public ushort parameterLow; public ushort parameterHigh;
    }
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr window);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attachThread, uint attachToThread, bool attach);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extraInfo);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr state);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr state);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, System.Text.StringBuilder name, int count);

    public static IntPtr[] Descendants(IntPtr parent)
    {
        var windows = new System.Collections.Generic.List<IntPtr>();
        EnumChildWindows(parent, (window, state) => { windows.Add(window); return true; }, IntPtr.Zero);
        return windows.ToArray();
    }

    public static IntPtr[] OwnedWindows(IntPtr owner)
    {
        var windows = new System.Collections.Generic.List<IntPtr>();
        EnumWindows((window, state) => { if (GetWindow(window, 4) == owner) windows.Add(window); return true; }, IntPtr.Zero);
        return windows.ToArray();
    }

    public static string ClassName(IntPtr window)
    {
        var name = new System.Text.StringBuilder(256);
        GetClassName(window, name, name.Capacity);
        return name.ToString();
    }

    public static uint SendUnicodeText(string value)
    {
        var inputs = new System.Collections.Generic.List<INPUT>();
        foreach (var character in value)
        {
            inputs.Add(new INPUT { type = 1, data = new InputUnion { keyboard = new KEYBDINPUT { scanCode = character, flags = 0x0004 } } });
            inputs.Add(new INPUT { type = 1, data = new InputUnion { keyboard = new KEYBDINPUT { scanCode = character, flags = 0x0004 | 0x0002 } } });
        }
        return SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf(typeof(INPUT)));
    }

    public static bool ForceForeground(IntPtr owner)
    {
        uint ignored;
        var currentThread = GetCurrentThreadId();
        var ownerThread = GetWindowThreadProcessId(owner, out ignored);
        var foreground = GetForegroundWindow();
        var foregroundThread = GetWindowThreadProcessId(foreground, out ignored);
        if (foregroundThread != 0 && foregroundThread != currentThread) AttachThreadInput(currentThread, foregroundThread, true);
        if (ownerThread != 0 && ownerThread != currentThread) AttachThreadInput(currentThread, ownerThread, true);
        ShowWindow(owner, 9);
        SetWindowPos(owner, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040);
        SetForegroundWindow(owner);
        BringWindowToTop(owner);
        SetActiveWindow(owner);
        return GetForegroundWindow() == owner;
    }

    public static void ReleaseTopmost(IntPtr owner)
    {
        SetWindowPos(owner, new IntPtr(-2), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040);
    }
}
"@

$ownerProcess = Get-Process -Id $OwnerProcessId -ErrorAction Stop
$ownerHandle = [IntPtr]$ownerProcess.MainWindowHandle
if ($ownerHandle -eq [IntPtr]::Zero) { throw "The Minova test window was not found." }

$condition = [System.Windows.Automation.PropertyCondition]::new(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Edit
)
$automationRoots = @()
$ownedHandles = @([MinovaInputProbe]::OwnedWindows($ownerHandle))
$browserHandles = @([MinovaInputProbe]::Descendants($ownerHandle)) + $ownedHandles
foreach ($ownedHandle in $ownedHandles) {
  $browserHandles += @([MinovaInputProbe]::Descendants($ownedHandle))
}
foreach ($handle in $browserHandles) {
  [uint32]$processId = 0
  [void][MinovaInputProbe]::GetWindowThreadProcessId($handle, [ref]$processId)
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($process.ProcessName -ne "msedge") { continue }
  if ([MinovaInputProbe]::ClassName($handle) -notin @("Chrome_WidgetWin_1", "Chrome_RenderWidgetHostHWND")) { continue }
  try { $automationRoots += [System.Windows.Automation.AutomationElement]::FromHandle($handle) } catch { }
}
if (-not $automationRoots.Count) { throw "The embedded Edge accessibility root was not found." }

$edits = @()
foreach ($root in $automationRoots) {
  $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
  for ($index = 0; $index -lt $elements.Count; $index++) {
    $element = $elements.Item($index)
    $process = Get-Process -Id $element.Current.ProcessId -ErrorAction SilentlyContinue
    $bounds = $element.Current.BoundingRectangle
    $coordinates = @([double]$bounds.X, [double]$bounds.Y, [double]$bounds.Width, [double]$bounds.Height)
    if ($coordinates | Where-Object { [double]::IsNaN($_) -or [double]::IsInfinity($_) }) { continue }
    $edits += [pscustomobject]@{
      Element = $element
      Process = $process.ProcessName
      Name = $element.Current.Name
      AutomationId = $element.Current.AutomationId
      Focusable = $element.Current.IsKeyboardFocusable
      X = [int]$bounds.X
      Y = [int]$bounds.Y
      Width = [int]$bounds.Width
      Height = [int]$bounds.Height
    }
  }
}

$candidate = $edits |
  Where-Object { $_.Process -eq "msedge" -and $_.Focusable -and $_.Width -gt 120 -and $_.Height -gt 18 } |
  Sort-Object @{ Expression = { if ("$($_.Name) $($_.AutomationId)" -match "email|mobile|phone|login") { 0 } else { 1 } } }, Y |
  Select-Object -First 1
if (-not $candidate) {
  $summary = $edits | Select-Object Process, Name, AutomationId, Focusable, X, Y, Width, Height
  throw "No interactive Edge text field was exposed. Fields: $($summary | ConvertTo-Json -Compress)"
}

$foregroundReady = [MinovaInputProbe]::ForceForeground($ownerHandle)
$valuePattern = $candidate.Element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
$valuePattern.SetValue("")
Start-Sleep -Milliseconds 150
$clickX = $candidate.X + [Math]::Floor($candidate.Width / 2)
$clickY = $candidate.Y + [Math]::Floor($candidate.Height / 2)
[void][MinovaInputProbe]::SetCursorPos($clickX, $clickY)
[MinovaInputProbe]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
[MinovaInputProbe]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 180
$candidate.Element.SetFocus()
Start-Sleep -Milliseconds 100
$valuePattern.SetValue("")
Start-Sleep -Milliseconds 100
$focusedBeforeInput = [System.Windows.Automation.AutomationElement]::FocusedElement
$focusedBeforeProcess = Get-Process -Id $focusedBeforeInput.Current.ProcessId -ErrorAction SilentlyContinue
$sentInputCount = [MinovaInputProbe]::SendUnicodeText($TestText)
Start-Sleep -Milliseconds 250

$actualValue = $valuePattern.Current.Value
[MinovaInputProbe]::ReleaseTopmost($ownerHandle)
$focused = [System.Windows.Automation.AutomationElement]::FocusedElement
$focusedProcess = Get-Process -Id $focused.Current.ProcessId -ErrorAction SilentlyContinue

$valuePattern.SetValue("")

[pscustomobject]@{
  Passed = $actualValue -eq $TestText
  ExpectedValue = $TestText
  ActualValue = $actualValue
  SentInputCount = $sentInputCount
  ForegroundReady = $foregroundReady
  FocusedBeforeInputProcess = $focusedBeforeProcess.ProcessName
  FocusedBeforeInputName = $focusedBeforeInput.Current.Name
  Click = @{ X = $clickX; Y = $clickY }
  Field = $candidate | Select-Object Process, Name, AutomationId, Focusable, X, Y, Width, Height
  FocusedProcess = $focusedProcess.ProcessName
  FocusedName = $focused.Current.Name
  EdgeEditCount = @($edits | Where-Object Process -eq "msedge").Count
} | ConvertTo-Json -Depth 5

if ($actualValue -ne $TestText) { exit 1 }
