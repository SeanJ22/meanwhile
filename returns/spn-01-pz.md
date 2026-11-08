# Returned: spn-01-pz

lane: spn-01-pz
owner: spn-01-pz
writer: the spn-01-pz lane
check: civic-data-release-firewall: 2 release-coupling findings in lib/meetings/edge-store.ts
ready: no step ids 1d4da4a309927b2fe86be3a3b88c85d80a87fe40
river: ddfe674f2f5723f889e3bee8db94e334cbb5df0b
at: 2026-11-08T18:57:05Z
state: returned
fix_subject: fix:bc0b8d3b
fix: River · stream/spn-01-pz — civic-data-release-firewall: 2 release-coupling findings in lib/meetings/edge-store.ts failed for spn-01-pz: READY 1d4da4a30 (SPN-01PZ) was folded with the election-results batch on top of River batch 194 (df60bf774). `pnpm gates` stopped at the preflight civic-data-release-firewall with two findings, both in this branch's change to lib/meetings/e

## Failure

```
READY 1d4da4a30 (SPN-01PZ) was folded with the election-results batch on top of River batch 194 (df60bf774). `pnpm gates` stopped at the preflight civic-data-release-firewall with two findings, both in this branch's change to lib/meetings/edge-store.ts:

    MANUAL_DATA_PATH_WRITES_REPOSITORY · lib/meetings/edge-store.ts · A filesystem writer reachable from scripts/promote-manual-civic-projection.mts can bypass the canonical production data plane.
    ROUTINE_PATH_WRITES_REPOSITORY · lib/meetings/edge-store.ts · A filesystem writer reachable from scripts/fetch-fec.mts can bypass the canonical production data plane.

Cause: the new LocalFileArtifactStore.putIfAbsent calls `linkSync(temporary, ...)` and `unlinkSync(temporary)` on a path that is not wrapped in `temporaryPath(...)`. Every other filesystem writer in this file goes through temporaryPath, which is how the firewall knows the write stays out of the repository. Wrap each path that putIfAbsent writes, links or unlinks in temporaryPath, as putImmutable already does. Then run `pnpm gates` (at least through preflight: `node scripts/gates.mjs` stops there on a finding) on a merge with origin/river, and push a new READY. The READY subject should name the step id in the form the fold parses. This READY folded as "()" with no step ids, so check `stepIds()` in scripts/river.mjs.

It rides the next River batch once the new READY lands.
```

## Repair

Fix on stream/spn-01-pz and publish a new READY commit; River folds the new READY and clears this return when it integrates.
