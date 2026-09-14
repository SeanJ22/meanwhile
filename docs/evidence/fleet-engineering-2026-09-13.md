# Fleet engineering: isolated repair and integration handoff

Repository: `https://github.com/SeanJ22/meanwhile.git`. Workspace: `C:/Users/seanj/dev/meanwhile-fleet-engineering-20260913`. Branch: `fleet/isolated-progression-20260913`. Pinned base: `713e4e06f9fba7319c14d8af90f12ac1a38e3e8f`. The remote was verified with `git ls-remote --symref`; this is a fresh clone with its own `.git`, no alternates or linked worktrees, outside OneDrive. No other checkout was changed. Session stamp came from `node --experimental-strip-types scripts/stamp.mts --iso` (`2026-09-13T01:00:09-07:00`).

The repairs allow retained source evidence to keep advancing after a refresh failure, give unserved work a fair turn, avoid planning when no bounded dispatch can fit, and report operational facts without claiming publication. This is implemented code and isolated evidence. It is not production proof, a shipping certification, or part of PDC's completion denominator.

## Finite acceptance and ownership

| Assignment | Exact isolated acceptance / proving instrument | Owned output |
| --- | --- | --- |
| 1. Trace progression | Existing coordinator tests trace Scout, acquisition, Parser, Validator, Auditor, current-cadence reuse, retry and policy denial; new regression tests reproduce three scheduling/reporting failures on the base | `workers/coordinator.ts`, `tests/fleet-coordinator-progression.test.ts`, this report |
| 2. Repair confirmed blockers | Fair service ordering; correct time deferral; impossible-dispatch preflight; retain last successful capture; validate later explicit cache candidates | `workers/coordinator.ts`, `workers/runtime.ts`, `workers/acquirer.ts` |
| 3. Recovery invariants | Live lease blocks another execution; expired attempt retained; late completion rejected; backoff respected; OS-killed test child resumes from its own durable vault | `tests/fleet-recovery-journey.test.ts` and existing `tests/worker-fleet-recovery.test.ts` |
| 4. Representative journey | Recorded Pima meeting input through existing real worker processes and fact verifier: 36 VERIFIED, 36 AUDITED, 0 published | [Recovery evidence](fleet-recovery-journey.md), [actual TAP](fleet-recovery-journey.tap) |
| 5. Truthful Admin backend | Versioned callable read service and authenticated on-demand GET, canonical provenance, missing/stale/error distinctions, no completion-to-publication inference, real decision cards | `lib/control-plane/fleet-operations.ts`, `app/api/admin/fleet/operations/route.ts`, focused service/route tests, [interface v1](../fleet-operations-v1.md) |
| 6. ZIP queue preparation | Four existing pilots and one inert existing-regression expansion ZIP; exact held-corpus projection; shared identity references; no fetch/activation | `lib/control-plane/zip-queue.ts`, `tests/zip-queue.test.ts`, [ZIP evidence](fleet-zip-queue.md), [prepared queues](fleet-zip-queue.example.json) |

Subtasks were partitioned by files under the repository's parallel-work instructions. Fleet root owns integration and the local commit. Claude owns all pages/components/styles/interactions. PDC retains production operations and its existing proof/authority contracts.

## Historical evidence versus confirmed causes

The supplied audit is the historical summary in the assignment: low recent worker activity, ambiguous deferrals, old claimed/reclaimable tasks, expensive no-dispatch cycles, incomplete generic publishing checks, and disconnected publication-funnel reporting. No attached row-level audit or current production snapshot was available to this isolated clone. Those observations are hypotheses to test, not measurements of today's production system.

Confirmed in pinned source and isolated regressions:

- `runAutonomousCoordinator` iterated repository ID order under the finite cycle cap. An already served item could consume its next stage before an unserved item. It now orders by last canonical Attempt start, then creation/id for deterministic ties. Restart reconstructs the order; no fairness cursor is persisted. A two-cycle test proves the unserved item gets a turn and then the least recently served item runs. This does not change dispatch, concurrency, Scout, spending or blackout limits.
- The final untouched-item loop always emitted `COORDINATOR_CYCLE_MAX`, including an already elapsed deadline. It now distinguishes the actual count or time stop.
- With one minute remaining (less than the existing two-minute worker bound), the old coordinator read 25 worker-result histories while dispatching nothing. The same fixture now reads zero such histories, leaves tasks and attempts unchanged, and names the wall-clock ceiling for all 25 items. This is an operation-count measurement, not a production latency or cost estimate. Cycles where a worker fits but a five-minute Scout does not may still perform planning; no broader optimization claim is made.
- A failed source refresh displaced the earlier successful capture in downstream selection. The old successful capture is now available to unfinished parsing/checking; the latest source failure still keeps the obligation unresolved and triggers the existing Scout/retry path. It cannot earn STAGED merely by falling back to older evidence.
- A single invalid explicit cache candidate stopped examination of later independently valid candidates. The acquirer now checks remaining supplied candidates, preserves the failed-candidate diagnostic, and accepts only evidence satisfying existing integrity/provenance/current-until constraints. If none qualify, it still refuses without a network fallback. Permission uncertainty is not bypassed.

Existing implementations confirmed and reused:

- `scripts/freshness-shadow.mts` already reserves autonomous wall time (`fleetReserveMs`) and a Scout slot (`fleetScoutReserve`). Its ordinary `runCycle`, autonomous coordinator and legacy held-worker cycle are distinct execution paths. Reservations are present; their absence is not diagnosed or repaired.
- `workerTaskAdmission` already derives capped backoff and policy recheck eligibility from canonical Attempts. A claimed task is not automatically runnable because its label looks old. `sweepExpiredLeases`, repository compare-and-set, result reconciliation and `completeWorkerTask` establish whether recovery is lawful.
- `scheduleAutonomousAcquisition` already uses the existing obligation cadence and real successful re-observation timestamps. Identical bytes retain immutable artifact identity without causing a hot refresh loop. No new freshness clock is introduced.
- Existing meeting-specific `projectFleetPipeline` / fact-chain / verification code can independently measure the bounded meeting and agenda journey. Generic publishing readiness remains class-dependent; it was not replaced or declared complete.

## Representative result and costs

The [executed journey](fleet-recovery-journey.md) retained 18 meeting-time and 18 agenda facts from the existing recorded Legistar fixture. Each of 36 facts passed every existing VERIFIED check and reached AUDITED. No facts were approved or published. The test keeps the existing unscheduled-freshness hold intact, and does not attach a live model transport.

The journey recorded six Attempts including one expired Attempt, three committed worker results, and three cost rows. The known USD subtotal is zero but all three rows have unmeasured USD; the expired pre-commit computation has no committed cost row. Total spending is therefore unknown, not $0. No live civic-source or model request was made by the journey. Package installation is separate development setup, not fleet spending evidence.

ZIP preparation covers `03255`, `07866`, `85641`, `85701` and inert expansion candidate `85122` (an existing repository projection regression case). It shares 125 canonical research references, 38 consumed by multiple ZIPs. The historical AZ corpus supplies 32 applicable candidacies for `85122` out of 266 held corpus rows without another acquisition. This is not whole-ZIP completion: old tier/corpus stamps, population qualifications, missing live readiness and unknown current freshness remain explicit.

## Shared interfaces and owners

| Exact shared dependency | Required behavior / current status | Owning session |
| --- | --- | --- |
| `lib/control-plane/repository/types.ts::{ControlPlaneRepositories,Persisted}`; `repository/worker-completion.ts::completeWorkerTask` | Canonical ledger, append-only result history, CAS and lease ownership; reused unchanged | Fleet backend contract; PDC exclusively operates production instance |
| `lib/control-plane/workers/types.ts::{WorkerResultRecord,WorkerTaskSpec}`; `workers/activity.ts::readAutonomousActivity` | Evidence-attributed results and complete per-item promotion history; reused unchanged | Fleet backend; consumers include Admin |
| `lib/control-plane/fleet-operations.ts::readFleetOperations` | New versioned query projection; authenticated Admin caller must preserve classified outcomes and unknown live publication proof | Fleet supplies service; Claude consumes in Admin |
| `lib/control-plane/admin-data.ts::{ReadOutcome,readSnapshot,readDecisions}`; `owner-surface.ts::OwnerSnapshot` | Existing snapshot/decision identity and acknowledgement semantics; reused unchanged | Existing backend publishers; Claude owns rendering |
| `app/api/admin/fleet/operations/route.ts`; `lib/control-plane/gateway/admin-guard.ts` | Implemented on-demand GET with the existing host/session guard, no-store responses and explicit unavailable-store failure; existing `/api/admin/live` remains the cheap polling endpoint | Fleet backend implemented; Claude Admin consumption pending |
| `lib/control-plane/promotion/{types,fact-chain,fact-verification}.ts`; `lib/control-plane/promotion/pipeline.ts` | Existing independently measured proof and stage transitions; read/reused, never amended | Existing PDC proof/operations owner; Fleet may supply evidence under unchanged contract |
| `scripts/freshness-shadow.mts` | Existing reservations, safety admission and fleet call sites; no runner edits | PDC production operations during transition |
| `lib/control-plane/readiness/{read,gates,model}.ts`; `lib/coverage/{tier,zip-tier}.ts`; `lib/hunt/{zip-projection,source-universe}.ts` | Existing coverage requirements, historical stamps, classified readiness and freshness verdicts; no competing definition | Existing canonical producers; Fleet prepares projection, Claude renders |

## Verification boundaries and remaining integration

Focused test, type and lint results are recorded at closeout below. No full application builds, browser walks, production DB checks, shared CI, deployment or live fleet dispatch were performed. No ports or servers were started. Non-destructive process observations showed other Claude/Node work; WMI details were unavailable, so no claim is made that the host was exclusively idle. Verification used memory repositories, temporary test resources and serialized focused tests. Dependencies were installed with the pinned lockfile, lifecycle scripts disabled, and a clone-local package store. Shell-sandbox restrictions on esbuild required approved execution of the same offline tests outside that shell sandbox; no test proof was weakened.

Remaining requirements for a later authorized integration/operations session:

1. Integrate this local branch with Claude's authenticated Admin caller using the versioned producer output; exercise real producer-to-UI compatibility and the prescribed fresh/stale/unknown/error display states.
2. Run the normal shipping certification on that combined head when integration is authorized. This branch's focused verification is not a substitute for those gates.
3. Under PDC's sole operational authority, measure representative current canonical tasks through a real scheduled cycle: existing reservation allocation, admissions and refusals, lease recovery, bounded worker results, actual source failures/retry times and measured provider spending. No live root cause or throughput gain is proven here.
4. Reproduce the applicable publication/reader proof for the selected class under the unchanged PDC/single-door contracts. Live model audit, promotion authority, served-reader verification and generic unsupported class burdens remain independent requirements.
5. Refresh historical ZIP/readiness inputs through existing canonical producers, map prepared shared references to existing acquisition obligations, finish the current playbook requirements and reader checks. Activation of new ZIPs remains unauthorized by this assignment.

There is no newly discovered decision requiring the owner's intervention to complete this isolated implementation. Pending integration/production permission is a scope boundary, not a fabricated Needs Sean question or a PDC completion item.

## Final local verification

All six finite acceptance items above are met at the expressly isolated/preparation boundary. Full ZIP completion, Admin UI integration and production proof are not claimed.

| Check | Result |
| --- | --- |
| Combined focused failure/recovery/query/projection tests | **82 passed, 0 failed, 0 skipped**, 15,085.2322 ms; [actual TAP](fleet-engineering-focused.tap) |
| Full repository `node node_modules/typescript/bin/tsc --noEmit --incremental false` | Passed after correcting new test fixture typings and assertions against the real stage vocabulary |
| ESLint on all 11 added/changed TypeScript files | Passed |
| `git diff --check` | Passed |
| `node scripts/agents-sync.mjs --check`; `node scripts/check-claude-size.mjs` | Passed; governance files unchanged |
| Independent bounded review of coordinator/runtime/acquirer changes | No actionable regression; remaining Scout-only planning cost explicitly outside the measured improvement |

The combined test command was:

```text
node --test --test-concurrency=1 --test-reporter=tap --experimental-strip-types --import ./scripts/register-test-loader.mjs tests/fleet-coordinator-progression.test.ts tests/fleet-operations.test.ts tests/fleet-operations-route.test.ts tests/fleet-recovery-journey.test.ts tests/zip-queue.test.ts tests/new-zip-readiness.test.ts tests/worker-fleet-coordinator.test.ts tests/worker-fleet-research.test.ts tests/worker-fleet-recovery.test.ts tests/worker-fleet-runtime.test.ts tests/worker-fleet-activity.test.ts tests/worker-fleet-generalized.test.ts tests/research-progression.test.ts
```

Initial new coordinator regressions failed **3/3** on the pinned implementation before repair. The pinned existing coordinator suite passed **13/13** once the shell-sandbox esbuild restriction was identified. These distinguish newly confirmed defects from environment failures and inherited behavior. The final combined run includes both those controls and the recovered-source, publication-boundary, reporting and ZIP cases.
