# The daily refresh run

**GENERATED — `pnpm refresh:daily` (`scripts/refresh-daily.mts`), finalised by `refresh-gate`. Rendered from `docs/refresh-run.json`. Never hand-edited (RULING 92).**

Run date: **2026-09-07** (UTC).

One scheduled run a day, one commit at most, and nothing committed when nothing moved — RULING 124. Cadence per source and the reason for each is `lib/ops/refresh-cadence.ts`.

## 0 landed · 4 not landed · 1 not due · gate GREEN

| Source | Cadence today | Ran | Why | Outcome | Changed paths | Next due | Governs |
|---|---|:---:|---|---|---|---|---|
| `meetings` | daily | yes | today's cadence | **ROUTE_UNREAD** — the Reader proof renewal could not prove this source's change to data/meetings-snapshot.json at final render and witnesses: final render and witnesses: final render and witnesses exited 1:   name: 'TimeoutError' |   log: [ |     "  - waiting for locator('.door-panel button').filter({ hasText: 'Katie Hobbs' }).first() to be visible" |   ], | } | Node.js v24.20.0 — its governed paths are back at HEAD and it is owed until it lands | — | 2026-09-08 | `data/meetings-snapshot.json` | <!-- expected-future: 2026-09-08 — the next calendar day this source's cadence calls for it, computed from the run date -->
| `nj-filing` | daily | yes | today's cadence | **ROUTE_UNREAD** — the Reader proof renewal could not prove this source's change to data/states/nj/ballot/nj-morris-2026.json at final render and witnesses: final render and witnesses: final render and witnesses exited 1:   name: 'TimeoutError' |   log: [ |     "  - waiting for locator('.door-panel button').filter({ hasText: 'Katie Hobbs' }).first() to be visible" |   ], | } | Node.js v24.20.0 — its governed paths are back at HEAD and it is owed until it lands | — | 2026-09-08 | `data/states/nj/ballot/`, `data/questionnaire/` | <!-- expected-future: 2026-09-08 — the next calendar day this source's cadence calls for it, computed from the run date -->
| `fec` | weekly | yes | today's cadence | **ROUTE_UNREAD** — the Reader proof renewal could not prove this source's change to data/fec/fec-2026.json at final render and witnesses: final render and witnesses: final render and witnesses exited 1:   name: 'TimeoutError' |   log: [ |     "  - waiting for locator('.door-panel button').filter({ hasText: 'Katie Hobbs' }).first() to be visible" |   ], | } | Node.js v24.20.0 — its governed paths are back at HEAD and it is owed until it lands | — | 2026-09-08 | `data/fec/fec-2026.json` | <!-- expected-future: 2026-09-08 — the next calendar day this source's cadence calls for it, computed from the run date -->
| `legiscan` | weekly | yes | today's cadence | **ROUTE_UNREAD** — the Reader proof renewal could not prove this source's change to data/votes/state-votes-snapshot.json at final render and witnesses: final render and witnesses: final render and witnesses exited 1:   name: 'TimeoutError' |   log: [ |     "  - waiting for locator('.door-panel button').filter({ hasText: 'Katie Hobbs' }).first() to be visible" |   ], | } | Node.js v24.20.0 — its governed paths are back at HEAD and it is owed until it lands | — | 2026-09-08 | `data/votes/state-votes-snapshot.json` | <!-- expected-future: 2026-09-08 — the next calendar day this source's cadence calls for it, computed from the run date -->
| `dotgov` | monthly | no | — | NOT_DUE — monthly, not due on 2026-09-07 or on any uncovered day since the last landed refresh, and carrying no debt | — | 2026-10-01 | `data/dotgov/snapshot.json` | <!-- expected-future: 2026-10-01 — the next calendar day this source's cadence calls for it, computed from the run date -->

## What the writers observed (RL-1)

A re-observation whose facts were unchanged left its file byte-identical; the check time is recorded here, never in the artifact.

| Source | Artifact | Verdict | Observed at | Bytes moved | Stamps left alone |
|---|---|---|---|:---:|---|
| `meetings` | `data/meetings-snapshot.json` | FACTS_CHANGED | 2026-09-07T15:02:54.585Z | yes | `generatedAt`, `collectedAt`, `verifiedAt`, `retrievedAt`, `lastFreshAt` |
| `nj-filing` | `data/states/nj/ballot/nj-morris-2026.json` | FACTS_CHANGED | 2026-09-07T15:02:57.462Z | yes | `collectedAt`, `verifiedAt`, `curatedAt` |
| `nj-filing` | `data/states/nj/ballot/nj-morris-2026-contacts.json` | FACTS_UNCHANGED | 2026-09-07T15:02:57.470Z | no | `generatedAt`, `collectedAt`, `verifiedAt` |
| `fec` | `data/fec/fec-2026.json` | FACTS_CHANGED | 2026-09-07T15:08:18.511Z | yes | `fetchedAt`, `checkedAt` |
| `legiscan` | `data/votes/state-votes-snapshot.json` | FACTS_CHANGED | 2026-09-07T15:08:25.062Z | yes | `generatedAt`, `downloadedAt`, `retrievedAt` |

## What the gate did

Verdict: **GREEN** at 2026-09-07T15:30:08.687Z. The full suite passed over every changed source's data together. Everything that changed commits. The Reader proof renewal refused 4 source(s) before the suite ran; see the renewal section.

## Reader proof renewal (RL-2 / RL-3)

Reader proof renewal: FAILED at 2026-09-07T15:11:30.236Z on 2ef37fdb
- changed holdings: data/fec/fec-2026.json, data/meetings-snapshot.json, data/states/nj/ballot/nj-morris-2026.json, data/votes/state-votes-snapshot.json
- ok   regenerate stale PURE dependents (79s) — 0 regenerated
- ok   exact-head production build (69s) — build log recorded
- ok   serve the build on localhost (1s) — serving 2ef37fdb
- ok   prepare the census (68s)
- ok   active portrait inventory (67s)
- ok   build receipt (1s)
- ok   portraits (3s)
- ok   delta routes (2s)
- ok   ballot (31s)
- ok   ballot ask (9s)
- ok   candidate profiles ask (4s)
- ok   meeting routes (1s)
- ok   agenda (2s)
- ok   meetings ask (18s)
- ok   meeting knowledge ask (2s)
- ok   money ask (6s)
- ok   federal money ask (2s)
- FAIL final render and witnesses (25s) — final render and witnesses exited 1:   name: 'TimeoutError' |   log: [ |     "  - waiting for locator('.door-panel button').filter({ hasText: 'Katie Hobbs' }).first() to be visible" |   ], | } | Node.js v24.20.0
- refused meetings: the Reader proof renewal could not prove this source's change to data/meetings-snapshot.json at final render and witnesses: final render and witnesses: final render and witnesses exited 1:   name: 'TimeoutError' |   log: [ |     "  - waiting for locator('.door-panel button').filter({ hasText: 'Katie Hobbs' }).first() to be visible" |   ], | } | Node.js v24.20.0 — its governed paths are back at HEAD and it is owed until it lands
- refused nj-filing: the Reader proof renewal could not prove this source's change to data/states/nj/ballot/nj-morris-2026.json at final render and witnesses: final render and witnesses: final render and witnesses exited 1:   name: 'TimeoutError' |   log: [ |     "  - waiting for locator('.door-panel button').filter({ hasText: 'Katie Hobbs' }).first() to be visible" |   ], | } | Node.js v24.20.0 — its governed paths are back at HEAD and it is owed until it lands
- refused fec: the Reader proof renewal could not prove this source's change to data/fec/fec-2026.json at final render and witnesses: final render and witnesses: final render and witnesses exited 1:   name: 'TimeoutError' |   log: [ |     "  - waiting for locator('.door-panel button').filter({ hasText: 'Katie Hobbs' }).first() to be visible" |   ], | } | Node.js v24.20.0 — its governed paths are back at HEAD and it is owed until it lands
- refused legiscan: the Reader proof renewal could not prove this source's change to data/votes/state-votes-snapshot.json at final render and witnesses: final render and witnesses: final render and witnesses exited 1:   name: 'TimeoutError' |   log: [ |     "  - waiting for locator('.door-panel button').filter({ hasText: 'Katie Hobbs' }).first() to be visible" |   ], | } | Node.js v24.20.0 — its governed paths are back at HEAD and it is owed until it lands
- restored committed Reader evidence: 13 path(s) back at HEAD
- restored meetings: 1 path(s) back at HEAD
- restored nj-filing: 1 path(s) back at HEAD
- restored fec: 1 path(s) back at HEAD
- restored legiscan: 1 path(s) back at HEAD
- regenerated 57 PURE dependent path(s) from the restored tree
- failure: final render and witnesses: final render and witnesses exited 1:   name: 'TimeoutError' |   log: [ |     "  - waiting for locator('.door-panel button').filter({ hasText: 'Katie Hobbs' }).first() to be visible" |   ], | } | Node.js v24.20.0

## Which days this run answered for

Last landed refresh: docs/refresh-run.md, run date 2026-09-06. This run answered for 1 calendar day(s) — 2026-09-07 — capped at 8 days.

A late run computes the right cadence on its own, because the cadence is a pure function of the run's calendar date. What it cannot do is recover a day that produced NO run at all: `fec` and `legiscan` are Monday-only, so a missed Monday would otherwise be a fourteen-day data gap. So this run unions what every uncovered day since the last landed refresh asks for, and every source carrying open freshness debt (`data/ops/refresh-debt.json`) is due until it lands. A quiet day commits nothing and is therefore indistinguishable from a missed one from `main`, which is why both are treated as uncovered and why the window is capped — an uncapped union would put every weekly source on a daily cadence during a quiet fortnight. It adds no runs, no commits and no builds: `refresh-daily.yml` still commits at most once, and nothing when nothing moved.

## Why each source sits on the cadence it does

- **`meetings`** — weekly (elevated to daily until 2026-11-03). Agendas and notices are posted days ahead and move constantly through an election season; after 2026-11-03 the serving window is measured in weeks and RULING 53's clocks are 7 and 14 days. <!-- expected-future: 2026-11-03 — an election date carried in a cadence reason, not a stamp -->
- **`nj-filing`** — weekly (elevated to daily until 2026-11-03). A clerk's certified filing moves in HOURS near a deadline — this is the RULING 53 one-day clock the meetings cadence change deliberately left alone. <!-- expected-future: 2026-11-03 — an election date carried in a cadence reason, not a stamp -->
- **`fec`** — weekly. Federal committees file monthly or quarterly; the FEC's own processing lag is measured in days, so a daily read returns yesterday's answer six times out of seven.
- **`legiscan`** — weekly. LegiScan rebuilds its dataset once a week on Sundays and the fetch is dataset_hash-gated — reading it more often cannot produce a different hash.
- **`dotgov`** — monthly. The federal .gov domain list gains and loses a handful of entries a month; a daily read of a barely-moving federal register is the clearest case of a build spent to learn nothing.

