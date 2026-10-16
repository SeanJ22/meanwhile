# Returned: platform-swagit

lane: platform-swagit
owner: platform-swagit
writer: the platform-swagit lane
check: cleanliness
ready: R3-SWAGIT ef48e7fbb3438987dcddcc3eaa6f14553e6793ba
river: 1d3d303d70dc9d14aab69d61ea9b0d76d76b6e6f
at: 2026-10-16T04:35:20Z
state: returned
fix_subject: fix:ac65defb
fix: River · stream/platform-swagit — cleanliness failed for platform-swagit: Cleanliness finding on R3-SWAGIT (ef48e7fbb, folded as 656062ece). Fix in your next READY:

## Failure

```
Cleanliness finding on R3-SWAGIT (ef48e7fbb, folded as 656062ece). Fix in your next READY:
Export nothing outside its file imports (tests count 1): lib/sources/swagit/index.ts:39 SWAGIT_MAX_PAGES_PER_TENANT.
```

## Repair

Fix on stream/platform-swagit and publish a new READY commit; River folds the new READY and clears this return when it integrates.
