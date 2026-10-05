# Frontend continuation — 2026-10-05

Resume stream/frontend. Re-fetch main, river, board/briefs and board/river into explicit origin refs; read assignments and returns before claiming the lock. This lane is codex-frontend/Codex at the last read. Never push main, river or board; never force. First verified READY remains a5e7197a1855aae9d7aeafc537f417e29bb09fe6 (FE-05/06/07/10/39/43/44), with exact evidence in batch-02. Preserve all checkpoints.

## Second batch and acceptance boundaries

Final application source is 5a4a0a310 (full exact SHA is in checks.json), application-identical to the exact READY boundary. Published exact READY de644b38c2bf3e4c8f33fe97c220f6c5976a83b5 (95/95 focused tests, types, browser pass). Normal READY: FE-08 FE-09 FE-11 FE-13 FE-15 FE-29 FE-30 FE-31 FE-34 FE-38 FE-41 FE-42 FE-45. FE-11 unblocks people CA-14; FE-13 unblocks ballot CA-54. FE-28 and FE-32 are built with owner hooks pending, as assignments.md's “READY means connected” explicitly permits. They are not connected/live complete until their requested hooks land. FE-19's document is WIP; all 40 DESIGN rules and 77 sweep findings are transcribed, but required live good/bad image pairs are still pending. Do not count FE-19 complete from this document alone.

Implemented: shared person section table/contact row; sectioned body shape; retained Sources accumulator and hidden mounted Sources; authoritative searched/equal-effort versus unpublished versus working states; removed disclaimers; shrinking token/absence guards; one Admin stylesheet and removed readiness prefix; exact-body online-only pin/join URL; independently counted own-government meetings and nearby widened results. Known positive facts and online labels are retained. No new spending controls, services, budget changes, migrations or production writes.

## Exact cross-lane hooks through River

FE-32 / admin: import lib/design/copy-settings.ts in lib/control-plane/admin-view/v6-settings-read.ts and gateway/settings publication startup before the settings registry is queried. Register seven existing reader-facing text keys: copy.working, copy.notFound, copy.notPublished, copy.askMap, copy.askSidebar, copy.askWgh, copy.askAccessible. Existing config.setSetting, read, publish, log and undo must see them. Reader consumes the existing BR-05 /api/reader/settings publication, deduplicates all subscribers, refreshes on focus/60 seconds and retains last good values. Browser mock proves refresh without reload; it does not prove live Admin hookup.

FE-28 / bank: after DB-51 recordSweep successfully records real results, call publishReaderLinkHealth(results, sweptAt) from lib/civic-data/reader-link-health-publication.ts with the same actual sweep timestamp and retry publication failures. Uses existing reader edge store CAS key reader/link-health.json and existing cache purge, no Reader hot DB. DEAD disables, OK recovers, temporary/unchecked retains previous finding; stale/conflicting sweeps cannot overwrite. /api/reader/link-health and CheckedLink are connected locally. Real first dead link/live acceptance remains River's after this hook/release.

FE-19 / River: obtain actual live rendered screenshot pairs through an already authorized accessible route; this cloud's meanwhileusa.com CONNECT is policy-blocked 403. live-access.txt is actual evidence. Do not claim synthetic fixtures are the required live examples or introduce a new provider/credential. docs/look-standard.md marks missing examples explicitly and links archived bad feedback evidence.

## Remaining steps, in brief order

- FE-19: live example pairs above; WIP document already preserved.
- FE-12: CP-16 (slide) must be integrated, then unify meeting card/Sources.
- FE-35: CA-07 (people) must be integrated, then offices pins/directions; BX-08 is integrated.
- FE-36: CA-37 (ballot) must be integrated, then plain record card.
- FE-14: CP-16 and own FE-12 must be integrated/ready, then ballot/money Sources.
- FE-33: CA-14 (people) must be integrated; CA-15 already integrated. Own FE-11 is in this batch.
- FE-22: own FE-12/14 plus FE-15 prerequisites; auditors FE-16 already integrated. Add leak instrumentation only once the migration prerequisite is complete; do not disguise existing meeting/ballot faces as complete.

Prerequisites last checked against actual origin/river ecf402600401783b094837c29e0c515eadbdb843 and board/river integration records, not another worker's claimed stream READY. CA-06, BX-08, BR-05, DB-51, CA-15 and FE-16 are integrated. CP-16, CA-07, CA-37 and CA-14 are absent. Recheck on continuation; immediately continue any newly ready step without Sean.

## Verification and reproducible setup

Use network-enabled command sandbox for Git/tests/build/browser (default sandbox's spawn failures are environmental). Node v24.19.0, pinned pnpm 10.33.0 command: node /tmp/frontend-corepack/v1/pnpm/10.33.0/bin/pnpm.cjs. Dependencies already installed; no provider/install escalation needed. Full history is present. In a new worktree rebuild ignored references with node --experimental-strip-types scripts/project-place-references.mts. Real local node_modules is required for Next/Turbopack (a symlink outside its fsroot is refused).

All tests/build use env -u DATABASE_URL -u WTP_ASSET_STORE. Full tests start without .next, as River instructs. Selector must have CI_TIER=yes CI_EVENT_NAME=pull_request CI_BASE_SHA=<merge-base with origin/river>; initial missing-CI_TIER NONE result was corrected, actual selector FULL. Run actual full command once per batch, never call empty selection green. Do not weaken CI loader: separating popup-row.tsx removes the source leaf's obsolete CSS dependency and resolves original tsImport/child-process tests.

Browser replay: node .factory/evidence/frontend/batch-04/browser-proof.mjs from repository root. Explicit /usr/bin/chromium substitute is disclosed; pinned shell unavailable, no download proof. Uses real client components and synthetic data/settings/link-health endpoints only. 390/1280 dark/light assertions cover section order/contact, source retention/reset, equal effort, settings refresh without reload and singleton reads, dead link plain text, online pins/join URLs, unchanged state extrusion colours and no overflow/errors. screenshots.json contains SHA256s; images stay outside Git under /tmp/frontend-person-proof due RULING 20. Recreate instead of tracking PNGs. Actual deployed/live acceptance belongs to River.

Final rebuilt application at 5a4a0a310: app trace 403 <= 430, framework 981 <= 1050; homepage initial JS 1,977,871 raw / 563,357 gzip <= unchanged 3,100,000 / 940,000. 99 trace manifests, no tests/credentials traced; reader trace 11 routes,16 requirements,127 files,0 failures. Whole lint after cleanup:0 errors,69 baseline warnings; later vote edits:0 errors,0 warnings. Types clean. Token component baseline 578 -> 187; map/ballot/Ask/officials/shell target exceptions eliminated, calendar brand literals retained. Absence baseline10 ->7, no additions.

Batch-03 full: 9356 pass,10 fail,11 skip; every failure investigated and repaired; logs preserved compressed. Batch-04 full ran fixed 04db1664d before isolated repairs. Its counts and the exact READY tests are recorded in checks.json after completion, with honest failed-full versus repaired recheck distinction. Never claim a full green run from the focused rechecks. Completed FULL at 04db1664d:9,354 pass,6 fail,11 skip. Batch failures: agenda-version-projection and diligent-portal-reading module CSS loads, reader-last-mile-meetings portal child CSS load (same repaired dependency), BAL-30 old literal gap expectation (now checks actual shared gap marker), expanded recent vote citation expected on the face (now checks full tail and Sources), and shared-notes demanded retired NEUTRAL_NOTE (now verifies its removal). The original failing modules run and pass on repaired source; no loader/CI policy edits.

No routine questions or notifications to Sean. Put necessary hooks/access needs in status for River. No new credential or owner spending decision is currently requested. River is responsible for deploy/live readback and production data mutations through existing authorized paths.

Final refs at 2026-10-05T20:18Z: river/main unchanged ecf4026; board/river 250908c34. River reports CP-16 only on untested river-next; do not catch up there. Frontend assignment remains Codex. Current lane work is waiting on listed integrated prerequisites and owner hooks/captures. Lock released with all artifacts committed on stream/frontend.
