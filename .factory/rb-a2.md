# RB-A2 — fill the production place map

build_state: Checking the combination with River ea117a0bb (portraits and member offices); all nine gates are being rerun. Previous runtime 972d406d9 passed 9/9 with 9,915 tests passed, zero failed, two skipped. Production deployment and final live-data READY remain pending; the map is empty.
worker: codex-rb-a2
provider: Codex
heartbeat: 2026-10-25T21:36:57.550Z
ready: none

Merged tested River ea117a0bb cleanly, including the portrait and member-office read reductions. The shared Census lane, per-state acquisition turns, 1 GiB map heap and 1,672 MiB reservation remain intact. Full validation is being rerun on this new combination; the completed 972d406d9 result is not a pass for this new combination.

The previous full run finished at 2026-10-25T20:41:46.940Z: all nine gates passed; 9,917 registered tests, 9,915 passed, zero failed, two skipped; both builds and all 16 bundle tests passed. Production database and model-service credentials are removed from gate runs. Earlier results remain in the measurement file. Draft PR #822 publishes the implementation under CLAUDE.md's Codex exception. No reader is switched.

- River: integrate the candidate from draft PR #822 into river-next, check the combination and deploy in its normal batch. Automatic folding ignores WIP; final data READY needs the scheduled production jobs to run the code first. The normal runner owns production writes.
- RB-A2: observe scheduled passes, then publish every-state row counts, all 42,883 postal ZIPs, elapsed load time, two production connections and meeting-read throughput. Push final READY after that evidence, then stop as requested.

At 5:34 PM EDT, all three production map tables were empty. The 5:29 PM runner heartbeat identified release 119 (f6f68db6b) and zero map workers. Load timing will use actual runner code, excluding older passes.

Verification returns counts and small metadata samples only. No new production copies, Neon copy branches or bulk copy replays. The seven superseded RB-A2 copy/replay scripts and their helper remain deleted; the idle local PostgreSQL copy server is stopped.

The final queries include map-year counts for every state. Two public entity samples confirm the government and county ids for the county-attachment proof; the map join remains pending. The prepared no-loss comparison covers 303,768 current ordinary and fringe links, returning only missing counts and gains by state. Its one-prefix negative diagnostic found all 3,080 links missing in the empty map and returned 340 bytes of counts; it is not a completed map proof.

Details: docs/rb-a2.md and docs/measurements/rb-a2/fill-baseline.json.
