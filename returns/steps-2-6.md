# Returned: steps-2-6

lane: steps-2-6
owner: steps-2-6
writer: the steps-2-6 lane
check: fold-conflict
ready: no step ids unknown
river: 493311674ed4c1f3d15c14f70e19e7be9b9f58aa
at: 2026-10-15T23:22:42Z
state: returned
fix_subject: fix:3f4e724b
fix: River · stream/steps-2-6 — fold-conflict failed for steps-2-6: STEP-7 (6da1efc6b) conflicts with river 3282584e2 plus CP-01 in a way that changes what the routes do, not just text: NE-01 (on river) wraps /api/funding/[target], /api/official-actions/[subject], /api/votes, /api/reactions, /api/positions/

## Failure

```
STEP-7 (6da1efc6b) conflicts with river 3282584e2 plus CP-01 in a way that changes what the routes do, not just text: NE-01 (on river) wraps /api/funding/[target], /api/official-actions/[subject], /api/votes, /api/reactions, /api/positions/[subject]/[topic] and /api/meetings in readerRoute() edge reads with the holdings inline, while STEP-7 extracts those routes' holdings into ./holdings modules and adds request limits. Both cannot own the same route structure. Merge origin/river into stream/steps-2-6, rebuild your extraction on top of readerRoute (keep NE-01's edge reads and your bodies/limits), and fix lib/control-plane/fleet-safety.ts and scripts/platform-census-runner.mts imports (publicFetch plus CP-01's spend-window imports, keep both). Files: app/api/ask/grounded/route.ts, funding/[target], meetings, official-actions/[subject], positions/[subject]/[topic], reactions, votes routes; tests/ask-fetch-through-key-route.test.ts, tests/ask-speculative-reading.test.ts. Peak memory (reader transport raw 210 MB at 92,000 hosts) passes the item check.
```

## Repair

Fix on stream/steps-2-6 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
