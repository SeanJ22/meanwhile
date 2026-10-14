# New Jersey — state notes

The state's own memory: filing systems, vendor patterns, walls, statutory
posting rules. Appended by every session that learns something about NJ.
Born 2026-08-15 (the NH/NJ depth session). The method across all states is
the field manual; this file is what is true of this one.

## Elections and filings

- **The county clerk is the election authority to read**, not the state. The
  Morris County Clerk's certified **"Winners of the General Election"** has a
  Party column; the clerk's official *summary report* does not. Asking the
  wrong one of the two documents produces a false "no party found".
- `morriscountyclerk.org` **403s a general-purpose fetcher and admits this
  project's identified User-Agent**. It served every certified document
  requested, first try, at a serialized pace.
- **School elections carry no party by statute** — N.J.S.A. 19:60-1: "No party
  designation shall appear on any ballot to be used in a school election."
- **An appointed seat has no certified result and therefore no party.**
  Rockaway Township's at-large council seat was certified in November 2023 to
  a different person; the current holder appears in NO certified winners list
  for 2023, 2024 ("NO LOCAL ELECTION") or 2025 — an absence checked in all
  three documents rather than assumed.

## Meeting notice, by statute

**N.J.S.A. 10:4-8** (the Open Public Meetings Act) requires 48 hours' notice.
NJ bodies therefore reliably publish a dated notice; the question is only
where the town files it.

## Vendors and site patterns

- **CivicPlus / CivicEngage** — Rockaway Township. Two first-party feeds:
  `common/modules/iCalendar/iCalendar.aspx?catID=<n>&feed=calendar` and
  `RSSFeed.aspx?ModID=65&CID=All-agendacenter`.
  **The boards live in a different calendar category from the council.**
  Rockaway's `catID=25` carries the Township Council (plus civic events — a
  yard sale, an open house); **`catID=30` carries the Planning Board and the
  Board of Adjustment** with real start times. Most other ids return a
  477-byte empty calendar. Probing the ids is the rung.
  **Cancellation is announced by editing the SUMMARY text**
  (`"Board of Adjustment Meeting Cancelled 8/18/26"`), never by an iCal
  `STATUS` property.
- **The `AgendaCenter` archive is per-body**, as `<div class="listing"
  id="cat<N>">` blocks. Bind the id to its heading in the DOM, never by
  document order. Rockaway's five, verified 2026-08-15:

  | id | Body | 2026 sittings archived |
  |---|---|---|
  | 2 | Township Council | 13 |
  | 3 | Board of Adjustment | 12 |
  | 4 | Planning Board | 7 |
  | 5 | Environmental Commission | 0 — archive stops in 2019 |
  | 7 | Board of Assessment Commissioners | 0 — archive stops in 2022 |

  The page's own JavaScript builds a search endpoint
  (`/AgendaCenter/Search/?term=&CIDs=…&startDate=…&endDate=…`) which fetches at
  200 and **ignores the date range**, returning the same rows as the category
  block. Found and deliberately not used — one GET, not two.
  A POST to `/AgendaCenter/UpdateCategoryList` reaches back to 2019; only the
  current year is ingested, because the app serves a 90-day concluded window.
- **Granicus IQM2** — Morris County. `Calendar.aspx?From=&To=` is
  server-rendered with future meetings; each row's tooltip publishes board,
  type, status, and the venue with street address. The
  `RSS.aspx?Feed=Calendar` pseudo-feed lists only published documents and is
  not a calendar.
- **No vendor at all** — Morris Hills Regional. The district runs a Finalsite
  CMS and publishes its whole year of board dates on one page with one
  sentence naming the time and the room: "All meetings begin at 6:30 P.M. and
  are held in the Board of Education - Board Conference Room." That is the
  SCHEDULEPAGE shape (M78), ladder rung 2, and it is a better source than most
  portals. Agendas and minutes are on a second page, each labelled with the
  meeting date in the district's own link text.
- **Apptegy Thrillshare** — Rockaway Township School District. The district
  site's own events API: `api.thrillshare.com/api/v4/o/<orgId>`, carrying
  start times with offsets, the venue string, and district-published
  coordinates. The org id is readable from the page's embedded state.

## Bodies covered at 07866 (Rockaway Township)

| Body | Source | State |
|---|---|---|
| Township Council | CivicPlus iCal `catID=25` + AgendaCenter cat 2 | LIVE |
| Planning Board | CivicPlus iCal `catID=30` + AgendaCenter cat 4 | LIVE (2026-08-15) |
| Board of Adjustment | CivicPlus iCal `catID=30` + AgendaCenter cat 3 | LIVE (2026-08-15) |
| Environmental Commission | AgendaCenter cat 5 — nothing since 2019 | known, empty |
| Board of Assessment Commissioners | AgendaCenter cat 7 — nothing since 2022 | known, empty |
| Morris County Board of County Commissioners | Granicus IQM2 | LIVE |
| Rockaway Township School District Board | Apptegy Thrillshare | LIVE |
| Morris Hills Regional School District Board | SchedulePage (mhrd.org BOE Meetings) | LIVE (2026-08-15) |

**A zip sits in two school districts at once.** 07866 is in the Rockaway
Township district (K-8) and the Morris Hills Regional district (high school),
and both are its government.

## Special districts

Eighteen in Morris County per the 2022 Census of Governments; two are curated
(RVRSA — Rockaway Township is a member municipality — and the Soil
Conservation District). **None of the county's twelve fire districts covers
Rockaway Township**: its fire service is municipal. Checked, not assumed.


## 2026-08-26 — THE CENTRALISED SHAPE, AND THE WALL THAT ANSWERS HTTP 200

(The sources-and-incumbency session. Append-only.)

**New Jersey centralises campaign-finance filing on ONE statewide authority**,
ELEC, under N.J.S.A. 19:44A — the opposite of Arizona's statutory routing to 109
separate filing officers, and the same shape as New Hampshire's.

**The citation is recorded as PARTIALLY UNVERIFIED and that is deliberate.** This
session did not read the statutory text from an authoritative host:
`elec.nj.gov` serves a challenge and `law.justia.com` answered **HTTP 403** at
rung 3 on 2026-08-26. The chapter citation comes from this project's own prior
records, not from a read performed this session.

### `elec.nj.gov` is a wall that answers HTTP 200

Re-confirmed 2026-08-26, byte-identical in shape to the 2026-08-24 record: an
**Imperva/Incapsula challenge served at HTTP 200 with a 212-byte body** carrying
`<META NAME="robots" CONTENT="noindex,nofollow">` and an `_Incapsula_Resource`
script. **A status check reads that as healthy.**

**The WEBSITE is walled and the DATA is not.** `njelecefilesearch.com` answers
and is wired. Recording ELEC as unreachable would be true of one host and false
of the fact.

### The state publishes the municipal directory itself

`nj.gov/nj/gov/county/localgov.shtml` — re-walked 2026-08-26, HTTP 200,
114,118 B, **618 outbound links, all 21 counties named, Rockaway Township
present**. the source registry records 624 entities on 2026-08-22 from the
committed walk; **both numbers are stated** rather than one being chosen — a page
that changes is not two instruments disagreeing.

The parent `nj.gov/nj/gov/county/` still answers **HTTP 200 with a styled "Page
not found"**. Control strings stay mandatory on directory routes.

### What was NOT looked for, said plainly

No NJ lobbyist registry. No NJ League of Municipalities walk. No answer on
whether the Legislature publishes bulk data or runs an online testimony system —
`njleg.state.nj.us` was walked (HTTP 200, 928,917 B) and the question was not
answered from it. Dated gaps, not absences.

## 2026-08-26 — THE DESCENT, AND WHAT IT FOUND IN MORRIS COUNTY

`pnpm descent --state nj`, 2 passes. **194 links found · 88 followed · 489
candidate bodies not already matched in the registry**, across six tiers. Full
counts in `states/nj/descent.md`, every candidate named in
`states/nj/descent-candidates.md`, and the register entry appended to
`sources.md`.

**THE WALK STOPPED, IT DID NOT FINISH.** Pass 2 queued **1,885** links that were
never followed. RULING 169: if the final pass found anything new, the walk was
not finished and the session says so.

### The tenancy find, and it is the most actionable thing here

**`morriscountynj.gov` links out to `morriscountynj.iqm2.com/Citizens/LegalNotice.aspx`.**
This project has an **IQM2 adapter** (`lib/sources/iqm2/`) and Morris County is
the county containing **07866**. It has never been connected.

That is the cheapest coverage in the product — an adapter we already own, a
tenant we already found, a county a reader is standing in — and it was invisible
because nothing had ever asked the inverse question. Every adapter here was
wired one tenant at a time for a body somebody had already decided to cover;
`pnpm tenancy` walks IN from a platform we read and asks who else is on it.

`states/nj/tenancy.md`: 374 hosts known, 45 probed, 3 refused on permission —
**9 reachable now**, 12 on a platform we recognise and cannot read (eCode360,
Granicus ViewPublisher, PrimeGov), 21 with nothing machine-readable detected.

**A caveat recorded rather than smoothed.** Several of the nine were matched on
`cp-civicplusuniversity2.civicplus.com`, which is CivicPlus's own
customer-training footer link and appears on every site the vendor builds. It is
genuine evidence the vendor built the site, and it is the WEAKEST form of that
evidence — nothing like `morriscountynj.iqm2.com/Citizens/LegalNotice.aspx`,
which is a real tenant path. The detector now labels vendor boilerplate in its
own evidence string so the two cannot be read as the same fact.

**And two of the nine are not government bodies at all** — `assemblydems.com`
and `njassemblygop.com` are party caucus sites the legislature's own pages link
to. The detector is recall-first by design (RULING 57) and this is what paying
for that looks like; they are named here so the nine is read honestly.

### Extraction verified against rendered content — the first time, ever

`pnpm verify:extraction`, 2026-08-26. New Jersey's rows:

- **Rockaway Township Board of Education — 6 of 7 names absent** from
  `rocktwp.net/page/board-members`.
- **Rockaway Township Council — 1 absent** (Joseph Jackson).
- **Kinnelon Borough Council — 1 absent** (James J. Freda).
- **Denville Township Council and Morristown Town Council — DISALLOWED.** Not a
  wall (RULING 148): the host says do not ask, and it is never re-walked on a
  clock. Their rosters are therefore unverified and stay that way.

### The Census disagreement, named and NOT resolved

New Jersey publishes **564** municipalities in five statutory forms — borough,
township, town, city, village. The 2022 Census of Governments records **320
Municipal + 239 Township = 559**, collapsing four of the five forms into one
class. **The Census has no word for BOROUGH**, which is what most of Morris
County is.

Five rows apart, and RULING 57 says two official enumerations that disagree is a
FINDING. It is recorded and not closed; closing it needs a third branch walked.
Full table at `states/TIERS.md`.

### What was NOT walked, said plainly

`elec.nj.gov` answered HTTP 200 and **FAILED ITS CONTROL STRING** — "ELEC" was
absent from the body it returned, which is RULING 93's *a 200 whose content is
not about the thing asked for is not a document*. The prior session recorded an
Imperva challenge on that host; this run did not establish which it was, and did
not walk past it.


## 2026-08-26 — THE LEADS BECAME BODIES, AND TWO OFFICIAL DOMAINS HAVE LAPSED

(The descent-resume session. Append-only.)

### 192 New Jersey bodies promoted, from 489 leads

The descent had left 489 unclassified New Jersey leads and **zero promoted
bodies** — not a low number but a structurally pinned one, because nothing in
the repository could perform the promotion transition at all. `pnpm
leads:adjudicate-descent` is the path that was missing. Of the 489:

```
rejected as not a body            85
  not a government publisher      57
  prose, not an entity             9
  court opinion                    9
  navigation label                 7
  not a document host              3
name unreadable by method 0      103   <- a limit of the method, never a finding
opened                           285
  PROMOTED                       192
```

**The 57 rejections confirm a finding this file already carried.** The note
above records `assemblydems.com` and `njassemblygop.com` as "not government
bodies at all … named here so the nine is read honestly". That was prose; it is
now a rule with a reason attached, in `lib/hunt/lead-triage.ts`, alongside
`njlm.org` and `njsba.org`. **The League of Municipalities' own pages are not a
tier of government** — but a municipality found ON its directory still
survives, which is how 208 New Jersey towns were found and is why the rule is
about the target's publisher and never about where the link was seen.

### Two official domains no longer belong to the government that reported them

Found by opening every Morris County government the 2022 Census of Governments
names, against the website each one reported to the Census Bureau:

- **`mtoliveboe.org`** — the Mount Olive Township School District's reported
  address. It answers HTTP 200 and serves **a Japanese personal-finance blog**
  (`すずブログ｜アラサー女子のゆるっと投資生活`). The domain has lapsed and been
  re-registered.
- **`WWW.MTLAKES.ORG`** — Mountain Lakes Borough School District's reported
  address, now titled only `mtlakes.org`, with no district content.

Neither is a wall and neither is an absence: the districts exist and govern. It
is the ADDRESS that is stale, and the Census's `web_address` column is a 2022
snapshot that nothing re-validates. **A registry that had trusted that column
would be pointing readers at a stranger's blog.** Both are recorded as
address-stale, and the control that caught them — requiring the page to name
the entity — is the only reason they were not promoted as bodies.

### The Census clip is a denominator this repo already owned

`data/audit/gus-2022-clip-counties.json` holds **98 active Morris County
governments**. Reconciled against the registry, 41 were held. The gap was
already described in this file as backlog; walking it is what had not happened.

**And the national file is committed too** —
`data/reference/census_govt_units_2022.csv`, **88,748 active governments across
52 state and territory codes, 38,046 carrying a web address**. The route built
for three counties is national the day anyone points it at another FIPS code.

### Still owed here, named rather than implied

- `elec.nj.gov` — still the Imperva challenge at HTTP 200 recorded above. Not
  re-walked this session; `njelecefilesearch.com` remains the route to the data.
- **The Morris County IQM2 tenant** (`morriscountynj.iqm2.com`) is still not
  wired, and this file still calls it "the cheapest coverage in the product".
  This session did not reach it.
- 103 New Jersey leads sit at `NEEDS_CLASSIFICATION` because the name test could
  not read them — `Law Division - Civil Part` is a real court and the heuristic
  cannot tell. That is a limit of method version 0, recorded as one.
