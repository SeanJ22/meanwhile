# The automated-run ledger (C05)

Every automated run that has written to production's `search_log`, as far as
it can be reconstructed. `pnpm searchlog:backmark` reads this file and marks
the matching rows `SYNTHETIC`.

**Rows outside every window below stay `UNKNOWN` and are excluded from every
aggregate.** They are not marked organic, and the reason is the whole point of
this file: a row written before 2026-08-17 carries nothing that distinguishes
our robot from a reader, and guessing in our own favour on a number a buyer
pays for is the failure this product cannot survive.

Runs from 2026-08-17 onward do not need an entry here — they declare
themselves in the `x-wtp-synthetic-run` header at write time, which is the
mechanism this ledger exists to substitute for retroactively.

**A run that forgets the header still needs an entry.** It happened within the
hour: the g6 session verified its own deploy with eight `curl` polls and did
not set `WTP_RUN_ID`, so seven of our own rows landed labelled as readers. Any
automated request made by hand — a `curl`, a browser probe, a one-off script —
either sets `WTP_RUN_ID` or gets a window here. There is no third option that
keeps the store honest.

## Format

One row per run. `from` and `to` are inclusive ISO-8601 UTC instants. `runId`
is the label the rows are marked with. `evidence` says how the window is
known — a window with no evidence is not a window, it is a guess, and it does
not belong in this file.

| runId | from | to | evidence |
|---|---|---|---|
| `g6-probe-diagnosis@2026-08-17` | 2026-08-17T07:11:00Z | 2026-08-17T07:12:00Z | g6 session, items 1a and 1b: direct `curl` GETs to `/api/meetings` — the `?zip=85701` shape that reproduced the 0,0 defect, and four `lat`/`lng` reads at the four pilot zips. Window read off the table itself (rows at 07:11:17.032 and 07:11:52.487–07:11:54.107), not estimated. |
| `walk-all-local@2026-08-17T07:16:45.726Z` | 2026-08-17T07:16:45Z | 2026-08-17T07:20:13Z | g6 session, the item 1c baseline `pnpm walk:all` against production. Start and end instants read off the system clock either side of the command; the first and last rows in the window are 07:17:01.006 and 07:19:48.881. |
| `g6-deploy-verification@2026-08-17` | 2026-08-17T07:51:00Z | 2026-08-17T07:53:30Z | g6 session, verifying that the item 1b fix reached production: eight cache-busted GETs to `/api/meetings?zip=85701`, polled 25 seconds apart until the route answered 400. **These rows landed marked `ORGANIC`** — the polls did not send the run header — and correcting them is why this script may now overwrite `ORGANIC` inside an evidenced window. Window read off the table (rows at 07:51:17.269 through 07:53:00.108); a first attempt at this entry guessed 08:05–08:20 from memory and matched nothing, which is the reason every window in this file is now read from the data rather than recalled. |

### One discrepancy, stated rather than smoothed

The walk's own probe counter reported **28 search-log rows and 1 ask/log row**.
The table holds **25 `SEARCH` rows and 1 `OFFICIAL_OPENED` row** in that window.

Three GETs the walk issued did not become rows. The walk counts REQUESTS
ISSUED, at the call site, before the response is known; the table counts rows
that landed. A request that 404s, that the walk's own `getJson` discards on a
non-ok status, or that a CDN serves without reaching the route writes no row.

The same gap shows in the diagnosis window: seven GETs left the terminal and
five rows landed, the missing pair being repeat requests for a byte-identical
URL.

Neither number is wrong — they count different things — but the walk's line
reads as "rows this run created" while measuring something else, and this is
the first session that could check. Recorded here so the next session inherits
the distinction rather than rediscovering it. Fixing the walk's counter to
report rows landed is a work item, not a claim this file makes.

## What is deliberately NOT in this file

The h session's report names three rows from a browser probe at 23:47:05Z–
23:47:31Z and a local walk reporting 25 search-log rows and 13 ask/log rows,
but **records no date for either** — only a time of day. A window needs a
date, and inventing one to make a row attributable would be the fabrication
rule broken to tidy a ledger. Those rows stay `UNKNOWN`.

The same is true of every session before h. The honest reading of the search
log's history is that it is not sellable, and the sellable record starts on
2026-08-17.
