# Arizona — the source registry

**Born 2026-08-26** (the sources-and-incumbency session, Item 2). One row per
source. See `states/nh/sources.md` for the field contract and the
classification vocabulary; the same contract binds here. `NOTES.md` in this
folder is the internal dossier — **the repo's naming wins over the brief's**,
so there is no `dossier.md` beside it.

**Arizona is the state that taught this project the filing-officer question**,
and that finding leads because it is the one that generalises.

---

## THE STATUTE FIRST — A.R.S. § 16-928, read from the state's own site

**Read 2026-08-26 at `https://www.azleg.gov/ars/16/00928.htm`, HTTP 200, 3,387
bytes, titled *16-928 - Filing officer; statements and reports*.** Quoted
because a paraphrase of a routing rule is a different routing rule:

> "The secretary of state is the filing officer for statewide and legislative
> elections"

> "The county officer in charge of elections is the filing officer for county,
> school district, community college district and special taxing district
> elections"

> "The city or town clerk is the filing officer for city and town elections."

**Local campaign finance in Arizona is FEDERATED BY STATUTE, not centralised.**
That is why Arizona has one state portal and a separate filing officer per
county and per municipality, and it is not discoverable by looking at portals.

*Two corrections to how this was described in the brief, recorded rather than
smoothed.* The brief said the county-level officer is "county recorder, county
elections department or board of supervisors"; **the statute says *the county
officer in charge of elections*,** which is a single defined role and in Arizona
is not always the recorder. And the statute names **school districts and
community college districts** at the county level, which the brief did not —
that matters, because school-district money is exactly the tier this product
reaches for and nobody else does.

**THE DENOMINATOR, from the state's own table** (`Jurisdictions.txt`, pulled
2026-08-26 from the FTP below): **109 filing jurisdictions — 1 State, 15
County, 93 City/Town.** A claim of campaign-finance coverage in Arizona without
that denominator is meaningless.

*The generalising question this produces, asked of every state:* **which statute
defines the filing officer, and what does it route to whom?** Answered for New
Hampshire in `states/nh/sources.md` — **RSA 664:7 and 664:6, centralised on the
Secretary of State, one filing officer for the whole state including county
offices.** Answered for New Jersey in `states/nj/sources.md`.

---

## The Secretary of State — walked as a body, division by division

| Division | URL | Class | Licence | Walked 2026-08-26 |
|---|---|---|---|---|
| **Campaign finance & reporting** | `https://azsos.gov/elections/campaign-finance-reporting` | PRIMARY | NONE STATED | HTTP 200, 275,292 B |
| **Lobbying registry** | `https://azsos.gov/elections/lobbying` | PRIMARY | NONE STATED | **HTTP 200, 285,646 B.** The ONLY lobbyist registry this project has reached in any state |
| **County election contacts** | `https://azsos.gov/elections/about-elections/county-election-contact-info` | PRIMARY | NONE STATED | HTTP 200, 320,910 B — **all 15 counties named** |
| **Election calendar** | `https://azsos.gov/elections/calendar-dates` | PRIMARY | NONE STATED | HTTP 200, 302,481 B |
| **Spotlight (SeeTheMoney)** | `https://seethemoney.az.gov/` | PRIMARY | NONE STATED — **no `robots.txt` (HTTP 404) and no terms page**, both confirmed 2026-08-24 and again 2026-08-26 | HTTP 200, 109,107 B |
| **E-Qual** | `https://apps.azsos.gov/equal/` | PRIMARY | NONE STATED | HTTP 200, 3,640 B |
| **Bulk Filing Guide** | `https://apps.azsos.gov/cfs/Bulk_Filing_Guide.pdf` | PRIMARY | NONE STATED | HTTP 200, 317,529 B, **revised 28 July 2026** |

**Publisher for every row above:** Arizona Secretary of State. **Access:** open
pages, no key. **Freshness:** last walked 2026-08-26.

### `ftp://ftp.azsos.gov/cfsdata2/` — RUNG ZERO, and nobody here had walked it

| | |
|---|---|
| **Name** | Arizona campaign-finance reference tables |
| **URL** | `ftp://ftp.azsos.gov/cfsdata2/` |
| **Publisher** | Arizona Secretary of State — **named in the state's own Bulk Filing Guide** |
| **Classification** | **PRIMARY** |
| **Licence** | **NONE STATED.** The guide publishes the path for public use and states no terms |
| **Access** | **Anonymous FTP, no key.** Fourteen files listed 2026-08-26 |
| **Carries** | Filings infrastructure: the complete committee register, the jurisdiction universe, elections, ballot measures, transaction vocabulary |
| **Coverage** | Statewide, and — through `Jurisdictions.txt` — every county and municipal filing jurisdiction |
| **Freshness** | **Last walked 2026-08-26.** The guide states `Committees.txt` and `ReportingPeriods.txt` "change on a regular basis" and gives no cadence; that is recorded as a limitation rather than filled in |
| **Points to** | itself |
| **Do we use it** | **NOT YET WIRED.** Walked, pulled and counted this session; wiring is `AZ19` |

| File | Rows, 2026-08-26 | What it is |
|---|---|---|
| `Committees.txt` | **8,828** | id, name, address, **committee type**, organization date, termination date. **1,958 carry no termination date** |
| `Jurisdictions.txt` | **109** | 1 State · 15 County · 93 City/Town |
| `Counties.txt` | 15 | |
| `Elections.txt` | 37 | |
| `ConsolidatedElectionDates.txt` | 33 | |
| `TransactionTypes.txt`, `AllowedInitialTransactions.txt`, `AllowedOffsetTransactions.txt`, `TransactionTypesAllowedByCommittee.txt`, `AdvertisingModes.txt`, `BallotMeasures.txt`, `ReportingPeriods.txt`, `SampleDatafile.txt`, `BulkFilingGuide.doc` | — | the filing vocabulary |

**BULK OR SEARCH-UI, ANSWERED PLAINLY, BOTH HALVES.** Bulk **extract of
transactions** — **no.** The Bulk Filing Guide is an UPLOAD specification for
committees filing INTO the system; there is no documented download of the money
itself. Bulk **reference tables including the whole committee register** —
**yes**, at the anonymous path above.

**Clean Elections participation is already a filed field.** `Committees.txt`
types 810 committees *Candidate (participating in Clean Elections)* against
3,767 *Candidate (not participating in Clean Elections)*. **That is the neutral,
filed, binary fact about a candidate that belongs on a card**, available in bulk,
with no per-candidate hunt at all.

**And the donor schema is why RULING 167 is a standing rule.** Appendix A of the
guide specifies columns 10–22 of every filed transaction as contributor
`LastName`, `FirstName`, `MiddleName`, `NameSuffix`, `Address1`, `Address2`,
`City`, `State`, `ZipCode`, `PhoneNumber`, `FaxNumber`, **`Occupation`** and
**`Employer`** — the last two *conditionally REQUIRED* for individual
contributions. The same personal record as the FEC's and New Hampshire's,
arriving through a third door.

---

## The legislature

| | |
|---|---|
| **Name** | Arizona State Legislature |
| **URL** | `https://www.azleg.gov/`, applications at `https://apps.azleg.gov/` |
| **Publisher** | Arizona State Legislature |
| **Classification** | **PRIMARY — rung one for Arizona** |
| **Licence** | NONE STATED |
| **Access** | Open pages. **An API exists**: `az-civic-tools` states it scrapes azleg.gov "daily via azleg.gov API". **This session did NOT locate its documentation** — `apps.azleg.gov/api/Legislator/` and `www.azleg.gov/api/` both answered 404 — so the API is a recorded LEAD, not a walked route |
| **Carries** | Bills, sponsors, committee votes, floor votes, legislators |
| **Coverage** | Fifty-seventh Legislature, Second Regular Session (2026); 30 legislative districts |
| **Freshness** | Member roster walked 2026-08-26: `https://www.azleg.gov/memberroster/?body=S` HTTP 200, 104,844 B. `apps.azleg.gov` HTTP 200 |
| **Points to** | itself |
| **Do we use it** | **NO. LegiScan is wired instead** — the same inversion RULING 166 names, in a second state |

| | |
|---|---|
| **Name** | Arizona Revised Statutes, Title 16 (Elections and Electors) |
| **URL** | `https://www.azleg.gov/arsDetail/?title=16` |
| **Publisher** | Arizona State Legislature |
| **Classification** | **PRIMARY** |
| **Licence** | NONE STATED |
| **Access** | Open pages |
| **Carries** | The statutory basis for filing-officer routing, contribution limits and deadlines |
| **Freshness** | Walked 2026-08-26, HTTP 200, 183,015 B |
| **Do we use it** | Cited, not ingested |

---

## Redistricting

| | |
|---|---|
| **Name** | Arizona Independent Redistricting Commission |
| **URL** | `https://irc.az.gov/` |
| **Publisher** | AIRC — **the body that draws the districts, publishing them** |
| **Classification** | **PRIMARY** |
| **Licence** | NONE STATED — terms not reached |
| **Access** | **A RUNG-3 WALL THAT FALLS.** Plain fetch: HTTP 403. Full browser header set on `robots.txt`: HTTP 200. The site itself returned 403 at rung 3 on 2026-08-26 and **rungs 4, 5 and 6 are unwalked**, which is stated rather than reported as a wall |
| **Carries** | Legislative and congressional district boundaries, effective 2022 |
| **Coverage** | 30 legislative districts, statewide |
| **Freshness** | Last tested 2026-08-26 |
| **Do we use it** | **NO.** The AZ resolver uses Census TIGER. **Comparing the two is `AZ20`** — RULING 57's two-official-enumerations-disagreeing is a finding, and until they are compared we do not know whether they do |

---

## `az-civic-tools` — DERIVED-POINTER, and the Arizona reconciliation anchor

| | |
|---|---|
| **Name** | AZ Civic Tools (Cactus Watch, District Finder) |
| **URL** | `https://github.com/az-civic-tools/az-civic-tools`; API at `https://cactus.watch/api/` |
| **Publisher** | az-civic-tools, an independent open-source project |
| **Classification** | **DERIVED-POINTER** |
| **Licence** | **MIT.** Quoted from the repository's own README, read 2026-08-26: *"[MIT](LICENSE) — Use it however you want. No attribution required."* |
| **Access** | **Free public API, no key required.** Refreshed daily at 06:00 Arizona time. `/api/bills`, `/api/bills/<id>`, `/api/hearings`, `/api/rts/<id>`, `/api/orgs`, `/api/meta`, and **`/api/bills/sync?since=`** |
| **Carries** | Every AZ bill with sponsors and cosponsors by party, committee votes, **individual floor votes for every legislator**, bill status with deadline-based dead-bill detection and strike-everything flags, plain-language overviews taken from azleg.gov fact sheets, **RTS hearing agendas**, and organization recommendations |
| **Coverage** | Current AZ session; 30 legislative districts as GeoJSON with a `legislators.json` |
| **Freshness** | README and `/api/meta` walked 2026-08-26, both HTTP 200 |
| **Points to** | **`azleg.gov`** (bills and legislators), **`irc.az.gov`** (boundaries), and `nominatim.openstreetmap.org` (geocoding) — it names its own primaries, which is what makes it a good pointer |
| **Do we use it** | **NOT as a source of record, and that is a decision rather than an oversight.** One maintainer, one star, 91 commits. That is dependency risk for a source of record, and it is not one: `azleg.gov` is |

**REGISTERED AS THE ARIZONA EXTERNAL RECONCILIATION ANCHOR, and this is worth
more than the data.** RULING 147 says no reconciliation may compare a parser to
itself — the MAYOR defect was born exactly there, with `pnpm nj:filing:check`
reporting AGREES on 272 against 272 where both numbers came from our own parser.
Cactus Watch is an **independent third party extracting the same votes from the
same legislature**, which is precisely the outside side that rule demands.

**The method, stated so it is not improvised later:** our azleg.gov extraction
of a given roll call is compared against `cactus.watch/api/bills/<id>`'s vote
list for the same bill. **Disagreements are REPORTED, never reconciled away**
(RULING 114) — a mismatch is a finding about one of the two extractions, and
editing the expectation to match is the failure that rule exists over. The
anchor is never the authority: where they disagree, a third branch is walked and
what it said is recorded.

**EXCLUDED, affirmatively, regardless of the permissive licence: the
organization recommendations.** `/api/orgs` carries curated positions from named
advocacy groups (CEBV, Secular AZ, SOS Arizona). **A licence states what may be
done, not what should be.** Ingesting third-party endorsements puts interested
parties' framing into a product whose claim is that it carries none, and it sits
directly against the standing rule that this product never tells anyone how to
vote and never adds advocacy organizations or endorsement sites as sources.
**Not ingested, not rendered, not stored.**

**Their geocoding pattern is NOT copied.** They use OpenStreetMap Nominatim,
which ships the reader's address to a third party. This product precomputes
against TIGER so the street never leaves the device. Theirs is the weaker
privacy story and ours does not change.

**RTS — Request to Speak — is a PRODUCT finding, not only a data one.** Arizona
runs an official mechanism for citizens to sign up to testify on bills at
committee hearings, and Cactus Watch surfaces upcoming hearings with direct
links into it. That is *make your voice heard* already existing as state
infrastructure. Registered as a civic-action mechanism below.

---

## Official civic-action mechanisms the state itself runs

| Mechanism | URL | What it is | Registered |
|---|---|---|---|
| **RTS (Request to Speak)** | via `apps.azleg.gov` | Sign up to testify on a bill at a committee hearing | 2026-08-26 |
| **E-Qual** | `https://apps.azsos.gov/equal/` | Sign nomination petitions and give $5 qualifying contributions online | 2026-08-26 |

**The standing question this produces, asked of every state: does an official
public-testimony or petition sign-up mechanism exist, and where?**

- **New Hampshire — YES.** The General Court runs **Online Testimony
  Submission**, linked from `gc.nh.gov` as *Online Testimony Submission
  (Sign-In)* and *Online Testimony Submissions*, and the public SQL Server
  carries a **`houseRemoteTestify`** table (`firstName`, `lastName`,
  `committeeDate`, `committeeID`, `legislationID`, `representing`, `town`,
  `state`, `nongermane`, `testimonyText`). **New Hampshire publishes the
  submitted testimony itself as data.** Found 2026-08-26 by reading the body's
  own downloads page and schema — which is RULING 166 producing a finding
  nothing else would have.
- **New Jersey — NOT LOCATED this session.** `njleg.state.nj.us` was walked
  (HTTP 200, 928,917 B) and the question was not answered from it. A dated gap,
  not an absence.

---

## Municipal and county — the statute's consequence

| Source | URL | Class | Walked 2026-08-26 |
|---|---|---|---|
| **League of Arizona Cities and Towns local government directory** | `http://lgd.azleague.org/` | **DERIVED-POINTER** — a league of municipalities is a membership organisation, not a government body, so RULING 70's question governs it | HTTP 200, 232,717 B |
| **Pima County campaign finance** | `https://www.pima.gov/620/Campaign-Finance` | PRIMARY (county filing officer) | HTTP 200 |
| **Pima County EasyVote portal** | `https://pimacountyaz.easyvotecampaignfinance.com/home/publicfilings` | PRIMARY records on a **VENDOR** platform | not walked |
| **City of Tucson campaign finance** | `https://www.tucsonaz.gov/Departments/Clerks/Campaign-Finance-Information` | PRIMARY (city filing officer) | HTTP 200 |
| **Maricopa County Recorder candidate search** | `https://legacy.recorder.maricopa.gov/Elections/CampaignFinance/candidatesearch.aspx` | PRIMARY | not walked |

**THE VENDOR OBSERVATION, and it is the route to local money at scale.**
**EasyVote** is a vendor, and a vendor serving one county serves others. Local
campaign-finance portals get the same treatment agenda platforms already get:
identify the vendor, then ask whether a tenant list exists. One county at a time
does not scale to 109 Arizona filing jurisdictions, let alone nationally.
**Whether an EasyVote tenant list exists is UNANSWERED as of 2026-08-26** and is
rowed as `AZ21`.

**The league-of-municipalities question, asked of every state:**

- **Arizona — YES**, `lgd.azleague.org`, and the state itself points at it.
- **New Jersey — the STATE publishes the directory directly**, which is better:
  `nj.gov/nj/gov/county/localgov.shtml`, already registered. The NJ League of
  Municipalities exists (`njlm.org`) and was **not walked** this session.
- **New Hampshire — NOT LOCATED this session.** The NH Municipal Association
  (`nhmunicipal.org`) was not walked. A dated gap.

---

## Clean Elections

| | |
|---|---|
| **Name** | Citizens Clean Elections Commission |
| **URL** | `https://www.azcleanelections.gov/` |
| **Publisher** | Citizens Clean Elections Commission (Arizona state body) |
| **Classification** | **PRIMARY** |
| **Licence** | NONE STATED |
| **Access** | Open pages |
| **Carries** | Participating candidates; voter education |
| **Coverage** | Statewide, per cycle |
| **Freshness** | Walked 2026-08-26, HTTP 200, 26,250 B |
| **Do we use it** | **No.** And the participation fact is available in bulk from `Committees.txt` above, which is cheaper and is the body's own filing record |

**Pilot-zip count, stated honestly:** **NOT YET COUNTED.** `Committees.txt`
types participation per COMMITTEE and joining those committees to the candidates
on the `85641` and `85701` ballots is work this session did not do. Recorded as
`AZ22` rather than estimated.

---

## Results and the voter portal

| Source | URL | Class | Note |
|---|---|---|---|
| **Election-night results** | `https://results.arizona.vote/` | PRIMARY | not walked this session |
| **Voter portal** | `https://my.arizona.vote/` | PRIMARY | not walked this session |

---

## Registered with a warning attached

| Source | URL | Verdict |
|---|---|---|
| `markng/theyworkforaz` | `https://github.com/markng/theyworkforaz` | **ARCHIVED read-only since 2025-12-30.** Historical interest only. Its address→district→representative approach is noted; nothing depends on it |
| `qstin/LegiScanApiScripts` | `https://github.com/qstin/LegiScanApiScripts` | Client tooling for an API already in use, **not a source**. Walked as a repository listing 2026-08-26; nothing found that this project's LegiScan client does not already do |
| `State-of-Arizona` GitHub org | `https://github.com/State-of-Arizona` | **NOT civic data** — three Drupal modules. **One is quietly useful:** `az_site_sliver` is mandated on every Arizona state government website, which makes its presence a **fingerprint for verifying a site is genuinely official**, a second signal alongside `cisagov/dotgov-data`. Recorded for that use and nothing more |

---

## Freshness cadence

RULING 96 and RULING 53: candidate fields 7 days, bodies and rosters 14 days,
walled sources 14 days. Every row carries its last-walked date.

---

## THE DESCENT — every level walked, and its counts (RULING 169)

**Walked 2026-08-26** by `pnpm descent --state az`, 2 pass(es).
The full walk is `states/az/descent.md`; every candidate it named is
`states/az/descent-candidates.md`. This section is the REGISTER entry for it.

| Tier | Found | Followed | Yielded | Barren | Declined | Candidates NEW | Candidates known |
|---|---|---|---|---|---|---|---|
| `state` | 8 | 6 | 5 | 1 | 2 | **129** | 3 |
| `county` | 107 | 36 | 14 | 22 | 71 | **207** | 7 |
| `multi-county` | 36 | 32 | 16 | 16 | 4 | **130** | 5 |
| `special-district` | 9 | 9 | 4 | 5 | 0 | **16** | 0 |
| `city` | 1 | 1 | 1 | 0 | 0 | **3** | 0 |
| `other` | 14 | 14 | 6 | 8 | 0 | **181** | 39 |

**175 links found · 98 followed · 666 CANDIDATE bodies not already matched in the registry.**

**THE WALK STOPPED, IT DID NOT FINISH.** Pass 2 queued
**1143** link(s) that were never followed. RULING 169: if the final pass found
anything new, the walk was not finished and the session says so. Those links are the next
session's resume point, and they are held in the frontier the run rebuilt rather than in a list
anybody has to remember.

**They are CANDIDATES and not bodies.** A candidate is a link whose text named a governing body;
confirming it, resolving it to a division and giving it an id is the next motion. Reporting the
number as *bodies discovered* would be a claim about coverage this product does not have.

**Freshness: last walked 2026-08-26.** RULING 96 — a source past expiry is re-walked or
reported STALE with its date. Bodies and rosters carry a 14-day clock (RULING 53).

