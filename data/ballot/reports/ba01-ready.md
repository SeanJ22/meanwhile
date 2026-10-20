# BA-01 verified expansion batch

This batch prepares corrected input for the normal daily `ballot-contests:<ST>`
assembler. River ships this branch; the runner publishes on its next daily pass.
No production credential is required by this lane. This report does not mark the
national coverage objective or live ZIP acceptance complete.

## Reader changes

- Added 3,037 contests, 4,779 candidacy records and 140 measures. Raw holdings are
  now 9,073 contests, 16,449 candidacies and 282 measures across 50 states and DC.
  These are inventory counts, not completeness denominators.
- Texas now includes its two separately certified legislative special elections,
  eight Austin propositions, Travis countywide sample offices, and 1,222 printed
  countywide contests / 1,346 candidates across all 254 counties. Existing Travis
  identities are reused. Dallas's certified criminal district attorney write-in
  is also included. Precinct offices, other local measures and later county
  write-in lists remain open.
- Arizona, Colorado and Wisconsin explicitly preserve the official governor /
  lieutenant governor pairs. The reader shows each verified pair as one choice;
  original records and IDs remain in the saved projection. Different stated
  parties remain visible.
- Ohio's explicit October 15 Ron Ula / Michael C. Lehnerd withdrawal becomes a
  filing-change notice instead of a current choice. The earlier filing stays
  available with its original ID and provenance.
- A newer official election authority can supersede an older authority's list
  for the same contest, election and division. This lets New Jersey's statewide
  certification replace its older county certification without losing unrelated
  county data.

## Verification

The focused assembler, worker, source, geography and ticket checks passed
(69 Node subtests), as did 11 Northeast source replay tests and TypeScript with
the repository's generated `.next` files excluded. The final withdrawal check
and production-schema rerun are recorded in the commit validation.

The database integration applies all 46 journaled production migrations to an
isolated PostgreSQL-compatible PGlite copy, seeds each state's prior `river`
ballot, runs the actual assembler and Postgres store, and reads the promoted
typed projection back. All 51 state/DC publications passed and every previous
contest, candidacy and measure ID was retained. Ticket mates also survive typed
readback and the normal reader projection. This is a copy built from the real
schema and prior checked-in ballots, not a claim to have copied production rows.

Raw official captures, hashes, source timestamps and replay scripts are included.
Per-state comparison results and remaining acquisition work are in:

- `data/ballot/reports/ba01-inventory.json`
- `data/ballot/reports/ba01-tx-ca.json` and `ba01-tx-counties.json`
- `data/ballot/reports/ba01-northeast.json`
- `data/ballot/evidence/ba01-great-lakes/ba01-great-lakes-comparison.json`
- `data/ballot/evidence/ba01-south/report.md`
- `data/ballot/ba01-southeast-comparison.json`
- `data/ballot/ba01-pacific-evidence/README.md`
- `data/ballot/ba01-pacific-wi-evidence/comparison.json`
- `data/ballot/ba01-west-evidence/state-comparison.json`

## Open work

Core race gaps remain: Ohio 20 legislative districts, Wisconsin 70 legislative
districts, Pennsylvania 93 regular districts, Arkansas 57 regular districts and
Illinois 17 districts. New Hampshire's full official denominator is unmeasured;
municipal sample recovery is active. Alaska's core certification and Minnesota's
final general-election roster still need complete replay. Arizona's comparison
records its three congressional certification/sample limitations. Other reports
state source scope, write-in and local coverage limitations explicitly.

The lanes continue those comparisons and county/city sample acquisition in
parallel. Territories still have no local input file. They are named gaps.

Oversight owns the live race-by-race acceptance after River and the daily runner.
`ba-01-live-baseline.json` records the 15 requested ZIP checks before this batch;
none is claimed complete. Austin and San Francisco already hold the missing House
contests in their data. Their live pages omit them because the reader has not
established the congressional district. Miami also reports that district gap,
and Detroit reports a state Senate district gap. Those resolver dependencies
remain outside this lane's owned files and must be addressed for live acceptance.
