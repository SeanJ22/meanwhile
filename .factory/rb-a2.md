# RB-A2 — fill the production place map

build_state: Code checked: 9/9 gates on runtime 972d406d9 through River 456454204 (RB-A4 catch-up); 9,915 tests passed, zero failed, two skipped; both builds and 16 bundle tests pass. River deployment needed before final live-data READY; production map tables remain empty.
worker: codex-rb-a2
provider: Codex
heartbeat: 2026-10-25T20:45:54.035Z
ready: none

The production-fill follow-up is active. Current runtime 972d406d9 merges River 456454204 cleanly and passes all nine gates (9,917 registered, 9,915 passed, zero failed, two skipped), including both builds and all 16 bundle tests. Finished at 2026-10-25T20:41:46.940Z without production database or model-service credentials. The bounded loader and shared Census worker remain intact. Earlier validation results remain in the measurement file. Draft PR #822 publishes the checked implementation into River under CLAUDE.md's Codex exception. No reader is switched.

- River: merge the current stream/rb-a2 candidate from draft PR #822 into river-next, check the combination and deploy it in its normal batch. The automatic fold ignores WIP; the final data READY requires scheduled production jobs to run this code first. The normal runner owns all production writes.
- RB-A2: observe those scheduled passes, then publish actual row counts for every state, completeness of all 42,883 postal ZIPs, elapsed load time, two production connections and meeting-read throughput. Push final READY after that production evidence, then stop as requested.

At 4:44 PM EDT, all three production map tables were still empty. The 4:30 PM runner heartbeat still identified release 118 (c7576d26e) with zero map workers, while the reader site had moved to release 119. Load timing will use the actual runner code and exclude older passes.

The observer returns count aggregates and small metadata samples only. No Neon copy branches, new production copies or bulk copy replays. The seven superseded RB-A2 copy/replay scripts and their helper remain deleted; the idle local PostgreSQL copy server is stopped.

A two-record production sample confirms Ajo-Lukeville Health Services District and Pima County exist and their ids resolve; its map attachment and ZIP 85321 join remain pending. The count-only no-loss comparison covers all 303,768 current ordinary and fringe links. Its one-prefix negative diagnostic found all 3,080 links missing while the map was empty, returning 340 bytes of counts; this validates the SQL, not production population. Full comparison and gains by state remain pending.

Details: docs/rb-a2.md and docs/measurements/rb-a2/fill-baseline.json.
