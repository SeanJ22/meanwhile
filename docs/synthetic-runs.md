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

## g12, 2026-08-17 — every production row this session created, by run id

Read back from production with `pnpm census:runs --target=production` rather
than counted from the terminal, because the two measure different things and
this file already records why.

| run id | rows | what it was |
|---|---|---|
| `walk-all-local@2026-08-18T05:50:33.171Z` | 48 | the first `walk:all` after the deploy. **Aborted** — its own new desktop path clicked a hamburger that CSS hides at that width and threw.  <!-- expected-future: a run id is a UTC instant and this session ran after 17:00 Phoenix, so the id reads 08-18 on the session day 2026-08-17; verified against pnpm stamp --> |
| `walk-all-local@2026-08-18T05:57:57.623Z` | 73 | the second run, complete, 2 named regressions.  <!-- expected-future: a run id is a UTC instant and this session ran after 17:00 Phoenix, so the id reads 08-18 on the session day 2026-08-17; verified against pnpm stamp --> |
| `walk-all-local@2026-08-18T06:06:47.335Z` | 72 | the third, capturing the output to a file.  <!-- expected-future: a run id is a UTC instant and this session ran after 17:00 Phoenix, so the id reads 08-18 on the session day 2026-08-17; verified against pnpm stamp --> |
| `walk-all-local@2026-08-18T06:24:13.227Z` | 73 | the final run after the rail-press fix shipped: 290 passed, 0 regressions.  <!-- expected-future: a run id is a UTC instant and this session ran after 17:00 Phoenix, so the id reads 08-18 on the session day 2026-08-17; verified against pnpm stamp --> |
| `g12-filters-probe` | 3 | the diagnosis of the two regressions — three page loads at 85701, phone and desktop, reading whether a press on Filters landed. |

**269 rows in total, all five declared, all five SYNTHETIC, 0 organic.** No
reaction was tapped and no feedback row was written; the two
`g11-r41-prod@2026-08-17` rows the author ruled KEEP were read and not touched.

Two further production requests carried a run id and wrote nothing, which is
worth stating so a later reconciliation does not look for them:
`g12-deploy-check` and `g12-deploy-check-2` were `GET /api/build`, and that
route writes no search-log row.

The local browser passes — the pill-cluster walk at four zips and two
viewports, the D35 card drive, the M134 pick states — ran against
`http://localhost:3000` and reached production not at all.

## g14 — 2026-08-18

Every run declared, and one leak found and named rather than discovered later.

| run id | rows | what it was |
|---|---|---|
| `g14-r47-probe@2026-08-18T15:53:06.680Z` | 7 | the R47 pin-flash measurement against production, BEFORE the fix — 4 of 4 runs flashed |
| `g14-m139-load@2026-08-18T16:36:55.154Z` | 6 | the load budget, first attempt (the ballot selector was wrong) |
| `g14-m139-load@2026-08-18T16:41:29.353Z` | 6 | the load budget, corrected — all four surfaces PASS |
| `g14-a07-probe@2026-08-18T17:02:22.441Z` | 4 | the A07 refusal-latency probe, first attempt (wrong ask selector) |
| `g14-a07-probe@2026-08-18T17:03:27.332Z` | 8 | the A07 refusal-latency probe, corrected |
| `g14-a07-probe@2026-08-18T17:40:56.608Z` | 6 | the same probe on "my water bill" |
| `walk-all-local@2026-08-18T16:50:11.644Z` | 74 | walk 1 — 2 named regressions (A07), both later proved to be the instrument |
| `walk-all-local@2026-08-18T17:05:13.139Z` | 73 | walk 2 — A02 red, A07 green |
| `walk-all-local@2026-08-18T17:16:32.090Z` | 68 | walk 3 |
| `walk-all-local@2026-08-18T17:30:26.804Z` | 70 | walk 4 |
| `walk-all-local@2026-08-18T17:43:36.435Z` | 75 | walk 5 |
| `walk-all-local@2026-08-18T17:54:44.637Z` | 74 | walk 6 |
| `walk-all-local@2026-08-18T18:05:39.195Z` | 89 | walk 7 — **302 ok, 0 FAIL** |

Two `GET /api/build` deploy checks and two `POST /api/ask/classify` probes
carried a run id and wrote no search-log row: `/api/build` writes none, and
the classify probes were refused 403 as cross-origin.

### THE LEAK: three ORGANIC rows this session created, and how

**Three `QUESTION_ASKED` rows landed ORGANIC**, with `run_id` null, at
`2026-08-18T18:13:00Z`, `18:14:12Z` and `18:15:25Z` — inside walk 7's window
(`18:05:43Z` → `18:16:18Z`). They are ours, not a reader's.

**The mechanism.** `lib/log/client.ts` prefers `navigator.sendBeacon` over
`fetch`, and **Playwright's `extraHTTPHeaders` do not apply to a beacon**. So
any event leaving by that path arrives with no `x-wtp-synthetic-run` header
and is recorded ORGANIC — a walk row counted as a reader in the store we sell.
It surfaced now because g14's fresh-page-per-ask fix reloads the page between
questions, and a page unload is exactly when a beacon flushes.

**Fixed forward:** every browser context in `walk-all.mts` and in this
session's five probe scripts now deletes `navigator.sendBeacon` before the
page loads, forcing the fetch fallback, which carries the header. The cost is
stated rather than hidden — these runs no longer exercise the beacon transport.

**The class, as a count:** `scripts/` holds **50 browser contexts; 10 are now
guarded and 40 are not** (36 other scripts). `R50` carries the rest.

**These three rows are NOT backmarked**, and that is deliberate rather than
forgotten. `pnpm searchlog:backmark` needs a write to production, and the only
sanctioned write path is `intake-limiter-purge` (R43). Correcting them needs
either the author at the console or a new named sanction — it is not something
a session should grant itself. The window above is exact so the correction is
a filter and never a hunt.

### CORRECTION — the first guard was a no-op, and four more rows leaked proving it

The fix written above was `delete navigator.sendBeacon`. **It does nothing.**
`sendBeacon` lives on `Navigator.prototype`, so deleting the own property on
`navigator` removes a property that was never there and the prototype method
still resolves. The guard type-checked, read correctly, and changed nothing.

It was caught the only way it could be: by re-running the walk and checking a
number that should not have moved. **Organic went 3 → 7.** Four more of our own
rows landed as readers, in the very run that was supposed to prove the fix.

**The working form** is an explicit override, now in all ten contexts:

```js
Object.defineProperty(navigator, "sendBeacon", {
  value: undefined,
  configurable: true,
});
```

**Verified by measurement, not by reading it again.** Organic before a run that
asks three questions: 7. Organic after: 7. Synthetic over the same run:
2143 → 2150. The events landed declared.

**The full leak is seven rows, all `QUESTION_ASKED`, all `run_id` null**, in
two windows — `18:13:00Z`, `18:14:12Z`, `18:15:25Z` (walk 7), and `18:34:23Z`,
`18:35:32Z`, `18:36:43Z`, `18:37:52Z` (walk 8). None are backmarked, for the
reason given above: that needs a production write nobody has sanctioned.

This is the third time in this session that a change which looked right did
nothing until it was measured. The lesson is not new and it is the repo's own:
verify the result, never the absence of an error.

---

## 2026-08-18, g15 — organic is 60, not 7, and this session wrote some of them

**The brief for this session instructed that any census it reports "states
organic 7 with one clause: all seven author-acknowledged test rows, standing per
his ruling." Production says 60.** That instruction was written against the
number as it stood; it is no longer the number, and reporting 7 because a brief
said 7 would be the exact defect this session spent its day fixing elsewhere.

`corepack pnpm census:runs --target=production`, run at the close of g15:

```
search_log: organic 60 · synthetic 2206 · unknown 2845 · author 17 · TOTAL 5128
RECONCILES 5128 accounted of 5128 rows
```

### Every organic row, by window

All 60 fall on **2026-08-18**. Times below are `America/Phoenix`, which is what
`pnpm stamp` uses; the earlier record above quotes the same rows in UTC.

| Window | Rows | What they are |
|---|---|---|
| 11:13:00 – 11:37:52 | **7** | The author-acknowledged set. All `QUESTION_ASKED`, all `run_id` null. **Standing per his ruling — not touched, not backmarked, not re-raised.** |
| 11:50:44 – 11:56:11 | **9** | `SEARCH` (85701, 85757, 03255, 85701, 85701), `DISTRICT_SELECTED` ×3, `QUESTION_ASKED`. **Before this session opened** (g15's first tool call was ~13:19). Not this session's, and not attributable from here — `run_id` is null. |
| 13:39:41 – 14:31:22 | **44** | Inside this session's wall clock. See below. |

### The 44, stated as honestly as the data allows

**They cannot be attributed row-by-row, because `run_id` is null on every one of
them — that is the whole shape of R50.** What can be said:

* They fall entirely inside g15's working window.
* Their event types are all CLIENT-side (`SEARCH`, `DISTRICT_SELECTED`,
  `OFFICIAL_OPENED`, `BODY_OPENED`, `FILTER_APPLIED`, `QUESTION_ASKED`) — they
  come from a browser driving the app, not from a plain `fetch`. Every plain
  fetch this session made carried `x-wtp-synthetic-run` and landed SYNTHETIC;
  the M135 audit's four GETs are in the census under
  `m135-search-audit@…` exactly as intended.
* **Two of the zips are near-conclusive.** 14:08:49 logs `SEARCH 88045` and
  14:08:52 logs `SEARCH 79247`. Those are Lordsburg, New Mexico and the Amarillo,
  Texas area — which are *named exterior sample points in
  `scripts/measure-focus.mts`*. Nothing but that instrument would pan the map
  there. g15 ran `pnpm measure:focus` four times (one baseline, one after the
  chroma fix, one planted-margin run, one control).
* The remaining rows are consistent with the same runs: `measure:focus` loads
  the app at 85701 and 03255 in both themes at three zooms, which is exactly the
  shape of the `SEARCH`/`DISTRICT_SELECTED` traffic in that window.

**Why they landed ORGANIC despite the run marker: R50.** `measure-focus.mts`
sets `extraHTTPHeaders: RUN_HEADERS` on the Playwright context, and that works
for ordinary requests — but the client's `logEvent` goes out over `sendBeacon`,
which does not carry those headers. The override that fixes it
(`Object.defineProperty(navigator, "sendBeacon", { value: undefined })`) was
added to the ten walk contexts and **was never added to `measure-focus.mts`**.
`tests/browser-construction.test.ts` makes scripts/browser.mts the only place a browser is opened (R50, 2026-08-18), so the
gap is worth checking there too.

**Nothing was backmarked and nothing was deleted.** R50's disposition is PENDING
the author by the standing rulings, and a backmark is a production write nobody
has sanctioned. This entry is the record until he rules.

**What it costs if nobody acts:** organic is the only countable class in the
store the business sells from, and it went 7 → 60 in a day, of which a
substantial share is our own instrument. A denominator that includes the
measuring apparatus is not a reader signal.
