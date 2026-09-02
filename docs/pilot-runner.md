# The pilot runner — the machine that keeps running

*(Session C, PART G2, 2026-08-31. Operative code: `scripts/pilot-runner.mts`,
`scripts/pilot-task.ps1`, `scripts/freshness-shadow.mts`.)*

A long-lived process that runs the freshness scheduler's cycle on an interval,
forever, with **no operator choosing what to work**. It registers every
obligation provider, lets the scheduler decide what is due, dispatches it,
records the full lifecycle, runs RULING 224's promotion tail to a STAGED state,
and writes one digest per cycle where the owner reads it.

**Promotion stays OFF.** Nothing this process does changes what a reader is
told. `runCycle` has no parameter that could, and the promotion tail writes only
under `data/control-plane/staging/`.

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

Run it in the foreground instead, for one cycle or a few:

```bash
pnpm pilot:run --cycles=1              one cycle, then exit
pnpm pilot:run --cycles=3 --interval=8 three cycles, eight minutes apart
pnpm pilot:run                          until Ctrl+C, hourly
pnpm pilot:run --provider=file          against the file store instead of Postgres
```

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
  default 15 from process start) and finishes cleanly inside the runner's
  20-minute backstop, deferring the rest by name. A cycle killed mid-write is
  not recoverable state; a cycle that ends on its own budget is.

## How it survives a reboot

**As of 2026-09-01 the Windows Scheduled Task "WeThePeople Pilot Runner" IS
installed** — the owner ran `pnpm pilot:install` from an elevated PowerShell.
At logon, restart every 5 minutes up to 999 times, one instance, no execution
time limit. `pnpm pilot:status` reads it back. The section below records the
wall the unelevated install hit and the per-user startup entry it fell back to;
both mechanisms may be present on this host, and which survives is the owner's
decision (tracker, Needs Sean).

**The mechanism an UNELEVATED install lands is a per-user STARTUP ENTRY:**

```
C:\Users\seanj\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\wtp-pilot-runner.cmd
```

Windows runs it at every interactive logon, which includes every logon after a
reboot. It needs no elevation, it is one file, and deleting the file removes the
mechanism. `pnpm pilot:install` writes it; `pnpm pilot:uninstall` removes it.

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

To get the better one, run this from an **elevated** PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action install
```

---

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
node --env-file=.env.local --experimental-strip-types scripts/pilot-runner.mts --interval=60
```

with the repository as its working directory. `--env-file` is how
`WTP_CONTROL_PLANE_DATABASE_URL` reaches the process. The file is gitignored,
only its PATH is written anywhere, and **no value of any environment variable
appears in the task, the startup entry, the digest, the log, a row, a commit or
a fixture.**

Each cycle spawns `scripts/freshness-shadow.mts` as a child process with a
twenty-minute ceiling, reads the run record that child wrote, and builds the
digest from it — so the console, the run record and the mirrored digest cannot
disagree about what a cycle did.

---

## Where the state lives

```
data/control-plane/staging/manifest.json      THE STAGED STATE — every entry, dated
data/control-plane/staging/*.staged.json      the promotion-ready snapshots
data/health/freshness-shadow-runs/*.json      one record per cycle
data/health/autonomous-advancement/*.json     the unattended-advancement evidence
data/control-plane/vault/                     retrieved bytes, content-addressed (GITIGNORED)
```

The vault is gitignored because it is a store rather than repository content —
one cycle over the registered portfolios wrote 13 MB and it grows with every
cycle. **What that costs, said rather than hidden:** a vault key is resolvable
on the machine that acquired it and nowhere else. The staged snapshots are
committed, and they are what a later session reads.
