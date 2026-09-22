param(
    [Parameter(Mandatory = $true)]
    [string]$InputFile,

    [Parameter(Mandatory = $true)]
    [string]$CaseName,

    [Parameter(Mandatory = $false)]
    [string]$OutputTemplate,

    [Parameter(Mandatory = $false)]
    [string]$CookiesFile,

    [Parameter(Mandatory = $false)]
    [string]$OutputRoot = ".\Investigations",

    [Parameter(Mandatory = $false)]
    [string]$GalleryDlPath = ".\gallery-dl.exe",

    [switch]$MetadataOnly,

    [switch]$MediaOnly,

    [switch]$WriteMetadata,

    [switch]$WriteInfoJson,

    [switch]$WriteTags,

    [Parameter(Mandatory = $false)]
    [ValidateSet("Use", "Ignore", "Force")]
    [string]$ArchiveMode = "Use",

    [Parameter(Mandatory = $false)]
    [ValidateSet("Fast", "Normal", "Cautious")]
    [string]$RateLimit = "Normal",

    [Parameter(Mandatory = $false)]
    [string]$IncludeKeywords,

    [Parameter(Mandatory = $false)]
    [ValidateRange(0, 1000000)]
    [int]$MaxItems = 0,

    [Parameter(Mandatory = $false)]
    [string]$ItemRange,

    [Parameter(Mandatory = $false)]
    [ValidateRange(1, 100)]
    [int]$Retries = 4,

    [Parameter(Mandatory = $false)]
    [ValidateRange(10, 900)]
    [int]$Timeout = 30,

    [Parameter(Mandatory = $false)]
    [string]$ProxyUrl,

    [Parameter(Mandatory = $false)]
    [string]$UniversalArchiveFile,

    [switch]$CreateEvidenceDerivative,

    [Parameter(Mandatory = $false)]
    [string]$FFmpegFolder,

    [Parameter(Mandatory = $false)]
    [string]$WaviVersion = "unknown",

    [switch]$MatchEvidenceSourceFormat,

    [Parameter(Mandatory = $false)]
    [string]$EvidenceStampTemplateBase64
)

$ErrorActionPreference = "Stop"

$DefaultEvidenceStampTemplate = "%url%`n%utcdatetime%"
$EvidenceStampTemplate = $DefaultEvidenceStampTemplate
if (-not [string]::IsNullOrWhiteSpace($EvidenceStampTemplateBase64)) {
    try {
        $EvidenceStampTemplate = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($EvidenceStampTemplateBase64))
    }
    catch {
        throw "Evidence stamp template could not be decoded: $($_.Exception.Message)"
    }
}
if ([string]::IsNullOrWhiteSpace($EvidenceStampTemplate)) {
    throw "Evidence stamp template cannot be blank."
}

if ($MetadataOnly -and $MediaOnly) {
    throw "MetadataOnly and MediaOnly cannot be used together."
}

if ($PSScriptRoot) {
    $ScriptRoot = $PSScriptRoot
}
else {
    $ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$AppTempFolder = Join-Path $ScriptRoot "gui-temp"

function New-AppTempFile {
    param(
        [Parameter(Mandatory = $true)][string]$Prefix,
        [Parameter(Mandatory = $false)][string]$Suffix = ".tmp"
    )

    if (-not (Test-Path -LiteralPath $AppTempFolder -PathType Container)) {
        New-Item -ItemType Directory -Path $AppTempFolder -Force | Out-Null
    }

    $safePrefix = ($Prefix -replace '[^A-Za-z0-9_.-]', '-')
    $safeSuffix = if ([string]::IsNullOrWhiteSpace($Suffix)) { ".tmp" } else { $Suffix }

    for ($i = 0; $i -lt 50; $i++) {
        $candidate = Join-Path $AppTempFolder ("{0}{1}{2}" -f $safePrefix, ([guid]::NewGuid().ToString("N")), $safeSuffix)
        if (-not (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }

    throw "Could not create a unique app temp file name."
}

function Write-Utf8NoBomText {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text
    )

    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Write-Section {
    param([string]$Text)
    Write-Host ""
    Write-Host "========== $Text =========="
}

function Resolve-ToolPath {
    param(
        [Parameter(Mandatory = $true)][string]$PathOrCommand,
        [Parameter(Mandatory = $true)][string]$ToolName
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

function ConvertTo-NativeArgument {
    param([AllowNull()][string]$Argument)

    if ($null -eq $Argument) {
        return '""'
    }

    if ($Argument.Length -eq 0) {
        return '""'
    }

    if ($Argument -notmatch '[\s"]') {
        return $Argument
    }

    $Result = '"'
    $Backslashes = 0

    foreach ($Char in $Argument.ToCharArray()) {
        if ($Char -eq '\') {
            $Backslashes++
            continue
        }

        if ($Char -eq '"') {
            if ($Backslashes -gt 0) {
                $Result += ('\' * ($Backslashes * 2))
                $Backslashes = 0
            }
            $Result += '\"'
            continue
        }

        if ($Backslashes -gt 0) {
            $Result += ('\' * $Backslashes)
            $Backslashes = 0
        }
        $Result += $Char
    }

    if ($Backslashes -gt 0) {
        $Result += ('\' * ($Backslashes * 2))
    }

    $Result += '"'
    return $Result
}

function Join-NativeArguments {
    param([string[]]$Arguments)

    return (($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' ')
}

function Invoke-GalleryDlSafely {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$RunLog
    )

    # Use System.Diagnostics.Process rather than Start-Process with temporary
    # stdout/stderr files. Reading both redirected streams asynchronously keeps
    # gallery-dl output live in WAVI while avoiding Windows PowerShell's native
    # stderr -> NativeCommandError conversion.
    $StartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $StartInfo.FileName = $FilePath
    $StartInfo.Arguments = Join-NativeArguments $Arguments
    $StartInfo.UseShellExecute = $false
    $StartInfo.CreateNoWindow = $true
    $StartInfo.RedirectStandardOutput = $true
    $StartInfo.RedirectStandardError = $true

    $Process = New-Object System.Diagnostics.Process
    $Process.StartInfo = $StartInfo

    try {
        if (-not $Process.Start()) {
            throw "gallery-dl process could not be started."
        }

        $StdOutTask = $Process.StandardOutput.ReadLineAsync()
        $StdErrTask = $Process.StandardError.ReadLineAsync()

        while ($null -ne $StdOutTask -or $null -ne $StdErrTask) {
            $PendingTasks = @()
            $TaskKinds = @()

            if ($null -ne $StdOutTask) {
                $PendingTasks += $StdOutTask
                $TaskKinds += "stdout"
            }
            if ($null -ne $StdErrTask) {
                $PendingTasks += $StdErrTask
                $TaskKinds += "stderr"
            }

            if ($PendingTasks.Count -eq 0) {
                break
            }

            $CompletedIndex = [System.Threading.Tasks.Task]::WaitAny([System.Threading.Tasks.Task[]]$PendingTasks, 250)

            if ($CompletedIndex -lt 0) {
                continue
            }

            $Kind = $TaskKinds[$CompletedIndex]
            if ($Kind -eq "stdout") {
                $Line = $StdOutTask.Result
                if ($null -eq $Line) {
                    $StdOutTask = $null
                }
                else {
                    if ($Line.Length -gt 0) {
                        Write-Host $Line
                        Write-RunLogLineOnly $Line
                    }
                    $StdOutTask = $Process.StandardOutput.ReadLineAsync()
                }
            }
            else {
                $Line = $StdErrTask.Result
                if ($null -eq $Line) {
                    $StdErrTask = $null
                }
                else {
                    if ($Line.Length -gt 0) {
                        Write-Host $Line
                        Write-RunLogLineOnly $Line
                    }
                    $StdErrTask = $Process.StandardError.ReadLineAsync()
                }
            }
        }

        $Process.WaitForExit()
        if ($null -eq $Process.ExitCode) {
            return 1
        }

        return [int]$Process.ExitCode
    }
    finally {
        if ($null -ne $Process) {
            try {
                if (-not $Process.HasExited) {
                    $Process.Kill()
                    [void]$Process.WaitForExit(2000)
                }
            }
            catch {
                # Best effort only. The GUI also terminates the full process tree
                # when the user stops or closes an active capture.
            }
            $Process.Dispose()
        }
    }
}

function New-SafeCaseName {
    param([string]$Name)

    $original = [string]$Name
    if ([string]::IsNullOrWhiteSpace($original)) {
        return ""
    }
    if ($original -match '[\x00-\x1F]') {
        throw "CaseName contains a Windows-invalid control character."
    }
    if ($original -match '[ .]$') {
        throw "CaseName cannot end with a space or period on Windows."
    }

    $safe = ($original -replace '[\\/:*?"<>|]', '_').Trim()
    if ([string]::IsNullOrWhiteSpace($safe)) {
        return ""
    }
    if ($safe.EndsWith('.')) {
        throw "CaseName cannot end with a period on Windows."
    }

    $baseName = (($safe -split '\.', 2)[0]).ToUpperInvariant()
    if ($baseName -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$') {
        throw "CaseName resolves to the Windows-reserved name '$safe'. Choose a different case name."
    }

    return $safe
}

function Test-RelativeOutputTemplate {
    param([Parameter(Mandatory = $true)][string]$Template)

    $clean = $Template.Trim().Replace('\', '/')

    if ([string]::IsNullOrWhiteSpace($clean)) {
        throw "OutputTemplate cannot be blank."
    }

    # Do not use [System.IO.Path]::IsPathRooted() here. yt-dlp/gallery-dl
    # output templates can contain native placeholder syntax such as
    # %(uploader|unknown)s, and .NET path validation treats the pipe as an
    # illegal literal path character before the capture tool has a chance to
    # resolve it. Only block clear absolute-path forms after normalizing
    # backslashes to forward slashes.
    if ($clean -match '^[A-Za-z]:' -or $clean.StartsWith('/')) {
        throw "OutputTemplate must be relative to the case media folder, not an absolute path."
    }

    if ($clean -notmatch '\{extension\}' -and $clean -notmatch '%extension%' -and $clean -notmatch '%ext%') {
        $clean = "$clean.{extension}"
    }

    foreach ($part in ($clean -split '/')) {
        if ([string]::IsNullOrWhiteSpace($part)) {
            throw "OutputTemplate cannot contain empty path segments."
        }
        if ($part -eq '..') {
            throw "OutputTemplate cannot contain '..' path traversal."
        }
    }

    return $clean
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

function New-DirectoryIfMissing {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Get-EvidenceImageState {
    param([Parameter(Mandatory = $true)][System.IO.FileInfo]$File)
    return ("{0}|{1}|{2}" -f $File.Length, $File.CreationTimeUtc.Ticks, $File.LastWriteTimeUtc.Ticks)
}

function Test-EvidenceImageExtension {
    param([Parameter(Mandatory = $true)][string]$Extension)
    return @('.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff') -contains $Extension.ToLowerInvariant()
}

function Get-EvidenceImageSnapshot {
    param([Parameter(Mandatory = $true)][string]$Root)
    $snapshot = @{}
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
        return $snapshot
    }
    foreach ($file in Get-ChildItem -LiteralPath $Root -File -Recurse -ErrorAction SilentlyContinue) {
        if (Test-EvidenceImageExtension -Extension $file.Extension) {
            $snapshot[[System.IO.Path]::GetFullPath($file.FullName).ToLowerInvariant()] = Get-EvidenceImageState -File $file
        }
    }
    return $snapshot
}

function Get-TruncatedEvidenceText {
    param(
        [AllowNull()][string]$Text,
        [Parameter(Mandatory = $false)][int]$MaxLength = 72
    )
    $value = [string]$Text
    if ($value.Length -le $MaxLength) {
        return $value
    }
    if ($MaxLength -lt 4) {
        return $value.Substring(0, $MaxLength)
    }
    return $value.Substring(0, $MaxLength - 3) + '...'
}

function Test-EvidenceTextFitsWidth {
    param(
        [Parameter(Mandatory = $true)][object]$Graphics,
        [Parameter(Mandatory = $true)][object]$Font,
        [AllowNull()][string]$Text,
        [Parameter(Mandatory = $true)][single]$MaxWidth
    )

    if ([string]::IsNullOrEmpty([string]$Text)) {
        return $true
    }
    $measured = $Graphics.MeasureString(
        [string]$Text,
        $Font,
        [int]::MaxValue,
        [System.Drawing.StringFormat]::GenericTypographic
    )
    return ($measured.Width -le ($MaxWidth + 0.25))
}

function Convert-EvidenceTextToMeasuredLines {
    param(
        [AllowNull()][string]$Text,
        [Parameter(Mandatory = $true)][object]$Graphics,
        [Parameter(Mandatory = $true)][object]$Font,
        [Parameter(Mandatory = $true)][single]$MaxWidth
    )

    $result = New-Object System.Collections.Generic.List[string]
    $logicalLines = ([string]$Text) -split '\r?\n'
    foreach ($logicalLine in $logicalLines) {
        $remaining = [string]$logicalLine
        if ($remaining.Length -eq 0) {
            [void]$result.Add('')
            continue
        }

        while ($remaining.Length -gt 0) {
            if (Test-EvidenceTextFitsWidth -Graphics $Graphics -Font $Font -Text $remaining -MaxWidth $MaxWidth) {
                [void]$result.Add($remaining)
                break
            }

            $low = 1
            $high = $remaining.Length
            $best = 1
            while ($low -le $high) {
                $mid = [int][Math]::Floor(($low + $high) / 2)
                $candidate = $remaining.Substring(0, $mid)
                if (Test-EvidenceTextFitsWidth -Graphics $Graphics -Font $Font -Text $candidate -MaxWidth $MaxWidth) {
                    $best = $mid
                    $low = $mid + 1
                }
                else {
                    $high = $mid - 1
                }
            }

            $candidate = $remaining.Substring(0, $best)
            $spaceAt = $candidate.LastIndexOf(' ')
            if ($spaceAt -gt 0) {
                $breakAt = $spaceAt
            }
            else {
                $breakAt = $best
            }

            $line = $remaining.Substring(0, $breakAt).TrimEnd()
            if ($line.Length -eq 0) {
                $line = $remaining.Substring(0, $best)
                $breakAt = $best
            }
            [void]$result.Add($line)
            $remaining = $remaining.Substring($breakAt).TrimStart()
        }
    }
    return $result.ToArray()
}

function Resolve-EvidenceStampTemplate {
    param(
        [Parameter(Mandatory = $true)][string]$Template,
        [Parameter(Mandatory = $true)][string]$Version,
        [Parameter(Mandatory = $true)][string]$CaseName,
        [Parameter(Mandatory = $true)][datetime]$CaptureLocal,
        [Parameter(Mandatory = $true)][datetime]$CaptureUtc,
        [Parameter(Mandatory = $true)][string]$DomainLabel,
        [Parameter(Mandatory = $true)][string]$SubmittedUrlLabel,
        [Parameter(Mandatory = $true)][int]$SourceCount,
        [Parameter(Mandatory = $true)][string]$OriginalRelativePath,
        [Parameter(Mandatory = $true)][string]$OriginalFileName,
        [Parameter(Mandatory = $true)][string]$OriginalExtension,
        [Parameter(Mandatory = $true)][string]$OriginalSha256
    )

    $resolved = [string]$Template
    $localDate = $CaptureLocal.ToString('yyyy-MM-dd')
    $localTime = $CaptureLocal.ToString('HHmmss')
    $localDateTime = $CaptureLocal.ToString('yyyy-MM-dd_HHmmss')
    $utcDateTime = $CaptureUtc.ToString('yyyyMMdd_HHmmssZ')
    $replacements = [ordered]@{
        '%version%' = $Version
        '%case%' = $CaseName
        '%date%' = $localDate
        '%time%' = $localTime
        '%datetime%' = $localDateTime
        '%utcdatetime%' = $utcDateTime
        '%engine%' = 'image'
        '%url%' = $SubmittedUrlLabel
        '%domain%' = $DomainLabel
        '%source_count%' = [string]$SourceCount
        '%original%' = $OriginalRelativePath
        '%filename%' = $OriginalFileName
        '%ext%' = $OriginalExtension
        '%sha256%' = $OriginalSha256
    }
    foreach ($entry in $replacements.GetEnumerator()) {
        $resolved = $resolved.Replace([string]$entry.Key, [string]$entry.Value)
    }
    return $resolved
}

function Invoke-NativeCaptureText {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = Join-NativeArguments $Arguments
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) {
            throw "Could not start native tool: $FilePath"
        }
        $stdout = $process.StandardOutput.ReadToEnd()
        $stderr = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) {
            throw ("Native tool failed with exit code {0}: {1}" -f $process.ExitCode, $stderr.Trim())
        }
        return $stdout.Trim()
    }
    finally {
        $process.Dispose()
    }
}

function Get-EvidenceImageDimensions {
    param(
        [Parameter(Mandatory = $true)][string]$FFprobePath,
        [Parameter(Mandatory = $true)][string]$ImagePath
    )
    $result = Invoke-NativeCaptureText -FilePath $FFprobePath -Arguments @(
        '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', $ImagePath
    )
    if ($result -notmatch '^(\d+)x(\d+)$') {
        throw "ffprobe did not return image dimensions for: $ImagePath"
    }
    return @([int]$Matches[1], [int]$Matches[2])
}

function New-EvidenceFooterImage {
    param(
        [Parameter(Mandatory = $true)][int]$Width,
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$OutputPath
    )

    if ($Width -lt 1) {
        throw 'Evidence footer width is invalid.'
    }

    Add-Type -AssemblyName System.Drawing -ErrorAction Stop | Out-Null

    $fontSize = 14
    $lineSpacing = 3
    $horizontalPadding = 12
    $verticalPadding = 10
    $textWidth = [single][Math]::Max(1, $Width - ($horizontalPadding * 2))

    $measureBitmap = $null
    $measureGraphics = $null
    $font = $null
    try {
        $measureBitmap = New-Object System.Drawing.Bitmap(1, 1, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $measureGraphics = [System.Drawing.Graphics]::FromImage($measureBitmap)
        $measureGraphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $font = New-Object System.Drawing.Font('Segoe UI', [single]$fontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

        $lines = Convert-EvidenceTextToMeasuredLines -Text $Text -Graphics $measureGraphics -Font $font -MaxWidth $textWidth
        if ($lines.Count -lt 1) {
            $lines = @('')
        }
        $lineHeight = [int][Math]::Ceiling($font.GetHeight($measureGraphics))
        $textHeight = ($lines.Count * $lineHeight) + ([Math]::Max(0, $lines.Count - 1) * $lineSpacing)
        $footerHeight = (2 * $verticalPadding) + $textHeight
    }
    finally {
        if ($font) { $font.Dispose() }
        if ($measureGraphics) { $measureGraphics.Dispose() }
        if ($measureBitmap) { $measureBitmap.Dispose() }
    }

    $bitmap = $null
    $graphics = $null
    $drawFont = $null
    $brush = $null
    try {
        $bitmap = New-Object System.Drawing.Bitmap($Width, $footerHeight, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.Clear([System.Drawing.Color]::Black)
        $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $drawFont = New-Object System.Drawing.Font('Segoe UI', [single]$fontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
        $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)

        $x = [single]$horizontalPadding
        $y = [single]$verticalPadding
        foreach ($line in $lines) {
            $graphics.DrawString([string]$line, $drawFont, $brush, $x, $y, [System.Drawing.StringFormat]::GenericTypographic)
            $y += [single]($lineHeight + $lineSpacing)
        }

        $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        if ($brush) { $brush.Dispose() }
        if ($drawFont) { $drawFont.Dispose() }
        if ($graphics) { $graphics.Dispose() }
        if ($bitmap) { $bitmap.Dispose() }
    }

    return [pscustomobject]@{
        height = [int]$footerHeight
        line_count = [int]$lines.Count
        font_size = [int]$fontSize
        horizontal_padding = [int]$horizontalPadding
        vertical_padding = [int]$verticalPadding
    }
}

function New-EvidenceDerivative {
    param(
        [Parameter(Mandatory = $true)][System.IO.FileInfo]$OriginalFile,
        [Parameter(Mandatory = $true)][string]$MediaRoot,
        [Parameter(Mandatory = $true)][string]$CaseRoot,
        [Parameter(Mandatory = $true)][string]$FFmpegPath,
        [Parameter(Mandatory = $true)][string]$FFprobePath,
        [Parameter(Mandatory = $true)][datetime]$CaptureLocal,
        [Parameter(Mandatory = $true)][datetime]$CaptureUtc,
        [Parameter(Mandatory = $true)][string[]]$SubmittedUrls,
        [Parameter(Mandatory = $true)][string]$Version,
        [Parameter(Mandatory = $true)][string]$StampTemplate,
        [switch]$MatchSourceFormat
    )

    $originalFullPath = [System.IO.Path]::GetFullPath($OriginalFile.FullName)
    $originalRelativeToCase = $originalFullPath.Substring($CaseRoot.Length).TrimStart('\', '/') -replace '\\', '/'
    $relativeToMedia = $originalFullPath.Substring($MediaRoot.Length).TrimStart('\', '/')
    $relativeDirectory = Split-Path -Parent $relativeToMedia
    $derivedRoot = Join-Path $CaseRoot 'derived\evidence'
    $destinationDirectory = if ([string]::IsNullOrWhiteSpace($relativeDirectory)) { $derivedRoot } else { Join-Path $derivedRoot $relativeDirectory }
    New-DirectoryIfMissing -Path $destinationDirectory

    $sourceExtension = $OriginalFile.Extension.ToLowerInvariant()
    $outputExtension = if ($MatchSourceFormat) { $sourceExtension } else { '.png' }
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($OriginalFile.Name)
    $sourceSuffix = if ((-not $MatchSourceFormat) -and $sourceExtension -ne '.png') { '_' + $sourceExtension.TrimStart('.') } else { '' }
    $derivativeStem = $baseName + $sourceSuffix + '_evidence_' + $RunStamp
    $derivativePath = Join-Path $destinationDirectory ($derivativeStem + $outputExtension)
    $sidecarPath = Join-Path $destinationDirectory ($derivativeStem + '.evidence.json')
    $tempDerivative = Join-Path $destinationDirectory ('.wavi-evidence-' + [guid]::NewGuid().ToString('N') + $outputExtension)
    $tempSidecar = Join-Path $destinationDirectory ('.wavi-evidence-' + [guid]::NewGuid().ToString('N') + '.json')
    $footerImage = New-AppTempFile -Prefix 'wavi-evidence-footer-' -Suffix '.png'

    $originalHashBefore = Get-Sha256HashCompat -Path $originalFullPath
    $dimensions = Get-EvidenceImageDimensions -FFprobePath $FFprobePath -ImagePath $originalFullPath
    $width = [int]$dimensions[0]

    $domainLabel = if ($SubmittedUrls.Count -eq 1) {
        try {
            $uri = [Uri]$SubmittedUrls[0]
            if ($uri.Host) { $uri.Host } else { 'unknown-domain' }
        }
        catch { 'unknown-domain' }
    }
    elseif ($SubmittedUrls.Count -gt 1) {
        'multiple-domains'
    }
    else {
        'unknown-domain'
    }
    $submittedUrlLabel = if ($SubmittedUrls.Count -eq 1) {
        [string]$SubmittedUrls[0]
    }
    else {
        ("Multiple submitted URLs ({0})" -f $SubmittedUrls.Count)
    }

    $resolvedStampText = Resolve-EvidenceStampTemplate `
        -Template $StampTemplate `
        -Version $Version `
        -CaseName $SafeCaseName `
        -CaptureLocal $CaptureLocal `
        -CaptureUtc $CaptureUtc `
        -DomainLabel $domainLabel `
        -SubmittedUrlLabel $submittedUrlLabel `
        -SourceCount $SubmittedUrls.Count `
        -OriginalRelativePath $originalRelativeToCase `
        -OriginalFileName $OriginalFile.Name `
        -OriginalExtension $sourceExtension.TrimStart('.') `
        -OriginalSha256 $originalHashBefore

    $footerLayout = New-EvidenceFooterImage `
        -Width $width `
        -Text $resolvedStampText `
        -OutputPath $footerImage

    $filter = '[0:v]format=rgba[base];[1:v]format=rgba[footer];[base][footer]vstack=inputs=2[v]'
    $ffmpegArgs = @('-hide_banner', '-loglevel', 'error', '-y', '-i', $originalFullPath, '-i', $footerImage, '-filter_complex', $filter, '-map', '[v]', '-frames:v', '1', '-map_metadata', '-1')
    switch ($outputExtension) {
        '.jpg'  { $ffmpegArgs += @('-q:v', '2') }
        '.jpeg' { $ffmpegArgs += @('-q:v', '2') }
        '.png'  { $ffmpegArgs += @('-compression_level', '6') }
        '.webp' { $ffmpegArgs += @('-lossless', '1') }
    }
    $ffmpegArgs += $tempDerivative

    try {
        [void](Invoke-NativeCaptureText -FilePath $FFmpegPath -Arguments $ffmpegArgs)
        if (-not (Test-Path -LiteralPath $tempDerivative -PathType Leaf)) {
            throw "FFmpeg did not create the evidence derivative."
        }

        $originalHashAfter = Get-Sha256HashCompat -Path $originalFullPath
        if (-not [string]::Equals($originalHashBefore, $originalHashAfter, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Original image hash changed while creating the evidence derivative."
        }

        $tempDerivativeItem = Get-Item -LiteralPath $tempDerivative -ErrorAction Stop
        $derivativeHash = Get-Sha256HashCompat -Path $tempDerivativeItem.FullName
        $derivativeRelativeToCase = $derivativePath.Substring($CaseRoot.Length).TrimStart('\', '/') -replace '\\', '/'

        $payload = [ordered]@{
            schema_version = 3
            artifact_type = 'wavi-evidence-derivative'
            created_utc = $CaptureUtc.ToString('yyyy-MM-ddTHH:mm:ssZ')
            generator = [ordered]@{
                name = 'WAVI Capture GUI for OSINT'
                version = $Version
                method = 'Windows/.NET-rendered evidence footer stacked by FFmpeg'
            }
            stamp = [ordered]@{
                template = $StampTemplate
                rendered_text = $resolvedStampText
            }
            original = [ordered]@{
                relative_path = $originalRelativeToCase
                format = $sourceExtension.TrimStart('.')
                sha256 = $originalHashBefore
                size_bytes = [int64]$OriginalFile.Length
                unchanged_after_derivative_verified = $true
            }
            derivative = [ordered]@{
                relative_path = $derivativeRelativeToCase
                format = $outputExtension.TrimStart('.')
                format_policy = $(if ($MatchSourceFormat) { 'match-source-format' } else { 'lossless-png-default' })
                encoding = $(switch ($outputExtension) { '.jpg' { 'jpeg-q2' } '.jpeg' { 'jpeg-q2' } '.png' { 'png-lossless' } '.webp' { 'webp-lossless' } '.bmp' { 'bmp' } '.tif' { 'tiff' } '.tiff' { 'tiff' } default { 'ffmpeg-default' } })
                sha256 = $derivativeHash
                size_bytes = [int64]$tempDerivativeItem.Length
            }
            source = [ordered]@{
                submitted_url_count = [int]$SubmittedUrls.Count
                submitted_urls = @($SubmittedUrls)
                note = $(if ($SubmittedUrls.Count -eq 1) { 'Single submitted source URL for this capture run.' } else { 'Multiple source URLs were submitted in this capture run; WAVI does not claim per-item URL attribution in the overlay.' })
            }
        }
        Write-Utf8NoBomText -Path $tempSidecar -Text (($payload | ConvertTo-Json -Depth 8) + [Environment]::NewLine)

        $derivativeCommitted = $false
        $sidecarCommitted = $false
        try {
            Move-Item -LiteralPath $tempDerivative -Destination $derivativePath -Force
            $derivativeCommitted = $true
            Move-Item -LiteralPath $tempSidecar -Destination $sidecarPath -Force
            $sidecarCommitted = $true
        }
        catch {
            if ($derivativeCommitted -and -not $sidecarCommitted) {
                Remove-Item -LiteralPath $derivativePath -Force -ErrorAction SilentlyContinue
            }
            if ($sidecarCommitted -and -not $derivativeCommitted) {
                Remove-Item -LiteralPath $sidecarPath -Force -ErrorAction SilentlyContinue
            }
            throw
        }

        return [ordered]@{
            original = $originalRelativeToCase
            derivative = $derivativeRelativeToCase
            original_hash = $originalHashBefore
            derivative_hash = $derivativeHash
            sidecar = ($sidecarPath.Substring($CaseRoot.Length).TrimStart('\', '/') -replace '\\', '/')
        }
    }
    finally {
        Remove-Item -LiteralPath $tempDerivative -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $tempSidecar -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $footerImage -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Path -LiteralPath $InputFile -PathType Leaf)) {
    throw "InputFile was not found: $InputFile"
}

$GalleryDlPath = Resolve-ToolPath -PathOrCommand $GalleryDlPath -ToolName "gallery-dl"
$FFmpegPath = $null
$FFprobePath = $null
if ($CreateEvidenceDerivative -and -not $MetadataOnly) {
    $ffmpegCandidate = if ([string]::IsNullOrWhiteSpace($FFmpegFolder)) { 'ffmpeg.exe' } else { Join-Path $FFmpegFolder 'ffmpeg.exe' }
    $ffprobeCandidate = if ([string]::IsNullOrWhiteSpace($FFmpegFolder)) { 'ffprobe.exe' } else { Join-Path $FFmpegFolder 'ffprobe.exe' }
    $FFmpegPath = Resolve-ToolPath -PathOrCommand $ffmpegCandidate -ToolName 'ffmpeg'
    $FFprobePath = Resolve-ToolPath -PathOrCommand $ffprobeCandidate -ToolName 'ffprobe'
}
$SafeCaseName = New-SafeCaseName -Name $CaseName
if ([string]::IsNullOrWhiteSpace($SafeCaseName)) {
    throw "CaseName is blank after sanitizing."
}

if ([string]::IsNullOrWhiteSpace($OutputTemplate)) {
    $OutputTemplate = "{category}/{subcategory}/{id}_{filename}.{extension}"
}
$OutputTemplate = Test-RelativeOutputTemplate -Template $OutputTemplate

$OutputRootFull = [System.IO.Path]::GetFullPath($OutputRoot)
$CaseFolder = Join-Path $OutputRootFull $SafeCaseName
$MediaFolder = Join-Path $CaseFolder "media"
$LogsFolder = Join-Path $CaseFolder "logs"
$ManifestsFolder = Join-Path $CaseFolder "manifests"

New-DirectoryIfMissing -Path $OutputRootFull
New-DirectoryIfMissing -Path $CaseFolder
New-DirectoryIfMissing -Path $MediaFolder
New-DirectoryIfMissing -Path $LogsFolder
New-DirectoryIfMissing -Path $ManifestsFolder

$RunStartedLocal = Get-Date
$RunStartedUtc = $RunStartedLocal.ToUniversalTime()
$RunStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$RunLog = Join-Path $LogsFolder "gallery-dl-run_$RunStamp.log"
$ArchiveFile = Join-Path $ManifestsFolder "gallery-dl-archive.sqlite3"
$ArchiveFileUsed = $ArchiveFile
if ($ArchiveMode -eq "Use" -and -not [string]::IsNullOrWhiteSpace($UniversalArchiveFile)) {
    $UniversalArchiveParent = Split-Path -Parent $UniversalArchiveFile
    if (-not [string]::IsNullOrWhiteSpace($UniversalArchiveParent)) {
        New-DirectoryIfMissing -Path $UniversalArchiveParent
    }
    $ArchiveFileUsed = [System.IO.Path]::GetFullPath($UniversalArchiveFile)
}
$UnsupportedFile = Join-Path $LogsFolder "gallery-dl-unsupported_$RunStamp.txt"
$ManifestFile = Join-Path $ManifestsFolder "gallery-dl-sha256-manifest_$RunStamp.csv"
$CapturedUrlsFile = Join-Path $OutputRootFull "gui-captured-urls.txt"
$FailedUrlsFile = Join-Path $OutputRootFull "gui-failed-urls.txt"
$script:RunLogWriter = $null

function Initialize-RunLogWriter {
    if ($null -ne $script:RunLogWriter) {
        return
    }

    $encoding = New-Object System.Text.UTF8Encoding($false)
    $script:RunLogWriter = New-Object System.IO.StreamWriter($RunLog, $true, $encoding)
}

function Write-RunLogLineOnly {
    param([AllowNull()][string]$Message)

    if ($null -eq $script:RunLogWriter) {
        Initialize-RunLogWriter
    }

    if ($null -ne $script:RunLogWriter) {
        $script:RunLogWriter.WriteLine([string]$Message)
    }
    else {
        Add-Content -LiteralPath $RunLog -Value $Message -Encoding UTF8
    }
}

function Close-RunLogWriter {
    if ($null -ne $script:RunLogWriter) {
        try {
            $script:RunLogWriter.Flush()
        }
        finally {
            $script:RunLogWriter.Dispose()
            $script:RunLogWriter = $null
        }
    }
}

Initialize-RunLogWriter

function Write-RunLog {
    param([string]$Message)
    Write-Host $Message
    Write-RunLogLineOnly $Message
}

$UrlList = New-Object System.Collections.Generic.List[string]
foreach ($line in Get-Content -LiteralPath $InputFile -Encoding UTF8) {
    $trimmed = $line.Trim()
    if ($trimmed -and -not $trimmed.StartsWith('#')) {
        [void]$UrlList.Add($trimmed)
    }
}
$Urls = $UrlList.ToArray()

if (-not $Urls.Count) {
    throw "No URLs were found in InputFile."
}

$PreCaptureEvidenceImageState = @{}
if ($CreateEvidenceDerivative -and -not $MetadataOnly) {
    $PreCaptureEvidenceImageState = Get-EvidenceImageSnapshot -Root $MediaFolder
}

Write-Section "Gallery/Profile Capture Setup"
Write-RunLog "gallery-dl path: $GalleryDlPath"
Write-RunLog "Input file: $InputFile"
Write-RunLog "Case folder: $CaseFolder"
Write-RunLog "Media folder: $MediaFolder"
Write-RunLog "Output template: $OutputTemplate"
Write-RunLog "Archive mode: $ArchiveMode"
Write-RunLog "Archive file: $ArchiveFileUsed"
if ($MetadataOnly) {
    Write-RunLog "Capture mode: metadata/artifacts only (media download disabled)"
    if ($ArchiveMode -eq "Use") {
        Write-RunLog "Archive table: wavi_metadata (isolated from full-media archive records)"
    }
}
elseif ($MediaOnly) {
    Write-RunLog "Capture mode: media only (metadata sidecars disabled)"
}
else {
    Write-RunLog "Capture mode: media + selected metadata"
}
Write-RunLog "Rate limit: $RateLimit"
Write-RunLog ("Include keywords: {0}" -f ($(if ([string]::IsNullOrWhiteSpace($IncludeKeywords)) { "(default extractor scope)" } else { $IncludeKeywords })))
Write-RunLog "URL count: $($Urls.Count)"
Write-RunLog ("Evidence stamping: {0}" -f ($(if ($CreateEvidenceDerivative -and -not $MetadataOnly) { "enabled" } elseif ($CreateEvidenceDerivative) { "enabled but inactive in metadata-only mode" } else { "disabled" })))
if ($CreateEvidenceDerivative -and -not $MetadataOnly) {
    Write-RunLog ("Evidence stamp output: {0}" -f ($(if ($MatchEvidenceSourceFormat) { "match source format" } else { "lossless PNG (default)" })))
}

$BaseArgs = @(
    "--config-ignore",
    "--destination", $MediaFolder,
    "--filename", $OutputTemplate,
    "--write-unsupported", $UnsupportedFile,
    "--retries", [string]$Retries,
    "--http-timeout", [string]$Timeout,
    "--windows-filenames"
)

if (-not $MediaOnly -and $WriteMetadata) { $BaseArgs += "--write-metadata" }
if (-not $MediaOnly -and $WriteInfoJson) { $BaseArgs += "--write-info-json" }
if (-not $MediaOnly -and $WriteTags) { $BaseArgs += "--write-tags" }

if ($ArchiveMode -eq "Use") {
    $BaseArgs += @("--download-archive", $ArchiveFileUsed)

    # Metadata-only captures deliberately use a separate archive namespace.
    # Otherwise gallery-dl's normal archive write on a successful --no-download
    # item would make a later full-media run treat that item as already downloaded.
    if ($MetadataOnly) {
        $BaseArgs += @("--option", "archive-table=wavi_metadata")
    }
}
elseif ($ArchiveMode -eq "Force") {
    $BaseArgs += "--no-skip"
}

if (-not [string]::IsNullOrWhiteSpace($CookiesFile)) {
    if (-not (Test-Path -LiteralPath $CookiesFile -PathType Leaf)) {
        throw "CookiesFile was not found: $CookiesFile"
    }
    $BaseArgs += @("--cookies", $CookiesFile)
}

if (-not [string]::IsNullOrWhiteSpace($ProxyUrl)) {
    $BaseArgs += @("--proxy", $ProxyUrl)
}

switch ($RateLimit) {
    "Fast" { }
    "Normal" { $BaseArgs += @("--sleep", "1.0-3.0", "--sleep-request", "0.5-1.5", "--sleep-429", "60") }
    "Cautious" { $BaseArgs += @("--sleep", "3.0-8.0", "--sleep-request", "1.0-3.0", "--sleep-429", "120") }
}

if (-not [string]::IsNullOrWhiteSpace($IncludeKeywords)) {
    $IncludeKeywordList = @(
        ($IncludeKeywords -split '[,;\s]+' | ForEach-Object { $_.Trim().ToLowerInvariant() }) |
        Where-Object { $_ -match '^[a-z0-9_-]+$' } |
        Select-Object -Unique
    )
    if ($IncludeKeywordList.Count -gt 0) {
        $BaseArgs += @("--option", ("include={0}" -f ($IncludeKeywordList -join ',')))
    }
}

if (-not [string]::IsNullOrWhiteSpace($ItemRange)) {
    $BaseArgs += @("--range", $ItemRange.Trim())
}
elseif ($MaxItems -gt 0) {
    $BaseArgs += @("--range", "1-$MaxItems")
}

if ($MetadataOnly) {
    # Stay on gallery-dl's normal DownloadJob/postprocessor path while disabling
    # the media transfer itself. This keeps metadata sidecars and native error
    # status authoritative instead of switching to the JSON DataJob path.
    $BaseArgs += "--no-download"
}

function Write-GuiUrlResult {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("captured", "failed")][string]$Status,
        [Parameter(Mandatory = $true)][int]$Index,
        [Parameter(Mandatory = $true)][int]$Total,
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $false)][string]$Detail = "gallery-dl"
    )

    if ($Status -eq "captured") {
        $record = "{0}`tcaptured`t{1}`t{2}`t{3}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $SafeCaseName, $Url, $Detail
        Add-BufferedGuiUrlRecord -Status "captured" -Line $record
        $marker = "GUI_QUEUE_URL_COMPLETE`t{0}`t{1}`t{2}" -f $Index, $Total, $Url
    }
    else {
        $record = "{0}`tfailed`t{1}`t{2}`t{3}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $SafeCaseName, $Url, $Detail
        Add-BufferedGuiUrlRecord -Status "failed" -Line $record
        $marker = "GUI_QUEUE_URL_INCOMPLETE`t{0}`t{1}`t{2}" -f $Index, $Total, $Url
    }

    Write-Host $marker
    Write-RunLogLineOnly $marker
}

function Write-Utf8NoBomLines {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string[]]$Lines
    )

    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($Path, $Lines, $encoding)
}

function Read-UrlSetFromFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    $set = @{}
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $set
    }

    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8 -ErrorAction SilentlyContinue) {
        $trimmed = $line.Trim()
        if ($trimmed -and -not $trimmed.StartsWith('#')) {
            $set[$trimmed] = $true
        }
    }

    return $set
}

$Completed = 0
$Failed = 0
$script:CapturedUrlRecords = New-Object System.Collections.Generic.List[string]
$script:FailedUrlRecords = New-Object System.Collections.Generic.List[string]

function Add-BufferedGuiUrlRecord {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("captured", "failed")][string]$Status,
        [Parameter(Mandatory = $true)][string]$Line
    )

    if ($Status -eq "captured") {
        [void]$script:CapturedUrlRecords.Add($Line)
    }
    else {
        [void]$script:FailedUrlRecords.Add($Line)
    }
}

function Write-BufferedLinesUtf8NoBom {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Lines,
        [Parameter(Mandatory = $false)][bool]$Append = $true
    )

    if (-not $Lines -or $Lines.Count -eq 0) {
        return
    }

    $parent = Split-Path -Parent $Path
    if (-not [string]::IsNullOrWhiteSpace($parent) -and -not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-DirectoryIfMissing -Path $parent
    }

    $encoding = New-Object System.Text.UTF8Encoding($false)
    $writer = New-Object System.IO.StreamWriter($Path, $Append, $encoding)
    try {
        foreach ($Line in $Lines) {
            $writer.WriteLine($Line)
        }
    }
    finally {
        $writer.Dispose()
    }
}

function Flush-GuiUrlRecords {
    Write-BufferedLinesUtf8NoBom -Path $CapturedUrlsFile -Lines $script:CapturedUrlRecords.ToArray() -Append $true
    Write-BufferedLinesUtf8NoBom -Path $FailedUrlsFile -Lines $script:FailedUrlRecords.ToArray() -Append $true
    $script:CapturedUrlRecords.Clear()
    $script:FailedUrlRecords.Clear()
}

if ($Urls.Count -gt 1) {
    Write-Section "Image URL batch"
    Write-RunLog "Using gallery-dl native input-file mode for $($Urls.Count) URLs."

    $BatchInputFile = New-AppTempFile -Prefix "avi-gallerydl-input-" -Suffix ".txt"
    $BatchErrorFile = Join-Path $LogsFolder "gallery-dl-errors_$RunStamp.txt"

    Remove-Item -LiteralPath $BatchErrorFile -Force -ErrorAction SilentlyContinue

    try {
        Write-Utf8NoBomLines -Path $BatchInputFile -Lines $Urls

        $GalleryDlArgs = @($BaseArgs + @("--input-file", $BatchInputFile, "--error-file", $BatchErrorFile))
        Write-RunLog ("Command: " + $GalleryDlPath + " " + ($GalleryDlArgs -join " "))
        Write-RunLog "Temporary input file: $BatchInputFile"
        Write-RunLog "gallery-dl error file: $BatchErrorFile"

        $ExitCode = Invoke-GalleryDlSafely -FilePath $GalleryDlPath -Arguments $GalleryDlArgs -RunLog $RunLog
        $FailedUrlSet = Read-UrlSetFromFile -Path $BatchErrorFile

        # gallery-dl writes failed URLs to --error-file. If gallery-dl returns non-zero but does not
        # provide an error file, treat the batch status as unknown and mark each submitted URL incomplete
        # instead of assuming success.
        $TreatAllAsFailed = (($ExitCode -ne 0) -and ($FailedUrlSet.Count -eq 0))

        $Index = 0
        foreach ($Url in $Urls) {
            $Index++
            if ($TreatAllAsFailed -or $FailedUrlSet.ContainsKey($Url)) {
                $Failed++
                Write-GuiUrlResult -Status "failed" -Index $Index -Total $Urls.Count -Url $Url -Detail ("gallery-dl batch exit code {0}" -f $ExitCode)
            }
            else {
                $Completed++
                Write-GuiUrlResult -Status "captured" -Index $Index -Total $Urls.Count -Url $Url -Detail "gallery-dl input-file"
            }
        }

        if ($ExitCode -ne 0) {
            Write-RunLog "gallery-dl batch finished with exit code $ExitCode"
        }
    }
    catch {
        $Failed = $Urls.Count
        $Completed = 0
        $msg = "ERROR capturing image URL batch:`r`n$($_.Exception.Message)"
        Write-Warning $msg
        Write-RunLogLineOnly $msg

        $Index = 0
        foreach ($Url in $Urls) {
            $Index++
            Write-GuiUrlResult -Status "failed" -Index $Index -Total $Urls.Count -Url $Url -Detail "gallery-dl batch script error"
        }
    }
    finally {
        Remove-Item -LiteralPath $BatchInputFile -Force -ErrorAction SilentlyContinue
    }
}
else {
    $Index = 0
    foreach ($Url in $Urls) {
        $Index++
        Write-Section "Image URL $Index of $($Urls.Count)"
        Write-RunLog "URL: $Url"

        $GalleryDlArgs = @($BaseArgs + $Url)
        Write-RunLog ("Command: " + $GalleryDlPath + " " + ($GalleryDlArgs -join " "))

        $ExitCode = 1

        try {
            # gallery-dl commonly writes normal extractor status messages to stderr, such as API-key/token
            # discovery notices. Do not use PowerShell native stderr redirection here: in Windows PowerShell
            # it turns those stderr lines into NativeCommandError records and can make otherwise successful
            # captures fail at the script layer.
            $ExitCode = Invoke-GalleryDlSafely -FilePath $GalleryDlPath -Arguments $GalleryDlArgs -RunLog $RunLog
        }
        catch {
            $ExitCode = 1
            $msg = "ERROR capturing image URL $Index`: $Url`r`n$($_.Exception.Message)"
            Write-Warning $msg
            Write-RunLogLineOnly $msg
        }

        if ($ExitCode -eq 0) {
            $Completed++
            Write-GuiUrlResult -Status "captured" -Index $Index -Total $Urls.Count -Url $Url -Detail "gallery-dl"
        }
        else {
            $Failed++
            Write-RunLog "gallery-dl failed for URL $Index of $($Urls.Count) with exit code $ExitCode"
            Write-GuiUrlResult -Status "failed" -Index $Index -Total $Urls.Count -Url $Url -Detail ("gallery-dl exit code {0}" -f $ExitCode)
        }
    }
}

Flush-GuiUrlRecords

$EvidenceDerivativeGenerated = 0
$EvidenceDerivativeFailures = 0
if ($CreateEvidenceDerivative -and -not $MetadataOnly) {
    Write-Section "Gallery/Profile Evidence Stamping"
    $captureUtcText = $RunStartedUtc.ToString('yyyy-MM-ddTHH:mm:ssZ')
    $captureLocalTime = $RunStartedLocal
    $candidateImages = New-Object System.Collections.Generic.List[System.IO.FileInfo]
    foreach ($file in Get-ChildItem -LiteralPath $MediaFolder -File -Recurse -ErrorAction SilentlyContinue) {
        if (-not (Test-EvidenceImageExtension -Extension $file.Extension)) {
            continue
        }
        $key = [System.IO.Path]::GetFullPath($file.FullName).ToLowerInvariant()
        $currentState = Get-EvidenceImageState -File $file
        if (-not $PreCaptureEvidenceImageState.ContainsKey($key) -or $PreCaptureEvidenceImageState[$key] -ne $currentState) {
            [void]$candidateImages.Add($file)
        }
    }

    if ($candidateImages.Count -eq 0) {
        Write-RunLog 'Evidence stamping: no newly created or changed supported static images were found in this run.'
    }
    else {
        Write-RunLog ("Evidence stamping candidates: {0}" -f $candidateImages.Count)

        foreach ($imageFile in $candidateImages) {
            try {
                $result = New-EvidenceDerivative `
                    -OriginalFile $imageFile `
                    -MediaRoot $MediaFolder `
                    -CaseRoot $CaseFolder `
                    -FFmpegPath $FFmpegPath `
                    -FFprobePath $FFprobePath `
                    -CaptureLocal $captureLocalTime `
                    -CaptureUtc $RunStartedUtc `
                    -SubmittedUrls $Urls `
                    -Version $WaviVersion `
                    -StampTemplate $EvidenceStampTemplate `
                    -MatchSourceFormat:$MatchEvidenceSourceFormat
                $EvidenceDerivativeGenerated++
                Write-RunLog ("Evidence-stamped derivative created: {0} -> {1}" -f $result.original, $result.derivative)
                Write-RunLog ("Evidence original SHA-256: {0}" -f $result.original_hash)
                Write-RunLog ("Evidence-stamped derivative SHA-256: {0}" -f $result.derivative_hash)
                Write-RunLog ("Evidence provenance: {0}" -f $result.sidecar)
            }
            catch {
                $EvidenceDerivativeFailures++
                Write-RunLog ("WARNING: Evidence stamping failed for {0}: {1}" -f $imageFile.FullName, $_.Exception.Message)
            }
        }
        Write-RunLog ("Evidence-stamped derivatives generated: {0}; failed: {1}" -f $EvidenceDerivativeGenerated, $EvidenceDerivativeFailures)
    }
}

Write-Section "Gallery/Profile Capture Manifest"
$CaseFiles = Get-ChildItem -LiteralPath $CaseFolder -File -Recurse -ErrorAction SilentlyContinue | Where-Object {
    $_.FullName -notlike "*\.gui-cache\*" -and $_.FullName -notlike "*\manifests\*"
}
$RunLogFullPath = [System.IO.Path]::GetFullPath($RunLog)

$ManifestEncoding = New-Object System.Text.UTF8Encoding($false)
$ManifestWriter = New-Object System.IO.StreamWriter($ManifestFile, $false, $ManifestEncoding)
try {
    $ManifestWriter.WriteLine("SHA256,SizeBytes,RelativePath")
    foreach ($File in $CaseFiles) {
        $FileFullPath = [System.IO.Path]::GetFullPath($File.FullName)
        if ([string]::Equals($FileFullPath, $RunLogFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
            continue
        }

        try {
            $Hash = Get-Sha256HashCompat -Path $File.FullName
            $Relative = $File.FullName.Substring($CaseFolder.Length).TrimStart('\', '/') -replace '\\', '/'
            $ManifestWriter.WriteLine(('"{0}",{1},"{2}"' -f $Hash, $File.Length, ($Relative -replace '"', '""')))
        }
        catch {
            Write-RunLog "WARNING: Could not hash file: $($File.FullName) - $($_.Exception.Message)"
        }
    }

    Write-Section "Gallery/Profile Capture Summary"
    Write-RunLog "Submitted URLs: $($Urls.Count)"
    Write-RunLog "Completed URLs: $Completed"
    Write-RunLog "Failed URLs: $Failed"
    if ($CreateEvidenceDerivative -and -not $MetadataOnly) {
        Write-RunLog "Evidence-stamped derivatives generated: $EvidenceDerivativeGenerated"
        Write-RunLog "Evidence stamping failures: $EvidenceDerivativeFailures"
    }
    Write-RunLog "Case folder: $CaseFolder"
    Write-RunLog "Manifest: $ManifestFile"
    Close-RunLogWriter

    try {
        $RunLogItem = Get-Item -LiteralPath $RunLog -ErrorAction Stop
        $RunLogHash = Get-Sha256HashCompat -Path $RunLogItem.FullName
        $RunLogRelative = $RunLogItem.FullName.Substring($CaseFolder.Length).TrimStart('\', '/') -replace '\\', '/'
        $ManifestWriter.WriteLine(('"{0}",{1},"{2}"' -f $RunLogHash, $RunLogItem.Length, ($RunLogRelative -replace '"', '""')))
    }
    catch {
        Write-Warning "Could not hash finalized run log: $RunLog - $($_.Exception.Message)"
    }
}
finally {
    Close-RunLogWriter
    $ManifestWriter.Dispose()
}

if ($Failed -gt 0) {
    exit 1
}

exit 0
