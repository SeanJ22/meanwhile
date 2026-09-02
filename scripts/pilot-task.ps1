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
       the refusal verbatim, installs the per-user startup entry, and prints
       the exact elevated command the owner runs once.

    5. The per-user startup entry (%APPDATA%\...\Startup\wtp-pilot-runner.cmd)
       is the unelevated fallback: it survives a reboot; it does NOT relaunch a
       killed runner.

    6. `prove-relaunch` KILLS the runner to measure the relaunch. It refuses
       (exit 2) unless the relaunch trigger is present on the live task, because
       killing the runner then leaves nothing to bring it back.

    THE COMMANDS
    ------------
        pnpm pilot:install     register the task with BOTH triggers, or print why
                               not; write the startup entry either way
        pnpm pilot:start       start the runner NOW, without waiting for a logon
        pnpm pilot:stop        stop the running runner
        pnpm pilot:status      what is installed, every trigger, whether the
                               RELAUNCH TRIGGER is present, whether it is running
        pnpm pilot:disable     stop it AND stop it coming back at logon
        pnpm pilot:uninstall   remove both mechanisms entirely

    Without pnpm, from any shell in the repository:

        powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action status
        powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action verify-triggers
            read-only JSON; exit 0 when the relaunch trigger is present, else 1
        powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action prove-relaunch
            kills the runner, polls every 15 s for up to 8 min for a NEW pid,
            writes data/ops/runner-relaunch-proof.json beside this script's repo

    The elevated one-liner, run ONCE from an elevated PowerShell in the repo:

        powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action install

    WHAT IT RUNS
    ------------
    `node --env-file=.env.local --experimental-strip-types scripts/pilot-runner.mts --interval=<n>`
    with the repository as its working directory. `--env-file` is how
    `WTP_CONTROL_PLANE_DATABASE_URL` reaches the process; the file is
    gitignored, only its PATH is written anywhere, and no value of any variable
    is written into the task, the startup entry, the log, the digest or any
    record this script writes.

    PROMOTION STAYS OFF. The runner passes no flag that could promote anything,
    and `runCycle` has no parameter that would accept one.

    WHERE THE OWNER READS IT
    ------------------------
    `G:\My Drive\we-the-people\pilot-digest.md` - overwritten each cycle, with
    every cycle's headline appended to `pilot-digest-log.md` beside it. The
    Drive mirror is a synced folder, so writing the file IS the delivery.
    Set WTP_MIRROR to move it.
#>

param(
    [ValidateSet("install", "start", "stop", "status", "disable", "uninstall", "verify-triggers", "prove-relaunch", "install-window")]
    [string]$Action = "status",

    # The repository the runner runs in. Defaults to the main checkout rather
    # than to wherever this script happens to sit, because a mechanism pointed
    # at a temporary worktree stops working the moment that worktree is removed.
    [string]$RepoPath = "C:\Users\seanj\dev\we-the-people",

    # Minutes between cycles.
    [int]$IntervalMinutes = 60
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

# Records this script writes land beside the script's OWN repository, which is
# the checkout a session commits from; $RepoPath is where the runner runs.
$ScriptRepo = Split-Path -Parent $PSScriptRoot
$ProofFile  = Join-Path $ScriptRepo "data\ops\runner-relaunch-proof.json"

$ElevatedOneLiner = "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action install"

# THE NIGHTLY WINDOW'S BACKUP WAKEUP (RULING 242). The window itself runs on
# the pilot runner's own clock at 04:00 America/New_York; this task only nudges
# a live runner with a RUN_WINDOW_NOW intent, or runs the window under the
# lease if the runner is dead. Registered from an ELEVATED shell only, like the
# runner's task (invariant 4 above).
$WindowTaskName         = "WeThePeople Nightly Window"
$WindowEasternZoneId    = "Eastern Standard Time"
$WindowEasternHour      = 4
$WindowElevatedOneLiner = "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action install-window"

function Get-WindowArgs {
    return "--env-file=.env.local --experimental-strip-types scripts/nightly-window.mts --wakeup"
}

function Get-WindowLocalTimes {
    # 04:00 America/New_York expressed in THIS host's local clock, once for
    # standard time and once for daylight time. Task Scheduler triggers are
    # host-local; registering both distinct values means one of them lands on
    # 04:00 Eastern whichever rule is in force, and the other fires an hour
    # off — where `--wakeup` is a no-op because the window already ran.
    $eastern = [System.TimeZoneInfo]::FindSystemTimeZoneById($WindowEasternZoneId)
    $local   = [System.TimeZoneInfo]::Local
    $year    = (Get-Date).Year
    $times   = @()
    foreach ($probe in @((Get-Date -Year $year -Month 1 -Day 15), (Get-Date -Year $year -Month 7 -Day 15))) {
        $easternAt = New-Object DateTime($probe.Year, $probe.Month, $probe.Day, $WindowEasternHour, 0, 0, [DateTimeKind]::Unspecified)
        $localAt   = [System.TimeZoneInfo]::ConvertTime($easternAt, $eastern, $local)
        $times    += $localAt.ToString("HH:mm")
    }
    return @($times | Select-Object -Unique)
}

function Get-NodePath {
    $node = (Get-Command node -ErrorAction SilentlyContinue)
    if ($null -eq $node) { throw "node is not on PATH; the mechanism needs an absolute node path." }
    return $node.Source
}

function Get-RunnerArgs {
    return "--env-file=.env.local --experimental-strip-types scripts/pilot-runner.mts --interval=$IntervalMinutes"
}

function Install-StartupEntry {
    param([string]$Node, [string]$NodeArgs)
    # `start "" /min` detaches the runner from the logon script so Windows does
    # not hold the logon open on a process that never exits.
    $body = @"
@echo off
rem WeThePeople pilot runner - installed by scripts/pilot-task.ps1
rem Delete this file to stop the runner coming back at logon.
cd /d "$RepoPath"
start "" /min "$Node" $NodeArgs
"@
    Set-Content -Path $StartupFile -Value $body -Encoding ascii
    return $StartupFile
}

function Get-RunnerProcesses {
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
        Where-Object { $_.CommandLine -like "*pilot-runner.mts*" }
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
        lastRunTime            = $(if ($null -ne $info -and $info.LastRunTime -is [datetime] -and $info.LastRunTime.Year -gt 1) { $info.LastRunTime.ToString("o") } else { $null })
        lastTaskResult         = $(if ($null -ne $info) { ('0x{0:X8}' -f [uint32]$info.LastTaskResult) } else { $null })
        runningPids            = $pids
    }
}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Text)
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding $false))
}

function Write-TriggerLines {
    param($Facts)
    if (-not $Facts.taskPresent) { return }
    if ($Facts.triggers.Count -eq 0) { Write-Output "  triggers:        NONE" }
    foreach ($t in $Facts.triggers) {
        $rep = if ($null -ne $t.repetitionInterval) { "repeat every $($t.repetitionInterval) for $(if ($null -ne $t.repetitionDuration) { $t.repetitionDuration } else { 'indefinitely' })" } else { "no repetition" }
        Write-Output "  trigger:         $($t.type)  enabled=$($t.enabled)  $rep"
    }
    if ($Facts.relaunchTriggerPresent) {
        Write-Output "  RELAUNCH TRIGGER IS PRESENT: a killed runner comes back within $RelaunchIntervalMinutes minutes."
    }
    else {
        Write-Output "  RELAUNCH TRIGGER IS ABSENT: a killed runner stays down until a logon or pnpm pilot:start."
        Write-Output "  Add it from an ELEVATED PowerShell in the repo: $ElevatedOneLiner"
    }
}

switch ($Action) {
    "install" {
        if (-not (Test-Path $RepoPath)) { throw "repo path does not exist: $RepoPath" }
        $node = Get-NodePath
        $nodeArgs = Get-RunnerArgs
        $taskLanded = $false
        $refusal = $null

        try {
            $taskAction = New-ScheduledTaskAction -Execute $node -Argument $nodeArgs -WorkingDirectory $RepoPath
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
            Write-Output "  entry below is installed either way; it survives a reboot and does NOT"
            Write-Output "  relaunch a killed runner. To get the task with both triggers, run this"
            Write-Output "  ONCE from an ELEVATED PowerShell in $RepoPath :"
            Write-Output "    $ElevatedOneLiner"
        }

        $file = Install-StartupEntry -Node $node -NodeArgs $nodeArgs

        Write-Output ""
        Write-Output "INSTALLED"
        if ($taskLanded) {
            # What LANDED is read back from the live task, not from what was asked.
            $facts = Get-TaskFacts
            Write-Output "  scheduled task:  $TaskName  state=$($facts.state)"
            Write-TriggerLines $facts
        }
        else {
            Write-Output "  scheduled task:  REFUSED - see above"
        }
        Write-Output "  startup entry:   $file  (runs at every logon, including after a reboot)"
        Write-Output "  runs:            $node $nodeArgs"
        Write-Output "  in:              $RepoPath"
        Write-Output "  digest:          `$WTP_MIRROR\pilot-digest.md  (default G:\My Drive\we-the-people)"
        Write-Output "  start it now:    pnpm pilot:start"
        if (-not $taskLanded) { exit 1 }
    }

    "install-window" {
        # The BACKUP WAKEUP for the nightly window (RULING 242). Daily, at the
        # host-local equivalent(s) of 04:00 America/New_York, running
        # `nightly-window.mts --wakeup`. Refused unelevated on this host, like
        # `install`; the exact elevated one-liner is printed.
        if (-not (Test-Path $RepoPath)) { throw "repo path does not exist: $RepoPath" }
        $node = Get-NodePath
        $windowArgs = Get-WindowArgs
        $localTimes = @(Get-WindowLocalTimes)
        $windowLanded = $false

        try {
            $windowAction = New-ScheduledTaskAction -Execute $node -Argument $windowArgs -WorkingDirectory $RepoPath
            $windowTriggers = @()
            foreach ($t in $localTimes) {
                $windowTriggers += New-ScheduledTaskTrigger -Daily -At $t
            }
            $windowSettings = New-ScheduledTaskSettingsSet `
                -AllowStartIfOnBatteries `
                -DontStopIfGoingOnBatteries `
                -StartWhenAvailable `
                -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
                -MultipleInstances IgnoreNew
            $windowPrincipal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
            Register-ScheduledTask -TaskName $WindowTaskName -Action $windowAction `
                -Trigger $windowTriggers `
                -Settings $windowSettings -Principal $windowPrincipal -Force | Out-Null
            $windowLanded = $true
        }
        catch {
            Write-Output "SCHEDULED TASK REFUSED: $($_.Exception.Message)"
            Write-Output "  The Task Scheduler service on this host will not accept a registration"
            Write-Output "  from an unelevated shell. That is a WALL, named. The window still runs on"
            Write-Output "  the pilot runner's own clock at 04:00 America/New_York; only the BACKUP"
            Write-Output "  wakeup is missing. To register it, run this ONCE from an ELEVATED"
            Write-Output "  PowerShell in $RepoPath :"
            Write-Output "    $WindowElevatedOneLiner"
        }

        Write-Output ""
        Write-Output "NIGHTLY WINDOW BACKUP WAKEUP"
        Write-Output "  task:            $WindowTaskName  $(if ($windowLanded) { 'REGISTERED' } else { 'REFUSED - see above' })"
        Write-Output "  fires daily at:  $($localTimes -join ', ') host-local = 04:00 America/New_York (standard and daylight)"
        Write-Output "  runs:            $node $windowArgs"
        Write-Output "  in:              $RepoPath"
        Write-Output "  the clock:       the pilot runner (scripts/pilot-runner.mts) runs the window itself; this task only nudges it"
        if (-not $windowLanded) { exit 1 }
    }

    "start" {
        if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
            schtasks /Run /TN $TaskName
        }
        else {
            $node = Get-NodePath
            $nodeArgs = Get-RunnerArgs
            Start-Process -FilePath $node -ArgumentList $nodeArgs -WorkingDirectory $RepoPath -WindowStyle Minimized
            Write-Output "started (no scheduled task on this host; launched directly)"
        }
        Write-Output "running processes: $((Get-RunnerProcesses | Measure-Object).Count)"
    }

    "stop" {
        if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { schtasks /End /TN $TaskName }
        Get-RunnerProcesses | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
        Write-Output "stopped. It comes back at the next logon unless you also run pnpm pilot:disable."
    }

    "disable" {
        if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
            schtasks /End    /TN $TaskName
            schtasks /Change /TN $TaskName /DISABLE
        }
        Get-RunnerProcesses | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
        if (Test-Path $StartupFile) { Remove-Item $StartupFile -Force }
        Write-Output "disabled: the runner is stopped and will not return at logon."
    }

    "uninstall" {
        if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { schtasks /Delete /TN $TaskName /F }
        Get-RunnerProcesses | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
        if (Test-Path $StartupFile) { Remove-Item $StartupFile -Force }
        Write-Output "uninstalled: no scheduled task, no startup entry, no running process."
    }

    "status" {
        $facts = Get-TaskFacts
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

        Write-Output "running now:     $($facts.runningPids.Count) pilot-runner process(es)"
        foreach ($p in $facts.runningPids) { Write-Output "                 pid $p" }

        $mirror = if ($env:WTP_MIRROR) { $env:WTP_MIRROR } else { "G:\My Drive\we-the-people" }
        $digest = Join-Path $mirror "pilot-digest.md"
        if (Test-Path $digest) {
            Write-Output "digest:          $digest  (last written $((Get-Item $digest).LastWriteTime))"
        }
        else {
            Write-Output "digest:          NOT PRESENT at $digest - no cycle has delivered one yet"
        }
    }

    "verify-triggers" {
        # Read-only. Exit 0 when the relaunch trigger is present on the live task.
        $facts = Get-TaskFacts
        Write-Output (ConvertTo-Json $facts -Depth 5)
        if ($facts.relaunchTriggerPresent) { exit 0 } else { exit 1 }
    }

    "prove-relaunch" {
        # THE ACCEPTANCE MEASUREMENT. Kills the runner and waits for the task to
        # bring a NEW pid back. Refuses when nothing would bring it back.
        $facts = Get-TaskFacts
        if (-not $facts.taskPresent) {
            Write-Output "REFUSED: the scheduled task '$TaskName' is not registered; nothing would relaunch a killed runner."
            exit 2
        }
        if (-not $facts.relaunchTriggerPresent) {
            Write-Output "REFUSED: the relaunch trigger is NOT present on the live task. Killing the runner now"
            Write-Output "  would leave it down until a logon. Add the trigger first, from an ELEVATED"
            Write-Output "  PowerShell in $RepoPath :"
            Write-Output "    $ElevatedOneLiner"
            exit 2
        }
        if ($facts.runningPids.Count -ne 1) {
            Write-Output "REFUSED: expected exactly one running pilot-runner process to kill; found $($facts.runningPids.Count) [$($facts.runningPids -join ', ')]."
            exit 2
        }

        $killedPid = [int]$facts.runningPids[0]
        $measuredAt = (Get-Date).ToUniversalTime().ToString("o")
        Write-Output "killing pilot-runner pid $killedPid at $measuredAt"
        Stop-Process -Id $killedPid -Force
        $t0 = Get-Date

        $relaunchedPid = $null
        $seconds = $null
        $deadline = $t0.AddMinutes(8)
        while ($null -eq $relaunchedPid -and (Get-Date) -lt $deadline) {
            Start-Sleep -Seconds 15
            $elapsed = [int][math]::Round(((Get-Date) - $t0).TotalSeconds)
            $fresh = @(Get-RunnerProcesses | Where-Object { [int]$_.ProcessId -ne $killedPid })
            if ($fresh.Count -gt 0) {
                $relaunchedPid = [int]$fresh[0].ProcessId
                $seconds = $elapsed
                Write-Output "  +${elapsed}s: NEW pilot-runner pid $relaunchedPid"
            }
            else {
                Write-Output "  +${elapsed}s: no new pilot-runner process yet"
            }
        }

        $after = Get-TaskFacts
        $record = [ordered]@{
            measuredAt             = $measuredAt
            killedPid              = $killedPid
            relaunchedPid          = $relaunchedPid
            secondsToRelaunch      = $seconds
            relaunchTriggerPresent = [bool]$after.relaunchTriggerPresent
            taskStateAfter         = $after.state
            lastTaskResult         = $after.lastTaskResult
            verdict                = $(if ($null -ne $relaunchedPid) { "RELAUNCHED" } else { "NOT_RELAUNCHED" })
        }
        $json = ConvertTo-Json $record -Depth 3
        Write-Utf8NoBom -Path $ProofFile -Text ($json + "`n")
        Write-Output ""
        Write-Output $json
        Write-Output "written: $ProofFile"
        if ($record.verdict -eq "RELAUNCHED") { exit 0 } else { exit 1 }
    }
}
