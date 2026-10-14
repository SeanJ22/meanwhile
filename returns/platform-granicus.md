# Returned: platform-granicus

lane: platform-granicus
owner: platform-granicus
writer: the platform-granicus lane
check: fold-conflict
ready: no step ids unknown
river: 691c01dd0ff44041930828ead156c968fc269f8a
at: 2026-10-14T00:20:57Z
state: returned
fix_subject: fix:7a30e49d
fix: River · stream/platform-granicus — fold-conflict failed for platform-granicus: platform-granicus READY 5cff50d6efb4 conflicts with river 25ef70542f9b (releases 25 to 29 plus src-legiscan) when merged alone. Conflicting files: lib/civic-data/derived-door-kinds.ts lib/control-plane/discovery/auto-crosswalk.ts lib/contro

## Failure

```
platform-granicus READY 5cff50d6efb4 conflicts with river 25ef70542f9b (releases 25 to 29 plus src-legiscan) when merged alone. Conflicting files: lib/civic-data/derived-door-kinds.ts lib/control-plane/discovery/auto-crosswalk.ts lib/control-plane/discovery/derived-wiring-reading.ts lib/control-plane/discovery/derived-wiring.ts lib/hunt/meetings-recipes.ts lib/hunt/meetings-site-discovery.ts lib/registry/source-wiring.ts lib/sources/composite/wiring.ts tests/door-kinds-data-rows.test.ts   Merge river into stream/platform-granicus, resolve, and mark READY again.
```

## Repair

Fix on stream/platform-granicus and publish a new READY commit; River folds the new READY and clears this return when it integrates.
