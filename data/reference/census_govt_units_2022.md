# census_govt_units_2022.csv — source note

## Source
- **Source URL (direct file):** https://www2.census.gov/programs-surveys/gus/datasets/2022/govt_units_2022.ZIP
- **Landing page:** https://www.census.gov/data/datasets/2022/econ/gus/public-use-files.html
- **Verified against the source map** in `inputs/compass_artifact_...markdown.md`, "LOCAL level" table,
  row "Census of Governments — Government Units file". The URL in that table matches the one used. No URL drift.
- **Dataset:** U.S. Census Bureau, 2022 Census of Governments: Organization — Governments Integrated Directory.

## Acquisition
- The ZIP was **not downloaded by me.** This environment's proxy blocks `www2.census.gov`
  (`403 — request blocked: no rule or allowlist entry allows host "www2.census.gov"`). The file was supplied
  by Sean in `inputs/` and staged from there.
- Staged: 2026-08-19. ZIP size 11,459,763 bytes.
- `sha256(govt_units_2022.ZIP)` = `3ef3d93c91697b00d4d53384176dc584db9dacbd0f0a23e45657f0a3a1058c28`
- Because I did not fetch it, I **cannot independently attest that this ZIP is byte-identical to what the
  Census URL serves today.** Its internal contents are self-consistent and match published counts (below),
  which is strong but not equivalent to verifying the transfer.
- **Attested 2026-09-23 (Phoenix):** fetched directly from the source URL above, it is 11,459,763 bytes
  (`Last-Modified: Thu, 24 Aug 2023 12:44:48 GMT`) with sha256
  `3ef3d93c91697b00d4d53384176dc584db9dacbd0f0a23e45657f0a3a1058c28` — byte-identical to the supplied file.
  The registration contract (`lib/registration/`) retains this attestation for held evidence.
- **Conditional requests, measured 2026-09-23 (Phoenix, evening):** census.gov (served through Cloudflare)
  sends no ETag. A HEAD answers 200 with `content-length: 11459763` and the same `Last-Modified`. A GET with
  `If-Modified-Since: Thu, 24 Aug 2023 12:44:48 GMT` answers **304 with a 0-byte body**; a stale
  `If-None-Match` answers 200, so the 304 is a real condition, not a blanket reply. One full GET in the same
  session again returned 11,459,763 bytes with sha256 `3ef3d93c…058c28` under that `Last-Modified`, binding
  the date to the held bytes. Registration now caches identified immutable releases and checks conditionally.
  A 304 retains the original observation date; changed complete bytes are parsed and validated before publication.
- Archive contents: `Govt_Units_2022_Final.xlsx` (11,395,131 b, dated 2023-08-21) and
  `Government_Units_List_Documentation_2022.pdf` (206,919 b, dated 2023-08-24).
- Source format: XLSX (4 sheets). Output format: UTF-8 CSV, header row, 25 columns.

## Workbook sheets — what each contains
| Sheet | Data rows | Contents |
|---|---|---|
| `General Purpose` | 38,736 | Counties, municipalities, townships in one sheet, separated by `UNIT_TYPE`. 19 cols; the only sheet with `POPULATION`/`POPULATION_YEAR` and `FIPS_PLACE`. |
| `Special District` | 39,555 | Independent special-district governments. 16 cols; the only sheet with `FUNCTION_NAME` (Census function classification, e.g. "91 - WATER SUPPLY UTILITY"). |
| `School District` | 12,546 | **Independent** school district governments. 18 cols; carries `ENROLLMENT`/`ENROLLMENT_YEAR`/`SCHOOL_LEVEL_DESCRIPTION`. |
| `DEP School Dist` | 1,313 | **Dependent** school systems — school operations run as an agency of a county/municipal/township/state government, *not* separate governments. 19 cols. Has `UNIT_TYPE` naming the parent government type. |

## Row counts vs expected
Denominator: **90,837 rows** in `census_govt_units_2022.csv`.

| Type | Count | Expected | Delta | Share of 90,837 |
|---|---:|---:|---:|---:|
| County | 3,031 | 3,031 | 0 | 3.34% |
| Municipal | 19,491 | 19,491 | 0 | 21.46% |
| Township | 16,214 | 16,214 | 0 | 17.85% |
| Special district | 39,555 | 39,555 | 0 | 43.55% |
| School district | 12,546 | 12,546 | 0 | 13.81% |
| **TOTAL** | **90,837** | **90,837** | **0** | 100% |

Exact match on every category. No rows dropped, added, or altered to reach it.

## Scope decision — why 90,837 and not 92,150
The 1,313 `DEP School Dist` rows are **excluded** from the main CSV. They are dependent agencies, not
independent governments, and are not part of the 90,837 count. They are not discarded — they are written to
`census_govt_units_2022_dependent_school_systems.csv` (1,313 rows) with the same 25-column schema and
`gov_type = DEPENDENT SCHOOL SYSTEM`. 90,837 + 1,313 = 92,150 total workbook data rows, all accounted for.

## ⚠ The source markdown states 90,887 — that number is wrong
`inputs/compass_artifact_...markdown.md` states "90,887 governments (2022)" in four places (lines 6, 147,
181, 187), while listing component counts on the same line that sum to **90,837**:
`3,031 + 19,491 + 16,214 + 39,555 + 12,546 = 90,837`. The workbook agrees with the components, not the total.
**90,887 is an arithmetic error in the vendor-landscape document, repeated four times.** The correct figure
is 90,837. Worth correcting at the source, since that document is being used as a planning denominator.

## Completeness — gaps left as gaps
Nothing inferred, interpolated, or filled. Measured against 90,837:

| Field | Blank | % |
|---|---:|---:|
| `unit_name` | 0 | 0.00% |
| `fips_state`, `fips_county`, `county_area_name` | 0 | 0.00% |
| `state` | 13 | 0.01% |
| `city`, `zip` | 13 | 0.01% |
| `address1` | 14 | 0.02% |
| `title` | 2,028 | 2.23% |
| `web_address` | 51,655 | 56.87% |
| `census_id_pid6` | 0 | 0.00% |
| `census_id_gidid` | 36 | 0.04% |
| `population` (denom 38,736 General Purpose) | 0 | 0.00% |
| `enrollment` (denom 12,546 School District) | 0 | 0.00% |

## Things that would affect how you trust this data
1. **`web_address` is blank for 56.87% of units, and the populated 43% is not quality-controlled.** Census
   documentation: web addresses are self-reported and "there have been minimal quality control procedures
   conducted on the validity of these addresses." This matters directly for Step 4 — you cannot use this
   column alone as an agenda-platform discovery surface for a majority of units.
2. **36 rows have a blank `census_id_gidid`.** This is not corruption: Census documentation states the GIDID
   is "a legacy unit identifier, which began being phased out (not generated) in 2022." All 36 are special
   districts. **Use `census_id_pid6` as the join key** — it is unique and populated across all 90,837 rows
   (0 duplicates, 0 blanks). `census_id_gidid` is unique apart from those 36 blanks.
3. **13 rows have blank `state`, `city`, `zip`, `address1`** — all Texas special districts (MUDs, drainage and
   groundwater districts), PID6 248086–248151. Their `fips_state` is `48`, so the state **is** recoverable, but
   I did not fill it, per instruction to leave gaps as gaps. Fixing these 13 is a one-line FIPS→state map if
   you want it.
4. **339 rows have `is_active = N`** (26 municipal, 70 township, 242 special district, 1 school district;
   0 counties). These are **correctly included**. Census documentation: dormant units are "not disincorporated
   and not financially active" but "still exist and are considered active units for the Census Bureau
   government count." Filtering them out would break the 90,837 reconciliation.
5. **`state` has 52 distinct values** (50 states + DC + blank). DC contributes 3 units. Hawaii has only 21 —
   genuinely the fewest of any state, an artifact of its consolidated county structure, not missing data.
6. **Vintage.** Reference period is 2022; the XLSX was built 2023-08-21. Population estimates are 2021,
   enrollment 2020 — the columns carry their own year fields, use them. Census publishes annual org updates,
   so this is a 2022 snapshot, not a current registry.
7. **`county_area_name` is approximate for multi-county units.** Census documentation: for governments that
   cross county boundaries the value is the county "most served" or where the government is headquartered.
   Do not treat it as an exhaustive service-area mapping.

## License / use restrictions
- U.S. Census Bureau work product. As a work of the U.S. federal government it carries **no copyright in the
  United States and is in the public domain**; free to redistribute and use commercially.
- No API key, registration, or terms acceptance required for the bulk file.
- Census requests citation as: *U.S. Census Bureau, 2022 Census of Governments: Organization.*
- The file is a snapshot of the Census Bureau's Governments Master Address File and contains official contact
  names/titles and mailing addresses. No restriction attaches, but it is contact data — handle accordingly.
