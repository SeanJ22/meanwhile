# DB-03A returned (River, 2:45 AM EDT Oct 25)

READY 9b15cb1be folds cleanly onto river d62ca66ce. River orders the control-plane journal RV-BOX_expand, then DB-03A_expand
(release 111 carries RV-BOX). Its one blocker is how long DB-03A_expand holds cp_doors locked.

`migrateLinkingPages` runs BEGIN; LOCK TABLE cp_doors IN SHARE ROW EXCLUSIVE MODE, and only then walks every voting door one row
per query (`ORDER BY id LIMIT 1`). For each door it saves and verifies its linking pages in the reader database, and only after the
whole walk does it UPDATE and COMMIT. Production (counts only, 2:40 AM EDT): 1,517 voting doors carrying 392.7 MB of votingSource
and votingMappings text (81.7 MB on disk). That is about 1,500 control-plane round trips, each returning about 260 KB, plus reader
saves and opens, all while no runner or Admin write to any of the 12,285 doors can land. The runner's door writes have a 10 s bound.
RB-A8's 41-second lock on cp_box_findings tonight already cost one runner write; this lock would last minutes.

Change (small):
1. Walk and save outside the lock. Save every linking copy to the reader and compute each door's new votingSource and votingMappings
   into a session temp table, recording the exact source text read for each door. Use keyset pages of about 100 doors, not one row
   per query.
2. Then BEGIN; SET LOCAL lock_timeout (a few seconds, retried) before LOCK TABLE cp_doors; recompute only the doors whose
   votingSource or votingMappings no longer equal the recorded text (expected 0 to a handful); UPDATE; COMMIT. The lock is then held
   for seconds.
3. Keep every existing check (authority unchanged per door, sha256 of every saved page) and the retry behaviour.

Repost READY with a test that the lock is taken only after the walk (as tests/apply-migrations-dry.test.ts does for RB-A8's
lockFirst), and the production count of doors and pages it will move. River gates it alone and ships it right after release 111,
ahead of everything else, as Sean ordered.

## River finished it, 4:20 AM EDT (standing order: no new READY within 60 minutes of the return)
- READY 421ce7abe on stream/db-03a (fix 9765cdd3f). migrateLinkingPages now walks keyset pages of 100 voting doors, saves and checks
  every page, and records each door's prepared values with a hash of the text it read, all before cp_doors is locked. Under the
  lock (SET LOCAL lock_timeout 5s, retried up to 5 times) it reads again only doors written since the walk, and replaces only doors
  whose current text still matches what was read.
- Every existing check stays: authority unchanged per source, sha256 of every saved page, a mismatch aborts before any door changes.
- New test: the lock follows the walk, lock_timeout is set first, and a door written between walk and lock keeps its newer value.
  It fails on the old code. db-03a 4/4 and control-plane-migrations pass; eslint and tsc clean. Journal hash updated
  (DB-03A_expand is not applied in production yet).
- Gating alone on river-next 99ce96f52 (control-plane journal: RB-A8, RV-BOX, DB-03A), ahead of everything else as Sean ordered.
