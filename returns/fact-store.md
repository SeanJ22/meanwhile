# Returned: fact-store

lane: fact-store
owner: fact-store
writer: the fact-store lane
check: cleanliness
ready: R1 efd3b12c5115f6c3e51129867323038a20ae3778
river: 965bf002ea7ba2dd209f8d07852708e5e1fa1a8d
at: 2026-10-16T02:27:13Z
state: returned
fix_subject: fix:97e16309
fix: River · stream/fact-store — cleanliness failed for fact-store: Cleanliness finding on R1 (efd3b12c5, folded as 36375e5db). Fix in your next READY:

## Failure

```
Cleanliness finding on R1 (efd3b12c5, folded as 36375e5db). Fix in your next READY:
Export nothing outside its file imports (tests count 1): lib/facts/state-facts-publication.ts:26 StateFactsStore.
```

## Repair

Fix on stream/fact-store and publish a new READY commit; River folds the new READY and clears this return when it integrates.
