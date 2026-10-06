# Release 12 live check

- **Merged:** #718 at 16:32Z (12:32 PM EDT) as c814d4c, tree identical to tested river 405a7f6 (`pnpm gates` 12/12: 9,921 tests, 9,910 pass, 0 fail). river fast-forwarded to c814d4c.
- **CI:** run 37490899697 green (admission, verify, both builds, affected tests, gates). The earlier run 37490860810 was cancelled by the concurrency rule when the PR body edit started the second run (explained on the PR).
- **Deployed:** `/api/build` reports c814d4c at 16:35:11Z (12:35 PM EDT). **Post-deploy integrity:** run 37496564929 succeeded (reused).
- **Runner:** still stopped (last beat 07:12:49Z on a5fd753; cp_vital_signs absent). The restart now installs c814d4c.

| Step | State | Evidence |
|---|---|---|
| CH-22 | Needs time | Runner side, journal lines named in the ledger. |
| DP-06 | Can't check (Sean's sign-in) | Admin Stuck list; needs a current owner snapshot from the runner. |
