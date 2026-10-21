# River status

build_state: RELEASE 72 TESTING (six lanes: OF-01, AQ-03, BA-01, EX-01, RN-02, VS-04); HN-01 AND RS-03 SENT BACK
worker: claude-river
provider: Claude
run_id: session_017bJhG9VbQvb1KubNxKCKjA
lock: session_017bJhG9VbQvb1KubNxKCKjA
heartbeat: 2026-10-21T19:32:39Z

## Where things stand (Oct 21, 3:50 PM EDT)

- River session session_017bJhG9VbQvb1KubNxKCKjA took over at 3:32 PM EDT. Main is fc3b4a00b (release 71, live). Next release number: 72.
- Release 72 fold on river-next (River 84ab315f8 + OF-01 + AQ-03 + BA-01 + EX-01 + RN-02 + VS-04, then main merged in): pnpm gates running.
- Sent back from 72:
  - RS-03 53141653e: conflicts with OF-01 in lib/reader/national.ts (the US President read). OF-01 went first as Sean said. returns/rs-03.md.
  - HN-01 ad1c1b327: the first combined run failed preflight (civic-data-release-firewall: the closure of scripts/promote-registry-runtime.mts exceeds 512 files). Measured: River + main 508; HN-01 alone 512 (adds 4 files); EX-01 509; VS-04 509; the others 508. Every lane passes alone; with HN-01 the combination is 514. Without HN-01 it is 510. returns/hn-01.md.

## Waiting on a new READY

- DT-01, SL-01, VS-05: no stream/<lane> branch yet. BP-01 (stream/bp-01, 1213cd3c4) has no READY commit yet.

## Runner (read from cp_log_owner_digests, per state, at 3:45 PM EDT)

- Latest freshness cycle per state on release 71 (fc3b4a0): 9 SUCCEEDED, 48 FAILED (CYCLE_CRASHED). 47 of the 48 are the same error: IdentityCollision, a FreshnessDebt (candidate-enrichment) that "already holds a DIFFERENT value"; AZ's is a campaign-finance debt of the same kind.
- On release 70 (4ff13f9) cycles mostly succeeded (15 SUCCEEDED, 1 FAILED). On release 71 (fc3b4a0, since 7:02 AM EDT) 67 SUCCEEDED and 158 FAILED. Release 71 changed only voting files, so the collision is not in its code; the cause is open. lastCycleOk was true on release 70 and does not show this.
- Also in the digest: the routine civic data supervisor child exits 1 with "A five-digit ZIP is required."

## How River works

Per fold: claim the lock, fold the exact READY, merge main in, number migrations, run pnpm gates once, promote, release PR with run-full-ci, merge by hand when green, check /api/build, run the observer. Live before/after record with tools smoke.py (street addresses for voting checks; Google has no places for Houston, Columbus, New York, Orlando, Philadelphia, Seattle). Native auto-merge stays off. No automatic revert outside Sean's release process. Production database access is read-only.