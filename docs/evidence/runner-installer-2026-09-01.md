# Runner installer, measured unelevated: the two-trigger install and the wall it hit (2026-09-01)

*(Autonomous-scout session, Lane D. `pnpm stamp` = 2026-09-01. The shell clock
is local time, UTC-07:00. Operative code: `scripts/pilot-task.ps1`; guard:
`tests/pilot-task-installer.test.ts`; narrative: `docs/pilot-runner.md`,
"Relaunch after a kill".)*

**What was measured.** The rewritten installer, whose `-Action install` now
registers an AtLogOn trigger AND a 5-minute / 3650-day repetition trigger, was
run ONCE from an unelevated PowerShell, with `-Action verify-triggers`
(read-only) before and after. The running task was never stopped, killed,
ended, disabled or restarted. `-Action prove-relaunch` was NOT run; no
`data/ops/runner-relaunch-proof.json` exists.

**Shell.** Windows PowerShell 5.1, unelevated: `IsInRole Administrator` read
`False` at `2026-09-01T23:20:39-07:00`. Working directory: the worktree
`.claude/worktrees/autonomous-scout-activation-f24965`. `-RepoPath` at its
default, the main checkout `C:\Users\seanj\dev\we-the-people`, which is where
the task runs.

**Live task before anything ran** (read-only `Get-ScheduledTask`, same
timestamp): State `Running`; one trigger, `MSFT_TaskLogonTrigger`, no
repetition; settings `RestartCount=999 RestartInterval=PT5M
MultipleInstances=IgnoreNew ExecutionTimeLimit=PT0S`; `LastRunTime 09/01/2026
22:20:54`, `LastTaskResult 0x00041301`; runner `pid 26404`, started
`09/01/2026 22:20:54`, command line `node.exe --env-file=.env.local
--experimental-strip-types scripts/pilot-runner.mts --interval=60`.

---

## 1. `verify-triggers`, before (read-only)

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action verify-triggers
```

ISO start `2026-09-01T23:24:39.4662722-07:00`, end
`2026-09-01T23:24:41.9801972-07:00`. stdout, verbatim; stderr empty:

```json
{
    "taskPresent":  true,
    "state":  "Running",
    "triggers":  [
                     {
                         "type":  "LogonTrigger",
                         "enabled":  true,
                         "startBoundary":  null,
                         "repetitionInterval":  null,
                         "repetitionDuration":  null
                     }
                 ],
    "relaunchTriggerPresent":  false,
    "lastRunTime":  "2026-09-01T22:20:54.0000000-07:00",
    "lastTaskResult":  "0x00041301",
    "runningPids":  [
                        26404
                    ]
}
```

**Exit code 1** (the relaunch trigger is absent).

---

## 2. `install`, unelevated, once

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action install
```

ISO start `2026-09-01T23:25:50.8725872-07:00`, end
`2026-09-01T23:25:51.5512008-07:00`. stdout, verbatim; stderr empty:

```
SCHEDULED TASK REFUSED: Access is denied.

  The Task Scheduler service on this host will not accept a registration
  from an unelevated shell. That is a WALL, named. The per-user startup
  entry below is installed either way; it survives a reboot and does NOT
  relaunch a killed runner. To get the task with both triggers, run this
  ONCE from an ELEVATED PowerShell in C:\Users\seanj\dev\we-the-people :
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action install

INSTALLED
  scheduled task:  REFUSED - see above
  startup entry:   C:\Users\seanj\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\wtp-pilot-runner.cmd  (runs at every logon, including after a reboot)
  runs:            C:\Program Files\nodejs\node.exe --env-file=.env.local --experimental-strip-types scripts/pilot-runner.mts --interval=60
  in:              C:\Users\seanj\dev\we-the-people
  digest:          $WTP_MIRROR\pilot-digest.md  (default G:\My Drive\we-the-people)
  start it now:    pnpm pilot:start
```

**Exit code 1** (the installer exits 1 whenever the task did not land). The
refusal text the cmdlet surfaces is the bare `Access is denied.`; the HRESULT
behind it, `0x80070005`, is the one recorded for `Register-ScheduledTask` on
2026-08-31 and for `Set-ScheduledTask` earlier on 2026-09-01.

The per-user startup entry was (re)written, as expected and pre-existing:
`wtp-pilot-runner.cmd` `LastWriteTime 2026-09-01T23:25:51.5280229-07:00`, with
the `runs:` and `in:` lines above as its content.

---

## 3. `verify-triggers`, after (read-only)

ISO start `2026-09-01T23:25:51.5512008-07:00`, end
`2026-09-01T23:25:54.0541493-07:00`. stdout, verbatim; stderr empty:

```json
{
    "taskPresent":  true,
    "state":  "Running",
    "triggers":  [
                     {
                         "type":  "LogonTrigger",
                         "enabled":  true,
                         "startBoundary":  null,
                         "repetitionInterval":  null,
                         "repetitionDuration":  null
                     }
                 ],
    "relaunchTriggerPresent":  false,
    "lastRunTime":  "2026-09-01T22:20:54.0000000-07:00",
    "lastTaskResult":  "0x00041301",
    "runningPids":  [
                        26404
                    ]
}
```

**Exit code 1.**

---

## Reading

- **The install attempt did not touch the running instance.** State `Running`
  before and after; `lastRunTime` unchanged at `22:20:54`; `lastTaskResult`
  `0x00041301` (running) both times; runner **pid 26404 both times**.
- **The wall stands, unelevated.** The live task still carries only the
  `LogonTrigger`; `relaunchTriggerPresent` is `false` before and after. This
  is the same refusal as 2026-08-31, now measured against an installer that
  would have registered both triggers had it been allowed to.
- **What the owner does, once, from an ELEVATED PowerShell in
  `C:\Users\seanj\dev\we-the-people`:**

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action install
  ```

  `install` then prints which triggers LANDED, read back from the live task.
- **What follows the elevated install, in order:** `verify-triggers` (expect
  exit 0 and a second trigger with `repetitionInterval PT5M` and
  `repetitionDuration P3650D`), then `prove-relaunch` (kills the runner, polls
  every 15 s for up to 8 minutes for a NEW pid, writes
  `data/ops/runner-relaunch-proof.json`), then commit the record. Until the
  trigger is present, `prove-relaunch` refuses with exit 2 by design.
- **Guard:** `tests/pilot-task-installer.test.ts` reads the script as text and
  holds the two-trigger install, the prove-relaunch refusal, and the derived
  (not flagged) trigger presence, each with a positive control.
- **Amendment after the runs above.** A scratch copy of the script pointed at
  a NONEXISTENT task name (never the real task) showed `verify-triggers`
  printing `"triggers": {}` when no task exists; `Get-TaskFacts` was corrected
  to print `[]`. The present-task output is unchanged: the real read-only
  `verify-triggers` re-run at `2026-09-01T23:34:06-07:00` printed the same
  record as section 3, exit code 1, pid 26404. The same scratch copy
  exercised `prove-relaunch`'s first refusal (`REFUSED: ... is not
  registered`, exit 2, nothing killed, no record written); the real
  `prove-relaunch` was not run.
