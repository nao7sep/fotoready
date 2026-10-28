Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$scriptExitCode = 0

# rebuild: produce a fresh production build, package it into a real app bundle,
# and launch it. Slow — run this after changing source. The build runs the
# production type checks and re-bundles from clean, so type, import, CSP, and
# packaged-layout errors that run-dev hides surface here; packaging then gives the
# app its own identity. run-built is the fast, no-build launcher after this.

function Set-Utf8Console {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [Console]::InputEncoding = $utf8NoBom
    [Console]::OutputEncoding = $utf8NoBom
    $global:OutputEncoding = $utf8NoBom
    if (Get-Command chcp.com -ErrorAction SilentlyContinue) {
        & chcp.com 65001 > $null
        $null = $LASTEXITCODE
    }
}

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Require-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing required command: $Name"
    }
}

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [int[]]$AllowedExitCodes = @(0)
    )

    & $FilePath @ArgumentList
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
    if ($AllowedExitCodes -notcontains $exitCode) {
        throw "Command failed with exit code ${exitCode}: $FilePath $($ArgumentList -join ' ')"
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoDir = Split-Path -Parent $scriptDir
$runtimeHelper = Join-Path $scriptDir "launcher-runtime.mjs"

try {
    Set-Utf8Console
    Require-Command node
    Require-Command npm

    Set-Location $repoDir

    Write-Step "Installing dependencies"
    Invoke-Native -FilePath "npm" -ArgumentList @("install")

    # Build into a clean candidate so a build that fails to emit a file can't be
    # masked by a leftover artifact; the previous package stays runnable until the
    # candidate is complete.
    Write-Step "Preparing clean build output"
    $candidate = & node $runtimeHelper prepare-candidate
    if ($LASTEXITCODE -ne 0) { throw "Could not prepare the build output." }

    # The package script type-checks the shipped sources (main/preload + renderer), builds the
    # production bundle and packages the unpacked app only, no installer. The dev server skips the
    # type check entirely, and tests are a separate gate. Packaging gives the app its own identity
    # (correct name and icon) instead of running under the generic Electron runtime.
    Write-Step "Building and packaging the app"
    Invoke-Native -FilePath "npm" -ArgumentList @("run", "package", "--", "--config.directories.output=$candidate")

    # Windows locks the packaged executable while it runs, so the running app
    # closes before the candidate replaces its package.
    Write-Step "Publishing the verified package"
    Invoke-Native -FilePath "node" -ArgumentList @($runtimeHelper, "stop")
    Invoke-Native -FilePath "node" -ArgumentList @($runtimeHelper, "publish-candidate")

    Write-Step "Launching the packaged app"
    Invoke-Native -FilePath "node" -ArgumentList @($runtimeHelper, "launch-packaged")
}
catch {
    Write-Host ""
    Write-Host "fotoready rebuild failed: $($_.Exception.Message)" -ForegroundColor Red
    $scriptExitCode = 1
}
finally {
    Read-Host "Press Enter to close" | Out-Null
}

exit $scriptExitCode
