# ZIP completion and expansion preparation

Base: `713e4e06f9fba7319c14d8af90f12ac1a38e3e8f`. Contract: `fleet/zip-preparation@1`.

`lib/control-plane/zip-queue.ts` now prepares separate completion and expansion
arrays from existing evidence. It is a pure function: no database, scheduling,
network, persistence, tier stamping, source activation or publication. The
committed [example](fleet-zip-queue.example.json) is an inert proposal, not a second
task ledger. No reader output or live expansion changed.

## Actual prepared rows

The four existing pilots are in the commissioned depth order. The expansion
candidate is 85122 (Casa Grande), already used by the repository's independent
`tests/new-zip-readiness.test.ts`. Selecting it here neither changes pilot
membership nor authorizes activation or an acquisition campaign.

| Lane | ZIP | Held candidacies applicable / held corpus | Population qualification |
| --- | --- | --- | --- |
| Existing completion | 03255 | 36 / 47 | NH pilot-derived |
| Existing completion | 07866 | 23 / 276 | NJ pilot-derived |
| Existing completion | 85641 | 32 / 266 | AZ authority acquisition plus pilot ballot; partial statewide coverage |
| Existing completion | 85701 | 32 / 266 | Same AZ corpus |
| Inert new expansion | 85122 | 32 / 266 | Same AZ corpus |

These are held-corpus projection counts, **not ballot completeness fractions**.
The canonical authority label and the publisher's unknown total remain in each
response. All five historical tier stamps are `TIER_0`, stamped `2026-08-21`;
candidate corpora say `2026-09-01`. These dates describe committed evidence, not
a current observation. No live readiness snapshot was read. Every row therefore
carries unknown freshness and unverified completion. County-wide unresolved
special districts remain explicitly county inventory, never asserted to be
missing bodies governing the ZIP.

The example has 125 unique shared references; 38 have multiple ZIP consumers.
Each government uses its existing OCD division ID, each candidacy its existing
canonical ID, and each source corpus its exact committed path. Multiple ZIPs
refer to one shared entry. A reference is an instruction to consult held
evidence and methods before acquisition, not a claim that its contents are fresh
or permission to fetch. Source authority populations retain their full scope;
ZIPs only project the population. Missing applicability is a linkage obligation,
not a reason to repeat a statewide hunt.

## Reused interfaces and exact dependencies

| Existing interface/file | Required behavior | Owner/integration |
| --- | --- | --- |
| `lib/coverage/zip-tier.ts::StampedZipRow`; `data/derived/zip-coverage-tiers.json` | Supply audited stamps, evidence and edges; use the full audit artifact because compact runtime rows omit edges and reconstruct some counts. Never promote in a query. | Existing coverage pipeline; Fleet reads only |
| `lib/coverage/tier.ts::COVERAGE_TIER_NEXT_STEP` | Preserve the established next rung text; no new tier definition. | Existing coverage pipeline; unchanged |
| `docs/zip-playbook.md#1-the-definition-of-done-for-a-zip` | Remains the definition of full completion; queue points to it and does not certify it from a tier or candidacy count. Current governance governs over historical playbook wording. | Fleet backend evidence; Claude owns reader/UI verification |
| `lib/hunt/zip-projection.ts::{applicableDivisions,projectOntoZip}`; `data/derived/zip-division-ids.json` | Project held authority corpus onto committed overlap geometry; preserve missing geometry as unknown local applicability. | Existing acquisition/projection pipeline; Fleet reuses |
| `lib/hunt/source-universe.ts::newZipReadiness`; `lib/hunt/candidate-universe.ts::CandidateUniverse` | Check zero acquisition for held records while retaining the named authority denominator and exact canonical identities. | Existing acquisition pipeline; Fleet reuses |
| `lib/candidates/population-label.ts` (indirectly through projection) | Preserve pilot-derived/partial-authority qualification; a state-shaped ID must not become a statewide coverage claim. | Existing population contract; unchanged |
| `lib/control-plane/readiness/read.ts::ReadinessReadOutcome` | Supply classified outcomes; quarantined/unavailable/missing records must not be treated as trusted `HELD` snapshots. | Existing readiness publisher/read service; PDC production operations untouched |
| `lib/control-plane/readiness/gates.ts::FreshnessVerdict` | Caller supplies existing freshness verdicts and thresholds; no new clock. `null` verdict or unknown age stays unknown. | Existing freshness/readiness producer; PDC authority untouched |
| `lib/control-plane/zip-queue.ts::{ZipQueueInput,PreparedZipQueues}` | Claude may consume preparation output in Admin; runtime calculations stay here. | Fleet implementation complete; Claude UI integration pending |

No PDC proof, authority or production interface was modified. Wiring any future
dispatch must resolve these references to **existing** scheduler provider
obligations and canonical task history. Shared reference IDs must never become
an independent task store. Live dispatch/expansion and integration with PDC's
production resources require a separate authorized session.

## Response semantics

All newly added fields are projection/reporting fields; existing ledger and
readiness schemas are unchanged. The versioned TypeScript interfaces are the
machine contract and the complete example is reproduced by a compatibility test.

- `stampedTier`, `stampedAt`, `coverageEvidence` and the county unresolved count
  come directly from the supplied stamp. Missing stamp means `UNKNOWN`/`null`.
- `geometryHeld`, `heldProjection` and `heldProjectionCheck` come from the
  existing projection/check functions. The check proves reuse of held rows only.
- `readinessStatus` preserves `HELD`, `NOT_RECORDED`, `UNAVAILABLE` or
  `REQUIRES_REPUBLISH`; absent input means `UNKNOWN`. Only `HELD` exposes its
  publication date, ZIP rollup and non-resolved state capability gates. State
  capability gaps are never relabeled as ZIP-specific failures.
- `freshness` passes through the existing verdicts. Fresh verdicts retain their
  meaning; stale evidence remains present with revalidation named; absent or
  unreadable age remains unknown. There is no independent expiry calculation.
- `sharedRefs` and `sharedResearch` are stable deduplicated pointers. They carry
  no attempts, lease, state transition, spending, or dispatch authority.
- `completionVerified: false`, `activation: NOT_AUTHORIZED`,
  `nextAutomaticAction: null`, and `retryAt: null` are deliberate: preparation
  has no automatic schedule and cannot promise an eventual run time.
- Invalid ZIP/state, duplicate ZIP inputs, unsupported lane, wrong-state corpus
  or wrong-state trusted readiness throw a named error instead of returning
  plausible empty queues. Service callers must surface that error, not cache it
  as successful empty coverage.

## Isolated verification and remaining work

Executed:

```text
node --test --experimental-strip-types --import ./scripts/register-test-loader.mjs tests/zip-queue.test.ts tests/new-zip-readiness.test.ts
11 tests passed; 0 failed; approximately 0.39 seconds.
```

Tests run the real producer against committed holdings and reproduce the exact
example output; trap outbound fetch; compare named projected candidacies rather
than only counts; prove shared-reference stability and deduplication; preserve
missing geometry, unavailable readiness and stale history; and reject duplicate
and wrong-state input. No performance gain is claimed. The duration is a local
test observation, not a production benchmark.

Pending: connect trusted live readiness and canonical freshness inputs in an
authorized integration session; map coverage gaps to existing provider
obligations; validate evidence and permitted source alternatives; complete the
playbook requirements and reader proof; render this contract through Claude's
Admin implementation. None is production-proven by this artifact. There is no
new owner decision merely because evidence is missing. Playbook changes: nothing
new was learned about a retrieval rung in this preparation-only work.
