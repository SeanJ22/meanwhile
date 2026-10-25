# RB-A2 — fill the production place map

build_state: Code checked: 9/9 gates on runtime 29553f920 (MD-01 6d92e488c merged), 9,902 tests passed, zero failed, two skipped; both builds and 16 bundle tests pass. River deployment needed before final live-data READY. Production map tables remain empty.
worker: codex-rb-a2
provider: Codex
heartbeat: 2026-10-25T14:19:59.081Z
ready: none

The production-fill follow-up is active. Current runtime 29553f920 includes MD-01 6d92e488c and passes all nine gates (9,904 registered, 9,902 passed, zero failed, two skipped), including both builds and all 16 bundle tests. The private launcher's empty model-key environment was corrected without application changes; the failed attempt is preserved in the measurement file. The implementation and live-proof handoff are published in draft PR #822 into River. No reader is switched.

- River: merge the current stream/rb-a2 candidate from draft PR #822 into river-next, check the combination and deploy it in its normal batch. Current runtime 29553f920 combines MD-01 with the previously checked loader. This deployment must precede the final data READY, whose production proof depends on the scheduled jobs running this code. The normal runner owns all production writes.
- RB-A2: observe those scheduled passes, then publish actual row counts for every state, completeness of all 42,883 postal ZIPs, elapsed load time, two production connections and meeting-read throughput. Final READY follows that production evidence.

The observer reads count aggregates and small metadata samples only. No Neon copy branches, new production copies or bulk copy replays. The seven copy/replay scripts and their local-copy helper have been removed, the idle local PostgreSQL copy server is stopped, and all checks pass after deletion. Full details and measured memory bounds: docs/rb-a2.md and docs/measurements/rb-a2/fill-baseline.json.
