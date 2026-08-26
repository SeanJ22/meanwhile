# R59, staged for the moment the push unblocks

Written 2026-08-26 by the unblock-pushers session, so the next session finishes
this in one move rather than re-deriving it.

**State: `R59` is RESOLVED.** Its two real failures are fixed and `Refresh
(daily, all sources)` passes `Validate before committing`. What remains is not
R59 — it is `NH203`, the push blocker, and it is Sean's settings change.
`docs/branch-protection-clicklist.md` is that change.

Do not start here. **Confirm the settings change landed first:**

```bash
pnpm protection:verify
```

`INTACT` and exit `0`, or stop — everything below will fail at the same place.

---

## The re-dispatch, exactly

```bash
gh workflow run refresh-daily.yml --repo SeanJ22/We-The-People --field all_sources=true
```

`all_sources=true` ignores the per-source cadence and runs every source, which
is what is wanted here: the point is to prove the whole chain end to end, not to
wait for each source's own day. It is the same input `refresh-daily.yml`
documents as *"for proving a source end-to-end without waiting for its Monday."*

Then find the run and watch it:

```bash
gh run list --repo SeanJ22/We-The-People --workflow=refresh-daily.yml --limit 1
gh run watch <run-id> --repo SeanJ22/We-The-People
```

### The run ids to check against

These are the failures this is being compared to. All three are `refresh-daily`,
all on 2026-08-26, all refused at the push:

| Run id | Event | Where it died |
| --- | --- | --- |
| `32955499285` | `schedule` | `protected branch hook declined` |
| `32951929034` | `workflow_dispatch` | same |
| `32950685105` | `workflow_dispatch` | same |

---

## What a genuine success looks like

**Not** "the run is green." A green run is also what an early exit looks like
when no artifact moved, and that would prove nothing about the push.

All five, together:

1. **The push step actually ran and said so.** The log carries
   `push-main: path guard PASSED for refresh-daily` followed by
   `push-main: pushed on attempt 1 of 5`. If the guard line is absent the commit
   step never ran; if the guard line says `REFUSED` the workflow tried to write
   something outside `data/` and `docs/refresh-run.md`, which is a finding, not
   a retry.
2. **A commit is on `main`, authored `github-actions[bot]`**, message
   `Daily refresh: <timestamp>`:
   ```bash
   git fetch origin && git log origin/main --oneline -3 --format='%h %an %s'
   ```
3. **The rows are actually current** — the claim, not the run's colour:
   ```bash
   pnpm source:headroom
   ```
   Every source's *oldest row* must have moved forward from the table below.
   `clerksboards` at `2026-06-03` is the one that had crossed; it should read a
   later date.
4. **The F22 staleness guard passes on real freshness, not a widened window.**
   The `Validate before committing` step runs the full suite before anything is
   committed — so a green push already means the guard passed. What must be
   checked by hand is that **nobody widened it to make that true**:
   ```bash
   git log --oneline -5 -- lib/meetings/ tests/
   git diff origin/main~1 origin/main -- '*lookback*' '*window*'
   ```
   A guard that went green because its threshold moved is the ceiling raised to
   fit the change it was supposed to catch.
5. **Exactly one commit, not five.** RULING 124: one orchestrated run, one
   commit however many sources moved.

---

## Today's headroom, re-confirmed

Measured **2026-08-26** by `pnpm source:headroom` against the committed
snapshot (`generatedAt 2026-08-26T05:58:08Z`). Serving window 90d; each source's
edge is its own declared window.

| Source | Oldest row | Window | Headroom | Rows |
| --- | --- | --- | --- | --- |
| `ical` | 2026-05-28 | 90d | **0.63d** | 141 |
| `legistar` | 2026-06-01 | 90d | **4.71d** | 16 |
| `apptegy` | 2026-06-03 | 90d | **5.83d** | 17 |
| `diligent` | 2026-06-03 | 90d | **6.38d** | 42 |
| `clerksboards` | 2026-06-03 | 90d | **6.38d** | 71 |
| `schedulepage` | 2026-06-04 | 90d | **7.69d** | 61 |
| `boardbook` | 2026-06-10 | 90d | **12.79d** | 6 |
| `iqm2` | 2026-06-10 | 90d | **13.63d** | 18 |
| `onbase` | 2026-07-07 | 90d | 40.63d | 11 |
| `civicplus` | 2026-01-06 | none | n/a | 51 |
| `revize` | 2026-02-09 | none | n/a | 15 |

**8 of 11 sit under 14 days.**

**The numbers have not moved since the prior session measured them — they are
identical to the digit.** That is itself the finding: nothing has landed, so
nothing could move. The brief expected them to have shifted, and the reason they
have not is the blocker this session is about.

**No new rows were opened for these eight.** `NH197` already covers all eight,
opened earlier today, and it explains why one row rather than eight: every
adapter clips to the same 90 days at fetch time and the snapshot stamps
`generatedAt` minutes later, so a 90d-clipped source lands within about a day
and a half of its own edge **permanently, by construction**. Eight rows
describing one architectural fact would be eight copies of a finding rather than
eight findings, and duplication in the tracker is worse than a gap.

**What is actually worth watching is not the headroom** — it is a constant —
**but the CLOCK GAP.** The guard tolerates one day between an adapter's
fetch-time back edge and the snapshot's `generatedAt`. A refresh that takes
longer than that between its first source and its stamp trips a source that
declared itself correctly. That is `NH197`, and it stays open.
