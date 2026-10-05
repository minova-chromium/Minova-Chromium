[CmdletBinding()]
param(
  [string]$CommitMessage = "Publish Minova website",
  [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
$website = Join-Path $root "website"
$credentialHelper = Join-Path $PSScriptRoot "github-release-credential.ps1"
$owner = "minova-chromium"
$repository = "Minova-Chromium"
$apiRoot = "https://api.github.com/repos/$owner/$repository"

if (-not (Test-Path -LiteralPath $website -PathType Container)) {
  throw "The website directory was not found: $website"
}
if (-not (Test-Path -LiteralPath $credentialHelper -PathType Leaf)) {
  throw "The encrypted GitHub credential helper is missing."
}

. $credentialHelper

$token = if (-not [string]::IsNullOrWhiteSpace($env:GH_TOKEN)) {
  $env:GH_TOKEN.Trim()
} elseif (-not [string]::IsNullOrWhiteSpace($env:GITHUB_TOKEN)) {
  $env:GITHUB_TOKEN.Trim()
} else {
  Get-MinovaSavedGitHubToken
}

if ([string]::IsNullOrWhiteSpace($token)) {
  throw "No GitHub credential is available. Run Save Minova GitHub Token.cmd first."
}

$headers = @{
  Authorization = "Bearer $token"
  Accept = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
  "User-Agent" = "Minova-Website-Publisher"
}

Write-Host "Reading the current $Branch branch..." -ForegroundColor Cyan
$reference = Invoke-RestMethod -Method Get -Uri "$apiRoot/git/ref/heads/$Branch" -Headers $headers
$parentSha = [string]$reference.object.sha
$parentCommit = Invoke-RestMethod -Method Get -Uri "$apiRoot/git/commits/$parentSha" -Headers $headers
$baseTreeSha = [string]$parentCommit.tree.sha

$files = @(Get-ChildItem -LiteralPath $website -File -Recurse | Sort-Object FullName)
if ($files.Count -eq 0) {
  throw "The website directory is empty."
}

$rootPrefix = [IO.Path]::GetFullPath($root).TrimEnd("\") + "\"
$treeEntries = foreach ($file in $files) {
  $fullPath = [IO.Path]::GetFullPath($file.FullName)
  if (-not $fullPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "A website file resolved outside the project root: $fullPath"
  }
  $relativePath = $fullPath.Substring($rootPrefix.Length).Replace("\", "/")
  Write-Host "Uploading $relativePath"
  $blobBody = @{
    content = [Convert]::ToBase64String([IO.File]::ReadAllBytes($file.FullName))
    encoding = "base64"
  } | ConvertTo-Json -Compress
  $blob = Invoke-RestMethod -Method Post -Uri "$apiRoot/git/blobs" -Headers $headers -ContentType "application/json" -Body $blobBody
  $sourceEntry = @{
    path = $relativePath
    mode = "100644"
    type = "blob"
    sha = [string]$blob.sha
  }
  $sourceEntry

  # GitHub Pages currently serves main from the repository root. Keep the
  # maintainable website/ source and its root deployment mirror in one commit.
  $siteRelativePath = $relativePath.Substring("website/".Length)
  if ($siteRelativePath -ne "README.md") {
    @{
      path = $siteRelativePath
      mode = "100644"
      type = "blob"
      sha = [string]$blob.sha
    }
  }
}

$treeBody = @{
  base_tree = $baseTreeSha
  tree = @($treeEntries)
} | ConvertTo-Json -Depth 5 -Compress
$tree = Invoke-RestMethod -Method Post -Uri "$apiRoot/git/trees" -Headers $headers -ContentType "application/json" -Body $treeBody

$commitBody = @{
  message = $CommitMessage
  tree = [string]$tree.sha
  parents = @($parentSha)
} | ConvertTo-Json -Depth 4 -Compress
$commit = Invoke-RestMethod -Method Post -Uri "$apiRoot/git/commits" -Headers $headers -ContentType "application/json" -Body $commitBody

$updateBody = @{
  sha = [string]$commit.sha
  force = $false
} | ConvertTo-Json -Compress
Invoke-RestMethod -Method Patch -Uri "$apiRoot/git/refs/heads/$Branch" -Headers $headers -ContentType "application/json" -Body $updateBody | Out-Null

[pscustomobject]@{
  commit = [string]$commit.sha
  sourceFiles = $files.Count
  deploymentFiles = @($treeEntries).Count
  branch = $Branch
  repository = "$owner/$repository"
  website = "https://minova-chromium.github.io/Minova-Chromium/"
  deployment = "Legacy GitHub Pages root mirror updated"
} | ConvertTo-Json
