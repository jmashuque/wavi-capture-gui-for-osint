param(
    [Parameter(Mandatory = $true)]
    [string]$InputFile,

    [Parameter(Mandatory = $true)]
    [string]$CaseName,

    [Parameter(Mandatory = $false)]
    [string]$CookiesFile,

    [Parameter(Mandatory = $false)]
    [string]$OutputRoot = ".\Investigations",

    [Parameter(Mandatory = $false)]
    [string]$YtDlpPath = ".\yt-dlp.exe",

    [Parameter(Mandatory = $false)]
    [string]$DenoPath,

    [Parameter(Mandatory = $false)]
    [string]$FFmpegFolder,

    [Parameter(Mandatory = $false)]
    [string]$ImpersonateTarget,

    [switch]$PreferMp4,

    [switch]$MetadataOnly,

    [switch]$IncludePlaylist,

    [switch]$WriteInfoJson,

    [switch]$WriteSourceLink,

    [switch]$WriteDescription,

    [switch]$WriteThumbnail,

    [switch]$WriteSubs,

    [switch]$WriteAutoSubs,

    [switch]$WriteComments
)

$ErrorActionPreference = "Stop"

function Write-Section {
    param([string]$Text)
    Write-Host ""
    Write-Host "========== $Text =========="
}

function Resolve-ToolPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PathOrCommand,

        [Parameter(Mandatory = $true)]
        [string]$ToolName
    )

    if ([string]::IsNullOrWhiteSpace($PathOrCommand)) {
        throw "$ToolName path is blank."
    }

    if (Test-Path -LiteralPath $PathOrCommand -PathType Leaf) {
        return (Resolve-Path -LiteralPath $PathOrCommand).Path
    }

    $cmd = Get-Command $PathOrCommand -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    throw "$ToolName was not found: $PathOrCommand"
}

function New-SafeCaseName {
    param([string]$Name)
    return ($Name -replace '[\\/:*?"<>|]', '_').Trim()
}

function Get-Sha256HashCompat {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (Get-Command Get-FileHash -ErrorAction SilentlyContinue) {
        return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    }

    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            $hashBytes = $sha.ComputeHash($stream)
            return ([BitConverter]::ToString($hashBytes) -replace '-', '').ToUpperInvariant()
        }
        finally {
            $sha.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

$YtDlpPath = Resolve-ToolPath -PathOrCommand $YtDlpPath -ToolName "yt-dlp"

if ([string]::IsNullOrWhiteSpace($DenoPath)) {
    $CandidateDeno = Join-Path (Split-Path -Parent $YtDlpPath) "deno.exe"
    if (Test-Path -LiteralPath $CandidateDeno -PathType Leaf) {
        $DenoPath = $CandidateDeno
    }
    else {
        $DenoPath = "deno"
    }
}

$DenoPath = Resolve-ToolPath -PathOrCommand $DenoPath -ToolName "Deno"

if (-not [string]::IsNullOrWhiteSpace($FFmpegFolder)) {
    if (-not (Test-Path -LiteralPath $FFmpegFolder -PathType Container)) {
        throw "FFmpeg folder not found: $FFmpegFolder"
    }

    $ffmpegExe = Join-Path $FFmpegFolder "ffmpeg.exe"
    $ffprobeExe = Join-Path $FFmpegFolder "ffprobe.exe"

    if (-not (Test-Path -LiteralPath $ffmpegExe -PathType Leaf)) {
        throw "ffmpeg.exe was not found in FFmpeg folder: $FFmpegFolder"
    }

    if (-not (Test-Path -LiteralPath $ffprobeExe -PathType Leaf)) {
        throw "ffprobe.exe was not found in FFmpeg folder: $FFmpegFolder"
    }
}

$SafeCaseName = New-SafeCaseName $CaseName
$CaseDir = Join-Path $OutputRoot $SafeCaseName
$MediaDir = Join-Path $CaseDir "media"
$LogDir = Join-Path $CaseDir "logs"
$ManifestDir = Join-Path $CaseDir "manifests"

$ArchiveFile = Join-Path $CaseDir "download-archive.txt"
$RunLog = Join-Path $LogDir ("yt-dlp-run_{0}.log" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
$HashManifest = Join-Path $ManifestDir ("sha256-manifest_{0}.csv" -f (Get-Date -Format "yyyyMMdd_HHmmss"))

New-Item -ItemType Directory -Path $CaseDir, $MediaDir, $LogDir, $ManifestDir -Force | Out-Null

Write-Section "Preflight checks"

if (-not (Test-Path -LiteralPath $InputFile -PathType Leaf)) {
    throw "Input file not found: $InputFile"
}

if ($CookiesFile -and -not (Test-Path -LiteralPath $CookiesFile -PathType Leaf)) {
    throw "Cookies file not found: $CookiesFile"
}

Write-Host "yt-dlp:        $YtDlpPath"
Write-Host "Deno:          $DenoPath"
Write-Host "FFmpeg folder: $FFmpegFolder"
Write-Host "Case:          $CaseDir"

Write-Section "Version info"

& $YtDlpPath --version 2>&1 | Tee-Object -FilePath $RunLog -Append
& $DenoPath --version 2>&1 | Tee-Object -FilePath $RunLog -Append

if (-not [string]::IsNullOrWhiteSpace($FFmpegFolder)) {
    $ffmpegExe = Join-Path $FFmpegFolder "ffmpeg.exe"
    & $ffmpegExe -version 2>&1 | Select-Object -First 1 | Tee-Object -FilePath $RunLog -Append
}

Write-Section "Capture options"

$OptionLines = @(
    "Prefer MP4:             $PreferMp4",
    "Metadata only:          $MetadataOnly",
    "Include playlist:       $IncludePlaylist",
    "Write metadata JSON:    $WriteInfoJson",
    "Write source link:      $WriteSourceLink",
    "Write description:      $WriteDescription",
    "Write thumbnail:        $WriteThumbnail",
    "Write subtitles:        $WriteSubs",
    "Write auto subtitles:   $WriteAutoSubs",
    "Write comments:         $WriteComments",
    "Impersonate target:     $ImpersonateTarget"
)

$OptionLines | Tee-Object -FilePath $RunLog -Append

Write-Section "Loading URLs"

$Urls = Get-Content -LiteralPath $InputFile |
    ForEach-Object { $_.Trim() } |
    Where-Object {
        $_ -and
        -not $_.StartsWith("#") -and
        ($_ -match '^https?://')
    }

if (-not $Urls -or $Urls.Count -eq 0) {
    throw "No valid URLs found in input file. Use one http/https URL per line."
}

Write-Host "Found $($Urls.Count) URL(s)."

Write-Section "Starting capture"

$CommonArgs = @(
    "--ignore-errors",
    "--no-overwrites",
    "--continue",
    "--restrict-filenames",
    "--trim-filenames", "180",

    "--js-runtimes", "deno:$DenoPath",

    "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "--add-header", "Accept-Language: en-US,en;q=0.9",

    "--no-embed-metadata",
    "--no-embed-thumbnail",
    "--no-embed-subs",

    "--sleep-requests", "5",
    "--sleep-interval", "30",
    "--max-sleep-interval", "90",

    "--retries", "5",
    "--fragment-retries", "5",
    "--retry-sleep", "exp=10:120",

    "--download-archive", $ArchiveFile,

    "--paths", $MediaDir,

    "--output", "%(extractor)s/%(uploader|unknown)s/%(upload_date|unknown)s_%(id)s_%(title).180B.%(ext)s",

    "--verbose"
)

if (-not $IncludePlaylist) {
    $CommonArgs += "--no-playlist"
}

if ($MetadataOnly) {
    $CommonArgs += "--skip-download"
}

if ($WriteInfoJson) {
    $CommonArgs += "--write-info-json"
}

if ($WriteSourceLink) {
    $CommonArgs += "--write-link"
}

if ($WriteDescription) {
    $CommonArgs += "--write-description"
}

if ($WriteThumbnail) {
    $CommonArgs += "--write-thumbnail"
}

if ($WriteSubs) {
    $CommonArgs += "--write-subs"
}

if ($WriteAutoSubs) {
    $CommonArgs += "--write-auto-subs"
}

if ($WriteComments) {
    $CommonArgs += "--write-comments"
}

if ($PreferMp4 -and -not $MetadataOnly) {
    $CommonArgs += @(
        "--format", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
        "--merge-output-format", "mp4"
    )
}

if ($CookiesFile) {
    $CommonArgs += @("--cookies", $CookiesFile)
}

if ($FFmpegFolder) {
    $CommonArgs += @("--ffmpeg-location", $FFmpegFolder)
}

if ($ImpersonateTarget) {
    $CommonArgs += @("--impersonate", $ImpersonateTarget)
}

for ($i = 0; $i -lt $Urls.Count; $i++) {
    $Url = $Urls[$i]

    Write-Host ""
    Write-Host "Capturing: $Url"

    try {
        & $YtDlpPath @CommonArgs $Url 2>&1 | Tee-Object -FilePath $RunLog -Append
    }
    catch {
        $msg = "ERROR capturing URL: $Url`r`n$($_.Exception.Message)"
        Write-Warning $msg
        Add-Content -Path $RunLog -Value $msg
    }

    if ($i -lt ($Urls.Count - 1)) {
        $PauseSeconds = Get-Random -Minimum 20 -Maximum 60
        Write-Host "Pausing $PauseSeconds seconds before next URL..."
        Start-Sleep -Seconds $PauseSeconds
    }
}

Write-Section "Hashing captured files"

$manifestRows = foreach ($file in Get-ChildItem $CaseDir -Recurse -File) {
    if ($file.FullName -eq $HashManifest) {
        continue
    }

    [PSCustomObject]@{
        Algorithm = "SHA256"
        Hash      = Get-Sha256HashCompat -Path $file.FullName
        Path      = $file.FullName
    }
}

$manifestRows | Export-Csv $HashManifest -NoTypeInformation

Write-Host "Hash manifest written to: $HashManifest"

Write-Section "Done"

Write-Host "Case folder:      $CaseDir"
Write-Host "Run log:          $RunLog"
Write-Host "Download archive: $ArchiveFile"
Write-Host "SHA256 manifest:  $HashManifest"
