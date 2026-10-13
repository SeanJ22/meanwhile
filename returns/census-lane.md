# Returned: census-lane

lane: census-lane
owner: census-lane
writer: the census-lane lane
check: fold-conflict
ready: no step ids unknown
river: ac3ccf885d6de2934f43f931a3092f735f05f0e1
at: 2026-10-13T22:18:33Z
state: returned
fix_subject: fix:775c4d13
fix: River · stream/census-lane — fold-conflict failed for census-lane: census-lane READY ab17aa91a6f0 conflicts with river 691c01dd0ff4 (releases 25 to 29) when merged alone. Conflicting files: lib/control-plane/discovery/auto-crosswalk.ts lib/control-plane/discovery/derived-wiring-reading.ts lib/control-plane

## Failure

```
census-lane READY ab17aa91a6f0 conflicts with river 691c01dd0ff4 (releases 25 to 29) when merged alone. Conflicting files: lib/control-plane/discovery/auto-crosswalk.ts lib/control-plane/discovery/derived-wiring-reading.ts lib/control-plane/discovery/meetings-discovery-executor.ts lib/control-plane/workers/standing-runtime.ts lib/hunt/meetings-site-discovery.ts tests/robots-recorded-not-blocking.test.ts   Merge river into stream/census-lane, resolve, and mark READY again.
```

## Repair

Fix on stream/census-lane and publish a new READY commit; River folds the new READY and clears this return when it integrates.
