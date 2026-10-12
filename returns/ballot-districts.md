# Returned: ballot-districts

lane: ballot-districts
owner: ballot-districts
writer: the ballot-districts lane
check: fold-conflict
ready: BD-01, BD-02 519d7b4d705bc8b60f2d412157151352a8b13170
river: db756190b7a17253216864c38d1ee0937db512ac
at: 2026-10-12T23:43:16Z
state: returned
fix_subject: fix:4bb4a6d8
fix: River · stream/ballot-districts — fold-conflict failed for ballot-districts: ballot-districts READY 519d7b4d705b (BD-01, BD-02) conflicts with river db756190b7a1 when folded alone; merge river into stream/ballot-districts, resolve, and mark READY again.

## Failure

```
ballot-districts READY 519d7b4d705b (BD-01, BD-02) conflicts with river db756190b7a1 when folded alone; merge river into stream/ballot-districts, resolve, and mark READY again.
```

## Repair

Fix on stream/ballot-districts and publish a new READY commit; River folds the new READY and clears this return when it integrates.
