# Census geography lookup — ZCTA overlap by geography

What this is: for a selected geography (a congressional district, a county, a
metro/micro area, a state upper- or lower-chamber legislative district, a place,
or a county subdivision) it returns **every Census ZCTA that lies wholly or
partly inside it**, however small the overlap. Admin uses it for navigation,
collection scope previews, assignments, and geographic reporting.

The shared typed interface both lanes build against is
`lib/census-geography/contract.ts` (`CensusGeographyLookup`). This document is
the design, the source register, the verification report, and the runbook.

## A ZCTA is not a ZIP code (RULING 275)

A ZCTA (ZIP Code Tabulation Area) is the Census Bureau's block-built
approximation of a USPS ZIP's delivery area. It is the unit this lookup speaks
in. USPS ZIPs that are PO-box-only or single-site ("unique") ZIPs have **no
ZCTA**. This lookup therefore describes *Census ZCTA coverage*, not every postal
ZIP: `reconcilePostalZips` reports USPS ZIPs that are not ZCTAs as
`not_a_census_zcta` rather than dropping them, and never guesses that a ZIP is a
PO box. Every result states its mapping method in `provenance.method`.

This lookup describes **possible coverage** — whose territory a ZCTA touches. It
does not decide which government applies to a given resident; that is
address-based resolution, answered elsewhere.

## Sources (original Census / OMB inputs only)

All from `https://www2.census.gov`, US federal public-domain, robots-allowed for
`*`. Four of Admin's five primary groupings have a **direct national ZCTA
relationship file** (`tab20`, pipe-delimited, UTF-8 BOM); **CBSA is derived**
exactly from the OMB delineation + the ZCTA↔county file (see Method). No HUD or
commercial ZIP database is ever used as an input.

| Type | Version | Source file | Last-Modified |
| --- | --- | --- | --- |
| congressional_district | cd:119 | `…/rel2020/cd-sld/tab20_cd11920_zcta520_natl.txt` | 2024-10-24 |
| county | county:2020 | `…/rel2020/zcta520/tab20_zcta520_county20_natl.txt` | 2021-12-09 |
| cbsa | cbsa:2023 | `…/metro-micro/geographies/reference-files/2023/delineation-files/list1_2023.xlsx` **⋈** the county file | 2023-08-04 |
| state_leg_upper | sldu:2024 | `…/rel2020/cd-sld/tab20_sldu202420_zcta520_natl.txt` | 2024-10-24 |
| state_leg_lower | sldl:2024 | `…/rel2020/cd-sld/tab20_sldl202420_zcta520_natl.txt` | 2024-10-24 |
| place | place:2020 | `…/rel2020/zcta520/tab20_zcta520_place20_natl.txt` | 2021-12-09 |
| county_subdivision | cousub:2020 | `…/rel2020/zcta520/tab20_zcta520_cousub20_natl.txt` | 2021-12-09 |

The acquirer records each exact file URL, byte size, ETag, Last-Modified, and
SHA-256 (`provenance.sourceValidators` and `sourceChecksums`, index-aligned with
`sourceFiles`). The shared source-release evidence vault keeps immutable source
bytes and validates a changed document before updating its release index. An
unchanged file reuses its held overlaps after a fresh HEAD/ETag check; a failed
or partial fetch leaves the last promoted dataset serving.

**Reachability:** the standing runner runs on the production-runtime checkout
(Sean's machine), which reaches `www2.census.gov` directly, so the routine
refresh checks Census on the runner. The dataset it assembles in memory is the
promotion payload; the existing evidence vault retains source files for replay.

## Method and shares

**Direct types (cd, county, sldu, sldl, place, cousub).** Each `tab20` row
carries a geography, a ZCTA, and `AREALAND_PART` (the land area of their
overlap). A ZCTA is an **edge** of a geography if it shares any land with it —
no minimum threshold. The overlap **share is area-based**:
`AREALAND_PART / AREALAND_ZCTA5_20`; `whole` means share ≥ 0.9999. These files
carry no population, so **population weighting is honestly unavailable**
(`fractionBasis: "area"`); a population share would need a block-population join
and is a future enhancement, never a guess. Rows whose ZCTA side is blank are
the part of the geography in no ZCTA — skipped. A repeated (geography, ZCTA)
pair is summed, never collapsed, so a split relationship is neither doubled nor
lost.

**CBSA (metro/micro) — derived, but exact.** The Census publishes no direct
ZCTA↔CBSA file. But by OMB definition a CBSA is an aggregation of **whole
counties** — so the ZCTA↔CBSA relationship is not an approximation, it is the
union of the ZCTA↔county overlaps over the CBSA's constituent counties. The OMB
delineation (`list1_2023.xlsx`, the current 2023 vintage) says which counties
belong to which CBSA and whether the CBSA is **Metropolitan** or
**Micropolitan** — the two are always kept distinct (`cbsaClass`), never merged.
A ZCTA's share of a CBSA is the sum of its shares of that CBSA's counties
(`Σ AREALAND_PART over the CBSA's counties / AREALAND_ZCTA5_20`), so the basis
stays `"area"`. `memberStates` preserves cross-state metros (e.g. the New York
CBSA spans NY + NJ). Census ships the delineation **only as xlsx** — there is no
CSV/TXT variant — so `lib/census-geography/xlsx.ts` reads it in memory (a tiny,
dependency-free ZIP+XML reader, firewall-safe on the runner's routine path); a
`cbsaClass` is required on every CBSA row or the extraction fails loudly.

## Coverage (this build) and gaps

**Shipped, national, exact, area shares — all five of Admin's primary
groupings:** congressional_district (119th), county, **cbsa (metro/micro, 2023
delineation)**, state_leg_upper (2024 plan), state_leg_lower (2024 plan).
`place` and `county_subdivision` build from the same code path (direct files
above) and are opt-in via `--only`.

National counts (measured 2026-09-21):

| Type | Groupings | ZCTA edges |
| --- | --- | --- |
| cd:119 | 443 | 40,147 |
| county:2020 | 3,232 | 46,960 |
| cbsa:2023 | 935 (393 metro, 542 micro) | 29,974 |
| sldu:2024 | 1,963 | 48,029 |
| sldl:2024 | 4,878 | 56,878 |

Full national dataset: **33,791 distinct ZCTAs**, 13.7 MB JSON — comfortably
under the promotion payload budget. The priority batch is the 21 toss-up
districts across 14 states (AZ, CA, CO, FL, IA, MI, NJ, NY, OH, PA, TX, VA, WA,
WI); the shipped types cover their congressional, county, metro/micro, and both
state-legislative-chamber overlaps.

### Upcoming-election CD boundaries (cd:120) — Census source found (grf/2026)

Current-office vs upcoming-election boundaries are **distinguished, never
conflated**:

- **cd:119** (`effectiveFor: "current representation (119th Congress, 2025–2027)"`)
  is the current-office map, from the tab20 relationship file.
- **cd:120** (`effectiveFor: "2026 general election (120th Congress)"`) is the
  upcoming-election map, from the Census grf/2026 source below. Until a cd:120
  build is promoted, the lookup returns `NOT_YET_PUBLISHED` for it — never a
  cd:119 answer wearing a cd:120 label.

**The source (an original Census input; no policy exception, no state files).**
A one-URL 404 was not the whole story. Census's tab20/TIGER/GENZ products are all
still the 119th (`tab20_cd12020` is a 404; TIGER through TIGER2025/CD and GENZ2025
ship `cd119`; rel2020/2022/2024 have no cd120 — verified 2026-09-22). But the
**block-level current geographic reference** files —
`https://www2.census.gov/geo/docs/maps-data/data/grf/2026/public_grfc_cur26_<st>.txt`
(updated 2026-08-10) — carry, per 2020 tabulation block, **`CDCURFP` = the current
congressional district**, and the names file's `CDSESSN` is **120** (the 120th
Congress / 2026 election; `CDDECFP` is the old 116th). They also carry `SLDUST`,
`SLDLST`, `ZCTA5CE`, and `AREALAND`. So ZCTA↔CD:120 is derived by the same
area-share method — a ZCTA's share of a district = Σ its blocks' `AREALAND` in that
district ÷ its total block land — from `lib/census-geography/grf.ts`. Validated:
AZ‑06 CD:120 = 80 ZCTAs (43 whole) vs the tab20 119th's 79 (AZ did not redraw; the
+1 is a block-resolution sliver).

**Which states differ (determined from Census data, not guessed).** Comparing each
ZCTA's dominant CD between grf‑120 and tab20‑119 nationally (2.90 GB processed,
40,402 cd:120 edges), **ten states have redrawn 2026 congressional maps: UT, TN,
LA, TX, FL, CA, MO, OH, AL, NC** (10–65% of each state's ZCTAs move district). The
other 40 states + PR are unchanged (2026 = 119th). Single-district states are
at-large and cannot redraw; small diffs there are encoding artifacts, not redraws.

**Routine current district maps.** District maps are always kept as current as
Census publishes them. `cd120`, `sldu2026`, and `sldl2026` are in `DEFAULT_SCOPES`
and run in the standing Census refresh. `acquireGrfScopes` reads each state block
file once and extracts all three district columns in that pass. A first national
pass reads about 2.9 GB; subsequent refreshes check the exact source files with
HEAD/ETag and reuse unchanged held rows. Changed files alone are downloaded and
parsed. `acquireDataset({ only: ["cd120", "sldu2026", "sldl2026"], states })`
can restrict acquisition to requested states. The routine script passes the last
promoted dataset for reuse and retains earlier plans for their applicable dates.

Every routine refresh checks Census GRF release listings, TIGER release/CD/SLDU/SLDL
listings, and the exact `rel2020/cd-sld` relationship listing. New GRF directories
and newly published tab20 district files are acquired without a registry or code
change. Each state’s GRFN `CDSESSN` and `LSY` establish its actual Congress and
legislative plan; the release directory year does not substitute for them.
A district plan published first as a TIGER shapefile is acquired by the same
routine refresh. The DBF's `CD<n>FP` column establishes the Congress and its
`LSY` establishes the legislative plan year. The acquirer intersects that
state's district polygons with the full-resolution 2020 ZCTA polygons from
`TIGER2020/ZCTA520/tl_2020_us_zcta520.zip`. Positive surface-area intersections
establish membership, including tiny slivers; line or point contact alone does
not. Exact containment establishes whole coverage. These geometry overlaps
carry `fractionBasis: "unknown"` and null shares because polygon surface area
does not provide Census's tabulated land weights.

The national ZCTA ZIP streams to a temporary file and immutable 4 MiB chunks
in the existing evidence vault. Each state's geometry read returns only the
ZCTAs in its held county relationships, and decodes one polygon record at a
time. District files also use the shared source cache; ZIP CRC, SHP/DBF pairing,
and geographic NAD83 coordinates are checked before admission. A failed update
preserves both the last good source archive and published geography. Fresh
HEAD/ETag checks reuse unchanged parsed overlaps without restoring or decoding
their large archives. A new plan's metadata names the states whose complete
files are held, so that plan does not cut off another state's current map.

**State Senate / State House 2026 version clarity (determined from Census data).**
The grf/2026 `SLDUST`/`SLDLST` (grfn `LSY=2026`) are the current legislative
districts. Comparing each ZCTA's dominant district between grf‑2026 and the tab20
2024 plan nationally (2.90 GB): the 2026 upper-chamber exceptions are **Alabama,
Michigan, and South Dakota**; the lower-chamber exception is **South Dakota**.
The official source is the [Census GRF 2026 block and names publication](https://www2.census.gov/geo/docs/maps-data/data/grf/2026/),
compared with the [2024 tab20 legislative relationships](https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/).
Michigan’s Senate moves 7.4% of ZCTAs; South Dakota moves about 5–7% in both
chambers. Nebraska has one legislative chamber and no State House; its unassigned
lower-chamber codes are excluded. The unchanged states’ 2024 plans continue to
answer election and representation requests until a held successor starts.
`sldu:2026` and `sldl:2026` are acquired together with `cd:120` in the routine pass,
including Alabama and Michigan’s Senate maps.

## Verification

`tests/census-geography.test.ts` covers the parser (whole/partial, skipped
remainder, split relationships, loud failure on a changed header) and the read
model against the committed AZ fixture (`lib/census-geography/bootstrap-az.json`,
all five primary groupings for Arizona).

BD-02's offline checks use the committed Census-shaped binary ZIP samples in
`tests/fixtures/census-tiger`. They test routine discovery and all three
TIGER-only successor families through routine publication and the served lookup,
state coverage, unchanged-source reuse,
malformed-update preservation, holes, tiny splits, named district identity, and
bounded streaming of an archive larger than 256 MiB. The samples have artificial
coordinates and are parser evidence; production downloads run on the installed
runner after River releases the code.

**AZ-06 (toss-up):** the Census tab20 CD119 build returns **79 ZCTAs** (43
whole, 36 partial). `zccd.csv` lists **87**. The 8-ZCTA difference is fully
classified as a **method difference, not a coverage gap or version gap**:

- All 8 (85137, 85138, 85172, 85191, 85192, 85626, 85713, 85745) are real ZCTAs.
- The Census area-overlap places them 100% (85172: 64%/36%) in the **adjacent**
  districts AZ-02 and AZ-07 — zero land in AZ-06.
- `zccd.csv` unions in the HUD/USPS ZIP→CD crosswalk, which is address-based, so
  it assigns those postal ZIPs to AZ-06 even though the ZCTA polygons do not
  intersect AZ-06. This is exactly the ZCTA-vs-ZIP distinction.

Our build is a strict subset of `zccd` for AZ-06 (mine-only = 0). The count 87
is not forced; the authoritative Census area-overlap answer is 79.

**Further checks (from the tab20 / delineation build):**
- **Pima County** (GEOID 04019, `county:2020`): 56 ZCTAs (46 whole, 10 partial).
- **Phoenix-Mesa-Chandler metro** (CBSA 38060, `cbsa:2023`): 169 ZCTAs (158
  whole, 11 partial), `cbsaClass: "metropolitan"`. Arizona has 11 CBSAs — 7
  metro, 4 micro (Nogales, Payson, Safford, Show Low) — all classed and kept
  distinct; a micro is never merged into a metro.
- **AZ State Senate District 19** (`sldu:2024`) and **State House District 19**
  (`sldl:2024`): 43 ZCTAs each — identical because Arizona's 30 legislative
  districts each elect one senator and two representatives, so the upper and
  lower chambers share district geometry. The contract keeps them as parallel
  types with identical overlaps rather than merging them; some states differ, so
  a consumer must not assume the two chambers coincide.
- **CBSA area shares are exact:** because a CBSA is a whole-county union, a
  downtown ZCTA reads `whole: true, fraction: 1`, and an edge ZCTA that a metro
  shares with rural territory reads a partial fraction — no polygon clipping,
  no estimate.
- The `county:2020` scope spans **33,791 distinct ZCTAs** — the full 2020 ZCTA
  universe (every ZCTA lies in some county), which is what `reconcilePostalZips`
  checks a USPS ZIP against.

## Using the lookup (Admin)

Import `@/lib/census-geography/contract` for the types and
`CensusGeographyLookup`. Primary call `zctasForGrouping({ type, geoid, version })`
returns every overlapping ZCTA with `whole` + `fraction` + `fractionBasis`.
`enumerateGroupings(type, version?)` drives grouping trees; `groupingsForZcta`
is the reverse; `reconcilePostalZips` reconciles USPS ZIPs. Every response
carries `publishedVersion` and a typed `status` (OK / UNKNOWN / NOT_IN_COVERAGE
/ NOT_YET_PUBLISHED); unknown is never zero. Keys `(type, geoid, version)` are
stable and membership is immutable per version — a `cbsa` result always carries
`cbsaClass`, and a `cd:120` request returns `NOT_YET_PUBLISHED`, so Admin can
render "upcoming-election boundary not yet available" rather than showing the
119th map for a 2026 contest.

For local/non-prod, `createLookup(dataset, versionId)` over the AZ bootstrap
serves real Arizona data before production promotion.

## Build, publish, refresh

The installed production runner invokes the registered
`scripts/census-geography-refresh.mts` adapter. It reads the last promoted dataset,
checks release listings and source validators, acquires changed source files,
and assembles the national publication. `DEFAULT_SCOPES` includes all five primary
groupings and the three 2026 district plans. The adapter uses the existing
control-plane connection and evidence vault; a test or custom caller supplies
`AcquireOptions.cache` with its evidence store and release locks.

**Publication is ROUTINE and automatic** (owner directive: official Census/OMB
geography passing the checks auto-publishes; no per-import manual approval). The
routine contract `census-geography-overlaps` is in `ROUTINE_SOURCE_CONTRACTS`
(`autoPromotable: true`); its source authority `census-geography-relationships`
is an official `.gov` source that auto-qualifies (`routineAutoPromotion: true`)
under the shared `isOfficialSource` rule in
`lib/civic-data/source-authority.ts` — not a Census-specific exception. The
standing runner executes `scripts/census-geography-refresh.mts` on its cadence:
`acquireDataset({ previousDataset, discoverPlans: true })` → `censusGeographyCandidate` → the 8 civic-data validation
checks → atomic promotion of the production version pointer (RULING 283/289).

Promotion runs **only from the installed, certified runtime whose HEAD equals
the currently-served SHA** — it happens after this code merges and deploys, and
no separate production writer is ever created. A failed or partial refresh never
advances the pointer; the last good version keeps serving. Until the first
promotion, `activePublishedVersion()` reports `NOT_YET_PUBLISHED` for unpublished
scopes and the AZ bootstrap stands in for non-prod.
