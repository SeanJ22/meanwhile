<#
    THE PILOT RUNNER'S SURVIVAL MECHANISM: A REBOOT, AND A KILL.
    (Session C, PART G2, 2026-08-31. Two-trigger design 2026-09-01.)

    INVARIANTS
    ----------
    1. The Scheduled Task carries TWO triggers: AtLogOn, and a REPETITION
       trigger (Once, every 5 minutes, for 3650 days). MultipleInstances is
       IgnoreNew, so a firing while the runner lives is a no-op and a firing
       after a death relaunches it within five minutes.

    2. RestartCount / RestartInterval are NOT a relaunch path on this host.
       Measured 2026-09-01: a runner killed with Stop-Process -Force left the
       task at Ready, LastTaskResult 0xFFFFFFFF, and NO relaunch within 8
       minutes. The settings stay (they cost nothing); nothing may claim
       recovery from them. The repetition trigger is the relaunch path.

    3. Trigger presence is DERIVED from the live task (Get-ScheduledTask ->
       Triggers -> Repetition), never from a flag and never from the fact that
       install asked for it. `status`, `verify-triggers` and `prove-relaunch`
       all read the same derivation.

    4. Registration needs elevation on this host. Register-ScheduledTask and
       schtasks /Create answered Access is denied (0x80070005) unelevated on
       2026-08-31; Set-ScheduledTask answered the same on 2026-09-01. An
       unattended session never elevates itself. `install` still tries, prints
       the refusal verbatim, installs the per-user Startup fallback only when
       no active task remains, and prints the exact elevated command once.

    5. The per-user startup entry (%APPDATA%\...\Startup\wtp-pilot-runner.cmd)
       is FALLBACK-ONLY when Task Scheduler registration is refused. A live
       scheduled task and this entry may never coexist: both fire at logon and
       `MultipleInstances IgnoreNew` cannot constrain an external launcher.

    6. `prove-relaunch` KILLS the runner to measure the relaunch. It refuses
       (exit 2) unless the relaunch trigger is present on the live task, because
       killing the runner then leaves nothing to bring it back.

    THE COMMANDS
    ------------
        pnpm pilot:install     register the task with BOTH triggers, or print why
                               not; install Startup only as the refused-task fallback
        pnpm pilot:start       start the runner NOW, without waiting for a logon
        pnpm pilot:stop        stop the running runner
        pnpm pilot:status      what is installed, every trigger, whether the
                               RELAUNCH TRIGGER is present, whether it is running
        pnpm pilot:disable     stop it AND stop it coming back at logon
        pnpm pilot:uninstall   remove both mechanisms entirely

    stop, disable and start ALSO write the owner's PAUSE_RUNNER / RESUME_RUNNER
    note through scripts/runner-pause-note.mts (ADM-5, 9.4.26 admin feedback),
    so the admin dashboard can tell a deliberate stop from a crash. Best
    effort: the note never changes an action's exit code, and a note that could
    not be recorded is printed, never thrown.

    Without pnpm, from any shell in the repository:

        powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action status
        powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action verify-triggers
            read-only JSON; exit 0 when the relaunch trigger is present, else 1
        powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action prove-relaunch
            kills the runner, polls every 15 s for up to 8 min for a NEW pid,
            writes ignored host evidence at .runtime/ops/runner-relaunch-proof.json
            in the installed runtime checkout; it never dirties Git

    The elevated one-liner, run ONCE from an elevated PowerShell after the
    software deploy and exact-head certification have both completed:

        powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action install `
          -RepoPath C:\Users\seanj\dev\wtp-production-runtime `
          -EnvFile C:\absolute\private\production.env `
          -ExpectedDeployedSha <the-full-40-character-deployed-SHA>

    WHAT IT RUNS
    ------------
    The task calls `scripts/pilot-runtime-launch.ps1` with only the validated
    absolute repository and environment-file paths plus the interval. The
    stable launcher revalidates the clean detached checkout, completes
    `pnpm install --frozen-lockfile`, then starts `pilot-runner.mts`. The
    deployed SHA is an INITIAL installation proof, not a permanent task
    argument: the runner hands the dedicated checkout to later exact deployed,
    certified SHAs and exits for this same trigger to relaunch it.

    The parent loads the environment file once; every child inherits its
    environment and never reopens a cwd-relative `.env.local`. No
    environment-file byte or variable value is read, printed, or persisted by
    this installer or launcher.

    RESEARCH PROMOTION STAYS OFF. The research cycle passes no flag that could
    promote its staged output. The same standing host independently invokes the
    typed routine civic-data registry, whose source-scoped candidates may
    promote only through the permanent data plane. A research pause, failure,
    or provider-circuit branch does not pause that routine-data tick.

    WHERE THE OWNER READS IT
    ------------------------
    `G:\My Drive\we-the-people\pilot-digest.md` - overwritten each cycle, with
    every cycle's headline appended to `pilot-digest-log.md` beside it. The
    Drive mirror is a synced folder, so writing the file IS the delivery.
    Set WTP_MIRROR to move it.
#>

param(
    [ValidateSet("validate-config", "install", "start", "stop", "status", "disable", "uninstall", "verify-triggers", "prove-relaunch", "owner-command")]
    [string]$Action = "status",

    # These three facts are intentionally explicit for every installation. A
    # temporary worktree, dirty main checkout, relative secret path, branch tip,
    # or merely-latest SHA is refused by the executable validator.
    [string]$RepoPath = "",
    [string]$EnvFile = "",
    [string]$ExpectedDeployedSha = "",

    # Minutes between cycles.
    [int]$IntervalMinutes = 60,

    # Opaque, bounded JSON supplied by scripts/installed-runtime-command.mjs.
    # Only the installed checkout's typed dispatcher interprets it; this host
    # controller proves which checkout is allowed to do so first.
    [string]$OwnerCommandPayload = ""
)

$TaskName    = "WeThePeople Pilot Runner"
$StartupDir  = [Environment]::GetFolderPath('Startup')
$StartupFile = Join-Path $StartupDir "wtp-pilot-runner.cmd"
$ErrorActionPreference = "Stop"

# The relaunch trigger, as installed. Presence is judged against these too:
# an interval no longer than this, a duration at least a year (or indefinite).
$RelaunchIntervalMinutes = 5
$RelaunchDurationDays    = 3650
$RelaunchMinDurationDays = 365

$ScriptRepo = Split-Path -Parent $PSScriptRoot
$ProofFile  = $null

$ElevatedOneLiner = "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action install -RepoPath <absolute-clean-runtime-repo> -EnvFile <absolute-env-file> -ExpectedDeployedSha <40-char-deployed-sha>"

# PDC V2 retired the separate nightly-window Scheduled Task. The standing
# runner's internal due-check is the sole clock for that research-only window.
# Keep the old fixed task name only so install/uninstall can delete a task made
# by an earlier release; no surviving action may create or run it.
$LegacyWindowTaskName = "WeThePeople Nightly Window"

function Get-NodePath {
    $node = (Get-Command node -ErrorAction SilentlyContinue)
    if ($null -eq $node) { throw "node is not on PATH; the mechanism needs an absolute node path." }
    return $node.Source
}

function Get-PowerShellPath {
    $powershell = (Get-Command powershell.exe -ErrorAction SilentlyContinue)
    if ($null -eq $powershell) { $powershell = (Get-Command powershell -ErrorAction SilentlyContinue) }
    if ($null -eq $powershell) { throw "powershell is not on PATH; the launch mechanism needs an absolute executable path." }
    return $powershell.Source
}

function Resolve-RuntimeConfig {
    # One executable validator owns these predicates and is also imported by
    # deterministic tests. It never reads the environment file; it returns only
    # normalized paths and the SHA that was supplied.
    if ([string]::IsNullOrWhiteSpace($RepoPath) -or
        [string]::IsNullOrWhiteSpace($EnvFile) -or
        [string]::IsNullOrWhiteSpace($ExpectedDeployedSha)) {
        throw "RepoPath, EnvFile, and ExpectedDeployedSha are required. Supply an absolute clean detached runtime repository, an absolute private environment file, and the full deployed SHA."
    }
    if (-not [System.IO.Path]::IsPathRooted($RepoPath)) {
        throw "RepoPath must be absolute so the exact target checkout owns its validator."
    }
    $node = Get-NodePath
    # Execute the validator from the exact checkout being installed. An
    # engineering worktree may invoke this installer, but unshipped code in
    # that worktree is not allowed to certify a different production tree.
    $validator = Join-Path ([System.IO.Path]::GetFullPath($RepoPath)) "scripts\pilot-runtime-config.mjs"
    if (-not (Test-Path -LiteralPath $validator -PathType Leaf)) {
        throw "runtime config validator is missing: $validator"
    }
    # Bootstrap the validator itself before executing it: its worktree bytes
    # must be the blob carried by the explicit deployed commit. Otherwise a
    # dirty target could replace its validator with one that falsely says the
    # rest of the target is clean.
    $expectedValidatorOutput = @(& git -C $RepoPath rev-parse "${ExpectedDeployedSha}:scripts/pilot-runtime-config.mjs" 2>$null)
    $expectedValidatorExit = $LASTEXITCODE
    $expectedValidatorBlob = [string]($expectedValidatorOutput | Select-Object -First 1)
    $expectedValidatorBlob = $expectedValidatorBlob.Trim()
    if ($expectedValidatorExit -ne 0 -or $expectedValidatorBlob -notmatch '^[0-9a-fA-F]{40}$') {
        throw "the expected deployed commit does not carry a readable runtime config validator"
    }
    $workingValidatorOutput = @(& git -C $RepoPath hash-object --path="scripts/pilot-runtime-config.mjs" "scripts/pilot-runtime-config.mjs" 2>$null)
    $workingValidatorExit = $LASTEXITCODE
    $workingValidatorBlob = [string]($workingValidatorOutput | Select-Object -First 1)
    $workingValidatorBlob = $workingValidatorBlob.Trim()
    if ($workingValidatorExit -ne 0 -or $workingValidatorBlob -notmatch '^[0-9a-fA-F]{40}$' -or $workingValidatorBlob -ne $expectedValidatorBlob) {
        throw "the target checkout's runtime config validator does not equal the expected deployed commit's validator (expected $expectedValidatorBlob, exit $expectedValidatorExit; found $workingValidatorBlob, exit $workingValidatorExit)"
    }
    $validatorArgs = @(
        $validator,
        "--repo", $RepoPath,
        "--env-file", $EnvFile,
        "--expected-sha", $ExpectedDeployedSha
    )
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $answer = @(& $node @validatorArgs 2>&1)
        $code = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($code -ne 0) {
        throw (($answer | ForEach-Object { [string]$_ }) -join "`n")
    }
    try {
        $resolved = (($answer | ForEach-Object { [string]$_ }) -join "`n") | ConvertFrom-Json
    }
    catch {
        throw "runtime config validator returned unreadable output"
    }
    $script:RepoPath = [string]$resolved.repoPath
    $script:EnvFile = [string]$resolved.envFile
    $script:ExpectedDeployedSha = [string]$resolved.expectedSha
    $script:ProofFile = Join-Path $script:RepoPath ".runtime\ops\runner-relaunch-proof.json"
    $script:ElevatedOneLiner = "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action install -RepoPath `"$script:RepoPath`" -EnvFile `"$script:EnvFile`" -ExpectedDeployedSha $script:ExpectedDeployedSha"
    return $resolved
}

function Quote-TaskArgument {
    param([string]$Value)
    if ($Value.Contains('"')) { throw "a launch path may not contain a double quote" }
    return '"' + $Value + '"'
}

function Test-SameResolvedPath {
    param([string]$Left, [string]$Right)
    if ([string]::IsNullOrWhiteSpace($Left) -or [string]::IsNullOrWhiteSpace($Right)) { return $false }
    try {
        $a = [System.IO.Path]::GetFullPath($Left).TrimEnd('\')
        $b = [System.IO.Path]::GetFullPath($Right).TrimEnd('\')
        return [string]::Equals($a, $b, [System.StringComparison]::OrdinalIgnoreCase)
    }
    catch { return $false }
}

function Get-LauncherArgs {
    $launcher = Join-Path $RepoPath "scripts\pilot-runtime-launch.ps1"
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
        throw "runtime launcher is missing: $launcher"
    }
    return "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File $(Quote-TaskArgument $launcher) -RepoPath $(Quote-TaskArgument $RepoPath) -EnvFile $(Quote-TaskArgument $EnvFile) -IntervalMinutes $IntervalMinutes"
}

function ConvertFrom-LauncherArgs {
    param([string]$Arguments)
    $pattern = '^-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "([^"]+)" -RepoPath "([^"]+)" -EnvFile "([^"]+)" -IntervalMinutes ([0-9]+)$'
    $match = [regex]::Match($Arguments, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $match.Success) {
        throw "the installed entrypoint does not carry the exact stable-launcher argument contract"
    }
    $minutes = [int]$match.Groups[4].Value
    if ($minutes -lt 1) { throw "the installed entrypoint carries an invalid interval ($minutes minute(s))" }
    return [ordered]@{
        launcher        = $match.Groups[1].Value
        repoPath        = $match.Groups[2].Value
        envFile         = $match.Groups[3].Value
        intervalMinutes = $minutes
    }
}

function Assert-CurrentInstallerMatchesRuntimeHead {
    param([string]$RuntimeRepo, [string]$RuntimeHead)
    # A task created by transition-era code may have the same fixed name and a
    # plausible command line. It is not thereby this authority. Bind the
    # currently executing installer to the installed checkout's committed
    # installer blob before allowing `start` to reactivate that checkout.
    $currentOutput = @(& git -C $ScriptRepo hash-object --path="scripts/pilot-task.ps1" "scripts/pilot-task.ps1" 2>$null)
    $currentExit = $LASTEXITCODE
    $currentBlob = [string]($currentOutput | Select-Object -First 1)
    $currentBlob = $currentBlob.Trim()
    $runtimeOutput = @(& git -C $RuntimeRepo rev-parse "${RuntimeHead}:scripts/pilot-task.ps1" 2>$null)
    $runtimeExit = $LASTEXITCODE
    $runtimeBlob = [string]($runtimeOutput | Select-Object -First 1)
    $runtimeBlob = $runtimeBlob.Trim()
    if ($currentExit -ne 0 -or $runtimeExit -ne 0 -or
        $currentBlob -notmatch '^[0-9a-fA-F]{40}$' -or
        $runtimeBlob -notmatch '^[0-9a-fA-F]{40}$' -or
        $currentBlob -ne $runtimeBlob) {
        throw "the installed runtime does not carry this exact permanent installer; refusing to reactivate a stale or transition-era authority"
    }
}

function Resolve-InstalledRuntime {
    param($LaunchConfig)
    $runtimeHeadOutput = @(& git -C $LaunchConfig.repoPath rev-parse HEAD 2>$null)
    $runtimeHeadExit = $LASTEXITCODE
    $runtimeHead = [string]($runtimeHeadOutput | Select-Object -First 1)
    $runtimeHead = $runtimeHead.Trim()
    if ($runtimeHeadExit -ne 0 -or $runtimeHead -notmatch '^[0-9a-fA-F]{40}$') {
        throw "the installed runtime checkout has no readable exact HEAD"
    }

    $script:RepoPath = [string]$LaunchConfig.repoPath
    $script:EnvFile = [string]$LaunchConfig.envFile
    $script:ExpectedDeployedSha = $runtimeHead
    $script:IntervalMinutes = [int]$LaunchConfig.intervalMinutes
    $resolved = Resolve-RuntimeConfig
    Assert-CurrentInstallerMatchesRuntimeHead -RuntimeRepo $resolved.repoPath -RuntimeHead $resolved.expectedSha

    $expectedLauncher = Join-Path $resolved.repoPath "scripts\pilot-runtime-launch.ps1"
    if (-not (Test-SameResolvedPath $LaunchConfig.launcher $expectedLauncher)) {
        throw "the installed entrypoint does not name the stable launcher in its validated runtime checkout"
    }
    $expectedArguments = Get-LauncherArgs
    return [ordered]@{
        repoPath        = [string]$resolved.repoPath
        envFile         = [string]$resolved.envFile
        expectedSha     = [string]$resolved.expectedSha
        intervalMinutes = [int]$LaunchConfig.intervalMinutes
        launcher        = $expectedLauncher
        launcherArgs    = $expectedArguments
    }
}

function Remove-LegacyWindowTaskOrThrow {
    $legacy = Get-ScheduledTask -TaskName $LegacyWindowTaskName -ErrorAction SilentlyContinue
    if (-not $legacy) { return }

    # `/End` may answer nonzero when no instance is running; deletion and its
    # readback are the authority for whether the retired clock still exists.
    [void](Invoke-Schtasks @("/End", "/TN", $LegacyWindowTaskName))
    $deleteCode = Invoke-Schtasks @("/Delete", "/TN", $LegacyWindowTaskName, "/F")
    $remaining = Get-ScheduledTask -TaskName $LegacyWindowTaskName -ErrorAction SilentlyContinue
    if ($deleteCode -ne 0 -or $remaining) {
        throw "the retired Scheduled Task '$LegacyWindowTaskName' could not be deleted (schtasks exit $deleteCode); refusing to leave a second operational clock installed"
    }
}

function Install-StartupEntry {
    param([string]$PowerShell, [string]$LauncherArgs)
    # `start "" /min` detaches the runner from the logon script so Windows does
    # not hold the logon open on a process that never exits.
    $body = @"
@echo off
rem WeThePeople pilot runner - installed by scripts/pilot-task.ps1
rem Delete this file to stop the runner coming back at logon.
cd /d "$RepoPath"
start "" /min "$PowerShell" $LauncherArgs
"@
    Set-Content -Path $StartupFile -Value $body -Encoding ascii
    return $StartupFile
}

function Remove-StartupEntryOrThrow {
    if (Test-Path $StartupFile) {
        Remove-Item -LiteralPath $StartupFile -Force -ErrorAction Stop
    }
    if (Test-Path $StartupFile) {
        throw "the scheduled task landed but the competing Startup entry could not be removed: $StartupFile"
    }
}

function Get-RunnerProcesses {
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
        Where-Object { $_.CommandLine -like "*pilot-runner.mts*" }
}

function Get-ProcessTreeSnapshot {
    param([object[]]$Roots)
    $rootRows = @($Roots)
    if ($rootRows.Count -eq 0) { return @() }
    $all = @(Get-CimInstance Win32_Process)
    $pending = @($rootRows | ForEach-Object { [int]$_.ProcessId })
    $ids = @()
    while ($pending.Count -gt 0) {
        $current = [int]$pending[0]
        $pending = @($pending | Select-Object -Skip 1)
        if ($ids -contains $current) { continue }
        $ids += $current
        $pending += @($all | Where-Object { [int]$_.ParentProcessId -eq $current } | ForEach-Object { [int]$_.ProcessId })
    }
    return @($all | Where-Object { $ids -contains [int]$_.ProcessId })
}

function Invoke-TaskkillTree {
    param([int]$ProcessId)
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $code = 0
    try {
        # `/T` is load-bearing: routine-data, intake and console publishers are
        # child processes and may hold a production write capability after the
        # parent exits. Killing only pilot-runner can therefore leave the old
        # authority alive across a release/import boundary.
        & taskkill.exe /PID $ProcessId /T /F *> $null
        $code = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
    }
    catch {
        $code = 1
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }
    return $code
}

function Stop-RunnerProcessTrees {
    param([object[]]$Roots = @())
    $rootRows = @($Roots)
    if ($rootRows.Count -eq 0) { $rootRows = @(Get-RunnerProcesses) }
    $captured = @(Get-ProcessTreeSnapshot -Roots $rootRows)
    $problems = @()

    foreach ($root in $rootRows) {
        $processId = [int]$root.ProcessId
        $code = Invoke-TaskkillTree -ProcessId $processId
        if ($code -ne 0 -and $null -ne (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
            $problems += "taskkill /T could not terminate pilot-runner process tree rooted at pid $processId (exit $code)."
        }
    }

    # A parent can exit between capture and taskkill. Explicitly close every
    # captured descendant still alive so an orphan cannot keep a production
    # handle merely because its former root no longer exists.
    foreach ($row in $captured) {
        $processId = [int]$row.ProcessId
        if ($null -eq (Get-Process -Id $processId -ErrorAction SilentlyContinue)) { continue }
        $code = Invoke-TaskkillTree -ProcessId $processId
        if ($code -ne 0 -and $null -ne (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
            $problems += "captured runner descendant pid $processId remained after taskkill /T (exit $code)."
        }
    }

    $remainingCaptured = @($captured | Where-Object {
        $null -ne (Get-Process -Id ([int]$_.ProcessId) -ErrorAction SilentlyContinue)
    } | ForEach-Object { [int]$_.ProcessId })
    if ($remainingCaptured.Count -gt 0) {
        $problems += "captured runner process tree still has live pid(s): $($remainingCaptured -join ', ')."
    }
    return [pscustomobject]@{
        rootPids           = @($rootRows | ForEach-Object { [int]$_.ProcessId })
        capturedPids       = @($captured | ForEach-Object { [int]$_.ProcessId })
        remainingPids      = $remainingCaptured
        problems           = $problems
    }
}

function ConvertFrom-Iso8601Duration {
    # Task Scheduler reports repetition as ISO 8601 (PT5M, P3650D). Empty is null.
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
    try { return [System.Xml.XmlConvert]::ToTimeSpan($Text) } catch { return $null }
}

function Get-TriggerFacts {
    # One record per trigger on the LIVE task object: type, enabled, boundary,
    # and the repetition as reported, not as requested.
    param($Task)
    $out = @()
    foreach ($tr in @($Task.Triggers)) {
        $rep = $tr.Repetition
        $out += [ordered]@{
            type               = ($tr.CimClass.CimClassName -replace '^MSFT_Task', '')
            enabled            = [bool]$tr.Enabled
            startBoundary      = $(if ([string]::IsNullOrWhiteSpace($tr.StartBoundary)) { $null } else { [string]$tr.StartBoundary })
            repetitionInterval = $(if ($null -ne $rep -and -not [string]::IsNullOrWhiteSpace($rep.Interval)) { [string]$rep.Interval } else { $null })
            repetitionDuration = $(if ($null -ne $rep -and -not [string]::IsNullOrWhiteSpace($rep.Duration)) { [string]$rep.Duration } else { $null })
        }
    }
    # Bare, not `,$out`: the caller collects with @(), which is right for zero,
    # one and many triggers; a comma-wrapped return nests a one-trigger task.
    return $out
}

function Test-RelaunchTrigger {
    # DERIVED from the live triggers: an enabled trigger whose Repetition.Interval
    # is a positive span no longer than $RelaunchIntervalMinutes and whose
    # Repetition.Duration is at least $RelaunchMinDurationDays (or absent, which
    # Task Scheduler treats as indefinite). Never a flag, never a constant.
    param($Task)
    if ($null -eq $Task) { return $false }
    foreach ($tr in @($Task.Triggers)) {
        if (-not $tr.Enabled) { continue }
        $rep = $tr.Repetition
        if ($null -eq $rep) { continue }
        $interval = ConvertFrom-Iso8601Duration $rep.Interval
        if ($null -eq $interval -or $interval.TotalSeconds -le 0) { continue }
        if ($interval.TotalMinutes -gt $RelaunchIntervalMinutes) { continue }
        $duration = ConvertFrom-Iso8601Duration $rep.Duration
        if ($null -ne $duration -and $duration.TotalDays -lt $RelaunchMinDurationDays) { continue }
        return $true
    }
    return $false
}

function Get-TaskFacts {
    # The one derivation every reporting action shares.
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    $present = $null -ne $task
    $info = $null
    if ($present) { $info = Get-ScheduledTaskInfo -TaskName $TaskName }
    $taskAction = if ($present -and @($task.Actions).Count -eq 1) { @($task.Actions)[0] } else { $null }
    $pids = @(Get-RunnerProcesses | ForEach-Object { [int]$_.ProcessId })
    $relaunch = Test-RelaunchTrigger $task
    # Built explicitly: a `$( ... @() )` subexpression flattens an empty array
    # to nothing, and ConvertTo-Json then prints `{}` where `[]` is owed.
    $triggers = @()
    if ($present) { $triggers = @(Get-TriggerFacts $task) }
    return [ordered]@{
        taskPresent            = $present
        state                  = $(if ($present) { [string]$task.State } else { $null })
        triggers               = $triggers
        relaunchTriggerPresent = $relaunch
        startupEntryPresent    = [bool](Test-Path $StartupFile)
        singleEntrypoint       = [bool]($present -and $task.State -ne "Disabled" -and $relaunch -and -not (Test-Path $StartupFile))
        executable             = $(if ($null -ne $taskAction) { [string]$taskAction.Execute } else { $null })
        workingDirectory       = $(if ($null -ne $taskAction) { [string]$taskAction.WorkingDirectory } else { $null })
        arguments              = $(if ($null -ne $taskAction) { [string]$taskAction.Arguments } else { $null })
        lastRunTime            = $(if ($null -ne $info -and $info.LastRunTime -is [datetime] -and $info.LastRunTime.Year -gt 1) { $info.LastRunTime.ToString("o") } else { $null })
        lastTaskResult         = $(if ($null -ne $info) { ('0x{0:X8}' -f [uint32]$info.LastTaskResult) } else { $null })
        runningPids            = $pids
    }
}

function Resolve-TaskRuntimeOrThrow {
    param($Facts, [switch]$AllowDisabled)
    if (-not $Facts.taskPresent) { throw "the Scheduled Task is absent" }
    $configurationIsSole = $Facts.relaunchTriggerPresent -and -not $Facts.startupEntryPresent
    if ((-not $AllowDisabled -and -not $Facts.singleEntrypoint) -or
        ($AllowDisabled -and -not $configurationIsSole)) {
        throw "the Scheduled Task is disabled, lacks its relaunch trigger, or competes with a Startup entry"
    }
    $launch = ConvertFrom-LauncherArgs ([string]$Facts.arguments)
    $runtime = Resolve-InstalledRuntime $launch
    $powershell = Get-PowerShellPath
    if (-not (Test-SameResolvedPath $Facts.executable $powershell)) {
        throw "the Scheduled Task does not execute the expected PowerShell host"
    }
    if (-not (Test-SameResolvedPath $Facts.workingDirectory $runtime.repoPath)) {
        throw "the Scheduled Task working directory is not the validated runtime checkout"
    }
    if ([string]$Facts.arguments -ne [string]$runtime.launcherArgs) {
        throw "the Scheduled Task arguments do not exactly equal the validated stable-launcher configuration"
    }
    return $runtime
}

function Resolve-StartupRuntimeOrThrow {
    if (-not (Test-Path -LiteralPath $StartupFile -PathType Leaf)) {
        throw "the Startup entry is absent"
    }
    $body = Get-Content -LiteralPath $StartupFile -Raw
    $launchLine = [regex]::Match($body, '(?m)^start "" /min "([^"]+)" (.+)\r?$')
    $repoLine = [regex]::Match($body, '(?m)^cd /d "([^"]+)"\r?$')
    if (-not $launchLine.Success -or -not $repoLine.Success) {
        throw "the Startup entry does not carry the exact fallback launcher shape"
    }
    $launch = ConvertFrom-LauncherArgs $launchLine.Groups[2].Value.Trim()
    $runtime = Resolve-InstalledRuntime $launch
    $powershell = Get-PowerShellPath
    if (-not (Test-SameResolvedPath $launchLine.Groups[1].Value $powershell)) {
        throw "the Startup entry does not execute the expected PowerShell host"
    }
    if (-not (Test-SameResolvedPath $repoLine.Groups[1].Value $runtime.repoPath)) {
        throw "the Startup entry changes to a different directory than the validated runtime checkout"
    }
    if ([string]$launchLine.Groups[2].Value.Trim() -ne [string]$runtime.launcherArgs) {
        throw "the Startup entry arguments do not exactly equal the validated stable-launcher configuration"
    }
    return $runtime
}

function Test-CommandLineToken {
    param([string]$CommandLine, [string]$Token)
    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $false }
    $escaped = [regex]::Escape($Token)
    return [regex]::IsMatch($CommandLine, "(?i)(?:^|\s)`"?$escaped`"?(?=\s|$)")
}

function Test-RunnerProcessIdentity {
    param($Process, $Runtime)
    $node = Get-NodePath
    if (-not (Test-SameResolvedPath ([string]$Process.ExecutablePath) $node)) { return $false }
    $commandLine = [string]$Process.CommandLine
    $scriptAbsolute = Join-Path $Runtime.repoPath "scripts\pilot-runner.mts"
    $scriptNamed = (Test-CommandLineToken $commandLine "scripts/pilot-runner.mts") -or
        (Test-CommandLineToken $commandLine $scriptAbsolute)
    return $scriptNamed -and
        (Test-CommandLineToken $commandLine "--env-file=$($Runtime.envFile)") -and
        (Test-CommandLineToken $commandLine "--interval=$($Runtime.intervalMinutes)") -and
        (Test-CommandLineToken $commandLine "--release-handoff")
}

function Read-RunnerIdentity {
    param($Runtime)
    $all = @(Get-RunnerProcesses)
    $matching = @($all | Where-Object { Test-RunnerProcessIdentity $_ $Runtime })
    return [ordered]@{
        all      = $all
        matching = $matching
    }
}

function Wait-ForVerifiedRunnerOrThrow {
    param($Runtime, [int]$TimeoutSeconds = 120)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $identity = Read-RunnerIdentity $Runtime
        if ($identity.all.Count -gt 0) {
            if ($identity.all.Count -eq 1 -and $identity.matching.Count -eq 1) {
                return $identity.matching[0]
            }
            $allPids = @($identity.all | ForEach-Object { [int]$_.ProcessId })
            $matchingPids = @($identity.matching | ForEach-Object { [int]$_.ProcessId })
            throw "runner process identity mismatch: found $($identity.all.Count) named process(es) [$($allPids -join ', ')], but $($identity.matching.Count) [$($matchingPids -join ', ')] match the validated repo, environment path, interval, and release-handoff contract"
        }
        if ((Get-Date) -ge $deadline) { break }
        Start-Sleep -Seconds 2
    } while ($true)
    throw "no verified permanent pilot-runner process appeared within $TimeoutSeconds seconds"
}

function Resolve-ActiveRuntimeOrThrow {
    # Every mutating host-control door resolves the same sole, permanent
    # entrypoint. A fixed task name, a plausible process name, or an old
    # Startup file is not authority.
    if (Get-ScheduledTask -TaskName $LegacyWindowTaskName -ErrorAction SilentlyContinue) {
        throw "the retired Scheduled Task '$LegacyWindowTaskName' is still installed"
    }
    $facts = Get-TaskFacts
    if ($facts.taskPresent -and $facts.state -ne "Disabled") {
        return [ordered]@{
            facts      = $facts
            runtime    = Resolve-TaskRuntimeOrThrow $facts
            entrypoint = "Scheduled Task"
        }
    }
    if (Test-Path -LiteralPath $StartupFile -PathType Leaf) {
        return [ordered]@{
            facts      = $facts
            runtime    = Resolve-StartupRuntimeOrThrow
            entrypoint = "Startup fallback"
        }
    }
    throw "no validated permanent runtime entrypoint is installed"
}

function Read-OnlyVerifiedRunnerOrThrow {
    param($Runtime, [bool]$Required = $true)
    $identity = Read-RunnerIdentity $Runtime
    if ($identity.all.Count -eq 0) {
        if ($Required) { throw "the validated permanent runtime has no running pilot parent" }
        return $null
    }
    if ($identity.all.Count -ne 1 -or $identity.matching.Count -ne 1) {
        $allPids = @($identity.all | ForEach-Object { [int]$_.ProcessId })
        $matchingPids = @($identity.matching | ForEach-Object { [int]$_.ProcessId })
        throw "runner process identity mismatch: found $($identity.all.Count) named process(es) [$($allPids -join ', ')], but $($identity.matching.Count) [$($matchingPids -join ', ')] match the validated installed runtime"
    }
    return $identity.matching[0]
}

function Invoke-RuntimeNodeWithAuthority {
    # Mint an immediate-parent capability only around one exact Node child,
    # then restore every prior process value. The environment file cannot
    # become a durable authority source and no later child inherits a stale
    # capability accidentally.
    param($Runtime, [string]$Capability, [string[]]$NodeArgs, [string]$Contract = "")
    $names = @(
        "WTP_RUNTIME_AUTHORITY_REPO",
        "WTP_RUNTIME_AUTHORITY_SHA",
        "WTP_RUNTIME_AUTHORITY_CAPABILITY",
        "WTP_RUNTIME_AUTHORITY_CONTRACT",
        "WTP_RUNTIME_AUTHORITY_PARENT_PID",
        "WTP_RUNTIME_AUTHORITY_NONCE"
    )
    $before = @{}
    foreach ($name in $names) {
        $before[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
    }
    try {
        [Environment]::SetEnvironmentVariable("WTP_RUNTIME_AUTHORITY_REPO", [string]$Runtime.repoPath, "Process")
        [Environment]::SetEnvironmentVariable("WTP_RUNTIME_AUTHORITY_SHA", [string]$Runtime.expectedSha, "Process")
        [Environment]::SetEnvironmentVariable("WTP_RUNTIME_AUTHORITY_CAPABILITY", $Capability, "Process")
        [Environment]::SetEnvironmentVariable("WTP_RUNTIME_AUTHORITY_CONTRACT", $(if ([string]::IsNullOrWhiteSpace($Contract)) { $null } else { $Contract }), "Process")
        [Environment]::SetEnvironmentVariable("WTP_RUNTIME_AUTHORITY_PARENT_PID", [string]$PID, "Process")
        [Environment]::SetEnvironmentVariable("WTP_RUNTIME_AUTHORITY_NONCE", [guid]::NewGuid().ToString("N"), "Process")

        $node = Get-NodePath
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        Push-Location $Runtime.repoPath
        try {
            $lines = @(& $node "--env-file=$($Runtime.envFile)" @NodeArgs 2>&1)
            $code = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
        }
        finally {
            Pop-Location
            $ErrorActionPreference = $previousPreference
        }
        return [ordered]@{ lines = $lines; exitCode = $code }
    }
    finally {
        foreach ($name in $names) {
            [Environment]::SetEnvironmentVariable($name, $before[$name], "Process")
        }
    }
}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Text)
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding $false))
}

function Invoke-Schtasks {
    # Run schtasks.exe and RETURN ITS EXIT CODE. A native nonzero exit (e.g.
    # "ERROR: Access is denied." -> 1) does not throw in PowerShell, so a caller
    # that ignores the code cannot tell a refused change from an applied one —
    # which is exactly how `disable` used to print success over a denied
    # /Change. ErrorActionPreference is Continue for the call so a stderr line
    # cannot be promoted to a terminating error that hides the code.
    param([string[]]$Arguments)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $code = 0
    try {
        & schtasks.exe @Arguments
        $code = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
    }
    catch {
        # A native invocation should not throw; if the host wrapped stderr into a
        # terminating error, that is still a failed operation, not a success.
        $code = 1
    }
    finally {
        $ErrorActionPreference = $prev
    }
    return $code
}

function Invoke-PauseNote {
    # THE RUNNER'S OWN RECORD THAT IT WAS STOPPED (OR STARTED) ON PURPOSE.
    # (ADM-5, 9.4.26 admin feedback.) Appends a PAUSE_RUNNER / RESUME_RUNNER
    # intent through scripts/runner-pause-note.mts so the dashboard can tell a
    # deliberate stop from a crash. BEST EFFORT: it runs after the action's
    # real work, every failure is printed, and nothing here changes the
    # action's exit code - a stop is never blocked by a note about the stop.
    # ErrorActionPreference is Continue for the call so a stderr line cannot be
    # promoted to a terminating error, exactly as Invoke-Schtasks does.
    param($Runtime, [string]$IntentAction, [string]$Note, [string]$By)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $noteArgs = @(
            "--experimental-strip-types",
            "scripts/runner-pause-note.mts",
            "--action=$IntentAction",
            "--note=$Note",
            "--by=$By"
        )
        $result = Invoke-RuntimeNodeWithAuthority -Runtime $Runtime -Capability "OWNER_DISPATCH" -NodeArgs $noteArgs
        foreach ($line in @($result.lines)) { Write-Output "  $line" }
        if ($result.exitCode -ne 0) {
            Write-Output "  pause note exited $($result.exitCode) ($IntentAction); the note is best effort and the action above stands."
        }
    }
    catch {
        Write-Output "  pause note NOT recorded ($IntentAction): $($_.Exception.Message). Best effort; the action above stands."
    }
    finally {
        $ErrorActionPreference = $prev
    }
}

function Write-TriggerLines {
    param($Facts)
    if (-not $Facts.taskPresent) { return }
    if ($Facts.triggers.Count -eq 0) { Write-Output "  triggers:        NONE" }
    foreach ($t in $Facts.triggers) {
        $rep = if ($null -ne $t.repetitionInterval) { "repeat every $($t.repetitionInterval) for $(if ($null -ne $t.repetitionDuration) { $t.repetitionDuration } else { 'indefinitely' })" } else { "no repetition" }
        Write-Output "  trigger:         $($t.type)  enabled=$($t.enabled)  $rep"
    }
    # A DISABLED task fires NO trigger, so a relaunch-trigger DEFINITION on a
    # disabled task is inert. Reporting "comes back within N minutes" for a
    # disabled task is the false claim this branch exists to prevent: task-level
    # disable and trigger-level presence are different facts and never collapse.
    $taskDisabled = ($Facts.state -eq "Disabled")
    if ($taskDisabled) {
        if ($Facts.relaunchTriggerPresent) {
            Write-Output "  TASK IS DISABLED: it still CARRIES a relaunch trigger definition, but a disabled task fires no trigger, so it will NOT relaunch the runner. The definition is inert until the task is re-enabled."
        }
        else {
            Write-Output "  TASK IS DISABLED: it will not start the runner at logon or on any trigger."
        }
    }
    elseif ($Facts.relaunchTriggerPresent) {
        Write-Output "  RELAUNCH TRIGGER IS PRESENT: a killed runner comes back within $RelaunchIntervalMinutes minutes."
    }
    else {
        Write-Output "  RELAUNCH TRIGGER IS ABSENT: a killed runner stays down until a logon or pnpm pilot:start."
        Write-Output "  Add it from an ELEVATED PowerShell in the repo: $ElevatedOneLiner"
    }
}

switch ($Action) {
    "validate-config" {
        $resolved = Resolve-RuntimeConfig
        Write-Output "RUNTIME CONFIG VALID"
        Write-Output "  repository:      $($resolved.repoPath)"
        Write-Output "  environment:     $($resolved.envFile) (path only; contents were not read)"
        Write-Output "  deployed SHA:    $($resolved.expectedSha)"
    }

    "owner-command" {
        # This is the only package-visible route to an owner-triggered
        # production child. The package wrapper contributes no authority: the
        # live host configuration, installed code identity and exact running
        # parent are all read back here before the installed dispatcher starts.
        if ([string]::IsNullOrWhiteSpace($OwnerCommandPayload) -or
            $OwnerCommandPayload.Length -gt 32768 -or
            $OwnerCommandPayload -notmatch '^[A-Za-z0-9+/]+={0,2}$') {
            throw "owner command payload is absent, oversized, or not canonical base64"
        }
        $active = Resolve-ActiveRuntimeOrThrow
        $runtime = $active.runtime
        $parent = Read-OnlyVerifiedRunnerOrThrow -Runtime $runtime -Required $true
        $dispatch = Join-Path $runtime.repoPath "scripts\installed-runtime-dispatch.mts"
        if (-not (Test-Path -LiteralPath $dispatch -PathType Leaf)) {
            throw "the validated installed runtime lacks its closed owner dispatcher"
        }
        $nodeArgs = @(
            "--experimental-strip-types",
            "scripts/installed-runtime-dispatch.mts",
            "--payload=$OwnerCommandPayload"
        )
        $result = Invoke-RuntimeNodeWithAuthority -Runtime $runtime -Capability "OWNER_DISPATCH" -NodeArgs $nodeArgs
        foreach ($line in @($result.lines)) { Write-Output $line }
        if ($result.exitCode -ne 0) {
            Write-Output "OWNER COMMAND REFUSED: installed dispatcher exited $($result.exitCode)."
            exit $result.exitCode
        }
        Write-Output "owner command completed through verified runtime $($runtime.expectedSha), standing parent pid $($parent.ProcessId), and the closed installed dispatcher"
    }

    "install" {
        $resolved = Resolve-RuntimeConfig
        # Cutover cleanup is part of installation. An older release may have
        # registered a second daily task for the nightly research window; new
        # runtime authority does not start until that obsolete clock is gone.
        Remove-LegacyWindowTaskOrThrow
        $powershell = Get-PowerShellPath
        $launcherArgs = Get-LauncherArgs
        $taskLanded = $false
        $refusal = $null

        try {
            $taskAction = New-ScheduledTaskAction -Execute $powershell -Argument $launcherArgs -WorkingDirectory $RepoPath
            # Trigger 1: every logon, which includes every logon after a reboot.
            $logonTrigger = New-ScheduledTaskTrigger -AtLogOn
            # Trigger 2: the RELAUNCH trigger. Fires every 5 minutes for 3650
            # days; IgnoreNew makes it a no-op while the runner lives.
            $relaunchTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
                -RepetitionInterval (New-TimeSpan -Minutes $RelaunchIntervalMinutes) `
                -RepetitionDuration (New-TimeSpan -Days $RelaunchDurationDays)
            # RestartCount/RestartInterval are kept but are NOT the relaunch path
            # (measured: they do not fire for an externally killed process).
            # ExecutionTimeLimit 0 means never kill it for running long.
            $taskSettings = New-ScheduledTaskSettingsSet `
                -AllowStartIfOnBatteries `
                -DontStopIfGoingOnBatteries `
                -StartWhenAvailable `
                -RestartCount 999 `
                -RestartInterval (New-TimeSpan -Minutes 5) `
                -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
                -MultipleInstances IgnoreNew
            $taskPrincipal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

            Register-ScheduledTask -TaskName $TaskName -Action $taskAction `
                -Trigger @($logonTrigger, $relaunchTrigger) `
                -Settings $taskSettings -Principal $taskPrincipal -Force | Out-Null
            $taskLanded = $true
        }
        catch {
            $refusal = $_.Exception.Message
            Write-Output "SCHEDULED TASK REFUSED: $refusal"
            Write-Output "  The Task Scheduler service on this host will not accept a registration"
            Write-Output "  from an unelevated shell. That is a WALL, named. The per-user startup"
            Write-Output "  entry below is installed only if no active Scheduled Task remains; it survives a reboot and does NOT"
            Write-Output "  relaunch a killed runner. To get the task with both triggers, run this"
            Write-Output "  ONCE from an ELEVATED PowerShell in $RepoPath :"
            Write-Output "    $ElevatedOneLiner"
        }

        # Judge the live end state even after a refused registration: an older
        # active task may still exist, and installing Startup beside it would
        # create the exact dual clock this action must prevent.
        $facts = Get-TaskFacts
        if ($facts.taskPresent -and $facts.state -ne "Disabled") {
            if (-not $facts.relaunchTriggerPresent) {
                throw "SCHEDULED TASK READBACK FAILED: an active task exists without its required relaunch trigger. No competing Startup clock was installed."
            }
            $actionMatches = (Test-SameResolvedPath $facts.executable $powershell) -and
                (Test-SameResolvedPath $facts.workingDirectory $RepoPath) -and
                ([string]$facts.arguments -eq [string]$launcherArgs)
            if (-not $actionMatches) {
                throw "SCHEDULED TASK READBACK FAILED: the active task does not name the stable launcher, validated clean repository, and absolute environment path. No competing Startup clock was installed."
            }
            $taskLanded = $true
        }
        elseif ($taskLanded) {
            throw "SCHEDULED TASK READBACK FAILED: registration reported success but no active task exists. No Startup clock was installed."
        }
        $file = $null
        if ($taskLanded) {
            # One clock, structurally. Leaving the old fallback beside a live
            # AtLogOn task would launch two independent writers at logon.
            Remove-StartupEntryOrThrow
        }
        else {
            $file = Install-StartupEntry -PowerShell $powershell -LauncherArgs $launcherArgs
        }

        Write-Output ""
        Write-Output "INSTALLED"
        if ($taskLanded) {
            # What LANDED is read back from the live task, not from what was asked.
            Write-Output "  scheduled task:  $TaskName  state=$($facts.state)"
            Write-TriggerLines $facts
        }
        else {
            Write-Output "  scheduled task:  REFUSED - see above"
        }
        if ($taskLanded) {
            Write-Output "  startup entry:   ABSENT (the live Scheduled Task is the only logon clock)"
        }
        else {
            Write-Output "  startup entry:   $file  (fallback runs at logon; no Scheduled Task authority was proven)"
        }
        Write-Output "  runs:            $powershell $launcherArgs"
        Write-Output "  in:              $RepoPath"
        Write-Output "  digest:          `$WTP_MIRROR\pilot-digest.md  (default G:\My Drive\we-the-people)"
        Write-Output "  start it now:    pnpm pilot:start"
        if (-not $taskLanded) { exit 1 }
    }

    "start" {
        if (Get-ScheduledTask -TaskName $LegacyWindowTaskName -ErrorAction SilentlyContinue) {
            throw "the retired Scheduled Task '$LegacyWindowTaskName' is still installed; refusing to start while a second clock remains"
        }
        $hasExplicitConfig = -not [string]::IsNullOrWhiteSpace($RepoPath) -and
            -not [string]::IsNullOrWhiteSpace($EnvFile) -and
            -not [string]::IsNullOrWhiteSpace($ExpectedDeployedSha)
        $requested = $null
        if ($hasExplicitConfig) {
            if ($IntervalMinutes -lt 1) { throw "IntervalMinutes must be at least 1" }
            $resolved = Resolve-RuntimeConfig
            Assert-CurrentInstallerMatchesRuntimeHead -RuntimeRepo $resolved.repoPath -RuntimeHead $resolved.expectedSha
            $requested = [ordered]@{
                repoPath        = [string]$resolved.repoPath
                envFile         = [string]$resolved.envFile
                expectedSha     = [string]$resolved.expectedSha
                intervalMinutes = $IntervalMinutes
                launcher        = Join-Path $resolved.repoPath "scripts\pilot-runtime-launch.ps1"
                launcherArgs    = Get-LauncherArgs
            }
        }

        # Resolve the installed entrypoint BEFORE looking at or starting a
        # process. A fixed task name is not identity: an old task can point at
        # transition code, a mutable branch, or a different secret/config.
        $facts = Get-TaskFacts
        $runtime = $null
        $entrypoint = ""
        if ($facts.taskPresent) {
            $runtime = Resolve-TaskRuntimeOrThrow $facts
            $entrypoint = "Scheduled Task"
        }
        elseif (Test-Path -LiteralPath $StartupFile -PathType Leaf) {
            $runtime = Resolve-StartupRuntimeOrThrow
            $entrypoint = "Startup fallback"
        }
        elseif ($requested -ne $null) {
            $runtime = $requested
            $entrypoint = "explicit direct launch"
        }
        else {
            throw "no validated installed entrypoint exists; supply RepoPath, EnvFile, and ExpectedDeployedSha or run pnpm pilot:install first"
        }

        if ($requested -ne $null) {
            if (-not (Test-SameResolvedPath $requested.repoPath $runtime.repoPath) -or
                -not (Test-SameResolvedPath $requested.envFile $runtime.envFile) -or
                $requested.expectedSha -ne $runtime.expectedSha -or
                $requested.intervalMinutes -ne $runtime.intervalMinutes) {
                throw "the explicit start configuration disagrees with the installed entrypoint; refusing competing runtime authorities"
            }
        }

        $identity = Read-RunnerIdentity $runtime
        if ($identity.all.Count -gt 0) {
            if ($identity.all.Count -ne 1 -or $identity.matching.Count -ne 1) {
                $allPids = @($identity.all | ForEach-Object { [int]$_.ProcessId })
                throw "a runner-like process already exists but does not uniquely match the validated permanent runtime (pids $($allPids -join ', ')); no second process was launched"
            }
            $verified = $identity.matching[0]
            Write-Output "already running: verified permanent pilot-runner pid $($verified.ProcessId); no second process launched"
        }
        else {
            if ($entrypoint -eq "Scheduled Task") {
                $runCode = Invoke-Schtasks @("/Run", "/TN", $TaskName)
                if ($runCode -ne 0) { throw "schtasks /Run refused the validated task (exit $runCode)" }
            }
            else {
                $powershell = Get-PowerShellPath
                Start-Process -FilePath $powershell -ArgumentList $runtime.launcherArgs -WorkingDirectory $runtime.repoPath -WindowStyle Hidden
            }
            $verified = Wait-ForVerifiedRunnerOrThrow -Runtime $runtime
            Write-Output "started: verified permanent pilot-runner pid $($verified.ProcessId) through $entrypoint"
        }

        # A RESUME intent is written only after a uniquely matching permanent
        # process is observable. A refused or stale start must not fabricate an
        # owner-visible claim that the runtime resumed.
        Invoke-PauseNote -IntentAction "RESUME_RUNNER" -Note "pnpm pilot:start on $env:COMPUTERNAME" -By "pilot:start" -Runtime $runtime
        Write-Output "runtime identity: repo $($runtime.repoPath); SHA $($runtime.expectedSha); interval $($runtime.intervalMinutes)m; release handoff enabled"
    }

    "stop" {
        $active = Resolve-ActiveRuntimeOrThrow
        $runtime = $active.runtime
        [void](Read-OnlyVerifiedRunnerOrThrow -Runtime $runtime -Required $false)
        $roots = @(Get-RunnerProcesses)
        $stopped = Stop-RunnerProcessTrees -Roots $roots
        if ($active.entrypoint -eq "Scheduled Task") { [void](Invoke-Schtasks @("/End", "/TN", $TaskName)) }
        if ($stopped.problems.Count -gt 0 -or @(Get-RunnerProcesses).Count -ne 0) {
            throw "one or more pilot-runner process trees remained after stop: $($stopped.problems -join ' ')"
        }
        Invoke-PauseNote -IntentAction "PAUSE_RUNNER" -Note "pnpm pilot:stop on $env:COMPUTERNAME" -By "pilot:stop" -Runtime $runtime
        Write-Output "stopped: $($stopped.capturedPids.Count) process-tree member(s) terminated and read back absent. The enabled task may return at its next trigger; use pnpm pilot:disable for a durable pause."
    }

    "disable" {
        # THE VERDICT IS THE MEASURED END STATE, NEVER THE FACT THAT COMMANDS RAN.
        # `schtasks /Change /DISABLE` answers "Access is denied" (exit 1) from an
        # unelevated shell and does NOT throw, so issuing it proves nothing. We
        # capture every schtasks exit code, then re-derive the live task and
        # refuse to print success unless the task is actually Disabled or absent,
        # no runner process remains, and the startup fallback is gone.
        $runtime = $null
        $before = Get-TaskFacts
        if ($before.taskPresent -and $before.state -eq "Disabled" -and -not $before.startupEntryPresent) {
            $runtime = Resolve-TaskRuntimeOrThrow $before -AllowDisabled
        }
        elseif ($before.taskPresent -or $before.startupEntryPresent -or $before.runningPids.Count -gt 0) {
            $active = Resolve-ActiveRuntimeOrThrow
            $runtime = $active.runtime
            [void](Read-OnlyVerifiedRunnerOrThrow -Runtime $runtime -Required $false)
        }

        $schtasksProblems = @()
        if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
            $disableCode = Invoke-Schtasks @("/Change", "/TN", $TaskName, "/DISABLE")
            if ($disableCode -ne 0) {
                $schtasksProblems += "schtasks /Change /DISABLE exited $disableCode (Access is denied (1) means it needs an ELEVATED shell; the task is still enabled)."
            }
            # Disable the clock before terminating its process tree. Otherwise
            # the five-minute relaunch trigger can race the descendant census.
            $roots = @(Get-RunnerProcesses)
            $treeStop = Stop-RunnerProcessTrees -Roots $roots
            foreach ($problem in @($treeStop.problems)) { $schtasksProblems += $problem }
            $endCode = Invoke-Schtasks @("/End", "/TN", $TaskName)
            # /End refusing is not on its own fatal — the task may not be running,
            # and taskkill /T above kills the full process tree — but a nonzero
            # code is still recorded rather than swallowed.
            if ($endCode -ne 0) {
                $schtasksProblems += "schtasks /End exited $endCode."
            }
        }
        else {
            $treeStop = Stop-RunnerProcessTrees
            foreach ($problem in @($treeStop.problems)) { $schtasksProblems += $problem }
        }

        $killProblems = @()
        if (Test-Path $StartupFile) {
            try { Remove-Item $StartupFile -Force -ErrorAction Stop }
            catch { $killProblems += "could not remove the startup entry $StartupFile : $($_.Exception.Message)" }
        }

        # The owner's own record that this stop was deliberate (ADM-5). Best
        # effort; the verdict below is measured, never inferred from this.
        if ($null -ne $runtime) {
            Invoke-PauseNote -IntentAction "PAUSE_RUNNER" -Note "pnpm pilot:disable on $env:COMPUTERNAME" -By "pilot:disable" -Runtime $runtime
        }

        # Re-derive the live state AFTER acting, and judge on that alone.
        $facts = Get-TaskFacts
        $taskDown  = (-not $facts.taskPresent) -or ($facts.state -eq "Disabled")
        $noProcs   = $facts.runningPids.Count -eq 0
        $noStartup = -not (Test-Path $StartupFile)

        if ($taskDown -and $noProcs -and $noStartup) {
            if (-not $facts.taskPresent) {
                Write-Output "disabled: no scheduled task is present, no pilot-runner process is running, and the startup entry is gone."
            }
            else {
                Write-Output "disabled: the scheduled task is Disabled, no pilot-runner process is running, and the startup entry is gone."
                if ($facts.relaunchTriggerPresent) {
                    Write-Output "  note: the task still carries a relaunch trigger definition, but a DISABLED task fires no trigger, so it will NOT relaunch the runner."
                }
            }
            exit 0
        }

        # A partial shutdown. Name exactly what is still up and FAIL — never a
        # success sentence over a task that is still enabled or a runner still alive.
        Write-Output "DISABLE INCOMPLETE - the runner is NOT safely stopped:"
        if (-not $taskDown) {
            Write-Output "  - the scheduled task is still '$($facts.state)', not Disabled; it will start the runner again at the next logon or trigger."
            if ($facts.relaunchTriggerPresent) {
                Write-Output "    its relaunch trigger is still live: a killed runner would come back within $RelaunchIntervalMinutes minutes."
            }
        }
        foreach ($p in $schtasksProblems) { Write-Output "  - $p" }
        if (-not $noProcs) {
            Write-Output "  - $($facts.runningPids.Count) pilot-runner process(es) still running: $($facts.runningPids -join ', ')."
        }
        foreach ($p in $killProblems) { Write-Output "  - $p" }
        if (-not $noStartup) {
            Write-Output "  - the startup entry is still present at $StartupFile; it would start the runner at the next logon."
        }
        if (-not $taskDown) {
            Write-Output "  Disable the task from an ELEVATED PowerShell in $RepoPath :"
            Write-Output "    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action disable"
        }
        exit 1
    }

    "uninstall" {
        $deleteProblems = @()
        $roots = @(Get-RunnerProcesses)
        foreach ($name in @($TaskName, $LegacyWindowTaskName)) {
            if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
                $deleteCode = Invoke-Schtasks @("/Delete", "/TN", $name, "/F")
                if ($deleteCode -ne 0) { $deleteProblems += "schtasks /Delete for '$name' exited $deleteCode." }
            }
        }
        $treeStop = Stop-RunnerProcessTrees -Roots $roots
        foreach ($problem in @($treeStop.problems)) { $deleteProblems += $problem }
        if (Test-Path $StartupFile) { Remove-Item $StartupFile -Force }
        $remainingTasks = @()
        foreach ($name in @($TaskName, $LegacyWindowTaskName)) {
            if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
                $remainingTasks += $name
            }
        }
        $remainingProcesses = @((Get-RunnerProcesses)).Count
        if ($deleteProblems.Count -gt 0 -or $remainingTasks.Count -gt 0 -or (Test-Path $StartupFile) -or $remainingProcesses -gt 0) {
            Write-Output "UNINSTALL INCOMPLETE - obsolete launch authority remains:"
            foreach ($problem in $deleteProblems) { Write-Output "  - $problem" }
            foreach ($name in $remainingTasks) { Write-Output "  - Scheduled Task '$name' is still present." }
            if (Test-Path $StartupFile) { Write-Output "  - startup entry is still present at $StartupFile." }
            if ($remainingProcesses -gt 0) { Write-Output "  - $remainingProcesses pilot-runner process(es) are still running." }
            exit 1
        }
        Write-Output "uninstalled: standing task and retired nightly-window task absent; no startup entry or runner process remains."
    }

    "status" {
        $facts = Get-TaskFacts
        $problems = @()
        $runtime = $null
        $verifiedProcess = $null

        if (Get-ScheduledTask -TaskName $LegacyWindowTaskName -ErrorAction SilentlyContinue) {
            $problems += "the retired Scheduled Task '$LegacyWindowTaskName' is still installed"
        }
        try {
            if ($facts.taskPresent -and $facts.state -ne "Disabled") {
                $runtime = Resolve-TaskRuntimeOrThrow $facts
            }
            elseif (Test-Path -LiteralPath $StartupFile -PathType Leaf) {
                $runtime = Resolve-StartupRuntimeOrThrow
            }
            elseif ($facts.taskPresent) {
                # A disabled current task is inert, but its action is still
                # validated so status never blesses a stale task that could be
                # re-enabled later.
                $runtime = Resolve-TaskRuntimeOrThrow $facts -AllowDisabled
            }
        }
        catch {
            $problems += $_.Exception.Message
        }

        if ($null -ne $runtime) {
            try { $verifiedProcess = Read-OnlyVerifiedRunnerOrThrow -Runtime $runtime -Required $false }
            catch { $problems += $_.Exception.Message }
        }
        elseif ($facts.runningPids.Count -gt 0) {
            $problems += "runner-like processes exist without a validated installed runtime"
        }

        if (-not $facts.taskPresent) {
            Write-Output "scheduled task:  NOT REGISTERED (refused without elevation on this host)"
        }
        else {
            Write-Output "scheduled task:  $($facts.state), last run $($facts.lastRunTime), last result $($facts.lastTaskResult)"
            Write-TriggerLines $facts
        }

        if (Test-Path $StartupFile) {
            Write-Output "startup entry:   PRESENT at $StartupFile"
        }
        else {
            Write-Output "startup entry:   ABSENT. That is an absence of a mechanism, not a statement"
            Write-Output "                 that the pilot is idle. `pnpm pilot:install` installs it."
        }

        if (Get-ScheduledTask -TaskName $LegacyWindowTaskName -ErrorAction SilentlyContinue) {
            Write-Output "legacy window:   PRESENT - obsolete second clock; run pnpm pilot:uninstall or reinstall from an elevated shell"
        }
        else {
            Write-Output "legacy window:   ABSENT (the standing runner owns the single nightly research clock)"
        }

        if ($facts.taskPresent -and $facts.state -ne "Disabled" -and $facts.startupEntryPresent) {
            Write-Output "ENTRYPOINT CONFLICT: the live Scheduled Task and Startup entry can both launch the runner. Run pnpm pilot:install with the authority required to update the task; install must remove the fallback."
        }

        if ($null -ne $verifiedProcess) {
            Write-Output "running now:     VERIFIED permanent pilot-runner pid $($verifiedProcess.ProcessId)"
        }
        elseif ($facts.runningPids.Count -eq 0) {
            Write-Output "running now:     0 pilot-runner processes"
        }
        else {
            Write-Output "running now:     UNVERIFIED runner-like pid(s) $($facts.runningPids -join ', ')"
        }
        if ($null -ne $runtime) {
            Write-Output "runtime:         VERIFIED clean detached checkout $($runtime.repoPath) at $($runtime.expectedSha)"
        }

        $mirror = if ($env:WTP_MIRROR) { $env:WTP_MIRROR } else { "G:\My Drive\we-the-people" }
        $digest = Join-Path $mirror "pilot-digest.md"
        if (Test-Path $digest) {
            Write-Output "digest:          $digest  (last written $((Get-Item $digest).LastWriteTime))"
        }
        else {
            Write-Output "digest:          NOT PRESENT at $digest - no cycle has delivered one yet"
        }
        if ($problems.Count -gt 0) {
            Write-Output "STATUS REFUSED - permanent authority was not proven:"
            foreach ($problem in $problems) { Write-Output "  - $problem" }
            exit 1
        }
    }

    "verify-triggers" {
        # Read-only. Exit 0 only for one live, crash-relaunching entrypoint,
        # the exact stable installed checkout, and one matching parent process.
        $facts = Get-TaskFacts
        try {
            if (Get-ScheduledTask -TaskName $LegacyWindowTaskName -ErrorAction SilentlyContinue) {
                throw "the retired nightly-window task is still installed"
            }
            $runtime = Resolve-TaskRuntimeOrThrow $facts
            $verified = Read-OnlyVerifiedRunnerOrThrow -Runtime $runtime -Required $true
            $record = [ordered]@{
                facts                   = $facts
                runtimeSha              = $runtime.expectedSha
                runtimeRepository       = $runtime.repoPath
                stableLauncherVerified  = $true
                processIdentityVerified = $true
                processId               = [int]$verified.ProcessId
                verdict                 = "VERIFIED"
            }
            Write-Output (ConvertTo-Json $record -Depth 6)
            exit 0
        }
        catch {
            $record = [ordered]@{
                facts                   = $facts
                stableLauncherVerified  = $false
                processIdentityVerified = $false
                verdict                 = "REFUSED"
                detail                  = $_.Exception.Message
            }
            Write-Output (ConvertTo-Json $record -Depth 6)
            exit 1
        }
    }

    "prove-relaunch" {
        # THE ACCEPTANCE MEASUREMENT. Kills the runner and waits for the task to
        # bring a NEW, identity-matching pid back. Refuses when the task,
        # launcher, checkout or initial process is not the permanent authority.
        $facts = Get-TaskFacts
        if (-not $facts.taskPresent) {
            Write-Output "REFUSED: the scheduled task '$TaskName' is not registered; nothing would relaunch a killed runner."
            exit 2
        }
        if (-not $facts.singleEntrypoint) {
            Write-Output "REFUSED: one active Scheduled Task with its relaunch trigger and NO competing Startup entry was not proven. Killing the runner now"
            Write-Output "  could leave it down or relaunch competing writers. Repair the entrypoint first, from an ELEVATED"
            Write-Output "  PowerShell in $RepoPath :"
            Write-Output "    $ElevatedOneLiner"
            exit 2
        }
        if (Get-ScheduledTask -TaskName $LegacyWindowTaskName -ErrorAction SilentlyContinue) {
            Write-Output "REFUSED: the retired nightly-window task is still installed; killing now could leave competing operational clocks."
            exit 2
        }
        try {
            $runtime = Resolve-TaskRuntimeOrThrow $facts
            $verifiedBefore = Read-OnlyVerifiedRunnerOrThrow -Runtime $runtime -Required $true
        }
        catch {
            Write-Output "REFUSED: the live task/runtime/process did not prove permanent identity: $($_.Exception.Message)"
            exit 2
        }
        $ProofFile = Join-Path $runtime.repoPath ".runtime\ops\runner-relaunch-proof.json"

        $killedPid = [int]$verifiedBefore.ProcessId
        $measuredAt = (Get-Date).ToUniversalTime().ToString("o")
        Write-Output "killing pilot-runner pid $killedPid at $measuredAt"
        $treeStop = Stop-RunnerProcessTrees -Roots @($verifiedBefore)
        if ($treeStop.problems.Count -gt 0 -or $treeStop.remainingPids.Count -gt 0) {
            Write-Output "REFUSED: the old runner process tree was not fully terminated: $($treeStop.problems -join ' ')"
            exit 2
        }
        $t0 = Get-Date

        $relaunchedPid = $null
        $seconds = $null
        $identityFailure = $null
        $deadline = $t0.AddMinutes(8)
        while ($null -eq $relaunchedPid -and $null -eq $identityFailure -and (Get-Date) -lt $deadline) {
            Start-Sleep -Seconds 15
            $elapsed = [int][math]::Round(((Get-Date) - $t0).TotalSeconds)
            $identity = Read-RunnerIdentity $runtime
            $freshMatching = @($identity.matching | Where-Object { [int]$_.ProcessId -ne $killedPid })
            if ($identity.all.Count -gt 0 -and
                ($identity.all.Count -ne 1 -or $freshMatching.Count -ne 1)) {
                $allPids = @($identity.all | ForEach-Object { [int]$_.ProcessId })
                $matchingPids = @($freshMatching | ForEach-Object { [int]$_.ProcessId })
                $identityFailure = "runner identity mismatch after relaunch: named [$($allPids -join ', ')], fresh exact matches [$($matchingPids -join ', ')]"
                Write-Output "  +${elapsed}s: $identityFailure"
            }
            elseif ($freshMatching.Count -eq 1) {
                $relaunchedPid = [int]$freshMatching[0].ProcessId
                $seconds = $elapsed
                Write-Output "  +${elapsed}s: NEW verified permanent pilot-runner pid $relaunchedPid"
            }
            else {
                Write-Output "  +${elapsed}s: no new verified permanent pilot-runner process yet"
            }
        }

        $after = Get-TaskFacts
        $stableAfter = $false
        $afterDetail = $identityFailure
        try {
            $runtimeAfter = Resolve-TaskRuntimeOrThrow $after
            $stableAfter = (Test-SameResolvedPath $runtime.repoPath $runtimeAfter.repoPath) -and
                (Test-SameResolvedPath $runtime.envFile $runtimeAfter.envFile) -and
                $runtime.expectedSha -eq $runtimeAfter.expectedSha -and
                $runtime.intervalMinutes -eq $runtimeAfter.intervalMinutes
            if (-not $stableAfter) { $afterDetail = "the task/runtime configuration changed during the proof" }
            if ($null -ne $relaunchedPid) {
                $finalIdentity = Read-OnlyVerifiedRunnerOrThrow -Runtime $runtimeAfter -Required $true
                if ([int]$finalIdentity.ProcessId -ne $relaunchedPid) {
                    $afterDetail = "the final exact process identity does not equal the observed relaunch pid"
                    $relaunchedPid = $null
                }
            }
        }
        catch {
            $stableAfter = $false
            $afterDetail = $_.Exception.Message
            $relaunchedPid = $null
        }
        $relaunchVerified = $null -ne $relaunchedPid -and $stableAfter -and $null -eq $afterDetail
        $record = [ordered]@{
            measuredAt             = $measuredAt
            killedPid              = $killedPid
            relaunchedPid          = $relaunchedPid
            secondsToRelaunch      = $seconds
            runtimeSha             = $runtime.expectedSha
            runtimeRepository      = $runtime.repoPath
            stableLauncherVerified = [bool]$stableAfter
            processIdentityVerified = [bool]$relaunchVerified
            relaunchTriggerPresent = [bool]$after.relaunchTriggerPresent
            taskStateAfter         = $after.state
            lastTaskResult         = $after.lastTaskResult
            detail                 = $afterDetail
            verdict                = $(if ($relaunchVerified) { "RELAUNCHED" } else { "NOT_RELAUNCHED" })
        }
        $json = ConvertTo-Json $record -Depth 3
        Write-Utf8NoBom -Path $ProofFile -Text ($json + "`n")
        Write-Output ""
        Write-Output $json
        Write-Output "written: $ProofFile"
        if ($record.verdict -eq "RELAUNCHED") { exit 0 } else { exit 1 }
    }
}
