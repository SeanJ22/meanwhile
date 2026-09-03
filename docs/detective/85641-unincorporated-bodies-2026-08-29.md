# 85641 — the bodies with no municipality: fire districts, PCC, JTED, and the filing officer

**Workstream:** WS-DET (Lane A, detective/corpus)
**Built on:** 2026-08-29 (`pnpm stamp`)
**Wall-clock of every retrieval below:** UTC timestamps recorded by the fetch probe
at request time. UTC had already rolled to 2026-08-30 during this run; the local <!-- expected-future: 2026-08-30 is the UTC wall clock the fetch probe recorded; the Phoenix stamp date is 2026-08-29 -->
stamp date is 2026-08-29. No date in this file was typed from memory.

**What this is not:** not a completeness claim. Every count is a count of what
this session actually retrieved. Where a route was not walked it says so. No
statement here asserts that a government does not publish something.

**Predecessor:** `data/hunt/85641-obligation-ledger.json` (same date) listed the
bodies covering this ZIP that had **zero rosters and zero meetings** in the
corpus, and named the exact unwalked route for each. This session walked them.
The ledger is the floor; this is what was above it.

---

## 1. Summary of what changed

Six governing bodies that covered this ZIP with **no roster and no meeting** in
the corpus now have a named roster from a primary source, and four of them have
a retrievable meeting archive.

| Body | Share of ZIP | Before | After |
| --- | --- | --- | --- |
| Rincon Valley Fire District | 7/44 points | 0 roster, 0 meetings | 5 directors; agendas + **minutes** as PDFs on a `.gov` |
| Corona de Tucson Fire District | 6/44 points | 0 roster, 0 meetings | 5 directors + emails; **115 dated sittings** |
| Sonoita-Elgin Fire District | 2/44 points | 0 roster, 0 meetings | 5 directors + term/phone/email; **70 dated sittings** |
| Mescal-J6 Fire District | levies on ZIP | 0 roster, 0 meetings; host recorded unwalkable | 5 directors **with term dates**; host is a `.gov` now |
| Pima Community College Governing Board | **44/44 points** | 0 roster, no route recorded at all | 5 members by electoral district |
| Pima County JTED No. 11 Governing Board | 36/44 points | 0 roster, 0 meetings | 5 members; **267 meetings, 2009–2026**, agendas + packets |

Plus: **two ballot measures and one candidate-filing roster** for the
November 3, 2026 general election, from the filing officer — a class the
obligation ledger recorded as having no available source.

---

## 2. Permission first (RULING 148), every host, before any content fetch

Read with a bare Node `fetch` under two user agents (`MeanwhileCivicBot/1.0`
and a browser UA), over both schemes. Where the answer differed by client that
is recorded, because it is the difference between a rule and RULING 182
transport.

| Host | robots verdict | Evidence |
| --- | --- | --- |
| `www.rinconvalleyfd.org` | **NO_ROBOTS** — HTTP 404, 0 bytes, both schemes, both UAs | redirects to the host below |
| `rinconvalleyfdaz.gov` | **ALLOWED** — `User-agent: *` / `Disallow:` (empty value = nothing disallowed) | read 2026-08-30T05:31Z | <!-- expected-future: 2026-08-30 is the UTC wall clock the fetch probe recorded; the Phoenix stamp date is 2026-08-29 -->
| `www.coronafire.org` | **ALLOWED** — `User-agent: * / Allow: /`; named disallows are SemrushBot, AhrefsBot, Sidetrade, PetalBot, MJ12bot | 350 bytes, 200, both UAs |
| `www.sefd911.org` | **ALLOWED** — byte-identical policy shape to Corona (347 bytes) | same vendor, see §5 |
| `mescalj6fd.gov` | **ALLOWED for this client**, with a caveat — see §3 | 1,951 bytes |
| `www.pima.edu` | **ALLOWED** — `User-agent: *` with eight narrow disallows (`/secure/`, `/_dev/`, `/employee-tools/`, …); none covers the governing-board path | 280 bytes |
| `pimajted.org` (apex) | **ALLOWED** — `Disallow: /wp-admin/` only, plus a sitemap | see §4 — this is NOT the same origin as `www.` |
| `www.pimajted.org` | **CANNOT_TELL** — Cloudflare interstitial, HTTP 403, `<title>Just a moment...</title>` | RULING 182 transport, **never** a permission verdict |
| `meetings.boardbook.org` | **NO_ROBOTS** — HTTP 404, 0 bytes | BoardBook Premier, operated by Sparq Data Solutions Inc. |
| `www.schools.pima.gov` | **ALLOWED** — HTTP 200 with a **zero-byte body**: a robots.txt that exists and forbids nothing | bare `schools.pima.gov` HTTPS is ECONNREFUSED; the `www.` form serves |
| `pima-county-schools.s3.amazonaws.com` | document host for the above; documents retrieved 200 | see §6 |

### `mescalj6fd.gov` disallows ClaudeBot by name — and it is the second one

```
User-agent: *
Content-Signal: search=yes,ai-train=no,use=reference
Allow: /
...
User-agent: ClaudeBot
Disallow: /
```

This is the **same shape** as `azdor.gov`, which is already a Needs Sean row
(NH225): a `*` group that allows, a named-AI-crawler group that disallows, and a
`Content-Signal` reserving AI training. This client declares its own identity
and is therefore in the `*` group, so the fetch was made — but **two instances
make this a class, not a one-off**, and the author's NH225 judgement should be
written to cover the class rather than the single host. Nine agents are named
here: Amazonbot, Applebot-Extended, Bytespider, CCBot, **ClaudeBot**,
CloudflareBrowserRenderingCrawler, Google-Extended, GPTBot, meta-externalagent.

---

## 3. Two districts have migrated to `.gov`, and the corpus points at the old host

**This is the single most reusable correction in this document.**

| Recorded in the corpus | What it actually does now |
| --- | --- |
| `www.mescalj6fd.com` — recorded 2026-08-27 as `CANNOT_TELL`, "unwalkable because of a certificate" (`ERR_TLS_CERT_ALTNAME_INVALID`) | HTTPS still fails exactly as recorded. **Plain HTTP answers 200 and redirects to `https://mescalj6fd.gov/`.** The district migrated to a `.gov`; the `.com` is a stale redirector whose certificate was never updated. |
| `https://www.rinconvalleyfd.org/` — the `WEBSITE` attribute published by the Pima County fire-taxation GIS layer | 200, and the final URL is **`https://rinconvalleyfdaz.gov/`**. |

The 2026-08-27 record was **correct about the transport and wrong about the
conclusion a reader would draw from it**. A TLS failure on a stale hostname is
not a district that cannot be walked; it is a district that moved. Both are now
fully permitted, fully reachable `.gov` hosts.

Note what produced the stale pointer in the Rincon Valley case: the **county GIS
layer's `WEBSITE` attribute**. An authoritative government layer carried a URL
that had been superseded. The attribute is a lead, not an address.

---

## 4. The `www` host and the apex host are different origins

`www.pimajted.org` answers **HTTP 403 with a Cloudflare challenge** to every
client tried — Node fetch under two UAs, and curl under two more. A session that
stopped there would have recorded Pima County JTED as `BLOCKED_CURRENTLY`.

`pimajted.org` — the **apex, no `www`** — answers **HTTP 200** with an ordinary
WordPress robots.txt allowing everything but `/wp-admin/`, and serves the whole
site. Every JTED fact in this document came through the apex.

Also worth recording: `curl` with the `MeanwhileCivicBot` UA got a **301** from
`www.pimajted.org` where the same curl with its default UA got a **403**. Four
clients, three different answers, on one hostname. Vary the client *and* the
hostname before concluding.

---

## 5. The fire districts

### 5.1 Rincon Valley Fire District — `rinconvalleyfdaz.gov`

**Source:** `https://rinconvalleyfdaz.gov/c/6/district-board`
**Custodian:** the district itself. **Route:** rung 2, plain Node fetch.
**Retrieved:** 2026-08-30T05:32Z, HTTP 200. <!-- expected-future: 2026-08-30 is the UTC wall clock the fetch probe recorded; the Phoenix stamp date is 2026-08-29 -->

**Board (5), verbatim seat labels:**

| Name | Seat |
| --- | --- |
| Jennifer Spears | Chairperson |
| Kevin McKinley | Clerk |
| Chris Klasen | Member |
| Lora Gruner | Member |
| Glen Rodriguez | Member |

**Meeting rule, verbatim:** "Third Thursday of every month at 6:00 PM." at
Fire Station #2 Community Room, 14550 E. Sands Ranch Rd — **in Vail**.

**Open-meeting posting locations, which the district states are the only
official ones:** Station #292 Lobby, 14550 E Sands Ranch Rd, Vail; and
Station #291 Lobby, 8850 S. Camino Loma Alta, Vail. The page states expressly
that "only the physical location listed above may be relied on for official
posting under the Arizona Open Meeting Law." A reader asking *where is this
legally noticed* has an answer, and it is not the website.

**Documents — retrieved as real PDFs, HTTP 200, on the permitted `.gov`:**

| Document | Bytes | Header |
| --- | --- | --- |
| `0. 8.20.26 AGENDA Board Meeting.pdf` | 224,964 | `%PDF-1.6` |
| `1. Draft 7.16.26 MINUTES Board Meeting Minutes (1).pdf` | 193,035 | `%PDF-1.6` |
| `7.9.26 PSPRS AGENDA.pdf` | 112,804 | `%PDF-1.6` |
| `draft_2.29.24_psprs_minutes.pdf` | 167,104 | `%PDF-1.5` |

The board page links **41+** such documents under `/uploads/files/`: board
agendas and draft minutes across 2025–2026, PSPRS agendas and minutes, adopted
budgets FY2022/23 through FY2026/27, budget public-hearing notices, amended-budget
notices, a possible-quorum notice, board bylaws, and pension funding policies.

**This matters because the obligation ledger called minutes "the most productive
open frontier in this ZIP" and recorded that the Pima minutes PDFs sit on the
disallowed `legistar.granicus.com`.** For this body the minutes are first-party,
on a `.gov`, and permitted.

### 5.2 Corona de Tucson Fire District — `www.coronafire.org`

**Source:** `https://www.coronafire.org/board-members`, retrieved
2026-08-30T05:32Z, HTTP 200. <!-- expected-future: 2026-08-30 is the UTC wall clock the fetch probe recorded; the Phoenix stamp date is 2026-08-29 -->

| Name | Seat | District email |
| --- | --- | --- |
| Nate Weber | Board President | NWeber@coronafire.org |
| Jason Wagner | Board Clerk | Jwagner@coronafire.org |
| Phillip Karhoff | Board member | Pkarhoff@coronafire.org |
| Rob Edwards | Board member | Redwards@coronafire.org |
| Roosevelt Mcknight | Board member | RMcknight@coronafire.org |

**District address: 99 E. Tallahassee Dr., Corona AZ 85641** — the body's own
office is inside the target ZIP.

**Meeting rule, verbatim:** "holds a public meeting on the fourth Wednesday of
every month at 6:00pm at station 181 located at 99 E. Tallahassee Dr."

The page also states the governance facts a reader actually asks about: five
**voluntary, non-partisan** members, **elected by registered voters residing
within the District**, on **alternating four-year terms**, so **at least two
members are elected every two years**; and that the board "establishes policy,
sets tax rates, approves annual budgets, and hires the Fire Chief."

**115 dated board-meeting instances**, `2017-07-26` through `2026-08-26`, each
its own URL — see §5.4.

### 5.3 Sonoita-Elgin Fire District — `www.sefd911.org`

**Source:** `https://www.sefd911.org/board-of-directors`, retrieved
2026-08-30T05:32Z, HTTP 200. This is the richest roster of the four: seat, <!-- expected-future: 2026-08-30 is the UTC wall clock the fetch probe recorded; the Phoenix stamp date is 2026-08-29 -->
**term expiry**, phone and email for every member.

| Name | Seat | Term expires | Email |
| --- | --- | --- | --- |
| Chris Johnson | Chair | November 30, 2028 | sefdjohnson@sefd911.org |
| Ruth Ann LeFebvre | Clerk | **November 30, 2026** | lefbvre@sefd911.org |
| Scott Harris | Member | November 30, 2028 | harris@sefd911.org |
| Kat Crockett | Member | November 30, 2028 | crockett@sefd911.org |
| Eddie McArthur | Member | **November 30, 2026** | mcarthur@sefd911.org |

**70 dated board-meeting instances**, `2021-07-26` through `2026-08-24`,
including a **future** sitting (`2026-09-28`) and separately-noticed <!-- expected-future: 2026-09-28 is a meeting the district has already noticed, not a stamp -->
**PSPRS Local Board** sittings.

#### A trap that would have shipped two wrong members

The district's sitemap also contains
`/sefd-board-members-representing-sonoita-elgin-communities`, a page whose title
and prose read exactly like a roster:

> "Chris Johnson serves as Board Chair, Ruth Ann LeFebvre serves as Board Clerk,
> Robert Garber is a Member, Russ Kolsrud is a Member, and Eddie McArthur is a
> Member."

**Robert Garber and Russ Kolsrud are not on the current board.** That page is an
undated news post; the governance page `/board-of-directors` is the authority
and names Scott Harris and Kat Crockett in those seats. A crawler that took the
first roster-shaped page it found would have published two former members as
sitting officials, with a real district URL as its citation. See MC-4.

### 5.4 The vendor: Streamline, and why the sitemap *is* the meeting list

Corona and Sonoita-Elgin both run on **Streamline** (`Powered by Streamline` in
the footer; the two robots.txt files are the same policy at 350 and 347 bytes).
Streamline is a CMS specialising in **special districts** — precisely the
government class that has no municipality behind it and is therefore thinnest
everywhere in this product.

Streamline publishes **one URL per meeting instance, with the ISO date in the
slug**, and lists every one in `sitemap.xml`:

```
https://www.coronafire.org/2026-08-26-board-meeting
https://www.sefd911.org/2026-08-24-board-psprs-local-board-meeting-11-00-a-m
https://www.sefd911.org/2026-06-01-board-special-board-meeting-1-00p-m
```

Pattern: `/<YYYY>-<MM>-<DD>-<body>-<title-slug>`. The body segment separates the
**governing board** from the **PSPRS Local Board**, and the title slug carries
the meeting kind (regular / special / notice of possible quorum) and often the
wall-clock start time. **No API, no portal, no JavaScript, no vendor account** —
a single `sitemap.xml` GET yields a complete dated meeting inventory with the
body and kind already parsed. Measured: 170 sitemap URLs at Corona of which 115
are dated board meetings; 211 at Sonoita-Elgin of which 70 are.

Streamline tenants also expose, at stable slugs: `/board-members` or
`/board-of-directors`, `/board-meetings`, `/district-transparency`, `/budgets`,
`/audits`, `/public-records`, `/arizona-enabling-statute`, `/recall-information`,
and per-member pages (`/nate-weber`, `/rob-edwards`, …). Slugs vary between
tenants — Corona 404s on `/board-of-directors` and serves `/board-members`;
Sonoita-Elgin does the reverse. **Enumerate the sitemap; do not guess the slug.**

### 5.5 Mescal-J6 Fire District — `mescalj6fd.gov`

**Source:** `https://mescalj6fd.gov/board-members/`, retrieved
2026-08-30T05:35Z, HTTP 200. <!-- expected-future: 2026-08-30 is the UTC wall clock the fetch probe recorded; the Phoenix stamp date is 2026-08-29 -->

| Name | Seat | Term |
| --- | --- | --- |
| Dana Law | Board Chair | 01.06.2023 – **11.30.2026** |
| Soni Cido | Board Member | 11.30.2024 – 11.30.2028 |
| Deborah Wise | Board Clerk | 01.06.2023 – **11.30.2026** |
| Wade Temple | Board Member | 09.10.2024 – **11.30.2026** |
| William Clowers | Board Member | 11/19/2025 – 11/30/2028 |

Station 171, 448 N Warren Rd; Admin Office, 98 N. Oak Dr.

`/previous-minutes/` and `/previous-agendas/` exist and are permitted, but the
listing is rendered by a WordPress download-manager plugin and the served HTML
carried no document rows for the default filter. **That is `REQUIRES_NEW_ADAPTER`
— a rung nobody has climbed — and it is not an absence claim about Mescal-J6's
minutes.** The exact next route is in §9.

### 5.6 A body class this repo does not know about: the PSPRS Local Board

Three of the four fire districts publish a **PSPRS Local Board** as a body
distinct from the governing board:

- Sonoita-Elgin: a top-level nav item `/psprs-local-board`, with an archive, and
  separately noticed sittings in the sitemap (`2026-08-24-board-psprs-local-board-meeting-11-00-a-m`,
  `2024-10-28-...-10-45a-m`, `2024-06-24-...-11-30a-m`).
- Rincon Valley: `7.9.26 PSPRS AGENDA.pdf`, `4.25.25_psprs_agenda.pdf`,
  `1.15.25_psprs_agenda.pdf`, `8.30.24_psprs_agenda.pdf`,
  `2.29.24_psprs_agenda.pdf`, `draft_2.29.24_psprs_minutes.pdf` — all retrieved
  or listed on the permitted `.gov`.
- Corona de Tucson: `/corona-de-tucson-fire-district-public-safety-personnel-retirement-system-pension-funding-policy`.

Under A.R.S. Title 38 every Arizona employer with sworn public-safety personnel
seats a **local retirement board** that holds its own noticed public meetings and
decides individual disability and membership matters. It is a **non-governing
public body** with its own agendas and minutes, and the corpus has no concept of
it. This generalises well beyond Arizona fire districts — the same statute
reaches municipal police and fire employers statewide.

---

## 6. The filing officer publishes what the elections department has not

The obligation ledger records, for `ballot_contests`:

> "The November 3 GENERAL election document set. The county Upcoming Elections
> page had NINE published documents for the July primary and exactly ONE for the
> general (vote-center locations) as of 2026-08-27."

That is true of `www.pima.gov/810`. It is **not** true of the office that
actually receives the filings. RULING 170's question — *who was compelled to
write this down?* — points at the **County School Superintendent**, who is the
filing officer for school-district offices under Arizona law, and at each
**district itself**, which must recruit candidates and notice its own election.

### 6.1 The certified candidate filings — `www.schools.pima.gov`

**Source:** `https://www.schools.pima.gov/elections/2026-candidate-filing`
**Custodian:** Pima County School Superintendent's Office, 200 N. Stone Ave.
**Route:** rung 2, plain Node fetch. Retrieved 2026-08-30T05:36Z, HTTP 200, <!-- expected-future: 2026-08-30 is the UTC wall clock the fetch probe recorded; the Phoenix stamp date is 2026-08-29 -->
32,108 bytes. Elections Director named on the page: **Matt Stamp, 520-260-3305**.

Verbatim: "The candidate filing period for the November 3, 2026 election begins
Saturday, June 6, 2026 and closes Monday, July 6, 2026 at 5:00 p.m."

The page carries, **per district**: the number of seats, the minimum signatures
required, and every candidate with **filing date and signature count**. The rows
for the districts that cover 85641:

**Vail Unified — 2 seats — minimum signatures 268**

| Candidate | Date filed | Signatures |
| --- | --- | --- |
| Andrea Black | 7/1/26 | 474 |
| Edward Buster | 7/2/26 | 374 |

**Sahuarita Unified — 2 seats — minimum signatures 109** (covers 1/44 points)

| Candidate | Date filed | Signatures |
| --- | --- | --- |
| John Sparks | 6/10/26 | 169 |
| Raul Rodriguez | 6/22/26 | 149 |

**Pima JTED — District 2 — 2 seats — minimum signatures 400**

| Candidate | Date filed | Signatures |
| --- | --- | --- |
| Beth Lehr | 6/26/26 | 459 |
| Cindy Rankin | 7/1/26 | 1,159 |

Two things to be careful about, both of which are render-correctness issues:

1. **This ZIP is in JTED governing-board district 4, not district 2.** The only
   JTED contest on this page is District 2, so on the evidence of this page the
   JTED seat covering 85641 is not up in 2026. That is a statement about what
   this page lists. It is not an absence claim, and it must not render as one.
2. **Empire Elementary School District No. 37 does not appear on this page**
   among the districts listed. Whether that is because no Empire seat was up, or
   because a county-administered district is handled by a different process, is
   **NOT ESTABLISHED** by this retrieval. Do not render either reading.

`Edward Buster` on this list is `Ed Buster`, the sitting Vail board member
already in `lib/registry/body-rosters.ts` — a member seeking re-election.
`Andrea Black` now has a **primary source as a filed candidate**, which is a
different and weaker claim than being seated, and the repo's existing decision
not to seat her remains correct.

The page links a **write-in candidate filing** page. The slug was guessed as
`/elections/2026-write-in-candidates` and returned **404** — the real slug was
not established. Nav text on the site reads "2026 Write-In Candidates". See §9.

### 6.2 Two ballot measures on this reader's ballot

Both were found as links on the Superintendent's own pages, hosted on its
document bucket `pima-county-schools.s3.amazonaws.com`, both retrieved HTTP 200
as real PDFs and both **text-extracted**.

**Vail Unified School District No. 20 — budget override**
`https://pima-county-schools.s3.amazonaws.com/downloads/49/request_for_arguments_vail.pdf`
(82,733 bytes, 2 pages, text layer present)

> a special election … ordered and called to be held on November 3, 2026 …
> arguments for and against the authorization of an override to continue to
> exceed the otherwise allowable revenue control limit for the District by
> **12.5%** for fiscal year 2027/2028 and thereafter for the next six subsequent
> fiscal years to be funded from ad valorem property taxes.

Authorising resolution adopted by the Vail Governing Board on **June 2, 2026**.
Signed by John Carruth, Superintendent. The district office address in the
document is **13801 East Benson Highway #B, Vail, Arizona 85641**. The estimated
tax rate is **blank on this exhibit** — the form was published with the figure
unfilled, so the rate is not held and must not be inferred. Argument deadline
was 5:00 p.m. on August 7, 2026.

**Pima County JTED No. 11 — bond issuance**
`https://pima-county-schools.s3.amazonaws.com/downloads/49/pima_jted_request_for_arguments.pdf`
(45,223 bytes, 2 pages, text layer present)

> the authorization of the issuance of bonds payable from a secondary, ad
> valorem property tax … The estimated average tax rate for the proposed bond
> authorization is **$0.14 per $100 of net assessed limited property value.**

Authorising resolution adopted **June 9, 2026**; signed by Ms. Kathy Prather,
Superintendent. JTED covers **36 of 44** probed points in this ZIP, so this
measure is on the reader's ballot. It corroborates independently: the JTED
BoardBook agenda for **June 9, 2026** carries a "Bond Resolution" item pointing
at `https://pimajted.org/bond/`.

Note the measure texts themselves are **not** in these documents — each says the
question is in the Resolution, available from the district office. Both are
requests for arguments, and the arguments and the pamphlet are still owed.

### 6.3 The district that noticed its own election

**Source:** `https://rinconvalleyfdaz.gov/c/6/district-board`, same retrieval as §5.1.

> "**Three positions** on the Rincon Valley Fire District Governing Board will be
> on the ballot during the General Election on **November 3, 2026**."

With: election type **Non-Partisan**; nomination petitions filed with the
**Pima County Elections Department, 6550 S. Country Club Road, Tucson, AZ 85756,
(520) 724-6830**, deadline **July 6, 2026 at 5:00 p.m.**; voter registration
deadline **October 5, 2026**.

**This establishes the filing authority for fire-district board seats, and it is
a different office from the school-district one.** School districts file with the
County School Superintendent (§6.1); fire districts file with the County
Elections Department. A single "who do I file with in Pima County" answer would
be wrong for one of them.

Corroborating seat counts from term dates, without a contest list:
**Sonoita-Elgin has two** seats expiring 2026-11-30 (LeFebvre, McArthur, §5.3) <!-- expected-future: 2026-11-30 is a published term-expiry date, not a stamp -->
and **Mescal-J6 has three** (Law, Wise, Temple, §5.5). Those are derived from
published term-expiry dates on the districts' own roster pages and are a strong
lead, **not** a filed-contest record — the filed candidates for fire-district
seats were not retrieved this session.

---

## 7. Pima Community College — the 44/44 body with no route

The obligation ledger recorded, for the PCC Governing Board:
`"knownRouteFloor": "None recorded. Not worked by this session."` It governs
**44 of 44** probed points — every sampled address in this ZIP.

**Source:** `https://www.pima.edu/about-pima/leadership-policies/governing-board/index.html`
Retrieved 2026-08-30T05:32Z, HTTP 200, 30,355 bytes. Rung 2, plain fetch. <!-- expected-future: 2026-08-30 is the UTC wall clock the fetch probe recorded; the Phoenix stamp date is 2026-08-29 -->

Verbatim: "Pima County Community College District is governed by a five-member
board representing County electoral districts. Members are elected to serve a
**six-year term**."

| Member | Electoral district |
| --- | --- |
| Dr. Nicole Barraza | District 1 |
| Theresa Riel | District 2 |
| Kristen Ann Randall | District 3 |
| **Greg Taylor** | **District 4** |
| Karla Bernal Morales | District 5 |

The corpus already establishes 85641 as **PCC taxation district 4** (44/44
points, `pima-community-college-taxation`). **Greg Taylor is therefore this
reader's community-college representative** — the join is between two facts this
repo now holds, and it is the kind of answer the product exists to give.

The page's own nav names further unwalked surfaces: `Board Committees`,
`Board Members`, `Board Meetings`, `Board Priorities`, `Contact the Board`,
`Election of Board Members`, `Board Bylaws`, `PCC Service Area`. A guessed
`board-meetings.html` sibling returned **404**; the real path was not
established. See §9.

---

## 8. Pima County JTED No. 11 — a 267-meeting archive behind a new vendor

The roster was **not** on the page named for it. `/about/governing-board/governing-board-members/`
(81,537 bytes, HTTP 200) contains **no member names at all** — only a routing
instruction naming an executive assistant, framed as open-meeting-law hygiene.
The parent page `/about/governing-board/` (538,199 bytes) carries all five.

**Source:** `https://pimajted.org/about/governing-board/`, retrieved
2026-08-30T05:33Z, HTTP 200. <!-- expected-future: 2026-08-30 is the UTC wall clock the fetch probe recorded; the Phoenix stamp date is 2026-08-29 -->

| Member | Seat |
| --- | --- |
| Alex Jácome | Chairman of the Board |
| Robert Schlanger | Clerk |
| Brenda Marietti | Board Member |
| Wayne Peate | Board Member |
| Cindy Rankin | Board Member |

`Cindy Rankin` is also a **filed 2026 candidate** for JTED District 2 (§6.1,
1,159 signatures) — a sitting member seeking re-election, and an independent
cross-source corroboration of the roster.

The same page publishes the **A.R.S. §38-431.02 notice of regular meetings**
verbatim, with dates and the reasons for the irregular ones:

- August 11, 2026
- September 15, 2026 — "3rd Tuesday due to Labor Day Holiday, September 7, 2026"
- October 6, 2026 — "First Tuesday due to School Fall Break"
- November 10, 2026
- December 8, 2026

Start time 6 p.m. unless stated; posted "in the front window of the JTED @ Master
Pieces campus at 2855 W. Master Pieces Drive" at least 24 hours prior.

### 8.1 BoardBook Premier — a vendor and tenant new to this repo

`https://meetings.boardbook.org/Public/Organization/1386` — tenant slug
`pimajoint`, organisation id `1386`. Operated by **Sparq Data Solutions Inc.**
`robots.txt` **404 → NO_ROBOTS**; nothing forbids the path.

One GET of the organisation page returned **589,630 bytes** containing
**267 distinct meeting ids** and **260 dated rows**, spanning
**February 17, 2009 → August 11, 2026** — regular meetings, special meetings and
study sessions, each with meeting type, full street address, and any special
notice text. There is **no pagination to defeat**: the whole archive is on one
page.

Three URL templates, all verified:

| Template | Result |
| --- | --- |
| `/Public/Agenda/{slug}?meeting={id}` | **HTTP 200 — the full agenda renders as HTML.** 131,034 bytes for meeting 756744; item numbering, presenters, descriptions, and attachment names with upload timestamps all extract from the served bytes. |
| `/Public/DownloadAgenda/{slug}?meeting={id}` | **HTTP 200, `application/pdf`, 12,408,926 bytes, `%PDF-1.7`** — the complete agenda **packet** with attachments inlined. |
| `/Public/Minutes/{slug}?meeting={id}` | HTTP 200 but a **shell**: redirects to `/Documents/CustomMinutesForMeeting/...`, and the served HTML strips to 757 characters of chrome. The minutes body is loaded client-side. **Not an absence — a rung not yet climbed.** See §9. |

A sample of the extracted agenda (meeting 756744, August 11, 2026) shows exactly
the reader-facing substance the corpus has been missing for this body: `ROLL
CALL`, a `CALL TO THE PUBLIC` with its three-minute rule stated, `Superintendent's
Report`, `Finance and Project Updates` presented by "Kenneth McGovern, Chief
Financial Officer", `CONSENT AGENDA ITEMS`, `10.A. APPROVAL OF MINUTES` with
three named attachments, and `10.B. RATIFICATION OF SALARY`.

Note `Kenneth McGovern` is the same official the corpus already holds as the
filer of a JTED budget-hearing notice (`kmcgovern@pimajted.org`) in
`data/states/az/hunt/85641-school-meeting-notices.json` — the two sources agree.

`/Documents/FileViewerOrPublic/{slug}?file={fileId}` was probed for a single
attachment and returned **HTTP 302 with a zero-byte body** under a
non-redirect-following client. Redirects were not followed for this endpoint;
`DownloadAgenda` supersedes it for packet retrieval anyway.

---

## 9. What is still owed, and the exact next public route for each

Nothing in this section is an absence claim. Each row names a route that exists
and has not been walked.

| Owed | Exact next route |
| --- | --- |
| JTED **minutes** bodies (267 meetings) | The `/Public/Minutes/` shell is client-rendered. Next: follow the `302` from `/Documents/FileViewerOrPublic/pimajoint?file={id}` with redirects enabled, and read the `file` ids off the agenda HTML (they are present as `/Documents/FileViewerOrPublic/pimajoint?file=7262454` etc.). Failing that, `DownloadAgenda` packets contain the approved prior minutes as attachments. |
| JTED agendas + packets, all 267 | `/Public/Agenda/pimajoint?meeting={id}` for every id on the org page. Ids already extracted this session; no pagination needed. |
| Mescal-J6 agendas and minutes | `/previous-agendas/` and `/previous-minutes/` are permitted and 200. The listing is a WordPress download-manager (`wpdmpro`) widget. Next: the sitemap `https://mescalj6fd.gov/wp-sitemap-posts-wpdmpro-1.xml`, which enumerates the download objects directly, and the WP REST API at `/wp-json/wp/v2/` (the site advertises `wp-json` oEmbed, so REST is likely live). |
| PCC **meetings, agendas, minutes** | `www.pima.edu` nav names `Board Meetings`, `Board Committees`, `Contact the Board`, `Election of Board Members`. The guessed `board-meetings.html` 404s. Next: `https://www.pima.edu/sitemap.xml`, then the real path. Permission is already established as ALLOWED. |
| PCC's own **vendor tenant**, if any | Not established. PCC is a Legistar/Granicus-scale institution; check for a `pima.novusagenda.com`-style or BoardDocs tenant off the Board Meetings page once §9 row 4 resolves. |
| Fire-district **filed candidates** for the Nov 3 seats (RVFD 3 seats; SEFD 2 by term expiry; Mescal-J6 3 by term expiry) | The filing officer is the **Pima County Elections Department**, not the School Superintendent (§6.3). Route: `www.pima.gov` elections pages, permitted (`robots.txt` disallows only Baiduspider and Yandex). |
| Corona de Tucson and Sonoita-Elgin **election notices** | Neither sitemap contained an election/candidate/nomination slug on this pass. Their `/district-transparency` pages were not fetched (Corona 404s on `/transparency` and `/district-transparency` was listed but not retrieved). Next: fetch `https://www.coronafire.org/district-transparency` and the SEFD `/archives` surface. |
| The **write-in** candidate list | The Superintendent's page links it as "CLICK HERE to see WRITE-IN candidate filing"; the slug guess `/elections/2026-write-in-candidates` 404s. Next: read the `href` off `supt-filing.html` rather than guessing, or enumerate `https://www.schools.pima.gov/sitemap`. |
| **Empire Elementary No. 37** roster and meetings | Three named leads, none walked: (a) `https://www.schools.pima.gov/schools/` — the Superintendent's own district directory; (b) `pima-county-schools.s3.amazonaws.com/downloads/` — the same bucket that held the argument requests; (c) the ADE budget-notice route already in `data/states/az/hunt/85641-school-meeting-notices.json`, whose FY2027 Empire notice was filed by Peter Laing at the Superintendent's office. No `empireschool.org` / `empire.k12.az.us` hostname resolves (NXDOMAIN, three variants) — **a wrong guess at a hostname, not a district that publishes nothing.** |
| The **ballot-measure question texts** for the Vail override and the JTED bond | Both request-for-arguments documents state the question is in the authorising Resolution, held at the district office. Vail's resolution is dated 2026-06-02 and JTED's 2026-06-09 — **the JTED one is an agenda item on BoardBook meeting for June 9, 2026, so the packet PDF for that meeting very likely contains it.** That is the cheapest route and it is permitted. |
| The Vail override's **estimated tax rate** | Blank on the published exhibit. It will appear in the county informational pamphlet, still unpublished as of the corpus read. |
| The **arguments** for and against both measures | Filed with the County School Superintendent by 2026-08-07, to be published in the informational pamphlet. Route: `www.schools.pima.gov/elections/`. A dated recheck, not a records request. |
| **PSPRS Local Board** rosters for all districts | RVFD and SEFD publish PSPRS agendas/minutes (§5.6) which will name the trustees. Corona's pension-funding-policy page was not fetched. |
| Denominator for the special-district universe | `data/states/az/hunt/pima-2026-27-levy.json` enumerates **20 named fire districts** county-wide, plus 21 street-lighting improvement districts, 3 domestic water improvement districts, 1 health district, and 8 named CFDs. **All four fire districts covering this ZIP appear in it** — Corona de Tucson, Mescal-J6, Rincon Valley, Sonoita-Elgin — so the levy resolution independently corroborates the GIS territory probe. The levy is the denominator instrument the ledger asked for; reconciling it against the layer probe is a corpus task, not a network one. |

### Hosts where only a human, offline, or records-request route remains

**None was found this session.** Every host walked here was either ALLOWED or
NO_ROBOTS. The one host that refused every client — `www.pimajted.org` — turned
out to have a fully permitted sibling origin at the apex, so it produced no
records-request obligation. The previously recorded walls
(`legistar.granicus.com`, `pima.granicus.com`, both Highbond tenants,
`go.boarddocs.com/az/vail`, `asr.pima.gov`, `apps.azleg.gov`) are unchanged and
were not re-walked, per RULING 148.

### Vendor accounts or APIs that would materially help

1. **BoardBook Premier (Sparq Data Solutions Inc.)** — the public surface already
   yields the full archive, agendas as HTML, and packets as PDF without an
   account, so **no account is needed for retrieval**. What an account or a
   documented API would add is *incremental* notification: there is no visible
   "changed since" parameter, so keeping 267 meetings fresh means re-reading the
   organisation page. Worth asking Sparq whether a public read API or a feed
   exists for `Public/Organization/{id}`.
2. **Streamline** — same finding, more strongly. The `sitemap.xml` route is
   complete and free. No account is needed or would help.
3. **Neither is a Legistar/Granicus situation.** Both of these vendors publish
   their tenants' records without a document host that disallows crawling, which
   is the opposite of the pattern recorded for Pima County and Vail USD.

---

## 10. MethodCandidate proposals

I own no file under `data/method/`. These are stated for the method owner to
learn through a `method:learn-*` script. **I did not run `method:ingest`.** Each
carries its applicability dimensions rather than a state code.

**MC-1 — `stale-host-redirects-to-a-dot-gov-sibling`** — PORTABLE
*Publisher: any local government. Platform: any. Government class: special
districts especially. Record class: all.*
A recorded hostname that fails TLS (`ERR_TLS_CERT_ALTNAME_INVALID`) or answers
oddly may be a **superseded domain whose certificate was never renewed**, not an
unreachable publisher. Before recording `CANNOT_TELL`, request the same host over
**plain HTTP** and **follow redirects**, and record the final URL. Proven twice
here: `www.mescalj6fd.com` → `mescalj6fd.gov`, and `www.rinconvalleyfd.org` →
`rinconvalleyfdaz.gov`. **Corollary:** a `.gov` sibling of a `.com`/`.org` local
government host is worth probing directly — the US `.gov` program has been
migrating special districts steadily.

**MC-2 — `an-authoritative-layer-attribute-can-be-a-stale-url`** — PORTABLE
*Publisher: any GIS custodian. Platform: ArcGIS/any. Government class: any.
Record class: routes.*
A `WEBSITE` attribute published by a county GIS layer is a **lead, not an
address**. Pima County's fire-taxation layer names `rinconvalleyfd.org`, which
now redirects elsewhere. Resolve and record the final URL at ingest time;
re-resolve on recheck. Do not treat a government-published URL as canonical
merely because the publisher is authoritative.

**MC-3 — `apex-and-www-are-different-origins`** — PORTABLE
*Publisher: any. Platform: any behind a CDN/WAF. Government class: any. Record
class: all.*
`www.<domain>` and the bare apex can sit behind different infrastructure with
different bot protection. `www.pimajted.org` returns a Cloudflare 403 to four
clients; `pimajted.org` returns 200 and serves the whole site. Before recording
`BLOCKED_CURRENTLY`, vary the **hostname** as well as the client. This composes
with the existing `node-fetch-passes-where-browser-is-refused` route: here, curl
under a declared bot UA got a 301 where curl under its default UA got a 403 on
the same URL, so **UA and hostname are independent axes**.

**MC-4 — `the-governance-page-outranks-a-roster-shaped-news-post`** — PORTABLE
*Publisher: any. Platform: Streamline proven; any CMS with a news stream.
Government class: any. Record class: rosters/officials.*
A CMS search or sitemap will surface undated **news posts** whose prose names a
roster. Sonoita-Elgin's post names two people who are no longer directors, while
`/board-of-directors` names their replacements. **Prefer the structured
governance page; when only prose is available, record it as unverified and
dated-unknown.** A roster ingested from the news post would have published two
former officials with a genuine district URL as the citation — a false claim
about a government that would pass every link check.

**MC-5 — `the-page-named-for-the-roster-may-not-hold-it`** — PORTABLE
*Publisher: any. Platform: WordPress proven. Government class: school districts
especially. Record class: rosters.*
`pimajted.org/about/governing-board/governing-board-members/` contains **zero**
member names — only an instruction to route contact through staff, framed as
open-meeting-law compliance. The parent `/about/governing-board/` carries all
five. A crawler keyed on slug or page title records a false empty. **Walk the
parent and the siblings before concluding a roster page is empty**, and treat a
roster-titled page with no person-shaped content as a FAILED extraction
(RULING 100), never as a body with no members.

**MC-6 — `streamline-sitemap-is-a-dated-meeting-inventory`** — PORTABLE
*Publisher: Streamline tenants. Platform: Streamline. Government class: special
districts (fire, water, sanitary, cemetery, irrigation) nationwide. Record class:
meetings.*
Streamline publishes one URL per meeting instance at
`/<YYYY>-<MM>-<DD>-<body>-<title-slug>` and lists every one in `sitemap.xml`.
A single unauthenticated GET yields a complete dated inventory with the body
(governing board vs PSPRS local board) and the meeting kind (regular, special,
notice of possible quorum) already separated, frequently with the wall-clock
start time. Measured: 115 sittings at `coronafire.org` (2017-07-26 → 2026-08-26)
and 70 at `sefd911.org` (2021-07-26 → 2026-09-28, including a future one). <!-- expected-future: 2026-09-28 is the latest sitting SEFD publishes, not a stamp -->
**Enumerate the sitemap; do not guess slugs** — Corona serves `/board-members`
and 404s `/board-of-directors`, Sonoita-Elgin does the reverse.
**Highest-leverage item here**: Streamline's market is exactly the government
class with no municipality behind it, which is this product's thinnest layer in
every state.

**MC-7 — `boardbook-public-organization-is-the-whole-archive`** — PORTABLE
*Publisher: BoardBook Premier tenants (Sparq Data Solutions Inc.). Platform:
BoardBook. Government class: school districts, JTEDs, community colleges,
special districts. Record class: meetings, agendas, packets.*
`meetings.boardbook.org/Public/Organization/{orgId}` returns the tenant's
**entire** meeting history on one page — 267 meetings and 17 years for
org 1386 — with no pagination. From it: `/Public/Agenda/{slug}?meeting={id}`
renders the full agenda as **extractable HTML**, and
`/Public/DownloadAgenda/{slug}?meeting={id}` returns the complete **packet** as a
PDF (12.4 MB verified). `robots.txt` is 404 → NO_ROBOTS. **Caveat to learn with
it:** `/Public/Minutes/` is a client-rendered shell and a text extraction of it
returns ~757 characters of chrome — a parser pointed at it would report every
meeting as having empty minutes, which is a FAILED extraction, not an absence.

**MC-8 — `ask-the-filing-officer-not-the-elections-department`** — PORTABLE
*Publisher: county filing officers. Platform: any. Government class: school
districts, special districts. Record class: ballot contests, candidates.*
When a county elections department has not yet published a general-election
contest set, **the office that receives the nomination petitions already has**.
In Arizona these are different offices for different bodies: **school-district**
candidates file with the **County School Superintendent**
(`schools.pima.gov/elections/2026-candidate-filing` — seats, minimum signatures,
candidate names, filing dates and signature counts, for every district in the
county); **fire-district** candidates file with the **County Elections
Department**. Generalises as: enumerate the statutory filing officers per body
class, not per county.

**MC-9 — `the-district-notices-its-own-election`** — PORTABLE
*Publisher: any elected body. Platform: any. Government class: special districts
especially. Record class: ballot contests.*
A body that must recruit candidates publishes its own seat count, filing
deadline, filing address and election date, often months before the county
consolidates a contest list. Rincon Valley Fire District's board page carries
"Three positions … on the ballot during the General Election on November 3,
2026" with the filing address and deadline. **Weaker corollary, still useful:**
where a roster page publishes **term-expiry dates**, the seats up at the next
election are derivable — Sonoita-Elgin two, Mescal-J6 three. Record that as a
lead, never as a filed contest.

**MC-10 — `psprs-local-board-is-a-separate-public-body`** — PORTABLE within the
class
*Publisher: any AZ public-safety employer. Platform: any. Government class: fire
districts, municipalities with sworn police/fire. Record class: bodies, meetings,
minutes.*
Under A.R.S. Title 38, an employer with sworn public-safety personnel seats a
**local retirement board** that meets and notices separately from the governing
board. Three of four fire districts here publish its agendas and minutes as a
distinct series. It is a **non-governing body** with its own record trail, and
the corpus has no concept of it. The wider rule: **a governing board is rarely
the only public body a small government seats** — pension, merit, and appeals
boards notice separately and are routinely missed by a detector keyed on
"governing board".

**MC-11 — `a-levy-resolution-is-the-special-district-denominator`** — PORTABLE
*Publisher: county boards of supervisors / county treasurers. Platform: any.
Government class: all levying districts. Record class: government universe.*
Already implicit in `data/states/az/hunt/pima-2026-27-levy.json`'s own note, and this
session confirms it end to end: all four fire districts covering 85641 appear in
the county's annual levy resolution under A.R.S. 42-17101–42-17110, alongside 16
more county-wide, plus street-lighting, domestic-water and health districts and
named CFDs. **A government that publishes nothing still appears there, because
somebody has to collect its money.** Use it as the denominator against which GIS
territory layers are checked — not the reverse.

**MC-12 — `content-signal-plus-named-ai-crawler-disallow-is-a-class`** — PORTABLE
*Publisher: any. Platform: WordPress/Cloudflare especially. Government class:
any. Record class: permission.*
`mescalj6fd.gov` allows `*` while disallowing nine named AI crawlers including
**ClaudeBot** and carrying `Content-Signal: search=yes,ai-train=no,use=reference`.
`azdor.gov` does the same and is already Needs Sean row NH225. **Two instances
make this a class**, and it will recur — the directive block is boilerplate now
shipped by CDN vendors. The author's judgement should be written to cover the
pattern (a declared-identity client's group membership, and what `ai-train=no`
obliges) rather than being re-decided per host.

---

## 11. Honest statement

**No class in this document is converged.** Every one has at least one named
lawful route that has not been walked, and §9 names them.

Where this session did not work something, it says so rather than inferring its
state. Two absences that a reader might expect are explicitly **not established**
and must not render as facts: whether Empire Elementary School District No. 37
had a 2026 board contest, and whether the JTED seat covering this ZIP was up in
2026. The evidence available says only what a specific page listed.

Every wall met this session was named with its host, its status, the clients
tried, and whether it was a permission verdict or a transport failure. Two hosts
previously believed walled turned out not to be. Nothing here asserts that a
government does not publish something.
