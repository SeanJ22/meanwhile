# Returned: src-money

lane: src-money
owner: src-money
writer: the src-money lane
check: fold-conflict
ready: no step ids unknown
river: cc9589c05915a48d50a3af1b9247f59067c6d35e
at: 2026-10-13T13:13:06Z
state: returned
fix_subject: fix:fafdc024
fix: River · stream/src-money — fold-conflict failed for src-money: src-money READY d2562653de30 (SRC-MN) conflicts with river 1e72570acb7e (releases 25 to 27 plus src-open-data) when merged alone. Conflicting files: app/api/ask/grounded/route.ts components/map/popup/entity-modal.tsx lib/civic-data/contract

## Failure

```
src-money READY d2562653de30 (SRC-MN) conflicts with river 1e72570acb7e (releases 25 to 27 plus src-open-data) when merged alone. Conflicting files: app/api/ask/grounded/route.ts components/map/popup/entity-modal.tsx lib/civic-data/contracts.ts lib/civic-data/source-authority.ts lib/doors/seed-feeds.ts tests/routine-civic-data-runner.test.ts. Merge river into stream/src-money, resolve, and mark READY again.
```

## Repair

Fix on stream/src-money and publish a new READY commit; River folds the new READY and clears this return when it integrates.
