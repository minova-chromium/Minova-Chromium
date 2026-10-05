[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$failures = [System.Collections.Generic.List[string]]::new()

function Assert-Minova([bool]$Condition, [string]$Message) {
  if ($Condition) { Write-Host "PASS  $Message" -ForegroundColor Green }
  else { Write-Host "FAIL  $Message" -ForegroundColor Red; $failures.Add($Message) }
}

$required = @(
  "Launch Minova Hybrid Browser.cmd",
  "run-minova-hybrid.ps1",
  "hybrid-controller.js",
  "extension\manifest.json",
  "extension\background.js",
  "extension\content.js",
  "extension\icons\minova.png",
  "runtime\node.exe",
  "runtime\NODE-LICENSE.txt",
  "LICENSE",
  "THIRD-PARTY-NOTICES.md",
  "minova-hybrid.ico"
)
foreach ($relative in $required) {
  Assert-Minova (Test-Path -LiteralPath (Join-Path $root $relative)) "Required file: $relative"
}

$node = Join-Path $root "runtime\node.exe"
foreach ($relative in @("hybrid-controller.js", "extension\background.js", "extension\content.js")) {
  & $node --check (Join-Path $root $relative)
  Assert-Minova ($LASTEXITCODE -eq 0) "JavaScript syntax: $relative"
}

$tokens = $null
$parseErrors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile(
  (Join-Path $root "run-minova-hybrid.ps1"),
  [ref]$tokens,
  [ref]$parseErrors
)
Assert-Minova ($parseErrors.Count -eq 0) "PowerShell launcher syntax"

$manifest = Get-Content -LiteralPath (Join-Path $root "extension\manifest.json") -Raw | ConvertFrom-Json
Assert-Minova ($manifest.manifest_version -eq 3) "Manifest V3 extension"
Assert-Minova ($manifest.name -eq "Minova Hybrid UI") "Expected extension identity"

$controllerSource = Get-Content -LiteralPath (Join-Path $root "hybrid-controller.js") -Raw
foreach ($forbidden in @("--no-sandbox", "--disable-web-security", "--ignore-certificate-errors", "--user-agent=")) {
  Assert-Minova (-not $controllerSource.Contains($forbidden)) "Forbidden flag absent: $forbidden"
}

$edgeCandidates = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
  "${env:LOCALAPPDATA}\Microsoft\Edge\Application\msedge.exe"
)
$edge = $edgeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
Assert-Minova ([bool]$edge) "Microsoft Edge is installed"
if ($edge) {
  $signature = Get-AuthenticodeSignature -LiteralPath $edge
  Assert-Minova ($signature.Status -eq "Valid") "Microsoft Edge Authenticode signature"
  Write-Host "INFO  Edge version $((Get-Item -LiteralPath $edge).VersionInfo.ProductVersion)"
}

$license = Get-Content -LiteralPath (Join-Path $root "LICENSE") -Raw
Assert-Minova ($license.Contains("GNU GENERAL PUBLIC LICENSE") -and $license.Contains("Version 3")) "GPL version 3 license"
Assert-Minova ((Get-Item -LiteralPath (Join-Path $root "runtime\NODE-LICENSE.txt")).Length -gt 100000) "Complete Node.js license notices"

if ($failures.Count) {
  throw "Minova Hybrid verification failed with $($failures.Count) issue(s)."
}
Write-Host "Minova Hybrid release verification passed." -ForegroundColor Cyan
