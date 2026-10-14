# Returned: ballot-parity

lane: ballot-parity
owner: ballot-parity
writer: the ballot-parity lane
check: fold-conflict
ready: no step ids unknown
river: ab2f2cce6489dc307c3810b6cbb6ea71df8e42cb
at: 2026-10-14T22:54:32Z
state: returned
fix_subject: fix:e0b21df1
fix: River · stream/ballot-parity — fold-conflict failed for ballot-parity: ballot-parity READY babd9bece (BL-20) conflicts with river ab2f2cce6489 by itself in lib/civic-data/election-field-publication.ts and lib/civic-data/manual-prior-authority.ts (fact-store, release 39, reworked the same code; the lane's last

## Failure

```
ballot-parity READY babd9bece (BL-20) conflicts with river ab2f2cce6489 by itself in lib/civic-data/election-field-publication.ts and lib/civic-data/manual-prior-authority.ts (fact-store, release 39, reworked the same code; the lane's last river merge predates it). Merge river into stream/ballot-parity, resolve against river's versions of those two files, and mark READY again.
```

## Repair

Fix on stream/ballot-parity and publish a new READY commit; River folds the new READY and clears this return when it integrates.
