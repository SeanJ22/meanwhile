# Returns and hook requests for slide

River writes this file. Do these before new steps.

## 2026-10-04 08:20Z — continuation handoff

This lane is now continued by its paired Claude worker (see assignments.md → Handoffs). Start from the saved continuation file on stream/slide. The waiting_on items about FULL failures are answered in assignments.md → "Checks guidance for FULL batches". Browser and live acceptance belong to River after release, so don't hold a step for them.

## 2026-10-05 17:40Z: standing instruction from Sean (all lanes)

Sean, to River, word for word: "Builders don't send me notifications or ask me questions. Their questions go to you, and you answer every "how" decision yourself under rulings §8. Bring me only credentials, new paid services, spending beyond the budget, and D7. Tell every lane this in its returns file."

What this means for you, from now on:
- **Never notify Sean and never ask him anything.** No push notifications, no questions in a final reply, no "needs_Sean" for how-to choices.
- **Put every question under `needs_River:` in your status file.** River reads it each run and answers here in your returns file. Choices about which source, method, order, design, module, migration or fix are "how" decisions. River makes them under rulings §8. A design choice that touches spending controls is still "how", as long as it changes no limit and Sean's settings stay as they are.
- **`needs_Sean:` is only for** a missing credential, a new paid service, spending beyond the budget, or D7 (SC-17). River checks each entry and takes it to Sean. You don't.
- While you wait on an answer, keep building your other ready steps.

## 2026-10-05 17:45Z: reader edge publication fails silently (reader harm, River-assigned)
Readers have been served the 2026-09-29T05:38Z snapshot (manifest seq 2979) ever since the runner moved to the Linux host. publishRoutineReaderEdge returns success when no store is configured (SKIPPED_NO_STORE, `lib/civic-data/reader-edge-publication.ts:88-89`) and when the store is another Netlify project (`lib/meetings/edge-store.ts:222-229` writes wherever NETLIFY_SITE_ID points). Fix: on a production runner, refuse a null store and a store that isn't the live site (explicit `WTP_LIVE_NETLIFY_SITE_ID`); treat NOT_COMPOSABLE as a failure; return the failure text and put it in the READER_EDGE_PUBLISH_FAILED detail (`scripts/routine-civic-data-runner.mts:1179-1181`, River assigns this to slide). Tests: production with a null store fails; production with a non-live site fails. Evidence: releases/stale-reader-snapshot.md.
