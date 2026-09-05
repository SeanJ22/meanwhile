# The daily refresh run

**GENERATED — `pnpm refresh:daily` (`scripts/refresh-daily.mts`), finalised by `refresh-gate`. Rendered from `docs/refresh-run.json`. Never hand-edited (RULING 92).**

Run date: **2026-09-05** (UTC).

One scheduled run a day, one commit at most, and nothing committed when nothing moved — RULING 124. Cadence per source and the reason for each is `lib/ops/refresh-cadence.ts`.

## 1 landed · 4 not landed · 0 not due · gate REFUSED

| Source | Cadence today | Ran | Why | Outcome | Changed paths | Next due | Governs |
|---|---|:---:|---|---|---|---|---|
| `meetings` | daily | yes | `--all` | **ROUTE_UNREAD** — the gate refused this source's data: tests/reader-last-mile-census.test.ts — its governed paths are back at HEAD and it is owed until it lands | — | 2026-09-06 | `data/meetings-snapshot.json` | <!-- expected-future: 2026-09-06 — the next calendar day this source's cadence calls for it, computed from the run date -->
| `nj-filing` | daily | yes | `--all` | UNCHANGED — ran clean; every governed path is byte-identical to HEAD | — | 2026-09-06 | `data/ballot/`, `data/questionnaire/` | <!-- expected-future: 2026-09-06 — the next calendar day this source's cadence calls for it, computed from the run date -->
| `fec` | weekly | yes | `--all` | **ROUTE_UNREAD** — the gate refused this source's data: tests/reader-last-mile-census.test.ts — its governed paths are back at HEAD and it is owed until it lands | — | 2026-09-06 | `data/fec/fec-2026.json` | <!-- expected-future: 2026-09-06 — the next calendar day this source's cadence calls for it, computed from the run date -->
| `legiscan` | weekly | yes | `--all` | **ROUTE_UNREAD** — the gate refused this source's data: tests/reader-last-mile-census.test.ts — its governed paths are back at HEAD and it is owed until it lands | — | 2026-09-06 | `data/votes/state-votes-snapshot.json` | <!-- expected-future: 2026-09-06 — the next calendar day this source's cadence calls for it, computed from the run date -->
| `dotgov` | monthly | yes | `--all` | **ROUTE_UNREAD** — the gate refused this source's data: tests/reader-last-mile-census.test.ts — its governed paths are back at HEAD and it is owed until it lands | — | 2026-09-06 | `data/dotgov/snapshot.json` | <!-- expected-future: 2026-09-06 — the next calendar day this source's cadence calls for it, computed from the run date -->

## What the gate did

Verdict: **REFUSED** at 2026-09-05T17:35:08.425Z. The suite refused 4 source(s): meetings, fec, legiscan, dotgov. Their governed paths are back at HEAD and they are owed (data/ops/refresh-debt.json). 0 survivor(s) commit: none.

| Failing test file | Attributed to | Basis |
|---|---|---|
| `tests/reader-last-mile-census.test.ts` | `meetings` | passes only with every changed source's governed paths at HEAD — the refresh's jointly |
| `tests/reader-last-mile-census.test.ts` | `fec` | passes only with every changed source's governed paths at HEAD — the refresh's jointly |
| `tests/reader-last-mile-census.test.ts` | `legiscan` | passes only with every changed source's governed paths at HEAD — the refresh's jointly |
| `tests/reader-last-mile-census.test.ts` | `dotgov` | passes only with every changed source's governed paths at HEAD — the refresh's jointly |

## Which days this run answered for

Catch-up is OFF; this run answered for 2026-09-05 alone.

A late run computes the right cadence on its own, because the cadence is a pure function of the run's calendar date. What it cannot do is recover a day that produced NO run at all: `fec` and `legiscan` are Monday-only, so a missed Monday would otherwise be a fourteen-day data gap. So this run unions what every uncovered day since the last landed refresh asks for, and every source carrying open freshness debt (`data/ops/refresh-debt.json`) is due until it lands. A quiet day commits nothing and is therefore indistinguishable from a missed one from `main`, which is why both are treated as uncovered and why the window is capped — an uncapped union would put every weekly source on a daily cadence during a quiet fortnight. It adds no runs, no commits and no builds: `refresh-daily.yml` still commits at most once, and nothing when nothing moved.

## Why each source sits on the cadence it does

- **`meetings`** — weekly (elevated to daily until 2026-11-03). Agendas and notices are posted days ahead and move constantly through an election season; after 2026-11-03 the serving window is measured in weeks and RULING 53's clocks are 7 and 14 days. <!-- expected-future: 2026-11-03 — an election date carried in a cadence reason, not a stamp -->
- **`nj-filing`** — weekly (elevated to daily until 2026-11-03). A clerk's certified filing moves in HOURS near a deadline — this is the RULING 53 one-day clock the meetings cadence change deliberately left alone. <!-- expected-future: 2026-11-03 — an election date carried in a cadence reason, not a stamp -->
- **`fec`** — weekly. Federal committees file monthly or quarterly; the FEC's own processing lag is measured in days, so a daily read returns yesterday's answer six times out of seven.
- **`legiscan`** — weekly. LegiScan rebuilds its dataset once a week on Sundays and the fetch is dataset_hash-gated — reading it more often cannot produce a different hash.
- **`dotgov`** — monthly. The federal .gov domain list gains and loses a handful of entries a month; a daily read of a barely-moving federal register is the clearest case of a build spent to learn nothing.

