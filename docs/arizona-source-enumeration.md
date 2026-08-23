# Arizona — the source enumeration, written BEFORE the hunt

**Written 2026-08-22 (NJ Hunt 5 item 6), under RULING 86: per-state source
enumeration precedes the hunt.** This is a written research step producing a
written list. **No Arizona entity was hunted to produce it**, and none should be
until the list below is walked in tier order.

Target zips, in the standing order: **AZ `85641`** (Vail, Pima County) and **AZ
`85701`** (Tucson, Pima County).

> **What this document is for.** RULING 63 makes the TECHNIQUE cumulative — a
> branch built in New Jersey is project property. This makes the PLACES
> cumulative. A branch that reaches a town clerk record is portable knowledge;
> *which office in Arizona is the clerk* is not, and a session that discovers it
> mid-hunt discovers it once, expensively, under time pressure, and usually
> incompletely.

---

## What the FEC Combined Federal/State Directory names for Arizona, in full

Read from the committed content at
`data/reference/fec_combined_federal_state_disclosure_directory.csv`, which
carries 349 offices across 56 jurisdictions. **Arizona's entry names SIX
offices** — every one is reproduced here, because "in full" was the ask and a
summary would drop the interesting one.

| Office | Records held | URL | Contact |
|---|---|---|---|
| **Secretary of State** | Candidates on Ballot · Election Results · Federal Campaign Finance Reports · State Campaign Finance Reports · State Personal Financial Reports | `https://azsos.gov` | `sosadmin@azsos.gov` |
| **Corporation Commission** | Corporate Registration and Records · Limited Liability Company Registration · Name Reservations | `https://www.azcc.gov` | `mailmaster@azcc.gov` · 602/542-3026 |
| **Citizens Clean Elections Commission** | Full Public Funding to Statewide and Legislative candidates · **Candidate Statement Pamphlet** · Voter Education · Sponsorship of Candidate Debates | `https://www.azcleanelections.gov` | 602/364-3477 |
| **Navajo Nation Ethics and Rules Office** | Administrative Hearings · Ethics Clearance · Standards of Conduct · Navajo Ethics in Government Law · Investigations | `https://nnethicsrules.navajo-nsn.gov` | `ethicsandrules@navajo-nsn.gov` |
| **Legislative Reference** | — | `https://www.azleg.gov` | `mbraun@azleg.gov` · 602/926-4236 |
| **Attorney General** | Other Court Actions · Elections Integrity Unit · Government Accountability Unit (Campaign finance) · Legal Counsel to the Secretary of State | `https://www.azag.gov` | `aginfo@azag.gov` |

### Two of those six deserve to be called out now, not discovered later

**The Citizens Clean Elections Commission publishes a Candidate Statement
Pamphlet.** That is *in their own words*, from a state agency, for every
publicly-financed statewide and legislative candidate — the field this project
has moved least (6 of 272 in New Jersey, and 0 added last session). It is a
**Tier A** route and it has no New Jersey equivalent. It is the single most
valuable line in this table.

**The Navajo Nation Ethics and Rules Office is a sovereign tribal government.**
No municipality list, no county roster and no state register would have produced
it; the federal directory names it outright. RULING 57 says the twig is as
relevant as the trunk, and a sovereign nation is not a twig — it is a trunk this
product has never touched. Whether and how tribal government renders is a scope
question and **it is the author's**, not a session's. A Needs Sean row carries
it.

---

## The Tier A routes to enumerate into the manifest, in walk order

RULING 84: these are walked before any Tier B, and Tier B before any Tier C.

1. **`Government of Arizona`** (Wikipedia) — RULING 87 at the state tier. The
   structure article: executive, legislative and judicial branches, every
   executive department, each linked to its own official `.gov`. **This is the
   first thing an Arizona session reads.** It is also where the enumeration of
   agencies-that-hold-hearings comes from.
2. **`wikipedia-government-graph`** seeded from `Vail, Arizona`, `Tucson,
   Arizona` and `Government of Arizona`. Expect the category vocabulary to
   differ; a category pattern Arizona needs is a sub-branch, not a failure.
3. **`wikipedia-municipality`** for every municipality in Pima County. **Arizona
   is RULING 60's warning made concrete**: counties run vast unincorporated
   territory where the COUNTY IS the municipal government and there is no town
   clerk to ask. Vail is a CDP, not an incorporated place — it has no municipal
   government at all, and the parser will correctly find no `Local government`
   section. That is a FINDING about Arizona's shape, not a parser miss, and the
   two must not be reported as the same thing.
4. **Arizona Secretary of State** — `azsos.gov`. Candidates on the ballot,
   election results, state campaign-finance reports, personal financial
   disclosures. The `filing-state` and `filing-campaign-finance-state` routes.
5. **Arizona Citizens Clean Elections Commission** — `azcleanelections.gov`. The
   Candidate Statement Pamphlet, per above. A new manifest route is owed for it;
   `blurb` from a state agency has no existing route.
6. **Pima County Recorder** — `recorder.pima.gov`. In Arizona the RECORDER runs
   voter registration and early voting, and the **Elections Department**
   (`webcms.pima.gov/elections`) runs the election itself. **They are two
   different offices** and conflating them is the Arizona-shaped version of the
   clerk mistake. Both are `filing-county`.
7. **Pima County Board of Supervisors** — the county governing body. Arizona's
   equivalent of New Jersey's Board of County Commissioners.
8. **Arizona Corporation Commission** — `azcc.gov`. Unlike almost every other
   state, Arizona's Corporation Commission is **ELECTED**, statewide, five
   members. They are reader-facing officeholders, not just a business registry,
   and the registry itself is the `business-registry` route.
9. **Arizona Legislature** — `azleg.gov`. `legislative-directory`. Already
   partly covered by the committed Open States bulk file, which holds Arizona
   legislators with emails.
10. **NCES CCD** — `nces-district-directory`, already a manifest route and
    already the school-district coverage denominator. Pima County's districts
    include Tucson Unified, Vail Unified, Sunnyside Unified — and **Sunnyside is
    the named instance of the coverage-gap class** this project already learned
    from.
11. **Census of Governments 2022** — the official universe for `twig:pair`,
    already committed.
12. **Arizona Attorney General** — `azag.gov`, Elections Integrity Unit and
    Government Accountability Unit. Campaign-finance enforcement records.
13. **The citation host map** derived from Arizona's own Wikipedia articles —
    the `press-outlet-map` route, rebuilt for this state rather than inherited.
    Expect `azcentral.com`, `tucson.com`, `azmirror.com`; **do not assume it, and
    do not hand-write it — derive it**, which is the entire point of the route.
14. **The held credentials** — `congress-api`, `fec-committee-contact`,
    `openstates-bulk`, `govinfo-cdir`. RULING 90 item 5: walked before any
    unauthenticated route is exhausted. Note that **`CENSUS_API_KEY` is
    currently INVALID** (measured 2026-08-22, the host refusing it with
    `X-DataWebAPI-KeyError: 1`) and a replacement is a Needs Sean row.

---

## What is expected to BREAK in Arizona, recorded in advance

RULING 60: a branch proven in one place is proven for that SHAPE, and nearly
every branch this project holds was built against New England towns and New
Jersey municipalities.

- **Unincorporated territory.** Vail (`85641`) is a CDP. There is no mayor, no
  council, no town clerk. The governing bodies are the COUNTY and the SCHOOL
  DISTRICT. Every municipality-shaped branch returns nothing, correctly, and
  reporting that as an absence about Vail rather than as a fact about Arizona
  would be the failure RULING 52 exists for.
- **Recorder vs Elections Department.** Two offices, one function split between
  them. The New Jersey and New Hampshire branches both assume one clerk.
- **An elected Corporation Commission.** No New England or New Jersey analogue.
- **Sovereign tribal government.** The Navajo Nation, the Tohono O'odham Nation
  and the Pascua Yaqui Tribe all hold territory in or adjacent to Pima County.
  Nothing in this product's vocabulary describes them, and inventing one is not
  a session's call.
- **A legislative district electing TWO House members.** Arizona's legislative
  districts each elect one senator and two representatives, so the roster parser
  must not assume one seat per district.

---

## Needs Sean, opened from this enumeration

- **Whether sovereign tribal government renders, and how.** The FEC directory
  names the Navajo Nation Ethics and Rules Office as a records-holding
  jurisdiction alongside the states. This product has no vocabulary for a
  sovereign nation and a session must not invent one.
- **`CENSUS_API_KEY` is invalid** and needs replacing before the Arizona
  demographic layer can be walked.
