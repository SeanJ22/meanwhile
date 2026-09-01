<#
    THE PILOT RUNNER'S REBOOT-SURVIVAL MECHANISM.
    (Session C, PART G2, 2026-08-31.)

    A process started in a shell dies with the shell, and a laptop reboots. So
    the runner needs a mechanism that brings it back by itself.

    TWO MECHANISMS, AND WHICH ONE THIS HOST ACTUALLY ALLOWS
    ------------------------------------------------------
    1. A WINDOWS SCHEDULED TASK, at logon, with a restart-on-failure policy.
       This is the better mechanism: it restarts a crashed runner, it survives
       a logoff, and its last result is queryable.

       ON THIS HOST IT IS REFUSED. `Register-ScheduledTask` and `schtasks
       /Create` both answer **Access is denied (HRESULT 0x80070005)** from an
       unelevated shell, measured 2026-08-31. That is a WALL and it is named
       rather than worked around: the Task Scheduler service on this machine
       will not accept a registration without elevation, and an unattended
       session does not elevate itself.

       `-Action install` still attempts it, because an ELEVATED shell will
       succeed and that is the arrangement to prefer. When it is denied, this
       script falls back and SAYS SO.

    2. A PER-USER STARTUP ENTRY — a `.cmd` in
       `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\`. Windows runs
       it at every interactive logon, which includes every logon after a
       reboot. It needs no elevation, it is one file, and removing the file
       removes the mechanism.

       WHAT IT DOES NOT DO, said rather than implied: it does not restart the
       runner if the runner crashes mid-day, and it does not start before a
       logon. It survives a REBOOT, which is what was asked for; it is not a
       service.

    THE EXACT COMMANDS THE OWNER USES
    ---------------------------------
        pnpm pilot:install     install the mechanism (task if allowed, else
                               the startup entry) and say which one landed
        pnpm pilot:start       start the runner NOW, without waiting for a logon
        pnpm pilot:stop        stop the running runner
        pnpm pilot:status      what is installed, and whether it is running
        pnpm pilot:disable     stop it AND stop it coming back at logon
        pnpm pilot:uninstall   remove both mechanisms entirely

    Without pnpm, from any shell:

        powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action status

    And the startup entry itself is just a file — open it, read it, delete it:

        C:\Users\seanj\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\wtp-pilot-runner.cmd

    WHAT IT RUNS
    ------------
    `node --env-file=.env.local --experimental-strip-types scripts/pilot-runner.mts --interval=<n>`
    with the repository as its working directory. `--env-file` is how
    `WTP_CONTROL_PLANE_DATABASE_URL` reaches the process; the file is
    gitignored, only its PATH is written anywhere, and no value of any variable
    is written into the task, the startup entry, the log or the digest.

    PROMOTION STAYS OFF. The runner passes no flag that could promote anything,
    and `runCycle` has no parameter that would accept one.

    WHERE THE OWNER READS IT
    ------------------------
    `G:\My Drive\we-the-people\pilot-digest.md` — overwritten each cycle, with
    every cycle's headline appended to `pilot-digest-log.md` beside it. The
    Drive mirror is a synced folder, so writing the file IS the delivery.
    Set WTP_MIRROR to move it.
#>

param(
    [ValidateSet("install", "start", "stop", "status", "disable", "uninstall")]
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

switch ($Action) {
    "install" {
        if (-not (Test-Path $RepoPath)) { throw "repo path does not exist: $RepoPath" }
        $node = Get-NodePath
        $nodeArgs = Get-RunnerArgs
        $taskLanded = $false

        try {
            $taskAction  = New-ScheduledTaskAction -Execute $node -Argument $nodeArgs -WorkingDirectory $RepoPath
            $taskTrigger = New-ScheduledTaskTrigger -AtLogOn
            # RestartCount/RestartInterval survive a crash as well as a reboot;
            # ExecutionTimeLimit 0 means never kill it for running long, which
            # is the whole point of a standing loop.
            $taskSettings = New-ScheduledTaskSettingsSet `
                -AllowStartIfOnBatteries `
                -DontStopIfGoingOnBatteries `
                -StartWhenAvailable `
                -RestartCount 999 `
                -RestartInterval (New-TimeSpan -Minutes 5) `
                -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
                -MultipleInstances IgnoreNew
            $taskPrincipal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

            Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $taskTrigger `
                -Settings $taskSettings -Principal $taskPrincipal -Force | Out-Null
            $taskLanded = $true
        }
        catch {
            Write-Output "SCHEDULED TASK REFUSED: $($_.Exception.Message)"
            Write-Output "  The Task Scheduler service on this host will not accept a registration"
            Write-Output "  from an unelevated shell. That is a WALL, named. Re-run this from an"
            Write-Output "  ELEVATED PowerShell to get the better mechanism; the per-user startup"
            Write-Output "  entry below is installed either way and survives a reboot on its own."
        }

        $file = Install-StartupEntry -Node $node -NodeArgs $nodeArgs

        Write-Output ""
        Write-Output "INSTALLED"
        Write-Output "  scheduled task:  $(if ($taskLanded) { "$TaskName (at logon, restart every 5 min)" } else { 'REFUSED - see above' })"
        Write-Output "  startup entry:   $file  (runs at every logon, including after a reboot)"
        Write-Output "  runs:            $node $nodeArgs"
        Write-Output "  in:              $RepoPath"
        Write-Output "  digest:          `$WTP_MIRROR\pilot-digest.md  (default G:\My Drive\we-the-people)"
        Write-Output "  start it now:    pnpm pilot:start"
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
        $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($null -eq $task) {
            Write-Output "scheduled task:  NOT REGISTERED (refused without elevation on this host)"
        }
        else {
            $info = Get-ScheduledTaskInfo -TaskName $TaskName
            Write-Output "scheduled task:  $($task.State), last run $($info.LastRunTime), last result $($info.LastTaskResult)"
        }

        if (Test-Path $StartupFile) {
            Write-Output "startup entry:   PRESENT at $StartupFile"
        }
        else {
            Write-Output "startup entry:   ABSENT. That is an absence of a mechanism, not a statement"
            Write-Output "                 that the pilot is idle. `pnpm pilot:install` installs it."
        }

        $procs = @(Get-RunnerProcesses)
        Write-Output "running now:     $($procs.Count) pilot-runner process(es)"
        foreach ($p in $procs) { Write-Output "                 pid $($p.ProcessId)" }

        $mirror = if ($env:WTP_MIRROR) { $env:WTP_MIRROR } else { "G:\My Drive\we-the-people" }
        $digest = Join-Path $mirror "pilot-digest.md"
        if (Test-Path $digest) {
            Write-Output "digest:          $digest  (last written $((Get-Item $digest).LastWriteTime))"
        }
        else {
            Write-Output "digest:          NOT PRESENT at $digest - no cycle has delivered one yet"
        }
    }
}
