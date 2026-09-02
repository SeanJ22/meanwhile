# Finishing the unblock, in one move

Written 2026-08-26 by the unblock-pushers session. **Rewritten 2026-08-26 by
the deploy-key cutover session**, which changed what "finishing" means: the
blocker is no longer a settings change, it is one dispatch.

---

## Where this stands

| | State | Read from |
| --- | --- | --- |
| `R59`'s two real failures | **RESOLVED** — `Refresh (daily, all sources)` passes `Validate before committing` | prior session |
| Sean's ruleset clicks | **LANDED** — ruleset `main` `21572280`, Active, bypass `DeployKey` / `exempt`, classic rule gone (`branches/main/protection` → HTTP 404) | GitHub API, 2026-08-26 |
| The deploy key | **PRESENT** — `wtp-scheduled-pushers`, write-enabled, 1 of 1 | `repos/…/keys` |
| `PUSH_DEPLOY_KEY` secret | **PRESENT** — created `2026-08-26T15:34:39Z` | `repos/…/actions/secrets` |
| The cutover in code | **SHIPPED** — `scripts/push-main.mjs` pushes over SSH as a deploy key | this session |
| **The push itself** | **UNPROVEN** — `last_used` on the key is `null`. It has never authenticated. | `repos/…/keys` |

**That last row is the whole of what is left**, and only a dispatch can change
it. `docs/deploy-key-setup.md` Step 5 is the same instruction written for Sean.

Confirm the settings first — everything below fails at the same place if this
is not `INTACT`:

```bash
pnpm protection:verify
```

It read **`INTACT — 9 of 9 assertions hold (ruleset)`** on 2026-08-26. Exit `0`,
or stop.

---

## The re-dispatch, exactly

```bash
gh workflow run refresh-daily.yml --repo SeanJ22/meanwhile --field all_sources=true
```

`all_sources=true` ignores the per-source cadence and runs every source, which
is what is wanted here: the point is to prove the whole chain end to end, not to
wait for each source's own day. It is the same input `refresh-daily.yml`
documents as *"for proving a source end-to-end without waiting for its Monday."*

Then find the run and watch it:

```bash
gh run list --repo SeanJ22/meanwhile --workflow=refresh-daily.yml --limit 1
gh run watch <run-id> --repo SeanJ22/meanwhile
```

### The run ids to check against

These are the failures this is being compared to. All `refresh-daily`, all
2026-08-26, all refused at the push with `protected branch hook declined` — the
`GITHUB_TOKEN` over HTTPS, which the ruleset does not exempt:

| Run id | Event | Started | Where it died |
| --- | --- | --- | --- |
| `32955499285` | `schedule` | 09:54:45Z | `protected branch hook declined` |
| `32951929034` | `workflow_dispatch` | 09:14:23Z | same |
| `32950685105` | `workflow_dispatch` | 09:00:19Z | same |
| `32949636142` | `workflow_dispatch` | 08:48:11Z | same |

**Every run before the cutover commit is one of these**, whatever its id. The
comparison that matters is not "a newer id" — it is the push step's own log
lines, below.

---

## What a genuine success looks like

**"The run is green" is not it, and this is the trap.** `refresh-daily` exits 0
by design when no artifact moved — `steps.diff.outputs.changed == 'true'` gates
the Commit step, so **a run in which nothing changed skips the push entirely and
reports success.** That green run proves nothing about the deploy key, and it
looks identical to the one that does.

**The distinguishing evidence is a log line, not a colour.** Six, together:

1. **The push chose SSH.** The log carries:
   ```
   push-main: pushing to git@github.com:SeanJ22/meanwhile.git as a deploy key
   ```
   **If this line is absent, the Commit step never ran** — the run early-exited
   and told you nothing. Re-dispatch after forcing a change, or wait for a day
   the data moves. **Do not record an early exit as a success.**

   If instead it says `not github.com`, the remote is misconfigured and it was
   about to push over a transport the ruleset refuses.

2. **The guard ran and passed:**
   ```
   push-main: path guard PASSED for refresh-daily
   ```
   If it says `REFUSED`, the workflow tried to write something outside `data/`
   and `docs/refresh-run.md`. That is a finding, not a retry — read the named
   path.

3. **The push landed:**
   ```
   push-main: pushed on attempt 1 of 5
   ```

4. **A commit is on `main`**, authored `github-actions[bot]`, message
   `Daily refresh: <timestamp>`:
   ```bash
   git fetch origin && git log origin/main --oneline -3 --format='%h %an %s'
   ```

5. **The key's `last_used` is no longer `null`** — the one external anchor for
   "this key authenticated", read from GitHub rather than inferred from a colour:
   ```bash
   gh api repos/SeanJ22/meanwhile/keys --jq '.[] | "\(.title) last_used=\(.last_used)"'
   ```

6. **Exactly one commit, not five.** RULING 124: one orchestrated run, one
   commit however many sources moved.

### And one thing to check by hand

**The F22 staleness guard must have passed on real freshness, not a widened
window.** `Validate before committing` runs the full suite before anything is
committed, so a green push already means the guard passed. What it cannot tell
you is whether somebody moved the threshold to make that true:

```bash
git log --oneline -5 -- lib/meetings/ tests/
git diff origin/main~1 origin/main -- '*lookback*' '*window*'
```

A guard that went green because its threshold moved is the ceiling raised to fit
the change it was supposed to catch.

---

## Headroom as of 2026-08-26 — and why this table has not moved

Measured by `pnpm source:headroom` against the committed snapshot
(`generatedAt 2026-08-26T05:58:08Z`).

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

### NOTHING HAS CROSSED, AND NOTHING IN THIS TABLE CAN

**This is the third session to measure these numbers and the third to get them
identical to the digit, and the reason is arithmetic rather than stagnation.**

`headroom = oldestRow + window − generatedAt`. **Both `oldestRow` and
`generatedAt` are frozen values inside a committed artifact.** The number is a
constant until a refresh lands. It does not tick, it cannot cross by the passage
of time, and a brief expecting it to have moved is expecting the wrong thing of
it.

That is not a defect. It is the correct question for the **F22 guard**, which
measures a snapshot against the instant it was built.

`ical`'s margin, stated exactly rather than by feel: the guard passes when
`oldestRow ≥ generatedAt − (window + 1 day)` — the one-day tolerance being the
fetch-to-stamp clock gap (`NH197`). `ical` sits at **+0.63d**, so it has
**1.63 days** of margin against the guard, not −0.37. Measured against *today's*
clock instead it is at **+0.21d**, still inside, with 1.21 days of margin.

### The clock that DOES move, and what it does when it crosses

A reader's calendar is clipped against **now**, not against `generatedAt`. So
the two edges fail completely differently, and only one of them makes a noise:

| Edge crossed | What happens | Does anything go red? |
| --- | --- | --- |
| **Guard edge** — a newly-fetched oldest row is older than `generatedAt − (window + 1d)` | `pnpm test` fails at `Validate before committing`. **Nothing is committed and the data does not move.** This is the `clerksboards` failure of 2026-08-25. | **Yes, loudly.** |
| **Serving edge** — a committed row is older than `now − window` | The row is silently clipped out of what a reader sees. | **No. Nothing at all.** |

**The second has no alarm, and it cannot have one from the F22 guard, because
that guard only runs while a refresh is being built — which is precisely the
thing that has stopped happening.** A snapshot frozen by the push blocker loses
reader-visible rows one day at a time with everything green.

**Measured 2026-08-26: 0 of 449 rows have fallen out of serving, and the
snapshot is 0.41 days old.** So this is a mechanism, not a live wound — today.
`pnpm source:headroom` now prints both clocks so the next session does not have
to re-derive the distinction. Rowed as `NH206`.

### No new rows for the eight

`NH197` already covers all eight and explains why one row rather than eight:
every adapter clips to the same 90 days at fetch time and the snapshot stamps
`generatedAt` minutes later, so a 90d-clipped source lands within about a day
and a half of its own edge **permanently, by construction**. Eight rows
describing one architectural fact would be eight copies of a finding rather than
eight findings, and duplication in the tracker is worse than a gap.

**What is worth watching is the CLOCK GAP**, not the headroom — a refresh taking
longer than a day between its first source and its stamp trips a source that
declared itself correctly. That is `NH197`, and it stays open.
