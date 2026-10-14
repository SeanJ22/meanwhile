# Returned: site-reads

lane: site-reads
owner: site-reads
writer: the site-reads lane
check: fold-conflict
ready: no step ids unknown
river: ab2f2cce6489dc307c3810b6cbb6ea71df8e42cb
at: 2026-10-14T22:54:35Z
state: returned
fix_subject: fix:d369634a
fix: River · stream/site-reads — fold-conflict failed for site-reads: site-reads READY 2ced10cfa (NE-01) conflicts with river ab2f2cce6489 by itself in app/api/ask/grounded/route.ts and lib/civic-data/reader-edge-publication.ts (BL-10 and fact-store, releases 38 and 39, changed the same code). Merge river int

## Failure

```
site-reads READY 2ced10cfa (NE-01) conflicts with river ab2f2cce6489 by itself in app/api/ask/grounded/route.ts and lib/civic-data/reader-edge-publication.ts (BL-10 and fact-store, releases 38 and 39, changed the same code). Merge river into stream/site-reads, resolve against river's versions of those two files, and mark READY again.
```

## Repair

Fix on stream/site-reads and publish a new READY commit; River folds the new READY and clears this return when it integrates.
