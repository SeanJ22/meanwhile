> Historical implementation record. This is not current policy or a release requirement. Read docs/rulings.md §0, §3 and §5 for current instructions.

# The pilot runner — the machine that keeps running

*(Session C, PART G2, 2026-08-31. Operative code: `scripts/pilot-runner.mts`,
`scripts/pilot-task.ps1`, `scripts/freshness-shadow.mts`.)*

A long-lived standing host process with two explicit failure domains:

1. the research scheduler registers its obligation providers, dispatches due
   research, records the lifecycle, and writes only ignored staging diagnostics;
2. the typed routine civic-data registry independently considers each source's
   durable cadence, then validates and atomically promotes GOOD source-scoped
   candidates in the production data plane.

**Research promotion stays OFF.** `runCycle` cannot change Reader truth and its
promotion tail writes only under `.runtime/control-plane/staging/`. Routine
civic-data promotion is a separate child with per-source candidates, receipts,
retry clocks and LKG pointers. Neither path writes tracked runtime truth, and a
research pause/failure/circuit cannot suppress the routine-data tick.

---

## Where tonight's digest is

```
G:\My Drive\we-the-people\pilot-digest.md         the current digest, overwritten each cycle
G:\My Drive\we-the-people\pilot-digest-log.md     every cycle's headline, appended
```

The Drive mirror is a **synced filesystem folder, not an API**, so writing the
file into it *is* the delivery. `WTP_MIRROR` moves it; the default is
`G:/My Drive/we-the-people`, which is the variable and the default this
repository already uses for the coverage matrix, the owner intake and the photo
review sheet.

**A stable filename is deliberate.** The owner reads this by glancing at Drive,
and a dated filename means finding today's before reading it. The log beside it
keeps the history the stable file overwrites.

**If the mirror is unreachable the digest goes to `.mirror/` in the repository
and the runner says so on its own stdout.** A digest that silently went nowhere
is worse than no digest, because its absence reads as "nothing happened".

---

## Start and stop

```bash
pnpm pilot:install     install the reboot-survival mechanism
pnpm pilot:start       start the runner NOW, without waiting for a logon
pnpm pilot:stop        stop the running runner
pnpm pilot:status      what is installed, whether it is running, when the digest last moved
pnpm pilot:disable     stop it AND stop it coming back at logon
pnpm pilot:uninstall   remove every mechanism and stop the process
```

There is no package-visible foreground production runner. The stable Scheduled
Task (or its mutually exclusive Startup fallback) is the only production
entrypoint. It validates a clean detached installed checkout on `origin/main`,
loads the one absolute private environment file, mints the standing-parent
authority, and starts the runner with release handoff enabled. A developer can
still invoke the script with `--provider=file` for an ignored local proof; that
path has no production authority or store.

## What the owner's dashboard does to the runner (9.4.26)

Three things the control centre at `/admin` can now say to the runner, each a
durable intent the runner reads once a minute and answers with its own
HONORED record — never a direct edit of anything:

- **Pause / resume research** (`PAUSE_RUNNER`, `RESUME_RUNNER`). A recorded
  pause is what tells the dashboard's Runner line "Paused by you — reason"
  from a red "Silent — no pause recorded". While it stands, no research cycle
  or nightly research window starts and a heartbeat every thirty minutes
  carries the pause; routine civic data and intake observations continue on
  their independent standing tick. `pnpm pilot:stop` and `pnpm pilot:disable`
  stop the host process itself and record the pause
  themselves and `pnpm pilot:start` records the resume, best effort, so a
  stop from the shell is visible on the page too. Ad-hoc production pause-note
  writers are not exposed; the owner uses Admin or the validated host-control
  commands above.
- **Deploy fleet** (`DISPATCH`). The owner's words — "deep dive on Illinois",
  "Pima County campaign finance" — are parsed into state codes and terms; the
  next cycle puts every REGISTERED unit that matches first in both lanes and
  records what matched of what. A dispatch reorders; it never enlarges the
  registry. A state nothing is registered for is honored with a sentence
  saying so by name, and enumerating it is the owner's scope decision.
- **The console republishes itself.** After every cycle, success or failure,
  the admitted standing parent launches the owner-snapshot and readiness
  children with a freshly rotated console-publisher capability. Those children
  have no direct package production door. The snapshots are never older than
  the last cycle while the runner is on; nothing else schedules them.

Owner-triggered source promotion commands in `package.json` are non-writing
wrappers. They resolve the live task, revalidate the exact installed checkout
and running process, prove that SHA is currently deployed and fully certified,
then delegate exactly one registered source contract. An engineering checkout
cannot open a production writer merely by loading `.env.local`.

---

## What a cycle does when it cannot finish

*(Autonomy-recovery session, 2026-09-01. These are the behaviours that make the
machine recover on its own; before them, one throw ended a cycle with no
record, and every restart re-hit the same state.)*

- **A content-identical artifact re-observed by a later Attempt is idempotent.**
  A resumed occurrence that re-walks its route and retrieves the same bytes no
  longer trips the append-only log's rewrite refusal — that refusal is kept for
  a genuine different-content collision.
- **One obligation's unexpected throw is isolated**, in the dispatch loop and in
  the occurrence open/resume loop. It is recorded as a FAILED dispatch (debt
  accrues, the obligation stays owed) and the cycle continues.
- **A crash still writes a run record.** `freshness-shadow` marks the cycle
  `crashed: true` with the error, prints the `run record:` line, and exits
  non-zero; the digest then says a cycle CRASHED rather than "0 providers".
- **A cycle stops starting work at its dispatch budget** (`--budget-min`,
  hard maximum 15 minutes from process start, with the last 2 minutes reserved
  for record closure and state publication) and finishes inside the runner's
  15-minute hard backstop, deferring the rest by name. A cycle killed mid-write is
  not recoverable state; a cycle that ends on its own budget is.

## Aggregate unattended-Fleet safety

Every standing-runner role shares one admission controller over the existing
canonical cost ledger. These are hard ceilings, not dashboard targets:

| Scope | Hard ceiling |
| --- | ---: |
| model spend per cycle | $2.00 |
| model spend per operational night (18:00–06:00 America/Phoenix) | $10.00 |
| model spend per rolling 24 hours | $25.00 |
| public/provider requests per cycle | 24 |
| application payload bytes sent plus consumed per cycle | 16,777,216 (16 MiB) |
| Fleet work dispatches per cycle | 10 |
| total Fleet cycle wall time | 900,000 ms (15 minutes) |

The established Scout constraints remain additional: two concurrent Scouts,
three Scout dispatches per cycle, and the per-Attempt turn/tool/wall/token/host
request bounds below. A worst-case cost reservation is taken before each model
request so concurrent requests cannot both spend the same remaining allowance.
Every refusal records the work by name and leaves it owed.

HTTP 402, exhausted quota or transfer allowance, billing/account restrictions,
and equivalent hard refusals latch that provider off until the end of the
Phoenix operational night. There is no paid-provider or model substitution.
429, transient 5xx and network instability receive no implicit retry here; the
existing bounded caller behavior applies, then the named work remains owed.
If Neon itself hard-refuses, a minimal host-local emergency latch exists only
because the unavailable database cannot persist its own research circuit; it
prevents the research cycle from probing again until the operational night
ends. It does not become a budget ledger, a civic-data freshness clock, or an
alternate control plane. The independent routine child reports its own store
outcome and never relabels that infrastructure condition as a publisher failure.

Saturday 18:00 through Sunday 06:00 America/Phoenix is a **SCHEDULED BLACKOUT**.
The process may heartbeat, publish Admin state, and perform zero-cost local
bookkeeping, but it dispatches no model or public/network research. The
Sunday-morning nightly window that belongs to Saturday night is suppressed and
is excluded from later catch-up dates. Skipped work remains owed.

The standing path deliberately does not expose the browser tool: browser
subrequests cannot yet be completely metered against the aggregate request and
byte ceilings. Public retrieval uses the bounded streaming HTTP seams instead.

## How it survives a reboot

The permanent entrypoint is the Windows Scheduled Task **WeThePeople Pilot
Runner**. It starts at logon and has a five-minute repetition trigger;
`MultipleInstances IgnoreNew` makes that trigger a no-op while the one runner
is alive and the relaunch door after a crash. `pnpm pilot:status` reads the
live task rather than trusting what an installer requested.

An unelevated installation may use this per-user Startup entry only as a
fallback when no active Scheduled Task exists:

```
C:\Users\seanj\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\wtp-pilot-runner.cmd
```

Windows runs it at interactive logon. It cannot relaunch a crashed runner.
The installer removes it after a Scheduled Task is proven live, and refuses to
create it beside an active task; two independent logon clocks are never an
accepted end state.

**The better mechanism is a Scheduled Task, and this host refuses to register
one.** `Register-ScheduledTask` and `schtasks /Create` both answer **Access is
denied (HRESULT 0x80070005)** from an unelevated shell — measured 2026-08-31.
That is a wall, and it is named rather than worked around: the Task Scheduler
service on this machine will not accept a registration without elevation, and
an unattended session does not elevate itself.

`pnpm pilot:install` **still attempts the task first**, because an elevated
PowerShell will succeed and that arrangement is better in two ways the startup
entry cannot match:

| | Scheduled Task | Startup entry |
| --- | --- | --- |
| survives a reboot | yes | yes |
| restarts a crashed runner | yes, every 5 min | **no** |
| runs before a logon | yes | no |
| last result queryable | `pnpm pilot:status` | process presence only |
| needs elevation to install | **yes, on this host** | no |

After a software release is fully certified and deployed, prepare a dedicated
clean checkout detached at that exact deployed SHA. Then run this from an
**elevated** PowerShell (paths shown are examples; the SHA must be full):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action install `
  -RepoPath "C:\Users\seanj\dev\wtp-production-runtime" `
  -EnvFile "C:\absolute\private\production.env" `
  -ExpectedDeployedSha "0123456789abcdef0123456789abcdef01234567"
```

Before registration, `scripts/pilot-runtime-config.mjs` refuses a relative
path, a non-root repository path, a dirty or branch-attached checkout, a HEAD
different from the supplied SHA, a SHA not present on `origin/main`, or an
environment file tracked by Git. It never opens the environment file. The task
stores only its absolute path, and the parent process passes the already-loaded
environment to every child.

The SHA is intentionally an installation-time proof only. The registered task
calls a stable launcher with the repository path, environment-file path, and
interval—no immutable SHA—so later releases do not require another elevated
install. Before any source admission at startup, and again at each quiescent
cycle boundary, the runner compares its loaded SHA with production's canonical
`/api/build` SHA. It will move the dedicated checkout only when the target is a
full commit on `origin/main`, all branch-protection contexts are green for that
exact commit, and the existing canonical post-deploy integrity receipt is HELD
for that same commit. It drains every independent runtime lane, rechecks the
evidence, detaches the checkout at the exact target, completes a frozen install,
and exits. The existing five-minute trigger relaunches through the stable
launcher, which repeats boundary validation and the frozen install before Node
can admit work. Any missing, stale, red, or unreadable evidence closes source
admission and appends a supervisor failure to Admin's existing outcome log; it
does not commit, push, deploy, or alter a source candidate/LKG.

## Relaunch after a kill

*(Autonomous-scout session, 2026-09-01. Operative code: `scripts/pilot-task.ps1`;
guard: `tests/pilot-task-installer.test.ts`; measurements:
`docs/evidence/runner-installer-2026-09-01.md`.)*

**`RestartCount 999 / RestartInterval PT5M` does not relaunch a killed runner
on this host.** Measured 2026-09-01 against the owner-installed task (AtLogOn
trigger only): a runner killed with `Stop-Process -Force` left the task at
`Ready`, `LastTaskResult 0xFFFFFFFF`, and no new process within 8 minutes.
Windows treats the run as completed-with-failure and the restart setting does
not fire. After a kill or a crash the runner is DOWN until a logon or
`pnpm pilot:start`. The child-level recovery above (the next cycle absorbs a
killed cycle) is real; parent-level recovery from the task's settings is not,
and the "restarts a crashed runner" row in the table above is true only with
the trigger below present.

**The relaunch path is a second trigger.** `-Action install` now registers
TWO triggers and keeps the settings (`IgnoreNew`, `RestartCount 999`,
`ExecutionTimeLimit 0`) unchanged:

| trigger | what it does |
| --- | --- |
| AtLogOn | starts the runner at every logon, including after a reboot |
| Once, repeating every 5 minutes for 3650 days | with `MultipleInstances IgnoreNew`, a firing while the runner lives is a no-op; a firing after a death relaunches it within five minutes |

Registration still needs elevation. The unelevated attempt on 2026-09-01
answered `Access is denied.` (exit 1). The explicit command above is the
post-deploy handoff; the mutable development checkout is never a runtime target.

`install` prints which triggers and action LANDED, read back from the live task
rather than inferred from what it asked for. A stale active task whose action
does not exactly match the validated Node executable, checkout, environment
path, and deployed SHA is refused; no Startup competitor is installed.

**Trigger presence is derived, never flagged.** Three actions read the live
task (`Get-ScheduledTask` -> `Triggers` -> `Repetition`) through one shared
derivation:

```
-Action status            lists every trigger; says RELAUNCH TRIGGER IS PRESENT / ABSENT
-Action verify-triggers   read-only JSON {taskPresent, state, triggers, relaunchTriggerPresent,
                          executable, workingDirectory, arguments, lastRunTime,
                          lastTaskResult, runningPids}; exit 0 only for one active
                          crash-relaunching entrypoint
-Action prove-relaunch    THE ACCEPTANCE MEASUREMENT: records the running pid, kills it,
                          polls every 15 s for up to 8 min for a NEW pid, writes
                          ignored `.runtime/ops/runner-relaunch-proof.json` and prints it;
                          exit 0 on RELAUNCHED, 1 on NOT_RELAUNCHED
```

`prove-relaunch` REFUSES (exit 2) while the relaunch trigger is absent, because
killing the runner then leaves nothing to bring it back. The sequence once the
owner has run the elevated install is `verify-triggers` (expect exit 0), then
`prove-relaunch`. The proof is host-local diagnostic evidence and never a Git
commit or live operational authority. Use the
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action <name>`
form.

---

## Level 1 — Research: the Scout lane (RULING 240, RULING 241)

*(Level 1 activation, 2026-09-01. Operative code:
`lib/control-plane/scheduler/dispatch.ts` (`decideExecutor`),
`lib/control-plane/scheduler/shadow-loop.ts` (two lanes),
`lib/control-plane/scheduler/scout-executor.ts`,
`lib/control-plane/scheduler/scout-tools.ts`,
`lib/control-plane/scheduler/research-policy.ts`.)*

Every due unit is decided ONCE by the executor rule: a machine-executable
shape (declared by the provider, or graduated since in the method store) runs
the deterministic route executor; genuine unresolved novelty runs a **real
bounded Scout** — role `SCOUT`, provider `anthropic`, the model named on the
Attempt, provider-reported usage and computed cost on the Attempt and in the
cost ledger, whatever the outcome. A route declared DETERMINISTIC never
consumes a model. Any disagreement between the two classifications is recorded
in the run record's `executors` list and never reconciled silently.

The two lanes run concurrently inside one cycle. The Scout lane is admitted per
row or **deferred by code** — `LANE_DISABLED` (no credential in the process,
`--dry`, `--no-model`), `PAUSED` (an owner intent), `CEILING` (the rolling
daily ceiling, RULING 241), `CYCLE_MAX`, `BUDGET`. A deferred row keeps its
next-due; nothing is dropped and nothing is reported complete.

```
concurrency        2 Scouts at once
per cycle          3 Scouts (--scout-max)
per Attempt        18 turns · 16 tool calls · 10 requests per host · 5 minutes · 400k tokens
rolling ceiling    $25 per 24 hours, TEMPORARY, an owner safety ceiling
```

A Scout acts only through tools — `read_permission`, `fetch_public`, `browse`,
`read_inherited` — and every tool **vaults first**: the bytes become an
Artifact with provenance before the model sees a sanitized representation, and
what it sees carries the artifact id. Disallowed and cannot-tell hosts are
refused by the tool, never by the model's judgement. A Scout may not return
NO_PROGRESS, BLOCKED or NEEDS_ADAPTER before it has walked at least four
distinct evidence-backed rungs of the ladder, unless its bound ended the walk —
in which case the typed result names the rungs walked and the next rungs, and
the next Attempt resumes. A finish that cites an artifact nobody vaulted, that
omits the rung list, or that follows no tool use at all is REFUSED and the
Attempt aborts with the reason.

What a cycle writes about the lane, and where the owner reads it:

```
scout_results       every typed result, keyed by obligation id
research_state      id level-1 — lane on/off with reason, the credential
                    CONFIRMED BY NAME, bounds, rolling spend, queue, Scouts running
research_intents    PAUSE / RESUME / RUN_CYCLE_NOW from /admin/research, and the
                    HONORED record the cycle appends beside each
runner_heartbeat    written at the end of every cycle
cp_method_candidates/live    route candidates PROPOSED and VALIDATED; never admitted here
```

`admin.meanwhileusa.com/admin/research` DERIVES ACTIVE / DEGRADED / INACTIVE
from those records at read time and names every failing condition. No record
stores a verdict.

**Promotion stays OFF.** A Scout finding is inventory and a candidate; the
disposition it earns (`DISCOVERED`, `INGESTED`, `POINTER_ONLY`,
`REQUIRES_NEW_ADAPTER`, `BLOCKED_CURRENTLY`) lands in the control plane and the
staging area, and nothing a reader sees moves.

```bash
pnpm scout:denominator --label=after     the typed Scout denominator
pnpm scout:readback --last=25            the proof conditions, answered from persisted rows
```

## What the digest carries

Health first, activity under — RULING 217. A digest that leads with *312 routes
walked* reads as health and measures effort.

```
PILOT HEALTH     the three contracts, each with its own blocker, and the rollup
COST             total, by role, by model, and the cache hit rate
LANE SHARE       deterministic vs bounded-model, as Attempts and as cost
WHAT ADVANCED    every provider, what was due, what was dispatched, what disposed
STAGED           promotion-ready entries and honest gaps (RULING 224)
DEBT AND WALLS   every incident by root cause, with its next retry
```

**The cache hit rate reports NOT MEASURED, and that is the honest reading.**
`AttemptCost` carries `inputTokens`, `outputTokens`, `usd`, `durationMs`,
`bytesFetched` and `requestCount`. There is no field for cache reads or cache
writes anywhere in the cost ledger, so no process can compute a hit rate.
Printing `0%` would assert that every model read missed the cache, which is a
measurement nobody took. Adding the field is the named next move.

**The lane share is currently 100% deterministic, and that is a fact about the
registered routes rather than a policy.** No route in the portfolios reads
`WTP_WORKERS_ANTHROPIC_API_KEY`. A route whose request shape nothing has derived
disposes `REQUIRES_NEW_ADAPTER` and names the missing adapter, rather than
spending a model to guess at a shape.

---

## What it runs, exactly

```
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/pilot-runtime-launch.ps1 `
  -RepoPath "C:\Users\seanj\dev\wtp-production-runtime" `
  -EnvFile "C:\absolute\private\production.env" `
  -IntervalMinutes 60
```

with the clean detached runtime repository as its working directory. The
launcher revalidates the current detached `origin/main` commit, runs
`pnpm install --frozen-lockfile`, and starts the parent with
`--release-handoff`. The absolute environment file is loaded once by the parent. Every bounded child
receives `process.env` and carries no `--env-file` argument, so changing cwd or
changing a neighboring checkout cannot silently select different credentials.
Only the path is stored; **no value of any environment variable appears in the
task, startup entry, digest, log, row, commit, or fixture.**

Each cycle spawns `scripts/freshness-shadow.mts` as a child process with a
twenty-minute ceiling, reads the run record that child wrote, and builds the
digest from it — so the console, the run record and the mirrored digest cannot
disagree about what a cycle did.

---

## Where the state lives

```
.runtime/freshness-shadow-runs/*.json         host diagnostics; canonical outcome is in the control-plane store
.runtime/autonomous-advancement/*.json        host diagnostics
.runtime/control-plane/vault/                 retrieved research bytes, content-addressed
```

The vault is gitignored because it is a store rather than repository content —
one cycle over the registered portfolios wrote 13 MB and it grows with every
cycle. **What that costs, said rather than hidden:** a vault key is resolvable
on the machine that acquired it and nowhere else. The staged snapshots are
committed, and they are what a later session reads.
