Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Security -ErrorAction Stop

function Get-MinovaGitHubTokenPath {
  $localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
  Join-Path $localAppData "Minova Chromium Developer\github-release-token.dat"
}

function Get-MinovaGitHubTokenEntropy {
  [Text.Encoding]::UTF8.GetBytes("Minova Chromium GitHub release credential v1")
}

function ConvertFrom-MinovaSecureString {
  param(
    [Parameter(Mandatory = $true)]
    [Security.SecureString]$SecureValue
  )

  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Get-MinovaSavedGitHubToken {
  $credentialPath = Get-MinovaGitHubTokenPath
  if (-not (Test-Path -LiteralPath $credentialPath)) {
    return ""
  }

  try {
    $protectedBytes = [Convert]::FromBase64String(
      [IO.File]::ReadAllText($credentialPath, [Text.Encoding]::ASCII).Trim()
    )
    $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
      $protectedBytes,
      (Get-MinovaGitHubTokenEntropy),
      [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    try {
      [Text.Encoding]::UTF8.GetString($plainBytes)
    } finally {
      [Array]::Clear($plainBytes, 0, $plainBytes.Length)
    }
  } catch {
    throw "The saved Minova GitHub credential could not be decrypted. Run Remove Minova GitHub Token.cmd, then save a replacement token."
  }
}

function Save-MinovaGitHubToken {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Token
  )

  if ([string]::IsNullOrWhiteSpace($Token) -or $Token.Length -lt 20 -or $Token -match '\s') {
    throw "The GitHub token is empty or malformed."
  }

  $credentialPath = Get-MinovaGitHubTokenPath
  $credentialDirectory = Split-Path -Parent $credentialPath
  [IO.Directory]::CreateDirectory($credentialDirectory) | Out-Null

  $plainBytes = [Text.Encoding]::UTF8.GetBytes($Token)
  try {
    $protectedBytes = [Security.Cryptography.ProtectedData]::Protect(
      $plainBytes,
      (Get-MinovaGitHubTokenEntropy),
      [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    [IO.File]::WriteAllText(
      $credentialPath,
      [Convert]::ToBase64String($protectedBytes),
      [Text.Encoding]::ASCII
    )
  } finally {
    [Array]::Clear($plainBytes, 0, $plainBytes.Length)
  }

  $credentialPath
}

function Remove-MinovaSavedGitHubToken {
  $credentialPath = Get-MinovaGitHubTokenPath
  if (Test-Path -LiteralPath $credentialPath) {
    Remove-Item -LiteralPath $credentialPath -Force
    return $true
  }
  $false
}
