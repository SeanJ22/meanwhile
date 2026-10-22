# River status

build_state: RELEASE 78 SHIPPED AND LIVE (main a84c70057); RELEASE 79 TESTING (PM-01, CAL-01 items 4 to 6, DS-01, EX-02, PG-01); DG-01 HELD
worker: claude-river
provider: Claude
run_id: session_017bJhG9VbQvb1KubNxKCKjA
lock: session_017bJhG9VbQvb1KubNxKCKjA
heartbeat: 2026-10-22T06:15:47Z

## Where things stand (Oct 22, 2:15 AM EDT)

- Standing order from Sean (15-minute scan, all night): fold every READY, gates on the combination, release PR, merge by hand, live check, status.md. Branch deletion only for a lane's final READY with its tip in main (TX-01 and LK-01 confirmed final).
- Release 78 SHIPPED: PR #788 merged a84c70057, live 2:07 AM EDT, observer run 39731763611 succeeded. TX-01 and LK-01. Gates 8 of 8 (9,123 pass), CI green. River fix: tests/admin-narrow-reads.test.ts pulse section list now includes "national" (LK-01 makes the country section readable from the snapshot alone and changed the same list in admin-capability-pulse; the duplicate assertion was stale).
- Branch deletion: stream/tx-01 and stream/lk-01 are in main and final but could not be deleted from this session: the GitHub API and git push --delete are refused by the session proxy ("Write access to this GitHub API path is not permitted through this proxy"). Needs Sean or a session with that access.
- Release 79 in gates: PM-01 (R3-LEGISTAR-MEMBERS, CK-01, SRC-MN, PM-01), CAL-01 (items 4 to 6 plus RH-01), DS-01, EX-02 (06761fca1), PG-01 (77afd872a, now merges PM-01). River fixes so far: CAL-01 vs PM-01 clash in lib/control-plane/expansion/dispatch-work.ts (both reopen conditions kept) and lib/facts/publish.ts (PM-01's confirm behaviour kept, CAL-01's restamp kept for its page-refresh path, unused no-receipt branch removed); PM-01's second migration numbered 0049 and the three references PG-01 still had as 0048 corrected; River's rename had rewritten the READY subject in tests/river.test.ts (restored); pnpm install after PM-01's postgres dependency. The earlier PG-01 hold (returns/pg-01.md) is cleared by the lane's new READY.
- DG-01: held until CAL-01's items 1 and 2 are in main.

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