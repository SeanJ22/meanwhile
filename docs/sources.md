# Sources — the register

**Created 2026-08-20 (Prompt C item 9).** This is the live register that
`CLAUDE.md`'s External-sources section points at. The constitution carries the
LAW about sources; this carries the FACTS, which change.

Every row states: **status** (wired / evaluated / not in use), the **auth
mechanism**, and the **licence obligations**. A licence obligation is law, not a
note — where a source's terms require attribution, the attribution ships with
the data it describes.

---

## The credentials, enumerated

`.env.local` holds **15 keys**, enumerated 2026-08-20 by reading the file
rather than by inferring from the code. That direction matters: Prompt B swept
the tracked tree for `DATA_GOV_API_KEY`, found nothing, and reported that the
key does not exist. `.env.local` is gitignored, so the sweep could not have
found it, and the key is on line 57. RULING 21 corrects that report; `PB13` is
corrected in place.

**The point of the enumeration is the reverse lookup.** A key the author has
forgotten about is exactly what a code-first sweep cannot surface, because a
key nothing reads leaves no trace in the code.

| # | Key | Reads it | Status |
|---|---|---|---|
| 1 | `NEXT_PUBLIC_MAPTILER_KEY` | `lib/map/style.ts`, `components/map/map-entry.tsx` | **WIRED** |
| 2 | `NEXT_PUBLIC_MAPTILER_STYLE` | `lib/map/style.ts` | **WIRED** |
| 3 | `NEXT_PUBLIC_MAPTILER_STYLE_LIGHT` | `lib/map/style.ts` | **WIRED** |
| 4 | `DATABASE_URL` | the whole app, via `lib/db/index.ts` | **WIRED** |
| 5 | `WTP_DB_ROLE` | `lib/db/write-guard.ts`, `/api/build` | **WIRED** |
| 6 | `WTP_PRODUCTION_DATABASE_URL_WRITE` | `lib/db/write-handle.ts`, `pnpm db:apply` | **WIRED** |
| 7 | `WTP_PRODUCTION_DATABASE_URL_READONLY` | `scripts/walk-all.mts`, the census scripts | **WIRED** |
| 8 | `CONGRESS_API_KEY` | `scripts/fetch-votes.mts`, `scripts/fetch-law-votes.mts` | **WIRED** |
| 9 | `FEC_API_KEY` | `scripts/fetch-fec.mts`, `refresh-fec-snapshot.yml` | **WIRED** |
| 10 | `PLURAL_API_KEY` | `lib/sources/plural/index.ts` | **WIRED** |
| 11 | `LEGISCAN_API_KEY` | `scripts/fetch-legiscan.mts`, `refresh-legiscan-snapshot.yml` | **WIRED** |
| 12 | `ANTHROPIC_API_KEY` | `lib/routing/classifier.ts` | **WIRED** |
| 13 | `CENSUS_API_KEY` | **nothing** | **NOT IN USE** — row `SRC01` |
| 14 | `LDA_API_KEY` | **nothing** | **NOT IN USE** — row `SRC02` (`PB12` is the client) |
| 15 | `DATA_GOV_API_KEY` | **nothing** — named only in `PB13`'s own prose | **NOT IN USE** — row `SRC03` |

**Three keys are held and unread.** Each has a tracker row saying what it would
be for, because a credential with no row is a credential nobody decides about.

---

---

## The credentials, RE-MEASURED AND CALLED — 2026-08-22 (NJ Hunt 5)

**The 2026-08-20 enumeration above asked which files READ each key. This one
asks what happens when each key is CALLED**, which is a different question and
the one RULING 90 item 5 makes mandatory: *every authenticated resource is walked
before any unauthenticated one is exhausted, and a key sitting unused while a
session hits a public rate limit is a defect.*

The reader status was re-confirmed by sweeping the tree with
`git grep -a --untracked` — not ripgrep, because a NUL byte and a hidden path
each make ripgrep report nothing found without having looked. The register above
was accurate. What it could not tell anyone is whether the credentials work.

`pnpm keys:walk` is the instrument. It writes `data/hunt/api-keys-walk.json`.

| Key | Read by | Called 2026-08-22 | What it returned | Owed fields closed |
|---|---|---|---|---:|
| `CONGRESS_API_KEY` | `scripts/fetch-votes.mts`, `scripts/fetch-law-votes.mts` — **WIRED** | HTTP 200 | **18 sitting members** across NJ and NH, each with the chamber's own portrait URL, its attribution, and a specific verified page on congress.gov | **36** |
| `FEC_API_KEY` | `scripts/fetch-fec.mts`, `refresh-fec-snapshot.yml` — **WIRED** | HTTP 200 | **77 federal candidates**; their committee records carry treasurer name, street, city, zip and designated-agent phone | **22** |
| `PLURAL_API_KEY` | `lib/sources/plural/index.ts` — **WIRED** | not needed | The **committed BULK file** `data/reference/openstates_legislators.csv` holds 7,976 state legislators with official emails; **61** of them serve these two zips. No API call, no quota spent. | **61** |
| `LEGISCAN_API_KEY` | `scripts/fetch-legiscan.mts`, `refresh-legiscan-snapshot.yml` — **WIRED**, daily | not re-walked | Bills and roll calls. Closes no Kelly field about a person; it is a positions source. | 0 |
| `DATA_GOV_API_KEY` | **nothing** — `SRC03` | HTTP 200 | **42 govinfo collections.** The `CDIR` collection is the Congressional Directory and carries member offices, phones and staff — a real contact route, and the reason this key is worth keeping. | 0 |
| `CENSUS_API_KEY` | **nothing** — `SRC01` | **HTTP 302, `X-DataWebAPI-KeyError: 1`** | **THE KEY IS INVALID.** The host redirects to `invalid_key.html`. A call with NO key redirects to `missing_key.html`, so the API cannot be reached at all until the credential is replaced. `NS06`. | 0 |
| `LDA_API_KEY` | **nothing** — `SRC02` | HTTP 200 | The API answers, and it closes **nothing** at either zip. Stated plainly rather than softened: the LDA database is FEDERAL lobbying only — registrants, clients, and the House and Senate offices they lobby. It has no county, municipal or school-district layer. Where it would earn its place is a later who-is-lobbying-my-delegation surface, which is not a hunt question. | 0 |

**119 owed fields closed from credentials alone, in one run.** Every one of them
was available while the previous session was measuring how fast a free search
engine would rate-limit it. That is the defect RULING 90 item 5 names, and this
table is the measurement behind it.

### Two traps that each produced a FALSE ZERO first

- **The FEC candidate LIST endpoint carries no address.** `/v1/candidates/`
  returns 24 fields and every one of them is identity or status — no street, no
  phone, no agent. The contact is on `/v1/committees/`. The first run reported
  *137 federal candidates, 0 fields closed*, which was true and useless.
- **Following a redirect blindly hides an invalid credential.** The Census API
  answers a bad key with `302` + a header naming the problem + a `Location`
  pointing at an HTML error page. Follow it and you get HTTP 200 and a page of
  HTML, which parses as **zero rows**. A zero-row extraction reported as an empty
  result is the failure the constitution names five separate times, and here it
  would have hidden a dead credential behind a shrug about ZCTA geography.

### Routes added to the manifest from this walk

`congress-api`, `fec-committee-contact`, `openstates-bulk`, `govinfo-cdir`,
`census-acs-api` and `lda-filings` — all **Tier A** under RULING 84, all
recorded with what they actually return, including the two that return nothing
useful. A credential with no route is a credential nobody decides about.

---

## THE KEYLESS SOURCES — recorded because a source walked and never recorded is one the next session re-derives

**Added 2026-08-22 (NJ Hunt 6), the author's instruction.** The register above
enumerates CREDENTIALS. That left every keyless public route — which is most of
what this product actually reads — recorded nowhere, so each new session
rediscovered it. **`docs/sources.md` is the source of record for what resources
exist**, keyed or not, and `CLAUDE.md` now says so.

Every row carries its **status**, **access method**, **licence status** and the
**tier** it sits at under RULING 84. Each is also a ROUTE in
`docs/branch-manifest.md`: this file answers *what exists and what may we use*,
the manifest answers *what do we walk and in what order*.

| Source | Access | Licence | Tier | Status |
|---|---|---|---|---|
| **USA.gov** — `usa.gov/elected-officials`, `/local-governments`, `/state-election-office`, `/state-governor`, `/agency-index`, `/states/{state}` | plain GET, no key, no rate wall observed | **US government work — public domain.** No attribution obligation, no terms to accept | **A** | **WIRED** — `pnpm tier:directory`. RULING 93's federal tier. 7 routes, all answering, 227 entities |
| **State of New Jersey local-government directory** — `nj.gov/nj/gov/county/localgov.shtml` | plain GET, no key | **US state government work — public domain** | **A** | **WIRED** — `pnpm tier:directory --route nj-localgov`. **624 entities: all 21 counties and all 564 municipalities with their official websites.** Note the live URL: `/nj/gov/county/` answers HTTP 200 with a "Page not found" body |
| **Wikipedia** — municipality and election articles | `en.wikipedia.org/w/api.php`, no key, identified User-Agent, spaced 400 ms | **CC BY-SA.** Facts — names, parties, term dates, districts — are **not copyrightable** and are what is extracted; the prose is never copied. RULING 87 | **A** | **WIRED** — `pnpm wiki:muni`, `pnpm wiki:graph`. **DISCOVERY ONLY, never a source of record** |
| **Each body's own website** — municipal, county, district | plain GET, identified User-Agent, spaced 700 ms, ceiling on pages per site | Public records published by the body. The public-records rule governs | **B** | **WIRED** — `pnpm roster:hunt`. The route that carries phone and email where the encyclopedia carries neither |
| **FEC Combined Federal/State Disclosure Directory** | committed at `data/reference/fec_combined_federal_state_disclosure_directory.csv`; re-fetch with `pnpm fec:directories` | **US federal government work — public domain** | **A** | **WIRED.** 349 offices across 56 jurisdictions with records-held, URL, email and phone |
| **2022 Census of Governments** | committed at `data/reference/census_govt_units_2022.csv` | **US federal government work — public domain** | **A** | **WIRED.** The OFFICIAL UNIVERSE every coverage claim is measured against |
| **NCES CCD LEA directory** | committed at `data/reference/nces_ccd_lea_directory_2025_26.csv` | **US federal government work — public domain** | **A** | **WIRED.** The official universe for school districts |
| **Open States bulk legislators** | committed at `data/reference/openstates_legislators.csv` | **CC-0** | **A** | **WIRED.** 7,976 state legislators with official emails; no quota spent |
| **Legislative caucus sites** — e.g. `assemblydems.com`, senate/assembly Republican caucus sites | plain GET, no key | **Party organisation sites, NOT government publications.** Usable for a member's own published contact and photo under the campaign-site and photo doors; never as a source of record for a position | **B** | **EVALUATED** — reached via `websiteUrl` on Open States rows |
| **usmayors.org** (US Conference of Mayors) | plain GET, no key | **NONPROFIT — not a government body.** RULING 70's Ballotpedia question applies; **not** public domain | **A (discovery)** | **RECORDED, NOT WALKED AS A SOURCE OF RECORD.** Discovery surface only, by the author's instruction, NJ Hunt 6 |
| **api.gsa.gov site-scanning** | `DATA_GOV_API_KEY` | **US federal government work — public domain** | **A** | **EVALUATED, WRONG TIER.** The key answers HTTP 200 with data, but the corpus is FEDERAL executive-branch sites only and its `agency` filter is ignored — it returned `va.gov` for `agency=New Jersey`. It does not reach municipal domains |
| **api.usa.gov contacts v1** | `DATA_GOV_API_KEY` | — | — | **DEAD.** HTTP 404 `NOT_FOUND` on 2026-08-22. Recorded as dead rather than deleted, per the External-sources law |

### The Census key, re-measured 2026-08-22 (NJ Hunt 6)

NJ Hunt 5 found `CENSUS_API_KEY` invalid. The author issued a **new key** and
uploaded it. **It was called, and it is also refused.**

| | |
|---|---|
| New key present in `.env.local` | yes — 40 hex characters, well-formed |
| `api.census.gov/data/2023/acs/acs5` **with** the key | HTTP 200 whose body is `<title>Invalid Key</title>` |
| The same endpoint **with no key at all** | HTTP 200 whose body is `<title>Missing Key</title>` |
| `api.census.gov/.../variables/B01003_001E.json` (needs no key) | HTTP 200 **with real data** |

**The endpoint is reachable and the request is well-formed** — the keyless
variables call proves both. The credential is the thing being refused. Census
API keys require **activation via a link the Census emails**, and an unactivated
key presents exactly this way. `NS06` stays OPEN with this measurement on it.

**Note the shape change since NJ Hunt 5**: the host used to answer `302` with
`X-DataWebAPI-KeyError: 1`. It now answers **200 with an HTML error page and no
such header**. A check written against the status code or that header would now
read this dead credential as healthy — which is why the control is *did the body
parse as data*, never *did the call succeed*.

## Wired sources

### Congress.gov — federal bills, members, House roll calls
- **Status:** WIRED. `scripts/fetch-votes.mts`, `scripts/fetch-law-votes.mts`,
  `lib/sources/congress/`.
- **Auth:** `CONGRESS_API_KEY`. **Not** `DATA_GOV_API_KEY` — api.data.gov issues
  one key that fronts several agency APIs, which makes the assumption
  reasonable and simply not true of this repo.
- **Licence:** US federal government work. Public domain.

### clerk.house.gov / senate.gov — authoritative roll-call XML
- **Status:** WIRED, no key.
- **Licence:** public domain. **Never credited to a vendor.**
  `tests/legiscan.test.ts` asserts a federal member's payload carries no
  LegiScan attribution, because the chambers' XML is not LegiScan's data.

### unitedstates/congress-legislators — the federal directory
- **Status:** WIRED as a source of record for what it covers.
  `data/congress-legislators/`, SHA-pinned.
- **Auth:** none.
- **Licence:** CC0 / public domain.

### LegiScan — state bills and roll calls
- **Status:** WIRED. `scripts/fetch-legiscan.mts`, weekly Sunday refresh,
  `dataset_hash`-gated so an unchanged dataset is never re-downloaded.
- **Auth:** `LEGISCAN_API_KEY`.
- **Licence obligation — LAW, not a note: CC BY 4.0 requires attribution
  wherever the data appears.** `LEGISCAN_ATTRIBUTION` is one object, sent with
  the rows by the API so it cannot drift from the store it describes, and
  rendered under the Recent votes heading. Never touch the legiscan.com front
  end.

### Plural Open (ex-Open States) — state legislators
- **Status:** WIRED. `lib/sources/plural/`.
- **Auth:** `PLURAL_API_KEY` via open.pluralpolicy.com.
- **Licence:** the bulk CSV this repo reads is CC0.

### OpenFEC — federal contributions and independent expenditures
- **Status:** WIRED for committee TOTALS only. `scripts/fetch-fec.mts`,
  `refresh-fec-snapshot.yml`.
- **Auth:** `FEC_API_KEY`.
- **Licence obligation — and it is a legal question, not a licence:** the FEC
  places a **sale-or-use restriction on contributor data**, and in-kind
  contribution handling carries its own risk. Anything beyond committee totals
  is **blocked on election-law counsel review** — see `PB10`. The display path
  is ripcorded (`ripcord.fecContributorDisplay`,
  `ripcord.fundingReactionsInAggregates`).

### Census TIGER/Line, ZCTA and the Census of Governments
- **Status:** WIRED, and the denominator behind every coverage claim.
  `data/reference/census_govt_units_2022.csv`, the national cartographic
  boundary files, `scripts/resolve-census-territory.mts`.
- **Auth:** none for the boundary and workbook files. `CENSUS_API_KEY` is held
  for the **API**, which nothing reads (`SRC01`).
- **Licence:** US federal government work. Public domain.
- **RULING 10:** a ZCTA is not a ZIP code. State the mapping method; never
  present a ZCTA-derived answer as a ZIP-code answer without saying so.

### NCES Common Core of Data — school districts
- **Status:** WIRED as reference data.
  `data/reference/nces_ccd_lea_directory_2025_26.csv`, 19,711 LEA records.
- **Auth:** none.
- **Licence:** US federal government work. Public domain.

### CISA `.gov` registry (cisagov/dotgov-data)
- **Status:** WIRED. `data/dotgov/snapshot.json`, SHA-pinned,
  `pnpm dotgov:fetch`.
- **Auth:** none.
- **Licence:** US federal government work.
- It is **a rung, never a denominator** — see `docs/zip-playbook.md`.

### Anthropic API — the ask-box classifier
- **Status:** WIRED. `lib/routing/classifier.ts`.
- **Auth:** `ANTHROPIC_API_KEY`.
- **Constraint:** nothing it produces is a reader-facing claim. Routing only.
  No candidate position, no summary, no blurb is generated — `CLAUDE.md`'s
  never-generate rule binds here exactly as everywhere else.

### MapTiler — vector tiles
- **Status:** WIRED. Not Google Maps.
- **Auth:** `NEXT_PUBLIC_MAPTILER_KEY` (public by design — it is a tile key).

### The agenda vendors — Legistar, OnBase, NovusAgenda, Diligent/BoardDocs, iCompass/CivicWeb, Apptegy, BoardBook, IQM2, Revize, CivicPlus, clerksboards
- **Status:** WIRED as adapters under `lib/sources/<name>/`. One directory per
  source; adding a source never edits shared ingestion logic.
- **Auth:** none. Every one of these serves public records a public body is
  obliged to publish.
- **Licence:** the records are the BODY's. A vendor hosting them acquires no
  rights over them, and a vendor's website terms are not a mechanism by which a
  public body can narrow statutory access to its own records. The four limits in
  `CLAUDE.md` bind every fetch: never authenticate or circumvent an access
  control, never accept clickwrap and then violate it, never request at a rate
  that degrades service, never retrieve anything not already published.
- **BoardDocs `robots.txt` disallows crawling `go.boarddocs.com`** and we honour
  it. The compliant route to the same result is crawling district homepages
  seeded from the NCES CCD website column and fingerprinting outbound links —
  recorded on `D70`, the enumeration-crawler row.

---

## Evaluated, not wired

### Google Civic — Divisions
- **Status:** EVALUATED. Address → OCD-ID.
- **The Representatives endpoint SHUT DOWN in April 2025.** Any code or doc
  referencing it is dead. Recorded rather than deleted, so the next session does
  not rediscover it.

### Democracy Works Elections
- **Status:** EVALUATED. Elections and ballots to sub-municipal level.
- **Auth:** licensed, contact required. An ask-before.

### Vote Smart — candidate questionnaires
- **Status:** EVALUATED. API key required.

### GovTrack
- **Status:** EVALUATED, and possibly discontinued in summer 2026. **Verify
  before adding any dependency on it.**

### Polarization Research Lab
- **Status:** EVALUATED — `D62`, the author's find. `lib/sources/prl/` exists;
  the build brief has not been settled.

---

## Not in use — the three held keys

### `CENSUS_API_KEY` — `SRC01`
The Census **API**, as distinct from the bulk files this repo already reads. It
would answer per-zip demography and geography questions the committed files
cannot. Nothing reads it today.

### `LDA_API_KEY` — `SRC02`
Lobbying Disclosure Act filings. `PB12` is the client row; this is the
credential. Nothing reads it today, and `PB12` records that this source is
currently fetching NOTHING.

### `DATA_GOV_API_KEY` — `SRC03`
api.data.gov's umbrella key, which fronts OpenFEC and govinfo among others.
This repo's FEC path holds its own key against the same upstream and the
govinfo collections are not fetched at all. Held, unread. **RULING 21 records
that this key exists**, correcting Prompt B's report that it does not.

---

## Never a source

**Advocacy organizations, PACs, and endorsement sites are not sources.** Go to
the underlying government filing. An endorsement list is somebody else's
judgement about a candidate, and this product does not carry judgements about
candidates.

## Adding a source

It is an **ask-before**, listed in `CLAUDE.md`. A new source is a standing
commitment to a third party, and at least one of them is a legal question
wearing an API key.
