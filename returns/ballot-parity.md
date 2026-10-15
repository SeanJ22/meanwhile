# Returned: ballot-parity

lane: ballot-parity
owner: ballot-parity
writer: the ballot-parity lane
check: fold-conflict
ready: no step ids unknown
river: be06573dcbd3a61b776ddab90e6f20519d3eefbf
at: 2026-10-15T14:35:30Z
state: returned
fix_subject: fix:e61e0206
fix: River · stream/ballot-parity — fold-conflict failed for ballot-parity: BL-20 (6429fc3ad) conflicts with river be06573dc in two files. lib/civic-data/promotion.ts: the import line (river adds EvidenceStore from ../control-plane/evidence/store.ts, you add manualPriorAuthorityOf) and the statePeopleRetirementSour

## Failure

```
BL-20 (6429fc3ad) conflicts with river be06573dc in two files. lib/civic-data/promotion.ts: the import line (river adds EvidenceStore from ../control-plane/evidence/store.ts, you add manualPriorAuthorityOf) and the statePeopleRetirementSourceCheck call (river awaits it with options.vault; your hunk adds additionalPriorBases after it): keep both, with river's await and vault argument. lib/coverage/checklist-map.json: ELE-06 and ELE-07, river added filledBy lists, take river's lines. Merge origin/river into stream/ballot-parity, run the focused tests, push a new READY.
```

## Repair

Fix on stream/ballot-parity and publish a new READY commit; River folds the new READY and clears this return when it integrates.
