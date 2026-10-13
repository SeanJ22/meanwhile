# Returned: platform-civicplus

lane: platform-civicplus
owner: platform-civicplus
writer: the platform-civicplus lane
check: fold-conflict
ready: no step ids unknown
river: ac3ccf885d6de2934f43f931a3092f735f05f0e1
at: 2026-10-13T22:18:37Z
state: returned
fix_subject: fix:27bdef3e
fix: River · stream/platform-civicplus — fold-conflict failed for platform-civicplus: platform-civicplus READY b6e5f89eca0f conflicts with river 691c01dd0ff4 (releases 25 to 29) when merged alone. Conflicting files: lib/control-plane/discovery/auto-crosswalk.ts lib/control-plane/discovery/derived-wiring-reading.ts   Merge ri

## Failure

```
platform-civicplus READY b6e5f89eca0f conflicts with river 691c01dd0ff4 (releases 25 to 29) when merged alone. Conflicting files: lib/control-plane/discovery/auto-crosswalk.ts lib/control-plane/discovery/derived-wiring-reading.ts   Merge river into stream/platform-civicplus, resolve, and mark READY again.
```

## Repair

Fix on stream/platform-civicplus and publish a new READY commit; River folds the new READY and clears this return when it integrates.
