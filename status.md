# River status

build_state: IDLE; RELEASES 72, 73, 74, 75 SHIPPED AND LIVE (main ba5263fbe); ALL 12 REQUESTED LANES SHIPPED, NONE SENT BACK; NEXT RELEASE IS 76
worker: claude-river
provider: Claude
run_id: session_017bJhG9VbQvb1KubNxKCKjA
lock: session_017bJhG9VbQvb1KubNxKCKjA
heartbeat: 2026-10-22T02:03:56Z

## Where things stand (Oct 21, 8:15 PM EDT)

- All 12 lanes shipped, none sent back. Release 72 (193846b52, live 5:34 PM): OF-01, AQ-03, BA-01, EX-01, HN-01, RN-02, RS-03, VS-04. Release 73 (2753ca92b, live 6:01 PM): VS-05, DT-01. Release 74 (0ed86e72a, live 7:04 PM): SL-01. Release 75 (ba5263fbe, live 8:07 PM): BP-01. Each: gates 8 of 8 on the exact tested tree, CI green on the PR, observer run succeeded.
- River fixes, under Sean's rule (small problems are fixed and shipped): HN-01 closure limit 512 to 1024 (firewall.ts line 529) with its bound test; RS-03 one President read with OF-01's Vice President match; VS-03 map test server serves RS-03's ZIP shard and combined meetings answer; BP-01 two tests (tests/routine-due-request.test.ts pins the launch-order line BP-01 wrapped in ballotPublicationLaunchOrder; tests/ballot-publication.test.ts passed runBoundedChildPass options without the required env).
- Methods: a release's gates run while the previous PR is in CI; when merging main in changes no content (same tree hash) the gate result is recorded on the new head instead of rerunning. The run-full-ci label added after the PR opens cancels the first CI run; the second run counts.

## Live check after release 75 (8:07 to 8:15 PM EDT)

- Voting at street addresses: Los Angeles 1,077 places and 1,077 pins; Houston 697 and 697; Atlanta 41 and 41; Milwaukee 1 and 1; New York 1 and 1; Lansing 14 and 13 (the browser map shows the pins, checked by screenshot at Atlanta). No places: Columbus, San Francisco, and Lansing at 2500 S Washington Ave (no Google data, no held source). Responses 0.7 to 2.1 s. Before release 72: no pins anywhere.
- Ballot pages 94110 and 43215: 2.0 s and 0.9 s, 18 and 16 contests, same as before.
- Vice President in AZ, TX, NJ, OH, CA: still missing in all five; President only. OF-01's code is live and OF-01's production-copy check showed the Vice President; the live held data does not. Likely cause: the held White House record predates OF-01's parser change and the runner has not re-read it. Not confirmed (production database reads are blocked for River). Open.
- First read after a deploy over three seconds: /api/reader/state 3.3 s (AZ, TX) after release 72, 3.0 s (AZ) and 3.5 s (CA) after 74, 5.0 s (AZ) after 75; repeats are 0.4 to 2 s. The first Los Angeles lookup after release 73 returned no places in 3.1 s. Cold first reads fail the three-second rule; open, owner not assigned.
- "Checked 20747 days ago" shows for places with no held meetings (1970 fallback in lib/reader/place.ts, same in release 71). A suggested task is queued.

## Runner (cp_log_owner_digests, per state)

- Release 71: 9 states SUCCEEDED, 48 FAILED (IdentityCollision on a FreshnessDebt).
- DT-01_expand applied to the control plane at 5:58 PM EDT: "4404 debt(s) given their state". Since then (10:15 PM UTC on) the per-state records are 5 SUCCEEDED and 0 FAILED, on releases 72 to 74. No IdentityCollision since.
- Not healthy yet: each round still reports "Planning round: 3 states completed, 54 failed" (STATE_PLANNING_FAILED, release 73, 7:15 PM EDT) with no reason in the digest, and only about five states have a cycle in two hours. The runner moves to release 75 after this deploy; the next round is the test of BP-01 and SL-01 (both change the routine runner). The routine civic data and publish-now supervisors still end with "A five-digit ZIP is required" on release 72 and 73. Open.

## Waiting on a new READY

- Nothing. No stream is READY and unintegrated among the 12; none sent back.

## How River works

Per fold: claim the lock, fold the exact READY, merge main in, number migrations, run pnpm gates once, promote, release PR with run-full-ci, merge by hand when green, check /api/build, run the observer. Live before/after record with tools smoke.py (street addresses for voting checks; Google has no places for Houston, Columbus, New York, Orlando, Philadelphia, Seattle). Native auto-merge stays off. No automatic revert outside Sean's release process. Production database access is read-only.