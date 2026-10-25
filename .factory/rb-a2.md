# RB-A2 — fill the production place map

build_state: Code checked: 9/9 gates on runtime 944c3846b, through River be0b41a4f (DB-03 inventory-readback removal); 9,912 tests passed, zero failed, two skipped; both builds and 16 bundle tests pass. River deployment needed before final live-data READY; production map tables remain empty.
worker: codex-rb-a2
provider: Codex
heartbeat: 2026-10-25T19:37:01.568Z
ready: none

The production-fill follow-up is active. Current runtime 944c3846b includes River be0b41a4f (DB-03 inventory-readback removal) and passes all nine gates (9,914 registered, 9,912 passed, zero failed, two skipped), including both builds and all 16 bundle tests. Finished at 2026-10-25T18:19:47.925Z without production database or model-service credentials. The Census scheduling regression is retained; the adjacent retired repair test and obsolete repair-memory note are deleted. Earlier validation results remain in the measurement file. The implementation and live-proof handoff are published in draft PR #822 into River. No reader is switched.

- River: merge the current stream/rb-a2 candidate from draft PR #822 into river-next, check the combination and deploy it in its normal batch. Current runtime 944c3846b combines inventory-readback removal, CL-01 and RB-A4 with the loader. This deployment must precede the final data READY, whose production proof depends on the scheduled jobs running this code. The normal runner owns all production writes.
- RB-A2: observe those scheduled passes, then publish actual row counts for every state, completeness of all 42,883 postal ZIPs, elapsed load time, two production connections and meeting-read throughput. Final READY follows that production evidence.

The observer reads count aggregates and small metadata samples only. No Neon copy branches, new production copies or bulk copy replays. The seven RB-A2 copy/replay scripts and their local-copy helper remain deleted; the idle local PostgreSQL copy server is stopped. Full details and measured memory bounds: docs/rb-a2.md and docs/measurements/rb-a2/fill-baseline.json.

At 2:59 PM EDT, all three production map tables were still empty. The 2:51 PM runner observation confirms release 118 (`c7576d26e`) and zero map workers. RT-01's queued `a13baecf8` also changes the provider frontier, but retains the old loader memory reservation; it does not replace this lane's bounded loader and shared Census worker. The prepared meeting comparison returns two aggregate rows for equal windows before and during the actual load.

A read-only two-record production sample at 3:34 PM EDT confirms Ajo-Lukeville Health Services District and Pima County exist and both ids resolve. The final proof targets that exact district id; its map attachment and ZIP 85321 join remain pending production population. No geometry, source payload or reader text was returned.
