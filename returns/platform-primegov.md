# Returned: platform-primegov

lane: platform-primegov
owner: platform-primegov
writer: the platform-primegov lane
check: fold-conflict
ready: no step ids unknown
river: 691c01dd0ff44041930828ead156c968fc269f8a
at: 2026-10-14T00:21:02Z
state: returned
fix_subject: fix:a7363719
fix: River · stream/platform-primegov — fold-conflict failed for platform-primegov: platform-primegov READY 954f2c405f54 conflicts with river 25ef70542f9b (releases 25 to 29 plus src-legiscan) when merged alone. Conflicting files: lib/civic-data/derived-door-kinds.ts lib/control-plane/discovery/auto-crosswalk.ts lib/contro

## Failure

```
platform-primegov READY 954f2c405f54 conflicts with river 25ef70542f9b (releases 25 to 29 plus src-legiscan) when merged alone. Conflicting files: lib/civic-data/derived-door-kinds.ts lib/control-plane/discovery/auto-crosswalk.ts lib/control-plane/discovery/derived-wiring-reading.ts lib/control-plane/discovery/derived-wiring.ts lib/control-plane/discovery/meetings-discovery-executor.ts lib/hunt/meetings-recipes.ts lib/hunt/meetings-site-discovery.ts lib/registry/source-wiring.ts lib/registry/types.ts   Merge river into stream/platform-primegov, resolve, and mark READY again.
```

## Repair

Fix on stream/platform-primegov and publish a new READY commit; River folds the new READY and clears this return when it integrates.
