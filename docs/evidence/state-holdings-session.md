# State holdings architecture session

Bootstrap date: 2026-09-02 (`pnpm stamp`). Bootstrap clock: 2026-09-03T00:56:36Z. <!-- expected-future: clock tool observed this UTC instant, whose calendar day leads America/Phoenix -->
Base: `3f9a138fd39f6160659329e17c496d2dd99cee00` (fetched current main).
Branch: `codex/state-holdings-20260903`; worktree: `C:/Users/seanj/dev/wtp-state-holdings`.
Provider: OpenAI Codex. Exact model identifier, session tokens and cost: NOT EXPOSED.
Governance snapshot: `ff96d60545edf000`, discovery domain, zero unresolved conflicts.

## Finite acceptance table

| Item | Exact acceptance | Dependencies | Proof | Status |
| --- | --- | --- | --- | --- |
| A1 | Every candidate canonical state holding classified; classified = moved + explicitly exempted; one atomic move and all reference updates; permanent residual guard; README layout | Frozen base and readback denominator, classification | Move plan with per-file counts, seeded residual failure, integrated gates | NOT MET |
| A2 | Exactly one generated manifest per discovered state, AZ/NH/NJ included; holdings/completeness/feeds/owed with row denominators; external inputs only committed dated readbacks; typed dataset/surface registry | A1 paths, canonical external readbacks | Input inventory, generated manifests, stale-manifest seed, mapping existence test | NOT MET |

The snapshot denominator is the base Git tree plus the committed external readbacks
named in the manifest input artifact. Later discoveries are next obligations unless
they falsify A1/A2 or are regressions introduced here. No acquisition work is started.

## Ownership and dependencies

Integration owner: `/root` (Codex). Only this owner performs the final gates and
the session's single merge. Main checkout and the standing runner remain untouched.

| Lane | Owned output | Shared resources | Dependency |
| --- | --- | --- | --- |
| Holdings classification | move-plan generator, classification module, residual check and its test | No shared edits; proposes reference changes | Base tree; output consumed by atomic sweep |
| Manifest | manifest generator, typed dataset/surface registry, manifest tests | No package/handoff/mirror/governance edits | Classification and readback schema consumed at integration |
| Integration owner | readback instruments/artifacts, atomic moves/reference sweep, README, session evidence | Serializes package.json, handoff, mirror-set, governance/adoptions, tracker and orchestration | Both lane outputs |

The first two lanes begin with independent read-only investigations. Explicit path
ownership is assigned before edits. Full gates and generated shared views are
serialized at the integrated head. Ambiguous classification and coverage labels
receive targeted judgment; path identities, freshness, counts and existence use
deterministic proofs.

## Carried exclusions

NH314, NH315, scheduled-refresh follow-up, Google OAuth follow-ups, FEC recovery
unless it fails again, and Control Center work remain outside this session.
Promotion remains gated. The standing runner and Scouts keep running.

## Bootstrap environment findings

- Git fetch initially failed under the sandbox's read-only Git metadata policy;
  approved escalation fetched main and created the isolated worktree.
- The sandbox's fallback pnpm is 11.19.0; the host-pinned pnpm is 10.33.0.
  The fallback attempted dependency migration. Its installs were stopped; the
  frozen installation and required governance bootstrap succeeded with host pnpm.
- `session:start --check`: main current, constitution intact, hooks installed,
  port 3000 free. Sandbox fetch warning was resolved by the successful host fetch.

## Closeout record

The architecture is implemented in the isolated branch; the acceptance rows remain
NOT MET until the integrated gates, local production walk and planned merge finish.

The corrected frozen classification contains 3,485 candidate files: 305 canonical
holdings and 3,180 explicitly classified non-holdings. The canonical identity is
**305 = 237 moved + 68 exempted**. The plan records every candidate, reason, destination,
source hash and reference count. `data/state-holdings/move-report.json` enumerates
every moved/exempted file and every reference file. Its final literal sweep is
4,391 references in 161 files in the initial sweep, plus 92 replacements in 52
files for the embedded-data correction: **4,483 applied replacements across 205
distinct files**, with both sweeps and the combined per-file list retained. Its
separate 265-file consumer census includes dynamic path helpers and generated
answer surfaces; it counts changed lines, not literal occurrences.

The discovered denominator is 56 states/territories, including AZ, NH and NJ.
The two external readbacks observed 2,996 standing obligations, 364 verified vault
objects and 1,073 asset-index entries. Seven asset entries are test/document/tool
evidence; all 1,066 canonical asset entries now have authoritative state joins
through exact roster and photo IDs, with no inferred names. All 364 vault objects have
state joins. Five control-plane proof identities lack a state tag and are displayed
separately. The generator consumes 305 canonical datasets and their typed
supporting inputs; the exact list and hashes are in
`docs/evidence/state-holdings-current-inputs.json`. It never contacts the live
database or vault. Each manifest displays the external observations' original
timestamps and store/schema identities.

Targeted acceptance proof: 27/27 tests passed in the first repaired run covering
the residual guard, immutable governance, manifests, typed mapping, discovered-state
growth and stale/readback changes. Both planted violations exit 1 and preserve
their input/output bytes. Each manifest table's announced N equals its rendered
row count. Lint passed with 0 errors (36 warnings); the integrated type check passed.
These are targeted development proofs, not a claim that the full gate set passed.

Neither A1 nor A2 was accepted on its first implementation pass. Corrections found
by direct checks were completed before shipping: dynamic ballot/roster readers,
government geometry serving paths, immutable historical wording, Pima College and
explicit statewide asset attribution, state-specific FEC citations, shared holdings
visibility, and source-retrieval versus vault-storage timestamps.

The original file-extension classification also omitted canonical records embedded
in TypeScript. This directly falsified A1, so the directive's exception applied:
the denominator was corrected against the same base commit. All 580 base `lib/`
TypeScript modules were classified; 23 are canonical holdings, of which seven
contain single-state data and 16 are genuinely multi-state/national exemptions.
`manifest-inputs.json` preserves the original snapshot hash and records this
correction, with 307 effective frozen inputs (305 holdings plus two readbacks).
The state denominator is still 56. No subsequent acquisition expanded it.

For the seven single-state modules, `git mv` moved each original into its planned
state JSON destination before exact record serialization. Generic code remains at
a distinct consumer path, preserving public symbols; all old paths disappear.
Verbatim source commentary, source hashes and normalized data equality are proved
by `tests/state-holdings-code-data.test.ts` and
`tests/state-holdings-meeting-data.test.ts`. Extraction and affected-consumer checks
passed 42/42. The final integration remains one atomic Git change and one merge.

Verification failures so far:

- Initial full suite: 4,931 tests, 4,888 passed, 41 failed, 2 skipped. Failures
  exposed dynamic old readers and historical snapshots altered by the initial
  literal sweep. Exact historical bytes were restored, with hash-bound allowances;
  current generated governance views resolve paths without rewriting adopted law.
- The strengthened residual guard caught four further composed ballot readers;
  those readers were repaired and a dynamic-path planted test was added.
- The production build compiled and type-checked, then failed its trace guard:
  the grounded Ask route traced 5,458 files against the standing ceiling of 230.
  Literal-root runtime reads removed the root-wide trace. A second build exposed
  the funding directory scan tracing unrelated state domains (416 files); bounded
  Node 24 glob discovery repaired that dependency. The third build passed with
  223 application files, 302 repository files total, zero test files and zero
  credential shapes. The budget is unchanged. Actual deploy-path tests passed
  12/12 without skips. Local reader walk proof remains pending.
- A sandbox-only targeted run had three `uv_os_get_passwd` errors in the tsx
  subprocess. The host-pinned invocation passed all 27 targeted tests. A direct
  reaction invocation without the repository loader also failed; the proper loader
  passed 33/33. Neither environment failure was counted as a source-code pass.
- The first commit hook refused 3,052 source dates: UTC observations on the
  following UTC day and genuine future scheduling deadlines. The generator now
  emits the existing R16 source-date annotations on the applicable table rows;
  exact readback dates are preserved and the authorship-date guard is unchanged.
  The manifest and document-date checks then passed 24/24.

Section 25 discoveries:

| Classification | Discovery / disposition | Durable proof or obligation |
| --- | --- | --- |
| BLOCKING | Old dynamic readers, stale serving/tracing paths and hidden manifest inputs; fix before acceptance | Residual and manifest tests; local build trace guard |
| BLOCKING | Canonical civic records embedded in TypeScript were missing from the original classification | Explicit A1 correction at the unchanged base SHA; seven exact JSON extractions, 16 typed shared-module adapters and exemptions |
| BLOCKING | Existing verification instrument constructed a writable repository and could issue DDL; replaced its observation path with a SELECT-only readback | `lib/control-plane/repository/holdings-readback.ts`, `tests/holdings-readback.test.ts` |
| BLOCKING | The literal sweep changed frozen legacy governance/tracker snapshots; restored exact base bytes and bound historical references by hash | Move-plan historical allowances; governance atomicity and tracker-store tests |
| FRONTIER, resolved during A1 correction | The 29 initially unattributed historical assets now join through newly inventoried canonical roster/photo IDs; 1,066/1,066 asset entries are attributed | NH320 resolved and moved through the canonical tracker CLI; `docs/evidence/state-holdings-next-obligations.json` |
| FRONTIER | Portrait reach versus rendered-slot accounting differs by 91 entries at both base and current code | NH321; `docs/evidence/state-holdings-photo-base.json` reproduces base exit 1 with exact source hashes |
| FRONTIER | Offline registry reconstruction preserves all 2,267 division and 1,998 body identities but omits canonical reconciliation metadata | NH322; original canonical registry bytes restored, no acquisition or registry redesign |

Shared integration changes are explicit: package scripts, CI/local gate parity,
handoff generation/check integration, generated-artifact registry, governance
compiler path rendering/check fixtures, tracker stores/views, orchestration and
README layout. `mirror-set.mjs` was inspected and contains no old holding paths;
its canonical mirror set did not need a path edit. Ledger/adoptions and frozen
legacy source bytes remain unchanged. NH314/NH315 and the other carried subjects
were not worked; promotion remains gated.

Provider record: OpenAI Codex; exact model identifier, token usage and cost are
NOT EXPOSED. The three agents initially hit provider capacity limits, then resumed
under explicit, non-overlapping repair allocations. Only the integration owner
runs the full gate set and merge. Terminal clock, wall-clock interval, final gate
artifact, PR/merge SHA and observed HELD readback remain pending.

## Local integration proof

The repaired local production walk passed 443 executed checks with
zero failures; 24 checks declared they could not run and none disappeared
silently. The exact run, tested head, provenance and per-check outcomes are in
`data/health/walk-runs/2026-09-02-02.json`. Local-session evidence does not activate promotion.

The original walk had 9 failures across 3 cases, documented in
`docs/evidence/state-holdings-walk-diagnosis.json`: ambiguous exact-name test
selection, an address response whose original cause was not captured, and a
card-opening step that could run before hydration. The corrected walk preserves
the application assertions and records the response at the address interaction.
A browser replay independently observed the NJ same-tab/revisit confirmations
and the Vail funding control. No civic data or matching behavior was changed.

Handoff preflight verified all 56 manifests without writing. Its other red items
were the unpushed new branch, stale generated status views and the downstream
Drive mirror, which the mutating shipping path updates. Current main remained
`3f9a138` and its four GitHub checks were green; no other PR was open.

The full shipping gate set and single merge are the remaining A1/A2 requirements.
