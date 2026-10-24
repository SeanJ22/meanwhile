# Front door

Owner: RB-A3. Branch: `stream/rb-a3`, cut from River `21ae9bcfb`.

Status: final reader replay and complete checks are running after merging River `e2ee3657a`. RB-A1's shared implementation `5bde46615` is folded in River and listed in `board/river`'s integration record. This branch also contains and builds against its newest commit, `1d6df41d9` (documentation only). No READY has been posted.

The one publisher is `lib/core/door.ts`. It resolves existing IDs first, creates a government-named missing board, selects the official or checked lane, chooses the winning value, writes it once, files its existing served places, queues their rebuilds and increments state/hour counts. The old publisher keeps its blank on refusal; new callers supply the refusal handoff once, after the fact transaction releases. RB-A4's service-map implementation is queued after A3; the current filing walks existing subject and parent associations.

Official loaders take the actual parsed source field without searching a quote. Government sites, government-linked portals and held APIs use that lane. A registered government host retains its `www` spelling, and registered CivicClerk and Legistar tenants retain their public portals and document delivery hosts. Other acquisitions use `check.ts` and `clocks.ts`, including the 168-hour meeting window. Owner values win, then OFFICIAL/FILING, REFERENCE, NEWS, CAMPAIGN and OTHER; newer values win within a rank. Campaign and advocacy claims stay about their own subject. Conflicting system values create an owner flag. A repeated fact leaves facts, sources, queues and hourly counts unchanged. `section3.ts` and `validate.ts` remain with their existing families.

## Reader preservation

Sean authorized the production copy in ignored `.scratch/rb-a3/snapshots`, then clarified that the sample must include already-published reader values outside `fact`. Production access uses only `readonly` on reader project `tiny-hill-13996172`, branch `br-delicate-lab-ax02xuo5`, and `wtp_cp_release_readonly` on control-plane project `withered-sunset-39821877`, branch `br-tiny-frog-aeufpjeq`. All mutations run in local PostgreSQL copies.

The sample combines up to 100 live fact values per state with already-published reader fields, capped at 1,000 distinct subject-and-field values in total. It includes government registrations, officeholders, meetings and documents, money and audit findings, ballot candidacies and the other populated reader families. The current reader's SQL decoders resolve `civic_data_payload_parts`; the publication predicate joins `civic_data_promotions`, `civic_data_candidates` and public unchanged-confirmation metadata. The older-meeting path separately selects only promoted candidate read models that satisfy `readPlacePackage`'s archive predicate and 120-day calendar boundary. Identity, alias, host, place and source tables are copied as context and checked for preservation; those context rows do not pad the fact count.

`scripts/rb-a3-reader-sample.mts` selects the bounded current-publication sample. `scripts/rb-a3-reader-archives.mts` substitutes eligible archived values within the same limit. `scripts/rb-a3-reader-replay.mts` sends each selected value through the door, compares the stored value, repeats it, and compares the entire fact/source/count/queue state. It also preserves every pre-existing copied fact and the copied identities. Raw source records remain unchanged. Saved JSON, HTML, YAML and PDF values use their existing production decoders. A moved official PDF can supply the fast lane only when both saved raw files have the same SHA-256; the published record retains its original source attribution.

The final report will replace `measurements/rb-a3/replay.json` after the complete run. Counts are selected values, not fabricated totals for the entire database. Any state below 1,000 uses its real available count; a state with zero values is named and does not pass.

The read-only participation check at 2:20 PM Eastern resolved all 56 reaction rows, all three demand-signal rows and the one Ask row. Speak your mind had no rows. All 36 distinct target IDs resolved. See [the counts](measurements/rb-a3/live-id-resolution.json).

## Two connections on production data

1. The real Mesa subject and its held Legistar API (`BodyId 138`, `BodyName = City Council`) go through the official lane in the local production copy with an empty quote. The current fact reader and place composer return that name and API citation.
2. Mesa's saved government council page supplies `20 E. Main Street / Mesa, AZ 85201`. An actual Box finding goes through `publishBoxFindings`, the compatibility publisher and the checked door. The resulting address has quote offset 1443. Mesa, Arizona and the US parent are queued, and Arizona receives one count through each lane.

The fresh Chrome capture at 1:59 PM Eastern showed 33 bodies, 36 meetings, 76 districts and 27 officials on `https://meanwhileusa.com/?zip=85201`. Chrome then opened today's production frontend with only fact-data responses supplied from the local copy: the address and government source appeared. The branch's standalone frontend also showed the API source. Both checks had no page errors. The full captured reader response and unrelated values were retained. These are local-copy connections using real production data; no production fact was inserted.

Admin's existing Scoreboard displays facts through each lane by state and hour. Chrome showed 57 state/territory/national rows and Arizona's official `1` and checked `1` in the 2 PM Eastern hour. A missing measurement stays blank; once the first door hour exists, an observed zero is shown as zero.

See [the connection results](measurements/rb-a3/connections.json), [production before](measurements/rb-a3/production-before.png), [production frontend with the copied result](measurements/rb-a3/production-reader-with-copy.png), [both Sources](measurements/rb-a3/copy-sources.png) and [Admin](measurements/rb-a3/copy-admin.png).

## Next scheduled run and checks

The normal Box publisher ran on a real one-minute timer at 2:03:46, 2:04:46 and 2:05:46 PM Eastern. The middle tick published the checked address; the following tick changed no fact, source, queue or count. This used wall-clock scheduling in the local production copy, not an advanced test clock. See [the scheduled passes](measurements/rb-a3/next-run.json).

All 41 focused door, API and source-path checks pass. The preceding complete run passed eight of nine checks: 9,807 tests passed, one source-style check failed and two were skipped. Both offending network-URL expressions were corrected; that focused check passes. The final complete check record will replace [checks.json](measurements/rb-a3/checks.json). READY requires that run and the full state replay to pass.

The branch is pushed only to its own stream. After READY it continues watching `origin/board/river` for a return and for the explicit RB-A3 live-check result.
