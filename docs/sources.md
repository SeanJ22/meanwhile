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

**The `Last walked` column on this table is the CREDENTIAL LEDGER's date, not this file's.** Every one of these fifteen was CALLED again on **2026-08-23** by `pnpm credentials` — **14 proven, 1 failed** — and `docs/credential-ledger.md` carries what each returned. A date here that disagreed with the ledger would be this file guessing about a measurement the ledger actually made.

| # | Key | Reads it | Status | Last walked |
|---|---|---|---|---|
| 1 | `NEXT_PUBLIC_MAPTILER_KEY` | `lib/map/style.ts`, `components/map/map-entry.tsx` | **WIRED** | 2026-08-23 |
| 2 | `NEXT_PUBLIC_MAPTILER_STYLE` | `lib/map/style.ts` | **WIRED** | 2026-08-23 |
| 3 | `NEXT_PUBLIC_MAPTILER_STYLE_LIGHT` | `lib/map/style.ts` | **WIRED** | 2026-08-23 |
| 4 | `DATABASE_URL` | the whole app, via `lib/db/index.ts` | **WIRED** | 2026-08-23 |
| 5 | `WTP_DB_ROLE` | `lib/db/write-guard.ts`, `/api/build` | **WIRED** | 2026-08-23 |
| 6 | `WTP_PRODUCTION_DATABASE_URL_WRITE` | `lib/db/write-handle.ts`, `pnpm db:apply` | **WIRED** | 2026-08-23 |
| 7 | `WTP_PRODUCTION_DATABASE_URL_READONLY` | `scripts/walk-all.mts`, the census scripts | **WIRED** | 2026-08-23 |
| 8 | `CONGRESS_API_KEY` | `scripts/fetch-votes.mts`, `scripts/fetch-law-votes.mts` | **WIRED** | 2026-08-23 |
| 9 | `FEC_API_KEY` | `scripts/fetch-fec.mts`, `refresh-fec-snapshot.yml` | **WIRED** | 2026-08-23 |
| 10 | `PLURAL_API_KEY` | `lib/sources/plural/index.ts` | **WIRED** | 2026-08-23 |
| 11 | `LEGISCAN_API_KEY` | `scripts/fetch-legiscan.mts`, `refresh-legiscan-snapshot.yml` | **WIRED** | 2026-08-23 |
| 12 | `ANTHROPIC_API_KEY` | `lib/routing/classifier.ts` | **WIRED** | 2026-08-23 |
| 13 | `CENSUS_API_KEY` | **nothing** | **NOT IN USE** — row `SRC01` | 2026-08-23 |
| 14 | `LDA_API_KEY` | **nothing** | **NOT IN USE** — row `SRC02` (`PB12` is the client) | 2026-08-23 |
| 15 | `DATA_GOV_API_KEY` | **nothing** — named only in `PB13`'s own prose | **NOT IN USE** — row `SRC03` | 2026-08-23 |

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

| Key | Read by | Called 2026-08-22 | What it returned | Owed fields closed | Last walked |
|---|---|---|---|---:|---|
| `CONGRESS_API_KEY` | `scripts/fetch-votes.mts`, `scripts/fetch-law-votes.mts` — **WIRED** | HTTP 200 | **18 sitting members** across NJ and NH, each with the chamber's own portrait URL, its attribution, and a specific verified page on congress.gov | **36** | 2026-08-22 |
| `FEC_API_KEY` | `scripts/fetch-fec.mts`, `refresh-fec-snapshot.yml` — **WIRED** | HTTP 200 | **77 federal candidates**; their committee records carry treasurer name, street, city, zip and designated-agent phone | **22** | 2026-08-22 |
| `PLURAL_API_KEY` | `lib/sources/plural/index.ts` — **WIRED** | not needed | The **committed BULK file** `data/reference/openstates_legislators.csv` holds 7,976 state legislators with official emails; **61** of them serve these two zips. No API call, no quota spent. | **61** | 2026-08-22 |
| `LEGISCAN_API_KEY` | `scripts/fetch-legiscan.mts`, `refresh-legiscan-snapshot.yml` — **WIRED**, daily | not re-walked | Bills and roll calls. Closes no Kelly field about a person; it is a positions source. | 0 | 2026-08-22 |
| `DATA_GOV_API_KEY` | **nothing** — `SRC03` | HTTP 200 | **42 govinfo collections.** The `CDIR` collection is the Congressional Directory and carries member offices, phones and staff — a real contact route, and the reason this key is worth keeping. | 0 | 2026-08-22 |
| `CENSUS_API_KEY` | **nothing** — `SRC01` | **HTTP 302, `X-DataWebAPI-KeyError: 1`** | **THE KEY IS INVALID.** The host redirects to `invalid_key.html`. A call with NO key redirects to `missing_key.html`, so the API cannot be reached at all until the credential is replaced. `NS06`. | 0 | 2026-08-22 |
| `LDA_API_KEY` | **nothing** — `SRC02` | HTTP 200 | The API answers, and it closes **nothing** at either zip. Stated plainly rather than softened: the LDA database is FEDERAL lobbying only — registrants, clients, and the House and Senate offices they lobby. It has no county, municipal or school-district layer. Where it would earn its place is a later who-is-lobbying-my-delegation surface, which is not a hunt question. | 0 | 2026-08-22 |

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

| Source | Access | Licence | Tier | Status | Last walked |
|---|---|---|---|---|---|
| **USA.gov** — `usa.gov/elected-officials`, `/local-governments`, `/state-election-office`, `/state-governor`, `/agency-index`, `/states/{state}` | plain GET, no key, no rate wall observed | **US government work — public domain.** No attribution obligation, no terms to accept | **A** | **WIRED** — `pnpm tier:directory`. RULING 93's federal tier. 7 routes, all answering, 227 entities. Re-read 2026-08-23 out of the committed walk at `data/hunt/tier-directories.json`, whose `nj-localgov` route carries 624 entities and 592 distinct hosts — that directory is what settled `rockawaytownship.org` and `rockawayborough.org` as OFFICIAL rather than press | 2026-08-23 |
| **State of New Jersey local-government directory** — `nj.gov/nj/gov/county/localgov.shtml` | plain GET, no key | **US state government work — public domain** | **A** | **WIRED** — `pnpm tier:directory --route nj-localgov`. **624 entities: all 21 counties and all 564 municipalities with their official websites.** Note the live URL: `/nj/gov/county/` answers HTTP 200 with a "Page not found" body | 2026-08-22 |
| **Wikipedia** — municipality and election articles | `en.wikipedia.org/w/api.php`, no key, identified User-Agent, spaced 400 ms | **CC BY-SA.** Facts — names, parties, term dates, districts — are **not copyrightable** and are what is extracted; the prose is never copied. RULING 87 | **A** | **WIRED** — `pnpm wiki:muni`, `pnpm wiki:graph`, and **`pnpm wiki:citation` (new 2026-08-23)**, which walks the FOOTNOTE rather than the article. Walked 2026-08-23 against three Morris municipality articles; 9 of 9 parked leads resolved to a branch result. **DISCOVERY ONLY, never a source of record** | 2026-08-23 |
| **Each body's own website** — municipal, county, district | plain GET, identified User-Agent, spaced 700 ms, ceiling on pages per site | Public records published by the body. The public-records rule governs | **B** | **WIRED** — `pnpm roster:hunt`. The route that carries phone and email where the encyclopedia carries neither. Walked 2026-08-23 against `rockawaytownship.org`, `rockawayborough.org` and `denvillenj.gov`, each control-paired; two confirmed a sitting mayor by name and office | 2026-08-23 |
| **FEC Combined Federal/State Disclosure Directory** | committed at `data/reference/fec_combined_federal_state_disclosure_directory.csv`; re-fetch with `pnpm fec:directories` | **US federal government work — public domain** | **A** | **WIRED.** 349 offices across 56 jurisdictions with records-held, URL, email and phone | 2026-08-22 |
| **2022 Census of Governments** | committed at `data/reference/census_govt_units_2022.csv` | **US federal government work — public domain** | **A** | **WIRED.** The OFFICIAL UNIVERSE every coverage claim is measured against | 2026-08-22 |
| **NCES CCD LEA directory** | committed at `data/reference/nces_ccd_lea_directory_2025_26.csv` | **US federal government work — public domain** | **A** | **WIRED.** The official universe for school districts | 2026-08-22 |
| **Open States bulk legislators** | committed at `data/reference/openstates_legislators.csv` | **CC-0** | **A** | **WIRED.** 7,976 state legislators with official emails; no quota spent | 2026-08-22 |
| **Legislative caucus sites — ALL FOUR NAMED**: `assemblydems.com` · `njassemblygop.com` · `njsendems.org` · `senatenj.com` | plain GET, no key | **Party organisation sites, NOT government publications.** Usable for a member's own published contact and photo under the campaign-site and photo doors; never as a source of record for a position | **B** | **WALKED 2026-08-23, all four answered HTTP 200** (170 KB · 101 KB · 110 KB · 1.14 MB). Three of the four hosts had never been written down — the row said `assemblydems.com` and gestured at "senate/assembly Republican caucus sites", so a session walking the all-four-or-none rule had one host and three guesses. **`njsendems.com` does not resolve; the Senate Democrats are on `njsendems.org`**, and `njassemblyrepublicans.com` does not resolve either — the Assembly Republicans are on `njassemblygop.com` | 2026-08-23 |
| **usmayors.org** (US Conference of Mayors) | plain GET, no key | **NONPROFIT — not a government body.** RULING 70's Ballotpedia question applies; **not** public domain | **A (discovery)** | **RECORDED, NOT WALKED AS A SOURCE OF RECORD.** Discovery surface only, by the author's instruction, NJ Hunt 6. Reachability re-measured 2026-08-23: `usmayors.org/mayors/` answers HTTP 200 at 528 KB with the control string present. **Reachability is not permission** and this stays a discovery surface until the author rules | 2026-08-23 |
| **api.gsa.gov site-scanning** | `DATA_GOV_API_KEY` | **US federal government work — public domain** | **A** | **EVALUATED, WRONG TIER.** The key answers HTTP 200 with data, but the corpus is FEDERAL executive-branch sites only and its `agency` filter is ignored — it returned `va.gov` for `agency=New Jersey`. It does not reach municipal domains | 2026-08-22 |
| **api.usa.gov contacts v1** | `DATA_GOV_API_KEY` | — | — | **DEAD.** HTTP 404 `NOT_FOUND` on 2026-08-22. Recorded as dead rather than deleted, per the External-sources law | 2026-08-22 |

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
- **Last walked:** 2026-08-20
- **Status:** WIRED. `scripts/fetch-votes.mts`, `scripts/fetch-law-votes.mts`,
  `lib/sources/congress/`.
- **Auth:** `CONGRESS_API_KEY`. **Not** `DATA_GOV_API_KEY` — api.data.gov issues
  one key that fronts several agency APIs, which makes the assumption
  reasonable and simply not true of this repo.
- **Licence:** US federal government work. Public domain.

### clerk.house.gov / senate.gov — authoritative roll-call XML
- **Last walked:** 2026-08-20
- **Status:** WIRED, no key.
- **Licence:** public domain. **Never credited to a vendor.**
  `tests/legiscan.test.ts` asserts a federal member's payload carries no
  LegiScan attribution, because the chambers' XML is not LegiScan's data.

### unitedstates/congress-legislators — the federal directory
- **Last walked:** 2026-08-23 — read by `corepack pnpm congress:corpus`, which
  performed the clone. (RULING 107: a freshness date is written only by the code
  path that performed the read.)
- **Status:** WIRED as a source of record for what it covers.
  `data/congress-legislators/`, SHA-pinned.
- **Tier:** A (RULING 84) — one fetch answers for all 537 sitting members.
- **Access method:** `git clone --filter=blob:none --no-checkout` over
  `github.com`, read at a pinned commit through `lib/hunt/github-corpus.ts`.
  **This is the road that works where the HTTP one does not** — see the note
  under `unitedstates/images` below, which is the same finding.
- **Auth:** none.
- **Licence:** **CC0 1.0 Universal**, confirmed 2026-08-23 by reading the
  repository's own `LICENSE` file at commit
  `750c0608efb6ef1fc3257ba72c99af3771d35088` — not assumed from the
  organisation name. No attribution obligation.
- **Count assertion (RULING 100):** the file states its own membership by
  carrying one top-level entry per sitting member. Walked 2026-08-23:
  **stated 537, extracted 537, MATCHED.**

### unitedstates/images — the GPO pictorial-directory portraits
- **Last walked:** 2026-08-23 — read by `corepack pnpm congress:corpus`, which
  performed the clone.
- **Status:** WIRED for portraits. `scripts/fetch-official-photos.mts` writes
  `lib/registry/official-photos.json`.
- **Tier:** A — one clone enumerates every portrait the corpus holds.
- **Access method — AND THE FINDING THAT MATTERS:** the fetcher's original and
  only route was `https://unitedstates.github.io/images/…`, a **GitHub Pages**
  host. That is a different host from `github.com`, and an egress can refuse the
  first while permitting the second. Measured both ways in the same minute on
  2026-08-23: the Pages read returned `000`, and
  `git show HEAD:congress/450x550/C000127.jpg` returned 114,839 bytes of valid
  450x550 JPEG. **The wall was around a host, never around the data.** The git
  road is now a permanent rung in the fetcher, walked before any absence is
  recorded, and it is the better citation regardless because it is pinned to a
  commit.
- **Auth:** none.
- **Licence:** **CC0 1.0 Universal**, confirmed 2026-08-23 by reading the
  repository's own `LICENSE` file at commit
  `aec3e4a88af843b282c0576f420b930f6a9a46ad`. The repository's `README` states
  separately that the photographs are Government Printing Office works the GPO
  has confirmed are public domain — which is what makes them **door 1** under
  the photo rule, an explicit recorded licence, rather than door 2.
- **Count assertion (RULING 100):** `git ls-tree` states the corpus size before
  a byte of image data moves. Walked 2026-08-23: **stated 1,297, extracted
  1,297, MATCHED.**
- **Measured 2026-08-23:** 437 of 537 sitting members already had a portrait
  here; **97 were owed and the corpus holds all 97** (retrieved and verified —
  real JPEG, dimensions and SHA-256 each — in `data/hunt/congress-corpus-walk.json`);
  **3 are owed and the corpus does not carry them** (`H001104` Jon Husted,
  `A000383` Alan Armstrong, `G000608` Darline Graham). **0 of the 97 are
  committed**, because RULING 20 keeps portrait bytes out of git and the
  content-addressed store is `R57`.

### LegiScan — state bills and roll calls
- **Last walked:** 2026-08-20
- **Status:** WIRED. `scripts/fetch-legiscan.mts`, weekly Sunday refresh,
  `dataset_hash`-gated so an unchanged dataset is never re-downloaded.
- **Auth:** `LEGISCAN_API_KEY`.
- **Licence obligation — LAW, not a note: CC BY 4.0 requires attribution
  wherever the data appears.** `LEGISCAN_ATTRIBUTION` is one object, sent with
  the rows by the API so it cannot drift from the store it describes, and
  rendered under the Recent votes heading. Never touch the legiscan.com front
  end.

### Plural Open (ex-Open States) — state legislators
- **Last walked:** 2026-08-20
- **Status:** WIRED. `lib/sources/plural/`.
- **Auth:** `PLURAL_API_KEY` via open.pluralpolicy.com.
- **Licence:** the bulk CSV this repo reads is CC0.

### OpenFEC — federal contributions and independent expenditures
- **Last walked:** 2026-08-20
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
- **Last walked:** 2026-08-20
- **Status:** WIRED, and the denominator behind every coverage claim.
  `data/reference/census_govt_units_2022.csv`, the national cartographic
  boundary files, `scripts/resolve-census-territory.mts`.
- **Auth:** none for the boundary and workbook files. `CENSUS_API_KEY` is held
  for the **API**, which nothing reads (`SRC01`).
- **Licence:** US federal government work. Public domain.
- **RULING 10:** a ZCTA is not a ZIP code. State the mapping method; never
  present a ZCTA-derived answer as a ZIP-code answer without saying so.

### NCES Common Core of Data — school districts
- **Last walked:** 2026-08-20
- **Status:** WIRED as reference data.
  `data/reference/nces_ccd_lea_directory_2025_26.csv`, 19,711 LEA records.
- **Auth:** none.
- **Licence:** US federal government work. Public domain.

### CISA `.gov` registry (cisagov/dotgov-data)
- **Last walked:** 2026-08-23 — `raw.githubusercontent.com/cisagov/dotgov-data/main/current-full.csv` answered HTTP 200 at 1.41 MB with the `Domain name` header present as a control string
- **Status:** WIRED. `data/dotgov/snapshot.json`, SHA-pinned,
  `pnpm dotgov:fetch`.
- **Auth:** none.
- **Licence:** US federal government work.
- It is **a rung, never a denominator** — see `docs/zip-playbook.md`.

### Anthropic API — the ask-box classifier
- **Last walked:** 2026-08-20
- **Status:** WIRED. `lib/routing/classifier.ts`.
- **Auth:** `ANTHROPIC_API_KEY`.
- **Constraint:** nothing it produces is a reader-facing claim. Routing only.
  No candidate position, no summary, no blurb is generated — `CLAUDE.md`'s
  never-generate rule binds here exactly as everywhere else.

### MapTiler — vector tiles
- **Last walked:** 2026-08-20
- **Status:** WIRED. Not Google Maps.
- **Auth:** `NEXT_PUBLIC_MAPTILER_KEY` (public by design — it is a tile key).

### The agenda vendors — Legistar, OnBase, NovusAgenda, Diligent/BoardDocs, iCompass/CivicWeb, Apptegy, BoardBook, IQM2, Revize, CivicPlus, clerksboards
- **Last walked:** 2026-08-20
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
- **Last walked:** 2026-08-20
- **Status:** EVALUATED. Address → OCD-ID.
- **The Representatives endpoint SHUT DOWN in April 2025.** Any code or doc
  referencing it is dead. Recorded rather than deleted, so the next session does
  not rediscover it.

### Democracy Works Elections
- **Last walked:** 2026-08-20
- **Status:** EVALUATED. Elections and ballots to sub-municipal level.
- **Auth:** licensed, contact required. An ask-before.

### Vote Smart — candidate questionnaires
- **Last walked:** 2026-08-20
- **Status:** EVALUATED. API key required.

### GovTrack
- **Last walked:** 2026-08-20
- **Status:** EVALUATED, and possibly discontinued in summer 2026. **Verify
  before adding any dependency on it.**

### Polarization Research Lab
- **Last walked:** 2026-08-20
- **Status:** EVALUATED — `D62`, the author's find. `lib/sources/prl/` exists;
  the build brief has not been settled.

---

## Not in use — the three held keys

### `CENSUS_API_KEY` — `SRC01`
- **Last walked:** 2026-08-23 — CALLED by `pnpm credentials` and **REFUSED again**: HTTP 302 to `invalid_key.html`. It remains the one failing credential of fifteen. `NS06` is the author's action and this session did not re-diagnose it
The Census **API**, as distinct from the bulk files this repo already reads. It
would answer per-zip demography and geography questions the committed files
cannot. Nothing reads it today.

### `LDA_API_KEY` — `SRC02`
- **Last walked:** 2026-08-23 — CALLED by `pnpm credentials`, HTTP 200, 5 rows. PROVEN and still unread by anything in the repo
Lobbying Disclosure Act filings. `PB12` is the client row; this is the
credential. Nothing reads it today, and `PB12` records that this source is
currently fetching NOTHING.

### `DATA_GOV_API_KEY` — `SRC03`
- **Last walked:** 2026-08-23 — CALLED by `pnpm credentials`, HTTP 200, 42 rows. PROVEN and still unread by anything in the repo
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

---

## STATE, COUNTY AND LOCAL CAMPAIGN FINANCE — walked 2026-08-24

*(The state-campaign-money session. **RULING 126** governs everything in this
section: it renders for readers and never enters an export, an aggregate, or
anything sold — from ANY source, not only the FEC. Every row carries its
last-walked date under RULING 96.)*

### The register

| Source | Status | Access | Licence / terms | Tier | Last walked |
| --- | --- | --- | --- | --- | --- |
| **NJ ELEC search — `njelecefilesearch.com`** | **WIRED** | Keyless `POST /api/VWEntity/Entities20` (committees) and `GET /api/VWEntity/GetEntityFilingData` (the money) | New Jersey public records held by a state agency. No terms-of-use document and no `robots.txt` encountered on the search host | A | 2026-08-24 |
| **NJ ELEC official site — `elec.nj.gov`** | **WALLED, and it is only the WEBSITE** | Imperva/Incapsula challenge — **HTTP 200 with a challenge page**, so a status check reads it as healthy | — | A | 2026-08-24 |
| **NH CFS — `cfs.sos.nh.gov`** | **REACHABLE, data endpoints NOT located** | Node `fetch` gets HTTP 200; **curl and Playwright Chromium both get 403** | New Hampshire public records | A | 2026-08-24 |
| **NH SOS campaign finance — `sos.nh.gov/elections/campaign-finance/`** | **REACHABLE** | Plain fetch, HTTP 200, 2.95 MB | New Hampshire public records; individual filed reports published as PDFs | A | 2026-08-24 |
| **AZ SeeTheMoney — `seethemoney.az.gov`** | **REACHABLE, parameters NOT determined** | `POST /Reporting/GetNEWTableData` answers HTTP 200 | Arizona public records. **No `robots.txt` and no terms page** — both 404 on 2026-08-24 | A | 2026-08-24 |
| **AZ Citizens Clean Elections — `azcleanelections.gov`** | **REACHABLE, not yet wired** | Plain fetch, HTTP 200 | Arizona public records | A | 2026-08-24 |
| **FEC Combined Federal/State Disclosure Directory** | **WIRED** (committed since 2026-08-22) | `data/reference/fec_combined_federal_state_disclosure_directory.csv` | **United States government work — public domain.** No attribution obligation, no terms to accept | A | 2026-08-24 |
| **FollowTheMoney.org / OpenSecrets** | **RESTRICTED — DO NOT USE** | — | **CC BY-NC-SA. The non-commercial clause bars this product**, which sells anonymized aggregates | — | 2026-08-24 |
| **CFI `stateLinks` — `cfinst.org/state/stateLinks.aspx`** | **DEAD** | — | — | — | 2026-08-24 |
| **CFI law database — `cfinst.github.io`** | **REACHABLE, not wired** | GitHub Pages, HTTP 200 | **GPL-3.0**, quoted below | B | 2026-08-24 |

### The licensing facts, settled

**FollowTheMoney.org / OpenSecrets — RESTRICTED, and the bar is the licence
rather than the quality.** Their state data is licensed **CC BY-NC-SA**, and the
**NC** clause is dispositive here: this product sells anonymized aggregates,
which is a commercial use however carefully the underlying data is firewalled.
It is the Ballotpedia class exactly — **a licensing conversation that is Sean's
to have, never a scrape**. Recorded here so no later session re-derives the
question and reaches a friendlier answer.

**CFI's `stateLinks` page is not stale — it is GONE.** Walked 2026-08-24:
`http://www.cfinst.org/state/stateLinks.aspx` answers **HTTP 404**, and
`https://www.cfinst.org` does not complete a TLS handshake at all. The seed the
brief proposed no longer exists, so the 50-state directory is built from the FEC
Combined Directory instead — which was already committed in this repo, is
fresher, and is public domain. `data/reference/state-cf-agencies.json`.

**`cfinst.github.io` — GPL-3.0, quoted from the repository itself** as RULING 87
requires rather than inferred from a badge. `https://api.github.com/repos/cfinst/cfinst.github.io`
reports `"spdx_id": "GPL-3.0"`, and the `LICENSE` file at the repository root
opens:

> "GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007"

**What that means for us, stated rather than assumed.** GPL-3.0 is a SOFTWARE
licence and its copyleft reaches derivative works of the CODE. This product would
take neither: what CFI's database holds that is useful is **contribution limits
by state by year**, and a statutory limit is a fact about a statute. Facts are
not copyrightable — the same reasoning RULING 87 applies to Wikipedia's
municipality tables. **So it is usable as a Tier B discovery source for law
context, never as a source of record, and none of its code is copied.** If a
later session wants the repository's tooling rather than its facts, GPL-3.0
governs and that is a different question.

**Each state portal's own terms, read before extraction:**

- **NJ `njelecefilesearch.com`** — no terms-of-use document and no `robots.txt`
  encountered on the search host. The records are New Jersey public records.
  Requests were serialised at roughly one per second with an identified
  `User-Agent` carrying a contact address.
- **AZ `seethemoney.az.gov`** — **`robots.txt` is HTTP 404** and
  `/PublicResources/TermsOfUse` is HTTP 404. There is no stated restriction, and
  the absence of one is recorded as a measurement rather than as a permission.
- **NH `cfs.sos.nh.gov`** — not reached far enough to read terms. Recorded as
  such, with the date, rather than as absent.

### The wall at `elec.nj.gov`, and the distinction that matters

`elec.nj.gov` was recorded Imperva-walled on 2026-08-19 and re-confirmed on
2026-08-22. **Re-walked 2026-08-24 at rung 3: still walled.** The refusal
answers **HTTP 200** carrying an Incapsula challenge page, which is why the
first probe of this session read it as healthy — a 200 that is not the thing is
not a document.

**And it does not matter, which is the point.** NJ Hunt 5 established that it is
ELEC'S WEBSITE that is walled and not ELEC's RECORDS: the filings are on
`njelecefilesearch.com`, one hop away, answering at rung 2. A host being walled
and a body being unreachable are different facts, and collapsing them is what
RULING 52 exists to prevent.

---

## GENERAL WEB SEARCH — walked, walled, and the compliant route that replaced it (2026-08-24, NJ depth)

**Every entry below carries the date it was last walked, per RULING 96.** The
compliance column is decided from each host's OWN `robots.txt`, read on the
date given, before any rung was attempted — `CLAUDE.md` says a `robots.txt`
disallow gets a COMPLIANT ROUTE to the same information, never a cleverer
client.

| Host | its `User-agent: *` says | may we walk it | rung result | last walked |
|---|---|:--:|---|---|
| `html.duckduckgo.com` | `Allow: /` | **yes** | rungs 2 and 3: **HTTP 202, ~14 KB, zero result anchors** — a challenge page, not an empty result set. Re-measured 2026-08-25: unchanged, HTTP 202 at ~14.2 KB constant across ten queries | 2026-08-25 |
| `lite.duckduckgo.com` | `Allow: /` | **yes** | HTTP 202, same shape. Re-measured 2026-08-25: unchanged | 2026-08-25 |
| `duckduckgo.com` | `Disallow: /*?` then `Allow: /?*` | **yes, at the root query form** | rung 6, a live browser with JavaScript executed: the rendered page reads **"Unfortunately, bots use DuckDuckGo too."** | 2026-08-24 |
| `4get.ca` | `Disallow:` — **empty, so every path is permitted** | **YES** | **RE-MEASURED 2026-08-26 AND THE 08-25 READING WAS WRONG.** rung 2 still answers HTTP 200 — and the page is INTERFACE ONLY. Real query 7,154 B against a 7,274 B control: the answer is SMALLER than the answer to an impossible query, and carries **zero result links**. The "naming the subject 8 times" recorded on 08-25 was **eight ECHOES of the query** — the `<title>`, the `<meta description>`, the search box's `value=`, and five tab links. `namesSubject` counted them because it asked whether the letters appear rather than whether the page is about the subject, which is RULING 110 inside the control built to prevent RULING 110. Fixed by `stripQueryEcho`; guarded with the captured page in `tests/search-pool.test.ts`. **The only compliant general index in this table returns nothing to this client**, so general web search is a WALL for this project today, dated and re-walked on RULING 53's clock | **2026-08-26** |
| `www.mojeek.com` | `Disallow: /search` | **no** | **not walked at any rung.** Its `robots.txt` was re-read 2026-08-25 and is unchanged | 2026-08-25 |
| `search.brave.com` | `Disallow: /search` (with `Allow: /search?conversation=` above it) | **no** | **not walked at any rung.** Re-read 2026-08-25, unchanged | 2026-08-25 |
| `www.ecosia.org` | `Disallow: /search` | **no** | not walked at any rung | 2026-08-24 |
| `www.startpage.com` | `Disallow: /sp/` | **no** | not walked at any rung | 2026-08-24 |
| `searx.be` | — | **not reached** | HTTP 200 with **byte-identical bodies (11,354 B)** for a real query and for an identifier that cannot exist, naming nobody. A JavaScript shell: a "no result" from it would be indistinguishable from a wall, so it fails RULING 68's control before compliance is even the question | 2026-08-25 |
| `www.bing.com` | `Disallow: /search` and siblings | **no** | not walked at any rung | 2026-08-24 |

### A CORRECTION THIS SESSION OWES, recorded rather than smoothed (2026-08-25)

**The final pass built a search route straight through this table's own
prohibition, and had to unbuild it.**

`lib/hunt/search-pool.ts` was first written with **Mojeek and Brave in the
pool**, on the strength of the right two questions asked in the wrong order:
does the host answer, and does its answer pass a control query. Both do. Both
also carry `Disallow: /search`, and `/search` is the path a query goes to.

**The table above already said so**, in the column headed *may we walk it*, with
the answer **no** and the rung result **not walked at any rung** — recorded by
the 2026-08-24 session, which had asked the permission question first and got it
right. The header three lines above it says the compliance column is decided
*before any rung was attempted*. Everything needed to avoid this was written
down, dated, and in the register the constitution names as the source of record.

What went wrong is a reading failure and it is worth naming precisely: this
session opened `docs/sources.md`, measured its size, and went to the sections it
expected to need. It did not read the section about the thing it was about to
do.

*What was done about it.* The run was stopped mid-flight at 125 of 276
candidates and its output discarded — no artifact built through a disallowed
path is committed. `SEARCH_POOL` holds `4get.ca` alone, whose `robots.txt` is
an empty `Disallow:`. `tests/search-pool.test.ts` now fails the build if an
engine recorded as `DISALLOWED` appears in the pool, and requires every engine
in it to QUOTE the `robots.txt` line permitting its path, with the date it was
read.

*And the distinction the guard is really about.* **A disallow is not a wall.** A
wall is a host refusing us, it carries a date, and RULING 53 sends a session
back to re-walk it. A disallow is a host telling us not to ask, and re-walking
it on a clock would be asking the same question again after being told no. The
two were one word apart in the module's first draft — `SEARCH_POOL_REFUSED` —
and that word would have put both hosts on a fourteen-day re-walk cadence. They
are `SEARCH_POOL_EXCLUDED` now, with a `kind` that keeps `DISALLOWED`,
`WALLED` and `FAILS_CONTROL` apart, and the guard asserts Mojeek and Brave are
recorded under the first.

**This is a WALL and it is recorded as one.** No field moves toward
`VERIFIED_ABSENT` on a route we were refused, and none moves toward it because
a route was closed to us by a publisher's own policy. `pnpm search:rung`
re-measures it, so the next session reads the verdict rather than rediscovering
the wall across four rungs.

### The compliant routes to the same information, measured the same day

| Source | What it answers | Licence / terms | Control | Last walked |
|---|---|---|---|---|
| `newjerseyglobe.com/wp-json/wp/v2/search` | statewide NJ political coverage, by surname | no terms document encountered; the site's own documented WordPress interface (ladder rung 7) | an impossible term returns `[]` | 2026-08-24 |
| `morristowngreen.com/wp-json/wp/v2/search` | Morris County local coverage, by surname | same | an impossible term returns `[]` | 2026-08-24 |
| `morrisdems.org/wp-json/wp/v2/pages` | the county Democratic committee's own 85 pages in ONE request, including an index of its 22 municipal committees | same | the index carries the municipal pages by name | 2026-08-24 |
| `index.commoncrawl.org/CC-MAIN-2026-34-index` | does a host exist in the August 2026 crawl, and which URLs does it hold | Common Crawl, open | an impossible host returns **HTTP 404 `No Captures found`** — a real control | 2026-08-24 |
| `api.marginalia.nu/public/search/<query>` | an independent keyword index of the non-commercial web | **CC-BY-NC-SA 4.0 — DISCOVERY ONLY.** The non-commercial clause means it may point at a URL and may never be a source of record here; the URL is then fetched from the origin and proved there, exactly as RULING 87 governs Wikipedia | returns a `license` field and a `results` array | 2026-08-24 |

**Coverage measured rather than assumed.** Common Crawl's August 2026 index
holds **6** URLs for `newjerseyglobe.com`, **98** for `morristowngreen.com`,
**22** for `tapinto.net`, **77** for `patch.com` and **7** for
`dailyrecord.com`. It is a domain-existence oracle and a page enumerator for
small sites; it is not a substitute for a keyword index, and the numbers are
here so the next session does not have to re-measure to find that out.

### `crt.sh` — Certificate Transparency as a domain index

**Conceived and walked 2026-08-24.** Every HTTPS campaign site has a
certificate, and every certificate is in a public CT log, so a substring query
against `crt.sh` finds domains containing a candidate's surname. The control is
clean — an impossible substring returns `[]` at HTTP 200 — but **three of four
real queries returned HTTP 502 from its nginx**, which is a WALL on those
queries rather than an absence of certificates. Recorded with the date; owed a
re-walk on the RULING 53 clock.

### `www.tapinto.net` — walled at rung 3, 2026-08-24

HTTP 403 to an identified browser-profile client. Not walked further this
session. Recorded as a measurement on a date, never as a standing property.

### VOTE411 / the League of Women Voters — READ, AND STILL RESTRICTED

**The brief's condition was: read its terms from its own site before extracting
anything, and treat it as restricted until the terms say otherwise. The terms
were looked for and there are none.**

- `www.vote411.org/robots.txt` — read 2026-08-24. It disallows `/admin/`,
  `/user/*`, `/search/`, `/comment/reply/` and `/media/oembed`, and permits the
  rest. That is an access statement about crawling; it is not a licence.
- `/terms-use`, `/terms-of-use`, `/privacy-policy` — **all HTTP 404**, read
  2026-08-24. `lwv.org/terms-use` is HTTP 404 too.
- The homepage and its footer link `/about`, Contact, Get Involved, Sponsors &
  Partners and the social accounts. **No terms-of-use document is linked from
  either.** The only assertion is the footer's `©2026 League of Women Voters
  Education Fund`.

**So it stays RESTRICTED, and nothing was extracted.** An absent terms document
is not a permissive one, and a copyright notice with no licence beside it is the
opposite of a grant. This is the same posture RULING 70 takes toward Ballotpedia
and RULING 93 toward `usmayors.org`: a nonprofit's compilation is not a
government publication, and the fact that it is *about* public records does not
make it public-domain. **Re-walk on the 14-day clock** — a terms page may
appear, and the answer changes the day it does.

### `nj.gov/nj/gov/county/localgov.shtml` — the state's own municipal directory, re-walked

**Re-walked 2026-08-24 at rung 2: HTTP 200, 114,118 bytes, 619 links, control
strings present.** RULING 93's route still answers.

It closed three real gaps in one fetch, and one of them is the argument for the
whole rule: **Madison Borough's official website is `rosenet.org`**, which no
name-shaped guess would ever reach. Confirmed by control — the page titles
itself *Madison Borough, NJ | Official Website*. `peqtwp.org` likewise titles
itself *Pequannock Township, NJ | Official Website*.

**Washington Township (Morris) is `wtmorris.org` and it is walled at rung 3** —
a Sucuri CloudProxy JavaScript challenge that sets a cookie and reloads, which
a plain client reads as a 1,331-byte page titled *"You are being redirected…"*.
The directory also lists four different Washington Townships across four
counties, so the Morris one is identified by its position in the county section
rather than by its name, which is exactly the Boonton / Boonton Township problem
this project has already paid for once.

## BOUNDARY AND DISTRICT SOURCES FOR AZ 85641 — walked 2026-08-27

**These answer WHO GOVERNS AN ADDRESS**, which no source in the register above
did. The finding that produced them: `docs/gap-ledger.md` recorded 24 Pima
County special districts as territory-unresolvable because the national Census
boundary files carry no special districts. **The county that LEVIES a district's
tax publishes exactly where it starts and stops** — ask the levying authority,
not the statistical one.

| Source | Status | Access | Licence / terms | Tier | Last walked |
| --- | --- | --- | --- | --- | --- |
| **Pima County open-data ArcGIS — `gisdata.pima.gov/arcgis1`** | **WALKED — the primary district source** | Public ArcGIS REST. **34 services, 281 layers, 66 governance-shaped.** No key | `robots.txt` HTTP 404 → `NO_ROBOTS`, nothing forbids the path | A | 2026-08-27 |
| **Census geographies — `geocoding.geo.census.gov/geocoder/geographies/coordinates`** | **WALKED** | `layers=all`, keyless, 96 points answered with 0 failures | United States government work — public domain | A | 2026-08-27 |
| **TIGERweb ZCTA — `tigerweb.geo.census.gov`** | **WALKED** | ArcGIS REST; the ZCTA polygon, POSTed as query geometry | Public domain; `robots.txt` allows | A | 2026-08-27 |
| **AZGeo Data Hub — `azgeo.az.gov`** | **WALKED** | **302 to `azgeo-data-hub-agic.hub.arcgis.com`.** The state hostname is a redirect; the hub is the real host | ALLOWED | A | 2026-08-27 |
| **AZ fire service areas — `services6.arcgis.com/clPWQMwZfdWn4MQZ`** | **WALKED, and WEAKER than the county layer** | Arizona DFFM via AZGeo, `access: public` | Publisher's own disclaimer: boundaries **approximate**, purpose **wildfire dispatch**, last updated **September 2021**. Cite the county's taxation layer for legal territory | B | 2026-08-27 |
| **ArcGIS Online sharing API — `www.arcgis.com/sharing/rest/search`** | **WALKED — as a DISCOVERY instrument** | Keyless. Finds a government's published layers, and its item `url` field names the real server root | ALLOWED | A | 2026-08-27 |
| **Pima County sitemap — `www.pima.gov/sitemap.xml`** | **WALKED** | 1,748 URLs, 56 governance-shaped | `robots.txt` disallows Baiduspider and Yandex only | A | 2026-08-27 |
| **Apptegy / Thrillshare CMS — `thrillshare-cmsv2.services.thrillshare.com`** | **WALKED** | Keyless. `/api/v2/s/<section>/directories` and `/api/v4/o/<org>/cms/*`. Org id is in the page's own hydration payload | `robots.txt` HTTP 404 → `NO_ROBOTS` | A | 2026-08-27 |
| **Pima County Assessor — `asr.pima.gov`** | **DISALLOWED — NOT WALKED** | — | **`Disallow: /`.** RULING 148: a disallow is a host saying do not ask, and it is never re-walked on a clock. Nothing here came from it | — | 2026-08-27 |
| **Pima County Treasurer — `to.pima.gov`** | **CANNOT_TELL — REFUSED** | Resolves to 159.233.179.13; HTTPS fails `ERR_TLS_CERT_ALTNAME_INVALID`, plain HTTP answers 500 | Not a permission verdict. A retired or misconfigured address; the Treasurer's live pages are on `www.pima.gov` | — | 2026-08-27 |
| **AZ Dept of Revenue — `azdor.gov`** | **WALKED under `User-agent: *`** | `Allow: /` for `*`; sitemap 478 URLs | **Disallows eight named AI crawlers INCLUDING ClaudeBot**, and carries `Content-Signal: search=yes,ai-train=no,use=reference`. This client declares its own identity, so `*` is its group. **Needs Sean row NH225 carries the judgement call** | A | 2026-08-27 |
| **Highbond — `vailschooldistrict.community.highbond.com`** | **DISALLOWED — NOT WALKED** | — | **`User-agent: *` → `Disallow: /`.** Read 2026-08-27: 23,479 bytes, 486 agent blocks, exactly ONE `*` block, ZERO `Allow:` directives. Fetched twice (curl and a browser UA) so this is a RULE, not RULING 182 transport. Vail USD's current agendas sit here and there is NO permitted vendor route to them. Corrects NH229, which proposed an adapter | — | 2026-08-27 |
| **BoardDocs — `go.boarddocs.com/az/vail/Board.nsf/Public`** | **DISALLOWED — NOT WALKED** | — | **`User-agent: *` → `Disallow: /`, `Crawl-delay: 1000`.** A SECOND Vail agenda portal, previously unknown to this repo. Found in the district's own anchor TEXT while the href pointed at Highbond — see the method route `anchor-text-names-a-second-vendor-than-the-href`. Confirms the standing D70 clause | — | 2026-08-27 |
| **Vail USD own site — `www.vailschooldistrict.org`** | **WALKED — permitted, and it does NOT host agendas** | — | `User-agent: * / Allow: / / Disallow: /api/`. Sitemap 194 URLs, allowed. Carries every board MEETING as an event; the agenda is a LINK OUT to the two disallowed portals. An argued ZERO for agendas from this source, never an absence claim about Vail | A | 2026-08-27 |
| **NovusAGENDA — `vailschools.novusagenda.com`** | **REQUIRES_NEW_ADAPTER — permitted, not yet readable** | — | `robots.txt` HTTP 404 → `NO_ROBOTS`: the host publishes no restriction. Live; `/agendapublic/meetingsresponsive.aspx` serves AgendaHTML/AgendaPDF. A bare viewstate POST returned 200 with ZERO rows and the date window RESET to defaults, so the search never ran — a FAILED extraction under RULING 100, not an empty portal. NH229's pre-2017 claim is UNVERIFIED | — | 2026-08-27 |
| **Pima County elections — `www.pima.gov/810/Upcoming-Elections-and-Events`** | **WALKED — and it is a DOCUMENT INVENTORY** | — | `robots.txt` 452B disallows Baiduspider and Yandex only; `User-agent: *` carries no Disallow. Read 2026-08-27: the July primary has NINE published documents, the November 3 GENERAL has exactly ONE (vote-center locations), beside the county's own sentence that more will be added. So a general-election contest question has no available source yet — a fact about the CALENDAR, not about our retrieval. Replaced a records request with a dated recheck on NH244 | A | 2026-08-27 |
| **AZ Secretary of State — `azsos.gov`** | **WALKED** | — | `User-agent: *` with Allow rules. `/elections/candidates` answers 200 at 259,680B and carries no water-conservation contest. Recorded as a route WALKED, never as evidence either way | A | 2026-08-27 |
| **`apps.arizona.vote`** | **BLOCKED_CURRENTLY — re-confirmed** | — | HTTP 403 again on 2026-08-27 to a browser user agent, matching rungs 2, 3 and 6 from the coverage-truth session. Cloudflare bot protection, not a rule; its `robots.txt` is 403 too, so permission stays `CANNOT_TELL` (RULING 182) and this is NOT a disallow. Bypassing bot detection is prohibited | — | 2026-08-27 |
| **CivicPlus tenant — `az-pimacounty.civicplus.pro`** | **LEAKED BY `pima.gov`'s own links** | — | The vendor tenant behind Pima County's site. Platform-tenancy lead, not yet walked | — | 2026-08-27 |

### Three transport findings that are NOT permission verdicts

**RULING 182 — permission state and transport state are orthogonal.** Each of
these looked like a closed door and was not one.

1. **`services6.arcgis.com/robots.txt` answers HTTP 403 with the body
   `Invalid URL`** at rungs 2, 3 and 4 and under a bare Node fetch. It is a
   multi-tenant host that routes only `/<orgId>/…` paths, so an apex request has
   no tenant. The sweep correctly returns `CANNOT_TELL` and refuses; permission
   was taken instead from the publishing government's own hub (ALLOWED) and the
   item's `access: public` and licence fields.
2. **`www.mescalj6fd.com` — a fire district that levies on 85641 — was
   unwalkable because of a certificate.** It fails HTTPS with
   `ERR_TLS_CERT_ALTNAME_INVALID` and serves `robots.txt` at **HTTP 200 over
   plain http**. `pnpm robots:sweep` now falls back to plain HTTP when HTTPS
   yields no answer at all, and still fails safe.
3. **`gisopendata.az.gov` is NXDOMAIN** — a wrong guess at a hostname, not a
   publisher that stopped publishing. So was
   `gisdata.pima.gov/arcgis/rest/services`, which answers **404** while the real
   root is `/arcgis1/`.

**A 404 at a guessed path, a 403 at an unrouted apex, and a TLS mismatch are
three different facts, and none of them is "this government publishes nothing".**
