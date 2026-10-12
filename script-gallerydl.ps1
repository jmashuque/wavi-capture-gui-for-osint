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
    [string]$EvidenceStampTemplateBase64,

    [ValidateRange(1, 100)]
    [int]$EvidenceFooterPercent = 10,

    [ValidateSet(0, 1)][int]$EvidenceReadability = 1,
    [ValidateRange(8, 72)][int]$EvidenceMinFont = 16,
    [ValidateRange(1, 99)][int]$EvidenceLeftPercent = 50
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

function ConvertTo-SafeLogText {
    param([AllowNull()][AllowEmptyString()][string]$Message)

    # Mask URL userinfo in wrapper messages and native-tool diagnostics alike.
    # Keep scheme, endpoint and diagnostic text; never use this for execution args.
    return [regex]::Replace([string]$Message,
        '(?i)\b((?:https?|socks4a?|socks5h?)://)[^\s/\\''"<>?#]+@', '${1}***@')
}

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
                        Write-Host (ConvertTo-SafeLogText $Line)
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
                        Write-Host (ConvertTo-SafeLogText $Line)
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
    return ($measured.Width -le $MaxWidth)
}

function Convert-EvidenceTextToMeasuredLines {
    param(
        [AllowNull()][string]$Text,
        [Parameter(Mandatory = $true)][object]$Graphics,
        [Parameter(Mandatory = $true)][object]$Font,
        [Parameter(Mandatory = $true)][single]$MaxWidth
    )

    $result = New-Object System.Collections.Generic.List[string]
    $logicalLines = ([string]$Text) -split '\r\n|\r|\n'
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
            $boundaries = [System.Globalization.StringInfo]::ParseCombiningCharacters($remaining)
            $high = $boundaries.Length
            $best = 1
            while ($low -le $high) {
                $mid = [int][Math]::Floor(($low + $high) / 2)
                $end = if ($mid -lt $boundaries.Length) { $boundaries[$mid] } else { $remaining.Length }
                $candidate = $remaining.Substring(0, $end)
                if (Test-EvidenceTextFitsWidth -Graphics $Graphics -Font $Font -Text $candidate -MaxWidth $MaxWidth) {
                    $best = $mid
                    $low = $mid + 1
                }
                else {
                    $high = $mid - 1
                }
            }

            $best = if ($best -lt $boundaries.Length) { $boundaries[$best] } else { $remaining.Length }
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

function Read-EvidenceSourceIndex {
    param([string]$Path, [Parameter(Mandatory = $true)][string]$MediaRoot)
    $index = @{}
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $index
    }
    $rootPrefix = [System.IO.Path]::GetFullPath($MediaRoot).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    $reader = [System.IO.File]::OpenText($Path)
    try {
        while ($null -ne ($line = $reader.ReadLine())) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            try {
                $record = $line | ConvertFrom-Json -ErrorAction Stop
                $itemPath = [string]$record._path
                if ([string]::IsNullOrWhiteSpace($itemPath) -or -not [System.IO.Path]::IsPathRooted($itemPath)) { continue }
                $itemPath = [System.IO.Path]::GetFullPath($itemPath)
                if (-not $itemPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
                # A later successful download to the same exact path replaces its earlier record.
                $index[$itemPath.ToLowerInvariant()] = $record
            }
            catch {
                Write-RunLog 'WARNING: An invalid evidence source record was ignored; no URL will be guessed from it.'
            }
        }
    }
    finally { $reader.Dispose() }
    return $index
}

function Get-EvidenceHttpUrl {
    param([AllowNull()][object]$Value)
    if ($Value -isnot [string] -or [string]::IsNullOrWhiteSpace($Value)) { return $null }
    $text = $Value.Trim()
    if ($text -match '[\x00-\x20\x7F]') { return $null }
    $uri = $null
    if (-not [Uri]::TryCreate($text, [UriKind]::Absolute, [ref]$uri)) { return $null }
    if ($uri.Scheme -notin @('http', 'https') -or [string]::IsNullOrWhiteSpace($uri.Host) -or $uri.UserInfo) { return $null }
    return $text
}

function Resolve-EvidenceItemSource {
    param([AllowNull()][object]$Metadata)
    $result = [ordered]@{ url = $null; kind = 'unavailable'; field = $null; media_url = $null }
    if ($null -eq $Metadata) { return [pscustomobject]$result }
    $category = [string]$Metadata.category
    $result.media_url = Get-EvidenceHttpUrl -Value $Metadata._url
    foreach ($field in @('post_url', 'webpage_url', 'permalink', 'canonical_url', 'page_url')) {
        $value = $Metadata.$field
        # Reddit exposes its post permalink as a site-relative path.
        if ($category -eq 'reddit' -and $field -eq 'permalink' -and $value -is [string] -and $value -match '^/r/[^/]+/comments/[A-Za-z0-9]+(?:/|$)') {
            $value = 'https://www.reddit.com' + $value
        }
        $url = Get-EvidenceHttpUrl -Value $value
        if ($url) {
            # Instagram also uses post_url for story/highlight collections.
            # Only accept a permalink to an individual post/reel/story here.
            if ($category -eq 'instagram' -and ([Uri]$url).AbsolutePath -notmatch '^/(?:p|reel|tv)/[^/]+/?$|^/stories/[^/]+/[0-9]+/?$') { continue }
            $result.url = $url; $result.kind = 'item-page'; $result.field = $field
            return [pscustomobject]$result
        }
    }
    # These stable permalink forms are derived only from item-specific identifiers.
    if ($category -eq 'twitter' -and [string]$Metadata.tweet_id -match '^[0-9]+$') {
        $result.url = 'https://twitter.com/i/web/status/' + [string]$Metadata.tweet_id
        $result.kind = 'item-page'; $result.field = 'twitter.tweet_id'
    }
    elseif ($category -eq 'pixiv' -and [string]$Metadata.id -match '^[0-9]+$' -and [string]$Metadata.subcategory -notmatch 'novel|avatar|background') {
        $result.url = 'https://www.pixiv.net/artworks/' + [string]$Metadata.id
        $result.kind = 'item-page'; $result.field = 'pixiv.id'
    }
    elseif ($result.media_url) {
        $result.url = $result.media_url; $result.kind = 'direct-media'; $result.field = '_url'
    }
    return [pscustomobject]$result
}

function Resolve-EvidenceItemDateTime {
    param([AllowNull()][object]$Metadata)
    $result = [ordered]@{ value = $null; field = $null; precision = 'unavailable' }
    if ($null -eq $Metadata) { return [pscustomobject]$result }
    $culture = [System.Globalization.CultureInfo]::InvariantCulture
    foreach ($field in @('date', 'post_date', 'created', 'created_at')) {
        $raw = $Metadata.$field
        if ($null -eq $raw) { continue }
        $text = if ($raw -is [datetime]) { $raw.ToString('o', $culture) } elseif ($raw -is [datetimeoffset]) { $raw.ToString('o', $culture) } else { ([string]$raw).Trim() }
        if ([string]::IsNullOrWhiteSpace($text)) { continue }
        $parsed = [datetime]::MinValue
        if ($text -match '^\d{4}-\d{2}-\d{2}$|^\d{8}$') {
            $format = if ($text.Length -eq 8) { 'yyyyMMdd' } else { 'yyyy-MM-dd' }
            if (-not [datetime]::TryParseExact($text, $format, $culture, [System.Globalization.DateTimeStyles]::None, [ref]$parsed)) { continue }
            $result.value = $parsed.ToString('yyyy-MM-dd', $culture)
            $result.precision = 'date'
        }
        elseif ($text -match '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,7})?)?(?:Z|[+-]\d{2}:?\d{2})?$') {
            if (-not [datetime]::TryParse($text, $culture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$parsed)) { continue }
            # Preserve supplied precision/offset; never invent a timezone or time.
            $result.value = $text.Replace('T', ' ')
            $result.precision = 'datetime'
        }
        elseif ($text -match '^\d{10}(?:\d{3})?$') {
            try {
                $seconds = [double]::Parse($text, $culture)
                if ($text.Length -eq 13) { $seconds /= 1000 }
                $epoch = [datetime]::SpecifyKind([datetime]'1970-01-01', [DateTimeKind]::Utc)
                $result.value = $epoch.AddSeconds($seconds).ToString('yyyy-MM-dd HH:mm:ss.fffZ', $culture)
                $result.precision = 'datetime'
            }
            catch { continue }
        }
        else { continue }
        $result.field = $field
        return [pscustomobject]$result
    }
    return [pscustomobject]$result
}

function Resolve-EvidenceStampTemplate {
    param(
        [Parameter(Mandatory = $true)][string]$Template,
        [Parameter(Mandatory = $true)][string]$Version,
        [Parameter(Mandatory = $true)][string]$CaseName,
        [Parameter(Mandatory = $true)][datetime]$CaptureLocal,
        [Parameter(Mandatory = $true)][datetime]$CaptureUtc,
        [Parameter(Mandatory = $true)][string]$DomainLabel,
        [Parameter(Mandatory = $true)][string]$ItemUrlLabel,
        [string]$ItemDateTimeLabel = 'Item datetime unavailable',
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
        '%url%' = $ItemUrlLabel
        '%item_datetime%' = $ItemDateTimeLabel
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
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [ValidateRange(1, 3600)][int]$TimeoutSeconds = 300
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
    $started = $false
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        if (-not $process.Start()) {
            throw "Could not start native tool: $FilePath"
        }
        $started = $true
        # Drain both pipes while the child runs; sequential reads can deadlock.
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $remaining = [int][Math]::Max(0, ($TimeoutSeconds * 1000) - $clock.ElapsedMilliseconds)
        if (-not $process.WaitForExit($remaining)) {
            throw [System.TimeoutException]::new("Native tool exceeded the $TimeoutSeconds second timeout: $FilePath")
        }
        $remaining = [int][Math]::Max(0, ($TimeoutSeconds * 1000) - $clock.ElapsedMilliseconds)
        if (-not [System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]@($stdoutTask, $stderrTask), $remaining)) {
            throw [System.TimeoutException]::new("Native tool output did not close within $TimeoutSeconds seconds: $FilePath")
        }
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) {
            throw ("Native tool failed with exit code {0}: {1}" -f $process.ExitCode, $stderr.Trim())
        }
        return $stdout.Trim()
    }
    finally {
        try {
            if ($started -and -not $process.HasExited) {
                $process.Kill()
                [void]$process.WaitForExit(2000)
            }
        }
        finally {
            $clock.Stop()
            $process.Dispose()
        }
    }
}

function Get-EvidenceImageDimensions {
    param(
        [Parameter(Mandatory = $true)][string]$FFprobePath,
        [Parameter(Mandatory = $true)][string]$ImagePath
    )
    $result = Invoke-NativeCaptureText -FilePath $FFprobePath -TimeoutSeconds 30 -Arguments @(
        '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', $ImagePath
    )
    if ($result -notmatch '^(\d+)x(\d+)$') {
        throw "ffprobe did not return image dimensions for: $ImagePath"
    }
    return @([int]$Matches[1], [int]$Matches[2])
}

function Convert-EvidenceTemplateToRows {
    param([Parameter(Mandatory = $true)][string]$Template)
    foreach ($line in ($Template -split '\r\n|\r|\n')) {
        if ($line -notmatch '(?i)</?(Left|Right)\b') {
            [pscustomobject]@{ left = [string]$line; right = ''; paired = $false; right_only = $false }
            continue
        }
        $sections = [regex]::Matches($line, '(?i)<(Left|Right)>(.*?)</\1>')
        $remainder = [regex]::Replace($line, '(?i)<(Left|Right)>(.*?)</\1>', '')
        $parts = @{}
        foreach ($section in $sections) {
            $side = $section.Groups[1].Value.ToLowerInvariant()
            $content = $section.Groups[2].Value
            if ($parts.ContainsKey($side) -or $content -match '(?i)</?(Left|Right)\b') {
                throw 'Evidence alignment sections cannot be duplicated or nested.'
            }
            $parts[$side] = $content
        }
        if ($sections.Count -eq 0 -or -not [string]::IsNullOrWhiteSpace($remainder)) {
            throw 'Use complete <Left>...</Left> and/or <Right>...</Right> sections on one line, without text outside them.'
        }
        [pscustomobject]@{
            left = [string]$parts['left']; right = [string]$parts['right']
            paired = ($parts.ContainsKey('left') -and $parts.ContainsKey('right'))
            right_only = (-not $parts.ContainsKey('left'))
        }
    }
}

function Measure-EvidenceFooterRows {
    param($Rows, $Graphics, $Font, [single]$TextWidth, [single]$Gap, [int]$LineSpacing, [ValidateRange(1, 99)][int]$LeftPercent = 50)
    $layout = New-Object System.Collections.Generic.List[object]
    $lineHeight = [int][Math]::Ceiling($Font.GetHeight($Graphics))
    $lineCount = 0
    $fitsWidth = $true
    foreach ($row in $Rows) {
        $leftWidth = if ($row.paired) { ($TextWidth - $Gap) * ($LeftPercent / 100.0) } else { $TextWidth }
        $rightWidth = if ($row.paired) { ($TextWidth - $Gap) - $leftWidth } else { $TextWidth }
        if ($leftWidth -le 0 -or $rightWidth -le 0) { return [pscustomobject]@{ fits_width = $false; height = 0; rows = @() } }
        $leftLines = @(Convert-EvidenceTextToMeasuredLines -Text $row.left -Graphics $Graphics -Font $Font -MaxWidth $leftWidth)
        $rightLines = @(Convert-EvidenceTextToMeasuredLines -Text $row.right -Graphics $Graphics -Font $Font -MaxWidth $rightWidth)
        $count = [Math]::Max(1, [Math]::Max($leftLines.Count, $rightLines.Count))
        foreach ($line in $leftLines) {
            if (-not (Test-EvidenceTextFitsWidth -Graphics $Graphics -Font $Font -Text $line -MaxWidth $leftWidth)) { $fitsWidth = $false }
        }
        foreach ($line in $rightLines) {
            if (-not (Test-EvidenceTextFitsWidth -Graphics $Graphics -Font $Font -Text $line -MaxWidth $rightWidth)) { $fitsWidth = $false }
        }
        [void]$layout.Add([pscustomobject]@{
            left = $leftLines; right = $rightLines; count = $count
            paired = $row.paired; right_only = $row.right_only; left_width = $leftWidth; right_width = $rightWidth
        })
        $lineCount += $count
    }
    return [pscustomobject]@{
        rows = $layout.ToArray(); line_height = $lineHeight; line_count = $lineCount
        height = ($lineCount * $lineHeight) + ([Math]::Max(0, $lineCount - 1) * $LineSpacing)
        fits_width = $fitsWidth
    }
}

function New-EvidenceFooterImage {
    param(
        [Parameter(Mandatory = $true)][int]$Width,
        [Parameter(Mandatory = $true)][int]$SourceHeight,
        [Parameter(Mandatory = $true)][object[]]$Rows,
        [ValidateRange(1, 100)][int]$FooterPercent = 10,
        [bool]$PrioritiseReadability = $true,
        [ValidateRange(8, 72)][int]$MinimumFontSize = 16,
        [ValidateRange(1, 99)][int]$LeftPercent = 50,
        [Parameter(Mandatory = $true)][string]$OutputPath
    )
    if ($Width -lt 1 -or $SourceHeight -lt 1) { throw 'Evidence image dimensions are invalid.' }
    Add-Type -AssemblyName System.Drawing -ErrorAction Stop | Out-Null
    $footerHeight = [int][Math]::Ceiling($SourceHeight * ($FooterPercent / 100.0))
    $preferredHeight = $footerHeight; $sourceWidth = $Width
    $horizontalPadding = [int][Math]::Max(1, [Math]::Round([Math]::Min($Width * 0.02, $footerHeight * 0.08)))
    $verticalPadding = [int][Math]::Max(1, [Math]::Round($footerHeight * 0.08))
    $gap = [int][Math]::Max(2, $horizontalPadding)
    $textWidth = [single]($Width - 2 * $horizontalPadding)
    $availableHeight = $footerHeight - 2 * $verticalPadding
    $measureBitmap = $null; $measureGraphics = $null; $font = $null
    $bestLayout = $null; $fontSize = 0; $lineSpacing = 0
    try {
        $measureBitmap = New-Object System.Drawing.Bitmap(1, 1, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $measureGraphics = [System.Drawing.Graphics]::FromImage($measureBitmap)
        $measureGraphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $minimum = 6
        if ($PrioritiseReadability) {
            $minimum = $MinimumFontSize
            $font = New-Object System.Drawing.Font('Segoe UI', [single]$minimum, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
            $minimumSpacing = [int][Math]::Max(1, [Math]::Round($minimum * 0.15))
            $minimumLayout = Measure-EvidenceFooterRows -Rows $Rows -Graphics $measureGraphics -Font $font -TextWidth $textWidth -Gap $gap -LineSpacing $minimumSpacing -LeftPercent $LeftPercent
            if (-not $minimumLayout.fits_width -or $minimumLayout.height -gt $availableHeight) {
                # Give narrow sources a practical text canvas without resampling them.
                $Width = [int][Math]::Max($Width, $minimum * 24)
                $horizontalPadding = [int][Math]::Max($horizontalPadding, [Math]::Ceiling($minimum / 2.0))
                $verticalPadding = [int][Math]::Max($verticalPadding, [Math]::Ceiling($minimum / 2.0))
                $gap = [int][Math]::Max(2, $horizontalPadding)
                $textWidth = [single]($Width - 2 * $horizontalPadding)
                $minimumLayout = Measure-EvidenceFooterRows -Rows $Rows -Graphics $measureGraphics -Font $font -TextWidth $textWidth -Gap $gap -LineSpacing $minimumSpacing -LeftPercent $LeftPercent
                if (-not $minimumLayout.fits_width) { throw 'Evidence text cannot fit the readability canvas. Original image retained.' }
                $footerHeight = [int][Math]::Max($preferredHeight, [Math]::Ceiling($minimumLayout.height + 2 * $verticalPadding))
                if ($footerHeight -gt 32768 -or ([double]$Width * ($SourceHeight + $footerHeight)) -gt 100000000) {
                    throw 'Evidence readability expansion exceeds the image size limit. Shorten the template or reduce the minimum font size. Original image retained.'
                }
                $availableHeight = $footerHeight - 2 * $verticalPadding
            }
            $font.Dispose(); $font = $null
        }
        # Largest fitting integer-pixel font, respecting the chosen minimum.
        $low = $minimum; $high = [int][Math]::Max(0, $availableHeight)
        while ($low -le $high) {
            $candidateSize = [int][Math]::Floor(($low + $high) / 2)
            $candidateSpacing = [int][Math]::Max(1, [Math]::Round($candidateSize * 0.15))
            $font = New-Object System.Drawing.Font('Segoe UI', [single]$candidateSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
            $candidate = Measure-EvidenceFooterRows -Rows $Rows -Graphics $measureGraphics -Font $font -TextWidth $textWidth -Gap $gap -LineSpacing $candidateSpacing -LeftPercent $LeftPercent
            $font.Dispose(); $font = $null
            if ($candidate.fits_width -and $candidate.height -le $availableHeight) {
                $fontSize = $candidateSize; $bestLayout = $candidate; $lineSpacing = $candidateSpacing
                $low = $candidateSize + 1
            }
            else { $high = $candidateSize - 1 }
        }
        if ($null -eq $bestLayout) {
            throw 'Evidence text cannot fit this footer at the minimum font size. Enable readability, increase Footer height (%) or shorten the template. Original image retained.'
        }
    }
    finally {
        if ($font) { $font.Dispose() }
        if ($measureGraphics) { $measureGraphics.Dispose() }
        if ($measureBitmap) { $measureBitmap.Dispose() }
    }
    $bitmap = $null; $graphics = $null; $drawFont = $null; $brush = $null; $format = $null
    try {
        $bitmap = New-Object System.Drawing.Bitmap($Width, $footerHeight, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.Clear([System.Drawing.Color]::Black)
        $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $drawFont = New-Object System.Drawing.Font('Segoe UI', [single]$fontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
        $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
        $format = [System.Drawing.StringFormat]::GenericTypographic.Clone()
        $format.FormatFlags = $format.FormatFlags -bor [System.Drawing.StringFormatFlags]::NoWrap
        $y = [single](($footerHeight - $bestLayout.height) / 2.0)
        foreach ($row in $bestLayout.rows) {
            foreach ($side in @('left', 'right')) {
                if (($side -eq 'left' -and $row.right_only) -or ($side -eq 'right' -and -not ($row.paired -or $row.right_only))) { continue }
                $x = [single]$horizontalPadding
                if ($side -eq 'right') {
                    $format.Alignment = [System.Drawing.StringAlignment]::Far
                    if ($row.paired) { $x += [single]($row.left_width + $gap) }
                }
                else { $format.Alignment = [System.Drawing.StringAlignment]::Near }
                $lineY = $y
                foreach ($line in $row.$side) {
                    $rect = [System.Drawing.RectangleF]::new($x, $lineY, [single]$(if ($side -eq 'right') { $row.right_width } else { $row.left_width }), [single]$bestLayout.line_height)
                    $graphics.DrawString([string]$line, $drawFont, $brush, $rect, $format)
                    $lineY += [single]($bestLayout.line_height + $lineSpacing)
                }
            }
            $y += [single]($row.count * ($bestLayout.line_height + $lineSpacing))
        }
        $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        if ($format) { $format.Dispose() }
        if ($brush) { $brush.Dispose() }
        if ($drawFont) { $drawFont.Dispose() }
        if ($graphics) { $graphics.Dispose() }
        if ($bitmap) { $bitmap.Dispose() }
    }
    return [pscustomobject]@{
        height = $footerHeight; source_height = $SourceHeight; footer_percent = $FooterPercent
        width = $Width; source_width = $sourceWidth; preferred_height = $preferredHeight
        prioritise_readability = $PrioritiseReadability; minimum_font_size = $minimum
        left_percent = $LeftPercent; right_percent = (100 - $LeftPercent)
        image_offset_x = [int][Math]::Floor(($Width - $sourceWidth) / 2.0)
        line_count = $bestLayout.line_count; font_size = $fontSize; line_spacing = $lineSpacing
        horizontal_padding = $horizontalPadding; vertical_padding = $verticalPadding
        text_top = (($footerHeight - $bestLayout.height) / 2.0); column_gap = $gap
    }
}

function New-EvidenceOutputReservation {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][string]$Stem,
        [Parameter(Mandatory = $true)][string]$Extension
    )

    for ($attempt = 1; $attempt -le 10000; $attempt++) {
        $suffix = if ($attempt -eq 1) { '' } else { '_' + $attempt }
        $candidateStem = $Stem + $suffix
        $derivativePath = Join-Path $Directory ($candidateStem + $Extension)
        $sidecarPath = Join-Path $Directory ($candidateStem + '.evidence.json')
        # The reservation is shared by every output format for this stem.
        # CreateNew arbitrates concurrent writers; closing the handle removes
        # the reservation, including when Windows terminates the process.
        $reservationPath = $sidecarPath + '.reserve'
        try {
            $stream = [System.IO.FileStream]::new(
                $reservationPath, [System.IO.FileMode]::CreateNew,
                [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None,
                4096, [System.IO.FileOptions]::DeleteOnClose)
        }
        catch [System.IO.IOException] {
            if ((Test-Path -LiteralPath $reservationPath)) {
                continue
            }
            throw
        }

        $keepReservation = $false
        try {
            if ((Test-Path -LiteralPath $derivativePath) -or (Test-Path -LiteralPath $sidecarPath)) {
                continue
            }
            $keepReservation = $true
            return @{
                derivative_path = $derivativePath
                sidecar_path = $sidecarPath
                stream = $stream
            }
        }
        finally {
            if (-not $keepReservation) { $stream.Dispose() }
        }
    }
    throw 'Could not reserve an unused evidence image and provenance filename pair.'
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
        [AllowNull()][object]$ItemSourceMetadata,
        [string]$ItemSourceRecordPath,
        [Parameter(Mandatory = $true)][string]$Version,
        [Parameter(Mandatory = $true)][string]$StampTemplate,
        [ValidateRange(1, 100)][int]$FooterPercent = 10,
        [bool]$PrioritiseReadability = $true,
        [ValidateRange(8, 72)][int]$MinimumFontSize = 16,
        [ValidateRange(1, 99)][int]$LeftPercent = 50,
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
    # Keep the original extension in the stem so different source formats do
    # not share a provenance filename, even when source-format matching is on.
    $derivativeStem = $OriginalFile.Name + '_evidence_' + $RunStamp
    $reservation = $null
    $footerImage = $null
    $tempDerivative = Join-Path $destinationDirectory ('.wavi-evidence-' + [guid]::NewGuid().ToString('N') + $outputExtension)
    $tempSidecar = Join-Path $destinationDirectory ('.wavi-evidence-' + [guid]::NewGuid().ToString('N') + '.json')
    try {
        $footerImage = New-AppTempFile -Prefix 'wavi-evidence-footer-' -Suffix '.png'

        $originalHashBefore = Get-Sha256HashCompat -Path $originalFullPath
        $dimensions = Get-EvidenceImageDimensions -FFprobePath $FFprobePath -ImagePath $originalFullPath
        $width = [int]$dimensions[0]

        $sourceMetadataVerified = ($null -ne $ItemSourceMetadata -and
            [string]::Equals([string]$ItemSourceMetadata._wavi_sha256, $originalHashBefore, [System.StringComparison]::OrdinalIgnoreCase))
        $itemSource = if ($sourceMetadataVerified) { Resolve-EvidenceItemSource -Metadata $ItemSourceMetadata } else { Resolve-EvidenceItemSource -Metadata $null }
        $itemDateTime = Resolve-EvidenceItemDateTime -Metadata $(if ($sourceMetadataVerified) { $ItemSourceMetadata } else { $null })
        $itemDateTimeLabel = if ($itemDateTime.value) { $itemDateTime.value } else { 'Item datetime unavailable' }
        $itemUrlLabel = if ($itemSource.url) { $itemSource.url } else { 'Item URL unavailable' }
        $domainLabel = if ($itemSource.url) { ([Uri]$itemSource.url).Host } else { 'unknown-domain' }
        if (-not $itemSource.url) {
            Write-RunLog ("WARNING: No per-item source URL is available for {0}; the stamp will explicitly say Item URL unavailable." -f $OriginalFile.Name)
        }

        $stampValues = @{
            Version = $Version; CaseName = $SafeCaseName
            CaptureLocal = $CaptureLocal; CaptureUtc = $CaptureUtc
            DomainLabel = $domainLabel; ItemUrlLabel = $itemUrlLabel; ItemDateTimeLabel = $itemDateTimeLabel
            SourceCount = $SubmittedUrls.Count; OriginalRelativePath = $originalRelativeToCase
            OriginalFileName = $OriginalFile.Name; OriginalExtension = $sourceExtension.TrimStart('.')
            OriginalSha256 = $originalHashBefore
        }
        # Parse only the user's template: substituted metadata is always literal text.
        $stampRows = @(Convert-EvidenceTemplateToRows -Template $StampTemplate)
        foreach ($row in $stampRows) {
            foreach ($side in @('left', 'right')) {
                if (-not [string]::IsNullOrEmpty($row.$side)) {
                    $row.$side = Resolve-EvidenceStampTemplate -Template $row.$side @stampValues
                }
            }
        }
        $resolvedStampText = Resolve-EvidenceStampTemplate -Template $StampTemplate @stampValues
        $footerLayout = New-EvidenceFooterImage `
            -Width $width `
            -SourceHeight ([int]$dimensions[1]) `
            -Rows $stampRows `
            -FooterPercent $FooterPercent `
            -PrioritiseReadability $PrioritiseReadability `
            -MinimumFontSize $MinimumFontSize `
            -LeftPercent $LeftPercent `
            -OutputPath $footerImage

        $filter = "[0:v]format=rgba,pad=w=$($footerLayout.width):h=ih:x=$($footerLayout.image_offset_x):y=0:color=black[base];[1:v]format=rgba[footer];[base][footer]vstack=inputs=2[v]"
        $ffmpegArgs = @('-hide_banner', '-loglevel', 'error', '-y', '-i', $originalFullPath, '-i', $footerImage, '-filter_complex', $filter, '-map', '[v]', '-frames:v', '1', '-map_metadata', '-1')
        switch ($outputExtension) {
            '.jpg'  { $ffmpegArgs += @('-q:v', '2') }
            '.jpeg' { $ffmpegArgs += @('-q:v', '2') }
            '.png'  { $ffmpegArgs += @('-compression_level', '6') }
            '.webp' { $ffmpegArgs += @('-lossless', '1') }
        }
        $ffmpegArgs += $tempDerivative

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
        $reservation = New-EvidenceOutputReservation -Directory $destinationDirectory -Stem $derivativeStem -Extension $outputExtension
        $derivativePath = $reservation.derivative_path
        $sidecarPath = $reservation.sidecar_path
        $derivativeRelativeToCase = $derivativePath.Substring($CaseRoot.Length).TrimStart('\', '/') -replace '\\', '/'

        $payload = [ordered]@{
            schema_version = 8
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
                resolved_rows = @($stampRows)
                layout = $footerLayout
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
                item_datetime = $itemDateTime.value
                item_datetime_field = $itemDateTime.field
                item_datetime_precision = $itemDateTime.precision
                item_url = $itemSource.url
                item_url_kind = $itemSource.kind
                item_url_field = $itemSource.field
                media_url = $itemSource.media_url
                metadata_record = $ItemSourceRecordPath
                metadata_hash_verified = [bool]$sourceMetadataVerified
                submitted_url_count = [int]$SubmittedUrls.Count
                submitted_urls = @($SubmittedUrls)
                note = 'The stamped URL comes from the completed file metadata: item page when available, otherwise its direct media URL. Submitted URLs describe the capture run and are never substituted for missing item metadata.'
            }
        }
        Write-Utf8NoBomText -Path $tempSidecar -Text (($payload | ConvertTo-Json -Depth 8) + [Environment]::NewLine)

        $derivativeCommitted = $false
        $sidecarCommitted = $false
        try {
            # The two-argument .NET move refuses an existing destination even
            # if a non-WAVI writer creates it after our reservation check.
            [System.IO.File]::Move($tempDerivative, $derivativePath)
            $derivativeCommitted = $true
            [System.IO.File]::Move($tempSidecar, $sidecarPath)
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
        if ($footerImage) {
            Remove-Item -LiteralPath $footerImage -Force -ErrorAction SilentlyContinue
        }
        if ($null -ne $reservation) { $reservation.stream.Dispose() }
    }
}

if ($CreateEvidenceDerivative -and -not $MetadataOnly) {
    if ($EvidenceStampTemplate.Length -gt 8000) { throw 'Evidence stamp template exceeds 8,000 characters.' }
    $null = @(Convert-EvidenceTemplateToRows -Template $EvidenceStampTemplate)
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

    $Message = ConvertTo-SafeLogText $Message

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
    Write-Host (ConvertTo-SafeLogText $Message)
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
    # sleep-429 alone does not enable retries for HTTP media downloads.
    "--option", "downloader.http.retry-codes=[429]",
    "--windows-filenames"
)

# Record only completed files, independently of optional user-facing metadata outputs.
# Named postprocessor appends to the existing CLI postprocessors rather than replacing them.
$EvidenceSourceFile = $null
if ($CreateEvidenceDerivative -and -not $MetadataOnly) {
    $sourceRecordId = [guid]::NewGuid().ToString('N')
    $sourceRecordName = 'gallery-dl-evidence-sources_' + $sourceRecordId + '.jsonl'
    $EvidenceSourceFile = Join-Path $LogsFolder $sourceRecordName
    $sourceConfigPath = Join-Path $LogsFolder ('gallery-dl-evidence-sources_' + $sourceRecordId + '.config.json')
    $sourceConfig = @{
        extractor = @{ 'metadata-url' = '_url'; 'metadata-path' = '_path' }
        postprocessor = @{
            'wavi-evidence-hash' = @{ name = 'hash'; event = 'file'; hashes = 'sha256:_wavi_sha256' }
            'wavi-evidence-source' = @{
                name = 'metadata'; mode = 'jsonl'; event = 'after'
                'base-directory' = $LogsFolder; filename = $sourceRecordName
                include = @('_path', '_url', '_wavi_sha256', 'category', 'subcategory', 'post_url', 'webpage_url', 'permalink', 'canonical_url', 'page_url', 'tweet_id', 'id', 'date', 'post_date', 'created', 'created_at')
            }
        }
    }
    Write-Utf8NoBomText -Path $sourceConfigPath -Text ($sourceConfig | ConvertTo-Json -Depth 8)
    $BaseArgs += @('--config', $sourceConfigPath, '--postprocessor', 'wavi-evidence-hash', '--postprocessor', 'wavi-evidence-source')
    Write-RunLog ("Per-item evidence source records: {0}" -f $EvidenceSourceFile)
}

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
    "Fast" { $BaseArgs += @("--sleep-429", "60") }
    "Normal" { $BaseArgs += @("--sleep", "10.0-20.0", "--sleep-request", "5.0-10.0", "--sleep-429", "120") }
    "Cautious" { $BaseArgs += @("--sleep", "25.0-45.0", "--sleep-request", "15.0-30.0", "--sleep-429", "300") }
}

$Http429SleepSeconds = if ($RateLimit -eq "Cautious") { 300 } elseif ($RateLimit -eq "Normal") { 120 } else { 60 }
Write-RunLog ("HTTP 429: media retries enabled; {0}s delay before retry, up to {1} retries per request. Other concurrent captures are independent." -f $Http429SleepSeconds, $Retries)

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
        Write-Warning (ConvertTo-SafeLogText $msg)
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
            Write-Warning (ConvertTo-SafeLogText $msg)
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
    $evidenceSourceIndex = Read-EvidenceSourceIndex -Path $EvidenceSourceFile -MediaRoot $MediaFolder
    $evidenceSourceRelative = if ($EvidenceSourceFile) { $EvidenceSourceFile.Substring($CaseFolder.Length).TrimStart('\', '/') -replace '\\', '/' } else { $null }
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
                    -ItemSourceMetadata $evidenceSourceIndex[[System.IO.Path]::GetFullPath($imageFile.FullName).ToLowerInvariant()] `
                    -ItemSourceRecordPath $evidenceSourceRelative `
                    -Version $WaviVersion `
                    -StampTemplate $EvidenceStampTemplate `
                    -FooterPercent $EvidenceFooterPercent `
                    -PrioritiseReadability ([bool]$EvidenceReadability) `
                    -MinimumFontSize $EvidenceMinFont `
                    -LeftPercent $EvidenceLeftPercent `
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
$RunLogFullPath = [System.IO.Path]::GetFullPath($RunLog)

$ManifestEncoding = New-Object System.Text.UTF8Encoding($false)
$ManifestFailures = 0
$ManifestPartial = $ManifestFile + '.' + [guid]::NewGuid().ToString('N') + '.partial'
$ManifestWriter = $null
try {
    $CaseFiles = Get-ChildItem -LiteralPath $CaseFolder -File -Recurse -ErrorAction Stop | Where-Object {
        $_.FullName -notlike "*\.gui-cache\*" -and $_.FullName -notlike "*\manifests\*"
    }

    $ManifestWriter = New-Object System.IO.StreamWriter($ManifestPartial, $false, $ManifestEncoding)
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
            $ManifestFailures++
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
        $ManifestFailures++
        Write-Warning "Could not hash finalized run log: $RunLog - $($_.Exception.Message)"
    }
    $ManifestWriter.Dispose()
    $ManifestWriter = $null
    if ($ManifestFailures -eq 0) {
        [System.IO.File]::Move($ManifestPartial, $ManifestFile)
    }
}
catch {
    $ManifestFailures++
    Write-Warning "Could not complete hash manifest: $($_.Exception.Message)"
}
finally {
    try {
        Close-RunLogWriter
    }
    finally {
        try {
            if ($null -ne $ManifestWriter) { $ManifestWriter.Dispose() }
        }
        finally {
            if (Test-Path -LiteralPath $ManifestPartial) {
                Remove-Item -LiteralPath $ManifestPartial -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
if ($ManifestFailures -gt 0) {
    Write-Warning "Hash manifest was not committed because one or more files could not be processed. Successfully captured URL records were retained."
}

if ($Failed -gt 0 -or $EvidenceDerivativeFailures -gt 0 -or $ManifestFailures -gt 0) {
    exit 1
}

exit 0
