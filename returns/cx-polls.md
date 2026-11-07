# Returned: cx-polls

lane: cx-polls
owner: cx-polls
writer: the cx-polls lane
check: data committed to git instead of the store
ready: no step ids unknown
river: b342a72847a2f771bc434cf690f37bbc6c252e81
at: 2026-11-07T08:52:37Z
state: returned
fix_subject: fix:d4517b1f
fix: River · stream/cx-polls — data committed to git instead of the store failed for cx-polls: READY f22d1cef3 on stream/cx-polls returned by River on 2026-11-07, not folded.

## Failure

```
READY f22d1cef3 on stream/cx-polls returned by River on 2026-11-07, not folded.

What River found: against river b342a7284 the READY adds 34 files and 2,024 lines, all JSON under data/install/cx-polls/, and no code. river has no data/install/ folder.

Why it can't ride a release: rulings §5 "Keep the repository small": data that changes lives in the store or the vault, never in git. Rulings §9: reader data never needs a software release to go live; doors, playbooks and settings are edited as data. A release carries code only.

What to fix before the next READY:
1. Load this data through the standing data path (the Box / the Slide for facts, the store or vault for saved source copies, doors and settings as data), not as committed files. Facts reach readers when they pass §3, with no release.
2. If the lane needs code (a loader, a parser, a door kind) to get the data in, that code is the READY: small, tested, and stating that it is connected end to end and still works on the next scheduled run, with evidence for each.
3. Delete data/install/cx-polls/ from the branch.
```

## Repair

Fix on stream/cx-polls and publish a new READY commit; River folds the new READY and clears this return when it integrates.
