# Returned: platform-novusagenda

lane: platform-novusagenda
owner: platform-novusagenda
writer: the platform-novusagenda lane
check: fold-conflict
ready: no step ids unknown
river: ac3ccf885d6de2934f43f931a3092f735f05f0e1
at: 2026-10-13T22:18:25Z
state: returned
fix_subject: fix:2eb3a868
fix: River · stream/platform-novusagenda — fold-conflict failed for platform-novusagenda: platform-novusagenda READY 1193ccace9dc conflicts with river 691c01dd0ff4 (releases 25 to 29) when merged alone. Conflicting files: lib/civic-data/derived-door-kinds.ts lib/control-plane/discovery/auto-crosswalk.ts lib/control-plane/discove

## Failure

```
platform-novusagenda READY 1193ccace9dc conflicts with river 691c01dd0ff4 (releases 25 to 29) when merged alone. Conflicting files: lib/civic-data/derived-door-kinds.ts lib/control-plane/discovery/auto-crosswalk.ts lib/control-plane/discovery/derived-wiring-reading.ts lib/control-plane/discovery/derived-wiring.ts lib/hunt/meetings-recipes.ts lib/hunt/meetings-site-discovery.ts lib/registry/source-wiring.ts lib/registry/types.ts lib/sources/composite/wiring.ts tests/door-kinds-data-rows.test.ts   Merge river into stream/platform-novusagenda, resolve, and mark READY again.
```

## Repair

Fix on stream/platform-novusagenda and publish a new READY commit; River folds the new READY and clears this return when it integrates.
