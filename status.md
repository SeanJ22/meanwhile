# River status

build_state: PRODUCTION STILL SERVES RELEASE 82; RELEASES 83 AND 84 FAILED TO DEPLOY ON NETLIFY (function over 250 MB); HOLDING EVERYTHING FOR DS-01 STEP-1 READY
worker: claude-river
provider: Claude
run_id: session_017bJhG9VbQvb1KubNxKCKjA
lock: session_017bJhG9VbQvb1KubNxKCKjA
heartbeat: 2026-10-23T04:58:35Z

## Cause found: releases 83 and 84 did not deploy (Oct 22, 7:03 PM Phoenix / 10:03 PM EDT)

- Sean read the Netlify build log: both deploys failed at upload with "The function exceeds the maximum size of 250 MB: Failed to upload file: grounded-ask". Release 83 brought SL-02's territory-XX.geojson files, which took data/states from 23.6 MB to 52.4 MB. netlify.toml line 38 (grounded-ask) and line 43 (reader-meetings) pack data/states/*/geo/**/*.geojson into those functions. Release 84 failed the same way because it sits on top of 83. Publishing is not locked and deploy 6ada90f6 is not pinned.
- Fix in flight: DS-01's step-1 READY keeps the territory files out of the function packages and out of data/derived/resolver-geometry.json. Until it lands River ships nothing (cal-01's CAL-02, gates stopped, waits behind it). Order: DS-01 step 1 first, alone or with cal-01; nothing ships without it.
- New rule for each release from here: do not call it live until https://meanwhileusa.com/api/build reports the new merge commit. Only then the runner, Vice President (AZ, TX, OH, CA and two random states) and Legistar-name checks. The Vice President and Legistar board names (releases 83 and 84) are therefore not verified live.
- The earlier line above ("What I cannot see: Netlify's deploy list") is answered by this; the post-deploy observer still passes without checking the served commit.

## Releases 83 and 84 are in main but not on the live site (Oct 22, 6:58 PM Phoenix / 9:58 PM EDT)

- https://meanwhileusa.com/api/build reports commit f44f9a18f (release 82), deployId 6ada90f662bf25a5c9dcf4c2, at 1:49 AM UTC and again at 1:55 AM UTC. Main is c88037bb9 (release 84). Release 83 (035a48044) merged at 00:13 UTC; release 84 (c88037bb9) at 01:08 UTC. Neither is being served, 105 and 50 minutes later. Earlier releases showed on the site within a few minutes.
- This is why the runner is still on f44f9a1: it follows the commit the site serves (lib/ops/runtime-release-handoff.ts), not main. So the Vice President (NE-01, release 83) and the Legistar board names (release 84) cannot appear, and nothing about them is verified.
- What I can see: GitHub shows the Build check, gates, admission and the post-deploy "observe" check green on 035a48044 and c88037bb9. The GitHub commit status for both is "pending" with no Netlify entry. What I cannot see: Netlify's deploy list and build log (no Netlify access from this session; the Netlify tool here only reads request analytics). The post-deploy observer passed for both while the site served the older commit, so it does not check that the new commit is the one being served.
- Needs Sean: open Netlify > Deploys for meanwhileusa.com and look at the builds for 035a48044 and c88037bb9 (failed? stuck queued? auto-publishing locked or a deploy pinned to 6ada90f6?). River's step after that: I hold release 85 (cal-01 CAL-02, gates running) from merging, so nothing more stacks up behind an undeployed commit and a failing build can be bisected between 82 and 83.

## Releases 83 and 84 shipped (Oct 22, 9:25 PM Phoenix / 12:25 AM EDT Oct 23)

- Release 83 (ds-01 NE-01, with SL-02 underneath it): PR #793, merged 035a48044 at 8:13 PM Phoenix; gates 8 of 8 (9,241 pass); observer green 8:23 PM. NE-01 is ds-01's answer to my Vice President return: the White House read never started because the people lane queued behind the meeting reads for memory; the fix starts it first in the next ordinary pass after a deploy.
- Release 84 (pm-01 R3-LEGISTAR-MEMBERS, board names): PR #794, merged c88037bb9 at 9:08 PM Phoenix; gates 8 of 8 (9,247 pass); observer green 9:18 PM. Boards outside the registry now get a verified, sourced name (Colorado Springs' council had 9 verified members and no name, so ZIP 80903 showed 0 bodies). 130 of 182 readable nameless production bodies get names on replay.
- Neither is verified on the live page yet: the runner (the part that reads White House and Legistar sources) was still on release 82 (f44f9a1) at 6:16 PM Phoenix, over an hour after release 83 deployed (earlier follows took 10 to 29 minutes). Vice President in AZ, TX, OH, CA state data: still 0 at 6:15 PM Phoenix. Checks run as soon as the runner is on release 83 or 84.
- cal-01: its first READY (6f7403b1b) failed the civic-data firewall (contract-handoff.ts writes a temp file); its second READY (1ac756930, clear release gates and unblock fresh fact delivery) clears the firewall but branched before releases 83 and 84 and conflicts with them in three files. I resolved it and passed 124 focused tests, but River cannot ship a hand-resolved merge for a lone lane, so cal-01 is asked to merge main and post a new READY (returns/cal-01.md has the five-point resolution).
- Runner at 5:56 PM Phoenix (routine pass on f44f9a1): 206 task failures, no Netlify Blobs error. Box built 6,217, not growing since release 82.

## Release 82 (AG-01) shipped (Oct 22, 3:55 PM Phoenix / 6:55 PM EDT)

- PR #792 merged f44f9a18f at 6:42 PM EDT (head 5864c4599, CI green, label run-full-ci); post-deploy observer green at 6:43 PM EDT. No migrations.
- What a reader sees now, checked on the live site: a place with no held calendar shows no "Checked ... ago" line. Seattle (98101) and El Paso (79901) pages have no Checked line (they said "Checked 20747 days ago" before). Flagstaff (86001) and Phoenix (85016) still show a real "Checked 20 days ago". The meetings API sends `snapshot: null` for those places: 38 of 40 sampled ZIPs across the country (none still carry a 1970 date). That also means 38 of 40 sampled places have no held calendar snapshot at all ("0 Meetings"), which is a data question for cal-01, not a display one.
- Runner after release 82: the runner follows the deploy in about 15 to 20 minutes; checks come next.
- Open: Vice President not on the live page (ds-01 return), meetings readback and calendar doors (cal-01 return), Legistar board names on the page (pm-01). No new READY on any lane at 6:55 PM EDT.

## Where things stand (Oct 22, 3:12 PM Phoenix / 6:12 PM EDT)

- Release 82 (AG-01 alone) is PR #792, head 5864c4599, label run-full-ci, CI running. River's `promote` could not move river to this tip (its recorded fold base had moved after the first promote; the later no-op fold also cleared fold.json), so the tested SHA was pushed to release/82 by hand on Sean's instruction. Gates passed 8 of 8 on that exact SHA (9,233 pass). River needs a restart-from-main step after this release; there is no command for it.
- Four hours on release 81 (be812ba), live state data for AZ, TX, OH and CA still has 0 Vice President. Not done. Returned to ds-01 (returns/ds-01.md, updated).
- Meetings readback: the child reader-readback:meetings-aggregate failed for 0 doors at 20:09, 20:35 and 21:01 UTC (10, 2 and 20 total task failures) and for 157 to 161 doors on either side of that. Moved to cal-01 as Sean asked (returns/cal-01.md has the pass-by-pass numbers; returns/pm-01.md now says PM-01 still owes Legistar board names on the page).
- Calendar doors with a new lastSuccessAt since release 81 deployed: NH 29, NJ 2, AZ 0, none elsewhere. Netlify Blobs error: 0 in 105 digests. Box built: 6,217 (+184 since 18:10 UTC). publish-now-supervisor still ends exit 2 (88 times).

## Where things stand (Oct 22, 2:58 PM EDT)

- Release 80 SHIPPED (PM-01's CK-01 alone): PR #790 merged 094c487db at 1:07 PM EDT, live 1:13 PM, observer green. The runner followed at about 1:34 PM EDT.
- Release 81 SHIPPED (DS-01's NE-01 and OR-01, PM-01's Legistar fix): PR #791 merged be812bacc at 2:07 PM EDT, observer green at 2:10 PM. The runner followed at about 2:20 PM EDT. Gates 8 of 8 (9,229 pass, 0 fail, 6 skipped), CI green. River fixes: both lanes touched lib/control-plane/gateway/registry.ts (kept both entries); OR-01 added data/reference/official-legislature-rosters.json without declaring it, so River wrote the provenance note data/reference/official-legislature-rosters.md and added the dataset to JSON_REFERENCE_DATASETS in tests/reference-data.test.ts.
- Release 82 (AG-01 alone: a place with no held calendar shows no "Checked" date instead of "20747 days ago") passed gates 8 of 8 (9,233 pass); River refused to release because main had gained release 81's merge commit, so the gates are re-running on the merged tip (the tree is byte-identical).
- NOT done: the Vice President is not on the live page. AZ, TX, OH and CA state data carry the President and 0 Vice President entries at 2:53 PM EDT, 33 minutes after the runner followed release 81. Returned to DS-01 (returns/ds-01.md). Legistar member names were not checked (the runner's meetings readback is failing, see below).

## Server checks after release 80 (Sean's four checks, 1:13 PM to 2:20 PM EDT)

1. Calendar doors with a new lastSuccessAt: AZ 1 (first at 1:54 PM EDT); NH 0 then 15 after release 81 (8 failures); NJ 0; none outside AZ, NH and NJ.
2. "Planning round" line newer than the release: only "3 states completed, 54 failed" (2:19 PM EDT). That round began 1:36 PM on release 80's code and was cut short when the runner moved to release 81 (ak took about 18 min, al about 20, ar about 4). A full 57-state round takes hours, so no round can finish between deploys; a "round finishes" check cannot pass while releases ship this often. This is a design question for Sean, not a lane return.
3. "not configured to use Netlify Blobs": gone. 0 of 25 digests after release 80, 0 of 19 after release 81.
4. Box built after the release: yes. 5,957 built at release 80, 6,049 at 2:50 PM EDT (+92). Rising.
- Still failing: publish-now-supervisor ends ROUTINE_CHILD_EXITED (exit 2) every pass; the routine supervisor's task failures went 135 (release 79 code) to 86 (release 80) to 156 (release 81). The receipt-count errors for meeting partitions (iCal, Clerk boards, schedule page) are gone. What remains: one child, reader-readback:meetings-aggregate (5-minute timeout for every meeting contract), "did not emit one exact result" for 59 then 141 doors. Returned to PM-01 (returns/pm-01.md).

## Live check after release 81 (2:10 to 2:55 PM EDT)

- /api/reader/state for AZ, TX, OH, CA: 200, 1.2 to 4.1 s (AZ 3.9 s and TX 4.1 s are the first reads after the deploy; over three seconds, open). President present, Vice President absent.
- Pages for ZIPs 85001, 85016, 75201, 43215, 94110: load; "Checked 20 days ago" still shows for places without a held calendar until release 82.
- Not yet run after 81: voting pins, ballot pages, two random states (waiting for the runner pass).

## Where things stand (Oct 22, 4:35 AM EDT)

- Release 79 SHIPPED: PR #789 merged f8e4670e4 (3:58 AM EDT), live 4:11 AM EDT. PM-01 (R3-LEGISTAR-MEMBERS, CK-01, SRC-MN, PM-01), CAL-01 (items 1 to 6, RH-01, and item 7's pause fix), DS-01, EX-02, PG-01. Gates 8 of 8 (9,209 pass), CI green. CAL-01's calendar fix (items 1 and 2) is now in main.
- Post-deploy integrity for 79: the observer's first reading REFUSED at 4:11 AM EDT (08:11:17Z), seconds after the deploy: contract migrations 0047_ck01_flag_target and 0049_r3_legistar_members_retire_index were not applied yet. Expand migrations applied at 4:09 AM; the runner applied the contract half at 4:30 AM EDT (digest db-migration:contract, f8e4670). Re-run at 4:31 AM: observer succeeded on attempt 3. Integrity is back to healthy. A release with contract migrations is refused by the observer for about 20 minutes after its deploy; the next release's gates are frozen until the passing re-check, so plan the next fold after it.
- River fixes in release 79: PM-01 vs CAL-01 clashes (dispatch-work.ts, publish.ts); the contradiction between PM-01's and CAL-01's tests is settled in PM-01's favour for now: CAL-01's reactivation (item 7, dispatch-work.ts) and its first test are left out, its pause fix stays (returns/cal-01.md has the exact contradiction for Sean or the lane); PM-01's saved-copy date bump reverted (CAL-01's test needs the copy left alone; nothing of PM-01's depends on it); migration references renumbered to 0049; River's rename had rewritten a READY subject in tests/river.test.ts (restored); pnpm install after the postgres dependency.
- DG-01 sent back (returns/dg-01.md): not one test clash. It deletes the Avondale-specific held-event code that CAL-01 item 4 builds on (HELD_EVENT_URL_PREFIXES, heldEventContract in scripts/freshness-shadow.mts and tests/legacy-activity-reads.test.ts) and conflicts with CAL-01 item 1's readStateCalendars in scripts/ingest.ts, plus tests/worker-fleet-standing.test.ts. Needs the lane to merge main and reconcile.
- Branch deletion: stream/tx-01 and stream/lk-01 (final, in main) cannot be deleted from this session; the proxy refuses it. Nothing else qualifies.

## Live check after release 79 (4:11 to 4:35 AM EDT)

- Voting at street addresses: Los Angeles 1,077 places and pins; Houston 697; Atlanta 40 (was 41); Milwaukee 1; New York 1; Lansing 14. None: Columbus, San Francisco, Lansing at 2500 S Washington Ave. 0.7 to 2.6 s.
- Ballot pages 94110 and 43215: 2.1 s and 1.2 s; 28 and 16 contests.
- Vice President in AZ, TX, NJ, OH, CA: still missing. AZ's first read after the deploy 3.4 s.
- Runner: 24 state cycles since midnight UTC, all SUCCEEDED, none FAILED, on releases 72 to 78.
- Alabama findings in the Box (subject starting al:), 4:15 AM EDT: built 970 (was 0 at 10:35 PM EDT), refused 27, waiting 15,698. Sean's Huntsville fix and the later releases are building findings.

## Live check after release 78 (2:07 to 2:15 AM EDT)

- Voting at street addresses: Los Angeles 1,077 places and pins; Houston 697; Atlanta 41; Milwaukee 1; New York 1; Lansing 14. None: Columbus, San Francisco, Lansing at 2500 S Washington Ave. 0.7 to 1.8 s.
- Ballot pages 94110 and 43215: 2.5 s and 1.7 s; 28 and 16 contests.
- Vice President in AZ, TX, NJ, OH, CA: still missing. AZ's first read after the deploy 3.6 s (over three seconds).
- Runner: 17 state cycles since midnight UTC, all SUCCEEDED, none FAILED, on releases 72 to 77.

## Live check after release 77 (10:30 to 10:40 PM EDT)

- Voting at street addresses: Los Angeles 1,077 places and 1,077 pins, Houston 697 and 697, Atlanta 41 and 41, Milwaukee 1 and 1, New York 1 and 1, Lansing 14 places (13 pins; before release 73 there were no pins anywhere). No places: Columbus, San Francisco, Lansing at 2500 S Washington Ave. Responses 0.7 to 3.3 s (first Los Angeles lookup after the deploy 3.3 s).
- Ballot pages 94110 and 43215: 1.8 s and 1.1 s; 28 and 16 contests (94110 was 18 before release 76; not traced).
- Vice President in AZ, TX, NJ, OH, CA: still missing, President only. Open.
- First reads after a deploy over three seconds: /api/reader/state 3.4 s (AZ) and 3.5 s (OH) after release 77. Open under the three-second rule.
- "Checked 20747 days ago" for places with no held meetings: still there; suggested task queued.

## Runner (cp_log_owner_digests, per state)

- Release 71: 9 states SUCCEEDED, 48 FAILED (IdentityCollision). Since DT-01's migration (5:58 PM EDT): 13 state cycles, 13 SUCCEEDED, 0 FAILED, on releases 72 to 76. DT-01_expand: 4404 debts given their state.
- Still not healthy: the fleet round digests say "3 states completed, 54 failed" (STATE_PLANNING_FAILED, no reason shown), and the routine civic data supervisor still ends FAILED every five minutes on release 75: RCD_MEETING_PARTITION_RECEIPT expected and not observed; PRL_ARCHIVE_S3_NOT_CONFIGURED; legistar-outcomes-ingest client missing; a database error (pl_exec.c). The "five-digit ZIP" line is gone.
- Alabama findings in the Box (cp_box_findings, subject starting al:, 10:35 PM EDT): built 0. Waiting 15,131: 11,063 with no reason recorded yet (not looked at), 3,095 TAKES_WHOLE_RECORDS_ONLY, 875 SUBJECT_HAS_NO_BODY_IN_THE_FACT_STORE, 98 NO_READER_FIELD. Of the 875, 644 end in #governing or #board (what Sean's fix lets through) and 231 are #body: committees (stay held). Across all states 423 built and 438 refused, newest finding recorded October 9; nothing built since. The publisher has not yet run on release 77's code; recheck after the runner's next box publication pass.

## Waiting on a new READY

- Nothing READY among the streams I scanned; none sent back.

## How River works

Per fold: claim the lock, fold the exact READY, merge main in, number migrations, run pnpm gates once, promote, release PR with run-full-ci, merge by hand when green, check /api/build, run the observer. Live before/after record with tools smoke.py (street addresses for voting checks; Google has no places for Houston, Columbus, New York, Orlando, Philadelphia, Seattle). Native auto-merge stays off. No automatic revert outside Sean's release process. Production database access is read-only.