# PB-03 reader and scheduled-run replay

October 23, 2026: all 56 state and territory reader replays and all 56 tomorrow-clock importer replays pass. The latest reader snapshots cover 6,435 locally associated held boards and 12,306 live facts; 7,707 copied board identities survive tomorrow’s import. The Washoe Rural source conflict is resolved.

## Source to reader

The boundary feeder is the official district/county source registry through `district-territories.mts` into registration. Other feeders are platform discovery, PB-01 Legistar acquisition and the standing Box fact publisher. PB-03 connects governments, boards, aliases, facts and source-established territory to `readPlacePackage`. Its output feeds `stateCoverage`, `DoorOverlay`, `Representation` and `GovernmentListings`. River combines and ships the lane. This moves §0’s tests that held information reaches every applicable place, facts reach readers, and results are correct and fast.

Every production proof query used a `readOnly: true` transaction. The production reader confirmed role `readonly`, `transaction_read_only=on`, and no INSERT/UPDATE/DELETE grants on public tables. Endpoint: `ep-dry-river-axwtolzc`, production branch `br-delicate-lab-ax02xuo5`. Live data repairs were separate authorized writes with the existing Admin history and undo.

## Whole-country reader proof

Each state was read separately. The replay selected every local division established by its published registration associations, independently followed the native and operational government IDs and entity parent relationships, and compared every resulting board with the real `readPlacePackage` result. It also passed the package through the real `stateCoverage` consumer and checked that each sourced, named local board was included. It checked merged aliases, repeated runtime IDs, direct statewide board links and the replaced generated name suffix. No expected local board was missing in any state.

The country passes exposed generated labels outside the initial repair set and newly created by the still-deployed importer. Admin receipts 207 and 208 corrected 294 additional labels, removed nine direct statewide board links, and removed two empty Census-placeholder boards. The importer now uses the existing Census-placeholder rule, repairs the old generated labels during reload and held-board publication, and derives fallback names from the real government. The Nevada follow-up repeated the full 56-state reader and tomorrow-clock passes. Receipts 209, 211 and 212 corrected 17 further generated labels and five state links from the still-running old importer. The final query was replayed in all 56 jurisdictions; Alabama, Arkansas and Georgia were rechecked after the last data correction. All source facts and identities remained intact.

Counts cover every installed government row, including the state itself; boundary rows include `BOUNDARY_SOURCE` and `BOUNDARY_SOURCE_ONLY`. Local boards and facts come from actual production reader selections. Scheduled boards include held boards without local associations. Zero means no matching held rows, not complete acquisition. Every row below passed both the reader and the tomorrow-clock replay, with zero source-identity collisions. Production continues acquiring data, so reader and scheduler counts have separate snapshot times.

The full installed scan covers 93,753 government rows and 9,406 boundary rows. Nevada was the only repeated operational identity before correction; none remain. An independent read-only SQL aggregation over all 98,877 government listings in the 56 published production inventories also found zero repeated operational identities. No state was omitted or exempted.

| State | Reference rows | Boundary rows | Local boards | Live facts | Scheduled boards | Reader / tomorrow |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| AK | 448 | 0 | 71 | 196 | 76 | Pass / Pass |
| AL | 1,216 | 82 | 236 | 510 | 252 | Pass / Pass |
| AR | 1,556 | 65 | 114 | 212 | 131 | Pass / Pass |
| AS | 95 | 0 | 0 | 0 | 0 | Pass / Pass |
| AZ | 711 | 164 | 532 | 984 | 900 | Pass / Pass |
| CA | 4,649 | 483 | 922 | 1,946 | 1,280 | Pass / Pass |
| CO | 3,719 | 2,487 | 118 | 290 | 158 | Pass / Pass |
| CT | 781 | 36 | 52 | 65 | 51 | Pass / Pass |
| DC | 52 | 46 | 1 | 2 | 3 | Pass / Pass |
| DE | 337 | 1 | 20 | 37 | 20 | Pass / Pass |
| FL | 2,190 | 257 | 379 | 1,116 | 378 | Pass / Pass |
| GA | 1,382 | 17 | 118 | 176 | 116 | Pass / Pass |
| GU | 1 | 0 | 0 | 0 | 0 | Pass / Pass |
| HI | 83 | 0 | 4 | 4 | 5 | Pass / Pass |
| IA | 1,839 | 5 | 16 | 24 | 15 | Pass / Pass |
| ID | 1,167 | 507 | 38 | 55 | 37 | Pass / Pass |
| IL | 7,023 | 443 | 381 | 991 | 426 | Pass / Pass |
| IN | 2,699 | 249 | 8 | 10 | 7 | Pass / Pass |
| KS | 3,763 | 16 | 3 | 5 | 3 | Pass / Pass |
| KY | 1,306 | 168 | 11 | 6 | 11 | Pass / Pass |
| LA | 550 | 0 | 0 | 0 | 0 | Pass / Pass |
| MA | 1,095 | 74 | 32 | 92 | 32 | Pass / Pass |
| MD | 382 | 1 | 258 | 105 | 258 | Pass / Pass |
| ME | 996 | 82 | 10 | 60 | 10 | Pass / Pass |
| MI | 2,874 | 12 | 135 | 341 | 142 | Pass / Pass |
| MN | 3,659 | 8 | 15 | 90 | 15 | Pass / Pass |
| MO | 3,796 | 38 | 377 | 321 | 377 | Pass / Pass |
| MP | 5 | 0 | 0 | 0 | 0 | Pass / Pass |
| MS | 971 | 15 | 0 | 0 | 0 | Pass / Pass |
| MT | 1,257 | 290 | 0 | 0 | 0 | Pass / Pass |
| NC | 1,148 | 14 | 151 | 93 | 151 | Pass / Pass |
| ND | 2,573 | 298 | 0 | 0 | 0 | Pass / Pass |
| NE | 2,554 | 436 | 0 | 0 | 0 | Pass / Pass |
| NH | 552 | 9 | 548 | 0 | 665 | Pass / Pass |
| NJ | 1,403 | 5 | 497 | 99 | 717 | Pass / Pass |
| NM | 1,023 | 33 | 74 | 318 | 74 | Pass / Pass |
| NV | 242 | 49 | 41 | 151 | 41 | Pass / Pass |
| NY | 3,502 | 216 | 128 | 340 | 128 | Pass / Pass |
| OH | 3,937 | 19 | 71 | 85 | 71 | Pass / Pass |
| OK | 1,894 | 33 | 33 | 237 | 33 | Pass / Pass |
| OR | 1,541 | 145 | 0 | 0 | 79 | Pass / Pass |
| PA | 4,851 | 107 | 15 | 28 | 15 | Pass / Pass |
| PR | 79 | 0 | 0 | 0 | 0 | Pass / Pass |
| RI | 159 | 28 | 0 | 0 | 0 | Pass / Pass |
| SC | 676 | 8 | 0 | 0 | 0 | Pass / Pass |
| SD | 1,902 | 69 | 0 | 0 | 0 | Pass / Pass |
| TN | 1,032 | 86 | 0 | 0 | 0 | Pass / Pass |
| TX | 5,702 | 1,445 | 332 | 616 | 332 | Pass / Pass |
| UT | 639 | 67 | 10 | 27 | 10 | Pass / Pass |
| VA | 660 | 4 | 1 | 6 | 1 | Pass / Pass |
| VI | 1 | 0 | 0 | 0 | 0 | Pass / Pass |
| VT | 571 | 5 | 0 | 0 | 0 | Pass / Pass |
| WA | 1,957 | 466 | 30 | 136 | 30 | Pass / Pass |
| WI | 3,061 | 7 | 650 | 2,522 | 654 | Pass / Pass |
| WV | 642 | 5 | 0 | 0 | 0 | Pass / Pass |
| WY | 850 | 306 | 3 | 10 | 3 | Pass / Pass |
| **Total** | **93,753** | **9,406** | **6,435** | **12,306** | **7,707** | **56 / 56** |

## Next-day scheduling proof

All 56 state and territory inventories were copied one state at a time through read-only production queries into a locally migrated PostgreSQL store. The replay used each state’s actual held entities, place links, hosts, durable body aliases and published registration. The real `IndependentRuntimeLaneScheduler`, production five-minute `ROUTINE_DATA_ADMISSION_MS`, `ROUTINE_PASS_BUDGET_MS` and actual `ensureFactEntities` entry point ran on an unforced clock tick. A tick one millisecond before the next interval admitted nothing. Advancing the clock 24 hours admitted the lane automatically. In all 56 states and territories, 7,707 copied board identities, names, parents and place links survived unchanged on the second run; unchanged registration inputs were not loaded again.

The separate AK/AL/AZ replay also copied 26 entities, 21 real live facts, 16 saved-source rows and three production registration records. It ran the actual place reader after both scheduler admissions. Lower Kuskokwim remained on its school district with the source-verified board name, Mobile Housing retained its City of Mobile facts, and Vail remained one canonical board. Both runs completed. This is a controlled-clock test of October 24’s automatic admission; it does not claim the future wall-clock run has happened. The focused platform-census test separately confirms that tomorrow’s own-site check cannot revive a directory-only portal.

### Washoe Rural reconciled from its official boundary

The district’s [own coverage-map link](https://tmfpd.us/) publishes the [April 30, 2025 fire-district map](https://tmfpd.us/wp-content/uploads/2025/10/Fire-Station-Map-2025.pdf). It distinguishes Washoe Rural from Truckee Meadows and credits Washoe County Technology Services. The county’s [Fire Protection Districts feature](https://wcgisweb.washoecounty.us/arcgis/rest/services/OpenData/OpenData/FeatureServer/126) supplies `WASHOE RURAL`, object 1, GlobalID `{6D6BAE4C-E780-406B-A877-4A535304AB18}`, area 5,390.7778544 square miles. The government’s [`.gov` fire-district service](https://gisweb.washoecounty.gov/arcgis/rest/services/OpenData/OpenData/MapServer/150) independently confirms the distinct district and explains the county’s tax-code boundary basis. The county’s old fire-site URL redirects to the district’s current site.

A fresh query of the chosen county feature, through the actual territory simplifier, exactly reproduced its installed polygon. That polygon replaces the temporary statewide WFPP version. The data now contains one operational government, `nv:special:washoe-rural-fire`, one county-native identity, `nv-washoe-county-fire-protection-districts-4d2236-0`, and one territory, `ocd-division/country:us/state:nv/special_district:washoe_rural_fire`. The redundant suffixed territory and WFPP government row are removed. Registration and ZIP index hashes were recomputed.

The six duplicate ZIP associations were removed without adding or losing residents: 89405 = 49, 89412 = 253, 89424 = 525, 89506 = 3, 89508 = 895, 89510 = 651; total 2,376. The existing three-resident fringe treatment for 89506 remains intact. A source-data exclusion names Washoe Rural on the WFPP layer; filtering happens after feature indexes are assigned, so White Pine County and Reno-Tahoe Airport Authority retain native keys 32 and 33. The actual source parser reread both real services: 78 retained features and exactly one Washoe Rural, from the county source. It cannot recreate the competing WFPP record on regeneration.

The connected Nevada replay at `2026-10-23T09:59:53.252Z` copied the actual 193-listing production inventory and 541 held entities through read-only transactions. It then ran `registrationReferenceWithPublished`, `registrationCandidate`, the real `processRegisteredRoutineCandidate` validators and publisher in a local store, and the actual importer and place reader in a migrated local database. The resulting validated 248-listing projection reaches `GovernmentListings`: the five ZIPs above the normal resident threshold show exactly one county-sourced Washoe Rural listing in Chromium; 89506 names the fringe division without claiming that government for the whole ZIP. Advancing the actual lane clock to `2026-10-24T09:59:53.252Z` automatically reran the publisher/importer and returned the same six selections. No future timestamps were written to production or inserted into a fixture lifecycle. This tests the next admission; it does not claim the future wall-clock run has happened.

The source PDF SHA-256 is `fbabda587561cf828f7f52e91d659d774722f8fe928641ed848cdbe8174eb49a`; the saved county-feature response is `b41ab4fc40664a4da74346db63cab1d2b556482c6c99562ce4e7861b67eb8f8d`. Admin receipt 210 retains the source response, old identities/geometries, before-values and undo. Production held neither conflicting Washoe Rural native record nor any Washoe Rural facts, so no live fact or membership needed moving. The corrected packaged reference and its regeneration rule await River’s integration.

## Named ZIPs and the page

The real `readZipPlace` selected the divisions for 99559, 36602, 85641 and 35801, followed by the actual place query and `stateCoverage`. The actual `DoorOverlay`, `Representation` and `GovernmentListings` components were rendered and checked in Chromium. All browser network requests were blocked, all expected DOM text was visible, and the government inventory disclosures were expanded to inspect their contacts. The standalone component replay omits the site’s CSS shell; deployed layout and CDN checks remain River’s check after shipping.

| ZIP | Verified reader result | Place read |
| --- | --- | ---: |
| 99559 | Lower Kuskokwim Main Governing Board, its REAA inventory and sourced phone | 286 ms |
| 36602 | Mobile Housing Authority Board of Commissioners and existing comment facts | 264 ms |
| 85641 | One Vail governing board with all six saved runtime members | 649 ms |
| 35801 | City Council and City of Huntsville; no “Huntsville city governing” label | 218 ms |

The production Box’s normal `fact-publisher` built Lower Kuskokwim board-name fact 2119448 on saved source copy 70179, from the district’s Diligent member page. The replay reached that fact through its actual school-district selection. At the later browser snapshot, the saved package also rendered Wassilie Pleasant. The initial nine member findings were not all claimed as published. Mobile’s City of Mobile association comes from its own 2025 admissions policy, not its office address.

The map replay read all three former Vail headers from the real production state registry. `withPlaceRegistry` supplied one canonical Vail header to the actual map coverage consumer and retained all six members and the state officials’ portrait data. The original failed assertion searched for “Vail” in a header whose verified name is “Governing Board”; the corrected assertion checks the durable board ID and roster.

## Vail query timing

The refreshed two-pair comparison exposed a slowdown, and an eight-pair check confirmed it. The plan repeated website ownership checks separately for 65 held boards. The query now materializes eligible government hosts once, retaining the same ownership and geographic conditions before selecting those boards.

The final comparison ran complete River and PB-03 SQL in one read-only, repeatable-read production transaction with the same real 85641 divisions and data snapshot. Two warmups preceded eight measured pairs, alternating order. All samples are retained; every final PB-03 sample was faster than its paired River sample.

| Eight measured runs | River | Final PB-03 |
| --- | ---: | ---: |
| Median server execution | 198.674 ms | 86.678 ms |
| Mean server execution | 203.453 ms | 87.677 ms |
| Range | 196.717–220.167 ms | 84.745–96.857 ms |

The ordinary latest Vail place read completed in 649 ms. Country-wide selection timings exercise bulk inventories and are separate from an ordinary ZIP request.

## Validation and handoff

The Nevada follow-up passed 57 focused registration, fact/entity, boundary, ZIP and reader checks. An obsolete Ohio count assertion initially omitted four independently held Census listings; it now checks the exact identity union and uniqueness, and all five jurisdiction tests pass. TypeScript and focused lint passed. The actual Nevada publisher validators and both scheduler admissions passed. The production build passed, including the emitted-route trace check (11 routes, 107 required files, no missing files). Tests that spawn parsers or browsers required the environment’s normal network-enabled execution context for local subprocess IPC. Missing locked dependencies and stale build artifacts in the replacement workspace were repaired; their initial failures were not reported as passes.

All-platform scan and live write details are in `docs/pb-03-data.md`: 5,800 active meeting doors across 19 platforms, one extra confirmed Bay Lake mismatch suspended, and 37 derived tenant rereads unverified. A fresh read-only check confirmed LA Metro’s 11 California bodies/91 members, its 30 corrected doors, Oregon Metro’s seven real doors, Ventura’s 13 and Cape Coral’s seven city doors, with no LA Metro members returned by the Oregon package.

Code and the corrected boundary reference are ready for River integration. The production name, place, alias, roster and door corrections are live. All 56 reader and tomorrow-clock replays pass; there are no state exceptions. River owns the post-shipping live-page checks for 99559, 36602, 85641 and Huntsville. No PB-01-owned `lib/sources/legistar/*` file was edited.

The session’s ignored `.scratch/pb03` holds the bounded reports, actual replay programs, saved source snapshots and screenshots: `nationwide-replay.json`, `nationwide-schedule.json`, `nevada-baseline.json`, `replay.json`, `schedule-replay.json`, `map-replay.json`, `browser-replay.json`, `live-repairs-verified.json`, `boundary-double-records-after.json`, `published-double-records-before.json`, `published-double-records-after.json`, `nevada-connected-replay.json`, `nevada-browser-replay.json`, `vail-balanced-timing.json`, `nv-official/` and the four `reader-<ZIP>.html`/`.png` files.
