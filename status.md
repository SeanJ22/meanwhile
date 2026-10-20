# River status

build_state: IDLE; RELEASES 57 AND 58 SHIPPED; WAITING ON NEW READYS; NEXT RELEASE IS 59
worker: claude-river
provider: Claude
run_id: session_017TkpzScBJXCdKRAQCCg6M1
lock: claude-river-20261019T1652
heartbeat: 2026-10-20T03:48:33Z

## Where things stand (Oct 19, 11:37 PM EDT)

- River is at 011443fad (the tested release 58 commit). Main is at f7db190d6: release 58 (9ab71524b) plus Sean's rulings change (PR #768, §9 donor rule, docs/rulings.md only). River does not contain f7db190d6 yet. The next combination must merge main in, then run full gates once.
- Next release number: 59.
- No lock held. No fold, test or release PR in progress.

## Shipped

- Release 57: UI-02 alone. PR #766 merged to main as 2e4d86a2b. Local gates 8 of 8, hosted checks green, production served it, post-deploy observer succeeded.
- Release 58: RS-02 with BS-01. PR #767 merged to main as 9ab71524b. Local gates 8 of 8, hosted checks green, production served it. Migrations 0043_rs01_place_reads (expand) and 0044_rs01_retire_copies (contract). The first observer reading refused because 0044 was not applied yet; the production runner applied it, the observer was re-run, and it read HELD with 45 of 45 migrations applied. Production integrity is CURRENT.
- Not checked: the live pages for releases 57 and 58. What readers see is unverified.
- Records: releases/57.json and releases/58.json.

## Returned lanes, waiting on a new READY

Do not fold the returned commits again. Assess each replacement READY fresh.

- SH-01 (stream/sh-01), returned READY aef4b03dc. Preflight failed: it adds lib/officials/chamber-directory.ts to the registered import closure of scripts/promote-registry-runtime.mts, which sits at the 512-file limit. The lane must fold that file into an existing module or drop an import edge, and must not raise the limit. Live ZIPs outside AZ, NH and NJ return HTTP 500 until a fixed SH-01 ships. Fold it first and ship it alone if nothing else is ready. Details: returns/sh-01.md.
- AQ-01 (stream/aq-01), returned READY 6e24f7c44. Four tests that pass on River fail on the candidate, and a fifth fails in the full run: ASK-19 prompt vs validator numbers, audit fiscal periods, the member's recorded votes wording, the adopted-budget publication, and the stopped-hedge cost test. Details: returns/aq-01.md.
- CP-01 (stream/control-reads), returned READY e01f266bb. It does not contain River 011443fad and conflicts in 12 files. Details: returns/control-reads.md.
- overlay-seats and site-reads stay returned by Sean's order. Details: returns/overlay-seats.md, returns/site-reads.md.

## Expected READYs (Sean, Oct 19)

SH-01, AQ-01, CP-01, SRC-MN (two steps, stream/src-money), RH-01 (stream/runner-headroom) and RS-03 (stream/rs-03). The last two branches do not exist yet. When SRC-MN lands, check what readers and Ask would show for individual donors against rulings §9 ($200 or less never named).

## How River works now

- Order: SH-01 first and alone if it is the only one ready, then the rest in READY order. Ship whatever is ready; do not wait for all.
- Per fold: claim the lock, fold the exact READY, merge main in, number migrations, run preflight, run pnpm gates once, promote, open the release PR, add the run-full-ci label (hosted CI runs the full tests only with that label or with auto-merge on), merge by hand when every check is green with the expected head SHA, then check /api/build and re-run the post-deploy observer on the merged SHA.
- Native auto-merge stays off. A failing lane goes back with river.mjs return. No automatic revert. Production database access is read-only. Contract migrations are applied by the production runner after the deploy is serving, not by River.
- A fresh checkout needs pnpm install --frozen-lockfile before gates; without it lint, tsc and the browser assert fail for the wrong reason.
- River keeps remote river-next in step with a plain fast-forward (merge the remote branch in with -s ours); it never force-pushes.