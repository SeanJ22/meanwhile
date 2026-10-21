# River status

build_state: RELEASE 72 TESTING (all eight: OF-01, AQ-03, BA-01, EX-01, HN-01, RN-02, RS-03, VS-04, with two River fixes)
worker: claude-river
provider: Claude
run_id: session_017bJhG9VbQvb1KubNxKCKjA
lock: session_017bJhG9VbQvb1KubNxKCKjA
heartbeat: 2026-10-21T20:51:12Z

## Where things stand (Oct 21, 3:50 PM EDT)

- River session session_017bJhG9VbQvb1KubNxKCKjA took over at 3:32 PM EDT. Main is fc3b4a00b (release 71, live). Next release number: 72.
- Release 72 fold on river-next: River 84ab315f8 + OF-01, AQ-03, BA-01, EX-01, HN-01, RN-02, VS-04, main merged in, then RS-03, then the limit fix. pnpm gates running.
- New rule from Sean (3:55 PM EDT): a small problem in a READY is fixed by River and shipped, not sent back. Small = two lanes clash in one file, a limit that only counts files or size, a flaky test, a missing merge. Only real failures go back (the lane's own code is wrong, or readers would see something worse).
- River fixed, in release 72:
  - HN-01: lib/civic-data/firewall.ts EXECUTABLE_CLOSURE_NODE_LIMIT 512 to 1024 (line 529). The limit only counts files; HN-01, EX-01 and VS-04 each pass at 512 alone and reach 514 together. tests/civic-data-firewall.test.ts "executable closure permits its exact bound" moved with it (1023 chained modules pass, the next is rejected); 20 of 20 pass.
  - RS-03: conflict with OF-01 in lib/reader/national.ts (the President read). Kept one read: RS-03's `residentPresident` with the optional caller-supplied store and `nationalPresidentPointers()`, exported through `readNationalPresident(store?)`, with OF-01's Vice President match in `currentPresidentRoster` and its comment kept. The older River return text for RS-03 named the two sides the wrong way round; no repair is needed from the lane.
  - RS-03 with VS-03: the first full run of the eight lanes passed 7 of 8 gates (lint, tsc, build, db:gate, firewall, preflight, browser assertion); the one failing test was tests/map-entry-voting-browser.test.ts (VS-03). Alone on River + main: passes. With RS-03 added: fails. With OF-01, VS-04 or HN-01 added: passes. Cause: RS-03 reads ZIP locations from /geo/reader-zips/<prefix>.json and takes the state answer inside /api/meetings?include=state, and the VS-03 test server still served /api/location/zip and a separate state answer, so the map never focused. RS-03's branch never contained VS-03's test (it predates release 71). Fixed the test server to serve what the page now reads; the page code is unchanged. Test passes. Gates rerun on the whole candidate.
  - returns/hn-01.md and returns/rs-03.md are superseded by these fixes.

## Waiting on a new READY

- DT-01, SL-01, VS-05: no stream/<lane> branch yet. BP-01 (stream/bp-01, 1213cd3c4) has no READY commit yet.

## Runner (read from cp_log_owner_digests, per state, at 3:45 PM EDT)

- Latest freshness cycle per state on release 71 (fc3b4a0): 9 SUCCEEDED, 48 FAILED (CYCLE_CRASHED). 47 of the 48 are the same error: IdentityCollision, a FreshnessDebt (candidate-enrichment) that "already holds a DIFFERENT value"; AZ's is a campaign-finance debt of the same kind.
- On release 70 (4ff13f9) cycles mostly succeeded (15 SUCCEEDED, 1 FAILED). On release 71 (fc3b4a0, since 7:02 AM EDT) 67 SUCCEEDED and 158 FAILED. Release 71 changed only voting files, so the collision is not in its code; the cause is open. lastCycleOk was true on release 70 and does not show this.
- Also in the digest: the routine civic data supervisor child exits 1 with "A five-digit ZIP is required."

## How River works

Per fold: claim the lock, fold the exact READY, merge main in, number migrations, run pnpm gates once, promote, release PR with run-full-ci, merge by hand when green, check /api/build, run the observer. Live before/after record with tools smoke.py (street addresses for voting checks; Google has no places for Houston, Columbus, New York, Orlando, Philadelphia, Seattle). Native auto-merge stays off. No automatic revert outside Sean's release process. Production database access is read-only.