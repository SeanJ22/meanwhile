# River status

build_state: IDLE; RELEASES 57 TO 68 SHIPPED; WAITING ON NEW READYS; NEXT RELEASE IS 69
worker: claude-river
provider: Claude
run_id: session_017TkpzScBJXCdKRAQCCg6M1
lock: claude-river-20261019T1652
heartbeat: 2026-10-21T09:30:57Z

## Where things stand (Oct 20, 11:20 PM EDT)

- Main is 4c4f7f8fd (release 68, VS-01); river is f328cd2f2, the tested commit it came from. Next release: 69.
- No lock held. Nothing is being folded or tested.
- Runner: beating (last beat about a minute old), on release 67 code (4880f3102), verdict CONSISTENT. Its cycle still fails: freshness:shadow crashes at startup with OPERATIONAL_REFERENCE_READ_NOT_INITIALIZED (the pointer read times out), lastCycleOk is false and fitLeaseWorkers is 0. RN-01 (the fix) is returned, below. Release 64's cleanup migration 0045 is still unapplied and production integrity reads DEGRADED until a cycle finishes.

## Shipped this run

57 UI-02; 58 RS-02 + BS-01; 59 SH-01; 60 RS-03 + SRC-MN step 1; 61 RS-03 labels; 62 AQ-01 + UI-04 + VT-01; 63 CP-01; 64 SRC-MN step 2 (contract migration 0045 pending); 65 HF-01 (restored reader meetings broken by 63); 66 HF-02 (runner crash from 63); 67 MP-01 + UI-03 + OT-01; 68 VS-01 (the street-address voting lookup went from 503 to 168 sites).
Every release: all 8 local gates, hosted checks green, deploy confirmed, post-deploy observer run, live before/after record. Not recorded: Admin Now and Scoreboard (they need Sean's sign-in).

## Returned lanes, waiting on a new READY

- RN-01 (runner startup crash, READY 36ea1a1b5a): three tests fail alone (hunter-isolation heartbeat fields, runner-release-wake sandbox missing runtimeContracts, startup-read-retry call moved). returns/rn-01.md. Next release, alone.
- BA-01 (7e54e6ac5c): five failures: AZ and Pima contests lost at 85701, wrong-state contests, three capture scripts launch browsers outside the shared site, google_api_key strings in committed evidence pages, Arizona measure count 16 vs 15. returns/ba-01.md. Sean approved shipping it as a release.
- EX-01 (ad84ab3d7b): scripts/measure-translation-cost-check.mts touches the owner's paid-research switch. returns/ex-01.md. BA-01 and EX-01 ship together once both pass.
- AQ-03 (b0bffe3c50): two Ask tests fail. returns/aq-03.md.
- SRC-MN (6dc11bf851): conflicts with AQ-03 in the Ask route and with UI-03 in the ballot page. returns/src-money.md.
- HN-01 (011f5abab1): one import-block conflict with MP-01, now in main. returns/hn-01.md.
- RS-03, UI-03 (shipped in 67), CK-01, TX-01, LK-01, DG-01: held or returned; fold only when told or when a newer READY lands.
- overlay-seats and site-reads stay returned by Sean's order.

## How River works now

- Fold only READYs whose changes stay inside the files their prompt names, unless Sean approved a named exception (DG-01 in scripts/freshness-shadow.mts; VS-01 in automatic-refresh.ts, routine-civic-data-runner.mts and v6-settings-read.ts). A READY carrying another lane's unshipped commits goes back.
- Per release: record the live site before (meetings for 85701, 03301, 07960, 77002; representation state and district for AZ, NH, NY, TX; ballot scope and ballot page for 77002, 43215, 94102, ballot scope 85701; voting sites for 85701, 07960 and a street address; one Ask question; the runner heartbeat). Then claim the lock, fold, merge main, number migrations, preflight, db:gate, a production build, pnpm gates once, promote, open the PR, add run-full-ci, merge by hand when green, wait for the deploy, record again, run the observer. Revert at once if anything is worse.
- Native auto-merge stays off. A failing lane goes back with river.mjs return. Production database access is read-only. The /api/voting-sites route trace sits at 421 of 430 files since VS-01.
- A fresh checkout needs pnpm install --frozen-lockfile. River keeps remote river-next in step with a plain fast-forward (merge the remote branch in with -s ours).