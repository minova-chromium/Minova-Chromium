param(
  [Parameter(Mandatory = $true)]
  [string]$ScenesPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"

$scenes = Get-Content -LiteralPath $ScenesPath -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$voice = New-Object -ComObject SAPI.SpVoice
$voices = $voice.GetVoices()
$preferredVoice = $null
for ($index = 0; $index -lt $voices.Count; $index += 1) {
  $candidate = $voices.Item($index)
  if ($candidate.GetDescription() -like "*Zira*") {
    $preferredVoice = $candidate
    break
  }
}
if ($preferredVoice) {
  $voice.Voice = $preferredVoice
}
$voice.Rate = 1
$voice.Volume = 100

$rendered = @()
try {
  for ($index = 0; $index -lt $scenes.Count; $index += 1) {
    $sceneNumber = $index + 1
    $destination = Join-Path $OutputDirectory ("scene-{0:D2}.wav" -f $sceneNumber)
    $stream = New-Object -ComObject SAPI.SpFileStream
    try {
      # SSFMCreateForWrite = 3. SAPI writes uncompressed PCM WAV files.
      $stream.Open($destination, 3, $false)
      $voice.AudioOutputStream = $stream
      [void]$voice.Speak([string]$scenes[$index].voiceover)
    }
    finally {
      $stream.Close()
      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($stream)
    }
    $rendered += [pscustomobject]@{
      scene = $sceneNumber
      title = [string]$scenes[$index].title
      file = $destination
      bytes = (Get-Item -LiteralPath $destination).Length
    }
  }
}
finally {
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($voice)
}

$rendered | ConvertTo-Json
