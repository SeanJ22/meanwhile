# Returned: src-money

lane: src-money
owner: src-money
writer: the src-money lane
check: combined-preflight-import-closure
ready: SRC-MN a1d55302b3d15200b6d2bed51cf530f105fec584
river: ab0c352cf21752d23500fb7ea72ddf712675755e
at: 2026-10-18T22:01:55Z
state: returned
fix_subject: fix:d6384109
fix: River · stream/src-money — combined-preflight-import-closure failed for src-money: Exact failing candidate c9e009037d93abc5e63ef48bdb8c94974f406031 includes current main release-55 merge 4bdb43a7048b4fa407fa236602e93a85e0efd2b6. Both folds were clean; no new migrations.

## Failure

```
SRC-MN READY a1d55302b3d15200b6d2bed51cf530f105fec584 is incompatible with the release-56 combination containing SH-01 READY 445e511dab21766cbfde79b3a0bd1c933e4fb4d9.
Exact failing candidate c9e009037d93abc5e63ef48bdb8c94974f406031 includes current main release-55 merge 4bdb43a7048b4fa407fa236602e93a85e0efd2b6. Both folds were clean; no new migrations.
The actual river.mjs test stopped in preflight before the expensive tier. This is an application import-graph interaction, not a package/tool setup failure.
SH-01 alone at 8ce8d440c72314aac258c4bd6a251610e7c12fb8 passed both preflight checks.
SRC-MN alone at its exact READY also passed both checks. Neither standalone result resolves the combined failure.
Returning the later SRC-MN batch so the older SH-01 two-hour-triggered batch can ship after full gates. Owner src-money: integrate current River after SH-01 ships, reduce the shared runtime import closure without raising the existing limit or adding a bypass, preserve the shared state/place fact path, run the focused check and send a new READY. Do not retry this SHA unchanged. Production ingestion/live examples remain unverified and were not performed by River.

=== Actual combined gates output ===
river test: pnpm gates on c9e009037d93

> we-the-people@0.1.0 gates /workspace/meanwhile
> node scripts/gates.mjs

local gates — the set CI requires

  visible-tree … PASS — files a sweep of the committed tree can see: 5495 of 5495.
  civic-data-release-firewall … FAIL — 1 release-coupling finding(s).
    DATA_EXECUTABLE_CLOSURE_UNRESOLVED · scripts/promote-registry-runtime.mts · The registered data-command closure could not be classified: registered executable closure exceeded 512 files.

  preflight REFUSED in 17.51s — civic-data-release-firewall.
  The expensive tier was not run on this tree. Fix the above and run `pnpm gates` again;
  the corrected tree runs every gate before anything may ship.

(node:47234) ExperimentalWarning: stripTypeScriptTypes is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
 ELIFECYCLE  Command failed with exit code 1.
river test: gates fail on c9e009037d93 (recorded in .scratch/river/test.json)
river: gates fail; isolate the failing lane before promoting

=== SH-01 only preflight ===

preflight — the cheap deterministic checks

  visible-tree … PASS — files a sweep of the committed tree can see: 5437 of 5437.
  civic-data-release-firewall … PASS — 0 findings across 767 routine and 361 explicit-owner source contract(s).

  2 of 2 preflight check(s) clean. The expensive tier may run on this head.

(node:47334) ExperimentalWarning: stripTypeScriptTypes is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)

=== SRC-MN only preflight ===

preflight — the cheap deterministic checks

  visible-tree … PASS — files a sweep of the committed tree can see: 5490 of 5490.
  civic-data-release-firewall … PASS — 0 findings across 823 routine and 361 explicit-owner source contract(s).

  2 of 2 preflight check(s) clean. The expensive tier may run on this head.

(node:47353) ExperimentalWarning: stripTypeScriptTypes is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
```

## Repair

Fix on stream/src-money and publish a new READY commit; River folds the new READY and clears this return when it integrates.

## Changed combination — 22:29Z October 18

The return above applies to the SH-01 + SRC-MN combination. SH-01 was subsequently returned after its independent full gates failed tests/seat-grouping.test.ts:117 (new valid vacancy row made a stale 4-count assertion observe 5). The failing SH-01 input is now removed. SRC-MN alone passed the focused preflight; this is new combination evidence, not a retry of the unchanged failing pair. River is now running full gates on SRC-MN alone with main release 55 included so the remaining batch can ship. AQ-01 was assessed freshly but its actual fold conflicts in app/api/ask/grounded/route.ts, so it is excluded. The original combined import-graph interaction remains relevant when a future SH-01 replacement integrates SRC-MN.
