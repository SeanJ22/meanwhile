# CK-01: source check and audit

Production read-only investigation on October 20, 2026, of the 2:45 AM ET Scoreboard. Built on River `5307d8b`, merged current River `a24a073`. No production rows, settings, or published facts were changed during verification.

## Source checks

**225 facts pass on freshly saved public pages; 726 reconstructed claims still fail §3.** Another 976 rejected claims were not retained, and 18 sources could not be reread. These last two groups are unresolved detective work, not established wrong facts. The 1,945 total exactly matches the reported queue.

The comparison uses real rejected entity/field/source rows and values recovered from their held roster/comment/candidate records. It does not invent missing values. The original rejected quote was generally discarded: these are checks of the uniquely recovered held value on a fresh saved page, not a claim that the old capture contained it. Each source was fetched once and reused locally.

| Family | Original reason | Total | Pass now | Fail §3 | Claim lost | Unreadable |
|---|---|---:|---:|---:|---:|---:|
| body | PAGE_NOT_ABOUT_ENTITY | 270 | 40 | 14 | 215 | 1 |
| body | QUOTE_NOT_ON_SAVED_COPY | 103 | 7 | 88 | 1 | 7 |
| body | VALUE_NOT_IN_QUOTE | 1 | 0 | 0 | 1 | 0 |
| body | SOURCE_BLOCKED | 159 | 131 | 24 | 1 | 3 |
| meeting | QUOTE_NOT_ON_SAVED_COPY | 1079 | 22 | 319 | 738 | 0 |
| meeting | VALUE_NOT_IN_QUOTE | 12 | 8 | 3 | 1 | 0 |
| person | PAGE_NOT_ABOUT_ENTITY | 23 | 0 | 23 | 0 | 0 |
| person | QUOTE_NOT_ON_SAVED_COPY | 297 | 17 | 255 | 18 | 7 |
| person | VALUE_NOT_IN_QUOTE | 1 | 0 | 0 | 1 | 0 |

Current §3 failures: 30 PAGE_NOT_ABOUT_ENTITY, 696 QUOTE_NOT_ON_SAVED_COPY.

Causes repaired:

- PDF bytes are preserved exactly and checked through a complete text derivative. Public pages with scanner findings use the existing sanitized derivative while retaining their civic words. They previously failed acquisition.
- The saved artifact must have the finding’s cited URL; the first unrelated fresh artifact no longer substitutes. Unchanged content observed again updates its observation time. Stale receipts trigger a fresh acquisition.
- Equivalent UTC calendar instants and local wall times carry the full source date/time into the quote. A different UTC instant does not pass.
- Generated “governing” suffixes and “Township of Denville” / “Denville township” word order no longer prevent jurisdiction identification. The complete jurisdiction and state remain required.
- A rejected claim now retains its value, quote, source/copy, provenance and producer in its existing blank. Scoped hunt packets expose the exact failure to detectives. The existing import checksum replays the replaced checker once per current input so verified values publish without an owner gate.
- Unsupported full addresses, absent names/roles and unproved identity remain blocked. No §3 requirement was waived.

Three real examples per family/outcome (IDs are durable entity IDs; all values were checked on the linked saved reread):

**body: pass now**

- `ocd-division/country:us/state:nj/place:butler#governing` — `member:ocd-person/055b62aa-6b62-492a-9962-da3be6c0a5d1` = “Raymond Verdonik”; PASS; [source](https://www.butlerborough.com/cn/webpage.cfm?TID=19&TPID=3570).
- `ocd-division/country:us/state:nj/place:chatham#governing` — `member:ocd-person/3dbc8bd6-c206-4bb8-95db-2eebe39b1d70` = “Jocelyn Mathiasen”; PASS; [source](https://www.chathamborough.org/government/mayor).
- `ocd-division/country:us/state:nj/place:chester#governing` — `member:ocd-person/2230dc27-a81f-4afe-b719-95cd1a1e455a` = “Russell Goodwin”; PASS; [source](https://chesterborough.org/government/mayor).

**body: still fail §3**

- `ocd-division/country:us/state:nj/county:morris/place:denville_township#governing` — `member:ocd-person/04da06c1-d2f4-4039-b029-eb3baadfe817` = “Glenn R. Buie”; PAGE_NOT_ABOUT_ENTITY; [source](https://www.denvillenj.gov/administration/township_council.php).
- `ocd-division/country:us/state:nj/place:morris_plains#governing` — `member:ocd-person/2d2cda1f-c961-4640-b695-08483c807bd6` = “Bill Houston”; QUOTE_NOT_ON_SAVED_COPY; [source](https://morrisplainsboro.org/governing-body/).
- `curated:az/pima-community-college#governing` — `comment:attend` = “District Office, 4905 E. Broadway Blvd., Tucson; regular meetings are live-streamed per the board meetings page.”; QUOTE_NOT_ON_SAVED_COPY; [source](https://www.pima.edu/about-pima/leadership-policies/governing-board/board-meetings/public-comment.html).

**person: pass now**

- `ocd-person/137cc2af-1fd7-4007-980c-c9f7e7dc041b` — `website` = “https://www.rocktwp.net/page/board-members”; PASS; [source](https://www.rocktwp.net/page/board-members).
- `ocd-person/1c952818-8541-4a1d-be5e-61c434b66f61` — `name` = “Ed Buster”; PASS; [source](https://www.vailschooldistrict.org/o/vsd/page/governing-board).
- `ocd-person/1ef7e5d1-6f6f-464b-aba2-1de869af1b06` — `website` = “https://www.rocktwp.net/page/board-members”; PASS; [source](https://www.rocktwp.net/page/board-members).

**person: still fail §3**

- `ocd-person/0488cc07-9af5-42f7-812c-2acfdf0bd5ad` — `website` = “https://www.rockawayborough.org/departments/council/”; PAGE_NOT_ABOUT_ENTITY; [source](https://www.rockawayborough.org/departments/council/).
- `ocd-person/183e2f48-b2c8-4cd0-bbfe-02e91f316dec` — `office:ocd-division/country:us/state:nj/place:chester#governing` = “Council Member”; PAGE_NOT_ABOUT_ENTITY; [source](https://chesterborough.org/government/mayor).
- `ocd-person/1a122750-3cd6-46b8-9fad-b19fd870d7f3` — `office:ocd-division/country:us/state:nj/place:chester#governing` = “Council Member”; PAGE_NOT_ABOUT_ENTITY; [source](https://chesterborough.org/government/mayor).

**meeting: pass now**

- `meeting:ical:bradford-cemetery-trustees:5knqlqc2tp4vkdc8hq2seggpms@google.com/20261208T200000Z` — `starts_at` = “20261208T150000”; PASS; [source](https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics).
- `meeting:ical:bradford-cemetery-trustees:5knqlqc2tp4vkdc8hq2seggpms@google.com/20270112T200000Z` — `starts_at` = “20270112T150000”; PASS; [source](https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics).
- `meeting:ical:bradford-independence-day-committee:2bqlbi9sard6qg20h3q0kkle0g@google.com` — `starts_at` = “20261029T220000Z”; PASS; [source](https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics).

**meeting: still fail §3**

- `meeting:clerksboards:128:2026-07-20` — `location` = “900 S. Randolph Way, Tucson, AZ”; QUOTE_NOT_ON_SAVED_COPY; [source](https://clerksboards.tucsonaz.gov/boards/?board=128).
- `meeting:clerksboards:128:2026-10-19` — `location` = “900 S. Randolph Way, Tucson, AZ”; QUOTE_NOT_ON_SAVED_COPY; [source](https://clerksboards.tucsonaz.gov/boards/?board=128).
- `meeting:clerksboards:128:2027-01-18` — `location` = “900 S. Randolph Way, Tucson, AZ”; QUOTE_NOT_ON_SAVED_COPY; [source](https://clerksboards.tucsonaz.gov/boards/?board=128).

**claim not retained — three real examples**

- `ocd-division/country:us/state:az/county:graham#governing` / `member:ocd-person/e6867fcc-bd6f-411b-b983-7f32182fdcf7`: The rejected claim was not kept on its blank, and no unique matching record is held.; source detail: `https://www.azcleanelections.gov/november-3-2026/graham`.
- `ocd-division/country:us/state:az/county:pinal#governing` / `comment:detail`: The rejected claim was not kept on its blank, and no unique matching record is held.; source detail: `https://pinal.novusagenda.com/AgendaPublic/MeetingView.aspx?MeetingID=1443&MinutesMeetingID=-1&doctype=Agenda`.
- `ocd-division/country:us/state:az/county:pinal#governing` / `member:ocd-person/f251bc90-e3e2-4a15-af14-a3d396dc926e`: The rejected claim was not kept on its blank, and no unique matching record is held.; source detail: `https://www.pinalcso.org/staff-directory`.

**unreadable source — three real examples**

- `ocd-division/country:us/state:az/place:safford#governing` / `comment:detail`: SourceHttpError: HTTP 403 for https://library.municode.com/az/safford/codes/code_of_ordinances?nodeId=COOR_TIT2ADPE. This is a WALL on rung 2, not an absent document — an access control, never bypassed.; source detail: `https://library.municode.com/az/safford/codes/code_of_ordinances?nodeId=COOR_TIT2ADPE`.
- `ocd-division/country:us/state:az/place:sierra_vista#governing` / `member:ocd-person/3eb76a55-ede6-4a00-b29f-b096eb5f0b9b`: SourceHttpError: HTTP 403 for https://www.sierravistaaz.gov/government/city-council/contact-the-mayor-council. This is a WALL on rung 2, not an absent document — an access control, never bypassed.; source detail: `https://www.sierravistaaz.gov/government/city-council/contact-the-mayor-council`.
- `ocd-division/country:us/state:az/place:sierra_vista#governing` / `member:ocd-person/47fc2b46-632a-478b-932f-c5f6dc3c8c33`: SourceHttpError: HTTP 403 for https://www.sierravistaaz.gov/government/city-council/contact-the-mayor-council. This is a WALL on rung 2, not an absent document — an access control, never bypassed.; source detail: `https://www.sierravistaaz.gov/government/city-council/contact-the-mayor-council`.

## Audit

The exact rolling window is October 13, 2:45 AM ET through October 20, 2:45 AM ET: **64 RED and 3 INCONCLUSIVE**, 67 distinct facts. Day-key lookup alone includes one extra older Pima result; it was excluded.

| Family | Previous | Recheck | Cause |
|---|---:|---|---|
| member-offices | 50 RED | 50 GREEN on the current saved CSV | Internal `officeholderId` was treated as words the publisher must print. |
| comment-access | 14 RED | 14 retired records; outside current published accuracy | Historical curated records are no longer served by the current fact reader. Their summary text still fails literal replay. |
| comment-access | 3 INCONCLUSIVE | 3 retired records; outside current published accuracy | Same retired projection; page readability and retained summaries are separate from published facts. |

The 50 office values were rechecked within each member’s own CSV row, bound by the official NJ roster/bio ID link. Matching another member’s phone/address cannot pass. No currently published wrong office was established by this sample. The auditor now samples live scalar facts too, revisits the old ID-only failures, extracts PDFs, and excludes confirmed retired records from current accuracy while retaining their history. Rechecks replace audit results, not published facts.

Three real office rechecks:

- `member-offices:member-office:nj-legislature:283:district`: old RED solely on internal ID; new GREEN; office `{"lat": null, "lng": null, "zip": "07054", "city": "Parsippany", "phone": "973-917-3420", "state": "NJ", "address": "160 Littleton Road Suite 204"}`.
- `member-offices:member-office:nj-legislature:319:district`: old RED solely on internal ID; new GREEN; office `{"lat": null, "lng": null, "zip": "07095", "city": "Woodbridge", "phone": "732-855-7441", "state": "NJ", "address": "569 Rahway Ave."}`.
- `member-offices:member-office:nj-legislature:394:district`: old RED solely on internal ID; new GREEN; office `{"lat": null, "lng": null, "zip": "07733", "city": "Holmdel", "phone": "732-444-1838", "state": "NJ", "address": "101 Crawfords Corner Road Suite 4332"}`.

Three real retired comment rechecks:

- `comment-access:comment-access:ocd-division/country:us/state:az/place:tucson#governing`: no live `comment:%` fact for body `ocd-division/country:us/state:az/place:tucson#governing`. Extracted-page comparison still fails the stored summary wording; no published value was removed.
- `comment-access:comment-access:ocd-division/country:us/state:az/place:tucson#tucson-parks-and-recreation-commission`: no live `comment:%` fact for body `ocd-division/country:us/state:az/place:tucson#tucson-parks-and-recreation-commission`. Extracted-page comparison still fails the stored summary wording; no published value was removed.
- `comment-access:comment-access:ocd-division/country:us/state:az/county:pima#governing`: no live `comment:%` fact for body `ocd-division/country:us/state:az/county:pima#governing`. Extracted-page comparison still fails the stored summary wording; no published value was removed.

The exact 64 originally RED fact IDs:

```text
comment-access:comment-access:ocd-division/country:us/state:az/place:tucson#governing
comment-access:comment-access:ocd-division/country:us/state:az/place:tucson#tucson-parks-and-recreation-commission
comment-access:comment-access:ocd-division/country:us/state:az/county:pima#governing
comment-access:comment-access:ocd-division/country:us/state:az/place:tucson#board-of-adjustment
comment-access:comment-access:ocd-division/country:us/state:az/school_district:tucson_unified_district#board
comment-access:comment-access:ocd-division/country:us/state:az/place:tucson#community-police-advisory-review-board
comment-access:comment-access:ocd-division/country:us/state:az/place:tucson#citizens-water-advisory-committee
comment-access:comment-access:ocd-division/country:us/state:az/place:tucson#public-housing-authority
comment-access:comment-access:ocd-division/country:us/state:az/place:tucson#planning-commission
comment-access:comment-access:ocd-division/country:us/state:az/school_district:vail_unified_district#board
comment-access:comment-access:ocd-division/country:us/state:az/school_district:amphitheater_unified_district#board
comment-access:comment-access:ocd-division/country:us/state:nj/school_district:rockaway_township_school_district#board
member-offices:member-office:nj-legislature:283:district
comment-access:comment-access:ocd-division/country:us/state:nj/county:morris#governing
comment-access:comment-access:ocd-division/country:us/state:az/school_district:sunnyside_unified_district#board
member-offices:member-office:nj-legislature:319:district
member-offices:member-office:nj-legislature:394:district
member-offices:member-office:nj-legislature:405:district
member-offices:member-office:nj-legislature:223:district
member-offices:member-office:nj-legislature:424:district
member-offices:member-office:nj-legislature:411:district
member-offices:member-office:nj-legislature:370:district
member-offices:member-office:nj-legislature:414:district
member-offices:member-office:nj-legislature:422:district
member-offices:member-office:nj-legislature:287:district
member-offices:member-office:nj-legislature:279:district
member-offices:member-office:nj-legislature:320:district
member-offices:member-office:nj-legislature:416:district
member-offices:member-office:nj-legislature:313:district
member-offices:member-office:nj-legislature:401:district
member-offices:member-office:nj-legislature:175:district
member-offices:member-office:nj-legislature:305:district
member-offices:member-office:nj-legislature:310:district
member-offices:member-office:nj-legislature:285:district
member-offices:member-office:nj-legislature:419:district
member-offices:member-office:nj-legislature:342:district
member-offices:member-office:nj-legislature:341:district
member-offices:member-office:nj-legislature:155:district
member-offices:member-office:nj-legislature:392:district
member-offices:member-office:nj-legislature:397:district
member-offices:member-office:nj-legislature:258:district
member-offices:member-office:nj-legislature:415:district
member-offices:member-office:nj-legislature:388:district
member-offices:member-office:nj-legislature:400:district
member-offices:member-office:nj-legislature:333:district
member-offices:member-office:nj-legislature:334:district
member-offices:member-office:nj-legislature:329:district
member-offices:member-office:nj-legislature:371:district
member-offices:member-office:nj-legislature:413:district
member-offices:member-office:nj-legislature:309:district
member-offices:member-office:nj-legislature:420:district
member-offices:member-office:nj-legislature:395:district
member-offices:member-office:nj-legislature:366:district
member-offices:member-office:nj-legislature:408:district
member-offices:member-office:nj-legislature:306:district
member-offices:member-office:nj-legislature:423:district
member-offices:member-office:nj-legislature:381:district
member-offices:member-office:nj-legislature:237:district
member-offices:member-office:nj-legislature:362:district
member-offices:member-office:nj-legislature:406:district
member-offices:member-office:nj-legislature:412:district
member-offices:member-office:nj-legislature:228:district
member-offices:member-office:nj-legislature:387:district
member-offices:member-office:nj-legislature:409:district
```

The three originally inconclusive IDs:

```text
comment-access:comment-access:ocd-division/country:us/state:nh/county:merrimack#governing
comment-access:comment-access:ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#governing
comment-access:comment-access:ocd-division/country:us/state:nj/county:morris/place:rockaway_township#governing
```

## Publication and Sean’s choices

Audit paths no longer remove published records. Every challenged live scalar or legacy reader record creates an existing `owner_flag`, shown in the command center Queue with Remove it, Keep it, Send the fleet, and Type the right value. Published values are removed only when Sean chooses Remove. Typed values publish as OWNER immediately, persist through future official refreshes, and retain the optional source link; official disagreement opens a flag on that live OWNER value. Legacy reader decisions use the existing reader-artifact CAS so edge readers apply them without a database round trip.

## Verification and cost

Production Neon response bodies read: **2,020,646 bytes**, across 19 bounded read-only HTTP transactions (reader and control plane). Development connection diagnosis read another 4,386 bytes. Neon total: **2,025,032 bytes**. At $0.10/decimal GB this is about $0.000202; it measures response bodies, not unobservable TLS/protocol overhead. No whole table was downloaded. Queries selected the stuck rows, matching candidate/projection records, source metadata, exact audit day keys and relevant live comment fields. Public source downloads retained 47,247,134 response-body bytes across 227 URLs; failed request overhead is not measured and is separate from Neon egress.

Reproduce bounded production counts, three samples per family/reason and exact audit IDs with `scripts/ck-01-check.mts` using existing production read-only role connections in `CK01_READER_URL` and `CK01_CONTROL_URL`. `CK01_REPLAY` accepts recovered Claim inputs and invokes the actual §3 checker. No production credentials or raw scanner findings are committed.

Focused checks: source capture/normalization, source artifact selection, publish/confirm and OWNER precedence, import replay, detective packet delivery, audit row identity and retired history, four owner choices and reader CAS, meeting facts, roster publication and reader preservation. Admin preview checks the four choices and a typed-value request, including refusal feedback. The 16-file focused suite passed (93 tests); the additional quoted-universe regression also passed. TypeScript, changed-file ESLint and diff whitespace checks passed after merging current River. The sandbox initially refused isolated worker processes; the same roster checks passed with subprocess execution enabled. The local HTTPS Admin preview passed in Chromium; no deployed Admin is claimed.

Built for River; no migration or code deployment to production was performed by this lane. River must number/apply `CK-01_audit_flags.sql` with this code. Current counts are evidence of the read-only comparison, not a claim that production has already published the repaired facts.
