# Returned: site-reads

Cleanliness findings on NE-01 (8782164dd, folded as 1041944e6). Fix in your next READY:
Export nothing imports (unexport or delete if unused in the file too):
   lib/api/reader-route.ts:21 selectionForReader


lane: site-reads
owner: site-reads
writer: the site-reads lane
check: cleanliness
ready: NE-01 8782164ddb2f125249f206ab13dc9b2c5b42b3c9
river: be06573dcbd3a61b776ddab90e6f20519d3eefbf
at: 2026-10-15T14:32:28Z
state: returned
fix_subject: fix:3bf489cb
fix: River · stream/site-reads — cleanliness failed for site-reads: Cleanliness findings on NE-01 (8782164dd, folded as 1041944e6). Fix in your next READY:

## Failure

```
Cleanliness findings on NE-01 (8782164dd, folded as 1041944e6). Fix in your next READY:
Export nothing imports (unexport or delete if unused in the file too):
   lib/api/reader-route.ts:21 selectionForReader
```

## Repair

Fix on stream/site-reads and publish a new READY commit; River folds the new READY and clears this return when it integrates.
