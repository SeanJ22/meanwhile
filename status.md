# River status

build_state: IDLE; RELEASES 72 AND 73 SHIPPED AND LIVE (main 2753ca92b); WAITING ON BP-01 AND SL-01 READY
worker: claude-river
provider: Claude
run_id: session_017bJhG9VbQvb1KubNxKCKjA
lock: session_017bJhG9VbQvb1KubNxKCKjA
heartbeat: 2026-10-21T23:13:58Z

## Where things stand (Oct 21, 6:05 PM EDT)

- Release 72 SHIPPED: PR #782 merged 193846b52 (5:32 PM EDT), live 5:34 PM, observer run 39679558965 succeeded. OF-01, AQ-03, BA-01, EX-01, HN-01, RN-02, RS-03, VS-04. Gates 8 of 8 (9,076 pass, 0 fail), CI all green.
- Release 73 SHIPPED: PR #783 merged 2753ca92b (5:59 PM EDT), live 6:01 PM, observer run 39682997384 succeeded. VS-05, DT-01. Gates 8 of 8 on 54c0327b9; merging main into river-next added no content (same tree 37216b93d), so the result was recorded on the new head instead of rerunning identical gates. CI all green on the second run (the first is cancelled each time the run-full-ci label is added).
- River fixes in release 72, under Sean's rule that small problems are fixed and shipped: HN-01 closure limit 512 to 1024 (firewall.ts line 529, bound test moved with it); RS-03 one President read with OF-01's Vice President match; VS-03 map test server serves RS-03's ZIP shard and combined meetings answer.
- 8 of 12 asked for in 72, then VS-05 and DT-01 in 73: 10 shipped, 0 sent back. BP-01 and SL-01 are not READY.

## Live check after release 73 (6:00 to 6:05 PM EDT)

- Voting at street addresses, with pins: Los Angeles 1,077 places, 1,077 pins in the browser; Houston 697 and 697; Atlanta 41 and 41 on the map; Lansing 14 places, 13 pins; Milwaukee and New York 1 and 1. Pins were 0 at every address on release 71 and 72; the places now arrive with coordinates (VS-05). Still no places: Columbus, San Francisco, and Lansing at 2500 S Washington Ave (no Google data).
- First Los Angeles lookup right after the deploy returned no places (GOOGLE_UNAVAILABLE, 3.1 s); the next three took 0.9 to 1.3 s with 1,077 places. A first-use failure after a deploy; open under the three-second rule.
- Ballot pages 94110 and 43215: 0.9 to 2.1 s, same contests (18 and 16 "Vote for" in the page source).
- Vice President in AZ, TX, NJ, OH, CA: still missing (President only). Open (see release 72 note: the held record is likely from before OF-01's White House parser change).
- Reader copy: "Checked 20747 days ago" still shows for places with no held meetings (1970 fallback in lib/reader/place.ts; same in 71). A suggested task is queued.

## Runner (cp_log_owner_digests)

- DT-01_expand applied to the control plane at 5:58 PM EDT: "4404 debt(s) given their state" (digest db-migration:expand, 2753ca9). Release 72's contract migration applied at 5:49 PM EDT.
- Per-state freshness cycles: the last ones ran on release 71 (fc3b4a0): 9 SUCCEEDED, 48 FAILED with IdentityCollision. No state cycle has run since the runner moved to release 72 at 5:49 PM EDT; the first after DT-01 is the test of the fix. Result written here when it lands.
- The routine civic data and publish-now supervisors still end with "A five-digit ZIP is required" every five minutes (on release 71 and 72).

## Waiting on a new READY

- BP-01 (stream/bp-01, tip 3f4f8023e): no READY commit yet. SL-01: no stream/sl-01 branch yet.
- Sent back: none. Superseded returns: hn-01, rs-03 (fixed by River in 72).

## How River works

Per fold: claim the lock, fold the exact READY, merge main in, number migrations, run pnpm gates once, promote, release PR with run-full-ci, merge by hand when green, check /api/build, run the observer. Live before/after record with tools smoke.py (street addresses for voting checks; Google has no places for Houston, Columbus, New York, Orlando, Philadelphia, Seattle). Native auto-merge stays off. No automatic revert outside Sean's release process. Production database access is read-only.