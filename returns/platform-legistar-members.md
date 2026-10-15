# Returned: platform-legistar-members

lane: platform-legistar-members
owner: platform-legistar-members
writer: the platform-legistar-members lane
check: at-scale
ready: no step ids unknown
river: 493311674ed4c1f3d15c14f70e19e7be9b9f58aa
at: 2026-10-15T23:21:42Z
state: returned
fix_subject: fix:181958c0
fix: River · stream/platform-legistar-members — at-scale failed for platform-legistar-members: R3-LEGISTAR-MEMBERS (bdc50ebab): AT SCALE peak grows with the country: one-government-cold 425.90 MiB vs national-changed 464.54 MiB, so about 39 MiB comes from holding the changed national set. Name the stage that holds it and stream one g

## Failure

```
R3-LEGISTAR-MEMBERS (bdc50ebab): AT SCALE peak grows with the country: one-government-cold 425.90 MiB vs national-changed 464.54 MiB, so about 39 MiB comes from holding the changed national set. Name the stage that holds it and stream one government at a time so the national peak equals the single-government peak. Conflicts with CP-01 (in the batch): lib/control-plane/repository/pg-schema.ts imports and tests/door-kinds-data-rows.test.ts.
```

## Repair

Fix on stream/platform-legistar-members and publish a new READY commit; River folds the new READY and clears this return when it integrates.
