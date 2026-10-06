## New returned fold — prepared WIP, not READY

- Stream caught up to promoted River `8b6322c98c5639f5cabd9de205f7baad147c31b6` at `99adffb05`.
- Returned `fix:5abe56f2`, exact pending screen batch `2861b8fe841f2a4a68a39a2a89f9b01241753da7`; it is not promoted at the final fetch. Only promoted River was merged into stream/admin.
- Local checked combination `7f2a3390c89c875ca015853067b6623df1ac6e66` in `/tmp/meanwhile-admin-return-fold`: types PASS, 222 focused PASS, 0 FAIL, 0 SKIP; 34 files saved in `.factory/admin-return-tests.txt`. Lint on reconciled screens/types: 0 errors, 2 existing warnings. Logs `/tmp/meanwhile-admin-return-trial-{types3,focused,lint}.log`.
- Initial mechanical merge revived deleted controls and instruction state outside marked hunks; initial types failed. Restored Admin's files where pending batch made no change, then applied the batch's actual diff to Details and sample data. Types and focused checks pass after that repair. New look/Testing features and plain-words/decision/schedule behaviors coexist.
- Valid affected selector (`CI_TIER=yes CI_EVENT_NAME=pull_request`, full base SHA, network-enabled child Git): FULL because 522 changed files exceed 400. `/tmp/meanwhile-admin-return-trial-selection.log`. FULL and `pnpm gates` deliberately remain outstanding until the prerequisite batch promotes. This combination is WIP, not a clean FULL or READY claim.
- `.factory/admin-return-overlay.patch` preserves the complete application overlay from the exact pending batch to the tested combination, including binary patches; reverse `git apply --check` succeeds on that combination. Do not blindly apply it to a changed batch. No unpromoted application commit was pushed, only the saved coordination artifact.

# Admin WIP check evidence

Historical checkpoint evidence follows; each result applies only to its named SHA. Current READY and check evidence are recorded in the latest sections and admin.md. No deployed/live acceptance is claimed.

Application checkpoint: `916e446c73f8a2787fc7147cd48d9c01245c23aa`. The subsequent handoff commit changes coordination evidence only.

## Passing checks at the application checkpoint

- TypeScript: `pnpm exec tsc --noEmit --pretty false`, exit 0.
- ESLint: all 17 changed application/test files, exit 0. The earlier whole-repository lint at `2f071c07d3f1d7711eea3a5dfe547196fa9587dd` also passed (69 warnings, zero errors).
- Supplemental focused checks: `pnpm test` with **actual newline-separated** `CI_TEST_FILES` containing `tests/admin-history-page.test.ts`, `tests/admin-runner-confirmation.test.ts`, `tests/admin-settings.test.ts`, and `tests/execution-accountability-admin-v6-history.test.ts`. 24 passed, zero failed/skipped. Runner header records SHA `916e446c73f8a2787fc7147cd48d9c01245c23aa`.
- `git diff --check`: passed.

Commands use `PNPM_HOME=/tmp/meanwhile-admin-pnpm`, `XDG_DATA_HOME=/tmp/meanwhile-admin-xdg`, and pnpm options `--config.verify-deps-before-run=false --config.manage-package-manager-versions=false` to avoid an unwritable home cache. The installed dependencies were retained. Test processes alone set `DATABASE_URL=` and `WTP_CONTROL_PLANE_DATABASE_URL=` to keep fixtures isolated; cloud credentials/configuration were not changed.

## Required full selection: incomplete, not passing

Selector: `decide({root, tier:'yes', eventName:'pull_request', base})` from `scripts/ci-affected-tests.mjs`.
Base (merge base with river): `0b31938f52ae18ae783cff9b9ddc1df11388cc4a`.
Result: FULL, because `.factory/admin.md` is not a code path followed by the import graph. Full run contained 987 files; no `CI_TEST_FILES` override was used.
Tested source SHA: `2f071c07d3f1d7711eea3a5dfe547196fa9587dd`.
Run stopped with exit 130 after 18 observed failures. It was not completed and cannot justify READY. The focused four-file supplement does not replace this FULL selection.

The earlier full run at `2a502155894986b4cedfc5a5a8b7baaa783da885` was also interrupted after inherited database configuration made Ask fixture tests time out. Disabling database access for the test process made the exact failing agenda test pass. The later run fixed that isolation problem but still encountered the failures below.

Chromium build 1234 is absent. Standard `playwright install chromium` with a writable `/workspace/.cache/ms-playwright` destination failed: `https://cdn.playwright.dev/builds/cft/151.0.7922.34/linux64/chrome-linux64.zip` returned **403 Domain forbidden**. No network-policy bypass was attempted. River's existing browser-enabled environment is a possible verification path.

Observed failures (incomplete run):

- every generic control reset lives in the recipe layer; the state classes never do (13.708898ms)
- POSITIVE CONTROL: re-appending the #281 reset makes the structural check fail (0.09055ms)
- class-wide: every focusable console control shows a keyboard focus indicator (0.070552ms)
- POSITIVE CONTROL: a shell control whose focus indicator is taken away is caught (0.062928ms)
- class-wide: the runner card's grade band keeps its colour on hover and while focus is inside it (0.084729ms)
- the v6 history shows a pause as done only once the runner honored it (0.715642ms)
- an already-mounted v6 adapter picks up readiness, scoped changes and a brief disconnect without reload or mutation (122.128351ms)
- a context from the shared site cannot write an undeclared row (9.540375ms)
- an unguarded context leaks — the plant that proves the test can fail (2.380913ms)
- an UNLOAD beacon carrying no header is still recorded as synthetic (1.463975ms)
- the browser resolution is stated, never silent (0.967534ms)
- what this repo resolves is the file playwright would actually launch (0.50643ms)
- no file under a non-shipping prefix is traced into the deploy (85.969061ms)
- RULING 92: a PURE generator's artifact is byte-identical to what it produces now (104.285279ms)
- THE PLANT: a guarded synthetic browser with a configured key does reach MapTiler (9.954621ms)
- THE BARRIER: the same page, the same key, and nothing reaches the provider (2.575098ms)
- the environment alone cannot open the barrier, and neither can the option alone (2.488435ms)
- the ceiling is hard, and a run that blows it fails rather than reporting a result (1.949695ms)

The in-memory history adapter failure was repaired in the application checkpoint and the existing runner-confirmation test now passes in the 24-test focused run. Browser, build-trace and generated-artifact failures remain seen-not-fixed for River. Trace input `.next` was pre-existing; no current build or live Admin verification is claimed.

## 2026-10-05 Codex BR-07 verification

Exact tested READY SHA: f2ca419ef23849c4c941fc7f6b78752ed9727e97. River baseline: ecf402600401783b094837c29e0c515eadbdb843.

- `env -u DATABASE_URL -u WTP_ASSET_STORE COREPACK_HOME=/tmp/meanwhile-corepack corepack pnpm exec tsc --noEmit`: PASS.
- Same environment, `pnpm exec eslint .`: PASS, zero errors, existing screen-now unused N warning.
- Same environment, pnpm test selection admin-v6-ui/v6-ui.test.tsx and live-sync.test.ts: 37 PASS.
- `CI_TIER=yes CI_EVENT_NAME=pull_request CI_BASE_SHA=<merge-base with origin/river> node scripts/ci-affected-tests.mjs`: FULL (coordination markdown outside code graph).
- Same environment `pnpm test` at the exact READY SHA: 9,360 tests; 9,334 PASS; 16 could-not-run browser failures; 10 SKIP. Missing Playwright browser build 1234; no build root. Every failing file was repeated on untouched origin/river with the same missing-browser failure. The recent-vote expansion file leaks its fixture server when launch fails before try/finally, on both branches. Terminated only that stuck FULL test worker to finish the run; baseline bounded at 20 seconds. The timing artifact is incomplete and not scheduling evidence. No new code failures.

Local logs: /tmp/meanwhile-admin-ready-types.log, ready-lint.log, selection-network.txt, ready-full-network.log; baseline-browser.log, baseline-other-browser.log, baseline-beacon.log and baseline-vote-browser.log, all with the prefix /tmp/meanwhile-admin-. The publication includes this exact summary so a later environment need not have local files. Full logs remain local; no credentials were printed.

Only stream/admin is published. No PR, main/river push, auto-merge, production data write, spending change or notification.

## BR-04/11/26/35/36/39 final evidence (2026-10-05 19:30Z)

- Exact foldable READY: `5f83a8c646140309545da256ed704cc654254d76`. BR-36 only READY with River writer/schema/migration hook pending. SQL is under `lib/db/pending-migrations/BR-36_admin_history_registered_kinds.sql` to keep unnumbered SQL out of the applied journal.
- FULL exact application checkpoint `2c0c34018913da3c58d83a856d3888893923b032`: 9,366 tests, 9,339 PASS, 10 SKIP, 16 could-not-run pinned-browser failures, plus the unjournalled migration-file failure. Same 16 browser failures already independently compared to plain river `ecf402600401783b094837c29e0c515eadbdb843`. The recent-vote child leaked its fixture server after missing-browser launch (the same baseline bug); terminated only confirmed PID 47677 after >60s so FULL could finish. No timing artifact is usable.
- The diff from that FULL SHA to final READY is only a byte-identical migration-file rename and status heartbeat. Exact READY: `env -u DATABASE_URL -u WTP_ASSET_STORE COREPACK_HOME=/tmp/meanwhile-corepack corepack pnpm exec tsc --noEmit` PASS; exact failing gate plus registered-history coverage through newline CI_TEST_FILES `tests/write-alarm.test.ts`, `tests/admin-history-registered.test.ts`: 19 PASS.
- Other focused coverage: 146 PASS; final fix honor/migration 9 PASS; all Admin views including planted raw codes outside Technical details 23 PASS; projection/atomic/cause 48 PASS. Targeted changed-file eslint: 0 errors, 29 warnings.
- Logs in this cloud: `/tmp/meanwhile-admin-batch-full.log`, `batch-migration-fix.log`, `batch-final-types.log`, `batch-lint.log` (each prefixed `/tmp/meanwhile-admin-`). No live DB write, browser acceptance, budget increase, or policy change claimed.

## Hunt / typed-order source candidate FULL (2026-10-05)

- Exact tested application SHA `aafb09a5e635e25fd9655d3511996a0dc8c37b43`: types PASS, changed-file eslint 0 errors/1 existing unused API_FALLBACK_MISSING_SEAM warning, focused 67 PASS, actual selector FULL. FULL 9,375 total: 9,349 PASS, 16 missing-browser could-not-run, 10 SKIP, no code failures. Same pinned-browser cases verified on baseline ecf402600 previously. Confirmed leaked recent-vote child PID 66936 terminated after >=20s; timing incomplete/unusable. Log `/tmp/meanwhile-admin-orders-full.log`.
- That unpublished candidate's commit message was changed from READY to WIP (`40a502710aeead62ccee83446cc100cfa455ad9d`, application-identical) after a follow-up planted receipt-face test exposed DONE + in-progress confirmation falsely reading Done. The fix and its test are included in next WIP `5041904e7c575efd6896da35c82f18e4bc49b71b`; do not claim the prior candidate final READY. Original exact test SHA remains preserved in the old `/tmp/meanwhile-admin-orders` worktree and this evidence.
- BR-20 focused approval/replay/decline/change/schedule/stale/agent refusal/ET/calendar/removal coverage 115 PASS; combined sequence/capability/chat/UI 130 PASS; scheduled-future status 29 PASS. Final source changed after these, so exact WIP checks are next.

## Final saved candidate, 2026-10-05 20:15Z — blocked by returned fold

No fresh READY is published. River returned the earlier 5f83a8c646140309545da256ed704cc654254d76 and f2ca419ef23849c4c941fc7f6b78752ed9727e97 for conflicts with incoming measures BR-14/23/25. Return fix:fc3f3f9a at 20:08:25Z requires catching up only after that batch is promoted to river, preserving measures Queue/Scoreboard/Now, connecting Admin controls and repeating checks. Last fetch 20:15Z: river/main still ecf402600401783b094837c29e0c515eadbdb843; board/river 250908c34c1a5c37106588ef3168cbb61bf20686. This is the remaining dependency, not missing credentials or an owner decision.

Exact corrected application source: 94d8f817fc5082a922ce45fa70777665b7aa2cb9. The current published stream application is byte-identical; later commits only change .factory evidence. It contains BR-13/18, BR-12/16 corrections, BR-20 (team raising/Queue hook pending), BR-35 follow-up, and the generic BR-19 library (required school/candidate example BLOCKED on BR-22, not claimed READY).

- Actual selector: CI_TIER=yes CI_EVENT_NAME=pull_request CI_BASE_SHA=ecf402600401783b094837c29e0c515eadbdb843 node scripts/ci-affected-tests.mjs => FULL. Rechecked on corrected stream: FULL, because coordination Markdown is outside the import graph.
- FULL exact frozen SHA 904ca03062e87f87b8580ad8f9f270d24099489a: 1,074 files; 9,384 tests; 9,356 PASS; 18 FAIL; 10 SKIP; 0 cancelled. Sixteen failures could not run because pinned Chromium build 1234 is absent, matching the already reproduced plain-river browser baseline. Two own failures: absence-defaults and admin-select-contrast. They are repaired at 94d8f817f. FULL is not reported as passing.
- Diff from FULL application to corrected source is exactly four UI files: action-dialog.tsx (use existing select style and a neutral note label), actions.ts (neutral recommendation heading), decision-orders-panel.tsx (accepted-order sentence depends on stored child receipt), v6.module.css (pin select/popup dark scheme). No test weakening or baseline-list expansion.
- Exact corrected 94d8f817f: env -u DATABASE_URL -u WTP_ASSET_STORE COREPACK_HOME=/tmp/meanwhile-corepack corepack pnpm exec tsc --noEmit => PASS. Changed-file lint on the new decision/dialog changes => PASS, zero errors/warnings. Whole changed-file lint before these four corrections => zero errors, 29 existing warnings.
- Exact corrected 94d8f817f: same environment corepack pnpm test with actual newline CI_TEST_FILES for absence-defaults, admin-select-contrast, admin-decision-orders, admin-sequenced-orders, admin-hunt-completion, admin-scheduled-completion, admin-plain-orders, operator-chat, admin-action-gateway, admin-runner-confirmation, admin-capability-pulse, admin-redirect-origin and admin-v6-ui/v6-ui => 148 PASS, zero failed/skipped. Includes simultaneous owner decision plant (only one child order), true hunt completion, in-progress receipt face, future schedule status and focus-filter refusal.
- Full history; regenerated place references; no .next; unset DATABASE_URL/WTP_ASSET_STORE for all tests. Confirmed leaking reader-recent-vote-expansion worker PID 86042 terminated only after 64 seconds, after identical baseline leak evidence. Timing artifact explicitly incomplete and unusable; no browser/live acceptance claimed.

Local logs /tmp/meanwhile-admin-final-full.log, final-full-termination.txt, final-focused.log (139 PASS before four-file correction), final-fix-focused.log (148 PASS exact corrected source), final-fix-types.log, final-lint.log, final-fix-lint.log, final-selection.log, final-fix-selection.log. Summary and exact SHAs are saved here for another environment; local logs are supplemental only.

No main/river push, PR, auto-merge, production data action, budget change or notification. Lock is released only because all own ready work is saved and the returned repair plus remaining steps await the recorded integrated prerequisite.

## 2026-10-06 resumed Admin batch (current final FULL still running)

- Preserved original FULL `0212ba41a6c26103ffe971fb19f1aa2f086bcd27`: 9,499 total, 9,471 PASS, 18 FAIL, 10 SKIP. Two own history/receipt assertions repaired at c4b70f7ee; sixteen failures were absent pinned Chromium1234. Corrected FULL `e4d37d2ef74a76a8c7e97ea2dc85ae0f1a0ac564` completed: 9,500 total, 9,474 PASS, 16 could-not-run browser failures, 10 SKIP. No clean FULL PASS claimed.
- Later midnight guard prevents an older Eastern-day tick replacing a newer brief (reproduced negative control, then fixed). Native installed PS1 uses plain Node strip-types and no alias loader: baseline scheduled-fire import passed, own alias import failed, corrected at `8d16cc59dac08e1d6dbf7e3822f096b9b237553f` with relative imports/shared pure stuck population. Exact native source types PASS; 210 focused PASS; new lint clean. Native child-process regression verifies the real launcher flags and a saved daily brief.
- Returned fold repair preserved real promoted River Now/Queue/Scoreboard, then integrated promoted186f747 BR-34/owed overlays. BR-34 retires Work's duplicate lists; BR-35 removes its never-announced workRows. Legacy Work opens Queue. Receipt details/send progress stay on Queue; dead controls/manual fix dispatch remain removed. Original tested checkpoints remain in history.
- FULL exact promoted-merge source `e731f20910422f372193b23bc7b0245cab085ab1` completed: **9,616 total, 9,590 PASS, 16 could-not-run missing-browser failures, 10 SKIP**. Types PASS; focused157 PASS plus26 narrow/first-open/promoted/plain-faces PASS. Canonical command `env -u DATABASE_URL -u WTP_ASSET_STORE COREPACK_HOME=/tmp/meanwhile-corepack corepack pnpm test`, no CI_TEST_FILES override for FULL, full history, rebuilt place references, no .next. Source river186f747 and current ae07521f8 have identical application trees.
- Same six failing browser files independently repeated on plain river186f747: admin-readiness-cell-state (five before-hook failures), admin-v6-ui/mounted-live-transition, beacon-guard, chromium-pin, maptiler-barrier, reader-recent-vote-expansion. The first five: 25 total, 10 PASS, 15 FAIL, pinned1234 missing. Sixth: identical missing-browser launch. Baseline leaked only recent-vote workerPID140686; bounded termination after166s. Merge FULL identical test blob leaked workerPID150626, bounded termination after96s. Timing artifacts incomplete/unusable; never used as scheduling evidence. No browser, build, deployed or live acceptance claim.
- Money owner-return addendum changed the path: Admin now reads only `ownerSnapshots.current {spendSummary:true}`; its publisher helper builds the measured vendor/spend and daily per-project transfer summary. Missing summary is UNREAD. No raw-table/provider API fallback on refresh. River owns the publisher call, distinct live holds and measured transfer causes (exact shape under needs_hook/needs_River). Native plain-Node import of River's readSpendSummary helper PASS.
- Required FULL of final-summary source `2438cea5f699d1cc56022970aa0e5c16d0644a2d` still running. A new label used the retired product name; own failure fixed at `d23827b48997fa7a2d058ebcfae6086c04b18443` by changing only that display label to Civic database. Exact repaired source: types PASS, focused191 PASS (28 files, actual newline CI_TEST_FILES including brand and summary reader), repaired-file lint 0 errors/warnings. Whole changed source lint (excluding deleted files): 0 errors, 25 existing warnings. Final FULL summary and READY SHA will be appended when finished.

Logs preserved locally under /tmp/meanwhile-admin-: oct6-ready-full.log, oct6-final-full.log, oct6-native-focused.log, river4-full.log, money-final-full.log, river4-baseline-browser.log, river4-baseline-vote.log, river4-vote-terminations.log, summary-all-changed-lint.log, brand-fixed-focused.log, brand-fixed-types.log, brand-fixed-lint.log. Frozen test worktrees preserve the exact source SHAs. No production write, budget/policy change, PR or main/river push.

## Final-summary FULL completed — 2026-10-06 01:37Z

Exact frozen source `2438cea5f699d1cc56022970aa0e5c16d0644a2d`: **9,619 total; 9,592 PASS; 17 FAIL; 10 SKIP**. Sixteen are the six absent-pinned-Chromium files independently reproduced on plain river186f747 (identical application tree to current river ae07521f89627dd3a20e46f34c23489e6c83a01f). The seventeenth is `tests/brand.test.ts` old-name literal in the new project label. Fixed only that literal at `d23827b48997fa7a2d058ebcfae6086c04b18443`: exact types PASS, 191 focused PASS including all brand gates, repaired-file lint clean. All changed-source lint: 0 errors, 25 existing warnings. No further application delta from that FULL. Actual selector with full merge-base SHA `ae07521f89627dd3a20e46f34c23489e6c83a01f`: FULL because coordination Markdown is outside the code graph. No empty/invalid affected selection was used as passing evidence.

Final-summary FULL confirmed leaked recent-vote workerPID164563 terminated alone after124s; parent reporter proved the frozen worktree and its test blob matches the failed baseline. BaselinePID140686 after166s; prior merge FULL PID150626 after96s. All timing artifacts incomplete/unusable. FULL is completed with these limitations, not called a clean PASS; browser/deployed acceptance belongs to River. Ready evidence follows with exact READY SHA. No active full-test worker remains.

## Exact published READY — 2026-10-06 final

**READY `3d99e412033016f75f30f52cc5a650e6bfbd175b`**, pushed only to stream/admin. Steps: BR-07 BR-04 BR-11 BR-26 BR-35 BR-39 BR-36 BR-12 BR-13 BR-18 BR-20 BR-16 BR-17 BR-27 BR-29 BR-28. BR-20's actual team recommendation raiser and BR-36's writer/schema/migration are hook pending; Money owner-return summary is hook pending River's publisher/live-hold/transfer inputs, with exact requests in admin.md. BR-19 is not READY: its required example waits BR-22 integrated kind preservation/enforcement.

On that exact READY SHA (canonical runner header confirms the SHA): `env -u DATABASE_URL -u WTP_ASSET_STORE COREPACK_HOME=/tmp/meanwhile-corepack CI_TEST_FILES=<actual newline paths> corepack pnpm test`: **191 PASS, 0 FAIL, 0 SKIP**, 28 files including controls, Queue/Scoreboard, When, daily/native timer, summaries/vendors, branding, first-open/narrow reads and plain problem faces. Same environment `pnpm exec tsc --noEmit --pretty false`: PASS. No application diff from exact repaired d23827b48997fa7a2d058ebcfae6086c04b18443; only display-label delta from completed FULL2438cea5f699d1cc56022970aa0e5c16d0644a2d. Source lint evidence above retained (0 errors/25 existing warnings, repaired file clean). No browser/FULL clean PASS or deployed/live claim.

Final fetch: river/main ae07521f89627dd3a20e46f34c23489e6c83a01f, Codex still assigned admin; no BR-22 or Money live-hold/summary publisher integration yet. No own step remains ready. Lock released in following status-only commit; exact READY remains foldable. Runtime credentials are not printed, changed or invented. No main/river push, PR, auto-merge, spending/policy change, production write or notification.

Exact-ready local logs: /tmp/meanwhile-admin-final-ready-focused.log and final-ready-types.log. Frozen FULL logs/source checkpoints and previous evidence are preserved. Next worker resumes from this branch and River's return; Sean need not restart it.

## Release7 repaired screens and corrected cost priorities — active exact WIP

Source ef9d902e9b0f27b6e4dfe39fb23d29d4bc7f74ad, merge parents preserve prior checkpoints. Promoted River f545fcf9493def91294bccf219ed65071b2093b1; board assignment Codex. Actual selector FULL (coordination Markdown outside import graph). Exact focused canonical run 267 PASS, 0 FAIL, 0 SKIP; 36 actual newline paths (existing 34 + operator-chat + admin-cost-reporting). Log /tmp/meanwhile-admin-cost-exact-focus.log, frozen .scratch/ci/test-affected.*. Diagnoses fixed absence-to-assertion display defaults and EDT expectation; Money UI regression verifies a single Hunts table with allocated cost, measured set-aside and saved limit, EDT, batch split and withdrawn no-result display absent.

Frozen /tmp/meanwhile-admin-cost-gates uses a real contained node_modules (Next cannot build with the outside symlink), regenerated ignored place references, no .next before cold checks, env -u DATABASE_URL -u WTP_ASSET_STORE; COREPACK_HOME=/tmp/meanwhile-corepack. PATH points to executable pinned pnpm10.33.0 shim for nested gates (otherwise system pnpm11.19). pnpm gates is running, preflight PASS. Complete gate and FULL results must be recorded before READY; do not call this WIP green. Browser install into writable /tmp/meanwhile-playwright returns403 Domain forbidden from cdn.playwright.dev. Repeating the six browser files on exact current River, preserving result separately. No live/browser claim or spending/control/owner-policy change.

Gate progress: preflight/lint/types/control-plane:gate/state-holdings:check/state-manifest PASS. feedback:sweep failed because ADM-20 cited the retired planFixQueue test, not a code fault; approved plan BR-03/BR-04 retires that path. Preserved original owner report and added checkDebt with its retirement reason, so the old verified claim stops counting. Fresh corrected feedback:sweep PASS; tests/feedback-sweep, admin-feedback-9-4-pm, workers-screen and now-screen **45 PASS**, including a new measured Now regression. Five original FULL UI failures are stale expected strings: one old Now placeholder, four Workers ET expectations now EDT. Corrected only tests and feedback bookkeeping: application bytes match frozen ef9d902e9.

Current River f545fcf9493def91294bccf219ed65071b2093b1 baseline six browser files: 26 total, 10 PASS, 16 missing-pinned-Chromium failures, 0 skipped. Same names as earlier baseline. Recent-vote worker177772 bounded SIGTERM after84s with exact filename and parent reporter path checked; fixture launch had failed and server leaked. Timing incomplete/unusable. Logs /tmp/meanwhile-admin-release7-browser-baseline.log and /tmp/meanwhile-admin-cost-vote-terminations.log. No clean FULL/browser claim.

Corrected WIP a54fdc35e (exact full SHA below in final record): types PASS; 312 focused PASS, 0 FAIL, 0 SKIP across 40 files listed in .factory/admin-cost-ready-tests.txt. These include the updated Workers EDT expectations, missing/measured Now, feedback record semantics, old Admin controls/Queue/Scoreboard, billing/summary correctness, and explicit paid NOTHING cause deduplication. `git diff ef9d902e9 HEAD -- app lib scripts package.json pnpm-lock.yaml` is empty: no application delta from frozen FULL/build source.

Frozen FULL ef9d902e9b0f27b6e4dfe39fb23d29d4bc7f74ad completed: **9810 tests, 9778 PASS, 22 FAIL, 10 SKIP, 0 cancelled**. Sixteen failures match six absent-pinned-browser baseline files on exact promoted River f545fcf9493def91294bccf219ed65071b2093b1. Six own test failures repaired on stream: Now old placeholder1, Workers old ET expectations4, rollback test's old whole-log error mock1. Rollback now mocks readWhere (the actual narrowed findReceipt path), retains assert.rejects and zero provider POSTs: 10 PASS. Current River same rollback file10 PASS (old helper used .read); this is an own fixture adaptation, never attributed to baseline. No receipt behavior/budget/restore authority was weakened.

Confirmed frozen FULL recent-vote worker191078 had the exact case argument and parent reporter destination; bounded SIGTERM after111s for the same missing-browser fixture-server leak. Timing incomplete/unusable. Canonical FULL outputs frozen .scratch/ci/test-shard-1-of-1.log/.json/.timings.jsonl. Gate db:gate PASS; default build and standalone gates still running. Latest app delta from frozen FULL is only three whole-factory captions across two files, changed lint clean; final exact READY types/focus will verify those captions.

Completed pnpm gates machine record saved verbatim at .factory/admin-cost-gate-run.json (testedSha ef9d902e9). PASS: preflight, lint, cold types, control-plane:gate, state-holdings:check, state-manifest, db:gate, default build65s, test:bundle, standalone build15s. **9/12 gates green** on that frozen source; feedback:sweep was repaired as above and fresh corrected sweep PASS. assert:browser and FULL remain failed for missing Chromium plus six corrected test-only failures; never labelled clean. Final application delta is only whole-factory captions, not module imports, SQL or aggregation. Final exact source checks include all those captions and all six corrected cases. No release/live action or owner decision requested.

## Final source before READY

Exact source **d276f66bf2530b5d9ac75980d474e0b188118381**: types PASS; **322 focused PASS, 0 FAIL, 0 SKIP** across 41 actual paths in admin-cost-ready-tests.txt, canonical runner header confirms SHA. Fresh final scope captions included; meaningful measured Money/Now, flow boundaries, all corrected cases and rollback receipt-read failure probe pass. Exact source logs /tmp/meanwhile-admin-cost-final-source-types.log and final-source-focus.log. No additional full run for only three display captions and test/feedback corrections; original complete FULL and both builds above retained with their exact source SHA and limits. READY gets an exact-SHA check/evidence record next; metadata does not alter application.

## Exact READY and final continuation

**READY 734ee9633567651c94a6bb12a0628c7b965a4102**, pushed only stream/admin while current assigned Codex and holding unique lock. Exact READY types PASS; canonical 41-file run **322 PASS, 0 FAIL, 0 SKIP**; runner header and .scratch/ci/test-affected.json confirm exact SHA. No application/test/data delta from d276f66bf; READY commit only updates .factory metadata. Supplemental logs /tmp/meanwhile-admin-cost-exact-ready-focus.log and exact-ready-types.log. Durable machine summaries admin-ready-evidence.json and original admin-cost-gate-run.json preserve the honest FULL/build source split and browser limitations.

Final fetch River/main f545fcf9493def91294bccf219ed65071b2093b1, board/river4d27f8be4dd4e57798cea06a16257318f22cc80b; assignment still Codex. Corrected return unchanged. No BR-22 exact filtering, summary publisher/flow-start or paid-ending producer landed. All independently ready Admin work complete; hook requests exact under needs_hook/needs_River, no missing Sean decision. One status-only WIP follows READY to store exact SHA/evidence and release ownership. Never fold later WIP. No main/river push, PR, auto-merge, production write, hunt start, budget or owner-policy change.
