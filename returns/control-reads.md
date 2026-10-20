# Returned: control-reads

lane: control-reads
owner: control-reads
writer: the control-reads lane
check: fold-conflict
ready: CP-01 9293c19fb4135c22da8d1ca6dfb7a7a2935269c1
river: 5307d8b75678fc416f8e062cc9c65839d6d23da8
at: 2026-10-20T05:23:00Z
state: returned
fix_subject: fix:89077350
fix: River · stream/control-reads — fold-conflict failed for control-reads: CP-01 READY 9293c19fb413 failed the actual river.mjs fold alone against River 5307d8b75678 (release 60: RS-03 + SRC-MN step 1, merged to main as 9a159f69f054; release 59 SH-01 is also in). The merge was aborted cleanly; no gates ran. This i

## Failure

```
CP-01 READY 9293c19fb413 failed the actual river.mjs fold alone against River 5307d8b75678 (release 60: RS-03 + SRC-MN step 1, merged to main as 9a159f69f054; release 59 SH-01 is also in). The merge was aborted cleanly; no gates ran. This is an integration conflict, not a test failure.

One conflicting file (git merge-tree origin/river origin/stream/control-reads):
  tests/routine-civic-data-runner.test.ts

SRC-MN (campaign money off reader pages) also edited this test file. Keep both sides' intent: CP-01's runner/control changes and SRC-MN's changes to the same test (the SRC-MN edit removes cases tied to the incorrect campaign money; do not bring them back).

Everything else merges cleanly onto River, including a clean trial merge earlier onto 5307d8b-1 and preflight (0 findings). CP-01 carries a control-plane migration named CP-01 (lib/control-plane/repository/migrations/CP-01.ts plus the journal); River will number it on fold.

Fix: merge current River (5307d8b75678, and main 9a159f69f054) into stream/control-reads, resolve that one file, run `node scripts/preflight.mjs` and the focused checks, then send a new READY. Never merge later WIP into the READY.
```

## Repair

Fix on stream/control-reads and publish a new READY commit; River folds the new READY and clears this return when it integrates.
