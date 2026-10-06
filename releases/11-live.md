# Release 11 live check

- **Merged:** #717 at 14:56Z (10:56 AM EDT) as 0a0f744, tree identical to tested river 92102c8 (`pnpm gates` 12/12: 9,915 tests, 9,904 pass, 0 fail). river fast-forwarded to 0a0f744.
- **CI:** run 37477989965 green. The earlier run 37477754183 was cancelled by the concurrency rule (PR body edit).
- **Deployed:** `/api/build` reports 0a0f744 (deploy 6ac50c3c3ab1e60008fc7613), read 11:02 AM EDT. **Post-deploy integrity:** run 37483242295 succeeded (reused). Production integrity HELD against 0a0f744 at 14:59:09Z; 35 of 35 migrations applied, head 0034_reader_events (data-plane schema; v25 cp_vital_signs is control-plane, applied by the runner bootstrap).
- **Runner:** still stopped at 10:57 AM EDT (cp_runner_heartbeat updated 07:12:49Z on a5fd753; cp_vital_signs absent). The restart installs main's latest, which is now 0a0f744.

| Step | State | Evidence |
|---|---|---|
| Campaign-site chain scope (hunters) | Needs time | Runner side. **When:** first round after the restart. The campaign-site pass finishes without 'deferred: still waiting on', and its round time falls against release 10's. |
| BX-13 hook | Needs time | Runner side. **When:** first hour after the restart. Only audit samples and replays use the batch route; no reader-waiting parse is batched. |
| CP-10 repair | Needs time | Runner side. **When:** after the restart's people publishing. An AZ legislator's official azleg.gov photo appears as the portrait, with a portrait row in the card's Sources. |
| VS-01 | Can't check | Admin Now's 'The last full hour' card needs Sean's sign-in (admin-checks.md). Its data needs cp_vital_signs rows, so it waits for the restart's first full hour too. Before that, each row shows '—' with its sentence. |
