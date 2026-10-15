These are saved Census ACS five-year 2024 source samples, extracted without
changing values from commit `31aa77abd` in this repository. The original
`data/reference/acs5_2024_b01003_state.md` and `_zcta.md` record keyed HTTP 200
captures on 2026-09-06. `state.csv` contains all 52 state/DC/Puerto Rico rows;
`zcta.csv` contains six rows from the captured 33,772-row national table.

Source: U.S. Census Bureau (official, public domain).
Dataset: https://api.census.gov/data/id/ACSDT5Y2024
Variables: B01003_001E (population), B01003_001M (90% margin of error).
Routes, without credentials:

- https://api.census.gov/data/2024/acs/acs5?get=NAME,B01003_001E,B01003_001M&for=state:*
- https://api.census.gov/data/2024/acs/acs5?get=NAME,B01003_001E,B01003_001M&for=zip%20code%20tabulation%20area:*

These files are the previously saved CSV normalization, not original HTTP
response bytes. An empty margin preserves the publisher's unstated margin;
it does not assert zero. The acquisition notes do not establish a publication
day, so these fixtures leave it unknown. The source's 2020–2024 estimate period
and capture date stay distinct. Protocol test doubles in `src-ac.test.ts`
are labeled separately and do not represent captured government facts.

Fresh keyed bulk HTTP 200 samples were captured on 2026-10-12 for counties (AZ),
places (NJ), townships (NH), congressional districts (AZ), state upper districts
(AZ), state lower districts (NJ), unified school districts (AZ), elementary
school districts (NJ), secondary school districts (NH), and the nation.
`geography-samples.json` keeps the exact header and first three returned data
rows, the credential-free routes, capture times, total response row counts and
SHA-256 of each complete original response. These excerpts are fixtures, not
complete national datasets. `catalog.json` is an exact dataset-list excerpt.
`release-schedule.html` is the exact official table row giving the five-year
release date: January 29, 2026. The catalog's earlier modified timestamp is
not the publication date.

The Vermont lower-chamber excerpt was captured again on 2026-10-13 UTC to
retain the native `A-1` district identifier that exposed the parser defect.

The initial connection errors came from the command sandbox. Network-enabled
commands using the inherited proxy reached both Census and GitHub. No source
outage remains established here. Production loading and live reader checks
remain the post-River DONE checks; these captures do not write production.
