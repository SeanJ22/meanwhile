# Fleet operations interface v1

**Status: implemented read service, authenticated endpoint and isolated controls; Admin UI wiring and production proof pending.**

The shared TypeScript contract is `lib/control-plane/fleet-operations.ts`:
`FLEET_OPERATIONS_VERSION = "fleet-operations/v1"`, `FleetOperationsReport`,
`FleetOperation`, `FleetTaskOperation`. `readFleetOperations(repos, { observedAt })`
is callable from an authenticated Admin server with its existing repositories.
It does not open a connection, invoke scheduling, fetch a source, or write a record.
The caller supplies the existing observation clock. This read is not a transaction
across every table and does not claim a historical, atomic snapshot at `observedAt`.

`GET /api/admin/fleet/operations` is an on-demand detail endpoint. It uses the
existing Admin host/session guard and returns `cache-control: no-store, no-cache,
must-revalidate`. The HTTP contract is:

| Status | Response |
| --- | --- |
| 404 | Empty body on a public host. |
| 401 | Existing guard response `{ "says": "…" }` for an unauthorized Admin request. |
| 503, connection unavailable | `{ formatVersion, observedAt, error: { code: "CONTROL_PLANE_UNAVAILABLE", detail } }`; no fleet facts were read. |
| 503, activity read failed | `FleetOperationsReport` with `operations.kind = "STORE_UNREACHABLE"`; independently readable sections may still be held. |
| 200 | `FleetOperationsReport`; missing or unavailable coverage/decision sections retain their own typed outcomes. HTTP success alone never means every section was measured. |

## Fields, meaning, and provenance

| Field | Existing evidence reused | v1 projection and limits |
| --- | --- | --- |
| `formatVersion` | New response contract | Exact version above. Unknown versions require a new consumer implementation. |
| `observedAt` | Caller observation time | Read/lease/admission evaluation time; never a second source freshness clock. |
| `operations` | `workers/activity.ts:readAutonomousActivity` | Existing `ReadOutcome<T>` envelope. HELD can contain an empty list; that means the queried canonical work-item store contains no rows. |
| `workItemId`, `subject`, `stage` | `WorkItem.id`, `.subject`, `.state` | Canonical state copied intact; a worker's RESULT_RECORDED does not mean parent completion or publication. |
| `path` | `WorkItem.autonomousPlan`, `RouteTask.workerTask` | AUTONOMOUS_PLAN, REGISTERED_WORKER_TASKS without a plan, or OTHER_REGISTERED_WORK. Registration alone never implies autonomous eligibility. |
| `lastProgress` | Attributed activity timeline | Latest successful, non-diagnostic worker result, INGESTED disposition, or nonpartial bytes cited by an ACQUIRED result/INGESTED disposition. Attempt lifecycle and failed results do not advance it; auxiliary permission-check bytes acquired during failed work do not masquerade as civic acquisition. Successful computation is still not independently verified truth. Null if none. |
| `lastActivity` | Same timeline | Latest event including attempt lifecycle and creation. A retry can move this while yielding no new evidence. |
| `tasks[].state`, `.path` | `RouteTask` | Computational workers versus route-disposition/Scout tasks remain distinct. |
| `tasks[].admission` | `workers/scheduling.ts:workerTaskAdmission` | Exact existing due/backoff/policy reading for worker computations. Null for other paths; they must not inherit this helper's non-worker TERMINAL result. DUE is not a resource reservation or dispatch promise. |
| `tasks[].blocker` | Admission reason, policy denial required change, canonical lease | Live lease prevents duplicate execution; inactive/missing lease with in-flight work requires reconciliation. No owner decision inferred from a policy blocker. Null means no blocker established by these inputs, not globally dispatchable. |
| `tasks[].nextAutomaticAction` | Admission and claim state | Next prerequisite: admission check, policy recheck, wait for backoff, or lease reconciliation. UNKNOWN when this read cannot establish the path. NONE_FOR_THIS_TASK never closes its parent or publication tail. No runtime/runner liveness promise. |
| `tasks[].retryAt` | Existing admission/debt calculation | Canonical worker retry/due boundary, nullable. Not estimated from elapsed time; null for unjoined Scout scheduling. |
| `tasks[].lease` | Unreleased `ExecutionLease`, `attempt.ts:isExpired` | ACTIVE, EXPIRED, or NOT_RECORDED at `observedAt`. An expired lease does not authorize this reader to reset anything. |
| `sourceHealth.observations` | Existing evidence-walk steps | Permission, transport, rung outcome, observation time, next routes and artifact references retained intact. These are historical source observations, not today's permission grant or a live health check. |
| `sourceHealth.lastAcquired` | Attributed, committed ACQUIRER/ACQUIRED with nonzero bytes | Last held successful acquisition and its artifact IDs; independent of the latest failure. Acquisition is not independent verification, permission for a new fetch, or current freshness. |
| `sourceHealth.latestAcquisition` | Latest attributed committed acquisition result | Result ID, time and verdict reveal a subsequent failure without discarding the prior successful holding. |
| `sourceHealth.evidenceGaps` | Activity's existing attribution/expiry checks | Unproven or expired evidence remains named; never converted into a success count. |
| `publication.status` | Existing promotion facts, incomplete end-to-end join | UNKNOWN in v1: per-record promotion receipts and served-reader proofs are not joined by this service. |
| `publication.recordedStages` | Canonical promotion records associated by activity reader | Raw record ID, item ID, stage and time for drill-down. A recorded VERIFIED/APPROVED_FOR_PROMOTION label is not independently reproduced proof or publication. |
| `publication.recordedItems` | `promotion/pipeline.ts:deriveItemState` | Per canonical item, the recorded furthest stage, latest historical refusal and refusal count, plus any failed/unimplemented checks from its recorded VERIFIED stage. Historical refusals may predate later advancement; inspect refusal time. This reader does not re-certify the chain. |
| `publication.recordedItemStageCounts` | `promotion/pipeline.ts:stageCounts` | Existing counts by furthest recorded stage and record class, once per item. Never count each transition as a separately published fact. |
| `spending.usd` | `cost.ts:sumMetric` over canonical cost entries for the item | Existing nullable total, measured/unmeasured row counts, and completeness. Completeness applies to ledger entries only. |
| `spending.attemptsWithoutCostEntry` | Canonical attempts minus cost-entry attempt IDs | Explicit accounting gap, including active/unmetered attempts. Do not display the measured subtotal as all spending while these or unmeasured entries exist. |
| `coverageGaps` | Existing OwnerSnapshot `publishedAt`, `zipRows` | Reader-instrument ZIP failures and named gaps copied unchanged. This is not a replacement ZIP completion definition or expansion queue. Snapshot publication time remains visible. |
| `ownerDecisions` | OwnerSnapshot cards plus `readDecisions`, `latestDecisionFor`, `decisionCardKind` | Only unanswered DECISION cards marked NOT_MACHINE_VERIFIABLE with a nonempty reason only an owner can decide. Excludes acknowledgements and machine blockers. Answered/rejected intents are not silently re-presented as unanswered decisions; their lifecycle remains in the existing decision service. |

## Read and freshness behavior

The existing `ReadOutcome` vocabulary is unchanged: HELD, NOT_RECORDED,
STORE_UNREACHABLE. Missing snapshot rows are NOT_RECORDED; read failures are
STORE_UNREACHABLE, not empty rows or zero progress. Independent snapshot/decision
reads can still succeed when activity fails. If the decision log is unavailable,
the service cannot claim any snapshot card is unanswered and reports that error.
Errors expose the error class through existing `unreachable`, never its potentially
secret-bearing message. Invalid caller clocks are rejected before querying.

`fleetReadFreshness(lastSuccessfulReadAt, now)` uses Admin's existing
`live-pulse.ts:PULSE_STALE_MS` tolerance. FRESH/STALE describe delivery only.
`deliveryFreshness` is wired to that helper in the response: a complete successful
read is FRESH, any failed section read is UNKNOWN. A missing snapshot is still a
successful read with its explicit NOT_RECORDED gap. Consumers recompute staleness
against the retained observation time while displaying a cached response.
Missing, invalid, or future read times produce UNKNOWN. On a failed refresh the
consumer retains the last successful response with its original observation time
and shows the new STORE_UNREACHABLE outcome; it must not restamp old facts.
The owner snapshot retains its own `publishedAt`; a fresh query of an old snapshot
does not make its coverage or decisions current. Source/civic freshness still
belongs to the existing freshness/readiness contracts, not this helper.

## Example responses

Exact empty in-memory query response (fixed fixture clock; no production claim):

```json
{
  "formatVersion": "fleet-operations/v1",
  "observedAt": "2026-09-03T18:00:00.000Z",
  "deliveryFreshness": "FRESH",
  "operations": { "kind": "HELD", "value": [] },
  "coverageGaps": {
    "kind": "NOT_RECORDED",
    "detail": "The control plane is reachable and holds no control-centre snapshot record yet."
  },
  "ownerDecisions": {
    "kind": "NOT_RECORDED",
    "detail": "The control plane is reachable and holds no control-centre snapshot record yet."
  }
}
```

Example non-worker task member (fixture identifier abbreviated for readability):

```json
{
  "taskId": "fixture-route-task",
  "path": "ROUTE_DISPOSITION",
  "state": "PENDING",
  "admission": null,
  "blocker": null,
  "nextAutomaticAction": "UNKNOWN",
  "retryAt": null,
  "lease": "NOT_RECORDED"
}
```

## Implemented, isolated verification, and pending integration

Implemented: read service, typed paths and task prerequisites, source-history
preservation, nullable cost accounting, owner filtering, existing coverage passthrough,
safe failed-read behavior. `tests/fleet-operations.test.ts` runs the actual service
against canonical memory repositories and fixture acquisition; it checks empty versus
unavailable, legacy-path distinction, committed-result attribution, no publication
inference, admission, missing accounting, owner filtering, and delivery freshness.
These tests prove local behavior, not production worker progression.

| Exact shared seam | Required behavior | Owner / status |
| --- | --- | --- |
| `app/api/admin/fleet/operations/route.ts` | Authenticated, on-demand GET invokes the new read service through existing `guardAdminRequest` and `openControlPlane`. Existing `app/api/admin/live/route.ts` / `gateway/pulse-read.ts` stay unchanged; never scan all histories every 8-second active pulse. | Fleet engineering root implements endpoint and `tests/fleet-operations-route.test.ts`. |
| `FleetOperationsReport` exported by `lib/control-plane/fleet-operations.ts` | Claude imports the shared type; show unknown/error distinctly; retain original dates; never infer published from stage. A real producer-to-consumer compatibility test is required when wired. | Claude Code: UI integration pending. |
| `workers/scheduling.ts:workerTaskAdmission`, `scheduler/dispatch.ts:sweepExpiredLeases` | Preserve existing worker retry and lease-fencing authority; service only reports. Scout recurring-obligation admission is not wired into v1. | Fleet engineering. Runtime/isolated verification only. |
| `research-progression.ts:readResearchProgression` and promotion per-record/served-reader proof contracts | Existing validated research-window milestones remain the aggregate funnel authority. A future join must carry exact item/result/artifact identity into promotion and served proof; raw pipeline labels cannot substitute. | Fleet engineering query integration pending; PDC alone owns transition production operations and proof/authority contracts. No PDC contract changes requested. |
| Existing coverage requirements and ZIP preparation service | Expose prepared completion/expansion queue separately from the reader-suite ZIP grid; never reinterpret ZIP failure counts as the completion denominator. | Fleet engineering ZIP lane. Live expansion remains disabled. |

Live verification requires the integration owner to deploy through its authorized
path, then read representative production records and establish actual admission,
recovery, cost attribution and served-output proof. This assignment performs no
production reads/writes, dispatch, policy changes, deployment or expansion activation.
