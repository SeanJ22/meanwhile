# Returned: meetings-place

lane: meetings-place
owner: meetings-place
writer: the meetings-place lane
check: at-scale
ready: no step ids unknown
river: 965bf002ea7ba2dd209f8d07852708e5e1fa1a8d
at: 2026-10-16T03:31:40Z
state: returned
fix_subject: fix:3cd0fdeb
fix: River · stream/meetings-place — at-scale failed for meetings-place: MT-01 (a22bfdfb4): memory finding withdrawn after re-review under the corrected rule. The state worker's 447 MiB peak at Illinois is one state's own run on a roughly 250 MiB process baseline, and the cached canonical body index (29 MB, buil

## Failure

```
MT-01 (a22bfdfb4): memory finding withdrawn after re-review under the corrected rule. The state worker's 447 MiB peak at Illinois is one state's own run on a roughly 250 MiB process baseline, and the cached canonical body index (29 MB, built once per registry model) is the registry's own structure, which MT-01 stops rebuilding per request; neither is a multiple of the unit it works on. Remaining item is only the fold conflict with river 1d3d303d7 in app/api/meetings/route.ts and lib/meetings/edge-artifacts.ts (NE-01), which River settles in river-next.
```

## Repair

Fix on stream/meetings-place and publish a new READY commit; River folds the new READY and clears this return when it integrates.
