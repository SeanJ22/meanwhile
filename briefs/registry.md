# Lane: registry (Door Registry, sources and places)

**Starts in Claude** (suggested model Sonnet 5.5) as an hourly cloud task. Status file: `.factory/registry.md` on `stream/registry`. You also continue the `bank` lane when River hands it to you (common.md, "Paired continuation").

Read `briefs/common.md` first. Your work is every row in `briefs/ownership.csv` with `lane = registry` (212 rows). Each row's full reason and evidence are in the inventory. Take them in the order below.

**Area.** The door registry and every source as a data row with its own clock; meeting-calendar wiring and crosswalks; run-now requests; the national jurisdiction registration and reference; Census geography, the ZIP index and boundary files (group N geography); and the owner-only promotion scripts (group G).

**Shared files you own:** `lib/doors/registry.ts`.

## 1. What stops free acquisition (rulings §2)

This lane holds most of the switch from "runs when sent" to "runs on its own clock for every place". Do it before anything else.

| Path | Action |
|---|---|
| `lib/civic-data/automatic-refresh.ts` | Only 11 hand-picked sources get a clock, several named for AZ, NH, NJ and Pima. Every source should run on a schedule read from the source registry. |
| `lib/civic-data/contracts.ts` | Runner's source list, but it hard-codes per-place contracts (New Hampshire roster, Morris ballot, Pima and Mesa outcomes), FEC weekly for a few people, and fixed meeting windows that should be Admin settings. |
| `lib/civic-data/derived-authority.ts` | Runner needs it, but a connection whose calendar changes shape is suspended and stays dark until a later review. It should re-check automatically and restore, newer official wins. |
| `lib/civic-data/derived-meeting-wiring.ts` | Runner needs it, but a SUSPENDED calendar reads nothing new until a later review. |
| `lib/civic-data/hunt-source-tasks.ts` | Runner uses it, but these free sources run only when Sean sends a place, "no new standing schedule." Every source should run on its own clock; a Send becomes a run-now. |
| `lib/civic-data/jurisdiction-reference-acquisition.ts` | Needed national reference, but the download fails for the whole country if one Arizona campaign-finance PDF can't be fetched. |
| `lib/civic-data/manual-contracts.ts` | Site and runner read it, but all 33 sources are owner-only with no clock, many typed per state (AZ, NH, NJ ballots and money, Pima finance). Each needs a schedule and national scope. |
| `lib/civic-data/manual-producer-invocation.ts` (group G) | Delete once the replacement is live. Its whole job is the "nothing runs unless sent" rule, with AZ/NH/NJ/Pima entries and "reviewed input" holds. It goes when every source gets its own clock. |
| `lib/civic-data/morris-filing-documents.ts` (group G) | Delete once the replacement is live. Its only users are the Morris ballot builder and NJ hunt; ballots should come from a national job with Morris as ordinary data. |
| `lib/civic-data/operational-references.ts` | Runner and site need the jurisdiction reference, but three states are required seeds, an Arizona-only version exists, and other states are read only when a Send reaches them. |
| `lib/civic-data/owner-refresh.ts` | This is the run-now button the mission keeps, but it refuses a new request while any earlier one is still pending, so orders run one at a time. |
| `lib/civic-data/reviewed-registry-states.ts` | The three seed states must be removed so every state is read from the national registration on equal terms. |
| `lib/civic-data/routine-due-request.ts` | Doors use it for read-now. Remove the quoted "Sean:" instruction, and allow more than one open request at a time. |
| `lib/control-plane/discovery/auto-crosswalk.ts` | Holds a calendar when robots.txt was not read first, and names its reviewer by code digest so code edits re-key verified calendars. Drop both; remove owner-decision attributions. |
| `lib/control-plane/discovery/derived-wiring.ts` | Re-check and restore automatically; key by output version; drop old robots hold. |
| `lib/control-plane/scheduler/providers/shut-doors.ts` | It serves the mission (broken routes get repaired), but the runner never registers it, so it never runs; add it to the runner's provider list. |
| `lib/doors/hourly-check.ts` | Delete WTP_DOOR_PROBES so it runs; apply the ten-per-hour cap only to small governments and school districts. |
| `lib/doors/ingest-evidence.ts` | Off unless WTP_DOOR_SHUT=on, so broken doors never get marked or fixed. Delete the switch so shut-door tracking simply runs. |
| `lib/doors/install.ts` | Off unless WTP_DOORS_READ=registry, and the code's typed list wins whenever the registry differs. Delete the switch and the code-list fallback so the registry is the list. |
| `lib/doors/observed-rate.ts` | Useful, but it hard-codes one hour as the fastest check. The rules make check timings Admin settings that may go faster; read that floor from Admin. |
| `lib/doors/seed-all.ts` | Delete the switch and also seed from the CivicPlus and Legistar site lists already held. |
| `lib/geo/census-school-territory.ts` (group N) | National school-district territory should rebuild on a runner clock into the database, not by hand into repo files. |
| `lib/geo/point-in-polygon.ts` (group N) | Keep it, and run the national boundary join on a runner clock into the database. |
| `lib/geo/shapefile.ts` (group N) | Keep it, and run the national boundary builds on a runner clock into the database. |
| `lib/geo/zip-division-index.ts` (group N) | Meetings, Admin and readers use it, but it reads place data from repo files. Move the ZIP-division index into the database, refreshed on a clock. |
| `lib/hunt/jurisdiction-universe.ts` | Reads committed per-state JSON files that exist only for Arizona, New Hampshire and New Jersey. Read governments from the national registration in the database for any state. |
| `lib/hunt/meetings-route-hints.ts` | Place data lives in code and needs a code change to add. Move ROUTE_HINTS into route-hints door rows and delete the constant; keep the types and lookup helper. |
| `lib/registry/source-wiring.ts` | Meetings run only for bodies hand-typed here. Store meeting sources as database rows for every government, and delete the retired-route list and rule citations. |
| `lib/sources/legistar-insite/tenant-registry.ts` | Takes tenants from the hand-typed SOURCE_WIRING code list. Read them from the meeting-source data rows so a new tenant needs no code. |
| `lib/sources/legistar/client-registry.ts` | Takes clients from the hand-typed SOURCE_WIRING code list. Read them from the meeting-source data rows so a new tenant needs no code. |
| `scripts/classify-school-districts.mts` | Live code imports its output, but it only classifies districts in the old pilot-era registry file. Classify every Census school district nationally instead. |
| `scripts/derive-meeting-body-crosswalk.mts` | Needed to wire meetings, but its reviewer is named by a hash of its own code, so any code edit re-keys every accepted row. Key it by a version that changes only when output changes. |
| `scripts/derive-meeting-source-wiring.mts` | Needed for meetings, but rows hit by its review triggers stay suspended until someone reviews them. Re-check those calendars automatically and restore them. |
| `scripts/enumerate-jurisdictions.mts` | Read every state from the national registration and put it on a clock; drop the AZ-only contract. |
| `scripts/fetch-state-outlines.mts` | The map reads its output, but it fetches only the states we hold geometry for (three). Fetch every state and territory outline. |
| `scripts/project-place-references.mts` | Place data should live in the database, not files rebuilt at install (package.json:7). |
| `scripts/promote-az-official-actions.mts` (group G) | Delete once the replacement is live. Replace with governor actions for every state on a clock. Remove package.json entry "official-actions:promote" (line 164). |
| `scripts/promote-manual-civic-projection.mts` (group G) | Delete once the replacement is live. Owner-only reviewed-package door for budgets, records, special districts, ballots, translations and money; these need standing jobs. Remove package.json entry "civic-data:promote-manual" (line 190). |
| `scripts/promote-registry-runtime.mts` (group G) | Delete once the replacement is live. Owner-reviewed package door that holds registry facts back from automatic publishing. Remove package.json entry "registry:promote" (line 224). |
| `tests/auto-crosswalk.test.ts` | Delete holds that refuse a calendar an official page links to off its own host, that require robots.txt be read first, and that need a person to confirm UTC feeds. |
| `tests/curated-reader-data-plane.test.ts` | Remove the assertion that every contract is owner-run only; every source gets a schedule. |
| `tests/derived-authority.test.ts` | A suspended row must come back by automatic re-check, not "a later review". Change the review-restore test; keep the rest. |
| `tests/derived-meeting-family.test.ts` | Change tests that require a reviewed crosswalk row or review to restore a suspended connection. |
| `tests/derived-wiring.test.ts` | Drop "promote only from a reviewed crosswalk row" and "only a review restores"; auto-wiring and auto re-check replace them. |
| `tests/door-ingest-evidence.test.ts` | Delete the test that the feature is off unless WTP_DOOR_SHUT=on; the switch goes. |
| `tests/door-observed-rate.test.ts` | The fixed hourly floor stops faster reads; timings may go faster per Sean. Make the floor an Admin setting and update that assertion. |
| `tests/door-registry-pass.test.ts` | Real door behavior. Delete the "with the switch off nothing is read" test; the door switches go. |
| `tests/door-registry-requests.test.ts` | Delete the test that refuses requests with WTP_DOORS_READ off; the switch goes. |
| `tests/door-registry-rows.test.ts` | Drop the "switch is off by default" part; WTP_DOORS_READ goes. |
| `tests/door-registry-seed-on-start.test.ts` | Seeding stays. Delete the "switch unset writes nothing" test; WTP_DOORS_SEED goes. |
| `tests/hourly-check.test.ts` | Hourly checks are required, but the test caps every host at ten requests an hour, not just small governments, and pins the feature off by default. |
| `tests/hunt-source-tasks.test.ts` | It pins PRL, voting sites and national sources as Send-only, never standing, plus an AZ-only reference. Free sources must run everywhere on a clock. |
| `tests/registration-jurisdictions.test.ts` | Pins hand-reviewed AZ/NH/NJ registries winning over national registration; drop those reviewed-file reads and precedence checks so every state reads from registration. |

Group G (inventory): Every source these doors publish runs as a standing job on a clock for every state. Then the owner-only scripts are deleted. `lib/civic-data/morris-filing-documents.ts` goes when the ballot lane's national ballot job reads Morris County as an ordinary data row.

## 2. Groups

### Group N (124 rows)

Inventory: Large, slow-changing reference files (the ZIP index, boundary files) move to wtp-assets and are read through the CDN. Facts (body descriptions, seat makeup, coverage tiers, Arizona text compiled into code) live in the database, where the factory checks and updates them, and are published per state to wtp-assets for readers. Readers never pull these from Neon.

Use the wtp-assets writer the people lane builds for portraits (`lib/ops/asset-remote.ts`); do not build a second one.

| Paths | Action |
|---|---|
| `data/derived/zip-divisions/*.json` (100 files) | Move into the database by area; the database holds only a partial district overlap. Readers get it from wtp-assets through the CDN, never from Neon. |
| `data/states/{az,nh,nj}/geo/*.geojson` boundary files (21 files) | Move boundaries into the database by area for every state; readers get them from wtp-assets through the CDN. Then delete these files. |

| Path | Action |
|---|---|
| `data/derived/resolver-geometry.json` | Readers' address lookup depends on it and only a code release changes it. Goes away when boundaries move into the database by area. |
| `data/derived/school-district-dependency.json` | Move into the database and build it for every state from the Census files already held. |
| `data/states/az/geo/body-territories.geojson` | The site reads it at runtime and only a code release changes it; Arizona only. Move into the database by area. |

Rows of these groups that stop free acquisition are in section 1: G (5), N (4).

## 3. The rest

| Path | Action |
|---|---|
| `data/derived/census-nces-crosswalk.md` | Keep the build notes; remove the numbered ruling citations. |
| `data/reference/fec_state_election_offices.md` | Keep the provenance; remove the 'Why this repo holds it — RULING 69' policy section. |
| `lib/census-geography/bootstrap-az.json` | Production never reads it, but code serves it as a dev fallback. Move it under tests as a fixture and remove the fallback in reader.ts. |
| `lib/census-geography/reader.ts` | Ask, Admin and the runner use it. Remove the Arizona bootstrap fallback so no path serves AZ-only geography; tests should load their own fixture. |
| `lib/civic-data/meeting-body-crosswalk.ts` | Meeting wiring needs it, but every row must carry a fake "owner decision" citation string or it is refused, and a manual review step is built in. |
| `lib/civic-data/website-correction-acquisition.ts` | Re-verifies website fixes against live pages and never stops on robots.txt; keep it. Delete the dated "owner decision" attribution in the comment. |
| `lib/civic-data/website-corrections.ts` | The reference uses it, but corrections are typed into code for a few AZ and NH towns, with a fake "owner decision" citation string. Corrections should be data rows any agent adds. |
| `lib/doors/detective-repair.ts` | Wire useDetectiveFind into where detective results land so fixes reach the next check. |
| `lib/doors/overdue.ts` | Hard-codes the seven-day window, hourly and twice-daily timings. The rules say these are Admin settings that may go faster; read them from Admin. |
| `lib/officials/body-form.ts` | Logic is national. Strip the rule citation and 'three pilot states' comment. |
| `lib/officials/school-dependency.ts` | The site bundles a national data file from the repo. Read the classification from the database. |
| `lib/registration/candidate.ts` | Registers every state's governments, which is the national place list. Delete "RULING 269" from the stored violation message. |
| `lib/registry/audit.ts` | Still has a 'blocked by robots.txt' outcome. Robots.txt never blocks acquisition; drop that outcome. |
| `scripts/resolve-census-territory.mts` | Its output data/derived/census-unit-zips.json is read by the site and runner as a committed file. Write it to the database instead. Keep package.json "territory:resolve". |
| `scripts/stamp-body-forms.mts` | Write it to the database instead, and drop its generated-register row. Keep package.json "forms:stamp". |
| `tests/auto-crosswalk-expansion.test.ts` | Exactly the "new place needs no new code" behavior; only swap its read of the committed Arizona jurisdiction file for a fixture. |
| `tests/body-form.test.ts` | Real national classification; remove the numbered-ruling label in a title. |
| `tests/district-hits.test.ts` | District lookup stays, but "every target zip" is the pilot list. Test any ZIP from national geometry instead. |
| `tests/door-registry-reader.test.ts` | Reader says what is covered from data. |
| `tests/municipal-layer.test.ts` | Remove RULING 80/57 citations, and reconcile against the national registration instead of lib/registry/registry.json, a file only tests read. |
| `tests/owner-routine-refresh.test.ts` | Run-now stays as an Admin button. Drop the dependency on scripts/installed-runtime-dispatch.mts, the local-checkout proof the plan deletes. |
| `tests/reference-data.test.ts` | Loader and reconciliation checks are useful, but frozen file counts and provenance-note pairing fail whenever a reference file is added; drop those two checks. |
| `tests/registration-contract.test.ts` | National registration is mission work; remove the "Sean's direction" and "Sean's S6 instruction" attributions from comments. |
| `tests/registry-oracle.test.ts` | Real ZIPs are used as test cases for division resolution, not as a place list in product code. |
| `tests/routine-due-request.test.ts` | Keep run-now requests; drop the installed-runtime-dispatch local-checkout path and make the request an Admin button for any partition. |
| `tests/zip-division-shards.test.ts` | Keep the national shard checks; drop the frozen three-state index baseline comparison. |

**Check and close (9 rows).** The inventory gives these only comment, citation or deleted-file reference fixes, which the cleanup release was doing. Confirm each is done on `river`; finish any leftover; then close the row: `lib/control-plane/discovery/derived-wiring-reading.ts`, `scripts/build-resolver-manifest.mts`, `scripts/lib/national-division-ids.mts`, `scripts/state-holdings-project.mts`, `tests/census-join-key.test.ts`, `tests/districts.test.ts`, `tests/door-registry-hosts.test.ts`, `tests/resolve-once.test.ts`, `tests/resolver-manifest.test.ts`.

## Notes

- Doors, playbooks and settings as data: rulings §9.
