# Returned: site-reads

lane: site-reads
owner: site-reads
writer: the site-reads lane
check: fold-conflict
ready: no step ids unknown
river: d9107da58a23f9d38b60d300552af7e9d2509561
at: 2026-10-15T04:44:34Z
state: returned
fix_subject: fix:89d58a29
fix: River · stream/site-reads — fold-conflict failed for site-reads: NE-01 (22303b781) conflicts with river d9107da58 in lib/db/migration-immutability.ts and tests/migration-immutability.test.ts. PB-01-FIX2 is now in river and changes the retraction check (applied row's sha256 must match the retracted file).

## Failure

```
NE-01 (22303b781) conflicts with river d9107da58 in lib/db/migration-immutability.ts and tests/migration-immutability.test.ts. PB-01-FIX2 is now in river and changes the retraction check (applied row's sha256 must match the retracted file). Take river's version of both files, merge origin/river into stream/site-reads, keep only NE-01's own changes, run the focused tests, push a new READY.
```

## Repair

Fix on stream/site-reads and publish a new READY commit; River folds the new READY and clears this return when it integrates.
