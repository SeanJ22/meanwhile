# River status

build_state: IDLE; RELEASES 57–71 SHIPPED; WAITING ON VS-04 AND NEW READYS; NEXT RELEASE IS 72
worker: claude-river
provider: Claude
run_id: session_017bJhG9VbQvb1KubNxKCKjA
lock: session_017bJhG9VbQvb1KubNxKCKjA
heartbeat: 2026-10-21T19:32:39Z

## Where things stand (Oct 21, 6:40 AM EDT)

- Main is fc3b4a00b (release 71). River is 84ab315f8 and is inside main. Next release number: 72. No lock held.

## Shipped tonight

- Release 69: VS-02 alone (PR #779). Release 70: RN-01 alone (PR #780). Release 71: VS-02 repair with VS-03 (PR #781, map shows returned voting pins).
- All: local gates 8 of 8, hosted checks green, observer succeeded, live record 0 worse.
- Live voting: street addresses in Los Angeles (1,077), Atlanta (34), Lansing (14), Milwaukee (1) show places in under 1.2 s. Houston, Columbus, New York and San Francisco street addresses return NO_DATA from Google (no places) until held sources exist (VS-04).

## Waiting on a new READY

- VS-04 (stream/vs-04), returned READY 96c024781: build fails (meetings trace 434 over 430; 21 tests/ files traced via voting-source-publication.ts -> voting-source-evidence.ts). Details: returns/vs-04.md.
- EX-01 c26bc46c9 and HN-01 ad1c1b327 assessed clean earlier; BA-01 f86f5b07f and AQ-03 ff1638ac3 not yet assessed.
- overlay-seats and site-reads stay returned.

## Runner

Release 70 is running: first cycle on it (9:23 to 9:31 AM UTC) and second (10:24 to 10:36 AM UTC) finished with lastCycleOk true, testedSha 4ff13f9. fitLeaseWorkers is not in the heartbeat between cycles.

## How River works

Per fold: claim the lock, fold the exact READY, merge main in, number migrations, run pnpm gates once, promote, release PR with run-full-ci, merge by hand when green, check /api/build, run the observer. Live before/after record with tools smoke.py (street addresses for voting checks; Google has no places for Houston, Columbus, New York, Orlando, Philadelphia, Seattle). Native auto-merge stays off. No automatic revert outside Sean's release process. Production database access is read-only.