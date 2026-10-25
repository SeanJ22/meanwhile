# RB-A2 — fill the production place map

build_state: Code checked: 9/9 gates on runtime a41c494f1, through River e84d06c43 (CL-01 and RB-A4); 9,939 tests passed, zero failed, two skipped; both builds and 16 bundle tests pass. River deployment needed before final live-data READY; production map tables remain empty.
worker: codex-rb-a2
provider: Codex
heartbeat: 2026-10-25T15:26:20.231Z
ready: none

The production-fill follow-up is active. Current runtime a41c494f1 includes River e84d06c43 (CL-01 and RB-A4) and passes all nine gates (9,941 registered, 9,939 passed, zero failed, two skipped), including both builds and all 16 bundle tests. The run finished at 2026-10-25T15:22:15.402Z without production database or model-service credentials. The private launcher's earlier empty model-key environment failure and correction are preserved in the measurement file. The implementation and live-proof handoff are published in draft PR #822 into River. No reader is switched.

- River: merge the current stream/rb-a2 candidate from draft PR #822 into river-next, check the combination and deploy it in its normal batch. Current runtime a41c494f1 combines CL-01 and RB-A4 with the loader. This deployment must precede the final data READY, whose production proof depends on the scheduled jobs running this code. The normal runner owns all production writes.
- RB-A2: observe those scheduled passes, then publish actual row counts for every state, completeness of all 42,883 postal ZIPs, elapsed load time, two production connections and meeting-read throughput. Final READY follows that production evidence.

The observer reads count aggregates and small metadata samples only. No Neon copy branches, new production copies or bulk copy replays. The seven RB-A2 copy/replay scripts and their local-copy helper remain deleted; the idle local PostgreSQL copy server is stopped. Full details and measured memory bounds: docs/rb-a2.md and docs/measurements/rb-a2/fill-baseline.json.
