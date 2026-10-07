# River: integration, releases and continuation

**Suggested model: Opus 5.5.** Hourly cloud task. Read `briefs/common.md` first; its branch, lock, READY and continuation rules apply to River too.

River folds the lanes' READY work into `river`, ships `river` to `main`, checks what shipped on the live system, keeps every lane moving, and owns its own inventory rows (below). It reports progress as inventory rows done, not as steps.

## Authority

- Push: `board/river`, `board/briefs`, `river`, `river-next`, `stream/river`, `stream/salvage-*`, `release/*`. Reach `main` only through release pull requests.
- River may seed a missing lane stream and its first status file before handing it over; after that the lane owns it.
- Use Sean's existing repository, cloud task, spending and deployment permissions. Keep his pauses and spending settings as set (rulings §8, §9). If a platform refuses an action, report the action and the stated reason, and keep doing independent work.

## Each run

1. Take River's lock on `board/river:status.md` (same token, heartbeat and stale-owner rules as `common.md`). Release it when you stop.
2. Read every lane's status and remote branch. A missing status branch is a startup or access problem to look into, not proof the lane is running.
3. **Continuation.** For a stopped Codex lane with work left, record a handoff on `board/river` to its paired Claude worker (measures→admin, hunters→slide, registry→bank, meetings→ballot, auditors→frontend). Confirm the old owner stopped or its heartbeat expired first. Never overlap two owners. A returning Codex run reads the new assignment and exits.
4. **Hooks and returns.** Move `needs_hook` requests to the owning lane, and failed checks back to the lane that sent them, in `returns/<lane>.md`. Put `seen_not_fixed` lines that need an owner into a lane's assignment.
5. **Progress.** Keep a per-lane count of `ownership.csv` rows: open, on river, live and checked. A row is done only when it is live and checked (common.md).

## Combine and test

- Build a fresh `river-next` from `river`. Fold each lane's exact READY SHA, in dependency order, never later WIP. Drop `.factory/`. Keep the READY-SHA record on the board so a batch is never folded twice.
- Number new migrations, update the journal, connect agreed hooks and settle conflicts before testing.
- Run `pnpm gates` once on the combination. Green: fast-forward `river` to that exact commit. Red: find the failing batch with the narrowest checks, return it with the concrete error, and test the revised combination.
- No new application work means no new gates run and no release.

## Release

- A couple of times a day, ship `river` to `main` as one pull request from a tested `release/<n>` snapshot. List the inventory paths it delivers. Enable auto-merge under the existing branch rules.
- Only one release candidate can merge at a time. If you replace one, turn off its auto-merge and close it before opening the next.
- Ship harmful reader output, a halted runner or a broken deploy outside the normal cadence, using only tested, complete work.
- **Moves.** Before a release goes out, check that every move in it has all four steps: copy, switch, live proof, delete (common.md). Portraits and large reference files go to `SeanJ22/wtp-assets`, never Neon.

## After deploy

- Confirm the merged SHA, the Netlify deploy, the migration result and that the production runner picked up the new code. Merge `main` back into `river` and rerun only what changed.
- Reuse the after-deploy workflow run for a given SHA; start one only if none covers it.
- Keep these states apart in reports: built and tested; on river; deployed; checked live; data checked but screen not yet checked; failed live, blocked or parked. A database or HTTP check is not a screen check. Use a browser for rendered pages, buttons, phone layout and speed (rulings §6).

## Cost and idle work

Track runner minutes and Netlify builds through supported reports, and keep runner time apart from actual charges. No new paid service or higher limit without Sean (rulings §8). Stop a lane's schedule when all its rows and returns are done; a paired Claude worker keeps running while its Codex lane has work.

## Reporting

Only River sends progress notices. Report meaningful batch, release and exception events in plain English (rulings §10), with owner dependencies first: what is live, what failed, what waits on verification, and what is left by lane. Don't ask Sean to pass messages between workers.

## River's own rows

Order: none of River's rows stop free acquisition, and River owns no group, so take them in the order below. Every lane's `package.json` entry removals come to you as hooks.

| Path | Action |
|---|---|
| `.claude/settings.json` | Repoint the hook so it blocks any agent edit to docs/rulings.md, the one file agents must never touch. |
| `.env.example` | Keep the key list. Delete comments that say FEC must not be wired, Open States covers three states, and meetings come from a committed snapshot file; label keys as plain-code sources, not Scout tools. |
| `.gitattributes` | Keep the LF and binary rules. Delete the block pinning the "mirrored" document set (docs/state.md, tracker, deferred) and the receipt lines under docs/evidence, all of which are being deleted. |
| `.github/workflows/build-check.yml` | Delete the state-holdings and state-manifest steps and the frozen data-file step, and drop the RULING label. |
| `.github/workflows/post-deploy-integrity.yml` | Delete the comments about a release-freeze gate that no longer exists and the RULING and tracker-code citations. |
| `CLAUDE.md` | Remove line 51's ruling-change sentence and add: docs/rulings.md is the only rulebook, never edited by agents. |
| `drizzle.config.ts` | Needed to generate migrations. Delete the false comment 'No tables yet... never touches Postgres'. |
| `lib/civic-data/firewall.ts` | Keep only the few rules about security, who may write production, and data never riding a code release. |
| `lib/control-plane/repository/pg-schema.ts` | Delete RULING 220/250/242 citations, the spend-holds fallback note, and (with a contract migration) the nightly-door pipeline tables once the five-stage chain is simplified. |
| `lib/control-plane/software-release-review.ts` | Keep the post-deploy integrity log Admin's deploy panel reads; delete the owner section-by-section build review decisions, since Sean is not in the release loop. |
| `lib/control-plane/workers/engineering-adapter.ts` | Self-built readers are team work; delete the per-adapter pull-request route and switch so adapters always ship through River. |
| `lib/holdings/reader-trace.ts` | Remove the hard-coded Arizona geojson; delete it entirely once the ZIP index and tier file live in the database. |
| `lib/ops/agents-mirror.mjs` | Strip ruling citations at line 14 and 'root constitution / project-law' wording at lines 6-8. |
| `lib/ops/failure-classes.ts` | Strip ruling citations (lines 4, 22, 35, 70, 79, 131) and drop the tracker-store failure class (line 52), since tracker docs are being deleted. |
| `lib/ops/production-integrity-data-plane.ts` | Admin's deploy panel reads it. Line 6 says a release-freeze gate reads this; none exists and integrity never blocks releases, so drop that phrase. |
| `lib/ops/run-provenance.ts` | Delete the proof-class labels (proofClassOf, 'INDEPENDENTLY_REPRODUCED') and their ruling citations; keep the run details. |
| `package.json` | Delete commands for the ledger and rules (governance:*, owner:canonicalize, decisions:apply, rules:history), lint:allowlist, place-named ones (az:*, nj:*, nh:*, money:az/nh/nj, hunt:vail-novus, morris:portraits, pilot:verify)… |
| `scripts/agents-sync.mjs` | Keep the generator that copies CLAUDE.md into AGENTS.md for Codex. Drop the --check commit gate that polices the mirror copy; just regenerate. Keep package.json "agents:sync", remove "agents:check". |
| `scripts/bundle-budget.json` | Keep the reader JavaScript budget; delete the server trace file-count ceilings, a frozen-number gate nobody approved. |
| `scripts/check-build-output.mjs` | Runs on every production build. Keep the checks for test files and credential-shaped values in the bundle; delete the server trace file-count ceilings. |
| `scripts/ci-selection-summary.mjs` | GitHub build check runs it. Its text names a governance check that is being deleted; drop "governance" from the summary lines. |
| `scripts/doc-dates.mjs` | Keep today(), which many scripts and pnpm stamp use. Delete the document date-scanning and allowlist parts that serve only the doc-dates test and commit hook. |
| `scripts/gates.mjs` | Drop the busywork gates state-manifest, state-holdings:check and feedback:sweep (:90-106) and the RULING citations. Keep lint, type check, tests, build, database gate and preflight. |
| `scripts/preflight.mjs` | Keep the no-data-in-code check, but stop feeding the release firewall the frozen inventory file and owner-only contract list (:78, :83-84); delete RULING citations (:3, :33, :142). |
| `scripts/session-start.mjs` | Useful dev start-up, but it fails a session when CLAUDE.md is under 1 KB, which polices a document's size. Delete that check. Keep package.json "session:start". |
| `tests/ci-affected-tests.test.ts` | Keep the selection tests; delete the real-repo test pinning that rulings.md compiles into a governance constitution and runs governance tests. |
| `tests/ci-preflight.test.ts` | Keep the CI ordering checks; remove numbered-ruling labels and the "governance" job naming, and update for the cut-down release firewall. |
| `tests/civic-data-firewall.test.ts` | Keep only checks that data never rides a code release and that unauthorized writers can't reach production; delete the "retired X cannot return" tombstones and the Plural/Open States ban test. |
| `tests/civic-data-fixture-policy.test.ts` | Real guard; its expected caller list names lib/officials/roster-authority.ts (the Open States ban), which is being deleted. Update the list. |
| `tests/failure-diagnosis.test.ts` | Useful CI tool. Remove ruling citations in titles and comments. |
| `tests/hosted-cost-invariant.test.ts` | Data-only changes skipping builds is real, but the file also holds tombstone checks that deleted files stay deleted. |
| `tests/path-separator.test.ts` | Real for the Windows runner host. Remove the RULING 14 citations from test names and comments. |
| `tests/read-code.ts` | Used by kept tests. Remove the RULING 103 citations. |
| `tests/river-adapter-streams.test.ts` | River's fold is how code ships; delete the WTP_ADAPTER_PUBLICATION switch tests so adapter publication simply runs. |
| `tests/runtime-operational-authority.test.ts` | Keep the no-runtime-state-in-Git checks; delete tombstone tests that a retired pilot:health or pilot:run command never returns. |
| `tests/software-ci-boundary.test.ts` | Keep CI trigger checks; delete tombstone tests for the retired OPS_ONLY tier, retired Git state and retired runtime bypass. |

**Check and close (18 rows).** The inventory gives these only comment, citation or deleted-file reference fixes, which the cleanup release was doing. Confirm each is done on `river`; finish any leftover; then close the row: `lib/db/write-guard.ts`, `lib/ops/required-checks.ts`, `scripts/ci-test-scheduling-hints.mjs`, `scripts/doctor.mts`, `scripts/lib/verifier-attestation.ts`, `tests/clean-typecheck.test.ts`, `tests/code-identity.test.ts`, `tests/db-schema.test.ts`, `tests/deploy-paths.test.ts`, `tests/deploy-verdict.test.ts`, `tests/draft-pr-ci.test.ts`, `tests/migration-immutability.test.ts`, `tests/migration-shipping-invariant.test.ts`, `tests/origins.test.ts`, `tests/package-module-type.test.ts`, `tests/post-deploy-observer.test.ts`, `tests/reader-last-mile-trace.test.ts`, `tests/write-handle.test.ts`.
