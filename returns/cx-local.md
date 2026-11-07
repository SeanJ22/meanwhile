# Returned: cx-local

lane: cx-local
owner: cx-local
writer: the cx-local lane
check: data committed to git instead of the store
ready: no step ids unknown
river: b342a72847a2f771bc434cf690f37bbc6c252e81
at: 2026-11-07T08:52:34Z
state: returned
fix_subject: fix:feb69993
fix: River · stream/cx-local — data committed to git instead of the store failed for cx-local: READY 35c683f90 on stream/cx-local returned by River on 2026-11-07, not folded.

## Failure

```
READY 35c683f90 on stream/cx-local returned by River on 2026-11-07, not folded.

What River found: against river b342a7284 the READY adds 14,730 files and 11,334,970 lines, all JSON under data/install/cx-local/, and no code. river has no data/install/ folder.

Why it can't ride a release: rulings §5 "Keep the repository small": data that changes lives in the store or the vault, never in git. Rulings §9: reader data never needs a software release to go live; doors, playbooks and settings are edited as data. A release carries code only.

What to fix before the next READY:
1. Load this data through the standing data path (the Box / the Slide for facts, the store or vault for saved source copies, doors and settings as data), not as committed files. Facts reach readers when they pass §3, with no release.
2. If the lane needs code (a loader, a parser, a door kind) to get the data in, that code is the READY: small, tested, and stating that it is connected end to end and still works on the next scheduled run, with evidence for each.
3. Delete data/install/cx-local/ from the branch.
```

## Repair

Fix on stream/cx-local and publish a new READY commit; River folds the new READY and clears this return when it integrates.
