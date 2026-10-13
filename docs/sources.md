# Sources — the register

**Created 2026-08-20 (Prompt C item 9).** This is the live register that
`CLAUDE.md`'s External-sources section points at. The constitution carries the
LAW about sources; this carries the FACTS, which change.

Every row states: **status** (wired / evaluated / not in use), the **auth
mechanism**, and the **licence obligations**. A licence obligation is law, not a
note — where a source's terms require attribution, the attribution ships with
the data it describes.

---

## Robots.txt is recorded, not blocking (owner decision, 2026-09-25)

Sean, 2026-09-25: *"Robots.txt alone must not block acquisition. I explicitly
authorize automated reading of publicly accessible pages even when robots.txt
requests otherwise. Do not stop reading, remove coverage, or ask me again about
individual publishers or groups solely because of robots.txt. This
authorization does not extend to bypassing authentication or other access
controls."* (Recorded in `docs/rulings.md` by the integrator.)

What that means for this register:

- **The robots column is still filled, and every fetcher still reads
  robots.txt first.** The verdict (ALLOWED, DISALLOWED, NO_ROBOTS, CANNOT_TELL),
  the matched rule and the date travel with what was read. It is evidence and
  it never refuses a public page (`ROBOTS_BLOCKS_ACQUISITION = false`,
  `lib/control-plane/scheduler/robots.ts`). `Crawl-delay` is still honoured as
  spacing.
- **Rows below that say "DISALLOWED — NOT WALKED" or "honoured, never re-walked"
  record what was true under the earlier rule.** Each such row now says what
  stands in the way instead: nothing (the route is read), an adapter not yet
  built, or an access control.
- **Access controls are never bypassed:** a login or 401, a paywall, a 403 or
  bot challenge (a CAPTCHA, a Cloudflare interstitial), a rate limit (429), an IP
  block. Each is a technical failure of that route, recorded as a wall and
  investigated by other public routes (`lib/hunt/access-control.ts`,
  `tests/robots-recorded-not-blocking.test.ts`).
- **Rows re-dispositioned 2026-09-25:** `legistar.granicus.com`,
  `pima.granicus.com`, `pima.community.highbond.com`,
  `susd-12.community.highbond.com`, `tusd1-schooldesk…`,
  `vailschooldistrict.community.highbond.com`, `apps.azleg.gov`,
  `asr.pima.gov`, `files.smartsites.parentsquare.com`,
  `drive.google.com/uc`, `public.destinyhosted.com` (Chandler), Wikipedia's
  `/w/`, and the general search engines (which stay out for access controls,
  re-measured the same day).

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
| 1 | `NEXT_PUBLIC_MAPTILER_KEY` | `lib/map/style.ts`, `components/map/map-entry.tsx` | **WIRED** — production and staging only; empty locally, in CI and on previews (MAPQ-3) | 2026-09-07 |
| 1a | `WTP_MAPTILER_SMOKE_KEY` | `scripts/provider-smoke.mts` | **NEEDS OWNER** — the key is not issued yet (MAPQ-3) | 2026-09-07 |
| 1b | `MAPTILER_SERVICE_TOKEN` | `lib/control-plane/maptiler/client.ts`, `scripts/maptiler-usage.mts` | **NEEDS OWNER** — the service credential is not issued yet, so usage reads NOT CONNECTED (MAPQ-5) | 2026-09-07 |
| 2 | `NEXT_PUBLIC_MAPTILER_STYLE` | `lib/map/style.ts` | **WIRED** | 2026-08-23 |
| 3 | `NEXT_PUBLIC_MAPTILER_STYLE_LIGHT` | `lib/map/style.ts` | **WIRED** | 2026-08-23 |
| 4 | `DATABASE_URL` | the whole app, via `lib/db/index.ts` | **WIRED** | 2026-08-23 |
| 5 | `WTP_DB_ROLE` | `lib/db/write-guard.ts`, `/api/build` | **WIRED** | 2026-08-23 |
| 6 | `WTP_PRODUCTION_DATABASE_URL_WRITE` | `lib/db/write-handle.ts`, `pnpm db:apply` | **WIRED** | 2026-08-23 |
| 7 | `WTP_PRODUCTION_DATABASE_URL_READONLY` | `scripts/walk-all.mts`, the census scripts | **WIRED** | 2026-08-23 |
| 8 | `CONGRESS_API_KEY` | `scripts/fetch-votes.mts` | **WIRED** | 2026-09-08 |
| 9 | `FEC_API_KEY` | `scripts/fetch-fec.mts` through the standing routine civic-data runner | **WIRED** — canonical `fec-funding` production-data contract; no GitHub refresh workflow | 2026-08-23 |
| 10 | `PLURAL_API_KEY` | `lib/sources/plural/index.ts` | **WIRED** | 2026-08-23 |
| 11 | `LEGISCAN_API_KEY` | no production caller; `lib/sources/legiscan/` retains a historical-evidence parser only | **INTENTIONALLY NOT SPENT** — official legislative publishers own current production acquisition | 2026-08-23 |
| 12 | `ANTHROPIC_API_KEY` | `lib/routing/classifier.ts` | **WIRED** | 2026-08-23 |
| 13 | `CENSUS_API_KEY` | `lib/sources/census-acs-population/index.ts`, `pnpm acs:population` | **WIRED** — ACS 5-Year B01003 population and its published margin of error, by ZCTA and state, committed under `data/reference/acs5_2024_b01003_*` (ADM-23; re-acquired at the 2024 release for ADM-41) | 2026-09-06 |
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
| `CONGRESS_API_KEY` | `scripts/fetch-votes.mts` — **WIRED** | HTTP 200 | Official bill titles for the bounded recent-roll projection; the durable receipt redacts the credential-bearing query | **bounded roll window** | 2026-09-08 |
| `FEC_API_KEY` | `scripts/fetch-fec.mts` through the standing runner's canonical `fec-funding` contract — **WIRED** | HTTP 200 | **77 federal candidates**; their committee records carry treasurer name, street, city, zip and designated-agent phone | **22** | 2026-08-22 |
| `PLURAL_API_KEY` | `lib/sources/plural/index.ts` — **WIRED** | not needed | The **committed BULK file** `data/reference/openstates_legislators.csv` holds 7,976 state legislators with official emails; **61** of them serve these two zips. No API call, no quota spent. | **61** | 2026-08-22 |
| `LEGISCAN_API_KEY` | `scripts/legiscan-votes-refresh.mts` through per-state standing contracts | Authenticated `getDatasetList` and `getDataset` returned HTTP 200 for Texas | Weekly datasets supply attributed roll calls and exact OpenStates person positions, with CC BY 4.0 attribution. Unique native identifiers or an exact shared member profile URL establish identity; official roll calls retain precedence. Original source members are committed as fixtures. | 1 member position verified in source fixture | 2026-10-13 |
| `DATA_GOV_API_KEY` | **nothing** — `SRC03` | HTTP 200 | **42 govinfo collections.** The `CDIR` collection is the Congressional Directory and carries member offices, phones and staff — a real contact route, and the reason this key is worth keeping. | 0 | 2026-08-22 |
| `CENSUS_API_KEY` | `lib/sources/census-acs-population/index.ts` — **WIRED** 2026-09-05 | **HTTP 200 with real data** (2026-09-05) | **THE KEY WORKS NOW.** On 2026-08-22 the host redirected to `invalid_key.html` (`X-DataWebAPI-KeyError: 1`); re-measured 2026-09-05 the same key answers `["ZCTA5 85701","5169","85701"]`, and one keyed call each returned every ZCTA (33,772) and every state (52) for ACS 5-Year B01003. RE-ACQUIRED 2026-09-06 at the **2024** release (ADM-41 / §9A.19): `/data/2024/acs/acs5` answers 200 and `/data/2025/acs/acs5` answers **404**, so 2024 is the newest 5-Year vintage published for the ZCTA geography, and the request now also carries `B01003_001M`, the Bureau’s own 90% margin of error, so a small-area estimate is never rendered as a count. A keyless call is still a 302 to `missing_key.html`. `api.census.gov/robots.txt` answers a WAF "Request Rejected" page (HTTP 200, HTML), so the robots read is CANNOT_TELL and the API's own terms of service (a key, and a citation) govern the route. Closes no Kelly field about a person; it is the readiness panel’s population source (ADM-23). | 0 | 2026-09-06 |
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

> **Since 2026-09-25 a robots.txt claim in this file is evidence, not a gate**
> (see *Robots.txt is recorded, not blocking* above). The box below is kept as
> the record of why each row still carries a dated robots reading.
>
> **A PERMISSION CLAIM IN THIS FILE WAS WRONG FOR WEEKS, AND NOTHING FAILED.**
> (2026-09-01.) The Wikipedia row read *Tier A, WIRED* against
> `en.wikipedia.org/w/api.php`, and that path is **disallowed by the host's own
> `robots.txt`**. It was found only because a lane registering a NEW Wikipedia
> route read the host's file before shipping it — the row itself had never been
> checked against it. Ten requests reached the disallowed path first.
>
> **This is the failure mode this table is most exposed to.** A wall announces
> itself: a 403, a challenge, a timeout, and a session goes and looks. A
> permission error announces nothing — `/w/api.php` answers 200 all day — so the
> only thing that can catch one is reading the publisher's own file and
> comparing it to the row. **A row here is a claim about someone else's
> permission, and it expires the way any other measurement does.**

| Source | Access | Licence | Tier | Status | Last walked |
|---|---|---|---|---|---|
| **USA.gov** — `usa.gov/elected-officials`, `/local-governments`, `/state-election-office`, `/state-governor`, `/agency-index`, `/states/{state}` | plain GET, no key, no rate wall observed | **US government work — public domain.** No attribution obligation, no terms to accept | **A** | **WIRED** — `pnpm tier:directory`. RULING 93's federal tier. 7 routes, all answering, 227 entities. Re-read 2026-08-23 out of the committed walk at `data/hunt/tier-directories.json`, whose `nj-localgov` route carries 624 entities and 592 distinct hosts — that directory is what settled `rockawaytownship.org` and `rockawayborough.org` as OFFICIAL rather than press | 2026-08-23 |
| **State of New Jersey local-government directory** — `nj.gov/nj/gov/county/localgov.shtml` | plain GET, no key | **US state government work — public domain** | **A** | **WIRED** — `pnpm tier:directory --route nj-localgov`. **624 entities: all 21 counties and all 564 municipalities with their official websites.** Note the live URL: `/nj/gov/county/` answers HTTP 200 with a "Page not found" body | 2026-08-22 |
| **Wikipedia** — municipality and election articles | `en.wikipedia.org/wiki/<Title>?action=raw`, no key, identified User-Agent, spaced 400 ms. **`/w/api.php` IS DISALLOWED and was used until 2026-09-01** — the host's own `robots.txt` carries `Disallow: /w/` for `User-agent: *` with exactly two exceptions, `Allow: /w/api.php?action=mobileview&` and `Allow: /w/load.php?`, and neither is a content query. `/wiki/` carries no blanket Disallow and returns the same wikitext (measured: `Tucson, Arizona`, 200 `text/x-wiki`, 183,138 bytes). Since 2026-09-25 the `/w/` Disallow is robots.txt recorded, not blocking (owner decision 2026-09-25); the `/wiki/` route stays in use because it works | **CC BY-SA.** Facts — names, parties, term dates, districts — are **not copyrightable** and are what is extracted; the prose is never copied. RULING 87 | **A** | **WIRED** — `pnpm wiki:muni`, `pnpm wiki:graph`, `pnpm wiki:citation`. **Re-walked on the permitted route 2026-09-01 and diffed against the previous artifact: 39 of 39 municipalities reached, 908 official rows, 270 distinct officials — every Wikipedia-derived number identical.** **DISCOVERY ONLY, never a source of record** | 2026-09-01 |
| **Each body's own website** — municipal, county, district | plain GET, identified User-Agent, spaced 700 ms, ceiling on pages per site | Public records published by the body. The public-records rule governs | **B** | **WIRED** — `pnpm roster:hunt`. The route that carries phone and email where the encyclopedia carries neither. Walked 2026-08-23 against `rockawaytownship.org`, `rockawayborough.org` and `denvillenj.gov`, each control-paired; two confirmed a sitting mayor by name and office | 2026-08-23 |
| **FEC Combined Federal/State Disclosure Directory** | committed at `data/reference/fec_combined_federal_state_disclosure_directory.csv`; re-fetch with `pnpm fec:directories` | **US federal government work — public domain** | **A** | **WIRED.** 349 offices across 56 jurisdictions with records-held, URL, email and phone | 2026-08-22 |
| **2022 Census of Governments** | committed at `data/reference/census_govt_units_2022.csv`; `govt_units_2022.ZIP` from www2.census.gov, byte-identical to the committed file's source (attested 2026-09-23) | **US federal government work — public domain** | **A** | **WIRED.** The OFFICIAL UNIVERSE every coverage claim is measured against, and the source of each state's REGISTRATION (`lib/registration/`): the runner confirms the pinned bytes monthly per state | 2026-09-23 |
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
- **Status:** WIRED. `scripts/fetch-votes.mts`,
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
- **Last walked:** 2026-09-07 by the SHA-pinned five-file acquisition.
- **Status:** WIRED as an attributed directory authority for what it covers.
  `corepack pnpm congress:fetch` is an explicit-owner, no-clock acquisition
  which must promote a fully validated candidate to the permanent civic-data
  store. It records the exact commit, all five source hashes, validation,
  changes and the resulting GOOD pointer; a failed or thin acquisition is a
  durable refused attempt and leaves LKG live. The tracked
  `data/congress-legislators/` and federal officeholder holdings are first-seed
  and test evidence only, never the production mutable authority.
- **Tier:** A (RULING 84) — one fetch answers for all 537 sitting members.
- **Access method:** the five required YAML files are fetched serially from
  `raw.githubusercontent.com` at the adopted commit SHA. Each response is
  content-hashed and checked against its file-specific floor before the
  source-set candidate can promote.
- **Auth:** none.
- **Licence:** **CC0 1.0 Universal**, confirmed 2026-08-23 by reading the
  repository's own `LICENSE` file at commit
  `750c0608efb6ef1fc3257ba72c99af3771d35088` — not assumed from the
  organisation name. No attribution obligation.
- **Count assertion (RULING 100):** the file states its own membership by
  carrying one top-level entry per sitting member. Walked 2026-08-23:
  **stated 537, extracted 537, MATCHED.**

### unitedstates/images — the GPO pictorial-directory portraits
- **Last walked:** 2026-08-23 by the recorded SHA-pinned corpus walk.
- **Status:** AVAILABLE for owner-reviewed registry-runtime portrait bindings.
  Production bindings are promoted with their exact licensed source receipts
  through `corepack pnpm registry:promote -- --package=<reviewed-package>`.
  The former tracked portrait writer is deleted;
  `lib/registry/official-photos.json` is first-seed/test evidence only.
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

### Reviewed registry runtime bindings — bodies, rosters, executives, and candidacy identity
- **Status:** WIRED as an explicit-owner, no-clock production data-plane
  contract. `corepack pnpm registry:promote -- --package=<reviewed-package>`
  validates the exact body/division, body-person/contact, roster disposition,
  statewide officeholder, officeholder/candidacy, and licensed-photo records
  against the package's acquired-byte receipt before moving the one GOOD
  pointer. A malformed or incompletely receipted successor is held atomically
  and the prior projection remains live.
- **Reader boundary:** registry, directory, representation, map, ballot, Ask,
  and campaign-money identity read that promoted projection. They never reopen
  tracked JSON after a store failure. The tracked registry/roster/photo files
  and `lib/registry/fixtures/official-candidacies-first-seed.json` are explicit
  first-seed/test evidence only.
- **Identity boundary:** live officeholder/candidacy outcomes and exact roster
  aliases belong to the promoted projection. The separately retained
  `official-person-candidacy-links-v1.json` is labeled non-authoritative,
  versioned same-person review evidence for the first seed; no production
  Reader imports it and the old tracked bridge writer/path is deleted.

### LegiScan — state bills and roll calls
- **Last walked:** 2026-08-20
- **Status:** **INTENTIONALLY NOT SPENT for production.** The former
  `scripts/fetch-legiscan.mts` / GitHub refresh authority is deleted. The
  retained `lib/sources/legiscan/` parser may inspect already-held historical
  evidence only; official legislative publishers own current acquisition and
  promotion, and no production contract calls LegiScan.
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
- **Status:** WIRED for committee TOTALS only. The standing runner invokes
  `scripts/fetch-fec.mts --promote` through the canonical weekly `fec-funding`
  production-data contract; its durable events own cadence, health and LKG.
  There is no GitHub refresh workflow or tracked mutable production writer.
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
  boundary files, and the promoted Census geography readers. The former
  `scripts/resolve-census-territory.mts` sampler is retired; its saved evidence remains.
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
- **Last read:** 2026-10-12 — SHA `e4020449e896b2264d2056e49daeb55920a3d977`,
  16,876 domains, including 719 with CISA election types. Exact source bytes and retrieval
  metadata are in `tests/fixtures/dotgov/`.
- **Status:** The standing runner's monthly `dotgov` contract resolves the publisher's
  current commit and reads every CSV row at that exact SHA. Durable data-plane receipts,
  the GOOD pointer and LKG own live state. `readDotGovProjection` verifies and serves the
  full registry through the `government-domains` reader edge family.
- **Reader association:** Registrants attach only to a uniquely matching government's
  established name and state. Unmatched and ambiguous domains remain in the registry;
  they add no government or service boundary. Census websites remain separately sourced.
- **Auth:** none.
- **Licence:** US federal government work.
- The registry supplies official domain links and acquisition routes. Government coverage
  continues to use the Census of Governments, NCES and official rosters as its denominator.

### Anthropic API — the ask-box classifier
- **Last walked:** 2026-08-20
- **Status:** WIRED. `lib/routing/classifier.ts`.
- **Auth:** `ANTHROPIC_API_KEY`.
- **Constraint:** nothing it produces is a reader-facing claim. Routing only.
  No candidate position, no summary, no blurb is generated — `CLAUDE.md`'s
  never-generate rule binds here exactly as everywhere else.

### MapTiler — vector tiles
- **Last walked:** 2026-09-07
- **Status:** WIRED. Not Google Maps.
- **Auth:** `NEXT_PUBLIC_MAPTILER_KEY` (public by design — it is a tile key).
- **Quota is bounded, and our robots are outside it (MAPQ-1, 2026-09-07).** The
  first billing period closed at 101,863 requests against a 100,000-request free
  allowance while readership was tiny. `scripts/browser.mts` — the one place
  this repository opens a browser — is now fail-closed against every
  `maptiler.com` host. Spending takes two gates, prints that it is spending,
  and is capped; `pnpm provider:smoke` is the only command that asks. A blocked
  style request produces the app's existing no-basemap fallback, so captures and
  walks stay testable. `lib/ops/provider-access.ts` holds the policy;
  `docs/maptiler-keys.md` holds the key matrix and the owner actions.
- **Reading the bill:** MapTiler's Service API,
  `GET https://service.maptiler.com/v1/analytics/api_usage/timeline`, read-only
  with a server-side service token, classified by `api_keys` and by
  `services`. `pnpm maptiler:usage`.

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

### Official-page events — a body's OWN page, outside any vendor
- **Last walked:** 2026-09-23
- **Status:** WIRED — `lib/sources/official-page-events/` (AgendaSourceType
  `OFFICIAL_PAGE_EVENTS`), one partition per wired body, promoted through the
  standing runner's meeting-partition door like every other meeting source.
- **Auth:** none. The body's own public web page.
- **Licence:** the records are the body's own publication about its own public
  meetings; facts (dates, times, places, titles) are extracted, prose is not
  copied beyond a short evidence excerpt that cites the page.
- **Permission, per page, read before the first fetch:**

| Page | robots.txt | Verdict | Read |
| --- | --- | --- | --- |
| `https://www.tusd1.org/Reconfiguration` (Tucson Unified School District — WIRED) | `User-agent: *` disallows only `/TUSD-school-exit-survey` and `/PLC-Roskruge` (separate `Disallow: /` groups name SemrushBot, SiteAuditBot, SplitSignalBot and GPTBot, none of which is us) | **ALLOWED** — no rule matches the path | 2026-09-23 |
| `https://www.sfps.info/page/board-of-education-2` (Santa Fe Public Schools, NM — recorded as a cross-state test fixture only, NOT wired) | `User-agent: *` `Allow: /`, `Disallow: /api/` | **ALLOWED** for the page; the paginated event API under `/api/` is disallowed and is not read | 2026-09-23 |

- **Transport:** `www.tusd1.org` answered curl with a Cloudflare 520 while the
  repo's own `politeGetText` (index profile, project User-Agent) received HTTP
  200 for the same page — the pipeline's ordinary client, no escalation.
- **Verification is per event:** the page host must be the body's registered
  official domain (its registry `homepageUrl`) or explicitly authorized on the
  wiring row; each date must parse unambiguously inside the serving window; the
  title must name the body or its committee. Anything else is HELD with a named
  reason, never guessed.

### Document listing — a body's own agendas-and-minutes page
- **Last walked:** 2026-09-25
- **Status:** WIRED — `lib/sources/document-listing/` (AgendaSourceType
  `DOCUMENT_LISTING`), first body the City of Holbrook, AZ City Council, its
  own partition.
- **Shape:** one page per year; one link per document, labelled with its
  sitting's kind and date ("Regular Meeting 9-9-2026") under an "Agendas" or
  "Minutes" heading. One sitting per kind per date, its agenda cited.
- **Auth:** none. **Permission, read before the first fetch of every run:**

| Page | robots.txt | Verdict | Read |
| --- | --- | --- | --- |
| `https://holbrookaz.gov/government/council-agenda/<year>-agendas-minutes/` (City of Holbrook — WIRED) | `User-agent: *` with an empty `Disallow:` (Yoast block) | **ALLOWED** | 2026-09-25 |
| `https://drive.google.com/file/d/<id>/view` (Holbrook's agenda PDFs, linked from the page) | `Allow: /file` | **ALLOWED**, but the page is a script-only viewer carrying none of the agenda's text | 2026-09-25 |
| `https://drive.google.com/uc?export=download&id=<id>` (the same PDFs' bytes) | `Disallow: /` is the longest match | **DISALLOWED — robots.txt recorded, not blocking (owner decision 2026-09-25).** Not read yet: no code turns the `/file/d/<id>/view` link into this download request | 2026-09-25 |

- **What is not known from this route:** the hour and room of each sitting,
  which Holbrook prints only inside the agenda PDFs above. Sittings publish
  date-only with their agenda link; nothing is inferred.
- **Horizon:** a sitting appears when the city posts its agenda.
- **Also on the city's site, not wired:** the Planning & Zoning Commission's
  agendas and minutes page (`/government/council-agenda/planning-zoning-agendas-minutes/`);
  the commission is not a registered body yet.

### SuiteOne Media — hosted meeting portal
- **Last walked:** 2026-09-25
- **Status:** WIRED — `lib/sources/suiteone/` (AgendaSourceType `SUITEONE`),
  first tenant the City of Winslow, AZ City Council, its own partition.
- **Shape:** the tenant's server-rendered home page (`/?embed=1`, where
  `/web/` lands): the next ten meetings of every body, and one panel per body
  category of the current and previous year's meetings, each row with its
  date and time, agenda, packet, minutes and video links.
- **Auth:** none. **Permission, read before the first fetch of every run:**

| Page | robots.txt | Verdict | Read |
| --- | --- | --- | --- |
| `https://winslowaz.suiteonemedia.com/?embed=1` (City of Winslow — WIRED) | none served (HTTP 404) | **NO_ROBOTS** — no restriction stated | 2026-09-25 |

- **Not wired:** the page's own paging and older-years controls are POSTs
  (`/Home/GetUpcomingEvents`, `/Home/GetRecentEventsGroup`); their GET forms
  answer 404, so the robots-first research client could not verify them.
  Until one is verified, council sittings later than the table's tenth row
  appear only as the table rolls forward (the tenth row on the first read:
  19 November 2026 <!-- expected-future: a scheduled meeting date -->).
- **Place:** not on the portal's rows; each agenda states it ("the main hall of
  the Winslow Visitor's Center, 523 West Second Street", 22 September 2026).

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
| **AZ SeeTheMoney — `seethemoney.az.gov`** | **REACHABLE; parameter NAMES now determined, VALUES still not** | `POST /Reporting/GetNEWTableData` answers HTTP 200. **Narrowed 2026-08-29:** the parameter names were read out of the app's own `/bundles/core` — `Page, startYear, endYear, JurisdictionId, TablePage, TableLength, TableSearch, Name, NameId, CommitteeId, BallotMeasureId, OfficeID, PartyID, ShowAllYears, URLHash, ExportOptions` — alongside a bulk `ExportEntityTransactions` route. Every combination tried still answers HTTP 200 with a 2-byte empty JSON string, so the VALUES are the remaining unknown. **That is a rung nobody has climbed, not an absence:** the next route is to observe the app's own POST body and `URLHash` in a browser, which is exactly how the Pima `Origin` header below was learned | Arizona public records. **No `robots.txt` and no terms page** — both 404 on 2026-08-24, re-confirmed 2026-08-29 | A | 2026-08-29 |
| **Pima County campaign finance — `ecf-api.easyvoteapp.com`** | **WALKED — and the 401 that closed this record for a whole session was never about the caller** | **900 contribution rows and 584 distribution rows**, e.g. *Citizens of Vail for Education* (Vail, 85641) receiving \$5,000 from Concord General Contracting on 2025-12-17 | `robots.txt` HTTP 404 → `NO_ROBOTS`. **The story, because it is the doctrine working.** `documents/getdocumentfiling/{id}` answers **401** to every client — bare curl, a browser UA, Origin and Referer, and the trailing-slash form the SPA actually calls. A prior session correctly recorded that as *a wall on a route, not a statement about the filing*, and stopped there. Enumerating all **59 API routes out of the SPA bundle** instead of retrying the known one (RULING 207) found `/advancedsearch/contributions/{customerId}`, which answers **500** rather than 401 — and the ASP.NET stack trace names `ContributionsSearch → CurrentUserOrWebSiteUserAsync → GetSubdomain(url)` throwing on a null URI. **The API has its own anonymous website-user path and only needed the tenant subdomain, which it reads from the `Origin` header.** With `Origin` set it answers **HTTP 200 at 1,090,303 bytes**. No credential, no login, no bypass — the identical request the county's own public app makes. **900 is not a cap:** partitioning against the server reproduced it exactly (2025: 502 = 502, 2026: 368 = 368), and a truncated result cannot partition consistently. **Limits that travel with the data:** every filing is a `_Redacted` public copy; all rows are `DocumentType: CCFR`, so there is NO independent-expenditure row and its absence is OURS rather than a claim that no outside money was spent; as-filed dates are preserved unrepaired (years `0006` and `2926` exist); committee name variants are NOT merged, because a name match is not agreement; and neither this portal nor the state register publishes committee-to-measure linkage, which is never inferred from a committee's name | A | 2026-08-29 |
| **AZ Citizens Clean Elections — `azcleanelections.gov`** | **REACHABLE, not yet wired** | Plain fetch, HTTP 200 | Arizona public records | A | 2026-08-24 |
| **FEC Combined Federal/State Disclosure Directory** | **WIRED** (committed since 2026-08-22) | `data/reference/fec_combined_federal_state_disclosure_directory.csv` | **United States government work — public domain.** No attribution obligation, no terms to accept | A | 2026-08-24 |
| **FEC API — `api.open.fec.gov`** | **WALKED UNDER AN ISSUED KEY — and its robots.txt disallows the whole API to anonymous crawlers** | `/v1/*` with `FEC_API_KEY`; the standing runner promotes through canonical contract `fec-funding`. `data/fec/fec-2026.json` is a bundled first-bootstrap fixture, not mutable production authority. | **`User-agent: * → Disallow: /v1/*`**, read 2026-08-29. Recorded rather than acted on, because the two are different channels and the stronger one governs: an ISSUED API KEY is the FEC granting this application named access to that exact path, which robots.txt cannot speak to — it addresses anonymous crawlers, and we are not one. **So the standing keyed route is NOT overturned by this row.** What the row does forbid is treating the disallow as absent: no unkeyed fetch of `api.open.fec.gov`, and no expansion into new endpoints on a session's own judgement. Anything past committee totals — Schedule B, Schedule E, independent expenditures — remains gated behind the PB10/D23 counsel review already recorded here, and that gate is why the product currently answers an IE question with a NAMED GAP whose owner is THE_LAW rather than with silence | Federal | 2026-08-29 |
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

## Honest identity, never a disguise (2026-09-25)

The same owner decision that made robots.txt a record also drew the other
line: *"This authorization does not extend to bypassing authentication or other
access controls."* Applied here: saying who we are is always allowed;
pretending to be someone else to get past a filter is not.

- **Kept:** the shared source client (`lib/sources/http.ts`) sends the project's
  own `User-Agent`; when a filter refuses Node's client (a 403, or a challenge
  page at 200) it asks once more as the same identity through `curl`, with
  `X-Purpose` and `X-Contact` beside it. The research transport
  (`lib/hunt/research-transport.ts`) does the same.
- **Removed:** the browser profile four wiring rows asked for (Kearsarge; Newbury
  Planning, Conservation, ZBA), rung 3 (a Chrome browser header set after a 403),
  rung 3b (a Chrome `User-Agent` with the project's name taken out), the browser
  header sets on the `curl` rung, the third-party relay rung
  (`lib/hunt/egress.ts`, which fetched a walled page from someone else's
  addresses), and the NH lobbyist-registry route's name-less `User-Agent`.
- **Never:** a credential or cookie sent to get past a wall, a challenge or
  CAPTCHA answered or scripted past, a 401/407 re-asked. A refusal or challenge
  from the honest `curl` request is a WALL naming rung 4
  (`tests/robots-recorded-not-blocking.test.ts`, `tests/identified-ua-wall.test.ts`).

**Measured 2026-09-25, nothing lost its read.** With the identified client and
robots.txt read first, all 41 wired URLs answered except seven on three
Cloudflare-fronted hosts, which answer Node's client HTTP 403 with a challenge
whatever it sends: Newbury's calendar export and three board pages, Sutton's
calendar feed, and Kearsarge's two school-board pages. The same identity through
`curl` then read all seven (HTTP 200, no challenge; Newbury 1,256 VEVENTs,
Sutton 1,317), end to end through `politeGetText`. Their partitions' last good
versions stand in the meantime. Production records for the 7 days to
2026-09-25 show these routes failed 35–70% of attempts even WITH the disguising
rungs, which the honest `curl` request (admitted 30 of 30 in the failing-sources
measurement) should remove; the runner's next reads are the check.

## GENERAL WEB SEARCH — walked, walled, and the compliant route that replaced it (2026-08-24, NJ depth)

**Every entry below carries the date it was last walked, per RULING 96.** The
robots column is each host's OWN `robots.txt`, read on the date given. Until
2026-09-25 a disallow closed the host; since the owner decision of that date it
is recorded and does not (the *may we walk it* column below is the earlier
rule's answer, kept as the record). What keeps an engine out now is an access
control or a failed control — `SEARCH_POOL_EXCLUDED` in
`lib/hunt/search-pool.ts`, re-measured 2026-09-25: **Mojeek answers its query
path with a CAPTCHA page, Brave with HTTP 429**, and neither is ever solved or
pushed through.

| Host | its `User-agent: *` says | may we walk it | rung result | last walked |
|---|---|:--:|---|---|
| `html.duckduckgo.com` | `Allow: /` | **yes** | rungs 2 and 3: **HTTP 202, ~14 KB, zero result anchors** — a challenge page, not an empty result set. Re-measured 2026-08-25: unchanged, HTTP 202 at ~14.2 KB constant across ten queries | 2026-08-25 |
| `lite.duckduckgo.com` | `Allow: /` | **yes** | HTTP 202, same shape. Re-measured 2026-08-25: unchanged | 2026-08-25 |
| `duckduckgo.com` | `Disallow: /*?` then `Allow: /?*` | **yes, at the root query form** | rung 6, a live browser with JavaScript executed: the rendered page reads **"Unfortunately, bots use DuckDuckGo too."** | 2026-08-24 |
| `4get.ca` | `Disallow:` — **empty, so every path is permitted** | **YES** | **RE-MEASURED 2026-08-26 AND THE 08-25 READING WAS WRONG.** rung 2 still answers HTTP 200 — and the page is INTERFACE ONLY. Real query 7,154 B against a 7,274 B control: the answer is SMALLER than the answer to an impossible query, and carries **zero result links**. The "naming the subject 8 times" recorded on 08-25 was **eight ECHOES of the query** — the `<title>`, the `<meta description>`, the search box's `value=`, and five tab links. `namesSubject` counted them because it asked whether the letters appear rather than whether the page is about the subject, which is RULING 110 inside the control built to prevent RULING 110. Fixed by `stripQueryEcho`; guarded with the captured page in `tests/search-pool.test.ts`. **The only compliant general index in this table returns nothing to this client**, so general web search is a WALL for this project today, dated and re-walked on RULING 53's clock | **2026-08-26** |
| `www.mojeek.com` | `Disallow: /search` | **no (2026-08-25); robots no longer blocks** | **Re-measured 2026-09-25 through the research fetch: HTTP 200, 5,513 B, a CAPTCHA page (`<title>Captcha</title>`, "JavaScript is required to complete this challenge").** An access control, never solved: WALLED | 2026-09-25 |
| `search.brave.com` | `Disallow: /search` (with `Allow: /search?conversation=` above it) | **no (2026-08-25); robots no longer blocks** | **Re-measured 2026-09-25: HTTP 429, 73,966 B** — a rate limit, honoured: WALLED. The same index reaches the project through the paid Brave API, under Admin's spending controls and the paid-research pause | 2026-09-25 |
| `www.ecosia.org` | `Disallow: /search` | **no (2026-08-24); robots no longer blocks** | HTTP 403 to this client (2026-08-25): WALLED | 2026-08-25 |
| `www.startpage.com` | `Disallow: /sp/` | **no (2026-08-24); robots no longer blocks** | byte-identical JavaScript shell for a real and an impossible query (2026-08-25): FAILS_CONTROL | 2026-08-25 |
| `searx.be` | — | **not reached** | HTTP 200 with **byte-identical bodies (11,354 B)** for a real query and for an identifier that cannot exist, naming nobody. A JavaScript shell: a "no result" from it would be indistinguishable from a wall, so it fails RULING 68's control before compliance is even the question | 2026-08-25 |
| `www.bing.com` | `Disallow: /search` and siblings | **no (2026-08-24); robots no longer blocks** | not yet measured under the 2026-09-25 rule; not in the pool | 2026-08-24 |

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

**Marginalia's answer shape, read from the runner's held responses on
2026-09-25.** Beside `license` and `results` sit `page`, `pages` and `query`;
each result carries `url`, `title`, `description`, `quality`, `format`,
`resultsFromDomain` and `details`. `normalizeMarginaliaSearch`
(`lib/control-plane/promotion/campaign-site-chain.ts`) keeps only `url`, `title`,
`format` and rank, as POINTER leads — never the licensed `description` — and
names an empty `results` a NO_HIT rather than a failed normalization. Of the
326 held candidate answers (4,647 results, none empty), 12 carry a lead whose
own host, or the title the index gave it, names the candidate; the
campaign-site verifier (`lib/candidates/campaign-site-verifier.ts`) reads those
origins robots-first and refuses the rest by type. Read robots-first on
2026-09-25: the 4,631 refused before any request are 2,132 hosts and titles
that do not name the candidate, 974 government hosts, 804 files, 416 news
outlets, 285 aggregators and 20 party or civic organizations; of the 16 leads,
9 sit on the candidate's own campaign domain (6 domains) and 6 of those verify
(Crane, Horne twice, Schweikert, Tang Williams twice), 3 are past-cycle sites
(HISTORICAL_CYCLE), and the 7 on other hosts (a host name that merely contains a
name token, or a title match) are refused on the page. The standing runner's
campaign-site pass reads such leads every cycle and publishes what the chain
approves through `candidate-campaign-sites-derived`.

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
| **Pima County Assessor — `asr.pima.gov`** | **DISALLOWED — robots.txt recorded, not blocking (owner decision 2026-09-25); not yet walked** | — | **`Disallow: /`.** Under the earlier rule (RULING 148) a disallow was never re-walked; since 2026-09-25 it is recorded and does not block. Nothing here has come from it yet: no route to it is built | — | 2026-08-27 |
| **Pima County Treasurer — `to.pima.gov`** | **CANNOT_TELL — REFUSED** | Resolves to 159.233.179.13; HTTPS fails `ERR_TLS_CERT_ALTNAME_INVALID`, plain HTTP answers 500 | Not a permission verdict. A retired or misconfigured address; the Treasurer's live pages are on `www.pima.gov` | — | 2026-08-27 |
| **AZ Dept of Revenue — `azdor.gov`** | **WALKED under `User-agent: *`** | `Allow: /` for `*`; sitemap 478 URLs | **Disallows eight named AI crawlers INCLUDING ClaudeBot**, and carries `Content-Signal: search=yes,ai-train=no,use=reference`. This client declares its own identity, so `*` is its group. **Needs Sean row NH225 carries the judgement call** | A | 2026-08-27 |
| **Highbond — `vailschooldistrict.community.highbond.com`** | **DISALLOWED — robots.txt recorded, not blocking (owner decision 2026-09-25); no route built yet** (a Diligent row for Vail would duplicate the Apptegy sittings; it needs a union or a cutover) | — | **`User-agent: *` → `Disallow: /`.** Read 2026-08-27: 23,479 bytes, 486 agent blocks, exactly ONE `*` block, ZERO `Allow:` directives. Fetched twice (curl and a browser UA) so this is a RULE, not RULING 182 transport. Vail USD's current agendas sit here and there is NO permitted vendor route to them. Corrects NH229, which proposed an adapter | — | 2026-08-27 |
| **BoardDocs — `go.boarddocs.com/az/vail/Board.nsf/Public`** | **WALLED — `go.boarddocs.com` answers HTTP 403 to an identified client (a recorded wall, `lib/hunt/recorded-walls.ts`); its Disallow is recorded and is not the reason** | — | **`User-agent: *` → `Disallow: /`, `Crawl-delay: 1000`.** A SECOND Vail agenda portal, previously unknown to this repo. Found in the district's own anchor TEXT while the href pointed at Highbond — see the method route `anchor-text-names-a-second-vendor-than-the-href`. Confirms the standing D70 clause | — | 2026-08-27 |
| **Vail USD own site — `www.vailschooldistrict.org`** | **WALKED — permitted, and it does NOT host agendas** | — | `User-agent: * / Allow: / / Disallow: /api/`. Sitemap 194 URLs, allowed. Carries every board MEETING as an event; the agenda is a LINK OUT to the two disallowed portals. An argued ZERO for agendas from this source, never an absence claim about Vail | A | 2026-08-27 |
| **NovusAGENDA — `vailschools.novusagenda.com`** | **WALKED — and it is a HISTORICAL ARCHIVE with a measured boundary** | **30 meetings, 30 agenda items, newest 2017-02-28** | `robots.txt` HTTP 404 → `NO_ROBOTS`: the host publishes no restriction. **The 2026-08-27 failure is diagnosed and closed.** The date text boxes carry `disabled`; `hfFromDate`/`hfToDate` are OUTPUTS of the `ddlDateRange` select, not inputs to the search, so a POST that set them always got the server's default window back. Driven through the real control at rung 6, all eight preset windows echoed their dates exactly, and **Custom Date Range** over 2010-01-01→2027-12-31 returns 30 meetings and 30 agenda ITEMS with Online Agenda / Agenda PDF / Minutes Recap links. 2024-01-01→2026-12-31 returns "No records to display" — a MEASURED zero, echoed window, minutes after the same selectors read thirty rows. Five candidate control tenants proved NOTHING (all wildcard hosts answering "Error: An HTTP error occurred" with no form) and are recorded as proving nothing. **NH229's pre-2017 claim is now VERIFIED, boundary 2017-02-28.** This holds Vail's agendas up to that date and CANNOT hold the current one | A | 2026-08-28 | <!-- expected-future: 2027-12-31 and 2026-12-31 are the upper bounds of the SEARCH WINDOWS typed into the portal on 2026-08-28, not stamps and not claims about anything happening then -->
| **Pima County elections — `www.pima.gov/810/Upcoming-Elections-and-Events`** | **WALKED — and it is a DOCUMENT INVENTORY** | — | `robots.txt` 452B disallows Baiduspider and Yandex only; `User-agent: *` carries no Disallow. Read 2026-08-27: the July primary has NINE published documents, the November 3 GENERAL has exactly ONE (vote-center locations), beside the county's own sentence that more will be added. So a general-election contest question has no available source yet — a fact about the CALENDAR, not about our retrieval. Replaced a records request with a dated recheck on NH244 | A | 2026-08-27 |
| **Office of the Arizona Governor — `azgovernor.gov`** | **WALKED — the officeholder-ACTION source AZ03 said did not exist** | **37 executive orders indexed, 12 read, 12 of 12 with a date AND a signed PDF** | `robots.txt` 2,216B: `User-agent: *`, `Crawl-delay: 10`, disallows confined to Drupal infrastructure (`/includes/`, `/misc/`, `/modules/`, `/admin/`). No content path restricted. **The crawl delay is honoured.** `/executive-orders` is a paginated index; each detail page carries the designation, the office's own title, the DATE and the full operative text, with the signed PDF at `/sites/default/files/executive-order-<n>.pdf`. Six orders fall inside the trailing 12 months. Committed to `data/states/az/officials/az-governor-actions.json` with its denominator — the index continues past the pages walked, so every number is a FLOOR | A | 2026-08-28 |
| **AZ Legislature bill-status app — `apps.azleg.gov`** | **DISALLOWED — robots.txt recorded, not blocking (owner decision 2026-09-25); no adapter reads it yet** | — | `robots.txt` is 29 bytes: `User-agent: *` / `Disallow: /`. This is where bills signed and vetoed live, so the OTHER HALF of a governor's record has no permitted route here. A permission verdict rather than a wall: no client variation changes it, and RULING 148 says a disallow is never re-walked on a clock. Named as a gap in every answer built on the executive orders alone. **NARROWED 2026-08-28: this is a fact about THIS HOST. The bill-action record IS reachable — `www.azleg.gov` publishes the chapters and the letters, and is permitted** | — | 2026-08-28 |
| **AZ Legislature legacy site — `www.azleg.gov`** | **WALKED** | **264 session-law chapters indexed (1-264, zero missing), 29 read with a published approval date; 151 Governor letters indexed (83 HB + 68 SB), 1 retrieved, 0 READ — they are mixed-raster SCANS and OCR is the named rung** | `robots.txt` 793B: `User-agent: *` with `Crawl-delay: 120` and named disallows (`/DocumentsForBill.asp`, `/FormatDocument.asp`, `/ExecutiveNominationsByNominee.asp`, `/aspWebCalendar/`, `/search/`). The eligible branch that remains for bill actions. Recorded so the next session starts from the permission rather than from a guess | — | 2026-08-28 |
| **AZ Secretary of State — `azsos.gov`** | **WALKED** | — | `User-agent: *` with Allow rules. `/elections/candidates` answers 200 at 259,680B and carries no water-conservation contest. Recorded as a route WALKED, never as evidence either way | A | 2026-08-27 |
| **`apps.arizona.vote`** | **BLOCKED_CURRENTLY — re-confirmed** | — | HTTP 403 again on 2026-08-27 to a browser user agent, matching rungs 2, 3 and 6 from the coverage-truth session. Cloudflare bot protection, not a rule; its `robots.txt` is 403 too, so permission stays `CANNOT_TELL` (RULING 182) and this is NOT a disallow. Bypassing bot detection is prohibited | — | 2026-08-27 |
| **CivicPlus tenant — `az-pimacounty.civicplus.pro`** | **LEAKED BY `pima.gov`'s own links** | — | The vendor tenant behind Pima County's site. Platform-tenancy lead, not yet walked | — | 2026-08-27 |

| **Legistar InSite calendar — `pima.legistar.com`** | **WALKED — and it holds what the vendor API does NOT** | **14 FUTURE Pima Board sittings out to 2026-12-15 that the Web API returns zero of <!-- expected-future: 2026-12-15 is the last sitting Pima PUBLISHES, not a stamp -->** (This Year, not Next Month — the grid pages at 100 and a GUESSED page index returns the WRONG page with a clean 200 and 100 well-formed rows, so page targets must be read off the pager) | `robots.txt` HTTP 404 → `NO_ROBOTS`: the host publishes no restriction. `Calendar.aspx` defaults to This Month; the future rows come from an ASP.NET postback with `__EVENTTARGET=ctl00$ContentPlaceHolder1$lstYears` and `lstYears=Next Month`. It is the ONLY complete enumeration — the RSS feed drops location and meeting kind, and the iCal export needs an ID and GUID only the grid supplies | A | 2026-08-28 |
| **City of Mesa — `www.mesaaz.gov`** | **WALKED — and it is the first-party check on Mesa's vendor** | `/Government/City-Council-Meetings` answers 200 at 159,373 bytes. Carries `<h1>City Council Meetings</h1>`, the council's own schedule sentence — *first and third Monday, 5:45 p.m., City Hall (upper level), 20 E. Main St.* — and a calendar publishing "City Council Meeting" and "City Council Study Session" | `robots.txt` HTTP 200, ONE `User-agent: *` block, 265 directives, **no bare `Disallow: /`**. It disallows only this page's own `/PublicComments` child, which was not fetched. Permission read BEFORE reachability (RULING 148) | A | 2026-08-28 |
| **Legistar InSite calendar — `mesa.legistar.com`** | **WALKED — the second tenant, and the one that proves the union rule** | The grid and the Web API each carry sittings the other does not; on one "Next Month" filter the grid published 15 with 12 `meeting_NotViewable` while `/v1/mesa/events` returned exactly the other 3. `EventBodyName: "City Council"` independently confirms the body this tenant is wired to | `robots.txt` HTTP 404 → `NO_ROBOTS`: the host publishes no restriction | A | 2026-08-28 |
| **Legistar InSite minutes — `mesa.legistar.com/View.ashx?M=M`** | **WALKED — where Mesa records its council's decisions (NH332)** | **8 sittings read, 29 motions, each with mover, seconder, the clerk's AYES/NAYS tabulation and the chair's result.** Mesa's clerk enters no action in the Web API (0 of 33 items on 2026-09-14), so the minutes are the record. The link is the grid's own `hypMinutes` cell (the portal's sitting id, not the API's EventId); it answers 200 `application/pdf`. The accessible-minutes cell read "Not available" on all 163 rows seen. The portal's "Minutes status" reads Draft on approved minutes too, so the document's title and the grid label ("Results" = the clerk's action minutes) mark a draft. Routine contract `mesa-legistar-minutes-outcomes` | `robots.txt` HTTP 404 → `NO_ROBOTS`, re-read 2026-09-25 by `pnpm research:fetch` | A | 2026-09-25 |
| **Mesa's own dated council instances — `www.mesaaz.gov` calendar widget** | **REQUIRES_NEW_ADAPTER — permitted, reachable, and NOT YET PARSED** | The city does publish its own dated instance list. `parseClerkSchedule` is a TABLE parser written for Pima's table and this is a CMS widget, so pointing it here would return zero rows | **This is a rung nobody has climbed, not an absence.** A zero-row extraction is a FAILED extraction (RULING 100); run against this it would read forever as the city publishing no schedule of its own. `clerkScheduleUrl` stays null in the tenant and says so in those words | — | 2026-08-28 |
| **Legistar Web API — `webapi.legistar.com`** | **WALKED — and its forward horizon is MEASURED, not assumed** | **`/v1/pima/events` 403 rows all-time, 0 in September 2026; `/v1/pima/EventDates/138?FutureDatesOnly=true` 0** | `robots.txt` HTTP 404 → `NO_ROBOTS`. The route returns only meetings whose InSite detail page is PUBLICLY VIEWABLE — the unreturned event ids 404 on the item endpoint (40 of 40 probed), so they have no API record at all rather than a hidden one. Re-measured 2026-08-29 <!-- expected-future: an observation timestamp in UTC; 2026-08-28 local -->: 403 rows all-time, latest EventDate 2026-08-25, ZERO future; `$top=2000` is HTTP 400. Lead time across 32 Pima 2026 events: max 5 days, median 0, min −2. **But on MESA the same route carries 20 future sittings the portal grid does not, so "the portal is the better route" is FALSE as a general rule — only the UNION survives both tenants.** **A zero here is a fact about this ROUTE and never about the body** | A | 2026-08-28 |
| **Legistar apex — `legistar.com`** | **WALKED** | — | `User-agent: *` with `Crawl-delay: 2`, honoured. Disallows confined to `*?wtime`, `*?wmediaid`, `*?wchannelid`; `Allow: /` is stated for ClaudeBot | A | 2026-08-28 |
| **Granicus proceedings — `pima.granicus.com`** | **DISALLOWED — robots.txt recorded, not blocking (owner decision 2026-09-25); left `RECORDED_WALLS` 2026-09-25; no adapter built** | — | **`User-agent: *` → `Disallow: /`.** The Live Proceedings tab linked from the Legistar tabs sits here. RULING 148: a disallow is a host saying do not ask, and it is never re-walked on a clock. **This repo makes NO claim about what that page holds** — nothing here came from it, and the September sittings were obtained from the permitted InSite calendar instead | — | 2026-08-28 |
| **Granicus document host — `legistar.granicus.com`** | **DISALLOWED — robots.txt recorded, not blocking (owner decision 2026-09-25). READ AGAIN: the agenda PDF is the ingest's fallback when the portal page links none (`GRANICUS_AGENDA_PDF` WALKED), and the minutes reader follows a minutes link there (`GRANICUS_MINUTES_PDF` needs an adapter to parse it). Live read 2026-09-25: Pima's Sept 8 study-session agenda PDF, HTTP 200, 119,649 bytes, text layer present. History below** | — | **`User-agent: *` → `Disallow: /`.** 28 bytes, read 2026-08-29 by node fetch with a `MeanwhileCivicBot` UA (HTTP 200); the detective lane read the identical body with curl under two different user agents. Three clients, one answer — a RULE, not RULING 182 transport. **This is the host every Pima and Mesa agenda PDF URL in the snapshot actually resolves to**, and it is a SIBLING of `pima.granicus.com`, recorded DISALLOWED on 2026-08-28 while this one was never checked. `data/meetings-snapshot.json` holds **16 agenda documents from this host, all 16 carrying extracted text**, retrieved 2026-08-13 .. 2026-08-21 — before the permission was read. Nothing has been fetched from it since. **(Until 2026-09-25: "the walking question is settled — do not walk it." The owner decision of that date settled it the other way.)** The portable rule this proves, and the reason the gap existed: THE HOST IN A DOCUMENT URL IS FREQUENTLY NOT THE HOST OF THE PORTAL THAT LISTED IT, so permission must be checked per document host, never per portal | — | 2026-08-29 |
| **Highbond — `pima.community.highbond.com`** | **DISALLOWED — robots.txt recorded, not blocking (owner decision 2026-09-25). ROUTE RETIRED 2026-09-23 for robots.txt alone; it STAYS retired because the college's own pages (`pima-edu`) carry every sitting it did (7 the same, 5 added, none removed), and its HOST IS READABLE AGAIN (`hostsReadable`) for the college's agenda links. Live read 2026-09-25: `/Portal/MeetingInformation.aspx?Org=Cal&Id=698` HTTP 200 (no items on the page itself); its `/document/…docx?handle=` link over https answers the HTML agenda (items 1.01–7.01). Not yet followed by the ingest: the MeetingInformation → `/document/` step is unbuilt (the *Pima school-agenda routes* section below keeps the history)** | — | **`User-agent: *` → `Disallow: /`.** First read 2026-08-29; re-read 2026-09-23T20:02Z: 23,479 bytes, sha256 `b5cbf0b4b2cbcf18…`, byte-identical on the Sunnyside and Tucson Unified tenants, recorded as `tests/fixtures/pima-edu/robots-pima.community.highbond.com.txt`. **The file is an ALLOWLIST:** six named search crawlers (msnbot, slurp, googlebot, bingbot, duckduckbot, AddSearchBot) may read `/Portal/`, `/document/` and `/Services/` under `Crawl-delay: 120`; every other agent, this project's token included, is refused. The routine clock nevertheless read this tenant daily until the cutover. Production's retired `meetings:diligent` partition for the college (7 sittings, 486 stored portal-page reads, promoted 2026-09-23T19:48Z) stays in the store unchanged and is composed as held rows until the new `meetings:pima-edu` partition's first promotion supersedes it (`HELD_MEETING_PARTITIONS`); `RETIRED_MEETING_ROUTES` in `lib/registry/source-wiring.ts` refuses re-wiring the pair (agenda retrieval from this host was refused until 2026-09-25) | — | 2026-09-25 |
| **Highbond — `susd-12.community.highbond.com`** | **DISALLOWED — robots.txt recorded, not blocking (owner decision 2026-09-25). READ BY THE PRODUCTION WIRING, and the reads continue: the owner decided on 2026-09-25 that robots.txt alone does not block** | — | **`User-agent: *` → `Disallow: /`.** First read 2026-08-29; re-read 2026-09-23T20:02Z, byte-identical to the college's tenant above (the same six-crawler allowlist). Production's `meetings:diligent` partition for Sunnyside holds 12 sittings and 875 stored portal-page reads (2026-09-23T19:38Z). A permitted replacement for the sittings exists and is HELD, not wired — see `www.susd12.org` below | — | 2026-09-23 |
| **Diligent — `tusd1-schooldesk.community.diligentoneplatform.com`** (and its alias `tusd1-schooldesk.community.highbond.com`) | **DISALLOWED — robots.txt recorded, not blocking (owner decision 2026-09-25). READ BY THE PRODUCTION WIRING, and the reads continue: the owner decided on 2026-09-25 that robots.txt alone does not block** | — | **`User-agent: *` → `Disallow: /`.** Read 2026-09-23T20:02Z, byte-identical to the two tenants above. No register row existed for this host before this one, while `lib/civic-data/source-authority.ts` admitted it. Production's partition holds 18 sittings and 967 stored reads. A permitted replacement is HELD, not wired — see `govboard.tusd1.org` below | — | 2026-09-23 |
| **AZ Attorney General — `azag.gov`** | **WALKED** | Officeholder read off `/kris-mayes`: Kris Mayes, Attorney General | **Bare host robots.txt 404 → NO_ROBOTS; `www.azag.gov` robots 200 with no `User-agent: *` rule covering the path → ALLOWED (rung 2). The www form is the stronger read** | A | 2026-08-28 |
| **AZ State Treasurer — `aztreasury.gov`** | **WALKED** | Kimberly Yee, State Treasurer; the official photo is published at three sizes and only the 326x468 rendition clears MIN_PORTRAIT_EDGE | `robots.txt` 200, `Allow: /` (rung 2) → ALLOWED. Licence NONE STATED | A | 2026-08-28 |
| **AZ Department of Education — `azed.gov`** | **WALKED** | Tom Horne, Superintendent of Public Instruction; `/node/928` 301s to `/adeinfo/about-state-superintendent` | **CANNOT_TELL on the single pass; robots 200 only at RUNG 4 → ALLOWED.** The trap recorded at `states/az/85641.md:769-774`, firing a second time. Its portrait is named `Tom Headshot 60px_0.jpg` (TOO_SMALL against MIN_PORTRAIT_EDGE 96) and its image host answered a Cloudflare interstitial — RECHECK_DUE | A | 2026-08-28 |
| **AZ State Mine Inspector — `asmi.az.gov`** | **WALKED — and the host is NOT the one the office name suggests** | Les Presmyk, Arizona State Mine Inspector, read off `/about/team`. The Secretary of State 2026 Pima primary canvass carries the filed form `PRESMYK, WALTER "LES"`, REP | robots 200 at **rung 4** → ALLOWED. **`azmineinspector.gov` DOES NOT RESOLVE — ENOTFOUND from the system resolver, ENODATA for A and NS from both 1.1.1.1 and 8.8.8.8, ERR_NAME_NOT_RESOLVED in a real browser, bare and www. CANNOT_TELL with the transport cause DNS, RECHECK_DUE — never a permission verdict, and never an absence claim about the office**, which publishes at this host instead | A | 2026-08-28 |
| **AZ Corporation Commission — `azcc.gov`** | **WALKED** | All five sitting Commissioners read off their own bios: Myers, Walden, Thompson, Márquez Peterson, Lopez. Chair and Vice Chair are ROLES inside the body, not the office | `robots.txt` 404 on both bare and www → **NO_ROBOTS** (rung 2), so nothing forbids the path. Licence NONE STATED | A | 2026-08-28 |
| **AZ SOS election records — `apps.azsos.gov`** | **WALKED** | `/election/2024/ge_cand/2024_General_Candidates_Web.pdf` 5 pages with a text layer; `/election/2026/canvass/2026_Primary_Canvass_Pima.pdf` 4,445 pages, 4,435 with text | robots 200, no rule covers the path → ALLOWED (rung 2). **The 2024 signed general canvass is a SCAN — 19 pages, 0 with a text layer. The next rung is OCR; the candidate listing is the cheaper route** | A | 2026-08-28 |
| **Office of the NJ Governor — `nj.gov/governor`** | **WALKED, and only by varying the client** | Lt. Governor Dale G. Caldwell, with his own page at `/governor/admin/ltgovernor` | robots 200, no rule covers the path → ALLOWED. **This project own ladder REFUSES the page at rungs 2-4: Imperva injects an interstitial script and `challengeIn` fires on it even when the full document is present. Bare `curl` returns the whole 68 KB page.** RULING 182: that is transport, not permission | A | 2026-08-28 |
| **Pima County Clerk of the Board schedule — `www.pima.gov/board-of-supervisors-meeting-schedule` (moved from `/2559/Board-of-Supervisors-Meeting-Schedule`, a 301 by 2026-09-24)** | **WALKED — the body OWN instance list, and the only independent check on the vendor** | **44 dated Board sittings in one table, 14 of them future, and 14 of 14 agree with `pima.legistar.com` on body, date and wall clock.** Carries an end time (10/20, 1:00-6:00 p.m.) and amendments the vendor does not publish | `robots.txt` read 2026-08-28 disallows Baiduspider and Yandex only; `User-agent: *` carries no Disallow. **Re-read 2026-09-24: `*` is in one group with Siteimprove, so it shares `Crawl-delay: 20`; still no Disallow, and the moved page is permitted (C18).** **Found through `sitemap.xml`** — the reader-facing `/2760/...-Calendar` and `/2599/...-Agenda-Schedule` pages publish only a prose recurrence rule and a link out to the vendor, which is how a session concludes the county publishes no instances | A | 2026-08-28 |
| **Rincon Valley FD — `rinconvalleyfdaz.gov`** | **WALKED — and it REPLACES a host the corpus still points at** | 5 directors; agendas AND minutes as first-party PDFs | `User-agent: *` / `Disallow:` with an EMPTY value — nothing disallowed. **`www.rinconvalleyfd.org`, the URL published by Pima County's own fire-taxation GIS layer, 404s its robots and redirects here.** An authoritative government layer carried a superseded URL, which is a corpus correction and not a wall | A | 2026-08-29 |
| **Mescal-J6 FD — `mescalj6fd.gov`** | **WALKED under `User-agent: *` — and it CLOSES a recorded CANNOT_TELL** | 5 directors with term dates | **The SECOND host disallowing ClaudeBot by name** while `*` says `Allow: /`, with `Content-Signal: search=yes,ai-train=no,use=reference`. Nine agents named. Identical shape to `azdor.gov`; this client declares its own identity (`MeanwhileCivicBot`) so `*` is its group, exactly as recorded there. **Two instances make it a CLASS — NH225 should be decided for the pattern, not the host.** Separately: `www.mescalj6fd.com` was recorded 2026-08-27 as CANNOT_TELL on a TLS mismatch; the TLS failure is real and plain HTTP redirects here | A | 2026-08-29 |
| **Corona de Tucson FD — `www.coronafire.org`** and **Sonoita-Elgin FD — `www.sefd911.org`** | **WALKED — two Streamline tenants** | Corona: 5 directors + emails, **115 dated sittings 2017→2026**. Sonoita-Elgin: 5 directors with seat, term, phone, email, **70 dated sittings** | `User-agent: * / Allow: /`; named disallows are SEO crawlers only (SemrushBot, AhrefsBot, Sidetrade, PetalBot, MJ12bot). Byte-identical policy shape across both, same vendor | A | 2026-08-29 |
| **Streamline (special-district CMS)** | **NEW SOURCE CLASS — the sitemap IS a dated meeting inventory** | one URL per sitting at `/<YYYY>-<MM>-<DD>-<body>-<slug>`, all enumerated in `sitemap.xml` | Body and meeting kind are already separated in the path, so no API and no account is needed. **Streamline's market is SPECIAL DISTRICTS**, which is this product's thinnest layer in every state — the reason this is filed as a class rather than as two fire districts | A | 2026-08-29 |
| **Pima Community College — `www.pima.edu`** | **WALKED — and it governs 44/44 of the ZIP's sample points. Since 2026-09-23 also the WIRED meeting route `pima-edu`** (see *Pima school-agenda routes* below) | 5 governing-board members by electoral district; **District 4 = Greg Taylor is this reader's representative** | `User-agent: *` with eight narrow disallows (`/secure/`, `/_dev/`, `/employee-tools/`, …); none covers the governing-board path — re-read 2026-09-23T20:02Z, 280 bytes | A | 2026-09-23 |
| **Pima County JTED No. 11 — `pimajted.org` (APEX)** | **WALKED — and the apex is NOT the same origin as `www.`** | **267 meetings, 2009→2026**, agendas as HTML and packets as PDF | Apex: `Disallow: /wp-admin/` only, plus a sitemap → ALLOWED. **`www.pimajted.org` answers HTTP 403 with a Cloudflare interstitial to four clients → CANNOT_TELL, RULING 182 transport and never a permission verdict.** A session that stopped at the `www.` form would have recorded a body covering 36/44 of the ZIP as `BLOCKED_CURRENTLY` | A | 2026-08-29 |
| **BoardBook Premier — `meetings.boardbook.org`** | **WALKED — NEW SOURCE CLASS, and one route returns the WHOLE archive** | `/Public/Organization/{id}` returns the entire meeting archive on ONE page with no pagination; `/Public/DownloadAgenda/{slug}?meeting={id}` returned a verified 12.4 MB packet PDF | `robots.txt` HTTP 404 → `NO_ROBOTS`. Operated by Sparq Data Solutions Inc. **Caveat learned with it: `/Public/Minutes/` is a CLIENT-RENDERED shell that strips to 757 bytes of chrome — a parser pointed there reports every meeting as having empty minutes**, which is a failed extraction and never an absence (RULING 100) | A | 2026-08-29 |
| **Pima County School Superintendent — `www.schools.pima.gov`** | **WALKED — the FILING OFFICER, which publishes what the elections department had not** | Every school district in the county with seats, minimum signatures, and each candidate's name, filing date and signature count. **Vail Unified, 2 seats: Andrea Black (filed 2026-07-01, 474 sigs), Edward Buster (2026-07-02, 374).** Two ballot measures text-extracted from PDFs: Vail USD budget override 12.5% (resolution 2026-06-02), JTED bond est. \$0.14 per \$100 net assessed limited property value (resolution 2026-06-09) | `robots.txt` HTTP 200 with a **ZERO-BYTE body** — a robots that exists and forbids nothing. Bare `schools.pima.gov` is ECONNREFUSED over HTTPS; the `www.` form serves. Documents on `pima-county-schools.s3.amazonaws.com`, retrieved 200. **This corrects a recorded reading that the Nov 3 general had exactly one published document: that is true of the ELECTIONS DEPARTMENT and false of the FILING OFFICER.** Fire districts file with the County Elections Department while school districts file with the County School Superintendent — one "who do I file with" answer would be wrong for one of them | A | 2026-08-29 |

## PIMA SCHOOL-AGENDA ROUTES — walked 2026-09-23

**Why these rows exist.** Pima Community College, Sunnyside USD 12 and Tucson
USD 1 publish agendas through Diligent Community tenants that refuse this
client (rows above), and the routine clock was reading them. Every permitted
place the same sittings and agendas appear was walked, robots.txt first, each
check timed in UTC by the fetch log. The per-body ledger — tried, established,
next move, who moves — is `docs/detective/pima-school-agenda-routes-2026-09-23.md`.
The client was this project's meeting-index User-Agent with `X-Purpose` and
`X-Contact`, the same identification `lib/sources/http.ts` sends.

| Source | Status | Access | Licence / terms | Tier | Last walked |
| --- | --- | --- | --- | --- | --- |
| **PCC board documents — `www.pima.edu/about-pima/leadership-policies/governing-board/board-meetings/documents.html`** and **Finance and Audit Committee — `…/finance-advisory-committee/index.html`, `agendas-minutes.html`** | **WIRED — `lib/sources/pima-edu` (2026-09-23)** | The year's table of every Governing Board sitting (28 rows in 2026) with the college's own links per row: agenda (a first-party PDF on `www.pima.edu`, or the college's link into its Diligent tenant, carried as a link and never fetched), Approved Items PDFs, video. The committee's fiscal-year schedule (date, 9:00am, Zoom Webinar) and per-sitting documents table. First-party agenda read: `agendas-docs-2026/0810.pdf`, 2 pages, text layer, full items | robots.txt 280 bytes, `User-agent: *`, eight narrow disallows, none on these paths → ALLOWED. The adapter re-reads it every run (`lib/sources/permission-gate.ts`) | A0 | 2026-09-23 |
| **PCC events calendar — `events.pima.edu/?calendar[]=3&calId=10`** | **WIRED — `lib/sources/pima-edu`** | The Board of Governors calendar: every UPCOMING sitting (8 on the day) with time; each event page's own add-to-calendar link states start, end and room (`District Office C-228`). Past sittings are not in this view: an `event_date_from/to` filter in MM/DD/YYYY returns 3 for October and 0 for 06/25–09/22 — a fact about the view, not the board | Drupal default robots (2,027 bytes): `/admin/`, `/search/`, `/user/…`, `/core/`, `/profiles/` → the listing and `/events/*` pages are ALLOWED | A0 | 2026-09-23 |
| **Sunnyside USD — `www.susd12.org/api/calendars/150042/events`** (ParentSquare SmartSites) | **WIRED 2026-09-23 (evening) as the forward-window calendar UNIONED into the existing Sunnyside partition** (`lib/sources/diligent/schedule-union.ts`; first dry run added Jan 12, 2027 with no place stated, 0 removed). The standalone adapter `lib/sources/smartsites` stays built and held as a replacement, for the reasons below | The district calendar component's own JSON call (`calendarApiID` in the home page's component config). 32 events for Jun 25–Dec 31; 13 Governing Board entries carry every date and wall clock of the 12 sittings the Diligent tenant held. **No board event states a place** (`address` empty), and the tenant zone is set to `America/Denver` (payload offsets are MDT; wall clock read in `America/Phoenix`). `/governing-board-home`, `/agenda-and-minutes`, `/latest-meeting` walked: the agenda is a link to the Diligent portal (`January 24, 2023 – Present: Diligent`) | `User-agent: *`: `/admin`, `/*lesson_plan`, `/userFiles`, `Crawl-delay: 5` (honoured) → the API path is ALLOWED | A0 | 2026-09-23 |
| **SmartSites file host — `files.smartsites.parentsquare.com`** | **DISALLOWED — robots.txt recorded, not blocking (owner decision 2026-09-25); not read yet (no adapter follows these document links)** | Every PDF `www.susd12.org` links (Employee Benefits Trust agendas, the Possible Governing Board Quorum notice) sits here | `User-agent: *` / `Disallow: /` (63 bytes; only `Googlebot-Image` allowed). The permitted page's documents are governed by THIS host's rule — method route `a-sites-file-host-carries-its-own-robots` | — | 2026-09-23 |
| **Tucson Unified board site — `govboard.tusd1.org`** (`/inflow/xti/inCal.aspx?PID=36871&C=0&D=<date>&V=12`, `/Actions`, `/Meetings`, committee pages) | **The calendar fragments WIRED 2026-09-23 (evening) as the forward-window calendar UNIONED into the existing TUSD partition** (`lib/sources/diligent/schedule-union.ts`; first dry run added the Oct 6, Oct 27, Nov 17 and Dec 8 Governing Board meetings, 0 removed). **`/Actions` WIRED 2026-09-23 as the agenda-record route of the existing TUSD partition** (`agendaRecordsUrl` on its wiring row, read by `lib/sources/diligent`): a concluded Governing Board sitting links its Board Actions PDF instead of the portal page. **The calendar route — adapter `lib/sources/tusd-govboard` — is BUILT AND HELD, not wired** | The Meeting-Calendar page's own month fragment: every Governing Board AND committee sitting with time and the district's sentence about place (Duffy Community Center / via Zoom with a join link / location TBD). `/Actions`: one Board Actions PDF per Governing Board sitting (`…/Docs/actions/09-22-2026S.pdf`, text layer, "GOVERNING BOARD AGENDA … – Board Actions", every item with its action). `/Meetings`: the Board-approved 2026 notice of meetings. The committee pages state their charters and link Diligent and BoardDocs for agendas | `robots.txt` 68 bytes names only GPTbot and PetalBot — no `*` group → ALLOWED | A0 | 2026-09-23 |
| **Tucson Unified district site — `www.tusd1.org`** | **WALKED (robots only) + one lead** | `/calendars` answers 404 today. A Brave result named a first-party agenda PDF, `/_theme/files/Governing%20Board/25-26/Jun16Agenda.pdf` (June 16, 2026 special meeting) — the district has posted an agenda on its own host at least once; no index linking such PDFs was found | `User-agent: *` disallows `/TUSD-school-exit-survey`, `/PLC-Roskruge` → ALLOWED | A0 | 2026-09-23 |
| **YouTube — `www.youtube.com`** | **WALKED — a schedule, never an agenda** | Sunnyside's board playlist (linked from `susd12.org/video-archive`) pre-creates a scheduled stream for every sitting through May 2027; descriptions are one line with no items. PCC's documents table links a video per sitting | `/watch` and `/playlist` ALLOWED; `/feeds/videos.xml`, `/api/` (caption tracks), `/youtubei/` DISALLOWED | B | 2026-09-23 |
| **Diligent public-site documentation — `help.diligentoneplatform.com`, `connect.diligent.com`** | **WALKED — no public data interface documented** | The Community "Public Site Resource" guide names the public site's features — searchable records, email **Subscriptions** that send "a link to the published document", request-to-speak, YouTube links — and no API, feed or export. Re-read 23:24Z with the Admin Help Guide and three help pages: the e-update email carries a link to the document on the tenant host (refused), no attachment is documented, the subscriber confirms by email, and an admin may enter a "Public meetings ICS feed" whose host is not visible. A subscription therefore moves no document to a permitted host (method route `agenda-portal-email-subscription-links-back-to-the-portal`). `developer.diligent.com` could not be read (below) | help: robots HTTP 404 → NO_ROBOTS; connect: ALLOWED | B | 2026-09-23 |
| **Diligent developer portal — `developer.diligent.com`** | **CANNOT_TELL — REFUSED** | Not read. A third-party profile (`raw.githubusercontent.com/api-evangelist/diligent-boards/…/apis.yml`, a LEAD, never evidence) lists only customer-gated GRC APIs (HighBond, Entities, ESG, Workflow) and says the board portal has no public developer API | robots.txt answered HTTP 200 with an HTML page → CANNOT_TELL, fail safe. Transport, not a verdict about the portal | — | 2026-09-23 |
| **Diligent corporate terms — `www.diligent.com/legal/terms-of-use`** | **WALKED** | Website Terms of Use (updated 2022-01-06) bar robots and scrapers on "the Diligent Websites" and name the contact for questions: Legal Department, `legal@diligent.com`, 61 W 23rd Street 4th Floor, New York, NY 10010. Whether a tenant portal is a "Diligent Website" is tracker B09's question; the robots.txt answers the crawling question on its own | ALLOWED | — | 2026-09-23 |
| **Sunnyside legacy URLs — `susd12.org/governing-board/event/…`, `/governing-board/agenda-minutes/`** | **WALKED — soft fallback, not records** | Search indexes still carry these; both answer 200 with byte-identical bytes (170,641, the generic Governing Board page) — a template standing in for a retired page. A LEAD that is not a HIT | ALLOWED | — | 2026-09-23 |
| **Arizona Revised Statutes — `www.azleg.gov/ars/38/00431-02.htm`** | **WALKED 2026-09-23 (evening)** | A.R.S. § 38-431.02: a school district shall post on its website where its meeting notices are posted, physical and electronic, and a notice shall include the agenda or how to obtain it. TUSD names its District Office door, Diligent Community and govboard.tusd1.org; no SUSD statement was found on the readable pages checked (method route `read-the-statutory-notice-posting-statement-first`) | ALLOWED | A | 2026-09-23 |
| **TUSD YouTube channel — TUSDMedia (`www.youtube.com`)** | **WALKED 2026-09-23 (evening) — a schedule witness, never an agenda** | Committee recordings (Audit Committee Jan 21, Feb 6, Feb 13; Bond Oversight Sep 17) with empty descriptions, and scheduled streams for the Oct 6, Oct 27, Nov 17 and Dec 8 Governing Board meetings the unioned calendar adds | `/watch`, channel `/videos` and `/streams` ALLOWED | B | 2026-09-23 |
| **Brave Search API** and **Exa Search API** | **USED — pointer-only, 33 queries (Brave 18, Exa 15; $0.195 at list price), 18 of them the evening re-challenge testing the parameters the product integration does not send** | Pointers only, the same shape as `lib/control-plane/scheduler/scout-search.ts`; every hit was opened robots-first or recorded as a lead. Query log and costs are in the ledger | Keyed (`BRAVE_SEARCH_API_KEY`, `EXA_API_KEY`). List prices read 2026-09-23: Brave Search $5 per 1,000 requests (`brave.com/search/api`), Exa Search $7 per 1,000 (`exa.ai/pricing`) | C | 2026-09-23 |

### Three transport findings that are NOT permission verdicts

**RULING 182 — permission state and transport state are orthogonal.** Each of
these looked like a closed door and was not one.

1. **`services6.arcgis.com/robots.txt` answers HTTP 403 with the body
   `Invalid URL`** at rungs 2, 3 and 4 and under a bare Node fetch. It is a
   multi-tenant host that routes only `/<orgId>/…` paths, so an apex request has
   no tenant. The sweep records `CANNOT_TELL` (since 2026-09-25 that no longer
   refuses anything); the reading was taken instead from the publishing
   government's own hub (ALLOWED) and the item's `access: public` and licence
   fields.
2. **`www.mescalj6fd.com` — a fire district that levies on 85641 — was
   unwalkable because of a certificate.** It fails HTTPS with
   `ERR_TLS_CERT_ALTNAME_INVALID` and serves `robots.txt` at **HTTP 200 over
   plain http**. `pnpm robots:sweep` now falls back to plain HTTP when HTTPS
   yields no answer at all, and records `CANNOT_TELL` when neither answers.
   **RESOLVED 2026-08-29: the district MIGRATED to `mescalj6fd.gov`.** The
   `.com` is a stale redirector whose certificate was never updated, and plain
   HTTP on it answers 200 and redirects to the `.gov`. The TLS mismatch was a
   true reading of a host that had stopped being the publisher — which is why a
   transport failure is never allowed to become a fact about the body. The same
   correction applies to `www.rinconvalleyfd.org` → `rinconvalleyfdaz.gov`,
   and there the superseded URL was the one **Pima County's own fire-taxation
   GIS layer publishes**. An authoritative government layer can carry a dead
   host; re-resolve before recording a district as unreachable.
3. **`gisopendata.az.gov` is NXDOMAIN** — a wrong guess at a hostname, not a
   publisher that stopped publishing. So was
   `gisdata.pima.gov/arcgis/rest/services`, which answers **404** while the real
   root is `/arcgis1/`.

**A 404 at a guessed path, a 403 at an unrouted apex, and a TLS mismatch are
three different facts, and none of them is "this government publishes nothing".**
