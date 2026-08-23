# Intake tripwire report

Generated 2026-08-23T10:55:47.096Z by `scripts/intake-tripwire.mts` (T08 1f).
Everything in this file is a date, a count, or a threshold — never an
identifier. Flags are flagged, never auto-acted-on: the author decides.

Thresholds: a day flags on volume at max(30, 4× the trailing
14-day median), and on quarantine share at 25% with at least
12 rows.

## Flags

**None.** Every day in the window sits inside the trailing normal range.

## Reactions store, trailing 30 days

| Day (UTC) | Rows | Quarantined |
|---|---|---|
| 2026-08-21 | 1 | 0 |
| 2026-08-20 | 3 | 0 |
| 2026-08-18 | 2 | 0 |
| 2026-08-17 | 1 | 0 |
| 2026-08-16 | 12 | 0 |
| 2026-08-15 | 3 | 0 |
| 2026-08-14 | 17 | 2 |

## Search log, trailing 30 days

| Day (UTC) | Rows |
|---|---|
| 2026-08-23 | 62 |
| 2026-08-21 | 20 |
| 2026-08-20 | 18 |
| 2026-08-19 | 22 |
| 2026-08-18 | 103 |

## Limiter housekeeping

Expired limiter rows purged this run: 1. Rows
remaining: 0. (Transient state only — the
limiter table holds counters against an unjoinable digest, nothing else.)
