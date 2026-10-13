# Returned: platform-swagit

lane: platform-swagit
owner: platform-swagit
writer: the platform-swagit lane
check: fold-conflict
ready: no step ids unknown
river: ac3ccf885d6de2934f43f931a3092f735f05f0e1
at: 2026-10-13T22:18:40Z
state: returned
fix_subject: fix:77530885
fix: River · stream/platform-swagit — fold-conflict failed for platform-swagit: platform-swagit READY e6927e93132c conflicts with river 691c01dd0ff4 (releases 25 to 29) when merged alone. Conflicting files: lib/civic-data/derived-door-kinds.ts lib/control-plane/discovery/auto-crosswalk.ts lib/control-plane/discovery/de

## Failure

```
platform-swagit READY e6927e93132c conflicts with river 691c01dd0ff4 (releases 25 to 29) when merged alone. Conflicting files: lib/civic-data/derived-door-kinds.ts lib/control-plane/discovery/auto-crosswalk.ts lib/control-plane/discovery/derived-wiring-reading.ts lib/control-plane/discovery/derived-wiring.ts lib/hunt/meetings-recipes.ts lib/hunt/meetings-site-discovery.ts lib/registry/source-wiring.ts   Merge river into stream/platform-swagit, resolve, and mark READY again.
```

## Repair

Fix on stream/platform-swagit and publish a new READY commit; River folds the new READY and clears this return when it integrates.
