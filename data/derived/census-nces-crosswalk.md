# Census ↔ NCES school-district crosswalk — provenance

Generated 2026-08-20 (America/Phoenix, `corepack pnpm stamp`) by
`scripts/build-census-nces-crosswalk.mts`. Rebuild with `corepack pnpm crosswalk:build`.

Inputs, both read from `data/reference/` and nowhere else:

| Input | Rows |
|---|---:|
| `census_govt_units_2022.csv`, `gov_type = SCHOOL DISTRICT` | 12,546 |
| `census_govt_units_2022_dependent_school_systems.csv` | 1,313 |
| **Census school systems, combined** | **13,859** |
| `nces_ccd_lea_directory_2025_26.csv`, all LEA records | 19,711 |
| — of which `derived_census_comparable = Y` | 13,299 |

## The join key, and why it is not an identifier

**There is no shared identifier in the two files this repo holds.** Census
carries `census_id_pid6` (and the legacy `census_id_gidid`, banned as a join key
by item 3). CCD carries `nces_leaid` and `state_leaid`. NCES publishes a Census
ID on the **F-33 fiscal survey**, which is a third file this repo does not have.
Acquiring it is a tracker row, and it would replace this crosswalk's method
outright rather than improve it.

So the key is **`fips_state` + normalized district name**, and the method is
**one-to-one only**.

## Normalization

The two agencies use different house styles for the same governments. Census
writes `CASTRO VAL UNIFIED SCH DIST`, `CAYUGA IND SCH DIST 902`,
`RAVENA COEYMANS SELKIRK CENTRAL SCH DIST`. CCD writes `Castro Valley Unified`,
`ASPERMONT ISD`, `Payson CUSD 1`.

**The first draft of this crosswalk matched 2,038 of 13,859 — 14.7% — and that
number was a finding about the normalizer, not about the data.** It is recorded
here because the shape recurs: a join that returns almost nothing looks
identical to a universe that genuinely does not overlap, and only opening the
unmatched rows tells them apart.

Three passes, applied identically to both sides:

1. **Expand word abbreviations** — `SCH`→`SCHOOL`, `UNIF`→`UNIFIED`,
   `ELEM`→`ELEMENTARY`, `CO`→`COUNTY`, and 20 others.
2. **Expand district-type acronyms** — `ISD`, `CISD`, `CUSD`, `CCSD`, `USD`,
   `SD`, `UFSD`, `CSD`, `RSD`, `ESD`, `MSD`, `PSD`, `LSD`.
3. **Drop structural tokens** — the words saying what KIND of district this is
   rather than WHICH one: `SCHOOL`, `DISTRICT`, `UNIFIED`, `CONSOLIDATED`,
   `COMMUNITY`, `UNIT`, `CENTRAL`, `UNION`, `FREE`, `REGIONAL`, `LOCAL`,
   `PUBLIC`, `ELEMENTARY`, `JOINT`, and similar.

`CITY` and `COUNTY` are **kept**. `Albertville City` and `Marshall County` are
different governments and both agencies keep the word.

**District numbers are held separately from the key.** Illinois carries them on
both sides (`PAYSON COMMUNITY UNIT SCHOOL DISTRICT 1` / `Payson CUSD 1`); Texas
carries them on the Census side only (`CAYUGA IND SCH DIST 902` / `Cayuga ISD`).
In the key they would break Texas; discarded outright they would merge Illinois
districts 1 and 2. So a number is used **only to break a tie the core could
not, and only where both sides carry one**. A number matched against nothing is
not evidence.

## Matches are never forced

A normalized name resolving to more than one row on either side is **AMBIGUOUS**
and is counted as **UNMATCHED on both sides**. It is never resolved by taking
the first row, the largest enrollment, or the nearest name. Each of those is a
guess wearing a match's clothes, and the cost lands downstream as a district
card confidently pointing at the wrong district.

**166 ambiguous keys** remain after the number tie-break.

## Results

**9,776 matched pairs.**

### Unmatched, Census side

| Denominator | Unmatched | % |
|---|---:|---:|
| 12,546 independent school districts | 3,373 | 26.89% |
| 1,313 dependent school systems | 710 | 54.07% |
| 13,859 combined school systems | 4,083 | 29.46% |

### Unmatched, NCES side

| Denominator | Unmatched | % |
|---|---:|---:|
| 19,711 CCD LEA records | 9,935 | 50.40% |
| 13,299 census-comparable LEAs | 3,622 | 27.24% |

**The 19,711 denominator is the honest one to state and the wrong one to be
alarmed by.** 6,412 of those records are charter agencies, service agencies,
supervisory unions and state-operated agencies. They are not governments and
have no Census row to match, by construction. The census-comparable 13,299 is
the denominator a coverage claim should use; the 19,711 is stated beside it so
nobody has to guess which one a percentage came from.

## How dependent school systems are treated, and why

Census files school systems that are an **agency of another government** — a
city, a county, a state — separately from independent school-district
governments. CCD makes no such distinction: a Connecticut or Maine or
Massachusetts school system that Census records as dependent appears in CCD as
an ordinary regular district.

So the crosswalk runs against the **combined 13,859**. Matching CCD against the
independent 12,546 alone would report 1,313 real, correctly-recorded school
systems as NCES rows with no Census counterpart — **a fabricated gap**, and one
that would concentrate entirely in the dependent-district states.

The unmatched counts are then reported against **both** denominators above, so
neither reading is hidden by the other.

## What the remaining gap is, and what it is not

The 4,083 unmatched Census systems and 3,622 unmatched comparable LEAs are
**not** evidence that those governments are missing from either universe. They
are the cost of joining on a name rather than an identifier, plus a genuine
vintage gap: Census reference period is 2022, CCD is SY 2025-26 preliminary
(as of 2026-05-06), roughly 3.5 years apart, across which districts consolidate,
dissolve and rename.

Worst ten states by unmatched Census systems: MO 431 · CA 314 · NY 236 ·
IL 235 · NJ 229 · ME 218 · MA 207 · OH 201 · CO 159 · TX 143.

**Montana is excluded from any state-level school-district coverage claim**:
CCD reports 387 regular open districts, Census reports 311
independent school districts, and Montana has zero dependent school systems to
explain the gap. That variance is a tracker row, not a crosswalk artifact.

## What this crosswalk may and may not be used for

- It **may** establish that a Census school-district government and an NCES LEA
  are the same body, for the 9,776 pairs it names.
- It **may not** be used to claim a body count. Census counts governments; a
  school district is one government and holds one governing board, but
  a body count is never sourced from a government count.
- It **may not** be treated as complete. The unmatched rows are named by
  denominator above and are work items, not absences.
