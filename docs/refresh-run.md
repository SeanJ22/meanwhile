# The daily refresh run

**GENERATED — `pnpm refresh:daily` (`scripts/refresh-daily.mts`), finalised by `refresh-gate`. Rendered from `docs/refresh-run.json`. Never hand-edited (RULING 92).**

Run date: **2026-09-10** (UTC).

One scheduled run a day, one commit at most, and nothing committed when nothing moved — RULING 124. Cadence per source and the reason for each is `lib/ops/refresh-cadence.ts`.

## 0 landed · 2 not landed · 1 not due · gate REFUSED

| Source | Cadence today | Ran | Why | Outcome | Changed paths | Next due | Governs |
|---|---|:---:|---|---|---|---|---|
| `meetings` | daily | yes | today's cadence | **ROUTE_UNREAD** — the suite is red independent of any source's data (tests/ask-exact-body-identity.test.ts, tests/ask-grounded-route.test.ts) — nothing commits under a red the refresh did not cause; its governed paths are back at HEAD and it is owed until it lands | — | 2026-09-11 | `data/meetings-snapshot.json` | <!-- expected-future: 2026-09-11 — the next calendar day this source's cadence calls for it, computed from the run date -->
| `nj-filing` | daily | yes | today's cadence | **ROUTE_UNREAD** — the suite is red independent of any source's data (tests/ask-exact-body-identity.test.ts, tests/ask-grounded-route.test.ts) — nothing commits under a red the refresh did not cause; its governed paths are back at HEAD and it is owed until it lands | — | 2026-09-11 | `data/states/nj/ballot/`, `data/questionnaire/` | <!-- expected-future: 2026-09-11 — the next calendar day this source's cadence calls for it, computed from the run date -->
| `dotgov` | monthly | no | — | NOT_DUE — monthly, not due on 2026-09-10 or on any uncovered day since the last landed refresh, and carrying no debt | — | 2026-10-01 | `data/dotgov/snapshot.json` | <!-- expected-future: 2026-10-01 — the next calendar day this source's cadence calls for it, computed from the run date -->

## What the writers observed (RL-1)

A re-observation whose facts were unchanged left its file byte-identical; the check time is recorded here, never in the artifact.

| Source | Artifact | Verdict | Observed at | Bytes moved | Stamps left alone |
|---|---|---|---|:---:|---|
| `meetings` | `data/meetings-snapshot.json` | FACTS_CHANGED | 2026-09-10T13:35:01.482Z | yes | `generatedAt`, `collectedAt`, `verifiedAt`, `retrievedAt`, `lastFreshAt` |
| `nj-filing` | `data/states/nj/ballot/nj-morris-2026.json` | FACTS_CHANGED | 2026-09-10T13:35:05.072Z | yes | `collectedAt`, `verifiedAt`, `curatedAt` |
| `nj-filing` | `data/states/nj/ballot/nj-morris-2026-contacts.json` | FACTS_UNCHANGED | 2026-09-10T13:35:05.082Z | no | `generatedAt`, `collectedAt`, `verifiedAt` |

## What the gate did

Verdict: **REFUSED** at 2026-09-10T13:59:14.872Z. The suite is red independent of the refreshed data — tests/ask-exact-body-identity.test.ts, tests/ask-grounded-route.test.ts fail with every changed source at HEAD. That is a defect on main, not a source's; nothing commits under it, and every changed source is owed until the tree is green.

| Failing test file | Attributed to | Basis |
|---|---|---|
| `tests/ask-exact-body-identity.test.ts` | the tree, not any source's data | fails with every changed source's governed paths at HEAD — the tree's, not any source's data |
| `tests/ask-grounded-route.test.ts` | the tree, not any source's data | fails with every changed source's governed paths at HEAD — the tree's, not any source's data |
| `tests/day-precision.test.ts` | `meetings` | passes with meetings's governed paths at HEAD |
| `tests/meeting-card-title.test.ts` | `meetings` | passes with meetings's governed paths at HEAD |
| `tests/reader-agenda-representation.test.ts` | `meetings` | passes with meetings's governed paths at HEAD |
| `tests/reader-last-mile-ask-listing-identity.test.ts` | `meetings` | passes with meetings's governed paths at HEAD |
| `tests/readiness-reader-delivery.test.ts` | `nj-filing` | passes with nj-filing's governed paths at HEAD |

## Reader proof renewal (RL-2 / RL-3)

Reader proof renewal: RENEWED at 2026-09-10T13:38:25.419Z on 16c6e900
- changed holdings: data/meetings-snapshot.json, data/states/nj/ballot/nj-morris-2026.json
- ok   regenerate stale PURE dependents (83s) — 0 regenerated
- ok   exact-head production build (73s) — build log recorded
- ok   serve the build on localhost (1s) — serving 16c6e900
- ok   prepare the census (72s)
- ok   active portrait inventory (72s)
- ok   build receipt (2s)
- ok   portraits (3s)
- ok   exhaustive routes (48s)
- ok   exhaustive ask (12s)
- ok   key-votes ask (10s)
- ok   delta routes (3s)
- ok   ballot (32s)
- ok   ballot ask (9s)
- ok   candidate profiles ask (4s)
- ok   meeting routes (1s)
- ok   agenda (2s)
- ok   meetings ask (18s)
- ok   meeting knowledge ask (2s)
- ok   money ask (6s)
- ok   federal money ask (2s)
- ok   final render and witnesses (39s)
- ok   finalize --renew-holdings (95s)
- ok   pack the executed evidence losslessly (4s) — 18 file(s) packed
- ok   validate the renewed receipt (40s) — holdings digest 8a5dbd38, 463 sources bound

## Which days this run answered for

Last landed refresh: docs/refresh-run.md, run date 2026-09-09. This run answered for 1 calendar day(s) — 2026-09-10 — capped at 8 days.

A late run computes the right cadence on its own, because the cadence is a pure function of the run's calendar date. What it cannot do is recover a day that produced NO run at all: `fec` and `legiscan` are Monday-only, so a missed Monday would otherwise be a fourteen-day data gap. So this run unions what every uncovered day since the last landed refresh asks for, and every source carrying open freshness debt (`data/ops/refresh-debt.json`) is due until it lands. A quiet day commits nothing and is therefore indistinguishable from a missed one from `main`, which is why both are treated as uncovered and why the window is capped — an uncapped union would put every weekly source on a daily cadence during a quiet fortnight. It adds no runs, no commits and no builds: `refresh-daily.yml` still commits at most once, and nothing when nothing moved.

## Why each source sits on the cadence it does

- **`meetings`** — weekly (elevated to daily until 2026-11-03). Agendas and notices are posted days ahead and move constantly through an election season; after 2026-11-03 the serving window is measured in weeks and RULING 53's clocks are 7 and 14 days. <!-- expected-future: 2026-11-03 — an election date carried in a cadence reason, not a stamp -->
- **`nj-filing`** — weekly (elevated to daily until 2026-11-03). A clerk's certified filing moves in HOURS near a deadline — this is the RULING 53 one-day clock the meetings cadence change deliberately left alone. <!-- expected-future: 2026-11-03 — an election date carried in a cadence reason, not a stamp -->
- **`dotgov`** — monthly. The federal .gov domain list gains and loses a handful of entries a month; a daily read of a barely-moving federal register is the clearest case of a build spent to learn nothing.

