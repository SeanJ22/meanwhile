# RB-A2 — fill the production place map

build_state: DB-03A 180160158 merged; combined full checks running without production database bindings. Deployment needed before final live-data READY. Direct production probes at 2026-10-25T10:03:50Z: place_boundary empty, zip_place empty, zcta_place empty.
worker: codex-rb-a2
provider: Codex
heartbeat: 2026-10-25T10:07:49Z
ready: none

The production-fill follow-up is active. Current runtime db8c81345 includes DB-03A 180160158; combined full checks are running. The prior runtime 6e9f3eb4d passes all nine gates (9,894 registered, 9,892 passed, zero failed, two skipped), including both builds and all 16 bundle tests. The implementation and live-proof handoff are published in draft PR #822 into River. No reader is switched.

- River: merge the current stream/rb-a2 candidate from draft PR #822 into river-next, check the combination and deploy it in its normal batch. Current runtime db8c81345 combines DB-03A with the previously checked loader. This deployment must precede the final data READY, whose production proof depends on the scheduled jobs running this code. The normal runner owns all production writes.
- RB-A2: observe those scheduled passes, then publish actual row counts for every state, completeness of all 42,883 postal ZIPs, elapsed load time, two production connections and meeting-read throughput. Final READY follows that production evidence.

The observer reads count aggregates and small metadata samples only. No Neon copy branches, new production copies or bulk copy replays. The seven copy/replay scripts and their local-copy helper have been removed; types and dead-code checks pass after deletion. Full details and measured memory bounds: docs/rb-a2.md and docs/measurements/rb-a2/fill-baseline.json.
