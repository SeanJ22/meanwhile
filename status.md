# River status

build_state: IDLE; RELEASES 57 TO 66 SHIPPED; RUNNER NOT BEATING; HOTFIXES DONE; NEXT RELEASE IS 67
worker: claude-river
provider: Claude
run_id: session_017TkpzScBJXCdKRAQCCg6M1
lock: claude-river-20261019T1652
heartbeat: 2026-10-20T22:50:23Z

## Where things stand (Oct 20, 12:30 PM EDT)

- Main and river are at ed0ac299c / 7dbad3bb5 (release 66, HF-02). Next release number: 67.
- No lock held. Nothing is being folded or tested.

## Needs Sean: the runner is not beating

The runner's last heartbeat is 14:24:50Z (10:24 AM EDT). Its last cycle failed with PERMANENT_RUNTIME_AUTHORITY_REFUSED (the research planner crash HF-02 fixes), it is on release 63 code, and no new cycle has started. No pause or stop order is recorded since Oct 17, so it was not stopped on purpose. HF-02 is deployed but cannot be confirmed working until the runner process runs again on the new code. River cannot start it. Until it runs: release 64's cleanup migration 0045 (delete the old state campaign facts) stays unapplied and production integrity reads DEGRADED.

## Shipped this run

- 57 UI-02, 58 RS-02 + BS-01, 59 SH-01, 60 RS-03 + SRC-MN step 1, 61 RS-03 division labels, 62 AQ-01 + UI-04 + VT-01, 63 CP-01, 64 SRC-MN step 2 (contract migration 0045 pending), 65 HF-01 (restored reader meetings after release 63), 66 HF-02 (research planner crash after release 63).
- Releases 63 broke reader meetings and the runner; both were fixed by hotfixes and the meetings fix is verified live.
- Not checked: Admin's Now page and Scoreboard (they need Sean's sign-in).

## Release record (Sean's process, from Oct 20)

Before each release and after its deploy, record: /api/meetings for 85701, 03301, 07960, 77002; whole-state and district /api/representation for AZ, NH, NY, TX; /api/ballot/scope for 85701 and 77002; /api/voting-sites for 85701, 07960 and one street address; one /api/ask question; Admin Now and Scoreboard; the runner heartbeat. Anything worse (error, fewer items, a filled value gone blank, slower by more than a second, runner stopped) is reverted at once and sent back. The script is tools/smoke.py in the River scratch directory; the records for release 66 are smoke-before-hf02.json and smoke-after-hf02*.json.
Release 66 after-record: 18 of 18 public checks the same or better once re-measured (the first record showed a connection failure, a slower geocoder and a cold Ask). Runner: unchanged, not beating, so not confirmed.
Standing note: the street-address voting lookup returns 503 ("temporarily unavailable") before and after every release; it is not caused by River.

## Returned lanes, waiting on a new READY

- UI-03 (stream/ui-03): five ballot-page tests fail. returns/ui-03.md.
- CK-01 (stream/ck-01): latest READY passes the earlier failures; assess again when folding. Overlaps lib/facts and lib/hunt with HN-01.
- TX-01 (stream/tx-01), MP-01 (stream/mp-01), HN-01 (stream/hn-01): READYs assessed clean alone; held until the lane-scope check and the runner are settled.
- RS-03 (stream/rs-03): returned for two tests (origins, path-separator). returns/rs-03.md.
- overlay-seats and site-reads stay returned by Sean's order.

## How River works now

- Order: hotfixes first, then CP-01-style blockers, then the rest in READY order. Fold READYs only from lanes that stay inside the files their prompt names, unless Sean approved a named exception (DG-01 in scripts/freshness-shadow.mts; VS-01 in automatic-refresh.ts, routine-civic-data-runner.mts and v6-settings-read.ts). A READY carrying another lane's unshipped commits goes back to be split.
- Per fold: claim the lock, fold the exact READY, merge main in, number migrations, run preflight, pnpm db:gate, a production pnpm build, then pnpm gates once, promote, open the release PR, add the run-full-ci label, merge by hand when every check is green with the expected head SHA, then check /api/build, call the reader routes on production, and re-run the post-deploy observer.
- The route trace for /api/voting-sites sits at 429 of 430 files; any lane that adds a file to it fails the build check. Re-baselining it is Sean's call.
- Native auto-merge stays off. A failing lane goes back with river.mjs return. Production database access is read-only. Contract migrations are applied by the production runner after the deploy, not by River.
- A fresh checkout needs pnpm install --frozen-lockfile before gates. River keeps remote river-next in step with a plain fast-forward (merge the remote branch in with -s ours); it never force-pushes.