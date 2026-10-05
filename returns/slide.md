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

## 2026-10-05 17:45Z: reader edge publication fails silently — SUPERSEDED by the 18:20Z entry below (wrong cause; do not build the site-match check)
Readers have been served the 2026-09-29T05:38Z snapshot (manifest seq 2979) ever since the runner moved to the Linux host. publishRoutineReaderEdge returns success when no store is configured (SKIPPED_NO_STORE, `lib/civic-data/reader-edge-publication.ts:88-89`) and when the store is another Netlify project (`lib/meetings/edge-store.ts:222-229` writes wherever NETLIFY_SITE_ID points). Fix: on a production runner, refuse a null store and a store that isn't the live site (explicit `WTP_LIVE_NETLIFY_SITE_ID`); treat NOT_COMPOSABLE as a failure; return the failure text and put it in the READER_EDGE_PUBLISH_FAILED detail (`scripts/routine-civic-data-runner.mts:1179-1181`, River assigns this to slide). Tests: production with a null store fails; production with a non-live site fails. Evidence: releases/stale-reader-snapshot.md.

## 2026-10-05 18:20Z: reader edge store, corrected (replaces the 17:45Z entry; reader harm, River-assigned)

The 17:45Z diagnosis was wrong. The site ID and token were the live site. The real cause: `/etc/meanwhile/runner.env` set `WTP_READER_EDGE_DIR`, and `resolveReaderArtifactWriteStore()` (`lib/meetings/edge-store.ts`) returns the local file store whenever that is set, before it checks NETLIFY_SITE_ID and the token. The runner logged PUBLISHED at sequences 113 to 117 into a folder on the droplet, while production stayed at 2979 for six days. Sean has fixed the host. Your job is to make sure it can't hide again. Drop the `WTP_LIVE_NETLIFY_SITE_ID` site-match idea from 17:45Z; it is not needed.

Build:
1. **Say which store was used.** Every reader-edge outcome the runner logs (the `readerEdge` JSON line and the supervisor result) names the store: `local folder` or `Netlify Blobs`, plus the sequence. Take the kind from `artifactStore.kind`.
2. **A local-folder publish on the production runner is a failure.** In the routine supervisor run (`scripts/routine-civic-data-runner.mts`), a reader-edge publish whose store is the local file store counts as a failure: push the `READER_EDGE_PUBLISH_FAILED` supervisor failure, with detail in plain English, e.g. "Reader pages were saved to a folder on the runner, not the live site. Readers are still seeing the older copy." Note: setup.ps1 sets `WTP_RUNTIME_MODE=staging` on the Linux host, so runtime mode can't be the signal. River's decision: the routine supervisor is production unless the explicit opt-in `WTP_READER_EDGE_LOCAL_OK=1` is set (for dev and the origin-path measurement). Don't change `resolveReaderArtifactStore()` (the reader's read path) or the local store used by tests.
3. **Visible in Admin.** Confirm that the supervisor failure reaches the Admin runner/health view through the existing digest path, in plain English, with the store name behind "Technical details". If the screen needs a change in an admin-owned file, put it under `needs_hook` and River routes it.
4. Keep the 17:45Z parts that still apply: production with no store (SKIPPED_NO_STORE) and NOT_COMPOSABLE are failures too, and the failure text goes into the supervisor detail (`scripts/routine-civic-data-runner.mts:1179-1181`).

Tests: a supervisor run with the local store and no opt-in reports READER_EDGE_PUBLISH_FAILED and names the local folder; with the opt-in it passes; a Netlify Blobs publish logs `Netlify Blobs` and passes; no store fails. Evidence: releases/stale-reader-snapshot.md.
