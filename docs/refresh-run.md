# The daily refresh run

**GENERATED — `pnpm refresh:daily` (`scripts/refresh-daily.mts`), finalised by `refresh-gate`. Rendered from `docs/refresh-run.json`. Never hand-edited (RULING 92).**

Run date: **2026-09-05** (UTC).

One scheduled run a day, one commit at most, and nothing committed when nothing moved — RULING 124. Cadence per source and the reason for each is `lib/ops/refresh-cadence.ts`.

## 2 landed · 3 not landed · 0 not due · gate REFUSED

| Source | Cadence today | Ran | Why | Outcome | Changed paths | Next due | Governs |
|---|---|:---:|---|---|---|---|---|
| `meetings` | daily | yes | `--all` | **ROUTE_UNREAD** — the Reader proof renewal could not prove this source's change to data/meetings-snapshot.json at final render and witnesses: final render and witnesses: final render and witnesses exited 1: AssertionError [ERR_ASSERTION]: The input did not match the regular expression /older than that: we last reached them/i. Input: |   code: 'ERR_ASSERTION', |     'ZBA Meeting As Needed\n' + |     'Could govern you\n' + |     'Wed, October 21st, 2'... 28518 more characters, |   expected: /older than that: we last reached them/i, |   operator: 'match', |   diff: ' — its governed paths are back at HEAD and it is owed until it lands | — | 2026-09-06 | `data/meetings-snapshot.json` | <!-- expected-future: 2026-09-06 — the next calendar day this source's cadence calls for it, computed from the run date -->
| `nj-filing` | daily | yes | `--all` | UNCHANGED — ran clean; facts unchanged — 2 artifact(s) re-observed at 2026-09-05T20:10:20.631Z and left byte-identical (stamps not rewritten) | — | 2026-09-06 | `data/states/nj/ballot/`, `data/questionnaire/` | <!-- expected-future: 2026-09-06 — the next calendar day this source's cadence calls for it, computed from the run date -->
| `fec` | weekly | yes | `--all` | **ROUTE_UNREAD** — the Reader proof renewal could not prove this source's change to data/fec/fec-2026.json at final render and witnesses: final render and witnesses: final render and witnesses exited 1: AssertionError [ERR_ASSERTION]: The input did not match the regular expression /older than that: we last reached them/i. Input: |   code: 'ERR_ASSERTION', |     'ZBA Meeting As Needed\n' + |     'Could govern you\n' + |     'Wed, October 21st, 2'... 28518 more characters, |   expected: /older than that: we last reached them/i, |   operator: 'match', |   diff: ' — its governed paths are back at HEAD and it is owed until it lands | — | 2026-09-06 | `data/fec/fec-2026.json` | <!-- expected-future: 2026-09-06 — the next calendar day this source's cadence calls for it, computed from the run date -->
| `legiscan` | weekly | yes | `--all` | **ROUTE_UNREAD** — failed at `pnpm legiscan:fetch` (exit 1) — nothing usable was written; owed until it lands | — | 2026-09-06 | `data/votes/state-votes-snapshot.json` | <!-- expected-future: 2026-09-06 — the next calendar day this source's cadence calls for it, computed from the run date -->
| `dotgov` | monthly | yes | `--all` | UNCHANGED — ran clean; facts unchanged — 1 artifact(s) re-observed at 2026-09-05T20:16:11.700Z and left byte-identical (stamps not rewritten) | — | 2026-10-01 | `data/dotgov/snapshot.json` | <!-- expected-future: 2026-10-01 — the next calendar day this source's cadence calls for it, computed from the run date -->

## What the writers observed (RL-1)

A re-observation whose facts were unchanged left its file byte-identical; the check time is recorded here, never in the artifact.

| Source | Artifact | Verdict | Observed at | Bytes moved | Stamps left alone |
|---|---|---|---|:---:|---|
| `meetings` | `data/meetings-snapshot.json` | FACTS_CHANGED | 2026-09-05T20:10:15.504Z | yes | `generatedAt`, `collectedAt`, `verifiedAt`, `retrievedAt`, `lastFreshAt` |
| `nj-filing` | `data/states/nj/ballot/nj-morris-2026.json` | FACTS_UNCHANGED | 2026-09-05T20:10:20.625Z | no | `collectedAt`, `verifiedAt`, `curatedAt` |
| `nj-filing` | `data/states/nj/ballot/nj-morris-2026-contacts.json` | FACTS_UNCHANGED | 2026-09-05T20:10:20.631Z | no | `generatedAt`, `collectedAt`, `verifiedAt` |
| `fec` | `data/fec/fec-2026.json` | FACTS_CHANGED | 2026-09-05T20:15:59.094Z | yes | `fetchedAt`, `checkedAt` |
| `dotgov` | `data/dotgov/snapshot.json` | FACTS_UNCHANGED | 2026-09-05T20:16:11.700Z | no | `readAt` |

## What the gate did

Verdict: **REFUSED** at 2026-09-05T20:35:21.211Z. The suite is red independent of the refreshed data — tests/generated-artifacts.test.ts fail with every changed source at HEAD. That is a defect on main, not a source's; nothing commits under it, and every changed source is owed until the tree is green.

| Failing test file | Attributed to | Basis |
|---|---|---|
| `tests/generated-artifacts.test.ts` | the tree, not any source's data | no single source's revert makes it pass, and the all-sources trial was not run |

## Reader proof renewal (RL-2 / RL-3)

Reader proof renewal: FAILED at 2026-09-05T20:19:26.681Z on 742993c7
- changed holdings: data/fec/fec-2026.json, data/meetings-snapshot.json
- ok   regenerate stale PURE dependents (84s) — 0 regenerated
- ok   exact-head production build (67s) — build log recorded
- ok   serve the build on localhost (1s) — serving 742993c7
- ok   prepare the census (72s)
- ok   active portrait inventory (71s)
- ok   build receipt (1s)
- ok   portraits (3s)
- ok   delta routes (2s)
- ok   ballot (33s)
- ok   ballot ask (9s)
- ok   candidate profiles ask (4s)
- ok   meeting routes (1s)
- ok   agenda (2s)
- ok   meetings ask (19s)
- ok   meeting knowledge ask (2s)
- ok   money ask (6s)
- ok   federal money ask (2s)
- FAIL final render and witnesses (38s) — final render and witnesses exited 1: AssertionError [ERR_ASSERTION]: The input did not match the regular expression /older than that: we last reached them/i. Input: |   code: 'ERR_ASSERTION', |     'ZBA Meeting As Needed\n' + |     'Could govern you\n' + |     'Wed, October 21st, 2'... 28518 more characters, |   expected: /older than that: we last reached them/i, |   operator: 'match', |   diff: 'simple' | } | Node.js v24.20.0
- refused meetings: the Reader proof renewal could not prove this source's change to data/meetings-snapshot.json at final render and witnesses: final render and witnesses: final render and witnesses exited 1: AssertionError [ERR_ASSERTION]: The input did not match the regular expression /older than that: we last reached them/i. Input: |   code: 'ERR_ASSERTION', |     'ZBA Meeting As Needed\n' + |     'Could govern you\n' + |     'Wed, October 21st, 2'... 28518 more characters, |   expected: /older than that: we last reached them/i, |   operator: 'match', |   diff: ' — its governed paths are back at HEAD and it is owed until it lands
- refused fec: the Reader proof renewal could not prove this source's change to data/fec/fec-2026.json at final render and witnesses: final render and witnesses: final render and witnesses exited 1: AssertionError [ERR_ASSERTION]: The input did not match the regular expression /older than that: we last reached them/i. Input: |   code: 'ERR_ASSERTION', |     'ZBA Meeting As Needed\n' + |     'Could govern you\n' + |     'Wed, October 21st, 2'... 28518 more characters, |   expected: /older than that: we last reached them/i, |   operator: 'match', |   diff: ' — its governed paths are back at HEAD and it is owed until it lands
- failure: final render and witnesses: final render and witnesses exited 1: AssertionError [ERR_ASSERTION]: The input did not match the regular expression /older than that: we last reached them/i. Input: |   code: 'ERR_ASSERTION', |     'ZBA Meeting As Needed\n' + |     'Could govern you\n' + |     'Wed, October 21st, 2'... 28518 more characters, |   expected: /older than that: we last reached them/i, |   operator: 'match', |   diff: '

## Which days this run answered for

Catch-up is OFF; this run answered for 2026-09-05 alone.

A late run computes the right cadence on its own, because the cadence is a pure function of the run's calendar date. What it cannot do is recover a day that produced NO run at all: `fec` and `legiscan` are Monday-only, so a missed Monday would otherwise be a fourteen-day data gap. So this run unions what every uncovered day since the last landed refresh asks for, and every source carrying open freshness debt (`data/ops/refresh-debt.json`) is due until it lands. A quiet day commits nothing and is therefore indistinguishable from a missed one from `main`, which is why both are treated as uncovered and why the window is capped — an uncapped union would put every weekly source on a daily cadence during a quiet fortnight. It adds no runs, no commits and no builds: `refresh-daily.yml` still commits at most once, and nothing when nothing moved.

## Why each source sits on the cadence it does

- **`meetings`** — weekly (elevated to daily until 2026-11-03). Agendas and notices are posted days ahead and move constantly through an election season; after 2026-11-03 the serving window is measured in weeks and RULING 53's clocks are 7 and 14 days. <!-- expected-future: 2026-11-03 — an election date carried in a cadence reason, not a stamp -->
- **`nj-filing`** — weekly (elevated to daily until 2026-11-03). A clerk's certified filing moves in HOURS near a deadline — this is the RULING 53 one-day clock the meetings cadence change deliberately left alone. <!-- expected-future: 2026-11-03 — an election date carried in a cadence reason, not a stamp -->
- **`fec`** — weekly. Federal committees file monthly or quarterly; the FEC's own processing lag is measured in days, so a daily read returns yesterday's answer six times out of seven.
- **`legiscan`** — weekly. LegiScan rebuilds its dataset once a week on Sundays and the fetch is dataset_hash-gated — reading it more often cannot produce a different hash.
- **`dotgov`** — monthly. The federal .gov domain list gains and loses a handful of entries a month; a daily read of a barely-moving federal register is the clearest case of a build spent to learn nothing.

