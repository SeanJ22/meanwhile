# Fleet follow-up delivery

Repository: `https://github.com/SeanJ22/meanwhile.git`.
Independent clone: `C:\Users\seanj\dev\meanwhile-fleet-engineering-20260913`.
Branch: `fleet/isolated-progression-20260913`.
Follow-up base: `58d5cdc7077c33d06f20d5e0c5a8066736e506c2`, preserved with its
original evidence. Initial pinned repository base remains
`713e4e06f9fba7319c14d8af90f12ac1a38e3e8f`.

## Three finite results

1. **Delivery boundary verified in isolation.** The old 36 VERIFIED/AUDITED,
   zero-publication run did not complete delivery. The new control uses existing
   fact-cadence registration, approval, shadow authority, promoter, verification
   and actual reader adapter: **36 approved facts → 36 shadow materializations
   → 36 exact source/projection readbacks → 18 reader meeting rows**. Live gate
   OFF, zero served publication, zero live windows, committed snapshot unchanged.
   [Detailed transition evidence](fleet-delivery-boundary.md).
2. **Operational joins implemented.** Admin reads exact item/window verdicts,
   source and approval identities; trusted internal callers can supply full
   receipt/readback evidence. Window summaries never become per-item proof.
   Scout family/history/backoff is shared with the existing coordinator and
   reports the next prerequisite without granting admission. Unrelated Scout
   paths stay unjoined. Missing or failed evidence remains UNKNOWN/unavailable.
   [Claude compatibility contract and dependencies](../fleet-operations-compatibility-v1.1.md).
3. **Canonical ZIP planning executed without side effects.** 125 shared
   references map to 272 provider obligation IDs, including 17 validated
   historical task links. The plan names 23 unsupported reference mappings and
   five separate missing coverage assignments. It does not claim those
   historical tasks are currently runnable, create tasks, or activate 85122.
   [Mapping evidence](fleet-zip-acquisition-plan.md) and
   [actual named plan](fleet-zip-acquisition-plan.example.json).

## What remains, by kind

| Kind | Exact boundary |
| --- | --- |
| Missing integration implementation | HTTP reporting has no trusted full-receipt loader/retention adapter or authorized served-reader evidence adapter. The implemented pure joins and explicit-root local reader accept existing types; their isolated service integration is tested. These remaining adapters belong to Fleet/integration. |
| Deliberate holds | Existing live promotion gate is OFF. The initial isolated approval hold was the existing NOT_SCHEDULED fact cadence; it cleared only after the existing two provider obligations were registered in memory. Freshness, permission, approval and publication requirements were not weakened. Current production cadence/holds were not inspected. |
| Isolation-produced evidence | Actual shadow snapshot bytes, exact receipt hash, unchanged canonical projections, reader normalization/rendering, refusal/reversal/drift/mismatch controls, Scout backoff/continuation behavior, and read-only provider/ZIP mappings. Recorded source fixtures and bounded worker controls are not fresh live acquisitions or a live model audit. |
| Later authorized production evidence | Current registration, source permission/freshness and acquisition; real scheduled admission/recovery and measured provider spending; actual authority-bound receipt and served-reader observation for the selected class. These cannot be certified by replaying fixtures. |
| Bounded planning gaps | Unsupported geographic-to-provider identities, four source-refresh mappings, and five tier/playbook-to-obligation mappings. They need Fleet engineering and current canonical reads; they are not evidence that a public source is absent or that the full universe is covered. |
| Outside this representative class | Generic publishing projections remain class-specific future work; no claim that every publishing class now works. |

Existing implementation ownership is preserved: all runtime logic stays in
`lib/control-plane`; the thin authenticated API is reused unchanged. No UI,
authority/proof contract, scheduler policy, migration, runner or production
resource was modified. New files are delivery/Scout/ZIP read projections, focused
tests and evidence. The only existing runtime refactor shares the coordinator's
Scout history/debt calculation with its reporting consumer.

## Verification and limits

The [serialized focused TAP](fleet-followup-focused.tap) reports **96 passed,
0 failed, 0 skipped**, in **18,439.0242 ms**. It includes the original focused
progression/recovery/reporting checks plus delivery, Scout and acquisition-plan
controls. This is observed test duration, not a throughput improvement claim.
The prior 82-test TAP and journey evidence remain untouched.

Full repository TypeScript checking (`tsc --noEmit --incremental false`) and
targeted ESLint across all nine changed/new TypeScript files both exited 0.
Earlier handoff/evidence files were compared against `58d5cdc7` and remained
byte-unchanged.

Read-only process inspection found other Claude and Node work. Verification was
serialized and bounded to isolated fixtures/resources; no full build, full test
suite, server, shared CI or port was started. Esbuild-based offline controls used
the approved shell-sandbox escalation for the exact test command. No production
configuration was opened, source fetched, fleet dispatched, or external change
published.

Review found and fixed three integration edge cases before closeout: append-only
window rows are values rather than aggregate wrappers; projection errors must
retain typed outcomes and independent sections; a receipt both accepting and
refusing an item must remain held. Each has a focused negative control.

The [finite post-PDC checklist](../fleet-operations-compatibility-v1.1.md#finite-post-pdc-live-verification-checklist)
belongs to Fleet/integration after an explicit operational handoff and
authorization. PDC's completion denominator does not expand. No production
operation, live dispatch, policy change, push, merge or deployment was performed.
