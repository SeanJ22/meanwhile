# Front door

Owner: RB-A3. Branch: `stream/rb-a3`, cut from River `21ae9bcfb`.

Residents keep the live fact table and its existing reader paths. A changed fact enters that table immediately, queues its served places, and adds one hourly count for each served state. An exact repeat changes neither the fact nor its publication counts or queues.

`lib/core/door.ts` owns publication, source precedence and governing-board creation. `facts/publish.ts` keeps the old blank-returning call; `facts/decide.ts` and the governing-board export in `facts/entities.ts` forward to the shared implementation. `section3.ts` and `validate.ts` remain with their existing families.

New callers pass a `subjectId` (or the old `entity`), the saved copy and one field/value. An official loader can pass `sourceField: { record, key }` so the door takes the publisher's field itself. A government-named board can be supplied as `board: { governmentId, name }`. Hunter and walker findings set `acquisition` accordingly and are checked against their saved copy. Existing Box findings are recognized as hunters. Legacy helpers extracting claims from saved pages select the checked lane; the direct official-field call does no quote search. The checker retains the subject’s entity name and its published spellings, including surname-first roster labels. Campaign and advocacy claims carry the site's `sourceSubjectId`.

The new result is `{ decision, factId }` or `{ refused }`. A new work-list caller passes `refusal: async (_claim, reason) => { await list.refuse(leasedRow, reason); }` and does not record that refusal again. The handoff runs after the fact transaction releases its locks, so an unrelated work database cannot hold an official value. The compatibility caller records only its existing blank. No work list or whole-record check sits in front of official source fields.

The reader-side `RB-A3_expand` migration restores `rebuild_queue` and adds `count_hour(state, hour, step, n)` for transactional fact counts. Steps are `door_official` and `door_checked`. Admin's existing Scoreboard reads those counts by state and hour. These are fact counts in the reader database; RB-A5's control-plane work counts measure separate work transitions.

Remaining work, in dependency order:

- RB-A3: build against each newest RB-A1 tip. RB-A1 `5bde46615` is merged into this stream, and the door uses its `resolveId` for native ids and saved aliases. READY still requires the RB-A1 integration entry and ancestry on River.
- RB-A3: replace the current subject/place-link filing with RB-A4's service-map implementation once it lands.
- RB-A3: finish the full check set on the combined code, including source families, Admin and the build. Focused door, Box, fact-store and cache checks are running as the implementation changes.
- RB-A3: complete the production deployment and automatic post-deploy pass after the copied-data connections and controlled next-run proof below. The approved local copy replay preserved all 31,627 sampled values. Counts for every state and territory are in `docs/measurements/rb-a3/replay.json`; 25 regions reached 1,000 and the other 31 supplied all available fact rows, so the required minimum remains open.
- RB-A3: repeat the current-frontend Chrome and Admin checks after the final combined build. The copied-data checks below pass. The Browser app has no control tool here, so these use the repository’s guarded Google Chrome for Testing 151 harness with writes blocked and certificate validation enabled.
- RB-A3: merge River after its RB-A1 fold, rerun every check, push READY and continue checking River returns until the lane passes its live check.

`docs/measurements/rb-a3/production-counts.json` records the read-only aggregate baseline for all 50 states, DC and five US territories. Thirty-one have fewer than 1,000 live facts. The latest aggregate read at 11:34 UTC (7:34 AM Eastern) still has 31 regions below the minimum and eight with none: AS, GU, LA, MP, ND, NE, PR and VT. Montana now holds nine. These shortfalls must not be presented as 1,000 replayed facts.

No READY has been declared. No production database writes, release or changes to `meanwhile-signal` have been made.

The read is in `scripts/rb-a3-production-copy.sql`, bounded to 1,000 live facts in one state at a time. It selects the facts, their subject identities, aliases, place links and source dates/URLs. Local source storage keys replace production blob keys. It does not select reader event or post tables. Snapshots stay in ignored `.scratch/rb-a3/snapshots`; the replay script opens only an in-process PostgreSQL database and reports counts and preserved values. It exits unsuccessfully if any state has fewer than 1,000 completed replays.

Sean explicitly approved the ignored local production copy in this chat. The real replay found an Alabama canonical person id also held as another person's campaign-source alias. The resolver now prefers the exact existing entity id, while retaining the ambiguity error for an external id naming multiple entities. Both entities and aliases stay. This fix is in `RB-A3_resolve`, a contract migration after RB-A1, with a door regression test. RB-A1’s SQL is preserved unchanged so River can ship and number it independently.

## Connections on real production data

The approved Arizona snapshot supplies the permanent Mesa subject id, its government and its place links. Fresh sources and the existing page were opened in Google Chrome for Testing 151 on October 24. At 11:26:51 UTC (7:26 AM Eastern), `https://meanwhileusa.com/?zip=85201` returned 200 and showed 33 bodies, 36 meetings and 27 officials. All browser HTTP mutations were blocked. `scripts/rb-a3-capture.mts` saves those public source pages and the current reader response; it reads only this page’s registry metadata through the specified reader `readonly` connection.

1. The held Legistar API, `https://webapi.legistar.com/v1/mesa/Bodies?$filter=BodyActiveFlag%20eq%201`, returned 200. Its BodyId 138 has `BodyName = City Council`. `scripts/rb-a3-connections.mts` extracts that actual field and sends it to the door’s official lane for `ocd-division/country:us/state:az/place:mesa#governing`. It publishes fact 2017 in the local PostgreSQL copy with an empty quote. The focused getter test separately throws if this lane reads page text, and passes.
2. Mesa’s own council page, `https://www.mesaaz.gov/Government/Mayor-City-Council`, returned 200. Its saved Chrome text states `20 E. Main Street / Mesa, AZ 85201`. A local Box finding over that saved artifact goes through the real `publishBoxFindings` path, the compatibility publisher and the door’s checked lane. Fact 2018 carries that address and quote offset 1443. The current fact reader and coverage composer produce the body’s address and separate field sources. Mesa, Arizona and the US parent are queued. The copied state receives one count through each lane.

The copy script preserves the full captured state response, existing meetings, body ids and all unrelated reader values. Chrome then opens today’s production page with only its fact-data responses supplied from that local copy: the address appears on City Council, and its government source is visible in Sources. This checks the reader code served by `meanwhileusa.com`; no production fact is inserted. The branch’s frontend also exposes the API name source in the same Sources section. Before this repair, name and homepage field sources could be lost between the fact reader and the body card.

Admin’s existing Scoreboard, opened locally with a locally signed session, displays 57 state/territory/national rows. Arizona shows one official field and one checked claim in the publication hour. This is a reading of the local copy, not a claim that the new table or counts are deployed.

## Next scheduled run

The connection script uses the production `publishNowLane` and `IndependentRuntimeLaneScheduler` with controlled clocks and the actual Box publisher over the approved copy. The first tick finds no work. A saved-source finding is then queued. The tick at 59,999 ms starts nothing; the next scheduled tick at 60,000 ms publishes the address. The following tick finds no unsettled finding, and the complete fact, source, count and rebuild-queue contents remain identical. The clock starts after the real captures and remains in one hour for an unambiguous Admin reading. The first automatic production pass after deployment remains for River’s live check.

## Reproduce on the approved local copy

`scripts/rb-a3-production-copy.sql` supplies each ignored state snapshot. `scripts/rb-a3-replay.mts <snapshot-directory> <report.json>` replays every held value. `scripts/rb-a3-capture.mts <directory>` captures the real public pages and reader baseline. It requires `WTP_PRODUCTION_DATABASE_URL_READONLY` for the specified reader project and role; Node uses the managed proxy and CA. Chrome uses that same trusted CA with certificate validation enabled.

`scripts/rb-a3-connections.mts <directory>` opens only local PostgreSQL and creates the copy’s reader and Admin responses. With the current frontend running locally, `scripts/rb-a3-copy-browser.mts <directory>` opens the place card, its Sources and Admin. `--current-reader` instead opens the frontend served by `https://meanwhileusa.com`, with the local copied fact responses. All browser mutation methods are blocked. Raw sources, snapshots and credentials stay under ignored `.scratch/rb-a3`; only aggregate measurements and the public connection example are committed.

## Current check results

Both default and standalone builds passed, including their trace/bundle checks. The first full run registered 9,656 tests: 9,644 passed, ten failed and two were skipped. Its ten failures exposed legacy claim adapters that had not selected the checked lane, the restored queue’s old fixture expectation, and the Admin select’s missing theme class. Focused reruns after those repairs pass: 48 publication/identity/cache checks, 45 roster/Box/carton checks, 20 identity/door/migration checks, and the five meeting checks. The complete suite must pass on the final combined commit; this first run is not reported as passing.

The initial schema check refused the working-tree restoration of RB-A1 as a modified migration. The restored file’s Git blob is `bf73638c86f3273d80608c407d19ea32d3d1afeb`, identical to `origin/stream/rb-a1`; the merge base has no RB-A1 migration. After that restoration was committed and the repair moved to `RB-A3_resolve`, the read-only shipping check passed: 51 established migrations applied, with the three new lane migrations pending in their proper phases. The first attempted commit/push was blocked by automatic approval review on the same immutability concern; byte comparison and the committed restoration resolved it before the branch was pushed.

The standalone Chrome check first stopped at its welcome screen because the local standalone package lacked the public ZIP assets. The ZIP asset returned 404 while the source tree’s copy existed. Copying `public` into the local standalone package before starting it fixed that setup: the fresh reader and Admin run passes, including visible source links. No application retry or production repair was used.
