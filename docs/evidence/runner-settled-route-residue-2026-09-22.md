# Runner: settled-route residue, and its owner-approved repair (2026-09-22)

**Status: R1–R3 EXECUTED 2026-09-23T00:34:14Z**, after the owner approved R1, R2 and R3 and Admin <!-- expected-future: a UTC instant; the Phoenix stamp date is still 2026-09-22 -->
reviewed the exact transaction. R4 and R3b were not approved and were not run. The execution record
is [below](#execution-record-2026-09-23). <!-- expected-future: a UTC instant; the Phoenix stamp date is still 2026-09-22 -->

The plan rested on one `READ ONLY` Postgres transaction against the production control plane at
2026-09-22T22:33:21Z; its rows are in
[`runner-settled-route-residue-2026-09-22.json`](runner-settled-route-residue-2026-09-22.json).

## In plain terms

A freshness cycle writes its conclusion about a route (the *disposition*) during its run, but marks
the scheduled piece of work around it (the *occurrence*) finished only at the end of the cycle. When
a cycle died in between — the 2026-09-01/02 crash loop, and again on 2026-09-19 — the route was
settled but its occurrence still read as open, so later cycles walked the route **again**. Each
repeat walk:

- overwrote the RouteTask's state from `DISPOSED` to `CLAIMED` (the disposition itself survived);
- opened a second Attempt that no disposition could close (a route is never disposed twice) and
  that the reclaim path refuses to reopen;
- left its lease unreleased, and the pre-dispatch sweep re-walked those dead leases every cycle
  (348 s of a 417 s window on 2026-09-22), so the deterministic lane dispatched nothing;
- repeated real work against a publisher, or a paid Scout, for a record already acquired or a route
  already settled.

No reader page changed: this runner stages and never promotes. What readers lost was freshness, and
what the owner lost was runner time and spend.

## Production readback

| Residue | Count | Shape |
| --- | --- | --- |
| RouteTasks disposed but in state `CLAIMED` | 65 | 9 INGESTED, 50 REQUIRES_NEW_ADAPTER, 6 BLOCKED_CURRENTLY; each at revision 4, each with 1–8 redundant `ABORTED` Attempts and an unreleased expired lease; every occurrence already closed |
| Attempts never closed (`outcome` null) | 8 | all on 2 of those tasks (`rt-af50c912c397e15a14d663d9` ×7, `rt-e74046b22a7b0204fff2aefd` ×1), City of Tucson Clerk route, started 2026-09-01T20:56Z–2026-09-02T03:09Z, each under a lease a later claim superseded; no artifact or cost attributed to any |
| Claim-only lease from the P2 contention proof | 1 | `rt-a0c6bb05d955ba63cd7717ac`, holder `proof-worker-19924`, expired 2026-08-31T14:30Z, no Attempt, WorkItem project `control-plane-proof` |
| **Open occurrences on already-disposed RouteTasks** | **62** | all from the 2026-09-01T19:36:07.092Z cycle; all due candidate-enrichment rows: 19 `candidate-authored-awaits-site` (Scout lane), 32 `candidate-wikipedia-api` and 11 `candidate-marginalia-index` (deterministic HTTP) |
| Disposition commits whose aggregates differ from the committed values | 65 | of 1,361 commits, exactly these 65 RouteTasks, and only in `state`; 0 Attempts differ |

Why so many share one timestamp: a disposition carries the dispatching cycle's start time, so all
of one cycle's dispositions share it. The 19:36:07.092Z cycle committed 83; no cycle record exists
between 19:20Z on 09-01 and 06:00Z on 09-02, consistent with the crash loop in `5a870f12`. 21 of the
83 were later re-walked, which produced 21 of the 65; the other 62 are still open and waiting.

**The 62 are the live half of the defect.** Under the code on `main`, each is re-walked as soon as its
row is admitted: 19 by a Scout, 43 by a real request to Wikimedia or Marginalia. The deterministic
lane has been starved by the dead-lease sweep, so shipping the sweep fix *alone* would un-starve it
straight into 43 of those re-walks. Ship the sweep fix and the prevention together, as this branch does.

## The code change on this branch

- `resumeOpenOccurrence` (`lib/control-plane/scheduler/durable.ts`) reads the occurrence's RouteTask.
  One that already carries a disposition comes back `SETTLED`, with the disposition verbatim. It is
  never handed to dispatch.
- `runCycle` recovers a settled occurrence instead of dispatching it: no claim, no Attempt, no lease.
  It applies the rule a dispatch's own disposition is judged by (`DISCHARGING_DISPOSITIONS`) to debt,
  and reports the recovery apart from dispatches. `closeCycleOccurrences` closes it through
  `closeSettledOccurrence`, anchoring a reading at the disposition's own time.
- `claimRouteTask` (`lib/control-plane/repository/coordinator.ts`) refuses a disposed non-worker
  RouteTask with `RouteTaskSettled` and writes nothing. The check runs before the lease slot is
  touched; a race that finds the task disposed after winning the slot gives the lease back. Every
  existing refusal is unchanged.
- The promotion tail (`scripts/freshness-shadow.mts`) stages a recovered disposition as it would a
  dispatched one, reading its bytes back from the durable vault by held identity
  (`CycleVault.readHeld`), because this cycle's ledger never saw them.
- Carried from `claude/runner-dead-lease-sweep`: a dead lease on a settled route is released once,
  and the sweep reads Attempts with a filtered query.

## What "discharge" closes, and what stays owed

Discharge closes **this occurrence**: its `closedAt` and `disposition`; on the obligation,
`openOccurrenceId` is cleared, `lastWorkedAt` moves and any argued absence (`absentUntil`) is
cleared; and the cycle writes the freshness debt row as a cleared tombstone. Nothing else.

- The standing obligation never completes. It comes due again from the moved anchor, and a recovered
  reading anchors at the time it was actually taken, not at the recovery.
- The RouteTask, its Attempts, the disposition commit, the artifact records and the costs are not
  written. The WorkItem is not transitioned.
- **INGESTED:** the bytes stay where the next stages read them. The held-evidence workers
  (`advanceHeldWorkerFleet`) read the artifact log and queue Parser, then Validator, then Auditor,
  whatever the occurrence's state. The promotion tail now stages recovered bytes too. Publication
  stays human-gated, as before.
- **WALKED_NO_YIELD:** this counts only as this period's reading of this one route. It is never an
  absence of the record. The next occurrence walks again under a new RouteTask, inheriting the
  earlier disposition as prior evidence.
- **Anything else** (REQUIRES_NEW_ADAPTER, BLOCKED_CURRENTLY, POINTER_ONLY, …): the occurrence closes
  unresolved and debt accrues, exactly as for a dispatched non-reading. The obligation retries on its
  backoff under a new RouteTask.
- **Aborted or interrupted work** (no disposition) is not settled. It is resumed and dispatched as
  before, and its earlier Attempt and partial evidence are kept.

`tests/settled-occurrence-recovery.test.ts` proves each line above on the memory and file stores.
With either half of the fix reverted, the tests that cover that half fail.

## No manual repair for the 62 open occurrences

Once this branch is deployed, the runner recovers each one when its row is next admitted:

- the 11 INGESTED close discharged, anchored at 2026-09-01T19:36:07.092Z, and are staged;
- the 51 REQUIRES_NEW_ADAPTER close unresolved, with debt.

Closing them by hand would bypass the debt accounting and the promotion tail. Until the deploy, a
research pause holds the 19 Scout rows. Nothing holds the 43 deterministic rows except the lane
starvation this deploy ends, and it ends both at once.

## The repair, for approval

**Order.** (1) Merge and deploy this branch, so no new residue can form; the sweep then releases the
65 dead leases on its next cycle. (2) Then, with the owner's yes, run the transaction below between
cycles, with the runner paused (`PAUSE_RUNNER`) or the `nightly-window` lease held, so that no cycle
writes concurrently.

### R1 — restore `DISPOSED` on the 65 RouteTasks (recommended)

`state` is a projection the redundant claims overwrote; the disposition, which is the record, is
intact. Readers that trust `state` currently say false things about these 65:

- `evaluateCompletion` refuses them as "currently claimed and still executing";
- the fleet-operations view counts them in flight and needing lease reconciliation.

After R1:

- the 56 open dispositions (REQUIRES_NEW_ADAPTER, BLOCKED_CURRENTLY) are refused **by name** as still
  owed;
- the 9 INGESTED become terminal at the route level only. Every other completion clause
  (validation, audit, promotion) still applies, so nothing reads as done that is not.

**Writes:** `state` only. Every other field is byte-identical: the disposition, `attemptIds` and
`workItemId`. The revision bumps under a guard on the revision read (4).

This is the value the control plane itself committed. Each disposition commit carries the exact
RouteTask it disposed, and the coordinator's `reconcile()` restores that value wherever the persisted
task differs from it. Today it differs for exactly these 65 tasks, and only in `state`. So R1 is
the replay `reconcile()` would perform, and it would also release their leases (R4). Running
`reconcile(repos, now)` once, serialized with the runner, is therefore an equivalent way to execute
R1 and R4. The guarded statement below is preferred because it refuses any drift.

### R2 — close the 8 never-closed Attempts as `LEASE_EXPIRED` (recommended)

Each Attempt was opened during 2026-09-01/02 and never closed; its lease stopped being renewed, and
a later claim replaced that lease. `LEASE_EXPIRED` is the closure `reclaimRouteTask` gives exactly this
case, observed from outside. Nothing else can close them: the sweep keys on the current lease slot
and never reads an Attempt on a settled route.

| Alternative | Why not |
| --- | --- |
| Leave them open | They read as running forever. |
| `ABORTED` | Implies a living worker gave up. |
| `COMPLETED` | Would manufacture a success. |
| Delete | Would erase history. |

**Writes:** exactly what `endAttempt(…, "LEASE_EXPIRED")` writes:

- `outcome`;
- `endedAt`, set to the repair time;
- a named `abortReason`.

`artifactIds` (empty) and `cost` (zero) are untouched. The RouteTask is not written, and nothing is
reopened or disposed.

### R3 — release the proof fixture's lease (recommended)

This lease is refused as `NothingToReclaim` on every cycle, by design. **Writes:**
`lease.released = true`, the same single write every release performs. The RouteTask (state
`CLAIMED`, no Attempt) and its WorkItem stay as the proof's recorded fixture, which
`data/health/control-plane-proofs/proof-mthbrw87.json` cites. One projection stays false: the task
still reads `CLAIMED` with nothing holding it. Returning it to `PENDING` would be accurate and inert,
since nothing schedules it. That is offered as **R3b**, and it is not part of the recommendation
unless the owner wants it.

### R4 — release any of the 65 dead leases the sweep has not (conditional)

After step (1) this is normally a no-op. It is the same single write the sweep performs, limited to
expired, unreleased leases on those 65 tasks.

### Not repaired, on purpose — this is history

| Left as is | Why |
| --- | --- |
| The 65 occurrences that redundant dispatches closed "unresolved" | They record what happened. Rewriting them as discharged would manufacture a success after the fact, and later occurrences have since moved each clock on. |
| The redundant `ABORTED` Attempts (1–8 per task) | True records. |
| The debt those dispatches accrued | Later cycles have superseded it. |
| Disposition commits, artifacts, costs, scout results | Untouched. |
| The staging-manifest entries that read "we have not yet reached it" for those 9 INGESTED records | A local diagnostic under `.runtime/`; the next staged cycle for each obligation replaces it. |

### Procedure

1. Re-run the read-only readback. Proceed only if it still shows exactly 65, 8 and 1 matching the
   evidence file (task revision 4, attempt revision 1, proof lease revision 1).
2. Export the before-image — the full rows of the 65 tasks, their leases, the 8 Attempts and the
   proof lease — to `docs/evidence/runner-settled-route-residue-before-<stamp>.json` with its sha256.
3. Run the four statements below as **one** transaction (`sql.transaction([...])`). Each guarded
   statement divides by zero unless it wrote exactly the approved number of rows, so any drift aborts
   the whole transaction with nothing written. `$1` is the 65 route-task ids and `$3` the 8 Attempt
   ids from the evidence file; `$2` is the repair time as an ISO string.
4. Read back, export the after-image beside the before-image, and check four things: 0 disposed
   tasks in `CLAIMED`, 0 open Attempts on disposed tasks, the proof lease released, and every
   disposition byte-identical before and after.

```sql
-- R1: 65 RouteTasks, state only.
WITH restored AS (
  UPDATE cp_route_tasks
     SET value = jsonb_set(value, '{state}', '"DISPOSED"'), revision = revision + 1, updated_at = $2::timestamptz
   WHERE id = ANY($1::text[]) AND revision = 4
     AND value->>'state' = 'CLAIMED'
     AND jsonb_typeof(value->'disposition') = 'object'
     AND NOT (value ? 'workerTask')
  RETURNING id)
SELECT 1 / (CASE WHEN count(*) = 65 THEN 1 ELSE 0 END) AS r1 FROM restored;

-- R4: whatever dead leases on those 65 the sweep has not released (normally none).
UPDATE cp_leases
   SET value = jsonb_set(value, '{released}', 'true'), revision = revision + 1, updated_at = $2::timestamptz
 WHERE id = ANY($1::text[])
   AND (value->>'released')::boolean = false
   AND (value->>'expiresAt')::timestamptz < $2::timestamptz;

-- R2: 8 Attempts, closed from outside as their dead workers' leases expired.
WITH closed AS (
  UPDATE cp_attempts a
     SET value = a.value || jsonb_build_object(
           'outcome', 'LEASE_EXPIRED',
           'endedAt', $2::text,
           'abortReason',
             'Opened at ' || (a.value->>'startedAt') ||
             ' during 2026-09-01/02 and never closed. Its lease ' || (a.value->>'leaseId') ||
             ' stopped being renewed and a later claim replaced it. Its RouteTask had already been disposed ' ||
             (rt.value->'disposition'->>'disposition') || ' by Attempt ' || (rt.value->'disposition'->>'attemptId') ||
             ', so this Attempt reached no conclusion and none is recorded. No artifact or cost was attributed ' ||
             'to it. Closed from outside by the owner-approved residue repair of ' || $2::text || '.'),
         revision = a.revision + 1, updated_at = $2::timestamptz
    FROM cp_route_tasks rt
   WHERE a.id = ANY($3::text[]) AND a.revision = 1
     AND jsonb_typeof(a.value->'outcome') = 'null'
     AND rt.id = a.value->>'routeTaskId'
     AND jsonb_typeof(rt.value->'disposition') = 'object'
     AND NOT EXISTS (
       SELECT 1 FROM cp_leases l
        WHERE l.id = rt.id AND l.value->>'id' = a.value->>'leaseId'
          AND (l.value->>'released')::boolean = false
          AND (l.value->>'expiresAt')::timestamptz > $2::timestamptz)
  RETURNING a.id)
SELECT 1 / (CASE WHEN count(*) = 8 THEN 1 ELSE 0 END) AS r2 FROM closed;

-- R3: the proof fixture's claim-only lease.
WITH released AS (
  UPDATE cp_leases l
     SET value = jsonb_set(l.value, '{released}', 'true'), revision = l.revision + 1, updated_at = $2::timestamptz
   WHERE l.id = 'rt-a0c6bb05d955ba63cd7717ac' AND l.revision = 1
     AND l.value->>'id' = 'ls-3a87c09763b1876096715614'
     AND l.value->>'holder' = 'proof-worker-19924'
     AND (l.value->>'released')::boolean = false
     AND NOT EXISTS (SELECT 1 FROM cp_attempts a WHERE a.value->>'routeTaskId' = l.id)
  RETURNING l.id)
SELECT 1 / (CASE WHEN count(*) = 1 THEN 1 ELSE 0 END) AS r3 FROM released;
```

## The question for the owner

Approve **R1**, **R2** and **R3** as written, to run after this branch is deployed? R4 comes along
as a guarded no-op, and **R3b** runs only if you ask for it. Each item can be approved on its own.

**Answered 2026-09-22.** The owner approved R1, R2 and R3, conditional on Admin reviewing the actual
transaction against that scope. It was to run only after deployment, at a safe point between cycles,
with protection against concurrent change, exact expected rows, and rollback on any difference. The
approval covered no other rows or repairs, so R4 was dropped: its precondition became "the deployed
sweep has already released all 65 leases", which the pre-check confirmed.

## Execution record (2026-09-23) <!-- expected-future: a UTC instant; the Phoenix stamp date is still 2026-09-22 -->

**Deployment first.** The prevention shipped as PR #358, merged at 00:11:33Z as `37d330db`. Its PR
run (full certification) was 11/11 green; its main run was Build check `35800950259`. The
post-deploy observer (run `35800950252`) reported meanwhileusa.com serving `37d330db` (outcome
SERVING_EXPECTED; integrity HELD, 29/29 migrations; receipt
`production-integrity:37d330db…:2026-09-23T00:13:00.022Z`). The runner's runtime checkout switched <!-- expected-future: a UTC instant; the Phoenix stamp date is still 2026-09-22 -->
to `37d330db` at the 00:23Z handoff. The one cycle that ran the sweep without the prevention
(00:07:31Z, on `c61dbc2d`) started 21 Attempts, and 0 of them were on an already-settled task.

**Transaction 1 — R1, R2 and R3, at 00:34:14Z.**

- **Guard.** It ran under the `nightly-window` lease, held by `residue-repair@29412` and released
  afterwards, in a slot Admin confirmed. The pre-checks passed immediately before it: 65 / 0
  unreleased leases / 8 / 1, and no CLAIMED-but-disposed row outside the 65.
- **Result.** `[window_held 1, r1 1, r2 1, r3 1]`: exactly 65, 8 and 1 rows.
- **Post-check.** r1 = 65: every task is now at revision 5 and byte-equal to its committed
  `disposedTask`. r3 = 1. Commits on the 65 tasks: 65, unchanged.
- **Images.** Before: `runner-settled-route-residue-before-2026-09-22.json`, sha256 `f13266b4…`.
  After: `runner-settled-route-residue-after-2026-09-22.json`, sha256 `e14ac09a…`.
- **Field diff between the two images.** 65 tasks changed `state` only. The 65 leases and 65
  commits are unchanged. The 8 Attempts changed only `outcome`, `endedAt` and `abortReason`. The
  proof lease changed only `released`.

**Transaction 2 — R2 format correction, at 00:37Z.**

- **The defect.** R2's timestamp parameter was also cast `::timestamptz` in the same statement, so
  Postgres typed it as a timestamp. The 8 Attempts therefore stored `endedAt` as
  `2026-09-23 00:34:14.194+00`, not the ISO `2026-09-23T00:34:14.194Z` that `endAttempt` writes, and <!-- expected-future: a UTC instant; the Phoenix stamp date is still 2026-09-22 -->
  their `abortReason` repeated the same text. The instant was right; the representation was not.
- **The fix.** A second transaction, reviewed by Admin as inside R2's scope, rewrote only that
  representation on exactly those 8 rows. It bound the ISO string as its own text parameter, was
  guarded by revision 2 and the exact bad value, and ran under the window lease.
- **Result.** `[window_held 1, r2_iso 1]`.
- **Post-check.** 8 of 8 rows are at revision 3 with an ISO-Z `endedAt`, and no `+00` remains in any
  `abortReason`.
- **Class-wide check.** Before the fix, the only non-ISO-Z values in `cp_attempts` (`startedAt` and
  `endedAt`), `cp_route_tasks` (`disposition.at`) and `cp_leases` (`expiresAt`, `claimedAt`,
  `heartbeatAt`) were those 8. After it, all are 0.
- **Image.** `runner-settled-route-residue-after-iso-2026-09-22.json`, sha256 `edadc555…`. Against
  the transaction-1 after-image, only `endedAt` and that timestamp text changed, on the same instant.

**The executors that ran are preserved verbatim.** Files:
`runner-settled-route-residue-executor-2026-09-22.mts.txt` (sha256 `d965913d…`) and
`runner-settled-route-residue-r2-iso-executor-2026-09-22.mts.txt` (sha256 `e1ec1b8d…`). Nothing was
deleted. No disposition, artifact, cost, debt or occurrence was written by either transaction.

**The first cycle on `37d330db`**, 01:27:03Z–01:38:07Z. It ended not-OK and wrote no cycle record.

- It started 25 Attempts (17 COMPLETED), and **0 were on an already-settled task**.
- Afterwards: 0 CLAIMED-but-disposed tasks, 0 open Attempts, 0 unreleased expired leases.

**The 62 occurrences are pending, not yet recovered.** At 01:46Z all 62 were still open, each with
1 Attempt and a released lease: none re-walked, none recovered. They recover when their rows are
admitted, and the due queue is long. Their ranks among ~2,865 eligible due obligations, oldest
first, are:

| Route | Rows | Rank |
| --- | --- | --- |
| Marginalia | 11 | 655–826 |
| Wikipedia | 32 | 643–2621 |
| Authored-site | 19 | 17–2618, on the Scout lane, which is closed while no delivery path is open |

Admin's per-cycle check watches for their recovery signature: the occurrence closed `INGESTED`
(11) or unresolved "already disposed …" (51), still 1 Attempt, and an unchanged lease revision.

**What recovery will and will not move for the 11 INGESTED records.** Their bytes (Marginalia search
results) are held only in the main checkout's vault, not the runtime vault. The fixed runner will
stage them as acquired but still owed.

- No parser or verifier exists for this discovery-only class: `NORMALIZERS` has none, and
  `advanceHeldWorkerFleet` queues only held meeting-event contracts.
- None of them is verified or published, and nothing reaches a reader.

**Follow-ups, recorded and not blocking.**

1. The runner never reconciles an *unapplied* disposition commit. Production had 0 at every read.
2. The runtime can't read vault objects written before the runtime checkout existed. This is the
   same gap as the 11 records above.
