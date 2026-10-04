# Slide continuation

Resume `stream/slide`; preserve its history. The launch is authorized in `board/river:authorization.md`. At this checkpoint `assignments.md` still names codex-slide, and no Claude handoff has been recorded. Re-read assignments before writing. A Claude continuation needs River's recorded handoff; a resumed Codex worker must exit without writing if reassigned. Acquire a new unique lock by a normal fast-forward push before resuming. The current run will release its lock after saving this file. No PR is needed, and none was opened.

Requested starting model: GPT Astra 6. The actual runtime model is not exposed in this session. No prompt-based model switch was claimed.

## Checkpoints and evidence

- CP-01/CP-19 checkpoint `4717f3e5c4d3da15ecc149783b7cbbfa0b53570b`: actual selector FULL against merge-base with river; 985 files completed, 9,012 tests passed, 11 skipped, zero failures. TypeScript passed; full lint passed with 69 warnings and zero errors. Exact evidence, hashes and skip files are in `slide-checks.json`. This is a verified checkpoint, not a claim that the whole current stream or either plan step is complete.
- BX-01 checkpoint `e0415c47397e045cb9ff58f97e6815cecf4d0418`: five focused tests passed on the exact commit, including reopening the file store, racing claims, expired leases and stale completion rejection. Types and changed-file lint passed on identical precommit code. It was merged without losing the checkpoint. It has not had a FULL run and has no production connections yet.
- Scalar-cell CP-19 repair `1d6b42c963ee18c1d0d9ff35664b5cb959352fbb`: 40 focused tests passed, types passed, full lint passed. A div or line break used only to format a scalar name cell no longer detaches its own office/contact columns. Existing side-by-side person-cell controls still pass.
- Latest application source `a0e5c7b22892922f8380fa3bb69afed54196515d` renames the Box count helper to `boxCountsByWorkItem`; it does not claim work-item IDs are Send IDs. See the final status/evidence for checks on this exact SHA.
- No READY SHA is declared. CP-01 needs the ballot connection on river; CP-19 needs the DP-03 finding connection; BX-01 needs its repository and runtime connections. The later WIP also needs the actual FULL selection checked before a READY batch. Do not carry forward the passing 4717 full run as proof for later source changes.

## What is implemented

CP-01: public candidate-profile readers and publication payloads clear filed mailing address fields and internal acquisition notes, while raw source evidence remains untouched. Both card and Ask contact renderers suppress legacy address props. Email and the filing Sources link remain. Candidate filing contact projections return no public mailing address, and new collected-contact output omits it. Tests exercise actual held legacy evidence, renderers and Ask outputs.

CP-19: quote extraction, independent replay, and section-3 publication use the person's own row/list item/card/paragraph (including headings). Other people's fields are dropped with an INFO `FIELD_OUTSIDE_RECORD_BLOCK` finding, so valid minimum records continue. Tests cover Alice/Bob mismatches, side-by-side cells, nested cards, formatted names, derived display names, repeated identical CMS rows and scalar name-cell formatting. Different repeated rows are not pooled. The findings carry the quote, value, source URL and artifact/hash for the auditor lane's DP-03 routing. Live publication counts remain River's deployed verification, not a local claim.

BX-01 WIP: `lib/control-plane/box.ts` exports `BoxFinding`, `indexBoxFinding`, `indexScoutFindings`, `indexDetectiveFindings`, `backfillBox`, `takeBoxFinding`, `finishBoxFinding`, `boxCounts`, and `boxCountsByWorkItem`. `ScoutFinding` has optional `subjectId` and `missionPart`. The index retains references to existing immutable results and artifacts, deduplicates grounded findings by exact quote/page/subject, and retains legacy findings without quotes by their distinct origin. Builder claims use CAS, expiring leases and fencing tokens; failed builders retry. Historical replay does not reopen built work. BX-02 must use the finding ID as the publication idempotency key; the index alone does not make a separate publication write exactly-once.

## Connections requested through River

1. **CP-01 / ballot:** Ask privacy hook is implemented at `812f894166134c2c1bc56ed3ae8e8347d74850e9` on stream/ballot, but neither it nor the other ballot work was on river at last observation. Do not merge another stream yourself. River should integrate the matching batch. Our Ask tests may overlap its test edits; retain the adopted no-address expectations.
2. **CP-19 / auditors:** route INFO `FIELD_OUTSIDE_RECORD_BLOCK` findings to DP-03 without holding a valid minimum record. This request is in slide status; board/river had not yet routed it at last observation.
3. **BX-01 / River:** add `boxFindings: AggregateRepository<BoxFinding>` to the canonical repository types and memory/file/Postgres providers, plus the `box_findings` schema and migration numbering. Do not edit the River-owned schema or invent an independent store. No migration has been applied.
4. **BX-01 / slide and hunters:** connect `indexScoutFindings` after both existing Scout result appends (`standing-runtime.ts` is slide-owned; `scripts/freshness-shadow.mts` is hunters-owned). Connect detective completion and historical `backfillBox` using saved artifact URLs. Historical replay also repairs a crash after the source result append but before indexing. The functions are currently unconnected: do not report live indexing.
5. **BX-01 / admin:** join work-item counts to the canonical Send mapping and show waiting/taken/live/refused backlog. A failed store read is unknown, never zero. No Admin screen was changed.
6. **Ballot CA-31 incoming hook:** ballot requests saved PDF-text and CSV/text captures in `heldPageCopies` / `capturesForPublication`, with the raw document hash. Inspection found that `workerVaultResolver` already supplies `sourceDocument`, and `section3SourceReceipt` already prefers that parent raw hash. `heldCaptureReader` still decodes raw objects directly and drops extraction-parent metadata; fix that along with the MIME discovery filter, using the existing vault/parser boundary rather than treating raw PDF bytes as text. Ballot's own `autonomous-plan.ts` diff already attaches `ballot-contests`; current standing runtime retains that plan. Do not duplicate its attachment change. CA-31 is not on river yet. This hook was inspected, not implemented.

No new credentials or Sean policy decision is currently needed. Browser setup is an environment issue with a tested local fallback, not a missing account claim.

## Reproduce checks in this cloud environment

Shell Git and Node subprocess commands require network-enabled executor permissions; without that permission, Git proxy access and test child spawning fail. Existing connected Git credentials work. Do not print environment credentials. The repository's installed dependencies are at `/workspace/meanwhile/node_modules`; the lane worktrees reuse them. Use `COREPACK_HOME=/workspace/.setup-tools/corepack corepack pnpm`, since the default Corepack location is unwritable. Full history is already present; verify in a new environment.

For a new worktree, run the normal `node --experimental-strip-types scripts/project-place-references.mts` once to generate all 56 ignored place-reference indexes. Do not create a special place fixture as environment setup.

For the synthetic test suite only:

```sh
env -u CI_TEST_FILES -u DATABASE_URL -u WTP_ASSET_STORE \
  -u WTP_DB_ROLE -u WTP_CONTROL_PLANE_DATABASE_URL \
  no_proxy="${no_proxy},api.maptiler.com" NO_PROXY="${NO_PROXY},api.maptiler.com" \
  WTP_CHROMIUM_EXECUTABLE=/usr/bin/chromium \
  COREPACK_HOME=/workspace/.setup-tools/corepack corepack pnpm test
```

The provider guard fixture maps `api.maptiler.com` to its own loopback server and uses a fake key. Inherited cloud proxy variables intercept that fixture unless the local-test hostname is bypassed; all four guard assertions pass with this narrowly scoped setup. This is test-process setup, not a production proxy configuration or permission for provider spending. The existing browser fallback explicitly reports system Chromium 151.0.7922.173 as SUBSTITUTED for pinned build 1234. The pinned CDN download returned 403 Domain forbidden. The beacon transport positive control intentionally skips on a substituted build; preserve the skip, never call it a pass. Eleven total skips in the full run are enumerated in the evidence file.

For affected checks, run the real selector against `git merge-base HEAD origin/river`; use its actual paths. `.factory/` currently makes this stream select FULL. Do not replace FULL with the focused files used to diagnose repairs.

## Remaining scope

Nothing beyond CP-01, CP-19 and the BX-01 WIP is claimed implemented or complete. Keep all 28 steps. Resume the first ready step in the brief's order, with returned failures first and cross-lane prerequisites integrated on river:

CP-01, CP-19, BX-01, CP-02, CP-09, BX-12, CP-10, CP-13, CP-16, CP-11, BX-13, CP-05, CP-06, CP-15, CP-17, BX-02, CP-03, CP-07, CP-14, BX-03, CP-12, BX-06, BX-07 (SC-02), CP-04, CP-08, CP-18, BX-05 (CH-23), BX-04 (CH-20).

Re-read current main rulings and board briefs. No budgets, hunt pauses, production write permissions or policy have changed. No push went to main or river. No live/deployed acceptance is claimed. River owns assignment of the existing hunters worker for continuation; no routine restart request to Sean is needed.
