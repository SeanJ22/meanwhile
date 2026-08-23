# congress-legislators — the migration diff

Written by `pnpm congress:migrate` on a run of 2026-08-23 — that is when the program ran, not when the data was read. The data below was read 2026-08-16.

Snapshot pinned at `4458244308621d0570a15008f46888b7a87645eb`, read 2026-08-16.

## What this file is

The federal roster already carried a birthday and a term end for every
member, from the same upstream project through its **unpinned** JSON
mirror. The author's ruling demotes that rung to fallback-and-audit: the
migration DIFFS rather than overwrites, and every disagreement is a
finding here — either an upstream PR for us to file, or a stale value of
ours. **Nothing below was changed automatically.**

## Counts, with their denominators

- Store rows matched to the pinned file by bioguide: **537** of 537
- Store rows the pinned file does not carry: **0**
- Rows that gained official social accounts: **518**
- Disagreements found: **0**

## Findings

None. Every matched row's birthday, term start and term end agree
between our store and the pinned file. That is a real result, not an
absence of checking — the comparison ran over every matched row.
