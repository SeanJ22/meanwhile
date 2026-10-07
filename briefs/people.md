# Lane: people (People, portraits and stances)

**Starts in Claude** (suggested model Sonnet 5.5) as an hourly cloud task. Status file: `.factory/people.md` on `stream/people`.

Read `briefs/common.md` first. Your work is every row in `briefs/ownership.csv` with `lane = people` (1,195 rows). Each row's full reason and evidence are in the inventory. Take them in the order below.

**Area.** Officials and legislators from Open States, official rosters and PRL; state roll calls and key votes; statements, positions and social accounts; candidate identity and campaign sites; curated bodies and rosters as data (group D); and portraits (groups I and M).

## 1. What stops free acquisition (rulings §2)

| Path | Action |
|---|---|
| `data/states/nh/hunt/nh-gencourt-members.json` (group E) | Same facts already live in the database, refreshed by the daily NH General Court feed. This file only seeds an empty store and feeds tests. Delete in the same release as lib/civic-data/state-members.ts's replacement. |
| `lib/civic-data/state-members.ts` (group E) | State legislators should come from one national reader for every state; delete with that replacement. |
| `lib/control-plane/scheduler/providers/candidate-enrichment.ts` | Candidates come only from hard-coded AZ/NH/NJ ballot authorities (Pima, Merrimack, Morris); Wikipedia is limited to pointing, and the dead 4get route is still registered. |
| `lib/sources/az-legislature/roster.ts` | Fix: attach the held official portraits instead of photo null, and drop the 120-second robots crawl delay on a state site. |
| `lib/sources/legiscan/snapshot.ts` | Opens votes only for official AZ/NH/NJ scopes and calls LegiScan data research-only. Read votes for every state from LegiScan/Open States, official replacing them. LegiScan has no scheduled job. |
| `lib/sources/nh-general-court/official-data.ts` | Fix the parser; drop the 11-second robots delay and the hard-coded 2026 session. |
| `lib/sources/nj-legislature/roster.ts` | Plain code runs it daily but blanks phone, email and photo. Fill them from Open States and the held official portraits. |
| `lib/sources/plural/place.ts` | Runs only when Sean sends a place, and uses the Open States row only for name and seat after the official page fails. Carry every Open States field. |
| `lib/sources/prl/data-plane.ts` | Accepts Bioguide ids only, so 7,757 state legislator profiles never publish. Accept Open States ids; put PRL on a daily clock (now owner-only). |
| `lib/sources/prl/index.ts` | Owner-run only. Joins by Bioguide id only, so state legislators are dropped. Also read state profiles keyed by Open States id. |
| `lib/state-rollcalls/authority.ts` | Use all 50 states plus DC and PR from Open States, with official rosters replacing values. |
| `lib/state-rollcalls/promotion-authority.ts` | Make the member match work for every state's roster, Open States included, without the three-state refusal. |
| `scripts/fetch-prl.mts` | Free source that runs only when Sean invokes it, and only federal profiles. Put it on a daily clock and load state legislators' profiles too. |
| `scripts/nh-gencourt-members.mts` | Fix the 'no logical rows' parse failure and drop the RULING citations (:3, :20-26, :99, :123, :180, :246). |
| `scripts/prl-refresh.mts` | Put it on a daily runner clock for federal and state data, and run datasets in parallel instead of one at a time (:67). |
| `scripts/state-legislators.mts` | Official rosters should replace Open States values in every state. Remove the AZ/NJ-only targets and the NH refusal; read rosters from the source registry. |
| `scripts/state-rollcalls.mts` | Use Open States and LegiScan for every state, official roll calls replacing them, and publish each verified vote. |
| `tests/nh-official-rollcalls.test.ts` | Official vote reader is real. It pins a fixed 11-second serial delay on a state site; rulings say state sites are read at full speed with backoff only on 429/5xx. |
| `tests/nj-state-rollcalls.test.ts` | Official vote reading is real. Delete the test that keeps Arizona votes fail-closed and requires a two-good live acceptance gate. |
| `tests/officeholder-statements-data-plane.test.ts` | Statement publishing is real. Delete the owner-only assertion and the tombstone checks that deleted writers stay deleted. |
| `tests/prl-archive-store.test.ts` | PRL ingest code is reached only by tests and a manual script, so PRL never refreshes. Put PRL ingest on a daily runner job; the test then stays. |
| `tests/prl-ingest-engine.test.ts` | Same unwired PRL ingest. Run it daily for federal and state so the held state profiles publish. |
| `tests/prl-ingest.test.ts` | Same unwired PRL ingest; wire it to a daily job. |
| `tests/prl-precompute.test.ts` | Same unwired PRL ingest; wire it so state legislator profiles reach readers. |
| `tests/state-rollcall-permanent-boundary.test.ts` | Keep promotion-integrity tests; delete the AZ/NH/NJ authority lists and the assertion banning Open States imports. |

Group E (inventory): One Open States reader publishes legislators for every state, official values replacing them. Then the NH-only reader and file are deleted.

## 2. Groups

### Group D (9 rows)

Inventory: Bodies and rosters load into the database registry through the normal data path; Ask and votes read published rosters; tribal nations come from the national Census list. Then the code lists are deleted.

Load bodies and rosters through the normal data path before deleting the code lists.

| Path | Action |
|---|---|
| `lib/holdings/discovery.ts` | Delete once the replacement is live. Its job is reading place data (rosters) from repo files. Ask and votes should read published rosters from the database instead. |
| `lib/registry/cawcd-rosters.ts` | Roster data held as a repo file. It belongs in the database. Move the rosters into the database first, then delete. |
| `lib/registry/coverage-audit.ts` | Delete once the replacement is live. Frozen evidence from August hunts for Pima, Rockaway, Newbury and Morris, held in code. |
| `lib/registry/curated-bodies.ts` | 2,500 lines of pilot-place body data typed into code. Bodies belong in the database registration. Move its bodies into the database first, then delete. |
| `lib/registry/promoted-bodies.json` | Body data held as a repo file. Only dev/test fallback and scripts read it. Delete in the same release as lib/registry/promoted-bodies.ts's replacement. |
| `lib/registry/promoted-bodies.ts` | Its job is storing place data in the repo. Only scripts use it. Move its bodies into the database first, then delete. |
| `lib/registry/registry.json` | 2.9 MB of three-state place data in the repo. Production reads the promoted registry; only dev/test fallback reads this. Delete in the same release as lib/registry/promoted-bodies.ts's replacement. |
| `lib/registry/rosters-nj-morris.ts` | Roster data for one county, generated into code. Move the rosters into the database first, then delete. |
| `lib/registry/tribal-nations.ts` | Tribal nations should come from the national Census list as data. Load the national Census list first, then delete. |

### Group I (13 rows)

Inventory: Official and campaign-site portrait finds load into the database as held evidence and publish under the portrait rule. Then the review-queue files are deleted.

| Paths | Action |
|---|---|
| `data/photos/*.json` (13 portrait review-queue files) | Load official and campaign-site finds into the database as held evidence so they publish under the portrait rule (rulings §3); then delete. |

### Group M (1,068 rows)

Inventory: Portraits move to the SeanJ22/wtp-assets repo and are served to readers through a CDN in front of it (jsDelivr). Photo URLs point there. New portraits the fleet finds are committed there by the runner, never to this repo, so a new photo never needs a release and never touches Neon.

You build the runner's wtp-assets writer here. The registry lane reuses it for group N.

| Paths | Action |
|---|---|
| `public/officials/**` (1,014 portrait files) | Move to `SeanJ22/wtp-assets`, serve through jsDelivr, point photo URLs there, then delete from this repo. |
| `public/candidates/**` (52 portrait files) | Move to `SeanJ22/wtp-assets`, serve through jsDelivr, point photo URLs there, then delete from this repo. |

| Path | Action |
|---|---|
| `lib/ops/asset-remote.ts` | Keep it: it is the address of wtp-assets. Point readers at the jsDelivr CDN in front of it rather than raw.githubusercontent.com, and add the runner's write path for new portraits. |
| `scripts/assets.mts` | Replaced by the runner committing portraits to wtp-assets directly; delete when that ships. |

### Group N (4 rows)

Inventory: Large, slow-changing reference files (the ZIP index, boundary files) move to wtp-assets and are read through the CDN. Facts (body descriptions, seat makeup, coverage tiers, Arizona text compiled into code) live in the database, where the factory checks and updates them, and are published per state to wtp-assets for readers. Readers never pull these from Neon.

| Path | Action |
|---|---|
| `data/states/az/officials/body-compositions.json` | Readers see these seats and they are bundled into code, so only a release changes them. Move into the database. |
| `data/states/az/officials/cawcd-rosters.json` | Reader rosters bundled into code; only a release changes them. Move into the database. |
| `lib/officials/campaign-sites.ts` | Reader needs it. Remove the Open States ID ban call and move the hand-typed sites into the database. |
| `lib/registry/body-rosters.ts` | Readers need the roster code. Move the hand-typed rosters (about lines 119-2470) and the Morris import into the database roster records. |

Rows of these groups that stop free acquisition are in section 1: E (2).

## 3. The rest

| Path | Action |
|---|---|
| `app/api/directory/route.ts` | State legislators always get no committees and only offices. Serve committees, email and social accounts from Open States for every state legislator. |
| `app/api/questionnaire/route.ts` | Keep the route. Delete the RULING 112 and NH108 citations from its comments. |
| `app/api/votes/local/route.ts` | Built but nothing calls it, so readers never see local votes. Call it from the local official's card. |
| `app/api/votes/route.ts` | Open States ids are treated as retired test ids and state votes only work where an "official" scope is typed. Accept Open States ids as ordinary ids and serve any state's votes. |
| `lib/candidates/campaign-site-verifier.ts` | Runner needs it. Delete the never-produced historical robots refusal code and owner-decision comments; move the hand-typed NJ/NH/AZ news-site list into data so new states work. |
| `lib/candidates/positions.ts` | Remove ruling citations, and when nothing is held show "We're working on getting this info" instead of rendering nothing. |
| `lib/civic-data/social-accounts.ts` | Mission-aligned (social accounts owed on person cards), but nothing runs it yet; only a test calls it. Wire it into roster and campaign-site publishing. |
| `lib/civic-data/worker-national-publication.ts` | The national place publisher the mission needs, but statewide officers are published with party, email, phone, photo and term forced blank, and Open States is used only when the official page fails. |
| `lib/corpus/data-plane.ts` | Ask, ballot and positions use it. Remove the Open States ban check (productionEligible) and the frozen repo-file bootstrap from data/corpus/statements.json. |
| `lib/corpus/said-at-the-time.ts` | Serves the mission but nothing calls it yet; wire it into vote cards and Ask or it is dead code. Drop the "(Sean, Oct 3)" attribution. |
| `lib/corpus/statement-sweep-search.ts` | Equal-effort search the mission wants, but nothing calls it; connect it in the gateway registry as its own commit note says. |
| `lib/corpus/unified.ts` | Remove comment text describing Open States ids as ineligible and the historical bootstrap narrative. |
| `lib/hunt/candidate-universe.ts` | Right idea and used by the campaign-site job, but a ruling number is written into its output text and header. Remove the RULING 229 citations. |
| `lib/hunt/roster-page.ts` | General roster reader used by the election-page and Open States place code. Keep it; strip the rule citations. |
| `lib/officials/member-directory-scope.ts` | Keeps committees federal-only, so state legislators get none. Let committees and offices reach every state legislator from Open States. |
| `lib/officials/member-offices-publication.ts` | Runs only for the three hard-coded states and drops members with no official roster match. Run for every state; official values replace differing ones. |
| `lib/officials/member-offices-read.ts` | Calls the Open States ID ban. Remove that call. |
| `lib/officials/member-offices.ts` | Publish Open States members without an official match too, and remove the '(Sean, date)' note. |
| `lib/officials/statewide-executives.ts` | The reader functions are needed, but the officers are hand-typed for AZ, NH and NJ with owner photo-approval notes. Read every state's officers from the database. |
| `lib/officials/types.ts` | Used everywhere. Its comment says officials ship as JSON and nothing reads the database, which is false and points agents the wrong way. |
| `lib/ops/asset-scope.ts` | Used by the asset tool. Remove the docs/photo-review exemption, which exists for Sean approving portraits (no review step exists), and strip ruling citations. |
| `lib/photos/evidence.ts` | Open States photos are treated as an outside source needing a second match, but the rules approve Open States for photos. Let them publish alone; make the 7-day capture limit an Admin setting. |
| `lib/photos/person.ts` | Skips any officeholder with an Open States ID through the Open States ban. Delete that check and the import. |
| `lib/questionnaire/positions-state.ts` | The empty-section lines are invented copy. Rules say a stance with nothing found shows "Not found in the sources checked", otherwise "We're working on getting this info". Remove the ruling citations too. |
| `lib/registry/comment-access.ts` | The reader is needed; the hand-typed rows for Pima, Morris and NH bodies are data in code. Move them to the database comment-access records. |
| `lib/registry/runtime-read-model.ts` | Needed. Delete the dev/test first-seed loader that reads the repo JSON files. |
| `lib/registry/server.ts` | Remove the Open States ban calls, keep verified portraits without a license line, and read territories from the database instead of an AZ file. |
| `lib/sources/legiscan/types.ts` | Used by every state-vote reader. Delete the comment calling the LegiScan corpus 'not a production authority'. |
| `lib/sources/prl/receipt.ts` | Comment declares PRL 'research inventory, not reader-facing' and owner-only. Delete that policy text; PRL is a named reader source. |
| `lib/sources/prl/snapshot.ts` | Returns a profile only for congress Bioguide ids. Serve state legislators' profiles by their Open States id too. |
| `lib/state-rollcalls/legislators.ts` | Every state legislator's photo is forced to null though 439 official portraits are held, and New Hampshire has its own special branch. Attach held portraits and read every state the same way. |
| `lib/state-rollcalls/reader-vote-visibility.ts` | Show votes for any state that has them and delete this list and its RULING 250/254 citation. |
| `lib/votes/departed-seat.ts` | Readers must be able to ask how someone voted years ago, so wire it into the votes and Ask lookups. |
| `lib/votes/key-vote-selection-v1.ts` | Goes with the key-vote list moving into the Admin picks setting: read picks from the setting instead of this code list. |
| `lib/votes/key-votes-projection.ts` | When the database has no record it serves bundled JSON files from the repo. Reader data should come only from the database; delete the bundled fallback. |
| `lib/votes/key-votes.ts` | Load them into the Admin key-vote picks setting, give Admin an add/remove screen, then delete this list. |
| `tests/asset-remote.test.ts` | Real restore behavior; remove "Sean's decision" and numbered-ruling labels in comments. |
| `tests/asset-store.test.ts` | Keeps big files out of the repo, which fits the rulings; remove the "RULING 20" labels from every test title. |
| `tests/body-class-labels.test.ts` | Labels stay; remove numbered-ruling titles and the tests pinning the hand-typed list of three Arizona tribal nations, which should become national data. |
| `tests/body-composition.test.ts` | Real behavior, but it reads lib/registry/registry.json, a stale copy nothing that runs reads; use fixtures or the runtime registry. |
| `tests/body-identity.test.ts` | Real behavior; it reads the committed meetings snapshot file, which should move to the database. Use a fixture. |
| `tests/body-rosters.test.ts` | Delete the rule refusing rosters from vendor-hosted government sites, and stop reading the stale registry copy and committed evidence ledgers. |
| `tests/candidate-corpus.test.ts` | Equal-effort and no-score checks stay; remove numbered-ruling labels and the part that runs the one-off b14-coverage script. |
| `tests/candidate-portraits.test.ts` | Matches the portrait rule, but lib/ballot/candidate-portraits.ts is not used by anything that runs yet; wire it into publishing. |
| `tests/cawcd-roster.test.ts` | Behavior is right, but the roster is a committed Arizona data file read by code; test it from database data once it moves there. |
| `tests/comment-access.test.ts` | Shows readers how to comment at a meeting; real product behavior. |
| `tests/congress-directory.test.ts` | Remove the "the author's ruling" message and the test pinning counts to a brief's numbers. |
| `tests/fixed-pill-set.test.ts` | The predicate limits committees to federal members. Update the test once state legislators get committees from Open States. |
| `tests/held-roster-publication.test.ts` | Good plain-code roster door, but it refuses an unlinked city .com page outright. That page should publish as an ordinary source. |
| `tests/key-votes.test.ts` | Key votes are Sean's picks as data, but this pins a 36-item list in code and its exact size. Move the list into Sean's picks. |
| `tests/legiscan.test.ts` | Join and attribution tests are real, but the first test pins that production refuses LegiScan without an official projection. |
| `tests/member-offices-scope.test.ts` | Address parsing is real. It pins committees as federal-only and refuses Open States ids, both of which the mission removes. |
| `tests/officeholder-lookup.test.ts` | Lookup is real. It reads lib/registry/officeholders-us.json, a file only tests read, and pins pilot ZIP 85641; use a fixture or database data. |
| `tests/party-breakdown.test.ts` | Real. It reads lib/registry/officeholders-us.json, a file only tests read; use a fixture or database data. |
| `tests/party.test.ts` | Drop the pilot-ZIP sweep and RULING 159/62 citations; audit database data instead of committed files. |
| `tests/person-name.test.ts` | Name logic tests are real. The sweep at line 75 reads committed AZ/NH/NJ ballot and roster files; sweep database data or a fixture instead. |
| `tests/plural.test.ts` | Delete the tests that refuse Open States photos as unlicensed hotlinks, remove the RULING 80 citation, and use a fixture instead of lib/registry/registry.json. |
| `tests/portrait-decode.test.ts` | Delete the test that the portrait review queue refuses rows; rulings say portraits have no review step. Remove the RULING 110 citation. |
| `tests/portrait-resolution.test.ts` | Remove the RULING 55/206 citations and the reference to the owner-approved portraits evidence file. |
| `tests/position-identity-keys.test.ts` | Real, but the chain refreshes only the federal and Arizona projections. Make it read whichever state's projection the person is in. |
| `tests/prl.test.ts` | Neutrality checks are real. It checks the committed data/prl/prl-profiles.json snapshot, which belongs in the database; test on a fixture. |
| `tests/questionnaire.test.ts` | Remove RULING 110/112/100/116/147/62 citations and delete the checks on docs/candidate-questionnaire*.md wording and generated-doc sync. |
| `tests/said-at-the-time.test.ts` | Code is reached by nothing but this test; wire lib/corpus/said-at-the-time.ts into statement publishing so readers see what officials said at meetings. |
| `tests/social-accounts.test.ts` | lib/civic-data/social-accounts.ts is reached by nothing but this test; wire it into roster publication so socials reach person cards. |
| `tests/state-rollcalls-fanout.test.ts` | Fan-out behavior stays; strip the "Sean's S6 instruction" comment. |
| `tests/statement-sweep-search.test.ts` | lib/corpus/statement-sweep-search.ts is reached only by this test; wire it into the statement sweep so stances get searched for every person. |
| `tests/vote-source-isolation.test.ts` | Keep isolation tests; delete the AZ/NH/NJ authority map, the retired-NH-pointer refusal and the retired-aggregate (Open States) probe tests. |

**Check and close (8 rows).** The inventory gives these only comment, citation or deleted-file reference fixes, which the cleanup release was doing. Confirm each is done on `river`; finish any leftover; then close the row: `tests/photo-person.test.ts`, `tests/portrait-pick.test.ts`, `tests/positions-search.test.ts`, `tests/questionnaire-store.test.ts`, `tests/reader-directory-delivery.test.ts`, `tests/reader-key-votes-delivery.test.ts`, `tests/reader-prl-delivery.test.ts`, `tests/social-platforms.test.ts`.

## Notes

- Portraits and Open States: rulings §3.
- The row count is large only because of group M; treat group M as one move.
