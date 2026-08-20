# census_govt_units_2022_dependent_school_systems.csv — source note

Companion/spill file to `census_govt_units_2022.csv`. **Source, acquisition, checksum, and license are
identical** — see `census_govt_units_2022.md`. Only the sheet selection differs.

- **Source URL:** https://www2.census.gov/programs-surveys/gus/datasets/2022/govt_units_2022.ZIP
- **Sheet:** `DEP School Dist` (the 4th of 4 sheets in `Govt_Units_2022_Final.xlsx`)
- **Fetch/stage date:** 2026-08-19 (supplied by Sean in `inputs/`; www2.census.gov is proxy-blocked here)
- **Format:** UTF-8 CSV, header row, same 25-column schema as the main file, `gov_type = DEPENDENT SCHOOL SYSTEM`
- **Row count:** **1,313** (denominator: 1,313 data rows on the `DEP School Dist` sheet — 1:1, none dropped)

## Why this is a separate file
These are **dependent** school systems: school operations run as an agency of an existing county, municipal,
township, or state government. They are **not independent governments** and are **not** part of the 90,837
count. Keeping them in the main file would break that reconciliation; deleting them would lose data present
in the source. So they are split out rather than merged or discarded.

- Parent government type, from `unit_type_raw`: county 571, township 479, municipal 227, state 36.
- 90,837 (independent) + 1,313 (dependent) = 92,150 = every data row in the workbook. Nothing unaccounted for.

## Completeness
- `is_active`: all 1,313 are `Y`. No dormant units.
- 21 distinct `state` values — dependent school systems are concentrated in a minority of states; this is a
  real feature of US school governance, not missing data.
- `fips_county` and `county_area_name` are blank for the 36 state-level (`0 - STATE`) rows, which have no
  county parent. Left as gaps, not inferred.

## License
Public domain (U.S. federal government work). Cite as: *U.S. Census Bureau, 2022 Census of Governments: Organization.*
