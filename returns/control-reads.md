# Returned: control-reads

lane: control-reads
owner: control-reads
writer: the control-reads lane
check: fold-conflict
ready: CP-01 e01f266bbe4d7c0f3c33bc67d6118b36c38a4ad9
river: 011443fad6cfca5bb943f5c307925808fc8974c4
at: 2026-10-19T19:56:09Z
state: returned
fix_subject: fix:54f0f72a
fix: River · stream/control-reads — fold-conflict failed for control-reads: CP-01 READY e01f266bbe4d7c0f3c33bc67d6118b36c38a4ad9 failed the actual river.mjs fold alone against River 011443fad6cf (release 58: RS-02 + BS-01, merged to main as 9ab71524b692). The merge was aborted cleanly; no gates ran. This is an inte

## Failure

```
CP-01 READY e01f266bbe4d7c0f3c33bc67d6118b36c38a4ad9 failed the actual river.mjs fold alone against River 011443fad6cf (release 58: RS-02 + BS-01, merged to main as 9ab71524b692). The merge was aborted cleanly; no gates ran. This is an integration conflict, not a test failure. The lane's READY does not contain current River (RS-02/BS-01 landed after your merge).

12 conflicting files (git merge-tree origin/river origin/stream/control-reads), down from the 39 in the earlier return:
  app/api/ask/grounded/route.ts
  lib/control-plane/owner-surface.ts
  lib/control-plane/scheduler/ask-gap-holdings.ts
  scripts/ballot-scale.mts
  scripts/routine-civic-data-runner.mts
  tests/could-govern-pill.test.ts
  tests/derived-meeting-family.test.ts
  tests/held-meeting-partition.test.ts
  tests/meetings-data-plane-cutover.test.ts
  tests/reader-edge-supervisor.test.ts
  tests/reader-edge.test.ts
  tests/routine-civic-data-runner.test.ts

Fix: merge current River (011443fad6cf, and main 9ab71524b692) into stream/control-reads, resolve the files above keeping both sides' intent (RS-02 makes readers read canonical source partitions directly and retires the reader copies and publication queue, migrations 0043/0044 already applied in production; CP-01's paid-control checks and dispatch SQL must follow that reader path, not the removed copies), run `node scripts/preflight.mjs` (the registered import closure of scripts/promote-registry-runtime.mts is at the 512-file limit; do not raise it) and focused checks, then send a new READY. Never merge later WIP into the READY.
```

## Repair

Fix on stream/control-reads and publish a new READY commit; River folds the new READY and clears this return when it integrates.
