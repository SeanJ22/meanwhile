# Fleet recovery and representative verified-output evidence

Scope: isolated local verification on `fleet/isolated-progression-20260913`, based on `713e4e06f9fba7319c14d8af90f12ac1a38e3e8f` from `SeanJ22/meanwhile`. This evidence belongs to fleet engineering, outside PDC's completion denominator.

## Confirmed causes and bounded repairs

1. **One invalid cached candidate prevented examination of later valid held evidence.** In the base `lib/control-plane/workers/acquirer.ts`, the first failed cache identity check returned `BLOCKED` immediately. The worker now checks remaining explicitly supplied immutable candidates using the same project, work-item, URL, source, bytes, identity, current-until, partial-response and provenance requirements. A separately valid candidate can progress without a request. The failed candidate retains a named walk entry and warning. If no valid alternative exists, the original fail-closed boundary remains: integrity failure does not authorize a network fetch.
2. **A failed refresh hid a prior successful acquisition from unfinished computation.** The base coordinator's downstream acquisition selection used the newest result irrespective of verdict. A newest `BLOCKED` result with no complete artifacts therefore prevented parsing the earlier capture. The root-owned coordinator repair selects the newest successful acquisition for dependent computation while evaluating current source health/retry from the newest acquisition result. The regression runs a successful fixture acquisition, advances the existing schedule to refresh due time, injects a transport timeout, and completes parsing, validation and audit of retained evidence. Its next action remains `SCOUT`; the failed refresh is still owed and both historical results survive.

The expired-worker path already exists. It was reused rather than replaced: `sweepExpiredLeases`, canonical Attempts and RouteTasks, `workerTaskAdmission`, existing capped backoff, result reconciliation and `completeWorkerTask` lease/identity checks. An unexpired lease is not treated as dead. No ledger, freshness clock, coverage definition, retry policy or proof authority was added.

## Actual representative journey

`tests/fleet-recovery-journey.test.ts` uses the existing `isolatedFactPlane`/`factChainHarness`, memory repositories and a temporary durable vault. It holds the existing recorded Pima Legistar JSON fixture through separate fixture SCOUT and ACQUIRER attempts. These are recorded-input test acquisitions, **not two new live publisher requests or live independent confirmation**.

The real bounded parser completes its computation, but the test withholds the durable worker-result boundary to represent process loss. The live lease prevents duplicate admission. After that fixture lease expires, the real supervisor marks the old attempt `LEASE_EXPIRED`; the late result is refused. The existing retry delay still blocks premature dispatch. After the fixture clock reaches that delay, one new parser attempt commits. A repeat drain produces no duplicate result. The real validator and deterministic independent-context auditor run in isolated worker processes, then `projectFleetPipeline` delegates the meeting class to the existing fact-chain verifier.

The executed result was:

| Measurement | Actual value |
| --- | ---: |
| Meeting-time facts | 18 |
| Agenda facts | 18 |
| Facts with every `VERIFIED` check `PASS` | 36 |
| Facts at `AUDITED` | 36 |
| Facts approved for promotion | 0 |
| Facts published | 0 |
| Canonical attempts | 6 |
| Expired attempts retained | 1 |
| Committed worker results | 3 |
| Cost ledger rows | 3 |
| Recorded requests on those rows | 0 |
| Known-dollar subtotal | $0 |
| Rows with dollar cost unmeasured | 3 |

The dollar subtotal is not measured total spending. The expired pre-commit computation has no committed cost row; no cost is invented for it. No model transport was attached. This demonstrates machine verification of a bounded recorded-input meeting/agenda journey, not generic publishing readiness, live model review, whole-source completeness or production publication. Approval remains withheld by the existing unscheduled freshness burden on this isolated plane. The test does not register a replacement freshness obligation or alter the live activation gate.

The existing `tests/worker-fleet-recovery.test.ts` separately kills its own child process after real durable artifact attribution, reopens its file repositories, reclaims the lease and resumes. It passed: the original acquisition attempt and bytes survive, one resumed acquired result reuses them, subsequent parser/validator/auditor work reaches `STAGED`, and no civic disposition is fabricated. This process is created solely by the test; no other session's process is inspected or stopped.

## Verification and reproducibility

Actual runner output, including the JSON measurement record, is checked in as [fleet-recovery-journey.tap](fleet-recovery-journey.tap). Command:

```powershell
node --experimental-strip-types --import ./scripts/register-test-loader.mjs --test --test-concurrency=1 --test-reporter=tap tests/fleet-recovery-journey.test.ts tests/worker-fleet-research.test.ts tests/worker-fleet-recovery.test.ts
```

Result: **14 passed, 0 failed, 0 skipped**, runner duration **4832.2905 ms**. This duration is a single isolated verification measurement, not a production performance claim. In the initial sandbox invocation, esbuild could not read the clone and the existing subprocess test failed on `Access is denied`; the exact offline tests passed with approved sandbox escalation. No proof expectation was changed to accommodate that environment failure.

The new regression coverage includes invalid-first/valid-second cache recovery; no valid alternative; expired and partial alternatives; foreign work-item and project provenance; unknown permission without held evidence; failed refresh with retained downstream work; live-lease exclusion; expired-lease recovery; unchanged backoff; late result refusal; history/attribution preservation; no duplicate committed computation; all existing meeting verification checks; and withheld publication. Existing research controls still pass for corrupt bytes, permission refusal, transport failure, partial/empty/zero-byte responses and unsupported identity claims.

## Shared dependencies and remaining proof

| Exact interface or file | Required behavior | Owner / status |
| --- | --- | --- |
| `lib/control-plane/workers/coordinator.ts::nextAutonomousOperation` | Preserve newest source failure while allowing unfinished computation from last successful held acquisition | Fleet root session; implemented and regression verified |
| `lib/control-plane/workers/acquirer.ts::runAcquirer` | Rehash and bind every cache alternative, retain failed-candidate diagnostics, no integrity-triggered network fallback | Fleet recovery subtask; implemented and verified |
| `lib/control-plane/repository/worker-completion.ts::completeWorkerTask` | Refuse late/stale results; preserve canonical result/attempt boundary | Existing contract; reused unchanged |
| `lib/control-plane/scheduler/dispatch.ts::sweepExpiredLeases` | Reconcile committed results before reclaiming expired leases | Existing contract; reused unchanged |
| `lib/control-plane/workers/pipeline.ts::projectFleetPipeline` and `promotion/fact-chain.ts::projectFactChains` | Preserve exact meeting fact checks and distinguish verified/audited from publication | Existing contracts; reused unchanged; integration with operational reporting is fleet root's work |
| Admin backend operational interface | Expose preserved evidence, source failure, retry and publication separately | Fleet root computes the contract; Claude owns presentation/integration |
| Live supervisor, production freshness authority and publication proof | Verify actual scheduling/recovery and authorized publication after integration | Existing PDC session alone during transition; pending, untouched |

Before a production claim, the authorized integration owner must verify real persisted task/lease/result recovery on the deployed backend, confirm retained source history and actual provider metering, and obtain the existing live freshness/publication proofs for the exact integrated code. Source alternatives outside already held, grounded evidence still require their ordinary permission and validation checks. Generic publishing classes retain their existing unimplemented burdens. No production writes, fleet dispatch, expansion activation, credentials, migrations, runners, deployment, push, merge or shared CI occurred under this verification.
