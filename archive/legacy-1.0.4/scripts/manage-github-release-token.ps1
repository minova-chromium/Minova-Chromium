[CmdletBinding()]
param(
  [switch]$Remove
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "github-release-credential.ps1")

if ($Remove) {
  if (Remove-MinovaSavedGitHubToken) {
    Write-Host "The saved Minova GitHub token was removed." -ForegroundColor Green
  } else {
    Write-Host "No saved Minova GitHub token was found."
  }
  exit 0
}

Write-Host ""
Write-Host "Save Minova GitHub release token" -ForegroundColor Cyan
Write-Host "The replacement token needs access to Minova-Chromium with Contents: Read and write."
Write-Host "Its encrypted value is tied to this Windows account and is stored outside the project."
Write-Host ""

$secureToken = Read-Host "Paste the replacement token (input is hidden)" -AsSecureString
$token = ConvertFrom-MinovaSecureString -SecureValue $secureToken
if ([string]::IsNullOrWhiteSpace($token)) {
  throw "No token was entered."
}

$headers = @{
  Authorization = "Bearer $token"
  Accept = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
  "User-Agent" = "Minova-Release-Builder"
}

try {
  $githubUser = Invoke-RestMethod -Method Get -Uri "https://api.github.com/user" -Headers $headers
  Invoke-RestMethod -Method Get `
    -Uri "https://api.github.com/repos/minova-chromium/Minova-Chromium" `
    -Headers $headers | Out-Null
} catch {
  throw "GitHub rejected the token. Confirm that it is active and can access minova-chromium/Minova-Chromium."
}

$credentialPath = Save-MinovaGitHubToken -Token $token
$token = $null
Write-Host "GitHub authentication saved for @$($githubUser.login)." -ForegroundColor Green
Write-Host "Protected credential: $credentialPath"
