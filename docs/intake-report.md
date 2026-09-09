# Intake tripwire report

Generated 2026-09-09T14:47:33.299Z by `scripts/intake-tripwire.mts` (T08 1f).
Everything in this file is a date, a count, or a threshold — never an
identifier. Flags are flagged, never auto-acted-on: the author decides.

Thresholds: a day flags on volume at max(30, 4× the trailing
14-day median), and on quarantine share at 25% with at least
12 rows.

## Flags

- **FLAGGED 2026-08-26 — search_log VOLUME_SPIKE**: 193 rows against a trailing median of 32 over 7 prior days (flag threshold 128)

## Reactions store, trailing 30 days

| Day (UTC) | Rows | Quarantined |
|---|---|---|
| 2026-08-26 | 3 | 0 |
| 2026-08-20 | 3 | 0 |
| 2026-08-18 | 2 | 0 |
| 2026-08-17 | 1 | 0 |
| 2026-08-16 | 12 | 0 |
| 2026-08-15 | 3 | 0 |
| 2026-08-14 | 17 | 2 |

## Search log, trailing 30 days

| Day (UTC) | Rows |
|---|---|
| 2026-09-08 | 5 |
| 2026-09-07 | 35 |
| 2026-09-06 | 24 |
| 2026-09-05 | 128 |
| 2026-09-04 | 8 |
| 2026-09-03 | 47 |
| 2026-09-02 | 41 |
| 2026-09-01 | 37 |
| 2026-08-31 | 47 |
| 2026-08-30 | 78 |
| 2026-08-29 | 31 |
| 2026-08-28 | 97 |
| 2026-08-27 | 48 |
| 2026-08-26 | 193 |
| 2026-08-25 | 57 |
| 2026-08-24 | 32 |
| 2026-08-23 | 65 |
| 2026-08-21 | 20 |
| 2026-08-20 | 18 |
| 2026-08-19 | 22 |
| 2026-08-18 | 103 |

## Limiter housekeeping

Expired limiter rows purged this run: 0. Rows
remaining: 0. (Transient state only — the
limiter table holds counters against an unjoinable digest, nothing else.)
