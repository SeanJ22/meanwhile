# Fleet compatibility update v1.1

This is an additive update to `58d5cdc7`. Its three handoff files and all prior
evidence remain unchanged. The earlier journey stopped at 36 VERIFIED/AUDITED
facts and did **not** demonstrate delivery. The follow-up now verifies isolated
SHADOW output through the existing promoter and actual snapshot reader: 36
approved facts, 18 meeting rows, and 36 exact source/projection readbacks. It
still proves zero served publication. See the [boundary evidence](evidence/fleet-delivery-boundary.md).

Claude owns pages, components, interactions and styling. Fleet owns the services
and calculations below. Claude can consume these additions in its separate local
integration branch; no UI file changed here. PDC retains production operations
during transition and its completion denominator does not change.

## Compatible service additions

`GET /api/admin/fleet/operations` and its guard, HTTP statuses and no-store
behavior remain unchanged. `formatVersion` remains `fleet-operations/v1`;
successful report envelopes add `extensionVersion: fleet-operations/extensions/1`.
The connection-unavailable error envelope is unchanged. Consumers accepting the
original v1 fields continue to work; strict object validators and hand-written
TypeScript fixtures must accept the additive fields below. During integration
with an older producer, a missing extension is unavailable capability, not an
empty successful result.

| Field | Existing evidence reused; exact meaning |
| --- | --- |
| `tasks[].scoutAdmission` | New nullable reading from `workers/scout-scheduling.ts`. Only persisted autonomous Scout/novelty route families qualify. Unrelated route tasks, including other SCOUT-role attempts, retain null. |
| `scoutAdmission.familyRouteId`, `familyTaskIds`, `attemptIds`, `latestAttemptId` | Canonical RouteTask family and Attempt identities. Latest attempt belongs to this task; debt spans its existing family. No task is created by this read. |
| `scoutAdmission.debt`, `retryAt` | The coordinator and Admin now share its existing `recordFailure` calculation, including capped backoff and existing attempt causes. No retry policy changes. |
| `scoutAdmission.state`, `requiresPolicyRecheck`, `nextTaskId` | BACKOFF waits; POLICY_RECHECK requires the named transport or rolling-cost condition to change; TIMING_ELIGIBLE only permits admission evaluation; CONTINUATION_CANDIDATE still requires unresolved source work; CONTINUED identifies an already existing child; IN_FLIGHT requires lease reconciliation. POLICY_DENIED/UNKNOWN preserve unsupported automatic recovery. |
| `scoutAdmission.selection` | Always COORDINATOR_REEVALUATION_REQUIRED. The reading does not establish source need, current transport, permissions, cost allowance, concurrency or cycle reservation. |
| Existing `tasks[].nextAutomaticAction`, `retryAt`, `blocker` | Now populated from supported Scout evidence as well as worker admission. Worker `admission` remains null for Scout; its path remains ROUTE_DISPOSITION. These fields name prerequisites, never dispatch promises. |
| `publication.delivery` | New `ReadOutcome<FleetDeliveryReport>`; nested `version: fleet-delivery/v1`. Joins existing source identity, pipeline approval/refusal, and exact per-item window verdicts. Window batch receipt counts are explicitly WINDOW_ONLY_NOT_PER_ITEM. |
| `delivery.value.receiptAvailability` | NOT_PROVIDED for the HTTP service. Full receipts/readbacks can be supplied by a trusted internal caller for isolated verification; no HTTP parameter accepts them or arbitrary paths. PROVIDED means supplied evidence, not certified publication. |
| `delivery.value.items[].source` | FLEET_EXTRACTION source's canonical artifact, work-item, fact and source keys plus recorded URL; identity must match the held artifact and work item. Unsupported classes retain their projection gap. |
| `items[].recordedStage`, `approvalRecordId`, `pipelineRefusalReasons` | Existing append-ordered pipeline state. A historical refusal may coexist with later approval; these fields do not rerun certification. |
| `items[].windowDecisions` | Exact item ID joins to WindowRunRecord.pipeline.verdicts, with recorded time, mode, decision and reason. Empty means no joined recorded decision in the successfully read history. |
| `items[].receipts` | Full supplied receipt binds item ID, record class, fact key, authority, approval-before-receipt, optional window decision, post-write verification and reversal. Wrong/missing identity or failed evidence is retained as a gap. |
| `receipts[].readback`, `readbackObservedAt`, `readbackScope` | Explicit LOCAL_SNAPSHOT read using the existing snapshot validator, exact after-byte hash, canonical reader projection and rendering. Latest failed readback supersedes earlier success. This time is an observation, not a source freshness clock. |
| `items[].status`, `gaps` | HELD for established refusal or missing approval; SHADOW_READBACK_VERIFIED only for matching successful isolated materialization/readback; READER_MATERIALIZED_UNPROVEN still lacks served proof; UNKNOWN otherwise. Gaps explain evidence boundaries independently of status. |
| Existing `publication.status`, `reason` | Preserved UNKNOWN and original reason literal for compatibility. Treat this field as the conservative served-publication result; use the new delivery details to explain narrower evidence now joined. |

The service reads window history **once** per query, alongside the existing
activity/snapshot/decision reads. A window-store failure yields
`publication.delivery.kind: STORE_UNREACHABLE` while retaining independently
held operations. A pure projection without supplied window evidence yields
NOT_RECORDED. A successful empty window read is HELD with explicit per-item
WINDOW_DECISION_NOT_RECORDED gaps. No receipt paths found in stored summaries
are opened by the API.

Fresh/stale handling remains `fleetReadFreshness` using existing
`PULSE_STALE_MS`. Any failed section, including windows, makes response delivery
freshness UNKNOWN; stale retained responses keep their original observation
time. FRESH query delivery never refreshes civic facts, old window decisions or
local readbacks. Error detail uses the existing classified, redacted read
outcome. Permission and source-health observations remain historical.

## Consumer examples

Selected fields from the tested isolated service result, omitting item IDs and
other unchanged fields for brevity; this is not a complete JSON response:

```json
{
  "formatVersion": "fleet-operations/v1",
  "extensionVersion": "fleet-operations/extensions/1",
  "publication": {
    "status": "UNKNOWN",
    "delivery": {
      "kind": "HELD",
      "value": {
        "version": "fleet-delivery/v1",
        "receiptAvailability": "PROVIDED",
        "items": [{
          "recordedStage": "APPROVED_FOR_PROMOTION",
          "status": "SHADOW_READBACK_VERIFIED",
          "gaps": ["WINDOW_DECISION_NOT_RECORDED", "SHADOW_DOES_NOT_PROVE_SERVED_READER"]
        }]
      }
    }
  }
}
```

The direct isolated shadow control did not manufacture a scheduler window.
The HTTP service, without supplied full receipts, instead retains
FULL_ITEM_RECEIPTS_NOT_PROVIDED and any recorded window refusal reason. It never
upgrades a batch summary to a per-item delivered count.

Scout test example: a real offline denied Attempt produces BACKOFF with its
canonical retry time and WAIT_FOR_BACKOFF. At that exact boundary the reading
becomes POLICY_RECHECK. The real coordinator still returns BLOCKED when Scout
transport remains unavailable. Elapsed time alone never clears the policy hold.

## ZIP planning interface

`lib/control-plane/zip-acquisition-plan.ts::planZipAcquisition` accepts the
existing prepared queues, registry provider pass, held candidate corpora, explicit
meeting body/OCD membership and canonical historical occurrence/work/task rows.
It returns `fleet/zip-acquisition-plan@1`, PLAN_ONLY, NOT_AUTHORIZED activation,
and UNKNOWN runtime observation. See [exact mappings and limitations](evidence/fleet-zip-acquisition-plan.md)
and [the actual named plan](evidence/fleet-zip-acquisition-plan.example.json).

The 125 prepared references yield 80 direct candidacy mappings, 11 meeting-only
mappings, 11 no-owed-enrichment results, 23 missing assignments and zero
ambiguities. The plan references 272 real provider obligation IDs and 17
validated historical task links. It separately carries five missing typed ZIP
coverage assignments with unchanged tier/playbook requirements. Source-corpus
downstream reuse is distinct from its four missing source-refresh assignments.

This is executable, side-effect-free planning, not a runnable dispatch queue.
No `nextAutomaticAction` or `retryAt` is invented from historical holdings. Those
require fresh canonical registration, task and Attempt/admission reads; use the
existing scheduler and the operations projection after authorization. All
applicable held corpus records being reused does not establish the full
applicable universe. No live tasks or new-ZIP activation were created.

## Exact dependencies and ownership

| Interface/file | Required behavior and remaining integration | Owner |
| --- | --- | --- |
| `fleet-operations.ts::readFleetOperations`, `FleetOperationsReport`; `app/api/admin/fleet/operations/route.ts` | Preserve ReadOutcome distinctions, local-versus-served evidence, nullable Scout join and version handling in the actual Admin consumer. | Fleet backend; Claude UI/integration branch |
| `workers/scout-scheduling.ts::{autonomousScoutHistory,scoutTaskAdmission}`; `workers/coordinator.ts` | Shared calculation is implemented and tested; actual resource admission and existing reservations remain coordinator authority. | Fleet |
| `repository/types.ts::ControlPlaneRepositories.windowRuns`; `promotion/types.ts::WindowRunRecord` | Implemented read-only item/verdict join; batch receipt summaries lack complete per-item receipts. | Fleet consumer; existing window producer unchanged |
| `promotion/promoter.ts::PromotionReceipt`; `fleet-delivery.ts::readFleetReceiptReadback` | A trusted bounded receipt loader/retention path and authorized served-reader observation are still needed for HTTP publication proof. No arbitrary stored-path traversal or new proof contract. | Fleet/integration follow-up, not PDC delivery work |
| `promotion/{fact-chain,fact-freshness,promoter,activation-gate}.ts`; `scheduler/providers/promoted-facts.ts` | Existing approval, cadence, authority, projection and post-write checks reused unchanged. The isolated class journey is verified; live authority/cadence/receipts are unverified. | Fleet supplies evidence; existing authority contract unchanged; PDC operates production during transition only |
| `zip-acquisition-plan.ts::planZipAcquisition`; existing scheduler provider/registry/durable types | Resolve unsupported typed identity/source-refresh/coverage assignments; inspect current registered work before proposing an occurrence. No second ledger or ZIP denominator. | Fleet, with Claude rendering only |

## Finite post-PDC live-verification checklist

Owned by the **fleet/integration session after explicit operational handoff and
authorization**. PDC's existing transition is a prerequisite, not a request to
add these checks to PDC's completion denominator. None is executed here.

1. Pin the integrated SHA and exercise the actual authenticated Admin consumer:
   a held report, unavailable window store, stale retained report, unrelated
   Scout route and known autonomous Scout backoff. Preserve all UNKNOWN states.
2. Select one current Pima meeting/agenda work item and its existing registered
   fact-cadence obligations. Record exact work/task/attempt/source/item IDs,
   permission and freshness readings, policy holds, retry time and measured
   spending. Inspect before creating any missing canonical occurrence.
3. Observe one authorized scheduled cycle and one naturally due recovery using
   existing reservations, lease/CAS and backoff. Retain both attempt histories;
   verify no overlapping execution or late stale completion. Do not force an
   expiry, reset or spend-policy change for proof.
4. Under already valid promotion authority only, bind that item's actual window
   verdict, full receipt, byte hash and post-write/reversal checks to its actual
   served reader output. If authority/freshness/permission blocks it, record the
   exact hold and stop that transition; a held result is not publication proof.
5. Refresh the bounded five-ZIP plan against current canonical registrations.
   Reuse matching work; resolve the named identity/coverage/source-refresh gaps
   and independently verify source-universe completeness before claiming ZIP
   completion. New-ZIP activation remains separately unauthorized.

No new owner decision was discovered by these isolated controls. Unavailable
proof, missing mappings and future execution authorization are reported as
engineering/scope dependencies, not invented owner-choice cards.
