# Pima school agendas: permitted routes for PCC, Sunnyside USD and Tucson USD

**Built on:** 2026-09-23 (`pnpm stamp`). Every retrieval time below is the UTC
instant the fetch log recorded, not a typed date.
**Branch:** `claude/pima-school-agenda-routes`.
**What this is not:** not a completeness claim about any government. Every count
is a count of what this session read. Nothing here says a body does not publish
something; where a record is still owed, the next move and who makes it are
named.

---

## 1. What readers see

Eighteen sittings (PCC 4, Sunnyside 6, Tucson Unified 8) showed only the
agenda portal, never the agenda, because each body's agenda is a linked
document on a Diligent Community host whose robots.txt refuses this client.

| Body | Sittings | Before this branch | Once it ships |
| --- | --- | --- | --- |
| Pima Community College | Aug 10 study session (Diligent 706) | the portal | **the agenda's items**, from the college's own PDF on `www.pima.edu` |
| Pima Community College | Aug 28 Finance & Audit (698), Sep 25 regular (705), Sep 25 executive session (707) | the portal | the college's own link to the agenda, labelled as a link we hold and not a document we hold ("We hold the link their calendar gave and not the document behind it") |
| Tucson Unified | Aug 25 special (493), Sep 8 regular (498), Sep 22 special (499) | the portal | **the agenda's items with the action taken on each**, from the Board's own Board Actions PDFs on `govboard.tusd1.org` |
| Tucson Unified | Aug 17 AEAC (494), Aug 20 BOC (496), Sep 11 BAC (500, cancelled), Sep 14 EBT (497), Sep 17 BOC (502) | the portal | unchanged: the portal. Committee agendas exist only on Diligent |
| Sunnyside USD | Jul 7 (162), Jul 28 (163), Aug 4 (174), Aug 11 (165), Aug 25 (166), Sep 8 (167) | the portal | unchanged: the portal. Sunnyside's agendas exist only on Diligent |

So **4 of the 18 gain agenda items** and **14 agendas remain owed**: 3 of them
(PCC) now say plainly that we hold the college's link and not the document, and
11 still show the portal. Beyond the 18, four older
in-window Tucson Unified board sittings (Jul 14, Jul 28, Aug 4, Aug 11) also
gain their Board Actions, and the college gains five upcoming sittings the
tenant had not listed (Oct 14 executive session, Oct 29 study session, Nov 4
regular and executive session, Nov 16 study session).

The routine clock stops reading the college's Diligent tenant in the same
change. Sunnyside's and Tucson Unified's tenants are still read by the
production wiring; whether that continues is the owner's separate decision.

---

## 2. Permission first, every host, before any content fetch

Client: this project's meeting-index User-Agent
(`we-the-people civic meeting index (https://github.com/SeanJ22/we-the-people)`)
with `X-Purpose` and `X-Contact`, the identification `lib/sources/http.ts`
sends. Evaluated with `lib/control-plane/scheduler/robots.ts` (token
`we-the-people`, falling to `*`), exact path and query.

| Host | Read (UTC) | HTTP / bytes / sha256 | Verdict for the paths used |
| --- | --- | --- | --- |
| `pima.community.highbond.com` | 20:02:48Z | 200 / 23,479 / `b5cbf0b4b2cbcf18…` | **DISALLOWED** (robots.txt only; nothing else requested) |
| `susd-12.community.highbond.com` | 20:02:49Z | 200 / 23,479 / same bytes | **DISALLOWED** (robots.txt only) |
| `tusd1-schooldesk.community.diligentoneplatform.com` | 20:02:49Z | 200 / 23,479 / same bytes | **DISALLOWED** (robots.txt only) |
| `www.pima.edu` | 20:02:50Z | 200 / 280 / `b1eef0e76beaaf36…` | ALLOWED |
| `events.pima.edu` | 20:04:10Z | 200 / 2,027 / `773fb8d35bb9a39d…` | ALLOWED |
| `www.susd12.org`, `susd12.org` | 20:02:50Z | 200 / 798 / `e8e9fa92b86ef4f7…` | ALLOWED (`Crawl-delay: 5` honoured) |
| `files.smartsites.parentsquare.com` | 20:05:24Z | 200 / 63 / `230452ec10f418cf…` | **DISALLOWED** (robots.txt only) |
| `govboard.tusd1.org` | 20:02:51Z | 200 / 68 / `4dceaa1a5fe89a38…` | ALLOWED (no `*` group) |
| `www.tusd1.org`, `tusd1.org` | 20:02:51Z | 200 / 441 / `e6f645a2c4d1c1dd…` | ALLOWED |
| `bond2023.tusd1.org` | 20:55:28Z | 200 / 31 | ALLOWED |
| `www.youtube.com` | 20:05:11Z | 200 / 792 | `/watch`, `/playlist` ALLOWED; `/feeds/videos.xml`, `/api/`, `/youtubei/` DISALLOWED |
| `help.diligentoneplatform.com` | 20:11:24Z | 404 | NO_ROBOTS |
| `developer.diligent.com` | 20:11:24Z | 200 with an HTML page | **CANNOT_TELL — refused**, nothing requested |
| `connect.diligent.com`, `www.diligent.com` | 20:11:27Z, 20:28:30Z | 200 | ALLOWED |
| `raw.githubusercontent.com`, `web.archive.org` | 20:11:59Z, 20:56:09Z | 404 | NO_ROBOTS |
| `brave.com`, `exa.ai` (price pages) | 20:09:50Z, 20:09:52Z | 200 | ALLOWED |

**The Diligent file is an allowlist.** Its `*` group refuses root, and six
groups (msnbot, slurp, googlebot, bingbot, duckduckbot, AddSearchBot) may read
`/Portal/`, `/document/` and `/Services/` under `Crawl-delay: 120`. The three
tenants serve it byte for byte, so the refusal is the vendor's default and one
change on Diligent's side (a `we-the-people` group) would admit this client on
every tenant (section 6, action A).

Volume: 74 page and document reads plus 21 robots.txt reads by the session
walker; two live passes of the new `pima-edu` adapter (15 reads each, all on
`www.pima.edu` and `events.pima.edu`); one Tucson Unified dry run (the `/Actions`
index and 7 Board Actions PDFs). **Zero requests to a disallowed or
cannot-tell path.** No login, no proxy, no captcha, no spoofed client.

---

## 3. Pima Community College — WIRED, cut over

**What exists.** Production held 7 in-window sittings from the tenant
(`meetings:diligent` partition, promoted 2026-09-23T19:48Z; 486 stored reads,
all of the portal page). Per the college's own documents page, the agenda for
each sitting is published there, sometimes as a first-party PDF.

**Permitted routes found.**

| URL | Format | What it carries |
| --- | --- | --- |
| `https://www.pima.edu/about-pima/leadership-policies/governing-board/board-meetings/documents.html` | HTML table | All 28 Governing Board sittings of 2026 with the college's links per row: agenda (PDF on `www.pima.edu`, or its Diligent link), Approved Items PDF, video |
| `https://events.pima.edu/?calendar[]=3&calId=10` + `/events/<slug>?date=YYYY-MM-DD` | HTML; add-to-calendar link as data | Every upcoming board sitting (8), with start, end and room |
| `…/finance-advisory-committee/index.html`, `…/agendas-minutes.html` | HTML tables | The committee's FY 2026-27 schedule (date, 9:00am, Zoom Webinar) and its per-sitting documents |
| `…/board-meetings/agendas-docs-2026/0810.pdf` | PDF, text layer, 2 pages | The Aug 10 study session agenda, "at 5:00 p.m. … VIRTUAL MEETING*", items 1.1–5 |
| `…/agendas-docs-2026/august10-board-meeting-approved-items.pdf`, `…/docs-agendas-minutes/2026.08.28-finance-and-audit-committee-meeting-approved-agenda-items.pdf` | PDF | Approved action items after the sitting. Not an agenda: never substituted for one |

**Built.** `lib/sources/pima-edu/index.ts` (documents table + events listing +
event pages + committee pages + first-party agenda headers), wired in
`lib/registry/source-wiring.ts` (agendaSourceType `PIMA_EDU`),
`lib/sources/composite/wiring.ts`, `lib/civic-data/meeting-partitions.ts`
(failure domain `www.pima.edu`), `lib/civic-data/source-authority.ts` (adds
`www.pima.edu` board paths and `events.pima.edu`; removes the tenant),
`lib/sources/agenda-slot.ts` (declared PRESENT, with no empty-slot
observations). `lib/sources/permission-gate.ts` asks each host's robots.txt
before every run. Cutover: `RETIRED_MEETING_ROUTES` in `source-wiring.ts`
names the retired (diligent, PCC) pair, refuses re-wiring it, and
`scripts/ingest.ts` refuses agenda retrieval from `pima.community.highbond.com`
while keeping the college's link as a link. Tests:
`tests/pima-edu-source.test.ts` (11), `tests/retired-meeting-routes.test.ts`
(6), fixtures `tests/fixtures/pima-edu/` with `retrieval.json`.

**Why the cutover also needed a succession rule.** A partition's identity
names its route (`meetings:diligent:<college>` becomes
`meetings:pima-edu:<college>`). Two things keyed on the old identity would
otherwise have broken:

- *The Reader proof.* Its meeting authority is the archived phase import,
  which names 83 promoted partitions by identity (the permanent 83/41).
  Without a rule, the full reproof refuses at once ("Reader phase import names
  an unregistered meeting partition"). Now `HELD_MEETING_PARTITIONS`
  (`lib/civic-data/meeting-partitions.ts`, derived from
  `RETIRED_MEETING_ROUTES`) maps the retired identity's imported disposition
  onto its registered successor (`scripts/lib/reader-proof-runtime.ts`). A
  promoted body stays promoted, and losing it is still a hard failure. An
  import that named both identities would be refused as a duplicate.
- *The page between deploy and the first promotion.* The successor has no
  pointer until the standing runner's first run of it. So the retired
  partition's last promoted version is composed in its place, read-only and
  proved like any pointer, and named on the successor's readback as
  `heldFrom` (`lib/meetings/snapshot.ts`, `lib/meetings/prepared-snapshot.ts`).
  The prepared reader snapshot couples to that held version, so the deploy
  changes nothing a reader sees; the successor's first promotion changes the
  coupling and recomposes. The held pointer is read only while its successor
  has none, so once superseded the retired route costs no further reads. Never
  two authorities for one body, and never none.
  Tests: `tests/held-meeting-partition.test.ts` (5) and two new controls in
  `tests/reader-proof-runtime.test.ts`.

**Reader-path dry run of the cutover** (`.scratch/dryrun-held.mts`,
21:54Z): production's promoted college partition (`cv-41cecb0c…`, promoted
20:53:06Z, read in a read-only transaction) served into an in-memory store,
with nothing fetched from any source host.
- *After deploy, before the first promotion:* the Reader composes the same 7
  sittings (`diligent:pcc:698…708`) and their 486 stored portal reads from the
  held version. The successor's readback is `NOT_RECORDED` with `heldFrom`
  naming that version. No calendar-unreachable wall for the college. The Reader
  proof accepts it as the inherited promoted authority. The prepared snapshot
  publishes once, then stays `CURRENT`.
- *After the first promotion* (replaying the earlier live permitted reads): the
  promotion is GOOD. The Reader composes the 12 `pima-edu:pcc:*` sittings and
  none of the held rows. The proof accepts, the prepared snapshot recomposes,
  and the held pointer is unchanged.

**Dry run of the first promotion** (live permitted reads, production promoted
venue projection, in-memory store; `.scratch/dryrun-pcc.mts`): **GOOD /
PROMOTED**, 15 acquisitions all on permitted hosts, 12 meetings, 1 agenda
document, 3 links held as links.

- **Same sitting, 7 of 7** (Diligent id → new id): 706 → `2026-08-10-study-session` (place `PCC District Office` → **online, `VIRTUAL MEETING`**, per its own agenda; agenda link portal → `0810.pdf`; 147 portal reads → 1 agenda document); 698 → `2026-08-28-committee` (online label `VIRTUAL MEETING` → `Zoom Webinar`); 705 → `2026-09-25-regular`; 707 → `2026-09-25-executive-session`; 708 → `2026-10-14-regular`; 699 → `2026-10-16-committee`; 700 → `2026-12-11-committee`. Times identical on all seven; titles and body names now the college's own words ("Regular Meeting", "Governing Board", "Finance and Audit Committee"). <!-- expected-future: scheduled sittings named by the new partition ids -->
- **Added, 5**: Oct 14 executive session (C-228), Oct 29 study session (C-105), Nov 4 regular (C-105) and executive session (C-228), Nov 16 study session (C-105).
- **Removed with authority: none.** The new partition starts empty. The retired `meetings:diligent` partition (7 sittings, 486 reads) stays in the store unchanged. Until the new partition's first promotion it is composed in its place as held rows, named on the readback (`heldFrom`), so the college's sittings never leave the page; the first promotion supersedes it.
- Ids change (`diligent:pcc:<n>` → `pima-edu:pcc:<date>-<kind>`), so anything keyed to the old ids (reader deep links, reaction targets) sees new ids from the first promotion.

**Owed.** Agendas for 698, 705, 707 and every future sitting the college posts
only on Diligent (action A; action D optional).

| Tried | Established | Next | Who moves |
| --- | --- | --- | --- |
| Tenant robots.txt | Disallowed by vendor allowlist | Action A | Owner (send), Diligent |
| College board pages, events calendar, committee pages | Permitted; every held sitting and 5 more; one first-party agenda | Wired | Coordinator ships with the batch reproof |
| Search (Brave #5) for the Sep 25 agenda elsewhere | Zero results | Recheck after the sitting for Approved Items | Standing runner (route), session (representation) |

---

## 4. Tucson Unified — agenda records WIRED; meeting-list route BUILT and HELD

**What exists.** Production's `meetings:diligent` partition (promoted
2026-09-23T20:41:55Z) holds 18 sittings and 967 stored reads of portal pages.
The district's own board site links everything to Diligent ("All meeting
notices, agendas, minutes, actions, recordings … are available on Diligent
Community") and publishes, itself, a Board Actions record per Governing Board
sitting.

**Permitted routes found.**

| URL | Format | What it carries |
| --- | --- | --- |
| `https://govboard.tusd1.org/Actions` | HTML index | 99 dated Board Actions entries (2022–2026), newest `September 22, 2026` |
| `https://govboard.tusd1.org/_theme/files/GovBoard/Docs/actions/09-22-2026S.pdf` (and one per sitting) | PDF, text layer | "GOVERNING BOARD AGENDA SPECIAL MEETING – Board Actions": every numbered item with its motion, mover, seconder and vote |
| `https://govboard.tusd1.org/inflow/xti/inCal.aspx?PID=36871&C=0&D=<YYYY-MM-DD>&V=12` | HTML month fragment (the Meeting-Calendar page's own call) | Every Governing Board and committee sitting: time, and the district's sentence about place, sometimes with a Zoom link |
| `https://govboard.tusd1.org/Meetings` | HTML + PDF | The Board-approved 2026 notice of meetings |
| `https://govboard.tusd1.org/` | HTML | Next-meeting notice (e.g. Oct 6 regular) |
| `https://www.tusd1.org/_theme/files/Governing%20Board/25-26/Jun16Agenda.pdf` | PDF (lead) | A first-party June 16 special-meeting agenda, found by search; no index links such files |

**Built and wired (agenda records).** `lib/sources/diligent/index.ts` reads the
Board's own `/Actions` index when a wiring row names it (`agendaRecordsUrl`,
`agendaRecordsTypeIds: 17,29` — the portal's Regular and Special type ids; 28,
Special Executive Session, has no Board Actions entry) and links a CONCLUDED
sitting's Board Actions PDF instead of the portal page. Parser shared in
`lib/sources/tusd-govboard/board-actions.ts`. The meeting list, partition and
clock are unchanged. Tests in `tests/tusd-govboard-source.test.ts`.

**Dry run of the next promotion** (production partition as promoted
20:41:55Z standing in for the runner's next service read — this session does
not read the tenant; only `govboard.tusd1.org` fetched live;
`.scratch/dryrun-tusd.mts`): **GOOD / PROMOTED**.

- **Changed, 7**: agenda link portal page → Board Actions PDF for 499 (Sep 22, 6 items extracted), 498 (Sep 8, 4), 493 (Aug 25, 6), 492 (Aug 11, 5), 491 (Aug 4, 2), 485 (Jul 28, 13), 484 (Jul 14, 7).
- **Added**: 7 agenda documents (967 → 974 stored versions).
- **Removed with authority: none.** 18 meetings before and after.

**Built and held (meeting list).** `lib/sources/tusd-govboard/index.ts` reads
the calendar fragments and `/Actions`. Against the held partition: 15 of 18
sittings at the same wall clock, 4 upcoming board sittings the tenant lacks
(Oct 6, Oct 27, Nov 17, Dec 8), and one correction (Jul 15 Audit Committee moved
to a Zoom webinar with a published link, while the tenant kept the old Morrow
Education Center room). **Held because it would lose facts:** Budget Advisory
Committee Sep 30 (505) is not on the calendar; EBT Oct 5 (504) is only in the
EBT page's prose; Budget Advisory Sep 11 shows as an ordinary meeting where the
tenant's title says CANCELLED DUE TO LACK OF QUORUM; Audit Committee Sep 16 says
"location TBD". A cutover today would show one cancelled meeting as held and
drop two upcoming ones. Tests `tests/tusd-govboard-source.test.ts`, fixtures
`tests/fixtures/tusd-govboard/`.

**Owed.** Committee agendas (5 of the 18) and pre-meeting agendas for board
sittings (Board Actions exist only after a sitting).

| Tried | Established | Next | Who moves |
| --- | --- | --- | --- |
| govboard `/Actions` + PDFs | Permitted; agenda items for every concluded board sitting | Wired | Coordinator ships |
| govboard calendar fragments | Permitted; 15 of 18 held sittings + 4 new; 3 held facts missing | Held; recheck the gaps weekly | Standing runner once wired; session until then |
| Committee pages, `bond2023.tusd1.org`, Brave #4, #13, #14 | Charters and members; agendas link to Diligent or BoardDocs (both refuse) | Action B | Owner (send), district |
| `www.tusd1.org` (Jun 16 agenda PDF via Brave #8) | The district has posted an agenda first-party at least once; no index | Watch for an index; ask in action B | District |
| Wayback CDX for the tenant | 1 capture in 2026 (a PDF of 2026-08-28), none of the target sittings | Not a route | — |

---

## 5. Sunnyside USD — meeting-list route BUILT and HELD; agendas owed

**What exists.** Production's partition (promoted 2026-09-23T20:41:52Z) holds
12 sittings and 875 stored portal reads. The district's own page says
"January 24, 2023 – Present: Diligent" for agendas and minutes.

**Permitted routes found.**

| URL | Format | What it carries |
| --- | --- | --- |
| `https://www.susd12.org/api/calendars/150042/events?start_date=…&end_date=…&view_source=event-slider` | JSON (the home page calendar component's own call; id from its JSON config) | 13 Governing Board entries that carry all 12 held sittings at the same wall clock, and descriptions such as "Public Hearing at 11:30 AM followed by Governing Board Meeting" |
| `https://www.susd12.org/governing-board-home` | HTML | Standing schedule and room, "unless otherwise noted"; board members' published emails |
| `https://www.youtube.com/playlist?list=PLTBo-3s9P-vx9gH0buzdaJ7SzJ0yIOLNW` | HTML + page JSON | A pre-scheduled stream for every sitting through May 2027; no agenda content |

**Built and held.** `lib/sources/smartsites/index.ts` (generic ParentSquare
SmartSites calendar adapter; reads the wall clock in the body's zone because the
tenant is set to `America/Denver`). **Held because it states no place:** every
board event's `address` is empty, and the district's Diligent titles mark Oct 13
and Nov 24 VIRTUAL where its calendar does not. A cutover today would drop 12
of 13 sittings as unplaceable rather than place them by the standing sentence.
Tests `tests/smartsites-source.test.ts`, fixtures `tests/fixtures/smartsites/`.

**Owed.** Every agenda (6 of the 18 and all future sittings).

| Tried | Established | Next | Who moves |
| --- | --- | --- | --- |
| District site pages, calendar API | Permitted; dates and times; no place; agendas link to Diligent | Held; action C | Owner (send), district |
| ParentSquare file host | Disallowed | — | — |
| YouTube playlist and two watch pages | Schedule only | — | — |
| Legacy URLs from search (`/governing-board/event/…`) | Soft fallback: byte-identical generic page | Not records | — |
| Brave #1, #3, #9; Exa #2, #15 | No permitted copy of any 2026 agenda | Action C (records request if the district declines) | Owner |
| NovusAgenda archive (`sunnysideschools.novusagenda.com`, via Brave #3) | 2008 – Jan 2023 archive, per the district's own page | Not a route for 2026 | — |

---

## 6. Owner actions (fully specified)

**A. Diligent: one named robots.txt group (unlocks all three bodies, and every
other Diligent Community tenant, including Vail USD).**
- *Records it unlocks, and the evidence they exist:* the agenda documents behind
  the 14 still-owed sittings (PCC 698, 705, 707; TUSD 494, 496, 497, 500, 502;
  SUSD 162, 163, 165, 166, 167, 174) and every future sitting's agenda. Production holds each sitting from the tenant's own meeting
  service; the held portal pages carry the agenda panel ("Agenda | Splitscreen |
  Minutes | Print Version | Accessible Web Version"); the college's own page links
  705 and 707's agendas into the tenant.
- *Verified contact:* `legal@diligent.com` (Legal Department, 61 W 23rd Street 4th
  Floor, New York, NY 10010), named on `www.diligent.com/legal/terms-of-use`,
  read 2026-09-23.
- *Exactly what is needed:* a `User-agent: we-the-people` group in the Community
  tenants' robots.txt with the Googlebot group's rules, or written permission.
  No account, key or purchase.
- *Cost, limits, uncertainty:* no cost known. `Crawl-delay: 120` allows about 30
  requests an hour per tenant, enough for a daily run. Diligent may decline or
  defer to the districts; the Website Terms' robot clause and B09 remain open
  until they answer.
- *Where the owner provides it:* forward Diligent's reply, or tell the coordinator
  the group is live. Nothing secret is exchanged; we verify by re-reading
  robots.txt.
- *What happens immediately after:* re-read the three tenants' robots.txt; if
  ALLOWED for `we-the-people`, gate the Diligent service and document reads with
  `lib/sources/permission-gate.ts`, build the `.docx` agenda extraction for
  `/document/<id>`, dry-run each partition in memory, and hand it to the batch.
- *Draft:* `docs/email-diligent-legal.md` (Sean's voice, audited).

**B. Tucson Unified: committee meetings, cancellations and agendas on the board
site.**
- *Unlocks:* a meeting-list cutover that loses nothing (the three missing facts in
  section 4) and the committee agendas.
- *Verified contact:* Governing Board Office, (520) 225-6070; its email is under
  "Contact the Board" on `govboard.tusd1.org` (protected against scraping, so
  read it in a browser). Records requests: the same office.
- *Cost/limits:* none. *Afterward:* re-walk the calendar and committee pages,
  rerun the held adapter's diff, and wire the list route when it is a superset.
- *Draft:* `docs/email-tusd-clerk.md` (audited).

**C. Sunnyside USD: place on each calendar event, and agendas on the district's
own site.**
- *Unlocks:* a list cutover that places every sitting, and agendas without
  Diligent.
- *Verified contacts:* Board President Beki Quintero, `BekiQ@susd12.org`, as
  listed on `susd12.org/governing-board-home` (read 2026-09-23); district office
  +1 520-545-2000. Formal route for specific agendas: the district's public
  records form, `https://forms.gle/Kx8vfofpa6mCJemQ8`, linked from
  `susd12.org/436692_2` ("SUBMIT A PUBLIC RECORDS REQUEST", A.R.S. 39-121).
- *Cost/limits:* none stated; the district warns records fulfilment may be
  delayed. A records request returns copies, not a feed.
- *Afterward:* re-read the calendar API; if events carry a place, rerun the diff
  and wire the SmartSites route.
- *Draft (Sean's voice, audited: 0 banned strings, 0 em dashes in the body):*

  > **To:** BekiQ@susd12.org
  > **Subject:** Board meeting calendar: location and agendas
  >
  > Your district calendar lists every Governing Board meeting through December, with times. Meanwhile, a free civic app, reads it to show Sunnyside residents when the board meets.
  >
  > Two things would make it complete. Each board meeting's event has no location, so a resident can't tell an in-person meeting from a virtual one. Diligent calls October 13 and November 24 virtual. The calendar doesn't say. And the agendas are only on Diligent, which turns away every crawler except six search engines, so we can't read them.
  >
  > If the calendar events carried the location and the agendas went on susd12.org, residents would see both through us the day you post them. Every entry credits the district and links to your page.
  >
  > We'll keep reading the calendar either way.
  >
  > Sean Johnson
  > Meanwhile

**D. Pima Community College (optional; its route is already live).**
- *Unlocks:* the three owed PCC agendas and future ones, without Diligent.
- *Verified contacts:* `boardofgovernors@pima.edu` (Contact the Board page) and
  `pcc-boardstaff@pima.edu` (documents page), read 2026-09-23.
- *Ask:* post each meeting's agenda as a PDF on `www.pima.edu`, as the college did
  for the Aug 10 study session. Afterward: nothing to build; the wired adapter
  reads a first-party link the day it appears.

---

## 7. Expansion routes (RULING 253)

| # | Route | How it was conceived | Literal URL or query | Returned | Generalises |
| --- | --- | --- | --- | --- | --- |
| 1 | Count every robots group, not just `*` | Re-reading the tenant file before building replacements | `https://pima.community.highbond.com/robots.txt` | 6 admitted crawlers, one byte-identical file on 3 tenants | Every Diligent tenant; any allowlist-style robots |
| 2 | The body's documents table as a meeting source | The registry already named it `agendaSourceRef` | `https://www.pima.edu/about-pima/leadership-policies/governing-board/board-meetings/documents.html` | 28 sittings, 1 first-party agenda | Colleges and districts that mirror their portal |
| 3 | Add-to-calendar link as data | Looking for the room the listing omitted | `https://events.pima.edu/events/board-special-meeting-conduct-executive-session-18?date=2026-09-25` | start, end, room for 8 of 8 | Any CMS with a calendar button | <!-- expected-future: a scheduled sitting's event page as the college publishes it -->
| 4 | SmartSites calendar JSON | The district's sentence pointing at its home-page calendar | `https://www.susd12.org/api/calendars/150042/events?start_date=2026-06-25&end_date=2026-12-31&view_source=event-slider` | 32 events, 13 board | Every ParentSquare SmartSites district | <!-- expected-future: the query window end used to read the district calendar -->
| 5 | The board calendar's own fragment call | The calendar page was empty in served HTML | `https://govboard.tusd1.org/inflow/xti/inCal.aspx?PID=36871&C=0&D=2026-09-23&V=12` | 7 September sittings incl. committees | Sites on the same CMS |
| 6 | Board Actions as the agenda record | Reading the board site's nav before the vendor | `https://govboard.tusd1.org/Actions` | 99 dated entries; 7 in window | Boards that publish action summaries |
| 7 | Agenda record route inside the existing partition | The owner's point that TUSD lists were current and content was not | `agendaRecordsUrl` on the TUSD wiring row | 7 records, dry run GOOD | Any body whose list must stay put |
| 8 | Wayback CDX for the tenants | Ladder rung 11 | `https://web.archive.org/cdx/search/cdx?url=susd-12.community.highbond.com/*&output=json&limit=200&from=2026` | sporadic 2026 captures, none for the target sittings | Recorded as not a route |
| 9 | District YouTube playlist | The brief's video-description branch | `https://www.susd12.org/video-archive` → playlist | schedule only, zero agenda items | Recorded |

Figures: **expansion routes conceived 9; returning rows 7 of 9; returning zero
or blocked 2 of 9 (8, 9)** — reported successes. Stuck protocol: the five moves
were run for the SUSD agenda (browser query: Brave #1, #3; tier above: the
county school superintendent, `www.schools.pima.gov`, is the districts' filing
officer per `docs/sources.md` and was not walked for agendas this session;
same-shape bodies: Amphitheater USD publishes on BoardBook, which is permitted,
so the shape exists elsewhere; compilers: local news via Exa #15 found none;
lateral: Wayback, #8). **Fields returned to owed: 14 sittings' agendas**, none
asserted absent.
Credentials proven by calling: Brave and Exa keys (2 of 2 used). Sources past
expiry: none relied on.

---

## 8. Search queries and cost

Pointer-only calls through the configured keys (read from the main checkout's
`.env.local` by name, never printed). Prices are each provider's published list
price, read 2026-09-23: Brave Search API "Search" plan **$5 per 1,000 requests**
(`https://brave.com/search/api/`, which also states $5 of free credit a month);
Exa Search **$7 per 1,000 requests** for up to 10 results
(`https://exa.ai/pricing`).

| # | Provider | Query | Results |
| --- | --- | --- | --- |
| 1 | Brave | `"Sunnyside Unified" "Governing Board" agenda "September 8, 2026"` | 0 |
| 2 | Exa | `Sunnyside Unified School District No. 12 Governing Board meeting agenda September 2026` | 10 |
| 3 | Brave | `Sunnyside Unified School District governing board agenda 2026 pdf` | 10 |
| 4 | Brave | `"Tucson Unified" "Bond Oversight Committee" agenda 2026` | 7 |
| 5 | Brave | `"Pima Community College" "Governing Board" "September 25, 2026" agenda` | 0 |
| 6 | Exa | `Diligent Community public portal API documentation meetings agendas export for developers` | 10 |
| 7 | Brave | `Diligent Community boards portal API developer documentation public meetings` | 10 |
| 8 | Brave | `site:tusd1.org governing board agenda 2026` | 10 |
| 9 | Brave | `site:susd12.org governing board agenda 2026` | 10 |
| 10 | Brave | `site:pima.edu governing board agenda 2026 pdf` | 10 |
| 11 | Brave | `tusd1.org "Detailed Agenda" 2026` | 0 |
| 12 | Brave | `site:tusd1.org "Governing Board Agenda" September 2026` | 4 |
| 13 | Brave | `Tucson Unified "Bond Oversight Committee" 2026 agenda minutes site:tusd1.org` | 4 |
| 14 | Brave | `Tucson Unified "Employee Benefits Trust" agenda September 2026` | 5 |
| 15 | Exa | `Sunnyside Unified School District governing board meeting agenda items approved August 2026` | 10 |

**Totals: 15 queries — Brave 12 ($0.060), Exa 3 ($0.021) — $0.081 at list
price**, against a cap of 100. Model spend: **none** (no Anthropic API call).
Production: read-only transactions only (partition payloads, promoted venue
resolutions); **nothing written to any production store**, including
`cp_field_manual` and the cost ledger.

---

## 9. Files

- New: `lib/sources/permission-gate.ts`, `lib/sources/sitting-status.ts`,
  `lib/sources/pima-edu/index.ts`, `lib/sources/smartsites/index.ts`,
  `lib/sources/tusd-govboard/index.ts`,
  `lib/sources/tusd-govboard/board-actions.ts`,
  `scripts/method/learn-pima-school-agenda-routes.mts`,
  `tests/pima-edu-source.test.ts`, `tests/smartsites-source.test.ts`,
  `tests/tusd-govboard-source.test.ts`, `tests/retired-meeting-routes.test.ts`,
  `tests/held-meeting-partition.test.ts`, `tests/fixtures/pima-edu/*`,
  `tests/fixtures/smartsites/*`, `tests/fixtures/tusd-govboard/*`, this ledger.
- Changed: `lib/registry/source-wiring.ts`, `lib/registry/types.ts`,
  `lib/sources/composite/wiring.ts`, `lib/sources/diligent/index.ts`,
  `lib/sources/agenda-slot.ts`, `lib/civic-data/meeting-partitions.ts`,
  `lib/civic-data/source-authority.ts`, `lib/meetings/snapshot.ts`,
  `lib/meetings/prepared-snapshot.ts`, `lib/meetings/source-labels.ts`,
  `scripts/lib/reader-proof-runtime.ts`, `scripts/ingest.ts`, `package.json`,
  `data/method/knowledge.json` (v72 → v81, through `runLearnBatch`),
  `docs/sources.md`, `docs/email-diligent-legal.md`, `docs/email-tusd-clerk.md`,
  `tests/meetings-data-plane-cutover.test.ts` and
  `tests/meeting-body-attribution.test.ts` (each names the one route/adapter
  registered after the frozen bootstrap fixture rather than widening its check),
  `tests/reader-proof-runtime.test.ts` (the frozen import names the retired
  identity, as the real one does), `tests/method-claims.test.ts` (control (e)
  scoped to its own amendment, the way its count already was), plus the
  regenerated views.
