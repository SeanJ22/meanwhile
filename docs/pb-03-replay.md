# PB-03 reader and scheduled-run replay

October 23, 2026: all 56 state and territory reader replays pass. The snapshots cover 6,375 locally associated held boards and 11,851 live facts. The next-day importer replay passes in 55 states and territories; Nevada has the exact source-registration conflict described below.

## Source to reader

The feeder is registration and platform discovery, followed by PB-01 Legistar acquisition and the standing Box fact publisher. PB-03 connects governments, boards, aliases, facts and source-established territory to `readPlacePackage`. Its output feeds `stateCoverage`, `DoorOverlay`, `Representation` and `GovernmentListings`. River combines and ships the lane. This moves §0’s tests that held information reaches every applicable place, facts reach readers, and results are correct and fast.

Every production proof query used a `readOnly: true` transaction. The production reader confirmed role `readonly`, `transaction_read_only=on`, and no INSERT/UPDATE/DELETE grants on public tables. Endpoint: `ep-dry-river-axwtolzc`, production branch `br-delicate-lab-ax02xuo5`. Live data repairs were separate authorized writes with the existing Admin history and undo.

## Whole-country reader proof

Each state was read separately. The replay selected every local division established by its published registration associations, independently followed the native and operational government IDs and entity parent relationships, and compared every resulting board with the real `readPlacePackage` result. It also passed the package through the real `stateCoverage` consumer and checked that each sourced, named local board was included. It checked merged aliases, repeated runtime IDs, direct statewide board links and the replaced generated name suffix. No expected local board was missing in any state.

The first country pass exposed generated labels outside the initial repair set and newly created by the still-deployed importer. Admin receipts 207 and 208 corrected 294 additional labels, removed nine direct statewide board links, and removed two empty Census-placeholder boards. The importer now uses the existing Census-placeholder rule, repairs the old generated labels during reload and held-board publication, and derives fallback names from the real government. Only the changed California, Colorado and Florida inputs required a reader recheck; all three passed.

Counts below are held local boards and their live facts, not a claim that every government has been acquired. Zero means no matching held local boards/facts. The scheduled column covers that state’s copied entity inventory, including boards without local associations.

| State | Local boards | Live facts | Reader | Next day |
| --- | ---: | ---: | --- | --- |
| AK | 71 | 188 | Pass | Pass |
| AL | 226 | 487 | Pass | Pass |
| AR | 109 | 199 | Pass | Pass |
| AS | 0 | 0 | Pass | Pass |
| AZ | 531 | 971 | Pass | Pass |
| CA | 919 | 1,739 | Pass | Pass |
| CO | 115 | 285 | Pass | Pass |
| CT | 41 | 53 | Pass | Pass |
| DC | 1 | 2 | Pass | Pass |
| DE | 17 | 34 | Pass | Pass |
| FL | 372 | 1,098 | Pass | Pass |
| GA | 110 | 164 | Pass | Pass |
| GU | 0 | 0 | Pass | Pass |
| HI | 4 | 4 | Pass | Pass |
| IA | 14 | 20 | Pass | Pass |
| ID | 35 | 51 | Pass | Pass |
| IL | 381 | 991 | Pass | Pass |
| IN | 6 | 6 | Pass | Pass |
| KS | 3 | 4 | Pass | Pass |
| KY | 9 | 4 | Pass | Pass |
| LA | 0 | 0 | Pass | Pass |
| MA | 32 | 92 | Pass | Pass |
| MD | 258 | 105 | Pass | Pass |
| ME | 10 | 60 | Pass | Pass |
| MI | 135 | 341 | Pass | Pass |
| MN | 15 | 90 | Pass | Pass |
| MO | 377 | 321 | Pass | Pass |
| MP | 0 | 0 | Pass | Pass |
| MS | 0 | 0 | Pass | Pass |
| MT | 0 | 0 | Pass | Pass |
| NC | 151 | 93 | Pass | Pass |
| ND | 0 | 0 | Pass | Pass |
| NE | 0 | 0 | Pass | Pass |
| NH | 548 | 0 | Pass | Pass |
| NJ | 497 | 99 | Pass | Pass |
| NM | 74 | 318 | Pass | Pass |
| NV | 41 | 151 | Pass | Fail: conflict below |
| NY | 128 | 339 | Pass | Pass |
| OH | 71 | 85 | Pass | Pass |
| OK | 33 | 237 | Pass | Pass |
| OR | 0 | 0 | Pass | Pass |
| PA | 15 | 27 | Pass | Pass |
| PR | 0 | 0 | Pass | Pass |
| RI | 0 | 0 | Pass | Pass |
| SC | 0 | 0 | Pass | Pass |
| SD | 0 | 0 | Pass | Pass |
| TN | 0 | 0 | Pass | Pass |
| TX | 332 | 616 | Pass | Pass |
| UT | 10 | 27 | Pass | Pass |
| VA | 1 | 6 | Pass | Pass |
| VI | 0 | 0 | Pass | Pass |
| VT | 0 | 0 | Pass | Pass |
| WA | 30 | 135 | Pass | Pass |
| WI | 650 | 2,399 | Pass | Pass |
| WV | 0 | 0 | Pass | Pass |
| WY | 3 | 10 | Pass | Pass |

## Next-day scheduling proof

All 56 state and territory inventories were copied one state at a time through read-only production queries into a locally migrated PostgreSQL store. The replay used each state’s actual held entities, place links, hosts, durable body aliases and published registration. The real `IndependentRuntimeLaneScheduler`, production five-minute `ROUTINE_DATA_ADMISSION_MS`, `ROUTINE_PASS_BUDGET_MS` and actual `ensureFactEntities` entry point ran on an unforced clock tick. A tick one millisecond before the next interval admitted nothing. Advancing the clock 24 hours admitted the lane automatically. In 55 states, 7,607 copied board identities, names, parents and place links survived unchanged on the second run; unchanged registration inputs were not loaded again.

The separate AK/AL/AZ replay also copied 26 entities, 20 real live facts, 15 saved-source rows and three production registration records. It ran the actual place reader after both scheduler admissions. Lower Kuskokwim remained on its school district with the source-verified board name, Mobile Housing retained its City of Mobile facts, and Vail remained one canonical board. Both runs completed. This is a controlled-clock test of October 24’s automatic admission; it does not claim the future wall-clock run has happened. The focused platform-census test separately confirms that tomorrow’s own-site check cannot revive a directory-only portal.

### Nevada exception

Nevada’s reader replay passes: 41 local boards and 151 live facts reach the reader selection. Its scheduled registration import fails with `ON CONFLICT DO UPDATE command cannot affect row a second time`. The held reference assigns `nv:special:washoe-rural-fire` to two source-boundary records:

- `nv-nevada-wildland-fire-protection-program-wfpp-fire-protect-22a553-31`, on `special_district:washoe_rural_fire`.
- `nv-washoe-county-fire-protection-districts-4d2236-0`, on `special_district:washoe_rural_fire_nv_washoe_county_fire_protection_districts_4d2236_0`.

An isolated reproduction with River commit `78f82a232dd1d0545a46835e7716032ff3807425` and PB-03 produces the same error. This is an inherited source-registration identity conflict. Neither boundary was discarded or selected arbitrarily to make the replay pass. Source-registration work must reconcile the two source identities/territories before Nevada’s scheduled import can pass. Nevada is explicitly reported as failed under Sean’s instruction allowing a state exception with its exact reason.

## Named ZIPs and the page

The real `readZipPlace` selected the divisions for 99559, 36602, 85641 and 35801, followed by the actual place query and `stateCoverage`. The actual `DoorOverlay`, `Representation` and `GovernmentListings` components were rendered and checked in Chromium. All browser network requests were blocked, all expected DOM text was visible, and the government inventory disclosures were expanded to inspect their contacts. The standalone component replay omits the site’s CSS shell; deployed layout and CDN checks remain River’s check after shipping.

| ZIP | Verified reader result | Place read |
| --- | --- | ---: |
| 99559 | Lower Kuskokwim Main Governing Board, its REAA inventory and sourced phone | 226 ms |
| 36602 | Mobile Housing Authority Board of Commissioners and existing comment facts | 644 ms |
| 85641 | One Vail governing board with all six saved runtime members | 1179 ms |
| 35801 | City Council and City of Huntsville; no “Huntsville city governing” label | 314 ms |

The production Box’s normal `fact-publisher` built Lower Kuskokwim board-name fact 2119448 on saved source copy 70179, from the district’s Diligent member page. The replay reached that fact through its actual school-district selection. At the later browser snapshot, the saved package also rendered Wassilie Pleasant. The initial nine member findings were not all claimed as published. Mobile’s City of Mobile association comes from its own 2025 admissions policy, not its office address.

The map replay read all three former Vail headers from the real production state registry. `withPlaceRegistry` supplied one canonical Vail header to the actual map coverage consumer and retained all six members and the state officials’ portrait data. The original failed assertion searched for “Vail” in a header whose verified name is “Governing Board”; the corrected assertion checks the durable board ID and roster.

## Vail query timing

The complete River `PLACE_PACKAGE_SQL` and PB-03 SQL were run as read-only `EXPLAIN (ANALYZE, FORMAT JSON)` statements with identical real 85641 division IDs and production inputs.

| Pair | River server execution | PB-03 server execution |
| --- | ---: | ---: |
| 1 | 602.362 ms | 206.295 ms |
| 2 | 206.563 ms | 203.912 ms |

PB-03 was faster in both pairs. The ordinary Vail place read completed in 1,179 ms. The whole-country audit deliberately selects every known local territory in a state at once; its bulk timings are separate from those ordinary ZIP requests.

## Validation and handoff

Focused fact/entity, publisher, alias-refresh, reader and platform checks passed. The production build passed, including the emitted-route trace check (11 routes, 107 required files, no missing files). Tests that spawn parsers or browsers required the environment’s normal network-enabled execution context for local subprocess IPC. Missing locked dependencies and stale build artifacts in the replacement workspace were repaired; their initial failures were not reported as passes.

All-platform scan and live write details are in `docs/pb-03-data.md`: 5,800 active meeting doors across 19 platforms, one extra confirmed Bay Lake mismatch suspended, and 37 derived tenant rereads unverified. A fresh read-only check confirmed LA Metro’s 11 California bodies/91 members, its 30 corrected doors, Oregon Metro’s seven real doors, Ventura’s 13 and Cape Coral’s seven city doors, with no LA Metro members returned by the Oregon package.

Code is ready for River integration, with Nevada’s scheduled-import exception above. Data corrections are live. River owns the post-shipping live-page checks for 99559, 36602, 85641 and Huntsville. No PB-01-owned `lib/sources/legistar/*` file was edited.

The session’s ignored `.scratch/pb03` holds the bounded reports, actual replay programs, saved source snapshots and screenshots: `nationwide-replay.json`, `nationwide-schedule.json`, `nevada-baseline.json`, `replay.json`, `schedule-replay.json`, `map-replay.json`, `browser-replay.json`, `live-repairs-verified.json` and the four `reader-<ZIP>.html`/`.png` files.
