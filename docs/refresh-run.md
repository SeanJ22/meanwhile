# The daily refresh run

**GENERATED — `pnpm refresh:daily` (`scripts/refresh-daily.mts`). Never hand-edited (RULING 92).**

Run date: **2026-08-31** (UTC).

One scheduled run a day, one commit at most, and nothing committed when nothing moved — RULING 124. Cadence per source and the reason for each is `lib/ops/refresh-cadence.ts`.

## 4 ran clean · 0 failed · 1 not due

| Source | Cadence today | Ran | Why | Result | Governs |
|---|---|:---:|---|---|---|
| `meetings` | daily | yes | today's cadence | clean | `data/meetings-snapshot.json` |
| `nj-filing` | daily | yes | today's cadence | clean | `data/ballot/`, `data/questionnaire/` |
| `fec` | weekly | yes | today's cadence | clean | `data/fec/fec-2026.json` |
| `legiscan` | weekly | yes | today's cadence | clean | `data/votes/state-votes-snapshot.json` |
| `dotgov` | monthly | no | — | not due — monthly, not due on 2026-08-31 or on any uncovered day since the last landed refresh | `data/dotgov/snapshot.json` |

## Which days this run answered for

Last landed refresh: docs/refresh-run.md, run date 2026-08-30. This run answered for 1 calendar day(s) — 2026-08-31 — capped at 8 days.

A late run computes the right cadence on its own, because the cadence is a pure function of the run's calendar date. What it cannot do is recover a day that produced NO run at all: `fec` and `legiscan` are Monday-only, so a missed Monday would otherwise be a fourteen-day data gap. So this run unions what every uncovered day since the last landed refresh asks for. A quiet day commits nothing and is therefore indistinguishable from a missed one from `main`, which is why both are treated as uncovered and why the window is capped — an uncapped union would put every weekly source on a daily cadence during a quiet fortnight. It adds no runs, no commits and no builds: `refresh-daily.yml` still commits at most once, and nothing when nothing moved.

## Why each source sits on the cadence it does

- **`meetings`** — weekly (elevated to daily until 2026-11-03). Agendas and notices are posted days ahead and move constantly through an election season; after 2026-11-03 the serving window is measured in weeks and RULING 53's clocks are 7 and 14 days. <!-- expected-future: 2026-11-03 — an election date carried in a cadence reason, not a stamp -->
- **`nj-filing`** — weekly (elevated to daily until 2026-11-03). A clerk's certified filing moves in HOURS near a deadline — this is the RULING 53 one-day clock the meetings cadence change deliberately left alone. <!-- expected-future: 2026-11-03 — an election date carried in a cadence reason, not a stamp -->
- **`fec`** — weekly. Federal committees file monthly or quarterly; the FEC's own processing lag is measured in days, so a daily read returns yesterday's answer six times out of seven.
- **`legiscan`** — weekly. LegiScan rebuilds its dataset once a week on Sundays and the fetch is dataset_hash-gated — reading it more often cannot produce a different hash.
- **`dotgov`** — monthly. The federal .gov domain list gains and loses a handful of entries a month; a daily read of a barely-moving federal register is the clearest case of a build spent to learn nothing.

