# RB-A2 — fill the production place map

build_state: All nine gates pass on the RV-BOX d62ca66ce combination. Deployment needed before final live-data READY. Production map: 0 of 56 jurisdictions as of 2026-10-25T07:13:47Z.
worker: codex-rb-a2
provider: Codex
heartbeat: 2026-10-25T07:14:34Z
ready: none

The production-fill follow-up is active. Merged runtime 008d674f4 includes RV-BOX d62ca66ce and RV-MEET2 c02e4bf30; all nine gates pass (9,893 registered, 9,891 passed, zero failed, two skipped), including both builds and all 16 bundle tests. The checked implementation and live-proof handoff are published in draft PR #822 into River. No reader is switched.

- River: fold and deploy the checked loader candidate so the existing scheduled place-map jobs can run. The normal runner owns all production writes.
- RB-A2: observe those scheduled passes, then publish actual row counts for every state, completeness of all 42,883 postal ZIPs, elapsed load time, two production connections and meeting-read throughput. Final READY follows that production evidence.

The observer reads count aggregates and small metadata samples only. No Neon copy branches, new production copies or bulk copy replays. The seven copy/replay scripts and their local-copy helper have been removed; types and dead-code checks pass after deletion. Full details and measured memory bounds: docs/rb-a2.md and docs/measurements/rb-a2/fill-baseline.json.
