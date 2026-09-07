# Fleet promotion readiness — meeting times and agendas

Implementation record for the six deficiencies the Fleet Promotion Activation Audit
established (ACT-1, ACT-3, ACT-4, ACT-5, ACT-7), observed 2026-09-06 from the worktree
`claude/fleet-promotion-readiness-89d9a2` on base `54d4d946d919671f20d19aae5191e7b58709c8e9`.
The denominator is PRDY-1 through PRDY-6, stated at the start and not enlarged. Promotion
stayed OFF for the whole session; no record class was opened; the accepted staging visual
build `f609f62f2cb485954f920f98e1efd3d8b7064e91` and Prompt 3 were not touched; Admin C was
not begun.

## The rows

| Row | What was missing | What now exists | Proving instrument |
| --- | --- | --- | --- |
| PRDY-1 executable SHA identity | The audit compared the heartbeat's one SHA with raw main and read a current runner as stale (`54d4d946` is an observer-only child of `972d1a60`). | `lib/control-plane/code-identity.ts` derives three identities — raw main, the executable head under the canonical shipping classification (`classifyCommitCost`, RULING 278; UNKNOWN counts as executable), the runner's tested SHA — and a verdict (CONSISTENT, RUNNER_BEHIND_EXECUTABLE, RUNNER_AHEAD_OF_MAIN, RUNNER_NOT_ON_MAIN, CANNOT_TELL). The runner writes it on every beat (`RunnerHeartbeat.codeIdentity`, additive), the admin Runner card renders it, and `pnpm code-identity:readback` re-derives it independently from the checkout. Real stale detection is not weakened: executable code above the runner is RUNNER_BEHIND_EXECUTABLE. | `tests/code-identity.test.ts` (6, including a real temporary repository); `scripts/code-identity-readback.mts` |
| PRDY-2 fact-shaped meeting pipeline | Fleet contracts extracted rows; nothing turned a validated row into a `Meeting`. | `lib/control-plane/promotion/meeting-facts.ts` bridges a completed extraction (LEGISTAR_EVENTS, CIVICCLERK_EVENTS) into `meeting-times` and `agendas` facts by running the CANONICAL adapter normalizers over the immutable vault bytes and cross-checking every scalar against the validated record. Identity comes from `LEGISTAR_CLIENTS` and `SOURCE_WIRING`; a tenant with no row (Avondale) is BODY_IDENTITY_UNRESOLVED. A URL inventory class is refused, never renamed. Each fact carries body, meeting id, date and instant, zone and precision, agenda URL and items-when-exposed (null, never "none"), source and artifact identity, acquisition and applicable timestamps, and the parser/validator/auditor result ids. | `tests/meeting-facts.test.ts` (6): 18 meeting-time and 18 agenda facts from the real held Pima capture |
| PRDY-3 complete chain | Three of five VERIFIED checks were NOT_IMPLEMENTED and AUDITED carried `controls: null`; nothing reached APPROVED. | `fact-verification.ts` measures all five checks over re-read bytes (span offsets, registry body and one identity per artifact, date/time and venue/online and provenance burdens, the Reader's own `formatMeetingTime` against the source wall clock plus `validateSnapshot`, false-zero accounting) and plants known-answer controls from an independent parse, scored by `scoreControls`. `fact-chain.ts` offers SCOUTED (FLEET_EXTRACTION) → CONFIRMED (a second acquisition of the same official representation by another ACQUIRER Attempt, byte-identical re-observation included; a disagreeing one is CONFIRMATION_FACT_CONFLICT) → VERIFIED → AUDITED → APPROVED through `appendTransition`; approval is a machine RELEASE_ORCHESTRATOR actor with measured burdens (checks, controls, currency, freshness, candidate class), refused as APPROVAL_BURDEN_FAILED. No per-fact owner approval. A .gov publication is sufficient authority; no second publisher is demanded. | `tests/fact-verification.test.ts` (5); `tests/fact-chain.test.ts` (2, real parser/validator/auditor processes on an isolated plane, 36 facts to APPROVED); `tests/promotion-pipeline.test.ts` (unchanged rules still hold). Controls on the held capture: 108 known-present and 8 known-absence, recall 1, false absences 0, false presences 0. |
| PRDY-4 canonical Reader projection | 0 of 12 sampled items had a Reader projection; no vocabulary or writer. | `reader-projection.ts` projects a fact into the Reader's own `Meeting`/`AgendaDocument` inside a `MeetingsSnapshot` of the committed shape, validated by `validateSnapshot`, counts by `snapshotCounts`, source accounting moved by exactly the added rows, RL-1 stamp-stable (a re-observation that changes only stamps is UNCHANGED and keeps the Reader's bytes), agenda-item attribution preserved where the fact did not measure it. `readerRendering` says what the Reader would show, including honest gap states. | `tests/reader-projection.test.ts` (2): over the real committed snapshot, every held Pima sitting projects UNCHANGED and the rest ADD through the Reader's validator |
| PRDY-5 fact-class freshness | 78 corpus `meetings` obligations; no obligation for a fact class; no class-specific stale hold. | `scheduler/providers/promoted-facts.ts` (the sixth provider) enumerates `freshness:meeting-times:<bodyId>` and `freshness:agendas:<bodyId>` from the pipeline's own FLEET_EXTRACTION records, route = the official feed the fact was acquired from, cadence/next-due/debt/backoff from the existing scheduler. `fact-freshness.ts` reads FRESH / DUE / SOURCE_FAILING / STALE / NOT_SCHEDULED / NEVER_ACQUIRED; STALE (2 cadences past the last successful acquisition) and the two unscheduled states HOLD approval and promotion without emptying anything; a NOT_DUE source is healthy. | `tests/fact-chain.test.ts` (registration through `buildRegistry` + `syncObligations`, then approval lands); canary stale refusals below |
| PRDY-6 real promoter, reversibility, shadow canary | The window's promoter threw if called; rollback was a plan. | `promoter.ts` accepts only PROMOTE_WOULD items of an open meeting-fact class under an enabled authority (the LIVE gate for the READER target — OFF, so it refuses PROMOTION_OFF and writes nothing; an as-if authority only for an isolated SHADOW root), holds superseded facts and agendas without their sitting, materializes through the Reader's `writeSnapshot`, keeps the exact before-state bytes beside a receipt, runs the local half of the verification contract, decides regression with the window's `decideRegression`, and `executeRevert` puts the before-state bytes back and proves the hash; failures open incidents through `openIncident`. The nightly window now wires this promoter behind the same gate (unreachable while OFF) and records `promotionReceipts`. `scripts/promotion-canary.mts` exercises the real chain, projection and promoter on isolated planes. | `tests/promoter.test.ts` (3); `tests/promotion-canary.test.ts` (1, runs the script); run records under `data/health/promotion-canary-runs/` |

## The canary, measured

Fixture mode uses the real held Pima Legistar capture (`tests/fixtures/legistar-pima-events.json`);
live mode made two fresh acquisitions of the same official feed. Every run copies the committed
reader snapshot into an isolated root and asserts the committed file's hash unchanged after.

| Run | Audit | Positive (shadow) | Live gate | Stale | Conflict | Superseded hold | Malformed | Excluded class | PROMOTION_OFF | Rollback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fixture, deterministic (the test) | attack set, SURVIVED | 18 meeting-time + 18 agenda of 36, verified by readback | 36 of 36 REFUSE_WOULD | 35 | 1 | 1 | 1 | 1 | 36, nothing written | before-state bytes restored, incident opened |
| fixture, model (`2026-09-06-01.json`) | claude-opus-5 review INCONCLUSIVE | 0 of 36 | 36 of 36 REFUSE_WOULD | 35 | 1 | 0 | 1 | 1 | 36 | not reached |
| live, model (`2026-09-06-02.json`) | claude-opus-5 review INCONCLUSIVE | 0 of 34 | 34 of 34 REFUSE_WOULD | 33 | 1 | 0 | 1 | 1 | 34 | not reached |

Under the standing runner's required model audit no positive candidate exists yet. The
model's own verdict on the live bytes was SURVIVED with six challenges; four quoted the
key-sorted field projection it was shown rather than the raw artifact bytes, the grounding
check refused them (AUDIT_MODEL_UNGROUNDED_CHALLENGE), and the review was forced
INCONCLUSIVE. That is a representation mismatch inside the audit contract, not a civic
evidence failure; it is outside this denominator and is recorded as the follow-up that
stands between the chain and a positive candidate under the full audit. The auditor
boundary was not loosened to get past it.

## What the live plane holds

The only live meeting-fact chain is Avondale (CIVICCLERK_EVENTS). Its bridge refuses at
BODY_IDENTITY_UNRESOLVED because no `SOURCE_WIRING` row serves the tenant, and its live audit
is INCONCLUSIVE; so the live pipeline holds no `meeting-times` or `agendas` item and no
fact-class obligation until a wired tenant's chain completes. Nothing here changes that
truth or the Reader's.

## Preservation

Promotion OFF (`ACTIVATION_GATE.promotionEnabled === false`, `openRecordClasses: []`);
reader-visible promoted records 0; `data/meetings-snapshot.json` byte-identical before and
after every canary; no test or staging content changed; the reader closure receipt binds no
file this session edited.
