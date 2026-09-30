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

The acquirer records URL, byte size, SHA-256, and Last-Modified for every file
it actually reads (`provenance.sourceChecksums`, index-aligned with
`sourceFiles`). Reruns are idempotent: identical source bytes yield an identical
dataset, and a failed/partial fetch never replaces a good build.

**Reachability:** the standing runner runs on the production-runtime checkout
(Sean's machine), which reaches `www2.census.gov` directly, so the routine
refresh fetches the source live on the runner — the dataset it builds in memory
is the promotion payload; there is no object-storage staging step. (An earlier
note that www2 was proxy-blocked applied to the hosted-CI environment, not the
runner.)

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

**Cost, cadence, and status.** The grf block files are large (~55 MB/state, ~2.9 GB
nationally) versus ~6 MB for a tab20 CD file, while the 2026 map is stable until the
election. So `cd120` is **opt-in** (built via `--only=…,cd120`; not in
DEFAULT_SCOPES) and is intended to refresh at a **lower cadence** than the monthly
tab20 refresh — the owner picks the cadence (recommendation: quarterly/on-demand).
`acquireDataset({ only: ["cd120"], states })` state-filters the download.

**State Senate / State House 2026 version clarity (determined from Census data).**
The grf/2026 `SLDUST`/`SLDLST` (grfn `LSY=2026`) are the current legislative
districts. Comparing each ZCTA's dominant district between grf‑2026 and the tab20
2024 plan nationally (2.90 GB): **state-leg maps are stable 2024→2026 except
Michigan's State Senate (7.4% of ZCTAs moved — a real 2026 redraw) and, borderline,
South Dakota (~5–7%, both chambers).** ("Nebraska State House 100%" is an
artifact — Nebraska's legislature is unicameral, so it has no SLDL.) So the shipped
`sldu:2024`/`sldl:2024` accurately cover the 2026 election for 48+ states; Michigan's
Senate is the one clear place they differ. `grf.ts`'s `GrfTarget` is generic, so
`sldu:2026`/`sldl:2026` build from the SAME grf pass as cd:120 (one ~2.9 GB
download yields all three) — recommended to bundle into the upcoming-election build
when the owner activates it, for full 2026 correctness including Michigan's Senate.

## Verification

`tests/census-geography.test.ts` covers the parser (whole/partial, skipped
remainder, split relationships, loud failure on a changed header) and the read
model against the committed AZ fixture (`lib/census-geography/bootstrap-az.json`,
all five primary groupings for Arizona).

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

Acquire + build the national dataset (runs locally or on the runner, reaches
www2):

```bash
pnpm exec tsx scripts/census-geo-build.mts --out=<off-repo>/census-geo-dataset.json
```

With no `--only`, this builds the five primary groupings (DEFAULT_SCOPES).
`--states=<fips,…>` restricts to a priority batch; the committed AZ fixture was
built with `--states=04`.

**Publication is ROUTINE and automatic** (owner directive: official Census/OMB
geography passing the checks auto-publishes; no per-import manual approval). The
routine contract `census-geography-overlaps` is in `ROUTINE_SOURCE_CONTRACTS`
(`autoPromotable: true`); its source authority `census-geography-relationships`
is an official `.gov` source that auto-qualifies (`routineAutoPromotion: true`)
under the shared `isOfficialSource` rule in
`lib/civic-data/source-authority.ts` — not a Census-specific exception. The
standing runner executes `scripts/census-geography-refresh.mts` on its cadence:
`acquireDataset()` → `censusGeographyCandidate` → the 8 civic-data validation
checks → atomic promotion of the production version pointer (RULING 283/289).

Promotion runs **only from the installed, certified runtime whose HEAD equals
the currently-served SHA** — it happens after this code merges and deploys, and
no separate production writer is ever created. A failed or partial refresh never
advances the pointer; the last good version keeps serving. Until the first
promotion, `activePublishedVersion()` reports `NOT_YET_PUBLISHED` for unpublished
scopes and the AZ bootstrap stands in for non-prod.
