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

---

## The 2026-08-24 addition — five routes the first enumeration did not name

**Written 2026-08-24, overnight depth hunt, item 9. NOTHING WAS WALKED to
produce this**, per RULING 86 and the brief: enumeration is a written research
step, and the Arizona hunt does not start until 07866 is done or the author
says otherwise.

**A note on where this lives, because the brief and the repo disagreed.** The
brief asked for a new file, `docs/sources-az.md`. **This document already
existed**, written 2026-08-22 under the same ruling, and it already named the
Clean Elections Commission, the Secretary of State, the Pima County Recorder,
the legislature, NCES and the Census. Creating a second Arizona source list
would be the duplication RULING 63 calls worse than a gap — and two enumerations
that disagree is exactly how a session ends up walking the older one. So the
five routes the brief named that were genuinely absent are added HERE, and the
discrepancy is reported rather than resolved silently.

### 15. Pima County Legistar — VOTE TALLIES, not just agendas

`pima.legistar.com`, and the part that matters is the API rather than the
portal: **`/v1/{Client}/eventitems/{eventItemId}/votes` returns how each
supervisor voted on each item.**

That is a `RECORD`-tier evidence source under the data model's own tiering —
how they voted, not what they said — and this product currently holds almost
none of it below the federal level. New Jersey's counties gave us nothing
equivalent.

- **Tier:** A. One endpoint answers for every item of every meeting.
- **Licence:** the records are Pima County's, published by the county. The
  vendor hosts them and a vendor's terms are a route, not a wall — the
  public-records rule governs.
- **The shape to expect:** Legistar's API is `webapi.legistar.com/v1/{client}`
  with the tenant slug in the path. The tenant slug is the thing to establish
  first, and `D70` already records that certificate-transparency logs publish
  every `*.legistar.com` subdomain, so the tenant list needs no crawl.
- **What it does NOT reach:** anything below the county. Vail is a CDP with no
  municipal government at all, so there is no municipal Legistar to find.

### 16. Arizona Game and Fish Department

`azgfd.com` and `azgfd.gov`. It answers the *am I allowed to hunt or fish*
topic that `AZ-1` shipped and `NH109` now owes New Jersey and New Hampshire —
so this is the AZ end of a route that has to exist in three states.

- **Tier:** A for that one fact.
- **Note:** the commission is APPOINTED, not elected, so it is a body this
  product names and describes rather than a race it covers.

### 17. TIGER/Line and the Census geography layers, named explicitly

The first enumeration named the Census of Governments as the universe and did
NOT name TIGER, which is a different thing doing a different job: TIGER
supplies the POLYGONS the map draws and the LSAD legal-type codes the form
stamp reads.

**RULING 80 is the reason this is worth a line of its own**: the committed
geometry is clipped to a county plus its adjacent counties, and a zip's
first-rung circle crosses county lines in 184 of 279 measured cases. Pima
County is adjacent to Pinal, Maricopa, Santa Cruz, Cochise, Graham and Yuma,
and the clip must be checked BEFORE the hunt rather than discovered when a body
renders with no polygon.

**RULING 114 is the second reason**: LSAD 43 and 44 were reversed once, and
Arizona is where the standing disagreement lives — TIGER says Buckeye is a
city, the 2022 roster says `TOWN OF BUCKEYE`, and rung 11's archived capture of
the town's own homepage says *"City of Buckeye"* three times. That is recorded
as ADJUDICATED with the route that settled it, and it still reports as a
disagreement.

### 18. Municipal sites, via the tier ABOVE

RULING 93: ask what the tier above publishes about the tier below. New Jersey's
answer was `nj.gov/nj/gov/county/localgov.shtml` — all 21 counties and all 564
municipalities with their official websites — and it reached 564 where six
sessions of sideways guessing had reached 30 of 39.

**The Arizona equivalent is not yet identified, and that is the first thing to
establish rather than the thing to guess.** The route to it is
`usa.gov/states/arizona`, which is already a walked route in
`data/hunt/tier-directories.json` and already links Arizona's own local-government
index. The League of Arizona Cities and Towns (`azleague.org`) publishes a
directory of all 91 incorporated municipalities — **and it is a nonprofit, not a
government**, so RULING 70's Ballotpedia question governs it exactly as it
governs `usmayors.org`: a discovery surface, never a source of record.

### 19. Both county party organs, and SYMMETRICALLY

The Pima County Democratic Party and the Pima County Republican Party.

**Symmetry here is a rule, not a courtesy**, and this session has already been
bitten by its absence in a different place: the campaign-site instrument built
tonight needed a party-organ test, and building one that recognised one party's
committees and not the other's would have mislabelled one side's county sites
as individual candidates' campaign sites. The same applies to walking them —
**both or neither**, exactly as the four New Jersey legislative caucus sites are
all four or none.

- **Tier:** A. A county party publishes its whole slate in one page.
- **Licence:** party organisation sites, NOT government publications. Usable
  for a member's own published contact and photo under the campaign-site and
  photo doors; **never as a source of record for a position**, which is the
  advocacy-organisation prohibition in `CLAUDE.md`.
- **What it is NOT:** an endorsement list. A ROSTER is a record; an endorsement
  is somebody's judgement about a candidate, and this product does not carry
  judgements about candidates.
