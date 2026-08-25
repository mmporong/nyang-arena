param(
  [string]$Output = "docs/submission-video-previz.mp4",
  [string]$Manifest = "docs/generated/submission-video-previz.json",
  [switch]$SkipManifest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $Output))
$repoPrefix = $repoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $outputPath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Output path must stay inside the repository: $outputPath"
}
$manifestPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $Manifest))
if (-not $SkipManifest -and -not $manifestPath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Manifest path must stay inside the repository: $manifestPath"
}

$ffmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source
$ffprobe = (Get-Command ffprobe -ErrorAction Stop).Source
$inputs = @(
  "docs/thumbnail.png",
  "docs/shots/track-a/09-boss-arrival.png",
  "docs/shots/track-a/10-boss-danger.png",
  "docs/shots/track-a/11-boss-gather-perimeter.png",
  "docs/shots/track-a/12-boss-vulnerable.png",
  "docs/submission-video-previz.ass",
  "scripts/build-submission-video-previz.ps1",
  "public/bgm/title.mp3",
  "public/bgm/prepare.mp3",
  "public/bgm/boss.mp3",
  "public/bgm/outro.mp3"
)

foreach ($input in $inputs) {
  $inputPath = Join-Path $repoRoot $input
  if (-not (Test-Path -LiteralPath $inputPath -PathType Leaf)) {
    throw "Required input file is missing: $inputPath"
  }
}

$outputDirectory = Split-Path -Parent $outputPath
if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
  throw "Output directory does not exist: $outputDirectory"
}
if (-not $SkipManifest) {
  $manifestDirectory = Split-Path -Parent $manifestPath
  if (-not (Test-Path -LiteralPath $manifestDirectory -PathType Container)) {
    throw "Manifest directory does not exist: $manifestDirectory"
  }
}

$filter = @"
[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x120b0a,format=yuv420p[v0];
[1:v]format=yuv420p[v1];
[2:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x120b0a,format=yuv420p[v2];
[3:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x120b0a,format=yuv420p[v3];
[4:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x120b0a,format=yuv420p[v4];
[5:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x120b0a,format=yuv420p[v5];
[6:v]format=yuv420p[v6];
[7:v]format=yuv420p[v7];
[v0][v1]xfade=transition=fade:duration=0.75:offset=7.25[x1];
[x1][v2]xfade=transition=fade:duration=0.75:offset=14.50[x2];
[x2][v3]xfade=transition=fade:duration=0.75:offset=21.75[x3];
[x3][v4]xfade=transition=fade:duration=0.75:offset=29.00[x4];
[x4][v5]xfade=transition=fade:duration=0.75:offset=36.25[x5];
[x5][v6]xfade=transition=fade:duration=0.75:offset=43.50[x6];
[x6][v7]xfade=transition=fade:duration=0.75:offset=50.75[x7];
[x7]ass=docs/submission-video-previz.ass,fade=t=in:st=0:d=0.4,fade=t=out:st=58.0:d=0.736[vout];
[8:a]atrim=duration=4,aresample=48000,asetpts=N/SR/TB[a0];
[9:a]atrim=duration=21,aresample=48000,asetpts=N/SR/TB[a1];
[10:a]atrim=duration=21.736,aresample=48000,asetpts=N/SR/TB[a2];
[11:a]atrim=duration=15,aresample=48000,asetpts=N/SR/TB[a3];
[a0][a1]acrossfade=d=1:c1=tri:c2=tri[a01];
[a01][a2]acrossfade=d=1:c1=tri:c2=tri[a012];
[a012][a3]acrossfade=d=1:c1=tri:c2=tri,loudnorm=I=-18:LRA=7:TP=-1.5,afade=t=out:st=58.0:d=0.736,aformat=channel_layouts=stereo[aout]
"@

$arguments = @(
  "-y",
  "-hide_banner",
  "-loglevel", "warning",
  "-loop", "1", "-framerate", "30", "-t", "8", "-i", "docs/thumbnail.png",
  "-f", "lavfi", "-t", "8", "-i", "color=c=0x120b0a:s=1280x720:r=30",
  "-loop", "1", "-framerate", "30", "-t", "8", "-i", "docs/shots/track-a/09-boss-arrival.png",
  "-loop", "1", "-framerate", "30", "-t", "8", "-i", "docs/shots/track-a/10-boss-danger.png",
  "-loop", "1", "-framerate", "30", "-t", "8", "-i", "docs/shots/track-a/11-boss-gather-perimeter.png",
  "-loop", "1", "-framerate", "30", "-t", "8", "-i", "docs/shots/track-a/12-boss-vulnerable.png",
  "-f", "lavfi", "-t", "8", "-i", "color=c=0x120b0a:s=1280x720:r=30",
  "-f", "lavfi", "-t", "8", "-i", "color=c=0x120b0a:s=1280x720:r=30",
  "-i", "public/bgm/title.mp3",
  "-i", "public/bgm/prepare.mp3",
  "-i", "public/bgm/boss.mp3",
  "-i", "public/bgm/outro.mp3",
  "-filter_complex", $filter,
  "-map", "[vout]",
  "-map", "[aout]",
  "-t", "58.736",
  "-r", "30",
  "-c:v", "libx264",
  "-preset", "medium",
  "-crf", "20",
  "-pix_fmt", "yuv420p",
  "-profile:v", "high",
  "-level", "4.0",
  "-c:a", "aac",
  "-b:a", "192k",
  "-ar", "48000",
  "-ac", "2",
  "-movflags", "+faststart",
  $outputPath
)

Push-Location $repoRoot
try {
  & $ffmpeg @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "FFmpeg encoding failed with exit code $LASTEXITCODE."
  }

  $probe = (& $ffprobe -v error -show_entries "format=duration:stream=codec_name,codec_type,width,height,pix_fmt,r_frame_rate,sample_rate,channels" -of json $outputPath) | ConvertFrom-Json
  $video = $probe.streams | Where-Object { $_.codec_type -eq "video" } | Select-Object -First 1
  $audio = $probe.streams | Where-Object { $_.codec_type -eq "audio" } | Select-Object -First 1
  $accepted =
    [Math]::Abs([double]$probe.format.duration - 58.736) -le 0.050 -and
    $video.codec_name -eq "h264" -and
    $video.width -eq 1280 -and
    $video.height -eq 720 -and
    $video.pix_fmt -eq "yuv420p" -and
    $video.r_frame_rate -eq "30/1" -and
    $audio.codec_name -eq "aac" -and
    $audio.sample_rate -eq "48000" -and
    $audio.channels -eq 2
  if (-not $accepted) {
    throw "Encoded media failed the duration, video, or audio acceptance contract."
  }
}
finally {
  Pop-Location
}

$ffmpegVersion = (& $ffmpeg -version | Select-Object -First 1).Trim()
$ffprobeVersion = (& $ffprobe -version | Select-Object -First 1).Trim()
$outputHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $outputPath).Hash
if (-not $SkipManifest) {
  $sourceFiles = foreach ($input in $inputs) {
    $inputPath = Join-Path $repoRoot $input
    [ordered]@{
      path = $input.Replace("\", "/")
      sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $inputPath).Hash
    }
  }
  $gitHead = (& git -C $repoRoot rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to resolve the source Git commit."
  }
  $trackedStatus = @(& git -C $repoRoot status --porcelain --untracked-files=no)
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to resolve the tracked worktree status."
  }
  $sourceGitPaths = @($inputs + $Output) | ForEach-Object { $_.Replace("\", "/") }
  & git -C $repoRoot diff --quiet HEAD -- @sourceGitPaths
  $unstagedSourceExit = $LASTEXITCODE
  if ($unstagedSourceExit -gt 1) {
    throw "Unable to compare video sources with the source Git commit."
  }
  & git -C $repoRoot diff --cached --quiet HEAD -- @sourceGitPaths
  $stagedSourceExit = $LASTEXITCODE
  if ($stagedSourceExit -gt 1) {
    throw "Unable to compare staged video sources with the source Git commit."
  }
  $untrackedSource = $false
  foreach ($sourceGitPath in $sourceGitPaths) {
    $trackedMatch = @(& git -C $repoRoot ls-files -- $sourceGitPath)
    if ($LASTEXITCODE -ne 0) {
      throw "Unable to resolve tracked video source paths."
    }
    if ($trackedMatch.Count -eq 0) {
      $untrackedSource = $true
      break
    }
  }
  $manifestData = [ordered]@{
    schemaVersion = 1
    generatedFrom = [ordered]@{
      head = $gitHead
      trackedDirty = $trackedStatus.Count -gt 0
      sourceDirty = $unstagedSourceExit -eq 1 -or $stagedSourceExit -eq 1 -or $untrackedSource
    }
    tools = [ordered]@{
      ffmpeg = $ffmpegVersion
      ffprobe = $ffprobeVersion
    }
    sources = $sourceFiles
    output = [ordered]@{
      path = $Output.Replace("\", "/")
      sha256 = $outputHash
      durationSeconds = [double]$probe.format.duration
      video = [ordered]@{
        codec = $video.codec_name
        width = $video.width
        height = $video.height
        pixelFormat = $video.pix_fmt
        frameRate = $video.r_frame_rate
      }
      audio = [ordered]@{
        codec = $audio.codec_name
        sampleRate = [int]$audio.sample_rate
        channels = $audio.channels
      }
    }
  }
  $manifestJson = $manifestData | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText(
    $manifestPath,
    $manifestJson + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
  )
}
Write-Output "submission previz built: $outputPath"
Write-Output "encoder: $ffmpegVersion"
Write-Output "sha256: $outputHash"
if (-not $SkipManifest) {
  Write-Output "manifest: $manifestPath"
}
