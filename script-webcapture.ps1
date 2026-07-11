<#
.SYNOPSIS
    PowerShell launcher for WAVI Capture GUI for OSINT Webpage Capture.

.DESCRIPTION
    Validates the generated Webpage Capture configuration and launches the
    TypeScript helper through Deno with narrowly scoped permissions.

    The script does not read the user's normal Edge or Chrome profile. The
    browser path and unique app-owned profile path come from the generated
    JSON configuration created by gui.py.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$DenoPath,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$ConfigPath,

    [Parameter(Mandatory = $false)]
    [ValidateNotNullOrEmpty()]
    [string]$HelperScriptPath = (Join-Path -Path $PSScriptRoot -ChildPath 'script-webcapture.ts')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-RequiredFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$LiteralPath,

        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    if ([string]::IsNullOrWhiteSpace($LiteralPath)) {
        throw "$Label path is blank."
    }

    $item = Get-Item -LiteralPath $LiteralPath -ErrorAction Stop
    if ($item.PSIsContainer) {
        throw "$Label must be a file: $LiteralPath"
    }

    return $item.FullName
}

function Resolve-AbsolutePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$LiteralPath
    )

    if ([System.IO.Path]::IsPathRooted($LiteralPath)) {
        return [System.IO.Path]::GetFullPath($LiteralPath)
    }

    return [System.IO.Path]::GetFullPath((Join-Path -Path (Get-Location).Path -ChildPath $LiteralPath))
}

function Get-UniquePermissionValue {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [string[]]$Paths
    )

    $seen = @{}
    $result = New-Object System.Collections.Generic.List[string]

    foreach ($path in $Paths) {
        if ([string]::IsNullOrWhiteSpace($path)) {
            continue
        }

        $absolute = Resolve-AbsolutePath -LiteralPath $path
        $key = $absolute.ToLowerInvariant()
        if (-not $seen.ContainsKey($key)) {
            $seen[$key] = $true
            [void]$result.Add($absolute)
        }
    }

    return ($result -join ',')
}

try {
    $resolvedDeno = Resolve-RequiredFile -LiteralPath $DenoPath -Label 'Deno'
    $resolvedConfig = Resolve-RequiredFile -LiteralPath $ConfigPath -Label 'Webpage Capture config'
    $resolvedHelper = Resolve-RequiredFile -LiteralPath $HelperScriptPath -Label 'Webpage Capture TypeScript helper'

    $config = Get-Content -LiteralPath $resolvedConfig -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop

    if (-not $config.browser_path) {
        throw 'The Webpage Capture configuration does not contain a browser path.'
    }
    if (-not $config.profile_root) {
        throw 'The Webpage Capture configuration does not contain an isolated profile path.'
    }

    $resolvedBrowser = Resolve-RequiredFile -LiteralPath ([string]$config.browser_path) -Label 'Edge/Chrome browser'
    $profileRoot = Resolve-AbsolutePath -LiteralPath ([string]$config.profile_root)

    $readPaths = New-Object System.Collections.Generic.List[string]
    $writePaths = New-Object System.Collections.Generic.List[string]
    [void]$readPaths.Add($resolvedConfig)
    [void]$readPaths.Add($profileRoot)
    [void]$writePaths.Add($profileRoot)

    if ($config.case_folder -and -not [string]::IsNullOrWhiteSpace([string]$config.case_folder)) {
        $caseFolder = Resolve-AbsolutePath -LiteralPath ([string]$config.case_folder)
        [void]$readPaths.Add($caseFolder)
        [void]$writePaths.Add($caseFolder)
    }

    $allowRead = Get-UniquePermissionValue -Paths ($readPaths.ToArray())
    $allowWrite = Get-UniquePermissionValue -Paths ($writePaths.ToArray())

    $denoArguments = @(
        'run'
        '--no-prompt'
        '--no-config'
        '--no-lock'
        "--allow-run=$resolvedBrowser"
        '--allow-net=127.0.0.1,localhost'
        "--allow-read=$allowRead"
        "--allow-write=$allowWrite"
        $resolvedHelper
        '--config'
        $resolvedConfig
    )

    Write-Output 'WEB_CAPTURE_WRAPPER_START'
    Write-Output "PowerShell wrapper: $($MyInvocation.MyCommand.Path)"
    Write-Output "TypeScript helper: $resolvedHelper"
    Write-Output "Deno executable: $resolvedDeno"
    Write-Output "Browser executable: $resolvedBrowser"
    Write-Output "Isolated profile: $profileRoot"

    & $resolvedDeno @denoArguments
    $exitCode = $LASTEXITCODE

    if ($null -eq $exitCode) {
        $exitCode = 1
    }

    exit ([int]$exitCode)
}
catch {
    Write-Error ("Webpage Capture launcher failed: " + $_.Exception.Message)
    exit 2
}
