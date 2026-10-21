# River status

build_state: RELEASE 72 SHIPPED AND LIVE (main 193846b52); RELEASE 73 PR #783 IN CI (VS-05, DT-01)
worker: claude-river
provider: Claude
run_id: session_017bJhG9VbQvb1KubNxKCKjA
lock: session_017bJhG9VbQvb1KubNxKCKjA
heartbeat: 2026-10-21T21:30:28Z

## Where things stand (Oct 21, 5:45 PM EDT)

- Release 72 SHIPPED: PR #782 merged as 193846b52 at 5:32 PM EDT, live at /api/build 5:34 PM EDT, post-deploy observer run 39679558965 succeeded. Lanes: OF-01, AQ-03, BA-01, EX-01, HN-01, RN-02, RS-03, VS-04. Gates 8 of 8 (9,076 pass, 0 fail); CI all green (admission, verify, both builds, 4 test shards, gates). The first CI run was cancelled by the concurrency rule when the run-full-ci label was added; the second run is the one that counted.
- Release 73: PR #783 https://github.com/SeanJ22/meanwhile/pull/783 (VS-05 fd1daab0a, DT-01 9017d2c16), river 7f96d0542. Gates 8 of 8 on 54c0327b9; merging main (release 72) into river-next added no content (same tree 37216b93d), so the result was recorded on the new head instead of rerunning the same tree. run-full-ci label added; merging by hand when green.
- River fixes in release 72: HN-01 closure limit 512 to 1024 (firewall.ts line 529, bound test moved with it); RS-03 one President read with OF-01's Vice President match; VS-03 map test server serves RS-03's ZIP shard and combined meetings answer. Rule from Sean: small problems are fixed by River and shipped.

## Live check after release 72 (5:35 to 5:45 PM EDT; before = release 71)

- Voting at street addresses: Los Angeles 1,077 places (before 0 at the two addresses I tried), Houston 697 (before 0), Atlanta 41, Milwaukee 1, New York 1 (same as before). Still no places: Lansing at 2500 S Washington Ave, Columbus, San Francisco (Google has no data; no held source yet). Pins on the map: 0 at every address, before and after: the places arrive with no latitude/longitude. VS-05 (release 73) pins from Google's own location.
- Ballot pages 94110 and 43215: load in 0.8 to 2.1 s, same contests as before (9 and 8 "Vote for" contests).
- Vice President in AZ, TX, NJ, OH, CA: still not shown (President only). OF-01's code is live and its production-copy check showed the Vice President in all 51 readers, so the live data does not hold the Vice President yet. OF-01 also changed the White House source parser (lib/sources/white-house/president.ts); the likely cause is that the held record is from before the parser change and the runner has not re-read that source. Not confirmed (production database reads are blocked for River).
- First reads after the deploy took 3.3 s (AZ) and 3.7 s (TX) for /api/reader/state; repeat reads 0.4 to 0.8 s. A cold first read over three seconds is a §6 failure; open.
- Reader copy: with no held meetings (for example 94110, 48933, 10001) the About this data line says "Checked 20747 days ago": the place snapshot falls back to the 1970 date (lib/reader/place.ts, same line in release 71). Existing defect, not from release 72.
- New for first-time visitors: a Quick tour dialog opens after entering a ZIP.

## Runner (cp_log_owner_digests, per state, 5:40 PM EDT)

- Latest freshness cycle per state is still on release 71 (fc3b4a0): 9 SUCCEEDED, 48 FAILED (IdentityCollision on a FreshnessDebt, 47 candidate-enrichment, AZ campaign-finance). The runner has not picked up release 72. DT-01 (release 73) stamps each saved debt with its state, which is the cause named in its migration, and is the expected fix. Checked again after release 73 deploys.
- Also in the digest: the routine civic data child exits 1 with "A five-digit ZIP is required."

## Waiting on a new READY

- BP-01 (stream/bp-01, tip 3f4f8023e): no READY commit yet. SL-01: no stream/sl-01 branch yet.
- Sent back: none. Superseded returns: hn-01, rs-03 (fixed by River in 72).

## How River works

Per fold: claim the lock, fold the exact READY, merge main in, number migrations, run pnpm gates once, promote, release PR with run-full-ci, merge by hand when green, check /api/build, run the observer. Live before/after record with tools smoke.py (street addresses for voting checks; Google has no places for Houston, Columbus, New York, Orlando, Philadelphia, Seattle). Native auto-merge stays off. No automatic revert outside Sean's release process. Production database access is read-only.