# Returned: acquisition-leftovers

lane: acquisition-leftovers
owner: acquisition-leftovers
writer: the acquisition-leftovers lane
check: fold-conflict
ready: no step ids unknown
river: ac3ccf885d6de2934f43f931a3092f735f05f0e1
at: 2026-10-13T22:18:29Z
state: returned
fix_subject: fix:c2aa7f6a
fix: River · stream/acquisition-leftovers — fold-conflict failed for acquisition-leftovers: acquisition-leftovers READY 3a142ab30e17 conflicts with river 691c01dd0ff4 (releases 25 to 29) when merged alone. Conflicting files: lib/civic-data/changes.ts lib/registry/server.ts   Merge river into stream/acquisition-leftovers, resolve,

## Failure

```
acquisition-leftovers READY 3a142ab30e17 conflicts with river 691c01dd0ff4 (releases 25 to 29) when merged alone. Conflicting files: lib/civic-data/changes.ts lib/registry/server.ts   Merge river into stream/acquisition-leftovers, resolve, and mark READY again.
```

## Repair

Fix on stream/acquisition-leftovers and publish a new READY commit; River folds the new READY and clears this return when it integrates.
