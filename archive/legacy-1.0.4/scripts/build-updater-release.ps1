[CmdletBinding()]
param(
  [switch]$Publish,
  [switch]$SkipTests,
  [switch]$NoAdvanceVersion,
  [switch]$UseExistingBuild
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
$packagePath = Join-Path $root "package.json"
$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
$version = [string]$package.version
$output = [System.IO.Path]::GetFullPath((Join-Path $root "dist\update"))
$distRoot = [System.IO.Path]::GetFullPath((Join-Path $root "dist"))
$builderCli = Join-Path $root "node_modules\electron-builder\cli.js"
$electronExe = Join-Path $root "node_modules\electron\dist\electron.exe"
$unitTest = Join-Path $root "scripts\minova-1.0-unit.js"
$credentialHelper = Join-Path $root "scripts\github-release-credential.ps1"
$versionAdvancer = Join-Path $root "scripts\advance-release-version.js"
$releaseNotesPath = Join-Path $root "release-notes\$version.md"

if ($version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
  throw "package.json version must use semantic versioning, for example 1.0.2."
}
$releaseNotes = if (Test-Path -LiteralPath $releaseNotesPath) {
  (Get-Content -LiteralPath $releaseNotesPath -Raw).Trim()
} else {
  "Minova Chromium $version for Windows. Download Minova-Chromium-Setup-$version.exe to install."
}
$generateReleaseNotes = -not (Test-Path -LiteralPath $releaseNotesPath)
if (-not $output.StartsWith($distRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Updater release output must remain inside the project dist directory."
}
if (-not $UseExistingBuild -and -not (Test-Path -LiteralPath $builderCli)) {
  throw "electron-builder is not installed. Run pnpm install first."
}
if (-not $UseExistingBuild -and -not (Test-Path -LiteralPath $electronExe)) {
  throw "The Castlabs Electron runtime is unavailable. Run pnpm rebuild electron first."
}
if (-not $package.dependencies.'electron-updater') {
  throw "electron-updater must be installed as a production dependency."
}
if (-not (Test-Path -LiteralPath $credentialHelper)) {
  throw "The encrypted GitHub credential helper is missing: $credentialHelper"
}
. $credentialHelper

$github = @($package.build.publish) | Where-Object { $_.provider -eq "github" } | Select-Object -First 1
if (-not $github -or $github.owner -ne "minova-chromium" -or $github.repo -ne "Minova-Chromium") {
  throw "The GitHub update provider is not configured for minova-chromium/Minova-Chromium."
}

$publishHeaders = $null
$savePromptedToken = $false
if ($Publish) {
  $token = if (-not [string]::IsNullOrWhiteSpace($env:GH_TOKEN)) {
    $env:GH_TOKEN.Trim()
  } elseif (-not [string]::IsNullOrWhiteSpace($env:GITHUB_TOKEN)) {
    $env:GITHUB_TOKEN.Trim()
  } else {
    $ghCommand = Get-Command gh -ErrorAction SilentlyContinue
    $ghToken = if ($ghCommand) {
      (& $ghCommand.Source auth token 2>$null | Out-String).Trim()
    } else {
      ""
    }

    $savedToken = if ([string]::IsNullOrWhiteSpace($ghToken)) {
      try {
        Get-MinovaSavedGitHubToken
      } catch {
        Write-Warning "The previously saved GitHub credential is no longer readable. Paste a replacement when prompted; Minova will encrypt it for future releases."
        ""
      }
    } else {
      ""
    }

    if (-not [string]::IsNullOrWhiteSpace($ghToken)) {
      $ghToken
    } elseif (-not [string]::IsNullOrWhiteSpace($savedToken)) {
      $savedToken
    } else {
      Write-Host ""
      Write-Host "GitHub sign-in is required to publish Minova." -ForegroundColor Cyan
      Write-Host "Create a fine-grained token at:"
      Write-Host "  https://github.com/settings/personal-access-tokens/new" -ForegroundColor Blue
      Write-Host "Grant repository access to Minova-Chromium and Contents: Read and write."
      Write-Host "The token is hidden while pasted and encrypted for this Windows account."
      Write-Host ""

      $secureToken = Read-Host "Paste the GitHub token, or press Enter to cancel" -AsSecureString
      $savePromptedToken = $true
      (ConvertFrom-MinovaSecureString -SecureValue $secureToken).Trim()
    }
  }

  if ([string]::IsNullOrWhiteSpace($token)) {
    throw "GitHub publishing was cancelled. No files were uploaded."
  }

  $publishHeaders = @{
    Authorization = "Bearer $token"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
    "User-Agent" = "Minova-Release-Builder"
  }

  try {
    $githubUser = Invoke-RestMethod -Method Get -Uri "https://api.github.com/user" -Headers $publishHeaders
  } catch {
    throw "GitHub sign-in failed. Check that the token is valid and has Contents: Read and write access to minova-chromium/Minova-Chromium."
  }
  if ($savePromptedToken) {
    Save-MinovaGitHubToken -Token $token | Out-Null
    Write-Host "The token is now encrypted for future Minova releases." -ForegroundColor Green
  }
  Write-Host "GitHub authentication ready for @$($githubUser.login)." -ForegroundColor Green
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$codexNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$node = if ($nodeCommand) {
  $nodeCommand.Source
} elseif (Test-Path -LiteralPath $codexNode) {
  $codexNode
} else {
  throw "Node.js is required to build Minova. Install Node.js and reopen this command."
}

function New-MinovaSourceArchive {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,
    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,
    [Parameter(Mandatory = $true)]
    [string]$ReleaseVersion
  )

  $archive = Join-Path $OutputDirectory "Minova-Chromium-Source-$ReleaseVersion.zip"
  $stage = Join-Path $OutputDirectory ".source-$ReleaseVersion"
  $resolvedOutput = [IO.Path]::GetFullPath($OutputDirectory).TrimEnd('\')
  $resolvedStage = [IO.Path]::GetFullPath($stage)
  if (-not $resolvedStage.StartsWith("$resolvedOutput\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "The source staging directory resolved outside the release output folder."
  }

  if ([IO.Directory]::Exists($resolvedStage)) {
    [IO.Directory]::Delete($resolvedStage, $true)
  }
  [IO.Directory]::CreateDirectory($resolvedStage) | Out-Null

  $sourceDirectories = @(".github", "assets", "brand", "installer", "release-notes", "scripts", "server", "src", "website")
  foreach ($name in $sourceDirectories) {
    $sourcePath = Join-Path $ProjectRoot $name
    if (Test-Path -LiteralPath $sourcePath) {
      Copy-Item -LiteralPath $sourcePath -Destination $resolvedStage -Recurse -Force
    }
  }

  $artifactCopy = Join-Path $resolvedStage "scripts\artifacts"
  if ([IO.Directory]::Exists($artifactCopy)) {
    [IO.Directory]::Delete($artifactCopy, $true)
  }

  $sourceFiles = Get-ChildItem -LiteralPath $ProjectRoot -File | Where-Object {
    $_.Name -eq "LICENSE" -or $_.Extension -in @(".cmd", ".js", ".json", ".md", ".ps1", ".yaml", ".yml")
  }
  foreach ($file in $sourceFiles) {
    Copy-Item -LiteralPath $file.FullName -Destination $resolvedStage -Force
  }

  if (Test-Path -LiteralPath $archive) {
    Remove-Item -LiteralPath $archive -Force
  }
  $archiveInputs = @(Get-ChildItem -LiteralPath $resolvedStage -Force | ForEach-Object { $_.FullName })
  Compress-Archive -Path $archiveInputs -DestinationPath $archive -CompressionLevel Optimal -Force
  [IO.Directory]::Delete($resolvedStage, $true)
  $archive
}

$coreSetup = Join-Path $output "Minova-Chromium-Update-$version.exe"
$setup = Join-Path $output "Minova-Chromium-Setup-$version.exe"
$blockmap = "$coreSetup.blockmap"
$latest = Join-Path $output "latest.yml"
$appUpdate = Join-Path $output "win-unpacked\resources\app-update.yml"
$sourceArchive = Join-Path $output "Minova-Chromium-Source-$version.zip"
$hashFile = Join-Path $output "SHA256SUMS.txt"
$manifestPath = Join-Path $output "release-files.json"
$releaseFiles = @($setup, $coreSetup, $blockmap, $latest, $sourceArchive)

if (-not $SkipTests) {
  Write-Host "Running Minova release checks..."
  & $node $unitTest
  if ($LASTEXITCODE -ne 0) {
    throw "Minova unit checks failed. The installer was not built."
  }
}

if (-not $UseExistingBuild) {
  $pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
  $codexPnpm = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
  $pnpm = if ($pnpmCommand) {
    $pnpmCommand.Source
  } elseif (Test-Path -LiteralPath $codexPnpm) {
    $codexPnpm
  } else {
    throw "pnpm is required to build Minova. Install pnpm or use the bundled developer runtime."
  }

  $pnpmDirectory = Split-Path -Parent $pnpm
  $nodeDirectory = Split-Path -Parent $node
  $env:Path = "$pnpmDirectory;$nodeDirectory;$env:Path"
  $pnpmVersion = (& $pnpm --version 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $pnpmVersion -notmatch '^\d+\.\d+\.\d+') {
    throw "pnpm could not start correctly from $pnpm"
  }
  Write-Host "Using pnpm $pnpmVersion from $pnpm"

  Write-Host "Building Minova Chromium $version updater release..."
  $buildLog = Join-Path $output "electron-builder.log"
  [IO.Directory]::CreateDirectory($output) | Out-Null
  $builderSucceeded = $false
  $builderExitCode = 1

  for ($attempt = 1; $attempt -le 2; $attempt += 1) {
    if ($attempt -gt 1) {
      Write-Host ""
      Write-Warning "Retrying electron-builder after a transient packaging failure..."
      Start-Sleep -Seconds 2
    }

    $buildOutput = @(& $node $builderCli "--win" "nsis" "--publish" "never" 2>&1)
    $builderExitCode = $LASTEXITCODE
    $buildOutput | ForEach-Object { Write-Host ([string]$_) }

    $logHeader = "=== electron-builder attempt $attempt at $([DateTime]::UtcNow.ToString('o')) ==="
    if ($attempt -eq 1) {
      @($logHeader) + @($buildOutput | ForEach-Object { [string]$_ }) |
        Set-Content -LiteralPath $buildLog -Encoding UTF8
    } else {
      @("", $logHeader) + @($buildOutput | ForEach-Object { [string]$_ }) |
        Add-Content -LiteralPath $buildLog -Encoding UTF8
    }

    if ($builderExitCode -eq 0) {
      $builderSucceeded = $true
      break
    }
  }

  if (-not $builderSucceeded) {
    throw "electron-builder failed twice with exit code $builderExitCode. Full log: $buildLog"
  }

  $brandedBuilder = Join-Path $root "scripts\build-branded-installer.ps1"
  if (-not (Test-Path -LiteralPath $coreSetup)) {
    throw "The updater-compatible core package is missing: $coreSetup"
  }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $brandedBuilder `
    -Version $version `
    -CoreSetup $coreSetup `
    -OutputDirectory $output
  if ($LASTEXITCODE -ne 0) {
    throw "The branded installer failed with exit code $LASTEXITCODE."
  }

  Write-Host "Creating the GPL-3.0 source archive..."
  New-MinovaSourceArchive -ProjectRoot $root -OutputDirectory $output -ReleaseVersion $version | Out-Null
}

$required = if ($UseExistingBuild) {
  @($releaseFiles + $hashFile + $manifestPath)
} else {
  @($releaseFiles + $appUpdate)
}
$missing = @($required | Where-Object { -not (Test-Path -LiteralPath $_) })
if ($missing.Count) {
  $instruction = if ($UseExistingBuild) {
    " Run Build Minova Installer.cmd before publishing."
  } else {
    ""
  }
  throw "The updater release is incomplete. Missing: $($missing -join ', ').$instruction"
}

if ($UseExistingBuild) {
  $existingManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ([string]$existingManifest.version -ne $version) {
    throw "The existing installer is version $($existingManifest.version), but package.json is $version. Run Build Minova Installer.cmd."
  }
  foreach ($file in $releaseFiles) {
    $item = Get-Item -LiteralPath $file
    $manifestFile = @($existingManifest.files | Where-Object { $_.name -eq $item.Name } | Select-Object -First 1)
    if (-not $manifestFile.Count) {
      throw "The release manifest does not contain $($item.Name). Run Build Minova Installer.cmd."
    }
    $actualHash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne [string]$manifestFile[0].sha256) {
      throw "$($item.Name) changed after it was built. Run Build Minova Installer.cmd again."
    }
  }
  $latestContents = Get-Content -LiteralPath $latest -Raw
  if ($latestContents -notmatch [Regex]::Escape((Get-Item -LiteralPath $coreSetup).Name)) {
    throw "latest.yml does not target the Minova $version updater. Run Build Minova Installer.cmd."
  }
  Write-Host "Verified the existing Minova $version release artifacts. Packaging will not run again." -ForegroundColor Green
}

$hashLines = foreach ($file in $releaseFiles) {
  $item = Get-Item -LiteralPath $file
  $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $($item.Name)"
}
$hashLines | Set-Content -LiteralPath $hashFile -Encoding ASCII

$manifest = [ordered]@{
  schemaVersion = 1
  product = "Minova Chromium"
  version = $version
  repository = "https://github.com/minova-chromium/Minova-Chromium"
  publicInstaller = (Get-Item -LiteralPath $setup).Name
  updaterPackage = (Get-Item -LiteralPath $coreSetup).Name
  generatedAt = [DateTime]::UtcNow.ToString("o")
  files = @($releaseFiles | ForEach-Object {
    $item = Get-Item -LiteralPath $_
    [ordered]@{
      name = $item.Name
      size = $item.Length
      sha256 = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  })
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

if ($Publish) {
  $repositoryApi = "https://api.github.com/repos/minova-chromium/Minova-Chromium"
  $tag = "v$version"
  try {
    $release = Invoke-RestMethod -Method Get -Uri "$repositoryApi/releases/tags/$tag" -Headers $publishHeaders
  } catch {
    $statusCode = if ($_.Exception.Response) {
      [int]$_.Exception.Response.StatusCode
    } else {
      0
    }
    if ($statusCode -ne 404) {
      throw
    }
    $releaseBody = @{
      tag_name = $tag
      name = "Minova Chromium $version"
      body = $releaseNotes
      draft = $false
      prerelease = $version.Contains("-")
      generate_release_notes = $generateReleaseNotes
    } | ConvertTo-Json
    $release = Invoke-RestMethod -Method Post -Uri "$repositoryApi/releases" -Headers $publishHeaders `
      -ContentType "application/json" -Body $releaseBody
  }

  $publishFiles = @($releaseFiles + $hashFile + $manifestPath)
  foreach ($file in $publishFiles) {
    $item = Get-Item -LiteralPath $file
    $existing = @($release.assets | Where-Object { $_.name -eq $item.Name } | Select-Object -First 1)
    if ($existing.Count) {
      Invoke-RestMethod -Method Delete -Uri "$repositoryApi/releases/assets/$($existing[0].id)" -Headers $publishHeaders | Out-Null
    }
    $uploadBase = [string]$release.upload_url -replace '\{.*$', ''
    $assetName = [Uri]::EscapeDataString($item.Name)
    Write-Host "Uploading $($item.Name)..."
    Invoke-RestMethod -Method Post -Uri "${uploadBase}?name=$assetName" -Headers $publishHeaders `
      -ContentType "application/octet-stream" -InFile $item.FullName | Out-Null
  }

  if (-not $NoAdvanceVersion) {
    if (-not (Test-Path -LiteralPath $versionAdvancer)) {
      throw "The release uploaded, but the version advancer is missing: $versionAdvancer"
    }
    $nextVersion = (& $node $versionAdvancer $version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($nextVersion)) {
      throw "Minova $version uploaded, but package.json could not be advanced to the next patch version."
    }
    Write-Host ""
    Write-Host "Published Minova Chromium $version successfully." -ForegroundColor Green
    Write-Host "The next release is now prepared as $nextVersion." -ForegroundColor Cyan
  }
}

Write-Host ""
Write-Host "Minova updater release ready:"
Write-Host "  Public installer: $setup"
Write-Host "  Updater package:  $coreSetup"
Write-Host "  $blockmap"
Write-Host "  $latest"
Write-Host "  $sourceArchive"
Write-Host "  $hashFile"
if (-not $Publish) {
  Write-Host ""
  Write-Host "Nothing was published. Use Publish Minova GitHub Release.cmd after final testing."
}
