# Ballot evidence and fold boundary

Launch is recorded in `board/river:authorization.md` at 2026-10-04T06:00Z. Only stream/ballot was pushed. No PR, production mutation, collector run, hunt, spending change or service creation occurred. Requested model: GPT-6.1 Sol; actual selected worker model is not exposed in this session.

## Exact READY candidate

- SHA: `bfc11e7b5ad94530244900c9c1a158427ad65a92`.
- Subject: `READY: CA-24 CA-20 CA-30 CA-44 CA-45 CA-51; returned Ask hooks`.
- Local certification checkout: `/workspace/meanwhile-ballot-ready-check`, detached at that exact SHA with a clean tracked tree.
- Publication: exact candidate now included in stream/ballot history after all checks passed; later CA-35 WIP stays outside its source tree.
- FULL: `env -u DATABASE_URL -u WTP_ASSET_STORE -u CI_TEST_FILES -u CI_TEST_SHARD corepack pnpm test`, **PASS**, exit 0: 9124 tests, 9113 passed, 0 failed, 11 skipped, 32 suites, 1597328.412713 ms. 1004/1004 test files selected, as printed by the canonical command. Log: `/tmp/ballot-ready-full.log`.
- Types: `corepack pnpm exec tsc --noEmit`, exit 0. Log: `/tmp/ballot-ready-types.log`.
- Lint: `corepack pnpm lint`, exit 0, zero errors and 68 warnings. Log: `/tmp/ballot-ready-lint.log`.
- Selector: actual merge base with then-current origin/river c7914e8a89f79931c2a946dd8be6d41e9f4a570c, source base `8f6185c5436b2be939c0333101713b6b5263e730`. FULL selected; `needs_browser=true`. Log: `/tmp/ballot-ready-selection.log`. River advanced afterwards; that does not change this tested source SHA.

CA-31/32, CA-49, and CA-21 are explicitly partial code included in the tested source tree; they are not named as completed steps. CA-35 polling-door WIP at `1f87e3190` is outside the candidate and must not be folded with it. River's `pendingReady` selects the newest READY subject and folds exactly its SHA; later source/status commits remain on the stream.

Returned hooks in this batch: CP-01 Ask address privacy checkpoint `812f894166134c2c1bc56ed3ae8e8347d74850e9`; CA-12 own-words connection checkpoint `f8c75b01c4d66c84b048beee520c02683b8a81f0`. The whole cross-lane CP-01 and CA-12 steps remain with their owners.

## Preserved earlier FULL results

- `f049ae93d5650a4409d9f5769412b52e1b5e703c`: FULL passed, **9,121 tests, 9,110 passed, zero failed, 11 skipped**, 32 suites; duration 1,526,213.525748 ms. Types and lint passed (zero errors, 68 warnings). Logs `/tmp/ballot-certification-{full,types,lint}.log`. The later FEC rollout switch and finance bindings required the new exact candidate check above.
- `3c4617ef12a25edee1cb4eab0cccf784b164ccd9`: FULL failed, **9,117 tests, 9,088 passed, 18 failed, 11 skipped**. Log `/tmp/ballot-current-full.log`. All failures were repaired and the later FULL passed. No failed checkpoint was published as READY.
- Baseline: the fake-provider MapTiler/CORS failures and hung cleanup reproduced on River `8f6185c5436b2be939c0333101713b6b5263e730`. Only verified hung test leaf children were terminated; the failed results stayed recorded. Harness repair uses a non-forwarding local proxy and fake key, counts only provider hosts, and closes all local connections during teardown. Production provider guard and quotas unchanged. Focused browser/visual 13/13 passed, followed by the passing FULL.

## Environment and limits

Pinned pnpm 10.33.0 via `COREPACK_HOME=/workspace/.cache/corepack`, with `pnpm_config_verify_deps_before_run=false`; cloud sandbox profile enables authorized network/IPC for tests and git. Tests unset DATABASE_URL/WTP_ASSET_STORE and use isolated fixtures, never production data. Full git history and ignored place references are present; no .next during test/type legs.

Browser checks used **system Chromium 151.0.7922.173**, `/usr/lib/chromium/chromium`, through the explicitly identified system-browser substitution under `/workspace/.cache/ms-playwright`. Pinned Chromium 1234 download was blocked by egress; do not claim that pinned browser ran. Eleven skipped tests remain skipped, not passed. No build or deployed browser/live performance claim is made; River owns combined gates, deployment and live verification.

## Subsequent WIP

CA-35 saved polling reader checkpoint `1f87e3190`; focused tests and whole-tree types repeated at exact subsequent metadata checkpoint `6c018f09ae789b8c57809a570c4e2945fcce192a` (both exit 0): focused `tsx --test tests/polling-door-reader.test.ts` passed 3/3, whole-tree types passed, new-file lint passed. CSV/JSON/HTML/PDF-text, different states/DC/PR, source-stated assignments, zero coordinates and unknown locations are covered. Shared extractor nullable-cell support, promotion/dispatch, reader feed and per-place list retirement remain unfinished. Unreported whole columns may be absent from the door map; partly populated columns must remain mapped and held until nullable-cell support preserves every value. Never geocode, infer assignments or discard unlocated rows inside this source reader.

See `ballot-continuation.md` and current `ballot.md` for ordered remaining work, dependencies, hooks and lock state. All checkpoints remain on the stream; no force push.

Lock released at 2026-10-04T09:23:59Z at the certified batch handoff. Stream preserves exact READY, subsequent polling WIP and all source checkpoints. Current assignment remains River's authority.

## Codex handback returned reader repairs

Original CA-51 question reproduced using the held county contest; correction admits only recorded jurisdiction words. Original CA-30 question returns the official NO sentence character for character from the hash-matched ballot source. Explicit sentences are extracted in code; no model invents an absent meaning. Focused 35 tests pass across ask-ballot-summary, measure-meaning, reader-last-mile-ask. File lint passes. First type check failed because existing .next named River-deleted routes; preserved generated build outside the source tree and rebuilt place-reference projection before repeating types. Production stores unset for tests. Netlify settings read rejected by automatic approval review; River owns follow-up.
