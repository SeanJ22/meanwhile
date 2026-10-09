# Routine civic data inventory (RCD-1)

Date observed: 2026-09-07

This inventory precedes the RCD-2–RCD-10 implementation. It describes the
checked-out `origin/main` at `30f6731b7a4b5e8ab9d2f5490fe2415597a6d398`.
The legacy discovery promotion pipeline is intentionally excluded as a
replacement: it is a SHADOW-only, two-acquisition research workflow and its
promotion gate is disabled. Routine authoritative data needs a separate
production data-plane contract.

## FEC

| Concern | Current path |
|---|---|
| Acquisition | `scripts/fetch-fec.mts` calls `api.open.fec.gov/v1` with `FEC_API_KEY`. It searches candidates for the committed ballot/officeholder targets, fetches candidate totals and selected Schedule A rows, and follows selected contributors. |
| Authority | The upstream FEC API is authoritative. Authority and competence are described in prose and adapter code; there is no canonical, machine-readable fact/horizon/redirect contract. |
| Raw holding | None. Response bytes, final URL/host, response hash, and per-query pagination horizon are not persisted. |
| Normalized holding | `data/fec/fec-2026.json` (`FundingSnapshot` format version 1). |
| Validation | Shape checks, cycle checks, scoped search, and a thin-snapshot count guard live inside `scripts/fetch-fec.mts`. Zero search results are currently written as `absences`, although zero alone does not prove absence. |
| Verification | `fetchedAt` and source strings are stored, but acquisition, validation, and promotion are not separate verdicts. `verifiedAt` is effectively the fetch time rather than a validation receipt. |
| Identity | Exact bioguide bridge where available; otherwise normalized name within office/state/district. Ambiguity is refused, but the evidence for each mapping is not persisted as a candidate-version identity receipt. |
| Freshness/horizon | Weekly legacy cadence. Cycle and report values are inspected, but per-query pagination/end-of-universe and broader filing-period completeness are not represented. |
| Reader/Ask consumers | `lib/funding/snapshot.ts` synchronously reads and process-caches the JSON. Direct/indirect consumers include `lib/funding/display.ts`, `app/ballot/page.tsx`, `app/api/funding/[target]/route.ts`, `app/api/reactions/route.ts`, `lib/ballot/incumbent-record.ts`, grounded Ask campaign-finance obligations, and control-plane held-record adapters. |
| Git/build/deploy coupling | The normalized holding is tracked. `.github/workflows/refresh-fec-snapshot.yml` and `.github/workflows/refresh-daily.yml` run the fetch, stage `data/fec/fec-2026.json`, commit, and push. A data change therefore enters the ordinary build/deploy path. The reader file is bundled/read from the deployed filesystem. |

## State legislative members and votes (AZ, NH, NJ)

| Concern | Current path |
|---|---|
| Acquisition | `scripts/fetch-legiscan.mts` downloads LegiScan weekly bulk ZIP datasets for the current regular AZ/NH/NJ sessions and parses people, bills, roll calls, and votes. `scripts/nh-gencourt-members.mts` separately reads the official NH General Court `Members.txt`, but only writes a hunt artifact and is not the Reader roster. Other official source routes are recorded in state source notes and one-off collectors, not a canonical routine adapter. |
| Authority | LegiScan and Plural/Open States are intermediaries (T4 under the new contract), not official state publishers. Official families already recorded are Arizona Legislature (`www.azleg.gov` and explicitly inherited official application/static paths), New Hampshire General Court (`gc.nh.gov`, including `downloads/Members.txt` and official roll-call surfaces), and New Jersey Legislature (`www.njleg.state.nj.us`, `pub.njleg.state.nj.us`, and its official API routes). No shared competence/host-inheritance registry exists. |
| Raw holding | LegiScan ZIP bytes are temporary. Only its vendor `dataset_hash` is retained. Official NH member bytes are not a production holding. Final-host and raw-content hashes are not candidate-version records. |
| Normalized holding | Votes: tracked `data/votes/state-votes-snapshot.json`. Reader rosters: tracked `data/states/{az,nh,nj}/officials/officeholders-*.json`, sourced mainly from Plural/Open States. The official NH normalization is tracked separately at `data/states/nh/hunt/nh-gencourt-members.json`. |
| Validation | The LegiScan fetch has parse and nonzero guards, session filtering, a per-state thin-snapshot guard, and a 12-most-recent-rolls-per-matched-member projection. It does not validate facts against an official state source. |
| Verification | A vendor dataset hash/date and source attribution are stored. There is no persisted official-source validation receipt or atomic LKG pointer. |
| Identity | LegiScan people map to committed roster records by district plus surname, then inherit the roster id. This is not exact official person/chamber/term identity and can silently miss or misinherit. Reader vote lookup itself uses exact stored id/name after that normalization. |
| Freshness/horizon | Weekly legacy cadence tied to LegiScan's Sunday rebuild. Sessions are selected by a title heuristic. Term/session source-through and official end-of-roll universe are not persisted as a validation contract. |
| Reader/Ask consumers | `lib/sources/legiscan/snapshot.ts` synchronously reads and process-caches the vote JSON. `app/api/votes/route.ts` serves it. `lib/ask/votes.ts` joins it to committed rosters for grounded Ask. Roster files are also read by `lib/registry/server.ts`, ballot incumbency, contest-universe, and other registry/Ask paths. |
| Git/build/deploy coupling | Vote snapshot and roster JSON are tracked and bundled. `.github/workflows/refresh-legiscan-snapshot.yml` and `refresh-daily.yml` commit/push vote changes. Roster changes are ordinary repository changes. `lib/registry/server.ts` explicitly treats these as static build outputs. |

## Census geography and reference data

| Concern | Current path |
|---|---|
| Acquisition | ACS population: `scripts/acs-population-refresh.mts` calls the official Census Data API for the pinned ACS 5-year vintage/table and writes two CSVs. Census of Governments: the held 2022 ZIP/XLSX was supplied after the environment could not reach `www2.census.gov`; it was transformed once into CSV. TIGER/Line-derived geometry and ZIP relations are produced by several explicit build/enumeration scripts rather than one operational fetch/promotion path. |
| Authority | Census API and Census bulk products are authoritative for their named products/vintages and geographic/statistical fields. Their competence is documented in source notes but not registered centrally. Census statistical geography is not itself proof that an independent government exists. |
| Raw holding | ACS raw API responses are not retained. The Census of Governments source ZIP hash is documented, but the raw archive is not an operational candidate record. Geography inputs/derived files have scattered provenance and evidence manifests. |
| Normalized holding | Tracked reference files include `data/reference/acs5_2024_b01003_{zcta,state}.csv`, `data/reference/census_govt_units_2022.csv`, and its dependent-school companion. Tracked derived read models include `data/derived/census-unit-zips.json`, `census-nces-crosswalk.csv`, `resolver-geometry.json`, ZIP coverage/runtime files, state geography JSON/GeoJSON, and public geometry. |
| Validation | Product-specific scripts/tests pin headers, codes, row counts, join keys, and selected cardinalities. The Government Units source note reconciles all 92,150 workbook rows (90,837 independent plus 1,313 dependent). There is no common candidate receipt, monotonic vintage check, or atomic LKG promotion. |
| Verification | Source notes carry URLs, dates, counts, and some hashes. A successful transformation updates tracked files directly; it is not separated from publication. |
| Identity | Census GEOIDs/FIPS/PID6 and product-specific codes are used. `tests/census-join-key.test.ts` protects PID6 joins. Existing reconciliation explicitly distinguishes statistical/fictitious entities from governments, but the rule is not part of a common promotion validator. |
| Freshness/horizon | ACS vintage is pinned to 2024 and its full API calls have expected cardinalities. Census of Governments is explicitly a 2022 snapshot, not a current roster. Each product has its own horizon; no generic “Census current” claim is valid. |
| Reader/Ask consumers | `lib/reference/acs-population.ts` reads committed CSVs into process caches for the readiness publisher. `lib/registry/server.ts`, `lib/coverage/zip-tier.ts`, ballot ZIP/division resolution, map coverage, and voting-site/address resolution consume the published projections and remaining reference artifacts. The former `lib/registry/census-school-systems.ts` reader is retired; native government and education-agency listings now arrive through registration. |
| Git/build/deploy coupling | Every named normalized/derived holding is tracked. Several are loaded from `process.cwd()` and included in Next output tracing; `lib/registry/server.ts` labels them static build outputs. A changed Census product therefore requires a repository change and rebuild/deploy before Reader sees it. |

## Root-cause summary and implementation boundary

The three paths conflate acquisition output with the deployed read model. Their
validators are source-local, their “verification” fields do not encode all
GOOD checks, and none has an operational promoted-version/LKG pointer. Routine
changes consequently ship as software.

The implementation will add one authority registry, one candidate state
machine, append-only candidate/receipt storage, and atomic promoted read-model
pointers in Postgres. Source adapters will submit candidate envelopes to that
contract; runtime consumers will read only promoted projections. The existing
tracked files remain bootstrap LKGs during the one-time transition, never the
ordinary write target. T4 LegiScan/Plural material cannot enter the T1 automatic
path merely because it is already present.

