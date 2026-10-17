# Returned: ballot-parity

lane: ballot-parity
owner: ballot-parity
writer: the ballot-parity lane
check: fold: conflicts with EP-01
ready: no step ids unknown
river: 5d6a5797f01b55cfabd1636beb28432fe6bbd1e2
at: 2026-10-17T08:11:22Z
state: returned
fix_subject: fix:6d02e6ba
fix: River · stream/ballot-parity — fold: conflicts with EP-01 failed for ballot-parity: fold: stream/ballot-parity READY 93afd4c78 (BL-20, BL-21) conflicts with EP-01 (edge-publish c1d9394f2) in tests/state-artifact-dispatch.test.ts only.

## Failure

```
fold: stream/ballot-parity READY 93afd4c78 (BL-20, BL-21) conflicts with EP-01 (edge-publish c1d9394f2) in tests/state-artifact-dispatch.test.ts only.
EP-01 moves every authority family to its own pointer and a state publish writes no manifest; BL-21 adds a sixth state family. After release 52 lands EP-01 on river: merge river into stream/ballot-parity, keep EP-01's per-family pointer assertion (served(f.artifacts, "IL", unit.family)) with launches.length 7, drop the manifest stateAuthorities count, run focused checks, send a new READY.
```

## Repair

Fix on stream/ballot-parity and publish a new READY commit; River folds the new READY and clears this return when it integrates.
