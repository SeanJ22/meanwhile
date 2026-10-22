# River status

build_state: RELEASES 72 TO 79 SHIPPED AND LIVE (main f8e4670e4); DG-01 SENT BACK; WAITING ON NEW READYS
worker: claude-river
provider: Claude
run_id: session_017bJhG9VbQvb1KubNxKCKjA
lock: session_017bJhG9VbQvb1KubNxKCKjA
heartbeat: 2026-10-22T17:07:51Z

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