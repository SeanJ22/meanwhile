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

---

## The 2026-08-24 addition — SeeTheMoney walked, and what it actually is

*(Item 6 of the state-campaign-money session. The enumeration above NAMED the
Secretary of State as holding state campaign-finance reports; this records what
happens when the door is actually opened, so the Arizona hunt inherits a walked
route rather than a name — RULING 63.)*

### 20. SeeTheMoney — the portal, and it is NOT at the address the enumeration implies

**`https://seethemoney.az.gov` — HTTP 200, 109,107 bytes, title `SeeTheMoney`,
walked 2026-08-24 at rung 2 (a plain fetch).** No wall, no challenge page, no
credential.

The enumeration above points at `azsos.gov` because that is what the FEC
directory names, and the FEC directory is right about the AUTHORITY. It is not
the address of the DATA. Two facts worth carrying forward:

- **`https://azsos.gov/elections/campaign-finance` answers HTTP 404** — walked
  2026-08-24. The path a person would guess from the directory does not exist.
  The status code is honest here, which is worth saying because
  `nj.gov/nj/gov/county/` answers 200 with a "Page not found" body and RULING 93
  exists because of it.
- **The portal is its own host.** `seethemoney.az.gov` is where the filings are,
  and nothing on the Secretary of State's own campaign-finance route names it in
  a machine-readable way.

### What its shape is, measured rather than assumed

| Fact | Measured 2026-08-24 |
| --- | --- |
| Entry page | `https://seethemoney.az.gov/Reporting/Explore` — HTTP 200, 109,107 bytes |
| Data endpoint | **`POST https://seethemoney.az.gov/Reporting/GetNEWTableData` — HTTP 200** |
| A near-miss endpoint | `POST /Reporting/GetDetailedTableData` — **HTTP 404**, so the name matters |
| `robots.txt` | **HTTP 404** — there is no robots file to honour or violate |
| A terms-of-use page at the guessed path | `/PublicResources/TermsOfUse` — HTTP 404 |

**The endpoint is LIVE and its PARAMETER SHAPE IS NOT YET KNOWN.** Posted with a
guessed body it answers `200` with a two-byte empty payload — which is the exact
shape RULING 100 warns about, and it is recorded here as *not determined* rather
than as *returns nothing*. A 200 with an empty body is a statement about our
request, not about Arizona's records.

The next rungs for it, named so the AZ hunt does not re-derive them:

- **Rung 7, properly** — the page's own network calls, observed in a live
  browser. This is the obvious route and it was not walked here only because the
  session's scope for Arizona was the enumeration rather than the extraction.
- **Rung 12** — the vendor underneath. The response shell is ASP.NET MVC
  (`The resource cannot be found.` is the stock IIS 404 page), so the endpoint
  is a controller action and its parameters are the action's own argument names.
- **Rung 13** — the Secretary of State's own public-records path, already
  enumerated above with `sosadmin@azsos.gov`.

### Terms, recorded with their date

**There is no terms-of-use document at the portal, and there is no
`robots.txt`.** Both were asked for on 2026-08-24 and both answered 404. That is
a measurement, not a permission: the absence of a stated restriction is not the
same as a stated allowance, and the four standing limits in the public-records
rule govern regardless — no authentication, no circumvention, no rate that
degrades service, nothing not already published.

**The records themselves are Arizona public records** held by a state agency, and
`.gov` publications by a US state are not subject to federal copyright the way a
vendor's compilation would be. **RULING 126 governs what may be done with them
once retrieved: they render for readers and never enter anything sold.**

### 2026-08-31 (Session C) — the parameter shape is RESOLVED, and the endpoint yields

The block above recorded the endpoint as LIVE with its **parameter shape not yet
determined**: posted with a guessed body it answered `200` with a two-byte
payload, and that was correctly recorded as a statement about our request rather
than about Arizona's records (RULING 100). Rung 7 — the page's own network
calls — was named as the next rung and is now walked.

**The request, observed rather than guessed:**

```
POST https://seethemoney.az.gov/Reporting/GetNEWTableData/
     ?Page=1&startYear=2025&endYear=2026&JurisdictionId=0
     &TablePage=1&TableLength=10
     &IsLessActive=false&ShowOfficeHolder=false&ChartName=1
```

Body: a standard **DataTables server-side form post** — `draw`, `start`,
`length`, `order[0][*]`, `search[*]`, and a `columns[N][data]` array naming
`EntityLastName, CommitteeName, OfficeName, PartyName, Income, Expense,
CashBalance, IESupport, IEOpposition`.

**Three parameters are what the guessed body was missing** — `IsLessActive`,
`ShowOfficeHolder` and `ChartName` — and the column array must be present. With
them the endpoint returns **`recordsTotal` 370 for the 2025–2026 cycle** at
`JurisdictionId=0` (Arizona Secretary of State), 296 for 2026 alone.

Each row carries `EntityID`, `EntityFirstName`, `EntityLastName`,
`CommitteeName`, `OfficeName` (e.g. `State Senator - District No. 15`),
`PartyName`, `EntityTypeName`, `Income`, `Expense`, `CashBalance`, `IESupport`
and `IEOpposition`. `EntityID` is a real join key, which is what the
`StateMoneyRecord` contract requires instead of a name string.

**Permission is unchanged and was re-confirmed:** no `robots.txt` (404), no
terms document (404), no challenge, no credential.

#### The one thing that is NOT resolved, and why nothing was built on it

**A single candidate returns SEVERAL rows sharing one `EntityID`, with
different `Income` and `Expense` and an IDENTICAL `CashBalance`.** Jayme
Accalia (`EntityID` 102162) returns three: income 686.91 / 205 / 1123.97,
expense 101 / 0 / 466.73, cash balance 1448.15 on all three, and `OfficeName`
empty on one of them and `State Senator - District No. 15` on the other two.
Narrowing to 2026 alone returns the same three rows.

So the rows are a breakdown — plausibly per filed report, per period, or per
committee-office pairing — and **which of them, or which aggregation of them,
is "raised this cycle" is undetermined.**

**No snapshot was produced from this, deliberately.** Summing looked reasonable
and so did taking the largest, and the two disagree. Publishing either as a
named person's campaign total, on their own card, under their own photograph, is
the failure `lib/funding/state-money.ts` opens by naming — *"a candidate joined
to the wrong committee renders someone else's money on their card, and that is a
worse failure than an empty drop-down by a wide margin."* The same is true of
the wrong TOTAL for the right committee.

**The next step is a verification, not a guess:** read one candidate's total as
the portal itself displays it — the entity overview the UI renders, or
`/Reporting/ExportEntityOverview` and `/Reporting/ExportEntityTransactions`,
both of which take the same parameter string plus `ExportOptions` and were seen
in the bundle — and adopt whichever aggregation reproduces the publisher's own
figure. That is one bounded experiment, and it is what stands between this route
and `data/states/az/funding/state-money-az-2026.json`.

#### That experiment was RUN, and it REFUTED the obvious answer

Recorded so nobody spends the session repeating it.

**The portal displays no per-candidate total at all.** Its own table renders the
several rows exactly as the endpoint returns them — same candidate, same
committee, same cash balance, different office/party and different amounts.
There is no aggregate figure on that surface to reproduce.

**The arithmetic that looked like proof does not survive the population.** On
Jayme Accalia the numbers are seductive: incomes 686.91 + 205 + 1123.97 =
2015.88, expenses 101 + 0 + 466.73 = 567.73, and 2015.88 − 567.73 = **1448.15**,
which is exactly the `CashBalance` repeated on all three rows. That looks like a
proof that the rows are parts and the totals are sums.

Checked across all 370 rows grouped by `EntityID` (255 distinct entities), the
identity `sum(Income) − sum(Expense) == CashBalance` **HOLDS for 134 and BREAKS
for 121** — and it breaks for SINGLE-ROW entities too, where there is nothing to
sum: Racquel Armstrong is one row, income 202,620.31, expense 37,590.06, cash
balance 138,816.11, off by 26,214.14. So `CashBalance` carries something the
2025–2026 window does not contain — a prior-cycle balance is the obvious
candidate — and Accalia matched because she happened to start from nothing.

**So the row semantics remain undetermined, and one candidate agreeing with a
hypothesis is not evidence for it.** What would settle it is a source that
states a cycle total independently: `ExportEntityTransactions` (itemised
transactions, which can be summed and compared), the filed reports themselves,
or the `ftp://ftp.azsos.gov/cfsdata2/` bulk drop already recorded as YES on
2026-08-26 with 8,828 committees. The FTP is the most promising and is not yet
walked for this purpose.

The obligation is NOT closed by this note. Arizona statewide money remains owed;
what changed is that the route is known to work and the remaining question is a
named, single one.

### The Citizens Clean Elections Commission, walked

**`https://www.azcleanelections.gov` — HTTP 200, 26,249 bytes**, walked
2026-08-24 at rung 2. Named in the FEC directory as holding *Full Public Funding
to Statewide and Legislative* records and the *Candidate Statement Pamphlet*.

That pamphlet is worth naming as a route in its own right, and not for money:
**it is candidates' own words, published by the state, symmetrically, on
identical terms** — which is the same instrument RULING 112 describes and cites
this Commission as the model for. It is a `in their own words` route as much as
a `filing-campaign-finance-state` one.

---

## 2026-08-31 (Session C2) — THE ROUTE IS WALKED END TO END AND ARIZONA MONEY IS ON THE BALLOT

The block above closed with the row semantics UNDETERMINED, the identity
`sum(Income) − sum(Expense) == CashBalance` refuted 134/121 over the population,
and the note *"Arizona statewide money remains owed."* It is no longer owed for
44 of the 49 candidacies the Secretary of State is the filing officer for.
`data/states/az/funding/state-money-az-2026.json` exists and the ballot page renders it.

### Why the refutation was correct and its conclusion was not

The 134/121 measurement was real and the refusal to ship on it was right. What
was wrong was what it was taken to mean.

**`CashBalance` could never have validated that sum.** It is repeated
IDENTICALLY on every row of an entity — 94 of 94 multi-row entities — and it
does not move when the query window moves, because it carries a balance brought
forward from before the cycle. Checking a WITHIN-WINDOW SUM against an
ACROSS-WINDOW BALANCE compares two quantities that are not commensurable. The
134 that agreed were the committees that happened to start from zero, which is
exactly why Jayme Accalia's three rows summed to her balance to the cent and
looked like proof.

So the hypothesis was not refuted. **The test was invalid, and a session that
accepts a refutation without asking whether the two sides were commensurable
inherits a fact class recorded as unknowable when it is merely unmeasured.**
That is now a method route:
`a-refuted-hypothesis-may-have-been-tested-against-the-wrong-quantity`.

### The commensurable source, and the parameter that was hiding it

The prior note named the itemised transaction ledger as the thing that would
settle it, and recorded it as returning nothing.

**It was returning nothing because our request was short one parameter.**
`POST /Reporting/GetNEWDetailedTableData` needs the page's own `Name=1~<id>`
form **AND** a separate **`entityId=<id>`** in the query string. With `Name`
alone it answers HTTP 200 with a complete, well-formed DataTables envelope —
`draw`, `recordsFiltered`, `data: []` — and `recordsTotal: 0`. Nothing about it
looks like a failure. That is the dangerous shape of RULING 100: not the
obviously-broken two-byte reply, but the well-formed zero.

### THE MEASUREMENT, over the population, with its denominator

```
2025-2026 cycle, JurisdictionId=0, 370 summary rows in 255 entities
  sum(summary Income)  == sum(itemised income)     HOLDS 255/255   BREAKS 0
  sum(summary Expense) == sum(itemised expense)    HOLDS 255/255   BREAKS 0
  sum(Income) − sum(Expense) == CashBalance        HOLDS 133/255   BREAKS 122
```

The rows are parts and their sum is the cycle total. `CashBalance` is **not
published**: what it carries beyond the window is not established, and a number
whose meaning is unknown does not go under a person's photograph.

That is the population test. **Every committee actually published is
additionally reconciled INDIVIDUALLY** — 58 of 58 agreed, across 291,930
itemised transactions — and a committee that stops agreeing stops rendering.

### THE DEFAULT VIEW IS NOT THE UNIVERSE, and this is the correction that matters most

| Query, at `JurisdictionId=0`, 2025-2026 | Rows the publisher declares | Entities |
| --- | ---: | ---: |
| `IsLessActive=false ShowOfficeHolder=false` (**the default**) | 370 | 255 |
| `IsLessActive=true ShowOfficeHolder=false` | 844 | 716 |
| `IsLessActive=true ShowOfficeHolder=true` | 16 | **16, disjoint** |
| **union** | **860** | **732** |

`ShowOfficeHolder=true` **replaces** the set rather than widening it. A
candidate behind either flag, asked for with the defaults, comes back as
nothing — and *"370 of 370 rows the publisher itself declares"* is the
strongest-sounding completeness claim available while being scoped to one query.

**Concretely: Kevin Volk, on this ballot for State Representative District 17
with $173,742.29 raised, is not among the default 370.** Matching the pilot
ballot against the default view alone writes a false absence on his card.

### A quoted nickname is an alternate name, and reading it as text cost five committees

Both publishers annotate names the same way and nothing was reading the
annotation. The ballot carries `Rachel "Jones" Keshel`, `Nicholas "Nick" Myers`,
`Hollace "Holly" Lyon`, `Walter "Les" Presmyk`; the register carries
`Slawson, Fred "Ryan"`. Treated as ordinary text the quoted word becomes a token
that can never match, and the shared `namesAgree` — correctly, on the input it
was given — refused. **That turned five live committees into five manufactured
absences**, including Keshel's, which had filed $47,878.92.

The fix parses; it does not fuzz. A name with a quoted segment expands into the
names it actually states and `namesAgree` is applied unchanged. `Tom Horne`
against the filed `Horne, Thomas Chalres` is the control: no annotation, no
match, and he stays an OURS GAP rather than a guess.

### AN ABSENCE NOW NEEDS TWO REPRESENTATIONS TO AGREE

RULING 206. The portal is a filing cabinet and the FTP register is another. An
absence is written only when the union of all three portal queries holds nothing
**and** the Secretary of State's own 8,829-row `Committees.txt` holds no live
candidate committee under the surname. Where they disagree it is OUR gap.

**One candidacy on this ballot clears that bar: Ken Miceli**, for Governor,
absent from both representations.

### The FTP root has four directories, not one

Previously recorded as though `/cfsdata2/` were the whole of it. Listed
2026-08-31: **`cfsdata`** (an older sibling), **`cfsdata2`** (14 files),
**`ElectionResults`** — a directory per even year from **1998 through 2026**,
the 2026 one modified 5 July — and **`EzBulkFilling Deploy`**. `ElectionResults`
is results rather than money and was not walked; it is recorded as `DISCOVERED`
in `data/campaign-finance/az-route-descriptors.json` so it is not re-lost.

**Still no bulk transaction extract**, re-confirmed: none of the 14 files is
transactional. The Bulk Filing Guide is an UPLOAD specification.

### Permission, re-measured 2026-08-31

- `seethemoney.az.gov/robots.txt` — **HTTP 404 to a bare client, an identified
  client and a browser-identified client alike**, so the 404 is about the host
  rather than about our identification. No terms document. No challenge, no
  credential.
- `apps.azsos.gov/robots.txt` — HTTP 200, `Crawl-delay: 5`, disallowing only
  `/apps/`, `/scripts/`, `/poll/`, `/election/EOC2015/`, `/cptest/`. No rule
  reaches the FTP service.
- `https://ftp.azsos.gov/robots.txt` — **CONNECT TIMEOUT**, because there is no
  HTTPS service on that host. **That is TRANSPORT state and is not a permission
  verdict** (RULING 182). The FTP service itself answers `230 Password Ok` to
  anonymous.

### Where the 49 candidacies ended, with the denominator

Both pilot ZIPs — **85701** and **85641** — reach the same 30 contests and the
same 55 candidacies, because a zip is an area and both ZCTAs cross the same
divisions. Six are federal and file with the FEC, which this product already
reads. **The Secretary of State is the filing officer for the other 49.**

| Reader state | 85701 | 85641 |
| --- | ---: | ---: |
| Sourced filed totals | **44** | **44** |
| Sourced, dated absence (both representations agree) | **1** | **1** |
| OURS GAP, with a live obligation and a stated next date | **4** | **4** |
| **Total in scope** | **49** | **49** |

45 committee records back the 44 filed candidacies — one candidate has two.
No candidacy is in two states and none is in none. **Generic placeholders are
gone from all 49.**

The four gaps and what each is owed are enumerated in
`data/campaign-finance/az-route-descriptors.json` under `obligationStillOpen`,
and each renders on its own card naming the state's next filing deadline,
**2026-10-15 (Post-Primary Election Q3)**, read from the state's own calendar. <!-- expected-future: Arizona's own Cycle 2026 Standing Reports filing deadline, read 2026-08-31 from ftp://ftp.azsos.gov/cfsdata2/ReportingPeriods.txt. A deadline, not a stamp. -->

**The obligation is NOT closed by this note.** Four candidacies remain owed, and
the county and municipal tiers — 108 of Arizona's 109 filing jurisdictions —
are not touched by any route here.
