# Ballot sources for 2026-11-03, and the candidate corpus — research

Tracker **D08** (investigated), **D05** (schema research). Research only —
no adapter was written and no schema was built; per the reprioritization the
ballot build is next session and the candidate corpus the session after,
because the ballot is what says which candidates matter.

Compiled 2026-08-13 from primary sources where marked; anything the research
could not verify at a primary source is flagged UNVERIFIED inline and must
not be built against. The election-date table in Part A is also recorded in
docs/state.md, which is the authoritative copy for planning.

---

# 2026 General Election (Nov 3) — Research Report: 85701/85641 (Pima AZ), 07866 (Morris NJ), 03255 (Merrimack NH)

Research date: 2026-08-13. Anything marked **UNVERIFIED** could not be confirmed at a primary source and should not be treated as fact.

## PART A — Election administration dates (verified at state primary sources)

| State | Registration deadline | Mail-ballot send date | Early voting | Verified at |
|---|---|---|---|---|
| **Arizona** | Oct 5, 2026, 11:59 p.m. | Oct 7, 2026 (early ballots mailed) | Begins Oct 7, 2026 (27 days out). Last day to request a mail ballot: Oct 23, 2026 (county) | azsos.gov/elections/election-information/2026-election-info and azsos.gov/elections/calendar-dates (both state Oct 5 / Oct 7); corroborated at county level on pima.gov (Elections dept pages; UOCAVA ballots Sep 18, request deadline Oct 23) |
| **New Jersey** | Oct 13, 2026 (21 days out; evening registration 4–9 p.m. same day) | Sep 19, 2026 (county clerks begin mailing VBM ballots, 45 days out, N.J.S.A. 19:63-5) | In-person early voting Oct 24 – Nov 1, 2026 (10th to 2nd day before). VBM apply-by-mail deadline Oct 27; in-person VBM application until Nov 2, 3:00 p.m. Sample ballots mailed on/before Oct 21 | nj.gov/state/elections/assets/pdf/chrons/2026-chron-general-election-0109.pdf (official 2026 General Election Timeline, updated Jan 9, 2026 — I extracted the full text of the PDF) |
| **New Hampshire** | No fixed statewide deadline: register in person with town/city clerk up to 6–13 days out (varies by town), **or same-day at the polls on Election Day**. Absentee registration request must reach the clerk by 12:00 p.m. the day before | No universal mail voting. Absentee ballots (excuse required) can be requested as early as **May 3, 2026** for the general; request by mail until 12:00 p.m. and in person until 5:00 p.m. the day before; return by 5:00 p.m. Election Day | **No in-person early voting.** Absentee-by-excuse only (out of town, disability/illness, work/caregiving, religious observance, weather warning, etc.) | sos.nh.gov/elections/absentee-ballots and sos.nh.gov/elections/register-vote/registration-deadlines (read via browser; the site 403-blocks automated fetchers) |

## PART B — Per jurisdiction

### Pima County, AZ (85701 Tucson · 85641 Vail)

| Item | What exists | Where | Format | Judgment |
|---|---|---|---|---|
| Official ballot content | Statewide candidate listing via portal; measure language, arguments, Publicity Pamphlet; county candidate filings | azsos.gov/elections/election-information/2026-election-info → "Candidate Listing" at apps.arizona.vote/electioninfo; azsos.gov/elections/ballot-measures; pima.gov/394/Elections ("2026 General Election Candidates Filed" PDF) | Portal = HTML app; filings and pamphlet = PDF | Curated pages + portal; no documented bulk feed. **As of Aug 13, Pima's general-election page says "additional information will be added"** — full county ballot content not yet posted |
| Sample ballot | Pima publishes a sample-ballot lookup and per-election materials; 2026 general versions not yet up | pima.gov/394/Elections, pima.vote | PDF/HTML | County-curated; expect after ballot certification (early ballots go out Oct 7) |
| Offices on this ballot | Statewide: Governor (**first election with a Governor+Lt. Governor joint ticket**), Sec. of State, Attorney General, Treasurer, Supt. of Public Instruction, Mine Inspector, Corporation Commission; U.S. House — 85701 in **CD-7**, 85641 (Vail) in **CD-6**; Legislature — Vail in **LD-17**; 85701 LD-20 or LD-21 **UNVERIFIED at zip level**; judicial retention (Supreme Court, Court of Appeals Div. 2, Pima Superior Court) **UNVERIFIED for the specific 2026 roster**; school district governing boards (TUSD / Vail USD) and JP/constable seats **UNVERIFIED** | Statewide: azsos 2026 election info (Wikipedia/Ballotpedia corroboration for Governor/AG/SoS races); districts via Wikipedia district pages (secondary) | — | **Not on this ballot:** U.S. Senate (no AZ seat up in 2026); Pima Board of Supervisors and countywide officers (presidential-cycle, elected 2024); City of Tucson (odd-year city elections); Vail has no municipal government (unincorporated). Zip→district is inherently approximate — resolve by address, not ZCTA |
| Measures & official analysis | **Confirmed**: statewide propositions with official ballot language, pro/con arguments, and a Publicity Pamphlet from the SoS ("2026 Publicity Pamphlet — coming in 2026"; argument portal closed Jun 24); **Legislative Council impartial analyses confirmed** at the Legislature's own site | azsos.gov/elections/ballot-measures; azleg.gov/ballot-measures-2026-analyses/ (and /ballot-measures-draft-analyses-2026/) | All PDF | Reports of ~10 statewide measures for Nov 2026 are from secondary press/Ballotpedia — final certified list at azsos once petition review completes. Richest official measure apparatus of the three states |
| Candidate filings | Statewide portal listing + "Candidate Nominations and Petitions Filed" PDFs; Pima county-level filed-candidates PDF | apps.arizona.vote/electioninfo; azsos.gov; pima.gov/394/Elections | HTML portal + PDF | seethemoney.az.gov (SoS campaign-finance portal, linked from azsos.gov/elections as "Spotlight") sits behind a Cloudflare challenge; whether it offers CSV/bulk export is **UNVERIFIED** in this session |
| Machine-readability | No documented public CSV/JSON/API for ballot content or candidate lists found on azsos.gov or pima.gov | — | HTML portal + PDF | Plan on scraping/curation, not a feed |

### Morris County, NJ (07866 Rockaway Township)

| Item | What exists | Where | Format | Judgment |
|---|---|---|---|---|
| Official ballot content | State: official general-election candidate lists for U.S. Senate/House (updated 07/27/26), certification of nominees, timelines. County: full candidate list, school candidate list, ballot-position drawing | nj.gov/state/elections/election-information-2026.shtml; morriscountyclerk.org/Elections/Current-Election-Candidates → `2026-general-candidates-080726.pdf`, `2026-general-school-candidates-072826b.pdf`, `2026-general-candidate-order-081026.pdf` | All PDF | County clerk PDF is surprisingly rich (contest, term, vote-for-N, ward/district, party, slogan, address, **email**) but column-aligned PDF text — parseable only with effort |
| Sample ballot | Per-municipality sample ballots posted for every election; general-election set will follow; mailed to voters on/before Oct 21, 2026 (N.J.S.A. 19:14-25) | morriscountyclerk.org/Elections/Sample-Ballots (verified: per-municipality PDFs posted for each 2026 election to date) | PDF per municipality (per ward where applicable) | County-curated; reliable practice, no feed |
| Offices on this ballot (07866) | **U.S. Senate** (Booker seat — R, D, and independents filed); **U.S. House NJ-11**; **1 Morris County Commissioner** (3-yr seat); **Rockaway Twp Board of Education** (3 seats + 1 unexpired) and **Morris Hills Regional BOE** | Verified directly in the county clerk's 2026 general candidates + school candidates PDFs | — | **Not on this ballot:** NJ Legislature (odd-year cycle — Assembly 2025, Senate 2027); **Rockaway Township mayor/council (odd-year municipal cycle — zero Rockaway Twp municipal contests in the filed-candidates PDF)**; no county constitutional officers this cycle. Note: *other* Morris municipalities DO have Nov 2026 mayor/council/committee races — even-year vs odd-year municipal elections is per-municipality in NJ, not per-county |
| Measures & official analysis | No statewide public question identified for Nov 2026; constitutional-amendment submission deadline was Aug 3, 2026 — whether anything was placed is **UNVERIFIED** (check NJ DOE when ballot certifies). Local non-binding questions (deadline Aug 7) and school questions (Aug 21) possible. **NJ has no publicity-pamphlet equivalent**: statewide questions carry only a ballot-printed *interpretive statement*; the sample ballot mailing is the official voter document | nj.gov/state/elections (timeline PDF for deadlines) | PDF/ballot text | Absence of an AZ-style analysis document is a real gap — plain-language measure explanation would be your own product's work, cited to the question text + interpretive statement |
| Candidate filings | State DOE lists (federal/statewide) + county clerk lists (county/municipal/school) — filing is split by level | nj.gov/state/elections/election-information-2026.shtml; morriscountyclerk.org | PDF | **ELEC** (elec.nj.gov): searchable campaign-finance database **with bulk download** — contributions/expense data and pay-to-play quick downloads in **CSV/Excel** (verified: elec.nj.gov/publicinformation/searchdatabase.htm, /pay2play/quickdownload.html) — the best machine-readable NJ source |
| Machine-readability | Candidate/ballot content: PDF only, at both state and county level. Campaign finance: CSV via ELEC | — | — | Curation required for ballot content; ELEC usable as a feed |

### Merrimack County, NH (03255 Newbury)

| Item | What exists | Where | Format | Judgment |
|---|---|---|---|---|
| Official ballot content | The **SoS is the ballot authority** for state elections (counties play no ballot role — NH county clerks don't run elections). 2026 Election Details page publishes: Cumulative Filings, Declarations of Intent, Withdrawals, ballot name-order and party-column rotation | sos.nh.gov/2026-election-details (files: `cumulative-filings-7.16.26.pdf`, `declarations-of-intent-list-2026.pdf`, `withdrawals-2026.pdf`, plus 2026–2028 rotation/order PDFs on mm.nh.gov) | **All PDF** | State-curated PDFs; per-day "town reports" during filing show how manual the pipeline is |
| Sample ballot | SoS posts per-town sample ballots for state elections closer to the election; towns repost them | sos.nh.gov (search "State Sample Ballots"); town sites | PDF | 2026 posting timing **UNVERIFIED** (not yet up in August; primary is Sep 8) |
| Offices on this ballot (03255) | **Governor** (2-yr term — up every even year); **U.S. Senate** (Shaheen seat; her retirement is secondary-source); **U.S. House NH-2**; **Executive Council** (Newbury's district — likely 2 — **UNVERIFIED**); **State Senate District 7** (Newbury listed in D7 with Bradford, Sutton, Warner, etc.; incumbent Innis — via Citizens Count, secondary); **State Representative, Merrimack County District 7** (Newbury + New London — secondary; whether a floterial district overlays it is **UNVERIFIED**); **county officers** — sheriff, county attorney, treasurer, register of deeds, register of probate, commissioners ("County Office" is confirmed as a 2026 filing category on the SoS filing page) | sos.nh.gov/2026-election-details (filing categories); citizenscount.org (districts) | — | **Not on this ballot:** all Newbury town offices and school district — elected at **March town meeting** (next: March 10, 2026, already past; per SoS 2026–2027 political calendar). November ballot is purely federal/state/county |
| Measures & official analysis | **No statewide measures certified for Nov 2026** (Ballotpedia, as of Mar 2026 — secondary; the one live candidate, CACR6 "right to compute," was killed Jan 7, 2026 per LegiScan). NH's direct-democracy analog — **warrant articles — happens at March town meeting, not on the November ballot**. When constitutional questions do appear, there is no AZ-style pamphlet; the question text appears on the ballot (2/3 approval required) | gencourt.state.nh.us for CACR status (not fetched — **UNVERIFIED at primary**) | — | Treat NH November measures as usually-empty; the measure workload for NH users is March warrant articles, a different pipeline entirely |
| Candidate filings & finance | Filing period was June 3–12, 2026; cumulative filings PDF is the official candidate list. Campaign finance: **CFS at cfs.sos.nh.gov** — candidates for governor/councilor/senator/rep/county office register and file there; publicly searchable by name, year, office, contribution | sos.nh.gov/2026-election-details; sos.nh.gov/elections/campaign-finance; cfs.sos.nh.gov | Filings PDF; CFS is a web app — CSV export **UNVERIFIED** | Candidate websites are not collected by the state; you'd source those yourself |

## PART C — National ballot sources

**Democracy Works Elections API** (democracy.works/elections-api, data.democracy.works, docs at developers.democracy.works/api/v2). Machine-readable: yes — REST + JSON. Content: election dates/deadlines (registration, VBM request/return, early-voting windows), polling/early-vote/drop-box locations, voter-ID rules, official URLs, local election office contacts, and **ballot information — contests, candidates, and measures**. Coverage: "federal, state, county, municipal, sub-municipal, and school board elections for jurisdictions over 5,000 people" — so it genuinely reaches sub-municipal, but small towns (Newbury, pop. ~2,200, and many NH towns) fall under the 5,000 floor; expect gaps exactly where your NH map pins live. Source citations with collection/review timestamps are included (aligns with your provenance requirements). Licensing/cost: no public price list; access via pricing-request form (data.democracy.works/request-pricing). Commercial licensing clearly exists — TikTok, Perplexity, and Nextdoor are named partners. Matches your CLAUDE.md's "licensed, contact" entry.

**CTCL Ballot Information Project (BIP)** (techandciviclife.org/our-work/research-department/our-data/ballot-information/). Content: nationwide candidate dataset (names, party, contact, websites, social media) sourced from state/local election officials, standardized, QA'd, plus measures for generals. Channels: (1) **Google Civic Information API** — the public path; (2) **CTCL's own API** — JSON, queryable by address + election, modeled on `voterInfoQuery`; (3) **XML or tab-delimited .txt files**. Access is by request form; the page states no eligibility terms. CTCL's own 2022 write-up describes granting access to "mission-aligned nonpartisan organizations… for charitable and educational purposes" on a sliding scale — whether a for-profit data-selling product qualifies for direct CTCL access is **UNVERIFIED and doubtful**; the realistic commercial channel is Google Civic.

**Google Civic Information API** (developers.google.com/civic-information). The **elections endpoints (`elections`, `voterInfoQuery`) remain live** — only the Representatives endpoint was turned down (April 2025). Free; 25,000 queries/day default, more by request; serves "official data published and verified directly by a state or local election official along with data collected from official sources by trusted third party partners" (i.e., VIP + BIP). Caveat for your architecture: it answers per-address at query time; it is not a bulk feed, and ballot data appears per supported election window — you cannot pre-ingest a national ballot corpus from it. Terms are the standard Google APIs ToS; caching/retention restrictions **UNVERIFIED** in this session — read the ToS before designing storage around it.

**VIP — Voting Information Project** (votinginfoproject.org, github.com/votinginfoproject/vip-specification). The **spec is fully public**: XML (XSD), versions 3.0/5.1.2/5.2 through 6.0, docs at vip-specification.readthedocs.io. It's the natural interchange shape for polling places/contests if you build your own feed. However, the **state-submitted feeds themselves are not published as public raw downloads** — they flow to voters via Google Civic and partner tools. Public raw state feeds: **UNVERIFIED/negative** as a general rule.

## PART D — Can one ballot-record shape cover AZ, NJ, NH?

**Mostly yes at the spine, with four honest strain points.** A record of *election → ballot-style area (OCD-ID set) → contest → (candidacy | measure)* with vote-for-N on every contest covers perhaps 90% of what these three states do. VIP's model proves this shape works nationally. Where it strains:

1. **Measures are three different species.** AZ: numbered statewide Propositions with a full official apparatus — AG-approved ballot language, Legislative Council impartial analysis, pro/con arguments, a mailed Publicity Pamphlet. Your provision-decomposition model feeds well here. NJ: statewide Public Questions carry only a legislature-drafted interpretive statement printed on the ballot, plus county/municipal non-binding questions and school questions — thin official artifacts. NH: the November ballot almost never carries measures (none certified for 2026); the real NH measure activity is **March town-meeting warrant articles**, which aren't on the state ballot at all and are published town-by-town. A schema that assumes "measures live on the November ballot" silently models NH as measure-free while missing its richest civic content. Model measure *artifacts* (analysis, arguments, interpretive statement) as an open set of typed, sourced documents, not fixed columns.

2. **Contest types beyond candidate-vs-candidate.** AZ **judicial retention** is a yes/no vote on a sitting judge — not a candidacy race, not a measure; it needs its own contest type (and Pima's merit-selection judges make it a real 2026 need). AZ 2026 also debuts the **Governor + Lt. Governor joint ticket** (one contest, two persons). NH has **multi-member House districts** (vote-for-N is mandatory, not an edge case) and **floterial districts** — an extra House district *overlaying* several base districts, so one address maps to two simultaneous state-rep contests for the same chamber. Any schema assuming one district per (chamber, address) breaks in NH. (Whether Newbury's own district carries a floterial in 2026 is UNVERIFIED, but the pattern is statewide.)

3. **Ballot mechanics as data.** NJ ballots have drawn ballot positions, slogans, bracketing, and party-column history; the county clerk's candidate file carries slogan and ballot-position as first-class fields. NH rotates name order and party columns by statute (published as separate PDFs). AZ rotates too. If you ever render "as the voter will see it," position/rotation/slogan need somewhere to live; if you never render ballot order (safer, given your no-ranking rule), you can drop this — deliberately.

4. **Election calendars diverge more than ballots do.** NJ ran five county election dates in 2026 before November (special primary Feb 5, special school Jan/Mar/Sep, special general Apr 16, primary Jun 2, May non-partisan municipal) — "the election" must be first-class, plural, and typed. NH's civic year centers on March; Tucson's city races are odd-year November. Also: whether a municipality elects in even Novembers is **per-municipality** in NJ (Rockaway Twp: no in 2026; Dover, Boonton, and a dozen others: yes) — this must be data, never an assumption. Finally, term lengths (NJ commissioners 3-yr staggered, NH everything 2-yr, AZ 4-yr) mean "next election for this office" must be computed from records, not inferred from office type.

**Sourcing posture that falls out of Part B:** none of the three publish ballot content machine-readably — AZ is HTML-portal + PDF, NJ is PDF at state and county, NH is PDF only. The only true feeds adjacent to this are campaign finance (NJ ELEC CSV verified; AZ seethemoney and NH CFS export capability UNVERIFIED). So for these four zips, ballot content is a curation problem per jurisdiction, with Democracy Works (licensed) or Google Civic/BIP (query-time, free) as the only shortcuts — and NH's small towns likely under Democracy Works' 5,000-population floor.
---

# The candidate corpus — design notes (item 9, research only)

The reader must be able to ask "has this person said anything about data
centers?" and get an answer they can verify. What follows is the recorded
design; none of it is built.

## Two corpora, never merged

A statement and a vote are different kinds of fact, and collapsing them is
the composite-score failure wearing a new coat.

- **Statements** — from the candidate's or officeholder's own site, their
  official filings, and their own published material. Per D05: never an
  advocacy organization, never an endorsement site, never a news
  characterization of what they said.
- **Votes** — roll calls. Federal from D02's sources, state from D03's,
  local from D04 — the acknowledged real gap, because council votes sit in
  unstructured minutes. The `agenda_documents` store built this session is
  where local votes eventually come from.

## The answer format: quote and link. Never characterize.

An answer is a set of matched passages, each rendered verbatim and short,
each with the source URL and the retrieval date. No synthesis sentence sits
on top. A count and a neutral frame — "3 passages matched on their campaign
site" — is a fact and is allowed. "They support data centers" is an
editorial act attributed to a real person and is forbidden. Store the full
retrieved text for retrieval; never render more than a short passage —
campaign sites are copyrighted, and quote-with-attribution-and-link is both
the honest and the defensible form.

## Three answers, and conflating any two is the failure

The NOT_ATTEMPTED / NO_SOURCE_FOUND distinction again, with political
consequences — "this candidate has said nothing about X" is itself a
damaging claim.

1. **Matched.** The passages, with links and dates.
2. **Searched, nothing matched.** With the denominator: which sources we
   hold for this person and when each was last retrieved. "Nothing matching
   in their campaign site as retrieved 2026-09-14, or in 47 recorded floor
   votes."
3. **Nothing collected for this person yet.** Say exactly that, and link
   their own site.

An answer always carries its corpus scope. Without the denominator, 2 and 3
read identically, and both read as findings about the candidate rather than
about our coverage.

## Snapshots, because sites change

`contentHash` and `retrievedAt` on every document, appended never
overwritten — exactly as `lib/meetings/agenda-documents.ts` works, and that
store is the pattern to transcribe. A position that appeared on a campaign
site in September and vanished in October is the accountability half of this
product, and it only exists if prior versions were kept.

## A07 applies in full

Answers come only from retrieved text. No inference from party label, no
reasoning from what candidates of that type usually think, no filling a gap
from a similar candidate elsewhere. The refusals are written as tests, not
prompt text — `tests/neutrality-guards.test.ts` already guards the record
shapes (no score/rank/match key on any candidate or measure record), and
`partyLabel` stays display-only exactly as the officeholder tests pin.
