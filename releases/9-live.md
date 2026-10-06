# Release 9 live check

- **Merged:** #715 at 10:35:12Z (6:35 AM EDT) as 8fdeb4e, a merge commit whose tree is identical to tested river 4fabb66 (`pnpm gates` 12/12: 9,872 tests, 9,861 pass, 0 fail, 11 skipped). river fast-forwarded to 8fdeb4e.
- **CI:** run 37448274594 green. The earlier run 37448256510 was cancelled by the concurrency rule (its admission job read `cancelled`, so build and gates refused to start).
- **Deployed:** `/api/build` reports 8fdeb4e (deploy 6ac4cee48800210008ee7638) at 10:37:30Z (6:37 AM EDT). **Post-deploy integrity:** run 37450769611 succeeded (reused by `river.mjs observe`, not dispatched).
- **Runner:** stopped since about 3:13 AM EDT (heartbeat last beat 07:12:49Z on a5fd753). Release 9 is adopted at the restart, and the restart waits on hunters' per-query byte counter. **No measured hour yet**, so release 9 is not done under Sean's release rule.
- **Schema:** release 9 has no schema change (still v24). River's v25 (cp_vital_signs) is READY on stream/river for the next release.

| Step | State | Evidence |
|---|---|---|
| FE-35 | Needs time | No published office address exists anywhere to pin (no office projection; 0 bodies with officeContact). The basemap cannot render here (api.maptiler.com is blocked). |
| FE-36 | Needs time | /api/public-records NOT_HELD with 0 records for Pima County, Tucson and New Hampshire; no public-records projection exists. |
| BX-08, BX-10 | Needs time | Repairs are deployed; snapshots are composed by the runner, which is stopped. |
| FE-40 | Needs time | 50 of 52 scripts are gone on 8fdeb4e. verify-visual-feedback-9-2.mts was kept on purpose; walk-r39.mts remains (registry to confirm). The look pass and resident tasks must run after the restart. |
| Runner-side steps (BX-03, BX-12, DB-32, DB-34, DB-37, DP-08, DB-45, DB-52, DP-13, DP-16, DP-17, FE-18, FE-21, FE-27; hunters' campaign-sites cause and isolation part 1) | Needs time | Adopted at the restart. |
| Admin steps (BR-31, FE-23, FE-24, FE-25, FE-26, FE-37) | Can't check | Sean's sign-in; admin-checks.md 18 and 137-141. |
