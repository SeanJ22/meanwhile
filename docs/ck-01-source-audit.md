# CK-01: source check and audit

Production read-only investigation on October 20, 2026, of the 2:45 AM ET Scoreboard. Built on River `5307d8b`, merged current River `a24a073`. No production rows, settings, or published facts were changed during verification.

## Source checks

**232 facts pass on freshly saved public pages; 719 reconstructed claims still fail §3.** Another 976 rejected claims were not retained, and 18 sources could not be reread. These last two groups are unresolved detective work, not established wrong facts. The 1,945 total exactly matches the reported queue.

The comparison uses real rejected entity/field/source rows and values recovered from their held roster/comment/candidate records. It does not invent missing values. The original rejected quote was generally discarded: these are checks of the uniquely recovered held value on a fresh saved page, not a claim that the old capture contained it. Each source was fetched once and reused locally.

| Family | Original reason | Total | Pass now | Fail §3 | Claim lost | Unreadable |
|---|---|---:|---:|---:|---:|---:|
| body | PAGE_NOT_ABOUT_ENTITY | 270 | 47 | 7 | 215 | 1 |
| body | QUOTE_NOT_ON_SAVED_COPY | 103 | 7 | 88 | 1 | 7 |
| body | VALUE_NOT_IN_QUOTE | 1 | 0 | 0 | 1 | 0 |
| body | SOURCE_BLOCKED | 159 | 131 | 24 | 1 | 3 |
| meeting | QUOTE_NOT_ON_SAVED_COPY | 1079 | 22 | 319 | 738 | 0 |
| meeting | VALUE_NOT_IN_QUOTE | 12 | 8 | 3 | 1 | 0 |
| person | PAGE_NOT_ABOUT_ENTITY | 23 | 0 | 23 | 0 | 0 |
| person | QUOTE_NOT_ON_SAVED_COPY | 297 | 17 | 255 | 18 | 7 |
| person | VALUE_NOT_IN_QUOTE | 1 | 0 | 0 | 1 | 0 |

Current §3 failures: 23 PAGE_NOT_ABOUT_ENTITY, 696 QUOTE_NOT_ON_SAVED_COPY.

Causes repaired:

- PDF bytes are preserved exactly and checked through a complete text derivative. Public pages with scanner findings use the existing sanitized derivative while retaining their civic words. They previously failed acquisition.
- The saved artifact must have the finding’s cited URL; the first unrelated fresh artifact no longer substitutes. Unchanged content observed again updates its observation time. Stale receipts trigger a fresh acquisition.
- Equivalent UTC calendar instants and local wall times carry the full source date/time into the quote. A different UTC instant does not pass.
- Generated “governing” suffixes and “Township of Denville” / “Denville township” word order no longer prevent jurisdiction identification. The complete jurisdiction and state remain required; an official postal state abbreviation with a ZIP is normalized to the state name. Bare state abbreviations do not count.
- A rejected claim now retains its value, quote, source/copy, provenance and producer in its existing blank. Scoped hunt packets expose the exact failure to detectives. The existing import checksum replays the replaced checker once per current input so verified values publish without an owner gate.
- Unsupported full addresses, absent names/roles and unproved identity remain blocked. No §3 requirement was waived.

### Real examples by family, original reason and recheck result

Each nonempty group has three distinct fact examples below, or every example when fewer than three exist. A missing claim or unreadable source is unresolved, rather than a failed fact.

**body · PAGE_NOT_ABOUT_ENTITY · CLAIM_NOT_RETAINED (215)**

- `ocd-division/country:us/state:az/county:graham#governing` / `member:ocd-person/e6867fcc-bd6f-411b-b983-7f32182fdcf7`; `The rejected claim was not kept on its blank, and no unique matching record is held.`; [source](https://www.azcleanelections.gov/november-3-2026/graham).
- `ocd-division/country:us/state:az/county:pinal#governing` / `comment:detail`; `The rejected claim was not kept on its blank, and no unique matching record is held.`; [source](https://pinal.novusagenda.com/AgendaPublic/MeetingView.aspx?MeetingID=1443&MinutesMeetingID=-1&doctype=Agenda).
- `ocd-division/country:us/state:az/county:pinal#governing` / `member:ocd-person/f251bc90-e3e2-4a15-af14-a3d396dc926e`; `The rejected claim was not kept on its blank, and no unique matching record is held.`; [source](https://www.pinalcso.org/staff-directory).

**body · PAGE_NOT_ABOUT_ENTITY · FAILS_SECTION3 (7)**

- `ocd-division/country:us/state:nj/place:morris_plains#governing` / `member:ocd-person/2d2cda1f-c961-4640-b695-08483c807bd6` — value: "Bill Houston"; `QUOTE_NOT_ON_SAVED_COPY`; [source](https://morrisplainsboro.org/governing-body/).
- `ocd-division/country:us/state:nj/place:morris_plains#governing` / `member:ocd-person/677c8650-47de-4f7b-95bb-566c8da3320c` — value: "Jason Karr"; `QUOTE_NOT_ON_SAVED_COPY`; [source](https://morrisplainsboro.org/governing-body/).
- `ocd-division/country:us/state:nj/place:morris_plains#governing` / `member:ocd-person/7af5f005-6c2a-4ac0-a464-16a17ac89f52` — value: "Art Bruhn, Jr."; `QUOTE_NOT_ON_SAVED_COPY`; [source](https://morrisplainsboro.org/governing-body/).

**body · PAGE_NOT_ABOUT_ENTITY · NOW_PASSES (47)**

- `ocd-division/country:us/state:nj/county:morris/place:denville_township#governing` / `member:ocd-person/04da06c1-d2f4-4039-b029-eb3baadfe817` — value: "Glenn R. Buie"; `PASS`; [source](https://www.denvillenj.gov/administration/township_council.php).
- `ocd-division/country:us/state:nj/county:morris/place:denville_township#governing` / `member:ocd-person/41fba2af-9561-4555-9bef-c5757cb1f123` — value: "Mark Venis"; `PASS`; [source](https://www.denvillenj.gov/administration/township_council.php).
- `ocd-division/country:us/state:nj/county:morris/place:denville_township#governing` / `member:ocd-person/6c14979a-2734-4ff6-acd7-5bba7398cbf3` — value: "Adrienne Zimmermann"; `PASS`; [source](https://www.denvillenj.gov/administration/township_council.php).

**body · PAGE_NOT_ABOUT_ENTITY · UNREADABLE_SOURCE (1)**

- `ocd-division/country:us/state:az/place:safford#governing` / `comment:detail`; `SourceHttpError: HTTP 403 for https://library.municode.com/az/safford/codes/code_of_ordinances?nodeId=COOR_TIT2ADPE. This is a WALL on rung 2, not an absent document — an access control, never bypassed.`; [source](https://library.municode.com/az/safford/codes/code_of_ordinances?nodeId=COOR_TIT2ADPE).

**body · QUOTE_NOT_ON_SAVED_COPY · CLAIM_NOT_RETAINED (1)**

- `ocd-division/country:us/state:az/school_district:elfrida_elementary_district#board` / `homepage`; `The rejected claim was not kept on its blank, and no unique matching record is held.`; [source](https://www.elfridaschools.org/).

**body · QUOTE_NOT_ON_SAVED_COPY · FAILS_SECTION3 (88)**

- `curated:az/pima-community-college#governing` / `comment:attend` — value: "District Office, 4905 E. Broadway Blvd., Tucson; regular meetings are live-streamed per the board meetings page."; `QUOTE_NOT_ON_SAVED_COPY`; [source](https://www.pima.edu/about-pima/leadership-policies/governing-board/board-meetings/public-comment.html).
- `curated:az/pima-community-college#governing` / `comment:detail` — value: "Public Comment is a standing part of Governing Board meetings, per the board's published procedure."; `QUOTE_NOT_ON_SAVED_COPY`; [source](https://www.pima.edu/about-pima/leadership-policies/governing-board/board-meetings/public-comment.html).
- `curated:az/pima-community-college#governing` / `comment:period` — value: "Public Comment is a standing part of Governing Board meetings, per the board's published procedure."; `QUOTE_NOT_ON_SAVED_COPY`; [source](https://www.pima.edu/about-pima/leadership-policies/governing-board/board-meetings/public-comment.html).

**body · QUOTE_NOT_ON_SAVED_COPY · NOW_PASSES (7)**

- `ocd-division/country:us/state:az/place:tucson#governing` / `member:ocd-person/38b05eaa-b9c1-45e0-bfe1-9aec3e932170` — value: "Regina Romero"; `PASS`; [source](https://www.tucsonaz.gov/Government/Mayor-Council-and-City-Manager/Mayor-Regina-Romero).
- `ocd-division/country:us/state:az/place:tucson#governing` / `member:ocd-person/5e0f62d2-e2cc-4356-a106-cccd74e5f6a9` — value: "Nikki Lee"; `PASS`; [source](https://www.tucsonaz.gov/Government/Mayor-Council-and-City-Manager/City-Council-Wards).
- `ocd-division/country:us/state:az/school_district:vail_unified_district#board` / `member:ocd-person/1c952818-8541-4a1d-be5e-61c434b66f61` — value: "Ed Buster"; `PASS`; [source](https://www.vailschooldistrict.org/o/vsd/page/governing-board).

**body · QUOTE_NOT_ON_SAVED_COPY · UNREADABLE_SOURCE (7)**

- `ocd-division/country:us/state:az/place:sierra_vista#governing` / `member:ocd-person/3eb76a55-ede6-4a00-b29f-b096eb5f0b9b`; `SourceHttpError: HTTP 403 for https://www.sierravistaaz.gov/government/city-council/contact-the-mayor-council. This is a WALL on rung 2, not an absent document — an access control, never bypassed.`; [source](https://www.sierravistaaz.gov/government/city-council/contact-the-mayor-council).
- `ocd-division/country:us/state:az/place:sierra_vista#governing` / `member:ocd-person/47fc2b46-632a-478b-932f-c5f6dc3c8c33`; `SourceHttpError: HTTP 403 for https://www.sierravistaaz.gov/government/city-council/contact-the-mayor-council. This is a WALL on rung 2, not an absent document — an access control, never bypassed.`; [source](https://www.sierravistaaz.gov/government/city-council/contact-the-mayor-council).
- `ocd-division/country:us/state:az/place:sierra_vista#governing` / `member:ocd-person/53dcfa00-659f-48b2-83ee-3013df821204`; `SourceHttpError: HTTP 403 for https://www.sierravistaaz.gov/government/city-council/contact-the-mayor-council. This is a WALL on rung 2, not an absent document — an access control, never bypassed.`; [source](https://www.sierravistaaz.gov/government/city-council/contact-the-mayor-council).

**body · VALUE_NOT_IN_QUOTE · CLAIM_NOT_RETAINED (1)**

- `ocd-division/country:us/state:az/school_district:safford_unified_district#board` / `member:ocd-person/7aaa1f9d-bad6-438f-82e9-5ad800bdf81a`; `The rejected claim was not kept on its blank, and no unique matching record is held.`; [source](https://www.saffordusd.com/district111/governing-board-home/governing-board-home).

**body · SOURCE_BLOCKED · CLAIM_NOT_RETAINED (1)**

- `ocd-division/country:us/state:az/place:marana#governing` / `meeting_cadence`; `The rejected claim was not kept on its blank, and no unique matching record is held.`; [source](https://www.maranaaz.gov/Council/Council-Meetings-Agendas-and-Citizen-Participation).

**body · SOURCE_BLOCKED · FAILS_SECTION3 (24)**

- `ocd-division/country:us/state:az/county:pima#board-of-adjustment-district-4` / `member-row:roster:pima-boa4#1` — value: "Robert Fee"; `QUOTE_NOT_ON_SAVED_COPY`; [source](https://www.pima.gov/2792).
- `ocd-division/country:us/state:az/county:pima#board-of-adjustment-district-4` / `member-row:roster:pima-boa4#2` — value: "Greg Stanton"; `QUOTE_NOT_ON_SAVED_COPY`; [source](https://www.pima.gov/2792).
- `ocd-division/country:us/state:az/county:pima#board-of-adjustment-district-4` / `member-row:roster:pima-boa4#3` — value: "William Yarnell"; `QUOTE_NOT_ON_SAVED_COPY`; [source](https://www.pima.gov/2792).

**body · SOURCE_BLOCKED · NOW_PASSES (131)**

- `ocd-division/country:us/state:az/county:pima#governing` / `member-row:roster:pima#1` — value: "Rex Scott"; `PASS`; [source](https://www.pima.gov/government/board_of_supervisors/).
- `ocd-division/country:us/state:az/county:pima#governing` / `member-row:roster:pima#2` — value: "Dr. Matt Heinz"; `PASS`; [source](https://www.pima.gov/government/board_of_supervisors/).
- `ocd-division/country:us/state:az/county:pima#governing` / `member-row:roster:pima#3` — value: "Jennifer Allen"; `PASS`; [source](https://www.pima.gov/government/board_of_supervisors/).

**body · SOURCE_BLOCKED · UNREADABLE_SOURCE (3)**

- `ocd-division/country:us/state:nh/county:merrimack#governing` / `member-row:roster:merrimack#1`; `PDF_EXTRACTION_INCOMPLETE`; [source](https://www.merrimackcounty.net/Departments/Administration/Annual%20Reports/Final%20Annual%20Report%202025.pdf).
- `ocd-division/country:us/state:nh/county:merrimack#governing` / `member-row:roster:merrimack#2`; `PDF_EXTRACTION_INCOMPLETE`; [source](https://www.merrimackcounty.net/Departments/Administration/Annual%20Reports/Final%20Annual%20Report%202025.pdf).
- `ocd-division/country:us/state:nh/county:merrimack#governing` / `member-row:roster:merrimack#3`; `PDF_EXTRACTION_INCOMPLETE`; [source](https://www.merrimackcounty.net/Departments/Administration/Annual%20Reports/Final%20Annual%20Report%202025.pdf).

**meeting · QUOTE_NOT_ON_SAVED_COPY · CLAIM_NOT_RETAINED (738)**

- `meeting:boardbook:2065:750774` / `location`; `The rejected claim was not kept on its blank, and no unique matching record is held.`; [source](https://meetings.boardbook.org/Public/Organization/2065).
- `meeting:boardbook:2065:754104` / `location`; `The rejected claim was not kept on its blank, and no unique matching record is held.`; [source](https://meetings.boardbook.org/Public/Organization/2065).
- `meeting:boardbook:2065:756139` / `location`; `The rejected claim was not kept on its blank, and no unique matching record is held.`; [source](https://meetings.boardbook.org/Public/Organization/2065).

**meeting · QUOTE_NOT_ON_SAVED_COPY · FAILS_SECTION3 (319)**

- `meeting:clerksboards:128:2026-07-20` / `location` — value: "900 S. Randolph Way, Tucson, AZ"; `QUOTE_NOT_ON_SAVED_COPY`; [source](https://clerksboards.tucsonaz.gov/boards/?board=128).
- `meeting:clerksboards:128:2026-07-20` / `starts_at` — value: "2026-07-20T17:30:00-07:00"; `QUOTE_NOT_ON_SAVED_COPY`; [source](https://clerksboards.tucsonaz.gov/boards/?board=128).
- `meeting:clerksboards:128:2026-10-19` / `location` — value: "900 S. Randolph Way, Tucson, AZ"; `QUOTE_NOT_ON_SAVED_COPY`; [source](https://clerksboards.tucsonaz.gov/boards/?board=128).

**meeting · QUOTE_NOT_ON_SAVED_COPY · NOW_PASSES (22)**

- `meeting:ical:bradford-cemetery-trustees:5knqlqc2tp4vkdc8hq2seggpms@google.com/20261208T200000Z` / `starts_at` — value: "20261208T150000"; `PASS`; [source](https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics).
- `meeting:ical:bradford-cemetery-trustees:5knqlqc2tp4vkdc8hq2seggpms@google.com/20270112T200000Z` / `starts_at` — value: "20270112T150000"; `PASS`; [source](https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics).
- `meeting:ical:bradford-independence-day-committee:2bqlbi9sard6qg20h3q0kkle0g@google.com` / `starts_at` — value: "20261029T220000Z"; `PASS`; [source](https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics).

**meeting · VALUE_NOT_IN_QUOTE · CLAIM_NOT_RETAINED (1)**

- `meeting:ical:warner-warner-river-local-advisory-committee:3mk1ko7kkosq1vqtkut055qbc5@google.com` / `starts_at`; `The rejected claim was not kept on its blank, and no unique matching record is held.`; [source](https://calendar.google.com/calendar/ical/mq5sbbdfvg3le9ddpc76qpo5d8%40group.calendar.google.com/public/basic.ics).

**meeting · VALUE_NOT_IN_QUOTE · FAILS_SECTION3 (3)**

- `meeting:schedulepage:chandler-city-council:2026-09-14:20870` / `starts_at` — value: "2026-09-14T16:00:00-07:00"; `QUOTE_NOT_ON_SAVED_COPY`; [source](https://www.chandleraz.gov/rest/events/day/20260914).
- `meeting:schedulepage:chandler-city-council:2026-09-14:20871` / `starts_at` — value: "2026-09-14T16:00:00-07:00"; `QUOTE_NOT_ON_SAVED_COPY`; [source](https://www.chandleraz.gov/rest/events/day/20260914).
- `meeting:schedulepage:chandler-city-council:2026-09-17:20875` / `starts_at` — value: "2026-09-17T16:00:00-07:00"; `QUOTE_NOT_ON_SAVED_COPY`; [source](https://www.chandleraz.gov/rest/events/day/20260917).

**meeting · VALUE_NOT_IN_QUOTE · NOW_PASSES (8)**

- `meeting:schedulepage:chandler-city-council:2026-09-14:20873` / `starts_at` — value: "202609146:00pm"; `PASS`; [source](https://www.chandleraz.gov/rest/events/day/20260914).
- `meeting:schedulepage:chandler-city-council:2026-09-17` / `starts_at` — value: "202609176:00pm"; `PASS`; [source](https://www.chandleraz.gov/rest/events/day/20260917).
- `meeting:schedulepage:chandler-city-council:2026-10-12` / `starts_at` — value: "202610126:00pm"; `PASS`; [source](https://www.chandleraz.gov/rest/events/day/20261012).

**person · PAGE_NOT_ABOUT_ENTITY · FAILS_SECTION3 (23)**

- `ocd-person/0488cc07-9af5-42f7-812c-2acfdf0bd5ad` / `website` — value: "https://www.rockawayborough.org/departments/council/"; `PAGE_NOT_ABOUT_ENTITY`; [source](https://www.rockawayborough.org/departments/council/).
- `ocd-person/183e2f48-b2c8-4cd0-bbfe-02e91f316dec` / `office:ocd-division/country:us/state:nj/place:chester#governing` — value: "Council Member"; `PAGE_NOT_ABOUT_ENTITY`; [source](https://chesterborough.org/government/mayor).
- `ocd-person/183e2f48-b2c8-4cd0-bbfe-02e91f316dec` / `website` — value: "https://chesterborough.org/government/mayor"; `PAGE_NOT_ABOUT_ENTITY`; [source](https://chesterborough.org/government/mayor).

**person · QUOTE_NOT_ON_SAVED_COPY · CLAIM_NOT_RETAINED (18)**

- `ocd-person/0c931440-1edf-4b49-8b10-45e4d2a93393` / `office:ocd-division/country:us/state:az/county:pima#central-arizona-water-conservation-district`; `The rejected claim was not kept on its blank, and no unique matching record is held.`; [source](https://www.cap-az.com/board/board-members/).
- `ocd-person/0c931440-1edf-4b49-8b10-45e4d2a93393` / `term_note:ocd-division/country:us/state:az/county:pima#central-arizona-water-conservation-district`; `The rejected claim was not kept on its blank, and no unique matching record is held.`; [source](https://www.cap-az.com/board/board-members/).
- `ocd-person/0d61e973-3cf0-46dc-9e55-ad32f84ef6b8` / `term_note:ocd-division/country:us/state:az/county:pima#central-arizona-water-conservation-district`; `The rejected claim was not kept on its blank, and no unique matching record is held.`; [source](https://www.cap-az.com/board/board-members/).

**person · QUOTE_NOT_ON_SAVED_COPY · FAILS_SECTION3 (255)**

- `ocd-person/02a3d802-a020-470b-8df9-13ca610e474c` / `email` — value: "mark@kammarketing.com"; `QUOTE_NOT_ON_SAVED_COPY`; [source](https://www.florhamparknj.gov/departments/mayorandcouncil).
- `ocd-person/02a3d802-a020-470b-8df9-13ca610e474c` / `term_note:ocd-division/country:us/state:nj/place:florham_park#governing` — value: "Term ends 2027"; `QUOTE_NOT_ON_SAVED_COPY`; [source](https://www.florhamparknj.gov/departments/mayorandcouncil).
- `ocd-person/02a3d802-a020-470b-8df9-13ca610e474c` / `website` — value: "https://www.florhamparknj.gov/MayorsDesk"; `QUOTE_NOT_ON_SAVED_COPY`; [source](https://www.florhamparknj.gov/departments/mayorandcouncil).

**person · QUOTE_NOT_ON_SAVED_COPY · NOW_PASSES (17)**

- `ocd-person/137cc2af-1fd7-4007-980c-c9f7e7dc041b` / `website` — value: "https://www.rocktwp.net/page/board-members"; `PASS`; [source](https://www.rocktwp.net/page/board-members).
- `ocd-person/1c952818-8541-4a1d-be5e-61c434b66f61` / `name` — value: "Ed Buster"; `PASS`; [source](https://www.vailschooldistrict.org/o/vsd/page/governing-board).
- `ocd-person/1c952818-8541-4a1d-be5e-61c434b66f61` / `website` — value: "https://www.vailschooldistrict.org/o/vsd/page/governing-board"; `PASS`; [source](https://www.vailschooldistrict.org/o/vsd/page/governing-board).

**person · QUOTE_NOT_ON_SAVED_COPY · UNREADABLE_SOURCE (7)**

- `ocd-person/3eb76a55-ede6-4a00-b29f-b096eb5f0b9b` / `name`; `SourceHttpError: HTTP 403 for https://www.sierravistaaz.gov/government/city-council/contact-the-mayor-council. This is a WALL on rung 2, not an absent document — an access control, never bypassed.`; [source](https://www.sierravistaaz.gov/government/city-council/contact-the-mayor-council).
- `ocd-person/47fc2b46-632a-478b-932f-c5f6dc3c8c33` / `name`; `SourceHttpError: HTTP 403 for https://www.sierravistaaz.gov/government/city-council/contact-the-mayor-council. This is a WALL on rung 2, not an absent document — an access control, never bypassed.`; [source](https://www.sierravistaaz.gov/government/city-council/contact-the-mayor-council).
- `ocd-person/53dcfa00-659f-48b2-83ee-3013df821204` / `name`; `SourceHttpError: HTTP 403 for https://www.sierravistaaz.gov/government/city-council/contact-the-mayor-council. This is a WALL on rung 2, not an absent document — an access control, never bypassed.`; [source](https://www.sierravistaaz.gov/government/city-council/contact-the-mayor-council).

**person · VALUE_NOT_IN_QUOTE · CLAIM_NOT_RETAINED (1)**

- `ocd-person/7aaa1f9d-bad6-438f-82e9-5ad800bdf81a` / `name`; `The rejected claim was not kept on its blank, and no unique matching record is held.`; [source](https://www.saffordusd.com/district111/governing-board-home/governing-board-home).

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

Focused checks: source capture/normalization, source artifact selection, publish/confirm and OWNER precedence, import replay, detective packet delivery, audit row identity and retired history, four owner choices and reader CAS, meeting facts, roster publication and reader preservation. Admin preview checks the four choices and a typed-value request, including refusal feedback. The 16-file focused suite passed (93 tests); the additional quoted-universe regression also passed. TypeScript, changed-file ESLint and diff whitespace checks passed after merging current River. The sandbox initially refused isolated worker processes; the same roster checks passed with subprocess execution enabled. The local HTTPS Admin preview passed in Chromium; no deployed Admin is claimed. The postal-address normalization was then checked against the production replay, source-capture and fact-store tests, including wrong-state and abbreviation-without-ZIP negatives; TypeScript and lint passed again.

Built for River; no migration or code deployment to production was performed by this lane. River must number/apply `CK-01_audit_flags.sql` with this code. Current counts are evidence of the read-only comparison, not a claim that production has already published the repaired facts.
