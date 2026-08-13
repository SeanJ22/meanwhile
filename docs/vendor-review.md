# Vendor and statute review

Tracker **D14**. One written finding per vendor before an adapter ships, plus the
state-law question underneath all of them.

**This is not legal advice and it is not a clearance.** It records what the
published documents say, on the date they were read, and what follows
operationally. Enforceability is counsel's — tracker **B05**, with the framed
question in **B09**. Everything here that touches the statutory argument is
flagged for that review rather than settled by it.

Read 2026-08-12. Re-read any vendor row before its adapter ships if more than a
few months have passed; these documents are revised without notice and the
revision date is the only signal.

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

**Finding: do not build an OnBase adapter on this reading.** The prohibition is
explicit and broad, and although the enumerated scope does not include the
tenant host, that gap is thin evidence to act on — it is at least as likely to be
an unrevised site list as a deliberate carve-out. The Diligent document proves a
vendor will state the product carve-out plainly when it means one; Hyland's does
not.

**Route instead, in this order:**

1. Ask the City of Tucson Clerk directly for a machine-readable meeting feed.
   The clerk is the publisher and the records are the City's, not Hyland's.
   Template: `docs/email-tusd-clerk.md`, adapted.
2. Tucson has a **GovDelivery subscription list**
   (`public.govdelivery.com/accounts/AZTUCSON/subscriber/topics`) — a syndication
   channel the City already operates for exactly this purpose. Ladder rung 3, and
   it carries none of the vendor question.
3. Pima County's Legistar carries **joint Tucson/Pima meetings**, so some Tucson
   content is reachable through a cleared source regardless. Confirmed: a "Joint
   Meeting with Mayor and Council and Pima County BOS" appears on both.

Record the outcome on tracker **D16**.

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

| Vendor | Automated access clause | Scoped to tenant portals? | Sanctioned API | Finding |
|---|---|---|---|---|
| Granicus / Legistar | **none** | no — marketing site only | **yes, documented** | **Cleared — build on the API** (D12) |
| Hyland / OnBase | explicit, broad | not enumerated, but thin evidence | no | **Do not build.** Ask the clerk; use GovDelivery (D16) |
| Diligent / BoardDocs | explicit | **no — express product carve-out** | no | **Escalate to B09.** Try subscribe + district site first (D13) |

**Ships first: Legistar, on the API.** It is the only row where the vendor built
the interface, the data returned is already public by the client's own act, and
the terms carry no automated-access restriction at all.
