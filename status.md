# River status

build_state: IDLE; RELEASES 57–70 SHIPPED; VOTING WAITS ON VS-02's TEST FIX; NEXT RELEASE IS 71
worker: claude-river
provider: Claude
run_id: session_017TkpzScBJXCdKRAQCCg6M1
lock: claude-river-20261019T1652
heartbeat: 2026-10-21T09:52:55Z

## Where things stand (Oct 21, 5:25 AM EDT)

- Main is 4ff13f97e (release 70, RN-01). River is 578092f44 and is inside main.
- Next release number: 71. No lock held.

## Shipped tonight

- Release 69: VS-02 alone (PR #779, main 4a5a04e). Request-only Google voting-place fallback.
- Release 70: RN-01 alone (PR #780, main 4ff13f9). The runner startup fix. Live check: 0 worse, 31 same.
- Both: local gates 8 of 8, hosted checks green, observer succeeded.

## Blocking every release: one flaky VS-02 test

tests/voting-sites-live.test.ts, "an empty held answer gets live Google locations…", line 29 has a 50 ms margin and fails in full runs under load (5 of 6 full runs). Returned to VS-02 (returns/vs-02.md). Fold its new READY first.

## Waiting on a new READY

- VS-04 (stream/vs-04), returned READY 96c024781: the build fails. Meetings route trace 434 files (ceiling 430) and 21 tests/ files traced, because voting-source-publication.ts now imports voting-source-evidence.ts (PDF text and OCR). Details: returns/vs-04.md.
- VS-03 (stream/vs-03, READY e06c2cc56) is ready: its two earlier test failures are fixed, it builds alone (trace 421), and the full run on it shows only VS-02's flaky test failing. It ships as soon as VS-02's fix lands, or when Sean says to fold it with that one failure.
- EX-01 c26bc46c9 and HN-01 ad1c1b327 were assessed clean earlier; BA-01 f86f5b07f and AQ-03 ff1638ac3 are new and not yet assessed.
- overlay-seats and site-reads stay returned.

## Runner

Release 70 deployed at about 4:20 AM EDT. The first two cycles on the new code have not finished yet; a check-in is set for 4:57 AM EDT.

## How River works

Per fold: claim the lock, fold the exact READY, merge main in, number migrations, run pnpm gates once, promote, release PR with run-full-ci, merge by hand when green, check /api/build, run the observer. Live before/after record with tools smoke.py (street addresses for voting checks; Google has no places for Houston, Columbus, New York, Orlando, Philadelphia, Seattle). Native auto-merge stays off. No automatic revert outside Sean's release process. Production database access is read-only.