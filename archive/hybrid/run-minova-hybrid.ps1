[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Url = "https://www.google.com/"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$controller = Join-Path $root "hybrid-controller.js"
$extension = Join-Path $root "extension"
$node = Join-Path $root "runtime\node.exe"
$profile = Join-Path $env:LOCALAPPDATA "Minova Hybrid Browser"
$statePath = Join-Path $profile "minova-runtime.json"
$logDirectory = Join-Path $profile "Logs"

function Show-MinovaError([string]$Message) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($Message, "Minova Hybrid Browser", "OK", "Error") | Out-Null
}

$candidates = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
  "${env:LOCALAPPDATA}\Microsoft\Edge\Application\msedge.exe"
)
$edge = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1

if (-not $edge) {
  Show-MinovaError "Minova Hybrid Browser requires Microsoft Edge. Install or repair Edge, then try again."
  exit 1
}
foreach ($required in @($controller, (Join-Path $extension "manifest.json"), $node)) {
  if (-not (Test-Path -LiteralPath $required)) {
    Show-MinovaError "Minova Hybrid Browser is incomplete. Missing: $required"
    exit 1
  }
}

$parsed = $null
if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$parsed) -or $parsed.Scheme -ne "https" -or -not [string]::IsNullOrEmpty($parsed.UserInfo)) {
  Show-MinovaError "Minova Hybrid Browser only opens secure HTTPS addresses."
  exit 2
}

New-Item -ItemType Directory -Path $profile -Force | Out-Null
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

$runtime = $null
if (Test-Path -LiteralPath $statePath) {
  try {
    $candidate = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $controllerProcess = Get-Process -Id ([int]$candidate.controllerPid) -ErrorAction Stop
    if ($controllerProcess.ProcessName -eq "node" -and $candidate.profilePath -eq $profile) {
      $runtime = $candidate
    }
  } catch {
    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
  }
}

$edgeArguments = @(
  "--user-data-dir=`"$profile`"",
  "--profile-directory=Default",
  "--no-first-run",
  "--no-default-browser-check",
  "--app=`"$($parsed.AbsoluteUri)`""
)

if ($runtime) {
  Start-Process -FilePath $edge -ArgumentList $edgeArguments
  exit 0
}

$outputLog = Join-Path $logDirectory "controller-output.log"
$errorLog = Join-Path $logDirectory "controller-error.log"
$controllerArguments = @(
  "`"$controller`"",
  "`"$edge`"",
  "`"$profile`"",
  "`"$extension`"",
  "`"$($parsed.AbsoluteUri)`""
)
$process = Start-Process -FilePath $node -ArgumentList $controllerArguments -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $outputLog -RedirectStandardError $errorLog -PassThru
Start-Sleep -Milliseconds 900

if ($process.HasExited) {
  $details = if (Test-Path -LiteralPath $errorLog) { (Get-Content -LiteralPath $errorLog -Raw).Trim() } else { "" }
  if (-not $details) { $details = "The browser controller stopped before Edge was ready." }
  Show-MinovaError $details
  exit 3
}
