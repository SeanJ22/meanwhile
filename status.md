# River status

build_state: IDLE; RELEASES 57, 58, 59 AND 60 SHIPPED; WAITING ON NEW READYS; NEXT RELEASE IS 61
worker: claude-river
provider: Claude
run_id: session_017TkpzScBJXCdKRAQCCg6M1
lock: claude-river-20261019T1652
heartbeat: 2026-10-20T09:17:55Z

## Where things stand (Oct 20, 1:25 AM EDT)

- River is at 5307d8b75 (the tested release 60 commit). Main is at 9a159f69f (release 60). River contains main.
- Next release number: 61.
- No lock held. No fold, test or release PR in progress.

## Shipped this run

- Release 57: UI-02 alone. PR #766, main 2e4d86a2b.
- Release 58: RS-02 with BS-01. PR #767, main 9ab71524b. Migrations 0043 (expand) and 0044 (contract). The first observer reading refused because 0044 was not yet applied; the production runner applied it and the re-run read HELD, 45 of 45 migrations applied.
- Release 59: SH-01 alone. PR #769, main b5d9addcd. The production representation route returns 200 for NY, CA, TX, IL, WA, AZ and NJ.
- Release 60: RS-03 and SRC-MN step 1 (take incorrect campaign money off reader pages). PR #770, main 9a159f69f. The new /api/reader/places returns 200 and the old /api/warm is gone (404), as built.
- All four: local gates 8 of 8, hosted checks green, production serving the merged commit, post-deploy observer succeeded, production integrity CURRENT. Records: releases/57.json to releases/60.json.
- Not checked: the live pages for these releases as a reader sees them. First calls to the representation route took 2.5 to 4.2 seconds and warm calls 2.3 to 2.5 seconds, which is close to or over the three-second rule in §6. I could not identify the exact request that returned HTTP 500 before release 59, so that specific fix is not proven.

## Returned lanes, waiting on a new READY

Do not fold the returned commits again. Assess each replacement READY fresh.

- AQ-01 (stream/aq-01), returned READY da719a61e. It conflicts with River 5307d8b75 in one file, lib/ask/state-campaign.ts, which SRC-MN also edited. The earlier five failing tests (ASK-19 prompt vs validator, audit fiscal periods, recorded votes wording, adopted-budget publication, stopped-hedge cost) must pass on the merged tree. Details: returns/aq-01.md.
- CP-01 (stream/control-reads), returned READY 9293c19fb. One conflicting file against River 5307d8b75: tests/routine-civic-data-runner.test.ts (SRC-MN edited it too). Everything else merges and passes preflight. It carries a control-plane migration named CP-01 for River to number. Details: returns/control-reads.md.
- overlay-seats and site-reads stay returned by Sean's order. Details: returns/overlay-seats.md, returns/site-reads.md.

## Expected READYs (Sean, Oct 19)

SRC-MN second step (stream/src-money; the first step shipped), RH-01 (stream/runner-headroom, branch not created yet), and replacements for AQ-01 and CP-01.

## How River works now

- Order: SH-01 first if it is ready, then the rest in READY order. Ship whatever is ready; do not wait for all.
- Per fold: claim the lock, fold the exact READY, merge main in, number migrations, run preflight, run pnpm gates once, promote, open the release PR, add the run-full-ci label (hosted CI runs the full tests only with that label or with auto-merge on), merge by hand when every check is green with the expected head SHA, then check /api/build and re-run the post-deploy observer on the merged SHA.
- The release command refuses unless main is inside the tested river. After a release merges, main gains a merge commit, so the next fold must merge main in before its single gates run. Fold ready lanes together so that one run covers the new combination.
- Native auto-merge stays off. A failing lane goes back with river.mjs return. No automatic revert. Production database access is read-only. Contract migrations are applied by the production runner after the deploy is serving, not by River.
- A fresh checkout needs pnpm install --frozen-lockfile before gates; without it lint, tsc and the browser assert fail for the wrong reason.
- River keeps remote river-next in step with a plain fast-forward (merge the remote branch in with -s ours); it never force-pushes.