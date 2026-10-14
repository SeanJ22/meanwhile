# Returned: platform-swagit

lane: platform-swagit
owner: platform-swagit
writer: the platform-swagit lane
check: fold-conflict
ready: R3-SWAGIT f82c6a3d692df5e76a225cfb49d64dc18ba983ad
river: dc5cddd3834ac04588782f84b6becc81fe6a5e25
at: 2026-10-14T17:02:32Z
state: returned
fix_subject: fix:68770547
fix: River · stream/platform-swagit — fold-conflict failed for platform-swagit: platform-swagit READY f82c6a3d6 conflicts with river dc5cddd3834a by itself in lib/civic-data/derived-door-kinds.ts, lib/civic-data/meeting-body-crosswalk.ts, lib/civic-data/meeting-partitions.ts, lib/control-plane/discovery/auto-crosswalk.

## Failure

```
platform-swagit READY f82c6a3d6 conflicts with river dc5cddd3834a by itself in lib/civic-data/derived-door-kinds.ts, lib/civic-data/meeting-body-crosswalk.ts, lib/civic-data/meeting-partitions.ts, lib/control-plane/discovery/auto-crosswalk.ts, lib/control-plane/discovery/derived-wiring-reading.ts (platform-civicclerk, civicplus, escribe and novusagenda are now on river); merge river into stream/platform-swagit, resolve, and mark READY again.
```

## Repair

Fix on stream/platform-swagit and publish a new READY commit; River folds the new READY and clears this return when it integrates.
