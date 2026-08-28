# The daily refresh run

**GENERATED — `pnpm refresh:daily` (`scripts/refresh-daily.mts`). Never hand-edited (RULING 92).**

Run date: **2026-08-28** (UTC).

One scheduled run a day, one commit at most, and nothing committed when nothing moved — RULING 124. Cadence per source and the reason for each is `lib/ops/refresh-cadence.ts`.

## 2 ran clean · 0 failed · 3 not due

| Source | Cadence today | Ran | Result | Governs |
|---|---|:---:|---|---|
| `meetings` | daily | yes | clean | `data/meetings-snapshot.json` |
| `nj-filing` | daily | yes | clean | `data/ballot/`, `data/questionnaire/` |
| `fec` | weekly | no | not due — weekly, not due on 2026-08-28 | `data/fec/fec-2026.json` |
| `legiscan` | weekly | no | not due — weekly, not due on 2026-08-28 | `data/votes/state-votes-snapshot.json` |
| `dotgov` | monthly | no | not due — monthly, not due on 2026-08-28 | `data/dotgov/snapshot.json` |

## Why each source sits on the cadence it does

- **`meetings`** — weekly (elevated to daily until 2026-11-03). Agendas and notices are posted days ahead and move constantly through an election season; after 2026-11-03 the serving window is measured in weeks and RULING 53's clocks are 7 and 14 days. <!-- expected-future: 2026-11-03 — an election date carried in a cadence reason, not a stamp -->
- **`nj-filing`** — weekly (elevated to daily until 2026-11-03). A clerk's certified filing moves in HOURS near a deadline — this is the RULING 53 one-day clock the meetings cadence change deliberately left alone. <!-- expected-future: 2026-11-03 — an election date carried in a cadence reason, not a stamp -->
- **`fec`** — weekly. Federal committees file monthly or quarterly; the FEC's own processing lag is measured in days, so a daily read returns yesterday's answer six times out of seven.
- **`legiscan`** — weekly. LegiScan rebuilds its dataset once a week on Sundays and the fetch is dataset_hash-gated — reading it more often cannot produce a different hash.
- **`dotgov`** — monthly. The federal .gov domain list gains and loses a handful of entries a month; a daily read of a barely-moving federal register is the clearest case of a build spent to learn nothing.

