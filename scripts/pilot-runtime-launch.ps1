<#
    Stable Scheduled Task entrypoint for the permanent standing runtime.

    The task stores only two durable launch facts: the dedicated repository
    root and the absolute private environment-file path.  The deployed SHA is
    deliberately not frozen into the task arguments: pilot-runner performs the
    exact, certified release handoff and exits, then the existing repetition
    trigger reaches this same launcher again on the new checkout.

    No environment-file content is opened or printed here.  A frozen install
    must finish before Node can start, which also makes a dependency failure
    after checkout handoff retryable without ever starting source promotion.
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath,
    [Parameter(Mandatory = $true)]
    [string]$EnvFile,
    [int]$IntervalMinutes = 60
)

$ErrorActionPreference = "Stop"

function Refuse([string]$Message) {
    Write-Error "RUNTIME_LAUNCH_REFUSED: $Message"
    exit 2
}

try {
    if (-not [System.IO.Path]::IsPathRooted($RepoPath)) { Refuse "repository path is not absolute" }
    if (-not [System.IO.Path]::IsPathRooted($EnvFile)) { Refuse "environment-file path is not absolute" }
    $RepoPath = [System.IO.Path]::GetFullPath($RepoPath)
    $EnvFile = [System.IO.Path]::GetFullPath($EnvFile)
    if (-not (Test-Path -LiteralPath $RepoPath -PathType Container)) { Refuse "repository path is unavailable" }
    if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) { Refuse "environment file is unavailable" }
    if ($IntervalMinutes -lt 1) { Refuse "interval must be at least one minute" }

    $node = (Get-Command node -ErrorAction SilentlyContinue)
    if ($null -eq $node) { Refuse "node is not on PATH" }
    $pnpm = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)
    if ($null -eq $pnpm) { $pnpm = (Get-Command pnpm -ErrorAction SilentlyContinue) }
    if ($null -eq $pnpm) { Refuse "pnpm is not on PATH" }

    Push-Location $RepoPath
    try {
        $head = (& git rev-parse HEAD 2>$null | Select-Object -First 1)
        if ($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-fA-F]{40}$') { Refuse "repository HEAD is unreadable" }

        # Reuse the installation validator against the current head. It proves
        # exact root, detached state, clean tree, origin/main ancestry, and a
        # private environment path without opening that file.
        & $node.Source "scripts/pilot-runtime-config.mjs" `
            "--repo" $RepoPath `
            "--env-file" $EnvFile `
            "--expected-sha" $head *> $null
        if ($LASTEXITCODE -ne 0) { Refuse "runtime-boundary validation failed" }

        & $pnpm.Source install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { Refuse "frozen dependency installation failed" }

        # Mint the standing parent's process-local authority only after the
        # stable checkout has revalidated clean/detached/exact HEAD. Children
        # rotate the nonce and bind the immediate parent plus one capability;
        # no value is stored in Git or the private environment file.
        $env:WTP_RUNTIME_AUTHORITY_REPO = $RepoPath
        $env:WTP_RUNTIME_AUTHORITY_SHA = $head.ToLowerInvariant()
        $env:WTP_RUNTIME_AUTHORITY_CAPABILITY = "STANDING_PARENT"
        Remove-Item Env:WTP_RUNTIME_AUTHORITY_CONTRACT -ErrorAction SilentlyContinue
        $env:WTP_RUNTIME_AUTHORITY_PARENT_PID = [string]$PID
        $env:WTP_RUNTIME_AUTHORITY_NONCE = [guid]::NewGuid().ToString("N")

        & $node.Source "--env-file=$EnvFile" --experimental-strip-types scripts/pilot-runner.mts "--interval=$IntervalMinutes" --release-handoff
        exit $(if ($null -eq $LASTEXITCODE) { 2 } else { [int]$LASTEXITCODE })
    }
    finally {
        Pop-Location
    }
}
catch {
    Refuse $_.Exception.Message
}
