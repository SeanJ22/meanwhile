# The zip playbook

**What "done" means for a zip code, and how to get there.** Born 2026-08-15
(the NH/NJ depth session), tracker **R13**.

This document exists because the same work was being re-derived every session.
A place is not covered because somebody worked on it; it is covered when a
list of checkable things is true of it. That list is section 1. Everything
after it is the how.

## The preamble the author wrote first

**The rungs written here are the rungs discovered so far.** Every new state is
presumed to teach new ones — a filing system nobody has seen, a vendor nobody
has met, a wall that opens from an angle nobody tried. **Discovering and
recording a rung is the work, not a deviation from it.** A session that spent
two hours learning that a state publishes its certified results as `.xls`
behind an Akamai wall and wrote none of it down has spent the discovery and
kept nothing.

**This file is APPEND-ONLY.** A rung that stops working gets a dated note
beside it — never a deletion. The next state may hit the same wall from a
different side, and the record of what failed is half the map. (`sos.nh.gov`'s
browser-UA rung worked on 2026-08-13 and had closed by 2026-08-14; both facts
are load-bearing and both are still written down.)

**Every zip or depth run ends with a playbook diff** — what was added — or an
explicit "nothing new," stated in the standing report. That rule is in
`CLAUDE.md` and it is permanent.

## 1. The definition of done for a zip

Machine-checkable where it can be, named-and-dated where it cannot. A zip is
done when every line is true or its exception is recorded with rungs.

| # | Check | How it is verified |
|---|---|---|
| 1 | **The who-governs set is complete against the official universe** | `docs/coverage-audit-by-county.md` — Census of Governments as the denominator, never our own registry (CLAUDE.md). The county audit answers "do we know all the bodies?" |
| 2 | **Every body governing the point is ingested, or its miss carries rungs** | `pnpm census:zip <zip>` prints INGESTED / NOT-INGESTED / NOT-ATTEMPTED per body with the vendor named. There is no "blocked". |
| 3 | **Officials to the Kelly standard** | Every seat on every wired body has a named holder with a source; party from a certified record or null; term note from the body's own page. `pnpm officials:audit`. |
| 4 | **Photos per the four doors** | Every roster member either has a portrait recording which door it shipped through, or honest initials with the doors tried recorded. `docs/photo-report.md`. |
| 5 | **Meetings live, or honestly absent with a denominator** | The snapshot carries meetings for every wired body; every adapter states fetched/normalized/dropped. A jurisdiction with no upcoming sitting says why. |
| 6 | **Ballot with plain-language summaries** | Contests, candidates and measures for the next election, each analysis sourced and rendered verbatim. |
| 7 | **Funding** | FEC committee + contributor surfaces where a federal candidate is on the ballot, behind the named ripcords. |
| 8 | **Ask-box topics resolve to this jurisdiction** | Every everyday-topic route lands on a body that actually governs the point — never another state's (the M53 contamination class). |
| 9 | **A stranger can read it** | The stranger test: no assumed local knowledge, every office explained, every body peopled. Walked at 390×844. |
| 10 | **Misses carry rungs, per candidate and per body** | `docs/source-ladder.md` + `lib/registry/coverage-audit.ts`. Equal effort per candidate within a race is a hard rule, not a target. |

## 2. The source ladder per jurisdiction type

The general ladder — thirteen rungs and "rung 14 is: add rungs" — lives in
`docs/source-ladder.md` and is not repeated here. What follows is what to try
FIRST for each kind of government, which is the part that saves the hours.

### County

1. The county's own domain, then the clerk-of-the-board page (not the
   commissioners' page — the clerk is who posts).
2. The vendor portal: Legistar (`<county>.legistar.com`), Granicus IQM2
   (`<slug>.iqm2.com/Citizens/Calendar.aspx?From=&To=`), CivicPlus, Revize.
3. Where the calendar is JS-only, the notices/agendas *document* page on the
   same site usually carries the history as dated PDFs — the day-not-hour
   shape (M59). Merrimack County NH is the worked example.

### Municipality — city

1. `<city>.gov` / `<city>az.gov` / `.org`, then the Clerk's boards directory.
2. **Never infer the agenda vendor from the website CMS.** Tucson runs
   Granicus OpenCities and is an OnBase agenda tenant. Wrong twice if assumed.
3. The Clerk's directory is usually the *complete enumeration of bodies* —
   Tucson's listed 56. That is the density source for a city, and it is one
   page.

### Municipality — New England town

1. `<town>.<st>.gov` is the modern shape (`newbury.nh.gov`); `.org` is often
   dead. Resolve the real domain before anything else.
2. Town portals (iCompass CivicWeb) frequently carry **only the selectboard**.
   Do not assume the portal is the town. Newbury's CivicWeb tenant published
   20 sittings in 2026 and every one of them was the Selectboard (verified
   2026-08-15, whole-year query, TypeId 10 on all 20 rows).
3. The other boards — planning, zoning, conservation — live on the town site
   as notice pages or PDFs. NH posts notice under RSA 91-A:2 with *no agenda
   requirement at all*, so a town may lawfully publish a date and a place and
   nothing else. Plan for the day-not-hour shape.
4. The town's **annual report** is a first-class source for rosters, terms and
   town-meeting results, and it is a PDF that often serves at 200 from a host
   whose HTML pages 403.

### School district

1. `<district>.org` or `<district>.k12.<st>.us`, then the "Board" or "School
   Board" section, then "Agendas and Minutes" — the agenda page is nearly
   always a distinct URL from the board page.
2. Vendors seen: Apptegy Thrillshare (`api.thrillshare.com/api/v4/o/<orgId>` —
   the JSON the district's own site renders from), BoardBook Premier
   (`<orgId>` on the org page, server-rendered whole archive), Diligent
   Community / BoardDocs, Simbli.
3. Regional/cooperative districts in NH and NJ govern a *different* set of
   towns than the elementary district. A zip can sit in two districts at once
   and both are its government.

### Special district

1. The Census of Governments individual-units listing gives the name and often
   a web address. Start there, because these are the class the registry
   structurally lacks and nobody stumbles across them.
2. Fire districts, water precincts and village districts in NH (RSA 52) are
   real governments with elected commissioners and their own meetings.

## 3. Rungs and recipes discovered, with their dates

Append here. Each entry: what it is, how to do it, when it was verified.

### The party recipe (M62, 2026-08-15) — verbatim from the session that found it

**A general-election canvass usually does not print party.** Pima County's
certified general canvass and the Morris County Clerk's official summary
report both carry candidate names and vote totals and no affiliation at all.
The documents that state party are:

- **Arizona** — the certified **primary** canvass, where the races are
  themselves headed by party: `DEM Board of Supervisors District 1`,
  `REP Board of Supervisors District 4`.
- **New Jersey** — the county clerk's certified **"Winners of the General
  Election"**, which has a Party column (the summary report does not).
- **New Hampshire** — the Secretary of State's certified county-office
  results, which print the party as a letter beside the name:
  `Steve Shurtleff, d`.

**And the same documents prove the negative.** Arizona school district
governing board races appear in Pima's general canvass with no party beside
any candidate, and appear in the party-organised primary canvass under no
party heading at all — they are not in that election. That is the election
authority's own record saying these seats carry no party, which is a far
stronger answer than "the district's page doesn't mention one".

New Hampshire towns **adopt** a partisan or non-partisan ballot system under
RSA 669, so the statute alone cannot answer it for a particular town — the
town's own ballot or annual report has to.

### The verify-the-absence rung

Never record "no party", "no meetings", "no photo" from a page that simply
did not mention the thing. Find the document that would have carried it and
show that it does not. The negative is a claim and carries the same evidence
burden as the positive — see the school-board example above, where the
absence of a party heading in a party-organised document is the proof.

### The NH Secretary of State ladder (2026-08-15, walked to the end)

`sos.nh.gov` refuses this network. The ladder that works anyway:

| Rung | Attempt | Result |
|---|---|---|
| 1 | A committed filing snapshot already in this repo | Right host, often the wrong document — honestly wrong |
| 2 | Search-index cache | **HIT** for the document *path*, proving the file exists and is indexed |
| 3 | The direct document path under `sos.nh.gov/sites/g/files/…` | **403**, host-wide. Try it per document anyway — the same trick **works** on `newbury.nh.gov`, which 403s its HTML and serves its PDFs at 200 |
| 4 | Internet Archive dated mirror | **HIT** — and the archive URL, with its date in it, is what gets cited, because it is the document that was actually read |
| 5 | The author's residential browser | The manual rung. Not needed here |

The browser-UA rung (a full Chrome UA string) worked on 2026-08-13 and had
**closed by 2026-08-14** — Akamai now 403s that too. Recorded, not deleted:
it may open again, and it still works on other hosts. (Those two dates are
wall clock. The older records in `docs/source-ladder.md` label the same two
sessions "08-16" and "08-18", which were sequence numbers running ahead of
the clock under a convention retired 2026-08-14; `docs/state.md` §18 explains
them to a stranger.)

Two hosts that 403 a general-purpose fetcher and **admit this project's
identified User-Agent**: `tucsonaz.gov` and `morriscountyclerk.org`.

### CivicPlus: the boards live in a different calendar category (2026-08-15)

Rockaway Township's wired iCal feed is `catID=25`, and it carries the Township
Council and nothing else. **`catID=30` is a second calendar** carrying the
Planning Board and the Board of Adjustment with real start times. Probing the
category ids is the rung: most return a 477-byte empty calendar, and the two
that do not are the whole density story for a township.

The matching archive is the `AgendaCenter` page, whose `<div id="cat<N>">`
blocks are per-body. Bind the id to the heading **in the DOM** — never by
document order — and never take every document on the page, or one board's
meetings get filed under another's.

**CivicPlus announces a cancellation by editing the SUMMARY text**
(`"Board of Adjustment Meeting Cancelled 8/18/26"`), not by an iCal `STATUS`
property. A `summaryMatch` prefix therefore matches the cancelled sitting too,
and it must be recognised as CANCELED rather than rendered as a meeting that
will happen.

### The served window is the fetch window (M76, 2026-08-15)

Every adapter had `WINDOW_BACK_DAYS = 30` while the app serves
`CONCLUDED_LOOKBACK_DAYS = 90`. Sixty days of published, retrievable history
were being dropped at the fetch, at every zip, silently — a density loss that
no count check caught because each adapter honestly reported what it fetched.
Adapter windows now derive from `lib/meetings/constants.ts`. **Check this
first when a jurisdiction looks thinner than its portal.**

### A town's portal may not be the town (2026-08-15)

**Never read a vendor tenant as the government.** Newbury's iCompass CivicWeb
portal published **20 sittings across the whole of 2026 and every one was the
Selectboard** (`TypeId` 10 on all 20 rows — a whole-year service query, not a
sample). The Planning Board, Zoning Board of Adjustment and Conservation
Commission are not on it at all, and a session that had read the portal as
"the town's meetings" would have recorded the town as fully covered while
missing three of its four boards.

The check is one query: ask the tenant for a whole year and count the distinct
type ids. One type id means one body, and the rest of the government is
somewhere else.

Corollary: `MeetingTypeList.aspx?type=<n>` **ignores the parameter** on that
tenant — every value 1–15 returned the identical page. Type discovery comes
from the service payload's own `TypeId`s, never from the type-list page.

### The published annual schedule (2026-08-15)

A source shape, not a vendor, and the one to try when a body runs no portal:
the body publishes its whole year of dates on one page with a single sentence
underneath naming the time and the room.

```
Monday, January 26, 2026
Monday, February 23, 2026
…
All meetings begin at 6:30 P.M. and are held in the Board of Education -
Board Conference Room.
```

Ladder rung 2, no portal in the path, and how a very large number of American
school boards publish. It is an adapter now (`lib/sources/schedulepage/`,
`AgendaSourceType: "SCHEDULEPAGE"`), so the next one is a wiring row.

Three rules that came with it, each one a way to get it wrong:

1. **Parse the time from the body's own sentence; never default it.** No
   sentence means `startPrecision: "DAY"` and a card that says the time was
   not posted.
2. **Require the weekday prefix on the date.** A bare `August 17, 2026` in a
   footer or a news teaser would otherwise become a meeting. The schedule list
   is the only place a body writes the weekday out.
3. **Join documents on the date in the body's own link text**, never on a
   filename.

And record `VENDOR_API: MISS` when there is no vendor. "This district runs no
portal" is a finding about the district; leaving it unrecorded makes it look
like a gap in the hunt.

### Probe the calendar category ids (2026-08-15)

On CivicPlus, and by extension any CMS with numbered calendar feeds: **the
boards are usually not in the council's category.** Rockaway's council feed is
`catID=25`; `catID=30` is a second calendar carrying the Planning Board and
the Board of Adjustment with real start times. Thirteen of the fifteen ids
tried returned a 477-byte empty calendar — the probe is cheap and it tripled
a township's coverage.

Bind each archive block's category id to its **own heading in the DOM**, never
by document order, or one board's meetings get filed under another's.

### Check the adapter's window before hunting a second source (2026-08-15)

When a jurisdiction reads thinner than its portal, the first suspect is our
own fetch window, not the publisher. Every adapter here had a 30-day lookback
against a 90-day served window, under a comment asserting they matched. No
count check catches this: the adapter honestly reports what it asked for.
Adapter windows now derive from `lib/meetings/constants.ts`.

### State roll calls: LegiScan, and the join that fails silently (2026-08-15)

Bulk first — `getDatasetList` → `getDataset`, one ZIP per state session,
refreshed Sunday mornings. Store `dataset_hash`, compare it, **never
re-download an unchanged dataset**. Never touch the legiscan.com front end.
The data is CC BY 4.0 and the attribution renders wherever it appears.

**The district mapping is the whole risk, and getting it wrong does not
throw — it produces a low match rate, which looks exactly like a thin
roster.** Two shapes so far:

- **Statewide numbering** (AZ, NJ, and every state's upper chamber seen so
  far): `HD-040` → `sldl:40`.
- **County numbering** (NH's House): `HD-12-HIL` is Hillsborough 12, and the
  Census SLDL code is the county's **zero-based alphabetical** ordinal
  concatenated with the two-digit district number → `sldl:512`. Belknap is
  ordinal 0, so its codes lose the leading zero: Belknap 7 is `sldl:7`, not
  `sldl:007`. Both details were wrong on the first pass and both were silent.

**Assert the mapping against your own boundary labels.** Our geojson carries
`State House District Merrimack 08` beside `sldl:608`, which turns the
mapping from a remembered fact into a checked one. Do this for every new
state before trusting a match rate.

**Match on district AND surname, never name alone** — the district identifies
the seat and the surname is compared only within a district that already
matched. Fold accents and generational suffixes: "Walter"/"Walt", "Mary
Jane"/"Mary", "James"/"Jim" all occur between a legislature's own roster and
LegiScan's.

**Report the match rate WITH its denominator, per state.** A large unmatched
count is usually not a gap: most of a legislature governs outside our clipped
boundaries. What matters is that every roster seat that COULD match did.

### Let the surface drive the clip (2026-08-15)

A snapshot that holds "the N most recent" of anything must ask what the
surface renders. Arizona published 7,283 roll calls in one session and
**votes in bursts** — the 60 most recent covered two days, so any member
absent those two days would have rendered an empty record that reads as
"never votes". The clip is now the union of each member's own twelve most
recent, which guarantees every member with a record has one to show.

## 4. The scripts that exist

| Command | What it does |
|---|---|
| `pnpm census:zip <zip…>` | The who-governs table: every body governing the point, ingested / not-ingested / never-hunted, vendor named. Offline. |
| `pnpm meetings:report` | What each target zip resolves through the live composite, with per-source counts. Live network. |
| `pnpm officials:audit` | Roster completeness against the Kelly standard. |
| `pnpm ingest <source>` | One adapter, locally. |
| `pnpm signal:snapshot` | Freeze aggregates for calibration. |
| `pnpm stamp` | Today, `America/Phoenix`. Every written date comes from here. |
| `pnpm verify-stamps` | Audits `CLAUDE.md`'s Adopted dates against git history. |
| `pnpm legiscan:fetch` | State-legislature roll calls for AZ/NJ/NH, hash-gated. `--force` re-downloads. |

## 5. The state folders

`states/<st>/NOTES.md` is a state's own memory — its filing systems, its
vendors, its walls, its statutory posting rules. Appended by every session
that learns something about that state. The playbook is the method across all
states; `NOTES.md` is what is true of one.
