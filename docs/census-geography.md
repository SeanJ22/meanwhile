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

## Sources (original Census inputs only)

All from `https://www2.census.gov`, US federal public-domain, robots-allowed for
`*`. Six of seven types have a **direct national ZCTA relationship file**
(`tab20`, pipe-delimited); CBSA is derived. No HUD or commercial ZIP database is
used as an input.

| Type | Version | Census file (`.../rel2020/…`) | Size | SHA-256 (head) | Last-Modified |
| --- | --- | --- | --- | --- | --- |
| congressional_district | cd:119 | `cd-sld/tab20_cd11920_zcta520_natl.txt` | 6.2 MB | `57fad59f65af…` | 2024-10-24 |
| county | county:2020 | `zcta520/tab20_zcta520_county20_natl.txt` | 6.8 MB | `3ed41278d637…` | 2021-12-09 |
| state_leg_upper | sldu:2024 | `cd-sld/tab20_sldu202420_zcta520_natl.txt` | 7.4 MB | `49f339d330c5…` | 2024-10-24 |
| state_leg_lower | sldl:2024 | `cd-sld/tab20_sldl202420_zcta520_natl.txt` | 8.7 MB | `ba7458e3582d…` | 2024-10-24 |
| place | place:2020 | `zcta520/tab20_zcta520_place20_natl.txt` | — | — | 2021-12-09 |
| county_subdivision | cousub:2020 | `zcta520/tab20_zcta520_cousub20_natl.txt` | — | — | 2021-12-09 |

Reachability: `www2.census.gov` answers from a workstation but is proxy-blocked
for the runner, so the importer runs locally and the promote path consumes the
built dataset, not the live source. The acquirer records URL, byte size,
SHA-256, and Last-Modified for every file it actually reads (`provenance`).

## Method and shares

Each `tab20` row carries a geography, a ZCTA, and `AREALAND_PART` (the land area
of their overlap). A ZCTA is an **edge** of a geography if it shares any land
with it — no minimum threshold. The overlap **share is area-based**:
`AREALAND_PART / AREALAND_ZCTA5_20`; `whole` means share ≥ 0.9999. These files
carry no population, so **population weighting is honestly unavailable**
(`fractionBasis: "area"`); a population share would need a block-population join
and is a future enhancement, never a guess. Rows whose ZCTA side is blank are
the part of the geography in no ZCTA — skipped. A repeated (geography, ZCTA)
pair is summed, never collapsed, so a split relationship is neither doubled nor
lost.

## Coverage (this build) and gaps

**Shipped, national, exact, area shares:** congressional_district (119th),
county, state_leg_upper (2024 plan), state_leg_lower (2024 plan).

National counts (from the tab20 files):

| Type | Groupings | ZCTA edges |
| --- | --- | --- |
| cd:119 | 443 | 40,147 |
| county:2020 | 3,232 | 46,960 |
| sldu:2024 | 1,963 | 48,029 |
| sldl:2024 | 4,878 | 56,878 |

**Owed, with blockers (not silently substituted):**
- **cbsa (metro/micro)** — no direct ZCTA relationship file; derive
  ZCTA↔county ⋈ county↔CBSA from the 2023 OMB delineation
  (`list1_2023.xlsx`). Blocker: the delineation is `.xlsx` and no xlsx parser is
  installed; needs a delimited source or minimal parsing. Metro = M1, micro = M2.
- **place, county_subdivision** — direct files exist (above); deferred to keep
  the first payload small. Additive.
- **cd:120 (120th Congress / 2026 election)** — **no Census file exists**
  (`tab20_cd12020_zcta520_natl.txt` is a 404). For states whose map is unchanged
  cd:120 equals cd:119; for the redrawn toss-up states (CA, FL, OH, TX) it is a
  real gap and must not be filled with cd:119 lines.

The priority batch is the 21 toss-up districts across 14 states (AZ, CA, CO, FL,
IA, MI, NJ, NY, OH, PA, TX, VA, WA, WI); the shipped types cover their
congressional, county, and both state-legislative-chamber overlaps nationally.

## Verification

`tests/census-geography.test.ts` covers the parser (whole/partial, skipped
remainder, split relationships, loud failure on a changed header) and the read
model against the committed AZ fixture (`lib/census-geography/bootstrap-az.json`).

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

## Using the lookup (Admin)

Import `@/lib/census-geography/contract` for the types and
`CensusGeographyLookup`. Primary call `zctasForGrouping({ type, geoid, version })`
returns every overlapping ZCTA with `whole` + `fraction` + `fractionBasis`.
`enumerateGroupings(type, version?)` drives grouping trees; `groupingsForZcta`
is the reverse; `reconcilePostalZips` reconciles USPS ZIPs. Every response
carries `publishedVersion` and a typed `status` (OK / UNKNOWN / NOT_IN_COVERAGE
/ NOT_YET_PUBLISHED); unknown is never zero. Keys `(type, geoid, version)` are
stable and membership is immutable per version.

For local/non-prod, `createLookup(dataset, versionId)` over the AZ bootstrap
serves real Arizona data before production promotion.

## Build, publish, refresh

Acquire + build the national dataset (runs locally, reaches www2):

```bash
pnpm exec tsx scripts/census-geo-build.mts --only=cd119,county,sldu,sldl --out=<off-repo>/census-geo-dataset.json
```

`--states=<fips,…>` restricts to a priority batch; the committed AZ fixture was
built with `--states=04`. Reruns are safe: identical bytes produce an identical
dataset, and a failed build never overwrites a good one.

**Publish through the authorized PDC path only.** The dataset promotes via a
manual civic-data contract (`EXPLICIT_OWNER_INVOCATION_ONLY`) — see the wiring in
`lib/civic-data/manual-contracts.ts`. Promotion runs **only from the installed,
certified runtime whose HEAD equals the currently-served SHA**, so it happens
after this code merges and deploys; it cannot be flipped from a worktree, and no
separate production writer is created. Until then `activePublishedVersion()`
reports NOT_YET_PUBLISHED for unpublished scopes and the bootstrap stands in.

Owner activation (post-deploy), once the runtime checkout is at the certified
SHA:

```bash
node scripts/installed-runtime-command.mjs manual-promote --contract=census-geography-overlaps
```
