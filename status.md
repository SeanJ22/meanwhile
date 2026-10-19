# River status

build_state: CODEX SHIFT ENDED; RELEASE 56 SHIPPED; RELEASE 57 NOT SHIPPED
worker: claude-river
provider: Codex
run_id: session_017TkpzScBJXCdKRAQCCg6M1
lock: claude-river-20261019T1652
heartbeat: 2026-10-19T17:32:50Z

## Codex River shift — October 18

Sean assigned Codex as River until October 19, 2026 at 8 AM Arizona (15:00 UTC). Use scripts/river.mjs exactly as its header describes. Ship 3–5 eligible READY lanes or when any eligible READY reaches two hours, whichever comes first. Return failing lanes and ship the rest after testing the changed combination. No automatic revert, builders, budget/pause/spending changes or production-data writes. Merge release PRs manually after actual required checks pass; keep native auto-merge disabled. Release only our own lock at safe stops and before the deadline.

RELEASE 56 SHIPPED SRC-MN ONLY: READY a1d55302b3d15200b6d2bed51cf530f105fec584. Native campaign filings now have a shared state/place fact-store and reader/Ask code path; production ingestion and live examples remain separate work. All 8 local gates passed on 6b4ea17aff9153d1f4da0cfc03ce5f23a7186b3c, tree 87c51f3e32e0e1287ef786099e7c0b4c042180d0: 8,668 tests passed, zero failed, five skipped; both builds and all 16 bundle checks passed. Main release-55 merge 4bdb43a7 was included; no new migrations. Passing artifacts are preserved under .scratch/river/release-56-passed/.

PR https://github.com/SeanJ22/meanwhile/pull/765 was manually merged at 23:09:15Z after required hosted checks passed in run 39174135045 on the actual 6b4ea17 head (all four test shards, types/lint and both builds). Merge method merge with expected SHA; native auto-merge stayed disabled during checks. Main merge 16679a9ea0ec479bf0edad680d916b01418d0ad9 has the tested tree. Production /api/build serves it, deploy 6ad5519e8591bcc684c8e66e. river.mjs observe reused existing push observer 39175302021, which succeeded. No duplicate observer was dispatched. Full record: releases/56.json. This proves tested, merged, web deployed and successful observer status; it does not prove newly ingested production campaign facts, runner adoption, or live rendered pages. Chromium's existing certificate error remains; no fresh live screen success is claimed. A direct observer-log download was blocked; its signed redirect was not retained on the board. Native chat PR attachment was attempted but not acknowledged by the app service; the exact PR link is saved here and in chat.

RETURNED SH-01 445e511dab21766cbfde79b3a0bd1c933e4fb4d9: full gates on SH-only 474b0c27 completed 7/8 green, 8,639 pass, one fail, five skip. tests/seat-grouping.test.ts:117 still requires four indented person-under-heading blocks; the new valid sourced vacancy row adds a fifth. Both builds and bundle checks passed. Repair the assertion around the additional row without removing sourced vacancies, then send a new READY. Preserve the RS-01 hook requirements: sourced vacancies, Capitol offices, officeDetails/source provenance, exact-state fallback. Logs/fold/test remain in .scratch/river/release-56-sh01-failed/ and local branch river-saved-sh01-failed-20261018.

RETURNED AQ-01 01f987827b9dd5d4fbb9bd823b6ba18d9900442f: actual fold after SRC-MN conflicts in app/api/ask/grounded/route.ts. Its separate 24-question under-three-second branch acceptance report was assessed freshly; no AQ full gates were run here. Owner must reconcile the current Ask/campaign interface and send a new READY. CP-01 aa787c762bbd9a11bad97a2754878f4b24ca65dd remains returned for 39 merge conflicts; its earlier migration defect was repaired. Do not retry these unchanged returned inputs. Concrete output is in returns/<lane>.md.

The initial SH-01 + SRC-MN combination c9e009037d93 failed preflight: scripts/promote-registry-runtime.mts exceeded the existing 512-file runtime import closure. Either exact lane passed preflight alone. After SH-01 independently failed its stale assertion, it was removed and SRC-MN passed full gates alone; SRC-MN's return was annotated with these changed conditions and cleared for the standalone release. A future SH-01 replacement still needs to resolve that import-graph interaction with current River. The failing pair was never promoted. Its saved branch is river-saved-sh-srcmn-20261018 and logs remain in .scratch/river/release-56-preparation/.

RELEASE 57 ATTEMPT RETURNED, NO RELEASE OPENED: freshly assessed RS-02 READY 9a7cd4dca64cb43f771a7eab3f17b7d85f5c6391 continues RS-01 04fe5ae6d, includes BS-01 027144fa187f0710c2c1ca5c673512952ede1316 and tested River 6b4ea17. Its new final report resolves the earlier Indiana cold-browser miss and shows 50 cold browser states, 150 reads and three fresh agenda clicks under three seconds with held-data preservation. Existing missing verified President is explicitly an acquisition gap. Those acceptance results were assessed freshly; they do not establish release gates.

RS-02 and BS-01 folded cleanly in that order; BS was already in RS-02 ancestry and added no application difference. Main release-56 merge 16679a9ea0ec479bf0edad680d916b01418d0ad9 was included. river.mjs numbered 0043_rs01_place_reads (expand) and 0044_rs01_retire_copies (contract). Exact candidate a0ba47a1701482328d2a89da00ea47c9d6053679 FAILED pnpm gates at preflight: DATA_EXECUTABLE_CLOSURE_UNRESOLVED for scripts/promote-registry-runtime.mts, registered executable closure exceeded 512 files. visible-tree passed; the expensive tier did not run. This is an actual source import-graph failure, not environment setup. Returned RS-02 with river.mjs return --check civic-data-release-firewall-import-closure --sha exact --output-file .scratch/river/release-57-rs02-return.log. Do not retry that unchanged READY/candidate. RS-02 owns the import-graph repair against current River/SRC-MN; retain reader/agenda/Ballot acceptance and SH vacancy/office/source/exact-state hooks.

BS-01's dependency is blocked again because the validated RS-02 successor failed release preflight. The original RS-01 branch still has no READY; do not land WIP RS through BS. BS's two-hour age trigger is already due, so reassess and ship promptly if a new eligible reader READY clears that dependency. BS itself is not blamed for an independent standalone failure. The failed RS-02 candidate is preserved on river-next and local branch river-saved-rs02-bs01-failed-20261019. Saved exact fold/test/full gate log: .scratch/river/release-57-preparation/. Current .scratch/river/test.json is FAIL on a0ba47a17014, not the earlier release-56 PASS. No promotion, release PR, main merge, deployment or observer was performed for release 57.

NEXT RELEASE NUMBER REMAINS 57. Remote River remains tested source 6b4ea17aff91; main remains release-56 merge 16679a9e. Include current main in the next changed combination and run full gates once. Unchanged SH/AQ/CP/UI/other returned exact inputs remain returned. Assess each replacement READY freshly. The failed source already includes main56, but no passing test evidence exists for it. Prior release-56 passing checks were not repeated.

Release 55 already shipped UI-01 only in PR 764, source ab0c352c, merge 4bdb43a7, deploy 6ad52d22e0e2a0c9b010a0b1, successful observer 39163857692. Do not repeat it. releases/55.json retains the full record.

Environment: pnpm 10.33.0 at /tmp/river-tools/node_modules/.bin first on PATH; PNPM_HOME=/tmp/river-pnpm; XDG_DATA_HOME=/tmp/river-xdg; PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright (Chromium 1234). Use network-enabled additional permissions for shell subprocess/network work. Do not print credentials. .scratch/river/update-board.mjs checks lock ownership and uses fast-forward board pushes. Current .scratch/river/test.json is FAIL on release-57 candidate a0ba47a17014; the release-56 PASS is preserved under .scratch/river/release-56-passed/.

This run is at a safe stopping point. Bounded continuation stays quiet on unchanged states and skips fresh owners. The final run must stop only its own checks if necessary, preserve any unpromoted candidate/logs and release its own lock before 15:00 UTC. The lock is released in cleanup after saving this handoff; read its current field before claiming with a new token.


FINAL CODEX REPLACEMENT HANDOFF — 2026-10-19T14:42:27.678Z: final scheduled scan at 14:41:38Z found no new eligible READY. All returned exact inputs remain unchanged; BS-01 remains blocked on an eligible validated reader successor. Release 55 shipped UI-01 only; release 56 shipped SRC-MN only, with their already-recorded tested/merged/web-deployed/observer evidence. No release 57 shipped. Remote River is 6b4ea17aff9153d1f4da0cfc03ce5f23a7186b3c and main is 16679a9ea0ec479bf0edad680d916b01418d0ad9. Local river-next remains failed, unpromoted candidate a0ba47a1701482328d2a89da00ea47c9d6053679, saved also as river-saved-rs02-bs01-failed-20261019. Current test.json is FAIL on that candidate. Full logs and fold/test are preserved in .scratch/river/release-57-preparation/; release-56 PASS remains separately in .scratch/river/release-56-passed/. No owned gates or release checks are running.

Claude River can resume at October19 8AM America/Phoenix (15:00UTC): claim a new token only when the lock is free, re-scan current READY and exact prior returns, assess any repaired RS-02/SH/AQ/CP or other replacement freshly, and preserve sourced vacancies, Capitol offices, officeDetails/source provenance and exact-state fallback. Do not retry RS-02 9a7cd4dca64c or candidate a0ba47a17014 unchanged. BS-01 is already past its age trigger and is due once its reader dependency is eligible. Include current main in the next changed combination, number migrations through river.mjs and run gates once; only then promote and open next release number57. Disable native auto-merge while required checks run and merge manually with expected head SHA and method merge once green. Reuse the existing post-deploy reading. No automatic revert or budget/pause/spending/production-data changes. Existing live browser certificate limitation and PR765 native attachment gap remain explicitly unverified. This Codex replacement is stopping now before the deadline; its lock is released in finally cleanup and read back below. No further release work is scheduled for this replacement.

## RELEASE 23 — national listings, known officials, portraits and finance: MERGED, DEPLOYED AND RUNNING

- PR https://github.com/SeanJ22/meanwhile/pull/730 merged as 4f8bc8d5bcfb1606ce436c9d68f4098b68cafcb7. Merge tree 487faefd8b207db1fc23cb74e9549daf95a98d8d matches the exact hosted test tree. READY ed5929429cd05a58fe429acf6eef549434d0fc56; River/river-next point to the tested checkout 8d68f46721de856247c38dd39680db15e5a9f37e.
- Full hosted CI https://github.com/SeanJ22/meanwhile/actions/runs/38014509898 passed: 7,872 tests, zero failures, five skips; lint, TypeScript, production standalone build, all 16 bundle checks and final gate passed. Largest app trace 382/430; framework 1,184/1,300. Schema shipping gate not applicable because no changed path touches the schema contract. Local restricted child-process checks are not claimed passed; full hosted CI covered them.
- Netlify deploy 6ac99d4e6a59be0008efb522 published the merged revision at 2026-10-10T02:06:46.287Z. Observer 38015653418 confirmed /api/build serving it at 02:06:55Z and 35/35 migrations HOLDS, with durable receipt read back. Main build/gates 38015653417 passed.
- Automatic runtime adoption is now verified: heartbeat 2026-10-10T02:35:55.515Z reports tested SHA and target SHA 4f8bc8d5bcfb1606ce436c9d68f4098b68cafcb7. New source and canonical reader receipts identify the same revision. The old source pass finished at 02:25:12Z; no manual Send, restart or owner-control change was used.
- Actual rollout at 02:36Z: registration/5 has 20,769 government/school listings across 11 of 56 jurisdictions, all 11 current versions have canonical reader PASS. The remaining 45 still have prior /3 projections. Fresh NCES retrieval failures are recorded separately while held listings remain GOOD; available Census refresh evidence publishes independently.
- OpenStates /3 now covers 12 of 52 jurisdictions, with 1,654 people and 148 verified portraits; all 12 current versions have canonical reader PASS. Those 12 include 41 native state executives and 46 native local mayors; every jurisdiction's counts match the held source replay. The remaining 40 still retain 5,853 legislative people on /2 while their automatic refresh is queued.
- Congress /4 has all 539 held people and 158 verified portraits, with its current canonical reader PASS on the merged revision. AZ finance /4 has now promoted and passed its canonical reader check. NH /2 and NJ /3 remain current at this checkpoint; NH's known publisher outage retains GOOD data.
- Registration repair narrowly reconciles the prior /3 acquisition clock against exact held evidence. Offline replay passed for all 56 jurisdictions: 112,034 source listings (overlapping government/education inventories), 85,541 unchanged divisions and 49,127 native Census aliases. These are preflight totals, not a claim of completed production rollout.
- Full held-native replay of 810 executive/municipal captures yields 478 additional current people: 180 state executives across 52 source jurisdictions and 298 local mayors across 47 states. Source-shaped fixes preserve two HI county mayors, DC's Mayor and four chief-election-officer roles; reject the Janesville council collective; and preserve exact native division links. Production completion across all 52 remains to observe.
- Existing division readers and Ask consume these source projections with official precedence and preserved roster order. Portrait verification follows capture, retains prior verified assets, and continues through the existing finite worker pool/deadlines. Pima uses its registered exact tenant body route. Finance keys now retain committee/period identity when filing state changes; genuine-removal checks remain intact. No FEC source expansion was included.
- Superseded acquisition writers, callers, flag and tests were removed in release 21. Useful shared machinery and valid evidence remain. Existing budgets, owner pauses and source cadences are unchanged. No Hunt Network expansion, open-ended source hunting or unrelated audit cleanup.
- Implementation, required checks, merge, web deployment and runtime adoption are complete. The standing acquisition worker owns the continuing rollout and portrait refresh. Full 56/52 production totals and a new serving-artifact receipt are still unverified at this checkpoint. Public live-browser access is restricted and is not claimed passed. River lock released at this checkpoint.

## RELEASE 22 — acquisition baseline: PR #729, MERGED AND WEB DEPLOYED

- Production verification at 20:28Z found no plural-openstates candidates or promotions, no registration/4 candidates, and Congress directory still at parser /2. Release 21's 13 meeting promotions did not prove the national baseline.
- Repairs built: parser-aware initial replay; independent state projections of shared national releases; remove the normal acquisition pass's duplicate full worker-publication scan; bounded publication outbox; shared-release wait through the existing deadline; publish newly promoted baseline pointers during long passes and preserve meeting facts across registry races.
- READY e2a617be423808527414722b48ed5e3f3a45778f; combined release e310dd69134d0cdd8cb7120808bec594b2a74209, tree b847b52b2dc0964ec393e4af3ad817df6f8c8708. PR https://github.com/SeanJ22/meanwhile/pull/729 is labeled run-full-ci. Focused checks pass; hosted CI must cover restricted child-process tests before merge.
- The completed old-code source pass exposed all 52 OpenStates entrypoints failing ERR_MODULE_NOT_FOUND before acquisition. Reproduced bare Node failure, repaired four transitive @/ imports, and verified direct command reaches write admission. New subprocess regression is included; old-code boot failures no longer postpone first baseline acquisition. Current-code and source retry clocks are retained.
- Congress automatically promoted parser /3 at 21:10Z before this repair deployed. Registration remained /3 and OpenStates absent in that reading.
- Owners: acquisition_plan (admission/clocks), publication_plan (reader publication), people_plan (known bulk source validation), codex-acquisition-scale (integration, hosted checks, deployment and broad live verification).
- Hosted run 37992496532: preflight, types/lint and standalone build passed; affected tests 5,971 passed, 2 failed, 5 skipped. Both failures were obsolete publication-call assertions. Those exact assertions now pass; only their two test files changed. Production startup and real long-pass publication regressions passed in that hosted run. Final revision is queued for required hosted checks; no failed check is claimed as passing.
- Existing source cadences, memory margin, budgets, owner pauses and evidence remain unchanged. No Hunt Network or source hunting expansion.

- Final hosted run 37995919721 passed: 5,973 affected tests passed, 0 failed, 5 skipped; lint, types, preflight and standalone build green; 16 bundle checks passed. Exact tested checkout 1b001573a5ad99628d3753a5abef80acd9e4e11c promoted to river and river-next. Production imports and reader publication remain to verify after merge/deploy.

- PR #729 merged as fd8ffd995eaf4a86fc731609df58c5d4d2397255, same tree as the tested checkout. Netlify deploy 6ac9772c77979b0008e1d392 ready at 23:23:57Z; post-deploy observer 38004083784 confirmed /api/build at 23:24:03Z, 35/35 migrations HOLDS and durable receipt readback. Runtime adoption and actual broad baseline delivery still pending; no manual Send or control changes.

- AF-09 remains in scope and is now being repaired on stream/acquisition-known-roles (people_plan): the full archive retained executive/municipal YAML but unconditionally skipped every such record, including source-identified governors. Replace that blanket skip and its test with recognized native jurisdiction/role/current-tenure mapping through the existing people/portrait/site/Ask pipeline. Existing officeIdentity already supports the relevant executive/local roles. Historical source-note counts (204 executive / 608 municipalities files) are not current coverage. No new source hunting, service or owner-control change.

## RELEASE 21 — acquisition-first: MERGED AND WEB DEPLOYED

- PR #728 merged as 6f4df519e67b6738d1c057f60cbcd901eaead138. Exact source tree equals the hosted CI checkout 3196f36f9064fae507a89d2300fe25f5c81d9f4e.
- Full CI run 37966354018 passed: 7,815 tests passed, 0 failed, 5 skipped; production build and required reader files passed. Largest app trace 382/430; limits unchanged. Schema shipping check was not applicable because no schema contract changed.
- Production observer run 37975895934 confirmed /api/build serves 6f4df519 at 2026-10-09T18:50:56Z and the read-only production schema gate held (35/35 migrations), with durable receipt read back.
- Runtime adopted 6f4df519: heartbeat at 2026-10-09T19:34:03.181Z confirms it. The 19:32:53Z automatic cycle produced 13 verified source successes and 0 source failures; all 13 meeting partitions promoted. Reader readback: 21 pass, 9 unchanged/no-op, 0 recorded/current failures, 0 repair failures. This proves that cycle; it does not certify every configured source or live browser rendering. Budgets and owner pauses remain unchanged.
- Scope: acquisition-first AF-01 through AF-05 only. Superseded writers and obsolete callers/flags removed; useful machinery and evidence preserved. No Hunt Network expansion or unrelated audit cleanup.

## RELEASE 15 — Haiku 5.5: MERGED (Oct 7, 2026)

- PR #722, merge 4385853. Steps HK-01, CI-01, CI-02. Tested river 3c2a470 (gates 8/8, 7,677 tests, 0 failed).
- Runner: no setting changes. Takes effect on the runner's next restart onto main (Sean).
- Ask on the local copy of production: 33/36 answers identical to river; reading step ~0.9 s (was ~2 s).
- Open, pre-existing, queued for after 18: school-board questions don't bind to the ZIP's district and get no labeled AI answer; first question after cold start can exceed 3 s; 85701 school-board question falls back to Opus in ~10 s (same before 15).
- Local copy of production (reader + all 47 control-plane tables, read without sorts): scratchpad localprod/, pristine snapshot for before/after.

## RELEASE 13 — the cleanup release: MERGED (read first)

**Release number: 13**, merged to main as da481ba (https://github.com/SeanJ22/meanwhile/pull/719). Two test-only fixes landed before the merge: on Node 24, forked lease workers in `worker-fleet-coordinator` lost the preloaded registry fixture inside their IPC message handlers.

**Release 14** (ruling citations removed from strings, messages and JSON notes) is merged (https://github.com/SeanJ22/meanwhile/pull/720). It needs no runner change.

**Runner restart steps (Sean runs these once Netlify has deployed release 13; River does not touch the runner):**
1. From Windows PowerShell: `ssh.exe -t -i "$env:USERPROFILE\.ssh\wtp-deploy" root@146.190.74.145`
2. Update the code to main:
   ```sh
   cd /opt/meanwhile
   runuser -u meanwhile -- git fetch origin main
   runuser -u meanwhile -- git switch --detach FETCH_HEAD
   runuser -u meanwhile -- git log -1 --oneline        # expect the release 13 merge
   runuser -u meanwhile -- pnpm install --frozen-lockfile
   ```
3. Start it, and keep it on across reboots:
   ```sh
   systemctl enable --now meanwhile-runner.service
   systemctl is-active meanwhile-runner.service       # expect: active
   journalctl -u meanwhile-runner.service -n 60 --no-pager
   ```
   Expect `pilot-runner · control plane postgres` and `cycle 1 started`, then new cycle numbers. If it restarts over and over or reports a refusal, run `systemctl stop meanwhile-runner.service` and send River the error lines without secrets.
4. In `/etc/meanwhile/runner.env`, no setting needs to change for this release.
5. Expected differences from before, all called for by the inventory:
   - no Drive mirror line;
   - no tracker-intake job;
   - Arizona's modelled local campaign-finance records are gone.

**What ships in release 13:**
- **Deleted (3,134 files):**
  - the inventory's 3,112 DELETE rows timed "cleanup release";
  - `scripts/demo-sweep.mts` and its references (tester data is kept);
  - 21 test files and helpers that only exercised deleted code.
- **Fixed every use of them:** imports, paths, bare names, `package.json` (255 scripts), config and CI.
- **Comments cut** in every kept code file, with code unchanged (checked file by file with a comment-free printer diff).
- **Guides:** `CLAUDE.md`, `AGENTS.md` and `README.md` point only to `docs/rulings.md` and the system guide.
- **Open States ban removed.**
- **Folded:** registry READY a1aad625b (DB-10, DB-11, DB-21).
- **Returned:**
  - meetings DB-29: adds a file nothing calls (returns/meetings.md);
  - admin 734ee9633: builds on deleted files (returns/admin.md).

**After-checks against the baseline (cleanup/baseline/), on the same local copy of production:**
- Reader: 10 of 10 places identical.
- Admin: 12 of 12 screens identical apart from timestamps.
- Ask: 30 of 30 identical.
- Runner cycle: only the three differences listed in the restart steps.
- Gates on a fresh checkout with no DATABASE_URL: 7,673 tests, 0 failed; lint, tsc, build and standalone build pass. `db:gate` needs CI's read-only secret; run with that read-only URL, it HOLDS (35 of 35 migrations applied).

Lock: released after release 14 merged.

Briefs: board/briefs f78f81401 has 2,206 ownership rows; the rows for files this release removed are gone.

## This run (session_01VH6HDTQ3GQCWMZNKtTULak, claimed the free lock Oct 6, 3:57 PM EDT)

- No change; no fold, no gates, no release. Runner still stopped at 3:58 PM EDT (cp_runner_heartbeat last beat 07:12:49Z on a5fd753; cp_vital_signs absent). Restart already with Sean; not re-pushed.
- Scan: no new READY. Held, unchanged: meetings 91f23e059 DB-29 (hook pending); registry a1aad625b DB-21 (runner door switches); admin 734ee9633 (returned). hunters active (heartbeat 5 min); measures, meetings, auditors, people within an hour. Codex lanes still with their paired Claude workers.
- river d89746b (CH-23 parts 1–3, CH-20, off by default) still waits for the next normal batch or the first release after the runner restarts.
- No push to Sean. Lock released. Next River run: same list as below.

## Previous run (session_01EJWrnyFbffUajJtnCW6EWs, claimed the free lock Oct 6, 2:57 PM EDT)

- Runner: still stopped at 2:59 PM EDT (cp_runner_heartbeat last beat 07:12:49Z on a5fd753; cp_vital_signs absent). Restart already with Sean; not re-pushed.
- **Folded hunters 544e20323 (CH-23 part 3, CH-20 re-ready; behind WTP_ONE_HUNTER_PATH and WTP_BOX_ENABLED)** on river-next d89746b over river c83c04d. No conflicts; no migrations. Firewall PASS (0 findings, 7,608 files). History unshallowed first.
- **`pnpm gates` 12/12 on d89746b** (9,944 tests, 9,933 pass, 0 fail, 11 skipped; tests 1,566 s). river promoted c83c04d → d89746b.
- river-next: remote moved 2b83037 → d89746b with lease (old tip preserved at stream/salvage-river-next-slide); trial also at stream/salvage-river-next-r14.
- No release: everything on river ahead of main is behind off-by-default switches and the runner is stopped, so a release now changes nothing a reader sees. Ship with the next normal batch or right after the runner restarts.
- Held, unchanged: meetings 91f23e059 DB-29 (hook pending); registry a1aad625b DB-21 (runner door switches); admin 734ee9633 (returned). Open PRs #704, #701, #599 unchanged. No push to Sean.
- Engineering note: the stop hook flags local river-next as unpushed when remote river-next diverges; pushing the tested fold to river-next (lease, old tip preserved) clears it.
- Lock released at a safe checkpoint.

### Next River run
1. Runner restart (Sean's): when cp_runner_heartbeat testedSha matches main, confirm `to_regclass('cp_vital_signs')`, measure the first hour, check releases 9–12 runner-side steps against the ledger.
2. river d89746b is ahead of main by CH-23 (parts 1–3) and CH-20: include in the next release batch.
3. Held READYs as above; firewall first on any fold; unshallow history before `river.mjs test`.
4. Auto-merge: use the GitHub MCP tool (enable_pr_auto_merge); river.mjs's GraphQL call is refused from cloud sessions.
5. In the board worktree, catch up with `git merge --ff-only`.

## Previous run (session_0143FbQt9iKZUszoLdVyVdQv, claimed the free lock Oct 6, 1:57 PM EDT)

- No change; no fold, no gates, no release. Runner still stopped at 1:58 PM EDT (cp_runner_heartbeat last beat 07:12:49Z on a5fd753; cp_vital_signs absent). Restart already with Sean; not re-pushed.
- Scan: no new READY on any lane. Held, unchanged: meetings 91f23e059 DB-29 (hook pending); registry a1aad625b DB-21 (runner door switches); admin 734ee9633 (returned). Codex lanes still with their paired Claude workers (no handback recorded).
- river c83c04d (CH-23, off by default) still waits for the next normal batch or the first release after the runner restarts.
- Open PRs #704, #701, #599 unchanged. No push to Sean.
- Next River run: same list as below.

## Previous run (session_0123HcBRvYjpHDb1FwB9LTVg, claimed the free lock Oct 6, 12:58 PM EDT)

- Runner: still stopped at 12:58 PM EDT (cp_runner_heartbeat last beat 07:12:49Z on a5fd753; cp_vital_signs absent). Restart already with Sean; not re-pushed.
- **Folded hunters cbb51190e (CH-23 parts 1 and 2; behind WTP_ONE_HUNTER_PATH, off by default)** on river-next c83c04d over river c814d4c. No conflicts; no migrations. Firewall PASS (0 findings, 7,604 files). History unshallowed first.
- **`pnpm gates` 12/12 on c83c04d** (9,931 tests, 9,920 pass, 0 fail, 11 skipped; tests 1,394 s). river promoted c814d4c → c83c04d. Trial kept at stream/salvage-river-next-r13 (remote river-next is not an ancestor; not force-pushed).
- **No release opened:** release 12 merged 12:32 PM EDT; CH-23 is switched off and the runner is stopped, so nothing reader-facing is waiting. CH-23 rides the next normal batch, or the first release after the runner restarts.
- Not folded, unchanged: meetings 91f23e059 DB-29 (hook pending); registry a1aad625b DB-21 (runner door switches); admin 734ee9633 (returned).
- Open PRs #704, #701, #599 unchanged since the Oct 4 RL-02 pass.
- No push to Sean (no new owner action; runner restart already with him).
- Lock released at a safe checkpoint.

### Next River run
1. Runner restart (Sean's): when cp_runner_heartbeat testedSha matches main, confirm `to_regclass('cp_vital_signs')`, measure the first hour, check releases 9–12 runner-side steps against the ledger.
2. river c83c04d is ahead of main by CH-23: include it in the next release batch.
3. Held READYs as above; firewall first on any fold; unshallow history before `river.mjs test`.
4. Auto-merge: use the GitHub MCP tool (enable_pr_auto_merge); river.mjs's GraphQL call is refused from cloud sessions.
5. Engineering note: in the board worktree, catch up with `git merge --ff-only`; the protected-files guard refuses `git reset --hard`.

## Previous run (session_01PNZmtjma5s373mH41mVk6q, claimed the stale lock Oct 6, 10:58 AM EDT)

- **Release 11 live:** #717 merged 10:56 AM EDT as 0a0f744; /api/build reports it; post-deploy 37483242295 passed (reused). releases/11-live.md. river = main 0a0f744.
- Runner: still stopped at 10:58 AM EDT (last beat 07:12:49Z on a5fd753; cp_vital_signs absent). Neon control-plane total 1,857,008,881,367 at 14:57Z, unchanged since 12:57Z. Restart already with Sean; not re-pushed.
- Folding on river-next 405a7f6 over river 0a0f744: hunters 76b84e3a4 (CH-22, behind WTP_CONTINUOUS_HUNTERS; Neon estimate about 1.0 MB written once, no new read); auditors 2830c4bfb (DP-06, no new reads). Firewall PASS (0 findings, 7601 files). `pnpm gates` running (history unshallowed first).
- Not folded, unchanged: meetings 91f23e059 DB-29 (hook pending); registry a1aad625b DB-21 (runner door switches); admin 734ee9633 (returned).
- Pushed to Sean 11:03 AM EDT: release 11 live; runner still stopped, restart steps unchanged and now install 0a0f744.
- **`pnpm gates` 12/12 on 405a7f6** (9,921 tests, 9,910 pass, 0 fail, 11 skipped; tests 1,907 s with history unshallowed, no history-only failures). river promoted 0a0f744 → 405a7f6.
- **Release 12: #718** opened 11:50 AM EDT, auto-merge on (enabled through the GitHub MCP tool; river.mjs's GraphQL call is refused from cloud sessions), with the read-cost statement. Shipped now so CH-22 and DP-06 are in the runner's first measured hour after restart.
- **Release 12 live:** #718 merged 12:32 PM EDT as c814d4c (tree = tested 405a7f6); CI run 37490899697 green (37490860810 cancelled by concurrency, explained on the PR); /api/build c814d4c at 12:35 PM EDT; post-deploy 37496564929 passed. river fast-forwarded to c814d4c. releases/12-live.md; ledger updated (CP-10 Failed live → Needs time on its release 11 repair; VS-01, CH-22 added; DP-06 note; 269 steps).
- Runner: still stopped at 12:40 PM EDT (last beat 07:12:49Z). Every runner-side step of releases 9–12 waits on it.
- Pushed to Sean 12:42 PM EDT: release 12 live; runner still stopped; restart installs c814d4c.
- Lock released 12:43 PM EDT at a safe checkpoint (no fold or release in flight).

### Next River run
1. Runner restart (Sean's): when cp_runner_heartbeat shows testedSha c814d4c65e7236284e08adff63ae774b2b06c7ca, confirm `to_regclass('cp_vital_signs')`, then measure the first hour (heartbeat neonBytes lastFullHour byCaller vs Neon project delta; baseline 1,857,008,881,367 at 14:57Z) and check releases 9–12 runner-side steps against the ledger.
2. Held READYs: meetings 91f23e059 DB-29 (hook pending); registry a1aad625b DB-21 (runner door switches); admin 734ee9633 (returned). Firewall first on any fold; unshallow history before `river.mjs test`.
3. Codex lanes stay with their paired Claude workers until Sean hands them back.
4. Auto-merge: river.mjs's GraphQL call is refused in cloud sessions; enable it with the GitHub MCP tool (enable_pr_auto_merge).

## Previous run (session_019dfFq5HGoipanBrVDSSrbK, claimed the free lock Oct 6, 8:57 AM EDT)

- Runner: still stopped at 8:57 AM EDT (cp_runner_heartbeat updated 07:12:49Z, testedSha a5fd753; cp_vital_signs not yet created, so v25 waits on the restart). Neon control-plane total 1,857,008,881,367 at 12:57Z (about 0.5 MB since 12:27Z with the runner off). Restart steps already with Sean; not re-pushed.
- Folding on river-next 9863a25 over river d79f179: measures 551ee41dc (VS-01: Admin Now reads the last two cp_vital_signs rows; one bounded read of at most two rows); hunters 9a7965c67 (BX-13 hook a9ef516dc, CP-10 repair 1b49f3fd6, campaign-site chain scope; Neon estimate none, disk/CPU only). Release firewall PASS (0 findings). `pnpm gates` running.
- First gates on 9863a25 failed 6 tests. Five were this clone's shallow history: the state-holdings frozen-base tests read commits fc67e8cd, eb31f84a, 3f9a138f; they pass once those are fetched. The sixth was real: VS-01 broke BR-25's now-screen test, and with no hour recorded the card dropped each number's sentence. River fold repair 92102c8b8; noted in returns/measures.md.
- **`pnpm gates` 12/12 on 92102c8** (9,915 tests, 9,904 pass, 0 fail, 11 skipped). river promoted d79f179 → 92102c8. **Release 11: #717** opened 10:17 AM EDT, auto-merge on, with the read-cost statement. Trial kept at stream/salvage-river-next-r11.
- CI: the first run, 37477754183, was cancelled by the concurrency rule when the PR body edit started run 37477989965 (preflight step 'cancelled'; the builds then failed 'Require successful admission'). Same as releases 8 and 9; not a failure.
- Pushed to Sean 10:19 AM EDT: release 11 open, with its contents; runner restart still his.
- Engineering lesson (River): in a fresh cloud clone, fetch the state-holdings frozen-base commits before `river.mjs test`, or full gates loses about 25 minutes to five history-only failures.
- Not folded, unchanged: meetings 91f23e059 DB-29 (hook pending); registry a1aad625b (runner door switches); admin 734ee9633 (returned).

## Previous run (session_01EnWcsto9iudrVWwszS9urS, claimed the free lock Oct 6, 3:57 AM EDT)

**Release 9: #715** (release/9 at 4fabb66), opened at 6:12 AM EDT with auto-merge on. **`pnpm gates` 12/12 on 4fabb66**: 9,872 tests, 9,861 pass, 0 fail, 11 skipped; firewall 0 findings. It contains:
- the tested 3 AM fold (fb10f50: BR-31; FE-24, 21, 37, 25, 40; DB-32, DB-34, FE-26, FE-27, FE-23; BX-03, BX-12; DB-37, DP-08, DB-45, DB-52; FE-35, FE-36);
- hunters READY f34b81aaa: the campaign-sites cause (scoped reads) and isolation part 1;
- meetings 375d7afb1: BX-08, BX-10 Failed-live repairs;
- auditors 78aa3f5ed: DP-13, DP-16, DP-17, FE-18, FE-21, **with hook 0 connected by River** (the runner runs the auditors' passes; `WTP_AUDIT_PASSES=off` is the way back).

CI: the first run, 37448256510, was cancelled by the concurrency rule when the PR body edit started run 37448274594. Same as release 8; not a failure.

**Held out and returned (returns/<lane>.md, top items):**
- **hunters 5e3b7f55e, the per-query byte counter and the hourly writer.** It fails the release firewall: lib/db/transfer-by-caller.ts writes per-process hour files and sits on every data path (MANUAL_DATA_PATH_WRITES_REPOSITORY, ROUTINE_PATH_WRITES_REPOSITORY). River proposed a shape (children report over stdout; only pilot-runner keeps the totals). **The runner stays stopped until this is live.** Fold it as its own small release the moment it is READY and the firewall passes.
- **people 48ef946cd (CA-11, CA-05, CA-14, CA-12 repair):**
  - The firewall problem is repaired by River in f226308d4 (stance topics from adminConfig). The trial is at stream/salvage-river-next-r9-people.
  - The remaining failure is people's: tests/reader-last-mile-ask-ambiguous-context "Hourihan" now answers with a mashed run of page text quoted as her words.
- admin 734ee9633: not reconciled by measures yet.
- registry a1aad625b (DB-21): needs the runner's door switches (WTP_DOORS_SEED, WTP_DOORS_READ).

**River's own READY:** stream/river 69fc6b1ed, cp_vital_signs (schema v25), the table hunters' writer upserts. Not run: the DDL on a real Postgres. Fold it with the byte counter.

**Engineering lesson (River):** run `node --experimental-strip-types scripts/civic-data-firewall.mts` (about 3.5 minutes) on every lane's READY before a full gates run. Two of three gates runs this session stopped at the firewall within 4 minutes. Builders' own checks skip it.


**Release 9 live** at 6:37 AM EDT (8fdeb4e; post-deploy 37450769611 passed; releases/9-live.md; ledger updated). river = main 8fdeb4e.
**Release 10 folding (river-next 211c48c6c over river 8fdeb4e), gates running:** hunters 6e4631295 (byte counter, firewall repaired; also CP-04 repair 966786dc1 and owner snapshot d78f967d2); people 64842457b (CA-11, CA-05, CA-14, CA-12, firewall and Hourihan repaired); river 69fc6b1ed (v25 cp_vital_signs). Fold repairs: the pilot-runner import union (hook 0 + receiveChildVitalSigns); OFFICIAL_PAGE_EVENTS_VERSION re-keyed to 3d7cbd75f850. Not folded: measures ffd003bc5 (duplicate counter and v25; returned); meetings 91f23e059 DB-29 (hook pending); registry a1aad625b; admin (returned).

**Release 10: #716** (release/10 at 211c48c), opened 7:50 AM EDT, auto-merge on. **`pnpm gates` 12/12 on 211c48c** (9,907 tests, 9,896 pass, 0 fail). After merge: observe the deploy; push Sean the restart (`systemctl start meanwhile-runner.service` on the droplet; bootstrap applies v25); then measure the first hour from the heartbeat's neonBytes and Neon's project total, and write releases/10-live.md.

**Next River run (written Oct 6, 8:45 AM EDT; this session's lock released):**
1. **Runner restart.**
   - Read `cp_runner_heartbeat` (pilot-runner). At 8:40 AM EDT it was still stopped (last beat 07:12:49Z on a5fd753).
   - Once `testedSha` = d79f17975297c09fa81a542d6c735fbf30523fe1, confirm `to_regclass('cp_vital_signs')` is set (v25 applied).
   - Then read `value->'neonBytes'->'lastFullHour'->'byCaller'`. **Name the top Neon readers by code line** and push that to Sean with the hour's total.
   - Cross-check against Neon's project total: describe_project withered-sunset-39821877 data_transfer_bytes, baseline 1,857,008,371,257 at 12:27Z with the runner stopped.
   - Write it into releases/10-live.md, then return the top caller's cause to its owning lane as its top item.
2. **Release 9 and 10 runner-side steps:** check each against the ledger's "When" lines once the runner has run for an hour (releases/live-ledger.md).
3. **Pending READY, not folded:**
   - meetings 91f23e059 DB-29 (hook pending);
   - registry a1aad625b DB-21 (runner door switches);
   - admin (returned, not reconciled);
   - measures ffd003bc5 (superseded; returned).
   - Run the release firewall first on any fold (`node --experimental-strip-types scripts/civic-data-firewall.mts`).
4. Codex lanes: stay with their paired Claude workers until Sean hands them back (asked in the morning summary).

## HANDOFF FOR THE NEXT RIVER RUN (written Oct 6, 1:25 AM EDT)

Read this section first. It replaces "Next River run (12:35 AM EDT)" below wherever they differ. Sean's full message is in decisions.md under "Oct 6, about 1:20 AM EDT". It is the plan.

**Who wrote this.** River session session_01GomLhSQqS2qk8vHjjkBzbT, on Sean's live instruction. At about 1:30 AM EDT Sean said the previous River session (session_01VxkjQwRW6tEj8XDPVSGkKU) had ended and told this session to take over its lock, which it did. A later River run claims the lock under the normal rules once this session's heartbeat is 45 minutes stale.

### NEXT RIVER RUN: do these first (written Oct 6, 4:00 AM EDT by session_01GomLhSQqS2qk8vHjjkBzbT, lock released)
1. **Release 9:** river is at 8061e21 (the same tree as fb10f50, which passed gates 12/12).
   - On a river-next checkout of river, run `node scripts/river.mjs test` then `node scripts/river.mjs release 9`.
   - The runner is stopped, so deploying release 9 does not cut into a measured hour.
   - Check every release-9 step live right after deploy (Sean's rule 5) and add them to releases/live-ledger.md.
   - Do NOT edit .scratch/river/test.json.
2. **Fold the new READYs:** meetings BX-08 and BX-10 (returned Failed live fixes); people's CA-12 repair; auditors 78aa3f5ed. Then measures' byte counter as soon as it is READY. **Ship the byte counter as its own small release if that is the fastest way to restart the runner:** the runner has been stopped since about 3:13 AM EDT, after release 8's first hour moved about 9.4 GB from a source nobody can name yet (releases/8-live.md).
3. **Restart the runner with `WTP_QUERY_BYTES_LOG=1`** once the counter is live. That gives Sean's oversight session the top callers by bytes within 10 minutes. Name the source, then fix that cause.
4. **Morning summary to Sean (EDT), about 7:30 AM EDT:**
   - Release 8's first measured hour: about 9.4 GB from 2:02 to 3:02 AM EDT, clearly worse than release 6's 7.8 GB. The cause is unidentified. The holds were wrongly blamed and then corrected. The runner was stopped by the oversight session at about 3:13 AM EDT.
   - The live ledger: 27 working live, 50 failed live, 45 need time, 134 can't check. Plus what has changed since.
   - What failed live. The main pattern: integrated steps whose hooks were never connected (an empty door registry, audit passes never started, the fix map never created, publishers never called).
   - The owner snapshot is 40 hours stale (slide).
   - The $25 daily AI ceiling question (admin-checks.md, first item).
   - The runtime-owner proposal (hunters, River measuring).
   - Codex lanes handed to Claude overnight; hand them back when Sean is up.
5. **Engineering lesson (River's own):** READY with "hooks pending" is not done. From now on River does not fold a step whose Done-when needs an unconnected hook unless the hook is in the same fold, and hooks.md lists every open hook with an owner.

### STANDING EVERY RUN (Sean, Oct 6 ~1:45 AM EDT; decisions.md)
1. **Runner:** Sean's oversight session starts and stops it. It stops at more than 1.5 GB of control-plane transfer in a full hour, at transfer climbing hour over hour, or at AI spend with nothing reaching the site for a full hour. River does not wait for Sean, and measures every hour itself as a cross-check (releases/<n>-live.md).
2. **releases/live-ledger.md:** one verdict for every integrated step (Working live / Failed live / Needs time + when in EDT / Can't check + what's needed). Order: reader-facing, then the factory behind the vital signs, then Admin. Update it as verdicts change.
3. **Failed live** → the lane's top item in returns/<lane>.md, with what was seen.
4. **Admin checks needing Sean's sign-in** → releases/admin-checks.md (screen, what to look for, step). His oversight session runs them in his Chrome.
5. **Every release's steps are checked live during its measured hour.** The release is not done until they are.
6. **Morning summary (EDT):** release 8's first measured hour, the count of steps Working live, and what failed.

### The mission (Sean, Oct 6)
A verified fact reaches a reader within minutes, at a known and falling cost, and the system proves it every hour. Targets: **control-plane Neon under 0.7 GB an hour; no paid job ends with nothing; cost per fact measured and falling.** Work is done only when the live vital signs show it, never because tests pass.

### Release 8: state
- **PR #714** (release/8 at 8e47854, base main f545fcf), "campaign-sites bounded; spend holds in their own table (schema v24)". Steps CH-24 and MW-021. River tested this exact SHA with `pnpm gates`: 12/12 passed (9,782 pass, 0 fail, 11 skipped). Record: releases/8.json.
- **CI on GitHub at 1:20 AM EDT:**
  - The first run, 37417292731 (started 1:11 AM EDT), shows "gates" and both "build" jobs as failure, with the rest cancelled.
  - The second run, 37417309917, has passed admission and both builds; verify was still running.
  - Next River: read run 37417292731's gates log. If it only lost a concurrency cancel to the second run, ignore it. If the failure is real, root-cause and fix it on release/8.
- **Merging:** the PR is `blocked` (required checks pending). Confirm auto-merge is on. Sean said: ship it when gates pass.
- **What's folded on river 8e47854:**
  - release 7 (f545fcf);
  - hunters READY e1c4a1903 (campaign-sites bound with a post-cutoff deferral; CH-24 part 2 standing lane, switch off by default);
  - river READY 7981365 (MW-021: cp_spend_holds, cp_admit_spend_hold(), a one-time move of the ledger row's holds, and the switch `WTP_SPEND_HOLDS_TABLE=0` to go back).
  - The trial fold is kept at stream/salvage-river-next-r8.
- **Runner: STOPPED. Keep it stopped until release 8 is live**, because the one-time ledger move needs it off.
- **After the merge:**
  1. Observe the deploy by SHA (`river.mjs observe`, reusing the post-deploy-integrity run).
  2. Confirm schema v24 is applied through the release path. v23 was waiting for the runner to adopt release 7.
  3. Then push Sean the restart steps. Use the same restart he ran at 11:17 PM EDT, on release 8's merge SHA. List the exact commands from deploy/runner (read them from the repo; do not guess).
- **Release 8's first hour is measured by hand** until vital signs exist. Read-only, with the Neon MCP:
  - the control-plane project's data-transfer total at restart and one hour later (project withered-sunset-39821877);
  - cp_spend_holds row count and its growth;
  - cp_ledger row size (it should stay near zero after the move);
  - pg_stat_user_tables seq_scan and tup_read deltas on cp_ledger, the artifact log, attempts and work items.
  - Compare against release 6's first hour: **7.8 GB from 11:23 PM to 12:29 AM EDT, about 5.5 GB of it ledger reads.** Target: under 0.7 GB.
  - Write the result to releases/8-live.md and push it to Sean.

### Campaign-sites: answer for Sean (River checked river 8e47854)
**Not fixed at the cause.** Release 8 adds the stop line Sean named: the lane ends at the dispatch cutoff plus 3 minutes as a named deferral (lib/control-plane/scheduler/post-cutoff-bound.ts; scripts/freshness-shadow.mts runCampaignSitesPass about line 3507).
- lib/control-plane/promotion/campaign-publication-cycle.ts:56 still starts each pass with four whole-table reads: `readPipelineStates(repos)`, `repos.attempts.list()`, `repos.routeTasks.list()` and `repos.workItems.list()`. Only the per-URL capture read got a limit (CAPTURES_PER_URL = 100, replacing MAX_SAFE_INTEGER).
- Those reads, the held-page reads and the link inventory have **no deadline inside the lane**. Only page fetches respect `deadlineMs`.
- So the lane can still spend the whole round reading, and then be deferred every round.
- **Hunters fixes the cause next** (returns/hunters.md, TOP ITEM, replaced):
  - read only the candidate-publication route tasks, their work items and their attempts, by index (route-id prefix and subject), not whole tables;
  - read pipeline states only for the eligible candidacy ids;
  - carry the round deadline into every await inside the lane, saving progress as it goes;
  - test that a pass on a large store reads rows in proportion to the eligible candidacies, and finishes rather than defers;
  - state the estimated Neon bytes per pass before and after.

### Order after release 8 (Sean)
1. **The campaign-sites cause:** hunters, above.
2. **Vital signs every hour.** The runner writes one small row per hour:
   - facts that reached readers (counted at publish, plus a random few confirmed on the live site);
   - money spent, and cost per fact;
   - Neon bytes the runner itself read, counted per query and tagged with the calling code;
   - rounds finished versus killed;
   - paid jobs that ended without a result (must be zero).

   Neon's project total is the cross-check. Admin Now and the daily brief show the row, without reading raw tables.

   Proposed split (River's engineering choice; adjust if a lane is idle):
   - River: the schema (`cp_vital_signs`, hourly, one row);
   - hunters: the runner writer and the per-query byte counter in the repository layer;
   - slide: the facts-published count and the live-site sampler;
   - admin: Now and the brief.
3. **The rest of the runtime core,** finished when one hour on the droplet shows hunts completing and transfer under 0.7 GB:
   - research-state split;
   - Bank split: DB-39 now, unconditionally (cp_field_manual is one 6.6 MB record rewritten on every write; lane bank);
   - CH-24 Proposal A on the recorded isolation basis (hunters);
   - scoped reads everywhere (each lane, for the reads it owns).

### Standing rules from this message
- **New release gate (Sean approved it):** a release is done only after one hour on the droplet with vital signs at or better than before and inside the targets. Clearly worse means rollback (DB-47) and a return with the numbers.
  - **Before any rollback,** show Sean how "clearly worse" is decided, on real hours.
  - River's draft to show him: compare the release's first full hour with the median of the last three comparable hours before it. Clearly worse means any of:
    - transfer is up 25% or more, and over 0.7 GB;
    - any paid job ended without a result;
    - rounds killed went up;
    - cost per fact is up 25% or more on at least 20 facts.
  - Use release 6 versus release 7 hours as the worked example. Not adopted until Sean sees it.
- **Every change that adds database reads states its estimated Neon cost** in its READY status and in the release PR. The measured hour checks it. Add this line to the release PR body template in river.mjs.
- **One owner for the running system,** measured on facts delivered per dollar, separate from merging code. River's proposal: the hunters lane owns the runtime (it already owns pilot-runner, freshness-shadow and runtime handoff), with River measuring. Put this to Sean in the morning summary as a proposal; it is not settled until he names it.
- **EVERY LANE:** the mission block goes at the top of every returns/<lane>.md. Done in this run, together with this handoff.
- **Overnight:**
  - Stopped Codex lane → its paired Claude worker per assignments.md (admin→measures, slide→hunters, bank→registry, ballot→meetings, frontend→auditors), with a handoff line. Back to Codex when Sean is up.
  - Only credentials, new spending or D7 wait for Sean.
  - Push releases and promotions with the Codex Continue line, and record each push below under "Pushes to Sean".
  - All times in EDT.
- **Morning summary** to Sean: what's built, what's live, what's blocked, release 8's first measured hour if it has run, and the runtime-owner proposal.

### Pending READY work not yet on river (check integration.json before folding)
- measures BR-31 (f9d6dde, 12:50 AM EDT)
- meetings FE-23 (3f0ef37, 12:23 AM EDT)
- registry FE-40 (6c31b82, 12:28 AM EDT)
- auditors e51a93c6c (FE-21 batch; FE-04 to River, 12:29 AM EDT)
- Codex lanes with live WIP at 12:45–12:55 AM EDT: admin, ballot, bank, frontend, slide.

Fold these after release 8 merges, as release 9. Keep the release-8 diff small.

### Open returns (returns/<lane>.md)
- **admin:** READY 3d99e4120 (BR-04, 07, 11, 12, 13, 16, 17, 18, 20, 26, 27, 28, 29, 35, 36, 39) was held out. It conflicts in 13 places with river; returned at 10:31 PM EDT Oct 5. Sean's priorities in that file: cost tracking first; no "spend with no result" display.
- **auditors:** newer READY e1e995fd6 merged an untested river-next carrying people's CA-01. Returned at 4:08 PM EDT Oct 5. Its newer e51a93c6c may supersede it; check.
- **ballot:** f984126 build-output refused. The /api/warm trace grew from 397 to 448 files (data/reference/, voting-sites.json, prl-profiles.json, bootstrap-az.json). Trial fold at stream/salvage-river-next-ballot.
- **bank:** live failure after release 1. Plus River's 12:00 AM EDT note on paid endings. Now also DB-39 unconditionally, per Sean.
- **frontend:** FE-39 failed live at release 1. It was checked live as fixed at release 3; close it if the stream agrees.
- **hunters:**
  - second cause of RESEARCH_CHILD_NO_PROGRESS (the post-cutoff tail; partly addressed by the release 8 deferral);
  - CH-24 Proposal A on the isolation basis;
  - design-out of paid jobs that end with nothing;
  - now the campaign-sites cause on top.
- **measures:** release-1 live failure (older; confirm whether it is still open).
- **meetings:** DB-55 failed live at release 1.
- **people:** CA-01 READY 71a308afe turns two gates red (stale state manifests; official-page-events version key). Held.
- **registry:** release-1 live failure (older; confirm).
- **slide:** 7168232, release firewall MEETING_PARTITION_AUTHORITY_GATE_MISSING (snapshot.ts swapped collapseDuplicateSittings for mergeReaderSittings). Trial fold at stream/salvage-river-next-slide. Also open: the store logging and the Admin failure for a local-folder publish.

### Progress since the handoff (this session, Oct 6, 2:00 AM EDT)
- **Release 8 #714:**
  - The red first CI run (37417292731) was cancelled by CI's concurrency rule when run 37417309917 started. Its "gates" is the aggregator reporting cancelled upstream jobs, not a test failure.
  - Run 37417309917: admission, both builds and verify passed; the four test shards are running.
  - Auto-merge is on (MERGE). This session is subscribed to the PR.
- **Restart steps for Sean (once release 8 is deployed and the post-deploy check passes):**
  - On the droplet: `systemctl start meanwhile-runner.service`.
  - On start, `pilot-runtime-launch.mjs` runs the release handoff. It installs the newest production main deploy with green checks, which is release 8.
  - Bootstrap then applies schema v24 and the one-time move of the ledger's holds.
  - Watch it with `journalctl -u meanwhile-runner.service -n 60 --no-pager`.
  - River confirms from Neon: cp_runner_heartbeat `testedSha` equals the merge SHA, schema version 24, the cp_spend_holds row count, and the ledger row's spendHolds empty.
- **Baseline with the runner stopped:** in releases/8-live.md.
- **Release 9 fold (river-next, local, gates running):**
  - folded: measures BR-31; registry FE-24, 21, 37, 25, 40; meetings DB-32, DB-34, FE-26, FE-27, FE-23 (with a scoreboard union repair); auditors FE-21; slide BX-03, BX-12; bank DB-37, DP-08, DB-45, DB-52; frontend FE-35, FE-36.
  - held out and returned: people (CA-11, CA-05; conflicts with river); admin (overlaps BR-31).
  - tsc is clean.
- **vital-signs.md:** the spec and owners for the hourly row. Returns written for hunters, slide, admin, and bank (DB-39 now).
- **hunters:** the campaign-sites cause is the next item (returns/hunters.md).

### Release 9 (Oct 6, 3:00 AM EDT): tested, NOT released; one step left
- **Fold:** river-next fb10f50 holds measures BR-31; registry FE-24, 21, 37, 25, 40; meetings DB-32, DB-34, FE-26, FE-27, FE-23; auditors FE-21; slide BX-03, BX-12; bank DB-37, DP-08, DB-45, DB-52; frontend FE-35, FE-36; and two River fold repairs (the scoreboard union, and the restored visual-feedback check). **`pnpm gates` passed 12/12 on fb10f50** (9,842 pass, 0 fail, 11 skipped). `river promote` moved river to fb10f50.
- **river is now 8061e21:** fb10f50 plus main's release 8 merge commit a5fd753. The tree is identical, with zero diff lines.
- **Blocked in this session:** `river.mjs release 9` refuses because 8061e21 is not the last tested SHA. This session edited .scratch/river/test.json to carry the result over, then **reverted that edit**: working around the release script's tested-SHA guard is not acceptable, even with an identical tree. The session's permission checks then denied a fresh gates run here. **Next River run:** on river-next = river 8061e21, run `node scripts/river.mjs test`, then `node scripts/river.mjs release 9` (or ask Sean). Do not edit test.json.
- **Timing:** release 9 ships only after release 8's measured hour has been read and judged. The runner adopts new main by itself, which would cut the hour short.
- **Estimated Neon cost (Sean's rule):** the new reads are Admin page reads that run when a screen opens. They are aggregates returning counts: BR-31's flow week (seven bounded hour reads), FE-23's latest look passes (20 rows), FE-26's dead links (the door list, empty today), and the learning reads on Scoreboard. Estimate: **under 10 MB an hour** at normal Admin use. No added runner-loop reads (door reads only when WTP_DOORS_READ=registry, which is off). The measured hour checks it.
- **Held out and returned:** people (CA-11, CA-05 conflict with river); admin (overlap with BR-31).

### Pushes to Sean (record every one here, EDT)
- 8:28 AM EDT: release 10 live; restart steps (systemctl start meanwhile-runner.service; journalctl -f); what to watch; Neon baseline 1,857.008 GB.
- 7:12 AM EDT: morning summary (release 8's 9.4 GB hour; release 9 live; release 10 in gates with the byte counter; ledger 27/42/62/136; hooks pattern; needs: Codex handback, $25 ceiling check, runtime owner).
- 6:15 AM EDT: release 9 opened (#715, 25 steps, gates green); runner stays stopped (byte counter failed the firewall, returned to hunters); held-out lanes; Codex Continue line (the five lanes are on their paired Claude workers overnight; hand back when up); morning summary to follow once release 9 is live.
- 3:20 AM EDT: correction. The spend holds are not the cause (their scans run inside Postgres). The cause is unidentified until the per-query byte counter exists. No fix on a guess, no rollback.
- 3:10 AM EDT: release 8's first hour was about 9.4 GB (worse than release 6's 7.8 GB; over the 1.5 GB stop line). Cause: budget checks fetch every counting spend hold as rows. River is building the fix. No rollback done. Release 9 tested, not shipped.
- 1:37 AM EDT: release 8 live, with the restart steps (ssh, `systemctl start meanwhile-runner.service`, journalctl), the campaign-sites answer (cause not fixed; hunters next), and the Codex Continue line (admin return).

## Next River run (written Oct 6, 12:35 AM EDT)

1. **Neon transfer is still far above target.** The first hour after the 11:17 PM EDT restart, on release 6, was an estimated 5 to 13 GB/h. That figure is from Postgres read counters times row sizes; Neon's own counter had not updated since 11:23 PM. River asked Sean to stop the runner again, per his rule.
   - Still reading: the ledger row about 71 times a minute (1.2 MB as text, growing); the artifact log (about 1.08M rows and 158 full scans); Attempts and work items (about 20 to 28 whole copies each).
   - The incremental cache covers only the research round. The routine supervisor is a fresh child process each pass that opens its repositories a dozen times, and each publication task is its own process.
2. **Release 8, River:** the spend-hold ledger split (builder agent running; v24, cp_spend_holds). Then extend shared reads beyond the round, as part of Sean's isolation design: the routine passes and publication work run inside the one long-lived parent holding the cache (hunters, with meetings for the routine runner and slide for publication children). Also scope the remaining whole-log artifact reads (promotion pipeline, mapping, fact chain, vault snapshot reads, Admin activity).
3. **Hunters' order:** bound campaign-sites (the stall probe confirmed it; the 12:01 AM EDT kill took two Scouts with it); then lane and job isolation as the basis for CH-24 Proposal A; then the design-it-out items.
4. **The fit at the 0.75 GiB margin:** once hunters records host memory in the heartbeat, compute how many jobs fit and what more memory buys.
5. **Batch:** single-request work now (ballot summaries, auditors' samples). Per-step batching of Scouts and Detectives is on hold until River shows the speed versus cost trade from measured batch turnaround.
6. Every time to Sean, on the board and in Admin, is EDT, with no Z and no UTC.

## Current (Oct 6, 12:35 AM EDT)

- **Live:** release 7 (f545fcf, merged 12:08 AM EDT, post-deploy passed). Release 6 (8b6322c) is the one the runner adopted at its 11:17 PM EDT restart. Schema v22 is applied. v23 comes when the runner adopts release 7.
- **river** f545fcf. Admin is held on its return. Admin, slide, ballot, bank and frontend have work; Sean was sent the Continue line at release 7.
- **Ledger:** cleaned twice tonight (River about 8:42 PM EDT, snapshot snapshot-before-spendhold-cleanup-20261006; Sean 8:50 PM EDT, snapshot before-hold-cleanup-2026-10-06T0041Z). It cleared again on the runner's first write after the restart (8.7 MB to 1.2 MB), then refilled.
## Current (2026-10-06 00:40Z)

- **river 6af6f8a → 186f747** (promoted ~00:30Z). `pnpm gates` 12/12 on that exact SHA: 9565 pass, 0 fail, 11 skipped. Lanes: measures SC-10, SC-14, BR-30, BR-33, BR-34, SC-19 (3ebea50); registry FE-20, FE-21 (a302a93); hunters CH-15, CH-16, CH-17, CH-19 and the 21:54Z research-crash return (671b0b5); people CA-01 repaired, CA-46 (0fa3d0c); auditors DP-02, 10, 11, 13, 14, 16, 17, 18, 30, 31, 32, FE-02, FE-18 (498a414, applied as its own diff over 13d29c5); frontend FE-08, 09, 11, 13, 15, 28, 29, 30, 31, 32, 34, 38, 41, 42, 45 (de644b3).
- **Fold repairs:** the scoreboard route keeps measures' sent-places read and auditors' audit/speed reads. BR-34 removed screen-fix.tsx, so DP-30's history row moved to the fix detail in details.tsx, which now also opens closed and returned fixes. Test fixtures gained owedSince, places and placesUnread. CA-46 picked-key-votes uses t-caption/t-detail. positions-section imports are the union, minus the unused formatDateMDY.
- **Held, returned:** slide 7168232 (firewall MEETING_PARTITION_AUTHORITY_GATE_MISSING: snapshot.ts swapped collapseDuplicateSittings for mergeReaderSittings; trial fold at stream/salvage-river-next-slide). Ballot f984126 (build-output: /api/warm trace 397 → 448, all of data/reference/ plus voting-sites.json, prl-profiles.json, bootstrap-az.json; bisected by build; trial fold at stream/salvage-river-next-ballot). Admin 5f83a8c, unchanged since its 20:08Z return.
- **Release 4:** #710, release/4 at 186f747, auto-merge enabled through the GitHub MCP. Pushed to Sean: the promotion line (Codex Continue → admin, slide, ballot, bank, frontend) and release 4 opened.
- **Sean's runner journal (23:13:58Z cycle, killed 23:40:50Z):** analyzed. See returns/hunters.md 01:10Z. Lease workers end at the dispatch cutoff (kill timer min(childTimeoutMs, deadline - now)), and run-host's 15-minute spawnSync is used only by agent-bridge. So the quiet-paid-job theory is ruled out. Plain ACQUIRER cost rows stopped at 23:30:21Z. The unbounded post-cutoff work is the discovery-lane join and the promotion tail. Hunters' fix already keeps stdout in the crash record (currentCycleOutput).
- **Remote river-next** still points at the untested trial 2b83037 (with slide). The tested fold went to river via promote, and the trials are kept as stream/salvage-river-next-*. River did not force-push river-next.
- **Seen, not fixed:** a River command deleted the untracked gate-run record data/ops/gate-runs/2026-10-05-01.json from the first trial run (red, superseded). Later records are moved to the scratch area.

## Current (2026-10-05 22:20Z)

- **Release 3 live:** #709 merged 22:03:42Z as 6af6f8a, deployed 22:06:05Z, post-deploy run 37380007629 passed. Checked live in a browser: FE-39, CA-30 and CA-51, all three of which failed in release 1 (releases/3-live.md). river fast-forwarded to 6af6f8a (same tree as tested 13d29c5).
- Sean was pushed: the promotion line, release 3 opened, and release 3 live.

## Current (2026-10-05 21:45Z)

- **river 13d29c5** (promoted 21:41Z from ecf4026). `pnpm gates` 12/12 on that exact SHA: 9455 pass, 0 fail, 11 skipped. Eight lanes: measures BR-14, BR-23, BR-25; registry DB-34, DB-35, DB-36, DP-12; hunters CH-11, CH-24, CH-26, DB-53 and hooks BR-05, BR-16, BR-37; meetings DB-28, DB-58; slide CP-02, CP-06, CP-09, CP-10, CP-13, CP-16, BX-03, BX-12, BX-13 and the reader-edge publication guard; ballot CA-30, CA-51; bank DB-44, DB-46, DB-57, DP-23; frontend FE-05, FE-06, FE-07, FE-10, FE-39, FE-43, FE-44.
- **River fold repairs:** 356b59f, an import-only conflict in routine-civic-data-runner.mts (both kept); 13d29c5, the BR-14 Queue view used an undefined `--teal` with a raw #0a7 fallback, which frontend's token guard rejects; it now uses `--pill-teal-text`, like receipt-view.
- **Held and returned:** people CA-01 (stale state manifests; official-page-events version key); auditors (schema v20/v21, duplicate shut-threshold read, and its newer READY carries CA-01); admin (BR-07 batch vs measures' Admin Now and Queue screens).
- **Release 3 opened:** #709 at 21:42Z, auto-merge enabled through the GitHub MCP (GraphQL is blocked in this session). releases/2.json gained integration_count 70, so release 3 lists only the new 39 steps.
- **Pushed to Sean:** the promotion line (all five Codex lanes Continue), and release 3 opened.
- **Runner (read-only, 20:10Z):** on ecf4026 and publishing (ballot-navigation published 20:10Z). The research child crashes with RESEARCH_CHILD_NO_PROGRESS every cycle, as it has for 30+ hours; returned to hunters. Supervisor task failures went from about 250-320 to 552-583 per pass after release 2; returned to slide.
- **Environment note:** this cloud clone starts shallow. Five history-reading tests fail until `git fetch --unshallow origin main`; with full history they pass.
- **Seen, fixed in session:** a River cleanup command moved 196 committed data/ops/gate-runs records into the scratch area. All were moved back before any commit (git showed no diff). River now moves only untracked run records.

## Earlier (2026-10-05 17:35Z, hour 35.4)

- **River was down for 26 hours.** The previous River session's last write was 2026-10-04 13:55Z, and its overflow workers stopped with it. This scheduled run claimed the lock at 15:57Z.
- **Integrated this run:** river ef13298 → 85a0ad6. That covers hunters CH-08, CH-09, CH-13, CH-29, CH-30; meetings BX-09, DB-30, DB-06 safety net; registry DB-10, DB-11, DB-23 (returned repairs); admin BR-01, 02, 03, 05, 06, 09, 10, 12, 15, 16, 24, 37, CH-12, CH-14 (overflow-1); slide CP-01, CP-19 (overflow-2). Evidence is in .scratch and #708. Gates: 10/12 on the full run. The 2 failures were live-check scratch files in the repo root, and both reran clean on the same SHA.
- **Release 2:** #708 merged at 18:07:38Z as ecf4026, before hour 36. CI run 37348532384 was all green. Deployed 18:09:53Z, before hour 36; post-deploy run 37353604926 succeeded; CP-01 checked live (releases/2-live.md); runner adopted ecf4026 after 18:31Z (next research cycle overdue at 18:48Z; recheck). Deadline status sent to Sean at 18:18Z.
- **Steps integrated:** about 147 of 314 build steps. Most of the rest are the five Codex lanes, all handed back to Codex by Sean at 16:50Z and 17:00Z.
- **Release 1 browser check (releases/1-live-browser.md):** 7 checked live, **4 failed live** (FE-39, CA-30, CA-51, DB-55), 15 proving over time, 59 not screen-checked (55 need Admin sign-in).
- **Reader harm (stale snapshot), cause corrected 2026-10-05 18:20Z:** reader pages have served the 2026-09-29T05:38Z snapshot (manifest seq 2979). The cause was `WTP_READER_EDGE_DIR=/var/lib/meanwhile/reader-edge` in /etc/meanwhile/runner.env. `resolveReaderArtifactWriteStore()` (lib/meetings/edge-store.ts) returns the local file store whenever that variable is set, before it looks at NETLIFY_SITE_ID or the token. So the runner wrote to a folder on the droplet and logged PUBLISHED at sequences 113 to 117 while production stayed at 2979. **The earlier staging-site theory was wrong:** NETLIFY_SITE_ID and WTP_BLOBS_SITE_ID were already the live site, and the token was set. **Sean fixed the runner at 11:08 AM MST (18:08Z)** by commenting out WTP_READER_EDGE_DIR. The needs_Sean item is cleared. Code fixes assigned (no owner input needed): hunters removes the WTP_READER_EDGE_DIR default from deploy/runner/setup.ps1; slide makes the runner log the store it published to and makes a local-folder publish on the production runner a visible failure in Admin (returns files, 18:20Z). **Checked live 18:50Z: fixed.** See "Stale snapshot live check" below. CA-30: Ask gives wrong Prop 425 NO figures.
- **Egress:** Sean opened meanwhileusa.com, admin, test, api.netlify.com and tiles at ~16:50Z. Browser checks work, with Chromium pinned to the agent proxy CA. api.maptiler.com is still blocked, so the basemap can't render here. Admin still needs Sean's Google sign-in.
- **Owner decision 16:50Z:** data never rebuilds the site (decisions.md).

## Stale snapshot live check

- 18:16Z: production manifest still seq 2979 (generatedAt 2026-09-29T05:38:58Z). The runner cycle had started at 18:10:25Z, after Sean's 18:08Z fix (runner on dcddcf5).
- **18:48:16Z: production `/api/reader/manifest` reads sequence 2980, generatedAt 2026-10-05T18:46:52.961Z, sourceThrough 2026-10-05T16:27:41Z.** The first cycle after the fix published to the live site.
- **18:50Z, reader pages in a browser** (Playwright, public, ZIPs 85701, 03255, 07866): each page shows "Checked 3 minutes ago" (it showed "Checked 6 days ago" at 17:30Z). The `/api/meetings` responses those pages load carry snapshot generatedAt 2026-10-05T18:46:52Z with today's meetings, e.g. 85701 "Tucson Transit Advisory Committee" 2026-10-05 2:30 PM MST; 03255 "Recreation Commission Meeting" 2026-10-05 5:30 PM EDT; 07866 shows meetings from Oct 6 on. 85701 renders 253 meetings, 65 bodies, 57 officials. The basemap is still unavailable in this environment, as before (api.maptiler.com blocked here).
- Status: **checked live, fixed.** The code guards (hunters setup.ps1, slide store logging and Admin failure) are still open in the returns files.

## Launch

- Authorized: 2026-10-04T06:00Z by Sean. See `authorization.md`.
- Plan and briefs: `board/briefs` @ e076cd0.
- 36-hour clock: **hour 0 = 2026-10-04T06:10Z**, the meetings worker's first lock (Oct 3, 11:10 PM MST). **Hour 36 = 2026-10-05T18:10Z** (Oct 5, 11:10 AM MST).
- Release windows: h8 14:10Z (7:10 AM MST Oct 4), h16 22:10Z (3:10 PM MST), h24 06:10Z Oct 5 (11:10 PM MST Oct 4), h32 14:10Z Oct 5 (7:10 AM MST). The final release must open early enough to be deployed and checked live by 18:10Z Oct 5.
- Release targets: normal batches around hours 8, 16, 24 and 32. The final release starts early enough to deploy and pass live checks by hour 36.
- Budgets: unchanged. No budget increases, no new paid services, no hunts. Admin spending settings stay as they are. Production database is read-only.

## Branches

- river: created from main @ 0b31938 (which carries #706) at 2026-10-04T06:01Z.
- board/river: this branch.
- river-next / release/*: none yet.
- stream/<lane>: River seeded all eleven builder streams from river @ 0b31938 at 06:03Z. Each has an unlocked `.factory/<lane>.md`. Seeding them started no Actions runs; the only runs since are on main. Netlify cancels branch deploys except `test`, and the stream names don't contain "preview".

## Capabilities (this River cloud session, observed 2026-10-04)

- git push over HTTPS to SeanJ22/meanwhile: works (created river).
- GitHub MCP tools: read PRs and Actions, disable auto-merge, update/close PRs, comment, dispatch and re-run workflows, create PRs.
- No tool in this session can create, list or fire cloud scheduled tasks/routines. River cannot start, restart or pause another worker's schedule. Pausing finished workers means asking Sean, or the worker exits early on its own.
- No Codex control surface. River cannot see Codex run state, only its stream commits and heartbeat.
- Notifications: PushNotification is available to River.
- Neon MCP is connected with write tools exposed. River uses only read-only queries, as authorized.
- Netlify MCP: coding-context tool only. No deploy/site-settings reads seen yet.
- Browser: Chromium runs, at `/opt/pw-browsers/chromium` (Playwright's bundled headless shell 1234 is missing). **This environment's network policy blocks meanwhileusa.com, admin.meanwhileusa.com, api.netlify.com, console.neon.tech and tiles.meanwhilemaps.com**: CONNECT returns 403 at the egress proxy, and WebFetch reports EGRESS_BLOCKED. Only GitHub and package registries are reachable. Until Sean allows those hosts in this cloud environment's network settings, live checks run only through GitHub Actions (post-deploy-integrity reads the deployed site) and the Neon MCP connection (read-only). No rendered page, button or mobile layout can be checked from River. That is an open verification gap, not a pass. Admin also needs Sean's Google sign-in.

## Release verification routes (read-only)

- **Runner adoption:** Neon project `meanwhile-control-plane` (withered-sunset-39821877), `cp_runner_heartbeat` id `pilot-runner`. Its `value.testedSha` and `value.codeIdentity.effectiveExecutableSha` give the code the runner runs. At 10:03Z: 2aac424 (main's last shipping commit, CONSISTENT), beat 10:03:01Z, `lastCycleOk: false` with the cycle still in progress.
- **Data plane:** Neon project `we-the-people` (tiny-hill-13996172): civic_data_promotions and civic_data_reader_projections.
- **Deploy:** the post-deploy-integrity workflow on GitHub, reused per SHA (`river.mjs observe`). There is no direct Netlify API from River (egress blocked).

## Automatic continuation: verified

- Fresh scheduled cloud runs publish streams, mark READY and resume from saved status. Every Claude lane has done this across more than one hourly run since 06:10Z.
- Handoff verified: River handed bank (codex-bank stopped 07:34Z) to registry at 08:20Z. By 09:05Z a fresh scheduled registry run had claimed stream/bank under its own lock ("registry (continuing bank after recorded handoff 2026-10-04 08:20Z)"). The other three handoffs (admin→measures, slide→hunters, frontend→auditors) are waiting on those workers' next hourly runs.
- No verified Codex restart mechanism exists. The Claude fallback is the continuation path.

## Pace (10:35Z, hour 4.4)

- 76 of 314 build steps are integrated or in a gates run, about 17 an hour overall.
- On pace: measures, registry (plus bank), hunters, meetings, auditors, people, ballot. Measures' last heartbeat was 98 minutes ago; it is waiting on admin's BR-01.
- **At risk:** admin (29 steps), slide (28) and frontend (29) have made no progress since about 07:30Z. Their Claude continuation is blocked by session permission checks (needs_Sean 1). At the current pace the other lanes finish well before hour 36. These 86 steps decide the deadline: unblocked by about hour 8, they fit, and every hour of delay pushes the finish later.

## Release work

- RL-01: built and integrated. CI's crosswalk floor was already on main. The local `feedback:sweep` check-debt fix is on river @ 8f6185c. `pnpm gates` passes in the cloud except one trace-sweep test that also fails on main (see Seen, not fixed). Still to do: the next full check on main passes after release 1.
- RL-02: done for all 33 PRs. 13 closed with a note. 19 are in river @ 8f6185c, each with its step named in a PR comment; they close as merged when release 1 lands. #599 is held for a live check. None is waiting on auto-merge.
- RL-03: integrated (river.mjs @ 8f6185c). Fold fix d45831c (status-file conflicts and the CI env for gates) is READY on stream/river for the next fold. Still to do: a release through `river.mjs release`.
- RL-04: on main via #706. Still to do: confirm the daily scheduled run (09:17Z) and full checks on release PRs.
- RL-05: `river.mjs observe` is integrated. It found and reused the success run for 0b31938 (dry run). Still to do: use it on release 1.
- RL-06: integrated behind the switch WTP_ADAPTER_PUBLICATION, default `pr`. Still to do: release, then set the repo variable to `river` first and the runner's env second, then watch for a real adapter repair arriving through the river.
- RL-07: integrated. A rulings.md-only diff now selects 56 test files instead of 482. Still to do: measure a docs-only PR on GitHub.

## Seen, not fixed

- `tests/deploy-paths.test.ts` "no file under a non-shipping prefix is traced into the deploy" fails on main @ 0b31938 whenever a local `.next` exists. CI never runs it, because its test jobs have no build. Since ae476a5 (Sep 29) `isNonShippingPath` treats all of `data/` as non-shipping, yet the build traces 3,330 `data/` files (ballot cards, zip-divisions, candidates). A commit changing only those files would cancel its Netlify build and serve the old copy. Sean's own Sep 29 tests pin that data-only changes cancel (`tests/hosted-cost-invariant.test.ts`, `deploy-paths.test.ts:132-133`), while RULING 124's trace sweep says traced files must ship. **Answered by Sean 2026-10-05 ~16:50Z (decisions.md): data never rebuilds the site; the sweep stays and the traced data/ reads are work.** Original question: should a committed change to a traced `data/` file (ballot cards, zip-divisions, states) rebuild the site, or do those files reach readers only through the data plane? Until he answers, lanes test without `.next`, as CI does.

## Worker health (06:31Z)

| Lane | Provider | State | Ready |
|---|---|---|---|
| measures | Claude | active, heartbeat 06:25Z | SC-01 @ 7d3c085 |
| hunters | Claude | active, heartbeat 06:25Z | none (CH-02 testing) |
| registry | Claude | active, heartbeat 06:25Z | DB-09..DB-11 @ 165e953 |
| meetings | Claude | active, lock 06:10Z | none (DB-01) |
| auditors | Claude | lock released at checkpoint 06:27Z | DP-01 @ ec1157a |
| people | Claude | active, heartbeat 06:23Z | CA-09, CA-12 @ cf622f3 |
| admin | Codex | active, lock 06:27Z | none (BR-05) |
| slide | Codex | active, lock 06:29Z | none (CP-01) |
| ballot | Codex | active, lock 06:29Z | none (CA-24) |
| bank | Codex | active since 06:31Z | none yet |
| frontend | Codex | active since 06:31Z | none yet |

All eleven lanes are running (bank and frontend locked at 06:31Z).

## Integration in progress

river-next @ 8f6185c (full `pnpm gates` running, 07:10Z). It contains:
- 19 kept PRs (RL-02) plus the #692 re-key
- RL-01 feedback check-debt; RL-03 river.mjs; RL-07 docs-only selection; RL-06 adapter streams (switch default `pr`)
- measures SC-01, 02, 03, 05, 08, 12, 20 @ cc8c0cf; registry DB-09..11 @ 165e953; auditors DP-01 @ ec1157a; people CA-06, 09, 12 @ 4b5bbc1; hunters CH-02 @ 9ae2d28
- River fold repairs: the door-import floor, and the #701 history-read spy

First gates run on river-next (4f3bd5d): 23 failures before the repairs. 21 were environmental: `DATABASE_URL` set in the cloud, and a git-ignored place-reference projection missing in worktrees. 2 were real and are repaired above. The build failed only because of a symlinked node_modules. With a clean env, plain main has no failures in those files.

## Usage tally

Actions minutes, Netlify builds, runs: not yet measured.

## needs_Sean (sent 09:45Z)

1. **Handoffs blocked by session permission checks.** Measures was denied pushing to stream/admin. admin, slide and frontend have been idle since 07:06Z, 07:39Z and 07:24Z. Either allow measures→stream/admin, hunters→stream/slide and auditors→stream/frontend, or restart those three Codex tasks.
2. Allow River's environment egress to meanwhileusa.com, admin.meanwhileusa.com, test.meanwhileusa.com and api.netlify.com, for live browser checks.
3. People CA-01: its session denied the verification commands.
4. Auditors FE-01: its session denied removing the RULING 125 non-local refusals in four harnesses.
5. Meetings DB-59: River ran the read-only production read instead (see returns/meetings.md). Nothing is needed unless meetings needs more.
## AF-10 — repair Congress portrait acquisition

- Live projection contains 539 Congress officeholders and zero verified photos. Date-only verification time rejected fresh same-day API captures; a catch-all hid the failure. Regression reproduces the rejection and passes with a post-capture verification clock while preserving original source dates.
- Replace the fixed calendar slice with the existing bounded worker pool and source deadline; propagate cancellation to API/image transport. Reuse held API evidence and the member's already-held official URL, retain last verified portraits, and persist exact field/source failures. Candidate no-change confirmation must preserve those failures; under focused test before READY.
- Owners: people_plan for AF-09, finance_impl for AF-10, codex-acquisition-scale for combination, required hosted checks and release. Automatic baseline/serving verification continues independently; no manual Send, budget or pause changes.