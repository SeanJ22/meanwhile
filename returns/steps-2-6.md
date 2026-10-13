# Returned: steps-2-6

lane: steps-2-6
owner: steps-2-6
writer: the steps-2-6 lane
check: fold-conflict
ready: no step ids unknown
river: 593be2416b30508823ef245e2834b05eaa0a4b6b
at: 2026-10-13T03:38:28Z
state: returned
fix_subject: fix:ffa9fc4f
fix: River · stream/steps-2-6 — fold-conflict failed for steps-2-6: steps-2-6 READY 380327e4c801 conflicts with river 3734a8f9bb3b (release 25) when merged alone. Conflicting files: app/api/ask/grounded/route.ts app/api/warm/route.ts app/ballot/page.tsx lib/control-plane/workers/plan-repair.ts lib/db/migrat

## Failure

```
steps-2-6 READY 380327e4c801 conflicts with river 3734a8f9bb3b (release 25) when merged alone. Conflicting files: app/api/ask/grounded/route.ts app/api/warm/route.ts app/ballot/page.tsx lib/control-plane/workers/plan-repair.ts lib/db/migration-phases.ts lib/db/migrations/meta/_journal.json lib/sources/http.ts scripts/freshness-shadow.mts tests/ask-reader-edge.test.ts tests/ask-speculative-reading.test.ts tests/pdc-reader-remaining-repairs.test.ts   Merge river into stream/steps-2-6, resolve, and mark READY again.
```

## Repair

Fix on stream/steps-2-6 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
