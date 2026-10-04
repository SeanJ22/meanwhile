# Ballot continuation

Read the latest `board/briefs` common and ballot briefs, `board/river` assignments/returns, approved `plan/plan.md`, and current main rulings before doing anything. Push only `stream/ballot`, as its assigned worker with a fresh ownership token. If reassigned to Claude, a resumed Codex worker exits without writing. Do not take another live lock. No production write, hunt, new service, spending change, main/river push, or non-draft PR was performed by this run.

Actual model selection was not exposed. Requested GPT-6.1 Sol; prompt text cannot select a model.

## Preserved work

- CA-24: `lib/ballot/measure-records.ts`, immutable `data/ballot/measure-records-first-seed.json`, durable ballot projection records, thin summary/provision selectors, ballot/Ask/reaction reads. All 15 descriptions and 52 stable part IDs survive. Source hashes distinguish captured official bytes from the four legacy held-text seeds. Explicit `measureRecords: []` overrides the seed. No guessed YES/NO text or part numbers.
- CA-30: held YES/NO meanings have separate ballot lines and exact subject/source-grounded Ask composition. Seed meanings remain unknown where the source has not been translated.
- CA-31: generic state/election contests, complete candidate-set replay, atomic contest replacement, independent held contests, normal civic-data promotion and typed readback, registered worker publication dispatch. New discovery plans publish to `ballot-contests`; CSV and PDF-text fixtures retain raw receipt hashes. DC/territories use registered OCD prefixes. Shared held-page admission/retained-plan work is routed through status, not edited concurrently.
- CA-32 partial: asynchronous general-ballot reader first, promoted edge family, page/Ask/address/scope/target intake connections. Legacy sources/contracts and the one-county filing path remain until the replacement is checked live. Finish migration and duplicate-authority handling before declaring this step complete.
- CA-20: FEC target universe reads the promoted national congressional directory plus existing admitted Send district scopes. Paginated official FEC candidate search adds finance targets only, never contests. Existing pause/admission/budget logic is retained. The expanded universe requires `WTP_FEC_TARGET_UNIVERSE=promoted`; the default refreshes the held target floor as the way back until live verification. Collector was not run.
- CA-44/45: FEC renders filed dollar categories without disclaimers or computed concentration percentages. Approved small-donor share uses unitemized individual dollars / all individual dollars, null when missing; missing filed lines stay null. Individual donors remain aggregates.
- CA-51: office matching uses held local contest titles and kinds, keeping the fixed office synonyms. A held running-for contest answers its candidate set rather than officeholders. Legacy and general route fixtures pass.
- CA-49 partial: a proven general-ballot-only direct answer avoids unrelated evidence loads and synthesis, preserving normal validation and delivered-answer capture. Unmatched/legacy/continuity questions retain the normal path. No live three-second claim for every section 11 question.
- CP-01 returned hook: removed filed mailing addresses from Ask contact/evidence/profile paths; filing source links, email and phone remain. Slide/hunters owns the rest of CP-01.
- CA-12 returned hook: connected people's own-words composer before synthesis, with normal answer validation. Do not change `synthesize.ts`.
- CA-21 partial: `finance-door-reader.ts` reads saved CSV, search API and bulk ZIP bytes with door field maps, exact source hosts, pagination accounting, report identities and raw hashes. It never hunts, totals transactions, publishes donors/addresses, or binds by committee name. General publication/reader routing and retirement of the four legacy sources are unfinished. `finance-door-bindings.ts` is subsequent WIP: candidate name, exact office title, cycle/date and exact jurisdiction must identify one promoted ballot candidate; report periods remain separate and unbound rows remain work.

## Dependency order

Use the full brief's 30-step order. Cross-lane readiness requires integration on `river`, not a source branch claim. At the last inspection, DB-11 was integrated; the newer River also contains DB-12/25, meeting DB-01 and people CA-03/13/42/SC-15. Do not overwrite those when catching up.

- CA-25 waits for DB-42 (registry continuing bank); then CA-26/27/28 and CA-29/50.
- CA-37 waits for BR-24 (measures continuing admin); then CA-38/39/55, respecting SC-10.
- CA-19 waits for CP-03; CA-33 waits for CP-09 (hunters continuing slide). CA-34/36/22 depend on the generic finance work.
- CA-52/53/54 require DB-11, BX-02 and FE-13 as the plan specifies. CA-35's prerequisite DB-11 is integrated. Subsequent WIP `lib/ballot/polling-door-reader.ts` reads saved registered CSV/JSON/HTML/PDF-text rows; tests cover OH/MI/DC/PR, zero coordinates, unlocated addresses, source-stated assignments, and refusal of incomplete/repeated/cross-jurisdiction/contradictory records. It does not publish, dispatch or retire the legacy source list. Shared generic extraction currently refuses mapped empty CSV cells and any empty HTML cells: nullable optional column support is requested through River; mixed known/unknown captures remain held rather than dropping known values. Config may omit columns absent from the entire source, but must not omit partly populated columns to conceal this limitation. Focused 3/3, types and file lint passed; excluded from the exact READY candidate.
- CA-23: the old local Ask bridge links committees to an office/body, explicitly not a particular person, and its itemized rows do not supply reported committee totals. Do not sum those transactions or attach the body's campaign money to one person. Continue with source-supported general finance records; no owner policy change is needed.

## Verification and environment

Use the repository's selector against the real merge base with `origin/river`. This batch selects FULL. Never call an unchecked FULL ready. For an affected selection, pass the actual newline-separated paths in `CI_TEST_FILES`; do not guess file names. Main checks use `env -u DATABASE_URL -u WTP_ASSET_STORE` as CI does. Do not expose credential values.

The available system pnpm is 11.19, but pinned repository pnpm 10.33.0 is installed with `COREPACK_HOME=/workspace/.cache/corepack`. Use `corepack pnpm` and `pnpm_config_verify_deps_before_run=false`. Node test IPC/git operations need this cloud tool's authorized network-enabled sandbox profile; default sandbox commands produced EPERM. Do not bypass the environment proxy.

Isolated worktrees used a symlink to `/workspace/meanwhile/node_modules` and `node scripts/project-place-references.mts` to prepare git-ignored place references. This works for tests/types/lint. River reports that builds need real installed modules rather than this symlink. No `.next` is present in the certification tree, matching CI test jobs.

Pinned Chromium 1234 could not be downloaded under the current egress policy. System Chromium 151 at `/usr/lib/chromium/chromium` runs through an explicitly reported substitution, discovered under `PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright` (the `chromium-0/chrome-system/chrome` symlink labels a system substitute, not the pinned build).

The MapTiler test's fake-provider request failed and its cleanup hung on both the first ballot FULL and River baseline `8f6185c54`. A diagnostic proved the external hostname's DNS blackhole did not deliver locally here. The repaired test uses an explicit, non-forwarding localhost proxy plus the DNS blackhole and fake key; it counts only provider hosts and sinks background requests locally. All four quota/barrier cases pass. Production quota protections are unchanged.

Initial FULL at `3c4617ef12a25edee1cb4eab0cccf784b164ccd9`: 9,117 tests, 9,088 passed, 18 failed, 11 skipped, 1,651 seconds. Only hung MapTiler leaf children were terminated; failures stayed recorded. All 18 cases were subsequently repaired in focused checks (edge 12/12, finance/source 22/22, accounting 42/42, generated/state manifests 26/26, browser/visual 13/13, generic/territory 6/6). The immutable certification tree is `/workspace/meanwhile-ballot-certification-check`, exact source `f049ae93d5650a4409d9f5769412b52e1b5e703c`; its final result and READY boundary must be read from current `.factory/ballot.md`/evidence, not inferred from this preparation note.

The official-page extractor version hashes its value-import closure. A runtime change can require recomputing `digestValueClosure(process.cwd(), "lib/sources/official-page-events/index.ts").digest.slice(0,12)` and re-keying `OFFICIAL_PAGE_EVENTS_VERSION`; do not edit generated artifacts by hand. State manifests were regenerated from the corrected dataset declaration. The new seed belongs to the existing 42-family inventory, and the general contest contract extends the existing frozen ballot source row through `additionalContracts`.

All source/READY/WIP history is preserved on the stream. Never force-push or overwrite it. Release the lock at an ending or safe handoff point, and leave the remaining scope explicit. River owns integration, release, deployed verification and real network/owner issues.

## Current certification boundary

FULL at f049ae93d5650a4409d9f5769412b52e1b5e703c completed: 9,121 tests, 9,110 passed, zero failed, 11 skipped; types and lint passed (68 warnings). The later FEC rollout switch and finance binding bridge required re-certification. Exact local READY candidate bfc11e7b5ad94530244900c9c1a158427ad65a92 is being tested in /workspace/meanwhile-ballot-ready-check; it is not published until that exact FULL passes. Later CA-35 WIP is separate and must not be folded as part of that candidate. Read current status/evidence for the final result.

## Next batch and handoff

Use the READY boundary above rather than stream HEAD when folding this batch. Start any new source batch by catching up with current river and preserving only ballot's coordination files. A continuation claims this branch only after River records its assignment and the previous lock is none; this note does not assign another worker or authorize replacing a live lock.

Ready independent work is still available: CA-23 card finance needs a source-supported person join (use exact candidate bindings, not a committee-to-body name shortcut); CA-49 still needs the remaining section 11 question paths and cold speed acceptance; CA-21 needs publication and reader routing after the saved-byte adapters. CA-31's owned-file admission hook is still pending. CA-32's legacy retirement follows complete general publication; preserve the way back until checked live. CA-35 is subsequent WIP with its extractor limitation recorded. These are implementation tasks, not invented owner decisions. Do not mark the lane complete or wait for Sean to say keep going.

The remaining dependency chains are CA-25→26→27→28→29/50 (DB-42), CA-37→38→39/55 (BR-24 and SC-10), CA-19 (CP-03), CA-33 (CA-31/24 and CP-09), CA-52→53→54 (DB-11/BX-02 then FE-13), and CA-21→22/34→36 as the full plan defines. Check integration records again: a newer source branch's READY subject alone does not satisfy a prerequisite.

## Certified batch result

Exact READY `bfc11e7b5ad94530244900c9c1a158427ad65a92` completed at 2026-10-04T09:22:41Z: **9124 tests, 9113 passed, 0 failed, 11 skipped, 32 suites, 1597328.412713 ms**; FULL exit 0, types exit 0, lint exit 0 (68 warnings). It is now published on stream/ballot. River folds this SHA, not the later stream tip with polling WIP. Earlier statements about the candidate running are historical preparation notes, superseded by this result and current status. No deployed/live acceptance is claimed by these local checks.

## Safe handoff

This Codex run ended at 2026-10-04T09:23:59Z after publishing the certified batch. Lock released to `none`. River is requested to record the existing paired meetings continuation; until that assignment is recorded, another worker must not claim this lane. A resumed Codex worker must read assignments first and exit without writing if reassigned to Claude. Ready independent work remains, as listed above; this is not BUILD COMPLETE and needs no routine restart by Sean.
