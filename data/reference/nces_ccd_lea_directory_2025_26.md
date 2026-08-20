# nces_ccd_lea_directory_2025_26.csv — source note

## Source
- **Source URL (landing page):** https://nces.ed.gov/ccd/files.asp — the URL given in the source map's
  "LOCAL level" table, row "NCES Common Core of Data (school districts)". Still live; no URL drift.
  (The map also lists https://nces.ed.gov/ccd/ccddata.asp.)
- **Dataset:** U.S. Department of Education, National Center for Education Statistics, **Common Core of Data
  (CCD), "Local Education Agency Universe Survey," Preliminary — LEA Directory, SY 2025-26.**
- **Publication number:** NCES 2026-022 · **File version:** `0a` Preliminary · **Data as of:** 2026-05-06 ·
  **Release:** July 2026
- **Survey file:** 029 — Directory

## Acquisition
- The ZIP was **not downloaded by me.** This environment's proxy blocks `nces.ed.gov`
  (`403 — request blocked: no rule or allowlist entry allows host "nces.ed.gov"`), and the file list on
  `/ccd/files.asp` is JavaScript-rendered so the download URLs could not even be enumerated remotely.
  Sean supplied both files in `inputs/`; they were staged from there.
- Staged 2026-08-19. `ccd_lea_029_2526_w_0a_050626.zip`, 2,754,502 bytes.
  `sha256` = `376539484b400c0c6d72d100766dc7acacc8725f464556062e2920b3a9b6a64c`
- Archive contents: `ccd_lea_029_2526_w_0a_050626.csv` (8,161,382 b) and an identical-content
  `.sas7bdat` (9,437,184 b). The **CSV** was used.
- Documentation used: `SY_2025-26_LEA_Directory_Companion_2026-022.xlsx` (76,212 b), also supplied in `inputs/`.
- Source format: CSV, 58 columns. Output format: UTF-8 CSV, header row, 44 columns.
- **I did not fetch this from nces.ed.gov, so I cannot attest the transfer** — only that the contents are
  internally consistent and match NCES's own published record count (below).

## Row count — verified against NCES's own documentation
- **19,711 rows** (denominator: 19,711 data rows in the source CSV — 1:1, none dropped or added)
- The NCES companion workbook's Introduction sheet independently states: LEA level, **58 variables,
  19,711 unique entities, 19,711 records.** My parse matches exactly.
- Every `SY_STATUS` frequency in my parse also matches the companion's Stats-Cat sheet exactly:
  Open 19,314 · Closed 128 · New 98 · Inactive 80 · Future 60 · Added 23 · Changed Boundary/Agency 7 · Reopened 1.
- `nces_leaid` (NCES Agency ID, `LEAID`): 19,711 distinct, **0 duplicates, 0 blanks**, all 7 characters.
  Safe as the primary key.

## ⚠ Comparison against the Census 12,546 school districts
**These two files count different things. A raw 19,711 vs 12,546 comparison is meaningless.** CCD's LEA
universe includes charter agencies, service agencies, supervisory unions and state-operated agencies that are
not governments; Census counts *independent school district governments* only, and puts school systems that
are agencies of another government in a separate file (the 1,313 dependent systems from Step 1).

Successive filters, denominator 19,711:

| Filter | Rows | vs Census 12,546 |
|---|---:|---:|
| All CCD LEA records | 19,711 | +7,165 |
| + in 50 states + DC (drops 187 outlying-area/BIE rows) | 19,524 | +6,978 |
| + `SY_STATUS = Open` | 19,127 | +6,581 |
| + `LEA_TYPE` 1 or 2 (regular public school districts) | **13,299** | **+753 (+6.0%)** |
| + has ≥1 operational school | 13,177 | +631 (+5.0%) |

The 187 excluded non-state rows: BIE 174, GU 5, VI 2, and 1 each for AS, FM, MH, MP, PW, PR.

**The right bracket:** Census independent school districts (12,546) + Census dependent school systems (1,313)
= **13,859** school systems. CCD regular open districts = **13,299**. So CCD sits *between* the two Census
figures, **560 below** the combined Census total — which is what you would expect from a 2022 → SY 2025-26
vintage gap plus district consolidation. The `derived_census_comparable = Y` flag in the CSV marks these
13,299 rows.

**Per-state, the naive comparison is dominated by dependent-district states.** Where Census classifies
districts as dependent, CCD still lists them as regular districts, so CCD appears to massively overcount:
CT +151, ME +151, MA +238, VA +130, TN +127, NC +121, MT +76. Adding Census's dependent systems back
collapses those to near zero: CT +2, MA +4, RI 0, TN −1, VA −3, AK −3, HI 0, ME −11. The states that
*remain* far apart after that correction are consolidation-driven declines since 2022 — CA −74, TX −57,
NC −53, OR −52, OH −46 — plus one genuine outlier, **MT +76**, which is not explained by dependency and
is worth a look before you rely on Montana counts.

No attempt was made to reconcile these to a single number, and no rows were dropped to close the gap.

## Completeness — gaps left as gaps
Denominator 19,711:

| Field | Blank | % |
|---|---:|---:|
| `nces_leaid`, `lea_name`, `state`, `phone` | 0 | 0.00% |
| `mailing_street1`, `location_street1`, `mailing_city`, `mailing_zip` | 0 | 0.00% |
| `operational_schools` | 0 | 0.00% |
| `grades_offered` | 1,113 | 5.65% |
| `website` | 2,365 | 12.00% |
| `supervisory_union_id` | 19,424 | 98.54% |

The blank counts for the source columns match the companion workbook's Stats-Char sheet
(e.g. `UNION` blank 19,424 / reported 287).

## Things that would affect how you trust this data
1. **This is version `0a` PRELIMINARY, not final.** NCES publishes `1a` provisional and later revisions;
   counts, statuses and names *will* change. The SY 2024-25 comparison in the companion shows 195 LEAs on
   one year's file but not the other. Do not treat these as settled figures.
2. **Vintage mismatch with Step 1 is ~3.5 years.** Census reference period 2022; CCD as-of 2026-05-06.
   Any join between the two files is a cross-vintage join and will show real churn, not just error.
3. **`website` coverage is far better here than in the Census file — 88.0% vs 43.1%.** For Step 4 platform
   detection, CCD is the better website surface for school districts, and BoardDocs is a school-board
   platform, so this matters directly. NCES does not document QC on these URLs, so validate before crawling.
4. **`OPERATIONAL_SCHOOLS = 0` for a meaningful number of LEAs** (sum 100,152 schools across 19,711 LEAs,
   min 0, max 864, mean 5.08 per the companion). A zero is often an administrative or brand-new agency, not
   an error — do not filter on it blindly.
5. **4,422 rows (22.4%) are independent charter districts** (`LEA_TYPE = 7`). They are LEAs, not governments.
   They are retained in this file and excluded from `derived_census_comparable`.
6. **`grades_offered` is a derived convenience column** — a `;`-separated list built from the 17
   `G_*_OFFERED` flag columns in the source. It adds no information and drops none; the source flags are
   deterministic. `nogrades`, `grade_span_low/high`, `level` and `igoffered` are carried through unmodified.
   `derived_census_comparable` is the only other derived column. No source value was altered anywhere.
7. **Two states use `MSTATE`/`LSTATE` that can differ from `ST`** for out-of-state administrative addresses;
   `out_of_state_flag` is carried through. Use `ST`/`fips_state` for jurisdiction, not the address state.

## License / use restrictions
- **"Access Control: Public; no access restrictions"** — stated in the NCES companion workbook Introduction.
- U.S. federal government work: **no copyright in the United States, public domain**, free to redistribute
  and use commercially.
- Suggested citation: *U.S. Department of Education, National Center for Education Statistics, Common Core of
  Data (CCD), "Local Education Agency Universe Survey," Preliminary version 0a, School Year 2025-26
  (NCES 2026-022).*
- Contact for the file: EDFacts Partner Support Center, edfacts@ed.gov.
- Contains official district mailing addresses and phone numbers — public record, but contact data.
