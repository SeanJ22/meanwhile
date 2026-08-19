# Vendor and statute review

Tracker **D14**. One written paragraph per vendor recording what its terms say.

**This is a record, not a gate — redefined 2026-08-13.** A vendor paragraph is
reconnaissance informing route selection; it does not block an adapter. The
public-records constraint now in `CLAUDE.md` states why: every record these
systems hold is one a public body is statutorily obliged to publish, and a
vendor's website terms are not a mechanism by which a public body can narrow
statutory access to its own records. What binds retrieval is the four-part
discipline in that constraint (no credentials, no accepted-then-violated
clickwrap, polite serialized identified requests, nothing not already public),
not a vendor's marketing-site ToU. The original 2026-08-12 findings below are
kept as written, including the one this redefinition reversed — the correction
is the useful part.

**This is not legal advice.** It records what the published documents say, on
the date they were read, and what follows operationally. Enforceability is
counsel's — tracker **B05**, with the framed question in **B09**.

Read 2026-08-12, extended 2026-08-13. Re-read any vendor row before its adapter
ships if more than a few months have passed; these documents are revised
without notice and the revision date is the only signal.

---

## The finding that applies to every row

**Website terms of use and tenant portals are different instruments.** Every
vendor here publishes a Terms of Use for its own marketing and community sites.
In each case the document defines its own scope, and in each case that scope is
written in terms of the vendor's sites — not the customer-hosted instance where
a public body actually publishes its agendas.

That distinction is not a loophole. It is what the documents say, and two of the
three say it explicitly. It is also not a conclusion that automated retrieval is
therefore permitted: the tenant instance is governed by *the customer's*
agreement, which we have not seen and are not party to. The honest position is
that the website ToU is the wrong document to reason from, and the right one is
not public.

Which is why the statutory question in B09 is load-bearing rather than
decorative — see the last section.

---

## Granicus — Legistar

| | |
|---|---|
| Document | `granicus.com/trust-center/terms-of-use/` |
| Revised | 2026-07-20 |
| Governing law | California |
| Read | 2026-08-12 |

**Scope.** The document applies to "all individuals and/or entities ... accessing
this website for any reason." It is scoped throughout to `granicus.com` and does
not name specific products, so it does not by its own terms reach a tenant
Legistar instance at `<client>.legistar.com` or the API at
`webapi.legistar.com`.

**Automated access.** *Nothing.* No robot, spider, crawler, scraper, or data
mining clause of any kind. This was checked for specifically and it is absent —
which distinguishes Granicus from both other vendors here.

**Commercial use.** "Use of the information contained on this website is solely
intended for individual and private use." Scoped, again, to the marketing site.

**Deep linking.** No prohibition.

**Rights holder.** Granicus asserts copyright in its own site materials. It
asserts nothing over customer content, which is the relevant category — a Pima
County agenda is Pima County's document.

**The material point: there is a sanctioned public API, so none of the above is
the operative question.** `webapi.legistar.com/v1/{client}/...` is documented at
`webapi.legistar.com/Home/Examples`, speaks OData v3, and **GET returns only
items the client has already marked public on their InSite portal.** Using it is
not scraping. It is the interface the vendor built for this purpose, returning
records the public body already published.

**Verified live, 2026-08-12** (see the measurement section below): `pima` is an
open client returning full event, body and agenda-item data with no token.

**Finding: cleared to build, on the API only.** Do not scrape `*.legistar.com`
HTML when the API answers the same question. Where a client returns 403, that is
a token request, not a wall — NYC publishes theirs openly.

---

## Hyland — OnBase Agenda Online

**New. This vendor was not in the brief's list and was found by following
Tucson's clerk page.** See the discovery note below — Tucson is not a Legistar
client.

| | |
|---|---|
| Document | `hyland.com/en/legal/terms-of-use` |
| Read | 2026-08-12 |
| Tenant host | `tucsonaz.hylandcloud.com/221agendaonline` |

**Scope.** The terms enumerate the sites they govern: `www.hyland.com`,
`community.hyland.com`, `try.hyland.com`, `university.hyland.com`,
`support.hyland.com`. **`hylandcloud.com` is not among them**, and that is the
host every customer OnBase tenant sits on.

**Automated access.** Unlike Granicus, this is explicit and prohibitive:
prohibits accessing or searching "by any means other than our publicly supported
interfaces (for example, 'scraping')", and separately prohibits any "robot,
spider, site search/retrieval application, or other manual or automatic device
or process to retrieve, index, 'data mine', monitor, or in any way reproduce or
circumvent the navigational structure or presentation of the Sites."

**Commercial use.** Prohibits reproducing, distributing or otherwise exploiting
any portion of the Sites "for public or commercial purposes," and separately
prohibits use "for any competitive purposes, including to build a competitive
product or service."

**Rights holder.** Hyland claims all content "contained on, appearing on, or
relating to the Site."

**Original finding (2026-08-12): do not build an OnBase adapter on this
reading.** The prohibition is explicit and broad, and although the enumerated
scope does not include the tenant host, that gap is thin evidence to act on — it
is at least as likely to be an unrevised site list as a deliberate carve-out.
The Diligent document proves a vendor will state the product carve-out plainly
when it means one; Hyland's does not.

**REVERSED 2026-08-13, and the adapter is built (D16).** Under the
public-records constraint the scope gap is dispositive, not thin: the terms
name five `hyland.com` hosts and reach no further by their own words, the
tenant host is where the records live, and the records are the City of
Tucson's — which Arizona law requires posted on the body's website (A.R.S.
§ 38-431.02). A vendor's marketing-site ToU is the wrong instrument to reason
from for a public body's statutory publications, and treating its silence
about the tenant host as a prohibition was the gate-shaped reading D14 no
longer takes. What survives of the original caution is the retrieval
discipline, applied in full: the adapter reads the server-rendered landing
page with one identified GET per ingest, serialized, honouring `Retry-After`,
never re-fetching an unchanged document. The original conclusion above is kept
because the correction is the useful part.

The alternative routes remain recorded and useful as fallbacks: the City
Clerk, the **GovDelivery subscription list**
(`public.govdelivery.com/accounts/AZTUCSON/subscriber/topics`), and the joint
Tucson/Pima meetings that appear on `pima.legistar.com`.

---

## Diligent — Community / BoardDocs

| | |
|---|---|
| Document | `diligent.com/legal/terms-of-use` |
| Revised | 2022-01-06 |
| Read | 2026-08-12 |

**Scope.** "Diligent owns and operates diligent.com and its associated websites,
including the websites where we make resources for our products available to
users, such as our online training, community, tools and templates, and content
gallery (collectively, the 'Diligent Websites')." Resource and community sites —
not tenant portals.

**The carve-out, verbatim.** "If there is any conflict between these Terms of Use
and Diligent's standard terms for its products and services, Diligent's standard
terms will apply and take precedence."

**This confirms the brief's §4.5.4 correction, and it is the cleanest statement
of the general finding above.** A BoardDocs/Diligent Community tenant portal is a
*product*, delivered to a school district under that district's contract. The
website ToU says in terms that the product terms govern instead. So the document
most people would reach for is, by its own instruction, not the governing one.

**Automated access.** Prohibits "any robot, spider, scraper, deep link or other
automated data gathering or extraction tools ... to access, acquire, copy or
monitor any portion of the Diligent Websites" — scoped to the Diligent Websites
as defined above.

**Commercial use.** Prohibits commercially exploiting "the Diligent Websites or
any materials ... posted or contained in them" — same scope.

**Finding: not cleared, and not blocked. Escalate to B09 and route around it
first.** The carve-out means the prohibition above does not, on its face, reach a
district's tenant portal — but what does reach it is an agreement we have not
seen. Before building the portal route:

- Try the **subscribe channel** Diligent Community portals expose for
  upcoming-meeting notifications. It is an intended syndication channel, it is
  rung 3, and it moots the question if it works.
- Try the district's **own site** for a statutory posting, an iCal, or an RSS
  feed. A posting on `tusd1.org` carries no vendor question at all.
- The drafted letters — `docs/email-diligent-legal.md` and
  `docs/email-tusd-clerk.md` — are the right next action, and either reply moots
  it. **Neither has been sent; sending is the author's call.**

The civic-tech precedent recorded in the brief (a LlamaIndex first-party reader,
`civic-scraper`, and `dweekly/rcsd-meetings` running in public) is real and worth
weighing, but precedent is not permission and should not be cited as though it
were.

**Addendum 2026-08-13 — the route that mooted most of the above.** Both
Diligent Community and its iCompass/CivicWeb sibling expose the same WCF JSON
service the portal page itself calls:
`<tenant>/Services/MeetingsService.svc/meetings?from=&to=`. It answers a plain
unauthenticated GET with the meeting list the portal renders — the same public
data, in the form the page already receives it (ladder rung 7). Verified live
on the TUSD tenant (`diligentoneplatform.com`, also answering on the legacy
`highbond.com` hostname) and on Newbury's (`newburynh.civicweb.net`). The
subscribe channel was tried first, per the original routing note: it is
email-only behind a CAPTCHA, recorded as a MISS. The adapter is built on the
service (D13); the tenant-agreement question stays flagged for B09 as a
record, and the drafted letters remain unsent.

---

## CivicPlus — CivicEngage (added 2026-08-13)

| | |
|---|---|
| Tenant observed | `rockawaytownship.org` (Rockaway Township, NJ) |
| Feeds | `RSSFeed.aspx?ModID=65&CID=All-agendacenter`, `common/modules/iCalendar/iCalendar.aspx?catID=<n>&feed=calendar` |
| Read | 2026-08-13 |

**The different case, and the easy one.** CivicPlus builds the municipality's
*own website*, and the feeds are published by the municipality through it —
first-party syndication, ladder rung 2, with no vendor portal in the path.
There is no tenant-portal instrument to reason about: the township publishes
an iCal and an RSS feed the way it publishes any page on its own site, and
both formats exist to be consumed programmatically. Both URL patterns are
CivicPlus-wide rather than Rockaway-specific, so one adapter reaches many
municipalities. **Adapter built (D21).** No terms question was found that
reaches a municipality's own published feeds; if CivicPlus's own site terms
are ever relevant they govern `civicplus.com`, not the township's website.

---

## Apptegy — Thrillshare (added 2026-08-13)

| | |
|---|---|
| Tenants observed | `vailschooldistrictaz.thrillshare.com` (org 8164), `api.thrillshare.com/api/v4/o/4707` (Rockaway Twp SD) |
| Endpoint | `/api/v4/o/<org>/cms/events` — unauthenticated JSON |
| Read | 2026-08-13 |

**First-party in the strongest sense.** Apptegy is the district's website CMS,
and the events API is what the district's own pages render from — found by
reading the embedded page state, not by probing. The district publishes the
board-meeting events itself, with venue text and coordinates in the payload.
Retrieval is the same act as loading the district's calendar page, in the form
the page already receives. No anti-automation instrument was found governing
tenant sites; the API serves the public site's own traffic. **Adapter built,
serving both districts** — the §0b thesis (one platform, N bodies) working on
its second body for free.

---

## NovusAgenda (added 2026-08-13 — a finding about data, not terms)

`vailschools.novusagenda.com/agendapublic/` answers 200 and holds **zero
meetings in any queried window** — it is Vail's archive for material prior to
March 14, 2017, which the district's own board page states. Recorded here so
nobody reads the 200 as a live source again: this was the fourth sighting of
the "exists and carries nothing" failure shape. No terms question was reached
because no adapter is warranted; if another body genuinely publishes through
NovusAgenda, review then.

**RESOLVED 2026-08-17 (g11, D22): no live tenant exists in scope, and the
namespace was swept rather than inferred from one body.** The Vail tenant was
re-read on 2026-08-17 — still 200, still **zero** meeting rows, so the archive
finding stands on a fresh read and not on a three-day-old note. Then 23
candidate tenant names covering every body in the four zips were probed at
`<tenant>.novusagenda.com/agendapublic/`: Tucson, TUSD, Pima County, Vail,
Newbury, Kearsarge, Merrimack County, Rockaway Township, Morris County and
Morris Hills among them.

**Twenty-two of the 23 answered HTTP 200 — with NovusAgenda's own
`Error.aspx` page.** The vendor wildcards its per-client subdomain namespace,
so a 200 from `novusagenda.com` is worth nothing at all; the real tenant is
78,576 bytes and the wildcard is 1,384. That is the fifth sighting of "exists
and carries nothing" and it is now a playbook rung (`docs/zip-playbook.md`,
"A vendor subdomain that does not exist can still answer 200").

So the adapter is NOT built, and the reason is data rather than difficulty:
there is no live NovusAgenda tenant for this product to read. Building one
against the archive would mean shipping an adapter whose only fixture is an
empty portal — an adapter that would report success while returning nothing,
which is the exact shape the four-sighting rule exists to stop. The vendor
stays typed in `AgendaSourceType`, so the day a real tenant appears the
wiring is a row and not a refactor.

---

## Granicus — IQM2 / Accela Meeting Portal (added 2026-08-13)

| | |
|---|---|
| Tenant observed | `morriscountynj.iqm2.com` (Morris County, NJ) |
| Endpoints | `/Services/RSS.aspx?Feed=Calendar` (pseudo-feed), `/Citizens/Calendar.aspx`, `/Citizens/Detail_Meeting.aspx?ID=`, `FileOpen.aspx` agenda PDFs |
| Read | 2026-08-13 |

Granicus again, a different product. The same reasoning as the Legistar row
applies: Granicus's site terms are scoped to its own sites and carry no
automated-access clause, and the tenant portal serves what the county already
published. The `/Services/RSS.aspx?Feed=Calendar` route is a syndication
endpoint by name and by shape — one rigidly regular XML-declared block per
meeting with datetime and document links, answering plain GET. **No adapter
yet (KNOWN_UNCOVERED)**; when built, the `/Services/` pattern generalizes to
every `*.iqm2.com` client.

---

## Revize (added 2026-08-13)

| | |
|---|---|
| Tenant observed | `merrimackcounty.net` (Merrimack County, NH) |
| Pages | `board_of_commissioners_/public_notices,_agendas,_minutes,_.php`, `elected_officials/delegation/public_notices.php` |
| Read | 2026-08-13 |

Revize is the county's website CMS — the CivicPlus case again, not the vendor-
portal case. The notice pages are the county's statutory posting location in
practice (RSA 91-A:2 permits the body's website), served as plain HTML with
stable document URLs on `cms2.revize.com` (the `?t=` cache token is
unnecessary, verified). First-party publication; no terms instrument found
that reaches it. **No adapter yet (KNOWN_UNCOVERED).**

---

## Sparq Data Solutions — BoardBook Premier (added 2026-08-18)

| | |
|---|---|
| Tenant observed | `meetings.boardbook.org/Public/Organization/2065` (Amphitheater USD, AZ) |
| Pages | the public org page (server-rendered archive), `/Public/Agenda/<org>?meeting=<id>`, `/Public/PublicNotice/...` |
| Read | 2026-08-14 (wall clock; session 2026-08-18) |

BoardBook Premier is a school-board agenda system; the district's own
agenda-information page names it as the posting location for "meeting
notices, agendas and agenda packets." The public routes live under
`/Public/` and are exactly that: plain GET, no auth, no clickwrap, no
interstitial — the same pages any parent is sent to. The org page
server-renders the whole archive including per-row venue name and street
address, which is better address provenance than most first-party sites. No
terms instrument was presented on any `/Public/` route fetched; the page
footer carries a copyright line (Sparq Data Solutions Inc.) and nothing
purporting to restrict access to the public records it hosts — and the
records are the district's, which is the finding that applies to every row.
Requests are serialized with the identified User-Agent; the whole archive
arrives in one ~1 MB response, so the adapter's load is one request per
refresh. **Adapter live (`lib/sources/boardbook`), first tenant
Amphitheater USD.**

## Plural Open (ex-Open States) — a quota, not a restriction

**This row is a different kind of entry from the three above, and the difference
is the point.** Granicus, Hyland and Diligent are *vendors holding a public
body's records*, and the question there is whether their terms can narrow access
to those records. Plural is a **publisher of public-domain data** that chose to
give it away. There is no access question to answer.

| | |
|---|---|
| Bulk data | `data.openstates.org/people/current/<st>.csv`, nightly |
| Auth for bulk | **none** — no key, no login. Verified live for AZ, NJ, NH |
| Licence | **CC-0.** Attribution requested, not required |
| API | v3 GraphQL at `open.pluralpolicy.com`; v2 is sunset |
| API auth | `apikey` query parameter, free tier |
| **API quota** | **500 requests/day, 1 request/second** |
| Read | 2026-08-12 |

**Automated access: expressly the intended use.** Bulk downloads exist precisely
to be consumed programmatically, and the data is dedicated to the public domain.
There is nothing here resembling the anti-scraping clauses in the Hyland and
Diligent documents.

**Commercial use: unrestricted by the licence.** CC-0 is a dedication to the
public domain, so it imposes no commercial-use condition at all. That makes
Plural the *only* source in this document with no commercial-use question
hanging over it — worth noting given the business model, and in pointed contrast
to OpenFEC's contributor-information restriction (D06) and Arizona's
§ 39-121.03.

**The 500/day quota is an operational ceiling, not a legal constraint, and it
must not be recorded as one.** It limits how we may build, not whether we may.
**D03 stays cleared.**

It is, however, the reason the roster is built the way it is rather than a
stylistic preference. AZ, NJ and NH are **620 legislators**; any per-person or
per-district GraphQL fetch pattern would spend the better part of a day's quota
in one build, and would do it again on every rerun. The bulk route costs
**3 HTTP requests and 0 GraphQL requests** for the same three states — which the
build now prints, so the distance from the ceiling is visible rather than
discovered by hitting it.

If GraphQL is ever needed — term dates and photo URLs are the likely reasons,
since the CSV carries neither — the discipline is: serialize at 1 request per
second, cache aggressively and never re-fetch unchanged data, and print the
request count in the build output. That is the same shape as the Legistar
retrieval discipline, for a different reason: there it is manners, here it is
arithmetic.

---

## The statutory question — B09, and one finding that changes the product

The framing for counsel, unchanged from the brief and now with the specific
citations underneath it:

> A public record does not stop being a public record because a vendor holds it.
> Agendas are made and used by a public body in the course of official duty, and
> open meeting law obliges the body to post them in advance. A software vendor's
> website terms are not a mechanism by which a public body can narrow statutory
> access to its own records.

### Arizona

**A.R.S. § 38-431.02** requires the notice and agenda to be available at least 24
hours before a meeting and **posted on the public body's website** (with a
carve-out for Title 48 special districts). Approved minutes of city and town
council meetings must be posted within two working days of approval.

So in Arizona the agenda is not merely public, it is *required to be published on
a website*. That is the strongest form of the argument above.

**A.R.S. § 39-121.03 is the one to bring to counsel, and it cuts the other way.**
Where a person requests copies of public records **for a commercial purpose**,
they must file a statement of that purpose, the custodian may charge the
commercial market value, and the custodian may apply to the Governor to prohibit
the furnishing entirely. The statutory definition of commercial purpose includes
"any purpose in which the purchaser can reasonably anticipate the receipt of
monetary gain from the direct or indirect use of the public record."

Two readings, and the difference matters:

- **It probably does not reach passive retrieval.** § 39-121.03 attaches to a
  *request to a custodian for copies*. Reading an agenda the body already posted
  on its own website is not such a request. That is ladder rungs 1–7; rung 9, a
  formal records request, is where this bites.
- **But "indirect monetary gain" is broad**, and this product's data side sells
  aggregates. The aggregates are user reactions, not public records, and the
  agendas are input to a free consumer product rather than the thing sold — but
  that is exactly the distinction counsel should confirm rather than one to
  assume. **Flagged for B09.**

### New Jersey

**N.J.S.A. 10:4-8** ("adequate notice") requires 48 hours' advance written
notice giving time, date, location and, **to the extent known, the agenda**,
posted in the agency's offices, sent to two newspapers, filed with the clerk, and
sent to anyone who requested notice. Electronic notice via the Internet is
expressly contemplated.

Weaker than Arizona — the agenda is required only "to the extent known," and
website posting is permitted rather than mandated.

### New Hampshire

**RSA 91-A:2** requires notice of time, date and place, posted in two public
places or a newspaper at least 24 hours ahead; the municipality's website may be
one of those places.

**New Hampshire does not require an agenda at all**, and a body may take up
topics not on one it chose to publish.

**This is a product finding, not just a legal one.** For a New Hampshire body,
`NO_SOURCE_FOUND` on an agenda may be *statutorily correct* rather than a failed
search — there may be nothing to find. The coverage language in 4.6.6 currently
says we do not have a body's calendar yet, which reads as our gap. In NH that can
be the body's lawful choice, and the honest wording differs. Tracker **D17**;
this should not be implemented until the wording is decided, because getting it
wrong misattributes a legal choice to our own coverage.

---

## Measurements taken while writing this

Recorded because they were made, and because two contradict things written down
elsewhere.

**Legistar client probing**, descriptive User-Agent, one request each:

| Slug | Result | Means |
|---|---|---|
| `pima` | 200 | open client, no token |
| `phoenix`, `mesa`, `maricopa`, `seattle`, `oakland`, `alexandria`, `alameda` | 200 | open clients |
| `nyc` | 403 | token required — a form to fill in |
| `tucson`, `tucsonaz`, `cityoftucson` | 500 | not a client |
| `chicago` | 500 | **not a client today** |

So the response codes are legible: **200 open, 403 token, 500 not a client.**
That calibration is worth keeping — a bare 500 from an API that is demonstrably
live means the slug is wrong, not the endpoint.

**The brief says `webapi.legistar.com/v1/chicago/matters/81940` returns data. It
returns 500 today**, as does `chicago/bodies`. The API is unquestionably live —
eight other slugs answered in the same sweep — so this is Chicago no longer being
reachable under that slug rather than an outage. Nothing depends on it; noted so
the next person does not use it as their smoke test.

**No `robots.txt` exists** on `webapi.legistar.com`, `pima.legistar.com`, or
`tucsonaz.hylandcloud.com` — all three return 404. There are no crawl directives
to honour, which is neither permission nor prohibition, and is worth recording
precisely because its absence is easy to misread as either.

**A Legistar RSS feed returned HTTP 200 with an "Invalid feed" body**:
`pima.legistar.com/Feed.ashx?M=Calendar&...` answers 200 and the XML says "This
feed is no longer valid. Please subscribe to a new feed." A 200 is not an answer.
Any feed route must assert on content, never on status.

**Tucson's agenda system was found by following the clerk page, not by guessing
slugs**, which is the 4.6.7 CMS rule doing its job. `tucsonaz.gov` runs on
**Granicus OpenCities** — so a vendor-from-CMS inference would have concluded
"Granicus, therefore Legistar" and been wrong twice over. The agenda link
(`/clerks/mcdocs`) redirects to **Hyland OnBase Agenda Online**. The site CMS
said nothing about where agendas live, exactly as the rule warns.

---

## Summary

| Vendor | Automated access clause | Scoped to tenant portals? | Machine route | Status (2026-08-13) |
|---|---|---|---|---|
| Granicus / Legistar | **none** | no — marketing site only | documented public API | **Built, live** (D12) |
| Hyland / OnBase | explicit, broad | terms name five `hyland.com` hosts; tenant host not among them | server-rendered list + PDF downloads | **Built, live** — original "do not build" reversed under the public-records constraint (D16) |
| Diligent / BoardDocs / CivicWeb | explicit, scoped to Diligent Websites | **no — express product carve-out** | `MeetingsService.svc` JSON, both brands | **Built, live** for TUSD + Newbury (D13); B09 stays flagged as a record |
| CivicPlus / CivicEngage | n/a — municipality's own site | n/a | first-party RSS + iCal | **Built, live** (D21) |
| Apptegy / Thrillshare | n/a — district's own site | n/a | first-party events JSON | **Built, live** for Vail + RTSD |
| Granicus / IQM2 | none (same instrument as Legistar row) | no | `/Services/RSS.aspx?Feed=Calendar` | Found, unbuilt (Morris County) |
| Revize | n/a — county's own site | n/a | plain HTML + stable PDFs | Found, unbuilt (Merrimack County) |
| NovusAgenda | not reached | — | — | No live tenant in scope — Vail's is a pre-2017 archive |
| Plural Open | none — bulk data is the intended use | n/a, not a records holder | CC-0 bulk CSV | **Cleared** (D03); 500/day API cap is a ceiling, not a restriction |

---

## Two clearances the author granted, recorded — g21, 2026-08-19

### Vote Smart's Political Courage Test — **AUTHOR-APPROVED**

**What it is.** A questionnaire Vote Smart sends every candidate for federal
and state office; the answers published are **the candidate's own**, in their
own words, against a fixed question set.

**Why the never-an-endorsement-site rule is not touched.** `CLAUDE.md` says
"do not add advocacy organizations, PACs, or endorsement sites as sources. Go
to the underlying government filing." The PCT is not an endorsement, not a
scorecard, and carries no rating by Vote Smart of anybody: it is a candidate's
self-reported answers, which is the same source class as a candidate's own
site and their own filing, and D05's own spec already names it alongside
those two.

**Where it may be used.** D05 (the statement corpus) and B14 (the blurb
equalization hunt). It is a candidate's own words about their own positions,
so it carries the same source-class label a campaign site's words do — *in the
candidate's own answers to Vote Smart's questionnaire, read <date>* — and
never a label implying we asked them.

**What it must never become.** Vote Smart also publishes ratings BY OTHER
ORGANISATIONS. Those are advocacy scorecards, they are exactly what the rule
excludes, and the clearance does not reach them. A future adapter that pulls
the PCT must not pull the ratings alongside it, and the reason is written here
so it is not re-litigated.

**Status:** cleared, not built. No adapter, no key, no retrieval this session.

### Permit and zoning-application systems — **APPROVED IN PRINCIPLE**

**Why.** A03 asks "is there a data center coming?" and that question cannot be
answered from agendas alone. g20 shipped A03's honest silence — a zero-hit
agenda search now says it searched, and says it searched AGENDAS rather than
the permit record — and the permit record is the missing half.

**The class.** These are government-published primary records of applications
made to a government, held by a software vendor on the government's behalf.
That is the Legistar class exactly, and the same reasoning applies: a vendor
hosting a public record does not acquire rights over it.

**The gate that does not move.** Approval in principle is **not** blanket
approval of every platform. Each vendor system enters as its OWN tracker row
with its OWN clearance, reviewed the way Granicus, Hyland, Diligent, CivicPlus
and Apptegy each were above — the terms read, the automated-access clause
quoted, the scope checked against the tenant host, the machine route named.

**Rows created this session, none run:** `V09` Accela, `V10` Tyler EnerGov,
`V11` OpenGov Permitting, `V12` CityView. Nothing was fetched from any of
them.

| Vendor | Automated access clause | Scoped to tenant portals? | Machine route | Status (2026-08-19) |
|---|---|---|---|---|
| Vote Smart (Political Courage Test) | not read | n/a — not a records holder | not read | **Cleared in principle**, unbuilt — the candidate's own answers only, never the third-party ratings |
| Accela | not read | not read | not read | Row `V09` created, unreviewed, nothing fetched |
| Tyler EnerGov | not read | not read | not read | Row `V10` created, unreviewed, nothing fetched |
| OpenGov Permitting | not read | not read | not read | Row `V11` created, unreviewed, nothing fetched |
| CityView | not read | not read | not read | Row `V12` created, unreviewed, nothing fetched |

**"Not read" is the honest entry.** Every other row in the summary table above
carries a clause somebody actually read. These four carry a clearance in
principle and nothing else, and writing anything more confident would put four
unreviewed vendors in a table whose whole value is that its rows were checked.
