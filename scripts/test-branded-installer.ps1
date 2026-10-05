[CmdletBinding()]
param(
  [string]$InstallerPath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($InstallerPath)) {
  $version = (Get-Content -LiteralPath (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
  $InstallerPath = Join-Path $root "dist\update\Minova-Chromium-Setup-$version.exe"
}
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$artifactDirectory = Join-Path $root "scripts\artifacts"
[System.IO.Directory]::CreateDirectory($artifactDirectory) | Out-Null
$reportPath = Join-Path $artifactDirectory "branded-installer-test.json"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$process = Start-Process -FilePath $installer -ArgumentList "/test" -PassThru
try {
  $windowHandle = [IntPtr]::Zero
  for ($attempt = 0; $attempt -lt 80; $attempt++) {
    Start-Sleep -Milliseconds 100
    $process.Refresh()
    if ($process.HasExited) {
      throw "The branded installer exited before its window was ready. Exit code: $($process.ExitCode)"
    }
    if ($process.MainWindowHandle -ne [IntPtr]::Zero) {
      $windowHandle = $process.MainWindowHandle
      break
    }
  }
  if ($windowHandle -eq [IntPtr]::Zero) {
    throw "The branded installer window was not found."
  }

  $window = [System.Windows.Automation.AutomationElement]::FromHandle($windowHandle)
  $installNameCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty,
    "Install Minova"
  )
  $installTypeCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
  )
  $installCondition = New-Object System.Windows.Automation.AndCondition(
    $installNameCondition,
    $installTypeCondition
  )
  $installButton = $window.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    $installCondition
  )
  if (-not $installButton) {
    throw "The Install Minova action was not found."
  }
  $invoke = $installButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $invoke.Invoke()

  $progressSeen = $false
  $completed = $false
  for ($attempt = 0; $attempt -lt 160; $attempt++) {
    Start-Sleep -Milliseconds 100
    $progressCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty,
      "Making Minova yours"
    )
    if ($window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $progressCondition)) {
      $progressSeen = $true
    }
    $completeCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty,
      "Minova is ready"
    )
    if ($window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $completeCondition)) {
      $completed = $true
      break
    }
  }
  if (-not $progressSeen) {
    throw "The branded installer did not show its progress state."
  }
  if (-not $completed) {
    throw "The branded installer did not reach its completion state."
  }

  [ordered]@{
    passed = $true
    installer = $installer
    progressSeen = $progressSeen
    completed = $completed
    processTitle = $process.MainWindowTitle
  } | ConvertTo-Json | Set-Content -LiteralPath $reportPath -Encoding UTF8
  Write-Host "Branded installer UI test passed."
  Write-Host "  $reportPath"
} finally {
  $process.Refresh()
  if (-not $process.HasExited) {
    $null = $process.CloseMainWindow()
    Start-Sleep -Milliseconds 400
    $process.Refresh()
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force
    }
  }
}
