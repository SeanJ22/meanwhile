# Release 11 live check

- **Merged:** #717 at 14:56:58Z (10:56 AM EDT) as 0a0f744, tree identical to tested river 92102c8 (`pnpm gates` 12/12). river = main 0a0f744.
- **Deployed:** `/api/build` reports 0a0f744 (deploy 6ac50c3c3ab1e60008fc7613), read 11:00 AM EDT. Home page 200 in 0.59 s.
- **Post-deploy integrity:** run 37483242295 for 0a0f744 succeeded (reused; not dispatched).
- **Runner:** still stopped. cp_runner_heartbeat last beat 07:12:49Z on a5fd753; `to_regclass('cp_vital_signs')` is null, so v25 is not applied yet. Restart steps have been with Sean since 8:28 AM EDT; the handoff now installs 0a0f744.
- **Neon baseline, runner stopped:** control-plane data_transfer_bytes = 1,857,008,881,367 at 14:57Z (unchanged since 12:57Z).

| Step | State | Evidence |
|---|---|---|
| VS-01 Admin Now last full hours | Needs time, then Admin check | Needs cp_vital_signs (v25, applied by the restart bootstrap) and one recorded hour; then Sean's sign-in check (admin-checks.md). Before any hour the card keeps each number's sentence (BR-25 repair). |
| BX-13 hook | Needs time | Runner side: the first rounds after restart route lease-worker model requests by job. |
| CP-10 repair | Needs time | Runner side: next legislator portrait publication. |
| Campaign-site chain scope | Needs time | First round after restart: campaign-site pass finishes without "deferred: still waiting on". |
