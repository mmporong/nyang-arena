param(
  [switch]$AutomatedOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoPath = Split-Path -Parent $PSScriptRoot
$publicUrl = "https://mmporong.github.io/nyang-arena/"
$qaPort = 4174
$qaUrl = "http://127.0.0.1:$qaPort/qa.html"

function Invoke-NpmCheck {
  param([Parameter(Mandatory = $true)][string]$Name)

  Write-Host "`n[AUTO] npm run $Name" -ForegroundColor Cyan
  & npm.cmd run $Name
  if ($LASTEXITCODE -ne 0) {
    throw "npm run $Name failed (exit $LASTEXITCODE)"
  }
}

function Test-Yes {
  param([AllowEmptyString()][string]$Value)

  return @("y", "yes") -contains $Value.Trim().ToLowerInvariant()
}

Push-Location $repoPath
try {
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw "npm.cmd was not found. Install Node.js 22.6 or newer."
  }
  $viteEntry = Join-Path $repoPath "node_modules\vite\bin\vite.js"
  if (-not (Test-Path -LiteralPath $viteEntry)) {
    throw "Dependencies are missing. Run npm ci in $repoPath first."
  }

  Invoke-NpmCheck "typecheck"
  Invoke-NpmCheck "audio:runtime:test"
  Invoke-NpmCheck "asset:test"
  Invoke-NpmCheck "build"

  if (Test-Path -LiteralPath (Join-Path $repoPath "dist\qa.html")) {
    throw "qa.html must not be included in the production build."
  }
  $localBundles = @(Get-ChildItem -LiteralPath (Join-Path $repoPath "dist\assets") -Filter "index-*.js" -File)
  if ($localBundles.Count -ne 1) {
    throw "Expected exactly one local index JavaScript bundle, found $($localBundles.Count)."
  }
  $localHash = (Get-FileHash -LiteralPath $localBundles[0].FullName -Algorithm SHA256).Hash

  Write-Host "`n[AUTO] public deployment responses" -ForegroundColor Cyan
  $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $page = Invoke-WebRequest -Uri "${publicUrl}?qa-preflight=$stamp" -UseBasicParsing
  $scriptMatch = [regex]::Match($page.Content, '<script[^>]+src="([^"]+)"')
  if (-not $scriptMatch.Success) {
    throw "The deployed HTML does not contain a JavaScript bundle path."
  }
  $bundleUrl = (New-Object System.Uri ([Uri]$publicUrl, $scriptMatch.Groups[1].Value)).AbsoluteUri
  $bundle = Invoke-WebRequest -Uri "${bundleUrl}?qa-preflight=$stamp" -UseBasicParsing
  $sprite = Invoke-WebRequest -Uri "${publicUrl}sprites/03_idle.png?qa-preflight=$stamp" -UseBasicParsing
  $bgm = Invoke-WebRequest -Uri "${publicUrl}bgm/prepare.ogg?qa-preflight=$stamp" -UseBasicParsing

  if ([int]$page.StatusCode -ne 200 -or [int]$bundle.StatusCode -ne 200) {
    throw "The deployed page or JavaScript bundle did not return HTTP 200."
  }
  if (-not (($bundle.Headers["Content-Type"] -join ",") -match "(application|text)/javascript")) {
    throw "The deployed JavaScript Content-Type is invalid."
  }
  if (-not (($sprite.Headers["Content-Type"] -join ",") -match "image/png")) {
    throw "The deployed sprite Content-Type is not image/png."
  }
  if (-not (($bgm.Headers["Content-Type"] -join ",") -match "audio/ogg")) {
    throw "The deployed BGM Content-Type is not audio/ogg."
  }

  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $remoteHashBytes = $sha256.ComputeHash($bundle.RawContentStream.ToArray())
  } finally {
    $sha256.Dispose()
  }
  $remoteHash = -join @($remoteHashBytes | ForEach-Object { $_.ToString("X2") })
  if ($remoteHash -ne $localHash) {
    throw "The deployed JavaScript SHA-256 does not match the local production build."
  }

  Write-Host "PASS - public HTML/JS/PNG/OGG responses and bundle SHA-256 are valid." -ForegroundColor Green

  if ($AutomatedOnly) {
    Write-Host "`nAutomated preflight complete. Browser review skipped." -ForegroundColor Green
    return
  }

  $nodeCommand = Get-Command node.exe
  $viteProcess = $null
  try {
    $viteProcess = Start-Process `
      -FilePath $nodeCommand.Source `
      -ArgumentList @("node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "$qaPort", "--strictPort") `
      -WorkingDirectory $repoPath `
      -WindowStyle Hidden `
      -PassThru

    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
      if ($viteProcess.HasExited) {
        throw "The local QA server exited. Check whether port 4174 is already in use."
      }
      try {
        $qaPage = Invoke-WebRequest -Uri $qaUrl -UseBasicParsing -TimeoutSec 1
        if ([int]$qaPage.StatusCode -eq 200) {
          $ready = $true
          break
        }
      } catch {
        Start-Sleep -Milliseconds 250
      }
    }
    if (-not $ready) {
      throw "The local QA page was not ready within 15 seconds."
    }

    Start-Process -FilePath $qaUrl
    Write-Host "`nThe two-minute QA page is open in your browser." -ForegroundColor Yellow
    Write-Host "Review the icon gallery and 900x320 deployment, then play the three-signal sequence once."

    $visualAnswer = Read-Host "[1/2] Icons distinct and 900x320 view has no clipping/overlap (y/N)"
    $audioAnswer = Read-Host "[2/2] Two chirps / low swell / bright bell are distinct (y/N)"
    $visualPassed = Test-Yes $visualAnswer
    $audioPassed = Test-Yes $audioAnswer
    $manualPassed = $visualPassed -and $audioPassed

    $evidenceDir = Join-Path $repoPath ".omx\evidence"
    [System.IO.Directory]::CreateDirectory($evidenceDir) | Out-Null
    $evidencePath = Join-Path $evidenceDir "manual-qa-latest.md"
    $head = (& git rev-parse HEAD).Trim()
    $checkedAt = [DateTimeOffset]::Now.ToString("yyyy-MM-dd HH:mm:ss zzz")
    $result = if ($manualPassed) { "PASS" } else { "FAIL" }
    $lines = @(
      "# Nyang Arena manual QA",
      "",
      "- Visual: $(if ($visualPassed) { 'PASS' } else { 'FAIL' })",
      "- Audio: $(if ($audioPassed) { 'PASS' } else { 'FAIL' })",
      "- Overall: $result",
      "- Commit: ``$head``",
      "- Deployment: $publicUrl",
      "- Checked at: $checkedAt",
      "- Bundle SHA-256: ``$localHash``",
      "- Automated preflight: typecheck, audio:runtime:test, asset:test, build, public HTML/JS/PNG/OGG/SHA-256 PASS"
    )
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($evidencePath, $lines, $utf8)
    Write-Host "Evidence saved: $evidencePath"

    if (-not $manualPassed) {
      throw "Manual QA failed. The verdict was saved to the evidence file."
    }
    Write-Host "`nManual QA PASS" -ForegroundColor Green
  } finally {
    if ($null -ne $viteProcess -and -not $viteProcess.HasExited) {
      Stop-Process -Id $viteProcess.Id
    }
  }
} finally {
  Pop-Location
}
