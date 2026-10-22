# River status

build_state: IDLE; RELEASES 72 TO 77 SHIPPED AND LIVE (main 41ef7e9ce); NEXT RELEASE IS 78
worker: claude-river
provider: Claude
run_id: session_017bJhG9VbQvb1KubNxKCKjA
lock: session_017bJhG9VbQvb1KubNxKCKjA
heartbeat: 2026-10-22T02:03:56Z

## Where things stand (Oct 21, 10:40 PM EDT)

- Shipped and live: release 72 (193846b52): OF-01, AQ-03, BA-01, EX-01, HN-01, RN-02, RS-03, VS-04. 73 (2753ca92b): VS-05, DT-01. 74 (0ed86e72a): SL-01. 75 (ba5263fbe): BP-01. 76 (a46269dfb): SL-01 second READY cecee0bde. 77 (41ef7e9ce, live 10:30 PM EDT): Sean's one-line fix to SL-01 in lib/facts/box-publication.ts (line 213 in the merged tree; line 198 in his note) plus its test. Each: gates 8 of 8 on the exact tested tree, CI green on the PR, observer run succeeded. None sent back.
- Correction: the note at 8:15 PM EDT that no stream was READY was wrong; SL-01 had a second READY (cecee0bde, 7:38 PM EDT) that I had not rescanned for. Folded as release 76.
- Release 77: when Sean's message arrived PR 786 (release 76) had already merged. The same fix shipped as release 77. After SL-01 makes a missing council (id under the city's place), the second lookup used the subject with its #governing or #board ending and found nothing; now it drops the ending. Test: al:city:city-of-huntsville#governing makes one council and is built; a #body: committee finding does not land on it. It failed before the fix and passes after.
- River fixes under Sean's rule: HN-01 closure limit 512 to 1024; RS-03 one President read with OF-01's Vice President match; VS-03 map test server; BP-01 two tests. Sandbox note: after the 12:20 AM UTC restart tsc and next build run out of memory at the default 2.2 GB Node heap on any tree (including the live one); River runs the gates with NODE_OPTIONS=--max-old-space-size=6144. CI runners are not affected.

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