# Returned: platform-municode

lane: platform-municode
owner: platform-municode
writer: the platform-municode lane
check: fold-conflict
ready: no step ids unknown
river: ac3ccf885d6de2934f43f931a3092f735f05f0e1
at: 2026-10-13T22:18:16Z
state: returned
fix_subject: fix:f15eb6d1
fix: River · stream/platform-municode — fold-conflict failed for platform-municode: platform-municode READY 5c89ee84a2a7 conflicts with river 691c01dd0ff4 (releases 25 to 29) when merged alone. Conflicting files: lib/civic-data/derived-door-kinds.ts lib/civic-data/meeting-partitions.ts lib/control-plane/discovery/auto-cros

## Failure

```
platform-municode READY 5c89ee84a2a7 conflicts with river 691c01dd0ff4 (releases 25 to 29) when merged alone. Conflicting files: lib/civic-data/derived-door-kinds.ts lib/civic-data/meeting-partitions.ts lib/control-plane/discovery/auto-crosswalk.ts lib/control-plane/discovery/derived-wiring-reading.ts lib/control-plane/discovery/derived-wiring.ts lib/control-plane/discovery/meetings-discovery-executor.ts lib/hunt/meetings-recipes.ts lib/hunt/meetings-site-discovery.ts lib/registry/source-wiring.ts lib/registry/types.ts lib/sources/composite/wiring.ts tests/door-kinds-data-rows.test.ts   Merge river into stream/platform-municode, resolve, and mark READY again.
```

## Repair

Fix on stream/platform-municode and publish a new READY commit; River folds the new READY and clears this return when it integrates.
