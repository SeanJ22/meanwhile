# RB-A2 — fill the production place map

build_state: DB-03 inventory-readback removal be0b41a4f merged in runtime 944c3846b; combined full checks running without production credentials. Last passing runtime a41c494f1: 9/9 gates, 9,939 tests passed, zero failed, two skipped. River deployment needed before final live-data READY; production map tables remain empty.
worker: codex-rb-a2
provider: Codex
heartbeat: 2026-10-25T17:46:22.233Z
ready: none

The production-fill follow-up is active. Current runtime 944c3846b includes River be0b41a4f (DB-03 inventory-readback removal); all nine checks are running on that combination. The Census scheduling regression is retained; the adjacent retired repair test and obsolete repair-memory note are deleted. Last passing runtime a41c494f1 includes CL-01 and RB-A4 and passes all nine gates (9,941 registered, 9,939 passed, zero failed, two skipped), including both builds and all 16 bundle tests. The earlier launcher failure and correction remain in the measurement file. The implementation and live-proof handoff are published in draft PR #822 into River. No reader is switched.

- River: merge the current stream/rb-a2 candidate from draft PR #822 into river-next, check the combination and deploy it in its normal batch. Current runtime 944c3846b combines inventory-readback removal, CL-01 and RB-A4 with the loader. This deployment must precede the final data READY, whose production proof depends on the scheduled jobs running this code. The normal runner owns all production writes.
- RB-A2: observe those scheduled passes, then publish actual row counts for every state, completeness of all 42,883 postal ZIPs, elapsed load time, two production connections and meeting-read throughput. Final READY follows that production evidence.

The observer reads count aggregates and small metadata samples only. No Neon copy branches, new production copies or bulk copy replays. The seven RB-A2 copy/replay scripts and their local-copy helper remain deleted; the idle local PostgreSQL copy server is stopped. Full details and measured memory bounds: docs/rb-a2.md and docs/measurements/rb-a2/fill-baseline.json.
