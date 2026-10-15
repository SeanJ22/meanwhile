# Returned: ballot-three-states

lane: ballot-three-states
owner: ballot-three-states
writer: the ballot-three-states lane
check: fold-conflict
ready: no step ids unknown
river: 493311674ed4c1f3d15c14f70e19e7be9b9f58aa
at: 2026-10-15T23:04:38Z
state: returned
fix_subject: fix:00439967
fix: River · stream/ballot-three-states — fold-conflict failed for ballot-three-states: BL-30 (3d2b6615f) conflicts with river 3282584e2 (release 43: R3-MUNICODE and NE-01 folded) in: app/(admin)/_mw/admin-v6/model.ts, app/api/agenda/route.ts, app/api/ask/grounded/route.ts, app/api/ballot/scope/route.ts, app/api/funding/[targe

## Failure

```
BL-30 (3d2b6615f) conflicts with river 3282584e2 (release 43: R3-MUNICODE and NE-01 folded) in: app/(admin)/_mw/admin-v6/model.ts, app/api/agenda/route.ts, app/api/ask/grounded/route.ts, app/api/ballot/scope/route.ts, app/api/funding/[target]/route.ts, app/api/meetings/route.ts, app/api/official-actions/[subject]/route.ts, app/api/positions/[subject]/[topic]/route.ts, app/api/profile/[subject]/route.ts, app/api/reactions/route.ts, app/api/representation/[...division]/route.ts, app/api/votes/local/route.ts, app/api/voting-sites/route.ts, app/ballot/page.tsx, lib/civic-data/manual-read-models.ts, lib/civic-data/promoted-edge-publication.ts, lib/civic-data/read-model.ts, lib/civic-data/reader-edge-publication.ts, lib/meetings/edge-artifacts.ts, lib/meetings/edge-serving.ts, lib/registration/edge.ts, lib/registry/runtime-edge.ts, lib/registry/runtime-read-model.ts, lib/registry/server.ts, tests/promoted-edge.test.ts, tests/reader-edge.test.ts, tests/registration-edge.test.ts. Merge origin/river into stream/ballot-three-states, settle those files so both sides' behavior is kept (NE-01's reader-edge reads and request accounting, municode's bounded portal reads), run the focused tests, push a new READY with AT SCALE numbers in the message.
```

## Repair

Fix on stream/ballot-three-states and publish a new READY commit; River folds the new READY and clears this return when it integrates.
