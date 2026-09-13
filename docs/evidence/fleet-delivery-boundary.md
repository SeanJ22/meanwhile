# Fleet delivery boundary: isolated reader output and truthful joins

This is a follow-up to the preserved `58d5cdc7077c33d06f20d5e0c5a8066736e506c2` branch state. Earlier recovery evidence is unchanged. The new work owns `lib/control-plane/fleet-delivery.ts`, `tests/fleet-delivery.test.ts` and this evidence; the fleet root session owns its integration into `fleet-operations.ts`.

## What follows the previous 36 AUDITED facts

| Boundary | Existing requirement | Actual isolated result |
| --- | --- | --- |
| `AUDITED` → `APPROVED_FOR_PROMOTION` | `projectFactChains` checks `CHAIN_CHECKS_PASS`, `CONTROLS_MEASURED_CLEAN`, `FACT_CURRENT`, `FRESHNESS_NOT_STALE`, `RECORD_CLASS_CANDIDATE` | Initially all 36 remained held with `FRESHNESS_NOT_STALE: NOT_SCHEDULED`. The test used existing `promotedFactsProvider`, `buildRegistry`, `syncObligations` to register the two existing fact/body cadence obligations in memory. All five approval burdens then passed for all 36. No second freshness definition or live registration was added. |
| Approval → window decision | `evaluateItems`: approved chain and class open at the supplied gate | The actual live activation gate remained OFF with no open classes; all 36 actual-gate decisions were `REFUSE_WOULD`. The existing isolated `shadowAuthority` permits the two fixture classes only at a SHADOW target. Its as-if evaluation returned 36 `PROMOTE_WOULD`. |
| As-if decision → materialization | `promoteFacts`: enabled appropriate authority, open supported class, loaded exact fact, no hold, valid existing snapshot; agendas require a held or accompanying sitting | The existing promoter wrote 36 fact projections into a temporary copy of the committed snapshot, preserving before bytes and a receipt with before/after hashes. No live window was run. |
| Materialization → local readback | Existing `verifyMaterialization`, then exact receipt-byte and source-fact comparison | Existing verification passed. The new read-only helper re-read the actual canonical snapshot, matched its bytes to the receipt, validated it, and required `projectFactToReader` to return `UNCHANGED` for each exact fact. All 36 matched. |
| Local readback → reader data output | Existing `makeSnapshotSource.fetch` and `normalize` over that explicit temporary root | The actual reader data adapter returned the 18 promoted meeting rows, each with its expected canonical body, source URL and agenda URL. No server, browser, production query or deployed-site request was used. |
| Local output → served production proof | Existing deployment/reader observation and authority contracts | Deliberately not attempted. SHADOW output never implies READER publication or served-site proof. |

These source inputs are the existing recorded Pima Legistar fixture, not fresh publisher requests. The test exercises real worker procedures, canonical adapter, approval evaluator, promoter, snapshot writer, reader adapter and formatting. Its fixture SCOUT/ACQUIRER holdings are distinct local attempts over recorded input; they are not represented as two new live acquisitions.

## Actual result

The new run advanced beyond the earlier AUDITED boundary: **36 approved facts → 36 SHADOW materialized facts → 36 source-matched readbacks → 18 actual reader-adapter meeting rows**. The live gate stayed **OFF**, **zero reader facts were published**, **zero live windows ran**, and the committed snapshot's hash was unchanged. The existing `readFleetOperations` service returned all 36 nested delivery items as `SHADOW_READBACK_VERIFIED` while retaining its outer `publication.status: UNKNOWN` for served-reader proof.

One actual rendered output was Pima Board of Supervisors meeting `legistar:pima:1804`, June 9, 2026 at `5:00 PM MST`, with its official agenda link, Clerk of the Board attribution and `CONCLUDED` status. The exact machine-produced row appears in [fleet-delivery-boundary.tap](fleet-delivery-boundary.tap).

## Versioned read-only reporting contract

`projectFleetDelivery({ activity, windows, receipts?, readbacks? })` is pure. `activity` is the existing attributed activity record; `windows` is one shared read of canonical `windowRuns`; optional receipts are full existing `PromotionReceipt` values. The projector does not load paths, append records, dispatch work or alter policy. Its nested version is `fleet-delivery/v1`; the existing outer fleet API version and served-publication status are unchanged.

| Field | Meaning and provenance |
| --- | --- |
| `receiptAvailability` | `PROVIDED` or `NOT_PROVIDED`; omission is not an empty successful receipt ledger. |
| `items[].itemId`, `recordClass`, `subjectId` | Existing `deriveItemState` over canonical append order. |
| `source` | SCOUTED artifact IDs and canonical URL; `FLEET_EXTRACTION` fact key, source key and work-item ID. A valid join requires attributed artifact metadata for the same work item. |
| `recordedStage`, `approvalRecordId`, `pipelineRefusalReasons` | Recorded chain state and exact accepted approval/refusal records. Historical refused offers remain visible after later approval. |
| `windowDecisions` | Exact canonical item-ID match, ordered by `finishedAt`, with mode, verdict, reason and existing receipt summaries. Summaries are explicitly `WINDOW_ONLY_NOT_PER_ITEM`; a batch count never proves that this item materialized. |
| `receipts` | Full receipts matched by exact item ID; accepted materialization also requires exact record class and fact key. Contains receipt ID, target, window ID, materialized/reverted flags, recorded post-write verification, refusal and local readback. A specified window must match an existing exact item decision. |
| `readbackObservedAt`, `readbackScope` | Timestamp and `LOCAL_SNAPSHOT` scope of the supplied observation. The latest observation wins, including a later failure. This is evidence observation time, not a new data-freshness clock. |
| `status` | `HELD` for a recorded refusal or missing approval; `SHADOW_READBACK_VERIFIED` only for exact successful local SHADOW materialization/readback; `READER_MATERIALIZED_UNPROVEN` still lacks served proof; otherwise `UNKNOWN`. |
| `gaps` | Exact missing or contradictory evidence, including missing full receipts, unmatched windows, invalid clocks, changed snapshot bytes, wrong fact identity, reversal, failed post-write verification, unsupported projection and unobserved served-reader proof. |

`readFleetReceiptReadback(receipt, { root, items, observedAt })` is the optional filesystem reader. The caller must explicitly supply the root and exact source `FactItem` collection from `collectFactChains`. The helper refuses a different receipt target or snapshot path before any read. It then checks exact bytes and actual Reader projection. An unread or invalid snapshot returns named gaps; it never becomes an empty successful snapshot. Receipt paths are not followed by the Admin GET projection.

Example response excerpt (field values illustrate the verified SHADOW state; actual item IDs and data remain in the runtime response):

```json
{
  "version": "fleet-delivery/v1",
  "receiptAvailability": "PROVIDED",
  "items": [{
    "recordedStage": "APPROVED_FOR_PROMOTION",
    "status": "SHADOW_READBACK_VERIFIED",
    "gaps": ["WINDOW_DECISION_NOT_RECORDED", "SHADOW_DOES_NOT_PROVE_SERVED_READER"]
  }]
}
```

The window gap above is intentional: the direct isolated promoter exercise did not fabricate a scheduler window. With only ordinary window receipt summaries, full per-item receipts remain `NOT_PROVIDED`; item-level materialization stays unknown. No field means “freshly served.” Snapshot hash drift and later failed readbacks remove the successful local-delivery classification. Existing outer fleet read freshness/error envelopes continue to govern request freshness and store errors.

## Verification

```powershell
node --experimental-strip-types --import ./scripts/register-test-loader.mjs --test --test-concurrency=1 --test-reporter=tap tests/fleet-delivery.test.ts
```

Actual output: **5 passed, 0 failed, 0 skipped**, **1550.5894 ms**. This is one bounded verification run, not a performance improvement claim. Esbuild requires the already approved outside-sandbox fixture test invocation. No network or live resource is accessed by the test.

Negative controls cover batch-count-only receipt summaries, reversed input ordering for windows, missing readback, wrong fact key, invalid receipt clock, failed/reversed receipts, window/receipt contradiction, a receipt both accepting and refusing the same item, wrong root, missing source facts, changed snapshot bytes, a later failed readback after a successful one, and a wrong reader title despite a matching meeting ID. Contradictory acceptance/refusal produces `RECEIPT_ITEM_ACCEPTANCE_REFUSAL_CONTRADICTION` and remains `HELD`. The reporting-only window fixture is labeled as a fixture and never written to the repository or claimed as an executed window.

## Remaining ownership and integration requirements

| Exact dependency | Remaining behavior | Owner |
| --- | --- | --- |
| `fleet-operations.ts::readFleetOperations` / authenticated fleet GET | Join nested delivery via one canonical window read; preserve outer served status UNKNOWN and receipt-not-provided gaps | Fleet root; implemented and exercised by this test |
| Full `PromotionReceipt` storage at `promotion/promoter.ts::RECEIPTS_DIR` versus `windowRuns[].promotionReceipts` summaries | Supply verified full receipt artifacts to reporting through an authorized trusted store adapter; do not treat arbitrary stored paths as authority or per-item proof | Fleet/backend integration owner after transition; pending production integration, not a PDC proof obligation |
| `promotedFactsProvider` → existing obligation sync | Verify real source/body fact obligations are registered and existing freshness readings are valid on the integrated runtime | Fleet/backend integration owner; local memory path proven, production registration untouched |
| Canonical `readSnapshot` / actual deployed reader observer | Bind production-target receipt, integrated snapshot/deploy identity and observed served output before any served-success status | Authorized post-transition integration owner using existing proof contracts; pending live proof |
| Existing live gate and class authorization | Preserve actual READER/TRUTH/FRESHNESS requirements and any genuine owner class decision; no SHADOW authority on READER | Existing authority contracts; unchanged. PDC exclusively controls production operations during its transition. |
| Generic publishing classes | Implement their own approved record-class projection and verification before reporting delivery | Fleet/backend domain owner in separately bounded work; explicitly unimplemented here |
| Admin presentation | Render stage, hold, source identity, missing receipt/readback and SHADOW distinction from the versioned backend contract | Claude; UI integration pending |

No PDC proof contract, policy, migration, credentials, runner, deployment or production state changed. No shared CI, push, merge, expansion activation or production dispatch occurred. Remaining fleet integration is assigned to fleet/backend owners; these results do not enlarge PDC's completion denominator.
