# The nightly window — the single promotion door, run in shadow

*(Lane E, 2026-09-02. RULING 242. Operative code:
`lib/control-plane/promotion/*`, `lib/control-plane/window-view.ts`,
`scripts/nightly-window.mts`, `scripts/pipeline-map.mts`,
`scripts/window-readback.mts`, the delimited block in `scripts/pilot-runner.mts`,
and `-Action install-window` in `scripts/pilot-task.ps1`.)*

> Reader-facing civic truth changes through exactly one door: the nightly
> refresh window, run by the standing runner on the machine's own clock at
> 04:00 America/New_York. Scouts, Acquirers, Parsers and Detectives never write
> reader truth. Until the activation gate opens, the window runs in SHADOW: it
> computes and records what it would have promoted and refused and promotes
> nothing.

**Promotion is OFF.** `ACTIVATION_GATE.promotionEnabled` is a literal `false`
in `lib/control-plane/promotion/activation-gate.ts`; the open record-class set is
EMPTY; the promoter the window hands to its promotion step throws; and
`tests/nightly-window.test.ts` asserts, structurally and dynamically, that the
window can write no reader-content path.

---

## The pipeline every finding travels

```
SCOUTED -> CONFIRMED -> VERIFIED -> AUDITED -> APPROVED_FOR_PROMOTION
   |           |            |           |               |
   +-----------+------------+-----------+---------------+--> REFUSED (with reasons, at any stage)
```

Every transition is a TYPED RECORD appended to the `promotion_pipeline` log
(schema v5), keyed by item id, with its proof. A refusal is appended too,
carrying the offered transition verbatim and every reason at once.

| Stage | What the record must carry | Refused when |
| --- | --- | --- |
| `SCOUTED` | the source (a Scout result or a method candidate), record class, subject, the representation's canonical URL, the Scout's own artifact ids, the Scout Attempt id | never on its own; it is the mapping of existing evidence |
| `CONFIRMED` | `confirmingArtifactIds` and the basis — `SECOND_ACQUISITION` (same canonical URL) or `SECOND_ROUTE` (a named shared fact) | no artifact; an artifact the log does not hold; an artifact vaulted by the Scout's own Attempt; an artifact vaulted by any SCOUT-role Attempt; an Attempt whose role cannot be read; a URL mismatch on a second acquisition; a second route with no named fact |
| `VERIFIED` | five named checks, each PASS / FAIL / NOT_IMPLEMENTED: `CLAIM_RESOLVES_TO_SOURCE_SPAN`, `CANONICAL_IDENTITY_UNIQUE`, `ASSERTION_CLASS_BURDENS` (the four claim classes of `lib/method/claims.ts`), `NEUTRALITY_AND_RENDERING_SYMMETRY`, `FALSE_ZERO` | any check FAIL, NOT_IMPLEMENTED or MISSING — there is no silent pass |
| `AUDITED` | the auditor, the evidence bases it started from, whether the claim survived, the batch's control scores | the auditor is the Scout or the validator; no base is independent (`INDEPENDENT_BASES` in `lib/control-plane/audit.ts`); controls `null` (NOT MEASURED — the batch carried no injected controls); the claim did not survive |
| `APPROVED_FOR_PROMOTION` | the full chain by record id | a chain record the log does not hold |
| every stage | the actor (role, lane, instance) | `SELF_CERTIFICATION`: the actor equals the previous stage's actor; `STAGE_OUT_OF_ORDER`; `STAGE_ALREADY_REACHED`; `ITEM_REFUSED` (a refused item is terminal) |

**Model prose never confirms model prose.** `CONFIRMED` needs artifacts from a
DIFFERENT Attempt than the Scout's, and never from a SCOUT-role Attempt.

**The neutrality check is NOT_IMPLEMENTED today, and that refuses VERIFIED.**
`lib/control-plane/capability.ts` carries `assertNeutralityEnabled`, which is a
policy-flag invariant, not a check over a record; no callable
rendering-symmetry check exists under `lib/`. Until one does, no item can reach
VERIFIED, and the pipeline says so rather than passing the check it cannot run.

### The honest mapping of existing evidence

`pnpm pipeline:map` maps what the control plane already holds, idempotently:

- every persisted Scout result with outcome `ROUTE_CANDIDATE` or
  `EVIDENCE_FOUND` (and no refusal) becomes SCOUTED — one item per candidate,
  one per finding set;
- every `PROPOSED` or `VALIDATED` method candidate becomes SCOUTED — method-store
  validation checks the store's shape, which is not the pipeline's VERIFIED;
- CONFIRMED is computed only where the artifact log holds an ACQUIRER-role
  artifact at the same canonical URL from another Attempt;
- nothing goes beyond VERIFIED without an audit record, which no worker writes yet.

The script prints every count with its denominator. The live numbers on
2026-09-02 are in the session report and in the window record.

---

## The window

Four stages, one lock, one record, one digest.

```
LOCK        the CAS lease `nightly-window` in the `leases` aggregate (TTL 90 min)
STAGE 1     LEGACY_REFRESH            the legacy source refresh, in an isolated worktree, in SHADOW
STAGE 2     PIPELINE_EVALUATION       map -> evaluate every item against the activation gate
STAGE 3     POST_PROMOTION_VERIFICATION   the staging observer, recorded "as if promoted"
STAGE 4     DIGEST                    the record, the log rows, the mirror digest
```

### The lock is a lease, not `repos.locks`

Measured 2026-09-02 (`.scratch/lock-probe.mts`, the live control plane):
`pg_try_advisory_lock` over the neon HTTP client answered `true`, the next query
ran on the same backend pid, and `pg_advisory_unlock` answered **false** — the
session-scoped lock had already been released between requests. So
`repos.locks.withLock` on the Postgres provider holds nothing while `fn` runs.
The window lock is therefore `withNightlyWindowLease` in
`lib/control-plane/promotion/window.ts`: a `claim()` on the fixed aggregate id
`nightly-window`, compare-and-set, released in a `finally`, expired by TTL if the
process dies. It is host-global because the aggregate is.

The hourly cycle takes the same lease (two lines in
`scripts/freshness-shadow.mts`, Lane BD's file):

```ts
import { withNightlyWindowLease } from "../lib/control-plane/promotion/window.ts";
// ...around the cycle body:
await withNightlyWindowLease(repos, `cycle@${HOST}#${process.pid}`, nowIso, async () => { /* the cycle */ }, 25 * 60_000);
```

A window that finds the lease held by a cycle refuses (exit 3) and the runner
retries on its next poll; a cycle that finds it held by a window refuses the
same way.

### Stage 1 — the legacy refresh, in shadow

`git fetch origin main`; a git worktree at `.window/checkout` (gitignored) on
`origin/main`; a `node_modules` junction to the runner checkout's
`node_modules`; `corepack pnpm refresh:daily` in that checkout; then the
checkout is reset to `origin/main` and cleaned. **Nothing is committed or
pushed, and the main checkout is never dirtied.** The per-source outcomes are
read from `docs/refresh-run.json` (Lane A's `formatVersion: 1` contract, parsed
exactly by `parseRefreshRunJson`); when that file is absent the Markdown table
in `docs/refresh-run.md` is parsed instead and the window record SAYS SO
(`source: "MARKDOWN_FALLBACK"`). A non-zero exit, a timeout, or an unreadable
report is a FAILED stage with the reason and an incident naming the failed
sources.

### Stage 2 — pipeline evaluation

For every item: `PROMOTE_WOULD` (APPROVED_FOR_PROMOTION and its record class is
in the gate's open set), `REFUSE_WOULD` (the failing stage or the closed class,
named), or `DEFER` (a window-level reason). Grouped by record class with
denominators. Then `runPromotionStep`, which never calls the promoter while the
gate is closed and, once open, only for `PROMOTE_WOULD` verdicts.

The activation gate reads READER / TRUTH / FRESHNESS from the newest
freshness-shadow run record's `health.readings` and its provenance; an
unreadable record is UNREAD, and UNREAD is not GREEN. The low-risk candidates
for the first classes to open — meeting times, agendas, published minutes,
routine filings — are NAMED in `LOW_RISK_CANDIDATE_CLASSES` for a later
decision; `OWNER_APPROVED_CLASSES` stay closed until approved by name.

### Stage 3 — post-promotion verification, as if promoted

`scripts/staging-observer.mts --attempts=3` (no `--write`) is run by name as the
served-surface check and its verdict recorded "as if promoted". The real path
once the gate is open: promotion is ONE COMMIT through the existing shipping
door; verification is the production observer, the reader suite and the
relevant visual checks; a regression reverts the batch commit through the same
door and opens an incident. `decideRegression` is the pure decision
(`REVERT_AND_INCIDENT` on a failed verification; `INCIDENT_WITHOUT_REVERT` when
the instrument could not tell — a revert on a guess would be a second
unverified change; `NONE` when nothing promoted or everything passed) and
`dryRunRevert(planRevert(sha, incidentId))` is the executor that records what
it would do and runs nothing.

### Stage 4 — the digest and the record

- `data/health/nightly-window-runs/<day>-NN.json` — the `WindowRunRecord`,
  committed like `freshness-shadow-runs`;
- the `window_runs` log (Postgres, so the admin host can read it), keyed by the
  America/New_York date the window answered for;
- the `window_incidents` log, one row per stage failure, keyed by window id;
- `<mirror>/nightly-window-digest.md` (a STABLE name) and
  `<mirror>/nightly-window-log.md` (every window's headline, appended),
  delivered exactly as the pilot digest is — the Drive mirror, or `.mirror/` in
  the repository when the mirror is unreachable, and the record says which.

### Failure semantics and catch-up

Any stage failure opens a typed `WindowIncident` carrying the stage, a code,
the detail, and `missedScope` — what the next window must catch up, by name.
The digest states the failure. A window that crashes writes a crash record and
an incident before exiting 1. Exit codes: 0 clean; 2 a stage FAILED and is
recorded; 3 the lease is held.

`windowDue` names the local date owed (the most recent 04:00 America/New_York
boundary at or before now) and every earlier local date no window answered for
since the last recorded one, oldest first. A runner that was down across 04:00
runs the missed window at its first poll, and the record's `caughtUp` lists the
dates by name. With no prior window recorded nothing is claimed missed — no
state is not permission to invent state.

---

## The clock

**The pilot runner is the clock.** Between cycles, its one-minute poll asks
`windowDecision()` whether the window for the current America/New_York date has
run, and runs `scripts/nightly-window.mts --shadow --trigger=<RUNNER_CLOCK|CATCH_UP|WAKEUP>`
when it has not, or when a `RUN_WINDOW_NOW` intent is pending. DST is the
zone's business: the boundary is computed with `Intl` in `America/New_York`.

**The backup wakeup** is a Scheduled Task, "WeThePeople Nightly Window",
registered by `pnpm pilot:install-window` with a daily trigger per host-local
equivalent of 04:00 Eastern (standard and daylight, both computed from the
Windows "Eastern Standard Time" zone at install time). It runs
`scripts/nightly-window.mts --wakeup`, which appends `RUN_WINDOW_NOW` to the
`window_intents` log when the runner is ALIVE (by its heartbeat) and runs the
window itself under the lease when it is not. Registration needs an elevated
shell on this host, as the runner's task does; unelevated, the action prints
the refusal and the exact one-liner:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action install-window
```

**The GitHub scheduled workflow (`refresh-daily.yml`) is demoted to a backup
wakeup.** It is not the clock and it is not the door. Lane A owns the file; the
comment block to add is in the session report.

---

## Commands

```bash
pnpm window:run --shadow            run the window now, in shadow
pnpm window:run --shadow --force    run again for this local date (recorded MANUAL)
pnpm window:run --wakeup            the backup wakeup
pnpm window:readback                the newest window record, its incidents, the pipeline counts
pnpm pipeline:map                   map existing evidence into the pipeline, idempotently
pnpm pilot:install-window           register the backup wakeup task (elevated)
```

`--provider=file` runs any of them against the file store under
`data/control-plane/freshness-shadow/`; `--skip-legacy` and `--skip-verify` are
diagnostics that record the stage SKIPPED by name.

---

## Schema v5, and the safe order

`BOOTSTRAP_VERSION` moves 4 → 5 with four append-only logs:
`promotion_pipeline`, `window_runs`, `window_incidents`, `window_intents`.
`bootstrap()` is `CREATE TABLE IF NOT EXISTS` and records the version on every
connect, so the change is additive — but a runner on OLDER code re-records
version 4 on its next connect, and `pnpm control-plane:gate` from that code
reports the four new tables as undeclared. The safe order is: merge this to
`main`; let the standing runner's checkout reach the new code (it runs from the
main checkout); then `pnpm control-plane:bootstrap` (with `--env-file`) and
`pnpm control-plane:gate` from the new code. Between the first v5 connect and
the runner's update the recorded version oscillates and no data is lost.

## What is measured, and what is not

The control scores in every window record are `null` — NOT MEASURED — because
no window batch carries injected controls yet. That refuses AUDITED for every
item, and the digest says so in those words. Printing a zero would assert a
measurement nobody took.
