# Admin WIP check evidence

No ready SHA. No step is claimed complete, integrated, deployed or checked live.

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
