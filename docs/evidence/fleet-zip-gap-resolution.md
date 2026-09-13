# Bounded ZIP gap recheck

Base `9bd72b26`; previous ZIP code and evidence remain unchanged. The new pure
helper `lib/control-plane/zip-gap-resolution.ts` implements
`fleet/zip-gap-resolution@1`. Its
[actual output](fleet-zip-gap-resolution.example.json) rechecks exactly the
previously named 19 geographic references, four source-refresh mappings and
five separate ZIP coverage mappings. No live read, task registration, expansion,
source fetch, policy change or production action occurred.

## Locally established results

| Classification of the 23 reference gaps | Count |
| --- | ---: |
| Statistical/unorganized polygons with no government of their own | 8 |
| Fictitious duplicate layer, actual counterpart still owed | 1 |
| Exact state identity linked to part of its existing source portfolio | 2 |
| Exact existing body identity, acquisition assignment still unheld | 7 |
| Exact state identity, source portfolio still unassigned | 1 |
| Source-refresh assignment still unheld | 4 |
| Unresolved identity / ambiguous supplied evidence | 0 / 0 |

The eight statistical places are Tucson CCD, Corona de Tucson, Rincon Valley,
Vail, Blodgett Landing, Hibernia, Lake Telemark and White Meadow Lake. This
classification comes from the existing `slotsFor(Division)` and the committed
registry's Census `FUNCSTAT`/`LSAD`, not a new government definition. They do not
need invented municipal governments; actual overlapping governments remain owed.
Rockaway Borough's county-subdivision row has `FUNCSTAT F`: it is a duplicate
layer, not evidence that the borough has no government. A canonical counterpart
key is still required before assigning its task.

The seven exact held body IDs are the boards for Casa Grande Elementary,
Casa Grande Union High School, Empire Elementary, Denville Township School,
Rockaway Borough School, plus the governing bodies for Denville Township and
Rockaway's place division. Their exact IDs and canonical division evidence are
in the output. They remain unassigned; identifying a real body does not create
an acquisition task.

Arizona and New Hampshire state rows now follow the explicit chain
`Jurisdiction.govClass=STATE/stateCode → sourceIds → sourceCatalog.routeId →
existing provider route`. Three additional **existing** obligation IDs resolve:

- `freshness:campaign-finance:az-sos-cfs-2026#az-sos-cfs-bulk-ftp`
- `freshness:campaign-finance:az-sos-cfs-2026#az-sos-seethemoney-datatables`
- `freshness:campaign-finance:nh-sos-cfs-2026#nh-cfs-filing-entity-details`

These are campaign-finance assignments only. New Jersey's canonical state ID
`nj:state:new-jersey` is known, and its source registry names
`nj-elec-entity-search`; the supplied campaign-finance provider has no NJ unit.
The result is `STATE_PORTFOLIO_UNASSIGNED`, not unknown identity. No method name,
record class, jurisdiction slug or task ID was invented. The helper uses the
actual campaign-finance and local-jurisdictions provider conventions explicitly;
it does not assume arbitrary uppercase source classes map to lowercase provider
classes.

All four source documents were re-read for exact provenance/retrieval/authority
URL fields, including the AZ filing corpus's documented superseded landing URL.
These URLs establish held source knowledge, not a refresh assignment. The local
provider's existing `STATEWIDE` exclusion is relevant: a named statewide source
must have its own existing record-specific provider, not another per-ZIP task.
The four remain `SOURCE_REFRESH_UNASSIGNED`.

All five tier stamps were checked with existing `tierExceedsEvidence`; none
exceeds its historical evidence. All five **coverage-task mappings** remain
unresolved. Neither a valid Tier 0 stamp nor matched source work proves complete
coverage. No committed readiness/promotion snapshot was found in the inspected
`data/control-plane` paths or readiness JSON evidence files. The absence of a
local snapshot says nothing about production's store.

## Held history and exact outstanding reads

The helper consumes the highest committed revisions of WorkItems, RouteTasks
and occurrences under `data/control-plane/freshness-shadow/aggregates`.
The seven newly resolved body subjects have no matching WorkItem in that held
history. The three mapped AZ/NH portfolios yield **three actual WorkItems and
three actual RouteTasks**, after occurrence, subject, work ownership and route
validation. These are historical links, never current runnable-task claims.
Each output row records the exact subjects/method IDs checked and named IDs
found; broken occurrence joins remain named unresolved links.

`pendingReads` carries held identity/source evidence selectors. Separate
`runtimeReads` carries the actual canonical interface calls still required:

- `ControlPlaneRepositories.workItems.list()` filtered by the exact returned
  body/jurisdiction subject; source URL lookup remains a candidate lookup until
  its WorkItem extraction contract and subject universe are verified.
- `readAutonomousActivity(repos, workItemIds)` using only IDs returned by that
  lookup; no guessed work-item IDs.
- `ControlPlaneRepositories.occurrences.list()` filtered by the exact matched
  obligation ID, then `routeTasks.read(returned routeTaskId)` checked against
  the exact known route ID.
- `ControlPlaneRepositories.readinessSnapshots.read("az"|"nh"|"nj")` and the
  current derivation-contract classification; alternatively the actual
  `readReadinessSnapshot(state)` API, which takes **state only**. Each ZIP row
  names its exact state and `snapshot.zips[zip=...]` selector.

The implementation does not call those interfaces. Five existing provider
enumerators are read locally: the four prior providers plus tracker intake.
Tracker intake contributes zero schedulable units and retains its own reason.
Promoted-fact provider inputs require canonical pipeline-state evidence; no
production read or synthetic fact subjects were substituted. Those records,
current readiness and the unheld subject/source assignments are the remaining
integration dependencies. Claude retains Admin UI ownership; PDC retains
production operations during its transition. Existing proof contracts remain
unchanged; subsequent fleet/integration verification does not enter PDC's denominator.

## Verification

```text
node --test --experimental-strip-types --import ./scripts/register-test-loader.mjs tests/zip-gap-resolution.test.ts
5 tests passed; 0 failed.
```

The tests execute real committed provider/registry inputs into the helper and
reproduce the example, trap network access, preserve inputs, reject unknown
functional codes as absence, preserve duplicate-layer counterpart work, refuse
ambiguous state/method identity, refuse fabricated source or coverage task IDs,
and reject a broken historical occurrence/task join. No performance or live
progression claim is made. No new retrieval rung was learned.
