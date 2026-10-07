# Lane: meetings (Meetings and refresh)

**Starts in Claude** (suggested model Sonnet 5.5) as an hourly cloud task. Status file: `.factory/meetings.md` on `stream/meetings`. You also continue the `ballot` lane when River hands it to you (common.md, "Paired continuation").

Read `briefs/common.md` first. Your work is every row in `briefs/ownership.csv` with `lane = meetings` (90 rows). Each row's full reason and evidence are in the inventory. Take them in the order below.

**Area.** Meeting adapters and ingest; the civic-data runner pass; meeting partitions, windows and lanes; meeting history; outcomes and minutes; venues; and federal roll calls.

**Shared files you own:** `scripts/ingest.ts`, `lib/civic-data/runner.ts`.

## 1. What stops free acquisition (rulings §2)

| Path | Action |
|---|---|
| `lib/civic-data/bounded-child-pass.ts` | Needed by the runner, but it forces a 60-second gap between any two reads of the same website, for every site. Only small local governments should be paced. |
| `lib/civic-data/meeting-lanes.ts` | Runner reads it, but the feature is off by default behind a switch "until checked live." Delete the switch so it runs. |
| `lib/civic-data/meeting-partitions.ts` | Core to meetings, but partitions are built from the hand-typed body list in code, with Tucson and Pima school adapters named in code. Meeting sources should be data rows for every government. |
| `lib/civic-data/outcome-partitions.ts` | Right design (outcomes by door type, not place), but Pima and Mesa are carved out to keep their own per-place contracts, and the whole thing is empty while the door switch is off. |
| `lib/civic-data/runner.ts` | It refuses sources not marked auto-publish, and allows one read per upstream site per pass and three per meeting lane, slowing big sites that should be read at full speed. |
| `lib/outcomes/data-plane.ts` | Make one outcomes contract built from each Legistar or minutes door row, for every government. |
| `lib/sources/clerksboards/index.ts` | Fix: drop the Tucson default host so each portal comes from its wiring row; delete RULING notes. |
| `lib/sources/legistar-insite/http.ts` | Spaces every Legistar portal request 2 seconds because robots.txt asks. Big counties and cities are read at full speed; pace by publisher size. |
| `lib/sources/legistar-insite/index.ts` | Fix: the 6-page cap stops enumeration short; remove it with the crawl delay. Delete RULING 107/170/184/100 notes. |
| `lib/sources/legistar/client.ts` | Plain code runs it on the clock. Delete the RULING 103 citation; 350 ms spacing should follow publisher size. |
| `lib/sources/pima-edu/index.ts` | Fix: the 6-PDF 'politeness' cap Sean didn't set; delete the RULING 107 note in the header comment. |
| `scripts/fetch-votes.mts` | Runs daily, but reads only a 20-roll window, which is how House votes got stuck. Read the clerks' full year for both chambers. |
| `scripts/ingest.ts` | Remove the 8-agendas-per-run cap (:163), the retired-host refusal list (:311-340) and the off-by-default history restore switch (:1265); strip RULING citations (:333, :546, :597, :703). |
| `scripts/legistar-insite-minutes-ingest.mts` | Defaults to Mesa (:117, :151) and treats robots.txt as a block (:14-15). Make it the one minutes reader for every site, with no Mesa default. |
| `scripts/legistar-outcomes-ingest.mts` | Built and named for Pima, with the slug defaulting to pima (:2-7, :64, :101). Make it the one outcomes reader for every Legistar site, with no Pima default. |
| `scripts/routine-civic-data-runner.mts` | Delete the off-by-default switches WTP_DOORS_READ/WTP_DOORS_SEED, WTP_DOOR_SHUT, WTP_BOX_ENABLED and WTP_MEETING_LANES so those paths just run, and read meetings from the door registry, not the code list. |
| `tests/door-outcomes.test.ts` | Keep door-built outcomes. Drop the carve-out for the two places with hand-written outcome contracts; one reader serves all. |
| `tests/federal-roll-catch-up.test.ts` | The "latest twenty" window and catch-up cap are why House votes stalled. Change to reading the clerk's full year. |
| `tests/federal-votes-data-plane.test.ts` | Delete the assertion that manual vote contracts have no clock; every source runs on a schedule. |
| `tests/meeting-lanes.test.ts` | Lane pacing is real, but the test pins the WTP_MEETING_LANES switch as off by default and the feature behind it. Delete those assertions with the switch. |
| `tests/mesa-minutes-outcomes-routine.test.ts` | Outcome reading is real but is a Mesa-only contract; make it one contract per Legistar/InSite tenant from data and stop reading the committed outcomes seed file. |
| `tests/pima-legistar-outcomes-routine.test.ts` | Delete the firewall and package.json tombstone test and the committed seed read. |

## 2. Groups

### Group J (2 rows)

Inventory: The manual crosswalk path is retired with its replacement; both files go together.

Both files go in one release, after the automatic crosswalk (registry lane) is live.

| Path | Action |
|---|---|
| `lib/civic-data/crosswalk-parity.ts` | A measurement for a one-time retirement decision. Only a test and an unused script call it. Delete in the same release as scripts/crosswalk-parity.mts's replacement. |
| `scripts/crosswalk-parity.mts` | Delete once the replacement is live. Keeps an old manual path alive until a parity check passes, a hold the rules don't ask for. |

### Group N (1 row)

Inventory: Large, slow-changing reference files (the ZIP index, boundary files) move to wtp-assets and are read through the CDN. Facts (body descriptions, seat makeup, coverage tiers, Arizona text compiled into code) live in the database, where the factory checks and updates them, and are published per state to wtp-assets for readers. Readers never pull these from Neon.

| Path | Action |
|---|---|
| `data/states/az/meetings/notice-summaries.json` | Readers see these summaries, bundled into code; only a release changes them. Move into the database. |

## 3. The rest

| Path | Action |
|---|---|
| `lib/civic-data/meeting-history-restore.ts` | Runner calls it, but it is off by default behind a switch, so the lost history is still missing. Delete the switch so it simply runs until done. |
| `lib/civic-data/meeting-history.ts` | Keeps meeting history for good, as required. Remove the leftover off switch so there is only one path. |
| `lib/civic-data/sitting-window-admission.ts` | Implements the meeting-check cadence and the runner needs it. Comments credit the rule to "the owner" by date; delete those, and read the windows from Admin settings, not fixed constants. |
| `lib/meetings/edge-artifacts.ts` | Core serving code, but its data family list hard-codes Arizona, New Hampshire and Pima families. Make families national, keyed by state. |
| `lib/meetings/edge-serving.ts` | Core reader path. Its family lists name Arizona and New Hampshire, and it carries hooks for a proof-only meeting pin. Make families national; remove the proof hooks. |
| `lib/meetings/minutes-summaries.ts` | The site and Ask read it, but it is meeting data typed into code for two pilot counties. Move summaries to the database from the minutes pipeline. |
| `lib/meetings/notice-summary.ts` | The site bundles them from an Arizona file in the repo. Read summaries from the database for every place. |
| `lib/meetings/prepared-snapshot.ts` | Core serving code. Remove the proof-only meeting pin hooks and rule citations. |
| `lib/meetings/query.ts` | It widens the search to 60 and 150 km when nothing is close, so readers see other places' meetings. Show only the place's own governments and say what isn't covered. |
| `lib/meetings/snapshot.ts` | Delete the 'reader proof' check against a frozen import (about lines 1178-1376) and its rule citations. |
| `lib/meetings/venue-cache.ts` | The lookup code is needed. The 1,280 lines of hand-typed Pima-area venues are data held in code; move them to the database venue records. |
| `lib/outcomes/store.ts` | The site reads outcomes through special Pima and Mesa pointers, with generic doors bolted on beside them. Read every outcomes door the same way and drop the Pima/Mesa paths. |
| `lib/outcomes/types.ts` | Used everywhere outcomes show. Remove the RULING 100/207 citations in comments; Pima/Mesa measurements in comments go too. |
| `lib/sources/apptegy/index.ts` | Plain code runs it on the meeting clock for wired bodies; Scouts may also use it. Only change: delete the RULING 107 note in the header comment and RULING 100. |
| `lib/sources/boardbook/index.ts` | Plain code runs it on the meeting clock for wired bodies; Scouts may also use it. Only change: delete the RULING 107 note in the header comment. |
| `lib/sources/civicclerk/index.ts` | Plain code runs it on the meeting clock for wired bodies; Scouts may also use it. Only change: delete the RULING 107 note in the header comment. |
| `lib/sources/civicplus/index.ts` | Plain code runs it on the meeting clock for wired bodies; Scouts may also use it. Only change: delete the RULING 107 note in the header comment. |
| `lib/sources/diligent/index.ts` | Plain code runs it on the meeting clock for wired bodies; Scouts may also use it. Only change: delete the RULING 107/263 notes. |
| `lib/sources/ical/index.ts` | Fix: the 'names no place' check spells out only three state names; use all. Delete RULING notes. |
| `lib/sources/iqm2/index.ts` | Plain code runs it on the meeting clock for wired bodies; Scouts may also use it. Only change: delete the RULING 107 note in the header comment. |
| `lib/sources/legistar-insite/calendar.ts` | Plain code runs it on the meeting clock for wired bodies; Scouts may also use it. Only change: delete the RULING 100 citation. |
| `lib/sources/legistar/index.ts` | Plain code runs it on the meeting clock for wired bodies; Scouts may also use it. Only change: delete the RULING 107 note in the header comment. |
| `lib/sources/onbase/index.ts` | Plain code runs it on the meeting clock for wired bodies; Scouts may also use it. Only change: delete the RULING 107 note in the header comment. |
| `lib/sources/revize/index.ts` | Plain code runs it on the meeting clock for wired bodies; Scouts may also use it. Only change: delete the RULING 107 note in the header comment. |
| `lib/sources/schedulepage/index.ts` | Plain code runs it on the meeting clock for wired bodies; Scouts may also use it. Only change: delete the RULING 107 note in the header comment. |
| `lib/votes/snapshot.ts` | Falls back to bundled JSON files in the repo when the database has no record. Reader data comes only from the database; delete the bundled first-seed path. |
| `tests/agenda-documents.test.ts` | Real behavior to keep; remove the numbered-ruling label in a section comment. |
| `tests/agenda-meeting-location.test.ts` | Pins only match a hand-reviewed venue list; the rulings say published addresses pin after normal validation, no certification. Drop the reviewed-venue requirement. |
| `tests/agenda-publication-state.test.ts` | Real behavior; remove numbered-ruling labels and stop reading the committed meetings snapshot file, which should leave the repo. |
| `tests/agenda-version-projection.test.ts` | Real behavior; the last test reads the committed meetings snapshot file, which should move to the database. Use a fixture. |
| `tests/attribution.test.ts` | Real behavior, but it imports lib/registry/registry.json, a stale data copy nothing that runs reads. Use a small fixture. |
| `tests/carried-venue-placement.test.ts` | Drop the reviewed-venue requirement; published addresses pin after normal validation with no certification. |
| `tests/cascade.test.ts` | Delete the radius-widening and ladder tests: meetings shown must be that place's, never a neighbor's. Keep the ordering and provenance checks. |
| `tests/day-precision.test.ts` | Drop the test that reads the committed meetings snapshot file; meeting data belongs in the database. |
| `tests/held-meeting-partition.test.ts` | Keeps last verified data while a route changes. |
| `tests/legistar-insite-union.test.ts` | Real meeting reader test, but it asserts a note's wording citing an owner decision by date. |
| `tests/legistar-insite.test.ts` | Real meeting reader test, with ruling and owner-decision citations to remove. |
| `tests/legistar-outcome-store.test.ts` | Real outcomes behavior, with ruling and owner-decision citations to remove. |
| `tests/legistar-publication.test.ts` | Real publication behavior, with numbered-ruling comments to remove. |
| `tests/legistar-routes.test.ts` | Good multi-route design, but it asserts a note cites an owner decision by date. |
| `tests/meeting-body-attribution.test.ts` | But it reads the committed meetings snapshot and registry.json, which should be database data; point it at fixtures. |
| `tests/meeting-history.test.ts` | Keeping meeting history for good is required. Two tests drive the WTP_MEETING_HISTORY_RESTORE and WTP_MEETING_HISTORY_MOVE switches the plan deletes; drop the switch handling so restore just runs. |
| `tests/meeting-sitting-window.test.ts` | One test pins the Pima-only outcomes contract, which the plan replaces with one outcomes reader for every site. |
| `tests/mesa-minutes-outcomes.test.ts` | Parser tests are real. Delete the parser-revision-hash pin, a busywork check the plan removes. |
| `tests/official-page-events.test.ts` | Real, and proves transfer to another state. The TUSD wiring test reads lib/registry/registry.json, a file only tests read; use a fixture. |
| `tests/pima-fact-fixtures.ts` | Used by the kept meeting-facts test. Remove the RULING 103 citation. |
| `tests/refresh-corollary.test.ts` | Checks real behavior that stays, but carries old ruling or owner-attribution labels; strip those labels and comments, keep the assertions. |
| `tests/retired-meeting-routes.test.ts` | Successor wiring is real; remove RULING 283 and owner-decision labels, including the assertion that a reason string quotes the owner decision. |
| `tests/routine-civic-data-runner.test.ts` | Runner behavior stays; remove plural-openstates and legiscan from the 'supporting research authorities' list that pins their research-only status. |
| `tests/schedulepage-own-routes.test.ts` | Adapter behavior stays; strip the "Sean's direction on 2026-09-24" quote from the comment. |
| `tests/snapshot-body-identity.test.ts` | Keep the planted refusal cases; drop the check on committed data/meetings-snapshot.json, since meetings belong in the database. |
| `tests/state-holdings-meeting-data.test.ts` | Keep the venue lookup tests; drop 'every held row equals the frozen base', a frozen-file check. |

**Check and close (12 rows).** The inventory gives these only comment, citation or deleted-file reference fixes, which the cleanup release was doing. Confirm each is done on `river`; finish any leftover; then close the row: `lib/meetings/registry.ts`, `lib/sources/composite/index.ts`, `lib/sources/smartsites/index.ts`, `tests/composite-failure-kind.test.ts`, `tests/meeting-change-facts.test.ts`, `tests/meeting-fresh-checks.test.ts`, `tests/meetings-data-plane-cutover.test.ts`, `tests/reader-upcoming-meetings.test.ts`, `tests/routine-civic-data-regressions.test.ts`, `tests/snapshot.test.ts`, `tests/source-adapters.test.ts`, `tests/venue-publication.test.ts`.

## Notes

- Meeting windows and check cadence: rulings §4.
