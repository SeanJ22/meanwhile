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
is the label the rows are marked with. `class` is the `run_class` the window
writes — `SYNTHETIC` for a robot, `AUTHOR` for the author using his own
product. `evidence` says how the window is known — a window with no evidence
is not a window, it is a guess, and it does not belong in this file.

The `class` column is REQUIRED on every row, with no default. It was added
2026-08-17 with the `AUTHOR` class, and defaulting it would have meant a row
someone forgot to classify getting quietly called a robot — which is the
shape of mistake this whole file exists to stop.

| runId | from | to | class | evidence |
|---|---|---|---|---|
| `g6-probe-diagnosis@2026-08-17` | 2026-08-17T07:11:00Z | 2026-08-17T07:12:00Z | SYNTHETIC | g6 session, items 1a and 1b: direct `curl` GETs to `/api/meetings` — the `?zip=85701` shape that reproduced the 0,0 defect, and four `lat`/`lng` reads at the four pilot zips. Window read off the table itself (rows at 07:11:17.032 and 07:11:52.487–07:11:54.107), not estimated. |
| `walk-all-local@2026-08-17T07:16:45.726Z` | 2026-08-17T07:16:45Z | 2026-08-17T07:20:13Z | SYNTHETIC | g6 session, the item 1c baseline `pnpm walk:all` against production. Start and end instants read off the system clock either side of the command; the first and last rows in the window are 07:17:01.006 and 07:19:48.881. |
| `g6-overlaps-unmarked@2026-08-17` | 2026-08-17T09:44:50Z | 2026-08-17T09:45:10Z | SYNTHETIC | g6 session, `pnpm overlaps` at 85701 — run because item 6 changed the who-governs card's height. `scripts/overlap-audit.mts` did not send the run header, so its page load landed as a single `ORGANIC` row at 09:44:58.102. **The second time in one day that a run forgot to declare itself**, which is why it is now a guard (`tests/run-marker-coverage.test.ts`) rather than a third reminder. Window read off the table. |
| `g6-deploy-verification@2026-08-17` | 2026-08-17T07:51:00Z | 2026-08-17T07:53:30Z | SYNTHETIC | g6 session, verifying that the item 1b fix reached production: eight cache-busted GETs to `/api/meetings?zip=85701`, polled 25 seconds apart until the route answered 400. **These rows landed marked `ORGANIC`** — the polls did not send the run header — and correcting them is why this script may now overwrite `ORGANIC` inside an evidenced window. Window read off the table (rows at 07:51:17.269 through 07:53:00.108); a first attempt at this entry guessed 08:05–08:20 from memory and matched nothing, which is the reason every window in this file is now read from the data rather than recalled. |
| `hotfix-0817-preview-pane@2026-08-17` | 2026-08-17T14:38:00Z | 2026-08-17T14:38:30Z | SYNTHETIC | hotfix-0817 session. The Browser pane opened http://localhost:3000 when the dev server was started to verify item 2 against the real carried rows, and `.env.local` holds the PRODUCTION connection string, so that page load wrote to the production search log. The pane load sends no run header - it is the app in a browser, not a script - so it landed as a single `ORGANIC` row at 14:38:12.768. The THIRD time in one day a run reached production undeclared, and the first where the writer was the preview browser rather than a script, which is a gap `tests/run-marker-coverage.test.ts` cannot close: it guards the repo scripts. Window read off the table, not recalled. |


## The author's own traffic

Not an automated run, and the reason it is here anyway is that the ledger is
what `pnpm searchlog:backmark` reads. A row that is neither a robot nor a
reader needs somewhere to be said out loud.

These rows are attributed on **the traffic's own author's statement about his
own traffic**, which is the only kind of retroactive attribution this file
permits — it is not the inference C05 forbids, because nobody is guessing from
a user agent or a timing pattern. The statement, verbatim, given 2026-08-17:

> Yes, they are mine. I only have one tester and they have confirmed they
> haven't logged in today.

They are marked `AUTHOR` rather than `SYNTHETIC`, and the distinction is not
bookkeeping: calling a human session a script is a false statement in the
record, and calling it a reader would sell the author's own clicks back to a
buyer as district signal. `AUTHOR` is excluded from every aggregate exactly as
`SYNTHETIC` and `UNKNOWN` are.

| runId | from | to | class | evidence |
|---|---|---|---|---|
| `author@2026-08-17T17:11Z` | 2026-08-17T17:11:00Z | 2026-08-17T17:13:00Z | AUTHOR | The author, on his own statement of 2026-08-17 quoted above. Fourteen rows read off the table before the window was drawn, never estimated: a SEARCH at 85701 (17:11:47.xxx), a SEARCH at 03255 (17:12:03) and twelve OFFICIAL_OPENED rows between 17:11:50 and 17:12:30, seconds apart, across `congress:`, `plural:` and `statewide:nh/governor` ids. The g7 session found them, could not attribute them, and left them ORGANIC rather than guess — the author's statement is what closed it. |
| `author@2026-08-17T17:54Z` | 2026-08-17T17:54:00Z | 2026-08-17T18:02:00Z | AUTHOR | The same statement, same day. Three SEARCH rows read off the table: 03255 at 17:54:34, 01085 at 17:54:35 and 05701 at 18:01:07. Recorded as a second window rather than one wide one, because a window is drawn around rows that were observed and not across a 40-minute gap that was not. |

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
